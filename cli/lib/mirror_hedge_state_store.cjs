const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { expandHome } = require('./mirror_state_store.cjs');

const MIRROR_HEDGE_STATE_SCHEMA_VERSION = '1.0.0';
const MIRROR_HEDGE_RUNTIME_TYPE = 'lp-hedge';

function resolveHomeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || '.';
}

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

function buildIdentityFingerprint(identity = {}, whitelistFingerprint = null) {
  const payload = JSON.stringify({
    pandoraMarketAddress: normalizeOptionalString(identity.pandoraMarketAddress),
    polymarketMarketId: normalizeOptionalString(identity.polymarketMarketId),
    polymarketSlug: normalizeOptionalString(identity.polymarketSlug),
    marketPairId: normalizeOptionalString(identity.marketPairId),
    whitelistFingerprint: normalizeOptionalString(whitelistFingerprint),
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function defaultStateFile(params = {}) {
  const fingerprint = normalizeOptionalString(params.runtimeHash)
    || normalizeOptionalString(params.strategyHash)
    || buildIdentityFingerprint(params.marketPairIdentity || params, params.whitelistFingerprint);
  return path.join(resolveHomeDir(), '.pandora', 'mirror', 'hedge', `${fingerprint}.json`);
}

function defaultKillSwitchFile() {
  return path.join(resolveHomeDir(), '.pandora', 'mirror', 'hedge', 'STOP');
}

function ensureMarketPairIdentityShape(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const pandoraMarketAddress = normalizeOptionalString(data.pandoraMarketAddress);
  const polymarketMarketId = normalizeOptionalString(data.polymarketMarketId);
  const polymarketSlug = normalizeOptionalString(data.polymarketSlug);
  const marketPairId =
    normalizeOptionalString(data.marketPairId)
    || [
      pandoraMarketAddress || '',
      polymarketMarketId || '',
      polymarketSlug || '',
    ].filter(Boolean).join('|')
    || null;
  return {
    pandoraMarketAddress,
    polymarketMarketId,
    polymarketSlug,
    marketPairId,
    source: normalizeOptionalString(data.source),
    description: normalizeOptionalString(data.description),
    fingerprint: normalizeOptionalString(data.fingerprint) || buildIdentityFingerprint({
      pandoraMarketAddress,
      polymarketMarketId,
      polymarketSlug,
      marketPairId,
    }, data.whitelistFingerprint),
  };
}

function ensureCursorShape(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const blockNumber = toFiniteNumberOrNull(data.blockNumber);
  const logIndex = toFiniteNumberOrNull(data.logIndex);
  const cursor = normalizeOptionalString(data.cursor);
  const transactionHash = normalizeOptionalString(data.transactionHash);
  const blockHash = normalizeOptionalString(data.blockHash);
  const source = normalizeOptionalString(data.source);
  const observedAt = normalizeOptionalString(data.observedAt || data.updatedAt || data.createdAt);
  if (
    blockNumber === null
    && logIndex === null
    && !cursor
    && !transactionHash
    && !blockHash
  ) {
    return null;
  }
  return {
    blockNumber,
    logIndex,
    cursor,
    transactionHash,
    blockHash,
    source,
    observedAt,
  };
}

function ensureConfirmedExposureLedgerEntryShape(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    id: normalizeOptionalString(data.id),
    status: normalizeOptionalString(data.status) || 'confirmed',
    marketPairId: normalizeOptionalString(data.marketPairId),
    pandoraMarketAddress: normalizeOptionalString(data.pandoraMarketAddress),
    polymarketMarketId: normalizeOptionalString(data.polymarketMarketId),
    polymarketSlug: normalizeOptionalString(data.polymarketSlug),
    side: normalizeOptionalString(data.side),
    tokenSide: normalizeOptionalString(data.tokenSide),
    orderSide: normalizeOptionalString(data.orderSide),
    amountUsdc: toFiniteNumberOrNull(data.amountUsdc),
    amountShares: toFiniteNumberOrNull(data.amountShares),
    deltaUsdc: toFiniteNumberOrNull(data.deltaUsdc),
    exposureUsdc: toFiniteNumberOrNull(data.exposureUsdc),
    yesTargetDeltaShares: toFiniteNumberOrNull(data.yesTargetDeltaShares),
    noTargetDeltaShares: toFiniteNumberOrNull(data.noTargetDeltaShares),
    expectedRevenueUsdc: toFiniteNumberOrNull(data.expectedRevenueUsdc),
    blockNumber: toFiniteNumberOrNull(data.blockNumber),
    logIndex: toFiniteNumberOrNull(data.logIndex),
    cursor: normalizeOptionalString(data.cursor),
    transactionHash: normalizeOptionalString(data.transactionHash),
    source: normalizeOptionalString(data.source),
    reason: normalizeOptionalString(data.reason),
    notes: normalizeOptionalString(data.notes),
    targetBefore: data.targetBefore ? ensureTargetHedgeInventoryShape(data.targetBefore) : null,
    targetAfter: data.targetAfter ? ensureTargetHedgeInventoryShape(data.targetAfter) : null,
    createdAt: normalizeOptionalString(data.createdAt),
    updatedAt: normalizeOptionalString(data.updatedAt),
    confirmedAt: normalizeOptionalString(data.confirmedAt),
  };
}

function ensurePendingMempoolOverlayShape(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    txHash: normalizeOptionalString(data.txHash),
    status: normalizeOptionalString(data.status) || 'seen',
    marketPairId: normalizeOptionalString(data.marketPairId),
    pandoraMarketAddress: normalizeOptionalString(data.pandoraMarketAddress),
    polymarketMarketId: normalizeOptionalString(data.polymarketMarketId),
    polymarketSlug: normalizeOptionalString(data.polymarketSlug),
    side: normalizeOptionalString(data.side),
    tokenSide: normalizeOptionalString(data.tokenSide),
    orderSide: normalizeOptionalString(data.orderSide),
    nonce: toFiniteNumberOrNull(data.nonce),
    amountUsdc: toFiniteNumberOrNull(data.amountUsdc),
    expectedHedgeDeltaUsdc: toFiniteNumberOrNull(data.expectedHedgeDeltaUsdc),
    blockNumber: toFiniteNumberOrNull(data.blockNumber),
    logIndex: toFiniteNumberOrNull(data.logIndex),
    cursor: normalizeOptionalString(data.cursor),
    transactionHash: normalizeOptionalString(data.transactionHash),
    source: normalizeOptionalString(data.source),
    reason: normalizeOptionalString(data.reason),
    notes: normalizeOptionalString(data.notes),
    createdAt: normalizeOptionalString(data.createdAt),
    updatedAt: normalizeOptionalString(data.updatedAt),
    expiresAt: normalizeOptionalString(data.expiresAt),
    finalizedAt: normalizeOptionalString(data.finalizedAt),
    finalityReason: normalizeOptionalString(data.finalityReason),
  };
}

function ensureDeferredHedgeQueueEntryShape(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    id: normalizeOptionalString(data.id) || normalizeOptionalString(data.queueId),
    status: normalizeOptionalString(data.status) || 'queued',
    marketPairId: normalizeOptionalString(data.marketPairId),
    side: normalizeOptionalString(data.side),
    tokenSide: normalizeOptionalString(data.tokenSide),
    orderSide: normalizeOptionalString(data.orderSide),
    amountUsdc: toFiniteNumberOrNull(data.amountUsdc),
    amountShares: toFiniteNumberOrNull(data.amountShares),
    targetUsdc: toFiniteNumberOrNull(data.targetUsdc),
    targetShares: toFiniteNumberOrNull(data.targetShares),
    dueAt: normalizeOptionalString(data.dueAt),
    source: normalizeOptionalString(data.source),
    reason: normalizeOptionalString(data.reason),
    notes: normalizeOptionalString(data.notes),
    priority: toFiniteNumberOrNull(data.priority),
    createdAt: normalizeOptionalString(data.createdAt),
    updatedAt: normalizeOptionalString(data.updatedAt),
  };
}

