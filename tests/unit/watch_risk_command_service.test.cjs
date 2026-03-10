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

function createDeps(overrides = {}) {
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
      wallet: '0x1111111111111111111111111111111111111111',
      marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      side: 'yes',
      amountUsdc: 6,
      yesPct: 55,
      slippageBps: 100,
      chainId: null,
      limit: 10,
      includeEvents: false,
      iterations: 2,
      intervalMs: 0,
      alertYesBelow: null,
      alertYesAbove: null,
      alertNetLiquidityBelow: null,
      alertNetLiquidityAbove: null,
      failOnAlert: false,
      failOnWebhookError: false,
      trackBrier: false,
      brierSource: null,
      brierFile: null,
      riskPolicy: {
        limits: {
          maxTradeSizeUsdc: 5,
          maxDailyVolumeUsdc: 10,
          maxTotalExposureUsdc: 8,
          maxPerMarketExposureUsdc: 4,
          maxHedgeGapUsdc: 2,
        },
      },
    }),
    collectPortfolioSnapshot: async () => ({
      summary: {
        totalPositionMarkValueUsdc: 9,
        positionCount: 1,
      },
      positions: [
        {
          marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          markValueUsdc: 5,
        },
        {
          marketAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          markValueUsdc: 4,
        },
      ],
      live: {
        hedgeGapUsdc: -3,
      },
    }),
    buildQuotePayload: async () => ({
      marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      amountUsdc: 6,
      odds: {
        yesPct: 55,
        yesProbability: 0.55,
      },
      estimate: {
        impliedProbability: 0.55,
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

test('watch command emits risk policy payload and projected exposure alerts', async () => {
  let emitted = null;
  const runWatchCommand = createRunWatchCommand(createDeps({
    emitSuccess: (mode, command, payload) => {
      emitted = { mode, command, payload };
    },
  }));

  await runWatchCommand([], { outputMode: 'json' });

  assert.equal(emitted.command, 'watch');
  assert.equal(emitted.payload.riskPolicy.configured, true);
  assert.equal(emitted.payload.riskPolicy.limits.maxTradeSizeUsdc, 5);
  assert.equal(emitted.payload.snapshots.length, 2);
  assert.equal(emitted.payload.snapshots[0].risk.metrics.totalExposureUsdc, 9);
  assert.equal(emitted.payload.snapshots[1].risk.metrics.projectedDailyVolumeUsdc, 12);
  assert.ok(emitted.payload.alerts.some((item) => item.code === 'TRADE_SIZE_ABOVE_LIMIT'));
  assert.ok(emitted.payload.alerts.some((item) => item.code === 'TOTAL_EXPOSURE_ABOVE_LIMIT'));
  assert.ok(emitted.payload.alerts.some((item) => item.code === 'PER_MARKET_EXPOSURE_ABOVE_LIMIT'));
  assert.ok(emitted.payload.alerts.some((item) => item.code === 'HEDGE_GAP_ABOVE_LIMIT'));
  assert.ok(emitted.payload.alerts.some((item) => item.code === 'DAILY_VOLUME_ABOVE_LIMIT'));
});

test('watch command fail-on-alert includes risk policy alert counts', async () => {
  const runWatchCommand = createRunWatchCommand(createDeps({
    parseWatchFlags: () => ({
      wallet: null,
      marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      side: 'yes',
      amountUsdc: 6,
      yesPct: 55,
      slippageBps: 100,
      chainId: null,
      limit: 10,
      includeEvents: false,
      iterations: 1,
      intervalMs: 0,
      alertYesBelow: null,
      alertYesAbove: null,
      alertNetLiquidityBelow: null,
      alertNetLiquidityAbove: null,
      failOnAlert: true,
      failOnWebhookError: false,
      trackBrier: false,
      brierSource: null,
      brierFile: null,
      riskPolicy: {
        limits: {
          maxTradeSizeUsdc: 5,
        },
      },
    }),
  }));

  await assert.rejects(
    () => runWatchCommand([], { outputMode: 'json' }),
    (error) => {
      assert.equal(error.code, 'WATCH_ALERT_TRIGGERED');
      assert.equal(error.details.alertCount, 1);
      assert.equal(error.details.alerts[0].code, 'TRADE_SIZE_ABOVE_LIMIT');
      return true;
    },
  );
});
