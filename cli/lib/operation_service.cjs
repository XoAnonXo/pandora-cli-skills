'use strict';

const { createOperationStateStore } = require('./operation_state_store.cjs');
const {
  OPERATION_STATE_SCHEMA_VERSION,
  OPERATION_STATES,
  TERMINAL_OPERATION_STATES,
  normalizeOperationState,
} = require('./shared/operation_states.cjs');
const {
  buildOperationHash,
  buildOperationId,
  normalizeOperationHash,
  normalizeOperationId,
} = require('./shared/operation_hash.cjs');

const OPERATION_SCHEMA_VERSION = OPERATION_STATE_SCHEMA_VERSION;
const OPERATION_STATUSES = Object.freeze([
  'planned',
  'validated',
  'queued',
  'executing',
  'paused',
  'completed',
  'failed',
  'canceled',
  'closed',
]);
const TERMINAL_OPERATION_STATUSES = Object.freeze(['completed', 'failed', 'canceled', 'closed']);
const VALID_OPERATION_TRANSITIONS = Object.freeze({
  planned: Object.freeze(['validated', 'queued', 'executing', 'failed', 'canceled', 'closed']),
  validated: Object.freeze(['queued', 'executing', 'failed', 'canceled', 'closed']),
  queued: Object.freeze(['executing', 'failed', 'canceled', 'closed']),
  executing: Object.freeze(['executing', 'paused', 'completed', 'failed', 'canceled']),
  paused: Object.freeze(['executing', 'completed', 'failed', 'canceled']),
  completed: Object.freeze(['closed']),
  failed: Object.freeze(['closed']),
  canceled: Object.freeze(['closed']),
  closed: Object.freeze([]),
});

function createOperationError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function mapPublicStatusToStore(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) return 'planned';
  if (normalized === 'executing') return 'running';
  if (normalized === 'completed') return 'succeeded';
  if (normalized === 'canceled') return 'cancelled';
  return normalizeOperationState(normalized);
}

function mapStoreStatusToPublic(status) {
  const normalized = normalizeOperationState(status);
  if (normalized === 'running') return 'executing';
  if (normalized === 'queued') return 'queued';
  if (normalized === 'paused') return 'paused';
  if (normalized === 'succeeded') return 'completed';
  if (normalized === 'cancelled') return 'canceled';
  return normalized || 'planned';
}

function deriveTool(command) {
  const normalized = typeof command === 'string' ? command.trim() : '';
  return normalized ? normalized.split('.')[0] || null : null;
}

function deriveAction(command) {
  const normalized = typeof command === 'string' ? command.trim() : '';
  if (!normalized.includes('.')) return null;
  return normalized.split('.').slice(1).join('.') || null;
}

function normalizeCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object') return null;
  return {
    ...checkpoint,
    status: checkpoint.status ? mapStoreStatusToPublic(checkpoint.status) : null,
  };
}

function normalizePublicOperationRecord(record, checkpoints) {
  if (!record || typeof record !== 'object') return null;
  const publicStatus = mapStoreStatusToPublic(record.status);
  const normalizedCheckpoints = Array.isArray(checkpoints)
    ? checkpoints.map((entry) => normalizeCheckpoint(entry)).filter(Boolean)
    : null;
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operationId: record.operationId,
    id: record.operationId,
    operationHash: record.operationHash || null,
    hash: record.operationHash || null,
    command: record.command || null,
    tool: deriveTool(record.command),
    action: deriveAction(record.command),
    summary: record.summary || record.description || null,
    description: record.description || null,
    status: publicStatus,
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
    validatedAt: record.validatedAt || null,
    queuedAt: record.queuedAt || null,
    executingAt: record.startedAt || null,
    startedAt: record.startedAt || null,
    completedAt: record.completedAt || record.succeededAt || null,
    failedAt: record.failedAt || null,
    canceledAt: record.cancelledAt || null,
    cancelledAt: record.cancelledAt || null,
    closedAt: record.closedAt || null,
    type: record.metadata && typeof record.metadata.type === 'string' ? record.metadata.type : null,
    target: record.target === undefined ? null : record.target,
    input: record.request === undefined ? null : record.request,
    request: record.request === undefined ? null : record.request,
    context: record.runtime === undefined ? null : record.runtime,
    metadata: record.metadata === undefined ? null : record.metadata,
    result: record.result === undefined ? null : record.result,
    recovery: record.recovery === undefined ? null : record.recovery,
    error: record.error === undefined ? null : record.error,
    cancellation: record.cancellation === undefined ? null : record.cancellation,
    closure: record.closure === undefined ? null : record.closure,
    checkpointCount: Number.isInteger(record.checkpointCount) ? record.checkpointCount : 0,
    latestCheckpoint: record.latestCheckpoint === undefined ? null : normalizeCheckpoint(record.latestCheckpoint),
    checkpoints: normalizedCheckpoints,
    cancelable: !TERMINAL_OPERATION_STATUSES.includes(publicStatus),
    closable: ['completed', 'failed', 'canceled'].includes(publicStatus),
  };
}

