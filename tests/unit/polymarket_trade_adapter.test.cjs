const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { fetchDepthForMarket } = require('../../cli/lib/polymarket_trade_adapter.cjs');

test('fetchDepthForMarket returns buy and sell depth entries with live-safety metadata', async () => {
  const market = {
    marketId: 'poly-cond-1',
    slug: 'poly-slug-1',
    yesTokenId: 'yes-token',
    noTokenId: 'no-token',
    mockOrderbooks: {
      'yes-token': {
        bids: [{ price: 0.39, size: 100 }],
        asks: [{ price: 0.41, size: 100 }],
      },
      'no-token': {
        bids: [{ price: 0.59, size: 120 }],
        asks: [{ price: 0.61, size: 110 }],
      },
    },
  };

  const payload = await fetchDepthForMarket(market, {
    mockUrl: 'https://example.invalid/polymarket-mock',
    slippageBps: 100,
    persistCache: false,
  });

  assert.equal(payload.depthSourceType, 'polymarket:mock');
  assert.equal(payload.usedCachedOrMockDepth, true);
  assert.equal(payload.depthFreshness.trustedForLive, false);
  assert.equal(payload.yesDepth.depthUsd > 0, true);
  assert.equal(payload.noDepth.depthUsd > 0, true);
  assert.equal(payload.sellYesDepth.depthUsd > 0, true);
  assert.equal(payload.sellNoDepth.depthUsd > 0, true);
  assert.equal(payload.yesSellDepth.depthUsd, payload.sellYesDepth.depthUsd);
  assert.equal(payload.noSellDepth.depthUsd, payload.sellNoDepth.depthUsd);
});

test('fetchDepthForMarket marks cached orderbook depth as not trusted for live routing', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-poly-depth-cache-'));
  const cacheFile = path.join(tempDir, 'depth-cache.json');
  const cachePayload = {
    schemaVersion: '1.0.0',
    savedAt: new Date(Date.now() - 30_000).toISOString(),
    orderbooks: {
      'yes-token': {
        bids: [{ price: 0.39, size: 50 }],
        asks: [{ price: 0.41, size: 50 }],
      },
      'no-token': {
        bids: [{ price: 0.59, size: 50 }],
        asks: [{ price: 0.61, size: 50 }],
      },
    },
  };
  fs.writeFileSync(cacheFile, JSON.stringify(cachePayload, null, 2));

  try {
    const payload = await fetchDepthForMarket(
      {
        marketId: 'poly-cond-1',
        yesTokenId: 'yes-token',
        noTokenId: 'no-token',
      },
      {
        mockUrl: 'https://example.invalid/force-cache-fallback',
        cacheFile,
        slippageBps: 100,
        maxAgeMs: 5_000,
        persistCache: false,
      },
    );

    assert.equal(payload.depthSourceType, 'polymarket:cache');
    assert.equal(payload.usedCachedOrMockDepth, true);
    assert.equal(payload.depthFreshness.fresh, false);
    assert.equal(payload.depthFreshness.trustedForLive, false);
    assert.equal(payload.sellYesDepth.depthUsd > 0, true);
    assert.equal(payload.sellNoDepth.depthUsd > 0, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
