const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildHedgeExecutionPlan,
  buildIdempotencyKey,
  buildActionPlanningTelemetry,
  executeHedgeLeg,
  normalizeExecutionFailure,
  processTriggeredAction,
} = require('../../cli/lib/mirror_sync/execution.cjs');

const VERIFY_PAYLOAD = {
  sourceMarket: {
    yesTokenId: 'yes-token-id',
    noTokenId: 'no-token-id',
  },
};

test('buildHedgeExecutionPlan models paper sell-side inventory recycling when tracked hedge is sufficient', () => {
  const plan = buildHedgeExecutionPlan({
    options: { executeLive: false },
    plan: { hedgeTriggered: true, plannedHedgeUsdc: 4, gapUsdc: -4 },
    state: { currentHedgeUsdc: 9 },
    verifyPayload: VERIFY_PAYLOAD,
    depth: {},
  });

  assert.equal(plan.side, 'sell');
  assert.equal(plan.tokenSide, 'yes');
  assert.equal(plan.tokenId, 'yes-token-id');
  assert.equal(plan.executionMode, 'sell-inventory');
  assert.equal(plan.stateDeltaUsdc, -4);
  assert.equal(plan.inventoryUsdcAvailable, 9);
  assert.equal(plan.recycleEligible, true);
  assert.equal(plan.liveSellAllowed, false);
  assert.equal(plan.recycleReason, 'inventory-recycled-paper');
});

test('buildHedgeExecutionPlan keeps live hedging on buy-side when sell depth is unavailable', () => {
  const plan = buildHedgeExecutionPlan({
    options: { executeLive: true },
    plan: { hedgeTriggered: true, plannedHedgeUsdc: 4, gapUsdc: -4 },
    state: { currentHedgeUsdc: 9 },
    verifyPayload: VERIFY_PAYLOAD,
    depth: {},
  });

  assert.equal(plan.side, 'buy');
  assert.equal(plan.tokenSide, 'no');
  assert.equal(plan.tokenId, 'no-token-id');
  assert.equal(plan.executionMode, 'buy');
  assert.equal(plan.stateDeltaUsdc, -4);
  assert.equal(plan.recycleEligible, true);
  assert.equal(plan.liveSellAllowed, false);
  assert.equal(plan.recycleReason, 'sell-depth-unavailable');
});

