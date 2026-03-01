/**
 * Canonical usage string for `scan`.
 * Exported for reuse in help and tests.
 * @type {string}
 */
const SCAN_USAGE =
  'pandora [--output table|json] scan [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>] [--where-json <json>] [--active|--resolved|--expiring-soon] [--expiring-hours <n>] [--expand] [--with-odds]';

const SCAN_NOTES = [
  'scan always returns expanded market payloads with odds included.',
  '--with-odds is accepted for backward compatibility and is effectively a no-op.',
  '--active|--resolved|--expiring-soon are client-side lifecycle filters over fetched indexer pages.',
  'scan is indexer-backed (no direct chain reads), so freshness follows indexer sync state.',
];

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
    options.withOdds = true;

    const { items, pageInfo, unfilteredCount } = await fetchMarketsListPage(indexerUrl, options, shared.timeoutMs);
    const enrichmentContext = await buildMarketsEnrichmentContext(indexerUrl, items, options, shared.timeoutMs);
    const payload = buildMarketsListPayload(indexerUrl, options, items, pageInfo, {
      includeEnrichedItems: true,
      scanMode: true,
      enrichmentContext,
      unfilteredCount,
    });

    emitSuccess(context.outputMode, 'scan', payload, renderScanTable);
  };
}

/** Public scan command service exports. */
module.exports = {
  SCAN_USAGE,
  createRunScanCommand,
};
