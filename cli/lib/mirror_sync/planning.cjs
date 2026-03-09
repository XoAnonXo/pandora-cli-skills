const { solveVolumeForTargetYesPct } = require('../mirror_econ_service.cjs');
const { toNumber, round } = require('../shared/utils.cjs');
const { normalizeSkipGateChecks } = require('./gates.cjs');
const { DEFAULT_MIRROR_MIN_CLOSE_LEAD_SECONDS } = require('../shared/mirror_timing.cjs');

/**
 * Build verify request input from mirror sync options.
 * @param {object} options
 * @returns {object}
 */
function buildVerifyRequest(options) {
  return {
    indexerUrl: options.indexerUrl,
    timeoutMs: options.timeoutMs,
    pandoraMarketAddress: options.pandoraMarketAddress,
    polymarketMarketId: options.polymarketMarketId,
    polymarketSlug: options.polymarketSlug,
    polymarketHost: options.polymarketHost,
    polymarketGammaUrl: options.polymarketGammaUrl,
    polymarketGammaMockUrl: options.polymarketGammaMockUrl,
    polymarketMockUrl: options.polymarketMockUrl,
    confidenceThreshold: 0.92,
    trustDeploy: Boolean(options.trustDeploy),
    allowRuleMismatch: false,
    includeSimilarity: false,
    executeLive: Boolean(options.executeLive),
    stream: Boolean(options.stream),
    enableRealtimeSourceFeed: Boolean(options.executeLive || options.stream),
    sourceMaxAgeMs: options.sourceMaxAgeMs,
    feedTimeoutMs: options.feedTimeoutMs,
    minCloseLeadSeconds:
      Number.isFinite(Number(options.minCloseLeadSeconds)) && Number(options.minCloseLeadSeconds) > 0
        ? Number(options.minCloseLeadSeconds)
        : DEFAULT_MIRROR_MIN_CLOSE_LEAD_SECONDS,
  };
}

/**
 * Build strategy payload used for state hashing.
 * @param {object} options
 * @returns {object}
 */
function buildSyncStrategy(options) {
  return {
    mode: options.mode,
    pandoraMarketAddress: options.pandoraMarketAddress,
    polymarketMarketId: options.polymarketMarketId,
    polymarketSlug: options.polymarketSlug,
    executeLive: options.executeLive,
    rebalanceSizingMode: normalizeRebalanceSizingMode(options.rebalanceSizingMode),
    priceSource: normalizePriceSource(options.priceSource),
    driftTriggerBps: options.driftTriggerBps,
    hedgeEnabled: options.hedgeEnabled,
    hedgeRatio: options.hedgeRatio,
    hedgeTriggerUsdc: options.hedgeTriggerUsdc,
    maxRebalanceUsdc: options.maxRebalanceUsdc,
    maxHedgeUsdc: options.maxHedgeUsdc,
    maxOpenExposureUsdc: options.maxOpenExposureUsdc,
    maxTradesPerDay: options.maxTradesPerDay,
    cooldownMs: options.cooldownMs,
    depthSlippageBps: options.depthSlippageBps,
    minTimeToCloseSec: options.minTimeToCloseSec,
    strictCloseTimeDelta: Boolean(options.strictCloseTimeDelta),
    forceGate: Boolean(options.forceGate),
    skipGateChecks: normalizeSkipGateChecks(options.skipGateChecks),
  };
}

function normalizeRebalanceSizingMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'incremental' ? 'incremental' : 'atomic';
}

function normalizePriceSource(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'indexer' ? 'indexer' : 'on-chain';
}

function derivePandoraYesPctFromReserves(reserveYesUsdc, reserveNoUsdc) {
  const reserveYes = toNumber(reserveYesUsdc);
  const reserveNo = toNumber(reserveNoUsdc);
  if (reserveYes === null || reserveNo === null) return null;
  const total = reserveYes + reserveNo;
  if (!Number.isFinite(total) || total <= 0) return null;
  return round((reserveNo / total) * 100, 6);
}

