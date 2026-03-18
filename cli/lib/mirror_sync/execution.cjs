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

function toRoundedNonNegative(value) {
  return round(Math.max(0, toNumber(value) || 0), 6) || 0;
}

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

function readManagedPolymarketInventory(state) {
  const accounting = state && state.accounting && typeof state.accounting === 'object' ? state.accounting : {};
  const currentHedgeShares =
    round(toNumber(state && (state.currentHedgeShares !== undefined ? state.currentHedgeShares : state.currentHedgeUsdc)) || 0, 6) || 0;
  const explicitYes = toNumber(
    accounting.managedPolymarketYesShares !== undefined
      ? accounting.managedPolymarketYesShares
      : accounting.managedPolymarketYesUsdc,
  );
  const explicitNo = toNumber(
    accounting.managedPolymarketNoShares !== undefined
      ? accounting.managedPolymarketNoShares
      : accounting.managedPolymarketNoUsdc,
  );
  if (explicitYes !== null || explicitNo !== null) {
    return {
      yes: toRoundedNonNegative(explicitYes),
      no: toRoundedNonNegative(explicitNo),
    };
  }
  return {
    yes: currentHedgeShares > 0 ? currentHedgeShares : 0,
    no: currentHedgeShares < 0 ? Math.abs(currentHedgeShares) : 0,
  };
}

function persistManagedPolymarketInventory(state, inventory) {
  if (!state || typeof state !== 'object') return;
  const nextInventory = inventory && typeof inventory === 'object' ? inventory : {};
  const nextYes = toRoundedNonNegative(nextInventory.yes);
  const nextNo = toRoundedNonNegative(nextInventory.no);
  state.accounting = {
    ...(state.accounting && typeof state.accounting === 'object' ? state.accounting : {}),
    managedPolymarketYesShares: nextYes,
    managedPolymarketNoShares: nextNo,
    managedPolymarketYesUsdc: nextYes,
    managedPolymarketNoUsdc: nextNo,
  };
  state.currentHedgeShares = round(nextYes - nextNo, 6) || 0;
  state.currentHedgeUsdc = state.currentHedgeShares;
}

function normalizeTxHash(value) {
  const normalized = String(value || '').trim();
  return /^0x[a-fA-F0-9]{64}$/.test(normalized) ? normalized.toLowerCase() : null;
}

function matchesPendingActionState(lastExecution, pendingAction) {
  if (!(lastExecution && typeof lastExecution === 'object' && pendingAction && typeof pendingAction === 'object')) {
    return false;
  }
  if (lastExecution.lockNonce && pendingAction.lockNonce && lastExecution.lockNonce === pendingAction.lockNonce) {
    return true;
  }
  if (
    lastExecution.idempotencyKey
    && pendingAction.idempotencyKey
    && lastExecution.idempotencyKey === pendingAction.idempotencyKey
  ) {
    return true;
  }
  return false;
}

function readRecoveredActionSummary(pendingAction) {
  const summary =
    pendingAction && pendingAction.lastKnownResult && typeof pendingAction.lastKnownResult === 'object'
      ? pendingAction.lastKnownResult
      : null;
  return summary;
}

function collectPendingActionTxHashes(pendingAction) {
  const actionSummary = readRecoveredActionSummary(pendingAction);
  const hashes = [
    pendingAction && pendingAction.approveTxHash,
    pendingAction && pendingAction.tradeTxHash,
    pendingAction && pendingAction.txHash,
    actionSummary && actionSummary.rebalance && actionSummary.rebalance.result
      ? actionSummary.rebalance.result.approveTxHash
      : null,
    actionSummary && actionSummary.rebalance && actionSummary.rebalance.result
      ? actionSummary.rebalance.result.tradeTxHash
      : null,
    actionSummary && actionSummary.rebalance && actionSummary.rebalance.result
      ? actionSummary.rebalance.result.txHash
      : null,
  ]
    .map(normalizeTxHash)
    .filter(Boolean);
  return Array.from(new Set(hashes));
}

function isSuccessfulReceipt(receipt) {
  const status = receipt && receipt.status;
  return status === 'success' || status === 1 || status === '0x1' || status === true;
}

function isRevertedReceipt(receipt) {
  const status = receipt && receipt.status;
  return status === 'reverted' || status === 0 || status === '0x0' || status === false;
}

async function safeGetTransactionReceipt(publicClient, hash) {
  if (!publicClient || typeof publicClient.getTransactionReceipt !== 'function' || !hash) {
    return {
      hash,
      found: false,
      receipt: null,
      error: null,
    };
  }
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash });
    return {
      hash,
      found: Boolean(receipt),
      receipt: receipt || null,
      error: null,
    };
  } catch (err) {
    const message = err && (err.shortMessage || err.message) ? String(err.shortMessage || err.message) : String(err);
    const notFound =
      err && (
        err.name === 'TransactionReceiptNotFoundError'
        || err.code === 'TRANSACTION_RECEIPT_NOT_FOUND'
        || /receipt/i.test(message) && /not found|could not be found|does not exist/i.test(message)
      );
    if (notFound) {
      return {
        hash,
        found: false,
        receipt: null,
        error: null,
      };
    }
    return {
      hash,
      found: false,
      receipt: null,
      error: {
        code: err && err.code ? String(err.code) : 'PENDING_ACTION_RECEIPT_LOOKUP_FAILED',
        message,
      },
    };
  }
}

