const { saveState, pruneIdempotencyKeys } = require('../mirror_state_store.cjs');
const { appendAuditEntries } = require('../mirror_audit_store.cjs');
const { readTradingCredsFromEnv } = require('../polymarket_trade_adapter.cjs');
const { toNumber, round } = require('../shared/utils.cjs');
const {
  pushRuntimeAlert,
  readPendingActionLock,
  tryAcquirePendingActionLock,
  updatePendingActionLock,
  clearPendingActionLock,
} = require('./state.cjs');

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

function resolvePolymarketRpcHint(options, env = process.env) {
  return options.polymarketRpcUrl || env.POLYMARKET_RPC_URL || options.rpcUrl || null;
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

function buildPendingActionStateSummary(action) {
  if (!action || typeof action !== 'object') return null;
  return {
    status: action.status || null,
    completedAt: action.completedAt || null,
    error: action.error || null,
    lockNonce: action.lockNonce || null,
    transactionNonce: action.transactionNonce ?? null,
    lockConflict: action.lockConflict || null,
    rebalance: action.rebalance || null,
    hedge: action.hedge || null,
    requiresManualReview: Boolean(action.requiresManualReview),
  };
}

function extractActionTransactionNonce(action) {
  if (!action || typeof action !== 'object') return null;
  const candidates = [
    action.transactionNonce,
    action.rebalance && action.rebalance.result && action.rebalance.result.tradeNonce,
    action.rebalance && action.rebalance.result && action.rebalance.result.approveNonce,
  ];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === '') continue;
    const numeric = Number(candidate);
    if (Number.isInteger(numeric) && numeric >= 0) return numeric;
  }
  return null;
}

function buildMirrorAuditEntries(action) {
  if (!action || typeof action !== 'object') return [];
  const timestamp = action.completedAt || action.startedAt || new Date().toISOString();
  const entries = [
    {
      classification: 'sync-action',
      venue: 'mirror',
      source: 'mirror-sync.execution',
      timestamp,
      status: action.status || null,
      code: action.error && action.error.code ? action.error.code : null,
      message: action.error && action.error.message ? action.error.message : null,
      details: {
        mode: action.mode || null,
        idempotencyKey: action.idempotencyKey || null,
        requiresManualReview: Boolean(action.requiresManualReview),
        startedAt: action.startedAt || null,
        completedAt: action.completedAt || null,
        lockFile: action.lockFile || null,
        lockNonce: action.lockNonce || null,
        lockRetained: Boolean(action.lockRetained),
        transactionNonce: action.transactionNonce ?? null,
      },
    },
  ];
  if (action.rebalance) {
    entries.push({
      classification: 'pandora-rebalance',
      venue: 'pandora',
      source: 'mirror-sync.execution.rebalance',
      timestamp,
      status: action.rebalance.result && action.rebalance.result.ok === false ? 'failed' : action.rebalance.result && action.rebalance.result.status ? action.rebalance.result.status : 'ok',
      code: action.rebalance.result && action.rebalance.result.error ? action.rebalance.result.error.code || null : null,
      message: action.rebalance.result && action.rebalance.result.error ? action.rebalance.result.error.message || null : null,
      details: {
        side: action.rebalance.side || null,
        amountUsdc: action.rebalance.amountUsdc ?? null,
        transactionRef: action.rebalance.result && (action.rebalance.result.tradeTxHash || action.rebalance.result.txHash || null),
        transactionNonce: action.rebalance.result && action.rebalance.result.tradeNonce !== undefined ? action.rebalance.result.tradeNonce : null,
        approveNonce: action.rebalance.result && action.rebalance.result.approveNonce !== undefined ? action.rebalance.result.approveNonce : null,
        result: action.rebalance.result || null,
      },
    });
  }
  if (action.hedge) {
    entries.push({
      classification: 'polymarket-hedge',
      venue: 'polymarket',
      source: 'mirror-sync.execution.hedge',
      timestamp,
      status: action.hedge.result && action.hedge.result.ok === false ? 'failed' : action.hedge.result && action.hedge.result.status ? action.hedge.result.status : 'ok',
      code: action.hedge.result && action.hedge.result.error ? action.hedge.result.error.code || null : null,
      message: action.hedge.result && action.hedge.result.error ? action.hedge.result.error.message || null : null,
      details: {
        tokenSide: action.hedge.tokenSide || null,
        orderSide: action.hedge.side || null,
        amountUsdc: action.hedge.amountUsdc ?? null,
        executionMode: action.hedge.executionMode || null,
        stateDeltaUsdc: action.hedge.stateDeltaUsdc ?? null,
        transactionRef: action.hedge.result && (action.hedge.result.orderId || action.hedge.result.txHash || null),
        result: action.hedge.result || null,
      },
    });
  }
  return entries;
}

