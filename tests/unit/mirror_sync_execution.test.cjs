const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildHedgeExecutionPlan,
  buildIdempotencyKey,
  executeHedgeLeg,
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
  assert.deepEqual(calls, [
    {
      host: 'https://clob.polymarket.com',
      mockUrl: 'https://mock.invalid',
      tokenId: 'yes-token-id',
      side: 'sell',
      amountUsd: 3,
      privateKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      funder: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      apiKey: null,
      apiSecret: null,
      apiPassphrase: null,
    },
  ]);
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
