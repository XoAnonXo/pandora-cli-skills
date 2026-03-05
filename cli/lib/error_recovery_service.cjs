function cleanToken(value, fallback) {
  const normalized = String(value === undefined || value === null ? '' : value).trim();
  return normalized || fallback;
}

function toAddressOrPlaceholder(value, placeholder = '<address>') {
  const normalized = cleanToken(value, '');
  if (/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
    return normalized;
  }
  return placeholder;
}

function toSideOrPlaceholder(value) {
  const normalized = cleanToken(value, '').toLowerCase();
  return normalized === 'yes' || normalized === 'no' ? normalized : 'yes';
}

function toPositiveNumberOrPlaceholder(value, placeholder = '<amount>') {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return String(numeric);
  }
  return placeholder;
}

function buildTradeRetryCommand(cliName, details) {
  const marketAddress = toAddressOrPlaceholder(details && details.marketAddress);
  const side = toSideOrPlaceholder(details && details.side);
  const mode = cleanToken(details && details.mode, '').toLowerCase();
  if (mode === 'sell') {
    const amount = toPositiveNumberOrPlaceholder(details && (details.amount || details.amountShares), '<shares>');
    return `${cliName} sell --dry-run --market-address ${marketAddress} --side ${side} --shares ${amount}`;
  }
  const amountUsdc = toPositiveNumberOrPlaceholder(details && details.amountUsdc);
  return `${cliName} trade --dry-run --market-address ${marketAddress} --side ${side} --amount-usdc ${amountUsdc}`;
}

function buildPolymarketApproveCommand(cliName) {
  return `${cliName} polymarket approve --dry-run`;
}

function buildPolymarketPreflightCommand(cliName) {
  return `${cliName} polymarket preflight`;
}

function buildMirrorDeployRetryCommand(cliName) {
  return `${cliName} mirror deploy --dry-run --plan-file <plan-file>`;
}