test('executeHedgeLeg submits sell-side hedge when runtime sell depth proves safety', async () => {
  const action = {};
  const state = {
    currentHedgeUsdc: 5,
    cumulativeHedgeNotionalUsdc: 0,
    cumulativeHedgeCostApproxUsdc: 0,
  };
  const calls = [];

  const actualHedgeUsdc = await executeHedgeLeg({
    options: {
      executeLive: true,
      polymarketHost: 'https://clob.polymarket.com',
      polymarketMockUrl: 'https://mock.invalid',
      privateKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      funder: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
    action,
    plan: { hedgeTriggered: true, plannedHedgeUsdc: 3, gapUsdc: -3 },
    verifyPayload: VERIFY_PAYLOAD,
    depth: {
      sellYesDepth: {
        depthUsd: 10,
        depthShares: 10,
        referencePrice: 0.48,
        midPrice: 0.48,
        worstPrice: 0.47,
      },
    },
    hedgeFn: async (params) => {
      calls.push(params);
      return { ok: true, status: 'accepted' };
    },
    state,
  });

  assert.equal(actualHedgeUsdc, 1.44);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].host, 'https://clob.polymarket.com');
  assert.equal(calls[0].mockUrl, 'https://mock.invalid');
  assert.equal(calls[0].tokenId, 'yes-token-id');
  assert.equal(calls[0].side, 'sell');
  assert.equal(calls[0].amountUsd, 1.44);
  assert.equal(calls[0].privateKey, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(calls[0].funder, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert.equal(calls[0].apiKey, null);
  assert.equal(calls[0].apiSecret, null);
  assert.equal(calls[0].apiPassphrase, null);
  assert.ok(!Object.prototype.hasOwnProperty.call(calls[0], 'rpcUrl') || calls[0].rpcUrl === null);
  assert.equal(action.hedge.tokenSide, 'yes');
  assert.equal(action.hedge.side, 'sell');
  assert.equal(action.hedge.executionMode, 'sell-inventory');
  assert.equal(action.hedge.amountShares, 3);
  assert.equal(action.hedge.referencePrice, 0.48);
  assert.equal(action.hedge.stateDeltaUsdc, -3);
  assert.equal(action.hedge.inventoryUsdcAvailable, 5);
  assert.equal(state.currentHedgeUsdc, 2);
  assert.equal(state.cumulativeHedgeNotionalUsdc, 1.44);
  assert.equal(state.cumulativeHedgeCostApproxUsdc, 0.03);
});

test('executeHedgeLeg prefers explicit polymarket auth context over legacy privateKey/funder fields', async () => {
  const action = {};
  const state = {
    currentHedgeUsdc: 0,
    cumulativeHedgeNotionalUsdc: 0,
    cumulativeHedgeCostApproxUsdc: 0,
  };
  const calls = [];

  const actualHedgeUsdc = await executeHedgeLeg({
    options: {
      executeLive: true,
      polymarketHost: 'https://clob.polymarket.com',
      privateKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      funder: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      polymarketPrivateKey: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      polymarketFunder: '0xdddddddddddddddddddddddddddddddddddddddd',
      polymarketApiKey: 'api-key-from-context',
      polymarketApiSecret: 'api-secret-from-context',
      polymarketApiPassphrase: 'api-passphrase-from-context',
    },
    action,
    plan: { hedgeTriggered: true, plannedHedgeUsdc: 2, plannedHedgeShares: 2, gapUsdc: 2 },
    verifyPayload: VERIFY_PAYLOAD,
    depth: {
      yesDepth: {
        depthUsd: 10,
        depthShares: 10,
        referencePrice: 0.4,
        midPrice: 0.4,
        worstPrice: 0.41,
      },
    },
    hedgeFn: async (params) => {
      calls.push(params);
      return { ok: true, status: 'accepted' };
    },
    state,
  });

  assert.equal(actualHedgeUsdc, 0.8);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].privateKey, '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc');
  assert.equal(calls[0].funder, '0xdddddddddddddddddddddddddddddddddddddddd');
  assert.equal(calls[0].apiKey, 'api-key-from-context');
  assert.equal(calls[0].apiSecret, 'api-secret-from-context');
  assert.equal(calls[0].apiPassphrase, 'api-passphrase-from-context');
});

test('buildHedgeExecutionPlan derives order usd from share size and reference price', () => {
  const plan = buildHedgeExecutionPlan({
    options: { executeLive: true },
    plan: { hedgeTriggered: true, plannedHedgeUsdc: 42.99, plannedHedgeShares: 42.99, gapUsdc: -42.99 },
    state: { currentHedgeUsdc: 0 },
    verifyPayload: VERIFY_PAYLOAD,
    depth: {
      noDepth: {
        depthUsd: 100,
        depthShares: 200,
        referencePrice: 0.52,
        midPrice: 0.52,
        worstPrice: 0.53,
      },
    },
  });

  assert.equal(plan.side, 'buy');
  assert.equal(plan.tokenSide, 'no');
  assert.equal(plan.amountShares, 42.99);
  assert.equal(plan.amountUsdc, 22.3548);
  assert.equal(plan.stateDeltaUsdc, -42.99);
});

test('buildHedgeExecutionPlan uses adopted side-specific inventory for sell eligibility', () => {
  const plan = buildHedgeExecutionPlan({
    options: { executeLive: false },
    plan: { hedgeTriggered: true, plannedHedgeUsdc: 4, plannedHedgeShares: 4, gapUsdc: -4 },
    state: {
      currentHedgeUsdc: 0,
      accounting: {
        managedPolymarketYesUsdc: 6,
        managedPolymarketNoUsdc: 1,
      },
    },
    verifyPayload: VERIFY_PAYLOAD,
    depth: {},
  });

  assert.equal(plan.side, 'sell');
  assert.equal(plan.tokenSide, 'yes');
  assert.equal(plan.inventorySharesAvailable, 6);
  assert.equal(plan.recycleEligible, true);
});

