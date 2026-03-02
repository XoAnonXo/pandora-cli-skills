const { MIN_AMM_FEE_TIER, MAX_AMM_FEE_TIER } = require('../shared/constants.cjs');

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`mirror remaining parser requires deps.${name}()`);
  }
  return deps[name];
}

function parseDefaultIndexerTimeoutMs(deps) {
  const value = deps && Number.isFinite(deps.defaultIndexerTimeoutMs) ? Number(deps.defaultIndexerTimeoutMs) : 60_000;
  return value > 0 ? value : 60_000;
}

/**
 * Creates the mirror browse parser.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseMirrorBrowseFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parseProbabilityPercent = requireDep(deps, 'parseProbabilityPercent');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parseDateLikeFlag = requireDep(deps, 'parseDateLikeFlag');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parseInteger = requireDep(deps, 'parseInteger');

  return function parseMirrorBrowseFlags(args) {
    const options = {
      minYesPct: null,
      maxYesPct: null,
      minVolume24h: 0,
      closesAfter: null,
      closesBefore: null,
      questionContains: null,
      limit: 10,
      chainId: null,
      polymarketGammaUrl: null,
      polymarketGammaMockUrl: null,
      polymarketMockUrl: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--min-yes-pct') {
        options.minYesPct = parseProbabilityPercent(requireFlagValue(args, i, '--min-yes-pct'), '--min-yes-pct');
        i += 1;
        continue;
      }
      if (token === '--max-yes-pct') {
        options.maxYesPct = parseProbabilityPercent(requireFlagValue(args, i, '--max-yes-pct'), '--max-yes-pct');
        i += 1;
        continue;
      }
      if (token === '--min-volume-24h') {
        options.minVolume24h = parsePositiveNumber(requireFlagValue(args, i, '--min-volume-24h'), '--min-volume-24h');
        i += 1;
        continue;
      }
      if (token === '--closes-after') {
        options.closesAfter = parseDateLikeFlag(requireFlagValue(args, i, '--closes-after'), '--closes-after');
        i += 1;
        continue;
      }
      if (token === '--closes-before') {
        options.closesBefore = parseDateLikeFlag(requireFlagValue(args, i, '--closes-before'), '--closes-before');
        i += 1;
        continue;
      }
      if (token === '--question-contains') {
        options.questionContains = requireFlagValue(args, i, '--question-contains');
        i += 1;
        continue;
      }
      if (token === '--limit') {
        options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
        i += 1;
        continue;
      }
      if (token === '--chain-id') {
        options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
        i += 1;
        continue;
      }
      if (token === '--polymarket-gamma-url') {
        options.polymarketGammaUrl = requireFlagValue(args, i, '--polymarket-gamma-url');
        i += 1;
        continue;
      }
      if (token === '--polymarket-gamma-mock-url') {
        options.polymarketGammaMockUrl = requireFlagValue(args, i, '--polymarket-gamma-mock-url');
        i += 1;
        continue;
      }
      if (token === '--polymarket-mock-url') {
        options.polymarketMockUrl = requireFlagValue(args, i, '--polymarket-mock-url');
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror browse: ${token}`);
    }

    if (options.minYesPct !== null && options.maxYesPct !== null && options.minYesPct > options.maxYesPct) {
      throw new CliError('INVALID_ARGS', '--min-yes-pct cannot be greater than --max-yes-pct.');
    }

    return options;
  };
}

/**
 * Creates the mirror verify parser.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseMirrorVerifyFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');

  return function parseMirrorVerifyFlags(args) {
    const options = {
      pandoraMarketAddress: null,
      polymarketMarketId: null,
      polymarketSlug: null,
      includeSimilarity: false,
      withRules: false,
      allowRuleMismatch: false,
      trustDeploy: false,
      manifestFile: null,
      polymarketHost: null,
      polymarketGammaUrl: null,
      polymarketGammaMockUrl: null,
      polymarketMockUrl: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--pandora-market-address' || token === '--market-address') {
        options.pandoraMarketAddress = parseAddressFlag(requireFlagValue(args, i, token), token);
        i += 1;
        continue;
      }
      if (token === '--polymarket-market-id') {
        options.polymarketMarketId = requireFlagValue(args, i, '--polymarket-market-id');
        i += 1;
        continue;
      }
      if (token === '--polymarket-slug') {
        options.polymarketSlug = requireFlagValue(args, i, '--polymarket-slug');
        i += 1;
        continue;
      }
      if (token === '--include-similarity') {
        options.includeSimilarity = true;
        continue;
      }
      if (token === '--with-rules') {
        options.withRules = true;
        continue;
      }
      if (token === '--allow-rule-mismatch') {
        options.allowRuleMismatch = true;
        continue;
      }
      if (token === '--trust-deploy') {
        options.trustDeploy = true;
        continue;
      }
      if (token === '--manifest-file') {
        options.manifestFile = requireFlagValue(args, i, '--manifest-file');
        i += 1;
        continue;
      }
      if (token === '--polymarket-host') {
        options.polymarketHost = requireFlagValue(args, i, '--polymarket-host');
        i += 1;
        continue;
      }
      if (token === '--polymarket-gamma-url') {
        options.polymarketGammaUrl = requireFlagValue(args, i, '--polymarket-gamma-url');
        i += 1;
        continue;
      }
      if (token === '--polymarket-gamma-mock-url') {
        options.polymarketGammaMockUrl = requireFlagValue(args, i, '--polymarket-gamma-mock-url');
        i += 1;
        continue;
      }
      if (token === '--polymarket-mock-url') {
        options.polymarketMockUrl = requireFlagValue(args, i, '--polymarket-mock-url');
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror verify: ${token}`);
    }

    if (!options.pandoraMarketAddress) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing --pandora-market-address <address> (alias: --market-address).');
    }
    if (!options.polymarketMarketId && !options.polymarketSlug) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'mirror verify requires --polymarket-market-id <id> or --polymarket-slug <slug>.');
    }

    return options;
  };
}

/**
 * Creates the mirror status parser.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseMirrorStatusFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const defaultIndexerTimeoutMs = parseDefaultIndexerTimeoutMs(deps);

  return function parseMirrorStatusFlags(args) {
    const options = {
      stateFile: null,
      strategyHash: null,
      withLive: false,
      trustDeploy: false,
      manifestFile: null,
      pandoraMarketAddress: null,
      polymarketMarketId: null,
      polymarketSlug: null,
      driftTriggerBps: 150,
      hedgeTriggerUsdc: 10,
      indexerUrl: null,
      timeoutMs: defaultIndexerTimeoutMs,
      polymarketHost: null,
      polymarketGammaUrl: null,
      polymarketGammaMockUrl: null,
      polymarketMockUrl: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--state-file') {
        options.stateFile = requireFlagValue(args, i, '--state-file');
        i += 1;
        continue;
      }
      if (token === '--strategy-hash') {
        const value = requireFlagValue(args, i, '--strategy-hash');
        if (!/^[a-f0-9]{16}$/i.test(value)) {
          throw new CliError('INVALID_FLAG_VALUE', '--strategy-hash must be a 16-character hex value.');
        }
        options.strategyHash = value.toLowerCase();
        i += 1;
        continue;
      }
      if (token === '--with-live') {
        options.withLive = true;
        continue;
      }
      if (token === '--trust-deploy') {
        options.trustDeploy = true;
        continue;
      }
      if (token === '--manifest-file') {
        options.manifestFile = requireFlagValue(args, i, '--manifest-file');
        i += 1;
        continue;
      }
      if (token === '--pandora-market-address' || token === '--market-address') {
        options.pandoraMarketAddress = parseAddressFlag(requireFlagValue(args, i, token), token);
        i += 1;
        continue;
      }
      if (token === '--polymarket-market-id') {
        options.polymarketMarketId = requireFlagValue(args, i, '--polymarket-market-id');
        i += 1;
        continue;
      }
      if (token === '--polymarket-slug') {
        options.polymarketSlug = requireFlagValue(args, i, '--polymarket-slug');
        i += 1;
        continue;
      }
      if (token === '--drift-trigger-bps') {
        options.driftTriggerBps = parsePositiveInteger(requireFlagValue(args, i, '--drift-trigger-bps'), '--drift-trigger-bps');
        i += 1;
        continue;
      }
      if (token === '--hedge-trigger-usdc') {
        options.hedgeTriggerUsdc = parsePositiveNumber(requireFlagValue(args, i, '--hedge-trigger-usdc'), '--hedge-trigger-usdc');
        i += 1;
        continue;
      }
      if (token === '--indexer-url') {
        options.indexerUrl = requireFlagValue(args, i, '--indexer-url');
        i += 1;
        continue;
      }
      if (token === '--timeout-ms') {
        options.timeoutMs = parsePositiveInteger(requireFlagValue(args, i, '--timeout-ms'), '--timeout-ms');
        i += 1;
        continue;
      }
      if (token === '--polymarket-host') {
        options.polymarketHost = requireFlagValue(args, i, '--polymarket-host');
        i += 1;
        continue;
      }
      if (token === '--polymarket-gamma-url') {
        options.polymarketGammaUrl = requireFlagValue(args, i, '--polymarket-gamma-url');
        i += 1;
        continue;
      }
      if (token === '--polymarket-gamma-mock-url') {
        options.polymarketGammaMockUrl = requireFlagValue(args, i, '--polymarket-gamma-mock-url');
        i += 1;
        continue;
      }
      if (token === '--polymarket-mock-url') {
        options.polymarketMockUrl = requireFlagValue(args, i, '--polymarket-mock-url');
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror status: ${token}`);
    }

    if (!options.stateFile && !options.strategyHash) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'mirror status requires --state-file <path> or --strategy-hash <hash>.');
    }

    return options;
  };
}

/**
 * Creates the mirror close parser.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseMirrorCloseFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');

  return function parseMirrorCloseFlags(args) {
    const options = {
      pandoraMarketAddress: null,
      polymarketMarketId: null,
      polymarketSlug: null,
      execute: false,
      dryRun: false,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--pandora-market-address' || token === '--market-address') {
        options.pandoraMarketAddress = parseAddressFlag(requireFlagValue(args, i, token), token);
        i += 1;
        continue;
      }
      if (token === '--polymarket-market-id') {
        options.polymarketMarketId = requireFlagValue(args, i, '--polymarket-market-id');
        i += 1;
        continue;
      }
      if (token === '--polymarket-slug') {
        options.polymarketSlug = requireFlagValue(args, i, '--polymarket-slug');
        i += 1;
        continue;
      }
      if (token === '--dry-run') {
        options.dryRun = true;
        continue;
      }
      if (token === '--execute') {
        options.execute = true;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror close: ${token}`);
    }

    if (!options.pandoraMarketAddress) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing --pandora-market-address <address> (alias: --market-address).');
    }
    if (!options.polymarketMarketId && !options.polymarketSlug) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'mirror close requires --polymarket-market-id <id> or --polymarket-slug <slug>.');
    }
    if (options.dryRun === options.execute) {
      throw new CliError('INVALID_ARGS', 'mirror close requires exactly one mode: --dry-run or --execute.');
    }

    return options;
  };
}

/**
 * Creates the mirror lp-explain parser.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseMirrorLpExplainFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parseProbabilityPercent = requireDep(deps, 'parseProbabilityPercent');
  const parseNonNegativeInteger = requireDep(deps, 'parseNonNegativeInteger');

  return function parseMirrorLpExplainFlags(args) {
    const options = {
      liquidityUsdc: null,
      sourceYesPct: null,
      distributionYes: null,
      distributionNo: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--liquidity-usdc') {
        options.liquidityUsdc = parsePositiveNumber(requireFlagValue(args, i, '--liquidity-usdc'), '--liquidity-usdc');
        i += 1;
        continue;
      }
      if (token === '--source-yes-pct') {
        options.sourceYesPct = parseProbabilityPercent(requireFlagValue(args, i, '--source-yes-pct'), '--source-yes-pct');
        i += 1;
        continue;
      }
      if (token === '--distribution-yes') {
        options.distributionYes = parseNonNegativeInteger(requireFlagValue(args, i, '--distribution-yes'), '--distribution-yes');
        i += 1;
        continue;
      }
      if (token === '--distribution-no') {
        options.distributionNo = parseNonNegativeInteger(requireFlagValue(args, i, '--distribution-no'), '--distribution-no');
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror lp-explain: ${token}`);
    }

    if (options.liquidityUsdc === null) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'mirror lp-explain requires --liquidity-usdc <n>.');
    }
    if (
      (options.distributionYes === null && options.distributionNo !== null) ||
      (options.distributionYes !== null && options.distributionNo === null)
    ) {
      throw new CliError('INVALID_ARGS', 'Provide both --distribution-yes and --distribution-no together.');
    }
    if (
      options.distributionYes !== null &&
      options.distributionNo !== null &&
      options.distributionYes + options.distributionNo !== 1_000_000_000
    ) {
      throw new CliError('INVALID_ARGS', '--distribution-yes + --distribution-no must equal 1000000000.');
    }

    return options;
  };
}

/**
 * Creates the mirror simulate parser.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseMirrorSimulateFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parseProbabilityPercent = requireDep(deps, 'parseProbabilityPercent');
  const parseNonNegativeInteger = requireDep(deps, 'parseNonNegativeInteger');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parseInteger = requireDep(deps, 'parseInteger');
  const parseCsvNumberList = requireDep(deps, 'parseCsvNumberList');

  return function parseMirrorSimulateFlags(args) {
    const options = {
      liquidityUsdc: null,
      sourceYesPct: null,
      targetYesPct: null,
      polymarketYesPct: null,
      distributionYes: null,
      distributionNo: null,
      feeTier: 3000,
      hedgeRatio: 1,
      hedgeCostBps: 35,
      volumeScenarios: null,
      engine: 'linear',
      paths: 2000,
      steps: 48,
      seed: 42,
      importanceSampling: false,
      antithetic: false,
      controlVariate: false,
      stratified: false,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--liquidity-usdc') {
        options.liquidityUsdc = parsePositiveNumber(requireFlagValue(args, i, '--liquidity-usdc'), '--liquidity-usdc');
        i += 1;
        continue;
      }
      if (token === '--source-yes-pct') {
        options.sourceYesPct = parseProbabilityPercent(requireFlagValue(args, i, '--source-yes-pct'), '--source-yes-pct');
        i += 1;
        continue;
      }
      if (token === '--target-yes-pct') {
        options.targetYesPct = parseProbabilityPercent(requireFlagValue(args, i, '--target-yes-pct'), '--target-yes-pct');
        i += 1;
        continue;
      }
      if (token === '--polymarket-yes-pct') {
        options.polymarketYesPct = parseProbabilityPercent(requireFlagValue(args, i, '--polymarket-yes-pct'), '--polymarket-yes-pct');
        i += 1;
        continue;
      }
      if (token === '--distribution-yes') {
        options.distributionYes = parseNonNegativeInteger(requireFlagValue(args, i, '--distribution-yes'), '--distribution-yes');
        i += 1;
        continue;
      }
      if (token === '--distribution-no') {
        options.distributionNo = parseNonNegativeInteger(requireFlagValue(args, i, '--distribution-no'), '--distribution-no');
        i += 1;
        continue;
      }
      if (token === '--fee-tier') {
        options.feeTier = parsePositiveInteger(requireFlagValue(args, i, '--fee-tier'), '--fee-tier');
        i += 1;
        continue;
      }
      if (token === '--hedge-ratio') {
        options.hedgeRatio = parsePositiveNumber(requireFlagValue(args, i, '--hedge-ratio'), '--hedge-ratio');
        i += 1;
        continue;
      }
      if (token === '--hedge-cost-bps') {
        options.hedgeCostBps = parseNonNegativeInteger(requireFlagValue(args, i, '--hedge-cost-bps'), '--hedge-cost-bps');
        i += 1;
        continue;
      }
      if (token === '--volume-scenarios') {
        options.volumeScenarios = parseCsvNumberList(requireFlagValue(args, i, '--volume-scenarios'), '--volume-scenarios');
        i += 1;
        continue;
      }
      if (token === '--engine') {
        const engine = String(requireFlagValue(args, i, '--engine') || '')
          .trim()
          .toLowerCase();
        if (engine !== 'linear' && engine !== 'mc') {
          throw new CliError('INVALID_FLAG_VALUE', '--engine must be linear or mc.');
        }
        options.engine = engine;
        i += 1;
        continue;
      }
      if (token === '--paths') {
        options.paths = parsePositiveInteger(requireFlagValue(args, i, '--paths'), '--paths');
        i += 1;
        continue;
      }
      if (token === '--steps') {
        options.steps = parsePositiveInteger(requireFlagValue(args, i, '--steps'), '--steps');
        i += 1;
        continue;
      }
      if (token === '--seed') {
        options.seed = parseInteger(requireFlagValue(args, i, '--seed'), '--seed');
        i += 1;
        continue;
      }
      if (token === '--importance-sampling') {
        options.importanceSampling = true;
        continue;
      }
      if (token === '--antithetic') {
        options.antithetic = true;
        continue;
      }
      if (token === '--control-variate') {
        options.controlVariate = true;
        continue;
      }
      if (token === '--stratified') {
        options.stratified = true;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror simulate: ${token}`);
    }

    if (options.liquidityUsdc === null) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'mirror simulate requires --liquidity-usdc <n>.');
    }
    if (
      (options.distributionYes === null && options.distributionNo !== null) ||
      (options.distributionYes !== null && options.distributionNo === null)
    ) {
      throw new CliError('INVALID_ARGS', 'Provide both --distribution-yes and --distribution-no together.');
    }
    if (
      options.distributionYes !== null &&
      options.distributionNo !== null &&
      options.distributionYes + options.distributionNo !== 1_000_000_000
    ) {
      throw new CliError('INVALID_ARGS', '--distribution-yes + --distribution-no must equal 1000000000.');
    }
    if (options.feeTier < MIN_AMM_FEE_TIER || options.feeTier > MAX_AMM_FEE_TIER) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        `--fee-tier must be between ${MIN_AMM_FEE_TIER} and ${MAX_AMM_FEE_TIER} (max 5%).`,
      );
    }
    if (options.hedgeRatio > 5) {
      throw new CliError('INVALID_FLAG_VALUE', '--hedge-ratio must be <= 5.');
    }
    if (options.paths > 200_000) {
      throw new CliError('INVALID_FLAG_VALUE', '--paths must be <= 200000.');
    }
    if (options.steps > 1_000) {
      throw new CliError('INVALID_FLAG_VALUE', '--steps must be <= 1000.');
    }

    return options;
  };
}

module.exports = {
  createParseMirrorBrowseFlags,
  createParseMirrorVerifyFlags,
  createParseMirrorStatusFlags,
  createParseMirrorCloseFlags,
  createParseMirrorLpExplainFlags,
  createParseMirrorSimulateFlags,
};