function resolveRuntimeReserveContext(options) {
  const raw = options && typeof options === 'object' ? options._runtimeReserveContext : null;
  if (!raw || typeof raw !== 'object') return null;
  const reserveYesUsdc = toNumber(raw.reserveYesUsdc);
  const reserveNoUsdc = toNumber(raw.reserveNoUsdc);
  const derivedYesPct = derivePandoraYesPctFromReserves(reserveYesUsdc, reserveNoUsdc);
  const explicitYesPct = toNumber(raw.pandoraYesPct);
  const feeTier = toNumber(raw.feeTier);
  return {
    source: raw.source ? String(raw.source) : null,
    reserveYesUsdc,
    reserveNoUsdc,
    pandoraYesPct: explicitYesPct === null ? derivedYesPct : explicitYesPct,
    feeTier,
    readAt: raw.readAt ? String(raw.readAt) : null,
    readError: raw.readError ? String(raw.readError) : null,
  };
}

function buildResolvedSnapshotMetrics(snapshotMetrics, options) {
  const metrics = snapshotMetrics && typeof snapshotMetrics === 'object' ? snapshotMetrics : {};
  const reserveContext = resolveRuntimeReserveContext(options);

  const reserveYesUsdc = reserveContext && reserveContext.reserveYesUsdc !== null
    ? reserveContext.reserveYesUsdc
    : toNumber(metrics.reserveYesUsdc);
  const reserveNoUsdc = reserveContext && reserveContext.reserveNoUsdc !== null
    ? reserveContext.reserveNoUsdc
    : toNumber(metrics.reserveNoUsdc);
  const reserveTotalUsdc =
    reserveYesUsdc !== null && reserveNoUsdc !== null
      ? round(reserveYesUsdc + reserveNoUsdc, 6)
      : toNumber(metrics.reserveTotalUsdc);
  const deltaLpUsdc =
    reserveYesUsdc !== null && reserveNoUsdc !== null
      ? round(reserveYesUsdc - reserveNoUsdc, 6)
      : toNumber(metrics.deltaLpUsdc);
  const targetHedgeUsdc = deltaLpUsdc === null ? toNumber(metrics.targetHedgeUsdc) : round(-deltaLpUsdc, 6);

  const sourceYesPct = toNumber(metrics.sourceYesPct);
  const runtimePandoraYesPct = reserveContext ? reserveContext.pandoraYesPct : null;
  const pandoraYesPct = runtimePandoraYesPct === null
    ? (toNumber(metrics.pandoraYesPct) === null
      ? derivePandoraYesPctFromReserves(reserveYesUsdc, reserveNoUsdc)
      : toNumber(metrics.pandoraYesPct))
    : runtimePandoraYesPct;
  const computedDriftBps =
    sourceYesPct !== null && pandoraYesPct !== null
      ? round(Math.abs(sourceYesPct - pandoraYesPct) * 100, 6)
      : toNumber(metrics.driftBps);
  const driftTriggerBps = toNumber(options && options.driftTriggerBps);
  const driftTriggered =
    computedDriftBps !== null && driftTriggerBps !== null
      ? computedDriftBps >= driftTriggerBps
      : Boolean(metrics.driftTriggered);

  return {
    ...metrics,
    sourceYesPct,
    pandoraYesPct,
    driftBps: computedDriftBps,
    driftTriggered,
    reserveYesUsdc,
    reserveNoUsdc,
    reserveTotalUsdc,
    deltaLpUsdc,
    targetHedgeUsdc,
    reserveSource:
      (reserveContext && reserveContext.source)
      || metrics.reserveSource
      || (reserveTotalUsdc === null ? 'unavailable' : 'verify-payload'),
    reserveFeeTier:
      reserveContext && reserveContext.feeTier !== null
        ? reserveContext.feeTier
        : toNumber(metrics.reserveFeeTier),
    reserveReadAt:
      (reserveContext && reserveContext.readAt)
      || metrics.reserveReadAt
      || null,
    reserveReadError:
      (reserveContext && reserveContext.readError)
      || metrics.reserveReadError
      || null,
  };
}

/**
 * Compute per-tick hedge/rebalance plan from snapshot and state.
 * @param {{snapshotMetrics: object, state: object, options: object}} params
 * @returns {object}
 */
