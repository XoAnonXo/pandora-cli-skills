const {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  formatUnits,
  http,
  parseEther,
  parseUnits,
} = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { decodeContractError, formatDecodedContractError } = require('./contract_error_decoder.cjs');
const {
  DEFAULT_RPC_BY_CHAIN_ID,
  DEFAULT_ORACLE,
  DEFAULT_FACTORY,
  DEFAULT_USDC,
  DEFAULT_ARBITER,
  MIN_AMM_FEE_TIER,
  MAX_AMM_FEE_TIER,
} = require('./shared/constants.cjs');
const {
  buildRequiredAgentMarketValidation,
  assertAgentMarketValidation,
} = require('./agent_market_prompt_service.cjs');
const {
  DEFAULT_FLASHBOTS_RELAY_URL,
  DEFAULT_FLASHBOTS_TARGET_BLOCK_OFFSET,
  FLASHBOTS_SUPPORTED_CHAIN_ID,
  normalizeFlashbotsRelayUrl,
  normalizeTargetBlockOffset,
  sendFlashbotsPrivateTransaction,
  sendFlashbotsBundle,
} = require('./flashbots_service.cjs');
const { materializeExecutionSigner } = require('./signers/execution_signer_service.cjs');
const { executeTradeWithRoute } = require('./trade_execution_route_service.cjs');

const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
];

const ORACLE_ABI = [
  { name: 'operatorGasFee', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'protocolFee', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'MAX_RULES_LENGTH', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    name: 'createPoll',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: '_question', type: 'string' },
      { name: '_rules', type: 'string' },
      { name: '_sources', type: 'string[]' },
      { name: '_targetTimestamp', type: 'uint256' },
      { name: '_arbiter', type: 'address' },
      { name: '_category', type: 'uint8' },
    ],
    outputs: [{ name: 'pollAddress', type: 'address' }],
  },
];

const FACTORY_ABI = [
  {
    name: 'createMarket',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_pollAddress', type: 'address' },
      { name: '_collateral', type: 'address' },
      { name: '_initialLiquidity', type: 'uint256' },
      { name: '_distributionHint', type: 'uint256[2]' },
      { name: '_feeTier', type: 'uint24' },
      { name: '_maxPriceImbalancePerHour', type: 'uint24' },
    ],
    outputs: [{ name: 'marketAddress', type: 'address' }],
  },
  {
    name: 'createPariMutuel',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_pollAddress', type: 'address' },
      { name: '_collateral', type: 'address' },
      { name: '_initialLiquidity', type: 'uint256' },
      { name: '_distributionHint', type: 'uint256[2]' },
      { name: '_curveFlattener', type: 'uint8' },
      { name: '_curveOffset', type: 'uint24' },
    ],
    outputs: [{ name: 'marketAddress', type: 'address' }],
  },
];

const MAX_UINT24 = 16_777_215;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const DEFAULT_PARIMUTUEL_CURVE_FLATTENER = 7;
const DEFAULT_PARIMUTUEL_CURVE_OFFSET = 30_000;
const MIN_PARIMUTUEL_CURVE_FLATTENER = 1;
const MAX_PARIMUTUEL_CURVE_FLATTENER = 11;
const DEFAULT_CREATE_POLL_GAS_UNITS = 350_000n;
const DEFAULT_APPROVE_GAS_UNITS = 65_000n;
const DEFAULT_CREATE_MARKET_GAS_UNITS = 650_000n;
const DEFAULT_CREATE_PARIMUTUEL_GAS_UNITS = 650_000n;
const GAS_RESERVE_BUFFER_BPS = 2_500n;
const DEFAULT_FALLBACK_GAS_PRICE_WEI = 2_000_000_000n;
const DEPLOY_TX_ROUTE_VALUES = new Set(['public', 'auto', 'flashbots-private', 'flashbots-bundle']);
const DEPLOY_TX_ROUTE_FALLBACK_VALUES = new Set(['fail', 'public']);

const POLL_CREATED_EVENT = {
  type: 'event',
  name: 'PollCreated',
  anonymous: false,
  inputs: [
    { indexed: true, name: 'pollAddress', type: 'address' },
    { indexed: true, name: 'creator', type: 'address' },
    { indexed: false, name: 'deadlineEpoch', type: 'uint32' },
    { indexed: false, name: 'question', type: 'string' },
  ],
};

function normalizeSources(sources) {
  if (!sources) return [];
  if (Array.isArray(sources)) {
    return sources.map((source) => String(source || '').trim()).filter(Boolean);
  }
  return String(sources)
    .split(/[\n,]/g)
    .map((source) => source.trim())
    .filter(Boolean);
}

