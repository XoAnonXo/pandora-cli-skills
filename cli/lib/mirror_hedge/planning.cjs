const { round } = require('../shared/utils.cjs');
const {
  buildIdentityFingerprint,
  ensureConfirmedExposureLedgerEntryShape,
  ensureCursorShape,
  ensureDeferredHedgeQueueEntryShape,
  ensureManagedInventorySnapshotShape,
  ensureMarketPairIdentityShape,
  ensurePendingMempoolOverlayShape,
  ensureSkippedVolumeCountersShape,
  ensureTargetHedgeInventoryShape,
  ensureOutcomeShape,
} = require('../mirror_hedge_state_store.cjs');

const MIRROR_HEDGE_PLANNING_SCHEMA_VERSION = '1.0.0';

function normalizeOptionalString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function toFiniteNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function pickArray(value, fallback) {
  return value !== undefined ? value : fallback;
}

function buildStateKey(state = {}) {
  const identity = ensureMarketPairIdentityShape(state.marketPairIdentity || state);
  return identity.fingerprint || buildIdentityFingerprint(identity, state.whitelistFingerprint);
}

function sumField(entries, fieldName) {
  return round(
    asArray(entries).reduce((total, entry) => {
      const numeric = toFiniteNumberOrNull(entry && entry[fieldName]);
      return total + (numeric === null ? 0 : numeric);
    }, 0),
  ) || 0;
}

function isHedgeDrivingConfirmedExposure(entry) {
  return normalizeOptionalString(entry && entry.reason) !== 'internal-wallet';
}

function summarizeReasons(collection) {
  return asArray(collection).reduce((acc, entry) => {
    const reason = normalizeOptionalString(entry && entry.reason) || 'unspecified';
    const amount = toFiniteNumberOrNull(entry && entry.amountUsdc) || 0;
    acc[reason] = round((acc[reason] || 0) + amount) || 0;
    return acc;
  }, {});
}

function mergeCounters(base = {}, patch = {}) {
  const next = ensureSkippedVolumeCountersShape(base);
  const candidate = ensureSkippedVolumeCountersShape(patch);
  next.totalUsdc = round((next.totalUsdc || 0) + (candidate.totalUsdc || 0)) || 0;
  next.yesUsdc = round((next.yesUsdc || 0) + (candidate.yesUsdc || 0)) || 0;
  next.noUsdc = round((next.noUsdc || 0) + (candidate.noUsdc || 0)) || 0;
  next.count = Number(next.count || 0) + Number(candidate.count || 0);
  next.byReason = {
    ...next.byReason,
    ...Object.fromEntries(
      Object.entries(candidate.byReason).map(([key, value]) => [key, round((next.byReason[key] || 0) + value) || 0]),
    ),
  };
  next.bySide = {
    ...next.bySide,
    ...Object.fromEntries(
      Object.entries(candidate.bySide).map(([key, value]) => [key, round((next.bySide[key] || 0) + value) || 0]),
    ),
  };
  return next;
}

function upsertByKey(collection, keyName, nextEntry) {
  const items = asArray(collection).slice();
  const keyValue = nextEntry && nextEntry[keyName] ? String(nextEntry[keyName]) : null;
  if (!keyValue) {
    items.push(nextEntry);
    return items;
  }
  const index = items.findIndex((entry) => entry && String(entry[keyName] || '') === keyValue);
  if (index >= 0) {
    items[index] = {
      ...items[index],
      ...nextEntry,
    };
  } else {
    items.push(nextEntry);
  }
  return items;
}