function ensureManagedInventorySnapshotShape(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const yesShares = toFiniteNumberOrNull(data.yesShares);
  const noShares = toFiniteNumberOrNull(data.noShares);
  const yesUsdc = toFiniteNumberOrNull(data.yesUsdc);
  const noUsdc = toFiniteNumberOrNull(data.noUsdc);
  return {
    adoptedAt: normalizeOptionalString(data.adoptedAt),
    status: normalizeOptionalString(data.status) || null,
    source: normalizeOptionalString(data.source) || 'unknown',
    inventoryAddress: normalizeOptionalString(data.inventoryAddress),
    walletAddress: normalizeOptionalString(data.walletAddress),
    marketId: normalizeOptionalString(data.marketId),
    slug: normalizeOptionalString(data.slug),
    yesShares,
    noShares,
    yesUsdc,
    noUsdc,
    netUsdc: toFiniteNumberOrNull(data.netUsdc),
    estimatedValueUsdc: toFiniteNumberOrNull(data.estimatedValueUsdc),
    openOrdersCount: toFiniteNumberOrNull(data.openOrdersCount),
    diagnostics: Array.isArray(data.diagnostics) ? data.diagnostics.map((entry) => String(entry)) : [],
  };
}

function ensureTargetHedgeInventoryShape(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const explicitYesShares = toFiniteNumberOrNull(data.yesShares);
  const explicitNoShares = toFiniteNumberOrNull(data.noShares);
  const explicitNetShares = toFiniteNumberOrNull(data.netShares);
  const explicitNetSide = normalizeOptionalString(data.netSide);

  let yesShares = Math.max(0, explicitYesShares || 0);
  let noShares = Math.max(0, explicitNoShares || 0);

  if (!(yesShares > 0) && !(noShares > 0) && explicitNetShares !== null && explicitNetShares > 0) {
    if (explicitNetSide === 'yes') {
      yesShares = explicitNetShares;
      noShares = 0;
    } else if (explicitNetSide === 'no') {
      yesShares = 0;
      noShares = explicitNetShares;
    }
  }

  const signedNetShares = (yesShares || 0) - (noShares || 0);
  if (signedNetShares > 0) {
    yesShares = signedNetShares;
    noShares = 0;
  } else if (signedNetShares < 0) {
    yesShares = 0;
    noShares = Math.abs(signedNetShares);
  } else {
    yesShares = 0;
    noShares = 0;
  }

  const netSide = yesShares > 0 ? 'yes' : noShares > 0 ? 'no' : null;
  const netShares = yesShares > 0 ? yesShares : noShares > 0 ? noShares : 0;

  return {
    yesShares,
    noShares,
    netSide,
    netShares,
    initializedAt: normalizeOptionalString(data.initializedAt),
    initializedFrom: normalizeOptionalString(data.initializedFrom),
    updatedAt: normalizeOptionalString(data.updatedAt),
  };
}

