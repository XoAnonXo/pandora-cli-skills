const test = require('node:test');
const assert = require('node:assert/strict');

const LIVE_TEST_TIMEOUT = 30_000;

// ---------------------------------------------------------------------------
// Integration: Full connector pipeline via venue factory (no mocks)
//
// This test exercises the same code path that `arb scan`, `odds record`,
// and `model diagnose` use to get Polymarket data. It calls real APIs.
// ---------------------------------------------------------------------------

test('INTEGRATION: venue factory -> polymarket connector -> real CLOB pipeline', { timeout: LIVE_TEST_TIMEOUT }, async () => {
  const { createVenueConnectorFactory } = require('../../cli/lib/venue_connector_factory.cjs');
  const factory = createVenueConnectorFactory();
  const connector = factory.createConnector('polymarket');

  // Step 1: getPrice from Gamma — discover real markets with volume/liquidity
  const prices = await connector.getPrice({ limit: 5, disableLiveFeed: true });

  assert.equal(prices.venue, 'polymarket');
  assert.ok(prices.items.length > 0, 'Should discover at least one market');

  const sampleMarket = prices.items[0];
  assert.ok(sampleMarket.eventId, 'Market should have eventId');
  assert.ok('volumeUsd' in sampleMarket, 'Market should have volumeUsd (Gamma enrichment)');
  assert.ok('liquidityUsd' in sampleMarket, 'Market should have liquidityUsd (Gamma enrichment)');

  console.log(`  [getPrice] Found ${prices.items.length} markets, sample: ${sampleMarket.eventId}`);
  console.log(`    volume: $${sampleMarket.volumeUsd}, liquidity: $${sampleMarket.liquidityUsd}`);
});

test('INTEGRATION: getBook -> real L2 bid/ask from CLOB for a discovered market', { timeout: LIVE_TEST_TIMEOUT }, async () => {
  // Discover a balanced market
  const res = await fetch(
    'https://gamma-api.polymarket.com/markets?limit=20&active=true&closed=false&order=volume24hr&ascending=false',
  );
  const data = await res.json();

  let market = null;
  for (const m of data) {
    const tokens = JSON.parse(m.clobTokenIds || m.clob_token_ids || '[]');
    if (tokens.length < 2) continue;
    const outcomePrices = m.outcomePrices ? JSON.parse(m.outcomePrices) : null;
    const yesPrice = outcomePrices ? parseFloat(outcomePrices[0]) : null;
    if (yesPrice !== null && yesPrice > 0.15 && yesPrice < 0.85) {
      market = { yesTokenId: tokens[0], noTokenId: tokens[1], question: m.question, conditionId: m.conditionId };
      break;
    }
  }
  assert.ok(market, 'Should find a balanced market');
  console.log(`  [discovery] Using: "${market.question}"`);

  // Step 2: getBook — real L2 order book
  const { createVenueConnectorFactory } = require('../../cli/lib/venue_connector_factory.cjs');
  const connector = createVenueConnectorFactory().createConnector('polymarket');

  const book = await connector.getBook({ tokenId: market.yesTokenId });

  assert.ok(!book.error, `getBook should not error: ${book.error}`);
  assert.ok(book.bids.length > 0, 'Real book should have bids');
  assert.ok(book.asks.length > 0, 'Real book should have asks');
  assert.ok(book.spreadBps >= 0, `Spread should be non-negative: ${book.spreadBps}`);
  assert.ok(book.midPrice > 0, `midPrice should be positive: ${book.midPrice}`);

  console.log(`  [getBook] ${book.bidLevels} bids, ${book.askLevels} asks`);
  console.log(`    bestBid: ${book.bestBid}, bestAsk: ${book.bestAsk}, spread: ${book.spreadBps} bps`);

  // Step 3: getDepth — executable depth for both sides
  const depth = await connector.getDepth({
    yesTokenId: market.yesTokenId,
    noTokenId: market.noTokenId,
    slippageBps: 200,
    targetUsd: 1000,
  });

  assert.ok(!depth.error, `getDepth should not error: ${depth.error}`);
  assert.ok(depth.depthWithinSlippageUsd >= 0, 'Depth should be non-negative');
  assert.ok(depth.yesDepth, 'yesDepth should exist');
  assert.ok(depth.noDepth, 'noDepth should exist');

  console.log(`  [getDepth] $${depth.depthWithinSlippageUsd} within 200bps slippage`);
  console.log(`    YES depth: $${depth.yesDepth.depthUsd}, NO depth: $${depth.noDepth.depthUsd}`);
  if (depth.depthCoverage !== null) {
    console.log(`    Coverage for $1000 target: ${(depth.depthCoverage * 100).toFixed(1)}%`);
  }

  // Step 4: getTradeHistory — test graceful handling
  const trades = await connector.getTradeHistory({ conditionId: market.conditionId });
  assert.equal(trades.venue, 'polymarket');
  assert.ok(Array.isArray(trades.trades), 'trades should be array');

  if (trades.error) {
    console.log(`  [getTradeHistory] Endpoint returned error (known limitation): ${trades.error.slice(0, 80)}`);
  } else {
    console.log(`  [getTradeHistory] ${trades.count} recent trades`);
  }
});

test('INTEGRATION: normalizeOrderbook export from trade adapter works correctly', { timeout: LIVE_TEST_TIMEOUT }, async () => {
  const { normalizeOrderbook } = require('../../cli/lib/polymarket_trade_adapter.cjs');
  const { ClobClient, Chain } = require('@polymarket/clob-client');

  // Fetch real order book directly and normalize
  const res = await fetch(
    'https://gamma-api.polymarket.com/markets?limit=10&active=true&closed=false&order=volume24hr&ascending=false',
  );
  const data = await res.json();
  let tokenId = null;
  for (const m of data) {
    const tokens = JSON.parse(m.clobTokenIds || m.clob_token_ids || '[]');
    const outcomePrices = m.outcomePrices ? JSON.parse(m.outcomePrices) : null;
    const yesPrice = outcomePrices ? parseFloat(outcomePrices[0]) : null;
    if (tokens.length >= 2 && yesPrice > 0.15 && yesPrice < 0.85) {
      tokenId = tokens[0];
      break;
    }
  }
  assert.ok(tokenId, 'Should find a token for testing');

  const client = new ClobClient('https://clob.polymarket.com', Chain.POLYGON);
  const rawBook = await client.getOrderBook(tokenId);

  assert.ok(rawBook.bids || rawBook.asks, 'Raw book should have bids or asks');

  const normalized = normalizeOrderbook(rawBook);

  assert.ok(Array.isArray(normalized.bids), 'Normalized bids should be array');
  assert.ok(Array.isArray(normalized.asks), 'Normalized asks should be array');
  assert.ok(typeof normalized.midPrice === 'number', 'midPrice should be a number');

  if (normalized.bids.length > 0) {
    assert.ok(typeof normalized.bids[0].price === 'number');
    assert.ok(typeof normalized.bids[0].size === 'number');
    for (let i = 1; i < normalized.bids.length; i++) {
      assert.ok(
        normalized.bids[i].price <= normalized.bids[i - 1].price,
        'Bids should be sorted descending by price',
      );
    }
  }
  if (normalized.asks.length > 0) {
    for (let i = 1; i < normalized.asks.length; i++) {
      assert.ok(
        normalized.asks[i].price >= normalized.asks[i - 1].price,
        'Asks should be sorted ascending by price',
      );
    }
  }

  console.log(`  [normalizeOrderbook] ${normalized.bids.length} bids, ${normalized.asks.length} asks, mid: ${normalized.midPrice}`);
});
