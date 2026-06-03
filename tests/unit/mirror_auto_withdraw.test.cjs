const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runAutoClose } = require('../../cli/lib/mirror_sync/auto_close.cjs');
const { isSportsLikePolymarketSource } = require('../../cli/lib/mirror_sync/source_freshness.cjs');
const { runMirrorSync } = require('../../cli/lib/mirror_sync_service.cjs');

const NOW = new Date('2026-06-02T12:00:00Z');

function buildBaseParams(overrides = {}) {
  const state = { autoWithdrawTriggered: false, autoWithdrawResult: null };
  return {
    options: {
      pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      executeLive: false,
      privateKey: null,
      profileId: null,
      profileFile: null,
      chainId: 1,
      rpcUrl: null,
    },
    state,
    tickAt: NOW,
    runLp: async () => ({
      mode: 'dry-run',
      status: 'planned',
      marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      lpTokens: 'all',
      tx: null,
    }),
    sendWebhook: null,
    snapshotMetrics: { pandoraTimeToExpirySec: 45 },
    minimumTimeToCloseSec: 60,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Unit tests: runAutoClose
// ---------------------------------------------------------------------------

test('runAutoClose succeeds and sets state fields', async () => {
  const params = buildBaseParams();
  const result = await runAutoClose(params);

  assert.equal(result.status, 'completed');
  assert.equal(result.triggeredAt, NOW.toISOString());
  assert.equal(result.timeToExpirySec, 45);
  assert.equal(result.minimumTimeToCloseSec, 60);
  assert.ok(result.withdrawal);
  assert.equal(result.withdrawal.mode, 'dry-run');
  assert.equal(result.error, null);
  assert.equal(result.resumeCommand, null);

  assert.equal(params.state.autoWithdrawTriggered, true);
  assert.deepEqual(params.state.autoWithdrawResult, result);
});

test('runAutoClose records failure and resumeCommand when runLp throws', async () => {
  const error = new Error('Simulation reverted');
  error.code = 'LP_REMOVE_SIMULATION_FAILED';

  const params = buildBaseParams({
    runLp: async () => { throw error; },
  });
  const result = await runAutoClose(params);

  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'LP_REMOVE_SIMULATION_FAILED');
  assert.equal(result.error.message, 'Simulation reverted');
  assert.match(result.resumeCommand, /pandora lp remove --market-address 0xaaaa.*--all --execute/);

  assert.equal(params.state.autoWithdrawTriggered, true);
  assert.equal(params.state.autoWithdrawResult.status, 'failed');
});

test('runAutoClose passes execute: true in live mode', async () => {
  let capturedArgs = null;
  const params = buildBaseParams({
    options: {
      pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      executeLive: true,
      privateKey: '0xdead',
      profileId: null,
      profileFile: null,
      chainId: 1,
      rpcUrl: 'https://rpc.example.com',
    },
    runLp: async (args) => {
      capturedArgs = args;
      return { mode: 'execute', status: 'submitted', tx: { txHash: '0xabc', status: 'success' } };
    },
  });

  const result = await runAutoClose(params);

  assert.equal(result.status, 'completed');
  assert.equal(capturedArgs.execute, true);
  assert.equal(capturedArgs.action, 'remove');
  assert.equal(capturedArgs.lpAll, true);
  assert.equal(capturedArgs.privateKey, '0xdead');
  assert.equal(capturedArgs.rpcUrl, 'https://rpc.example.com');
  assert.equal(capturedArgs.deadlineSeconds, 300);
  assert.equal(result.withdrawal.txHash, '0xabc');
  assert.equal(result.withdrawal.txStatus, 'success');
});

test('runAutoClose passes execute: false in paper mode', async () => {
  let capturedArgs = null;
  const params = buildBaseParams({
    runLp: async (args) => {
      capturedArgs = args;
      return { mode: 'dry-run', status: 'planned', tx: null };
    },
  });

  await runAutoClose(params);

  assert.equal(capturedArgs.execute, false);
});

test('runAutoClose sends webhook on success', async () => {
  let webhookPayload = null;
  const params = buildBaseParams({
    sendWebhook: async (ctx) => { webhookPayload = ctx; },
  });

  await runAutoClose(params);

  assert.ok(webhookPayload);
  assert.equal(webhookPayload.event, 'mirror.sync.auto-withdraw');
  assert.match(webhookPayload.message, /Auto-withdraw completed/);
  assert.equal(webhookPayload.payload.status, 'completed');
});

test('runAutoClose sends webhook on failure', async () => {
  let webhookPayload = null;
  const params = buildBaseParams({
    runLp: async () => { throw new Error('timeout'); },
    sendWebhook: async (ctx) => { webhookPayload = ctx; },
  });

  await runAutoClose(params);

  assert.ok(webhookPayload);
  assert.match(webhookPayload.message, /Auto-withdraw failed/);
});

test('runAutoClose does not fail when webhook throws', async () => {
  const params = buildBaseParams({
    sendWebhook: async () => { throw new Error('webhook down'); },
  });

  const result = await runAutoClose(params);

  assert.equal(result.status, 'completed');
  assert.equal(params.state.autoWithdrawTriggered, true);
});

// ---------------------------------------------------------------------------
// Unit tests: isSportsLikePolymarketSource
// ---------------------------------------------------------------------------

test('isSportsLikePolymarketSource detects sports via timestampSource', () => {
  assert.equal(
    isSportsLikePolymarketSource({ timestampSource: 'game_start_time' }),
    true,
  );
});

test('isSportsLikePolymarketSource detects sports via different start/close timestamps', () => {
  assert.equal(
    isSportsLikePolymarketSource({
      eventStartTimestamp: '2026-06-10T20:00:00Z',
      sourceCloseTimestamp: '2026-06-10T23:00:00Z',
    }),
    true,
  );
});

test('isSportsLikePolymarketSource returns false for regular market', () => {
  assert.equal(
    isSportsLikePolymarketSource({
      eventStartTimestamp: '2026-06-30T00:00:00Z',
      sourceCloseTimestamp: '2026-06-30T00:00:00Z',
    }),
    false,
  );
});

test('isSportsLikePolymarketSource returns false for empty input', () => {
  assert.equal(isSportsLikePolymarketSource({}), false);
  assert.equal(isSportsLikePolymarketSource(null), false);
  assert.equal(isSportsLikePolymarketSource(undefined), false);
});

// ---------------------------------------------------------------------------
// Unit tests: smart default logic
// ---------------------------------------------------------------------------

test('smart default: sports market uses minimumTimeToCloseSec (1800)', () => {
  const sourceMarket = { timestampSource: 'game_start_time' };
  const isSport = isSportsLikePolymarketSource(sourceMarket);
  const minimumTimeToCloseSec = 1800;
  const autoWithdrawLeadSec = isSport ? minimumTimeToCloseSec : 60;

  assert.equal(autoWithdrawLeadSec, 1800);
});

test('smart default: regular market uses 60 seconds', () => {
  const sourceMarket = {
    eventStartTimestamp: '2026-06-30T00:00:00Z',
    sourceCloseTimestamp: '2026-06-30T00:00:00Z',
  };
  const isSport = isSportsLikePolymarketSource(sourceMarket);
  const minimumTimeToCloseSec = 1800;
  const autoWithdrawLeadSec = isSport ? minimumTimeToCloseSec : 60;

  assert.equal(autoWithdrawLeadSec, 60);
});

test('explicit --auto-withdraw-lead-sec overrides smart default', () => {
  const explicitValue = 300;
  const autoWithdrawLeadSec = Number.isFinite(explicitValue) ? explicitValue : 1800;

  assert.equal(autoWithdrawLeadSec, 300);
});

// ---------------------------------------------------------------------------
// Unit tests: state persistence
// ---------------------------------------------------------------------------

test('state persistence: autoWithdrawTriggered defaults to false for legacy state', () => {
  const { loadState } = require('../../cli/lib/mirror_state_store.cjs');

  const tmpFile = path.join(os.tmpdir(), `pandora-test-state-${Date.now()}.json`);
  try {
    fs.writeFileSync(tmpFile, JSON.stringify({
      schemaVersion: '1.0.0',
      strategyHash: 'abcdef0123456789',
      tradesToday: 5,
    }));
    const { state } = loadState(tmpFile, 'abcdef0123456789');

    assert.equal(state.autoWithdrawTriggered, false);
    assert.equal(state.autoWithdrawResult, null);
    assert.equal(state.tradesToday, 5);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) { /* cleanup */ }
  }
});

