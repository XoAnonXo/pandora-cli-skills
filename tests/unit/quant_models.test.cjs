const test = require('node:test');
const assert = require('node:assert/strict');

const { runParticleFilter } = require('../../cli/lib/quant/particle_filter.cjs');
const {
  sampleGaussianCopula,
  sampleStudentTCopula,
  pairwiseTailDependence,
  inverseNormalCdf,
} = require('../../cli/lib/quant/copula.cjs');
const { simulateAbmMarket } = require('../../cli/lib/quant/abm_market.cjs');

test('runParticleFilter is deterministic with fixed seed and returns diagnostics', () => {
  const observations = [0.42, 0.45, 0.5, 0.55, 0.58];
  const left = runParticleFilter({ observations, seed: 7, particleCount: 300, processStd: 0.08 });
  const right = runParticleFilter({ observations, seed: 7, particleCount: 300, processStd: 0.08 });

  assert.equal(left.schemaVersion, '1.0.0');
  assert.equal(left.observationCount, observations.length);
  assert.equal(left.trajectory.length, observations.length);
  assert.equal(left.finalEstimate > 0 && left.finalEstimate < 1, true);
  assert.equal(left.finalInterval.lower <= left.finalEstimate, true);
  assert.equal(left.finalInterval.upper >= left.finalEstimate, true);
  assert.deepEqual(left, right);
});

test('sampleGaussianCopula emits bounded uniform samples and tail metrics', () => {
  const result = sampleGaussianCopula({ sampleCount: 500, correlation: 0.6, seed: 11 });

  assert.equal(result.family, 'gaussian');
  assert.equal(result.dimension, 2);
  assert.equal(result.samples.length, 500);

  for (const row of result.samples.slice(0, 10)) {
    assert.equal(row.length, 2);
    assert.equal(row[0] >= 0 && row[0] <= 1, true);
    assert.equal(row[1] >= 0 && row[1] <= 1, true);
  }

  const tail = pairwiseTailDependence(result.samples, { threshold: 0.9 });
  assert.equal(tail.pairs.length, 1);
  assert.equal(tail.pairs[0].upper >= 0, true);
  assert.equal(tail.pairs[0].lower >= 0, true);
});

test('sampleStudentTCopula returns deterministic uniform pseudo-observations', () => {
  const left = sampleStudentTCopula({ sampleCount: 400, correlation: 0.5, degreesOfFreedom: 5, seed: 13 });
  const right = sampleStudentTCopula({ sampleCount: 400, correlation: 0.5, degreesOfFreedom: 5, seed: 13 });

  assert.equal(left.family, 't');
  assert.equal(left.samples.length, 400);
  assert.deepEqual(left.samples, right.samples);

  const q = inverseNormalCdf(0.975);
  assert.equal(q > 1.9 && q < 2.1, true);
});

test('simulateAbmMarket returns stable trajectory and aggregate summary', () => {
  const left = simulateAbmMarket({
    seed: 'abm-seed',
    steps: 40,
    nInformed: 12,
    nNoise: 30,
    nMarketMakers: 8,
    initialPrice: 0.45,
    fundamentalPrice: 0.55,
  });
  const right = simulateAbmMarket({
    seed: 'abm-seed',
    steps: 40,
    nInformed: 12,
    nNoise: 30,
    nMarketMakers: 8,
    initialPrice: 0.45,
    fundamentalPrice: 0.55,
  });

  assert.equal(left.schemaVersion, '1.0.0');
  assert.equal(left.trajectory.length, 40);
  assert.equal(left.summary.finalPrice > 0 && left.summary.finalPrice < 1, true);
  assert.equal(left.summary.averageSpread > 0, true);
  assert.equal(left.summary.totalVolume > 0, true);
  assert.equal(typeof left.summary.pnlByAgentType.informed, 'number');
  assert.deepEqual(left, right);
});
