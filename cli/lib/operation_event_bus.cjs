const crypto = require('crypto');

const OPERATION_EVENT_SCHEMA_VERSION = '1.0.0';

function coerceNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizePhase(value) {
  const phase = coerceNonEmptyString(value, 'phase').toLowerCase().replace(/[\s_]+/g, '-');
  return phase;
}

function coerceIsoTimestamp(value, now) {
  const source = value === undefined ? now() : value;
  const date = source instanceof Date ? source : new Date(source);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('emittedAt must be a valid date, timestamp, or ISO string.');
  }
  return date.toISOString();
}

function coerceSequence(value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError('sequence must be a positive integer.');
  }
  return value;
}

function normalizeNullableString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function cloneJsonValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJsonValue(entry));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      const cloned = cloneJsonValue(value[key]);
      if (cloned !== undefined) {
        out[key] = cloned;
      }
    }
    return out;
  }
  return String(value);
}

function normalizeTags(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeNullableString(key);
    const normalizedValue = normalizeNullableString(entry);
    if (normalizedKey && normalizedValue) {
      out[normalizedKey] = normalizedValue;
    }
  }
  return out;
}

function stableSortValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableSortValue(entry));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = stableSortValue(value[key]);
    }
    return out;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableSortValue(value));
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Array.isArray(value) ? value : Object.values(value)) {
    freezeDeep(entry);
  }
  return value;
}

function buildEventHashPayload(event) {
  return {
    schemaVersion: event.schemaVersion,
    eventType: event.eventType,
    operationId: event.operationId,
    operationKind: event.operationKind,
    phase: event.phase,
    sequence: event.sequence,
    emittedAt: event.emittedAt,
    source: event.source,
    runtimeHandle: event.runtimeHandle,
    correlationId: event.correlationId,
    actor: event.actor,
    summary: event.summary,
    message: event.message,
    tags: event.tags,
    data: event.data,
  };
}

function buildOperationLifecycleEvent(input, options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const event = {
    schemaVersion: OPERATION_EVENT_SCHEMA_VERSION,
    eventType: 'operation.lifecycle',
    operationId: coerceNonEmptyString(input && input.operationId, 'operationId'),
    operationKind: normalizeNullableString(input && input.operationKind),
    phase: normalizePhase((input && (input.phase || input.status || input.state)) || ''),
    sequence: coerceSequence(input && input.sequence),
    emittedAt: coerceIsoTimestamp(input && input.emittedAt, now),
    source: normalizeNullableString(input && input.source) || 'local',
    runtimeHandle: normalizeNullableString(input && input.runtimeHandle),
    correlationId: normalizeNullableString(input && input.correlationId),
    actor: normalizeNullableString(input && input.actor),
    summary: normalizeNullableString(input && input.summary),
    message: normalizeNullableString(input && input.message),
    tags: normalizeTags(input && input.tags),
    data: cloneJsonValue(input && input.data),
  };

  const eventId = crypto
    .createHash('sha256')
    .update(stableStringify(buildEventHashPayload(event)))
    .digest('hex');

  return freezeDeep({
    ...event,
    eventId,
  });
}

function buildListenerFailure(error, index) {
  return freezeDeep({
    listenerIndex: index,
    code: normalizeNullableString(error && error.code),
    message: error && error.message ? String(error.message) : String(error),
  });
}

