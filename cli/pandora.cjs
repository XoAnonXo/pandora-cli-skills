#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createCommandRouter } = require('./lib/command_router.cjs');
const { createCliOutputService } = require('./lib/cli_output_service.cjs');
const { createErrorRecoveryService } = require('./lib/error_recovery_service.cjs');
const { createRunScanCommand } = require('./lib/scan_command_service.cjs');
const { createRunMirrorCommand } = require('./lib/mirror_command_service.cjs');
const { createParseTradeFlags } = require('./lib/parsers/trade_flags.cjs');
const { createParseWatchFlags } = require('./lib/parsers/watch_flags.cjs');
const { createParseAutopilotFlags } = require('./lib/parsers/autopilot_flags.cjs');
const { createParseMirrorPlanFlags } = require('./lib/parsers/mirror_plan_flags.cjs');
const { createParseMirrorHedgeCalcFlags } = require('./lib/parsers/mirror_hedge_calc_flags.cjs');
const { createParseMirrorDeployFlags } = require('./lib/parsers/mirror_deploy_flags.cjs');
const { createParseMirrorGoFlags } = require('./lib/parsers/mirror_go_flags.cjs');
const {
  createParseMirrorSyncFlags,
  createParseMirrorSyncDaemonSelectorFlags,
} = require('./lib/parsers/mirror_sync_flags.cjs');
const {
  createParseMirrorBrowseFlags,
  createParseMirrorVerifyFlags,
  createParseMirrorStatusFlags,
  createParseMirrorCloseFlags,
  createParseMirrorLpExplainFlags,
  createParseMirrorSimulateFlags,
} = require('./lib/parsers/mirror_remaining_flags.cjs');
const {
  createParsePolymarketSharedFlags,
  createParsePolymarketApproveFlags,
  createParsePolymarketTradeFlags,
} = require('./lib/parsers/polymarket_flags.cjs');
const { createParseResolveFlags } = require('./lib/parsers/resolve_flags.cjs');
const { createParseLpFlags } = require('./lib/parsers/lp_flags.cjs');
const { createParseLifecycleFlags } = require('./lib/parsers/lifecycle_flags.cjs');
const { createParseSportsFlags } = require('./lib/parsers/sports_flags.cjs');
const { createParseOddsFlags } = require('./lib/parsers/odds_flags.cjs');
const { createParseRiskShowFlags, createParseRiskPanicFlags } = require('./lib/parsers/risk_flags.cjs');
const { createCoreCommandFlagParsers } = require('./lib/parsers/core_command_flags.cjs');
const { createRunTradeCommand } = require('./lib/trade_command_service.cjs');
const { createRunWatchCommand } = require('./lib/watch_command_service.cjs');
const { createRunPolymarketCommand } = require('./lib/polymarket_command_service.cjs');
const { createRunResolveCommand } = require('./lib/resolve_command_service.cjs');
const { createRunLpCommand } = require('./lib/lp_command_service.cjs');
const { createRunLifecycleCommand } = require('./lib/lifecycle_command_service.cjs');
const { createRunArbCommand } = require('./lib/arb_command_service.cjs');
const { createRunSportsCommand } = require('./lib/sports_command_service.cjs');
const { createRunRiskCommand } = require('./lib/risk_command_service.cjs');
const {
  DEFAULT_INDEXER_URL: SHARED_DEFAULT_INDEXER_URL,
  DEFAULT_RPC_BY_CHAIN_ID,
} = require('./lib/shared/constants.cjs');
const { createParsePrimitives } = require('./lib/shared/parse_primitives.cjs');
const { round, sleepMs, toOptionalNumber, isSecureHttpUrlOrLocal } = require('./lib/shared/utils.cjs');

/**
 * Lazily loads and memoizes CommonJS modules on first use.
 * @param {string} modulePath
 * @returns {() => any}
 */
function createLazyModuleLoader(modulePath) {
  let cached = null;
  return function getModule() {
    if (!cached) {
      cached = require(modulePath);
    }
    return cached;
  };
}

const getHistoryService = createLazyModuleLoader('./lib/history_service.cjs');
const getExportService = createLazyModuleLoader('./lib/export_service.cjs');
const getArbitrageService = createLazyModuleLoader('./lib/arbitrage_service.cjs');
const getAutopilotService = createLazyModuleLoader('./lib/autopilot_service.cjs');
const getWebhookService = createLazyModuleLoader('./lib/webhook_service.cjs');
const getLeaderboardService = createLazyModuleLoader('./lib/leaderboard_service.cjs');
const getAnalyzeProviderService = createLazyModuleLoader('./lib/analyze_provider.cjs');
const getSuggestService = createLazyModuleLoader('./lib/suggest_service.cjs');
const getMirrorService = createLazyModuleLoader('./lib/mirror_service.cjs');
const getMirrorSyncService = createLazyModuleLoader('./lib/mirror_sync_service.cjs');
const getMirrorEconService = createLazyModuleLoader('./lib/mirror_econ_service.cjs');
const getMirrorDaemonService = createLazyModuleLoader('./lib/mirror_daemon_service.cjs');
const getMirrorCloseService = createLazyModuleLoader('./lib/mirror_close_service.cjs');
const getPolymarketTradeAdapter = createLazyModuleLoader('./lib/polymarket_trade_adapter.cjs');
const getPolymarketOpsService = createLazyModuleLoader('./lib/polymarket_ops_service.cjs');
const getMarketAdminService = createLazyModuleLoader('./lib/market_admin_service.cjs');
const getContractErrorDecoder = createLazyModuleLoader('./lib/contract_error_decoder.cjs');
const getMirrorManifestStore = createLazyModuleLoader('./lib/mirror_manifest_store.cjs');
const getAutopilotStateStore = createLazyModuleLoader('./lib/autopilot_state_store.cjs');
const getMirrorStateStore = createLazyModuleLoader('./lib/mirror_state_store.cjs');
const getRiskStateStore = createLazyModuleLoader('./lib/risk_state_store.cjs');
const getRiskGuardService = createLazyModuleLoader('./lib/risk_guard_service.cjs');
const getSchemaCommandService = createLazyModuleLoader('./lib/schema_command_service.cjs');
const getMcpServerService = createLazyModuleLoader('./lib/mcp_server_service.cjs');
const getStreamCommandService = createLazyModuleLoader('./lib/stream_command_service.cjs');
const getForkRuntimeService = createLazyModuleLoader('./lib/fork_runtime_service.cjs');
const getDoctorService = createLazyModuleLoader('./lib/doctor_service.cjs');
const getSportsProviderRegistry = createLazyModuleLoader('./lib/sports_provider_registry.cjs');
const getSportsConsensusService = createLazyModuleLoader('./lib/sports_consensus_service.cjs');
const getSportsTimingService = createLazyModuleLoader('./lib/sports_timing_service.cjs');
const getSportsSyncService = createLazyModuleLoader('./lib/sports_sync_service.cjs');
const getSportsResolvePlanService = createLazyModuleLoader('./lib/sports_resolve_plan_service.cjs');
const getSportsCreationService = createLazyModuleLoader('./lib/sports_creation_service.cjs');
const getPandoraDeployService = createLazyModuleLoader('./lib/pandora_deploy_service.cjs');
const getVenueConnectorFactoryService = createLazyModuleLoader('./lib/venue_connector_factory.cjs');
const getOddsHistoryService = createLazyModuleLoader('./lib/odds_history_service.cjs');

/** Proxy to history service fetch. */
function fetchHistory(...args) {
  return getHistoryService().fetchHistory(...args);
}

/** Proxy to export payload builder. */
function buildExportPayload(...args) {
  return getExportService().buildExportPayload(...args);
}

/** Proxy to arbitrage scanner. */
function scanArbitrage(...args) {
  return getArbitrageService().scanArbitrage(...args);
}

/** Proxy to autopilot runner. */
function runAutopilot(...args) {
  return getAutopilotService().runAutopilot(...args);
}

/** Proxy to webhook target detector. */
function hasWebhookTargets(...args) {
  return getWebhookService().hasWebhookTargets(...args);
}

/** Proxy to webhook dispatcher. */
function sendWebhookNotifications(...args) {
  return getWebhookService().sendWebhookNotifications(...args);
}

/** Proxy to leaderboard fetcher. */
function fetchLeaderboard(...args) {
  return getLeaderboardService().fetchLeaderboard(...args);
}

/** Proxy to analysis provider evaluator. */
function evaluateMarket(...args) {
  return getAnalyzeProviderService().evaluateMarket(...args);
}

/** Runtime type guard for provider-specific analyze errors. */
function isAnalyzeProviderError(err) {
  const { AnalyzeProviderError } = getAnalyzeProviderService();
  return Boolean(AnalyzeProviderError && err instanceof AnalyzeProviderError);
}

/** Proxy to suggestion engine. */
function buildSuggestions(...args) {
  return getSuggestService().buildSuggestions(...args);
}

/** Proxy to mirror plan builder. */
function buildMirrorPlan(...args) {
  return getMirrorService().buildMirrorPlan(...args);
}

/** Proxy to mirror deploy executor. */
function deployMirror(...args) {
  return getMirrorService().deployMirror(...args);
}

/** Proxy to mirror verifier. */
function verifyMirror(...args) {
  return getMirrorService().verifyMirror(...args);
}

/** Proxy to mirror market browser. */
function browseMirrorMarkets(...args) {
  return getMirrorService().browseMirrorMarkets(...args);
}

/** Proxy to mirror sync runner. */
function runMirrorSync(...args) {
  return getMirrorSyncService().runMirrorSync(...args);
}

/** Returns supported mirror sync gate codes from service constants. */
function getMirrorSyncGateCodes() {
  const { MIRROR_SYNC_GATE_CODES } = getMirrorSyncService();
  return Array.isArray(MIRROR_SYNC_GATE_CODES) ? MIRROR_SYNC_GATE_CODES : [];
}

/** Proxy to LP explanation builder. */
function buildMirrorLpExplain(...args) {
  return getMirrorEconService().buildMirrorLpExplain(...args);
}

/** Proxy to hedge calculator. */
function buildMirrorHedgeCalc(...args) {
  return getMirrorEconService().buildMirrorHedgeCalc(...args);
}

/** Proxy to mirror simulation builder. */
function buildMirrorSimulate(...args) {
  return getMirrorEconService().buildMirrorSimulate(...args);
}

/** Proxy to mirror daemon starter. */
function startMirrorDaemon(...args) {
  return getMirrorDaemonService().startDaemon(...args);
}

/** Proxy to mirror daemon stop routine. */
function stopMirrorDaemon(...args) {
  return getMirrorDaemonService().stopDaemon(...args);
}

/** Proxy to mirror daemon status reader. */
function mirrorDaemonStatus(...args) {
  return getMirrorDaemonService().daemonStatus(...args);
}

/** Proxy to mirror close plan builder. */
function buildMirrorClosePlan(...args) {
  return getMirrorCloseService().buildMirrorClosePlan(...args);
}

/** Proxy to Polymarket position summary fetcher. */
function fetchPolymarketPositionSummary(...args) {
  return getPolymarketTradeAdapter().fetchPolymarketPositionSummary(...args);
}

/** Proxy to Polymarket market resolver. */
function resolvePolymarketMarket(...args) {
  return getPolymarketTradeAdapter().resolvePolymarketMarket(...args);
}

/** Proxy to Polymarket hedge order placer. */
function placeHedgeOrder(...args) {
  return getPolymarketTradeAdapter().placeHedgeOrder(...args);
}

/** Proxy to Polymarket credential loader. */
function readTradingCredsFromEnv(...args) {
  return getPolymarketTradeAdapter().readTradingCredsFromEnv(...args);
}

/** Proxy to Polymarket readiness check. */
function runPolymarketCheck(...args) {
  return getPolymarketOpsService().runPolymarketCheck(...args);
}

/** Proxy to Polymarket approval flow. */
function runPolymarketApprove(...args) {
  return getPolymarketOpsService().runPolymarketApprove(...args);
}

/** Proxy to Polymarket preflight flow. */
function runPolymarketPreflight(...args) {
  return getPolymarketOpsService().runPolymarketPreflight(...args);
}

/** Proxy to resolve command on-chain executor. */
function runResolve(...args) {
  return getMarketAdminService().runResolve(...args);
}

/** Proxy to LP add/remove executor. */
function runLp(...args) {
  return getMarketAdminService().runLp(...args);
}

/** Proxy to LP position fetcher. */
function runLpPositions(...args) {
  return getMarketAdminService().runLpPositions(...args);
}

/** Proxy to contract error decoder. */
function decodeContractError(...args) {
  return getContractErrorDecoder().decodeContractError(...args);
}

/** Proxy to decoded contract error formatter. */
function formatDecodedContractError(...args) {
  return getContractErrorDecoder().formatDecodedContractError(...args);
}

/** Proxy to default manifest path resolver. */
function defaultMirrorManifestFile(...args) {
  return getMirrorManifestStore().defaultManifestFile(...args);
}

/** Proxy to trusted pair lookup by selector. */
function findMirrorPair(...args) {
  return getMirrorManifestStore().findPair(...args);
}

/** Proxy to default autopilot state file resolver. */
function defaultAutopilotStateFile(...args) {
  return getAutopilotStateStore().defaultStateFile(...args);
}

/** Proxy to default autopilot kill-switch path resolver. */
function defaultAutopilotKillSwitchFile(...args) {
  return getAutopilotStateStore().defaultKillSwitchFile(...args);
}

/** Proxy to default mirror state file resolver. */
function defaultMirrorStateFile(...args) {
  return getMirrorStateStore().defaultStateFile(...args);
}

/** Proxy to default mirror kill-switch path resolver. */
function defaultMirrorKillSwitchFile(...args) {
  return getMirrorStateStore().defaultKillSwitchFile(...args);
}

/** Proxy to mirror strategy hash calculator. */
function mirrorStrategyHash(...args) {
  return getMirrorStateStore().strategyHash(...args);
}

/** Proxy to mirror state loader. */
function loadMirrorState(...args) {
  return getMirrorStateStore().loadState(...args);
}

let cachedRiskGuard = null;

function getRiskGuard() {
  if (!cachedRiskGuard) {
    const riskStateStore = getRiskStateStore();
    cachedRiskGuard = getRiskGuardService().createRiskGuardService({
      CliError,
      defaultRiskFile: riskStateStore.defaultRiskFile,
      loadRiskState: riskStateStore.loadRiskState,
      saveRiskState: riskStateStore.saveRiskState,
      touchPanicStopFiles: riskStateStore.touchPanicStopFiles,
    });
  }
  return cachedRiskGuard;
}

function getRiskSnapshot(...args) {
  return getRiskGuard().getRiskSnapshot(...args);
}

function assertLiveWriteAllowed(...args) {
  return getRiskGuard().assertLiveWriteAllowed(...args);
}

