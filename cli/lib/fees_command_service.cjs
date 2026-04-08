const { createIndexerClient, IndexerClientError } = require('./indexer_client.cjs');
const { DEFAULT_INDEXER_URL, DEFAULT_RPC_BY_CHAIN_ID } = require('./shared/constants.cjs');
const { isSecureHttpUrlOrLocal } = require('./shared/utils.cjs');
const { resolveForkRuntime } = require('./fork_runtime_service.cjs');
const { materializeExecutionSigner } = require('./signers/execution_signer_service.cjs');

const FEES_SCHEMA_VERSION = '1.2.0';
const ORACLE_FEE_FIELDS = [
  'id',
  'chainId',
  'chainName',
  'oracleAddress',
  'eventName',
  'newFee',
  'to',
  'amount',
  'txHash',
  'blockNumber',
  'timestamp',
];

const MARKET_PROTOCOL_FEES_ABI = [
  {
    type: 'function',
    name: 'protocolFeesCollected',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint112' }],
  },
  {
    type: 'function',
    name: 'collateralToken',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'creator',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'factory',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'withdrawProtocolFees',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [{ name: 'totalAmount', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'ProtocolFeesWithdrawn',
    anonymous: false,
    inputs: [
      { indexed: true, name: 'caller', type: 'address' },
      { indexed: false, name: 'platformShare', type: 'uint256' },
      { indexed: false, name: 'creatorShare', type: 'uint256' },
    ],
  },
];

const FACTORY_TREASURY_ABI = [
  {
    type: 'function',
    name: 'platformTreasury',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
];

const ERC20_METADATA_ABI = [
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
];

const FEE_MARKET_DISCOVERY_FIELDS = [
  'id',
  'chainId',
  'creator',
  'pollAddress',
];

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const PRIVATE_KEY_PATTERN = /^0x[a-fA-F0-9]{64}$/;

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunFeesCommand requires deps.${name}()`);
  }
  return deps[name];
}

function normalizeAddress(value) {
  const raw = String(value || '').trim();
  return ADDRESS_PATTERN.test(raw) ? raw : null;
}

function isValidPrivateKey(value) {
  return PRIVATE_KEY_PATTERN.test(String(value || '').trim());
}

function requireFlagValue(args, index, flagName, CliError) {
  if (index + 1 >= args.length || String(args[index + 1]).startsWith('--')) {
    throw new CliError('MISSING_REQUIRED_FLAG', `${flagName} requires a value.`);
  }
  return args[index + 1];
}

function parsePositiveInteger(value, flagName, CliError) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a positive integer.`);
  }
  return numeric;
}

function parseIntegerLike(value) {
  const raw = String(value ?? '').trim();
  if (!raw || !/^-?\d+$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

function toOptionalNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function round(value, decimals = 6) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
}

function toUsdcAmount(value) {
  const raw = parseIntegerLike(value);
  if (raw !== null) {
    return round(Number(raw) / 1_000_000, 6);
  }
  const numeric = toOptionalNumber(value);
  return numeric === null ? null : round(numeric / 1_000_000, 6);
}

function toTokenAmountString(rawValue, decimals) {
  try {
    const raw = BigInt(rawValue || 0);
    const precision = 10n ** BigInt(decimals);
    const whole = raw / precision;
    const fraction = raw % precision;
    const fractionText = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
    return fractionText ? `${whole.toString()}.${fractionText}` : whole.toString();
  } catch {
    return null;
  }
}

function normalizeOracleFeeEvent(item) {
  return {
    ...item,
    chainId: toOptionalNumber(item && item.chainId),
    newFeeBps: toOptionalNumber(item && item.newFee),
    amountUsdc: toUsdcAmount(item && item.amount),
    blockNumber: toOptionalNumber(item && item.blockNumber),
    timestamp: toOptionalNumber(item && item.timestamp),
  };
}

function sumRawIntegers(items, fieldName) {
  let total = 0n;
  let found = false;
  for (const item of Array.isArray(items) ? items : []) {
    const parsed = parseIntegerLike(item && item[fieldName]);
    if (parsed === null) continue;
    total += parsed;
    found = true;
  }
  return found ? total.toString() : null;
}

function buildSummary(items) {
  const normalized = Array.isArray(items) ? items : [];
  const totalAmountRaw = sumRawIntegers(normalized, 'amount');
  const totalAmountUsdc = totalAmountRaw === null ? 0 : toUsdcAmount(totalAmountRaw);
  const uniqueRecipients = Array.from(
    new Set(normalized.map((item) => String(item && item.to ? item.to : '').trim().toLowerCase()).filter(Boolean)),
  );
  const latestFeeUpdate = normalized.find((item) => item && item.newFeeBps !== null && item.newFeeBps !== undefined) || null;

  return {
    count: normalized.length,
    totalAmountRaw,
    totalAmountUsdc,
    uniqueRecipients,
    lastUpdatedFeeBps: latestFeeUpdate ? latestFeeUpdate.newFeeBps : null,
    eventNames: Array.from(new Set(normalized.map((item) => item.eventName).filter(Boolean))),
  };
}

function buildWhere(options) {
  const where = {};
  if (options.wallet) where.to = options.wallet;
  if (options.chainId !== null) where.chainId = options.chainId;
  if (options.txHash) where.txHash = options.txHash;
  if (options.eventName) where.eventName = options.eventName;
  return where;
}

function parseFeesReadFlags(args, CliError) {
  const parsed = {
    wallet: null,
    chainId: null,
    txHash: null,
    eventName: null,
    limit: 20,
    before: null,
    after: null,
    orderDirection: 'desc',
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i]);
    if (token === '--wallet') {
      parsed.wallet = normalizeAddress(requireFlagValue(args, i, '--wallet', CliError));
      if (!parsed.wallet) {
        throw new CliError('INVALID_FLAG_VALUE', '--wallet must be an EVM address.');
      }
      i += 1;
      continue;
    }
    if (token === '--chain-id') {
      parsed.chainId = parsePositiveInteger(requireFlagValue(args, i, '--chain-id', CliError), '--chain-id', CliError);
      i += 1;
      continue;
    }
    if (token === '--tx-hash') {
      parsed.txHash = String(requireFlagValue(args, i, '--tx-hash', CliError)).trim();
      i += 1;
      continue;
    }
    if (token === '--event-name') {
      parsed.eventName = String(requireFlagValue(args, i, '--event-name', CliError)).trim();
      i += 1;
      continue;
    }
    if (token === '--limit') {
      parsed.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit', CliError), '--limit', CliError);
      i += 1;
      continue;
    }
    if (token === '--before') {
      parsed.before = String(requireFlagValue(args, i, '--before', CliError)).trim();
      i += 1;
      continue;
    }
    if (token === '--after') {
      parsed.after = String(requireFlagValue(args, i, '--after', CliError)).trim();
      i += 1;
      continue;
    }
    if (token === '--order-direction') {
      const direction = String(requireFlagValue(args, i, '--order-direction', CliError)).trim().toLowerCase();
      if (direction !== 'asc' && direction !== 'desc') {
        throw new CliError('INVALID_FLAG_VALUE', '--order-direction must be asc|desc.');
      }
      parsed.orderDirection = direction;
      i += 1;
      continue;
    }
    throw new CliError('UNKNOWN_FLAG', `Unknown flag for fees: ${token}`);
  }

  return parsed;
}

