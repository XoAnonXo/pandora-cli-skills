function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParseLifecycleFlags requires deps.${name}()`);
  }
  return deps[name];
}

/**
 * Creates parser for `lifecycle start|status|resolve` flags.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseLifecycleFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');

  return function parseLifecycleFlags(args) {
    const action = args[0];
    if (!action || !['start', 'status', 'resolve'].includes(action)) {
      throw new CliError('INVALID_ARGS', 'lifecycle requires subcommand: start|status|resolve.');
    }

    const rest = args.slice(1);
    const options = {
      action,
      configPath: null,
      id: null,
      confirm: false,
    };

    for (let i = 0; i < rest.length; i += 1) {
      const token = rest[i];
      if (token === '--config') {
        options.configPath = requireFlagValue(rest, i, '--config');
        i += 1;
        continue;
      }
      if (token === '--id') {
        options.id = requireFlagValue(rest, i, '--id');
        i += 1;
        continue;
      }
      if (token === '--confirm') {
        options.confirm = true;
        continue;
      }

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for lifecycle ${action}: ${token}`);
    }

    if (action === 'start') {
      if (!options.configPath) {
        throw new CliError('MISSING_REQUIRED_FLAG', 'Missing config path. Use --config <file>.');
      }
      if (options.id) {
        throw new CliError('INVALID_ARGS', 'lifecycle start does not accept --id.');
      }
      if (options.confirm) {
        throw new CliError('INVALID_ARGS', 'lifecycle start does not accept --confirm.');
      }
    }

    if (action === 'status') {
      if (!options.id) {
        throw new CliError('MISSING_REQUIRED_FLAG', 'Missing lifecycle id. Use --id <id>.');
      }
      if (options.configPath) {
        throw new CliError('INVALID_ARGS', 'lifecycle status does not accept --config.');
      }
      if (options.confirm) {
        throw new CliError('INVALID_ARGS', 'lifecycle status does not accept --confirm.');
      }
    }

    if (action === 'resolve') {
      if (!options.id) {
        throw new CliError('MISSING_REQUIRED_FLAG', 'Missing lifecycle id. Use --id <id>.');
      }
      if (!options.confirm) {
        throw new CliError('MISSING_REQUIRED_FLAG', 'lifecycle resolve requires --confirm.');
      }
      if (options.configPath) {
        throw new CliError('INVALID_ARGS', 'lifecycle resolve does not accept --config.');
      }
    }

    return options;
  };
}

module.exports = {
  createParseLifecycleFlags,
};