function canAutoRecoverConfirmedLock(pendingAction) {
  const summary = readRecoveredActionSummary(pendingAction);
  if (!(summary && summary.status === 'executed')) return false;
  if (summary.error || (pendingAction && pendingAction.lastError)) return false;
  return true;
}

function cloneRecoveryState(state) {
  if (!(state && typeof state === 'object')) return {};
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(state);
    } catch {
      // Fall back to JSON cloning for plain persisted runtime state.
    }
  }
  return JSON.parse(JSON.stringify(state));
}

function commitRecoveredState(targetState, recoveredState) {
  if (!(targetState && typeof targetState === 'object' && recoveredState && typeof recoveredState === 'object')) {
    return false;
  }
  for (const key of Object.keys(targetState)) {
    if (!Object.prototype.hasOwnProperty.call(recoveredState, key)) {
      delete targetState[key];
    }
  }
  Object.assign(targetState, recoveredState);
  return true;
}

function applyRecoveredExecutedActionState(state, pendingAction, tickAt) {
  if (!(state && typeof state === 'object' && pendingAction && typeof pendingAction === 'object')) return false;
  const actionSummary = readRecoveredActionSummary(pendingAction);
  if (!(actionSummary && actionSummary.status === 'executed')) return false;

  if (!Array.isArray(state.idempotencyKeys)) {
    state.idempotencyKeys = [];
  }

  const idempotencyKey = pendingAction.idempotencyKey || actionSummary.idempotencyKey || null;
  const alreadyRecorded = Boolean(idempotencyKey && state.idempotencyKeys.includes(idempotencyKey));
  if (idempotencyKey && !alreadyRecorded) {
    state.idempotencyKeys.push(idempotencyKey);
    pruneIdempotencyKeys(state);
  }

  const rebalanceSucceeded = !(actionSummary.rebalance && actionSummary.rebalance.result && actionSummary.rebalance.result.ok === false);
  const hedgeSucceeded = !(actionSummary.hedge && actionSummary.hedge.result && actionSummary.hedge.result.ok === false);
  const recoveredRebalanceUsdc =
    rebalanceSucceeded && actionSummary.rebalance ? round(Math.max(0, toNumber(actionSummary.rebalance.amountUsdc) || 0), 6) || 0 : 0;
  const recoveredHedgeUsdc =
    hedgeSucceeded && actionSummary.hedge ? round(Math.max(0, toNumber(actionSummary.hedge.amountUsdc) || 0), 6) || 0 : 0;

  if (!alreadyRecorded) {
    state.dailySpendUsdc =
      round((toNumber(state.dailySpendUsdc) || 0) + recoveredRebalanceUsdc + recoveredHedgeUsdc, 6) || 0;
    state.tradesToday =
      (Number.isInteger(Number(state.tradesToday)) ? Number(state.tradesToday) : 0)
      + (recoveredRebalanceUsdc > 0 ? 1 : 0)
      + (recoveredHedgeUsdc > 0 ? 1 : 0);

    if (recoveredRebalanceUsdc > 0) {
      state.cumulativeLpFeesApproxUsdc =
        round((toNumber(state.cumulativeLpFeesApproxUsdc) || 0) + recoveredRebalanceUsdc * 0.003, 6) || 0;
    }

    if (recoveredHedgeUsdc > 0 && actionSummary.hedge) {
      const managedInventory = readManagedPolymarketInventory(state);
      const recoveredShares = round(Math.max(0, toNumber(actionSummary.hedge.amountShares) || 0), 6) || 0;
      if (recoveredShares > 0) {
        if (actionSummary.hedge.side === 'sell') {
          if (actionSummary.hedge.tokenSide === 'yes') {
            managedInventory.yes = round(Math.max(0, managedInventory.yes - recoveredShares), 6) || 0;
          } else {
            managedInventory.no = round(Math.max(0, managedInventory.no - recoveredShares), 6) || 0;
          }
        } else if (actionSummary.hedge.tokenSide === 'yes') {
          managedInventory.yes = round(managedInventory.yes + recoveredShares, 6) || 0;
        } else if (actionSummary.hedge.tokenSide === 'no') {
          managedInventory.no = round(managedInventory.no + recoveredShares, 6) || 0;
        }
        persistManagedPolymarketInventory(state, managedInventory);
      }

      state.cumulativeHedgeNotionalUsdc =
        round((toNumber(state.cumulativeHedgeNotionalUsdc) || 0) + recoveredHedgeUsdc, 6) || 0;
    }
  }

  const priorLastExecution =
    state.lastExecution && typeof state.lastExecution === 'object'
      ? state.lastExecution
      : {};
  state.lastExecution = {
    ...priorLastExecution,
    ...actionSummary,
    mode: priorLastExecution.mode || 'live',
    status: 'executed',
    idempotencyKey: idempotencyKey || priorLastExecution.idempotencyKey || null,
    startedAt:
      actionSummary.startedAt
      || priorLastExecution.startedAt
      || pendingAction.startedAt
      || pendingAction.createdAt
      || tickAt.toISOString(),
    completedAt:
      actionSummary.completedAt
      || pendingAction.completedAt
      || priorLastExecution.completedAt
      || tickAt.toISOString(),
    lockNonce: pendingAction.lockNonce || actionSummary.lockNonce || priorLastExecution.lockNonce || null,
    transactionNonce:
      actionSummary.transactionNonce !== undefined && actionSummary.transactionNonce !== null
        ? actionSummary.transactionNonce
        : pendingAction.transactionNonce !== undefined && pendingAction.transactionNonce !== null
          ? pendingAction.transactionNonce
          : priorLastExecution.transactionNonce !== undefined
            ? priorLastExecution.transactionNonce
            : null,
    lockFile: null,
    lockRetained: false,
    requiresManualReview: false,
    recoveredFromPendingAction: true,
    recoveredAt: tickAt.toISOString(),
    recoveryReason: 'tx-confirmed',
  };

  return true;
}

