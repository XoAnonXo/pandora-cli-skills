const { toNumber, round } = require('../shared/utils.cjs');
const { buildHedgeExecutionPlan } = require('./execution.cjs');
const { assessMirrorSourceFreshness } = require('./source_freshness.cjs');

const MIRROR_SYNC_GATE_CODES = Object.freeze([
  'MATCH_AND_RULES',
  'POLYMARKET_SOURCE_FRESH',
  'CLOSE_TIME_DELTA',
  'DEPTH_COVERAGE',
  'MAX_OPEN_EXPOSURE',
  'MAX_TRADES_PER_DAY',
  'MIN_TIME_TO_EXPIRY',
]);
const DIAGNOSTIC_VERIFY_GATE_CODES = new Set(['CLOSE_TIME_DELTA']);

function resolveHedgeReferencePrice(depthEntry) {
  if (!depthEntry || typeof depthEntry !== 'object') return null;
  const referencePrice = toNumber(depthEntry.referencePrice);
  if (referencePrice !== null && referencePrice > 0) return referencePrice;
  const midPrice = toNumber(depthEntry.midPrice);
  if (midPrice !== null && midPrice > 0) return midPrice;
  const worstPrice = toNumber(depthEntry.worstPrice);
  if (worstPrice !== null && worstPrice > 0) return worstPrice;
  return null;
}

function resolveDepthSharesCapacity(depthUsd, depthShares, referencePrice) {
  const explicitDepthShares = toNumber(depthShares);
  if (explicitDepthShares !== null) return explicitDepthShares;
  const availableDepthUsd = toNumber(depthUsd);
  const sharePrice = toNumber(referencePrice);
  if (availableDepthUsd === null || sharePrice === null || sharePrice <= 0) return 0;
  return round(availableDepthUsd / sharePrice, 6) || 0;
}

/**
 * Read an expiry field from verify payload in seconds.
 * @param {object} verifyPayload
 * @param {string} fieldName
 * @returns {number|null}
 */
function readExpiryFieldSec(verifyPayload, fieldName) {
  return verifyPayload && verifyPayload.expiry && Number.isFinite(Number(verifyPayload.expiry[fieldName]))
    ? Number(verifyPayload.expiry[fieldName])
    : null;
}

/**
 * Read min-time-to-expiry from verify payload in seconds.
 * @param {object} verifyPayload
 * @returns {number|null}
 */
function readMinTimeToExpirySec(verifyPayload) {
  return readExpiryFieldSec(verifyPayload, 'minTimeToExpirySec');
}

/**
 * Read Pandora time-to-expiry from verify payload in seconds.
 * @param {object} verifyPayload
 * @returns {number|null}
 */
function readPandoraTimeToExpirySec(verifyPayload) {
  return readExpiryFieldSec(verifyPayload, 'pandoraTimeToExpirySec');
}

/**
 * Read source-market time-to-expiry from verify payload in seconds.
 * @param {object} verifyPayload
 * @returns {number|null}
 */
function readSourceTimeToExpirySec(verifyPayload) {
  return readExpiryFieldSec(verifyPayload, 'sourceTimeToExpirySec');
}

/**
 * Derive sync metrics from verification payloads.
 * `driftBps` is in basis points; reserve/delta/hedge fields are decimal USDC.
 * @param {object} verifyPayload
 * @param {{driftTriggerBps: number}} options
 * @returns {{
 *   sourceYesPct: number|null,
 *   pandoraYesPct: number|null,
 *   driftBps: number|null,
 *   driftTriggered: boolean,
 *   reserveYesUsdc: number|null,
 *   reserveNoUsdc: number|null,
 *   reserveTotalUsdc: number|null,
 *   deltaLpUsdc: number|null,
 *   targetHedgeUsdc: number|null,
 *   pandoraTimeToExpirySec: number|null,
 *   sourceTimeToExpirySec: number|null,
 *   minTimeToExpirySec: number|null
 * }}
 */
