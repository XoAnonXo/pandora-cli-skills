#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createCommandRouter } = require('./lib/command_router.cjs');
const { createCliOutputService } = require('./lib/cli_output_service.cjs');
const { createErrorRecoveryService } = require('./lib/error_recovery_service.cjs');
const { createCoreCommandFlagParsers } = require('./lib/parsers/core_command_flags.cjs');
const {
  resolveTradeBuyCall,
  resolveTradeSellCall,
  normalizePandoraMarketType,
} = require('./lib/trade_market_type_service.cjs');
const {
  DEFAULT_FLASHBOTS_RELAY_URL,
  DEFAULT_FLASHBOTS_TARGET_BLOCK_OFFSET,
  FLASHBOTS_SUPPORTED_CHAIN_ID,
  normalizeFlashbotsRelayUrl,
  normalizeTargetBlockOffset,
  sendFlashbotsPrivateTransaction,
  sendFlashbotsBundle,
} = require('./lib/flashbots_service.cjs');
const { executeTradeWithRoute } = require('./lib/trade_execution_route_service.cjs');
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

/**
 * Lazily creates and memoizes a factory product from a CommonJS module export.
 * @param {string} modulePath
 * @param {string} exportName
 * @param {() => object} buildDeps
 * @returns {() => any}
 */
function createLazyFactoryValue(modulePath, exportName, buildDeps) {
  let cached = null;
  return function getFactoryValue() {
    if (!cached) {
      const mod = require(modulePath);
      const factory = mod && mod[exportName];
      if (typeof factory !== 'function') {
        throw new Error(`Expected ${exportName} to be a function from ${modulePath}.`);
      }
      cached = factory(buildDeps());
    }
    return cached;
  };
}

/**
 * Lazily creates a factory product and forwards calls to it.
 * @param {string} modulePath
 * @param {string} exportName
 * @param {() => object} buildDeps
 * @returns {(...args: any[]) => any}
 */
function createLazyFactoryRunner(modulePath, exportName, buildDeps) {
  const getFactoryValue = createLazyFactoryValue(modulePath, exportName, buildDeps);
  return function runLazyFactoryProduct(...args) {
    return getFactoryValue()(...args);
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
const getAmmTargetPctService = createLazyModuleLoader('./lib/amm_target_pct_service.cjs');
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
const getExecutionSignerService = createLazyModuleLoader('./lib/signers/execution_signer_service.cjs');
const getOperationStateStore = createLazyModuleLoader('./lib/operation_state_store.cjs');
const getOperationServiceModule = createLazyModuleLoader('./lib/operation_service.cjs');
const getRiskGuardService = createLazyModuleLoader('./lib/risk_guard_service.cjs');
const getOperationEventBusModule = createLazyModuleLoader('./lib/operation_event_bus.cjs');
const getOperationWebhookServiceModule = createLazyModuleLoader('./lib/operation_webhook_service.cjs');
const getForecastStore = createLazyModuleLoader('./lib/forecast_store.cjs');
const getBrierScoreService = createLazyModuleLoader('./lib/brier_score_service.cjs');
const getSchemaCommandService = createLazyModuleLoader('./lib/schema_command_service.cjs');
const getCapabilitiesCommandService = createLazyModuleLoader('./lib/capabilities_command_service.cjs');
const getBootstrapCommandService = createLazyModuleLoader('./lib/bootstrap_command_service.cjs');
const getAgentCommandService = createLazyModuleLoader('./lib/agent_command_service.cjs');
const getMcpServerService = createLazyModuleLoader('./lib/mcp_server_service.cjs');
const getStreamCommandService = createLazyModuleLoader('./lib/stream_command_service.cjs');
const getSimulateCommandService = createLazyModuleLoader('./lib/simulate_command_service.cjs');
const getOperationsCommandService = createLazyModuleLoader('./lib/operations_command_service.cjs');
const getOperationsFlagsModule = createLazyModuleLoader('./lib/parsers/operations_flags.cjs');
const getProfileFlagsModule = createLazyModuleLoader('./lib/parsers/profile_flags.cjs');
const getRecipeFlagsModule = createLazyModuleLoader('./lib/parsers/recipe_flags.cjs');
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
const getIndexerClientService = createLazyModuleLoader('./lib/indexer_client.cjs');
const getMarketsMineService = createLazyModuleLoader('./lib/markets_mine_service.cjs');
const getPolymarketAdapter = createLazyModuleLoader('./lib/polymarket_adapter.cjs');
const getSimilarityService = createLazyModuleLoader('./lib/similarity_service.cjs');

/** Proxy to history service fetch. */
function fetchHistory(...args) {
  return getHistoryService().fetchHistory(...args);
}

/** Proxy to export payload builder. */
function buildExportPayload(...args) {
  return getExportService().buildExportPayload(...args);
}

/** Proxy to shared indexer client factory. */
function createIndexerClient(...args) {
  return getIndexerClientService().createIndexerClient(...args);
}

/** Proxy to Polymarket market discovery adapter. */
function fetchPolymarketMarkets(...args) {
  return getPolymarketAdapter().fetchPolymarketMarkets(...args);
}

/** Proxy to shared similarity scoring. */
function questionSimilarityBreakdown(...args) {
  return getSimilarityService().questionSimilarityBreakdown(...args);
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

/** Proxy to mirror runtime telemetry builder. */
function buildMirrorRuntimeTelemetry(...args) {
  return require('./lib/mirror_sync/state.cjs').buildMirrorRuntimeTelemetry(...args);
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

/** Proxy to mirror surface state resolver. */
function resolveMirrorSurfaceState(...args) {
  return require('./lib/mirror_surface_service.cjs').resolveMirrorSurfaceState(...args);
}

/** Proxy to mirror surface daemon-status resolver. */
function resolveMirrorSurfaceDaemonStatus(...args) {
  return require('./lib/mirror_surface_service.cjs').resolveMirrorSurfaceDaemonStatus(...args);
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

/** Proxy to mirror close workflow service. */
function runMirrorClose(...args) {
  return getMirrorCloseService().runMirrorClose(...args);
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

/** Proxy to Polymarket balance flow. */
function runPolymarketBalance(...args) {
  return getPolymarketOpsService().runPolymarketBalance(...args);
}

/** Proxy to Polymarket positions flow. */
function runPolymarketPositions(...args) {
  return getPolymarketOpsService().runPolymarketPositions(...args);
}

/** Proxy to Polymarket merge-readiness derivation. */
function buildPolymarketMergeReadiness(...args) {
  return getPolymarketOpsService().buildPolymarketMergeReadiness(...args);
}

/** Proxy to Polymarket balance-scope derivation. */
function buildPolymarketBalanceScope(...args) {
  return getPolymarketOpsService().buildPolymarketBalanceScope(...args);
}

/** Proxy to Polymarket deposit flow. */
function runPolymarketDeposit(...args) {
  return getPolymarketOpsService().runPolymarketDeposit(...args);
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

/** Proxy to market claim helper. */
function runClaim(...args) {
  return getMarketAdminService().runClaim(...args);
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
let cachedOperationService = null;
let cachedOperationEventBus = null;
let cachedOperationWebhookService = null;

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

function getOperationEventBus() {
  if (!cachedOperationEventBus) {
    cachedOperationEventBus = getOperationEventBusModule().createOperationEventBus();
  }
  return cachedOperationEventBus;
}

function getOperationWebhookService() {
  if (!cachedOperationWebhookService) {
    cachedOperationWebhookService = getOperationWebhookServiceModule().createOperationWebhookService({
      hasWebhookTargets,
      sendWebhookNotifications,
    });
  }
  return cachedOperationWebhookService;
}

function mapOperationStatusToPublic(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'running') return 'executing';
  if (normalized === 'succeeded') return 'completed';
  if (normalized === 'cancelled') return 'canceled';
  return normalized || 'planned';
}

function mapOperationStatusToStore(status, mode) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'validated') return 'validated';
  if (normalized === 'queued' || normalized === 'submitted') return 'queued';
  if (normalized === 'running' || normalized === 'executing' || normalized === 'active') return 'running';
  if (normalized === 'completed' || normalized === 'succeeded' || normalized === 'success' || normalized === 'no-op') {
    return 'succeeded';
  }
  if (normalized === 'failed' || normalized === 'partial' || normalized === 'blocked' || normalized === 'unsafe') {
    return 'failed';
  }
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
  if (normalized === 'closed') return 'closed';
  if (String(mode || '').trim().toLowerCase() === 'execute') return 'queued';
  return 'planned';
}

function choosePersistedOperationStatus(existingStatus, nextStatus) {
  const rank = {
    planned: 1,
    validated: 2,
    queued: 3,
    running: 4,
    failed: 5,
    succeeded: 5,
    cancelled: 5,
    closed: 6,
  };
  const current = String(existingStatus || '').trim().toLowerCase();
  const next = String(nextStatus || '').trim().toLowerCase();
  if (!current) return next || 'planned';
  if (!next) return current;
  if (!rank[current] || !rank[next]) return next;
  return rank[current] >= rank[next] ? current : next;
}

function deriveOperationTool(command) {
  const normalized = typeof command === 'string' ? command.trim() : '';
  if (!normalized) return null;
  return normalized.split('.')[0] || normalized;
}

function deriveOperationAction(command) {
  const normalized = typeof command === 'string' ? command.trim() : '';
  if (!normalized || !normalized.includes('.')) return null;
  return normalized.split('.').slice(1).join('.') || null;
}

function isPublicOperationCancelable(status) {
  return !['completed', 'failed', 'canceled', 'closed'].includes(mapOperationStatusToPublic(status));
}

function isPublicOperationClosable(status) {
  return ['completed', 'failed', 'canceled'].includes(mapOperationStatusToPublic(status));
}

async function normalizeOperationPayloadFromStore(store, record, options = {}) {
  const operation = record && typeof record === 'object' ? record : null;
  if (!operation) return null;

  let checkpoints = [];
  if (options.includeCheckpoints !== false && store && typeof store.readCheckpoints === 'function') {
    const checkpointResult = await store.readCheckpoints(operation.operationId);
    checkpoints = Array.isArray(checkpointResult && checkpointResult.items) ? checkpointResult.items : [];
  }

  return {
    operationId: operation.operationId,
    operationHash: operation.operationHash || null,
    tool: deriveOperationTool(operation.command),
    action: deriveOperationAction(operation.command),
    command: operation.command || null,
    summary: operation.summary || operation.description || null,
    status: mapOperationStatusToPublic(operation.status),
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    policyPack: operation.metadata && typeof operation.metadata.policyPack === 'string' ? operation.metadata.policyPack : null,
    profile: operation.metadata && typeof operation.metadata.profile === 'string' ? operation.metadata.profile : null,
    environment: operation.metadata && typeof operation.metadata.environment === 'string' ? operation.metadata.environment : null,
    mode: operation.metadata && typeof operation.metadata.mode === 'string' ? operation.metadata.mode : null,
    scope: operation.scope || null,
    cancelable: isPublicOperationCancelable(operation.status),
    closable: isPublicOperationClosable(operation.status),
    input: operation.request && typeof operation.request === 'object' ? operation.request : {},
    normalizedInput: operation.request && typeof operation.request === 'object' ? operation.request : {},
    checkpoints: checkpoints.map((checkpoint) => ({
      ...checkpoint,
      status: checkpoint && checkpoint.status ? mapOperationStatusToPublic(checkpoint.status) : checkpoint.status || null,
    })),
    metadata: operation.metadata && typeof operation.metadata === 'object' ? operation.metadata : {},
    result: operation.result === undefined ? null : operation.result,
    recovery: operation.recovery === undefined ? null : operation.recovery,
    error: operation.error === undefined ? null : operation.error,
    validatedAt: operation.validatedAt || null,
    queuedAt: operation.queuedAt || null,
    startedAt: operation.startedAt || null,
    completedAt: operation.completedAt || operation.succeededAt || null,
    failedAt: operation.failedAt || null,
    canceledAt: operation.cancelledAt || null,
    closedAt: operation.closedAt || null,
  };
}

function buildOperationSummaryFromPayload(payload, operationContext) {
  if (payload && typeof payload.summary === 'string' && payload.summary.trim()) {
    return payload.summary.trim();
  }
  if (payload && payload.summary && typeof payload.summary === 'object') {
    if (typeof payload.summary.message === 'string' && payload.summary.message.trim()) {
      return payload.summary.message.trim();
    }
    if (typeof payload.summary.status === 'string' && payload.summary.status.trim()) {
      return payload.summary.status.trim();
    }
  }
  if (payload && typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message.trim();
  }
  if (operationContext && typeof operationContext.command === 'string' && operationContext.command.trim()) {
    return operationContext.command.trim();
  }
  return null;
}

function buildOperationResultSnapshot(payload, operationContext) {
  return {
    mode: payload && payload.mode ? payload.mode : (operationContext && operationContext.mode) || null,
    status: payload && payload.status ? payload.status : (operationContext && operationContext.status) || null,
    summary: payload && payload.summary ? payload.summary : null,
    target: operationContext && operationContext.target ? operationContext.target : null,
  };
}

function getOperationWebhookTargetsFromEnv() {
  const targets = {};
  if (process.env.PANDORA_OPERATION_WEBHOOK_URL) {
    targets.webhookUrl = process.env.PANDORA_OPERATION_WEBHOOK_URL;
  }
  if (process.env.PANDORA_OPERATION_DISCORD_WEBHOOK_URL) {
    targets.discordWebhookUrl = process.env.PANDORA_OPERATION_DISCORD_WEBHOOK_URL;
  }
  if (process.env.PANDORA_OPERATION_TELEGRAM_BOT_TOKEN && process.env.PANDORA_OPERATION_TELEGRAM_CHAT_ID) {
    targets.telegramBotToken = process.env.PANDORA_OPERATION_TELEGRAM_BOT_TOKEN;
    targets.telegramChatId = process.env.PANDORA_OPERATION_TELEGRAM_CHAT_ID;
  }
  return targets;
}

async function decorateOperationPayload(payload, operationContext) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !operationContext || typeof operationContext !== 'object') {
    return payload;
  }

  const operationStateStore = getOperationStateStore().createOperationStateStore();
  const candidateOperationId =
    (typeof payload.operationId === 'string' && payload.operationId.trim() ? payload.operationId.trim() : null)
    || (typeof operationContext.operationId === 'string' && operationContext.operationId.trim()
      ? operationContext.operationId.trim()
      : null);
  if (!candidateOperationId) {
    return payload;
  }

  const existingLookup = await operationStateStore.get(candidateOperationId);
  const existingRecord = existingLookup && existingLookup.found ? existingLookup.operation : null;
  const storeStatus = choosePersistedOperationStatus(
    existingRecord && existingRecord.status,
    mapOperationStatusToStore(
      (payload && payload.status) || operationContext.status,
      (payload && payload.mode) || operationContext.mode,
    ),
  );

  const upserted = await operationStateStore.upsert({
    operationId: candidateOperationId,
    command: operationContext.command || null,
    summary: buildOperationSummaryFromPayload(payload, operationContext),
    status: storeStatus,
    scope: operationContext.protocol || null,
    target: operationContext.target || null,
    request: operationContext.target || {},
    result: ['succeeded', 'closed'].includes(storeStatus) ? buildOperationResultSnapshot(payload, operationContext) : null,
    error: storeStatus === 'failed'
      ? {
          code: payload && payload.error && payload.error.code ? payload.error.code : null,
          message: payload && payload.error && payload.error.message
            ? payload.error.message
            : (payload && typeof payload.message === 'string' ? payload.message : null),
        }
      : null,
    metadata: {
      ...((existingRecord && existingRecord.metadata) || {}),
      protocol: operationContext.protocol || null,
      mode: (payload && payload.mode) || operationContext.mode || null,
      runtimeHandle: operationContext.runtimeHandle || null,
      decoratedBy: 'pandora.cli',
    },
  });

  const savedOperation = upserted.operation;
  const publicStatus = mapOperationStatusToPublic(savedOperation.status);
  const event = await getOperationEventBus().emitLifecycleEvent({
    operationId: savedOperation.operationId,
    operationKind: operationContext.command || null,
    phase: publicStatus,
    source: 'cli',
    summary: buildOperationSummaryFromPayload(payload, operationContext),
    data: {
      mode: (payload && payload.mode) || operationContext.mode || null,
      scope: operationContext.protocol || null,
    },
  });

  const webhookTargets = getOperationWebhookTargetsFromEnv();
  if (getOperationWebhookService().hasTargets(webhookTargets)) {
    await getOperationWebhookService().notifyLifecycleEvent(webhookTargets, event.event, {
      metadata: {
        command: operationContext.command || null,
      },
    });
  }

  return {
    ...payload,
    operationId: savedOperation.operationId,
  };
}

function getOperationService() {
  if (!cachedOperationService) {
    const operationStateStore = getOperationStateStore().createOperationStateStore();
    cachedOperationService = getOperationServiceModule().createOperationService({
      operationStateStore,
      operationEventBus: getOperationEventBus(),
      operationWebhookService: getOperationWebhookService(),
      getWebhookTargets: getOperationWebhookTargetsFromEnv,
    });
  }
  return cachedOperationService;
}

/** Proxy to forecast-store append helper. */
function appendForecastRecord(...args) {
  return getForecastStore().appendForecastRecord(...args);
}

/** Proxy to forecast-store default file resolver. */
function defaultForecastFile(...args) {
  return getForecastStore().defaultForecastFile(...args);
}

/** Proxy to forecast-store reader. */
function readForecastRecords(...args) {
  return getForecastStore().readForecastRecords(...args);
}

/** Proxy to Brier scoring report service. */
function computeBrierReport(...args) {
  return getBrierScoreService().computeBrierReport(...args);
}

/** Schema command adapter with CLI output wiring. */
function runSchemaCommand(...args) {
  return getSchemaCommandService().createRunSchemaCommand({ emitSuccess, CliError }).runSchemaCommand(...args);
}

/** Capabilities command adapter with CLI output wiring. */
function runCapabilitiesCommand(...args) {
  return getCapabilitiesCommandService()
    .createRunCapabilitiesCommand({ emitSuccess, CliError })
    .runCapabilitiesCommand(...args);
}

/** Bootstrap command adapter with CLI output wiring. */
function runBootstrapCommand(...args) {
  return getBootstrapCommandService()
    .createRunBootstrapCommand({ emitSuccess, CliError })(...args);
}

function runAgentCommand(...args) {
  return getAgentCommandService().createRunAgentCommand({
    CliError,
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
  }).runAgentCommand(...args);
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

/** Simulation command adapter with Monte Carlo + particle-filter handlers. */
function runSimulateCommand(...args) {
  return getSimulateCommandService().createRunSimulateCommand({
    CliError,
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    parseSimulateMcFlags: parseSimulateMcFlagsFromModule,
    parseSimulateParticleFilterFlags: parseSimulateParticleFilterFlagsFromModule,
  }).runSimulateCommand(...args);
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

/** Deployment argument normalizer proxy. */
function buildDeploymentArgs(...args) {
  return getPandoraDeployService().buildDeploymentArgs(...args);
}

/** Shared Pandora deployment service proxy. */
function deployPandoraMarket(...args) {
  const service = getPandoraDeployService();
  if (typeof service.deployPandoraMarket === 'function') {
    return service.deployPandoraMarket(...args);
  }
  return service.deployPandoraAmmMarket(...args);
}

/** Backward-compatible AMM deployment service proxy. */
function deployPandoraAmmMarket(...args) {
  return deployPandoraMarket(...args);
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
const DEFAULT_ENV_FILE_PRIMARY = path.join(ROOT, 'scripts', '.env');
function resolveCliHomeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || '.';
}

const DEFAULT_ENV_FILE_FALLBACK = path.join(resolveCliHomeDir(), '.pandora-cli.env');
const DEFAULT_ENV_FILE = fs.existsSync(DEFAULT_ENV_FILE_FALLBACK)
  ? DEFAULT_ENV_FILE_FALLBACK
  : fs.existsSync(DEFAULT_ENV_FILE_PRIMARY)
    ? DEFAULT_ENV_FILE_PRIMARY
    : DEFAULT_ENV_FILE_FALLBACK;
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
  'yesChance',
  'reserveYes',
  'reserveNo',
  'feeTier',
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
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
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
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
];
const OUTCOME_TOKEN_REF_ABI = [
  { type: 'function', name: 'yesToken', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'noToken', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'yesTokenAddress', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'noTokenAddress', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
];
const AMM_SELL_QUOTE_ABI = [
  { type: 'function', name: 'calcSellYes', stateMutability: 'view', inputs: [{ type: 'uint112' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'calcSellNo', stateMutability: 'view', inputs: [{ type: 'uint112' }], outputs: [{ type: 'uint256' }] },
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

const errorRecoveryService = createErrorRecoveryService({ cliName: 'pandora' });

const { emitFailure, emitSuccess } = createCliOutputService({
  defaultSchemaVersion: CLI_JSON_SCHEMA_VERSION,
  CliError,
  getRecoveryForError: errorRecoveryService.getRecoveryForError,
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
  pandora [--output table|json] markets list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>|--type <type>] [--where-json <json>] [--active|--resolved|--expiring-soon] [--expiring-hours <n>] [--min-tvl <usdc>] [--hedgeable] [--expand] [--with-odds]
  pandora [--output table|json] markets scan [scan options]
  pandora [--output table|json] markets mine [options]
  pandora [--output table|json] markets get [--id <id> ...] [--stdin]
  pandora [--output table|json] markets create plan|run [create options]
  pandora [--output table|json] markets hype plan|run [hype options]
  pandora [--output table|json] polls list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--status <int>] [--category <int>] [--question-contains <text>] [--where-json <json>]
  pandora [--output table|json] polls get --id <id>
  pandora [--output table|json] events list [--type all|liquidity|oracle-fee|claim] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-direction asc|desc] [--chain-id <id>] [--wallet <address>] [--market-address <address>] [--poll-address <address>] [--tx-hash <hash>]
  pandora [--output table|json] events get --id <id> [--type all|liquidity|oracle-fee|claim]
  pandora [--output table|json] positions list [--wallet <address>] [--market-address <address>] [--chain-id <id>] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--where-json <json>]
  pandora [--output table|json] portfolio --wallet <address> [--chain-id <id>|--all-chains] [--limit <n>] [--include-events|--no-events] [--with-lp] [--rpc-url <url>]
  pandora [--output table|json] watch [--wallet <address>] [--market-address <address>] [--side yes|no] [--amount-usdc <amount>] [--iterations <n>] [--interval-ms <ms>] [--chain-id <id>] [--include-events|--no-events] [--yes-pct <0-100>] [--alert-yes-below <0-100>] [--alert-yes-above <0-100>] [--alert-net-liquidity-below <amount>] [--alert-net-liquidity-above <amount>] [--alert-exposure-above <amount>] [--alert-hedge-gap-above <amount>] [--max-trade-size-usdc <amount>] [--max-daily-volume-usdc <amount>] [--max-total-exposure-usdc <amount>] [--max-per-market-exposure-usdc <amount>] [--max-hedge-gap-usdc <amount>] [--fail-on-alert] [--track-brier] [--brier-source <name>] [--brier-file <path>] [--group-by source|market|competition]
  pandora [--output table|json] scan [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>|--type <type>] [--where-json <json>] [--active|--resolved|--expiring-soon] [--expiring-hours <n>] [--min-tvl <usdc>] [--hedgeable] [--expand]
  pandora [--output table|json] sports schedule|scores|books list|events list|events live|odds snapshot|odds bulk|consensus|create plan|create run|sync once|sync run|sync start|sync stop|sync status|resolve plan ...
  pandora [--output table|json] odds record|history ...
  pandora [--output table|json] lifecycle start|status|resolve ...
  pandora arb scan [--source pandora|polymarket] [--markets <csv>] --output ndjson|json [--limit <n>] [--min-net-spread-pct <n>|--min-spread-pct <n>] [--min-tvl <usdc>] [--fee-pct-per-leg <n>] [--amount-usdc <n>] [--matcher heuristic|hybrid] [--ai-provider auto|none|mock|openai|anthropic] [--ai-model <id>] [--ai-threshold <0-1>] [--ai-max-candidates <n>] [--ai-timeout-ms <ms>] [--interval-ms <ms>] [--iterations <n>] [--indexer-url <url>] [--timeout-ms <ms>]
  pandora [--output table|json] quote [--indexer-url <url>] [--timeout-ms <ms>] --market-address <address> --side yes|no [--mode buy|sell] --amount-usdc <amount>|--shares <amount>|--amounts <csv>|--target-pct <0-100> [--yes-pct <0-100>] [--slippage-bps <0-10000>]
  pandora [--output table|json] trade [--indexer-url <url>] [--timeout-ms <ms>] [--dotenv-path <path>] [--skip-dotenv] --market-address <address> --side yes|no --amount-usdc <amount> --dry-run|--execute [--yes-pct <0-100>] [--slippage-bps <0-10000>] [--min-shares-out-raw <uint>] [--max-amount-usdc <amount>] [--min-probability-pct <0-100>] [--max-probability-pct <0-100>] [--allow-unquoted-execute] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--usdc <address>]
  pandora [--output table|json] sell [--indexer-url <url>] [--timeout-ms <ms>] [--dotenv-path <path>] [--skip-dotenv] --market-address <address> --side yes|no --shares <amount>|--amount <amount> --dry-run|--execute [--yes-pct <0-100>] [--slippage-bps <0-10000>] [--min-amount-out-raw <uint>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--usdc <address>]
  pandora [--output table|json] history --wallet <address> [--chain-id <id>] [--market-address <address>] [--side yes|no|both] [--status all|open|won|lost|closed] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by timestamp|pnl|entry-price|mark-price] [--order-direction asc|desc] [--include-seed]
  pandora [--output table|json] export --wallet <address> --format csv|json [--chain-id <id>] [--year <yyyy>] [--from <unix>] [--to <unix>] [--out <path>]
  pandora [--output table|json] arbitrage [--chain-id <id>] [--venues pandora,polymarket] [--limit <n>] [--min-spread-pct <n>] [--min-liquidity-usdc <n>] [--max-close-diff-hours <n>] [--matcher heuristic|hybrid] [--similarity-threshold <0-1>] [--min-token-score <0-1>] [--ai-provider auto|none|mock|openai|anthropic] [--ai-model <id>] [--ai-threshold <0-1>] [--ai-max-candidates <n>] [--ai-timeout-ms <ms>] [--cross-venue-only|--allow-same-venue] [--with-rules] [--include-similarity] [--question-contains <text>] [--polymarket-host <url>] [--polymarket-mock-url <url>]
  pandora [--output table|json] autopilot run|once --market-address <address> --side yes|no --amount-usdc <amount> [--trigger-yes-below <0-100>] [--trigger-yes-above <0-100>] [--paper|--execute-live] [--interval-ms <ms>] [--cooldown-ms <ms>] [--max-amount-usdc <amount>] [--max-open-exposure-usdc <amount>] [--max-trades-per-day <n>] [--state-file <path>] [--kill-switch-file <path>] [--webhook-url <url>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>]
  pandora [--output table|json] dashboard [--with-live|--no-live] [--watch] [--refresh-ms <ms>] [--iterations <n>] [--wallet <address>] [--chain-id <id>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--usdc <address>] [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]
  pandora [--output table|json] fund-check --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) [--target-pct <0-100>] [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]
  pandora [--output table|json] bridge plan|execute --target pandora|polymarket --amount-usdc <n> [--wallet <address>] [--to-wallet <address>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--usdc <address>] [--timeout-ms <ms>]
  pandora [--output table|json] fees [--wallet <address>] [--chain-id <id>] [--tx-hash <hash>] [--event-name <name>] [--limit <n>] [--before <cursor>] [--after <cursor>] [--order-direction asc|desc] [--indexer-url <url>] [--timeout-ms <ms>]
  pandora [--output table|json] fees withdraw --market-address <address> --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--dotenv-path <path>] [--skip-dotenv] [--timeout-ms <ms>]
  pandora [--output table|json] debug market|tx ...
  pandora [--output table|json] mirror browse|plan|deploy|verify|lp-explain|hedge-calc|calc|simulate|go|sync|trace|dashboard|status|health|panic|drift|hedge-check|pnl|audit|replay|logs|close ...
  pandora [--output table|json] polymarket check|approve|preflight|balance|positions|deposit|withdraw|trade ...
  pandora [--output table|json] webhook test [--webhook-url <url>] [--webhook-template <json>] [--webhook-secret <secret>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>] [--webhook-timeout-ms <ms>] [--webhook-retries <n>]
  pandora [--output table|json] leaderboard [--metric profit|volume|win-rate] [--chain-id <id>] [--limit <n>] [--min-trades <n>]
  pandora [--output table|json] analyze --market-address <address> [--provider <name>] [--model <id>] [--max-cost-usd <n>] [--temperature <n>] [--timeout-ms <ms>]
  pandora [--output table|json] agent market hype --area <sports|esports|politics|regional-news|breaking-news> [--region <text>] [--query <text>] [--market-type auto|amm|parimutuel|both] [--candidate-count <n>]
  pandora [--output table|json] agent market autocomplete --question <text> [--market-type amm|parimutuel]
  pandora [--output table|json] agent market validate --question <text> --rules <text> --target-timestamp <unix-seconds> [--sources <url...>]
  pandora [--output table|json] suggest --wallet <address> --risk low|medium|high --budget <amount> [--count <n>] [--include-venues pandora,polymarket]
  pandora [--output table|json] resolve [--dotenv-path <path>] [--skip-dotenv] --poll-address <address> --answer yes|no|invalid --reason <text> --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>]
  pandora [--output table|json] claim --market-address <address>|--all [--wallet <address>] --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--indexer-url <url>] [--timeout-ms <ms>]
  pandora [--output table|json] lp add|remove|positions [--market-address <address>] [--wallet <address>] [--amount-usdc <n>] [--lp-tokens <n>|--all|--all-markets] [--dry-run|--execute] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--usdc <address>] [--deadline-seconds <n>] [--indexer-url <url>] [--timeout-ms <ms>]
  pandora [--output table|json] policy list|get|lint [flags]
  pandora [--output table|json] profile list|get|explain|recommend|validate [flags]
  pandora [--output table|json] recipe list|get|validate|run [flags]
  pandora [--output table|json] risk show|panic [--risk-file <path>] [--clear] [--reason <text>] [--actor <id>]
  pandora [--output table|json] explain <error-code>|--code <code> [--message <text>] [--details-json <json>] [--stdin]
  pandora [--output table|json] operations get|list|receipt|verify-receipt|cancel|close [flags]
  pandora stream prices|events [--indexer-url <url>] [--indexer-ws-url <url>] [--timeout-ms <ms>] [--interval-ms <ms>] [--market-address <address>] [--chain-id <id>] [--limit <n>]
  pandora [--output table|json] simulate mc|particle-filter|agents ...
  pandora [--output table|json] model calibrate|correlation|diagnose|score brier ...
  pandora [--output json] bootstrap
  pandora [--output json] capabilities
  pandora [--output json] schema
  pandora mcp
  pandora launch [--dotenv-path <path>] [--skip-dotenv] [script args...]
  pandora clone-bet [--dotenv-path <path>] [--skip-dotenv] [script args...]

