const test = require('node:test');
const assert = require('node:assert/strict');

const {
  decimalOddsToImpliedProbability,
  americanOddsToImpliedProbability,
  fractionalOddsToImpliedProbability,
  oddsToImpliedProbability,
  trimmedMedian,
  evaluateCoveragePolicy,
  computeSportsConsensus,
} = require('../../cli/lib/sports_consensus_service.cjs');

test('sports odds conversion supports decimal, american, fractional, and inferred formats', () => {
  assert.equal(decimalOddsToImpliedProbability(2), 0.5);
  assert.equal(americanOddsToImpliedProbability('+150'), 0.4);
  assert.equal(americanOddsToImpliedProbability(-150), 0.6);
  assert.equal(fractionalOddsToImpliedProbability('3/2'), 0.4);
  assert.equal(oddsToImpliedProbability('+120', ''), 0.45454545454545453);
  assert.equal(oddsToImpliedProbability('5/4', null), 0.4444444444444444);
  assert.equal(oddsToImpliedProbability(2.5, undefined), 0.4);
  assert.equal(oddsToImpliedProbability('bad', 'decimal'), null);
});

test('trimmedMedian symmetrically trims outliers and keeps stable center median', () => {
  const result = trimmedMedian([0.2, 0.4, 0.5, 0.6, 0.9], 20);

  assert.equal(result.median, 0.5);
  assert.equal(result.trimCount, 1);
  assert.deepEqual(result.lowOutlierIndexes, [0]);
  assert.deepEqual(result.highOutlierIndexes, [4]);
  assert.deepEqual(result.includedIndexes, [1, 2, 3]);
});

test('evaluateCoveragePolicy reports high confidence when total and tier1 coverage are strong', () => {
  const books = [
    { book: 'bet365', tier1: true },
    { book: 'pinnacle', tier1: true },
    { book: 'book-c', tier1: false },
    { book: 'book-d', tier1: false },
  ];
  const includedRows = [
    { book: 'bet365', tier1: true },
    { book: 'pinnacle', tier1: true },
    { book: 'book-c', tier1: false },
  ];

  const policy = evaluateCoveragePolicy({
    books,
    includedRows,
    minTotalBooks: 3,
    minTier1Books: 2,
    minTier1Coverage: 0.5,
  });

  assert.equal(policy.totalCoverage, 0.75);
  assert.equal(policy.tier1Coverage, 1);
  assert.equal(policy.degradedConfidence, false);
  assert.equal(policy.confidence, 'high');
});

test('evaluateCoveragePolicy uses raw participating books for minimum-book gating', () => {
  const books = [
    { book: 'bet365', tier1: true },
    { book: 'pinnacle', tier1: true },
    { book: 'book-c', tier1: false },
    { book: 'book-d', tier1: false },
    { book: 'book-e', tier1: false },
    { book: 'book-f', tier1: false },
  ];
  const includedRows = [
    { book: 'bet365', tier1: true },
    { book: 'pinnacle', tier1: true },
    { book: 'book-c', tier1: false },
    { book: 'book-d', tier1: false },
  ];

  const policy = evaluateCoveragePolicy({
    books,
    includedRows,
    minTotalBooks: 6,
    minTier1Books: 2,
    minTier1Coverage: 0.5,
  });

  assert.equal(policy.totalCoverage, 4 / 6);
  assert.equal(policy.insufficientCoverage, false);
  assert.equal(policy.confidence, 'normal');
});

test('computeSportsConsensus applies trimmed median, marks outliers, and degrades on low coverage', () => {
  const quotes = [
    { book: 'book-low', odds: 8, oddsFormat: 'decimal' },
    { book: 'book-mid-1', odds: 2, oddsFormat: 'decimal' },
    { book: 'Pinnacle', odds: 1.9, oddsFormat: 'decimal' },
    { book: 'bet365', odds: 1.8, oddsFormat: 'decimal' },
    { book: 'book-high', odds: 1.05, oddsFormat: 'decimal' },
  ];

  const normal = computeSportsConsensus(quotes, {
    trimPercent: 20,
    tier1Books: ['bet365', 'pinnacle'],
    minTotalBooks: 3,
    minTier1Books: 2,
    minTier1Coverage: 0.5,
  });

  assert.equal(normal.method, 'trimmed-median');
  assert.equal(normal.totalBooks, 5);
  assert.equal(normal.includedBooks, 3);
  assert.equal(normal.excludedBooks, 2);
  assert.equal(normal.consensusYesPct, 52.6316);
  assert.equal(normal.consensusNoPct, 47.3684);
  assert.equal(normal.tier1Coverage, 1);
  assert.equal(normal.degradedConfidence, false);
  assert.equal(normal.confidence, 'normal');
  assert.equal(normal.outliers.length, 2);
  assert.equal(normal.outliers.some((row) => row.reason === 'trimmed-low'), true);
  assert.equal(normal.outliers.some((row) => row.reason === 'trimmed-high'), true);

  const degraded = computeSportsConsensus(quotes, {
    trimPercent: 20,
    tier1Books: ['bet365', 'pinnacle'],
    minTotalBooks: 3,
    minTier1Books: 3,
    minTier1Coverage: 0.5,
  });

  assert.equal(degraded.includedBooks, 3);
  assert.equal(degraded.degradedConfidence, true);
  assert.equal(degraded.confidence, 'degraded');
});
