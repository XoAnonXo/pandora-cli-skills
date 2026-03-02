const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FORECAST_SCHEMA_VERSION = '1.0.0';

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

function defaultForecastFile() {
  return path.join(os.homedir(), '.pandora', 'forecasts', 'forecasts.jsonl');
}

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

function normalizeIsoTimestamp(value, fallbackDate = new Date()) {
  if (value === undefined || value === null || value === '') {
    return fallbackDate.toISOString();
  }
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw createStoreError('FORECAST_INVALID_TIMESTAMP', 'Invalid forecast timestamp.', {
      value,
    });
  }
  return new Date(parsed).toISOString();
}

function normalizeProbability(raw, fieldName = 'probabilityYes') {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    throw createStoreError('FORECAST_INVALID_PROBABILITY', `${fieldName} must be numeric.`, {
      fieldName,
      value: raw,
    });
  }
  const probability = numeric > 1 && numeric <= 100 ? numeric / 100 : numeric;
  if (probability < 0 || probability > 1) {
    throw createStoreError(
      'FORECAST_INVALID_PROBABILITY',
      `${fieldName} must be between 0 and 1 (or 0-100 pct).`,
      {
        fieldName,
        value: raw,
      },
    );
  }
  return probability;
}

function normalizeOutcome(raw, fieldName = 'outcome') {
  if (raw === undefined || raw === null || raw === '') return null;

  if (typeof raw === 'boolean') {
    return raw ? 1 : 0;
  }

  if (typeof raw === 'number') {
    if (raw === 1) return 1;
    if (raw === 0) return 0;
  }

  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) return null;
    if (['1', 'true', 'yes', 'y', 'win', 'won', 'resolved_yes'].includes(normalized)) {
      return 1;
    }
    if (['0', 'false', 'no', 'n', 'lose', 'lost', 'resolved_no'].includes(normalized)) {
      return 0;
    }
  }

  throw createStoreError('FORECAST_INVALID_OUTCOME', `${fieldName} must encode a binary outcome.`, {
    fieldName,
    value: raw,
  });
}

function normalizeAddress(value) {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return /^0x[a-fA-F0-9]{40}$/.test(raw) ? raw.toLowerCase() : raw;
}

function normalizeTextOrNull(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function normalizeMetadata(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function buildRecordId(record) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify([
    record.forecastAt,
    record.source,
    record.modelId,
    record.marketAddress,
    record.marketId,
    record.competition,
    record.eventId,
    record.probabilityYes,
    record.outcome,
    record.resolvedAt,
  ]));
  return hash.digest('hex').slice(0, 20);
}

function ensurePrivateDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // best-effort permission hardening
  }
}

function hardenPrivateFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort permission hardening
  }
}

function normalizeForecastRecord(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createStoreError('FORECAST_INVALID_RECORD', 'Forecast record must be a JSON object.', {
      input,
    });
  }

  const now = typeof options.now === 'function' ? options.now() : new Date();
  const requireSource = options.requireSource !== false;
  const forecastAt = normalizeIsoTimestamp(
    pickFirstDefined(input.forecastAt, input.timestamp, input.generatedAt, input.observedAt),
    now,
  );

  const sourceRaw = pickFirstDefined(input.source, input.forecastSource, input.provider);
  const source = normalizeTextOrNull(sourceRaw);
  if (!source && requireSource) {
    throw createStoreError('FORECAST_INVALID_RECORD', 'Forecast record requires a non-empty source.', {
      source: sourceRaw,
    });
  }

  const rawProbability = pickFirstDefined(
    input.probabilityYes,
    input.yesProbability,
    input.probability,
    input.yes_price,
    input.yesPct,
    input.impliedProbability,
  );

  if (rawProbability === undefined || rawProbability === null || rawProbability === '') {
    throw createStoreError('FORECAST_INVALID_PROBABILITY', 'Forecast record must include probabilityYes/yesProbability.', {
      input,
    });
  }

  let probabilityYes = normalizeProbability(rawProbability, 'probabilityYes');
  const side = normalizeTextOrNull(input.side);
  if (side && side.toLowerCase() === 'no' && input.impliedProbability !== undefined && input.probabilityYes === undefined) {
    probabilityYes = 1 - normalizeProbability(input.impliedProbability, 'impliedProbability');
  }

  const outcome = normalizeOutcome(
    pickFirstDefined(input.outcome, input.resolvedOutcome, input.result, input.resolution),
    'outcome',
  );

  const resolvedAt = outcome === null
    ? null
    : normalizeIsoTimestamp(pickFirstDefined(input.resolvedAt, input.outcomeTimestamp, input.settledAt), now);

  const normalized = {
    schemaVersion: FORECAST_SCHEMA_VERSION,
    id: normalizeTextOrNull(input.id),
    forecastAt,
    forecastAtMs: Date.parse(forecastAt),
    source: source || 'unknown',
    modelId: normalizeTextOrNull(input.modelId),
    marketAddress: normalizeAddress(pickFirstDefined(input.marketAddress, input.market)),
    marketId: normalizeTextOrNull(input.marketId),
    competition: normalizeTextOrNull(input.competition),
    eventId: normalizeTextOrNull(pickFirstDefined(input.eventId, input.event, input.competitionEventId)),
    probabilityYes,
    probabilityNo: 1 - probabilityYes,
    outcome,
    resolvedAt,
    metadata: normalizeMetadata(input.metadata),
  };

  normalized.id = normalized.id || buildRecordId(normalized);
  return normalized;
}