test('reported live recycle incident shape falls back to buy-side and blocks on manual review state instead', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-sync-incident-164-'));
  const stateFile = path.join(tempDir, 'state.json');
  const state = {
    schemaVersion: '1.0.0',
    startedAt: '2026-03-17T15:00:00.000Z',
    lastResetDay: '2026-03-17',
    dailySpendUsdc: 0,
    tradesToday: 0,
    currentHedgeUsdc: 0,
    currentHedgeShares: 0,
    cumulativeLpFeesApproxUsdc: 0,
    cumulativeHedgeNotionalUsdc: 0,
    cumulativeHedgeCostApproxUsdc: 0,
    idempotencyKeys: [],
    alerts: [],
    accounting: {
      managedPolymarketYesShares: 0,
      managedPolymarketNoShares: 0,
      managedPolymarketYesUsdc: 0,
      managedPolymarketNoUsdc: 0,
    },
    lastExecution: {
      mode: 'live',
      status: 'failed',
      idempotencyKey: 'incident-prior-action',
      requiresManualReview: true,
      lockNonce: 'incident-lock',
      error: {
        code: 'REBALANCE_EXECUTION_FAILED',
        message: 'Missing USDC token address. Set USDC in env or pass --usdc.',
      },
      hedge: {
        tokenSide: 'yes',
        side: 'buy',
        recycleEligible: false,
        liveSellAllowed: false,
        recycleReason: 'insufficient-managed-inventory',
        executionMode: 'buy',
      },
    },
  };
  const snapshot = { actionPlan: {} };
  const plan = {
    hedgeTriggered: true,
    plannedHedgeUsdc: 50,
    plannedHedgeShares: 50,
    plannedSpendUsdc: 33.5,
    gapUsdc: 50,
    rebalanceSide: 'no',
    plannedRebalanceUsdc: 25,
    rebalanceSizingMode: 'atomic',
    rebalanceTargetUsdc: 126.05887,
    reserveSource: 'onchain:outcome-token-balances',
  };
  const hedgeExecutionPlan = buildHedgeExecutionPlan({
    options: { executeLive: true },
    plan,
    state,
    verifyPayload: VERIFY_PAYLOAD,
    depth: {},
  });

  assert.equal(hedgeExecutionPlan.side, 'buy');
  assert.equal(hedgeExecutionPlan.tokenSide, 'yes');
  assert.equal(hedgeExecutionPlan.executionMode, 'buy');
  assert.equal(hedgeExecutionPlan.recycleEligible, false);
  assert.equal(hedgeExecutionPlan.recycleReason, 'insufficient-managed-inventory');

  let rebalanceCalls = 0;
  let hedgeCalls = 0;
  const actions = [];

  await processTriggeredAction({
    options: {
      executeLive: true,
      pandoraMarketAddress: '0x1111111111111111111111111111111111111111',
      polymarketSlug: 'ucl-mnc1-rma1-2026-03-17-rma1',
      cooldownMs: 60_000,
      mode: 'run',
    },
    state,
    snapshot,
    plan,
    gate: {
      ok: true,
      failedChecks: [],
      failedChecksRaw: [],
      bypassedFailedChecks: [],
    },
    tickAt: new Date('2026-03-17T18:44:20.350Z'),
    loadedFilePath: stateFile,
    rebalanceFn: async () => {
      rebalanceCalls += 1;
      return { ok: true };
    },
    hedgeFn: async () => {
      hedgeCalls += 1;
      return { ok: true };
    },
    sendWebhook: null,
    strategyHash: 'incident-164',
    iteration: 624,
    actions,
    webhookReports: [],
    snapshotMetrics: {
      driftTriggered: true,
      driftBps: 176,
    },
    verifyPayload: VERIFY_PAYLOAD,
    depth: {},
  });

  assert.equal(rebalanceCalls, 0);
  assert.equal(hedgeCalls, 0);
  assert.equal(actions.length, 1);
  assert.equal(snapshot.action.status, 'blocked');
  assert.equal(snapshot.action.code, 'LAST_ACTION_REQUIRES_REVIEW');
  assert.equal(snapshot.action.block.kind, 'last-execution-review');
  assert.equal(snapshot.action.planning.hedgeOrderSide, 'buy');
  assert.equal(snapshot.action.planning.hedgeExecutionMode, 'buy');
  assert.equal(snapshot.action.planning.hedgeRecycleReason, 'insufficient-managed-inventory');

  const auditFile = `${stateFile}.audit.jsonl`;
  const auditEntry = JSON.parse(fs.readFileSync(auditFile, 'utf8').trim());
  assert.equal(auditEntry.code, 'LAST_ACTION_REQUIRES_REVIEW');
  assert.equal(auditEntry.details.block.kind, 'last-execution-review');
  assert.equal(auditEntry.details.planning.hedgeOrderSide, 'buy');
  assert.equal(auditEntry.details.planning.hedgeRecycleReason, 'insufficient-managed-inventory');
});

