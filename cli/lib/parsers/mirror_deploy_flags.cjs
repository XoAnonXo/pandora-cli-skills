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
const { consumeProfileSelectorFlag, assertNoMixedSignerSelectors } = require('./shared_profile_selector_flags.cjs');

const MAX_UINT24 = 16_777_215;

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParseMirrorDeployFlags requires deps.${name}()`);
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
  const parsed = normalizePercent(value);
  if (parsed === null) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be between 0 and 100.`);
  }
  return parsed;
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
 * Creates the mirror deploy flags parser.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseMirrorDeployFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const parsePrivateKeyFlag = requireDep(deps, 'parsePrivateKeyFlag');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parseInteger = requireDep(deps, 'parseInteger');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');

  return function parseMirrorDeployFlags(args) {
    const options = {
      planFile: null,
      polymarketMarketId: null,
      polymarketSlug: null,
      dryRun: false,
      execute: false,
      marketType: 'amm',
      liquidityUsdc: null,
      feeTier: 3000,
      maxImbalance: MAX_UINT24,
      arbiter: null,
      category: DEFAULT_SPORTS_POLL_CATEGORY,
      sources: [],
      sourcesProvided: false,
      chainId: null,
      rpcUrl: null,
      privateKey: null,
      profileId: null,
      profileFile: null,
      oracle: null,
      factory: null,
      usdc: null,
      distributionYes: null,
      distributionNo: null,
      yesReserveWeightPct: null,
      noReserveWeightPct: null,
      initialYesPct: null,
      initialNoPct: null,
      distributionInputMode: null,
      rules: null,
      validationTicket: null,
      targetTimestamp: null,
      polymarketHost: null,
      polymarketGammaUrl: null,
      polymarketGammaMockUrl: null,
      polymarketMockUrl: null,
      manifestFile: null,
      minCloseLeadSeconds: 3600,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--plan-file') {
        options.planFile = normalizeMirrorPathForMcp(requireFlagValue(args, i, '--plan-file'), '--plan-file', CliError);
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
      if (token === '--dry-run') {
        options.dryRun = true;
        continue;
      }
      if (token === '--execute') {
        options.execute = true;
        continue;
      }
      if (token === '--market-type') {
        options.marketType = requireFlagValue(args, i, '--market-type').toLowerCase();
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
      if (token === '--allow-rule-mismatch') {
        throw new CliError(
          'INVALID_ARGS',
          '--allow-rule-mismatch is not supported for mirror deploy. Use mirror verify --allow-rule-mismatch for diagnostics only.',
        );
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
      if (token === '--usdc') {
        options.usdc = parseAddressFlag(requireFlagValue(args, i, '--usdc'), '--usdc');
        i += 1;
        continue;
      }
      if (token === '--rules') {
        options.rules = requireFlagValue(args, i, '--rules');
        i += 1;
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
      if (token === '--manifest-file') {
        options.manifestFile = normalizeMirrorPathForMcp(
          requireFlagValue(args, i, '--manifest-file'),
          '--manifest-file',
          CliError,
        );
        i += 1;
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
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror deploy: ${token}`);
    }

    if (options.dryRun === options.execute) {
      throw new CliError('INVALID_ARGS', 'mirror deploy requires exactly one mode: --dry-run or --execute.');
    }
    if (options.marketType !== 'amm') {
      throw new CliError('INVALID_FLAG_VALUE', 'mirror deploy only supports --market-type amm in v1.');
    }
    if (!options.planFile && !options.polymarketMarketId && !options.polymarketSlug) {
      throw new CliError(
        'MISSING_REQUIRED_FLAG',
        'mirror deploy requires --plan-file <path> or a Polymarket selector (--polymarket-market-id/--polymarket-slug).',
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
      options.distributionYes + options.distributionNo !== 1_000_000_000
    ) {
      throw new CliError('INVALID_ARGS', '--distribution-yes + --distribution-no must equal 1000000000.');
    }
    if (options.sourcesProvided && normalizeSources(options.sources).length < 2) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        '--sources requires at least two non-empty URLs when explicitly provided.',
      );
    }
    assertNoMixedSignerSelectors(options, CliError);

    return options;
  };
}

/** Public mirror deploy parser factory export. */
module.exports = {
  createParseMirrorDeployFlags,
};
