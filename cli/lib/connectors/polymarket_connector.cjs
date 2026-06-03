const { fetchPolymarketMarkets, DEFAULT_POLYMARKET_HOST } = require('../polymarket_adapter.cjs');
const {
  fetchPolymarketPositionSummary,
  fetchDepthForMarket,
  normalizeOrderbook,
} = require('../polymarket_trade_adapter.cjs');
const { ClobClient, Chain } = require('@polymarket/clob-client');
const { round } = require('../shared/utils.cjs');

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
 *   getDepth: (input?: object) => Promise<object>,
 *   getTradeHistory: (input?: object) => Promise<object>,
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
        volumeUsd: toNumberOrNull(item.volumeUsd),
        liquidityUsd: toNumberOrNull(item.liquidityUsd),
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

  /**
   * Fetch real L2 order book from Polymarket CLOB for a specific token.
   *
   * Unlike the legacy getBook (which returned mid-prices), this fetches
   * the actual bid/ask levels from the CLOB order book.
   *
   * Input requires `tokenId` (YES or NO token ID).
   * Optionally pass `host` to override the CLOB host.
   *
   * @param {object} input
   * @returns {Promise<object>} Book with bids, asks, spread, midPrice
   */
  async function getBook(input = {}) {
    const tokenId = input.tokenId || null;
    if (!tokenId) {
      return {
        venue: 'polymarket',
        observedAt: new Date().toISOString(),
        error: 'tokenId is required for getBook',
        bids: [],
        asks: [],
        spreadBps: null,
        midPrice: null,
      };
    }

    const host = input.host || defaultHost;
    const clobClientFactory = config.clobClientFactory || null;

    try {
      const client = typeof clobClientFactory === 'function'
        ? clobClientFactory(host, Chain.POLYGON)
        : new ClobClient(host, Chain.POLYGON);

      const rawBook = await client.getOrderBook(tokenId);
      const normalized = normalizeOrderbook(rawBook);
      const bestBid = normalized.bids.length ? normalized.bids[0].price : null;
      const bestAsk = normalized.asks.length ? normalized.asks[0].price : null;
      const mid = normalized.midPrice;
      const spreadBps =
        bestBid !== null && bestAsk !== null && mid > 0
          ? round(((bestAsk - bestBid) / mid) * 10_000, 2)
          : null;

      return {
        venue: 'polymarket',
        host,
        tokenId,
        observedAt: new Date().toISOString(),
        bids: normalized.bids,
        asks: normalized.asks,
        bestBid,
        bestAsk,
        midPrice: mid,
        spreadBps,
        bidLevels: normalized.bids.length,
        askLevels: normalized.asks.length,
        lastTradePrice: toNumberOrNull(rawBook && rawBook.last_trade_price),
      };
    } catch (err) {
      return {
        venue: 'polymarket',
        host,
        tokenId,
        observedAt: new Date().toISOString(),
        error: err && err.message ? String(err.message) : String(err),
        bids: [],
        asks: [],
        spreadBps: null,
        midPrice: null,
      };
    }
  }

  /**
   * Fetch executable depth for a market (both YES and NO sides).
   *
   * Wraps `fetchDepthForMarket` which calls ClobClient.getOrderBook
   * and calculates slippage-capped depth in USD.
   *
   * Input requires `yesTokenId` and `noTokenId`.
   * Optionally: `slippageBps` (default 100), `host`, `timeoutMs`.
   *
   * @param {object} input
   * @returns {Promise<object>}
   */
  async function getDepth(input = {}) {
    const yesTokenId = input.yesTokenId || null;
    const noTokenId = input.noTokenId || null;

    if (!yesTokenId || !noTokenId) {
      return {
        venue: 'polymarket',
        observedAt: new Date().toISOString(),
        error: 'yesTokenId and noTokenId are required for getDepth',
        depthWithinSlippageUsd: 0,
        yesDepth: null,
        noDepth: null,
      };
    }

    const host = input.host || defaultHost;
    const slippageBps = Number.isFinite(Number(input.slippageBps)) ? Number(input.slippageBps) : 100;
    const timeoutMs = Number.isFinite(Number(input.timeoutMs)) ? Number(input.timeoutMs) : defaultTimeoutMs;

    try {
      const result = await fetchDepthForMarket(
        {
          marketId: input.marketId || null,
          slug: input.slug || null,
          yesTokenId,
          noTokenId,
          mockOrderbooks: input.mockOrderbooks || null,
        },
        {
          host,
          slippageBps,
          timeoutMs,
          mockUrl: input.mockUrl || defaultMockUrl || null,
          persistCache: input.persistCache !== false,
        },
      );

      const yesDepthUsd = result.yesDepth ? result.yesDepth.depthUsd : 0;
      const noDepthUsd = result.noDepth ? result.noDepth.depthUsd : 0;
      const targetUsd = Number.isFinite(Number(input.targetUsd)) ? Number(input.targetUsd) : null;
      const depthCoverage = targetUsd && targetUsd > 0
        ? round(Math.min(1, result.depthWithinSlippageUsd / targetUsd), 4)
        : null;

      return {
        venue: 'polymarket',
        host,
        observedAt: new Date().toISOString(),
        slippageBps,
        depthWithinSlippageUsd: result.depthWithinSlippageUsd,
        minDepthWithinSlippageUsd: result.minDepthWithinSlippageUsd,
        bestDepthWithinSlippageUsd: result.bestDepthWithinSlippageUsd,
        depthCoverage,
        yesDepth: result.yesDepth ? {
          depthUsd: result.yesDepth.depthUsd,
          depthShares: result.yesDepth.depthShares,
          midPrice: result.yesDepth.midPrice,
          worstPrice: result.yesDepth.worstPrice,
          referencePrice: result.yesDepth.referencePrice,
        } : null,
        noDepth: result.noDepth ? {
          depthUsd: result.noDepth.depthUsd,
          depthShares: result.noDepth.depthShares,
          midPrice: result.noDepth.midPrice,
          worstPrice: result.noDepth.worstPrice,
          referencePrice: result.noDepth.referencePrice,
        } : null,
        depthSourceType: result.depthSourceType,
        diagnostics: result.diagnostics,
      };
    } catch (err) {
      return {
        venue: 'polymarket',
        host,
        observedAt: new Date().toISOString(),
        error: err && err.message ? String(err.message) : String(err),
        depthWithinSlippageUsd: 0,
        yesDepth: null,
        noDepth: null,
      };
    }
  }

  /**
   * Fetch recent trade history for a CLOB market condition.
   *
   * Uses ClobClient.getMarketTradesEvents to get recent fills.
   *
   * @param {object} input - Requires `conditionId`. Optional: `host`, `limit`.
   * @returns {Promise<object>}
   */
  async function getTradeHistory(input = {}) {
    const conditionId = input.conditionId || null;
    if (!conditionId) {
      return {
        venue: 'polymarket',
        observedAt: new Date().toISOString(),
        error: 'conditionId is required for getTradeHistory',
        trades: [],
        count: 0,
      };
    }

    const host = input.host || defaultHost;
    const clobClientFactory = config.clobClientFactory || null;

    try {
      const client = typeof clobClientFactory === 'function'
        ? clobClientFactory(host, Chain.POLYGON)
        : new ClobClient(host, Chain.POLYGON);

      const response = await client.getMarketTradesEvents(conditionId);
      const trades = Array.isArray(response) ? response : [];

      return {
        venue: 'polymarket',
        host,
        conditionId,
        observedAt: new Date().toISOString(),
        trades,
        count: trades.length,
      };
    } catch (err) {
      return {
        venue: 'polymarket',
        host,
        conditionId,
        observedAt: new Date().toISOString(),
        error: err && err.message ? String(err.message) : String(err),
        trades: [],
        count: 0,
      };
    }
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
    getDepth,
    getTradeHistory,
    placeTrade,
    cancelTrade,
    getPositions,
  };
}

module.exports = {
  createPolymarketConnector,
};
