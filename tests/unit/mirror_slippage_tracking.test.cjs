const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { extractHedgeFillData, resolveFeeFraction } = require('../../cli/lib/mirror_sync/execution.cjs');
const { evaluateSlippageAlert } = require('../../cli/lib/mirror_sync/hedge_gap_monitor.cjs');
const { buildPnlMetrics } = require('../../cli/lib/mirror_sync/planning.cjs');
const { runMirrorSync } = require('../../cli/lib/mirror_sync_service.cjs');

// ---------------------------------------------------------------------------
// extractHedgeFillData
// ---------------------------------------------------------------------------

test('extractHedgeFillData parses buy-side fill from CLOB response', () => {
  const result = extractHedgeFillData({
    ok: true,
    response: { success: true, takingAmount: '20', makingAmount: '50' },
  }, 'buy');

  assert.ok(result);
  assert.equal(result.takingAmount, 20);
  assert.equal(result.makingAmount, 50);
  assert.equal(result.usdcAmount, 20);
  assert.equal(result.sharesAmount, 50);
  assert.equal(result.fillPricePerShare, 0.4);
});

test('extractHedgeFillData parses sell-side fill from CLOB response', () => {
  const result = extractHedgeFillData({
    ok: true,
    response: { success: true, takingAmount: '100', makingAmount: '60' },
  }, 'sell');

  assert.ok(result);
  assert.equal(result.usdcAmount, 60);
  assert.equal(result.sharesAmount, 100);
  assert.equal(result.fillPricePerShare, 0.6);
});

test('extractHedgeFillData returns null for missing response', () => {
  assert.equal(extractHedgeFillData(null, 'buy'), null);
  assert.equal(extractHedgeFillData({}, 'buy'), null);
  assert.equal(extractHedgeFillData({ ok: true }, 'buy'), null);
});

test('extractHedgeFillData returns null for zero amounts', () => {
  const result = extractHedgeFillData({
    ok: true,
    response: { takingAmount: '0', makingAmount: '50' },
  }, 'buy');
  assert.equal(result, null);
});

