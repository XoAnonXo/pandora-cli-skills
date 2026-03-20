const {
  normalizeMirrorPathForMcp,
  defaultMirrorWorkspacePath,
  validateMirrorUrl,
} = require('./mirror_parser_guard.cjs');

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParseMirrorHedgeFlags requires deps.${name}()`);
  }
  return deps[name];
}

function normalizeOptionalString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function parseBooleanish(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function parseSecureUrlList(value, flagName, CliError, isSecureHttpUrlOrLocal) {
  const rawEntries = String(value || '').split(',');
  const normalized = [];
  for (const entry of rawEntries) {
    const candidate = String(entry || '').trim();
    if (!candidate) {
      throw new CliError('INVALID_FLAG_VALUE', `${flagName} must not contain empty URL entries.`);
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
  if (!['public', 'auto', 'flashbots-private', 'flashbots-bundle'].includes(normalized)) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be public|auto|flashbots-private|flashbots-bundle.`);
  }
  return normalized;
}

function parseRebalanceRouteFallback(value, flagName, CliError) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!['fail', 'public'].includes(normalized)) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be fail|public.`);
  }
  return normalized;
}

function parsePartialHedgePolicy(value, flagName, CliError) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized !== 'partial' && normalized !== 'skip') {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be partial|skip.`);
  }
  return normalized;
}