function buildTickPlan(params) {
  const { snapshotMetrics, state, options } = params;
  const resolvedMetrics = buildResolvedSnapshotMetrics(snapshotMetrics, options);
  const gapUsdc =
    resolvedMetrics.targetHedgeUsdc === null
      ? null
      : round(resolvedMetrics.targetHedgeUsdc - (toNumber(state.currentHedgeUsdc) || 0), 6);
  const rawHedgeTriggered = gapUsdc !== null && Math.abs(gapUsdc) >= options.hedgeTriggerUsdc;
  const hedgeTriggered = Boolean(options.hedgeEnabled) && rawHedgeTriggered;

  const scaledHedgeUsdc = rawHedgeTriggered ? Math.abs(gapUsdc) * options.hedgeRatio : 0;
  const plannedHedgeUsdc = hedgeTriggered ? Math.min(scaledHedgeUsdc, options.maxHedgeUsdc) : 0;
  const plannedHedgeSignedUsdc = hedgeTriggered ? (gapUsdc >= 0 ? plannedHedgeUsdc : -plannedHedgeUsdc) : 0;

  const rebalanceSizingMode = normalizeRebalanceSizingMode(options && options.rebalanceSizingMode);
  const maxRebalanceUsdc = toNumber(options && options.maxRebalanceUsdc);
  const cappedMaxRebalanceUsdc = maxRebalanceUsdc === null ? Number.POSITIVE_INFINITY : maxRebalanceUsdc;
  let rebalanceSizingBasis = 'atomic-reserves-unavailable';
  let rebalanceCandidateUsdc = 0;
  let rebalanceTargetUsdc = null;
  let rebalanceCapped = false;

  if (rebalanceSizingMode === 'incremental') {
    const driftFraction = resolvedMetrics.driftBps === null ? 0 : resolvedMetrics.driftBps / 10_000;
    const rebalanceFromPoolUsdc =
      resolvedMetrics.reserveTotalUsdc === null ? null : resolvedMetrics.reserveTotalUsdc * driftFraction;
    const rebalanceFromDriftPointsUsdc = resolvedMetrics.driftBps === null ? 0 : resolvedMetrics.driftBps / 100;
    rebalanceSizingBasis = rebalanceFromPoolUsdc === null ? 'drift-points-fallback' : 'pool-size-drift';
    rebalanceCandidateUsdc = rebalanceFromPoolUsdc === null ? rebalanceFromDriftPointsUsdc : rebalanceFromPoolUsdc;
  } else {
    const atomicTarget = solveVolumeForTargetYesPct({
      targetYesPct: resolvedMetrics.sourceYesPct,
      reserveYesUsdc: resolvedMetrics.reserveYesUsdc,
      reserveNoUsdc: resolvedMetrics.reserveNoUsdc,
      feeTier: resolvedMetrics.reserveFeeTier === null ? undefined : resolvedMetrics.reserveFeeTier,
    });
    rebalanceTargetUsdc = atomicTarget;
    rebalanceCandidateUsdc = atomicTarget === null ? 0 : atomicTarget;
    rebalanceSizingBasis =
      resolvedMetrics.reserveYesUsdc === null || resolvedMetrics.reserveNoUsdc === null
        ? 'atomic-reserves-unavailable'
        : atomicTarget === null
          ? 'atomic-target-unavailable'
          : 'atomic-target-price';
  }

  const plannedRebalanceUsdc = resolvedMetrics.driftTriggered
    ? rebalanceSizingMode === 'incremental'
      ? Math.min(cappedMaxRebalanceUsdc, Math.max(1, rebalanceCandidateUsdc))
      : Math.min(cappedMaxRebalanceUsdc, Math.max(0, rebalanceCandidateUsdc))
    : 0;
  rebalanceCapped =
    resolvedMetrics.driftTriggered
    && Number.isFinite(cappedMaxRebalanceUsdc)
    && rebalanceCandidateUsdc > cappedMaxRebalanceUsdc;
  const rebalanceSide =
    resolvedMetrics.sourceYesPct !== null && resolvedMetrics.pandoraYesPct !== null
      ? resolvedMetrics.sourceYesPct > resolvedMetrics.pandoraYesPct
        ? 'yes'
        : 'no'
      : 'yes';

  return {
    gapUsdc,
    rawHedgeTriggered,
    hedgeTriggered,
    plannedHedgeUsdc,
    plannedHedgeSignedUsdc,
    rebalanceSizingMode,
    rebalanceSizingBasis,
    rebalanceCandidateUsdc: round(rebalanceCandidateUsdc, 6),
    rebalanceTargetUsdc: rebalanceTargetUsdc === null ? null : round(rebalanceTargetUsdc, 6),
    rebalanceCapped,
    plannedRebalanceUsdc,
    rebalanceSide,
    plannedSpendUsdc: round(plannedHedgeUsdc + plannedRebalanceUsdc, 6) || 0,
    hedgeTokenSide: plannedHedgeUsdc > 0 ? (gapUsdc >= 0 ? 'yes' : 'no') : null,
    reserveSource: resolvedMetrics.reserveSource,
    reserveFeeTier: resolvedMetrics.reserveFeeTier,
  };
}