function setRiskPanic(...args) {
  return getRiskGuard().setPanic(...args);
}

function clearRiskPanic(...args) {
  return getRiskGuard().clearPanic(...args);
}

/** Schema command adapter with CLI output wiring. */
function runSchemaCommand(...args) {
  return getSchemaCommandService().createRunSchemaCommand({ emitSuccess, CliError }).runSchemaCommand(...args);
}

function resolveForkRuntime(...args) {
  return getForkRuntimeService().resolveForkRuntime(...args);
}

/** MCP server command adapter with package version wiring. */
function runMcpCommand(...args) {
  return getMcpServerService().createRunMcpServer({ packageVersion: PACKAGE_VERSION }).runMcpServer(...args);
}

/** Streaming command adapter with shared parser/runtime dependencies. */
function runStreamCommand(...args) {
  return getStreamCommandService().createRunStreamCommand({
    CliError,
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    parseIndexerSharedFlags,
    maybeLoadIndexerEnv,
    resolveIndexerUrl,
    parseAddressFlag,
    parseInteger,
    parsePositiveInteger,
    requireFlagValue,
    isSecureHttpUrlOrLocal,
    sleepMs,
  }).runStreamCommand(...args);
}

/** Sports provider registry factory proxy. */
function createSportsProviderRegistry(...args) {
  return getSportsProviderRegistry().createSportsProviderRegistry(...args);
}

/** Sports consensus calculator proxy. */
function computeSportsConsensus(...args) {
  return getSportsConsensusService().computeSportsConsensus(...args);
}

/** Sports timing planner proxy. */
function evaluateSportsTimingStatus(...args) {
  return getSportsTimingService().evaluateTimingStatus(...args);
}

/** Sports sync status builder proxy. */
function buildSyncStatusPayload(...args) {
  return getSportsSyncService().buildSyncStatusPayload(...args);
}

/** Sports sync concurrent-start guard proxy. */
function detectConcurrentSyncConflict(...args) {
  return getSportsSyncService().detectConcurrentSyncConflict(...args);
}

/** Sports resolve-plan builder proxy. */
function buildSportsResolvePlan(...args) {
  return getSportsResolvePlanService().buildSportsResolvePlan(...args);
}

/** Sports create planner proxy. */
function buildSportsCreatePlan(...args) {
  return getSportsCreationService().buildSportsCreatePlan(...args);
}

/** AMM deployment service proxy. */
function deployPandoraAmmMarket(...args) {
  return getPandoraDeployService().deployPandoraAmmMarket(...args);
}

/** Venue connector factory proxy. */
function createVenueConnectorFactory(...args) {
  return getVenueConnectorFactoryService().createVenueConnectorFactory(...args);
}

/** Odds history service proxy. */
function createOddsHistoryService(...args) {
  return getOddsHistoryService().createOddsHistoryService(...args);
}

let doctorServiceInstance = null;

/**
 * Returns memoized doctor service instance configured with CLI validators.
 * @returns {{ buildDoctorReport: (options: object) => Promise<object> }}
 */
function getDoctorServiceInstance() {
  if (!doctorServiceInstance) {
    doctorServiceInstance = getDoctorService().createDoctorService({
      CliError,
      loadEnvFile,
      runPolymarketCheck,
      isValidPrivateKey,
      isValidAddress,
      isSecureHttpUrlOrLocal,
      requiredEnvKeys: REQUIRED_ENV_KEYS,
      supportedChainIds: SUPPORTED_CHAIN_IDS,
      zeroAddress: ZERO_ADDRESS,
      defaultPolymarketHost: DEFAULT_POLYMARKET_HOST,
      defaultPolymarketRpcUrl: DEFAULT_POLYMARKET_RPC_URL,
    });
  }
  return doctorServiceInstance;
}

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_ENV_FILE = path.join(ROOT, 'scripts', '.env');
const DEFAULT_ENV_EXAMPLE = path.join(ROOT, 'scripts', '.env.example');
const DEFAULT_INDEXER_URL = SHARED_DEFAULT_INDEXER_URL;
let PACKAGE_VERSION = '0.0.0';
try {
  const packageJson = require(path.join(ROOT, 'package.json'));
  if (packageJson && typeof packageJson.version === 'string' && packageJson.version.trim()) {
    PACKAGE_VERSION = packageJson.version.trim();
  }
} catch {
  // best effort
}

const REQUIRED_ENV_KEYS = ['CHAIN_ID', 'RPC_URL', 'PRIVATE_KEY', 'ORACLE', 'FACTORY', 'USDC'];
const SUPPORTED_CHAIN_IDS = new Set([1]);
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const COMMAND_TARGETS = {
  launch: path.join(ROOT, 'scripts', 'create_market_launcher.ts'),
  'clone-bet': path.join(ROOT, 'scripts', 'create_polymarket_clone_and_bet.ts'),
};

const OUTPUT_MODES = new Set(['table', 'json']);
const CLI_JSON_SCHEMA_VERSION = '1.0.0';
const DEFAULT_RPC_TIMEOUT_MS = 12_000;
const DEFAULT_INDEXER_TIMEOUT_MS = 12_000;
const DEFAULT_POLYMARKET_HOST = 'https://clob.polymarket.com';
const DEFAULT_POLYMARKET_RPC_URL = 'https://polygon-bor-rpc.publicnode.com';
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

const { emitFailure, emitSuccess } = createCliOutputService({
  defaultSchemaVersion: CLI_JSON_SCHEMA_VERSION,
  CliError,
  getRecoveryForError: createErrorRecoveryService({ cliName: 'pandora' }).getRecoveryForError,
});

const {
  parseDateLikeFlag,
  parseDotEnv,
  parsePositiveInteger,
  parseInteger,
  parseNonNegativeInteger,
  parsePositiveNumber,
  parseNumber,
  parseCsvList,
  parseMirrorSyncGateSkipList,
  mergeMirrorSyncGateSkipLists,
  parseCsvNumberList,
  parseProbabilityPercent,
  parseBigIntString,
  parseOutcomeSide,
  parseAddressFlag,
  parsePrivateKeyFlag,
  parsePositionsOrderBy,
  requireFlagValue,
  mergeWhere,
  normalizeDirection,
  isValidAddress,
  isValidPrivateKey,
} = createParsePrimitives({
  CliError,
  getMirrorSyncGateCodes,
  positionsOrderByFields: POSITIONS_ORDER_BY_FIELDS,
  positionsOrderByFieldSet: POSITIONS_ORDER_BY_FIELD_SET,
});

const {
  parseScriptEnvFlags,
  parseDoctorFlags,
  parseSetupFlags,
  parseInitEnvFlags,
  parseIndexerSharedFlags,
  parseGetIdFlags,
  parseMarketsGetFlags,
  readIdsFromStdin,
  parseMarketsListFlags,
  parseQuoteFlags,
  parsePollsListFlags,
  parsePositionsListFlags,
  parsePortfolioFlags,
  parseWebhookFlagIntoOptions,
  parseEventsListFlags,
  parseEventsGetFlags,
  parseHistoryFlags,
  parseExportFlags,
  parseArbitrageFlags,
  parseWebhookTestFlags,
  parseLeaderboardFlags,
  parseAnalyzeFlags,
  parseSuggestFlags,
} = createCoreCommandFlagParsers({
  CliError,
  formatErrorValue,
  hasWebhookTargets,
  requireFlagValue,
  parsePositiveInteger,
  parseInteger,
  parseNonNegativeInteger,
  parsePositiveNumber,
  parseNumber,
  parseCsvList,
  parseProbabilityPercent,
  parseAddressFlag,
  parsePositionsOrderBy,
  parseOutcomeSide,
  mergeWhere,
  normalizeDirection,
  isSecureHttpUrlOrLocal,
  defaultEnvFile: DEFAULT_ENV_FILE,
  defaultEnvExample: DEFAULT_ENV_EXAMPLE,
  defaultRpcTimeoutMs: DEFAULT_RPC_TIMEOUT_MS,
  defaultIndexerTimeoutMs: DEFAULT_INDEXER_TIMEOUT_MS,
  defaultExpiringSoonHours: DEFAULT_EXPIRING_SOON_HOURS,
});

