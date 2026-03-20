const { round } = require('../shared/utils.cjs');
const { ensureMarketPairIdentityShape, ensureManagedInventorySnapshotShape, ensureSkippedVolumeCountersShape } = require('../mirror_hedge_state_store.cjs');

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

function buildBundleFacingHedgePayload(params = {}) {
  const state = params.state && typeof params.state === 'object' ? params.state : {};
  const plan = params.plan && typeof params.plan === 'object' ? params.plan : null;
  const marketPairIdentity = ensureMarketPairIdentityShape(params.marketPairIdentity || state.marketPairIdentity || state);
  const inventory = params.managedPolymarketInventorySnapshot !== undefined
    ? ensureManagedInventorySnapshotShape(params.managedPolymarketInventorySnapshot)
    : state.managedPolymarketInventorySnapshot
      ? ensureManagedInventorySnapshotShape(state.managedPolymarketInventorySnapshot)
      : null;
  const skippedVolumeCounters = ensureSkippedVolumeCountersShape(params.skippedVolumeCounters || state.skippedVolumeCounters || {});
  const confirmedExposureLedger = Array.isArray(params.confirmedExposureLedger || state.confirmedExposureLedger)
    ? params.confirmedExposureLedger || state.confirmedExposureLedger
    : [];
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
      confirmedExposureCount: confirmedExposureLedger.length,
      confirmedExposureUsdc: sumField(confirmedExposureLedger, 'amountUsdc'),
      pendingOverlayCount: pendingMempoolOverlays.length,
      pendingOverlayUsdc: sumField(pendingMempoolOverlays, 'amountUsdc'),
      deferredHedgeCount: deferredHedgeQueue.length,
      deferredHedgeUsdc: sumField(deferredHedgeQueue, 'amountUsdc'),
      inventoryStatus: inventory ? inventory.status : null,
      skippedVolumeUsdc: skippedVolumeCounters.totalUsdc || 0,
      lastProcessedBlockNumber: state.lastProcessedBlockNumber || null,
      lastProcessedLogIndex: state.lastProcessedLogIndex || null,
      lastSuccessfulHedgeAt: state.lastSuccessfulHedge && state.lastSuccessfulHedge.executedAt ? state.lastSuccessfulHedge.executedAt : null,
      lastErrorCode: state.lastError && state.lastError.code ? state.lastError.code : null,
      lastAlertCode: state.lastAlert && state.lastAlert.code ? state.lastAlert.code : null,
    },
    state: {
      ...state,
      marketPairIdentity,
      managedPolymarketInventorySnapshot: inventory,
      skippedVolumeCounters,
    },
    plan,
    bundleFacing: {
      marketPairIdentity,
      whitelistFingerprint: normalizeOptionalString(params.whitelistFingerprint || state.whitelistFingerprint),
      confirmedExposureLedger,
      pendingMempoolOverlays,
      deferredHedgeQueue,
      managedPolymarketInventorySnapshot: inventory,
      skippedVolumeCounters,
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
      updatedAt: state.updatedAt || null,
      lastPlanAt: state.lastPlanAt || null,
      lastRunAt: state.lastRunAt || null,
      lastStatusAt: state.lastStatusAt || null,
      lastProcessedBlockCursor: state.lastProcessedBlockCursor || null,
      lastProcessedLogCursor: state.lastProcessedLogCursor || null,
    },
    summary: bundleFacing.summary,
    readiness: {
      ready: Boolean(plan && plan.summary && plan.summary.ready),
      missing: plan && plan.summary && Array.isArray(plan.summary.readyMissing) ? plan.summary.readyMissing : [],
      recommendedActions: plan && Array.isArray(plan.recommendedActions) ? plan.recommendedActions : [],
    },
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
    ['lastProcessedBlockNumber', summary.lastProcessedBlockNumber],
    ['lastProcessedLogIndex', summary.lastProcessedLogIndex],
    ['lastSuccessfulHedgeAt', summary.lastSuccessfulHedgeAt || ''],
    ['lastErrorCode', summary.lastErrorCode || ''],
    ['lastAlertCode', summary.lastAlertCode || ''],
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
}

module.exports = {
  MIRROR_HEDGE_STATUS_SCHEMA_VERSION,
  buildBundleFacingHedgePayload,
  buildHedgeStatusPayload,
  renderHedgeStatusTable,
};
