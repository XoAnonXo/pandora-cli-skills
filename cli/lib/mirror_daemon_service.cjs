const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { expandHome } = require('./mirror_state_store.cjs');

const MIRROR_DAEMON_SCHEMA_VERSION = '1.0.0';
const STOP_TIMEOUT_MS = 5_000;
const STOP_POLL_MS = 100;
const SENSITIVE_CLI_FLAGS = new Set([
  '--private-key',
  '--webhook-secret',
  '--telegram-bot-token',
  '--discord-webhook-url',
  '--webhook-template',
]);

function createServiceError(code, message, details = undefined) {
  const err = new Error(message);
  err.code = code;
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

function normalizeStrategyHash(strategyHash) {
  const value = String(strategyHash || '').trim().toLowerCase();
  if (!/^[a-f0-9]{16}$/.test(value)) {
    throw createServiceError('INVALID_FLAG_VALUE', '--strategy-hash must be a 16-character hex value.');
  }
  return value;
}

function resolvePath(filePath) {
  return path.resolve(expandHome(String(filePath || '').trim()));
}

function resolveHomeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || '.';
}

function sanitizeCliArgs(args = []) {
  const sanitized = [];
  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || '');
    const eqIndex = token.indexOf('=');
    if (eqIndex > 0) {
      const flag = token.slice(0, eqIndex);
      if (SENSITIVE_CLI_FLAGS.has(flag)) {
        sanitized.push(`${flag}=[redacted]`);
        continue;
      }
    }

    if (SENSITIVE_CLI_FLAGS.has(token)) {
      sanitized.push(token);
      const next = i + 1 < args.length ? String(args[i + 1] || '') : '';
      if (next && !next.startsWith('--')) {
        sanitized.push('[redacted]');
        i += 1;
      }
      continue;
    }

    sanitized.push(token);
  }
  return sanitized;
}

function defaultPidFile(strategyHash) {
  const hash = normalizeStrategyHash(strategyHash);
  return path.join(resolveHomeDir(), '.pandora', 'mirror', 'daemon', `${hash}.json`);
}

function defaultLogFile(strategyHash) {
  const hash = normalizeStrategyHash(strategyHash);
  return path.join(resolveHomeDir(), '.pandora', 'mirror', 'logs', `${hash}.log`);
}

function defaultPidDir() {
  return path.join(resolveHomeDir(), '.pandora', 'mirror', 'daemon');
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const serialized = JSON.stringify(payload, null, 2);
  fs.writeFileSync(tmpPath, serialized, { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort permission hardening
  }
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw createServiceError('MIRROR_DAEMON_PIDFILE_INVALID', `Failed to parse daemon pid file at ${filePath}.`, {
      cause: err && err.message ? err.message : String(err),
    });
  }
}

function isPidAlive(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (err) {
    if (err && (err.code === 'ESRCH' || err.code === 'ENOENT')) return false;
    if (err && err.code === 'EPERM') return true;
    throw err;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForProcessExit(pid, timeoutMs = STOP_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isPidAlive(pid)) return true;
    await sleep(STOP_POLL_MS);
  }
  return !isPidAlive(pid);
}

function resolvePidFile(options = {}) {
  if (options.pidFile) {
    return resolvePath(options.pidFile);
  }
  if (options.strategyHash) {
    return defaultPidFile(options.strategyHash);
  }
  throw createServiceError(
    'MISSING_REQUIRED_FLAG',
    'mirror sync daemon lifecycle requires --pid-file <path> or --strategy-hash <hash>.',
  );
}

function listDaemonPidFiles() {
  const dir = defaultPidDir();
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(dir, entry.name));
}

function findPidFilesByMarketAddress(marketAddress) {
  const needle = String(marketAddress || '').trim().toLowerCase();
  return listDaemonPidFiles().filter((filePath) => {
    const metadata = readJsonFile(filePath);
    if (!metadata) return false;
    return String(metadata.pandoraMarketAddress || '').trim().toLowerCase() === needle;
  });
}

