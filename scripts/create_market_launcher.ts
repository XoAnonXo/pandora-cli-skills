#!/usr/bin/env node
// @ts-nocheck
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatUnits,
  http,
  parseUnits,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const DEFAULT_ARBITER = '0x818457C9e2b18D87981CCB09b75AE183D107b257';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const MIN_SOURCE_COUNT = 2;
const MIN_DEADLINE_WINDOW_SECONDS = 12 * 60 * 60;

type ParsedArgs = Record<string, string | string[]>;

const parseArgs = (argv: string[]): { args: ParsedArgs; flags: Set<string> } => {
  const args: ParsedArgs = {};
  const flags = new Set<string>();

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '-h') {
      flags.add('help');
      continue;
    }
    if (!token.startsWith('--')) continue;

    const key = token.replace(/^--/, '');
    if (key === 'dry-run' || key === 'execute' || key === 'help') {
      flags.add(key);
      continue;
    }

    if (key === 'sources') {
      const values: string[] = [];
      let j = i + 1;
      while (j < argv.length && !argv[j].startsWith('--')) {
        values.push(argv[j]);
        j += 1;
      }

      if (!values.length) {
        throw new Error('Missing value for --sources');
      }
      args[key] = values;
      i = j - 1;
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = next;
    i += 1;
  }

  return { args, flags };
};

const isValidPublicSourceUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(host)) return false;
    return true;
  } catch {
    return false;
  }
};

const hasExplicitYesNoAndEdgeCases = (rules: string): boolean => {
  const hasYes = /\byes\b/i.test(rules);
  const hasNo = /\bno\b/i.test(rules);
  const hasEdgeCase = /(cancel|canceled|cancelled|postpone|postponed|abandon|abandoned|void|refund|reschedul|replay|unresolved)/i.test(rules);
  return hasYes && hasNo && hasEdgeCase;
};

const toInt = (value: string, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return parsed;
};

const toNumber = (value: string, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};

const ERC20_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

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
] as const;

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
] as const;

const PollCreatedEvent = {
  type: 'event',
  name: 'PollCreated',
  inputs: [
    { indexed: true, name: 'pollAddress', type: 'address' },
    { indexed: true, name: 'creator', type: 'address' },
    { indexed: false, name: 'deadlineEpoch', type: 'uint32' },
    { indexed: false, name: 'question', type: 'string' },
  ],
} as const;

const RAW_ARGS = process.argv.slice(2);
const { args: parsedArgs, flags } = parseArgs(RAW_ARGS);
const arg = (name: string, fallback = ''): string => {
  const value = parsedArgs[name];
  return typeof value === 'string' ? value : fallback;
};
const listArg = (name: string): string[] => {
  const value = parsedArgs[name];
  return Array.isArray(value) ? value : [];
};
const hasFlag = (name: string) => flags.has(name);

if (hasFlag('help')) {
  console.log(`
Usage:
  pandora launch --dry-run|--execute [options]

Required:
  --question "<text>"
  --rules "<resolution rules>"
  --sources "<url1>" "<url2>" [more]
  --target-timestamp <unix-seconds>

Common options:
  --market-type amm|parimutuel
  --liquidity <usdc>
  --fee-tier <bps>
  --distribution-yes <parts-per-billion>
  --distribution-no <parts-per-billion>
`);
  process.exit(0);
}

const marketTypeArg = arg('market-type', 'amm').toLowerCase();
const marketType = marketTypeArg === 'parimutuel' || marketTypeArg === 'pari' || marketTypeArg === 'pm' ? 'parimutuel' : 'amm';

const args = {
  dryRun: hasFlag('dry-run'),
  execute: hasFlag('execute'),
  question: arg('question'),
  rules: arg('rules'),
  sources: listArg('sources'),
  targetTimestamp: arg('target-timestamp') || arg('deadline-epoch'),
  targetTimestampOffsetHours: arg('target-timestamp-offset-hours', '1'),
  arbiter: (arg('arbiter', DEFAULT_ARBITER) as Address),
  category: toInt(arg('category', '0'), 0),
  marketType,
  liquidity: arg('liquidity', '0'),
  distributionYes: arg('distribution-yes', '500000000'),
  distributionNo: arg('distribution-no', '500000000'),
  feeTier: toInt(arg('fee-tier', '3000'), 3000),
  maxImbalance: toInt(arg('max-imbalance', '10000'), 10000),
  curveFlattener: toInt(arg('curve-flattener', '7'), 7),
  curveOffset: toInt(arg('curve-offset', '30000'), 30000),
};

