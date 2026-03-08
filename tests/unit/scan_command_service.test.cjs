const test = require('node:test');
const assert = require('node:assert/strict');

const { createRunScanCommand } = require('../../cli/lib/scan_command_service.cjs');

test('scan command propagates hedgeable fallback diagnostics into payload', async () => {
  let captured = null;
  let receivedOptions = null;
  const runScanCommand = createRunScanCommand({
    parseIndexerSharedFlags: () => ({
      rest: ['--hedgeable'],
      indexerUrl: null,
      timeoutMs: 5000,
      useEnvFile: false,
      envFile: null,
      envFileExplicit: false,
    }),
    includesHelpFlag: () => false,
    emitSuccess: (_mode, _command, payload) => {
      captured = payload;
    },
    maybeLoadIndexerEnv: () => {},
    resolveIndexerUrl: () => 'https://indexer.example/graphql',
    parseMarketsListFlags: () => ({
      where: {},
      limit: 20,
      before: null,
      after: null,
      orderBy: 'createdAt',
      orderDirection: 'desc',
      lifecycle: 'all',
      expiringSoonHours: 72,
      expand: false,
      withOdds: false,
      minTvlUsdc: null,
      hedgeable: true,
    }),
    fetchMarketsListPage: async () => ({
      items: [{ id: 'm1', marketType: 'amm', currentTvl: 100 }],
      pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
      unfilteredCount: 1,
    }),
    filterHedgeableMarkets: async ({ items }) => ({
      items,
      unfilteredCount: 1,
      diagnostics: ['Hedgeable filter degraded: cross-venue matcher unavailable, returning unfiltered market set.'],
    }),
    buildMarketsEnrichmentContext: async () => ({ diagnostics: [] }),
    buildMarketsListPayload: (_indexerUrl, options, items, pageInfo, opts) => {
      receivedOptions = options;
      return {
      items,
      pageInfo,
      diagnostics: opts.externalDiagnostics || [],
      };
    },
    renderScanTable: () => {},
  });

  await runScanCommand([], { outputMode: 'json' });

  assert.ok(captured);
  assert.deepEqual(captured.diagnostics, [
    'Hedgeable filter degraded: cross-venue matcher unavailable, returning unfiltered market set.',
  ]);
  assert.equal(receivedOptions.expand, true);
  assert.equal(receivedOptions.withOdds, true);
});
