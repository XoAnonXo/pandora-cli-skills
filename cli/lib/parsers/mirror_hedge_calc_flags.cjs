const { MIN_AMM_FEE_TIER, MAX_AMM_FEE_TIER } = require('../shared/constants.cjs');

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParseMirrorHedgeCalcFlags requires deps.${name}()`);
  }
  return deps[name];
}

/**
 * Creates the mirror hedge-calc flags parser.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseMirrorHedgeCalcFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parseNumber = requireDep(deps, 'parseNumber');
  const parseProbabilityPercent = requireDep(deps, 'parseProbabilityPercent');
  const parseNonNegativeInteger = requireDep(deps, 'parseNonNegativeInteger');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parseCsvNumberList = requireDep(deps, 'parseCsvNumberList');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');

  return function parseMirrorHedgeCalcFlags(args) {
    const options = {
      reserveYesUsdc: null,
      reserveNoUsdc: null,
      excessYesUsdc: 0,
      excessNoUsdc: 0,
      hedgeRatio: 1,
      polymarketYesPct: null,
      hedgeCostBps: 35,
      feeTier: 3000,
      volumeScenarios: null,
      pandoraMarketAddress: null,
      polymarketMarketId: null,
      polymarketSlug: null,
      trustDeploy: false,
      manifestFile: null,
      polymarketHost: null,
      polymarketGammaUrl: null,
      polymarketGammaMockUrl: null,
      polymarketMockUrl: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--reserve-yes-usdc') {
        options.reserveYesUsdc = parsePositiveNumber(requireFlagValue(args, i, '--reserve-yes-usdc'), '--reserve-yes-usdc');
        i += 1;
        continue;
      }
      if (token === '--reserve-no-usdc') {
        options.reserveNoUsdc = parsePositiveNumber(requireFlagValue(args, i, '--reserve-no-usdc'), '--reserve-no-usdc');
        i += 1;
        continue;
      }
      if (token === '--excess-yes-usdc') {
        options.excessYesUsdc = parseNumber(requireFlagValue(args, i, '--excess-yes-usdc'), '--excess-yes-usdc');
        i += 1;
        continue;
      }
      if (token === '--excess-no-usdc') {
        options.excessNoUsdc = parseNumber(requireFlagValue(args, i, '--excess-no-usdc'), '--excess-no-usdc');
        i += 1;
        continue;
      }
      if (token === '--hedge-ratio') {
        options.hedgeRatio = parsePositiveNumber(requireFlagValue(args, i, '--hedge-ratio'), '--hedge-ratio');
        i += 1;
        continue;
      }
      if (token === '--polymarket-yes-pct') {
        options.polymarketYesPct = parseProbabilityPercent(
          requireFlagValue(args, i, '--polymarket-yes-pct'),
          '--polymarket-yes-pct',
        );
        i += 1;
        continue;
      }
      if (token === '--hedge-cost-bps') {
        options.hedgeCostBps = parseNonNegativeInteger(requireFlagValue(args, i, '--hedge-cost-bps'), '--hedge-cost-bps');
        i += 1;
        continue;
      }
      if (token === '--fee-tier') {
        options.feeTier = parsePositiveInteger(requireFlagValue(args, i, '--fee-tier'), '--fee-tier');
        i += 1;
        continue;
      }
      if (token === '--volume-scenarios') {
        options.volumeScenarios = parseCsvNumberList(requireFlagValue(args, i, '--volume-scenarios'), '--volume-scenarios');
        i += 1;
        continue;
      }
      if (token === '--pandora-market-address' || token === '--market-address') {
        options.pandoraMarketAddress = parseAddressFlag(
          requireFlagValue(args, i, token),
          token,
        );
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
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror hedge-calc: ${token}`);
    }

    const hasSelector = Boolean(options.pandoraMarketAddress || options.polymarketMarketId || options.polymarketSlug);
    const hasManualReserves = options.reserveYesUsdc !== null || options.reserveNoUsdc !== null;
    if (hasSelector) {
      if (!options.pandoraMarketAddress) {
        throw new CliError(
          'MISSING_REQUIRED_FLAG',
          'mirror hedge-calc with market selectors requires --pandora-market-address <address> (alias: --market-address).',
        );
      }
      if (!options.polymarketMarketId && !options.polymarketSlug) {
        throw new CliError(
          'MISSING_REQUIRED_FLAG',
          'mirror hedge-calc with market selectors requires --polymarket-market-id <id> or --polymarket-slug <slug>.',
        );
      }
    }
    if (
      (options.reserveYesUsdc === null && options.reserveNoUsdc !== null) ||
      (options.reserveYesUsdc !== null && options.reserveNoUsdc === null)
    ) {
      throw new CliError('INVALID_ARGS', 'Provide both --reserve-yes-usdc and --reserve-no-usdc together.');
    }
    if (!hasSelector && !hasManualReserves) {
      throw new CliError(
        'MISSING_REQUIRED_FLAG',
        'mirror hedge-calc requires reserve inputs (--reserve-yes-usdc/--reserve-no-usdc) or market selectors.',
      );
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

    return options;
  };
}

module.exports = {
  createParseMirrorHedgeCalcFlags,
};
