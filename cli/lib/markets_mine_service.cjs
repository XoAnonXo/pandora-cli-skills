const { DEFAULT_INDEXER_URL, DEFAULT_RPC_BY_CHAIN_ID } = require('./shared/constants.cjs');
const { round, isSecureHttpUrlOrLocal } = require('./shared/utils.cjs');
const { createIndexerClient } = require('./indexer_client.cjs');
const { materializeExecutionSigner } = require('./signers/execution_signer_service.cjs');

const SCHEMA_VERSION = '1.0.0';
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_DISCOVERY_LIMIT = 500;
const MARKET_FIELDS = [
  'id',
  'chainId',
  'pollAddress',
  'marketType',
  'marketCloseTimestamp',
  'currentTvl',
  'totalVolume',
  'yesChance',
  'reserveYes',
  'reserveNo',
  'createdAt',
];
const POLL_FIELDS = ['id', 'question', 'status', 'category', 'deadlineEpoch', 'createdAt'];

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`discoverOwnedMarkets requires deps.${name}()`);
  }
  return deps[name];
}

function createCliStyleError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function normalizeAddress(value) {
  const raw = String(value || '').trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(raw) ? raw : null;
}

function normalizeTimeoutMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.trunc(numeric);
}

function normalizeChainId(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return 1;
  return numeric;
}

function normalizeMaybeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeMaybeBigInt(value) {
  if (value === undefined || value === null || value === '') return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function hasPositiveRaw(value) {
  const raw = normalizeMaybeBigInt(value);
  return raw !== null && raw > 0n;
}

function hasPositiveNumber(value) {
  const numeric = normalizeMaybeNumber(value);
  return numeric !== null && numeric > 0;
}

function formatRawDecimal(rawValue, decimals) {
  const raw = normalizeMaybeBigInt(rawValue);
  if (raw === null) return null;
  const places = Number.isInteger(decimals) && decimals >= 0 ? decimals : 0;
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const text = abs.toString();
  if (places === 0) {
    return `${negative ? '-' : ''}${text}`;
  }
  const padded = text.padStart(places + 1, '0');
  const whole = padded.slice(0, -places) || '0';
  const fraction = padded.slice(-places).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function flattenDiagnostics(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (typeof value === 'object') {
    return Object.values(value).flatMap((entry) => flattenDiagnostics(entry));
  }
  return [String(value)];
}

function buildChain(chainId, rpcUrl) {
  return {
    id: chainId,
    name: chainId === 1 ? 'Ethereum' : `Chain ${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
  };
}

function hasSignerSelector(options = {}) {
  return Boolean(
    String(options.privateKey || '').trim()
    || String(options.profileId || '').trim()
    || String(options.profileFile || '').trim(),
  );
}

async function loadViemRuntime() {
  const viem = await import('viem');
  const accounts = await import('viem/accounts');
  return { ...viem, ...accounts };
}

async function resolveWalletFromOptions(options = {}) {
  const explicitWallet = normalizeAddress(options.wallet);
  if (explicitWallet) {
    return {
      wallet: explicitWallet,
      walletSource: 'flag',
      signerResolved: false,
    };
  }

  if (!hasSignerSelector(options)) {
    throw createCliStyleError(
      'MISSING_REQUIRED_FLAG',
      'markets mine requires --wallet <address> or signer credentials (--private-key or --profile-id/--profile-file).',
    );
  }

  const privateKey = String(options.privateKey || '').trim();
  if (privateKey) {
    const viemRuntime = await loadViemRuntime();
    return {
      wallet: viemRuntime.privateKeyToAccount(privateKey).address.toLowerCase(),
      walletSource: 'private-key',
      signerResolved: true,
    };
  }

  const chainId = normalizeChainId(options.chainId);
  const rpcUrl = String(options.rpcUrl || process.env.RPC_URL || DEFAULT_RPC_BY_CHAIN_ID[chainId] || '').trim();
  if (!isSecureHttpUrlOrLocal(rpcUrl)) {
    throw createCliStyleError(
      'MISSING_REQUIRED_FLAG',
      'markets mine needs --rpc-url <url> (or RPC_URL) to resolve the current signer from --profile-id/--profile-file.',
    );
  }

  const viemRuntime = await loadViemRuntime();
  const materialized = await materializeExecutionSigner({
    privateKey: null,
    profileId: options.profileId || null,
    profileFile: options.profileFile || null,
    chainId,
    chain: buildChain(chainId, rpcUrl),
    rpcUrl,
    viemRuntime,
    env: process.env,
    requireSigner: true,
    mode: 'read',
    liveRequested: false,
    mutating: false,
    command: 'markets.mine',
    toolFamily: 'markets',
    metadata: {
      source: 'markets.mine',
      action: 'discover-wallet',
    },
  });

  return {
    wallet: normalizeAddress(materialized && materialized.signerAddress),
    walletSource: materialized && materialized.signerMetadata && materialized.signerMetadata.backend
      ? materialized.signerMetadata.backend
      : 'profile',
    signerResolved: true,
  };
}

async function fetchMarketMetadata(indexerUrl, marketAddresses, timeoutMs) {
  const ids = Array.from(new Set((marketAddresses || []).map(normalizeAddress).filter(Boolean)));
  if (!ids.length) {
    return {
      marketsByAddress: new Map(),
      pollsById: new Map(),
      diagnostics: [],
    };
  }

  const diagnostics = [];
  const client = createIndexerClient(indexerUrl, timeoutMs);
  let marketsByAddress = new Map();
  let pollsById = new Map();

  try {
    marketsByAddress = await client.getManyByIds({ queryName: 'markets', fields: MARKET_FIELDS, ids });
  } catch (error) {
    diagnostics.push(`Market metadata lookup failed: ${error && error.message ? error.message : String(error)}`);
    return { marketsByAddress, pollsById, diagnostics };
  }

  const pollIds = Array.from(
    new Set(
      Array.from(marketsByAddress.values())
        .map((market) => normalizeAddress(market && market.pollAddress))
        .filter(Boolean),
    ),
  );

  if (!pollIds.length) {
    return { marketsByAddress, pollsById, diagnostics };
  }

  try {
    pollsById = await client.getManyByIds({ queryName: 'polls', fields: POLL_FIELDS, ids: pollIds });
  } catch (error) {
    diagnostics.push(`Poll metadata lookup failed: ${error && error.message ? error.message : String(error)}`);
  }

  return { marketsByAddress, pollsById, diagnostics };
}

function buildPositionExposure(position) {
  if (!position) return null;
  const yesBalance = normalizeMaybeNumber(position.yesBalance);
  const noBalance = normalizeMaybeNumber(position.noBalance);
  const hasExposure = (yesBalance !== null && yesBalance > 0) || (noBalance !== null && noBalance > 0);
  if (!hasExposure) return null;
  return {
    positionSide: position.positionSide || null,
    yesBalance,
    noBalance,
    markValueUsdc: normalizeMaybeNumber(position.markValueUsdc),
    question: position.question || null,
    odds: position.odds || null,
    liquidity: position.liquidity || null,
    lastTradeAt: position.lastTradeAt || null,
  };
}

function buildLpExposure(lpPosition) {
  if (!lpPosition) {
    return null;
  }
  const outcomeTokens = lpPosition.outcomeTokens && typeof lpPosition.outcomeTokens === 'object'
    ? {
        ...lpPosition.outcomeTokens,
        claimableAmount: lpPosition.outcomeTokens.claimableAmount || null,
        claimableAmountRaw: lpPosition.outcomeTokens.claimableAmountRaw || null,
        claimableUsdc: lpPosition.outcomeTokens.claimableUsdc || null,
      }
    : null;
  const hasLpBalance = hasPositiveRaw(lpPosition.lpTokenBalanceRaw);
  const hasClaimableOutcomeInventory = Boolean(
    outcomeTokens
    && (
      outcomeTokens.hasClaimableInventory === true
      || hasPositiveRaw(outcomeTokens.claimableAmountRaw)
    ),
  );
  if (!hasLpBalance && !hasClaimableOutcomeInventory) {
    return null;
  }
  return {
    lpTokenBalanceRaw: lpPosition.lpTokenBalanceRaw,
    lpTokenBalance: lpPosition.lpTokenBalance || null,
    lpTokenDecimals: Number.isInteger(lpPosition.lpTokenDecimals) ? lpPosition.lpTokenDecimals : null,
    estimatedCollateralOutUsdc: normalizeMaybeNumber(lpPosition && lpPosition.preview && lpPosition.preview.collateralOutUsdc),
    preview: lpPosition.preview || null,
    outcomeTokens,
    settledClaimInventoryOnly: !hasLpBalance && hasClaimableOutcomeInventory,
  };
}

function buildClaimExposure(claimItem, supportsClaimableExposure) {
  if (!claimItem || !claimItem.ok || !claimItem.result) return null;
  const result = claimItem.result;
  const estimatedClaimRaw = result.preflight && result.preflight.estimatedClaimRaw
    ? String(result.preflight.estimatedClaimRaw)
    : null;
  const estimatedClaimUsdc = estimatedClaimRaw === null ? null : formatRawDecimal(estimatedClaimRaw, 6);
  const estimatedClaimNumeric = estimatedClaimUsdc === null ? null : normalizeMaybeNumber(estimatedClaimUsdc);
  const hasEstimatedClaim = estimatedClaimNumeric !== null && estimatedClaimNumeric > 0;
  const marketClaimable = Boolean(result.claimable);
  const hasClaimableExposure = hasEstimatedClaim || (marketClaimable && supportsClaimableExposure);
  return {
    hasClaimableExposure,
    marketClaimable,
    estimatedClaimRaw,
    estimatedClaimUsdc,
    pollFinalized: result.resolution ? result.resolution.pollFinalized : null,
    pollAnswer: result.resolution ? result.resolution.pollAnswer : null,
    finalizationEpoch: result.resolution ? result.resolution.finalizationEpoch : null,
    currentEpoch: result.resolution ? result.resolution.currentEpoch : null,
    diagnostics: flattenDiagnostics(result.diagnostics),
  };
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

async function discoverOwnedMarkets(options = {}, deps = {}) {
  const collectPortfolioSnapshot = requireDep(deps, 'collectPortfolioSnapshot');
  const runClaim = requireDep(deps, 'runClaim');
  const generatedAt = new Date().toISOString();
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const chainId = normalizeChainId(options.chainId);
  const indexerUrl = String(
    options.indexerUrl || process.env.PANDORA_INDEXER_URL || process.env.INDEXER_URL || DEFAULT_INDEXER_URL,
  ).trim();
  const rpcUrl = String(options.rpcUrl || process.env.RPC_URL || DEFAULT_RPC_BY_CHAIN_ID[chainId] || '').trim() || null;
  const walletInfo = await resolveWalletFromOptions({ ...options, chainId, rpcUrl });
  const wallet = walletInfo.wallet;

  const snapshot = await collectPortfolioSnapshot(
    indexerUrl,
    {
      wallet,
      chainId,
      limit: DEFAULT_DISCOVERY_LIMIT,
      includeEvents: false,
      withLp: true,
      rpcUrl,
    },
    timeoutMs,
  );

  const claimPayload = await runClaim({
    all: true,
    execute: false,
    wallet,
    chainId,
    rpcUrl,
    indexerUrl,
    timeoutMs,
    privateKey: options.privateKey || null,
    profileId: options.profileId || null,
    profileFile: options.profileFile || null,
  });

  const positionsByMarket = new Map();
  for (const position of Array.isArray(snapshot.positions) ? snapshot.positions : []) {
    const marketAddress = normalizeAddress(position && position.marketAddress);
    if (!marketAddress || positionsByMarket.has(marketAddress)) continue;
    positionsByMarket.set(marketAddress, position);
  }

  const lpByMarket = new Map();
  for (const lpPosition of Array.isArray(snapshot.lpPositions) ? snapshot.lpPositions : []) {
    const marketAddress = normalizeAddress(lpPosition && lpPosition.marketAddress);
    if (!marketAddress || lpByMarket.has(marketAddress)) continue;
    lpByMarket.set(marketAddress, lpPosition);
  }

  const claimByMarket = new Map();
  for (const claimItem of Array.isArray(claimPayload.items) ? claimPayload.items : []) {
    const marketAddress = normalizeAddress(claimItem && claimItem.marketAddress);
    if (!marketAddress || claimByMarket.has(marketAddress)) continue;
    claimByMarket.set(marketAddress, claimItem);
  }

  const candidateMarkets = uniqueSorted([
    ...Array.from(positionsByMarket.keys()),
    ...Array.from(lpByMarket.keys()),
    ...Array.from(claimByMarket.keys()),
  ]);

  const metadata = await fetchMarketMetadata(indexerUrl, candidateMarkets, timeoutMs);
  const diagnostics = [
    ...flattenDiagnostics(snapshot.diagnostics),
    ...flattenDiagnostics(claimPayload.diagnostics),
    ...metadata.diagnostics,
  ];

  const items = [];
  for (const marketAddress of candidateMarkets) {
    const position = positionsByMarket.get(marketAddress) || null;
    const lpPosition = lpByMarket.get(marketAddress) || null;
    const claimItem = claimByMarket.get(marketAddress) || null;
    const tokenExposure = buildPositionExposure(position);
    const lpExposure = buildLpExposure(lpPosition);
    const hasLpExposure = Boolean(lpExposure && hasPositiveRaw(lpExposure.lpTokenBalanceRaw));
    const hasLpClaimableInventory = Boolean(
      lpExposure
      && lpExposure.outcomeTokens
      && (
        lpExposure.outcomeTokens.hasClaimableInventory === true
        || hasPositiveRaw(lpExposure.outcomeTokens.claimableAmountRaw)
      ),
    );
    const supportsClaimableExposure = Boolean(tokenExposure || hasLpExposure || hasLpClaimableInventory);
    const claimExposure = buildClaimExposure(claimItem, supportsClaimableExposure);

    const hasTokenExposure = Boolean(tokenExposure);
    const hasClaimableExposure = Boolean(claimExposure && claimExposure.hasClaimableExposure);
    if (!hasTokenExposure && !hasLpExposure && !hasClaimableExposure) {
      continue;
    }

    const marketRow = metadata.marketsByAddress.get(marketAddress) || null;
    const pollAddress = normalizeAddress(
      (claimItem && claimItem.ok && claimItem.result && claimItem.result.pollAddress)
      || (marketRow && marketRow.pollAddress),
    );
    const pollRow = pollAddress ? metadata.pollsById.get(pollAddress) || null : null;
    const itemDiagnostics = uniqueSorted([
      ...flattenDiagnostics(position && position.diagnostics),
      ...flattenDiagnostics(lpPosition && lpPosition.diagnostics),
      ...flattenDiagnostics(claimExposure && claimExposure.diagnostics),
      ...flattenDiagnostics(claimItem && !claimItem.ok ? `${claimItem.error.code}: ${claimItem.error.message}` : null),
    ]);

    const exposureTypes = [];
    if (hasTokenExposure) exposureTypes.push('token');
    if (hasLpExposure) exposureTypes.push('lp');
    if (hasClaimableExposure) exposureTypes.push('claimable');

    items.push({
      marketAddress,
      chainId: normalizeMaybeNumber((marketRow && marketRow.chainId) || (position && position.chainId) || chainId),
      pollAddress,
      question:
        (tokenExposure && tokenExposure.question)
        || (pollRow && pollRow.question)
        || null,
      marketType: marketRow && marketRow.marketType ? marketRow.marketType : null,
      marketCloseTimestamp: marketRow && marketRow.marketCloseTimestamp ? marketRow.marketCloseTimestamp : null,
      exposureTypes,
      hasTokenExposure,
      hasLpExposure,
      hasClaimableExposure,
      exposure: {
        token: tokenExposure,
        lp: lpExposure,
        claimable: claimExposure
          ? {
              marketClaimable: claimExposure.marketClaimable,
              estimatedClaimRaw: claimExposure.estimatedClaimRaw,
              estimatedClaimUsdc: claimExposure.estimatedClaimUsdc,
              pollFinalized: claimExposure.pollFinalized,
              pollAnswer: claimExposure.pollAnswer,
              finalizationEpoch: claimExposure.finalizationEpoch,
              currentEpoch: claimExposure.currentEpoch,
            }
          : null,
      },
      diagnostics: itemDiagnostics,
    });
  }

  items.sort((left, right) => {
    const leftQuestion = String(left && left.question ? left.question : '');
    const rightQuestion = String(right && right.question ? right.question : '');
    if (leftQuestion && rightQuestion && leftQuestion !== rightQuestion) {
      return leftQuestion.localeCompare(rightQuestion);
    }
    return String(left && left.marketAddress ? left.marketAddress : '').localeCompare(
      String(right && right.marketAddress ? right.marketAddress : ''),
    );
  });

  const exposureCounts = items.reduce(
    (acc, item) => ({
      token: acc.token + (item.hasTokenExposure ? 1 : 0),
      lp: acc.lp + (item.hasLpExposure ? 1 : 0),
      claimable: acc.claimable + (item.hasClaimableExposure ? 1 : 0),
    }),
    { token: 0, lp: 0, claimable: 0 },
  );

  if (!hasSignerSelector(options)) {
    diagnostics.push('Claimable exposure inference is best-effort without signer credentials; estimated claim amounts may be unavailable.');
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    mode: 'read',
    wallet,
    walletSource: walletInfo.walletSource,
    chainId,
    indexerUrl,
    runtime: {
      rpcUrl,
      signerResolved: walletInfo.signerResolved,
    },
    sources: {
      positions: {
        count: Array.isArray(snapshot.positions) ? snapshot.positions.length : 0,
      },
      lpPositions: {
        count: Array.isArray(snapshot.lpPositions) ? snapshot.lpPositions.length : 0,
      },
      claims: {
        candidateCount: Number.isInteger(claimPayload.count) ? claimPayload.count : 0,
        successCount: Number.isInteger(claimPayload.successCount) ? claimPayload.successCount : 0,
        failureCount: Number.isInteger(claimPayload.failureCount) ? claimPayload.failureCount : 0,
      },
    },
    count: items.length,
    exposureCounts,
    items,
    diagnostics: uniqueSorted(diagnostics),
  };
}

module.exports = {
  discoverOwnedMarkets,
  resolveWalletFromOptions,
  formatRawDecimal,
};
