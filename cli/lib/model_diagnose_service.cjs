const { round, clamp, toOptionalNumber } = require('./shared/utils.cjs');

const MODEL_DIAGNOSE_SCHEMA_VERSION = '1.0.0';

function toBoundedNumber(value, fallback, min = 0, max = 1) {
  const numeric = toOptionalNumber(value);
  if (numeric === null) return fallback;
  return clamp(numeric, min, max);
}

function scoreFromLowerBetter(value, good, bad) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (bad <= good) return numeric <= good ? 1 : 0;
  return clamp((bad - numeric) / (bad - good), 0, 1);
}

function scoreFromHigherBetter(value, bad, good) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (good <= bad) return numeric >= good ? 1 : 0;
  return clamp((numeric - bad) / (good - bad), 0, 1);
}

function classifyDiagnoseScore(score01) {
  if (!Number.isFinite(score01)) return 'noise-dominated';
  if (score01 >= 0.7) return 'informative';
  if (score01 >= 0.45) return 'weak-signal';
  return 'noise-dominated';
}

function dedupe(list) {
  return Array.from(new Set((Array.isArray(list) ? list : []).filter(Boolean)));
}

function buildRecommendations(classification, componentFlags = {}) {
  const actions = [];
  if (classification === 'informative') {
    actions.push('RUN_LIVE_WITH_GUARDS', 'KEEP_MONITORING');
  } else if (classification === 'weak-signal') {
    actions.push('REDUCE_POSITION_SIZE', 'REQUIRE_CROSS_VENUE_CONFIRMATION', 'RAISE_REVIEW_FREQUENCY');
  } else {
    actions.push('BLOCK_AUTOMATION', 'SWITCH_TO_READ_ONLY', 'TRIGGER_MARKET_QUALITY_INVESTIGATION');
  }

  if (componentFlags.calibrationWeak) actions.push('RECALIBRATE_MODEL');
  if (componentFlags.driftUnstable) actions.push('WIDEN_DRIFT_GUARDS');
  if (componentFlags.liquidityThin) actions.push('INCREASE_LIQUIDITY_FILTERS');
  if (componentFlags.flowNoisy) actions.push('DECREASE_SIGNAL_WEIGHT');
  if (componentFlags.manipulationRiskHigh) actions.push('ESCALATE_MANIPULATION_REVIEW');

  const deduped = dedupe(actions);
  return {
    primaryAction: deduped[0] || 'KEEP_MONITORING',
    actions: deduped,
  };
}

