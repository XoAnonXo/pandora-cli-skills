const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  defaultStateFile,
  defaultKillSwitchFile,
  loadState,
  saveState,
  createState,
  buildIdentityFingerprint,
  ensureHedgeSignalShape,
  ensureObservedTradeShape,
  ensureRetryTelemetryShape,
  ensureTargetHedgeInventoryShape,
} = require('./mirror_hedge_state_store.cjs');
const {
  planHedgeRuntime,
  applyHedgeObservation,
} = require('./mirror_hedge/planning.cjs');
const {
  buildHedgeStatusPayload,
  buildBundleFacingHedgePayload,
} = require('./mirror_hedge/status.cjs');
const {
  normalizeConfirmedTradeFromLog,
  decodePendingPandoraTrade,
} = require('./mirror_hedge/events.cjs');
const {
  shouldSkipInternalWallet,
  evaluateDepthCheck,
  evaluatePartialVsSkipPolicy,
  evaluateDepthCheckedSellPolicy,
  classifyMirrorHedgeExecution,
  reconcileMempoolConfirmRevert,
} = require('./mirror_hedge/execution.cjs');
const {
  verifyMirrorPair,
} = require('./mirror_verify_service.cjs');
const {
  resolvePolymarketMarket,
  fetchDepthForMarket,
  fetchPolymarketPositionSummary,
  placeHedgeOrder,
} = require('./polymarket_trade_adapter.cjs');
const {
  createIndexerClient,
} = require('./indexer_client.cjs');
const {
  startDaemon,
  stopDaemon,
  daemonStatus,
  findPidFilesByMarketAddress,
} = require('./mirror_hedge_daemon_service.cjs');
const {
  round,
  toOptionalNumber,
  sleepMs,
} = require('./shared/utils.cjs');

const MIRROR_HEDGE_SERVICE_SCHEMA_VERSION = '1.0.0';
const DEFAULT_MIN_HEDGE_USDC = 25;
const DEFAULT_PARTIAL_HEDGE_POLICY = 'partial';
const DEFAULT_SELL_HEDGE_POLICY = 'depth-checked';
const DEFAULT_MARKET_FEE_BPS = 200;
const DEFAULT_RECENT_TRADE_LIMIT = 75;
const DEFAULT_BUNDLE_ROOT = 'mirror-hedge-bundles';
const DEFAULT_HEDGE_INTERVAL_MS = 5000;
const MAX_DEFERRED_RETRY_HINT_USDC = 1_000_000;
const MAX_DEFERRED_RETRY_HINT_SHARES = 1_000_000;

function createServiceError(code, message, details = undefined) {
  const err = new Error(message);
  err.code = code;
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

function normalizeOptionalString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeLowerText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeAddress(value) {
  const text = normalizeLowerText(value);
  return /^0x[a-f0-9]{40}$/.test(text) ? text : null;
}

function roundUsdc(value) {
  return round(toOptionalNumber(value), 6);
}

function normalizeTokenAmount(raw) {
  const numeric = toOptionalNumber(raw);
  if (numeric === null) return null;
  if (Math.abs(numeric) >= 1_000 && /^[0-9]+$/.test(String(raw || '').trim())) {
    return round(numeric / 10 ** 6, 6);
  }
  return round(numeric, 6);
}

const toUsdcAmount = normalizeTokenAmount;
const toTokenAmount = normalizeTokenAmount;

function mergeDiagnostics(...arrays) {
  return arrays.flat().reduce((output, item) => {
    const normalized = normalizeOptionalString(item);
    if (normalized && !output.includes(normalized)) {
      output.push(normalized);
    }
    return output;
  }, []);
}

function ensureDirectory(filePath) {
  fs.mkdirSync(filePath, { recursive: true });
}

function writeTextFile(filePath, content, mode = 0o600) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, content, { mode });
  try {
    fs.chmodSync(filePath, mode);
  } catch {
    // best-effort permission hardening
  }
}

function resolveStateFile(options = {}) {
  if (options.stateFile) {
    return path.resolve(String(options.stateFile));
  }
  if (options.strategyHash || options.runtimeHash) {
    return defaultStateFile({ runtimeHash: options.runtimeHash || options.strategyHash });
  }
  return defaultStateFile(options);
}

function resolveKillSwitchFile(options = {}) {
  return options.killSwitchFile ? path.resolve(String(options.killSwitchFile)) : defaultKillSwitchFile();
}

function resolveBundleOutputDir(options = {}, strategyHash) {
  const explicit = normalizeOptionalString(options.outputDir || options.bundleDir);
  if (explicit) {
    return path.resolve(explicit);
  }
  return path.resolve(process.cwd(), DEFAULT_BUNDLE_ROOT, strategyHash);
}

function ensureStateIdentity(state, options = {}) {
  const identityInput = options.marketPairIdentity && typeof options.marketPairIdentity === 'object'
    ? options.marketPairIdentity
    : {};
  if (!state.marketPairIdentity) {
    state.marketPairIdentity = {
      pandoraMarketAddress: normalizeOptionalString(options.pandoraMarketAddress || identityInput.pandoraMarketAddress || state.pandoraMarketAddress),
      polymarketMarketId: normalizeOptionalString(options.polymarketMarketId || identityInput.polymarketMarketId || state.polymarketMarketId),
      polymarketSlug: normalizeOptionalString(options.polymarketSlug || identityInput.polymarketSlug || state.polymarketSlug),
      marketPairId: normalizeOptionalString(options.marketPairId || identityInput.marketPairId || state.marketPairId),
      source: normalizeOptionalString(options.source || identityInput.source || state.source),
      description: normalizeOptionalString(options.description || identityInput.description || state.description),
      fingerprint: normalizeOptionalString(options.marketPairFingerprint || identityInput.fingerprint || state.marketPairIdentityFingerprint),
    };
  } else {
    state.marketPairIdentity = {
      ...state.marketPairIdentity,
      pandoraMarketAddress: normalizeOptionalString(options.pandoraMarketAddress || identityInput.pandoraMarketAddress || state.marketPairIdentity.pandoraMarketAddress),
      polymarketMarketId: normalizeOptionalString(options.polymarketMarketId || identityInput.polymarketMarketId || state.marketPairIdentity.polymarketMarketId),
      polymarketSlug: normalizeOptionalString(options.polymarketSlug || identityInput.polymarketSlug || state.marketPairIdentity.polymarketSlug),
      marketPairId: normalizeOptionalString(options.marketPairId || identityInput.marketPairId || state.marketPairIdentity.marketPairId),
      source: normalizeOptionalString(options.source || identityInput.source || state.marketPairIdentity.source),
      description: normalizeOptionalString(options.description || identityInput.description || state.marketPairIdentity.description),
      fingerprint: normalizeOptionalString(options.marketPairFingerprint || identityInput.fingerprint || state.marketPairIdentity.fingerprint),
    };
  }
  if (options.whitelistFingerprint !== undefined) {
    state.whitelistFingerprint = normalizeOptionalString(options.whitelistFingerprint || state.whitelistFingerprint);
  }
  state.marketPairId = state.marketPairIdentity.marketPairId;
  state.pandoraMarketAddress = state.marketPairIdentity.pandoraMarketAddress;
  state.polymarketMarketId = state.marketPairIdentity.polymarketMarketId;
  state.polymarketSlug = state.marketPairIdentity.polymarketSlug;
  return state;
}

function loadHedgeState(options = {}) {
  const filePath = resolveStateFile(options);
  return loadState(filePath, options.runtimeHash || options.strategyHash || null);
}

function persistHedgeState(filePath, state) {
  return saveState(filePath, state);
}

