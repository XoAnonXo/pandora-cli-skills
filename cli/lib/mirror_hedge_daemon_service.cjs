const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const MIRROR_HEDGE_DAEMON_SCHEMA_VERSION = '1.0.0';
const STOP_TIMEOUT_MS = 5_000;
const STOP_POLL_MS = 100;
const SENSITIVE_CLI_FLAGS = new Set([
  '--private-key',
  '--webhook-secret',
  '--telegram-bot-token',
  '--discord-webhook-url',
  '--webhook-template',
]);
const DAEMON_IDENTITY_VALUE_FLAGS = new Set([
  '--pandora-market-address',
  '--market-address',
  '--polymarket-market-id',
  '--polymarket-slug',
  '--state-file',
  '--kill-switch-file',
  '--strategy-hash',
  '--pid-file',
]);
const DAEMON_IDENTITY_BOOLEAN_FLAGS = new Set([
  '--paper',
  '--execute-live',
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

function expandHome(filePath) {
  const value = String(filePath || '').trim();
  if (!value) return value;
  if (value === '~') return resolveHomeDir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(resolveHomeDir(), value.slice(2));
  }
  return value;
}

function resolvePath(filePath) {
  return path.resolve(expandHome(filePath));
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

function defaultPidDir() {
  return path.join(resolveHomeDir(), '.pandora', 'mirror-hedge', 'daemon');
}

function defaultLogDir() {
  return path.join(resolveHomeDir(), '.pandora', 'mirror-hedge', 'logs');
}

function defaultPidFile(strategyHash) {
  const hash = normalizeStrategyHash(strategyHash);
  return path.join(defaultPidDir(), `${hash}.json`);
}

function defaultLogFile(strategyHash) {
  const hash = normalizeStrategyHash(strategyHash);
  return path.join(defaultLogDir(), `${hash}.log`);
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
    throw createServiceError('MIRROR_HEDGE_DAEMON_PIDFILE_INVALID', `Failed to parse daemon pid file at ${filePath}.`, {
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

function hasIdentityMetadata(metadata = {}) {
  const values = [
    metadata.launchCommand,
    metadata.cliPath,
    metadata.cliArgs,
  ];
  return values.some((v) => {
    if (typeof v === 'string') return v.trim() !== '';
    if (Array.isArray(v)) return v.length > 0;
    return false;
  });
}

function readProcessCommandLine(pid) {
  try {
    const output = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const commandLine = String(output || '').trim();
    return commandLine || null;
  } catch {
    return null;
  }
}

function buildIdentityTokens(metadata = {}) {
  const tokens = [];
  const cliPath = String(metadata.cliPath || '').trim();
  if (cliPath) {
    tokens.push(path.basename(cliPath).toLowerCase());
  }
  if (Array.isArray(metadata.cliArgs) && metadata.cliArgs.length) {
    const normalizedArgs = metadata.cliArgs.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean);
    if (normalizedArgs.includes('mirror')) tokens.push('mirror');
    if (normalizedArgs.includes('hedge')) tokens.push('hedge');
    if (normalizedArgs.includes('run')) tokens.push('run');
    for (let index = 0; index < normalizedArgs.length; index += 1) {
      const token = normalizedArgs[index];
      if (DAEMON_IDENTITY_BOOLEAN_FLAGS.has(token)) {
        tokens.push(token);
        continue;
      }
      if (!DAEMON_IDENTITY_VALUE_FLAGS.has(token)) continue;
      tokens.push(token);
      const next = normalizedArgs[index + 1];
      if (!next || next.startsWith('--')) continue;
      if (token === '--state-file' || token === '--kill-switch-file' || token === '--pid-file') {
        tokens.push(path.basename(next));
        continue;
      }
      tokens.push(next);
    }
  }
  if (!tokens.length && typeof metadata.launchCommand === 'string' && metadata.launchCommand.trim()) {
    tokens.push('mirror', 'hedge', 'run');
  }
  return Array.from(new Set(tokens.filter(Boolean)));
}

function inspectDaemonPid(metadata = {}, pidFile = null) {
  const pid = Number(metadata.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    return {
      pid: null,
      pidAlive: false,
      daemonAlive: false,
      identityRequired: false,
      identityVerified: false,
      identityStatus: 'invalid-pid',
      identityMismatchReason: 'Invalid daemon pid in metadata.',
      commandLine: null,
      identityTokens: [],
    };
  }

  const pidAlive = isPidAlive(pid);
  if (!pidAlive) {
    return {
      pid,
      pidAlive: false,
      daemonAlive: false,
      identityRequired: hasIdentityMetadata(metadata),
      identityVerified: false,
      identityStatus: 'pid-not-alive',
      identityMismatchReason: null,
      commandLine: null,
      identityTokens: [],
    };
  }

  const identityRequired = hasIdentityMetadata(metadata);
  if (!identityRequired) {
    return {
      pid,
      pidAlive: true,
      daemonAlive: true,
      identityRequired: false,
      identityVerified: false,
      identityStatus: 'legacy-unverified',
      identityMismatchReason: null,
      commandLine: null,
      identityTokens: [],
    };
  }

  const commandLine = readProcessCommandLine(pid);
  if (!commandLine) {
    return {
      pid,
      pidAlive: true,
      daemonAlive: false,
      identityRequired: true,
      identityVerified: false,
      identityStatus: 'command-unavailable',
      identityMismatchReason: 'Unable to verify daemon pid ownership from process command line.',
      commandLine: null,
      identityTokens: [],
    };
  }

  const normalizedCommand = commandLine.toLowerCase();
  const identityTokens = buildIdentityTokens(metadata, pidFile);
  const missingTokens = identityTokens.filter((token) => !normalizedCommand.includes(token));
  const identityVerified = missingTokens.length === 0;
  return {
    pid,
    pidAlive: true,
    daemonAlive: identityVerified,
    identityRequired: true,
    identityVerified,
    identityStatus: identityVerified ? 'verified' : 'mismatch',
    identityMismatchReason: identityVerified
      ? null
      : `Process command line does not match daemon identity tokens: ${missingTokens.join(', ')}`,
    commandLine,
    identityTokens,
    missingTokens,
  };
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
    'mirror hedge daemon lifecycle requires --pid-file <path> or --strategy-hash <hash>.',
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
    throw createServiceError('MIRROR_HEDGE_DAEMON_CLI_PATH_REQUIRED', 'Daemon start requires the CLI path.');
  }
  if (!cliArgs.length) {
    throw createServiceError('MIRROR_HEDGE_DAEMON_CLI_ARGS_REQUIRED', 'Daemon start requires hedge run CLI arguments.');
  }

  const existing = readJsonFile(pidFile);
  const existingPid = existing ? inspectDaemonPid(existing, pidFile) : null;
  if (existingPid && existingPid.daemonAlive) {
    throw createServiceError('MIRROR_HEDGE_DAEMON_ALREADY_RUNNING', 'Mirror hedge daemon is already running for this strategy.', {
      pidFile,
      pid: existingPid.pid,
      strategyHash,
    });
  }
  if (existingPid && existingPid.pidAlive && !existingPid.daemonAlive) {
    writeJsonFile(pidFile, {
      ...existing,
      checkedAt: new Date().toISOString(),
      status: 'stale-pidfile',
      pidAlive: false,
      rawPidAlive: true,
      pidOwnerMismatch: true,
      identityVerification: {
        required: existingPid.identityRequired,
        verified: existingPid.identityVerified,
        status: existingPid.identityStatus,
        reason: existingPid.identityMismatchReason,
      },
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
    schemaVersion: MIRROR_HEDGE_DAEMON_SCHEMA_VERSION,
    daemonKind: 'mirror-hedge',
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
            code: err && err.code ? err.code : 'MIRROR_HEDGE_DAEMON_STOP_FAILED',
            message: err && err.message ? err.message : String(err),
            details: err && err.details ? err.details : null,
          },
        });
      }
    }
    return {
      schemaVersion: MIRROR_HEDGE_DAEMON_SCHEMA_VERSION,
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
    throw createServiceError('MIRROR_HEDGE_DAEMON_NOT_FOUND', `No daemon metadata found at ${pidFile}.`, { pidFile });
  }

  const pidState = inspectDaemonPid(metadata, pidFile);
  const pid = pidState.pid;
  const wasAlive = Boolean(pidState && pidState.daemonAlive);
  const pidOwnerMismatch = Boolean(pidState && pidState.pidAlive && !pidState.daemonAlive);
  if (pidOwnerMismatch) {
    const updatedStale = {
      ...metadata,
      checkedAt: new Date().toISOString(),
      pidAlive: false,
      rawPidAlive: true,
      status: 'stale-pidfile',
      stopAttemptedAt: new Date().toISOString(),
      stopSignal: null,
      stopForceSignal: null,
      stopSignalSent: false,
      stopExitObserved: false,
      stopForceKilled: false,
      pidOwnerMismatch: true,
      identityVerification: {
        required: pidState.identityRequired,
        verified: pidState.identityVerified,
        status: pidState.identityStatus,
        reason: pidState.identityMismatchReason,
      },
    };
    writeJsonFile(pidFile, updatedStale);
    return {
      schemaVersion: MIRROR_HEDGE_DAEMON_SCHEMA_VERSION,
      operationId: updatedStale.strategyHash || null,
      strategyHash: updatedStale.strategyHash || null,
      pidFile,
      pid,
      wasAlive: false,
      signalSent: false,
      forceKilled: false,
      exitObserved: false,
      alive: false,
      rawPidAlive: true,
      pidOwnerMismatch: true,
      status: updatedStale.status,
      metadata: updatedStale,
    };
  }

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
    rawPidAlive: alive,
    status: alive ? 'running' : 'stopped',
    stopAttemptedAt: new Date().toISOString(),
    stopSignal: signalSent ? 'SIGTERM' : null,
    stopForceSignal: forceKilled ? 'SIGKILL' : null,
    stopSignalSent: signalSent,
    stopExitObserved: exited,
    stopForceKilled: forceKilled,
    pidOwnerMismatch: false,
    identityVerification: {
      required: pidState.identityRequired,
      verified: pidState.identityVerified,
      status: pidState.identityStatus,
      reason: pidState.identityMismatchReason,
    },
  };
  writeJsonFile(pidFile, updated);

  return {
    schemaVersion: MIRROR_HEDGE_DAEMON_SCHEMA_VERSION,
    operationId: updated.strategyHash || null,
    strategyHash: updated.strategyHash || null,
    pidFile,
    pid,
    wasAlive,
    signalSent,
    forceKilled,
    exitObserved: exited,
    alive,
    rawPidAlive: alive,
    pidOwnerMismatch: false,
    status: updated.status,
    metadata: updated,
  };
}

