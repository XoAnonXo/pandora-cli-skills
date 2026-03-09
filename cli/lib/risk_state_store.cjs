const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RISK_SCHEMA_VERSION = '1.0.0';

function createStoreError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function expandHome(filePath) {
  if (!filePath) return filePath;
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith('~/')) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

function defaultRiskFile() {
  return path.join(os.homedir(), '.pandora', 'risk.json');
}

function coerceNullablePositiveNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

function coerceNullablePositiveInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.trunc(numeric);
}

function coerceNonNegativeNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return numeric;
}

function coerceNonNegativeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return Math.trunc(numeric);
}

function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

function coerceBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
  }
  return Boolean(value);
}

function coerceIsoStringOrNull(value) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    return null;
  }
  return value;
}

function ensureRiskStateShape(raw, now = new Date()) {
  const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const panic = data.panic && typeof data.panic === 'object' && !Array.isArray(data.panic) ? data.panic : {};
  const guardrails =
    data.guardrails && typeof data.guardrails === 'object' && !Array.isArray(data.guardrails)
      ? data.guardrails
      : {};
  const metadata =
    data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata) ? data.metadata : {};
  const counters = data.counters && typeof data.counters === 'object' && !Array.isArray(data.counters) ? data.counters : {};

  const maxPositionUsd = coerceNullablePositiveNumber(
    pickFirstDefined(data.max_position_usd, data.maxPositionUsd, guardrails.maxSingleLiveNotionalUsdc),
  );
  const maxDailyLossUsd = coerceNullablePositiveNumber(
    pickFirstDefined(data.max_daily_loss_usd, data.maxDailyLossUsd, guardrails.maxDailyLiveNotionalUsdc),
  );
  const maxOpenMarkets = coerceNullablePositiveInteger(
    pickFirstDefined(data.max_open_markets, data.maxOpenMarkets, guardrails.maxDailyLiveOps),
  );
  const killSwitch = coerceBoolean(pickFirstDefined(data.kill_switch, data.killSwitch, panic.active), false);

  const normalizedMetadata = {
    reason:
      pickFirstDefined(metadata.reason, metadata.panicReason, panic.reason) === null ||
      pickFirstDefined(metadata.reason, metadata.panicReason, panic.reason) === undefined
        ? null
        : String(pickFirstDefined(metadata.reason, metadata.panicReason, panic.reason)),
    engaged_at: coerceIsoStringOrNull(
      pickFirstDefined(metadata.engaged_at, metadata.engagedAt, panic.engagedAt, panic.triggeredAt),
    ),
    engaged_by:
      pickFirstDefined(metadata.engaged_by, metadata.engagedBy, panic.engagedBy, panic.triggeredBy) === null ||
      pickFirstDefined(metadata.engaged_by, metadata.engagedBy, panic.engagedBy, panic.triggeredBy) === undefined
        ? null
        : String(pickFirstDefined(metadata.engaged_by, metadata.engagedBy, panic.engagedBy, panic.triggeredBy)),
    cleared_at: coerceIsoStringOrNull(pickFirstDefined(metadata.cleared_at, metadata.clearedAt, panic.clearedAt)),
    cleared_by:
      pickFirstDefined(metadata.cleared_by, metadata.clearedBy, panic.clearedBy) === null ||
      pickFirstDefined(metadata.cleared_by, metadata.clearedBy, panic.clearedBy) === undefined
        ? null
        : String(pickFirstDefined(metadata.cleared_by, metadata.clearedBy, panic.clearedBy)),
  };

  return {
    schemaVersion: RISK_SCHEMA_VERSION,
    updatedAt:
      typeof data.updatedAt === 'string' && !Number.isNaN(Date.parse(data.updatedAt)) ? data.updatedAt : now.toISOString(),
    max_position_usd: maxPositionUsd,
    max_daily_loss_usd: maxDailyLossUsd,
    max_open_markets: maxOpenMarkets,
    kill_switch: killSwitch,
    metadata: normalizedMetadata,
    panic: {
      active: killSwitch,
      reason: normalizedMetadata.reason,
      engagedAt: normalizedMetadata.engaged_at,
      engagedBy: normalizedMetadata.engaged_by,
      clearedAt: normalizedMetadata.cleared_at,
      clearedBy: normalizedMetadata.cleared_by,
    },
    guardrails: {
      enabled: guardrails.enabled !== false,
      maxSingleLiveNotionalUsdc: maxPositionUsd,
      maxDailyLiveNotionalUsdc: maxDailyLossUsd,
      maxDailyLiveOps: maxOpenMarkets,
      blockForkExecute: coerceBoolean(guardrails.blockForkExecute, false),
    },
    counters: {
      day:
        typeof counters.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(counters.day)
          ? counters.day
          : todayIso(now),
      liveNotionalUsdc: coerceNonNegativeNumber(counters.liveNotionalUsdc, 0),
      liveOps: coerceNonNegativeInteger(counters.liveOps, 0),
    },
  };
}

