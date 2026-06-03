const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { retryHedgeOrder, isValidationError } = require('../../cli/lib/mirror_sync/hedge_retry.cjs');
const { evaluateHedgeGapAlert } = require('../../cli/lib/mirror_sync/hedge_gap_monitor.cjs');
const { runAutoClose } = require('../../cli/lib/mirror_sync/auto_close.cjs');
const { runMirrorSync } = require('../../cli/lib/mirror_sync_service.cjs');

const NOW = new Date('2026-06-02T12:00:00Z');
const noSleep = async () => {};

// ---------------------------------------------------------------------------
// Layer 1: retryHedgeOrder
// ---------------------------------------------------------------------------

test('retryHedgeOrder succeeds on first attempt with no retries', async () => {
  const result = await retryHedgeOrder({
    hedgeFn: async () => ({ ok: true, response: { status: 'accepted' } }),
    hedgeArgs: { tokenId: 'tok-1', side: 'buy', amountUsd: 5 },
    maxRetries: 3,
    baseDelayMs: 10,
    sleep: noSleep,
  });

  assert.equal(result.result.ok, true);
  assert.equal(result.retryCount, 0);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].ok, true);
});

test('retryHedgeOrder retries transient ok:false and succeeds on 3rd attempt', async () => {
  let calls = 0;
  const result = await retryHedgeOrder({
    hedgeFn: async () => {
      calls++;
      if (calls < 3) return { ok: false, error: { code: 'TIMEOUT', message: 'request timed out' } };
      return { ok: true, response: { status: 'accepted' } };
    },
    hedgeArgs: { tokenId: 'tok-1', side: 'buy', amountUsd: 5 },
    maxRetries: 3,
    baseDelayMs: 10,
    sleep: noSleep,
  });

  assert.equal(result.result.ok, true);
  assert.equal(result.retryCount, 2);
  assert.equal(result.attempts.length, 3);
  assert.equal(result.attempts[0].ok, false);
  assert.equal(result.attempts[1].ok, false);
  assert.equal(result.attempts[2].ok, true);
});

test('retryHedgeOrder exhausts all retries and returns last failure', async () => {
  const result = await retryHedgeOrder({
    hedgeFn: async () => ({ ok: false, error: { code: 'API_DOWN', message: 'service unavailable' } }),
    hedgeArgs: { tokenId: 'tok-1', side: 'buy', amountUsd: 5 },
    maxRetries: 2,
    baseDelayMs: 10,
    sleep: noSleep,
  });

  assert.equal(result.result.ok, false);
  assert.equal(result.result.error.code, 'API_DOWN');
  assert.equal(result.retryCount, 2);
  assert.equal(result.attempts.length, 3);
});

test('retryHedgeOrder does not retry when maxRetries is 0', async () => {
  let calls = 0;
  const result = await retryHedgeOrder({
    hedgeFn: async () => { calls++; return { ok: false, error: { message: 'fail' } }; },
    hedgeArgs: {},
    maxRetries: 0,
    baseDelayMs: 10,
    sleep: noSleep,
  });

  assert.equal(calls, 1);
  assert.equal(result.retryCount, 0);
  assert.equal(result.result.ok, false);
});

test('retryHedgeOrder retries thrown transient errors', async () => {
  let calls = 0;
  const result = await retryHedgeOrder({
    hedgeFn: async () => {
      calls++;
      if (calls < 2) throw new Error('network timeout');
      return { ok: true };
    },
    hedgeArgs: {},
    maxRetries: 3,
    baseDelayMs: 10,
    sleep: noSleep,
  });

  assert.equal(result.result.ok, true);
  assert.equal(result.retryCount, 1);
  assert.equal(result.attempts[0].thrown, true);
  assert.equal(result.attempts[1].thrown, false);
});

test('retryHedgeOrder does NOT retry validation errors — propagates immediately', async () => {
  await assert.rejects(
    () => retryHedgeOrder({
      hedgeFn: async () => { throw new Error('amountUsd must be a positive number for hedge execution.'); },
      hedgeArgs: {},
      maxRetries: 3,
      baseDelayMs: 10,
      sleep: noSleep,
    }),
    { message: /must be a positive number/ },
  );
});