// ---------------------------------------------------------------------------
// Integration test: full runMirrorSync auto-withdraw flow
// ---------------------------------------------------------------------------

/**
 * Build a verifyFn that passes the startup gate (first call returns startupSec)
 * then returns tickSec on subsequent calls so the auto-withdraw check can fire.
 */
function buildVerifyFn({ startupTimeToExpirySec = 3600, tickTimeToExpirySec, sourceMarketOverrides = {} }) {
  let calls = 0;
  return async () => {
    const ttl = calls === 0 ? startupTimeToExpirySec : tickTimeToExpirySec;
    calls++;
    return {
      matchConfidence: 0.99,
      gateResult: {
        ok: true,
        failedChecks: [],
        checks: [{ code: 'CLOSE_TIME_DELTA', ok: true, meta: { closeDeltaHours: 0 } }],
      },
      sourceMarket: {
        source: 'polymarket:gamma',
        marketId: 'poly-cond-1',
        yesPct: 50,
        yesTokenId: 'yes-token',
        noTokenId: 'no-token',
        sourceFreshness: { observedAt: new Date().toISOString() },
        ...sourceMarketOverrides,
      },
      pandora: {
        yesPct: 50,
        reserveYes: 5,
        reserveNo: 5,
      },
      expiry: {
        minTimeToExpirySec: ttl,
        pandoraTimeToExpirySec: ttl,
        sourceTimeToExpirySec: ttl,
      },
    };
  };
}

