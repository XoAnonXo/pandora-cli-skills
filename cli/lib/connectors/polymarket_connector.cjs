const { fetchPolymarketMarkets, DEFAULT_POLYMARKET_HOST } = require('../polymarket_adapter.cjs');
const { fetchPolymarketPositionSummary } = require('../polymarket_trade_adapter.cjs');

function toNumberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toIso(value) {
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) return new Date().toISOString();
  return new Date(parsed).toISOString();
}

/**
 * Create Polymarket venue connector.
 * @param {object} [config]
 * @returns {{
 *   getPrice: (input?: object) => Promise<object>,
 *   getBook: (input?: object) => Promise<object>,
 *   placeTrade: (input?: object) => Promise<object>,
 *   cancelTrade: (input?: object) => Promise<object>,
 *   getPositions: (input?: object) => Promise<object>
 * }}
 */
function createPolymarketConnector(config = {}) {
  const defaultHost = config.host || process.env.POLYMARKET_HOST || DEFAULT_POLYMARKET_HOST;
  const defaultMockUrl = config.mockUrl || process.env.POLYMARKET_MOCK_URL || null;
  const defaultTimeoutMs = Number.isFinite(Number(config.timeoutMs)) ? Number(config.timeoutMs) : 12_000;

  async function getPrice(input = {}) {
    const host = input.host || defaultHost;
    const mockUrl = input.mockUrl || defaultMockUrl || null;
    const limit = Number.isInteger(input.limit) && input.limit > 0 ? input.limit : 100;
    const timeoutMs = Number.isFinite(Number(input.timeoutMs)) ? Number(input.timeoutMs) : defaultTimeoutMs;
    const eventIdFilter = input.eventId ? String(input.eventId).trim().toLowerCase() : null;

    const payload = await fetchPolymarketMarkets({
      host,
      mockUrl,
      limit,
      timeoutMs,
    });

    const items = [];
    for (const item of Array.isArray(payload.items) ? payload.items : []) {
      const eventId = String(item.marketId || '').trim().toLowerCase();
      if (!eventId) continue;
      if (eventIdFilter && eventId !== eventIdFilter) continue;
      const yesProbabilityPct = toNumberOrNull(item.yesPct);
      const noProbabilityPct = toNumberOrNull(item.noPct);
      const yesPrice = yesProbabilityPct === null ? null : yesProbabilityPct / 100;
      const noPrice = noProbabilityPct === null ? null : noProbabilityPct / 100;
      items.push({
        venue: 'polymarket',
        eventId,
        competition: input.competition || null,
        marketId: item.marketId || null,
        question: item.question || null,
        yesPrice,
        noPrice,
        midPrice:
          yesPrice !== null && noPrice !== null
            ? (yesPrice + (1 - noPrice)) / 2
            : yesPrice !== null
              ? yesPrice
              : noPrice !== null
                ? 1 - noPrice
                : null,
        closeTime: item.closeTimestamp ? new Date(Number(item.closeTimestamp) * 1000).toISOString() : null,
        observedAt: toIso(new Date().toISOString()),
        source: payload.source || null,
      });
    }

    return {
      venue: 'polymarket',
      host,
      source: payload.source || null,
      observedAt: new Date().toISOString(),
      count: items.length,
      items,
    };
  }

  async function getBook(input = {}) {
    const prices = await getPrice(input);
    return {
      venue: 'polymarket',
      observedAt: prices.observedAt,
      count: prices.count,
      books: prices.items.map((item) => ({
        eventId: item.eventId,
        yesPrice: item.yesPrice,
        noPrice: item.noPrice,
      })),
    };
  }

  async function placeTrade(input = {}) {
    return {
      venue: 'polymarket',
      execute: false,
      status: 'not_implemented',
      message: 'placeTrade is not implemented for polymarket connector in this module.',
      input,
    };
  }

  async function cancelTrade(input = {}) {
    return {
      venue: 'polymarket',
      status: 'not_implemented',
      message: 'cancelTrade is not implemented for polymarket connector in this module.',
      input,
    };
  }

  async function getPositions(input = {}) {
    const summary = await fetchPolymarketPositionSummary({
      market: {
        marketId: input.eventId || input.marketId || null,
      },
      host: input.host || defaultHost,
      mockUrl: input.mockUrl || defaultMockUrl || null,
      timeoutMs: Number.isFinite(Number(input.timeoutMs)) ? Number(input.timeoutMs) : defaultTimeoutMs,
    }).catch(() => ({
      yesBalance: null,
      noBalance: null,
      openOrdersCount: null,
      estimatedValueUsd: null,
      positionDeltaApprox: null,
      diagnostics: ['Position fetch unavailable.'],
    }));

    return {
      venue: 'polymarket',
      observedAt: new Date().toISOString(),
      positions: [summary],
    };
  }

  return {
    getPrice,
    getBook,
    placeTrade,
    cancelTrade,
    getPositions,
  };
}

module.exports = {
  createPolymarketConnector,
};
