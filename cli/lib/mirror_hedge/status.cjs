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

function normalizeOptionalString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function toFiniteNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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
      deferredHedgeCount: deferredHedgeQueue.length,
      deferredHedgeUsdc: sumField(deferredHedgeQueue, 'amountUsdc'),
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
      warningCount: plan && Array.isArray(plan.warnings) ? plan.warnings.length : 0,
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
    readiness: {
      ready: Boolean(plan && plan.summary && plan.summary.ready),
      missing: plan && plan.summary && Array.isArray(plan.summary.readyMissing) ? plan.summary.readyMissing : [],
      recommendedActions: plan && Array.isArray(plan.recommendedActions) ? plan.recommendedActions : [],
    },
    warnings: plan && Array.isArray(plan.warnings) ? plan.warnings : [],
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
