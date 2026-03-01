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
      case 'MIRROR_GO_VERIFY_FAILED':
      case 'MIRROR_GO_PREFLIGHT_FAILED':
        return {
          action: 'Re-run mirror deploy/verify in dry-run mode',
          command: buildMirrorDeployRetryCommand(cliName),
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