function evaluateSnapshot(verifyPayload, options) {
  const pandora = verifyPayload.pandora || {};
  const source = verifyPayload.sourceMarket || {};

  const sourceYes = toNumber(source.yesPct);
  const pandoraYes = toNumber(pandora.yesPct);

  const driftBps = sourceYes !== null && pandoraYes !== null ? Math.abs(sourceYes - pandoraYes) * 100 : null;
  const driftTriggered = driftBps !== null && driftBps >= options.driftTriggerBps;

  const reserveYes = toNumber(pandora.reserveYes);
  const reserveNo = toNumber(pandora.reserveNo);
  const reserveTotalUsdc = reserveYes !== null && reserveNo !== null ? round(reserveYes + reserveNo, 6) : null;
  const deltaLpUsdc = reserveYes !== null && reserveNo !== null ? round(reserveYes - reserveNo, 6) : null;
  const targetHedgeUsdc = deltaLpUsdc === null ? null : round(-deltaLpUsdc, 6);
  const pandoraTimeToExpirySec = readPandoraTimeToExpirySec(verifyPayload);
  const sourceTimeToExpirySec = readSourceTimeToExpirySec(verifyPayload);
  const minTimeToExpirySec = readMinTimeToExpirySec(verifyPayload);

  return {
    sourceYesPct: sourceYes,
    pandoraYesPct: pandoraYes,
    driftBps,
    driftTriggered,
    reserveYesUsdc: reserveYes,
    reserveNoUsdc: reserveNo,
    reserveTotalUsdc,
    deltaLpUsdc,
    targetHedgeUsdc,
    pandoraTimeToExpirySec,
    sourceTimeToExpirySec,
    minTimeToExpirySec,
  };
}

/**
 * Evaluate hard execution gates before submitting live sync actions.
 * @param {object} context
 * @returns {{ok: boolean, failedChecks: string[], checks: Array<{code: string, ok: boolean, message: string, details: any}>}}
 */
