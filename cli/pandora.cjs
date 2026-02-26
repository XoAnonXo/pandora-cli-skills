#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  fetchHistory,
} = require('./lib/history_service.cjs');
const { buildExportPayload } = require('./lib/export_service.cjs');
const { scanArbitrage } = require('./lib/arbitrage_service.cjs');
const { runAutopilot } = require('./lib/autopilot_service.cjs');
const { hasWebhookTargets, sendWebhookNotifications } = require('./lib/webhook_service.cjs');
const { fetchLeaderboard } = require('./lib/leaderboard_service.cjs');
const { evaluateMarket, AnalyzeProviderError } = require('./lib/analyze_provider.cjs');
const { buildSuggestions } = require('./lib/suggest_service.cjs');
const { buildMirrorPlan, deployMirror, verifyMirror } = require('./lib/mirror_service.cjs');
const { runMirrorSync } = require('./lib/mirror_sync_service.cjs');
const {
  defaultStateFile: defaultAutopilotStateFile,
  defaultKillSwitchFile: defaultAutopilotKillSwitchFile,
} = require('./lib/autopilot_state_store.cjs');
const {
  defaultStateFile: defaultMirrorStateFile,
  defaultKillSwitchFile: defaultMirrorKillSwitchFile,
  loadState: loadMirrorState,
} = require('./lib/mirror_state_store.cjs');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_ENV_FILE = path.join(ROOT, 'scripts', '.env');
const DEFAULT_ENV_EXAMPLE = path.join(ROOT, 'scripts', '.env.example');
const DEFAULT_INDEXER_URL = 'https://pandoraindexer.up.railway.app/';

const REQUIRED_ENV_KEYS = ['CHAIN_ID', 'RPC_URL', 'PRIVATE_KEY', 'ORACLE', 'FACTORY', 'USDC'];
const SUPPORTED_CHAIN_IDS = new Set([1, 146]);
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const COMMAND_TARGETS = {
  launch: path.join(ROOT, 'scripts', 'create_market_launcher.ts'),
  'clone-bet': path.join(ROOT, 'scripts', 'create_polymarket_clone_and_bet.ts'),
};

const OUTPUT_MODES = new Set(['table', 'json']);
const DEFAULT_RPC_TIMEOUT_MS = 12_000;
const DEFAULT_INDEXER_TIMEOUT_MS = 12_000;
const POSITIONS_ORDER_BY_FIELDS = ['lastTradeAt', 'id', 'chainId', 'marketAddress', 'user'];
const POSITIONS_ORDER_BY_FIELD_SET = new Set(POSITIONS_ORDER_BY_FIELDS);
const MARKET_LIFECYCLE_FILTERS = new Set(['all', 'active', 'resolved', 'expiring-soon']);
const DEFAULT_EXPIRING_SOON_HOURS = 24;
const MARKETS_LIST_FIELDS = [
  'id',
  'chainId',
  'chainName',
  'pollAddress',
  'creator',
  'marketType',
  'marketCloseTimestamp',
  'totalVolume',
  'currentTvl',
  'createdAt',
];
const POLLS_LIST_FIELDS = [
  'id',
  'chainId',
  'chainName',
  'creator',
  'question',
  'status',
  'category',
  'deadlineEpoch',
  'createdAt',
  'createdTxHash',
];
const LIQUIDITY_EVENT_ODDS_FIELDS = [
  'id',
  'marketAddress',
  'pollAddress',
  'yesTokenAmount',
  'noTokenAmount',
  'timestamp',
];
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
];

const MARKET_DIRECT_ODDS_FIELDS = [
  { yesField: 'yesPct', noField: 'noPct', source: 'direct:yesPct/noPct' },
  { yesField: 'yesOdds', noField: 'noOdds', source: 'direct:yesOdds/noOdds' },
  { yesField: 'yesProbability', noField: 'noProbability', source: 'direct:yesProbability/noProbability' },
  { yesField: 'yesPrice', noField: 'noPrice', source: 'direct:yesPrice/noPrice' },
  { yesField: 'probYes', noField: 'probNo', source: 'direct:probYes/probNo' },
];

const MARKET_RESERVE_ODDS_FIELDS = [
  { yesField: 'yesTokenAmount', noField: 'noTokenAmount', source: 'reserve:yesTokenAmount/noTokenAmount' },
  { yesField: 'yesReserve', noField: 'noReserve', source: 'reserve:yesReserve/noReserve' },
  { yesField: 'yesLiquidity', noField: 'noLiquidity', source: 'reserve:yesLiquidity/noLiquidity' },
];

const EVENT_SOURCES = {
  liquidity: {
    singleQueryName: 'liquidityEvents',
    listQueryName: 'liquidityEventss',
    filterType: 'liquidityEventsFilter',
    fields: [
      'id',
      'chainId',
      'chainName',
      'provider',
      'marketAddress',
      'pollAddress',
      'eventType',
      'collateralAmount',
      'lpTokens',
      'yesTokenAmount',
      'noTokenAmount',
      'yesTokensReturned',
      'noTokensReturned',
      'txHash',
      'timestamp',
    ],
  },
  'oracle-fee': {
    singleQueryName: 'oracleFeeEvents',
    listQueryName: 'oracleFeeEventss',
    filterType: 'oracleFeeEventsFilter',
    fields: [
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
    ],
  },
  claim: {
    singleQueryName: 'claimEvents',
    listQueryName: 'claimEventss',
    filterType: 'claimEventsFilter',
    fields: ['id', 'campaignAddress', 'userAddress', 'amount', 'signature', 'blockNumber', 'timestamp', 'txHash'],
  },
};

class CliError extends Error {
  constructor(code, message, details = undefined, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.details = details;
    this.exitCode = exitCode;
  }
}

function printHelpTable() {
  console.log(`
pandora - Prediction market CLI

Usage:
  pandora [--output table|json] help
  pandora [--output table|json] init-env [--force] [--dotenv-path <path>] [--example <path>]
  pandora [--output table|json] doctor [--dotenv-path <path>] [--skip-dotenv] [--check-usdc-code] [--rpc-timeout-ms <ms>]
  pandora [--output table|json] setup [--force] [--dotenv-path <path>] [--example <path>] [--check-usdc-code] [--rpc-timeout-ms <ms>]
  pandora [--output table|json] markets list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>] [--where-json <json>] [--active|--resolved|--expiring-soon] [--expiring-hours <n>] [--expand] [--with-odds]
  pandora [--output table|json] markets get [--id <id> ...] [--stdin]
  pandora [--output table|json] polls list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--status <int>] [--category <int>] [--question-contains <text>] [--where-json <json>]
  pandora [--output table|json] polls get --id <id>
  pandora [--output table|json] events list [--type all|liquidity|oracle-fee|claim] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-direction asc|desc] [--chain-id <id>] [--wallet <address>] [--market-address <address>] [--poll-address <address>] [--tx-hash <hash>]
  pandora [--output table|json] events get --id <id> [--type all|liquidity|oracle-fee|claim]
  pandora [--output table|json] positions list [--wallet <address>] [--market-address <address>] [--chain-id <id>] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--where-json <json>]
  pandora [--output table|json] portfolio --wallet <address> [--chain-id <id>] [--limit <n>] [--include-events|--no-events]
  pandora [--output table|json] watch [--wallet <address>] [--market-address <address>] [--side yes|no] [--amount-usdc <amount>] [--iterations <n>] [--interval-ms <ms>] [--chain-id <id>] [--include-events|--no-events] [--yes-pct <0-100>] [--alert-yes-below <0-100>] [--alert-yes-above <0-100>] [--alert-net-liquidity-below <amount>] [--alert-net-liquidity-above <amount>] [--fail-on-alert]
  pandora [--output table|json] scan [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>] [--where-json <json>] [--expand] [--with-odds]
  pandora [--output table|json] quote [--indexer-url <url>] [--timeout-ms <ms>] --market-address <address> --side yes|no --amount-usdc <amount> [--yes-pct <0-100>] [--slippage-bps <0-10000>]
  pandora [--output table|json] trade [--indexer-url <url>] [--timeout-ms <ms>] [--dotenv-path <path>] [--skip-dotenv] --market-address <address> --side yes|no --amount-usdc <amount> --dry-run|--execute [--yes-pct <0-100>] [--slippage-bps <0-10000>] [--min-shares-out-raw <uint>] [--max-amount-usdc <amount>] [--min-probability-pct <0-100>] [--max-probability-pct <0-100>] [--allow-unquoted-execute] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>]
  pandora [--output table|json] history --wallet <address> [--chain-id <id>] [--market-address <address>] [--side yes|no|both] [--status all|open|won|lost|closed] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by timestamp|pnl|entry-price|mark-price] [--order-direction asc|desc] [--include-seed]
  pandora [--output table|json] export --wallet <address> --format csv|json [--chain-id <id>] [--year <yyyy>] [--from <unix>] [--to <unix>] [--out <path>]
  pandora [--output table|json] arbitrage [--chain-id <id>] [--venues pandora,polymarket] [--limit <n>] [--min-spread-pct <n>] [--min-liquidity-usdc <n>] [--max-close-diff-hours <n>] [--similarity-threshold <0-1>] [--cross-venue-only|--allow-same-venue] [--with-rules] [--include-similarity] [--question-contains <text>] [--polymarket-host <url>] [--polymarket-mock-url <url>]
  pandora [--output table|json] autopilot run|once --market-address <address> --side yes|no --amount-usdc <amount> [--trigger-yes-below <0-100>] [--trigger-yes-above <0-100>] [--paper|--execute-live] [--interval-ms <ms>] [--cooldown-ms <ms>] [--max-amount-usdc <amount>] [--max-open-exposure-usdc <amount>] [--max-trades-per-day <n>] [--state-file <path>] [--kill-switch-file <path>] [--webhook-url <url>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>]
  pandora [--output table|json] mirror plan|deploy|verify|sync|status ...
  pandora [--output table|json] webhook test [--webhook-url <url>] [--webhook-template <json>] [--webhook-secret <secret>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>] [--webhook-timeout-ms <ms>] [--webhook-retries <n>]
  pandora [--output table|json] leaderboard [--metric profit|volume|win-rate] [--chain-id <id>] [--limit <n>] [--min-trades <n>]
  pandora [--output table|json] analyze --market-address <address> [--provider <name>] [--model <id>] [--max-cost-usd <n>] [--temperature <n>] [--timeout-ms <ms>]
  pandora [--output table|json] suggest --wallet <address> --risk low|medium|high --budget <amount> [--count <n>] [--include-venues pandora,polymarket]
  pandora [--output table|json] resolve --poll-address <address> --answer yes|no|invalid --reason <text> --dry-run|--execute
  pandora [--output table|json] lp add|remove|positions ...
  pandora launch [--dotenv-path <path>] [--skip-dotenv] [script args...]
  pandora clone-bet [--dotenv-path <path>] [--skip-dotenv] [script args...]

Examples:
  pandora setup
  pandora --output json doctor --check-usdc-code
  pandora markets list --active --with-odds --limit 10
  pandora markets get --id market-1 --id market-2
  pandora polls get --id 0xabc...
  pandora events list --type all --limit 25
  pandora positions list --wallet 0x1234...
  pandora portfolio --wallet 0x1234... --chain-id 1
  pandora watch --market-address 0xabc... --side yes --amount-usdc 10 --iterations 5 --interval-ms 2000
  pandora scan --limit 25 --chain-id 1 --with-odds
  pandora quote --market-address 0xabc... --side yes --amount-usdc 50
  pandora trade --dry-run --market-address 0xabc... --side no --amount-usdc 25 --max-amount-usdc 50 --min-probability-pct 20
  pandora history --wallet 0x1234... --chain-id 1 --limit 50
  pandora export --wallet 0x1234... --format csv --year 2026 --out ./trades-2026.csv
  pandora arbitrage --chain-id 1 --limit 25 --venues pandora,polymarket --cross-venue-only --with-rules --include-similarity
  pandora autopilot once --market-address 0xabc... --side no --amount-usdc 10 --trigger-yes-below 15 --paper
  pandora mirror plan --source polymarket --polymarket-market-id 0xabc... --with-rules --include-similarity
  pandora mirror verify --pandora-market-address 0xabc... --polymarket-market-id 0xdef... --include-similarity
  pandora mirror sync once --pandora-market-address 0xabc... --polymarket-market-id 0xdef... --paper
  pandora webhook test --webhook-url https://example.com/hook --webhook-template '{\"text\":\"{{message}}\"}'
  pandora leaderboard --metric profit --limit 20
  pandora analyze --market-address 0xabc... --provider mock
  pandora suggest --wallet 0x1234... --risk medium --budget 50 --count 3
  pandora launch --dry-run --market-type amm --question "Will BTC close above $100k by end of 2026?" --rules "Resolves YES if ... Resolves NO if ... cancelled/postponed/abandoned/unresolved => NO." --sources "https://coinmarketcap.com/currencies/bitcoin/" "https://www.coingecko.com/en/coins/bitcoin" --target-timestamp 1798675200 --liquidity 100 --fee-tier 3000

Notes:
  - launch/clone-bet forward unknown flags directly to underlying scripts.
  - scripts/.env is loaded automatically for launch/clone-bet unless --skip-dotenv is used.
  - --output json is supported for all commands except launch/clone-bet.
  - Indexer URL resolution order: --indexer-url, PANDORA_INDEXER_URL, INDEXER_URL, default public indexer.
  - watch is non-transactional monitoring; use quote/trade for execution workflows.
`);
}

function printQuoteHelpTable() {
  console.log(`
pandora quote - Estimate a YES/NO trade

Usage:
  pandora [--output table|json] quote [--indexer-url <url>] [--timeout-ms <ms>] --market-address <address> --side yes|no --amount-usdc <amount> [--yes-pct <0-100>] [--slippage-bps <0-10000>]

Notes:
  - If --yes-pct is omitted, quote attempts to derive odds from latest liquidity events on the indexer.
  - Output includes odds source and estimated shares/payout.
`);
}

function printTradeHelpTable() {
  console.log(`
pandora trade - Execute a buy on a market

Usage:
  pandora [--output table|json] trade [--indexer-url <url>] [--timeout-ms <ms>] [--dotenv-path <path>] [--skip-dotenv] --market-address <address> --side yes|no --amount-usdc <amount> --dry-run|--execute [--yes-pct <0-100>] [--slippage-bps <0-10000>] [--min-shares-out-raw <uint>] [--max-amount-usdc <amount>] [--min-probability-pct <0-100>] [--max-probability-pct <0-100>] [--allow-unquoted-execute] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>]

Notes:
  - --dry-run prints the execution plan and quote without sending transactions.
  - --execute performs allowance check, optional USDC approve, then calls buy(bool,uint256,uint256).
  - --max-amount-usdc and probability guard flags fail fast before execution.
  - --execute requires a quote by default unless --min-shares-out-raw or --allow-unquoted-execute is set.
  - Current execute path targets PariMutuel-compatible markets.
`);
}

function printWatchHelpTable() {
  console.log(`
pandora watch - Poll portfolio/market snapshots

Usage:
  pandora [--output table|json] watch [--wallet <address>] [--market-address <address>] [--side yes|no] [--amount-usdc <amount>] [--iterations <n>] [--interval-ms <ms>] [--chain-id <id>] [--include-events|--no-events] [--yes-pct <0-100>] [--alert-yes-below <0-100>] [--alert-yes-above <0-100>] [--alert-net-liquidity-below <amount>] [--alert-net-liquidity-above <amount>] [--fail-on-alert]

Notes:
  - At least one target is required: --wallet and/or --market-address.
  - watch is read-only; it never sends transactions.
  - Alert thresholds annotate snapshots with alert metadata.
  - --fail-on-alert exits non-zero when any alert condition is hit.
  - Each iteration returns timestamped snapshot data.
`);
}

function printMarketsHelpTable() {
  console.log(`
pandora markets - Query market entities

Usage:
  pandora [--output table|json] markets list [options]
  pandora [--output table|json] markets get [--id <id> ...] [--stdin]
`);
}

function printMarketsListHelpTable() {
  console.log(`
pandora markets list - List markets

Usage:
  pandora [--output table|json] markets list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>] [--where-json <json>] [--active|--resolved|--expiring-soon] [--expiring-hours <n>] [--expand] [--with-odds]

Notes:
  - Lifecycle filters are client-side post-filters on fetched results.
  - --expiring-hours applies only with --expiring-soon (default: 24).
`);
}

function printMarketsGetHelpTable() {
  console.log(`
pandora markets get - Get one or more markets by id

Usage:
  pandora [--output table|json] markets get --id <id>
  pandora [--output table|json] markets get --id <id> --id <id> ...
  pandora [--output table|json] markets get --stdin

Notes:
  - --stdin reads newline-delimited ids from standard input.
`);
}

function printPollsHelpTable() {
  console.log(`
pandora polls - Query poll entities

Usage:
  pandora [--output table|json] polls list [options]
  pandora [--output table|json] polls get --id <id>
`);
}

function printPollsListHelpTable() {
  console.log(`
pandora polls list - List polls

Usage:
  pandora [--output table|json] polls list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--status <int>] [--category <int>] [--question-contains <text>] [--where-json <json>]
`);
}

function printPollsGetHelpTable() {
  console.log(`
pandora polls get - Get a poll by id

Usage:
  pandora [--output table|json] polls get --id <id>
`);
}

function printEventsHelpTable() {
  console.log(`
pandora events - Query event entities

Usage:
  pandora [--output table|json] events list [options]
  pandora [--output table|json] events get --id <id> [--type all|liquidity|oracle-fee|claim]
`);
}

function printEventsListHelpTable() {
  console.log(`
pandora events list - List events

Usage:
  pandora [--output table|json] events list [--type all|liquidity|oracle-fee|claim] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-direction asc|desc] [--chain-id <id>] [--wallet <address>] [--market-address <address>] [--poll-address <address>] [--tx-hash <hash>]
`);
}

function printEventsGetHelpTable() {
  console.log(`
pandora events get - Get an event by id

Usage:
  pandora [--output table|json] events get --id <id> [--type all|liquidity|oracle-fee|claim]
`);
}

function printPositionsHelpTable() {
  console.log(`
pandora positions - Query wallet position entities

Usage:
  pandora [--output table|json] positions list [--wallet <address>] [--market-address <address>] [--chain-id <id>] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--where-json <json>]
`);
}

function commandHelpPayload(usage) {
  return { usage };
}

function quoteHelpJsonPayload() {
  return {
    usage:
      'pandora [--output table|json] quote [--indexer-url <url>] [--timeout-ms <ms>] --market-address <address> --side yes|no --amount-usdc <amount> [--yes-pct <0-100>] [--slippage-bps <0-10000>]',
  };
}

function tradeHelpJsonPayload() {
  return {
    usage:
      'pandora [--output table|json] trade [--indexer-url <url>] [--timeout-ms <ms>] [--dotenv-path <path>] [--skip-dotenv] --market-address <address> --side yes|no --amount-usdc <amount> --dry-run|--execute [--yes-pct <0-100>] [--slippage-bps <0-10000>] [--min-shares-out-raw <uint>] [--max-amount-usdc <amount>] [--min-probability-pct <0-100>] [--max-probability-pct <0-100>] [--allow-unquoted-execute] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>]',
  };
}

function watchHelpJsonPayload() {
  return {
    usage:
      'pandora [--output table|json] watch [--wallet <address>] [--market-address <address>] [--side yes|no] [--amount-usdc <amount>] [--iterations <n>] [--interval-ms <ms>] [--chain-id <id>] [--include-events|--no-events] [--yes-pct <0-100>] [--alert-yes-below <0-100>] [--alert-yes-above <0-100>] [--alert-net-liquidity-below <amount>] [--alert-net-liquidity-above <amount>] [--fail-on-alert]',
  };
}

function includesHelpFlag(args) {
  return Array.isArray(args) && (args.includes('--help') || args.includes('-h'));
}

function helpJsonPayload() {
  return {
    usage: [
      'pandora [--output table|json] help',
      'pandora [--output table|json] init-env ...',
      'pandora [--output table|json] doctor ...',
      'pandora [--output table|json] setup ...',
      'pandora [--output table|json] markets list|get ...',
      'pandora [--output table|json] polls list|get ...',
      'pandora [--output table|json] events list|get ...',
      'pandora [--output table|json] positions list ...',
      'pandora [--output table|json] portfolio ...',
      'pandora [--output table|json] watch ...',
      'pandora [--output table|json] scan ...',
      'pandora [--output table|json] quote ...',
      'pandora [--output table|json] trade ...',
      'pandora [--output table|json] history ...',
      'pandora [--output table|json] export ...',
      'pandora [--output table|json] arbitrage ...',
      'pandora [--output table|json] autopilot run|once ...',
      'pandora [--output table|json] mirror plan|deploy|verify|sync|status ...',
      'pandora [--output table|json] webhook test ...',
      'pandora [--output table|json] leaderboard ...',
      'pandora [--output table|json] analyze ...',
      'pandora [--output table|json] suggest ...',
      'pandora [--output table|json] resolve ...',
      'pandora [--output table|json] lp add|remove|positions ...',
      'pandora launch ...',
      'pandora clone-bet ...',
    ],
    globalFlags: {
      '--output': ['table', 'json'],
    },
  };
}

function normalizeOutputMode(raw) {
  if (!raw) return 'table';
  const mode = String(raw).trim().toLowerCase();
  if (!OUTPUT_MODES.has(mode)) {
    throw new CliError('INVALID_OUTPUT_MODE', `Invalid --output mode: "${raw}". Use table or json.`);
  }
  return mode;
}

function inferRequestedOutputMode(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--output' || token === '-o') {
      const next = argv[i + 1];
      if (String(next).trim().toLowerCase() === 'json') return 'json';
    }
    if (token.startsWith('--output=')) {
      if (token.slice('--output='.length).trim().toLowerCase() === 'json') return 'json';
    }
  }
  return 'table';
}

function extractOutputMode(argv) {
  let outputMode = 'table';
  const args = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--output' || token === '-o') {
      const next = argv[i + 1];
      if (!next) {
        throw new CliError('MISSING_FLAG_VALUE', `Missing value for ${token}`);
      }
      outputMode = normalizeOutputMode(next);
      i += 1;
      continue;
    }

    if (token.startsWith('--output=')) {
      outputMode = normalizeOutputMode(token.slice('--output='.length));
      continue;
    }

    args.push(token);
  }

  return { outputMode, args };
}

function emitJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function emitJsonError(payload) {
  console.error(JSON.stringify(payload, null, 2));
}

function toErrorEnvelope(error) {
  if (error instanceof CliError) {
    const envelope = {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
      },
    };
    if (error.details !== undefined) {
      envelope.error.details = error.details;
    }
    return envelope;
  }

  return {
    ok: false,
    error: {
      code: 'UNEXPECTED_ERROR',
      message: formatErrorValue(error && error.message ? error.message : error),
    },
  };
}

function formatErrorValue(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.message === 'string') return value.message;

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function emitFailure(outputMode, error) {
  const envelope = toErrorEnvelope(error);

  if (outputMode === 'json') {
    emitJsonError(envelope);
  } else {
    console.error(`[${envelope.error.code}] ${envelope.error.message}`);
    if (envelope.error.details && Array.isArray(envelope.error.details.errors) && envelope.error.details.errors.length) {
      for (const err of envelope.error.details.errors) {
        console.error(`- ${formatErrorValue(err)}`);
      }
    }
    if (envelope.error.details && Array.isArray(envelope.error.details.hints) && envelope.error.details.hints.length) {
      for (const hint of envelope.error.details.hints) {
        console.error(`Hint: ${hint}`);
      }
    }
    if (
      envelope.error.details &&
      !Array.isArray(envelope.error.details.errors) &&
      !Array.isArray(envelope.error.details.hints)
    ) {
      try {
        console.error(`Details: ${JSON.stringify(envelope.error.details)}`);
      } catch {
        console.error(`Details: ${String(envelope.error.details)}`);
      }
    }
  }

  process.exit(error instanceof CliError ? error.exitCode : 1);
}

function emitSuccess(outputMode, command, data, tableRenderer) {
  if (outputMode === 'json') {
    emitJson({ ok: true, command, data });
    return;
  }

  if (typeof tableRenderer === 'function') {
    tableRenderer(data);
    return;
  }

  console.log('Done.');
}

function parseDotEnv(content) {
  const env = {};
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isValidPrivateKey(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new CliError('ENV_FILE_NOT_FOUND', `Env file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = parseDotEnv(raw);
  for (const [key, value] of Object.entries(parsed)) {
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

function loadEnvIfPresent(filePath) {
  if (!fs.existsSync(filePath)) return false;
  loadEnvFile(filePath);
  return true;
}

function resolveTsxCliPath() {
  const tsxPackageJson = require.resolve('tsx/package.json', { paths: [ROOT] });
  return path.join(path.dirname(tsxPackageJson), 'dist', 'cli.mjs');
}

function runTargetScript(targetScript, passThroughArgs) {
  if (!fs.existsSync(targetScript)) {
    throw new CliError('TARGET_SCRIPT_MISSING', `Target script missing: ${targetScript}`);
  }

  const tsxCliPath = resolveTsxCliPath();
  const result = spawnSync(process.execPath, [tsxCliPath, targetScript, ...passThroughArgs], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    throw new CliError('SCRIPT_EXEC_ERROR', result.error.message);
  }

  process.exit(result.status === null ? 1 : result.status);
}

function parsePositiveInteger(value, flagName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a positive integer. Received: "${value}"`);
  }
  return parsed;
}

function parseInteger(value, flagName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be an integer. Received: "${value}"`);
  }
  return parsed;
}

function parseNonNegativeInteger(value, flagName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a non-negative integer. Received: "${value}"`);
  }
  return parsed;
}

function parsePositiveNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a positive number. Received: "${value}"`);
  }
  return parsed;
}

function parseNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a numeric value. Received: "${value}"`);
  }
  return parsed;
}

function parseCsvList(value, flagName) {
  const list = String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!list.length) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must include at least one comma-separated value.`);
  }
  return list;
}

function parseProbabilityPercent(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be between 0 and 100. Received: "${value}"`);
  }
  return parsed;
}

function parseBigIntString(value, flagName) {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) {
      throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a non-negative integer. Received: "${value}"`);
    }
    return parsed;
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a non-negative integer. Received: "${value}"`);
  }
}

