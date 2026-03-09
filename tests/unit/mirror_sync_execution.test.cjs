const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildHedgeExecutionPlan,
  buildIdempotencyKey,
  executeHedgeLeg,
  normalizeExecutionFailure,
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

  assert.equal(actualHedgeUsdc, 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].host, 'https://clob.polymarket.com');
  assert.equal(calls[0].mockUrl, 'https://mock.invalid');
  assert.equal(calls[0].tokenId, 'yes-token-id');
  assert.equal(calls[0].side, 'sell');
  assert.equal(calls[0].amountUsd, 3);
  assert.equal(calls[0].privateKey, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(calls[0].funder, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert.equal(calls[0].apiKey, null);
  assert.equal(calls[0].apiSecret, null);
  assert.equal(calls[0].apiPassphrase, null);
  assert.ok(!Object.prototype.hasOwnProperty.call(calls[0], 'rpcUrl') || calls[0].rpcUrl === null);
  assert.equal(action.hedge.tokenSide, 'yes');
  assert.equal(action.hedge.side, 'sell');
  assert.equal(action.hedge.executionMode, 'sell-inventory');
  assert.equal(action.hedge.stateDeltaUsdc, -3);
  assert.equal(action.hedge.inventoryUsdcAvailable, 5);
  assert.equal(state.currentHedgeUsdc, 2);
  assert.equal(state.cumulativeHedgeNotionalUsdc, 3);
  assert.equal(state.cumulativeHedgeCostApproxUsdc, 0.0625);
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