function resolveStore(deps = {}) {
  if (deps.operationStateStore && typeof deps.operationStateStore.get === 'function') {
    return deps.operationStateStore;
  }
  if (deps.store && typeof deps.store.get === 'function') {
    return deps.store;
  }
  return createOperationStateStore({
    rootDir: deps.rootDir || deps.dir,
  });
}

function normalizeReference(reference) {
  if (typeof reference === 'string' && reference.trim()) {
    return reference.trim();
  }
  if (reference && typeof reference === 'object') {
    if (typeof reference.operationId === 'string' && reference.operationId.trim()) {
      return reference.operationId.trim();
    }
    if (typeof reference.id === 'string' && reference.id.trim()) {
      return reference.id.trim();
    }
    if (typeof reference.operationHash === 'string' && reference.operationHash.trim()) {
      return { operationHash: reference.operationHash.trim() };
    }
    if (typeof reference.hash === 'string' && reference.hash.trim()) {
      return { operationHash: reference.hash.trim() };
    }
  }
  throw createOperationError('OPERATION_INVALID_REFERENCE', 'Operation reference must be an id, hash, or operation object.', {
    reference,
  });
}

async function loadRecord(store, reference) {
  const normalizedReference = resolveReference(reference);
  const lookup = await store.get(normalizedReference);
  return lookup && lookup.found ? lookup.operation : null;
}

function resolveReference(reference) {
  const normalized = normalizeReference(reference);
  if (typeof normalized === 'string') {
    if (/^[a-f0-9]{64}$/i.test(normalized)) {
      return { operationHash: normalizeOperationHash(normalized) };
    }
    try {
      return normalizeOperationId(normalized);
    } catch {
      return { operationHash: normalizeOperationHash(normalized) };
    }
  }
  return {
    operationHash: normalizeOperationHash(normalized.operationHash),
  };
}

async function loadPublicRecord(store, reference, options = {}) {
  const record = await loadRecord(store, reference);
  if (!record) return null;
  let checkpoints = null;
  if (options.includeCheckpoints !== false) {
    const checkpointListing = await store.readCheckpoints(record.operationId, {
      limit: options.checkpointLimit,
      order: 'asc',
    });
    checkpoints = checkpointListing && Array.isArray(checkpointListing.items) ? checkpointListing.items : [];
  }
  return normalizePublicOperationRecord(record, checkpoints);
}

function buildSeedPayload(seed = {}) {
  if (!isPlainObject(seed)) {
    throw createOperationError('OPERATION_INVALID_INPUT', 'Operation seed must be an object.', {
      seedType: seed === null ? 'null' : typeof seed,
    });
  }
  const command = typeof seed.command === 'string' && seed.command.trim() ? seed.command.trim() : null;
  const request = cloneValue(
    seed.request !== undefined
      ? seed.request
      : seed.input !== undefined
        ? seed.input
        : seed.payload !== undefined
          ? seed.payload
          : seed.args !== undefined
            ? seed.args
            : null,
  );
  const metadata = isPlainObject(seed.metadata) ? cloneValue(seed.metadata) : {};
  if (seed.type !== undefined && metadata.type === undefined) {
    metadata.type = seed.type;
  }
  const operationHash = normalizeOperationHash(
    seed.operationHash || buildOperationHash({
      command,
      action: seed.action,
      target: seed.target === undefined ? null : seed.target,
      request,
      context: seed.context === undefined ? null : seed.context,
      metadata,
      policyPack: seed.policyPack,
      profile: seed.profile,
      environment: seed.environment,
      mode: seed.mode,
      scope: seed.scope,
    }, { namespace: 'pandora.operation' }),
  );
  const operationId = normalizeOperationId(
    seed.operationId || buildOperationId({ command, operationHash }, { prefix: command || 'operation', operationHash }),
  );
  return {
    operationId,
    operationHash,
    command,
    summary: typeof seed.summary === 'string' && seed.summary.trim() ? seed.summary.trim() : null,
    description: typeof seed.description === 'string' && seed.description.trim() ? seed.description.trim() : null,
    target: seed.target === undefined ? null : cloneValue(seed.target),
    request,
    recovery: seed.recovery === undefined ? null : cloneValue(seed.recovery),
    result: seed.result === undefined ? null : cloneValue(seed.result),
    error: seed.error === undefined ? null : cloneValue(seed.error),
    cancellation: seed.cancellation === undefined ? null : cloneValue(seed.cancellation),
    closure: seed.closure === undefined ? null : cloneValue(seed.closure),
    metadata,
    runtime: seed.context === undefined ? null : cloneValue(seed.context),
    scope: typeof seed.scope === 'string' && seed.scope.trim() ? seed.scope.trim() : null,
    tags: Array.isArray(seed.tags) ? cloneValue(seed.tags) : [],
  };
}

