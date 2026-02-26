const { ClobClient, Chain, Side, OrderType } = require('@polymarket/clob-client');

const DEFAULT_POLYMARKET_HOST = 'https://clob.polymarket.com';
const DEFAULT_POLYMARKET_CHAIN = Chain.POLYGON;

function toNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function round(value, decimals = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function toTimestampSeconds(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Date.parse(String(value));
  if (!Number.isNaN(parsed)) {
    return Math.floor(parsed / 1000);
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.floor(numeric) : null;
}

function normalizeTokens(tokens) {
  if (!Array.isArray(tokens) || !tokens.length) {
    return {
      yes: null,
      no: null,
      yesTokenId: null,
      noTokenId: null,
      diagnostics: ['Missing Polymarket token array.'],
    };
  }

  let yes = tokens.find((token) => /^(yes|true)$/i.test(String(token && token.outcome ? token.outcome : '')));
  let no = tokens.find((token) => /^(no|false)$/i.test(String(token && token.outcome ? token.outcome : '')));
  const diagnostics = [];

  if ((!yes || !no) && tokens.length === 2) {
    yes = tokens[0];
    no = tokens[1];
    diagnostics.push('Used binary token ordering fallback for YES/NO mapping.');
  }

  if (!yes || !no) {
    return {
      yes: null,
      no: null,
      yesTokenId: null,
      noTokenId: null,
      diagnostics: diagnostics.concat('Unable to map YES/NO tokens.'),
    };
  }

  const yesPrice = toNumber(yes.price);
  const noPrice = toNumber(no.price);

  let yesPct = null;
  let noPct = null;
  if (yesPrice !== null && noPrice !== null && yesPrice + noPrice > 0) {
    yesPct = (yesPrice / (yesPrice + noPrice)) * 100;
    noPct = (noPrice / (yesPrice + noPrice)) * 100;
  } else {
    diagnostics.push('Token prices are missing or invalid for YES/NO normalization.');
  }

  return {
    yes: yesPct === null ? null : round(yesPct, 6),
    no: noPct === null ? null : round(noPct, 6),
    yesTokenId: String(yes.token_id || yes.tokenId || yes.asset_id || '').trim() || null,
    noTokenId: String(no.token_id || no.tokenId || no.asset_id || '').trim() || null,
    diagnostics,
  };
}

function normalizeMarketRow(row) {
  const tokens = normalizeTokens(row && row.tokens);
  const resolved = Boolean(row && (row.resolved === true || row.closed === true || row.archived === true));
  let active = true;
  if (row && typeof row.active === 'boolean') {
    active = row.active;
  } else if (row && typeof row.closed === 'boolean') {
    active = !row.closed;
  } else {
    active = !resolved;
  }
  return {
    marketId: String(
      (row && (row.condition_id || row.question_id || row.id || row.market_id || row.slug || row.market_slug)) || '',
    ).trim() || null,
    slug: String((row && (row.market_slug || row.slug)) || '').trim() || null,
    question: String((row && (row.question || row.title || row.name || row.description)) || '').trim() || null,
    description: String((row && (row.description || row.rules || row.resolution_source || '')) || '').trim() || null,
    closeTimestamp: toTimestampSeconds(row && (row.end_date_iso || row.game_start_time || row.endDate || row.closeTime)),
    yesPct: tokens.yes,
    noPct: tokens.no,
    yesTokenId: tokens.yesTokenId,
    noTokenId: tokens.noTokenId,
    volume24hUsd: toNumber(row && (row.volume24hr || row.volume_24hr || row.volume24h || row.one_day_volume || 0)) || 0,
    volumeTotalUsd: toNumber(row && (row.volume || row.total_volume || row.totalVolume || 0)) || 0,
    liquidityUsd: toNumber(row && (row.liquidity || row.liquidity_num || row.totalLiquidity || 0)) || 0,
    active,
    resolved,
    url: row && row.market_slug ? `https://polymarket.com/event/${row.market_slug}` : null,
    diagnostics: tokens.diagnostics,
    raw: row,
  };
}

async function fetchMockPayload(mockUrl, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(mockUrl, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Polymarket mock returned HTTP ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function marketMatches(row, options) {
  const idNeedle = options.marketId ? normalizeText(options.marketId) : null;
  const slugNeedle = options.slug ? normalizeText(options.slug) : null;

  if (!idNeedle && !slugNeedle) return true;

  const idCandidates = [row.condition_id, row.question_id, row.id, row.market_id]
    .map((value) => normalizeText(value))
    .filter(Boolean);
  const slugCandidates = [row.market_slug, row.slug].map((value) => normalizeText(value)).filter(Boolean);

  if (idNeedle && idCandidates.includes(idNeedle)) return true;
  if (slugNeedle && slugCandidates.includes(slugNeedle)) return true;
  return false;
}

async function resolvePolymarketMarket(options = {}) {
  const host = options.host || DEFAULT_POLYMARKET_HOST;
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 12_000;
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 500;

  let rows = [];
  let payload = null;

  if (options.mockUrl) {
    payload = await fetchMockPayload(options.mockUrl, timeoutMs);
    if (Array.isArray(payload)) {
      rows = payload;
    } else if (payload && Array.isArray(payload.markets)) {
      rows = payload.markets;
    } else {
      throw new Error('Polymarket mock payload must be an array or { markets: [] }.');
    }
  } else {
    const client = new ClobClient(host, DEFAULT_POLYMARKET_CHAIN);
    let cursor;
    let loops = 0;

    while (rows.length < limit && loops < 12) {
      loops += 1;
      const page = cursor ? await client.getMarkets(cursor) : await client.getMarkets();
      const chunk = Array.isArray(page && page.data) ? page.data : [];
      rows.push(...chunk);

      if (!page || !page.next_cursor || page.next_cursor === cursor) {
        break;
      }
      cursor = page.next_cursor;
    }
  }

  const matchedRow = rows.find((row) => marketMatches(row, options));
  if (!matchedRow) {
    const target = options.marketId || options.slug || 'unknown';
    throw new Error(`Polymarket market not found for selector: ${target}`);
  }

  const normalized = normalizeMarketRow(matchedRow);
  normalized.source = options.mockUrl ? 'polymarket:mock' : 'polymarket:clob';
  normalized.host = host;

  if (payload && payload.orderbooks && typeof payload.orderbooks === 'object') {
    normalized.mockOrderbooks = payload.orderbooks;
  }

  return normalized;
}

function normalizeOrderbook(book) {
  if (!book || typeof book !== 'object') {
    return { bids: [], asks: [], midPrice: null };
  }

  const bids = Array.isArray(book.bids)
    ? book.bids
        .map((entry) => ({ price: toNumber(entry && entry.price), size: toNumber(entry && entry.size) }))
        .filter((entry) => entry.price !== null && entry.size !== null && entry.size > 0)
        .sort((a, b) => b.price - a.price)
    : [];

  const asks = Array.isArray(book.asks)
    ? book.asks
        .map((entry) => ({ price: toNumber(entry && entry.price), size: toNumber(entry && entry.size) }))
        .filter((entry) => entry.price !== null && entry.size !== null && entry.size > 0)
        .sort((a, b) => a.price - b.price)
    : [];

  const bestBid = bids.length ? bids[0].price : null;
  const bestAsk = asks.length ? asks[0].price : null;
  const midPrice = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : bestAsk !== null ? bestAsk : bestBid;

  return {
    bids,
    asks,
    midPrice: midPrice === null ? null : round(midPrice, 8),
  };
}

function calculateExecutableDepthUsd(orderbook, side, slippageBps) {
  const normalized = normalizeOrderbook(orderbook);
  const mid = normalized.midPrice;
  if (mid === null) {
    return {
      depthUsd: 0,
      depthShares: 0,
      worstPrice: null,
      midPrice: null,
      diagnostics: ['Orderbook midpoint unavailable.'],
    };
  }

  const limitPriceFactor = slippageBps / 10_000;
  const entries = side === 'buy' ? normalized.asks : normalized.bids;
  const priceLimit = side === 'buy' ? mid * (1 + limitPriceFactor) : mid * (1 - limitPriceFactor);

  let depthUsd = 0;
  let depthShares = 0;
  let worstPrice = null;

  for (const entry of entries) {
    if (side === 'buy' && entry.price > priceLimit) break;
    if (side === 'sell' && entry.price < priceLimit) break;
    depthShares += entry.size;
    depthUsd += entry.price * entry.size;
    worstPrice = entry.price;
  }

  return {
    depthUsd: round(depthUsd, 6) || 0,
    depthShares: round(depthShares, 6) || 0,
    worstPrice: worstPrice === null ? null : round(worstPrice, 8),
    midPrice: round(mid, 8),
    diagnostics: [],
  };
}

async function getOrderbook(clientOrOptions, tokenId, fallbackOrderbooks = null) {
  if (!tokenId) return null;

  if (fallbackOrderbooks && typeof fallbackOrderbooks === 'object' && fallbackOrderbooks[tokenId]) {
    return fallbackOrderbooks[tokenId];
  }

  return clientOrOptions.getOrderBook(tokenId);
}

async function fetchDepthForMarket(market, options = {}) {
  const slippageBps = Number.isFinite(Number(options.slippageBps)) ? Number(options.slippageBps) : 100;

  let client = null;
  if (!options.mockUrl) {
    client = new ClobClient(options.host || DEFAULT_POLYMARKET_HOST, DEFAULT_POLYMARKET_CHAIN);
  }

  const yesBook = await getOrderbook(client, market.yesTokenId, market.mockOrderbooks);
  const noBook = await getOrderbook(client, market.noTokenId, market.mockOrderbooks);

  const yesDepth = yesBook ? calculateExecutableDepthUsd(yesBook, 'buy', slippageBps) : null;
  const noDepth = noBook ? calculateExecutableDepthUsd(noBook, 'buy', slippageBps) : null;

  const candidates = [yesDepth && yesDepth.depthUsd, noDepth && noDepth.depthUsd].filter((value) => Number.isFinite(value));
  const depthWithinSlippageUsd = candidates.length ? Math.min(...candidates) : 0;

  const diagnostics = [];
  if (!yesDepth) diagnostics.push('YES token orderbook unavailable.');
  if (!noDepth) diagnostics.push('NO token orderbook unavailable.');

  return {
    slippageBps,
    depthWithinSlippageUsd: round(depthWithinSlippageUsd, 6) || 0,
    yesDepth,
    noDepth,
    diagnostics,
  };
}

function readTradingCredsFromEnv(env = process.env) {
  const creds = {
    privateKey: env.POLYMARKET_PRIVATE_KEY || env.PRIVATE_KEY || null,
    funder: env.POLYMARKET_FUNDER || null,
    apiKey: env.POLYMARKET_API_KEY || null,
    apiSecret: env.POLYMARKET_API_SECRET || null,
    apiPassphrase: env.POLYMARKET_API_PASSPHRASE || null,
    host: env.POLYMARKET_HOST || DEFAULT_POLYMARKET_HOST,
  };
  return creds;
}

async function buildTradingClient(options = {}) {
  const host = options.host || DEFAULT_POLYMARKET_HOST;
  const chain = options.chain || DEFAULT_POLYMARKET_CHAIN;

  const privateKey = options.privateKey;
  if (!privateKey) {
    throw new Error('Missing Polymarket private key for live hedge execution.');
  }

  let Wallet;
  try {
    ({ Wallet } = require('@ethersproject/wallet'));
  } catch (err) {
    throw new Error(`Unable to load @ethersproject/wallet dependency: ${err && err.message ? err.message : String(err)}`);
  }

  const signer = new Wallet(privateKey);
  let creds = null;

  if (options.apiKey && options.apiSecret && options.apiPassphrase) {
    creds = {
      key: options.apiKey,
      secret: options.apiSecret,
      passphrase: options.apiPassphrase,
    };
  } else {
    const bootstrap = new ClobClient(host, chain, signer);
    creds = await bootstrap.createOrDeriveApiKey();
  }

  return new ClobClient(host, chain, signer, creds, 0, options.funder || undefined, undefined, undefined, undefined, undefined, true);
}

function resolveOrderSide(side) {
  const normalized = normalizeText(side);
  if (normalized === 'buy') return Side.BUY;
  if (normalized === 'sell') return Side.SELL;
  throw new Error(`Unsupported order side: ${side}`);
}

async function placeHedgeOrder(options = {}) {
  if (options.mockUrl) {
    return {
      mode: 'mock',
      ok: true,
      orderType: 'FAK',
      tokenId: options.tokenId,
      side: String(options.side || '').toUpperCase(),
      amountUsd: round(toNumber(options.amountUsd) || 0, 6),
      response: {
        status: 'simulated',
      },
    };
  }

  const client = await buildTradingClient(options);
  const tokenId = String(options.tokenId || '').trim();
  if (!tokenId) {
    throw new Error('Missing tokenId for Polymarket hedge order.');
  }

  const amountUsd = toNumber(options.amountUsd);
  if (amountUsd === null || amountUsd <= 0) {
    throw new Error('amountUsd must be a positive number for hedge execution.');
  }

  const side = resolveOrderSide(options.side || 'buy');
  const tickSize = options.tickSize || (await client.getTickSize(tokenId));
  const negRisk = typeof options.negRisk === 'boolean' ? options.negRisk : await client.getNegRisk(tokenId);

  const response = await client.createAndPostMarketOrder(
    {
      tokenID: tokenId,
      amount: amountUsd,
      side,
      orderType: OrderType.FAK,
    },
    {
      tickSize,
      negRisk,
    },
    OrderType.FAK,
    false,
  );

  return {
    mode: 'live',
    ok: true,
    orderType: 'FAK',
    tokenId,
    side,
    amountUsd: round(amountUsd, 6),
    response,
  };
}

module.exports = {
  DEFAULT_POLYMARKET_HOST,
  readTradingCredsFromEnv,
  resolvePolymarketMarket,
  fetchDepthForMarket,
  calculateExecutableDepthUsd,
  placeHedgeOrder,
};
