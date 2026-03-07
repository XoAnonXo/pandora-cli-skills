const { validateMirrorUrl } = require('./mirror_parser_guard.cjs');

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParseMirrorPlanFlags requires deps.${name}()`);
  }
  return deps[name];
}

/**
 * Creates the mirror plan flags parser.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseMirrorPlanFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parseInteger = requireDep(deps, 'parseInteger');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');

  return function parseMirrorPlanFlags(args) {
    const options = {
      source: 'polymarket',
      polymarketMarketId: null,
      polymarketSlug: null,
      chainId: null,
      targetSlippageBps: 150,
      turnoverTarget: 1.25,
      depthSlippageBps: 100,
      safetyMultiplier: 1.2,
      minLiquidityUsdc: 100,
      maxLiquidityUsdc: 50_000,
      withRules: false,
      includeSimilarity: false,
      minCloseLeadSeconds: 3600,
      polymarketHost: null,
      polymarketGammaUrl: null,
      polymarketGammaMockUrl: null,
      polymarketMockUrl: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];

      if (token === '--source') {
        const source = requireFlagValue(args, i, '--source').toLowerCase();
        if (source !== 'polymarket') {
          throw new CliError('INVALID_FLAG_VALUE', '--source must be polymarket in mirror v1.');
        }
        options.source = source;
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
      if (token === '--chain-id') {
        options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
        i += 1;
        continue;
      }
      if (token === '--target-slippage-bps') {
        options.targetSlippageBps = parsePositiveInteger(requireFlagValue(args, i, '--target-slippage-bps'), '--target-slippage-bps');
        if (options.targetSlippageBps > 10_000) {
          throw new CliError('INVALID_FLAG_VALUE', '--target-slippage-bps must be <= 10000.');
        }
        i += 1;
        continue;
      }
      if (token === '--turnover-target') {
        options.turnoverTarget = parsePositiveNumber(requireFlagValue(args, i, '--turnover-target'), '--turnover-target');
        i += 1;
        continue;
      }
      if (token === '--depth-slippage-bps') {
        options.depthSlippageBps = parsePositiveInteger(requireFlagValue(args, i, '--depth-slippage-bps'), '--depth-slippage-bps');
        if (options.depthSlippageBps > 10_000) {
          throw new CliError('INVALID_FLAG_VALUE', '--depth-slippage-bps must be <= 10000.');
        }
        i += 1;
        continue;
      }
      if (token === '--safety-multiplier') {
        options.safetyMultiplier = parsePositiveNumber(requireFlagValue(args, i, '--safety-multiplier'), '--safety-multiplier');
        i += 1;
        continue;
      }
      if (token === '--min-liquidity-usdc') {
        options.minLiquidityUsdc = parsePositiveNumber(requireFlagValue(args, i, '--min-liquidity-usdc'), '--min-liquidity-usdc');
        i += 1;
        continue;
      }
      if (token === '--max-liquidity-usdc') {
        options.maxLiquidityUsdc = parsePositiveNumber(requireFlagValue(args, i, '--max-liquidity-usdc'), '--max-liquidity-usdc');
        i += 1;
        continue;
      }
      if (token === '--with-rules') {
        options.withRules = true;
        continue;
      }
      if (token === '--include-similarity') {
        options.includeSimilarity = true;
        continue;
      }
      if (token === '--min-close-lead-seconds') {
        options.minCloseLeadSeconds = parsePositiveInteger(
          requireFlagValue(args, i, '--min-close-lead-seconds'),
          '--min-close-lead-seconds',
        );
        i += 1;
        continue;
      }
      if (token === '--polymarket-host') {
        options.polymarketHost = validateMirrorUrl(
          requireFlagValue(args, i, '--polymarket-host'),
          '--polymarket-host',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      if (token === '--polymarket-gamma-url') {
        options.polymarketGammaUrl = validateMirrorUrl(
          requireFlagValue(args, i, '--polymarket-gamma-url'),
          '--polymarket-gamma-url',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      if (token === '--polymarket-gamma-mock-url') {
        options.polymarketGammaMockUrl = validateMirrorUrl(
          requireFlagValue(args, i, '--polymarket-gamma-mock-url'),
          '--polymarket-gamma-mock-url',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      if (token === '--polymarket-mock-url') {
        options.polymarketMockUrl = validateMirrorUrl(
          requireFlagValue(args, i, '--polymarket-mock-url'),
          '--polymarket-mock-url',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror plan: ${token}`);
    }

    if (!options.polymarketMarketId && !options.polymarketSlug) {
      throw new CliError(
        'MISSING_REQUIRED_FLAG',
        'mirror plan requires --polymarket-market-id <id> or --polymarket-slug <slug>.',
      );
    }
    if (options.minLiquidityUsdc > options.maxLiquidityUsdc) {
      throw new CliError('INVALID_ARGS', '--min-liquidity-usdc cannot be greater than --max-liquidity-usdc.');
    }

    return options;
  };
}

module.exports = {
  createParseMirrorPlanFlags,
};