if (!args.question || !args.rules) {
  console.error('Missing required args: --question --rules');
  process.exit(1);
}

if (!args.sources.length) {
  console.error('Missing required args: at least two --sources values are required');
  process.exit(1);
}

if (args.sources.length < MIN_SOURCE_COUNT) {
  console.error(`Provide at least ${MIN_SOURCE_COUNT} public --sources URLs`);
  process.exit(1);
}

const invalidSources = args.sources.filter((source) => !isValidPublicSourceUrl(source));
if (invalidSources.length) {
  console.error('Invalid --sources values. Use only public http/https URLs:', invalidSources.join(', '));
  process.exit(1);
}

if (!hasExplicitYesNoAndEdgeCases(args.rules)) {
  console.error('Rules must include explicit Yes/No outcomes and edge-case handling (cancel/postpone/abandoned/unresolved cases).');
  process.exit(1);
}

if (!args.dryRun && !args.execute) {
  console.error('You must pass either --dry-run or --execute');
  process.exit(1);
}

if (args.arbiter.toLowerCase() === ZERO_ADDRESS) {
  console.error('Invalid --arbiter. Zero address is not allowed.');
  process.exit(1);
}

if (!/^0x[a-fA-F0-9]{40}$/.test(args.arbiter)) {
  console.error('Invalid --arbiter address format.');
  process.exit(1);
}

if (args.marketType === 'amm' && ![500, 3000, 10000].includes(args.feeTier)) {
  console.error('Invalid --fee-tier for AMM. Allowed values: 500 | 3000 | 10000');
  process.exit(1);
}

if (args.marketType === 'parimutuel') {
  if (args.curveFlattener < 1 || args.curveFlattener > 11) {
    console.error('Invalid --curve-flattener for PariMutuel. Allowed range: 1-11');
    process.exit(1);
  }
}

const liquidityAmount = toNumber(args.liquidity, Number.NaN);
if (!Number.isFinite(liquidityAmount) || liquidityAmount < 10) {
  console.error('Invalid --liquidity. Must be at least 10 USDC');
  process.exit(1);
}

const distributionSum = Number(args.distributionYes) + Number(args.distributionNo);
if (distributionSum !== 1_000_000_000) {
  console.error('distribution-yes + distribution-no must equal 1000000000');
  process.exit(1);
}

if (!args.targetTimestamp) {
  console.error('Missing required args: --target-timestamp or --deadline-epoch (unix timestamp in seconds)');
  process.exit(1);
}

const targetTimestampSeconds = toInt(args.targetTimestamp, 0);
if (targetTimestampSeconds <= 0) {
  console.error('Invalid --target-timestamp. Provide a unix timestamp in seconds.');
  process.exit(1);
}

const targetTimestampOffsetHours = toInt(args.targetTimestampOffsetHours, Number.NaN);
if (!Number.isFinite(targetTimestampOffsetHours) || targetTimestampOffsetHours < 0) {
  console.error('Invalid --target-timestamp-offset-hours. Use a non-negative integer.');
  process.exit(1);
}

const targetTimestamp = BigInt(targetTimestampSeconds);
const targetTimestampWithOffset = targetTimestamp + BigInt(targetTimestampOffsetHours * 60 * 60);
const nowSec = Math.floor(Date.now() / 1000);
if (targetTimestamp <= BigInt(nowSec)) {
  console.error('Target deadline must be in the future.');
  process.exit(1);
}
if (targetTimestampWithOffset <= BigInt(nowSec)) {
  console.error('Effective target deadline with +offset must be in the future.');
  process.exit(1);
}
if (targetTimestampWithOffset <= BigInt(nowSec + MIN_DEADLINE_WINDOW_SECONDS)) {
  console.warn('Warning: effective target deadline is within 12h; DAO verification may be less favorable.');
}

const ORACLE = (process.env.ORACLE as Address) || '0x259308E7d8557e4Ba192De1aB8Cf7e0E21896442';
const FACTORY = (process.env.FACTORY as Address) || '0xaB120F1FD31FB1EC39893B75d80a3822b1Cd8d0c';
const USDC = (process.env.USDC as Address) || '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const CHAIN_ID = Number(process.env.CHAIN_ID || '1');
const DEFAULT_RPC_BY_CHAIN_ID: Record<number, string> = {
  1: 'https://ethereum.publicnode.com',
  146: 'https://rpc.soniclabs.com',
};
if (!DEFAULT_RPC_BY_CHAIN_ID[CHAIN_ID]) {
  console.error(`Unsupported CHAIN_ID=${CHAIN_ID}. Supported: 1 or 146`);
  process.exit(1);
}
const RPC_URL = process.env.RPC_URL || DEFAULT_RPC_BY_CHAIN_ID[CHAIN_ID];
const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('Set PRIVATE_KEY');
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
const chain = CHAIN_ID === 1
  ? {
      id: 1,
      name: 'Ethereum',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [RPC_URL] }, public: { http: [RPC_URL] } },
      blockExplorers: { default: { name: 'Etherscan', url: 'https://etherscan.io' } },
    }
  : {
      id: 146,
      name: 'Sonic',
      nativeCurrency: { name: 'Sonic', symbol: 'S', decimals: 18 },
      rpcUrls: { default: { http: [RPC_URL] }, public: { http: [RPC_URL] } },
      blockExplorers: { default: { name: 'SonicScan', url: 'https://sonicscan.org' } },
    };

