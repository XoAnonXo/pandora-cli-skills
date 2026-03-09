function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function round(value, digits = 6) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return null;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function appendDiagnostic(list, message) {
  if (!Array.isArray(list)) return;
  const text = String(message || '').trim();
  if (!text) return;
  list.push(text);
}

function buildEmptyPreview(diagnostics = []) {
  return {
    estimatedGasUsd: null,
    slippagePct: null,
    priceImpact: null,
    netDeltaChange: null,
    diagnostics,
  };
}

function firstFinite(candidates) {
  for (const candidate of candidates) {
    const numeric = toFiniteNumber(candidate);
    if (numeric !== null) return numeric;
  }
  return null;
}

function firstObject(objects) {
  for (const value of objects) {
    if (value && typeof value === 'object') {
      return value;
    }
  }
  return null;
}

function normalizeOrderbookEntries(entries, orderDirection) {
  if (!Array.isArray(entries)) return [];
  const mapped = entries
    .map((row) => ({
      price: toFiniteNumber(row && row.price),
      size: toFiniteNumber(row && row.size),
    }))
    .filter((row) => row.price !== null && row.price > 0 && row.size !== null && row.size > 0);
  mapped.sort((left, right) => (orderDirection === 'asc' ? left.price - right.price : right.price - left.price));
  return mapped;
}

function normalizeOrderbookPayload(payload) {
  const candidate = firstObject([
    payload,
    payload && payload.book,
    payload && payload.data,
    payload && payload.orderbook,
    payload && payload.result,
  ]);
  if (!candidate) {
    return {
      bids: [],
      asks: [],
    };
  }
  return {
    bids: normalizeOrderbookEntries(candidate.bids, 'desc'),
    asks: normalizeOrderbookEntries(candidate.asks, 'asc'),
  };
}

function computeMidPrice(book) {
  const bestBid = book && Array.isArray(book.bids) && book.bids.length ? toFiniteNumber(book.bids[0].price) : null;
  const bestAsk = book && Array.isArray(book.asks) && book.asks.length ? toFiniteNumber(book.asks[0].price) : null;
  if (bestBid !== null && bestAsk !== null) return (bestBid + bestAsk) / 2;
  return bestAsk !== null ? bestAsk : bestBid;
}

function walkOrderbookDepth(book, side, notionalUsd) {
  const targetNotional = toFiniteNumber(notionalUsd);
  if (targetNotional === null || targetNotional <= 0) {
    return {
      ok: false,
      diagnostics: ['Amount must be a positive number for depth walk.'],
    };
  }

  const normalizedSide = String(side || 'buy').toLowerCase();
  const isBuy = normalizedSide !== 'sell';
  const levels = isBuy ? book.asks : book.bids;
  if (!Array.isArray(levels) || !levels.length) {
    return {
      ok: false,
      diagnostics: [`Orderbook ${isBuy ? 'asks' : 'bids'} unavailable.`],
    };
  }

  const bestLevel = levels[0];
  const bestPrice = toFiniteNumber(bestLevel && bestLevel.price);
  if (bestPrice === null || bestPrice <= 0) {
    return {
      ok: false,
      diagnostics: ['Best price unavailable for depth walk.'],
    };
  }

  let remainingNotional = targetNotional;
  let filledNotional = 0;
  let filledShares = 0;
  let worstPrice = null;
  for (const level of levels) {
    if (remainingNotional <= 1e-12) break;
    const price = toFiniteNumber(level && level.price);
    const size = toFiniteNumber(level && level.size);
    if (price === null || size === null || price <= 0 || size <= 0) continue;

    const levelNotional = price * size;
    const takeNotional = Math.min(levelNotional, remainingNotional);
    const takeShares = takeNotional / price;

    filledNotional += takeNotional;
    filledShares += takeShares;
    remainingNotional -= takeNotional;
    worstPrice = price;
  }

  if (filledNotional <= 0 || filledShares <= 0) {
    return {
      ok: false,
      diagnostics: ['Orderbook depth walk could not fill any notional.'],
    };
  }

  const vwap = filledNotional / filledShares;
  const slippagePctRaw = isBuy
    ? ((vwap - bestPrice) / bestPrice) * 100
    : ((bestPrice - vwap) / bestPrice) * 100;
  const midPrice = computeMidPrice(book);
  const priceImpactRaw =
    midPrice && midPrice > 0
      ? (isBuy ? ((vwap - midPrice) / midPrice) * 100 : ((midPrice - vwap) / midPrice) * 100)
      : null;

  return {
    ok: true,
    diagnostics: [],
    vwap,
    bestPrice,
    worstPrice,
    midPrice,
    requestedNotionalUsd: targetNotional,
    filledNotionalUsd: filledNotional,
    unfilledNotionalUsd: Math.max(0, remainingNotional),
    fillRatio: targetNotional > 0 ? Math.min(1, filledNotional / targetNotional) : 0,
    filledShares,
    slippagePct: slippagePctRaw,
    priceImpact: priceImpactRaw,
    netDeltaChange: filledShares * (isBuy ? 1 : -1),
  };
}

