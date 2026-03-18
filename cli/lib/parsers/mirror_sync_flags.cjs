const {
  normalizeMirrorPathForMcp,
  defaultMirrorWorkspacePath,
  validateMirrorUrl,
} = require('./mirror_parser_guard.cjs');
const { consumeProfileSelectorFlag } = require('./shared_profile_selector_flags.cjs');
const REBALANCE_ROUTE_VALUES = new Set(['public', 'auto', 'flashbots-private', 'flashbots-bundle']);
const REBALANCE_ROUTE_FALLBACK_VALUES = new Set(['fail', 'public']);

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParseMirrorSyncFlags requires deps.${name}()`);
  }
  return deps[name];
}

function buildMirrorSyncDeps(deps) {
  return {
    CliError: requireDep(deps, 'CliError'),
    parseAddressFlag: requireDep(deps, 'parseAddressFlag'),
    parsePrivateKeyFlag: requireDep(deps, 'parsePrivateKeyFlag'),
    requireFlagValue: requireDep(deps, 'requireFlagValue'),
    parsePositiveInteger: requireDep(deps, 'parsePositiveInteger'),
    parsePositiveNumber: requireDep(deps, 'parsePositiveNumber'),
    parseInteger: requireDep(deps, 'parseInteger'),
    isSecureHttpUrlOrLocal: requireDep(deps, 'isSecureHttpUrlOrLocal'),
    parseWebhookFlagIntoOptions: requireDep(deps, 'parseWebhookFlagIntoOptions'),
    defaultMirrorStateFile: requireDep(deps, 'defaultMirrorStateFile'),
    defaultMirrorKillSwitchFile: requireDep(deps, 'defaultMirrorKillSwitchFile'),
    parseMirrorSyncGateSkipList: requireDep(deps, 'parseMirrorSyncGateSkipList'),
    mergeMirrorSyncGateSkipLists: requireDep(deps, 'mergeMirrorSyncGateSkipLists'),
  };
}

function parseSecureUrlList(value, flagName, CliError, isSecureHttpUrlOrLocal) {
  const rawEntries = String(value || '').split(',');
  const normalized = [];
  for (const entry of rawEntries) {
    const candidate = String(entry || '').trim();
    if (!candidate) {
      throw new CliError('INVALID_FLAG_VALUE', `${flagName} must not contain empty RPC URL entries.`);
    }
    if (!isSecureHttpUrlOrLocal(candidate)) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        `${flagName} must use https:// (or http://localhost/127.0.0.1 for local testing).`,
      );
    }
    normalized.push(candidate);
  }

  return Array.from(new Set(normalized)).join(',');
}

function parseRebalanceRoute(value, flagName, CliError) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!REBALANCE_ROUTE_VALUES.has(normalized)) {
    throw new CliError(
      'INVALID_FLAG_VALUE',
      `${flagName} must be public|auto|flashbots-private|flashbots-bundle.`,
    );
  }
  return normalized;
}

function parseRebalanceRouteFallback(value, flagName, CliError) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!REBALANCE_ROUTE_FALLBACK_VALUES.has(normalized)) {
    throw new CliError(
      'INVALID_FLAG_VALUE',
      `${flagName} must be fail|public.`,
    );
  }
  return normalized;
}