function createOperationEventBus(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const maxHistory = Number.isFinite(Number(options.maxHistory)) && Number(options.maxHistory) > 0
    ? Math.floor(Number(options.maxHistory))
    : 500;
  const maxTrackedOperations = Number.isFinite(Number(options.maxTrackedOperations))
    && Number(options.maxTrackedOperations) > 0
    ? Math.floor(Number(options.maxTrackedOperations))
    : Math.max(maxHistory * 4, 1_000);
  const listenerTimeoutMs = Number.isFinite(Number(options.listenerTimeoutMs)) && Number(options.listenerTimeoutMs) > 0
    ? Math.floor(Number(options.listenerTimeoutMs))
    : 2_000;
  const listeners = new Set();
  const history = [];
  const sequenceByOperation = new Map();

  function previewNextSequence(operationId, requestedSequence) {
    const current = sequenceByOperation.get(operationId) || 0;
    if (requestedSequence === undefined || requestedSequence === null) {
      return current + 1;
    }
    const sequence = coerceSequence(requestedSequence);
    if (sequence <= current) {
      throw new RangeError(`sequence must be greater than the last emitted sequence (${current}) for ${operationId}.`);
    }
    return sequence;
  }

  function commitSequence(operationId, sequence) {
    if (sequenceByOperation.has(operationId)) {
      sequenceByOperation.delete(operationId);
    }
    sequenceByOperation.set(operationId, sequence);
  }

  function pruneSequenceState() {
    if (sequenceByOperation.size <= maxTrackedOperations) return;
    const activeOperationIds = new Set(history.map((event) => event.operationId));

    for (const operationId of Array.from(sequenceByOperation.keys())) {
      if (sequenceByOperation.size <= maxTrackedOperations) break;
      if (!activeOperationIds.has(operationId)) {
        sequenceByOperation.delete(operationId);
      }
    }

    while (sequenceByOperation.size > maxTrackedOperations) {
      const oldest = sequenceByOperation.keys().next();
      if (oldest.done) break;
      sequenceByOperation.delete(oldest.value);
    }
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function.');
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async function notifyListener(listener, event, listenerIndex) {
    const timeoutError = new Error(`listener timed out after ${listenerTimeoutMs}ms`);
    timeoutError.code = 'OPERATION_EVENT_LISTENER_TIMEOUT';
    let timer = null;
    const abortController = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (abortController) {
          abortController.abort(timeoutError);
        }
        reject(timeoutError);
      }, listenerTimeoutMs);
    });

    try {
      const result = await Promise.race([
        Promise.resolve().then(() => listener(event, {
          signal: abortController ? abortController.signal : undefined,
          timeoutMs: listenerTimeoutMs,
        })),
        timeoutPromise,
      ]);
      return freezeDeep({
        listenerIndex,
        ok: true,
        result: cloneJsonValue(result),
      });
    } catch (error) {
      return freezeDeep({
        listenerIndex,
        ok: false,
        error: buildListenerFailure(error, listenerIndex),
      });
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async function emitLifecycleEvent(input) {
    const operationId = coerceNonEmptyString(input && input.operationId, 'operationId');
    const sequence = previewNextSequence(operationId, input && input.sequence);
    const event = buildOperationLifecycleEvent(
      {
        ...input,
        operationId,
        sequence,
      },
      { now },
    );
    commitSequence(operationId, sequence);
    history.push(event);
    if (history.length > maxHistory) {
      history.splice(0, history.length - maxHistory);
    }
    pruneSequenceState();

    const listenerReports = await Promise.all(
      Array.from(listeners, (listener, listenerIndex) => notifyListener(listener, event, listenerIndex)),
    );

    const failureCount = listenerReports.filter((entry) => entry.ok === false).length;
    return freezeDeep({
      event,
      listenerReports,
      failureCount,
      ok: true,
    });
  }

  function getHistory(filter = {}) {
    const operationId = normalizeNullableString(filter.operationId);
    if (!operationId) return [...history];
    return history.filter((event) => event.operationId === operationId);
  }

  function getLastSequence(operationId) {
    if (!operationId) return 0;
    return sequenceByOperation.get(String(operationId).trim()) || 0;
  }

  return {
    subscribe,
    emitLifecycleEvent,
    getHistory,
    getLastSequence,
  };
}

module.exports = {
  OPERATION_EVENT_SCHEMA_VERSION,
  buildOperationLifecycleEvent,
  createOperationEventBus,
};