function planHedgeRuntime(options = {}) {
  const state = options.state && typeof options.state === 'object' ? options.state : {};
  const now = options.now instanceof Date ? options.now : new Date();
  const generatedAt = toIsoString(now) || new Date().toISOString();
  const marketPairIdentity = ensureMarketPairIdentityShape(
    options.marketPairIdentity || state.marketPairIdentity || state,
  );
  const whitelistFingerprint = normalizeOptionalString(options.whitelistFingerprint || state.whitelistFingerprint);
  const lastProcessedBlockCursor = ensureCursorShape(
    options.lastProcessedBlockCursor || state.lastProcessedBlockCursor || {
      blockNumber: state.lastProcessedBlockNumber,
      blockHash: state.lastProcessedBlockHash,
      cursor: state.lastProcessedBlockCursorValue,
      source: state.lastProcessedBlockSource,
      observedAt: state.lastProcessedBlockObservedAt,
    },
  );
  const lastProcessedLogCursor = ensureCursorShape(
    options.lastProcessedLogCursor || state.lastProcessedLogCursor || {
      blockNumber: state.lastProcessedLogBlockNumber,
      logIndex: state.lastProcessedLogIndex,
      transactionHash: state.lastProcessedLogTransactionHash,
      blockHash: state.lastProcessedLogBlockHash,
      cursor: state.lastProcessedLogCursorValue,
      source: state.lastProcessedLogSource,
      observedAt: state.lastProcessedLogObservedAt,
    },
  );
  const confirmedExposureLedger = asArray(pickArray(options.confirmedExposureLedger, state.confirmedExposureLedger))
    .map(ensureConfirmedExposureLedgerEntryShape)
    .filter((entry) => Boolean(entry.id || entry.cursor || entry.transactionHash));
  const hedgeDrivingConfirmedExposureLedger = confirmedExposureLedger.filter(isHedgeDrivingConfirmedExposure);
  const pendingMempoolOverlays = asArray(pickArray(options.pendingMempoolOverlays, state.pendingMempoolOverlays))
    .map(ensurePendingMempoolOverlayShape)
    .filter((entry) => Boolean(entry.txHash || entry.cursor || entry.transactionHash));
  const deferredHedgeQueue = asArray(pickArray(options.deferredHedgeQueue, state.deferredHedgeQueue))
    .map(ensureDeferredHedgeQueueEntryShape)
    .filter((entry) => Boolean(entry.id));
  const managedInventorySource = pickArray(options.managedPolymarketInventorySnapshot, state.managedPolymarketInventorySnapshot);
  const managedPolymarketInventorySnapshot = managedInventorySource !== undefined && managedInventorySource !== null
    ? ensureManagedInventorySnapshotShape(managedInventorySource)
    : null;
  const targetHedgeInventory = ensureTargetHedgeInventoryShape(
    pickArray(options.targetHedgeInventory, state.targetHedgeInventory),
  );
  const skippedVolumeCounters = mergeCounters(
    state.skippedVolumeCounters,
    pickArray(options.skippedVolumeCounters, {}),
  );
  const stateKey = buildStateKey({
    marketPairIdentity,
    whitelistFingerprint,
  });

  const confirmedExposureUsdc = round(sumField(hedgeDrivingConfirmedExposureLedger, 'amountUsdc')) || 0;
  const confirmedDeltaUsdc = round(sumField(hedgeDrivingConfirmedExposureLedger, 'deltaUsdc')) || 0;
  const pendingOverlayUsdc = round(sumField(pendingMempoolOverlays, 'amountUsdc')) || 0;
  const pendingDeltaUsdc = round(sumField(pendingMempoolOverlays, 'expectedHedgeDeltaUsdc')) || 0;
  const deferredUsdc = round(sumField(deferredHedgeQueue, 'amountUsdc')) || 0;
  const inventoryNetUsdc =
    managedPolymarketInventorySnapshot && Number.isFinite(Number(managedPolymarketInventorySnapshot.netUsdc))
      ? Number(managedPolymarketInventorySnapshot.netUsdc)
      : null;
  const currentYesShares =
    managedPolymarketInventorySnapshot && Number.isFinite(Number(managedPolymarketInventorySnapshot.yesShares))
      ? Number(managedPolymarketInventorySnapshot.yesShares)
      : 0;
  const currentNoShares =
    managedPolymarketInventorySnapshot && Number.isFinite(Number(managedPolymarketInventorySnapshot.noShares))
      ? Number(managedPolymarketInventorySnapshot.noShares)
      : 0;
  const targetYesShares = Number(targetHedgeInventory.yesShares || 0);
  const targetNoShares = Number(targetHedgeInventory.noShares || 0);
  const excessYesToSell = round(Math.max(0, currentYesShares - targetYesShares)) || 0;
  const excessNoToSell = round(Math.max(0, currentNoShares - targetNoShares)) || 0;
  const deficitYesToBuy = round(Math.max(0, targetYesShares - currentYesShares)) || 0;
  const deficitNoToBuy = round(Math.max(0, targetNoShares - currentNoShares)) || 0;
  const readyMissing = [];
  if (!marketPairIdentity.marketPairId && !marketPairIdentity.pandoraMarketAddress && !marketPairIdentity.polymarketMarketId && !marketPairIdentity.polymarketSlug) {
    readyMissing.push('market-pair-identity');
  }
  if (!whitelistFingerprint) {
    readyMissing.push('whitelist-fingerprint');
  }
  if (!lastProcessedBlockCursor && !lastProcessedLogCursor) {
    readyMissing.push('cursor');
  }

  const recommendedActions = [];
  if (!whitelistFingerprint) recommendedActions.push('capture-whitelist-fingerprint');
  if (!lastProcessedBlockCursor) recommendedActions.push('seed-last-processed-block-cursor');
  if (!lastProcessedLogCursor) recommendedActions.push('seed-last-processed-log-cursor');
  if (!managedPolymarketInventorySnapshot) recommendedActions.push('capture-managed-polymarket-inventory');
  if (pendingMempoolOverlays.length) recommendedActions.push('review-pending-mempool-overlays');
  if (deferredHedgeQueue.length) recommendedActions.push('drain-deferred-hedge-queue');
  if (skippedVolumeCounters.totalUsdc > 0) recommendedActions.push('inspect-skipped-volume-counters');

  const summary = {
    marketPairId: marketPairIdentity.marketPairId,
    marketPairFingerprint: marketPairIdentity.fingerprint,
    whitelistFingerprint,
    runtimeStatus: normalizeOptionalString(state.runtimeStatus) || 'idle',
    confirmedExposureCount: hedgeDrivingConfirmedExposureLedger.length,
    confirmedExposureUsdc,
    confirmedDeltaUsdc,
    pendingOverlayCount: pendingMempoolOverlays.length,
    pendingOverlayUsdc,
    pendingDeltaUsdc,
    deferredHedgeCount: deferredHedgeQueue.length,
    deferredHedgeUsdc: deferredUsdc,
    inventoryNetUsdc,
    targetYesShares,
    targetNoShares,
    currentYesShares,
    currentNoShares,
    excessYesToSell,
    excessNoToSell,
    deficitYesToBuy,
    deficitNoToBuy,
    netTargetSide: targetHedgeInventory.netSide,
    netTargetShares: targetHedgeInventory.netShares,
    availableHedgeFeeBudgetUsdc: toFiniteNumberOrNull(
      pickArray(options.availableHedgeFeeBudgetUsdc, state.availableHedgeFeeBudgetUsdc),
    ) || 0,
    belowThresholdPendingUsdc: toFiniteNumberOrNull(
      pickArray(options.belowThresholdPendingUsdc, state.belowThresholdPendingUsdc),
    ) || 0,
    skippedVolumeUsdc: skippedVolumeCounters.totalUsdc,
    skippedVolumeCount: skippedVolumeCounters.count,
    ready: readyMissing.length === 0,
    readyMissing,
  };

  return {
    schemaVersion: MIRROR_HEDGE_PLANNING_SCHEMA_VERSION,
    generatedAt,
    stateKey,
    marketPairIdentity,
    whitelistFingerprint,
    lastProcessedBlockCursor,
    lastProcessedLogCursor,
    confirmedExposureLedger,
    pendingMempoolOverlays,
    deferredHedgeQueue,
    managedPolymarketInventorySnapshot,
    targetHedgeInventory,
    skippedVolumeCounters,
    summary,
    recommendedActions,
    lastSuccessfulHedge: state.lastSuccessfulHedge ? cloneJson(state.lastSuccessfulHedge) : null,
    lastError: state.lastError ? cloneJson(state.lastError) : null,
    lastAlert: state.lastAlert ? cloneJson(state.lastAlert) : null,
    lastPlanAt: state.lastPlanAt || null,
    lastRunAt: state.lastRunAt || null,
  };
}