function extractQuoteEstimate(quote) {
  return quote && quote.estimate && typeof quote.estimate === 'object' ? quote.estimate : {};
}

/**
 * Build fork dry-run preview metrics for `trade`.
 * Returns null-safe fields with diagnostics when metrics are unavailable.
 * @param {{quote?: object, amountUsdc?: number}} [input]
 * @returns {{estimatedGasUsd: (number|null), slippagePct: (number|null), priceImpact: (number|null), netDeltaChange: (number|null), diagnostics: string[]}}
 */
function buildTradeForkPreview(input = {}) {
  const diagnostics = [];
  const preview = buildEmptyPreview(diagnostics);
  const quote = input.quote && typeof input.quote === 'object' ? input.quote : null;
  const estimate = extractQuoteEstimate(quote);

  preview.estimatedGasUsd = round(firstFinite([
    estimate.estimatedGasUsd,
    estimate.gasUsd,
    quote && quote.estimatedGasUsd,
    quote && quote.gasUsd,
  ]));
  if (preview.estimatedGasUsd === null) {
    appendDiagnostic(diagnostics, 'estimatedGasUsd unavailable from quote payload.');
  }

  const slippageBps = firstFinite([estimate.slippageBps, quote && quote.slippageBps]);
  preview.slippagePct = slippageBps === null ? null : round(slippageBps / 100);
  if (preview.slippagePct === null) {
    appendDiagnostic(diagnostics, 'slippagePct unavailable from quote payload.');
  }

  preview.priceImpact = round(firstFinite([
    estimate.priceImpact,
    estimate.priceImpactPct,
    quote && quote.priceImpact,
    quote && quote.priceImpactPct,
  ]));
  if (preview.priceImpact === null) {
    const estimatedShares = toFiniteNumber(estimate.estimatedShares);
    const minSharesOut = toFiniteNumber(estimate.minSharesOut);
    if (estimatedShares !== null && estimatedShares > 0 && minSharesOut !== null) {
      preview.priceImpact = round(((estimatedShares - minSharesOut) / estimatedShares) * 100);
    }
  }
  if (preview.priceImpact === null) {
    appendDiagnostic(diagnostics, 'priceImpact unavailable from quote payload.');
  }

  preview.netDeltaChange = round(firstFinite([
    estimate.netDeltaChange,
    quote && quote.netDeltaChange,
    estimate.estimatedShares,
    estimate.minSharesOut,
  ]));
  if (preview.netDeltaChange === null) {
    appendDiagnostic(diagnostics, 'netDeltaChange unavailable from quote payload.');
  }

  if (!quote || quote.quoteAvailable === false) {
    appendDiagnostic(diagnostics, 'Quote data unavailable; preview fields may be null.');
  }

  return preview;
}

