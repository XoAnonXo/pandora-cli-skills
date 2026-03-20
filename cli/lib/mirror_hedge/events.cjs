const { round, toNumber } = require('../shared/utils.cjs');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLowerText(value) {
  return normalizeText(value).toLowerCase();
}

function firstDefined() {
  for (let index = 0; index < arguments.length; index += 1) {
    const value = arguments[index];
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

function toNumberOrNull(value) {
  return toNumber(value);
}

function roundMirrorHedgeNumber(value, decimals = 6) {
  const numeric = toNumber(value);
  if (numeric === null) return null;
  return round(numeric, decimals);
}

function normalizeMirrorHedgeAddress(value) {
  const text = normalizeLowerText(value);
  return /^0x[a-f0-9]{40}$/.test(text) ? text : null;
}

function normalizeMirrorHedgeVenue(value) {
  const normalized = normalizeLowerText(value);
  if (!normalized) return 'unknown';
  if (normalized === 'pandora') return 'pandora';
  if (normalized === 'polymarket') return 'polymarket';
  if (normalized === 'amm') return 'amm';
  if (normalized === 'log') return 'log';
  if (normalized === 'mempool') return 'mempool';
  return normalized;
}

function normalizeMirrorHedgeMarketType(value) {
  const normalized = normalizeLowerText(value);
  if (!normalized) return 'unknown';
  if (normalized.includes('amm')) return 'amm';
  if (normalized.includes('orderbook') || normalized.includes('clob')) return 'orderbook';
  return normalized;
}

function normalizeMirrorHedgeOrderSide(value) {
  const normalized = normalizeLowerText(value);
  if (normalized === 'buy' || normalized === 'sell') return normalized;
  return null;
}

function normalizeMirrorHedgeTokenSide(value) {
  const normalized = normalizeLowerText(value);
  if (normalized === 'yes' || normalized === 'no') return normalized;
  return null;
}

function normalizeMirrorHedgeTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  const parsed = Date.parse(String(value));
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric > 1e12 ? numeric : numeric * 1000).toISOString();
  }
  return null;
}

function normalizeMirrorHedgeTradeDirection(orderSide, tokenSide) {
  const side = normalizeMirrorHedgeOrderSide(orderSide);
  const token = normalizeMirrorHedgeTokenSide(tokenSide);
  if (!side || !token) return null;
  return `${side}-${token}`;
}

function extractMirrorHedgeTradeBody(input) {
  if (!input || typeof input !== 'object') return {};
  const candidates = [
    input.trade,
    input.tradeEvent,
    input.pendingTrade,
    input.confirmedTrade,
    input.event,
    input.log,
    input.details,
    input.payload,
    input.data,
    input.args,
    input.returnValues,
    input.record,
    input.raw,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return candidate;
    }
  }
  return input;
}

function parseMirrorHedgeTradeSides(body) {
  const sideText = normalizeLowerText(
    firstDefined(
      body.orderSide,
      body.side,
      body.direction,
      body.action,
      body.tradeSide,
      body.tradeDirection,
      body.positionSide,
      body.marketSide,
      body.intent,
    ),
  );
  const tokenText = normalizeLowerText(
    firstDefined(
      body.tokenSide,
      body.outcome,
      body.choice,
      body.selection,
      body.assetSide,
      body.yesNo,
      body.marketOutcome,
    ),
  );

  let orderSide = normalizeMirrorHedgeOrderSide(sideText);
  let tokenSide = normalizeMirrorHedgeTokenSide(tokenText);

  if ((!orderSide || !tokenSide) && sideText) {
    if (sideText.includes('buy')) orderSide = 'buy';
    if (sideText.includes('sell')) orderSide = 'sell';
    if (sideText.includes('yes')) tokenSide = 'yes';
    if (sideText.includes('no')) tokenSide = 'no';
  }

  if ((!orderSide || !tokenSide) && tokenText) {
    if (tokenText.includes('buy')) orderSide = 'buy';
    if (tokenText.includes('sell')) orderSide = 'sell';
    if (tokenText.includes('yes')) tokenSide = 'yes';
    if (tokenText.includes('no')) tokenSide = 'no';
  }

  if ((!orderSide || !tokenSide) && body.label) {
    const label = normalizeLowerText(body.label);
    if (!orderSide && label.includes('buy')) orderSide = 'buy';
    if (!orderSide && label.includes('sell')) orderSide = 'sell';
    if (!tokenSide && label.includes('yes')) tokenSide = 'yes';
    if (!tokenSide && label.includes('no')) tokenSide = 'no';
  }

  if ((!orderSide || !tokenSide) && sideText) {
    const match = sideText.match(/\b(buy|sell)\b[\s:-]*\b(yes|no)\b/i) || sideText.match(/\b(yes|no)\b[\s:-]*\b(buy|sell)\b/i);
    if (match) {
      const first = normalizeLowerText(match[1]);
      const second = normalizeLowerText(match[2]);
      if (first === 'buy' || first === 'sell') orderSide = first;
      if (first === 'yes' || first === 'no') tokenSide = first;
      if (second === 'buy' || second === 'sell') orderSide = second;
      if (second === 'yes' || second === 'no') tokenSide = second;
    }
  }

  return {
    orderSide,
    tokenSide,
    direction: normalizeMirrorHedgeTradeDirection(orderSide, tokenSide),
  };
}

