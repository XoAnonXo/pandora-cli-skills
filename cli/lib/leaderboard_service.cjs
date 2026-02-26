const { createIndexerClient } = require('./indexer_client.cjs');

const LEADERBOARD_SCHEMA_VERSION = '1.0.0';

function toNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function buildMetric(row, metric) {
  if (metric === 'volume') return toNumber(row.totalVolume) || 0;
  if (metric === 'win-rate') {
    const wins = toNumber(row.totalWins) || 0;
    const trades = toNumber(row.totalTrades) || 0;
    if (!trades) return 0;
    return wins / trades;
  }
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

  const items = (page.items || [])
    .filter((item) => (toNumber(item.totalTrades) || 0) >= options.minTrades)
    .map((item) => {
      const totalTrades = toNumber(item.totalTrades) || 0;
      const totalWins = toNumber(item.totalWins) || 0;
      const winRate = totalTrades > 0 ? totalWins / totalTrades : 0;
      return {
        address: item.address,
        chainId: item.chainId,
        realizedPnl: toNumber(item.realizedPnL) || 0,
        totalVolume: toNumber(item.totalVolume) || 0,
        totalTrades,
        totalWins,
        totalLosses: toNumber(item.totalLosses) || 0,
        totalWinnings: toNumber(item.totalWinnings) || 0,
        winRate,
      };
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
    items,
  };
}

module.exports = {
  LEADERBOARD_SCHEMA_VERSION,
  fetchLeaderboard,
};