function applyHedgeObservation(state, observation = {}, now = new Date()) {
  const target = state && typeof state === 'object' ? state : {};
  const timestamp = toIsoString(now) || new Date().toISOString();

  if (observation.marketPairIdentity) {
    target.marketPairIdentity = ensureMarketPairIdentityShape({
      ...target.marketPairIdentity,
      ...observation.marketPairIdentity,
    });
    target.marketPairId = target.marketPairIdentity.marketPairId;
    target.pandoraMarketAddress = target.marketPairIdentity.pandoraMarketAddress;
    target.polymarketMarketId = target.marketPairIdentity.polymarketMarketId;
    target.polymarketSlug = target.marketPairIdentity.polymarketSlug;
    target.marketPairIdentityFingerprint = target.marketPairIdentity.fingerprint;
  }

  if (observation.whitelistFingerprint !== undefined) {
    target.whitelistFingerprint = normalizeOptionalString(observation.whitelistFingerprint);
  }

  if (observation.lastProcessedBlockCursor) {
    target.lastProcessedBlockCursor = ensureCursorShape(observation.lastProcessedBlockCursor);
    target.lastProcessedBlockNumber = target.lastProcessedBlockCursor ? target.lastProcessedBlockCursor.blockNumber : null;
    target.lastProcessedBlockHash = target.lastProcessedBlockCursor ? target.lastProcessedBlockCursor.blockHash : null;
    target.lastProcessedBlockCursorValue = target.lastProcessedBlockCursor ? target.lastProcessedBlockCursor.cursor : null;
  }

  if (observation.lastProcessedLogCursor) {
    target.lastProcessedLogCursor = ensureCursorShape(observation.lastProcessedLogCursor);
    target.lastProcessedLogBlockNumber = target.lastProcessedLogCursor ? target.lastProcessedLogCursor.blockNumber : null;
    target.lastProcessedLogIndex = target.lastProcessedLogCursor ? target.lastProcessedLogCursor.logIndex : null;
    target.lastProcessedLogTransactionHash = target.lastProcessedLogCursor ? target.lastProcessedLogCursor.transactionHash : null;
    target.lastProcessedLogBlockHash = target.lastProcessedLogCursor ? target.lastProcessedLogCursor.blockHash : null;
    target.lastProcessedLogCursorValue = target.lastProcessedLogCursor ? target.lastProcessedLogCursor.cursor : null;
  }

  if (Array.isArray(observation.confirmedExposureLedger)) {
    const nextEntries = observation.confirmedExposureLedger
      .map((entry) => ensureConfirmedExposureLedgerEntryShape({
        ...entry,
        updatedAt: entry && entry.updatedAt ? entry.updatedAt : timestamp,
      }))
      .filter((entry) => Boolean(entry.id || entry.cursor || entry.transactionHash));
    target.confirmedExposureLedger = nextEntries.reduce(
      (collection, entry) => upsertByKey(collection, 'id', entry),
      asArray(target.confirmedExposureLedger),
    );
  }

  if (Array.isArray(observation.pendingMempoolOverlays)) {
    const nextEntries = observation.pendingMempoolOverlays
      .map((entry) => ensurePendingMempoolOverlayShape({
        ...entry,
        updatedAt: entry && entry.updatedAt ? entry.updatedAt : timestamp,
      }))
      .filter((entry) => Boolean(entry.txHash || entry.cursor || entry.transactionHash));
    target.pendingMempoolOverlays = nextEntries.reduce(
      (collection, entry) => upsertByKey(collection, 'txHash', entry),
      asArray(target.pendingMempoolOverlays),
    );
  }

  if (Array.isArray(observation.deferredHedgeQueue)) {
    const nextEntries = observation.deferredHedgeQueue
      .map((entry) => ensureDeferredHedgeQueueEntryShape({
        ...entry,
        updatedAt: entry && entry.updatedAt ? entry.updatedAt : timestamp,
      }))
      .filter((entry) => Boolean(entry.id));
    target.deferredHedgeQueue = nextEntries.reduce(
      (collection, entry) => upsertByKey(collection, 'id', entry),
      asArray(target.deferredHedgeQueue),
    );
  }

  if (observation.managedPolymarketInventorySnapshot !== undefined) {
    target.managedPolymarketInventorySnapshot = observation.managedPolymarketInventorySnapshot
      ? ensureManagedInventorySnapshotShape(observation.managedPolymarketInventorySnapshot)
      : null;
  }

  if (observation.targetHedgeInventory !== undefined) {
    target.targetHedgeInventory = observation.targetHedgeInventory
      ? ensureTargetHedgeInventoryShape(observation.targetHedgeInventory)
      : ensureTargetHedgeInventoryShape({});
  }

  if (observation.availableHedgeFeeBudgetUsdc !== undefined) {
    target.availableHedgeFeeBudgetUsdc = toFiniteNumberOrNull(observation.availableHedgeFeeBudgetUsdc) || 0;
  }

  if (observation.belowThresholdPendingUsdc !== undefined) {
    target.belowThresholdPendingUsdc = toFiniteNumberOrNull(observation.belowThresholdPendingUsdc) || 0;
  }

  if (observation.skippedVolumeCounters) {
    target.skippedVolumeCounters = mergeCounters(target.skippedVolumeCounters, observation.skippedVolumeCounters);
  }

  if (observation.lastSuccessfulHedge !== undefined) {
    target.lastSuccessfulHedge = observation.lastSuccessfulHedge
      ? {
          ...target.lastSuccessfulHedge,
          ...ensureOutcomeShape(observation.lastSuccessfulHedge),
          executedAt: normalizeOptionalString(observation.lastSuccessfulHedge.executedAt || observation.lastSuccessfulHedge.at) || timestamp,
        }
      : null;
  }

  if (observation.lastError !== undefined) {
    target.lastError = observation.lastError
      ? {
          ...target.lastError,
          ...observation.lastError,
          at: normalizeOptionalString(observation.lastError.at || observation.lastError.timestamp) || timestamp,
        }
      : null;
    if (target.lastError) {
      target.runtimeStatus = 'errored';
    }
  }

  if (observation.lastAlert !== undefined) {
    target.lastAlert = observation.lastAlert
      ? {
          ...target.lastAlert,
          ...observation.lastAlert,
          at: normalizeOptionalString(observation.lastAlert.at || observation.lastAlert.timestamp) || timestamp,
        }
      : null;
  }

  target.lastRunAt = timestamp;
  target.updatedAt = timestamp;
  if (!target.startedAt) {
    target.startedAt = timestamp;
  }
  return target;
}

function buildHedgePlanContext(state, options = {}) {
  return planHedgeRuntime({
    state,
    now: options.now,
    marketPairIdentity: options.marketPairIdentity,
    whitelistFingerprint: options.whitelistFingerprint,
    lastProcessedBlockCursor: options.lastProcessedBlockCursor,
    lastProcessedLogCursor: options.lastProcessedLogCursor,
    confirmedExposureLedger: options.confirmedExposureLedger,
    pendingMempoolOverlays: options.pendingMempoolOverlays,
    deferredHedgeQueue: options.deferredHedgeQueue,
    managedPolymarketInventorySnapshot: options.managedPolymarketInventorySnapshot,
    targetHedgeInventory: options.targetHedgeInventory,
    availableHedgeFeeBudgetUsdc: options.availableHedgeFeeBudgetUsdc,
    belowThresholdPendingUsdc: options.belowThresholdPendingUsdc,
    skippedVolumeCounters: options.skippedVolumeCounters,
  });
}

module.exports = {
  MIRROR_HEDGE_PLANNING_SCHEMA_VERSION,
  planHedgeRuntime,
  applyHedgeObservation,
  buildHedgePlanContext,
};