function buildBlockedPendingActionSnapshot(params) {
  const { options, idempotencyKey, pendingAction, code, tickAt, reason } = params;
  return {
    mode: options.executeLive ? 'live' : 'paper',
    status: 'blocked',
    reason: reason || 'Live execution is fail-closed until the pending action is reconciled.',
    code,
    idempotencyKey,
    pendingAction,
    blockedAt: tickAt.toISOString(),
  };
}

function describePendingActionBlock(pendingAction) {
  if (!pendingAction || typeof pendingAction !== 'object') {
    return {
      code: 'PENDING_ACTION_LOCK',
      reason: 'Live execution is fail-closed until the pending action is reconciled.',
    };
  }
  if (pendingAction.status === 'invalid') {
    return {
      code: 'PENDING_ACTION_LOCK_INVALID',
      reason: 'Pending-action lock is unreadable and requires manual cleanup before another live execution.',
    };
  }
  if (pendingAction.status === 'zombie') {
    return {
      code: 'PENDING_ACTION_LOCK_ZOMBIE',
      reason: 'Pending-action lock appears orphaned or stale and now requires manual review.',
    };
  }
  if (pendingAction.requiresManualReview || pendingAction.status === 'reconciliation-required') {
    return {
      code: 'PENDING_ACTION_LOCK_REVIEW',
      reason: 'Pending-action lock requires manual reconciliation before another live execution.',
    };
  }
  return {
    code: 'PENDING_ACTION_LOCK',
    reason: 'Live execution is fail-closed until the pending action is reconciled.',
  };
}

function buildLockResolutionIssue(params) {
  const { kind, resolution, expectedLockNonce } = params;
  const code =
    resolution && resolution.reason === 'nonce-mismatch'
      ? 'PENDING_ACTION_LOCK_CONFLICT'
      : resolution && resolution.reason === 'missing'
        ? 'PENDING_ACTION_LOCK_MISSING'
        : 'PENDING_ACTION_LOCK_CONFLICT';
  const message =
    code === 'PENDING_ACTION_LOCK_CONFLICT'
      ? `Pending-action lock changed during live ${kind}; manual review is required before another execution.`
      : `Pending-action lock disappeared during live ${kind}; manual review is required before another execution.`;
  return {
    code,
    message,
    details: {
      expectedLockNonce: expectedLockNonce || null,
      actualLockNonce: resolution && resolution.lock ? resolution.lock.lockNonce || null : null,
      lockFile: resolution && resolution.lock ? resolution.lock.lockFile || null : null,
      reason: resolution && resolution.reason ? resolution.reason : null,
    },
  };
}