async function fetchOracleFeeEvents(indexerUrl, options, timeoutMs) {
  const client = createIndexerClient(indexerUrl, timeoutMs);
  const page = await client.list({
    queryName: 'oracleFeeEventss',
    filterType: 'oracleFeeEventsFilter',
    fields: ORACLE_FEE_FIELDS,
    variables: {
      where: buildWhere(options),
      orderBy: 'timestamp',
      orderDirection: options.orderDirection,
      before: options.before,
      after: options.after,
      limit: options.limit,
    },
  });

  return {
    items: (page.items || []).map(normalizeOracleFeeEvent),
    pageInfo: page.pageInfo || null,
  };
}

function resolveIndexerUrl(explicitUrl) {
  return explicitUrl || process.env.PANDORA_INDEXER_URL || process.env.INDEXER_URL || DEFAULT_INDEXER_URL;
}

function createServiceError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function toCliError(error, CliError, fallbackCode, fallbackMessage) {
  if (error instanceof IndexerClientError) {
    return new CliError(error.code, error.message, error.details);
  }
  if (error && error.code) {
    return new CliError(error.code, error.message || fallbackMessage, error.details);
  }
  return new CliError(fallbackCode, fallbackMessage, {
    cause: error && error.message ? error.message : String(error),
  });
}

