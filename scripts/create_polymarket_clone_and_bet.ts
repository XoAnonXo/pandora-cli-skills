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
    if (key === 'dry-run' || key === 'execute' || key === 'allow-duplicate' || key === 'help') {
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

const normalizeBetChoice = (input: string): 'yes' | 'no' => {
  const key = input.toLowerCase();
  if (['yes', 'y', 'true', '1', 'arsenal', 'ars', 'manu'].includes(key)) return 'yes';
  if (['no', 'n', 'false', '0', 'everton', 'eve'].includes(key)) return 'no';
  throw new Error('Invalid --bet-on value. Use: --bet-on yes|no');
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

// ============================================================
// Args parsing
// ============================================================
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
  pandora clone-bet --dry-run|--execute [options]

Required:
  --question "<text>"
  --rules "<resolution rules>"
  --sources "<url1>" "<url2>" [more]
  --target-timestamp <unix-seconds>

Common options:
  --bet-on yes|no
  --bet-usd <amount>
  --market-type amm|parimutuel
  --liquidity <usdc>
  --allow-duplicate
`);
  process.exit(0);
}

const question = arg('question');
const rules = arg('rules');
const sources = listArg('sources');
const targetTimestampRaw = arg('target-timestamp') || arg('deadline-epoch');
const resolutionDelayHours = toInt(arg('target-timestamp-offset-hours', '1'), Number.NaN);
const arbiter = (arg('arbiter', DEFAULT_ARBITER) as Address);
const category = toInt(arg('category', '3'), 3);
const liquidity = arg('liquidity', '10');
const distributionYes = arg('distribution-yes', '500000000');
const distributionNo = arg('distribution-no', '500000000');
const curveFlattener = toInt(arg('curve-flattener', '7'), 7);
const curveOffset = toInt(arg('curve-offset', '30000'), 30000);
const betUsd = toNumber(arg('bet-usd', '10'), Number.NaN);

const dryRun = hasFlag('dry-run');
const execute = hasFlag('execute');
const betChoice = normalizeBetChoice(arg('bet-on', 'yes'));
const betOnYes = betChoice === 'yes';
const allowDuplicate = hasFlag('allow-duplicate');

if (!dryRun && !execute) {
  console.error('Use either --dry-run or --execute');
  process.exit(1);
}

if (!question || !rules) {
  console.error('Missing required args: --question --rules');
  process.exit(1);
}

if (!sources.length) {
  console.error('Missing required args: at least two --sources URLs are required.');
  process.exit(1);
}

if (sources.length < MIN_SOURCE_COUNT) {
  console.error(`Provide at least ${MIN_SOURCE_COUNT} public --sources URLs.`);
  process.exit(1);
}

const invalidSources = sources.filter((source) => !isValidPublicSourceUrl(source));
if (invalidSources.length) {
  console.error('Invalid source URLs:', invalidSources.join(', '));
  process.exit(1);
}

if (!hasExplicitYesNoAndEdgeCases(rules)) {
  console.error('Rules must include explicit Yes/No outcomes and edge-case handling (cancel/postpone/abandoned/unresolved cases).');
  process.exit(1);
}

if (arbiter.toLowerCase() === ZERO_ADDRESS) {
  console.error('Invalid --arbiter. Zero address is not allowed.');
  process.exit(1);
}

if (!/^0x[a-fA-F0-9]{40}$/.test(arbiter)) {
  console.error('Invalid --arbiter address format.');
  process.exit(1);
}

const targetTimestampSeconds = toInt(targetTimestampRaw, 0);
if (targetTimestampSeconds <= 0) {
  console.error('Missing or invalid --target-timestamp/--deadline-epoch (unix timestamp in seconds).');
  process.exit(1);
}

if (!Number.isFinite(resolutionDelayHours) || resolutionDelayHours < 0) {
  console.error('Invalid --target-timestamp-offset-hours. Use a non-negative integer.');
  process.exit(1);
}

const targetTimestamp = BigInt(targetTimestampSeconds);
const targetTimestampWithDelay = targetTimestamp + BigInt(resolutionDelayHours * 3600);

const liquidityUsdc = Number(liquidity);
if (!Number.isFinite(liquidityUsdc) || liquidityUsdc < 10) {
  console.error('Invalid --liquidity. Minimum initial liquidity is 10 USDC.');
  process.exit(1);
}
if (!Number.isFinite(betUsd) || betUsd <= 0) {
  console.error('Invalid --bet-usd. Must be a positive number in USDC.');
  process.exit(1);
}

if (Number(distributionYes) + Number(distributionNo) !== 1_000_000_000) {
  console.error('distribution-yes + distribution-no must equal 1000000000');
  process.exit(1);
}

if (curveFlattener < 1 || curveFlattener > 11) {
  console.error('Invalid --curve-flattener for PariMutuel. Allowed range: 1-11');
  process.exit(1);
}

const nowSec = Math.floor(Date.now() / 1000);
if (targetTimestamp <= BigInt(nowSec)) {
  console.error('Target deadline must be in the future.');
  process.exit(1);
}

if (targetTimestampWithDelay <= BigInt(nowSec)) {
  console.error('Effective target deadline with +offset must be in the future.');
  process.exit(1);
}

if (targetTimestampWithDelay <= BigInt(nowSec + MIN_DEADLINE_WINDOW_SECONDS)) {
  console.warn('Warning: effective target deadline is within 12h; DAO verification may be less favorable.');
}
if (resolutionDelayHours !== 1) {
  console.warn(`Target timestamp will be shifted by +${resolutionDelayHours} hour(s) before submission.`);
}

// ============================================================
// Environment
// ============================================================
const ORACLE = (process.env.ORACLE as Address) || '0x259308E7d8557e4Ba192De1aB8Cf7e0E21896442';
const FACTORY = (process.env.FACTORY as Address) || '0xaB120F1FD31FB1EC39893B75d80a3822b1Cd8d0c';
const USDC = (process.env.USDC as Address) || '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const CHAIN_ID = Number(process.env.CHAIN_ID || '1');
const DEFAULT_RPC_BY_CHAIN_ID: Record<number, string> = {
  1: 'https://ethereum.publicnode.com',
  146: 'https://rpc.soniclabs.com',
};
if (!DEFAULT_RPC_BY_CHAIN_ID[CHAIN_ID]) {
  console.error('Unsupported CHAIN_ID, use 1 or 146');
  process.exit(1);
}
const RPC_URL = process.env.RPC_URL || DEFAULT_RPC_BY_CHAIN_ID[CHAIN_ID];
const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('Missing PRIVATE_KEY');
  process.exit(1);
}

const chain =
  CHAIN_ID === 1
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

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);

const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain, transport: http(RPC_URL) });

// ============================================================
// ABIs
// ============================================================
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
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
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
    outputs: [{ type: 'address' }],
  },
] as const;

const FACTORY_ABI = [
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
    outputs: [{ type: 'address' }],
  },
] as const;

const PARI_MUTUEL_ABI = [
  {
    name: 'buy',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'isYes', type: 'bool' },
      { name: 'collateralAmount', type: 'uint256' },
      { name: 'minSharesOut', type: 'uint256' },
    ],
    outputs: [{ name: 'sharesOut', type: 'uint256' }],
  },
] as const;

const PollCreatedEvent = {
  type: 'event',
  name: 'PollCreated',
  anonymous: false,
  inputs: [
    { indexed: true, name: 'pollAddress', type: 'address' },
    { indexed: true, name: 'creator', type: 'address' },
    { indexed: false, name: 'deadlineEpoch', type: 'uint32' },
    { indexed: false, name: 'question', type: 'string' },
  ],
} as const;

const PariMutuelCreatedEvent = {
  type: 'event',
  name: 'PariMutuelCreated',
  anonymous: false,
  inputs: [
    { indexed: true, name: 'pollAddress', type: 'address' },
    { indexed: true, name: 'marketAddress', type: 'address' },
    { indexed: true, name: 'creator', type: 'address' },
    { indexed: false, name: 'collateral', type: 'address' },
    { indexed: false, name: 'curveFlattener', type: 'uint8' },
    { indexed: false, name: 'curveOffset', type: 'uint24' },
  ],
} as const;

const questionMatchesExisting = async (
  oracleAddress: Address,
  questionText: string,
): Promise<boolean> => {
  const latest = await publicClient.getBlockNumber();
  const fromBlock = latest > 4900n ? latest - 4900n : 0n;
  const logs = await publicClient.getLogs({
    address: oracleAddress,
    fromBlock,
    toBlock: 'latest',
    topics: ['0x3b273b47407895d709eaea3db8189cca171a9a7542ec734ff823908bcf88bd9c'],
  });

  for (const log of logs) {
    try {
      const parsed: any = decodeEventLog({ abi: [PollCreatedEvent], data: log.data, topics: log.topics as any });
      if (String(parsed.args.question).trim().toLowerCase() === questionText.trim().toLowerCase()) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
};

// ============================================================
// Runtime
// ============================================================
async function main() {
  const isDuplicate = await questionMatchesExisting(ORACLE, question);
  if (isDuplicate && !allowDuplicate) {
    console.error('Duplicate question already exists on this oracle. Use --allow-duplicate to proceed or change --question.');
    process.exit(1);
  }

  console.log('Target timestamp', targetTimestamp.toString(), '(provided)');
  console.log('Target timestamp used onchain', targetTimestampWithDelay.toString(), '(+ delay hrs)');
  console.log('Wallet', account.address);
  console.log('Deploy target', CHAIN_ID === 1 ? 'Ethereum' : 'Sonic');

  const liquidityAmount = parseUnits(liquidity, 6);
  const betAmount = parseUnits(String(betUsd), 6);
  const distributionHint = [BigInt(distributionYes), BigInt(distributionNo)] as [bigint, bigint];

  const [operatorGasFee, protocolFee, ethBal, usdcBal] = await Promise.all([
    publicClient.readContract({ address: ORACLE, abi: ORACLE_ABI as any, functionName: 'operatorGasFee' }),
    publicClient.readContract({ address: ORACLE, abi: ORACLE_ABI as any, functionName: 'protocolFee' }),
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({ address: USDC, abi: ERC20_ABI as any, functionName: 'balanceOf', args: [account.address] }),
  ]);

  const requiredFee = (operatorGasFee + protocolFee) as bigint;
  console.log('Wallet ETH:', formatUnits(ethBal, 18));
  console.log('Wallet USDC:', formatUnits(usdcBal, 6));
  console.log('Poll fee required:', formatUnits(requiredFee, 18));

  if (dryRun && !execute) {
    console.log('DRY RUN:', {
      question,
      rules,
      sources,
      deadline: targetTimestamp.toString(),
      deadlineWithOffset: targetTimestampWithDelay.toString(),
      arbiter,
      category,
      liquidityUSDC: liquidity,
      distributionHint,
      curveFlattener,
      curveOffset,
      betUSD: String(betUsd),
      betOutcome: betOnYes ? 'Yes' : 'No',
      oracle: ORACLE,
      factory: FACTORY,
      chainId: CHAIN_ID,
    });
    return;
  }

  const pollHash = await walletClient.writeContract({
    address: ORACLE,
    abi: ORACLE_ABI as any,
    functionName: 'createPoll',
    args: [question, rules, sources, targetTimestampWithDelay, arbiter, category],
    value: requiredFee,
  });

  const pollReceipt = await publicClient.waitForTransactionReceipt({ hash: pollHash });
  const pollLog = pollReceipt.logs.find((log) => log.address.toLowerCase() === ORACLE.toLowerCase());
  if (!pollLog) throw new Error('PollCreated event not found in receipt');
  const pollParsed: any = decodeEventLog({ abi: [PollCreatedEvent], data: pollLog.data, topics: pollLog.topics as any });
  const pollAddress = pollParsed.args.pollAddress as Address;
  console.log('Poll created:', pollAddress);
  console.log('Poll tx:', pollReceipt.transactionHash);

  const factoryAllowance = (await publicClient.readContract({
    address: USDC,
    abi: ERC20_ABI as any,
    functionName: 'allowance',
    args: [account.address, FACTORY],
  })) as bigint;

  if (factoryAllowance < liquidityAmount) {
    const approveHash = await walletClient.writeContract({
      address: USDC,
      abi: ERC20_ABI as any,
      functionName: 'approve',
      args: [FACTORY, liquidityAmount],
    });
    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log('Factory approved tx:', approveReceipt.transactionHash);
  }

  const marketHash = await walletClient.writeContract({
    address: FACTORY,
    abi: FACTORY_ABI as any,
    functionName: 'createPariMutuel',
    args: [pollAddress, USDC, liquidityAmount, distributionHint, curveFlattener, curveOffset],
  });

  const marketReceipt = await publicClient.waitForTransactionReceipt({ hash: marketHash });
  const marketLog = marketReceipt.logs.find((log) => log.address.toLowerCase() === FACTORY.toLowerCase());
  if (!marketLog) throw new Error('PariMutuelCreated event not found in receipt');
  const marketParsed: any = decodeEventLog({ abi: [PariMutuelCreatedEvent], data: marketLog.data, topics: marketLog.topics as any });
  const marketAddress = marketParsed.args.marketAddress as Address;
  console.log('PariMutuel market created:', marketAddress);
  console.log('Market tx:', marketReceipt.transactionHash);

  const allowance = (await publicClient.readContract({
    address: USDC,
    abi: ERC20_ABI as any,
    functionName: 'allowance',
    args: [account.address, marketAddress],
  })) as bigint;

  if (allowance < betAmount) {
    const approveHash = await walletClient.writeContract({
      address: USDC,
      abi: ERC20_ABI as any,
      functionName: 'approve',
      args: [marketAddress, betAmount],
    });
    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log('USDC approved tx:', approveReceipt.transactionHash);
  }

  const buyHash = await walletClient.writeContract({
    address: marketAddress,
    abi: PARI_MUTUEL_ABI as any,
    functionName: 'buy',
    args: [betOnYes, betAmount, 0n],
  });

  const buyReceipt = await publicClient.waitForTransactionReceipt({ hash: buyHash });
  console.log('Bet placed:', betOnYes ? 'Yes' : 'No', `${betUsd} USDC`);
  console.log('Bet tx:', buyReceipt.transactionHash);

  console.log('DONE');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
