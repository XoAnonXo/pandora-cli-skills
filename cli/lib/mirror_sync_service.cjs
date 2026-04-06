const fs = require('fs');
const {
  MIRROR_STATE_SCHEMA_VERSION,
  defaultStateFile,
  defaultKillSwitchFile,
  strategyHash,
  loadState,
  saveState,
  resetDailyCountersIfNeeded,
} = require('./mirror_state_store.cjs');
const { verifyMirrorPair } = require('./mirror_verify_service.cjs');
const {
  fetchDepthForMarket,
  placeHedgeOrder,
  fetchPolymarketPositionSummary,
  readTradingCredsFromEnv,
} = require('./polymarket_trade_adapter.cjs');
const { sleepMs, round } = require('./shared/utils.cjs');
const {
  buildVerifyRequest,
  buildSyncStrategy,
  buildTickPlan,
  fetchDepthSnapshot,
  buildTickSnapshot,
  normalizePriceSource,
} = require('./mirror_sync/planning.cjs');
const {
  readPandoraOnchainReserveContext,
  applyReserveContextToVerifyPayload,
  buildReserveContextFromVerifyPayload,
} = require('./mirror_sync/reserve_source.cjs');
const {
  MIRROR_SYNC_GATE_CODES,
  evaluateSnapshot,
  evaluateStrictGates,
  normalizeSkipGateChecks,
  applyGateBypassPolicy,
  resolveMinimumTimeToCloseSec,
  buildTickGateContext,
  runStartupVerify,
} = require('./mirror_sync/gates.cjs');
const { processTriggeredAction } = require('./mirror_sync/execution.cjs');
const { createServiceError, ensureStateIdentity, persistTickSnapshot } = require('./mirror_sync/state.cjs');
const { materializeExecutionSigner } = require('./signers/execution_signer_service.cjs');

const MIRROR_SYNC_SCHEMA_VERSION = '1.0.0';
const POLYMARKET_CHAIN_ID = 137;
const RECOVERABLE_RUN_DIAGNOSTIC_CODES = new Set([
  'INDEXER_TIMEOUT',
  'INDEXER_HTTP_ERROR',
  'INDEXER_REQUEST_FAILED',
]);

function normalizeOptionalString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function toFiniteNumberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundUsdc(value) {
  const numeric = toFiniteNumberOrNull(value);
  if (numeric === null) return null;
  return Math.round(numeric * 1e6) / 1e6;
}

