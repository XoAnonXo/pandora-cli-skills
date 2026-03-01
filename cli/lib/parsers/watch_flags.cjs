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
      failOnAlert: false,
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

      if (token === '--fail-on-alert') {
        options.failOnAlert = true;
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

    return options;
  };
}

/** Public watch parser factory export. */
module.exports = {
  createParseWatchFlags,
};
