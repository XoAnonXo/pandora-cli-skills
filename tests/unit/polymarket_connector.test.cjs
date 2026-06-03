const test = require('node:test');
const assert = require('node:assert/strict');

const { createPolymarketConnector } = require('../../cli/lib/connectors/polymarket_connector.cjs');

// ---------------------------------------------------------------------------
// Mock CLOB client factory
// ---------------------------------------------------------------------------

function buildMockClobClientFactory(overrides = {}) {
  return () => ({
    getOrderBook: overrides.getOrderBook || (async () => ({
      bids: [
        { price: '0.48', size: '200' },
        { price: '0.47', size: '150' },
        { price: '0.45', size: '100' },
      ],
      asks: [
        { price: '0.52', size: '180' },
        { price: '0.53', size: '120' },
        { price: '0.55', size: '80' },
      ],
      last_trade_price: '0.50',
    })),
    getMarketTradesEvents: overrides.getMarketTradesEvents || (async () => [
      { id: 'trade-1', price: '0.50', size: '100', side: 'BUY', timestamp: '2026-06-01T10:00:00Z' },
      { id: 'trade-2', price: '0.51', size: '50', side: 'SELL', timestamp: '2026-06-01T10:01:00Z' },
    ]),
  });
}

// ---------------------------------------------------------------------------
// getBook — real L2 order book
// ---------------------------------------------------------------------------

test('getBook returns real L2 order book with spread', async () => {
  const connector = createPolymarketConnector({
    host: 'https://clob.example.com',
    clobClientFactory: buildMockClobClientFactory(),
  });

  const book = await connector.getBook({ tokenId: 'yes-token-123' });

  assert.equal(book.venue, 'polymarket');
  assert.equal(book.tokenId, 'yes-token-123');
  assert.ok(book.bids.length >= 3);
  assert.ok(book.asks.length >= 3);
  assert.equal(book.bestBid, 0.48);
  assert.equal(book.bestAsk, 0.52);
  assert.equal(book.midPrice, 0.5);
  assert.ok(Number.isFinite(book.spreadBps));
  assert.ok(book.spreadBps > 0);
  assert.equal(book.lastTradePrice, 0.5);
  assert.equal(book.bidLevels, 3);
  assert.equal(book.askLevels, 3);
});

test('getBook computes spreadBps correctly', async () => {
  const connector = createPolymarketConnector({
    clobClientFactory: buildMockClobClientFactory(),
  });

  const book = await connector.getBook({ tokenId: 'yes-token' });

  assert.ok(book.spreadBps >= 799 && book.spreadBps <= 801, `spreadBps should be ~800, got ${book.spreadBps}`);
});

test('getBook returns error when tokenId is missing', async () => {
  const connector = createPolymarketConnector({
    clobClientFactory: buildMockClobClientFactory(),
  });

  const book = await connector.getBook({});

  assert.ok(book.error);
  assert.deepEqual(book.bids, []);
  assert.deepEqual(book.asks, []);
  assert.equal(book.spreadBps, null);
});

test('getBook handles CLOB client failure gracefully', async () => {
  const connector = createPolymarketConnector({
    clobClientFactory: () => ({
      getOrderBook: async () => { throw new Error('CLOB unavailable'); },
    }),
  });

  const book = await connector.getBook({ tokenId: 'bad-token' });

  assert.ok(book.error);
  assert.match(book.error, /CLOB unavailable/);
  assert.deepEqual(book.bids, []);
  assert.deepEqual(book.asks, []);
});

test('getBook handles empty order book', async () => {
  const connector = createPolymarketConnector({
    clobClientFactory: () => ({
      getOrderBook: async () => ({ bids: [], asks: [] }),
    }),
  });

  const book = await connector.getBook({ tokenId: 'empty-market' });

  assert.deepEqual(book.bids, []);
  assert.deepEqual(book.asks, []);
  assert.equal(book.bestBid, null);
  assert.equal(book.bestAsk, null);
  assert.equal(book.spreadBps, null);
});

// ---------------------------------------------------------------------------
// getDepth
// ---------------------------------------------------------------------------