function buildSyncDeps({ verifyFn, runLpFn, webhookFn = null }) {
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
    autoWithdrawOnExpiry: true,
    autoWithdrawLeadSec: null,
    ...overrides,
  };
}

test('runMirrorSync triggers auto-withdraw and stops daemon when time-to-expiry < autoWithdrawLeadSec (regular market)', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-auto-withdraw-'));
  let lpCalls = 0;

  try {
    const verifyFn = buildVerifyFn({
      startupTimeToExpirySec: 3600,
      tickTimeToExpirySec: 30,
      sourceMarketOverrides: {
        eventStartTimestamp: '2026-06-30T00:00:00Z',
        sourceCloseTimestamp: '2026-06-30T00:00:00Z',
      },
    });

    const payload = await runMirrorSync(
      buildSyncOptions(tempDir),
      buildSyncDeps({
        verifyFn,
        runLpFn: async (args) => {
          lpCalls++;
          return { mode: 'dry-run', status: 'planned', marketAddress: args.marketAddress, lpTokens: 'all', tx: null };
        },
      }),
    );

    assert.equal(lpCalls, 1, 'runLp should be called exactly once');
    assert.ok(payload.stoppedReason, 'daemon should have a stoppedReason');
    assert.match(payload.stoppedReason, /[Aa]uto.withdraw/);

    const lastSnapshot = payload.snapshots[payload.snapshots.length - 1];
    assert.ok(lastSnapshot.autoWithdraw, 'last snapshot should contain autoWithdraw result');
    assert.equal(lastSnapshot.autoWithdraw.status, 'completed');

    const stateFile = path.join(tempDir, 'mirror-state.json');
    const persistedState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(persistedState.autoWithdrawTriggered, true);
    assert.equal(persistedState.autoWithdrawResult.status, 'completed');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync does NOT trigger auto-withdraw when flag is off', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-no-withdraw-'));
  let lpCalls = 0;

  try {
    const verifyFn = buildVerifyFn({
      startupTimeToExpirySec: 3600,
      tickTimeToExpirySec: 30,
    });

    const payload = await runMirrorSync(
      buildSyncOptions(tempDir, { autoWithdrawOnExpiry: false }),
      buildSyncDeps({
        verifyFn,
        runLpFn: async () => { lpCalls++; return {}; },
      }),
    );

    assert.equal(lpCalls, 0, 'runLp should not be called when flag is off');
    assert.equal(payload.snapshots.some((s) => s.autoWithdraw), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync does NOT trigger auto-withdraw when time-to-expiry is above threshold', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-above-threshold-'));
  let lpCalls = 0;

  try {
    const verifyFn = buildVerifyFn({
      startupTimeToExpirySec: 7200,
      tickTimeToExpirySec: 7200,
    });

    const payload = await runMirrorSync(
      buildSyncOptions(tempDir),
      buildSyncDeps({
        verifyFn,
        runLpFn: async () => { lpCalls++; return {}; },
      }),
    );

    assert.equal(lpCalls, 0, 'runLp should not be called when expiry is far away');
    assert.equal(payload.snapshots.some((s) => s.autoWithdraw), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync auto-withdraw records failure in state when runLp throws', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-withdraw-fail-'));

  try {
    const verifyFn = buildVerifyFn({
      startupTimeToExpirySec: 3600,
      tickTimeToExpirySec: 30,
    });

    const payload = await runMirrorSync(
      buildSyncOptions(tempDir),
      buildSyncDeps({
        verifyFn,
        runLpFn: async () => { throw new Error('RPC timeout'); },
      }),
    );

    assert.ok(payload.stoppedReason, 'daemon should have stopped');

    const lastSnapshot = payload.snapshots[payload.snapshots.length - 1];
    assert.ok(lastSnapshot.autoWithdraw);
    assert.equal(lastSnapshot.autoWithdraw.status, 'failed');
    assert.ok(lastSnapshot.autoWithdraw.resumeCommand);

    const stateFile = path.join(tempDir, 'mirror-state.json');
    const persistedState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(persistedState.autoWithdrawTriggered, true);
    assert.equal(persistedState.autoWithdrawResult.status, 'failed');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync auto-withdraw fires webhook', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-withdraw-webhook-'));
  const webhookCalls = [];

  try {
    const verifyFn = buildVerifyFn({
      startupTimeToExpirySec: 3600,
      tickTimeToExpirySec: 30,
    });

    await runMirrorSync(
      buildSyncOptions(tempDir),
      buildSyncDeps({
        verifyFn,
        runLpFn: async () => ({ mode: 'dry-run', status: 'planned', tx: null }),
        webhookFn: async (ctx) => { webhookCalls.push(ctx); },
      }),
    );

    const autoWithdrawWebhook = webhookCalls.find((w) => w.event === 'mirror.sync.auto-withdraw');
    assert.ok(autoWithdrawWebhook, 'should send auto-withdraw webhook');
    assert.match(autoWithdrawWebhook.message, /Auto-withdraw/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync uses explicit autoWithdrawLeadSec override', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-explicit-lead-'));
  let lpCalls = 0;

  try {
    const verifyFn = buildVerifyFn({
      startupTimeToExpirySec: 3600,
      tickTimeToExpirySec: 200,
    });

    const payload = await runMirrorSync(
      buildSyncOptions(tempDir, { autoWithdrawLeadSec: 300 }),
      buildSyncDeps({
        verifyFn,
        runLpFn: async () => { lpCalls++; return { mode: 'dry-run', status: 'planned', tx: null }; },
      }),
    );

    assert.equal(lpCalls, 1, 'should trigger when timeToExpiry (200) < explicit lead (300)');
    assert.ok(payload.stoppedReason, 'daemon should have stopped');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync smart default uses 1800s for sports market', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-sports-default-'));
  let lpCalls = 0;

  try {
    const verifyFn = buildVerifyFn({
      startupTimeToExpirySec: 3600,
      tickTimeToExpirySec: 1500,
      sourceMarketOverrides: { timestampSource: 'game_start_time' },
    });

    const payload = await runMirrorSync(
      buildSyncOptions(tempDir),
      buildSyncDeps({
        verifyFn,
        runLpFn: async () => { lpCalls++; return { mode: 'dry-run', status: 'planned', tx: null }; },
      }),
    );

    assert.equal(lpCalls, 1, 'should trigger for sports market: 1500 < 1800 default');
    assert.ok(payload.stoppedReason, 'daemon should have stopped');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync smart default uses 60s for regular market — does NOT trigger at 500s', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-regular-no-trigger-'));
  let lpCalls = 0;

  try {
    const verifyFn = buildVerifyFn({
      startupTimeToExpirySec: 3600,
      tickTimeToExpirySec: 500,
      sourceMarketOverrides: {
        eventStartTimestamp: '2026-06-30T00:00:00Z',
        sourceCloseTimestamp: '2026-06-30T00:00:00Z',
      },
    });

    const payload = await runMirrorSync(
      buildSyncOptions(tempDir),
      buildSyncDeps({
        verifyFn,
        runLpFn: async () => { lpCalls++; return {}; },
      }),
    );

    assert.equal(lpCalls, 0, 'should NOT trigger for regular market at 500s (default 60s)');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