function parseOutcomeSide(value, flagName = '--side') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(normalized)) return 'yes';
  if (['no', 'n', 'false', '0'].includes(normalized)) return 'no';
  throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be yes or no. Received: "${value}"`);
}

function parseAddressFlag(value, flagName) {
  if (!isValidAddress(value)) {
    throw new CliError(
      'INVALID_FLAG_VALUE',
      `${flagName} must be a valid 20-byte hex address (0x + 40 hex chars). Received: "${value}"`,
    );
  }
  return value.toLowerCase();
}

function parsePositionsOrderBy(value) {
  if (!POSITIONS_ORDER_BY_FIELD_SET.has(value)) {
    throw new CliError(
      'INVALID_FLAG_VALUE',
      `--order-by must be one of ${POSITIONS_ORDER_BY_FIELDS.join(', ')}. Received: "${value}"`,
    );
  }
  return value;
}

function requireFlagValue(args, index, flagName) {
  const next = args[index + 1];
  if (!next) {
    throw new CliError('MISSING_FLAG_VALUE', `Missing value for ${flagName}`);
  }
  return next;
}

function mergeWhere(where, jsonText, flagName) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new CliError('INVALID_JSON', `${flagName} must be valid JSON.`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError('INVALID_JSON', `${flagName} must decode to a JSON object.`);
  }

  return { ...where, ...parsed };
}

function normalizeDirection(raw) {
  const value = String(raw).trim().toLowerCase();
  if (value !== 'asc' && value !== 'desc') {
    throw new CliError('INVALID_FLAG_VALUE', `--order-direction must be asc or desc. Received: "${raw}"`);
  }
  return value;
}

function parseScriptEnvFlags(args) {
  let envFile = DEFAULT_ENV_FILE;
  let useEnvFile = true;
  const passthrough = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--dotenv-path' || token === '--env-file') {
      const next = requireFlagValue(args, i, '--dotenv-path');
      envFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }

    if (token === '--skip-dotenv' || token === '--no-env-file') {
      useEnvFile = false;
      continue;
    }

    passthrough.push(token);
  }

  return { envFile, useEnvFile, passthrough };
}

function parseDoctorFlags(args) {
  let envFile = DEFAULT_ENV_FILE;
  let useEnvFile = true;
  let checkUsdcCode = false;
  let rpcTimeoutMs = DEFAULT_RPC_TIMEOUT_MS;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--dotenv-path' || token === '--env-file') {
      const next = requireFlagValue(args, i, '--dotenv-path');
      envFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }

    if (token === '--skip-dotenv' || token === '--no-env-file') {
      useEnvFile = false;
      continue;
    }

    if (token === '--check-usdc-code') {
      checkUsdcCode = true;
      continue;
    }

    if (token === '--rpc-timeout-ms') {
      const next = requireFlagValue(args, i, '--rpc-timeout-ms');
      rpcTimeoutMs = parsePositiveInteger(next, '--rpc-timeout-ms');
      i += 1;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for doctor: ${token}`);
  }

  return { envFile, useEnvFile, checkUsdcCode, rpcTimeoutMs };
}

function parseSetupFlags(args) {
  let envFile = DEFAULT_ENV_FILE;
  let exampleFile = DEFAULT_ENV_EXAMPLE;
  let force = false;
  let checkUsdcCode = false;
  let rpcTimeoutMs = DEFAULT_RPC_TIMEOUT_MS;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--force') {
      force = true;
      continue;
    }

    if (token === '--dotenv-path' || token === '--env-file') {
      const next = requireFlagValue(args, i, '--dotenv-path');
      envFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }

    if (token === '--example') {
      const next = requireFlagValue(args, i, '--example');
      exampleFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }

    if (token === '--check-usdc-code') {
      checkUsdcCode = true;
      continue;
    }

    if (token === '--rpc-timeout-ms') {
      const next = requireFlagValue(args, i, '--rpc-timeout-ms');
      rpcTimeoutMs = parsePositiveInteger(next, '--rpc-timeout-ms');
      i += 1;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for setup: ${token}`);
  }

  return { envFile, exampleFile, force, checkUsdcCode, rpcTimeoutMs };
}

function parseInitEnvFlags(args) {
  let envFile = DEFAULT_ENV_FILE;
  let exampleFile = DEFAULT_ENV_EXAMPLE;
  let force = false;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--force') {
      force = true;
      continue;
    }

    if (token === '--dotenv-path' || token === '--env-file') {
      const next = requireFlagValue(args, i, '--dotenv-path');
      envFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }

    if (token === '--example') {
      const next = requireFlagValue(args, i, '--example');
      exampleFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for init-env: ${token}`);
  }

  return { envFile, exampleFile, force };
}

function parseIndexerSharedFlags(args) {
  let envFile = DEFAULT_ENV_FILE;
  let envFileExplicit = false;
  let useEnvFile = true;
  let indexerUrl = null;
  let timeoutMs = DEFAULT_INDEXER_TIMEOUT_MS;
  const rest = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--dotenv-path' || token === '--env-file') {
      const next = requireFlagValue(args, i, '--dotenv-path');
      envFile = path.resolve(process.cwd(), next);
      envFileExplicit = true;
      i += 1;
      continue;
    }

    if (token === '--skip-dotenv' || token === '--no-env-file') {
      useEnvFile = false;
      continue;
    }

    if (token === '--indexer-url') {
      const next = requireFlagValue(args, i, '--indexer-url');
      indexerUrl = next;
      i += 1;
      continue;
    }

    if (token === '--timeout-ms') {
      const next = requireFlagValue(args, i, '--timeout-ms');
      timeoutMs = parsePositiveInteger(next, '--timeout-ms');
      i += 1;
      continue;
    }

    rest.push(token);
  }

  return {
    envFile,
    envFileExplicit,
    useEnvFile,
    indexerUrl,
    timeoutMs,
    rest,
  };
}

function parseGetIdFlags(args, entityName) {
  let id = null;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--id') {
      const next = requireFlagValue(args, i, '--id');
      id = next;
      i += 1;
      continue;
    }

    if (token.startsWith('--')) {
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for ${entityName} get: ${token}`);
    }

    if (id) {
      throw new CliError('INVALID_ARGS', `Unexpected extra argument for ${entityName} get: ${token}`);
    }

    id = token;
  }

  if (!id) {
    throw new CliError('MISSING_REQUIRED_FLAG', `Missing ${entityName} id. Use --id <id>.`);
  }

  return { id };
}

function parseMarketsGetFlags(args) {
  const options = {
    ids: [],
    readFromStdin: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--id') {
      options.ids.push(requireFlagValue(args, i, '--id'));
      i += 1;
      continue;
    }

    if (token === '--stdin') {
      options.readFromStdin = true;
      continue;
    }

    if (token.startsWith('--')) {
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for markets get: ${token}`);
    }

    options.ids.push(token);
  }

  if (!options.ids.length && !options.readFromStdin) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing market id. Use --id <id> or --stdin.');
  }

  return options;
}

function readIdsFromStdin() {
  if (process.stdin.isTTY) {
    throw new CliError('MISSING_REQUIRED_FLAG', '--stdin requires piped newline-delimited ids.');
  }

  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (err) {
    throw new CliError('STDIN_READ_FAILED', `Unable to read ids from stdin: ${formatErrorValue(err)}`);
  }

  const ids = String(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!ids.length) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'No market ids were provided on stdin.');
  }

  return ids;
}

function setLifecycleFilter(current, next, flagName) {
  if (current === next || current === 'all') {
    return next;
  }
  throw new CliError(
    'INVALID_ARGS',
    `Lifecycle filters are mutually exclusive. Received ${flagName} with existing --${current}.`,
  );
}

function parseMarketsListFlags(args) {
  const options = {
    where: {},
    limit: 20,
    after: null,
    before: null,
    orderBy: 'createdAt',
    orderDirection: 'desc',
    lifecycle: 'all',
    expiringSoonHours: DEFAULT_EXPIRING_SOON_HOURS,
    expand: false,
    withOdds: false,
  };
  let expiringSoonHoursExplicit = false;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--limit') {
      options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
      i += 1;
      continue;
    }

    if (token === '--after') {
      options.after = requireFlagValue(args, i, '--after');
      i += 1;
      continue;
    }

    if (token === '--before') {
      options.before = requireFlagValue(args, i, '--before');
      i += 1;
      continue;
    }

    if (token === '--order-by') {
      options.orderBy = requireFlagValue(args, i, '--order-by');
      i += 1;
      continue;
    }

    if (token === '--order-direction') {
      options.orderDirection = normalizeDirection(requireFlagValue(args, i, '--order-direction'));
      i += 1;
      continue;
    }

    if (token === '--chain-id') {
      options.where.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
      i += 1;
      continue;
    }

    if (token === '--creator') {
      options.where.creator = parseAddressFlag(requireFlagValue(args, i, '--creator'), '--creator');
      i += 1;
      continue;
    }

    if (token === '--poll-address') {
      options.where.pollAddress = parseAddressFlag(requireFlagValue(args, i, '--poll-address'), '--poll-address');
      i += 1;
      continue;
    }

    if (token === '--market-type') {
      options.where.marketType = requireFlagValue(args, i, '--market-type');
      i += 1;
      continue;
    }

    if (token === '--where-json') {
      options.where = mergeWhere(options.where, requireFlagValue(args, i, '--where-json'), '--where-json');
      i += 1;
      continue;
    }

    if (token === '--active') {
      options.lifecycle = setLifecycleFilter(options.lifecycle, 'active', '--active');
      continue;
    }

    if (token === '--resolved') {
      options.lifecycle = setLifecycleFilter(options.lifecycle, 'resolved', '--resolved');
      continue;
    }

    if (token === '--expiring-soon') {
      options.lifecycle = setLifecycleFilter(options.lifecycle, 'expiring-soon', '--expiring-soon');
      continue;
    }

    if (token === '--expiring-hours') {
      options.expiringSoonHours = parsePositiveInteger(requireFlagValue(args, i, '--expiring-hours'), '--expiring-hours');
      expiringSoonHoursExplicit = true;
      i += 1;
      continue;
    }

    if (token === '--expand') {
      options.expand = true;
      continue;
    }

    if (token === '--with-odds') {
      options.withOdds = true;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for markets list: ${token}`);
  }

  if (expiringSoonHoursExplicit && options.lifecycle !== 'expiring-soon') {
    throw new CliError('INVALID_ARGS', '--expiring-hours requires --expiring-soon.');
  }

  return options;
}

function parseQuoteFlags(args) {
  const options = {
    marketAddress: null,
    side: null,
    amountUsdc: null,
    yesPct: null,
    slippageBps: 100,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--market-address') {
      options.marketAddress = parseAddressFlag(requireFlagValue(args, i, '--market-address'), '--market-address');
      i += 1;
      continue;
    }

    if (token === '--side') {
      options.side = parseOutcomeSide(requireFlagValue(args, i, '--side'), '--side');
      i += 1;
      continue;
    }

    if (token === '--amount-usdc' || token === '--amount') {
      options.amountUsdc = parsePositiveNumber(requireFlagValue(args, i, token), token);
      i += 1;
      continue;
    }

    if (token === '--yes-pct') {
      options.yesPct = parseProbabilityPercent(requireFlagValue(args, i, '--yes-pct'), '--yes-pct');
      i += 1;
      continue;
    }

    if (token === '--slippage-bps') {
      options.slippageBps = parseNonNegativeInteger(requireFlagValue(args, i, '--slippage-bps'), '--slippage-bps');
      if (options.slippageBps > 10_000) {
        throw new CliError('INVALID_FLAG_VALUE', '--slippage-bps must be between 0 and 10000.');
      }
      i += 1;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for quote: ${token}`);
  }

  if (!options.marketAddress) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing market address. Use --market-address <address>.');
  }
  if (!options.side) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing side. Use --side yes|no.');
  }
  if (options.amountUsdc === null) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing trade amount. Use --amount-usdc <amount>.');
  }

  return options;
}

function parseTradeFlags(args) {
  const options = {
    marketAddress: null,
    side: null,
    amountUsdc: null,
    yesPct: null,
    slippageBps: 100,
    dryRun: false,
    execute: false,
    minSharesOutRaw: null,
    maxAmountUsdc: null,
    minProbabilityPct: null,
    maxProbabilityPct: null,
    allowUnquotedExecute: false,
    chainId: null,
    rpcUrl: null,
    privateKey: null,
    usdc: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--market-address') {
      options.marketAddress = parseAddressFlag(requireFlagValue(args, i, '--market-address'), '--market-address');
      i += 1;
      continue;
    }

    if (token === '--side') {
      options.side = parseOutcomeSide(requireFlagValue(args, i, '--side'), '--side');
      i += 1;
      continue;
    }

    if (token === '--amount-usdc' || token === '--amount') {
      options.amountUsdc = parsePositiveNumber(requireFlagValue(args, i, token), token);
      i += 1;
      continue;
    }

    if (token === '--yes-pct') {
      options.yesPct = parseProbabilityPercent(requireFlagValue(args, i, '--yes-pct'), '--yes-pct');
      i += 1;
      continue;
    }

    if (token === '--slippage-bps') {
      options.slippageBps = parseNonNegativeInteger(requireFlagValue(args, i, '--slippage-bps'), '--slippage-bps');
      if (options.slippageBps > 10_000) {
        throw new CliError('INVALID_FLAG_VALUE', '--slippage-bps must be between 0 and 10000.');
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

    if (token === '--min-shares-out-raw') {
      options.minSharesOutRaw = parseBigIntString(requireFlagValue(args, i, '--min-shares-out-raw'), '--min-shares-out-raw');
      i += 1;
      continue;
    }

    if (token === '--max-amount-usdc') {
      options.maxAmountUsdc = parsePositiveNumber(requireFlagValue(args, i, '--max-amount-usdc'), '--max-amount-usdc');
      i += 1;
      continue;
    }

    if (token === '--min-probability-pct') {
      options.minProbabilityPct = parseProbabilityPercent(
        requireFlagValue(args, i, '--min-probability-pct'),
        '--min-probability-pct',
      );
      i += 1;
      continue;
    }

    if (token === '--max-probability-pct') {
      options.maxProbabilityPct = parseProbabilityPercent(
        requireFlagValue(args, i, '--max-probability-pct'),
        '--max-probability-pct',
      );
      i += 1;
      continue;
    }

    if (token === '--allow-unquoted-execute') {
      options.allowUnquotedExecute = true;
      continue;
    }

    if (token === '--chain-id') {
      options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
      i += 1;
      continue;
    }

    if (token === '--rpc-url') {
      options.rpcUrl = requireFlagValue(args, i, '--rpc-url');
      i += 1;
      continue;
    }

    if (token === '--private-key') {
      options.privateKey = requireFlagValue(args, i, '--private-key');
      i += 1;
      continue;
    }

    if (token === '--usdc') {
      options.usdc = parseAddressFlag(requireFlagValue(args, i, '--usdc'), '--usdc');
      i += 1;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for trade: ${token}`);
  }

  if (!options.marketAddress) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing market address. Use --market-address <address>.');
  }
  if (!options.side) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing side. Use --side yes|no.');
  }
  if (options.amountUsdc === null) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing trade amount. Use --amount-usdc <amount>.');
  }
  if (options.dryRun === options.execute) {
    throw new CliError('INVALID_ARGS', 'Use exactly one mode: --dry-run or --execute.');
  }
  if (
    options.minProbabilityPct !== null &&
    options.maxProbabilityPct !== null &&
    options.minProbabilityPct > options.maxProbabilityPct
  ) {
    throw new CliError('INVALID_ARGS', '--min-probability-pct cannot be greater than --max-probability-pct.');
  }

  return options;
}

function parsePollsListFlags(args) {
  const options = {
    where: {},
    limit: 20,
    after: null,
    before: null,
    orderBy: 'createdAt',
    orderDirection: 'desc',
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--limit') {
      options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
      i += 1;
      continue;
    }

    if (token === '--after') {
      options.after = requireFlagValue(args, i, '--after');
      i += 1;
      continue;
    }

    if (token === '--before') {
      options.before = requireFlagValue(args, i, '--before');
      i += 1;
      continue;
    }

    if (token === '--order-by') {
      options.orderBy = requireFlagValue(args, i, '--order-by');
      i += 1;
      continue;
    }

    if (token === '--order-direction') {
      options.orderDirection = normalizeDirection(requireFlagValue(args, i, '--order-direction'));
      i += 1;
      continue;
    }

    if (token === '--chain-id') {
      options.where.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
      i += 1;
      continue;
    }

    if (token === '--creator') {
      options.where.creator = parseAddressFlag(requireFlagValue(args, i, '--creator'), '--creator');
      i += 1;
      continue;
    }

    if (token === '--status') {
      options.where.status = parseInteger(requireFlagValue(args, i, '--status'), '--status');
      i += 1;
      continue;
    }

    if (token === '--category') {
      options.where.category = parseInteger(requireFlagValue(args, i, '--category'), '--category');
      i += 1;
      continue;
    }

    if (token === '--question-contains') {
      options.where.question_contains = requireFlagValue(args, i, '--question-contains');
      i += 1;
      continue;
    }

    if (token === '--where-json') {
      options.where = mergeWhere(options.where, requireFlagValue(args, i, '--where-json'), '--where-json');
      i += 1;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for polls list: ${token}`);
  }

  return options;
}

function parsePositionsListFlags(args) {
  const options = {
    where: {},
    wallet: null,
    limit: 20,
    after: null,
    before: null,
    orderBy: 'lastTradeAt',
    orderDirection: 'desc',
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--limit') {
      options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
      i += 1;
      continue;
    }

    if (token === '--after') {
      options.after = requireFlagValue(args, i, '--after');
      i += 1;
      continue;
    }

    if (token === '--before') {
      options.before = requireFlagValue(args, i, '--before');
      i += 1;
      continue;
    }

    if (token === '--order-by') {
      options.orderBy = parsePositionsOrderBy(requireFlagValue(args, i, '--order-by'));
      i += 1;
      continue;
    }

    if (token === '--order-direction') {
      options.orderDirection = normalizeDirection(requireFlagValue(args, i, '--order-direction'));
      i += 1;
      continue;
    }

    if (token === '--wallet') {
      options.wallet = parseAddressFlag(requireFlagValue(args, i, '--wallet'), '--wallet');
      options.where.user = options.wallet;
      i += 1;
      continue;
    }

    if (token === '--market-address') {
      options.where.marketAddress = parseAddressFlag(requireFlagValue(args, i, '--market-address'), '--market-address');
      i += 1;
      continue;
    }

    if (token === '--chain-id') {
      options.where.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
      i += 1;
      continue;
    }

    if (token === '--where-json') {
      options.where = mergeWhere(options.where, requireFlagValue(args, i, '--where-json'), '--where-json');
      i += 1;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for positions list: ${token}`);
  }

  return options;
}

function parsePortfolioFlags(args) {
  const options = {
    wallet: null,
    chainId: null,
    limit: 100,
    includeEvents: true,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--wallet') {
      options.wallet = parseAddressFlag(requireFlagValue(args, i, '--wallet'), '--wallet');
      i += 1;
      continue;
    }

    if (token === '--chain-id') {
      options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
      i += 1;
      continue;
    }

    if (token === '--limit') {
      options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
      i += 1;
      continue;
    }

    if (token === '--include-events') {
      options.includeEvents = true;
      continue;
    }

    if (token === '--no-events') {
      options.includeEvents = false;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for portfolio: ${token}`);
  }

  if (!options.wallet) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing wallet address. Use --wallet <address>.');
  }

  return options;
}

function parseWebhookFlagIntoOptions(args, i, token, options) {
  if (token === '--webhook-url') {
    options.webhookUrl = requireFlagValue(args, i, '--webhook-url');
    return 1;
  }
  if (token === '--webhook-template') {
    options.webhookTemplate = requireFlagValue(args, i, '--webhook-template');
    return 1;
  }
  if (token === '--webhook-secret') {
    options.webhookSecret = requireFlagValue(args, i, '--webhook-secret');
    return 1;
  }
  if (token === '--webhook-timeout-ms') {
    options.webhookTimeoutMs = parsePositiveInteger(
      requireFlagValue(args, i, '--webhook-timeout-ms'),
      '--webhook-timeout-ms',
    );
    return 1;
  }
  if (token === '--webhook-retries') {
    options.webhookRetries = parseNonNegativeInteger(
      requireFlagValue(args, i, '--webhook-retries'),
      '--webhook-retries',
    );
    return 1;
  }
  if (token === '--telegram-bot-token') {
    options.telegramBotToken = requireFlagValue(args, i, '--telegram-bot-token');
    return 1;
  }
  if (token === '--telegram-chat-id') {
    options.telegramChatId = requireFlagValue(args, i, '--telegram-chat-id');
    return 1;
  }
  if (token === '--discord-webhook-url') {
    options.discordWebhookUrl = requireFlagValue(args, i, '--discord-webhook-url');
    return 1;
  }
  if (token === '--fail-on-webhook-error') {
    options.failOnWebhookError = true;
    return 0;
  }

  return null;
}

function parseWatchFlags(args) {
  const options = {
    wallet: null,
    marketAddress: null,
    side: 'yes',
    amountUsdc: 1,
    yesPct: null,
    slippageBps: 100,
    chainId: null,
    limit: 100,
    includeEvents: true,
    iterations: 5,
    intervalMs: 2_000,
    alertYesBelow: null,
    alertYesAbove: null,
    alertNetLiquidityBelow: null,
    alertNetLiquidityAbove: null,
    failOnAlert: false,
    webhookUrl: null,
    webhookTemplate: null,
    webhookSecret: null,
    webhookTimeoutMs: 5_000,
    webhookRetries: 3,
    telegramBotToken: null,
    telegramChatId: null,
    discordWebhookUrl: null,
    failOnWebhookError: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--wallet') {
      options.wallet = parseAddressFlag(requireFlagValue(args, i, '--wallet'), '--wallet');
      i += 1;
      continue;
    }

    if (token === '--market-address') {
      options.marketAddress = parseAddressFlag(requireFlagValue(args, i, '--market-address'), '--market-address');
      i += 1;
      continue;
    }

    if (token === '--side') {
      options.side = parseOutcomeSide(requireFlagValue(args, i, '--side'), '--side');
      i += 1;
      continue;
    }

    if (token === '--amount-usdc' || token === '--amount') {
      options.amountUsdc = parsePositiveNumber(requireFlagValue(args, i, token), token);
      i += 1;
      continue;
    }

    if (token === '--yes-pct') {
      options.yesPct = parseProbabilityPercent(requireFlagValue(args, i, '--yes-pct'), '--yes-pct');
      i += 1;
      continue;
    }

    if (token === '--slippage-bps') {
      options.slippageBps = parseNonNegativeInteger(requireFlagValue(args, i, '--slippage-bps'), '--slippage-bps');
      if (options.slippageBps > 10_000) {
        throw new CliError('INVALID_FLAG_VALUE', '--slippage-bps must be between 0 and 10000.');
      }
      i += 1;
      continue;
    }

    if (token === '--chain-id') {
      options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
      i += 1;
      continue;
    }

    if (token === '--limit') {
      options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
      i += 1;
      continue;
    }

    if (token === '--include-events') {
      options.includeEvents = true;
      continue;
    }

    if (token === '--no-events') {
      options.includeEvents = false;
      continue;
    }

    if (token === '--iterations') {
      options.iterations = parsePositiveInteger(requireFlagValue(args, i, '--iterations'), '--iterations');
      i += 1;
      continue;
    }

    if (token === '--interval-ms') {
      options.intervalMs = parseNonNegativeInteger(requireFlagValue(args, i, '--interval-ms'), '--interval-ms');
      i += 1;
      continue;
    }

    if (token === '--alert-yes-below') {
      options.alertYesBelow = parseProbabilityPercent(requireFlagValue(args, i, '--alert-yes-below'), '--alert-yes-below');
      i += 1;
      continue;
    }

    if (token === '--alert-yes-above') {
      options.alertYesAbove = parseProbabilityPercent(requireFlagValue(args, i, '--alert-yes-above'), '--alert-yes-above');
      i += 1;
      continue;
    }

    if (token === '--alert-net-liquidity-below') {
      options.alertNetLiquidityBelow = parseNumber(
        requireFlagValue(args, i, '--alert-net-liquidity-below'),
        '--alert-net-liquidity-below',
      );
      i += 1;
      continue;
    }

    if (token === '--alert-net-liquidity-above') {
      options.alertNetLiquidityAbove = parseNumber(
        requireFlagValue(args, i, '--alert-net-liquidity-above'),
        '--alert-net-liquidity-above',
      );
      i += 1;
      continue;
    }

    if (token === '--fail-on-alert') {
      options.failOnAlert = true;
      continue;
    }

    const webhookStep = parseWebhookFlagIntoOptions(args, i, token, options);
    if (webhookStep !== null) {
      i += webhookStep;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for watch: ${token}`);
  }

  if (!options.wallet && !options.marketAddress) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'watch requires at least one target: --wallet and/or --market-address.');
  }
  if ((options.alertYesBelow !== null || options.alertYesAbove !== null) && !options.marketAddress) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'YES-odds alerts require --market-address.');
  }
  if ((options.alertNetLiquidityBelow !== null || options.alertNetLiquidityAbove !== null) && !options.wallet) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Net-liquidity alerts require --wallet.');
  }
  if (
    options.alertYesBelow !== null &&
    options.alertYesAbove !== null &&
    options.alertYesBelow > options.alertYesAbove
  ) {
    throw new CliError('INVALID_ARGS', '--alert-yes-below cannot be greater than --alert-yes-above.');
  }
  if (
    options.alertNetLiquidityBelow !== null &&
    options.alertNetLiquidityAbove !== null &&
    options.alertNetLiquidityBelow > options.alertNetLiquidityAbove
  ) {
    throw new CliError('INVALID_ARGS', '--alert-net-liquidity-below cannot be greater than --alert-net-liquidity-above.');
  }
  if ((options.telegramBotToken && !options.telegramChatId) || (!options.telegramBotToken && options.telegramChatId)) {
    throw new CliError(
      'INVALID_ARGS',
      'Telegram webhook requires both --telegram-bot-token and --telegram-chat-id.',
    );
  }

  return options;
}

function parseEventsListFlags(args) {
  const options = {
    type: 'all',
    limit: 20,
    after: null,
    before: null,
    orderDirection: 'desc',
    chainId: null,
    wallet: null,
    marketAddress: null,
    pollAddress: null,
    txHash: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--type') {
      const value = requireFlagValue(args, i, '--type').toLowerCase();
      if (value !== 'all' && value !== 'liquidity' && value !== 'oracle-fee' && value !== 'claim') {
        throw new CliError('INVALID_FLAG_VALUE', `--type must be one of all|liquidity|oracle-fee|claim. Received: "${value}"`);
      }
      options.type = value;
      i += 1;
      continue;
    }

    if (token === '--limit') {
      options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
      i += 1;
      continue;
    }

    if (token === '--after') {
      options.after = requireFlagValue(args, i, '--after');
      i += 1;
      continue;
    }

    if (token === '--before') {
      options.before = requireFlagValue(args, i, '--before');
      i += 1;
      continue;
    }

    if (token === '--order-direction') {
      options.orderDirection = normalizeDirection(requireFlagValue(args, i, '--order-direction'));
      i += 1;
      continue;
    }

    if (token === '--chain-id') {
      options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
      i += 1;
      continue;
    }

    if (token === '--wallet') {
      options.wallet = parseAddressFlag(requireFlagValue(args, i, '--wallet'), '--wallet');
      i += 1;
      continue;
    }

    if (token === '--market-address') {
      options.marketAddress = parseAddressFlag(requireFlagValue(args, i, '--market-address'), '--market-address');
      i += 1;
      continue;
    }

    if (token === '--poll-address') {
      options.pollAddress = parseAddressFlag(requireFlagValue(args, i, '--poll-address'), '--poll-address');
      i += 1;
      continue;
    }

    if (token === '--tx-hash') {
      options.txHash = requireFlagValue(args, i, '--tx-hash').toLowerCase();
      i += 1;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for events list: ${token}`);
  }

  return options;
}