function printHelpTable() {
  console.log(`
pandora - Prediction market CLI

Usage:
  pandora [--output table|json] help
  pandora [--output table|json] --version
  pandora [--output table|json] init-env [--force] [--dotenv-path <path>] [--example <path>]
  pandora [--output table|json] doctor [--dotenv-path <path>] [--skip-dotenv] [--check-usdc-code] [--check-polymarket] [--rpc-timeout-ms <ms>]
  pandora [--output table|json] setup [--force] [--dotenv-path <path>] [--example <path>] [--check-usdc-code] [--check-polymarket] [--rpc-timeout-ms <ms>]
  pandora [--output table|json] markets list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>] [--where-json <json>] [--active|--resolved|--expiring-soon] [--expiring-hours <n>] [--expand] [--with-odds]
  pandora [--output table|json] markets get [--id <id> ...] [--stdin]
  pandora [--output table|json] polls list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--status <int>] [--category <int>] [--question-contains <text>] [--where-json <json>]
  pandora [--output table|json] polls get --id <id>
  pandora [--output table|json] events list [--type all|liquidity|oracle-fee|claim] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-direction asc|desc] [--chain-id <id>] [--wallet <address>] [--market-address <address>] [--poll-address <address>] [--tx-hash <hash>]
  pandora [--output table|json] events get --id <id> [--type all|liquidity|oracle-fee|claim]
  pandora [--output table|json] positions list [--wallet <address>] [--market-address <address>] [--chain-id <id>] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--where-json <json>]
  pandora [--output table|json] portfolio --wallet <address> [--chain-id <id>] [--limit <n>] [--include-events|--no-events] [--with-lp] [--rpc-url <url>]
  pandora [--output table|json] watch [--wallet <address>] [--market-address <address>] [--side yes|no] [--amount-usdc <amount>] [--iterations <n>] [--interval-ms <ms>] [--chain-id <id>] [--include-events|--no-events] [--yes-pct <0-100>] [--alert-yes-below <0-100>] [--alert-yes-above <0-100>] [--alert-net-liquidity-below <amount>] [--alert-net-liquidity-above <amount>] [--fail-on-alert]
  pandora [--output table|json] scan [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>] [--where-json <json>] [--active|--resolved|--expiring-soon] [--expiring-hours <n>] [--expand]
  pandora [--output table|json] sports books list|events list|events live|odds snapshot|consensus|create plan|create run|sync once|sync run|sync start|sync stop|sync status|resolve plan ...
  pandora [--output table|json] odds record|history ...
  pandora [--output table|json] lifecycle start|status|resolve ...
  pandora arb scan --markets <csv> --output ndjson [--min-net-spread-pct <n>] [--fee-pct-per-leg <n>] [--amount-usdc <n>] [--interval-ms <ms>] [--iterations <n>] [--indexer-url <url>] [--timeout-ms <ms>]
  pandora [--output table|json] quote [--indexer-url <url>] [--timeout-ms <ms>] --market-address <address> --side yes|no --amount-usdc <amount> [--yes-pct <0-100>] [--slippage-bps <0-10000>]
  pandora [--output table|json] trade [--indexer-url <url>] [--timeout-ms <ms>] [--dotenv-path <path>] [--skip-dotenv] --market-address <address> --side yes|no --amount-usdc <amount> --dry-run|--execute [--yes-pct <0-100>] [--slippage-bps <0-10000>] [--min-shares-out-raw <uint>] [--max-amount-usdc <amount>] [--min-probability-pct <0-100>] [--max-probability-pct <0-100>] [--allow-unquoted-execute] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>]
  pandora [--output table|json] history --wallet <address> [--chain-id <id>] [--market-address <address>] [--side yes|no|both] [--status all|open|won|lost|closed] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by timestamp|pnl|entry-price|mark-price] [--order-direction asc|desc] [--include-seed]
  pandora [--output table|json] export --wallet <address> --format csv|json [--chain-id <id>] [--year <yyyy>] [--from <unix>] [--to <unix>] [--out <path>]
  pandora [--output table|json] arbitrage [--chain-id <id>] [--venues pandora,polymarket] [--limit <n>] [--min-spread-pct <n>] [--min-liquidity-usdc <n>] [--max-close-diff-hours <n>] [--similarity-threshold <0-1>] [--cross-venue-only|--allow-same-venue] [--with-rules] [--include-similarity] [--question-contains <text>] [--polymarket-host <url>] [--polymarket-mock-url <url>]
  pandora [--output table|json] autopilot run|once --market-address <address> --side yes|no --amount-usdc <amount> [--trigger-yes-below <0-100>] [--trigger-yes-above <0-100>] [--paper|--execute-live] [--interval-ms <ms>] [--cooldown-ms <ms>] [--max-amount-usdc <amount>] [--max-open-exposure-usdc <amount>] [--max-trades-per-day <n>] [--state-file <path>] [--kill-switch-file <path>] [--webhook-url <url>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>]
  pandora [--output table|json] mirror browse|plan|deploy|verify|lp-explain|hedge-calc|simulate|go|sync|status|close ...
  pandora [--output table|json] polymarket check|approve|preflight|trade ...
  pandora [--output table|json] webhook test [--webhook-url <url>] [--webhook-template <json>] [--webhook-secret <secret>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>] [--webhook-timeout-ms <ms>] [--webhook-retries <n>]
  pandora [--output table|json] leaderboard [--metric profit|volume|win-rate] [--chain-id <id>] [--limit <n>] [--min-trades <n>]
  pandora [--output table|json] analyze --market-address <address> [--provider <name>] [--model <id>] [--max-cost-usd <n>] [--temperature <n>] [--timeout-ms <ms>]
  pandora [--output table|json] suggest --wallet <address> --risk low|medium|high --budget <amount> [--count <n>] [--include-venues pandora,polymarket]
  pandora [--output table|json] resolve --poll-address <address> --answer yes|no|invalid --reason <text> --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>]
  pandora [--output table|json] lp add|remove|positions [--market-address <address>] [--wallet <address>] [--amount-usdc <n>] [--lp-tokens <n>] [--dry-run|--execute] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>] [--deadline-seconds <n>] [--indexer-url <url>] [--timeout-ms <ms>]
  pandora [--output table|json] risk show|panic [--risk-file <path>] [--clear] [--reason <text>] [--actor <id>]
  pandora stream prices|events [--indexer-url <url>] [--indexer-ws-url <url>] [--timeout-ms <ms>] [--interval-ms <ms>] [--market-address <address>] [--chain-id <id>] [--limit <n>]
  pandora [--output json] schema
  pandora mcp
  pandora launch [--dotenv-path <path>] [--skip-dotenv] [script args...]
  pandora clone-bet [--dotenv-path <path>] [--skip-dotenv] [script args...]

Examples:
  pandora setup
  pandora --output json doctor --check-usdc-code --check-polymarket
  pandora markets list --active --with-odds --limit 10
  pandora markets get --id market-1 --id market-2
  pandora polls get --id 0xabc...
  pandora events list --type all --limit 25
  pandora positions list --wallet 0x1234...
  pandora portfolio --wallet 0x1234... --chain-id 1 --with-lp
  pandora watch --market-address 0xabc... --side yes --amount-usdc 10 --iterations 5 --interval-ms 2000
  pandora scan --active --limit 25 --chain-id 1
  pandora quote --market-address 0xabc... --side yes --amount-usdc 50
  pandora trade --dry-run --market-address 0xabc... --side no --amount-usdc 25 --max-amount-usdc 50 --min-probability-pct 20
  pandora history --wallet 0x1234... --chain-id 1 --limit 50
  pandora export --wallet 0x1234... --format csv --year 2026 --out ./trades-2026.csv
  pandora arbitrage --chain-id 1 --limit 25 --venues pandora,polymarket --cross-venue-only --with-rules --include-similarity
  pandora lifecycle start --config ./configs/lifecycle.json
  pandora arb scan --markets market-1,market-2 --output ndjson --iterations 1 --min-net-spread-pct 2
  pandora autopilot once --market-address 0xabc... --side no --amount-usdc 10 --trigger-yes-below 15 --paper
  pandora mirror plan --source polymarket --polymarket-market-id 0xabc... --with-rules --include-similarity
  pandora mirror browse --min-yes-pct 20 --max-yes-pct 80 --min-volume-24h 100000 --limit 10
  pandora mirror verify --pandora-market-address 0xabc... --polymarket-market-id 0xdef... --include-similarity
  pandora mirror lp-explain --liquidity-usdc 10000 --source-yes-pct 58
  pandora mirror hedge-calc --reserve-yes-usdc 8 --reserve-no-usdc 12 --excess-no-usdc 2 --polymarket-yes-pct 60
  pandora mirror simulate --liquidity-usdc 10000 --source-yes-pct 58 --target-yes-pct 58 --volume-scenarios 1000,5000,10000
  pandora mirror go --polymarket-slug nba-mia-phi-2026-02-28 --liquidity-usdc 10 --paper
  pandora mirror sync once --pandora-market-address 0xabc... --polymarket-market-id 0xdef... --paper --hedge-ratio 1.0 --skip-gate
  pandora polymarket check --rpc-url https://polygon-bor-rpc.publicnode.com --private-key 0x... --funder 0xproxy...
  pandora polymarket approve --dry-run --rpc-url https://polygon-bor-rpc.publicnode.com --private-key 0x... --funder 0xproxy...
  pandora polymarket preflight --rpc-url https://polygon-bor-rpc.publicnode.com --private-key 0x... --funder 0xproxy...
  pandora polymarket trade --condition-id 0xabc... --token yes --amount-usdc 2 --dry-run
  pandora mirror close --pandora-market-address 0xabc... --polymarket-market-id 0xdef... --dry-run
  pandora webhook test --webhook-url https://example.com/hook --webhook-template '{\"text\":\"{{message}}\"}'
  pandora leaderboard --metric profit --limit 20
  pandora analyze --market-address 0xabc... --provider mock
  pandora suggest --wallet 0x1234... --risk medium --budget 50 --count 3
  pandora risk show
  pandora risk panic --reason "Manual incident stop"
  pandora risk panic --clear
  pandora stream prices --indexer-url https://pandoraindexer.up.railway.app/ --interval-ms 1000
  pandora --output json schema
  pandora mcp
  pandora launch --dry-run --market-type amm --question "Will BTC close above $100k by end of 2026?" --rules "Resolves YES if ... Resolves NO if ... cancelled/postponed/abandoned/unresolved => NO." --sources "https://coinmarketcap.com/currencies/bitcoin/" "https://www.coingecko.com/en/coins/bitcoin" --target-timestamp 1798675200 --liquidity 100 --fee-tier 3000

Notes:
  - launch/clone-bet forward unknown flags directly to underlying scripts.
  - scripts/.env is loaded automatically for launch/clone-bet unless --skip-dotenv is used.
  - --output json is supported for all commands except launch/clone-bet.
  - Indexer URL resolution order: --indexer-url, PANDORA_INDEXER_URL, INDEXER_URL, default public indexer.
  - mirror status --with-live can enrich output with Polymarket position data when POLYMARKET_* credentials are set; missing endpoints/creds return diagnostics instead of hard failures.
  - watch is non-transactional monitoring; use quote/trade for execution workflows.
  - stream always emits NDJSON to stdout (one JSON object per line).
  - arb scan emits NDJSON opportunities only when thresholds are exceeded.
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
  pandora [--output table|json] trade [--indexer-url <url>] [--timeout-ms <ms>] [--dotenv-path <path>] [--skip-dotenv] --market-address <address> --side yes|no --amount-usdc <amount> --dry-run|--execute [--yes-pct <0-100>] [--slippage-bps <0-10000>] [--min-shares-out-raw <uint>] [--max-amount-usdc <amount>] [--min-probability-pct <0-100>] [--max-probability-pct <0-100>] [--allow-unquoted-execute] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>]

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
      'pandora [--output table|json] trade [--indexer-url <url>] [--timeout-ms <ms>] [--dotenv-path <path>] [--skip-dotenv] --market-address <address> --side yes|no --amount-usdc <amount> --dry-run|--execute [--yes-pct <0-100>] [--slippage-bps <0-10000>] [--min-shares-out-raw <uint>] [--max-amount-usdc <amount>] [--min-probability-pct <0-100>] [--max-probability-pct <0-100>] [--allow-unquoted-execute] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>]',
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
      'pandora [--output table|json] version',
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
      'pandora [--output table|json] sports ...',
      'pandora [--output table|json] odds record|history ...',
      'pandora [--output table|json] lifecycle start|status|resolve ...',
      'pandora arb scan --markets <csv> --output ndjson ...',
      'pandora [--output table|json] quote ...',
      'pandora [--output table|json] trade ...',
      'pandora [--output table|json] history ...',
      'pandora [--output table|json] export ...',
      'pandora [--output table|json] arbitrage ...',
      'pandora [--output table|json] autopilot run|once ...',
      'pandora [--output table|json] mirror browse|plan|deploy|verify|lp-explain|hedge-calc|simulate|go|sync|status|close ...',
      'pandora [--output table|json] polymarket check|approve|preflight|trade ...',
      'pandora [--output table|json] webhook test ...',
      'pandora [--output table|json] leaderboard ...',
      'pandora [--output table|json] analyze ...',
      'pandora [--output table|json] suggest ...',
      'pandora [--output table|json] resolve ...',
      'pandora [--output table|json] lp add|remove|positions ...',
      'pandora [--output table|json] risk show|panic ...',
      'pandora stream prices|events ...',
      'pandora [--output json] schema',
      'pandora mcp',
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

function findOddsSubcommandActionIndex(argv) {
  const tokens = Array.isArray(argv) ? argv : [];
  let commandIndex = 0;
  if (tokens[0] === 'pandora') commandIndex = 1;
  const command = String(tokens[commandIndex] || '').trim().toLowerCase();
  if (command !== 'odds') return -1;
  for (let i = commandIndex + 1; i < tokens.length; i += 1) {
    const token = String(tokens[i] || '').trim().toLowerCase();
    if (token === 'history' || token === 'record') return i;
  }
  return -1;
}

function isOddsHistoryLocalOutputFlag(argv, index) {
  const actionIndex = findOddsSubcommandActionIndex(argv);
  if (actionIndex < 0 || index <= actionIndex) return false;
  const action = String(argv[actionIndex] || '').trim().toLowerCase();
  return action === 'history';
}

function findArbSubcommandActionIndex(argv) {
  const tokens = Array.isArray(argv) ? argv : [];
  let commandIndex = 0;
  if (tokens[0] === 'pandora') commandIndex = 1;
  const command = String(tokens[commandIndex] || '').trim().toLowerCase();
  if (command !== 'arb') return -1;
  for (let i = commandIndex + 1; i < tokens.length; i += 1) {
    const token = String(tokens[i] || '').trim().toLowerCase();
    if (token === 'scan') return i;
  }
  return -1;
}

function isArbScanLocalOutputFlag(argv, index) {
  const actionIndex = findArbSubcommandActionIndex(argv);
  if (actionIndex < 0 || index <= actionIndex) return false;
  const action = String(argv[actionIndex] || '').trim().toLowerCase();
  return action === 'scan';
}

function isCommandLocalOutputFlag(argv, index) {
  return isOddsHistoryLocalOutputFlag(argv, index) || isArbScanLocalOutputFlag(argv, index);
}

function inferRequestedOutputMode(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--output' || token === '-o') {
      if (isCommandLocalOutputFlag(argv, i)) continue;
      const next = argv[i + 1];
      if (String(next).trim().toLowerCase() === 'json') return 'json';
    }
    if (token.startsWith('--output=')) {
      if (isCommandLocalOutputFlag(argv, i)) continue;
      if (token.slice('--output='.length).trim().toLowerCase() === 'json') return 'json';
    }
  }
  return 'table';
}

function expandEqualsStyleFlags(argv) {
  const expanded = [];
  const unaryBooleanFlags = new Set([
    '--force',
    '--skip-dotenv',
    '--no-env-file',
    '--check-usdc-code',
    '--check-polymarket',
    '--stdin',
    '--active',
    '--resolved',
    '--expiring-soon',
    '--expand',
    '--with-odds',
    '--include-events',
    '--no-events',
    '--fail-on-alert',
    '--dry-run',
    '--execute',
    '--allow-unquoted-execute',
    '--cross-venue-only',
    '--allow-same-venue',
    '--with-rules',
    '--include-similarity',
    '--paper',
    '--execute-live',
    '--fork',
    '--trust-deploy',
    '--allow-rule-mismatch',
    '--auto-sync',
    '--sync-once',
    '--skip-gate',
    '--force-gate',
    '--daemon',
    '--stream',
    '--no-hedge',
    '--clear',
    '--confirm',
  ]);
  for (const token of Array.isArray(argv) ? argv : []) {
    if (
      typeof token === 'string' &&
      token.startsWith('--') &&
      token.includes('=') &&
      token !== '--'
    ) {
      const eqIndex = token.indexOf('=');
      const flag = token.slice(0, eqIndex);
      const value = token.slice(eqIndex + 1);
      if (flag && flag !== '--') {
        const normalizedValue = value.trim().toLowerCase();
        if (
          unaryBooleanFlags.has(flag) &&
          (normalizedValue === 'true' || normalizedValue === 'false')
        ) {
          // Preserve explicit boolean-literal assignments for unary flags so they
          // are handled as invalid/explicit input by command parsers instead of
          // silently flipping behavior (for example, --dry-run=false).
          expanded.push(token);
          continue;
        }
        expanded.push(flag);
        if (value.length) expanded.push(value);
        continue;
      }
    }
    expanded.push(token);
  }
  return expanded;
}

function extractOutputMode(argv) {
  let outputMode = 'table';
  let outputConfigured = false;
  const args = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--output' || token === '-o') {
      const next = argv[i + 1];
      if (!next) {
        throw new CliError('MISSING_FLAG_VALUE', `Missing value for ${token}`);
      }
      if (isCommandLocalOutputFlag(argv, i)) {
        args.push(token, next);
        i += 1;
        continue;
      }
      const parsedMode = normalizeOutputMode(next);
      if (outputConfigured && parsedMode !== outputMode) {
        throw new CliError('INVALID_ARGS', `Conflicting --output values: "${outputMode}" and "${parsedMode}".`);
      }
      outputMode = parsedMode;
      outputConfigured = true;
      i += 1;
      continue;
    }

    if (token.startsWith('--output=')) {
      if (isCommandLocalOutputFlag(argv, i)) {
        args.push(token);
        continue;
      }
      const parsedMode = normalizeOutputMode(token.slice('--output='.length));
      if (outputConfigured && parsedMode !== outputMode) {
        throw new CliError('INVALID_ARGS', `Conflicting --output values: "${outputMode}" and "${parsedMode}".`);
      }
      outputMode = parsedMode;
      outputConfigured = true;
      continue;
    }

    args.push(token);
  }

  return { outputMode, args };
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

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
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

function buildMirrorSyncStrategy(options) {
  return {
    mode: options.mode,
    pandoraMarketAddress: options.pandoraMarketAddress,
    polymarketMarketId: options.polymarketMarketId,
    polymarketSlug: options.polymarketSlug,
    executeLive: options.executeLive,
    driftTriggerBps: options.driftTriggerBps,
    hedgeEnabled: options.hedgeEnabled,
    hedgeRatio: options.hedgeRatio,
    hedgeTriggerUsdc: options.hedgeTriggerUsdc,
    forceGate: options.forceGate,
    skipGateChecks:
      Array.isArray(options.skipGateChecks) && options.skipGateChecks.length
        ? [...options.skipGateChecks].sort()
        : [],
  };
}

function buildMirrorSyncDaemonCliArgs(options, shared) {
  const args = ['mirror', 'sync', 'run'];

  if (!shared.useEnvFile) {
    args.push('--skip-dotenv');
  } else if (shared.envFileExplicit) {
    args.push('--dotenv-path', shared.envFile);
  }
  if (shared.indexerUrl) {
    args.push('--indexer-url', shared.indexerUrl);
  }
  if (shared.timeoutMs !== DEFAULT_INDEXER_TIMEOUT_MS) {
    args.push('--timeout-ms', String(shared.timeoutMs));
  }

  args.push('--pandora-market-address', options.pandoraMarketAddress);
  if (options.polymarketMarketId) {
    args.push('--polymarket-market-id', options.polymarketMarketId);
  } else if (options.polymarketSlug) {
    args.push('--polymarket-slug', options.polymarketSlug);
  }
  args.push(options.executeLive ? '--execute-live' : '--paper');

  if (!options.hedgeEnabled) args.push('--no-hedge');
  if (options.stream) args.push('--stream');
  args.push('--interval-ms', String(options.intervalMs));
  args.push('--drift-trigger-bps', String(options.driftTriggerBps));
  args.push('--hedge-trigger-usdc', String(options.hedgeTriggerUsdc));
  args.push('--hedge-ratio', String(options.hedgeRatio));
  args.push('--max-rebalance-usdc', String(options.maxRebalanceUsdc));
  args.push('--max-hedge-usdc', String(options.maxHedgeUsdc));
  if (Number.isFinite(options.maxOpenExposureUsdc) && options.maxOpenExposureUsdc !== Number.POSITIVE_INFINITY) {
    args.push('--max-open-exposure-usdc', String(options.maxOpenExposureUsdc));
  }
  if (Number.isFinite(options.maxTradesPerDay) && options.maxTradesPerDay !== Number.MAX_SAFE_INTEGER) {
    args.push('--max-trades-per-day', String(options.maxTradesPerDay));
  }
  args.push('--cooldown-ms', String(options.cooldownMs));
  args.push('--depth-slippage-bps', String(options.depthSlippageBps));
  if (options.minTimeToCloseSec !== 1800) {
    args.push('--min-time-to-close-sec', String(options.minTimeToCloseSec));
  }
  if (Number.isFinite(options.iterations) && options.iterations > 0) {
    args.push('--iterations', String(options.iterations));
  }
  if (options.stateFile) {
    args.push('--state-file', options.stateFile);
  }
  if (options.killSwitchFile) {
    args.push('--kill-switch-file', options.killSwitchFile);
  }
  if (options.chainId !== null && options.chainId !== undefined) {
    args.push('--chain-id', String(options.chainId));
  }
  if (options.rpcUrl) args.push('--rpc-url', options.rpcUrl);
  if (options.funder) args.push('--funder', options.funder);
  if (options.usdc) args.push('--usdc', options.usdc);
  if (options.polymarketHost) args.push('--polymarket-host', options.polymarketHost);
  if (options.polymarketGammaUrl) args.push('--polymarket-gamma-url', options.polymarketGammaUrl);
  if (options.polymarketGammaMockUrl) args.push('--polymarket-gamma-mock-url', options.polymarketGammaMockUrl);
  if (options.polymarketMockUrl) args.push('--polymarket-mock-url', options.polymarketMockUrl);
  if (options.trustDeploy) args.push('--trust-deploy');
  if (options.forceGate) {
    args.push('--skip-gate');
  } else if (Array.isArray(options.skipGateChecks) && options.skipGateChecks.length) {
    args.push('--skip-gate', [...options.skipGateChecks].sort().join(','));
  }
  if (options.manifestFile) args.push('--manifest-file', options.manifestFile);

  if (options.webhookUrl) args.push('--webhook-url', options.webhookUrl);
  if (options.webhookTemplate) args.push('--webhook-template', options.webhookTemplate);
  if (options.webhookSecret) args.push('--webhook-secret', options.webhookSecret);
  if (options.webhookTimeoutMs !== 5_000) args.push('--webhook-timeout-ms', String(options.webhookTimeoutMs));
  if (options.webhookRetries !== 3) args.push('--webhook-retries', String(options.webhookRetries));
  if (options.telegramBotToken) args.push('--telegram-bot-token', options.telegramBotToken);
  if (options.telegramChatId) args.push('--telegram-chat-id', options.telegramChatId);
  if (options.discordWebhookUrl) args.push('--discord-webhook-url', options.discordWebhookUrl);
  if (options.failOnWebhookError) args.push('--fail-on-webhook-error');

  return args;
}

async function buildDoctorReport(options) {
  return getDoctorServiceInstance().buildDoctorReport(options);
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

function formatUnixTimestampIfLikely(raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return String(raw);
  if (numeric <= 0) return String(raw);
  const seconds = numeric > 1e12 ? numeric / 1000 : numeric;
  // Guard against block-number-like values rendered as 1970 dates.
  if (seconds < 946684800) return String(raw); // 2000-01-01T00:00:00Z
  return formatTimestamp(raw);
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

  if (report.polymarket && report.polymarket.checked) {
    const host = report.polymarket.hostReachability || {};
    statusRows.push([
      'polymarket:host',
      host.ok ? 'PASS' : 'FAIL',
      host.ok ? `${report.polymarket.host} (${host.status})` : host.error || 'Unreachable',
    ]);
    const polyCheck = report.polymarket.check;
    statusRows.push([
      'polymarket:chain',
      polyCheck && polyCheck.chainOk && polyCheck.chainId === 137 ? 'PASS' : 'FAIL',
      polyCheck ? `chainId=${polyCheck.chainId} expected=137` : 'Unavailable',
    ]);
    statusRows.push([
      'polymarket:funder',
      polyCheck && polyCheck.ownership && polyCheck.ownership.funderCodePresent === true ? 'PASS' : 'FAIL',
      polyCheck && polyCheck.runtime ? polyCheck.runtime.funderAddress || 'missing' : 'Unavailable',
    ]);
    statusRows.push([
      'polymarket:ownership',
      polyCheck && polyCheck.ownership && polyCheck.ownership.ok ? 'PASS' : 'FAIL',
      polyCheck && polyCheck.ownership && polyCheck.ownership.ownerCheckError
        ? polyCheck.ownership.ownerCheckError
        : '',
    ]);
    statusRows.push([
      'polymarket:api-key',
      polyCheck && polyCheck.apiKeySanity && polyCheck.apiKeySanity.ok ? 'PASS' : 'FAIL',
      polyCheck && polyCheck.apiKeySanity ? polyCheck.apiKeySanity.status : 'Unavailable',
    ]);
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

  if (report.polymarket && report.polymarket.checked && Array.isArray(report.polymarket.warnings) && report.polymarket.warnings.length) {
    console.log('Polymarket diagnostics:');
    for (const warning of report.polymarket.warnings) {
      console.log(`- ${warning}`);
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
  const items = Array.isArray(data.enrichedItems)
    ? data.enrichedItems
    : Array.isArray(data.items)
      ? data.items
      : [];
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
      `${riskGuards.minProbabilityPct === null || riskGuards.minProbabilityPct === undefined
        ? '-inf'
        : `${riskGuards.minProbabilityPct}%`
      } .. ${riskGuards.maxProbabilityPct === null || riskGuards.maxProbabilityPct === undefined
        ? '+inf'
        : `${riskGuards.maxProbabilityPct}%`
      }`,
    ],
    ['quoteAvailable', data.quote && data.quote.quoteAvailable ? 'yes' : 'no'],
    ['account', data.account || ''],
    ['approveTxHash', data.approveTxHash || ''],
    ['approveTxUrl', data.approveTxUrl || ''],
    ['approveGasEstimate', data.approveGasEstimate || ''],
    ['approveStatus', data.approveStatus || ''],
    ['buyTxHash', data.buyTxHash || ''],
    ['buyTxUrl', data.buyTxUrl || ''],
    ['buyGasEstimate', data.buyGasEstimate || ''],
    ['buyStatus', data.buyStatus || ''],
    ['finalStatus', data.finalStatus || ''],
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
      formatUnixTimestampIfLikely(item.deadlineEpoch),
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
    ['totalDeposited', data.summary.totalDeposited === null ? '' : data.summary.totalDeposited],
    ['totalNetDelta', data.summary.totalNetDelta === null ? '' : data.summary.totalNetDelta],
    ['totalUnrealizedPnl', data.summary.totalUnrealizedPnl === null ? '' : data.summary.totalUnrealizedPnl],
    ['eventsIncluded', data.summary.eventsIncluded ? 'yes' : 'no'],
    ['lpIncluded', data.summary.lpIncluded ? 'yes' : 'no'],
    ['lpPositionCount', data.summary.lpPositionCount === undefined ? '' : data.summary.lpPositionCount],
    ['lpMarketsWithBalance', data.summary.lpMarketsWithBalance === undefined ? '' : data.summary.lpMarketsWithBalance],
    ['lpEstimatedCollateralOutUsdc', data.summary.lpEstimatedCollateralOutUsdc === undefined ? '' : data.summary.lpEstimatedCollateralOutUsdc],
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

  if (Array.isArray(data.lpPositions) && data.lpPositions.length) {
    console.log('');
    printTable(
      ['LP Market', 'LP Tokens', 'Est. Collateral Out (USDC)', 'Diagnostics'],
      data.lpPositions.map((item) => [
        short(item.marketAddress, 18),
        item.lpTokenBalance || '',
        item.preview && item.preview.collateralOutUsdc ? item.preview.collateralOutUsdc : '',
        short(Array.isArray(item.diagnostics) ? item.diagnostics.join('; ') : '', 56),
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
      ['hedgeEnabled', data.parameters && data.parameters.hedgeEnabled === false ? 'no' : 'yes'],
      ['hedgeRatio', data.parameters && data.parameters.hedgeRatio !== undefined ? data.parameters.hedgeRatio : ''],
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

function renderMirrorLpExplainTable(data) {
  const flow = data.flow || {};
  const minted = flow.mintedCompleteSets || {};
  const seeded = flow.seededPoolReserves || {};
  const excess = flow.returnedExcessTokens || {};
  const inventory = flow.totalLpInventory || {};

  printTable(
    ['Field', 'Value'],
    [
      ['liquidityUsdc', data.inputs ? data.inputs.liquidityUsdc : ''],
      ['sourceYesPct', data.inputs && data.inputs.sourceYesPct !== null ? data.inputs.sourceYesPct : ''],
      ['distributionYes', data.inputs ? data.inputs.distributionYes : ''],
      ['distributionNo', data.inputs ? data.inputs.distributionNo : ''],
      ['mintedYes', minted.yesTokens !== undefined ? minted.yesTokens : ''],
      ['mintedNo', minted.noTokens !== undefined ? minted.noTokens : ''],
      ['poolReserveYes', seeded.reserveYesUsdc !== undefined ? seeded.reserveYesUsdc : ''],
      ['poolReserveNo', seeded.reserveNoUsdc !== undefined ? seeded.reserveNoUsdc : ''],
      ['impliedPandoraYesPct', seeded.impliedPandoraYesPct !== undefined ? seeded.impliedPandoraYesPct : ''],
      ['returnedExcessYes', excess.excessYesUsdc !== undefined ? excess.excessYesUsdc : ''],
      ['returnedExcessNo', excess.excessNoUsdc !== undefined ? excess.excessNoUsdc : ''],
      ['totalYes', inventory.totalYesUsdc !== undefined ? inventory.totalYesUsdc : ''],
      ['totalNo', inventory.totalNoUsdc !== undefined ? inventory.totalNoUsdc : ''],
      ['inventoryDelta', inventory.deltaUsdc !== undefined ? inventory.deltaUsdc : ''],
      ['neutralCompleteSets', inventory.neutralCompleteSets ? 'yes' : 'no'],
    ],
  );
}

function renderMirrorHedgeCalcTable(data) {
  const metrics = data.metrics || {};
  printTable(
    ['Field', 'Value'],
    [
      ['reserveYesUsdc', metrics.reserveYesUsdc !== undefined ? metrics.reserveYesUsdc : ''],
      ['reserveNoUsdc', metrics.reserveNoUsdc !== undefined ? metrics.reserveNoUsdc : ''],
      ['excessYesUsdc', metrics.excessYesUsdc !== undefined ? metrics.excessYesUsdc : ''],
      ['excessNoUsdc', metrics.excessNoUsdc !== undefined ? metrics.excessNoUsdc : ''],
      ['deltaPoolUsdc', metrics.deltaPoolUsdc !== undefined ? metrics.deltaPoolUsdc : ''],
      ['deltaTotalUsdc', metrics.deltaTotalUsdc !== undefined ? metrics.deltaTotalUsdc : ''],
      ['targetHedgeUsdc', metrics.targetHedgeUsdcSigned !== undefined ? metrics.targetHedgeUsdcSigned : ''],
      ['hedgeToken', metrics.hedgeToken || ''],
      ['hedgeSharesApprox', metrics.hedgeSharesApprox !== undefined ? metrics.hedgeSharesApprox : ''],
      ['hedgeCostApproxUsdc', metrics.hedgeCostApproxUsdc !== undefined ? metrics.hedgeCostApproxUsdc : ''],
      ['breakEvenVolumeUsdc', metrics.breakEvenVolumeUsdc !== undefined ? metrics.breakEvenVolumeUsdc : ''],
    ],
  );

  if (!Array.isArray(data.scenarios) || !data.scenarios.length) return;
  console.log('');
  printTable(
    ['Volume', 'Fee Revenue', 'Hedge Cost', 'Net PnL Approx'],
    data.scenarios.map((row) => [
      row.volumeUsdc !== undefined ? row.volumeUsdc : '',
      row.feeRevenueUsdc !== undefined ? row.feeRevenueUsdc : '',
      row.hedgeCostApproxUsdc !== undefined ? row.hedgeCostApproxUsdc : '',
      row.netPnlApproxUsdc !== undefined ? row.netPnlApproxUsdc : '',
    ]),
  );
}

function renderMirrorSimulateTable(data) {
  const initial = data.initialState || {};
  const targeting = data.targeting || {};
  printTable(
    ['Field', 'Value'],
    [
      ['liquidityUsdc', data.inputs ? data.inputs.liquidityUsdc : ''],
      ['sourceYesPct', data.inputs && data.inputs.sourceYesPct !== null ? data.inputs.sourceYesPct : ''],
      ['targetYesPct', data.inputs && data.inputs.targetYesPct !== null ? data.inputs.targetYesPct : ''],
      ['tradeSide', data.inputs ? data.inputs.tradeSide : ''],
      ['initialReserveYes', initial.reserveYesUsdc !== undefined ? initial.reserveYesUsdc : ''],
      ['initialReserveNo', initial.reserveNoUsdc !== undefined ? initial.reserveNoUsdc : ''],
      ['initialYesPct', initial.initialYesPct !== undefined ? initial.initialYesPct : ''],
      ['volumeNeededToTarget', targeting.volumeNeededToTargetUsdc !== undefined ? targeting.volumeNeededToTargetUsdc : ''],
    ],
  );

  if (!Array.isArray(data.scenarios) || !data.scenarios.length) return;
  console.log('');
  printTable(
    ['Volume', 'Post YES%', 'Fees', 'Hedge', 'Hedge Cost', 'Net PnL Approx'],
    data.scenarios.map((row) => [
      row.volumeUsdc !== undefined ? row.volumeUsdc : '',
      row.postYesPct !== undefined ? row.postYesPct : '',
      row.feesEarnedUsdc !== undefined ? row.feesEarnedUsdc : '',
      row.hedge && row.hedge.hedgeToken
        ? `${row.hedge.hedgeToken}:${row.hedge.targetHedgeUsdc}`
        : '',
      row.hedge && row.hedge.hedgeCostApproxUsdc !== undefined ? row.hedge.hedgeCostApproxUsdc : '',
      row.netPnlApproxUsdc !== undefined ? row.netPnlApproxUsdc : '',
    ]),
  );
}

function renderMirrorBrowseTable(data) {
  if (!Array.isArray(data.items) || !data.items.length) {
    console.log('No mirrorable markets found for current filters.');
    if (data.gammaApiError) {
      console.log(`Gamma API error: ${data.gammaApiError}`);
    }
    if (Array.isArray(data.diagnostics) && data.diagnostics.length) {
      console.log('Diagnostics:');
      for (const diagnostic of data.diagnostics) {
        console.log(`- ${diagnostic}`);
      }
    }
    return;
  }

  printTable(
    ['Slug', 'YES%', '24h Vol', 'Close', 'Mirror', 'Question'],
    data.items.map((item) => [
      short(item.slug || item.marketId || '', 28),
      formatNumericCell(item.yesPct, 3),
      formatNumericCell(item.volume24hUsd, 2),
      formatTimestamp(item.closeTimestamp),
      item.existingMirror ? short(item.existingMirror.marketAddress, 14) : '',
      short(item.question || '', 72),
    ]),
  );

  if (Array.isArray(data.diagnostics) && data.diagnostics.length) {
    console.log('');
    console.log('Diagnostics:');
    for (const diagnostic of data.diagnostics) {
      console.log(`- ${diagnostic}`);
    }
  }
  if (data.gammaApiError) {
    console.log('');
    console.log(`Gamma API error: ${data.gammaApiError}`);
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
      ['manifestFile', data.trustManifest && data.trustManifest.filePath ? data.trustManifest.filePath : ''],
      ['nativeRequired', data.preflight && data.preflight.nativeRequired ? data.preflight.nativeRequired : ''],
      ['usdcRequired', data.preflight && data.preflight.usdcRequired ? data.preflight.usdcRequired : ''],
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
      [
        'minTimeToExpirySec',
        data.expiry && data.expiry.minTimeToExpirySec !== null && data.expiry.minTimeToExpirySec !== undefined
          ? data.expiry.minTimeToExpirySec
          : '',
      ],
      ['expiryWarn', data.expiry && data.expiry.warn ? 'yes' : 'no'],
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

function renderMirrorSyncDaemonTable(data) {
  const meta = data && data.metadata ? data.metadata : {};
  printTable(
    ['Field', 'Value'],
    [
      ['found', data && data.found === false ? 'no' : 'yes'],
      ['status', data && data.status ? data.status : ''],
      ['alive', data && data.alive ? 'yes' : 'no'],
      ['strategyHash', data && data.strategyHash ? data.strategyHash : meta.strategyHash || ''],
      ['pid', data && data.pid !== null && data.pid !== undefined ? data.pid : meta.pid || ''],
      ['pidFile', data && data.pidFile ? data.pidFile : meta.pidFile || ''],
      ['logFile', data && data.logFile ? data.logFile : meta.logFile || ''],
      ['startedAt', meta.startedAt || ''],
      ['checkedAt', meta.checkedAt || data.checkedAt || ''],
      ['stopSignalSent', data && Object.prototype.hasOwnProperty.call(data, 'signalSent') ? (data.signalSent ? 'yes' : 'no') : ''],
    ],
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
      ['cumulativeLpFeesApproxUsdc', state.cumulativeLpFeesApproxUsdc === undefined ? '' : state.cumulativeLpFeesApproxUsdc],
      ['cumulativeHedgeCostApproxUsdc', state.cumulativeHedgeCostApproxUsdc === undefined ? '' : state.cumulativeHedgeCostApproxUsdc],
      ['idempotencyKeys', Array.isArray(state.idempotencyKeys) ? state.idempotencyKeys.length : 0],
    ],
  );

  if (!data.live) {
    return;
  }

  console.log('');
  printTable(
    ['Live Field', 'Value'],
    [
      ['pandoraYesPct', data.live.pandoraYesPct],
      ['sourceYesPct', data.live.sourceYesPct],
      ['driftBps', data.live.driftBps],
      ['driftTriggered', data.live.driftTriggered ? 'yes' : 'no'],
      ['hedgeGapUsdc', data.live.hedgeGapUsdc],
      ['hedgeTriggered', data.live.hedgeTriggered ? 'yes' : 'no'],
      ['lifecycleActive', data.live.lifecycleActive ? 'yes' : 'no'],
      ['minTimeToExpirySec', data.live.minTimeToExpirySec],
      ['netPnlApproxUsdc', data.live.netPnlApproxUsdc],
      ['netDeltaApprox', data.live.netDeltaApprox === undefined ? '' : data.live.netDeltaApprox],
      ['pnlApprox', data.live.pnlApprox === undefined ? '' : data.live.pnlApprox],
      [
        'polymarketPosition',
        data.live.polymarketPosition
          ? `yes=${data.live.polymarketPosition.yesBalance ?? 'n/a'} no=${data.live.polymarketPosition.noBalance ?? 'n/a'} openOrders=${data.live.polymarketPosition.openOrdersCount ?? 'n/a'} estUsd=${data.live.polymarketPosition.estimatedValueUsd ?? 'n/a'}`
          : '',
      ],
    ],
  );
}

function renderMirrorCloseTable(data) {
  printTable(
    ['Field', 'Value'],
    [
      ['mode', data.mode || ''],
      ['pandoraMarketAddress', data.pandoraMarketAddress || ''],
      ['polymarketMarketId', data.polymarketMarketId || ''],
      ['polymarketSlug', data.polymarketSlug || ''],
    ],
  );

  if (!Array.isArray(data.steps) || !data.steps.length) {
    return;
  }

  console.log('');
  printTable(
    ['Step', 'Status', 'Description'],
    data.steps.map((step) => [step.key || '', step.status || '', step.description || '']),
  );
}

function renderMirrorGoTable(data) {
  printTable(
    ['Field', 'Value'],
    [
      ['mode', data.mode || ''],
      ['planDigest', data.plan && data.plan.planDigest ? data.plan.planDigest : ''],
      ['deployedMarket', data.deploy && data.deploy.pandora ? data.deploy.pandora.marketAddress || '' : ''],
      ['verifyGateOk', data.verify && data.verify.gateResult ? (data.verify.gateResult.ok ? 'yes' : 'no') : ''],
      ['syncStarted', data.sync ? 'yes' : 'no'],
      ['suggestedSyncCommand', data.suggestedSyncCommand || ''],
    ],
  );
}

function renderPolymarketCheckTable(data) {
  const runtime = data.runtime || {};
  const balance = data.balances && data.balances.usdc ? data.balances.usdc : {};
  const approvals = data.approvals || {};
  const apiSanity = data.apiKeySanity || {};

  printTable(
    ['Field', 'Value'],
    [
      ['readyForLive', data.readyForLive ? 'yes' : 'no'],
      ['chainId', data.chainId === null || data.chainId === undefined ? '' : data.chainId],
      ['signerAddress', runtime.signerAddress || ''],
      ['funderAddress', runtime.funderAddress || ''],
      ['ownerAddress', runtime.ownerAddress || ''],
      ['usdcBalance', balance.formatted || balance.raw || ''],
      ['missingApprovals', approvals.missingCount || 0],
      ['apiKeySanity', apiSanity.status || 'unknown'],
    ],
  );

  if (!Array.isArray(approvals.missingChecks) || !approvals.missingChecks.length) {
    return;
  }

  console.log('');
  printTable(
    ['Missing Check', 'Spender', 'Type'],
    approvals.missingChecks.map((item) => [item.key || '', short(item.spender || '', 20), item.type || '']),
  );
}

function renderPolymarketApproveTable(data) {
  const summary = data.approvalSummary || {};
  printTable(
    ['Field', 'Value'],
    [
      ['mode', data.mode || ''],
      ['status', data.status || ''],
      ['missingCount', summary.missingCount || 0],
      ['plannedTxCount', Array.isArray(data.txPlan) ? data.txPlan.length : 0],
      ['executedTxCount', data.executedCount || 0],
      ['signerMatchesOwner', data.signerMatchesOwner ? 'yes' : 'no'],
      ['manualProxyActionRequired', data.manualProxyActionRequired ? 'yes' : 'no'],
    ],
  );

  if (!Array.isArray(data.txReceipts) || !data.txReceipts.length) {
    return;
  }

  console.log('');
  printTable(
    ['Key', 'Tx Hash', 'Status'],
    data.txReceipts.map((item) => [item.key || '', short(item.txHash || '', 24), item.status || '']),
  );
}

function renderPolymarketPreflightTable(data) {
  printTable(
    ['Field', 'Value'],
    [
      ['ok', data.ok ? 'yes' : 'no'],
      ['failedChecks', Array.isArray(data.failedChecks) ? data.failedChecks.length : 0],
    ],
  );

  if (!Array.isArray(data.checks) || !data.checks.length) {
    return;
  }

  console.log('');
  printTable(
    ['Check', 'Status', 'Message'],
    data.checks.map((item) => [item.code || '', item.ok ? 'ok' : 'failed', item.message || '']),
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

function renderRiskTable(data) {
  const panic = data && typeof data.panic === 'object' && data.panic ? data.panic : {};
  const guardrails = data && typeof data.guardrails === 'object' && data.guardrails ? data.guardrails : {};
  const counters = data && typeof data.counters === 'object' && data.counters ? data.counters : {};
  printTable(
    ['Field', 'Value'],
    [
      ['riskFile', data && data.riskFile ? data.riskFile : ''],
      ['action', data && data.action ? data.action : 'show'],
      ['changed', data && data.changed !== undefined ? String(Boolean(data.changed)) : ''],
      ['panic.active', String(Boolean(panic.active))],
      ['panic.reason', panic.reason || ''],
      ['panic.engagedAt', panic.engagedAt || ''],
      ['panic.engagedBy', panic.engagedBy || ''],
      ['guardrails.enabled', String(guardrails.enabled !== false)],
      [
        'guardrails.maxSingleLiveNotionalUsdc',
        guardrails.maxSingleLiveNotionalUsdc === null || guardrails.maxSingleLiveNotionalUsdc === undefined
          ? ''
          : String(guardrails.maxSingleLiveNotionalUsdc),
      ],
      [
        'guardrails.maxDailyLiveNotionalUsdc',
        guardrails.maxDailyLiveNotionalUsdc === null || guardrails.maxDailyLiveNotionalUsdc === undefined
          ? ''
          : String(guardrails.maxDailyLiveNotionalUsdc),
      ],
      [
        'guardrails.maxDailyLiveOps',
        guardrails.maxDailyLiveOps === null || guardrails.maxDailyLiveOps === undefined
          ? ''
          : String(guardrails.maxDailyLiveOps),
      ],
      ['guardrails.blockForkExecute', String(Boolean(guardrails.blockForkExecute))],
      ['counters.day', counters.day || ''],
      ['counters.liveOps', counters.liveOps === undefined ? '' : String(counters.liveOps)],
      ['counters.liveNotionalUsdc', counters.liveNotionalUsdc === undefined ? '' : String(counters.liveNotionalUsdc)],
    ],
  );
  if (Array.isArray(data && data.stopFiles) && data.stopFiles.length) {
    console.log('');
    printTable(
      ['Stop Files'],
      data.stopFiles.map((filePath) => [filePath]),
    );
  }
}

function renderSingleEntityTable(data) {
  if (data && typeof data.item === 'object' && data.item !== null) {
    printRecord(data.item);
    return;
  }
  if (Array.isArray(data && data.items)) {
    if (!data.items.length) {
      console.log('No items found.');
      return;
    }
    for (const item of data.items) {
      printRecord(item);
      console.log('');
    }
    return;
  }
  if (data && typeof data === 'object') {
    printRecord(data);
    return;
  }
  console.log(String(data));
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

function toDecimalOdds(probability) {
  if (!Number.isFinite(probability) || probability <= 0) return null;
  return round(1 / probability);
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
  const yes = toOptionalNumber(yesRaw);
  const no = toOptionalNumber(noRaw);
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

  const yesProbability = round(normalizedYes / total);
  const noProbability = round(normalizedNo / total);
  const yesPct = round(yesProbability * 100, 4);
  const noPct = round(noProbability * 100, 4);
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

  const yesReserve = toOptionalNumber(item[pair.yesField]);
  const noReserve = toOptionalNumber(item[pair.noField]);
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
  const closeEpoch = toOptionalNumber(item.marketCloseTimestamp);
  const createdEpoch = toOptionalNumber(item.createdAt);

  return {
    closeTimeIso: formatTimestamp(item.marketCloseTimestamp) || null,
    createdAtIso: formatTimestamp(item.createdAt) || null,
    totalVolumeNumeric: toOptionalNumber(item.totalVolume),
    currentTvlNumeric: toOptionalNumber(item.currentTvl),
    isClosed: closeEpoch === null ? null : closeEpoch <= nowEpochSeconds,
    ageSeconds: createdEpoch === null ? null : Math.max(0, nowEpochSeconds - createdEpoch),
  };
}

function normalizeNumericLikeValue(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : value;
  }
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed.length) {
    return value;
  }
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) {
    return value;
  }
  return numeric;
}

function normalizeMarketNumericFields(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return item;
  }
  return {
    ...item,
    chainId: normalizeNumericLikeValue(item.chainId),
    marketCloseTimestamp: normalizeNumericLikeValue(item.marketCloseTimestamp),
    createdAt: normalizeNumericLikeValue(item.createdAt),
    totalVolume: normalizeNumericLikeValue(item.totalVolume),
    currentTvl: normalizeNumericLikeValue(item.currentTvl),
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
  const normalizedItems = Array.isArray(items) ? items.map((item) => normalizeMarketNumericFields(item)) : [];
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
    count: normalizedItems.length,
    pageInfo,
    items: normalizedItems,
  };

  if (
    typeof opts.unfilteredCount === 'number' &&
    opts.unfilteredCount >= normalizedItems.length &&
    options.lifecycle !== 'all'
  ) {
    payload.lifecycle = {
      mode: options.lifecycle,
      expiringHours: options.lifecycle === 'expiring-soon' ? options.expiringSoonHours : null,
      unfilteredCount: opts.unfilteredCount,
      filteredOut: opts.unfilteredCount - normalizedItems.length,
    };
  }

  const includeEnrichedItems = Boolean(opts.includeEnrichedItems || options.expand || options.withOdds);
  if (includeEnrichedItems) {
    const enrichedItems = buildEnrichedMarketItems(normalizedItems, options, enrichmentContext);
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
    const closeEpoch = toOptionalNumber(item && item.marketCloseTimestamp);
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

function sumNumericField(items, key) {
  let total = 0;
  for (const item of items) {
    const numeric = Number(item && item[key]);
    if (Number.isFinite(numeric)) {
      total += numeric;
    }
  }
  return round(total, 6);
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
    impliedProbability: round(probability, 6),
    pricePerShare: round(pricePerShare, 6),
    estimatedShares: round(estimatedShares, 6),
    minSharesOut: round(minSharesOut, 6),
    potentialPayoutIfWin: round(payoutIfWin, 6),
    potentialProfitIfWin: round(profitIfWin, 6),
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
  let forkRuntime;
  try {
    forkRuntime = resolveForkRuntime(options, {
      env: process.env,
      isSecureHttpUrlOrLocal,
      defaultChainId: Number(process.env.CHAIN_ID || 1) || 1,
    });
  } catch (err) {
    if (err && err.code) {
      throw new CliError(err.code, err.message || 'Invalid fork runtime configuration.', err.details);
    }
    throw err;
  }
  const chainIdRaw = Number.isInteger(forkRuntime.chainId)
    ? forkRuntime.chainId
    : options.chainId !== null
      ? options.chainId
      : Number(process.env.CHAIN_ID || 1);
  if (!Number.isInteger(chainIdRaw) || !SUPPORTED_CHAIN_IDS.has(chainIdRaw)) {
    throw new CliError('INVALID_FLAG_VALUE', `Unsupported --chain-id=${chainIdRaw}. Supported values: 1`);
  }

  const rpcUrl = forkRuntime.mode === 'fork'
    ? forkRuntime.rpcUrl
    : options.rpcUrl || process.env.RPC_URL || DEFAULT_RPC_BY_CHAIN_ID[chainIdRaw];
  if (!isSecureHttpUrlOrLocal(rpcUrl)) {
    throw new CliError(
      'INVALID_FLAG_VALUE',
      `RPC URL must use https:// (or http://localhost/127.0.0.1 for local testing). Received: "${rpcUrl}"`,
    );
  }

  const privateKey = options.privateKey || process.env.PANDORA_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!privateKey || !isValidPrivateKey(privateKey)) {
    throw new CliError(
      'INVALID_FLAG_VALUE',
      'Missing or invalid private key. Set PANDORA_PRIVATE_KEY (preferred) or PRIVATE_KEY, or pass --private-key.',
    );
  }

  const usdc = options.usdc || String(process.env.USDC || '').trim();
  if (!usdc) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing USDC token address. Set USDC in env or pass --usdc.');
  }
  const usdcAddress = parseAddressFlag(usdc, '--usdc');

  const chain = {
    id: 1,
    name: 'Ethereum',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
    blockExplorers: { default: { name: 'Etherscan', url: 'https://etherscan.io' } },
  };

  return {
    chainId: chainIdRaw,
    mode: forkRuntime.mode,
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

  const marketCode = await publicClient.getBytecode({ address: options.marketAddress });
  if (!marketCode || marketCode === '0x' || marketCode === '0x0') {
    throw new CliError(
      'MARKET_ADDRESS_NO_CODE',
      `--market-address has no bytecode on chain ${runtime.chainId}: ${options.marketAddress}`,
      {
        chainId: runtime.chainId,
        marketAddress: options.marketAddress,
      },
    );
  }

  const amountRaw = parseUnits(String(options.amountUsdc), 6);
  const minSharesOutRaw = options.minSharesOutRaw === null ? 0n : options.minSharesOutRaw;
  const explorerBase = 'https://etherscan.io/tx/';
  const toExplorerUrl = (hash) => (hash ? `${explorerBase}${hash}` : null);
  const decodeTradeError = async (error, code, fallbackMessage, details = {}) => {
    const decoded = await decodeContractError(error);
    const decodedMessage = formatDecodedContractError(decoded);
    const causeMessage =
      (error && (error.shortMessage || error.message)) || formatErrorValue(error) || fallbackMessage;
    throw new CliError(code, decodedMessage || causeMessage || fallbackMessage, {
      ...details,
      decodedError: decoded,
      cause: causeMessage,
    });
  };

  let allowance;
  try {
    allowance = await publicClient.readContract({
      address: runtime.usdcAddress,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account.address, options.marketAddress],
    });
  } catch (error) {
    await decodeTradeError(error, 'ALLOWANCE_READ_FAILED', 'Failed to read USDC allowance.', {
      stage: 'allowance-read',
      usdc: runtime.usdcAddress,
    });
  }

  let approveTxHash = null;
  let approveGasEstimate = null;
  let approveStatus = null;
  if (allowance < amountRaw) {
    let approveSimulation;
    try {
      approveSimulation = await publicClient.simulateContract({
        account,
        address: runtime.usdcAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [options.marketAddress, amountRaw],
      });
      approveGasEstimate =
        approveSimulation && approveSimulation.request && approveSimulation.request.gas
          ? approveSimulation.request.gas.toString()
          : null;
    } catch (error) {
      await decodeTradeError(error, 'APPROVE_SIMULATION_FAILED', 'USDC approve simulation failed.', {
        stage: 'approve-simulate',
      });
    }
    try {
      approveTxHash = await walletClient.writeContract(approveSimulation.request);
      const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
      approveStatus = approveReceipt && approveReceipt.status ? approveReceipt.status : null;
    } catch (error) {
      await decodeTradeError(error, 'APPROVE_EXECUTION_FAILED', 'USDC approve transaction failed.', {
        stage: 'approve-execute',
        approveTxHash,
      });
    }
  }

  let buyTxHash = null;
  let buyGasEstimate = null;
  let buyStatus = null;
  try {
    const buySimulation = await publicClient.simulateContract({
      account,
      address: options.marketAddress,
      abi: PARI_MUTUEL_ABI,
      functionName: 'buy',
      args: [options.side === 'yes', amountRaw, minSharesOutRaw],
    });
    buyGasEstimate =
      buySimulation && buySimulation.request && buySimulation.request.gas
        ? buySimulation.request.gas.toString()
        : null;
    buyTxHash = await walletClient.writeContract(buySimulation.request);
    const buyReceipt = await publicClient.waitForTransactionReceipt({ hash: buyTxHash });
    buyStatus = buyReceipt && buyReceipt.status ? buyReceipt.status : null;
  } catch (error) {
    await decodeTradeError(error, 'TRADE_EXECUTION_FAILED', 'Buy transaction failed.', {
      stage: 'buy',
      buyTxHash,
    });
  }

  return {
    mode: runtime.mode,
    chainId: runtime.chainId,
    rpcUrl: runtime.rpcUrl,
    account: account.address,
    usdc: runtime.usdcAddress,
    amountRaw: amountRaw.toString(),
    minSharesOutRaw: minSharesOutRaw.toString(),
    approveTxHash,
    approveTxUrl: toExplorerUrl(approveTxHash),
    approveGasEstimate,
    approveStatus,
    buyTxHash,
    buyTxUrl: toExplorerUrl(buyTxHash),
    buyGasEstimate,
    buyStatus,
    status: buyStatus || 'confirmed',
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
  return runTradeCommandFromService(args, context);
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
        return { id, item: normalizeMarketNumericFields(data.markets || null) };
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

const runScanCommand = createRunScanCommand({
  parseIndexerSharedFlags,
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  maybeLoadIndexerEnv,
  resolveIndexerUrl,
  parseMarketsListFlags,
  fetchMarketsListPage,
  buildMarketsEnrichmentContext,
  buildMarketsListPayload,
  renderScanTable,
});

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
  let lpPayload = null;

  if (options.includeEvents) {
    [liquidityPage, claimPage] = await Promise.all([
      fetchPortfolioLiquidityEvents(indexerUrl, options, timeoutMs),
      fetchPortfolioClaimEvents(indexerUrl, options, timeoutMs),
    ]);
  }

  if (options.withLp) {
    lpPayload = await runLpPositions({
      wallet: options.wallet,
      chainId: options.chainId,
      rpcUrl: options.rpcUrl || null,
      indexerUrl,
      timeoutMs,
    });
  }

  const positions = Array.isArray(positionsPage.items) ? positionsPage.items : [];
  const liquidityEvents = Array.isArray(liquidityPage.items) ? liquidityPage.items : [];
  const claimEvents = Array.isArray(claimPage.items) ? claimPage.items : [];
  const lpPositions = Array.isArray(lpPayload && lpPayload.items) ? lpPayload.items : [];
  const lpDiagnostics = Array.isArray(lpPayload && lpPayload.diagnostics) ? lpPayload.diagnostics : [];

  return {
    summary: summarizePortfolio(options, positions, liquidityEvents, claimEvents, lpPositions, lpDiagnostics),
    positions,
    lpPositions,
    events: {
      liquidity: liquidityEvents,
      claims: claimEvents,
    },
    diagnostics: {
      lp: lpDiagnostics,
    },
  };
}