function ensureSkippedVolumeCountersShape(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const byReason = data.byReason && typeof data.byReason === 'object' ? data.byReason : {};
  const bySide = data.bySide && typeof data.bySide === 'object' ? data.bySide : {};
  return {
    totalUsdc: toFiniteNumberOrNull(data.totalUsdc) || 0,
    yesUsdc: toFiniteNumberOrNull(data.yesUsdc) || 0,
    noUsdc: toFiniteNumberOrNull(data.noUsdc) || 0,
    count: Number.isFinite(Number(data.count)) ? Number(data.count) : 0,
    byReason: Object.entries(byReason).reduce((acc, [key, value]) => {
      const normalizedKey = normalizeOptionalString(key);
      if (!normalizedKey) return acc;
      acc[normalizedKey] = toFiniteNumberOrNull(value) || 0;
      return acc;
    }, {}),
    bySide: Object.entries(bySide).reduce((acc, [key, value]) => {
      const normalizedKey = normalizeOptionalString(key);
      if (!normalizedKey) return acc;
      acc[normalizedKey] = toFiniteNumberOrNull(value) || 0;
      return acc;
    }, {}),
  };
}

function ensureOutcomeShape(raw) {
  const data = raw && typeof raw === 'object' ? raw : null;
  if (!data) return null;
  return {
    hedgeId: normalizeOptionalString(data.hedgeId),
    status: normalizeOptionalString(data.status),
    executedAt: normalizeOptionalString(data.executedAt || data.at),
    amountUsdc: toFiniteNumberOrNull(data.amountUsdc),
    tokenSide: normalizeOptionalString(data.tokenSide),
    orderSide: normalizeOptionalString(data.orderSide),
    txHash: normalizeOptionalString(data.txHash),
    blockNumber: toFiniteNumberOrNull(data.blockNumber),
    logIndex: toFiniteNumberOrNull(data.logIndex),
    source: normalizeOptionalString(data.source),
    reason: normalizeOptionalString(data.reason),
    code: normalizeOptionalString(data.code),
    message: normalizeOptionalString(data.message),
    details: data.details === undefined ? undefined : cloneJson(data.details),
  };
}

