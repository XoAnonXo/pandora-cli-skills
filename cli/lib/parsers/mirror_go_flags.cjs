const { MIN_AMM_FEE_TIER, MAX_AMM_FEE_TIER } = require('../shared/constants.cjs');
const { parsePollCategoryFlag, DEFAULT_SPORTS_POLL_CATEGORY } = require('../shared/poll_categories.cjs');
const {
  DISTRIBUTION_SCALE,
  normalizePercent,
  deriveDistributionFromInitialYesProbabilityPct,
  LEGACY_DISTRIBUTION_YES_PCT_FLAG,
  LEGACY_DISTRIBUTION_NO_PCT_FLAG,
  YES_RESERVE_WEIGHT_PCT_FLAG,
  NO_RESERVE_WEIGHT_PCT_FLAG,
  buildLegacyDistributionPercentMigrationMessage,
} = require('../shared/amm_distribution_contract.cjs');
const { normalizeMirrorPathForMcp, parseMirrorTargetTimestamp, validateMirrorUrl } = require('./mirror_parser_guard.cjs');
const { consumeProfileSelectorFlag } = require('./shared_profile_selector_flags.cjs');
const { normalizeResolutionSources, readResolutionSourcesEnv } = require('../shared/resolution_sources.cjs');

const MAX_UINT24 = 16_777_215;
const REBALANCE_ROUTE_VALUES = new Set(['public', 'auto', 'flashbots-private', 'flashbots-bundle']);
const REBALANCE_ROUTE_FALLBACK_VALUES = new Set(['fail', 'public']);

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParseMirrorGoFlags requires deps.${name}()`);
  }
  return deps[name];
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
  const parsed = normalizePercent(value);
  if (parsed === null) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be between 0 and 100.`);
  }
  return parsed;
}

