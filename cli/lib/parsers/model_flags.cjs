function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`Model parser factory requires deps.${name}()`);
  }
  return deps[name];
}

function normalizeCopulaFamily(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function parseNumericCsv(rawValue, flagName, parseCsvList, parseNumber) {
  return parseCsvList(rawValue, flagName).map((item) => parseNumber(item, flagName));
}

function parseSeriesArg(rawValue, parseCsvList, parseNumber, CliError) {
  const text = String(rawValue || '').trim();
  const sep = text.indexOf(':');
  if (sep <= 0 || sep === text.length - 1) {
    throw new CliError(
      'INVALID_FLAG_VALUE',
      '--series must use format <id>:v1,v2,... (example: --series btc:0.01,-0.02,0.03).',
    );
  }

  const id = text.slice(0, sep).trim();
  if (!id) {
    throw new CliError('INVALID_FLAG_VALUE', '--series id cannot be empty.');
  }

  const valuesText = text.slice(sep + 1);
  const values = parseNumericCsv(valuesText, '--series', parseCsvList, parseNumber);
  if (values.length < 3) {
    throw new CliError('INVALID_FLAG_VALUE', `--series ${id} must include at least 3 numeric observations.`);
  }

  return { id, values };
}

function createParseModelCalibrateFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parseNumber = requireDep(deps, 'parseNumber');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parseCsvList = requireDep(deps, 'parseCsvList');

  return function parseModelCalibrateFlags(args) {
    const options = {
      prices: null,
      returns: null,
      dt: 1,
      jumpThresholdSigma: 2.5,
      minJumpCount: 2,
      modelId: null,
      saveModel: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--prices') {
        options.prices = parseCsvList(requireFlagValue(args, i, '--prices'), '--prices').map((item) =>
          parsePositiveNumber(item, '--prices'),
        );
        i += 1;
        continue;
      }
      if (token === '--returns') {
        options.returns = parseNumericCsv(requireFlagValue(args, i, '--returns'), '--returns', parseCsvList, parseNumber);
        i += 1;
        continue;
      }
      if (token === '--dt') {
        options.dt = parsePositiveNumber(requireFlagValue(args, i, '--dt'), '--dt');
        i += 1;
        continue;
      }
      if (token === '--jump-threshold-sigma') {
        options.jumpThresholdSigma = parsePositiveNumber(
          requireFlagValue(args, i, '--jump-threshold-sigma'),
          '--jump-threshold-sigma',
        );
        i += 1;
        continue;
      }
      if (token === '--min-jump-count') {
        options.minJumpCount = parsePositiveInteger(requireFlagValue(args, i, '--min-jump-count'), '--min-jump-count');
        i += 1;
        continue;
      }
      if (token === '--model-id') {
        options.modelId = String(requireFlagValue(args, i, '--model-id')).trim();
        i += 1;
        continue;
      }
      if (token === '--save-model') {
        options.saveModel = String(requireFlagValue(args, i, '--save-model')).trim();
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for model calibrate: ${token}`);
    }

    if (options.prices && options.returns) {
      throw new CliError('INVALID_ARGS', 'Use either --prices or --returns, not both.');
    }
    if (!options.prices && !options.returns) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'model calibrate requires --prices <csv> or --returns <csv>.');
    }
    if (options.prices && options.prices.length < 3) {
      throw new CliError('INVALID_FLAG_VALUE', '--prices must include at least 3 observations.');
    }
    if (options.returns && options.returns.length < 3) {
      throw new CliError('INVALID_FLAG_VALUE', '--returns must include at least 3 observations.');
    }
    if (!options.modelId) {
      options.modelId = null;
    }
    if (!options.saveModel) {
      options.saveModel = null;
    }

    return options;
  };
}

function createParseModelCorrelationFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parseNumber = requireDep(deps, 'parseNumber');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parseCsvList = requireDep(deps, 'parseCsvList');

  return function parseModelCorrelationFlags(args) {
    const options = {
      series: [],
      copula: 't',
      compare: [],
      tailAlpha: 0.05,
      degreesOfFreedom: null,
      jointThresholdZ: -1.5,
      scenarioShocks: [-0.05, -0.1, -0.2],
      modelId: null,
      saveModel: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--series') {
        options.series.push(
          parseSeriesArg(requireFlagValue(args, i, '--series'), parseCsvList, parseNumber, CliError),
        );
        i += 1;
        continue;
      }
      if (token === '--copula') {
        options.copula = normalizeCopulaFamily(requireFlagValue(args, i, '--copula'));
        i += 1;
        continue;
      }
      if (token === '--compare') {
        const families = parseCsvList(requireFlagValue(args, i, '--compare'), '--compare').map(normalizeCopulaFamily);
        options.compare = Array.from(new Set([...options.compare, ...families]));
        i += 1;
        continue;
      }
      if (token === '--tail-alpha') {
        options.tailAlpha = parsePositiveNumber(requireFlagValue(args, i, '--tail-alpha'), '--tail-alpha');
        i += 1;
        continue;
      }
      if (token === '--df') {
        options.degreesOfFreedom = parsePositiveNumber(requireFlagValue(args, i, '--df'), '--df');
        i += 1;
        continue;
      }
      if (token === '--joint-threshold-z') {
        options.jointThresholdZ = parseNumber(requireFlagValue(args, i, '--joint-threshold-z'), '--joint-threshold-z');
        i += 1;
        continue;
      }
      if (token === '--scenario-shocks') {
        options.scenarioShocks = parseNumericCsv(
          requireFlagValue(args, i, '--scenario-shocks'),
          '--scenario-shocks',
          parseCsvList,
          parseNumber,
        );
        i += 1;
        continue;
      }
      if (token === '--model-id') {
        options.modelId = String(requireFlagValue(args, i, '--model-id')).trim();
        i += 1;
        continue;
      }
      if (token === '--save-model') {
        options.saveModel = String(requireFlagValue(args, i, '--save-model')).trim();
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for model correlation: ${token}`);
    }

    const supportedFamilies = new Set(['t', 'gaussian', 'clayton', 'gumbel']);
    if (!supportedFamilies.has(options.copula)) {
      throw new CliError('INVALID_FLAG_VALUE', '--copula must be one of: t, gaussian, clayton, gumbel.');
    }

    if (options.series.length < 2) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'model correlation requires at least two --series flags.');
    }

    const seenIds = new Set();
    for (const item of options.series) {
      if (seenIds.has(item.id)) {
        throw new CliError('INVALID_ARGS', `Duplicate --series id: ${item.id}`);
      }
      seenIds.add(item.id);
    }

    const expectedLength = options.series[0].values.length;
    for (const item of options.series) {
      if (item.values.length !== expectedLength) {
        throw new CliError('INVALID_ARGS', 'All --series inputs must have the same number of observations.');
      }
    }

    if (!Number.isFinite(options.tailAlpha) || options.tailAlpha <= 0 || options.tailAlpha >= 0.5) {
      throw new CliError('INVALID_FLAG_VALUE', '--tail-alpha must be > 0 and < 0.5.');
    }

    if (options.degreesOfFreedom !== null && options.degreesOfFreedom <= 2) {
      throw new CliError('INVALID_FLAG_VALUE', '--df must be greater than 2 for t-copula stability.');
    }

    if (!Array.isArray(options.scenarioShocks) || options.scenarioShocks.length === 0) {
      throw new CliError('INVALID_FLAG_VALUE', '--scenario-shocks must include at least one numeric value.');
    }

    options.compare = options.compare.filter((family) => supportedFamilies.has(family) && family !== options.copula);
    options.compare = Array.from(new Set(options.compare));

    if (!options.modelId) {
      options.modelId = null;
    }
    if (!options.saveModel) {
      options.saveModel = null;
    }

    return options;
  };
}

function createParseModelDiagnoseFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parseNumber = requireDep(deps, 'parseNumber');

  function parseRatio(value, flagName) {
    const numeric = parseNumber(value, flagName);
    if (numeric < 0 || numeric > 1) {
      throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be between 0 and 1.`);
    }
    return numeric;
  }

  function parseNonNegative(value, flagName) {
    const numeric = parseNumber(value, flagName);
    if (numeric < 0) {
      throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be >= 0.`);
    }
    return numeric;
  }

  return function parseModelDiagnoseFlags(args) {
    const options = {};

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--calibration-rmse') {
        options.calibrationRmse = parseNonNegative(requireFlagValue(args, i, '--calibration-rmse'), '--calibration-rmse');
        i += 1;
        continue;
      }
      if (token === '--drift-bps') {
        options.driftBps = parseNonNegative(requireFlagValue(args, i, '--drift-bps'), '--drift-bps');
        i += 1;
        continue;
      }
      if (token === '--spread-bps') {
        options.spreadBps = parseNonNegative(requireFlagValue(args, i, '--spread-bps'), '--spread-bps');
        i += 1;
        continue;
      }
      if (token === '--depth-coverage') {
        options.depthCoverage = parseRatio(requireFlagValue(args, i, '--depth-coverage'), '--depth-coverage');
        i += 1;
        continue;
      }
      if (token === '--informed-flow-ratio') {
        options.informedFlowRatio = parseRatio(
          requireFlagValue(args, i, '--informed-flow-ratio'),
          '--informed-flow-ratio',
        );
        i += 1;
        continue;
      }
      if (token === '--noise-ratio') {
        options.noiseRatio = parseRatio(requireFlagValue(args, i, '--noise-ratio'), '--noise-ratio');
        i += 1;
        continue;
      }
      if (token === '--anomaly-rate') {
        options.anomalyRate = parseRatio(requireFlagValue(args, i, '--anomaly-rate'), '--anomaly-rate');
        i += 1;
        continue;
      }
      if (token === '--manipulation-alerts') {
        const alerts = parseNumber(requireFlagValue(args, i, '--manipulation-alerts'), '--manipulation-alerts');
        if (!Number.isInteger(alerts) || alerts < 0) {
          throw new CliError('INVALID_FLAG_VALUE', '--manipulation-alerts must be a non-negative integer.');
        }
        options.manipulationAlerts = alerts;
        i += 1;
        continue;
      }
      if (token === '--tail-dependence') {
        options.tailDependence = parseRatio(requireFlagValue(args, i, '--tail-dependence'), '--tail-dependence');
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for model diagnose: ${token}`);
    }

    return options;
  };
}

function createParseModelScoreBrierFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');

  return function parseModelScoreBrierFlags(args) {
    const options = {
      source: null,
      marketAddress: null,
      competition: null,
      eventId: null,
      modelId: null,
      groupBy: 'source',
      windowDays: null,
      bucketCount: 10,
      includeRecords: false,
      forecastFile: null,
      includeUnresolved: false,
      limit: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--source') {
        options.source = String(requireFlagValue(args, i, '--source')).trim() || null;
        i += 1;
        continue;
      }
      if (token === '--market-address') {
        options.marketAddress = String(requireFlagValue(args, i, '--market-address')).trim() || null;
        i += 1;
        continue;
      }
      if (token === '--competition') {
        options.competition = String(requireFlagValue(args, i, '--competition')).trim() || null;
        i += 1;
        continue;
      }
      if (token === '--event-id') {
        options.eventId = String(requireFlagValue(args, i, '--event-id')).trim() || null;
        i += 1;
        continue;
      }
      if (token === '--model-id') {
        options.modelId = String(requireFlagValue(args, i, '--model-id')).trim() || null;
        i += 1;
        continue;
      }
      if (token === '--group-by') {
        options.groupBy = String(requireFlagValue(args, i, '--group-by')).trim().toLowerCase();
        i += 1;
        continue;
      }
      if (token === '--window-days') {
        options.windowDays = parsePositiveInteger(requireFlagValue(args, i, '--window-days'), '--window-days');
        i += 1;
        continue;
      }
      if (token === '--bucket-count') {
        options.bucketCount = parsePositiveInteger(requireFlagValue(args, i, '--bucket-count'), '--bucket-count');
        i += 1;
        continue;
      }
      if (token === '--forecast-file' || token === '--brier-file') {
        options.forecastFile = String(requireFlagValue(args, i, token)).trim() || null;
        i += 1;
        continue;
      }
      if (token === '--include-records') {
        options.includeRecords = true;
        continue;
      }
      if (token === '--include-unresolved') {
        options.includeUnresolved = true;
        continue;
      }
      if (token === '--limit') {
        options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for model score brier: ${token}`);
    }

    const allowedGroupBy = new Set(['source', 'market', 'competition', 'model', 'none', 'all']);
    if (!allowedGroupBy.has(options.groupBy)) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        '--group-by must be one of: source, market, competition, model, none, all.',
      );
    }
    if (options.bucketCount < 1 || options.bucketCount > 100) {
      throw new CliError('INVALID_FLAG_VALUE', '--bucket-count must be between 1 and 100.');
    }

    return options;
  };
}

module.exports = {
  createParseModelCalibrateFlags,
  createParseModelCorrelationFlags,
  createParseModelDiagnoseFlags,
  createParseModelScoreBrierFlags,
};