function createDeployError(code, message, details = undefined) {
  const err = new Error(message);
  err.code = code;
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

function normalizeOptionalText(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeDeployTxRoute(value) {
  const normalized = String(value || 'public').trim().toLowerCase() || 'public';
  if (!DEPLOY_TX_ROUTE_VALUES.has(normalized)) {
    throw createDeployError(
      'INVALID_FLAG_VALUE',
      '--tx-route must be public|auto|flashbots-private|flashbots-bundle.',
      { value },
    );
  }
  return normalized;
}

function normalizeDeployTxRouteFallback(value) {
  const normalized = String(value || 'fail').trim().toLowerCase() || 'fail';
  if (!DEPLOY_TX_ROUTE_FALLBACK_VALUES.has(normalized)) {
    throw createDeployError('INVALID_FLAG_VALUE', '--tx-route-fallback must be fail|public.', { value });
  }
  return normalized;
}

function resolveDeployTxRouteConfig(options = {}) {
  const requestedTxRoute = normalizeDeployTxRoute(options.txRoute || 'public');
  const txRouteFallback = normalizeDeployTxRouteFallback(options.txRouteFallback || 'fail');
  const flashbotsRequested = requestedTxRoute !== 'public';
  return {
    requestedTxRoute,
    txRouteFallback,
    flashbotsRelayUrl: flashbotsRequested
      ? normalizeFlashbotsRelayUrl(options.flashbotsRelayUrl || process.env.FLASHBOTS_RELAY_URL || DEFAULT_FLASHBOTS_RELAY_URL)
      : null,
    flashbotsAuthKey: flashbotsRequested
      ? normalizeOptionalText(options.flashbotsAuthKey || process.env.FLASHBOTS_AUTH_KEY || null)
      : null,
    flashbotsTargetBlockOffset: flashbotsRequested
      ? normalizeTargetBlockOffset(
          options.flashbotsTargetBlockOffset || process.env.FLASHBOTS_TARGET_BLOCK_OFFSET || DEFAULT_FLASHBOTS_TARGET_BLOCK_OFFSET,
        )
      : null,
  };
}

function buildRawContractTransactionRequest({
  runtime,
  address,
  abi,
  functionName,
  args,
  account,
  chainId,
  nonce,
  gas,
  gasPrice,
  value = 0n,
}) {
  return {
    account,
    to: address,
    chainId,
    nonce,
    gas,
    gasPrice,
    value,
    data: runtime.encodeFunctionData({
      abi,
      functionName,
      args,
    }),
  };
}

function utf8ByteLength(value) {
  return Buffer.byteLength(String(value || ''), 'utf8');
}

async function resolveMaxRulesLength(publicClient, oracle) {
  try {
    const result = await publicClient.readContract({
      address: oracle,
      abi: ORACLE_ABI,
      functionName: 'MAX_RULES_LENGTH',
    });
    const numeric = Number(result);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
  } catch {
    return null;
  }
}

async function resolveFeePerGas(publicClient) {
  if (publicClient && typeof publicClient.estimateFeesPerGas === 'function') {
    try {
      const estimated = await publicClient.estimateFeesPerGas();
      if (estimated && typeof estimated.maxFeePerGas === 'bigint' && estimated.maxFeePerGas > 0n) {
        return estimated.maxFeePerGas;
      }
      if (estimated && typeof estimated.gasPrice === 'bigint' && estimated.gasPrice > 0n) {
        return estimated.gasPrice;
      }
    } catch {
      // fall through
    }
  }

  if (publicClient && typeof publicClient.getGasPrice === 'function') {
    try {
      const gasPrice = await publicClient.getGasPrice();
      if (typeof gasPrice === 'bigint' && gasPrice > 0n) {
        return gasPrice;
      }
    } catch {
      // fall through
    }
  }

  return DEFAULT_FALLBACK_GAS_PRICE_WEI;
}

async function estimateContractGasUnits(publicClient, request, fallbackUnits) {
  if (publicClient && typeof publicClient.estimateContractGas === 'function' && request) {
    try {
      const estimate = await publicClient.estimateContractGas(request);
      if (typeof estimate === 'bigint' && estimate > 0n) {
        return estimate;
      }
    } catch {
      // use fallback
    }
  }
  return fallbackUnits;
}

function applyReserveBuffer(value) {
  const base = typeof value === 'bigint' && value > 0n ? value : 0n;
  return base + ((base * GAS_RESERVE_BUFFER_BPS) / 10_000n);
}

async function buildGasReservePlan({
  options,
  publicClient,
  pollRequest,
  approveRequest,
  marketRequest,
  marketFallbackUnits,
  needsApproval,
  parseEtherFn,
}) {
  if (options.gasReserveEth !== undefined && options.gasReserveEth !== null && String(options.gasReserveEth).trim()) {
    const gasReserveWei = parseEtherFn(String(options.gasReserveEth));
    return {
      gasReserveWei,
      feePerGasWei: null,
      gasUnits: null,
      source: 'manual',
    };
  }

  const feePerGasWei = await resolveFeePerGas(publicClient);
  const pollGasUnits = await estimateContractGasUnits(publicClient, pollRequest, DEFAULT_CREATE_POLL_GAS_UNITS);
  const approveGasUnits =
    needsApproval && approveRequest
      ? await estimateContractGasUnits(publicClient, approveRequest, DEFAULT_APPROVE_GAS_UNITS)
      : 0n;
  const marketGasUnits = marketRequest
    ? await estimateContractGasUnits(publicClient, marketRequest, marketFallbackUnits || DEFAULT_CREATE_MARKET_GAS_UNITS)
    : (marketFallbackUnits || DEFAULT_CREATE_MARKET_GAS_UNITS);
  const totalGasUnits = pollGasUnits + approveGasUnits + marketGasUnits;

  return {
    gasReserveWei: applyReserveBuffer(feePerGasWei * totalGasUnits),
    feePerGasWei,
    gasUnits: {
      poll: pollGasUnits,
      approve: approveGasUnits,
      market: marketGasUnits,
      total: totalGasUnits,
    },
    source: 'dynamic',
  };
}

async function wrapDeployExecutionError(err, code, fallbackMessage, details = undefined) {
  const decoded = await decodeContractError(err);
  const decodedMessage = formatDecodedContractError(decoded);
  return createDeployError(code, decodedMessage || (err && err.message ? err.message : fallbackMessage), {
    decodedError: decoded,
    cause: err && err.message ? err.message : String(err),
    ...((details && typeof details === 'object') ? details : {}),
  });
}

function resolveDeployRuntime(options = {}) {
  const viemRuntime = options && options.viem && typeof options.viem === 'object' ? options.viem : {};
  return {
    createPublicClient: viemRuntime.createPublicClient || createPublicClient,
    createWalletClient: viemRuntime.createWalletClient || createWalletClient,
    privateKeyToAccount: viemRuntime.privateKeyToAccount || privateKeyToAccount,
    encodeFunctionData: viemRuntime.encodeFunctionData || encodeFunctionData,
    http: viemRuntime.http || http,
    parseEther: viemRuntime.parseEther || parseEther,
    parseUnits: viemRuntime.parseUnits || parseUnits,
  };
}

function resolveChain(chainId, rpcUrl) {
  const id = Number(chainId || process.env.CHAIN_ID || 1);
  if (id !== 1) {
    throw new Error(`Unsupported CHAIN_ID=${id}. Supported values: 1.`);
  }

  const finalRpcUrl = rpcUrl || process.env.RPC_URL || DEFAULT_RPC_BY_CHAIN_ID[id];
  const chain = {
    id: 1,
    name: 'Ethereum',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [finalRpcUrl] }, public: { http: [finalRpcUrl] } },
    blockExplorers: { default: { name: 'Etherscan', url: 'https://etherscan.io' } },
  };

  return {
    chain,
    chainId: id,
    rpcUrl: finalRpcUrl,
  };
}