function parseBooleanish(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function shouldAdoptExistingPositions(options = {}, env = process.env) {
  if (options.adoptExistingPositions !== undefined) {
    return parseBooleanish(options.adoptExistingPositions);
  }
  return parseBooleanish(env.PANDORA_MIRROR_ADOPT_EXISTING_POSITIONS || env.MIRROR_SYNC_ADOPT_EXISTING_POSITIONS);
}

function normalizeOpenOrderSide(value) {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function sumReservedSellShares(openOrders, tokenId) {
  if (!Array.isArray(openOrders) || !openOrders.length || !tokenId) return 0;
  let reservedShares = 0;
  for (const order of openOrders) {
    if (!order || typeof order !== 'object') continue;
    const orderTokenId = normalizeOptionalString(order.tokenId || order.assetId || order.asset_id);
    if (!orderTokenId || orderTokenId !== tokenId) continue;
    const side = normalizeOpenOrderSide(order.side);
    if (side !== 'sell') continue;
    const remainingSize = toFiniteNumberOrNull(
      order.remainingSize !== undefined ? order.remainingSize : order.remaining_size,
    );
    if (remainingSize !== null && remainingSize > 0) {
      reservedShares += remainingSize;
    }
  }
  return roundUsdc(reservedShares) || 0;
}

function extractManagedInventorySeed(summary = {}, inventoryAddress = null) {
  const totalYesShares = roundUsdc(summary.yesBalance) || 0;
  const totalNoShares = roundUsdc(summary.noBalance) || 0;
  const openOrdersCount = toFiniteNumberOrNull(summary.openOrdersCount);
  const missingOpenOrderDetails =
    openOrdersCount !== null
    && openOrdersCount > 0
    && !Array.isArray(summary.openOrders);
  const reservedYesShares = missingOpenOrderDetails
    ? null
    : sumReservedSellShares(summary.openOrders, summary.yesTokenId || (summary.tokenIds && summary.tokenIds.yes));
  const reservedNoShares = missingOpenOrderDetails
    ? null
    : sumReservedSellShares(summary.openOrders, summary.noTokenId || (summary.tokenIds && summary.tokenIds.no));
  const yesShares = missingOpenOrderDetails
    ? 0
    : roundUsdc(Math.max(0, totalYesShares - (reservedYesShares || 0))) || 0;
  const noShares = missingOpenOrderDetails
    ? 0
    : roundUsdc(Math.max(0, totalNoShares - (reservedNoShares || 0))) || 0;
  const yesPrice = toFiniteNumberOrNull(summary && summary.prices ? summary.prices.yes : null);
  const noPrice = toFiniteNumberOrNull(summary && summary.prices ? summary.prices.no : null);
  const yesUsdc = yesPrice !== null ? roundUsdc(yesShares * yesPrice) || 0 : yesShares === 0 ? 0 : null;
  const noUsdc = noPrice !== null ? roundUsdc(noShares * noPrice) || 0 : noShares === 0 ? 0 : null;
  const netUsdc = roundUsdc(yesShares - noShares);
  const estimatedValueUsdc = roundUsdc(summary.estimatedValueUsd);
  const hasInventory = yesShares > 0 || noShares > 0 || (estimatedValueUsdc !== null && estimatedValueUsdc > 0);
  const diagnostics = Array.isArray(summary.diagnostics) ? summary.diagnostics.map((entry) => String(entry)) : [];
  if (missingOpenOrderDetails) {
    diagnostics.push(
      `Open-order detail is unavailable while ${openOrdersCount} open order(s) are reported; managed inventory adoption stays fail-closed until detailed remaining sizes are available.`,
    );
  } else if ((reservedYesShares || 0) > 0 || (reservedNoShares || 0) > 0) {
    diagnostics.push(
      `Discounted reserved open-order inventory during adoption (YES ${reservedYesShares}, NO ${reservedNoShares}).`,
    );
  }
  return {
    adoptedAt: null,
    status: missingOpenOrderDetails ? 'partial' : hasInventory ? 'adopted' : 'flat',
    source:
      normalizeOptionalString(summary && summary.source && summary.source.resolved)
      || normalizeOptionalString(summary && summary.source && summary.source.balances)
      || 'unknown',
    inventoryAddress: normalizeOptionalString(inventoryAddress),
    walletAddress: normalizeOptionalString(summary.walletAddress || summary.ownerAddress || inventoryAddress),
    marketId: normalizeOptionalString(summary.marketId || summary.conditionId),
    slug: normalizeOptionalString(summary.slug),
    yesTokenId: normalizeOptionalString(summary.yesTokenId || (summary.tokenIds && summary.tokenIds.yes)),
    noTokenId: normalizeOptionalString(summary.noTokenId || (summary.tokenIds && summary.tokenIds.no)),
    totalYesShares,
    totalNoShares,
    reservedYesShares,
    reservedNoShares,
    yesShares,
    noShares,
    yesUsdc,
    noUsdc,
    netUsdc,
    estimatedValueUsdc,
    openOrdersCount,
    diagnostics,
  };
}

function pushRunDiagnostic(diagnostics, diagnostic) {
  if (!Array.isArray(diagnostics) || !diagnostic || typeof diagnostic !== 'object') return;
  const normalized = {
    ...diagnostic,
    code: diagnostic.code ? String(diagnostic.code) : 'MIRROR_SYNC_DIAGNOSTIC',
    scope: diagnostic.scope ? String(diagnostic.scope) : 'runtime',
    message: diagnostic.message ? String(diagnostic.message) : 'Mirror sync diagnostic.',
  };
  if (!RECOVERABLE_RUN_DIAGNOSTIC_CODES.has(normalized.code)) {
    diagnostics.push(normalized);
    return;
  }
  const last = diagnostics[diagnostics.length - 1];
  if (
    last
    && last.code === normalized.code
    && last.scope === normalized.scope
    && last.message === normalized.message
  ) {
    diagnostics[diagnostics.length - 1] = {
      ...last,
      ...normalized,
      firstTimestamp: last.firstTimestamp || last.timestamp || normalized.timestamp,
      count: Number.isFinite(Number(last.count)) ? Number(last.count) + 1 : 2,
    };
    return;
  }
  diagnostics.push(normalized);
}

async function loadViemRuntime(deps = {}) {
  if (deps.viemRuntime && typeof deps.viemRuntime === 'object' && typeof deps.viemRuntime.privateKeyToAccount === 'function') {
    return deps.viemRuntime;
  }
  const viem = deps.viemRuntime && typeof deps.viemRuntime === 'object'
    ? deps.viemRuntime
    : await import('viem');
  const accounts = deps.accountsRuntime && typeof deps.accountsRuntime === 'object'
    ? deps.accountsRuntime
    : await import('viem/accounts');
  return { ...viem, ...accounts };
}

function buildReadChain(chainId, rpcUrl) {
  const resolvedChainId = Number.isInteger(Number(chainId)) && Number(chainId) > 0 ? Number(chainId) : 1;
  const resolvedRpcUrl = String(rpcUrl || '').trim();
  return {
    id: resolvedChainId,
    name: resolvedChainId === 1 ? 'Ethereum' : `Chain ${resolvedChainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [resolvedRpcUrl] }, public: { http: [resolvedRpcUrl] } },
  };
}

function resolveRpcCandidates(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  return text
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function isReceiptNotFoundError(err) {
  const message = err && (err.shortMessage || err.message) ? String(err.shortMessage || err.message) : String(err);
  return Boolean(
    err && (
      err.name === 'TransactionReceiptNotFoundError'
      || err.code === 'TRANSACTION_RECEIPT_NOT_FOUND'
      || /receipt/i.test(message) && /not found|could not be found|does not exist/i.test(message)
    ),
  );
}

async function resolvePendingActionRecoveryClient(options, deps = {}) {
  if (deps.pendingActionRecoveryClient) {
    return deps.pendingActionRecoveryClient;
  }
  const candidateUrls = resolveRpcCandidates(options.rpcUrl);
  if (!candidateUrls.length) return null;
  const viemRuntime = await loadViemRuntime(deps);
  if (
    !viemRuntime
    || typeof viemRuntime.createPublicClient !== 'function'
    || typeof viemRuntime.http !== 'function'
  ) {
    return null;
  }
  const clients = candidateUrls.map((rpcUrl) =>
    viemRuntime.createPublicClient({
      chain: buildReadChain(options.chainId, rpcUrl),
      transport: viemRuntime.http(rpcUrl),
    }),
  );
  if (clients.length === 1) {
    return clients[0];
  }
  return {
    async getTransactionReceipt(params) {
      let lastNotFoundError = null;
      let lastError = null;
      for (const client of clients) {
        try {
          return await client.getTransactionReceipt(params);
        } catch (err) {
          if (isReceiptNotFoundError(err)) {
            lastNotFoundError = err;
          } else {
            lastError = err;
          }
        }
      }
      if (lastError) throw lastError;
      if (lastNotFoundError) throw lastNotFoundError;
      return null;
    },
  };
}

async function resolvePandoraInventoryAddress(options, deps = {}) {
  if (typeof deps.resolvePandoraInventoryAddress === 'function') {
    return deps.resolvePandoraInventoryAddress(options);
  }

  const directPrivateKey = String(options.privateKey || process.env.PANDORA_PRIVATE_KEY || process.env.PRIVATE_KEY || '').trim();
  if (directPrivateKey) {
    const { privateKeyToAccount } = await loadViemRuntime(deps);
    return privateKeyToAccount(directPrivateKey).address;
  }

  if (!String(options.profileId || '').trim() && !String(options.profileFile || '').trim()) {
    return null;
  }

  const rpcUrl = String(options.rpcUrl || process.env.RPC_URL || '').trim();
  if (!rpcUrl) {
    return null;
  }

  const chainId = Number.isInteger(Number(options.chainId)) && Number(options.chainId) > 0 ? Number(options.chainId) : 1;
  const viemRuntime = await loadViemRuntime(deps);
  const materialized = await materializeExecutionSigner({
    privateKey: null,
    profileId: options.profileId || null,
    profileFile: options.profileFile || null,
    chainId,
    chain: buildReadChain(chainId, rpcUrl),
    rpcUrl,
    viemRuntime,
    env: process.env,
    requireSigner: true,
    mode: 'read',
    liveRequested: false,
    mutating: false,
    command: 'mirror-sync',
    toolFamily: 'mirror-sync',
    metadata: { source: 'mirror-sync.inventory' },
  });

  return materialized && materialized.signerAddress ? materialized.signerAddress : null;
}

async function resolvePolymarketExecutionContext(options, deps = {}) {
  if (typeof deps.resolvePolymarketExecutionContext === 'function') {
    return deps.resolvePolymarketExecutionContext(options);
  }

  const envCreds = readTradingCredsFromEnv(process.env);
  const explicitPrivateKey = normalizeOptionalString(options.privateKey);
  const explicitFunder = normalizeOptionalString(options.funder);
  let privateKey = explicitPrivateKey || envCreds.privateKey || null;
  let signerAddress = null;
  let profileBackend = null;
  let profileDerivedPrivateKey = null;

  const hasProfileSelector = Boolean(
    normalizeOptionalString(options.profileId)
    || normalizeOptionalString(options.profileFile),
  );

  if (!privateKey && hasProfileSelector) {
    const profileRpcUrl = resolveRpcCandidates(options.polymarketRpcUrl || options.rpcUrl)[0] || null;
    if (profileRpcUrl) {
      const viemRuntime = await loadViemRuntime(deps);
      const materialized = await materializeExecutionSigner({
        privateKey: null,
        profileId: options.profileId || null,
        profileFile: options.profileFile || null,
        chainId: POLYMARKET_CHAIN_ID,
        chain: buildReadChain(POLYMARKET_CHAIN_ID, profileRpcUrl),
        rpcUrl: profileRpcUrl,
        viemRuntime,
        env: process.env,
        requireSigner: true,
        mode: options.executeLive ? 'write' : 'read',
        liveRequested: Boolean(options.executeLive),
        mutating: Boolean(options.executeLive),
        command: 'mirror-sync',
        toolFamily: 'mirror-sync',
        metadata: { source: 'mirror-sync.polymarket' },
      });
      signerAddress = materialized && materialized.signerAddress
        ? String(materialized.signerAddress)
        : null;
      profileBackend = materialized && materialized.backend ? String(materialized.backend) : null;
      const resolvedProfile = materialized && materialized.resolvedProfile && materialized.resolvedProfile.resolution
        ? materialized.resolvedProfile.resolution
        : null;
      profileDerivedPrivateKey = resolvedProfile && resolvedProfile.secretMaterial && resolvedProfile.secretMaterial.privateKey
        ? normalizeOptionalString(resolvedProfile.secretMaterial.privateKey)
        : null;
      if (profileDerivedPrivateKey) {
        privateKey = profileDerivedPrivateKey;
      }
    }
  }

  if (!signerAddress && privateKey) {
    const { privateKeyToAccount } = await loadViemRuntime(deps);
    signerAddress = privateKeyToAccount(privateKey).address;
  }

  const funder = explicitFunder || normalizeOptionalString(envCreds.funder) || normalizeOptionalString(signerAddress);
  return {
    privateKey,
    funder,
    signerAddress: normalizeOptionalString(signerAddress),
    apiKey: normalizeOptionalString(envCreds.apiKey),
    apiSecret: normalizeOptionalString(envCreds.apiSecret),
    apiPassphrase: normalizeOptionalString(envCreds.apiPassphrase),
    profileBacked: Boolean(hasProfileSelector),
    profileBackend,
    profileDerivedPrivateKey: Boolean(profileDerivedPrivateKey),
    envPrivateKeyInvalid: Boolean(!explicitPrivateKey && envCreds.privateKeyInvalid),
  };
}

async function resolvePolymarketInventoryAddress(options, deps = {}, polymarketExecutionContext = null) {
  const executionContext = polymarketExecutionContext && typeof polymarketExecutionContext === 'object'
    ? polymarketExecutionContext
    : null;
  const funder = normalizeOptionalString(executionContext && executionContext.funder);
  if (funder) return funder;
  const signerAddress = normalizeOptionalString(executionContext && executionContext.signerAddress);
  if (signerAddress) return signerAddress;

  const explicitFunder = normalizeOptionalString(options.funder || process.env.POLYMARKET_FUNDER);
  if (explicitFunder) return explicitFunder;
  const directPrivateKey = normalizeOptionalString(options.privateKey || process.env.POLYMARKET_PRIVATE_KEY);
  if (!directPrivateKey) return null;
  const { privateKeyToAccount } = await loadViemRuntime(deps);
  return privateKeyToAccount(directPrivateKey).address;
}

async function resolvePolymarketInventoryReadClient(options, deps = {}) {
  if (deps.polymarketInventoryReadClient) {
    return deps.polymarketInventoryReadClient;
  }

  const candidateUrls = resolveRpcCandidates(options.polymarketRpcUrl || options.rpcUrl);
  if (!candidateUrls.length) return null;

  const viemRuntime = await loadViemRuntime(deps);
  if (
    !viemRuntime
    || typeof viemRuntime.createPublicClient !== 'function'
    || typeof viemRuntime.http !== 'function'
  ) {
    return null;
  }

  const clients = candidateUrls.map((rpcUrl) =>
    viemRuntime.createPublicClient({
      chain: buildReadChain(POLYMARKET_CHAIN_ID, rpcUrl),
      transport: viemRuntime.http(rpcUrl),
    }),
  );
  if (clients.length === 1) return clients[0];
  return {
    async readContract(params) {
      let lastError = null;
      for (const client of clients) {
        try {
          return await client.readContract(params);
        } catch (err) {
          lastError = err;
        }
      }
      if (lastError) throw lastError;
      return null;
    },
  };
}

/**
 * Execute mirror sync in `once` or continuous `run` mode.
 * USDC-facing option fields use decimal units (not raw token units);
 * slippage values are basis points.
 * @param {object} options
 * @param {object} [deps]
 * @returns {Promise<object>}
 */
async function runMirrorSync(options, deps = {}) {
  const now = () => (typeof deps.now === 'function' ? deps.now() : new Date());
  const verifyFn = deps.verifyFn || verifyMirrorPair;
  const depthFn = deps.depthFn || fetchDepthForMarket;
  const hedgeFn = deps.hedgeFn || placeHedgeOrder;
  const positionSummaryFn =
    typeof deps.positionSummaryFn === 'function'
      ? deps.positionSummaryFn
      : fetchPolymarketPositionSummary;
  const readReserveContext =
    typeof deps.readPandoraReserveContext === 'function'
      ? deps.readPandoraReserveContext
      : readPandoraOnchainReserveContext;
  const applyReserveContext =
    typeof deps.applyReserveContextToVerifyPayload === 'function'
      ? deps.applyReserveContextToVerifyPayload
      : applyReserveContextToVerifyPayload;
  const buildReserveContext =
    typeof deps.buildReserveContextFromVerifyPayload === 'function'
      ? deps.buildReserveContextFromVerifyPayload
      : buildReserveContextFromVerifyPayload;
  const rebalanceFn = typeof deps.rebalanceFn === 'function' ? deps.rebalanceFn : null;
  const sendWebhook = typeof deps.sendWebhook === 'function' ? deps.sendWebhook : null;
  const onTick = typeof deps.onTick === 'function' ? deps.onTick : null;
  if (options.executeLive && !rebalanceFn) {
    throw createServiceError('MIRROR_REBALANCE_FN_REQUIRED', 'Live mirror sync requires a rebalanceFn dependency.');
  }

  const strategy = buildSyncStrategy(options);

  const hash = strategyHash(strategy);
  const stateFile = options.stateFile || defaultStateFile(strategy);
  const killSwitchFile = options.killSwitchFile || defaultKillSwitchFile();

  const loaded = loadState(stateFile, hash);
  const state = loaded.state;
  ensureStateIdentity(state, options);

  const snapshots = [];
  const actions = [];
  const webhookReports = [];
  const diagnostics = [];
  let inventoryAddress = null;
  let polymarketExecutionContext = null;
  let polymarketInventoryReadClient = null;
  let polymarketInventoryAddress = null;
  let pendingActionRecoveryClient = null;
  const adoptExistingPositions = shouldAdoptExistingPositions(options);
  try {
    inventoryAddress = await resolvePandoraInventoryAddress(options, deps);
  } catch (err) {
    pushRunDiagnostic(diagnostics, {
      level: 'warn',
      scope: 'inventory-offset',
      iteration: 0,
      timestamp: now().toISOString(),
      code: err && err.code ? String(err.code) : 'MIRROR_INVENTORY_ADDRESS_UNAVAILABLE',
      message: err && err.message ? err.message : 'Unable to resolve Pandora inventory address for wallet-offset hedging.',
    });
  }
  try {
    polymarketExecutionContext = await resolvePolymarketExecutionContext(options, deps);
    if (
      polymarketExecutionContext
      && options.executeLive
      && polymarketExecutionContext.profileBacked
      && !polymarketExecutionContext.privateKey
    ) {
      pushRunDiagnostic(diagnostics, {
        level: 'warn',
        scope: 'inventory-adoption',
        iteration: 0,
        timestamp: now().toISOString(),
        code: 'POLYMARKET_PROFILE_PRIVATE_KEY_UNAVAILABLE',
        message:
          'Profile-based signer resolved without exportable private key material; Polymarket API inventory and live hedges may require explicit POLYMARKET_PRIVATE_KEY/POLYMARKET_FUNDER credentials.',
      });
    }
  } catch (err) {
    pushRunDiagnostic(diagnostics, {
      level: 'warn',
      scope: 'inventory-adoption',
      iteration: 0,
      timestamp: now().toISOString(),
      code: err && err.code ? String(err.code) : 'POLYMARKET_AUTH_CONTEXT_UNAVAILABLE',
      message:
        err && err.message
          ? err.message
          : 'Unable to resolve Polymarket execution context from profile/env selectors.',
    });
    polymarketExecutionContext = null;
  }
  try {
    polymarketInventoryReadClient = await resolvePolymarketInventoryReadClient(options, deps);
  } catch (err) {
    pushRunDiagnostic(diagnostics, {
      level: 'warn',
      scope: 'inventory-adoption',
      iteration: 0,
      timestamp: now().toISOString(),
      code: err && err.code ? String(err.code) : 'POLYMARKET_INVENTORY_RPC_UNAVAILABLE',
      message:
        err && err.message
          ? err.message
          : 'Unable to initialize Polymarket read client for on-chain inventory fallback.',
    });
    polymarketInventoryReadClient = null;
  }
  try {
    polymarketInventoryAddress = await resolvePolymarketInventoryAddress(options, deps, polymarketExecutionContext);
  } catch (err) {
    pushRunDiagnostic(diagnostics, {
      level: 'warn',
      scope: 'inventory-adoption',
      iteration: 0,
      timestamp: now().toISOString(),
      code: err && err.code ? String(err.code) : 'POLYMARKET_INVENTORY_ADDRESS_UNAVAILABLE',
      message: err && err.message ? err.message : 'Unable to resolve Polymarket inventory address for managed inventory adoption.',
    });
  }
  try {
    pendingActionRecoveryClient = await resolvePendingActionRecoveryClient(options, deps);
  } catch (err) {
    pushRunDiagnostic(diagnostics, {
      level: 'warn',
      scope: 'pending-action-recovery',
      iteration: 0,
      timestamp: now().toISOString(),
      code: err && err.code ? String(err.code) : 'MIRROR_PENDING_ACTION_RECOVERY_UNAVAILABLE',
      message:
        err && err.message
          ? err.message
          : 'Unable to initialize Pandora receipt checks for pending-action auto-recovery.',
    });
  }

  const maxIterations = options.mode === 'once' ? 1 : options.iterations || Number.POSITIVE_INFINITY;
  const minimumTimeToCloseSec = resolveMinimumTimeToCloseSec(options);
  const priceSource = normalizePriceSource(options.priceSource);
  let iteration = 0;
  let shouldStop = false;
  let stoppedReason = null;
  let startupVerifyPayload = null;

  const stopHandler = () => {
    shouldStop = true;
  };

  process.on('SIGINT', stopHandler);
  process.on('SIGTERM', stopHandler);

  try {
    startupVerifyPayload = await runStartupVerify({
      verifyFn,
      options,
      minimumTimeToCloseSec,
      buildVerifyRequest,
      createServiceError,
    });

    while (!shouldStop && iteration < maxIterations) {
      iteration += 1;
      const tickAt = now();

      // Kill-switch file is an execution safety guard for live writes.
      // Paper mode should continue to emit diagnostics/snapshots.
      if (options.executeLive && killSwitchFile && fs.existsSync(killSwitchFile)) {
        stoppedReason = `Kill switch file detected at ${killSwitchFile}`;
        break;
      }

      try {
        resetDailyCountersIfNeeded(state, tickAt);

        let verifyPayload =
          iteration === 1 && startupVerifyPayload
            ? startupVerifyPayload
            : await verifyFn(buildVerifyRequest(options));
        let reserveContext = buildReserveContext(verifyPayload);
        const shouldSeedInventoryFromChain =
          Boolean(inventoryAddress)
          && priceSource !== 'on-chain'
          && (
            !state.accounting
            || state.accounting.pandoraInventoryAddress !== inventoryAddress
            || state.accounting.pandoraWalletYesUsdc === undefined
            || state.accounting.pandoraWalletNoUsdc === undefined
          );
        if (priceSource === 'on-chain') {
          try {
            const onchainReserveContext = await readReserveContext({
              rpcUrl: options.rpcUrl,
              marketAddress: options.pandoraMarketAddress,
              inventoryAddress,
              now: tickAt,
            });
            if (onchainReserveContext) {
              reserveContext = onchainReserveContext;
            }
          } catch (err) {
            reserveContext = buildReserveContext(verifyPayload, {
              source: 'verify-payload-fallback',
              readAt: tickAt.toISOString(),
              readError: err && err.message ? err.message : String(err),
            });
            const diagnostic = {
              level: 'warn',
              scope: 'reserve-source',
              iteration,
              timestamp: tickAt.toISOString(),
              code: err && err.code ? String(err.code) : 'MIRROR_ONCHAIN_RESERVES_UNAVAILABLE',
              message:
                reserveContext.readError
                || 'Failed to refresh on-chain Pandora reserve context; falling back to verify payload reserves.',
            };
            pushRunDiagnostic(diagnostics, diagnostic);
            if (options.executeLive) {
              throw createServiceError(
                'MIRROR_ONCHAIN_RESERVES_UNAVAILABLE',
                'Live mirror sync could not read Pandora reserves on-chain.',
                {
                  cause: reserveContext.readError,
                  diagnostic,
                },
              );
            }
          }
        } else if (shouldSeedInventoryFromChain) {
          try {
            const inventoryReserveContext = await readReserveContext({
              rpcUrl: options.rpcUrl,
              marketAddress: options.pandoraMarketAddress,
              inventoryAddress,
              includePoolReserves: false,
              now: tickAt,
            });
            if (inventoryReserveContext) {
              reserveContext = {
                ...reserveContext,
                ...inventoryReserveContext,
                reserveYesUsdc: reserveContext.reserveYesUsdc,
                reserveNoUsdc: reserveContext.reserveNoUsdc,
                pandoraYesPct: reserveContext.pandoraYesPct,
                feeTier: reserveContext.feeTier,
              };
            }
          } catch (err) {
            pushRunDiagnostic(diagnostics, {
              level: 'warn',
              scope: 'inventory-offset',
              iteration,
              timestamp: tickAt.toISOString(),
              code: err && err.code ? String(err.code) : 'MIRROR_INVENTORY_OFFSET_UNAVAILABLE',
              message:
                err && err.message
                  ? err.message
                  : 'Unable to read Pandora wallet outcome balances; continuing without wallet-offset hedge relief.',
            });
          }
        }
        verifyPayload = applyReserveContext(verifyPayload, reserveContext);
        if (inventoryAddress || reserveContext.walletYesUsdc !== null || reserveContext.walletNoUsdc !== null) {
          state.accounting = {
            ...(state.accounting && typeof state.accounting === 'object' ? state.accounting : {}),
            pandoraInventoryAddress: inventoryAddress || reserveContext.inventoryAddress || null,
            pandoraWalletYesUsdc:
              reserveContext.walletYesUsdc !== null && reserveContext.walletYesUsdc !== undefined
                ? reserveContext.walletYesUsdc
                : state.accounting && state.accounting.pandoraWalletYesUsdc !== undefined
                  ? state.accounting.pandoraWalletYesUsdc
                  : null,
            pandoraWalletNoUsdc:
              reserveContext.walletNoUsdc !== null && reserveContext.walletNoUsdc !== undefined
                ? reserveContext.walletNoUsdc
                : state.accounting && state.accounting.pandoraWalletNoUsdc !== undefined
                  ? state.accounting.pandoraWalletNoUsdc
                  : null,
            pandoraWalletReadAt: reserveContext.readAt || (state.accounting && state.accounting.pandoraWalletReadAt) || null,
            pandoraWalletSource: reserveContext.source || (state.accounting && state.accounting.pandoraWalletSource) || null,
            pandoraOutcomeYesToken: reserveContext.yesToken || (state.accounting && state.accounting.pandoraOutcomeYesToken) || null,
            pandoraOutcomeNoToken: reserveContext.noToken || (state.accounting && state.accounting.pandoraOutcomeNoToken) || null,
          };
        }
        if (adoptExistingPositions && iteration === 1) {
          if (polymarketInventoryAddress) {
            try {
              const sourceMarket = verifyPayload && verifyPayload.sourceMarket ? verifyPayload.sourceMarket : {};
              const positionSummary = await positionSummaryFn({
                walletAddress: polymarketInventoryAddress,
                marketId: sourceMarket.marketId || options.polymarketMarketId || null,
                slug: sourceMarket.slug || options.polymarketSlug || null,
                yesTokenId: sourceMarket.yesTokenId || null,
                noTokenId: sourceMarket.noTokenId || null,
                host: options.polymarketHost,
                mockUrl: options.polymarketMockUrl,
                rpcUrl: options.polymarketRpcUrl || options.rpcUrl || null,
                source: 'auto',
                privateKey: polymarketExecutionContext && polymarketExecutionContext.privateKey
                  ? polymarketExecutionContext.privateKey
                  : null,
                funder: polymarketExecutionContext && polymarketExecutionContext.funder
                  ? polymarketExecutionContext.funder
                  : null,
                apiWalletAddress: polymarketExecutionContext && polymarketExecutionContext.signerAddress
                  ? polymarketExecutionContext.signerAddress
                  : null,
                apiKey: polymarketExecutionContext && polymarketExecutionContext.apiKey
                  ? polymarketExecutionContext.apiKey
                  : null,
                apiSecret: polymarketExecutionContext && polymarketExecutionContext.apiSecret
                  ? polymarketExecutionContext.apiSecret
                  : null,
                apiPassphrase: polymarketExecutionContext && polymarketExecutionContext.apiPassphrase
                  ? polymarketExecutionContext.apiPassphrase
                  : null,
                publicClient: polymarketInventoryReadClient || null,
              });
              const managedInventorySeed = {
                ...extractManagedInventorySeed(positionSummary, polymarketInventoryAddress),
                adoptedAt: tickAt.toISOString(),
              };
              state.accounting = {
                ...(state.accounting && typeof state.accounting === 'object' ? state.accounting : {}),
                polymarketInventoryAddress,
                managedInventorySeed,
                managedPolymarketYesShares: managedInventorySeed.yesShares,
                managedPolymarketNoShares: managedInventorySeed.noShares,
                managedPolymarketYesUsdc: managedInventorySeed.yesShares,
                managedPolymarketNoUsdc: managedInventorySeed.noShares,
              };
              state.currentHedgeShares = round((managedInventorySeed.yesShares || 0) - (managedInventorySeed.noShares || 0), 6) || 0;
              state.currentHedgeUsdc = state.currentHedgeShares;
              pushRunDiagnostic(diagnostics, {
                level: 'info',
                scope: 'inventory-adoption',
                iteration,
                timestamp: tickAt.toISOString(),
                code: 'POLYMARKET_INVENTORY_ADOPTED',
                message:
                  managedInventorySeed.status === 'partial'
                    ? `Polymarket inventory adoption from ${polymarketInventoryAddress} stayed fail-closed because open-order detail was incomplete.`
                    : `Adopted existing Polymarket YES/NO inventory from ${polymarketInventoryAddress}.`,
                details: {
                  status: managedInventorySeed.status,
                  yesShares: managedInventorySeed.yesShares,
                  noShares: managedInventorySeed.noShares,
                  reservedYesShares: managedInventorySeed.reservedYesShares,
                  reservedNoShares: managedInventorySeed.reservedNoShares,
                  openOrdersCount: managedInventorySeed.openOrdersCount,
                  source: managedInventorySeed.source,
                },
              });
            } catch (err) {
              pushRunDiagnostic(diagnostics, {
                level: 'warn',
                scope: 'inventory-adoption',
                iteration,
                timestamp: tickAt.toISOString(),
                code: err && err.code ? String(err.code) : 'POLYMARKET_INVENTORY_ADOPTION_FAILED',
                message: err && err.message ? err.message : 'Unable to adopt existing Polymarket inventory; continuing with daemon-tracked inventory only.',
              });
            }
          } else {
            pushRunDiagnostic(diagnostics, {
              level: 'warn',
              scope: 'inventory-adoption',
              iteration,
              timestamp: tickAt.toISOString(),
              code: 'POLYMARKET_INVENTORY_ADDRESS_MISSING',
              message: 'Skipping existing-position adoption because no Polymarket inventory address was resolved.',
            });
          }
        }
        const tickOptions = {
          ...options,
          priceSource,
          polymarketPrivateKey: polymarketExecutionContext && polymarketExecutionContext.privateKey
            ? polymarketExecutionContext.privateKey
            : null,
          polymarketFunder: polymarketExecutionContext && polymarketExecutionContext.funder
            ? polymarketExecutionContext.funder
            : null,
          polymarketApiKey: polymarketExecutionContext && polymarketExecutionContext.apiKey
            ? polymarketExecutionContext.apiKey
            : null,
          polymarketApiSecret: polymarketExecutionContext && polymarketExecutionContext.apiSecret
            ? polymarketExecutionContext.apiSecret
            : null,
          polymarketApiPassphrase: polymarketExecutionContext && polymarketExecutionContext.apiPassphrase
            ? polymarketExecutionContext.apiPassphrase
            : null,
          polymarketAuthContext: polymarketExecutionContext
            ? {
              signerAddress: polymarketExecutionContext.signerAddress || null,
              profileBacked: Boolean(polymarketExecutionContext.profileBacked),
              profileBackend: polymarketExecutionContext.profileBackend || null,
              profileDerivedPrivateKey: Boolean(polymarketExecutionContext.profileDerivedPrivateKey),
            }
            : null,
          _runtimeReserveContext: reserveContext,
        };

        const snapshotMetrics = evaluateSnapshot(verifyPayload, tickOptions);
        const plan = buildTickPlan({
          snapshotMetrics,
          state,
          options: tickOptions,
        });
        if (
          options.executeLive
          && plan.rebalanceSizingMode === 'atomic'
          && snapshotMetrics.driftTriggered
          && !(plan.plannedRebalanceUsdc > 0)
        ) {
          throw createServiceError(
            'MIRROR_ATOMIC_REBALANCE_UNAVAILABLE',
            'Live mirror sync could not compute a non-zero atomic Pandora rebalance.',
            {
              rebalanceSizingBasis: plan.rebalanceSizingBasis,
              reserveSource: plan.reserveSource || null,
              driftBps: snapshotMetrics.driftBps,
              sourceYesPct: snapshotMetrics.sourceYesPct,
              pandoraYesPct: snapshotMetrics.pandoraYesPct,
            },
          );
        }
        const depth = await fetchDepthSnapshot({
          depthFn,
          verifyPayload,
          options: tickOptions,
        });

        const gate = applyGateBypassPolicy(
          evaluateStrictGates(
            buildTickGateContext({
              verifyPayload,
              options: tickOptions,
              state,
              plan,
              snapshotMetrics,
              depth,
              minimumTimeToCloseSec,
            }),
          ),
          options,
        );

        const snapshot = buildTickSnapshot({
          iteration,
          tickAt,
          verifyPayload,
          options: tickOptions,
          snapshotMetrics,
          state,
          plan,
          depth,
          gate,
        });

        if (snapshotMetrics.driftTriggered || plan.hedgeTriggered) {
          await processTriggeredAction({
            options: tickOptions,
            state,
            snapshot,
            plan,
            gate,
            tickAt,
            loadedFilePath: loaded.filePath,
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
            pendingActionRecoveryClient,
          });
        }

        await persistTickSnapshot({
          loadedFilePath: loaded.filePath,
          state,
          tickAt,
          snapshot,
          snapshots,
          onTick,
          iteration,
        });
      } catch (err) {
        const errorCode = err && err.code ? String(err.code) : 'MIRROR_SYNC_TICK_FAILED';
        const errorMessage = err && err.message ? err.message : String(err);
        const errorDetails = err && err.details !== undefined ? err.details : null;
        const timestamp = tickAt.toISOString();

        const diagnostic = {
          level: 'error',
          scope: 'tick',
          iteration,
          timestamp,
          code: errorCode,
          message: errorMessage,
          retryable: options.mode !== 'once',
        };
        if (errorDetails !== null) diagnostic.details = errorDetails;
        pushRunDiagnostic(diagnostics, diagnostic);

        const snapshot = {
          schemaVersion: MIRROR_SYNC_SCHEMA_VERSION,
          timestamp,
          iteration,
          metrics: {
            driftBps: null,
            plannedRebalanceUsdc: 0,
            plannedHedgeUsdc: 0,
          },
          strictGate: {
            ok: false,
            failedChecks: [],
            checks: [],
          },
          action: {
            status: 'error',
            failedChecks: [],
            forcedGateBypass: false,
            errorCode,
            errorMessage,
          },
          error: {
            code: errorCode,
            message: errorMessage,
            details: errorDetails,
          },
        };

        await persistTickSnapshot({
          loadedFilePath: loaded.filePath,
          state,
          tickAt,
          snapshot,
          snapshots,
          onTick,
          iteration,
        });

        if (options.mode === 'once') {
          throw err;
        }
      }

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

  const executableActions = actions.filter((action) => {
    if (!(action && typeof action === 'object')) return false;
    return action.status !== 'blocked' && action.status !== 'skipped';
  });

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
      trustDeploy: Boolean(options.trustDeploy),
      forceGate: Boolean(options.forceGate),
      skipGateChecks: normalizeSkipGateChecks(options.skipGateChecks),
      intervalMs: options.intervalMs,
      minimumTimeToCloseSec,
      driftTriggerBps: options.driftTriggerBps,
      hedgeTriggerUsdc: options.hedgeTriggerUsdc,
      hedgeEnabled: options.hedgeEnabled,
      hedgeScope: options.hedgeScope,
      hedgeRatio: options.hedgeRatio,
      adoptExistingPositions,
      verbose: Boolean(options.verbose),
      maxRebalanceUsdc: options.maxRebalanceUsdc,
      maxHedgeUsdc: options.maxHedgeUsdc,
      maxOpenExposureUsdc: options.maxOpenExposureUsdc,
      maxTradesPerDay: options.maxTradesPerDay,
      cooldownMs: options.cooldownMs,
      depthSlippageBps: options.depthSlippageBps,
      rebalanceSizingMode: options.rebalanceSizingMode,
      priceSource,
    },
    stateFile: loaded.filePath,
    killSwitchFile,
    iterationsRequested: Number.isFinite(maxIterations) ? maxIterations : null,
    iterationsCompleted: snapshots.length,
    stoppedReason,
    state,
    actionCount: executableActions.length,
    actions: executableActions,
    snapshots,
    webhookReports,
    diagnostics,
  };
}

/**
 * Public mirror sync API consumed by CLI `mirror sync` commands.
 * @typedef {object} MirrorSyncApi
 * @property {string} MIRROR_SYNC_SCHEMA_VERSION JSON payload schema version.
 * @property {readonly string[]} MIRROR_SYNC_GATE_CODES Supported strict-gate check codes.
 * @property {(options: object, deps?: object) => Promise<object>} runMirrorSync Mirror sync runner.
 */

/** @type {MirrorSyncApi} */
module.exports = {
  MIRROR_SYNC_SCHEMA_VERSION,
  MIRROR_SYNC_GATE_CODES,
  runMirrorSync,
};