test('retryHedgeOrder does NOT retry missing tokenId validation', async () => {
  await assert.rejects(
    () => retryHedgeOrder({
      hedgeFn: async () => { throw new Error('Missing tokenId for Polymarket hedge order.'); },
      hedgeArgs: {},
      maxRetries: 3,
      baseDelayMs: 10,
      sleep: noSleep,
    }),
    { message: /Missing.*tokenId/ },
  );
});

test('isValidationError classifies validation errors correctly', () => {
  assert.equal(isValidationError(new Error('amountUsd must be a positive number')), true);
  assert.equal(isValidationError(new Error('Missing tokenId for Polymarket')), true);
  assert.equal(isValidationError(new Error('Unsupported order side: xyz')), true);
  assert.equal(isValidationError({ code: 'POLYMARKET_WALLET_DEPENDENCY_MISSING' }), true);
  assert.equal(isValidationError(new Error('network timeout')), false);
  assert.equal(isValidationError(new Error('request failed with status 500')), false);
  assert.equal(isValidationError(null), false);
});

// ---------------------------------------------------------------------------
// Layer 2: evaluateHedgeGapAlert
// ---------------------------------------------------------------------------

test('evaluateHedgeGapAlert fires alert when gap exceeds threshold', async () => {
  const state = { hedgeGapAlertActive: false, emergencyWithdrawTriggered: false };
  let webhookPayload = null;

  const result = await evaluateHedgeGapAlert({
    hedgeGapUsdc: 45,
    alertThresholdUsdc: 30,
    criticalThresholdUsdc: null,
    state,
    currentHedgeUsdc: 10,
    targetHedgeUsdc: 55,
    sendWebhook: async (ctx) => { webhookPayload = ctx; },
    strategyHash: 'abc123',
  });

  assert.equal(result.alertFired, true);
  assert.equal(result.criticalTriggered, false);
  assert.equal(state.hedgeGapAlertActive, true);
  assert.ok(webhookPayload);
  assert.equal(webhookPayload.event, 'mirror.sync.hedge-gap-alert');
  assert.match(webhookPayload.message, /45/);
  assert.match(webhookPayload.message, /30/);
  assert.equal(webhookPayload.payload.hedgeGapUsdc, 45);
  assert.equal(webhookPayload.payload.alertThresholdUsdc, 30);
});

test('evaluateHedgeGapAlert does not re-fire when already active', async () => {
  const state = { hedgeGapAlertActive: true, emergencyWithdrawTriggered: false };
  let webhookCalls = 0;

  const result = await evaluateHedgeGapAlert({
    hedgeGapUsdc: 50,
    alertThresholdUsdc: 30,
    criticalThresholdUsdc: null,
    state,
    currentHedgeUsdc: 0,
    targetHedgeUsdc: 50,
    sendWebhook: async () => { webhookCalls++; },
    strategyHash: null,
  });

  assert.equal(result.alertFired, false);
  assert.equal(webhookCalls, 0);
  assert.equal(state.hedgeGapAlertActive, true);
});

test('evaluateHedgeGapAlert resets when gap drops below threshold', async () => {
  const state = { hedgeGapAlertActive: true, emergencyWithdrawTriggered: false };

  const result = await evaluateHedgeGapAlert({
    hedgeGapUsdc: 10,
    alertThresholdUsdc: 30,
    criticalThresholdUsdc: null,
    state,
    currentHedgeUsdc: 0,
    targetHedgeUsdc: 10,
    sendWebhook: null,
    strategyHash: null,
  });

  assert.equal(result.alertFired, false);
  assert.equal(state.hedgeGapAlertActive, false);
});

test('evaluateHedgeGapAlert works with negative gap (absolute value)', async () => {
  const state = { hedgeGapAlertActive: false, emergencyWithdrawTriggered: false };

  const result = await evaluateHedgeGapAlert({
    hedgeGapUsdc: -40,
    alertThresholdUsdc: 30,
    criticalThresholdUsdc: null,
    state,
    currentHedgeUsdc: 0,
    targetHedgeUsdc: -40,
    sendWebhook: null,
    strategyHash: null,
  });

  assert.equal(result.alertFired, true);
  assert.equal(state.hedgeGapAlertActive, true);
});