test('executeHedgeLeg keeps share-named inventory aliases in sync with legacy fields', async () => {
  const action = {};
  const state = {
    currentHedgeShares: 5,
    currentHedgeUsdc: 5,
    cumulativeHedgeNotionalUsdc: 0,
    cumulativeHedgeCostApproxUsdc: 0,
    accounting: {
      managedPolymarketYesShares: 5,
      managedPolymarketNoShares: 0,
      managedPolymarketYesUsdc: 5,
      managedPolymarketNoUsdc: 0,
    },
  };

  await executeHedgeLeg({
    options: {
      executeLive: false,
      polymarketHost: 'https://clob.polymarket.com',
      polymarketMockUrl: 'https://mock.invalid',
      privateKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      funder: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
    action,
    plan: { hedgeTriggered: true, plannedHedgeUsdc: 2, plannedHedgeShares: 2, gapUsdc: -2 },
    verifyPayload: VERIFY_PAYLOAD,
    depth: {},
    hedgeFn: async () => ({ ok: true, status: 'accepted' }),
    state,
  });

  assert.equal(state.currentHedgeShares, 3);
  assert.equal(state.currentHedgeUsdc, 3);
  assert.equal(state.accounting.managedPolymarketYesShares, 3);
  assert.equal(state.accounting.managedPolymarketYesUsdc, 3);
});

test('buildIdempotencyKey distinguishes hedge execution mode and order side', () => {
  const baseOptions = {
    pandoraMarketAddress: '0x1111111111111111111111111111111111111111',
    polymarketMarketId: 'poly-1',
    cooldownMs: 60_000,
  };
  const nowMs = 1_700_000_000_000;
  const buyKey = buildIdempotencyKey(
    baseOptions,
    {
      metrics: { driftTriggered: false, hedgeTriggered: true },
      actionPlan: {
        rebalanceSide: null,
        hedgeTokenSide: 'no',
        hedgeOrderSide: 'buy',
        hedgeExecutionMode: 'buy',
        rebalanceUsdc: 0,
        hedgeUsdc: 4,
      },
    },
    nowMs,
  );
  const sellKey = buildIdempotencyKey(
    baseOptions,
    {
      metrics: { driftTriggered: false, hedgeTriggered: true },
      actionPlan: {
        rebalanceSide: null,
        hedgeTokenSide: 'yes',
        hedgeOrderSide: 'sell',
        hedgeExecutionMode: 'sell-inventory',
        rebalanceUsdc: 0,
        hedgeUsdc: 4,
      },
    },
    nowMs,
  );

  assert.notEqual(buyKey, sellKey);
});

test('normalizeExecutionFailure preserves flashbots route provenance from error details', () => {
  const error = new Error('Flashbots relay rejected eth_sendBundle.');
  error.code = 'FLASHBOTS_RPC_ERROR';
  error.details = {
    transactionHash: `0x${'8'.repeat(64)}`,
    requestedRoute: 'flashbots-bundle',
    resolvedRoute: 'flashbots-bundle',
    executionRouteFallback: 'fail',
    relayUrl: 'https://relay.flashbots.example',
    relayMethod: 'eth_sendBundle',
    targetBlockNumber: 12345678,
    relayResponseId: 7,
    bundleHash: `0x${'7'.repeat(64)}`,
    simulation: { results: [{ gasUsed: '0x1' }] },
  };

  const payload = normalizeExecutionFailure(error);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'FLASHBOTS_RPC_ERROR');
  assert.equal(payload.tradeTxHash, `0x${'8'.repeat(64)}`);
  assert.equal(payload.txHash, `0x${'8'.repeat(64)}`);
  assert.equal(payload.executionRouteRequested, 'flashbots-bundle');
  assert.equal(payload.executionRouteResolved, 'flashbots-bundle');
  assert.equal(payload.executionRouteFallback, 'fail');
  assert.equal(payload.flashbotsRelayUrl, 'https://relay.flashbots.example');
  assert.equal(payload.flashbotsRelayMethod, 'eth_sendBundle');
  assert.equal(payload.flashbotsTargetBlockNumber, 12345678);
  assert.equal(payload.flashbotsRelayResponseId, 7);
  assert.equal(payload.flashbotsBundleHash, `0x${'7'.repeat(64)}`);
  assert.deepEqual(payload.flashbotsSimulation, { results: [{ gasUsed: '0x1' }] });
});