async function maybeAutoRecoverPendingActionLock(params) {
  const {
    loadedFilePath,
    state,
    pendingAction,
    pendingActionRecoveryClient,
    tickAt,
  } = params;

  if (!(pendingAction && typeof pendingAction === 'object')) {
    return {
      recovered: false,
      lock: null,
      receiptChecks: [],
    };
  }

  const txHashes = collectPendingActionTxHashes(pendingAction);
  if (!pendingActionRecoveryClient || txHashes.length === 0) {
    return {
      recovered: false,
      lock: pendingAction,
      receiptChecks: [],
    };
  }

  const receiptChecks = [];
  for (const hash of txHashes) {
    const receiptCheck = await safeGetTransactionReceipt(pendingActionRecoveryClient, hash);
    receiptChecks.push(receiptCheck);
    if (receiptCheck.error) {
      pushRuntimeAlert(state, {
        level: 'warn',
        scope: 'execution',
        code: 'PENDING_ACTION_LOCK_RECOVERY_CHECK_FAILED',
        message: `Failed to inspect pending-action transaction confirmation for ${hash}.`,
        details: {
          hash,
          lockNonce: pendingAction.lockNonce || null,
          lockFile: pendingAction.lockFile || null,
          error: receiptCheck.error,
        },
        timestamp: tickAt,
      });
      return {
        recovered: false,
        lock: pendingAction,
        receiptChecks,
      };
    }
  }

  const confirmedReceipts = receiptChecks.filter((entry) => entry.found && entry.receipt);
  if (confirmedReceipts.some((entry) => isRevertedReceipt(entry.receipt))) {
    const revertedHashes = confirmedReceipts
      .filter((entry) => isRevertedReceipt(entry.receipt))
      .map((entry) => entry.hash);
    const updateResult = updatePendingActionLock(
      loadedFilePath,
      {
        status: 'reconciliation-required',
        requiresManualReview: true,
        updatedAt: tickAt,
        lastError: {
          code: 'PENDING_ACTION_TX_REVERTED',
          message: 'Recorded Pandora transaction reverted on-chain; manual reconciliation is required.',
          details: {
            revertedHashes,
          },
          at: tickAt.toISOString(),
        },
        settlementCheck: {
          checkedAt: tickAt.toISOString(),
          txHashes,
          revertedHashes,
        },
      },
      { expectedLockNonce: pendingAction.lockNonce || undefined },
    );
    const updatedLock = updateResult && updateResult.updated ? updateResult.lock : pendingAction;
    if (matchesPendingActionState(state.lastExecution, pendingAction)) {
      state.lastExecution = {
        ...(state.lastExecution && typeof state.lastExecution === 'object' ? state.lastExecution : {}),
        completedAt: tickAt.toISOString(),
        status: 'failed',
        requiresManualReview: true,
        error: {
          code: 'PENDING_ACTION_TX_REVERTED',
          message: 'Recorded Pandora transaction reverted on-chain; manual reconciliation is required.',
          details: {
            revertedHashes,
          },
          at: tickAt.toISOString(),
        },
      };
    }
    pushRuntimeAlert(state, {
      level: 'error',
      scope: 'execution',
      code: 'PENDING_ACTION_TX_REVERTED',
      message: 'Pending-action lock retained because a recorded Pandora transaction reverted on-chain.',
      details: {
        revertedHashes,
        lockNonce: updatedLock && updatedLock.lockNonce ? updatedLock.lockNonce : pendingAction.lockNonce || null,
        lockFile: updatedLock && updatedLock.lockFile ? updatedLock.lockFile : pendingAction.lockFile || null,
      },
      timestamp: tickAt,
    });
    return {
      recovered: false,
      lock: updatedLock,
      receiptChecks,
    };
  }

  const allConfirmedSuccessful =
    receiptChecks.length > 0
    && receiptChecks.every((entry) => entry.found && entry.receipt && isSuccessfulReceipt(entry.receipt));
  if (!allConfirmedSuccessful || !canAutoRecoverConfirmedLock(pendingAction)) {
    return {
      recovered: false,
      lock: pendingAction,
      receiptChecks,
    };
  }

  const recoveredState = cloneRecoveryState(state);
  if (!applyRecoveredExecutedActionState(recoveredState, pendingAction, tickAt)) {
    return {
      recovered: false,
      lock: pendingAction,
      receiptChecks,
    };
  }
  const clearResult = clearPendingActionLock(loadedFilePath, {
    expectedLockNonce: pendingAction.lockNonce || undefined,
  });
  if (!clearResult.cleared) {
    return {
      recovered: false,
      lock: clearResult.lock || pendingAction,
      receiptChecks,
    };
  }

  commitRecoveredState(state, recoveredState);
  pushRuntimeAlert(state, {
    level: 'info',
    scope: 'execution',
    code: 'PENDING_ACTION_LOCK_AUTO_RECOVERED',
    message: 'Auto-cleared pending-action lock after confirming recorded Pandora transaction receipts.',
    details: {
      txHashes,
      lockNonce: pendingAction.lockNonce || null,
      lockFile: pendingAction.lockFile || null,
    },
    timestamp: tickAt,
  });
  return {
    recovered: true,
    lock: null,
    receiptChecks,
  };
}

