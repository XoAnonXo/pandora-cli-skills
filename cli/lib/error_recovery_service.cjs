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

function buildMirrorDeployRetryCommand(cliName, details) {
  const selectorPlan = cleanToken(details && details.planFile, '')
    ? `--plan-file ${cleanToken(details && details.planFile, '<plan-file>')}`
    : '--plan-file <plan-file>';
  const includeSourcesPlaceholder =
    details
    && (details.requiredMinimum || details.invalidSources || details.dependentSources || details.requiredValidation);
  return `${cliName} mirror deploy --dry-run ${selectorPlan}${includeSourcesPlaceholder ? ' --sources <url1> <url2>' : ''}`;
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

function buildAgentMarketValidateCommand(cliName, details) {
  const requiredValidation =
    details && typeof details.requiredValidation === 'object' && details.requiredValidation
      ? details.requiredValidation
      : null;
  if (requiredValidation && typeof requiredValidation.cliCommand === 'string' && requiredValidation.cliCommand.trim()) {
    return requiredValidation.cliCommand.trim().replace(/^pandora\b/, cliName);
  }
  if (requiredValidation && Array.isArray(requiredValidation.cliArgv) && requiredValidation.cliArgv.length) {
    return `${cliName} --output json ${requiredValidation.cliArgv.join(' ')}`;
  }
  return `${cliName} --output json agent market validate --question <text> --rules <text> --target-timestamp <unix-seconds> --sources <url1> <url2>`;
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

function buildContextArgs(details = {}, options = {}) {
  const args = [];
  const commandName = cleanToken(
    options.commandName
      || details.command
      || details.commandName
      || details.tool
      || details.toolName,
    '',
  );
  const mode = cleanToken(options.mode || details.mode, '');
  const chainId = cleanToken(options.chainId || details.chainId, '');
  const category = cleanToken(options.category || details.category || details.categoryName, '');
  const includePolicyId = options.includePolicyId !== false;
  const includeProfileId = options.includeProfileId !== false;
  const policyId = includePolicyId ? cleanToken(options.policyId || details.policyId, '') : '';
  const profileId = includeProfileId ? cleanToken(options.profileId || details.profileId, '') : '';

  if (commandName) args.push(`--command ${commandName}`);
  if (mode) args.push(`--mode ${mode}`);
  if (chainId) args.push(`--chain-id ${chainId}`);
  if (category) args.push(`--category ${category}`);
  if (policyId) args.push(`--policy-id ${policyId}`);
  if (profileId) args.push(`--profile-id ${profileId}`);
  return args;
}

function buildPolicyCommand(cliName, details = {}, preferredId = null) {
  const policyId = cleanToken(preferredId || details.policyId || details.id, '');
  const contextArgs = buildContextArgs(details, { includePolicyId: false });
  if (policyId) {
    return `${cliName} --output json policy explain --id ${policyId}${contextArgs.length ? ` ${contextArgs.join(' ')}` : ''}`;
  }
  if (contextArgs.length) {
    return `${cliName} --output json policy recommend ${contextArgs.join(' ')}`;
  }
  return `${cliName} --output json policy list`;
}

function buildProfileCommand(cliName, details = {}, preferredId = null) {
  const profileId = cleanToken(preferredId || details.profileId || details.id, '');
  const contextArgs = buildContextArgs(details, { includeProfileId: false });
  if (profileId) {
    return `${cliName} --output json profile explain --id ${profileId}${contextArgs.length ? ` ${contextArgs.join(' ')}` : ''}`;
  }
  if (contextArgs.length) {
    return `${cliName} --output json profile recommend ${contextArgs.join(' ')}`;
  }
  return `${cliName} --output json profile list`;
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

function normalizeErrorLike(errorLike) {
  if (typeof errorLike === 'string') {
    return {
      code: cleanToken(errorLike, ''),
      message: null,
      details: {},
    };
  }

  const source = errorLike && typeof errorLike === 'object' ? errorLike : {};
  const details =
    source.details && typeof source.details === 'object' && !Array.isArray(source.details)
      ? source.details
      : {};

  return {
    code: cleanToken(source.code, ''),
    message: cleanToken(source.message, '') || null,
    details,
  };
}

function deriveErrorCategory(code) {
  const normalized = cleanToken(code, '').toUpperCase();
  if (!normalized) return 'unknown';
  if (normalized === 'UNEXPECTED_ERROR') return 'internal';
  if (
    normalized === 'MISSING_REQUIRED_FLAG'
    || normalized === 'MISSING_FLAG_VALUE'
    || normalized === 'INVALID_FLAG_VALUE'
    || normalized === 'UNKNOWN_FLAG'
    || normalized === 'INVALID_ARGS'
    || normalized === 'INVALID_USAGE'
    || normalized === 'INVALID_OUTPUT_MODE'
    || normalized === 'UNSUPPORTED_OUTPUT_MODE'
    || normalized === 'UNKNOWN_COMMAND'
  ) {
    return 'usage';
  }
  if (normalized.startsWith('RISK_') || normalized === 'ERR_RISK_LIMIT') return 'risk';
  if (normalized.startsWith('MIRROR_')) return 'mirror';
  if (normalized.startsWith('POLYMARKET_')) return 'polymarket';
  if (normalized.startsWith('MCP_')) return 'mcp';
  if (normalized.startsWith('SPORTS_')) return 'sports';
  if (normalized.startsWith('LIFECYCLE_')) return 'lifecycle';
  if (normalized.startsWith('ODDS_')) return 'odds';
  if (normalized.startsWith('SIMULATE_')) return 'simulate';
  if (normalized.startsWith('MODEL_') || normalized.startsWith('BRIER_') || normalized.startsWith('FORECAST_')) {
    return 'model';
  }
  if (normalized.startsWith('TRADE_') || normalized.startsWith('APPROVE_')) return 'trade';
  if (normalized.startsWith('RESOLVE_')) return 'resolve';
  if (normalized.startsWith('CLAIM_')) return 'claim';
  if (normalized.startsWith('POLICY_')) return 'policy';
  if (normalized.startsWith('PROFILE_')) return 'profile';
  if (normalized.startsWith('RECIPE_')) return 'recipe';
  return 'unknown';
}

function inferCategoryFromMessage(message) {
  const normalized = cleanToken(message, '').toLowerCase();
  if (!normalized) return 'unknown';
  if (/^risk requires subcommand:/.test(normalized)) return 'risk';
  if (/^policy /.test(normalized) || normalized.includes('policy pack')) return 'policy';
  if (/^profile /.test(normalized) || normalized.includes('signer profile')) return 'profile';
  if (/^mirror requires subcommand:/.test(normalized)) return 'mirror';
  return 'unknown';
}

function buildExplanationSummary(code, details = {}) {
  const normalized = cleanToken(code, '').toUpperCase();
  switch (normalized) {
    case 'RISK_PANIC_ACTIVE':
    case 'RISK_KILL_SWITCH_ACTIVE':
      return 'The global risk panic lock is active, so live writes are intentionally blocked until the lock is cleared.';
    case 'ERR_RISK_LIMIT':
    case 'RISK_GUARDRAIL_BLOCKED':
      if (cleanToken(details.guardrail, '')) {
        return `Risk guardrail ${details.guardrail} blocked the requested live action.`;
      }
      return 'A risk guardrail blocked the requested live action.';
    case 'MIRROR_GO_VERIFY_PENDING':
      return 'The mirror pair already exists, so deployment should stop and verification should be retried against the deployed market.';
    case 'MCP_LONG_RUNNING_MODE_BLOCKED':
      return 'The requested MCP tool was rejected because it is long-running or daemon-like and must be replaced with a bounded command.';
    case 'UNEXPECTED_ERROR':
      return 'The CLI hit an unexpected internal failure and could not classify it into a stable command error family.';
    default:
      break;
  }

  switch (deriveErrorCategory(normalized)) {
    case 'usage':
      return 'The CLI invocation is incomplete, contradictory, or uses an unsupported flag/command combination.';
    case 'risk':
      return 'A risk-state lock or guardrail blocked execution.';
    case 'mirror':
      return 'A mirror validation, deployment, or sync step failed and should be retried through the suggested bounded surface.';
    case 'polymarket':
      return 'A Polymarket wallet, approval, market-resolution, or trade preflight step failed.';
    case 'mcp':
      return 'An MCP policy, validation, or tool-shape constraint blocked the request.';
    case 'sports':
      return 'A sportsbook/provider read or sports workflow safety check failed.';
    case 'lifecycle':
      return 'A lifecycle state transition or lifecycle lookup failed.';
    case 'odds':
      return 'An odds recording or history read path failed.';
    case 'simulate':
      return 'A simulation input or bounded simulation run failed validation.';
    case 'model':
      return 'A model, forecast, correlation, or calibration surface failed validation or artifact access.';
    case 'trade':
      return 'A trade or approval path failed during planning or execution.';
    case 'resolve':
      return 'A resolve flow failed because the caller, finalization window, or runtime prerequisites were not satisfied.';
    case 'claim':
      return 'A claim flow failed because the market, wallet, or runtime prerequisites were not satisfied.';
    case 'policy':
      return 'A policy surface rejected the requested execution context.';
    case 'profile':
      return 'A signer profile lookup, compatibility check, or runtime readiness check failed.';
    case 'recipe':
      return 'A recipe definition or recipe execution step failed validation.';
    case 'internal':
      return 'The CLI hit an unexpected internal failure.';
    default:
      return 'No canonical explanation is registered for this error code yet.';
  }
}

function buildExplanationDiagnostics(details = {}) {
  const diagnostics = [];
  if (cleanToken(details.normalizedCode, '')) {
    diagnostics.push({
      code: 'NORMALIZED_CODE',
      normalizedCode: cleanToken(details.normalizedCode, ''),
    });
  }
  if (cleanToken(details.guardrail, '')) {
    diagnostics.push({
      code: 'GUARDRAIL',
      guardrail: cleanToken(details.guardrail, ''),
    });
  }
  if (cleanToken(details.riskFile, '')) {
    diagnostics.push({
      code: 'RISK_FILE',
      riskFile: cleanToken(details.riskFile, ''),
    });
  }
  if (cleanToken(details.toolName, '')) {
    diagnostics.push({
      code: 'TOOL_NAME',
      toolName: cleanToken(details.toolName, ''),
    });
  }
  return diagnostics;
}

/**
 * Build deterministic Next-Best-Action recovery hints for JSON errors.
 * @param {{cliName?: string}} [options]
 * @returns {{getRecoveryForError: (errorLike: any) => (null|{action: string, command: string, retryable: boolean}), getExplanationForError: (errorLike: any) => object}}
 */
function createErrorRecoveryService(options = {}) {
  const cliName = cleanToken(options.cliName, 'pandora');

  function getRecoveryForError(errorLike) {
    const code = cleanToken(errorLike && errorLike.code, '');
    const normalizedCode = cleanToken(errorLike && errorLike.normalizedCode, code).toUpperCase();
    const message = cleanToken(errorLike && errorLike.message, '');
    const details = errorLike && typeof errorLike.details === 'object' && errorLike.details ? errorLike.details : {};

    if (normalizedCode.startsWith('POLICY_')) {
      return {
        action: 'Inspect the policy decision surface and use a compatible policy or execution mode.',
        command: buildPolicyCommand(cliName, details),
        retryable: true,
      };
    }

    if (normalizedCode.startsWith('PROFILE_')) {
      return {
        action: 'Inspect profile compatibility/readiness and use a compatible signer profile or execution context.',
        command: buildProfileCommand(cliName, details),
        retryable: true,
      };
    }

    if (!normalizedCode && message) {
      if (/^risk requires subcommand:/i.test(message)) {
        return {
          action: 'Retry with a concrete risk subcommand instead of the family root.',
          command: buildRiskShowCommand(cliName, details),
          retryable: true,
        };
      }
      if (/^policy requires subcommand:/i.test(message)) {
        return {
          action: 'Retry with a concrete policy subcommand or ask for a recommendation for the target workflow.',
          command: buildPolicyCommand(cliName, details),
          retryable: true,
        };
      }
      if (/^profile requires subcommand:/i.test(message)) {
        return {
          action: 'Retry with a concrete profile subcommand or request a compatible signer recommendation.',
          command: buildProfileCommand(cliName, details),
          retryable: true,
        };
      }
    }

    switch (normalizedCode) {
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
      case 'MIRROR_VALIDATION_REQUIRED':
      case 'MIRROR_VALIDATION_MISMATCH':
        return {
          action: 'Run market validation for the exact mirror payload and reuse the returned ticket',
          command: buildAgentMarketValidateCommand(cliName, details),
          retryable: true,
        };
      case 'MIRROR_RULES_FORMAT_INVALID':
      case 'MIRROR_SOURCES_REQUIRED':
      case 'MIRROR_SOURCES_INVALID':
        return {
          action: 'Rebuild mirror deploy inputs in dry-run mode and provide explicit independent sources',
          command: buildMirrorDeployRetryCommand(cliName, details),
          retryable: true,
        };
      case 'MIRROR_DEPLOY_FAILED':
      case 'MIRROR_GO_FAILED':
      case 'MIRROR_GO_PREFLIGHT_FAILED':
        return {
          action: 'Re-run mirror deploy/verify in dry-run mode',
          command: buildMirrorDeployRetryCommand(cliName, details),
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
      case 'MCP_AGENT_PREFLIGHT_REQUIRED':
      case 'MCP_AGENT_MARKET_VALIDATION_REQUIRED':
      case 'MCP_AGENT_MARKET_VALIDATION_MISMATCH':
      case 'MCP_AGENT_MARKET_VALIDATION_FAILED':
      case 'MCP_AGENT_PREFLIGHT_INVALID':
        return {
          action: 'Run agent market validation on the exact final payload and pass the PASS attestation as agentPreflight',
          command: buildAgentMarketValidateCommand(cliName, details),
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
          action: 'Check sportsbook provider readiness first, then retry the sports command',
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
      case 'LIFECYCLE_INVALID_PHASE':
        return {
          action: 'Inspect the persisted lifecycle state and repair the invalid phase before retrying resolve',
          command: `${cliName} lifecycle status --id ${cleanToken(details && details.id, '<lifecycle-id>')}`,
          retryable: false,
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
    getExplanationForError(errorLike) {
      const normalized = normalizeErrorLike(errorLike);
      const recovery = getRecoveryForError(normalized);
      const normalizedCode = cleanToken(normalized.details && normalized.details.normalizedCode, normalized.code || null);
      const category = deriveErrorCategory(normalizedCode || normalized.code) !== 'unknown'
        ? deriveErrorCategory(normalizedCode || normalized.code)
        : inferCategoryFromMessage(normalized.message);
      const recognized = Boolean(recovery || (normalizedCode || normalized.code) && category !== 'unknown');

      return {
        code: normalized.code || null,
        normalizedCode: normalizedCode || null,
        message: normalized.message || null,
        details: normalized.details,
        recognized,
        category,
        summary: buildExplanationSummary(normalizedCode || normalized.code, normalized.details),
        retryable: recovery ? recovery.retryable : null,
        recovery,
        remediation: recovery
          ? [
              {
                type: 'run_command',
                action: recovery.action,
                command: recovery.command,
                retryable: recovery.retryable,
                canonical: true,
              },
            ]
          : [],
        diagnostics: buildExplanationDiagnostics(normalized.details),
      };
    },
  };
}

module.exports = {
  createErrorRecoveryService,
};
