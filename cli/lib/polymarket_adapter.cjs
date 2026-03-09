const { ClobClient, Chain } = require('@polymarket/clob-client');
const WebSocket = require('ws');
const { toNumber } = require('./shared/utils.cjs');

const DEFAULT_POLYMARKET_HOST = 'https://clob.polymarket.com';
const DEFAULT_POLYMARKET_GAMMA_HOST = 'https://gamma-api.polymarket.com';
const DEFAULT_POLYMARKET_MARKET_FEED_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const DEFAULT_POLYMARKET_SOURCE_MAX_AGE_MS = 60_000;

function toStringOrNull(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
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

function toTimestampMs(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.abs(value) < 1e11 ? Math.trunc(value * 1000) : Math.trunc(value);
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.abs(numeric) < 1e11 ? Math.trunc(numeric * 1000) : Math.trunc(numeric);
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoTimestamp(value) {
  const timestampMs = toTimestampMs(value);
  return timestampMs === null ? null : new Date(timestampMs).toISOString();
}

function resolvePolymarketTransport(source) {
  const normalized = String(source || '').trim().toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized === 'polymarket:feed' || normalized === 'polymarket:live-feed') return 'stream';
  if (normalized === 'polymarket:cache') return 'cache';
  if (normalized === 'polymarket:mock') return 'mock';
  if (normalized.startsWith('polymarket:gamma') || normalized.startsWith('polymarket:clob')) return 'poll';
  return 'unknown';
}

function buildPolymarketSourceFreshness(options = {}) {
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const observedAt =
    toIsoTimestamp(options.observedAt)
    || toIsoTimestamp(options.feedObservedAt)
    || toIsoTimestamp(options.polledAt)
    || toIsoTimestamp(options.requestedAt);
  const observedAtMs = toTimestampMs(observedAt);
  const ageMs = observedAtMs === null ? null : Math.max(0, Math.trunc(nowMs - observedAtMs));
  const maxAgeMs = Number.isFinite(Number(options.maxAgeMs)) && Number(options.maxAgeMs) > 0
    ? Math.trunc(Number(options.maxAgeMs))
    : DEFAULT_POLYMARKET_SOURCE_MAX_AGE_MS;
  const transport =
    options.transport
    || resolvePolymarketTransport(options.source || options.sourceType || options.baselineSource);
  const realtimeCapable = options.realtimeCapable !== undefined
    ? Boolean(options.realtimeCapable)
    : transport === 'stream' || transport === 'poll';
  const usedLivePrices = Boolean(options.usedLivePrices);
  const complete = options.complete !== undefined ? Boolean(options.complete) : null;
  return {
    sourceType: options.source || options.sourceType || null,
    baselineSource: options.baselineSource || null,
    transport,
    requestedAt: toIsoTimestamp(options.requestedAt),
    polledAt: toIsoTimestamp(options.polledAt),
    observedAt,
    feedConnectedAt: toIsoTimestamp(options.feedConnectedAt),
    feedClosedAt: toIsoTimestamp(options.feedClosedAt),
    ageMs,
    maxAgeMs,
    fresh: ageMs === null ? null : ageMs <= maxAgeMs,
    realtimeCapable,
    realtimeConnected: Boolean(options.feedConnectedAt),
    usedLivePrices,
    partial: Boolean(options.partial),
    complete,
    diagnostics: Array.isArray(options.diagnostics) ? [...options.diagnostics] : [],
  };
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

function resolveBinaryTokens(tokens) {
  if (!Array.isArray(tokens) || !tokens.length) {
    return {
      yesToken: null,
      noToken: null,
      diagnostics: ['No token prices available from Polymarket market payload.'],
    };
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
      return { yesToken: null, noToken: null, diagnostics };
    }
  }

  return {
    yesToken: yes,
    noToken: no,
    diagnostics,
  };
}

function normalizeTokens(tokens) {
  const binary = resolveBinaryTokens(tokens);
  const yes = binary.yesToken;
  const no = binary.noToken;
  const diagnostics = [...binary.diagnostics];
  if (!yes || !no) {
    return {
      yes: null,
      no: null,
      yesTokenId: null,
      noTokenId: null,
      diagnostics,
    };
  }

  const yesPrice = toNumber(yes && yes.price);
  const noPrice = toNumber(no && no.price);
  if (yesPrice === null || noPrice === null) {
    diagnostics.push('Missing token prices for yes/no mapping.');
    return {
      yes: null,
      no: null,
      yesTokenId: toStringOrNull(yes && (yes.token_id || yes.tokenId || yes.asset_id || yes.assetId)),
      noTokenId: toStringOrNull(no && (no.token_id || no.tokenId || no.asset_id || no.assetId)),
      diagnostics,
    };
  }

  const total = yesPrice + noPrice;
  if (!Number.isFinite(total) || total <= 0) {
    diagnostics.push('Invalid yes/no token total for probability normalization.');
    return {
      yes: null,
      no: null,
      yesTokenId: toStringOrNull(yes && (yes.token_id || yes.tokenId || yes.asset_id || yes.assetId)),
      noTokenId: toStringOrNull(no && (no.token_id || no.tokenId || no.asset_id || no.assetId)),
      diagnostics,
    };
  }

  return {
    yes: (yesPrice / total) * 100,
    no: (noPrice / total) * 100,
    yesTokenId: toStringOrNull(yes && (yes.token_id || yes.tokenId || yes.asset_id || yes.assetId)),
    noTokenId: toStringOrNull(no && (no.token_id || no.tokenId || no.asset_id || no.assetId)),
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
  const tokenIds =
    safeParseJsonArray(row && row.clobTokenIds) ||
    safeParseJsonArray(row && row.clob_token_ids) ||
    safeParseJsonArray(row && row.asset_ids) ||
    safeParseJsonArray(row && row.assets_ids) ||
    [];
  const tokens = [];
  for (let index = 0; index < outcomes.length; index += 1) {
    tokens.push({
      outcome: String(outcomes[index] || ''),
      price: prices[index],
      token_id: tokenIds[index] || null,
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
    oddsSource: row && row.__oddsSource ? row.__oddsSource : 'polymarket:gamma-markets',
    diagnostics: mapped.diagnostics.concat(Array.isArray(row && row.__feedDiagnostics) ? row.__feedDiagnostics : []),
    rules: row && row.description ? String(row.description) : null,
    sources: [],
    pollStatus: row && row.__pollStatus ? row.__pollStatus : null,
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
    oddsSource: row && row.__oddsSource ? row.__oddsSource : 'polymarket:clob-markets',
    diagnostics: mapped.diagnostics.concat(Array.isArray(row && row.__feedDiagnostics) ? row.__feedDiagnostics : []),
    rules: row.description ? String(row.description) : null,
    sources: [],
    pollStatus: row && row.__pollStatus ? row.__pollStatus : null,
  };
}

function buildTokensForFeed(row) {
  const explicitTokens = Array.isArray(row && row.tokens) ? row.tokens : null;
  if (explicitTokens && explicitTokens.length) {
    return explicitTokens.map((token) => ({
      ...token,
      outcome: String(token && token.outcome ? token.outcome : ''),
      token_id: toStringOrNull(token && (token.token_id || token.tokenId || token.asset_id || token.assetId)),
    }));
  }

  return buildTokensFromGammaPayload(row) || [];
}

function normalizeProbabilityPrice(value) {
  const numeric = toNumber(value);
  if (numeric === null) return null;
  if (numeric < 0 || numeric > 1) return null;
  return numeric;
}

function midpointPrice(bestBid, bestAsk) {
  const bid = normalizeProbabilityPrice(bestBid);
  const ask = normalizeProbabilityPrice(bestAsk);
  if (bid !== null && ask !== null) return (bid + ask) / 2;
  if (ask !== null) return ask;
  if (bid !== null) return bid;
  return null;
}

function getOrderbookBestPrices(book) {
  if (!book || typeof book !== 'object') return { bestBid: null, bestAsk: null };
  const bids = Array.isArray(book.bids) ? book.bids : Array.isArray(book.buys) ? book.buys : [];
  const asks = Array.isArray(book.asks) ? book.asks : Array.isArray(book.sells) ? book.sells : [];
  const bestBid = bids.length ? bids.map((entry) => toNumber(entry && entry.price)).filter((value) => value !== null).sort((a, b) => b - a)[0] : null;
  const bestAsk = asks.length ? asks.map((entry) => toNumber(entry && entry.price)).filter((value) => value !== null).sort((a, b) => a - b)[0] : null;
  return { bestBid, bestAsk };
}

function parseFeedMessage(data) {
  if (data === null || data === undefined) return null;
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (Buffer.isBuffer(data)) {
    try {
      return JSON.parse(data.toString('utf8'));
    } catch {
      return null;
    }
  }
  return typeof data === 'object' ? data : null;
}

function maybeStoreFeedPrice(targetMap, assetId, value) {
  const normalizedAssetId = toStringOrNull(assetId);
  const normalizedValue = normalizeProbabilityPrice(value);
  if (!normalizedAssetId || normalizedValue === null) return false;
  targetMap.set(normalizedAssetId, normalizedValue);
  return true;
}

function applyFeedPriceMessage(targetMap, message) {
  const payload = parseFeedMessage(message);
  if (!payload || typeof payload !== 'object') return 0;

  let applied = 0;

  if (Array.isArray(payload.price_changes)) {
    for (const entry of payload.price_changes) {
      const livePrice = midpointPrice(entry && entry.best_bid, entry && entry.best_ask);
      if (maybeStoreFeedPrice(targetMap, entry && (entry.asset_id || entry.assetId), livePrice === null ? entry && entry.price : livePrice)) {
        applied += 1;
      }
    }
  }

  const messageType = String(payload.type || '').trim().toLowerCase();
  if (messageType === 'price_change') {
    if (maybeStoreFeedPrice(targetMap, payload.asset_id || payload.assetId, midpointPrice(payload.best_bid, payload.best_ask) ?? payload.price)) {
      applied += 1;
    }
  }

  if (messageType === 'best_bid_ask') {
    if (maybeStoreFeedPrice(targetMap, payload.asset_id || payload.assetId, midpointPrice(payload.best_bid, payload.best_ask))) {
      applied += 1;
    }
  }

  if (messageType === 'last_trade_price') {
    if (maybeStoreFeedPrice(targetMap, payload.asset_id || payload.assetId, payload.price || payload.last_trade_price)) {
      applied += 1;
    }
  }

  if (messageType === 'book') {
    const best = getOrderbookBestPrices(payload);
    if (maybeStoreFeedPrice(targetMap, payload.asset_id || payload.assetId, midpointPrice(best.bestBid, best.bestAsk))) {
      applied += 1;
    }
  }

  return applied;
}

function buildFeedRowTargets(rows, limit) {
  const targets = [];
  for (const row of rows.slice(0, limit)) {
    const tokens = buildTokensForFeed(row);
    const binary = resolveBinaryTokens(tokens);
    const yesTokenId = toStringOrNull(binary.yesToken && (binary.yesToken.token_id || binary.yesToken.tokenId || binary.yesToken.asset_id || binary.yesToken.assetId));
    const noTokenId = toStringOrNull(binary.noToken && (binary.noToken.token_id || binary.noToken.tokenId || binary.noToken.asset_id || binary.noToken.assetId));
    if (!yesTokenId || !noTokenId) continue;
    targets.push({
      row,
      tokens,
      yesTokenId,
      noTokenId,
    });
  }
  return targets;
}

function subscribePolymarketMarketFeed(options = {}) {
  const {
    feedUrl = DEFAULT_POLYMARKET_MARKET_FEED_URL,
    assetIds = [],
    webSocketFactory,
    onPrice,
    onStatus,
  } = options;
  const uniqueAssetIds = Array.from(new Set(assetIds.map((assetId) => toStringOrNull(assetId)).filter(Boolean)));
  const createSocket =
    typeof webSocketFactory === 'function'
      ? webSocketFactory
      : (url) => new WebSocket(url);
  const priceByAssetId = new Map();
  const diagnostics = [];
  const state = {
    feedUrl,
    assetIds: uniqueAssetIds,
    connectedAt: null,
    observedAt: null,
    closedAt: null,
    lastError: null,
  };
  let socket = null;
  let readyResolved = false;
  let readyResolve;
  const ready = new Promise((resolve) => {
    readyResolve = resolve;
  });

  const snapshot = () => ({
    feedUrl,
    assetIds: [...uniqueAssetIds],
    connectedAt: state.connectedAt,
    observedAt: state.observedAt,
    closedAt: state.closedAt,
    lastError: state.lastError,
    diagnostics: [...diagnostics],
    priceByAssetId: new Map(priceByAssetId),
  });

  const emitStatus = (event, extra = {}) => {
    if (typeof onStatus !== 'function') return;
    onStatus({
      event,
      ...snapshot(),
      ...extra,
    });
  };

  const resolveReady = () => {
    if (readyResolved) return;
    readyResolved = true;
    readyResolve(snapshot());
  };

  const close = () => {
    if (socket && typeof socket.removeAllListeners === 'function') {
      socket.removeAllListeners();
    }
    if (socket && typeof socket.close === 'function') {
      try {
        socket.close();
      } catch {
        // ignore best-effort close errors
      }
    }
    socket = null;
    if (!state.closedAt) {
      state.closedAt = new Date().toISOString();
    }
    emitStatus('close');
    resolveReady();
  };

  if (!uniqueAssetIds.length) {
    diagnostics.push('Polymarket live feed skipped: no token ids available for subscription.');
    state.closedAt = new Date().toISOString();
    resolveReady();
    return {
      close,
      ready,
      getSnapshot: snapshot,
    };
  }

  try {
    socket = createSocket(feedUrl);
  } catch (err) {
    diagnostics.push(`Polymarket live feed connection failed: ${err && err.message ? err.message : String(err)}`);
    state.lastError = diagnostics[diagnostics.length - 1];
    state.closedAt = new Date().toISOString();
    resolveReady();
    return {
      close,
      ready,
      getSnapshot: snapshot,
    };
  }

  socket.on('open', () => {
    state.connectedAt = new Date().toISOString();
    try {
      socket.send(JSON.stringify({
        type: 'market',
        asset_ids: uniqueAssetIds,
      }));
    } catch (err) {
      diagnostics.push(`Polymarket live feed subscribe failed: ${err && err.message ? err.message : String(err)}`);
      state.lastError = diagnostics[diagnostics.length - 1];
      close();
      return;
    }
    emitStatus('open');
    resolveReady();
  });

  socket.on('message', (message) => {
    const applied = applyFeedPriceMessage(priceByAssetId, message);
    if (!applied) return;
    state.observedAt = new Date().toISOString();
    const payload = {
      observedAt: state.observedAt,
      applied,
      priceByAssetId: new Map(priceByAssetId),
    };
    emitStatus('price', payload);
    if (typeof onPrice === 'function') {
      onPrice(payload);
    }
  });

  socket.on('error', (err) => {
    const message = `Polymarket live feed error: ${err && err.message ? err.message : String(err)}`;
    diagnostics.push(message);
    state.lastError = message;
    emitStatus('error', { error: message });
    if (!state.connectedAt) {
      resolveReady();
    }
  });

  socket.on('close', () => {
    state.closedAt = new Date().toISOString();
    emitStatus('close');
    resolveReady();
  });

  return {
    close,
    ready,
    getSnapshot: snapshot,
  };
}

async function collectMarketFeedPrices(options = {}) {
  const {
    feedUrl = DEFAULT_POLYMARKET_MARKET_FEED_URL,
    assetIds = [],
    timeoutMs = 1_500,
    webSocketFactory,
  } = options;

  if (!assetIds.length) {
    return {
      priceByAssetId: new Map(),
      diagnostics: ['Polymarket live feed skipped: no token ids available for subscription.'],
      connectedAt: null,
      observedAt: null,
      closedAt: new Date().toISOString(),
      complete: false,
    };
  }

  const diagnostics = [];
  const uniqueAssetIds = Array.from(new Set(assetIds.map((assetId) => toStringOrNull(assetId)).filter(Boolean)));

  return new Promise((resolve) => {
    let settled = false;
    const finalize = (extraDiagnostics = []) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription.close();
      const snapshot = subscription.getSnapshot();
      resolve({
        priceByAssetId: snapshot.priceByAssetId,
        diagnostics: snapshot.diagnostics.concat(diagnostics, extraDiagnostics),
        connectedAt: snapshot.connectedAt,
        observedAt: snapshot.observedAt,
        closedAt: snapshot.closedAt,
        complete: snapshot.priceByAssetId.size >= uniqueAssetIds.length,
      });
    };

    const timer = setTimeout(() => {
      const snapshot = subscription.getSnapshot();
      finalize(
        snapshot.priceByAssetId.size
          ? [`Polymarket live feed timed out after ${timeoutMs}ms; using available live prices and falling back to polled prices for the rest.`]
          : [`Polymarket live feed timed out after ${timeoutMs}ms; falling back to polled prices.`],
      );
    }, timeoutMs);

    const subscription = subscribePolymarketMarketFeed({
      feedUrl,
      assetIds: uniqueAssetIds,
      webSocketFactory,
      onPrice: ({ priceByAssetId }) => {
        if (priceByAssetId.size >= uniqueAssetIds.length) {
          finalize(['Polymarket live feed supplied live YES/NO prices before polling fallback was needed.']);
        }
      },
      onStatus: ({ event, lastError, diagnostics: statusDiagnostics, priceByAssetId }) => {
        if (event === 'error' && lastError) {
          diagnostics.push(lastError);
          if (!priceByAssetId.size) {
            finalize(['Polymarket live feed unavailable; falling back to polled prices.']);
          }
        }
        if (event === 'close' && !settled) {
          const extra = statusDiagnostics.filter((item) => !diagnostics.includes(item));
          diagnostics.push(...extra);
          const message = priceByAssetId.size
            ? 'Polymarket live feed closed before all markets updated; using available live prices and polled fallbacks.'
            : 'Polymarket live feed closed before usable prices arrived; falling back to polled prices.';
          finalize([message]);
        }
      },
    });

    subscription.ready.then((readyState) => {
      const readyDiagnostics = Array.isArray(readyState && readyState.diagnostics) ? readyState.diagnostics : [];
      diagnostics.push(...readyDiagnostics.filter((item) => !diagnostics.includes(item)));
      if (!readyState.connectedAt && readyState.lastError) {
        finalize([readyState.lastError]);
      }
      if (!readyState.connectedAt && readyState.closedAt && !settled) {
        const message = readyState.priceByAssetId.size
          ? 'Polymarket live feed closed before all markets updated; using available live prices and polled fallbacks.'
          : 'Polymarket live feed unavailable; falling back to polled prices.';
        finalize([message]);
      }
    });
  });
}

function patchRowsWithFeedPrices(rows, targets, priceByAssetId, feedMeta = {}) {
  if (!(priceByAssetId instanceof Map) || !priceByAssetId.size) {
    return { rows, appliedCount: 0, partialCount: 0 };
  }

  const replacementByRow = new Map();
  let appliedCount = 0;
  let partialCount = 0;

  for (const target of targets) {
    const yesPrice = priceByAssetId.get(target.yesTokenId);
    const noPrice = priceByAssetId.get(target.noTokenId);
    if (yesPrice === undefined || noPrice === undefined) {
      if (yesPrice !== undefined || noPrice !== undefined) {
        partialCount += 1;
      }
      continue;
    }

    const patchedTokens = target.tokens.map((token) => {
      const tokenId = toStringOrNull(token && (token.token_id || token.tokenId || token.asset_id || token.assetId));
      if (tokenId === target.yesTokenId) {
        return { ...token, price: String(yesPrice) };
      }
      if (tokenId === target.noTokenId) {
        return { ...token, price: String(noPrice) };
      }
      return token;
    });

    replacementByRow.set(target.row, {
      ...target.row,
      tokens: patchedTokens,
      __oddsSource: 'polymarket:live-feed',
      __pollStatus: 'feed',
      __sourceObservedAt: toIsoTimestamp(feedMeta.observedAt),
      __sourcePolledAt: toIsoTimestamp(feedMeta.polledAt),
      __sourceRequestedAt: toIsoTimestamp(feedMeta.requestedAt),
      __sourceFeedConnectedAt: toIsoTimestamp(feedMeta.connectedAt),
      __sourceFeedClosedAt: toIsoTimestamp(feedMeta.closedAt),
      __usedLivePrices: true,
      __feedDiagnostics: ['Polymarket prices refreshed from the market websocket.'],
    });
    appliedCount += 1;
  }

  if (!replacementByRow.size) {
    return { rows, appliedCount, partialCount };
  }

  return {
    rows: rows.map((row) => replacementByRow.get(row) || row),
    appliedCount,
    partialCount,
  };
}

async function overlayLiveFeedPrices(rows, options = {}, diagnostics = []) {
  if (options.disableLiveFeed === true) {
    return { rows, source: null };
  }

  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 100;
  const targets = buildFeedRowTargets(rows, limit);
  if (!targets.length) {
    diagnostics.push('Polymarket live feed skipped: selected markets did not expose websocket token ids.');
    return { rows, source: null };
  }

  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 12_000;
  const feedTimeoutMs =
    Number.isInteger(options.feedTimeoutMs) && options.feedTimeoutMs > 0
      ? options.feedTimeoutMs
      : Math.max(500, Math.min(2_500, Math.floor(timeoutMs / 4)));
  const feedResult = await collectMarketFeedPrices({
    feedUrl: options.feedUrl || process.env.POLYMARKET_MARKET_FEED_URL || DEFAULT_POLYMARKET_MARKET_FEED_URL,
    assetIds: targets.flatMap((target) => [target.yesTokenId, target.noTokenId]),
    timeoutMs: feedTimeoutMs,
    webSocketFactory: options.webSocketFactory,
  });
  diagnostics.push(...feedResult.diagnostics);

  const patched = patchRowsWithFeedPrices(rows, targets, feedResult.priceByAssetId, {
    connectedAt: feedResult.connectedAt,
    observedAt: feedResult.observedAt,
    closedAt: feedResult.closedAt,
    polledAt: options.polledAt,
    requestedAt: options.requestedAt,
  });
  if (!patched.appliedCount) {
    diagnostics.push('Polymarket live feed produced no complete YES/NO pairs; keeping polled prices.');
    return { rows, source: null, feedResult };
  }

  if (patched.partialCount) {
    diagnostics.push(
      `Polymarket live feed updated ${patched.appliedCount} market(s); ${patched.partialCount} market(s) kept polled prices because only a partial token pair arrived.`,
    );
  } else {
    diagnostics.push(`Polymarket live feed updated ${patched.appliedCount} market(s) before polling fallback was needed.`);
  }

  return {
    rows: patched.rows,
    source: 'polymarket:feed',
    feedResult,
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

function decorateMappedPolymarketItem(item, row, context = {}) {
  const sourceType = row && row.__oddsSource ? row.__oddsSource : context.source;
  const observedAt =
    (row && row.__sourceObservedAt)
    || (context.feedResult && context.feedResult.observedAt)
    || context.polledAt
    || context.requestedAt;
  const sourceFreshness = buildPolymarketSourceFreshness({
    source: sourceType || context.source,
    baselineSource: context.baselineSource || context.source,
    requestedAt: (row && row.__sourceRequestedAt) || context.requestedAt,
    polledAt: (row && row.__sourcePolledAt) || context.polledAt,
    observedAt,
    feedConnectedAt: (row && row.__sourceFeedConnectedAt) || (context.feedResult && context.feedResult.connectedAt),
    feedClosedAt: (row && row.__sourceFeedClosedAt) || (context.feedResult && context.feedResult.closedAt),
    usedLivePrices: Boolean(row && row.__usedLivePrices),
    partial: Boolean(row && row.__partialLivePair),
    maxAgeMs: context.maxAgeMs,
    diagnostics: Array.isArray(row && row.__feedDiagnostics) ? row.__feedDiagnostics : [],
    complete: Boolean(row && row.__usedLivePrices),
  });

  return {
    ...item,
    sourceFreshness,
  };
}

async function fetchPolymarketMarkets(options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 100;
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 12_000;
  const diagnostics = [];
  const requestedAt = new Date().toISOString();
  let rows = [];
  let source = 'polymarket:clob';
  let baselineSource = 'polymarket:clob';
  let host = options.host || DEFAULT_POLYMARKET_HOST;
  let polledAt = null;
  let feedResult = null;
  const maxAgeMs = Number.isFinite(Number(options.maxAgeMs)) && Number(options.maxAgeMs) > 0
    ? Math.trunc(Number(options.maxAgeMs))
    : DEFAULT_POLYMARKET_SOURCE_MAX_AGE_MS;

  if (options.mockUrl) {
    rows = await fetchMockPolymarketMarkets(options.mockUrl, timeoutMs);
    source = 'polymarket:mock';
    polledAt = new Date().toISOString();
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
        baselineSource = 'polymarket:gamma';
        host = gammaResult.host;
      }
      if (rows.length) {
        polledAt = new Date().toISOString();
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
      baselineSource = 'polymarket:clob';
      host = clob.host;
      if (rows.length) {
        polledAt = new Date().toISOString();
      }
    }

    if (rows.length) {
      const overlay = await overlayLiveFeedPrices(rows, { ...options, limit, timeoutMs, requestedAt, polledAt }, diagnostics);
      rows = overlay.rows;
      feedResult = overlay.feedResult || null;
      if (overlay.source) {
        source = overlay.source;
      }
    }
  }

  const mapper =
    source === 'polymarket:gamma' || (source === 'polymarket:feed' && baselineSource === 'polymarket:gamma')
      ? mapGammaRow
      : mapPolymarketRow;
  const mapped = rows.slice(0, limit).map((row) => decorateMappedPolymarketItem(mapper(row), row, {
    source,
    baselineSource,
    requestedAt,
    polledAt,
    feedResult,
    maxAgeMs,
  }));
  const sourceFreshness = buildPolymarketSourceFreshness({
    source,
    baselineSource,
    requestedAt,
    polledAt,
    observedAt: feedResult && feedResult.observedAt ? feedResult.observedAt : polledAt,
    feedConnectedAt: feedResult && feedResult.connectedAt ? feedResult.connectedAt : null,
    feedClosedAt: feedResult && feedResult.closedAt ? feedResult.closedAt : null,
    usedLivePrices: source === 'polymarket:feed',
    maxAgeMs,
    diagnostics,
    complete: feedResult ? Boolean(feedResult.complete) : null,
  });
  return {
    host,
    source,
    count: mapped.length,
    items: mapped,
    sourceFreshness,
    subscription: {
      supported: true,
      feedUrl: options.feedUrl || process.env.POLYMARKET_MARKET_FEED_URL || DEFAULT_POLYMARKET_MARKET_FEED_URL,
      attempted: options.mockUrl ? false : options.disableLiveFeed !== true,
      connected: Boolean(feedResult && feedResult.connectedAt),
      observedAt: feedResult && feedResult.observedAt ? feedResult.observedAt : null,
      timeoutMs:
        Number.isInteger(options.feedTimeoutMs) && options.feedTimeoutMs > 0
          ? options.feedTimeoutMs
          : Math.max(500, Math.min(2_500, Math.floor(timeoutMs / 4))),
    },
    diagnostics,
  };
}

module.exports = {
  DEFAULT_POLYMARKET_HOST,
  DEFAULT_POLYMARKET_GAMMA_HOST,
  DEFAULT_POLYMARKET_MARKET_FEED_URL,
  DEFAULT_POLYMARKET_SOURCE_MAX_AGE_MS,
  resolvePolymarketTransport,
  buildPolymarketSourceFreshness,
  subscribePolymarketMarketFeed,
  fetchPolymarketMarkets,
};
