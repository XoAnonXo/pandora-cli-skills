const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fetchDepthForMarket,
  fetchPolymarketPositionInventory,
} = require('../../cli/lib/polymarket_trade_adapter.cjs');

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

test('fetchPolymarketPositionInventory normalizes raw-sized Data API balances into display shares', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      positions: [
        {
          condition_id: 'poly-cond-1',
          token_id: '101',
          outcome: 'Yes',
          balance: '50000000',
          current_price: '0.55',
          current_value: '27.5',
        },
        {
          condition_id: 'poly-cond-1',
          token_id: '202',
          outcome: 'No',
          balance: '250000000',
          current_price: '0.45',
          current_value: '112.5',
        },
      ],
    }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const dataApiUrl = `http://127.0.0.1:${address.port}`;

  try {
    const payload = await fetchPolymarketPositionInventory({
      source: 'api',
      walletAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      dataApiUrl,
      market: {
        marketId: 'poly-cond-1',
        slug: 'poly-slug-1',
        yesTokenId: '101',
        noTokenId: '202',
        yesPct: 55,
        noPct: 45,
      },
    });

    assert.equal(payload.summary.yesBalance, 50);
    assert.equal(payload.summary.noBalance, 250);
    assert.equal(payload.summary.positionDeltaApprox, -200);

    const yesPosition = payload.positions.find((entry) => entry.tokenId === '101');
    const noPosition = payload.positions.find((entry) => entry.tokenId === '202');
    assert.equal(yesPosition.balance, 50);
    assert.equal(yesPosition.balanceRaw, '50000000');
    assert.equal(noPosition.balance, 250);
    assert.equal(noPosition.balanceRaw, '250000000');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('fetchPolymarketPositionInventory normalizes raw-sized Data API balances without current_value', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      positions: [
        {
          condition_id: 'poly-cond-1',
          token_id: '101',
          outcome: 'Yes',
          balance: '50000000',
          current_price: '0.55',
        },
        {
          condition_id: 'poly-cond-1',
          token_id: '202',
          outcome: 'No',
          balance: '250000000',
          current_price: '0.45',
        },
      ],
    }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const dataApiUrl = `http://127.0.0.1:${address.port}`;

  try {
    const payload = await fetchPolymarketPositionInventory({
      source: 'api',
      walletAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      dataApiUrl,
      market: {
        marketId: 'poly-cond-1',
        slug: 'poly-slug-1',
        yesTokenId: '101',
        noTokenId: '202',
        yesPct: 55,
        noPct: 45,
      },
    });

    assert.equal(payload.summary.yesBalance, 50);
    assert.equal(payload.summary.noBalance, 250);

    const yesPosition = payload.positions.find((entry) => entry.tokenId === '101');
    const noPosition = payload.positions.find((entry) => entry.tokenId === '202');
    assert.equal(yesPosition.balance, 50);
    assert.equal(yesPosition.balanceRaw, '50000000');
    assert.equal(yesPosition.estimatedValueUsd, 27.5);
    assert.equal(noPosition.balance, 250);
    assert.equal(noPosition.balanceRaw, '250000000');
    assert.equal(noPosition.estimatedValueUsd, 112.5);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