function summarizePortfolio(options, positions, liquidityEvents, claimEvents, lpPositions = [], lpDiagnostics = []) {
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
  const cashflowNet = round((liquidityRemoved + claims) - liquidityAdded, 6);

  const diagnostics = [];
  if (!options.includeEvents) {
    diagnostics.push('Event aggregation disabled with --no-events.');
  } else if (!liquidityEvents.length && !claimEvents.length) {
    diagnostics.push('No wallet events found in indexer for this filter set.');
  }
  if (options.chainId !== null && options.includeEvents) {
    diagnostics.push('Claim events are not chain-filtered by indexer schema; values may span chains.');
  }
  if (options.withLp && !lpPositions.length) {
    diagnostics.push('No LP positions found for this wallet/filter.');
  }
  if (options.withLp && lpDiagnostics.length) {
    diagnostics.push(...lpDiagnostics);
  }

  const lpPositionCount = Array.isArray(lpPositions) ? lpPositions.length : 0;
  const lpMarketsWithBalance = lpPositions.filter((item) => {
    try {
      return BigInt(item && item.lpTokenBalanceRaw ? item.lpTokenBalanceRaw : '0') > 0n;
    } catch {
      return false;
    }
  }).length;
  const lpEstimatedCollateralOutUsdc = round(
    lpPositions.reduce((sum, item) => {
      const value = Number(item && item.preview && item.preview.collateralOutUsdc);
      return Number.isFinite(value) ? sum + value : sum;
    }, 0),
    6,
  );
  const hasAnyLpPreview = lpPositions.some((item) => {
    const value = Number(item && item.preview && item.preview.collateralOutUsdc);
    return Number.isFinite(value);
  });

  const totalDeposited = options.includeEvents ? round(liquidityAdded, 6) : null;
  const totalNetDelta = options.includeEvents ? round(netLiquidity, 6) : null;
  let totalUnrealizedPnl = null;

  if (options.includeEvents && options.withLp) {
    if (lpMarketsWithBalance === 0) {
      totalUnrealizedPnl = 0;
    } else if (hasAnyLpPreview && totalNetDelta !== null) {
      totalUnrealizedPnl = round(lpEstimatedCollateralOutUsdc - totalNetDelta, 6);
    } else {
      totalUnrealizedPnl = null;
      diagnostics.push('LP unrealized PnL unavailable: missing LP remove preview outputs.');
    }
  } else if (options.includeEvents && !options.withLp) {
    diagnostics.push('LP unrealized PnL unavailable without --with-lp.');
  }

  return {
    positionCount: positions.length,
    uniqueMarkets,
    liquidityAdded: round(liquidityAdded, 6),
    liquidityRemoved: round(liquidityRemoved, 6),
    netLiquidity: round(netLiquidity, 6),
    claims,
    cashflowNet,
    pnlProxy: cashflowNet,
    totalDeposited,
    totalNetDelta,
    totalUnrealizedPnl,
    totalsPolicy: {
      eventDerivedTotalsWhenEventsDisabled: null,
      eventDerivedTotalsDefaultWhenNoRows: 0,
      unrealizedRequiresLp: true,
      unrealizedWhenNoLpBalance: 0,
      unrealizedWhenPreviewUnavailable: null,
    },
    eventsIncluded: options.includeEvents,
    lpIncluded: Boolean(options.withLp),
    lpPositionCount,
    lpMarketsWithBalance,
    lpEstimatedCollateralOutUsdc,
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

const sharedParserDeps = {
  CliError,
  parseAddressFlag,
  parsePrivateKeyFlag,
  requireFlagValue,
  parsePositiveInteger,
  parsePositiveNumber,
  parseInteger,
  parseNonNegativeInteger,
  parseProbabilityPercent,
  parseOutcomeSide,
  parseNumber,
  parseWebhookFlagIntoOptions,
  isSecureHttpUrlOrLocal,
};

const parseTradeFlagsFromModule = createParseTradeFlags({
  ...sharedParserDeps,
  parseBigIntString,
});
const parseWatchFlagsFromModule = createParseWatchFlags(sharedParserDeps);
const parseAutopilotFlagsFromModule = createParseAutopilotFlags({
  ...sharedParserDeps,
  defaultAutopilotStateFile,
  defaultAutopilotKillSwitchFile,
});
const parseMirrorPlanFlagsFromModule = createParseMirrorPlanFlags(sharedParserDeps);
const parseMirrorHedgeCalcFlagsFromModule = createParseMirrorHedgeCalcFlags({
  ...sharedParserDeps,
  parseCsvNumberList,
});
const parseMirrorDeployFlagsFromModule = createParseMirrorDeployFlags(sharedParserDeps);
const parseMirrorGoFlagsFromModule = createParseMirrorGoFlags({
  ...sharedParserDeps,
  parseMirrorSyncGateSkipList,
  mergeMirrorSyncGateSkipLists,
});
const parseMirrorSyncFlagsFromModule = createParseMirrorSyncFlags({
  ...sharedParserDeps,
  defaultMirrorStateFile,
  defaultMirrorKillSwitchFile,
  parseMirrorSyncGateSkipList,
  mergeMirrorSyncGateSkipLists,
});
const parseMirrorSyncDaemonSelectorFlagsFromModule = createParseMirrorSyncDaemonSelectorFlags({
  CliError,
  requireFlagValue,
});
const parseMirrorBrowseFlagsFromModule = createParseMirrorBrowseFlags({
  ...sharedParserDeps,
  parseDateLikeFlag,
});
const parseMirrorVerifyFlagsFromModule = createParseMirrorVerifyFlags(sharedParserDeps);
const parseMirrorStatusFlagsFromModule = createParseMirrorStatusFlags({
  ...sharedParserDeps,
  defaultIndexerTimeoutMs: DEFAULT_INDEXER_TIMEOUT_MS,
});
const parseMirrorCloseFlagsFromModule = createParseMirrorCloseFlags(sharedParserDeps);
const parseMirrorLpExplainFlagsFromModule = createParseMirrorLpExplainFlags(sharedParserDeps);
const parseMirrorSimulateFlagsFromModule = createParseMirrorSimulateFlags({
  ...sharedParserDeps,
  parseCsvNumberList,
});
const parsePolymarketSharedFlagsFromModule = createParsePolymarketSharedFlags({
  CliError,
  requireFlagValue,
  parseAddressFlag,
  parseInteger,
  isValidPrivateKey,
  isSecureHttpUrlOrLocal,
});
const parsePolymarketApproveFlagsFromModule = createParsePolymarketApproveFlags({
  CliError,
  parsePolymarketSharedFlags: parsePolymarketSharedFlagsFromModule,
});
const parsePolymarketTradeFlagsFromModule = createParsePolymarketTradeFlags({
  CliError,
  requireFlagValue,
  parsePositiveNumber,
  parsePositiveInteger,
  parsePolymarketSharedFlags: parsePolymarketSharedFlagsFromModule,
  isSecureHttpUrlOrLocal,
  defaultTimeoutMs: DEFAULT_INDEXER_TIMEOUT_MS,
});
const parseResolveFlagsFromModule = createParseResolveFlags({
  CliError,
  parseAddressFlag,
  requireFlagValue,
  parseInteger,
  isValidPrivateKey,
  isSecureHttpUrlOrLocal,
});
const parseLpFlagsFromModule = createParseLpFlags({
  CliError,
  parseAddressFlag,
  requireFlagValue,
  parsePositiveNumber,
  parseInteger,
  parsePositiveInteger,
  isValidPrivateKey,
  isSecureHttpUrlOrLocal,
  defaultTimeoutMs: DEFAULT_INDEXER_TIMEOUT_MS,
});
const parseLifecycleFlagsFromModule = createParseLifecycleFlags({
  CliError,
  requireFlagValue,
});
const parseSportsFlagsFromModule = createParseSportsFlags({
  CliError,
  requireFlagValue,
  parsePositiveInteger,
  parsePositiveNumber,
  parseInteger,
  parseNumber,
  parseAddressFlag,
  parsePrivateKeyFlag,
  parseCsvList,
  parseDateLikeFlag,
  isSecureHttpUrlOrLocal,
});
const parseOddsFlagsFromModule = createParseOddsFlags({
  CliError,
  requireFlagValue,
  parsePositiveInteger,
  parseCsvList,
});
const parseRiskShowFlagsFromModule = createParseRiskShowFlags({
  CliError,
  requireFlagValue,
});
const parseRiskPanicFlagsFromModule = createParseRiskPanicFlags({
  CliError,
  requireFlagValue,
});

const runTradeCommandFromService = createRunTradeCommand({
  CliError,
  parseIndexerSharedFlags,
  emitSuccess,
  tradeHelpJsonPayload,
  printTradeHelpTable,
  maybeLoadTradeEnv,
  parseTradeFlags: parseTradeFlagsFromModule,
  resolveIndexerUrl,
  buildQuotePayload,
  enforceTradeRiskGuards,
  getSelectedOutcomeProbabilityPct,
  buildTradeRiskGuardConfig,
  executeTradeOnchain,
  resolveForkRuntime,
  isSecureHttpUrlOrLocal,
  assertLiveWriteAllowed,
  renderTradeTable,
});

const runWatchCommandFromService = createRunWatchCommand({
  CliError,
  parseIndexerSharedFlags,
  emitSuccess,
  watchHelpJsonPayload,
  printWatchHelpTable,
  maybeLoadIndexerEnv,
  resolveIndexerUrl,
  parseWatchFlags: parseWatchFlagsFromModule,
  collectPortfolioSnapshot,
  buildQuotePayload,
  evaluateWatchAlerts,
  hasWebhookTargets,
  sendWebhookNotifications,
  sleepMs,
  renderWatchTable,
});

const runPolymarketCommandFromService = createRunPolymarketCommand({
  CliError,
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  loadEnvIfPresent,
  parsePolymarketSharedFlags: parsePolymarketSharedFlagsFromModule,
  parsePolymarketApproveFlags: parsePolymarketApproveFlagsFromModule,
  parsePolymarketTradeFlags: parsePolymarketTradeFlagsFromModule,
  resolveForkRuntime,
  isSecureHttpUrlOrLocal,
  runPolymarketCheck,
  runPolymarketApprove,
  runPolymarketPreflight,
  resolvePolymarketMarket,
  readTradingCredsFromEnv,
  placeHedgeOrder,
  renderPolymarketCheckTable,
  renderPolymarketApproveTable,
  renderPolymarketPreflightTable,
  renderSingleEntityTable,
  assertLiveWriteAllowed,
  defaultEnvFile: DEFAULT_ENV_FILE,
});

const runResolveCommandFromService = createRunResolveCommand({
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  parseResolveFlags: parseResolveFlagsFromModule,
  runResolve,
  renderSingleEntityTable,
  CliError,
  assertLiveWriteAllowed,
});

const runLpCommandFromService = createRunLpCommand({
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  parseLpFlags: parseLpFlagsFromModule,
  runLp,
  renderSingleEntityTable,
  CliError,
  assertLiveWriteAllowed,
});
const runSportsCommandFromService = createRunSportsCommand({
  CliError,
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  parseSportsFlags: parseSportsFlagsFromModule,
  createSportsProviderRegistry,
  computeSportsConsensus,
  evaluateSportsTimingStatus,
  buildSyncStatusPayload,
  detectConcurrentSyncConflict,
  buildSportsResolvePlan,
  buildSportsCreatePlan,
  deployPandoraAmmMarket,
  assertLiveWriteAllowed,
});
const runRiskCommandFromService = createRunRiskCommand({
  CliError,
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  parseRiskShowFlags: parseRiskShowFlagsFromModule,
  parseRiskPanicFlags: parseRiskPanicFlagsFromModule,
  getRiskSnapshot,
  setPanic: setRiskPanic,
  clearPanic: clearRiskPanic,
  renderRiskTable,
});
const runLifecycleCommandFromService = createRunLifecycleCommand({
  CliError,
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  parseLifecycleFlags: parseLifecycleFlagsFromModule,
});
const runArbCommandFromService = createRunArbCommand({
  CliError,
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  parseIndexerSharedFlags,
  maybeLoadIndexerEnv,
  resolveIndexerUrl,
  requireFlagValue,
  parseCsvList,
  parseNumber,
  parsePositiveNumber,
  parsePositiveInteger,
  buildGraphqlGetQuery,
  graphqlRequest,
  sleepMs,
});

async function runPortfolioCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  if (shared.rest.includes('--help') || shared.rest.includes('-h')) {
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'portfolio.help', {
        usage:
          'pandora [--output table|json] portfolio --wallet <address> [--chain-id <id>] [--limit <n>] [--include-events|--no-events] [--with-lp] [--rpc-url <url>]',
      });
    } else {
      console.log(
        'Usage: pandora [--output table|json] portfolio --wallet <address> [--chain-id <id>] [--limit <n>] [--include-events|--no-events] [--with-lp] [--rpc-url <url>]',
      );
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
    withLp: options.withLp,
    summary: snapshot.summary,
    positions: snapshot.positions,
    lpPositions: snapshot.lpPositions,
    events: snapshot.events,
    diagnostics: snapshot.diagnostics,
  };

  emitSuccess(context.outputMode, 'portfolio', payload, renderPortfolioTable);
}