function evaluateStrictGates(context) {
  const failures = [];
  const checks = [];

  const add = (code, ok, message, details = null) => {
    checks.push({ code, ok, message, details });
    if (!ok) failures.push(code);
  };

  const verify = context.verifyPayload;
  const verifyGate = verify && verify.gateResult ? verify.gateResult : null;
  const verifyGateFailedChecksRaw = verifyGate && Array.isArray(verifyGate.failedChecks) ? verifyGate.failedChecks : null;
  const verifyGateFailedChecks = Array.isArray(verifyGateFailedChecksRaw)
    ? verifyGateFailedChecksRaw.filter((code) => !DIAGNOSTIC_VERIFY_GATE_CODES.has(code))
    : null;
  add(
    'MATCH_AND_RULES',
    Boolean(verifyGate && Array.isArray(verifyGateFailedChecks) && verifyGateFailedChecks.length === 0),
    'Mirror match/rules lifecycle gates must pass. Close-time delta is tracked separately.',
    {
      failedChecks: verifyGateFailedChecks || ['UNKNOWN'],
      failedChecksRaw: verifyGateFailedChecksRaw || ['UNKNOWN'],
      diagnosticChecksIgnored: [...DIAGNOSTIC_VERIFY_GATE_CODES],
    },
  );

  const sourceType = String((verify && verify.sourceMarket && verify.sourceMarket.source) || '').toLowerCase();
  const sourceIsCached = sourceType === 'polymarket:cache';
  const hasSourceFreshness =
    Boolean(verify && verify.sourceMarket)
    && verify.sourceMarket.sourceFreshness
    && typeof verify.sourceMarket.sourceFreshness === 'object'
    && Object.keys(verify.sourceMarket.sourceFreshness).length > 0;
  const sourceFreshness = assessMirrorSourceFreshness(verify && verify.sourceMarket ? verify.sourceMarket : {}, {
    executeLive: Boolean(context.executeLive),
    intervalMs: context.intervalMs,
    sourceMaxAgeMs: context.sourceMaxAgeMs,
    nowMs: context.nowMs,
  });
  const sourceRequiresStream = Boolean(
    context.executeLive
    && hasSourceFreshness
    && sourceFreshness.streamPreferred
    && sourceFreshness.transport !== 'stream',
  );
  const sourceFreshEnough = hasSourceFreshness ? Boolean(sourceFreshness.fresh) : !sourceIsCached;
  const sourceFreshGateOk = context.executeLive
    ? !sourceIsCached && sourceFreshEnough && !sourceRequiresStream
    : true;
  add(
    'POLYMARKET_SOURCE_FRESH',
    sourceFreshGateOk,
    'Live mode requires fresh Polymarket source data when freshness metadata is available; cached source is always blocked.',
    {
      sourceType: sourceType || null,
      freshness: sourceFreshness,
      cachedSourceBlocked: sourceIsCached,
      freshnessMetadataPresent: hasSourceFreshness,
      requiresStream: sourceRequiresStream,
    },
  );

  const closeDeltaCheck =
    verifyGate && Array.isArray(verifyGate.checks)
      ? verifyGate.checks.find((item) => item.code === 'CLOSE_TIME_DELTA')
      : null;
  const strictCloseTimeDelta = Boolean(context.strictCloseTimeDelta);
  const closeDeltaOk = closeDeltaCheck ? closeDeltaCheck.ok : true;
  add(
    'CLOSE_TIME_DELTA',
    strictCloseTimeDelta ? closeDeltaOk : true,
    strictCloseTimeDelta
      ? 'Close-time delta must be within strict threshold.'
      : 'Close-time delta is diagnostic-only unless strict close-time delta mode is enabled.',
    {
      ...(closeDeltaCheck && closeDeltaCheck.meta ? closeDeltaCheck.meta : {}),
      sourceCheckOk: closeDeltaOk,
      strictCloseTimeDelta,
      diagnosticOnly: !strictCloseTimeDelta,
    },
  );

  const depthRequiredUsd =
    toNumber(context.plannedHedgeOrderUsd) !== null
      ? toNumber(context.plannedHedgeOrderUsd)
      : toNumber(context.plannedHedgeUsdc) || 0;
  const depthRequiredShares =
    toNumber(context.plannedHedgeShares) !== null
      ? toNumber(context.plannedHedgeShares)
      : toNumber(context.plannedHedgeUsdc) || 0;
  const explicitHedgeDepthUsd = toNumber(context.hedgeDepthWithinSlippageUsd);
  const explicitHedgeDepthShares = toNumber(context.hedgeDepthWithinSlippageShares);
  const depthAvailableUsd =
    explicitHedgeDepthUsd === null ? toNumber(context.depthWithinSlippageUsd) || 0 : explicitHedgeDepthUsd;
  const hedgeReferencePrice = toNumber(context.hedgeReferencePrice);
  const inferredDepthShares =
    explicitHedgeDepthUsd !== null
    && explicitHedgeDepthShares === null
    && hedgeReferencePrice !== null
    && hedgeReferencePrice > 0
      ? round(explicitHedgeDepthUsd / hedgeReferencePrice, 6) || 0
      : null;
  const depthAvailableShares =
    explicitHedgeDepthShares === null
      ? inferredDepthShares !== null
        ? inferredDepthShares
        : toNumber(context.depthWithinSlippageShares) || 0
      : explicitHedgeDepthShares;
  const depthSourceType = String(context.depthSourceType || '').toLowerCase();
  const depthFreshness = context.depthFreshness && typeof context.depthFreshness === 'object'
    ? context.depthFreshness
    : null;
  const depthUsesCachedOrMock = Boolean(
    context.usedCachedOrMockDepth
    || depthSourceType === 'polymarket:cache'
    || depthSourceType === 'polymarket:mock',
  );
  const depthTrustedForLive = depthFreshness && Object.prototype.hasOwnProperty.call(depthFreshness, 'trustedForLive')
    ? Boolean(depthFreshness.trustedForLive)
    : !depthUsesCachedOrMock;
  const depthFreshEnough = depthFreshness && Object.prototype.hasOwnProperty.call(depthFreshness, 'fresh')
    ? Boolean(depthFreshness.fresh)
    : !depthUsesCachedOrMock;
  const depthSourceGateOk = context.executeLive
    ? !depthUsesCachedOrMock && depthTrustedForLive && depthFreshEnough
    : true;
  add(
    'DEPTH_COVERAGE',
    depthRequiredShares <= 0
      ? true
      : depthSourceGateOk && depthAvailableUsd >= depthRequiredUsd && depthAvailableShares >= depthRequiredShares,
    'Source depth must cover both hedge spend and hedge share size at configured slippage.',
    {
      depthRequiredUsd,
      depthRequiredShares,
      depthAvailableUsd,
      depthAvailableShares,
      slippageBps: context.depthSlippageBps,
      depthSourceType: depthSourceType || null,
      depthUsesCachedOrMock,
      depthSourceGateOk,
      depthFreshness,
    },
  );

  const state = context.state;
  const postTradeHedgeExposure = Math.abs(
    (toNumber(state.currentHedgeUsdc) || 0) + (toNumber(context.plannedHedgeSignedUsdc) || 0),
  );
  const maxExposure = toNumber(context.maxOpenExposureUsdc);
  add(
    'MAX_OPEN_EXPOSURE',
    maxExposure === null ? true : postTradeHedgeExposure <= maxExposure,
    'Max open exposure must not be exceeded.',
    {
      postTradeHedgeExposure: round(postTradeHedgeExposure, 6),
      maxOpenExposureUsdc: maxExposure,
    },
  );

  add(
    'MAX_TRADES_PER_DAY',
    (toNumber(state.tradesToday) || 0) < context.maxTradesPerDay,
    'Daily trade cap must allow another execution.',
    {
      tradesToday: state.tradesToday,
      maxTradesPerDay: context.maxTradesPerDay,
    },
  );

  add(
    'MIN_TIME_TO_EXPIRY',
    context.tradingTimeToExpirySec === null ? true : context.tradingTimeToExpirySec >= context.minimumTimeToCloseSec,
    `Pandora trading time-to-expiry must be >= ${context.minimumTimeToCloseSec}s for sync runtime.`,
    {
      tradingTimeToExpirySec: context.tradingTimeToExpirySec,
      pandoraTimeToExpirySec: context.pandoraTimeToExpirySec,
      sourceTimeToExpirySec: context.sourceTimeToExpirySec,
      minTimeToExpirySec: context.minTimeToExpirySec,
      minimumTimeToCloseSec: context.minimumTimeToCloseSec,
    },
  );

  return {
    ok: failures.length === 0,
    failedChecks: failures,
    checks,
  };
}