function parseSellHedgePolicy(value, flagName, CliError) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized !== 'depth-checked' && normalized !== 'manual-only') {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be depth-checked|manual-only.`);
  }
  return normalized;
}

function parseCommonSelectors(args, deps, modeName) {
  const {
    CliError,
    requireFlagValue,
    parseAddressFlag,
  } = deps;

  const options = {
    stateFile: null,
    strategyHash: null,
    pandoraMarketAddress: null,
    polymarketMarketId: null,
    polymarketSlug: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--state-file') {
      options.stateFile = normalizeMirrorPathForMcp(requireFlagValue(args, i, '--state-file'), '--state-file', CliError);
      i += 1;
      continue;
    }
    if (token === '--strategy-hash') {
      const value = String(requireFlagValue(args, i, '--strategy-hash')).trim().toLowerCase();
      if (!/^[a-f0-9]{16}$/.test(value)) {
        throw new CliError('INVALID_FLAG_VALUE', '--strategy-hash must be a 16-character hex value.');
      }
      options.strategyHash = value;
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
    if (String(token || '').startsWith('--')) {
      const next = args[i + 1];
      if (next !== undefined && !String(next).startsWith('--')) {
        i += 1;
      }
      continue;
    }
  }

  const hasStateLookup = Boolean(options.stateFile || options.strategyHash);
  const hasPandoraSelector = Boolean(options.pandoraMarketAddress);
  const hasPolymarketSelector = Boolean(options.polymarketMarketId || options.polymarketSlug);

  if (!hasStateLookup && !(hasPandoraSelector && hasPolymarketSelector)) {
    throw new CliError(
      'MISSING_REQUIRED_FLAG',
      `mirror hedge ${modeName} requires --state-file <path>, --strategy-hash <hash>, or a full market selector pair.`,
    );
  }

  if (!hasStateLookup && (hasPandoraSelector !== hasPolymarketSelector)) {
    throw new CliError(
      'MISSING_REQUIRED_FLAG',
      `mirror hedge ${modeName} requires both --pandora-market-address <address> (or --market-address <address>) and --polymarket-market-id <id> or --polymarket-slug <slug>.`,
    );
  }

  return options;
}

function buildPlanLikeOptionsBase() {
  const envMinHedgeUsdc = Number(process.env.PANDORA_HEDGE_MIN_USDC);
  return {
    internalWalletsFile: normalizeOptionalString(process.env.PANDORA_INTERNAL_WALLETS_FILE),
    minHedgeUsdc: Number.isFinite(envMinHedgeUsdc) && envMinHedgeUsdc > 0 ? envMinHedgeUsdc : 25,
    partialHedgePolicy: String(process.env.PANDORA_HEDGE_PARTIAL_POLICY || 'partial').trim().toLowerCase() || 'partial',
    sellHedgePolicy: String(process.env.PANDORA_HEDGE_SELL_POLICY || 'depth-checked').trim().toLowerCase() || 'depth-checked',
    outputDir: null,
    trustDeploy: false,
    manifestFile: null,
    indexerUrl: null,
    timeoutMs: null,
    driftTriggerBps: 150,
    hedgeTriggerUsdc: 10,
    hedgeRatio: 1,
    hedgeScope: 'total',
    noHedge: false,
    skipInitialHedge: false,
    maxHedgeUsdc: 50,
    maxOpenExposureUsdc: null,
    cooldownMs: 60_000,
    depthSlippageBps: 100,
    minTimeToCloseSec: 1800,
    strictCloseTimeDelta: false,
    rebalanceRoute: 'public',
    rebalanceRouteFallback: 'fail',
    flashbotsRelayUrl: null,
    flashbotsAuthKey: null,
    flashbotsTargetBlockOffset: null,
    polymarketHost: null,
    polymarketGammaUrl: null,
    polymarketGammaMockUrl: null,
    polymarketMockUrl: null,
  };
}

function buildRunLikeOptionsBase() {
  const envMinHedgeUsdc = Number(process.env.PANDORA_HEDGE_MIN_USDC);
  return {
    internalWalletsFile: normalizeOptionalString(process.env.PANDORA_INTERNAL_WALLETS_FILE),
    minHedgeUsdc: Number.isFinite(envMinHedgeUsdc) && envMinHedgeUsdc > 0 ? envMinHedgeUsdc : 25,
    partialHedgePolicy: String(process.env.PANDORA_HEDGE_PARTIAL_POLICY || 'partial').trim().toLowerCase() || 'partial',
    sellHedgePolicy: String(process.env.PANDORA_HEDGE_SELL_POLICY || 'depth-checked').trim().toLowerCase() || 'depth-checked',
    executeLive: false,
    privateKey: null,
    profileId: null,
    profileFile: null,
    funder: null,
    usdc: null,
    chainId: null,
    rpcUrl: null,
    polymarketRpcUrl: null,
    indexerUrl: null,
    timeoutMs: null,
    intervalMs: 5000,
    iterations: null,
    stream: false,
    verbose: false,
    daemon: false,
    adoptExistingPositions: false,
    maxRebalanceUsdc: 25,
    maxTradesPerDay: null,
    webhookUrl: null,
    telegramBotToken: null,
    telegramChatId: null,
    discordWebhookUrl: null,
  };
}

function parsePlanLikeFlags(args, deps, modeName) {
  const {
    CliError,
    requireFlagValue,
    parsePositiveInteger,
    parsePositiveNumber,
    parseInteger,
    isSecureHttpUrlOrLocal,
    defaultMirrorStateFile,
  } = deps;
  const defaultStateFileForHedge = typeof deps.defaultMirrorHedgeStateFile === 'function'
    ? deps.defaultMirrorHedgeStateFile
    : defaultMirrorStateFile;
  const selector = parseCommonSelectors(args, deps, modeName);
  const options = {
    mode: modeName,
    ...selector,
    ...buildPlanLikeOptionsBase(),
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (
      token === '--state-file'
      || token === '--strategy-hash'
      || token === '--pandora-market-address'
      || token === '--market-address'
      || token === '--polymarket-market-id'
      || token === '--polymarket-slug'
    ) {
      i += 1;
      continue;
    }
    if (token === '--trust-deploy') {
      options.trustDeploy = true;
      continue;
    }
    if (token === '--internal-wallets-file') {
      options.internalWalletsFile = normalizeMirrorPathForMcp(requireFlagValue(args, i, '--internal-wallets-file'), '--internal-wallets-file', CliError);
      i += 1;
      continue;
    }
    if (token === '--min-hedge-usdc') {
      options.minHedgeUsdc = parsePositiveNumber(requireFlagValue(args, i, '--min-hedge-usdc'), '--min-hedge-usdc');
      i += 1;
      continue;
    }
    if (token === '--partial-hedge-policy') {
      options.partialHedgePolicy = parsePartialHedgePolicy(requireFlagValue(args, i, '--partial-hedge-policy'), '--partial-hedge-policy', CliError);
      i += 1;
      continue;
    }
    if (token === '--sell-hedge-policy') {
      options.sellHedgePolicy = parseSellHedgePolicy(requireFlagValue(args, i, '--sell-hedge-policy'), '--sell-hedge-policy', CliError);
      i += 1;
      continue;
    }
    if (token === '--output-dir' || token === '--bundle-dir') {
      options.outputDir = normalizeMirrorPathForMcp(requireFlagValue(args, i, token), token, CliError);
      i += 1;
      continue;
    }
    if (token === '--manifest-file') {
      throw new CliError(
        'INVALID_ARGS',
        '--manifest-file is not supported for mirror hedge yet. Use explicit market selectors, --state-file, or --strategy-hash.',
      );
    }
    if (token === '--indexer-url') {
      options.indexerUrl = validateMirrorUrl(requireFlagValue(args, i, '--indexer-url'), '--indexer-url', CliError, isSecureHttpUrlOrLocal);
      i += 1;
      continue;
    }
    if (token === '--timeout-ms') {
      options.timeoutMs = parsePositiveInteger(requireFlagValue(args, i, '--timeout-ms'), '--timeout-ms');
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
    if (token === '--hedge-ratio') {
      options.hedgeRatio = parsePositiveNumber(requireFlagValue(args, i, '--hedge-ratio'), '--hedge-ratio');
      i += 1;
      continue;
    }
    if (token === '--hedge-scope') {
      const value = String(requireFlagValue(args, i, '--hedge-scope')).trim().toLowerCase();
      if (value !== 'pool' && value !== 'total') {
        throw new CliError('INVALID_FLAG_VALUE', '--hedge-scope must be pool|total.');
      }
      options.hedgeScope = value;
      i += 1;
      continue;
    }
    if (token === '--no-hedge') {
      options.noHedge = true;
      continue;
    }
    if (token === '--skip-initial-hedge') {
      options.skipInitialHedge = true;
      continue;
    }
    if (token === '--max-hedge-usdc') {
      options.maxHedgeUsdc = parsePositiveNumber(requireFlagValue(args, i, '--max-hedge-usdc'), '--max-hedge-usdc');
      i += 1;
      continue;
    }
    if (token === '--max-open-exposure-usdc') {
      options.maxOpenExposureUsdc = parsePositiveNumber(requireFlagValue(args, i, '--max-open-exposure-usdc'), '--max-open-exposure-usdc');
      i += 1;
      continue;
    }
    if (token === '--cooldown-ms') {
      options.cooldownMs = parsePositiveInteger(requireFlagValue(args, i, '--cooldown-ms'), '--cooldown-ms');
      i += 1;
      continue;
    }
    if (token === '--depth-slippage-bps') {
      options.depthSlippageBps = parsePositiveInteger(requireFlagValue(args, i, '--depth-slippage-bps'), '--depth-slippage-bps');
      i += 1;
      continue;
    }
    if (token === '--min-time-to-close-sec') {
      options.minTimeToCloseSec = parsePositiveInteger(requireFlagValue(args, i, '--min-time-to-close-sec'), '--min-time-to-close-sec');
      i += 1;
      continue;
    }
    if (token === '--strict-close-time-delta') {
      options.strictCloseTimeDelta = true;
      continue;
    }
    if (token === '--rebalance-route') {
      options.rebalanceRoute = parseRebalanceRoute(requireFlagValue(args, i, '--rebalance-route'), '--rebalance-route', CliError);
      i += 1;
      continue;
    }
    if (token === '--rebalance-route-fallback') {
      options.rebalanceRouteFallback = parseRebalanceRouteFallback(
        requireFlagValue(args, i, '--rebalance-route-fallback'),
        '--rebalance-route-fallback',
        CliError,
      );
      i += 1;
      continue;
    }
    if (token === '--flashbots-relay-url') {
      options.flashbotsRelayUrl = validateMirrorUrl(
        requireFlagValue(args, i, '--flashbots-relay-url'),
        '--flashbots-relay-url',
        CliError,
        isSecureHttpUrlOrLocal,
      );
      i += 1;
      continue;
    }
    if (token === '--flashbots-auth-key') {
      options.flashbotsAuthKey = requireFlagValue(args, i, '--flashbots-auth-key');
      i += 1;
      continue;
    }
    if (token === '--flashbots-target-block-offset') {
      options.flashbotsTargetBlockOffset = parsePositiveInteger(
        requireFlagValue(args, i, '--flashbots-target-block-offset'),
        '--flashbots-target-block-offset',
      );
      i += 1;
      continue;
    }
    if (token === '--polymarket-host') {
      options.polymarketHost = validateMirrorUrl(requireFlagValue(args, i, '--polymarket-host'), '--polymarket-host', CliError, isSecureHttpUrlOrLocal);
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
    if (token === '--state-file') {
      continue;
    }
    if (token === '--strategy-hash') {
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror hedge ${modeName}: ${token}`);
  }

  const hasStateLookup = Boolean(options.stateFile || options.strategyHash);
  const hasPandoraSelector = Boolean(options.pandoraMarketAddress);
  const hasPolymarketSelector = Boolean(options.polymarketMarketId || options.polymarketSlug);
  if (!hasStateLookup && !(hasPandoraSelector && hasPolymarketSelector)) {
    throw new CliError(
      'MISSING_REQUIRED_FLAG',
      `mirror hedge ${modeName} requires --state-file <path>, --strategy-hash <hash>, or a full market selector pair.`,
    );
  }
  if (!hasStateLookup && (hasPandoraSelector !== hasPolymarketSelector)) {
    throw new CliError(
      'MISSING_REQUIRED_FLAG',
      `mirror hedge ${modeName} requires both --pandora-market-address <address> (or --market-address <address>) and --polymarket-market-id <id> or --polymarket-slug <slug>.`,
    );
  }

  if (!options.stateFile) {
    options.stateFile = defaultMirrorWorkspacePath(defaultStateFileForHedge({
      mode: modeName,
      pandoraMarketAddress: options.pandoraMarketAddress,
      polymarketMarketId: options.polymarketMarketId,
      polymarketSlug: options.polymarketSlug,
      executeLive: false,
      driftTriggerBps: options.driftTriggerBps,
      hedgeEnabled: !options.noHedge,
      hedgeRatio: options.hedgeRatio,
      hedgeTriggerUsdc: options.hedgeTriggerUsdc,
      strictCloseTimeDelta: options.strictCloseTimeDelta,
      forceGate: false,
      skipGateChecks: [],
    }));
  }

  return options;
}