async function runWatchCommand(args, context) {
  return runWatchCommandFromService(args, context);
}

async function runSportsCommand(args, context) {
  return runSportsCommandFromService(args, context);
}

async function runLifecycleCommand(args, context) {
  return runLifecycleCommandFromService(args, context);
}

async function runArbCommand(args, context) {
  return runArbCommandFromService(args, context);
}

async function runOddsCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  if (!shared.rest.length || includesHelpFlag(shared.rest)) {
    const usage =
      'pandora [--output table|json] odds record --competition <id> --interval <sec> [--max-samples <n>] [--event-id <id>] [--venues pandora_amm,polymarket] [--indexer-url <url>] [--polymarket-host <url>] [--polymarket-mock-url <url>] [--timeout-ms <ms>]';
    const historyUsage =
      'pandora [--output table|json] odds history --event-id <id> --output csv|json [--limit <n>]';
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'odds.help', {
        usage,
        historyUsage,
      });
    } else {
      console.log(`Usage: ${usage}`);
      console.log(`       ${historyUsage}`);
    }
    return;
  }

  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
  const parsed = parseOddsFlagsFromModule(shared.rest);
  const options = parsed.options || {};

  const historyService = createOddsHistoryService();
  const connectorFactory = createVenueConnectorFactory();

  if (parsed.action === 'record') {
    const intervalMs = Number(options.intervalSec) * 1000;
    const maxSamples = Number.isInteger(options.maxSamples) && options.maxSamples > 0 ? options.maxSamples : 1;
    const sampleResults = [];
    let insertedTotal = 0;

    for (let sample = 1; sample <= maxSamples; sample += 1) {
      const rows = [];
      const diagnostics = [];
      for (const venue of options.venues) {
        try {
          const connector = connectorFactory.createConnector(venue, {
            indexerUrl,
            host: options.polymarketHost || null,
            mockUrl: options.polymarketMockUrl || null,
            timeoutMs: options.timeoutMs || shared.timeoutMs,
          });
          const pricePayload = await connector.getPrice({
            competition: options.competition,
            eventId: options.eventId,
            indexerUrl,
            host: options.polymarketHost || null,
            mockUrl: options.polymarketMockUrl || null,
            timeoutMs: options.timeoutMs || shared.timeoutMs,
          });
          if (pricePayload && Array.isArray(pricePayload.items)) {
            rows.push(...pricePayload.items);
          }
        } catch (err) {
          diagnostics.push({
            venue,
            code: err && err.code ? String(err.code) : 'ODDS_RECORD_CONNECTOR_FAILED',
            message: err && err.message ? err.message : String(err),
          });
        }
      }

      const writeResult = historyService.recordEntries(rows);
      insertedTotal += writeResult.inserted;
      sampleResults.push({
        sample,
        observedAt: new Date().toISOString(),
        inserted: writeResult.inserted,
        diagnostics,
      });

      if (sample < maxSamples) {
        await sleepMs(intervalMs);
      }
    }

    const payload = {
      schemaVersion: '1.0.0',
      generatedAt: new Date().toISOString(),
      action: 'record',
      competition: options.competition,
      eventId: options.eventId || null,
      intervalSec: options.intervalSec,
      maxSamples,
      venues: options.venues,
      backend: historyService.backend,
      storage: historyService.paths,
      insertedTotal,
      samples: sampleResults,
    };
    emitSuccess(context.outputMode, 'odds.record', payload, renderSingleEntityTable);
    return;
  }

  const rows = historyService.queryByEventId(options.eventId, {
    limit: options.limit,
  });
  const basePayload = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    action: 'history',
    eventId: options.eventId,
    backend: historyService.backend,
    storage: historyService.paths,
    count: rows.length,
    items: rows,
  };

  if (options.output === 'csv') {
    const csv = historyService.formatRows(rows, 'csv');
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'odds.history', {
        ...basePayload,
        output: 'csv',
        csv,
      });
    } else {
      console.log(csv);
    }
    return;
  }

  if (context.outputMode === 'json') {
    emitSuccess(context.outputMode, 'odds.history', {
      ...basePayload,
      output: 'json',
    });
  } else {
    console.log(JSON.stringify(basePayload, null, 2));
  }
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
  const options = parseAutopilotFlagsFromModule(shared.rest);

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
      await assertLiveWriteAllowed('autopilot.execute-live', {
        notionalUsdc: executionOptions.amountUsdc,
        runtimeMode: 'live',
      });
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

