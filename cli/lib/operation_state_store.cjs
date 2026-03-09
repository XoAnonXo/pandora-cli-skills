const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { isMcpMode } = require('./shared/mcp_path_guard.cjs');
const {
  OPERATION_STATE_SCHEMA_VERSION,
  normalizeIsoTimestamp,
  normalizeOperationState,
  applyOperationLifecycleState,
  validateOperationTransition,
} = require('./shared/operation_states.cjs');
const {
  buildOperationHashInput,
  buildOperationHash,
  buildOperationId,
  normalizeOperationHash,
  normalizeOperationId,
} = require('./shared/operation_hash.cjs');

const OPERATION_STORE_SCHEMA_VERSION = OPERATION_STATE_SCHEMA_VERSION;
const OPERATION_CHECKPOINT_SCHEMA_VERSION = '1.0.0';
const OPERATION_RECEIPT_SCHEMA_VERSION = '1.0.0';

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

function defaultOperationsDir() {
  const configuredRoot = normalizeTextOrNull(process.env.PANDORA_OPERATION_DIR || process.env.PANDORA_OPERATIONS_DIR);
  if (configuredRoot) {
    return configuredRoot;
  }
  if (isMcpMode()) {
    return path.resolve(process.cwd(), '.pandora', 'operations');
  }
  return path.join(os.homedir(), '.pandora', 'operations');
}

function resolveOperationsDir(rootDir) {
  return path.resolve(expandHome(rootDir || defaultOperationsDir()));
}

function defaultOperationStateFile(operationId, options = {}) {
  const rootDir = resolveOperationsDir(options.rootDir);
  const normalizedId = normalizeOperationId(operationId);
  return path.join(rootDir, `${normalizedId}.json`);
}

function defaultOperationCheckpointFile(operationId, options = {}) {
  const rootDir = resolveOperationsDir(options.rootDir);
  const normalizedId = normalizeOperationId(operationId);
  return path.join(rootDir, `${normalizedId}.checkpoints.jsonl`);
}

function defaultOperationReceiptFile(operationId, options = {}) {
  const rootDir = resolveOperationsDir(options.rootDir);
  const normalizedId = normalizeOperationId(operationId);
  return path.join(rootDir, `${normalizedId}.receipt.json`);
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
  ensurePrivateDirectory(path.dirname(lockPath));

  while (true) {
    try {
      return fs.openSync(lockPath, 'wx');
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;

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
        throw createStoreError('OPERATION_STORE_LOCK_TIMEOUT', `Unable to acquire operation store lock: ${lockPath}`, {
          lockPath,
          timeoutMs,
        });
      }
      sleepSync(pollMs);
    }
  }
}

function releaseLock(lockPath, lockFd) {
  try {
    fs.closeSync(lockFd);
  } catch {
    // ignore close failures
  }
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // ignore cleanup failures
  }
}

function withFileLock(lockPath, options, fn) {
  const lockFd = acquireLock(lockPath, options);
  try {
    return fn();
  } finally {
    releaseLock(lockPath, lockFd);
  }
}

function atomicWriteJson(filePath, payload) {
  ensurePrivateDirectory(path.dirname(filePath));
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  fs.writeFileSync(tempFile, serialized, { mode: 0o600 });
  fs.renameSync(tempFile, filePath);
  hardenPrivateFile(filePath);
  return filePath;
}

function appendJsonLine(filePath, payload) {
  ensurePrivateDirectory(path.dirname(filePath));
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  fs.writeFileSync(tempFile, `${existing}${JSON.stringify(payload)}\n`, { mode: 0o600 });
  fs.renameSync(tempFile, filePath);
  hardenPrivateFile(filePath);
  return filePath;
}

