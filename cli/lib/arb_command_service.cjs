const ARB_MARKET_FIELDS = [
  'id',
  'chainId',
  'chainName',
  'pollAddress',
  'marketCloseTimestamp',
  'yesChance',
  'yesPct',
  'reserveYes',
  'reserveNo',
  'totalVolume',
  'currentTvl',
  'createdAt',
];

const ARB_USAGE =
  'pandora arb scan --markets <csv> --output ndjson [--min-net-spread-pct <n>] [--fee-pct-per-leg <n>] [--amount-usdc <n>] [--interval-ms <ms>] [--iterations <n>] [--indexer-url <url>] [--timeout-ms <ms>]';

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunArbCommand requires deps.${name}()`);
  }
  return deps[name];
}

function roundNumber(value, digits = 6) {
  const multiplier = 10 ** digits;
  return Math.round(Number(value) * multiplier) / multiplier;
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function normalizeYesPct(market) {
  if (!market || typeof market !== 'object') return null;

  const explicit = toFiniteNumber(market.yesPct);
  if (explicit !== null) {
    if (explicit >= 0 && explicit <= 100) {
      return explicit;
    }
    if (explicit >= 0 && explicit <= 1) {
      return explicit * 100;
    }
  }

  const chance = toFiniteNumber(market.yesChance);
  if (chance !== null) {
    if (chance >= 0 && chance <= 1) {
      return chance * 100;
    }
    if (chance >= 0 && chance <= 100) {
      return chance;
    }
  }

  const reserveYes = toFiniteNumber(market.reserveYes);
  const reserveNo = toFiniteNumber(market.reserveNo);
  if (reserveYes !== null && reserveNo !== null) {
    const total = reserveYes + reserveNo;
    if (total > 0) {
      return (reserveNo / total) * 100;
    }
  }

  return null;
}

function buildMarketSnapshots(markets, orderedIds) {
  const byId = new Map((Array.isArray(markets) ? markets : []).map((item) => [String(item && item.id), item]));

  return orderedIds
    .map((id) => {
      const market = byId.get(id) || null;
      return {
        id,
        market,
        yesPct: market ? normalizeYesPct(market) : null,
      };
    })
    .filter((item) => item.market && Number.isFinite(item.yesPct));
}

/**
 * Build deterministic pairwise arbitrage opportunities across provided markets.
 * @param {object} options
 * @returns {object[]}
 */
function buildArbOpportunities(options) {
  const snapshots = Array.isArray(options.marketSnapshots) ? options.marketSnapshots : [];
  const minNetSpreadPct = Number.isFinite(options.minNetSpreadPct) ? Number(options.minNetSpreadPct) : 0;
  const feePctPerLeg = Number.isFinite(options.feePctPerLeg) ? Number(options.feePctPerLeg) : 0;
  const amountUsdc = Number.isFinite(options.amountUsdc) ? Number(options.amountUsdc) : 0;

  const opportunities = [];
  for (let leftIndex = 0; leftIndex < snapshots.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < snapshots.length; rightIndex += 1) {
      const left = snapshots[leftIndex];
      const right = snapshots[rightIndex];
      if (!Number.isFinite(left.yesPct) || !Number.isFinite(right.yesPct)) {
        continue;
      }

      const buyYes = left.yesPct <= right.yesPct ? left : right;
      const buyNo = buyYes === left ? right : left;
      const grossSpreadPct = roundNumber(buyNo.yesPct - buyYes.yesPct, 6);
      const netSpreadPct = roundNumber(grossSpreadPct - feePctPerLeg * 2, 6);
      if (netSpreadPct <= 0 || netSpreadPct < minNetSpreadPct) {
        continue;
      }

      const profitUsdc = roundNumber((amountUsdc * netSpreadPct) / 100, 6);
      opportunities.push({
        pair: `${buyYes.id}|${buyNo.id}`,
        buyYesMarket: buyYes.id,
        buyNoMarket: buyNo.id,
        buyYesPct: roundNumber(buyYes.yesPct, 6),
        buyNoPct: roundNumber(buyNo.yesPct, 6),
        grossSpreadPct,
        netSpreadPct,
        netSpread: roundNumber(netSpreadPct / 100, 8),
        amountUsdc: roundNumber(amountUsdc, 6),
        profitUsdc,
        profit: profitUsdc,
      });
    }
  }

  opportunities.sort((left, right) => {
    if (right.netSpreadPct !== left.netSpreadPct) {
      return right.netSpreadPct - left.netSpreadPct;
    }
    return left.pair.localeCompare(right.pair);
  });

  return opportunities;
}

/**
 * Parse `arb scan` command flags.
 * @param {string[]} args
 * @param {object} deps
 * @returns {object}
 */
function parseArbScanFlags(args, deps) {
  const { CliError, requireFlagValue, parseCsvList, parseNumber, parsePositiveNumber, parsePositiveInteger } = deps;

  const action = args[0];
  if (!action || action !== 'scan') {
    throw new CliError('INVALID_ARGS', 'arb requires subcommand: scan.');
  }

  const options = {
    action,
    markets: [],
    output: 'ndjson',
    minNetSpreadPct: 0,
    feePctPerLeg: 0,
    amountUsdc: 100,
    intervalMs: 5_000,
    iterations: null,
  };

  const rest = args.slice(1);
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--markets') {
      options.markets = parseCsvList(requireFlagValue(rest, i, '--markets'), '--markets');
      i += 1;
      continue;
    }
    if (token === '--output') {
      options.output = String(requireFlagValue(rest, i, '--output')).trim().toLowerCase();
      i += 1;
      continue;
    }
    if (token === '--min-net-spread-pct') {
      options.minNetSpreadPct = parseNumber(requireFlagValue(rest, i, '--min-net-spread-pct'), '--min-net-spread-pct');
      i += 1;
      continue;
    }
    if (token === '--fee-pct-per-leg') {
      options.feePctPerLeg = parseNumber(requireFlagValue(rest, i, '--fee-pct-per-leg'), '--fee-pct-per-leg');
      i += 1;
      continue;
    }
    if (token === '--amount-usdc') {
      options.amountUsdc = parsePositiveNumber(requireFlagValue(rest, i, '--amount-usdc'), '--amount-usdc');
      i += 1;
      continue;
    }
    if (token === '--interval-ms') {
      options.intervalMs = parsePositiveInteger(requireFlagValue(rest, i, '--interval-ms'), '--interval-ms');
      i += 1;
      continue;
    }
    if (token === '--iterations') {
      options.iterations = parsePositiveInteger(requireFlagValue(rest, i, '--iterations'), '--iterations');
      i += 1;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for arb scan: ${token}`);
  }

  if (!Array.isArray(options.markets) || options.markets.length < 2) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'arb scan requires at least two markets via --markets <csv>.');
  }

  if (options.output !== 'ndjson') {
    throw new CliError('INVALID_FLAG_VALUE', 'arb scan currently supports only --output ndjson.');
  }

  if (options.minNetSpreadPct < 0) {
    throw new CliError('INVALID_FLAG_VALUE', '--min-net-spread-pct must be >= 0.');
  }

  if (options.feePctPerLeg < 0) {
    throw new CliError('INVALID_FLAG_VALUE', '--fee-pct-per-leg must be >= 0.');
  }

  options.markets = Array.from(
    new Set(
      options.markets
        .map((item) => String(item).trim())
        .filter(Boolean),
    ),
  );

  if (options.markets.length < 2) {
    throw new CliError('INVALID_ARGS', 'arb scan requires at least two distinct market ids.');
  }

  return options;
}