async function emitLifecycle(deps, record, phase, details = {}) {
  if (!deps.operationEventBus || typeof deps.operationEventBus.emitLifecycleEvent !== 'function' || !record) {
    return null;
  }
  try {
    const lifecycle = await deps.operationEventBus.emitLifecycleEvent({
      operationId: record.operationId,
      operationKind: record.command || null,
      phase,
      source: 'cli',
      summary: record.summary || record.description || null,
      data: details,
    });
    if (
      lifecycle
      && lifecycle.event
      && deps.operationWebhookService
      && typeof deps.operationWebhookService.hasTargets === 'function'
      && typeof deps.operationWebhookService.notifyLifecycleEvent === 'function'
      && typeof deps.getWebhookTargets === 'function'
    ) {
      const targets = deps.getWebhookTargets();
      if (deps.operationWebhookService.hasTargets(targets)) {
        await deps.operationWebhookService.notifyLifecycleEvent(targets, lifecycle.event, {
          metadata: {
            command: record.command || null,
          },
        });
      }
    }
    return lifecycle;
  } catch {
    return null;
  }
}

function transitionPatch(patch = {}) {
  if (!isPlainObject(patch)) return {};
  const next = { ...patch };
  delete next.checkpoint;
  delete next.checkpoints;
  return next;
}

async function appendCheckpoints(store, operationId, patch = {}, status) {
  const checkpoints = [];
  if (patch.checkpoint !== undefined) {
    checkpoints.push(patch.checkpoint);
  }
  if (Array.isArray(patch.checkpoints)) {
    checkpoints.push(...patch.checkpoints);
  }
  let latest = null;
  for (const checkpoint of checkpoints) {
    const payload = isPlainObject(checkpoint)
      ? { ...checkpoint }
      : { label: String(checkpoint || ''), kind: 'note' };
    if (!payload.status && status) {
      payload.status = mapPublicStatusToStore(status);
    }
    latest = await store.appendCheckpoint(operationId, payload, {
      syncState: false,
    });
  }
  return latest;
}

function buildListFilters(filters = {}) {
  const next = {};
  if (Array.isArray(filters.statuses) && filters.statuses.length) {
    next.status = filters.statuses.map((status) => mapPublicStatusToStore(status));
  }
  if (filters.tool) {
    next.command = String(filters.tool).trim();
  }
  if (Number.isFinite(Number(filters.limit)) && Number(filters.limit) > 0) {
    next.limit = Math.floor(Number(filters.limit));
  }
  if (Number.isFinite(Number(filters.offset)) && Number(filters.offset) >= 0) {
    next.offset = Math.floor(Number(filters.offset));
  }
  return next;
}

