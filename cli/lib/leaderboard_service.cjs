const { createIndexerClient } = require('./indexer_client.cjs');

const LEADERBOARD_SCHEMA_VERSION = '1.0.1';

function toNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function toCount(value) {
  const numeric = toNumber(value);
  if (numeric === null || numeric < 0) return 0;
  return numeric;
}

function normalizeUserAggregate(item) {
  const diagnostics = [];

  const rawTotalTrades = toCount(item.totalTrades);
  const rawTotalWins = toCount(item.totalWins);
  const rawTotalLosses = toCount(item.totalLosses);

  let totalTrades = rawTotalTrades;
  let totalWins = rawTotalWins;
  let totalLosses = rawTotalLosses;

  if (totalWins > totalTrades) {
    diagnostics.push({
      code: 'INDEXER_INCONSISTENT_TOTALS',
      message: `totalWins (${rawTotalWins}) exceeded totalTrades (${rawTotalTrades}); wins clamped to trades.`,
    });
    totalWins = totalTrades;
  }

  const maxLosses = Math.max(0, totalTrades - totalWins);
  if (totalLosses > maxLosses) {
    diagnostics.push({
      code: 'INDEXER_INCONSISTENT_TOTALS',
      message: `totalLosses (${rawTotalLosses}) exceeded remaining trade slots (${maxLosses}); losses clamped.`,
    });
    totalLosses = maxLosses;
  }

  return {
    address: item.address,
    chainId: item.chainId,
    realizedPnl: toNumber(item.realizedPnL) || 0,
    totalVolume: toNumber(item.totalVolume) || 0,
    totalTrades,
    totalWins,
    totalLosses,
    totalWinnings: toNumber(item.totalWinnings) || 0,
    winRate: totalTrades > 0 ? totalWins / totalTrades : 0,
    diagnostics,
    sourceTotals:
      diagnostics.length > 0
        ? {
            totalTrades: rawTotalTrades,
            totalWins: rawTotalWins,
            totalLosses: rawTotalLosses,
          }
        : undefined,
  };
}

function buildMetric(row, metric) {
  if (metric === 'volume') return toNumber(row.totalVolume) || 0;
  if (metric === 'win-rate') return Math.max(0, Math.min(1, toNumber(row.winRate) || 0));
  return toNumber(row.realizedPnL) || 0;
}

async function fetchLeaderboard(options) {
  const client = createIndexerClient(options.indexerUrl, options.timeoutMs);
  const page = await client.list({
    queryName: 'userss',
    filterType: 'usersFilter',
    fields: [
      'id',
      'address',
      'chainId',
      'realizedPnL',
      'totalVolume',
      'totalTrades',
      'totalWins',
      'totalLosses',
      'totalWinnings',
    ],
    variables: {
      where: {
        ...(options.chainId !== null && options.chainId !== undefined ? { chainId: options.chainId } : {}),
      },
      orderBy: options.metric === 'volume' ? 'totalVolume' : options.metric === 'win-rate' ? 'totalWins' : 'realizedPnL',
      orderDirection: 'desc',
      before: null,
      after: null,
      limit: Math.max(options.limit * 5, 100),
    },
  });

  const anomalies = [];
  const items = (page.items || [])
    .filter((item) => toCount(item.totalTrades) >= options.minTrades)
    .map((item) => {
      const normalized = normalizeUserAggregate(item);
      if (normalized.diagnostics.length > 0) {
        anomalies.push({
          address: normalized.address,
          diagnostics: normalized.diagnostics,
        });
      }
      return normalized;
    })
    .sort((a, b) => buildMetric(b, options.metric) - buildMetric(a, options.metric))
    .slice(0, options.limit)
    .map((item, index) => ({
      rank: index + 1,
      ...item,
    }));

  return {
    schemaVersion: LEADERBOARD_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    indexerUrl: options.indexerUrl,
    metric: options.metric,
    chainId: options.chainId,
    limit: options.limit,
    minTrades: options.minTrades,
    count: items.length,
    diagnostics: anomalies,
    items,
  };
}

module.exports = {
  LEADERBOARD_SCHEMA_VERSION,
  fetchLeaderboard,
};
