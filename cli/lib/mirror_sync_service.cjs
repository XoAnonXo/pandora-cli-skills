const fs = require('fs');
const {
  MIRROR_STATE_SCHEMA_VERSION,
  defaultStateFile,
  defaultKillSwitchFile,
  strategyHash,
  loadState,
  saveState,
  resetDailyCountersIfNeeded,
} = require('./mirror_state_store.cjs');
const { verifyMirrorPair } = require('./mirror_verify_service.cjs');
const { fetchDepthForMarket, placeHedgeOrder } = require('./polymarket_trade_adapter.cjs');
const { sleepMs } = require('./shared/utils.cjs');
const {
  buildVerifyRequest,
  buildSyncStrategy,
  buildTickPlan,
  fetchDepthSnapshot,
  buildTickSnapshot,
} = require('./mirror_sync/planning.cjs');
const {
  MIRROR_SYNC_GATE_CODES,
  evaluateSnapshot,
  evaluateStrictGates,
  normalizeSkipGateChecks,
  applyGateBypassPolicy,
  resolveMinimumTimeToCloseSec,
  buildTickGateContext,
  runStartupVerify,
} = require('./mirror_sync/gates.cjs');
const { processTriggeredAction } = require('./mirror_sync/execution.cjs');
const { createServiceError, ensureStateIdentity, persistTickSnapshot } = require('./mirror_sync/state.cjs');

const MIRROR_SYNC_SCHEMA_VERSION = '1.0.0';

/**
 * Execute mirror sync in `once` or continuous `run` mode.
 * USDC-facing option fields use decimal units (not raw token units);
 * slippage values are basis points.
 * @param {object} options
 * @param {object} [deps]
 * @returns {Promise<object>}
 */