function ensureEventShape(raw) {
  const data = raw && typeof raw === 'object' ? raw : null;
  if (!data) return null;
  return {
    code: normalizeOptionalString(data.code),
    message: normalizeOptionalString(data.message),
    severity: normalizeOptionalString(data.severity) || 'info',
    at: normalizeOptionalString(data.at || data.timestamp),
    source: normalizeOptionalString(data.source),
    details: data.details === undefined ? undefined : cloneJson(data.details),
  };
}

function ensureStateShape(raw, hash = null) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const resolvedHash = normalizeOptionalString(hash) || normalizeOptionalString(data.strategyHash) || buildIdentityFingerprint(
    data.marketPairIdentity || data,
    data.whitelistFingerprint,
  );
  const marketPairIdentity = ensureMarketPairIdentityShape(
    data.marketPairIdentity
    || {
      pandoraMarketAddress: data.pandoraMarketAddress,
      polymarketMarketId: data.polymarketMarketId,
      polymarketSlug: data.polymarketSlug,
      marketPairId: data.marketPairId,
      source: data.marketPairSource,
      description: data.marketPairDescription,
      fingerprint: data.marketPairIdentityFingerprint,
      whitelistFingerprint: data.whitelistFingerprint,
    },
  );
  const lastProcessedBlockCursor = ensureCursorShape(
    data.lastProcessedBlockCursor
    || {
      blockNumber: data.lastProcessedBlockNumber,
      blockHash: data.lastProcessedBlockHash,
      cursor: data.lastProcessedBlockCursorValue,
      source: data.lastProcessedBlockSource,
      observedAt: data.lastProcessedBlockObservedAt,
    },
  );
  const lastProcessedLogCursor = ensureCursorShape(
    data.lastProcessedLogCursor
    || {
      blockNumber: data.lastProcessedLogBlockNumber,
      logIndex: data.lastProcessedLogIndex,
      transactionHash: data.lastProcessedLogTransactionHash,
      blockHash: data.lastProcessedLogBlockHash,
      cursor: data.lastProcessedLogCursorValue,
      source: data.lastProcessedLogSource,
      observedAt: data.lastProcessedLogObservedAt,
    },
  );
  const confirmedExposureLedger = Array.isArray(data.confirmedExposureLedger)
    ? data.confirmedExposureLedger.map(ensureConfirmedExposureLedgerEntryShape).filter((entry) => Boolean(entry.id || entry.cursor || entry.transactionHash))
    : [];
  const pendingMempoolOverlays = Array.isArray(data.pendingMempoolOverlays)
    ? data.pendingMempoolOverlays.map(ensurePendingMempoolOverlayShape).filter((entry) => Boolean(entry.txHash || entry.cursor || entry.transactionHash))
    : [];
  const deferredHedgeQueue = Array.isArray(data.deferredHedgeQueue)
    ? data.deferredHedgeQueue.map(ensureDeferredHedgeQueueEntryShape).filter((entry) => Boolean(entry.id))
    : [];
  const managedPolymarketInventorySnapshot = data.managedPolymarketInventorySnapshot
    ? ensureManagedInventorySnapshotShape(data.managedPolymarketInventorySnapshot)
    : null;
  const targetHedgeInventory = ensureTargetHedgeInventoryShape(data.targetHedgeInventory);
  const skippedVolumeCounters = ensureSkippedVolumeCountersShape(data.skippedVolumeCounters);

  const state = {
    schemaVersion: MIRROR_HEDGE_STATE_SCHEMA_VERSION,
    runtimeType: MIRROR_HEDGE_RUNTIME_TYPE,
    strategyHash: resolvedHash,
    startedAt: normalizeOptionalString(data.startedAt),
    stoppedAt: normalizeOptionalString(data.stoppedAt || data.exitAt),
    updatedAt: normalizeOptionalString(data.updatedAt) || new Date().toISOString(),
    runtimeStatus: normalizeOptionalString(data.runtimeStatus) || 'idle',
    lastTickAt: normalizeOptionalString(data.lastTickAt),
    iterationsRequested: toFiniteNumberOrNull(data.iterationsRequested),
    iterationsCompleted: Number.isFinite(Number(data.iterationsCompleted)) ? Number(data.iterationsCompleted) : 0,
    stoppedReason: normalizeOptionalString(data.stoppedReason),
    exitCode: toFiniteNumberOrNull(data.exitCode),
    exitAt: normalizeOptionalString(data.exitAt || data.stoppedAt),
    marketPairIdentity,
    marketPairIdentityFingerprint:
      normalizeOptionalString(data.marketPairIdentityFingerprint)
      || marketPairIdentity.fingerprint
      || buildIdentityFingerprint(marketPairIdentity, data.whitelistFingerprint),
    marketPairId: marketPairIdentity.marketPairId,
    pandoraMarketAddress: marketPairIdentity.pandoraMarketAddress,
    polymarketMarketId: marketPairIdentity.polymarketMarketId,
    polymarketSlug: marketPairIdentity.polymarketSlug,
    whitelistFingerprint: normalizeOptionalString(data.whitelistFingerprint),
    lastProcessedBlockCursor,
    lastProcessedBlockNumber: lastProcessedBlockCursor ? lastProcessedBlockCursor.blockNumber : null,
    lastProcessedBlockHash: lastProcessedBlockCursor ? lastProcessedBlockCursor.blockHash : null,
    lastProcessedBlockCursorValue: lastProcessedBlockCursor ? lastProcessedBlockCursor.cursor : null,
    lastProcessedLogCursor,
    lastProcessedLogBlockNumber: lastProcessedLogCursor ? lastProcessedLogCursor.blockNumber : null,
    lastProcessedLogIndex: lastProcessedLogCursor ? lastProcessedLogCursor.logIndex : null,
    lastProcessedLogTransactionHash: lastProcessedLogCursor ? lastProcessedLogCursor.transactionHash : null,
    lastProcessedLogBlockHash: lastProcessedLogCursor ? lastProcessedLogCursor.blockHash : null,
    lastProcessedLogCursorValue: lastProcessedLogCursor ? lastProcessedLogCursor.cursor : null,
    confirmedExposureLedger,
    pendingMempoolOverlays,
    deferredHedgeQueue,
    managedPolymarketInventorySnapshot,
    targetHedgeInventory,
    availableHedgeFeeBudgetUsdc: toFiniteNumberOrNull(data.availableHedgeFeeBudgetUsdc) || 0,
    belowThresholdPendingUsdc: toFiniteNumberOrNull(data.belowThresholdPendingUsdc) || 0,
    skippedVolumeCounters,
    lastSuccessfulHedge: ensureOutcomeShape(data.lastSuccessfulHedge),
    lastError: ensureEventShape(data.lastError),
    lastAlert: ensureEventShape(data.lastAlert),
    lastPlanAt: normalizeOptionalString(data.lastPlanAt),
    lastRunAt: normalizeOptionalString(data.lastRunAt),
    lastStatusAt: normalizeOptionalString(data.lastStatusAt),
  };

  return {
    ...data,
    ...state,
  };
}