test('evaluateHedgeGapAlert triggers critical when gap exceeds critical threshold', async () => {
  const state = { hedgeGapAlertActive: false, emergencyWithdrawTriggered: false };

  const result = await evaluateHedgeGapAlert({
    hedgeGapUsdc: 100,
    alertThresholdUsdc: 30,
    criticalThresholdUsdc: 75,
    state,
    currentHedgeUsdc: 0,
    targetHedgeUsdc: 100,
    sendWebhook: null,
    strategyHash: null,
  });

  assert.equal(result.alertFired, true);
  assert.equal(result.criticalTriggered, true);
});

test('evaluateHedgeGapAlert does not trigger critical when already triggered', async () => {
  const state = { hedgeGapAlertActive: false, emergencyWithdrawTriggered: true };

  const result = await evaluateHedgeGapAlert({
    hedgeGapUsdc: 100,
    alertThresholdUsdc: null,
    criticalThresholdUsdc: 75,
    state,
    currentHedgeUsdc: 0,
    targetHedgeUsdc: 100,
    sendWebhook: null,
    strategyHash: null,
  });

  assert.equal(result.criticalTriggered, false);
});

test('evaluateHedgeGapAlert skips when thresholds are null (disabled)', async () => {
  const state = { hedgeGapAlertActive: false, emergencyWithdrawTriggered: false };

  const result = await evaluateHedgeGapAlert({
    hedgeGapUsdc: 1000,
    alertThresholdUsdc: null,
    criticalThresholdUsdc: null,
    state,
    currentHedgeUsdc: 0,
    targetHedgeUsdc: 1000,
    sendWebhook: null,
    strategyHash: null,
  });

  assert.equal(result.alertFired, false);
  assert.equal(result.criticalTriggered, false);
});

test('evaluateHedgeGapAlert handles null hedgeGapUsdc gracefully', async () => {
  const state = { hedgeGapAlertActive: false, emergencyWithdrawTriggered: false };

  const result = await evaluateHedgeGapAlert({
    hedgeGapUsdc: null,
    alertThresholdUsdc: 30,
    criticalThresholdUsdc: 75,
    state,
    currentHedgeUsdc: 0,
    targetHedgeUsdc: null,
    sendWebhook: null,
    strategyHash: null,
  });

  assert.equal(result.alertFired, false);
  assert.equal(result.criticalTriggered, false);
});

test('evaluateHedgeGapAlert tolerates webhook failure', async () => {
  const state = { hedgeGapAlertActive: false, emergencyWithdrawTriggered: false };

  const result = await evaluateHedgeGapAlert({
    hedgeGapUsdc: 50,
    alertThresholdUsdc: 30,
    criticalThresholdUsdc: null,
    state,
    currentHedgeUsdc: 0,
    targetHedgeUsdc: 50,
    sendWebhook: async () => { throw new Error('webhook down'); },
    strategyHash: null,
  });

  assert.equal(result.alertFired, true);
  assert.equal(state.hedgeGapAlertActive, true);
});

// ---------------------------------------------------------------------------
// Layer 3: Emergency withdrawal via runAutoClose (hedge-gap trigger)
// ---------------------------------------------------------------------------

