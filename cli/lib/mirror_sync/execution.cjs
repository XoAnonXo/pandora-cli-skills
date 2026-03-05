const { saveState, pruneIdempotencyKeys } = require('../mirror_state_store.cjs');
const { readTradingCredsFromEnv } = require('../polymarket_trade_adapter.cjs');
const { toNumber, round } = require('../shared/utils.cjs');

function getSellDepthEntry(depth, tokenSide) {
  if (!depth || typeof depth !== 'object') return null;
  if (tokenSide === 'yes') {
    return depth.sellYesDepth || depth.yesSellDepth || null;
  }
  if (tokenSide === 'no') {
    return depth.sellNoDepth || depth.noSellDepth || null;
  }
  return null;
}

function buildHedgeExecutionPlan(params) {
  const { options, plan, state, verifyPayload, depth } = params;
  const amountUsdc = round(Math.max(0, toNumber(plan && plan.plannedHedgeUsdc) || 0), 6) || 0;
  if (amountUsdc <= 0) {
    return {
      enabled: false,
      tokenId: null,
      tokenSide: null,
      side: null,
      amountUsdc: 0,
      stateDeltaUsdc: 0,
      hedgeDepth: null,
      inventoryUsdcAvailable: 0,
      executionMode: 'none',
      recycleEligible: false,
      liveSellAllowed: false,
      recycleReason: 'no-hedge-required',
    };
  }

  const sourceMarket = verifyPayload && verifyPayload.sourceMarket ? verifyPayload.sourceMarket : {};
  const currentHedgeUsdc = round(toNumber(state && state.currentHedgeUsdc) || 0, 6) || 0;
  const wantsMoreYesExposure = (toNumber(plan && plan.gapUsdc) || 0) >= 0;
  const defaultTokenSide = wantsMoreYesExposure ? 'yes' : 'no';
  const defaultStateDeltaUsdc = wantsMoreYesExposure ? amountUsdc : -amountUsdc;
  const sellTokenSide = wantsMoreYesExposure ? 'no' : 'yes';
  const inventoryUsdcAvailable = round(
    Math.max(0, wantsMoreYesExposure ? -currentHedgeUsdc : currentHedgeUsdc),
    6,
  ) || 0;
  const recycleEligible = inventoryUsdcAvailable >= amountUsdc && amountUsdc > 0;
  const liveSellDepth = getSellDepthEntry(depth, sellTokenSide);
  const liveSellDepthUsd = toNumber(liveSellDepth && liveSellDepth.depthUsd);
  const liveSellAllowed = liveSellDepthUsd !== null && liveSellDepthUsd >= amountUsdc;

  let side = 'buy';
  let tokenSide = defaultTokenSide;
  let stateDeltaUsdc = defaultStateDeltaUsdc;
  let executionMode = 'buy';
  let hedgeDepth = tokenSide === 'yes' ? depth && depth.yesDepth : depth && depth.noDepth;
  let recycleReason = recycleEligible ? 'sell-depth-unavailable' : 'insufficient-managed-inventory';

  if (recycleEligible && options.executeLive && liveSellAllowed) {
    side = 'sell';
    tokenSide = sellTokenSide;
    stateDeltaUsdc = defaultStateDeltaUsdc;
    executionMode = 'sell-inventory';
    hedgeDepth = liveSellDepth;
    recycleReason = 'inventory-recycled';
  } else if (recycleEligible && !options.executeLive) {
    side = 'sell';
    tokenSide = sellTokenSide;
    stateDeltaUsdc = defaultStateDeltaUsdc;
    executionMode = 'sell-inventory';
    hedgeDepth = liveSellDepth;
    recycleReason = 'inventory-recycled-paper';
  }

  const tokenId = tokenSide === 'yes' ? sourceMarket.yesTokenId : sourceMarket.noTokenId;
  return {
    enabled: true,
    tokenId,
    tokenSide,
    side,
    amountUsdc,
    stateDeltaUsdc,
    hedgeDepth,
    inventoryUsdcAvailable,
    executionMode,
    recycleEligible,
    liveSellAllowed,
    recycleReason,
  };
}