function normalizeSkipGateChecks(rawChecks) {
  if (!Array.isArray(rawChecks)) return [];
  const allowed = new Set(MIRROR_SYNC_GATE_CODES);
  return Array.from(
    new Set(
      rawChecks
        .map((value) => String(value || '').trim().toUpperCase())
        .filter((value) => value && allowed.has(value)),
    ),
  );
}

function applyGateBypassPolicy(gate, options) {
  const failedChecksRaw = Array.isArray(gate && gate.failedChecks) ? [...gate.failedChecks] : [];
  const forceGate = Boolean(options && options.forceGate);
  const skipGateChecks = forceGate ? [] : normalizeSkipGateChecks(options && options.skipGateChecks);
  const skipSet = new Set(skipGateChecks);
  const bypassedFailedChecks = forceGate
    ? failedChecksRaw
    : failedChecksRaw.filter((code) => skipSet.has(code));
  const failedChecks = forceGate
    ? []
    : failedChecksRaw.filter((code) => !skipSet.has(code));

  return {
    ...(gate || { checks: [] }),
    ok: failedChecks.length === 0,
    failedChecks,
    failedChecksRaw,
    bypassedFailedChecks,
    skipGateChecksApplied: forceGate ? ['*'] : skipGateChecks,
    forceGate,
  };
}

/**
 * Resolve runtime minimum time-to-close guard in seconds.
 * @param {object} options
 * @returns {number}
 */
function resolveMinimumTimeToCloseSec(options) {
  const configuredMinTimeToCloseSec = Number.isInteger(Number(options.minTimeToCloseSec))
    ? Math.max(1, Math.trunc(Number(options.minTimeToCloseSec)))
    : 1800;
  return Math.max(
    Math.ceil((options.intervalMs || 5_000) / 1000) * 2,
    configuredMinTimeToCloseSec,
  );
}

/**
 * Build strict-gate evaluation context for a tick.
 * @param {{verifyPayload: object, options: object, state: object, plan: object, snapshotMetrics: object, depth: object, minimumTimeToCloseSec: number}} params
 * @returns {object}
 */
