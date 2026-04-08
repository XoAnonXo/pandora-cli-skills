const { round } = require('../shared/utils.cjs');
const {
  ensureMarketPairIdentityShape,
  ensureManagedInventorySnapshotShape,
  ensureObservedTradeShape,
  ensureRetryTelemetryShape,
  ensureHedgeSignalShape,
  ensureSkippedVolumeCountersShape,
  ensureTargetHedgeInventoryShape,
} = require('../mirror_hedge_state_store.cjs');

const MIRROR_HEDGE_STATUS_SCHEMA_VERSION = '1.0.0';
const BUG_006_WARNING_CODES = {
  SELL_BLOCKED_BUY_PHASE: 'BUG-006_SELL_BLOCKED_BUY_PHASE',
  QUEUE_PRUNE: 'BUG-006_QUEUE_PRUNE',
  QUEUE_INVALIDATION: 'BUG-006_QUEUE_INVALIDATION',
};

function normalizeOptionalString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function toFiniteNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toTimestampMs(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function sumField(entries, fieldName) {
  return round(
    (Array.isArray(entries) ? entries : []).reduce((total, entry) => {
      const numeric = toFiniteNumberOrNull(entry && entry[fieldName]);
      return total + (numeric === null ? 0 : numeric);
    }, 0),
  ) || 0;
}

function isHedgeDrivingConfirmedExposure(entry) {
  return normalizeOptionalString(entry && entry.reason) !== 'internal-wallet';
}

function pluralize(count, singular, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function formatCountBreakdown(counts = {}) {
  const entries = Object.entries(counts)
    .filter(([, value]) => Number(value) > 0)
    .sort((left, right) => Number(right[1]) - Number(left[1]) || String(left[0]).localeCompare(String(right[0])));
  if (!entries.length) return null;
  return entries.map(([label, value]) => `${label}=${value}`).join(', ');
}

function pushDiagnostic(diagnostics, code, message) {
  diagnostics.push(`[${code}] ${message}`);
}

function buildDeferredQueueDiagnostics(entries, retryTelemetry = {}) {
  const queue = Array.isArray(entries) ? entries : [];
  const nowMs = Date.now();
  const invalidReasonCodes = new Set([
    'invalid-hedge-amount',
    'non-executable-partial',
    'execution-failed',
    'missing-token-id',
    'fee-budget-exhausted',
    'depth-unavailable',
  ]);
  const reasonCounts = {};
  const invalidReasonCounts = {};
  let oldest = null;
  let newest = null;
  let invalidCount = 0;

  for (const entry of queue) {
    const createdAtMs = toTimestampMs(entry && (entry.updatedAt || entry.createdAt || entry.dueAt));
    if (createdAtMs !== null) {
      if (oldest === null || createdAtMs < oldest.timestampMs) {
        oldest = { timestampMs: createdAtMs, entry };
      }
      if (newest === null || createdAtMs > newest.timestampMs) {
        newest = { timestampMs: createdAtMs, entry };
      }
    }

    const reason = normalizeOptionalString(entry && entry.reason) || 'unspecified';
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    const amountUsdc = toFiniteNumberOrNull(entry && entry.amountUsdc);
    const amountShares = toFiniteNumberOrNull(entry && entry.amountShares);
    let invalidReason = null;
    if (invalidReasonCodes.has(reason)) {
      invalidReason = reason;
    } else if ((amountUsdc !== null && amountUsdc <= 0) || (amountShares !== null && amountShares <= 0)) {
      invalidReason = 'non-positive-sizing';
    }
    if (invalidReason) {
      invalidCount += 1;
      invalidReasonCounts[invalidReason] = (invalidReasonCounts[invalidReason] || 0) + 1;
    }
  }

  const sellBlockedCount = Number(retryTelemetry.sellBlockedCount || 0);
  const sellFailedCount = Number(retryTelemetry.sellFailedCount || 0);
  const sellRecoveredCount = Number(retryTelemetry.sellRecoveredCount || 0);
  const lastBlockedAt = normalizeOptionalString(retryTelemetry.lastBlockedAt);
  const lastBlockedReason = normalizeOptionalString(retryTelemetry.lastBlockedReason);
  const lastBlockedReasonCode = normalizeOptionalString(retryTelemetry.lastBlockedReasonCode);
  const lastFailureAt = normalizeOptionalString(retryTelemetry.lastFailureAt);
  const lastFailureMessage = normalizeOptionalString(retryTelemetry.lastFailureMessage);
  const lastFailureCode = normalizeOptionalString(retryTelemetry.lastFailureCode);
  const lastRecoveryAt = normalizeOptionalString(retryTelemetry.lastRecoveryAt);
  const warnings = [];
  const diagnostics = [];
  let queueStatusMessage = null;

  if (queue.length > 0 && (sellBlockedCount > 0 || sellFailedCount > 0)) {
    queueStatusMessage = lastBlockedReason
      ? `Buy phase is skipped while live sell reduction remains pending: ${lastBlockedReason}`
      : `Buy phase is skipped while live sell reduction remains pending.`;
    warnings.push({
      code: 'LIVE_SELL_REDUCTION_PENDING',
      message: queueStatusMessage,
    });
    const sellStatusParts = [];
    if (sellBlockedCount > 0) {
      sellStatusParts.push(`${sellBlockedCount} blocked sell ${pluralize(sellBlockedCount, 'attempt')}`);
    }
    if (sellFailedCount > 0) {
      sellStatusParts.push(`${sellFailedCount} failed sell ${pluralize(sellFailedCount, 'attempt')}`);
    }
    const latestEventText = lastBlockedAt
      ? ` Last blocked at ${lastBlockedAt}.`
      : lastFailureAt
        ? ` Last sell failure at ${lastFailureAt}.`
        : '';
    const latestReasonText = lastBlockedReason
      ? ` Last blocked reason: ${lastBlockedReason}.`
      : lastFailureMessage
        ? ` Last sell failure: ${lastFailureMessage}.`
        : '';
    pushDiagnostic(
      diagnostics,
      BUG_006_WARNING_CODES.SELL_BLOCKED_BUY_PHASE,
      `Buy-side hedge expansion remains paused while sell-side cleanup stays queued (${sellStatusParts.join(', ')}). Deferred sell queue still has ${queue.length} ${pluralize(queue.length, 'entry', 'entries')}.${latestEventText}${latestReasonText}`.trim(),
    );
  }

  if (sellRecoveredCount > 0) {
    warnings.push({
      code: 'DEFERRED_QUEUE_PRUNED',
      message: `Recovered ${sellRecoveredCount} stale deferred sell entr${sellRecoveredCount === 1 ? 'y' : 'ies'} from live queue.`,
    });
    pushDiagnostic(
      diagnostics,
      BUG_006_WARNING_CODES.QUEUE_PRUNE,
      `Deferred sell queue auto-pruned ${sellRecoveredCount} stale ${pluralize(sellRecoveredCount, 'entry', 'entries')} after sell exposure cleared.${lastRecoveryAt ? ` Last recovery at ${lastRecoveryAt}.` : ''}`,
    );
  }

  if (invalidCount > 0) {
    warnings.push({
      code: 'DEFERRED_QUEUE_INVALID_ENTRY',
      message: `Deferred hedge queue contains ${invalidCount} entr${invalidCount === 1 ? 'y' : 'ies'} with invalid or non-executable sizing.`,
    });
    const invalidBreakdown = formatCountBreakdown(invalidReasonCounts);
    pushDiagnostic(
      diagnostics,
      BUG_006_WARNING_CODES.QUEUE_INVALIDATION,
      `Deferred hedge queue still contains ${invalidCount} invalid or non-executable ${pluralize(invalidCount, 'entry', 'entries')}.${invalidBreakdown ? ` Breakdown: ${invalidBreakdown}.` : ''}`,
    );
  }

  return {
    deferredHedgeCount: queue.length,
    deferredHedgeInvalidCount: invalidCount,
    deferredHedgeReasonCounts: reasonCounts,
    deferredHedgeOldestCreatedAt: oldest ? new Date(oldest.timestampMs).toISOString() : null,
    deferredHedgeOldestAgeMs: oldest ? Math.max(0, nowMs - oldest.timestampMs) : null,
    deferredHedgeNewestCreatedAt: newest ? new Date(newest.timestampMs).toISOString() : null,
    deferredHedgeNewestAgeMs: newest ? Math.max(0, nowMs - newest.timestampMs) : null,
    deferredHedgeRecoveredCount: sellRecoveredCount,
    deferredHedgeLastBlockedReasonCode: lastBlockedReasonCode,
    deferredHedgeLastBlockedReason: lastBlockedReason,
    deferredHedgeLastFailureCode: lastFailureCode,
    deferredHedgeLastFailureMessage: lastFailureMessage,
    deferredHedgeLastRecoveryAt: lastRecoveryAt,
    queueStatusMessage,
    warnings,
    diagnostics,
  };
}

function buildBundleFacingHedgePayload(params = {}) {
  const state = params.state && typeof params.state === 'object' ? params.state : {};
  const plan = params.plan && typeof params.plan === 'object' ? params.plan : null;
  const marketPairIdentity = ensureMarketPairIdentityShape(params.marketPairIdentity || state.marketPairIdentity || state);
  const inventory = params.managedPolymarketInventorySnapshot !== undefined
    ? ensureManagedInventorySnapshotShape(params.managedPolymarketInventorySnapshot)
    : state.managedPolymarketInventorySnapshot
      ? ensureManagedInventorySnapshotShape(state.managedPolymarketInventorySnapshot)
      : null;
  const targetInventory = params.targetHedgeInventory !== undefined
    ? ensureTargetHedgeInventoryShape(params.targetHedgeInventory)
    : ensureTargetHedgeInventoryShape(state.targetHedgeInventory);
  const retryTelemetry = ensureRetryTelemetryShape(params.retryTelemetry || state.retryTelemetry || {});
  const lastObservedTrade = params.lastObservedTrade !== undefined
    ? ensureObservedTradeShape(params.lastObservedTrade)
    : ensureObservedTradeShape(state.lastObservedTrade);
  const lastHedgeSignal = params.lastHedgeSignal !== undefined
    ? ensureHedgeSignalShape(params.lastHedgeSignal)
    : ensureHedgeSignalShape(state.lastHedgeSignal);
  const skippedVolumeCounters = ensureSkippedVolumeCountersShape(params.skippedVolumeCounters || state.skippedVolumeCounters || {});
  const confirmedExposureLedger = Array.isArray(params.confirmedExposureLedger || state.confirmedExposureLedger)
    ? params.confirmedExposureLedger || state.confirmedExposureLedger
    : [];
  const hedgeDrivingConfirmedExposureLedger = confirmedExposureLedger.filter(isHedgeDrivingConfirmedExposure);
  const pendingMempoolOverlays = Array.isArray(params.pendingMempoolOverlays || state.pendingMempoolOverlays)
    ? params.pendingMempoolOverlays || state.pendingMempoolOverlays
    : [];
  const deferredHedgeQueue = Array.isArray(params.deferredHedgeQueue || state.deferredHedgeQueue)
    ? params.deferredHedgeQueue || state.deferredHedgeQueue
    : [];
  const deferredQueueDiagnostics = buildDeferredQueueDiagnostics(deferredHedgeQueue, retryTelemetry);
  const runtimeWarnings = deferredQueueDiagnostics.warnings;
  const runtimeDiagnostics = deferredQueueDiagnostics.diagnostics;
  const warnings = Array.isArray(plan && plan.warnings)
    ? plan.warnings.concat(runtimeWarnings)
    : runtimeWarnings.slice();
  const diagnostics = runtimeDiagnostics.slice();

  return {
    schemaVersion: MIRROR_HEDGE_STATUS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    stateFile: params.stateFile || null,
    strategyHash: params.strategyHash || state.strategyHash || null,
    marketPairIdentity,
    whitelistFingerprint: normalizeOptionalString(params.whitelistFingerprint || state.whitelistFingerprint),
    runtimeStatus: normalizeOptionalString(params.runtimeStatus || state.runtimeStatus) || 'idle',
    ready: Boolean(plan && plan.summary && plan.summary.ready),
    summary: {
      confirmedExposureCount: hedgeDrivingConfirmedExposureLedger.length,
      confirmedExposureUsdc: sumField(hedgeDrivingConfirmedExposureLedger, 'amountUsdc'),
      pendingOverlayCount: pendingMempoolOverlays.length,
      pendingOverlayUsdc: sumField(pendingMempoolOverlays, 'amountUsdc'),
      deferredHedgeCount: deferredQueueDiagnostics.deferredHedgeCount,
      deferredHedgeUsdc: sumField(deferredHedgeQueue, 'amountUsdc'),
      deferredHedgeInvalidCount: deferredQueueDiagnostics.deferredHedgeInvalidCount,
      deferredHedgeReasonCounts: deferredQueueDiagnostics.deferredHedgeReasonCounts,
      deferredHedgeOldestCreatedAt: deferredQueueDiagnostics.deferredHedgeOldestCreatedAt,
      deferredHedgeOldestAgeMs: deferredQueueDiagnostics.deferredHedgeOldestAgeMs,
      deferredHedgeNewestCreatedAt: deferredQueueDiagnostics.deferredHedgeNewestCreatedAt,
      deferredHedgeNewestAgeMs: deferredQueueDiagnostics.deferredHedgeNewestAgeMs,
      deferredHedgeRecoveredCount: deferredQueueDiagnostics.deferredHedgeRecoveredCount,
      deferredHedgeLastBlockedReasonCode: deferredQueueDiagnostics.deferredHedgeLastBlockedReasonCode,
      deferredHedgeLastBlockedReason: deferredQueueDiagnostics.deferredHedgeLastBlockedReason,
      deferredHedgeLastFailureCode: deferredQueueDiagnostics.deferredHedgeLastFailureCode,
      deferredHedgeLastFailureMessage: deferredQueueDiagnostics.deferredHedgeLastFailureMessage,
      deferredHedgeLastRecoveryAt: deferredQueueDiagnostics.deferredHedgeLastRecoveryAt,
      queueStatusMessage: deferredQueueDiagnostics.queueStatusMessage,
      inventoryStatus: inventory ? inventory.status : null,
      targetYesShares: targetInventory.yesShares || 0,
      targetNoShares: targetInventory.noShares || 0,
      currentYesShares: inventory && Number.isFinite(Number(inventory.yesShares)) ? Number(inventory.yesShares) : 0,
      currentNoShares: inventory && Number.isFinite(Number(inventory.noShares)) ? Number(inventory.noShares) : 0,
      excessYesToSell: plan && plan.summary ? plan.summary.excessYesToSell : 0,
      excessNoToSell: plan && plan.summary ? plan.summary.excessNoToSell : 0,
      deficitYesToBuy: plan && plan.summary ? plan.summary.deficitYesToBuy : 0,
      deficitNoToBuy: plan && plan.summary ? plan.summary.deficitNoToBuy : 0,
      netTargetSide: targetInventory.netSide || null,
      netTargetShares: targetInventory.netShares || 0,
      availableHedgeFeeBudgetUsdc: Number(state.availableHedgeFeeBudgetUsdc || 0),
      belowThresholdPendingUsdc: Number(state.belowThresholdPendingUsdc || 0),
      sellRetryAttemptedCount: retryTelemetry.sellAttemptedCount || 0,
      sellRetryBlockedCount: retryTelemetry.sellBlockedCount || 0,
      sellRetryFailedCount: retryTelemetry.sellFailedCount || 0,
      sellRetryRecoveredCount: retryTelemetry.sellRecoveredCount || 0,
      skippedVolumeUsdc: skippedVolumeCounters.totalUsdc || 0,
      warningCount: warnings.length,
      lastProcessedBlockNumber: state.lastProcessedBlockNumber || null,
      lastProcessedLogIndex: state.lastProcessedLogIndex || null,
      lastObservedTradeId: lastObservedTrade ? lastObservedTrade.tradeId : null,
      lastObservedTradeConfirmedAt: lastObservedTrade ? lastObservedTrade.confirmedAt : null,
      lastObservedTradeObservedAt: lastObservedTrade ? lastObservedTrade.observedAt : null,
      lastTradeObservationLatencyMs: lastObservedTrade ? lastObservedTrade.observationLatencyMs : null,
      lastHedgeSignalAt: lastHedgeSignal ? lastHedgeSignal.signalAt : null,
      lastHedgeSignalStatus: lastHedgeSignal ? lastHedgeSignal.status : null,
      lastHedgeReactionLatencyMs: lastHedgeSignal ? lastHedgeSignal.reactionLatencyMs : null,
      lastHedgeObserveToSignalLatencyMs: lastHedgeSignal ? lastHedgeSignal.observeToSignalLatencyMs : null,
      lastSuccessfulHedgeAt: state.lastSuccessfulHedge && state.lastSuccessfulHedge.executedAt ? state.lastSuccessfulHedge.executedAt : null,
      lastErrorCode: state.lastError && state.lastError.code ? state.lastError.code : null,
      lastAlertCode: state.lastAlert && state.lastAlert.code ? state.lastAlert.code : null,
    },
    state: {
      ...state,
      marketPairIdentity,
      managedPolymarketInventorySnapshot: inventory,
      targetHedgeInventory: targetInventory,
      skippedVolumeCounters,
      lastObservedTrade,
      lastHedgeSignal,
    },
    plan,
    diagnostics,
    warnings,
    lastObservedTrade,
    lastHedgeSignal,
    bundleFacing: {
      marketPairIdentity,
      whitelistFingerprint: normalizeOptionalString(params.whitelistFingerprint || state.whitelistFingerprint),
      confirmedExposureLedger,
      pendingMempoolOverlays,
      deferredHedgeQueue,
      managedPolymarketInventorySnapshot: inventory,
      targetHedgeInventory: targetInventory,
      retryTelemetry,
      skippedVolumeCounters,
      lastObservedTrade,
      lastHedgeSignal,
      lastProcessedBlockCursor: state.lastProcessedBlockCursor || null,
      lastProcessedLogCursor: state.lastProcessedLogCursor || null,
      lastSuccessfulHedge: state.lastSuccessfulHedge || null,
      lastError: state.lastError || null,
      lastAlert: state.lastAlert || null,
    },
  };
}

function buildHedgeStatusPayload(params = {}) {
  const state = params.state && typeof params.state === 'object' ? params.state : {};
  const plan = params.plan && typeof params.plan === 'object' ? params.plan : null;
  const bundleFacing = buildBundleFacingHedgePayload(params);
  return {
    schemaVersion: MIRROR_HEDGE_STATUS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    stateFile: params.stateFile || null,
    strategyHash: params.strategyHash || state.strategyHash || null,
    marketPairIdentity: bundleFacing.marketPairIdentity,
    whitelistFingerprint: bundleFacing.whitelistFingerprint,
    runtime: {
      status: bundleFacing.runtimeStatus,
      startedAt: state.startedAt || null,
      stoppedAt: state.stoppedAt || null,
      stoppedReason: state.stoppedReason || null,
      exitCode: state.exitCode === null || state.exitCode === undefined ? null : state.exitCode,
      exitAt: state.exitAt || null,
      updatedAt: state.updatedAt || null,
      lastTickAt: state.lastTickAt || null,
      lastPlanAt: state.lastPlanAt || null,
      lastRunAt: state.lastRunAt || null,
      lastStatusAt: state.lastStatusAt || null,
      iterationsRequested: state.iterationsRequested === null || state.iterationsRequested === undefined ? null : state.iterationsRequested,
      iterationsCompleted: state.iterationsCompleted === null || state.iterationsCompleted === undefined ? 0 : state.iterationsCompleted,
      lastProcessedBlockCursor: state.lastProcessedBlockCursor || null,
      lastProcessedLogCursor: state.lastProcessedLogCursor || null,
    },
    summary: bundleFacing.summary,
    diagnostics: Array.isArray(bundleFacing.diagnostics) ? bundleFacing.diagnostics : [],
    readiness: {
      ready: Boolean(plan && plan.summary && plan.summary.ready),
      missing: plan && plan.summary && Array.isArray(plan.summary.readyMissing) ? plan.summary.readyMissing : [],
      recommendedActions: plan && Array.isArray(plan.recommendedActions) ? plan.recommendedActions : [],
    },
    warnings: Array.isArray(bundleFacing.warnings) ? bundleFacing.warnings : [],
    lastObservedTrade: bundleFacing.lastObservedTrade,
    lastHedgeSignal: bundleFacing.lastHedgeSignal,
    lastSuccessfulHedge: state.lastSuccessfulHedge || null,
    lastError: state.lastError || null,
    lastAlert: state.lastAlert || null,
    plan,
    bundleFacing: bundleFacing.bundleFacing,
    state: bundleFacing.state,
  };
}

function renderHedgeStatusTable(payload) {
  const summary = payload && payload.summary ? payload.summary : {};
  const readiness = payload && payload.readiness ? payload.readiness : {};
  const runtime = payload && payload.runtime ? payload.runtime : {};
  const rows = [
    ['strategyHash', payload && payload.strategyHash ? payload.strategyHash : ''],
    ['runtimeStatus', runtime.status || ''],
    ['startedAt', runtime.startedAt || ''],
    ['lastTickAt', runtime.lastTickAt || ''],
    ['iterationsRequested', runtime.iterationsRequested === null || runtime.iterationsRequested === undefined ? '' : runtime.iterationsRequested],
    ['iterationsCompleted', runtime.iterationsCompleted === null || runtime.iterationsCompleted === undefined ? '' : runtime.iterationsCompleted],
    ['ready', readiness.ready ? 'yes' : 'no'],
    ['missing', Array.isArray(readiness.missing) ? readiness.missing.join(', ') : ''],
    ['marketPairId', payload && payload.marketPairIdentity ? payload.marketPairIdentity.marketPairId || '' : ''],
    ['whitelistFingerprint', payload && payload.whitelistFingerprint ? payload.whitelistFingerprint : ''],
    ['confirmedExposureCount', summary.confirmedExposureCount],
    ['confirmedExposureUsdc', summary.confirmedExposureUsdc],
    ['pendingOverlayCount', summary.pendingOverlayCount],
    ['pendingOverlayUsdc', summary.pendingOverlayUsdc],
    ['deferredHedgeCount', summary.deferredHedgeCount],
    ['deferredHedgeUsdc', summary.deferredHedgeUsdc],
    ['deferredHedgeOldestAgeMs', summary.deferredHedgeOldestAgeMs === null || summary.deferredHedgeOldestAgeMs === undefined ? '' : summary.deferredHedgeOldestAgeMs],
    ['deferredHedgeInvalidCount', summary.deferredHedgeInvalidCount],
    ['deferredHedgeRecoveredCount', summary.deferredHedgeRecoveredCount],
    ['deferredHedgeLastBlockedReasonCode', summary.deferredHedgeLastBlockedReasonCode || ''],
    ['deferredHedgeLastBlockedReason', summary.deferredHedgeLastBlockedReason || ''],
    ['deferredHedgeLastFailureCode', summary.deferredHedgeLastFailureCode || ''],
    ['deferredHedgeLastFailureMessage', summary.deferredHedgeLastFailureMessage || ''],
    ['deferredHedgeLastRecoveryAt', summary.deferredHedgeLastRecoveryAt || ''],
    ['queueStatusMessage', summary.queueStatusMessage || ''],
    ['inventoryStatus', summary.inventoryStatus || ''],
    ['targetYesShares', summary.targetYesShares],
    ['targetNoShares', summary.targetNoShares],
    ['currentYesShares', summary.currentYesShares],
    ['currentNoShares', summary.currentNoShares],
    ['excessYesToSell', summary.excessYesToSell],
    ['excessNoToSell', summary.excessNoToSell],
    ['deficitYesToBuy', summary.deficitYesToBuy],
    ['deficitNoToBuy', summary.deficitNoToBuy],
    ['netTargetSide', summary.netTargetSide || ''],
    ['netTargetShares', summary.netTargetShares],
    ['availableHedgeFeeBudgetUsdc', summary.availableHedgeFeeBudgetUsdc],
    ['belowThresholdPendingUsdc', summary.belowThresholdPendingUsdc],
    ['sellRetryAttemptedCount', summary.sellRetryAttemptedCount],
    ['sellRetryBlockedCount', summary.sellRetryBlockedCount],
    ['sellRetryFailedCount', summary.sellRetryFailedCount],
    ['sellRetryRecoveredCount', summary.sellRetryRecoveredCount],
    ['warningCount', summary.warningCount],
    ['lastProcessedBlockNumber', summary.lastProcessedBlockNumber],
    ['lastProcessedLogIndex', summary.lastProcessedLogIndex],
    ['lastObservedTradeId', summary.lastObservedTradeId || ''],
    ['lastObservedTradeConfirmedAt', summary.lastObservedTradeConfirmedAt || ''],
    ['lastObservedTradeObservedAt', summary.lastObservedTradeObservedAt || ''],
    ['lastTradeObservationLatencyMs', summary.lastTradeObservationLatencyMs === null || summary.lastTradeObservationLatencyMs === undefined ? '' : summary.lastTradeObservationLatencyMs],
    ['lastHedgeSignalAt', summary.lastHedgeSignalAt || ''],
    ['lastHedgeSignalStatus', summary.lastHedgeSignalStatus || ''],
    ['lastHedgeReactionLatencyMs', summary.lastHedgeReactionLatencyMs === null || summary.lastHedgeReactionLatencyMs === undefined ? '' : summary.lastHedgeReactionLatencyMs],
    ['lastHedgeObserveToSignalLatencyMs', summary.lastHedgeObserveToSignalLatencyMs === null || summary.lastHedgeObserveToSignalLatencyMs === undefined ? '' : summary.lastHedgeObserveToSignalLatencyMs],
    ['lastSuccessfulHedgeAt', summary.lastSuccessfulHedgeAt || ''],
    ['lastErrorCode', summary.lastErrorCode || ''],
    ['lastAlertCode', summary.lastAlertCode || ''],
    ['stoppedReason', runtime.stoppedReason || ''],
    ['exitCode', runtime.exitCode === null || runtime.exitCode === undefined ? '' : runtime.exitCode],
    ['exitAt', runtime.exitAt || ''],
    ['diagnostics', Array.isArray(payload.diagnostics) ? payload.diagnostics.join(' | ') : ''],
  ];
  console.log('Mirror Hedge Runtime');
  for (const [label, value] of rows) {
    console.log(`${label}: ${value === null || value === undefined ? '' : value}`);
  }
  if (Array.isArray(readiness.recommendedActions) && readiness.recommendedActions.length) {
    console.log('recommendedActions:');
    for (const action of readiness.recommendedActions) {
      console.log(`- ${action}`);
    }
  }
  if (Array.isArray(payload.warnings) && payload.warnings.length) {
    console.log('warnings:');
    for (const warning of payload.warnings) {
      const code = warning && warning.code ? `[${warning.code}] ` : '';
      console.log(`- ${code}${warning && warning.message ? warning.message : JSON.stringify(warning)}`);
    }
  }
}

module.exports = {
  MIRROR_HEDGE_STATUS_SCHEMA_VERSION,
  buildBundleFacingHedgePayload,
  buildHedgeStatusPayload,
  renderHedgeStatusTable,
};