/**
 * Fetch depth snapshot for source market with configured slippage.
 * @param {{depthFn: Function, verifyPayload: object, options: object}} params
 * @returns {Promise<object>}
 */
async function fetchDepthSnapshot(params) {
  const { depthFn, verifyPayload, options } = params;
  return depthFn(verifyPayload.sourceMarket, {
    host: options.polymarketHost,
    mockUrl: options.polymarketMockUrl,
    slippageBps: options.depthSlippageBps,
  });
}

/**
 * Build tick snapshot payload from computed tick components.
 * @param {{iteration: number, tickAt: Date, verifyPayload: object, options: object, snapshotMetrics: object, plan: object, depth: object, gate: object}} params
 * @returns {object}
 */
function buildTickSnapshot(params) {
  const { iteration, tickAt, verifyPayload, options, snapshotMetrics, plan, depth, gate } = params;
  const resolvedMetrics = buildResolvedSnapshotMetrics(snapshotMetrics, options);
  return {
    iteration,
    timestamp: tickAt.toISOString(),
    verify: {
      matchConfidence: verifyPayload.matchConfidence,
      gateResult: verifyPayload.gateResult,
    },
    metrics: {
      ...resolvedMetrics,
      hedgeGapUsdc: plan.gapUsdc,
      rawHedgeTriggered: plan.rawHedgeTriggered,
      hedgeTriggered: plan.hedgeTriggered,
      hedgeEnabled: Boolean(options.hedgeEnabled),
      hedgeRatio: options.hedgeRatio,
      hedgeSuppressed: plan.rawHedgeTriggered && !options.hedgeEnabled,
      plannedHedgeUsdc: plan.plannedHedgeUsdc,
      rebalanceSizingMode: plan.rebalanceSizingMode,
      rebalanceSizingBasis: plan.rebalanceSizingBasis,
      rebalanceCandidateUsdc: round(plan.rebalanceCandidateUsdc, 6),
      rebalanceTargetUsdc: plan.rebalanceTargetUsdc === null ? null : round(plan.rebalanceTargetUsdc, 6),
      rebalanceCapped: plan.rebalanceCapped,
      plannedRebalanceUsdc: plan.plannedRebalanceUsdc,
      plannedSpendUsdc: plan.plannedSpendUsdc,
      depthWithinSlippageUsd: depth.depthWithinSlippageUsd,
      hedgeDepthWithinSlippageUsd:
        plan.plannedHedgeUsdc > 0
          ? plan.gapUsdc >= 0
            ? toNumber(depth.yesDepth && depth.yesDepth.depthUsd) || 0
            : toNumber(depth.noDepth && depth.noDepth.depthUsd) || 0
          : null,
      yesDepthWithinSlippageUsd: toNumber(depth.yesDepth && depth.yesDepth.depthUsd),
      noDepthWithinSlippageUsd: toNumber(depth.noDepth && depth.noDepth.depthUsd),
      minDepthWithinSlippageUsd: toNumber(depth.minDepthWithinSlippageUsd),
      bestDepthWithinSlippageUsd: toNumber(depth.bestDepthWithinSlippageUsd),
    },
    actionPlan: {
      rebalanceSide: plan.plannedRebalanceUsdc > 0 ? plan.rebalanceSide : null,
      rebalanceUsdc: plan.plannedRebalanceUsdc,
      rebalanceSizingMode: plan.rebalanceSizingMode,
      rebalanceTargetUsdc: plan.rebalanceTargetUsdc === null ? null : round(plan.rebalanceTargetUsdc, 6),
      reserveSource: plan.reserveSource,
      hedgeTokenSide: plan.hedgeTokenSide,
      hedgeUsdc: plan.plannedHedgeUsdc,
    },
    strictGate: gate,
    action: null,
  };
}

module.exports = {
  buildVerifyRequest,
  buildSyncStrategy,
  normalizePriceSource,
  normalizeRebalanceSizingMode,
  buildResolvedSnapshotMetrics,
  buildTickPlan,
  fetchDepthSnapshot,
  buildTickSnapshot,
};
