const { ClobClient, Chain } = require('@polymarket/clob-client');
const { toNumber } = require('./shared/utils.cjs');

const DEFAULT_POLYMARKET_HOST = 'https://clob.polymarket.com';
const DEFAULT_POLYMARKET_GAMMA_HOST = 'https://gamma-api.polymarket.com';

function toTimestampSeconds(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return Math.floor(parsed / 1000);
}

function resolvePolymarketEventStartValue(row) {
  if (!row || typeof row !== 'object') return null;
  return row.game_start_time || row.gameStartTime || null;
}

function resolvePolymarketCloseFallbackValue(row) {
  if (!row || typeof row !== 'object') return null;
  return row.endDateIso || row.end_date_iso || row.endDate || row.closedTime || null;
}

function resolvePolymarketTimestampValue(row) {
  return resolvePolymarketEventStartValue(row) || resolvePolymarketCloseFallbackValue(row);
}

function normalizeTokens(tokens) {
  if (!Array.isArray(tokens) || !tokens.length) {
    return { yes: null, no: null, diagnostics: ['No token prices available from Polymarket market payload.'] };
  }

  let yes = tokens.find((token) => /^(yes|true)$/i.test(String(token && token.outcome ? token.outcome : '')));
  let no = tokens.find((token) => /^(no|false)$/i.test(String(token && token.outcome ? token.outcome : '')));
  const diagnostics = [];

  if (!yes || !no) {
    if (tokens.length === 2) {
      yes = tokens[0];
      no = tokens[1];
      diagnostics.push('Mapped binary outcomes using token order (non-standard outcome labels).');
    } else {
      diagnostics.push('Unable to map yes/no outcomes from token labels.');
      return { yes: null, no: null, diagnostics };
    }
  }

  const yesPrice = toNumber(yes && yes.price);
  const noPrice = toNumber(no && no.price);
  if (yesPrice === null || noPrice === null) {
    diagnostics.push('Missing token prices for yes/no mapping.');
    return { yes: null, no: null, diagnostics };
  }

  const total = yesPrice + noPrice;
  if (!Number.isFinite(total) || total <= 0) {
    diagnostics.push('Invalid yes/no token total for probability normalization.');
    return { yes: null, no: null, diagnostics };
  }

  return {
    yes: (yesPrice / total) * 100,
    no: (noPrice / total) * 100,
    diagnostics,
  };
}

function safeParseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildTokensFromGammaPayload(row) {
  const outcomes = safeParseJsonArray(row && row.outcomes) || safeParseJsonArray(row && row.outcomeNames);
  const prices = safeParseJsonArray(row && row.outcomePrices) || safeParseJsonArray(row && row.prices);
  if (!Array.isArray(outcomes) || !Array.isArray(prices) || outcomes.length !== prices.length || !outcomes.length) {
    return null;
  }
  const tokens = [];
  for (let index = 0; index < outcomes.length; index += 1) {
    tokens.push({
      outcome: String(outcomes[index] || ''),
      price: prices[index],
    });
  }
  return tokens;
}

function mapGammaRow(row) {
  const tokens =
    (Array.isArray(row && row.tokens) ? row.tokens : null) ||
    (Array.isArray(row && row.outcomePrices) && Array.isArray(row && row.outcomes)
      ? row.outcomes.map((outcome, index) => ({ outcome, price: row.outcomePrices[index] }))
      : null) ||
    buildTokensFromGammaPayload(row);
  const mapped = normalizeTokens(tokens || []);
  const marketId = row && (row.conditionId || row.condition_id || row.id || row.questionID) ? String(
    row.conditionId || row.condition_id || row.id || row.questionID,
  ) : null;
  const eventStartTimestamp = toTimestampSeconds(resolvePolymarketEventStartValue(row));
  const sourceCloseTimestamp = toTimestampSeconds(resolvePolymarketCloseFallbackValue(row));
  const closeTimestamp = toTimestampSeconds(resolvePolymarketTimestampValue(row));
  return {
    legId: `polymarket:${String(marketId || '')}`,
    venue: 'polymarket',
    marketId,
    question: row && (row.question || row.title || row.description) ? String(row.question || row.title || row.description) : null,
    eventStartTimestamp,
    sourceCloseTimestamp,
    timestampSource: eventStartTimestamp ? 'game_start_time' : sourceCloseTimestamp ? 'end_date_iso' : null,
    closeTimestamp,
    yesPct: mapped.yes,
    noPct: mapped.no,
    liquidityUsd: toNumber(row && (row.liquidityNum || row.liquidity || row.liquidityClob)),
    volumeUsd: toNumber(row && (row.volumeNum || row.volume || row.volumeClob)),
    url: row && (row.market_slug || row.slug) ? `https://polymarket.com/event/${String(row.market_slug || row.slug)}` : null,
    oddsSource: 'polymarket:gamma-markets',
    diagnostics: mapped.diagnostics,
    rules: row && row.description ? String(row.description) : null,
    sources: [],
    pollStatus: null,
  };
}