function normalizeMirrorHedgeTradeAmount(body) {
  const amountShares = toNumberOrNull(
    firstDefined(
      body.amountShares,
      body.quantityShares,
      body.quantity,
      body.shareAmount,
      body.shares,
      body.tokenAmount,
      body.units,
      body.size,
      body.amount,
    ),
  );
  let amountUsdc = toNumberOrNull(
    firstDefined(
      body.amountUsdc,
      body.notionalUsdc,
      body.notional,
      body.valueUsdc,
      body.value,
      body.quoteAmount,
      body.quoteUsdc,
    ),
  );
  const price = toNumberOrNull(
    firstDefined(
      body.price,
      body.limitPrice,
      body.executionPrice,
      body.averagePrice,
      body.fillPrice,
      body.markPrice,
    ),
  );

  if (amountUsdc === null && amountShares !== null && price !== null) {
    amountUsdc = roundMirrorHedgeNumber(amountShares * price, 6);
  }

  let normalizedShares = amountShares;
  if (normalizedShares === null && amountUsdc !== null && price !== null && price > 0) {
    normalizedShares = roundMirrorHedgeNumber(amountUsdc / price, 6);
  }

  return {
    amountShares: normalizedShares,
    amountUsdc,
    price,
    feeUsdc: toNumberOrNull(firstDefined(body.feeUsdc, body.fee, body.feesUsdc, body.tradingFeeUsdc)),
    gasUsdc: toNumberOrNull(firstDefined(body.gasUsdc, body.gasCostUsdc, body.gasCost, body.networkFeeUsdc)),
    expectedRevenueUsdc: toNumberOrNull(
      firstDefined(body.expectedRevenueUsdc, body.revenueUsdc, body.expectedEdgeUsdc, body.edgeUsdc),
    ),
  };
}

function buildMirrorHedgeEventKey(record) {
  if (!record || typeof record !== 'object') return null;
  const parts = [
    normalizeLowerText(record.kind),
    normalizeLowerText(record.status),
    normalizeLowerText(record.venue),
    normalizeLowerText(record.txHash),
    record.logIndex !== null && record.logIndex !== undefined ? String(record.logIndex) : '',
    normalizeLowerText(record.orderSide),
    normalizeLowerText(record.tokenSide),
    normalizeLowerText(record.marketAddress),
    normalizeLowerText(record.marketId),
  ].filter(Boolean);
  return parts.length ? parts.join(':') : null;
}

