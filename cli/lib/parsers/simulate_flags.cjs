const path = require('path');

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`simulate parser factory requires deps.${name}()`);
  }
  return deps[name];
}

function isMcpMode() {
  return String(process.env.PANDORA_MCP_MODE || '').trim() === '1';
}

function isPathInside(baseDir, candidatePath) {
  const relative = path.relative(baseDir, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertMcpReadablePathAllowed(rawPath, CliError) {
  if (!isMcpMode()) return;
  const workspaceRoot = path.resolve(process.cwd());
  const resolvedPath = path.resolve(String(rawPath || ''));
  if (isPathInside(workspaceRoot, resolvedPath)) {
    return;
  }

  throw new CliError(
    'MCP_FILE_ACCESS_BLOCKED',
    '--input must point to a file within the current workspace when running via MCP.',
    {
      flag: '--input',
      requestedPath: rawPath,
      resolvedPath,
      workspaceRoot,
    },
  );
}

function createParseSimulateMcFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parseProbabilityPercent = requireDep(deps, 'parseProbabilityPercent');
  const parseNumber = requireDep(deps, 'parseNumber');
  const parseOutcomeSide = requireDep(deps, 'parseOutcomeSide');
  const parseNonNegativeInteger = requireDep(deps, 'parseNonNegativeInteger');

  return function parseSimulateMcFlags(args) {
    const options = {
      trials: 5_000,
      horizon: 64,
      startYesPct: 50,
      entryYesPct: null,
      positionSide: 'yes',
      stakeUsdc: 100,
      driftBps: 0,
      volBps: 150,
      confidencePct: 95,
      varLevelPct: 95,
      antithetic: false,
      stratified: false,
      seed: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--trials') {
        options.trials = parsePositiveInteger(requireFlagValue(args, i, '--trials'), '--trials');
        i += 1;
        continue;
      }
      if (token === '--horizon') {
        options.horizon = parsePositiveInteger(requireFlagValue(args, i, '--horizon'), '--horizon');
        i += 1;
        continue;
      }
      if (token === '--start-yes-pct') {
        options.startYesPct = parseProbabilityPercent(requireFlagValue(args, i, '--start-yes-pct'), '--start-yes-pct');
        i += 1;
        continue;
      }
      if (token === '--entry-yes-pct') {
        options.entryYesPct = parseProbabilityPercent(requireFlagValue(args, i, '--entry-yes-pct'), '--entry-yes-pct');
        i += 1;
        continue;
      }
      if (token === '--position') {
        options.positionSide = parseOutcomeSide(requireFlagValue(args, i, '--position'), '--position');
        i += 1;
        continue;
      }
      if (token === '--stake-usdc') {
        options.stakeUsdc = parsePositiveNumber(requireFlagValue(args, i, '--stake-usdc'), '--stake-usdc');
        i += 1;
        continue;
      }
      if (token === '--drift-bps') {
        options.driftBps = parseNumber(requireFlagValue(args, i, '--drift-bps'), '--drift-bps');
        i += 1;
        continue;
      }
      if (token === '--vol-bps') {
        options.volBps = parsePositiveNumber(requireFlagValue(args, i, '--vol-bps'), '--vol-bps');
        i += 1;
        continue;
      }
      if (token === '--confidence') {
        options.confidencePct = parseProbabilityPercent(requireFlagValue(args, i, '--confidence'), '--confidence');
        i += 1;
        continue;
      }
      if (token === '--var-level') {
        options.varLevelPct = parseProbabilityPercent(requireFlagValue(args, i, '--var-level'), '--var-level');
        i += 1;
        continue;
      }
      if (token === '--seed') {
        options.seed = parseNonNegativeInteger(requireFlagValue(args, i, '--seed'), '--seed');
        i += 1;
        continue;
      }
      if (token === '--antithetic') {
        options.antithetic = true;
        continue;
      }
      if (token === '--stratified') {
        options.stratified = true;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for simulate mc: ${token}`);
    }

    if (options.entryYesPct === null) {
      options.entryYesPct = options.startYesPct;
    }

    if (options.trials > 250_000) {
      throw new CliError('INVALID_FLAG_VALUE', '--trials must be <= 250000.');
    }

    if (options.horizon > 10_000) {
      throw new CliError('INVALID_FLAG_VALUE', '--horizon must be <= 10000.');
    }

    if (options.confidencePct <= 50 || options.confidencePct >= 100) {
      throw new CliError('INVALID_FLAG_VALUE', '--confidence must be > 50 and < 100.');
    }

    if (options.varLevelPct <= 50 || options.varLevelPct >= 100) {
      throw new CliError('INVALID_FLAG_VALUE', '--var-level must be > 50 and < 100.');
    }

    return options;
  };
}

function createParseSimulateParticleFilterFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parseProbabilityPercent = requireDep(deps, 'parseProbabilityPercent');
  const parseNumber = requireDep(deps, 'parseNumber');
  const parseNonNegativeInteger = requireDep(deps, 'parseNonNegativeInteger');

  return function parseSimulateParticleFilterFlags(args) {
    const options = {
      observationsJson: null,
      inputFile: null,
      readFromStdin: false,
      particles: 1_000,
      processNoise: 0.12,
      observationNoise: 0.08,
      driftBps: 0,
      initialYesPct: 50,
      initialSpread: 0.4,
      resampleThreshold: 0.5,
      resampleMethod: 'systematic',
      credibleIntervalPct: 90,
      seed: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--observations-json') {
        options.observationsJson = requireFlagValue(args, i, '--observations-json');
        i += 1;
        continue;
      }
      if (token === '--input' || token === '--input-file') {
        const value = requireFlagValue(args, i, token);
        if (value === '-') {
          options.readFromStdin = true;
          options.inputFile = null;
        } else {
          assertMcpReadablePathAllowed(value, CliError);
          options.inputFile = path.resolve(value);
          options.readFromStdin = false;
        }
        i += 1;
        continue;
      }
      if (token === '--stdin') {
        options.readFromStdin = true;
        options.inputFile = null;
        continue;
      }
      if (token === '--particles') {
        options.particles = parsePositiveInteger(requireFlagValue(args, i, '--particles'), '--particles');
        i += 1;
        continue;
      }
      if (token === '--process-noise') {
        options.processNoise = parsePositiveNumber(requireFlagValue(args, i, '--process-noise'), '--process-noise');
        i += 1;
        continue;
      }
      if (token === '--observation-noise') {
        options.observationNoise = parsePositiveNumber(
          requireFlagValue(args, i, '--observation-noise'),
          '--observation-noise',
        );
        i += 1;
        continue;
      }
      if (token === '--drift-bps') {
        options.driftBps = parseNumber(requireFlagValue(args, i, '--drift-bps'), '--drift-bps');
        i += 1;
        continue;
      }
      if (token === '--initial-yes-pct') {
        options.initialYesPct = parseProbabilityPercent(
          requireFlagValue(args, i, '--initial-yes-pct'),
          '--initial-yes-pct',
        );
        i += 1;
        continue;
      }
      if (token === '--initial-spread') {
        options.initialSpread = parsePositiveNumber(requireFlagValue(args, i, '--initial-spread'), '--initial-spread');
        i += 1;
        continue;
      }
      if (token === '--resample-threshold') {
        options.resampleThreshold = parseNumber(requireFlagValue(args, i, '--resample-threshold'), '--resample-threshold');
        i += 1;
        continue;
      }
      if (token === '--resample-method') {
        options.resampleMethod = String(requireFlagValue(args, i, '--resample-method')).trim().toLowerCase();
        i += 1;
        continue;
      }
      if (token === '--credible-interval') {
        options.credibleIntervalPct = parseProbabilityPercent(
          requireFlagValue(args, i, '--credible-interval'),
          '--credible-interval',
        );
        i += 1;
        continue;
      }
      if (token === '--seed') {
        options.seed = parseNonNegativeInteger(requireFlagValue(args, i, '--seed'), '--seed');
        i += 1;
        continue;
      }

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for simulate particle-filter: ${token}`);
    }

    const sourceCount = Number(Boolean(options.observationsJson)) + Number(Boolean(options.inputFile)) + Number(options.readFromStdin);
    if (sourceCount === 0) {
      throw new CliError(
        'MISSING_REQUIRED_FLAG',
        'simulate particle-filter requires one input source: --observations-json <json>, --input <path>, or --stdin.',
      );
    }

    if (sourceCount > 1) {
      throw new CliError(
        'INVALID_ARGS',
        'Provide only one observation source for simulate particle-filter: --observations-json, --input, or --stdin.',
      );
    }

    if (options.particles > 100_000) {
      throw new CliError('INVALID_FLAG_VALUE', '--particles must be <= 100000.');
    }

    if (options.resampleThreshold <= 0 || options.resampleThreshold >= 1) {
      throw new CliError('INVALID_FLAG_VALUE', '--resample-threshold must be > 0 and < 1.');
    }

    if (!['systematic', 'multinomial'].includes(options.resampleMethod)) {
      throw new CliError('INVALID_FLAG_VALUE', '--resample-method must be systematic or multinomial.');
    }

    if (options.credibleIntervalPct <= 50 || options.credibleIntervalPct >= 100) {
      throw new CliError('INVALID_FLAG_VALUE', '--credible-interval must be > 50 and < 100.');
    }

    return options;
  };
}

module.exports = {
  createParseSimulateMcFlags,
  createParseSimulateParticleFilterFlags,
};
