const { createIndexerClient, DEFAULT_INDEXER_TIMEOUT_MS } = require('../indexer_client.cjs');
const { DEFAULT_INDEXER_URL } = require('../shared/constants.cjs');

function toNumberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeProbabilityFromYesChance(rawYesChance) {
  const raw = toNumberOrNull(rawYesChance);
  if (raw === null) return null;
  if (raw >= 0 && raw <= 1) return raw;
  if (raw > 1 && raw <= 100) return raw / 100;
  if (raw > 100 && raw <= 1_000_000_000) return raw / 1_000_000_000;
  return null;
}

function deriveYesNoPrice(row) {
  const byChance = normalizeProbabilityFromYesChance(row && row.yesChance);
  if (byChance !== null) {
    return {
      yesPrice: byChance,
      noPrice: 1 - byChance,
      source: 'yesChance',
    };
  }

  const reserveYes = toNumberOrNull(row && row.reserveYes);
  const reserveNo = toNumberOrNull(row && row.reserveNo);
  if (reserveYes === null || reserveNo === null) {
    return {
      yesPrice: null,
      noPrice: null,
      source: 'unavailable',
    };
  }
  const total = reserveYes + reserveNo;
  if (!Number.isFinite(total) || total <= 0) {
    return {
      yesPrice: null,
      noPrice: null,
      source: 'invalid_reserves',
    };
  }

  const yesPrice = reserveNo / total;
  return {
    yesPrice,
    noPrice: 1 - yesPrice,
    source: 'reserves',
  };
}

/**
 * Create Pandora AMM venue connector.
 * @param {object} [config]
 * @returns {{
 *   getPrice: (input?: object) => Promise<object>,
 *   getBook: (input?: object) => Promise<object>,
 *   placeTrade: (input?: object) => Promise<object>,
 *   cancelTrade: (input?: object) => Promise<object>,
 *   getPositions: (input?: object) => Promise<object>
 * }}
 */
function createPandoraAmmConnector(config = {}) {
  const defaultIndexerUrl = config.indexerUrl || process.env.INDEXER_URL || DEFAULT_INDEXER_URL;
  const defaultTimeoutMs = Number.isFinite(Number(config.timeoutMs))
    ? Number(config.timeoutMs)
    : DEFAULT_INDEXER_TIMEOUT_MS;

  async function getPrice(input = {}) {
    const indexerUrl = input.indexerUrl || defaultIndexerUrl;
    const timeoutMs = Number.isFinite(Number(input.timeoutMs)) ? Number(input.timeoutMs) : defaultTimeoutMs;
    const limit = Number.isInteger(input.limit) && input.limit > 0 ? input.limit : 100;
    const eventIdFilter = input.eventId ? String(input.eventId).trim().toLowerCase() : null;
    const chainId =
      Number.isInteger(input.chainId) && input.chainId > 0
        ? input.chainId
        : Number.isInteger(config.chainId) && config.chainId > 0
          ? config.chainId
          : null;

    const client = createIndexerClient(indexerUrl, timeoutMs);
    const page = await client.list({
      queryName: 'marketss',
      filterType: 'marketsFilter',
      fields: [
        'id',
        'chainId',
        'marketType',
        'pollAddress',
        'yesChance',
        'reserveYes',
        'reserveNo',
        'marketCloseTimestamp',
        'createdAt',
      ],
      variables: {
        where: chainId !== null ? { chainId } : {},
        orderBy: 'createdAt',
        orderDirection: 'desc',
        before: null,
        after: null,
        limit,
      },
    });

    const items = [];
    for (const row of Array.isArray(page.items) ? page.items : []) {
      const marketId = String(row.id || '').trim().toLowerCase();
      const pollAddress = String(row.pollAddress || '').trim().toLowerCase();
      const eventId = pollAddress || marketId;
      if (!eventId) continue;
      if (eventIdFilter && eventId !== eventIdFilter && marketId !== eventIdFilter) continue;
      const odds = deriveYesNoPrice(row);
      items.push({
        venue: 'pandora_amm',
        eventId,
        competition: input.competition || null,
        marketId: row.id || null,
        pollAddress: row.pollAddress || null,
        chainId: row.chainId || null,
        yesPrice: odds.yesPrice,
        noPrice: odds.noPrice,
        midPrice:
          odds.yesPrice !== null && odds.noPrice !== null
            ? (odds.yesPrice + (1 - odds.noPrice)) / 2
            : odds.yesPrice !== null
              ? odds.yesPrice
              : odds.noPrice !== null
                ? 1 - odds.noPrice
                : null,
        closeTime: row.marketCloseTimestamp ? new Date(Number(row.marketCloseTimestamp) * 1000).toISOString() : null,
        observedAt: new Date().toISOString(),
        source: odds.source,
      });
    }

    return {
      venue: 'pandora_amm',
      indexerUrl,
      observedAt: new Date().toISOString(),
      count: items.length,
      items,
    };
  }

  async function getBook(input = {}) {
    const prices = await getPrice(input);
    return {
      venue: 'pandora_amm',
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
      venue: 'pandora_amm',
      execute: false,
      status: 'not_implemented',
      message: 'placeTrade is not implemented for pandora_amm connector in this module.',
      input,
    };
  }

  async function cancelTrade(input = {}) {
    return {
      venue: 'pandora_amm',
      status: 'not_implemented',
      message: 'cancelTrade is not implemented for pandora_amm connector in this module.',
      input,
    };
  }

  async function getPositions() {
    return {
      venue: 'pandora_amm',
      observedAt: new Date().toISOString(),
      positions: [],
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
  createPandoraAmmConnector,
};
