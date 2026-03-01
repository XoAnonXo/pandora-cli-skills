const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const MIRROR_STATE_SCHEMA_VERSION = '1.0.0';

function expandHome(filePath) {
  if (!filePath) return filePath;
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith('~/')) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

function strategyHash(params) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(params));
  return hash.digest('hex').slice(0, 16);
}

function defaultStateFile(params) {
  const hash = strategyHash(params);
  return path.join(os.homedir(), '.pandora', 'mirror', `${hash}.json`);
}

function defaultKillSwitchFile() {
  return path.join(os.homedir(), '.pandora', 'mirror', 'STOP');
}

function ensureStateShape(raw, hash) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const resolvedHash = String(hash || data.strategyHash || '').trim() || null;
  return {
    schemaVersion: MIRROR_STATE_SCHEMA_VERSION,
    strategyHash: resolvedHash,
    startedAt: data.startedAt || new Date().toISOString(),
    pandoraMarketAddress: data.pandoraMarketAddress || null,
    polymarketMarketId: data.polymarketMarketId || null,
    polymarketSlug: data.polymarketSlug || null,
    lastTickAt: data.lastTickAt || null,
    lastResetDay: data.lastResetDay || new Date().toISOString().slice(0, 10),
    tradesToday: Number.isFinite(Number(data.tradesToday)) ? Number(data.tradesToday) : 0,
    dailySpendUsdc: Number.isFinite(Number(data.dailySpendUsdc)) ? Number(data.dailySpendUsdc) : 0,
    currentHedgeUsdc: Number.isFinite(Number(data.currentHedgeUsdc)) ? Number(data.currentHedgeUsdc) : 0,
    cumulativeLpFeesApproxUsdc: Number.isFinite(Number(data.cumulativeLpFeesApproxUsdc))
      ? Number(data.cumulativeLpFeesApproxUsdc)
      : 0,
    cumulativeHedgeNotionalUsdc: Number.isFinite(Number(data.cumulativeHedgeNotionalUsdc))
      ? Number(data.cumulativeHedgeNotionalUsdc)
      : 0,
    cumulativeHedgeCostApproxUsdc: Number.isFinite(Number(data.cumulativeHedgeCostApproxUsdc))
      ? Number(data.cumulativeHedgeCostApproxUsdc)
      : 0,
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

  let parsed = {};
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch {
    parsed = {};
  }

  return {
    filePath: resolved,
    state: ensureStateShape(parsed, hash),
  };
}

function saveState(filePath, state) {
  const resolved = path.resolve(expandHome(filePath));
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const tmpPath = `${resolved}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const serialized = JSON.stringify(state, null, 2);
  fs.writeFileSync(tmpPath, serialized, { mode: 0o600 });
  try {
    fs.renameSync(tmpPath, resolved);
    try {
      fs.chmodSync(resolved, 0o600);
    } catch {
      // best-effort permission hardening
    }
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, serialized, { mode: 0o600 });
      if (fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // ignore cleanup failure
        }
      }
    } else {
      throw err;
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
  const day = now.toISOString().slice(0, 10);
  if (state.lastResetDay !== day) {
    state.lastResetDay = day;
    state.dailySpendUsdc = 0;
    state.tradesToday = 0;
  }
}

module.exports = {
  MIRROR_STATE_SCHEMA_VERSION,
  expandHome,
  strategyHash,
  defaultStateFile,
  defaultKillSwitchFile,
  loadState,
  saveState,
  pruneIdempotencyKeys,
  resetDailyCountersIfNeeded,
};
