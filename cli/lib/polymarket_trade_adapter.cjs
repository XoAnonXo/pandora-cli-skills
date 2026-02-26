const fs = require('fs');
const os = require('os');
const path = require('path');
const { ClobClient, Chain, Side, OrderType } = require('@polymarket/clob-client');

const DEFAULT_POLYMARKET_HOST = 'https://clob.polymarket.com';
const DEFAULT_POLYMARKET_CHAIN = Chain.POLYGON;
const POLYMARKET_CACHE_SCHEMA_VERSION = '1.0.0';

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

function toStringOrNull(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
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

function normalizeHostList(hostInput) {
  const rawValues = Array.isArray(hostInput) ? hostInput : String(hostInput || '').split(',');
  const hosts = rawValues
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  if (!hosts.length) {
    return [DEFAULT_POLYMARKET_HOST];
  }

  return Array.from(new Set(hosts));
}

function buildSelectorKey(options = {}) {
  const raw = String(options.marketId || options.slug || options.cacheKey || 'markets').toLowerCase().trim();
  const sanitized = raw.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return sanitized.slice(0, 128) || 'markets';
}

function defaultCacheFile(options = {}) {
  const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir() || '.';
  const key = buildSelectorKey(options);
  return path.join(homeDir, '.pandora', 'polymarket', `${key}.json`);
}

function formatNetworkError(err) {
  const message = err && err.message ? String(err.message) : String(err);
  if (/connection reset by peer|ECONNRESET|socket hang up|tls|handshake/i.test(message)) {
    return `${message} (possible TLS/Cloudflare edge reset).`;
  }
  return message;
}

function readCacheFile(cacheFile) {
  try {
    if (!cacheFile || !fs.existsSync(cacheFile)) return null;
    const raw = fs.readFileSync(cacheFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCacheFile(cacheFile, payload) {
  if (!cacheFile) return;

  const dir = path.dirname(cacheFile);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tmpPath, cacheFile);
}

function buildCachePayload(options, host, marketRow, orderbooks = null, sourceType = 'polymarket:clob') {
  return {
    schemaVersion: POLYMARKET_CACHE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    host,
    sourceType,
    selector: {
      marketId: options.marketId || null,
      slug: options.slug || null,
    },
    marketRow,
    orderbooks: orderbooks && typeof orderbooks === 'object' ? orderbooks : null,
  };
}

function loadCachedMarket(options, diagnostics = []) {
  const cacheFile = options.cacheFile || defaultCacheFile(options);
  const cached = readCacheFile(cacheFile);
  if (!cached || !cached.marketRow) {
    return null;
  }

  const normalized = normalizeMarketRow(cached.marketRow);
  normalized.source = 'polymarket:cache';
  normalized.host = cached.host || null;
  normalized.cacheFile = cacheFile;
  normalized.cachedAt = cached.savedAt || null;

  if (cached.orderbooks && typeof cached.orderbooks === 'object') {
    normalized.mockOrderbooks = cached.orderbooks;
  }

  let message = 'Using cached Polymarket market snapshot.';
  if (cached.savedAt) {
    const ageMs = Date.now() - Date.parse(cached.savedAt);
    if (Number.isFinite(ageMs)) {
      message = `Using cached Polymarket market snapshot (${Math.max(0, Math.floor(ageMs / 1000))}s old).`;
    }
  }
  diagnostics.push(message);
  normalized.diagnostics.push(message);

  return normalized;
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

function collectRuleSections(row) {
  const sections = [];
  const seen = new Set();

  const pushSection = (value, label = null) => {
    const text = toStringOrNull(value);
    if (!text) return;
    const normalized = normalizeText(text);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    sections.push(label ? `${label}: ${text}` : text);
  };

  pushSection(row && row.rules);
  pushSection(row && row.description);
  pushSection(row && row.resolution_source, 'Resolution Source');
  pushSection(row && row.resolutionSource, 'Resolution Source');
  pushSection(row && row.resolution_criteria, 'Resolution Criteria');
  pushSection(row && row.resolutionCriteria, 'Resolution Criteria');

  if (Array.isArray(row && row.events)) {
    for (const event of row.events) {
      pushSection(event && event.description, 'Event');
      pushSection(event && event.rules, 'Event Rules');
      pushSection(event && event.resolution_source, 'Event Resolution Source');
      pushSection(event && event.resolutionSource, 'Event Resolution Source');
    }
  }

  return sections;
}

function extractQuestionText(row) {
  return (
    toStringOrNull(row && row.question) ||
    toStringOrNull(row && row.title) ||
    toStringOrNull(row && row.name) ||
    toStringOrNull(row && row.market_question) ||
    toStringOrNull(row && row.marketQuestion)
  );
}

function normalizeMarketRow(row) {
  const tokens = normalizeTokens(row && row.tokens);
  const rulesSections = collectRuleSections(row);
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
    question: extractQuestionText(row),
    description: rulesSections.length ? rulesSections.join('\n\n') : null,
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
  const hosts = normalizeHostList(options.host || options.hosts || process.env.POLYMARKET_HOSTS || DEFAULT_POLYMARKET_HOST);
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 12_000;
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 500;
  const maxPages = Number.isInteger(options.maxPages) && options.maxPages > 0 ? options.maxPages : 200;
  const cacheFile = options.cacheFile || defaultCacheFile(options);
  const allowStaleCache = options.allowStaleCache !== false;
  const selectorMode = Boolean(options.marketId || options.slug);
  const diagnostics = [];

  let rows = [];
  let payload = null;
  let hostUsed = hosts[0] || DEFAULT_POLYMARKET_HOST;
  let sourceType = options.mockUrl ? 'polymarket:mock' : 'polymarket:clob';

  if (options.mockUrl) {
    try {
      payload = await fetchMockPayload(options.mockUrl, timeoutMs);
      if (Array.isArray(payload)) {
        rows = payload;
      } else if (payload && Array.isArray(payload.markets)) {
        rows = payload.markets;
      } else {
        throw new Error('Polymarket mock payload must be an array or { markets: [] }.');
      }
    } catch (err) {
      diagnostics.push(`Polymarket mock fetch failed: ${formatNetworkError(err)}`);
      if (allowStaleCache) {
        const cachedMarket = loadCachedMarket({ ...options, cacheFile }, diagnostics);
        if (cachedMarket) return cachedMarket;
      }
      throw err;
    }
  } else {
    const hostErrors = [];
    for (const candidateHost of hosts) {
      try {
        const client = typeof options.clientFactory === 'function'
          ? options.clientFactory(candidateHost, DEFAULT_POLYMARKET_CHAIN)
          : new ClobClient(candidateHost, DEFAULT_POLYMARKET_CHAIN);
        let cursor;
        let loops = 0;
        const candidateRows = [];
        let matchedRow = null;

        while (loops < maxPages) {
          loops += 1;
          const page = cursor ? await client.getMarkets(cursor) : await client.getMarkets();
          const chunk = Array.isArray(page && page.data) ? page.data : [];

          if (selectorMode) {
            matchedRow = chunk.find((row) => marketMatches(row, options)) || null;
            if (matchedRow) {
              candidateRows.push(matchedRow);
              break;
            }
          } else {
            candidateRows.push(...chunk);
          }

          if (!selectorMode && candidateRows.length >= limit) {
            break;
          }

          if (!page || !page.next_cursor || page.next_cursor === cursor) {
            break;
          }
          cursor = page.next_cursor;
        }

        if (selectorMode && loops >= maxPages && !candidateRows.length) {
          diagnostics.push(`Polymarket scan reached max pages (${maxPages}) without selector match on host ${candidateHost}.`);
        }

        rows = candidateRows;
        hostUsed = candidateHost;
        if (rows.length) {
          break;
        }
      } catch (err) {
        hostErrors.push(`[${candidateHost}] ${formatNetworkError(err)}`);
      }
    }

    if (!rows.length && hostErrors.length) {
      diagnostics.push(`Polymarket host attempts failed: ${hostErrors.join(' | ')}`);
      if (allowStaleCache) {
        const cachedMarket = loadCachedMarket({ ...options, cacheFile }, diagnostics);
        if (cachedMarket) return cachedMarket;
      }
      throw new Error(
        `Polymarket market fetch failed across all hosts. ${hostErrors.join(' | ')} Hint: use --polymarket-mock-url or retry later.`,
      );
    }
  }

  const matchedRow = rows.find((row) => marketMatches(row, options));
  if (!matchedRow) {
    if (allowStaleCache) {
      const cachedMarket = loadCachedMarket({ ...options, cacheFile }, diagnostics);
      if (cachedMarket) return cachedMarket;
    }
    const target = options.marketId || options.slug || 'unknown';
    throw new Error(`Polymarket market not found for selector: ${target}`);
  }

  const normalized = normalizeMarketRow(matchedRow);
  normalized.source = sourceType;
  normalized.host = hostUsed;

  if (payload && payload.orderbooks && typeof payload.orderbooks === 'object') {
    normalized.mockOrderbooks = payload.orderbooks;
  }

  for (const item of diagnostics) {
    normalized.diagnostics.push(item);
  }

  if (options.persistCache !== false) {
    const cachePayload = buildCachePayload(options, hostUsed, matchedRow, normalized.mockOrderbooks || null, sourceType);
    writeCacheFile(cacheFile, cachePayload);
    normalized.cacheFile = cacheFile;
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

  if (!clientOrOptions || typeof clientOrOptions.getOrderBook !== 'function') {
    return null;
  }

  return clientOrOptions.getOrderBook(tokenId);
}

async function fetchDepthForMarket(market, options = {}) {
  const slippageBps = Number.isFinite(Number(options.slippageBps)) ? Number(options.slippageBps) : 100;
  const diagnostics = [];
  const hosts = normalizeHostList(options.host || options.hosts || process.env.POLYMARKET_HOSTS || DEFAULT_POLYMARKET_HOST);
  const cacheFile =
    options.cacheFile ||
    defaultCacheFile({
      marketId: market && market.marketId,
      slug: market && market.slug,
      cacheKey: market && market.question ? normalizeText(market.question).slice(0, 48) : null,
    });

  let yesBook = null;
  let noBook = null;
  let hostUsed = null;

  if (!options.mockUrl) {
    const hostErrors = [];
    for (const candidateHost of hosts) {
      try {
        const client = new ClobClient(candidateHost, DEFAULT_POLYMARKET_CHAIN);
        const yesFromHost = await getOrderbook(client, market.yesTokenId, null);
        const noFromHost = await getOrderbook(client, market.noTokenId, null);
        yesBook = yesFromHost || yesBook;
        noBook = noFromHost || noBook;
        if (yesFromHost || noFromHost) {
          hostUsed = candidateHost;
        }
        if (yesBook && noBook) {
          break;
        }
      } catch (err) {
        hostErrors.push(`[${candidateHost}] ${formatNetworkError(err)}`);
      }
    }

    if (hostErrors.length) {
      diagnostics.push(`Polymarket orderbook host attempts failed: ${hostErrors.join(' | ')}`);
    }
  }

  if (!yesBook || !noBook) {
    const fallbackOrderbooks =
      (market && market.mockOrderbooks && typeof market.mockOrderbooks === 'object' ? market.mockOrderbooks : null) ||
      (() => {
        const cached = readCacheFile(cacheFile);
        return cached && cached.orderbooks && typeof cached.orderbooks === 'object' ? cached.orderbooks : null;
      })();

    if (fallbackOrderbooks) {
      const fallbackYes = await getOrderbook(null, market.yesTokenId, fallbackOrderbooks);
      const fallbackNo = await getOrderbook(null, market.noTokenId, fallbackOrderbooks);
      yesBook = yesBook || fallbackYes;
      noBook = noBook || fallbackNo;
      diagnostics.push('Used cached/mock Polymarket orderbooks for depth estimation.');
    }
  }

  const yesDepth = yesBook ? calculateExecutableDepthUsd(yesBook, 'buy', slippageBps) : null;
  const noDepth = noBook ? calculateExecutableDepthUsd(noBook, 'buy', slippageBps) : null;

  const candidates = [yesDepth && yesDepth.depthUsd, noDepth && noDepth.depthUsd].filter((value) => Number.isFinite(value));
  const depthWithinSlippageUsd = candidates.length ? Math.min(...candidates) : 0;

  if (!yesDepth) diagnostics.push('YES token orderbook unavailable.');
  if (!noDepth) diagnostics.push('NO token orderbook unavailable.');

  if ((yesBook || noBook) && options.persistCache !== false) {
    const cached = readCacheFile(cacheFile) || buildCachePayload(
      {
        marketId: market && market.marketId,
        slug: market && market.slug,
      },
      hostUsed || options.host || DEFAULT_POLYMARKET_HOST,
      market && market.raw ? market.raw : null,
      null,
      'polymarket:depth-cache',
    );

    const existingOrderbooks = cached.orderbooks && typeof cached.orderbooks === 'object' ? cached.orderbooks : {};
    if (market.yesTokenId && yesBook) {
      existingOrderbooks[market.yesTokenId] = yesBook;
    }
    if (market.noTokenId && noBook) {
      existingOrderbooks[market.noTokenId] = noBook;
    }

    cached.orderbooks = existingOrderbooks;
    cached.savedAt = new Date().toISOString();
    writeCacheFile(cacheFile, cached);
  }

  return {
    slippageBps,
    host: hostUsed || null,
    depthWithinSlippageUsd: round(depthWithinSlippageUsd, 6) || 0,
    yesDepth,
    noDepth,
    cacheFile,
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
