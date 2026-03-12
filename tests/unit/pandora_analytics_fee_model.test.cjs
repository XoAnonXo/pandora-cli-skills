const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildModeledLifecycleFeeLedger,
  mergeFeeBreakdownByDay,
  resolvePollLifecycleEventEpoch,
} = require('../../analytics/dune/mega/server.cjs');

function toEpochSeconds(iso) {
  return Math.floor(new Date(iso).getTime() / 1000);
}

test('resolvePollLifecycleEventEpoch prefers resolvedAt and falls back to deadline for closed polls', () => {
  assert.equal(
    resolvePollLifecycleEventEpoch({
      status: 1,
      resolvedAt: toEpochSeconds('2026-03-10T09:00:00.000Z'),
      deadlineEpoch: toEpochSeconds('2026-03-10T00:00:00.000Z'),
    }),
    toEpochSeconds('2026-03-10T09:00:00.000Z'),
  );

  assert.equal(
    resolvePollLifecycleEventEpoch({
      status: 2,
      resolvedAt: null,
      deadlineEpoch: toEpochSeconds('2026-03-11T00:00:00.000Z'),
    }),
    toEpochSeconds('2026-03-11T00:00:00.000Z'),
  );

  assert.equal(
    resolvePollLifecycleEventEpoch({
      status: 0,
      resolvedAt: null,
      deadlineEpoch: toEpochSeconds('2026-03-12T00:00:00.000Z'),
    }),
    0,
  );
});

test('modeled lifecycle fees are included in merged daily and cumulative totals', () => {
  const ledger = buildModeledLifecycleFeeLedger({
    dailyRows: [
      { day: '2026-03-10', pollsCreated: 2 },
      { day: '2026-03-11', pollsCreated: 1 },
    ],
    polls: [
      {
        status: 1,
        resolvedAt: toEpochSeconds('2026-03-10T09:00:00.000Z'),
        deadlineEpoch: toEpochSeconds('2026-03-10T00:00:00.000Z'),
      },
      {
        status: 2,
        resolvedAt: null,
        deadlineEpoch: toEpochSeconds('2026-03-11T00:00:00.000Z'),
      },
      {
        status: 0,
        resolvedAt: null,
        deadlineEpoch: toEpochSeconds('2026-03-12T00:00:00.000Z'),
      },
    ],
    creationFeePerPollEth: 0.0025,
    creationFeePerPollUsd: 5,
    refreshFeePerPollEth: 0.0025,
    refreshFeePerPollUsd: 5,
  });

  assert.deepEqual(
    ledger.creationFeeSeries.map((row) => ({
      day: row.day,
      creationFeeUsdModeled: row.creationFeeUsdModeled,
    })),
    [
      { day: '2026-03-10', creationFeeUsdModeled: 10 },
      { day: '2026-03-11', creationFeeUsdModeled: 5 },
    ],
  );

  assert.deepEqual(
    ledger.refreshFeeSeries.map((row) => ({
      day: row.day,
      refreshFeeUsdModeled: row.refreshFeeUsdModeled,
    })),
    [
      { day: '2026-03-10', refreshFeeUsdModeled: 5 },
      { day: '2026-03-11', refreshFeeUsdModeled: 5 },
    ],
  );

  const merged = mergeFeeBreakdownByDay({
    tradingFeeDaily: [{ day: '2026-03-10', value: 1.5 }],
    redemptionFeeDaily: [{ day: '2026-03-11', value: 2.25 }],
    creationFeeSeries: ledger.creationFeeSeries,
    refreshFeeSeries: ledger.refreshFeeSeries,
  });

  assert.deepEqual(
    merged.feeDailyMerged.map((row) => ({
      day: row.day,
      tradingFeeUsdc: row.tradingFeeUsdc,
      redemptionFeeUsdc: row.redemptionFeeUsdc,
      creationFeeUsd: row.creationFeeUsd,
      refreshFeeUsd: row.refreshFeeUsd,
      totalFeeUsd: row.totalFeeUsd,
    })),
    [
      {
        day: '2026-03-10',
        tradingFeeUsdc: 1.5,
        redemptionFeeUsdc: 0,
        creationFeeUsd: 10,
        refreshFeeUsd: 5,
        totalFeeUsd: 16.5,
      },
      {
        day: '2026-03-11',
        tradingFeeUsdc: 0,
        redemptionFeeUsdc: 2.25,
        creationFeeUsd: 5,
        refreshFeeUsd: 5,
        totalFeeUsd: 12.25,
      },
    ],
  );

  assert.deepEqual(merged.cumulativeFees, [
    { day: '2026-03-10', cumulativeFeeUsd: 16.5 },
    { day: '2026-03-11', cumulativeFeeUsd: 28.75 },
  ]);
});