function appendForecastRecord(filePath, record, options = {}) {
  const targetFile = filePath || defaultForecastFile();
  const resolved = path.resolve(expandHome(targetFile));
  const normalized = normalizeForecastRecord(record, options);

  try {
    ensurePrivateDirectory(path.dirname(resolved));
    fs.appendFileSync(resolved, `${JSON.stringify(normalized)}\n`, {
      mode: 0o600,
      flag: 'a',
    });
    hardenPrivateFile(resolved);
  } catch (error) {
    throw createStoreError('FORECAST_WRITE_FAILED', `Unable to append forecast record: ${resolved}`, {
      filePath: resolved,
      cause: error && error.message ? error.message : String(error),
    });
  }

  return {
    filePath: resolved,
    record: normalized,
  };
}

function matchesFilters(record, options = {}) {
  if (options.source && String(record.source).toLowerCase() !== String(options.source).toLowerCase()) return false;

  if (options.marketAddress) {
    const expected = normalizeAddress(options.marketAddress);
    if (normalizeAddress(record.marketAddress) !== expected) return false;
  }

  if (options.competition && record.competition !== String(options.competition)) return false;
  if (options.eventId && record.eventId !== String(options.eventId)) return false;
  if (options.modelId && record.modelId !== String(options.modelId)) return false;

  if (options.includeUnresolved === false && record.outcome === null) return false;

  if (Number.isFinite(Number(options.windowDays)) && Number(options.windowDays) > 0) {
    const now = typeof options.now === 'function' ? options.now() : new Date();
    const earliestMs = now.getTime() - Number(options.windowDays) * 24 * 60 * 60 * 1000;
    if (Number(record.forecastAtMs) < earliestMs) return false;
  }

  return true;
}

function readForecastRecords(filePath, options = {}) {
  const targetFile = filePath || defaultForecastFile();
  const resolved = path.resolve(expandHome(targetFile));

  if (!fs.existsSync(resolved)) {
    return {
      filePath: resolved,
      exists: false,
      records: [],
      invalidLineCount: 0,
      totalLineCount: 0,
    };
  }

  let content = '';
  try {
    content = fs.readFileSync(resolved, 'utf8');
  } catch (error) {
    throw createStoreError('FORECAST_READ_FAILED', `Unable to read forecast ledger: ${resolved}`, {
      filePath: resolved,
      cause: error && error.message ? error.message : String(error),
    });
  }

  const records = [];
  let invalidLineCount = 0;
  let totalLineCount = 0;
  const nowFn = typeof options.now === 'function' ? options.now : () => new Date();

  for (const line of String(content).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    totalLineCount += 1;

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      invalidLineCount += 1;
      continue;
    }

    try {
      const normalized = normalizeForecastRecord(parsed, {
        now: nowFn,
        requireSource: false,
      });
      if (matchesFilters(normalized, options)) {
        records.push(normalized);
      }
    } catch {
      invalidLineCount += 1;
    }
  }

  records.sort((left, right) => Number(left.forecastAtMs) - Number(right.forecastAtMs));
  const limit = Number(options.limit);
  const output = Number.isInteger(limit) && limit > 0 && records.length > limit
    ? records.slice(records.length - limit)
    : records;

  return {
    filePath: resolved,
    exists: true,
    records: output,
    invalidLineCount,
    totalLineCount,
  };
}

/**
 * Documented exports:
 * - defaultForecastFile: canonical forecast ledger path.
 * - normalizeForecastRecord: schema normalization for forecast rows.
 * - appendForecastRecord: append-only JSONL persistence (0o600 hardened).
 * - readForecastRecords: filtered deterministic read helper for scoring flows.
 */
module.exports = {
  FORECAST_SCHEMA_VERSION,
  defaultForecastFile,
  normalizeForecastRecord,
  appendForecastRecord,
  readForecastRecords,
  normalizeOutcome,
  normalizeProbability,
  expandHome,
};