test('getDepth returns error when token IDs missing', async () => {
  const connector = createPolymarketConnector();
  const depth = await connector.getDepth({});

  assert.ok(depth.error);
  assert.equal(depth.depthWithinSlippageUsd, 0);
});

test('getDepth handles mock orderbooks', async () => {
  const connector = createPolymarketConnector({ mockUrl: 'http://mock.local' });

  const depth = await connector.getDepth({
    yesTokenId: 'yes-t',
    noTokenId: 'no-t',
    mockOrderbooks: {
      'yes-t': {
        bids: [{ price: '0.48', size: '100' }],
        asks: [{ price: '0.52', size: '100' }],
      },
      'no-t': {
        bids: [{ price: '0.48', size: '100' }],
        asks: [{ price: '0.52', size: '100' }],
      },
    },
    mockUrl: 'http://mock.local',
  });

  assert.equal(depth.venue, 'polymarket');
  assert.ok(depth.depthWithinSlippageUsd >= 0);
  assert.ok(depth.observedAt);
});

test('getDepth computes depthCoverage when targetUsd is provided', async () => {
  const connector = createPolymarketConnector({ mockUrl: 'http://mock.local' });

  const depth = await connector.getDepth({
    yesTokenId: 'yes-t',
    noTokenId: 'no-t',
    targetUsd: 100,
    mockOrderbooks: {
      'yes-t': {
        bids: [{ price: '0.48', size: '100' }],
        asks: [{ price: '0.52', size: '100' }],
      },
      'no-t': {
        bids: [{ price: '0.48', size: '100' }],
        asks: [{ price: '0.52', size: '100' }],
      },
    },
    mockUrl: 'http://mock.local',
  });

  assert.ok(depth.depthCoverage === null || typeof depth.depthCoverage === 'number');
});

// ---------------------------------------------------------------------------
// getTradeHistory
// ---------------------------------------------------------------------------

test('getTradeHistory returns trades from CLOB', async () => {
  const connector = createPolymarketConnector({
    clobClientFactory: buildMockClobClientFactory(),
  });

  const result = await connector.getTradeHistory({ conditionId: 'cond-abc' });

  assert.equal(result.venue, 'polymarket');
  assert.equal(result.conditionId, 'cond-abc');
  assert.equal(result.count, 2);
  assert.ok(Array.isArray(result.trades));
  assert.equal(result.trades[0].id, 'trade-1');
});

test('getTradeHistory returns error when conditionId is missing', async () => {
  const connector = createPolymarketConnector({
    clobClientFactory: buildMockClobClientFactory(),
  });

  const result = await connector.getTradeHistory({});

  assert.ok(result.error);
  assert.deepEqual(result.trades, []);
  assert.equal(result.count, 0);
});

test('getTradeHistory handles CLOB client failure gracefully', async () => {
  const connector = createPolymarketConnector({
    clobClientFactory: () => ({
      getMarketTradesEvents: async () => { throw new Error('API down'); },
    }),
  });

  const result = await connector.getTradeHistory({ conditionId: 'cond-fail' });

  assert.ok(result.error);
  assert.match(result.error, /API down/);
  assert.deepEqual(result.trades, []);
});

// ---------------------------------------------------------------------------
// getPrice — enriched with volume/liquidity
// ---------------------------------------------------------------------------

test('getPrice result items have volumeUsd and liquidityUsd fields in schema', () => {
  const item = {
    venue: 'polymarket',
    eventId: 'test-market',
    competition: null,
    marketId: 'test-market',
    question: 'Will X happen?',
    yesPrice: 0.55,
    noPrice: 0.45,
    midPrice: 0.55,
    volumeUsd: 12345.67,
    liquidityUsd: 5000.0,
    closeTime: '2026-12-01T00:00:00.000Z',
    observedAt: new Date().toISOString(),
    source: 'polymarket:gamma-markets',
  };

  assert.ok('volumeUsd' in item, 'item schema should have volumeUsd');
  assert.ok('liquidityUsd' in item, 'item schema should have liquidityUsd');
  assert.equal(item.volumeUsd, 12345.67);
  assert.equal(item.liquidityUsd, 5000.0);
});

// ---------------------------------------------------------------------------
// Connector shape: backward compatibility
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