function parseEventsGetFlags(args) {
  const options = { id: null, type: 'all' };
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--id') {
      options.id = requireFlagValue(args, i, '--id');
      i += 1;
      continue;
    }

    if (token === '--type') {
      const value = requireFlagValue(args, i, '--type').toLowerCase();
      if (value !== 'all' && value !== 'liquidity' && value !== 'oracle-fee' && value !== 'claim') {
        throw new CliError('INVALID_FLAG_VALUE', `--type must be one of all|liquidity|oracle-fee|claim. Received: "${value}"`);
      }
      options.type = value;
      i += 1;
      continue;
    }

    if (token.startsWith('--')) {
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for events get: ${token}`);
    }

    if (options.id) {
      throw new CliError('INVALID_ARGS', `Unexpected extra argument for events get: ${token}`);
    }

    options.id = token;
  }

  if (!options.id) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing event id. Use --id <id>.');
  }

  return options;
}

function parseHistoryFlags(args) {
  const options = {
    wallet: null,
    chainId: null,
    marketAddress: null,
    side: 'both',
    status: 'all',
    limit: 50,
    after: null,
    before: null,
    orderBy: 'timestamp',
    orderDirection: 'desc',
    includeSeed: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--wallet') {
      options.wallet = parseAddressFlag(requireFlagValue(args, i, '--wallet'), '--wallet');
      i += 1;
      continue;
    }
    if (token === '--chain-id') {
      options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
      i += 1;
      continue;
    }
    if (token === '--market-address') {
      options.marketAddress = parseAddressFlag(requireFlagValue(args, i, '--market-address'), '--market-address');
      i += 1;
      continue;
    }
    if (token === '--side') {
      const side = requireFlagValue(args, i, '--side').toLowerCase();
      if (side !== 'yes' && side !== 'no' && side !== 'both') {
        throw new CliError('INVALID_FLAG_VALUE', '--side must be yes|no|both.');
      }
      options.side = side;
      i += 1;
      continue;
    }
    if (token === '--status') {
      const status = requireFlagValue(args, i, '--status').toLowerCase();
      if (!['all', 'open', 'won', 'lost', 'closed'].includes(status)) {
        throw new CliError('INVALID_FLAG_VALUE', '--status must be all|open|won|lost|closed.');
      }
      options.status = status;
      i += 1;
      continue;
    }
    if (token === '--limit') {
      options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
      i += 1;
      continue;
    }
    if (token === '--after') {
      options.after = requireFlagValue(args, i, '--after');
      i += 1;
      continue;
    }
    if (token === '--before') {
      options.before = requireFlagValue(args, i, '--before');
      i += 1;
      continue;
    }
    if (token === '--order-by') {
      const orderBy = requireFlagValue(args, i, '--order-by').toLowerCase();
      if (!['timestamp', 'pnl', 'entry-price', 'mark-price'].includes(orderBy)) {
        throw new CliError('INVALID_FLAG_VALUE', '--order-by must be timestamp|pnl|entry-price|mark-price.');
      }
      options.orderBy = orderBy;
      i += 1;
      continue;
    }
    if (token === '--order-direction') {
      options.orderDirection = normalizeDirection(requireFlagValue(args, i, '--order-direction'));
      i += 1;
      continue;
    }
    if (token === '--include-seed') {
      options.includeSeed = true;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for history: ${token}`);
  }

  if (!options.wallet) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing wallet address. Use --wallet <address>.');
  }

  return options;
}

function parseExportFlags(args) {
  const options = {
    wallet: null,
    chainId: null,
    format: null,
    year: null,
    from: null,
    to: null,
    outPath: null,
    limit: 1000,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--wallet') {
      options.wallet = parseAddressFlag(requireFlagValue(args, i, '--wallet'), '--wallet');
      i += 1;
      continue;
    }
    if (token === '--chain-id') {
      options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
      i += 1;
      continue;
    }
    if (token === '--format') {
      const format = requireFlagValue(args, i, '--format').toLowerCase();
      if (format !== 'csv' && format !== 'json') {
        throw new CliError('INVALID_FLAG_VALUE', '--format must be csv|json.');
      }
      options.format = format;
      i += 1;
      continue;
    }
    if (token === '--year') {
      const year = parseInteger(requireFlagValue(args, i, '--year'), '--year');
      if (year < 1970 || year > 3000) {
        throw new CliError('INVALID_FLAG_VALUE', '--year must be between 1970 and 3000.');
      }
      options.year = year;
      i += 1;
      continue;
    }
    if (token === '--from') {
      options.from = parseInteger(requireFlagValue(args, i, '--from'), '--from');
      i += 1;
      continue;
    }
    if (token === '--to') {
      options.to = parseInteger(requireFlagValue(args, i, '--to'), '--to');
      i += 1;
      continue;
    }
    if (token === '--out') {
      options.outPath = requireFlagValue(args, i, '--out');
      i += 1;
      continue;
    }
    if (token === '--limit') {
      options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
      i += 1;
      continue;
    }
    throw new CliError('UNKNOWN_FLAG', `Unknown flag for export: ${token}`);
  }

  if (!options.wallet) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing wallet address. Use --wallet <address>.');
  }
  if (!options.format) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing export format. Use --format csv|json.');
  }
  if (options.from !== null && options.to !== null && options.from > options.to) {
    throw new CliError('INVALID_ARGS', '--from cannot be greater than --to.');
  }

  return options;
}

function parseArbitrageFlags(args) {
  const options = {
    chainId: null,
    venues: ['pandora', 'polymarket'],
    limit: 20,
    minSpreadPct: 3,
    minLiquidityUsd: 1000,
    maxCloseDiffHours: 24,
    similarityThreshold: 0.86,
    crossVenueOnly: true,
    withRules: false,
    includeSimilarity: false,
    questionContains: null,
    polymarketHost: null,
    polymarketMockUrl: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--chain-id') {
      options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
      i += 1;
      continue;
    }
    if (token === '--venues') {
      const venues = parseCsvList(requireFlagValue(args, i, '--venues'), '--venues').map((value) => value.toLowerCase());
      const allowed = new Set(['pandora', 'polymarket']);
      for (const venue of venues) {
        if (!allowed.has(venue)) {
          throw new CliError('INVALID_FLAG_VALUE', `Unsupported venue in --venues: ${venue}`);
        }
      }
      options.venues = venues;
      i += 1;
      continue;
    }
    if (token === '--limit') {
      options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
      i += 1;
      continue;
    }
    if (token === '--min-spread-pct') {
      options.minSpreadPct = parsePositiveNumber(requireFlagValue(args, i, '--min-spread-pct'), '--min-spread-pct');
      i += 1;
      continue;
    }
    if (token === '--min-liquidity-usdc') {
      options.minLiquidityUsd = parsePositiveNumber(requireFlagValue(args, i, '--min-liquidity-usdc'), '--min-liquidity-usdc');
      i += 1;
      continue;
    }
    if (token === '--max-close-diff-hours') {
      options.maxCloseDiffHours = parsePositiveNumber(
        requireFlagValue(args, i, '--max-close-diff-hours'),
        '--max-close-diff-hours',
      );
      i += 1;
      continue;
    }
    if (token === '--similarity-threshold') {
      options.similarityThreshold = parseNumber(
        requireFlagValue(args, i, '--similarity-threshold'),
        '--similarity-threshold',
      );
      if (options.similarityThreshold < 0 || options.similarityThreshold > 1) {
        throw new CliError('INVALID_FLAG_VALUE', '--similarity-threshold must be between 0 and 1.');
      }
      i += 1;
      continue;
    }
    if (token === '--cross-venue-only') {
      options.crossVenueOnly = true;
      continue;
    }
    if (token === '--allow-same-venue') {
      options.crossVenueOnly = false;
      continue;
    }
    if (token === '--with-rules') {
      options.withRules = true;
      continue;
    }
    if (token === '--include-similarity') {
      options.includeSimilarity = true;
      continue;
    }
    if (token === '--question-contains') {
      options.questionContains = requireFlagValue(args, i, '--question-contains');
      i += 1;
      continue;
    }
    if (token === '--polymarket-host') {
      options.polymarketHost = requireFlagValue(args, i, '--polymarket-host');
      i += 1;
      continue;
    }
    if (token === '--polymarket-mock-url') {
      options.polymarketMockUrl = requireFlagValue(args, i, '--polymarket-mock-url');
      i += 1;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for arbitrage: ${token}`);
  }

  return options;
}

function parseAutopilotFlags(args) {
  const mode = args[0];
  if (mode !== 'run' && mode !== 'once') {
    throw new CliError('INVALID_ARGS', 'autopilot requires subcommand run|once.');
  }

  const rest = args.slice(1);
  const options = {
    mode,
    marketAddress: null,
    side: null,
    amountUsdc: null,
    triggerYesBelow: null,
    triggerYesAbove: null,
    yesPct: null,
    slippageBps: 100,
    executeLive: false,
    intervalMs: 5_000,
    cooldownMs: 60_000,
    maxAmountUsdc: null,
    maxOpenExposureUsdc: null,
    maxTradesPerDay: null,
    minProbabilityPct: null,
    maxProbabilityPct: null,
    iterations: null,
    stateFile: null,
    killSwitchFile: null,
    webhookUrl: null,
    webhookTemplate: null,
    webhookSecret: null,
    webhookTimeoutMs: 5_000,
    webhookRetries: 3,
    telegramBotToken: null,
    telegramChatId: null,
    discordWebhookUrl: null,
    failOnWebhookError: false,
  };

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--market-address') {
      options.marketAddress = parseAddressFlag(requireFlagValue(rest, i, '--market-address'), '--market-address');
      i += 1;
      continue;
    }
    if (token === '--side') {
      options.side = parseOutcomeSide(requireFlagValue(rest, i, '--side'), '--side');
      i += 1;
      continue;
    }
    if (token === '--amount-usdc' || token === '--amount') {
      options.amountUsdc = parsePositiveNumber(requireFlagValue(rest, i, token), token);
      i += 1;
      continue;
    }
    if (token === '--trigger-yes-below') {
      options.triggerYesBelow = parseProbabilityPercent(requireFlagValue(rest, i, '--trigger-yes-below'), '--trigger-yes-below');
      i += 1;
      continue;
    }
    if (token === '--trigger-yes-above') {
      options.triggerYesAbove = parseProbabilityPercent(requireFlagValue(rest, i, '--trigger-yes-above'), '--trigger-yes-above');
      i += 1;
      continue;
    }
    if (token === '--paper') {
      options.executeLive = false;
      continue;
    }
    if (token === '--execute-live') {
      options.executeLive = true;
      continue;
    }
    if (token === '--interval-ms') {
      options.intervalMs = parsePositiveInteger(requireFlagValue(rest, i, '--interval-ms'), '--interval-ms');
      if (options.intervalMs < 1_000) {
        throw new CliError('INVALID_FLAG_VALUE', '--interval-ms must be >= 1000.');
      }
      i += 1;
      continue;
    }
    if (token === '--cooldown-ms') {
      options.cooldownMs = parsePositiveInteger(requireFlagValue(rest, i, '--cooldown-ms'), '--cooldown-ms');
      i += 1;
      continue;
    }
    if (token === '--max-amount-usdc') {
      options.maxAmountUsdc = parsePositiveNumber(requireFlagValue(rest, i, '--max-amount-usdc'), '--max-amount-usdc');
      i += 1;
      continue;
    }
    if (token === '--max-open-exposure-usdc') {
      options.maxOpenExposureUsdc = parsePositiveNumber(
        requireFlagValue(rest, i, '--max-open-exposure-usdc'),
        '--max-open-exposure-usdc',
      );
      i += 1;
      continue;
    }
    if (token === '--max-trades-per-day') {
      options.maxTradesPerDay = parsePositiveInteger(
        requireFlagValue(rest, i, '--max-trades-per-day'),
        '--max-trades-per-day',
      );
      i += 1;
      continue;
    }
    if (token === '--min-probability-pct') {
      options.minProbabilityPct = parseProbabilityPercent(
        requireFlagValue(rest, i, '--min-probability-pct'),
        '--min-probability-pct',
      );
      i += 1;
      continue;
    }
    if (token === '--max-probability-pct') {
      options.maxProbabilityPct = parseProbabilityPercent(
        requireFlagValue(rest, i, '--max-probability-pct'),
        '--max-probability-pct',
      );
      i += 1;
      continue;
    }
    if (token === '--yes-pct') {
      options.yesPct = parseProbabilityPercent(requireFlagValue(rest, i, '--yes-pct'), '--yes-pct');
      i += 1;
      continue;
    }
    if (token === '--slippage-bps') {
      options.slippageBps = parseNonNegativeInteger(requireFlagValue(rest, i, '--slippage-bps'), '--slippage-bps');
      if (options.slippageBps > 10_000) {
        throw new CliError('INVALID_FLAG_VALUE', '--slippage-bps must be between 0 and 10000.');
      }
      i += 1;
      continue;
    }
    if (token === '--iterations') {
      options.iterations = parsePositiveInteger(requireFlagValue(rest, i, '--iterations'), '--iterations');
      i += 1;
      continue;
    }
    if (token === '--state-file') {
      options.stateFile = requireFlagValue(rest, i, '--state-file');
      i += 1;
      continue;
    }
    if (token === '--kill-switch-file') {
      options.killSwitchFile = requireFlagValue(rest, i, '--kill-switch-file');
      i += 1;
      continue;
    }

    const webhookStep = parseWebhookFlagIntoOptions(rest, i, token, options);
    if (webhookStep !== null) {
      i += webhookStep;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for autopilot: ${token}`);
  }

  if (!options.marketAddress) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing market address. Use --market-address <address>.');
  }
  if (!options.side) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing side. Use --side yes|no.');
  }
  if (options.amountUsdc === null) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing amount. Use --amount-usdc <amount>.');
  }
  if (options.triggerYesBelow === null && options.triggerYesAbove === null) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'At least one trigger is required: --trigger-yes-below and/or --trigger-yes-above.');
  }
  if (
    options.triggerYesBelow !== null &&
    options.triggerYesAbove !== null &&
    options.triggerYesBelow > options.triggerYesAbove
  ) {
    throw new CliError('INVALID_ARGS', '--trigger-yes-below cannot be greater than --trigger-yes-above.');
  }
  if (
    options.minProbabilityPct !== null &&
    options.maxProbabilityPct !== null &&
    options.minProbabilityPct > options.maxProbabilityPct
  ) {
    throw new CliError('INVALID_ARGS', '--min-probability-pct cannot be greater than --max-probability-pct.');
  }
  if ((options.telegramBotToken && !options.telegramChatId) || (!options.telegramBotToken && options.telegramChatId)) {
    throw new CliError(
      'INVALID_ARGS',
      'Telegram webhook requires both --telegram-bot-token and --telegram-chat-id.',
    );
  }

  if (options.executeLive) {
    if (options.maxAmountUsdc === null) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Live mode requires --max-amount-usdc.');
    }
    if (options.maxOpenExposureUsdc === null) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Live mode requires --max-open-exposure-usdc.');
    }
    if (options.maxTradesPerDay === null) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Live mode requires --max-trades-per-day.');
    }
  } else {
    if (options.maxOpenExposureUsdc === null) options.maxOpenExposureUsdc = Number.POSITIVE_INFINITY;
    if (options.maxTradesPerDay === null) options.maxTradesPerDay = Number.MAX_SAFE_INTEGER;
  }

  if (options.stateFile === null) {
    options.stateFile = defaultAutopilotStateFile({
      mode: options.mode,
      marketAddress: options.marketAddress,
      side: options.side,
      amountUsdc: options.amountUsdc,
      triggerYesBelow: options.triggerYesBelow,
      triggerYesAbove: options.triggerYesAbove,
      executeLive: options.executeLive,
    });
  }
  if (options.killSwitchFile === null) {
    options.killSwitchFile = defaultAutopilotKillSwitchFile();
  }

  return options;
}

function parseMirrorPlanFlags(args) {
  const options = {
    source: 'polymarket',
    polymarketMarketId: null,
    polymarketSlug: null,
    chainId: null,
    targetSlippageBps: 150,
    turnoverTarget: 1.25,
    depthSlippageBps: 100,
    safetyMultiplier: 1.2,
    minLiquidityUsdc: 100,
    maxLiquidityUsdc: 50_000,
    withRules: false,
    includeSimilarity: false,
    polymarketHost: null,
    polymarketMockUrl: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--source') {
      const source = requireFlagValue(args, i, '--source').toLowerCase();
      if (source !== 'polymarket') {
        throw new CliError('INVALID_FLAG_VALUE', '--source must be polymarket in mirror v1.');
      }
      options.source = source;
      i += 1;
      continue;
    }
    if (token === '--polymarket-market-id') {
      options.polymarketMarketId = requireFlagValue(args, i, '--polymarket-market-id');
      i += 1;
      continue;
    }
    if (token === '--polymarket-slug') {
      options.polymarketSlug = requireFlagValue(args, i, '--polymarket-slug');
      i += 1;
      continue;
    }
    if (token === '--chain-id') {
      options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
      i += 1;
      continue;
    }
    if (token === '--target-slippage-bps') {
      options.targetSlippageBps = parsePositiveInteger(requireFlagValue(args, i, '--target-slippage-bps'), '--target-slippage-bps');
      if (options.targetSlippageBps > 10_000) {
        throw new CliError('INVALID_FLAG_VALUE', '--target-slippage-bps must be <= 10000.');
      }
      i += 1;
      continue;
    }
    if (token === '--turnover-target') {
      options.turnoverTarget = parsePositiveNumber(requireFlagValue(args, i, '--turnover-target'), '--turnover-target');
      i += 1;
      continue;
    }
    if (token === '--depth-slippage-bps') {
      options.depthSlippageBps = parsePositiveInteger(requireFlagValue(args, i, '--depth-slippage-bps'), '--depth-slippage-bps');
      if (options.depthSlippageBps > 10_000) {
        throw new CliError('INVALID_FLAG_VALUE', '--depth-slippage-bps must be <= 10000.');
      }
      i += 1;
      continue;
    }
    if (token === '--safety-multiplier') {
      options.safetyMultiplier = parsePositiveNumber(requireFlagValue(args, i, '--safety-multiplier'), '--safety-multiplier');
      i += 1;
      continue;
    }
    if (token === '--min-liquidity-usdc') {
      options.minLiquidityUsdc = parsePositiveNumber(requireFlagValue(args, i, '--min-liquidity-usdc'), '--min-liquidity-usdc');
      i += 1;
      continue;
    }
    if (token === '--max-liquidity-usdc') {
      options.maxLiquidityUsdc = parsePositiveNumber(requireFlagValue(args, i, '--max-liquidity-usdc'), '--max-liquidity-usdc');
      i += 1;
      continue;
    }
    if (token === '--with-rules') {
      options.withRules = true;
      continue;
    }
    if (token === '--include-similarity') {
      options.includeSimilarity = true;
      continue;
    }
    if (token === '--polymarket-host') {
      options.polymarketHost = requireFlagValue(args, i, '--polymarket-host');
      i += 1;
      continue;
    }
    if (token === '--polymarket-mock-url') {
      options.polymarketMockUrl = requireFlagValue(args, i, '--polymarket-mock-url');
      i += 1;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror plan: ${token}`);
  }

  if (!options.polymarketMarketId && !options.polymarketSlug) {
    throw new CliError(
      'MISSING_REQUIRED_FLAG',
      'mirror plan requires --polymarket-market-id <id> or --polymarket-slug <slug>.',
    );
  }
  if (options.minLiquidityUsdc > options.maxLiquidityUsdc) {
    throw new CliError('INVALID_ARGS', '--min-liquidity-usdc cannot be greater than --max-liquidity-usdc.');
  }

  return options;
}

function parseMirrorDeployFlags(args) {
  const options = {
    planFile: null,
    polymarketMarketId: null,
    polymarketSlug: null,
    dryRun: false,
    execute: false,
    marketType: 'amm',
    liquidityUsdc: null,
    feeTier: 3000,
    maxImbalance: 10_000,
    arbiter: null,
    category: 3,
    allowRuleMismatch: false,
    sources: [],
    chainId: null,
    rpcUrl: null,
    privateKey: null,
    oracle: null,
    factory: null,
    usdc: null,
    distributionYes: null,
    distributionNo: null,
    polymarketHost: null,
    polymarketMockUrl: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--plan-file') {
      options.planFile = requireFlagValue(args, i, '--plan-file');
      i += 1;
      continue;
    }
    if (token === '--polymarket-market-id') {
      options.polymarketMarketId = requireFlagValue(args, i, '--polymarket-market-id');
      i += 1;
      continue;
    }
    if (token === '--polymarket-slug') {
      options.polymarketSlug = requireFlagValue(args, i, '--polymarket-slug');
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
    if (token === '--market-type') {
      options.marketType = requireFlagValue(args, i, '--market-type').toLowerCase();
      i += 1;
      continue;
    }
    if (token === '--liquidity-usdc') {
      options.liquidityUsdc = parsePositiveNumber(requireFlagValue(args, i, '--liquidity-usdc'), '--liquidity-usdc');
      i += 1;
      continue;
    }
    if (token === '--fee-tier') {
      options.feeTier = parsePositiveInteger(requireFlagValue(args, i, '--fee-tier'), '--fee-tier');
      i += 1;
      continue;
    }
    if (token === '--max-imbalance') {
      options.maxImbalance = parsePositiveInteger(requireFlagValue(args, i, '--max-imbalance'), '--max-imbalance');
      i += 1;
      continue;
    }
    if (token === '--arbiter') {
      options.arbiter = parseAddressFlag(requireFlagValue(args, i, '--arbiter'), '--arbiter');
      i += 1;
      continue;
    }
    if (token === '--category') {
      options.category = parseInteger(requireFlagValue(args, i, '--category'), '--category');
      i += 1;
      continue;
    }
    if (token === '--allow-rule-mismatch') {
      options.allowRuleMismatch = true;
      continue;
    }
    if (token === '--sources') {
      let j = i + 1;
      const entries = [];
      while (j < args.length && !args[j].startsWith('--')) {
        entries.push(args[j]);
        j += 1;
      }
      if (!entries.length) {
        throw new CliError('MISSING_FLAG_VALUE', 'Missing value for --sources');
      }
      options.sources.push(...entries);
      i = j - 1;
      continue;
    }
    if (token === '--chain-id') {
      options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
      i += 1;
      continue;
    }
    if (token === '--rpc-url') {
      options.rpcUrl = requireFlagValue(args, i, '--rpc-url');
      i += 1;
      continue;
    }
    if (token === '--private-key') {
      options.privateKey = requireFlagValue(args, i, '--private-key');
      i += 1;
      continue;
    }
    if (token === '--oracle') {
      options.oracle = parseAddressFlag(requireFlagValue(args, i, '--oracle'), '--oracle');
      i += 1;
      continue;
    }
    if (token === '--factory') {
      options.factory = parseAddressFlag(requireFlagValue(args, i, '--factory'), '--factory');
      i += 1;
      continue;
    }
    if (token === '--usdc') {
      options.usdc = parseAddressFlag(requireFlagValue(args, i, '--usdc'), '--usdc');
      i += 1;
      continue;
    }
    if (token === '--distribution-yes') {
      options.distributionYes = parsePositiveInteger(requireFlagValue(args, i, '--distribution-yes'), '--distribution-yes');
      i += 1;
      continue;
    }
    if (token === '--distribution-no') {
      options.distributionNo = parsePositiveInteger(requireFlagValue(args, i, '--distribution-no'), '--distribution-no');
      i += 1;
      continue;
    }
    if (token === '--polymarket-host') {
      options.polymarketHost = requireFlagValue(args, i, '--polymarket-host');
      i += 1;
      continue;
    }
    if (token === '--polymarket-mock-url') {
      options.polymarketMockUrl = requireFlagValue(args, i, '--polymarket-mock-url');
      i += 1;
      continue;
    }
    throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror deploy: ${token}`);
  }

  if (options.dryRun === options.execute) {
    throw new CliError('INVALID_ARGS', 'mirror deploy requires exactly one mode: --dry-run or --execute.');
  }
  if (options.marketType !== 'amm') {
    throw new CliError('INVALID_FLAG_VALUE', 'mirror deploy only supports --market-type amm in v1.');
  }
  if (!options.planFile && !options.polymarketMarketId && !options.polymarketSlug) {
    throw new CliError(
      'MISSING_REQUIRED_FLAG',
      'mirror deploy requires --plan-file <path> or a Polymarket selector (--polymarket-market-id/--polymarket-slug).',
    );
  }
  if (![500, 3000, 10000].includes(options.feeTier)) {
    throw new CliError('INVALID_FLAG_VALUE', '--fee-tier must be one of 500, 3000, 10000.');
  }
  if (
    (options.distributionYes === null && options.distributionNo !== null) ||
    (options.distributionYes !== null && options.distributionNo === null)
  ) {
    throw new CliError('INVALID_ARGS', 'Provide both --distribution-yes and --distribution-no together.');
  }
  if (
    options.distributionYes !== null &&
    options.distributionNo !== null &&
    options.distributionYes + options.distributionNo !== 1_000_000_000
  ) {
    throw new CliError('INVALID_ARGS', '--distribution-yes + --distribution-no must equal 1000000000.');
  }

  return options;
}

function parseMirrorVerifyFlags(args) {
  const options = {
    pandoraMarketAddress: null,
    polymarketMarketId: null,
    polymarketSlug: null,
    includeSimilarity: false,
    withRules: false,
    allowRuleMismatch: false,
    polymarketHost: null,
    polymarketMockUrl: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--pandora-market-address') {
      options.pandoraMarketAddress = parseAddressFlag(
        requireFlagValue(args, i, '--pandora-market-address'),
        '--pandora-market-address',
      );
      i += 1;
      continue;
    }
    if (token === '--polymarket-market-id') {
      options.polymarketMarketId = requireFlagValue(args, i, '--polymarket-market-id');
      i += 1;
      continue;
    }
    if (token === '--polymarket-slug') {
      options.polymarketSlug = requireFlagValue(args, i, '--polymarket-slug');
      i += 1;
      continue;
    }
    if (token === '--include-similarity') {
      options.includeSimilarity = true;
      continue;
    }
    if (token === '--with-rules') {
      options.withRules = true;
      continue;
    }
    if (token === '--allow-rule-mismatch') {
      options.allowRuleMismatch = true;
      continue;
    }
    if (token === '--polymarket-host') {
      options.polymarketHost = requireFlagValue(args, i, '--polymarket-host');
      i += 1;
      continue;
    }
    if (token === '--polymarket-mock-url') {
      options.polymarketMockUrl = requireFlagValue(args, i, '--polymarket-mock-url');
      i += 1;
      continue;
    }
    throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror verify: ${token}`);
  }

  if (!options.pandoraMarketAddress) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing --pandora-market-address <address>.');
  }
  if (!options.polymarketMarketId && !options.polymarketSlug) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'mirror verify requires --polymarket-market-id <id> or --polymarket-slug <slug>.');
  }

  return options;
}

function parseMirrorStatusFlags(args) {
  const options = {
    stateFile: null,
    strategyHash: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--state-file') {
      options.stateFile = requireFlagValue(args, i, '--state-file');
      i += 1;
      continue;
    }
    if (token === '--strategy-hash') {
      const value = requireFlagValue(args, i, '--strategy-hash');
      if (!/^[a-f0-9]{16}$/i.test(value)) {
        throw new CliError('INVALID_FLAG_VALUE', '--strategy-hash must be a 16-character hex value.');
      }
      options.strategyHash = value.toLowerCase();
      i += 1;
      continue;
    }
    throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror status: ${token}`);
  }

  if (!options.stateFile && !options.strategyHash) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'mirror status requires --state-file <path> or --strategy-hash <hash>.');
  }

  return options;
}

