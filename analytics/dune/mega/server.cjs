#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname);
const PANEL_REGISTRY_PATH = path.resolve(__dirname, '..', 'panel_registry.json');
const PORT = Number(process.env.PORT || process.env.PANDORA_ANALYTICS_PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const INDEXER_URL =
  process.env.PANDORA_INDEXER_URL ||
  process.env.INDEXER_URL ||
  'https://pandoraindexer.up.railway.app/';
const CHAIN_ID = 1;
const MODELED_CREATION_FEE_USD = readConfiguredUsd('PANDORA_CREATION_FEE_USD', 5);
const MODELED_REFRESH_FEE_USD = readConfiguredUsd('PANDORA_REFRESH_FEE_USD', 5);

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function safeJoin(base, targetPath) {
  const joined = path.resolve(base, targetPath);
  if (!joined.startsWith(base)) return null;
  return joined;
}

function toNum(value) {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function readConfiguredUsd(envName, fallback) {
  const n = Number(process.env[envName]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function usdcFromRaw(value) {
  return toNum(value) / 1e6;
}

function ethFromWei(value) {
  return toNum(value) / 1e18;
}

function yesPriceFromRaw(value) {
  return toNum(value) / 1e9;
}

function epochToIso(epochSeconds) {
  const n = toNum(epochSeconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

function epochToDay(epochSeconds) {
  const iso = epochToIso(epochSeconds);
  return iso ? iso.slice(0, 10) : null;
}

function addDaysToDay(day, days) {
  if (!day) return null;
  const d = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function median(numbers) {
  if (!Array.isArray(numbers) || !numbers.length) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[m - 1] + sorted[m]) / 2;
  return sorted[m];
}

function stddev(numbers) {
  if (!Array.isArray(numbers) || numbers.length < 2) return 0;
  const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
  const variance = numbers.reduce((sum, n) => sum + (n - mean) ** 2, 0) / (numbers.length - 1);
  return Math.sqrt(variance);
}

function buildListQuery(queryName, filterType, fields) {
  return `query List($where: ${filterType}, $orderBy: String, $orderDirection: String, $before: String, $after: String, $limit: Int) {
  ${queryName}(where: $where, orderBy: $orderBy, orderDirection: $orderDirection, before: $before, after: $after, limit: $limit) {
    items {
      ${fields.join('\n      ')}
    }
    pageInfo {
      hasNextPage
      hasPreviousPage
      startCursor
      endCursor
    }
  }
}`;
}

async function graphqlRequest(query, variables = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(INDEXER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`Indexer HTTP ${res.status}`);
  }

  const payload = await res.json();
  if (payload.errors && payload.errors.length) {
    throw new Error(payload.errors[0].message || 'Indexer GraphQL error');
  }
  return payload.data || {};
}

async function fetchAllList({
  queryName,
  filterType,
  fields,
  where = {},
  orderBy,
  orderDirection = 'desc',
  limit = 200,
  maxPages = 30,
  maxRecords = 10000,
}) {
  const query = buildListQuery(queryName, filterType, fields);
  const out = [];
  let after = null;

  for (let page = 0; page < maxPages; page += 1) {
    const data = await graphqlRequest(query, {
      where,
      orderBy,
      orderDirection,
      before: null,
      after,
      limit,
    });

    const block = data && data[queryName] ? data[queryName] : null;
    const items = block && Array.isArray(block.items) ? block.items : [];
    const pageInfo = block && block.pageInfo ? block.pageInfo : null;

    out.push(...items);
    if (out.length >= maxRecords) break;

    if (!pageInfo || !pageInfo.hasNextPage || !pageInfo.endCursor || !items.length) {
      break;
    }
    after = pageInfo.endCursor;
  }

  return out;
}

function groupByDay(items, timeField, valueFn) {
  const map = new Map();
  for (const item of items) {
    const day = epochToDay(item[timeField]);
    if (!day) continue;
    if (!map.has(day)) {
      map.set(day, []);
    }
    map.get(day).push(valueFn ? valueFn(item) : item);
  }
  return map;
}

function objectEntriesDesc(obj) {
  return Object.entries(obj).sort((a, b) => Number(b[1]) - Number(a[1]));
}

function resolvePollLifecycleEventEpoch(poll) {
  const resolvedAt = toNum(poll && poll.resolvedAt);
  if (resolvedAt > 0) return resolvedAt;
  if (toNum(poll && poll.status) !== 0) {
    const deadlineEpoch = toNum(poll && poll.deadlineEpoch);
    if (deadlineEpoch > 0) return deadlineEpoch;
  }
  return 0;
}

function buildModeledLifecycleFeeLedger({
  dailyRows,
  polls,
  creationFeePerPollEth,
  creationFeePerPollUsd,
  refreshFeePerPollEth,
  refreshFeePerPollUsd,
}) {
  const creationFeeSeries = dailyRows.map((row) => ({
    day: row.day,
    pollsCreated: toNum(row.pollsCreated),
    creationFeeEthEstimated: toNum(row.pollsCreated) * creationFeePerPollEth,
    creationFeeUsdModeled: toNum(row.pollsCreated) * creationFeePerPollUsd,
  }));

  const refreshCountByDay = {};
  for (const poll of polls) {
    const lifecycleEventEpoch = resolvePollLifecycleEventEpoch(poll);
    const day = epochToDay(lifecycleEventEpoch);
    if (!day) continue;
    refreshCountByDay[day] = (refreshCountByDay[day] || 0) + 1;
  }

  const refreshFeeSeries = Object.entries(refreshCountByDay)
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([day, resolvedPolls]) => ({
      day,
      resolvedPolls,
      refreshFeeEthEstimated: resolvedPolls * refreshFeePerPollEth,
      refreshFeeUsdModeled: resolvedPolls * refreshFeePerPollUsd,
    }));

  return {
    creationFeeSeries,
    refreshFeeSeries,
    totalCreationFeeUsd: creationFeeSeries.reduce((sum, row) => sum + row.creationFeeUsdModeled, 0),
    totalRefreshFeeUsd: refreshFeeSeries.reduce((sum, row) => sum + row.refreshFeeUsdModeled, 0),
  };
}

function mergeFeeBreakdownByDay({
  tradingFeeDaily,
  redemptionFeeDaily,
  creationFeeSeries,
  refreshFeeSeries,
}) {
  const byDay = {};

  function ensureRow(day) {
    if (!day) return null;
    if (!byDay[day]) {
      byDay[day] = {
        day,
        tradingFeeUsdc: 0,
        redemptionFeeUsdc: 0,
        creationFeeUsd: 0,
        refreshFeeUsd: 0,
        creationFeeEth: 0,
        refreshFeeEth: 0,
      };
    }
    return byDay[day];
  }

  for (const row of tradingFeeDaily) {
    const target = ensureRow(row.day);
    if (target) target.tradingFeeUsdc = toNum(row.value);
  }

  for (const row of redemptionFeeDaily) {
    const target = ensureRow(row.day);
    if (target) target.redemptionFeeUsdc = toNum(row.value);
  }

  for (const row of creationFeeSeries) {
    const target = ensureRow(row.day);
    if (!target) continue;
    target.creationFeeUsd = toNum(row.creationFeeUsdModeled);
    target.creationFeeEth = toNum(row.creationFeeEthEstimated);
  }

  for (const row of refreshFeeSeries) {
    const target = ensureRow(row.day);
    if (!target) continue;
    target.refreshFeeUsd = toNum(row.refreshFeeUsdModeled);
    target.refreshFeeEth = toNum(row.refreshFeeEthEstimated);
  }

  const feeDailyMerged = Object.values(byDay)
    .sort((a, b) => String(a.day).localeCompare(String(b.day)))
    .map((row) => ({
      ...row,
      fixedLifecycleFeeUsd: row.creationFeeUsd + row.refreshFeeUsd,
      totalFeeUsd: row.tradingFeeUsdc + row.redemptionFeeUsdc + row.creationFeeUsd + row.refreshFeeUsd,
    }));

  let cumulativeFeeUsd = 0;
  const cumulativeFees = feeDailyMerged.map((row) => {
    cumulativeFeeUsd += row.totalFeeUsd;
    return { day: row.day, cumulativeFeeUsd };
  });

  return {
    feeDailyMerged,
    cumulativeFees,
  };
}

function formatAddress(value) {
  const v = String(value || '');
  if (v.length < 12) return v;
  return `${v.slice(0, 6)}...${v.slice(-4)}`;
}

function resolvePanels(registry, analytics) {
  const byKey = new Map(analytics.sections.flatMap((section) => section.panels.map((panel) => [panel.key, panel])));

  const sectionMap = new Map();
  for (const row of registry) {
    const key = row.key;
    if (!key || !byKey.has(key)) continue;
    const sectionName = row.section || 'Other';
    if (!sectionMap.has(sectionName)) sectionMap.set(sectionName, []);
    sectionMap.get(sectionName).push(byKey.get(key));
  }

  const sections = [];
  for (const [name, panels] of sectionMap.entries()) {
    sections.push({ name, panels });
  }

  return sections;
}

function toSeries(map, reducer) {
  return [...map.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([day, rows]) => ({ day, value: reducer(rows) }));
}

function topN(rows, n, valueField) {
  return [...rows]
    .sort((a, b) => Number(b[valueField]) - Number(a[valueField]))
    .slice(0, n);
}

function safeDivide(numerator, denominator) {
  const d = toNum(denominator);
  if (!d) return 0;
  return toNum(numerator) / d;
}

async function buildAnalyticsPayload(registry) {
  const [
    platformRows,
    dailyRows,
    hourlyRows,
    markets,
    polls,
    trades,
    liquidityEvents,
    winnings,
    marketUsers,
    priceTicks,
    disputes,
    oracleFeeEvents,
  ] = await Promise.all([
    fetchAllList({
      queryName: 'platformStatss',
      filterType: 'platformStatsFilter',
      fields: [
        'id',
        'chainId',
        'chainName',
        'totalPolls',
        'totalPollsResolved',
        'totalMarkets',
        'totalAmmMarkets',
        'totalPariMarkets',
        'totalTrades',
        'totalUsers',
        'totalVolume',
        'totalLiquidity',
        'totalFees',
        'totalWinningsPaid',
        'totalPlatformFeesEarned',
        'lastUpdatedAt',
      ],
      where: { chainId: CHAIN_ID },
      orderBy: 'lastUpdatedAt',
      limit: 3,
      maxPages: 1,
      maxRecords: 3,
    }),
    fetchAllList({
      queryName: 'dailyStatss',
      filterType: 'dailyStatsFilter',
      fields: [
        'id',
        'chainId',
        'chainName',
        'dayTimestamp',
        'pollsCreated',
        'marketsCreated',
        'tradesCount',
        'volume',
        'winningsPaid',
        'newUsers',
        'activeUsers',
      ],
      where: { chainId: CHAIN_ID },
      orderBy: 'dayTimestamp',
      limit: 250,
      maxPages: 3,
      maxRecords: 400,
    }),
    fetchAllList({
      queryName: 'hourlyStatss',
      filterType: 'hourlyStatsFilter',
      fields: ['id', 'hourTimestamp', 'tradesCount', 'volume', 'uniqueTraders'],
      where: { chainId: CHAIN_ID },
      orderBy: 'hourTimestamp',
      limit: 400,
      maxPages: 2,
      maxRecords: 700,
    }),
    fetchAllList({
      queryName: 'marketss',
      filterType: 'marketsFilter',
      fields: [
        'id',
        'chainId',
        'chainName',
        'pollAddress',
        'creator',
        'marketType',
        'marketCloseTimestamp',
        'totalVolume',
        'currentTvl',
        'createdAt',
      ],
      where: { chainId: CHAIN_ID },
      orderBy: 'createdAt',
      limit: 250,
      maxPages: 10,
      maxRecords: 6000,
    }),
    fetchAllList({
      queryName: 'pollss',
      filterType: 'pollsFilter',
      fields: ['id', 'chainId', 'creator', 'question', 'status', 'category', 'deadlineEpoch', 'createdAt', 'resolvedAt'],
      where: { chainId: CHAIN_ID },
      orderBy: 'createdAt',
      limit: 250,
      maxPages: 10,
      maxRecords: 6000,
    }),
    fetchAllList({
      queryName: 'tradess',
      filterType: 'tradesFilter',
      fields: [
        'id',
        'chainId',
        'trader',
        'marketAddress',
        'pollAddress',
        'tradeType',
        'side',
        'collateralAmount',
        'tokenAmount',
        'feeAmount',
        'tokenAmountOut',
        'timestamp',
      ],
      where: { chainId: CHAIN_ID },
      orderBy: 'timestamp',
      limit: 250,
      maxPages: 30,
      maxRecords: 10000,
    }),
    fetchAllList({
      queryName: 'liquidityEventss',
      filterType: 'liquidityEventsFilter',
      fields: [
        'id',
        'chainId',
        'provider',
        'marketAddress',
        'pollAddress',
        'eventType',
        'collateralAmount',
        'lpTokens',
        'yesTokenAmount',
        'noTokenAmount',
        'timestamp',
      ],
      where: { chainId: CHAIN_ID },
      orderBy: 'timestamp',
      limit: 250,
      maxPages: 30,
      maxRecords: 10000,
    }),
    fetchAllList({
      queryName: 'winningss',
      filterType: 'winningsFilter',
      fields: [
        'id',
        'chainId',
        'user',
        'marketAddress',
        'collateralAmount',
        'feeAmount',
        'marketQuestion',
        'marketType',
        'outcome',
        'timestamp',
      ],
      where: { chainId: CHAIN_ID },
      orderBy: 'timestamp',
      limit: 250,
      maxPages: 30,
      maxRecords: 10000,
    }),
    fetchAllList({
      queryName: 'marketUserss',
      filterType: 'marketUsersFilter',
      fields: ['id', 'chainId', 'marketAddress', 'user', 'lastTradeAt'],
      where: { chainId: CHAIN_ID },
      orderBy: 'lastTradeAt',
      limit: 250,
      maxPages: 20,
      maxRecords: 8000,
    }),
    fetchAllList({
      queryName: 'priceTickss',
      filterType: 'priceTicksFilter',
      fields: ['id', 'marketAddress', 'timestamp', 'yesPrice', 'volume', 'side', 'tradeType'],
      where: {},
      orderBy: 'timestamp',
      limit: 250,
      maxPages: 24,
      maxRecords: 5000,
    }),
    fetchAllList({
      queryName: 'disputess',
      filterType: 'disputesFilter',
      fields: [
        'id',
        'chainId',
        'oracle',
        'disputer',
        'state',
        'draftStatus',
        'finalStatus',
        'disputerDeposit',
        'reason',
        'voteCount',
        'votesYes',
        'votesNo',
        'votesUnknown',
        'createdAt',
        'resolvedAt',
      ],
      where: { chainId: CHAIN_ID },
      orderBy: 'createdAt',
      limit: 250,
      maxPages: 10,
      maxRecords: 2000,
    }),
    fetchAllList({
      queryName: 'oracleFeeEventss',
      filterType: 'oracleFeeEventsFilter',
      fields: ['id', 'chainId', 'eventName', 'newFee', 'to', 'amount', 'timestamp'],
      where: { chainId: CHAIN_ID },
      orderBy: 'timestamp',
      limit: 100,
      maxPages: 4,
      maxRecords: 300,
    }),
  ]);

  const platform = platformRows[0] || {};

  const nowSec = Math.floor(Date.now() / 1000);
  const activeMarkets = markets.filter((m) => toNum(m.marketCloseTimestamp) > nowSec);

  const tradeSizes = trades.map((t) => usdcFromRaw(t.collateralAmount)).filter((v) => v > 0);
  const uniqueTraders = new Set(trades.map((t) => String(t.trader || '').toLowerCase()).filter(Boolean));
  const uniqueLps = new Set(liquidityEvents.map((e) => String(e.provider || '').toLowerCase()).filter(Boolean));

  const dailyFromStats = [...dailyRows]
    .sort((a, b) => toNum(a.dayTimestamp) - toNum(b.dayTimestamp))
    .map((d) => ({
      day: epochToDay(d.dayTimestamp),
      marketsCreated: toNum(d.marketsCreated),
      pollsCreated: toNum(d.pollsCreated),
      activeUsers: toNum(d.activeUsers),
      newUsers: toNum(d.newUsers),
      tradesCount: toNum(d.tradesCount),
      volumeUsdc: usdcFromRaw(d.volume),
      winningsUsdc: usdcFromRaw(d.winningsPaid),
    }))
    .filter((d) => d.day);

  let cumulativeMarkets = 0;
  let cumulativeUsers = 0;
  for (const row of dailyFromStats) {
    cumulativeMarkets += row.marketsCreated;
    cumulativeUsers += row.newUsers;
    row.cumulativeMarkets = cumulativeMarkets;
    row.cumulativeUsers = cumulativeUsers;
  }

  const tradesByDayMap = groupByDay(trades, 'timestamp');
  const tradesByDay = toSeries(tradesByDayMap, (rows) => rows.length).map((x) => ({ ...x }));
  const volumeByDay = toSeries(tradesByDayMap, (rows) => rows.reduce((sum, r) => sum + usdcFromRaw(r.collateralAmount), 0));
  const uniqueTradersByDay = toSeries(tradesByDayMap, (rows) => new Set(rows.map((r) => String(r.trader || '').toLowerCase())).size);
  const avgTradeByDay = toSeries(tradesByDayMap, (rows) => {
    const sizes = rows.map((r) => usdcFromRaw(r.collateralAmount));
    if (!sizes.length) return 0;
    return sizes.reduce((a, b) => a + b, 0) / sizes.length;
  });
  const medianTradeByDay = toSeries(tradesByDayMap, (rows) => median(rows.map((r) => usdcFromRaw(r.collateralAmount))));

  const tradeTypeCounts = {};
  for (const t of trades) {
    const key = String(t.tradeType || 'unknown').toLowerCase();
    tradeTypeCounts[key] = (tradeTypeCounts[key] || 0) + 1;
  }
  const tradeTypeSplit = objectEntriesDesc(tradeTypeCounts).map(([tradeType, count]) => ({ tradeType, count }));

  const topMarketsByVolume = topN(
    markets.map((m) => ({
      marketAddress: m.id,
      marketType: m.marketType,
      creator: m.creator,
      totalVolumeUsdc: usdcFromRaw(m.totalVolume),
      currentTvlUsdc: usdcFromRaw(m.currentTvl),
      closeAt: epochToIso(m.marketCloseTimestamp),
    })),
    15,
    'totalVolumeUsdc',
  );

  const creatorAgg = {};
  for (const m of markets) {
    const creator = String(m.creator || '').toLowerCase();
    if (!creator) continue;
    if (!creatorAgg[creator]) {
      creatorAgg[creator] = { creator, marketsCreated: 0, totalVolumeUsdc: 0 };
    }
    creatorAgg[creator].marketsCreated += 1;
    creatorAgg[creator].totalVolumeUsdc += usdcFromRaw(m.totalVolume);
  }
  const creatorsLeaderboard = Object.values(creatorAgg)
    .sort((a, b) => b.marketsCreated - a.marketsCreated || b.totalVolumeUsdc - a.totalVolumeUsdc)
    .slice(0, 20)
    .map((x) => ({ ...x, creatorShort: formatAddress(x.creator) }));

  const marketTypeAgg = { amm: 0, pari: 0, other: 0 };
  for (const m of markets) {
    const mt = String(m.marketType || '').toLowerCase();
    if (mt.includes('amm')) marketTypeAgg.amm += 1;
    else if (mt.includes('pari')) marketTypeAgg.pari += 1;
    else marketTypeAgg.other += 1;
  }
  const marketTypeMix = [
    { label: 'AMM', value: marketTypeAgg.amm },
    { label: 'PariMutuel', value: marketTypeAgg.pari },
    { label: 'Other', value: marketTypeAgg.other },
  ];

  const liquidityByDayMap = groupByDay(liquidityEvents, 'timestamp');
  const liquidityByDay = toSeries(liquidityByDayMap, (rows) => {
    let added = 0;
    let removed = 0;
    for (const row of rows) {
      const amt = usdcFromRaw(row.collateralAmount);
      const evt = String(row.eventType || '').toLowerCase();
      if (evt.includes('remove')) removed += amt;
      else added += amt;
    }
    return { added, removed, net: added - removed };
  }).map((row) => ({
    day: row.day,
    addedUsdc: toNum(row.value.added),
    removedUsdc: toNum(row.value.removed),
    netUsdc: toNum(row.value.net),
  }));

  const lpAgg = {};
  for (const e of liquidityEvents) {
    const provider = String(e.provider || '').toLowerCase();
    if (!provider) continue;
    if (!lpAgg[provider]) {
      lpAgg[provider] = { provider, addedUsdc: 0, removedUsdc: 0, netUsdc: 0, events: 0 };
    }
    const amt = usdcFromRaw(e.collateralAmount);
    const evt = String(e.eventType || '').toLowerCase();
    if (evt.includes('remove')) lpAgg[provider].removedUsdc += amt;
    else lpAgg[provider].addedUsdc += amt;
    lpAgg[provider].netUsdc = lpAgg[provider].addedUsdc - lpAgg[provider].removedUsdc;
    lpAgg[provider].events += 1;
  }
  const topLps = Object.values(lpAgg)
    .sort((a, b) => b.netUsdc - a.netUsdc)
    .slice(0, 20)
    .map((x) => ({ ...x, providerShort: formatAddress(x.provider) }));

  const priceTicksNormalized = priceTicks.map((p) => ({
    ...p,
    yesPrice: yesPriceFromRaw(p.yesPrice),
    volumeUsdc: usdcFromRaw(p.volume),
    day: epochToDay(p.timestamp),
  }));

  const yesPriceByDayMap = groupByDay(priceTicksNormalized, 'timestamp');
  const yesPriceDaily = toSeries(yesPriceByDayMap, (rows) => {
    const weightedVolume = rows.reduce((s, r) => s + toNum(r.volumeUsdc), 0);
    if (weightedVolume <= 0) {
      return rows.reduce((s, r) => s + toNum(r.yesPrice), 0) / (rows.length || 1);
    }
    return rows.reduce((s, r) => s + toNum(r.yesPrice) * toNum(r.volumeUsdc), 0) / weightedVolume;
  });

  const volatilityDaily = toSeries(yesPriceByDayMap, (rows) => {
    const prices = rows.map((r) => toNum(r.yesPrice)).filter((n) => Number.isFinite(n));
    return stddev(prices);
  });

  const outcomeAgg = {};
  for (const w of winnings) {
    const out = String(w.outcome === null || w.outcome === undefined ? 'unknown' : w.outcome);
    outcomeAgg[out] = (outcomeAgg[out] || 0) + 1;
  }
  const outcomeDistribution = objectEntriesDesc(outcomeAgg).map(([outcome, count]) => ({ outcome, count }));

  const disputeDurations = disputes
    .filter((d) => toNum(d.resolvedAt) > toNum(d.createdAt) && toNum(d.createdAt) > 0)
    .map((d) => (toNum(d.resolvedAt) - toNum(d.createdAt)) / 3600);
  const disputeTimeStats = {
    count: disputeDurations.length,
    avgHours: disputeDurations.length ? disputeDurations.reduce((a, b) => a + b, 0) / disputeDurations.length : 0,
    medianHours: disputeDurations.length ? median(disputeDurations) : 0,
    p90Hours: disputeDurations.length
      ? [...disputeDurations].sort((a, b) => a - b)[Math.floor(disputeDurations.length * 0.9)] || 0
      : 0,
  };

  const disputesByDay = toSeries(groupByDay(disputes, 'createdAt'), (rows) => rows.length);

  const redemptionByDay = toSeries(groupByDay(winnings, 'timestamp'), (rows) =>
    rows.reduce((sum, r) => sum + usdcFromRaw(r.collateralAmount), 0),
  );

  const redemptionByMarketTypeAgg = {};
  for (const w of winnings) {
    const key = String(w.marketType || 'unknown').toLowerCase();
    redemptionByMarketTypeAgg[key] = (redemptionByMarketTypeAgg[key] || 0) + usdcFromRaw(w.collateralAmount);
  }
  const redemptionByMarketType = objectEntriesDesc(redemptionByMarketTypeAgg).map(([marketType, totalUsdc]) => ({
    marketType,
    totalUsdc,
  }));

  const unresolvedPastDeadline = polls
    .filter((p) => toNum(p.status) === 0 && toNum(p.deadlineEpoch) > 0 && toNum(p.deadlineEpoch) < nowSec)
    .slice(0, 50)
    .map((p) => ({
      pollId: p.id,
      creator: p.creator,
      question: p.question,
      deadline: epochToIso(p.deadlineEpoch),
      overdueHours: Math.max(0, (nowSec - toNum(p.deadlineEpoch)) / 3600),
    }))
    .sort((a, b) => b.overdueHours - a.overdueHours);

  const nearCloseMarkets = activeMarkets
    .map((m) => ({
      marketAddress: m.id,
      creator: m.creator,
      marketType: m.marketType,
      closeAt: epochToIso(m.marketCloseTimestamp),
      closesInHours: (toNum(m.marketCloseTimestamp) - nowSec) / 3600,
      currentTvlUsdc: usdcFromRaw(m.currentTvl),
      totalVolumeUsdc: usdcFromRaw(m.totalVolume),
    }))
    .filter((m) => m.closesInHours <= 24)
    .sort((a, b) => a.closesInHours - b.closesInHours)
    .slice(0, 30);

  const lowLiquidityActive = activeMarkets
    .map((m) => ({
      marketAddress: m.id,
      marketType: m.marketType,
      creator: m.creator,
      currentTvlUsdc: usdcFromRaw(m.currentTvl),
      totalVolumeUsdc: usdcFromRaw(m.totalVolume),
      closeAt: epochToIso(m.marketCloseTimestamp),
    }))
    .filter((m) => m.currentTvlUsdc <= 250)
    .sort((a, b) => a.currentTvlUsdc - b.currentTvlUsdc)
    .slice(0, 30);

  const currentProtocolFeeWei =
    oracleFeeEvents
      .filter((e) => String(e.eventName || '').toLowerCase().includes('protocolfeeupdated'))
      .sort((a, b) => toNum(b.timestamp) - toNum(a.timestamp))[0]?.newFee || 0;

  const currentOperatorFeeWei =
    oracleFeeEvents
      .filter((e) => String(e.eventName || '').toLowerCase().includes('operatorgasfeeupdated'))
      .sort((a, b) => toNum(b.timestamp) - toNum(a.timestamp))[0]?.newFee || 0;

  const creationFeePerPollEth = ethFromWei(currentProtocolFeeWei) + ethFromWei(currentOperatorFeeWei);
  const refreshFeePerPollEth = creationFeePerPollEth;
  const creationFeePerPollUsd = MODELED_CREATION_FEE_USD;
  const refreshFeePerPollUsd = MODELED_REFRESH_FEE_USD;

  const {
    creationFeeSeries,
    refreshFeeSeries,
    totalCreationFeeUsd,
    totalRefreshFeeUsd,
  } = buildModeledLifecycleFeeLedger({
    dailyRows: dailyFromStats,
    polls,
    creationFeePerPollEth,
    creationFeePerPollUsd,
    refreshFeePerPollEth,
    refreshFeePerPollUsd,
  });

  const feeByDayMap = groupByDay(trades, 'timestamp');
  const feeDaily = toSeries(feeByDayMap, (rows) => rows.reduce((sum, r) => sum + usdcFromRaw(r.feeAmount), 0));

  const winningsFeeDaily = toSeries(groupByDay(winnings, 'timestamp'), (rows) =>
    rows.reduce((sum, r) => sum + usdcFromRaw(r.feeAmount), 0),
  );

  const { feeDailyMerged, cumulativeFees } = mergeFeeBreakdownByDay({
    tradingFeeDaily: feeDaily,
    redemptionFeeDaily: winningsFeeDaily,
    creationFeeSeries,
    refreshFeeSeries,
  });

  const topTraderAgg = {};
  for (const t of trades) {
    const trader = String(t.trader || '').toLowerCase();
    if (!trader) continue;
    topTraderAgg[trader] = (topTraderAgg[trader] || 0) + usdcFromRaw(t.collateralAmount);
  }
  const topTraders = objectEntriesDesc(topTraderAgg)
    .slice(0, 20)
    .map(([trader, totalUsdc]) => ({ trader, traderShort: formatAddress(trader), totalUsdc }));

  const topTraderShare = (() => {
    const total = Object.values(topTraderAgg).reduce((a, b) => a + b, 0);
    if (!total) return 0;
    const top10 = objectEntriesDesc(topTraderAgg)
      .slice(0, 10)
      .reduce((sum, [, v]) => sum + v, 0);
    return top10 / total;
  })();

  const marketByAddress = new Map(markets.map((m) => [String(m.id || '').toLowerCase(), m]));
  const pollById = new Map(polls.map((p) => [String(p.id || '').toLowerCase(), p]));
  const pollMarketCount = {};
  const pollToMarketAddress = {};
  for (const m of markets) {
    const pollKey = String(m.pollAddress || '').toLowerCase();
    const marketKey = String(m.id || '').toLowerCase();
    if (!pollKey || !marketKey) continue;
    pollMarketCount[pollKey] = (pollMarketCount[pollKey] || 0) + 1;
    if (!pollToMarketAddress[pollKey]) pollToMarketAddress[pollKey] = marketKey;
  }

  const marketUsersCount = {};
  for (const mu of marketUsers) {
    const mk = String(mu.marketAddress || '').toLowerCase();
    if (!mk) continue;
    marketUsersCount[mk] = (marketUsersCount[mk] || 0) + 1;
  }

  const walletStats = {};
  const walletTradeMarkets = {};
  const walletRedeemMarkets = {};
  const walletMarketVolume = {};
  for (const t of trades) {
    const trader = String(t.trader || '').toLowerCase();
    if (!trader) continue;
    const marketKey = String(t.marketAddress || '').toLowerCase();
    const type = String(t.tradeType || '').toLowerCase();
    const amountUsdc = usdcFromRaw(t.collateralAmount);
    const feeUsdc = usdcFromRaw(t.feeAmount);

    if (!walletStats[trader]) {
      walletStats[trader] = {
        wallet: trader,
        buysUsdc: 0,
        sellsUsdc: 0,
        winningsUsdc: 0,
        feesPaidUsdc: 0,
        volumeUsdc: 0,
        tradeCount: 0,
        redemptionsCount: 0,
      };
      walletTradeMarkets[trader] = new Set();
      walletRedeemMarkets[trader] = new Set();
      walletMarketVolume[trader] = {};
    }

    if (type.includes('sell')) walletStats[trader].sellsUsdc += amountUsdc;
    else walletStats[trader].buysUsdc += amountUsdc;

    walletStats[trader].feesPaidUsdc += feeUsdc;
    walletStats[trader].volumeUsdc += amountUsdc;
    walletStats[trader].tradeCount += 1;
    if (marketKey) {
      walletTradeMarkets[trader].add(marketKey);
      walletMarketVolume[trader][marketKey] = (walletMarketVolume[trader][marketKey] || 0) + amountUsdc;
    }
  }

  for (const w of winnings) {
    const wallet = String(w.user || '').toLowerCase();
    if (!wallet) continue;
    const marketKey = String(w.marketAddress || '').toLowerCase();
    const amountUsdc = usdcFromRaw(w.collateralAmount);
    const feeUsdc = usdcFromRaw(w.feeAmount);

    if (!walletStats[wallet]) {
      walletStats[wallet] = {
        wallet,
        buysUsdc: 0,
        sellsUsdc: 0,
        winningsUsdc: 0,
        feesPaidUsdc: 0,
        volumeUsdc: 0,
        tradeCount: 0,
        redemptionsCount: 0,
      };
      walletTradeMarkets[wallet] = new Set();
      walletRedeemMarkets[wallet] = new Set();
      walletMarketVolume[wallet] = {};
    }

    walletStats[wallet].winningsUsdc += amountUsdc;
    walletStats[wallet].feesPaidUsdc += feeUsdc;
    walletStats[wallet].redemptionsCount += 1;
    if (marketKey) walletRedeemMarkets[wallet].add(marketKey);
  }

  const walletPnlLeaderboard = Object.values(walletStats)
    .map((row) => {
      const netPnlUsdc = row.sellsUsdc + row.winningsUsdc - row.buysUsdc - row.feesPaidUsdc;
      return {
        wallet: row.wallet,
        walletShort: formatAddress(row.wallet),
        totalBuysUsdc: row.buysUsdc,
        totalSellsUsdc: row.sellsUsdc,
        winningsUsdc: row.winningsUsdc,
        feesPaidUsdc: row.feesPaidUsdc,
        netPnlUsdc,
      };
    })
    .sort((a, b) => b.netPnlUsdc - a.netPnlUsdc)
    .slice(0, 30);

  const traderWinRate = Object.values(walletStats)
    .map((row) => {
      const wallet = row.wallet;
      const marketsTraded = (walletTradeMarkets[wallet] || new Set()).size;
      const wins = (walletRedeemMarkets[wallet] || new Set()).size;
      const losses = Math.max(0, marketsTraded - wins);
      return {
        wallet,
        walletShort: formatAddress(wallet),
        marketsTraded,
        wins,
        losses,
        winRate: safeDivide(wins, marketsTraded),
      };
    })
    .filter((row) => row.marketsTraded > 0)
    .sort((a, b) => b.winRate - a.winRate || b.marketsTraded - a.marketsTraded)
    .slice(0, 30);

  const traderFirstTradeDay = {};
  const traderDaysActive = {};
  const tradersByDay = {};
  for (const t of trades) {
    const wallet = String(t.trader || '').toLowerCase();
    const day = epochToDay(t.timestamp);
    if (!wallet || !day) continue;
    if (!traderFirstTradeDay[wallet] || day < traderFirstTradeDay[wallet]) {
      traderFirstTradeDay[wallet] = day;
    }
    if (!traderDaysActive[wallet]) traderDaysActive[wallet] = new Set();
    traderDaysActive[wallet].add(day);
    if (!tradersByDay[day]) tradersByDay[day] = new Set();
    tradersByDay[day].add(wallet);
  }

  const newVsReturningTradersDaily = Object.entries(tradersByDay)
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([day, wallets]) => {
      let newTraders = 0;
      for (const wallet of wallets) {
        if (traderFirstTradeDay[wallet] === day) newTraders += 1;
      }
      const total = wallets.size;
      const returningTraders = Math.max(0, total - newTraders);
      return {
        day,
        newTraders,
        returningTraders,
        totalTraders: total,
        shareNew: safeDivide(newTraders, total),
      };
    });

  const cohortMap = {};
  for (const [wallet, firstDay] of Object.entries(traderFirstTradeDay)) {
    if (!cohortMap[firstDay]) cohortMap[firstDay] = new Set();
    cohortMap[firstDay].add(wallet);
  }
  const traderRetentionCohorts = Object.entries(cohortMap)
    .sort((a, b) => String(b[0]).localeCompare(String(a[0])))
    .slice(0, 40)
    .map(([cohortDay, wallets]) => {
      const csize = wallets.size;
      const d1Day = addDaysToDay(cohortDay, 1);
      const d7Day = addDaysToDay(cohortDay, 7);
      const d30Day = addDaysToDay(cohortDay, 30);
      let d1 = 0;
      let d7 = 0;
      let d30 = 0;
      for (const wallet of wallets) {
        const days = traderDaysActive[wallet] || new Set();
        if (d1Day && days.has(d1Day)) d1 += 1;
        if (d7Day && days.has(d7Day)) d7 += 1;
        if (d30Day && days.has(d30Day)) d30 += 1;
      }
      return {
        cohortDay,
        cohortSize: csize,
        d1Retained: d1,
        d1Rate: safeDivide(d1, csize),
        d7Retained: d7,
        d7Rate: safeDivide(d7, csize),
        d30Retained: d30,
        d30Rate: safeDivide(d30, csize),
      };
    });

  const whaleActivity = Object.values(walletStats)
    .map((row) => {
      const wallet = row.wallet;
      const marketsTouched = (walletTradeMarkets[wallet] || new Set()).size;
      const marketVolumeMap = walletMarketVolume[wallet] || {};
      const topMarket = Object.entries(marketVolumeMap).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      return {
        wallet,
        walletShort: formatAddress(wallet),
        totalVolumeUsdc: row.volumeUsdc,
        avgTradeSizeUsdc: safeDivide(row.volumeUsdc, row.tradeCount),
        marketsTouched,
        topMarket,
        topMarketShort: formatAddress(topMarket),
      };
    })
    .sort((a, b) => b.totalVolumeUsdc - a.totalVolumeUsdc)
    .slice(0, 30);

  const tradingFeeByMarket = {};
  for (const t of trades) {
    const mk = String(t.marketAddress || '').toLowerCase();
    if (!mk) continue;
    tradingFeeByMarket[mk] = (tradingFeeByMarket[mk] || 0) + usdcFromRaw(t.feeAmount);
  }
  const redemptionFeeByMarket = {};
  for (const w of winnings) {
    const mk = String(w.marketAddress || '').toLowerCase();
    if (!mk) continue;
    redemptionFeeByMarket[mk] = (redemptionFeeByMarket[mk] || 0) + usdcFromRaw(w.feeAmount);
  }

  const marketProfitability = markets
    .map((m) => {
      const mk = String(m.id || '').toLowerCase();
      const pollKey = String(m.pollAddress || '').toLowerCase();
      const poll = pollById.get(pollKey) || null;
      const perPollMarketCount = Math.max(1, pollMarketCount[pollKey] || 1);
      const lifecycleEventEpoch = resolvePollLifecycleEventEpoch(poll);
      const refreshApplied = lifecycleEventEpoch > 0;
      const creationFeeEth = creationFeePerPollEth / perPollMarketCount;
      const refreshFeeEth = refreshApplied ? refreshFeePerPollEth / perPollMarketCount : 0;
      const creationFeeUsd = creationFeePerPollUsd / perPollMarketCount;
      const refreshFeeUsd = refreshApplied ? refreshFeePerPollUsd / perPollMarketCount : 0;
      const tradingFeesUsdc = tradingFeeByMarket[mk] || 0;
      const redemptionFeesUsdc = redemptionFeeByMarket[mk] || 0;
      return {
        marketAddress: mk,
        marketShort: formatAddress(mk),
        marketType: m.marketType,
        volumeUsdc: usdcFromRaw(m.totalVolume),
        tradingFeesUsdc,
        redemptionFeesUsdc,
        creationFeeEth,
        refreshFeeEth,
        creationFeeUsd,
        refreshFeeUsd,
        totalProtocolTakeUsd: tradingFeesUsdc + redemptionFeesUsdc + creationFeeUsd + refreshFeeUsd,
      };
    })
    .sort((a, b) => b.totalProtocolTakeUsd - a.totalProtocolTakeUsd)
    .slice(0, 40);

  const totalTradingFeesUsdc = trades.reduce((sum, t) => sum + usdcFromRaw(t.feeAmount), 0);
  const totalRedemptionFeesUsdc = winnings.reduce((sum, w) => sum + usdcFromRaw(w.feeAmount), 0);
  const totalFeesGeneratedUsd = totalTradingFeesUsdc + totalRedemptionFeesUsdc + totalCreationFeeUsd + totalRefreshFeeUsd;
  const positiveNetLiquidityTotal = Object.values(lpAgg).reduce((sum, lp) => sum + Math.max(lp.netUsdc, 0), 0);
  const lpRoiPerformance = Object.values(lpAgg)
    .map((lp) => {
      const positiveNet = Math.max(lp.netUsdc, 0);
      const feeShareProxyUsdc = totalTradingFeesUsdc * safeDivide(positiveNet, positiveNetLiquidityTotal);
      const estRoi = safeDivide(feeShareProxyUsdc, Math.max(lp.addedUsdc, 1));
      return {
        provider: lp.provider,
        providerShort: formatAddress(lp.provider),
        addedUsdc: lp.addedUsdc,
        removedUsdc: lp.removedUsdc,
        netUsdc: lp.netUsdc,
        feeShareProxyUsdc,
        estRoi,
      };
    })
    .sort((a, b) => b.feeShareProxyUsdc - a.feeShareProxyUsdc)
    .slice(0, 40);

  const liquidityUtilizationByMarket = markets
    .map((m) => {
      const mk = String(m.id || '').toLowerCase();
      const volumeUsdc = usdcFromRaw(m.totalVolume);
      const currentTvlUsdc = usdcFromRaw(m.currentTvl);
      return {
        marketAddress: mk,
        marketShort: formatAddress(mk),
        marketType: m.marketType,
        volumeUsdc,
        avgTvlUsdc: currentTvlUsdc,
        volumeToTvlRatio: safeDivide(volumeUsdc, Math.max(currentTvlUsdc, 1)),
        activeTraders: marketUsersCount[mk] || 0,
      };
    })
    .sort((a, b) => b.volumeToTvlRatio - a.volumeToTvlRatio || b.volumeUsdc - a.volumeUsdc)
    .slice(0, 40);

  const creatorPollAgg = {};
  for (const p of polls) {
    const creator = String(p.creator || '').toLowerCase();
    if (!creator) continue;
    if (!creatorPollAgg[creator]) {
      creatorPollAgg[creator] = {
        totalPolls: 0,
        resolvedPolls: 0,
        lifecycleHoursSum: 0,
        lifecycleCount: 0,
      };
    }
    creatorPollAgg[creator].totalPolls += 1;
    if (toNum(p.status) !== 0) {
      creatorPollAgg[creator].resolvedPolls += 1;
      const created = toNum(p.createdAt);
      const deadline = toNum(p.deadlineEpoch);
      if (deadline > created && created > 0) {
        creatorPollAgg[creator].lifecycleHoursSum += (deadline - created) / 3600;
        creatorPollAgg[creator].lifecycleCount += 1;
      }
    }
  }
  const creatorDisputeAgg = {};
  for (const d of disputes) {
    const disputer = String(d.disputer || '').toLowerCase();
    const oracle = String(d.oracle || '').toLowerCase();
    if (disputer) creatorDisputeAgg[disputer] = (creatorDisputeAgg[disputer] || 0) + 1;
    if (oracle) creatorDisputeAgg[oracle] = (creatorDisputeAgg[oracle] || 0) + 1;
  }
  const creatorQuality = Object.values(creatorAgg)
    .map((c) => {
      const creator = c.creator;
      const pollStats = creatorPollAgg[creator] || { totalPolls: 0, resolvedPolls: 0, lifecycleHoursSum: 0, lifecycleCount: 0 };
      const disputesByCreator = creatorDisputeAgg[creator] || 0;
      return {
        creator,
        creatorShort: formatAddress(creator),
        marketsCreated: c.marketsCreated,
        avgVolumeUsdc: safeDivide(c.totalVolumeUsdc, c.marketsCreated),
        resolveRate: safeDivide(pollStats.resolvedPolls, pollStats.totalPolls),
        avgTimeToResolutionHours: safeDivide(pollStats.lifecycleHoursSum, pollStats.lifecycleCount),
        disputeRate: safeDivide(disputesByCreator, c.marketsCreated),
      };
    })
    .sort((a, b) => b.marketsCreated - a.marketsCreated || b.avgVolumeUsdc - a.avgVolumeUsdc)
    .slice(0, 40);

  const pollCreationFeeTable = polls
    .map((p) => {
      const pollKey = String(p.id || '').toLowerCase();
      const lifecycleEventEpoch = resolvePollLifecycleEventEpoch(p);
      const refreshApplied = lifecycleEventEpoch > 0;
      return {
        pollId: pollKey,
        pollShort: formatAddress(pollKey),
        creator: String(p.creator || '').toLowerCase(),
        creatorShort: formatAddress(String(p.creator || '').toLowerCase()),
        question: p.question || '',
        createdAt: epochToIso(p.createdAt),
        resolvedAt: refreshApplied ? epochToIso(lifecycleEventEpoch) : null,
        status: refreshApplied ? 'resolved_or_closed' : 'unresolved',
        creationFeeUsd: creationFeePerPollUsd,
        refreshFeeUsd: refreshApplied ? refreshFeePerPollUsd : 0,
        totalLifecycleFeeUsd: creationFeePerPollUsd + (refreshApplied ? refreshFeePerPollUsd : 0),
      };
    })
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 100);

  const resolutionSlaOverdue = polls
    .map((p) => {
      const pollKey = String(p.id || '').toLowerCase();
      const deadline = toNum(p.deadlineEpoch);
      const status = toNum(p.status);
      const lifecycleEventEpoch = resolvePollLifecycleEventEpoch(p);
      const overdueHours = deadline > 0 && nowSec > deadline && status === 0 ? (nowSec - deadline) / 3600 : 0;
      return {
        pollId: pollKey,
        pollShort: formatAddress(pollKey),
        marketAddress: pollToMarketAddress[pollKey] || '',
        marketShort: formatAddress(pollToMarketAddress[pollKey] || ''),
        deadline: epochToIso(p.deadlineEpoch),
        resolvedAt: status === 0 ? null : epochToIso(lifecycleEventEpoch),
        status: status === 0 ? 'unresolved' : 'resolved_or_closed',
        hoursOverdue: overdueHours,
      };
    })
    .sort((a, b) => b.hoursOverdue - a.hoursOverdue)
    .slice(0, 50);

  const market24hTradeAgg = {};
  const since24h = nowSec - 86400;
  for (const t of trades) {
    const ts = toNum(t.timestamp);
    if (ts < since24h) continue;
    const mk = String(t.marketAddress || '').toLowerCase();
    const trader = String(t.trader || '').toLowerCase();
    if (!mk) continue;
    if (!market24hTradeAgg[mk]) {
      market24hTradeAgg[mk] = { volumeLast24hUsdc: 0, tradesLast24h: 0, traders: new Set() };
    }
    market24hTradeAgg[mk].volumeLast24hUsdc += usdcFromRaw(t.collateralAmount);
    market24hTradeAgg[mk].tradesLast24h += 1;
    if (trader) market24hTradeAgg[mk].traders.add(trader);
  }
  const preCloseRush = Object.entries(market24hTradeAgg)
    .map(([marketAddress, agg]) => {
      const market = marketByAddress.get(marketAddress);
      return {
        marketAddress,
        marketShort: formatAddress(marketAddress),
        marketType: market?.marketType || 'unknown',
        closeAt: epochToIso(market?.marketCloseTimestamp),
        volumeLast24hUsdc: agg.volumeLast24hUsdc,
        tradesLast24h: agg.tradesLast24h,
        uniqueTradersLast24h: agg.traders.size,
      };
    })
    .sort((a, b) => b.volumeLast24hUsdc - a.volumeLast24hUsdc)
    .slice(0, 40);

  const priceTicksByMarket = {};
  for (const pt of priceTicksNormalized) {
    const mk = String(pt.marketAddress || '').toLowerCase();
    if (!mk || !Number.isFinite(toNum(pt.yesPrice))) continue;
    if (!priceTicksByMarket[mk]) priceTicksByMarket[mk] = [];
    priceTicksByMarket[mk].push(pt);
  }
  for (const arr of Object.values(priceTicksByMarket)) {
    arr.sort((a, b) => toNum(a.timestamp) - toNum(b.timestamp));
  }
  const priceShockRiskAlerts = Object.entries(priceTicksByMarket)
    .map(([marketAddress, arr]) => {
      const latest = arr[arr.length - 1];
      const latestTs = toNum(latest.timestamp);
      const target1h = latestTs - 3600;
      const target24h = latestTs - 86400;
      let p1h = latest;
      let p24h = latest;
      for (let i = arr.length - 1; i >= 0; i -= 1) {
        if (toNum(arr[i].timestamp) <= target1h) {
          p1h = arr[i];
          break;
        }
      }
      for (let i = arr.length - 1; i >= 0; i -= 1) {
        if (toNum(arr[i].timestamp) <= target24h) {
          p24h = arr[i];
          break;
        }
      }
      const move1h = toNum(latest.yesPrice) - toNum(p1h.yesPrice);
      const move24h = toNum(latest.yesPrice) - toNum(p24h.yesPrice);
      const market = marketByAddress.get(marketAddress);
      const liquidityUsdc = usdcFromRaw(market?.currentTvl);
      let riskFlag = 'normal';
      if (Math.abs(move24h) >= 0.15) riskFlag = 'high_price_shock_24h';
      else if (Math.abs(move1h) >= 0.08) riskFlag = 'intraday_spike_1h';
      else if (liquidityUsdc <= 250) riskFlag = 'low_liquidity';
      return {
        marketAddress,
        marketShort: formatAddress(marketAddress),
        yesPriceMove1h: move1h,
        yesPriceMove24h: move24h,
        liquidityUsdc,
        riskFlag,
      };
    })
    .sort((a, b) => Math.abs(b.yesPriceMove24h) - Math.abs(a.yesPriceMove24h))
    .slice(0, 40);

  const yesNoFlowAgg = {};
  for (const t of trades) {
    const side = String(t.side || '').toLowerCase();
    const mk = String(t.marketAddress || '').toLowerCase();
    const day = epochToDay(t.timestamp);
    if (!mk || !day) continue;
    const key = `${mk}:${day}`;
    if (!yesNoFlowAgg[key]) {
      yesNoFlowAgg[key] = { marketAddress: mk, day, yesVolumeUsdc: 0, noVolumeUsdc: 0 };
    }
    const amt = usdcFromRaw(t.collateralAmount);
    if (side.includes('yes')) yesNoFlowAgg[key].yesVolumeUsdc += amt;
    else if (side.includes('no')) yesNoFlowAgg[key].noVolumeUsdc += amt;
  }
  const yesNoFlowImbalance = Object.values(yesNoFlowAgg)
    .map((row) => {
      const total = row.yesVolumeUsdc + row.noVolumeUsdc;
      return {
        ...row,
        marketShort: formatAddress(row.marketAddress),
        totalVolumeUsdc: total,
        imbalanceRatio: safeDivide(row.yesVolumeUsdc - row.noVolumeUsdc, Math.max(total, 1)),
      };
    })
    .sort((a, b) => Math.abs(b.imbalanceRatio) - Math.abs(a.imbalanceRatio) || b.totalVolumeUsdc - a.totalVolumeUsdc)
    .slice(0, 50);

  const feeByWallet = {};
  for (const t of trades) {
    const wallet = String(t.trader || '').toLowerCase();
    if (!wallet) continue;
    feeByWallet[wallet] = (feeByWallet[wallet] || 0) + usdcFromRaw(t.feeAmount);
  }
  for (const w of winnings) {
    const wallet = String(w.user || '').toLowerCase();
    if (!wallet) continue;
    feeByWallet[wallet] = (feeByWallet[wallet] || 0) + usdcFromRaw(w.feeAmount);
  }
  for (const p of polls) {
    const creator = String(p.creator || '').toLowerCase();
    if (!creator) continue;
    feeByWallet[creator] = (feeByWallet[creator] || 0) + creationFeePerPollUsd;
    if (resolvePollLifecycleEventEpoch(p) > 0) {
      feeByWallet[creator] += refreshFeePerPollUsd;
    }
  }
  const feeByMarketTotal = Object.fromEntries(marketProfitability.map((row) => [row.marketAddress, row.totalProtocolTakeUsd]));
  const totalFeesForConcentration =
    Object.values(feeByWallet).reduce((a, b) => a + b, 0) + Object.values(feeByMarketTotal).reduce((a, b) => a + b, 0);
  const feeConcentration = [];
  let cumulativeMarketShare = 0;
  objectEntriesDesc(feeByMarketTotal)
    .slice(0, 15)
    .forEach(([marketAddress, feeUsdc], idx) => {
      const share = safeDivide(feeUsdc, totalFeesForConcentration);
      cumulativeMarketShare += share;
      feeConcentration.push({
        entityType: 'market',
        rank: idx + 1,
        entity: formatAddress(marketAddress),
        feeUsdc,
        share,
        cumulativeShare: cumulativeMarketShare,
      });
    });
  let cumulativeWalletShare = 0;
  objectEntriesDesc(feeByWallet)
    .slice(0, 15)
    .forEach(([wallet, feeUsdc], idx) => {
      const share = safeDivide(feeUsdc, totalFeesForConcentration);
      cumulativeWalletShare += share;
      feeConcentration.push({
        entityType: 'wallet',
        rank: idx + 1,
        entity: formatAddress(wallet),
        feeUsdc,
        share,
        cumulativeShare: cumulativeWalletShare,
      });
    });

  const redemptionByMarketAgg = {};
  for (const w of winnings) {
    const mk = String(w.marketAddress || '').toLowerCase();
    if (!mk) continue;
    if (!redemptionByMarketAgg[mk]) {
      redemptionByMarketAgg[mk] = { firstRedeemTs: 0, redeemedAmountUsdc: 0 };
    }
    const ts = toNum(w.timestamp);
    if (!redemptionByMarketAgg[mk].firstRedeemTs || ts < redemptionByMarketAgg[mk].firstRedeemTs) {
      redemptionByMarketAgg[mk].firstRedeemTs = ts;
    }
    redemptionByMarketAgg[mk].redeemedAmountUsdc += usdcFromRaw(w.collateralAmount);
  }
  const redemptionEfficiency = Object.entries(redemptionByMarketAgg)
    .map(([marketAddress, agg]) => {
      const market = marketByAddress.get(marketAddress);
      const closeTs = toNum(market?.marketCloseTimestamp);
      const firstRedeemTs = toNum(agg.firstRedeemTs);
      const hoursToFirstRedeem =
        closeTs > 0 && firstRedeemTs > 0 ? Math.max(0, (firstRedeemTs - closeTs) / 3600) : 0;
      return {
        marketAddress,
        marketShort: formatAddress(marketAddress),
        resolvedAtProxy: epochToIso(closeTs),
        firstRedeemAt: epochToIso(firstRedeemTs),
        hoursToFirstRedeem,
        redeemedAmountUsdc: agg.redeemedAmountUsdc,
      };
    })
    .sort((a, b) => b.redeemedAmountUsdc - a.redeemedAmountUsdc)
    .slice(0, 40);

  const panels = [
    {
      key: 'total_markets',
      title: 'Total Markets',
      type: 'kpi',
      value: toNum(platform.totalMarkets) || markets.length,
      format: 'integer',
      subtitle: 'Ethereum mainnet Pandora markets',
    },
    {
      key: 'total_traders',
      title: 'Total Traders',
      type: 'kpi',
      value: toNum(platform.totalUsers) || uniqueTraders.size,
      format: 'integer',
      subtitle: 'Unique traders recorded by indexer',
    },
    {
      key: 'total_volume',
      title: 'Total Volume (USDC)',
      type: 'kpi',
      value: usdcFromRaw(platform.totalVolume) || markets.reduce((s, m) => s + usdcFromRaw(m.totalVolume), 0),
      format: 'currency',
      subtitle: 'All-time notional volume',
    },
    {
      key: 'total_fees_generated',
      title: 'Total Fees Generated (USD)',
      type: 'kpi',
      value: totalFeesGeneratedUsd,
      format: 'currency',
      subtitle: 'Trading + redemption + modeled creation/refresh fees',
    },
    {
      key: 'total_redemptions',
      title: 'Total Redemptions (USDC)',
      type: 'kpi',
      value: usdcFromRaw(platform.totalWinningsPaid) || winnings.reduce((s, w) => s + usdcFromRaw(w.collateralAmount), 0),
      format: 'currency',
      subtitle: 'Winnings paid out',
    },
    {
      key: 'daily_markets_created',
      title: 'Daily Markets Created',
      type: 'timeseries',
      series: dailyFromStats.map((d) => ({ x: d.day, y: d.marketsCreated })),
      yFormat: 'integer',
    },
    {
      key: 'cumulative_markets',
      title: 'Cumulative Markets',
      type: 'timeseries',
      series: dailyFromStats.map((d) => ({ x: d.day, y: d.cumulativeMarkets })),
      yFormat: 'integer',
    },
    {
      key: 'daily_active_traders',
      title: 'Daily Active Traders',
      type: 'timeseries',
      series: dailyFromStats.map((d) => ({ x: d.day, y: d.activeUsers })),
      yFormat: 'integer',
    },
    {
      key: 'cumulative_traders',
      title: 'Cumulative New Users',
      type: 'timeseries',
      series: dailyFromStats.map((d) => ({ x: d.day, y: d.cumulativeUsers })),
      yFormat: 'integer',
    },
    {
      key: 'amm_vs_parimutuel_mix',
      title: 'AMM vs PariMutuel Mix',
      type: 'distribution',
      rows: marketTypeMix,
      labelKey: 'label',
      valueKey: 'value',
      valueFormat: 'integer',
    },
    {
      key: 'creators_leaderboard',
      title: 'Creators Leaderboard',
      type: 'table',
      columns: [
        { key: 'creatorShort', label: 'Creator' },
        { key: 'marketsCreated', label: 'Markets', format: 'integer' },
        { key: 'totalVolumeUsdc', label: 'Volume USDC', format: 'currency' },
      ],
      rows: creatorsLeaderboard,
    },
    {
      key: 'poll_creation_fee_table',
      title: 'Poll Creation Fee Table',
      type: 'table',
      columns: [
        { key: 'pollShort', label: 'Poll' },
        { key: 'creatorShort', label: 'Creator' },
        { key: 'question', label: 'Question' },
        { key: 'createdAt', label: 'Created At' },
        { key: 'resolvedAt', label: 'Resolved At' },
        { key: 'status', label: 'Status' },
        { key: 'creationFeeUsd', label: 'Creation Fee', format: 'currency' },
        { key: 'refreshFeeUsd', label: 'Refresh Fee', format: 'currency' },
        { key: 'totalLifecycleFeeUsd', label: 'Total Fee', format: 'currency' },
      ],
      rows: pollCreationFeeTable,
      notes: [
        `Creation fee is modeled at ${creationFeePerPollUsd.toFixed(2)} USD per poll.`,
        `Refresh fee is modeled at ${refreshFeePerPollUsd.toFixed(2)} USD once a poll resolves/closes.`,
      ],
    },
    {
      key: 'daily_trading_volume',
      title: 'Daily Trading Volume (USDC)',
      type: 'timeseries',
      series: volumeByDay.map((d) => ({ x: d.day, y: d.value })),
      yFormat: 'currency',
    },
    {
      key: 'trade_count_and_unique_traders',
      title: 'Trade Count vs Unique Traders',
      type: 'multiseries',
      series: [
        {
          name: 'Trade Count',
          points: tradesByDay.map((d) => ({ x: d.day, y: d.value })),
          yFormat: 'integer',
        },
        {
          name: 'Unique Traders',
          points: uniqueTradersByDay.map((d) => ({ x: d.day, y: d.value })),
          yFormat: 'integer',
        },
      ],
    },
    {
      key: 'buy_vs_sell_split',
      title: 'Buy vs Sell Trade Type Split',
      type: 'distribution',
      rows: tradeTypeSplit,
      labelKey: 'tradeType',
      valueKey: 'count',
      valueFormat: 'integer',
    },
    {
      key: 'avg_median_trade_size',
      title: 'Average vs Median Trade Size (USDC)',
      type: 'multiseries',
      series: [
        {
          name: 'Average',
          points: avgTradeByDay.map((d) => ({ x: d.day, y: d.value })),
          yFormat: 'currency',
        },
        {
          name: 'Median',
          points: medianTradeByDay.map((d) => ({ x: d.day, y: d.value })),
          yFormat: 'currency',
        },
      ],
    },
    {
      key: 'top_markets_by_volume',
      title: 'Top Markets by Volume',
      type: 'table',
      columns: [
        { key: 'marketAddress', label: 'Market' },
        { key: 'marketType', label: 'Type' },
        { key: 'totalVolumeUsdc', label: 'Volume USDC', format: 'currency' },
        { key: 'currentTvlUsdc', label: 'TVL USDC', format: 'currency' },
      ],
      rows: topMarketsByVolume,
    },
    {
      key: 'added_removed_net_liquidity',
      title: 'Added / Removed / Net Liquidity (USDC)',
      type: 'multiseries',
      series: [
        {
          name: 'Added',
          points: liquidityByDay.map((d) => ({ x: d.day, y: d.addedUsdc })),
          yFormat: 'currency',
        },
        {
          name: 'Removed',
          points: liquidityByDay.map((d) => ({ x: d.day, y: d.removedUsdc })),
          yFormat: 'currency',
        },
        {
          name: 'Net',
          points: liquidityByDay.map((d) => ({ x: d.day, y: d.netUsdc })),
          yFormat: 'currency',
        },
      ],
    },
    {
      key: 'top_lp_wallets',
      title: 'Top LP Wallets by Net Liquidity',
      type: 'table',
      columns: [
        { key: 'providerShort', label: 'LP' },
        { key: 'addedUsdc', label: 'Added', format: 'currency' },
        { key: 'removedUsdc', label: 'Removed', format: 'currency' },
        { key: 'netUsdc', label: 'Net', format: 'currency' },
      ],
      rows: topLps,
    },
    {
      key: 'yes_probability_trend',
      title: 'YES Probability Trend (VWAP)',
      type: 'timeseries',
      series: yesPriceDaily.map((d) => ({ x: d.day, y: d.value })),
      yFormat: 'percent',
    },
    {
      key: 'volatility_proxy',
      title: 'Volatility Proxy (StdDev of YES Price)',
      type: 'timeseries',
      series: volatilityDaily.map((d) => ({ x: d.day, y: d.value })),
      yFormat: 'percent',
    },
    {
      key: 'outcome_distribution',
      title: 'Outcome Distribution (Winnings)',
      type: 'distribution',
      rows: outcomeDistribution,
      labelKey: 'outcome',
      valueKey: 'count',
      valueFormat: 'integer',
    },
    {
      key: 'time_to_resolution',
      title: 'Time to Resolution (Disputes)',
      type: 'kpi_group',
      items: [
        { label: 'Resolved Disputes', value: disputeTimeStats.count, format: 'integer' },
        { label: 'Avg Hours', value: disputeTimeStats.avgHours, format: 'decimal' },
        { label: 'Median Hours', value: disputeTimeStats.medianHours, format: 'decimal' },
        { label: 'P90 Hours', value: disputeTimeStats.p90Hours, format: 'decimal' },
      ],
    },
    {
      key: 'redemption_amounts_over_time',
      title: 'Redemption Amounts Over Time (USDC)',
      type: 'timeseries',
      series: redemptionByDay.map((d) => ({ x: d.day, y: d.value })),
      yFormat: 'currency',
    },
    {
      key: 'low_liquidity_and_near_close_markets',
      title: 'Low-Liquidity and Near-Close Active Markets',
      type: 'table',
      columns: [
        { key: 'marketAddress', label: 'Market' },
        { key: 'marketType', label: 'Type' },
        { key: 'currentTvlUsdc', label: 'TVL', format: 'currency' },
        { key: 'closeAt', label: 'Close Time' },
      ],
      rows: [...lowLiquidityActive.slice(0, 12), ...nearCloseMarkets.slice(0, 12)],
    },
    {
      key: 'daily_fees_usd_including_creation_eth',
      title: 'Daily Fees Generated (USD)',
      type: 'multiseries',
      series: [
        {
          name: 'Trading Fees',
          points: feeDailyMerged.map((d) => ({ x: d.day, y: d.tradingFeeUsdc })),
          yFormat: 'currency',
        },
        {
          name: 'Redemption Fees',
          points: feeDailyMerged.map((d) => ({ x: d.day, y: d.redemptionFeeUsdc })),
          yFormat: 'currency',
        },
        {
          name: 'Creation Fees (Modeled)',
          points: feeDailyMerged.map((d) => ({ x: d.day, y: d.creationFeeUsd })),
          yFormat: 'currency',
        },
        {
          name: 'Refresh Fees (Modeled)',
          points: feeDailyMerged.map((d) => ({ x: d.day, y: d.refreshFeeUsd })),
          yFormat: 'currency',
        },
      ],
      notes: [
        `Creation fee is modeled at ${creationFeePerPollUsd.toFixed(2)} USD per poll created.`,
        `Refresh fee is modeled at ${refreshFeePerPollUsd.toFixed(2)} USD per poll resolved/closed.`,
        `Current raw on-chain creation fee setting is ${creationFeePerPollEth.toFixed(6)} ETH (protocol + operator).`,
      ],
    },
    {
      key: 'cumulative_fees_usd_including_creation_eth',
      title: 'Cumulative Fees Generated (USD)',
      type: 'timeseries',
      series: cumulativeFees.map((d) => ({ x: d.day, y: d.cumulativeFeeUsd })),
      yFormat: 'currency',
      notes: [
        'Cumulative totals include trading fees, redemption fees, modeled creation fees, and modeled refresh fees.',
      ],
    },
    {
      key: 'market_creation_fee_eth_gross_vs_net',
      title: 'Poll Lifecycle Fee Model',
      type: 'kpi_group',
      items: [
        { label: 'Creation Fee USD', value: creationFeePerPollUsd, format: 'currency' },
        { label: 'Refresh Fee USD', value: refreshFeePerPollUsd, format: 'currency' },
        { label: 'Creation Fee ETH', value: creationFeePerPollEth, format: 'decimal' },
        { label: 'Refresh Fee ETH', value: refreshFeePerPollEth, format: 'decimal' },
        { label: 'Lifecycle Fee USD', value: creationFeePerPollUsd + refreshFeePerPollUsd, format: 'currency' },
      ],
      notes: [
        'ETH values are current raw oracle settings.',
        'Refresh ETH is assumed to match creation ETH because the indexer does not expose a separate refresh-fee setting.',
      ],
    },
    {
      key: 'wallet_pnl_leaderboard',
      title: 'Wallet PnL Leaderboard (Proxy)',
      type: 'table',
      columns: [
        { key: 'walletShort', label: 'Wallet' },
        { key: 'totalBuysUsdc', label: 'Buys', format: 'currency' },
        { key: 'totalSellsUsdc', label: 'Sells', format: 'currency' },
        { key: 'winningsUsdc', label: 'Winnings', format: 'currency' },
        { key: 'feesPaidUsdc', label: 'Fees', format: 'currency' },
        { key: 'netPnlUsdc', label: 'Net PnL', format: 'currency' },
      ],
      rows: walletPnlLeaderboard,
    },
    {
      key: 'trader_win_rate_table',
      title: 'Trader Win-Rate Table (Proxy)',
      type: 'table',
      columns: [
        { key: 'walletShort', label: 'Wallet' },
        { key: 'marketsTraded', label: 'Markets Traded', format: 'integer' },
        { key: 'wins', label: 'Wins', format: 'integer' },
        { key: 'losses', label: 'Losses', format: 'integer' },
        { key: 'winRate', label: 'Win Rate', format: 'percent' },
      ],
      rows: traderWinRate,
    },
    {
      key: 'new_vs_returning_traders_daily',
      title: 'New vs Returning Traders (Daily)',
      type: 'table',
      columns: [
        { key: 'day', label: 'Day' },
        { key: 'newTraders', label: 'New', format: 'integer' },
        { key: 'returningTraders', label: 'Returning', format: 'integer' },
        { key: 'totalTraders', label: 'Total', format: 'integer' },
        { key: 'shareNew', label: 'Share New', format: 'percent' },
      ],
      rows: newVsReturningTradersDaily,
    },
    {
      key: 'trader_retention_cohorts',
      title: 'Trader Retention Cohorts (D1/D7/D30)',
      type: 'table',
      columns: [
        { key: 'cohortDay', label: 'Cohort Day' },
        { key: 'cohortSize', label: 'Size', format: 'integer' },
        { key: 'd1Retained', label: 'D1', format: 'integer' },
        { key: 'd1Rate', label: 'D1 Rate', format: 'percent' },
        { key: 'd7Retained', label: 'D7', format: 'integer' },
        { key: 'd7Rate', label: 'D7 Rate', format: 'percent' },
        { key: 'd30Retained', label: 'D30', format: 'integer' },
        { key: 'd30Rate', label: 'D30 Rate', format: 'percent' },
      ],
      rows: traderRetentionCohorts,
    },
    {
      key: 'whale_activity_table',
      title: 'Whale Activity Table',
      type: 'table',
      columns: [
        { key: 'walletShort', label: 'Wallet' },
        { key: 'totalVolumeUsdc', label: 'Total Volume', format: 'currency' },
        { key: 'avgTradeSizeUsdc', label: 'Avg Trade', format: 'currency' },
        { key: 'marketsTouched', label: 'Markets', format: 'integer' },
        { key: 'topMarketShort', label: 'Top Market' },
      ],
      rows: whaleActivity,
    },
    {
      key: 'market_profitability_table',
      title: 'Market Profitability Table',
      type: 'table',
      columns: [
        { key: 'marketShort', label: 'Market' },
        { key: 'marketType', label: 'Type' },
        { key: 'volumeUsdc', label: 'Volume', format: 'currency' },
        { key: 'tradingFeesUsdc', label: 'Trading Fees', format: 'currency' },
        { key: 'redemptionFeesUsdc', label: 'Redemption Fees', format: 'currency' },
        { key: 'creationFeeUsd', label: 'Creation Fee', format: 'currency' },
        { key: 'refreshFeeUsd', label: 'Refresh Fee', format: 'currency' },
        { key: 'totalProtocolTakeUsd', label: 'Protocol Take', format: 'currency' },
      ],
      rows: marketProfitability,
      notes: [
        'Creation fee is allocated across markets that share the same poll.',
        'Refresh fee is allocated the same way once a poll resolves/closes.',
      ],
    },
    {
      key: 'lp_roi_performance_table',
      title: 'LP ROI / Performance Table (Proxy)',
      type: 'table',
      columns: [
        { key: 'providerShort', label: 'LP Wallet' },
        { key: 'addedUsdc', label: 'Added', format: 'currency' },
        { key: 'removedUsdc', label: 'Removed', format: 'currency' },
        { key: 'netUsdc', label: 'Net', format: 'currency' },
        { key: 'feeShareProxyUsdc', label: 'Fee Share Proxy', format: 'currency' },
        { key: 'estRoi', label: 'Est ROI', format: 'percent' },
      ],
      rows: lpRoiPerformance,
    },
    {
      key: 'liquidity_utilization_by_market',
      title: 'Liquidity Utilization by Market',
      type: 'table',
      columns: [
        { key: 'marketShort', label: 'Market' },
        { key: 'marketType', label: 'Type' },
        { key: 'volumeUsdc', label: 'Volume', format: 'currency' },
        { key: 'avgTvlUsdc', label: 'TVL Proxy', format: 'currency' },
        { key: 'volumeToTvlRatio', label: 'Volume/TVL', format: 'decimal' },
        { key: 'activeTraders', label: 'Active Traders', format: 'integer' },
      ],
      rows: liquidityUtilizationByMarket,
    },
    {
      key: 'creator_quality_table',
      title: 'Creator Quality Table (Proxy)',
      type: 'table',
      columns: [
        { key: 'creatorShort', label: 'Creator' },
        { key: 'marketsCreated', label: 'Markets', format: 'integer' },
        { key: 'avgVolumeUsdc', label: 'Avg Volume', format: 'currency' },
        { key: 'resolveRate', label: 'Resolve Rate', format: 'percent' },
        { key: 'avgTimeToResolutionHours', label: 'Avg Resolution Hours', format: 'decimal' },
        { key: 'disputeRate', label: 'Dispute Rate', format: 'percent' },
      ],
      rows: creatorQuality,
      notes: [
        'Resolution time is approximated from poll createdAt to deadlineEpoch for resolved polls.',
      ],
    },
    {
      key: 'resolution_sla_overdue_table',
      title: 'Resolution SLA / Overdue Table',
      type: 'table',
      columns: [
        { key: 'pollShort', label: 'Poll' },
        { key: 'marketShort', label: 'Market' },
        { key: 'deadline', label: 'Deadline' },
        { key: 'resolvedAt', label: 'Resolved At (Proxy)' },
        { key: 'status', label: 'Status' },
        { key: 'hoursOverdue', label: 'Hours Overdue', format: 'decimal' },
      ],
      rows: resolutionSlaOverdue,
    },
    {
      key: 'pre_close_rush_table',
      title: 'Pre-Close Rush Table (Last 24h)',
      type: 'table',
      columns: [
        { key: 'marketShort', label: 'Market' },
        { key: 'marketType', label: 'Type' },
        { key: 'closeAt', label: 'Close At' },
        { key: 'volumeLast24hUsdc', label: 'Volume 24h', format: 'currency' },
        { key: 'tradesLast24h', label: 'Trades 24h', format: 'integer' },
        { key: 'uniqueTradersLast24h', label: 'Unique Traders 24h', format: 'integer' },
      ],
      rows: preCloseRush,
    },
    {
      key: 'price_shock_risk_alerts',
      title: 'Price Shock / Risk Alerts',
      type: 'table',
      columns: [
        { key: 'marketShort', label: 'Market' },
        { key: 'yesPriceMove1h', label: 'YES Move 1h', format: 'percent' },
        { key: 'yesPriceMove24h', label: 'YES Move 24h', format: 'percent' },
        { key: 'liquidityUsdc', label: 'Liquidity', format: 'currency' },
        { key: 'riskFlag', label: 'Risk Flag' },
      ],
      rows: priceShockRiskAlerts,
    },
    {
      key: 'yes_no_flow_imbalance',
      title: 'YES vs NO Flow Imbalance',
      type: 'table',
      columns: [
        { key: 'day', label: 'Day' },
        { key: 'marketShort', label: 'Market' },
        { key: 'yesVolumeUsdc', label: 'YES Volume', format: 'currency' },
        { key: 'noVolumeUsdc', label: 'NO Volume', format: 'currency' },
        { key: 'totalVolumeUsdc', label: 'Total', format: 'currency' },
        { key: 'imbalanceRatio', label: 'Imbalance', format: 'percent' },
      ],
      rows: yesNoFlowImbalance,
    },
    {
      key: 'fee_concentration_table',
      title: 'Fee Concentration (Markets & Wallets)',
      type: 'table',
      columns: [
        { key: 'entityType', label: 'Entity Type' },
        { key: 'rank', label: 'Rank', format: 'integer' },
        { key: 'entity', label: 'Entity' },
        { key: 'feeUsdc', label: 'Fee Generated', format: 'currency' },
        { key: 'share', label: 'Share', format: 'percent' },
        { key: 'cumulativeShare', label: 'Cumulative Share', format: 'percent' },
      ],
      rows: feeConcentration,
    },
    {
      key: 'redemption_efficiency_table',
      title: 'Redemption Efficiency Table (Proxy)',
      type: 'table',
      columns: [
        { key: 'marketShort', label: 'Market' },
        { key: 'resolvedAtProxy', label: 'Resolved At (Proxy)' },
        { key: 'firstRedeemAt', label: 'First Redeem At' },
        { key: 'hoursToFirstRedeem', label: 'Hours to First Redeem', format: 'decimal' },
        { key: 'redeemedAmountUsdc', label: 'Redeemed Amount', format: 'currency' },
      ],
      rows: redemptionEfficiency,
      notes: [
        'Resolved-at proxy is marketCloseTimestamp due to missing explicit resolution timestamp in current indexer tables.',
      ],
    },
  ];

  const sections = resolvePanels(registry, { sections: [{ name: 'all', panels }] });

  return {
    generatedAt: new Date().toISOString(),
    source: 'pandora-indexer',
    indexerUrl: INDEXER_URL,
    chainId: CHAIN_ID,
    assumptions: [
      'Indexed trading/redemption fees are normalized from 6-decimal USDC amounts.',
      'YES price in priceTicks/candles normalized with 1e9 scale.',
      `Creation fee is modeled at ${creationFeePerPollUsd.toFixed(2)} USD per poll created.`,
      `Refresh fee is modeled at ${refreshFeePerPollUsd.toFixed(2)} USD per poll resolved/closed.`,
      `Current raw on-chain creation fee setting is ${creationFeePerPollEth.toFixed(6)} ETH; refresh ETH is assumed to match.`,
      'Some advanced tables use explicit proxy fields where indexer lacks direct resolution timestamps.',
      'No Dune embeds or Dune APIs are used by this page.',
    ],
    coverage: {
      markets: markets.length,
      polls: polls.length,
      trades: trades.length,
      liquidityEvents: liquidityEvents.length,
      winnings: winnings.length,
      marketUsers: marketUsers.length,
      priceTicks: priceTicks.length,
      disputes: disputes.length,
      oracleFeeEvents: oracleFeeEvents.length,
      dailyStats: dailyRows.length,
      hourlyStats: hourlyRows.length,
    },
    highlights: {
      whaleConcentrationTop10Share: topTraderShare,
      avgTradeSizeUsdc: tradeSizes.length ? tradeSizes.reduce((a, b) => a + b, 0) / tradeSizes.length : 0,
      medianTradeSizeUsdc: tradeSizes.length ? median(tradeSizes) : 0,
      totalLps: uniqueLps.size,
      totalUniqueTradersFromTrades: uniqueTraders.size,
    },
    sections,
    auxTables: {
      topTraders,
      disputesByDay: disputesByDay.map((d) => ({ day: d.day, count: d.value })),
      redemptionByMarketType,
      unresolvedPastDeadline: unresolvedPastDeadline.slice(0, 20),
    },
  };
}

async function readPanelRegistry() {
  const raw = fs.readFileSync(PANEL_REGISTRY_PATH, 'utf8');
  return JSON.parse(raw);
}

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  const rawUrl = req.url || '/';
  const url = new URL(rawUrl, `http://localhost:${PORT}`);

  if (method !== 'GET') {
    return send(res, 405, { 'content-type': 'application/json; charset=utf-8' }, JSON.stringify({
      error: 'method_not_allowed',
    }));
  }

  if (url.pathname === '/api/panels' || url.pathname === '/panel_registry.json') {
    try {
      const body = fs.readFileSync(PANEL_REGISTRY_PATH, 'utf8');
      return send(res, 200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      }, body);
    } catch (err) {
      return send(res, 500, { 'content-type': 'application/json; charset=utf-8' }, JSON.stringify({
        error: 'registry_read_failed',
        message: err.message || String(err),
      }));
    }
  }

  if (url.pathname === '/api/analytics') {
    try {
      const registry = await readPanelRegistry();
      const payload = await buildAnalyticsPayload(registry);
      return send(res, 200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      }, JSON.stringify(payload));
    } catch (err) {
      return send(res, 500, { 'content-type': 'application/json; charset=utf-8' }, JSON.stringify({
        error: 'analytics_build_failed',
        message: err.message || String(err),
      }));
    }
  }

  const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = safeJoin(ROOT, requestedPath.slice(1));
  if (!filePath) {
    return send(res, 400, { 'content-type': 'text/plain; charset=utf-8' }, 'Bad path');
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'Not found');
  }

  const body = fs.readFileSync(filePath);
  return send(res, 200, {
    'content-type': contentTypeFor(filePath),
    'cache-control': 'no-store',
  }, body);
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`Pandora mega analytics running at http://localhost:${PORT}`);
    // eslint-disable-next-line no-console
    console.log(`Indexer source: ${INDEXER_URL}`);
  });
}

module.exports = {
  buildModeledLifecycleFeeLedger,
  mergeFeeBreakdownByDay,
  resolvePollLifecycleEventEpoch,
};
