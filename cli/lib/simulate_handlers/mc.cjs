const { round } = require('../shared/utils.cjs');
const {
  toProbabilityFromPercent,
  toPercent,
  logistic,
  logit,
  createSeededRandom,
  createNormalSampler,
  buildNormalPool,
  quantile,
  mean,
  standardDeviation,
} = require('./common.cjs');

const SIMULATE_MC_SCHEMA_VERSION = '1.0.0';

function computePositionPnlUsdc(positionSide, stakeUsdc, entryProbability, exitProbability) {
  const stake = Number(stakeUsdc);
  if (!Number.isFinite(stake) || stake <= 0) {
    return 0;
  }

  if (positionSide === 'no') {
    const entryNoPrice = 1 - entryProbability;
    const noShares = stake / entryNoPrice;
    const exitValue = noShares * (1 - exitProbability);
    return exitValue - stake;
  }

  const yesShares = stake / entryProbability;
  const exitValue = yesShares * exitProbability;
  return exitValue - stake;
}

function computeTailRisk(pnlSamples, varLevelPct) {
  const varTailProbability = 1 - varLevelPct / 100;
  const leftTailQuantile = quantile(pnlSamples, varTailProbability);
  const valueAtRiskUsdc = Math.max(0, -(leftTailQuantile || 0));

  const tailValues = pnlSamples.filter((value) => value <= (leftTailQuantile || 0));
  const expectedShortfallUsdc =
    tailValues.length > 0
      ? Math.max(0, -(tailValues.reduce((sum, value) => sum + value, 0) / tailValues.length))
      : valueAtRiskUsdc;

  return {
    varLevelPct,
    valueAtRiskUsdc: round(valueAtRiskUsdc, 6),
    expectedShortfallUsdc: round(expectedShortfallUsdc, 6),
  };
}

function buildQuantiles(values, scale = 1) {
  return {
    p01: round((quantile(values, 0.01) || 0) * scale, 6),
    p05: round((quantile(values, 0.05) || 0) * scale, 6),
    p25: round((quantile(values, 0.25) || 0) * scale, 6),
    p50: round((quantile(values, 0.5) || 0) * scale, 6),
    p75: round((quantile(values, 0.75) || 0) * scale, 6),
    p95: round((quantile(values, 0.95) || 0) * scale, 6),
    p99: round((quantile(values, 0.99) || 0) * scale, 6),
  };
}

function propagatePath(initialLogit, drift, sigma, shocks) {
  let state = initialLogit;
  for (const shock of shocks) {
    state += drift + sigma * shock;
  }
  return logistic(state);
}