function parseRunLikeFlags(args, deps, modeName) {
  const {
    CliError,
    requireFlagValue,
    parseAddressFlag,
    parsePrivateKeyFlag,
    parsePositiveInteger,
    parsePositiveNumber,
    parseInteger,
    isSecureHttpUrlOrLocal,
    parseWebhookFlagIntoOptions,
    defaultMirrorStateFile,
    defaultMirrorKillSwitchFile,
  } = deps;
  const defaultStateFileForHedge = typeof deps.defaultMirrorHedgeStateFile === 'function'
    ? deps.defaultMirrorHedgeStateFile
    : defaultMirrorStateFile;
  const defaultKillSwitchFileForHedge = typeof deps.defaultMirrorHedgeKillSwitchFile === 'function'
    ? deps.defaultMirrorHedgeKillSwitchFile
    : defaultMirrorKillSwitchFile;
  const options = {
    mode: modeName,
    stateFile: null,
    killSwitchFile: null,
    strategyHash: null,
    pandoraMarketAddress: null,
    polymarketMarketId: null,
    polymarketSlug: null,
    executeLive: false,
    privateKey: null,
    profileId: null,
    profileFile: null,
    funder: null,
    usdc: null,
    chainId: null,
    rpcUrl: null,
    polymarketRpcUrl: null,
    intervalMs: 5000,
    iterations: null,
    stream: false,
    verbose: false,
    daemon: modeName === 'start',
    adoptExistingPositions: false,
    trustDeploy: false,
    driftTriggerBps: 150,
    hedgeTriggerUsdc: 10,
    hedgeRatio: 1,
    hedgeScope: 'total',
    noHedge: false,
    skipInitialHedge: false,
    maxRebalanceUsdc: 25,
    maxHedgeUsdc: 50,
    maxOpenExposureUsdc: null,
    maxTradesPerDay: null,
    cooldownMs: 60_000,
    depthSlippageBps: 100,
    minTimeToCloseSec: 1800,
    strictCloseTimeDelta: false,
    rebalanceRoute: 'public',
    rebalanceRouteFallback: 'fail',
    flashbotsRelayUrl: null,
    flashbotsAuthKey: null,
    flashbotsTargetBlockOffset: null,
    polymarketHost: null,
    polymarketGammaUrl: null,
    polymarketGammaMockUrl: null,
    polymarketMockUrl: null,
    webhookUrl: null,
    telegramBotToken: null,
    telegramChatId: null,
    discordWebhookUrl: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--state-file') {
      options.stateFile = normalizeMirrorPathForMcp(requireFlagValue(args, i, '--state-file'), '--state-file', CliError);
      i += 1;
      continue;
    }
    if (token === '--strategy-hash') {
      const value = String(requireFlagValue(args, i, '--strategy-hash')).trim().toLowerCase();
      if (!/^[a-f0-9]{16}$/.test(value)) {
        throw new CliError('INVALID_FLAG_VALUE', '--strategy-hash must be a 16-character hex value.');
      }
      options.strategyHash = value;
      i += 1;
      continue;
    }
    if (token === '--internal-wallets-file') {
      options.internalWalletsFile = normalizeMirrorPathForMcp(requireFlagValue(args, i, '--internal-wallets-file'), '--internal-wallets-file', CliError);
      i += 1;
      continue;
    }
    if (token === '--min-hedge-usdc') {
      options.minHedgeUsdc = parsePositiveNumber(requireFlagValue(args, i, '--min-hedge-usdc'), '--min-hedge-usdc');
      i += 1;
      continue;
    }
    if (token === '--partial-hedge-policy') {
      options.partialHedgePolicy = parsePartialHedgePolicy(requireFlagValue(args, i, '--partial-hedge-policy'), '--partial-hedge-policy', CliError);
      i += 1;
      continue;
    }
    if (token === '--sell-hedge-policy') {
      options.sellHedgePolicy = parseSellHedgePolicy(requireFlagValue(args, i, '--sell-hedge-policy'), '--sell-hedge-policy', CliError);
      i += 1;
      continue;
    }
    if (token === '--kill-switch-file') {
      options.killSwitchFile = normalizeMirrorPathForMcp(
        requireFlagValue(args, i, '--kill-switch-file'),
        '--kill-switch-file',
        CliError,
      );
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
    if (token === '--paper' || token === '--dry-run') {
      options.executeLive = false;
      continue;
    }
    if (token === '--execute-live' || token === '--execute') {
      options.executeLive = true;
      continue;
    }
    if (token === '--private-key') {
      options.privateKey = parsePrivateKeyFlag(requireFlagValue(args, i, '--private-key'), '--private-key');
      i += 1;
      continue;
    }
    if (token === '--profile-id') {
      options.profileId = requireFlagValue(args, i, '--profile-id');
      i += 1;
      continue;
    }
    if (token === '--profile-file') {
      options.profileFile = normalizeMirrorPathForMcp(requireFlagValue(args, i, '--profile-file'), '--profile-file', CliError);
      i += 1;
      continue;
    }
    if (token === '--funder') {
      options.funder = parseAddressFlag(requireFlagValue(args, i, '--funder'), '--funder');
      i += 1;
      continue;
    }
    if (token === '--usdc') {
      options.usdc = parseAddressFlag(requireFlagValue(args, i, '--usdc'), '--usdc');
      i += 1;
      continue;
    }
    if (token === '--chain-id') {
      options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
      i += 1;
      continue;
    }
    if (token === '--indexer-url') {
      options.indexerUrl = validateMirrorUrl(
        requireFlagValue(args, i, '--indexer-url'),
        '--indexer-url',
        CliError,
        isSecureHttpUrlOrLocal,
      );
      i += 1;
      continue;
    }
    if (token === '--timeout-ms') {
      options.timeoutMs = parsePositiveInteger(requireFlagValue(args, i, '--timeout-ms'), '--timeout-ms');
      i += 1;
      continue;
    }
    if (token === '--rpc-url') {
      options.rpcUrl = parseSecureUrlList(requireFlagValue(args, i, '--rpc-url'), '--rpc-url', CliError, isSecureHttpUrlOrLocal);
      i += 1;
      continue;
    }
    if (token === '--polymarket-rpc-url') {
      options.polymarketRpcUrl = parseSecureUrlList(
        requireFlagValue(args, i, '--polymarket-rpc-url'),
        '--polymarket-rpc-url',
        CliError,
        isSecureHttpUrlOrLocal,
      );
      i += 1;
      continue;
    }
    if (token === '--interval-ms') {
      options.intervalMs = parsePositiveInteger(requireFlagValue(args, i, '--interval-ms'), '--interval-ms');
      i += 1;
      continue;
    }
    if (token === '--iterations') {
      options.iterations = parsePositiveInteger(requireFlagValue(args, i, '--iterations'), '--iterations');
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
      if (modeName !== 'start') {
        throw new CliError('INVALID_ARGS', '--daemon is only supported for mirror hedge start.');
      }
      options.daemon = true;
      continue;
    }
    if (token === '--adopt-existing-positions') {
      options.adoptExistingPositions = true;
      continue;
    }
    if (token === '--trust-deploy') {
      options.trustDeploy = true;
      continue;
    }
    if (token === '--manifest-file') {
      throw new CliError(
        'INVALID_ARGS',
        '--manifest-file is not supported for mirror hedge yet. Use explicit market selectors, --state-file, or --strategy-hash.',
      );
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
    if (token === '--hedge-ratio') {
      options.hedgeRatio = parsePositiveNumber(requireFlagValue(args, i, '--hedge-ratio'), '--hedge-ratio');
      i += 1;
      continue;
    }
    if (token === '--hedge-scope') {
      const value = String(requireFlagValue(args, i, '--hedge-scope')).trim().toLowerCase();
      if (value !== 'pool' && value !== 'total') {
        throw new CliError('INVALID_FLAG_VALUE', '--hedge-scope must be pool|total.');
      }
      options.hedgeScope = value;
      i += 1;
      continue;
    }
    if (token === '--no-hedge') {
      options.noHedge = true;
      continue;
    }
    if (token === '--skip-initial-hedge') {
      options.skipInitialHedge = true;
      continue;
    }
    if (token === '--max-rebalance-usdc') {
      options.maxRebalanceUsdc = parsePositiveNumber(requireFlagValue(args, i, '--max-rebalance-usdc'), '--max-rebalance-usdc');
      i += 1;
      continue;
    }
    if (token === '--max-hedge-usdc') {
      options.maxHedgeUsdc = parsePositiveNumber(requireFlagValue(args, i, '--max-hedge-usdc'), '--max-hedge-usdc');
      i += 1;
      continue;
    }
    if (token === '--max-open-exposure-usdc') {
      options.maxOpenExposureUsdc = parsePositiveNumber(requireFlagValue(args, i, '--max-open-exposure-usdc'), '--max-open-exposure-usdc');
      i += 1;
      continue;
    }
    if (token === '--max-trades-per-day') {
      options.maxTradesPerDay = parsePositiveInteger(requireFlagValue(args, i, '--max-trades-per-day'), '--max-trades-per-day');
      i += 1;
      continue;
    }
    if (token === '--cooldown-ms') {
      options.cooldownMs = parsePositiveInteger(requireFlagValue(args, i, '--cooldown-ms'), '--cooldown-ms');
      i += 1;
      continue;
    }
    if (token === '--depth-slippage-bps') {
      options.depthSlippageBps = parsePositiveInteger(requireFlagValue(args, i, '--depth-slippage-bps'), '--depth-slippage-bps');
      i += 1;
      continue;
    }
    if (token === '--min-time-to-close-sec') {
      options.minTimeToCloseSec = parsePositiveInteger(requireFlagValue(args, i, '--min-time-to-close-sec'), '--min-time-to-close-sec');
      i += 1;
      continue;
    }
    if (token === '--strict-close-time-delta') {
      options.strictCloseTimeDelta = true;
      continue;
    }
    if (token === '--rebalance-route') {
      options.rebalanceRoute = parseRebalanceRoute(requireFlagValue(args, i, '--rebalance-route'), '--rebalance-route', CliError);
      i += 1;
      continue;
    }
    if (token === '--rebalance-route-fallback') {
      options.rebalanceRouteFallback = parseRebalanceRouteFallback(
        requireFlagValue(args, i, '--rebalance-route-fallback'),
        '--rebalance-route-fallback',
        CliError,
      );
      i += 1;
      continue;
    }
    if (token === '--flashbots-relay-url') {
      options.flashbotsRelayUrl = validateMirrorUrl(
        requireFlagValue(args, i, '--flashbots-relay-url'),
        '--flashbots-relay-url',
        CliError,
        isSecureHttpUrlOrLocal,
      );
      i += 1;
      continue;
    }
    if (token === '--flashbots-auth-key') {
      options.flashbotsAuthKey = requireFlagValue(args, i, '--flashbots-auth-key');
      i += 1;
      continue;
    }
    if (token === '--flashbots-target-block-offset') {
      options.flashbotsTargetBlockOffset = parsePositiveInteger(
        requireFlagValue(args, i, '--flashbots-target-block-offset'),
        '--flashbots-target-block-offset',
      );
      i += 1;
      continue;
    }
    if (token === '--polymarket-host') {
      options.polymarketHost = validateMirrorUrl(requireFlagValue(args, i, '--polymarket-host'), '--polymarket-host', CliError, isSecureHttpUrlOrLocal);
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
    const webhookStep = parseWebhookFlagIntoOptions(args, i, token, options);
    if (webhookStep !== null) {
      i += webhookStep;
      continue;
    }
    throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror hedge ${modeName}: ${token}`);
  }

  if (!options.stateFile) {
    const defaultStateFileOptions = options.strategyHash
      ? { strategyHash: options.strategyHash }
      : {
          mode: modeName,
          pandoraMarketAddress: options.pandoraMarketAddress,
          polymarketMarketId: options.polymarketMarketId,
          polymarketSlug: options.polymarketSlug,
          executeLive: options.executeLive,
          driftTriggerBps: options.driftTriggerBps,
          hedgeEnabled: !options.noHedge,
          hedgeRatio: options.hedgeRatio,
          hedgeTriggerUsdc: options.hedgeTriggerUsdc,
          strictCloseTimeDelta: options.strictCloseTimeDelta,
          forceGate: false,
          skipGateChecks: [],
        };
    options.stateFile = defaultMirrorWorkspacePath(defaultStateFileForHedge(defaultStateFileOptions));
  }
  if (!options.killSwitchFile) {
    options.killSwitchFile = defaultMirrorWorkspacePath(defaultKillSwitchFileForHedge());
  }

  return options;
}

function createParseMirrorHedgePlanFlags(deps) {
  requireDep(deps, 'CliError');
  return function parseMirrorHedgePlanFlags(args) {
    const mode = args[0];
    if (mode !== 'plan' && mode !== 'bundle') {
      throw new Error('mirror hedge plan parser requires subcommand plan|bundle.');
    }
    return parsePlanLikeFlags(args.slice(1), deps, mode);
  };
}

function createParseMirrorHedgeRunFlags(deps) {
  return function parseMirrorHedgeRunFlags(args) {
    const mode = args[0];
    if (mode !== 'run' && mode !== 'start') {
      throw new Error('mirror hedge run parser requires subcommand run|start.');
    }
    return parseRunLikeFlags(args.slice(1), deps, mode);
  };
}

function createParseMirrorHedgeDaemonSelectorFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');

  return function parseMirrorHedgeDaemonSelectorFlags(args, actionName) {
    const options = {
      pidFile: null,
      strategyHash: null,
      marketAddress: null,
      all: false,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--pid-file') {
        options.pidFile = normalizeMirrorPathForMcp(requireFlagValue(args, i, '--pid-file'), '--pid-file', CliError);
        i += 1;
        continue;
      }
      if (token === '--strategy-hash') {
        const value = String(requireFlagValue(args, i, '--strategy-hash')).trim().toLowerCase();
        if (!/^[a-f0-9]{16}$/.test(value)) {
          throw new CliError('INVALID_FLAG_VALUE', '--strategy-hash must be a 16-character hex value.');
        }
        options.strategyHash = value;
        i += 1;
        continue;
      }
      if (token === '--market-address') {
        if (actionName !== 'stop') {
          throw new CliError('INVALID_ARGS', '--market-address selector is only supported for mirror hedge stop.');
        }
        options.marketAddress = parseAddressFlag(requireFlagValue(args, i, '--market-address'), '--market-address');
        i += 1;
        continue;
      }
      if (token === '--all') {
        if (actionName !== 'stop') {
          throw new CliError('INVALID_ARGS', '--all selector is only supported for mirror hedge stop.');
        }
        options.all = true;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror hedge ${actionName}: ${token}`);
    }

    if (!options.pidFile && !options.strategyHash && !options.marketAddress && !options.all) {
      throw new CliError(
        'MISSING_REQUIRED_FLAG',
        `mirror hedge ${actionName} requires --pid-file <path>, --strategy-hash <hash>, --market-address <address>, or --all.`,
      );
    }

    return options;
  };
}

module.exports = {
  createParseMirrorHedgePlanFlags,
  createParseMirrorHedgeRunFlags,
  createParseMirrorHedgeDaemonSelectorFlags,
};