function parseNonNegativeNumber(value, flagName, CliError) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a non-negative number.`);
  }
  return parsed;
}

/**
 * Creates the mirror sync flags parser.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseMirrorSyncFlags(deps) {
  const {
    CliError,
    parseAddressFlag,
    parsePrivateKeyFlag,
    requireFlagValue,
    parsePositiveInteger,
    parsePositiveNumber,
    parseInteger,
    isSecureHttpUrlOrLocal,
    parseWebhookFlagIntoOptions,
    defaultMirrorStateFile,
    defaultMirrorKillSwitchFile,
    parseMirrorSyncGateSkipList,
    mergeMirrorSyncGateSkipLists,
  } = buildMirrorSyncDeps(deps);

  return function parseMirrorSyncFlags(args) {
    const mode = args[0];
    if (mode !== 'run' && mode !== 'once') {
      throw new CliError('INVALID_ARGS', 'mirror sync requires subcommand run|once.');
    }

    const rest = args.slice(1);
    const options = {
      mode,
      pandoraMarketAddress: null,
      polymarketMarketId: null,
      polymarketSlug: null,
      executeLive: false,
      hedgeEnabled: true,
      hedgeScope: 'total',
      skipInitialHedge: false,
      hedgeRatio: 1,
      rebalanceSizingMode: 'atomic',
      priceSource: 'on-chain',
      rebalanceRoute: 'public',
      rebalanceRouteFallback: 'fail',
      flashbotsRelayUrl: null,
      flashbotsAuthKey: null,
      flashbotsTargetBlockOffset: null,
      intervalMs: 5_000,
      driftTriggerBps: 150,
      hedgeTriggerUsdc: 10,
      maxRebalanceUsdc: 25,
      maxHedgeUsdc: 50,
      maxOpenExposureUsdc: null,
      maxTradesPerDay: null,
      cooldownMs: 60_000,
      depthSlippageBps: 100,
      minTimeToCloseSec: 1800,
      strictCloseTimeDelta: false,
      iterations: null,
      stream: false,
      stateFile: null,
      killSwitchFile: null,
      trustDeploy: false,
      manifestFile: null,
      chainId: null,
      rpcUrl: null,
      polymarketRpcUrl: null,
      privateKey: null,
      profileId: null,
      profileFile: null,
      funder: null,
      usdc: null,
      polymarketHost: null,
      polymarketGammaUrl: null,
      polymarketGammaMockUrl: null,
      polymarketMockUrl: null,
      webhookUrl: null,
      webhookTemplate: null,
      webhookSecret: null,
      webhookTimeoutMs: 5_000,
      webhookRetries: 3,
      telegramBotToken: null,
      telegramChatId: null,
      discordWebhookUrl: null,
      failOnWebhookError: false,
      daemon: false,
      verbose: false,
      adoptExistingPositions: false,
      forceGate: false,
      forceGateDeprecatedUsed: false,
      skipGateChecks: [],
    };
    let sawPaperModeFlag = false;
    let sawExecuteLiveModeFlag = false;

    for (let i = 0; i < rest.length; i += 1) {
      const token = rest[i];
      if (token === '--pandora-market-address' || token === '--market-address') {
        options.pandoraMarketAddress = parseAddressFlag(
          requireFlagValue(rest, i, token),
          token,
        );
        i += 1;
        continue;
      }
      if (token === '--polymarket-market-id') {
        options.polymarketMarketId = requireFlagValue(rest, i, '--polymarket-market-id');
        i += 1;
        continue;
      }
      if (token === '--polymarket-slug') {
        options.polymarketSlug = requireFlagValue(rest, i, '--polymarket-slug');
        i += 1;
        continue;
      }
      if (token === '--paper' || token === '--dry-run') {
        sawPaperModeFlag = true;
        options.executeLive = false;
        continue;
      }
      if (token === '--execute-live' || token === '--execute') {
        sawExecuteLiveModeFlag = true;
        options.executeLive = true;
        continue;
      }
      if (token === '--no-hedge') {
        options.hedgeEnabled = false;
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
      if (token === '--drift-trigger-bps') {
        options.driftTriggerBps = parsePositiveInteger(requireFlagValue(rest, i, '--drift-trigger-bps'), '--drift-trigger-bps');
        i += 1;
        continue;
      }
      if (token === '--hedge-trigger-usdc') {
        options.hedgeTriggerUsdc = parsePositiveNumber(requireFlagValue(rest, i, '--hedge-trigger-usdc'), '--hedge-trigger-usdc');
        i += 1;
        continue;
      }
      if (token === '--hedge-ratio') {
        options.hedgeRatio = parsePositiveNumber(requireFlagValue(rest, i, '--hedge-ratio'), '--hedge-ratio');
        if (options.hedgeRatio > 2) {
          throw new CliError('INVALID_FLAG_VALUE', '--hedge-ratio must be <= 2.');
        }
        i += 1;
        continue;
      }
      if (token === '--hedge-scope') {
        const value = String(requireFlagValue(rest, i, '--hedge-scope')).trim().toLowerCase();
        if (value !== 'pool' && value !== 'total') {
          throw new CliError('INVALID_FLAG_VALUE', '--hedge-scope must be pool|total.');
        }
        options.hedgeScope = value;
        i += 1;
        continue;
      }
      if (token === '--skip-initial-hedge') {
        options.skipInitialHedge = true;
        continue;
      }
      if (token === '--rebalance-mode') {
        const value = String(requireFlagValue(rest, i, '--rebalance-mode')).trim().toLowerCase();
        if (value !== 'atomic' && value !== 'incremental') {
          throw new CliError('INVALID_FLAG_VALUE', '--rebalance-mode must be atomic|incremental.');
        }
        options.rebalanceSizingMode = value;
        i += 1;
        continue;
      }
      if (token === '--price-source') {
        const value = String(requireFlagValue(rest, i, '--price-source')).trim().toLowerCase();
        if (value !== 'on-chain' && value !== 'indexer') {
          throw new CliError('INVALID_FLAG_VALUE', '--price-source must be on-chain|indexer.');
        }
        options.priceSource = value;
        i += 1;
        continue;
      }
      if (token === '--rebalance-route') {
        options.rebalanceRoute = parseRebalanceRoute(
          requireFlagValue(rest, i, '--rebalance-route'),
          '--rebalance-route',
          CliError,
        );
        i += 1;
        continue;
      }
      if (token === '--rebalance-route-fallback') {
        options.rebalanceRouteFallback = parseRebalanceRouteFallback(
          requireFlagValue(rest, i, '--rebalance-route-fallback'),
          '--rebalance-route-fallback',
          CliError,
        );
        i += 1;
        continue;
      }
      if (token === '--flashbots-relay-url') {
        options.flashbotsRelayUrl = validateMirrorUrl(
          requireFlagValue(rest, i, '--flashbots-relay-url'),
          '--flashbots-relay-url',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      if (token === '--flashbots-auth-key') {
        options.flashbotsAuthKey = requireFlagValue(rest, i, '--flashbots-auth-key');
        i += 1;
        continue;
      }
      if (token === '--flashbots-target-block-offset') {
        options.flashbotsTargetBlockOffset = parsePositiveInteger(
          requireFlagValue(rest, i, '--flashbots-target-block-offset'),
          '--flashbots-target-block-offset',
        );
        i += 1;
        continue;
      }
      if (token === '--max-rebalance-usdc') {
        options.maxRebalanceUsdc = parseNonNegativeNumber(
          requireFlagValue(rest, i, '--max-rebalance-usdc'),
          '--max-rebalance-usdc',
          CliError,
        );
        i += 1;
        continue;
      }
      if (token === '--max-hedge-usdc') {
        options.maxHedgeUsdc = parsePositiveNumber(requireFlagValue(rest, i, '--max-hedge-usdc'), '--max-hedge-usdc');
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
      if (token === '--cooldown-ms') {
        options.cooldownMs = parsePositiveInteger(requireFlagValue(rest, i, '--cooldown-ms'), '--cooldown-ms');
        i += 1;
        continue;
      }
      if (token === '--depth-slippage-bps') {
        options.depthSlippageBps = parsePositiveInteger(requireFlagValue(rest, i, '--depth-slippage-bps'), '--depth-slippage-bps');
        if (options.depthSlippageBps > 10_000) {
          throw new CliError('INVALID_FLAG_VALUE', '--depth-slippage-bps must be <= 10000.');
        }
        i += 1;
        continue;
      }
      if (token === '--min-time-to-close-sec') {
        options.minTimeToCloseSec = parsePositiveInteger(
          requireFlagValue(rest, i, '--min-time-to-close-sec'),
          '--min-time-to-close-sec',
        );
        i += 1;
        continue;
      }
      if (token === '--strict-close-time-delta') {
        options.strictCloseTimeDelta = true;
        continue;
      }
      if (token === '--iterations') {
        options.iterations = parsePositiveInteger(requireFlagValue(rest, i, '--iterations'), '--iterations');
        i += 1;
        continue;
      }
      if (token === '--stream') {
        options.stream = true;
        continue;
      }
      if (token === '--no-stream') {
        options.stream = false;
        continue;
      }
      if (token === '--verbose') {
        options.verbose = true;
        continue;
      }
      if (token === '--daemon') {
        options.daemon = true;
        continue;
      }
      if (token === '--adopt-existing-positions') {
        options.adoptExistingPositions = true;
        continue;
      }
      if (token === '--state-file') {
        options.stateFile = normalizeMirrorPathForMcp(
          requireFlagValue(rest, i, '--state-file'),
          '--state-file',
          CliError,
        );
        i += 1;
        continue;
      }
      if (token === '--kill-switch-file') {
        options.killSwitchFile = normalizeMirrorPathForMcp(
          requireFlagValue(rest, i, '--kill-switch-file'),
          '--kill-switch-file',
          CliError,
        );
        i += 1;
        continue;
      }
      if (token === '--chain-id') {
        options.chainId = parseInteger(requireFlagValue(rest, i, '--chain-id'), '--chain-id');
        i += 1;
        continue;
      }
      if (token === '--rpc-url') {
        options.rpcUrl = parseSecureUrlList(
          requireFlagValue(rest, i, '--rpc-url'),
          '--rpc-url',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      if (token === '--polymarket-rpc-url') {
        options.polymarketRpcUrl = parseSecureUrlList(
          requireFlagValue(rest, i, '--polymarket-rpc-url'),
          '--polymarket-rpc-url',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      if (token === '--private-key') {
        options.privateKey = parsePrivateKeyFlag(requireFlagValue(rest, i, '--private-key'), '--private-key');
        i += 1;
        continue;
      }
      {
        const nextIndex = consumeProfileSelectorFlag({
          token,
          args: rest,
          index: i,
          options,
          CliError,
          requireFlagValue,
        });
        if (nextIndex !== null) {
          i = nextIndex;
          continue;
        }
      }
      if (token === '--funder') {
        options.funder = parseAddressFlag(requireFlagValue(rest, i, '--funder'), '--funder');
        i += 1;
        continue;
      }
      if (token === '--usdc') {
        options.usdc = parseAddressFlag(requireFlagValue(rest, i, '--usdc'), '--usdc');
        i += 1;
        continue;
      }
      if (token === '--polymarket-host') {
        options.polymarketHost = validateMirrorUrl(
          requireFlagValue(rest, i, '--polymarket-host'),
          '--polymarket-host',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      if (token === '--polymarket-gamma-url') {
        options.polymarketGammaUrl = validateMirrorUrl(
          requireFlagValue(rest, i, '--polymarket-gamma-url'),
          '--polymarket-gamma-url',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      if (token === '--polymarket-gamma-mock-url') {
        options.polymarketGammaMockUrl = validateMirrorUrl(
          requireFlagValue(rest, i, '--polymarket-gamma-mock-url'),
          '--polymarket-gamma-mock-url',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      if (token === '--polymarket-mock-url') {
        options.polymarketMockUrl = validateMirrorUrl(
          requireFlagValue(rest, i, '--polymarket-mock-url'),
          '--polymarket-mock-url',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      if (token === '--trust-deploy') {
        options.trustDeploy = true;
        continue;
      }
      if (token === '--skip-gate') {
        const next = rest[i + 1];
        if (typeof next === 'string' && !next.startsWith('--')) {
          const parsed = parseMirrorSyncGateSkipList(next, '--skip-gate');
          options.skipGateChecks = mergeMirrorSyncGateSkipLists(options.skipGateChecks, parsed);
          i += 1;
        } else {
          options.forceGate = true;
        }
        continue;
      }
      if (token === '--force-gate') {
        options.forceGate = true;
        options.forceGateDeprecatedUsed = true;
        continue;
      }
      if (token === '--manifest-file') {
        options.manifestFile = normalizeMirrorPathForMcp(
          requireFlagValue(rest, i, '--manifest-file'),
          '--manifest-file',
          CliError,
        );
        i += 1;
        continue;
      }

      const webhookStep = parseWebhookFlagIntoOptions(rest, i, token, options);
      if (webhookStep !== null) {
        i += webhookStep;
        continue;
      }

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror sync: ${token}`);
    }

    if (!options.pandoraMarketAddress) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing --pandora-market-address <address> (alias: --market-address).');
    }
    if (sawPaperModeFlag && sawExecuteLiveModeFlag) {
      throw new CliError(
        'INVALID_ARGS',
        'mirror sync accepts only one mode flag: --paper/--dry-run or --execute-live/--execute.',
      );
    }
    if (options.mode === 'once' && options.daemon) {
      throw new CliError('INVALID_ARGS', 'mirror sync once does not support --daemon. Use mirror sync start for background run mode.');
    }
    if (!options.polymarketMarketId && !options.polymarketSlug) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'mirror sync requires --polymarket-market-id <id> or --polymarket-slug <slug>.');
    }
    if ((options.telegramBotToken && !options.telegramChatId) || (!options.telegramBotToken && options.telegramChatId)) {
      throw new CliError(
        'INVALID_ARGS',
        'Telegram webhook requires both --telegram-bot-token and --telegram-chat-id.',
      );
    }

    if (options.executeLive) {
      const missing = [];
      if (options.maxOpenExposureUsdc === null) missing.push('--max-open-exposure-usdc');
      if (options.maxTradesPerDay === null) missing.push('--max-trades-per-day');
      if (missing.length) {
        throw new CliError(
          'MISSING_REQUIRED_FLAG',
          `Live mode requires companion risk flags: ${missing.join(', ')}.`,
        );
      }
    } else {
      if (options.maxOpenExposureUsdc === null) options.maxOpenExposureUsdc = Number.POSITIVE_INFINITY;
      if (options.maxTradesPerDay === null) options.maxTradesPerDay = Number.MAX_SAFE_INTEGER;
    }

    if (options.stateFile === null) {
      options.stateFile = defaultMirrorWorkspacePath(defaultMirrorStateFile({
        mode: options.mode,
        pandoraMarketAddress: options.pandoraMarketAddress,
        polymarketMarketId: options.polymarketMarketId,
        polymarketSlug: options.polymarketSlug,
        executeLive: options.executeLive,
        driftTriggerBps: options.driftTriggerBps,
        hedgeEnabled: options.hedgeEnabled,
        hedgeRatio: options.hedgeRatio,
        hedgeTriggerUsdc: options.hedgeTriggerUsdc,
        strictCloseTimeDelta: options.strictCloseTimeDelta,
        forceGate: options.forceGate,
        skipGateChecks:
          Array.isArray(options.skipGateChecks) && options.skipGateChecks.length
            ? [...options.skipGateChecks].sort()
            : [],
      }));
    }
    if (options.killSwitchFile === null) {
      options.killSwitchFile = defaultMirrorWorkspacePath(defaultMirrorKillSwitchFile());
    }
    if (options.rebalanceRoute === 'public') {
      const flashbotsFlags = [];
      if (options.flashbotsRelayUrl) flashbotsFlags.push('--flashbots-relay-url');
      if (options.flashbotsAuthKey) flashbotsFlags.push('--flashbots-auth-key');
      if (options.flashbotsTargetBlockOffset !== null) flashbotsFlags.push('--flashbots-target-block-offset');
      if (flashbotsFlags.length) {
        throw new CliError(
          'INVALID_ARGS',
          `${flashbotsFlags.join(', ')} require --rebalance-route auto, flashbots-private, or flashbots-bundle.`,
        );
      }
    }

    return options;
  };
}