function parseMirrorSyncFlags(args) {
  const mode = args[0];
  if (mode !== 'run' && mode !== 'once') {
    throw new CliError('INVALID_ARGS', 'mirror sync requires subcommand run|once.');
  }

  const rest = args.slice(1);
  const options = {
    mode,
    pandoraMarketAddress: null,
    polymarketMarketId: null,
    polymarketSlug: null,
    executeLive: false,
    intervalMs: 5_000,
    driftTriggerBps: 150,
    hedgeTriggerUsdc: 10,
    maxRebalanceUsdc: 25,
    maxHedgeUsdc: 50,
    maxOpenExposureUsdc: null,
    maxTradesPerDay: null,
    cooldownMs: 60_000,
    depthSlippageBps: 100,
    iterations: null,
    stateFile: null,
    killSwitchFile: null,
    chainId: null,
    rpcUrl: null,
    privateKey: null,
    usdc: null,
    polymarketHost: null,
    polymarketMockUrl: null,
    webhookUrl: null,
    webhookTemplate: null,
    webhookSecret: null,
    webhookTimeoutMs: 5_000,
    webhookRetries: 3,
    telegramBotToken: null,
    telegramChatId: null,
    discordWebhookUrl: null,
    failOnWebhookError: false,
  };

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--pandora-market-address') {
      options.pandoraMarketAddress = parseAddressFlag(
        requireFlagValue(rest, i, '--pandora-market-address'),
        '--pandora-market-address',
      );
      i += 1;
      continue;
    }
    if (token === '--polymarket-market-id') {
      options.polymarketMarketId = requireFlagValue(rest, i, '--polymarket-market-id');
      i += 1;
      continue;
    }
    if (token === '--polymarket-slug') {
      options.polymarketSlug = requireFlagValue(rest, i, '--polymarket-slug');
      i += 1;
      continue;
    }
    if (token === '--paper') {
      options.executeLive = false;
      continue;
    }
    if (token === '--execute-live') {
      options.executeLive = true;
      continue;
    }
    if (token === '--interval-ms') {
      options.intervalMs = parsePositiveInteger(requireFlagValue(rest, i, '--interval-ms'), '--interval-ms');
      if (options.intervalMs < 1_000) {
        throw new CliError('INVALID_FLAG_VALUE', '--interval-ms must be >= 1000.');
      }
      i += 1;
      continue;
    }
    if (token === '--drift-trigger-bps') {
      options.driftTriggerBps = parsePositiveInteger(requireFlagValue(rest, i, '--drift-trigger-bps'), '--drift-trigger-bps');
      i += 1;
      continue;
    }
    if (token === '--hedge-trigger-usdc') {
      options.hedgeTriggerUsdc = parsePositiveNumber(requireFlagValue(rest, i, '--hedge-trigger-usdc'), '--hedge-trigger-usdc');
      i += 1;
      continue;
    }
    if (token === '--max-rebalance-usdc') {
      options.maxRebalanceUsdc = parsePositiveNumber(requireFlagValue(rest, i, '--max-rebalance-usdc'), '--max-rebalance-usdc');
      i += 1;
      continue;
    }
    if (token === '--max-hedge-usdc') {
      options.maxHedgeUsdc = parsePositiveNumber(requireFlagValue(rest, i, '--max-hedge-usdc'), '--max-hedge-usdc');
      i += 1;
      continue;
    }
    if (token === '--max-open-exposure-usdc') {
      options.maxOpenExposureUsdc = parsePositiveNumber(
        requireFlagValue(rest, i, '--max-open-exposure-usdc'),
        '--max-open-exposure-usdc',
      );
      i += 1;
      continue;
    }
    if (token === '--max-trades-per-day') {
      options.maxTradesPerDay = parsePositiveInteger(
        requireFlagValue(rest, i, '--max-trades-per-day'),
        '--max-trades-per-day',
      );
      i += 1;
      continue;
    }
    if (token === '--cooldown-ms') {
      options.cooldownMs = parsePositiveInteger(requireFlagValue(rest, i, '--cooldown-ms'), '--cooldown-ms');
      i += 1;
      continue;
    }
    if (token === '--depth-slippage-bps') {
      options.depthSlippageBps = parsePositiveInteger(requireFlagValue(rest, i, '--depth-slippage-bps'), '--depth-slippage-bps');
      if (options.depthSlippageBps > 10_000) {
        throw new CliError('INVALID_FLAG_VALUE', '--depth-slippage-bps must be <= 10000.');
      }
      i += 1;
      continue;
    }
    if (token === '--iterations') {
      options.iterations = parsePositiveInteger(requireFlagValue(rest, i, '--iterations'), '--iterations');
      i += 1;
      continue;
    }
    if (token === '--state-file') {
      options.stateFile = requireFlagValue(rest, i, '--state-file');
      i += 1;
      continue;
    }
    if (token === '--kill-switch-file') {
      options.killSwitchFile = requireFlagValue(rest, i, '--kill-switch-file');
      i += 1;
      continue;
    }
    if (token === '--chain-id') {
      options.chainId = parseInteger(requireFlagValue(rest, i, '--chain-id'), '--chain-id');
      i += 1;
      continue;
    }
    if (token === '--rpc-url') {
      options.rpcUrl = requireFlagValue(rest, i, '--rpc-url');
      i += 1;
      continue;
    }
    if (token === '--private-key') {
      options.privateKey = requireFlagValue(rest, i, '--private-key');
      i += 1;
      continue;
    }
    if (token === '--usdc') {
      options.usdc = parseAddressFlag(requireFlagValue(rest, i, '--usdc'), '--usdc');
      i += 1;
      continue;
    }
    if (token === '--polymarket-host') {
      options.polymarketHost = requireFlagValue(rest, i, '--polymarket-host');
      i += 1;
      continue;
    }
    if (token === '--polymarket-mock-url') {
      options.polymarketMockUrl = requireFlagValue(rest, i, '--polymarket-mock-url');
      i += 1;
      continue;
    }

    const webhookStep = parseWebhookFlagIntoOptions(rest, i, token, options);
    if (webhookStep !== null) {
      i += webhookStep;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror sync: ${token}`);
  }

  if (!options.pandoraMarketAddress) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing --pandora-market-address <address>.');
  }
  if (!options.polymarketMarketId && !options.polymarketSlug) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'mirror sync requires --polymarket-market-id <id> or --polymarket-slug <slug>.');
  }
  if ((options.telegramBotToken && !options.telegramChatId) || (!options.telegramBotToken && options.telegramChatId)) {
    throw new CliError(
      'INVALID_ARGS',
      'Telegram webhook requires both --telegram-bot-token and --telegram-chat-id.',
    );
  }

  if (options.executeLive) {
    if (options.maxOpenExposureUsdc === null) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Live mode requires --max-open-exposure-usdc.');
    }
    if (options.maxTradesPerDay === null) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Live mode requires --max-trades-per-day.');
    }
  } else {
    if (options.maxOpenExposureUsdc === null) options.maxOpenExposureUsdc = Number.POSITIVE_INFINITY;
    if (options.maxTradesPerDay === null) options.maxTradesPerDay = Number.MAX_SAFE_INTEGER;
  }

  if (options.stateFile === null) {
    options.stateFile = defaultMirrorStateFile({
      mode: options.mode,
      pandoraMarketAddress: options.pandoraMarketAddress,
      polymarketMarketId: options.polymarketMarketId,
      polymarketSlug: options.polymarketSlug,
      executeLive: options.executeLive,
      driftTriggerBps: options.driftTriggerBps,
      hedgeTriggerUsdc: options.hedgeTriggerUsdc,
    });
  }
  if (options.killSwitchFile === null) {
    options.killSwitchFile = defaultMirrorKillSwitchFile();
  }

  return options;
}

function parseWebhookTestFlags(args) {
  const options = {
    webhookUrl: null,
    webhookTemplate: null,
    webhookSecret: null,
    webhookTimeoutMs: 5_000,
    webhookRetries: 3,
    telegramBotToken: null,
    telegramChatId: null,
    discordWebhookUrl: null,
    failOnWebhookError: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    const step = parseWebhookFlagIntoOptions(args, i, token, options);
    if (step !== null) {
      i += step;
      continue;
    }
    throw new CliError('UNKNOWN_FLAG', `Unknown flag for webhook test: ${token}`);
  }

  if (!hasWebhookTargets(options)) {
    throw new CliError(
      'MISSING_REQUIRED_FLAG',
      'webhook test requires at least one target: --webhook-url, Telegram, or Discord flags.',
    );
  }
  if ((options.telegramBotToken && !options.telegramChatId) || (!options.telegramBotToken && options.telegramChatId)) {
    throw new CliError(
      'INVALID_ARGS',
      'Telegram webhook requires both --telegram-bot-token and --telegram-chat-id.',
    );
  }

  return options;
}

function parseLeaderboardFlags(args) {
  const options = {
    metric: 'profit',
    chainId: null,
    limit: 20,
    minTrades: 0,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--metric') {
      const metric = requireFlagValue(args, i, '--metric').toLowerCase();
      if (!['profit', 'volume', 'win-rate'].includes(metric)) {
        throw new CliError('INVALID_FLAG_VALUE', '--metric must be profit|volume|win-rate.');
      }
      options.metric = metric;
      i += 1;
      continue;
    }
    if (token === '--chain-id') {
      options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
      i += 1;
      continue;
    }
    if (token === '--limit') {
      options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
      i += 1;
      continue;
    }
    if (token === '--min-trades') {
      options.minTrades = parseNonNegativeInteger(requireFlagValue(args, i, '--min-trades'), '--min-trades');
      i += 1;
      continue;
    }
    throw new CliError('UNKNOWN_FLAG', `Unknown flag for leaderboard: ${token}`);
  }

  return options;
}

function parseAnalyzeFlags(args) {
  const options = {
    marketAddress: null,
    provider: null,
    model: null,
    maxCostUsd: null,
    temperature: null,
    timeoutMs: 12_000,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--market-address') {
      options.marketAddress = parseAddressFlag(requireFlagValue(args, i, '--market-address'), '--market-address');
      i += 1;
      continue;
    }
    if (token === '--provider') {
      options.provider = requireFlagValue(args, i, '--provider');
      i += 1;
      continue;
    }
    if (token === '--model') {
      options.model = requireFlagValue(args, i, '--model');
      i += 1;
      continue;
    }
    if (token === '--max-cost-usd') {
      options.maxCostUsd = parsePositiveNumber(requireFlagValue(args, i, '--max-cost-usd'), '--max-cost-usd');
      i += 1;
      continue;
    }
    if (token === '--temperature') {
      options.temperature = parseNumber(requireFlagValue(args, i, '--temperature'), '--temperature');
      i += 1;
      continue;
    }
    if (token === '--timeout-ms') {
      options.timeoutMs = parsePositiveInteger(requireFlagValue(args, i, '--timeout-ms'), '--timeout-ms');
      i += 1;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for analyze: ${token}`);
  }

  if (!options.marketAddress) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing market address. Use --market-address <address>.');
  }

  return options;
}