function toRuntimeTimestamp(value = undefined) {
  const date = value instanceof Date ? value : (value ? new Date(value) : new Date());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeRuntimeIntervalMs(options = {}) {
  const numeric = toOptionalNumber(options.intervalMs);
  if (numeric === null || numeric <= 0) return DEFAULT_HEDGE_INTERVAL_MS;
  return Math.max(1, Math.floor(numeric));
}

function normalizeRuntimeIterations(options = {}) {
  const numeric = toOptionalNumber(options.iterations);
  if (numeric === null || numeric <= 0) return null;
  return Math.max(1, Math.floor(numeric));
}

function buildRuntimeErrorEvent(err, timestamp, details = undefined) {
  const event = {
    code: normalizeOptionalString(err && err.code) || 'MIRROR_HEDGE_RUNTIME_ERROR',
    message: normalizeOptionalString(err && err.message) || String(err),
    severity: 'error',
    at: toRuntimeTimestamp(timestamp),
    source: 'mirror-hedge-runtime',
  };
  if (details !== undefined) {
    event.details = details;
  } else if (err && err.details !== undefined) {
    event.details = err.details;
  }
  return event;
}

function toLatencyMs(later, earlier) {
  const laterMs = later ? Date.parse(String(later)) : NaN;
  const earlierMs = earlier ? Date.parse(String(earlier)) : NaN;
  if (!Number.isFinite(laterMs) || !Number.isFinite(earlierMs)) return null;
  return Math.max(0, laterMs - earlierMs);
}

function buildObservedTradeTelemetry(trade, pairContext, options = {}) {
  if (!trade || typeof trade !== 'object') return null;
  const confirmedAt = normalizeOptionalString(trade.confirmedAt || trade.timestamp);
  const observedAt = normalizeOptionalString(trade.ingestedAt || trade.observedAt);
  return ensureObservedTradeShape({
    tradeId: normalizeOptionalString(trade.id || trade.cursor || trade.transactionHash),
    cursor: normalizeOptionalString(trade.cursor),
    transactionHash: normalizeOptionalString(trade.transactionHash),
    walletAddress: normalizeOptionalString(trade.walletAddress),
    marketPairId: pairContext && pairContext.marketPairIdentity ? pairContext.marketPairIdentity.marketPairId : null,
    pandoraMarketAddress: pairContext && pairContext.marketPairIdentity ? pairContext.marketPairIdentity.pandoraMarketAddress : null,
    polymarketMarketId: pairContext && pairContext.marketPairIdentity ? pairContext.marketPairIdentity.polymarketMarketId : null,
    polymarketSlug: pairContext && pairContext.marketPairIdentity ? pairContext.marketPairIdentity.polymarketSlug : null,
    source: normalizeOptionalString(trade.source) || 'pandora.indexer',
    orderSide: normalizeOptionalString(trade.orderSide),
    tokenSide: normalizeOptionalString(trade.tokenSide),
    direction: normalizeOptionalString(trade.direction),
    amountUsdc: roundUsdc(trade.amountUsdc),
    amountShares: round(toOptionalNumber(trade.amountShares) || 0, 6) || 0,
    expectedRevenueUsdc: roundUsdc(trade.expectedRevenueUsdc),
    confirmedAt,
    observedAt,
    observationLatencyMs: toLatencyMs(observedAt, confirmedAt),
    hedgeEligible:
      options.hedgeEligible === null || options.hedgeEligible === undefined
        ? null
        : Boolean(options.hedgeEligible),
    reason: normalizeOptionalString(options.reason),
    details: options.details,
  });
}

function buildHedgeSignalTelemetry(action, fillPolicy, observedTrade, signalAt, options = {}) {
  const signalTimestamp = toRuntimeTimestamp(signalAt);
  return ensureHedgeSignalShape({
    hedgeId: normalizeOptionalString(action && action.queueKey),
    status: normalizeOptionalString(options.status)
      || (options.executeLive
        ? (fillPolicy && fillPolicy.status === 'partial' ? 'partial-executed' : 'executed')
        : (fillPolicy && fillPolicy.status === 'partial' ? 'partial-planned' : 'planned')),
    signalAt: signalTimestamp,
    tradeId: observedTrade ? observedTrade.tradeId : null,
    cursor: observedTrade ? observedTrade.cursor : null,
    transactionHash: observedTrade ? observedTrade.transactionHash : null,
    tradeConfirmedAt: observedTrade ? observedTrade.confirmedAt : null,
    tradeObservedAt: observedTrade ? observedTrade.observedAt : null,
    reactionLatencyMs: toLatencyMs(signalTimestamp, observedTrade && observedTrade.confirmedAt),
    observeToSignalLatencyMs: toLatencyMs(signalTimestamp, observedTrade && observedTrade.observedAt),
    amountUsdc: roundUsdc(options.amountUsdc !== undefined ? options.amountUsdc : action && action.amountUsdc),
    amountShares: round(toOptionalNumber(options.amountShares !== undefined ? options.amountShares : action && action.amountShares) || 0, 6) || 0,
    tokenSide: normalizeOptionalString(action && action.tokenSide),
    orderSide: normalizeOptionalString(action && action.orderSide),
    source: options.executeLive ? 'polymarket' : 'mirror-hedge-paper',
    reason: normalizeOptionalString(fillPolicy && fillPolicy.reasonCode) || normalizeOptionalString(options.reason) || 'inventory-gap',
    details: options.details,
  });
}

function markHedgeRuntimeStarted(state, options = {}) {
  const timestamp = toRuntimeTimestamp(options.now);
  state.runtimeStatus = normalizeOptionalString(options.runtimeStatus) || 'running';
  state.startedAt = normalizeOptionalString(options.startedAt || state.startedAt) || timestamp;
  state.stoppedAt = null;
  state.updatedAt = timestamp;
  state.lastRunAt = timestamp;
  state.stoppedReason = null;
  state.exitCode = null;
  state.exitAt = null;
  if (options.iterationsRequested !== undefined) {
    state.iterationsRequested = options.iterationsRequested;
  }
  if (options.resetIterationsCompleted !== false) {
    state.iterationsCompleted = 0;
  } else if (!Number.isFinite(Number(state.iterationsCompleted))) {
    state.iterationsCompleted = 0;
  }
  return state;
}

function markHedgeRuntimeTickStarted(state, options = {}) {
  const timestamp = toRuntimeTimestamp(options.now);
  state.runtimeStatus = 'running';
  state.lastTickAt = timestamp;
  state.updatedAt = timestamp;
  return state;
}

function markHedgeRuntimeTickCompleted(state, options = {}) {
  const timestamp = toRuntimeTimestamp(options.now);
  state.runtimeStatus = 'running';
  state.lastRunAt = timestamp;
  state.updatedAt = timestamp;
  if (options.iterationsCompleted !== undefined) {
    state.iterationsCompleted = options.iterationsCompleted;
  }
  return state;
}

function markHedgeRuntimeStopped(state, options = {}) {
  const timestamp = toRuntimeTimestamp(options.exitAt || options.now);
  state.runtimeStatus = normalizeOptionalString(options.runtimeStatus) || 'stopped';
  state.stoppedAt = timestamp;
  state.updatedAt = timestamp;
  state.stoppedReason = normalizeOptionalString(options.stoppedReason);
  state.exitCode = options.exitCode === null || options.exitCode === undefined ? 0 : Number(options.exitCode);
  state.exitAt = timestamp;
  if (options.iterationsRequested !== undefined) {
    state.iterationsRequested = options.iterationsRequested;
  }
  if (options.iterationsCompleted !== undefined) {
    state.iterationsCompleted = options.iterationsCompleted;
  }
  if (options.lastError) {
    state.lastError = options.lastError;
  }
  if (options.lastAlert) {
    state.lastAlert = options.lastAlert;
  }
  return state;
}

function buildHedgeRuntime(options = {}) {
  const loaded = loadHedgeState(options);
  const state = createState(options.runtimeHash || options.strategyHash || null, loaded.state);
  ensureStateIdentity(state, options);
  const plan = planHedgeRuntime({
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
    retryTelemetry: options.retryTelemetry,
  });
  return {
    filePath: loaded.filePath,
    state,
    plan,
  };
}

function planHedge(options = {}) {
  return buildHedgeRuntime(options);
}

function runHedge(options = {}) {
  const loaded = loadHedgeState(options);
  const state = createState(options.runtimeHash || options.strategyHash || null, loaded.state);
  ensureStateIdentity(state, options);
  applyHedgeObservation(state, {
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
    retryTelemetry: options.retryTelemetry,
    lastObservedTrade: options.lastObservedTrade,
    lastHedgeSignal: options.lastHedgeSignal,
    lastSuccessfulHedge: options.lastSuccessfulHedge,
    lastError: options.lastError,
    lastAlert: options.lastAlert,
  }, options.now);
  const plan = planHedgeRuntime({
    state,
    now: options.now,
    targetHedgeInventory: options.targetHedgeInventory,
    availableHedgeFeeBudgetUsdc: options.availableHedgeFeeBudgetUsdc,
    belowThresholdPendingUsdc: options.belowThresholdPendingUsdc,
    retryTelemetry: options.retryTelemetry,
  });
  if (options.persist !== false) {
    persistHedgeState(loaded.filePath, state);
  }
  return {
    filePath: loaded.filePath,
    state,
    plan,
  };
}

function startHedge(options = {}) {
  const loaded = loadHedgeState(options);
  const state = createState(options.runtimeHash || options.strategyHash || null, loaded.state);
  ensureStateIdentity(state, options);
  markHedgeRuntimeStarted(state, {
    now: options.now,
    iterationsRequested: options.iterationsRequested !== undefined
      ? options.iterationsRequested
      : normalizeRuntimeIterations(options),
  });
  if (options.marketPairIdentity) {
    state.marketPairIdentity = {
      ...state.marketPairIdentity,
      ...options.marketPairIdentity,
    };
  }
  const plan = planHedgeRuntime({
    state,
    now: options.now,
    whitelistFingerprint: options.whitelistFingerprint,
  });
  persistHedgeState(loaded.filePath, state);
  return {
    filePath: loaded.filePath,
    state,
    plan,
    started: true,
  };
}

function stopHedge(options = {}) {
  const loaded = loadHedgeState(options);
  const state = createState(options.runtimeHash || options.strategyHash || null, loaded.state);
  const timestamp = toRuntimeTimestamp(options.exitAt || options.now);
  const normalizedLastAlert = options.lastAlert
    ? {
        ...options.lastAlert,
        at: normalizeOptionalString(options.lastAlert.at || options.lastAlert.timestamp) || timestamp,
      }
    : null;
  if (options.lastAlert) {
    state.lastAlert = normalizedLastAlert;
  }
  markHedgeRuntimeStopped(state, {
    now: timestamp,
    exitAt: timestamp,
    stoppedReason:
      options.stoppedReason
      || (normalizedLastAlert && normalizedLastAlert.message)
      || 'Hedge runtime stopped.',
    exitCode: options.exitCode,
    iterationsCompleted: options.iterationsCompleted,
    lastAlert: normalizedLastAlert,
  });
  persistHedgeState(loaded.filePath, state);
  return {
    filePath: loaded.filePath,
    state,
    stopped: true,
  };
}

function statusHedge(options = {}) {
  const loaded = loadHedgeState(options);
  const state = createState(options.runtimeHash || options.strategyHash || null, loaded.state);
  const plan = planHedgeRuntime({
    state,
    now: options.now,
  });
  state.lastStatusAt = (options.now instanceof Date ? options.now : new Date()).toISOString();
  persistHedgeState(loaded.filePath, state);
  return buildHedgeStatusPayload({
    stateFile: loaded.filePath,
    strategyHash: state.strategyHash,
    state,
    plan,
  });
}

function bundleFacingHedge(options = {}) {
  const loaded = loadHedgeState(options);
  const state = createState(options.runtimeHash || options.strategyHash || null, loaded.state);
  const plan = planHedgeRuntime({
    state,
    now: options.now,
  });
  return buildBundleFacingHedgePayload({
    stateFile: loaded.filePath,
    strategyHash: state.strategyHash,
    state,
    plan,
  });
}

function resolveSelectorsFromState(options = {}) {
  const loaded = loadHedgeState(options);
  const state = createState(options.runtimeHash || options.strategyHash || null, loaded.state);
  const identity = state.marketPairIdentity || {};
  return {
    loaded,
    state,
    pandoraMarketAddress: normalizeOptionalString(options.pandoraMarketAddress || identity.pandoraMarketAddress || state.pandoraMarketAddress),
    polymarketMarketId: normalizeOptionalString(options.polymarketMarketId || identity.polymarketMarketId || state.polymarketMarketId),
    polymarketSlug: normalizeOptionalString(options.polymarketSlug || identity.polymarketSlug || state.polymarketSlug),
  };
}

function loadInternalWalletConfig(options = {}) {
  const configuredPath = normalizeOptionalString(
    options.internalWalletsFile
      || options.whitelistFile
      || options.internalWalletFile
      || process.env.PANDORA_INTERNAL_WALLETS_FILE,
  );
  if (!configuredPath) {
    throw createServiceError(
      'MIRROR_HEDGE_INTERNAL_WALLETS_REQUIRED',
      'mirror hedge requires --internal-wallets-file <path> or PANDORA_INTERNAL_WALLETS_FILE.',
    );
  }
  const resolvedPath = path.resolve(configuredPath);
  if (!fs.existsSync(resolvedPath)) {
    throw createServiceError(
      'MIRROR_HEDGE_INTERNAL_WALLETS_NOT_FOUND',
      `Internal wallet whitelist file not found: ${resolvedPath}`,
      { filePath: resolvedPath },
    );
  }
  const raw = fs.readFileSync(resolvedPath, 'utf8');
  const wallets = [];
  const invalid = [];
  for (const line of raw.split(/\r?\n/g)) {
    const stripped = String(line || '').replace(/#.*$/, '').trim();
    if (!stripped) continue;
    const candidate = normalizeAddress(stripped);
    if (!candidate) {
      invalid.push(stripped);
      continue;
    }
    if (!wallets.includes(candidate)) {
      wallets.push(candidate);
    }
  }
  if (invalid.length) {
    throw createServiceError(
      'MIRROR_HEDGE_INTERNAL_WALLETS_INVALID',
      'Internal wallet whitelist contains invalid addresses.',
      { filePath: resolvedPath, invalid },
    );
  }
  const fingerprint = buildIdentityFingerprint(
    {
      pandoraMarketAddress: null,
      polymarketMarketId: null,
      polymarketSlug: null,
      marketPairId: null,
    },
    `${resolvedPath}:${wallets.join(',')}`,
  );
  return {
    filePath: resolvedPath,
    wallets,
    count: wallets.length,
    fingerprint,
  };
}

async function resolveHedgePair(options = {}, selectors = {}) {
  const pandoraMarketAddress = selectors.pandoraMarketAddress;
  const polymarketMarketId = selectors.polymarketMarketId;
  const polymarketSlug = selectors.polymarketSlug;
  if (!pandoraMarketAddress) {
    throw createServiceError(
      'MIRROR_HEDGE_PANDORA_MARKET_REQUIRED',
      'mirror hedge requires --pandora-market-address/--market-address, or a state file containing it.',
    );
  }
  if (!polymarketMarketId && !polymarketSlug) {
    throw createServiceError(
      'MIRROR_HEDGE_POLYMARKET_SELECTOR_REQUIRED',
      'mirror hedge requires --polymarket-market-id or --polymarket-slug, or a state file containing one.',
    );
  }

  const verified = await verifyMirrorPair({
    ...options,
    pandoraMarketAddress,
    polymarketMarketId,
    polymarketSlug,
  });
  const sourceMarket =
    verified && verified.sourceMarket && (verified.sourceMarket.marketId || verified.sourceMarket.slug)
      ? verified.sourceMarket
      : await resolvePolymarketMarket({
          host: options.polymarketHost,
          gammaUrl: options.polymarketGammaUrl,
          gammaMockUrl: options.polymarketGammaMockUrl,
          mockUrl: options.polymarketMockUrl,
          timeoutMs: options.timeoutMs,
          marketId: polymarketMarketId,
          slug: polymarketSlug,
        });

  const pandoraQuestion = normalizeOptionalString(verified && verified.pandora && verified.pandora.question);
  const sourceQuestion = normalizeOptionalString(sourceMarket && sourceMarket.question);
  const marketPairIdentity = {
    pandoraMarketAddress,
    polymarketMarketId: normalizeOptionalString(sourceMarket && sourceMarket.marketId) || polymarketMarketId || null,
    polymarketSlug: normalizeOptionalString(sourceMarket && sourceMarket.slug) || polymarketSlug || null,
    marketPairId: [
      pandoraMarketAddress,
      normalizeOptionalString(sourceMarket && sourceMarket.marketId) || polymarketMarketId || '',
      normalizeOptionalString(sourceMarket && sourceMarket.slug) || polymarketSlug || '',
    ].filter(Boolean).join('|'),
    description: pandoraQuestion || sourceQuestion,
    source: 'mirror-hedge',
  };

  return {
    verified,
    sourceMarket,
    marketPairIdentity,
  };
}

function buildStrategyHashFromIdentity(identity, whitelistFingerprint) {
  return buildIdentityFingerprint(identity, whitelistFingerprint);
}

function normalizeTradeLimit(options = {}) {
  const raw = toOptionalNumber(options.tradeWindowLimit || options.recentTradeLimit || options.limit);
  if (raw === null || raw <= 0) return DEFAULT_RECENT_TRADE_LIMIT;
  return Math.max(1, Math.min(500, Math.floor(raw)));
}

function normalizeMarketFeeBps(options = {}) {
  const raw = toOptionalNumber(options.marketFeeBps);
  if (raw === null || raw <= 0) return DEFAULT_MARKET_FEE_BPS;
  return raw;
}

function normalizeMinHedgeUsdc(options = {}) {
  const explicit = toOptionalNumber(options.minHedgeUsdc);
  if (explicit !== null && explicit > 0) return explicit;
  const envDefault = toOptionalNumber(process.env.PANDORA_HEDGE_MIN_USDC);
  if (envDefault !== null && envDefault > 0) return envDefault;
  return DEFAULT_MIN_HEDGE_USDC;
}

function normalizePartialPolicy(options = {}) {
  const explicit = normalizeLowerText(options.partialHedgePolicy || options.partialPolicy || process.env.PANDORA_HEDGE_PARTIAL_POLICY);
  return explicit === 'skip' ? 'skip' : DEFAULT_PARTIAL_HEDGE_POLICY;
}

function normalizeSellPolicy(options = {}) {
  const explicit = normalizeLowerText(options.sellHedgePolicy || process.env.PANDORA_HEDGE_SELL_POLICY);
  return explicit === 'manual-only' ? 'manual-only' : DEFAULT_SELL_HEDGE_POLICY;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function buildCanonicalTargetInventory(netSharesSigned, metadata = {}) {
  const signed = round(toOptionalNumber(netSharesSigned) || 0, 6) || 0;
  if (signed > 0) {
    return ensureTargetHedgeInventoryShape({
      yesShares: signed,
      noShares: 0,
      initializedAt: metadata.initializedAt,
      initializedFrom: metadata.initializedFrom,
      updatedAt: metadata.updatedAt,
    });
  }
  if (signed < 0) {
    return ensureTargetHedgeInventoryShape({
      yesShares: 0,
      noShares: Math.abs(signed),
      initializedAt: metadata.initializedAt,
      initializedFrom: metadata.initializedFrom,
      updatedAt: metadata.updatedAt,
    });
  }
  return ensureTargetHedgeInventoryShape({
    yesShares: 0,
    noShares: 0,
    initializedAt: metadata.initializedAt,
    initializedFrom: metadata.initializedFrom,
    updatedAt: metadata.updatedAt,
  });
}

function getTargetSignedShares(targetInventory) {
  const target = ensureTargetHedgeInventoryShape(targetInventory);
  return round((target.yesShares || 0) - (target.noShares || 0), 6) || 0;
}

function mapTradeToTargetDeltaShares(trade) {
  const shares = Math.max(0, toOptionalNumber(trade && trade.amountShares) || 0);
  const orderSide = normalizeLowerText(trade && trade.orderSide);
  const tokenSide = normalizeLowerText(trade && trade.tokenSide);
  if (!(shares > 0) || !orderSide || !tokenSide) return 0;
  if (orderSide === 'buy' && tokenSide === 'yes') return shares;
  if (orderSide === 'buy' && tokenSide === 'no') return -shares;
  if (orderSide === 'sell' && tokenSide === 'yes') return -shares;
  if (orderSide === 'sell' && tokenSide === 'no') return shares;
  return 0;
}

function applyTradeToTargetInventory(currentTarget, trade, timestamp) {
  const before = ensureTargetHedgeInventoryShape(currentTarget);
  const deltaSharesSigned = mapTradeToTargetDeltaShares(trade);
  const after = buildCanonicalTargetInventory(
    getTargetSignedShares(before) + deltaSharesSigned,
    {
      initializedAt: before.initializedAt || toRuntimeTimestamp(timestamp),
      initializedFrom: before.initializedFrom || 'flat',
      updatedAt: toRuntimeTimestamp(timestamp),
    },
  );
  return {
    before,
    after,
    deltaSharesSigned,
    yesTargetDeltaShares: round((after.yesShares || 0) - (before.yesShares || 0), 6) || 0,
    noTargetDeltaShares: round((after.noShares || 0) - (before.noShares || 0), 6) || 0,
  };
}

function initializeTargetInventory(state, inventorySnapshot, options = {}) {
  const existing = ensureTargetHedgeInventoryShape(state && state.targetHedgeInventory);
  if ((existing.yesShares || 0) > 0 || (existing.noShares || 0) > 0 || existing.initializedAt) {
    return existing;
  }
  const initializedAt = toRuntimeTimestamp(options.now);
  if (options.adoptExistingPositions && inventorySnapshot) {
    return buildCanonicalTargetInventory(
      (toOptionalNumber(inventorySnapshot.yesShares) || 0) - (toOptionalNumber(inventorySnapshot.noShares) || 0),
      {
        initializedAt,
        initializedFrom: 'adopted-existing-positions',
        updatedAt: initializedAt,
      },
    );
  }
  return ensureTargetHedgeInventoryShape({
    initializedAt,
    initializedFrom: 'flat',
    updatedAt: initializedAt,
  });
}

function getReferencePriceForSide(tokenSide, depth, sourceMarket, inventorySnapshot) {
  const normalizedSide = normalizeLowerText(tokenSide);
  if (!normalizedSide) return null;
  const fromDepth = normalizedSide === 'yes'
    ? depth && depth.yesDepth && toOptionalNumber(depth.yesDepth.referencePrice)
    : depth && depth.noDepth && toOptionalNumber(depth.noDepth.referencePrice);
  if (fromDepth !== null && fromDepth > 0) return fromDepth;
  const fromInventory = normalizedSide === 'yes'
    ? (
        (toOptionalNumber(inventorySnapshot && inventorySnapshot.yesUsdc) !== null
          && toOptionalNumber(inventorySnapshot && inventorySnapshot.yesShares) > 0)
          ? round(toOptionalNumber(inventorySnapshot.yesUsdc) / toOptionalNumber(inventorySnapshot.yesShares), 6)
          : null
      )
    : (
        (toOptionalNumber(inventorySnapshot && inventorySnapshot.noUsdc) !== null
          && toOptionalNumber(inventorySnapshot && inventorySnapshot.noShares) > 0)
          ? round(toOptionalNumber(inventorySnapshot.noUsdc) / toOptionalNumber(inventorySnapshot.noShares), 6)
          : null
      );
  if (fromInventory !== null && fromInventory > 0) return fromInventory;
  const fromMarket = normalizedSide === 'yes'
    ? toOptionalNumber(sourceMarket && sourceMarket.yesPct)
    : toOptionalNumber(sourceMarket && sourceMarket.noPct);
  return fromMarket !== null && fromMarket > 0 ? fromMarket : null;
}

function buildProjectedInventorySnapshot(baseSnapshot, timestamp) {
  const current = baseSnapshot && typeof baseSnapshot === 'object' ? baseSnapshot : {};
  return {
    ...current,
    yesShares: Math.max(0, toOptionalNumber(current.yesShares) || 0),
    noShares: Math.max(0, toOptionalNumber(current.noShares) || 0),
    adoptedAt: normalizeOptionalString(current.adoptedAt) || toRuntimeTimestamp(timestamp),
    updatedAt: toRuntimeTimestamp(timestamp),
    status: normalizeOptionalString(current.status) || 'observed',
  };
}

function buildGapShares(targetInventory, inventorySnapshot) {
  const target = ensureTargetHedgeInventoryShape(targetInventory);
  const projected = buildProjectedInventorySnapshot(inventorySnapshot);
  return {
    targetYesShares: target.yesShares || 0,
    targetNoShares: target.noShares || 0,
    currentYesShares: projected.yesShares || 0,
    currentNoShares: projected.noShares || 0,
    excessYesToSell: round(Math.max(0, (projected.yesShares || 0) - (target.yesShares || 0)), 6) || 0,
    excessNoToSell: round(Math.max(0, (projected.noShares || 0) - (target.noShares || 0)), 6) || 0,
    deficitYesToBuy: round(Math.max(0, (target.yesShares || 0) - (projected.yesShares || 0)), 6) || 0,
    deficitNoToBuy: round(Math.max(0, (target.noShares || 0) - (projected.noShares || 0)), 6) || 0,
  };
}

function estimateExecutionCostUsdc(options = {}, action = {}) {
  const explicit = toOptionalNumber(
    options.estimatedExecutionFeeUsdc
    || options.executionFeeUsdc
    || process.env.PANDORA_HEDGE_ESTIMATED_EXECUTION_FEE_USDC,
  );
  if (explicit !== null && explicit >= 0) return explicit;
  const percentBps = toOptionalNumber(options.estimatedExecutionFeeBps);
  if (percentBps !== null && percentBps >= 0 && action.amountUsdc) {
    return round((action.amountUsdc * percentBps) / 10_000, 6) || 0;
  }
  return 0;
}

function buildTradeForGapAction(action = {}) {
  return {
    orderSide: action.orderSide,
    tokenSide: action.tokenSide,
    direction: `${action.orderSide}-${action.tokenSide}`,
    amountShares: action.amountShares,
    amountUsdc: action.amountUsdc,
    expectedRevenueUsdc: action.expectedRevenueUsdc,
    marketAddress: action.marketAddress,
    marketId: action.marketId,
    source: action.source || 'mirror-hedge.inventory-gap',
    feeUsdc: action.feeUsdc,
    gasUsdc: action.gasUsdc,
  };
}

function buildQueueEntryForAction(action, reasonCode, reason, residualShares, residualUsdc, metadata = {}) {
  return {
    id: `${action.queueKey}:${reasonCode}`,
    queueKey: normalizeOptionalString(metadata.queueKey || action.queueKey),
    status: 'queued',
    marketPairId: action.marketPairId,
    side: action.direction,
    tokenSide: action.tokenSide,
    orderSide: action.orderSide,
    amountUsdc: roundUsdc(residualUsdc),
    amountShares: round(toOptionalNumber(residualShares) || 0, 6) || 0,
    targetUsdc: roundUsdc(action.amountUsdc),
    targetShares: round(toOptionalNumber(action.amountShares) || 0, 6) || 0,
    source: metadata.source || 'mirror-hedge.inventory-gap',
    reason: normalizeOptionalString(reasonCode) || 'unspecified',
    notes: normalizeOptionalString(reason),
    createdAt: metadata.createdAt || new Date().toISOString(),
    updatedAt: metadata.updatedAt || new Date().toISOString(),
  };
}

function sanitizeDeferredRetryHint(value, maxValue) {
  const numeric = toOptionalNumber(value);
  if (numeric === null || !Number.isFinite(numeric)) return null;
  if (numeric <= 0 || numeric > maxValue) return null;
  const rounded = round(numeric, 6);
  return rounded > 0 ? rounded : null;
}

function describeDeferredQueueSizingIssue(original, strippedFields) {
  const absurdFields = [];
  const nonPositiveFields = [];
  for (const field of strippedFields) {
    const numeric = toOptionalNumber(original && original[field]);
    if (numeric === null) continue;
    const limit = field.toLowerCase().includes('usdc')
      ? MAX_DEFERRED_RETRY_HINT_USDC
      : MAX_DEFERRED_RETRY_HINT_SHARES;
    if (numeric > limit) {
      absurdFields.push(field);
    } else if (numeric <= 0) {
      nonPositiveFields.push(field);
    }
  }
  if (absurdFields.length && nonPositiveFields.length) {
    return 'Deferred hedge retry sizing contained stale oversized values and non-positive values; the daemon will recompute the live hedge amount instead of trusting queued sizing.';
  }
  if (absurdFields.length) {
    return 'Deferred hedge retry sizing contained stale oversized values; the daemon will recompute the live hedge amount instead of trusting queued sizing.';
  }
  if (nonPositiveFields.length) {
    return 'Deferred hedge retry sizing was non-positive after normalization; the daemon will recompute the live hedge amount instead of trusting queued sizing.';
  }
  return 'Deferred hedge retry sizing was sanitized; the daemon will recompute the live hedge amount instead of trusting queued sizing.';
}

function sanitizeDeferredQueueEntry(entry = {}) {
  if (!entry || typeof entry !== 'object') {
    return { entry: null, strippedFields: [], original: {} };
  }
  const original = {
    amountUsdc: toOptionalNumber(entry.amountUsdc),
    amountShares: toOptionalNumber(entry.amountShares),
    targetUsdc: toOptionalNumber(entry.targetUsdc),
    targetShares: toOptionalNumber(entry.targetShares),
  };
  const sanitized = {
    ...entry,
    amountUsdc: sanitizeDeferredRetryHint(entry.amountUsdc, MAX_DEFERRED_RETRY_HINT_USDC),
    amountShares: sanitizeDeferredRetryHint(entry.amountShares, MAX_DEFERRED_RETRY_HINT_SHARES),
    targetUsdc: sanitizeDeferredRetryHint(entry.targetUsdc, MAX_DEFERRED_RETRY_HINT_USDC),
    targetShares: sanitizeDeferredRetryHint(entry.targetShares, MAX_DEFERRED_RETRY_HINT_SHARES),
  };
  const strippedFields = Object.keys(original).filter((field) => {
    const hadValue = original[field] !== null;
    const keptValue = sanitized[field] !== null;
    return hadValue && !keptValue;
  });
  return { entry: sanitized, strippedFields, original };
}

function isSellLikeQueueEntry(entry = {}) {
  const orderSide = normalizeLowerText(entry.orderSide);
  if (orderSide === 'sell') return true;
  return normalizeOptionalString(entry.id || '').includes(':sell-');
}

function getDeferredQueueKey(entry = {}) {
  const explicit = normalizeOptionalString(entry.queueKey || entry.actionKey);
  if (explicit) return explicit;
  const id = normalizeOptionalString(entry.id || entry.queueId);
  if (!id) return null;
  const separator = id.lastIndexOf(':');
  return separator > 0 ? id.slice(0, separator) : id;
}

function computeDeferredQueueAgeMs(entry = {}) {
  const timestamp = normalizeOptionalString(entry.createdAt || entry.updatedAt || entry.dueAt);
  if (!timestamp) return null;
  const ms = new Date(timestamp).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Date.now() - ms);
}

function resolveDeferredQueueStaleAgeMs(options = {}) {
  const explicit = toOptionalNumber(options.deferredQueueStaleAgeMs || process.env.PANDORA_HEDGE_DEFERRED_QUEUE_STALE_AGE_MS);
  if (explicit !== null && explicit > 0) return explicit;
  return Math.max(60_000, normalizeRuntimeIntervalMs(options) * 20);
}

function isClearlyInvalidDeferredQueueEntry(entry = {}) {
  const reason = normalizeOptionalString(entry.reason);
  const amountUsdc = toOptionalNumber(entry.amountUsdc);
  const amountShares = toOptionalNumber(entry.amountShares);
  const targetUsdc = toOptionalNumber(entry.targetUsdc);
  const targetShares = toOptionalNumber(entry.targetShares);
  if (reason === 'invalid-hedge-amount' || reason === 'non-executable-partial') {
    return true;
  }
  if (amountUsdc !== null && amountUsdc <= 0) return true;
  if (amountShares !== null && amountShares <= 0) return true;
  if (targetUsdc !== null && targetUsdc <= 0) return true;
  if (targetShares !== null && targetShares <= 0) return true;
  if (amountUsdc !== null && amountUsdc > MAX_DEFERRED_RETRY_HINT_USDC) return true;
  if (amountShares !== null && amountShares > MAX_DEFERRED_RETRY_HINT_SHARES) return true;
  if (targetUsdc !== null && targetUsdc > MAX_DEFERRED_RETRY_HINT_USDC) return true;
  if (targetShares !== null && targetShares > MAX_DEFERRED_RETRY_HINT_SHARES) return true;
  return false;
}

function buildDepthAuditSnapshot(depthCheck) {
  if (!depthCheck || typeof depthCheck !== 'object') return null;
  return {
    status: normalizeOptionalString(depthCheck.status),
    depthKnown: Boolean(depthCheck.depthKnown),
    referencePrice: toOptionalNumber(depthCheck.referencePrice),
    capacityUsdc: toOptionalNumber(depthCheck.capacityUsdc),
    depthShares: toOptionalNumber(depthCheck.depthShares),
    fillableUsdc: toOptionalNumber(depthCheck.fillableUsdc),
    fillableShares: toOptionalNumber(depthCheck.fillableShares),
  };
}

function buildNextRetryTelemetry(previousTelemetry, deltaTelemetry) {
  const previous = ensureRetryTelemetryShape(previousTelemetry);
  const delta = deltaTelemetry && typeof deltaTelemetry === 'object' ? deltaTelemetry : {};
  return ensureRetryTelemetryShape({
    sellAttemptedCount: previous.sellAttemptedCount + (toOptionalNumber(delta.sellAttemptedCount) || 0),
    sellBlockedCount: previous.sellBlockedCount + (toOptionalNumber(delta.sellBlockedCount) || 0),
    sellFailedCount: previous.sellFailedCount + (toOptionalNumber(delta.sellFailedCount) || 0),
    sellRecoveredCount: previous.sellRecoveredCount + (toOptionalNumber(delta.sellRecoveredCount) || 0),
    lastAttemptAt: normalizeOptionalString(delta.lastAttemptAt) || previous.lastAttemptAt,
    lastBlockedAt: normalizeOptionalString(delta.lastBlockedAt) || previous.lastBlockedAt,
    lastBlockedReasonCode: normalizeOptionalString(delta.lastBlockedReasonCode) || previous.lastBlockedReasonCode,
    lastBlockedReason: normalizeOptionalString(delta.lastBlockedReason) || previous.lastBlockedReason,
    lastFailureAt: normalizeOptionalString(delta.lastFailureAt) || previous.lastFailureAt,
    lastFailureCode: normalizeOptionalString(delta.lastFailureCode) || previous.lastFailureCode,
    lastFailureMessage: normalizeOptionalString(delta.lastFailureMessage) || previous.lastFailureMessage,
    lastRecoveryAt: normalizeOptionalString(delta.lastRecoveryAt) || previous.lastRecoveryAt,
  });
}

function resolveActionTokenId(tokenSide, sourceMarket) {
  return normalizeLowerText(tokenSide) === 'no'
    ? sourceMarket && sourceMarket.noTokenId
    : sourceMarket && sourceMarket.yesTokenId;
}

function deriveAllowedShares(action, fillPolicy, depthCheck) {
  if (!action || !fillPolicy) return 0;
  if (fillPolicy.status === 'execute') {
    return round(Math.max(0, toOptionalNumber(action.amountShares) || 0), 6) || 0;
  }
  if (fillPolicy.status === 'partial') {
    if (depthCheck && toOptionalNumber(depthCheck.fillableShares) !== null) {
      return round(Math.max(0, Math.min(toOptionalNumber(action.amountShares) || 0, toOptionalNumber(depthCheck.fillableShares) || 0)), 6) || 0;
    }
    if (toOptionalNumber(action.referencePrice) !== null && toOptionalNumber(action.referencePrice) > 0) {
      return round((toOptionalNumber(fillPolicy.allowedUsdc) || 0) / toOptionalNumber(action.referencePrice), 6) || 0;
    }
  }
  return 0;
}

function updateProjectedInventorySnapshot(snapshot, action, executedShares, executedUsdc, timestamp) {
  const projected = buildProjectedInventorySnapshot(snapshot, timestamp);
  const shares = Math.max(0, toOptionalNumber(executedShares) || 0);
  const usdc = Math.max(0, toOptionalNumber(executedUsdc) || 0);
  if (normalizeLowerText(action && action.tokenSide) === 'yes') {
    projected.yesShares = round(
      normalizeLowerText(action && action.orderSide) === 'sell'
        ? Math.max(0, (toOptionalNumber(projected.yesShares) || 0) - shares)
        : (toOptionalNumber(projected.yesShares) || 0) + shares,
      6,
    ) || 0;
    if (toOptionalNumber(projected.yesUsdc) !== null || usdc > 0) {
      projected.yesUsdc = round(
        normalizeLowerText(action && action.orderSide) === 'sell'
          ? Math.max(0, (toOptionalNumber(projected.yesUsdc) || 0) - usdc)
          : (toOptionalNumber(projected.yesUsdc) || 0) + usdc,
        6,
      ) || 0;
    }
  } else {
    projected.noShares = round(
      normalizeLowerText(action && action.orderSide) === 'sell'
        ? Math.max(0, (toOptionalNumber(projected.noShares) || 0) - shares)
        : (toOptionalNumber(projected.noShares) || 0) + shares,
      6,
    ) || 0;
    if (toOptionalNumber(projected.noUsdc) !== null || usdc > 0) {
      projected.noUsdc = round(
        normalizeLowerText(action && action.orderSide) === 'sell'
          ? Math.max(0, (toOptionalNumber(projected.noUsdc) || 0) - usdc)
          : (toOptionalNumber(projected.noUsdc) || 0) + usdc,
        6,
      ) || 0;
    }
  }
  if (toOptionalNumber(projected.yesUsdc) !== null || toOptionalNumber(projected.noUsdc) !== null) {
    projected.netUsdc = round((toOptionalNumber(projected.yesUsdc) || 0) - (toOptionalNumber(projected.noUsdc) || 0), 6) || 0;
  }
  projected.updatedAt = toRuntimeTimestamp(timestamp);
  return projected;
}

function normalizeTradeRecord(trade, pairContext, options = {}) {
  const amountUsdc = toUsdcAmount(trade && trade.collateralAmount);
  const amountShares = toTokenAmount(trade && (trade.tokenAmountOut || trade.tokenAmount));
  const orderSide = normalizeLowerText(trade && trade.tradeType);
  const tokenSide = normalizeLowerText(trade && trade.side);
  const expectedRevenueUsdc = amountUsdc !== null
    ? round((amountUsdc * normalizeMarketFeeBps(options)) / 10_000, 6)
    : null;
  const normalized = normalizeConfirmedTradeFromLog({
    id: normalizeOptionalString(trade && trade.id) || normalizeOptionalString(trade && trade.txHash),
    walletAddress: normalizeOptionalString(trade && trade.trader),
    marketAddress: normalizeOptionalString(trade && trade.marketAddress),
    orderSide,
    tokenSide,
    amountUsdc,
    amountShares,
    feeUsdc: toUsdcAmount(trade && trade.feeAmount),
    expectedRevenueUsdc,
    timestamp: trade && trade.timestamp ? Number(trade.timestamp) : null,
    transactionHash: normalizeOptionalString(trade && trade.txHash),
    source: 'pandora.indexer',
    venue: 'pandora',
    protocol: 'pandora',
    marketType: 'amm',
  });
  normalized.id = normalizeOptionalString(trade && trade.id) || normalized.canonicalKey;
  normalized.cursor = normalizeOptionalString(trade && trade.id) || normalizeOptionalString(trade && trade.txHash);
  normalized.marketPairId = pairContext.marketPairIdentity.marketPairId;
  normalized.pandoraMarketAddress = pairContext.marketPairIdentity.pandoraMarketAddress;
  normalized.polymarketMarketId = pairContext.marketPairIdentity.polymarketMarketId;
  normalized.polymarketSlug = pairContext.marketPairIdentity.polymarketSlug;
  return normalized;
}

async function fetchConfirmedTrades(options = {}, pairContext = {}, state = {}) {
  const seenIds = new Set(
    (Array.isArray(state.confirmedExposureLedger) ? state.confirmedExposureLedger : [])
      .map((entry) => normalizeOptionalString(entry && (entry.id || entry.cursor || entry.transactionHash)))
      .filter(Boolean),
  );
  const normalizedEntries = [];
  let diagnostics = [];
  if (Array.isArray(options.confirmedTrades)) {
    for (const trade of options.confirmedTrades) {
      const normalized = normalizeTradeRecord(trade, pairContext, options);
      if (!normalized || !normalized.id || seenIds.has(normalized.id)) continue;
      seenIds.add(normalized.id);
      normalizedEntries.push(normalized);
    }
  } else if (options.indexerUrl) {
    try {
      const client = createIndexerClient(options.indexerUrl, options.timeoutMs);
      const page = await client.list({
        queryName: 'tradess',
        filterType: 'tradesFilter',
        fields: [
          'id',
          'marketAddress',
          'trader',
          'side',
          'tradeType',
          'collateralAmount',
          'tokenAmount',
          'tokenAmountOut',
          'feeAmount',
          'timestamp',
          'txHash',
        ],
        variables: {
          where: {
            marketAddress: pairContext.marketPairIdentity.pandoraMarketAddress,
          },
          orderBy: 'timestamp',
          orderDirection: 'desc',
          limit: normalizeTradeLimit(options),
        },
      });
      const items = Array.isArray(page && page.items) ? page.items.slice().reverse() : [];
      for (const trade of items) {
        const normalized = normalizeTradeRecord(trade, pairContext, options);
        if (!normalized || !normalized.id || seenIds.has(normalized.id)) continue;
        seenIds.add(normalized.id);
        normalizedEntries.push(normalized);
      }
    } catch (err) {
      diagnostics = mergeDiagnostics(diagnostics, [
        `Unable to fetch recent Pandora trades from the indexer: ${err && err.message ? err.message : String(err)}`,
      ]);
    }
  }
  return {
    trades: normalizedEntries,
    diagnostics,
  };
}

function buildInventorySnapshot(summary, sourceMarket) {
  if (!summary || typeof summary !== 'object') return null;
  const yesShares = toOptionalNumber(summary.yesBalance);
  const noShares = toOptionalNumber(summary.noBalance);
  const yesPrice = toOptionalNumber(summary.prices && summary.prices.yes);
  const noPrice = toOptionalNumber(summary.prices && summary.prices.no);
  const yesUsdc = yesShares !== null && yesPrice !== null ? round(yesShares * yesPrice, 6) : null;
  const noUsdc = noShares !== null && noPrice !== null ? round(noShares * noPrice, 6) : null;
  const netUsdc = yesUsdc !== null || noUsdc !== null
    ? round((yesUsdc || 0) - (noUsdc || 0), 6)
    : null;
  return {
    adoptedAt: new Date().toISOString(),
    status: 'observed',
    source: normalizeOptionalString(summary.source && summary.source.resolved) || 'polymarket',
    inventoryAddress: normalizeOptionalString(summary.walletAddress),
    walletAddress: normalizeOptionalString(summary.walletAddress),
    marketId: normalizeOptionalString(summary.marketId || (sourceMarket && sourceMarket.marketId)),
    slug: normalizeOptionalString(summary.slug || (sourceMarket && sourceMarket.slug)),
    yesShares,
    noShares,
    yesUsdc,
    noUsdc,
    netUsdc,
    estimatedValueUsdc: toOptionalNumber(summary.estimatedValueUsd),
    openOrdersCount: toOptionalNumber(summary.openOrdersCount),
    diagnostics: Array.isArray(summary.diagnostics) ? summary.diagnostics.slice() : [],
  };
}

async function fetchManagedInventory(options = {}, sourceMarket) {
  const walletAddress = normalizeOptionalString(options.funder || process.env.POLYMARKET_FUNDER);
  if (!walletAddress && !options.adoptExistingPositions) {
    return {
      snapshot: null,
      diagnostics: [],
    };
  }
  try {
    const summary = await fetchPolymarketPositionSummary({
      host: options.polymarketHost,
      mockUrl: options.polymarketMockUrl,
      privateKey: options.privateKey || process.env.POLYMARKET_PRIVATE_KEY || null,
      funder: options.funder || process.env.POLYMARKET_FUNDER || null,
      apiKey: options.apiKey || process.env.POLYMARKET_API_KEY || null,
      apiSecret: options.apiSecret || process.env.POLYMARKET_API_SECRET || null,
      apiPassphrase: options.apiPassphrase || process.env.POLYMARKET_API_PASSPHRASE || null,
      walletAddress,
      market: sourceMarket,
      timeoutMs: options.timeoutMs,
    });
    return {
      snapshot: buildInventorySnapshot(summary, sourceMarket),
      diagnostics: Array.isArray(summary && summary.diagnostics) ? summary.diagnostics : [],
    };
  } catch (err) {
    return {
      snapshot: null,
      diagnostics: [`Unable to read Polymarket managed inventory: ${err && err.message ? err.message : String(err)}`],
    };
  }
}

function buildDeferredQueueEntry(trade, reasonCode, reason, amountUsdc) {
  return {
    id: `${normalizeOptionalString(trade && (trade.id || trade.cursor || trade.transactionHash || trade.canonicalKey)) || Date.now().toString(36)}:${reasonCode}`,
    queueKey: normalizeOptionalString(trade && (trade.queueKey || trade.canonicalKey || trade.id || trade.cursor || trade.transactionHash)),
    status: 'queued',
    marketPairId: normalizeOptionalString(trade && trade.marketPairId),
    side: normalizeOptionalString(trade && trade.direction),
    tokenSide: normalizeOptionalString(trade && trade.tokenSide),
    orderSide: normalizeOptionalString(trade && trade.orderSide),
    amountUsdc: roundUsdc(amountUsdc),
    amountShares: round(toOptionalNumber(trade && trade.amountShares) || 0, 6) || 0,
    targetUsdc: roundUsdc(amountUsdc),
    targetShares: round(toOptionalNumber(trade && trade.amountShares) || 0, 6) || 0,
    source: normalizeOptionalString(trade && trade.source) || 'mirror-hedge',
    reason: normalizeOptionalString(reasonCode) || 'unspecified',
    notes: normalizeOptionalString(reason),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function incrementSkippedCounters(counters, trade, reasonCode) {
  const next = {
    totalUsdc: round(((counters && counters.totalUsdc) || 0) + (toOptionalNumber(trade && trade.amountUsdc) || 0), 6),
    yesUsdc: round(((counters && counters.yesUsdc) || 0) + (normalizeLowerText(trade && trade.tokenSide) === 'yes' ? (toOptionalNumber(trade && trade.amountUsdc) || 0) : 0), 6),
    noUsdc: round(((counters && counters.noUsdc) || 0) + (normalizeLowerText(trade && trade.tokenSide) === 'no' ? (toOptionalNumber(trade && trade.amountUsdc) || 0) : 0), 6),
    count: Number((counters && counters.count) || 0) + 1,
    byReason: { ...((counters && counters.byReason) || {}) },
    bySide: { ...((counters && counters.bySide) || {}) },
  };
  const normalizedReason = normalizeOptionalString(reasonCode) || 'unspecified';
  const normalizedSide = normalizeOptionalString(trade && trade.tokenSide) || 'unknown';
  next.byReason[normalizedReason] = round((next.byReason[normalizedReason] || 0) + (toOptionalNumber(trade && trade.amountUsdc) || 0), 6);
  next.bySide[normalizedSide] = round((next.bySide[normalizedSide] || 0) + (toOptionalNumber(trade && trade.amountUsdc) || 0), 6);
  return next;
}

function mapConfirmedTradeToLedgerEntry(trade, pairContext, targetTransition = null) {
  const sign = normalizeLowerText(trade && trade.orderSide) === 'sell' ? -1 : 1;
  return {
    id: normalizeOptionalString(trade && trade.id) || normalizeOptionalString(trade && trade.cursor) || normalizeOptionalString(trade && trade.transactionHash),
    status: 'confirmed',
    marketPairId: pairContext.marketPairIdentity.marketPairId,
    pandoraMarketAddress: pairContext.marketPairIdentity.pandoraMarketAddress,
    polymarketMarketId: pairContext.marketPairIdentity.polymarketMarketId,
    polymarketSlug: pairContext.marketPairIdentity.polymarketSlug,
    side: normalizeOptionalString(trade && trade.direction),
    tokenSide: normalizeOptionalString(trade && trade.tokenSide),
    orderSide: normalizeOptionalString(trade && trade.orderSide),
    amountUsdc: roundUsdc(trade && trade.amountUsdc),
    amountShares: round(toOptionalNumber(trade && trade.amountShares) || 0, 6) || 0,
    deltaUsdc: round(sign * (toOptionalNumber(trade && trade.amountUsdc) || 0), 6),
    exposureUsdc: round(sign * (toOptionalNumber(trade && trade.amountUsdc) || 0), 6),
    yesTargetDeltaShares: targetTransition ? targetTransition.yesTargetDeltaShares : 0,
    noTargetDeltaShares: targetTransition ? targetTransition.noTargetDeltaShares : 0,
    expectedRevenueUsdc: roundUsdc(trade && trade.expectedRevenueUsdc),
    cursor: normalizeOptionalString(trade && trade.cursor),
    transactionHash: normalizeOptionalString(trade && trade.transactionHash),
    source: normalizeOptionalString(trade && trade.source) || 'pandora.indexer',
    confirmedAt: normalizeOptionalString(trade && (trade.confirmedAt || trade.timestamp)),
    targetBefore: targetTransition ? cloneJson(targetTransition.before) : null,
    targetAfter: targetTransition ? cloneJson(targetTransition.after) : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function mapPendingTradeToOverlay(trade, pairContext, queueEntry, finalityReason = null) {
  return {
    txHash: normalizeOptionalString(trade && trade.transactionHash) || normalizeOptionalString(trade && trade.txHash),
    status: finalityReason ? 'finalized' : 'seen',
    marketPairId: pairContext.marketPairIdentity.marketPairId,
    pandoraMarketAddress: pairContext.marketPairIdentity.pandoraMarketAddress,
    polymarketMarketId: pairContext.marketPairIdentity.polymarketMarketId,
    polymarketSlug: pairContext.marketPairIdentity.polymarketSlug,
    side: normalizeOptionalString(trade && trade.direction),
    tokenSide: normalizeOptionalString(trade && trade.tokenSide),
    orderSide: normalizeOptionalString(trade && trade.orderSide),
    amountUsdc: roundUsdc(trade && trade.amountUsdc),
    expectedHedgeDeltaUsdc: roundUsdc(trade && trade.amountUsdc),
    cursor: normalizeOptionalString(trade && trade.cursor) || normalizeOptionalString(trade && trade.canonicalKey),
    transactionHash: normalizeOptionalString(trade && trade.transactionHash) || normalizeOptionalString(trade && trade.txHash),
    source: normalizeOptionalString(trade && trade.source) || 'pandora.pending',
    reason: queueEntry ? normalizeOptionalString(queueEntry.reason) : null,
    notes: queueEntry ? normalizeOptionalString(queueEntry.notes) : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finalityReason,
  };
}

async function buildExecutionObservation(options = {}, pairContext = {}, state = {}) {
  const diagnostics = [];
  const auditEntries = [];
  const confirmedExposureLedger = [];
  const deferredHedgeQueue = [];
  const pendingMempoolOverlays = [];
  const previousDeferredHedgeQueue = Array.isArray(state.deferredHedgeQueue) ? state.deferredHedgeQueue.slice() : [];
  const deferredQueueStaleAgeMs = resolveDeferredQueueStaleAgeMs(options);
  let skippedVolumeCounters = null;
  let lastObservedTrade = undefined;
  let lastHedgeSignal = undefined;
  let lastSuccessfulHedge = null;
  let lastError = null;
  let belowThresholdPendingUsdc = 0;
  const retryTelemetryDelta = {
    sellAttemptedCount: 0,
    sellBlockedCount: 0,
    sellFailedCount: 0,
    sellRecoveredCount: 0,
    lastAttemptAt: null,
    lastBlockedAt: null,
    lastBlockedReasonCode: null,
    lastBlockedReason: null,
    lastFailureAt: null,
    lastFailureCode: null,
    lastFailureMessage: null,
    lastRecoveryAt: null,
  };

  function findPreviousDeferredEntry(entry = {}) {
    const queueKey = getDeferredQueueKey(entry);
    if (!queueKey) return null;
    return previousDeferredHedgeQueue.find((candidate) => getDeferredQueueKey(candidate) === queueKey) || null;
  }

  function queueDeferredEntry(entry, metadata = {}) {
    const prepared = sanitizeDeferredQueueEntry(entry);
    if (!prepared.entry) return null;
    const previousEntry = findPreviousDeferredEntry(prepared.entry);
    if (previousEntry && normalizeOptionalString(previousEntry.createdAt)) {
      prepared.entry.createdAt = previousEntry.createdAt;
    }
    const queueAgeMs = computeDeferredQueueAgeMs(prepared.entry);
    if (queueAgeMs !== null && queueAgeMs >= deferredQueueStaleAgeMs) {
      auditEntries.push({
        kind: 'queue-entry-expired',
        tradeId: prepared.entry.id,
        reasonCode: 'stale-retry-expired',
        reason: `Deferred hedge retry exceeded the stale age threshold (${deferredQueueStaleAgeMs} ms) and was dropped so the next cycle can recompute from live gap.`,
        tokenSide: prepared.entry.tokenSide,
        orderSide: prepared.entry.orderSide,
        ageMs: queueAgeMs,
      });
      diagnostics.push(
        `Expired stale deferred ${prepared.entry.side || prepared.entry.id || 'hedge'} retry after ${queueAgeMs} ms and will recompute from live gap next cycle.`,
      );
      return null;
    }
    deferredHedgeQueue.push(prepared.entry);
    if (prepared.strippedFields.length > 0) {
      auditEntries.push({
        kind: 'deferred-queue-sanitized',
        tradeId: prepared.entry.id,
        reasonCode: 'retry-metadata-sanitized',
        reason: normalizeOptionalString(metadata.reason)
          || describeDeferredQueueSizingIssue(prepared.original, prepared.strippedFields),
        tokenSide: prepared.entry.tokenSide,
        orderSide: prepared.entry.orderSide,
        strippedFields: prepared.strippedFields.slice(),
        originalAmountUsdc: prepared.original.amountUsdc,
        originalAmountShares: prepared.original.amountShares,
        originalTargetUsdc: prepared.original.targetUsdc,
        originalTargetShares: prepared.original.targetShares,
      });
    }
    return prepared.entry;
  }

  function recordSellAttempt(action, depthCheck = null) {
    const timestamp = new Date().toISOString();
    retryTelemetryDelta.sellAttemptedCount += 1;
    retryTelemetryDelta.lastAttemptAt = timestamp;
    auditEntries.push({
      kind: 'sell-action-attempted',
      tradeId: action.queueKey,
      reasonCode: 'sell-retry-attempted',
      reason: 'Attempting to reduce excess hedge inventory before any buy-side expansion.',
      amountUsdc: action.amountUsdc,
      amountShares: action.amountShares,
      tokenSide: action.tokenSide,
      orderSide: action.orderSide,
      depthSnapshot: buildDepthAuditSnapshot(depthCheck),
    });
  }

  function recordSellBlocked(action, reasonCode, reason, depthCheck = null) {
    const timestamp = new Date().toISOString();
    retryTelemetryDelta.sellBlockedCount += 1;
    retryTelemetryDelta.lastBlockedAt = timestamp;
    retryTelemetryDelta.lastBlockedReasonCode = normalizeOptionalString(reasonCode);
    retryTelemetryDelta.lastBlockedReason = normalizeOptionalString(reason);
    auditEntries.push({
      kind: 'sell-action-blocked',
      tradeId: action.queueKey,
      reasonCode,
      reason,
      amountUsdc: action.amountUsdc,
      amountShares: action.amountShares,
      tokenSide: action.tokenSide,
      orderSide: action.orderSide,
      depthSnapshot: buildDepthAuditSnapshot(depthCheck),
    });
  }

  function recordSellFailure(action, orderResult, depthCheck = null) {
    const timestamp = new Date().toISOString();
    const failureCode = normalizeOptionalString(
      orderResult && orderResult.error && (orderResult.error.code || orderResult.error.message),
    ) || 'execution-failed';
    const failureMessage = normalizeOptionalString(
      orderResult && orderResult.error && orderResult.error.message,
    ) || 'Polymarket execution failed.';
    retryTelemetryDelta.sellFailedCount += 1;
    retryTelemetryDelta.lastFailureAt = timestamp;
    retryTelemetryDelta.lastFailureCode = failureCode;
    retryTelemetryDelta.lastFailureMessage = failureMessage;
    auditEntries.push({
      kind: 'sell-action-failed',
      tradeId: action.queueKey,
      reasonCode: failureCode,
      reason: failureMessage,
      amountUsdc: action.amountUsdc,
      amountShares: action.amountShares,
      tokenSide: action.tokenSide,
      orderSide: action.orderSide,
      depthSnapshot: buildDepthAuditSnapshot(depthCheck),
      exchangeError: cloneJson(orderResult && (orderResult.error || orderResult.response || null)),
    });
  }

  const depth = pairContext.sourceMarket
    ? await fetchDepthForMarket(pairContext.sourceMarket, {
        host: options.polymarketHost,
        mockUrl: options.polymarketMockUrl,
        timeoutMs: options.timeoutMs,
        slippageBps: options.depthSlippageBps,
      }).catch((err) => {
        diagnostics.push(`Unable to fetch Polymarket orderbook depth: ${err && err.message ? err.message : String(err)}`);
        return null;
      })
    : null;
  const inventoryResult = await fetchManagedInventory(options, pairContext.sourceMarket);
  diagnostics.push(...inventoryResult.diagnostics);
  const observedInventorySnapshot = inventoryResult.snapshot || state.managedPolymarketInventorySnapshot || null;
  let projectedInventorySnapshot = buildProjectedInventorySnapshot(observedInventorySnapshot, new Date());
  let targetHedgeInventory = initializeTargetInventory(state, observedInventorySnapshot, {
    adoptExistingPositions: options.adoptExistingPositions,
    now: new Date(),
  });
  let availableHedgeFeeBudgetUsdc = round(toOptionalNumber(state.availableHedgeFeeBudgetUsdc) || 0, 6) || 0;
  let latestHedgeEligibleTrade = null;

  const confirmedResult = await fetchConfirmedTrades(options, pairContext, state);
  diagnostics.push(...confirmedResult.diagnostics);
  for (const trade of confirmedResult.trades) {
    const internalWallet = shouldSkipInternalWallet(trade, {
      internalWallets: pairContext.internalWallets.wallets,
    });
    let targetTransition = {
      before: ensureTargetHedgeInventoryShape(targetHedgeInventory),
      after: ensureTargetHedgeInventoryShape(targetHedgeInventory),
      yesTargetDeltaShares: 0,
      noTargetDeltaShares: 0,
      deltaSharesSigned: 0,
    };

    if (internalWallet.skipped) {
      skippedVolumeCounters = incrementSkippedCounters(skippedVolumeCounters, trade, internalWallet.reasonCode);
    } else {
      targetTransition = applyTradeToTargetInventory(targetHedgeInventory, trade, new Date());
      targetHedgeInventory = targetTransition.after;
      availableHedgeFeeBudgetUsdc = round(
        availableHedgeFeeBudgetUsdc + (toOptionalNumber(trade.expectedRevenueUsdc) || 0),
        6,
      ) || 0;
    }

    lastObservedTrade = buildObservedTradeTelemetry(trade, pairContext, {
      hedgeEligible: !internalWallet.skipped,
      reason: internalWallet.skipped ? internalWallet.reasonCode : 'external-trade',
    });
    if (!internalWallet.skipped) {
      latestHedgeEligibleTrade = lastObservedTrade;
    }

    const ledgerEntry = mapConfirmedTradeToLedgerEntry(trade, pairContext, targetTransition);
    ledgerEntry.reason = internalWallet.skipped ? internalWallet.reasonCode : 'external-trade';
    confirmedExposureLedger.push(ledgerEntry);
    auditEntries.push({
      kind: internalWallet.skipped ? 'ignored-internal-trade' : 'target-updated',
      tradeId: trade.id,
      reasonCode: internalWallet.skipped ? internalWallet.reasonCode : 'external-trade',
      reason: internalWallet.skipped ? internalWallet.reason : 'Confirmed external trade updated the target hedge inventory.',
      amountUsdc: trade.amountUsdc,
      amountShares: trade.amountShares,
      targetBefore: cloneJson(targetTransition.before),
      targetAfter: cloneJson(targetTransition.after),
    });
  }

  const pendingTrades = Array.isArray(options.pendingTrades) ? options.pendingTrades : [];
  for (const pendingTradeInput of pendingTrades) {
    const pendingTrade = decodePendingPandoraTrade(pendingTradeInput, {
      marketAddress: pairContext.marketPairIdentity.pandoraMarketAddress,
      polymarketMarketId: pairContext.marketPairIdentity.polymarketMarketId,
      polymarketSlug: pairContext.marketPairIdentity.polymarketSlug,
      venue: 'pandora',
      protocol: 'pandora',
      marketType: 'amm',
    });
    const classification = classifyMirrorHedgeExecution(pendingTrade, {
      internalWallets: pairContext.internalWallets.wallets,
      minHedgeUsdc: pairContext.minHedgeUsdc,
      partialPolicy: pairContext.partialPolicy,
      sellPolicy: pairContext.sellPolicy,
      mutationVenue: 'polymarket',
      liveMutation: false,
      depth,
      expectedRevenueUsdc: pendingTrade.expectedRevenueUsdc || (pendingTrade.amountUsdc ? round((pendingTrade.amountUsdc * normalizeMarketFeeBps(options)) / 10_000, 6) : null),
    });
    let queueEntry = null;
    if (classification.queue && classification.queue.entry) {
      queueEntry = queueDeferredEntry(classification.queue.entry);
    } else if (classification.status === 'skip' && classification.reasonCode !== 'internal-wallet') {
      queueEntry = buildDeferredQueueEntry(
        pendingTrade,
        classification.reasonCode || 'pending-review',
        classification.reason || 'Pending hedge requires review.',
        pendingTrade.amountUsdc,
      );
      queueEntry = queueDeferredEntry(queueEntry);
    }
    pendingMempoolOverlays.push(mapPendingTradeToOverlay(pendingTrade, pairContext, queueEntry));
    auditEntries.push({
      kind: 'mempool-pre-hedge-seen',
      tradeId: pendingTrade.id || pendingTrade.canonicalKey,
      reasonCode: classification.reasonCode,
      reason: classification.reason,
      amountUsdc: pendingTrade.amountUsdc,
    });
  }

  const pendingOutcomes = Array.isArray(options.pendingOutcomes) ? options.pendingOutcomes : [];
  for (const outcome of pendingOutcomes) {
    const reconciliation = reconcileMempoolConfirmRevert(outcome, {
      mutationVenue: 'polymarket',
    });
    auditEntries.push({
      kind: reconciliation.confirmed ? 'mempool-pre-hedge-confirmed' : reconciliation.reverted ? 'mempool-pre-hedge-reverted' : 'mempool-pre-hedge-updated',
      tradeId: reconciliation.canonicalKey,
      reasonCode: reconciliation.status,
      amountUsdc: reconciliation.residualUsdc || 0,
    });
    if (reconciliation.shouldRestoreResidualExposure && reconciliation.residualUsdc > 0) {
      queueDeferredEntry({
        id: `${reconciliation.queueKey}:revert`,
        status: 'queued',
        marketPairId: pairContext.marketPairIdentity.marketPairId,
        amountUsdc: reconciliation.residualUsdc,
        targetUsdc: reconciliation.residualUsdc,
        source: 'mempool-revert',
        reason: 'pending-reverted',
        notes: 'Pending hedge reverted and residual exposure was restored.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  async function processInventoryGapAction(action, executionOptions = {}) {
    const tradeLike = buildTradeForGapAction(action);
    if (action.orderSide === 'sell') {
      recordSellAttempt(action);
    }
    if (action.orderSide === 'sell' && pairContext.sellPolicy === 'manual-only') {
      const queueEntry = buildQueueEntryForAction(
        action,
        'sell-policy-manual-only',
        'Sell-side hedge reduction is configured for manual handling only.',
        action.amountShares,
        action.amountUsdc,
      );
      queueDeferredEntry(queueEntry);
      auditEntries.push({
        kind: 'queued',
        tradeId: action.queueKey,
        reasonCode: 'sell-policy-manual-only',
        reason: queueEntry.notes,
        amountUsdc: action.amountUsdc,
        amountShares: action.amountShares,
      });
      recordSellBlocked(action, 'sell-policy-manual-only', queueEntry.notes);
      return { blockedBuys: true };
    }

    if (action.orderSide === 'buy' && action.amountUsdc < pairContext.minHedgeUsdc) {
      belowThresholdPendingUsdc = round(belowThresholdPendingUsdc + action.amountUsdc, 6) || 0;
      auditEntries.push({
        kind: 'below-threshold-gap',
        tradeId: action.queueKey,
        reasonCode: 'below-threshold-gap',
        reason: 'Net hedge adjustment is below the configured execution threshold.',
        amountUsdc: action.amountUsdc,
        amountShares: action.amountShares,
      });
      return { blockedBuys: false };
    }

    const depthCheck = evaluateDepthCheck(tradeLike, depth || {}, {
      allowDepthlessExecution: false,
      partialPolicy: pairContext.partialPolicy,
    });
    const sellPolicy = evaluateDepthCheckedSellPolicy(tradeLike, depthCheck, {
      requireSellDepthProof: true,
    });
    if (action.orderSide === 'sell') {
      auditEntries.push({
        kind: 'sell-depth-evaluated',
        tradeId: action.queueKey,
        reasonCode: sellPolicy.reasonCode || depthCheck.status || 'sell-depth-evaluated',
        reason: sellPolicy.reason || 'Sell-side depth evaluated.',
        amountUsdc: action.amountUsdc,
        amountShares: action.amountShares,
        depthSnapshot: buildDepthAuditSnapshot(depthCheck),
      });
    }
    if (!sellPolicy.passed) {
      const queueEntry = buildQueueEntryForAction(
        action,
        sellPolicy.reasonCode,
        sellPolicy.reason,
        action.amountShares,
        action.amountUsdc,
      );
      queueDeferredEntry(queueEntry);
      auditEntries.push({
        kind: 'queued',
        tradeId: action.queueKey,
        reasonCode: sellPolicy.reasonCode,
        reason: sellPolicy.reason,
        amountUsdc: action.amountUsdc,
        amountShares: action.amountShares,
      });
      if (action.orderSide === 'sell') {
        recordSellBlocked(action, sellPolicy.reasonCode, sellPolicy.reason, depthCheck);
      }
      return { blockedBuys: action.orderSide === 'sell' };
    }

    if (!depthCheck.depthKnown) {
      const queueEntry = buildQueueEntryForAction(
        action,
        'depth-unavailable',
        'Execution depth snapshot is unavailable and depthless execution is disabled.',
        action.amountShares,
        action.amountUsdc,
      );
      queueDeferredEntry(queueEntry);
      auditEntries.push({
        kind: 'queued',
        tradeId: action.queueKey,
        reasonCode: 'depth-unavailable',
        reason: queueEntry.notes,
        amountUsdc: action.amountUsdc,
        amountShares: action.amountShares,
      });
      if (action.orderSide === 'sell') {
        recordSellBlocked(action, 'depth-unavailable', queueEntry.notes, depthCheck);
      }
      return { blockedBuys: action.orderSide === 'sell' };
    }

    const estimatedExecutionFeeUsdc = estimateExecutionCostUsdc(options, action);
    if (action.orderSide === 'buy' && estimatedExecutionFeeUsdc > availableHedgeFeeBudgetUsdc) {
      const queueEntry = buildQueueEntryForAction(
        action,
        'fee-budget-exhausted',
        'Estimated hedge execution fee exceeds the available accumulated fee budget.',
        action.amountShares,
        action.amountUsdc,
      );
      queueDeferredEntry(queueEntry);
      auditEntries.push({
        kind: 'queued',
        tradeId: action.queueKey,
        reasonCode: 'fee-budget-exhausted',
        reason: queueEntry.notes,
        amountUsdc: action.amountUsdc,
        amountShares: action.amountShares,
      });
      return { blockedBuys: false };
    }

    const fillPolicy = evaluatePartialVsSkipPolicy(tradeLike, depthCheck, {
      partialPolicy: pairContext.partialPolicy,
      allowDepthlessExecution: false,
    });
    if (fillPolicy.status === 'skip') {
      const queueEntry = buildQueueEntryForAction(
        action,
        fillPolicy.reasonCode,
        fillPolicy.reason,
        action.amountShares,
        action.amountUsdc,
      );
      queueDeferredEntry(queueEntry);
      auditEntries.push({
        kind: 'queued',
        tradeId: action.queueKey,
        reasonCode: fillPolicy.reasonCode,
        reason: queueEntry.notes,
        amountUsdc: action.amountUsdc,
        amountShares: action.amountShares,
      });
      if (action.orderSide === 'sell') {
        recordSellBlocked(action, fillPolicy.reasonCode, queueEntry.notes, depthCheck);
      }
      return { blockedBuys: action.orderSide === 'sell' };
    }

    const allowedShares = deriveAllowedShares(action, fillPolicy, depthCheck);
    const allowedUsdc = round(toOptionalNumber(fillPolicy.allowedUsdc) || 0, 6) || 0;
    const residualShares = round(Math.max(0, (toOptionalNumber(action.amountShares) || 0) - allowedShares), 6) || 0;
    const residualUsdc = round(Math.max(0, (toOptionalNumber(action.amountUsdc) || 0) - allowedUsdc), 6) || 0;
    if (!(allowedUsdc > 0) || !(allowedShares > 0)) {
      const reasonCode = fillPolicy.status === 'partial' ? 'non-executable-partial' : 'invalid-hedge-amount';
      const reason = fillPolicy.status === 'partial'
        ? 'Depth returned no executable notional after partial-fill sizing; keeping the hedge queued for recompute.'
        : 'Computed hedge amount is non-positive after sizing; skipping live execution and forcing the next cycle to recompute from the live gap.';
      auditEntries.push({
        kind: 'queue-entry-suppressed',
        tradeId: action.queueKey,
        reasonCode,
        reason,
        amountUsdc: action.amountUsdc,
        amountShares: action.amountShares,
      });
      if (action.orderSide === 'sell') {
        recordSellBlocked(action, reasonCode, reason, depthCheck);
      }
      return { blockedBuys: action.orderSide === 'sell' };
    }
    if (residualShares > 0 || residualUsdc > 0) {
      queueDeferredEntry(buildQueueEntryForAction(
        action,
        'residual-exposure',
        'Residual hedge exposure remains queued after a partial fill.',
        residualShares,
        residualUsdc,
      ));
      if (action.orderSide === 'sell') {
        recordSellBlocked(
          action,
          'residual-exposure',
          'Residual hedge exposure remains queued after a partial fill.',
          depthCheck,
        );
      }
    }

    const tokenId = resolveActionTokenId(action.tokenSide, pairContext.sourceMarket);
    if (!tokenId) {
      const queueEntry = buildQueueEntryForAction(
        action,
        'missing-token-id',
        'Polymarket token id is unavailable for this market.',
        action.amountShares,
        action.amountUsdc,
      );
      queueDeferredEntry(queueEntry);
      auditEntries.push({
        kind: 'queued',
        tradeId: action.queueKey,
        reasonCode: 'missing-token-id',
        reason: queueEntry.notes,
        amountUsdc: action.amountUsdc,
        amountShares: action.amountShares,
      });
      if (action.orderSide === 'sell') {
        recordSellBlocked(action, 'missing-token-id', queueEntry.notes, depthCheck);
      }
      return { blockedBuys: action.orderSide === 'sell' };
    }

    if (options.executeLive) {
      const orderResult = await placeHedgeOrder({
        privateKey: options.privateKey || process.env.POLYMARKET_PRIVATE_KEY || null,
        funder: options.funder || process.env.POLYMARKET_FUNDER || null,
        apiKey: options.apiKey || process.env.POLYMARKET_API_KEY || null,
        apiSecret: options.apiSecret || process.env.POLYMARKET_API_SECRET || null,
        apiPassphrase: options.apiPassphrase || process.env.POLYMARKET_API_PASSPHRASE || null,
        host: options.polymarketHost,
        timeoutMs: options.timeoutMs,
        tokenId,
        side: action.orderSide,
        amountUsd: allowedUsdc,
        mockUrl: options.polymarketMockUrl,
      });
      if (!(orderResult && orderResult.ok)) {
        const queueEntry = buildQueueEntryForAction(
          action,
          'execution-failed',
          orderResult && orderResult.error && orderResult.error.message
            ? orderResult.error.message
            : 'Polymarket execution failed.',
          action.amountShares,
          action.amountUsdc,
        );
        queueDeferredEntry(queueEntry);
        lastError = {
          code: 'MIRROR_HEDGE_EXECUTION_FAILED',
          message: queueEntry.notes,
          at: new Date().toISOString(),
          amountUsdc: action.amountUsdc,
          details: {
            queueKey: action.queueKey,
            tokenSide: action.tokenSide,
            orderSide: action.orderSide,
            exchangeError: cloneJson(orderResult && (orderResult.error || orderResult.response || null)),
            depthSnapshot: buildDepthAuditSnapshot(depthCheck),
          },
        };
        auditEntries.push({
          kind: 'queued',
          tradeId: action.queueKey,
          reasonCode: 'execution-failed',
          reason: queueEntry.notes,
          amountUsdc: action.amountUsdc,
          amountShares: action.amountShares,
        });
        if (action.orderSide === 'sell') {
          recordSellFailure(action, orderResult, depthCheck);
        }
        return { blockedBuys: action.orderSide === 'sell' };
      }
      lastSuccessfulHedge = {
        hedgeId: action.queueKey,
        status: fillPolicy.status === 'partial' ? 'partial' : 'completed',
        executedAt: new Date().toISOString(),
        amountUsdc: allowedUsdc,
        tokenSide: action.tokenSide,
        orderSide: action.orderSide,
        txHash: orderResult.response && orderResult.response.hash ? orderResult.response.hash : null,
        source: 'polymarket',
        reason: fillPolicy.reasonCode || 'inventory-gap',
      };
    }

    projectedInventorySnapshot = updateProjectedInventorySnapshot(
      projectedInventorySnapshot,
      action,
      allowedShares,
      allowedUsdc,
      new Date(),
    );
    if (action.orderSide === 'buy' && options.executeLive) {
      availableHedgeFeeBudgetUsdc = round(Math.max(0, availableHedgeFeeBudgetUsdc - estimatedExecutionFeeUsdc), 6) || 0;
    }
    auditEntries.push({
      kind: options.executeLive
        ? (fillPolicy.status === 'partial' ? 'partial-hedge-executed' : 'hedge-executed')
        : (fillPolicy.status === 'partial' ? 'partial-hedge-planned' : 'hedge-planned'),
      tradeId: action.queueKey,
      reasonCode: fillPolicy.reasonCode || 'inventory-gap',
      amountUsdc: allowedUsdc,
      amountShares: allowedShares,
      tokenSide: action.tokenSide,
      orderSide: action.orderSide,
    });
    lastHedgeSignal = buildHedgeSignalTelemetry(
      action,
      fillPolicy,
      latestHedgeEligibleTrade,
      new Date(),
      {
        executeLive: Boolean(options.executeLive),
        amountUsdc: allowedUsdc,
        amountShares: allowedShares,
      },
    );
    return {
      blockedBuys: action.orderSide === 'sell' && (residualShares > 0 || residualUsdc > 0),
    };
  }

  let gap = buildGapShares(targetHedgeInventory, projectedInventorySnapshot);
  const sellActions = [];
  if (gap.excessYesToSell > 0) {
    const referencePrice = getReferencePriceForSide('yes', depth, pairContext.sourceMarket, observedInventorySnapshot);
    sellActions.push({
      queueKey: `${pairContext.marketPairIdentity.marketPairId || pairContext.marketPairIdentity.pandoraMarketAddress}:sell-yes`,
      marketPairId: pairContext.marketPairIdentity.marketPairId,
      marketAddress: pairContext.marketPairIdentity.pandoraMarketAddress,
      marketId: pairContext.marketPairIdentity.polymarketMarketId,
      tokenSide: 'yes',
      orderSide: 'sell',
      direction: 'sell-yes',
      amountShares: gap.excessYesToSell,
      amountUsdc: round(gap.excessYesToSell * (referencePrice || 0), 6) || 0,
      referencePrice,
    });
  }
  if (gap.excessNoToSell > 0) {
    const referencePrice = getReferencePriceForSide('no', depth, pairContext.sourceMarket, observedInventorySnapshot);
    sellActions.push({
      queueKey: `${pairContext.marketPairIdentity.marketPairId || pairContext.marketPairIdentity.pandoraMarketAddress}:sell-no`,
      marketPairId: pairContext.marketPairIdentity.marketPairId,
      marketAddress: pairContext.marketPairIdentity.pandoraMarketAddress,
      marketId: pairContext.marketPairIdentity.polymarketMarketId,
      tokenSide: 'no',
      orderSide: 'sell',
      direction: 'sell-no',
      amountShares: gap.excessNoToSell,
      amountUsdc: round(gap.excessNoToSell * (referencePrice || 0), 6) || 0,
      referencePrice,
    });
  }

  let blockFurtherBuys = false;
  for (const action of sellActions) {
    const result = await processInventoryGapAction(action, { phase: 'sell' });
    if (result && result.blockedBuys) {
      blockFurtherBuys = true;
    }
  }

  if (!blockFurtherBuys) {
    gap = buildGapShares(targetHedgeInventory, projectedInventorySnapshot);
    const buyActions = [];
    if (gap.deficitYesToBuy > 0) {
      const referencePrice = getReferencePriceForSide('yes', depth, pairContext.sourceMarket, observedInventorySnapshot);
      buyActions.push({
        queueKey: `${pairContext.marketPairIdentity.marketPairId || pairContext.marketPairIdentity.pandoraMarketAddress}:buy-yes`,
        marketPairId: pairContext.marketPairIdentity.marketPairId,
        marketAddress: pairContext.marketPairIdentity.pandoraMarketAddress,
        marketId: pairContext.marketPairIdentity.polymarketMarketId,
        tokenSide: 'yes',
        orderSide: 'buy',
        direction: 'buy-yes',
        amountShares: gap.deficitYesToBuy,
        amountUsdc: round(gap.deficitYesToBuy * (referencePrice || 0), 6) || 0,
        referencePrice,
      });
    }
    if (gap.deficitNoToBuy > 0) {
      const referencePrice = getReferencePriceForSide('no', depth, pairContext.sourceMarket, observedInventorySnapshot);
      buyActions.push({
        queueKey: `${pairContext.marketPairIdentity.marketPairId || pairContext.marketPairIdentity.pandoraMarketAddress}:buy-no`,
        marketPairId: pairContext.marketPairIdentity.marketPairId,
        marketAddress: pairContext.marketPairIdentity.pandoraMarketAddress,
        marketId: pairContext.marketPairIdentity.polymarketMarketId,
        tokenSide: 'no',
        orderSide: 'buy',
        direction: 'buy-no',
        amountShares: gap.deficitNoToBuy,
        amountUsdc: round(gap.deficitNoToBuy * (referencePrice || 0), 6) || 0,
        referencePrice,
      });
    }
    for (const action of buyActions) {
      await processInventoryGapAction(action, { phase: 'buy' });
    }
  } else {
    const blockedGap = buildGapShares(targetHedgeInventory, projectedInventorySnapshot);
    if (blockedGap.deficitYesToBuy > 0 || blockedGap.deficitNoToBuy > 0) {
      auditEntries.push({
        kind: 'buy-phase-skipped',
        tradeId: pairContext.marketPairIdentity.marketPairId || pairContext.marketPairIdentity.pandoraMarketAddress,
        reasonCode: 'sell-phase-blocked',
        reason: 'Buy-side hedge expansion was skipped because sell-side reduction is still blocked or pending.',
        deficitYesToBuy: blockedGap.deficitYesToBuy,
        deficitNoToBuy: blockedGap.deficitNoToBuy,
      });
    }
  }

  const currentDeferredQueueKeys = new Set(
    deferredHedgeQueue
      .map((entry) => getDeferredQueueKey(entry))
      .filter(Boolean),
  );
  const currentDeferredQueueIds = new Set(
    deferredHedgeQueue
      .map((entry) => normalizeOptionalString(entry && entry.id))
      .filter(Boolean),
  );
  const recoveredDeferredEntries = previousDeferredHedgeQueue.filter(
    (entry) => {
      const queueKey = getDeferredQueueKey(entry);
      if (queueKey) {
        return !currentDeferredQueueKeys.has(queueKey);
      }
      return !currentDeferredQueueIds.has(normalizeOptionalString(entry && entry.id));
    },
  );
  const recoveredSellEntries = recoveredDeferredEntries.filter((entry) => isSellLikeQueueEntry(entry));
  if (recoveredDeferredEntries.length) {
    retryTelemetryDelta.sellRecoveredCount += recoveredSellEntries.length;
    retryTelemetryDelta.lastRecoveryAt = new Date().toISOString();
    for (const entry of recoveredDeferredEntries) {
      const invalidRecoveredEntry = isClearlyInvalidDeferredQueueEntry(entry);
      auditEntries.push({
        kind: 'deferred-queue-pruned',
        tradeId: entry.id,
        reasonCode: invalidRecoveredEntry ? 'invalid-stale-entry-pruned' : 'queue-recovered',
        reason: invalidRecoveredEntry
          ? 'Deferred queue entry was removed because its retry sizing was invalid and the daemon now recomputes from the live gap.'
          : 'Deferred queue entry was removed because the live exposure is no longer pending.',
        amountUsdc: entry.amountUsdc,
        amountShares: entry.amountShares,
        tokenSide: entry.tokenSide,
        orderSide: entry.orderSide,
      });
    }
    const invalidRecoveredCount = recoveredDeferredEntries.filter((entry) => isClearlyInvalidDeferredQueueEntry(entry)).length;
    if (invalidRecoveredCount > 0) {
      diagnostics.push(
        `Pruned ${invalidRecoveredCount} invalid deferred hedge entr${invalidRecoveredCount === 1 ? 'y' : 'ies'} and recomputed from live gap.`,
      );
    }
  }

  const retryTelemetry = buildNextRetryTelemetry(state.retryTelemetry, retryTelemetryDelta);

  const allProcessedTrades = confirmedResult.trades;
  const latestTrade = allProcessedTrades.length ? allProcessedTrades[allProcessedTrades.length - 1] : null;
  return {
    diagnostics,
    auditEntries,
    confirmedExposureLedger,
    pendingMempoolOverlays,
    deferredHedgeQueue,
    managedPolymarketInventorySnapshot: observedInventorySnapshot,
    targetHedgeInventory,
    availableHedgeFeeBudgetUsdc,
    belowThresholdPendingUsdc,
    skippedVolumeCounters,
    retryTelemetry,
    lastObservedTrade,
    lastHedgeSignal,
    lastSuccessfulHedge,
    lastError,
    lastProcessedBlockCursor: latestTrade
      ? {
          blockNumber: null,
          blockHash: null,
          cursor: normalizeOptionalString(latestTrade.cursor) || normalizeOptionalString(latestTrade.id),
          source: 'pandora.indexer',
          observedAt: new Date().toISOString(),
        }
      : null,
    lastProcessedLogCursor: latestTrade
      ? {
          blockNumber: null,
          logIndex: null,
          transactionHash: normalizeOptionalString(latestTrade.transactionHash),
          cursor: normalizeOptionalString(latestTrade.cursor) || normalizeOptionalString(latestTrade.id),
          source: 'pandora.indexer',
          observedAt: new Date().toISOString(),
        }
      : null,
  };
}

async function prepareHedgeContext(options = {}) {
  const selectorResolution = resolveSelectorsFromState(options);
  const selectors = {
    pandoraMarketAddress: selectorResolution.pandoraMarketAddress,
    polymarketMarketId: selectorResolution.polymarketMarketId,
    polymarketSlug: selectorResolution.polymarketSlug,
  };
  const internalWallets = loadInternalWalletConfig(options);
  const pair = await resolveHedgePair(options, selectors);
  const marketPairIdentity = {
    ...pair.marketPairIdentity,
    fingerprint: buildStrategyHashFromIdentity(pair.marketPairIdentity, internalWallets.fingerprint),
  };
  const strategyHash = normalizeOptionalString(options.strategyHash) || marketPairIdentity.fingerprint;
  const loaded = loadState(resolveStateFile({ ...options, strategyHash }), strategyHash);
  const state = createState(strategyHash, loaded.state);
  ensureStateIdentity(state, {
    ...options,
    marketPairIdentity,
    whitelistFingerprint: internalWallets.fingerprint,
  });
  const inventoryResult = await fetchManagedInventory(options, pair.sourceMarket);
  const initializedTargetInventory = initializeTargetInventory(state, inventoryResult.snapshot || state.managedPolymarketInventorySnapshot, {
    adoptExistingPositions: options.adoptExistingPositions,
    now: options.now,
  });
  const plan = planHedgeRuntime({
    state,
    now: options.now,
    marketPairIdentity,
    whitelistFingerprint: internalWallets.fingerprint,
    managedPolymarketInventorySnapshot: inventoryResult.snapshot || state.managedPolymarketInventorySnapshot,
    targetHedgeInventory: initializedTargetInventory,
    availableHedgeFeeBudgetUsdc: state.availableHedgeFeeBudgetUsdc,
    belowThresholdPendingUsdc: state.belowThresholdPendingUsdc,
  });
  return {
    stateFile: loaded.filePath,
    state,
    strategyHash,
    selectors,
    marketPairIdentity,
    verified: pair.verified,
    sourceMarket: pair.sourceMarket,
    internalWallets,
    inventorySnapshot: inventoryResult.snapshot,
    targetHedgeInventory: initializedTargetInventory,
    inventoryDiagnostics: inventoryResult.diagnostics,
    plan,
    minHedgeUsdc: normalizeMinHedgeUsdc(options),
    partialPolicy: normalizePartialPolicy(options),
    sellPolicy: normalizeSellPolicy(options),
  };
}

function buildCommonPayload(context, diagnostics = []) {
  return {
    schemaVersion: MIRROR_HEDGE_SERVICE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: null,
    stateFile: context.stateFile,
    strategyHash: context.strategyHash,
    selector: {
      pandoraMarketAddress: context.marketPairIdentity.pandoraMarketAddress,
      polymarketMarketId: context.marketPairIdentity.polymarketMarketId,
      polymarketSlug: context.marketPairIdentity.polymarketSlug,
    },
    pairValidation: context.verified,
    runtime: {
      status: context.state.runtimeStatus || 'idle',
    },
    diagnostics: mergeDiagnostics(
      diagnostics,
      context.inventoryDiagnostics,
      context.verified && context.verified.diagnostics,
      context.sourceMarket && context.sourceMarket.diagnostics,
    ),
  };
}

async function buildMirrorHedgePlan(options = {}) {
  const context = await prepareHedgeContext(options);
  const diagnostics = [];
  const liveRequirements = [];
  if (options.executeLive) {
    if (!normalizeOptionalString(options.privateKey || process.env.POLYMARKET_PRIVATE_KEY)) {
      liveRequirements.push('POLYMARKET_PRIVATE_KEY');
    }
    if (!normalizeOptionalString(options.funder || process.env.POLYMARKET_FUNDER)) {
      liveRequirements.push('POLYMARKET_FUNDER');
    }
  }
  const payload = buildCommonPayload(context, diagnostics);
  payload.mode = 'plan';
  payload.internalWallets = {
    filePath: context.internalWallets.filePath,
    count: context.internalWallets.count,
    fingerprint: context.internalWallets.fingerprint,
  };
  payload.plan = context.plan;
  payload.runtime.status = context.state.runtimeStatus || 'idle';
  payload.readiness = {
    liveReady: liveRequirements.length === 0,
    missingLiveRequirements: liveRequirements,
    supportedHosts: ['digitalocean-droplet', 'generic-vps'],
    unsupportedHosts: ['cloudflare-workers'],
  };
  return payload;
}

function buildBundleEnv(context, options = {}) {
  const lines = [
    `PANDORA_INTERNAL_WALLETS_FILE=${context.internalWallets.filePath}`,
    `PANDORA_HEDGE_MIN_USDC=${String(context.minHedgeUsdc)}`,
    `PANDORA_HEDGE_PARTIAL_POLICY=${context.partialPolicy}`,
    `PANDORA_HEDGE_SELL_POLICY=${context.sellPolicy}`,
    `PANDORA_DAEMON_PROVIDER=${normalizeOptionalString(options.provider || process.env.PANDORA_DAEMON_PROVIDER) || 'digitalocean'}`,
    `PANDORA_HEDGE_MARKET_ADDRESS=${context.marketPairIdentity.pandoraMarketAddress}`,
    `PANDORA_HEDGE_POLYMARKET_MARKET_ID=${context.marketPairIdentity.polymarketMarketId || ''}`,
    `PANDORA_HEDGE_POLYMARKET_SLUG=${context.marketPairIdentity.polymarketSlug || ''}`,
    `POLYMARKET_HOST=${normalizeOptionalString(options.polymarketHost || process.env.POLYMARKET_HOST) || ''}`,
    `POLYMARKET_FUNDER=${normalizeOptionalString(options.funder || process.env.POLYMARKET_FUNDER) || ''}`,
  ];
  if (options.executeLive) {
    lines.push('POLYMARKET_PRIVATE_KEY=');
    lines.push('POLYMARKET_API_KEY=');
    lines.push('POLYMARKET_API_SECRET=');
    lines.push('POLYMARKET_API_PASSPHRASE=');
  }
  return `${lines.join('\n')}\n`;
}

function buildBundleConfig(context, options = {}) {
  return JSON.stringify({
    schemaVersion: MIRROR_HEDGE_SERVICE_SCHEMA_VERSION,
    strategyHash: context.strategyHash,
    stateFile: context.stateFile,
    killSwitchFile: resolveKillSwitchFile(options),
    mode: options.executeLive ? 'live' : 'paper',
    marketPairIdentity: context.marketPairIdentity,
    internalWallets: {
      filePath: context.internalWallets.filePath,
      count: context.internalWallets.count,
      fingerprint: context.internalWallets.fingerprint,
    },
    hedgePolicies: {
      minHedgeUsdc: context.minHedgeUsdc,
      partialPolicy: context.partialPolicy,
      sellPolicy: context.sellPolicy,
      adoptExistingPositions: Boolean(options.adoptExistingPositions),
    },
    supportedHosts: ['digitalocean-droplet', 'generic-vps'],
    unsupportedHosts: ['cloudflare-workers'],
  }, null, 2);
}

function buildBundleSystemd(context, options = {}) {
  const adoptExistingPositionsArg = options.adoptExistingPositions ? ' --adopt-existing-positions' : '';
  const cwd = path.resolve(options.bundleRuntimeCwd || process.cwd());
  return [
    '[Unit]',
    `Description=Pandora Mirror Hedge ${context.strategyHash}`,
    'After=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `WorkingDirectory=${cwd}`,
    `EnvironmentFile=%h/.pandora/mirror-hedge/${context.strategyHash}.env`,
    `ExecStart=${process.execPath} ${resolveCliPath(options)} mirror hedge run --state-file ${context.stateFile} --strategy-hash ${context.strategyHash} ${options.executeLive ? '--execute-live' : '--paper'} --internal-wallets-file ${context.internalWallets.filePath}${adoptExistingPositionsArg} ${context.marketPairIdentity.pandoraMarketAddress ? `--pandora-market-address ${context.marketPairIdentity.pandoraMarketAddress}` : ''} ${context.marketPairIdentity.polymarketMarketId ? `--polymarket-market-id ${context.marketPairIdentity.polymarketMarketId}` : `--polymarket-slug ${context.marketPairIdentity.polymarketSlug}`}`.trim(),
    'Restart=always',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');
}

function buildBundleLaunchScript(context, options = {}) {
  const adoptExistingPositionsArg = options.adoptExistingPositions ? ' --adopt-existing-positions' : '';
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'ENV_FILE="${SCRIPT_DIR}/.env"',
    'if [[ -f "${ENV_FILE}" ]]; then',
    '  set -a',
    '  source "${ENV_FILE}"',
    '  set +a',
    'fi',
    `export PANDORA_INTERNAL_WALLETS_FILE="${context.internalWallets.filePath}"`,
    `exec ${process.execPath} "${resolveCliPath(options)}" mirror hedge run --state-file "${context.stateFile}" --strategy-hash "${context.strategyHash}" ${options.executeLive ? '--execute-live' : '--paper'} --internal-wallets-file "${context.internalWallets.filePath}"${adoptExistingPositionsArg} --pandora-market-address "${context.marketPairIdentity.pandoraMarketAddress}" ${context.marketPairIdentity.polymarketMarketId ? `--polymarket-market-id "${context.marketPairIdentity.polymarketMarketId}"` : `--polymarket-slug "${context.marketPairIdentity.polymarketSlug}"`}`,
    '',
  ].join('\n');
}

function buildBundleReadme(context, outputDir, options = {}) {
  return [
    '# Pandora Mirror Hedge Bundle',
    '',
    `Strategy hash: \`${context.strategyHash}\``,
    `Pandora market: \`${context.marketPairIdentity.pandoraMarketAddress}\``,
    `Polymarket market: \`${context.marketPairIdentity.polymarketMarketId || context.marketPairIdentity.polymarketSlug}\``,
    '',
    'Supported hosts in v1:',
    '- DigitalOcean droplet',
    '- Generic VPS',
    '',
    'Not supported in v1:',
    '- Cloudflare Workers',
    '',
    'Files:',
    `- \`${path.join(outputDir, '.env')}\``,
    `- \`${path.join(outputDir, 'hedge-daemon.config.json')}\``,
    `- \`${path.join(outputDir, 'mirror-hedge.service')}\``,
    `- \`${path.join(outputDir, 'run-mirror-hedge.sh')}\``,
    '',
    'Suggested host install:',
    '1. Copy the bundle directory to the target machine.',
    '2. Review `.env` and fill live Polymarket credentials if needed.',
    '3. Install the systemd unit or run `run-mirror-hedge.sh` directly. The launch script auto-loads `.env` from the bundle directory.',
    '4. Use `pandora mirror hedge status --strategy-hash <hash>` to check health.',
    '',
    options.executeLive
      ? 'Live mode requires valid Polymarket signer, funder, and API credentials.'
      : 'Paper mode stays read-only on the Polymarket side and writes hedge runtime state only.',
    '',
  ].join('\n');
}

function resolveCliPath(options = {}) {
  if (options.cliPath) return path.resolve(String(options.cliPath));
  if (process.argv[1]) return path.resolve(String(process.argv[1]));
  return path.resolve(process.cwd(), 'cli', 'pandora.cjs');
}

function buildMirrorHedgeDaemonCliArgs(options = {}, context = {}) {
  const args = ['--output', 'json', 'mirror', 'hedge', 'run'];
  if (options.useEnvFile === false) {
    args.push('--skip-dotenv');
  } else if (options.envFileExplicit && options.envFile) {
    args.push('--dotenv-path', String(options.envFile));
  }
  if (options.stateFile || context.stateFile) {
    args.push('--state-file', options.stateFile || context.stateFile);
  }
  if (options.strategyHash || context.strategyHash) {
    args.push('--strategy-hash', options.strategyHash || context.strategyHash);
  }
  if (options.killSwitchFile) args.push('--kill-switch-file', options.killSwitchFile);
  if (options.adoptExistingPositions) args.push('--adopt-existing-positions');
  if (context.marketPairIdentity && context.marketPairIdentity.pandoraMarketAddress) {
    args.push('--pandora-market-address', context.marketPairIdentity.pandoraMarketAddress);
  }
  if (context.marketPairIdentity && context.marketPairIdentity.polymarketMarketId) {
    args.push('--polymarket-market-id', context.marketPairIdentity.polymarketMarketId);
  } else if (context.marketPairIdentity && context.marketPairIdentity.polymarketSlug) {
    args.push('--polymarket-slug', context.marketPairIdentity.polymarketSlug);
  }
  args.push(options.executeLive ? '--execute-live' : '--paper');
  args.push('--internal-wallets-file', context.internalWallets.filePath);
  args.push('--min-hedge-usdc', String(context.minHedgeUsdc));
  args.push('--partial-hedge-policy', context.partialPolicy);
  args.push('--sell-hedge-policy', context.sellPolicy);
  if (options.intervalMs) args.push('--interval-ms', String(options.intervalMs));
  if (options.iterations) args.push('--iterations', String(options.iterations));
  if (options.indexerUrl) args.push('--indexer-url', options.indexerUrl);
  if (options.timeoutMs) args.push('--timeout-ms', String(options.timeoutMs));
  if (options.polymarketHost) args.push('--polymarket-host', options.polymarketHost);
  if (options.polymarketGammaUrl) args.push('--polymarket-gamma-url', options.polymarketGammaUrl);
  if (options.polymarketGammaMockUrl) args.push('--polymarket-gamma-mock-url', options.polymarketGammaMockUrl);
  if (options.polymarketMockUrl) args.push('--polymarket-mock-url', options.polymarketMockUrl);
  if (options.rpcUrl) args.push('--rpc-url', options.rpcUrl);
  if (options.polymarketRpcUrl) args.push('--polymarket-rpc-url', options.polymarketRpcUrl);
  if (options.chainId !== null && options.chainId !== undefined) args.push('--chain-id', String(options.chainId));
  if (options.profileId) args.push('--profile-id', options.profileId);
  if (options.profileFile) args.push('--profile-file', options.profileFile);
  if (options.funder) args.push('--funder', options.funder);
  if (options.usdc) args.push('--usdc', options.usdc);
  if (options.webhookUrl) args.push('--webhook-url', options.webhookUrl);
  if (options.telegramBotToken) args.push('--telegram-bot-token', options.telegramBotToken);
  if (options.telegramChatId) args.push('--telegram-chat-id', options.telegramChatId);
  if (options.discordWebhookUrl) args.push('--discord-webhook-url', options.discordWebhookUrl);
  return args;
}

async function buildMirrorHedgeBundle(options = {}) {
  const context = await prepareHedgeContext(options);
  const outputDir = resolveBundleOutputDir(options, context.strategyHash);
  ensureDirectory(outputDir);
  ensureDirectory(path.join(outputDir, 'state'));
  ensureDirectory(path.join(outputDir, 'logs'));

  const files = [
    { path: path.join(outputDir, '.env'), content: buildBundleEnv(context, options), mode: 0o600 },
    { path: path.join(outputDir, 'hedge-daemon.config.json'), content: buildBundleConfig(context, options), mode: 0o600 },
    { path: path.join(outputDir, 'mirror-hedge.service'), content: buildBundleSystemd(context, options), mode: 0o644 },
    { path: path.join(outputDir, 'run-mirror-hedge.sh'), content: buildBundleLaunchScript(context, options), mode: 0o755 },
    { path: path.join(outputDir, 'README.md'), content: buildBundleReadme(context, outputDir, options), mode: 0o644 },
  ];

  for (const file of files) {
    writeTextFile(file.path, file.content, file.mode);
  }

  const payload = buildCommonPayload(context, []);
  payload.mode = 'bundle';
  payload.plan = context.plan;
  payload.bundle = {
    summary: `Bundle emitted for ${context.marketPairIdentity.marketPairId || context.strategyHash}`,
    outputDir,
    files: files.map((file) => ({
      path: file.path,
      mode: file.mode,
    })),
    supportedHosts: ['digitalocean-droplet', 'generic-vps'],
    unsupportedHosts: ['cloudflare-workers'],
  };
  return payload;
}

async function runMirrorHedge(options = {}) {
  const context = await prepareHedgeContext(options);
  const killSwitchFile = resolveKillSwitchFile(options);
  const intervalMs = normalizeRuntimeIntervalMs(options);
  const maxIterations = normalizeRuntimeIterations(options);
  const sleep = typeof options.sleep === 'function' ? options.sleep : sleepMs;
  const diagnostics = [];
  const emptyObservation = {
    diagnostics: [],
    auditEntries: [],
    confirmedExposureLedger: [],
    pendingMempoolOverlays: [],
    deferredHedgeQueue: [],
    managedPolymarketInventorySnapshot: null,
    targetHedgeInventory: ensureTargetHedgeInventoryShape({}),
    availableHedgeFeeBudgetUsdc: 0,
    belowThresholdPendingUsdc: 0,
    skippedVolumeCounters: { totalUsdc: 0, yesUsdc: 0, noUsdc: 0, count: 0, byReason: {}, bySide: {} },
    retryTelemetry: ensureRetryTelemetryShape({}),
    lastSuccessfulHedge: null,
    lastError: null,
    lastProcessedBlockCursor: null,
    lastProcessedLogCursor: null,
  };
  let state = context.state;
  let latestPlan = context.plan;
  let latestObservation = emptyObservation;
  let iterationsCompleted = 0;
  let totalActionCount = 0;
  let shouldStop = false;
  let stoppedReason = null;
  let fatalError = null;

  const stopHandler = () => {
    shouldStop = true;
  };

  process.on('SIGINT', stopHandler);
  process.on('SIGTERM', stopHandler);

  try {
    markHedgeRuntimeStarted(state, {
      now: options.now,
      iterationsRequested: maxIterations,
    });
    persistHedgeState(context.stateFile, state);
    context.state = state;

    while (!shouldStop && (maxIterations === null || iterationsCompleted < maxIterations)) {
      if (killSwitchFile && fs.existsSync(killSwitchFile)) {
        stoppedReason = `Kill switch file detected at ${killSwitchFile}`;
        break;
      }

      const tickStartedAt = new Date();
      markHedgeRuntimeTickStarted(state, { now: tickStartedAt });
      persistHedgeState(context.stateFile, state);

      try {
        const observation = await buildExecutionObservation(options, context, state);
        const runtime = runHedge({
          stateFile: context.stateFile,
          strategyHash: context.strategyHash,
          marketPairIdentity: context.marketPairIdentity,
          whitelistFingerprint: context.internalWallets.fingerprint,
          confirmedExposureLedger: observation.confirmedExposureLedger,
          pendingMempoolOverlays: observation.pendingMempoolOverlays,
          deferredHedgeQueue: observation.deferredHedgeQueue,
          managedPolymarketInventorySnapshot: observation.managedPolymarketInventorySnapshot,
          targetHedgeInventory: observation.targetHedgeInventory,
          availableHedgeFeeBudgetUsdc: observation.availableHedgeFeeBudgetUsdc,
          belowThresholdPendingUsdc: observation.belowThresholdPendingUsdc,
          skippedVolumeCounters: observation.skippedVolumeCounters,
          retryTelemetry: observation.retryTelemetry,
          lastObservedTrade: observation.lastObservedTrade,
          lastHedgeSignal: observation.lastHedgeSignal,
          lastSuccessfulHedge: observation.lastSuccessfulHedge,
          lastError: observation.lastError,
          lastProcessedBlockCursor: observation.lastProcessedBlockCursor,
          lastProcessedLogCursor: observation.lastProcessedLogCursor,
          now: tickStartedAt,
        });
        latestObservation = observation;
        latestPlan = runtime.plan;
        state = runtime.state;
        context.state = state;
        context.plan = runtime.plan;
        context.inventorySnapshot = observation.managedPolymarketInventorySnapshot || state.managedPolymarketInventorySnapshot || context.inventorySnapshot;
        totalActionCount += Array.isArray(observation.auditEntries) ? observation.auditEntries.length : 0;
      } catch (err) {
        const errorAt = new Date();
        state.lastError = buildRuntimeErrorEvent(err, errorAt, {
          iteration: iterationsCompleted + 1,
        });
        state.runtimeStatus = 'running';
        state.lastRunAt = errorAt.toISOString();
        state.updatedAt = errorAt.toISOString();
        diagnostics.push(`Iteration ${iterationsCompleted + 1} failed: ${state.lastError.message}`);
      }

      iterationsCompleted += 1;
      markHedgeRuntimeTickCompleted(state, {
        now: new Date(),
        iterationsCompleted,
      });
      persistHedgeState(context.stateFile, state);

      if (shouldStop) break;
      if (maxIterations !== null && iterationsCompleted >= maxIterations) {
        stoppedReason = `Completed ${iterationsCompleted} hedge iteration${iterationsCompleted === 1 ? '' : 's'}.`;
        break;
      }
      await sleep(intervalMs);
    }
  } catch (err) {
    fatalError = err;
    const errorAt = new Date();
    const lastError = buildRuntimeErrorEvent(err, errorAt);
    markHedgeRuntimeStopped(state, {
      now: errorAt,
      runtimeStatus: 'errored',
      stoppedReason: `Fatal hedge runtime error: ${lastError.message}`,
      exitCode: 1,
      iterationsRequested: maxIterations,
      iterationsCompleted,
      lastError,
    });
    persistHedgeState(context.stateFile, state);
  } finally {
    process.off('SIGINT', stopHandler);
    process.off('SIGTERM', stopHandler);
    if (!fatalError) {
      if (!stoppedReason && shouldStop) {
        stoppedReason = 'Received termination signal.';
      }
      if (!stoppedReason) {
        stoppedReason = 'Hedge runtime stopped.';
      }
      markHedgeRuntimeStopped(state, {
        now: new Date(),
        stoppedReason,
        exitCode: 0,
        iterationsRequested: maxIterations,
        iterationsCompleted,
      });
      persistHedgeState(context.stateFile, state);
    }
  }

  if (fatalError) {
    throw fatalError;
  }

  context.state = state;
  context.plan = latestPlan;
  const payload = buildCommonPayload(context, latestObservation.diagnostics);
  payload.mode = 'run';
  payload.plan = latestPlan;
  payload.warnings = Array.isArray(latestPlan && latestPlan.warnings) ? latestPlan.warnings : [];
  payload.runtime = {
    status: state.runtimeStatus || 'idle',
    auditEntries: latestObservation.auditEntries,
    actionCount: totalActionCount,
    killSwitchFile,
    intervalMs,
    iterationsRequested: maxIterations,
    iterationsCompleted,
    lastTickAt: state.lastTickAt || null,
    stoppedReason: state.stoppedReason || null,
    exitCode: state.exitCode === null || state.exitCode === undefined ? null : state.exitCode,
    exitAt: state.exitAt || null,
    retryTelemetry: ensureRetryTelemetryShape(state.retryTelemetry),
  };
  payload.lastObservedTrade = state.lastObservedTrade || null;
  payload.lastHedgeSignal = state.lastHedgeSignal || null;
  payload.lastSuccessfulHedge = state.lastSuccessfulHedge || null;
  payload.lastError = state.lastError || null;
  payload.lastAlert = state.lastAlert || null;
  payload.summary = {
    confirmedExposureCount: latestPlan && latestPlan.summary ? latestPlan.summary.confirmedExposureCount : (
      Array.isArray(state.confirmedExposureLedger) ? state.confirmedExposureLedger.length : latestObservation.confirmedExposureLedger.length
    ),
    pendingOverlayCount: Array.isArray(state.pendingMempoolOverlays) ? state.pendingMempoolOverlays.length : latestObservation.pendingMempoolOverlays.length,
    deferredHedgeCount: Array.isArray(state.deferredHedgeQueue) ? state.deferredHedgeQueue.length : latestObservation.deferredHedgeQueue.length,
    targetYesShares: latestPlan && latestPlan.summary ? latestPlan.summary.targetYesShares : 0,
    targetNoShares: latestPlan && latestPlan.summary ? latestPlan.summary.targetNoShares : 0,
    currentYesShares: latestPlan && latestPlan.summary ? latestPlan.summary.currentYesShares : 0,
    currentNoShares: latestPlan && latestPlan.summary ? latestPlan.summary.currentNoShares : 0,
    excessYesToSell: latestPlan && latestPlan.summary ? latestPlan.summary.excessYesToSell : 0,
    excessNoToSell: latestPlan && latestPlan.summary ? latestPlan.summary.excessNoToSell : 0,
    deficitYesToBuy: latestPlan && latestPlan.summary ? latestPlan.summary.deficitYesToBuy : 0,
    deficitNoToBuy: latestPlan && latestPlan.summary ? latestPlan.summary.deficitNoToBuy : 0,
    netTargetSide: latestPlan && latestPlan.summary ? latestPlan.summary.netTargetSide : null,
    netTargetShares: latestPlan && latestPlan.summary ? latestPlan.summary.netTargetShares : 0,
    availableHedgeFeeBudgetUsdc: latestPlan && latestPlan.summary ? latestPlan.summary.availableHedgeFeeBudgetUsdc : 0,
    belowThresholdPendingUsdc: latestPlan && latestPlan.summary ? latestPlan.summary.belowThresholdPendingUsdc : 0,
    sellRetryAttemptedCount: latestPlan && latestPlan.summary ? latestPlan.summary.sellRetryAttemptedCount : 0,
    sellRetryBlockedCount: latestPlan && latestPlan.summary ? latestPlan.summary.sellRetryBlockedCount : 0,
    sellRetryFailedCount: latestPlan && latestPlan.summary ? latestPlan.summary.sellRetryFailedCount : 0,
    sellRetryRecoveredCount: latestPlan && latestPlan.summary ? latestPlan.summary.sellRetryRecoveredCount : 0,
    warningCount: latestPlan && latestPlan.summary ? latestPlan.summary.warningCount : 0,
  };
  payload.diagnostics = mergeDiagnostics(payload.diagnostics, diagnostics, latestObservation.diagnostics);
  return payload;
}

async function startMirrorHedgeDaemon(options = {}) {
  const context = await prepareHedgeContext(options);
  const daemonCliArgs = buildMirrorHedgeDaemonCliArgs({
    ...options,
    stateFile: context.stateFile,
    strategyHash: context.strategyHash,
  }, context);
  const daemonEnv = {
    ...process.env,
    PANDORA_INTERNAL_WALLETS_FILE: context.internalWallets.filePath,
  };
  if (options.privateKey) {
    daemonEnv.POLYMARKET_PRIVATE_KEY = options.privateKey;
  }
  if (options.funder) {
    daemonEnv.POLYMARKET_FUNDER = options.funder;
  }
  const daemon = startDaemon({
    strategyHash: context.strategyHash,
    cliPath: resolveCliPath(options),
    cliArgs: daemonCliArgs,
    cwd: process.cwd(),
    env: daemonEnv,
    mode: 'run',
    executeLive: Boolean(options.executeLive),
    stateFile: context.stateFile,
    killSwitchFile: resolveKillSwitchFile(options),
    pandoraMarketAddress: context.marketPairIdentity.pandoraMarketAddress,
    polymarketMarketId: context.marketPairIdentity.polymarketMarketId,
    polymarketSlug: context.marketPairIdentity.polymarketSlug,
  });
  const diagnostics = [];
  try {
    const started = startHedge({
      stateFile: context.stateFile,
      strategyHash: context.strategyHash,
      marketPairIdentity: context.marketPairIdentity,
      whitelistFingerprint: context.internalWallets.fingerprint,
      iterationsRequested: normalizeRuntimeIterations(options),
    });
    context.state = started.state;
  } catch (err) {
    diagnostics.push(`Daemon started but runtime state could not be marked running: ${err && err.message ? err.message : String(err)}`);
  }
  const payload = buildCommonPayload(context, diagnostics);
  payload.mode = 'start';
  payload.plan = context.plan;
  payload.daemon = {
    pid: daemon.pid,
    pidFile: daemon.pidFile,
    logFile: daemon.logFile,
    alive: Boolean(daemon.pidAlive),
    status: daemon.status,
    operationId: daemon.strategyHash,
  };
  payload.status = daemon.status;
  return payload;
}

async function getMirrorHedgeDaemonStatus(options = {}) {
  const status = daemonStatus(options);
  const payload = {
    schemaVersion: MIRROR_HEDGE_SERVICE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: 'status',
    stateFile: status.metadata && status.metadata.stateFile ? status.metadata.stateFile : null,
    strategyHash: status.strategyHash || null,
    selector: {
      pandoraMarketAddress: status.metadata ? status.metadata.pandoraMarketAddress || null : null,
      polymarketMarketId: status.metadata ? status.metadata.polymarketMarketId || null : null,
      polymarketSlug: status.metadata ? status.metadata.polymarketSlug || null : null,
    },
    daemon: {
      pid: status.pid,
      pidFile: status.pidFile,
      logFile: status.metadata ? status.metadata.logFile || null : null,
      alive: status.alive,
      status: status.status,
      operationId: status.strategyHash || null,
    },
    diagnostics: [],
  };
  if (payload.stateFile && fs.existsSync(payload.stateFile)) {
    try {
      const runtime = statusHedge({
        stateFile: payload.stateFile,
        strategyHash: payload.strategyHash,
      });
      payload.runtime = runtime.runtime;
      payload.summary = runtime.summary;
      payload.readiness = runtime.readiness;
      payload.warnings = runtime.warnings;
      payload.lastObservedTrade = runtime.lastObservedTrade || null;
      payload.lastHedgeSignal = runtime.lastHedgeSignal || null;
      payload.lastSuccessfulHedge = runtime.lastSuccessfulHedge;
      payload.lastError = runtime.lastError;
      payload.lastAlert = runtime.lastAlert;
    } catch (err) {
      payload.diagnostics.push(`Unable to read hedge runtime state: ${err && err.message ? err.message : String(err)}`);
    }
  }
  return payload;
}

async function stopMirrorHedgeDaemon(options = {}) {
  const result = await stopDaemon(options);
  if (result && Array.isArray(result.items)) {
    return result;
  }
  if (result && result.metadata && result.metadata.stateFile && fs.existsSync(result.metadata.stateFile)) {
    try {
      stopHedge({
        stateFile: result.metadata.stateFile,
        strategyHash: result.strategyHash,
        stoppedReason: 'Hedge daemon stopped by operator.',
        exitCode: 0,
        lastAlert: {
          code: 'MIRROR_HEDGE_DAEMON_STOPPED',
          message: 'Hedge daemon stopped by operator.',
        },
      });
    } catch {
      // daemon stop remains authoritative even if state update fails
    }
  }
  return {
    schemaVersion: MIRROR_HEDGE_SERVICE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: 'stop',
    strategyHash: result.strategyHash || null,
    stateFile: result.metadata ? result.metadata.stateFile || null : null,
    selector: {
      pandoraMarketAddress: result.metadata ? result.metadata.pandoraMarketAddress || null : null,
      polymarketMarketId: result.metadata ? result.metadata.polymarketMarketId || null : null,
      polymarketSlug: result.metadata ? result.metadata.polymarketSlug || null : null,
    },
    daemon: {
      pid: result.pid,
      pidFile: result.pidFile,
      alive: result.alive,
      status: result.status,
      operationId: result.strategyHash || null,
    },
    diagnostics: [],
  };
}

function createMirrorHedgeService(deps = {}) {
  return {
    plan: (options = {}) => planHedge({
      ...deps,
      ...options,
    }),
    run: (options = {}) => runHedge({
      ...deps,
      ...options,
    }),
    start: (options = {}) => startHedge({
      ...deps,
      ...options,
    }),
    status: (options = {}) => statusHedge({
      ...deps,
      ...options,
    }),
    stop: (options = {}) => stopHedge({
      ...deps,
      ...options,
    }),
    bundleFacing: (options = {}) => bundleFacingHedge({
      ...deps,
      ...options,
    }),
  };
}

module.exports = {
  MIRROR_HEDGE_SERVICE_SCHEMA_VERSION,
  DEFAULT_MIN_HEDGE_USDC,
  DEFAULT_PARTIAL_HEDGE_POLICY,
  DEFAULT_SELL_HEDGE_POLICY,
  createServiceError,
  resolveStateFile,
  resolveKillSwitchFile,
  ensureStateIdentity,
  loadHedgeState,
  persistHedgeState,
  buildHedgeRuntime,
  planHedge,
  runHedge,
  startHedge,
  statusHedge,
  stopHedge,
  bundleFacingHedge,
  loadInternalWalletConfig,
  buildMirrorHedgeDaemonCliArgs,
  buildMirrorHedgePlan,
  buildMirrorHedgeBundle,
  runMirrorHedge,
  startMirrorHedgeDaemon,
  getMirrorHedgeDaemonStatus,
  stopMirrorHedgeDaemon,
  createMirrorHedgeService,
};
