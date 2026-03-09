const { runAbmMarket } = require('../quant/abm_market.cjs');

const SIMULATE_AGENTS_USAGE =
  'pandora [--output table|json] simulate agents [--n-informed <n>] [--n-noise <n>] [--n-mm <n>] [--n-steps <n>] [--seed <int>]';
const MAX_SIMULATE_AGENTS = 1_000;
const MAX_SIMULATE_STEPS = 10_000;

class LocalCliError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'LocalCliError';
    this.code = code;
    this.details = details;
  }
}

function getCliErrorCtor(deps) {
  return deps && typeof deps.CliError === 'function' ? deps.CliError : LocalCliError;
}

function localRequireFlagValue(args, index, flagName, CliErrorCtor) {
  const value = args[index + 1];
  if (typeof value !== 'string' || value.startsWith('--')) {
    throw new CliErrorCtor('MISSING_FLAG_VALUE', `Missing value for ${flagName}`);
  }
  return value;
}

function localParsePositiveInteger(rawValue, flagName, CliErrorCtor) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliErrorCtor('INVALID_FLAG_VALUE', `${flagName} must be a positive integer.`);
  }
  return parsed;
}

function localParseInteger(rawValue, flagName, CliErrorCtor) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed)) {
    throw new CliErrorCtor('INVALID_FLAG_VALUE', `${flagName} must be an integer.`);
  }
  return parsed;
}

function parseSimulateAgentsFlags(args, deps = {}) {
  const CliErrorCtor = getCliErrorCtor(deps);
  const requireFlagValue =
    typeof deps.requireFlagValue === 'function'
      ? deps.requireFlagValue
      : (values, index, flagName) => localRequireFlagValue(values, index, flagName, CliErrorCtor);
  const parsePositiveInteger =
    typeof deps.parsePositiveInteger === 'function'
      ? deps.parsePositiveInteger
      : (value, flagName) => localParsePositiveInteger(value, flagName, CliErrorCtor);
  const parseInteger =
    typeof deps.parseInteger === 'function'
      ? deps.parseInteger
      : (value, flagName) => localParseInteger(value, flagName, CliErrorCtor);

  const options = {};
  const tokens = Array.isArray(args) ? args : [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--n-informed' || token === '--n_informed') {
      options.n_informed = parsePositiveInteger(requireFlagValue(tokens, i, token), token);
      i += 1;
      continue;
    }
    if (token === '--n-noise' || token === '--n_noise') {
      options.n_noise = parsePositiveInteger(requireFlagValue(tokens, i, token), token);
      i += 1;
      continue;
    }
    if (token === '--n-mm' || token === '--n_mm') {
      options.n_mm = parsePositiveInteger(requireFlagValue(tokens, i, token), token);
      i += 1;
      continue;
    }
    if (token === '--n-steps' || token === '--n_steps') {
      options.n_steps = parsePositiveInteger(requireFlagValue(tokens, i, token), token);
      i += 1;
      continue;
    }
    if (token === '--seed') {
      options.seed = parseInteger(requireFlagValue(tokens, i, token), token);
      i += 1;
      continue;
    }
    throw new CliErrorCtor('UNKNOWN_FLAG', `Unknown flag for simulate agents: ${token}`);
  }

  if (options.n_informed !== undefined && options.n_informed > MAX_SIMULATE_AGENTS) {
    throw new CliErrorCtor('INVALID_FLAG_VALUE', `--n-informed must be <= ${MAX_SIMULATE_AGENTS}.`);
  }
  if (options.n_noise !== undefined && options.n_noise > MAX_SIMULATE_AGENTS) {
    throw new CliErrorCtor('INVALID_FLAG_VALUE', `--n-noise must be <= ${MAX_SIMULATE_AGENTS}.`);
  }
  if (options.n_mm !== undefined && options.n_mm > MAX_SIMULATE_AGENTS) {
    throw new CliErrorCtor('INVALID_FLAG_VALUE', `--n-mm must be <= ${MAX_SIMULATE_AGENTS}.`);
  }
  if (options.n_steps !== undefined && options.n_steps > MAX_SIMULATE_STEPS) {
    throw new CliErrorCtor('INVALID_FLAG_VALUE', `--n-steps must be <= ${MAX_SIMULATE_STEPS}.`);
  }

  return options;
}

