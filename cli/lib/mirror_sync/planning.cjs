const { toNumber, round } = require('../shared/utils.cjs');
const { normalizeSkipGateChecks } = require('./gates.cjs');

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
    driftTriggerBps: options.driftTriggerBps,
    hedgeEnabled: options.hedgeEnabled,
    hedgeRatio: options.hedgeRatio,
    hedgeTriggerUsdc: options.hedgeTriggerUsdc,
    forceGate: Boolean(options.forceGate),
    skipGateChecks: normalizeSkipGateChecks(options.skipGateChecks),
  };
}

/**
 * Compute per-tick hedge/rebalance plan from snapshot and state.
 * @param {{snapshotMetrics: object, state: object, options: object}} params
 * @returns {object}
 */
function buildTickPlan(params) {
  const { snapshotMetrics, state, options } = params;
  const gapUsdc =
    snapshotMetrics.targetHedgeUsdc === null
      ? null
      : round(snapshotMetrics.targetHedgeUsdc - (toNumber(state.currentHedgeUsdc) || 0), 6);
  const rawHedgeTriggered = gapUsdc !== null && Math.abs(gapUsdc) >= options.hedgeTriggerUsdc;
  const hedgeTriggered = Boolean(options.hedgeEnabled) && rawHedgeTriggered;

  const scaledHedgeUsdc = rawHedgeTriggered ? Math.abs(gapUsdc) * options.hedgeRatio : 0;
  const plannedHedgeUsdc = hedgeTriggered ? Math.min(scaledHedgeUsdc, options.maxHedgeUsdc) : 0;
  const plannedHedgeSignedUsdc = hedgeTriggered ? (gapUsdc >= 0 ? plannedHedgeUsdc : -plannedHedgeUsdc) : 0;

  const driftFraction = snapshotMetrics.driftBps === null ? 0 : snapshotMetrics.driftBps / 10_000;
  const rebalanceFromPoolUsdc =
    snapshotMetrics.reserveTotalUsdc === null ? null : snapshotMetrics.reserveTotalUsdc * driftFraction;
  const rebalanceFromDriftPointsUsdc = snapshotMetrics.driftBps === null ? 0 : snapshotMetrics.driftBps / 100;
  const rebalanceSizingBasis = rebalanceFromPoolUsdc === null ? 'drift-points-fallback' : 'pool-size-drift';
  const rebalanceCandidateUsdc = rebalanceFromPoolUsdc === null ? rebalanceFromDriftPointsUsdc : rebalanceFromPoolUsdc;
  const plannedRebalanceUsdc = snapshotMetrics.driftTriggered
    ? Math.min(options.maxRebalanceUsdc, Math.max(1, rebalanceCandidateUsdc))
    : 0;
  const rebalanceSide =
    snapshotMetrics.sourceYesPct !== null && snapshotMetrics.pandoraYesPct !== null
      ? snapshotMetrics.sourceYesPct > snapshotMetrics.pandoraYesPct
        ? 'yes'
        : 'no'
      : 'yes';

  return {
    gapUsdc,
    rawHedgeTriggered,
    hedgeTriggered,
    plannedHedgeUsdc,
    plannedHedgeSignedUsdc,
    rebalanceSizingBasis,
    rebalanceCandidateUsdc,
    plannedRebalanceUsdc,
    rebalanceSide,
    plannedSpendUsdc: round(plannedHedgeUsdc + plannedRebalanceUsdc, 6) || 0,
    hedgeTokenSide: plannedHedgeUsdc > 0 ? (gapUsdc >= 0 ? 'yes' : 'no') : null,
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
  return {
    iteration,
    timestamp: tickAt.toISOString(),
    verify: {
      matchConfidence: verifyPayload.matchConfidence,
      gateResult: verifyPayload.gateResult,
    },
    metrics: {
      ...snapshotMetrics,
      hedgeGapUsdc: plan.gapUsdc,
      rawHedgeTriggered: plan.rawHedgeTriggered,
      hedgeTriggered: plan.hedgeTriggered,
      hedgeEnabled: Boolean(options.hedgeEnabled),
      hedgeRatio: options.hedgeRatio,
      hedgeSuppressed: plan.rawHedgeTriggered && !options.hedgeEnabled,
      plannedHedgeUsdc: plan.plannedHedgeUsdc,
      rebalanceSizingBasis: plan.rebalanceSizingBasis,
      rebalanceCandidateUsdc: round(plan.rebalanceCandidateUsdc, 6),
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
  buildTickPlan,
  fetchDepthSnapshot,
  buildTickSnapshot,
};