function loadRiskState(filePath, options = {}) {
  const now = typeof options.now === 'function' ? options.now() : new Date();
  const targetFile = filePath || defaultRiskFile();
  const resolved = path.resolve(expandHome(targetFile));
  if (!fs.existsSync(resolved)) {
    return {
      filePath: resolved,
      exists: false,
      state: ensureRiskStateShape({}, now),
    };
  }

  let content = '';
  try {
    content = fs.readFileSync(resolved, 'utf8');
  } catch (error) {
    throw createStoreError('RISK_STATE_READ_FAILED', `Unable to read risk state file: ${resolved}`, {
      filePath: resolved,
      cause: error && error.message ? error.message : String(error),
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw createStoreError('RISK_STATE_INVALID', `Risk state file is not valid JSON: ${resolved}`, {
      filePath: resolved,
      cause: error && error.message ? error.message : String(error),
    });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createStoreError('RISK_STATE_INVALID', `Risk state file must contain a JSON object: ${resolved}`, {
      filePath: resolved,
    });
  }

  return {
    filePath: resolved,
    exists: true,
    state: ensureRiskStateShape(parsed, now),
  };
}

function saveRiskState(filePath, state, options = {}) {
  const now = typeof options.now === 'function' ? options.now() : new Date();
  const targetFile = filePath || defaultRiskFile();
  const resolved = path.resolve(expandHome(targetFile));
  const normalized = ensureRiskStateShape(state, now);
  normalized.updatedAt = now.toISOString();

  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    const tmpPath = `${resolved}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(normalized, null, 2), { mode: 0o600 });
    fs.renameSync(tmpPath, resolved);
    try {
      fs.chmodSync(resolved, 0o600);
    } catch {
      // best-effort permission hardening
    }
  } catch (error) {
    throw createStoreError('RISK_STATE_WRITE_FAILED', `Unable to write risk state file: ${resolved}`, {
      filePath: resolved,
      cause: error && error.message ? error.message : String(error),
    });
  }

  return {
    filePath: resolved,
    state: normalized,
  };
}

function touchPanicStopFiles(options = {}) {
  const autopilotStopFile =
    typeof options.autopilotStopFile === 'string' && options.autopilotStopFile.trim()
      ? options.autopilotStopFile.trim()
      : path.join(os.homedir(), '.pandora', 'autopilot', 'STOP');
  const mirrorStopFile =
    typeof options.mirrorStopFile === 'string' && options.mirrorStopFile.trim()
      ? options.mirrorStopFile.trim()
      : path.join(os.homedir(), '.pandora', 'mirror', 'STOP');

  const targets = [autopilotStopFile, mirrorStopFile];
  const touched = [];

  for (const target of targets) {
    const resolved = path.resolve(expandHome(target));
    try {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, `${new Date().toISOString()} panic\n`, { mode: 0o600 });
      try {
        fs.chmodSync(resolved, 0o600);
      } catch {
        // best-effort permission hardening
      }
      touched.push(resolved);
    } catch (error) {
      throw createStoreError('RISK_STATE_WRITE_FAILED', `Unable to write panic stop file: ${resolved}`, {
        filePath: resolved,
        cause: error && error.message ? error.message : String(error),
      });
    }
  }

  return touched;
}

module.exports = {
  RISK_SCHEMA_VERSION,
  defaultRiskFile,
  expandHome,
  ensureRiskStateShape,
  loadRiskState,
  saveRiskState,
  touchPanicStopFiles,
};
