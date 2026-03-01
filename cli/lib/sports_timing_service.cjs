const { toNumber } = require('./shared/utils.cjs');

/**
 * Default timing policy values (spec defaults) for sports market lifecycle checks.
 */
const SPORTS_TIMING_SPEC_DEFAULTS = Object.freeze({
  creationOpenLeadMs: 24 * 60 * 60 * 1000,
  creationCloseLeadMs: 90 * 60 * 1000,
  assumedEventDurationMs: 2 * 60 * 60 * 1000,
  resolveOpenDelayMs: 10 * 60 * 1000,
  resolveTargetDelayMs: 2 * 60 * 60 * 1000,
  resolveCloseDelayMs: 48 * 60 * 60 * 1000,
});

/**
 * Convert epoch/date input to milliseconds.
 * Accepts ms epoch, sec epoch, Date, or parseable date string.
 *
 * @param {number|string|Date} value
 * @returns {number|null}
 */
function toEpochMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  const numeric = toNumber(value);
  if (numeric !== null) {
    if (numeric > 0 && numeric < 10_000_000_000) return Math.round(numeric * 1000);
    return Math.round(numeric);
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toPositiveMs(value, fallback) {
  const numeric = toNumber(value);
  if (numeric === null || numeric < 0) return fallback;
  return Math.round(numeric);
}

function toIso(valueMs) {
  if (!Number.isFinite(valueMs)) return null;
  return new Date(valueMs).toISOString();
}

/**
 * Resolve a timing spec from defaults with optional positive millisecond overrides.
 *
 * @param {object} [overrides]
 * @returns {{
 *   creationOpenLeadMs: number,
 *   creationCloseLeadMs: number,
 *   assumedEventDurationMs: number,
 *   resolveOpenDelayMs: number,
 *   resolveTargetDelayMs: number,
 *   resolveCloseDelayMs: number
 * }}
 */
function resolveTimingSpec(overrides = {}) {
  const spec = {
    creationOpenLeadMs: toPositiveMs(overrides.creationOpenLeadMs, SPORTS_TIMING_SPEC_DEFAULTS.creationOpenLeadMs),
    creationCloseLeadMs: toPositiveMs(overrides.creationCloseLeadMs, SPORTS_TIMING_SPEC_DEFAULTS.creationCloseLeadMs),
    assumedEventDurationMs: toPositiveMs(
      overrides.assumedEventDurationMs,
      SPORTS_TIMING_SPEC_DEFAULTS.assumedEventDurationMs,
    ),
    resolveOpenDelayMs: toPositiveMs(overrides.resolveOpenDelayMs, SPORTS_TIMING_SPEC_DEFAULTS.resolveOpenDelayMs),
    resolveTargetDelayMs: toPositiveMs(
      overrides.resolveTargetDelayMs,
      SPORTS_TIMING_SPEC_DEFAULTS.resolveTargetDelayMs,
    ),
    resolveCloseDelayMs: toPositiveMs(overrides.resolveCloseDelayMs, SPORTS_TIMING_SPEC_DEFAULTS.resolveCloseDelayMs),
  };

  if (spec.creationCloseLeadMs >= spec.creationOpenLeadMs) {
    spec.creationCloseLeadMs = Math.max(0, spec.creationOpenLeadMs - 60_000);
  }
  if (spec.resolveTargetDelayMs > spec.resolveCloseDelayMs) {
    spec.resolveTargetDelayMs = spec.resolveCloseDelayMs;
  }
  return spec;
}

/**
 * Plan market creation window relative to event start.
 *
 * @param {{eventStartMs: number|string|Date, spec?: object}} input
 * @returns {{
 *   eventStartMs: number|null,
 *   opensAtMs: number|null,
 *   closesAtMs: number|null,
 *   opensAt: string|null,
 *   closesAt: string|null,
 *   valid: boolean,
 *   spec: object
 * }}
 */
function planCreationWindow(input) {
  const spec = resolveTimingSpec(input && input.spec ? input.spec : {});
  const eventStartMs = toEpochMs(input && input.eventStartMs);
  if (!Number.isFinite(eventStartMs)) {
    return {
      eventStartMs: null,
      opensAtMs: null,
      closesAtMs: null,
      opensAt: null,
      closesAt: null,
      valid: false,
      spec,
    };
  }

  const opensAtMs = eventStartMs - spec.creationOpenLeadMs;
  const closesAtMs = eventStartMs - spec.creationCloseLeadMs;
  const valid = closesAtMs > opensAtMs;
  return {
    eventStartMs,
    opensAtMs,
    closesAtMs,
    opensAt: toIso(opensAtMs),
    closesAt: toIso(closesAtMs),
    valid,
    spec,
  };
}

/**
 * Evaluate creation open/close gate status at a given timestamp.
 *
 * @param {{nowMs: number|string|Date, eventStartMs: number|string|Date, spec?: object}} input
 * @returns {{
 *   status: 'invalid'|'pre-open'|'open'|'closed',
 *   canCreate: boolean,
 *   openGatePassed: boolean,
 *   closeGatePassed: boolean,
 *   opensInMs: number|null,
 *   closesInMs: number|null,
 *   window: object
 * }}
 */
function getCreationWindowStatus(input) {
  const window = planCreationWindow({
    eventStartMs: input && input.eventStartMs,
    spec: input && input.spec,
  });
  const nowMs = toEpochMs(input && input.nowMs);

  if (!window.valid || !Number.isFinite(nowMs)) {
    return {
      status: 'invalid',
      canCreate: false,
      openGatePassed: false,
      closeGatePassed: false,
      opensInMs: null,
      closesInMs: null,
      window,
    };
  }

  const openGatePassed = nowMs >= window.opensAtMs;
  const closeGatePassed = nowMs < window.closesAtMs;
  let status = 'closed';
  if (!openGatePassed) status = 'pre-open';
  else if (closeGatePassed) status = 'open';

  return {
    status,
    canCreate: status === 'open',
    openGatePassed,
    closeGatePassed,
    opensInMs: window.opensAtMs - nowMs,
    closesInMs: window.closesAtMs - nowMs,
    window,
  };
}

/**
 * Plan resolve window using event end when provided, otherwise spec default duration.
 *
 * @param {{eventStartMs: number|string|Date, eventEndMs?: number|string|Date, spec?: object}} input
 * @returns {{
 *   eventStartMs: number|null,
 *   eventEndMs: number|null,
 *   eventEndSource: 'provided'|'derived'|null,
 *   resolveOpenAtMs: number|null,
 *   resolveTargetAtMs: number|null,
 *   resolveCloseAtMs: number|null,
 *   resolveOpenAt: string|null,
 *   resolveTargetAt: string|null,
 *   resolveCloseAt: string|null,
 *   valid: boolean,
 *   spec: object
 * }}
 */
function planResolveWindow(input) {
  const spec = resolveTimingSpec(input && input.spec ? input.spec : {});
  const eventStartMs = toEpochMs(input && input.eventStartMs);
  if (!Number.isFinite(eventStartMs)) {
    return {
      eventStartMs: null,
      eventEndMs: null,
      eventEndSource: null,
      resolveOpenAtMs: null,
      resolveTargetAtMs: null,
      resolveCloseAtMs: null,
      resolveOpenAt: null,
      resolveTargetAt: null,
      resolveCloseAt: null,
      valid: false,
      spec,
    };
  }

  const providedEventEndMs = toEpochMs(input && input.eventEndMs);
  const eventEndMs =
    providedEventEndMs !== null ? providedEventEndMs : eventStartMs + spec.assumedEventDurationMs;
  const eventEndSource = providedEventEndMs !== null ? 'provided' : 'derived';

  const resolveOpenAtMs = eventEndMs + spec.resolveOpenDelayMs;
  const resolveTargetAtMs = resolveOpenAtMs + spec.resolveTargetDelayMs;
  const resolveCloseAtMs = resolveOpenAtMs + spec.resolveCloseDelayMs;

  return {
    eventStartMs,
    eventEndMs,
    eventEndSource,
    resolveOpenAtMs,
    resolveTargetAtMs,
    resolveCloseAtMs,
    resolveOpenAt: toIso(resolveOpenAtMs),
    resolveTargetAt: toIso(resolveTargetAtMs),
    resolveCloseAt: toIso(resolveCloseAtMs),
    valid: resolveCloseAtMs >= resolveOpenAtMs,
    spec,
  };
}

/**
 * Evaluate resolve window status at a given timestamp.
 *
 * @param {{
 *   nowMs: number|string|Date,
 *   eventStartMs: number|string|Date,
 *   eventEndMs?: number|string|Date,
 *   spec?: object
 * }} input
 * @returns {{
 *   status: 'invalid'|'pre-resolve'|'resolvable'|'resolve-closed',
 *   canResolve: boolean,
 *   resolveWindowClosed: boolean,
 *   opensInMs: number|null,
 *   closesInMs: number|null,
 *   window: object
 * }}
 */
function getResolveWindowStatus(input) {
  const window = planResolveWindow({
    eventStartMs: input && input.eventStartMs,
    eventEndMs: input && input.eventEndMs,
    spec: input && input.spec,
  });
  const nowMs = toEpochMs(input && input.nowMs);

  if (!window.valid || !Number.isFinite(nowMs)) {
    return {
      status: 'invalid',
      canResolve: false,
      resolveWindowClosed: false,
      opensInMs: null,
      closesInMs: null,
      window,
    };
  }

  if (nowMs < window.resolveOpenAtMs) {
    return {
      status: 'pre-resolve',
      canResolve: false,
      resolveWindowClosed: false,
      opensInMs: window.resolveOpenAtMs - nowMs,
      closesInMs: window.resolveCloseAtMs - nowMs,
      window,
    };
  }

  if (nowMs > window.resolveCloseAtMs) {
    return {
      status: 'resolve-closed',
      canResolve: false,
      resolveWindowClosed: true,
      opensInMs: window.resolveOpenAtMs - nowMs,
      closesInMs: window.resolveCloseAtMs - nowMs,
      window,
    };
  }

  return {
    status: 'resolvable',
    canResolve: true,
    resolveWindowClosed: false,
    opensInMs: window.resolveOpenAtMs - nowMs,
    closesInMs: window.resolveCloseAtMs - nowMs,
    window,
  };
}

/**
 * Convenience planner for full timing status and gate checks.
 *
 * @param {{
 *   nowMs: number|string|Date,
 *   eventStartMs: number|string|Date,
 *   eventEndMs?: number|string|Date,
 *   spec?: object
 * }} input
 * @returns {{
 *   creation: object,
 *   resolve: object,
 *   gates: {
 *     creationOpen: boolean,
 *     creationClosed: boolean,
 *     resolveReady: boolean,
 *     resolveClosed: boolean
 *   }
 * }}
 */
function evaluateTimingStatus(input) {
  const creation = getCreationWindowStatus(input);
  const resolve = getResolveWindowStatus(input);
  return {
    creation,
    resolve,
    gates: {
      creationOpen: creation.canCreate,
      creationClosed: creation.status === 'closed',
      resolveReady: resolve.canResolve,
      resolveClosed: resolve.resolveWindowClosed === true,
    },
  };
}

module.exports = {
  SPORTS_TIMING_SPEC_DEFAULTS,
  toEpochMs,
  resolveTimingSpec,
  planCreationWindow,
  getCreationWindowStatus,
  planResolveWindow,
  getResolveWindowStatus,
  evaluateTimingStatus,
};
