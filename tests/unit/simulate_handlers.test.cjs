const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runSimulateMc } = require('../../cli/lib/simulate_handlers/mc.cjs');
const { runSimulateParticleFilter } = require('../../cli/lib/simulate_handlers/particle_filter.cjs');

test('simulate mc handler is deterministic with seed and emits CI + VaR/ES', async () => {
  const options = {
    trials: 2000,
    horizon: 48,
    startYesPct: 57,
    entryYesPct: 57,
    positionSide: 'yes',
    stakeUsdc: 100,
    driftBps: 0,
    volBps: 180,
    confidencePct: 95,
    varLevelPct: 95,
    antithetic: true,
    stratified: true,
    seed: 17,
  };

  const first = await runSimulateMc(options);
  const second = await runSimulateMc(options);

  assert.equal(first.summary.finalYesPct.mean, second.summary.finalYesPct.mean);
  assert.equal(first.summary.pnlUsdc.mean, second.summary.pnlUsdc.mean);
  assert.equal(first.summary.risk.valueAtRiskUsdc, second.summary.risk.valueAtRiskUsdc);
  assert.equal(first.summary.risk.expectedShortfallUsdc, second.summary.risk.expectedShortfallUsdc);
  assert.equal(typeof first.summary.finalYesPct.ciLower, 'number');
  assert.equal(typeof first.summary.finalYesPct.ciUpper, 'number');
  assert.equal(Array.isArray(first.diagnostics), true);
  assert.ok(first.diagnostics.length >= 3);
});

test('simulate particle-filter handler returns trajectory and sparse diagnostics', async () => {
  const payload = await runSimulateParticleFilter({
    observationsJson: '[{"yesPct":52},null,{"yesPct":49},{"yesPct":51}]',
    inputFile: null,
    readFromStdin: false,
    particles: 600,
    processNoise: 0.15,
    observationNoise: 0.08,
    driftBps: 0,
    initialYesPct: 50,
    initialSpread: 0.35,
    resampleThreshold: 0.55,
    resampleMethod: 'systematic',
    credibleIntervalPct: 90,
    seed: 7,
  });

  assert.equal(payload.trajectory.length, 4);
  assert.equal(payload.summary.observedCount, 3);
  assert.equal(payload.summary.missingCount, 1);
  assert.equal(typeof payload.summary.final.filteredYesPct, 'number');
  assert.equal(typeof payload.summary.final.credibleIntervalYesPct.lower, 'number');
  assert.equal(typeof payload.summary.final.credibleIntervalYesPct.upper, 'number');
  assert.equal(Array.isArray(payload.diagnostics), true);
  assert.equal(payload.diagnostics.some((item) => item && item.code === 'SPARSE_OBSERVATIONS'), true);
});

test('simulate particle-filter handler supports NDJSON file input deterministically', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-pf-'));
  const inputPath = path.join(tempDir, 'observations.ndjson');
  fs.writeFileSync(
    inputPath,
    ['{"yesPct":48}', '{"yesPct":49}', '{"yesPct":52}', '{"yesPct":54}'].join('\n'),
    'utf8',
  );

  try {
    const options = {
      observationsJson: null,
      inputFile: inputPath,
      readFromStdin: false,
      particles: 750,
      processNoise: 0.12,
      observationNoise: 0.07,
      driftBps: 0,
      initialYesPct: 50,
      initialSpread: 0.3,
      resampleThreshold: 0.5,
      resampleMethod: 'multinomial',
      credibleIntervalPct: 90,
      seed: 99,
    };

    const first = await runSimulateParticleFilter(options);
    const second = await runSimulateParticleFilter(options);

    assert.equal(first.summary.final.filteredYesPct, second.summary.final.filteredYesPct);
    assert.equal(first.summary.averageEss, second.summary.averageEss);
    assert.equal(first.summary.resamples, second.summary.resamples);
    assert.equal(first.trajectory.length, 4);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
