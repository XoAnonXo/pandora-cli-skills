const OPERATION_STATE_SCHEMA_VERSION = '1.0.0';

const STATE_ALIASES = Object.freeze({
  pending: 'queued',
  queue: 'queued',
  executing: 'running',
  execute: 'running',
  checkpointed: 'running',
  completed: 'succeeded',
  complete: 'succeeded',
  canceled: 'cancelled',
  cancel: 'cancelled',
});

const OPERATION_STATES = Object.freeze([
  'planned',
  'validated',
  'queued',
  'running',
  'paused',
  'succeeded',
  'failed',
  'cancelled',
  'closed',
]);

const TERMINAL_OPERATION_STATES = Object.freeze([
  'succeeded',
  'failed',
  'cancelled',
  'closed',
]);

const STATE_TRANSITIONS = Object.freeze({
  planned: Object.freeze(['validated', 'queued', 'running', 'failed', 'cancelled', 'closed']),
  validated: Object.freeze(['queued', 'running', 'failed', 'cancelled', 'closed']),
  queued: Object.freeze(['running', 'failed', 'cancelled', 'closed']),
  running: Object.freeze(['running', 'paused', 'succeeded', 'failed', 'cancelled']),
  paused: Object.freeze(['running', 'succeeded', 'failed', 'cancelled']),
  succeeded: Object.freeze(['closed']),
  failed: Object.freeze(['closed']),
  cancelled: Object.freeze(['closed']),
  closed: Object.freeze([]),
});

function normalizeOperationState(rawState) {
  const normalized = String(rawState || '').trim().toLowerCase();
  return STATE_ALIASES[normalized] || normalized;
}

function isKnownOperationState(rawState) {
  return OPERATION_STATES.includes(normalizeOperationState(rawState));
}

function isTerminalOperationState(rawState) {
  return TERMINAL_OPERATION_STATES.includes(normalizeOperationState(rawState));
}

function canTransitionOperationState(fromState, toState) {
  const normalizedFrom = normalizeOperationState(fromState);
  const normalizedTo = normalizeOperationState(toState);
  if (!isKnownOperationState(normalizedFrom) || !isKnownOperationState(normalizedTo)) {
    return false;
  }
  return normalizedFrom === normalizedTo || STATE_TRANSITIONS[normalizedFrom].includes(normalizedTo);
}

function validateOperationTransition(currentState, nextState, options = {}) {
  const normalizedCurrent = normalizeOperationState(currentState);
  const normalizedNext = normalizeOperationState(nextState);
  const allowUnknownCurrent = options.allowUnknownCurrent === true;

  if (!isKnownOperationState(normalizedNext)) {
    return {
      ok: false,
      currentState: isKnownOperationState(normalizedCurrent) ? normalizedCurrent : null,
      nextState: normalizedNext,
      allowedNextStates: [],
      reason: 'unknown-next-state',
    };
  }

  if (!isKnownOperationState(normalizedCurrent)) {
    return {
      ok: allowUnknownCurrent,
      currentState: null,
      nextState: normalizedNext,
      allowedNextStates: allowUnknownCurrent ? OPERATION_STATES.slice() : [],
      reason: allowUnknownCurrent ? null : 'unknown-current-state',
    };
  }

  return {
    ok: canTransitionOperationState(normalizedCurrent, normalizedNext),
    currentState: normalizedCurrent,
    nextState: normalizedNext,
    allowedNextStates: Array.from(new Set([normalizedCurrent, ...STATE_TRANSITIONS[normalizedCurrent]])),
    reason: canTransitionOperationState(normalizedCurrent, normalizedNext) ? null : 'invalid-transition',
  };
}

function assertValidOperationTransition(currentState, nextState, options = {}) {
  const validation = validateOperationTransition(currentState, nextState, options);
  if (!validation.ok) {
    const error = new Error(`Invalid operation state transition: ${validation.currentState || 'unknown'} -> ${validation.nextState}`);
    error.code = 'OPERATION_INVALID_TRANSITION';
    error.details = validation;
    throw error;
  }
  return validation;
}

function normalizeIsoTimestamp(value, fallbackDate = null) {
  if (value === undefined || value === null || value === '') {
    if (fallbackDate === null || fallbackDate === undefined) return null;
    const fallback = fallbackDate instanceof Date ? fallbackDate : new Date(fallbackDate);
    return fallback.toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return parsed.toISOString();
}

function applyOperationLifecycleState(record = {}, nextState, options = {}) {
  const nowIso = normalizeIsoTimestamp(options.now, new Date());
  const currentState = normalizeOperationState(record.status);
  const normalizedNext = normalizeOperationState(nextState);
  assertValidOperationTransition(currentState || null, normalizedNext, {
    allowUnknownCurrent: options.allowUnknownCurrent === true || !currentState,
  });

  const nextRecord = {
    ...record,
    status: normalizedNext,
    createdAt: normalizeIsoTimestamp(record.createdAt, nowIso),
    updatedAt: nowIso,
    validatedAt: record.validatedAt || null,
    queuedAt: record.queuedAt || null,
    startedAt: record.startedAt || null,
    pausedAt: record.pausedAt || null,
    completedAt: record.completedAt || null,
    succeededAt: record.succeededAt || null,
    failedAt: record.failedAt || null,
    cancelledAt: record.cancelledAt || null,
    closedAt: record.closedAt || null,
  };

  if (normalizedNext === 'validated' && !nextRecord.validatedAt) nextRecord.validatedAt = nowIso;
  if (normalizedNext === 'queued' && !nextRecord.queuedAt) nextRecord.queuedAt = nowIso;
  if (normalizedNext === 'running' && !nextRecord.startedAt) nextRecord.startedAt = nowIso;
  if (normalizedNext === 'paused' && !nextRecord.pausedAt) nextRecord.pausedAt = nowIso;
  if (normalizedNext === 'succeeded') {
    if (!nextRecord.completedAt) nextRecord.completedAt = nowIso;
    if (!nextRecord.succeededAt) nextRecord.succeededAt = nowIso;
  }
  if (normalizedNext === 'failed' && !nextRecord.failedAt) nextRecord.failedAt = nowIso;
  if (normalizedNext === 'cancelled' && !nextRecord.cancelledAt) nextRecord.cancelledAt = nowIso;
  if (normalizedNext === 'closed' && !nextRecord.closedAt) nextRecord.closedAt = nowIso;

  return nextRecord;
}

module.exports = {
  OPERATION_STATE_SCHEMA_VERSION,
  OPERATION_STATES,
  TERMINAL_OPERATION_STATES,
  normalizeOperationState,
  isKnownOperationState,
  isTerminalOperationState,
  canTransitionOperationState,
  validateOperationTransition,
  assertValidOperationTransition,
  normalizeIsoTimestamp,
  applyOperationLifecycleState,
};
