function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunSimulateCommand requires deps.${name}()`);
  }
  return deps[name];
}

const SIMULATE_USAGE = 'pandora [--output table|json] simulate mc|particle-filter|agents ...';
const SIMULATE_MC_USAGE =
  'pandora [--output table|json] simulate mc [--trials <n>] [--horizon <n>] [--start-yes-pct <0-100>] [--entry-yes-pct <0-100>] [--position yes|no] [--stake-usdc <n>] [--drift-bps <n>] [--vol-bps <n>] [--confidence <50-100>] [--var-level <50-100>] [--seed <n>] [--antithetic] [--stratified]';
const SIMULATE_PARTICLE_FILTER_USAGE =
  'pandora [--output table|json] simulate particle-filter (--observations-json <json>|--input <path>|--stdin) [--particles <n>] [--process-noise <n>] [--observation-noise <n>] [--drift-bps <n>] [--initial-yes-pct <0-100>] [--initial-spread <n>] [--resample-threshold <0-1>] [--resample-method systematic|multinomial] [--credible-interval <50-100>] [--seed <n>]';

function renderSimulateMcTable(payload) {
  const summary = payload && payload.summary ? payload.summary : {};
  const finalYes = summary.finalYesPct || {};
  const pnl = summary.pnlUsdc || {};
  const risk = summary.risk || {};

  // eslint-disable-next-line no-console
  console.log('simulate mc');
  // eslint-disable-next-line no-console
  console.log(`  final yes mean: ${finalYes.mean}%`);
  // eslint-disable-next-line no-console
  console.log(`  final yes ${payload.inputs.confidencePct}% CI: ${finalYes.ciLower}% .. ${finalYes.ciUpper}%`);
  // eslint-disable-next-line no-console
  console.log(`  pnl mean: ${pnl.mean} USDC`);
  // eslint-disable-next-line no-console
  console.log(`  pnl ${payload.inputs.confidencePct}% CI: ${pnl.ciLower} .. ${pnl.ciUpper} USDC`);
  // eslint-disable-next-line no-console
  console.log(`  VaR(${risk.varLevelPct}%): ${risk.valueAtRiskUsdc} USDC`);
  // eslint-disable-next-line no-console
  console.log(`  ES(${risk.varLevelPct}%): ${risk.expectedShortfallUsdc} USDC`);
}

function renderSimulateParticleFilterTable(payload) {
  const summary = payload && payload.summary ? payload.summary : {};
  const final = summary.final || {};

  // eslint-disable-next-line no-console
  console.log('simulate particle-filter');
  // eslint-disable-next-line no-console
  console.log(`  steps: ${payload.inputs.steps}`);
  // eslint-disable-next-line no-console
  console.log(`  observed: ${summary.observedCount}, missing: ${summary.missingCount}`);
  // eslint-disable-next-line no-console
  console.log(`  final filtered yes: ${final.filteredYesPct}%`);
  // eslint-disable-next-line no-console
  console.log(`  final CI: ${final.credibleIntervalYesPct ? final.credibleIntervalYesPct.lower : null}% .. ${final.credibleIntervalYesPct ? final.credibleIntervalYesPct.upper : null}%`);
  // eslint-disable-next-line no-console
  console.log(`  avg ESS: ${summary.averageEss}, min ESS: ${summary.minEss}, resamples: ${summary.resamples}`);
}

function createRunSimulateCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseSimulateMcFlags = requireDep(deps, 'parseSimulateMcFlags');
  const parseSimulateParticleFilterFlags = requireDep(deps, 'parseSimulateParticleFilterFlags');

  const runSimulateMc = typeof deps.runSimulateMc === 'function'
    ? deps.runSimulateMc
    : require('./simulate_handlers/mc.cjs').runSimulateMc;

  const runSimulateParticleFilter = typeof deps.runSimulateParticleFilter === 'function'
    ? deps.runSimulateParticleFilter
    : require('./simulate_handlers/particle_filter.cjs').runSimulateParticleFilter;
  const runSimulateAgents =
    typeof deps.runSimulateAgents === 'function' ? deps.runSimulateAgents : require('./simulate_handlers/agents.cjs');

  async function runSimulateCommand(args, context) {
    const action = args[0];
    const actionArgs = args.slice(1);

    if (!action || action === '--help' || action === '-h') {
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'simulate.help', commandHelpPayload(SIMULATE_USAGE));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${SIMULATE_USAGE}`);
        // eslint-disable-next-line no-console
        console.log('Subcommands:');
        // eslint-disable-next-line no-console
        console.log('  mc               Monte Carlo market simulation (PnL, VaR, ES)');
        // eslint-disable-next-line no-console
        console.log('  particle-filter  Sequential Bayesian filtering with observations');
        // eslint-disable-next-line no-console
        console.log('  agents           Multi-agent coordination simulation');
        // eslint-disable-next-line no-console
        console.log('Run with --help on a subcommand for full flags (e.g., pandora simulate mc --help).');
      }
      return;
    }

    if (action === 'mc') {
      if (includesHelpFlag(actionArgs)) {
        if (context.outputMode === 'json') {
          emitSuccess(context.outputMode, 'simulate.mc.help', commandHelpPayload(SIMULATE_MC_USAGE));
        } else {
          // eslint-disable-next-line no-console
          console.log(`Usage: ${SIMULATE_MC_USAGE}`);
        }
        return;
      }

      const options = parseSimulateMcFlags(actionArgs);
      const payload = await runSimulateMc(options);
      emitSuccess(context.outputMode, 'simulate.mc', payload, renderSimulateMcTable);
      return;
    }

    if (action === 'particle-filter' || action === 'pf') {
      if (includesHelpFlag(actionArgs)) {
        if (context.outputMode === 'json') {
          emitSuccess(context.outputMode, 'simulate.particle-filter.help', commandHelpPayload(SIMULATE_PARTICLE_FILTER_USAGE));
        } else {
          // eslint-disable-next-line no-console
          console.log(`Usage: ${SIMULATE_PARTICLE_FILTER_USAGE}`);
        }
        return;
      }

      const options = parseSimulateParticleFilterFlags(actionArgs);
      const payload = await runSimulateParticleFilter(options);
      emitSuccess(context.outputMode, 'simulate.particle-filter', payload, renderSimulateParticleFilterTable);
      return;
    }

    if (action === 'agents') {
      await runSimulateAgents({ actionArgs, context, deps });
      return;
    }

    throw new CliError('INVALID_ARGS', 'simulate requires subcommand: mc|particle-filter|agents');
  }

  return {
    runSimulateCommand,
  };
}

module.exports = {
  SIMULATE_USAGE,
  SIMULATE_MC_USAGE,
  SIMULATE_PARTICLE_FILTER_USAGE,
  createRunSimulateCommand,
};