/**
 * Creates the mirror sync daemon selector parser used by stop/status.
 * @param {object} deps
 * @returns {(args: string[], actionName: string) => object}
 */
function createParseMirrorSyncDaemonSelectorFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');

  return function parseMirrorSyncDaemonSelectorFlags(args, actionName) {
    const options = {
      pidFile: null,
      strategyHash: null,
      marketAddress: null,
      all: false,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--pid-file') {
        options.pidFile = normalizeMirrorPathForMcp(
          requireFlagValue(args, i, '--pid-file'),
          '--pid-file',
          CliError,
        );
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
      if (token === '--market-address') {
        if (actionName !== 'stop') {
          throw new CliError('INVALID_ARGS', '--market-address selector is only supported for mirror sync stop.');
        }
        options.marketAddress = parseAddressFlag(requireFlagValue(args, i, '--market-address'), '--market-address');
        i += 1;
        continue;
      }
      if (token === '--all') {
        if (actionName !== 'stop') {
          throw new CliError('INVALID_ARGS', '--all selector is only supported for mirror sync stop.');
        }
        options.all = true;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror sync ${actionName}: ${token}`);
    }

    if (!options.pidFile && !options.strategyHash && !options.marketAddress && !options.all) {
      throw new CliError(
        'MISSING_REQUIRED_FLAG',
        `mirror sync ${actionName} requires --pid-file <path>, --strategy-hash <hash>, --market-address <address>, or --all.`,
      );
    }

    return options;
  };
}

/** Public mirror sync parser factory exports. */
module.exports = {
  createParseMirrorSyncFlags,
  createParseMirrorSyncDaemonSelectorFlags,
};