test('buildActionPlanningTelemetry preserves recycle telemetry without turning it into a block reason', () => {
  const planning = buildActionPlanningTelemetry({
    actionPlan: {
      hedgeTokenSide: 'yes',
      hedgeOrderSide: 'buy',
      hedgeExecutionMode: 'buy',
      hedgeRecycleEligible: false,
      hedgeLiveSellAllowed: false,
      hedgeRecycleReason: 'insufficient-managed-inventory',
      hedgeOrderUsd: 8,
      hedgeOrderShares: 50,
    },
  });

  assert.deepEqual(planning, {
    rebalanceSide: null,
    plannedSpendUsdc: null,
    hedgeTokenSide: 'yes',
    hedgeOrderSide: 'buy',
    hedgeExecutionMode: 'buy',
    hedgeStateDeltaUsdc: null,
    hedgeInventoryUsdcAvailable: null,
    hedgeInventorySharesAvailable: null,
    hedgeRecycleEligible: false,
    hedgeLiveSellAllowed: false,
    hedgeRecycleReason: 'insufficient-managed-inventory',
    hedgeOrderReferencePrice: null,
    hedgeOrderUsd: 8,
    hedgeOrderShares: 50,
  });
});

test('processTriggeredAction audits last-action-review blocks separately from hedge recycle telemetry', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-sync-execution-'));
  const stateFile = path.join(tempDir, 'state.json');
  const state = {
    schemaVersion: '1.0.0',
    startedAt: '2026-03-18T00:00:00.000Z',
    lastResetDay: '2026-03-18',
    dailySpendUsdc: 0,
    tradesToday: 0,
    currentHedgeUsdc: 0,
    currentHedgeShares: 0,
    cumulativeLpFeesApproxUsdc: 0,
    cumulativeHedgeNotionalUsdc: 0,
    cumulativeHedgeCostApproxUsdc: 0,
    idempotencyKeys: [],
    alerts: [],
    lastExecution: {
      mode: 'live',
      status: 'failed',
      idempotencyKey: 'prior-action',
      requiresManualReview: true,
      lockNonce: 'review-lock',
    },
  };
  const snapshot = { actionPlan: {} };
  const actions = [];
  let rebalanceCalls = 0;
  let hedgeCalls = 0;

  await processTriggeredAction({
    options: {
      executeLive: true,
      pandoraMarketAddress: '0x1111111111111111111111111111111111111111',
      polymarketSlug: 'market-slug',
      cooldownMs: 60_000,
      mode: 'run',
    },
    state,
    snapshot,
    plan: {
      hedgeTriggered: true,
      plannedHedgeUsdc: 50,
      plannedHedgeShares: 50,
      plannedSpendUsdc: 8,
      gapUsdc: 50,
      rebalanceSide: 'no',
      plannedRebalanceUsdc: 0,
      rebalanceSizingMode: 'atomic',
      rebalanceTargetUsdc: 0,
      reserveSource: 'onchain:outcome-token-balances',
    },
    gate: {
      ok: true,
      failedChecks: [],
      failedChecksRaw: [],
      bypassedFailedChecks: [],
    },
    tickAt: new Date('2026-03-18T10:00:00.000Z'),
    loadedFilePath: stateFile,
    rebalanceFn: async () => {
      rebalanceCalls += 1;
      return { ok: true };
    },
    hedgeFn: async () => {
      hedgeCalls += 1;
      return { ok: true };
    },
    sendWebhook: null,
    strategyHash: 'hash-164',
    iteration: 164,
    actions,
    webhookReports: [],
    snapshotMetrics: {
      driftTriggered: false,
      driftBps: 0,
    },
    verifyPayload: VERIFY_PAYLOAD,
    depth: {},
  });

  assert.equal(rebalanceCalls, 0);
  assert.equal(hedgeCalls, 0);
  assert.equal(actions.length, 1);
  assert.equal(snapshot.action.status, 'blocked');
  assert.equal(snapshot.action.code, 'LAST_ACTION_REQUIRES_REVIEW');
  assert.equal(snapshot.action.block.kind, 'last-execution-review');
  assert.equal(snapshot.action.planning.hedgeRecycleReason, 'insufficient-managed-inventory');
  assert.equal(snapshot.action.planning.hedgeOrderSide, 'buy');

  const persistedState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(persistedState.alerts.length, 1);
  assert.equal(persistedState.alerts[0].code, 'LAST_ACTION_REQUIRES_REVIEW');

  const auditFile = `${stateFile}.audit.jsonl`;
  const auditEntries = fs.readFileSync(auditFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(auditEntries.length, 1);
  assert.equal(auditEntries[0].classification, 'sync-action');
  assert.equal(auditEntries[0].status, 'blocked');
  assert.equal(auditEntries[0].code, 'LAST_ACTION_REQUIRES_REVIEW');
  assert.equal(auditEntries[0].message, 'Previous live action still requires manual review before another execution.');
  assert.equal(auditEntries[0].details.block.kind, 'last-execution-review');
  assert.equal(auditEntries[0].details.planning.hedgeRecycleReason, 'insufficient-managed-inventory');
  assert.equal(auditEntries[0].details.planning.hedgeOrderSide, 'buy');
});

