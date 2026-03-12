const { MIN_AMM_FEE_TIER, MAX_AMM_FEE_TIER } = require('../shared/constants.cjs');
const { parsePollCategoryFlag } = require('../shared/poll_categories.cjs');
const { parseMirrorTargetTimestamp } = require('./mirror_parser_guard.cjs');
const {
  parseDeployTxRoute,
  parseDeployTxRouteFallback,
  parseDeployFlashbotsRelayUrl,
  assertDeployFlashbotsFlagContract,
} = require('./deploy_route_flags.cjs');
const { consumeProfileSelectorFlag, assertNoMixedSignerSelectors } = require('./shared_profile_selector_flags.cjs');

const MAX_UINT24 = 16_777_215;
const DISTRIBUTION_SCALE = 1_000_000_000;
const MARKET_TYPES = new Set(['amm', 'parimutuel']);
const ACTIONS = new Set(['plan', 'run']);

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParseMarketsCreateFlags requires deps.${name}()`);
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
  return value === 0 ? Object(0) : value;
}

function parseMarketType(value, flagName, CliError) {
  const marketType = String(value || '').trim().toLowerCase();
  if (!MARKET_TYPES.has(marketType)) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be amm|parimutuel.`);
  }
  return marketType;
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

  if (
    (options.distributionYes === null && options.distributionNo !== null) ||
    (options.distributionYes !== null && options.distributionNo === null)
  ) {
    throw new CliError('INVALID_ARGS', 'Provide both --distribution-yes and --distribution-no together.');
  }

  if (
    options.distributionYes !== null
    && options.distributionNo !== null
    && options.distributionYes + options.distributionNo !== DISTRIBUTION_SCALE
  ) {
    throw new CliError('INVALID_ARGS', `--distribution-yes + --distribution-no must equal ${DISTRIBUTION_SCALE}.`);
  }

  if (options.distributionYes === null && options.distributionNo === null) {
    options.distributionYes = 500_000_000;
    options.distributionNo = 500_000_000;
  }
}

function assertNonEmptyRequired(value, flagName, CliError) {
  if (!String(value || '').trim()) {
    throw new CliError('MISSING_REQUIRED_FLAG', `Missing ${flagName} value.`);
  }
}

function createParseMarketsCreateFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const parsePrivateKeyFlag = requireDep(deps, 'parsePrivateKeyFlag');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parseInteger = requireDep(deps, 'parseInteger');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');

  return function parseMarketsCreateFlags(args) {
    const action = String(args[0] || '').trim().toLowerCase();
    const rest = args.slice(1);
    if (!ACTIONS.has(action)) {
      throw new CliError('INVALID_ARGS', 'markets create requires subcommand plan|run.');
    }

    const options = {
      question: null,
      rules: null,
      sources: [],
      sourcesProvided: false,
      targetTimestamp: null,
      marketType: 'amm',
      liquidityUsdc: null,
      distributionYes: null,
      distributionNo: null,
      distributionYesPct: null,
      distributionNoPct: null,
      feeTier: 3000,
      feeTierProvided: false,
      maxImbalance: MAX_UINT24,
      maxImbalanceProvided: false,
      curveFlattener: 7,
      curveFlattenerProvided: false,
      curveOffset: 30000,
      curveOffsetProvided: false,
      chainId: null,
      rpcUrl: null,
      privateKey: null,
      profileId: null,
      profileFile: null,
      oracle: null,
      factory: null,
      usdc: null,
      arbiter: null,
      txRoute: 'public',
      txRouteFallback: 'fail',
      flashbotsRelayUrl: null,
      flashbotsAuthKey: null,
      flashbotsTargetBlockOffset: null,
      category: null,
      minCloseLeadSeconds: null,
      validationTicket: null,
      dryRun: false,
      execute: false,
    };

    for (let i = 0; i < rest.length; i += 1) {
      const token = rest[i];

      if (token === '--question') {
        options.question = requireFlagValue(rest, i, '--question');
        i += 1;
        continue;
      }
      if (token === '--rules') {
        options.rules = requireFlagValue(rest, i, '--rules');
        i += 1;
        continue;
      }
      if (token === '--sources') {
        let j = i + 1;
        const entries = [];
        while (j < rest.length && !rest[j].startsWith('--')) {
          entries.push(rest[j]);
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
      if (token === '--target-timestamp') {
        options.targetTimestamp = parseMirrorTargetTimestamp(
          requireFlagValue(rest, i, '--target-timestamp'),
          '--target-timestamp',
          CliError,
        );
        i += 1;
        continue;
      }
      if (token === '--market-type') {
        options.marketType = parseMarketType(requireFlagValue(rest, i, '--market-type'), '--market-type', CliError);
        i += 1;
        continue;
      }
      if (token === '--liquidity-usdc') {
        options.liquidityUsdc = parsePositiveNumber(requireFlagValue(rest, i, '--liquidity-usdc'), '--liquidity-usdc');
        i += 1;
        continue;
      }
      if (token === '--distribution-yes') {
        options.distributionYes = parseDistributionUnits(
          requireFlagValue(rest, i, '--distribution-yes'),
          '--distribution-yes',
          CliError,
          parseInteger,
        );
        i += 1;
        continue;
      }
      if (token === '--distribution-no') {
        options.distributionNo = parseDistributionUnits(
          requireFlagValue(rest, i, '--distribution-no'),
          '--distribution-no',
          CliError,
          parseInteger,
        );
        i += 1;
        continue;
      }
      if (token === '--distribution-yes-pct') {
        options.distributionYesPct = parseDistributionPercent(
          requireFlagValue(rest, i, '--distribution-yes-pct'),
          '--distribution-yes-pct',
          CliError,
        );
        i += 1;
        continue;
      }
      if (token === '--distribution-no-pct') {
        options.distributionNoPct = parseDistributionPercent(
          requireFlagValue(rest, i, '--distribution-no-pct'),
          '--distribution-no-pct',
          CliError,
        );
        i += 1;
        continue;
      }
      if (token === '--fee-tier') {
        options.feeTier = parsePositiveInteger(requireFlagValue(rest, i, '--fee-tier'), '--fee-tier');
        options.feeTierProvided = true;
        i += 1;
        continue;
      }
      if (token === '--max-imbalance') {
        options.maxImbalance = parseUint24Like(
          requireFlagValue(rest, i, '--max-imbalance'),
          '--max-imbalance',
          CliError,
          parseInteger,
        );
        options.maxImbalanceProvided = true;
        i += 1;
        continue;
      }
      if (token === '--curve-flattener') {
        options.curveFlattener = parsePositiveInteger(
          requireFlagValue(rest, i, '--curve-flattener'),
          '--curve-flattener',
        );
        if (options.curveFlattener < 1 || options.curveFlattener > 11) {
          throw new CliError('INVALID_FLAG_VALUE', '--curve-flattener must be in [1,11].');
        }
        options.curveFlattenerProvided = true;
        i += 1;
        continue;
      }
      if (token === '--curve-offset') {
        options.curveOffset = parseUint24Like(
          requireFlagValue(rest, i, '--curve-offset'),
          '--curve-offset',
          CliError,
          parseInteger,
        );
        options.curveOffsetProvided = true;
        i += 1;
        continue;
      }
      if (token === '--chain-id') {
        options.chainId = parseInteger(requireFlagValue(rest, i, '--chain-id'), '--chain-id');
        if (options.chainId <= 0) {
          throw new CliError('INVALID_FLAG_VALUE', '--chain-id must be a positive integer.');
        }
        i += 1;
        continue;
      }
      if (token === '--rpc-url') {
        const rpcUrl = requireFlagValue(rest, i, '--rpc-url');
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
      if (token === '--oracle') {
        options.oracle = parseAddressFlag(requireFlagValue(rest, i, '--oracle'), '--oracle');
        i += 1;
        continue;
      }
      if (token === '--factory') {
        options.factory = parseAddressFlag(requireFlagValue(rest, i, '--factory'), '--factory');
        i += 1;
        continue;
      }
      if (token === '--usdc') {
        options.usdc = parseAddressFlag(requireFlagValue(rest, i, '--usdc'), '--usdc');
        i += 1;
        continue;
      }
      if (token === '--arbiter') {
        options.arbiter = parseAddressFlag(requireFlagValue(rest, i, '--arbiter'), '--arbiter');
        i += 1;
        continue;
      }
      if (token === '--tx-route') {
        options.txRoute = parseDeployTxRoute(requireFlagValue(rest, i, '--tx-route'), '--tx-route', CliError);
        i += 1;
        continue;
      }
      if (token === '--tx-route-fallback') {
        options.txRouteFallback = parseDeployTxRouteFallback(
          requireFlagValue(rest, i, '--tx-route-fallback'),
          '--tx-route-fallback',
          CliError,
        );
        i += 1;
        continue;
      }
      if (token === '--flashbots-relay-url') {
        options.flashbotsRelayUrl = parseDeployFlashbotsRelayUrl(
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
      if (token === '--category') {
        options.category = parsePollCategoryFlag(requireFlagValue(rest, i, '--category'), '--category', CliError, parseInteger);
        i += 1;
        continue;
      }
      if (token === '--min-close-lead-seconds') {
        options.minCloseLeadSeconds = parsePositiveInteger(
          requireFlagValue(rest, i, '--min-close-lead-seconds'),
          '--min-close-lead-seconds',
        );
        i += 1;
        continue;
      }
      if (token === '--validation-ticket') {
        options.validationTicket = requireFlagValue(rest, i, '--validation-ticket');
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

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for markets create ${action}: ${token}`);
    }

    assertNonEmptyRequired(options.question, '--question', CliError);
    assertNonEmptyRequired(options.rules, '--rules', CliError);
    if (!options.sourcesProvided || normalizeSources(options.sources).length < 2) {
      throw new CliError(
        'MISSING_REQUIRED_FLAG',
        'markets create requires --sources with at least two non-empty source entries.',
      );
    }
    if (options.targetTimestamp === null) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'markets create requires --target-timestamp <unix|iso>.');
    }
    if (options.liquidityUsdc === null || options.liquidityUsdc === undefined || !Number.isFinite(Number(options.liquidityUsdc))) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'markets create requires --liquidity-usdc <amount>.');
    }

    if (action === 'plan') {
      if (options.dryRun || options.execute) {
        throw new CliError('INVALID_ARGS', 'markets create plan is read-only; do not pass --dry-run or --execute.');
      }
    } else if (options.dryRun === options.execute) {
      throw new CliError('INVALID_ARGS', 'markets create run requires exactly one mode: --dry-run or --execute.');
    }

    if (options.marketType === 'amm') {
      if (options.curveFlattenerProvided || options.curveOffsetProvided) {
        throw new CliError(
          'INVALID_ARGS',
          'markets create with --market-type amm does not accept --curve-flattener or --curve-offset.',
        );
      }
      if (options.feeTier < MIN_AMM_FEE_TIER || options.feeTier > MAX_AMM_FEE_TIER) {
        throw new CliError(
          'INVALID_FLAG_VALUE',
          `--fee-tier must be between ${MIN_AMM_FEE_TIER} and ${MAX_AMM_FEE_TIER} (max 5%).`,
        );
      }
    } else {
      if (options.feeTierProvided || options.maxImbalanceProvided) {
        throw new CliError(
          'INVALID_ARGS',
          'markets create with --market-type parimutuel does not accept --fee-tier or --max-imbalance.',
        );
      }
    }

    finalizeDistribution(options, CliError);
    assertDeployFlashbotsFlagContract(options, '--tx-route', CliError);
    assertNoMixedSignerSelectors(options, CliError);

    return {
      scope: 'create',
      action,
      command: `markets.create.${action}`,
      options: {
        ...options,
        sources: normalizeSources(options.sources),
      },
    };
  };
}

module.exports = {
  createParseMarketsCreateFlags,
};