function buildIdempotencyKey(options, snapshot, nowMs) {
  const bucketSize = Math.max(1_000, Number(options.cooldownMs) || 60_000);
  const bucket = Math.floor(nowMs / bucketSize);
  const metrics = snapshot && snapshot.metrics ? snapshot.metrics : {};
  const actionPlan = snapshot && snapshot.actionPlan ? snapshot.actionPlan : {};
  const rebalanceUsdc = Math.round((toNumber(actionPlan.rebalanceUsdc) || 0) * 100) / 100;
  const hedgeUsdc = Math.round((toNumber(actionPlan.hedgeUsdc) || 0) * 100) / 100;

  return [
    String(options.pandoraMarketAddress || '').toLowerCase(),
    String(options.polymarketMarketId || options.polymarketSlug || '').toLowerCase(),
    metrics.driftTriggered ? 'drift' : 'no-drift',
    metrics.hedgeTriggered ? 'hedge' : 'no-hedge',
    actionPlan.rebalanceSide || 'rebalance:none',
    actionPlan.hedgeTokenSide || 'hedge:none',
    actionPlan.hedgeOrderSide || 'hedge-order:none',
    actionPlan.hedgeExecutionMode || 'hedge-mode:none',
    String(rebalanceUsdc),
    String(hedgeUsdc),
    String(bucket),
  ].join('|');
}

/**
 * Create an executable action envelope for a triggered tick.
 * @param {{options: object, idempotencyKey: string, gate: object}} params
 * @returns {object}
 */
function buildExecutableAction(params) {
  const { options, idempotencyKey, gate } = params;
  return {
    mode: options.executeLive ? 'live' : 'paper',
    status: options.executeLive ? 'executed' : 'simulated',
    idempotencyKey,
    forcedGateBypass: gate.bypassedFailedChecks.length > 0,
    failedChecks: gate.failedChecks,
    failedChecksRaw: gate.failedChecksRaw,
    bypassedFailedChecks: gate.bypassedFailedChecks,
    rebalance: null,
    hedge: null,
  };
}

/**
 * Normalize thrown execution errors into service result payloads.
 * @param {any} err
 * @returns {{ok: false, error: {code: string|null, message: string}}}
 */
function normalizeExecutionFailure(err) {
  return {
    ok: false,
    error: {
      code: err && err.code ? String(err.code) : null,
      message: err && err.message ? String(err.message) : String(err),
    },
  };
}

/**
 * Execute or simulate rebalance leg and mutate action/state accordingly.
 * @param {{options: object, action: object, plan: object, snapshotMetrics: object, rebalanceFn: Function, state: object}} params
 * @returns {Promise<number>} Executed rebalance notional in USDC.
 */
async function executeRebalanceLeg(params) {
  const { options, action, plan, snapshotMetrics, rebalanceFn, state } = params;
  if (!(snapshotMetrics.driftTriggered && plan.plannedRebalanceUsdc > 0)) return 0;

  let rebalanceResultOk = true;
  if (options.executeLive) {
    let rebalanceResult;
    try {
      rebalanceResult = await rebalanceFn({
        marketAddress: options.pandoraMarketAddress,
        side: plan.rebalanceSide,
        amountUsdc: plan.plannedRebalanceUsdc,
      });
    } catch (err) {
      rebalanceResult = normalizeExecutionFailure(err);
    }
    action.rebalance = {
      side: plan.rebalanceSide,
      amountUsdc: plan.plannedRebalanceUsdc,
      result: rebalanceResult,
    };
    rebalanceResultOk = Boolean(rebalanceResult && rebalanceResult.ok !== false);
  } else {
    action.rebalance = {
      side: plan.rebalanceSide,
      amountUsdc: plan.plannedRebalanceUsdc,
      result: { status: 'simulated' },
    };
  }

  if (rebalanceResultOk) {
    state.cumulativeLpFeesApproxUsdc =
      round((toNumber(state.cumulativeLpFeesApproxUsdc) || 0) + plan.plannedRebalanceUsdc * 0.003, 6) || 0;
    return plan.plannedRebalanceUsdc;
  }

  action.status = 'failed';
  const rebalanceError =
    action.rebalance && action.rebalance.result && action.rebalance.result.error
      ? action.rebalance.result.error
      : { message: 'Pandora rebalance execution failed.' };
  action.error = {
    code: 'REBALANCE_EXECUTION_FAILED',
    message: rebalanceError.message || 'Pandora rebalance execution failed.',
    details: rebalanceError,
  };
  return 0;
}

/**
 * Execute or simulate hedge leg and mutate action/state accordingly.
 * @param {{options: object, action: object, plan: object, verifyPayload: object, depth: object, hedgeFn: Function, state: object}} params
 * @returns {Promise<number>} Executed hedge notional in USDC.
 */