test('runAutoClose with hedge-gap trigger sets emergencyWithdraw state fields', async () => {
  const state = { autoWithdrawTriggered: false, autoWithdrawResult: null, emergencyWithdrawTriggered: false, emergencyWithdrawResult: null };
  const result = await runAutoClose({
    options: { pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', executeLive: false },
    state,
    tickAt: NOW,
    runLp: async () => ({ mode: 'dry-run', status: 'planned', tx: null }),
    sendWebhook: null,
    snapshotMetrics: { pandoraTimeToExpirySec: 3600 },
    minimumTimeToCloseSec: 1800,
    trigger: 'hedge-gap',
    webhookEvent: 'mirror.sync.emergency-withdraw',
    triggerContext: { hedgeGapUsdc: 100, criticalThresholdUsdc: 75 },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.trigger, 'hedge-gap');
  assert.equal(result.hedgeGapUsdc, 100);
  assert.equal(result.criticalThresholdUsdc, 75);
  assert.equal(state.emergencyWithdrawTriggered, true);
  assert.ok(state.emergencyWithdrawResult);
  assert.equal(state.autoWithdrawTriggered, false);
});

test('runAutoClose with expiry trigger still sets autoWithdraw state fields', async () => {
  const state = { autoWithdrawTriggered: false, autoWithdrawResult: null, emergencyWithdrawTriggered: false, emergencyWithdrawResult: null };
  const result = await runAutoClose({
    options: { pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', executeLive: false },
    state,
    tickAt: NOW,
    runLp: async () => ({ mode: 'dry-run', status: 'planned', tx: null }),
    sendWebhook: null,
    snapshotMetrics: { pandoraTimeToExpirySec: 45 },
    minimumTimeToCloseSec: 60,
    trigger: 'expiry',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.trigger, 'expiry');
  assert.equal(state.autoWithdrawTriggered, true);
  assert.equal(state.emergencyWithdrawTriggered, false);
});

test('runAutoClose sends webhook with correct event name for hedge-gap trigger', async () => {
  let webhookPayload = null;
  const state = { emergencyWithdrawTriggered: false, emergencyWithdrawResult: null };

  await runAutoClose({
    options: { pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', executeLive: false },
    state,
    tickAt: NOW,
    runLp: async () => ({ mode: 'dry-run', status: 'planned', tx: null }),
    sendWebhook: async (ctx) => { webhookPayload = ctx; },
    snapshotMetrics: { pandoraTimeToExpirySec: 3600 },
    minimumTimeToCloseSec: 1800,
    trigger: 'hedge-gap',
    webhookEvent: 'mirror.sync.emergency-withdraw',
  });

  assert.ok(webhookPayload);
  assert.equal(webhookPayload.event, 'mirror.sync.emergency-withdraw');
  assert.match(webhookPayload.message, /hedge-gap/);
});

// ---------------------------------------------------------------------------
// State persistence: new fields default correctly
// ---------------------------------------------------------------------------

test('state persistence: new hedge safety fields default correctly for legacy state', () => {
  const { loadState } = require('../../cli/lib/mirror_state_store.cjs');

  const tmpFile = path.join(os.tmpdir(), `pandora-test-hedge-state-${Date.now()}.json`);
  try {
    fs.writeFileSync(tmpFile, JSON.stringify({
      schemaVersion: '1.0.0',
      strategyHash: 'abcdef0123456789',
      tradesToday: 3,
    }));
    const { state } = loadState(tmpFile, 'abcdef0123456789');

    assert.equal(state.hedgeGapAlertActive, false);
    assert.equal(state.emergencyWithdrawTriggered, false);
    assert.equal(state.emergencyWithdrawResult, null);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) { /* cleanup */ }
  }
});

// ---------------------------------------------------------------------------
// Integration: runMirrorSync with hedge gap emergency withdrawal
// ---------------------------------------------------------------------------

function buildVerifyFn({ startupTimeToExpirySec = 3600, tickTimeToExpirySec = 3600, sourceMarketOverrides = {}, reserves = null }) {
  const resYes = reserves ? reserves.yes : 5;
  const resNo = reserves ? reserves.no : 5;
  const yesPct = resYes + resNo > 0 ? Math.round((resNo / (resYes + resNo)) * 100) : 50;
  let calls = 0;
  return async () => {
    const ttl = calls === 0 ? startupTimeToExpirySec : tickTimeToExpirySec;
    calls++;
    return {
      matchConfidence: 0.99,
      gateResult: { ok: true, failedChecks: [], checks: [{ code: 'CLOSE_TIME_DELTA', ok: true, meta: { closeDeltaHours: 0 } }] },
      sourceMarket: {
        source: 'polymarket:gamma',
        marketId: 'poly-cond-1',
        yesPct,
        yesTokenId: 'yes-token',
        noTokenId: 'no-token',
        sourceFreshness: { observedAt: new Date().toISOString() },
        ...sourceMarketOverrides,
      },
      pandora: { yesPct, reserveYes: resYes, reserveNo: resNo },
      expiry: { minTimeToExpirySec: ttl, pandoraTimeToExpirySec: ttl, sourceTimeToExpirySec: ttl },
    };
  };
}

function buildSyncDeps({ verifyFn, runLpFn = null, webhookFn = null, reserves = null }) {
  const resYes = reserves ? reserves.yes : 5;
  const resNo = reserves ? reserves.no : 5;
  const yesPct = resYes + resNo > 0 ? Math.round((resNo / (resYes + resNo)) * 100) : 50;
  return {
    verifyFn,
    depthFn: async () => ({
      depthWithinSlippageUsd: 1000,
      yesDepth: { depthUsd: 1000, depthShares: 1000, referencePrice: 0.5, midPrice: 0.5, worstPrice: 0.51 },
      noDepth: { depthUsd: 1000, depthShares: 1000, referencePrice: 0.5, midPrice: 0.5, worstPrice: 0.51 },
    }),
    readPandoraReserveContext: async () => ({
      source: 'onchain:outcome-token-balances',
      reserveYesUsdc: resYes,
      reserveNoUsdc: resNo,
      pandoraYesPct: yesPct,
      feeTier: 3000,
      readAt: '2026-06-02T12:00:00.000Z',
    }),
    hedgeFn: async () => ({ ok: true, response: { status: 'simulated' } }),
    rebalanceFn: async () => ({ ok: true }),
    runLp: runLpFn,
    sendWebhook: webhookFn,
    now: () => NOW,
  };
}

function buildSyncOptions(tempDir, overrides = {}) {
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const killSwitchFile = path.join(tempDir, 'STOP');
  return {
    mode: 'run',
    iterations: 2,
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
    ...overrides,
  };
}

test('runMirrorSync fires hedge gap alert webhook when gap exceeds threshold', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-gap-alert-'));
  const webhookCalls = [];
  const unequalReserves = { yes: 10, no: 2 };

  try {
    const verifyFn = buildVerifyFn({ startupTimeToExpirySec: 7200, tickTimeToExpirySec: 7200, reserves: unequalReserves });

    await runMirrorSync(
      buildSyncOptions(tempDir, { hedgeGapAlertUsdc: 0.01 }),
      buildSyncDeps({
        verifyFn,
        webhookFn: async (ctx) => { webhookCalls.push(ctx); },
        reserves: unequalReserves,
      }),
    );

    const gapAlert = webhookCalls.find((w) => w.event === 'mirror.sync.hedge-gap-alert');
    assert.ok(gapAlert, 'should fire hedge-gap-alert webhook when gap exceeds threshold');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync does NOT fire hedge gap alert when threshold is null', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-no-gap-alert-'));
  const webhookCalls = [];

  try {
    const verifyFn = buildVerifyFn({ startupTimeToExpirySec: 7200, tickTimeToExpirySec: 7200 });

    await runMirrorSync(
      buildSyncOptions(tempDir, { hedgeGapAlertUsdc: null }),
      buildSyncDeps({
        verifyFn,
        webhookFn: async (ctx) => { webhookCalls.push(ctx); },
      }),
    );

    const gapAlert = webhookCalls.find((w) => w.event === 'mirror.sync.hedge-gap-alert');
    assert.equal(gapAlert, undefined, 'should NOT fire hedge-gap-alert when threshold is null');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync triggers emergency withdrawal on critical hedge gap', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-emergency-'));
  let lpCalls = 0;
  const unequalReserves = { yes: 10, no: 2 };

  try {
    const verifyFn = buildVerifyFn({ startupTimeToExpirySec: 7200, tickTimeToExpirySec: 7200, reserves: unequalReserves });

    const payload = await runMirrorSync(
      buildSyncOptions(tempDir, { hedgeGapCriticalUsdc: 0.001 }),
      buildSyncDeps({
        verifyFn,
        runLpFn: async () => { lpCalls++; return { mode: 'dry-run', status: 'planned', tx: null }; },
        reserves: unequalReserves,
      }),
    );

    assert.equal(lpCalls, 1, 'should call runLp for emergency withdrawal');
    assert.ok(payload.stoppedReason);
    assert.match(payload.stoppedReason, /[Ee]mergency/);

    const lastSnapshot = payload.snapshots[payload.snapshots.length - 1];
    assert.ok(lastSnapshot.emergencyWithdraw, 'snapshot should contain emergency withdraw result');

    const stateFile = path.join(tempDir, 'mirror-state.json');
    const persistedState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(persistedState.emergencyWithdrawTriggered, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync does NOT trigger emergency withdrawal when threshold is null', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-no-emergency-'));
  let lpCalls = 0;

  try {
    const verifyFn = buildVerifyFn({ startupTimeToExpirySec: 7200, tickTimeToExpirySec: 7200 });

    const payload = await runMirrorSync(
      buildSyncOptions(tempDir, { hedgeGapCriticalUsdc: null }),
      buildSyncDeps({
        verifyFn,
        runLpFn: async () => { lpCalls++; return {}; },
      }),
    );

    assert.equal(lpCalls, 0, 'should NOT call runLp when critical threshold is null');
    assert.equal(payload.stoppedReason, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