async function runMirrorSync(options, deps = {}) {
  const now = () => (typeof deps.now === 'function' ? deps.now() : new Date());
  const verifyFn = deps.verifyFn || verifyMirrorPair;
  const depthFn = deps.depthFn || fetchDepthForMarket;
  const hedgeFn = deps.hedgeFn || placeHedgeOrder;
  const rebalanceFn = typeof deps.rebalanceFn === 'function' ? deps.rebalanceFn : null;
  const sendWebhook = typeof deps.sendWebhook === 'function' ? deps.sendWebhook : null;
  const onTick = typeof deps.onTick === 'function' ? deps.onTick : null;
  if (options.executeLive && !rebalanceFn) {
    throw createServiceError('MIRROR_REBALANCE_FN_REQUIRED', 'Live mirror sync requires a rebalanceFn dependency.');
  }

  const strategy = buildSyncStrategy(options);

  const hash = strategyHash(strategy);
  const stateFile = options.stateFile || defaultStateFile(strategy);
  const killSwitchFile = options.killSwitchFile || defaultKillSwitchFile();

  const loaded = loadState(stateFile, hash);
  const state = loaded.state;
  ensureStateIdentity(state, options);

  const snapshots = [];
  const actions = [];
  const webhookReports = [];
  const diagnostics = [];

  const maxIterations = options.mode === 'once' ? 1 : options.iterations || Number.POSITIVE_INFINITY;
  const minimumTimeToCloseSec = resolveMinimumTimeToCloseSec(options);
  let iteration = 0;
  let shouldStop = false;
  let stoppedReason = null;
  let startupVerifyPayload = null;

  const stopHandler = () => {
    shouldStop = true;
  };

  process.on('SIGINT', stopHandler);
  process.on('SIGTERM', stopHandler);

  try {
    startupVerifyPayload = await runStartupVerify({
      verifyFn,
      options,
      minimumTimeToCloseSec,
      buildVerifyRequest,
      createServiceError,
    });

    while (!shouldStop && iteration < maxIterations) {
      iteration += 1;
      const tickAt = now();

      // Kill-switch file is an execution safety guard for live writes.
      // Paper mode should continue to emit diagnostics/snapshots.
      if (options.executeLive && killSwitchFile && fs.existsSync(killSwitchFile)) {
        stoppedReason = `Kill switch file detected at ${killSwitchFile}`;
        break;
      }

      resetDailyCountersIfNeeded(state, tickAt);

      const verifyPayload =
        iteration === 1 && startupVerifyPayload
          ? startupVerifyPayload
          : await verifyFn(buildVerifyRequest(options));

      const snapshotMetrics = evaluateSnapshot(verifyPayload, options);
      const plan = buildTickPlan({
        snapshotMetrics,
        state,
        options,
      });
      const depth = await fetchDepthSnapshot({
        depthFn,
        verifyPayload,
        options,
      });

      const gate = applyGateBypassPolicy(
        evaluateStrictGates(
          buildTickGateContext({
            verifyPayload,
            options,
            state,
            plan,
            snapshotMetrics,
            depth,
            minimumTimeToCloseSec,
          }),
        ),
        options,
      );

      const snapshot = buildTickSnapshot({
        iteration,
        tickAt,
        verifyPayload,
        options,
        snapshotMetrics,
        plan,
        depth,
        gate,
      });

      if (snapshotMetrics.driftTriggered || plan.hedgeTriggered) {
        await processTriggeredAction({
          options,
          state,
          snapshot,
          plan,
          gate,
          tickAt,
          loadedFilePath: loaded.filePath,
          rebalanceFn,
          hedgeFn,
          sendWebhook,
          strategyHash: hash,
          iteration,
          actions,
          webhookReports,
          snapshotMetrics,
          verifyPayload,
          depth,
        });
      }

      await persistTickSnapshot({
        loadedFilePath: loaded.filePath,
        state,
        tickAt,
        snapshot,
        snapshots,
        onTick,
        iteration,
      });

      if (shouldStop) break;
      if (iteration >= maxIterations) break;
      await (deps.sleep ? deps.sleep(options.intervalMs) : sleepMs(options.intervalMs));
    }
  } finally {
    process.off('SIGINT', stopHandler);
    process.off('SIGTERM', stopHandler);
    saveState(loaded.filePath, state);
  }

  if (!stoppedReason && shouldStop) {
    stoppedReason = 'Received termination signal.';
  }

  return {
    schemaVersion: MIRROR_SYNC_SCHEMA_VERSION,
    stateSchemaVersion: MIRROR_STATE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    strategyHash: hash,
    mode: options.mode,
    executeLive: options.executeLive,
    parameters: {
      pandoraMarketAddress: options.pandoraMarketAddress,
      polymarketMarketId: options.polymarketMarketId,
      polymarketSlug: options.polymarketSlug,
      trustDeploy: Boolean(options.trustDeploy),
      forceGate: Boolean(options.forceGate),
      skipGateChecks: normalizeSkipGateChecks(options.skipGateChecks),
      intervalMs: options.intervalMs,
      minimumTimeToCloseSec,
      driftTriggerBps: options.driftTriggerBps,
      hedgeTriggerUsdc: options.hedgeTriggerUsdc,
      hedgeEnabled: options.hedgeEnabled,
      hedgeRatio: options.hedgeRatio,
      maxRebalanceUsdc: options.maxRebalanceUsdc,
      maxHedgeUsdc: options.maxHedgeUsdc,
      maxOpenExposureUsdc: options.maxOpenExposureUsdc,
      maxTradesPerDay: options.maxTradesPerDay,
      cooldownMs: options.cooldownMs,
      depthSlippageBps: options.depthSlippageBps,
    },
    stateFile: loaded.filePath,
    killSwitchFile,
    iterationsRequested: Number.isFinite(maxIterations) ? maxIterations : null,
    iterationsCompleted: snapshots.length,
    stoppedReason,
    state,
    actionCount: actions.length,
    actions,
    snapshots,
    webhookReports,
    diagnostics,
  };
}

/**
 * Public mirror sync API consumed by CLI `mirror sync` commands.
 * @typedef {object} MirrorSyncApi
 * @property {string} MIRROR_SYNC_SCHEMA_VERSION JSON payload schema version.
 * @property {readonly string[]} MIRROR_SYNC_GATE_CODES Supported strict-gate check codes.
 * @property {(options: object, deps?: object) => Promise<object>} runMirrorSync Mirror sync runner.
 */

/** @type {MirrorSyncApi} */
module.exports = {
  MIRROR_SYNC_SCHEMA_VERSION,
  MIRROR_SYNC_GATE_CODES,
  runMirrorSync,
};