function atomicWriteJsonLines(filePath, entries) {
  ensurePrivateDirectory(path.dirname(filePath));
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const serialized = Array.isArray(entries) && entries.length
    ? `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
    : '';
  fs.writeFileSync(tempFile, serialized, { mode: 0o600 });
  fs.renameSync(tempFile, filePath);
  hardenPrivateFile(filePath);
  return filePath;
}

function readJsonFile(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    return options.missingOk === false
      ? (() => {
          throw createStoreError('OPERATION_NOT_FOUND', `Operation file not found: ${filePath}`, { filePath });
        })()
      : null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw createStoreError('OPERATION_STORE_INVALID_STATE_FILE', `Unable to parse operation state file: ${filePath}`, {
      filePath,
      cause: error && error.message ? error.message : String(error),
    });
  }
}

function cloneJsonValue(value, options = {}) {
  if (value === undefined) {
    return options.keepUndefined === true ? undefined : null;
  }
  if (value === null) return null;
  if (value instanceof Error) {
    return {
      code: value.code || null,
      message: value.message || String(value),
      details: value.details !== undefined ? cloneJsonValue(value.details) : null,
    };
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw createStoreError('OPERATION_STORE_INVALID_JSON', 'Operation payload must be JSON-serializable.', {
      cause: error && error.message ? error.message : String(error),
    });
  }
}

function pickDefined(...values) {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

function normalizeTextOrNull(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeStringList(value) {
  if (value === undefined) return undefined;
  if (value === null) return [];
  const source = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const normalized = [];
  for (const entry of source) {
    const text = normalizeTextOrNull(entry);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

function normalizePositiveInteger(value, fieldName, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    throw createStoreError('OPERATION_STORE_INVALID_NUMBER', `${fieldName} must be a non-negative integer.`, {
      fieldName,
      value,
    });
  }
  return numeric;
}

function normalizeReference(ref) {
  if (ref && typeof ref === 'object') {
    return {
      operationId: normalizeOperationId(ref.operationId, { allowNull: true }),
      operationHash: normalizeOperationHash(ref.operationHash, { allowNull: true }),
    };
  }

  const raw = normalizeTextOrNull(ref);
  if (!raw) {
    return { operationId: null, operationHash: null };
  }

  let operationId = null;
  let operationHash = null;
  try {
    operationId = normalizeOperationId(raw, { allowNull: true });
  } catch {
    operationId = null;
  }
  try {
    operationHash = normalizeOperationHash(raw, { allowNull: true });
  } catch {
    operationHash = null;
  }
  return { operationId, operationHash };
}

function deriveOperationHashSource(input, existing) {
  const data = input && typeof input === 'object' ? input : {};
  if (data.hashSource !== undefined) return data.hashSource;
  if (data.identity !== undefined) return data.identity;
  return buildOperationHashInput(data, existing);
}

function normalizeOperationRecord(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createStoreError('OPERATION_STORE_INVALID_INPUT', 'Operation record must be a JSON object.', {
      input,
    });
  }

  const existing = options.existing && typeof options.existing === 'object' ? options.existing : null;
  const isUpdate = Boolean(existing);
  const nowDate = options.now !== undefined && options.now !== null ? new Date(options.now) : new Date();
  const nowIso = normalizeIsoTimestamp(undefined, nowDate);
  const command = normalizeTextOrNull(pickDefined(input.command, existing && existing.command));
  const parentOperationId = normalizeOperationId(
    pickDefined(input.parentOperationId, existing && existing.parentOperationId),
    { allowNull: true },
  );
  const target = cloneJsonValue(pickDefined(input.target, existing && existing.target), { keepUndefined: true });
  const scope = normalizeTextOrNull(pickDefined(input.scope, existing && existing.scope));
  const policyPack = normalizeTextOrNull(pickDefined(input.policyPack, existing && existing.policyPack));
  const profile = normalizeTextOrNull(pickDefined(input.profile, existing && existing.profile));
  const environment = normalizeTextOrNull(pickDefined(input.environment, existing && existing.environment));
  const mode = normalizeTextOrNull(pickDefined(input.mode, existing && existing.mode));
  const summary = normalizeTextOrNull(pickDefined(input.summary, existing && existing.summary));
  const description = normalizeTextOrNull(pickDefined(input.description, existing && existing.description));
  const request = cloneJsonValue(
    pickDefined(input.request, input.input, input.payload, input.args, existing && existing.request),
    { keepUndefined: true },
  );
  const result = cloneJsonValue(pickDefined(input.result, existing && existing.result), { keepUndefined: true });
  const recovery = cloneJsonValue(pickDefined(input.recovery, existing && existing.recovery), { keepUndefined: true });
  const error = cloneJsonValue(pickDefined(input.error, existing && existing.error), { keepUndefined: true });
  const cancellation = cloneJsonValue(
    pickDefined(input.cancellation, existing && existing.cancellation),
    { keepUndefined: true },
  );
  const closure = cloneJsonValue(pickDefined(input.closure, existing && existing.closure), { keepUndefined: true });
  const metadata = cloneJsonValue(pickDefined(input.metadata, existing && existing.metadata), { keepUndefined: true });
  const runtime = cloneJsonValue(pickDefined(input.runtime, existing && existing.runtime), { keepUndefined: true });
  const tags = normalizeStringList(pickDefined(input.tags, existing && existing.tags));
  const operationHash = normalizeOperationHash(
    pickDefined(input.operationHash, existing && existing.operationHash)
      || buildOperationHash(deriveOperationHashSource(input, existing), { namespace: 'pandora.operation' }),
  );
  const operationId = normalizeOperationId(
    pickDefined(input.operationId, existing && existing.operationId)
      || buildOperationId({ command, operationHash }, { prefix: command || 'op', operationHash }),
  );
  const requestedStatus = pickDefined(input.status, input.state, existing ? existing.status : undefined, 'planned');
  const lifecycleSeed = existing ? { ...existing } : { operationId, operationHash, command };
  const lifecycle = applyOperationLifecycleState(lifecycleSeed, requestedStatus, {
    now: nowIso,
    allowUnknownCurrent: true,
  });

  const checkpointCount = normalizePositiveInteger(
    pickDefined(input.checkpointCount, existing && existing.checkpointCount),
    'checkpointCount',
    0,
  );
  const lastCheckpointAtRaw = pickDefined(input.lastCheckpointAt, existing && existing.lastCheckpointAt);
  const lastCheckpointAt = lastCheckpointAtRaw ? normalizeIsoTimestamp(lastCheckpointAtRaw) : null;
  const latestCheckpoint = cloneJsonValue(
    pickDefined(input.latestCheckpoint, existing && existing.latestCheckpoint),
    { keepUndefined: true },
  );
  const preferTimestamp = (nextValue, persistedValue, fallbackValue = null) => {
    if (isUpdate) {
      return nextValue ?? persistedValue ?? fallbackValue;
    }
    return persistedValue ?? nextValue ?? fallbackValue;
  };

  return {
    schemaVersion: OPERATION_STORE_SCHEMA_VERSION,
    operationId,
    operationHash,
    command,
    summary,
    description,
    status: normalizeOperationState(lifecycle.status),
    createdAt: normalizeIsoTimestamp(preferTimestamp(lifecycle.createdAt, input.createdAt, nowIso)),
    updatedAt: normalizeIsoTimestamp(preferTimestamp(lifecycle.updatedAt, input.updatedAt, nowIso)),
    validatedAt: preferTimestamp(lifecycle.validatedAt, input.validatedAt)
      ? normalizeIsoTimestamp(preferTimestamp(lifecycle.validatedAt, input.validatedAt))
      : null,
    queuedAt: preferTimestamp(lifecycle.queuedAt, input.queuedAt)
      ? normalizeIsoTimestamp(preferTimestamp(lifecycle.queuedAt, input.queuedAt))
      : null,
    startedAt: preferTimestamp(lifecycle.startedAt, input.startedAt)
      ? normalizeIsoTimestamp(preferTimestamp(lifecycle.startedAt, input.startedAt))
      : null,
    pausedAt: preferTimestamp(lifecycle.pausedAt, input.pausedAt)
      ? normalizeIsoTimestamp(preferTimestamp(lifecycle.pausedAt, input.pausedAt))
      : null,
    completedAt: preferTimestamp(lifecycle.completedAt, input.completedAt)
      ? normalizeIsoTimestamp(preferTimestamp(lifecycle.completedAt, input.completedAt))
      : null,
    succeededAt: preferTimestamp(lifecycle.succeededAt, input.succeededAt)
      ? normalizeIsoTimestamp(preferTimestamp(lifecycle.succeededAt, input.succeededAt))
      : null,
    failedAt: preferTimestamp(lifecycle.failedAt, input.failedAt)
      ? normalizeIsoTimestamp(preferTimestamp(lifecycle.failedAt, input.failedAt))
      : null,
    cancelledAt: preferTimestamp(lifecycle.cancelledAt, input.cancelledAt ?? input.canceledAt)
      ? normalizeIsoTimestamp(preferTimestamp(lifecycle.cancelledAt, input.cancelledAt ?? input.canceledAt))
      : null,
    closedAt: preferTimestamp(lifecycle.closedAt, input.closedAt)
      ? normalizeIsoTimestamp(preferTimestamp(lifecycle.closedAt, input.closedAt))
      : null,
    parentOperationId,
    policyPack,
    profile,
    environment,
    mode,
    scope,
    target: target === undefined ? null : target,
    request: request === undefined ? null : request,
    result: result === undefined ? null : result,
    recovery: recovery === undefined ? null : recovery,
    error: error === undefined ? null : error,
    cancellation: cancellation === undefined ? null : cancellation,
    closure: closure === undefined ? null : closure,
    metadata: metadata === undefined ? null : metadata,
    runtime: runtime === undefined ? null : runtime,
    tags: tags === undefined ? [] : tags,
    checkpointCount,
    lastCheckpointAt,
    latestCheckpoint: latestCheckpoint === undefined ? null : latestCheckpoint,
  };
}

function summarizeCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object') return null;
  return {
    index: Number.isInteger(checkpoint.index) ? checkpoint.index : null,
    at: checkpoint.at || null,
    kind: checkpoint.kind || null,
    label: checkpoint.label || null,
    status: checkpoint.status || null,
    code: checkpoint.code || null,
    message: checkpoint.message || null,
    progress: typeof checkpoint.progress === 'number' ? checkpoint.progress : null,
  };
}

function collectCheckpointInputs(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  const checkpoints = [];
  if (input.checkpoint !== undefined) {
    checkpoints.push(input.checkpoint);
  }
  if (Array.isArray(input.checkpoints)) {
    checkpoints.push(...input.checkpoints);
  }
  return checkpoints;
}

function materializeCheckpointState(operation, checkpointInputs, existingCheckpoints = [], options = {}) {
  const inputs = Array.isArray(checkpointInputs) ? checkpointInputs : [];
  const persistedCheckpoints = Array.isArray(existingCheckpoints) ? existingCheckpoints.slice() : [];
  if (inputs.length === 0) {
    return {
      checkpoints: persistedCheckpoints,
      operation,
    };
  }
  const normalizedNew = inputs.map((entry, index) => {
    const payload = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? { ...entry }
      : { label: String(entry || ''), kind: 'note' };
    if (!payload.status && options.defaultStatus) {
      payload.status = options.defaultStatus;
    }
    return normalizeCheckpointRecord(payload, {
      operation,
      index: persistedCheckpoints.length + index + 1,
      now: options.now,
    });
  });
  const checkpoints = persistedCheckpoints.concat(normalizedNew);
  const latestCheckpoint = normalizedNew[normalizedNew.length - 1];
  return {
    checkpoints,
    operation: normalizeOperationRecord({
      ...operation,
      checkpointCount: checkpoints.length,
      lastCheckpointAt: latestCheckpoint.at,
      latestCheckpoint: summarizeCheckpoint(latestCheckpoint),
    }, {
      existing: operation,
      now: latestCheckpoint.at,
    }),
  };
}

function normalizeCheckpointRecord(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createStoreError('OPERATION_CHECKPOINT_INVALID', 'Checkpoint payload must be a JSON object.', {
      input,
    });
  }

  const operation = options.operation;
  if (!operation || typeof operation !== 'object') {
    throw createStoreError('OPERATION_CHECKPOINT_INVALID', 'Checkpoint normalization requires an operation record.', {
      input,
    });
  }

  const now = normalizeIsoTimestamp(options.now);
  const index = normalizePositiveInteger(options.index, 'checkpoint.index', 0);
  const statusRaw = pickDefined(input.status, input.state, operation.status);
  const progressRaw = pickDefined(input.progress, input.percent, input.progressPct);
  let progress = null;
  if (progressRaw !== undefined && progressRaw !== null && progressRaw !== '') {
    const numeric = Number(progressRaw);
    if (!Number.isFinite(numeric)) {
      throw createStoreError('OPERATION_CHECKPOINT_INVALID', 'Checkpoint progress must be numeric when provided.', {
        value: progressRaw,
      });
    }
    progress = numeric > 1 && numeric <= 100 ? numeric / 100 : numeric;
    if (progress < 0 || progress > 1) {
      throw createStoreError('OPERATION_CHECKPOINT_INVALID', 'Checkpoint progress must be between 0 and 1 (or 0-100 pct).', {
        value: progressRaw,
      });
    }
  }

  return {
    schemaVersion: OPERATION_CHECKPOINT_SCHEMA_VERSION,
    operationId: operation.operationId,
    operationHash: operation.operationHash,
    index,
    at: normalizeIsoTimestamp(pickDefined(input.at, input.timestamp, input.createdAt), new Date(now)),
    kind: normalizeTextOrNull(pickDefined(input.kind, input.type, input.event)),
    label: normalizeTextOrNull(pickDefined(input.label, input.stage, input.name)),
    status: statusRaw === undefined || statusRaw === null || statusRaw === ''
      ? null
      : normalizeOperationState(statusRaw),
    code: normalizeTextOrNull(input.code),
    message: normalizeTextOrNull(input.message),
    progress,
    details: cloneJsonValue(input.details, { keepUndefined: true }) ?? null,
    metadata: cloneJsonValue(input.metadata, { keepUndefined: true }) ?? null,
  };
}

function parseCheckpointLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(Boolean);
  const checkpoints = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    try {
      checkpoints.push(JSON.parse(line));
    } catch (error) {
      throw createStoreError('OPERATION_STORE_INVALID_CHECKPOINT_FILE', `Unable to parse checkpoint file: ${filePath}`, {
        filePath,
        line: index + 1,
        cause: error && error.message ? error.message : String(error),
      });
    }
  }
  return checkpoints;
}

function resolveOperationLookup(rootDir, reference, options = {}) {
  const resolvedRootDir = resolveOperationsDir(rootDir);
  const normalizedRef = normalizeReference(reference);

  if (normalizedRef.operationId) {
    const filePath = defaultOperationStateFile(normalizedRef.operationId, { rootDir: resolvedRootDir });
    if (fs.existsSync(filePath)) {
      return {
        rootDir: resolvedRootDir,
        found: true,
        filePath,
        checkpointFilePath: defaultOperationCheckpointFile(normalizedRef.operationId, { rootDir: resolvedRootDir }),
        operation: normalizeOperationRecord(readJsonFile(filePath, { missingOk: false }), { existing: null }),
      };
    }
  }

  if (!normalizedRef.operationHash) {
    return {
      rootDir: resolvedRootDir,
      found: false,
      filePath: normalizedRef.operationId
        ? defaultOperationStateFile(normalizedRef.operationId, { rootDir: resolvedRootDir })
        : null,
      checkpointFilePath: normalizedRef.operationId
        ? defaultOperationCheckpointFile(normalizedRef.operationId, { rootDir: resolvedRootDir })
        : null,
      operation: null,
    };
  }

  const listing = listOperations(resolvedRootDir, { includeDiagnostics: false });
  const match = listing.items.find((item) => item.operationHash === normalizedRef.operationHash);
  if (!match) {
    return {
      rootDir: resolvedRootDir,
      found: false,
      filePath: null,
      checkpointFilePath: null,
      operation: null,
    };
  }

  return {
    rootDir: resolvedRootDir,
    found: true,
    filePath: defaultOperationStateFile(match.operationId, { rootDir: resolvedRootDir }),
    checkpointFilePath: defaultOperationCheckpointFile(match.operationId, { rootDir: resolvedRootDir }),
    operation: match,
  };
}

function getOperation(rootDir, reference, options = {}) {
  const lookup = resolveOperationLookup(rootDir, reference, options);
  if (!lookup.found) return lookup;
  return {
    ...lookup,
    operation: normalizeOperationRecord(lookup.operation, { existing: null }),
  };
}

function getOperationByHash(rootDir, operationHash, options = {}) {
  return getOperation(rootDir, { operationHash }, options);
}

function listOperations(rootDir, options = {}) {
  const resolvedRootDir = resolveOperationsDir(rootDir);
  if (!fs.existsSync(resolvedRootDir)) {
    return {
      rootDir: resolvedRootDir,
      total: 0,
      items: [],
      diagnostics: [],
    };
  }

  const diagnostics = [];
  const entries = fs.readdirSync(resolvedRootDir, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.json')) continue;
    if (entry.name.endsWith('.checkpoints.json')) continue;
    if (entry.name.endsWith('.receipt.json')) continue;
    const filePath = path.join(resolvedRootDir, entry.name);
    try {
      const parsed = readJsonFile(filePath, { missingOk: false });
      items.push(normalizeOperationRecord(parsed, { existing: null }));
    } catch (error) {
      if (options.includeDiagnostics === false) {
        continue;
      }
      diagnostics.push({
        filePath,
        message: error && error.message ? error.message : String(error),
        code: error && error.code ? error.code : 'OPERATION_STORE_READ_FAILED',
      });
    }
  }

  const statusFilter = options.status !== undefined
    ? new Set((Array.isArray(options.status) ? options.status : [options.status]).map((value) => normalizeOperationState(value)))
    : null;
  const commandFilter = options.command !== undefined
    ? new Set((Array.isArray(options.command) ? options.command : [options.command]).map((value) => String(value).trim()))
    : null;
  const commandPrefixFilter = options.commandPrefix !== undefined
    ? new Set((Array.isArray(options.commandPrefix) ? options.commandPrefix : [options.commandPrefix]).map((value) => String(value).trim()).filter(Boolean))
    : null;
  const tagFilter = options.tags !== undefined
    ? new Set(normalizeStringList(options.tags))
    : null;
  const operationHashFilter = options.operationHash !== undefined
    ? new Set((Array.isArray(options.operationHash) ? options.operationHash : [options.operationHash]).map((value) => normalizeOperationHash(value)))
    : null;
  const operationIdFilter = options.operationId !== undefined
    ? new Set((Array.isArray(options.operationId) ? options.operationId : [options.operationId]).map((value) => normalizeOperationId(value)))
    : null;

  let filtered = items.filter((item) => {
    if (statusFilter && !statusFilter.has(item.status)) return false;
    if (commandFilter && !commandFilter.has(item.command)) return false;
    if (commandPrefixFilter) {
      let matched = false;
      for (const prefix of commandPrefixFilter) {
        if (item.command === prefix || item.command.startsWith(`${prefix}.`)) {
          matched = true;
          break;
        }
      }
      if (!matched) return false;
    }
    if (operationHashFilter && !operationHashFilter.has(item.operationHash)) return false;
    if (operationIdFilter && !operationIdFilter.has(item.operationId)) return false;
    if (tagFilter) {
      const itemTags = new Set(Array.isArray(item.tags) ? item.tags : []);
      for (const tag of tagFilter) {
        if (!itemTags.has(tag)) return false;
      }
    }
    return true;
  });

  const direction = String(options.order || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  filtered = filtered.sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt || left.createdAt || 0) || 0;
    const rightTime = Date.parse(right.updatedAt || right.createdAt || 0) || 0;
    if (leftTime !== rightTime) return direction * (leftTime - rightTime);
    return direction * left.operationId.localeCompare(right.operationId);
  });

  const offset = Math.max(0, Number(options.offset) || 0);
  const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) >= 0 ? Number(options.limit) : null;
  const paged = limit === null ? filtered.slice(offset) : filtered.slice(offset, offset + limit);

  return {
    rootDir: resolvedRootDir,
    total: filtered.length,
    items: paged,
    diagnostics,
  };
}

function upsertOperation(rootDir, input, options = {}) {
  const resolvedRootDir = resolveOperationsDir(rootDir);
  const probeRecord = normalizeOperationRecord(input, { now: options.now });
  const stateFilePath = defaultOperationStateFile(probeRecord.operationId, { rootDir: resolvedRootDir });
  const checkpointFilePath = defaultOperationCheckpointFile(probeRecord.operationId, { rootDir: resolvedRootDir });
  const lockPath = `${stateFilePath}.lock`;

  return withFileLock(lockPath, options, () => {
    const existingRaw = readJsonFile(stateFilePath, { missingOk: true });
    if (!existingRaw && options.allowCreate === false) {
      throw createStoreError('OPERATION_NOT_FOUND', `Operation not found: ${probeRecord.operationId}`, {
        operationId: probeRecord.operationId,
      });
    }

    const existing = existingRaw ? normalizeOperationRecord(existingRaw, { existing: null }) : null;
    if (existing && options.expectedCurrentState !== undefined) {
      const expectedStates = new Set(
        (Array.isArray(options.expectedCurrentState) ? options.expectedCurrentState : [options.expectedCurrentState])
          .map((value) => normalizeOperationState(value))
          .filter(Boolean),
      );
      if (!expectedStates.has(existing.status)) {
        throw createStoreError('OPERATION_UNEXPECTED_CURRENT_STATE', 'Operation is not in the expected current state.', {
          operationId: existing.operationId,
          actualCurrentState: existing.status,
          expectedCurrentState: Array.from(expectedStates),
        });
      }
    }

    const operation = normalizeOperationRecord(input, {
      existing,
      now: options.now,
    });
    const checkpointInputs = collectCheckpointInputs(input);
    const existingCheckpoints = existing ? parseCheckpointLines(checkpointFilePath) : [];
    const checkpointState = materializeCheckpointState(operation, checkpointInputs, existingCheckpoints, {
      now: options.now,
      defaultStatus: operation.status,
    });
    atomicWriteJson(stateFilePath, checkpointState.operation);
    try {
      if (checkpointInputs.length > 0) {
        atomicWriteJsonLines(checkpointFilePath, checkpointState.checkpoints);
      }
    } catch (error) {
      try {
        if (existing) {
          atomicWriteJson(stateFilePath, existing);
        } else if (fs.existsSync(stateFilePath)) {
          fs.unlinkSync(stateFilePath);
        }
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
      throw error;
    }

    return {
      rootDir: resolvedRootDir,
      filePath: stateFilePath,
      checkpointFilePath,
      created: !existing,
      operation: checkpointState.operation,
    };
  });
}

function patchOperation(rootDir, reference, patch, options = {}) {
  const lookup = resolveOperationLookup(rootDir, reference, options);
  if (!lookup.found) {
    throw createStoreError('OPERATION_NOT_FOUND', 'Operation not found.', {
      reference,
    });
  }

  const stateFilePath = lookup.filePath;
  const lockPath = `${stateFilePath}.lock`;
  return withFileLock(lockPath, options, () => {
    const currentRaw = readJsonFile(stateFilePath, { missingOk: false });
    const current = normalizeOperationRecord(currentRaw, { existing: null });
    const mergedPatch = patch && typeof patch === 'object' ? patch : {};
    const nextInput = {
      ...mergedPatch,
      operationId: current.operationId,
      operationHash: current.operationHash,
    };
    const operation = normalizeOperationRecord(nextInput, {
      existing: current,
      now: options.now,
    });
    const checkpointInputs = collectCheckpointInputs(mergedPatch);
    const existingCheckpoints = parseCheckpointLines(lookup.checkpointFilePath);
    const checkpointState = materializeCheckpointState(operation, checkpointInputs, existingCheckpoints, {
      now: options.now,
      defaultStatus: operation.status,
    });
    atomicWriteJson(stateFilePath, checkpointState.operation);
    try {
      if (checkpointInputs.length > 0) {
        atomicWriteJsonLines(lookup.checkpointFilePath, checkpointState.checkpoints);
      }
    } catch (error) {
      try {
        atomicWriteJson(stateFilePath, current);
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
      throw error;
    }
    return {
      rootDir: lookup.rootDir,
      filePath: stateFilePath,
      checkpointFilePath: lookup.checkpointFilePath,
      created: false,
      operation: checkpointState.operation,
    };
  });
}

function setOperationStatus(rootDir, reference, nextState, options = {}) {
  const patch = {
    ...(options.patch && typeof options.patch === 'object' ? options.patch : {}),
    status: nextState,
  };
  return patchOperation(rootDir, reference, patch, options);
}

function appendCheckpoint(rootDir, reference, input, options = {}) {
  const lookup = resolveOperationLookup(rootDir, reference, options);
  if (!lookup.found) {
    throw createStoreError('OPERATION_NOT_FOUND', 'Operation not found for checkpoint append.', {
      reference,
    });
  }

  const stateFilePath = lookup.filePath;
  const checkpointFilePath = lookup.checkpointFilePath;
  const lockPath = `${stateFilePath}.lock`;
  const syncState = options.syncState !== false;

  return withFileLock(lockPath, options, () => {
    const currentRaw = readJsonFile(stateFilePath, { missingOk: false });
    const current = normalizeOperationRecord(currentRaw, { existing: null });
    const checkpoint = normalizeCheckpointRecord(input, {
      operation: current,
      index: current.checkpointCount + 1,
      now: options.now,
    });

    let nextOperation = { ...current, updatedAt: checkpoint.at };
    if (syncState && checkpoint.status) {
      nextOperation = applyOperationLifecycleState(nextOperation, checkpoint.status, {
        now: checkpoint.at,
        allowUnknownCurrent: false,
      });
    }
    nextOperation = normalizeOperationRecord(
      {
        ...nextOperation,
        checkpointCount: current.checkpointCount + 1,
        lastCheckpointAt: checkpoint.at,
        latestCheckpoint: summarizeCheckpoint(checkpoint),
      },
      {
        existing: nextOperation,
        now: checkpoint.at,
      },
    );
    atomicWriteJson(stateFilePath, nextOperation);
    try {
      appendJsonLine(checkpointFilePath, checkpoint);
    } catch (error) {
      try {
        atomicWriteJson(stateFilePath, current);
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
      throw error;
    }

    return {
      rootDir: lookup.rootDir,
      filePath: stateFilePath,
      checkpointFilePath,
      checkpoint,
      operation: nextOperation,
    };
  });
}

function readCheckpoints(rootDir, reference, options = {}) {
  const lookup = resolveOperationLookup(rootDir, reference, options);
  if (!lookup.found) {
    return {
      rootDir: lookup.rootDir,
      found: false,
      checkpointFilePath: lookup.checkpointFilePath,
      items: [],
      total: 0,
    };
  }

  const checkpoints = parseCheckpointLines(lookup.checkpointFilePath);
  let filtered = checkpoints;
  if (options.afterIndex !== undefined) {
    const afterIndex = normalizePositiveInteger(options.afterIndex, 'afterIndex', 0);
    filtered = filtered.filter((item) => Number(item.index) > afterIndex);
  }
  if (options.status !== undefined) {
    const statuses = new Set((Array.isArray(options.status) ? options.status : [options.status]).map((value) => normalizeOperationState(value)));
    filtered = filtered.filter((item) => item.status && statuses.has(normalizeOperationState(item.status)));
  }
  if (options.kind !== undefined) {
    const kinds = new Set((Array.isArray(options.kind) ? options.kind : [options.kind]).map((value) => String(value).trim().toLowerCase()));
    filtered = filtered.filter((item) => item.kind && kinds.has(String(item.kind).trim().toLowerCase()));
  }

  const order = String(options.order || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
  filtered = filtered.sort((left, right) => {
    const cmp = Number(left.index) - Number(right.index);
    return order === 'asc' ? cmp : -cmp;
  });

  const offset = Math.max(0, Number(options.offset) || 0);
  const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) >= 0 ? Number(options.limit) : null;
  const items = limit === null ? filtered.slice(offset) : filtered.slice(offset, offset + limit);

  return {
    rootDir: lookup.rootDir,
    found: true,
    checkpointFilePath: lookup.checkpointFilePath,
    items,
    total: filtered.length,
  };
}

function readReceipt(rootDir, reference, options = {}) {
  const lookup = resolveOperationLookup(rootDir, reference, options);
  const receiptFilePath = lookup && lookup.found
    ? defaultOperationReceiptFile(lookup.operation.operationId, { rootDir: lookup.rootDir })
    : (lookup && lookup.operation && lookup.operation.operationId
      ? defaultOperationReceiptFile(lookup.operation.operationId, { rootDir: lookup.rootDir })
      : null);
  if (!receiptFilePath || !fs.existsSync(receiptFilePath)) {
    return {
      rootDir: lookup.rootDir,
      found: false,
      receiptFilePath,
      receipt: null,
    };
  }
  const receipt = readJsonFile(receiptFilePath, { missingOk: false });
  return {
    rootDir: lookup.rootDir,
    found: true,
    receiptFilePath,
    receipt: cloneJsonValue(receipt),
  };
}

function writeReceipt(rootDir, reference, receipt, options = {}) {
  const lookup = resolveOperationLookup(rootDir, reference, options);
  if (!lookup.found || !lookup.operation || !lookup.operation.operationId) {
    throw createStoreError('OPERATION_NOT_FOUND', 'Cannot write receipt for missing operation.', {
      reference,
    });
  }
  const receiptFilePath = defaultOperationReceiptFile(lookup.operation.operationId, { rootDir: lookup.rootDir });
  const lockPath = `${receiptFilePath}.lock`;
  const payload = cloneJsonValue({
    schemaVersion: OPERATION_RECEIPT_SCHEMA_VERSION,
    ...(receipt && typeof receipt === 'object' ? receipt : {}),
  });
  return withFileLock(lockPath, options, () => {
    atomicWriteJson(receiptFilePath, payload);
    return {
      rootDir: lookup.rootDir,
      found: true,
      receiptFilePath,
      receipt: payload,
    };
  });
}

function createOperationStateStore(options = {}) {
  const rootDir = resolveOperationsDir(options.rootDir || options.dir);
  return {
    rootDir,
    get(reference, callOptions = {}) {
      return getOperation(rootDir, reference, callOptions);
    },
    getByHash(operationHash, callOptions = {}) {
      return getOperationByHash(rootDir, operationHash, callOptions);
    },
    list(callOptions = {}) {
      return listOperations(rootDir, callOptions);
    },
    upsert(input, callOptions = {}) {
      return upsertOperation(rootDir, input, callOptions);
    },
    patch(reference, patch, callOptions = {}) {
      return patchOperation(rootDir, reference, patch, callOptions);
    },
    setStatus(reference, nextState, callOptions = {}) {
      return setOperationStatus(rootDir, reference, nextState, callOptions);
    },
    appendCheckpoint(reference, input, callOptions = {}) {
      return appendCheckpoint(rootDir, reference, input, callOptions);
    },
    readCheckpoints(reference, callOptions = {}) {
      return readCheckpoints(rootDir, reference, callOptions);
    },
    readReceipt(reference, callOptions = {}) {
      return readReceipt(rootDir, reference, callOptions);
    },
    writeReceipt(reference, receipt, callOptions = {}) {
      return writeReceipt(rootDir, reference, receipt, callOptions);
    },
    receiptFile(reference) {
      const lookup = getOperation(rootDir, reference, {});
      if (!lookup || !lookup.found) return null;
      return defaultOperationReceiptFile(lookup.operation.operationId, { rootDir });
    },
  };
}

module.exports = {
  OPERATION_STORE_SCHEMA_VERSION,
  OPERATION_CHECKPOINT_SCHEMA_VERSION,
  OPERATION_RECEIPT_SCHEMA_VERSION,
  createStoreError,
  expandHome,
  defaultOperationsDir,
  resolveOperationsDir,
  defaultOperationStateFile,
  defaultOperationCheckpointFile,
  defaultOperationReceiptFile,
  normalizeOperationId,
  normalizeOperationRecord,
  normalizeCheckpointRecord,
  summarizeCheckpoint,
  getOperation,
  getOperationByHash,
  listOperations,
  upsertOperation,
  patchOperation,
  setOperationStatus,
  appendCheckpoint,
  readCheckpoints,
  readReceipt,
  writeReceipt,
  createOperationStateStore,
};
