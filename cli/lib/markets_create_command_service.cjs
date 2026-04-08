'use strict';

const { buildRequiredAgentMarketValidation } = require('./agent_market_prompt_service.cjs');
const { isMcpMode } = require('./shared/mcp_path_guard.cjs');
const {
  DEFAULT_RPC_BY_CHAIN_ID,
  DEFAULT_ORACLE,
  DEFAULT_FACTORY,
  DEFAULT_USDC,
  DEFAULT_ARBITER,
} = require('./shared/constants.cjs');

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunMarketsCreateCommand requires deps.${name}().`);
  }
  return deps[name];
}

function normalizeLowercaseAddress(value, fallback) {
  return String(value || fallback || '').trim().toLowerCase() || null;
}

function buildRuntimeDefaults(options = {}) {
  const chainId = Number(options.chainId || process.env.CHAIN_ID || 1);
  return {
    chainId,
    rpcUrl: options.rpcUrl || process.env.RPC_URL || DEFAULT_RPC_BY_CHAIN_ID[chainId] || null,
    oracle: normalizeLowercaseAddress(options.oracle, process.env.ORACLE || DEFAULT_ORACLE),
    factory: normalizeLowercaseAddress(options.factory, process.env.FACTORY || DEFAULT_FACTORY),
    usdc: normalizeLowercaseAddress(options.usdc, process.env.USDC || DEFAULT_USDC),
    arbiter: normalizeLowercaseAddress(options.arbiter, process.env.ARBITER || DEFAULT_ARBITER),
  };
}

function buildCreateHelp(commandHelpPayload) {
  const usage =
    'pandora [--output table|json] markets create plan|run --question <text> --rules <text> --sources <url...> --target-timestamp <unix-seconds> [--market-type amm|parimutuel]';
  const notes = [
    'markets create is the canonical JSON/MCP-safe standalone Pandora market creation surface.',
    'Use `markets create plan` to normalize the market template and required validation ticket before execution.',
    'Use `markets create run` for dry-run or execute. Execute mode requires prior `agent market validate` attestation.',
    'markets create run supports post-poll execution routing via --tx-route public|auto|flashbots-private|flashbots-bundle. auto chooses flashbots-private when no approval is needed and flashbots-bundle when approval is required.',
    'Validation tickets are bound to the exact final payload: question, rules, sources, target timestamp, liquidity, market type, fee/curve params, and distribution. Any change requires a fresh ticket.',
    'For AMM markets, prefer `--initial-yes-pct` / `--initial-no-pct` to set the opening probability directly.',
    'For AMM markets, `--initial-yes-pct` / `--initial-no-pct` set the opening YES probability directly. Use `--yes-reserve-weight-pct` / `--no-reserve-weight-pct` only for explicit pool allocation (e.g., 77/23 opens YES near 23/77). Omitting both seeds a balanced 50/50 pool. Legacy `--distribution-yes-pct` / `--distribution-no-pct` are rejected with a migration error.',

  ];
  return {
    command: 'markets.create.help',
    payload: commandHelpPayload(usage, notes),
    table: {
      usage,
      notes,
    },
  };
}

function buildCreatePlanPayload(normalizedArgs, options, resolvedRuntime, requiredValidation) {
  return {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    mode: 'plan',
    marketTemplate: {
      ...normalizedArgs,
      chainId: resolvedRuntime.chainId,
      rpcUrl: resolvedRuntime.rpcUrl,
      oracle: resolvedRuntime.oracle,
      factory: resolvedRuntime.factory,
      usdc: resolvedRuntime.usdc,
      arbiter: resolvedRuntime.arbiter,
      minCloseLeadSeconds: Number.isFinite(Number(options.minCloseLeadSeconds))
        ? Math.max(0, Math.trunc(Number(options.minCloseLeadSeconds)))
        : 0,
      distributionInputMode: options.distributionInputMode || null,
    },
    execution: {
      supportsDryRun: true,
      supportsExecute: true,
      executeFlagRequired: '--execute',
      validationRequiredForExecute: true,
      canonicalRunCommand: 'pandora --output json markets create run ...',
    },
    requiredValidation,
    notes: [
      normalizedArgs.marketType === 'parimutuel'
        ? 'Pari-mutuel creation uses curveFlattener/curveOffset instead of AMM feeTier/maxImbalance.'
        : 'AMM creation uses feeTier/maxImbalance instead of pari-mutuel curve parameters.',
      'Validation tickets are bound to the exact final payload. Changing question, rules, sources, targetTimestamp, liquidity, fee/curve params, or distribution requires a fresh validation pass.',
      'For AMM markets, prefer --initial-yes-pct/--initial-no-pct to set the opening YES/NO probability directly.',
      'Use --yes-reserve-weight-pct/--no-reserve-weight-pct only for explicit reserve-weight control, not opening YES price.',
      'Legacy --distribution-yes-pct/--distribution-no-pct are rejected with a migration error because they were ambiguous for AMM pricing.',
      'If you omit AMM distribution flags, markets create seeds a balanced 50/50 pool.',
      'Legacy launch remains available for script-native flows, but markets create is the canonical JSON/MCP-safe path.',
    ],
  };
}

function assertCanonicalValidationTicket(options, requiredValidation, CliError) {
  if (!options.execute || isMcpMode()) {
    return {
      agentValidation: null,
      agentPreflight: null,
    };
  }

  const providedTicket = String(options.validationTicket || '').trim();
  if (!providedTicket) {
    throw new CliError(
      'MARKETS_CREATE_VALIDATION_REQUIRED',
      'markets create run --execute requires --validation-ticket from agent market validate for the exact final payload.',
      { requiredValidation },
    );
  }

  if (providedTicket !== requiredValidation.ticket) {
    throw new CliError(
      'MARKETS_CREATE_VALIDATION_MISMATCH',
      'Provided --validation-ticket does not match the exact final market payload.',
      {
        expectedTicket: requiredValidation.ticket,
        receivedTicket: providedTicket,
        requiredValidation,
      },
    );
  }

  return {
    agentValidation: {
      ok: true,
      ticket: providedTicket,
      decision: 'PASS',
      summary: 'Validated via CLI ticket gate.',
    },
    agentPreflight: {
      validationTicket: providedTicket,
      validationDecision: 'PASS',
      validationSummary: 'Validated via CLI ticket gate.',
    },
  };
}

function createRunMarketsCreateCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseMarketsCreateFlags = requireDep(deps, 'parseMarketsCreateFlags');
  const buildDeploymentArgs = requireDep(deps, 'buildDeploymentArgs');
  const deployPandoraMarket = requireDep(deps, 'deployPandoraMarket');
  const renderSingleEntityTable = requireDep(deps, 'renderSingleEntityTable');
  const assertLiveWriteAllowed =
    typeof deps.assertLiveWriteAllowed === 'function' ? deps.assertLiveWriteAllowed : null;

  return async function runMarketsCreateCommand(args, context) {
    if (!Array.isArray(args) || !args.length || includesHelpFlag(args)) {
      const help = buildCreateHelp(commandHelpPayload);
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, help.command, help.payload);
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${help.table.usage}`);
        // eslint-disable-next-line no-console
        console.log('');
        // eslint-disable-next-line no-console
        console.log('Notes:');
        for (const note of help.table.notes) {
          // eslint-disable-next-line no-console
          console.log(`- ${note}`);
        }
      }
      return;
    }

    const parsed = parseMarketsCreateFlags(args);
    const command = parsed.command || null;
    const options = parsed.options && typeof parsed.options === 'object' ? parsed.options : parsed;
    const normalizedArgs = buildDeploymentArgs(options);
    const requiredValidation = buildRequiredAgentMarketValidation({
      question: normalizedArgs.question,
      rules: normalizedArgs.rules,
      sources: normalizedArgs.sources,
      targetTimestamp: normalizedArgs.targetTimestamp,
    });
    const resolvedRuntime = buildRuntimeDefaults({
      ...options,
      arbiter: normalizedArgs.arbiter,
    });
    const planPayload = buildCreatePlanPayload(normalizedArgs, options, resolvedRuntime, requiredValidation);

    if (command === 'markets.create.plan') {
      emitSuccess(context.outputMode, command, planPayload, renderSingleEntityTable);
      return;
    }

    if (command !== 'markets.create.run') {
      throw new CliError('INVALID_ARGS', `Unsupported markets create command: ${command || '<none>'}`);
    }

    const validationGate = assertCanonicalValidationTicket(options, requiredValidation, CliError);

    if (options.execute && assertLiveWriteAllowed) {
      await assertLiveWriteAllowed('markets.create.run.execute', {
        notionalUsdc: normalizedArgs.liquidityUsdc,
        runtimeMode: 'live',
      });
    }

    const deployment = await deployPandoraMarket({
      ...options,
      ...normalizedArgs,
      execute: Boolean(options.execute),
      chainId: resolvedRuntime.chainId,
      rpcUrl: resolvedRuntime.rpcUrl,
      oracle: resolvedRuntime.oracle,
      factory: resolvedRuntime.factory,
      usdc: resolvedRuntime.usdc,
      arbiter: resolvedRuntime.arbiter,
      txRoute: options.txRoute || 'public',
      txRouteFallback: options.txRouteFallback || 'fail',
      flashbotsRelayUrl: options.flashbotsRelayUrl || null,
      flashbotsAuthKey: options.flashbotsAuthKey || null,
      flashbotsTargetBlockOffset: options.flashbotsTargetBlockOffset || null,
      agentPreflight: validationGate.agentPreflight,
      command: 'markets.create.run',
      toolFamily: 'markets',
      source: 'markets.create.run',
    });

    emitSuccess(
      context.outputMode,
      command,
      {
        ...planPayload,
        mode: options.execute ? 'execute' : 'dry-run',
        deployment,
        agentValidation: validationGate.agentValidation,
      },
      renderSingleEntityTable,
    );
  };
}

module.exports = {
  createRunMarketsCreateCommand,
};
