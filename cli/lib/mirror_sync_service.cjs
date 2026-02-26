const fs = require('fs');
const {
  MIRROR_STATE_SCHEMA_VERSION,
  defaultStateFile,
  defaultKillSwitchFile,
  strategyHash,
  loadState,
  saveState,
  pruneIdempotencyKeys,
  resetDailyCountersIfNeeded,
} = require('./mirror_state_store.cjs');
const { verifyMirrorPair } = require('./mirror_verify_service.cjs');
const { fetchDepthForMarket, placeHedgeOrder, readTradingCredsFromEnv } = require('./polymarket_trade_adapter.cjs');

const MIRROR_SYNC_SCHEMA_VERSION = '1.0.0';

function toNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function round(value, decimals = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sleepMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildIdempotencyKey(options, snapshot, nowMs) {
  const bucketSize = Math.max(1_000, Number(options.cooldownMs) || 60_000);
  const bucket = Math.floor(nowMs / bucketSize);

  return [
    String(options.pandoraMarketAddress || '').toLowerCase(),
    String(options.polymarketMarketId || options.polymarketSlug || '').toLowerCase(),
    snapshot.driftTriggered ? 'drift' : 'no-drift',
    snapshot.hedgeTriggered ? 'hedge' : 'no-hedge',
    String(bucket),
  ].join('|');
}

function evaluateSnapshot(verifyPayload, options) {
  const pandora = verifyPayload.pandora || {};
  const source = verifyPayload.sourceMarket || {};

  const sourceYes = toNumber(source.yesPct);
  const pandoraYes = toNumber(pandora.yesPct);

  const driftBps = sourceYes !== null && pandoraYes !== null ? Math.abs(sourceYes - pandoraYes) * 100 : null;
  const driftTriggered = driftBps !== null && driftBps >= options.driftTriggerBps;

  const reserveYes = toNumber(pandora.reserveYes);
  const reserveNo = toNumber(pandora.reserveNo);
  const deltaLpUsdc = reserveYes !== null && reserveNo !== null ? round(reserveYes - reserveNo, 6) : null;
  const targetHedgeUsdc = deltaLpUsdc === null ? null : round(-deltaLpUsdc, 6);

  return {
    sourceYesPct: sourceYes,
    pandoraYesPct: pandoraYes,
    driftBps,
    driftTriggered,
    deltaLpUsdc,
    targetHedgeUsdc,
  };
}

function evaluateStrictGates(context) {
  const failures = [];
  const checks = [];

  const add = (code, ok, message, details = null) => {
    checks.push({ code, ok, message, details });
    if (!ok) failures.push(code);
  };

  const verify = context.verifyPayload;
  const verifyGate = verify && verify.gateResult ? verify.gateResult : null;
  add('MATCH_AND_RULES', Boolean(verifyGate && verifyGate.ok), 'Mirror match/rules gates must pass.', {
    failedChecks: verifyGate ? verifyGate.failedChecks : ['UNKNOWN'],
  });

  const closeDeltaCheck =
    verifyGate && Array.isArray(verifyGate.checks)
      ? verifyGate.checks.find((item) => item.code === 'CLOSE_TIME_DELTA')
      : null;
  add(
    'CLOSE_TIME_DELTA',
    closeDeltaCheck ? closeDeltaCheck.ok : true,
    'Close-time delta must be within strict threshold.',
    closeDeltaCheck && closeDeltaCheck.meta ? closeDeltaCheck.meta : null,
  );

  const depthRequired = toNumber(context.plannedHedgeUsdc) || 0;
  const depthAvailable = toNumber(context.depthWithinSlippageUsd) || 0;
  add(
    'DEPTH_COVERAGE',
    depthRequired <= 0 ? true : depthAvailable >= depthRequired,
    'Source depth must cover hedge notional at configured slippage.',
    {
      depthRequired,
      depthAvailable,
      slippageBps: context.depthSlippageBps,
    },
  );

  const state = context.state;
  const totalSpendCandidate = (toNumber(state.dailySpendUsdc) || 0) + (toNumber(context.plannedSpendUsdc) || 0);
  const maxExposure = toNumber(context.maxOpenExposureUsdc);
  add(
    'MAX_OPEN_EXPOSURE',
    maxExposure === null ? true : totalSpendCandidate <= maxExposure,
    'Max open exposure must not be exceeded.',
    {
      totalSpendCandidate: round(totalSpendCandidate, 6),
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

  return {
    ok: failures.length === 0,
    failedChecks: failures,
    checks,
  };
}

async function runMirrorSync(options, deps = {}) {
  const now = () => (typeof deps.now === 'function' ? deps.now() : new Date());
  const verifyFn = deps.verifyFn || verifyMirrorPair;
  const depthFn = deps.depthFn || fetchDepthForMarket;
  const hedgeFn = deps.hedgeFn || placeHedgeOrder;
  const sendWebhook = typeof deps.sendWebhook === 'function' ? deps.sendWebhook : null;

  const strategy = {
    mode: options.mode,
    pandoraMarketAddress: options.pandoraMarketAddress,
    polymarketMarketId: options.polymarketMarketId,
    polymarketSlug: options.polymarketSlug,
    executeLive: options.executeLive,
    driftTriggerBps: options.driftTriggerBps,
    hedgeEnabled: options.hedgeEnabled,
    hedgeRatio: options.hedgeRatio,
    hedgeTriggerUsdc: options.hedgeTriggerUsdc,
  };

  const hash = strategyHash(strategy);
  const stateFile = options.stateFile || defaultStateFile(strategy);
  const killSwitchFile = options.killSwitchFile || defaultKillSwitchFile();

  const loaded = loadState(stateFile, hash);
  const state = loaded.state;

  const snapshots = [];
  const actions = [];
  const webhookReports = [];
  const diagnostics = [];

  const maxIterations = options.mode === 'once' ? 1 : options.iterations || Number.POSITIVE_INFINITY;
  let iteration = 0;
  let shouldStop = false;
  let stoppedReason = null;

  const stopHandler = () => {
    shouldStop = true;
  };

  process.on('SIGINT', stopHandler);
  process.on('SIGTERM', stopHandler);

  try {
    while (!shouldStop && iteration < maxIterations) {
      iteration += 1;
      const tickAt = now();

      if (killSwitchFile && fs.existsSync(killSwitchFile)) {
        stoppedReason = `Kill switch file detected at ${killSwitchFile}`;
        break;
      }

      resetDailyCountersIfNeeded(state, tickAt);

      const verifyPayload = await verifyFn({
        indexerUrl: options.indexerUrl,
        timeoutMs: options.timeoutMs,
        pandoraMarketAddress: options.pandoraMarketAddress,
        polymarketMarketId: options.polymarketMarketId,
        polymarketSlug: options.polymarketSlug,
        polymarketHost: options.polymarketHost,
        polymarketMockUrl: options.polymarketMockUrl,
        confidenceThreshold: 0.92,
        allowRuleMismatch: false,
        includeSimilarity: false,
      });

      const snapshotMetrics = evaluateSnapshot(verifyPayload, options);
      const gapUsdc =
        snapshotMetrics.targetHedgeUsdc === null
          ? null
          : round(snapshotMetrics.targetHedgeUsdc - (toNumber(state.currentHedgeUsdc) || 0), 6);
      const rawHedgeTriggered = gapUsdc !== null && Math.abs(gapUsdc) >= options.hedgeTriggerUsdc;
      const hedgeTriggered = Boolean(options.hedgeEnabled) && rawHedgeTriggered;

      const scaledHedgeUsdc = rawHedgeTriggered ? Math.abs(gapUsdc) * options.hedgeRatio : 0;
      const plannedHedgeUsdc = hedgeTriggered ? Math.min(scaledHedgeUsdc, options.maxHedgeUsdc) : 0;

      const driftMagnitudePct = snapshotMetrics.driftBps === null ? 0 : snapshotMetrics.driftBps / 100;
      const plannedRebalanceUsdc = snapshotMetrics.driftTriggered
        ? Math.min(options.maxRebalanceUsdc, Math.max(1, driftMagnitudePct))
        : 0;

      const plannedSpendUsdc = round(plannedHedgeUsdc + plannedRebalanceUsdc, 6) || 0;

      const depth = await depthFn(verifyPayload.sourceMarket, {
        host: options.polymarketHost,
        mockUrl: options.polymarketMockUrl,
        slippageBps: options.depthSlippageBps,
      });

      const gate = evaluateStrictGates({
        verifyPayload,
        state,
        plannedHedgeUsdc,
        plannedSpendUsdc,
        depthWithinSlippageUsd: depth.depthWithinSlippageUsd,
        depthSlippageBps: options.depthSlippageBps,
        maxOpenExposureUsdc: options.maxOpenExposureUsdc,
        maxTradesPerDay: options.maxTradesPerDay,
      });

      const snapshot = {
        iteration,
        timestamp: tickAt.toISOString(),
        verify: {
          matchConfidence: verifyPayload.matchConfidence,
          gateResult: verifyPayload.gateResult,
        },
        metrics: {
          ...snapshotMetrics,
          hedgeGapUsdc: gapUsdc,
          rawHedgeTriggered,
          hedgeTriggered,
          hedgeEnabled: Boolean(options.hedgeEnabled),
          hedgeRatio: options.hedgeRatio,
          hedgeSuppressed: rawHedgeTriggered && !options.hedgeEnabled,
          plannedHedgeUsdc,
          plannedRebalanceUsdc,
          plannedSpendUsdc,
          depthWithinSlippageUsd: depth.depthWithinSlippageUsd,
        },
        strictGate: gate,
        action: null,
      };

      if (snapshotMetrics.driftTriggered || hedgeTriggered) {
        const idempotencyKey = buildIdempotencyKey(options, snapshot, tickAt.getTime());
        if ((state.idempotencyKeys || []).includes(idempotencyKey)) {
          snapshot.action = {
            mode: options.executeLive ? 'live' : 'paper',
            status: 'skipped',
            reason: 'Duplicate trigger bucket (idempotency key already processed).',
            idempotencyKey,
          };
        } else if (!gate.ok) {
          snapshot.action = {
            mode: options.executeLive ? 'live' : 'paper',
            status: 'blocked',
            reason: 'Strict gate blocked execution.',
            idempotencyKey,
            failedChecks: gate.failedChecks,
          };
        } else {
          const action = {
            mode: options.executeLive ? 'live' : 'paper',
            status: options.executeLive ? 'executed' : 'simulated',
            idempotencyKey,
            rebalance: null,
            hedge: null,
          };

          if (snapshotMetrics.driftTriggered && plannedRebalanceUsdc > 0) {
            const rebalanceSide =
              snapshotMetrics.sourceYesPct !== null && snapshotMetrics.pandoraYesPct !== null
                ? snapshotMetrics.sourceYesPct > snapshotMetrics.pandoraYesPct
                  ? 'yes'
                  : 'no'
                : 'yes';

            if (options.executeLive) {
              const rebalanceResult = await deps.rebalanceFn({
                marketAddress: options.pandoraMarketAddress,
                side: rebalanceSide,
                amountUsdc: plannedRebalanceUsdc,
              });
              action.rebalance = {
                side: rebalanceSide,
                amountUsdc: plannedRebalanceUsdc,
                result: rebalanceResult,
              };
            } else {
              action.rebalance = {
                side: rebalanceSide,
                amountUsdc: plannedRebalanceUsdc,
                result: { status: 'simulated' },
              };
            }
          }

          if (hedgeTriggered && plannedHedgeUsdc > 0) {
            const hedgeSide = gapUsdc >= 0 ? 'buy' : 'buy';
            const tokenId = gapUsdc >= 0 ? verifyPayload.sourceMarket.yesTokenId : verifyPayload.sourceMarket.noTokenId;

            if (options.executeLive) {
              const creds = readTradingCredsFromEnv();
              const hedgeResult = await hedgeFn({
                host: options.polymarketHost,
                mockUrl: options.polymarketMockUrl,
                tokenId,
                side: hedgeSide,
                amountUsd: plannedHedgeUsdc,
                privateKey: creds.privateKey,
                funder: creds.funder,
                apiKey: creds.apiKey,
                apiSecret: creds.apiSecret,
                apiPassphrase: creds.apiPassphrase,
              });
              action.hedge = {
                tokenId,
                side: hedgeSide,
                amountUsdc: plannedHedgeUsdc,
                result: hedgeResult,
              };
            } else {
              action.hedge = {
                tokenId,
                side: hedgeSide,
                amountUsdc: plannedHedgeUsdc,
                result: { status: 'simulated' },
              };
            }

            const direction = gapUsdc >= 0 ? 1 : -1;
            state.currentHedgeUsdc = round((toNumber(state.currentHedgeUsdc) || 0) + direction * plannedHedgeUsdc, 6) || 0;
          }

          state.dailySpendUsdc = round((toNumber(state.dailySpendUsdc) || 0) + plannedSpendUsdc, 6) || 0;
          state.tradesToday += 1;
          state.lastExecution = action;
          state.idempotencyKeys.push(idempotencyKey);
          pruneIdempotencyKeys(state);

          snapshot.action = action;
          actions.push(action);

          if (sendWebhook) {
            const report = await sendWebhook({
              event: 'mirror.sync.trigger',
              strategyHash: hash,
              iteration,
              message: `[Pandora Mirror] action=${action.status} drift=${snapshotMetrics.driftBps} hedgeGap=${gapUsdc}`,
              action,
              snapshot,
            });
            webhookReports.push(report);
          }
        }
      }

      state.lastTickAt = tickAt.toISOString();
      saveState(loaded.filePath, state);
      snapshots.push(snapshot);

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
      intervalMs: options.intervalMs,
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

module.exports = {
  MIRROR_SYNC_SCHEMA_VERSION,
  runMirrorSync,
};