test('extractHedgeFillData returns null when fields are absent', () => {
  const result = extractHedgeFillData({
    ok: true,
    response: { success: true, status: 'matched' },
  }, 'buy');
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// resolveFeeFraction
// ---------------------------------------------------------------------------

test('resolveFeeFraction reads feeTier 3000 as 0.3%', () => {
  const fraction = resolveFeeFraction({ reserveFeeTier: 3000 });
  assert.equal(fraction, 0.003);
});

test('resolveFeeFraction reads feeTier 500 as 0.05%', () => {
  const fraction = resolveFeeFraction({ reserveFeeTier: 500 });
  assert.equal(fraction, 0.0005);
});

test('resolveFeeFraction reads feeTier 10000 as 1%', () => {
  const fraction = resolveFeeFraction({ reserveFeeTier: 10000 });
  assert.equal(fraction, 0.01);
});

test('resolveFeeFraction falls back to 0.003 when feeTier is absent', () => {
  assert.equal(resolveFeeFraction({}), 0.003);
  assert.equal(resolveFeeFraction(null), 0.003);
  assert.equal(resolveFeeFraction({ reserveFeeTier: null }), 0.003);
});

// ---------------------------------------------------------------------------
// buildPnlMetrics
// ---------------------------------------------------------------------------

test('buildPnlMetrics computes profitable P&L', () => {
  const state = {
    cumulativeLpFeesApproxUsdc: 10,
    cumulativeHedgeCostApproxUsdc: 3,
    cumulativeHedgeSlippageRealizedUsdc: 0,
    cumulativeHedgeNotionalUsdc: 100,
  };
  const pnl = buildPnlMetrics(state);

  assert.equal(pnl.cumulativeLpFeesApproxUsdc, 10);
  assert.equal(pnl.cumulativeHedgeSlippageApproxUsdc, 3);
  assert.equal(pnl.netPnlApproxUsdc, 7);
  assert.equal(pnl.netPnlStatus, 'profitable');
});

test('buildPnlMetrics prefers realized slippage over approx', () => {
  const state = {
    cumulativeLpFeesApproxUsdc: 10,
    cumulativeHedgeCostApproxUsdc: 3,
    cumulativeHedgeSlippageRealizedUsdc: 5,
    cumulativeHedgeNotionalUsdc: 100,
  };
  const pnl = buildPnlMetrics(state);

  assert.equal(pnl.netPnlApproxUsdc, 5);
  assert.equal(pnl.netPnlStatus, 'profitable');
});

test('buildPnlMetrics reports net-negative P&L', () => {
  const state = {
    cumulativeLpFeesApproxUsdc: 2,
    cumulativeHedgeCostApproxUsdc: 5,
    cumulativeHedgeSlippageRealizedUsdc: 0,
    cumulativeHedgeNotionalUsdc: 100,
  };
  const pnl = buildPnlMetrics(state);

  assert.equal(pnl.netPnlApproxUsdc, -3);
  assert.equal(pnl.netPnlStatus, 'net-negative');
});

test('buildPnlMetrics returns null for null state', () => {
  assert.equal(buildPnlMetrics(null), null);
});

test('buildPnlMetrics handles empty state gracefully', () => {
  const pnl = buildPnlMetrics({});
  assert.equal(pnl.cumulativeLpFeesApproxUsdc, 0);
  assert.equal(pnl.netPnlApproxUsdc, 0);
  assert.equal(pnl.netPnlStatus, 'profitable');
});

// ---------------------------------------------------------------------------
// evaluateSlippageAlert
// ---------------------------------------------------------------------------

test('evaluateSlippageAlert fires slippage alert when threshold exceeded', async () => {
  const state = { netNegativeAlertActive: false };
  let webhookPayload = null;

  const result = await evaluateSlippageAlert({
    realizedSlippageUsdc: 5,
    slippageAlertThresholdUsdc: 3,
    state,
    netPnlApproxUsdc: 10,
    sendWebhook: async (ctx) => { webhookPayload = ctx; },
    strategyHash: 'abc123',
  });

  assert.equal(result.slippageAlertFired, true);
  assert.equal(result.netNegativeAlertFired, false);
  assert.ok(webhookPayload);
  assert.equal(webhookPayload.event, 'mirror.sync.slippage-alert');
  assert.match(webhookPayload.message, /5/);
});

test('evaluateSlippageAlert does not fire when slippage below threshold', async () => {
  const state = { netNegativeAlertActive: false };
  let webhookCalls = 0;

  const result = await evaluateSlippageAlert({
    realizedSlippageUsdc: 1,
    slippageAlertThresholdUsdc: 3,
    state,
    netPnlApproxUsdc: 10,
    sendWebhook: async () => { webhookCalls++; },
    strategyHash: null,
  });

  assert.equal(result.slippageAlertFired, false);
  assert.equal(webhookCalls, 0);
});

test('evaluateSlippageAlert fires net-negative alert when P&L goes negative', async () => {
  const state = { netNegativeAlertActive: false };
  let webhookPayload = null;

  const result = await evaluateSlippageAlert({
    realizedSlippageUsdc: null,
    slippageAlertThresholdUsdc: null,
    state,
    netPnlApproxUsdc: -5,
    sendWebhook: async (ctx) => { webhookPayload = ctx; },
    strategyHash: 'xyz',
  });

  assert.equal(result.netNegativeAlertFired, true);
  assert.equal(state.netNegativeAlertActive, true);
  assert.ok(webhookPayload);
  assert.equal(webhookPayload.event, 'mirror.sync.net-negative-alert');
});

test('evaluateSlippageAlert does not re-fire net-negative when already active', async () => {
  const state = { netNegativeAlertActive: true };
  let webhookCalls = 0;

  const result = await evaluateSlippageAlert({
    realizedSlippageUsdc: null,
    slippageAlertThresholdUsdc: null,
    state,
    netPnlApproxUsdc: -3,
    sendWebhook: async () => { webhookCalls++; },
    strategyHash: null,
  });

  assert.equal(result.netNegativeAlertFired, false);
  assert.equal(webhookCalls, 0);
});

test('evaluateSlippageAlert resets net-negative when P&L recovers', async () => {
  const state = { netNegativeAlertActive: true };

  const result = await evaluateSlippageAlert({
    realizedSlippageUsdc: null,
    slippageAlertThresholdUsdc: null,
    state,
    netPnlApproxUsdc: 2,
    sendWebhook: null,
    strategyHash: null,
  });

  assert.equal(result.netNegativeAlertFired, false);
  assert.equal(state.netNegativeAlertActive, false);
});

test('evaluateSlippageAlert skips when thresholds are null', async () => {
  const state = { netNegativeAlertActive: false };

  const result = await evaluateSlippageAlert({
    realizedSlippageUsdc: 100,
    slippageAlertThresholdUsdc: null,
    state,
    netPnlApproxUsdc: null,
    sendWebhook: null,
    strategyHash: null,
  });

  assert.equal(result.slippageAlertFired, false);
  assert.equal(result.netNegativeAlertFired, false);
});

test('evaluateSlippageAlert tolerates webhook failure', async () => {
  const state = { netNegativeAlertActive: false };

  const result = await evaluateSlippageAlert({
    realizedSlippageUsdc: 10,
    slippageAlertThresholdUsdc: 1,
    state,
    netPnlApproxUsdc: -5,
    sendWebhook: async () => { throw new Error('down'); },
    strategyHash: null,
  });

  assert.equal(result.slippageAlertFired, true);
  assert.equal(result.netNegativeAlertFired, true);
});

// ---------------------------------------------------------------------------
// State persistence: new fields default correctly
// ---------------------------------------------------------------------------

test('state persistence: slippage tracking fields default correctly for legacy state', () => {
  const { loadState } = require('../../cli/lib/mirror_state_store.cjs');

  const tmpFile = path.join(os.tmpdir(), `pandora-test-slippage-state-${Date.now()}.json`);
  try {
    fs.writeFileSync(tmpFile, JSON.stringify({
      schemaVersion: '1.0.0',
      strategyHash: 'abcdef0123456789',
      cumulativeHedgeCostApproxUsdc: 1.5,
    }));
    const { state } = loadState(tmpFile, 'abcdef0123456789');

    assert.equal(state.cumulativeHedgeCostApproxUsdc, 1.5);
    assert.equal(state.cumulativeHedgeSlippageRealizedUsdc, 0);
    assert.equal(state.netNegativeAlertActive, false);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) { /* cleanup */ }
  }
});

// ---------------------------------------------------------------------------
// Integration: runMirrorSync tick snapshot includes pnl
// ---------------------------------------------------------------------------

const NOW = new Date('2026-06-03T12:00:00Z');

function buildVerifyFn() {
  return async () => ({
    matchConfidence: 0.99,
    gateResult: { ok: true, failedChecks: [], checks: [{ code: 'CLOSE_TIME_DELTA', ok: true, meta: { closeDeltaHours: 0 } }] },
    sourceMarket: {
      source: 'polymarket:gamma',
      marketId: 'poly-cond-1',
      yesPct: 50,
      yesTokenId: 'yes-token',
      noTokenId: 'no-token',
      sourceFreshness: { observedAt: new Date().toISOString() },
    },
    pandora: { yesPct: 50, reserveYes: 5, reserveNo: 5 },
    expiry: { minTimeToExpirySec: 7200, pandoraTimeToExpirySec: 7200, sourceTimeToExpirySec: 7200 },
  });
}

function buildSyncDeps({ verifyFn, webhookFn = null }) {
  return {
    verifyFn,
    depthFn: async () => ({
      depthWithinSlippageUsd: 1000,
      yesDepth: { depthUsd: 1000, depthShares: 1000, referencePrice: 0.5, midPrice: 0.5, worstPrice: 0.51 },
      noDepth: { depthUsd: 1000, depthShares: 1000, referencePrice: 0.5, midPrice: 0.5, worstPrice: 0.51 },
    }),
    readPandoraReserveContext: async () => ({
      source: 'onchain:outcome-token-balances',
      reserveYesUsdc: 5,
      reserveNoUsdc: 5,
      pandoraYesPct: 50,
      feeTier: 3000,
      readAt: '2026-06-03T12:00:00.000Z',
    }),
    hedgeFn: async () => ({ ok: true, response: { status: 'simulated' } }),
    rebalanceFn: async () => ({ ok: true }),
    runLp: null,
    sendWebhook: webhookFn,
    now: () => NOW,
  };
}

function buildSyncOptions(tempDir, overrides = {}) {
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const killSwitchFile = path.join(tempDir, 'STOP');
  return {
    mode: 'once',
    indexerUrl: 'https://example.invalid/graphql',
    timeoutMs: 1000,
    pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    polymarketMarketId: 'poly-cond-1',
    polymarketSlug: null,
    executeLive: false,
    trustDeploy: false,
    hedgeEnabled: false,
    hedgeRatio: 1,
    rebalanceSizingMode: 'incremental',
    intervalMs: 10,
    driftTriggerBps: 150,
    hedgeTriggerUsdc: 1,
    maxRebalanceUsdc: 25,
    maxHedgeUsdc: 10,
    maxOpenExposureUsdc: 100,
    maxTradesPerDay: 10,
    cooldownMs: 0,
    depthSlippageBps: 100,
    stateFile,
    killSwitchFile,
    rpcUrl: 'https://rpc.example',
    polymarketHost: 'https://clob.polymarket.com',
    autoWithdrawOnExpiry: false,
    autoWithdrawLeadSec: null,
    hedgeRetryCount: 0,
    hedgeRetryDelayMs: 100,
    hedgeGapAlertUsdc: null,
    hedgeGapCriticalUsdc: null,
    hedgeSlippageAlertUsdc: null,
    ...overrides,
  };
}

test('runMirrorSync tick snapshot includes pnl section', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-pnl-'));

  try {
    const payload = await runMirrorSync(
      buildSyncOptions(tempDir),
      buildSyncDeps({ verifyFn: buildVerifyFn() }),
    );

    assert.ok(payload.snapshots.length > 0);
    const snapshot = payload.snapshots[0];
    assert.ok(snapshot.pnl, 'snapshot should contain pnl section');
    assert.equal(typeof snapshot.pnl.netPnlApproxUsdc, 'number');
    assert.ok(['profitable', 'net-negative'].includes(snapshot.pnl.netPnlStatus));
    assert.equal(typeof snapshot.pnl.cumulativeLpFeesApproxUsdc, 'number');
    assert.equal(typeof snapshot.pnl.cumulativeHedgeSlippageApproxUsdc, 'number');
    assert.equal(typeof snapshot.pnl.cumulativeHedgeSlippageRealizedUsdc, 'number');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