function normalizeDeploymentMarketType(value) {
  const key = String(value || 'amm').trim().toLowerCase();
  if (!key || key === 'amm') return 'amm';
  if (key === 'parimutuel' || key === 'pari' || key === 'pm') return 'parimutuel';
  throw new Error('marketType must be amm or parimutuel.');
}

function buildFactoryCreateConfig({ pollAddress, usdc, liquidityRaw, distributionHint, args }) {
  if (args.marketType === 'parimutuel') {
    return {
      functionName: 'createPariMutuel',
      callArgs: [
        pollAddress,
        usdc,
        liquidityRaw,
        distributionHint,
        args.curveFlattener,
        args.curveOffset,
      ],
      fallbackGasUnits: DEFAULT_CREATE_PARIMUTUEL_GAS_UNITS,
    };
  }

  return {
    functionName: 'createMarket',
    callArgs: [
      pollAddress,
      usdc,
      liquidityRaw,
      distributionHint,
      args.feeTier,
      args.maxImbalance,
    ],
    fallbackGasUnits: DEFAULT_CREATE_MARKET_GAS_UNITS,
  };
}

function buildDeploymentArgs(options = {}) {
  const sourceQuestion = String(options.question || '').trim();
  const sourceRules = String(options.rules || '').trim();
  const sourceSources = normalizeSources(options.sources);

  if (!sourceQuestion) throw new Error('Missing deployment question.');
  if (!sourceRules) throw new Error('Missing deployment rules.');
  if (sourceSources.length < 2) throw new Error('At least two sources are required for deployment.');

  const targetTimestamp = Number(options.targetTimestamp);
  if (!Number.isFinite(targetTimestamp) || targetTimestamp <= 0) {
    throw new Error('targetTimestamp must be a unix timestamp in seconds.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const minCloseLeadSeconds = Number.isFinite(Number(options.minCloseLeadSeconds))
    ? Math.max(0, Math.trunc(Number(options.minCloseLeadSeconds)))
    : 0;
  if (targetTimestamp <= nowSec + minCloseLeadSeconds) {
    throw createDeployError(
      'MIRROR_EXPIRY_TOO_CLOSE',
      `targetTimestamp must be at least ${minCloseLeadSeconds}s in the future.`,
      {
        nowSec,
        minCloseLeadSeconds,
        targetTimestamp,
      },
    );
  }

  const liquidityUsdc = Number(options.liquidityUsdc);
  if (!Number.isFinite(liquidityUsdc) || liquidityUsdc < 10) {
    throw new Error('liquidityUsdc must be >= 10.');
  }

  const distributionYes = Number(options.distributionYes);
  const distributionNo = Number(options.distributionNo);
  if (!Number.isInteger(distributionYes) || !Number.isInteger(distributionNo) || distributionYes + distributionNo !== 1_000_000_000) {
    throw new Error('distributionYes + distributionNo must equal 1000000000.');
  }

  const marketType = normalizeDeploymentMarketType(options.marketType);
  let feeTier = null;
  let maxImbalance = null;
  let curveFlattener = null;
  let curveOffset = null;

  if (marketType === 'parimutuel') {
    curveFlattener = Number.isFinite(Number(options.curveFlattener))
      ? Number(options.curveFlattener)
      : DEFAULT_PARIMUTUEL_CURVE_FLATTENER;
    if (!Number.isInteger(curveFlattener)
      || curveFlattener < MIN_PARIMUTUEL_CURVE_FLATTENER
      || curveFlattener > MAX_PARIMUTUEL_CURVE_FLATTENER) {
      throw new Error(
        `curveFlattener must be an integer between ${MIN_PARIMUTUEL_CURVE_FLATTENER} and ${MAX_PARIMUTUEL_CURVE_FLATTENER}.`,
      );
    }

    curveOffset = Number.isFinite(Number(options.curveOffset))
      ? Number(options.curveOffset)
      : DEFAULT_PARIMUTUEL_CURVE_OFFSET;
    if (!Number.isInteger(curveOffset) || curveOffset < 0 || curveOffset > MAX_UINT24) {
      throw new Error(`curveOffset must be an integer between 0 and ${MAX_UINT24}.`);
    }
  } else {
    feeTier = Number(options.feeTier);
    if (feeTier < MIN_AMM_FEE_TIER || feeTier > MAX_AMM_FEE_TIER) {
      throw new Error(`feeTier must be between ${MIN_AMM_FEE_TIER} and ${MAX_AMM_FEE_TIER} (max 5%).`);
    }

    maxImbalance = Number(options.maxImbalance);
    if (!Number.isInteger(maxImbalance) || maxImbalance < 0 || maxImbalance > MAX_UINT24) {
      throw new Error(`maxImbalance must be an integer between 0 and ${MAX_UINT24}.`);
    }
  }

  const category = Number.isInteger(Number(options.category)) ? Number(options.category) : 3;

  return {
    question: sourceQuestion,
    rules: sourceRules,
    sources: sourceSources,
    targetTimestamp,
    liquidityUsdc,
    distributionYes,
    distributionNo,
    marketType,
    feeTier,
    maxImbalance,
    curveFlattener,
    curveOffset,
    arbiter: String(options.arbiter || DEFAULT_ARBITER).toLowerCase(),
    category,
  };
}

async function deployPandoraAmmMarket(options = {}) {
  const args = buildDeploymentArgs(options);
  const runtime = resolveDeployRuntime(options);
  const validationInput = {
    question: args.question,
    rules: args.rules,
    sources: args.sources,
    targetTimestamp: args.targetTimestamp,
  };
  const requiredValidation = buildRequiredAgentMarketValidation(validationInput);

  const oracle = String(options.oracle || process.env.ORACLE || DEFAULT_ORACLE).toLowerCase();
  const factory = String(options.factory || process.env.FACTORY || DEFAULT_FACTORY).toLowerCase();
  const usdc = String(options.usdc || process.env.USDC || DEFAULT_USDC).toLowerCase();
  const executionMode = options.execute ? 'execute' : 'dry-run';
  const txRouteConfig = resolveDeployTxRouteConfig(options);

  const { chain, chainId, rpcUrl } = resolveChain(options.chainId, options.rpcUrl);

  const payload = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    mode: executionMode,
    chainId,
    rpcUrl,
    deploymentArgs: {
      ...args,
      oracle,
      factory,
      usdc,
    },
    tx: null,
    preflight: null,
    requiredValidation,
    agentValidation: null,
    txRouteRequested: txRouteConfig.requestedTxRoute,
    txRouteResolved: txRouteConfig.requestedTxRoute === 'auto' ? null : txRouteConfig.requestedTxRoute,
    txRouteFallback: txRouteConfig.txRouteFallback,
    txRouteFallbackUsed: false,
    txRouteFallbackReason: null,
    flashbotsRelayUrl: txRouteConfig.flashbotsRelayUrl,
    flashbotsRelayMethod: null,
    flashbotsTargetBlockNumber: null,
    flashbotsRelayResponseId: null,
    flashbotsBundleHash: null,
    flashbotsSimulation: null,
    pandora: {
      pollAddress: null,
      marketAddress: null,
    },
    diagnostics: [],
  };

  if (!options.execute) {
    return payload;
  }

  payload.agentValidation = assertAgentMarketValidation(validationInput, {
    env: options.env || process.env,
    preflight: options.agentPreflight,
  });

  const privateKey = options.privateKey || process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || null;
  const hasProfileSelector = Boolean(
    options.profile
    || (typeof options.profileId === 'string' && options.profileId.trim())
    || (typeof options.profileFile === 'string' && options.profileFile.trim())
  );
  if (!privateKey && !hasProfileSelector && !options.account && !options.walletClient) {
    throw new Error('Missing signer credentials for deployment execution. Pass --private-key or --profile-id/--profile-file.');
  }

  const publicClient = options.publicClient || runtime.createPublicClient({ chain, transport: runtime.http(rpcUrl) });
  let account = options.account || null;
  let walletClient = options.walletClient || null;
  let materializedSigner = null;

  if (!account || !walletClient) {
    materializedSigner = await (options.materializeExecutionSigner || materializeExecutionSigner)({
      privateKey,
      profileId: options.profileId || null,
      profileFile: options.profileFile || null,
      profile: options.profile || null,
      chain,
      chainId,
      rpcUrl,
      viemRuntime: runtime,
      env: options.env || process.env,
      requireSigner: true,
      mode: 'execute',
      liveRequested: true,
      mutating: true,
      category: args.category,
      command: options.command || 'deploy',
      toolFamily: options.toolFamily || 'deploy',
      metadata: {
        source: options.source || 'pandora.deploy',
        question: args.question,
      },
    });
    if (!account) {
      account = materializedSigner.account;
    }
    if (!walletClient) {
      walletClient = materializedSigner.walletClient;
    }
  }

  const [operatorGasFee, protocolFee] = await Promise.all([
    publicClient.readContract({
      address: oracle,
      abi: ORACLE_ABI,
      functionName: 'operatorGasFee',
    }),
    publicClient.readContract({
      address: oracle,
      abi: ORACLE_ABI,
      functionName: 'protocolFee',
    }),
  ]);

  const pollFee = operatorGasFee + protocolFee;
  const liquidityRaw = runtime.parseUnits(String(args.liquidityUsdc), 6);
  const [maxRulesLength, nativeBalance, usdcBalance, currentAllowance] = await Promise.all([
    resolveMaxRulesLength(publicClient, oracle),
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({
      address: usdc,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account.address],
    }),
    publicClient.readContract({
      address: usdc,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account.address, factory],
    }),
  ]);

  const rulesLengthBytes = utf8ByteLength(args.rules);
  if (Number.isInteger(maxRulesLength) && rulesLengthBytes > maxRulesLength) {
    throw createDeployError(
      'INVALID_RULES_LENGTH',
      `Rules text is too long (${rulesLengthBytes} bytes). Oracle limit is ${maxRulesLength} bytes.`,
      {
        rulesLengthBytes,
        maxRulesLength,
      },
    );
  }

  const needsApproval = currentAllowance < liquidityRaw;
  const distributionHint = [BigInt(args.distributionYes), BigInt(args.distributionNo)];

  let pollSimulation;
  try {
    pollSimulation = await publicClient.simulateContract({
      account,
      address: oracle,
      abi: ORACLE_ABI,
      functionName: 'createPoll',
      args: [args.question, args.rules, args.sources, BigInt(args.targetTimestamp), args.arbiter, args.category],
      value: pollFee,
    });
  } catch (err) {
    throw await wrapDeployExecutionError(err, 'POLL_SIMULATION_FAILED', 'createPoll simulation failed.');
  }

  const approveRequest = needsApproval
    ? {
        account,
        address: usdc,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [factory, liquidityRaw],
      }
    : null;
  const marketConfigForReserve = buildFactoryCreateConfig({
    pollAddress: pollSimulation.result || ZERO_ADDRESS,
    usdc,
    liquidityRaw,
    distributionHint,
    args,
  });
  const gasReservePlan = await buildGasReservePlan({
    options,
    publicClient,
    pollRequest: pollSimulation.request,
    approveRequest,
    marketRequest: {
      account,
      address: factory,
      abi: FACTORY_ABI,
      functionName: marketConfigForReserve.functionName,
      args: marketConfigForReserve.callArgs,
    },
    marketFallbackUnits: marketConfigForReserve.fallbackGasUnits,
    needsApproval,
    parseEtherFn: runtime.parseEther,
  });
  const gasReserveWei = gasReservePlan.gasReserveWei;

  payload.preflight = {
    account: account.address,
    nativeSymbol: chain.nativeCurrency.symbol,
    nativeBalance: formatUnits(nativeBalance, 18),
    nativeRequired: formatUnits(pollFee + gasReserveWei, 18),
    pollFeeNative: formatUnits(pollFee, 18),
    gasReserveNative: formatUnits(gasReserveWei, 18),
    gasReserveSource: gasReservePlan.source,
    gasPriceGwei: gasReservePlan.feePerGasWei === null ? null : formatUnits(gasReservePlan.feePerGasWei, 9),
    estimatedGasUnits: gasReservePlan.gasUnits
      ? {
          poll: gasReservePlan.gasUnits.poll.toString(),
          approve: gasReservePlan.gasUnits.approve.toString(),
          market: gasReservePlan.gasUnits.market.toString(),
          total: gasReservePlan.gasUnits.total.toString(),
        }
      : null,
    rulesLengthBytes,
    maxRulesLength,
    usdcBalance: formatUnits(usdcBalance, 6),
    usdcRequired: formatUnits(liquidityRaw, 6),
    usdcAllowance: formatUnits(currentAllowance, 6),
    allowanceSufficient: currentAllowance >= liquidityRaw,
  };

  if (nativeBalance < pollFee + gasReserveWei) {
    throw createDeployError(
      'INSUFFICIENT_NATIVE_BALANCE',
      `Wallet native balance is insufficient for poll fee + gas reserve (${payload.preflight.nativeRequired} ${chain.nativeCurrency.symbol}).`,
      payload.preflight,
    );
  }
  if (usdcBalance < liquidityRaw) {
    throw createDeployError(
      'INSUFFICIENT_USDC_BALANCE',
      `Wallet USDC balance is insufficient for liquidity (${payload.preflight.usdcRequired} required).`,
      payload.preflight,
    );
  }

  let pollTxHash;
  let pollReceipt;
  try {
    pollTxHash = await walletClient.writeContract(pollSimulation.request);
    pollReceipt = await publicClient.waitForTransactionReceipt({ hash: pollTxHash });
  } catch (err) {
    throw await wrapDeployExecutionError(err, 'POLL_EXECUTION_FAILED', 'createPoll transaction failed.', {
      pollTxHash: pollTxHash || null,
    });
  }

  let pollAddress = pollSimulation.result || null;
  for (const log of pollReceipt.logs || []) {
    if (String(log.address || '').toLowerCase() !== oracle) continue;
    try {
      const parsed = decodeEventLog({
        abi: [POLL_CREATED_EVENT],
        data: log.data,
        topics: log.topics,
      });
      if (parsed && parsed.args && parsed.args.pollAddress) {
        pollAddress = String(parsed.args.pollAddress).toLowerCase();
      }
      break;
    } catch {
      // keep fallback
    }
  }

  if (!pollAddress) {
    throw new Error('Unable to resolve poll address from createPoll transaction.');
  }

  const marketConfig = buildFactoryCreateConfig({
    pollAddress,
    usdc,
    liquidityRaw,
    distributionHint,
    args,
  });

  const resolvedTxRoute =
    txRouteConfig.requestedTxRoute === 'auto'
      ? (needsApproval ? 'flashbots-bundle' : 'flashbots-private')
      : txRouteConfig.requestedTxRoute;
  const flashbotsPrivateSender =
    typeof options.sendFlashbotsPrivateTransaction === 'function'
      ? options.sendFlashbotsPrivateTransaction
      : sendFlashbotsPrivateTransaction;
  const flashbotsBundleSender =
    typeof options.sendFlashbotsBundle === 'function'
      ? options.sendFlashbotsBundle
      : sendFlashbotsBundle;

  function buildTxRouteMetadata(overrides = {}) {
    return {
      txRouteRequested: txRouteConfig.requestedTxRoute,
      txRouteResolved: overrides.txRouteResolved || resolvedTxRoute,
      txRouteFallback: txRouteConfig.txRouteFallback,
      txRouteFallbackUsed: Boolean(overrides.txRouteFallbackUsed),
      txRouteFallbackReason: overrides.txRouteFallbackReason || null,
      flashbotsRelayUrl:
        overrides.flashbotsRelayUrl !== undefined
          ? overrides.flashbotsRelayUrl
          : txRouteConfig.requestedTxRoute === 'public'
            ? null
            : txRouteConfig.flashbotsRelayUrl,
      flashbotsRelayMethod: overrides.flashbotsRelayMethod || null,
      flashbotsTargetBlockNumber:
        overrides.flashbotsTargetBlockNumber !== undefined ? overrides.flashbotsTargetBlockNumber : null,
      flashbotsRelayResponseId:
        overrides.flashbotsRelayResponseId !== undefined ? overrides.flashbotsRelayResponseId : null,
      flashbotsBundleHash: overrides.flashbotsBundleHash || null,
      flashbotsSimulation: overrides.flashbotsSimulation || null,
    };
  }

  async function simulateApproveExecution(nonceOverride = null) {
    if (!needsApproval) {
      return {
        request: null,
        gasEstimate: null,
        nonce: null,
      };
    }
    let approveSimulation;
    try {
      approveSimulation = await publicClient.simulateContract(approveRequest);
    } catch (err) {
      throw await wrapDeployExecutionError(err, 'APPROVE_SIMULATION_FAILED', 'USDC approve simulation failed.');
    }
    const nonce =
      nonceOverride !== null && nonceOverride !== undefined
        ? Number(nonceOverride)
        : await publicClient.getTransactionCount({
            address: account.address,
            blockTag: 'pending',
          });
    return {
      request: {
        ...approveSimulation.request,
        nonce,
      },
      gasEstimate:
        approveSimulation && approveSimulation.request && approveSimulation.request.gas
          ? approveSimulation.request.gas.toString()
          : null,
      nonce,
    };
  }

  async function simulateMarketExecution(nonceOverride = null, allowManualFallback = false) {
    try {
      const marketSimulation = await publicClient.simulateContract({
        account,
        address: factory,
        abi: FACTORY_ABI,
        functionName: marketConfig.functionName,
        args: marketConfig.callArgs,
      });
      const nonce =
        nonceOverride !== null && nonceOverride !== undefined
          ? Number(nonceOverride)
          : await publicClient.getTransactionCount({
              address: account.address,
              blockTag: 'pending',
            });
      return {
        request: {
          ...marketSimulation.request,
          nonce,
        },
        gasEstimate:
          marketSimulation && marketSimulation.request && marketSimulation.request.gas
            ? marketSimulation.request.gas.toString()
            : null,
        nonce,
        marketAddress: marketSimulation.result ? String(marketSimulation.result).toLowerCase() : null,
        usedManualRequest: false,
      };
    } catch (err) {
      if (!allowManualFallback) {
        throw await wrapDeployExecutionError(
          err,
          'MARKET_SIMULATION_FAILED',
          `${marketConfig.functionName} simulation failed.`,
          { marketFunctionName: marketConfig.functionName },
        );
      }
      const nonce =
        nonceOverride !== null && nonceOverride !== undefined
          ? Number(nonceOverride)
          : await publicClient.getTransactionCount({
              address: account.address,
              blockTag: 'pending',
            });
      const gasUnits =
        gasReservePlan && gasReservePlan.gasUnits && typeof gasReservePlan.gasUnits.market === 'bigint'
          ? gasReservePlan.gasUnits.market
          : marketConfig.fallbackGasUnits;
      const gasPriceWei =
        gasReservePlan && typeof gasReservePlan.feePerGasWei === 'bigint' && gasReservePlan.feePerGasWei > 0n
          ? gasReservePlan.feePerGasWei
          : await resolveFeePerGas(publicClient);
      return {
        request: buildRawContractTransactionRequest({
          runtime,
          address: factory,
          abi: FACTORY_ABI,
          functionName: marketConfig.functionName,
          args: marketConfig.callArgs,
          account,
          chainId,
          nonce,
          gas: gasUnits,
          gasPrice: gasPriceWei,
        }),
        gasEstimate: gasUnits.toString(),
        nonce,
        marketAddress: null,
        usedManualRequest: true,
      };
    }
  }

  async function executePublicRoute(routeMetadata) {
    const approveExecution = await simulateApproveExecution();
    let approveTxHash = null;
    if (approveExecution.request) {
      try {
        approveTxHash = await walletClient.writeContract(approveExecution.request);
        await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
      } catch (err) {
        throw await wrapDeployExecutionError(err, 'APPROVE_EXECUTION_FAILED', 'USDC approve failed.', {
          approveTxHash: approveTxHash || null,
        });
      }
    }

    const marketExecution = await simulateMarketExecution();
    let marketTxHash;
    try {
      marketTxHash = await walletClient.writeContract(marketExecution.request);
      await publicClient.waitForTransactionReceipt({ hash: marketTxHash });
    } catch (err) {
      throw await wrapDeployExecutionError(
        err,
        'MARKET_EXECUTION_FAILED',
        `${marketConfig.functionName} transaction failed.`,
        {
          marketTxHash: marketTxHash || null,
          marketFunctionName: marketConfig.functionName,
        },
      );
    }

    return {
      routeMetadata,
      approveTxHash,
      marketTxHash,
      marketAddress: marketExecution.marketAddress,
      diagnostics: marketExecution.usedManualRequest
        ? ['Market route used manual transaction encoding because pre-route simulation was unavailable.']
        : [],
    };
  }

  async function executeFlashbotsPrivateRoute() {
    const pendingNonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: 'pending',
    });
    const marketExecution = await simulateMarketExecution(pendingNonce);
    const privateSubmission = await flashbotsPrivateSender({
      publicClient,
      walletClient,
      account,
      transactionRequest: marketExecution.request,
      relayUrl: txRouteConfig.flashbotsRelayUrl,
      authPrivateKey: txRouteConfig.flashbotsAuthKey,
      targetBlockOffset: txRouteConfig.flashbotsTargetBlockOffset,
      viemRuntime: runtime,
    });
    try {
      await publicClient.waitForTransactionReceipt({ hash: privateSubmission.transactionHash });
    } catch (error) {
      throw createDeployError(
        'FLASHBOTS_PRIVATE_RECEIPT_FAILED',
        'Flashbots private market creation transaction was submitted, but receipt polling failed.',
        {
          submissionState: 'submitted',
          transactionHash: privateSubmission.transactionHash,
          marketTxHash: privateSubmission.transactionHash,
          flashbotsRelayUrl: privateSubmission.relayUrl,
          flashbotsRelayMethod: privateSubmission.relayMethod,
          flashbotsTargetBlockNumber: privateSubmission.targetBlockNumber,
          flashbotsRelayResponseId: privateSubmission.relayResponseId,
        },
      );
    }
    return {
      routeMetadata: buildTxRouteMetadata({
        flashbotsRelayUrl: privateSubmission.relayUrl,
        flashbotsRelayMethod: privateSubmission.relayMethod,
        flashbotsTargetBlockNumber: privateSubmission.targetBlockNumber,
        flashbotsRelayResponseId: privateSubmission.relayResponseId,
      }),
      approveTxHash: null,
      marketTxHash: privateSubmission.transactionHash,
      marketAddress: marketExecution.marketAddress,
      diagnostics: [],
    };
  }

  async function executeFlashbotsBundleRoute() {
    const pendingNonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: 'pending',
    });
    const approveExecution = await simulateApproveExecution(pendingNonce);
    const marketExecution = await simulateMarketExecution(
      approveExecution.request ? pendingNonce + 1 : pendingNonce,
      Boolean(approveExecution.request),
    );
    const bundleRequests = approveExecution.request
      ? [approveExecution.request, marketExecution.request]
      : [marketExecution.request];
    const bundleSubmission = await flashbotsBundleSender({
      publicClient,
      walletClient,
      account,
      transactionRequests: bundleRequests,
      relayUrl: txRouteConfig.flashbotsRelayUrl,
      authPrivateKey: txRouteConfig.flashbotsAuthKey,
      targetBlockOffset: txRouteConfig.flashbotsTargetBlockOffset,
      viemRuntime: runtime,
    });
    const approveTxHash = approveExecution.request ? bundleSubmission.transactionHashes[0] : null;
    const marketTxHash = approveExecution.request
      ? bundleSubmission.transactionHashes[1]
      : bundleSubmission.transactionHashes[0];
    try {
      if (approveTxHash) {
        await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
      }
      await publicClient.waitForTransactionReceipt({ hash: marketTxHash });
    } catch (error) {
      throw createDeployError(
        'FLASHBOTS_BUNDLE_RECEIPT_FAILED',
        'Flashbots bundle for market creation was submitted, but receipt polling failed.',
        {
          submissionState: 'submitted',
          transactionHashes: bundleSubmission.transactionHashes,
          bundleHash: bundleSubmission.bundleHash,
          approveTxHash,
          marketTxHash,
          flashbotsRelayUrl: bundleSubmission.relayUrl,
          flashbotsRelayMethod: bundleSubmission.relayMethod,
          flashbotsTargetBlockNumber: bundleSubmission.targetBlockNumber,
          flashbotsRelayResponseId: bundleSubmission.relayResponseId,
          flashbotsSimulation: bundleSubmission.simulation,
        },
      );
    }
    return {
      routeMetadata: buildTxRouteMetadata({
        flashbotsRelayUrl: bundleSubmission.relayUrl,
        flashbotsRelayMethod: bundleSubmission.relayMethod,
        flashbotsTargetBlockNumber: bundleSubmission.targetBlockNumber,
        flashbotsRelayResponseId: bundleSubmission.relayResponseId,
        flashbotsBundleHash: bundleSubmission.bundleHash,
        flashbotsSimulation: bundleSubmission.simulation,
      }),
      approveTxHash,
      marketTxHash,
      marketAddress: marketExecution.marketAddress,
      diagnostics: marketExecution.usedManualRequest
        ? ['Flashbots bundle used manual market transaction encoding because createMarket pre-approval simulation was unavailable on current state.']
        : [],
    };
  }

  const routedExecution = await executeTradeWithRoute({
    runtime: {
      chainId,
      mode: 'live',
      executionRouteFallback: txRouteConfig.txRouteFallback,
      flashbotsRelayUrl: txRouteConfig.flashbotsRelayUrl,
      flashbotsAuthKey: txRouteConfig.flashbotsAuthKey,
      flashbotsTargetBlockOffset: txRouteConfig.flashbotsTargetBlockOffset,
    },
    requestedExecutionRoute: txRouteConfig.requestedTxRoute,
    needsApproval,
    flashbotsSupportedChainId: FLASHBOTS_SUPPORTED_CHAIN_ID,
    errorFactory: createDeployError,
    buildRouteMetadata: buildTxRouteMetadata,
    executePublicRoute,
    executeFlashbotsPrivateRoute,
    executeFlashbotsBundleRoute,
  });

  Object.assign(payload, routedExecution.routeMetadata || {});
  payload.tx = {
    pollTxHash,
    approveTxHash: routedExecution.approveTxHash || null,
    marketTxHash: routedExecution.marketTxHash || null,
  };
  payload.pandora = {
    pollAddress,
    marketAddress: routedExecution.marketAddress || null,
  };

  if (Array.isArray(routedExecution.diagnostics) && routedExecution.diagnostics.length) {
    payload.diagnostics.push(...routedExecution.diagnostics);
  }
  if (!payload.pandora.marketAddress) {
    payload.diagnostics.push('Unable to derive market address directly from simulation result.');
  }

  return payload;
}

module.exports = {
  buildDeploymentArgs,
  deployPandoraAmmMarket,
  deployPandoraMarket: deployPandoraAmmMarket,
};