function parseSuggestFlags(args) {
  const options = {
    wallet: null,
    risk: null,
    budget: null,
    count: 3,
    includeVenues: ['pandora', 'polymarket'],
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--wallet') {
      options.wallet = parseAddressFlag(requireFlagValue(args, i, '--wallet'), '--wallet');
      i += 1;
      continue;
    }
    if (token === '--risk') {
      const risk = requireFlagValue(args, i, '--risk').toLowerCase();
      if (!['low', 'medium', 'high'].includes(risk)) {
        throw new CliError('INVALID_FLAG_VALUE', '--risk must be low|medium|high.');
      }
      options.risk = risk;
      i += 1;
      continue;
    }
    if (token === '--budget') {
      options.budget = parsePositiveNumber(requireFlagValue(args, i, '--budget'), '--budget');
      i += 1;
      continue;
    }
    if (token === '--count') {
      options.count = parsePositiveInteger(requireFlagValue(args, i, '--count'), '--count');
      i += 1;
      continue;
    }
    if (token === '--include-venues') {
      const venues = parseCsvList(requireFlagValue(args, i, '--include-venues'), '--include-venues').map((value) =>
        value.toLowerCase(),
      );
      const allowed = new Set(['pandora', 'polymarket']);
      for (const venue of venues) {
        if (!allowed.has(venue)) {
          throw new CliError('INVALID_FLAG_VALUE', `Unsupported venue in --include-venues: ${venue}`);
        }
      }
      options.includeVenues = venues;
      i += 1;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for suggest: ${token}`);
  }

  if (!options.wallet) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing wallet address. Use --wallet <address>.');
  }
  if (!options.risk) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing risk profile. Use --risk low|medium|high.');
  }
  if (options.budget === null) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing budget. Use --budget <amount>.');
  }

  return options;
}

function parseResolveFlags(args) {
  const options = {
    pollAddress: null,
    answer: null,
    reason: null,
    dryRun: false,
    execute: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--poll-address') {
      options.pollAddress = parseAddressFlag(requireFlagValue(args, i, '--poll-address'), '--poll-address');
      i += 1;
      continue;
    }
    if (token === '--answer') {
      const answer = requireFlagValue(args, i, '--answer').toLowerCase();
      if (!['yes', 'no', 'invalid'].includes(answer)) {
        throw new CliError('INVALID_FLAG_VALUE', '--answer must be yes|no|invalid.');
      }
      options.answer = answer;
      i += 1;
      continue;
    }
    if (token === '--reason') {
      options.reason = requireFlagValue(args, i, '--reason');
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
    throw new CliError('UNKNOWN_FLAG', `Unknown flag for resolve: ${token}`);
  }

  if (!options.pollAddress) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing poll address. Use --poll-address <address>.');
  }
  if (!options.answer) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing answer. Use --answer yes|no|invalid.');
  }
  if (!options.reason) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing reason. Use --reason <text>.');
  }
  if (options.dryRun === options.execute) {
    throw new CliError('INVALID_ARGS', 'Use exactly one mode: --dry-run or --execute.');
  }

  return options;
}

function parseLpFlags(args) {
  const action = args[0];
  if (!action || !['add', 'remove', 'positions'].includes(action)) {
    throw new CliError('INVALID_ARGS', 'lp requires subcommand add|remove|positions.');
  }

  const rest = args.slice(1);
  const options = {
    action,
    marketAddress: null,
    wallet: null,
    amountUsdc: null,
    lpTokens: null,
    chainId: null,
    dryRun: false,
    execute: false,
  };

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--market-address') {
      options.marketAddress = parseAddressFlag(requireFlagValue(rest, i, '--market-address'), '--market-address');
      i += 1;
      continue;
    }
    if (token === '--wallet') {
      options.wallet = parseAddressFlag(requireFlagValue(rest, i, '--wallet'), '--wallet');
      i += 1;
      continue;
    }
    if (token === '--amount-usdc') {
      options.amountUsdc = parsePositiveNumber(requireFlagValue(rest, i, '--amount-usdc'), '--amount-usdc');
      i += 1;
      continue;
    }
    if (token === '--lp-tokens') {
      options.lpTokens = parsePositiveNumber(requireFlagValue(rest, i, '--lp-tokens'), '--lp-tokens');
      i += 1;
      continue;
    }
    if (token === '--chain-id') {
      options.chainId = parseInteger(requireFlagValue(rest, i, '--chain-id'), '--chain-id');
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
    throw new CliError('UNKNOWN_FLAG', `Unknown flag for lp ${action}: ${token}`);
  }

  if (action === 'positions') {
    if (!options.wallet) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing wallet address. Use --wallet <address>.');
    }
    return options;
  }

  if (!options.marketAddress) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing market address. Use --market-address <address>.');
  }
  if (action === 'add' && options.amountUsdc === null) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing liquidity amount. Use --amount-usdc <amount>.');
  }
  if (action === 'remove' && options.lpTokens === null) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing LP token amount. Use --lp-tokens <amount>.');
  }
  if (options.dryRun === options.execute) {
    throw new CliError('INVALID_ARGS', 'Use exactly one mode: --dry-run or --execute.');
  }

  return options;
}

function parseChainIdFromHex(value) {
  if (!value || typeof value !== 'string') return null;
  const parsed = Number.parseInt(value, 16);
  if (!Number.isInteger(parsed)) return null;
  return parsed;
}

async function rpcRequest(rpcUrl, method, params, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new CliError('RPC_TIMEOUT', `RPC request timed out after ${timeoutMs}ms.`);
    }
    throw new CliError('RPC_REQUEST_FAILED', `RPC request failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new CliError('RPC_HTTP_ERROR', `RPC endpoint returned HTTP ${response.status}.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new CliError('RPC_INVALID_JSON', 'RPC endpoint returned a non-JSON response.');
  }

  if (payload.error) {
    throw new CliError('RPC_RESPONSE_ERROR', `RPC error: ${payload.error.message || 'Unknown RPC error'}`);
  }

  return payload.result;
}

function validateEnvValues() {
  const missing = REQUIRED_ENV_KEYS.filter((key) => !process.env[key] || !String(process.env[key]).trim());
  const missingSet = new Set(missing);
  const errors = [];

  const chainIdRaw = String(process.env.CHAIN_ID || '').trim();
  let chainId = null;
  if (!missingSet.has('CHAIN_ID')) {
    chainId = Number(chainIdRaw);
    if (!Number.isInteger(chainId)) {
      errors.push(`CHAIN_ID must be an integer. Received: "${chainIdRaw}"`);
    } else if (!SUPPORTED_CHAIN_IDS.has(chainId)) {
      errors.push(`Unsupported CHAIN_ID=${chainId}. Supported values: 1, 146`);
    }
  }

  const rpcUrl = String(process.env.RPC_URL || '').trim();
  if (!missingSet.has('RPC_URL') && !isValidHttpUrl(rpcUrl)) {
    errors.push(`RPC_URL must be a valid http/https URL. Received: "${rpcUrl}"`);
  }

  const privateKey = String(process.env.PRIVATE_KEY || '').trim();
  if (!missingSet.has('PRIVATE_KEY') && !isValidPrivateKey(privateKey)) {
    errors.push('PRIVATE_KEY must be a full 32-byte hex key (0x + 64 hex chars), not a placeholder.');
  }

  for (const key of ['ORACLE', 'FACTORY', 'USDC']) {
    const value = String(process.env[key] || '').trim();
    if (missingSet.has(key)) {
      continue;
    }
    if (!isValidAddress(value)) {
      errors.push(`${key} must be a valid 20-byte hex address (0x + 40 hex chars). Received: "${value}"`);
      continue;
    }
    if (value.toLowerCase() === ZERO_ADDRESS) {
      errors.push(`${key} cannot be the zero address.`);
    }
  }

  return {
    missing,
    errors,
    chainId,
    rpcUrl,
    addresses: {
      ORACLE: String(process.env.ORACLE || '').trim(),
      FACTORY: String(process.env.FACTORY || '').trim(),
      USDC: String(process.env.USDC || '').trim(),
    },
  };
}

function summarizeCodePresence(code) {
  if (typeof code !== 'string') return { hasCode: false, byteLength: 0 };
  const normalized = code.trim().toLowerCase();
  if (normalized === '0x' || normalized === '0x0') {
    return { hasCode: false, byteLength: 0 };
  }

  const hex = normalized.startsWith('0x') ? normalized.slice(2) : normalized;
  const byteLength = hex.length > 0 ? Math.floor(hex.length / 2) : 0;
  return { hasCode: byteLength > 0, byteLength };
}

async function buildDoctorReport(options) {
  if (options.useEnvFile) {
    loadEnvFile(options.envFile);
  }

  const envState = validateEnvValues();
  const report = {
    env: {
      envFile: options.envFile,
      usedEnvFile: options.useEnvFile,
      required: {
        ok: envState.missing.length === 0,
        missing: envState.missing,
      },
      validation: {
        ok: envState.errors.length === 0,
        errors: envState.errors,
      },
    },
    rpc: {
      ok: false,
      url: String(process.env.RPC_URL || '').trim(),
      chainIdHex: null,
      chainId: null,
      expectedChainId: Number.isInteger(envState.chainId) ? envState.chainId : null,
      matchesExpectedChainId: null,
      error: null,
    },
    codeChecks: [],
    summary: {
      ok: false,
      errorCount: 0,
      warningCount: 0,
    },
  };

  if (!report.env.required.ok || !report.env.validation.ok) {
    const envErrorCount = report.env.required.missing.length + report.env.validation.errors.length;
    report.summary.ok = false;
    report.summary.errorCount = envErrorCount;
    return report;
  }

  try {
    const chainIdHex = await rpcRequest(envState.rpcUrl, 'eth_chainId', [], options.rpcTimeoutMs);
    report.rpc.chainIdHex = chainIdHex;
    report.rpc.chainId = parseChainIdFromHex(chainIdHex);
    report.rpc.matchesExpectedChainId = report.rpc.chainId === report.rpc.expectedChainId;
    report.rpc.ok = Boolean(report.rpc.chainIdHex) && report.rpc.matchesExpectedChainId;

    if (!report.rpc.matchesExpectedChainId) {
      report.rpc.error = `RPC chain id mismatch. RPC=${report.rpc.chainId} expected=${report.rpc.expectedChainId}`;
    }
  } catch (err) {
    report.rpc.ok = false;
    report.rpc.error = err instanceof CliError ? err.message : String(err);
  }

  const codeTargets = [
    { key: 'ORACLE', required: true },
    { key: 'FACTORY', required: true },
  ];

  if (options.checkUsdcCode) {
    codeTargets.push({ key: 'USDC', required: false });
  }

  for (const target of codeTargets) {
    const address = envState.addresses[target.key];
    const check = {
      key: target.key,
      address,
      required: target.required,
      checked: false,
      ok: false,
      hasCode: false,
      codeByteLength: 0,
      error: null,
    };

    if (!report.rpc.ok) {
      check.error = 'Skipped because RPC reachability check failed.';
      report.codeChecks.push(check);
      continue;
    }

    try {
      const code = await rpcRequest(envState.rpcUrl, 'eth_getCode', [address, 'latest'], options.rpcTimeoutMs);
      const summary = summarizeCodePresence(code);
      check.checked = true;
      check.hasCode = summary.hasCode;
      check.codeByteLength = summary.byteLength;
      check.ok = summary.hasCode;
      if (!summary.hasCode && target.required) {
        check.error = `${target.key} returned empty bytecode.`;
      }
    } catch (err) {
      check.checked = true;
      check.ok = false;
      check.error = err instanceof CliError ? err.message : String(err);
    }

    report.codeChecks.push(check);
  }

  const failures = [];
  if (!report.env.required.ok) {
    failures.push(...report.env.required.missing.map((name) => `Missing required env var: ${name}`));
  }
  if (!report.env.validation.ok) {
    failures.push(...report.env.validation.errors);
  }
  if (!report.rpc.ok) {
    failures.push(report.rpc.error || 'RPC reachability check failed.');
  }
  for (const check of report.codeChecks) {
    if (!check.ok && check.required) {
      failures.push(check.error || `${check.key} failed code check.`);
    }
    if (!check.ok && !check.required && check.error) {
      report.summary.warningCount += 1;
    }
  }

  report.summary.errorCount = failures.length;
  report.summary.ok = failures.length === 0;
  report.summary.failures = failures;
  return report;
}

function short(value, length = 16) {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  if (raw.length <= length) return raw;
  return `${raw.slice(0, length - 3)}...`;
}

function formatTimestamp(raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return String(raw);

  const millis = numeric > 1e12 ? numeric : numeric * 1000;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return String(raw);
  return date.toISOString();
}

function valueToCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function printTable(headers, rows) {
  const normalizedRows = rows.map((row) => row.map(valueToCell));
  const widths = headers.map((header, col) => {
    const headerWidth = valueToCell(header).length;
    const rowWidth = normalizedRows.reduce((max, row) => Math.max(max, row[col] ? row[col].length : 0), 0);
    return Math.max(headerWidth, rowWidth);
  });

  const formatRow = (cells) => cells.map((cell, i) => cell.padEnd(widths[i])).join('  ');
  console.log(formatRow(headers));
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of normalizedRows) {
    console.log(formatRow(row));
  }
}

function printRecord(record) {
  const entries = Object.entries(record);
  printTable(
    ['Field', 'Value'],
    entries.map(([key, value]) => [key, valueToCell(value)]),
  );
}

function renderDoctorReportTable(report) {
  if (report.env.usedEnvFile) {
    console.log(`Loaded env file: ${report.env.envFile}`);
  } else {
    console.log('Skipped env file loading (--skip-dotenv).');
  }

  const statusRows = [
    ['required env', report.env.required.ok ? 'PASS' : 'FAIL', report.env.required.ok ? '' : report.env.required.missing.join(', ')],
    ['env validation', report.env.validation.ok ? 'PASS' : 'FAIL', report.env.validation.ok ? '' : `${report.env.validation.errors.length} issue(s)`],
    ['rpc reachability', report.rpc.ok ? 'PASS' : 'FAIL', report.rpc.ok ? `chainId=${report.rpc.chainId}` : report.rpc.error || 'Unavailable'],
  ];

  for (const check of report.codeChecks) {
    const status = check.ok ? 'PASS' : check.required ? 'FAIL' : 'WARN';
    const detail = check.ok ? `${check.codeByteLength} bytes` : check.error || 'No code';
    statusRows.push([`code:${check.key}`, status, detail]);
  }

  printTable(['Check', 'Status', 'Details'], statusRows);

  if (report.summary.ok) {
    console.log('Doctor checks passed.');
  } else {
    console.log('Doctor checks failed.');
    if (Array.isArray(report.summary.failures) && report.summary.failures.length) {
      for (const failure of report.summary.failures) {
        console.log(`- ${failure}`);
      }
    }
  }
}

function renderSetupTable(data) {
  printTable(
    ['Step', 'Status', 'Details'],
    [
      ['init-env', data.envStep.status.toUpperCase(), data.envStep.message],
      ['doctor', data.doctor.summary.ok ? 'PASS' : 'FAIL', data.doctor.summary.ok ? 'All checks passed' : `${data.doctor.summary.errorCount} issue(s)`],
    ],
  );

  renderDoctorReportTable(data.doctor);

  if (data.doctor.summary.ok) {
    console.log('Setup complete.');
  } else {
    console.log('Setup incomplete. Resolve doctor failures and rerun `pandora setup`.');
  }
}

function renderMarketsListTable(data) {
  const hasOdds = Boolean(
    data.enrichment &&
      data.enrichment.withOdds &&
      Array.isArray(data.enrichedItems),
  );
  const tableItems = hasOdds ? data.enrichedItems : data.items;

  if (!tableItems.length) {
    console.log('No markets found.');
    return;
  }

  if (hasOdds) {
    printTable(
      ['ID', 'Type', 'Chain', 'Poll', 'Close', 'YES', 'NO', 'Diagnostic'],
      tableItems.map((item) => [
        short(item.id, 18),
        item.marketType || '',
        `${item.chainName || ''} (${item.chainId || ''})`,
        short(item.pollAddress, 18),
        formatTimestamp(item.marketCloseTimestamp),
        formatOddsPercent(item.odds && item.odds.yesProbability),
        formatOddsPercent(item.odds && item.odds.noProbability),
        short((item.odds && item.odds.diagnostic) || '', 44),
      ]),
    );
    return;
  }

  printTable(
    ['ID', 'Type', 'Chain', 'Poll', 'Close', 'Volume'],
    tableItems.map((item) => [
      short(item.id, 18),
      item.marketType || '',
      `${item.chainName || ''} (${item.chainId || ''})`,
      short(item.pollAddress, 18),
      formatTimestamp(item.marketCloseTimestamp),
      item.totalVolume || '',
    ]),
  );
}

function renderScanTable(data) {
  const items = Array.isArray(data.enrichedItems) ? data.enrichedItems : [];
  if (!items.length) {
    console.log('No markets found.');
    return;
  }

  printTable(
    ['ID', 'Type', 'Chain', 'Close', 'YES', 'NO', 'Source', 'Diagnostic'],
    items.map((item) => [
      short(item.id, 18),
      item.marketType || '',
      `${item.chainName || ''} (${item.chainId || ''})`,
      formatTimestamp(item.marketCloseTimestamp),
      formatOddsPercent(item.odds && item.odds.yesProbability),
      formatOddsPercent(item.odds && item.odds.noProbability),
      short((item.odds && item.odds.source) || '', 26),
      short((item.odds && item.odds.diagnostic) || '', 40),
    ]),
  );
}

function renderQuoteTable(data) {
  const odds = data.odds || {};
  const estimate = data.estimate || null;
  printTable(
    ['Field', 'Value'],
    [
      ['marketAddress', data.marketAddress],
      ['side', data.side],
      ['amountUsdc', data.amountUsdc],
      ['oddsSource', odds.source || 'n/a'],
      ['yesPct', odds.yesPct === null || odds.yesPct === undefined ? 'n/a' : `${odds.yesPct}%`],
      ['noPct', odds.noPct === null || odds.noPct === undefined ? 'n/a' : `${odds.noPct}%`],
      ['quoteAvailable', data.quoteAvailable ? 'yes' : 'no'],
      ['estimatedShares', estimate ? estimate.estimatedShares : 'n/a'],
      ['minSharesOut', estimate ? estimate.minSharesOut : 'n/a'],
      ['potentialPayoutIfWin', estimate ? estimate.potentialPayoutIfWin : 'n/a'],
      ['potentialProfitIfWin', estimate ? estimate.potentialProfitIfWin : 'n/a'],
      ['diagnostic', odds.diagnostic || ''],
    ],
  );
}

function renderTradeTable(data) {
  const riskGuards = data.riskGuards || {};
  const rows = [
    ['mode', data.mode],
    ['marketAddress', data.marketAddress],
    ['side', data.side],
    ['amountUsdc', data.amountUsdc],
    [
      'selectedProbabilityPct',
      data.selectedProbabilityPct === null || data.selectedProbabilityPct === undefined
        ? 'n/a'
        : `${data.selectedProbabilityPct}%`,
    ],
    ['maxAmountUsdcGuard', riskGuards.maxAmountUsdc === null || riskGuards.maxAmountUsdc === undefined ? '' : riskGuards.maxAmountUsdc],
    [
      'probabilityRangeGuard',
      `${
        riskGuards.minProbabilityPct === null || riskGuards.minProbabilityPct === undefined
          ? '-inf'
          : `${riskGuards.minProbabilityPct}%`
      } .. ${
        riskGuards.maxProbabilityPct === null || riskGuards.maxProbabilityPct === undefined
          ? '+inf'
          : `${riskGuards.maxProbabilityPct}%`
      }`,
    ],
    ['quoteAvailable', data.quote && data.quote.quoteAvailable ? 'yes' : 'no'],
    ['account', data.account || ''],
    ['approveTxHash', data.approveTxHash || ''],
    ['buyTxHash', data.buyTxHash || ''],
    ['status', data.status || ''],
  ];
  printTable(['Field', 'Value'], rows);
}

function renderPollsListTable(data) {
  if (!data.items.length) {
    console.log('No polls found.');
    return;
  }

  printTable(
    ['ID', 'Status', 'Creator', 'Deadline', 'Question'],
    data.items.map((item) => [
      short(item.id, 18),
      item.status,
      short(item.creator, 16),
      formatTimestamp(item.deadlineEpoch),
      short(item.question, 56),
    ]),
  );
}

function renderEventsListTable(data) {
  if (!data.items.length) {
    console.log('No events found.');
    return;
  }

  printTable(
    ['ID', 'Source', 'Chain', 'Time', 'Tx', 'Summary'],
    data.items.map((item) => [
      short(item.id, 20),
      item.source,
      item.chainId || '',
      formatTimestamp(item.timestamp || item.blockNumber),
      short(item.txHash, 18),
      short(item.eventType || item.eventName || item.amount || item.marketAddress || '', 42),
    ]),
  );
}

function renderPositionsListTable(data) {
  if (!data.items.length) {
    console.log('No positions found.');
    return;
  }

  printTable(
    ['ID', 'Wallet', 'Market', 'Last Trade', 'Chain'],
    data.items.map((item) => [
      short(item.id, 22),
      short(item.user, 18),
      short(item.marketAddress, 18),
      formatTimestamp(item.lastTradeAt),
      item.chainId,
    ]),
  );
}

function renderPortfolioTable(data) {
  const summaryRows = [
    ['wallet', data.wallet],
    ['chainIdFilter', data.chainId === null ? 'all' : data.chainId],
    ['positions', data.summary.positionCount],
    ['uniqueMarkets', data.summary.uniqueMarkets],
    ['liquidityAdded', data.summary.liquidityAdded],
    ['liquidityRemoved', data.summary.liquidityRemoved],
    ['netLiquidity', data.summary.netLiquidity],
    ['claims', data.summary.claims],
    ['cashflowNet', data.summary.cashflowNet],
    ['pnlProxy', data.summary.pnlProxy],
    ['eventsIncluded', data.summary.eventsIncluded ? 'yes' : 'no'],
    ['diagnostic', data.summary.diagnostic || ''],
  ];

  printTable(['Field', 'Value'], summaryRows);

  if (Array.isArray(data.positions) && data.positions.length) {
    console.log('');
    printTable(
      ['Market', 'Chain', 'Last Trade'],
      data.positions.map((item) => [
        short(item.marketAddress, 18),
        item.chainId,
        formatTimestamp(item.lastTradeAt),
      ]),
    );
  }
}

function renderWatchTable(data) {
  const rows = [
    ['iterationsRequested', data.iterationsRequested],
    ['snapshotsCaptured', data.count],
    ['alertsTriggered', data.alertCount || 0],
    ['wallet', data.parameters.wallet || ''],
    ['marketAddress', data.parameters.marketAddress || ''],
    ['side', data.parameters.side || ''],
    ['amountUsdc', data.parameters.amountUsdc || ''],
    ['intervalMs', data.intervalMs],
  ];
  printTable(['Field', 'Value'], rows);

  if (!Array.isArray(data.snapshots) || !data.snapshots.length) {
    return;
  }

  console.log('');
  printTable(
    ['Iter', 'Timestamp', 'NetLiquidity', 'Claims', 'QuoteAvail', 'YES%', 'NO%', 'Alerts'],
    data.snapshots.map((snapshot) => [
      snapshot.iteration,
      snapshot.timestamp,
      snapshot.portfolioSummary ? snapshot.portfolioSummary.netLiquidity : '',
      snapshot.portfolioSummary ? snapshot.portfolioSummary.claims : '',
      snapshot.quote ? (snapshot.quote.quoteAvailable ? 'yes' : 'no') : '',
      snapshot.quote && snapshot.quote.odds && snapshot.quote.odds.yesPct !== null ? snapshot.quote.odds.yesPct : '',
      snapshot.quote && snapshot.quote.odds && snapshot.quote.odds.noPct !== null ? snapshot.quote.odds.noPct : '',
      snapshot.alertCount || 0,
    ]),
  );

  if (Array.isArray(data.alerts) && data.alerts.length) {
    console.log('');
    for (const alert of data.alerts) {
      console.log(`ALERT [${alert.code}] iter=${alert.iteration}: ${alert.message}`);
    }
  }
}

function formatNumericCell(value, decimals = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  return numeric.toFixed(decimals);
}

function renderHistoryTable(data) {
  const summary = data.summary || {};
  printTable(
    ['Field', 'Value'],
    [
      ['wallet', data.wallet || ''],
      ['chainId', data.chainId === null || data.chainId === undefined ? 'all' : data.chainId],
      ['trades', summary.tradeCount || 0],
      ['open', summary.openCount || 0],
      ['won', summary.wonCount || 0],
      ['lost', summary.lostCount || 0],
      ['closedOther', summary.closedOtherCount || 0],
      ['grossVolumeUsdc', summary.grossVolumeUsdc === undefined ? '' : summary.grossVolumeUsdc],
      ['realizedPnlApproxUsdc', summary.realizedPnlApproxUsdc === undefined ? '' : summary.realizedPnlApproxUsdc],
      ['unrealizedPnlApproxUsdc', summary.unrealizedPnlApproxUsdc === undefined ? '' : summary.unrealizedPnlApproxUsdc],
    ],
  );

  if (!Array.isArray(data.items) || !data.items.length) {
    return;
  }

  console.log('');
  printTable(
    ['Time', 'Market', 'Side', 'Amount', 'Entry', 'Mark', 'P/L', 'Status'],
    data.items.map((item) => [
      formatTimestamp(item.timestamp),
      short(item.marketAddress, 18),
      item.side || '',
      formatNumericCell(item.collateralAmountUsdc, 2),
      formatNumericCell(item.entryPriceUsdcPerToken, 4),
      formatNumericCell(item.markPriceUsdcPerToken, 4),
      formatNumericCell(
        item.status === 'open' ? item.pnlUnrealizedApproxUsdc : item.pnlRealizedApproxUsdc,
        4,
      ),
      item.status || '',
    ]),
  );
}

function renderExportTable(data) {
  if (data.outPath) {
    printTable(
      ['Field', 'Value'],
      [
        ['format', data.format],
        ['wallet', data.wallet],
        ['chainId', data.chainId === null || data.chainId === undefined ? 'all' : data.chainId],
        ['count', data.count],
        ['outPath', data.outPath],
      ],
    );
    return;
  }

  if (typeof data.content === 'string') {
    console.log(data.content);
    return;
  }

  printTable(
    ['Field', 'Value'],
    [
      ['format', data.format],
      ['wallet', data.wallet],
      ['count', data.count],
    ],
  );
}

function renderArbitrageTable(data) {
  if (!Array.isArray(data.opportunities) || !data.opportunities.length) {
    console.log('No arbitrage opportunities found.');
    return;
  }

  printTable(
    ['Group', 'Spread YES', 'Spread NO', 'Confidence', 'Best YES', 'Best NO', 'Risk Flags'],
    data.opportunities.map((item) => [
      short(item.groupId, 20),
      formatNumericCell(item.spreadYesPct, 3),
      formatNumericCell(item.spreadNoPct, 3),
      formatNumericCell(item.confidenceScore, 3),
      item.bestYesBuy ? `${item.bestYesBuy.venue}:${short(item.bestYesBuy.marketId, 14)}` : '',
      item.bestNoBuy ? `${item.bestNoBuy.venue}:${short(item.bestNoBuy.marketId, 14)}` : '',
      Array.isArray(item.riskFlags) ? item.riskFlags.join(', ') : '',
    ]),
  );
}

function renderAutopilotTable(data) {
  printTable(
    ['Field', 'Value'],
    [
      ['mode', data.mode],
      ['executeLive', data.executeLive ? 'yes' : 'no'],
      ['strategyHash', data.strategyHash],
      ['iterationsCompleted', data.iterationsCompleted],
      ['actionCount', data.actionCount],
      ['stateFile', data.stateFile],
      ['stoppedReason', data.stoppedReason || ''],
    ],
  );

  if (!Array.isArray(data.actions) || !data.actions.length) {
    return;
  }

  console.log('');
  printTable(
    ['Mode', 'Status', 'Reason', 'Execution'],
    data.actions.map((action) => [
      action.mode || '',
      action.status || '',
      short(action.reason || '', 56),
      short(action.execution && action.execution.buyTxHash ? action.execution.buyTxHash : '', 24),
    ]),
  );
}

function renderMirrorPlanTable(data) {
  printTable(
    ['Field', 'Value'],
    [
      ['source', data.source || 'polymarket'],
      ['sourceMarketId', data.sourceMarket ? data.sourceMarket.marketId : ''],
      ['sourceSlug', data.sourceMarket ? data.sourceMarket.slug || '' : ''],
      ['sourceYesPct', data.sourceMarket && data.sourceMarket.yesPct !== null ? data.sourceMarket.yesPct : ''],
      ['recommendedLiquidityUsdc', data.liquidityRecommendation ? data.liquidityRecommendation.liquidityUsdc : ''],
      ['distributionYes', data.distributionHint ? data.distributionHint.distributionYes : ''],
      ['distributionNo', data.distributionHint ? data.distributionHint.distributionNo : ''],
      ['planDigest', data.planDigest || ''],
    ],
  );

  if (data.match) {
    console.log('');
    printTable(
      ['Match Market', 'Similarity', 'Status', 'Question'],
      [[
        short(data.match.marketAddress, 20),
        data.match.similarity ? formatNumericCell(data.match.similarity.score, 4) : '',
        data.match.status === null || data.match.status === undefined ? '' : data.match.status,
        short(data.match.question || '', 72),
      ]],
    );
  }
}

function renderMirrorDeployTable(data) {
  printTable(
    ['Field', 'Value'],
    [
      ['dryRun', data.dryRun ? 'yes' : 'no'],
      ['planDigest', data.planDigest || ''],
      ['pollAddress', data.pandora && data.pandora.pollAddress ? data.pandora.pollAddress : ''],
      ['marketAddress', data.pandora && data.pandora.marketAddress ? data.pandora.marketAddress : ''],
      ['pollTxHash', data.tx && data.tx.pollTxHash ? data.tx.pollTxHash : ''],
      ['approveTxHash', data.tx && data.tx.approveTxHash ? data.tx.approveTxHash : ''],
      ['marketTxHash', data.tx && data.tx.marketTxHash ? data.tx.marketTxHash : ''],
      ['seedOddsMatch', data.postDeployChecks && data.postDeployChecks.seedOddsMatch !== null ? (data.postDeployChecks.seedOddsMatch ? 'yes' : 'no') : ''],
      ['seedDiffPct', data.postDeployChecks && data.postDeployChecks.diffPct !== null ? data.postDeployChecks.diffPct : ''],
      ['blockedLiveSync', data.postDeployChecks && data.postDeployChecks.blockedLiveSync ? 'yes' : 'no'],
    ],
  );
}

function renderMirrorVerifyTable(data) {
  printTable(
    ['Field', 'Value'],
    [
      ['matchConfidence', data.matchConfidence],
      ['gateOk', data.gateResult && data.gateResult.ok ? 'yes' : 'no'],
      ['failedChecks', data.gateResult && Array.isArray(data.gateResult.failedChecks) ? data.gateResult.failedChecks.join(', ') : ''],
      ['pandoraMarket', data.pandora ? data.pandora.marketAddress : ''],
      ['sourceMarket', data.sourceMarket ? data.sourceMarket.marketId : ''],
      ['ruleHashLeft', data.ruleHashLeft || ''],
      ['ruleHashRight', data.ruleHashRight || ''],
      ['overlapRatio', data.ruleDiffSummary && data.ruleDiffSummary.overlapRatio !== null ? data.ruleDiffSummary.overlapRatio : ''],
    ],
  );
}

function renderMirrorSyncTable(data) {
  printTable(
    ['Field', 'Value'],
    [
      ['mode', data.mode],
      ['executeLive', data.executeLive ? 'yes' : 'no'],
      ['strategyHash', data.strategyHash],
      ['iterationsCompleted', data.iterationsCompleted],
      ['actionCount', data.actionCount],
      ['stateFile', data.stateFile],
      ['stoppedReason', data.stoppedReason || ''],
    ],
  );

  if (!Array.isArray(data.actions) || !data.actions.length) {
    return;
  }

  console.log('');
  printTable(
    ['Mode', 'Status', 'Rebalance', 'Hedge', 'Key'],
    data.actions.map((action) => [
      action.mode || '',
      action.status || '',
      action.rebalance ? `${action.rebalance.side}:${action.rebalance.amountUsdc}` : '',
      action.hedge ? `${short(action.hedge.tokenId, 14)}:${action.hedge.amountUsdc}` : '',
      short(action.idempotencyKey || '', 24),
    ]),
  );
}

function renderMirrorStatusTable(data) {
  const state = data.state || {};
  printTable(
    ['Field', 'Value'],
    [
      ['strategyHash', data.strategyHash || state.strategyHash || ''],
      ['stateFile', data.stateFile || ''],
      ['lastTickAt', state.lastTickAt || ''],
      ['dailySpendUsdc', state.dailySpendUsdc === undefined ? '' : state.dailySpendUsdc],
      ['tradesToday', state.tradesToday === undefined ? '' : state.tradesToday],
      ['currentHedgeUsdc', state.currentHedgeUsdc === undefined ? '' : state.currentHedgeUsdc],
      ['idempotencyKeys', Array.isArray(state.idempotencyKeys) ? state.idempotencyKeys.length : 0],
    ],
  );
}

function renderWebhookTable(data) {
  printTable(
    ['Field', 'Value'],
    [
      ['targets', data.count || 0],
      ['successCount', data.successCount || 0],
      ['failureCount', data.failureCount || 0],
    ],
  );

  if (!Array.isArray(data.results) || !data.results.length) {
    return;
  }

  console.log('');
  printTable(
    ['Target', 'Status', 'Attempt', 'Detail'],
    data.results.map((item) => [
      item.target,
      item.ok ? 'ok' : 'failed',
      item.attempt,
      item.ok ? '' : short(item.error || '', 56),
    ]),
  );
}

function renderLeaderboardTable(data) {
  if (!Array.isArray(data.items) || !data.items.length) {
    console.log('No leaderboard rows found.');
    return;
  }

  printTable(
    ['Rank', 'Address', 'Profit', 'Volume', 'Trades', 'WinRate'],
    data.items.map((item) => [
      item.rank,
      short(item.address, 18),
      formatNumericCell(item.realizedPnl, 4),
      formatNumericCell(item.totalVolume, 4),
      item.totalTrades,
      `${formatNumericCell((item.winRate || 0) * 100, 2)}%`,
    ]),
  );
}

function renderAnalyzeTable(data) {
  const result = data.result || {};
  printTable(
    ['Field', 'Value'],
    [
      ['marketAddress', data.marketAddress || ''],
      ['provider', data.provider || ''],
      ['model', data.model || ''],
      ['marketYesPct', data.market && data.market.yesPct !== undefined ? data.market.yesPct : ''],
      ['fairYesPct', result.fairYesPct !== undefined ? result.fairYesPct : ''],
      ['confidence', result.confidence !== undefined ? result.confidence : ''],
      ['rationale', result.rationale || ''],
    ],
  );
}

function renderSuggestTable(data) {
  printTable(
    ['Field', 'Value'],
    [
      ['wallet', data.wallet || ''],
      ['risk', data.risk || ''],
      ['budget', data.budget],
      ['count', data.count],
    ],
  );

  if (!Array.isArray(data.items) || !data.items.length) {
    return;
  }

  console.log('');
  printTable(
    ['Rank', 'Venue', 'Market', 'Side', 'Amount', 'Edge', 'Confidence'],
    data.items.map((item) => [
      item.rank,
      item.venue || '',
      short(item.marketId, 16),
      item.side || '',
      formatNumericCell(item.amountUsdc, 2),
      `${formatNumericCell(item.expectedEdgePct, 2)}%`,
      formatNumericCell(item.confidenceScore, 3),
    ]),
  );
}

function renderSingleEntityTable(data) {
  printRecord(data.item);
}

function renderMarketsGetTable(data) {
  if (data.item) {
    renderSingleEntityTable(data);
    return;
  }

  if (!Array.isArray(data.items) || !data.items.length) {
    console.log('No markets found.');
    return;
  }

  printTable(
    ['ID', 'Type', 'Chain', 'Poll', 'Close', 'Volume'],
    data.items.map((item) => [
      short(item.id, 18),
      item.marketType || '',
      `${item.chainName || ''} (${item.chainId || ''})`,
      short(item.pollAddress, 18),
      formatTimestamp(item.marketCloseTimestamp),
      item.totalVolume || '',
    ]),
  );

  if (Array.isArray(data.missingIds) && data.missingIds.length) {
    console.log(`Missing IDs: ${data.missingIds.join(', ')}`);
  }
}

function buildGraphqlListQuery(queryName, filterType, fields) {
  return `
query ${queryName}List($where: ${filterType}, $orderBy: String, $orderDirection: String, $before: String, $after: String, $limit: Int) {
  ${queryName}(where: $where, orderBy: $orderBy, orderDirection: $orderDirection, before: $before, after: $after, limit: $limit) {
    items {
      ${fields.join('\n      ')}
    }
    pageInfo {
      hasNextPage
      hasPreviousPage
      startCursor
      endCursor
    }
  }
}
`;
}

function buildGraphqlGetQuery(queryName, fields) {
  return `
query ${queryName}Get($id: String!) {
  ${queryName}(id: $id) {
    ${fields.join('\n    ')}
  }
}
`;
}

async function graphqlRequest(indexerUrl, query, variables, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(indexerUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new CliError('INDEXER_TIMEOUT', `Indexer request timed out after ${timeoutMs}ms.`);
    }
    throw new CliError('INDEXER_REQUEST_FAILED', `Indexer request failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new CliError('INDEXER_HTTP_ERROR', `Indexer returned HTTP ${response.status}.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new CliError('INDEXER_INVALID_JSON', 'Indexer returned a non-JSON response.');
  }

  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new CliError('INDEXER_GRAPHQL_ERROR', 'Indexer GraphQL query failed.', { errors: payload.errors });
  }

  return payload.data || {};
}

function resolveIndexerUrl(explicitUrl) {
  const resolved = explicitUrl || process.env.PANDORA_INDEXER_URL || process.env.INDEXER_URL || DEFAULT_INDEXER_URL;
  if (!isValidHttpUrl(resolved)) {
    throw new CliError('INVALID_INDEXER_URL', `Indexer URL must be a valid http/https URL. Received: "${resolved}"`);
  }
  return resolved;
}

function maybeLoadIndexerEnv(sharedFlags) {
  if (!sharedFlags.useEnvFile) return;

  if (sharedFlags.envFileExplicit) {
    loadEnvFile(sharedFlags.envFile);
    return;
  }

  loadEnvIfPresent(sharedFlags.envFile);
}

function normalizeListVariables(options) {
  return {
    where: options.where,
    orderBy: options.orderBy,
    orderDirection: options.orderDirection,
    before: options.before,
    after: options.after,
    limit: options.limit,
  };
}

function normalizePageResult(rawPage) {
  if (!rawPage || typeof rawPage !== 'object') {
    return { items: [], pageInfo: null };
  }

  const items = Array.isArray(rawPage.items) ? rawPage.items : [];
  const pageInfo = rawPage.pageInfo && typeof rawPage.pageInfo === 'object' ? rawPage.pageInfo : null;
  return { items, pageInfo };
}

function normalizeLookupKey(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return isValidAddress(raw) ? raw.toLowerCase() : raw;
}

function firstMappedValue(map, candidates) {
  if (!(map instanceof Map) || !candidates || !candidates.length) return null;
  for (const candidate of candidates) {
    const key = normalizeLookupKey(candidate);
    if (!key) continue;
    if (map.has(key)) return map.get(key);
  }
  return null;
}

async function fetchPollDetailsMap(indexerUrl, items, timeoutMs) {
  const pollIdSet = new Set();
  for (const item of items) {
    for (const candidate of [item && item.pollAddress, item && item.pollId, item && item.poll && item.poll.id]) {
      const key = normalizeLookupKey(candidate);
      if (key) pollIdSet.add(key);
    }
  }

  if (!pollIdSet.size) {
    return { pollsByKey: new Map(), diagnostic: null };
  }

  const query = buildGraphqlGetQuery('polls', POLLS_LIST_FIELDS);
  const pollsByKey = new Map();
  const failures = [];
  await Promise.all(
    Array.from(pollIdSet).map(async (pollId) => {
      try {
        const data = await graphqlRequest(indexerUrl, query, { id: pollId }, timeoutMs);
        const poll = data.polls;
        if (!poll || typeof poll !== 'object') return;

        const keys = new Set([pollId, poll.id, poll.pollAddress, poll.address, poll.marketAddress]);
        for (const keyCandidate of keys) {
          const key = normalizeLookupKey(keyCandidate);
          if (key) pollsByKey.set(key, poll);
        }
      } catch (err) {
        failures.push(`poll=${pollId}: ${formatErrorValue(err)}`);
      }
    }),
  );

  const diagnostic = failures.length
    ? `Poll expansion fallback degraded for ${failures.length} poll lookup(s).`
    : null;
  return { pollsByKey, diagnostic };
}

async function fetchLiquidityOddsIndex(indexerUrl, options, timeoutMs) {
  const where = {};
  if (options && options.where && options.where.chainId !== undefined) where.chainId = options.where.chainId;
  if (options && options.where && options.where.pollAddress) where.pollAddress = options.where.pollAddress;
  if (options && options.where && options.where.marketAddress) where.marketAddress = options.where.marketAddress;

  const query = buildGraphqlListQuery(
    EVENT_SOURCES.liquidity.listQueryName,
    EVENT_SOURCES.liquidity.filterType,
    LIQUIDITY_EVENT_ODDS_FIELDS,
  );
  const limit = Math.min(Math.max((options && options.limit ? options.limit : 20) * 10, 50), 500);
  const variables = {
    where,
    orderBy: 'timestamp',
    orderDirection: 'desc',
    before: null,
    after: null,
    limit,
  };

  const data = await graphqlRequest(indexerUrl, query, variables, timeoutMs);
  const page = normalizePageResult(data[EVENT_SOURCES.liquidity.listQueryName]);
  const byMarket = new Map();
  const byPoll = new Map();

  for (const event of page.items) {
    const marketKey = normalizeLookupKey(event && event.marketAddress);
    const pollKey = normalizeLookupKey(event && event.pollAddress);
    const snapshot = {
      yesTokenAmount: event && event.yesTokenAmount,
      noTokenAmount: event && event.noTokenAmount,
      timestamp: event && event.timestamp,
      source: 'liquidity-event:latest',
    };
    if (marketKey && !byMarket.has(marketKey)) byMarket.set(marketKey, snapshot);
    if (pollKey && !byPoll.has(pollKey)) byPoll.set(pollKey, snapshot);
  }

  return { byMarket, byPoll };
}

async function buildMarketsEnrichmentContext(indexerUrl, items, options, timeoutMs) {
  const context = {
    pollsByKey: new Map(),
    liquidityOddsByMarket: new Map(),
    liquidityOddsByPoll: new Map(),
    diagnostics: [],
  };

  if (options.expand) {
    try {
      const pollContext = await fetchPollDetailsMap(indexerUrl, items, timeoutMs);
      context.pollsByKey = pollContext.pollsByKey;
      if (pollContext.diagnostic) context.diagnostics.push(pollContext.diagnostic);
    } catch (err) {
      context.diagnostics.push(`Poll expansion unavailable: ${formatErrorValue(err)}`);
    }
  }

  if (options.withOdds) {
    try {
      const oddsContext = await fetchLiquidityOddsIndex(indexerUrl, options, timeoutMs);
      context.liquidityOddsByMarket = oddsContext.byMarket;
      context.liquidityOddsByPoll = oddsContext.byPoll;
    } catch (err) {
      context.diagnostics.push(`Odds enrichment fallback unavailable: ${formatErrorValue(err)}`);
    }
  }

  return context;
}

function buildMarketsPagination(options) {
  return {
    limit: options.limit,
    before: options.before,
    after: options.after,
    orderBy: options.orderBy,
    orderDirection: options.orderDirection,
  };
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function roundNumber(value, decimals = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toDecimalOdds(probability) {
  if (!Number.isFinite(probability) || probability <= 0) return null;
  return roundNumber(1 / probability);
}

function formatOddsPercent(probability) {
  if (!Number.isFinite(probability)) return 'n/a';
  return `${(probability * 100).toFixed(2)}%`;
}

function buildNullOdds(source, diagnostic) {
  return {
    yesPct: null,
    noPct: null,
    yesProbability: null,
    noProbability: null,
    yesPercent: null,
    noPercent: null,
    yesDecimalOdds: null,
    noDecimalOdds: null,
    source: source || null,
    diagnostic: diagnostic || null,
  };
}

function normalizeOddsFromPair(yesRaw, noRaw, source) {
  const yes = toFiniteNumber(yesRaw);
  const no = toFiniteNumber(noRaw);
  if (yes === null && no === null) return null;

  let normalizedYes = yes;
  let normalizedNo = no;

  if (normalizedYes !== null && normalizedYes < 0) {
    return buildNullOdds(source, `Invalid odds input from ${source}: yes outcome is negative.`);
  }
  if (normalizedNo !== null && normalizedNo < 0) {
    return buildNullOdds(source, `Invalid odds input from ${source}: no outcome is negative.`);
  }

  if (normalizedYes === null && normalizedNo !== null && normalizedNo <= 1) {
    normalizedYes = 1 - normalizedNo;
  }
  if (normalizedNo === null && normalizedYes !== null && normalizedYes <= 1) {
    normalizedNo = 1 - normalizedYes;
  }

  if (normalizedYes === null || normalizedNo === null) {
    return buildNullOdds(source, `Unable to compute odds from ${source}: both outcomes are required.`);
  }

  const total = normalizedYes + normalizedNo;
  if (!Number.isFinite(total) || total <= 0) {
    return buildNullOdds(source, `Unable to compute odds from ${source}: sum of outcomes must be > 0.`);
  }

  const yesProbability = roundNumber(normalizedYes / total);
  const noProbability = roundNumber(normalizedNo / total);
  const yesPct = roundNumber(yesProbability * 100, 4);
  const noPct = roundNumber(noProbability * 100, 4);
  return {
    yesPct,
    noPct,
    yesProbability,
    noProbability,
    yesPercent: yesPct,
    noPercent: noPct,
    yesDecimalOdds: toDecimalOdds(yesProbability),
    noDecimalOdds: toDecimalOdds(noProbability),
    source,
    diagnostic: null,
  };
}

function tryOddsFromDirectPair(item, pair) {
  if (!Object.prototype.hasOwnProperty.call(item, pair.yesField) && !Object.prototype.hasOwnProperty.call(item, pair.noField)) {
    return null;
  }
  return normalizeOddsFromPair(item[pair.yesField], item[pair.noField], pair.source);
}

function tryOddsFromReservePair(item, pair) {
  if (!Object.prototype.hasOwnProperty.call(item, pair.yesField) && !Object.prototype.hasOwnProperty.call(item, pair.noField)) {
    return null;
  }

  const yesReserve = toFiniteNumber(item[pair.yesField]);
  const noReserve = toFiniteNumber(item[pair.noField]);
  if (yesReserve === null || noReserve === null) {
    return buildNullOdds(pair.source, `Unable to compute odds from ${pair.source}: reserve values must be numeric.`);
  }

  if (yesReserve < 0 || noReserve < 0) {
    return buildNullOdds(pair.source, `Unable to compute odds from ${pair.source}: reserve values cannot be negative.`);
  }

  if (yesReserve + noReserve <= 0) {
    return buildNullOdds(pair.source, `Unable to compute odds from ${pair.source}: reserve total must be > 0.`);
  }

  const normalized = normalizeOddsFromPair(noReserve, yesReserve, pair.source);
  if (!normalized) {
    return buildNullOdds(pair.source, `Unable to compute odds from ${pair.source}.`);
  }
  return normalized;
}

function findLiquiditySnapshot(item, enrichmentContext) {
  if (!enrichmentContext || typeof enrichmentContext !== 'object') return null;

  const marketSnapshot = firstMappedValue(
    enrichmentContext.liquidityOddsByMarket,
    [item && item.marketAddress, item && item.id],
  );
  if (marketSnapshot) return marketSnapshot;

  return firstMappedValue(
    enrichmentContext.liquidityOddsByPoll,
    [item && item.pollAddress, item && item.pollId, item && item.poll && item.poll.id],
  );
}

function computeMarketOdds(item, enrichmentContext) {
  const diagnostics = [];

  if (item.odds && typeof item.odds === 'object' && !Array.isArray(item.odds)) {
    const embeddedPairs = [
      { yesRaw: item.odds.yesPct, noRaw: item.odds.noPct, source: 'embedded:odds.yesPct/noPct' },
      { yesRaw: item.odds.yesProbability, noRaw: item.odds.noProbability, source: 'embedded:odds.yesProbability/noProbability' },
      { yesRaw: item.odds.yesPrice, noRaw: item.odds.noPrice, source: 'embedded:odds.yesPrice/noPrice' },
    ];
    for (const pair of embeddedPairs) {
      const odds = normalizeOddsFromPair(pair.yesRaw, pair.noRaw, pair.source);
      if (!odds) continue;
      if (!odds.diagnostic) return odds;
      diagnostics.push(odds.diagnostic);
    }
  }

  for (const pair of MARKET_DIRECT_ODDS_FIELDS) {
    const odds = tryOddsFromDirectPair(item, pair);
    if (!odds) continue;
    if (!odds.diagnostic) return odds;
    diagnostics.push(odds.diagnostic);
  }

  for (const pair of MARKET_RESERVE_ODDS_FIELDS) {
    const odds = tryOddsFromReservePair(item, pair);
    if (!odds) continue;
    if (!odds.diagnostic) return odds;
    diagnostics.push(odds.diagnostic);
  }

  const liquiditySnapshot = findLiquiditySnapshot(item, enrichmentContext);
  if (liquiditySnapshot) {
    const liquidityOdds = normalizeOddsFromPair(
      liquiditySnapshot.noTokenAmount,
      liquiditySnapshot.yesTokenAmount,
      liquiditySnapshot.source || 'liquidity-event:latest',
    );
    if (liquidityOdds && !liquidityOdds.diagnostic) {
      return liquidityOdds;
    }
    if (liquidityOdds && liquidityOdds.diagnostic) {
      diagnostics.push(liquidityOdds.diagnostic);
    }
  }

  return buildNullOdds(
    null,
    diagnostics[0] || 'Odds unavailable: market payload is missing supported probability/reserve fields.',
  );
}

function buildPollSnapshot(item, supplementalPoll) {
  const poll = {};
  const supplemental =
    supplementalPoll && typeof supplementalPoll === 'object' && !Array.isArray(supplementalPoll)
      ? supplementalPoll
      : null;
  const existingPoll = item.poll && typeof item.poll === 'object' && !Array.isArray(item.poll) ? item.poll : null;

  if (supplemental) {
    Object.assign(poll, supplemental);
  }

  if (existingPoll) {
    Object.assign(poll, existingPoll);
  }

  if (!Object.prototype.hasOwnProperty.call(poll, 'id')) {
    if (item.pollId !== undefined && item.pollId !== null) {
      poll.id = item.pollId;
    } else if (item.pollAddress !== undefined && item.pollAddress !== null) {
      poll.id = item.pollAddress;
    }
  }

  if (!Object.prototype.hasOwnProperty.call(poll, 'question') && item.question !== undefined) {
    poll.question = item.question;
  }
  if (!Object.prototype.hasOwnProperty.call(poll, 'status') && item.status !== undefined) {
    poll.status = item.status;
  }
  if (!Object.prototype.hasOwnProperty.call(poll, 'category') && item.category !== undefined) {
    poll.category = item.category;
  }
  if (!Object.prototype.hasOwnProperty.call(poll, 'deadlineEpoch') && item.deadlineEpoch !== undefined) {
    poll.deadlineEpoch = item.deadlineEpoch;
  }

  return Object.keys(poll).length ? poll : null;
}

function buildMarketExpansion(item) {
  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  const closeEpoch = toFiniteNumber(item.marketCloseTimestamp);
  const createdEpoch = toFiniteNumber(item.createdAt);

  return {
    closeTimeIso: formatTimestamp(item.marketCloseTimestamp) || null,
    createdAtIso: formatTimestamp(item.createdAt) || null,
    totalVolumeNumeric: toFiniteNumber(item.totalVolume),
    currentTvlNumeric: toFiniteNumber(item.currentTvl),
    isClosed: closeEpoch === null ? null : closeEpoch <= nowEpochSeconds,
    ageSeconds: createdEpoch === null ? null : Math.max(0, nowEpochSeconds - createdEpoch),
  };
}

function enrichMarketItem(item, options, enrichmentContext) {
  const baseItem = item && typeof item === 'object' ? item : { value: item };
  const enriched = { ...baseItem };
  const diagnostics = [];

  if (options.expand) {
    const supplementalPoll = firstMappedValue(
      enrichmentContext && enrichmentContext.pollsByKey,
      [baseItem.pollAddress, baseItem.pollId, baseItem.poll && baseItem.poll.id],
    );
    const poll = buildPollSnapshot(baseItem, supplementalPoll);
    if (poll) {
      enriched.poll = poll;
      if (enriched.question === undefined && poll.question !== undefined) {
        enriched.question = poll.question;
      }
    }
    enriched.expanded = buildMarketExpansion(baseItem);
  }

  if (options.withOdds) {
    const odds = computeMarketOdds(baseItem, enrichmentContext);
    enriched.odds = odds;
    if (odds.diagnostic) diagnostics.push(odds.diagnostic);
  }

  if (
    enrichmentContext &&
    Array.isArray(enrichmentContext.diagnostics) &&
    enrichmentContext.diagnostics.length
  ) {
    diagnostics.push(...enrichmentContext.diagnostics);
  }

  if (diagnostics.length) {
    enriched.diagnostics = Array.from(new Set(diagnostics));
  }

  return enriched;
}

function buildEnrichedMarketItems(items, options, enrichmentContext) {
  return items.map((item) => {
    try {
      return enrichMarketItem(item, options, enrichmentContext);
    } catch (err) {
      const baseItem = item && typeof item === 'object' ? item : { value: item };
      const diagnostic = `Enrichment failed: ${formatErrorValue(err)}`;
      const fallback = { ...baseItem, diagnostics: [diagnostic] };
      if (options.expand) {
        fallback.expanded = buildMarketExpansion(baseItem);
      }
      if (options.withOdds) {
        fallback.odds = buildNullOdds(null, diagnostic);
      }
      return fallback;
    }
  });
}

function buildMarketsListPayload(indexerUrl, options, items, pageInfo, opts = {}) {
  const isScanMode = Boolean(opts.scanMode);
  const enrichmentContext = opts.enrichmentContext || null;
  const filters = { ...(options.where || {}) };
  if (options.lifecycle && options.lifecycle !== 'all') {
    filters.lifecycle = options.lifecycle;
    if (options.lifecycle === 'expiring-soon') {
      filters.expiringHours = options.expiringSoonHours;
    }
  }
  const payload = {
    indexerUrl,
    pagination: buildMarketsPagination(options),
    filters,
    count: items.length,
    pageInfo,
    items,
  };

  if (typeof opts.unfilteredCount === 'number' && opts.unfilteredCount >= items.length && options.lifecycle !== 'all') {
    payload.lifecycle = {
      mode: options.lifecycle,
      expiringHours: options.lifecycle === 'expiring-soon' ? options.expiringSoonHours : null,
      unfilteredCount: opts.unfilteredCount,
      filteredOut: opts.unfilteredCount - items.length,
    };
  }

  const includeEnrichedItems = Boolean(opts.includeEnrichedItems || options.expand || options.withOdds);
  if (includeEnrichedItems) {
    const enrichedItems = buildEnrichedMarketItems(items, options, enrichmentContext);
    payload.enrichment = {
      expand: Boolean(options.expand),
      withOdds: Boolean(options.withOdds),
      oddsUnavailableCount: enrichedItems.filter((entry) => entry && entry.odds && entry.odds.yesProbability === null).length,
    };
    if (
      enrichmentContext &&
      Array.isArray(enrichmentContext.diagnostics) &&
      enrichmentContext.diagnostics.length
    ) {
      payload.enrichment.diagnostics = Array.from(new Set(enrichmentContext.diagnostics));
    }
    payload.enrichedItems = enrichedItems;
    if (isScanMode || options.expand || options.withOdds) {
      if (isScanMode) {
        payload.rawItems = payload.items;
      }
      payload.items = enrichedItems;
    }
  }

  if (isScanMode) {
    payload.generatedAt = new Date().toISOString();
    payload.meta = {
      nonDestructive: true,
      query: {
        filters: payload.filters,
        pagination: payload.pagination,
        expand: Boolean(options.expand),
        withOdds: Boolean(options.withOdds),
      },
    };
  }

  return payload;
}

function applyMarketLifecycleFilter(items, options) {
  if (!Array.isArray(items) || !items.length) return items;
  if (!options || !MARKET_LIFECYCLE_FILTERS.has(options.lifecycle) || options.lifecycle === 'all') {
    return items;
  }

  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  const expiringCutoffEpochSeconds =
    nowEpochSeconds + parsePositiveInteger(options.expiringSoonHours, '--expiring-hours') * 60 * 60;

  return items.filter((item) => {
    const closeEpoch = toFiniteNumber(item && item.marketCloseTimestamp);
    if (!Number.isFinite(closeEpoch)) return false;

    if (options.lifecycle === 'active') {
      return closeEpoch > nowEpochSeconds;
    }
    if (options.lifecycle === 'resolved') {
      return closeEpoch <= nowEpochSeconds;
    }
    if (options.lifecycle === 'expiring-soon') {
      return closeEpoch > nowEpochSeconds && closeEpoch <= expiringCutoffEpochSeconds;
    }
    return true;
  });
}

async function fetchMarketsListPage(indexerUrl, options, timeoutMs) {
  const query = buildGraphqlListQuery('marketss', 'marketsFilter', MARKETS_LIST_FIELDS);
  const data = await graphqlRequest(indexerUrl, query, normalizeListVariables(options), timeoutMs);
  const page = normalizePageResult(data.marketss);
  const items = applyMarketLifecycleFilter(page.items, options);
  return { items, pageInfo: page.pageInfo, unfilteredCount: page.items.length };
}

function maybeLoadTradeEnv(sharedFlags) {
  if (!sharedFlags.useEnvFile) return;

  if (sharedFlags.envFileExplicit) {
    loadEnvFile(sharedFlags.envFile);
    return;
  }

  loadEnvIfPresent(sharedFlags.envFile);
}

function toFixedNumber(value, decimals = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sumNumericField(items, key) {
  let total = 0;
  for (const item of items) {
    const numeric = Number(item && item[key]);
    if (Number.isFinite(numeric)) {
      total += numeric;
    }
  }
  return toFixedNumber(total, 6);
}

function sleepMs(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function getSelectedOutcomeProbabilityPct(quote, side) {
  if (!quote || !quote.odds || typeof quote.odds !== 'object') return null;
  const raw = side === 'yes' ? quote.odds.yesPct : quote.odds.noPct;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function buildTradeRiskGuardConfig(options) {
  return {
    maxAmountUsdc: options.maxAmountUsdc,
    minProbabilityPct: options.minProbabilityPct,
    maxProbabilityPct: options.maxProbabilityPct,
    allowUnquotedExecute: options.allowUnquotedExecute,
  };
}

function enforceTradeRiskGuards(options, quote) {
  if (options.maxAmountUsdc !== null && options.amountUsdc > options.maxAmountUsdc) {
    throw new CliError(
      'TRADE_RISK_GUARD',
      `Trade amount ${options.amountUsdc} exceeds --max-amount-usdc ${options.maxAmountUsdc}.`,
    );
  }

  const selectedProbabilityPct = getSelectedOutcomeProbabilityPct(quote, options.side);
  if (
    (options.minProbabilityPct !== null || options.maxProbabilityPct !== null) &&
    selectedProbabilityPct === null
  ) {
    throw new CliError(
      'TRADE_RISK_GUARD',
      'Probability guardrails require quote odds. Provide --yes-pct or use an indexer with liquidity events.',
    );
  }

  if (options.minProbabilityPct !== null && selectedProbabilityPct < options.minProbabilityPct) {
    throw new CliError(
      'TRADE_RISK_GUARD',
      `Selected-side probability ${selectedProbabilityPct}% is below --min-probability-pct ${options.minProbabilityPct}%.`,
    );
  }

  if (options.maxProbabilityPct !== null && selectedProbabilityPct > options.maxProbabilityPct) {
    throw new CliError(
      'TRADE_RISK_GUARD',
      `Selected-side probability ${selectedProbabilityPct}% is above --max-probability-pct ${options.maxProbabilityPct}%.`,
    );
  }

  if (
    options.execute &&
    !quote.quoteAvailable &&
    options.minSharesOutRaw === null &&
    !options.allowUnquotedExecute
  ) {
    throw new CliError(
      'TRADE_RISK_GUARD',
      'Execute mode requires a quote by default. Provide --yes-pct, or set --min-shares-out-raw, or pass --allow-unquoted-execute.',
    );
  }
}

function buildQuoteEstimate(odds, side, amountUsdc, slippageBps) {
  const probability = side === 'yes' ? odds.yesProbability : odds.noProbability;
  if (!Number.isFinite(probability) || probability <= 0) {
    return null;
  }

  const pricePerShare = probability;
  const estimatedShares = amountUsdc / pricePerShare;
  const slippageFactor = Math.max(0, (10_000 - slippageBps) / 10_000);
  const minSharesOut = estimatedShares * slippageFactor;
  const payoutIfWin = estimatedShares;
  const profitIfWin = payoutIfWin - amountUsdc;

  return {
    impliedProbability: toFixedNumber(probability, 6),
    pricePerShare: toFixedNumber(pricePerShare, 6),
    estimatedShares: toFixedNumber(estimatedShares, 6),
    minSharesOut: toFixedNumber(minSharesOut, 6),
    potentialPayoutIfWin: toFixedNumber(payoutIfWin, 6),
    potentialProfitIfWin: toFixedNumber(profitIfWin, 6),
    slippageBps,
  };
}

async function fetchLatestLiquiditySnapshotForMarket(indexerUrl, marketAddress, timeoutMs) {
  const query = buildGraphqlListQuery(
    EVENT_SOURCES.liquidity.listQueryName,
    EVENT_SOURCES.liquidity.filterType,
    LIQUIDITY_EVENT_ODDS_FIELDS,
  );
  const variables = {
    where: { marketAddress },
    orderBy: 'timestamp',
    orderDirection: 'desc',
    before: null,
    after: null,
    limit: 1,
  };

  const data = await graphqlRequest(indexerUrl, query, variables, timeoutMs);
  const page = normalizePageResult(data[EVENT_SOURCES.liquidity.listQueryName]);
  return page.items.length ? page.items[0] : null;
}

async function resolveQuoteOdds(indexerUrl, options, timeoutMs) {
  if (options.yesPct !== null && options.yesPct !== undefined) {
    const manual = normalizeOddsFromPair(options.yesPct, 100 - options.yesPct, 'manual:yes-pct');
    if (manual) {
      return manual;
    }
  }

  const snapshot = await fetchLatestLiquiditySnapshotForMarket(indexerUrl, options.marketAddress, timeoutMs);
  if (!snapshot) {
    return buildNullOdds(null, 'No liquidity events found for this market. Pass --yes-pct to provide manual odds.');
  }

  const odds = normalizeOddsFromPair(
    snapshot.noTokenAmount,
    snapshot.yesTokenAmount,
    'liquidity-event:latest',
  );
  if (!odds) {
    return buildNullOdds('liquidity-event:latest', 'Liquidity snapshot exists but odds could not be derived.');
  }
  return odds;
}

async function buildQuotePayload(indexerUrl, options, timeoutMs) {
  let odds;
  try {
    odds = await resolveQuoteOdds(indexerUrl, options, timeoutMs);
  } catch (err) {
    odds = buildNullOdds(null, `Unable to fetch odds: ${formatErrorValue(err)}`);
  }
  const estimate = buildQuoteEstimate(odds, options.side, options.amountUsdc, options.slippageBps);

  return {
    generatedAt: new Date().toISOString(),
    indexerUrl,
    marketAddress: options.marketAddress,
    side: options.side,
    amountUsdc: options.amountUsdc,
    slippageBps: options.slippageBps,
    quoteAvailable: Boolean(estimate),
    odds,
    estimate,
  };
}

function resolveTradeRuntimeConfig(options) {
  const chainIdRaw = options.chainId !== null ? options.chainId : Number(process.env.CHAIN_ID || 1);
  if (!Number.isInteger(chainIdRaw) || !SUPPORTED_CHAIN_IDS.has(chainIdRaw)) {
    throw new CliError('INVALID_FLAG_VALUE', `Unsupported --chain-id=${chainIdRaw}. Supported values: 1, 146`);
  }

  const rpcUrl = options.rpcUrl || process.env.RPC_URL || DEFAULT_RPC_BY_CHAIN_ID[chainIdRaw];
  if (!isValidHttpUrl(rpcUrl)) {
    throw new CliError('INVALID_FLAG_VALUE', `RPC URL must be a valid http/https URL. Received: "${rpcUrl}"`);
  }

  const privateKey = options.privateKey || process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey || !isValidPrivateKey(privateKey)) {
    throw new CliError('INVALID_FLAG_VALUE', 'Missing or invalid private key. Set PRIVATE_KEY or pass --private-key.');
  }

  const usdc = options.usdc || String(process.env.USDC || '').trim();
  if (!usdc) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing USDC token address. Set USDC in env or pass --usdc.');
  }
  const usdcAddress = parseAddressFlag(usdc, '--usdc');

  const chain =
    chainIdRaw === 1
      ? {
          id: 1,
          name: 'Ethereum',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
          blockExplorers: { default: { name: 'Etherscan', url: 'https://etherscan.io' } },
        }
      : {
          id: 146,
          name: 'Sonic',
          nativeCurrency: { name: 'Sonic', symbol: 'S', decimals: 18 },
          rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
          blockExplorers: { default: { name: 'SonicScan', url: 'https://sonicscan.org' } },
        };

  return {
    chainId: chainIdRaw,
    chain,
    rpcUrl,
    privateKey,
    usdcAddress,
  };
}

async function loadViemRuntime() {
  const viem = await import('viem');
  const accounts = await import('viem/accounts');
  return { ...viem, ...accounts };
}

async function executeTradeOnchain(options) {
  const runtime = resolveTradeRuntimeConfig(options);
  const {
    createPublicClient,
    createWalletClient,
    http,
    parseUnits,
    privateKeyToAccount,
  } = await loadViemRuntime();

  const account = privateKeyToAccount(runtime.privateKey);
  const publicClient = createPublicClient({ chain: runtime.chain, transport: http(runtime.rpcUrl) });
  const walletClient = createWalletClient({ account, chain: runtime.chain, transport: http(runtime.rpcUrl) });

  const amountRaw = parseUnits(String(options.amountUsdc), 6);
  const minSharesOutRaw = options.minSharesOutRaw === null ? 0n : options.minSharesOutRaw;

  const allowance = await publicClient.readContract({
    address: runtime.usdcAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, options.marketAddress],
  });

  let approveTxHash = null;
  if (allowance < amountRaw) {
    approveTxHash = await walletClient.writeContract({
      address: runtime.usdcAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [options.marketAddress, amountRaw],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
  }

  const buyTxHash = await walletClient.writeContract({
    address: options.marketAddress,
    abi: PARI_MUTUEL_ABI,
    functionName: 'buy',
    args: [options.side === 'yes', amountRaw, minSharesOutRaw],
  });
  await publicClient.waitForTransactionReceipt({ hash: buyTxHash });

  return {
    chainId: runtime.chainId,
    account: account.address,
    usdc: runtime.usdcAddress,
    amountRaw: amountRaw.toString(),
    minSharesOutRaw: minSharesOutRaw.toString(),
    approveTxHash,
    buyTxHash,
  };
}

async function runQuoteCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  if (shared.rest.includes('--help') || shared.rest.includes('-h')) {
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'quote.help', quoteHelpJsonPayload());
    } else {
      printQuoteHelpTable();
    }
    return;
  }
  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
  const options = parseQuoteFlags(shared.rest);
  const payload = await buildQuotePayload(indexerUrl, options, shared.timeoutMs);
  emitSuccess(context.outputMode, 'quote', payload, renderQuoteTable);
}

async function runTradeCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  if (shared.rest.includes('--help') || shared.rest.includes('-h')) {
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'trade.help', tradeHelpJsonPayload());
    } else {
      printTradeHelpTable();
    }
    return;
  }
  maybeLoadTradeEnv(shared);
  const options = parseTradeFlags(shared.rest);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
  const quote = await buildQuotePayload(indexerUrl, options, shared.timeoutMs);
  enforceTradeRiskGuards(options, quote);
  const selectedProbabilityPct = getSelectedOutcomeProbabilityPct(quote, options.side);
  const riskGuards = buildTradeRiskGuardConfig(options);

  if (options.dryRun) {
    const dryRunPayload = {
      mode: 'dry-run',
      generatedAt: new Date().toISOString(),
      status: 'ok',
      marketAddress: options.marketAddress,
      side: options.side,
      amountUsdc: options.amountUsdc,
      minSharesOutRaw: options.minSharesOutRaw === null ? '0' : options.minSharesOutRaw.toString(),
      selectedProbabilityPct,
      riskGuards,
      quote,
      executionPlan: {
        steps: ['check allowance', 'approve USDC if needed', 'buy outcome shares'],
        executeFlagRequired: '--execute',
      },
    };
    emitSuccess(context.outputMode, 'trade', dryRunPayload, renderTradeTable);
    return;
  }

  const execution = await executeTradeOnchain(options);

  const payload = {
    mode: 'execute',
    generatedAt: new Date().toISOString(),
    status: 'submitted',
    chainId: execution.chainId,
    marketAddress: options.marketAddress,
    side: options.side,
    amountUsdc: options.amountUsdc,
    amountRaw: execution.amountRaw,
    minSharesOutRaw: execution.minSharesOutRaw,
    selectedProbabilityPct,
    riskGuards,
    account: execution.account,
    usdc: execution.usdc,
    approveTxHash: execution.approveTxHash,
    buyTxHash: execution.buyTxHash,
    quote,
  };

  emitSuccess(context.outputMode, 'trade', payload, renderTradeTable);
}

async function runMarketsCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);

  const action = shared.rest[0];
  const actionArgs = shared.rest.slice(1);

  if (!action || action === '--help' || action === '-h') {
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'markets.help', commandHelpPayload('pandora [--output table|json] markets list|get ...'));
    } else {
      printMarketsHelpTable();
    }
    return;
  }

  if (action === 'list') {
    if (includesHelpFlag(actionArgs)) {
      if (context.outputMode === 'json') {
        emitSuccess(
          context.outputMode,
          'markets.list.help',
          commandHelpPayload(
            'pandora [--output table|json] markets list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>] [--where-json <json>] [--active|--resolved|--expiring-soon] [--expiring-hours <n>] [--expand] [--with-odds]',
          ),
        );
      } else {
        printMarketsListHelpTable();
      }
      return;
    }

    const options = parseMarketsListFlags(actionArgs);
    const { items, pageInfo, unfilteredCount } = await fetchMarketsListPage(indexerUrl, options, shared.timeoutMs);
    const enrichmentContext =
      options.expand || options.withOdds
        ? await buildMarketsEnrichmentContext(indexerUrl, items, options, shared.timeoutMs)
        : null;
    const payload = buildMarketsListPayload(indexerUrl, options, items, pageInfo, { enrichmentContext, unfilteredCount });
    emitSuccess(context.outputMode, 'markets.list', payload, renderMarketsListTable);
    return;
  }

  if (action === 'get') {
    if (includesHelpFlag(actionArgs)) {
      if (context.outputMode === 'json') {
        emitSuccess(
          context.outputMode,
          'markets.get.help',
          commandHelpPayload('pandora [--output table|json] markets get [--id <id> ...] [--stdin]'),
        );
      } else {
        printMarketsGetHelpTable();
      }
      return;
    }

    const getOptions = parseMarketsGetFlags(actionArgs);
    let ids = [...getOptions.ids];
    if (getOptions.readFromStdin) {
      if (!process.stdin.isTTY || !ids.length) {
        ids = ids.concat(readIdsFromStdin());
      }
    }
    ids = Array.from(
      new Set(
        ids
          .map((id) => String(id).trim())
          .filter(Boolean),
      ),
    );

    if (!ids.length) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing market id. Use --id <id> or --stdin.');
    }

    const query = buildGraphqlGetQuery('markets', MARKETS_LIST_FIELDS);
    const responses = await Promise.all(
      ids.map(async (id) => {
        const data = await graphqlRequest(indexerUrl, query, { id }, shared.timeoutMs);
        return { id, item: data.markets || null };
      }),
    );

    if (ids.length === 1) {
      const item = responses[0].item;
      if (!item) {
        throw new CliError('NOT_FOUND', `Market not found for id: ${ids[0]}`);
      }
      emitSuccess(context.outputMode, 'markets.get', { indexerUrl, item }, renderMarketsGetTable);
      return;
    }

    const items = responses.filter((entry) => entry.item).map((entry) => entry.item);
    const missingIds = responses.filter((entry) => !entry.item).map((entry) => entry.id);
    if (!items.length) {
      throw new CliError('NOT_FOUND', `No markets found for requested ids (${ids.length}).`, { missingIds: ids });
    }

    emitSuccess(
      context.outputMode,
      'markets.get',
      {
        indexerUrl,
        requestedCount: ids.length,
        count: items.length,
        missingIds,
        items,
      },
      renderMarketsGetTable,
    );
    return;
  }

  throw new CliError('INVALID_ARGS', 'markets requires a subcommand: list|get');
}

async function runScanCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);

  const options = parseMarketsListFlags(shared.rest);
  options.expand = true;
  options.withOdds = true;

  const { items, pageInfo, unfilteredCount } = await fetchMarketsListPage(indexerUrl, options, shared.timeoutMs);
  const enrichmentContext = await buildMarketsEnrichmentContext(indexerUrl, items, options, shared.timeoutMs);
  const payload = buildMarketsListPayload(indexerUrl, options, items, pageInfo, {
    includeEnrichedItems: true,
    scanMode: true,
    enrichmentContext,
    unfilteredCount,
  });

  emitSuccess(context.outputMode, 'scan', payload, renderScanTable);
}

async function runPollsCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);

  const action = shared.rest[0];
  const actionArgs = shared.rest.slice(1);

  if (!action || action === '--help' || action === '-h') {
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'polls.help', commandHelpPayload('pandora [--output table|json] polls list|get ...'));
    } else {
      printPollsHelpTable();
    }
    return;
  }

  if (action === 'list') {
    if (includesHelpFlag(actionArgs)) {
      if (context.outputMode === 'json') {
        emitSuccess(
          context.outputMode,
          'polls.list.help',
          commandHelpPayload(
            'pandora [--output table|json] polls list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--status <int>] [--category <int>] [--question-contains <text>] [--where-json <json>]',
          ),
        );
      } else {
        printPollsListHelpTable();
      }
      return;
    }

    const options = parsePollsListFlags(actionArgs);
    const query = buildGraphqlListQuery('pollss', 'pollsFilter', POLLS_LIST_FIELDS);
    const data = await graphqlRequest(indexerUrl, query, normalizeListVariables(options), shared.timeoutMs);
    const { items, pageInfo } = normalizePageResult(data.pollss);

    emitSuccess(context.outputMode, 'polls.list', {
      indexerUrl,
      pagination: {
        limit: options.limit,
        before: options.before,
        after: options.after,
        orderBy: options.orderBy,
        orderDirection: options.orderDirection,
      },
      filters: options.where,
      count: items.length,
      pageInfo,
      items,
    }, renderPollsListTable);
    return;
  }

  if (action === 'get') {
    if (includesHelpFlag(actionArgs)) {
      if (context.outputMode === 'json') {
        emitSuccess(
          context.outputMode,
          'polls.get.help',
          commandHelpPayload('pandora [--output table|json] polls get --id <id>'),
        );
      } else {
        printPollsGetHelpTable();
      }
      return;
    }

    const { id } = parseGetIdFlags(actionArgs, 'polls');
    const query = buildGraphqlGetQuery('polls', POLLS_LIST_FIELDS);
    const data = await graphqlRequest(indexerUrl, query, { id }, shared.timeoutMs);
    const item = data.polls;

    if (!item) {
      throw new CliError('NOT_FOUND', `Poll not found for id: ${id}`);
    }

    emitSuccess(context.outputMode, 'polls.get', { indexerUrl, item }, renderSingleEntityTable);
    return;
  }

  throw new CliError('INVALID_ARGS', 'polls requires a subcommand: list|get');
}

function buildEventWhere(type, options) {
  const where = {};

  if (options.chainId !== null && type !== 'claim') {
    where.chainId = options.chainId;
  }

  if (options.txHash) {
    where.txHash = options.txHash;
  }

  if (type === 'liquidity') {
    if (options.wallet) where.provider = options.wallet;
    if (options.marketAddress) where.marketAddress = options.marketAddress;
    if (options.pollAddress) where.pollAddress = options.pollAddress;
    return where;
  }

  if (type === 'oracle-fee') {
    if (options.wallet) where.to = options.wallet;
    return where;
  }

  if (type === 'claim') {
    if (options.wallet) where.userAddress = options.wallet;
    return where;
  }

  return where;
}

function toEventTimestamp(item) {
  if (item.timestamp !== undefined && item.timestamp !== null) return Number(item.timestamp);
  if (item.blockNumber !== undefined && item.blockNumber !== null) return Number(item.blockNumber);
  return 0;
}

async function fetchEventsByType(indexerUrl, type, options, timeoutMs) {
  const config = EVENT_SOURCES[type];
  if (!config) throw new CliError('INVALID_EVENT_TYPE', `Unknown event type: ${type}`);

  const query = buildGraphqlListQuery(config.listQueryName, config.filterType, config.fields);
  const variables = {
    where: buildEventWhere(type, options),
    orderBy: options.orderBy || (type === 'claim' ? 'blockNumber' : 'timestamp'),
    orderDirection: options.orderDirection,
    before: options.before,
    after: options.after,
    limit: options.limit,
  };

  const data = await graphqlRequest(indexerUrl, query, variables, timeoutMs);
  const key = config.listQueryName;
  const { items, pageInfo } = normalizePageResult(data[key]);

  return {
    items: items.map((item) => ({ ...item, source: type })),
    pageInfo,
  };
}

async function fetchEventByType(indexerUrl, type, id, timeoutMs) {
  const config = EVENT_SOURCES[type];
  if (!config) throw new CliError('INVALID_EVENT_TYPE', `Unknown event type: ${type}`);

  const query = buildGraphqlGetQuery(config.singleQueryName, config.fields);
  const data = await graphqlRequest(indexerUrl, query, { id }, timeoutMs);
  const item = data[config.singleQueryName];
  if (!item) return null;
  return { ...item, source: type };
}

async function runEventsCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);

  const action = shared.rest[0];
  const actionArgs = shared.rest.slice(1);

  if (!action || action === '--help' || action === '-h') {
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'events.help', commandHelpPayload('pandora [--output table|json] events list|get ...'));
    } else {
      printEventsHelpTable();
    }
    return;
  }

  if (action === 'list') {
    if (includesHelpFlag(actionArgs)) {
      if (context.outputMode === 'json') {
        emitSuccess(
          context.outputMode,
          'events.list.help',
          commandHelpPayload(
            'pandora [--output table|json] events list [--type all|liquidity|oracle-fee|claim] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-direction asc|desc] [--chain-id <id>] [--wallet <address>] [--market-address <address>] [--poll-address <address>] [--tx-hash <hash>]',
          ),
        );
      } else {
        printEventsListHelpTable();
      }
      return;
    }

    const options = parseEventsListFlags(actionArgs);
    const types = options.type === 'all' ? ['liquidity', 'oracle-fee', 'claim'] : [options.type];

    const all = [];
    const pageInfoBySource = {};
    for (const type of types) {
      const page = await fetchEventsByType(indexerUrl, type, options, shared.timeoutMs);
      all.push(...page.items);
      pageInfoBySource[type] = page.pageInfo;
    }

    const direction = options.orderDirection === 'asc' ? 1 : -1;
    all.sort((a, b) => (toEventTimestamp(a) - toEventTimestamp(b)) * direction);

    const items = options.type === 'all' ? all.slice(0, options.limit) : all;

    emitSuccess(context.outputMode, 'events.list', {
      indexerUrl,
      filters: {
        type: options.type,
        chainId: options.chainId,
        wallet: options.wallet,
        marketAddress: options.marketAddress,
        pollAddress: options.pollAddress,
        txHash: options.txHash,
      },
      pagination: {
        limit: options.limit,
        before: options.before,
        after: options.after,
        orderDirection: options.orderDirection,
      },
      pageInfoBySource,
      count: items.length,
      items,
    }, renderEventsListTable);
    return;
  }

  if (action === 'get') {
    if (includesHelpFlag(actionArgs)) {
      if (context.outputMode === 'json') {
        emitSuccess(
          context.outputMode,
          'events.get.help',
          commandHelpPayload('pandora [--output table|json] events get --id <id> [--type all|liquidity|oracle-fee|claim]'),
        );
      } else {
        printEventsGetHelpTable();
      }
      return;
    }

    const options = parseEventsGetFlags(actionArgs);
    const types = options.type === 'all' ? ['liquidity', 'oracle-fee', 'claim'] : [options.type];

    let found = null;
    for (const type of types) {
      found = await fetchEventByType(indexerUrl, type, options.id, shared.timeoutMs);
      if (found) break;
    }

    if (!found) {
      throw new CliError('NOT_FOUND', `Event not found for id: ${options.id}`);
    }

    emitSuccess(context.outputMode, 'events.get', { indexerUrl, item: found }, renderSingleEntityTable);
    return;
  }

  throw new CliError('INVALID_ARGS', 'events requires a subcommand: list|get');
}

async function runPositionsCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);

  const action = shared.rest[0];
  const actionArgs = shared.rest.slice(1);

  if (!action || action === '--help' || action === '-h') {
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'positions.help', commandHelpPayload('pandora [--output table|json] positions list ...'));
    } else {
      printPositionsHelpTable();
    }
    return;
  }

  if (action !== 'list') {
    throw new CliError('INVALID_ARGS', 'positions supports only the list subcommand.');
  }

  if (includesHelpFlag(actionArgs)) {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'positions.list.help',
        commandHelpPayload(
          'pandora [--output table|json] positions list [--wallet <address>] [--market-address <address>] [--chain-id <id>] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--where-json <json>]',
        ),
      );
    } else {
      printPositionsHelpTable();
    }
    return;
  }

  const options = parsePositionsListFlags(actionArgs);
  const fields = ['id', 'chainId', 'marketAddress', 'user', 'lastTradeAt'];
  const query = buildGraphqlListQuery('marketUserss', 'marketUsersFilter', fields);
  const data = await graphqlRequest(indexerUrl, query, normalizeListVariables(options), shared.timeoutMs);
  const { items, pageInfo } = normalizePageResult(data.marketUserss);

  emitSuccess(context.outputMode, 'positions.list', {
    indexerUrl,
    wallet: options.wallet,
    pagination: {
      limit: options.limit,
      before: options.before,
      after: options.after,
      orderBy: options.orderBy,
      orderDirection: options.orderDirection,
    },
    filters: options.where,
    count: items.length,
    pageInfo,
    items,
  }, renderPositionsListTable);
}

async function fetchPortfolioPositions(indexerUrl, options, timeoutMs) {
  const where = { user: options.wallet };
  if (options.chainId !== null) {
    where.chainId = options.chainId;
  }

  const query = buildGraphqlListQuery('marketUserss', 'marketUsersFilter', ['id', 'chainId', 'marketAddress', 'user', 'lastTradeAt']);
  const variables = {
    where,
    orderBy: 'lastTradeAt',
    orderDirection: 'desc',
    before: null,
    after: null,
    limit: options.limit,
  };
  const data = await graphqlRequest(indexerUrl, query, variables, timeoutMs);
  return normalizePageResult(data.marketUserss);
}

async function fetchPortfolioLiquidityEvents(indexerUrl, options, timeoutMs) {
  const query = buildGraphqlListQuery(
    EVENT_SOURCES.liquidity.listQueryName,
    EVENT_SOURCES.liquidity.filterType,
    EVENT_SOURCES.liquidity.fields,
  );
  const where = { provider: options.wallet };
  if (options.chainId !== null) {
    where.chainId = options.chainId;
  }
  const variables = {
    where,
    orderBy: 'timestamp',
    orderDirection: 'desc',
    before: null,
    after: null,
    limit: Math.max(options.limit, 50),
  };
  const data = await graphqlRequest(indexerUrl, query, variables, timeoutMs);
  return normalizePageResult(data[EVENT_SOURCES.liquidity.listQueryName]);
}

async function fetchPortfolioClaimEvents(indexerUrl, options, timeoutMs) {
  const query = buildGraphqlListQuery(
    EVENT_SOURCES.claim.listQueryName,
    EVENT_SOURCES.claim.filterType,
    EVENT_SOURCES.claim.fields,
  );
  const variables = {
    where: { userAddress: options.wallet },
    orderBy: 'timestamp',
    orderDirection: 'desc',
    before: null,
    after: null,
    limit: Math.max(options.limit, 50),
  };
  const data = await graphqlRequest(indexerUrl, query, variables, timeoutMs);
  return normalizePageResult(data[EVENT_SOURCES.claim.listQueryName]);
}

async function collectPortfolioSnapshot(indexerUrl, options, timeoutMs) {
  const positionsPage = await fetchPortfolioPositions(indexerUrl, options, timeoutMs);
  let liquidityPage = { items: [] };
  let claimPage = { items: [] };

  if (options.includeEvents) {
    [liquidityPage, claimPage] = await Promise.all([
      fetchPortfolioLiquidityEvents(indexerUrl, options, timeoutMs),
      fetchPortfolioClaimEvents(indexerUrl, options, timeoutMs),
    ]);
  }

  const positions = Array.isArray(positionsPage.items) ? positionsPage.items : [];
  const liquidityEvents = Array.isArray(liquidityPage.items) ? liquidityPage.items : [];
  const claimEvents = Array.isArray(claimPage.items) ? claimPage.items : [];

  return {
    summary: summarizePortfolio(options, positions, liquidityEvents, claimEvents),
    positions,
    events: {
      liquidity: liquidityEvents,
      claims: claimEvents,
    },
  };
}

function summarizePortfolio(options, positions, liquidityEvents, claimEvents) {
  const uniqueMarkets = new Set(
    positions
      .map((item) => normalizeLookupKey(item && item.marketAddress))
      .filter(Boolean),
  ).size;

  let liquidityAdded = 0;
  let liquidityRemoved = 0;
  for (const event of liquidityEvents) {
    const amount = Number(event && event.collateralAmount);
    if (!Number.isFinite(amount)) continue;
    const eventType = String(event && event.eventType ? event.eventType : '')
      .trim()
      .toLowerCase();
    if (eventType.includes('remove') || eventType.includes('withdraw')) {
      liquidityRemoved += amount;
    } else {
      liquidityAdded += amount;
    }
  }
  const netLiquidity = liquidityAdded - liquidityRemoved;
  const claims = sumNumericField(claimEvents, 'amount');
  const cashflowNet = toFixedNumber((liquidityRemoved + claims) - liquidityAdded, 6);

  const diagnostics = [];
  if (!options.includeEvents) {
    diagnostics.push('Event aggregation disabled with --no-events.');
  } else if (!liquidityEvents.length && !claimEvents.length) {
    diagnostics.push('No wallet events found in indexer for this filter set.');
  }
  if (options.chainId !== null && options.includeEvents) {
    diagnostics.push('Claim events are not chain-filtered by indexer schema; values may span chains.');
  }

  return {
    positionCount: positions.length,
    uniqueMarkets,
    liquidityAdded: toFixedNumber(liquidityAdded, 6),
    liquidityRemoved: toFixedNumber(liquidityRemoved, 6),
    netLiquidity: toFixedNumber(netLiquidity, 6),
    claims,
    cashflowNet,
    pnlProxy: cashflowNet,
    eventsIncluded: options.includeEvents,
    diagnostic: diagnostics.join(' '),
  };
}

function toNullableNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function evaluateWatchAlerts(snapshot, options) {
  const alerts = [];

  const yesPct = toNullableNumber(snapshot && snapshot.quote && snapshot.quote.odds && snapshot.quote.odds.yesPct);
  if (options.alertYesBelow !== null && yesPct !== null && yesPct < options.alertYesBelow) {
    alerts.push({
      code: 'YES_BELOW_THRESHOLD',
      metric: 'yesPct',
      comparator: 'lt',
      threshold: options.alertYesBelow,
      value: yesPct,
      message: `YES odds ${yesPct}% are below threshold ${options.alertYesBelow}%.`,
      iteration: snapshot.iteration,
      timestamp: snapshot.timestamp,
    });
  }
  if (options.alertYesAbove !== null && yesPct !== null && yesPct > options.alertYesAbove) {
    alerts.push({
      code: 'YES_ABOVE_THRESHOLD',
      metric: 'yesPct',
      comparator: 'gt',
      threshold: options.alertYesAbove,
      value: yesPct,
      message: `YES odds ${yesPct}% are above threshold ${options.alertYesAbove}%.`,
      iteration: snapshot.iteration,
      timestamp: snapshot.timestamp,
    });
  }

  const netLiquidity = toNullableNumber(snapshot && snapshot.portfolioSummary && snapshot.portfolioSummary.netLiquidity);
  if (
    options.alertNetLiquidityBelow !== null &&
    netLiquidity !== null &&
    netLiquidity < options.alertNetLiquidityBelow
  ) {
    alerts.push({
      code: 'NET_LIQUIDITY_BELOW_THRESHOLD',
      metric: 'netLiquidity',
      comparator: 'lt',
      threshold: options.alertNetLiquidityBelow,
      value: netLiquidity,
      message: `Net liquidity ${netLiquidity} is below threshold ${options.alertNetLiquidityBelow}.`,
      iteration: snapshot.iteration,
      timestamp: snapshot.timestamp,
    });
  }
  if (
    options.alertNetLiquidityAbove !== null &&
    netLiquidity !== null &&
    netLiquidity > options.alertNetLiquidityAbove
  ) {
    alerts.push({
      code: 'NET_LIQUIDITY_ABOVE_THRESHOLD',
      metric: 'netLiquidity',
      comparator: 'gt',
      threshold: options.alertNetLiquidityAbove,
      value: netLiquidity,
      message: `Net liquidity ${netLiquidity} is above threshold ${options.alertNetLiquidityAbove}.`,
      iteration: snapshot.iteration,
      timestamp: snapshot.timestamp,
    });
  }

  return alerts;
}

async function runPortfolioCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  if (shared.rest.includes('--help') || shared.rest.includes('-h')) {
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'portfolio.help', {
        usage:
          'pandora [--output table|json] portfolio --wallet <address> [--chain-id <id>] [--limit <n>] [--include-events|--no-events]',
      });
    } else {
      console.log('Usage: pandora [--output table|json] portfolio --wallet <address> [--chain-id <id>] [--limit <n>] [--include-events|--no-events]');
    }
    return;
  }
  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
  const options = parsePortfolioFlags(shared.rest);
  const snapshot = await collectPortfolioSnapshot(indexerUrl, options, shared.timeoutMs);
  const payload = {
    generatedAt: new Date().toISOString(),
    indexerUrl,
    wallet: options.wallet,
    chainId: options.chainId,
    limit: options.limit,
    summary: snapshot.summary,
    positions: snapshot.positions,
    events: snapshot.events,
  };

  emitSuccess(context.outputMode, 'portfolio', payload, renderPortfolioTable);
}

async function runWatchCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  if (shared.rest.includes('--help') || shared.rest.includes('-h')) {
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'watch.help', watchHelpJsonPayload());
    } else {
      printWatchHelpTable();
    }
    return;
  }

  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
  const options = parseWatchFlags(shared.rest);

  const snapshots = [];
  const alerts = [];
  const webhookReports = [];
  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    const snapshot = {
      iteration,
      timestamp: new Date().toISOString(),
    };

    if (options.wallet) {
      const portfolio = await collectPortfolioSnapshot(indexerUrl, options, shared.timeoutMs);
      snapshot.portfolioSummary = portfolio.summary;
    }

    if (options.marketAddress) {
      const quote = await buildQuotePayload(indexerUrl, {
        marketAddress: options.marketAddress,
        side: options.side,
        amountUsdc: options.amountUsdc,
        yesPct: options.yesPct,
        slippageBps: options.slippageBps,
      }, shared.timeoutMs);
      snapshot.quote = quote;
    }

    snapshot.alerts = evaluateWatchAlerts(snapshot, options);
    snapshot.alertCount = snapshot.alerts.length;
    if (snapshot.alertCount) {
      alerts.push(...snapshot.alerts);
    }

    if (snapshot.alertCount && hasWebhookTargets(options)) {
      const report = await sendWebhookNotifications(options, {
        event: 'watch.alert',
        iteration,
        alertCount: snapshot.alertCount,
        alerts: snapshot.alerts,
        snapshot,
        message: `[Pandora Watch] ${snapshot.alerts[0].message}`,
      });
      webhookReports.push({ iteration, report });
      if (options.failOnWebhookError && report.failureCount > 0) {
        throw new CliError(
          'WEBHOOK_DELIVERY_FAILED',
          `watch webhook delivery failed for iteration ${iteration}.`,
          { iteration, report, snapshot },
          2,
        );
      }
    }

    snapshots.push(snapshot);
    if (iteration < options.iterations) {
      // Keep watch responsive while still supporting deterministic tiny intervals in tests.
      await sleepMs(options.intervalMs);
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    indexerUrl,
    iterationsRequested: options.iterations,
    intervalMs: options.intervalMs,
    count: snapshots.length,
    alertCount: alerts.length,
    parameters: {
      wallet: options.wallet,
      marketAddress: options.marketAddress,
      side: options.side,
      amountUsdc: options.amountUsdc,
      chainId: options.chainId,
      includeEvents: options.includeEvents,
      yesPct: options.yesPct,
      alertYesBelow: options.alertYesBelow,
      alertYesAbove: options.alertYesAbove,
      alertNetLiquidityBelow: options.alertNetLiquidityBelow,
      alertNetLiquidityAbove: options.alertNetLiquidityAbove,
      failOnAlert: options.failOnAlert,
      webhookEnabled: hasWebhookTargets(options),
      failOnWebhookError: options.failOnWebhookError,
    },
    snapshots,
    alerts,
    webhookReports,
  };

  if (options.failOnAlert && alerts.length) {
    throw new CliError(
      'WATCH_ALERT_TRIGGERED',
      `watch detected ${alerts.length} alert(s).`,
      payload,
      2,
    );
  }

  emitSuccess(context.outputMode, 'watch', payload, renderWatchTable);
}

async function runHistoryCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  if (includesHelpFlag(shared.rest)) {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'history.help',
        commandHelpPayload(
          'pandora [--output table|json] history --wallet <address> [--chain-id <id>] [--market-address <address>] [--side yes|no|both] [--status all|open|won|lost|closed] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by timestamp|pnl|entry-price|mark-price] [--order-direction asc|desc] [--include-seed]',
        ),
      );
    } else {
      console.log(
        'Usage: pandora [--output table|json] history --wallet <address> [--chain-id <id>] [--market-address <address>] [--side yes|no|both] [--status all|open|won|lost|closed] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by timestamp|pnl|entry-price|mark-price] [--order-direction asc|desc] [--include-seed]',
      );
    }
    return;
  }

  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
  const options = parseHistoryFlags(shared.rest);
  const payload = await fetchHistory({
    ...options,
    indexerUrl,
    timeoutMs: shared.timeoutMs,
  });

  emitSuccess(context.outputMode, 'history', payload, renderHistoryTable);
}

async function runExportCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  if (includesHelpFlag(shared.rest)) {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'export.help',
        commandHelpPayload(
          'pandora [--output table|json] export --wallet <address> --format csv|json [--chain-id <id>] [--year <yyyy>] [--from <unix>] [--to <unix>] [--out <path>]',
        ),
      );
    } else {
      console.log(
        'Usage: pandora [--output table|json] export --wallet <address> --format csv|json [--chain-id <id>] [--year <yyyy>] [--from <unix>] [--to <unix>] [--out <path>]',
      );
    }
    return;
  }

  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
  const options = parseExportFlags(shared.rest);
  const historyPayload = await fetchHistory({
    wallet: options.wallet,
    chainId: options.chainId,
    marketAddress: null,
    side: 'both',
    status: 'all',
    limit: options.limit,
    after: null,
    before: null,
    orderBy: 'timestamp',
    orderDirection: 'desc',
    includeSeed: true,
    indexerUrl,
    timeoutMs: shared.timeoutMs,
  });
  const payload = buildExportPayload(historyPayload, options);
  emitSuccess(context.outputMode, 'export', payload, renderExportTable);
}

async function runArbitrageCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  if (includesHelpFlag(shared.rest)) {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'arbitrage.help',
        commandHelpPayload(
          'pandora [--output table|json] arbitrage [--chain-id <id>] [--venues pandora,polymarket] [--limit <n>] [--min-spread-pct <n>] [--min-liquidity-usdc <n>] [--max-close-diff-hours <n>] [--similarity-threshold <0-1>] [--cross-venue-only|--allow-same-venue] [--with-rules] [--include-similarity] [--question-contains <text>] [--polymarket-host <url>] [--polymarket-mock-url <url>]',
        ),
      );
    } else {
      console.log(
        'Usage: pandora [--output table|json] arbitrage [--chain-id <id>] [--venues pandora,polymarket] [--limit <n>] [--min-spread-pct <n>] [--min-liquidity-usdc <n>] [--max-close-diff-hours <n>] [--similarity-threshold <0-1>] [--cross-venue-only|--allow-same-venue] [--with-rules] [--include-similarity] [--question-contains <text>] [--polymarket-host <url>] [--polymarket-mock-url <url>]',
      );
    }
    return;
  }

  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
  const options = parseArbitrageFlags(shared.rest);
  const payload = await scanArbitrage({
    ...options,
    indexerUrl,
    timeoutMs: shared.timeoutMs,
  });

  emitSuccess(context.outputMode, 'arbitrage', payload, renderArbitrageTable);
}

async function runAutopilotCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  if (includesHelpFlag(shared.rest)) {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'autopilot.help',
        commandHelpPayload(
          'pandora [--output table|json] autopilot run|once --market-address <address> --side yes|no --amount-usdc <amount> [--trigger-yes-below <0-100>] [--trigger-yes-above <0-100>] [--paper|--execute-live] [--interval-ms <ms>] [--cooldown-ms <ms>] [--max-amount-usdc <amount>] [--max-open-exposure-usdc <amount>] [--max-trades-per-day <n>] [--state-file <path>] [--kill-switch-file <path>] [--webhook-url <url>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>]',
        ),
      );
    } else {
      console.log(
        'Usage: pandora [--output table|json] autopilot run|once --market-address <address> --side yes|no --amount-usdc <amount> [--trigger-yes-below <0-100>] [--trigger-yes-above <0-100>] [--paper|--execute-live] [--interval-ms <ms>] [--cooldown-ms <ms>] [--max-amount-usdc <amount>] [--max-open-exposure-usdc <amount>] [--max-trades-per-day <n>] [--state-file <path>] [--kill-switch-file <path>] [--webhook-url <url>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>]',
      );
    }
    return;
  }

  maybeLoadTradeEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
  const options = parseAutopilotFlags(shared.rest);

  const payload = await runAutopilot(options, {
    quoteFn: (quoteOptions) => buildQuotePayload(indexerUrl, quoteOptions, shared.timeoutMs),
    executeFn: async (executionOptions) => {
      const tradeOptions = {
        marketAddress: executionOptions.marketAddress,
        side: executionOptions.side,
        amountUsdc: executionOptions.amountUsdc,
        yesPct: executionOptions.yesPct,
        slippageBps: options.slippageBps,
        dryRun: false,
        execute: true,
        minSharesOutRaw: null,
        maxAmountUsdc: executionOptions.maxAmountUsdc,
        minProbabilityPct: executionOptions.minProbabilityPct,
        maxProbabilityPct: executionOptions.maxProbabilityPct,
        allowUnquotedExecute: false,
        chainId: null,
        rpcUrl: null,
        privateKey: null,
        usdc: null,
      };
      const quote = await buildQuotePayload(indexerUrl, tradeOptions, shared.timeoutMs);
      enforceTradeRiskGuards(tradeOptions, quote);
      const execution = await executeTradeOnchain(tradeOptions);
      return {
        ...execution,
        quote,
      };
    },
    sendWebhook: async (webhookContext) => {
      if (!hasWebhookTargets(options)) {
        return {
          schemaVersion: null,
          generatedAt: new Date().toISOString(),
          count: 0,
          successCount: 0,
          failureCount: 0,
          results: [],
        };
      }
      const report = await sendWebhookNotifications(options, webhookContext);
      if (options.failOnWebhookError && report.failureCount > 0) {
        throw new CliError('WEBHOOK_DELIVERY_FAILED', 'autopilot webhook delivery failed.', { report });
      }
      return report;
    },
  });

  emitSuccess(context.outputMode, 'autopilot', payload, renderAutopilotTable);
}

async function runMirrorCommand(args, context) {
  const action = args[0];
  const actionArgs = args.slice(1);

  if (!action || action === '--help' || action === '-h') {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'mirror.help',
        commandHelpPayload('pandora [--output table|json] mirror plan|deploy|verify|sync|status ...'),
      );
    } else {
      console.log('Usage: pandora [--output table|json] mirror plan|deploy|verify|sync|status ...');
      console.log('');
      console.log('Subcommands:');
      console.log(
        '  plan   --source polymarket --polymarket-market-id <id>|--polymarket-slug <slug> [--target-slippage-bps <n>] [--turnover-target <n>] [--depth-slippage-bps <n>] [--safety-multiplier <n>] [--min-liquidity-usdc <n>] [--max-liquidity-usdc <n>] [--with-rules] [--include-similarity]',
      );
      console.log(
        '  deploy --plan-file <path>|--polymarket-market-id <id>|--polymarket-slug <slug> --dry-run|--execute [--market-type amm] [--liquidity-usdc <n>] [--fee-tier 500|3000|10000] [--max-imbalance <n>] [--arbiter <address>] [--category <n>] [--allow-rule-mismatch]',
      );
      console.log(
        '  verify --pandora-market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [--include-similarity] [--with-rules]',
      );
      console.log(
        '  sync run|once --pandora-market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [--paper|--execute-live] [--interval-ms <ms>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--max-rebalance-usdc <n>] [--max-hedge-usdc <n>] [--max-open-exposure-usdc <n>] [--max-trades-per-day <n>] [--cooldown-ms <ms>] [--state-file <path>] [--kill-switch-file <path>]',
      );
      console.log('  status --state-file <path>|--strategy-hash <hash>');
    }
    return;
  }

  if (action === 'status') {
    const options = parseMirrorStatusFlags(actionArgs);
    const strategyHashValue = options.strategyHash || null;
    const stateFile =
      options.stateFile ||
      path.join(
        process.env.HOME || process.env.USERPROFILE || '.',
        '.pandora',
        'mirror',
        `${strategyHashValue}.json`,
      );
    const loaded = loadMirrorState(stateFile, strategyHashValue);
    emitSuccess(
      context.outputMode,
      'mirror.status',
      {
        schemaVersion: loaded.state.schemaVersion || '1.0.0',
        generatedAt: new Date().toISOString(),
        stateFile: loaded.filePath,
        strategyHash: loaded.state.strategyHash || strategyHashValue,
        state: loaded.state,
      },
      renderMirrorStatusTable,
    );
    return;
  }

  const shared = parseIndexerSharedFlags(actionArgs);

  if (action === 'plan') {
    if (includesHelpFlag(shared.rest)) {
      if (context.outputMode === 'json') {
        emitSuccess(
          context.outputMode,
          'mirror.plan.help',
          commandHelpPayload(
            'pandora [--output table|json] mirror plan --source polymarket --polymarket-market-id <id>|--polymarket-slug <slug> [--chain-id <id>] [--target-slippage-bps <n>] [--turnover-target <n>] [--depth-slippage-bps <n>] [--safety-multiplier <n>] [--min-liquidity-usdc <n>] [--max-liquidity-usdc <n>] [--with-rules] [--include-similarity]',
          ),
        );
      } else {
        console.log(
          'Usage: pandora [--output table|json] mirror plan --source polymarket --polymarket-market-id <id>|--polymarket-slug <slug> [--chain-id <id>] [--target-slippage-bps <n>] [--turnover-target <n>] [--depth-slippage-bps <n>] [--safety-multiplier <n>] [--min-liquidity-usdc <n>] [--max-liquidity-usdc <n>] [--with-rules] [--include-similarity]',
        );
      }
      return;
    }

    maybeLoadIndexerEnv(shared);
    const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
    const options = parseMirrorPlanFlags(shared.rest);
    const payload = await buildMirrorPlan({
      ...options,
      indexerUrl,
      timeoutMs: shared.timeoutMs,
    });

    emitSuccess(context.outputMode, 'mirror.plan', payload, renderMirrorPlanTable);
    return;
  }

  if (action === 'deploy') {
    if (includesHelpFlag(shared.rest)) {
      if (context.outputMode === 'json') {
        emitSuccess(
          context.outputMode,
          'mirror.deploy.help',
          commandHelpPayload(
            'pandora [--output table|json] mirror deploy --plan-file <path>|--polymarket-market-id <id>|--polymarket-slug <slug> --dry-run|--execute [--market-type amm] [--liquidity-usdc <n>] [--fee-tier 500|3000|10000] [--max-imbalance <n>] [--arbiter <address>] [--category <n>] [--allow-rule-mismatch]',
          ),
        );
      } else {
        console.log(
          'Usage: pandora [--output table|json] mirror deploy --plan-file <path>|--polymarket-market-id <id>|--polymarket-slug <slug> --dry-run|--execute [--market-type amm] [--liquidity-usdc <n>] [--fee-tier 500|3000|10000] [--max-imbalance <n>] [--arbiter <address>] [--category <n>] [--allow-rule-mismatch]',
        );
      }
      return;
    }

    maybeLoadTradeEnv(shared);
    const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
    const options = parseMirrorDeployFlags(shared.rest);
    const payload = await deployMirror({
      ...options,
      indexerUrl,
      timeoutMs: shared.timeoutMs,
      execute: options.execute,
    });

    emitSuccess(context.outputMode, 'mirror.deploy', payload, renderMirrorDeployTable);
    return;
  }

  if (action === 'verify') {
    if (includesHelpFlag(shared.rest)) {
      if (context.outputMode === 'json') {
        emitSuccess(
          context.outputMode,
          'mirror.verify.help',
          commandHelpPayload(
            'pandora [--output table|json] mirror verify --pandora-market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [--include-similarity] [--with-rules]',
          ),
        );
      } else {
        console.log(
          'Usage: pandora [--output table|json] mirror verify --pandora-market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [--include-similarity] [--with-rules]',
        );
      }
      return;
    }

    maybeLoadIndexerEnv(shared);
    const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
    const options = parseMirrorVerifyFlags(shared.rest);
    const payload = await verifyMirror({
      ...options,
      indexerUrl,
      timeoutMs: shared.timeoutMs,
    });

    if (!options.withRules && payload && payload.pandora) {
      delete payload.pandora.rules;
      if (payload.sourceMarket) delete payload.sourceMarket.description;
    }

    emitSuccess(context.outputMode, 'mirror.verify', payload, renderMirrorVerifyTable);
    return;
  }

  if (action === 'sync') {
    if (includesHelpFlag(shared.rest)) {
      if (context.outputMode === 'json') {
        emitSuccess(
          context.outputMode,
          'mirror.sync.help',
          commandHelpPayload(
            'pandora [--output table|json] mirror sync run|once --pandora-market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [--paper|--execute-live] [--interval-ms <ms>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--max-rebalance-usdc <n>] [--max-hedge-usdc <n>] [--max-open-exposure-usdc <n>] [--max-trades-per-day <n>] [--cooldown-ms <ms>] [--state-file <path>] [--kill-switch-file <path>]',
          ),
        );
      } else {
        console.log(
          'Usage: pandora [--output table|json] mirror sync run|once --pandora-market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [--paper|--execute-live] [--interval-ms <ms>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--max-rebalance-usdc <n>] [--max-hedge-usdc <n>] [--max-open-exposure-usdc <n>] [--max-trades-per-day <n>] [--cooldown-ms <ms>] [--state-file <path>] [--kill-switch-file <path>]',
        );
      }
      return;
    }

    maybeLoadTradeEnv(shared);
    const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
    const options = parseMirrorSyncFlags(shared.rest);

    const payload = await runMirrorSync(
      {
        ...options,
        indexerUrl,
        timeoutMs: shared.timeoutMs,
      },
      {
        rebalanceFn: async (executionOptions) => {
          const tradeOptions = {
            marketAddress: executionOptions.marketAddress,
            side: executionOptions.side,
            amountUsdc: executionOptions.amountUsdc,
            yesPct: null,
            slippageBps: 150,
            dryRun: false,
            execute: true,
            minSharesOutRaw: null,
            maxAmountUsdc: executionOptions.amountUsdc,
            minProbabilityPct: null,
            maxProbabilityPct: null,
            allowUnquotedExecute: true,
            chainId: options.chainId,
            rpcUrl: options.rpcUrl,
            privateKey: options.privateKey,
            usdc: options.usdc,
          };
          const quote = await buildQuotePayload(indexerUrl, tradeOptions, shared.timeoutMs);
          const execution = await executeTradeOnchain(tradeOptions);
          return {
            ...execution,
            quote,
          };
        },
        sendWebhook: async (webhookContext) => {
          if (!hasWebhookTargets(options)) {
            return {
              schemaVersion: null,
              generatedAt: new Date().toISOString(),
              count: 0,
              successCount: 0,
              failureCount: 0,
              results: [],
            };
          }
          const report = await sendWebhookNotifications(options, webhookContext);
          if (options.failOnWebhookError && report.failureCount > 0) {
            throw new CliError('WEBHOOK_DELIVERY_FAILED', 'mirror sync webhook delivery failed.', { report });
          }
          return report;
        },
      },
    );

    emitSuccess(context.outputMode, 'mirror.sync', payload, renderMirrorSyncTable);
    return;
  }

  throw new CliError('INVALID_ARGS', 'mirror requires subcommand: plan|deploy|verify|sync|status');
}

async function runWebhookCommand(args, context) {
  const action = args[0];
  const actionArgs = args.slice(1);

  if (!action || action === '--help' || action === '-h') {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'webhook.help',
        commandHelpPayload(
          'pandora [--output table|json] webhook test [--webhook-url <url>] [--webhook-template <json>] [--webhook-secret <secret>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>] [--webhook-timeout-ms <ms>] [--webhook-retries <n>]',
        ),
      );
    } else {
      console.log(
        'Usage: pandora [--output table|json] webhook test [--webhook-url <url>] [--webhook-template <json>] [--webhook-secret <secret>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>] [--webhook-timeout-ms <ms>] [--webhook-retries <n>]',
      );
    }
    return;
  }

  if (action !== 'test') {
    throw new CliError('INVALID_ARGS', 'webhook requires subcommand: test');
  }

  const options = parseWebhookTestFlags(actionArgs);
  const payload = await sendWebhookNotifications(options, {
    event: 'webhook.test',
    message: '[Pandora CLI] Webhook test',
    generatedAt: new Date().toISOString(),
  });

  if (options.failOnWebhookError && payload.failureCount > 0) {
    throw new CliError('WEBHOOK_DELIVERY_FAILED', 'Webhook test delivery failed.', payload, 2);
  }

  emitSuccess(context.outputMode, 'webhook.test', payload, renderWebhookTable);
}

async function runLeaderboardCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  if (includesHelpFlag(shared.rest)) {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'leaderboard.help',
        commandHelpPayload(
          'pandora [--output table|json] leaderboard [--metric profit|volume|win-rate] [--chain-id <id>] [--limit <n>] [--min-trades <n>]',
        ),
      );
    } else {
      console.log(
        'Usage: pandora [--output table|json] leaderboard [--metric profit|volume|win-rate] [--chain-id <id>] [--limit <n>] [--min-trades <n>]',
      );
    }
    return;
  }

  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
  const options = parseLeaderboardFlags(shared.rest);
  const payload = await fetchLeaderboard({
    ...options,
    indexerUrl,
    timeoutMs: shared.timeoutMs,
  });
  emitSuccess(context.outputMode, 'leaderboard', payload, renderLeaderboardTable);
}

async function buildAnalyzeContext(indexerUrl, marketAddress, timeoutMs) {
  const marketQuery = buildGraphqlGetQuery('markets', MARKETS_LIST_FIELDS);
  const marketData = await graphqlRequest(indexerUrl, marketQuery, { id: marketAddress }, timeoutMs);
  const market = marketData.markets;
  if (!market) {
    throw new CliError('NOT_FOUND', `Market not found for id: ${marketAddress}`);
  }

  let poll = null;
  if (market.pollAddress) {
    const pollQuery = buildGraphqlGetQuery('polls', POLLS_LIST_FIELDS);
    const pollData = await graphqlRequest(indexerUrl, pollQuery, { id: market.pollAddress }, timeoutMs);
    poll = pollData.polls || null;
  }

  const quote = await buildQuotePayload(
    indexerUrl,
    {
      marketAddress,
      side: 'yes',
      amountUsdc: 1,
      yesPct: null,
      slippageBps: 100,
    },
    timeoutMs,
  );

  return {
    market: {
      id: market.id,
      marketAddress: market.id,
      chainId: market.chainId,
      marketType: market.marketType,
      closeTimestamp: market.marketCloseTimestamp,
      totalVolume: market.totalVolume,
      currentTvl: market.currentTvl,
      question: poll && poll.question ? poll.question : null,
      yesPct: quote && quote.odds ? quote.odds.yesPct : null,
      noPct: quote && quote.odds ? quote.odds.noPct : null,
    },
    poll,
    quote,
  };
}

async function runAnalyzeCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  if (includesHelpFlag(shared.rest)) {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'analyze.help',
        commandHelpPayload(
          'pandora [--output table|json] analyze --market-address <address> [--provider <name>] [--model <id>] [--max-cost-usd <n>] [--temperature <n>] [--timeout-ms <ms>]',
        ),
      );
    } else {
      console.log(
        'Usage: pandora [--output table|json] analyze --market-address <address> [--provider <name>] [--model <id>] [--max-cost-usd <n>] [--temperature <n>] [--timeout-ms <ms>]',
      );
    }
    return;
  }

  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
  const options = parseAnalyzeFlags(shared.rest);
  const contextPayload = await buildAnalyzeContext(indexerUrl, options.marketAddress, Math.min(shared.timeoutMs, options.timeoutMs));

  let analysis;
  try {
    analysis = await evaluateMarket(contextPayload, options);
  } catch (err) {
    if (err instanceof AnalyzeProviderError) {
      throw new CliError(err.code || 'ANALYZE_PROVIDER_ERROR', err.message, err.details);
    }
    throw err;
  }

  const payload = {
    schemaVersion: analysis.schemaVersion,
    generatedAt: new Date().toISOString(),
    indexerUrl,
    marketAddress: options.marketAddress,
    provider: analysis.provider,
    model: analysis.model,
    market: contextPayload.market,
    quote: contextPayload.quote,
    result: analysis.result,
  };
  emitSuccess(context.outputMode, 'analyze', payload, renderAnalyzeTable);
}

async function runSuggestCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  if (includesHelpFlag(shared.rest)) {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'suggest.help',
        commandHelpPayload(
          'pandora [--output table|json] suggest --wallet <address> --risk low|medium|high --budget <amount> [--count <n>] [--include-venues pandora,polymarket]',
        ),
      );
    } else {
      console.log(
        'Usage: pandora [--output table|json] suggest --wallet <address> --risk low|medium|high --budget <amount> [--count <n>] [--include-venues pandora,polymarket]',
      );
    }
    return;
  }

  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
  const options = parseSuggestFlags(shared.rest);
  const history = await fetchHistory({
    wallet: options.wallet,
    chainId: null,
    marketAddress: null,
    side: 'both',
    status: 'all',
    limit: 250,
    after: null,
    before: null,
    orderBy: 'timestamp',
    orderDirection: 'desc',
    includeSeed: false,
    indexerUrl,
    timeoutMs: shared.timeoutMs,
  });
  const arbitrage = await scanArbitrage({
    indexerUrl,
    timeoutMs: shared.timeoutMs,
    chainId: null,
    venues: options.includeVenues,
    limit: Math.max(options.count * 3, 10),
    minSpreadPct: 3,
    minLiquidityUsd: 1000,
    maxCloseDiffHours: 24,
    similarityThreshold: 0.86,
    crossVenueOnly: true,
    withRules: false,
    includeSimilarity: false,
    questionContains: null,
    polymarketHost: null,
    polymarketMockUrl: null,
  });

  const suggestions = buildSuggestions({
    wallet: options.wallet,
    risk: options.risk,
    budget: options.budget,
    count: options.count,
    arbitrageOpportunities: arbitrage.opportunities,
    historySummary: history.summary,
  });
  const payload = {
    ...suggestions,
    indexerUrl,
    includeVenues: options.includeVenues,
    historySummary: history.summary,
    arbitrageCount: arbitrage.count,
  };
  emitSuccess(context.outputMode, 'suggest', payload, renderSuggestTable);
}

function runResolveCommand(args, context) {
  if (includesHelpFlag(args)) {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'resolve.help',
        commandHelpPayload(
          'pandora [--output table|json] resolve --poll-address <address> --answer yes|no|invalid --reason <text> --dry-run|--execute',
        ),
      );
    } else {
      console.log(
        'Usage: pandora [--output table|json] resolve --poll-address <address> --answer yes|no|invalid --reason <text> --dry-run|--execute',
      );
    }
    return;
  }
  parseResolveFlags(args);
  throw new CliError(
    'ABI_READY_REQUIRED',
    'resolve is ABI-gated and not available yet. Commit verified ABI signatures/events and tests first.',
    { command: 'resolve' },
  );
}

function runLpCommand(args, context) {
  if (includesHelpFlag(args)) {
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'lp.help', commandHelpPayload('pandora [--output table|json] lp add|remove|positions ...'));
    } else {
      console.log(
        'Usage: pandora [--output table|json] lp add|remove|positions ...',
      );
    }
    return;
  }
  parseLpFlags(args);
  throw new CliError(
    'ABI_READY_REQUIRED',
    'lp is ABI-gated and not available yet. Commit verified ABI signatures/events and tests first.',
    { command: 'lp' },
  );
}

function runInitEnv(args, outputMode) {
  const options = parseInitEnvFlags(args);

  if (!fs.existsSync(options.exampleFile)) {
    throw new CliError('EXAMPLE_FILE_NOT_FOUND', `Example env file not found: ${options.exampleFile}`);
  }

  if (fs.existsSync(options.envFile) && !options.force) {
    throw new CliError('ENV_FILE_EXISTS', `Env file already exists: ${options.envFile}. Use --force to overwrite.`);
  }

  fs.mkdirSync(path.dirname(options.envFile), { recursive: true });
  fs.copyFileSync(options.exampleFile, options.envFile);

  emitSuccess(outputMode, 'init-env', {
    envFile: options.envFile,
    exampleFile: options.exampleFile,
    overwritten: options.force,
  }, (data) => {
    console.log(`Wrote env file: ${data.envFile}`);
  });
}

function runScriptCommand(command, args) {
  const targetScript = COMMAND_TARGETS[command];
  const { envFile, useEnvFile, passthrough } = parseScriptEnvFlags(args);
  const helpOnly = passthrough.includes('--help') || passthrough.includes('-h');

  if (useEnvFile && !helpOnly) {
    try {
      loadEnvFile(envFile);
    } catch (err) {
      if (err instanceof CliError) {
        throw new CliError('ENV_FILE_NOT_FOUND', err.message, {
          hints: ['Run `pandora init-env` first, or pass --skip-dotenv.'],
        });
      }
      throw err;
    }
  }

  runTargetScript(targetScript, passthrough);
}

async function runDoctor(args, outputMode) {
  const options = parseDoctorFlags(args);
  const report = await buildDoctorReport(options);

  if (!report.summary.ok) {
    if (outputMode === 'table') {
      renderDoctorReportTable(report);
    }

    throw new CliError('DOCTOR_FAILED', 'Doctor checks failed.', {
      report,
      errors: report.summary.failures,
    });
  }

  emitSuccess(outputMode, 'doctor', report, renderDoctorReportTable);
}

async function runSetup(args, outputMode) {
  const options = parseSetupFlags(args);

  if (!fs.existsSync(options.exampleFile)) {
    throw new CliError('EXAMPLE_FILE_NOT_FOUND', `Example env file not found: ${options.exampleFile}`);
  }

  let envStep;
  if (fs.existsSync(options.envFile) && !options.force) {
    envStep = {
      status: 'skipped',
      message: `Env file exists at ${options.envFile}. Reusing existing file.`,
      envFile: options.envFile,
      force: false,
    };
  } else {
    fs.mkdirSync(path.dirname(options.envFile), { recursive: true });
    fs.copyFileSync(options.exampleFile, options.envFile);
    envStep = {
      status: 'written',
      message: `Wrote env file: ${options.envFile}`,
      envFile: options.envFile,
      force: options.force,
    };
  }

  const doctor = await buildDoctorReport({
    envFile: options.envFile,
    useEnvFile: true,
    checkUsdcCode: options.checkUsdcCode,
    rpcTimeoutMs: options.rpcTimeoutMs,
  });

  const payload = {
    envStep,
    doctor,
  };

  if (!doctor.summary.ok) {
    if (outputMode === 'table') {
      renderSetupTable(payload);
    }

    throw new CliError('SETUP_FAILED', 'Setup completed with issues. Resolve doctor failures and rerun setup.', {
      setup: payload,
      errors: doctor.summary.failures,
    });
  }

  emitSuccess(outputMode, 'setup', payload, renderSetupTable);
}

async function dispatch(command, args, context) {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'help', helpJsonPayload());
    } else {
      printHelpTable();
    }
    return;
  }

  if (command === 'init-env') {
    runInitEnv(args, context.outputMode);
    return;
  }

  if (command === 'doctor') {
    await runDoctor(args, context.outputMode);
    return;
  }

  if (command === 'setup') {
    await runSetup(args, context.outputMode);
    return;
  }

  if (command === 'markets') {
    await runMarketsCommand(args, context);
    return;
  }

  if (command === 'scan') {
    await runScanCommand(args, context);
    return;
  }

  if (command === 'quote') {
    await runQuoteCommand(args, context);
    return;
  }

  if (command === 'trade') {
    await runTradeCommand(args, context);
    return;
  }

  if (command === 'polls') {
    await runPollsCommand(args, context);
    return;
  }

  if (command === 'events') {
    await runEventsCommand(args, context);
    return;
  }

  if (command === 'positions') {
    await runPositionsCommand(args, context);
    return;
  }

  if (command === 'portfolio') {
    await runPortfolioCommand(args, context);
    return;
  }

  if (command === 'watch') {
    await runWatchCommand(args, context);
    return;
  }

  if (command === 'history') {
    await runHistoryCommand(args, context);
    return;
  }

  if (command === 'export') {
    await runExportCommand(args, context);
    return;
  }

  if (command === 'arbitrage') {
    await runArbitrageCommand(args, context);
    return;
  }

  if (command === 'autopilot') {
    await runAutopilotCommand(args, context);
    return;
  }

  if (command === 'mirror') {
    await runMirrorCommand(args, context);
    return;
  }

  if (command === 'webhook') {
    await runWebhookCommand(args, context);
    return;
  }

  if (command === 'leaderboard') {
    await runLeaderboardCommand(args, context);
    return;
  }

  if (command === 'analyze') {
    await runAnalyzeCommand(args, context);
    return;
  }

  if (command === 'suggest') {
    await runSuggestCommand(args, context);
    return;
  }

  if (command === 'resolve') {
    runResolveCommand(args, context);
    return;
  }

  if (command === 'lp') {
    runLpCommand(args, context);
    return;
  }

  if (command === 'launch' || command === 'clone-bet') {
    if (context.outputMode === 'json') {
      throw new CliError(
        'UNSUPPORTED_OUTPUT_MODE',
        '--output json is not supported for launch/clone-bet because these commands stream script output directly.',
      );
    }
    runScriptCommand(command, args);
    return;
  }

  throw new CliError('UNKNOWN_COMMAND', `Unknown command: ${command}`, {
    hints: ['Run `pandora help` to see available commands.'],
  });
}

async function main() {
  const rawArgv = process.argv.slice(2);
  let outputMode = inferRequestedOutputMode(rawArgv);
  let args = rawArgv;

  try {
    const parsed = extractOutputMode(rawArgv);
    outputMode = parsed.outputMode;
    args = parsed.args;
  } catch (err) {
    emitFailure(outputMode, err);
    return;
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  try {
    await dispatch(command, commandArgs, { outputMode });
  } catch (err) {
    emitFailure(outputMode, err);
  }
}

main();