function parseHedgeScope(value, flagName, CliError) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized !== 'pool' && normalized !== 'total') {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be pool|total.`);
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

function finalizeDistribution(options, CliError) {
  const hasRaw = options.distributionYes !== null || options.distributionNo !== null;
  const hasReservePct = options.yesReserveWeightPct !== null || options.noReserveWeightPct !== null;
  const hasInitialProbabilityPct = options.initialYesPct !== null || options.initialNoPct !== null;

  if (
    Number(hasRaw)
    + Number(hasReservePct)
    + Number(hasInitialProbabilityPct)
    > 1
  ) {
    throw new CliError(
      'INVALID_ARGS',
      `Use exactly one AMM distribution input style: raw reserve weights (--distribution-yes/--distribution-no), explicit reserve-weight percents (${YES_RESERVE_WEIGHT_PCT_FLAG}/${NO_RESERVE_WEIGHT_PCT_FLAG}), or probability-native flags (--initial-yes-pct/--initial-no-pct).`,
    );
  }

  if (hasReservePct) {
    const hasYesPct = options.yesReserveWeightPct !== null;
    const hasNoPct = options.noReserveWeightPct !== null;
    if (hasYesPct && hasNoPct) {
      const total = options.yesReserveWeightPct + options.noReserveWeightPct;
      if (Math.abs(total - 100) > 1e-9) {
        throw new CliError('INVALID_ARGS', `${YES_RESERVE_WEIGHT_PCT_FLAG} + ${NO_RESERVE_WEIGHT_PCT_FLAG} must equal 100.`);
      }
    }

    const yesPct = hasYesPct ? options.yesReserveWeightPct : 100 - options.noReserveWeightPct;
    const distributionYes = Math.round(yesPct * (DISTRIBUTION_SCALE / 100));
    options.distributionYes = distributionYes;
    options.distributionNo = DISTRIBUTION_SCALE - distributionYes;
    options.distributionInputMode = 'reserve-weight-pct';
  }

  if (hasInitialProbabilityPct) {
    const hasInitialYesPct = options.initialYesPct !== null;
    const hasInitialNoPct = options.initialNoPct !== null;
    if (hasInitialYesPct && hasInitialNoPct) {
      const total = options.initialYesPct + options.initialNoPct;
      if (Math.abs(total - 100) > 1e-9) {
        throw new CliError('INVALID_ARGS', '--initial-yes-pct + --initial-no-pct must equal 100.');
      }
    }

    const initialYesPct = hasInitialYesPct ? options.initialYesPct : 100 - options.initialNoPct;
    const derived = deriveDistributionFromInitialYesProbabilityPct(initialYesPct);
    options.distributionYes = derived.distributionYes;
    options.distributionNo = derived.distributionNo;
    options.distributionInputMode = 'initial-probability-pct';
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
      autoResolve: false,
      autoClose: false,
      syncOnce: false,
      syncIntervalMs: 5_000,
      resolveAnswer: null,
      resolveReason: null,
      resolveWatchIntervalMs: 5_000,
      resolveWatchTimeoutMs: 15 * 60_000,
      driftTriggerBps: 150,
      hedgeTriggerUsdc: 10,
      hedgeRatio: 1,
      hedgeScope: 'total',
      skipInitialHedge: false,
      rebalanceSizingMode: 'atomic',
      priceSource: 'on-chain',
      rebalanceRoute: 'public',
      rebalanceRouteFallback: 'fail',
      flashbotsRelayUrl: null,
      flashbotsAuthKey: null,
      flashbotsTargetBlockOffset: null,
      noHedge: false,
      maxRebalanceUsdc: 25,
      maxHedgeUsdc: 50,
      maxOpenExposureUsdc: null,
      maxTradesPerDay: null,
      cooldownMs: 60_000,
      depthSlippageBps: 100,
      minTimeToCloseSec: 1800,
      strictCloseTimeDelta: false,
      chainId: null,
      rpcUrl: null,
      polymarketRpcUrl: null,
      privateKey: null,
      profileId: null,
      profileFile: null,
      funder: null,
      usdc: null,
      oracle: null,
      factory: null,
      distributionYes: null,
      distributionNo: null,
      yesReserveWeightPct: null,
      noReserveWeightPct: null,
      initialYesPct: null,
      initialNoPct: null,
      distributionInputMode: null,
      sources: [],
      sourcesProvided: false,
      sourcesSource: null,
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
      if (token === '--auto-resolve') {
        options.autoResolve = true;
        continue;
      }
      if (token === '--auto-close') {
        options.autoClose = true;
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
      if (token === '--resolve-answer') {
        const value = String(requireFlagValue(args, i, '--resolve-answer')).trim().toLowerCase();
        if (value !== 'yes' && value !== 'no') {
          throw new CliError('INVALID_FLAG_VALUE', '--resolve-answer must be yes|no.');
        }
        options.resolveAnswer = value;
        i += 1;
        continue;
      }
      if (token === '--resolve-reason') {
        options.resolveReason = requireFlagValue(args, i, '--resolve-reason');
        i += 1;
        continue;
      }
      if (token === '--resolve-watch-interval-ms') {
        options.resolveWatchIntervalMs = parsePositiveInteger(
          requireFlagValue(args, i, '--resolve-watch-interval-ms'),
          '--resolve-watch-interval-ms',
        );
        i += 1;
        continue;
      }
      if (token === '--resolve-watch-timeout-ms') {
        options.resolveWatchTimeoutMs = parsePositiveInteger(
          requireFlagValue(args, i, '--resolve-watch-timeout-ms'),
          '--resolve-watch-timeout-ms',
        );
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
        options.hedgeScope = parseHedgeScope(
          requireFlagValue(args, i, '--hedge-scope'),
          '--hedge-scope',
          CliError,
        );
        i += 1;
        continue;
      }
      if (token === '--skip-initial-hedge') {
        options.skipInitialHedge = true;
        continue;
      }
      if (token === '--rebalance-mode') {
        const value = String(requireFlagValue(args, i, '--rebalance-mode')).trim().toLowerCase();
        if (value !== 'atomic' && value !== 'incremental') {
          throw new CliError('INVALID_FLAG_VALUE', '--rebalance-mode must be atomic|incremental.');
        }
        options.rebalanceSizingMode = value;
        i += 1;
        continue;
      }
      if (token === '--price-source') {
        const value = String(requireFlagValue(args, i, '--price-source')).trim().toLowerCase();
        if (value !== 'on-chain' && value !== 'indexer') {
          throw new CliError('INVALID_FLAG_VALUE', '--price-source must be on-chain|indexer.');
        }
        options.priceSource = value;
        i += 1;
        continue;
      }
      if (token === '--rebalance-route') {
        options.rebalanceRoute = parseRebalanceRoute(
          requireFlagValue(args, i, '--rebalance-route'),
          '--rebalance-route',
          CliError,
        );
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
      if (token === '--no-hedge') {
        options.noHedge = true;
        continue;
      }
      if (token === '--max-rebalance-usdc') {
        options.maxRebalanceUsdc = parseNonNegativeNumber(
          requireFlagValue(args, i, '--max-rebalance-usdc'),
          '--max-rebalance-usdc',
          CliError,
        );
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
      if (token === '--depth-slippage-bps') {
        options.depthSlippageBps = parsePositiveInteger(requireFlagValue(args, i, '--depth-slippage-bps'), '--depth-slippage-bps');
        if (options.depthSlippageBps > 10_000) {
          throw new CliError('INVALID_FLAG_VALUE', '--depth-slippage-bps must be <= 10000.');
        }
        i += 1;
        continue;
      }
      if (token === '--min-time-to-close-sec') {
        options.minTimeToCloseSec = parsePositiveInteger(
          requireFlagValue(args, i, '--min-time-to-close-sec'),
          '--min-time-to-close-sec',
        );
        i += 1;
        continue;
      }
      if (token === '--strict-close-time-delta') {
        options.strictCloseTimeDelta = true;
        continue;
      }
      if (token === '--chain-id') {
        options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
        i += 1;
        continue;
      }
      if (token === '--rpc-url') {
        options.rpcUrl = parseSecureUrlList(
          requireFlagValue(args, i, '--rpc-url'),
          '--rpc-url',
          CliError,
          isSecureHttpUrlOrLocal,
        );
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
      if (token === '--private-key') {
        options.privateKey = parsePrivateKeyFlag(requireFlagValue(args, i, '--private-key'), '--private-key');
        i += 1;
        continue;
      }
      {
        const nextIndex = consumeProfileSelectorFlag({
          token,
          args,
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
      if (token === LEGACY_DISTRIBUTION_YES_PCT_FLAG || token === LEGACY_DISTRIBUTION_NO_PCT_FLAG) {
        throw new CliError('INVALID_ARGS', buildLegacyDistributionPercentMigrationMessage(token));
      }
      if (token === YES_RESERVE_WEIGHT_PCT_FLAG) {
        options.yesReserveWeightPct = parseDistributionPercent(
          requireFlagValue(args, i, YES_RESERVE_WEIGHT_PCT_FLAG),
          YES_RESERVE_WEIGHT_PCT_FLAG,
          CliError,
        );
        i += 1;
        continue;
      }
      if (token === NO_RESERVE_WEIGHT_PCT_FLAG) {
        options.noReserveWeightPct = parseDistributionPercent(
          requireFlagValue(args, i, NO_RESERVE_WEIGHT_PCT_FLAG),
          NO_RESERVE_WEIGHT_PCT_FLAG,
          CliError,
        );
        i += 1;
        continue;
      }
      if (token === '--initial-yes-pct') {
        options.initialYesPct = parseDistributionPercent(
          requireFlagValue(args, i, '--initial-yes-pct'),
          '--initial-yes-pct',
          CliError,
        );
        i += 1;
        continue;
      }
      if (token === '--initial-no-pct') {
        options.initialNoPct = parseDistributionPercent(
          requireFlagValue(args, i, '--initial-no-pct'),
          '--initial-no-pct',
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
        options.sourcesSource = 'cli';
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

    const envResolutionSources = readResolutionSourcesEnv(process.env);
    if (!options.sourcesProvided && envResolutionSources.present) {
      options.sources = envResolutionSources.sources;
      options.sourcesProvided = true;
      options.sourcesSource = 'env';
    } else if (options.sourcesProvided && !options.sourcesSource) {
      options.sourcesSource = 'cli';
    }

    if (!options.polymarketMarketId && !options.polymarketSlug) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'mirror go requires --polymarket-market-id <id> or --polymarket-slug <slug>.');
    }
    if (options.autoClose && !options.autoResolve) {
      throw new CliError('INVALID_ARGS', '--auto-close requires --auto-resolve.');
    }
    if ((options.autoResolve || options.autoClose) && !options.executeLive) {
      throw new CliError(
        'INVALID_ARGS',
        'mirror go lifecycle automation requires live mode (--execute-live or --execute).',
      );
    }
    if (options.autoResolve && options.autoSync && !options.syncOnce) {
      throw new CliError(
        'INVALID_ARGS',
        '--auto-resolve requires a finite mirror go run. Use --sync-once with --auto-sync or disable --auto-sync.',
      );
    }
    if (options.autoResolve && !options.resolveAnswer) {
      throw new CliError('MISSING_REQUIRED_FLAG', '--auto-resolve requires --resolve-answer yes|no.');
    }
    if (options.autoResolve && !String(options.resolveReason || '').trim()) {
      throw new CliError('MISSING_REQUIRED_FLAG', '--auto-resolve requires --resolve-reason <text>.');
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
    if (options.sourcesSource === 'env' && normalizeResolutionSources(options.sources).length < 2) {
      throw new CliError(
        'MISSING_REQUIRED_FLAG',
        'PANDORA_RESOLUTION_SOURCES requires at least two non-empty URLs when used as a fallback.',
      );
    }
    if (options.sourcesSource === 'cli' && normalizeResolutionSources(options.sources).length < 2) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        '--sources requires at least two non-empty URLs when explicitly provided.',
      );
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

/** Public mirror go parser factory export. */
module.exports = {
  createParseMirrorGoFlags,
};
