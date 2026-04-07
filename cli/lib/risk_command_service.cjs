function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunRiskCommand requires deps.${name}()`);
  }
  return deps[name];
}

function createRunRiskCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseRiskShowFlags = requireDep(deps, 'parseRiskShowFlags');
  const parseRiskPanicFlags = requireDep(deps, 'parseRiskPanicFlags');
  const getRiskSnapshot = requireDep(deps, 'getRiskSnapshot');
  const setPanic = requireDep(deps, 'setPanic');
  const clearPanic = requireDep(deps, 'clearPanic');
  const renderRiskTable = requireDep(deps, 'renderRiskTable');

  function emitHelp(outputMode, eventName, usage) {
    if (outputMode === 'json') {
      emitSuccess(outputMode, eventName, commandHelpPayload(usage));
    } else {
      // eslint-disable-next-line no-console
      console.log(`Usage: ${usage}`);
    }
  }

  function buildRiskSnapshotPayload(state, extra = {}) {
    return {
      ...extra,
      riskFile: state.riskFile,
      max_position_usd: state.guardrails ? state.guardrails.maxSingleLiveNotionalUsdc : state.max_position_usd,
      max_daily_loss_usd: state.guardrails ? state.guardrails.maxDailyLiveNotionalUsdc : state.max_daily_loss_usd,
      max_open_markets: state.guardrails ? state.guardrails.maxDailyLiveOps : state.max_open_markets,
      kill_switch: state.kill_switch,
      metadata: state.metadata,
      panic: state.panic,
      guardrails: state.guardrails,
      counters: state.counters,
    };
  }

  return async function runRiskCommand(args, context) {
    const action = args[0];

    if (!action || action === '--help' || action === '-h') {
      emitHelp(context.outputMode, 'risk.help', 'pandora [--output table|json] risk show\n  panic: pandora [--output table|json] risk panic [--risk-file <path>] [--reason <text>] [--actor <id>]\n  clear: pandora [--output table|json] risk panic --clear [--actor <id>]');
      return;
    }

    if (action === 'show') {
      if (includesHelpFlag(args.slice(1))) {
        emitHelp(context.outputMode, 'risk.show.help', 'pandora [--output table|json] risk show [--risk-file <path>]');
        return;
      }

      const options = parseRiskShowFlags(args.slice(1));
      const snapshot = getRiskSnapshot(options);
      emitSuccess(context.outputMode, 'risk.show', buildRiskSnapshotPayload(snapshot.state, { riskFile: snapshot.riskFile }), renderRiskTable);
      return;
    }

    if (action === 'panic') {
      if (includesHelpFlag(args.slice(1))) {
        emitHelp(context.outputMode, 'risk.panic.help', 'pandora [--output table|json] risk panic [--risk-file <path>] [--reason <text> --actor <id>] | [--clear --actor <id>]');
        return;
      }

      const options = parseRiskPanicFlags(args.slice(1));
      const result = options.clear ? clearPanic(options) : setPanic(options);
      emitSuccess(context.outputMode, 'risk.panic', buildRiskSnapshotPayload(result, { action: result.action, changed: result.changed, stopFiles: result.stopFiles }), renderRiskTable);
      return;
    }

    throw new CliError('INVALID_ARGS', 'risk requires subcommand: show|panic');
  };
}

module.exports = {
  createRunRiskCommand,
};