function createOperationService(deps = {}) {
  const store = resolveStore(deps);

  async function createWithStatus(status, seed = {}) {
    const storeStatus = mapPublicStatusToStore(status);
    const payload = buildSeedPayload(seed);
    const upserted = await store.upsert({
      ...payload,
      status: storeStatus,
    });
    if (seed.checkpoint !== undefined || Array.isArray(seed.checkpoints)) {
      await appendCheckpoints(store, payload.operationId, seed, status);
    }
    const record = await loadPublicRecord(store, payload.operationId, {
      includeCheckpoints: true,
    });
    await emitLifecycle(deps, record, record.status, {
      mode: seed.mode || null,
      action: 'create',
    });
    return record;
  }

  async function maybeGet(reference, options = {}) {
    return loadPublicRecord(store, reference, options);
  }

  async function get(reference, options = {}) {
    const record = await maybeGet(reference, options);
    if (!record) {
      const ref = typeof reference === 'string' ? reference : JSON.stringify(reference);
      throw createOperationError('OPERATION_NOT_FOUND', `Operation not found: ${ref}`, {
        reference,
      });
    }
    return record;
  }

  async function transition(reference, nextStatus, patch = {}) {
    const lookup = await get(reference, { includeCheckpoints: false });
    const storeStatus = mapPublicStatusToStore(nextStatus);
    const updated = await store.setStatus(lookup.operationId, storeStatus, {
      patch: transitionPatch(patch),
    });
    if (patch.checkpoint !== undefined || Array.isArray(patch.checkpoints)) {
      await appendCheckpoints(store, lookup.operationId, patch, nextStatus);
    }
    const record = await loadPublicRecord(store, lookup.operationId, {
      includeCheckpoints: true,
    });
    await emitLifecycle(deps, record, record.status, {
      action: 'transition',
      requestedStatus: nextStatus,
    });
    return record;
  }

  async function addCheckpoint(reference, checkpoint) {
    const lookup = await get(reference, { includeCheckpoints: false });
    const appended = await store.appendCheckpoint(lookup.operationId, isPlainObject(checkpoint)
      ? { ...checkpoint }
      : { label: String(checkpoint || ''), kind: 'note' }, {
      syncState: false,
    });
    const record = await loadPublicRecord(store, lookup.operationId, {
      includeCheckpoints: true,
    });
    await emitLifecycle(deps, record, record.status, {
      action: 'checkpoint',
      checkpointIndex: appended && appended.checkpoint ? appended.checkpoint.index : null,
    });
    return record;
  }

  async function updateResult(reference, result) {
    const lookup = await get(reference, { includeCheckpoints: false });
    await store.patch(lookup.operationId, {
      result,
    });
    return loadPublicRecord(store, lookup.operationId, {
      includeCheckpoints: true,
    });
  }

  async function updateRecovery(reference, recovery) {
    const lookup = await get(reference, { includeCheckpoints: false });
    await store.patch(lookup.operationId, {
      recovery,
    });
    return loadPublicRecord(store, lookup.operationId, {
      includeCheckpoints: true,
    });
  }

  async function listOperations(filters = {}) {
    const listing = await store.list(buildListFilters(filters));
    const items = [];
    for (const item of listing.items || []) {
      items.push(normalizePublicOperationRecord(item, null));
    }
    return {
      schemaVersion: OPERATION_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      total: Number.isInteger(listing.total) ? listing.total : items.length,
      count: items.length,
      items,
      diagnostics: Array.isArray(listing.diagnostics) ? listing.diagnostics : [],
      filters: {
        statuses: Array.isArray(filters.statuses) ? filters.statuses.slice() : [],
        tool: filters.tool || null,
        limit: Number.isFinite(Number(filters.limit)) ? Math.floor(Number(filters.limit)) : null,
        offset: Number.isFinite(Number(filters.offset)) ? Math.floor(Number(filters.offset)) : 0,
      },
    };
  }

  async function cancelOperation(reference, reason) {
    return transition(reference, 'canceled', {
      cancellation: {
        reason: reason || null,
      },
    });
  }

  async function closeOperation(reference, reason) {
    return transition(reference, 'closed', {
      closure: {
        reason: reason || null,
      },
    });
  }

  return {
    OPERATION_SCHEMA_VERSION,
    OPERATION_STATUSES: OPERATION_STATUSES.slice(),
    VALID_OPERATION_TRANSITIONS,
    TERMINAL_OPERATION_STATUSES: TERMINAL_OPERATION_STATUSES.slice(),
    createPlanned(seed) {
      return createWithStatus('planned', seed);
    },
    createValidated(seed) {
      return createWithStatus('validated', seed);
    },
    createExecuting(seed) {
      return createWithStatus('executing', seed);
    },
    createCompleted(seed) {
      return createWithStatus('completed', seed);
    },
    createFailed(seed) {
      return createWithStatus('failed', seed);
    },
    createCanceled(seed) {
      return createWithStatus('canceled', seed);
    },
    createClosed(seed) {
      return createWithStatus('closed', seed);
    },
    maybeGet,
    get,
    getOperation(reference, options) {
      return maybeGet(reference, options);
    },
    listOperations,
    save(seed) {
      return createWithStatus(mapStoreStatusToPublic(seed && seed.status ? seed.status : 'planned'), seed);
    },
    transition,
    markValidated(reference, patch) {
      return transition(reference, 'validated', patch);
    },
    markExecuting(reference, patch) {
      return transition(reference, 'executing', patch);
    },
    markCompleted(reference, patch) {
      return transition(reference, 'completed', patch);
    },
    markFailed(reference, patch) {
      return transition(reference, 'failed', patch);
    },
    cancel(reference, patch = {}) {
      return transition(reference, 'canceled', patch);
    },
    close(reference, patch = {}) {
      return transition(reference, 'closed', patch);
    },
    cancelOperation,
    closeOperation,
    addCheckpoint,
    updateResult,
    updateRecovery,
  };
}

module.exports = {
  OPERATION_SCHEMA_VERSION,
  OPERATION_STATUSES,
  VALID_OPERATION_TRANSITIONS,
  TERMINAL_OPERATION_STATUSES: TERMINAL_OPERATION_STATUSES.slice(),
  createOperationError,
  createOperationService,
  mapPublicStatusToStore,
  mapStoreStatusToPublic,
};