function normalizeMirrorHedgeTradeLike(input, defaults = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const body = extractMirrorHedgeTradeBody(raw);
  const sides = parseMirrorHedgeTradeSides(body);
  const amount = normalizeMirrorHedgeTradeAmount(body);
  const venue = normalizeMirrorHedgeVenue(firstDefined(body.venue, raw.venue, defaults.venue));
  const marketType = normalizeMirrorHedgeMarketType(
    firstDefined(body.marketType, body.marketKind, raw.marketType, raw.marketKind, defaults.marketType),
  );
  const walletAddress = normalizeMirrorHedgeAddress(
    firstDefined(
      body.walletAddress,
      body.from,
      body.sourceWalletAddress,
      body.originWalletAddress,
      body.ownerAddress,
      body.accountAddress,
      body.traderAddress,
      body.initiatorAddress,
      raw.walletAddress,
      raw.from,
    ),
  );
  const marketAddress = normalizeMirrorHedgeAddress(
    firstDefined(body.marketAddress, body.pandoraMarketAddress, body.polymarketMarketAddress, raw.marketAddress),
  );
  const txHash = normalizeText(firstDefined(body.txHash, body.hash, body.transactionHash, raw.txHash, raw.hash));
  const blockHash = normalizeText(firstDefined(body.blockHash, raw.blockHash));
  const blockNumber = toNumberOrNull(firstDefined(body.blockNumber, raw.blockNumber));
  const logIndex = toNumberOrNull(firstDefined(body.logIndex, body.eventIndex, raw.logIndex));
  const transactionIndex = toNumberOrNull(firstDefined(body.transactionIndex, raw.transactionIndex));
  const nonce = toNumberOrNull(firstDefined(body.nonce, raw.nonce));
  const conditionId = normalizeText(firstDefined(body.conditionId, body.questionId, raw.conditionId));
  const marketId = normalizeText(firstDefined(body.marketId, raw.marketId));
  const eventName = normalizeText(firstDefined(body.eventName, body.name, raw.eventName));
  const eventSignature = normalizeText(firstDefined(body.eventSignature, raw.eventSignature));
  const protocol = normalizeText(firstDefined(body.protocol, raw.protocol, venue === 'unknown' ? null : venue));
  const source = normalizeText(firstDefined(body.source, raw.source, defaults.source, venue));
  const sourceType = normalizeText(firstDefined(body.sourceType, raw.sourceType, defaults.sourceType, 'trade'));
  const status = normalizeText(firstDefined(body.status, raw.status, defaults.status, 'pending'));
  const phase = normalizeText(firstDefined(body.phase, raw.phase, status || defaults.phase));
  const timestamp = normalizeMirrorHedgeTimestamp(
    firstDefined(body.timestamp, body.observedAt, body.createdAt, raw.timestamp, defaults.timestamp),
  );
  const confirmedAt = normalizeMirrorHedgeTimestamp(
    firstDefined(body.confirmedAt, body.finalizedAt, body.settledAt, raw.confirmedAt, defaults.confirmedAt),
  );
  const chainId = toNumberOrNull(firstDefined(body.chainId, raw.chainId, defaults.chainId));
  const slippageBps = toNumberOrNull(firstDefined(body.slippageBps, body.maxSlippageBps, raw.slippageBps));
  const liveMutationVenue = normalizeMirrorHedgeVenue(firstDefined(body.liveMutationVenue, raw.liveMutationVenue));
  const trade = {
    schemaVersion: '1.0.0',
    kind: normalizeText(firstDefined(body.kind, raw.kind, defaults.kind, 'pending-trade')) || 'pending-trade',
    venue,
    marketType: marketType === 'unknown' && (sides.orderSide || sides.tokenSide) ? 'amm' : marketType,
    protocol: protocol || (venue !== 'unknown' ? venue : null),
    source,
    sourceType: sourceType || 'trade',
    status: status || 'pending',
    phase: phase || status || 'pending',
    timestamp,
    confirmedAt,
    txHash: txHash || null,
    blockHash: blockHash || null,
    blockNumber,
    logIndex,
    transactionIndex,
    nonce,
    walletAddress,
    marketAddress,
    marketId: marketId || null,
    conditionId: conditionId || null,
    eventName: eventName || null,
    eventSignature: eventSignature || null,
    chainId,
    tokenSide: sides.tokenSide,
    orderSide: sides.orderSide,
    side: sides.direction,
    direction: sides.direction,
    amountShares: amount.amountShares,
    amountUsdc: amount.amountUsdc,
    price: amount.price,
    feeUsdc: amount.feeUsdc,
    gasUsdc: amount.gasUsdc,
    expectedRevenueUsdc: amount.expectedRevenueUsdc,
    slippageBps,
    liveMutationVenue: liveMutationVenue === 'unknown' ? null : liveMutationVenue,
    canonicalKey: null,
    decodeConfidence: sides.orderSide && sides.tokenSide ? 'high' : sides.orderSide || sides.tokenSide ? 'partial' : 'low',
    raw,
  };
  trade.canonicalKey = buildMirrorHedgeEventKey(trade);
  return trade;
}

