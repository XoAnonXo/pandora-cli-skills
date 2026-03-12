/**
 * Canonical usage string for `scan`.
 * Exported for reuse in help and tests.
 * @type {string}
 */
const SCAN_USAGE =
  'pandora [--output table|json] scan [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>|--type <type>] [--where-json <json>] [--active|--resolved|--expiring-soon] [--expiring-hours <n>] [--min-tvl <usdc>] [--hedgeable] [--expand] [--with-odds]';

const SCAN_NOTES = [
  'scan is the canonical enriched market discovery command; `markets scan` remains a backward-compatible alias.',
  'Use `markets list` when you want the raw indexer browse view without forcing enriched payload semantics.',
  'scan always returns expanded market payloads with odds included.',
  '--with-odds is accepted for backward compatibility and is effectively a no-op.',
  '--min-tvl applies a client-side filter against current TVL in USDC units.',
  '--hedgeable keeps only markets that have a matched Polymarket leg (cross-venue similarity pass).',
  '--active|--resolved|--expiring-soon are client-side lifecycle filters over fetched indexer pages.',
  'scan is indexer-backed (no direct chain reads), so freshness follows indexer sync state.',
];

function toOptionalNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function pickPollStatus(item, enrichmentContext) {
  const directStatus = toOptionalNumber(item && item.poll && item.poll.status);
  if (directStatus !== null) return directStatus;
  const pollAddress = String(item && item.pollAddress ? item.pollAddress : '').trim().toLowerCase();
  if (!pollAddress || !enrichmentContext || !enrichmentContext.pollsByKey) return null;
  const poll = enrichmentContext.pollsByKey.get(pollAddress) || null;
  return toOptionalNumber(poll && poll.status);
}

function applyScanLifecycleFilter(items, options, enrichmentContext) {
  const list = Array.isArray(items) ? items : [];
  const lifecycle = options && typeof options.lifecycle === 'string' ? options.lifecycle : 'all';
  if (lifecycle === 'all') {
    return list;
  }

  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  const expiringSoonHours = toOptionalNumber(options && options.expiringSoonHours);
  const expiringCutoffEpochSeconds =
    nowEpochSeconds + (Number.isFinite(expiringSoonHours) && expiringSoonHours > 0 ? expiringSoonHours : 24) * 60 * 60;

  return list.filter((item) => {
    const closeEpoch = toOptionalNumber(item && item.marketCloseTimestamp);
    const pollStatus = pickPollStatus(item, enrichmentContext);
    if (lifecycle === 'resolved') {
      if (pollStatus !== null) return pollStatus >= 2;
      return closeEpoch !== null && closeEpoch <= nowEpochSeconds;
    }
    if (lifecycle === 'active') {
      if (pollStatus !== null && pollStatus >= 2) return false;
      return closeEpoch !== null && closeEpoch > nowEpochSeconds;
    }
    if (lifecycle === 'expiring-soon') {
      if (pollStatus !== null && pollStatus >= 2) return false;
      return closeEpoch !== null && closeEpoch > nowEpochSeconds && closeEpoch <= expiringCutoffEpochSeconds;
    }
    return true;
  });
}

/**
 * Build the `scan` subcommand handler.
 * @param {object} deps
 * @returns {(args: string[], context: {outputMode: 'table'|'json'}) => Promise<void>}
 */
function createRunScanCommand(deps) {
  const {
    parseIndexerSharedFlags,
    includesHelpFlag,
    emitSuccess,
    maybeLoadIndexerEnv,
    resolveIndexerUrl,
    parseMarketsListFlags,
    fetchMarketsListPage,
    buildMarketsEnrichmentContext,
    buildMarketsListPayload,
    filterHedgeableMarkets,
    renderScanTable,
  } = deps;

  return async function runScanCommand(args, context) {
    const shared = parseIndexerSharedFlags(args);
    if (includesHelpFlag(shared.rest)) {
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'scan.help', {
          usage: SCAN_USAGE,
          notes: SCAN_NOTES,
        });
      } else {
        console.log(`Usage: ${SCAN_USAGE}`);
        console.log('');
        console.log('Notes:');
        for (const note of SCAN_NOTES) {
          console.log(`- ${note}`);
        }
      }
      return;
    }

    maybeLoadIndexerEnv(shared);
    const indexerUrl = resolveIndexerUrl(shared.indexerUrl);

    const options = parseMarketsListFlags(shared.rest);
    options.expand = true;
    options.withOdds = true;

    let hedgeableDiagnostics = [];
    const fetchOptions = { ...options, lifecycle: 'all' };
    let { items, pageInfo, unfilteredCount } = await fetchMarketsListPage(indexerUrl, fetchOptions, shared.timeoutMs);
    if (options.hedgeable && typeof filterHedgeableMarkets === 'function') {
      const filtered = await filterHedgeableMarkets({
        indexerUrl,
        timeoutMs: shared.timeoutMs,
        options: fetchOptions,
        items,
      });
      items = Array.isArray(filtered && filtered.items) ? filtered.items : items;
      if (typeof filtered.unfilteredCount === 'number') {
        unfilteredCount = filtered.unfilteredCount;
      }
      if (Array.isArray(filtered && filtered.diagnostics)) {
        hedgeableDiagnostics = filtered.diagnostics;
      }
    }
    const enrichmentContext = await buildMarketsEnrichmentContext(indexerUrl, items, options, shared.timeoutMs);
    items = applyScanLifecycleFilter(items, options, enrichmentContext);
    const payload = buildMarketsListPayload(indexerUrl, options, items, pageInfo, {
      includeEnrichedItems: true,
      scanMode: true,
      enrichmentContext,
      unfilteredCount,
      externalDiagnostics: hedgeableDiagnostics,
    });

    emitSuccess(context.outputMode, 'scan', payload, renderScanTable);
  };
}

/** Public scan command service exports. */
module.exports = {
  SCAN_USAGE,
  createRunScanCommand,
};
