const test = require('node:test');
const assert = require('node:assert/strict');

const { createPolymarketConnector } = require('../../cli/lib/connectors/polymarket_connector.cjs');

// ---------------------------------------------------------------------------
// Helpers: discover a real active market with balanced odds from Gamma
// ---------------------------------------------------------------------------

const LIVE_TEST_TIMEOUT = 25_000;

async function discoverBalancedMarket() {
  const res = await fetch(
    'https://gamma-api.polymarket.com/markets?limit=20&active=true&closed=false&order=volume24hr&ascending=false',
  );
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) throw new Error('No active markets from Gamma');

  for (const m of data) {
    const tokens = JSON.parse(m.clobTokenIds || m.clob_token_ids || '[]');
    if (tokens.length < 2) continue;

    const outcomePrices = m.outcomePrices ? JSON.parse(m.outcomePrices) : null;
    const yesPrice = outcomePrices ? parseFloat(outcomePrices[0]) : null;

    if (yesPrice !== null && yesPrice > 0.15 && yesPrice < 0.85) {
      return {
        conditionId: m.conditionId || m.condition_id,
        question: (m.question || '').slice(0, 80),
        yesTokenId: tokens[0],
        noTokenId: tokens[1],
        slug: m.slug,
        yesPrice,
        volumeUsd: parseFloat(m.volume || m.volumeNum || '0'),
        liquidityUsd: parseFloat(m.liquidity || m.liquidityNum || '0'),
      };
    }
  }
  throw new Error('No balanced-odds market found (all markets are >85% or <15%)');
}

let _cachedMarket = null;
async function getTestMarket() {
  if (!_cachedMarket) _cachedMarket = await discoverBalancedMarket();
  return _cachedMarket;
}

// ---------------------------------------------------------------------------
// LIVE TESTS — real Polymarket CLOB/Gamma calls (no mocks)
// ---------------------------------------------------------------------------

test('LIVE: getBook returns real L2 order book from Polymarket CLOB', { timeout: LIVE_TEST_TIMEOUT }, async () => {
  const market = await getTestMarket();
  const connector = createPolymarketConnector();

  const book = await connector.getBook({ tokenId: market.yesTokenId });

  assert.equal(book.venue, 'polymarket');
  assert.equal(book.tokenId, market.yesTokenId);
  assert.ok(!book.error, `getBook should not error: ${book.error}`);

  assert.ok(Array.isArray(book.bids), 'bids should be an array');
  assert.ok(Array.isArray(book.asks), 'asks should be an array');
  assert.ok(
    book.bids.length > 0,
    `real balanced market should have YES bids (market: ${market.question}, yesPrice: ${market.yesPrice})`,
  );
  assert.ok(
    book.asks.length > 0,
    `real balanced market should have YES asks (market: ${market.question}, yesPrice: ${market.yesPrice})`,
  );

  assert.ok(typeof book.bestBid === 'number' && book.bestBid > 0, 'bestBid should be a positive number');
  assert.ok(typeof book.bestAsk === 'number' && book.bestAsk > 0, 'bestAsk should be a positive number');
  assert.ok(book.bestAsk >= book.bestBid, `bestAsk (${book.bestAsk}) should be >= bestBid (${book.bestBid})`);
  assert.ok(typeof book.midPrice === 'number' && book.midPrice > 0, 'midPrice should be positive');
  assert.ok(typeof book.spreadBps === 'number' && book.spreadBps >= 0, 'spreadBps should be non-negative');
  assert.ok(book.bidLevels > 0, 'bidLevels should be positive');
  assert.ok(book.askLevels > 0, 'askLevels should be positive');

  for (const bid of book.bids.slice(0, 5)) {
    assert.ok(typeof bid.price === 'number' && bid.price > 0, 'bid price should be positive');
    assert.ok(typeof bid.size === 'number' && bid.size > 0, 'bid size should be positive');
  }
  for (const ask of book.asks.slice(0, 5)) {
    assert.ok(typeof ask.price === 'number' && ask.price > 0, 'ask price should be positive');
    assert.ok(typeof ask.size === 'number' && ask.size > 0, 'ask size should be positive');
  }
});

