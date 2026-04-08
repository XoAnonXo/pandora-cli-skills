const shared = require('./cli.integration.shared.cjs');
const {
  test,
  assert,
  fs,
  path,
  createTempDir,
  removeDir,
  runCliAsync,
  parseJsonOutput,
} = shared;

require('./cli.integration.core.cjs');
require('./cli.integration.market_ops.cjs');
require('./cli.integration.arbitrage.cjs');
require('./cli.integration.mirror.cjs');
require('./cli.integration.operator.cjs');

function buildBug006ReplayState(tempDir, options = {}) {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'mirror_hedge', 'okc-bos-sell-failure.json'), 'utf8'),
  );
  const stateDir = path.join(tempDir, '.pandora', 'mirror');
  const strategyHash = options.strategyHash || 'bug006-replay';
  const stateFile = path.join(stateDir, `${strategyHash}.json`);
  const pidFile = path.join(tempDir, 'bug006-replay.pid.json');
  const retryTelemetry = {
    sellAttemptedCount: 1,
    sellBlockedCount: 0,
    sellFailedCount: 1,
    sellRecoveredCount: 1,
    lastFailureCode: 'MIRROR_HEDGE_EXECUTION_FAILED',
    lastFailureMessage: 'order rejected by exchange',
    ...(options.retryTelemetry || {}),
  };
  const lastError = options.lastError === null
    ? null
    : {
        code: 'MIRROR_HEDGE_EXECUTION_FAILED',
        message: 'order rejected by exchange',
        at: '2026-03-25T20:10:05.000Z',
        ...(options.lastError || {}),
      };
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        runtimeStatus: 'running',
        targetHedgeInventory: fixture.state.targetHedgeInventory,
        deferredHedgeQueue: fixture.state.deferredHedgeQueue,
        managedPolymarketInventorySnapshot: {
          adoptedAt: '2026-03-25T20:10:00.000Z',
          status: 'observed',
          source: 'polymarket',
          inventoryAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          marketId: 'poly-okc-bos',
          slug: 'okc-bos',
          yesShares: fixture.inventory.yesBalance,
          noShares: fixture.inventory.noBalance,
          yesUsdc: roundToSix(fixture.inventory.yesBalance * fixture.inventory.prices.yes),
          noUsdc: roundToSix(fixture.inventory.noBalance * fixture.inventory.prices.no),
          netUsdc: roundToSix(
            (fixture.inventory.yesBalance * fixture.inventory.prices.yes) -
              (fixture.inventory.noBalance * fixture.inventory.prices.no),
          ),
          estimatedValueUsdc: fixture.inventory.estimatedValueUsd,
          openOrdersCount: 0,
          diagnostics: [],
        },
        retryTelemetry,
        lastError,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    pidFile,
    JSON.stringify(
      {
        strategyHash,
        pid: process.pid,
        stateFile,
        pandoraMarketAddress: '0x11012fc111111111111111111111111111111111',
        polymarketMarketId: 'poly-okc-bos',
        polymarketSlug: 'okc-bos',
        status: 'running',
        pidAlive: true,
      },
      null,
      2,
    ),
  );
  return { stateFile, pidFile, strategyHash };
}

function roundToSix(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 1e6) / 1e6;
}

test('mirror hedge status JSON surfaces lockup warnings and retry counters from replay state', async () => {
  const tempDir = createTempDir('pandora-bug006-status-json-');
  const { pidFile } = buildBug006ReplayState(tempDir);

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'hedge',
      'status',
      '--pid-file',
      pidFile,
    ], {
      env: { HOME: tempDir },
    });

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.hedge.status');
    assert.equal(payload.data.summary.deferredHedgeCount, 1);
    assert.equal(payload.data.summary.deferredHedgeUsdc, 11.4);
    assert.equal(payload.data.summary.deferredHedgeInvalidCount, 1);
    assert.equal(payload.data.summary.deferredHedgeRecoveredCount, 1);
    assert.equal(payload.data.summary.deferredHedgeLastFailureCode, 'MIRROR_HEDGE_EXECUTION_FAILED');
    assert.equal(payload.data.summary.deferredHedgeLastFailureMessage, 'order rejected by exchange');
    assert.equal(payload.data.summary.queueStatusMessage, 'Buy phase is skipped while live sell reduction remains pending.');
    assert.equal(payload.data.summary.sellRetryAttemptedCount, 1);
    assert.equal(payload.data.summary.sellRetryFailedCount, 1);
    assert.equal(payload.data.summary.sellRetryRecoveredCount, 1);
    assert.equal(payload.data.summary.warningCount, 4);
    assert.equal(payload.data.summary.currentYesShares, 207.815);
    assert.equal(payload.data.summary.currentNoShares, 760);
    assert.equal(Array.isArray(payload.data.warnings), true);
    assert.equal(payload.data.warnings.some((warning) => warning.code === 'BOTH_SIDE_INVENTORY_LOCKUP'), true);
    assert.equal(payload.data.warnings.some((warning) => (
      warning.code === 'LIVE_SELL_REDUCTION_PENDING'
      && warning.message === 'Buy phase is skipped while live sell reduction remains pending.'
    )), true);
    assert.equal(payload.data.warnings.some((warning) => (
      warning.code === 'DEFERRED_QUEUE_PRUNED'
      && warning.message === 'Recovered 1 stale deferred sell entry from live queue.'
    )), true);
    assert.equal(payload.data.warnings.some((warning) => (
      warning.code === 'DEFERRED_QUEUE_INVALID_ENTRY'
      && warning.message === 'Deferred hedge queue contains 1 entry with invalid or non-executable sizing.'
    )), true);
  } finally {
    removeDir(tempDir);
  }
});