async function executeHedgeLeg(params) {
  const { options, action, plan, verifyPayload, depth, hedgeFn, state } = params;
  if (!(plan.hedgeTriggered && plan.plannedHedgeUsdc > 0)) return 0;

  const executionPlan = buildHedgeExecutionPlan({
    options,
    plan,
    state,
    verifyPayload,
    depth,
  });
  const tokenId = executionPlan.tokenId;
  const hedgeSide = executionPlan.side;
  const hedgeDepth = executionPlan.hedgeDepth;

  if (options.executeLive) {
    const envCreds = readTradingCredsFromEnv();
    let hedgeResult;
    if (!options.privateKey && envCreds.privateKeyInvalid) {
      hedgeResult = {
        ok: false,
        error: {
          code: 'INVALID_ENV',
          message: 'POLYMARKET_PRIVATE_KEY must be a valid private key (0x + 64 hex chars).',
        },
      };
    } else {
      try {
        hedgeResult = await hedgeFn({
          host: options.polymarketHost,
          mockUrl: options.polymarketMockUrl,
          tokenId,
          side: hedgeSide,
          amountUsd: executionPlan.amountUsdc,
          privateKey: options.privateKey || envCreds.privateKey,
          funder: options.funder || envCreds.funder,
          apiKey: envCreds.apiKey,
          apiSecret: envCreds.apiSecret,
          apiPassphrase: envCreds.apiPassphrase,
        });
      } catch (err) {
        hedgeResult = normalizeExecutionFailure(err);
      }
    }
    action.hedge = {
      tokenId,
      tokenSide: executionPlan.tokenSide,
      side: hedgeSide,
      amountUsdc: executionPlan.amountUsdc,
      stateDeltaUsdc: executionPlan.stateDeltaUsdc,
      inventoryUsdcAvailable: executionPlan.inventoryUsdcAvailable,
      recycleEligible: executionPlan.recycleEligible,
      liveSellAllowed: executionPlan.liveSellAllowed,
      recycleReason: executionPlan.recycleReason,
      executionMode: executionPlan.executionMode,
      result: hedgeResult,
    };
  } else {
    action.hedge = {
      tokenId,
      tokenSide: executionPlan.tokenSide,
      side: hedgeSide,
      amountUsdc: executionPlan.amountUsdc,
      stateDeltaUsdc: executionPlan.stateDeltaUsdc,
      inventoryUsdcAvailable: executionPlan.inventoryUsdcAvailable,
      recycleEligible: executionPlan.recycleEligible,
      liveSellAllowed: executionPlan.liveSellAllowed,
      recycleReason: executionPlan.recycleReason,
      executionMode: executionPlan.executionMode,
      result: { status: 'simulated' },
    };
  }

  const hedgeResultOk = !options.executeLive || (action.hedge && action.hedge.result && action.hedge.result.ok !== false);
  if (hedgeResultOk) {
    state.currentHedgeUsdc =
      round((toNumber(state.currentHedgeUsdc) || 0) + executionPlan.stateDeltaUsdc, 6) || 0;
    state.cumulativeHedgeNotionalUsdc =
      round((toNumber(state.cumulativeHedgeNotionalUsdc) || 0) + executionPlan.amountUsdc, 6) || 0;
    const slippageRatio =
      hedgeDepth && hedgeDepth.midPrice !== null && hedgeDepth.worstPrice !== null && hedgeDepth.midPrice > 0
        ? Math.max(0, Math.abs(hedgeDepth.worstPrice - hedgeDepth.midPrice) / hedgeDepth.midPrice)
        : 0;
    const hedgeCostApprox = executionPlan.amountUsdc * slippageRatio;
    state.cumulativeHedgeCostApproxUsdc =
      round((toNumber(state.cumulativeHedgeCostApproxUsdc) || 0) + hedgeCostApprox, 6) || 0;
    return executionPlan.amountUsdc;
  }

  action.status = 'failed';
  const hedgeError =
    action.hedge && action.hedge.result && action.hedge.result.error
      ? action.hedge.result.error
      : action.hedge && action.hedge.result && action.hedge.result.response && action.hedge.result.response.error
        ? { message: String(action.hedge.result.response.error) }
        : { message: 'Polymarket hedge execution failed.' };
  action.error = {
    code: 'HEDGE_EXECUTION_FAILED',
    message: hedgeError.message || 'Polymarket hedge execution failed.',
    details: hedgeError,
  };
  return 0;
}

/**
 * Apply executed leg totals to persistent state.
 * @param {{state: object, action: object, idempotencyKey: string, actualRebalanceUsdc: number, actualHedgeUsdc: number}} params
 * @returns {void}
 */