function buildMirrorVerifyRetryCommand(cliName, details) {
  const pandoraMarketAddress = toAddressOrPlaceholder(details && details.pandoraMarketAddress);
  const polymarketMarketId = cleanToken(details && details.polymarketMarketId, '');
  const polymarketSlug = cleanToken(details && details.polymarketSlug, '');
  const manifestFile = cleanToken(details && details.manifestFile, '');
  const command = [
    `${cliName} mirror verify`,
    `--market-address ${pandoraMarketAddress}`,
    polymarketMarketId ? `--polymarket-market-id ${polymarketMarketId}` : null,
    !polymarketMarketId && polymarketSlug ? `--polymarket-slug ${polymarketSlug}` : null,
    '--trust-deploy',
    manifestFile ? `--manifest-file ${manifestFile}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  return command;
}

function buildMirrorSyncRetryCommand(cliName) {
  return `${cliName} mirror sync once --paper --pandora-market-address <address> --polymarket-market-id <id>`;
}

function buildMcpRestartCommand(cliName) {
  return `${cliName} mcp`;
}

function buildMcpBoundedCommand(cliName, details) {
  const toolName = cleanToken(details && details.toolName, '');
  if (toolName.startsWith('sports.sync.')) {
    return `${cliName} sports sync once --help`;
  }
  if (toolName.startsWith('mirror.sync.')) {
    return `${cliName} mirror sync once --help`;
  }
  if (toolName.startsWith('autopilot.')) {
    return `${cliName} autopilot once --help`;
  }
  if (toolName.startsWith('watch')) {
    return `${cliName} watch --help`;
  }
  return `${cliName} help`;
}

function buildRiskShowCommand(cliName, details) {
  const riskFile = cleanToken(details && details.riskFile, '');
  if (riskFile) {
    return `${cliName} risk show --risk-file ${riskFile}`;
  }
  return `${cliName} risk show`;
}

function buildRiskPanicClearCommand(cliName, details) {
  const riskFile = cleanToken(details && details.riskFile, '');
  if (riskFile) {
    return `${cliName} risk panic --clear --risk-file ${riskFile}`;
  }
  return `${cliName} risk panic --clear`;
}

function buildSportsConsensusRetryCommand(cliName, details) {
  const eventId = cleanToken(details && details.eventId, '<event-id>');
  return `${cliName} sports consensus --event-id ${eventId}`;
}

function buildSportsCreatePlanCommand(cliName, details) {
  const eventId = cleanToken(details && details.eventId, '<event-id>');
  return `${cliName} sports create plan --event-id ${eventId}`;
}

function buildSportsResolvePlanRetryCommand(cliName, details) {
  const eventId = cleanToken(details && details.eventId, '<event-id>');
  return `${cliName} sports resolve plan --event-id ${eventId}`;
}

function buildLifecycleStatusCommand(cliName, details) {
  const id = cleanToken(details && details.id, '<lifecycle-id>');
  return `${cliName} lifecycle status --id ${id}`;
}

function buildLifecycleStartCommand(cliName, details) {
  const configPath = cleanToken(details && details.configPath, '<config-file>');
  return `${cliName} lifecycle start --config ${configPath}`;
}

function buildOddsRecordCommand(cliName, details) {
  const competition = cleanToken(details && details.competition, '<competition>');
  return `${cliName} odds record --competition ${competition} --interval 60 --max-samples 1`;
}

function buildOddsHistoryCommand(cliName, details) {
  const eventId = cleanToken(details && details.eventId, '<event-id>');
  return `${cliName} odds history --event-id ${eventId} --output json`;
}

function buildArbScanCommand(cliName) {
  return `${cliName} arb scan --markets <market-a>,<market-b> --output json --iterations 1`;
}

function buildSimulateMcCommand(cliName) {
  return `${cliName} simulate mc --help`;
}

function buildSimulateParticleFilterCommand(cliName) {
  return `${cliName} simulate particle-filter --help`;
}

function buildSimulateAgentsCommand(cliName) {
  return `${cliName} simulate agents --help`;
}

function buildModelScoreBrierCommand(cliName) {
  return `${cliName} model score brier --help`;
}

function buildModelCalibrateCommand(cliName) {
  return `${cliName} model calibrate --help`;
}

function buildModelCorrelationCommand(cliName) {
  return `${cliName} model correlation --help`;
}

function buildModelDiagnoseCommand(cliName) {
  return `${cliName} model diagnose --help`;
}

/**
 * Build deterministic Next-Best-Action recovery hints for JSON errors.
 * @param {{cliName?: string}} [options]
 * @returns {{getRecoveryForError: (errorLike: any) => (null|{action: string, command: string, retryable: boolean})}}
 */
function createErrorRecoveryService(options = {}) {
  const cliName = cleanToken(options.cliName, 'pandora');

  function getRecoveryForError(errorLike) {
    const code = cleanToken(errorLike && errorLike.code, '');
    const details = errorLike && typeof errorLike.details === 'object' && errorLike.details ? errorLike.details : {};

    switch (code) {
      case 'TRADE_RISK_GUARD':
        return {
          action: 'Adjust risk guard inputs',
          command: buildTradeRetryCommand(cliName, details),
          retryable: true,
        };
      case 'ALLOWANCE_READ_FAILED':
      case 'APPROVE_SIMULATION_FAILED':
      case 'APPROVE_EXECUTION_FAILED':
      case 'TRADE_EXECUTION_FAILED':
        return {
          action: 'Re-run trade planning before execute',
          command: buildTradeRetryCommand(cliName, details),
          retryable: true,
        };
      case 'POLYMARKET_APPROVE_FAILED':
      case 'POLYMARKET_PROXY_APPROVAL_REQUIRES_MANUAL_EXECUTION':
        return {
          action: 'Run Polymarket approve flow first',
          command: buildPolymarketApproveCommand(cliName),
          retryable: true,
        };
      case 'POLYMARKET_TRADE_FAILED':
      case 'POLYMARKET_PREFLIGHT_FAILED':
      case 'POLYMARKET_CHECK_FAILED':
      case 'POLYMARKET_MARKET_RESOLUTION_FAILED':
        return {
          action: 'Run Polymarket preflight diagnostics',
          command: buildPolymarketPreflightCommand(cliName),
          retryable: true,
        };
      case 'MIRROR_DEPLOY_FAILED':
      case 'MIRROR_GO_FAILED':
      case 'MIRROR_GO_PREFLIGHT_FAILED':
        return {
          action: 'Re-run mirror deploy/verify in dry-run mode',
          command: buildMirrorDeployRetryCommand(cliName),
          retryable: true,
        };
      case 'MIRROR_GO_VERIFY_FAILED':
      case 'MIRROR_GO_VERIFY_PENDING':
        return {
          action: 'Retry verification against the existing deployed market (do not redeploy)',
          command: buildMirrorVerifyRetryCommand(cliName, details),
          retryable: true,
        };
      case 'MIRROR_SYNC_FAILED':
      case 'MIRROR_GO_SYNC_FAILED':
      case 'MIRROR_SYNC_PREFLIGHT_FAILED':
      case 'MIRROR_SYNC_DAEMON_START_FAILED':
      case 'MIRROR_SYNC_DAEMON_STOP_FAILED':
      case 'MIRROR_SYNC_DAEMON_STATUS_FAILED':
        return {
          action: 'Run a bounded mirror sync iteration to isolate the failing gate',
          command: buildMirrorSyncRetryCommand(cliName),
          retryable: true,
        };
      case 'MCP_EXECUTE_INTENT_REQUIRED':
        return {
          action: 'Retry MCP tools/call with execute intent enabled',
          command: buildMcpRestartCommand(cliName),
          retryable: true,
        };
      case 'MCP_LONG_RUNNING_MODE_BLOCKED':
        return {
          action: 'Switch to a bounded command variant for MCP',
          command: buildMcpBoundedCommand(cliName, details),
          retryable: true,
        };
      case 'MCP_TOOL_FAILED':
      case 'UNKNOWN_TOOL':
        return {
          action: 'Inspect available MCP tools and retry with a supported tool name',
          command: `${cliName} --output json schema`,
          retryable: true,
        };
      case 'MCP_TOOL_UNAVAILABLE':
        return {
          action: 'Tool contract exists but this build does not yet include its executable handler',
          command: `${cliName} --output json schema`,
          retryable: true,
        };
      case 'ERR_RISK_LIMIT':
      case 'RISK_PANIC_ACTIVE':
      case 'RISK_KILL_SWITCH_ACTIVE':
        if (details.guardrail === 'kill_switch' || details.kill_switch === true) {
          return {
            action: 'Clear kill switch when intentional emergency lock is complete',
            command: buildRiskPanicClearCommand(cliName, details),
            retryable: true,
          };
        }
        if (details.guardrail) {
          return {
            action: 'Review guardrail thresholds and reduce live write size/frequency',
            command: buildRiskShowCommand(cliName, details),
            retryable: true,
          };
        }
        return {
          action: 'Inspect risk panic status and clear if intentional lock is complete',
          command: buildRiskShowCommand(cliName, details),
          retryable: true,
        };
      case 'RISK_GUARDRAIL_BLOCKED':
        return {
          action: 'Review guardrail thresholds and reduce live write size/frequency',
          command: buildRiskShowCommand(cliName, details),
          retryable: true,
        };
      case 'RISK_STATE_READ_FAILED':
      case 'RISK_STATE_WRITE_FAILED':
      case 'RISK_STATE_INVALID':
        return {
          action: 'Repair risk state file and re-check risk status',
          command: buildRiskShowCommand(cliName, details),
          retryable: true,
        };
      case 'SPORTS_PROVIDER_NOT_CONFIGURED':
      case 'SPORTS_PROVIDER_FETCH_MISSING':
      case 'SPORTS_LIST_COMPETITIONS_FAILED':
      case 'SPORTS_LIST_EVENTS_FAILED':
      case 'SPORTS_GET_EVENT_ODDS_FAILED':
      case 'SPORTS_GET_EVENT_STATUS_FAILED':
        return {
          action: 'Retry sportsbook query with explicit provider settings',
          command: `${cliName} sports books list --provider auto`,
          retryable: true,
        };
      case 'SPORTS_PROVIDER_TIMEOUT':
      case 'SPORTS_PROVIDER_REQUEST_FAILED':
      case 'SPORTS_PROVIDER_HTTP_ERROR':
      case 'SPORTS_PROVIDER_INVALID_JSON':
        return {
          action: 'Retry sportsbook read path with backup provider',
          command: `${cliName} sports events list --provider backup --limit 10`,
          retryable: true,
        };
      case 'SPORTS_CONSENSUS_FAILED':
      case 'SPORTS_CONSENSUS_UNAVAILABLE':
        return {
          action: 'Re-run consensus for the target event',
          command: buildSportsConsensusRetryCommand(cliName, details),
          retryable: true,
        };
      case 'SPORTS_CREATE_BLOCKED':
      case 'SPORTS_CREATE_FAILED':
        return {
          action: 'Rebuild creation plan and adjust timing/coverage inputs',
          command: buildSportsCreatePlanCommand(cliName, details),
          retryable: true,
        };
      case 'SPORTS_SYNC_ALREADY_RUNNING':
        return {
          action: 'Check running sports sync status before starting another loop',
          command: `${cliName} sports sync status --state-file ${cleanToken(details && details.stateFile, '<state-file>')}`,
          retryable: true,
        };
      case 'SPORTS_RESOLVE_PLAN_UNSAFE':
        return {
          action: 'Wait for stable final status and retry resolve plan',
          command: buildSportsResolvePlanRetryCommand(cliName, details),
          retryable: true,
        };
      case 'LIFECYCLE_EXISTS':
        return {
          action: 'Inspect existing lifecycle state before creating another run',
          command: buildLifecycleStatusCommand(cliName, details),
          retryable: true,
        };
      case 'CONFIG_FILE_NOT_FOUND':
        return {
          action: 'Create/fix lifecycle config file and retry start',
          command: buildLifecycleStartCommand(cliName, details),
          retryable: true,
        };
      case 'LIFECYCLE_NOT_FOUND':
        return {
          action: 'Verify lifecycle id and inspect currently tracked runs',
          command: `${cliName} lifecycle status --id <lifecycle-id>`,
          retryable: true,
        };
      case 'ODDS_RECORD_CONNECTOR_FAILED':
      case 'ODDS_RECORD_FAILED':
      case 'ODDS_RECORD_WRITE_FAILED':
        return {
          action: 'Run one bounded odds capture sample to isolate connector/storage errors',
          command: buildOddsRecordCommand(cliName, details),
          retryable: true,
        };
      case 'ODDS_HISTORY_READ_FAILED':
      case 'ODDS_HISTORY_FAILED':
        return {
          action: 'Retry odds history read with explicit event id and JSON output',
          command: buildOddsHistoryCommand(cliName, details),
          retryable: true,
        };
      case 'ARB_SCAN_FAILED':
      case 'ARB_SCAN_INVALID_OUTPUT':
        return {
          action: 'Run a bounded arb scan iteration for deterministic diagnostics',
          command: buildArbScanCommand(cliName),
          retryable: true,
        };
      case 'SIMULATE_MC_FAILED':
      case 'SIMULATE_MC_INVALID_INPUT':
        return {
          action: 'Inspect Monte Carlo command flags and rerun with bounded parameters',
          command: buildSimulateMcCommand(cliName),
          retryable: true,
        };
      case 'SIMULATE_PARTICLE_FILTER_FAILED':
      case 'SIMULATE_PARTICLE_FILTER_INVALID_INPUT':
        return {
          action: 'Inspect particle-filter command flags and input schema',
          command: buildSimulateParticleFilterCommand(cliName),
          retryable: true,
        };
      case 'SIMULATE_AGENTS_FAILED':
      case 'SIMULATE_AGENTS_INVALID_INPUT':
        return {
          action: 'Inspect agents simulation command flags and rerun with deterministic seed',
          command: buildSimulateAgentsCommand(cliName),
          retryable: true,
        };
      case 'MODEL_SCORE_BRIER_FAILED':
      case 'MODEL_SCORE_BRIER_INVALID_INPUT':
      case 'BRIER_FAILED':
      case 'BRIER_INVALID_INPUT':
      case 'BRIER_INVALID_GROUP_BY':
      case 'BRIER_INVALID_OUTCOME':
      case 'BRIER_INVALID_RECORD':
      case 'FORECAST_READ_FAILED':
      case 'FORECAST_WRITE_FAILED':
      case 'FORECAST_INVALID_RECORD':
      case 'FORECAST_INVALID_PROBABILITY':
      case 'FORECAST_INVALID_OUTCOME':
      case 'FORECAST_INVALID_TIMESTAMP':
      case 'FORECAST_STORE_UNAVAILABLE':
      case 'FORECAST_PROBABILITY_UNAVAILABLE':
        return {
          action: 'Inspect Brier scoring command inputs and rerun in read-only mode',
          command: buildModelScoreBrierCommand(cliName),
          retryable: true,
        };
      case 'MODEL_CALIBRATE_FAILED':
      case 'MODEL_CALIBRATE_INVALID_INPUT':
      case 'MODEL_STORE_WRITE_FAILED':
        return {
          action: 'Inspect calibration flags and model artifact path before retrying',
          command: buildModelCalibrateCommand(cliName),
          retryable: true,
        };
      case 'MODEL_CORRELATION_FAILED':
      case 'MODEL_CORRELATION_INVALID_INPUT':
        return {
          action: 'Inspect correlation/correlation-model flags and rerun with bounded sample size',
          command: buildModelCorrelationCommand(cliName),
          retryable: true,
        };
      case 'MODEL_DIAGNOSE_FAILED':
      case 'MODEL_DIAGNOSE_INVALID_INPUT':
      case 'MODEL_STORE_READ_FAILED':
        return {
          action: 'Inspect diagnose flags and model artifact references before retrying',
          command: buildModelDiagnoseCommand(cliName),
          retryable: true,
        };
      case 'MCP_FILE_ACCESS_BLOCKED':
        return {
          action: 'Use a workspace-relative file path when invoking tools via MCP',
          command: `${cliName} help`,
          retryable: true,
        };
      case 'MISSING_REQUIRED_FLAG':
      case 'MISSING_FLAG_VALUE':
      case 'INVALID_FLAG_VALUE':
      case 'UNKNOWN_FLAG':
      case 'INVALID_ARGS':
      case 'INVALID_USAGE':
      case 'INVALID_OUTPUT_MODE':
      case 'UNSUPPORTED_OUTPUT_MODE':
      case 'UNKNOWN_COMMAND':
        return {
          action: 'Inspect command help and retry',
          command: `${cliName} help`,
          retryable: true,
        };
      default:
        return null;
    }
  }

  return {
    getRecoveryForError,
  };
}

module.exports = {
  createErrorRecoveryService,
};