function promotePendingActionLockForReview(stateFile, pendingAction, tickAt) {
  if (!pendingAction || typeof pendingAction !== 'object') return pendingAction;
  if (pendingAction.status === 'invalid') return pendingAction;
  if (!(pendingAction.status === 'zombie' || pendingAction.requiresManualReview)) {
    return pendingAction;
  }
  const promotedStatus = pendingAction.status === 'zombie' ? 'zombie' : 'reconciliation-required';
  const updateResult = updatePendingActionLock(
    stateFile,
    {
      status: promotedStatus,
      requiresManualReview: true,
      updatedAt: tickAt,
    },
    { expectedLockNonce: pendingAction.lockNonce || null },
  );
  return updateResult && updateResult.updated ? updateResult.lock : pendingAction;
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
          rpcUrl: resolvePolymarketRpcHint(options),
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
  const {
    state,
    action,
    idempotencyKey,
    actualRebalanceUsdc,
    actualHedgeUsdc,
    lockFile = null,
    lockRetained = false,
  } = params;
  const actualSpendUsdc = round(actualRebalanceUsdc + actualHedgeUsdc, 6) || 0;
  state.dailySpendUsdc = round((toNumber(state.dailySpendUsdc) || 0) + actualSpendUsdc, 6) || 0;
  const executedLegCount = (actualRebalanceUsdc > 0 ? 1 : 0) + (actualHedgeUsdc > 0 ? 1 : 0);
  if (executedLegCount > 0) {
    state.idempotencyKeys.push(idempotencyKey);
    pruneIdempotencyKeys(state);
  }
  state.tradesToday += executedLegCount;
  state.lastExecution = {
    ...action,
    lockFile,
    lockRetained: Boolean(lockRetained),
    requiresManualReview: Boolean(action && action.requiresManualReview) || Boolean(lockRetained),
  };
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
  if (options.executeLive) {
    let existingLock = readPendingActionLock(loadedFilePath);
    if (existingLock) {
      existingLock = promotePendingActionLockForReview(loadedFilePath, existingLock, tickAt);
      const existingLockBlock = describePendingActionBlock(existingLock);
      snapshot.action = buildBlockedPendingActionSnapshot({
        options,
        idempotencyKey,
        pendingAction: existingLock,
        code: existingLockBlock.code,
        reason: existingLockBlock.reason,
        tickAt,
      });
      pushRuntimeAlert(state, {
        level: 'error',
        scope: 'execution',
        code: snapshot.action.code,
        message: snapshot.action.reason,
        details: {
          idempotencyKey,
          lockFile: existingLock.lockFile || null,
        },
        timestamp: tickAt,
      });
      return;
    }

    if (state.lastExecution && state.lastExecution.requiresManualReview) {
      snapshot.action = buildBlockedPendingActionSnapshot({
        options,
        idempotencyKey,
        pendingAction: {
          ...state.lastExecution,
          source: 'state',
        },
        code: 'LAST_ACTION_REQUIRES_REVIEW',
        reason: 'Previous live action still requires manual review before another execution.',
        tickAt,
      });
      pushRuntimeAlert(state, {
        level: 'error',
        scope: 'execution',
        code: snapshot.action.code,
        message: snapshot.action.reason,
        details: {
          idempotencyKey,
          lastExecutionIdempotencyKey: state.lastExecution.idempotencyKey || null,
          lockNonce: state.lastExecution.lockNonce || null,
        },
        timestamp: tickAt,
      });
      return;
    }

    if (state.lastExecution && state.lastExecution.status === 'pending') {
      state.lastExecution = {
        ...state.lastExecution,
        requiresManualReview: true,
      };
      snapshot.action = buildBlockedPendingActionSnapshot({
        options,
        idempotencyKey,
        pendingAction: {
          ...state.lastExecution,
          source: 'state',
        },
        code: 'PENDING_ACTION_STATE',
        reason: 'Last live action is still marked pending in state and now requires manual review before another execution.',
        tickAt,
      });
      pushRuntimeAlert(state, {
        level: 'error',
        scope: 'execution',
        code: snapshot.action.code,
        message: snapshot.action.reason,
        details: {
          idempotencyKey,
          lastExecutionIdempotencyKey: state.lastExecution.idempotencyKey || null,
          lockNonce: state.lastExecution.lockNonce || null,
        },
        timestamp: tickAt,
      });
      return;
    }
  }

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

  let livePendingLock = null;
  if (options.executeLive) {
    const lockAttempt = tryAcquirePendingActionLock(loadedFilePath, {
      createdAt: tickAt,
      updatedAt: tickAt,
      pid: process.pid,
      strategyHash: hash,
      mode: options.mode,
      executeLive: true,
      idempotencyKey,
      selector: {
        pandoraMarketAddress: options.pandoraMarketAddress || null,
        polymarketMarketId: options.polymarketMarketId || null,
        polymarketSlug: options.polymarketSlug || null,
      },
      plan: {
        driftTriggered: Boolean(snapshotMetrics.driftTriggered),
        hedgeTriggered: Boolean(plan.hedgeTriggered),
        rebalanceSide: plan.rebalanceSide || null,
        plannedRebalanceUsdc: plan.plannedRebalanceUsdc,
        plannedHedgeUsdc: plan.plannedHedgeUsdc,
        plannedSpendUsdc: plan.plannedSpendUsdc,
        hedgeTokenSide: snapshot.actionPlan && snapshot.actionPlan.hedgeTokenSide ? snapshot.actionPlan.hedgeTokenSide : null,
        hedgeOrderSide: snapshot.actionPlan && snapshot.actionPlan.hedgeOrderSide ? snapshot.actionPlan.hedgeOrderSide : null,
        hedgeExecutionMode: snapshot.actionPlan && snapshot.actionPlan.hedgeExecutionMode ? snapshot.actionPlan.hedgeExecutionMode : null,
      },
    });

    if (!lockAttempt.acquired) {
      const contestedLock = promotePendingActionLockForReview(loadedFilePath, lockAttempt.lock, tickAt);
      const contestedLockBlock = describePendingActionBlock(contestedLock);
      snapshot.action = buildBlockedPendingActionSnapshot({
        options,
        idempotencyKey,
        pendingAction: contestedLock,
        code: contestedLockBlock.code,
        reason: contestedLockBlock.reason,
        tickAt,
      });
      pushRuntimeAlert(state, {
        level: 'error',
        scope: 'execution',
        code: snapshot.action.code,
        message: snapshot.action.reason,
        details: {
          idempotencyKey,
          lockFile: contestedLock && contestedLock.lockFile ? contestedLock.lockFile : null,
        },
        timestamp: tickAt,
      });
      return;
    }

    livePendingLock = lockAttempt.lock;
  }

  const action = buildExecutableAction({ options, idempotencyKey, gate });
  action.startedAt = tickAt.toISOString();
  state.lastExecution = {
    mode: action.mode,
    status: 'pending',
    idempotencyKey,
    startedAt: tickAt.toISOString(),
    lockFile: livePendingLock ? livePendingLock.lockFile : null,
    lockNonce: livePendingLock ? livePendingLock.lockNonce || null : null,
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
  action.completedAt = new Date().toISOString();
  let lockRetained = false;
  if (options.executeLive) {
    const expectedLockNonce = livePendingLock ? livePendingLock.lockNonce || null : null;
    action.lockNonce = expectedLockNonce;
    action.transactionNonce = extractActionTransactionNonce(action);

    if (livePendingLock) {
      const nonceUpdate = updatePendingActionLock(
        loadedFilePath,
        {
          transactionNonce: action.transactionNonce,
          chainId:
            action.rebalance && action.rebalance.result && Number.isInteger(Number(action.rebalance.result.chainId))
              ? Number(action.rebalance.result.chainId)
              : options.chainId || null,
          signerAddress:
            action.rebalance && action.rebalance.result && action.rebalance.result.account
              ? action.rebalance.result.account
              : null,
          tradeTxHash:
            action.rebalance && action.rebalance.result && action.rebalance.result.tradeTxHash
              ? action.rebalance.result.tradeTxHash
              : null,
          approveTxHash:
            action.rebalance && action.rebalance.result && action.rebalance.result.approveTxHash
              ? action.rebalance.result.approveTxHash
              : null,
        },
        { expectedLockNonce },
      );
      if (nonceUpdate.updated) {
        livePendingLock = nonceUpdate.lock;
      }
    }

    if (action.status !== 'executed') {
      lockRetained = true;
      action.requiresManualReview = true;
      if (livePendingLock) {
        const updateResult = updatePendingActionLock(
          loadedFilePath,
          {
            status: 'reconciliation-required',
            completedAt: action.completedAt,
            lastError: action.error
              ? {
                  ...action.error,
                  at: action.completedAt,
                }
              : null,
            lastKnownResult: buildPendingActionStateSummary(action),
            requiresManualReview: true,
          },
          { expectedLockNonce },
        );
        if (updateResult.updated) {
          livePendingLock = updateResult.lock;
        } else {
          const conflict = buildLockResolutionIssue({
            kind: 'failure reconciliation',
            resolution: updateResult,
            expectedLockNonce,
          });
          action.lockConflict = conflict;
          if (!action.error) {
            action.error = {
              code: conflict.code,
              message: conflict.message,
              details: conflict.details,
            };
          }
          livePendingLock = updateResult.lock || livePendingLock;
        }
      }
      pushRuntimeAlert(state, {
        level: 'error',
        scope: 'execution',
        code:
          action.lockConflict && action.lockConflict.code
            ? action.lockConflict.code
            : action && action.error && action.error.code
              ? action.error.code
              : 'LIVE_ACTION_REQUIRES_REVIEW',
        message:
          action.lockConflict && action.lockConflict.message
            ? action.lockConflict.message
            : action && action.error && action.error.message
              ? action.error.message
              : 'Live mirror action requires reconciliation before another execution.',
        details: {
          idempotencyKey,
          lockNonce: expectedLockNonce,
          lockFile: livePendingLock && livePendingLock.lockFile ? livePendingLock.lockFile : null,
        },
        timestamp: action.completedAt,
      });
    } else {
      const clearResult = clearPendingActionLock(loadedFilePath, { expectedLockNonce });
      if (!clearResult.cleared) {
        lockRetained = true;
        action.requiresManualReview = true;
        action.lockConflict = buildLockResolutionIssue({
          kind: 'completion',
          resolution: clearResult,
          expectedLockNonce,
        });
        livePendingLock = clearResult.lock || livePendingLock;
        pushRuntimeAlert(state, {
          level: 'error',
          scope: 'execution',
          code: action.lockConflict.code,
          message: action.lockConflict.message,
          details: {
            idempotencyKey,
            lockNonce: expectedLockNonce,
            lockFile: livePendingLock && livePendingLock.lockFile ? livePendingLock.lockFile : null,
          },
          timestamp: action.completedAt,
        });
      } else {
        livePendingLock = clearResult.lock || livePendingLock;
      }
    }
  }

  finalizeExecutedActionState({
    state,
    action,
    idempotencyKey,
    actualRebalanceUsdc,
    actualHedgeUsdc,
    lockFile: livePendingLock ? livePendingLock.lockFile : null,
    lockRetained,
  });
  saveState(loadedFilePath, state);
  appendAuditEntries(loadedFilePath, buildMirrorAuditEntries(action));

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