function toMirrorSelector(options = {}) {
  return {
    pandoraMarketAddress: options.pandoraMarketAddress || null,
    polymarketMarketId: options.polymarketMarketId || null,
    polymarketSlug: options.polymarketSlug || null,
  };
}

function resolveTrustedDeployPair(options = {}) {
  const selector = toMirrorSelector(options);
  const manifestFile = options.manifestFile || defaultMirrorManifestFile();
  const lookup = findMirrorPair(manifestFile, selector);
  if (!lookup.pair || lookup.pair.trusted === false) {
    throw new CliError(
      'TRUST_DEPLOY_PAIR_NOT_FOUND',
      'Trusted deploy pair not found in mirror manifest. Run mirror deploy --execute first or pass explicit pair mapping.',
      {
        manifestFile: lookup.filePath,
        selector,
      },
    );
  }

  return {
    trustDeploy: true,
    trustPair: lookup.pair,
    manifestFile: lookup.filePath,
  };
}

async function toMirrorStatusLivePayload(verifyPayload, state, options) {
  const pandoraYesPct = verifyPayload && verifyPayload.pandora ? Number(verifyPayload.pandora.yesPct) : null;
  const sourceYesPct = verifyPayload && verifyPayload.sourceMarket ? Number(verifyPayload.sourceMarket.yesPct) : null;
  const driftBps =
    Number.isFinite(sourceYesPct) && Number.isFinite(pandoraYesPct)
      ? Math.round(Math.abs(sourceYesPct - pandoraYesPct) * 10000) / 100
      : null;
  const reserveYesUsdc = verifyPayload && verifyPayload.pandora ? Number(verifyPayload.pandora.reserveYes) : null;
  const reserveNoUsdc = verifyPayload && verifyPayload.pandora ? Number(verifyPayload.pandora.reserveNo) : null;
  const deltaLpUsdc =
    Number.isFinite(reserveYesUsdc) && Number.isFinite(reserveNoUsdc)
      ? Math.round((reserveYesUsdc - reserveNoUsdc) * 1e6) / 1e6
      : null;
  const targetHedgeUsdc = deltaLpUsdc === null ? null : Math.round((-deltaLpUsdc) * 1e6) / 1e6;
  const currentHedgeUsdc = Number.isFinite(Number(state.currentHedgeUsdc)) ? Number(state.currentHedgeUsdc) : 0;
  const hedgeGapUsdc = targetHedgeUsdc === null ? null : Math.round((targetHedgeUsdc - currentHedgeUsdc) * 1e6) / 1e6;

  const gateChecks = verifyPayload && verifyPayload.gateResult && Array.isArray(verifyPayload.gateResult.checks)
    ? verifyPayload.gateResult.checks
    : [];
  const lifecycleCheck = gateChecks.find((item) => item.code === 'LIFECYCLE_ACTIVE');
  const notExpiredCheck = gateChecks.find((item) => item.code === 'NOT_EXPIRED');

  const cumulativeLpFeesApproxUsdc = Number.isFinite(Number(state.cumulativeLpFeesApproxUsdc))
    ? Number(state.cumulativeLpFeesApproxUsdc)
    : 0;
  const cumulativeHedgeCostApproxUsdc = Number.isFinite(Number(state.cumulativeHedgeCostApproxUsdc))
    ? Number(state.cumulativeHedgeCostApproxUsdc)
    : 0;
  const netPnlApproxUsdc = Math.round((cumulativeLpFeesApproxUsdc - cumulativeHedgeCostApproxUsdc) * 1e6) / 1e6;

  let positionSummary = {
    yesBalance: null,
    noBalance: null,
    openOrdersCount: null,
    estimatedValueUsd: null,
    positionDeltaApprox: null,
    diagnostics: [],
  };
  try {
    positionSummary = await fetchPolymarketPositionSummary({
      market: verifyPayload && verifyPayload.sourceMarket ? verifyPayload.sourceMarket : {},
      host: options.polymarketHost || null,
      mockUrl: options.polymarketMockUrl || null,
      timeoutMs: options.timeoutMs,
    });
  } catch (err) {
    positionSummary = {
      yesBalance: null,
      noBalance: null,
      openOrdersCount: null,
      estimatedValueUsd: null,
      positionDeltaApprox: null,
      diagnostics: [`Position summary unavailable: ${err && err.message ? err.message : String(err)}`],
    };
  }

  const hedgePositionDeltaApprox = Number.isFinite(Number(positionSummary.positionDeltaApprox))
    ? Number(positionSummary.positionDeltaApprox)
    : null;
  const netDeltaCandidates = [deltaLpUsdc, hedgePositionDeltaApprox].filter((value) => Number.isFinite(value));
  const netDeltaApprox = netDeltaCandidates.length
    ? Math.round(netDeltaCandidates.reduce((sum, value) => sum + value, 0) * 1e6) / 1e6
    : null;
  const pnlApprox = Number.isFinite(Number(positionSummary.estimatedValueUsd))
    ? Math.round((netPnlApproxUsdc + Number(positionSummary.estimatedValueUsd)) * 1e6) / 1e6
    : netPnlApproxUsdc;

  const minTimeToExpirySec =
    verifyPayload && verifyPayload.expiry && Number.isFinite(Number(verifyPayload.expiry.minTimeToExpirySec))
      ? Number(verifyPayload.expiry.minTimeToExpirySec)
      : null;

  return {
    generatedAt: new Date().toISOString(),
    pandoraYesPct: Number.isFinite(pandoraYesPct) ? pandoraYesPct : null,
    sourceYesPct: Number.isFinite(sourceYesPct) ? sourceYesPct : null,
    driftBps,
    driftTriggerBps: options.driftTriggerBps,
    driftTriggered: driftBps !== null ? driftBps >= options.driftTriggerBps : false,
    reserveYesUsdc: Number.isFinite(reserveYesUsdc) ? reserveYesUsdc : null,
    reserveNoUsdc: Number.isFinite(reserveNoUsdc) ? reserveNoUsdc : null,
    deltaLpUsdc,
    targetHedgeUsdc,
    currentHedgeUsdc,
    hedgeGapUsdc,
    hedgeTriggerUsdc: options.hedgeTriggerUsdc,
    hedgeTriggered: hedgeGapUsdc !== null ? Math.abs(hedgeGapUsdc) >= options.hedgeTriggerUsdc : false,
    lifecycleActive: lifecycleCheck ? Boolean(lifecycleCheck.ok) : null,
    notExpired: notExpiredCheck ? Boolean(notExpiredCheck.ok) : null,
    minTimeToExpirySec,
    cumulativeLpFeesApproxUsdc,
    cumulativeHedgeCostApproxUsdc,
    netPnlApproxUsdc,
    netDeltaApprox,
    pnlApprox,
    polymarketPosition: {
      yesBalance: Number.isFinite(Number(positionSummary.yesBalance)) ? Number(positionSummary.yesBalance) : null,
      noBalance: Number.isFinite(Number(positionSummary.noBalance)) ? Number(positionSummary.noBalance) : null,
      openOrdersCount:
        Number.isInteger(positionSummary.openOrdersCount)
          ? positionSummary.openOrdersCount
          : Number.isFinite(Number(positionSummary.openOrdersCount))
            ? Math.trunc(Number(positionSummary.openOrdersCount))
            : null,
      estimatedValueUsd: Number.isFinite(Number(positionSummary.estimatedValueUsd))
        ? Number(positionSummary.estimatedValueUsd)
        : null,
      diagnostics: Array.isArray(positionSummary.diagnostics) ? positionSummary.diagnostics : [],
    },
    gateResult: verifyPayload.gateResult,
    matchConfidence: verifyPayload.matchConfidence,
    verifyDiagnostics: verifyPayload.diagnostics || [],
    sourceMarket: {
      marketId: verifyPayload.sourceMarket && verifyPayload.sourceMarket.marketId ? verifyPayload.sourceMarket.marketId : null,
      slug: verifyPayload.sourceMarket && verifyPayload.sourceMarket.slug ? verifyPayload.sourceMarket.slug : null,
      question: verifyPayload.sourceMarket && verifyPayload.sourceMarket.question ? verifyPayload.sourceMarket.question : null,
      active: verifyPayload.sourceMarket ? Boolean(verifyPayload.sourceMarket.active) : null,
      resolved: verifyPayload.sourceMarket ? Boolean(verifyPayload.sourceMarket.resolved) : null,
      closeTimestamp: verifyPayload.sourceMarket && verifyPayload.sourceMarket.closeTimestamp !== undefined
        ? verifyPayload.sourceMarket.closeTimestamp
        : null,
    },
    pandoraMarket: {
      marketAddress: verifyPayload.pandora && verifyPayload.pandora.marketAddress ? verifyPayload.pandora.marketAddress : null,
      pollAddress: verifyPayload.pandora && verifyPayload.pandora.pollAddress ? verifyPayload.pandora.pollAddress : null,
      question: verifyPayload.pandora && verifyPayload.pandora.question ? verifyPayload.pandora.question : null,
      active: verifyPayload.pandora ? Boolean(verifyPayload.pandora.active) : null,
      resolved: verifyPayload.pandora ? Boolean(verifyPayload.pandora.resolved) : null,
      closeTimestamp: verifyPayload.pandora && verifyPayload.pandora.closeTimestamp !== undefined
        ? verifyPayload.pandora.closeTimestamp
        : null,
    },
  };
}