async function fetchOrderbookByTokenId(options = {}) {
  const host = String(options.host || '').trim().replace(/\/+$/, '');
  const tokenId = String(options.tokenId || '').trim();
  const timeoutMs = Number.isInteger(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : 12_000;
  const fetchFn = typeof options.fetchFn === 'function' ? options.fetchFn : null;

  if (!host) throw new Error('Polymarket host unavailable for orderbook preview.');
  if (!tokenId) throw new Error('tokenId unavailable for orderbook preview.');
  if (!fetchFn) throw new Error('fetch API unavailable for orderbook preview.');

  const endpoint = `${host}/book?token_id=${encodeURIComponent(tokenId)}`;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => {
    if (controller) controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchFn(endpoint, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller ? controller.signal : undefined,
    });
    if (!response || response.ok !== true) {
      const status = response && response.status !== undefined ? response.status : 'unknown';
      throw new Error(`Polymarket book endpoint returned HTTP ${status}.`);
    }
    const payload = await response.json();
    return {
      endpoint,
      payload,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build fork dry-run preview metrics for `polymarket trade`.
 * Performs best-effort `/book?token_id=` depth walk and never throws.
 * @param {{host?: string, tokenId?: string, side?: string, amountUsdc?: number, timeoutMs?: number, fetchFn?: Function}} [input]
 * @returns {Promise<{estimatedGasUsd: (number|null), slippagePct: (number|null), priceImpact: (number|null), netDeltaChange: (number|null), diagnostics: string[], vwapFill?: object, orderbookEndpoint?: string|null}>}
 */
async function buildPolymarketForkPreview(input = {}) {
  const diagnostics = [];
  const preview = buildEmptyPreview(diagnostics);
  preview.orderbookEndpoint = null;
  preview.vwapFill = null;

  preview.estimatedGasUsd = round(firstFinite([
    input.estimatedGasUsd,
    input.gasUsd,
  ]));
  if (preview.estimatedGasUsd === null) {
    appendDiagnostic(diagnostics, 'estimatedGasUsd unavailable for polymarket dry-run.');
  }

  const host = String(input.host || '').trim();
  const tokenId = String(input.tokenId || '').trim();
  if (!host) {
    appendDiagnostic(diagnostics, 'Polymarket host unavailable; skipped /book depth walk.');
    return preview;
  }
  if (!tokenId) {
    appendDiagnostic(diagnostics, 'Polymarket tokenId unavailable; skipped /book depth walk.');
    return preview;
  }

  try {
    const orderbookResponse = await fetchOrderbookByTokenId({
      host,
      tokenId,
      timeoutMs: input.timeoutMs,
      fetchFn: input.fetchFn || (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
    });
    preview.orderbookEndpoint = orderbookResponse.endpoint;
    const normalizedBook = normalizeOrderbookPayload(orderbookResponse.payload);
    const walk = walkOrderbookDepth(normalizedBook, input.side || 'buy', input.amountUsdc);
    for (const line of walk.diagnostics || []) {
      appendDiagnostic(diagnostics, line);
    }
    if (!walk.ok) {
      return preview;
    }

    preview.slippagePct = round(walk.slippagePct);
    preview.priceImpact = round(walk.priceImpact);
    preview.netDeltaChange = round(walk.netDeltaChange);
    preview.vwapFill = {
      vwap: round(walk.vwap, 8),
      bestPrice: round(walk.bestPrice, 8),
      worstPrice: round(walk.worstPrice, 8),
      midPrice: round(walk.midPrice, 8),
      requestedNotionalUsd: round(walk.requestedNotionalUsd),
      filledNotionalUsd: round(walk.filledNotionalUsd),
      unfilledNotionalUsd: round(walk.unfilledNotionalUsd),
      fillRatio: round(walk.fillRatio, 6),
      filledShares: round(walk.filledShares, 6),
    };

    if (preview.slippagePct === null) {
      appendDiagnostic(diagnostics, 'slippagePct unavailable from orderbook depth walk.');
    }
    if (preview.priceImpact === null) {
      appendDiagnostic(diagnostics, 'priceImpact unavailable from orderbook depth walk.');
    }
    if (preview.netDeltaChange === null) {
      appendDiagnostic(diagnostics, 'netDeltaChange unavailable from orderbook depth walk.');
    }
    return preview;
  } catch (err) {
    appendDiagnostic(
      diagnostics,
      `Polymarket /book depth walk unavailable: ${err && err.message ? err.message : String(err)}`,
    );
    return preview;
  }
}

module.exports = {
  buildTradeForkPreview,
  buildPolymarketForkPreview,
  normalizeOrderbookPayload,
  walkOrderbookDepth,
};