function buildModelDiagnose(options = {}) {
  const calibrationRmse = toBoundedNumber(
    options.calibrationRmse,
    0.22,
    0,
    10,
  );
  const driftBps = toBoundedNumber(options.driftBps, 120, 0, 10_000);
  const spreadBps = toBoundedNumber(options.spreadBps, 120, 0, 10_000);
  const depthCoverage = toBoundedNumber(options.depthCoverage, 0.55, 0, 1);
  const informedFlowRatio = toBoundedNumber(options.informedFlowRatio, 0.45, 0, 1);
  const noiseRatio = toBoundedNumber(
    options.noiseRatio,
    clamp(1 - informedFlowRatio, 0, 1),
    0,
    1,
  );
  const anomalyRate = toBoundedNumber(options.anomalyRate, 0.2, 0, 1);
  const manipulationAlerts = Math.max(0, Math.trunc(toOptionalNumber(options.manipulationAlerts) || 0));
  const tailDependence = toBoundedNumber(options.tailDependence, 0.35, 0, 1);

  const calibrationScore = scoreFromLowerBetter(calibrationRmse, 0.05, 0.45);
  const driftScore = scoreFromLowerBetter(driftBps, 20, 350);
  const spreadScore = scoreFromLowerBetter(spreadBps, 20, 250);
  const depthScore = scoreFromHigherBetter(depthCoverage, 0.2, 0.9);
  const liquidityScore = clamp(spreadScore * 0.6 + depthScore * 0.4, 0, 1);
  const flowSignalScore = scoreFromHigherBetter(informedFlowRatio, 0.2, 0.8);
  const flowNoiseScore = scoreFromLowerBetter(noiseRatio, 0.05, 0.8);
  const flowScore = clamp(flowSignalScore * 0.7 + flowNoiseScore * 0.3, 0, 1);
  const anomalyScore = scoreFromLowerBetter(anomalyRate, 0.02, 0.35);
  const alertScore = clamp(1 - manipulationAlerts / 8, 0, 1);
  const tailScore = scoreFromLowerBetter(tailDependence, 0.05, 0.6);
  const integrityScore = clamp(anomalyScore * 0.5 + alertScore * 0.25 + tailScore * 0.25, 0, 1);

  const weights = {
    calibration: 0.3,
    drift: 0.2,
    liquidity: 0.2,
    flow: 0.15,
    integrity: 0.15,
  };
  const score01 = clamp(
    calibrationScore * weights.calibration +
      driftScore * weights.drift +
      liquidityScore * weights.liquidity +
      flowScore * weights.flow +
      integrityScore * weights.integrity,
    0,
    1,
  );
  const classification = classifyDiagnoseScore(score01);

  const componentFlags = {
    calibrationWeak: calibrationScore < 0.5,
    driftUnstable: driftScore < 0.45,
    liquidityThin: liquidityScore < 0.45,
    flowNoisy: flowScore < 0.45,
    manipulationRiskHigh: integrityScore < 0.45,
  };
  const flaggedCount = Object.values(componentFlags).filter(Boolean).length;

  const recommendation = buildRecommendations(classification, componentFlags);
  const flags = {
    ...componentFlags,
    allowExecution: classification === 'informative' && flaggedCount <= 1,
    requireHumanReview: classification === 'weak-signal' || flaggedCount >= 2,
    blockExecution: classification === 'noise-dominated' || flaggedCount >= 3,
    classInformative: classification === 'informative',
    classWeakSignal: classification === 'weak-signal',
    classNoiseDominated: classification === 'noise-dominated',
  };

  return {
    schemaVersion: MODEL_DIAGNOSE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    inputs: {
      calibrationRmse: round(calibrationRmse, 6),
      driftBps: round(driftBps, 6),
      spreadBps: round(spreadBps, 6),
      depthCoverage: round(depthCoverage, 6),
      informedFlowRatio: round(informedFlowRatio, 6),
      noiseRatio: round(noiseRatio, 6),
      anomalyRate: round(anomalyRate, 6),
      manipulationAlerts,
      tailDependence: round(tailDependence, 6),
    },
    components: {
      calibrationQuality: {
        score01: round(calibrationScore, 6),
        weight: weights.calibration,
        metric: 'calibrationRmse',
        direction: 'lower-is-better',
      },
      driftStability: {
        score01: round(driftScore, 6),
        weight: weights.drift,
        metric: 'driftBps',
        direction: 'lower-is-better',
      },
      liquidityQuality: {
        score01: round(liquidityScore, 6),
        weight: weights.liquidity,
        metric: 'spreadBps+depthCoverage',
        direction: 'mixed',
      },
      flowQuality: {
        score01: round(flowScore, 6),
        weight: weights.flow,
        metric: 'informedFlowRatio+noiseRatio',
        direction: 'mixed',
      },
      marketIntegrity: {
        score01: round(integrityScore, 6),
        weight: weights.integrity,
        metric: 'anomalyRate+manipulationAlerts+tailDependence',
        direction: 'lower-is-better',
      },
    },
    aggregate: {
      score01: round(score01, 6),
      scorePct: round(score01 * 100, 2),
      classification,
    },
    recommendations: {
      summary:
        classification === 'informative'
          ? 'Signal quality is strong enough for guarded execution.'
          : classification === 'weak-signal'
            ? 'Signal quality is mixed; keep automation constrained and review more often.'
            : 'Signal quality is too weak for autonomous execution.',
      ...recommendation,
    },
    flags,
    diagnostics: [
      'Composite diagnose score blends calibration, drift, liquidity, flow quality, and market integrity.',
      'Machine-readable flags are intended for downstream risk gates and automation controls.',
    ],
  };
}

module.exports = {
  MODEL_DIAGNOSE_SCHEMA_VERSION,
  classifyDiagnoseScore,
  buildRecommendations,
  buildModelDiagnose,
};
