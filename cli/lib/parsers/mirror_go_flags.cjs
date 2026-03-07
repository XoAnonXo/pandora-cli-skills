const { MIN_AMM_FEE_TIER, MAX_AMM_FEE_TIER } = require('../shared/constants.cjs');
const { parsePollCategoryFlag, DEFAULT_SPORTS_POLL_CATEGORY } = require('../shared/poll_categories.cjs');
const { normalizeMirrorPathForMcp, parseMirrorTargetTimestamp, validateMirrorUrl } = require('./mirror_parser_guard.cjs');

const MAX_UINT24 = 16_777_215;
const DISTRIBUTION_SCALE = 1_000_000_000;

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParseMirrorGoFlags requires deps.${name}()`);
  }
  return deps[name];
}

function normalizeSources(entries) {
  const values = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const parts = String(entry || '').split(/[\n,]/g);
    for (const part of parts) {
      const normalized = String(part || '').trim();
      if (normalized) values.push(normalized);
    }
  }
  return values;
}

function preserveExplicitZero(value) {
  // Keep explicit zero truthy so downstream `value || default` fallbacks do not overwrite it.
  return value === 0 ? Object(0) : value;
}

function parseUint24Like(value, flagName, CliError, parseInteger) {
  const parsed = parseInteger(value, flagName);
  if (parsed < 0 || parsed > MAX_UINT24) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be an integer between 0 and ${MAX_UINT24}.`);
  }
  return preserveExplicitZero(parsed);
}

function parseDistributionUnits(value, flagName, CliError, parseInteger) {
  const parsed = parseInteger(value, flagName);
  if (parsed < 0 || parsed > DISTRIBUTION_SCALE) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be an integer between 0 and ${DISTRIBUTION_SCALE}.`);
  }
  return parsed;
}

function parseDistributionPercent(value, flagName, CliError) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be between 0 and 100.`);
  }
  return parsed;
}

function finalizeDistribution(options, CliError) {
  const hasRaw = options.distributionYes !== null || options.distributionNo !== null;
  const hasPct = options.distributionYesPct !== null || options.distributionNoPct !== null;

  if (hasRaw && hasPct) {
    throw new CliError(
      'INVALID_ARGS',
      'Use either raw distribution flags (--distribution-yes/--distribution-no) or percentage flags (--distribution-yes-pct/--distribution-no-pct), not both.',
    );
  }

  if (hasPct) {
    const hasYesPct = options.distributionYesPct !== null;
    const hasNoPct = options.distributionNoPct !== null;
    if (hasYesPct && hasNoPct) {
      const total = options.distributionYesPct + options.distributionNoPct;
      if (Math.abs(total - 100) > 1e-9) {
        throw new CliError('INVALID_ARGS', '--distribution-yes-pct + --distribution-no-pct must equal 100.');
      }
    }

    const yesPct = hasYesPct ? options.distributionYesPct : 100 - options.distributionNoPct;
    const distributionYes = Math.round(yesPct * (DISTRIBUTION_SCALE / 100));
    options.distributionYes = distributionYes;
    options.distributionNo = DISTRIBUTION_SCALE - distributionYes;
  }
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
      maxImbalance: MAX_UINT24,
      category: DEFAULT_SPORTS_POLL_CATEGORY,
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
      polymarketRpcUrl: null,
      privateKey: null,
      funder: null,
      usdc: null,
      oracle: null,
      factory: null,
      distributionYes: null,
      distributionNo: null,
      distributionYesPct: null,
      distributionNoPct: null,
      sources: [],
      sourcesProvided: false,
      validationTicket: null,
      targetTimestamp: null,
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
        options.maxImbalance = parseUint24Like(
          requireFlagValue(args, i, '--max-imbalance'),
          '--max-imbalance',
          CliError,
          parseInteger,
        );
        i += 1;
        continue;
      }
      if (token === '--arbiter') {
        options.arbiter = parseAddressFlag(requireFlagValue(args, i, '--arbiter'), '--arbiter');
        i += 1;
        continue;
      }
      if (token === '--category') {
        options.category = parsePollCategoryFlag(requireFlagValue(args, i, '--category'), '--category', CliError);
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
      if (token === '--polymarket-rpc-url') {
        const polymarketRpcUrl = requireFlagValue(args, i, '--polymarket-rpc-url');
        if (!isSecureHttpUrlOrLocal(polymarketRpcUrl)) {
          throw new CliError(
            'INVALID_FLAG_VALUE',
            '--polymarket-rpc-url must use https:// (or http://localhost/127.0.0.1 for local testing).',
          );
        }
        options.polymarketRpcUrl = polymarketRpcUrl;
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
      if (token === '--distribution-yes') {
        options.distributionYes = parseDistributionUnits(
          requireFlagValue(args, i, '--distribution-yes'),
          '--distribution-yes',
          CliError,
          parseInteger,
        );
        i += 1;
        continue;
      }
      if (token === '--distribution-no') {
        options.distributionNo = parseDistributionUnits(
          requireFlagValue(args, i, '--distribution-no'),
          '--distribution-no',
          CliError,
          parseInteger,
        );
        i += 1;
        continue;
      }
      if (token === '--distribution-yes-pct') {
        options.distributionYesPct = parseDistributionPercent(
          requireFlagValue(args, i, '--distribution-yes-pct'),
          '--distribution-yes-pct',
          CliError,
        );
        i += 1;
        continue;
      }
      if (token === '--distribution-no-pct') {
        options.distributionNoPct = parseDistributionPercent(
          requireFlagValue(args, i, '--distribution-no-pct'),
          '--distribution-no-pct',
          CliError,
        );
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
        options.sourcesProvided = true;
        options.sources.push(...entries);
        i = j - 1;
        continue;
      }
      if (token === '--validation-ticket') {
        options.validationTicket = requireFlagValue(args, i, '--validation-ticket');
        i += 1;
        continue;
      }
      if (token === '--target-timestamp') {
        options.targetTimestamp = parseMirrorTargetTimestamp(
          requireFlagValue(args, i, '--target-timestamp'),
          '--target-timestamp',
          CliError,
        );
        i += 1;
        continue;
      }
      if (token === '--manifest-file') {
        options.manifestFile = normalizeMirrorPathForMcp(
          requireFlagValue(args, i, '--manifest-file'),
          '--manifest-file',
          CliError,
        );
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
    if (options.feeTier < MIN_AMM_FEE_TIER || options.feeTier > MAX_AMM_FEE_TIER) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        `--fee-tier must be between ${MIN_AMM_FEE_TIER} and ${MAX_AMM_FEE_TIER} (max 5%).`,
      );
    }
    finalizeDistribution(options, CliError);
    if (
      (options.distributionYes === null && options.distributionNo !== null) ||
      (options.distributionYes !== null && options.distributionNo === null)
    ) {
      throw new CliError('INVALID_ARGS', 'Provide both --distribution-yes and --distribution-no together.');
    }
    if (
      options.distributionYes !== null &&
      options.distributionNo !== null &&
      options.distributionYes + options.distributionNo !== DISTRIBUTION_SCALE
    ) {
      throw new CliError('INVALID_ARGS', '--distribution-yes + --distribution-no must equal 1000000000.');
    }
    if (options.hedgeRatio > 2) {
      throw new CliError('INVALID_FLAG_VALUE', '--hedge-ratio must be <= 2.');
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
    }
    if (options.sourcesProvided && normalizeSources(options.sources).length < 2) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        '--sources requires at least two non-empty URLs when explicitly provided.',
      );
    }

    return options;
  };
}

/** Public mirror go parser factory export. */
module.exports = {
  createParseMirrorGoFlags,
};
