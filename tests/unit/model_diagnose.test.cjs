const test = require('node:test');
const assert = require('node:assert/strict');

const { buildModelDiagnose } = require('../../cli/lib/model_diagnose_service.cjs');

test('model diagnose classifies informative markets and allows execution', () => {
  const payload = buildModelDiagnose({
    calibrationRmse: 0.08,
    driftBps: 35,
    spreadBps: 30,
    depthCoverage: 0.9,
    informedFlowRatio: 0.8,
    noiseRatio: 0.1,
    anomalyRate: 0.03,
    manipulationAlerts: 0,
    tailDependence: 0.12,
  });

  assert.equal(payload.schemaVersion, '1.0.0');
  assert.equal(payload.aggregate.classification, 'informative');
  assert.equal(payload.flags.allowExecution, true);
  assert.equal(payload.flags.blockExecution, false);
  assert.equal(payload.recommendations.primaryAction, 'RUN_LIVE_WITH_GUARDS');
  assert.ok(payload.aggregate.scorePct >= 70);
});

test('model diagnose classifies weak-signal regimes and requires human review', () => {
  const payload = buildModelDiagnose({
    calibrationRmse: 0.18,
    driftBps: 140,
    spreadBps: 110,
    depthCoverage: 0.58,
    informedFlowRatio: 0.48,
    noiseRatio: 0.45,
    anomalyRate: 0.12,
    manipulationAlerts: 1,
    tailDependence: 0.35,
  });

  assert.equal(payload.aggregate.classification, 'weak-signal');
  assert.equal(payload.flags.requireHumanReview, true);
  assert.equal(payload.flags.blockExecution, false);
  assert.ok(payload.recommendations.actions.includes('REDUCE_POSITION_SIZE'));
});

test('model diagnose classifies noise-dominated regimes and blocks execution', () => {
  const payload = buildModelDiagnose({
    calibrationRmse: 0.42,
    driftBps: 420,
    spreadBps: 280,
    depthCoverage: 0.2,
    informedFlowRatio: 0.15,
    noiseRatio: 0.85,
    anomalyRate: 0.4,
    manipulationAlerts: 5,
    tailDependence: 0.78,
  });

  assert.equal(payload.aggregate.classification, 'noise-dominated');
  assert.equal(payload.flags.blockExecution, true);
  assert.equal(payload.flags.classNoiseDominated, true);
  assert.ok(payload.recommendations.actions.includes('BLOCK_AUTOMATION'));
  assert.ok(payload.recommendations.actions.includes('TRIGGER_MARKET_QUALITY_INVESTIGATION'));
});

test('model diagnose output includes component scores and machine-readable flags', () => {
  const payload = buildModelDiagnose({});

  assert.equal(typeof payload.components.calibrationQuality.score01, 'number');
  assert.equal(typeof payload.components.driftStability.score01, 'number');
  assert.equal(typeof payload.components.liquidityQuality.score01, 'number');
  assert.equal(typeof payload.components.flowQuality.score01, 'number');
  assert.equal(typeof payload.components.marketIntegrity.score01, 'number');

  assert.equal(typeof payload.flags.calibrationWeak, 'boolean');
  assert.equal(typeof payload.flags.driftUnstable, 'boolean');
  assert.equal(typeof payload.flags.liquidityThin, 'boolean');
  assert.equal(typeof payload.flags.flowNoisy, 'boolean');
  assert.equal(typeof payload.flags.manipulationRiskHigh, 'boolean');
  assert.equal(typeof payload.flags.allowExecution, 'boolean');
  assert.equal(typeof payload.flags.requireHumanReview, 'boolean');
  assert.equal(typeof payload.flags.blockExecution, 'boolean');
});