function mapPolymarketRow(row) {
  const mapped = normalizeTokens(row.tokens || []);
  const question = row.question || row.description || null;
  const marketId = row.condition_id || row.question_id || null;
  const eventStartTimestamp = toTimestampSeconds(resolvePolymarketEventStartValue(row));
  const sourceCloseTimestamp = toTimestampSeconds(resolvePolymarketCloseFallbackValue(row));
  return {
    legId: `polymarket:${String(marketId || '')}`,
    venue: 'polymarket',
    marketId,
    question,
    eventStartTimestamp,
    sourceCloseTimestamp,
    timestampSource: eventStartTimestamp ? 'game_start_time' : sourceCloseTimestamp ? 'end_date_iso' : null,
    closeTimestamp: toTimestampSeconds(resolvePolymarketTimestampValue(row)),
    yesPct: mapped.yes,
    noPct: mapped.no,
    liquidityUsd: null,
    volumeUsd: null,
    url: row.market_slug ? `https://polymarket.com/event/${row.market_slug}` : null,
    oddsSource: 'polymarket:clob-markets',
    diagnostics: mapped.diagnostics,
    rules: row.description ? String(row.description) : null,
    sources: [],
    pollStatus: null,
  };
}

async function fetchMockPolymarketMarkets(mockUrl, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(mockUrl, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Mock Polymarket endpoint returned HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (Array.isArray(payload)) {
      return payload;
    }
    if (payload && Array.isArray(payload.markets)) {
      return payload.markets;
    }
    throw new Error('Mock Polymarket payload must be an array or { markets: [] }.');
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeGammaMarketRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.markets)) return payload.markets;
  return [];
}

async function fetchGammaPolymarketMarkets(options = {}) {
  const gammaHostRaw =
    options.gammaHost ||
    process.env.POLYMARKET_GAMMA_HOST ||
    DEFAULT_POLYMARKET_GAMMA_HOST;
  const gammaHost = String(gammaHostRaw || '').replace(/\/+$/, '');
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 100;
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 12_000;

  const rows = [];
  let offset = 0;
  let loopCount = 0;
  while (rows.length < limit && loopCount < 10) {
    loopCount += 1;
    const pageLimit = Math.min(200, Math.max(25, limit - rows.length));
    const url =
      `${gammaHost}/markets?active=true&closed=false&archived=false&order=volume` +
      `&ascending=false&limit=${pageLimit}&offset=${offset}`;
    const payload = await fetchJsonWithTimeout(url, timeoutMs);
    const batch = normalizeGammaMarketRows(payload);
    if (!batch.length) break;
    rows.push(...batch);
    if (batch.length < pageLimit) break;
    offset += batch.length;
  }

  return {
    host: gammaHost,
    rows,
  };
}

async function fetchClobPolymarketMarkets(options = {}) {
  const host = options.host || DEFAULT_POLYMARKET_HOST;
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 100;
  const client = new ClobClient(host, Chain.POLYGON);
  const rows = [];
  let cursor;
  let loops = 0;
  while (rows.length < limit && loops < 8) {
    loops += 1;
    const page = cursor ? await client.getMarkets(cursor) : await client.getMarkets();
    const data = Array.isArray(page && page.data) ? page.data : [];
    rows.push(...data);
    if (!page || !page.next_cursor || page.next_cursor === cursor) break;
    cursor = page.next_cursor;
  }
  return { host, rows };
}

async function fetchPolymarketMarkets(options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 100;
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 12_000;
  const diagnostics = [];
  let rows = [];
  let source = 'polymarket:clob';
  let host = options.host || DEFAULT_POLYMARKET_HOST;

  if (options.mockUrl) {
    rows = await fetchMockPolymarketMarkets(options.mockUrl, timeoutMs);
    source = 'polymarket:mock';
  } else {
    let gammaResult = null;
    try {
      const preferredGammaHost =
        options.host && /gamma-api\.polymarket\.com/i.test(String(options.host))
          ? options.host
          : options.gammaHost;
      gammaResult = await fetchGammaPolymarketMarkets({
        gammaHost: preferredGammaHost,
        timeoutMs,
        limit,
      });
      if (Array.isArray(gammaResult.rows) && gammaResult.rows.length) {
        rows = gammaResult.rows;
        source = 'polymarket:gamma';
        host = gammaResult.host;
      }
    } catch (err) {
      diagnostics.push(`Gamma markets fetch failed: ${err && err.message ? err.message : String(err)}`);
    }

    if (!rows.length) {
      const clob = await fetchClobPolymarketMarkets({
        host: options.host,
        timeoutMs,
        limit,
      });
      rows = clob.rows;
      source = 'polymarket:clob';
      host = clob.host;
    }
  }

  const mapper = source === 'polymarket:gamma' ? mapGammaRow : mapPolymarketRow;
  const mapped = rows.slice(0, limit).map(mapper);
  return {
    host,
    source,
    count: mapped.length,
    items: mapped,
    diagnostics,
  };
}

module.exports = {
  DEFAULT_POLYMARKET_HOST,
  DEFAULT_POLYMARKET_GAMMA_HOST,
  fetchPolymarketMarkets,
};
