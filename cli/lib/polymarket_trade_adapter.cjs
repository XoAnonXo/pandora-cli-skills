const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { ClobClient, Chain, Side, OrderType, AssetType } = require('@polymarket/clob-client');
const { round, toOptionalNumber } = require('./shared/utils.cjs');

const DEFAULT_POLYMARKET_HOST = 'https://clob.polymarket.com';
const DEFAULT_POLYMARKET_GAMMA_URL = 'https://gamma-api.polymarket.com';
const DEFAULT_POLYMARKET_CHAIN = Chain.POLYGON;
const POLYMARKET_CACHE_SCHEMA_VERSION = '1.0.0';
const POLYMARKET_SIG_TYPE_EOA = 0;
const POLYMARKET_SIG_TYPE_PROXY = 2;

const tradingClientCache = new Map();
const derivedCredsCache = new Map();

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function isConditionId(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || '').trim());
}

function isValidPrivateKey(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || '').trim());
}

function toStringOrNull(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function toIntegerOrNull(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.trunc(numeric);
}

function toTimestampSeconds(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Date.parse(String(value));
  if (!Number.isNaN(parsed)) {
    return Math.floor(parsed / 1000);
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
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

function normalizeGammaBaseUrl(gammaUrl) {
  const raw = String(gammaUrl || process.env.POLYMARKET_GAMMA_URL || DEFAULT_POLYMARKET_GAMMA_URL).trim();
  return raw.replace(/\/+$/, '');
}

function parseMaybeJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];

  const raw = String(value).trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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

function resolveSignatureType(options = {}) {
  return options.funder ? POLYMARKET_SIG_TYPE_PROXY : POLYMARKET_SIG_TYPE_EOA;
}

function hashSensitiveCachePart(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function buildTradingCacheKey(host, chain, options = {}) {
  const signatureType = resolveSignatureType(options);
  return [
    String(host || ''),
    String(chain || ''),
    String(signatureType),
    String(options.funder || ''),
    hashSensitiveCachePart(options.privateKey),
    hashSensitiveCachePart(options.apiKey),
    hashSensitiveCachePart(options.apiSecret),
    hashSensitiveCachePart(options.apiPassphrase),
  ].join('|');
}

function clearCachedTradingClient(key) {
  if (!key) return;
  tradingClientCache.delete(key);
  derivedCredsCache.delete(key);
}

function responseContainsError(response) {
  if (!response || typeof response !== 'object') return false;
  if (response.error) return true;
  if (response.err) return true;
  const status = toIntegerOrNull(response.status);
  return status !== null && status >= 400;
}

function responseIndicatesSuccess(response) {
  if (!response || typeof response !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(response, 'success')) {
    return Boolean(response.success) && !responseContainsError(response);
  }
  return !responseContainsError(response);
}

function classifyAuthFailure(value) {
  const status =
    toIntegerOrNull(value && value.status) ||
    toIntegerOrNull(value && value.code) ||
    toIntegerOrNull(value && value.response && value.response.status);
  const text = JSON.stringify(value || '').toLowerCase();
  return (
    status === 401 ||
    status === 403 ||
    /unauthorized|invalid signature|forbidden|invalid api key|api key/.test(text)
  );
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
  const tmpPath = `${cacheFile}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  let wroteTmp = false;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
    wroteTmp = true;
    fs.renameSync(tmpPath, cacheFile);
    try {
      fs.chmodSync(cacheFile, 0o600);
    } catch {
      // best-effort hardening on platforms that ignore/limit chmod
    }
  } finally {
    if (wroteTmp && fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // best-effort cleanup
      }
    }
  }
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

  const yesPrice = toOptionalNumber(yes.price);
  const noPrice = toOptionalNumber(no.price);

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

function normalizeTokenIdArray(row) {
  const arrayFromFields =
    parseMaybeJsonArray(row && row.clobTokenIds).length
      ? parseMaybeJsonArray(row && row.clobTokenIds)
      : parseMaybeJsonArray(row && row.clob_token_ids);
  return arrayFromFields
    .map((value) => toStringOrNull(value))
    .filter(Boolean);
}

function materializeOutcomeTokens(row) {
  if (Array.isArray(row && row.tokens) && row.tokens.length) {
    return row.tokens;
  }

  const outcomes = parseMaybeJsonArray(row && (row.outcomes || row.outcome_names));
  const prices = parseMaybeJsonArray(row && (row.outcomePrices || row.outcome_prices));
  if (outcomes.length < 2 || prices.length < 2) {
    return [];
  }

  const tokenIds = normalizeTokenIdArray(row);
  return [
    {
      outcome: outcomes[0],
      price: prices[0],
      token_id: tokenIds[0] || null,
    },
    {
      outcome: outcomes[1],
      price: prices[1],
      token_id: tokenIds[1] || null,
    },
  ];
}

function extractQuestionText(row) {
  return (
    toStringOrNull(row && row.question) ||
    toStringOrNull(row && row.title) ||
    toStringOrNull(row && row.name) ||
    toStringOrNull(row && row.market_question) ||
    toStringOrNull(row && row.marketQuestion) ||
    toStringOrNull(row && row.shortQuestion) ||
    toStringOrNull(row && row.short_question)
  );
}

function normalizeMarketRow(row) {
  const tokens = normalizeTokens(materializeOutcomeTokens(row));
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
      (row &&
        (row.condition_id ||
          row.conditionId ||
          row.question_id ||
          row.questionId ||
          row.id ||
          row.market_id ||
          row.marketId ||
          row.slug ||
          row.market_slug ||
          row.marketSlug)) ||
        '',
    ).trim() || null,
    slug: String((row && (row.market_slug || row.marketSlug || row.slug)) || '').trim() || null,
    question: extractQuestionText(row),
    eventId: toStringOrNull(row && (row.event_id || row.eventId)),
    eventSlug: toStringOrNull(row && (row.event_slug || row.eventSlug)),
    eventTitle: toStringOrNull(row && (row.event_title || row.eventTitle)),
    description: rulesSections.length ? rulesSections.join('\n\n') : null,
    closeTimestamp: toTimestampSeconds(
      row &&
        (row.end_date_iso ||
          row.endDate ||
          row.end_date ||
          row.endDateIso ||
          row.accepting_orders_timestamp ||
          row.game_start_time ||
          row.closeTime),
    ),
    yesPct: tokens.yes,
    noPct: tokens.no,
    yesTokenId: tokens.yesTokenId,
    noTokenId: tokens.noTokenId,
    volume24hUsd: toOptionalNumber(row && (row.volume24hr || row.volume_24hr || row.volume24h || row.one_day_volume || row.oneDayVolume || 0)) || 0,
    volumeTotalUsd: toOptionalNumber(row && (row.volume || row.total_volume || row.totalVolume || row.volumeNum || 0)) || 0,
    liquidityUsd: toOptionalNumber(row && (row.liquidity || row.liquidity_num || row.totalLiquidity || 0)) || 0,
    active,
    resolved,
    url:
      row && (row.market_slug || row.marketSlug || row.slug)
        ? `https://polymarket.com/event/${row.market_slug || row.marketSlug || row.slug}`
        : null,
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

  const idCandidates = [row.condition_id, row.conditionId, row.question_id, row.questionId, row.id, row.market_id, row.marketId]
    .map((value) => normalizeText(value))
    .filter(Boolean);
  const slugCandidates = [row.market_slug, row.marketSlug, row.slug].map((value) => normalizeText(value)).filter(Boolean);

  if (idNeedle && idCandidates.includes(idNeedle)) return true;
  if (slugNeedle && slugCandidates.includes(slugNeedle)) return true;
  return false;
}

function parseMarketsPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.markets)) return payload.markets;
  if (payload && payload.data && Array.isArray(payload.data.markets)) return payload.data.markets;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
}

function parseEventsPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.events)) return payload.events;
  if (payload && payload.data && Array.isArray(payload.data.events)) return payload.data.events;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function callWithTimeout(work, timeoutMs, label) {
  const limitMs = Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : null;
  if (!limitMs) {
    return work(undefined);
  }

  const abortController = new AbortController();
  let timer = null;
  try {
    return await Promise.race([
      work(abortController.signal),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          // Best-effort cancellation: this only interrupts clients that support AbortSignal.
          abortController.abort();
          reject(new Error(`${label} timed out after ${limitMs}ms`));
        }, limitMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildGammaUrl(baseUrl, params) {
  const url = new URL(`${baseUrl}/markets`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === null || value === undefined || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function buildGammaEventsUrl(baseUrl, params) {
  const url = new URL(`${baseUrl}/events`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === null || value === undefined || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function fetchGammaRows(params, options = {}, diagnostics = []) {
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 12_000;
  const gammaUrl = normalizeGammaBaseUrl(options.gammaUrl);
  const targetUrl = options.gammaMockUrl || buildGammaUrl(gammaUrl, params);
  try {
    const payload = await fetchJson(targetUrl, timeoutMs);
    return parseMarketsPayload(payload);
  } catch (err) {
    diagnostics.push(`Gamma request failed (${targetUrl}): ${formatNetworkError(err)}`);
    return [];
  }
}

function makeMarketDedupeKey(row) {
  return (
    normalizeText(
      row &&
        (row.condition_id ||
          row.conditionId ||
          row.question_id ||
          row.questionId ||
          row.market_id ||
          row.marketId ||
          row.id ||
          row.slug),
    ) || null
  );
}

function flattenEventMarkets(events) {
  const output = [];
  const seen = new Set();

  for (const event of Array.isArray(events) ? events : []) {
    const markets = Array.isArray(event && event.markets) ? event.markets : [];
    for (const market of markets) {
      if (!market || typeof market !== 'object') continue;
      const dedupeKey = makeMarketDedupeKey(market);
      if (dedupeKey && seen.has(dedupeKey)) continue;
      if (dedupeKey) seen.add(dedupeKey);
      output.push({
        ...market,
        event_id: event && event.id !== undefined ? event.id : null,
        event_slug: event && event.slug ? event.slug : null,
        event_title: event && event.title ? event.title : null,
        event_tags: Array.isArray(event && event.tags) ? event.tags : [],
      });
    }
  }

  return output;
}

function normalizeTagIdList(input) {
  const values = Array.isArray(input) ? input : [];
  const normalized = [];
  for (const value of values) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) continue;
    const asInt = Math.trunc(numeric);
    if (asInt <= 0) continue;
    normalized.push(asInt);
  }
  return Array.from(new Set(normalized));
}

const BROWSE_ALLOWED_CATEGORIES = new Set(['sports', 'crypto', 'politics', 'entertainment']);
const BROWSE_DEFAULT_SPORT_TAG_IDS = Object.freeze([82, 100350]);
const BROWSE_SPORT_KEYWORDS = [
  'sport',
  'soccer',
  'football',
  'premier league',
  'epl',
  'nba',
  'nfl',
  'nhl',
  'mlb',
  'tennis',
  'cricket',
  'mma',
  'ufc',
  'formula 1',
  'f1',
];
const BROWSE_CRYPTO_KEYWORDS = [
  'crypto',
  'bitcoin',
  'btc',
  'ethereum',
  'eth',
  'solana',
  'defi',
  'blockchain',
  'altcoin',
  'memecoin',
];
const BROWSE_POLITICS_KEYWORDS = [
  'politic',
  'election',
  'president',
  'prime minister',
  'senate',
  'congress',
  'government',
  'parliament',
  'campaign',
];
const BROWSE_ENTERTAINMENT_KEYWORDS = [
  'entertain',
  'movie',
  'film',
  'music',
  'album',
  'artist',
  'tv',
  'celebrity',
  'oscar',
  'emmy',
  'grammy',
  'box office',
];

function normalizeBrowseCategoryList(input) {
  const values = Array.isArray(input) ? input : [input];
  const normalized = [];
  for (const value of values) {
    const text = String(value || '').trim().toLowerCase();
    if (!text || !BROWSE_ALLOWED_CATEGORIES.has(text)) continue;
    normalized.push(text);
  }
  return Array.from(new Set(normalized));
}

function normalizeBrowseSortBy(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text || text === 'volume24h' || text === 'volume24husd' || text === 'volume') return 'volume24h';
  if (text === 'liquidity' || text === 'liquidityusd') return 'liquidity';
  if (text === 'enddate' || text === 'end-date' || text === 'close' || text === 'close-time' || text === 'closetimestamp') {
    return 'endDate';
  }
  return 'volume24h';
}

function collectTagEntries(row) {
  const entries = [];
  const eventTags = row && Array.isArray(row.event_tags) ? row.event_tags : [];
  const directTags = row && Array.isArray(row.tags) ? row.tags : [];
  entries.push(...eventTags);
  entries.push(...directTags);
  if (row && row.tag_id !== undefined) entries.push({ id: row.tag_id });
  if (row && row.tagId !== undefined) entries.push({ id: row.tagId });
  return entries;
}

function readTagId(tag) {
  if (tag === null || tag === undefined) return null;
  if (typeof tag === 'number' && Number.isFinite(tag)) {
    const asInt = Math.trunc(tag);
    return asInt > 0 ? asInt : null;
  }
  if (typeof tag === 'string' && /^\d+$/.test(tag.trim())) {
    const asInt = Math.trunc(Number(tag.trim()));
    return asInt > 0 ? asInt : null;
  }
  if (typeof tag === 'object') {
    const candidate = tag.id !== undefined ? tag.id : tag.tag_id !== undefined ? tag.tag_id : tag.tagId;
    return readTagId(candidate);
  }
  return null;
}

function readTagTextValues(tag) {
  if (tag === null || tag === undefined) return [];
  if (typeof tag === 'string') return [tag];
  if (typeof tag === 'number') return [String(tag)];
  if (typeof tag !== 'object') return [];
  return [
    tag.slug,
    tag.name,
    tag.label,
    tag.title,
    tag.group,
    tag.topic,
    tag.category,
    tag.shortName,
    tag.short_name,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function includesKeyword(textPool, keywords) {
  return textPool.some((text) => keywords.some((keyword) => text.includes(keyword)));
}

function classifyBrowseCategories(item) {
  const row = item && item.raw && typeof item.raw === 'object' ? item.raw : {};
  const tagEntries = collectTagEntries(row);
  const tagIds = [];
  const tagText = [];
  const seenText = new Set();
  const seenTagIds = new Set();

  for (const entry of tagEntries) {
    const tagId = readTagId(entry);
    if (tagId !== null && !seenTagIds.has(tagId)) {
      seenTagIds.add(tagId);
      tagIds.push(tagId);
    }
    for (const text of readTagTextValues(entry)) {
      const normalized = normalizeText(text);
      if (!normalized || seenText.has(normalized)) continue;
      seenText.add(normalized);
      tagText.push(normalized);
    }
  }

  const textPool = tagText.concat(
    [item && item.eventTitle, item && item.eventSlug, item && item.slug, item && item.question]
      .map((value) => normalizeText(value))
      .filter(Boolean),
  );

  const categories = new Set();
  if (tagIds.some((value) => BROWSE_DEFAULT_SPORT_TAG_IDS.includes(value)) || includesKeyword(textPool, BROWSE_SPORT_KEYWORDS)) {
    categories.add('sports');
  }
  if (includesKeyword(textPool, BROWSE_CRYPTO_KEYWORDS)) {
    categories.add('crypto');
  }
  if (includesKeyword(textPool, BROWSE_POLITICS_KEYWORDS)) {
    categories.add('politics');
  }
  if (includesKeyword(textPool, BROWSE_ENTERTAINMENT_KEYWORDS)) {
    categories.add('entertainment');
  }

  return {
    categories: Array.from(categories),
    tagIds,
  };
}

async function fetchGammaRowsByTagIds(params, options = {}, diagnostics = []) {
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 12_000;
  const gammaUrl = normalizeGammaBaseUrl(options.gammaUrl);
  const tagIds = normalizeTagIdList(params && params.tagIds);
  if (!tagIds.length) return [];

  if (options.gammaMockUrl) {
    try {
      const payload = await fetchJson(options.gammaMockUrl, timeoutMs);
      const events = parseEventsPayload(payload);
      return flattenEventMarkets(events);
    } catch (err) {
      diagnostics.push(`Gamma sports-events request failed (${options.gammaMockUrl}): ${formatNetworkError(err)}`);
      return [];
    }
  }

  const allRows = [];
  const perTagResults = await Promise.all(
    tagIds.map(async (tagId) => {
      const queryParams = {
        ...(params || {}),
        tag_id: tagId,
      };
      delete queryParams.tagIds;
      const targetUrl = buildGammaEventsUrl(gammaUrl, queryParams);
      try {
        const payload = await fetchJson(targetUrl, timeoutMs);
        const events = parseEventsPayload(payload);
        return {
          rows: flattenEventMarkets(events),
          error: null,
        };
      } catch (err) {
        return {
          rows: [],
          error: `Gamma sports-events request failed (${targetUrl}): ${formatNetworkError(err)}`,
        };
      }
    }),
  );

  for (const result of perTagResults) {
    if (result.error) {
      diagnostics.push(result.error);
      continue;
    }
    allRows.push(...result.rows);
  }

  const deduped = [];
  const seen = new Set();
  for (const row of allRows) {
    const dedupeKey = makeMarketDedupeKey(row);
    if (dedupeKey && seen.has(dedupeKey)) continue;
    if (dedupeKey) seen.add(dedupeKey);
    deduped.push(row);
  }
  return deduped;
}

function extractConditionId(row) {
  const value = toStringOrNull(
    row &&
      (row.condition_id ||
        row.conditionId ||
        row.market_id ||
        row.marketId ||
        row.question_id ||
        row.questionId),
  );
  return value;
}

async function resolveByClobDirect(conditionId, hosts, options, diagnostics, timeoutMs) {
  const hostErrors = [];
  for (const candidateHost of hosts) {
    try {
      const client =
        typeof options.clientFactory === 'function'
          ? options.clientFactory(candidateHost, DEFAULT_POLYMARKET_CHAIN)
          : new ClobClient(candidateHost, DEFAULT_POLYMARKET_CHAIN);
      if (!client || typeof client.getMarket !== 'function') {
        throw new Error('CLOB client does not expose getMarket.');
      }
      const market = await callWithTimeout(
        (_signal) => client.getMarket(conditionId),
        timeoutMs,
        `Polymarket getMarket(${conditionId})`,
      );
      if (!market) continue;
      return {
        row: market,
        host: candidateHost,
      };
    } catch (err) {
      hostErrors.push(`[${candidateHost}] ${formatNetworkError(err)}`);
    }
  }

  if (hostErrors.length) {
    diagnostics.push(`Polymarket direct getMarket failed: ${hostErrors.join(' | ')}`);
  }
  return null;
}

/**
 * Resolve one Polymarket market snapshot from CLOB/Gamma/mock/cache sources.
 * Normalized `yesPct`/`noPct` values are percentages (`0..100`).
 * @param {object} [options]
 * @returns {Promise<object>}
 */
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
    let gammaRow = null;
    if (selectorMode) {
      const gammaRowsBySelector = options.slug
        ? await fetchGammaRows({ slug: options.slug, limit: 5, active: true }, options, diagnostics)
        : await fetchGammaRows({ condition_ids: options.marketId, limit: 5 }, options, diagnostics);
      gammaRow = gammaRowsBySelector.find((row) => marketMatches(row, options)) || null;
      if (!gammaRow && gammaRowsBySelector.length) {
        diagnostics.push('Gamma returned candidate rows but none matched the selector exactly; continuing with CLOB lookup.');
      }
    }

    let directConditionId = null;
    if (isConditionId(options.marketId)) {
      directConditionId = options.marketId;
    } else if (gammaRow) {
      directConditionId = extractConditionId(gammaRow);
    }

    if (directConditionId && isConditionId(directConditionId)) {
      const direct = await resolveByClobDirect(directConditionId, hosts, options, diagnostics, timeoutMs);
      if (direct && direct.row) {
        rows = [direct.row];
        hostUsed = direct.host;
        sourceType = 'polymarket:clob-direct';
      }
    }

    if (!rows.length && gammaRow) {
      rows = [gammaRow];
      sourceType = 'polymarket:gamma';
      hostUsed = normalizeGammaBaseUrl(options.gammaUrl);
    }

    const hostErrors = [];
    if (!rows.length) {
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
            const page = await callWithTimeout(
              (_signal) => (cursor ? client.getMarkets(cursor) : client.getMarkets()),
              timeoutMs,
              `Polymarket getMarkets(${candidateHost})`,
            );
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
        .map((entry) => ({ price: toOptionalNumber(entry && entry.price), size: toOptionalNumber(entry && entry.size) }))
        .filter((entry) => entry.price !== null && entry.size !== null && entry.size > 0)
        .sort((a, b) => b.price - a.price)
    : [];

  const asks = Array.isArray(book.asks)
    ? book.asks
        .map((entry) => ({ price: toOptionalNumber(entry && entry.price), size: toOptionalNumber(entry && entry.size) }))
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

/**
 * Estimate executable depth under a slippage cap.
 * `depthUsd` is USD notional and `depthShares` is token size.
 * @param {{bids?: Array<{price: number, size: number}>, asks?: Array<{price: number, size: number}>}} orderbook
 * @param {'buy'|'sell'} side
 * @param {number} slippageBps Slippage tolerance in basis points.
 * @returns {{
 *   depthUsd: number,
 *   depthShares: number,
 *   worstPrice: number|null,
 *   midPrice: number|null,
 *   referencePrice: number|undefined,
 *   diagnostics: string[]
 * }}
 */
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
  const bestBid = normalized.bids.length ? normalized.bids[0].price : null;
  const bestAsk = normalized.asks.length ? normalized.asks[0].price : null;
  const referencePrice =
    side === 'buy'
      ? (bestAsk !== null ? bestAsk : mid)
      : (bestBid !== null ? bestBid : mid);
  const priceLimit = side === 'buy'
    ? referencePrice * (1 + limitPriceFactor)
    : referencePrice * (1 - limitPriceFactor);

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
    referencePrice: round(referencePrice, 8),
    diagnostics: [],
  };
}

async function getOrderbook(clientOrOptions, tokenId, fallbackOrderbooks = null, timeoutMs = null) {
  if (!tokenId) return null;

  if (fallbackOrderbooks && typeof fallbackOrderbooks === 'object' && fallbackOrderbooks[tokenId]) {
    return fallbackOrderbooks[tokenId];
  }

  if (!clientOrOptions || typeof clientOrOptions.getOrderBook !== 'function') {
    return null;
  }

  return callWithTimeout(
    (_signal) => clientOrOptions.getOrderBook(tokenId),
    timeoutMs,
    `Polymarket getOrderBook(${tokenId})`,
  );
}

/**
 * Fetch YES/NO orderbooks for a market and compute depth metrics.
 * Returned depth fields are USD notional at the configured `slippageBps`.
 * @param {object} market
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function fetchDepthForMarket(market, options = {}) {
  const slippageBps = Number.isFinite(Number(options.slippageBps)) ? Number(options.slippageBps) : 100;
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 12_000;
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
        const yesFromHost = await getOrderbook(client, market.yesTokenId, null, timeoutMs);
        const noFromHost = await getOrderbook(client, market.noTokenId, null, timeoutMs);
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
  const minDepthWithinSlippageUsd = candidates.length ? Math.min(...candidates) : 0;
  const bestDepthWithinSlippageUsd = candidates.length ? Math.max(...candidates) : 0;
  // Keep the legacy/conservative aggregate as min depth (used by sizing paths),
  // while exposing best-depth separately for hedge-side diagnostics.
  const depthWithinSlippageUsd = minDepthWithinSlippageUsd;

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
    minDepthWithinSlippageUsd: round(minDepthWithinSlippageUsd, 6) || 0,
    bestDepthWithinSlippageUsd: round(bestDepthWithinSlippageUsd, 6) || 0,
    yesDepth,
    noDepth,
    cacheFile,
    diagnostics,
  };
}

/**
 * Browse active Polymarket markets with probability/liquidity filters.
 * Returned `yesPct`/`noPct` values are percentages (`0..100`).
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function browsePolymarketMarkets(options = {}) {
  const diagnostics = [];
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 12_000;
  const requestedLimit = Number.isInteger(Number(options.limit)) && Number(options.limit) > 0 ? Number(options.limit) : 10;
  const scanLimit = Math.max(requestedLimit * 5, 100);
  const requestedTagIds = normalizeTagIdList(options.polymarketTagIds);
  const categoryFilters = normalizeBrowseCategoryList(options.categories);
  const autoSportsTagIds = requestedTagIds.length === 0 && categoryFilters.includes('sports') ? [...BROWSE_DEFAULT_SPORT_TAG_IDS] : [];
  const polymarketTagIds = requestedTagIds.length ? requestedTagIds : autoSportsTagIds;
  if (autoSportsTagIds.length) {
    diagnostics.push(`No explicit sports tag ids provided; using defaults: ${autoSportsTagIds.join(', ')}.`);
  }
  const useSportsEventsEndpoint = polymarketTagIds.length > 0;

  let rows = [];
  let sourceType = options.mockUrl ? 'polymarket:mock' : 'polymarket:gamma';
  if (options.mockUrl) {
    const payload = await fetchMockPayload(options.mockUrl, timeoutMs);
    rows = parseMarketsPayload(payload);
  } else {
    if (useSportsEventsEndpoint) {
      rows = await fetchGammaRowsByTagIds(
        {
          tagIds: polymarketTagIds,
          active: true,
          closed: false,
          limit: Math.min(scanLimit, 500),
        },
        options,
        diagnostics,
      );
      sourceType = 'polymarket:gamma-events';
    } else {
      rows = await fetchGammaRows(
        {
          active: true,
          closed: false,
          limit: Math.min(scanLimit, 500),
        },
        options,
        diagnostics,
      );
    }
  }

  const minYesPct = toOptionalNumber(options.minYesPct);
  const maxYesPct = toOptionalNumber(options.maxYesPct);
  const minVolume24h = toOptionalNumber(options.minVolume24h) || 0;
  const closesAfter = toTimestampSeconds(options.closesAfter);
  const closesBefore = toTimestampSeconds(options.closesBefore);
  const questionContains = normalizeText(options.questionContains);
  const keyword = normalizeText(options.keyword);
  const slugContains = normalizeText(options.slug);
  const excludeSports = Boolean(options.excludeSports);
  const sortBy = normalizeBrowseSortBy(options.sortBy);

  const normalized = rows.map((row) => normalizeMarketRow(row));
  const enriched = normalized.map((item) => {
    const classification = classifyBrowseCategories(item);
    return {
      ...item,
      categories: classification.categories,
      tagIds: classification.tagIds,
    };
  });

  const filtered = enriched.filter((item) => {
    if (item.active === false || item.resolved) return false;
    const yesPct = toOptionalNumber(item.yesPct);
    if ((minYesPct !== null || maxYesPct !== null) && yesPct === null) return false;
    if (minYesPct !== null && yesPct < minYesPct) return false;
    if (maxYesPct !== null && yesPct > maxYesPct) return false;
    if ((toOptionalNumber(item.volume24hUsd) || 0) < minVolume24h) return false;
    if (closesAfter !== null && toIntegerOrNull(item.closeTimestamp) !== null && toIntegerOrNull(item.closeTimestamp) < closesAfter) return false;
    if (closesBefore !== null && toIntegerOrNull(item.closeTimestamp) !== null && toIntegerOrNull(item.closeTimestamp) > closesBefore) return false;
    if (questionContains && !normalizeText(item.question).includes(questionContains)) return false;
    if (slugContains) {
      const slugHaystack = [item.slug, item.eventSlug].map((value) => normalizeText(value)).filter(Boolean).join(' ');
      if (!slugHaystack.includes(slugContains)) return false;
    }
    if (keyword) {
      const keywordHaystack = [item.question, item.slug, item.eventSlug, item.eventTitle]
        .map((value) => normalizeText(value))
        .filter(Boolean)
        .join(' ');
      if (!keywordHaystack.includes(keyword)) return false;
    }
    if (excludeSports && Array.isArray(item.categories) && item.categories.includes('sports')) return false;
    if (categoryFilters.length) {
      const hasCategory = Array.isArray(item.categories) && item.categories.some((value) => categoryFilters.includes(value));
      if (!hasCategory) return false;
    }
    return true;
  });

  filtered.sort((left, right) => {
    const leftVolume = toOptionalNumber(left.volume24hUsd) || 0;
    const rightVolume = toOptionalNumber(right.volume24hUsd) || 0;
    const leftLiquidity = toOptionalNumber(left.liquidityUsd) || 0;
    const rightLiquidity = toOptionalNumber(right.liquidityUsd) || 0;
    const leftClose = toIntegerOrNull(left.closeTimestamp);
    const rightClose = toIntegerOrNull(right.closeTimestamp);

    if (sortBy === 'liquidity') {
      if (rightLiquidity !== leftLiquidity) return rightLiquidity - leftLiquidity;
      if (rightVolume !== leftVolume) return rightVolume - leftVolume;
      if (leftClose === null && rightClose === null) return 0;
      if (leftClose === null) return 1;
      if (rightClose === null) return -1;
      return leftClose - rightClose;
    }

    if (sortBy === 'endDate') {
      if (leftClose === null && rightClose === null) {
        if (rightVolume !== leftVolume) return rightVolume - leftVolume;
        return rightLiquidity - leftLiquidity;
      }
      if (leftClose === null) return 1;
      if (rightClose === null) return -1;
      if (leftClose !== rightClose) return leftClose - rightClose;
      if (rightVolume !== leftVolume) return rightVolume - leftVolume;
      return rightLiquidity - leftLiquidity;
    }

    if (rightVolume !== leftVolume) return rightVolume - leftVolume;
    if (rightLiquidity !== leftLiquidity) return rightLiquidity - leftLiquidity;
    if (leftClose === null && rightClose === null) return 0;
    if (leftClose === null) return 1;
    if (rightClose === null) return -1;
    return leftClose - rightClose;
  });

  const items = filtered.slice(0, requestedLimit).map((item) => ({
    marketId: item.marketId,
    slug: item.slug,
    eventId: item.eventId,
    eventSlug: item.eventSlug,
    eventTitle: item.eventTitle,
    question: item.question,
    closeTimestamp: item.closeTimestamp,
    yesPct: item.yesPct,
    noPct: item.noPct,
    volume24hUsd: round(item.volume24hUsd, 6),
    liquidityUsd: round(item.liquidityUsd, 6),
    active: item.active,
    resolved: item.resolved,
    categories: Array.isArray(item.categories) ? item.categories : [],
    url: item.url,
    sourceType: item.source || sourceType,
  }));

  const gammaApiError =
    diagnostics.find((line) => /^Gamma( sports-events)? request failed/i.test(String(line || ''))) || null;

  return {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    source: sourceType,
    filters: {
      minYesPct,
      maxYesPct,
      minVolume24h,
      closesAfter,
      closesBefore,
      questionContains: options.questionContains || null,
      keyword: options.keyword || null,
      slug: options.slug || null,
      categories: categoryFilters,
      excludeSports,
      sortBy,
      limit: requestedLimit,
      polymarketTagIds,
    },
    count: items.length,
    items,
    gammaApiError,
    diagnostics,
  };
}

/**
 * Read Polymarket trading credentials from environment variables.
 * `privateKey` is validated; API credentials are returned as-is.
 * @param {Record<string, string|undefined>} [env=process.env]
 * @returns {{
 *   privateKey: string|null,
 *   privateKeyInvalid: boolean,
 *   funder: string|null,
 *   apiKey: string|null,
 *   apiSecret: string|null,
 *   apiPassphrase: string|null,
 *   host: string
 * }}
 */
function readTradingCredsFromEnv(env = process.env) {
  const rawPrivateKey = String(env.POLYMARKET_PRIVATE_KEY || '').trim();
  const privateKey = rawPrivateKey && isValidPrivateKey(rawPrivateKey) ? rawPrivateKey : null;
  const creds = {
    privateKey,
    privateKeyInvalid: Boolean(rawPrivateKey && !privateKey),
    funder: env.POLYMARKET_FUNDER || null,
    apiKey: env.POLYMARKET_API_KEY || null,
    apiSecret: env.POLYMARKET_API_SECRET || null,
    apiPassphrase: env.POLYMARKET_API_PASSPHRASE || null,
    host: env.POLYMARKET_HOST || DEFAULT_POLYMARKET_HOST,
  };
  return creds;
}

/**
 * Normalize price/probability input to decimal probability in `[0,1]`.
 * Accepts fractions (`0..1`) or percent values (`0..100`).
 * @param {*} value
 * @returns {number|null}
 */
function toPrice01(value) {
  const numeric = toOptionalNumber(value);
  if (numeric === null) return null;
  if (numeric >= 0 && numeric <= 1) return round(numeric, 8);
  if (numeric > 1 && numeric <= 100) return round(numeric / 100, 8);
  return null;
}

function dedupeDiagnostics(lines) {
  const seen = new Set();
  const output = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const text = String(line || '').trim();
    if (!text) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    output.push(text);
  }
  return output;
}

/**
 * Derive remaining order size in token shares from mixed order fields.
 * @param {object} order
 * @returns {number|null}
 */
function deriveRemainingOrderSize(order) {
  if (!order || typeof order !== 'object') return null;

  const explicitRemaining = toOptionalNumber(order.remaining_size || order.remainingSize || order.remaining);
  if (explicitRemaining !== null) {
    return Math.max(0, explicitRemaining);
  }

  const original = toOptionalNumber(order.original_size || order.originalSize || order.size || order.amount);
  if (original === null) return null;
  const matched = toOptionalNumber(order.size_matched || order.sizeMatched || 0);
  if (matched === null) return Math.max(0, original);
  return Math.max(0, original - matched);
}

function pickFirstArray(values) {
  for (const candidate of values) {
    if (Array.isArray(candidate)) return candidate;
  }
  return null;
}

function pickFirstObject(values) {
  for (const candidate of values) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return candidate;
    }
  }
  return null;
}

function extractMockPositionData(payload) {
  if (!payload || typeof payload !== 'object') {
    return { balancesByToken: null, openOrders: null };
  }

  return {
    balancesByToken: pickFirstObject([
      payload.balances,
      payload.positionBalances,
      payload.data && payload.data.balances,
      payload.data && payload.data.positionBalances,
      payload.position && payload.position.balances,
    ]),
    openOrders: pickFirstArray([
      payload.openOrders,
      payload.orders,
      payload.data && payload.data.openOrders,
      payload.data && payload.data.orders,
      payload.position && payload.position.openOrders,
    ]),
  };
}

/**
 * Build a normalized Polymarket position summary.
 * Balances are token shares; prices are probabilities in `[0,1]`;
 * USD outputs are `openOrdersNotionalUsd` and `estimatedValueUsd`.
 * @param {object} [options]
 * @returns {{
 *   yesBalance: number|null,
 *   noBalance: number|null,
 *   openOrdersCount: number|null,
 *   openOrdersNotionalUsd: number|null,
 *   estimatedValueUsd: number|null,
 *   positionDeltaApprox: number|null,
 *   prices: { yes: number|null, no: number|null },
 *   diagnostics: string[]
 * }}
 */
function normalizePolymarketPositionSummary(options = {}) {
  const diagnostics = Array.isArray(options.diagnostics) ? [...options.diagnostics] : [];
  const marketId = toStringOrNull(options.marketId);
  const yesTokenId = toStringOrNull(options.yesTokenId);
  const noTokenId = toStringOrNull(options.noTokenId);
  const yesPrice = toPrice01(options.yesPrice);
  const noPriceInput = options.noPrice === undefined || options.noPrice === null ? null : options.noPrice;
  const noPriceFromYes = yesPrice !== null ? round(1 - yesPrice, 8) : null;
  const noPrice = noPriceInput === null ? noPriceFromYes : toPrice01(noPriceInput);
  const balancesByToken =
    options.balancesByToken && typeof options.balancesByToken === 'object' ? options.balancesByToken : null;
  const openOrders = Array.isArray(options.openOrders) ? options.openOrders : null;

  const readBalance = (tokenId, sideLabel) => {
    if (!tokenId) {
      diagnostics.push(`Missing ${sideLabel} token id; cannot query ${sideLabel} balance.`);
      return null;
    }
    if (!balancesByToken) {
      diagnostics.push(`${sideLabel} balance unavailable (no balance payload).`);
      return null;
    }

    const sideKey = sideLabel.toLowerCase();
    const rawValue = Object.prototype.hasOwnProperty.call(balancesByToken, tokenId)
      ? balancesByToken[tokenId]
      : balancesByToken[sideKey];
    const rawBalance = rawValue && typeof rawValue === 'object' && rawValue.balance !== undefined
      ? rawValue.balance
      : rawValue;
    const numeric = toOptionalNumber(rawBalance);
    if (numeric === null) {
      diagnostics.push(`${sideLabel} balance missing or invalid.`);
      return null;
    }
    return round(numeric, 6);
  };

  const yesBalance = readBalance(yesTokenId, 'YES');
  const noBalance = readBalance(noTokenId, 'NO');

  let scopedOrders = null;
  let openOrdersCount = null;
  let openOrdersNotionalUsd = null;
  if (openOrders) {
    const marketNeedle = normalizeText(marketId);
    const tokenNeedles = new Set(
      [yesTokenId, noTokenId]
        .map((tokenId) => normalizeText(tokenId))
        .filter(Boolean),
    );

    scopedOrders = openOrders.filter((order) => {
      if (!order || typeof order !== 'object') return false;
      if (!marketNeedle && !tokenNeedles.size) return true;
      const orderMarket = normalizeText(order.market || order.condition_id || order.conditionId);
      const orderAsset = normalizeText(order.asset_id || order.assetId || order.token_id || order.tokenId);
      const marketMatch = marketNeedle ? orderMarket === marketNeedle : false;
      const tokenMatch = tokenNeedles.size ? tokenNeedles.has(orderAsset) : false;
      return marketMatch || tokenMatch;
    });

    openOrdersCount = scopedOrders.length;
    if (scopedOrders.length) {
      let totalNotional = 0;
      let seenValidNotional = false;
      for (const order of scopedOrders) {
        const price = toOptionalNumber(order.price);
        const remainingSize = deriveRemainingOrderSize(order);
        if (price === null || remainingSize === null) continue;
        totalNotional += price * remainingSize;
        seenValidNotional = true;
      }
      if (seenValidNotional) {
        openOrdersNotionalUsd = round(totalNotional, 6);
      } else {
        diagnostics.push('Open orders notional unavailable (missing price/size fields).');
      }
    } else {
      openOrdersNotionalUsd = 0;
    }
  } else {
    diagnostics.push('Open orders unavailable (no orders payload).');
  }

  let estimatedValueUsd = null;
  let estimatedValueComponents = 0;
  let estimatedValueAccumulator = 0;

  if (yesBalance !== null && yesPrice !== null) {
    estimatedValueAccumulator += yesBalance * yesPrice;
    estimatedValueComponents += 1;
  }
  if (noBalance !== null && noPrice !== null) {
    estimatedValueAccumulator += noBalance * noPrice;
    estimatedValueComponents += 1;
  }

  if (estimatedValueComponents > 0) {
    estimatedValueUsd = round(estimatedValueAccumulator, 6);
    if (estimatedValueComponents < 2) {
      diagnostics.push('Estimated value uses partial YES/NO pricing coverage.');
    }
  } else {
    diagnostics.push('Estimated value unavailable (missing balances or prices).');
  }

  const positionDeltaApprox =
    yesBalance !== null && noBalance !== null ? round(yesBalance - noBalance, 6) : null;

  return {
    yesBalance,
    noBalance,
    openOrdersCount,
    openOrdersNotionalUsd,
    estimatedValueUsd,
    positionDeltaApprox,
    prices: {
      yes: yesPrice,
      no: noPrice,
    },
    diagnostics: dedupeDiagnostics(diagnostics),
  };
}

/**
 * Fetch/compose a position summary for a Polymarket market.
 * Accepts direct balances/orders, mock payloads, or authenticated API reads.
 * @param {object} [options]
 * @returns {Promise<ReturnType<typeof normalizePolymarketPositionSummary>>}
 */
async function fetchPolymarketPositionSummary(options = {}) {
  const market = options.market && typeof options.market === 'object' ? options.market : {};
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 12_000;
  const diagnostics = [];
  const baseSummary = {
    marketId: options.marketId || market.marketId || null,
    yesTokenId: options.yesTokenId || market.yesTokenId || null,
    noTokenId: options.noTokenId || market.noTokenId || null,
    yesPrice: options.yesPrice !== undefined ? options.yesPrice : market.yesPct,
    noPrice: options.noPrice !== undefined ? options.noPrice : market.noPct,
  };

  if (options.balancesByToken || Array.isArray(options.openOrders)) {
    return normalizePolymarketPositionSummary({
      ...baseSummary,
      balancesByToken: options.balancesByToken || null,
      openOrders: Array.isArray(options.openOrders) ? options.openOrders : null,
      diagnostics,
    });
  }

  if (options.mockUrl) {
    try {
      const payload = await fetchMockPayload(options.mockUrl, timeoutMs);
      const mockData = extractMockPositionData(payload);
      const summaryFromMock = normalizePolymarketPositionSummary({
        ...baseSummary,
        balancesByToken: mockData.balancesByToken,
        openOrders: mockData.openOrders,
        diagnostics: diagnostics.concat('Loaded Polymarket position summary from mock payload.'),
      });
      return summaryFromMock;
    } catch (err) {
      diagnostics.push(`Polymarket mock position fetch failed: ${formatNetworkError(err)}`);
    }
  }

  const envCreds = readTradingCredsFromEnv(options.env || process.env);
  if (!options.privateKey && envCreds.privateKeyInvalid) {
    diagnostics.push('POLYMARKET_PRIVATE_KEY is set but invalid (expected 0x + 64 hex chars).');
  }
  const privateKey = options.privateKey || envCreds.privateKey;
  const funder = options.funder || envCreds.funder;
  const apiKey = options.apiKey || envCreds.apiKey;
  const apiSecret = options.apiSecret || envCreds.apiSecret;
  const apiPassphrase = options.apiPassphrase || envCreds.apiPassphrase;
  const host = options.host || envCreds.host || DEFAULT_POLYMARKET_HOST;
  const chain = options.chain || DEFAULT_POLYMARKET_CHAIN;

  if (!privateKey) {
    diagnostics.push('POLYMARKET_PRIVATE_KEY not configured; skipping authenticated Polymarket position lookup.');
    return normalizePolymarketPositionSummary({
      ...baseSummary,
      balancesByToken: null,
      openOrders: null,
      diagnostics,
    });
  }

  let client = options.client || null;
  if (!client) {
    try {
      client = await buildTradingClient({
        host,
        chain,
        privateKey,
        funder,
        apiKey,
        apiSecret,
        apiPassphrase,
      });
    } catch (err) {
      diagnostics.push(`Unable to initialize Polymarket trading client: ${formatNetworkError(err)}`);
      return normalizePolymarketPositionSummary({
        ...baseSummary,
        balancesByToken: null,
        openOrders: null,
        diagnostics,
      });
    }
  }

  const balancesByToken = {};
  const fetchBalance = async (tokenId, sideLabel) => {
    if (!tokenId) return;
    try {
      const response = await callWithTimeout(
        (_signal) =>
          client.getBalanceAllowance({
            asset_type: AssetType.CONDITIONAL,
            token_id: tokenId,
          }),
        timeoutMs,
        `Polymarket getBalanceAllowance(${tokenId})`,
      );
      if (responseContainsError(response)) {
        diagnostics.push(
          `${sideLabel} balance lookup failed: ${response && response.error ? response.error : `HTTP ${response && response.status ? response.status : 'error'}`}.`,
        );
        return;
      }
      if (response && response.balance !== undefined) {
        balancesByToken[tokenId] = response.balance;
      } else {
        diagnostics.push(`${sideLabel} balance response missing balance field.`);
      }
    } catch (err) {
      diagnostics.push(`${sideLabel} balance lookup failed: ${formatNetworkError(err)}`);
    }
  };

  await Promise.all([
    fetchBalance(baseSummary.yesTokenId, 'YES'),
    fetchBalance(baseSummary.noTokenId, 'NO'),
  ]);

  let openOrders = null;
  try {
    if (baseSummary.marketId) {
      openOrders = await callWithTimeout(
        (_signal) => client.getOpenOrders({ market: baseSummary.marketId }),
        timeoutMs,
        `Polymarket getOpenOrders(market:${baseSummary.marketId})`,
      );
    } else {
      const grouped = [];
      if (baseSummary.yesTokenId) {
        grouped.push(
          await callWithTimeout(
            (_signal) => client.getOpenOrders({ asset_id: baseSummary.yesTokenId }),
            timeoutMs,
            `Polymarket getOpenOrders(asset:${baseSummary.yesTokenId})`,
          ),
        );
      }
      if (baseSummary.noTokenId && baseSummary.noTokenId !== baseSummary.yesTokenId) {
        grouped.push(
          await callWithTimeout(
            (_signal) => client.getOpenOrders({ asset_id: baseSummary.noTokenId }),
            timeoutMs,
            `Polymarket getOpenOrders(asset:${baseSummary.noTokenId})`,
          ),
        );
      }
      const dedup = new Map();
      for (const group of grouped) {
        for (const order of Array.isArray(group) ? group : []) {
          const key = String(
            order && (order.id || `${order.asset_id || ''}-${order.price || ''}-${order.original_size || ''}-${order.created_at || ''}`),
          );
          dedup.set(key, order);
        }
      }
      openOrders = Array.from(dedup.values());
    }
  } catch (err) {
    diagnostics.push(`Open orders lookup failed: ${formatNetworkError(err)}`);
  }

  return normalizePolymarketPositionSummary({
    ...baseSummary,
    balancesByToken,
    openOrders,
    diagnostics,
  });
}

async function buildTradingClient(options = {}) {
  const host = options.host || DEFAULT_POLYMARKET_HOST;
  const chain = options.chain || DEFAULT_POLYMARKET_CHAIN;
  const signatureType = resolveSignatureType(options);
  const cacheKey = buildTradingCacheKey(host, chain, options);
  const allowCache = options.disableCache !== true;
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 12_000;
  const ClobCtor = options.clobClientClass || ClobClient;

  if (allowCache && tradingClientCache.has(cacheKey)) {
    return tradingClientCache.get(cacheKey);
  }

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
    if (allowCache && derivedCredsCache.has(cacheKey)) {
      creds = derivedCredsCache.get(cacheKey);
    } else {
      const bootstrap = new ClobCtor(
        host,
        chain,
        signer,
        undefined,
        signatureType,
        options.funder || undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
      );
      if (typeof bootstrap.deriveApiKey === 'function') {
        try {
          // deriveApiKey expects nonce, not signature type; default to nonce 0.
          creds = await callWithTimeout(
            () => bootstrap.deriveApiKey(0),
            timeoutMs,
            'Polymarket deriveApiKey(0)',
          );
        } catch (err) {
          if (err && typeof err.message === 'string' && err.message.includes('timed out')) {
            throw err;
          }
          creds = await callWithTimeout(
            () => bootstrap.deriveApiKey(),
            timeoutMs,
            'Polymarket deriveApiKey()',
          );
        }
      } else if (typeof bootstrap.createOrDeriveApiKey === 'function') {
        creds = await callWithTimeout(
          () => bootstrap.createOrDeriveApiKey(),
          timeoutMs,
          'Polymarket createOrDeriveApiKey()',
        );
      } else {
        throw new Error('CLOB client does not support API key derivation.');
      }
      if (allowCache && creds) {
        derivedCredsCache.set(cacheKey, creds);
      }
    }
  }

  const client = new ClobCtor(
    host,
    chain,
    signer,
    creds,
    signatureType,
    options.funder || undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true,
  );
  if (allowCache) {
    tradingClientCache.set(cacheKey, client);
  }
  return client;
}

function resolveOrderSide(side) {
  const normalized = normalizeText(side);
  if (normalized === 'buy') return Side.BUY;
  if (normalized === 'sell') return Side.SELL;
  throw new Error(`Unsupported order side: ${side}`);
}

/**
 * Place a Polymarket FAK hedge order.
 * `amountUsd` is decimal USD notional (not USDC raw units).
 * @param {object} [options]
 * @returns {Promise<{
 *   mode: 'mock'|'live',
 *   ok: boolean,
 *   orderType: 'FAK',
 *   tokenId: string,
 *   side: string,
 *   amountUsd: number,
 *   response: any,
 *   error?: { code: string|null, message: string, details?: any }|null
 * }>}
 */
async function placeHedgeOrder(options = {}) {
  if (options.mockUrl) {
    return {
      mode: 'mock',
      ok: true,
      orderType: 'FAK',
      tokenId: options.tokenId,
      side: String(options.side || '').toUpperCase(),
      amountUsd: round(toOptionalNumber(options.amountUsd) || 0, 6),
      response: {
        status: 'simulated',
      },
    };
  }

  const tokenId = String(options.tokenId || '').trim();
  if (!tokenId) {
    throw new Error('Missing tokenId for Polymarket hedge order.');
  }

  const amountUsd = toOptionalNumber(options.amountUsd);
  if (amountUsd === null || amountUsd <= 0) {
    throw new Error('amountUsd must be a positive number for hedge execution.');
  }

  const host = options.host || DEFAULT_POLYMARKET_HOST;
  const chain = options.chain || DEFAULT_POLYMARKET_CHAIN;
  const cacheKey = buildTradingCacheKey(host, chain, options);
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 12_000;
  const client = options.client || (await buildTradingClient(options));
  const side = resolveOrderSide(options.side || 'buy');
  try {
    const tickSize =
      options.tickSize ||
      (await callWithTimeout(
        () => client.getTickSize(tokenId),
        timeoutMs,
        `Polymarket getTickSize(${tokenId})`,
      ));
    const negRisk =
      typeof options.negRisk === 'boolean'
        ? options.negRisk
        : await callWithTimeout(
            () => client.getNegRisk(tokenId),
            timeoutMs,
            `Polymarket getNegRisk(${tokenId})`,
          );

    const response = await callWithTimeout(
      () =>
        client.createAndPostMarketOrder(
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
        ),
      timeoutMs,
      `Polymarket createAndPostMarketOrder(${tokenId})`,
    );
    const ok = responseIndicatesSuccess(response);
    if (!ok && classifyAuthFailure(response)) {
      clearCachedTradingClient(cacheKey);
    }
    return {
      mode: 'live',
      ok,
      orderType: 'FAK',
      tokenId,
      side,
      amountUsd: round(amountUsd, 6),
      response,
      error: ok ? null : { message: 'Polymarket order rejected.', details: response },
    };
  } catch (err) {
    if (classifyAuthFailure(err)) {
      clearCachedTradingClient(cacheKey);
    }
    return {
      mode: 'live',
      ok: false,
      orderType: 'FAK',
      tokenId,
      side,
      amountUsd: round(amountUsd, 6),
      response: null,
      error: {
        code: err && err.code ? String(err.code) : null,
        message: err && err.message ? String(err.message) : String(err),
      },
    };
  }
}

/** Public adapter API used by CLI mirror/polymarket command handlers. */
module.exports = {
  DEFAULT_POLYMARKET_HOST,
  DEFAULT_POLYMARKET_GAMMA_URL,
  readTradingCredsFromEnv,
  resolvePolymarketMarket,
  browsePolymarketMarkets,
  fetchDepthForMarket,
  calculateExecutableDepthUsd,
  placeHedgeOrder,
  normalizePolymarketPositionSummary,
  fetchPolymarketPositionSummary,
};