function startDaemon(options = {}) {
  const strategyHash = normalizeStrategyHash(options.strategyHash);
  const pidFile = defaultPidFile(strategyHash);
  const logFile = options.logFile ? resolvePath(options.logFile) : defaultLogFile(strategyHash);
  const cliPath = options.cliPath ? resolvePath(options.cliPath) : null;
  const cliArgs = Array.isArray(options.cliArgs) ? options.cliArgs.map((item) => String(item)) : [];

  if (!cliPath) {
    throw createServiceError('MIRROR_DAEMON_CLI_PATH_REQUIRED', 'Daemon start requires the CLI path.');
  }
  if (!cliArgs.length) {
    throw createServiceError('MIRROR_DAEMON_CLI_ARGS_REQUIRED', 'Daemon start requires sync run CLI arguments.');
  }

  const existing = readJsonFile(pidFile);
  if (existing && isPidAlive(existing.pid)) {
    throw createServiceError('MIRROR_DAEMON_ALREADY_RUNNING', 'Mirror sync daemon is already running for this strategy.', {
      pidFile,
      pid: existing.pid,
      strategyHash,
    });
  }

  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const logFd = fs.openSync(logFile, 'a', 0o600);
  const child = spawn(process.execPath, [cliPath, ...cliArgs], {
    cwd: options.cwd || process.cwd(),
    env: {
      ...process.env,
      ...(options.env || {}),
      PANDORA_DAEMON_LOG_JSONL: '1',
    },
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);
  try {
    fs.chmodSync(logFile, 0o600);
  } catch {
    // best-effort permission hardening
  }
  const sanitizedCliArgs = sanitizeCliArgs(cliArgs);

  const metadata = {
    schemaVersion: MIRROR_DAEMON_SCHEMA_VERSION,
    strategyHash,
    pid: child.pid,
    pidAlive: isPidAlive(child.pid),
    startedAt: new Date().toISOString(),
    checkedAt: new Date().toISOString(),
    status: isPidAlive(child.pid) ? 'running' : 'unknown',
    pidFile,
    logFile,
    logFormat: 'jsonl',
    cliPath,
    cliArgs: sanitizedCliArgs,
    stateFile: options.stateFile || null,
    killSwitchFile: options.killSwitchFile || null,
    mode: options.mode || 'run',
    executeLive: Boolean(options.executeLive),
    pandoraMarketAddress: options.pandoraMarketAddress || null,
    polymarketMarketId: options.polymarketMarketId || null,
    polymarketSlug: options.polymarketSlug || null,
    launchCommand: [process.execPath, cliPath, ...sanitizedCliArgs].join(' '),
  };
  writeJsonFile(pidFile, metadata);

  return metadata;
}

async function stopDaemon(options = {}) {
  if (options.all || options.marketAddress) {
    const pidFiles = options.all ? listDaemonPidFiles() : findPidFilesByMarketAddress(options.marketAddress);
    const results = [];
    for (const pidFile of pidFiles) {
      try {
        const item = await stopDaemon({ pidFile, stopTimeoutMs: options.stopTimeoutMs });
        results.push({
          ok: true,
          pidFile,
          result: item,
        });
      } catch (err) {
        results.push({
          ok: false,
          pidFile,
          error: {
            code: err && err.code ? err.code : 'MIRROR_DAEMON_STOP_FAILED',
            message: err && err.message ? err.message : String(err),
            details: err && err.details ? err.details : null,
          },
        });
      }
    }
    return {
      schemaVersion: MIRROR_DAEMON_SCHEMA_VERSION,
      mode: options.all ? 'all' : 'market',
      selector: options.all ? null : String(options.marketAddress || '').toLowerCase(),
      count: results.length,
      successCount: results.filter((item) => item.ok).length,
      failureCount: results.filter((item) => !item.ok).length,
      items: results,
    };
  }
  const pidFile = resolvePidFile(options);
  const metadata = readJsonFile(pidFile);
  if (!metadata) {
    throw createServiceError('MIRROR_DAEMON_NOT_FOUND', `No daemon metadata found at ${pidFile}.`, { pidFile });
  }

  const pid = Number(metadata.pid);
  const wasAlive = isPidAlive(pid);
  let signalSent = false;
  if (wasAlive) {
    process.kill(pid, 'SIGTERM');
    signalSent = true;
  }

  let exited = wasAlive ? await waitForProcessExit(pid, options.stopTimeoutMs || STOP_TIMEOUT_MS) : true;
  let alive = isPidAlive(pid);
  let forceKilled = false;
  if (wasAlive && alive) {
    try {
      process.kill(pid, 'SIGKILL');
      forceKilled = true;
      exited = await waitForProcessExit(pid, 2_000);
      alive = isPidAlive(pid);
    } catch (err) {
      if (!(err && (err.code === 'ESRCH' || err.code === 'ENOENT'))) {
        throw err;
      }
      exited = true;
      alive = false;
    }
  }

  const updated = {
    ...metadata,
    checkedAt: new Date().toISOString(),
    pidAlive: alive,
    status: alive ? 'running' : 'stopped',
    stopAttemptedAt: new Date().toISOString(),
    stopSignal: signalSent ? 'SIGTERM' : null,
    stopForceSignal: forceKilled ? 'SIGKILL' : null,
    stopSignalSent: signalSent,
    stopExitObserved: exited,
    stopForceKilled: forceKilled,
  };
  writeJsonFile(pidFile, updated);

  return {
    schemaVersion: MIRROR_DAEMON_SCHEMA_VERSION,
    operationId: updated.strategyHash || null,
    strategyHash: updated.strategyHash || null,
    pidFile,
    pid,
    wasAlive,
    signalSent,
    forceKilled,
    exitObserved: exited,
    alive,
    status: updated.status,
    metadata: updated,
  };
}

function daemonStatus(options = {}) {
  const pidFile = resolvePidFile(options);
  const metadata = readJsonFile(pidFile);

  if (!metadata) {
      return {
        schemaVersion: MIRROR_DAEMON_SCHEMA_VERSION,
        found: false,
        pidFile,
        operationId: options.strategyHash ? normalizeStrategyHash(options.strategyHash) : null,
        strategyHash: options.strategyHash ? normalizeStrategyHash(options.strategyHash) : null,
      pid: null,
      alive: false,
      status: 'not-found',
      metadata: null,
    };
  }

  const pid = Number(metadata.pid);
  const alive = isPidAlive(pid);
  const updated = {
    ...metadata,
    checkedAt: new Date().toISOString(),
    pidAlive: alive,
    status: alive ? 'running' : 'stopped',
  };
  writeJsonFile(pidFile, updated);

    return {
      schemaVersion: MIRROR_DAEMON_SCHEMA_VERSION,
      found: true,
      pidFile,
      operationId: updated.strategyHash || null,
      strategyHash: updated.strategyHash || null,
    pid,
    alive,
    status: updated.status,
    metadata: updated,
  };
}

module.exports = {
  MIRROR_DAEMON_SCHEMA_VERSION,
  defaultPidFile,
  startDaemon,
  stopDaemon,
  daemonStatus,
  listDaemonPidFiles,
  findPidFilesByMarketAddress,
};