function decodePendingPandoraTrade(input, options = {}) {
  const trade = normalizeMirrorHedgeTradeLike(input, {
    ...options,
    kind: options.kind || 'pending-trade',
    phase: options.phase || 'pending',
    status: options.status || 'pending',
    source: options.source || 'pandora.pending-trade',
    sourceType: options.sourceType || 'mempool',
    venue: options.venue || 'pandora',
    protocol: options.protocol || 'pandora',
    marketType: options.marketType || 'amm',
    liveMutationVenue: options.liveMutationVenue || null,
  });
  trade.kind = 'pending-trade';
  trade.phase = 'pending';
  trade.status = trade.status || 'pending';
  trade.marketType = trade.marketType === 'unknown' ? 'amm' : trade.marketType;
  return trade;
}

function normalizeConfirmedTradeFromLog(input, options = {}) {
  const trade = normalizeMirrorHedgeTradeLike(input, {
    ...options,
    kind: options.kind || 'confirmed-trade',
    phase: options.phase || 'confirmed',
    status: options.status || 'confirmed',
    source: options.source || 'log.ingestion',
    sourceType: options.sourceType || 'event-log',
    venue: options.venue || 'polymarket',
    protocol: options.protocol || options.venue || 'polymarket',
    liveMutationVenue: options.liveMutationVenue || null,
  });
  trade.kind = 'confirmed-trade';
  trade.phase = 'confirmed';
  trade.status = trade.status === 'pending' ? 'confirmed' : trade.status || 'confirmed';
  trade.confirmedAt = trade.confirmedAt || trade.timestamp;
  trade.ingestedAt = normalizeMirrorHedgeTimestamp(options.ingestedAt || new Date());
  trade.marketType = trade.marketType === 'unknown' && (trade.orderSide || trade.tokenSide) ? 'amm' : trade.marketType;
  return trade;
}

function normalizeConfirmedTrade(input, options = {}) {
  if (Array.isArray(input)) {
    return normalizeConfirmedTradeList(input, options);
  }
  return normalizeConfirmedTradeFromLog(input, options);
}

function normalizeConfirmedTradeList(entries, options = {}) {
  const output = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const normalized = normalizeConfirmedTradeFromLog(entry, options);
    if (normalized) output.push(normalized);
  }
  return output;
}

function isPolymarketVenue(value) {
  return normalizeMirrorHedgeVenue(value) === 'polymarket';
}

function createMirrorHedgeEventBundle(options = {}) {
  return {
    options: { ...options },
    decodePendingPandoraTrade,
    normalizeConfirmedTrade,
    normalizeConfirmedTradeFromLog,
    normalizeConfirmedTradeList,
    normalizeMirrorHedgeTradeLike,
    normalizeMirrorHedgeVenue,
    normalizeMirrorHedgeMarketType,
    normalizeMirrorHedgeOrderSide,
    normalizeMirrorHedgeTokenSide,
    normalizeMirrorHedgeTimestamp,
    normalizeMirrorHedgeTradeDirection,
    normalizeMirrorHedgeAddress,
    isPolymarketVenue,
    buildMirrorHedgeEventKey,
    normalizeMirrorHedgeNumber: roundMirrorHedgeNumber,
    toMirrorHedgeNumber: toNumberOrNull,
  };
}

module.exports = {
  normalizeText,
  normalizeLowerText,
  firstDefined,
  toNumberOrNull,
  roundMirrorHedgeNumber,
  normalizeMirrorHedgeAddress,
  normalizeMirrorHedgeVenue,
  normalizeMirrorHedgeMarketType,
  normalizeMirrorHedgeOrderSide,
  normalizeMirrorHedgeTokenSide,
  normalizeMirrorHedgeTimestamp,
  normalizeMirrorHedgeTradeDirection,
  normalizeMirrorHedgeTradeLike,
  decodePendingPandoraTrade,
  normalizeConfirmedTradeFromLog,
  normalizeConfirmedTrade,
  normalizeConfirmedTradeList,
  isPolymarketVenue,
  buildMirrorHedgeEventKey,
  createMirrorHedgeEventBundle,
};
