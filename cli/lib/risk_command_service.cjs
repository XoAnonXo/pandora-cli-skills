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

  return async function runRiskCommand(args, context) {
    const action = args[0];
    const actionArgs = args.slice(1);

    if (!action || action === '--help' || action === '-h') {
      emitHelp(context.outputMode, 'risk.help', 'pandora [--output table|json] risk show|panic [--risk-file <path>] [--clear] [--reason <text>] [--actor <id>]');
      return;
    }

    if (action === 'show') {
      if (includesHelpFlag(actionArgs)) {
        emitHelp(context.outputMode, 'risk.show.help', 'pandora [--output table|json] risk show [--risk-file <path>]');
        return;
      }

      const options = parseRiskShowFlags(actionArgs);
      const snapshot = getRiskSnapshot(options);
      emitSuccess(
        context.outputMode,
        'risk.show',
        {
          riskFile: snapshot.riskFile,
          max_position_usd: snapshot.state.max_position_usd,
          max_daily_loss_usd: snapshot.state.max_daily_loss_usd,
          max_open_markets: snapshot.state.max_open_markets,
          kill_switch: snapshot.state.kill_switch,
          metadata: snapshot.state.metadata,
          panic: snapshot.state.panic,
          guardrails: snapshot.state.guardrails,
          counters: snapshot.state.counters,
        },
        renderRiskTable,
      );
      return;
    }

    if (action === 'panic') {
      if (includesHelpFlag(actionArgs)) {
        emitHelp(context.outputMode, 'risk.panic.help', 'pandora [--output table|json] risk panic [--risk-file <path>] [--reason <text> --actor <id>] | [--clear --actor <id>]');
        return;
      }

      const options = parseRiskPanicFlags(actionArgs);
      const result = options.clear ? clearPanic(options) : setPanic(options);
      emitSuccess(
        context.outputMode,
        'risk.panic',
        {
          action: result.action,
          changed: result.changed,
          riskFile: result.riskFile,
          max_position_usd: result.guardrails ? result.guardrails.maxSingleLiveNotionalUsdc : null,
          max_daily_loss_usd: result.guardrails ? result.guardrails.maxDailyLiveNotionalUsdc : null,
          max_open_markets: result.guardrails ? result.guardrails.maxDailyLiveOps : null,
          kill_switch: result.kill_switch,
          metadata: result.metadata,
          panic: result.panic,
          guardrails: result.guardrails,
          counters: result.counters,
          stopFiles: result.stopFiles,
        },
        renderRiskTable,
      );
      return;
    }

    throw new CliError('INVALID_ARGS', 'risk requires subcommand: show|panic');
  };
}

module.exports = {
  createRunRiskCommand,
};
