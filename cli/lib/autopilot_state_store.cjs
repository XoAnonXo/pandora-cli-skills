const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { isMcpMode } = require('./shared/mcp_path_guard.cjs');

const AUTOPILOT_SCHEMA_VERSION = '1.0.0';

function expandHome(filePath) {
  if (!filePath) return filePath;
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith('~/')) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

function defaultKillSwitchFile() {
  if (isMcpMode()) {
    return path.resolve(process.cwd(), '.pandora', 'autopilot', 'STOP');
  }
  return path.join(os.homedir(), '.pandora', 'autopilot', 'STOP');
}

function strategyHash(params) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(params));
  return hash.digest('hex').slice(0, 16);
}

function defaultStateFile(params) {
  const hash = strategyHash(params);
  if (isMcpMode()) {
    return path.resolve(process.cwd(), '.pandora', 'autopilot', `${hash}.json`);
  }
  return path.join(os.homedir(), '.pandora', 'autopilot', `${hash}.json`);
}

function ensureStateShape(raw, hash) {
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    schemaVersion: AUTOPILOT_SCHEMA_VERSION,
    strategyHash: hash,
    startedAt: data.startedAt || new Date().toISOString(),
    lastTickAt: data.lastTickAt || null,
    dailySpendUsdc: Number.isFinite(Number(data.dailySpendUsdc)) ? Number(data.dailySpendUsdc) : 0,
    tradesToday: Number.isFinite(Number(data.tradesToday)) ? Number(data.tradesToday) : 0,
    lastResetDay: data.lastResetDay || new Date().toISOString().slice(0, 10),
    lastExecution: data.lastExecution || null,
    idempotencyKeys: Array.isArray(data.idempotencyKeys) ? data.idempotencyKeys : [],
    alerts: Array.isArray(data.alerts) ? data.alerts : [],
  };
}

function loadState(filePath, hash) {
  const resolved = path.resolve(expandHome(filePath));
  if (!fs.existsSync(resolved)) {
    return {
      filePath: resolved,
      state: ensureStateShape({}, hash),
    };
  }

  const content = fs.readFileSync(resolved, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }

  return {
    filePath: resolved,
    state: ensureStateShape(parsed, hash),
  };
}

function sleepSync(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const shared = new SharedArrayBuffer(4);
  const view = new Int32Array(shared);
  Atomics.wait(view, 0, 0, Math.max(1, Math.floor(ms)));
}

function acquireLock(lockPath, options = {}) {
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 2_000;
  const pollMs = Number.isFinite(Number(options.pollMs)) ? Number(options.pollMs) : 10;
  const staleMs = Number.isFinite(Number(options.staleMs)) ? Number(options.staleMs) : 5 * 60 * 1000;
  const deadline = Date.now() + Math.max(50, timeoutMs);

  while (true) {
    try {
      return fs.openSync(lockPath, 'wx');
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err;

      try {
        const stats = fs.statSync(lockPath);
        const ageMs = Date.now() - stats.mtimeMs;
        if (Number.isFinite(ageMs) && ageMs > staleMs) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // best-effort stale lock cleanup
      }

      if (Date.now() >= deadline) {
        throw new Error(`Unable to acquire state lock within ${timeoutMs}ms: ${lockPath}`);
      }
      sleepSync(pollMs);
    }
  }
}

function saveState(filePath, state) {
  const resolved = path.resolve(expandHome(filePath));
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const lockPath = `${resolved}.lock`;
  const lockFd = acquireLock(lockPath);
  try {
    const tmp = `${resolved}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, resolved);
    try {
      fs.chmodSync(resolved, 0o600);
    } catch {
      // best-effort permission hardening
    }
  } finally {
    try {
      fs.closeSync(lockFd);
    } catch {
      // ignore lock close failures
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // ignore lock cleanup failures
    }
  }
  return resolved;
}

function pruneIdempotencyKeys(state, maxSize = 500) {
  if (!Array.isArray(state.idempotencyKeys)) {
    state.idempotencyKeys = [];
    return;
  }

  if (state.idempotencyKeys.length <= maxSize) return;
  state.idempotencyKeys = state.idempotencyKeys.slice(state.idempotencyKeys.length - maxSize);
}

function resetDailyCountersIfNeeded(state, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  if (state.lastResetDay !== today) {
    state.dailySpendUsdc = 0;
    state.tradesToday = 0;
    state.lastResetDay = today;
  }
}

module.exports = {
  AUTOPILOT_SCHEMA_VERSION,
  defaultStateFile,
  defaultKillSwitchFile,
  strategyHash,
  expandHome,
  loadState,
  saveState,
  pruneIdempotencyKeys,
  resetDailyCountersIfNeeded,
};