async function runSimulateMc(options = {}) {
  const startTime = Date.now();

  const trials = Number(options.trials);
  const horizon = Number(options.horizon);
  const stakeUsdc = Number(options.stakeUsdc);
  const startProbability = toProbabilityFromPercent(options.startYesPct);
  const entryProbability = toProbabilityFromPercent(options.entryYesPct);
  const driftPerStep = Number(options.driftBps) / 10_000;
  const sigmaPerStep = Number(options.volBps) / 10_000;
  const antithetic = Boolean(options.antithetic);
  const stratified = Boolean(options.stratified);
  const confidencePct = Number(options.confidencePct);
  const varLevelPct = Number(options.varLevelPct);
  const positionSide = options.positionSide === 'no' ? 'no' : 'yes';
  const seed = Number.isInteger(options.seed) ? options.seed : null;

  const uniformSource = createSeededRandom(seed);
  const fallbackNormal = createNormalSampler(uniformSource);

  const pairCount = antithetic ? Math.ceil(trials / 2) : trials;
  const drawsNeeded = pairCount * horizon;
  const normalPool = buildNormalPool(drawsNeeded, {
    uniformSource,
    stratified,
  });
  let drawCursor = 0;

  function nextShock() {
    if (drawCursor < normalPool.length) {
      const value = normalPool[drawCursor];
      drawCursor += 1;
      return value;
    }
    return fallbackNormal();
  }

  const initialLogit = logit(startProbability);
  const finalProbabilities = [];
  const pnlUsdc = [];

  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    const shocks = new Array(horizon);
    for (let step = 0; step < horizon; step += 1) {
      shocks[step] = nextShock();
    }

    const firstProbability = propagatePath(initialLogit, driftPerStep, sigmaPerStep, shocks);
    finalProbabilities.push(firstProbability);
    pnlUsdc.push(computePositionPnlUsdc(positionSide, stakeUsdc, entryProbability, firstProbability));

    if (antithetic && finalProbabilities.length < trials) {
      const mirroredShocks = shocks.map((value) => -value);
      const mirroredProbability = propagatePath(initialLogit, driftPerStep, sigmaPerStep, mirroredShocks);
      finalProbabilities.push(mirroredProbability);
      pnlUsdc.push(computePositionPnlUsdc(positionSide, stakeUsdc, entryProbability, mirroredProbability));
    }
  }

  const alpha = (1 - confidencePct / 100) / 2;
  const finalMeanProb = mean(finalProbabilities) || 0;
  const finalMeanPnl = mean(pnlUsdc) || 0;
  const finalMedianProb = quantile(finalProbabilities, 0.5) || 0;
  const finalMedianPnl = quantile(pnlUsdc, 0.5) || 0;
  const finalStdProb = standardDeviation(finalProbabilities, finalMeanProb) || 0;
  const finalStdPnl = standardDeviation(pnlUsdc, finalMeanPnl) || 0;

  const winCount = pnlUsdc.filter((value) => value >= 0).length;
  const risk = computeTailRisk(pnlUsdc, varLevelPct);

  return {
    schemaVersion: SIMULATE_MC_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    inputs: {
      trials,
      horizon,
      positionSide,
      stakeUsdc: round(stakeUsdc, 6),
      startYesPct: toPercent(startProbability),
      entryYesPct: toPercent(entryProbability),
      driftBps: round(Number(options.driftBps), 6),
      volBps: round(Number(options.volBps), 6),
      confidencePct,
      varLevelPct,
      antithetic,
      stratified,
      seed,
    },
    summary: {
      finalYesPct: {
        mean: toPercent(finalMeanProb),
        median: toPercent(finalMedianProb),
        stdDev: round(finalStdProb * 100, 6),
        ciLower: toPercent(quantile(finalProbabilities, alpha) || finalMedianProb),
        ciUpper: toPercent(quantile(finalProbabilities, 1 - alpha) || finalMedianProb),
      },
      pnlUsdc: {
        mean: round(finalMeanPnl, 6),
        median: round(finalMedianPnl, 6),
        stdDev: round(finalStdPnl, 6),
        ciLower: round(quantile(pnlUsdc, alpha) || finalMedianPnl, 6),
        ciUpper: round(quantile(pnlUsdc, 1 - alpha) || finalMedianPnl, 6),
        winRatePct: round((winCount / pnlUsdc.length) * 100, 6),
      },
      risk,
      runtimeMs: Date.now() - startTime,
    },
    distribution: {
      finalYesPctQuantiles: buildQuantiles(finalProbabilities, 100),
      pnlUsdcQuantiles: buildQuantiles(pnlUsdc, 1),
    },
    diagnostics: [
      {
        code: 'MC_ENGINE',
        message: 'Logit random-walk Monte Carlo with mark-to-model PnL at horizon.',
      },
      {
        code: 'MC_VARIANCE_REDUCTION',
        message: antithetic || stratified
          ? `Variance reduction enabled: ${[antithetic ? 'antithetic' : null, stratified ? 'stratified' : null].filter(Boolean).join('+')}.`
          : 'Variance reduction disabled; using vanilla random sampling.',
      },
      {
        code: 'MC_REPLAY',
        message: Number.isInteger(seed)
          ? `Deterministic replay enabled with seed ${seed}.`
          : 'No seed provided; outputs are stochastic across runs.',
      },
      {
        code: 'MC_DRAWS',
        message: `Consumed ${drawCursor} normal draws across ${finalProbabilities.length} paths and ${horizon} steps/path.`,
      },
    ],
  };
}

module.exports = {
  SIMULATE_MC_SCHEMA_VERSION,
  runSimulateMc,
};