function createState(hash = null, raw = {}) {
  return ensureStateShape(raw, hash);
}

function loadState(filePath, hash) {
  const resolved = path.resolve(expandHome(filePath || defaultStateFile({ strategyHash: hash })));
  if (!fs.existsSync(resolved)) {
    return {
      filePath: resolved,
      state: ensureStateShape({}, hash),
    };
  }

  let parsed = {};
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch {
    parsed = {};
  }

  return {
    filePath: resolved,
    state: ensureStateShape(parsed, hash),
  };
}

function saveState(filePath, state) {
  const resolved = path.resolve(expandHome(filePath || defaultStateFile(state || {})));
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const tmpPath = `${resolved}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const serialized = JSON.stringify(state, null, 2);
  fs.writeFileSync(tmpPath, serialized, { mode: 0o600 });
  try {
    fs.renameSync(tmpPath, resolved);
    try {
      fs.chmodSync(resolved, 0o600);
    } catch {
      // best-effort permission hardening
    }
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, serialized, { mode: 0o600 });
      if (fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // ignore cleanup failure
        }
      }
    } else {
      throw err;
    }
  }
  return resolved;
}

module.exports = {
  MIRROR_HEDGE_STATE_SCHEMA_VERSION,
  MIRROR_HEDGE_RUNTIME_TYPE,
  defaultStateFile,
  defaultKillSwitchFile,
  buildIdentityFingerprint,
  createState,
  loadState,
  saveState,
  ensureStateShape,
  ensureMarketPairIdentityShape,
  ensureCursorShape,
  ensureConfirmedExposureLedgerEntryShape,
  ensurePendingMempoolOverlayShape,
  ensureDeferredHedgeQueueEntryShape,
  ensureManagedInventorySnapshotShape,
  ensureTargetHedgeInventoryShape,
  ensureSkippedVolumeCountersShape,
  ensureOutcomeShape,
  ensureEventShape,
};