Examples:
  pandora setup
  pandora --output json doctor --check-usdc-code --check-polymarket
  pandora markets list --active --with-odds --limit 10
  pandora markets get --id market-1 --id market-2
  pandora --output json markets create plan --market-type parimutuel --question "Will BTC close above $120k by end of 2026?" --rules "YES: ... NO: ... EDGE: ..." --sources https://example.com/a https://example.com/b --target-timestamp 1798675200 --liquidity-usdc 100 --curve-flattener 7 --curve-offset 30000
  pandora --output json markets create run --market-type amm --question "Will ETH close above $8k by end of 2026?" --rules "YES: ... NO: ... EDGE: ..." --sources https://example.com/a https://example.com/b --target-timestamp 1798675200 --liquidity-usdc 100 --fee-tier 3000 --dry-run
  pandora polls get --id 0xabc...
  pandora events list --type all --limit 25
  pandora positions list --wallet 0x1234...
  pandora portfolio --wallet 0x1234... --chain-id 1 --with-lp
  pandora watch --market-address 0xabc... --side yes --amount-usdc 10 --iterations 5 --interval-ms 2000 --alert-exposure-above 250
  pandora scan --active --limit 25 --chain-id 1
  pandora quote --market-address 0xabc... --side yes --amounts 25,50,75,100
  pandora quote --market-address 0xabc... --side yes --target-pct 60
  pandora trade --dry-run --market-address 0xabc... --side no --amount-usdc 25 --max-amount-usdc 50 --min-probability-pct 20
  pandora sell --dry-run --market-address 0xabc... --side no --shares 40
  pandora history --wallet 0x1234... --chain-id 1 --limit 50
  pandora export --wallet 0x1234... --format csv --year 2026 --out ./trades-2026.csv
  pandora arbitrage --chain-id 1 --limit 25 --venues pandora,polymarket --cross-venue-only --with-rules --include-similarity
  pandora lifecycle start --config ./configs/lifecycle.json
  pandora arb scan --source polymarket --output json --iterations 1 --min-spread-pct 2 --min-tvl 50 --ai-provider auto
  pandora autopilot once --market-address 0xabc... --side no --amount-usdc 10 --trigger-yes-below 15 --paper
  pandora recipe list
  pandora recipe run --id mirror.sync.paper-safe --set market-address=0xabc...
  pandora dashboard
  pandora fund-check --rpc-url https://polygon-bor-rpc.publicnode.com --funder 0xproxy...
  pandora mirror plan --source polymarket --polymarket-market-id 0xabc... --with-rules --include-similarity
  pandora bridge execute --target polymarket --amount-usdc 100 --dry-run --provider layerzero
  pandora claim --all --dry-run
  pandora mirror browse --min-yes-pct 20 --max-yes-pct 80 --min-volume-24h 100000 --limit 10
  pandora mirror verify --pandora-market-address 0xabc... --polymarket-market-id 0xdef... --include-similarity
  pandora mirror lp-explain --liquidity-usdc 10000 --source-yes-pct 58
  pandora mirror hedge-calc --reserve-yes-usdc 8 --reserve-no-usdc 12 --excess-no-usdc 2 --polymarket-yes-pct 60
  pandora mirror simulate --liquidity-usdc 10000 --source-yes-pct 58 --target-yes-pct 58 --volume-scenarios 1000,5000,10000
  pandora mirror go --polymarket-slug nba-mia-phi-2026-02-28 --liquidity-usdc 10 --paper
  pandora mirror sync once --pandora-market-address 0xabc... --polymarket-market-id 0xdef... --paper --hedge-ratio 1.0 --skip-gate
  pandora mirror trace --pandora-market-address 0xabc... --rpc-url https://eth-mainnet.example --from-block 100 --to-block 110 --step 5
  pandora polymarket check --rpc-url https://polygon-bor-rpc.publicnode.com --private-key 0x... --funder 0xproxy...
  pandora polymarket approve --dry-run --rpc-url https://polygon-bor-rpc.publicnode.com --private-key 0x... --funder 0xproxy...
  pandora polymarket preflight --rpc-url https://polygon-bor-rpc.publicnode.com --private-key 0x... --funder 0xproxy...
  pandora polymarket positions --wallet 0xproxy... --slug btc-above-100k-on-friday --source auto
  pandora polymarket trade --condition-id 0xabc... --token yes --amount-usdc 2 --dry-run
  pandora mirror close --pandora-market-address 0xabc... --polymarket-market-id 0xdef... --dry-run
  pandora webhook test --webhook-url https://example.com/hook --webhook-template '{\"text\":\"{{message}}\"}'
  pandora leaderboard --metric profit --limit 20
  pandora analyze --market-address 0xabc... --provider mock
  pandora --output json markets hype plan --area breaking-news --query "AI launches" --ai-provider openai --candidate-count 3
  pandora --output json markets hype run --plan-file ./hype-plan.json --candidate-id cand-1 --market-type selected --dry-run
  pandora --output json agent market hype --area politics --region "United States" --candidate-count 3
  pandora --output json agent market autocomplete --question "Will BTC close above $100k by Friday?" --market-type amm
  pandora --output json agent market validate --question "Will BTC close above $100k by Friday?" --rules "YES: ... NO: ... EDGE: ..." --target-timestamp 1798675200 --sources https://example.com/a https://example.com/b
  pandora suggest --wallet 0x1234... --risk medium --budget 50 --count 3
  pandora risk show
  pandora risk panic --reason "Manual incident stop"
  pandora risk panic --clear
  pandora explain RISK_PANIC_ACTIVE
  pandora --output json explain --stdin < ./error-envelope.json
  pandora operations list --status planned,executing --limit 20
  pandora operations receipt --id op_123
  pandora operations verify-receipt --id op_123
  pandora stream prices --indexer-url https://pandoraindexer.up.railway.app/ --interval-ms 1000
  pandora --output json simulate mc --trials 4000 --horizon 48 --start-yes-pct 57 --seed 7 --antithetic
  pandora --output json simulate particle-filter --observations-json '[{\"yesPct\":56},{\"yesPct\":58},{\"yesPct\":57}]' --particles 750 --seed 11
  pandora --output json capabilities
  pandora --output json bootstrap
  pandora --output json schema
  pandora mcp
  pandora launch --dry-run --market-type amm --question "Will BTC close above $100k by end of 2026?" --rules "Resolves YES if ... Resolves NO if ... cancelled/postponed/abandoned/unresolved => NO." --sources "https://coinmarketcap.com/currencies/bitcoin/" "https://www.coingecko.com/en/coins/bitcoin" --target-timestamp 1798675200 --liquidity 100 --fee-tier 3000

Notes:
  - launch/clone-bet forward unknown flags directly to underlying scripts.
  - Env auto-load default: ~/.pandora-cli.env when present; otherwise scripts/.env. Use --skip-dotenv to disable.
  - bootstrap is the preferred first call for cold agent clients; it returns canonical tools only by default and points to the next safe discovery calls.
  - Most commands support table and json output. bootstrap/capabilities/schema are json-only, mcp is table-only, and launch/clone-bet forward script output.
  - scan is the canonical enriched discovery command; markets scan remains a backward-compatible alias and markets list is the raw indexer browse surface.
  - Indexer URL resolution order: --indexer-url, PANDORA_INDEXER_URL, INDEXER_URL, default public indexer.
  - mirror status --with-live can enrich output with Polymarket position data when POLYMARKET_* credentials are set; missing endpoints/creds return diagnostics instead of hard failures.
  - watch is non-transactional monitoring; use quote/trade/sell for execution workflows.
  - stream always emits NDJSON to stdout (one JSON object per line).
  - arb scan is the canonical arbitrage command; arbitrage remains a bounded backward-compatible one-shot wrapper.
  - arb scan supports streaming NDJSON and bounded JSON (--output json --iterations 1) for agent workflows.
  - explain is the canonical AI-facing remediation surface; use --code for tool calls or --stdin to consume Pandora JSON failure envelopes.
  - markets hype plan/run turns live public-web research into frozen market plans that can be validated and deployed safely.
  - agent market hype/autocomplete/validate expose prompt templates plus validation tickets for agent-controlled market creation workflows.
`);
}

function printQuoteHelpTable() {
  console.log(`
pandora quote - Estimate a YES/NO buy or sell

Usage:
  pandora [--output table|json] quote [--indexer-url <url>] [--timeout-ms <ms>] --market-address <address> --side yes|no [--mode buy|sell] --amount-usdc <amount>|--shares <amount>|--amounts <csv>|--target-pct <0-100> [--yes-pct <0-100>] [--slippage-bps <0-10000>]

Notes:
  - Buy mode uses USDC notional input; sell mode uses outcome-token share input.
  - If --yes-pct is omitted, quote attempts to derive odds from latest liquidity events on the indexer.
  - Sell mode prefers on-chain calcSell* views when RPC is available and falls back to reserve inversion.
  - --amounts emits a sizing curve in the active mode units.
  - --target-pct is buy-only and computes the required USDC trade to move an AMM market to the requested YES percentage.
`);
}

function printTradeHelpTable() {
  console.log(`
pandora trade - Execute a buy on a market

Usage:
  pandora [--output table|json] trade quote --market-address <address> --side yes|no [--mode buy|sell] --amount-usdc <amount>|--shares <amount>|--amounts <csv> [--yes-pct <0-100>] [--slippage-bps <0-10000>]
  pandora [--output table|json] trade [--indexer-url <url>] [--timeout-ms <ms>] [--dotenv-path <path>] [--skip-dotenv] --market-address <address> --side yes|no --amount-usdc <amount> --dry-run|--execute [--yes-pct <0-100>] [--slippage-bps <0-10000>] [--min-shares-out-raw <uint>] [--max-amount-usdc <amount>] [--min-probability-pct <0-100>] [--max-probability-pct <0-100>] [--allow-unquoted-execute] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>]

Notes:
  - --dry-run prints the execution plan and quote without sending transactions.
  - --execute performs allowance check, optional USDC approve, then calls market buy() using the detected market ABI.
  - --max-amount-usdc and probability guard flags fail fast before execution.
  - --execute requires a quote by default unless --min-shares-out-raw or --allow-unquoted-execute is set.
  - Supports both PariMutuel and AMM market buy signatures.
  - trade quote is read-only and returns full quote curve data for buy or sell analysis.
  - Use pandora sell for AMM sell execution.
`);
}

function printSellHelpTable() {
  console.log(`
pandora sell - Execute an AMM sell on a market

Usage:
  pandora [--output table|json] sell quote --market-address <address> --side yes|no --shares <amount>|--amount <amount>|--amounts <csv> [--yes-pct <0-100>] [--slippage-bps <0-10000>]
  pandora [--output table|json] sell [--indexer-url <url>] [--timeout-ms <ms>] [--dotenv-path <path>] [--skip-dotenv] --market-address <address> --side yes|no --shares <amount>|--amount <amount> --dry-run|--execute [--yes-pct <0-100>] [--slippage-bps <0-10000>] [--min-amount-out-raw <uint>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>]

Notes:
  - Sell is AMM-only. PariMutuel markets do not expose a sell() interface.
  - --execute performs outcome-token allowance check, optional token approve, then calls market sell().
  - Sell quote prefers on-chain calcSell* views when RPC is available and falls back to reserve inversion.
`);
}

function printWatchHelpTable() {
  console.log(`
pandora watch - Poll portfolio/market snapshots

Usage:
  pandora [--output table|json] watch [--wallet <address>] [--market-address <address>] [--side yes|no] [--amount-usdc <amount>] [--iterations <n>] [--interval-ms <ms>] [--chain-id <id>] [--include-events|--no-events] [--yes-pct <0-100>] [--alert-yes-below <0-100>] [--alert-yes-above <0-100>] [--alert-net-liquidity-below <amount>] [--alert-net-liquidity-above <amount>] [--alert-exposure-above <amount>] [--alert-hedge-gap-above <amount>] [--max-trade-size-usdc <amount>] [--max-daily-volume-usdc <amount>] [--max-total-exposure-usdc <amount>] [--max-per-market-exposure-usdc <amount>] [--max-hedge-gap-usdc <amount>] [--fail-on-alert] [--track-brier] [--brier-source <name>] [--brier-file <path>] [--group-by source|market|competition]

Notes:
  - At least one target is required: --wallet and/or --market-address.
  - watch is read-only; it never sends transactions.
  - Alert thresholds annotate snapshots with alert metadata.
  - Exposure and hedge-gap thresholds require wallet-backed snapshots; use --wallet when you set those limits.
  - Risk limits can come from direct flags, nested config objects, or PANDORA_WATCH_RISK_* env vars.
  - --fail-on-alert exits non-zero when any alert condition is hit.
  - Each iteration returns timestamped snapshot data.
`);
}

function printMarketsHelpTable() {
  console.log(`
pandora markets - Query market entities

Usage:
  pandora [--output table|json] markets list [options]
  pandora [--output table|json] markets scan [options]
  pandora [--output table|json] markets mine [options]
  pandora [--output table|json] markets get [--id <id> ...] [--stdin]
  pandora [--output table|json] markets create plan|run [options]
  pandora [--output table|json] markets hype plan|run [options]
`);
}

function printMarketsListHelpTable() {
  console.log(`
pandora markets list - List markets

Usage:
  pandora [--output table|json] markets list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>|--type <type>] [--where-json <json>] [--active|--resolved|--expiring-soon] [--expiring-hours <n>] [--min-tvl <usdc>] [--hedgeable] [--expand] [--with-odds]

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
  const notes = Array.isArray(arguments[1]) ? arguments[1] : null;
  return notes && notes.length ? { usage, notes } : { usage };
}

function quoteHelpJsonPayload(defaultMode = 'buy') {
  return {
    usage:
      defaultMode === 'sell'
        ? 'pandora [--output table|json] quote [--indexer-url <url>] [--timeout-ms <ms>] --market-address <address> --side yes|no --mode sell --shares <amount>|--amount <amount>|--amounts <csv> [--yes-pct <0-100>] [--slippage-bps <0-10000>]'
        : 'pandora [--output table|json] quote [--indexer-url <url>] [--timeout-ms <ms>] --market-address <address> --side yes|no [--mode buy|sell] --amount-usdc <amount>|--shares <amount>|--amounts <csv>|--target-pct <0-100> [--yes-pct <0-100>] [--slippage-bps <0-10000>]',
  };
}

function tradeHelpJsonPayload() {
  return {
    usage:
      'pandora [--output table|json] trade quote --market-address <address> --side yes|no [--mode buy|sell] --amount-usdc <amount>|--shares <amount>|--amounts <csv> [--yes-pct <0-100>] [--slippage-bps <0-10000>] | pandora [--output table|json] trade [--indexer-url <url>] [--timeout-ms <ms>] [--dotenv-path <path>] [--skip-dotenv] --market-address <address> --side yes|no --amount-usdc <amount> --dry-run|--execute [--yes-pct <0-100>] [--slippage-bps <0-10000>] [--min-shares-out-raw <uint>] [--max-amount-usdc <amount>] [--min-probability-pct <0-100>] [--max-probability-pct <0-100>] [--allow-unquoted-execute] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>]',
  };
}

function sellHelpJsonPayload() {
  return {
    usage:
      'pandora [--output table|json] sell quote --market-address <address> --side yes|no --shares <amount>|--amount <amount>|--amounts <csv> [--yes-pct <0-100>] [--slippage-bps <0-10000>] | pandora [--output table|json] sell [--indexer-url <url>] [--timeout-ms <ms>] [--dotenv-path <path>] [--skip-dotenv] --market-address <address> --side yes|no --shares <amount>|--amount <amount> --dry-run|--execute [--yes-pct <0-100>] [--slippage-bps <0-10000>] [--min-amount-out-raw <uint>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>]',
  };
}

function watchHelpJsonPayload() {
  return {
    usage:
      'pandora [--output table|json] watch [--wallet <address>] [--market-address <address>] [--side yes|no] [--amount-usdc <amount>] [--iterations <n>] [--interval-ms <ms>] [--chain-id <id>] [--include-events|--no-events] [--yes-pct <0-100>] [--alert-yes-below <0-100>] [--alert-yes-above <0-100>] [--alert-net-liquidity-below <amount>] [--alert-net-liquidity-above <amount>] [--alert-exposure-above <amount>] [--alert-hedge-gap-above <amount>] [--max-trade-size-usdc <amount>] [--max-daily-volume-usdc <amount>] [--max-total-exposure-usdc <amount>] [--max-per-market-exposure-usdc <amount>] [--max-hedge-gap-usdc <amount>] [--fail-on-alert] [--track-brier] [--brier-source <name>] [--brier-file <path>] [--group-by source|market|competition]',
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
      'pandora [--output table|json] markets list|get|scan ...',
      'pandora [--output table|json] markets mine ...',
      'pandora [--output table|json] markets create plan|run ...',
      'pandora [--output table|json] markets hype plan|run ...',
      'pandora [--output table|json] polls list|get ...',
      'pandora [--output table|json] events list|get ...',
      'pandora [--output table|json] positions list ...',
      'pandora [--output table|json] portfolio ...',
      'pandora [--output table|json] watch ...',
      'pandora [--output table|json] scan ...',
      'pandora [--output table|json] sports ...',
      'pandora [--output table|json] odds record|history ...',
      'pandora [--output table|json] lifecycle start|status|resolve ...',
      'pandora arb scan [--source pandora|polymarket] [--markets <csv>] --output ndjson|json ...',
      'pandora [--output table|json] quote ...',
      'pandora [--output table|json] trade quote|...',
      'pandora [--output table|json] sell quote|...',
      'pandora [--output table|json] history ...',
      'pandora [--output table|json] export ...',
      'pandora [--output table|json] arbitrage ...',
      'pandora [--output table|json] autopilot run|once ...',
      'pandora [--output table|json] dashboard ...',
      'pandora [--output table|json] fund-check ...',
      'pandora [--output table|json] bridge plan|execute ...',
      'pandora [--output table|json] fees ...',
      'pandora [--output table|json] fees withdraw ...',
      'pandora [--output table|json] debug market|tx ...',
      'pandora [--output table|json] mirror browse|plan|deploy|verify|lp-explain|hedge-calc|calc|simulate|go|sync|trace|dashboard|status|health|panic|drift|hedge-check|pnl|audit|replay|logs|close ...',
      'pandora [--output table|json] polymarket check|approve|preflight|balance|positions|deposit|withdraw|trade ...',
      'pandora [--output table|json] webhook test ...',
      'pandora [--output table|json] leaderboard ...',
      'pandora [--output table|json] analyze ...',
      'pandora [--output table|json] agent market hype|autocomplete|validate ...',
      'pandora [--output table|json] suggest ...',
      'pandora [--output table|json] resolve ...',
      'pandora [--output table|json] claim ...',
      'pandora [--output table|json] lp add|remove|positions ...',
      'pandora [--output table|json] risk show|panic ...',
      'pandora [--output table|json] explain ...',
      'pandora [--output table|json] operations get|list|receipt|verify-receipt|cancel|close ...',
      'pandora stream prices|events ...',
      'pandora [--output table|json] simulate mc|particle-filter|agents ...',
      'pandora [--output table|json] model calibrate|correlation|diagnose|score brier ...',
      'pandora [--output json] bootstrap',
      'pandora [--output json] capabilities',
      'pandora [--output json] schema',
      'pandora mcp',
      'pandora launch ...',
      'pandora clone-bet ...',
    ],
    globalFlags: {
      '--output': ['table', 'json'],
    },
      modeRouting: {
        jsonOnly: ['bootstrap', 'capabilities', 'schema'],
        stdioOnly: ['mcp'],
        scriptNative: ['launch', 'clone-bet'],
      },
      notes: [
        '`bootstrap` is the preferred first call for cold agent clients; it returns canonical tools only by default and points to the next safe discovery calls.',
        '`scan` is the canonical enriched market discovery flow; `markets scan` remains a backward-compatible alias and `markets list` is the raw indexer browse view.',
        '`arb scan` is the canonical arbitrage flow; `arbitrage` remains a backward-compatible bounded one-shot wrapper.',
        '`explain` is the canonical AI-facing remediation surface; use `--code` for direct tool calls or `--stdin` to consume Pandora JSON failure envelopes.',
        '`agent market hype`, `agent market autocomplete`, and `agent market validate` expose reusable AI prompt templates and validation tickets for agent-controlled market creation workflows.',
        'Most commands support table and json output. `bootstrap`/`capabilities`/`schema` are json-only, `mcp` is stdio server mode, and `launch`/`clone-bet` forward script-native output.',
      ],
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

function findTopLevelCommandIndex(argv) {
  const tokens = Array.isArray(argv) ? argv : [];
  let index = 0;
  if (tokens[0] === 'pandora') index = 1;

  while (index < tokens.length) {
    const token = String(tokens[index] || '').trim();
    if (token === '--output' || token === '-o') {
      index += 2;
      continue;
    }
    if (token.startsWith('--output=')) {
      index += 1;
      continue;
    }
    break;
  }

  return index < tokens.length ? index : -1;
}

function findOddsSubcommandActionIndex(argv) {
  const tokens = Array.isArray(argv) ? argv : [];
  const commandIndex = findTopLevelCommandIndex(tokens);
  if (commandIndex < 0) return -1;
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
  const commandIndex = findTopLevelCommandIndex(tokens);
  if (commandIndex < 0) return -1;
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
    rebalanceSizingMode: options.rebalanceSizingMode,
    priceSource: options.priceSource,
    driftTriggerBps: options.driftTriggerBps,
    hedgeEnabled: options.hedgeEnabled,
    hedgeRatio: options.hedgeRatio,
    hedgeTriggerUsdc: options.hedgeTriggerUsdc,
    maxRebalanceUsdc: options.maxRebalanceUsdc,
    maxHedgeUsdc: options.maxHedgeUsdc,
    maxOpenExposureUsdc: options.maxOpenExposureUsdc,
    maxTradesPerDay: options.maxTradesPerDay,
    cooldownMs: options.cooldownMs,
    depthSlippageBps: options.depthSlippageBps,
    minTimeToCloseSec: options.minTimeToCloseSec,
    strictCloseTimeDelta: Boolean(options.strictCloseTimeDelta),
    forceGate: options.forceGate,
    skipGateChecks:
      Array.isArray(options.skipGateChecks) && options.skipGateChecks.length
        ? [...options.skipGateChecks].sort()
        : [],
  };
}

function buildMirrorSyncDaemonCliArgs(options, shared) {
  const args = ['--output', 'json', 'mirror', 'sync', 'run'];

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
  args.push('--stream');
  args.push('--interval-ms', String(options.intervalMs));
  args.push('--drift-trigger-bps', String(options.driftTriggerBps));
  args.push('--hedge-trigger-usdc', String(options.hedgeTriggerUsdc));
  args.push('--hedge-ratio', String(options.hedgeRatio));
  if (options.rebalanceSizingMode) args.push('--rebalance-mode', String(options.rebalanceSizingMode));
  if (options.priceSource) args.push('--price-source', String(options.priceSource));
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
  if (options.strictCloseTimeDelta) {
    args.push('--strict-close-time-delta');
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
  if (options.polymarketRpcUrl) args.push('--polymarket-rpc-url', options.polymarketRpcUrl);
  if (options.profileId) args.push('--profile-id', options.profileId);
  if (options.profileFile) args.push('--profile-file', options.profileFile);
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
    ['ID', 'Type', 'Question', 'YES', 'NO', 'Reserve YES', 'Reserve NO', 'Fee', 'Close', 'Category'],
    items.map((item) => {
      const liquidity = item && item.liquidity ? item.liquidity : buildMarketLiquidityMetrics(item || {});
      const poll = item && item.poll && typeof item.poll === 'object' ? item.poll : null;
      const category = poll && poll.category !== undefined ? poll.category : item.category;
      return [
        short(item.id, 18),
        item.marketType || '',
        short((poll && poll.question) || item.question || '', 44),
        formatOddsPercent(item.odds && item.odds.yesProbability),
        formatOddsPercent(item.odds && item.odds.noProbability),
        liquidity && liquidity.reserveYes !== null ? liquidity.reserveYes : '',
        liquidity && liquidity.reserveNo !== null ? liquidity.reserveNo : '',
        liquidity && liquidity.feePct !== null ? `${liquidity.feePct}%` : '',
        formatTimestamp(item.marketCloseTimestamp),
        category === null || category === undefined ? '' : category,
      ];
    }),
  );
}