async function fetchMarketsById(indexerUrl, marketIds, timeoutMs, deps) {
  const query = deps.buildGraphqlGetQuery('markets', ARB_MARKET_FIELDS);
  const requests = marketIds.map(async (id) => {
    const data = await deps.graphqlRequest(indexerUrl, query, { id }, timeoutMs);
    return data && data.markets ? data.markets : null;
  });
  return Promise.all(requests);
}

/**
 * Create runner for `pandora arb` commands.
 * @param {object} deps
 * @returns {(args: string[], context: {outputMode: 'table'|'json'}) => Promise<void>}
 */
function createRunArbCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseIndexerSharedFlags = requireDep(deps, 'parseIndexerSharedFlags');
  const maybeLoadIndexerEnv = requireDep(deps, 'maybeLoadIndexerEnv');
  const resolveIndexerUrl = requireDep(deps, 'resolveIndexerUrl');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parseCsvList = requireDep(deps, 'parseCsvList');
  const parseNumber = requireDep(deps, 'parseNumber');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const buildGraphqlGetQuery = requireDep(deps, 'buildGraphqlGetQuery');
  const graphqlRequest = requireDep(deps, 'graphqlRequest');
  const sleepMs = requireDep(deps, 'sleepMs');

  return async function runArbCommand(args, context) {
    const shared = parseIndexerSharedFlags(args);
    if (!shared.rest.length || includesHelpFlag(shared.rest)) {
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'arb.help', commandHelpPayload(ARB_USAGE));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${ARB_USAGE}`);
      }
      return;
    }

    maybeLoadIndexerEnv(shared);
    const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
    const options = parseArbScanFlags(shared.rest, {
      CliError,
      requireFlagValue,
      parseCsvList,
      parseNumber,
      parsePositiveNumber,
      parsePositiveInteger,
    });

    const maxIterations = Number.isInteger(options.iterations) ? options.iterations : Number.POSITIVE_INFINITY;
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration += 1;
      const markets = await fetchMarketsById(indexerUrl, options.markets, shared.timeoutMs, {
        buildGraphqlGetQuery,
        graphqlRequest,
      });
      const snapshots = buildMarketSnapshots(markets, options.markets);
      const opportunities = buildArbOpportunities({
        marketSnapshots: snapshots,
        minNetSpreadPct: options.minNetSpreadPct,
        feePctPerLeg: options.feePctPerLeg,
        amountUsdc: options.amountUsdc,
      });

      for (const opportunity of opportunities) {
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            type: 'arb.scan.opportunity',
            timestamp: new Date().toISOString(),
            iteration,
            indexerUrl,
            ...opportunity,
          }),
        );
      }

      if (iteration < maxIterations) {
        await sleepMs(options.intervalMs);
      }
    }
  };
}

module.exports = {
  ARB_USAGE,
  buildArbOpportunities,
  createRunArbCommand,
  parseArbScanFlags,
};