const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain, transport: http(RPC_URL) });

async function main() {
  console.log('Network RPC:', RPC_URL);
  console.log('Deployer:', account.address);

  const [operatorGasFee, protocolFee] = await Promise.all([
    publicClient.readContract({ address: ORACLE, abi: ORACLE_ABI as any, functionName: 'operatorGasFee' }),
    publicClient.readContract({ address: ORACLE, abi: ORACLE_ABI as any, functionName: 'protocolFee' }),
  ]);

  const requiredFee = (operatorGasFee + protocolFee) as bigint;
  console.log('required poll fee:', formatUnits(requiredFee, 18), 'ETH-equivalent units');

  const initialLiquidity = parseUnits(args.liquidity, 6);
  const distributionHint = [BigInt(args.distributionYes), BigInt(args.distributionNo)] as [bigint, bigint];

  if (args.dryRun && !args.execute) {
    console.log('DRY RUN: would execute this market setup:');
    console.log({
      marketType: args.marketType,
      question: args.question,
      arbiter: args.arbiter,
      category: args.category,
      targetTimestampProvided: String(targetTimestamp),
      targetTimestampOnChain: String(targetTimestampWithOffset),
      targetTimestampOffsetHours,
      liquidityUSDC: args.liquidity,
      distributionHint,
      feeTier: args.marketType === 'amm' ? args.feeTier : undefined,
      maxPriceImbalancePerHour: args.marketType === 'amm' ? args.maxImbalance : undefined,
      curveFlattener: args.marketType === 'parimutuel' ? args.curveFlattener : undefined,
      curveOffset: args.marketType === 'parimutuel' ? args.curveOffset : undefined,
      requiredFeeWei: String(requiredFee),
      oracle: ORACLE,
      factory: FACTORY,
      collateral: USDC,
    });
    return;
  }

  const hash = await walletClient.writeContract({
    address: ORACLE,
    abi: ORACLE_ABI as any,
    functionName: 'createPoll',
    args: [
      args.question,
      args.rules,
      args.sources,
      targetTimestampWithOffset,
      args.arbiter as Address,
      args.category,
    ],
    value: requiredFee,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const pollLog = receipt.logs.find((log) => log.address.toLowerCase() === ORACLE.toLowerCase());
  if (!pollLog) throw new Error('No logs found for poll creation');

  const parsed = decodeEventLog({
    abi: [PollCreatedEvent],
    data: pollLog.data,
    topics: pollLog.topics as any,
  }) as any;
  const pollAddress = parsed.args.pollAddress as Address;
  console.log('Poll created:', pollAddress);

  const allowance = (await publicClient.readContract({
    address: USDC,
    abi: ERC20_ABI as any,
    functionName: 'allowance',
    args: [account.address, FACTORY],
  })) as bigint;

  if (allowance < initialLiquidity) {
    const approveHash = await walletClient.writeContract({
      address: USDC,
      abi: ERC20_ABI as any,
      functionName: 'approve',
      args: [FACTORY, initialLiquidity],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log('USDC approved for factory');
  }

  const marketFn = args.marketType === 'parimutuel' ? 'createPariMutuel' : 'createMarket';
  const marketArgs = args.marketType === 'parimutuel'
    ? [pollAddress, USDC, initialLiquidity, distributionHint, args.curveFlattener, args.curveOffset]
    : [pollAddress, USDC, initialLiquidity, distributionHint, args.feeTier, args.maxImbalance];

  const marketHash = await walletClient.writeContract({
    address: FACTORY,
    abi: FACTORY_ABI as any,
    functionName: marketFn as any,
    args: marketArgs,
  });
  const marketReceipt = await publicClient.waitForTransactionReceipt({ hash: marketHash });
  console.log('Market created tx:', marketReceipt.transactionHash);
  console.log('Done');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
