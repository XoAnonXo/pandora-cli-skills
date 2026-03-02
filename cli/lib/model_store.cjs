const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODEL_STORE_SCHEMA_VERSION = '1.0.0';

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

function defaultModelStoreFile() {
  return path.join(os.homedir(), '.pandora', 'models', 'models.json');
}

function normalizeIsoTimestamp(value, fallback = new Date()) {
  if (value === undefined || value === null || value === '') {
    return fallback.toISOString();
  }
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw createStoreError('MODEL_STORE_INVALID', 'Timestamp must be valid ISO-8601 date-like input.', {
      value,
    });
  }
  return new Date(parsed).toISOString();
}

function normalizeMetricEntry(input, now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createStoreError('MODEL_STORE_INVALID', 'Metric entry must be an object.', {
      input,
    });
  }

  const metric = String(input.metric || '').trim().toLowerCase();
  if (!metric) {
    throw createStoreError('MODEL_STORE_INVALID', 'Metric entry requires a metric name.', {
      metric: input.metric,
    });
  }

  const score = Number(input.score);
  if (!Number.isFinite(score) || score < 0) {
    throw createStoreError('MODEL_STORE_INVALID', 'Metric score must be a non-negative finite number.', {
      score: input.score,
    });
  }

  const sampleSize = Number(input.sampleSize);
  const windowDays = Number(input.windowDays);

  const normalized = {
    metric,
    score,
    sampleSize: Number.isInteger(sampleSize) && sampleSize >= 0 ? sampleSize : null,
    windowDays: Number.isInteger(windowDays) && windowDays > 0 ? windowDays : null,
    groupBy: input.groupBy ? String(input.groupBy) : null,
    computedAt: normalizeIsoTimestamp(input.computedAt, now),
    details:
      input.details && typeof input.details === 'object' && !Array.isArray(input.details)
        ? input.details
        : null,
  };

  return normalized;
}

function normalizeModelIdentifier(raw) {
  const value = String(raw || '').trim();
  if (!value) {
    throw createStoreError('MODEL_STORE_INVALID', 'modelId is required.', {
      modelId: raw,
    });
  }
  return value;
}

function ensureModelStoreShape(raw, now = new Date()) {
  const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const modelsRaw = data.models && typeof data.models === 'object' && !Array.isArray(data.models) ? data.models : {};

  const models = {};
  for (const [modelId, modelRaw] of Object.entries(modelsRaw)) {
    if (!modelRaw || typeof modelRaw !== 'object' || Array.isArray(modelRaw)) continue;

    const createdAt = normalizeIsoTimestamp(modelRaw.createdAt, now);
    const updatedAt = normalizeIsoTimestamp(modelRaw.updatedAt || modelRaw.createdAt, now);
    const source = modelRaw.source ? String(modelRaw.source) : null;
    const metadata = modelRaw.metadata && typeof modelRaw.metadata === 'object' && !Array.isArray(modelRaw.metadata)
      ? modelRaw.metadata
      : null;

    const scoreHistory = [];
    const rawHistory = Array.isArray(modelRaw.scoreHistory) ? modelRaw.scoreHistory : [];
    for (const historyEntry of rawHistory) {
      try {
        scoreHistory.push(normalizeMetricEntry(historyEntry, now));
      } catch {
        // skip malformed history rows
      }
    }

    const latestByMetric = {};
    const rawLatest = modelRaw.latestByMetric && typeof modelRaw.latestByMetric === 'object' && !Array.isArray(modelRaw.latestByMetric)
      ? modelRaw.latestByMetric
      : {};

    for (const [metricName, metricEntry] of Object.entries(rawLatest)) {
      try {
        latestByMetric[metricName] = normalizeMetricEntry(metricEntry, now);
      } catch {
        // skip malformed latest row
      }
    }

    models[modelId] = {
      modelId,
      source,
      createdAt,
      updatedAt,
      metadata,
      latestByMetric,
      scoreHistory,
    };
  }

  return {
    schemaVersion: MODEL_STORE_SCHEMA_VERSION,
    updatedAt: normalizeIsoTimestamp(data.updatedAt, now),
    models,
  };
}

function ensurePrivateDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // best-effort hardening
  }
}

function hardenPrivateFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort hardening
  }
}

function loadModelStore(filePath, options = {}) {
  const now = typeof options.now === 'function' ? options.now() : new Date();
  const targetFile = filePath || defaultModelStoreFile();
  const resolved = path.resolve(expandHome(targetFile));

  if (!fs.existsSync(resolved)) {
    return {
      filePath: resolved,
      exists: false,
      state: ensureModelStoreShape({}, now),
    };
  }

  let content = '';
  try {
    content = fs.readFileSync(resolved, 'utf8');
  } catch (error) {
    throw createStoreError('MODEL_STORE_READ_FAILED', `Unable to read model store: ${resolved}`, {
      filePath: resolved,
      cause: error && error.message ? error.message : String(error),
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw createStoreError('MODEL_STORE_INVALID', `Model store file is not valid JSON: ${resolved}`, {
      filePath: resolved,
      cause: error && error.message ? error.message : String(error),
    });
  }

  return {
    filePath: resolved,
    exists: true,
    state: ensureModelStoreShape(parsed, now),
  };
}

function saveModelStore(filePath, state, options = {}) {
  const now = typeof options.now === 'function' ? options.now() : new Date();
  const targetFile = filePath || defaultModelStoreFile();
  const resolved = path.resolve(expandHome(targetFile));

  const normalized = ensureModelStoreShape(state, now);
  normalized.updatedAt = now.toISOString();

  try {
    ensurePrivateDirectory(path.dirname(resolved));
    const tmpPath = `${resolved}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmpPath, resolved);
    hardenPrivateFile(resolved);
  } catch (error) {
    throw createStoreError('MODEL_STORE_WRITE_FAILED', `Unable to write model store: ${resolved}`, {
      filePath: resolved,
      cause: error && error.message ? error.message : String(error),
    });
  }

  return {
    filePath: resolved,
    state: normalized,
  };
}

function upsertModelMetric(filePath, input, options = {}) {
  const now = typeof options.now === 'function' ? options.now() : new Date();
  const maxHistory = Number.isInteger(options.maxHistory) && options.maxHistory > 0 ? options.maxHistory : 500;

  const modelId = normalizeModelIdentifier(input && input.modelId);
  const source = input && input.source ? String(input.source) : null;
  const metadata =
    input && input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? input.metadata
      : null;
  const entry = normalizeMetricEntry(input, now);

  const loaded = loadModelStore(filePath, { now: () => now });
  const state = loaded.state;

  if (!state.models[modelId]) {
    state.models[modelId] = {
      modelId,
      source,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      metadata,
      latestByMetric: {},
      scoreHistory: [],
    };
  }

  const model = state.models[modelId];
  model.updatedAt = now.toISOString();
  if (source) model.source = source;
  if (metadata) model.metadata = metadata;

  model.latestByMetric[entry.metric] = entry;
  model.scoreHistory.push(entry);
  if (model.scoreHistory.length > maxHistory) {
    model.scoreHistory = model.scoreHistory.slice(model.scoreHistory.length - maxHistory);
  }

  const saved = saveModelStore(filePath, state, { now: () => now });
  return {
    filePath: saved.filePath,
    model: saved.state.models[modelId],
  };
}

/**
 * Documented exports:
 * - defaultModelStoreFile: canonical model store path.
 * - loadModelStore/saveModelStore: persistent JSON model state with hardened permissions.
 * - upsertModelMetric: append/update model metric history and latest snapshots.
 */
module.exports = {
  MODEL_STORE_SCHEMA_VERSION,
  defaultModelStoreFile,
  ensureModelStoreShape,
  loadModelStore,
  saveModelStore,
  upsertModelMetric,
  normalizeMetricEntry,
  expandHome,
};
