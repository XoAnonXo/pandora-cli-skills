const SPORTS_SYNC_SCHEMA_VERSION = '1.0.0';
const { createSyncOperationBridge } = require('./shared/operation_bridge.cjs');

const DEFAULT_SYNC_CADENCE_MS = Object.freeze({
  prematch: 30_000,
  live: 5_000,
  nearSettle: 2_000,
});

const DEFAULT_AUTO_PAUSE_THRESHOLDS = Object.freeze({
  maxDataAgeMs: 120_000,
  minCoverageRatio: 0.7,
  maxCoverageDropRatio: 0.25,
  maxSpreadJumpBps: 150,
  maxConsecutiveFailures: 3,
  maxConsecutiveGateFailures: 2,
});

/**
 * Normalize an unknown timestamp input into epoch milliseconds.
 * @param {unknown} value
 * @returns {number|null}
 */
function toEpochMs(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * Convert a date-like value to ISO-8601 format.
 * @param {unknown} value
 * @returns {string}
 */
function toIso(value) {
  const ms = toEpochMs(value);
  return new Date(ms === null ? Date.now() : ms).toISOString();
}
/**
 * Infer sync event state (`prematch`, `live`, `near-settle`) from common feed fields.
 * @param {object} event
 * @param {{now?: Date|string|number, nearSettleWindowMs?: number}} [options]
 * @returns {{state: 'prematch'|'live'|'near-settle', reason: string, nowMs: number, startMs: number|null, settleMs: number|null, nearSettleWindowMs: number}}
 */
function deriveEventState(event = {}, options = {}) {
  const nowMs = toEpochMs(options.now);
  const currentMs = nowMs === null ? Date.now() : nowMs;
  const nearSettleWindowMs =
    Number.isFinite(options.nearSettleWindowMs) && options.nearSettleWindowMs > 0
      ? Number(options.nearSettleWindowMs)
      : 15 * 60 * 1000;

  const rawState = String(
    event.eventState || event.state || event.status || event.phase || event.marketState || '',
  )
    .trim()
    .toLowerCase();

  const startMs = toEpochMs(event.startAt || event.startsAt || event.startTime || event.commenceTime || null);
  const settleMs = toEpochMs(event.settleAt || event.settlesAt || event.endAt || event.endsAt || event.resolveAt || event.resolvesAt || null);

  const base = { nowMs: currentMs, startMs, settleMs, nearSettleWindowMs };

  const explicitNearSettle =
    event.nearSettle === true ||
    rawState.includes('near') ||
    rawState.includes('settle') ||
    rawState.includes('final') ||
    rawState.includes('post');

  if (explicitNearSettle) {
    return { state: 'near-settle', reason: 'explicit-near-settle-state', ...base };
  }

  if (Number.isFinite(settleMs) && settleMs >= currentMs && settleMs - currentMs <= nearSettleWindowMs) {
    return { state: 'near-settle', reason: 'within-near-settle-window', ...base };
  }

  const explicitLive =
    event.isLive === true || rawState.includes('live') || rawState.includes('in-play') || rawState.includes('inplay');

  if (explicitLive) {
    return { state: 'live', reason: 'explicit-live-state', ...base };
  }

  if (Number.isFinite(startMs) && startMs <= currentMs) {
    return { state: 'live', reason: 'past-event-start-time', ...base };
  }

  return { state: 'prematch', reason: 'default-prematch', ...base };
}

/**
 * Derive cadence from event state with conservative defaults.
 * @param {object} event
 * @param {{now?: Date|string|number, nearSettleWindowMs?: number, cadenceMs?: {prematch?: number, live?: number, nearSettle?: number, 'near-settle'?: number}}} [options]
 * @returns {{state: 'prematch'|'live'|'near-settle', cadenceMs: number, reason: string, source: string, nearSettleWindowMs: number}}
 */
function deriveCadenceByEventState(event = {}, options = {}) {
  const stateInfo = deriveEventState(event, options);
  const overrides = options.cadenceMs || {};

  const prematchCadence =
    Number.isFinite(overrides.prematch) && overrides.prematch > 0 ? Number(overrides.prematch) : DEFAULT_SYNC_CADENCE_MS.prematch;
  const liveCadence =
    Number.isFinite(overrides.live) && overrides.live > 0 ? Number(overrides.live) : DEFAULT_SYNC_CADENCE_MS.live;
  const nearSettleCadenceInput = overrides['near-settle'];
  const nearSettleCadence =
    Number.isFinite(nearSettleCadenceInput) && nearSettleCadenceInput > 0
      ? Number(nearSettleCadenceInput)
      : DEFAULT_SYNC_CADENCE_MS.nearSettle;

  const cadenceMsByState = {
    prematch: prematchCadence,
    live: liveCadence,
    'near-settle': nearSettleCadence,
  };

  return {
    state: stateInfo.state,
    cadenceMs: cadenceMsByState[stateInfo.state],
    reason: stateInfo.reason,
    source: 'event-state-cadence',
    nearSettleWindowMs: stateInfo.nearSettleWindowMs,
  };
}

/**
 * Coerce trigger diagnostics to a normalized list.
 * @param {Array<object|string>} diagnostics
 * @returns {Array<object>}
 */
function normalizeDiagnostics(diagnostics) {
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.map((item) => {
    if (typeof item === 'string') {
      return {
        code: 'NOTE',
        severity: 'info',
        message: item,
      };
    }
    return item && typeof item === 'object'
      ? {
          code: item.code || 'NOTE',
          severity: item.severity || 'info',
          message: item.message || String(item.code || 'Diagnostic'),
          details: item.details,
        }
      : {
          code: 'NOTE',
          severity: 'info',
          message: String(item),
        };
  });
}

/**
 * Evaluate conservative auto-pause triggers from sync health signals.
 * @param {object} input
 * @param {number} [input.dataAgeMs]
 * @param {number} [input.coverageRatio]
 * @param {number} [input.previousCoverageRatio]
 * @param {number} [input.spreadBps]
 * @param {number} [input.previousSpreadBps]
 * @param {number} [input.consecutiveFailures]
 * @param {number} [input.consecutiveGateFailures]
 * @param {boolean} [input.gatePassed]
 * @param {object} [input.thresholds]
 * @returns {{autoPause: boolean, triggerCount: number, triggers: Array<object>, thresholds: object}}
 */
function evaluateAutoPauseTriggers(input = {}) {
  const thresholds = {
    ...DEFAULT_AUTO_PAUSE_THRESHOLDS,
    ...(input.thresholds && typeof input.thresholds === 'object' ? input.thresholds : {}),
  };

  const triggers = [];

  if (Number.isFinite(input.dataAgeMs) && input.dataAgeMs > thresholds.maxDataAgeMs) {
    triggers.push({
      code: 'STALE_DATA',
      severity: 'error',
      message: 'Auto-pause: data feed is stale.',
      details: {
        observedDataAgeMs: Number(input.dataAgeMs),
        maxDataAgeMs: Number(thresholds.maxDataAgeMs),
      },
    });
  }

  const hasCoverage = Number.isFinite(input.coverageRatio);
  if (hasCoverage && input.coverageRatio < thresholds.minCoverageRatio) {
    triggers.push({
      code: 'COVERAGE_COLLAPSE',
      severity: 'error',
      message: 'Auto-pause: active market/data coverage fell below threshold.',
      details: {
        observedCoverageRatio: Number(input.coverageRatio),
        minCoverageRatio: Number(thresholds.minCoverageRatio),
      },
    });
  }

  if (Number.isFinite(input.previousCoverageRatio) && hasCoverage) {
    const dropRatio = Number(input.previousCoverageRatio) - Number(input.coverageRatio);
    if (dropRatio >= thresholds.maxCoverageDropRatio) {
      triggers.push({
        code: 'COVERAGE_DROP_JUMP',
        severity: 'error',
        message: 'Auto-pause: abrupt coverage drop detected.',
        details: {
          observedCoverageDropRatio: dropRatio,
          maxCoverageDropRatio: Number(thresholds.maxCoverageDropRatio),
          previousCoverageRatio: Number(input.previousCoverageRatio),
          coverageRatio: Number(input.coverageRatio),
        },
      });
    }
  }

  if (Number.isFinite(input.spreadBps) && Number.isFinite(input.previousSpreadBps)) {
    const spreadJumpBps = Math.abs(Number(input.spreadBps) - Number(input.previousSpreadBps));
    if (spreadJumpBps >= thresholds.maxSpreadJumpBps) {
      triggers.push({
        code: 'SPREAD_JUMP',
        severity: 'error',
        message: 'Auto-pause: spread jump exceeded conservative safety threshold.',
        details: {
          spreadJumpBps,
          maxSpreadJumpBps: Number(thresholds.maxSpreadJumpBps),
          previousSpreadBps: Number(input.previousSpreadBps),
          spreadBps: Number(input.spreadBps),
        },
      });
    }
  }

  if (Number.isFinite(input.consecutiveFailures) && input.consecutiveFailures >= thresholds.maxConsecutiveFailures) {
    triggers.push({
      code: 'REPEATED_FAILURES',
      severity: 'error',
      message: 'Auto-pause: repeated runtime failures exceeded threshold.',
      details: {
        consecutiveFailures: Number(input.consecutiveFailures),
        maxConsecutiveFailures: Number(thresholds.maxConsecutiveFailures),
      },
    });
  }

  const gateFailed = input.gatePassed === false;
  if (
    gateFailed &&
    Number.isFinite(input.consecutiveGateFailures) &&
    input.consecutiveGateFailures >= thresholds.maxConsecutiveGateFailures
  ) {
    triggers.push({
      code: 'GATE_FAILURES',
      severity: 'error',
      message: 'Auto-pause: repeated gate failures exceeded threshold.',
      details: {
        consecutiveGateFailures: Number(input.consecutiveGateFailures),
        maxConsecutiveGateFailures: Number(thresholds.maxConsecutiveGateFailures),
      },
    });
  }

  return {
    autoPause: triggers.length > 0,
    triggerCount: triggers.length,
    triggers,
    thresholds,
  };
}

/**
 * Build daemon-like metadata fields used across sync lifecycle payloads.
 * @param {'once'|'run'|'start'|'stop'|'status'} action
 * @param {object} input
 * @returns {{found: boolean, alive: boolean, status: string, pid: number|null, pidFile: string|null, strategyHash: string|null, operationId: string|null, metadata: object}}
 */
function buildDaemonLikeFields(action, input = {}) {
  const pid = Number.isInteger(input.pid) && input.pid > 0 ? input.pid : null;
  const found = typeof input.found === 'boolean' ? input.found : action !== 'status';
  const alive = typeof input.alive === 'boolean' ? input.alive : action === 'start' || action === 'run';

  let status = typeof input.status === 'string' && input.status.trim() ? input.status.trim() : null;
  if (!status) {
    if (action === 'status') {
      status = found ? (alive ? 'running' : 'stopped') : 'not-found';
    } else if (action === 'stop') {
      status = alive ? 'running' : 'stopped';
    } else if (action === 'start' || action === 'run') {
      status = input.autoPaused ? 'paused' : alive ? 'running' : 'completed';
    } else {
      status = input.autoPaused ? 'paused' : 'completed';
    }
  }

  const checkedAt = toIso(input.now);
  const metadata = {
    checkedAt,
    startedAt: input.startedAt ? toIso(input.startedAt) : null,
    stoppedAt: input.stoppedAt ? toIso(input.stoppedAt) : null,
    mode: action === 'once' ? 'once' : 'run',
    action,
    pidFile: input.pidFile || null,
    strategyHash: input.strategyHash || null,
    operationId: input.operationId || input.strategyHash || null,
    counters:
      input.counters && typeof input.counters === 'object'
        ? {
            ...input.counters,
          }
        : null,
  };

  return {
    found,
    alive,
    status,
    pid,
    pidFile: input.pidFile || null,
    strategyHash: input.strategyHash || null,
    operationId: input.operationId || input.strategyHash || null,
    metadata,
  };
}

/**
 * Detect whether a sync runtime is already active for the same state file.
 * @param {object|null} existingState
 * @param {string|null} nextStrategyHash
 * @returns {{conflict: boolean, reason: string|null, existingStrategyHash: string|null}}
 */
function detectConcurrentSyncConflict(existingState, nextStrategyHash) {
  if (!existingState || typeof existingState !== 'object' || existingState.running !== true) {
    return {
      conflict: false,
      reason: null,
      existingStrategyHash: null,
    };
  }

  const existingStrategyHash = typeof existingState.strategyHash === 'string' ? existingState.strategyHash : null;
  if (!existingStrategyHash || !nextStrategyHash) {
    return {
      conflict: true,
      reason: 'running',
      existingStrategyHash,
    };
  }

  if (existingStrategyHash === nextStrategyHash) {
    return {
      conflict: true,
      reason: 'same-strategy-running',
      existingStrategyHash,
    };
  }

  return {
    conflict: true,
    reason: 'different-strategy-running',
    existingStrategyHash,
  };
}

/**
 * Build a schema-versioned sync lifecycle payload for `once|run|start|stop|status`.
 * @param {'once'|'run'|'start'|'stop'|'status'} action
 * @param {object} [input]
 * @returns {object}
 */
function buildSyncStatusPayload(action, input = {}) {
  if (!['once', 'run', 'start', 'stop', 'status'].includes(action)) {
    throw new Error('buildSyncStatusPayload action must be one of once|run|start|stop|status.');
  }
  const operation = createSyncOperationBridge(input, {
    command: `sports.sync.${action}`,
  });
  operation.ensure({
    phase: `sports.sync.${action}.start`,
    action,
    strategyHash: input.strategyHash || null,
  });

  const cadence =
    input.cadence && typeof input.cadence === 'object'
      ? input.cadence
      : input.event && typeof input.event === 'object'
        ? deriveCadenceByEventState(input.event, {
            now: input.now,
            nearSettleWindowMs: input.nearSettleWindowMs,
            cadenceMs: input.cadenceMs,
          })
        : null;

  const autoPause =
    input.autoPause && typeof input.autoPause === 'object'
      ? input.autoPause
      : evaluateAutoPauseTriggers({
          dataAgeMs: input.dataAgeMs,
          coverageRatio: input.coverageRatio,
          previousCoverageRatio: input.previousCoverageRatio,
          spreadBps: input.spreadBps,
          previousSpreadBps: input.previousSpreadBps,
          consecutiveFailures: input.consecutiveFailures,
          consecutiveGateFailures: input.consecutiveGateFailures,
          gatePassed: input.gatePassed,
          thresholds: input.thresholds,
        });

  const daemonLike = buildDaemonLikeFields(action, {
    ...input,
    operationId: input.operationId || operation.getOperationId() || null,
    autoPaused: Boolean(autoPause.autoPause),
  });
  operation.setOperationId(daemonLike.operationId);

  const diagnostics = normalizeDiagnostics(input.diagnostics);
  const triggerDiagnostics = Array.isArray(autoPause.triggers)
    ? autoPause.triggers.map((trigger) => ({
        code: trigger.code,
        severity: trigger.severity,
        message: trigger.message,
        details: trigger.details,
      }))
    : [];

  operation.update(daemonLike.status, {
    phase: `sports.sync.${action}.complete`,
    action,
    found: daemonLike.found,
    alive: daemonLike.alive,
    strategyHash: daemonLike.strategyHash || null,
  });

  return operation.attach({
    schemaVersion: SPORTS_SYNC_SCHEMA_VERSION,
    generatedAt: toIso(input.now),
    action,
    mode: action === 'once' ? 'once' : 'run',
    ...daemonLike,
    cadence,
    autoPause,
    diagnostics: [...diagnostics, ...triggerDiagnostics, ...operation.diagnostics],
  });
}

/**
 * Build status payload for a single-tick `once` sync run.
 * @param {object} [input]
 * @returns {object}
 */
function buildSyncOnceStatusPayload(input = {}) {
  return buildSyncStatusPayload('once', input);
}

/**
 * Build status payload for continuous `run` sync mode.
 * @param {object} [input]
 * @returns {object}
 */
function buildSyncRunStatusPayload(input = {}) {
  return buildSyncStatusPayload('run', input);
}

/**
 * Build status payload for daemon-like `start` action.
 * @param {object} [input]
 * @returns {object}
 */
function buildSyncStartStatusPayload(input = {}) {
  return buildSyncStatusPayload('start', input);
}

/**
 * Build status payload for daemon-like `stop` action.
 * @param {object} [input]
 * @returns {object}
 */
function buildSyncStopStatusPayload(input = {}) {
  return buildSyncStatusPayload('stop', input);
}

module.exports = {
  SPORTS_SYNC_SCHEMA_VERSION,
  DEFAULT_SYNC_CADENCE_MS,
  DEFAULT_AUTO_PAUSE_THRESHOLDS,
  detectConcurrentSyncConflict,
  deriveEventState,
  deriveCadenceByEventState,
  evaluateAutoPauseTriggers,
  buildSyncStatusPayload,
  buildSyncOnceStatusPayload,
  buildSyncRunStatusPayload,
  buildSyncStartStatusPayload,
  buildSyncStopStatusPayload,
};