test('LIVE: getBook for NO token also works', { timeout: LIVE_TEST_TIMEOUT }, async () => {
  const market = await getTestMarket();
  const connector = createPolymarketConnector();

  const book = await connector.getBook({ tokenId: market.noTokenId });

  assert.ok(!book.error, `NO side getBook should not error: ${book.error}`);
  assert.ok(book.bids.length > 0, 'NO side of balanced market should have bids');
  assert.ok(book.asks.length > 0, 'NO side of balanced market should have asks');
  assert.ok(typeof book.spreadBps === 'number');
  assert.ok(typeof book.midPrice === 'number' && book.midPrice > 0);
});

test('LIVE: getBook spread is consistent with best bid/ask', { timeout: LIVE_TEST_TIMEOUT }, async () => {
  const market = await getTestMarket();
  const connector = createPolymarketConnector();

  const book = await connector.getBook({ tokenId: market.yesTokenId });

  if (book.bestBid && book.bestAsk && book.midPrice > 0) {
    const expectedSpreadBps = ((book.bestAsk - book.bestBid) / book.midPrice) * 10_000;
    assert.ok(
      Math.abs(book.spreadBps - expectedSpreadBps) < 1,
      `spreadBps (${book.spreadBps}) should match computed (${expectedSpreadBps})`,
    );
  }
});

test('LIVE: getDepth returns real executable depth from CLOB', { timeout: LIVE_TEST_TIMEOUT }, async () => {
  const market = await getTestMarket();
  const connector = createPolymarketConnector();

  const depth = await connector.getDepth({
    yesTokenId: market.yesTokenId,
    noTokenId: market.noTokenId,
    slippageBps: 200,
    targetUsd: 500,
  });

  assert.equal(depth.venue, 'polymarket');
  assert.ok(!depth.error, `getDepth should not error: ${depth.error}`);
  assert.ok(typeof depth.depthWithinSlippageUsd === 'number', 'depthWithinSlippageUsd should be a number');
  assert.ok(depth.depthWithinSlippageUsd > 0, 'balanced market should have non-zero depth');
  assert.equal(depth.slippageBps, 200);

  assert.ok(depth.yesDepth !== null, 'yesDepth should exist');
  assert.ok(typeof depth.yesDepth.depthUsd === 'number', 'yesDepth.depthUsd should be a number');
  assert.ok(typeof depth.yesDepth.midPrice === 'number', 'yesDepth.midPrice should be a number');
  assert.ok(depth.yesDepth.midPrice > 0 && depth.yesDepth.midPrice < 1, 'yesDepth.midPrice should be 0..1');

  assert.ok(depth.noDepth !== null, 'noDepth should exist');
  assert.ok(typeof depth.noDepth.depthUsd === 'number', 'noDepth.depthUsd should be a number');
  assert.ok(depth.noDepth.midPrice > 0 && depth.noDepth.midPrice < 1, 'noDepth.midPrice should be 0..1');

  if (depth.depthCoverage !== null) {
    assert.ok(depth.depthCoverage >= 0 && depth.depthCoverage <= 1, 'depthCoverage should be 0..1');
  }
});

test('LIVE: getDepth YES + NO midPrices are complementary (~1.0)', { timeout: LIVE_TEST_TIMEOUT }, async () => {
  const market = await getTestMarket();
  const connector = createPolymarketConnector();

  const depth = await connector.getDepth({
    yesTokenId: market.yesTokenId,
    noTokenId: market.noTokenId,
  });

  if (depth.yesDepth && depth.noDepth) {
    const sum = depth.yesDepth.midPrice + depth.noDepth.midPrice;
    assert.ok(
      sum > 0.95 && sum < 1.05,
      `YES mid (${depth.yesDepth.midPrice}) + NO mid (${depth.noDepth.midPrice}) = ${sum}, should be ~1.0`,
    );
  }
});

