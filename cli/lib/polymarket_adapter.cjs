const { ClobClient, Chain } = require('@polymarket/clob-client');

const DEFAULT_POLYMARKET_HOST = 'https://clob.polymarket.com';

function toNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function toTimestampSeconds(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return Math.floor(parsed / 1000);
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

function mapPolymarketRow(row) {
  const mapped = normalizeTokens(row.tokens || []);
  const question = row.question || row.description || null;
  return {
    venue: 'polymarket',
    marketId: row.condition_id || row.question_id || null,
    question,
    closeTimestamp: toTimestampSeconds(row.end_date_iso || row.game_start_time),
    yesPct: mapped.yes,
    noPct: mapped.no,
    liquidityUsd: null,
    volumeUsd: null,
    url: row.market_slug ? `https://polymarket.com/event/${row.market_slug}` : null,
    oddsSource: 'polymarket:clob-markets',
    diagnostics: mapped.diagnostics,
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

async function fetchPolymarketMarkets(options = {}) {
  const host = options.host || DEFAULT_POLYMARKET_HOST;
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 100;
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 12_000;

  let rows = [];

  if (options.mockUrl) {
    rows = await fetchMockPolymarketMarkets(options.mockUrl, timeoutMs);
  } else {
    const client = new ClobClient(host, Chain.POLYGON);
    let cursor;
    let loops = 0;
    while (rows.length < limit && loops < 5) {
      loops += 1;
      const page = cursor ? await client.getMarkets(cursor) : await client.getMarkets();
      const data = Array.isArray(page && page.data) ? page.data : [];
      rows.push(...data);
      if (!page || !page.next_cursor || page.next_cursor === cursor) {
        break;
      }
      cursor = page.next_cursor;
    }
  }

  const mapped = rows.slice(0, limit).map(mapPolymarketRow);
  return {
    host,
    source: options.mockUrl ? 'polymarket:mock' : 'polymarket:clob',
    count: mapped.length,
    items: mapped,
  };
}

module.exports = {
  DEFAULT_POLYMARKET_HOST,
  fetchPolymarketMarkets,
};
