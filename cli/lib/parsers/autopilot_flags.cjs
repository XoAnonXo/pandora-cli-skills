function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParseAutopilotFlags requires deps.${name}()`);
  }
  return deps[name];
}

/**
 * Creates the autopilot flags parser.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseAutopilotFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const parseOutcomeSide = requireDep(deps, 'parseOutcomeSide');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parseProbabilityPercent = requireDep(deps, 'parseProbabilityPercent');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parseNonNegativeInteger = requireDep(deps, 'parseNonNegativeInteger');
  const parseWebhookFlagIntoOptions = requireDep(deps, 'parseWebhookFlagIntoOptions');
  const defaultAutopilotStateFile = requireDep(deps, 'defaultAutopilotStateFile');
  const defaultAutopilotKillSwitchFile = requireDep(deps, 'defaultAutopilotKillSwitchFile');

  return function parseAutopilotFlags(args) {
    const mode = args[0];
    if (mode !== 'run' && mode !== 'once') {
      throw new CliError('INVALID_ARGS', 'autopilot requires subcommand run|once.');
    }

    const rest = args.slice(1);
    const options = {
      mode,
      marketAddress: null,
      side: null,
      amountUsdc: null,
      triggerYesBelow: null,
      triggerYesAbove: null,
      yesPct: null,
      slippageBps: 100,
      executeLive: false,
      intervalMs: 5_000,
      cooldownMs: 60_000,
      maxAmountUsdc: null,
      maxOpenExposureUsdc: null,
      maxTradesPerDay: null,
      minProbabilityPct: null,
      maxProbabilityPct: null,
      iterations: null,
      stateFile: null,
      killSwitchFile: null,
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

    for (let i = 0; i < rest.length; i += 1) {
      const token = rest[i];
      if (token === '--market-address' || token === '--pandora-market-address') {
        options.marketAddress = parseAddressFlag(requireFlagValue(rest, i, token), token);
        i += 1;
        continue;
      }
      if (token === '--side') {
        options.side = parseOutcomeSide(requireFlagValue(rest, i, '--side'), '--side');
        i += 1;
        continue;
      }
      if (token === '--amount-usdc' || token === '--amount') {
        options.amountUsdc = parsePositiveNumber(requireFlagValue(rest, i, token), token);
        i += 1;
        continue;
      }
      if (token === '--trigger-yes-below') {
        options.triggerYesBelow = parseProbabilityPercent(requireFlagValue(rest, i, '--trigger-yes-below'), '--trigger-yes-below');
        i += 1;
        continue;
      }
      if (token === '--trigger-yes-above') {
        options.triggerYesAbove = parseProbabilityPercent(requireFlagValue(rest, i, '--trigger-yes-above'), '--trigger-yes-above');
        i += 1;
        continue;
      }
      if (token === '--paper' || token === '--dry-run') {
        options.executeLive = false;
        continue;
      }
      if (token === '--execute-live' || token === '--execute') {
        options.executeLive = true;
        continue;
      }
      if (token === '--interval-ms') {
        options.intervalMs = parsePositiveInteger(requireFlagValue(rest, i, '--interval-ms'), '--interval-ms');
        if (options.intervalMs < 1_000) {
          throw new CliError('INVALID_FLAG_VALUE', '--interval-ms must be >= 1000.');
        }
        i += 1;
        continue;
      }
      if (token === '--cooldown-ms') {
        options.cooldownMs = parsePositiveInteger(requireFlagValue(rest, i, '--cooldown-ms'), '--cooldown-ms');
        i += 1;
        continue;
      }
      if (token === '--max-amount-usdc') {
        options.maxAmountUsdc = parsePositiveNumber(requireFlagValue(rest, i, '--max-amount-usdc'), '--max-amount-usdc');
        i += 1;
        continue;
      }
      if (token === '--max-open-exposure-usdc') {
        options.maxOpenExposureUsdc = parsePositiveNumber(
          requireFlagValue(rest, i, '--max-open-exposure-usdc'),
          '--max-open-exposure-usdc',
        );
        i += 1;
        continue;
      }
      if (token === '--max-trades-per-day') {
        options.maxTradesPerDay = parsePositiveInteger(
          requireFlagValue(rest, i, '--max-trades-per-day'),
          '--max-trades-per-day',
        );
        i += 1;
        continue;
      }
      if (token === '--min-probability-pct') {
        options.minProbabilityPct = parseProbabilityPercent(
          requireFlagValue(rest, i, '--min-probability-pct'),
          '--min-probability-pct',
        );
        i += 1;
        continue;
      }
      if (token === '--max-probability-pct') {
        options.maxProbabilityPct = parseProbabilityPercent(
          requireFlagValue(rest, i, '--max-probability-pct'),
          '--max-probability-pct',
        );
        i += 1;
        continue;
      }
      if (token === '--yes-pct') {
        options.yesPct = parseProbabilityPercent(requireFlagValue(rest, i, '--yes-pct'), '--yes-pct');
        i += 1;
        continue;
      }
      if (token === '--slippage-bps') {
        options.slippageBps = parseNonNegativeInteger(requireFlagValue(rest, i, '--slippage-bps'), '--slippage-bps');
        if (options.slippageBps > 10_000) {
          throw new CliError('INVALID_FLAG_VALUE', '--slippage-bps must be between 0 and 10000.');
        }
        i += 1;
        continue;
      }
      if (token === '--iterations') {
        options.iterations = parsePositiveInteger(requireFlagValue(rest, i, '--iterations'), '--iterations');
        i += 1;
        continue;
      }
      if (token === '--state-file') {
        options.stateFile = requireFlagValue(rest, i, '--state-file');
        i += 1;
        continue;
      }
      if (token === '--kill-switch-file') {
        options.killSwitchFile = requireFlagValue(rest, i, '--kill-switch-file');
        i += 1;
        continue;
      }

      const webhookStep = parseWebhookFlagIntoOptions(rest, i, token, options);
      if (webhookStep !== null) {
        i += webhookStep;
        continue;
      }

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for autopilot: ${token}`);
    }

    if (!options.marketAddress) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing market address. Use --market-address <address>.');
    }
    if (!options.side) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing side. Use --side yes|no.');
    }
    if (options.amountUsdc === null) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing amount. Use --amount-usdc <amount>.');
    }
    if (options.triggerYesBelow === null && options.triggerYesAbove === null) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'At least one trigger is required: --trigger-yes-below and/or --trigger-yes-above.');
    }
    if (
      options.triggerYesBelow !== null &&
      options.triggerYesAbove !== null &&
      options.triggerYesBelow > options.triggerYesAbove
    ) {
      throw new CliError('INVALID_ARGS', '--trigger-yes-below cannot be greater than --trigger-yes-above.');
    }
    if (
      options.minProbabilityPct !== null &&
      options.maxProbabilityPct !== null &&
      options.minProbabilityPct > options.maxProbabilityPct
    ) {
      throw new CliError('INVALID_ARGS', '--min-probability-pct cannot be greater than --max-probability-pct.');
    }
    if ((options.telegramBotToken && !options.telegramChatId) || (!options.telegramBotToken && options.telegramChatId)) {
      throw new CliError(
        'INVALID_ARGS',
        'Telegram webhook requires both --telegram-bot-token and --telegram-chat-id.',
      );
    }

    if (options.executeLive) {
      if (options.maxAmountUsdc === null) {
        throw new CliError('MISSING_REQUIRED_FLAG', 'Live mode requires --max-amount-usdc.');
      }
      if (options.maxOpenExposureUsdc === null) {
        throw new CliError('MISSING_REQUIRED_FLAG', 'Live mode requires --max-open-exposure-usdc.');
      }
      if (options.maxTradesPerDay === null) {
        throw new CliError('MISSING_REQUIRED_FLAG', 'Live mode requires --max-trades-per-day.');
      }
    } else {
      if (options.maxOpenExposureUsdc === null) options.maxOpenExposureUsdc = Number.POSITIVE_INFINITY;
      if (options.maxTradesPerDay === null) options.maxTradesPerDay = Number.MAX_SAFE_INTEGER;
    }

    if (options.stateFile === null) {
      options.stateFile = defaultAutopilotStateFile({
        mode: options.mode,
        marketAddress: options.marketAddress,
        side: options.side,
        amountUsdc: options.amountUsdc,
        triggerYesBelow: options.triggerYesBelow,
        triggerYesAbove: options.triggerYesAbove,
        executeLive: options.executeLive,
      });
    }
    if (options.killSwitchFile === null) {
      options.killSwitchFile = defaultAutopilotKillSwitchFile();
    }

    return options;
  };
}

/** Public autopilot parser factory export. */
module.exports = {
  createParseAutopilotFlags,
};