function renderMirrorSyncTickLine(tickContext, outputMode) {
  const snapshot = tickContext.snapshot || {};
  const metrics = snapshot.metrics || {};
  const strictGate = snapshot.strictGate || {};
  const action = snapshot.action || null;
  const actionStatus = action && action.status ? action.status : 'idle';
  const gateCode =
    action && Array.isArray(action.failedChecks) && action.failedChecks.length
      ? action.forcedGateBypass
        ? `forced:${action.failedChecks[0]}`
        : action.failedChecks[0]
      : '';

  if (outputMode === 'json') {
    console.log(
      JSON.stringify({
        event: 'mirror.sync.tick',
        timestamp: tickContext.timestamp,
        tick: tickContext.iteration,
        driftBps: metrics.driftBps,
        plannedRebalanceUsdc: metrics.plannedRebalanceUsdc,
        plannedHedgeUsdc: metrics.plannedHedgeUsdc,
        gateOk: strictGate.ok,
        gateCode,
        actionStatus,
      }),
    );
    return;
  }

  const ts = tickContext.timestamp || new Date().toISOString();
  const drift = metrics.driftBps === null || metrics.driftBps === undefined ? 'n/a' : `${metrics.driftBps}`;
  const rebalance = metrics.plannedRebalanceUsdc === undefined ? '0' : String(metrics.plannedRebalanceUsdc);
  const hedge = metrics.plannedHedgeUsdc === undefined ? '0' : String(metrics.plannedHedgeUsdc);
  const gateText = strictGate.ok ? 'ok' : gateCode || 'blocked';
  console.log(`[${ts}] tick=${tickContext.iteration} drift=${drift}bps rebalance=$${rebalance} hedge=$${hedge} action=${actionStatus} gate=${gateText}`);
}