function finalizeExecutedActionState(params) {
  const { state, action, idempotencyKey, actualRebalanceUsdc, actualHedgeUsdc } = params;
  const actualSpendUsdc = round(actualRebalanceUsdc + actualHedgeUsdc, 6) || 0;
  state.dailySpendUsdc = round((toNumber(state.dailySpendUsdc) || 0) + actualSpendUsdc, 6) || 0;
  const executedLegCount = (actualRebalanceUsdc > 0 ? 1 : 0) + (actualHedgeUsdc > 0 ? 1 : 0);
  if (executedLegCount > 0) {
    state.idempotencyKeys.push(idempotencyKey);
    pruneIdempotencyKeys(state);
  }
  state.tradesToday += executedLegCount;
  state.lastExecution = action;
}

/**
 * Execute triggered action path (skip/blocked/executed) for a tick.
 * @param {{options: object, state: object, snapshot: object, plan: object, gate: object, tickAt: Date, loadedFilePath: string, rebalanceFn: Function, hedgeFn: Function, sendWebhook: Function|null, strategyHash: string, iteration: number, actions: Array<object>, webhookReports: Array<object>, snapshotMetrics: object, verifyPayload: object, depth: object}} params
 * @returns {Promise<void>}
 */
async function processTriggeredAction(params) {
  const {
    options,
    state,
    snapshot,
    plan,
    gate,
    tickAt,
    loadedFilePath,
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
  } = params;

  if (snapshot && snapshot.actionPlan && plan.hedgeTriggered && plan.plannedHedgeUsdc > 0) {
    const hedgeExecutionPlan = buildHedgeExecutionPlan({
      options,
      plan,
      state,
      verifyPayload,
      depth,
    });
    snapshot.actionPlan = {
      ...snapshot.actionPlan,
      hedgeTokenSide: hedgeExecutionPlan.tokenSide,
      hedgeOrderSide: hedgeExecutionPlan.side,
      hedgeExecutionMode: hedgeExecutionPlan.executionMode,
      hedgeStateDeltaUsdc: hedgeExecutionPlan.stateDeltaUsdc,
      hedgeInventoryUsdcAvailable: hedgeExecutionPlan.inventoryUsdcAvailable,
      hedgeRecycleEligible: hedgeExecutionPlan.recycleEligible,
      hedgeLiveSellAllowed: hedgeExecutionPlan.liveSellAllowed,
      hedgeRecycleReason: hedgeExecutionPlan.recycleReason,
    };
  }

  const idempotencyKey = buildIdempotencyKey(options, snapshot, tickAt.getTime());
  if ((state.idempotencyKeys || []).includes(idempotencyKey)) {
    snapshot.action = {
      mode: options.executeLive ? 'live' : 'paper',
      status: 'skipped',
      reason: 'Duplicate trigger bucket (idempotency key already processed).',
      idempotencyKey,
    };
    return;
  }

  if (!gate.ok) {
    snapshot.action = {
      mode: options.executeLive ? 'live' : 'paper',
      status: 'blocked',
      reason: 'Strict gate blocked execution.',
      idempotencyKey,
      failedChecks: gate.failedChecks,
      failedChecksRaw: gate.failedChecksRaw,
      bypassedFailedChecks: gate.bypassedFailedChecks,
    };
    return;
  }

  const action = buildExecutableAction({ options, idempotencyKey, gate });
  state.lastExecution = {
    mode: action.mode,
    status: 'pending',
    idempotencyKey,
    startedAt: tickAt.toISOString(),
  };
  saveState(loadedFilePath, state);

  const actualRebalanceUsdc = await executeRebalanceLeg({
    options,
    action,
    plan,
    snapshotMetrics,
    rebalanceFn,
    state,
  });
  const actualHedgeUsdc = await executeHedgeLeg({
    options,
    action,
    plan,
    verifyPayload,
    depth,
    hedgeFn,
    state,
  });

  finalizeExecutedActionState({
    state,
    action,
    idempotencyKey,
    actualRebalanceUsdc,
    actualHedgeUsdc,
  });

  snapshot.action = action;
  actions.push(action);

  if (sendWebhook) {
    const report = await sendWebhook({
      event: 'mirror.sync.trigger',
      strategyHash: hash,
      iteration,
      message: `[Pandora Mirror] action=${action.status} drift=${snapshotMetrics.driftBps} hedgeGap=${plan.gapUsdc}`,
      action,
      snapshot,
    });
    webhookReports.push(report);
  }
}

module.exports = {
  buildHedgeExecutionPlan,
  buildIdempotencyKey,
  buildExecutableAction,
  normalizeExecutionFailure,
  executeRebalanceLeg,
  executeHedgeLeg,
  finalizeExecutedActionState,
  processTriggeredAction,
};