test('mirror hedge status table prints the replay lockup warning and queue fields', async () => {
  const tempDir = createTempDir('pandora-bug006-status-table-');
  const { pidFile } = buildBug006ReplayState(tempDir);

  try {
    const result = await runCliAsync([
      '--output',
      'table',
      'mirror',
      'hedge',
      'status',
      '--pid-file',
      pidFile,
    ], {
      env: { HOME: tempDir },
    });

    assert.equal(result.status, 0);
    assert.match(result.output, /Mirror Hedge Daemon/);
    assert.match(result.output, /deferredHedgeCount: 1/);
    assert.match(result.output, /deferredHedgeInvalidCount: 1/);
    assert.match(result.output, /deferredHedgeRecoveredCount: 1/);
    assert.match(result.output, /queueStatusMessage: Buy phase is skipped while live sell reduction remains pending\./);
    assert.match(result.output, /sellRetryFailedCount: 1/);
    assert.match(result.output, /warningCount: 4/);
    assert.match(result.output, /BOTH_SIDE_INVENTORY_LOCKUP/);
    assert.match(result.output, /\[LIVE_SELL_REDUCTION_PENDING\] Buy phase is skipped while live sell reduction remains pending\./);
    assert.match(result.output, /\[DEFERRED_QUEUE_PRUNED\] Recovered 1 stale deferred sell entry from live queue\./);
    assert.match(result.output, /\[DEFERRED_QUEUE_INVALID_ENTRY\] Deferred hedge queue contains 1 entry with invalid or non-executable sizing\./);
    assert.match(result.output, /\[BUG-006_SELL_BLOCKED_BUY_PHASE\]/);
    assert.match(result.output, /\[BUG-006_QUEUE_INVALIDATION\]/);
  } finally {
    removeDir(tempDir);
  }
});

test('mirror hedge status JSON surfaces the sell-phase blocking reason when queue work remains live', async () => {
  const tempDir = createTempDir('pandora-bug006-status-blocked-json-');
  const { pidFile } = buildBug006ReplayState(tempDir, {
    strategyHash: 'bug006-blocked',
    retryTelemetry: {
      sellAttemptedCount: 2,
      sellBlockedCount: 1,
      sellFailedCount: 0,
      sellRecoveredCount: 0,
      lastBlockedReasonCode: 'SELL_DEPTH_UNAVAILABLE',
      lastBlockedReason: 'sell-side depth check failed',
      lastFailureCode: null,
      lastFailureMessage: null,
    },
    lastError: null,
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'hedge',
      'status',
      '--pid-file',
      pidFile,
    ], {
      env: { HOME: tempDir },
    });

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.summary.sellRetryBlockedCount, 1);
    assert.equal(payload.data.summary.sellRetryFailedCount, 0);
    assert.equal(payload.data.summary.sellRetryRecoveredCount, 0);
    assert.equal(payload.data.summary.deferredHedgeLastBlockedReasonCode, 'SELL_DEPTH_UNAVAILABLE');
    assert.equal(payload.data.summary.deferredHedgeLastBlockedReason, 'sell-side depth check failed');
    assert.equal(
      payload.data.summary.queueStatusMessage,
      'Buy phase is skipped while live sell reduction remains pending: sell-side depth check failed',
    );
    assert.equal(payload.data.warnings.some((warning) => (
      warning.code === 'LIVE_SELL_REDUCTION_PENDING'
      && warning.message === 'Buy phase is skipped while live sell reduction remains pending: sell-side depth check failed'
    )), true);
  } finally {
    removeDir(tempDir);
  }
});