function buildTickGateContext(params) {
  const { verifyPayload, options, state, plan, snapshotMetrics, depth, minimumTimeToCloseSec } = params;
  const hedgeExecutionPlan =
    plan && plan.plannedHedgeShares > 0
      ? buildHedgeExecutionPlan({
        options,
        plan,
        state,
        verifyPayload,
        depth,
      })
      : null;
  const hedgeDepthEntry =
    hedgeExecutionPlan
    && hedgeExecutionPlan.enabled
    && hedgeExecutionPlan.hedgeDepth
      ? hedgeExecutionPlan.hedgeDepth
      : null;
  const hedgeReferencePrice = resolveHedgeReferencePrice(hedgeDepthEntry);
  const depthSourceType = String(
    (hedgeDepthEntry && hedgeDepthEntry.sourceType)
    || (depth && depth.depthSourceType)
    || '',
  ).toLowerCase() || null;
  const depthFreshness = depth && depth.depthFreshness && typeof depth.depthFreshness === 'object'
    ? depth.depthFreshness
    : null;
  const usedCachedOrMockDepth = Boolean(
    (hedgeDepthEntry && hedgeDepthEntry.usedCachedOrMockDepth)
    || (depth && depth.usedCachedOrMockDepth),
  );
  const hedgeDepthWithinSlippageUsd = hedgeDepthEntry ? hedgeDepthEntry.depthUsd : null;
  const hedgeDepthWithinSlippageShares = resolveDepthSharesCapacity(
    hedgeDepthWithinSlippageUsd,
    hedgeDepthEntry ? hedgeDepthEntry.depthShares : null,
    hedgeReferencePrice,
  );
  const plannedHedgeOrderUsd =
    hedgeExecutionPlan && hedgeExecutionPlan.amountUsdc !== null && hedgeExecutionPlan.amountUsdc !== undefined
      ? hedgeExecutionPlan.amountUsdc
      : plan.plannedHedgeOrderUsd !== null && plan.plannedHedgeOrderUsd !== undefined
        ? plan.plannedHedgeOrderUsd
      : round((toNumber(plan.plannedHedgeShares) || 0) * (hedgeReferencePrice || 1), 6) || 0;
  return {
    verifyPayload,
    executeLive: options.executeLive,
    intervalMs: options.intervalMs,
    sourceMaxAgeMs: options.sourceMaxAgeMs || null,
    nowMs: Date.now(),
    state,
    plannedHedgeUsdc: plan.plannedHedgeUsdc,
    plannedHedgeShares: plan.plannedHedgeShares,
    plannedHedgeOrderUsd,
    hedgeReferencePrice,
    plannedSpendUsdc: round((toNumber(plan.plannedRebalanceUsdc) || 0) + plannedHedgeOrderUsd, 6) || 0,
    plannedHedgeSignedUsdc: plan.plannedHedgeSignedUsdc,
    tradingTimeToExpirySec: snapshotMetrics.pandoraTimeToExpirySec,
    pandoraTimeToExpirySec: snapshotMetrics.pandoraTimeToExpirySec,
    sourceTimeToExpirySec: snapshotMetrics.sourceTimeToExpirySec,
    minTimeToExpirySec: snapshotMetrics.minTimeToExpirySec,
    minimumTimeToCloseSec,
    depthWithinSlippageUsd: depth.depthWithinSlippageUsd,
    hedgeDepthWithinSlippageUsd,
    hedgeDepthWithinSlippageShares,
    depthWithinSlippageShares: hedgeDepthWithinSlippageShares,
    depthSlippageBps: options.depthSlippageBps,
    maxOpenExposureUsdc: options.maxOpenExposureUsdc,
    maxTradesPerDay: options.maxTradesPerDay,
    strictCloseTimeDelta: options.strictCloseTimeDelta,
    depthSourceType,
    depthFreshness,
    usedCachedOrMockDepth,
  };
}

/**
 * Verify mirror pair once at startup and enforce expiry guard.
 * @param {{verifyFn: Function, options: object, minimumTimeToCloseSec: number, buildVerifyRequest: Function, createServiceError: Function}} params
 * @returns {Promise<object>}
 */
async function runStartupVerify(params) {
  const { verifyFn, options, minimumTimeToCloseSec, buildVerifyRequest, createServiceError } = params;
  const payload = await verifyFn(buildVerifyRequest(options));
  const startupPandoraTime = readPandoraTimeToExpirySec(payload);
  const startupSourceTime = readSourceTimeToExpirySec(payload);
  const startupMinTime = readMinTimeToExpirySec(payload);
  if (startupMinTime !== null && startupMinTime < minimumTimeToCloseSec) {
    throw createServiceError(
      'MIRROR_EXPIRY_TOO_CLOSE',
      `Mirror sync refused to start because the effective trading window is too close (${startupMinTime}s < ${minimumTimeToCloseSec}s).`,
      {
        startupPandoraTimeToExpirySec: startupPandoraTime,
        startupSourceTimeToExpirySec: startupSourceTime,
        startupMinTimeToExpirySec: startupMinTime,
        minimumTimeToCloseSec,
      },
    );
  }
  return payload;
}

module.exports = {
  MIRROR_SYNC_GATE_CODES,
  readMinTimeToExpirySec,
  readPandoraTimeToExpirySec,
  readSourceTimeToExpirySec,
  evaluateSnapshot,
  evaluateStrictGates,
  normalizeSkipGateChecks,
  applyGateBypassPolicy,
  resolveMinimumTimeToCloseSec,
  buildTickGateContext,
  runStartupVerify,
};
