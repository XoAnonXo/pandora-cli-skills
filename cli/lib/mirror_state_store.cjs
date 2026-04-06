const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const MIRROR_STATE_SCHEMA_VERSION = '1.0.0';

function toFiniteNumberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeOptionalString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function ensureManagedInventorySeedShape(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    adoptedAt: normalizeOptionalString(data.adoptedAt),
    status: normalizeOptionalString(data.status),
    source: normalizeOptionalString(data.source),
    inventoryAddress: normalizeOptionalString(data.inventoryAddress),
    walletAddress: normalizeOptionalString(data.walletAddress),
    marketId: normalizeOptionalString(data.marketId),
    slug: normalizeOptionalString(data.slug),
    yesTokenId: normalizeOptionalString(data.yesTokenId),
    noTokenId: normalizeOptionalString(data.noTokenId),
    totalYesShares: toFiniteNumberOrNull(data.totalYesShares),
    totalNoShares: toFiniteNumberOrNull(data.totalNoShares),
    reservedYesShares: toFiniteNumberOrNull(data.reservedYesShares),
    reservedNoShares: toFiniteNumberOrNull(data.reservedNoShares),
    yesShares: toFiniteNumberOrNull(data.yesShares),
    noShares: toFiniteNumberOrNull(data.noShares),
    yesUsdc: toFiniteNumberOrNull(data.yesUsdc),
    noUsdc: toFiniteNumberOrNull(data.noUsdc),
    netUsdc: toFiniteNumberOrNull(data.netUsdc),
    estimatedValueUsdc: toFiniteNumberOrNull(data.estimatedValueUsdc),
    openOrdersCount: toFiniteNumberOrNull(data.openOrdersCount),
    diagnostics: Array.isArray(data.diagnostics) ? data.diagnostics.map((entry) => String(entry)) : [],
  };
}

function ensureStartupHedgeBaselineShape(raw) {
  const data = raw && typeof raw === 'object' ? raw : null;
  if (!data) return null;
  const baselineUsdc = toFiniteNumberOrNull(
    data.baselineUsdc !== undefined
      ? data.baselineUsdc
      : data.rawGapUsdc !== undefined
        ? data.rawGapUsdc
        : data.gapUsdc,
  );
  if (baselineUsdc === null) return null;
  return {
    baselineUsdc,
    capturedAt: normalizeOptionalString(data.capturedAt),
    source: normalizeOptionalString(data.source) || 'skip-initial-hedge',
  };
}

function ensureAccountingShape(raw) {
  const data = raw && typeof raw === 'object' ? raw : null;
  if (!data) return null;
  const managedPolymarketYesShares =
    data.managedPolymarketYesShares !== undefined
      ? toFiniteNumberOrNull(data.managedPolymarketYesShares)
      : data.managedPolymarketYesUsdc !== undefined
        ? toFiniteNumberOrNull(data.managedPolymarketYesUsdc)
        : undefined;
  const managedPolymarketNoShares =
    data.managedPolymarketNoShares !== undefined
      ? toFiniteNumberOrNull(data.managedPolymarketNoShares)
      : data.managedPolymarketNoUsdc !== undefined
        ? toFiniteNumberOrNull(data.managedPolymarketNoUsdc)
        : undefined;
  return {
    ...data,
    pandoraInventoryAddress: normalizeOptionalString(data.pandoraInventoryAddress),
    pandoraWalletYesUsdc:
      data.pandoraWalletYesUsdc === undefined ? undefined : toFiniteNumberOrNull(data.pandoraWalletYesUsdc),
    pandoraWalletNoUsdc:
      data.pandoraWalletNoUsdc === undefined ? undefined : toFiniteNumberOrNull(data.pandoraWalletNoUsdc),
    pandoraWalletReadAt: normalizeOptionalString(data.pandoraWalletReadAt),
    pandoraWalletSource: normalizeOptionalString(data.pandoraWalletSource),
    pandoraOutcomeYesToken: normalizeOptionalString(data.pandoraOutcomeYesToken),
    pandoraOutcomeNoToken: normalizeOptionalString(data.pandoraOutcomeNoToken),
    polymarketInventoryAddress: normalizeOptionalString(data.polymarketInventoryAddress),
    managedPolymarketYesShares,
    managedPolymarketNoShares,
    managedPolymarketYesUsdc:
      managedPolymarketYesShares,
    managedPolymarketNoUsdc:
      managedPolymarketNoShares,
    managedInventorySeed: ensureManagedInventorySeedShape(data.managedInventorySeed),
  };
}

function resolveHomeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || '.';
}

function expandHome(filePath) {
  if (!filePath) return filePath;
  if (filePath === '~') return resolveHomeDir();
  if (filePath.startsWith('~/')) return path.join(resolveHomeDir(), filePath.slice(2));
  return filePath;
}

function strategyHash(params) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(params));
  return hash.digest('hex').slice(0, 16);
}

function defaultStateFile(params) {
  const hash = strategyHash(params);
  return path.join(resolveHomeDir(), '.pandora', 'mirror', `${hash}.json`);
}

function defaultKillSwitchFile() {
  return path.join(resolveHomeDir(), '.pandora', 'mirror', 'STOP');
}

function ensureStateShape(raw, hash) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const resolvedHash = String(hash || data.strategyHash || '').trim() || null;
  const startupHedgeBaseline = ensureStartupHedgeBaselineShape(
    data.startupHedgeBaseline
    || (data.startupHedgeBaselineUsdc !== undefined
      ? {
          baselineUsdc: data.startupHedgeBaselineUsdc,
          capturedAt: data.startupHedgeBaselineCapturedAt,
          source: data.startupHedgeBaselineSource,
        }
      : null),
  );
  const currentHedgeShares =
    Number.isFinite(Number(data.currentHedgeShares))
      ? Number(data.currentHedgeShares)
      : Number.isFinite(Number(data.currentHedgeUsdc))
        ? Number(data.currentHedgeUsdc)
        : 0;
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
    currentHedgeShares,
    currentHedgeUsdc: currentHedgeShares,
    cumulativeLpFeesApproxUsdc: Number.isFinite(Number(data.cumulativeLpFeesApproxUsdc))
      ? Number(data.cumulativeLpFeesApproxUsdc)
      : 0,
    cumulativeHedgeNotionalUsdc: Number.isFinite(Number(data.cumulativeHedgeNotionalUsdc))
      ? Number(data.cumulativeHedgeNotionalUsdc)
      : 0,
    cumulativeHedgeCostApproxUsdc: Number.isFinite(Number(data.cumulativeHedgeCostApproxUsdc))
      ? Number(data.cumulativeHedgeCostApproxUsdc)
      : 0,
    accounting: ensureAccountingShape(data.accounting),
    startupHedgeBaseline,
    startupHedgeBaselineUsdc: startupHedgeBaseline ? startupHedgeBaseline.baselineUsdc : null,
    startupHedgeBaselineCapturedAt: startupHedgeBaseline ? startupHedgeBaseline.capturedAt : null,
    startupHedgeBaselineSource: startupHedgeBaseline ? startupHedgeBaseline.source : null,
    lastExecution: data.lastExecution || null,
    idempotencyKeys: Array.isArray(data.idempotencyKeys) ? data.idempotencyKeys : [],
    alerts: Array.isArray(data.alerts) ? data.alerts : [],
  };
}

function createState(hash = null, raw = {}) {
  return ensureStateShape(raw, hash);
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
  toFiniteNumberOrNull,
  normalizeOptionalString,
  strategyHash,
  defaultStateFile,
  defaultKillSwitchFile,
  createState,
  loadState,
  saveState,
  pruneIdempotencyKeys,
  resetDailyCountersIfNeeded,
};