test('processTriggeredAction audits strict gate blocks separately from hedge recycle telemetry', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-sync-execution-gate-'));
  const stateFile = path.join(tempDir, 'state.json');
  const state = {
    schemaVersion: '1.0.0',
    startedAt: '2026-03-18T00:00:00.000Z',
    lastResetDay: '2026-03-18',
    dailySpendUsdc: 0,
    tradesToday: 0,
    currentHedgeUsdc: 0,
    currentHedgeShares: 0,
    cumulativeLpFeesApproxUsdc: 0,
    cumulativeHedgeNotionalUsdc: 0,
    cumulativeHedgeCostApproxUsdc: 0,
    idempotencyKeys: [],
    alerts: [],
  };
  const snapshot = { actionPlan: {} };

  await processTriggeredAction({
    options: {
      executeLive: true,
      pandoraMarketAddress: '0x1111111111111111111111111111111111111111',
      polymarketSlug: 'market-slug',
      cooldownMs: 60_000,
      mode: 'run',
    },
    state,
    snapshot,
    plan: {
      hedgeTriggered: true,
      plannedHedgeUsdc: 50,
      plannedHedgeShares: 50,
      plannedSpendUsdc: 8,
      gapUsdc: 50,
      rebalanceSide: 'no',
      plannedRebalanceUsdc: 0,
      rebalanceSizingMode: 'atomic',
      rebalanceTargetUsdc: 0,
      reserveSource: 'onchain:outcome-token-balances',
    },
    gate: {
      ok: false,
      failedChecks: ['DEPTH_COVERAGE'],
      failedChecksRaw: ['DEPTH_COVERAGE'],
      bypassedFailedChecks: [],
    },
    tickAt: new Date('2026-03-18T10:05:00.000Z'),
    loadedFilePath: stateFile,
    rebalanceFn: async () => ({ ok: true }),
    hedgeFn: async () => ({ ok: true }),
    sendWebhook: null,
    strategyHash: 'hash-164',
    iteration: 165,
    actions: [],
    webhookReports: [],
    snapshotMetrics: {
      driftTriggered: false,
      driftBps: 0,
    },
    verifyPayload: VERIFY_PAYLOAD,
    depth: {},
  });

  assert.equal(snapshot.action.status, 'blocked');
  assert.equal(snapshot.action.code, 'STRICT_GATE_BLOCKED');
  assert.equal(snapshot.action.block.kind, 'gate');
  assert.equal(snapshot.action.failedChecks[0], 'DEPTH_COVERAGE');
  assert.equal(snapshot.action.planning.hedgeRecycleReason, 'insufficient-managed-inventory');

  const auditFile = `${stateFile}.audit.jsonl`;
  const auditEntry = JSON.parse(fs.readFileSync(auditFile, 'utf8').trim());
  assert.equal(auditEntry.code, 'STRICT_GATE_BLOCKED');
  assert.equal(auditEntry.details.block.kind, 'gate');
  assert.deepEqual(auditEntry.details.failedChecks, ['DEPTH_COVERAGE']);
  assert.equal(auditEntry.details.planning.hedgeRecycleReason, 'insufficient-managed-inventory');
});