function buildHedgeExecutionPlan(params) {
  const { options, plan, state, verifyPayload, depth } = params;
  const amountShares = round(
    Math.max(
      0,
      toNumber(plan && plan.plannedHedgeShares) !== null
        ? toNumber(plan && plan.plannedHedgeShares)
        : toNumber(plan && plan.plannedHedgeUsdc) || 0,
    ),
    6,
  ) || 0;
  if (amountShares <= 0) {
    return {
      enabled: false,
      tokenId: null,
      tokenSide: null,
      side: null,
      amountUsdc: 0,
      amountShares: 0,
      stateDeltaUsdc: 0,
      hedgeDepth: null,
      inventoryUsdcAvailable: 0,
      inventorySharesAvailable: 0,
      executionMode: 'none',
      recycleEligible: false,
      liveSellAllowed: false,
      recycleReason: 'no-hedge-required',
      referencePrice: null,
    };
  }

  const sourceMarket = verifyPayload && verifyPayload.sourceMarket ? verifyPayload.sourceMarket : {};
  const wantsMoreYesExposure = (toNumber(plan && plan.gapUsdc) || 0) >= 0;
  const defaultTokenSide = wantsMoreYesExposure ? 'yes' : 'no';
  const defaultStateDeltaUsdc = wantsMoreYesExposure ? amountShares : -amountShares;
  const sellTokenSide = wantsMoreYesExposure ? 'no' : 'yes';
  const managedInventory = readManagedPolymarketInventory(state);
  const inventorySharesAvailable = round(
    Math.max(0, sellTokenSide === 'yes' ? managedInventory.yes : managedInventory.no),
    6,
  ) || 0;
  const liveSellDepth = getSellDepthEntry(depth, sellTokenSide);
  const liveSellDepthUsd = toNumber(liveSellDepth && liveSellDepth.depthUsd);
  const liveSellDepthShares = toNumber(liveSellDepth && liveSellDepth.depthShares);

  let side = 'buy';
  let tokenSide = defaultTokenSide;
  let stateDeltaUsdc = defaultStateDeltaUsdc;
  let executionMode = 'buy';
  let hedgeDepth = tokenSide === 'yes' ? depth && depth.yesDepth : depth && depth.noDepth;
  let referencePrice = resolveHedgeReferencePrice(hedgeDepth);
  let amountUsdc = round(
    Math.max(
      0,
      toNumber(plan && plan.plannedHedgeOrderUsd) !== null
        ? toNumber(plan && plan.plannedHedgeOrderUsd)
        : (referencePrice || 1) * amountShares,
    ),
    6,
  ) || 0;
  const recycleEligible = inventorySharesAvailable >= amountShares && amountShares > 0;
  const liveSellAllowed =
    recycleEligible
    && liveSellDepthUsd !== null
    && liveSellDepthUsd >= amountUsdc
    && liveSellDepthShares !== null
    && liveSellDepthShares >= amountShares;
  let recycleReason = recycleEligible ? 'sell-depth-unavailable' : 'insufficient-managed-inventory';

  if (recycleEligible && options.executeLive && liveSellAllowed) {
    side = 'sell';
    tokenSide = sellTokenSide;
    stateDeltaUsdc = defaultStateDeltaUsdc;
    executionMode = 'sell-inventory';
    hedgeDepth = liveSellDepth;
    referencePrice = resolveHedgeReferencePrice(hedgeDepth);
    amountUsdc = round((referencePrice || 1) * amountShares, 6) || 0;
    recycleReason = 'inventory-recycled';
  } else if (recycleEligible && !options.executeLive) {
    side = 'sell';
    tokenSide = sellTokenSide;
    stateDeltaUsdc = defaultStateDeltaUsdc;
    executionMode = 'sell-inventory';
    hedgeDepth = liveSellDepth;
    referencePrice = resolveHedgeReferencePrice(hedgeDepth);
    amountUsdc = round((referencePrice || 1) * amountShares, 6) || 0;
    recycleReason = 'inventory-recycled-paper';
  }

  const tokenId = tokenSide === 'yes' ? sourceMarket.yesTokenId : sourceMarket.noTokenId;
  return {
    enabled: true,
    tokenId,
    tokenSide,
    side,
    amountUsdc,
    amountShares,
    stateDeltaUsdc,
    hedgeDepth,
    inventoryUsdcAvailable: inventorySharesAvailable,
    inventorySharesAvailable,
    executionMode,
    recycleEligible,
    liveSellAllowed,
    recycleReason,
    referencePrice,
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

function buildModeledActionSummary(plan, snapshot, snapshotMetrics) {
  const actionPlan = snapshot && snapshot.actionPlan && typeof snapshot.actionPlan === 'object'
    ? snapshot.actionPlan
    : {};
  return {
    driftTriggered: Boolean(snapshotMetrics && snapshotMetrics.driftTriggered),
    hedgeTriggered: Boolean(plan && plan.hedgeTriggered),
    rebalanceSide: actionPlan.rebalanceSide || (plan && plan.rebalanceSide) || null,
    plannedRebalanceUsdc: toNumber(plan && plan.plannedRebalanceUsdc),
    plannedHedgeUsdc: toNumber(plan && plan.plannedHedgeUsdc),
    plannedSpendUsdc:
      actionPlan.plannedSpendUsdc !== undefined && actionPlan.plannedSpendUsdc !== null
        ? toNumber(actionPlan.plannedSpendUsdc)
        : toNumber(plan && plan.plannedSpendUsdc),
    rebalanceSizingMode: actionPlan.rebalanceSizingMode || (plan && plan.rebalanceSizingMode) || null,
    rebalanceTargetUsdc:
      actionPlan.rebalanceTargetUsdc !== undefined && actionPlan.rebalanceTargetUsdc !== null
        ? toNumber(actionPlan.rebalanceTargetUsdc)
        : toNumber(plan && plan.rebalanceTargetUsdc),
    reserveSource: actionPlan.reserveSource || (plan && plan.reserveSource) || null,
    hedgeTokenSide: actionPlan.hedgeTokenSide || (plan && plan.hedgeTokenSide) || null,
    hedgeOrderSide: actionPlan.hedgeOrderSide || null,
    hedgeExecutionMode: actionPlan.hedgeExecutionMode || null,
  };
}

function buildActionPlanningTelemetry(snapshot) {
  const actionPlan = snapshot && snapshot.actionPlan && typeof snapshot.actionPlan === 'object'
    ? snapshot.actionPlan
    : null;
  if (!actionPlan) return null;
  return {
    rebalanceSide: actionPlan.rebalanceSide || null,
    plannedSpendUsdc:
      actionPlan.plannedSpendUsdc !== undefined && actionPlan.plannedSpendUsdc !== null
        ? toNumber(actionPlan.plannedSpendUsdc)
        : null,
    hedgeTokenSide: actionPlan.hedgeTokenSide || null,
    hedgeOrderSide: actionPlan.hedgeOrderSide || null,
    hedgeExecutionMode: actionPlan.hedgeExecutionMode || null,
    hedgeStateDeltaUsdc:
      actionPlan.hedgeStateDeltaUsdc !== undefined && actionPlan.hedgeStateDeltaUsdc !== null
        ? toNumber(actionPlan.hedgeStateDeltaUsdc)
        : null,
    hedgeInventoryUsdcAvailable:
      actionPlan.hedgeInventoryUsdcAvailable !== undefined && actionPlan.hedgeInventoryUsdcAvailable !== null
        ? toNumber(actionPlan.hedgeInventoryUsdcAvailable)
        : null,
    hedgeInventorySharesAvailable:
      actionPlan.hedgeInventorySharesAvailable !== undefined && actionPlan.hedgeInventorySharesAvailable !== null
        ? toNumber(actionPlan.hedgeInventorySharesAvailable)
        : null,
    hedgeRecycleEligible: Boolean(actionPlan.hedgeRecycleEligible),
    hedgeLiveSellAllowed: Boolean(actionPlan.hedgeLiveSellAllowed),
    hedgeRecycleReason: actionPlan.hedgeRecycleReason || null,
    hedgeOrderReferencePrice:
      actionPlan.hedgeOrderReferencePrice !== undefined && actionPlan.hedgeOrderReferencePrice !== null
        ? toNumber(actionPlan.hedgeOrderReferencePrice)
        : null,
    hedgeOrderUsd:
      actionPlan.hedgeOrderUsd !== undefined && actionPlan.hedgeOrderUsd !== null
        ? toNumber(actionPlan.hedgeOrderUsd)
        : null,
    hedgeOrderShares:
      actionPlan.hedgeOrderShares !== undefined && actionPlan.hedgeOrderShares !== null
        ? toNumber(actionPlan.hedgeOrderShares)
        : null,
  };
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
  const details = err && err.details && typeof err.details === 'object' ? err.details : {};
  return {
    ok: false,
    error: {
      code: err && err.code ? String(err.code) : null,
      message: err && err.message ? String(err.message) : String(err),
      details,
    },
    tradeTxHash:
      details.tradeTxHash || details.transactionHash || null,
    approveTxHash:
      details.approveTxHash || null,
    txHash:
      details.txHash || details.tradeTxHash || details.transactionHash || null,
    executionRouteRequested:
      details.requestedRoute || details.executionRouteRequested || null,
    executionRouteResolved:
      details.resolvedRoute || details.executionRouteResolved || null,
    executionRouteFallback:
      details.executionRouteFallback || null,
    executionRouteFallbackUsed: Boolean(details.executionRouteFallbackUsed),
    executionRouteFallbackReason:
      details.executionRouteFallbackReason || null,
    flashbotsRelayUrl:
      details.flashbotsRelayUrl || details.relayUrl || null,
    flashbotsRelayMethod:
      details.flashbotsRelayMethod || details.relayMethod || null,
    flashbotsTargetBlockNumber:
      details.flashbotsTargetBlockNumber !== undefined
        ? details.flashbotsTargetBlockNumber
        : details.targetBlockNumber !== undefined
          ? details.targetBlockNumber
          : null,
    flashbotsRelayResponseId:
      details.flashbotsRelayResponseId !== undefined
        ? details.flashbotsRelayResponseId
        : details.relayResponseId !== undefined
          ? details.relayResponseId
          : null,
    flashbotsBundleHash:
      details.flashbotsBundleHash || details.bundleHash || null,
    flashbotsSimulation:
      details.flashbotsSimulation || details.simulation || null,
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
  const code = action.error && action.error.code ? action.error.code : action.code || null;
  const message = action.error && action.error.message ? action.error.message : action.reason || null;
  const entries = [
    {
      classification: 'sync-action',
      venue: 'mirror',
      source: 'mirror-sync.execution',
      timestamp,
      status: action.status || null,
      code,
      message,
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
        model: action.model || null,
        block: action.block || null,
        planning: action.planning || null,
        pendingAction: action.pendingAction || null,
        failedChecks: Array.isArray(action.failedChecks) ? action.failedChecks : [],
        failedChecksRaw: Array.isArray(action.failedChecksRaw) ? action.failedChecksRaw : [],
        bypassedFailedChecks: Array.isArray(action.bypassedFailedChecks) ? action.bypassedFailedChecks : [],
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
        executionRouteRequested: action.rebalance.result && action.rebalance.result.executionRouteRequested
          ? action.rebalance.result.executionRouteRequested
          : null,
        executionRouteResolved: action.rebalance.result && action.rebalance.result.executionRouteResolved
          ? action.rebalance.result.executionRouteResolved
          : null,
        executionRouteFallback: action.rebalance.result && action.rebalance.result.executionRouteFallback
          ? action.rebalance.result.executionRouteFallback
          : null,
        executionRouteFallbackUsed: Boolean(
          action.rebalance.result && action.rebalance.result.executionRouteFallbackUsed,
        ),
        executionRouteFallbackReason: action.rebalance.result && action.rebalance.result.executionRouteFallbackReason
          ? action.rebalance.result.executionRouteFallbackReason
          : null,
        flashbotsRelayUrl: action.rebalance.result && action.rebalance.result.flashbotsRelayUrl
          ? action.rebalance.result.flashbotsRelayUrl
          : null,
        flashbotsRelayMethod: action.rebalance.result && action.rebalance.result.flashbotsRelayMethod
          ? action.rebalance.result.flashbotsRelayMethod
          : null,
        flashbotsTargetBlockNumber:
          action.rebalance.result && action.rebalance.result.flashbotsTargetBlockNumber !== undefined
            ? action.rebalance.result.flashbotsTargetBlockNumber
            : null,
        flashbotsRelayResponseId:
          action.rebalance.result && action.rebalance.result.flashbotsRelayResponseId !== undefined
            ? action.rebalance.result.flashbotsRelayResponseId
            : null,
        flashbotsBundleHash: action.rebalance.result && action.rebalance.result.flashbotsBundleHash
          ? action.rebalance.result.flashbotsBundleHash
          : null,
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
  const { options, idempotencyKey, pendingAction, code, tickAt, reason, blockKind = 'pending-action-lock' } = params;
  return {
    mode: options.executeLive ? 'live' : 'paper',
    status: 'blocked',
    reason: reason || 'Live execution is fail-closed until the pending action is reconciled.',
    code,
    block: {
      kind: blockKind,
      code,
      reason: reason || 'Live execution is fail-closed until the pending action is reconciled.',
    },
    idempotencyKey,
    pendingAction,
    blockedAt: tickAt.toISOString(),
    startedAt: tickAt.toISOString(),
    completedAt: tickAt.toISOString(),
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
    const configuredPrivateKey = options.polymarketPrivateKey || options.privateKey || null;
    const configuredFunder = options.polymarketFunder || options.funder || null;
    const apiKey = options.polymarketApiKey || envCreds.apiKey;
    const apiSecret = options.polymarketApiSecret || envCreds.apiSecret;
    const apiPassphrase = options.polymarketApiPassphrase || envCreds.apiPassphrase;
    let hedgeResult;
    if (!configuredPrivateKey && envCreds.privateKeyInvalid) {
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
          privateKey: configuredPrivateKey || envCreds.privateKey,
          funder: configuredFunder || envCreds.funder,
          apiKey,
          apiSecret,
          apiPassphrase,
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
      amountShares: executionPlan.amountShares,
      referencePrice: executionPlan.referencePrice,
      stateDeltaUsdc: executionPlan.stateDeltaUsdc,
      inventoryUsdcAvailable: executionPlan.inventoryUsdcAvailable,
      inventorySharesAvailable: executionPlan.inventorySharesAvailable,
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
      amountShares: executionPlan.amountShares,
      referencePrice: executionPlan.referencePrice,
      stateDeltaUsdc: executionPlan.stateDeltaUsdc,
      inventoryUsdcAvailable: executionPlan.inventoryUsdcAvailable,
      inventorySharesAvailable: executionPlan.inventorySharesAvailable,
      recycleEligible: executionPlan.recycleEligible,
      liveSellAllowed: executionPlan.liveSellAllowed,
      recycleReason: executionPlan.recycleReason,
      executionMode: executionPlan.executionMode,
      result: { status: 'simulated' },
    };
  }

  const hedgeResultOk = !options.executeLive || (action.hedge && action.hedge.result && action.hedge.result.ok !== false);
  if (hedgeResultOk) {
    const managedInventory = readManagedPolymarketInventory(state);
    if (executionPlan.side === 'sell') {
      if (executionPlan.tokenSide === 'yes') {
        managedInventory.yes = round(Math.max(0, managedInventory.yes - executionPlan.amountShares), 6) || 0;
      } else {
        managedInventory.no = round(Math.max(0, managedInventory.no - executionPlan.amountShares), 6) || 0;
      }
    } else if (executionPlan.tokenSide === 'yes') {
      managedInventory.yes = round(managedInventory.yes + executionPlan.amountShares, 6) || 0;
    } else {
      managedInventory.no = round(managedInventory.no + executionPlan.amountShares, 6) || 0;
    }
    persistManagedPolymarketInventory(state, managedInventory);
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

async function finalizeNonExecutableAction(params) {
  const {
    state,
    snapshot,
    action,
    loadedFilePath,
    tickAt,
    sendWebhook,
    strategyHash,
    iteration,
    actions,
    webhookReports,
  } = params;
  if (!(action && typeof action === 'object')) return;
  if (!action.startedAt) action.startedAt = tickAt.toISOString();
  if (!action.completedAt) action.completedAt = tickAt.toISOString();
  if (snapshot && snapshot.actionPlan && !action.planning) {
    action.planning = buildActionPlanningTelemetry(snapshot);
  }
  snapshot.action = action;
  actions.push(action);
  saveState(loadedFilePath, state);
  appendAuditEntries(loadedFilePath, buildMirrorAuditEntries(action));
  if (sendWebhook) {
    const report = await sendWebhook({
      event: 'mirror.sync.trigger',
      strategyHash,
      iteration,
      message: `[Pandora Mirror] action=${action.status} code=${action.code || (action.error && action.error.code) || 'none'} reason=${action.reason || (action.error && action.error.message) || 'n/a'}`,
      action,
      snapshot,
    });
    webhookReports.push(report);
  }
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
    pendingActionRecoveryClient = null,
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
      hedgeInventorySharesAvailable: hedgeExecutionPlan.inventorySharesAvailable,
      hedgeRecycleEligible: hedgeExecutionPlan.recycleEligible,
      hedgeLiveSellAllowed: hedgeExecutionPlan.liveSellAllowed,
      hedgeRecycleReason: hedgeExecutionPlan.recycleReason,
      hedgeOrderReferencePrice: hedgeExecutionPlan.referencePrice,
      hedgeOrderUsd: hedgeExecutionPlan.amountUsdc,
      hedgeOrderShares: hedgeExecutionPlan.amountShares,
    };
  }

  const idempotencyKey = buildIdempotencyKey(options, snapshot, tickAt.getTime());
  if (options.executeLive) {
    let existingLock = readPendingActionLock(loadedFilePath);
    if (existingLock && (existingLock.status === 'invalid' || existingLock.status === 'zombie')) {
      const clearResult = clearPendingActionLock(loadedFilePath, {
        expectedLockNonce: existingLock.lockNonce || undefined,
      });
      if (clearResult && clearResult.cleared) {
        pushRuntimeAlert(state, {
          level: 'info',
          scope: 'execution',
          code: 'PENDING_ACTION_LOCK_AUTO_CLEARED',
          message: `Auto-cleared ${existingLock.status} pending-action lock before live execution.`,
          details: {
            idempotencyKey,
            lockFile: existingLock.lockFile || null,
            lockStatus: existingLock.status,
          },
          timestamp: tickAt,
        });
        existingLock = null;
      } else {
        existingLock = readPendingActionLock(loadedFilePath);
      }
    }
    if (existingLock && !(existingLock.status === 'invalid' || existingLock.status === 'zombie')) {
      const recoveryResult = await maybeAutoRecoverPendingActionLock({
        loadedFilePath,
        state,
        pendingAction: existingLock,
        pendingActionRecoveryClient,
        tickAt,
      });
      if (recoveryResult.recovered) {
        existingLock = null;
      } else if (recoveryResult.lock) {
        existingLock = recoveryResult.lock;
      }
    }
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
      snapshot.action.model = buildModeledActionSummary(plan, snapshot, snapshotMetrics);
      await finalizeNonExecutableAction({
        state,
        snapshot,
        action: snapshot.action,
        loadedFilePath,
        tickAt,
        sendWebhook,
        strategyHash: hash,
        iteration,
        actions,
        webhookReports,
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
      snapshot.action.model = buildModeledActionSummary(plan, snapshot, snapshotMetrics);
      snapshot.action.block = {
        kind: 'last-execution-review',
        code: 'LAST_ACTION_REQUIRES_REVIEW',
        reason: 'Previous live action still requires manual review before another execution.',
      };
      await finalizeNonExecutableAction({
        state,
        snapshot,
        action: snapshot.action,
        loadedFilePath,
        tickAt,
        sendWebhook,
        strategyHash: hash,
        iteration,
        actions,
        webhookReports,
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
      snapshot.action.model = buildModeledActionSummary(plan, snapshot, snapshotMetrics);
      snapshot.action.block = {
        kind: 'last-execution-pending',
        code: 'PENDING_ACTION_STATE',
        reason: 'Last live action is still marked pending in state and now requires manual review before another execution.',
      };
      await finalizeNonExecutableAction({
        state,
        snapshot,
        action: snapshot.action,
        loadedFilePath,
        tickAt,
        sendWebhook,
        strategyHash: hash,
        iteration,
        actions,
        webhookReports,
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
      code: 'DUPLICATE_IDEMPOTENCY_KEY',
      startedAt: tickAt.toISOString(),
      completedAt: tickAt.toISOString(),
    };
    snapshot.action.model = buildModeledActionSummary(plan, snapshot, snapshotMetrics);
    await finalizeNonExecutableAction({
      state,
      snapshot,
      action: snapshot.action,
      loadedFilePath,
      tickAt,
      sendWebhook,
      strategyHash: hash,
      iteration,
      actions,
      webhookReports,
    });
    return;
  }

  if (!gate.ok) {
    snapshot.action = {
      mode: options.executeLive ? 'live' : 'paper',
      status: 'blocked',
      reason: 'Strict gate blocked execution.',
      code: 'STRICT_GATE_BLOCKED',
      idempotencyKey,
      failedChecks: gate.failedChecks,
      failedChecksRaw: gate.failedChecksRaw,
      bypassedFailedChecks: gate.bypassedFailedChecks,
      block: {
        kind: 'gate',
        code: 'STRICT_GATE_BLOCKED',
        reason: 'Strict gate blocked execution.',
      },
      startedAt: tickAt.toISOString(),
      completedAt: tickAt.toISOString(),
    };
    snapshot.action.model = buildModeledActionSummary(plan, snapshot, snapshotMetrics);
    await finalizeNonExecutableAction({
      state,
      snapshot,
      action: snapshot.action,
      loadedFilePath,
      tickAt,
      sendWebhook,
      strategyHash: hash,
      iteration,
      actions,
      webhookReports,
    });
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
      plan: buildModeledActionSummary(plan, snapshot, snapshotMetrics),
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
      snapshot.action.model = buildModeledActionSummary(plan, snapshot, snapshotMetrics);
      await finalizeNonExecutableAction({
        state,
        snapshot,
        action: snapshot.action,
        loadedFilePath,
        tickAt,
        sendWebhook,
        strategyHash: hash,
        iteration,
        actions,
        webhookReports,
      });
      return;
    }

    livePendingLock = lockAttempt.lock;
  }

  const action = buildExecutableAction({ options, idempotencyKey, gate });
  action.model = buildModeledActionSummary(plan, snapshot, snapshotMetrics);
  action.startedAt = tickAt.toISOString();
  state.lastExecution = {
    mode: action.mode,
    status: 'pending',
    idempotencyKey,
    startedAt: tickAt.toISOString(),
    lockFile: livePendingLock ? livePendingLock.lockFile : null,
    lockNonce: livePendingLock ? livePendingLock.lockNonce || null : null,
    model: action.model,
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

    if (livePendingLock) {
      const resultSummaryUpdate = updatePendingActionLock(
        loadedFilePath,
        {
          completedAt: action.completedAt,
          lastKnownResult: buildPendingActionStateSummary(action),
          updatedAt: action.completedAt,
        },
        { expectedLockNonce },
      );
      if (resultSummaryUpdate.updated) {
        livePendingLock = resultSummaryUpdate.lock;
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
  buildActionPlanningTelemetry,
  normalizeExecutionFailure,
  maybeAutoRecoverPendingActionLock,
  executeRebalanceLeg,
  executeHedgeLeg,
  finalizeExecutedActionState,
  finalizeNonExecutableAction,
  processTriggeredAction,
};
