const {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  parseUnits,
} = require('viem');
const { privateKeyToAccount } = require('viem/accounts');

const DEFAULT_ORACLE = '0x259308E7d8557e4Ba192De1aB8Cf7e0E21896442';
const DEFAULT_FACTORY = '0xaB120F1FD31FB1EC39893B75d80a3822b1Cd8d0c';
const DEFAULT_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const DEFAULT_RPC_BY_CHAIN_ID = {
  1: 'https://ethereum.publicnode.com',
  146: 'https://rpc.soniclabs.com',
};

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

function resolveChain(chainId, rpcUrl) {
  const id = Number(chainId || process.env.CHAIN_ID || 1);
  if (![1, 146].includes(id)) {
    throw new Error(`Unsupported CHAIN_ID=${id}. Supported values: 1 or 146.`);
  }

  const finalRpcUrl = rpcUrl || process.env.RPC_URL || DEFAULT_RPC_BY_CHAIN_ID[id];
  const chain =
    id === 1
      ? {
          id: 1,
          name: 'Ethereum',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: { default: { http: [finalRpcUrl] }, public: { http: [finalRpcUrl] } },
          blockExplorers: { default: { name: 'Etherscan', url: 'https://etherscan.io' } },
        }
      : {
          id: 146,
          name: 'Sonic',
          nativeCurrency: { name: 'Sonic', symbol: 'S', decimals: 18 },
          rpcUrls: { default: { http: [finalRpcUrl] }, public: { http: [finalRpcUrl] } },
          blockExplorers: { default: { name: 'SonicScan', url: 'https://sonicscan.org' } },
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
  if (targetTimestamp <= nowSec) {
    throw new Error('targetTimestamp must be in the future.');
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
  if (![500, 3000, 10000].includes(feeTier)) {
    throw new Error('feeTier must be one of 500, 3000, 10000.');
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
    arbiter: String(options.arbiter || '0x818457C9e2b18D87981CCB09b75AE183D107b257').toLowerCase(),
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

  const pollSimulation = await publicClient.simulateContract({
    account,
    address: oracle,
    abi: ORACLE_ABI,
    functionName: 'createPoll',
    args: [args.question, args.rules, args.sources, BigInt(args.targetTimestamp), args.arbiter, args.category],
    value: pollFee,
  });

  const pollTxHash = await walletClient.writeContract(pollSimulation.request);
  const pollReceipt = await publicClient.waitForTransactionReceipt({ hash: pollTxHash });

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

  const liquidityRaw = parseUnits(String(args.liquidityUsdc), 6);
  const currentAllowance = await publicClient.readContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, factory],
  });

  let approveTxHash = null;
  if (currentAllowance < liquidityRaw) {
    approveTxHash = await walletClient.writeContract({
      address: usdc,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [factory, liquidityRaw],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
  }

  const distributionHint = [BigInt(args.distributionYes), BigInt(args.distributionNo)];

  const marketSimulation = await publicClient.simulateContract({
    account,
    address: factory,
    abi: FACTORY_ABI,
    functionName: 'createMarket',
    args: [pollAddress, usdc, liquidityRaw, distributionHint, args.feeTier, args.maxImbalance],
  });

  const marketTxHash = await walletClient.writeContract(marketSimulation.request);
  await publicClient.waitForTransactionReceipt({ hash: marketTxHash });

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
