const test = require('node:test');
const assert = require('node:assert/strict');

const { createRng } = require('../../cli/lib/quant/rng.cjs');
const { quantile, summarizeSamples } = require('../../cli/lib/quant/mc_stats.cjs');
const {
  antitheticUniformPairs,
  antitheticNormalSamples,
  stratifiedUniformSamples,
  applyControlVariate,
} = require('../../cli/lib/quant/variance_reduction.cjs');
const {
  normalizeWeights,
  effectiveSampleSize,
  importanceSamplingEstimate,
  resampleSystematic,
} = require('../../cli/lib/quant/importance_sampling.cjs');

test('createRng produces deterministic streams for identical seeds', () => {
  const left = createRng('seed-42');
  const right = createRng('seed-42');
  const other = createRng('seed-43');

  const drawsLeft = Array.from({ length: 8 }, () => left.next());
  const drawsRight = Array.from({ length: 8 }, () => right.next());
  const drawsOther = Array.from({ length: 8 }, () => other.next());

  assert.deepEqual(drawsLeft, drawsRight);
  assert.notDeepEqual(drawsLeft, drawsOther);
});

test('rng nextNormal is deterministic and finite', () => {
  const rngA = createRng(123);
  const rngB = createRng(123);

  const normalsA = Array.from({ length: 6 }, () => rngA.nextNormal(0, 1));
  const normalsB = Array.from({ length: 6 }, () => rngB.nextNormal(0, 1));

  assert.deepEqual(normalsA, normalsB);
  for (const value of normalsA) {
    assert.equal(Number.isFinite(value), true);
  }
});

test('mc_stats summarizeSamples returns quantiles, CI, and tail risk', () => {
  const samples = [-5, -2, -1, 0, 1, 2, 3, 4, 9];
  const summary = summarizeSamples(samples, { confidenceLevel: 0.95, tailLevels: [0.95] });

  assert.equal(summary.count, 9);
  assert.equal(summary.min, -5);
  assert.equal(summary.max, 9);
  assert.equal(quantile(samples, 0.5), 1);
  assert.equal(summary.tailRisk.var95 <= summary.tailRisk.es95, false);
  assert.equal(summary.confidenceInterval.lower < summary.confidenceInterval.upper, true);
});

test('variance reduction helpers emit deterministic antithetic/stratified draws', () => {
  const rng = createRng(99);
  const pairs = antitheticUniformPairs(rng, 5);
  assert.equal(pairs.length, 5);
  for (const [left, right] of pairs) {
    assert.equal(Math.abs((left + right) - 1) < 1e-12, true);
  }

  const rngNormals = createRng(99);
  const normalPairs = antitheticNormalSamples(rngNormals, 4);
  assert.equal(normalPairs.length, 8);
  assert.equal(Math.abs(normalPairs[0] + normalPairs[1]) < 1e-12, true);

  const rngStrata = createRng(99);
  const strata = stratifiedUniformSamples(rngStrata, 6);
  assert.equal(strata.length, 6);
  assert.equal(strata[0] >= 0 && strata[0] < 1 / 6, true);
  assert.equal(strata[5] >= 5 / 6 && strata[5] < 1, true);
});

test('applyControlVariate reduces variance for correlated controls', () => {
  const target = [10, 11, 9, 12, 8, 13, 7, 14];
  const control = [4, 5, 3, 6, 2, 7, 1, 8];

  const adjusted = applyControlVariate(target, control, 4.5);
  assert.equal(adjusted.adjustedSamples.length, target.length);
  assert.equal(adjusted.adjustedVariance < adjusted.targetVariance, true);
  assert.equal(adjusted.varianceReductionPct > 0, true);
});

test('importance sampling helpers normalize, score ESS, and resample deterministically', () => {
  const normalized = normalizeWeights([1, 2, 3]);
  assert.deepEqual(normalized.map((value) => Number(value.toFixed(6))), [0.166667, 0.333333, 0.5]);
  assert.equal(effectiveSampleSize(normalized) > 2, true);

  const estimate = importanceSamplingEstimate([0.1, 0.4, 0.7, 0.9], {
    targetDensity: (x) => 1 + x,
    proposalDensity: () => 1,
    valueFn: (x) => x,
  });
  assert.equal(estimate.estimate > 0.5, true);
  assert.equal(estimate.effectiveSampleSize > 1, true);

  const rng = createRng(321);
  const resampled = resampleSystematic(['a', 'b', 'c'], [0.8, 0.1, 0.1], rng);
  assert.equal(resampled.length, 3);
  assert.equal(resampled.includes('a'), true);
});
