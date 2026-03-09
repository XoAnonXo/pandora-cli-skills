const test = require('node:test');
const assert = require('node:assert/strict');

const { fetchPolymarketMarkets } = require('../../cli/lib/polymarket_adapter.cjs');

test('fetchPolymarketMarkets prefers Gamma active markets and maps outcome arrays', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      async json() {
        return [
          {
            conditionId: 'gamma-cond-1',
            question: 'Will Team A win?',
            slug: 'will-team-a-win',
            endDateIso: '2030-01-01T00:00:00Z',
            liquidityNum: '15000',
            volumeNum: '25000',
            outcomes: '["Yes","No"]',
            outcomePrices: '["0.61","0.39"]',
          },
        ];
      },
    };
  };

  try {
    const payload = await fetchPolymarketMarkets({ limit: 10, timeoutMs: 1000 });
    assert.equal(payload.source, 'polymarket:gamma');
    assert.equal(payload.count, 1);
    assert.equal(payload.items[0].marketId, 'gamma-cond-1');
    assert.equal(payload.items[0].url, 'https://polymarket.com/event/will-team-a-win');
    assert.equal(payload.items[0].yesPct, 61);
    assert.equal(payload.items[0].noPct, 39);
    assert.equal(payload.items[0].oddsSource, 'polymarket:gamma-markets');
    assert.equal(calls.length >= 1, true);
    assert.equal(calls[0].includes('gamma-api.polymarket.com/markets'), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchPolymarketMarkets still supports --mock-url payloads', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        markets: [
          {
            question: 'Will tests pass?',
            condition_id: 'mock-cond-1',
            market_slug: 'will-tests-pass',
            end_date_iso: '2030-01-01T00:00:00Z',
            tokens: [
              { outcome: 'Yes', price: '0.52' },
              { outcome: 'No', price: '0.48' },
            ],
          },
        ],
      };
    },
  });

  try {
    const payload = await fetchPolymarketMarkets({
      mockUrl: 'https://example.com/mock-poly',
      limit: 10,
      timeoutMs: 1000,
    });
    assert.equal(payload.source, 'polymarket:mock');
    assert.equal(payload.count, 1);
    assert.equal(payload.items[0].marketId, 'mock-cond-1');
    assert.equal(payload.items[0].yesPct, 52);
  } finally {
    global.fetch = originalFetch;
  }
});
