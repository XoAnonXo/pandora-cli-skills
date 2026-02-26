const { createIndexerClient } = require('./indexer_client.cjs');

const USDC_DECIMALS = 6;
const HISTORY_SCHEMA_VERSION = '1.0.0';

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function round(value, decimals = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toUsdc(raw) {
  const numeric = toNumber(raw);
  if (numeric === null) return null;
  return round(numeric / 10 ** USDC_DECIMALS, 6);
}

function normalizeProbabilityFromYesChance(rawYesChance) {
  const raw = toNumber(rawYesChance);
  if (raw === null) return null;
  if (raw >= 0 && raw <= 1) return raw;
  if (raw > 1 && raw <= 100) return raw / 100;
  return raw / 1_000_000_000;
}

function computeYesProbabilityFromMarket(market) {
  const yesChanceProb = normalizeProbabilityFromYesChance(market && market.yesChance);
  if (yesChanceProb !== null && yesChanceProb >= 0 && yesChanceProb <= 1) return yesChanceProb;

  const reserveYes = toNumber(market && market.reserveYes);
  const reserveNo = toNumber(market && market.reserveNo);
  if (reserveYes === null || reserveNo === null) return null;
  const total = reserveYes + reserveNo;
  if (!Number.isFinite(total) || total <= 0) return null;

  // Keep consistent with existing CLI odds math for AMM reserve fallback.
  return round(reserveNo / total, 6);
}

function normalizeIdKey(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  return str.toLowerCase();
}

function inferResolvedOutcome(statusRaw) {
  const status = Number(statusRaw);
  if (!Number.isFinite(status)) return null;
  if (status === 1) return 'yes';
  if (status === 2) return 'no';
  return null;
}

function inferTradeStatus(poll, side) {
  const status = Number(poll && poll.status);
  if (!Number.isFinite(status)) return 'closed-other';
  if (status === 0) return 'open';

  if (side !== 'yes' && side !== 'no') {
    return 'closed-other';
  }

  const resolved = inferResolvedOutcome(status);
  if (!resolved) return 'closed-other';
  return resolved === side ? 'won' : 'lost';
}

function computeMarkPriceAndStatus(trade, market, poll, diagnostics) {
  const side = String(trade && trade.side ? trade.side : '').toLowerCase();
  const status = inferTradeStatus(poll, side);

  if (status === 'won') {
    return { status, markPrice: 1, markSource: 'poll-status' };
  }
  if (status === 'lost') {
    return { status, markPrice: 0, markSource: 'poll-status' };
  }
  if (status === 'closed-other') {
    diagnostics.push('Closed market has non-binary or unknown resolution status; terminal valuation approximated as zero.');
    return { status, markPrice: 0, markSource: 'closed-other-fallback' };
  }

  const yesProb = computeYesProbabilityFromMarket(market);
  if (yesProb === null) {
    diagnostics.push('Unable to derive mark price from market yesChance/reserves.');
    return { status, markPrice: null, markSource: null };
  }

  const markPrice = side === 'yes' ? yesProb : side === 'no' ? 1 - yesProb : null;
  const markSource = market && market.yesChance !== null && market.yesChance !== undefined ? 'market.yesChance' : 'market.reserves';
  return {
    status,
    markPrice: markPrice === null ? null : round(markPrice, 6),
    markSource,
  };
}

function buildSummary(items) {
  const summary = {
    tradeCount: items.length,
    openCount: 0,
    wonCount: 0,
    lostCount: 0,
    closedOtherCount: 0,
    realizedPnlApproxUsdc: 0,
    unrealizedPnlApproxUsdc: 0,
    grossVolumeUsdc: 0,
    diagnostics: [],
  };

  for (const item of items) {
    const collateral = toNumber(item.collateralAmountUsdc) || 0;
    summary.grossVolumeUsdc += collateral;

    if (item.status === 'open') {
      summary.openCount += 1;
      summary.unrealizedPnlApproxUsdc += toNumber(item.pnlUnrealizedApproxUsdc) || 0;
    } else if (item.status === 'won') {
      summary.wonCount += 1;
      summary.realizedPnlApproxUsdc += toNumber(item.pnlRealizedApproxUsdc) || 0;
    } else if (item.status === 'lost') {
      summary.lostCount += 1;
      summary.realizedPnlApproxUsdc += toNumber(item.pnlRealizedApproxUsdc) || 0;
    } else {
      summary.closedOtherCount += 1;
      summary.realizedPnlApproxUsdc += toNumber(item.pnlRealizedApproxUsdc) || 0;
    }
  }

  summary.realizedPnlApproxUsdc = round(summary.realizedPnlApproxUsdc, 6);
  summary.unrealizedPnlApproxUsdc = round(summary.unrealizedPnlApproxUsdc, 6);
  summary.grossVolumeUsdc = round(summary.grossVolumeUsdc, 6);
  summary.diagnostics.push('P&L values are analytics-grade approximations, not tax-lot accounting.');
  return summary;
}

function sortHistoryItems(items, orderBy, orderDirection) {
  const dir = String(orderDirection || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  const pick = (item) => {
    if (orderBy === 'pnl') {
      return toNumber(item.pnlRealizedApproxUsdc) ?? toNumber(item.pnlUnrealizedApproxUsdc) ?? -Infinity;
    }
    if (orderBy === 'entry-price') {
      return toNumber(item.entryPriceUsdcPerToken) ?? -Infinity;
    }
    if (orderBy === 'mark-price') {
      return toNumber(item.markPriceUsdcPerToken) ?? -Infinity;
    }
    return toNumber(item.timestamp) ?? 0;
  };

  items.sort((a, b) => {
    const left = pick(a);
    const right = pick(b);
    if (left === right) return 0;
    return left > right ? dir : -dir;
  });
}

async function fetchHistory(options) {
  const client = createIndexerClient(options.indexerUrl, options.timeoutMs);

  const tradeFields = [
    'id',
    'chainId',
    'marketAddress',
    'pollAddress',
    'trader',
    'side',
    'tradeType',
    'collateralAmount',
    'tokenAmount',
    'tokenAmountOut',
    'feeAmount',
    'timestamp',
    'txHash',
  ];

  const tradeWhere = { trader: options.wallet };
  if (options.chainId !== null && options.chainId !== undefined) {
    tradeWhere.chainId = options.chainId;
  }
  if (options.marketAddress) {
    tradeWhere.marketAddress = options.marketAddress;
  }
  if (options.side && options.side !== 'both') {
    tradeWhere.side = options.side;
  }

  const tradePage = await client.list({
    queryName: 'tradess',
    filterType: 'tradesFilter',
    fields: tradeFields,
    variables: {
      where: tradeWhere,
      orderBy: 'timestamp',
      orderDirection: 'desc',
      before: options.before,
      after: options.after,
      limit: options.limit,
    },
  });

  const trades = (tradePage.items || []).filter((trade) => {
    if (!options.includeSeed && String(trade && trade.tradeType ? trade.tradeType : '').toLowerCase() === 'seed') {
      return false;
    }
    return true;
  });

  const marketIds = Array.from(
    new Set(trades.map((trade) => normalizeIdKey(trade && trade.marketAddress)).filter(Boolean)),
  );
  const pollIds = Array.from(
    new Set(trades.map((trade) => normalizeIdKey(trade && trade.pollAddress)).filter(Boolean)),
  );

  const [marketMap, pollMap] = await Promise.all([
    client.getManyByIds({
      queryName: 'markets',
      fields: [
        'id',
        'pollAddress',
        'marketType',
        'chainId',
        'marketCloseTimestamp',
        'yesChance',
        'reserveYes',
        'reserveNo',
      ],
      ids: marketIds,
    }),
    client.getManyByIds({
      queryName: 'polls',
      fields: ['id', 'question', 'status', 'deadlineEpoch', 'resolvedAt'],
      ids: pollIds,
    }),
  ]);

  const winningsPage = await client.list({
    queryName: 'winningss',
    filterType: 'winningsFilter',
    fields: ['id', 'user', 'marketAddress', 'collateralAmount', 'feeAmount', 'timestamp', 'txHash'],
    variables: {
      where: {
        user: options.wallet,
        ...(options.chainId !== null && options.chainId !== undefined ? { chainId: options.chainId } : {}),
      },
      orderBy: 'timestamp',
      orderDirection: 'desc',
      before: null,
      after: null,
      limit: Math.max(options.limit, 250),
    },
  });

  const winningsByMarket = new Map();
  for (const entry of winningsPage.items || []) {
    const key = normalizeIdKey(entry && entry.marketAddress);
    if (!key) continue;
    const amount = toUsdc(entry && entry.collateralAmount);
    const fee = toUsdc(entry && entry.feeAmount) || 0;
    const value = (amount || 0) - fee;
    winningsByMarket.set(key, (winningsByMarket.get(key) || 0) + value);
  }

  const items = trades.map((trade) => {
    const diagnostics = [];
    const marketKey = normalizeIdKey(trade && trade.marketAddress);
    const pollKey = normalizeIdKey(trade && trade.pollAddress);
    const market = marketKey ? marketMap.get(marketKey) || null : null;
    const poll = pollKey ? pollMap.get(pollKey) || null : null;

    if (!poll) diagnostics.push('Poll details unavailable for this trade.');
    if (!market) diagnostics.push('Market details unavailable for this trade.');

    const collateralAmountUsdc = toUsdc(trade && trade.collateralAmount);
    const tokenAmount = toUsdc(trade && trade.tokenAmount);
    const feeAmountUsdc = toUsdc(trade && trade.feeAmount) || 0;

    let entryPrice = null;
    if (collateralAmountUsdc !== null && tokenAmount !== null && tokenAmount > 0) {
      entryPrice = round(collateralAmountUsdc / tokenAmount, 6);
    } else {
      diagnostics.push('Entry price unavailable (missing collateral/token amount).');
    }

    const { status, markPrice, markSource } = computeMarkPriceAndStatus(trade, market, poll, diagnostics);

    const currentValue = markPrice !== null && tokenAmount !== null ? round(tokenAmount * markPrice, 6) : null;
    const pnlApprox =
      currentValue !== null && collateralAmountUsdc !== null
        ? round(currentValue - collateralAmountUsdc - feeAmountUsdc, 6)
        : null;

    const marketWinnings = marketKey ? winningsByMarket.get(marketKey) || 0 : 0;
    const pnlRealizedApprox = status === 'open' ? null : pnlApprox;
    if (status !== 'open' && marketWinnings !== 0 && pnlRealizedApprox !== null) {
      diagnostics.push('Realized values are approximated per trade; winnings attribution by lot is not exact.');
    }

    return {
      id: trade.id,
      txHash: trade.txHash,
      timestamp: trade.timestamp,
      chainId: trade.chainId,
      marketAddress: trade.marketAddress,
      pollAddress: trade.pollAddress,
      question: poll && poll.question ? poll.question : null,
      marketType: market && market.marketType ? market.marketType : null,
      side: trade.side,
      tradeType: trade.tradeType,
      collateralAmountRaw: trade.collateralAmount,
      collateralAmountUsdc,
      tokenAmountRaw: trade.tokenAmount,
      tokenAmount,
      entryPriceUsdcPerToken: entryPrice,
      markPriceUsdcPerToken: markPrice,
      markSource,
      currentValueUsdc: currentValue,
      pnlUnrealizedApproxUsdc: status === 'open' ? pnlApprox : null,
      pnlRealizedApproxUsdc: pnlRealizedApprox,
      status,
      diagnostics,
    };
  });

  if (options.status && options.status !== 'all') {
    const allowed = new Set(options.status === 'closed' ? ['won', 'lost', 'closed-other'] : [options.status]);
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (!allowed.has(items[i].status)) {
        items.splice(i, 1);
      }
    }
  }

  sortHistoryItems(items, options.orderBy, options.orderDirection);

  const summary = buildSummary(items);
  const payload = {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    indexerUrl: options.indexerUrl,
    wallet: options.wallet,
    chainId: options.chainId,
    filters: {
      wallet: options.wallet,
      chainId: options.chainId,
      marketAddress: options.marketAddress,
      side: options.side,
      status: options.status,
      includeSeed: options.includeSeed,
    },
    pagination: {
      limit: options.limit,
      before: options.before,
      after: options.after,
      orderBy: options.orderBy,
      orderDirection: options.orderDirection,
    },
    pageInfo: tradePage.pageInfo,
    summary,
    count: items.length,
    items,
  };

  return payload;
}

module.exports = {
  HISTORY_SCHEMA_VERSION,
  fetchHistory,
};
