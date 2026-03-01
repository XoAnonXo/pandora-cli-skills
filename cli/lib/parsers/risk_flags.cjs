function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`Risk parser factory requires deps.${name}()`);
  }
  return deps[name];
}

function createParseRiskShowFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');

  return function parseRiskShowFlags(args) {
    const options = {
      riskFile: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--risk-file') {
        options.riskFile = requireFlagValue(args, i, '--risk-file');
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for risk show: ${token}`);
    }

    return options;
  };
}

function createParseRiskPanicFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');

  return function parseRiskPanicFlags(args) {
    const options = {
      clear: false,
      reason: null,
      actor: null,
      riskFile: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--clear') {
        options.clear = true;
        continue;
      }
      if (token === '--reason') {
        options.reason = requireFlagValue(args, i, '--reason');
        i += 1;
        continue;
      }
      if (token === '--actor') {
        options.actor = requireFlagValue(args, i, '--actor');
        i += 1;
        continue;
      }
      if (token === '--risk-file') {
        options.riskFile = requireFlagValue(args, i, '--risk-file');
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for risk panic: ${token}`);
    }

    if (!options.clear && (!options.reason || !String(options.reason).trim())) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing panic reason. Use --reason <text> or pass --clear.');
    }

    if (options.clear && options.reason !== null) {
      throw new CliError('INVALID_ARGS', '--reason is not allowed with --clear.');
    }

    return options;
  };
}

module.exports = {
  createParseRiskShowFlags,
  createParseRiskPanicFlags,
};