function renderSimulateAgentsTable(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const params = payload.parameters || {};
  const volume = payload.volume || {};
  const pnl = payload.pnlByAgentType || {};
  const finalState = payload.finalState || {};

  console.log('Simulate Agents (ABM)');
  console.log(`  n_informed: ${params.n_informed}`);
  console.log(`  n_noise: ${params.n_noise}`);
  console.log(`  n_mm: ${params.n_mm}`);
  console.log(`  n_steps: ${params.n_steps}`);
  console.log(`  seed: ${params.seed}`);
  console.log(`  convergence_error: ${payload.convergenceError}`);
  console.log(`  avg_spread_bps: ${finalState.averageSpreadBps}`);
  console.log(`  total_volume: ${volume.total}`);
  console.log(
    `  pnl_by_agent_type: informed=${pnl.informed}, noise=${pnl.noise}, market_maker=${pnl.market_maker}, total=${pnl.total}`,
  );
}

function shouldShowHelp(args, deps) {
  if (deps && typeof deps.includesHelpFlag === 'function') {
    return deps.includesHelpFlag(args);
  }
  return Array.isArray(args) && args.some((token) => token === '--help' || token === '-h' || token === 'help');
}

async function handleSimulateAgents(params = {}) {
  const deps = params.deps || {};
  const context = params.context || { outputMode: 'table' };
  const actionArgs = Array.isArray(params.actionArgs)
    ? params.actionArgs
    : Array.isArray(params.shared && params.shared.rest)
      ? params.shared.rest
      : [];
  const CliErrorCtor = getCliErrorCtor(deps);
  const emitSuccess = deps.emitSuccess;
  const commandHelpPayload =
    typeof deps.commandHelpPayload === 'function'
      ? deps.commandHelpPayload
      : (usage) => ({ usage });

  if (shouldShowHelp(actionArgs, deps)) {
    if (context.outputMode === 'json' && typeof emitSuccess === 'function') {
      emitSuccess(context.outputMode, 'simulate.agents.help', commandHelpPayload(SIMULATE_AGENTS_USAGE));
    } else {
      console.log(`Usage: ${SIMULATE_AGENTS_USAGE}`);
    }
    return;
  }

  const parseFlags =
    typeof deps.parseSimulateAgentsFlags === 'function'
      ? deps.parseSimulateAgentsFlags
      : (values) => parseSimulateAgentsFlags(values, deps);
  const runSimulation =
    typeof deps.runAbmMarket === 'function'
      ? deps.runAbmMarket
      : typeof deps.runAbmMarketSimulation === 'function'
        ? deps.runAbmMarketSimulation
        : runAbmMarket;

  let payload;
  try {
    payload = runSimulation(parseFlags(actionArgs));
  } catch (error) {
    if (error instanceof CliErrorCtor) {
      throw error;
    }
    throw new CliErrorCtor('SIMULATE_AGENTS_FAILED', error && error.message ? error.message : String(error));
  }

  if (typeof emitSuccess === 'function') {
    emitSuccess(context.outputMode, 'simulate.agents', payload, deps.renderSimulateAgentsTable || renderSimulateAgentsTable);
    return;
  }

  if (context.outputMode === 'json') {
    console.log(
      JSON.stringify(
        {
          ok: true,
          command: 'simulate.agents',
          data: payload,
        },
        null,
        2,
      ),
    );
    return;
  }

  renderSimulateAgentsTable(payload);
}

module.exports = handleSimulateAgents;
module.exports.handle = handleSimulateAgents;
module.exports.SIMULATE_AGENTS_USAGE = SIMULATE_AGENTS_USAGE;
module.exports.parseSimulateAgentsFlags = parseSimulateAgentsFlags;
module.exports.renderSimulateAgentsTable = renderSimulateAgentsTable;
