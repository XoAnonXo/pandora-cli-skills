const {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
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
];

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

async function wrapDeployExecutionError(err, code, fallbackMessage, details = undefined) {
  const decoded = await decodeContractError(err);
  const decodedMessage = formatDecodedContractError(decoded);
  return createDeployError(code, decodedMessage || (err && err.message ? err.message : fallbackMessage), {
    decodedError: decoded,
    cause: err && err.message ? err.message : String(err),
    ...((details && typeof details === 'object') ? details : {}),
  });
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

  const feeTier = Number(options.feeTier);
  if (feeTier < MIN_AMM_FEE_TIER || feeTier > MAX_AMM_FEE_TIER) {
    throw new Error(`feeTier must be between ${MIN_AMM_FEE_TIER} and ${MAX_AMM_FEE_TIER} (max 5%).`);
  }

  const maxImbalance = Number(options.maxImbalance);
  if (!Number.isInteger(maxImbalance) || maxImbalance <= 0) {
    throw new Error('maxImbalance must be a positive integer.');
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
    feeTier,
    maxImbalance,
    arbiter: String(options.arbiter || DEFAULT_ARBITER).toLowerCase(),
    category,
  };
}

async function deployPandoraAmmMarket(options = {}) {
  const args = buildDeploymentArgs(options);

  const oracle = String(options.oracle || process.env.ORACLE || DEFAULT_ORACLE).toLowerCase();
  const factory = String(options.factory || process.env.FACTORY || DEFAULT_FACTORY).toLowerCase();
  const usdc = String(options.usdc || process.env.USDC || DEFAULT_USDC).toLowerCase();
  const executionMode = options.execute ? 'execute' : 'dry-run';

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
    pandora: {
      pollAddress: null,
      marketAddress: null,
    },
    diagnostics: [],
  };

  if (!options.execute) {
    return payload;
  }

  const privateKey = options.privateKey || process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('Missing private key for deployment execution.');
  }

  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

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
  const gasReserveWei = parseEther(String(options.gasReserveEth || '0.005'));
  const liquidityRaw = parseUnits(String(args.liquidityUsdc), 6);
  const [nativeBalance, usdcBalance, currentAllowance] = await Promise.all([
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

  payload.preflight = {
    account: account.address,
    nativeSymbol: chain.nativeCurrency.symbol,
    nativeBalance: formatUnits(nativeBalance, 18),
    nativeRequired: formatUnits(pollFee + gasReserveWei, 18),
    pollFeeNative: formatUnits(pollFee, 18),
    gasReserveNative: formatUnits(gasReserveWei, 18),
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

  let approveTxHash = null;
  if (currentAllowance < liquidityRaw) {
    try {
      approveTxHash = await walletClient.writeContract({
        address: usdc,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [factory, liquidityRaw],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
    } catch (err) {
      throw await wrapDeployExecutionError(err, 'APPROVE_EXECUTION_FAILED', 'USDC approve failed.', {
        approveTxHash: approveTxHash || null,
      });
    }
  }

  const distributionHint = [BigInt(args.distributionYes), BigInt(args.distributionNo)];

  let marketSimulation;
  try {
    marketSimulation = await publicClient.simulateContract({
      account,
      address: factory,
      abi: FACTORY_ABI,
      functionName: 'createMarket',
      args: [pollAddress, usdc, liquidityRaw, distributionHint, args.feeTier, args.maxImbalance],
    });
  } catch (err) {
    throw await wrapDeployExecutionError(err, 'MARKET_SIMULATION_FAILED', 'createMarket simulation failed.');
  }

  let marketTxHash;
  try {
    marketTxHash = await walletClient.writeContract(marketSimulation.request);
    await publicClient.waitForTransactionReceipt({ hash: marketTxHash });
  } catch (err) {
    throw await wrapDeployExecutionError(err, 'MARKET_EXECUTION_FAILED', 'createMarket transaction failed.', {
      marketTxHash: marketTxHash || null,
    });
  }

  payload.tx = {
    pollTxHash,
    approveTxHash,
    marketTxHash,
  };
  payload.pandora = {
    pollAddress,
    marketAddress: marketSimulation.result ? String(marketSimulation.result).toLowerCase() : null,
  };

  if (!payload.pandora.marketAddress) {
    payload.diagnostics.push('Unable to derive market address directly from simulation result.');
  }

  return payload;
}

module.exports = {
  buildDeploymentArgs,
  deployPandoraAmmMarket,
};
