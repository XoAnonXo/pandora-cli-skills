const test = require('node:test');
const assert = require('node:assert/strict');

const { createRunWatchCommand } = require('../../cli/lib/watch_command_service.cjs');

class TestCliError extends Error {
  constructor(code, message, details = null, exitCode = 1) {
    super(message);
    this.code = code;
    this.details = details;
    this.exitCode = exitCode;
  }
}

function createBaseDeps(overrides = {}) {
  return {
    CliError: TestCliError,
    parseIndexerSharedFlags: () => ({
      rest: [],
      indexerUrl: null,
      timeoutMs: 5_000,
    }),
    emitSuccess: () => {},
    watchHelpJsonPayload: () => ({ usage: 'watch' }),
    printWatchHelpTable: () => {},
    maybeLoadIndexerEnv: () => {},
    resolveIndexerUrl: () => 'https://indexer.example',
    parseWatchFlags: () => ({
      wallet: null,
      marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      side: 'yes',
      amountUsdc: 1,
      yesPct: null,
      slippageBps: 100,
      chainId: null,
      limit: 10,
      includeEvents: true,
      iterations: 2,
      intervalMs: 0,
      alertYesBelow: null,
      alertYesAbove: null,
      alertNetLiquidityBelow: null,
      alertNetLiquidityAbove: null,
      failOnAlert: false,
      failOnWebhookError: false,
      trackBrier: true,
      brierSource: 'watch',
      brierFile: '/tmp/forecasts.jsonl',
    }),
    collectPortfolioSnapshot: async () => ({ summary: null }),
    buildQuotePayload: async () => ({
      marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      side: 'yes',
      odds: {
        source: 'liquidity-event:latest',
        yesProbability: 0.62,
      },
      estimate: {
        impliedProbability: 0.62,
      },
    }),
    evaluateWatchAlerts: () => [],
    hasWebhookTargets: () => false,
    sendWebhookNotifications: async () => ({ failureCount: 0 }),
    sleepMs: async () => {},
    renderWatchTable: () => 'table',
    ...overrides,
  };
}

test('watch command tracks Brier forecasts when appendForecastRecord dependency exists', async () => {
  const writes = [];
  let emittedPayload = null;

  const runWatchCommand = createRunWatchCommand(createBaseDeps({
    emitSuccess: (mode, command, payload) => {
      emittedPayload = { mode, command, payload };
    },
    appendForecastRecord: (filePath, row) => {
      writes.push({ filePath, row });
      return {
        filePath,
        record: {
          ...row,
          id: `rec-${writes.length}`,
        },
      };
    },
    defaultForecastFile: () => '/tmp/default-forecasts.jsonl',
  }));

  await runWatchCommand([], { outputMode: 'json' });

  assert.equal(writes.length, 2);
  assert.equal(writes[0].row.probabilityYes, 0.62);
  assert.equal(writes[0].row.source, 'watch');

  assert.equal(emittedPayload.command, 'watch');
  assert.equal(emittedPayload.payload.brierTracking.enabled, true);
  assert.equal(emittedPayload.payload.brierTracking.recordsWritten, 2);
  assert.equal(emittedPayload.payload.brierTracking.errorCount, 0);
  assert.equal(emittedPayload.payload.snapshots[0].brierTracking.tracked, true);
});

test('watch command degrades gracefully when Brier tracking is requested without store dependency', async () => {
  let emittedPayload = null;

  const runWatchCommand = createRunWatchCommand(createBaseDeps({
    emitSuccess: (mode, command, payload) => {
      emittedPayload = { mode, command, payload };
    },
  }));

  await runWatchCommand([], { outputMode: 'json' });

  assert.equal(emittedPayload.command, 'watch');
  assert.equal(emittedPayload.payload.brierTracking.enabled, true);
  assert.equal(emittedPayload.payload.brierTracking.missingDependency, true);
  assert.equal(emittedPayload.payload.brierTracking.recordsWritten, 0);
  assert.equal(emittedPayload.payload.snapshots[0].brierTracking.reason, 'FORECAST_STORE_UNAVAILABLE');
});