function buildChain(chainId, rpcUrl) {
  return {
    id: chainId,
    name: chainId === 1 ? 'Ethereum' : `Chain ${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
  };
}

async function loadViemRuntime(deps = {}) {
  if (deps.viemRuntime && typeof deps.viemRuntime === 'object') {
    return deps.viemRuntime;
  }
  const viem = await import('viem');
  const accounts = await import('viem/accounts');
  return { ...viem, ...accounts };
}

function assertNoMixedSignerSelectors(options, CliError) {
  const hasPrivateKey = Boolean(options.privateKey);
  const hasProfile = Boolean(options.profileId || options.profileFile);
  if (hasPrivateKey && hasProfile) {
    throw new CliError(
      'INVALID_ARGS',
      'Use either --private-key or --profile-id/--profile-file for fees withdraw, not both.',
    );
  }
}

function parseFeesWithdrawFlags(args, CliError) {
  const options = {
    marketAddress: null,
    allMarkets: false,
    creator: null,
    dryRun: false,
    execute: false,
    chainId: null,
    rpcUrl: null,
    fork: false,
    forkRpcUrl: null,
    forkChainId: null,
    privateKey: null,
    profileId: null,
    profileFile: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i]);
    if (token === '--market-address' || token === '--id') {
      options.marketAddress = normalizeAddress(requireFlagValue(args, i, token, CliError));
      if (!options.marketAddress) {
        throw new CliError('INVALID_FLAG_VALUE', `${token} must be an EVM address.`);
      }
      i += 1;
      continue;
    }
    if (token === '--all-markets') {
      options.allMarkets = true;
      continue;
    }
    if (token === '--creator') {
      options.creator = normalizeAddress(requireFlagValue(args, i, '--creator', CliError));
      if (!options.creator) {
        throw new CliError('INVALID_FLAG_VALUE', '--creator must be an EVM address.');
      }
      i += 1;
      continue;
    }
    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (token === '--execute') {
      options.execute = true;
      continue;
    }
    if (token === '--chain-id') {
      options.chainId = parsePositiveInteger(requireFlagValue(args, i, '--chain-id', CliError), '--chain-id', CliError);
      i += 1;
      continue;
    }
    if (token === '--rpc-url') {
      const rpcUrl = String(requireFlagValue(args, i, '--rpc-url', CliError)).trim();
      if (!isSecureHttpUrlOrLocal(rpcUrl)) {
        throw new CliError(
          'INVALID_FLAG_VALUE',
          '--rpc-url must use https:// (or http://localhost/127.0.0.1 for local testing).',
        );
      }
      options.rpcUrl = rpcUrl;
      i += 1;
      continue;
    }
    if (token === '--fork') {
      options.fork = true;
      continue;
    }
    if (token === '--fork-rpc-url') {
      const rpcUrl = String(requireFlagValue(args, i, '--fork-rpc-url', CliError)).trim();
      if (!isSecureHttpUrlOrLocal(rpcUrl)) {
        throw new CliError(
          'INVALID_FLAG_VALUE',
          '--fork-rpc-url must use https:// (or http://localhost/127.0.0.1 for local testing).',
        );
      }
      options.forkRpcUrl = rpcUrl;
      i += 1;
      continue;
    }
    if (token === '--fork-chain-id') {
      options.forkChainId = parsePositiveInteger(requireFlagValue(args, i, '--fork-chain-id', CliError), '--fork-chain-id', CliError);
      i += 1;
      continue;
    }
    if (token === '--private-key') {
      const privateKey = String(requireFlagValue(args, i, '--private-key', CliError)).trim();
      if (!isValidPrivateKey(privateKey)) {
        throw new CliError('INVALID_FLAG_VALUE', '--private-key must be 0x + 64 hex chars.');
      }
      options.privateKey = privateKey;
      i += 1;
      continue;
    }
    if (token === '--profile-id') {
      options.profileId = String(requireFlagValue(args, i, '--profile-id', CliError)).trim() || null;
      i += 1;
      continue;
    }
    if (token === '--profile-file') {
      options.profileFile = String(requireFlagValue(args, i, '--profile-file', CliError)).trim() || null;
      i += 1;
      continue;
    }
    throw new CliError('UNKNOWN_FLAG', `Unknown flag for fees withdraw: ${token}`);
  }

  if (options.marketAddress && options.allMarkets) {
    throw new CliError('INVALID_ARGS', 'fees withdraw accepts either --market-address <address> or --all-markets, not both.');
  }
  if (!options.marketAddress && !options.allMarkets) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'fees withdraw requires either --market-address <address> or --all-markets.');
  }
  if (options.creator && !options.allMarkets) {
    throw new CliError('INVALID_ARGS', '--creator is only supported together with --all-markets.');
  }
  if (options.allMarkets && !options.creator) {
    throw new CliError(
      'MISSING_REQUIRED_FLAG',
      'fees withdraw --all-markets requires --creator <address> so dry-run and execute sweep the same creator wallet.',
    );
  }
  if (options.dryRun === options.execute) {
    throw new CliError('INVALID_ARGS', 'Use exactly one mode for fees withdraw: --dry-run or --execute.');
  }
  assertNoMixedSignerSelectors(options, CliError);
  return options;
}

async function resolveWithdrawRuntime(options = {}, deps = {}) {
  const env = deps.env && typeof deps.env === 'object' ? deps.env : process.env;
  const forkRuntime = (deps.resolveForkRuntime || resolveForkRuntime)(options, {
    env,
    isSecureHttpUrlOrLocal,
    defaultChainId: 1,
  });

  const preferredChainId =
    forkRuntime.mode === 'fork'
      ? forkRuntime.chainId
      : options.chainId !== null && options.chainId !== undefined
        ? options.chainId
        : forkRuntime.chainId;
  const chainId = Number(
    preferredChainId !== null && preferredChainId !== undefined
      ? preferredChainId
      : env.CHAIN_ID || 1,
  );
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw createServiceError('INVALID_FLAG_VALUE', 'CHAIN_ID must be a positive integer.');
  }

  const rpcUrl = String(
    forkRuntime.mode === 'fork'
      ? forkRuntime.rpcUrl
      : options.rpcUrl || env.RPC_URL || DEFAULT_RPC_BY_CHAIN_ID[chainId] || '',
  ).trim();
  if (!isSecureHttpUrlOrLocal(rpcUrl)) {
    throw createServiceError(
      'INVALID_FLAG_VALUE',
      '--rpc-url must use https:// (or http://localhost/127.0.0.1 for local testing).',
      { rpcUrl },
    );
  }

  return {
    mode: forkRuntime.mode,
    chainId,
    rpcUrl,
    chain: buildChain(chainId, rpcUrl),
    privateKey: options.privateKey || String(env.PRIVATE_KEY || env.PANDORA_PRIVATE_KEY || '').trim() || null,
    profileId: options.profileId || null,
    profileFile: options.profileFile || null,
  };
}

async function readTokenMetadata(publicClient, collateralToken) {
  let decimals = 6;
  let symbol = 'TOKEN';

  try {
    const nextDecimals = await publicClient.readContract({
      address: collateralToken,
      abi: ERC20_METADATA_ABI,
      functionName: 'decimals',
    });
    const parsed = Number(nextDecimals);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 255) {
      decimals = parsed;
    }
  } catch {
    // fall back to USDC-style defaults
  }

  try {
    const nextSymbol = await publicClient.readContract({
      address: collateralToken,
      abi: ERC20_METADATA_ABI,
      functionName: 'symbol',
    });
    if (typeof nextSymbol === 'string' && nextSymbol.trim()) {
      symbol = nextSymbol.trim();
    }
  } catch {
    // fall back to generic symbol
  }

  return { decimals, symbol };
}

async function decodeWithdrawEvent(viemRuntime, receipt) {
  if (!receipt || !Array.isArray(receipt.logs) || typeof viemRuntime.decodeEventLog !== 'function') {
    return null;
  }

  for (const log of receipt.logs) {
    try {
      const decoded = viemRuntime.decodeEventLog({
        abi: MARKET_PROTOCOL_FEES_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded && decoded.eventName === 'ProtocolFeesWithdrawn') {
        return decoded.args || null;
      }
    } catch {
      // ignore unrelated logs
    }
  }
  return null;
}

function buildWithdrawPayload({
  marketAddress,
  runtime,
  signerAddress,
  collateralToken,
  symbol,
  decimals,
  creator,
  factory,
  platformTreasury,
  totalRaw,
  platformShareRaw,
  creatorShareRaw,
  simulation,
  execute,
}) {
  const diagnostics = [];
  if (!simulation.attempted && !execute) {
    diagnostics.push('Dry-run preview succeeded without signer-backed simulation. Pass --private-key or --profile-id/--profile-file to estimate gas.');
  }
  if (simulation.attempted && simulation.ok === false && simulation.error) {
    diagnostics.push(`Simulation failed: ${simulation.error}`);
  }
  if (totalRaw === 0n) {
    diagnostics.push('No protocol fees are currently collected on this market contract.');
  }

  return {
    schemaVersion: FEES_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    action: 'withdraw',
    mode: execute ? 'execute' : 'dry-run',
    status: totalRaw === 0n ? 'no-op' : (execute ? 'submitted' : 'planned'),
    marketAddress,
    runtime: {
      mode: runtime.mode,
      chainId: runtime.chainId,
      rpcUrl: runtime.rpcUrl,
      signerAddress,
    },
    contract: {
      marketAddress,
      functionName: 'withdrawProtocolFees',
      collateralToken,
      factory,
      creator,
      platformTreasury,
    },
    feeState: {
      withdrawableRaw: totalRaw.toString(),
      withdrawable: toTokenAmountString(totalRaw, decimals),
      platformShareRaw: platformShareRaw.toString(),
      platformShare: toTokenAmountString(platformShareRaw, decimals),
      creatorShareRaw: creatorShareRaw.toString(),
      creatorShare: toTokenAmountString(creatorShareRaw, decimals),
      decimals,
      symbol,
    },
    preflight: {
      executeSupported: true,
      simulationAttempted: simulation.attempted,
      simulationOk: simulation.ok,
      gasEstimate: simulation.gasEstimate,
    },
    tx: null,
    diagnostics,
  };
}

async function resolveWithdrawExecutionContext(options = {}, deps = {}) {
  const runtime = await resolveWithdrawRuntime(options, deps);
  const viemRuntime = await loadViemRuntime(deps);
  const publicClient = deps.publicClient || viemRuntime.createPublicClient({
    chain: runtime.chain,
    transport: viemRuntime.http(runtime.rpcUrl, { timeout: options.timeoutMs || 12_000 }),
  });

  let account = deps.account && typeof deps.account === 'object' ? deps.account : null;
  let signerAddress = null;
  if (account && account.address) {
    signerAddress = String(account.address).toLowerCase();
  }
  let walletClient = deps.walletClient || null;

  const needsSigner = Boolean(options.execute);
  const wantsSigner = Boolean(
    needsSigner
      || walletClient
      || signerAddress
      || runtime.privateKey
      || runtime.profileId
      || runtime.profileFile,
  );

  if (wantsSigner && (!walletClient || !signerAddress || !account)) {
    try {
      const materialized = await (deps.materializeExecutionSigner || materializeExecutionSigner)({
        privateKey: runtime.privateKey,
        profileId: runtime.profileId,
        profileFile: runtime.profileFile,
        chain: runtime.chain,
        chainId: runtime.chainId,
        rpcUrl: runtime.rpcUrl,
        viemRuntime,
        env: deps.env && typeof deps.env === 'object' ? deps.env : process.env,
        requireSigner: needsSigner,
        mode: options.execute ? 'execute' : 'read',
        liveRequested: options.execute && runtime.mode === 'live',
        mutating: Boolean(options.execute),
        command: 'fees.withdraw',
        toolFamily: 'fees',
        metadata: {
          source: 'fees-command',
          action: 'withdrawProtocolFees',
        },
      });
      account = materialized && materialized.account ? materialized.account : account;
      signerAddress = String(
        materialized && (materialized.signerAddress || (materialized.account && materialized.account.address) || ''),
      ).toLowerCase() || signerAddress;
      if (!walletClient) {
        walletClient = materialized && materialized.walletClient ? materialized.walletClient : null;
      }
    } catch (error) {
      if (needsSigner) {
        if (error && error.code) {
          throw createServiceError(error.code, error.message || 'Unable to materialize execution signer.', error.details);
        }
        throw error;
      }
    }
  }

  if (needsSigner && (!signerAddress || !walletClient || !account)) {
    throw createServiceError(
      'MISSING_REQUIRED_FLAG',
      'Missing signer credentials. Set PRIVATE_KEY/PANDORA_PRIVATE_KEY or pass --profile-id/--profile-file.',
    );
  }

  return {
    runtime,
    viemRuntime,
    publicClient,
    walletClient,
    account,
    signerAddress,
  };
}

function normalizeDiscoveredMarketRows(items, creator) {
  const normalizedCreator = creator ? String(creator).trim().toLowerCase() : null;
  const unique = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const marketAddress = normalizeAddress(item && (item.marketAddress || item.id));
    if (!marketAddress) continue;
    const rowCreator = normalizeAddress(item && item.creator);
    if (normalizedCreator && rowCreator && rowCreator.toLowerCase() !== normalizedCreator) continue;
    unique.set(marketAddress.toLowerCase(), {
      marketAddress: marketAddress.toLowerCase(),
      creator: rowCreator ? rowCreator.toLowerCase() : null,
      chainId: item && item.chainId !== undefined && item.chainId !== null ? Number(item.chainId) : null,
      pollAddress: normalizeAddress(item && item.pollAddress),
    });
  }
  return Array.from(unique.values());
}

async function discoverCreatorFeeMarkets(indexerUrl, options = {}, deps = {}) {
  const client = deps.indexerClient || createIndexerClient(indexerUrl, options.timeoutMs);
  const limit = 200;
  const discovered = [];
  let after = null;
  let pageCount = 0;

  while (pageCount < 100) {
    const page = await client.list({
      queryName: 'marketss',
      filterType: 'marketsFilter',
      fields: FEE_MARKET_DISCOVERY_FIELDS,
      variables: {
        where: {
          creator: options.creator,
          chainId: options.chainId,
        },
        orderBy: 'createdAt',
        orderDirection: 'desc',
        after,
        limit,
      },
    });

    discovered.push(...normalizeDiscoveredMarketRows(page.items, options.creator));
    pageCount += 1;
    const pageInfo = page && page.pageInfo ? page.pageInfo : null;
    if (!pageInfo || !pageInfo.hasNextPage || !pageInfo.endCursor) {
      break;
    }
    after = pageInfo.endCursor;
  }

  return {
    items: normalizeDiscoveredMarketRows(discovered, options.creator),
    capped: pageCount >= 100,
  };
}

function summarizeBatchWithdrawItems(items = []) {
  let withdrawableRawTotal = 0n;
  let platformShareRawTotal = 0n;
  let creatorShareRawTotal = 0n;
  let successCount = 0;
  let failureCount = 0;
  let noOpCount = 0;
  let submittedCount = 0;
  let plannedCount = 0;
  let decimals = null;
  let symbol = null;

  for (const entry of Array.isArray(items) ? items : []) {
    if (!entry || entry.ok !== true || !entry.result) {
      failureCount += 1;
      continue;
    }
    successCount += 1;
    const payload = entry.result;
    if (payload.status === 'no-op') {
      noOpCount += 1;
    }
    if (payload.status === 'submitted') {
      submittedCount += 1;
    }
    if (payload.status === 'planned') {
      plannedCount += 1;
    }
    const feeState = payload.feeState || {};
    try {
      withdrawableRawTotal += BigInt(feeState.withdrawableRaw || 0);
      platformShareRawTotal += BigInt(feeState.platformShareRaw || 0);
      creatorShareRawTotal += BigInt(feeState.creatorShareRaw || 0);
    } catch {
      // Ignore malformed raw values and keep batch execution moving.
    }
    if (decimals === null && Number.isInteger(Number(feeState.decimals))) {
      decimals = Number(feeState.decimals);
    }
    if (!symbol && typeof feeState.symbol === 'string' && feeState.symbol.trim()) {
      symbol = feeState.symbol.trim();
    }
  }

  return {
    marketCount: Array.isArray(items) ? items.length : 0,
    successCount,
    failureCount,
    noOpCount,
    submittedCount,
    plannedCount,
    withdrawableRawTotal: withdrawableRawTotal.toString(),
    platformShareRawTotal: platformShareRawTotal.toString(),
    creatorShareRawTotal: creatorShareRawTotal.toString(),
    withdrawableTotal: decimals === null ? null : toTokenAmountString(withdrawableRawTotal, decimals),
    platformShareTotal: decimals === null ? null : toTokenAmountString(platformShareRawTotal, decimals),
    creatorShareTotal: decimals === null ? null : toTokenAmountString(creatorShareRawTotal, decimals),
    decimals,
    symbol,
  };
}

function buildBatchWithdrawPayload({
  creator,
  indexerUrl,
  runtime,
  signerAddress,
  items,
  execute,
  capped,
}) {
  const summary = summarizeBatchWithdrawItems(items);
  const diagnostics = [];
  if (summary.marketCount === 0) {
    diagnostics.push('No creator-scoped markets were discovered for protocol-fee withdrawal.');
  }
  if (capped) {
    diagnostics.push('Market discovery reached the pagination cap before exhausting the creator market list.');
  }
  if (summary.failureCount > 0) {
    diagnostics.push(`${summary.failureCount} market withdrawal item(s) failed. Inspect item.error for details.`);
  }

  let status = execute ? 'submitted' : 'planned';
  if (summary.marketCount === 0 || summary.successCount === 0 && summary.failureCount === 0) {
    status = 'no-op';
  } else if (summary.failureCount > 0 && summary.successCount > 0) {
    status = 'partial';
  } else if (summary.failureCount > 0) {
    status = 'failed';
  } else if (summary.noOpCount === summary.marketCount) {
    status = 'no-op';
  }

  return {
    schemaVersion: FEES_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    action: 'withdraw-all-markets',
    mode: execute ? 'execute' : 'dry-run',
    status,
    creator,
    indexerUrl,
    runtime: {
      mode: runtime.mode,
      chainId: runtime.chainId,
      rpcUrl: runtime.rpcUrl,
      signerAddress,
    },
    summary,
    diagnostics,
    items,
  };
}

async function runMarketFeesWithdraw(options = {}, deps = {}) {
  const marketAddress = normalizeAddress(options.marketAddress);
  if (!marketAddress) {
    throw createServiceError('MISSING_REQUIRED_FLAG', 'fees withdraw requires --market-address <address>.');
  }

  const {
    runtime,
    viemRuntime,
    publicClient,
    walletClient,
    account,
    signerAddress,
  } = await resolveWithdrawExecutionContext(options, deps);

  let protocolFeesCollected;
  let collateralToken;
  let creator;
  let factory;
  try {
    [protocolFeesCollected, collateralToken, creator, factory] = await Promise.all([
      publicClient.readContract({
        address: marketAddress,
        abi: MARKET_PROTOCOL_FEES_ABI,
        functionName: 'protocolFeesCollected',
      }),
      publicClient.readContract({
        address: marketAddress,
        abi: MARKET_PROTOCOL_FEES_ABI,
        functionName: 'collateralToken',
      }),
      publicClient.readContract({
        address: marketAddress,
        abi: MARKET_PROTOCOL_FEES_ABI,
        functionName: 'creator',
      }),
      publicClient.readContract({
        address: marketAddress,
        abi: MARKET_PROTOCOL_FEES_ABI,
        functionName: 'factory',
      }),
    ]);
  } catch (error) {
    throw createServiceError(
      'FEES_WITHDRAW_UNSUPPORTED_MARKET',
      'Market does not expose the Pandora protocol-fee withdrawal surface.',
      {
        marketAddress,
        cause: error && error.message ? error.message : String(error),
      },
    );
  }

  let platformTreasury;
  try {
    platformTreasury = await publicClient.readContract({
      address: factory,
      abi: FACTORY_TREASURY_ABI,
      functionName: 'platformTreasury',
    });
  } catch (error) {
    throw createServiceError(
      'FEES_WITHDRAW_FACTORY_LOOKUP_FAILED',
      'Unable to resolve the market factory platform treasury address.',
      {
        marketAddress,
        factory,
        cause: error && error.message ? error.message : String(error),
      },
    );
  }

  const { decimals, symbol } = await readTokenMetadata(publicClient, collateralToken);
  const totalRaw = BigInt(protocolFeesCollected || 0);
  const platformShareRaw = totalRaw / 2n;
  const creatorShareRaw = totalRaw - platformShareRaw;

  const simulation = {
    attempted: false,
    ok: null,
    gasEstimate: null,
    request: null,
    error: null,
  };

  if (signerAddress && typeof publicClient.simulateContract === 'function' && totalRaw > 0n) {
    simulation.attempted = true;
    try {
      const simulationResult = await publicClient.simulateContract({
        account: account || signerAddress,
        address: marketAddress,
        abi: MARKET_PROTOCOL_FEES_ABI,
        functionName: 'withdrawProtocolFees',
      });
      simulation.ok = true;
      simulation.request = simulationResult && simulationResult.request ? simulationResult.request : null;
      if (simulation.request && simulation.request.gas !== undefined && simulation.request.gas !== null) {
        simulation.gasEstimate = simulation.request.gas.toString();
      }
    } catch (error) {
      simulation.ok = false;
      simulation.error = error && error.message ? error.message : String(error);
      if (options.execute) {
        throw createServiceError(
          'FEES_WITHDRAW_SIMULATION_FAILED',
          simulation.error,
          { marketAddress, signerAddress },
        );
      }
    }
  }

  const payload = buildWithdrawPayload({
    marketAddress,
    runtime,
    signerAddress,
    collateralToken: String(collateralToken).toLowerCase(),
    symbol,
    decimals,
    creator: String(creator).toLowerCase(),
    factory: String(factory).toLowerCase(),
    platformTreasury: String(platformTreasury).toLowerCase(),
    totalRaw,
    platformShareRaw,
    creatorShareRaw,
    simulation,
    execute: Boolean(options.execute),
  });

  if (!options.execute || totalRaw === 0n) {
    return payload;
  }

  const txHash = await walletClient.writeContract(
    simulation.request || {
      account: account || signerAddress,
      address: marketAddress,
      abi: MARKET_PROTOCOL_FEES_ABI,
      functionName: 'withdrawProtocolFees',
      args: [],
    },
  );
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const decodedEvent = await decodeWithdrawEvent(viemRuntime, receipt);

  payload.tx = {
    txHash,
    status: receipt && receipt.status ? receipt.status : null,
    blockNumber:
      receipt && receipt.blockNumber !== undefined && receipt.blockNumber !== null
        ? receipt.blockNumber.toString()
        : null,
  };
  if (decodedEvent) {
    payload.tx.withdrawal = {
      caller: decodedEvent.caller ? String(decodedEvent.caller).toLowerCase() : signerAddress,
      platformShareRaw: decodedEvent.platformShare !== undefined ? decodedEvent.platformShare.toString() : null,
      creatorShareRaw: decodedEvent.creatorShare !== undefined ? decodedEvent.creatorShare.toString() : null,
      platformShare:
        decodedEvent.platformShare !== undefined
          ? toTokenAmountString(decodedEvent.platformShare, decimals)
          : null,
      creatorShare:
        decodedEvent.creatorShare !== undefined
          ? toTokenAmountString(decodedEvent.creatorShare, decimals)
          : null,
    };
  }

  return payload;
}

async function runBatchFeesWithdraw(options = {}, deps = {}) {
  if (!options.allMarkets) {
    throw createServiceError('INVALID_ARGS', 'Batch fee withdrawal requires --all-markets.');
  }

  const context = await resolveWithdrawExecutionContext(options, deps);
  const creator = normalizeAddress(options.creator);
  if (!creator) {
    throw createServiceError(
      'MISSING_REQUIRED_FLAG',
      'fees withdraw --all-markets requires --creator <address> so the sweep target is explicit.',
    );
  }

  const indexerUrl = resolveIndexerUrl(options.indexerUrl);
  const discovery = await discoverCreatorFeeMarkets(indexerUrl, {
    creator,
    chainId: context.runtime.chainId,
    timeoutMs: options.timeoutMs,
  }, deps);

  const items = [];
  for (const discovered of discovery.items) {
    try {
      const result = await runMarketFeesWithdraw({
        ...options,
        creator,
        marketAddress: discovered.marketAddress,
        allMarkets: false,
      }, {
        ...deps,
        publicClient: context.publicClient,
        walletClient: context.walletClient,
        account: context.account,
        viemRuntime: context.viemRuntime,
      });
      items.push({
        marketAddress: discovered.marketAddress,
        ok: true,
        result,
      });
    } catch (error) {
      items.push({
        marketAddress: discovered.marketAddress,
        ok: false,
        error: {
          code: error && error.code ? error.code : 'FEES_WITHDRAW_FAILED',
          message: error && error.message ? error.message : String(error),
          details: error && error.details ? error.details : null,
        },
      });
    }
  }

  return buildBatchWithdrawPayload({
    creator,
    indexerUrl,
    runtime: context.runtime,
    signerAddress: context.signerAddress,
    items,
    execute: Boolean(options.execute),
    capped: discovery.capped,
  });
}

function renderFeesTable(data) {
  const summary = data.summary || {};
  // eslint-disable-next-line no-console
  console.log('Fees');
  // eslint-disable-next-line no-console
  console.log(`wallet: ${data.filters && data.filters.wallet ? data.filters.wallet : ''}`);
  // eslint-disable-next-line no-console
  console.log(`count: ${summary.count || 0}`);
  // eslint-disable-next-line no-console
  console.log(`totalAmountUsdc: ${summary.totalAmountUsdc ?? ''}`);
  // eslint-disable-next-line no-console
  console.log(`lastUpdatedFeeBps: ${summary.lastUpdatedFeeBps ?? ''}`);

  if (Array.isArray(data.items) && data.items.length) {
    // eslint-disable-next-line no-console
    console.table(
      data.items.slice(0, 20).map((item) => ({
        id: item.id,
        eventName: item.eventName || '',
        to: item.to || '',
        amountUsdc: item.amountUsdc ?? '',
        newFeeBps: item.newFeeBps ?? '',
        txHash: item.txHash || '',
        timestamp: item.timestamp ?? '',
      })),
    );
  }
}

function renderFeesWithdrawTable(data) {
  if (data && data.action === 'withdraw-all-markets') {
    const summary = data.summary || {};
    console.log('Fees Withdraw All Markets');
    console.log(`creator: ${data.creator || ''}`);
    console.log(`mode: ${data.mode || ''}`);
    console.log(`marketCount: ${summary.marketCount || 0}`);
    console.log(`withdrawableTotal: ${summary.withdrawableTotal || '0'} ${summary.symbol || ''}`.trim());
    console.log(`successCount: ${summary.successCount || 0}`);
    console.log(`failureCount: ${summary.failureCount || 0}`);
    if (Array.isArray(data.items) && data.items.length) {
      console.table(
        data.items.map((item) => ({
          marketAddress: item.marketAddress || '',
          ok: item.ok === true,
          status: item.ok && item.result ? item.result.status || '' : 'failed',
          withdrawable: item.ok && item.result && item.result.feeState ? item.result.feeState.withdrawable || '' : '',
          symbol: item.ok && item.result && item.result.feeState ? item.result.feeState.symbol || '' : '',
          txHash: item.ok && item.result && item.result.tx ? item.result.tx.txHash || '' : '',
          errorCode: item.ok ? '' : (item.error && item.error.code ? item.error.code : ''),
        })),
      );
    }
    return;
  }
  const feeState = data.feeState || {};
  // eslint-disable-next-line no-console
  console.log('Fees Withdraw');
  // eslint-disable-next-line no-console
  console.log(`marketAddress: ${data.marketAddress || ''}`);
  // eslint-disable-next-line no-console
  console.log(`mode: ${data.mode || ''}`);
  // eslint-disable-next-line no-console
  console.log(`withdrawable: ${feeState.withdrawable || '0'} ${feeState.symbol || ''}`.trim());
  // eslint-disable-next-line no-console
  console.log(`platformShare: ${feeState.platformShare || '0'} ${feeState.symbol || ''}`.trim());
  // eslint-disable-next-line no-console
  console.log(`creatorShare: ${feeState.creatorShare || '0'} ${feeState.symbol || ''}`.trim());
  if (data.tx && data.tx.txHash) {
    // eslint-disable-next-line no-console
    console.log(`txHash: ${data.tx.txHash}`);
  }
}

function createRunFeesCommand(deps) {
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseIndexerSharedFlags = requireDep(deps, 'parseIndexerSharedFlags');
  const maybeLoadIndexerEnv = requireDep(deps, 'maybeLoadIndexerEnv');
  const maybeLoadTradeEnv = requireDep(deps, 'maybeLoadTradeEnv');
  const CliError = requireDep(deps, 'CliError');
  const assertLiveWriteAllowed =
    typeof deps.assertLiveWriteAllowed === 'function' ? deps.assertLiveWriteAllowed : null;

  return async function runFeesCommand(args, context) {
    const shared = parseIndexerSharedFlags(args);

    const first = shared.rest[0];
    const hasSubcommand = first && !String(first).startsWith('--');
    const action = hasSubcommand ? String(first).toLowerCase() : 'list';
    const actionArgs = hasSubcommand ? shared.rest.slice(1) : shared.rest;

    const familyUsage = [
      'pandora [--output table|json] fees [--wallet <address>] [--chain-id <id>] [--tx-hash <hash>] [--event-name <name>] [--limit <n>] [--before <cursor>] [--after <cursor>] [--order-direction asc|desc] [--indexer-url <url>] [--timeout-ms <ms>]',
      'pandora [--output table|json] fees withdraw (--market-address <address>|--all-markets [--creator <address>]) --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--indexer-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--dotenv-path <path>] [--skip-dotenv] [--timeout-ms <ms>]',
    ];

    if (includesHelpFlag(shared.rest) || action === 'help') {
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'fees.help', commandHelpPayload(familyUsage[0], [
          'Top-level `fees` reads indexed oracle-fee history.',
          '`fees withdraw` dry-runs or executes market-level `withdrawProtocolFees()` on a Pandora AMM market contract.',
        ]));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${familyUsage[0]}`);
        // eslint-disable-next-line no-console
        console.log(`       ${familyUsage[1]}`);
      }
      return;
    }

    if (action === 'list') {
      maybeLoadIndexerEnv(shared);
      const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
      const options = parseFeesReadFlags(actionArgs, CliError);
      try {
        const { items, pageInfo } = await fetchOracleFeeEvents(indexerUrl, options, shared.timeoutMs);
        const payload = {
          schemaVersion: FEES_SCHEMA_VERSION,
          generatedAt: new Date().toISOString(),
          indexerUrl,
          filters: {
            wallet: options.wallet,
            chainId: options.chainId,
            txHash: options.txHash,
            eventName: options.eventName,
          },
          pagination: {
            limit: options.limit,
            before: options.before,
            after: options.after,
            orderDirection: options.orderDirection,
          },
          summary: buildSummary(items),
          pageInfo,
          items,
        };
        emitSuccess(context.outputMode, 'fees', payload, renderFeesTable);
        return;
      } catch (error) {
        throw toCliError(error, CliError, 'FEES_LOOKUP_FAILED', 'fees lookup failed.');
      }
    }

    if (action === 'withdraw') {
      if (includesHelpFlag(actionArgs)) {
        const usage = familyUsage[1];
        if (context.outputMode === 'json') {
          emitSuccess(context.outputMode, 'fees.withdraw.help', commandHelpPayload(usage, [
            'This calls the market contract `withdrawProtocolFees()` surface that splits collected collateral between the platform treasury and market creator.',
            'Use --market-address for one market, or --all-markets with --creator (or signer credentials) to sweep creator-owned markets.',
            'Pass --dry-run for a safe preview, or --execute with signer credentials to submit the transaction(s).',
          ]));
        } else {
          // eslint-disable-next-line no-console
          console.log(`Usage: ${usage}`);
        }
        return;
      }

      maybeLoadTradeEnv(shared);
      const options = parseFeesWithdrawFlags(actionArgs, CliError);
      options.timeoutMs = shared.timeoutMs;
      options.indexerUrl = resolveIndexerUrl(shared.indexerUrl);

      if (options.execute && assertLiveWriteAllowed) {
        await assertLiveWriteAllowed('fees.withdraw.execute', {
          runtimeMode: options.fork || options.forkRpcUrl ? 'fork' : 'live',
        });
      }

      try {
        const payload = options.allMarkets
          ? await runBatchFeesWithdraw(options, {
            env: process.env,
          })
          : await runMarketFeesWithdraw(options, {
          env: process.env,
        });
        emitSuccess(context.outputMode, 'fees.withdraw', payload, renderFeesWithdrawTable);
        return;
      } catch (error) {
        throw toCliError(error, CliError, 'FEES_WITHDRAW_FAILED', 'fees withdraw failed.');
      }
    }

    throw new CliError('INVALID_ARGS', 'fees supports the default history view or the withdraw subcommand.');
  };
}

module.exports = {
  createRunFeesCommand,
  runBatchFeesWithdraw,
  resolveWithdrawExecutionContext,
  runMarketFeesWithdraw,
};
