const test = require('node:test');
const assert = require('node:assert/strict');

const {
  brierScore,
  buildReliabilityBuckets,
  computeBrierReport,
} = require('../../cli/lib/brier_score_service.cjs');

test('brierScore computes squared error for binary outcomes', () => {
  assert.equal(Math.abs(brierScore(0.8, 1) - 0.04) < 1e-12, true);
  assert.equal(Math.abs(brierScore(0.2, 0) - 0.04) < 1e-12, true);
});

test('computeBrierReport aggregates scores with diagnostics for skipped rows', () => {
  const records = [
    { id: 'a', source: 'watch', marketAddress: '0x1', probabilityYes: 0.8, outcome: 'yes' },
    { id: 'b', source: 'watch', marketAddress: '0x1', probabilityYes: 0.3, outcome: 'no' },
    { id: 'c', source: 'pf', marketAddress: '0x2', probabilityYes: 0.6, outcome: 1 },
    { id: 'd', source: 'pf', marketAddress: '0x2', probabilityYes: 0.4 },
    { id: 'e', source: 'pf', marketAddress: '0x2', probabilityYes: 240, outcome: 1 },
  ];

  const report = computeBrierReport(records, {
    groupBy: 'source',
    bucketCount: 5,
  });

  assert.equal(report.schemaVersion, '1.0.0');
  assert.equal(report.inputCount, 5);
  assert.equal(report.scoredCount, 3);
  assert.equal(report.missingOutcomeCount, 1);
  assert.equal(report.invalidProbabilityCount, 1);
  assert.equal(report.groups.length, 2);

  const totalBucketCount = report.aggregate.reliability.reduce((acc, bucket) => acc + bucket.count, 0);
  assert.equal(totalBucketCount, report.scoredCount);

  assert.equal(Math.abs(report.aggregate.brier - 0.09666666666666668) < 1e-12, true);
  assert.equal(Math.abs(report.aggregate.rmse - Math.sqrt(0.09666666666666668)) < 1e-12, true);
});

test('computeBrierReport can resolve outcomes via callback and group by market', () => {
  const outcomeByEvent = {
    'evt-1': 'yes',
    'evt-2': 'no',
  };

  const records = [
    { id: 'x', source: 'watch', eventId: 'evt-1', marketAddress: '0xa', probabilityYes: 0.7 },
    { id: 'y', source: 'watch', eventId: 'evt-2', marketAddress: '0xa', probabilityYes: 0.25 },
    { id: 'z', source: 'watch', eventId: 'evt-3', marketAddress: '0xb', probabilityYes: 0.5 },
  ];

  const report = computeBrierReport(records, {
    groupBy: 'market',
    outcomeResolver: (record) => outcomeByEvent[record.eventId],
    bucketCount: 4,
  });

  assert.equal(report.scoredCount, 2);
  assert.equal(report.missingOutcomeCount, 1);
  assert.equal(report.groups.length, 1);
  assert.equal(report.groups[0].key, '0xa');
  assert.equal(report.groups[0].count, 2);
  assert.equal(report.aggregate.brier > 0, true);
});

test('buildReliabilityBuckets returns empty bucket entries when there are no scored rows', () => {
  const buckets = buildReliabilityBuckets([], { bucketCount: 3 });
  assert.equal(buckets.length, 3);
  assert.equal(buckets[0].count, 0);
  assert.equal(buckets[0].avgProbability, null);
});