function daemonStatus(options = {}) {
  const pidFile = resolvePidFile(options);
  const metadata = readJsonFile(pidFile);

  if (!metadata) {
    return {
      schemaVersion: MIRROR_HEDGE_DAEMON_SCHEMA_VERSION,
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

  const pidState = inspectDaemonPid(metadata, pidFile);
  const pid = pidState.pid;
  const alive = Boolean(pidState.daemonAlive);
  const rawPidAlive = Boolean(pidState.pidAlive);
  const status = alive
    ? 'running'
    : rawPidAlive && pidState.identityRequired
      ? 'stale-pidfile'
      : 'stopped';
  const updated = {
    ...metadata,
    checkedAt: new Date().toISOString(),
    pidAlive: alive,
    rawPidAlive,
    status,
    pidOwnerMismatch: Boolean(rawPidAlive && !alive && pidState.identityRequired),
    identityVerification: {
      required: pidState.identityRequired,
      verified: pidState.identityVerified,
      status: pidState.identityStatus,
      reason: pidState.identityMismatchReason,
    },
  };
  writeJsonFile(pidFile, updated);

  return {
    schemaVersion: MIRROR_HEDGE_DAEMON_SCHEMA_VERSION,
    found: true,
    pidFile,
    operationId: updated.strategyHash || null,
    strategyHash: updated.strategyHash || null,
    pid,
    alive,
    rawPidAlive,
    pidOwnerMismatch: Boolean(rawPidAlive && !alive && pidState.identityRequired),
    status: updated.status,
    metadata: updated,
  };
}

module.exports = {
  MIRROR_HEDGE_DAEMON_SCHEMA_VERSION,
  defaultPidFile,
  defaultLogFile,
  startDaemon,
  stopDaemon,
  daemonStatus,
  listDaemonPidFiles,
  findPidFilesByMarketAddress,
};