function renderQuoteTable(data) {
  const odds = data.odds || {};
  const estimate = data.estimate || null;
  const liquidity = data.liquidity || null;
  const parimutuel = data.parimutuel || null;
  const targeting = data.targeting || null;
  const quoteMode = String(data && data.mode ? data.mode : 'buy').toLowerCase();
  printTable(
    ['Field', 'Value'],
    [
      ['marketAddress', data.marketAddress],
      ['marketType', data.marketType || ''],
      ['mode', quoteMode],
      ['side', data.side],
      ['amountUsdc', quoteMode === 'sell' ? 'n/a' : data.amountUsdc],
      ['sharesIn', quoteMode === 'sell' ? data.amount : 'n/a'],
      ['currentPct', targeting && targeting.currentPct !== null && targeting.currentPct !== undefined ? `${targeting.currentPct}%` : 'n/a'],
      ['targetPct', targeting && targeting.targetPct !== null && targeting.targetPct !== undefined ? `${targeting.targetPct}%` : 'n/a'],
      ['requiredSide', targeting && targeting.requiredSide ? targeting.requiredSide : 'n/a'],
      ['requiredAmountUsdc', targeting && targeting.requiredAmountUsdc !== null && targeting.requiredAmountUsdc !== undefined ? targeting.requiredAmountUsdc : 'n/a'],
      ['postTradePct', targeting && targeting.postTradePct !== null && targeting.postTradePct !== undefined ? `${targeting.postTradePct}%` : 'n/a'],
      ['oddsSource', odds.source || 'n/a'],
      ['yesPct', odds.yesPct === null || odds.yesPct === undefined ? 'n/a' : `${odds.yesPct}%`],
      ['noPct', odds.noPct === null || odds.noPct === undefined ? 'n/a' : `${odds.noPct}%`],
      ['quoteAvailable', data.quoteAvailable ? 'yes' : 'no'],
      ['estimatedShares', quoteMode === 'sell' ? 'n/a' : estimate ? estimate.estimatedShares : 'n/a'],
      ['minSharesOut', quoteMode === 'sell' ? 'n/a' : estimate ? estimate.minSharesOut : 'n/a'],
      ['estimatedUsdcOut', quoteMode === 'sell' && estimate ? estimate.estimatedUsdcOut : 'n/a'],
      ['minAmountOut', quoteMode === 'sell' && estimate ? estimate.minAmountOut : 'n/a'],
      ['grossUsdcOut', quoteMode === 'sell' && estimate ? estimate.grossUsdcOut : 'n/a'],
      ['feeAmount', quoteMode === 'sell' && estimate ? estimate.feeAmount : 'n/a'],
      ['potentialPayoutIfWin', quoteMode === 'sell' ? 'n/a' : estimate ? estimate.potentialPayoutIfWin : 'n/a'],
      ['potentialProfitIfWin', quoteMode === 'sell' ? 'n/a' : estimate ? estimate.potentialProfitIfWin : 'n/a'],
      ['reserveYes', liquidity && liquidity.reserveYes !== null ? liquidity.reserveYes : 'n/a'],
      ['reserveNo', liquidity && liquidity.reserveNo !== null ? liquidity.reserveNo : 'n/a'],
      ['kValue', liquidity && liquidity.kValue !== null ? liquidity.kValue : 'n/a'],
      ['diagnostic', Array.isArray(data.diagnostics) && data.diagnostics.length ? data.diagnostics.join(' | ') : odds.diagnostic || ''],
    ],
  );

  if (Array.isArray(data.curve) && data.curve.length > 1) {
    console.log('');
    if (quoteMode === 'sell') {
      printTable(
        ['Shares In', 'USDC Out', 'Eff. Price', 'Slippage %'],
        data.curve.map((row) => [
          row.amount === null || row.amount === undefined ? 'n/a' : row.amount,
          row.estimatedUsdcOut === null || row.estimatedUsdcOut === undefined ? 'n/a' : row.estimatedUsdcOut,
          row.effectivePrice === null ? 'n/a' : row.effectivePrice,
          row.slippagePct === null ? 'n/a' : row.slippagePct,
        ]),
      );
    } else {
      printTable(
        ['Amount USDC', 'Shares Out', 'Eff. Price', 'Slippage %', 'ROI if Win %'],
        data.curve.map((row) => [
          row.amountUsdc,
          row.estimatedShares === null ? 'n/a' : row.estimatedShares,
          row.effectivePrice === null ? 'n/a' : row.effectivePrice,
          row.slippagePct === null ? 'n/a' : row.slippagePct,
          row.roiIfWinPct === null ? 'n/a' : row.roiIfWinPct,
        ]),
      );
    }
  }

  if (parimutuel) {
    console.log('');
    printTable(
      ['Pari Field', 'Value'],
      [
        ['poolYes', parimutuel.poolYes],
        ['poolNo', parimutuel.poolNo],
        ['totalPool', parimutuel.totalPool],
        ['sharePct', parimutuel.sharePct],
        ['payoutIfWin', parimutuel.payoutIfWin],
        ['profitIfWin', parimutuel.profitIfWin],
        ['breakevenProbability', parimutuel.breakevenProbability],
      ],
    );
  }
}

