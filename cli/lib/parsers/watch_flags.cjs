function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParseWatchFlags requires deps.${name}()`);
  }
  return deps[name];
}

/**
 * Creates the watch flags parser.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseWatchFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const parseOutcomeSide = requireDep(deps, 'parseOutcomeSide');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parseProbabilityPercent = requireDep(deps, 'parseProbabilityPercent');
  const parseNonNegativeInteger = requireDep(deps, 'parseNonNegativeInteger');
  const parseInteger = requireDep(deps, 'parseInteger');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parseNumber = requireDep(deps, 'parseNumber');
  const parseWebhookFlagIntoOptions = requireDep(deps, 'parseWebhookFlagIntoOptions');

  return function parseWatchFlags(args) {
    const options = {
      wallet: null,
      marketAddress: null,
      side: 'yes',
      amountUsdc: 1,
      yesPct: null,
      slippageBps: 100,
      chainId: null,
      limit: 100,
      includeEvents: true,
      iterations: 5,
      intervalMs: 2_000,
      alertYesBelow: null,
      alertYesAbove: null,
      alertNetLiquidityBelow: null,
      alertNetLiquidityAbove: null,
      alertExposureAbove: null,
      alertHedgeGapAbove: null,
      maxTradeSizeUsdc: null,
      maxDailyVolumeUsdc: null,
      maxTotalExposureUsdc: null,
      maxPerMarketExposureUsdc: null,
      maxHedgeGapUsdc: null,
      failOnAlert: false,
      trackBrier: false,
      brierSource: null,
      brierFile: null,
      groupBy: null,
      marketId: null,
      eventId: null,
      competition: null,
      modelId: null,
      webhookUrl: null,
      webhookTemplate: null,
      webhookSecret: null,
      webhookTimeoutMs: 5_000,
      webhookRetries: 3,
      telegramBotToken: null,
      telegramChatId: null,
      discordWebhookUrl: null,
      failOnWebhookError: false,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];

      if (token === '--wallet') {
        options.wallet = parseAddressFlag(requireFlagValue(args, i, '--wallet'), '--wallet');
        i += 1;
        continue;
      }

      if (token === '--market-address') {
        options.marketAddress = parseAddressFlag(requireFlagValue(args, i, '--market-address'), '--market-address');
        i += 1;
        continue;
      }

      if (token === '--side') {
        options.side = parseOutcomeSide(requireFlagValue(args, i, '--side'), '--side');
        i += 1;
        continue;
      }

      if (token === '--amount-usdc' || token === '--amount') {
        options.amountUsdc = parsePositiveNumber(requireFlagValue(args, i, token), token);
        i += 1;
        continue;
      }

      if (token === '--yes-pct') {
        options.yesPct = parseProbabilityPercent(requireFlagValue(args, i, '--yes-pct'), '--yes-pct');
        i += 1;
        continue;
      }

      if (token === '--slippage-bps') {
        options.slippageBps = parseNonNegativeInteger(requireFlagValue(args, i, '--slippage-bps'), '--slippage-bps');
        if (options.slippageBps > 10_000) {
          throw new CliError('INVALID_FLAG_VALUE', '--slippage-bps must be between 0 and 10000.');
        }
        i += 1;
        continue;
      }

      if (token === '--chain-id') {
        options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
        i += 1;
        continue;
      }

      if (token === '--limit') {
        options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
        i += 1;
        continue;
      }

      if (token === '--include-events') {
        options.includeEvents = true;
        continue;
      }

      if (token === '--no-events') {
        options.includeEvents = false;
        continue;
      }

      if (token === '--iterations') {
        options.iterations = parsePositiveInteger(requireFlagValue(args, i, '--iterations'), '--iterations');
        i += 1;
        continue;
      }

      if (token === '--interval-ms') {
        options.intervalMs = parseNonNegativeInteger(requireFlagValue(args, i, '--interval-ms'), '--interval-ms');
        i += 1;
        continue;
      }

      if (token === '--alert-yes-below') {
        options.alertYesBelow = parseProbabilityPercent(requireFlagValue(args, i, '--alert-yes-below'), '--alert-yes-below');
        i += 1;
        continue;
      }

      if (token === '--alert-yes-above') {
        options.alertYesAbove = parseProbabilityPercent(requireFlagValue(args, i, '--alert-yes-above'), '--alert-yes-above');
        i += 1;
        continue;
      }

      if (token === '--alert-net-liquidity-below') {
        options.alertNetLiquidityBelow = parseNumber(
          requireFlagValue(args, i, '--alert-net-liquidity-below'),
          '--alert-net-liquidity-below',
        );
        i += 1;
        continue;
      }

      if (token === '--alert-net-liquidity-above') {
        options.alertNetLiquidityAbove = parseNumber(
          requireFlagValue(args, i, '--alert-net-liquidity-above'),
          '--alert-net-liquidity-above',
        );
        i += 1;
        continue;
      }

      if (token === '--alert-exposure-above') {
        options.alertExposureAbove = parseNumber(requireFlagValue(args, i, '--alert-exposure-above'), '--alert-exposure-above');
        options.maxTotalExposureUsdc = options.alertExposureAbove;
        i += 1;
        continue;
      }

      if (token === '--alert-hedge-gap-above') {
        options.alertHedgeGapAbove = parseNumber(requireFlagValue(args, i, '--alert-hedge-gap-above'), '--alert-hedge-gap-above');
        options.maxHedgeGapUsdc = options.alertHedgeGapAbove;
        i += 1;
        continue;
      }

      if (token === '--max-trade-size-usdc' || token === '--max-trade-usdc') {
        options.maxTradeSizeUsdc = parsePositiveNumber(requireFlagValue(args, i, token), token);
        i += 1;
        continue;
      }

      if (token === '--max-daily-volume-usdc') {
        options.maxDailyVolumeUsdc = parsePositiveNumber(requireFlagValue(args, i, token), token);
        i += 1;
        continue;
      }

      if (token === '--max-total-exposure-usdc' || token === '--max-open-exposure-usdc') {
        options.maxTotalExposureUsdc = parsePositiveNumber(requireFlagValue(args, i, token), token);
        i += 1;
        continue;
      }

      if (token === '--max-per-market-exposure-usdc') {
        options.maxPerMarketExposureUsdc = parsePositiveNumber(requireFlagValue(args, i, token), token);
        i += 1;
        continue;
      }

      if (token === '--max-hedge-gap-usdc') {
        options.maxHedgeGapUsdc = parsePositiveNumber(requireFlagValue(args, i, token), token);
        i += 1;
        continue;
      }

      if (token === '--fail-on-alert') {
        options.failOnAlert = true;
        continue;
      }

      if (token === '--track-brier') {
        options.trackBrier = true;
        continue;
      }

      if (token === '--brier-source' || token === '--forecast-source') {
        options.brierSource = String(requireFlagValue(args, i, token)).trim() || null;
        i += 1;
        continue;
      }

      if (token === '--brier-file' || token === '--forecast-file') {
        options.brierFile = String(requireFlagValue(args, i, token)).trim() || null;
        i += 1;
        continue;
      }

      if (token === '--group-by') {
        options.groupBy = String(requireFlagValue(args, i, '--group-by')).trim().toLowerCase();
        i += 1;
        continue;
      }

      if (token === '--market-id') {
        options.marketId = String(requireFlagValue(args, i, '--market-id')).trim() || null;
        i += 1;
        continue;
      }

      if (token === '--event-id') {
        options.eventId = String(requireFlagValue(args, i, '--event-id')).trim() || null;
        i += 1;
        continue;
      }

      if (token === '--competition') {
        options.competition = String(requireFlagValue(args, i, '--competition')).trim() || null;
        i += 1;
        continue;
      }

      if (token === '--model-id') {
        options.modelId = String(requireFlagValue(args, i, '--model-id')).trim() || null;
        i += 1;
        continue;
      }

      const webhookStep = parseWebhookFlagIntoOptions(args, i, token, options);
      if (webhookStep !== null) {
        i += webhookStep;
        continue;
      }

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for watch: ${token}`);
    }

    if (!options.wallet && !options.marketAddress) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'watch requires at least one target: --wallet and/or --market-address.');
    }
    if ((options.alertYesBelow !== null || options.alertYesAbove !== null) && !options.marketAddress) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'YES-odds alerts require --market-address.');
    }
    if ((options.alertNetLiquidityBelow !== null || options.alertNetLiquidityAbove !== null) && !options.wallet) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Net-liquidity alerts require --wallet.');
    }
    const usesExposureMetrics =
      options.alertExposureAbove !== null
      || options.maxTotalExposureUsdc !== null
      || options.maxPerMarketExposureUsdc !== null;
    if (usesExposureMetrics && !options.wallet) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Exposure thresholds require --wallet.');
    }
    const usesHedgeGapMetrics =
      options.alertHedgeGapAbove !== null
      || options.maxHedgeGapUsdc !== null;
    if (usesHedgeGapMetrics && !options.wallet) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Hedge-gap thresholds require --wallet.');
    }
    if (
      options.alertYesBelow !== null &&
      options.alertYesAbove !== null &&
      options.alertYesBelow > options.alertYesAbove
    ) {
      throw new CliError('INVALID_ARGS', '--alert-yes-below cannot be greater than --alert-yes-above.');
    }
    if (
      options.alertNetLiquidityBelow !== null &&
      options.alertNetLiquidityAbove !== null &&
      options.alertNetLiquidityBelow > options.alertNetLiquidityAbove
    ) {
      throw new CliError('INVALID_ARGS', '--alert-net-liquidity-below cannot be greater than --alert-net-liquidity-above.');
    }
    if ((options.telegramBotToken && !options.telegramChatId) || (!options.telegramBotToken && options.telegramChatId)) {
      throw new CliError(
        'INVALID_ARGS',
        'Telegram webhook requires both --telegram-bot-token and --telegram-chat-id.',
      );
    }
    if (options.groupBy !== null && !['source', 'market', 'competition'].includes(options.groupBy)) {
      throw new CliError('INVALID_FLAG_VALUE', '--group-by must be one of: source, market, competition.');
    }
    if (options.trackBrier && !options.marketAddress && !options.marketId) {
      throw new CliError(
        'MISSING_REQUIRED_FLAG',
        '--track-brier requires --market-address or --market-id for forecast attribution.',
      );
    }

    return options;
  };
}

/** Public watch parser factory export. */
module.exports = {
  createParseWatchFlags,
};