function coerceMirrorServiceError(err, fallbackCode = 'MIRROR_ERROR') {
  if (err instanceof CliError) return err;
  if (err && err.code) {
    return new CliError(err.code, err.message || 'Mirror command failed.', err.details);
  }
  return new CliError(fallbackCode, err && err.message ? err.message : String(err));
}

async function runLivePolymarketPreflightForMirror(options = {}) {
  const preflightOptions = {};
  if (options.rpcUrl) preflightOptions.rpcUrl = options.rpcUrl;
  if (options.privateKey) preflightOptions.privateKey = options.privateKey;
  if (options.funder) preflightOptions.funder = options.funder;
  else if (process.env.POLYMARKET_FUNDER) preflightOptions.funder = process.env.POLYMARKET_FUNDER;

  try {
    return await runPolymarketPreflight(preflightOptions);
  } catch (err) {
    if (err && err.code) {
      throw new CliError(err.code, err.message || 'Polymarket live preflight failed.', err.details);
    }
    throw err;
  }
}

const runMirrorCommand = createRunMirrorCommand({
  CliError,
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  parseIndexerSharedFlags,
  maybeLoadIndexerEnv,
  maybeLoadTradeEnv,
  resolveIndexerUrl,
  parseMirrorBrowseFlags: parseMirrorBrowseFlagsFromModule,
  parseMirrorPlanFlags: parseMirrorPlanFlagsFromModule,
  parseMirrorDeployFlags: parseMirrorDeployFlagsFromModule,
  parseMirrorVerifyFlags: parseMirrorVerifyFlagsFromModule,
  parseMirrorStatusFlags: parseMirrorStatusFlagsFromModule,
  parseMirrorSyncFlags: parseMirrorSyncFlagsFromModule,
  parseMirrorSyncDaemonSelectorFlags: parseMirrorSyncDaemonSelectorFlagsFromModule,
  parseMirrorGoFlags: parseMirrorGoFlagsFromModule,
  parseMirrorCloseFlags: parseMirrorCloseFlagsFromModule,
  parseMirrorLpExplainFlags: parseMirrorLpExplainFlagsFromModule,
  parseMirrorHedgeCalcFlags: parseMirrorHedgeCalcFlagsFromModule,
  parseMirrorSimulateFlags: parseMirrorSimulateFlagsFromModule,
  buildMirrorPlan,
  deployMirror,
  verifyMirror,
  browseMirrorMarkets,
  buildMirrorLpExplain,
  buildMirrorHedgeCalc,
  buildMirrorSimulate,
  runMirrorSync,
  startMirrorDaemon,
  stopMirrorDaemon,
  mirrorDaemonStatus,
  buildMirrorClosePlan,
  resolveTrustedDeployPair,
  toMirrorStatusLivePayload,
  coerceMirrorServiceError,
  runLivePolymarketPreflightForMirror,
  buildMirrorSyncStrategy,
  mirrorStrategyHash,
  buildMirrorSyncDaemonCliArgs,
  buildQuotePayload,
  executeTradeOnchain,
  assertLiveWriteAllowed,
  hasWebhookTargets,
  sendWebhookNotifications,
  loadMirrorState,
  renderMirrorSyncTickLine,
  renderMirrorBrowseTable,
  renderMirrorPlanTable,
  renderMirrorDeployTable,
  renderMirrorVerifyTable,
  renderMirrorLpExplainTable,
  renderMirrorHedgeCalcTable,
  renderMirrorSimulateTable,
  renderMirrorGoTable,
  renderMirrorSyncTable,
  renderMirrorSyncDaemonTable,
  renderMirrorStatusTable,
  renderMirrorCloseTable,
  cliPath: __filename,
});


async function runPolymarketCommand(args, context) {
  return runPolymarketCommandFromService(args, context);
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

  if (includesHelpFlag(actionArgs)) {
    const usage =
      'pandora [--output table|json] webhook test [--webhook-url <url>] [--webhook-template <json>] [--webhook-secret <secret>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>] [--webhook-timeout-ms <ms>] [--webhook-retries <n>]';
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'webhook.test.help', commandHelpPayload(usage));
    } else {
      console.log(`Usage: ${usage}`);
    }
    return;
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
    if (isAnalyzeProviderError(err)) {
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
  let history;
  let arbitrage;
  try {
    history = await fetchHistory({
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
    arbitrage = await scanArbitrage({
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
  } catch (err) {
    if (err && err.code) {
      throw new CliError(err.code, err.message || 'suggest failed.', err.details);
    }
    throw err;
  }

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

async function runResolveCommand(args, context) {
  return runResolveCommandFromService(args, context);
}

async function runLpCommand(args, context) {
  return runLpCommandFromService(args, context);
}

async function runRiskCommand(args, context) {
  return runRiskCommandFromService(args, context);
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
  try {
    fs.chmodSync(options.envFile, 0o600);
  } catch {
    // best-effort hardening on platforms that ignore/limit chmod
  }

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
    try {
      fs.chmodSync(options.envFile, 0o600);
    } catch {
      // best-effort hardening on pre-existing files
    }
    envStep = {
      status: 'skipped',
      message: `Env file exists at ${options.envFile}. Reusing existing file.`,
      envFile: options.envFile,
      force: false,
    };
  } else {
    fs.mkdirSync(path.dirname(options.envFile), { recursive: true });
    fs.copyFileSync(options.exampleFile, options.envFile);
    try {
      fs.chmodSync(options.envFile, 0o600);
    } catch {
      // best-effort hardening on platforms that ignore/limit chmod
    }
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
    checkPolymarket: options.checkPolymarket,
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

const dispatch = createCommandRouter({
  CliError,
  packageVersion: PACKAGE_VERSION,
  emitSuccess,
  helpJsonPayload,
  printHelpTable,
  includesHelpFlag,
  commandHelpPayload,
  runInitEnv,
  runDoctor,
  runSetup,
  runMarketsCommand,
  runScanCommand,
  runSportsCommand,
  runLifecycleCommand,
  runArbCommand,
  runOddsCommand,
  runQuoteCommand,
  runTradeCommand,
  runPollsCommand,
  runEventsCommand,
  runPositionsCommand,
  runPortfolioCommand,
  runWatchCommand,
  runHistoryCommand,
  runExportCommand,
  runArbitrageCommand,
  runAutopilotCommand,
  runMirrorCommand,
  runPolymarketCommand,
  runWebhookCommand,
  runLeaderboardCommand,
  runAnalyzeCommand,
  runSuggestCommand,
  runResolveCommand,
  runLpCommand,
  runRiskCommand,
  runMcpCommand,
  runStreamCommand,
  runSchemaCommand,
  runScriptCommand,
});

async function main() {
  const rawArgv = expandEqualsStyleFlags(process.argv.slice(2));
  let outputMode = inferRequestedOutputMode(rawArgv);
  let args = rawArgv;

  try {
    const parsed = extractOutputMode(rawArgv);
    outputMode = parsed.outputMode;
    args = parsed.args;
  } catch (err) {
    // Keep parse-time failures machine-readable for agent callers even when
    // --output itself is malformed or missing.
    emitFailure('json', err);
    return;
  }

  if (args[0] === 'pandora') {
    args = args.slice(1);
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  try {
    await dispatch(command, commandArgs, { outputMode });
  } catch (err) {
    emitFailure(outputMode, err);
  }
}

function installGlobalCrashHandlers() {
  const outputMode = inferRequestedOutputMode(expandEqualsStyleFlags(process.argv.slice(2)));
  const normalizedOutputMode = outputMode === 'json' ? 'json' : 'table';

  const emitFatal = (error, code) => {
    const fatalError =
      error instanceof Error
        ? error
        : new CliError(code, formatErrorValue(error || code));

    try {
      emitFailure(normalizedOutputMode, fatalError);
    } catch (handlerErr) {
      try {
        console.error(`[${code}] ${formatErrorValue(fatalError)}`);
        console.error(`Fatal handler failure: ${formatErrorValue(handlerErr)}`);
      } finally {
        process.exit(1);
      }
    }
  };

  process.on('uncaughtException', (error) => {
    emitFatal(error, 'UNCAUGHT_EXCEPTION');
  });

  process.on('unhandledRejection', (reason) => {
    emitFatal(reason, 'UNHANDLED_REJECTION');
  });
}

installGlobalCrashHandlers();
main();