function renderTradeTable(data) {
  const riskGuards = data.riskGuards || {};
  const rows = [
    ['mode', data.mode],
    ['action', data.action || 'buy'],
    ['marketAddress', data.marketAddress],
    ['side', data.side],
    ['amountUsdc', data.amountUsdc === null || data.amountUsdc === undefined ? '' : data.amountUsdc],
    ['shares', data.amount === null || data.amount === undefined ? '' : data.amount],
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
    ['approvalAsset', data.approvalAsset || ''],
    ['approveTxHash', data.approveTxHash || ''],
    ['approveTxUrl', data.approveTxUrl || ''],
    ['approveGasEstimate', data.approveGasEstimate || ''],
    ['approveStatus', data.approveStatus || ''],
    ['tradeTxHash', data.tradeTxHash || ''],
    ['tradeTxUrl', data.tradeTxUrl || ''],
    ['tradeGasEstimate', data.tradeGasEstimate || ''],
    ['tradeStatus', data.tradeStatus || ''],
    ['buyTxHash', data.buyTxHash || ''],
    ['buyTxUrl', data.buyTxUrl || ''],
    ['buyGasEstimate', data.buyGasEstimate || ''],
    ['buyStatus', data.buyStatus || ''],
    ['sellTxHash', data.sellTxHash || ''],
    ['sellTxUrl', data.sellTxUrl || ''],
    ['sellGasEstimate', data.sellGasEstimate || ''],
    ['sellStatus', data.sellStatus || ''],
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
    ['totalPositionMarkValueUsdc', data.summary.totalPositionMarkValueUsdc === null ? '' : data.summary.totalPositionMarkValueUsdc],
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
      ['Market', 'Question', 'Chain', 'Side', 'YES Bal', 'NO Bal', 'YES%', 'NO%', 'Mark (USDC)', 'Last Trade'],
      data.positions.map((item) => [
        short(item.marketAddress, 18),
        short(item.question || '', 38),
        item.chainId,
        item.positionSide || '',
        item.yesBalance === null || item.yesBalance === undefined ? '' : item.yesBalance,
        item.noBalance === null || item.noBalance === undefined ? '' : item.noBalance,
        item.odds && item.odds.yesPct !== null && item.odds.yesPct !== undefined ? `${item.odds.yesPct}%` : '',
        item.odds && item.odds.noPct !== null && item.odds.noPct !== undefined ? `${item.odds.noPct}%` : '',
        item.markValueUsdc === null || item.markValueUsdc === undefined ? '' : item.markValueUsdc,
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
  const timing = data.timing || {};
  printTable(
    ['Field', 'Value'],
    [
      ['source', data.source || 'polymarket'],
      ['sourceMarketId', data.sourceMarket ? data.sourceMarket.marketId : ''],
      ['sourceSlug', data.sourceMarket ? data.sourceMarket.slug || '' : ''],
      ['sourceYesPct', data.sourceMarket && data.sourceMarket.yesPct !== null ? data.sourceMarket.yesPct : ''],
      ['sourceTimestampKind', timing.sourceTimestampKind || (data.sourceMarket ? data.sourceMarket.timestampSource || '' : '')],
      ['eventStartAt', timing.eventStartTimestampIso || ''],
      ['suggestedTargetAt', timing.suggestedTargetTimestampIso || ''],
      ['tradingCutoffAt', timing.tradingCutoffTimestampIso || ''],
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
      ['targetTimestamp', data.timing && data.timing.selectedTargetTimestampIso ? data.timing.selectedTargetTimestampIso : ''],
      ['tradingCutoffAt', data.timing && data.timing.tradingCutoffTimestampIso ? data.timing.tradingCutoffTimestampIso : ''],
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
  const runtime = data.runtime || {};
  const runtimeHealth = runtime.health || {};
  const daemon = runtime.daemon || {};
  const lastAction = runtime.lastAction || {};
  const lastError = runtime.lastError || {};
  printTable(
    ['Field', 'Value'],
    [
      ['strategyHash', data.strategyHash || state.strategyHash || ''],
      ['stateFile', data.stateFile || ''],
      ['lastTickAt', state.lastTickAt || ''],
      ['runtimeHealth', runtimeHealth.status || ''],
      ['daemonStatus', daemon.status || (daemon.found === false ? 'not-found' : '')],
      ['daemonPid', daemon.pid === undefined || daemon.pid === null ? '' : daemon.pid],
      ['dailySpendUsdc', state.dailySpendUsdc === undefined ? '' : state.dailySpendUsdc],
      ['tradesToday', state.tradesToday === undefined ? '' : state.tradesToday],
      ['currentHedgeUsdc', state.currentHedgeUsdc === undefined ? '' : state.currentHedgeUsdc],
      ['cumulativeLpFeesApproxUsdc', state.cumulativeLpFeesApproxUsdc === undefined ? '' : state.cumulativeLpFeesApproxUsdc],
      ['cumulativeHedgeCostApproxUsdc', state.cumulativeHedgeCostApproxUsdc === undefined ? '' : state.cumulativeHedgeCostApproxUsdc],
      ['idempotencyKeys', Array.isArray(state.idempotencyKeys) ? state.idempotencyKeys.length : 0],
    ],
  );

  if (data.runtime) {
    console.log('');
    printTable(
      ['Runtime Field', 'Value'],
      [
        ['healthStatus', runtimeHealth.status || ''],
        ['healthCode', runtimeHealth.code || ''],
        ['healthMessage', runtimeHealth.message || ''],
        ['lastTickAt', runtimeHealth.lastTickAt || ''],
        ['heartbeatAgeMs', runtimeHealth.heartbeatAgeMs === undefined || runtimeHealth.heartbeatAgeMs === null ? '' : runtimeHealth.heartbeatAgeMs],
        ['lastActionStatus', lastAction.status || ''],
        ['lastActionStartedAt', lastAction.startedAt || ''],
        ['lastActionCompletedAt', lastAction.completedAt || ''],
        ['lastErrorCode', lastError.code || ''],
        ['lastErrorAt', lastError.at || ''],
        ['daemonAlive', daemon.alive ? 'yes' : 'no'],
        ['daemonPidFile', daemon.pidFile || ''],
        ['daemonLogFile', daemon.logFile || ''],
      ],
    );
  }

  if (!data.live) {
    return;
  }

  console.log('');
  printTable(
    ['Live Field', 'Value'],
    [
      ['crossVenueStatus', data.live.crossVenue && data.live.crossVenue.status ? data.live.crossVenue.status : ''],
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
      ['recommendedAction', data.live.actionability && data.live.actionability.recommendedAction ? data.live.actionability.recommendedAction : ''],
      [
        'polymarketPosition',
        data.live.polymarketPosition
          ? `yes=${data.live.polymarketPosition.yesBalance ?? 'n/a'} no=${data.live.polymarketPosition.noBalance ?? 'n/a'} openOrders=${data.live.polymarketPosition.openOrdersCount ?? 'n/a'} openOrdersUsd=${data.live.polymarketPosition.openOrdersNotionalUsd ?? 'n/a'} estUsd=${data.live.polymarketPosition.estimatedValueUsd ?? 'n/a'}`
          : '',
      ],
    ],
  );

  if (data.live.crossVenue) {
    console.log('');
    printTable(
      ['Cross-Venue Field', 'Value'],
      [
        ['gateOk', data.live.crossVenue.gateOk ? 'yes' : 'no'],
        ['failedChecks', Array.isArray(data.live.crossVenue.failedChecks) ? data.live.crossVenue.failedChecks.join(', ') : ''],
        ['matchConfidence', data.live.crossVenue.matchConfidence === undefined ? '' : data.live.crossVenue.matchConfidence],
        ['ruleHashMatch', data.live.crossVenue.ruleHashMatch === null ? '' : data.live.crossVenue.ruleHashMatch ? 'yes' : 'no'],
        ['closeTimeDeltaSec', data.live.crossVenue.closeTimeDeltaSec === undefined ? '' : data.live.crossVenue.closeTimeDeltaSec],
        ['sourceType', data.live.crossVenue.sourceType || ''],
      ],
    );
  }

  if (data.live.actionableDiagnostics && data.live.actionableDiagnostics.length) {
    console.log('');
    printTable(
      ['Diagnostic', 'Severity', 'Action'],
      data.live.actionableDiagnostics.map((item) => [
        item.code || '',
        item.severity || '',
        item.action || '',
      ]),
    );
  }

  if (data.live.pnlScenarios && data.live.pnlScenarios.resolutionScenarios) {
    const resolution = data.live.pnlScenarios.resolutionScenarios;
    console.log('');
    printTable(
      ['Outcome', 'InventoryPayoutUsd', 'FeesPlusInventoryPnlApproxUsdc'],
      [
        [
          'yes',
          resolution.yes && resolution.yes.hedgeInventoryPayoutUsd !== undefined ? resolution.yes.hedgeInventoryPayoutUsd : '',
          resolution.yes && resolution.yes.feesPlusInventoryPnlApproxUsdc !== undefined ? resolution.yes.feesPlusInventoryPnlApproxUsdc : '',
        ],
        [
          'no',
          resolution.no && resolution.no.hedgeInventoryPayoutUsd !== undefined ? resolution.no.hedgeInventoryPayoutUsd : '',
          resolution.no && resolution.no.feesPlusInventoryPnlApproxUsdc !== undefined ? resolution.no.feesPlusInventoryPnlApproxUsdc : '',
        ],
      ],
    );
  }
}

function renderMirrorCloseTable(data) {
  const target = data && typeof data.target === 'object' && data.target ? data.target : {};
  printTable(
    ['Field', 'Value'],
    [
      ['mode', data.mode || ''],
      ['all', target.all ? 'yes' : 'no'],
      ['pandoraMarketAddress', target.pandoraMarketAddress || ''],
      ['polymarketMarketId', target.polymarketMarketId || ''],
      ['polymarketSlug', target.polymarketSlug || ''],
      ['successCount', data.summary && data.summary.successCount !== undefined ? data.summary.successCount : ''],
      ['failureCount', data.summary && data.summary.failureCount !== undefined ? data.summary.failureCount : ''],
    ],
  );

  if (!Array.isArray(data.steps) || !data.steps.length) {
    return;
  }

  console.log('');
  printTable(
    ['Step', 'Status', 'Error'],
    data.steps.map((step) => [
      step.step || '',
      step.ok ? 'ok' : 'failed',
      step.error && step.error.message ? step.error.message : '',
    ]),
  );
}

function renderMirrorGoTable(data) {
  const lifecycle = data.lifecycle || {};
  printTable(
    ['Field', 'Value'],
    [
      ['mode', data.mode || ''],
      ['planDigest', data.plan && data.plan.planDigest ? data.plan.planDigest : ''],
      ['deployedMarket', data.deploy && data.deploy.pandora ? data.deploy.pandora.marketAddress || '' : ''],
      ['verifyGateOk', data.verify && data.verify.gateResult ? (data.verify.gateResult.ok ? 'yes' : 'no') : ''],
      ['syncStarted', data.sync ? 'yes' : 'no'],
      ['lifecycleStatus', lifecycle.status || ''],
      ['suggestedLifecycleCommand', Array.isArray(lifecycle.suggestedResumeCommands) ? lifecycle.suggestedResumeCommands[0] || '' : ''],
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

function renderMarketsMineTable(data) {
  const items = Array.isArray(data && data.items) ? data.items : [];
  printTable(
    ['Field', 'Value'],
    [
      ['wallet', data && data.wallet ? data.wallet : ''],
      ['walletSource', data && data.walletSource ? data.walletSource : ''],
      ['chainId', data && data.chainId !== undefined && data.chainId !== null ? data.chainId : ''],
      ['markets', Number.isInteger(data && data.count) ? data.count : 0],
      ['tokenMarkets', data && data.exposureCounts ? data.exposureCounts.token : 0],
      ['lpMarkets', data && data.exposureCounts ? data.exposureCounts.lp : 0],
      ['claimableMarkets', data && data.exposureCounts ? data.exposureCounts.claimable : 0],
      ['signerResolved', data && data.runtime && data.runtime.signerResolved ? 'yes' : 'no'],
    ],
  );

  if (!items.length) {
    console.log('');
    console.log('No owned market exposure found.');
    return;
  }

  console.log('');
  printTable(
    ['Market', 'Exposure', 'YES Bal', 'NO Bal', 'LP Tokens', 'Claimable USDC', 'Question'],
    items.map((item) => {
      const token = item && item.exposure ? item.exposure.token : null;
      const lp = item && item.exposure ? item.exposure.lp : null;
      const claimable = item && item.exposure ? item.exposure.claimable : null;
      return [
        short(item && item.marketAddress ? item.marketAddress : '', 18),
        Array.isArray(item && item.exposureTypes) ? item.exposureTypes.join(',') : '',
        token && token.yesBalance !== null && token.yesBalance !== undefined ? token.yesBalance : '',
        token && token.noBalance !== null && token.noBalance !== undefined ? token.noBalance : '',
        lp && lp.lpTokenBalance !== null && lp.lpTokenBalance !== undefined ? lp.lpTokenBalance : '',
        claimable && claimable.estimatedClaimUsdc !== null && claimable.estimatedClaimUsdc !== undefined
          ? claimable.estimatedClaimUsdc
          : '',
        short(item && item.question ? item.question : '', 44),
      ];
    }),
  );

  const diagnostics = Array.isArray(data && data.diagnostics) ? data.diagnostics.filter(Boolean) : [];
  if (diagnostics.length) {
    console.log('');
    console.log(`Diagnostics: ${diagnostics.join('; ')}`);
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
  if (!isSecureHttpUrlOrLocal(resolved)) {
    throw new CliError(
      'INVALID_INDEXER_URL',
      `Indexer URL must use https:// (or http://localhost/127.0.0.1 for local testing). Received: "${resolved}"`,
    );
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

  const client = createIndexerClient(indexerUrl, timeoutMs);
  const pollsByKey = new Map();
  const diagnostic = null;
  let fetchedPolls;
  try {
    fetchedPolls = await client.getManyByIds({
      queryName: 'polls',
      fields: POLLS_LIST_FIELDS,
      ids: Array.from(pollIdSet),
    });
  } catch (err) {
    return {
      pollsByKey,
      diagnostic: `Poll expansion unavailable: ${formatErrorValue(err)}`,
    };
  }

  for (const pollId of pollIdSet) {
    const poll = fetchedPolls.get(pollId);
    if (!poll || typeof poll !== 'object') continue;
    const keys = new Set([pollId, poll.id, poll.pollAddress, poll.address, poll.marketAddress]);
    for (const keyCandidate of keys) {
      const key = normalizeLookupKey(keyCandidate);
      if (key) pollsByKey.set(key, poll);
    }
  }

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

  const tasks = [];
  if (options.expand) {
    tasks.push(
      fetchPollDetailsMap(indexerUrl, items, timeoutMs)
        .then((pollContext) => {
          context.pollsByKey = pollContext.pollsByKey;
          if (pollContext.diagnostic) context.diagnostics.push(pollContext.diagnostic);
        })
        .catch((err) => {
          context.diagnostics.push(`Poll expansion unavailable: ${formatErrorValue(err)}`);
        }),
    );
  }

  if (options.withOdds) {
    tasks.push(
      fetchLiquidityOddsIndex(indexerUrl, options, timeoutMs)
        .then((oddsContext) => {
          context.liquidityOddsByMarket = oddsContext.byMarket;
          context.liquidityOddsByPoll = oddsContext.byPoll;
        })
        .catch((err) => {
          context.diagnostics.push(`Odds enrichment fallback unavailable: ${formatErrorValue(err)}`);
        }),
    );
  }

  if (tasks.length) {
    await Promise.all(tasks);
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

function normalizeProbabilityLike(value) {
  const numeric = toOptionalNumber(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric >= 0 && numeric <= 1) return numeric;
  if (numeric >= 0 && numeric <= 100) return numeric / 100;
  return null;
}

function maybeNormalizeReserveUnits(item, reserveYes, reserveNo) {
  if (!Number.isFinite(reserveYes) || !Number.isFinite(reserveNo)) {
    return {
      reserveYes,
      reserveNo,
      scale: 1,
      scaled: false,
    };
  }

  const total = reserveYes + reserveNo;
  const currentTvl = toOptionalNumber(item && item.currentTvl);
  let scale = 1;

  // Most indexer reserve fields are raw token units (USDC 6 decimals).
  // Normalize integer reserve payloads to human USDC units.
  if (Number.isInteger(reserveYes) && Number.isInteger(reserveNo) && Math.max(reserveYes, reserveNo) >= 1_000_000) {
    scale = 1_000_000;
  } else if (Number.isFinite(currentTvl) && currentTvl > 0) {
    const ratio = total / currentTvl;
    // Indexer payloads sometimes expose reserves in 1e6 units while TVL is already in USDC.
    if (Number.isFinite(ratio) && ratio > 500_000 && ratio < 2_500_000) {
      scale = 1_000_000;
    }
  } else {
    const maxReserve = Math.max(reserveYes, reserveNo);
    if (
      maxReserve >= 1_000_000 &&
      maxReserve <= 1_000_000_000_000 &&
      Number.isInteger(reserveYes) &&
      Number.isInteger(reserveNo) &&
      reserveYes % 1_000_000 === 0 &&
      reserveNo % 1_000_000 === 0
    ) {
      scale = 1_000_000;
    }
  }

  if (scale === 1) {
    return {
      reserveYes,
      reserveNo,
      scale: 1,
      scaled: false,
    };
  }

  return {
    reserveYes: reserveYes / scale,
    reserveNo: reserveNo / scale,
    scale,
    scaled: true,
  };
}

function deriveMarketReservePair(item) {
  const reserveYesDirect = toOptionalNumber(item && (item.reserveYes ?? item.yesReserve ?? item.yesTokenAmount));
  const reserveNoDirect = toOptionalNumber(item && (item.reserveNo ?? item.noReserve ?? item.noTokenAmount));

  if (Number.isFinite(reserveYesDirect) && Number.isFinite(reserveNoDirect)) {
    const normalized = maybeNormalizeReserveUnits(item, reserveYesDirect, reserveNoDirect);
    return {
      reserveYes: normalized.reserveYes,
      reserveNo: normalized.reserveNo,
      estimated: false,
      source: normalized.scaled ? `market:reserve-pair:scaled-1e${Math.round(Math.log10(normalized.scale))}` : 'market:reserve-pair',
    };
  }

  const yesProbability = normalizeProbabilityLike(item && (item.yesChance ?? item.yesPct ?? item.yesProbability));
  if (Number.isFinite(reserveYesDirect) && Number.isFinite(yesProbability) && yesProbability > 0 && yesProbability < 1) {
    const reserveNo = reserveYesDirect * (yesProbability / (1 - yesProbability));
    const normalized = maybeNormalizeReserveUnits(item, reserveYesDirect, reserveNo);
    return {
      reserveYes: normalized.reserveYes,
      reserveNo: normalized.reserveNo,
      estimated: true,
      source: normalized.scaled
        ? `market:reserve-yes+yes-probability:scaled-1e${Math.round(Math.log10(normalized.scale))}`
        : 'market:reserve-yes+yes-probability',
    };
  }

  const currentTvl = toOptionalNumber(item && item.currentTvl);
  if (Number.isFinite(currentTvl) && Number.isFinite(yesProbability) && yesProbability > 0 && yesProbability < 1) {
    const reserveYes = currentTvl * (1 - yesProbability);
    const reserveNo = currentTvl * yesProbability;
    const normalized = maybeNormalizeReserveUnits(item, reserveYes, reserveNo);
    return {
      reserveYes: normalized.reserveYes,
      reserveNo: normalized.reserveNo,
      estimated: true,
      source: normalized.scaled
        ? `market:tvl+yes-probability:scaled-1e${Math.round(Math.log10(normalized.scale))}`
        : 'market:tvl+yes-probability',
    };
  }

  return {
    reserveYes: null,
    reserveNo: null,
    estimated: false,
    source: 'market:unavailable',
  };
}

function solveReservesForYesProbabilityFromK(kValue, yesProbability) {
  if (!Number.isFinite(kValue) || kValue <= 0) return null;
  if (!Number.isFinite(yesProbability) || yesProbability <= 0 || yesProbability >= 1) return null;
  const ratio = yesProbability / (1 - yesProbability);
  const reserveYes = Math.sqrt(kValue / ratio);
  const reserveNo = Math.sqrt(kValue * ratio);
  if (!Number.isFinite(reserveYes) || !Number.isFinite(reserveNo)) return null;
  return { reserveYes, reserveNo };
}

function buildDepthFromReserves(reserveYes, reserveNo) {
  if (!Number.isFinite(reserveYes) || !Number.isFinite(reserveNo) || reserveYes <= 0 || reserveNo <= 0) {
    return null;
  }
  const total = reserveYes + reserveNo;
  if (!Number.isFinite(total) || total <= 0) return null;
  const yesProbability = reserveNo / total;
  const kValue = reserveYes * reserveNo;
  const slippages = [0.01, 0.05, 0.10];
  const depth = {};
  for (const slippage of slippages) {
    const upProb = Math.min(0.999999, yesProbability * (1 + slippage));
    const downProb = Math.max(0.000001, yesProbability * (1 - slippage));
    const up = solveReservesForYesProbabilityFromK(kValue, upProb);
    const down = solveReservesForYesProbabilityFromK(kValue, downProb);
    const buyYesUsdc = up ? Math.max(0, up.reserveNo - reserveNo) : null;
    const buyNoUsdc = down ? Math.max(0, down.reserveYes - reserveYes) : null;
    const minDepthUsdc = [buyYesUsdc, buyNoUsdc].filter((value) => Number.isFinite(value) && value > 0);
    depth[String(Math.round(slippage * 100))] = {
      buyYesUsdc: Number.isFinite(buyYesUsdc) ? round(buyYesUsdc, 6) : null,
      buyNoUsdc: Number.isFinite(buyNoUsdc) ? round(buyNoUsdc, 6) : null,
      minDepthUsdc: minDepthUsdc.length ? round(Math.min(...minDepthUsdc), 6) : null,
    };
  }
  return depth;
}

function buildMarketLiquidityMetrics(item) {
  const reservePair = deriveMarketReservePair(item || {});
  const reserveYes = reservePair.reserveYes;
  const reserveNo = reservePair.reserveNo;
  const marketType = normalizePandoraMarketType(item && item.marketType ? item.marketType : '');
  const totalPool = Number.isFinite(reserveYes) && Number.isFinite(reserveNo) ? reserveYes + reserveNo : null;
  const yesPrice =
    Number.isFinite(totalPool) && totalPool > 0 && Number.isFinite(reserveNo)
      ? reserveNo / totalPool
      : normalizeProbabilityLike(item && (item.yesChance ?? item.yesPct ?? item.yesProbability));
  const noPrice = Number.isFinite(yesPrice) ? (1 - yesPrice) : null;
  const kValue = Number.isFinite(reserveYes) && Number.isFinite(reserveNo) ? reserveYes * reserveNo : null;
  const depth = marketType === 'amm' ? buildDepthFromReserves(reserveYes, reserveNo) : null;
  const feeTier = toOptionalNumber(item && item.feeTier);

  return {
    reserveYes: Number.isFinite(reserveYes) ? round(reserveYes, 6) : null,
    reserveNo: Number.isFinite(reserveNo) ? round(reserveNo, 6) : null,
    feeTier: Number.isFinite(feeTier) ? feeTier : null,
    feePct: Number.isFinite(feeTier) ? round(feeTier / 10_000, 6) : null,
    yesPrice: Number.isFinite(yesPrice) ? round(yesPrice, 6) : null,
    noPrice: Number.isFinite(noPrice) ? round(noPrice, 6) : null,
    kValue: Number.isFinite(kValue) ? round(kValue, 6) : null,
    depth,
    poolYes: marketType === 'parimutuel' && Number.isFinite(reserveYes) ? round(reserveYes, 6) : null,
    poolNo: marketType === 'parimutuel' && Number.isFinite(reserveNo) ? round(reserveNo, 6) : null,
    totalPool: marketType === 'parimutuel' && Number.isFinite(totalPool) ? round(totalPool, 6) : null,
    deadPool: Number.isFinite(reserveYes) && Number.isFinite(reserveNo) ? reserveYes <= 1 || reserveNo <= 1 : null,
    estimated: reservePair.estimated,
    reserveSource: reservePair.source,
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
    enriched.liquidity = buildMarketLiquidityMetrics(baseItem);
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
  const externalDiagnostics = Array.isArray(opts.externalDiagnostics)
    ? opts.externalDiagnostics.map((line) => String(line || '').trim()).filter(Boolean)
    : [];
  if (externalDiagnostics.length) {
    payload.diagnostics = Array.from(new Set(externalDiagnostics));
  }

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
  if (!options) return items;

  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  const expiringCutoffEpochSeconds =
    nowEpochSeconds + parsePositiveInteger(options.expiringSoonHours, '--expiring-hours') * 60 * 60;

  const lifecycleFiltered = (!MARKET_LIFECYCLE_FILTERS.has(options.lifecycle) || options.lifecycle === 'all')
    ? items
    : items.filter((item) => {
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

  if (options.minTvlUsdc === null || options.minTvlUsdc === undefined) {
    return lifecycleFiltered;
  }

  return lifecycleFiltered.filter((item) => {
    const tvl = toOptionalNumber(item && item.currentTvl);
    return Number.isFinite(tvl) && tvl >= options.minTvlUsdc;
  });
}

async function fetchMarketsListPage(indexerUrl, options, timeoutMs) {
  const query = buildGraphqlListQuery('marketss', 'marketsFilter', MARKETS_LIST_FIELDS);
  const data = await graphqlRequest(indexerUrl, query, normalizeListVariables(options), timeoutMs);
  const page = normalizePageResult(data.marketss);
  const items = applyMarketLifecycleFilter(page.items, options);
  return { items, pageInfo: page.pageInfo, unfilteredCount: page.items.length };
}

function buildHedgeablePandoraCandidates(items, pollsByKey) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const poll = firstMappedValue(
      pollsByKey,
      [item && item.pollAddress, item && item.pollId, item && item.poll && item.poll.id],
    );
    return {
      key: normalizeLookupKey(item && item.id),
      question: String(item && item.question ? item.question : poll && poll.question ? poll.question : '').trim() || null,
      closeTimestamp: toOptionalNumber(item && item.marketCloseTimestamp),
    };
  }).filter((item) => item.key && item.question);
}

const HEDGEABLE_MATCH_MIN_TOKEN_SCORE = 0.12;
const HEDGEABLE_MATCH_SIMILARITY_THRESHOLD = 0.7;

function findBestHedgeablePolymarketMatch(candidate, polymarketItems) {
  const maxCloseDiffHours = 24;
  let best = null;
  for (const item of polymarketItems) {
    if (!item || !item.question) continue;
    const similarity = questionSimilarityBreakdown(candidate.question, item.question);
    const passesContentOverlap =
      similarity.contentSharedTokenCount >= 2
      || (
        similarity.contentSharedTokenCount === 1
        && similarity.score >= Math.max(HEDGEABLE_MATCH_SIMILARITY_THRESHOLD + 0.12, 0.65)
        && similarity.jaroWinkler >= 0.88
      );
    if (
      similarity.tokenScore < HEDGEABLE_MATCH_MIN_TOKEN_SCORE
      || similarity.score < HEDGEABLE_MATCH_SIMILARITY_THRESHOLD
      || !passesContentOverlap
    ) continue;

    let closeDiffHours = null;
    const leftClose = toOptionalNumber(candidate.closeTimestamp);
    const rightClose = toOptionalNumber(item.closeTimestamp);
    if (Number.isFinite(leftClose) && Number.isFinite(rightClose)) {
      closeDiffHours = Math.abs(leftClose - rightClose) / 3600;
      if (closeDiffHours > maxCloseDiffHours) continue;
    }

    const summary = {
      marketId: item.marketId || null,
      similarity,
      closeDiffHours,
    };
    if (
      !best ||
      summary.similarity.score > best.similarity.score ||
      (
        summary.similarity.score === best.similarity.score &&
        Number.isFinite(summary.closeDiffHours) &&
        (!Number.isFinite(best.closeDiffHours) || summary.closeDiffHours < best.closeDiffHours)
      )
    ) {
      best = summary;
    }
  }
  return best;
}

async function filterHedgeableMarkets({ indexerUrl, timeoutMs, options, items }) {
  const normalizedItems = Array.isArray(items) ? items.map((item) => normalizeMarketNumericFields(item)) : [];
  if (!normalizedItems.length) {
    return { items: normalizedItems, unfilteredCount: 0, diagnostics: [] };
  }

  const diagnostics = [];
  const pollContext = await fetchPollDetailsMap(indexerUrl, normalizedItems, timeoutMs);
  if (pollContext.diagnostic) diagnostics.push(pollContext.diagnostic);
  const pandoraCandidates = buildHedgeablePandoraCandidates(normalizedItems, pollContext.pollsByKey);
  if (!pandoraCandidates.length) {
    return {
      items: [],
      unfilteredCount: normalizedItems.length,
      diagnostics: diagnostics.length
        ? diagnostics
        : ['Hedgeable filter skipped: no candidate questions available for the current page.'],
    };
  }

  let polymarketPayload;
  try {
    polymarketPayload = await fetchPolymarketMarkets({
      timeoutMs,
      limit: Math.max(pandoraCandidates.length * 4, 100),
    });
  } catch (err) {
    return {
      items: normalizedItems,
      unfilteredCount: normalizedItems.length,
      diagnostics: [
        ...diagnostics,
        `Hedgeable filter degraded: Polymarket matcher unavailable (${formatErrorValue(err)}); returning unfiltered market set.`,
      ],
    };
  }

  const matchedPandoraIds = new Set();
  const polymarketItems = Array.isArray(polymarketPayload && polymarketPayload.items)
    ? polymarketPayload.items
    : [];
  if (Array.isArray(polymarketPayload && polymarketPayload.diagnostics) && polymarketPayload.diagnostics.length) {
    diagnostics.push(...polymarketPayload.diagnostics);
  }

  for (const candidate of pandoraCandidates) {
    const bestMatch = findBestHedgeablePolymarketMatch(candidate, polymarketItems);
    if (bestMatch) {
      matchedPandoraIds.add(candidate.key);
    }
  }

  if (!matchedPandoraIds.size) {
    diagnostics.push('Hedgeable filter found no cross-venue matches for the current page.');
  }

  return {
    items: normalizedItems.filter((item) => {
      const key = normalizeLookupKey(item && item.id);
      return key ? matchedPandoraIds.has(key) : false;
    }),
    unfilteredCount: normalizedItems.length,
    diagnostics: Array.from(new Set(diagnostics)),
  };
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
  if (options.maxAmountUsdc !== null && options.amountUsdc !== null && options.amountUsdc > options.maxAmountUsdc) {
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
    ((options.mode === 'sell' && options.minAmountOutRaw === null) || (options.mode !== 'sell' && options.minSharesOutRaw === null)) &&
    !options.allowUnquotedExecute
  ) {
    throw new CliError(
      'TRADE_RISK_GUARD',
      options.mode === 'sell'
        ? 'Execute mode requires a quote by default. Provide --yes-pct, or set --min-amount-out-raw, or pass --allow-unquoted-execute.'
        : 'Execute mode requires a quote by default. Provide --yes-pct, or set --min-shares-out-raw, or pass --allow-unquoted-execute.',
    );
  }
}

function computeAmmBuySharesFromReserves(liquidity, side, amountUsdc) {
  const reserveYes = toOptionalNumber(liquidity && liquidity.reserveYes);
  const reserveNo = toOptionalNumber(liquidity && liquidity.reserveNo);
  if (!Number.isFinite(reserveYes) || !Number.isFinite(reserveNo) || reserveYes <= 0 || reserveNo <= 0) {
    return null;
  }
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
    return null;
  }

  const kValue = reserveYes * reserveNo;
  if (!Number.isFinite(kValue) || kValue <= 0) return null;

  const normalizedSide = String(side || '').toLowerCase();
  const isYes = normalizedSide === 'yes';

  let sharesOut = null;
  let spotPrice = null;
  let impliedProbability = null;
  if (isYes) {
    // Binary AMM execution path is mint+swap:
    // 1) deposit collateral => mint amount YES + amount NO
    // 2) swap minted NO into pool for extra YES along x*y=k
    const nextReserveNo = reserveNo + amountUsdc;
    if (!Number.isFinite(nextReserveNo) || nextReserveNo <= 0) return null;
    const nextReserveYes = kValue / nextReserveNo;
    const swapOutputYes = reserveYes - nextReserveYes;
    if (!Number.isFinite(swapOutputYes) || swapOutputYes < 0) return null;
    sharesOut = amountUsdc + swapOutputYes;
    spotPrice = reserveNo / (reserveYes + reserveNo);
    impliedProbability = reserveNo / (reserveYes + reserveNo);
  } else {
    // Binary AMM execution path is mint+swap:
    // 1) deposit collateral => mint amount YES + amount NO
    // 2) swap minted YES into pool for extra NO along x*y=k
    const nextReserveYes = reserveYes + amountUsdc;
    if (!Number.isFinite(nextReserveYes) || nextReserveYes <= 0) return null;
    const nextReserveNo = kValue / nextReserveYes;
    const swapOutputNo = reserveNo - nextReserveNo;
    if (!Number.isFinite(swapOutputNo) || swapOutputNo < 0) return null;
    sharesOut = amountUsdc + swapOutputNo;
    spotPrice = reserveYes / (reserveYes + reserveNo);
    impliedProbability = reserveYes / (reserveYes + reserveNo);
  }

  if (!Number.isFinite(sharesOut) || sharesOut <= 0) return null;
  const effectivePrice = amountUsdc / sharesOut;
  if (!Number.isFinite(effectivePrice) || effectivePrice <= 0) return null;

  const slippagePct =
    Number.isFinite(spotPrice) && spotPrice > 0
      ? ((effectivePrice - spotPrice) / spotPrice) * 100
      : null;

  return {
    impliedProbability,
    pricePerShare: effectivePrice,
    estimatedShares: sharesOut,
    slippagePct,
    spotPrice,
  };
}

function solveAmmCollateralForShares(liquidity, side, shareAmount) {
  const targetShares = toOptionalNumber(shareAmount);
  if (!Number.isFinite(targetShares) || targetShares <= 0) return null;

  let lower = 0;
  let upper = Math.max(1, targetShares);
  let upperEstimate = computeAmmBuySharesFromReserves(liquidity, side, upper);
  let iterations = 0;
  while (
    (!upperEstimate || !Number.isFinite(upperEstimate.estimatedShares) || upperEstimate.estimatedShares < targetShares) &&
    iterations < 40
  ) {
    upper *= 2;
    upperEstimate = computeAmmBuySharesFromReserves(liquidity, side, upper);
    iterations += 1;
  }
  if (!upperEstimate || !Number.isFinite(upperEstimate.estimatedShares) || upperEstimate.estimatedShares < targetShares) {
    return null;
  }

  for (let i = 0; i < 80; i += 1) {
    const midpoint = (lower + upper) / 2;
    const estimate = computeAmmBuySharesFromReserves(liquidity, side, midpoint);
    if (!estimate || !Number.isFinite(estimate.estimatedShares)) {
      return null;
    }
    if (estimate.estimatedShares >= targetShares) {
      upper = midpoint;
    } else {
      lower = midpoint;
    }
  }
  return upper;
}

function buildAmmSellEstimateFromReserves(liquidity, side, shareAmount) {
  const sharesIn = toOptionalNumber(shareAmount);
  if (!Number.isFinite(sharesIn) || sharesIn <= 0) return null;

  const grossUsdcOut = solveAmmCollateralForShares(liquidity, side, sharesIn);
  if (!Number.isFinite(grossUsdcOut) || grossUsdcOut <= 0) {
    return null;
  }

  const reserveYes = toOptionalNumber(liquidity && liquidity.reserveYes);
  const reserveNo = toOptionalNumber(liquidity && liquidity.reserveNo);
  const normalizedSide = String(side || '').toLowerCase();
  const isYes = normalizedSide === 'yes';
  const spotPrice =
    Number.isFinite(reserveYes) && Number.isFinite(reserveNo) && reserveYes > 0 && reserveNo > 0
      ? (isYes ? reserveNo / (reserveYes + reserveNo) : reserveYes / (reserveYes + reserveNo))
      : null;
  const impliedProbability = spotPrice;
  const feePct = toOptionalNumber(liquidity && liquidity.feePct);
  const feeFraction = Number.isFinite(feePct) && feePct > 0 ? feePct / 100 : 0;
  const feeAmount = grossUsdcOut * feeFraction;
  const estimatedUsdcOut = Math.max(0, grossUsdcOut - feeAmount);
  const effectivePrice = estimatedUsdcOut / sharesIn;
  const slippagePct =
    Number.isFinite(spotPrice) && spotPrice > 0
      ? ((spotPrice - effectivePrice) / spotPrice) * 100
      : null;

  return {
    impliedProbability,
    pricePerShare: effectivePrice,
    estimatedUsdcOut,
    grossUsdcOut,
    feeAmount,
    feePct,
    slippagePct,
    netDeltaChange: -sharesIn,
    spotPrice,
  };
}

function buildQuoteEstimate(odds, side, inputAmount, slippageBps, marketContext = null, quoteMode = 'buy', explicitEstimate = null) {
  const probability = side === 'yes' ? odds.yesProbability : odds.noProbability;
  const normalizedMode = String(quoteMode || 'buy').toLowerCase();
  if (normalizedMode !== 'sell' && (!Number.isFinite(probability) || probability <= 0)) {
    return null;
  }

  if (normalizedMode === 'sell') {
    let sellEstimate = explicitEstimate;
    if (!sellEstimate) {
      const marketType = normalizePandoraMarketType(marketContext && marketContext.marketType ? marketContext.marketType : '');
      if (marketType === 'amm') {
        sellEstimate = buildAmmSellEstimateFromReserves(marketContext && marketContext.liquidity, side, inputAmount);
      }
    }
    if (!sellEstimate || !Number.isFinite(sellEstimate.estimatedUsdcOut) || sellEstimate.estimatedUsdcOut <= 0) {
      return null;
    }
    const slippageFactor = Math.max(0, (10_000 - slippageBps) / 10_000);
    return {
      estimateSource: sellEstimate.estimateSource || 'amm-reserves-inverse',
      impliedProbability: Number.isFinite(sellEstimate.impliedProbability) ? round(sellEstimate.impliedProbability, 6) : null,
      pricePerShare: Number.isFinite(sellEstimate.pricePerShare) ? round(sellEstimate.pricePerShare, 6) : null,
      estimatedShares: null,
      estimatedUsdcOut: round(sellEstimate.estimatedUsdcOut, 6),
      grossUsdcOut: Number.isFinite(sellEstimate.grossUsdcOut) ? round(sellEstimate.grossUsdcOut, 6) : round(sellEstimate.estimatedUsdcOut, 6),
      minAmountOut: round(sellEstimate.estimatedUsdcOut * slippageFactor, 6),
      feeAmount: Number.isFinite(sellEstimate.feeAmount) ? round(sellEstimate.feeAmount, 6) : null,
      feePct: Number.isFinite(sellEstimate.feePct) ? round(sellEstimate.feePct, 6) : null,
      potentialPayoutIfWin: null,
      potentialProfitIfWin: null,
      slippagePct: Number.isFinite(sellEstimate.slippagePct) ? round(sellEstimate.slippagePct, 6) : null,
      priceImpactPct: Number.isFinite(sellEstimate.slippagePct) ? round(sellEstimate.slippagePct, 6) : null,
      slippageBps,
      netDeltaChange: Number.isFinite(sellEstimate.netDeltaChange) ? round(sellEstimate.netDeltaChange, 6) : null,
    };
  }

  const amountUsdc = inputAmount;
  let estimateSource = 'probability-linear';
  let impliedProbability = probability;
  let pricePerShare = probability;
  let estimatedShares = amountUsdc / pricePerShare;
  let slippagePct = 0;

  const marketType = normalizePandoraMarketType(marketContext && marketContext.marketType ? marketContext.marketType : '');
  if (marketType === 'amm') {
    const ammEstimate = computeAmmBuySharesFromReserves(marketContext && marketContext.liquidity, side, amountUsdc);
    if (ammEstimate) {
      estimateSource = 'amm-reserves';
      impliedProbability = Number.isFinite(ammEstimate.impliedProbability) ? ammEstimate.impliedProbability : probability;
      pricePerShare = Number.isFinite(ammEstimate.pricePerShare) ? ammEstimate.pricePerShare : pricePerShare;
      estimatedShares = Number.isFinite(ammEstimate.estimatedShares) ? ammEstimate.estimatedShares : estimatedShares;
      slippagePct = Number.isFinite(ammEstimate.slippagePct) ? ammEstimate.slippagePct : slippagePct;
    }
  }

  const slippageFactor = Math.max(0, (10_000 - slippageBps) / 10_000);
  const minSharesOut = estimatedShares * slippageFactor;
  const payoutIfWin = estimatedShares;
  const profitIfWin = payoutIfWin - amountUsdc;

  return {
    estimateSource,
    impliedProbability: round(impliedProbability, 6),
    pricePerShare: round(pricePerShare, 6),
    estimatedShares: round(estimatedShares, 6),
    minSharesOut: round(minSharesOut, 6),
    potentialPayoutIfWin: round(payoutIfWin, 6),
    potentialProfitIfWin: round(profitIfWin, 6),
    slippagePct: round(slippagePct, 6),
    slippageBps,
    netDeltaChange: round(estimatedShares, 6),
  };
}

function buildQuoteEstimateCurve(odds, side, amountsUsdc, slippageBps, marketContext = null, quoteMode = 'buy', explicitSellEstimates = null) {
  const amounts = Array.isArray(amountsUsdc) ? amountsUsdc : [];
  const curve = [];
  for (const amount of amounts) {
    const explicitEstimate = explicitSellEstimates instanceof Map ? explicitSellEstimates.get(String(amount)) || explicitSellEstimates.get(amount) : null;
    const estimate = buildQuoteEstimate(odds, side, amount, slippageBps, marketContext, quoteMode, explicitEstimate);
    if (!estimate) {
      curve.push({
        amountUsdc: quoteMode === 'sell' ? null : amount,
        amount: quoteMode === 'sell' ? amount : null,
        estimatedShares: null,
        effectivePrice: null,
        slippagePct: null,
        roiIfWinPct: null,
        estimatedUsdcOut: null,
      });
      continue;
    }
    const effectivePrice =
      quoteMode === 'sell'
        ? (Number.isFinite(estimate.estimatedUsdcOut) && amount > 0 ? estimate.estimatedUsdcOut / amount : null)
        : (estimate.estimatedShares > 0 ? amount / estimate.estimatedShares : null);
    const impliedPrice = Number.isFinite(estimate.pricePerShare) ? estimate.pricePerShare : null;
    const slippagePct = Number.isFinite(estimate.slippagePct)
      ? estimate.slippagePct
      : Number.isFinite(effectivePrice) && Number.isFinite(impliedPrice) && impliedPrice > 0
        ? (quoteMode === 'sell'
          ? ((impliedPrice - effectivePrice) / impliedPrice) * 100
          : ((effectivePrice - impliedPrice) / impliedPrice) * 100)
        : null;
    const roiIfWinPct =
      quoteMode === 'sell'
        ? null
        : (Number.isFinite(estimate.potentialProfitIfWin) && amount > 0
          ? (estimate.potentialProfitIfWin / amount) * 100
          : null);
    curve.push({
      amountUsdc: quoteMode === 'sell' ? null : round(amount, 6),
      amount: quoteMode === 'sell' ? round(amount, 6) : null,
      estimatedShares: estimate.estimatedShares,
      estimatedUsdcOut: Number.isFinite(estimate.estimatedUsdcOut) ? estimate.estimatedUsdcOut : null,
      effectivePrice: Number.isFinite(effectivePrice) ? round(effectivePrice, 6) : null,
      slippagePct: Number.isFinite(slippagePct) ? round(slippagePct, 6) : null,
      roiIfWinPct: Number.isFinite(roiIfWinPct) ? round(roiIfWinPct, 6) : null,
      estimateSource: estimate.estimateSource || null,
      estimate,
    });
  }
  return curve;
}

function buildParimutuelEstimate(liquidity, side, amountUsdc) {
  const poolYes = toOptionalNumber(liquidity && liquidity.poolYes);
  const poolNo = toOptionalNumber(liquidity && liquidity.poolNo);
  if (!Number.isFinite(poolYes) || !Number.isFinite(poolNo) || amountUsdc <= 0) return null;
  const totalBefore = poolYes + poolNo;
  const selectedPoolBefore = side === 'yes' ? poolYes : poolNo;
  const selectedPoolAfter = selectedPoolBefore + amountUsdc;
  const totalAfter = totalBefore + amountUsdc;
  if (selectedPoolAfter <= 0 || totalAfter <= 0) return null;
  const sharePct = amountUsdc / selectedPoolAfter;
  const payoutIfWin = sharePct * totalAfter;
  const profitIfWin = payoutIfWin - amountUsdc;
  const breakevenProbability = payoutIfWin > 0 ? amountUsdc / payoutIfWin : null;
  return {
    poolYes: round(poolYes, 6),
    poolNo: round(poolNo, 6),
    totalPool: round(totalBefore, 6),
    selectedPoolAfter: round(selectedPoolAfter, 6),
    sharePct: round(sharePct, 6),
    payoutIfWin: round(payoutIfWin, 6),
    profitIfWin: round(profitIfWin, 6),
    breakevenProbability: Number.isFinite(breakevenProbability) ? round(breakevenProbability, 6) : null,
  };
}

async function fetchMarketSnapshotMap(indexerUrl, marketAddresses, timeoutMs) {
  const uniqueIds = Array.from(new Set((marketAddresses || []).map((value) => String(value || '').trim()).filter(Boolean)));
  const out = new Map();
  if (!uniqueIds.length) return out;

  const client = createIndexerClient(indexerUrl, timeoutMs);
  let fetchedMarkets;
  try {
    fetchedMarkets = await client.getManyByIds({
      queryName: 'markets',
      fields: MARKETS_LIST_FIELDS,
      ids: uniqueIds,
    });
  } catch {
    return out;
  }

  for (const marketId of uniqueIds) {
    const item = fetchedMarkets.get(marketId);
    if (!item || typeof item !== 'object') continue;
    const normalized = normalizeMarketNumericFields(item);
    out.set(marketId, normalized);
    const normalizedKey = normalizeLookupKey(marketId);
    if (normalizedKey) out.set(normalizedKey, normalized);
  }
  return out;
}

async function fetchMarketSnapshot(indexerUrl, marketAddress, timeoutMs) {
  const fetched = await fetchMarketSnapshotMap(indexerUrl, [marketAddress], timeoutMs);
  return fetched.get(String(marketAddress || '').trim()) || fetched.get(normalizeLookupKey(marketAddress)) || null;
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

async function maybeReadAmmSellEstimateFromContract(options) {
  const marketAddress = String(options && options.marketAddress ? options.marketAddress : '').trim();
  const side = String(options && options.side ? options.side : '').trim().toLowerCase();
  const amount = toOptionalNumber(options && options.amount);
  if (!isValidAddress(marketAddress) || (side !== 'yes' && side !== 'no') || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  let publicClient;
  try {
    publicClient = await createReadOnlyPublicClient(options && options.chainId, options && options.rpcUrl);
  } catch {
    publicClient = null;
  }
  if (!publicClient) return null;

  try {
    const { parseUnits, formatUnits } = await loadViemRuntime();
    const functionName = side === 'yes' ? 'calcSellYes' : 'calcSellNo';
    const amountRaw = parseUnits(String(amount), 18);
    const amountOutRaw = await publicClient.readContract({
      address: marketAddress,
      abi: AMM_SELL_QUOTE_ABI,
      functionName,
      args: [amountRaw],
    });
    const estimatedUsdcOut = Number(formatUnits(amountOutRaw, 6));
    if (!Number.isFinite(estimatedUsdcOut) || estimatedUsdcOut <= 0) {
      return null;
    }
    return {
      estimateSource: 'amm-contract-view',
      estimatedUsdcOut,
      grossUsdcOut: estimatedUsdcOut,
      feeAmount: null,
      feePct: null,
      pricePerShare: estimatedUsdcOut / amount,
      netDeltaChange: -amount,
    };
  } catch {
    return null;
  }
}

async function buildQuotePayload(indexerUrl, options, timeoutMs) {
  const market = await fetchMarketSnapshot(indexerUrl, options.marketAddress, timeoutMs);
  const liquidity = buildMarketLiquidityMetrics(market || {});
  const marketType = normalizePandoraMarketType(market && market.marketType ? market.marketType : '');
  const marketContext = { marketType, liquidity };
  const quoteMode = String(options && options.mode ? options.mode : 'buy').toLowerCase();
  let odds;
  try {
    odds = await resolveQuoteOdds(indexerUrl, options, timeoutMs);
  } catch (err) {
    odds = buildNullOdds(null, `Unable to fetch odds: ${formatErrorValue(err)}`);
  }
  if (
    (!Number.isFinite(odds && odds.yesProbability) || !Number.isFinite(odds && odds.noProbability))
    && Number.isFinite(liquidity.yesPrice)
    && Number.isFinite(liquidity.noPrice)
  ) {
    const reserveOdds = normalizeOddsFromPair(liquidity.yesPrice, liquidity.noPrice, 'market-snapshot:reserves');
    if (reserveOdds && !reserveOdds.diagnostic) {
      odds = reserveOdds;
    }
  }

  let targeting = null;
  let resolvedAmountUsdc = options.amountUsdc;
  let resolvedAmountsUsdc =
    Array.isArray(options.amountsUsdc) && options.amountsUsdc.length ? options.amountsUsdc : [options.amountUsdc];
  if (quoteMode !== 'sell' && options.targetPct !== null && options.targetPct !== undefined) {
    if (marketType !== 'amm') {
      throw new CliError(
        'INVALID_FLAG_COMBINATION',
        '--target-pct is only supported for AMM quote requests.',
        { marketType: marketType || null },
      );
    }
    const { planAmmTradeToTargetYesPct } = getAmmTargetPctService();
    targeting = planAmmTradeToTargetYesPct({
      targetYesPct: options.targetPct,
      reserveYesUsdc: liquidity.reserveYes,
      reserveNoUsdc: liquidity.reserveNo,
      feeTier: Number.isFinite(Number(liquidity.feeTier)) ? Number(liquidity.feeTier) : 3000,
      requestedSide: options.side,
    });
    if (targeting && targeting.sideMatchesTarget === false) {
      throw new CliError(
        'INVALID_FLAG_COMBINATION',
        Array.isArray(targeting.diagnostics) && targeting.diagnostics.length
          ? targeting.diagnostics[0]
          : 'Requested side is incompatible with --target-pct.',
        { targeting },
      );
    }
    resolvedAmountUsdc =
      targeting && Number.isFinite(targeting.requiredAmountUsdc)
        ? targeting.requiredAmountUsdc
        : null;
    resolvedAmountsUsdc = Number.isFinite(resolvedAmountUsdc) ? [resolvedAmountUsdc] : [];
  }

  const amountInput = quoteMode === 'sell' ? options.amount : resolvedAmountUsdc;
  const amounts = quoteMode === 'sell'
    ? (Array.isArray(options.amounts) && options.amounts.length ? options.amounts : [options.amount])
    : resolvedAmountsUsdc;
  const explicitSellEstimates = new Map();
  if (quoteMode === 'sell' && marketType === 'amm') {
    for (const amount of amounts) {
      const estimate = await maybeReadAmmSellEstimateFromContract({
        marketAddress: options.marketAddress,
        side: options.side,
        amount,
        chainId: options.chainId,
        rpcUrl: options.rpcUrl,
      });
      if (estimate) {
        const probability = options.side === 'yes' ? odds.yesProbability : odds.noProbability;
        if (Number.isFinite(probability) && !Number.isFinite(estimate.impliedProbability)) {
          estimate.impliedProbability = probability;
        }
        explicitSellEstimates.set(String(amount), estimate);
      }
    }
  }
  const estimate = Number.isFinite(amountInput)
    ? buildQuoteEstimate(
        odds,
        options.side,
        amountInput,
        options.slippageBps,
        marketContext,
        quoteMode,
        quoteMode === 'sell' ? explicitSellEstimates.get(String(amountInput)) || null : null,
      )
    : null;
  const curve = Array.isArray(amounts) && amounts.length
    ? buildQuoteEstimateCurve(
        odds,
        options.side,
        amounts,
        options.slippageBps,
        marketContext,
        quoteMode,
        explicitSellEstimates,
      )
    : [];
  const parimutuel = quoteMode !== 'sell' && marketType === 'parimutuel'
    ? buildParimutuelEstimate(liquidity, options.side, resolvedAmountUsdc)
    : null;
  const diagnostics = [];
  if (odds && odds.diagnostic) diagnostics.push(String(odds.diagnostic));
  if (targeting && Array.isArray(targeting.diagnostics)) {
    for (const diagnostic of targeting.diagnostics) {
      if (diagnostic && !diagnostics.includes(String(diagnostic))) diagnostics.push(String(diagnostic));
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    indexerUrl,
    marketAddress: options.marketAddress,
    marketType: market && market.marketType ? market.marketType : null,
    mode: quoteMode,
    side: options.side,
    amountUsdc: resolvedAmountUsdc,
    amount: options.amount,
    targetPct: options.targetPct !== undefined ? options.targetPct : null,
    slippageBps: options.slippageBps,
    quoteAvailable: Boolean(estimate),
    odds,
    estimate,
    curve,
    liquidity,
    parimutuel,
    targeting,
    diagnostics,
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

  const hasProfileSelector = Boolean(
    options.profile
    || (typeof options.profileId === 'string' && options.profileId.trim())
    || (typeof options.profileFile === 'string' && options.profileFile.trim()),
  );
  const explicitPrivateKey = options.privateKey ? String(options.privateKey).trim() : '';
  if (explicitPrivateKey && !isValidPrivateKey(explicitPrivateKey)) {
    throw new CliError(
      'INVALID_FLAG_VALUE',
      'Invalid --private-key. Expected 0x + 64 hex chars.',
    );
  }
  const envPrivateKey = String(process.env.PANDORA_PRIVATE_KEY || process.env.PRIVATE_KEY || '').trim();
  const privateKey = explicitPrivateKey
    ? explicitPrivateKey
    : isValidPrivateKey(envPrivateKey)
      ? envPrivateKey
      : null;
  if (!privateKey && !hasProfileSelector) {
    throw new CliError(
      'INVALID_FLAG_VALUE',
      'Missing signer credentials. Set PANDORA_PRIVATE_KEY (preferred) or PRIVATE_KEY, pass --private-key, or use --profile-id/--profile-file.',
    );
  }

  const usdc = options.usdc || String(process.env.USDC || '').trim();
  if (!usdc) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing USDC token address. Set USDC in env or pass --usdc.');
  }
  const usdcAddress = parseAddressFlag(usdc, '--usdc');
  const executionRoute = String(
    options.executionRoute
      || options.rebalanceRoute
      || process.env.MIRROR_REBALANCE_ROUTE
      || 'public',
  ).trim().toLowerCase();
  if (!['public', 'auto', 'flashbots-private', 'flashbots-bundle'].includes(executionRoute)) {
    throw new CliError(
      'INVALID_FLAG_VALUE',
      '--rebalance-route must be public|auto|flashbots-private|flashbots-bundle.',
    );
  }
  const executionRouteFallback = String(
    options.executionRouteFallback
      || options.rebalanceRouteFallback
      || process.env.MIRROR_REBALANCE_ROUTE_FALLBACK
      || 'fail',
  ).trim().toLowerCase();
  if (!['fail', 'public'].includes(executionRouteFallback)) {
    throw new CliError(
      'INVALID_FLAG_VALUE',
      '--rebalance-route-fallback must be fail|public.',
    );
  }
  const flashbotsRelayUrl = normalizeFlashbotsRelayUrl(
    options.flashbotsRelayUrl || process.env.FLASHBOTS_RELAY_URL || DEFAULT_FLASHBOTS_RELAY_URL,
  );
  if (!isSecureHttpUrlOrLocal(flashbotsRelayUrl)) {
    throw new CliError(
      'INVALID_FLAG_VALUE',
      '--flashbots-relay-url must use https:// (or http://localhost/127.0.0.1 for local testing).',
    );
  }
  const flashbotsAuthKey = String(options.flashbotsAuthKey || process.env.FLASHBOTS_AUTH_KEY || '').trim() || null;
  if (flashbotsAuthKey && !isValidPrivateKey(flashbotsAuthKey)) {
    throw new CliError(
      'INVALID_FLAG_VALUE',
      '--flashbots-auth-key must be 0x + 64 hex chars.',
    );
  }
  const flashbotsTargetBlockOffset = normalizeTargetBlockOffset(
    options.flashbotsTargetBlockOffset || process.env.FLASHBOTS_TARGET_BLOCK_OFFSET || DEFAULT_FLASHBOTS_TARGET_BLOCK_OFFSET,
  );

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
    profileId: options.profileId || null,
    profileFile: options.profileFile || null,
    profile: options.profile || null,
    usdcAddress,
    executionRoute,
    executionRouteFallback,
    flashbotsRelayUrl,
    flashbotsAuthKey,
    flashbotsTargetBlockOffset,
  };
}

async function loadViemRuntime() {
  const viem = await import('viem');
  const accounts = await import('viem/accounts');
  return { ...viem, ...accounts };
}

async function hasContractCodeAtAddress(options = {}) {
  const marketAddress = String(options.marketAddress || '').trim();
  if (!isValidAddress(marketAddress)) {
    return false;
  }
  const parsedChainId = Number.parseInt(
    options.chainId === null || options.chainId === undefined ? process.env.CHAIN_ID || '1' : String(options.chainId),
    10,
  );
  const chainId = Number.isInteger(parsedChainId) && parsedChainId > 0 ? parsedChainId : 1;
  const rpcUrl = options.rpcUrl || process.env.RPC_URL || DEFAULT_RPC_BY_CHAIN_ID[chainId] || null;
  if (!rpcUrl) {
    return false;
  }

  const { createPublicClient, getAddress, http } = await loadViemRuntime();
  const chain = {
    id: chainId,
    name: `Chain ${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
  };
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const normalizedAddress = typeof getAddress === 'function' ? getAddress(marketAddress) : marketAddress;
  const code = await publicClient.getBytecode({ address: normalizedAddress });
  return Boolean(code && code !== '0x' && code !== '0x0');
}

function deriveWalletAddressFromPrivateKey(privateKey) {
  const raw = typeof privateKey === 'string' ? privateKey.trim() : '';
  if (!raw) {
    return null;
  }
  const { privateKeyToAccount } = require('viem/accounts');
  return privateKeyToAccount(raw).address.toLowerCase();
}

async function executeTradeOnchain(options) {
  const runtime = resolveTradeRuntimeConfig(options);
  const viemRuntime = await loadViemRuntime();
  const {
    createPublicClient,
    formatUnits,
    http,
    parseUnits,
  } = viemRuntime;
  let materializedSigner;
  const tradeAction = String(options && options.mode ? options.mode : 'buy').toLowerCase();
  try {
    materializedSigner = await getExecutionSignerService().materializeExecutionSigner({
      privateKey: runtime.privateKey,
      profileId: runtime.profileId,
      profileFile: runtime.profileFile,
      profile: runtime.profile,
      chain: runtime.chain,
      chainId: runtime.chainId,
      rpcUrl: runtime.rpcUrl,
      viemRuntime,
      env: process.env,
      requireSigner: true,
      mode: 'execute',
      liveRequested: true,
      mutating: true,
      command: tradeAction === 'sell' ? 'sell' : 'trade',
      toolFamily: tradeAction === 'sell' ? 'sell' : 'trade',
      category: options && options.category ? options.category : null,
      metadata: {
        source: 'trade',
        action: tradeAction,
      },
    });
  } catch (error) {
    if (error && error.code) {
      throw new CliError(error.code, error.message || 'Unable to materialize signer for trade execution.', error.details);
    }
    throw error;
  }
  const account = materializedSigner.account;
  const publicClient = createPublicClient({ chain: runtime.chain, transport: http(runtime.rpcUrl) });
  const walletClient = materializedSigner.walletClient;

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

  const tradeMode = String(options && options.mode ? options.mode : 'buy').toLowerCase();
  const isSell = tradeMode === 'sell';
  const amountRaw = isSell
    ? parseUnits(String(options.amount), 18)
    : parseUnits(String(options.amountUsdc), 6);
  const minSharesOutRaw = options.minSharesOutRaw == null ? 0n : options.minSharesOutRaw;
  const minAmountOutRaw = options.minAmountOutRaw == null ? 0n : options.minAmountOutRaw;
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

  let tradeCall;
  try {
    if (isSell) {
      tradeCall = await resolveTradeSellCall({
        publicClient,
        marketAddress: options.marketAddress,
        side: options.side,
        amountRaw,
        minAmountOutRaw,
      });
    } else {
      tradeCall = await resolveTradeBuyCall({
        publicClient,
        marketAddress: options.marketAddress,
        side: options.side,
        amountRaw,
        minSharesOutRaw,
      });
    }
  } catch (error) {
    if (error && error.code) {
      throw new CliError(
        error.code,
        error.message || 'Unsupported market trade interface.',
        error.details,
      );
    }
    await decodeTradeError(error, 'TRADE_MARKET_TYPE_RESOLUTION_FAILED', 'Unable to resolve market trade interface.', {
      stage: 'market-type-resolve',
      mode: tradeMode,
    });
  }

  const approvalAsset = isSell
    ? await readOutcomeTokenAddressForSide(publicClient, options.marketAddress, options.side)
    : runtime.usdcAddress;
  if (!approvalAsset) {
    throw new CliError(
      'OUTCOME_TOKEN_ADDRESS_UNAVAILABLE',
      `Unable to resolve ${options.side.toUpperCase()} outcome token address for sell execution.`,
      {
        marketAddress: options.marketAddress,
        side: options.side,
      },
    );
  }

  if (isSell) {
    let tokenBalance;
    try {
      tokenBalance = await publicClient.readContract({
        address: approvalAsset,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [account.address],
      });
    } catch (error) {
      await decodeTradeError(error, 'OUTCOME_TOKEN_BALANCE_READ_FAILED', 'Failed to read outcome token balance.', {
        stage: 'balance-read',
        tokenAddress: approvalAsset,
      });
    }
    if (tokenBalance < amountRaw) {
      throw new CliError(
        'INSUFFICIENT_OUTCOME_TOKEN_BALANCE',
        `Wallet outcome token balance is insufficient for sell amount (${formatUnits(amountRaw, 18)} required).`,
        {
          side: options.side,
          tokenAddress: approvalAsset,
          balanceRaw: tokenBalance.toString(),
          requiredRaw: amountRaw.toString(),
        },
      );
    }
  }

  let allowance;
  try {
    allowance = await publicClient.readContract({
      address: approvalAsset,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account.address, options.marketAddress],
    });
  } catch (error) {
    await decodeTradeError(error, 'ALLOWANCE_READ_FAILED', `Failed to read ${isSell ? 'outcome token' : 'USDC'} allowance.`, {
      stage: 'allowance-read',
      approvalAsset,
      });
  }

  const needsApproval = allowance < amountRaw;
  const requestedExecutionRoute = runtime.executionRoute;
  const resolvedExecutionRoute =
    requestedExecutionRoute === 'auto'
      ? needsApproval
        ? 'flashbots-bundle'
        : 'flashbots-private'
      : requestedExecutionRoute;

  const buildRouteMetadata = (overrides = {}) => ({
    executionRouteRequested: requestedExecutionRoute,
    executionRouteResolved: overrides.executionRouteResolved || resolvedExecutionRoute,
    executionRouteFallback: runtime.executionRouteFallback,
    executionRouteFallbackUsed: Boolean(overrides.executionRouteFallbackUsed),
    executionRouteFallbackReason: overrides.executionRouteFallbackReason || null,
    flashbotsRelayUrl:
      overrides.flashbotsRelayUrl !== undefined
        ? overrides.flashbotsRelayUrl
        : requestedExecutionRoute === 'public'
          ? null
          : runtime.flashbotsRelayUrl,
    flashbotsRelayMethod: overrides.flashbotsRelayMethod || null,
    flashbotsTargetBlockNumber:
      overrides.flashbotsTargetBlockNumber !== undefined ? overrides.flashbotsTargetBlockNumber : null,
    flashbotsRelayResponseId:
      overrides.flashbotsRelayResponseId !== undefined ? overrides.flashbotsRelayResponseId : null,
    flashbotsBundleHash: overrides.flashbotsBundleHash || null,
    flashbotsSimulation: overrides.flashbotsSimulation || null,
  });

  async function simulateApproveRequest(nonceOverride = null) {
    if (!needsApproval) {
      return {
        request: null,
        gasEstimate: null,
        nonce: null,
      };
    }
    let approveSimulation;
    try {
      approveSimulation = await publicClient.simulateContract({
        account,
        address: approvalAsset,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [options.marketAddress, amountRaw],
      });
    } catch (error) {
      await decodeTradeError(error, 'APPROVE_SIMULATION_FAILED', `${isSell ? 'Outcome token' : 'USDC'} approve simulation failed.`, {
        stage: 'approve-simulate',
        approvalAsset,
      });
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

  async function simulateTradeRequest(nonceOverride = null) {
    let tradeSimulation;
    try {
      tradeSimulation = await publicClient.simulateContract({
        account,
        address: options.marketAddress,
        abi: tradeCall.abi,
        functionName: tradeCall.functionName,
        args: tradeCall.args,
      });
    } catch (error) {
      await decodeTradeError(error, 'TRADE_EXECUTION_FAILED', `${isSell ? 'Sell' : 'Buy'} simulation failed.`, {
        stage: isSell ? 'sell-simulate' : 'buy-simulate',
        marketType: tradeCall ? tradeCall.marketType : null,
        tradeSignature: tradeCall ? tradeCall.signature : null,
        ammDeadlineEpoch: tradeCall && tradeCall.ammDeadlineEpoch ? tradeCall.ammDeadlineEpoch : null,
        mode: tradeMode,
      });
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
        ...tradeSimulation.request,
        nonce,
      },
      gasEstimate:
        tradeSimulation && tradeSimulation.request && tradeSimulation.request.gas
          ? tradeSimulation.request.gas.toString()
          : null,
      nonce,
    };
  }

  async function waitForReceiptStatus(hash) {
    if (!hash) return null;
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return receipt && receipt.status ? receipt.status : null;
  }

  function toSubmittedFlashbotsCliError(error, code, message, details = {}) {
    return new CliError(
      error && error.code ? error.code : code,
      error && error.message ? error.message : message,
      {
        requestedRoute: requestedExecutionRoute,
        resolvedRoute: resolvedExecutionRoute,
        executionRouteFallback: runtime.executionRouteFallback,
        submissionState: 'submitted',
        ...details,
        ...(error && error.details ? error.details : {}),
      },
    );
  }

  function buildExecutionPayload(routeMetadata, executionFields = {}) {
    const approveTxHash = executionFields.approveTxHash || null;
    const tradeTxHash = executionFields.tradeTxHash || null;
    const approveStatus = executionFields.approveStatus || null;
    const tradeStatus = executionFields.tradeStatus || null;
    return {
      action: isSell ? 'sell' : 'buy',
      mode: runtime.mode,
      chainId: runtime.chainId,
      rpcUrl: runtime.rpcUrl,
      account: account.address,
      usdc: runtime.usdcAddress,
      approvalAsset,
      marketType: tradeCall.marketType,
      tradeSignature: tradeCall.signature,
      ammDeadlineEpoch: tradeCall.ammDeadlineEpoch,
      amountRaw: amountRaw.toString(),
      minSharesOutRaw: minSharesOutRaw.toString(),
      minAmountOutRaw: minAmountOutRaw.toString(),
      approveTxHash,
      approveTxUrl: toExplorerUrl(approveTxHash),
      approveGasEstimate: executionFields.approveGasEstimate || null,
      approveStatus,
      approveNonce: executionFields.approveNonce ?? null,
      tradeTxHash,
      tradeTxUrl: toExplorerUrl(tradeTxHash),
      tradeGasEstimate: executionFields.tradeGasEstimate || null,
      tradeStatus,
      tradeNonce: executionFields.tradeNonce ?? null,
      status: tradeStatus || 'confirmed',
      ...routeMetadata,
    };
  }

  async function executePublicRoute(routeMetadata) {
    const approveExecution = await simulateApproveRequest();
    let approveTxHash = null;
    let approveStatus = null;
    if (approveExecution.request) {
      try {
        approveTxHash = await walletClient.writeContract(approveExecution.request);
        approveStatus = await waitForReceiptStatus(approveTxHash);
      } catch (error) {
        await decodeTradeError(error, 'APPROVE_EXECUTION_FAILED', `${isSell ? 'Outcome token' : 'USDC'} approve transaction failed.`, {
          stage: 'approve-execute',
          approveTxHash,
          approvalAsset,
        });
      }
    }

    let tradeExecution;
    try {
      tradeExecution = await simulateTradeRequest();
      const tradeTxHash = await walletClient.writeContract(tradeExecution.request);
      const tradeStatus = await waitForReceiptStatus(tradeTxHash);
      return buildExecutionPayload(routeMetadata, {
        approveTxHash,
        approveGasEstimate: approveExecution.gasEstimate,
        approveStatus,
        approveNonce: approveExecution.nonce,
        tradeTxHash,
        tradeGasEstimate: tradeExecution.gasEstimate,
        tradeStatus,
        tradeNonce: tradeExecution.nonce,
      });
    } catch (error) {
      await decodeTradeError(error, 'TRADE_EXECUTION_FAILED', `${isSell ? 'Sell' : 'Buy'} transaction failed.`, {
        stage: isSell ? 'sell' : 'buy',
        tradeTxHash: null,
        marketType: tradeCall ? tradeCall.marketType : null,
        tradeSignature: tradeCall ? tradeCall.signature : null,
        ammDeadlineEpoch: tradeCall && tradeCall.ammDeadlineEpoch ? tradeCall.ammDeadlineEpoch : null,
        mode: tradeMode,
      });
    }
  }

  async function executeFlashbotsPrivateRoute() {
    const pendingNonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: 'pending',
    });
    const approveExecution = await simulateApproveRequest(pendingNonce);
    const tradeExecution = await simulateTradeRequest(
      approveExecution.request ? pendingNonce + 1 : pendingNonce,
    );
    const privateSubmission = await sendFlashbotsPrivateTransaction({
      publicClient,
      walletClient,
      account,
      transactionRequest: tradeExecution.request,
      relayUrl: runtime.flashbotsRelayUrl,
      authPrivateKey: runtime.flashbotsAuthKey,
      targetBlockOffset: runtime.flashbotsTargetBlockOffset,
      viemRuntime,
    });
    let tradeStatus;
    try {
      tradeStatus = await waitForReceiptStatus(privateSubmission.transactionHash);
    } catch (error) {
      throw toSubmittedFlashbotsCliError(
        error,
        'FLASHBOTS_PRIVATE_RECEIPT_FAILED',
        'Flashbots private transaction was submitted, but receipt polling failed.',
        {
          flashbotsRelayUrl: privateSubmission.relayUrl,
          flashbotsRelayMethod: privateSubmission.relayMethod,
          flashbotsTargetBlockNumber: privateSubmission.targetBlockNumber,
          flashbotsRelayResponseId: privateSubmission.relayResponseId,
          transactionHash: privateSubmission.transactionHash,
          tradeTxHash: privateSubmission.transactionHash,
        },
      );
    }
    return buildExecutionPayload(buildRouteMetadata({
      flashbotsRelayUrl: privateSubmission.relayUrl,
      flashbotsRelayMethod: privateSubmission.relayMethod,
      flashbotsTargetBlockNumber: privateSubmission.targetBlockNumber,
      flashbotsRelayResponseId: privateSubmission.relayResponseId,
    }), {
      approveGasEstimate: approveExecution.gasEstimate,
      approveNonce: approveExecution.nonce,
      tradeTxHash: privateSubmission.transactionHash,
      tradeGasEstimate: tradeExecution.gasEstimate,
      tradeStatus,
      tradeNonce: tradeExecution.nonce,
    });
  }

  async function executeFlashbotsBundleRoute() {
    const pendingNonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: 'pending',
    });
    const approveExecution = await simulateApproveRequest(pendingNonce);
    const tradeExecution = await simulateTradeRequest(
      approveExecution.request ? pendingNonce + 1 : pendingNonce,
    );

    const bundleRequests = approveExecution.request
      ? [approveExecution.request, tradeExecution.request]
      : [tradeExecution.request];
    const bundleSubmission = await sendFlashbotsBundle({
      publicClient,
      walletClient,
      account,
      transactionRequests: bundleRequests,
      relayUrl: runtime.flashbotsRelayUrl,
      authPrivateKey: runtime.flashbotsAuthKey,
      targetBlockOffset: runtime.flashbotsTargetBlockOffset,
      viemRuntime,
    });
    const approveTxHash = approveExecution.request ? bundleSubmission.transactionHashes[0] : null;
    const tradeTxHash = approveExecution.request
      ? bundleSubmission.transactionHashes[1]
      : bundleSubmission.transactionHashes[0];
    let approveStatus = null;
    let tradeStatus = null;
    try {
      approveStatus = approveTxHash ? await waitForReceiptStatus(approveTxHash) : null;
      tradeStatus = await waitForReceiptStatus(tradeTxHash);
    } catch (error) {
      throw toSubmittedFlashbotsCliError(
        error,
        'FLASHBOTS_BUNDLE_RECEIPT_FAILED',
        'Flashbots bundle was submitted, but receipt polling failed.',
        {
          flashbotsRelayUrl: bundleSubmission.relayUrl,
          flashbotsRelayMethod: bundleSubmission.relayMethod,
          flashbotsTargetBlockNumber: bundleSubmission.targetBlockNumber,
          flashbotsRelayResponseId: bundleSubmission.relayResponseId,
          flashbotsBundleHash: bundleSubmission.bundleHash,
          flashbotsSimulation: bundleSubmission.simulation,
          transactionHashes: bundleSubmission.transactionHashes,
          approveTxHash,
          tradeTxHash,
        },
      );
    }
    return buildExecutionPayload(buildRouteMetadata({
      flashbotsRelayUrl: bundleSubmission.relayUrl,
      flashbotsRelayMethod: bundleSubmission.relayMethod,
      flashbotsTargetBlockNumber: bundleSubmission.targetBlockNumber,
      flashbotsRelayResponseId: bundleSubmission.relayResponseId,
      flashbotsBundleHash: bundleSubmission.bundleHash,
      flashbotsSimulation: bundleSubmission.simulation,
    }), {
      approveTxHash,
      approveGasEstimate: approveExecution.gasEstimate,
      approveStatus,
      approveNonce: approveExecution.nonce,
      tradeTxHash,
      tradeGasEstimate: tradeExecution.gasEstimate,
      tradeStatus,
      tradeNonce: tradeExecution.nonce,
    });
  }

  return executeTradeWithRoute({
    runtime,
    requestedExecutionRoute,
    needsApproval,
    flashbotsSupportedChainId: FLASHBOTS_SUPPORTED_CHAIN_ID,
    errorFactory: (code, message, details) => new CliError(code, message, details),
    buildRouteMetadata,
    executePublicRoute,
    executeFlashbotsPrivateRoute,
    executeFlashbotsBundleRoute,
  });
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

async function createReadOnlyPublicClient(chainId, rpcUrl, options = {}) {
  const selectedChainId = Number.isInteger(Number(chainId)) ? Number(chainId) : 1;
  const allowDefaultRpc = options && options.allowDefaultRpc !== false;
  const selectedRpcUrl = String(
    rpcUrl || process.env.RPC_URL || (allowDefaultRpc ? DEFAULT_RPC_BY_CHAIN_ID[selectedChainId] : '') || '',
  ).trim();
  if (!isSecureHttpUrlOrLocal(selectedRpcUrl)) return null;
  const { createPublicClient, http } = await loadViemRuntime();
  return createPublicClient({
    chain: {
      id: selectedChainId,
      name: `Chain ${selectedChainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [selectedRpcUrl] }, public: { http: [selectedRpcUrl] } },
    },
    transport: http(selectedRpcUrl),
  });
}

function isLikelyAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ''));
}

async function readOutcomeTokenAddressForSide(publicClient, marketAddress, side) {
  const candidates = String(side || '').toLowerCase() === 'yes'
    ? ['yesToken', 'yesTokenAddress']
    : ['noToken', 'noTokenAddress'];
  for (const functionName of candidates) {
    try {
      const address = await publicClient.readContract({
        address: marketAddress,
        abi: OUTCOME_TOKEN_REF_ABI,
        functionName,
      });
      if (isLikelyAddress(address)) {
        return String(address);
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

async function enrichMarketResolutionState(indexerUrl, marketItem, timeoutMs, publicClient) {
  const pollAddress = String(marketItem && marketItem.pollAddress ? marketItem.pollAddress : '').trim();
  if (!pollAddress) return null;
  let onchain = null;
  if (publicClient) {
    try {
      onchain = await getMarketAdminService().readPollResolutionState(publicClient, pollAddress);
    } catch {
      onchain = null;
    }
  }

  let pollItem = null;
  try {
    const pollQuery = buildGraphqlGetQuery('polls', POLLS_LIST_FIELDS);
    const data = await graphqlRequest(indexerUrl, pollQuery, { id: pollAddress }, timeoutMs);
    pollItem = data && data.polls ? data.polls : null;
  } catch {
    pollItem = null;
  }

  const indexerFinalizationEpoch =
    pollItem && pollItem.deadlineEpoch !== undefined && pollItem.deadlineEpoch !== null
      ? String(pollItem.deadlineEpoch)
      : null;
  const indexerStatus = pollItem && pollItem.status !== undefined && pollItem.status !== null
    ? Number(pollItem.status)
    : null;
  const indexerPollFinalized = Number.isFinite(indexerStatus) ? indexerStatus >= 2 : null;

  const finalizationEpoch =
    (onchain && onchain.finalizationEpoch) || indexerFinalizationEpoch || null;
  const currentEpoch = onchain && onchain.currentEpoch ? onchain.currentEpoch : null;
  const epochsUntilFinalization =
    onchain && onchain.epochsUntilFinalization !== undefined
      ? onchain.epochsUntilFinalization
      : (finalizationEpoch && currentEpoch && BigInt(finalizationEpoch) > BigInt(currentEpoch))
        ? Number(BigInt(finalizationEpoch) - BigInt(currentEpoch))
        : 0;

  return {
    marketState: onchain && onchain.marketState !== undefined ? onchain.marketState : indexerStatus,
    pollFinalized: onchain && onchain.pollFinalized !== null ? onchain.pollFinalized : indexerPollFinalized,
    pollAnswer: onchain ? onchain.pollAnswer : null,
    question: pollItem && pollItem.question ? pollItem.question : null,
    category: pollItem && pollItem.category !== undefined ? pollItem.category : null,
    finalizationEpoch,
    currentEpoch,
    epochsUntilFinalization,
    claimable: onchain ? onchain.claimable : Boolean(indexerPollFinalized && epochsUntilFinalization <= 0),
    operator: onchain ? onchain.operator : null,
  };
}

async function runTradeCommand(args, context) {
  return runTradeCommandFromService(args, context);
}

async function runSellCommand(args, context) {
  return runSellCommandFromService(args, context);
}

async function runMarketsCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);

  const action = shared.rest[0];
  const actionArgs = shared.rest.slice(1);

  if (!action || action === '--help' || action === '-h') {
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'markets.help', commandHelpPayload('pandora [--output table|json] markets list|get|scan|mine|create|hype ...'));
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
            'pandora [--output table|json] markets list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>|--type <type>] [--where-json <json>] [--active|--resolved|--expiring-soon] [--expiring-hours <n>] [--min-tvl <usdc>] [--hedgeable] [--expand] [--with-odds]',
          ),
        );
      } else {
        printMarketsListHelpTable();
      }
      return;
    }

    const options = parseMarketsListFlags(actionArgs);
    let hedgeableDiagnostics = [];
    let { items, pageInfo, unfilteredCount } = await fetchMarketsListPage(indexerUrl, options, shared.timeoutMs);
    if (options.hedgeable) {
      const filtered = await filterHedgeableMarkets({ indexerUrl, timeoutMs: shared.timeoutMs, options, items });
      items = Array.isArray(filtered && filtered.items) ? filtered.items : items;
      if (typeof filtered.unfilteredCount === 'number') {
        unfilteredCount = filtered.unfilteredCount;
      }
      if (Array.isArray(filtered && filtered.diagnostics)) {
        hedgeableDiagnostics = filtered.diagnostics;
      }
    }
    const enrichmentContext =
      options.expand || options.withOdds
        ? await buildMarketsEnrichmentContext(indexerUrl, items, options, shared.timeoutMs)
        : null;
    const payload = buildMarketsListPayload(indexerUrl, options, items, pageInfo, {
      enrichmentContext,
      unfilteredCount,
      externalDiagnostics: hedgeableDiagnostics,
    });
    emitSuccess(context.outputMode, 'markets.list', payload, renderMarketsListTable);
    return;
  }

  if (action === 'scan') {
    await runScanCommand(actionArgs, context);
    return;
  }

  if (action === 'create') {
    await runMarketsCreateCommandFromService(actionArgs, context);
    return;
  }

  if (action === 'hype') {
    await runMarketsHypeCommandFromService(actionArgs, {
      ...context,
      indexerUrl,
      timeoutMs: shared.timeoutMs,
    });
    return;
  }

  if (action === 'mine') {
    if (includesHelpFlag(actionArgs)) {
      const usage =
        'pandora [--output table|json] markets mine [--wallet <address>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--indexer-url <url>] [--timeout-ms <ms>]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'markets.mine.help', commandHelpPayload(usage));
      } else {
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    const options = parseMarketsMineFlagsFromModule(actionArgs);
    if (!options.wallet && !options.privateKey && !options.profileId && !options.profileFile) {
      const envPrivateKey = String(process.env.PANDORA_PRIVATE_KEY || process.env.PRIVATE_KEY || '').trim();
      if (isValidPrivateKey(envPrivateKey)) {
        options.privateKey = envPrivateKey;
      }
    }
    options.indexerUrl = resolveIndexerUrl(shared.indexerUrl || options.indexerUrl || null);
    if (Number.isFinite(shared.timeoutMs)) {
      options.timeoutMs = shared.timeoutMs;
    }

    try {
      const payload = await getMarketsMineService().discoverOwnedMarkets(options, {
        collectPortfolioSnapshot,
        runClaim,
      });
      emitSuccess(context.outputMode, 'markets.mine', payload, renderMarketsMineTable);
    } catch (error) {
      if (error && error.code) {
        throw new CliError(error.code, error.message || 'markets mine failed.', error.details);
      }
      throw error;
    }
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

    const explicitRpcUrl = String(process.env.RPC_URL || '').trim();
    const publicClient = explicitRpcUrl
      ? await createReadOnlyPublicClient(1, explicitRpcUrl, { allowDefaultRpc: false })
      : null;
    const marketMap = await fetchMarketSnapshotMap(indexerUrl, ids, shared.timeoutMs);
    const responses = await Promise.all(
      ids.map(async (id) => {
        const item = marketMap.get(id) || marketMap.get(normalizeLookupKey(id)) || null;
        if (!item) return { id, item: null };
        const resolution = await enrichMarketResolutionState(indexerUrl, item, shared.timeoutMs, publicClient);
        const liquidity = buildMarketLiquidityMetrics(item);
        const enrichedItem = resolution ? { ...item, ...resolution, resolution } : item;
        return { id, item: { ...enrichedItem, liquidity } };
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

  throw new CliError('INVALID_ARGS', 'markets requires a subcommand: list|get|scan|mine|create');
}

const runScanCommand = createLazyFactoryRunner('./lib/scan_command_service.cjs', 'createRunScanCommand', () => ({
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
  filterHedgeableMarkets,
  renderScanTable,
}));

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

    const pagesByType = await Promise.all(
      types.map(async (type) => ({
        type,
        page: await fetchEventsByType(indexerUrl, type, options, shared.timeoutMs),
      })),
    );
    const all = [];
    const pageInfoBySource = {};
    for (const { type, page } of pagesByType) {
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

    const foundByType = await Promise.all(
      types.map((type) => fetchEventByType(indexerUrl, type, options.id, shared.timeoutMs)),
    );
    const found = foundByType.find(Boolean) || null;

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

  const baseFields = ['id', 'chainId', 'marketAddress', 'user', 'lastTradeAt'];
  const extendedFields = [...baseFields, 'yesTokenAmount', 'noTokenAmount', 'yesBalance', 'noBalance'];
  const query = buildGraphqlListQuery('marketUserss', 'marketUsersFilter', extendedFields);
  const variables = {
    where,
    orderBy: 'lastTradeAt',
    orderDirection: 'desc',
    before: null,
    after: null,
    limit: options.limit,
  };
  try {
    const data = await graphqlRequest(indexerUrl, query, variables, timeoutMs);
    return normalizePageResult(data.marketUserss);
  } catch (error) {
    const fallbackQuery = buildGraphqlListQuery('marketUserss', 'marketUsersFilter', baseFields);
    const fallbackData = await graphqlRequest(indexerUrl, fallbackQuery, variables, timeoutMs);
    return normalizePageResult(fallbackData.marketUserss);
  }
}

function pickFiniteNumber(...values) {
  for (const value of values) {
    const numeric = toOptionalNumber(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function isExplicitZeroBalance(value) {
  const numeric = toOptionalNumber(value);
  return Number.isFinite(numeric) && Math.abs(numeric) <= 1e-9;
}

function reconcilePortfolioBalance(...balances) {
  if (balances.some((balance) => isExplicitZeroBalance(balance))) {
    return 0;
  }
  return pickFiniteNumber(...balances);
}

function isResolvedPollStatus(statusRaw) {
  const status = Number(statusRaw);
  return Number.isFinite(status) && status !== 0;
}

function derivePositionSide(yesBalance, noBalance) {
  const hasYes = Number.isFinite(yesBalance) && yesBalance > 0;
  const hasNo = Number.isFinite(noBalance) && noBalance > 0;
  if (hasYes && hasNo) return 'both';
  if (hasYes) return 'yes';
  if (hasNo) return 'no';
  return null;
}

function computeParimutuelPositionMarkValue(yesBalance, noBalance, liquidity) {
  const poolYes = toOptionalNumber(liquidity && liquidity.poolYes);
  const poolNo = toOptionalNumber(liquidity && liquidity.poolNo);
  const totalPool = pickFiniteNumber(
    liquidity && liquidity.totalPool,
    Number.isFinite(poolYes) && Number.isFinite(poolNo) ? poolYes + poolNo : null,
  );
  if (!Number.isFinite(totalPool) || totalPool <= 0) return null;

  let markValueUsdc = 0;
  let hasExposure = false;

  const yesAmount = Number.isFinite(yesBalance) ? yesBalance : 0;
  if (yesAmount > 0 && Number.isFinite(poolYes) && poolYes > 0) {
    markValueUsdc += (yesAmount / poolYes) * totalPool;
    hasExposure = true;
  }

  const noAmount = Number.isFinite(noBalance) ? noBalance : 0;
  if (noAmount > 0 && Number.isFinite(poolNo) && poolNo > 0) {
    markValueUsdc += (noAmount / poolNo) * totalPool;
    hasExposure = true;
  }

  return hasExposure ? round(markValueUsdc, 6) : null;
}

function computePositionMarkValue(yesBalance, noBalance, odds, options = {}) {
  if (normalizePandoraMarketType(options.marketType) === 'parimutuel') {
    const pariMarkValue = computeParimutuelPositionMarkValue(yesBalance, noBalance, options.liquidity);
    if (Number.isFinite(pariMarkValue)) {
      return pariMarkValue;
    }
  }

  const yesProbability = toOptionalNumber(odds && odds.yesProbability);
  const noProbability = toOptionalNumber(odds && odds.noProbability);
  if (!Number.isFinite(yesProbability) || !Number.isFinite(noProbability)) return null;

  const yesAmount = Number.isFinite(yesBalance) ? yesBalance : 0;
  const noAmount = Number.isFinite(noBalance) ? noBalance : 0;
  if (!yesAmount && !noAmount) return null;
  return round(yesAmount * yesProbability + noAmount * noProbability, 6);
}

function parseTokenAmountMaybeRaw(value) {
  const numeric = toOptionalNumber(value);
  if (!Number.isFinite(numeric)) return null;

  const rawText = typeof value === 'string' ? value.trim() : '';
  if (rawText.includes('.')) {
    const [, fractionPart = ''] = rawText.split('.');
    if (
      fractionPart
      && /^0+$/.test(fractionPart)
      && Number.isInteger(numeric)
      && Math.abs(numeric) >= 1_000_000
    ) {
      return round(numeric / 1_000_000, 6);
    }
    return round(numeric, 6);
  }

  if (Number.isInteger(numeric) && Math.abs(numeric) >= 1_000_000) {
    return round(numeric / 1_000_000, 6);
  }
  return round(numeric, 6);
}

function normalizePositionBalanceValue(value, market, liquidity) {
  const normalized = parseTokenAmountMaybeRaw(value);
  if (!Number.isFinite(normalized)) return null;

  const rawText = typeof value === 'string' ? value.trim() : '';
  if (!rawText || rawText.includes('.')) {
    return normalized;
  }

  const marketType = normalizePandoraMarketType(market && market.marketType ? market.marketType : '');
  if (marketType !== 'parimutuel') {
    return normalized;
  }

  const totalPool = pickFiniteNumber(
    liquidity && liquidity.totalPool,
    Number.isFinite(liquidity && liquidity.reserveYes) && Number.isFinite(liquidity && liquidity.reserveNo)
      ? Number(liquidity.reserveYes) + Number(liquidity.reserveNo)
      : null,
    market && market.currentTvl,
  );

  if (Number.isFinite(totalPool) && totalPool > 0 && Math.abs(normalized) > totalPool * 10) {
    return round(normalized / 1_000_000, 6);
  }

  return normalized;
}

async function readPortfolioOnchainBalance(publicClient, walletAddress, marketAddress, formatUnits) {
  const [yesTokenAddress, noTokenAddress] = await Promise.all([
    readOutcomeTokenAddressForSide(publicClient, marketAddress, 'yes'),
    readOutcomeTokenAddressForSide(publicClient, marketAddress, 'no'),
  ]);

  const readSide = async (tokenAddress) => {
    if (!tokenAddress) {
      return {
        tokenAddress: null,
        balance: null,
        balanceRaw: null,
      };
    }

    let decimals = 18;
    try {
      const value = await publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'decimals',
        args: [],
      });
      const numeric = Number(value);
      if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 36) {
        decimals = numeric;
      }
    } catch {
      decimals = 18;
    }

    const balanceRaw = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [walletAddress],
    });

    return {
      tokenAddress,
      balanceRaw: balanceRaw.toString(),
      balance: Number(formatUnits(balanceRaw, decimals)),
    };
  };

  const [yes, no] = await Promise.all([readSide(yesTokenAddress), readSide(noTokenAddress)]);
  return {
    yes,
    no,
  };
}

async function fetchPortfolioOnchainBalanceMap(marketAddresses, options = {}) {
  const balancesByMarket = new Map();
  const diagnostics = [];
  const walletAddress = String(options.wallet || '').trim();
  if (!walletAddress) {
    return { balancesByMarket, diagnostics };
  }

  const publicClient = await createReadOnlyPublicClient(options.chainId, options.rpcUrl);
  if (!publicClient) {
    return { balancesByMarket, diagnostics };
  }

  const { formatUnits } = await loadViemRuntime();
  await Promise.all(
    (Array.isArray(marketAddresses) ? marketAddresses : []).map(async (marketAddress) => {
      if (!marketAddress) return;
      try {
        const entry = await readPortfolioOnchainBalance(publicClient, walletAddress, marketAddress, formatUnits);
        balancesByMarket.set(marketAddress, entry);
        const normalizedKey = normalizeLookupKey(marketAddress);
        if (normalizedKey) {
          balancesByMarket.set(normalizedKey, entry);
        }
      } catch (error) {
        diagnostics.push(
          `On-chain position reconciliation failed for ${marketAddress}: ${error && error.message ? error.message : String(error)}`,
        );
      }
    }),
  );

  return { balancesByMarket, diagnostics };
}

function normalizeTradeSide(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(normalized)) return 'yes';
  if (['no', 'n', 'false', '0'].includes(normalized)) return 'no';
  return null;
}

async function fetchPortfolioTradeBalanceMap(indexerUrl, options, timeoutMs) {
  const where = { trader: options.wallet };
  if (options.chainId !== null) {
    where.chainId = options.chainId;
  }
  const query = buildGraphqlListQuery(
    'tradess',
    'tradesFilter',
    ['id', 'marketAddress', 'side', 'tradeType', 'tokenAmount', 'tokenAmountOut'],
  );
  const variables = {
    where,
    orderBy: 'timestamp',
    orderDirection: 'desc',
    before: null,
    after: null,
    // Keep this bounded: larger values can trigger indexer INTERNAL_SERVER_ERROR.
    limit: Math.min(Math.max((Number(options.limit) || 100) * 5, 100), 500),
  };

  let page;
  try {
    const data = await graphqlRequest(indexerUrl, query, variables, timeoutMs);
    page = normalizePageResult(data.tradess);
  } catch {
    return { balancesByMarket: new Map(), diagnostics: [] };
  }

  const balancesByMarket = new Map();
  for (const trade of page.items || []) {
    const marketKey = normalizeLookupKey(trade && trade.marketAddress);
    if (!marketKey) continue;
    const side = normalizeTradeSide(trade && trade.side);
    if (!side) continue;

    const tradeType = String(trade && trade.tradeType ? trade.tradeType : '').toLowerCase();
    const tokenAmount = parseTokenAmountMaybeRaw(trade && trade.tokenAmount);
    const tokenAmountOut = parseTokenAmountMaybeRaw(trade && trade.tokenAmountOut);

    let delta = null;
    if (
      tradeType.includes('sell') ||
      tradeType.includes('remove') ||
      tradeType.includes('burn') ||
      tradeType.includes('redeem')
    ) {
      delta = tokenAmount !== null ? -tokenAmount : tokenAmountOut !== null ? -tokenAmountOut : null;
    } else {
      delta = tokenAmountOut !== null ? tokenAmountOut : tokenAmount;
    }
    if (!Number.isFinite(delta)) continue;

    const entry = balancesByMarket.get(marketKey) || { yesBalance: 0, noBalance: 0 };
    if (side === 'yes') {
      entry.yesBalance = round(entry.yesBalance + delta, 6);
    } else {
      entry.noBalance = round(entry.noBalance + delta, 6);
    }
    balancesByMarket.set(marketKey, entry);
  }

  const diagnostics = [];
  if (page && page.pageInfo && page.pageInfo.hasNextPage) {
    diagnostics.push('Portfolio token balances use capped trade history; increase --limit for deeper reconstruction.');
  }

  return { balancesByMarket, diagnostics };
}

async function enrichPortfolioPositions(indexerUrl, positions, options, timeoutMs) {
  if (!Array.isArray(positions) || !positions.length) {
    return { items: [], diagnostics: [] };
  }

  const uniqueMarketAddresses = Array.from(
    new Set(
      positions
        .map((item) => normalizeLookupKey(item && item.marketAddress))
        .filter(Boolean),
    ),
  );

  const marketsByAddress = await fetchMarketSnapshotMap(indexerUrl, uniqueMarketAddresses, timeoutMs);

  const marketItems = Array.from(new Set(marketsByAddress.values()));
  let pollsByKey = new Map();
  try {
    const pollDetails = await fetchPollDetailsMap(indexerUrl, marketItems, timeoutMs);
    pollsByKey = pollDetails && pollDetails.pollsByKey ? pollDetails.pollsByKey : new Map();
  } catch {
    pollsByKey = new Map();
  }

  const tradeBalances = await fetchPortfolioTradeBalanceMap(indexerUrl, options, timeoutMs);
  const tradeBalanceByMarket = tradeBalances.balancesByMarket;
  const onchainBalances = await fetchPortfolioOnchainBalanceMap(uniqueMarketAddresses, options);
  const onchainBalanceByMarket = onchainBalances.balancesByMarket;

  const items = positions.map((position) => {
    const marketKey = normalizeLookupKey(position && position.marketAddress);
    const market = marketKey ? marketsByAddress.get(marketKey) : null;
    const liquidity = market ? buildMarketLiquidityMetrics(market) : buildMarketLiquidityMetrics({});
    let odds = market ? computeMarketOdds(market, null) : buildNullOdds(null, 'Market enrichment unavailable.');
    if (
      (!odds || !Number.isFinite(odds.yesProbability)) &&
      Number.isFinite(liquidity && liquidity.yesPrice) &&
      Number.isFinite(liquidity && liquidity.noPrice)
    ) {
      odds = normalizeOddsFromPair(liquidity.yesPrice, liquidity.noPrice, 'liquidity:reserve-metrics');
    }
    const poll = market
      ? firstMappedValue(pollsByKey, [market.pollAddress, market.pollId, market.poll && market.poll.id])
      : null;

    const allowTradeBalanceFallback = !isResolvedPollStatus(poll && poll.status);
    const tradeBalance = allowTradeBalanceFallback && marketKey ? tradeBalanceByMarket.get(marketKey) : null;
    const onchainBalance = marketKey ? onchainBalanceByMarket.get(marketKey) : null;
    const onchainYesBalance =
      onchainBalance && onchainBalance.yes && Number.isFinite(onchainBalance.yes.balance) && onchainBalance.yes.balance >= 0
        ? onchainBalance.yes.balance
        : null;
    const onchainNoBalance =
      onchainBalance && onchainBalance.no && Number.isFinite(onchainBalance.no.balance) && onchainBalance.no.balance >= 0
        ? onchainBalance.no.balance
        : null;
    const tradeYesBalance =
      tradeBalance && Number.isFinite(tradeBalance.yesBalance) && tradeBalance.yesBalance >= 0
        ? tradeBalance.yesBalance
        : null;
    const tradeNoBalance =
      tradeBalance && Number.isFinite(tradeBalance.noBalance) && tradeBalance.noBalance >= 0
        ? tradeBalance.noBalance
        : null;
    const indexedYesBalance = pickFiniteNumber(
      normalizePositionBalanceValue(position && position.yesTokenAmount, market, liquidity),
      normalizePositionBalanceValue(position && position.yesBalance, market, liquidity),
    );
    const indexedNoBalance = pickFiniteNumber(
      normalizePositionBalanceValue(position && position.noTokenAmount, market, liquidity),
      normalizePositionBalanceValue(position && position.noBalance, market, liquidity),
    );
    const yesBalance = reconcilePortfolioBalance(onchainYesBalance, indexedYesBalance, tradeYesBalance);
    const noBalance = reconcilePortfolioBalance(onchainNoBalance, indexedNoBalance, tradeNoBalance);
    const markValueUsdc = computePositionMarkValue(yesBalance, noBalance, odds, {
      marketType: market && market.marketType ? market.marketType : null,
      liquidity,
    });

    return {
      ...position,
      question: poll && poll.question ? poll.question : null,
      marketType: market && market.marketType ? market.marketType : null,
      odds: {
        yesPct: odds && Number.isFinite(odds.yesPct) ? odds.yesPct : null,
        noPct: odds && Number.isFinite(odds.noPct) ? odds.noPct : null,
      },
      liquidity: {
        reserveYes: Number.isFinite(liquidity && liquidity.reserveYes) ? liquidity.reserveYes : null,
        reserveNo: Number.isFinite(liquidity && liquidity.reserveNo) ? liquidity.reserveNo : null,
        deadPool: liquidity && liquidity.deadPool === true,
      },
      yesBalance,
      noBalance,
      positionSide: derivePositionSide(yesBalance, noBalance),
      markValueUsdc,
    };
  });

  const reconciledItems = items.filter((item) => {
    const yesBalance = toOptionalNumber(item && item.yesBalance);
    const noBalance = toOptionalNumber(item && item.noBalance);
    const hasKnownBalance = Number.isFinite(yesBalance) || Number.isFinite(noBalance);
    if (!hasKnownBalance) {
      return true;
    }
    return (Number.isFinite(yesBalance) && yesBalance > 0) || (Number.isFinite(noBalance) && noBalance > 0);
  });

  const diagnostics = [
    ...(Array.isArray(tradeBalances.diagnostics) ? tradeBalances.diagnostics : []),
    ...(Array.isArray(onchainBalances.diagnostics) ? onchainBalances.diagnostics : []),
  ];
  const suppressedCount = items.length - reconciledItems.length;
  if (suppressedCount > 0) {
    diagnostics.push(
      `Suppressed ${suppressedCount} zero-balance portfolio position row${suppressedCount === 1 ? '' : 's'} after balance reconciliation.`,
    );
  }

  return {
    items: reconciledItems,
    diagnostics,
  };
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
  const positionsPagePromise = fetchPortfolioPositions(indexerUrl, options, timeoutMs);
  const eventsPromise = options.includeEvents
    ? Promise.all([
        fetchPortfolioLiquidityEvents(indexerUrl, options, timeoutMs),
        fetchPortfolioClaimEvents(indexerUrl, options, timeoutMs),
      ])
    : Promise.resolve([{ items: [] }, { items: [] }]);
  const lpPayloadPromise = options.withLp
    ? runLpPositions({
        wallet: options.wallet,
        chainId: options.chainId,
        rpcUrl: options.rpcUrl || null,
        indexerUrl,
        timeoutMs,
      })
    : Promise.resolve(null);

  const [positionsPage, [liquidityPage, claimPage], lpPayload] = await Promise.all([
    positionsPagePromise,
    eventsPromise,
    lpPayloadPromise,
  ]);

  const positions = Array.isArray(positionsPage.items) ? positionsPage.items : [];
  const enrichedPositionResult = await enrichPortfolioPositions(indexerUrl, positions, options, timeoutMs);
  const enrichedPositions = Array.isArray(enrichedPositionResult && enrichedPositionResult.items)
    ? enrichedPositionResult.items
    : [];
  const positionDiagnostics = Array.isArray(enrichedPositionResult && enrichedPositionResult.diagnostics)
    ? enrichedPositionResult.diagnostics
    : [];
  const liquidityEvents = Array.isArray(liquidityPage.items) ? liquidityPage.items : [];
  const claimEvents = Array.isArray(claimPage.items) ? claimPage.items : [];
  const lpPositions = Array.isArray(lpPayload && lpPayload.items) ? lpPayload.items : [];
  const lpDiagnostics = Array.isArray(lpPayload && lpPayload.diagnostics) ? lpPayload.diagnostics : [];

  return {
    summary: summarizePortfolio(options, enrichedPositions, liquidityEvents, claimEvents, lpPositions, lpDiagnostics),
    positions: enrichedPositions,
    rawPositions: positions,
    lpPositions,
    events: {
      liquidity: liquidityEvents,
      claims: claimEvents,
    },
    diagnostics: {
      lp: lpDiagnostics,
      positions: positionDiagnostics,
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
  const totalPositionMarkValueUsdc = round(
    positions.reduce((sum, position) => {
      const value = Number(position && position.markValueUsdc);
      return Number.isFinite(value) ? sum + value : sum;
    }, 0),
    6,
  );
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
    totalPositionMarkValueUsdc,
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

const parseTradeFlagsFromModule = createLazyFactoryRunner('./lib/parsers/trade_flags.cjs', 'createParseTradeFlags', () => ({
  ...sharedParserDeps,
  parseBigIntString,
}));
const parseMarketsCreateFlagsFromModule = createLazyFactoryRunner(
  './lib/parsers/markets_create_flags.cjs',
  'createParseMarketsCreateFlags',
  () => ({
    ...sharedParserDeps,
  }),
);
const parseMarketsHypeFlagsFromModule = createLazyFactoryRunner(
  './lib/parsers/markets_hype_flags.cjs',
  'createParseMarketsHypeFlags',
  () => ({
    ...sharedParserDeps,
  }),
);
const parseMarketsMineFlagsFromModule = createLazyFactoryRunner(
  './lib/parsers/markets_mine_flags.cjs',
  'createParseMarketsMineFlags',
  () => ({
    CliError,
    parseAddressFlag,
    requireFlagValue,
    parseInteger,
    isValidPrivateKey,
    isSecureHttpUrlOrLocal,
  }),
);
const parseWatchFlagsFromModule = createLazyFactoryRunner('./lib/parsers/watch_flags.cjs', 'createParseWatchFlags', () => sharedParserDeps);
const parseAutopilotFlagsFromModule = createLazyFactoryRunner('./lib/parsers/autopilot_flags.cjs', 'createParseAutopilotFlags', () => ({
  ...sharedParserDeps,
  defaultAutopilotStateFile,
  defaultAutopilotKillSwitchFile,
}));
const parseMirrorPlanFlagsFromModule = createLazyFactoryRunner('./lib/parsers/mirror_plan_flags.cjs', 'createParseMirrorPlanFlags', () => sharedParserDeps);
const parseMirrorHedgeCalcFlagsFromModule = createLazyFactoryRunner('./lib/parsers/mirror_hedge_calc_flags.cjs', 'createParseMirrorHedgeCalcFlags', () => ({
  ...sharedParserDeps,
  parseCsvNumberList,
}));
const parseMirrorDeployFlagsFromModule = createLazyFactoryRunner('./lib/parsers/mirror_deploy_flags.cjs', 'createParseMirrorDeployFlags', () => sharedParserDeps);
const parseMirrorGoFlagsFromModule = createLazyFactoryRunner('./lib/parsers/mirror_go_flags.cjs', 'createParseMirrorGoFlags', () => ({
  ...sharedParserDeps,
  parseMirrorSyncGateSkipList,
  mergeMirrorSyncGateSkipLists,
}));
const parseMirrorSyncFlagsFromModule = createLazyFactoryRunner('./lib/parsers/mirror_sync_flags.cjs', 'createParseMirrorSyncFlags', () => ({
  ...sharedParserDeps,
  defaultMirrorStateFile,
  defaultMirrorKillSwitchFile,
  parseMirrorSyncGateSkipList,
  mergeMirrorSyncGateSkipLists,
}));
const parseMirrorSyncDaemonSelectorFlagsFromModule = createLazyFactoryRunner(
  './lib/parsers/mirror_sync_flags.cjs',
  'createParseMirrorSyncDaemonSelectorFlags',
  () => ({
    CliError,
    requireFlagValue,
    parseAddressFlag,
  }),
);
const parseMirrorBrowseFlagsFromModule = createLazyFactoryRunner('./lib/parsers/mirror_remaining_flags.cjs', 'createParseMirrorBrowseFlags', () => ({
  ...sharedParserDeps,
  parseDateLikeFlag,
}));
const parseMirrorVerifyFlagsFromModule = createLazyFactoryRunner('./lib/parsers/mirror_remaining_flags.cjs', 'createParseMirrorVerifyFlags', () => sharedParserDeps);
const parseMirrorStatusFlagsFromModule = createLazyFactoryRunner('./lib/parsers/mirror_remaining_flags.cjs', 'createParseMirrorStatusFlags', () => ({
  ...sharedParserDeps,
  defaultIndexerTimeoutMs: DEFAULT_INDEXER_TIMEOUT_MS,
}));
const parseMirrorPnlFlagsFromModule = createLazyFactoryRunner('./lib/parsers/mirror_remaining_flags.cjs', 'createParseMirrorPnlFlags', () => ({
  ...sharedParserDeps,
  defaultIndexerTimeoutMs: DEFAULT_INDEXER_TIMEOUT_MS,
}));
const parseMirrorAuditFlagsFromModule = createLazyFactoryRunner('./lib/parsers/mirror_remaining_flags.cjs', 'createParseMirrorAuditFlags', () => ({
  ...sharedParserDeps,
  defaultIndexerTimeoutMs: DEFAULT_INDEXER_TIMEOUT_MS,
}));
const parseMirrorReplayFlagsFromModule = createLazyFactoryRunner('./lib/parsers/mirror_remaining_flags.cjs', 'createParseMirrorReplayFlags', () => ({
  ...sharedParserDeps,
}));
const parseMirrorTraceFlagsFromModule = createLazyFactoryRunner('./lib/parsers/mirror_remaining_flags.cjs', 'createParseMirrorTraceFlags', () => ({
  ...sharedParserDeps,
}));
const parseMirrorCloseFlagsFromModule = createLazyFactoryRunner('./lib/parsers/mirror_remaining_flags.cjs', 'createParseMirrorCloseFlags', () => sharedParserDeps);
const parseMirrorLpExplainFlagsFromModule = createLazyFactoryRunner('./lib/parsers/mirror_remaining_flags.cjs', 'createParseMirrorLpExplainFlags', () => sharedParserDeps);
const parseMirrorSimulateFlagsFromModule = createLazyFactoryRunner('./lib/parsers/mirror_remaining_flags.cjs', 'createParseMirrorSimulateFlags', () => ({
  ...sharedParserDeps,
  parseCsvNumberList,
}));
const parsePolymarketSharedFlagsFromModule = createLazyFactoryRunner('./lib/parsers/polymarket_flags.cjs', 'createParsePolymarketSharedFlags', () => ({
  CliError,
  requireFlagValue,
  parseAddressFlag,
  parseInteger,
  isValidPrivateKey,
  isSecureHttpUrlOrLocal,
}));
const parsePolymarketApproveFlagsFromModule = createLazyFactoryRunner('./lib/parsers/polymarket_flags.cjs', 'createParsePolymarketApproveFlags', () => ({
  CliError,
  parsePolymarketSharedFlags: parsePolymarketSharedFlagsFromModule,
}));
const parsePolymarketPositionsFlagsFromModule = createLazyFactoryRunner('./lib/parsers/polymarket_flags.cjs', 'createParsePolymarketPositionsFlags', () => ({
  CliError,
  parsePolymarketSharedFlags: parsePolymarketSharedFlagsFromModule,
  requireFlagValue,
  parseAddressFlag,
  parsePositiveInteger,
  isSecureHttpUrlOrLocal,
  defaultTimeoutMs: DEFAULT_INDEXER_TIMEOUT_MS,
}));
const parsePolymarketTradeFlagsFromModule = createLazyFactoryRunner('./lib/parsers/polymarket_flags.cjs', 'createParsePolymarketTradeFlags', () => ({
  CliError,
  parsePolymarketSharedFlags: parsePolymarketSharedFlagsFromModule,
  requireFlagValue,
  parsePositiveNumber,
  parsePositiveInteger,
  isSecureHttpUrlOrLocal,
  defaultTimeoutMs: DEFAULT_INDEXER_TIMEOUT_MS,
}));
const parseResolveFlagsFromModule = createLazyFactoryRunner('./lib/parsers/resolve_flags.cjs', 'createParseResolveFlags', () => ({
  CliError,
  parseAddressFlag,
  requireFlagValue,
  parseInteger,
  parsePositiveInteger,
  isValidPrivateKey,
  isSecureHttpUrlOrLocal,
}));
const parseClaimFlagsFromModule = createLazyFactoryRunner('./lib/parsers/claim_flags.cjs', 'createParseClaimFlags', () => ({
  CliError,
  parseAddressFlag,
  requireFlagValue,
  parseInteger,
  parsePositiveInteger,
  isValidPrivateKey,
  isSecureHttpUrlOrLocal,
}));
const parseLpFlagsFromModule = createLazyFactoryRunner('./lib/parsers/lp_flags.cjs', 'createParseLpFlags', () => ({
  CliError,
  parseAddressFlag,
  requireFlagValue,
  parsePositiveNumber,
  parseInteger,
  parsePositiveInteger,
  isValidPrivateKey,
  isSecureHttpUrlOrLocal,
  defaultTimeoutMs: DEFAULT_INDEXER_TIMEOUT_MS,
}));
const parseLifecycleFlagsFromModule = createLazyFactoryRunner('./lib/parsers/lifecycle_flags.cjs', 'createParseLifecycleFlags', () => ({
  CliError,
  requireFlagValue,
}));
function parseOperationsFlagsFromModule(...args) {
  return getOperationsFlagsModule().parseOperationsFlags(...args);
}
const parseSportsFlagsFromModule = createLazyFactoryRunner('./lib/parsers/sports_flags.cjs', 'createParseSportsFlags', () => ({
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
}));
const parseOddsFlagsFromModule = createLazyFactoryRunner('./lib/parsers/odds_flags.cjs', 'createParseOddsFlags', () => ({
  CliError,
  requireFlagValue,
  parsePositiveInteger,
  parseCsvList,
  isSecureHttpUrlOrLocal,
}));
const parseRiskShowFlagsFromModule = createLazyFactoryRunner('./lib/parsers/risk_flags.cjs', 'createParseRiskShowFlags', () => ({
  CliError,
  requireFlagValue,
}));
const parseRiskPanicFlagsFromModule = createLazyFactoryRunner('./lib/parsers/risk_flags.cjs', 'createParseRiskPanicFlags', () => ({
  CliError,
  requireFlagValue,
}));
const parsePolicyFlagsFromModule = createLazyFactoryRunner('./lib/parsers/policy_flags.cjs', 'createParsePolicyFlags', () => ({
  CliError,
  requireFlagValue,
}));
function parseProfileFlagsFromModule(...args) {
  return getProfileFlagsModule().parseProfileFlags(...args);
}
const parseRecipeFlagsFromModule = createLazyFactoryRunner('./lib/parsers/recipe_flags.cjs', 'createParseRecipeFlags', () => ({
  CliError,
  requireFlagValue,
}));
const parseModelCalibrateFlagsFromModule = createLazyFactoryRunner('./lib/parsers/model_flags.cjs', 'createParseModelCalibrateFlags', () => ({
  CliError,
  requireFlagValue,
  parseNumber,
  parsePositiveNumber,
  parsePositiveInteger,
  parseCsvList,
}));
const parseModelCorrelationFlagsFromModule = createLazyFactoryRunner('./lib/parsers/model_flags.cjs', 'createParseModelCorrelationFlags', () => ({
  CliError,
  requireFlagValue,
  parseNumber,
  parsePositiveNumber,
  parseCsvList,
}));
const parseModelDiagnoseFlagsFromModule = createLazyFactoryRunner('./lib/parsers/model_flags.cjs', 'createParseModelDiagnoseFlags', () => ({
  CliError,
  requireFlagValue,
  parseNumber,
}));
const parseModelScoreBrierFlagsFromModule = createLazyFactoryRunner('./lib/parsers/model_flags.cjs', 'createParseModelScoreBrierFlags', () => ({
  CliError,
  requireFlagValue,
  parsePositiveInteger,
}));
const parseSimulateMcFlagsFromModule = createLazyFactoryRunner('./lib/parsers/simulate_flags.cjs', 'createParseSimulateMcFlags', () => ({
  CliError,
  requireFlagValue,
  parsePositiveInteger,
  parsePositiveNumber,
  parseProbabilityPercent,
  parseNumber,
  parseOutcomeSide,
  parseNonNegativeInteger,
}));
const parseSimulateParticleFilterFlagsFromModule = createLazyFactoryRunner(
  './lib/parsers/simulate_flags.cjs',
  'createParseSimulateParticleFilterFlags',
  () => ({
    CliError,
    requireFlagValue,
    parsePositiveInteger,
    parsePositiveNumber,
    parseProbabilityPercent,
    parseNumber,
    parseNonNegativeInteger,
  }),
);

const runTradeCommandFromService = createLazyFactoryRunner('./lib/trade_command_service.cjs', 'createRunTradeCommand', () => ({
  CliError,
  includesHelpFlag,
  parseIndexerSharedFlags,
  emitSuccess,
  tradeHelpJsonPayload,
  sellHelpJsonPayload,
  quoteHelpJsonPayload,
  printTradeHelpTable,
  printSellHelpTable,
  maybeLoadTradeEnv,
  parseQuoteFlags,
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
  renderQuoteTable,
  renderTradeTable,
}));
const runSellCommandFromService = createLazyFactoryRunner('./lib/trade_command_service.cjs', 'createRunSellCommand', () => ({
  CliError,
  includesHelpFlag,
  parseIndexerSharedFlags,
  emitSuccess,
  tradeHelpJsonPayload,
  sellHelpJsonPayload,
  quoteHelpJsonPayload,
  printTradeHelpTable,
  printSellHelpTable,
  maybeLoadTradeEnv,
  parseQuoteFlags,
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
  renderQuoteTable,
  renderTradeTable,
}));

const runWatchCommandFromService = createLazyFactoryRunner('./lib/watch_command_service.cjs', 'createRunWatchCommand', () => ({
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
  appendForecastRecord,
  defaultForecastFile,
  sleepMs,
  renderWatchTable,
}));

const runPolymarketCommandFromService = createLazyFactoryRunner('./lib/polymarket_command_service.cjs', 'createRunPolymarketCommand', () => ({
  CliError,
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  loadEnvIfPresent,
  parsePolymarketSharedFlags: parsePolymarketSharedFlagsFromModule,
  parsePolymarketApproveFlags: parsePolymarketApproveFlagsFromModule,
  parsePolymarketPositionsFlags: parsePolymarketPositionsFlagsFromModule,
  parsePolymarketTradeFlags: parsePolymarketTradeFlagsFromModule,
  resolveForkRuntime,
  isSecureHttpUrlOrLocal,
  runPolymarketCheck,
  runPolymarketApprove,
  runPolymarketPreflight,
  runPolymarketPositions,
  resolvePolymarketMarket,
  readTradingCredsFromEnv,
  placeHedgeOrder,
  renderPolymarketCheckTable,
  renderPolymarketApproveTable,
  renderPolymarketPreflightTable,
  renderSingleEntityTable,
  assertLiveWriteAllowed,
  defaultEnvFile: DEFAULT_ENV_FILE,
}));
const runDashboardCommandFromService = createLazyFactoryRunner('./lib/dashboard_fund_service.cjs', 'createRunDashboardCommand', () => ({
  CliError,
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  parseIndexerSharedFlags,
  parseAddressFlag,
  requireFlagValue,
  parsePositiveInteger,
  parsePrivateKeyFlag,
  parseInteger,
  maybeLoadIndexerEnv,
  maybeLoadTradeEnv,
  resolveIndexerUrl,
  resolveTrustedDeployPair,
  verifyMirror,
  toMirrorStatusLivePayload,
  runPolymarketBalance,
  discoverOwnedMarkets: (options) => getMarketsMineService().discoverOwnedMarkets(options, {
    collectPortfolioSnapshot,
    runClaim,
  }),
}));
const runFundCheckCommandFromService = createLazyFactoryRunner('./lib/fund_check_command_service.cjs', 'createRunFundCheckCommand', () => ({
  CliError,
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  parseAddressFlag,
  parseIndexerSharedFlags,
  requireFlagValue,
  parsePositiveInteger,
  maybeLoadIndexerEnv,
  maybeLoadTradeEnv,
  resolveIndexerUrl,
  resolveTrustedDeployPair,
  verifyMirror,
  coerceMirrorServiceError,
  toMirrorStatusLivePayload,
  runPolymarketBalance,
  runPolymarketCheck,
  parseAddressFlag,
  parsePrivateKeyFlag,
  parsePositiveInteger,
  parseInteger,
  parseProbabilityPercent,
}));
const runBridgeCommandFromService = createLazyFactoryRunner('./lib/bridge_command_service.cjs', 'createRunBridgeCommand', () => ({
  CliError,
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  parseIndexerSharedFlags,
  maybeLoadTradeEnv,
  runPolymarketBalance,
  assertLiveWriteAllowed,
}));
const runFeesCommandFromService = createLazyFactoryRunner('./lib/fees_command_service.cjs', 'createRunFeesCommand', () => ({
  CliError,
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  parseIndexerSharedFlags,
  maybeLoadIndexerEnv,
  maybeLoadTradeEnv,
  assertLiveWriteAllowed,
}));
const runDebugCommandFromService = createLazyFactoryRunner('./lib/debug_command_service.cjs', 'createRunDebugCommand', () => ({
  CliError,
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  parseIndexerSharedFlags,
  maybeLoadIndexerEnv,
}));

const runResolveCommandFromService = createLazyFactoryRunner('./lib/resolve_command_service.cjs', 'createRunResolveCommand', () => ({
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  parseIndexerSharedFlags,
  maybeLoadTradeEnv,
  parseResolveFlags: parseResolveFlagsFromModule,
  runResolve,
  renderSingleEntityTable,
  CliError,
  assertLiveWriteAllowed,
  decorateOperationPayload,
}));

const runClaimCommandFromService = createLazyFactoryRunner('./lib/claim_command_service.cjs', 'createRunClaimCommand', () => ({
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  parseIndexerSharedFlags,
  maybeLoadTradeEnv,
  parseClaimFlags: parseClaimFlagsFromModule,
  runClaim,
  renderSingleEntityTable,
  CliError,
  assertLiveWriteAllowed,
  decorateOperationPayload,
}));

const runLpCommandFromService = createLazyFactoryRunner('./lib/lp_command_service.cjs', 'createRunLpCommand', () => ({
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  parseIndexerSharedFlags,
  maybeLoadTradeEnv,
  parseLpFlags: parseLpFlagsFromModule,
  runLp,
  renderSingleEntityTable,
  CliError,
  assertLiveWriteAllowed,
  decorateOperationPayload,
}));
const runSportsCommandFromService = createLazyFactoryRunner('./lib/sports_command_service.cjs', 'createRunSportsCommand', () => ({
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
}));
const runMarketsCreateCommandFromService = createLazyFactoryRunner(
  './lib/markets_create_command_service.cjs',
  'createRunMarketsCreateCommand',
  () => ({
    CliError,
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    parseMarketsCreateFlags: parseMarketsCreateFlagsFromModule,
    buildDeploymentArgs,
    deployPandoraMarket,
    renderSingleEntityTable,
    assertLiveWriteAllowed,
  }),
);
const runMarketsHypeCommandFromService = createLazyFactoryRunner(
  './lib/markets_hype_command_service.cjs',
  'createRunMarketsHypeCommand',
  () => ({
    CliError,
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    parseMarketsHypeFlags: parseMarketsHypeFlagsFromModule,
    deployPandoraMarket,
    renderSingleEntityTable,
    assertLiveWriteAllowed,
  }),
);
const runRiskCommandFromService = createLazyFactoryRunner('./lib/risk_command_service.cjs', 'createRunRiskCommand', () => ({
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
}));
const runExplainCommandFromService = createLazyFactoryRunner('./lib/explain_command_service.cjs', 'createRunExplainCommand', () => ({
  CliError,
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  getExplanationForError: errorRecoveryService.getExplanationForError,
}));
const runPolicyCommandFromService = createLazyFactoryRunner('./lib/policy_command_service.cjs', 'createRunPolicyCommand', () => ({
  CliError,
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  parsePolicyFlags: parsePolicyFlagsFromModule,
  createPolicyRegistryService: () => require('./lib/policy_registry_service.cjs').createPolicyRegistryService(),
  createPolicyEvaluatorService: (...args) => require('./lib/policy_evaluator_service.cjs').createPolicyEvaluatorService(...args),
  createPolicyProfileGuidanceService: (...args) => require('./lib/policy_profile_guidance_service.cjs').createPolicyProfileGuidanceService(...args),
  createProfileStore: () => require('./lib/profile_store.cjs').createProfileStore(),
  createProfileResolverService: (...args) => require('./lib/profile_resolver_service.cjs').createProfileResolverService(...args),
}));
const runProfileCommandFromService = createLazyFactoryRunner('./lib/profile_command_service.cjs', 'createRunProfileCommand', () => ({
  CliError,
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  parseProfileFlags: parseProfileFlagsFromModule,
  createProfileStore: () => require('./lib/profile_store.cjs').createProfileStore(),
  createProfileResolverService: (...args) => require('./lib/profile_resolver_service.cjs').createProfileResolverService(...args),
  createPolicyRegistryService: () => require('./lib/policy_registry_service.cjs').createPolicyRegistryService(),
  createPolicyEvaluatorService: (...args) => require('./lib/policy_evaluator_service.cjs').createPolicyEvaluatorService(...args),
  createPolicyProfileGuidanceService: (...args) => require('./lib/policy_profile_guidance_service.cjs').createPolicyProfileGuidanceService(...args),
}));
const runRecipeCommandFromService = createLazyFactoryRunner('./lib/recipe_command_service.cjs', 'createRunRecipeCommand', () => ({
  CliError,
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  parseRecipeFlags: parseRecipeFlagsFromModule,
  createRecipeRegistryService: () => require('./lib/recipe_registry_service.cjs').createRecipeRegistryService(),
  createRecipeRuntimeService: require('./lib/recipe_runtime_service.cjs').createRecipeRuntimeService,
  createCommandExecutorService: () => require('./lib/command_executor_service.cjs').createCommandExecutorService(),
  createPolicyEvaluatorService: () => require('./lib/policy_evaluator_service.cjs').createPolicyEvaluatorService(),
  createProfileResolverService: () => require('./lib/profile_resolver_service.cjs').createProfileResolverService(),
  buildCommandDescriptors: () => require('./lib/agent_contract_registry.cjs').buildCommandDescriptors(),
}));
const runOperationsCommandFromService = createLazyFactoryRunner('./lib/operations_command_service.cjs', 'createRunOperationsCommand', () => ({
  CliError,
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  parseOperationsFlags: parseOperationsFlagsFromModule,
  createOperationService: getOperationService,
}));
const runModelCommandFromService = createLazyFactoryRunner('./lib/model_command_service.cjs', 'createRunModelCommand', () => ({
  CliError,
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  parseModelCalibrateFlags: parseModelCalibrateFlagsFromModule,
  parseModelCorrelationFlags: parseModelCorrelationFlagsFromModule,
  parseModelDiagnoseFlags: parseModelDiagnoseFlagsFromModule,
  parseModelScoreBrierFlags: parseModelScoreBrierFlagsFromModule,
  readForecastRecords,
  defaultForecastFile,
  computeBrierReport,
}));
const runLifecycleCommandFromService = createLazyFactoryRunner('./lib/lifecycle_command_service.cjs', 'createRunLifecycleCommand', () => ({
  CliError,
  includesHelpFlag,
  emitSuccess,
  commandHelpPayload,
  parseLifecycleFlags: parseLifecycleFlagsFromModule,
}));
const runArbCommandFromService = createLazyFactoryRunner('./lib/arb_command_service.cjs', 'createRunArbCommand', () => ({
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
  scanArbitrage,
}));
const runOddsCommandFromService = createLazyFactoryRunner('./lib/odds_command_service.cjs', 'createRunOddsCommand', () => ({
  parseIndexerSharedFlags,
  includesHelpFlag,
  maybeLoadIndexerEnv,
  resolveIndexerUrl,
  parseOddsFlags: parseOddsFlagsFromModule,
  createOddsHistoryService,
  createVenueConnectorFactory,
  sleepMs,
  emitSuccess,
  renderSingleEntityTable,
}));

async function runPortfolioCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  if (shared.rest.includes('--help') || shared.rest.includes('-h')) {
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'portfolio.help', {
        usage:
          'pandora [--output table|json] portfolio --wallet <address> [--chain-id <id>|--all-chains] [--limit <n>] [--include-events|--no-events] [--with-lp] [--rpc-url <url>]',
      });
    } else {
      console.log(
        'Usage: pandora [--output table|json] portfolio --wallet <address> [--chain-id <id>|--all-chains] [--limit <n>] [--include-events|--no-events] [--with-lp] [--rpc-url <url>]',
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
  loadEnvIfPresent(DEFAULT_ENV_FILE);
  return runSportsCommandFromService(args, context);
}

async function runLifecycleCommand(args, context) {
  return runLifecycleCommandFromService(args, context);
}

async function runArbCommand(args, context) {
  return runArbCommandFromService(args, context);
}

async function runOddsCommand(args, context) {
  return runOddsCommandFromService(args, context);
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
  const arbitrageHelpNotes = [
    '`arbitrage` is the backward-compatible one-shot wrapper for cross-venue spreads.',
    'Use `arb scan --output json --iterations 1` for the canonical bounded arbitrage flow.',
    'Use `arb scan --output ndjson` for streaming scans.',
    'Hybrid matching will call a provider adjudicator for borderline pairs when credentials are available.',
  ];
  if (includesHelpFlag(shared.rest)) {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'arbitrage.help',
        commandHelpPayload(
          'pandora [--output table|json] arbitrage [--chain-id <id>] [--venues pandora,polymarket] [--limit <n>] [--min-spread-pct <n>] [--min-liquidity-usdc <n>] [--max-close-diff-hours <n>] [--matcher heuristic|hybrid] [--similarity-threshold <0-1>] [--min-token-score <0-1>] [--ai-provider auto|none|mock|openai|anthropic] [--ai-model <id>] [--ai-threshold <0-1>] [--ai-max-candidates <n>] [--ai-timeout-ms <ms>] [--cross-venue-only|--allow-same-venue] [--with-rules] [--include-similarity] [--question-contains <text>] [--polymarket-host <url>] [--polymarket-mock-url <url>]',
          arbitrageHelpNotes,
        ),
      );
    } else {
      console.log(
        'Usage: pandora [--output table|json] arbitrage [--chain-id <id>] [--venues pandora,polymarket] [--limit <n>] [--min-spread-pct <n>] [--min-liquidity-usdc <n>] [--max-close-diff-hours <n>] [--matcher heuristic|hybrid] [--similarity-threshold <0-1>] [--min-token-score <0-1>] [--ai-provider auto|none|mock|openai|anthropic] [--ai-model <id>] [--ai-threshold <0-1>] [--ai-max-candidates <n>] [--ai-timeout-ms <ms>] [--cross-venue-only|--allow-same-venue] [--with-rules] [--include-similarity] [--question-contains <text>] [--polymarket-host <url>] [--polymarket-mock-url <url>]',
      );
      console.log('');
      console.log('Notes:');
      for (const note of arbitrageHelpNotes) {
        console.log(`- ${note}`);
      }
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

function deriveMirrorStatusLiveStatus(params = {}) {
  if (params.gateOk === false || params.lifecycleActive === false || params.notExpired === false) {
    return 'blocked';
  }
  if (params.expiryWarn || params.driftTriggered || params.hedgeTriggered) {
    return 'attention';
  }
  return 'ok';
}

function buildMirrorStatusDiagnostics(params = {}) {
  const diagnostics = [];
  const {
    gateOk,
    failedChecks,
    driftBps,
    driftTriggerBps,
    hedgeGapUsdc,
    hedgeGapShares,
    hedgeTriggerUsdc,
    hedgeTriggerShares,
    hedgeTriggered,
    rebalanceSide,
    hedgeSide,
    minTimeToExpirySec,
    expiryWarn,
    matchConfidence,
    currentHedgeUsdc,
    currentHedgeShares,
    targetHedgeUsdc,
    targetHedgeShares,
  } = params;

  if (gateOk === false) {
    diagnostics.push({
      code: 'VERIFY_GATES_FAILED',
      severity: 'error',
      message: 'Mirror verification gates failed.',
      action: 'inspect-verify-gates',
      details: {
        failedChecks: Array.isArray(failedChecks) ? failedChecks : [],
      },
    });
  }

  if (Number.isFinite(driftBps) && Number.isFinite(driftTriggerBps) && driftBps >= driftTriggerBps) {
    diagnostics.push({
      code: 'DRIFT_TRIGGERED',
      severity: driftBps >= driftTriggerBps * 2 ? 'error' : 'warn',
      message: `Cross-venue drift ${driftBps}bps exceeds trigger ${driftTriggerBps}bps.`,
      action: rebalanceSide ? `rebalance-${rebalanceSide}` : 'rebalance',
      details: {
        driftBps,
        driftTriggerBps,
        rebalanceSide: rebalanceSide || null,
      },
    });
  }

  if (hedgeTriggered && Number.isFinite(Math.abs(Number(hedgeGapUsdc)))) {
    diagnostics.push({
      code: 'HEDGE_GAP_TRIGGERED',
      severity: Math.abs(hedgeGapUsdc) >= hedgeTriggerUsdc * 2 ? 'error' : 'warn',
      message: `Tracked hedge gap ${Math.abs(hedgeGapShares !== undefined ? hedgeGapShares : hedgeGapUsdc)} shares exceeds trigger ${hedgeTriggerShares !== undefined ? hedgeTriggerShares : hedgeTriggerUsdc} shares.`,
      action: hedgeSide ? `hedge-${hedgeSide}` : 'hedge',
      details: {
        hedgeGapUsdc,
        hedgeGapShares: hedgeGapShares !== undefined ? hedgeGapShares : hedgeGapUsdc,
        currentHedgeUsdc,
        currentHedgeShares: currentHedgeShares !== undefined ? currentHedgeShares : currentHedgeUsdc,
        targetHedgeUsdc,
        targetHedgeShares: targetHedgeShares !== undefined ? targetHedgeShares : targetHedgeUsdc,
        hedgeTriggerUsdc,
        hedgeTriggerShares: hedgeTriggerShares !== undefined ? hedgeTriggerShares : hedgeTriggerUsdc,
        hedgeSide: hedgeSide || null,
      },
    });
  }

  if (expiryWarn) {
    diagnostics.push({
      code: 'EXPIRY_NEAR',
      severity: 'warn',
      message: `Mirror pair expiry is near (${minTimeToExpirySec}s remaining on the tighter venue).`,
      action: 'tighten-monitoring',
      details: {
        minTimeToExpirySec,
      },
    });
  }

  if (matchConfidence !== null && matchConfidence < 0.97) {
    diagnostics.push({
      code: 'MATCH_CONFIDENCE_SOFT_WARN',
      severity: 'info',
      message: `Question similarity confidence is ${matchConfidence}.`,
      action: 'spot-check-market-match',
      details: {
        matchConfidence,
      },
    });
  }

  if (!diagnostics.length) {
    diagnostics.push({
      code: 'MONITOR_ONLY',
      severity: 'info',
      message: 'No rebalance or hedge action is currently implied by status thresholds.',
      action: 'monitor',
      details: {},
    });
  }

  return diagnostics;
}

function buildMirrorStatusActionability(params = {}) {
  const diagnostics = buildMirrorStatusDiagnostics(params);
  const primary = diagnostics[0];
  const blocked = diagnostics.some((item) => item.severity === 'error' && item.code === 'VERIFY_GATES_FAILED');
  const hasTradeAction = diagnostics.some((item) => item.code === 'DRIFT_TRIGGERED' || item.code === 'HEDGE_GAP_TRIGGERED');
  return {
    status: blocked ? 'blocked' : hasTradeAction ? 'action-needed' : params.expiryWarn ? 'attention' : 'monitor',
    urgency: blocked ? 'high' : hasTradeAction ? 'medium' : params.expiryWarn ? 'medium' : 'low',
    recommendedAction: primary && primary.action ? primary.action : 'monitor',
    diagnostics,
  };
}

function buildMirrorStatusPnlScenarios(params = {}) {
  const {
    reserveYesUsdc,
    reserveNoUsdc,
    sourceYesPct,
    cumulativeLpFeesApproxUsdc,
    cumulativeHedgeCostApproxUsdc,
    netPnlApproxUsdc,
    positionSummary,
    pnlApprox,
  } = params;
  const feeScenarioPayload =
    Number.isFinite(reserveYesUsdc) && Number.isFinite(reserveNoUsdc)
      ? buildMirrorHedgeCalc({
          reserveYesUsdc,
          reserveNoUsdc,
          polymarketYesPct: sourceYesPct,
          hedgeRatio: 1,
        })
      : null;

  const estimatedValueUsd = Number.isFinite(Number(positionSummary && positionSummary.estimatedValueUsd))
    ? Number(positionSummary.estimatedValueUsd)
    : null;
  const yesBalance = Number.isFinite(Number(positionSummary && positionSummary.yesBalance))
    ? Number(positionSummary.yesBalance)
    : null;
  const noBalance = Number.isFinite(Number(positionSummary && positionSummary.noBalance))
    ? Number(positionSummary.noBalance)
    : null;

  const buildResolutionRow = (label, payoutValueUsd) => ({
    outcome: label,
    hedgeInventoryPayoutUsd: payoutValueUsd,
    markToMarketMoveUsd:
      estimatedValueUsd !== null && payoutValueUsd !== null
        ? round(payoutValueUsd - estimatedValueUsd, 6)
        : null,
    feesPlusInventoryPnlApproxUsdc:
      Number.isFinite(netPnlApproxUsdc) && payoutValueUsd !== null
        ? round(netPnlApproxUsdc + payoutValueUsd, 6)
        : null,
  });

  return {
    baseline: {
      scope: 'fees-plus-marked-polymarket-inventory',
      cumulativeLpFeesApproxUsdc,
      cumulativeHedgeCostApproxUsdc,
      netPnlApproxUsdc,
      markedPolymarketInventoryUsd: estimatedValueUsd,
      openOrdersNotionalUsd:
        Number.isFinite(Number(positionSummary && positionSummary.openOrdersNotionalUsd))
          ? Number(positionSummary.openOrdersNotionalUsd)
          : null,
      markToMarketPnlApproxUsdc: Number.isFinite(pnlApprox) ? pnlApprox : netPnlApproxUsdc,
    },
    feeVolumeScenarios:
      feeScenarioPayload && Array.isArray(feeScenarioPayload.scenarios)
        ? feeScenarioPayload.scenarios
        : [],
    resolutionScenarios: {
      scope: 'fees-plus-polymarket-token-payout-only',
      yes: buildResolutionRow('yes', yesBalance),
      no: buildResolutionRow('no', noBalance),
    },
  };
}

async function toMirrorStatusLivePayload(verifyPayload, state, options) {
  const pandoraYesPct = verifyPayload && verifyPayload.pandora ? Number(verifyPayload.pandora.yesPct) : null;
  const sourceYesPct = verifyPayload && verifyPayload.sourceMarket ? Number(verifyPayload.sourceMarket.yesPct) : null;
  const pandoraNoPct = Number.isFinite(pandoraYesPct) ? round(100 - pandoraYesPct, 6) : null;
  const sourceNoPct =
    verifyPayload && verifyPayload.sourceMarket && Number.isFinite(Number(verifyPayload.sourceMarket.noPct))
      ? Number(verifyPayload.sourceMarket.noPct)
      : Number.isFinite(sourceYesPct)
        ? round(100 - sourceYesPct, 6)
        : null;
  const driftBps =
    Number.isFinite(sourceYesPct) && Number.isFinite(pandoraYesPct)
      ? Math.round(Math.abs(sourceYesPct - pandoraYesPct) * 10000) / 100
      : null;
  const reserveYesUsdc = verifyPayload && verifyPayload.pandora ? Number(verifyPayload.pandora.reserveYes) : null;
  const reserveNoUsdc = verifyPayload && verifyPayload.pandora ? Number(verifyPayload.pandora.reserveNo) : null;
  const reserveTotalUsdc =
    Number.isFinite(reserveYesUsdc) && Number.isFinite(reserveNoUsdc)
      ? round(reserveYesUsdc + reserveNoUsdc, 6)
      : null;
  const deltaLpUsdc =
    Number.isFinite(reserveYesUsdc) && Number.isFinite(reserveNoUsdc)
      ? Math.round((reserveYesUsdc - reserveNoUsdc) * 1e6) / 1e6
      : null;
  const targetHedgeUsdc = deltaLpUsdc === null ? null : Math.round((-deltaLpUsdc) * 1e6) / 1e6;
  const currentHedgeShares =
    Number.isFinite(Number(state.currentHedgeShares))
      ? Number(state.currentHedgeShares)
      : Number.isFinite(Number(state.currentHedgeUsdc))
        ? Number(state.currentHedgeUsdc)
        : 0;
  const currentHedgeUsdc = currentHedgeShares;
  const targetHedgeShares = targetHedgeUsdc;
  const hedgeGapUsdc = targetHedgeUsdc === null ? null : Math.round((targetHedgeUsdc - currentHedgeUsdc) * 1e6) / 1e6;
  const hedgeGapShares = hedgeGapUsdc;
  const hedgeGapAbsUsdc = hedgeGapUsdc === null ? null : round(Math.abs(hedgeGapUsdc), 6);
  const hedgeGapAbsShares = hedgeGapAbsUsdc;
  const rebalanceSide =
    Number.isFinite(sourceYesPct) && Number.isFinite(pandoraYesPct)
      ? sourceYesPct > pandoraYesPct
        ? 'yes'
        : 'no'
      : null;
  const hedgeSide = hedgeGapUsdc === null ? null : hedgeGapUsdc > 0 ? 'yes' : hedgeGapUsdc < 0 ? 'no' : null;
  const hedgeCoverageRatio =
    Number.isFinite(targetHedgeUsdc) && Math.abs(targetHedgeUsdc) > 0
      ? round(currentHedgeUsdc / targetHedgeUsdc, 6)
      : null;

  const gateChecks = verifyPayload && verifyPayload.gateResult && Array.isArray(verifyPayload.gateResult.checks)
    ? verifyPayload.gateResult.checks
    : [];
  const lifecycleCheck = gateChecks.find((item) => item.code === 'LIFECYCLE_ACTIVE');
  const notExpiredCheck = gateChecks.find((item) => item.code === 'NOT_EXPIRED');
  const closeTimeCheck = gateChecks.find((item) => item.code === 'CLOSE_TIME_DELTA');

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
  const mergeReadiness = buildPolymarketMergeReadiness(positionSummary, {
    ownerAddress:
      positionSummary && typeof positionSummary.walletAddress === 'string' && positionSummary.walletAddress.trim()
        ? positionSummary.walletAddress
        : null,
    signerAddress: null,
    funderAddress:
      typeof process.env.POLYMARKET_FUNDER === 'string' && process.env.POLYMARKET_FUNDER.trim()
        ? process.env.POLYMARKET_FUNDER
        : null,
  });
  const balanceScope = buildPolymarketBalanceScope({
    requestedWallet:
      positionSummary && typeof positionSummary.walletAddress === 'string' && positionSummary.walletAddress.trim()
        ? positionSummary.walletAddress
        : null,
    ownerAddress:
      positionSummary && typeof positionSummary.walletAddress === 'string' && positionSummary.walletAddress.trim()
        ? positionSummary.walletAddress
        : null,
    signerAddress: null,
    funderAddress:
      typeof process.env.POLYMARKET_FUNDER === 'string' && process.env.POLYMARKET_FUNDER.trim()
        ? process.env.POLYMARKET_FUNDER
        : null,
  });
  const polymarketDiagnostics = Array.from(
    new Set(
      []
        .concat(Array.isArray(positionSummary.diagnostics) ? positionSummary.diagnostics : [])
        .concat(Array.isArray(mergeReadiness && mergeReadiness.diagnostics) ? mergeReadiness.diagnostics : [])
        .filter(Boolean),
    ),
  );

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
  const closeTimeDeltaSec =
    closeTimeCheck && closeTimeCheck.meta && Number.isFinite(Number(closeTimeCheck.meta.closeDeltaSeconds))
      ? Number(closeTimeCheck.meta.closeDeltaSeconds)
      : null;
  const gateOk = Boolean(verifyPayload && verifyPayload.gateResult && verifyPayload.gateResult.ok);
  const failedChecks =
    verifyPayload && verifyPayload.gateResult && Array.isArray(verifyPayload.gateResult.failedChecks)
      ? verifyPayload.gateResult.failedChecks
      : [];
  const ruleHashMatch =
    verifyPayload && verifyPayload.ruleHashLeft && verifyPayload.ruleHashRight
      ? verifyPayload.ruleHashLeft === verifyPayload.ruleHashRight
      : null;
  const driftTriggered = driftBps !== null ? driftBps >= options.driftTriggerBps : false;
  const hedgeTriggered = hedgeGapUsdc !== null ? Math.abs(hedgeGapUsdc) >= options.hedgeTriggerUsdc : false;
  const expiryWarn = Boolean(verifyPayload && verifyPayload.expiry && verifyPayload.expiry.warn);
  const crossVenueStatus = deriveMirrorStatusLiveStatus({
    gateOk,
    lifecycleActive: lifecycleCheck ? Boolean(lifecycleCheck.ok) : null,
    notExpired: notExpiredCheck ? Boolean(notExpiredCheck.ok) : null,
    expiryWarn,
    driftTriggered,
    hedgeTriggered,
  });
  const actionability = buildMirrorStatusActionability({
    gateOk,
    failedChecks,
    driftBps,
    driftTriggerBps: options.driftTriggerBps,
    hedgeGapUsdc,
    hedgeGapShares,
    hedgeTriggerUsdc: options.hedgeTriggerUsdc,
    hedgeTriggerShares: options.hedgeTriggerUsdc,
    hedgeTriggered,
    rebalanceSide,
    hedgeSide,
    minTimeToExpirySec,
    expiryWarn,
    matchConfidence: verifyPayload && Number.isFinite(Number(verifyPayload.matchConfidence))
      ? Number(verifyPayload.matchConfidence)
      : null,
    currentHedgeUsdc,
    currentHedgeShares,
    targetHedgeUsdc,
    targetHedgeShares,
  });
  const pnlScenarios = buildMirrorStatusPnlScenarios({
    reserveYesUsdc,
    reserveNoUsdc,
    sourceYesPct,
    cumulativeLpFeesApproxUsdc,
    cumulativeHedgeCostApproxUsdc,
    netPnlApproxUsdc,
    positionSummary,
    pnlApprox,
  });

  return {
    generatedAt: new Date().toISOString(),
    pandoraYesPct: Number.isFinite(pandoraYesPct) ? pandoraYesPct : null,
    sourceYesPct: Number.isFinite(sourceYesPct) ? sourceYesPct : null,
    driftBps,
    driftTriggerBps: options.driftTriggerBps,
    driftTriggered,
    reserveYesUsdc: Number.isFinite(reserveYesUsdc) ? reserveYesUsdc : null,
    reserveNoUsdc: Number.isFinite(reserveNoUsdc) ? reserveNoUsdc : null,
    reserveTotalUsdc,
    deltaLpUsdc,
    targetHedgeUsdc,
    targetHedgeShares,
    hedgeUnit: 'shares',
    inventoryUnit: 'shares',
    legacyHedgeUnitAlias: 'currentHedgeUsdc/targetHedgeUsdc are compatibility aliases for share-denominated hedge inventory.',
    currentHedgeUsdc,
    currentHedgeShares,
    hedgeGapUsdc,
    hedgeGapShares,
    hedgeGapAbsUsdc,
    hedgeGapAbsShares,
    hedgeTriggerUsdc: options.hedgeTriggerUsdc,
    hedgeTriggerShares: options.hedgeTriggerUsdc,
    hedgeTriggered,
    hedgeCoverageRatio,
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
      openOrdersNotionalUsd: Number.isFinite(Number(positionSummary.openOrdersNotionalUsd))
        ? Number(positionSummary.openOrdersNotionalUsd)
        : null,
      estimatedValueUsd: Number.isFinite(Number(positionSummary.estimatedValueUsd))
        ? Number(positionSummary.estimatedValueUsd)
        : null,
      positionDeltaApprox: Number.isFinite(Number(positionSummary.positionDeltaApprox))
        ? Number(positionSummary.positionDeltaApprox)
        : null,
      prices:
        positionSummary && positionSummary.prices && typeof positionSummary.prices === 'object'
          ? {
              yes: Number.isFinite(Number(positionSummary.prices.yes)) ? Number(positionSummary.prices.yes) : null,
              no: Number.isFinite(Number(positionSummary.prices.no)) ? Number(positionSummary.prices.no) : null,
            }
          : { yes: null, no: null },
      balanceScope,
      mergeReadiness,
      diagnostics: polymarketDiagnostics,
    },
    crossVenue: {
      status: crossVenueStatus,
      gateOk,
      failedChecks,
      matchConfidence: Number.isFinite(Number(verifyPayload && verifyPayload.matchConfidence))
        ? Number(verifyPayload.matchConfidence)
        : null,
      ruleHashMatch,
      closeTimeDeltaSec,
      expiryWarn,
      sourceType:
        verifyPayload && verifyPayload.sourceMarket && verifyPayload.sourceMarket.source
          ? String(verifyPayload.sourceMarket.source)
          : null,
      pandora: {
        active: verifyPayload && verifyPayload.pandora ? Boolean(verifyPayload.pandora.active) : null,
        resolved: verifyPayload && verifyPayload.pandora ? Boolean(verifyPayload.pandora.resolved) : null,
        yesPct: Number.isFinite(pandoraYesPct) ? pandoraYesPct : null,
        noPct: pandoraNoPct,
        reserveTotalUsdc,
      },
      source: {
        active: verifyPayload && verifyPayload.sourceMarket ? Boolean(verifyPayload.sourceMarket.active) : null,
        resolved: verifyPayload && verifyPayload.sourceMarket ? Boolean(verifyPayload.sourceMarket.resolved) : null,
        yesPct: Number.isFinite(sourceYesPct) ? sourceYesPct : null,
        noPct: sourceNoPct,
      },
    },
    hedgeStatus: {
      rebalanceSide,
      hedgeSide,
      targetHedgeUsdc,
      targetHedgeShares,
      currentHedgeUsdc,
      currentHedgeShares,
      hedgeGapUsdc,
      hedgeGapShares,
      hedgeGapAbsUsdc,
      hedgeGapAbsShares,
      hedgeCoverageRatio,
      triggerUsdc: options.hedgeTriggerUsdc,
      triggerShares: options.hedgeTriggerUsdc,
      triggered: hedgeTriggered,
      unit: 'shares',
    },
    actionability,
    actionableDiagnostics: actionability.diagnostics,
    pnlScenarios,
    gateResult: verifyPayload.gateResult,
    matchConfidence: verifyPayload.matchConfidence,
    verifyDiagnostics: verifyPayload.diagnostics || [],
    sourceMarket: {
      marketId: verifyPayload.sourceMarket && verifyPayload.sourceMarket.marketId ? verifyPayload.sourceMarket.marketId : null,
      slug: verifyPayload.sourceMarket && verifyPayload.sourceMarket.slug ? verifyPayload.sourceMarket.slug : null,
      question: verifyPayload.sourceMarket && verifyPayload.sourceMarket.question ? verifyPayload.sourceMarket.question : null,
      source: verifyPayload.sourceMarket && verifyPayload.sourceMarket.source ? verifyPayload.sourceMarket.source : null,
      active: verifyPayload.sourceMarket ? Boolean(verifyPayload.sourceMarket.active) : null,
      resolved: verifyPayload.sourceMarket ? Boolean(verifyPayload.sourceMarket.resolved) : null,
      yesPct: Number.isFinite(sourceYesPct) ? sourceYesPct : null,
      noPct: sourceNoPct,
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
      yesPct: Number.isFinite(pandoraYesPct) ? pandoraYesPct : null,
      noPct: pandoraNoPct,
      reserveYesUsdc: Number.isFinite(reserveYesUsdc) ? reserveYesUsdc : null,
      reserveNoUsdc: Number.isFinite(reserveNoUsdc) ? reserveNoUsdc : null,
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
  const error = snapshot.error && typeof snapshot.error === 'object' ? snapshot.error : null;
  const actionStatus = action && action.status ? action.status : 'idle';
  const gateCode =
    action && Array.isArray(action.failedChecks) && action.failedChecks.length
      ? action.forcedGateBypass
        ? `forced:${action.failedChecks[0]}`
        : action.failedChecks[0]
      : '';
  const verbose = Boolean(tickContext.verbose);

  if (outputMode === 'json') {
    console.log(
      JSON.stringify({
        event: 'mirror.sync.tick',
        timestamp: tickContext.timestamp,
        tick: tickContext.iteration,
        driftBps: metrics.driftBps,
        plannedRebalanceUsdc: metrics.plannedRebalanceUsdc,
        plannedHedgeUsdc: metrics.plannedHedgeUsdc,
        plannedHedgeShares: metrics.plannedHedgeShares,
        plannedHedgeOrderUsd: metrics.plannedHedgeOrderUsd,
        reserveSource: metrics.reserveSource || null,
        hedgeScope: metrics.hedgeScope || null,
        gateOk: strictGate.ok,
        gateCode,
        actionStatus,
        errorCode: error && error.code ? error.code : null,
        errorMessage: error && error.message ? error.message : null,
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
  if (verbose || error) {
    const reserveYes = metrics.reserveYesUsdc === null || metrics.reserveYesUsdc === undefined ? 'n/a' : metrics.reserveYesUsdc;
    const reserveNo = metrics.reserveNoUsdc === null || metrics.reserveNoUsdc === undefined ? 'n/a' : metrics.reserveNoUsdc;
    const pandoraYes = metrics.pandoraYesPct === null || metrics.pandoraYesPct === undefined ? 'n/a' : metrics.pandoraYesPct;
    const sourceYes = metrics.sourceYesPct === null || metrics.sourceYesPct === undefined ? 'n/a' : metrics.sourceYesPct;
    const hedgeShares = metrics.plannedHedgeShares === null || metrics.plannedHedgeShares === undefined ? '0' : metrics.plannedHedgeShares;
    const hedgeOrderUsd = metrics.plannedHedgeOrderUsd === null || metrics.plannedHedgeOrderUsd === undefined ? '0' : metrics.plannedHedgeOrderUsd;
    const recycleReason =
      snapshot.actionPlan && snapshot.actionPlan.hedgeRecycleReason
        ? snapshot.actionPlan.hedgeRecycleReason
        : null;
    console.log(
      `  reserve=${metrics.reserveSource || 'n/a'} yes=${reserveYes} no=${reserveNo} pandoraYes=${pandoraYes}% sourceYes=${sourceYes}% hedgeShares=${hedgeShares} hedgeOrderUsd=${hedgeOrderUsd} scope=${metrics.hedgeScope || 'n/a'}${recycleReason ? ` recycle=${recycleReason}` : ''}`,
    );
  }
  if (error) {
    console.log(`  error=${error.code || 'MIRROR_SYNC_TICK_FAILED'} ${error.message || 'Mirror sync tick failed.'}`);
  }
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
  const preflightRpcUrl =
    options.polymarketRpcUrl || process.env.POLYMARKET_RPC_URL || options.rpcUrl || null;
  if (preflightRpcUrl) preflightOptions.rpcUrl = preflightRpcUrl;
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

function traceMirrorReserves(options = {}) {
  return require('./lib/mirror_sync/reserve_source.cjs').readPandoraOnchainReserveTrace({
    ...options,
    marketAddress: options.marketAddress || options.pandoraMarketAddress || null,
  });
}

const runMirrorCommand = createLazyFactoryRunner('./lib/mirror_command_service.cjs', 'createRunMirrorCommand', () => ({
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
  parseMirrorPnlFlags: parseMirrorPnlFlagsFromModule,
  parseMirrorAuditFlags: parseMirrorAuditFlagsFromModule,
  parseMirrorReplayFlags: parseMirrorReplayFlagsFromModule,
  parseMirrorTraceFlags: parseMirrorTraceFlagsFromModule,
  parseMirrorSyncFlags: parseMirrorSyncFlagsFromModule,
  parseMirrorSyncDaemonSelectorFlags: parseMirrorSyncDaemonSelectorFlagsFromModule,
  parseMirrorGoFlags: parseMirrorGoFlagsFromModule,
  parseMirrorCloseFlags: parseMirrorCloseFlagsFromModule,
  parseMirrorLpExplainFlags: parseMirrorLpExplainFlagsFromModule,
  parseMirrorHedgeCalcFlags: parseMirrorHedgeCalcFlagsFromModule,
  parseMirrorSimulateFlags: parseMirrorSimulateFlagsFromModule,
  parseProbabilityPercent,
  buildMirrorPlan,
  deployMirror,
  verifyMirror,
  browseMirrorMarkets,
  buildMirrorLpExplain,
  buildMirrorHedgeCalc,
  buildMirrorSimulate,
  buildMirrorRuntimeTelemetry,
  runMirrorSync,
  startMirrorDaemon,
  stopMirrorDaemon,
  mirrorDaemonStatus,
  defaultMirrorKillSwitchFile,
  runMirrorClose,
  runResolve,
  runLp,
  runClaim,
  decorateOperationPayload,
  resolveTrustedDeployPair,
  findMirrorPair,
  defaultMirrorManifestFile,
  hasContractCodeAtAddress,
  toMirrorStatusLivePayload,
  coerceMirrorServiceError,
  runLivePolymarketPreflightForMirror,
  traceMirrorReserves,
  buildMirrorSyncStrategy,
  mirrorStrategyHash,
  buildMirrorSyncDaemonCliArgs,
  buildQuotePayload,
  enforceTradeRiskGuards,
  executeTradeOnchain,
  assertLiveWriteAllowed,
  setRiskPanic,
  clearRiskPanic,
  hasWebhookTargets,
  sendWebhookNotifications,
  loadMirrorState,
  resolveMirrorSurfaceState,
  resolveMirrorSurfaceDaemonStatus,
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
  deriveWalletAddressFromPrivateKey,
  renderMirrorSyncDaemonTable,
  renderMirrorStatusTable,
  renderMirrorCloseTable,
  requireFlagValue,
  parseAddressFlag,
  parsePositiveInteger,
  cliPath: __filename,
}));


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
    [history, arbitrage] = await Promise.all([
      fetchHistory({
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
      }),
      scanArbitrage({
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
      }),
    ]);
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

async function runDashboardCommand(args, context) {
  return runDashboardCommandFromService(args, context);
}

async function runFundCheckCommand(args, context) {
  return runFundCheckCommandFromService(args, context);
}

async function runBridgeCommand(args, context) {
  return runBridgeCommandFromService(args, context);
}

async function runFeesCommand(args, context) {
  return runFeesCommandFromService(args, context);
}

async function runDebugCommand(args, context) {
  return runDebugCommandFromService(args, context);
}

async function runResolveCommand(args, context) {
  return runResolveCommandFromService(args, context);
}

async function runClaimCommand(args, context) {
  return runClaimCommandFromService(args, context);
}

async function runLpCommand(args, context) {
  return runLpCommandFromService(args, context);
}

async function runRiskCommand(args, context) {
  return runRiskCommandFromService(args, context);
}

async function runExplainCommand(args, context) {
  return runExplainCommandFromService(args, context);
}

async function runPolicyCommand(args, context) {
  return runPolicyCommandFromService(args, context);
}

async function runProfileCommand(args, context) {
  return runProfileCommandFromService(args, context);
}

async function runRecipeCommand(args, context) {
  return runRecipeCommandFromService(args, context);
}

async function runOperationsCommand(args, context) {
  return runOperationsCommandFromService(args, context);
}

async function runModelCommand(args, context) {
  return runModelCommandFromService(args, context);
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
  runDashboardCommand,
  runFundCheckCommand,
  runBridgeCommand,
  runFeesCommand,
  runDebugCommand,
  runMarketsCommand,
  runScanCommand,
  runSportsCommand,
  runLifecycleCommand,
  runArbCommand,
  runOddsCommand,
  runQuoteCommand,
  runTradeCommand,
  runSellCommand,
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
  runAgentCommand,
  runSuggestCommand,
  runResolveCommand,
  runClaimCommand,
  runLpCommand,
  runPolicyCommand,
  runProfileCommand,
  runRecipeCommand,
  runRiskCommand,
  runExplainCommand,
  runOperationsCommand,
  runModelCommand,
  runMcpCommand,
  runStreamCommand,
  runSimulateCommand,
  runBootstrapCommand,
  runCapabilitiesCommand,
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
