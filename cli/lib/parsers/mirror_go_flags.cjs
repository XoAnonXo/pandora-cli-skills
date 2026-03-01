function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParseMirrorGoFlags requires deps.${name}()`);
  }
  return deps[name];
}

/**
 * Creates the mirror go flags parser.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseMirrorGoFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const parsePrivateKeyFlag = requireDep(deps, 'parsePrivateKeyFlag');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parseInteger = requireDep(deps, 'parseInteger');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');
  const parseMirrorSyncGateSkipList = requireDep(deps, 'parseMirrorSyncGateSkipList');
  const mergeMirrorSyncGateSkipLists = requireDep(deps, 'mergeMirrorSyncGateSkipLists');

  return function parseMirrorGoFlags(args) {
    const options = {
      polymarketMarketId: null,
      polymarketSlug: null,
      liquidityUsdc: null,
      feeTier: 3000,
      maxImbalance: 10_000,
      category: 3,
      arbiter: null,
      paper: true,
      executeLive: false,
      autoSync: false,
      syncOnce: false,
      syncIntervalMs: 5_000,
      driftTriggerBps: 150,
      hedgeTriggerUsdc: 10,
      hedgeRatio: 1,
      noHedge: false,
      maxRebalanceUsdc: 25,
      maxHedgeUsdc: 50,
      maxOpenExposureUsdc: null,
      maxTradesPerDay: null,
      cooldownMs: 60_000,
      chainId: null,
      rpcUrl: null,
      privateKey: null,
      funder: null,
      usdc: null,
      oracle: null,
      factory: null,
      sources: [],
      manifestFile: null,
      trustDeploy: false,
      forceGate: false,
      forceGateDeprecatedUsed: false,
      skipGateChecks: [],
      polymarketHost: null,
      polymarketGammaUrl: null,
      polymarketGammaMockUrl: null,
      polymarketMockUrl: null,
      withRules: false,
      includeSimilarity: false,
      minCloseLeadSeconds: 3600,
    };
    let sawPaperModeFlag = false;
    let sawExecuteLiveModeFlag = false;

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
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
      if (token === '--liquidity-usdc') {
        options.liquidityUsdc = parsePositiveNumber(requireFlagValue(args, i, '--liquidity-usdc'), '--liquidity-usdc');
        i += 1;
        continue;
      }
      if (token === '--fee-tier') {
        options.feeTier = parsePositiveInteger(requireFlagValue(args, i, '--fee-tier'), '--fee-tier');
        i += 1;
        continue;
      }
      if (token === '--max-imbalance') {
        options.maxImbalance = parsePositiveInteger(requireFlagValue(args, i, '--max-imbalance'), '--max-imbalance');
        i += 1;
        continue;
      }
      if (token === '--arbiter') {
        options.arbiter = parseAddressFlag(requireFlagValue(args, i, '--arbiter'), '--arbiter');
        i += 1;
        continue;
      }
      if (token === '--category') {
        options.category = parseInteger(requireFlagValue(args, i, '--category'), '--category');
        i += 1;
        continue;
      }
      if (token === '--paper' || token === '--dry-run') {
        sawPaperModeFlag = true;
        options.paper = true;
        options.executeLive = false;
        continue;
      }
      if (token === '--execute-live' || token === '--execute') {
        sawExecuteLiveModeFlag = true;
        options.executeLive = true;
        options.paper = false;
        continue;
      }
      if (token === '--auto-sync') {
        options.autoSync = true;
        continue;
      }
      if (token === '--sync-once') {
        options.syncOnce = true;
        continue;
      }
      if (token === '--sync-interval-ms') {
        options.syncIntervalMs = parsePositiveInteger(requireFlagValue(args, i, '--sync-interval-ms'), '--sync-interval-ms');
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
      if (token === '--no-hedge') {
        options.noHedge = true;
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
        options.maxOpenExposureUsdc = parsePositiveNumber(
          requireFlagValue(args, i, '--max-open-exposure-usdc'),
          '--max-open-exposure-usdc',
        );
        i += 1;
        continue;
      }
      if (token === '--max-trades-per-day') {
        options.maxTradesPerDay = parsePositiveInteger(
          requireFlagValue(args, i, '--max-trades-per-day'),
          '--max-trades-per-day',
        );
        i += 1;
        continue;
      }
      if (token === '--cooldown-ms') {
        options.cooldownMs = parsePositiveInteger(requireFlagValue(args, i, '--cooldown-ms'), '--cooldown-ms');
        i += 1;
        continue;
      }
      if (token === '--chain-id') {
        options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
        i += 1;
        continue;
      }
      if (token === '--rpc-url') {
        const rpcUrl = requireFlagValue(args, i, '--rpc-url');
        if (!isSecureHttpUrlOrLocal(rpcUrl)) {
          throw new CliError(
            'INVALID_FLAG_VALUE',
            '--rpc-url must use https:// (or http://localhost/127.0.0.1 for local testing).',
          );
        }
        options.rpcUrl = rpcUrl;
        i += 1;
        continue;
      }
      if (token === '--private-key') {
        options.privateKey = parsePrivateKeyFlag(requireFlagValue(args, i, '--private-key'), '--private-key');
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
      if (token === '--oracle') {
        options.oracle = parseAddressFlag(requireFlagValue(args, i, '--oracle'), '--oracle');
        i += 1;
        continue;
      }
      if (token === '--factory') {
        options.factory = parseAddressFlag(requireFlagValue(args, i, '--factory'), '--factory');
        i += 1;
        continue;
      }
      if (token === '--sources') {
        let j = i + 1;
        const entries = [];
        while (j < args.length && !args[j].startsWith('--')) {
          entries.push(args[j]);
          j += 1;
        }
        if (!entries.length) {
          throw new CliError('MISSING_FLAG_VALUE', 'Missing value for --sources');
        }
        options.sources.push(...entries);
        i = j - 1;
        continue;
      }
      if (token === '--manifest-file') {
        options.manifestFile = requireFlagValue(args, i, '--manifest-file');
        i += 1;
        continue;
      }
      if (token === '--trust-deploy') {
        options.trustDeploy = true;
        continue;
      }
      if (token === '--skip-gate') {
        const next = args[i + 1];
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
      if (token === '--polymarket-host') {
        const polymarketHost = requireFlagValue(args, i, '--polymarket-host');
        if (!isSecureHttpUrlOrLocal(polymarketHost)) {
          throw new CliError(
            'INVALID_FLAG_VALUE',
            '--polymarket-host must use https:// (or http://localhost/127.0.0.1 for local testing).',
          );
        }
        options.polymarketHost = polymarketHost;
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
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror go: ${token}`);
    }

    if (!options.polymarketMarketId && !options.polymarketSlug) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'mirror go requires --polymarket-market-id <id> or --polymarket-slug <slug>.');
    }
    if (sawPaperModeFlag && sawExecuteLiveModeFlag) {
      throw new CliError(
        'INVALID_ARGS',
        'mirror go accepts only one mode flag: --paper/--dry-run or --execute-live/--execute.',
      );
    }
    if (![500, 3000, 10000].includes(options.feeTier)) {
      throw new CliError('INVALID_FLAG_VALUE', '--fee-tier must be one of 500, 3000, 10000.');
    }
    if (options.hedgeRatio > 2) {
      throw new CliError('INVALID_FLAG_VALUE', '--hedge-ratio must be <= 2.');
    }
    if (options.executeLive) {
      if (options.maxOpenExposureUsdc === null) {
        throw new CliError('MISSING_REQUIRED_FLAG', 'Live mode requires --max-open-exposure-usdc.');
      }
      if (options.maxTradesPerDay === null) {
        throw new CliError('MISSING_REQUIRED_FLAG', 'Live mode requires --max-trades-per-day.');
      }
    }

    return options;
  };
}

/** Public mirror go parser factory export. */
module.exports = {
  createParseMirrorGoFlags,
};