test('LIVE: getPrice returns markets with volumeUsd and liquidityUsd from Gamma', { timeout: LIVE_TEST_TIMEOUT }, async () => {
  const connector = createPolymarketConnector({ disableLiveFeed: true });

  const prices = await connector.getPrice({ limit: 5 });

  assert.equal(prices.venue, 'polymarket');
  assert.ok(Array.isArray(prices.items), 'items should be an array');
  assert.ok(prices.items.length > 0, 'should return at least one market');

  let hasVolume = false;
  let hasLiquidity = false;

  for (const item of prices.items) {
    assert.equal(item.venue, 'polymarket');
    assert.ok(item.eventId, 'item should have eventId');
    assert.ok('yesPrice' in item, 'item should have yesPrice');
    assert.ok('noPrice' in item, 'item should have noPrice');
    assert.ok('volumeUsd' in item, 'item should have volumeUsd field');
    assert.ok('liquidityUsd' in item, 'item should have liquidityUsd field');
    assert.ok('midPrice' in item, 'item should have midPrice');

    if (typeof item.yesPrice === 'number') {
      assert.ok(item.yesPrice >= 0 && item.yesPrice <= 1, `yesPrice ${item.yesPrice} should be 0..1`);
    }
    if (typeof item.noPrice === 'number') {
      assert.ok(item.noPrice >= 0 && item.noPrice <= 1, `noPrice ${item.noPrice} should be 0..1`);
    }
    if (item.volumeUsd !== null) hasVolume = true;
    if (item.liquidityUsd !== null) hasLiquidity = true;
  }

  assert.ok(hasVolume, 'at least one market should have volumeUsd from Gamma');
  assert.ok(hasLiquidity, 'at least one market should have liquidityUsd from Gamma');
});

test('LIVE: getTradeHistory handles CLOB endpoint gracefully', { timeout: LIVE_TEST_TIMEOUT }, async () => {
  const market = await getTestMarket();
  const connector = createPolymarketConnector();

  const result = await connector.getTradeHistory({ conditionId: market.conditionId });

  assert.equal(result.venue, 'polymarket');
  assert.equal(result.conditionId, market.conditionId);
  assert.ok(Array.isArray(result.trades), 'trades should be an array');
  assert.ok(typeof result.count === 'number', 'count should be a number');

  if (result.error) {
    assert.ok(typeof result.error === 'string', 'error should be a string if present');
  }
  if (result.count > 0) {
    assert.ok(result.trades.length > 0, 'trades array should be populated when count > 0');
  }
});

// ---------------------------------------------------------------------------
// EDGE CASE TESTS — mocks appropriate for error paths
// ---------------------------------------------------------------------------

test('EDGE: getBook returns structured error when tokenId is missing', async () => {
  const connector = createPolymarketConnector();
  const book = await connector.getBook({});

  assert.ok(book.error);
  assert.match(book.error, /tokenId/i);
  assert.deepEqual(book.bids, []);
  assert.deepEqual(book.asks, []);
  assert.equal(book.spreadBps, null);
  assert.equal(book.midPrice, null);
});

test('EDGE: getBook handles invalid tokenId gracefully', { timeout: LIVE_TEST_TIMEOUT }, async () => {
  const connector = createPolymarketConnector();
  const book = await connector.getBook({ tokenId: 'completely-invalid-token-id-12345' });

  assert.ok(book.bids.length === 0 || book.error, 'invalid token should return empty book or error');
});

test('EDGE: getDepth returns structured error when token IDs missing', async () => {
  const connector = createPolymarketConnector();
  const depth = await connector.getDepth({});

  assert.ok(depth.error);
  assert.equal(depth.depthWithinSlippageUsd, 0);
  assert.equal(depth.yesDepth, null);
  assert.equal(depth.noDepth, null);
});

test('EDGE: getTradeHistory returns structured error when conditionId missing', async () => {
  const connector = createPolymarketConnector();
  const result = await connector.getTradeHistory({});

  assert.ok(result.error);
  assert.match(result.error, /conditionId/i);
  assert.deepEqual(result.trades, []);
  assert.equal(result.count, 0);
});

// ---------------------------------------------------------------------------
// Connector shape and factory compatibility
// ---------------------------------------------------------------------------

test('connector exposes all required venue methods plus extensions', () => {
  const connector = createPolymarketConnector();

  assert.equal(typeof connector.getPrice, 'function');
  assert.equal(typeof connector.getBook, 'function');
  assert.equal(typeof connector.placeTrade, 'function');
  assert.equal(typeof connector.cancelTrade, 'function');
  assert.equal(typeof connector.getPositions, 'function');

  assert.equal(typeof connector.getDepth, 'function');
  assert.equal(typeof connector.getTradeHistory, 'function');
});

test('venue_connector_factory accepts the enriched connector', () => {
  const { createVenueConnectorFactory } = require('../../cli/lib/venue_connector_factory.cjs');
  const factory = createVenueConnectorFactory();

  const connector = factory.createConnector('polymarket');

  assert.equal(typeof connector.getPrice, 'function');
  assert.equal(typeof connector.getBook, 'function');
  assert.equal(typeof connector.getDepth, 'function');
  assert.equal(typeof connector.getTradeHistory, 'function');
});
