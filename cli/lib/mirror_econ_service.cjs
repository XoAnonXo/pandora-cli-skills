const { computeDistributionHint, normalizeProbability } = require('./mirror_sizing_service.cjs');
const { round, clamp, toOptionalNumber } = require('./shared/utils.cjs');

const MIRROR_LP_EXPLAIN_SCHEMA_VERSION = '1.0.0';
const MIRROR_HEDGE_CALC_SCHEMA_VERSION = '1.0.0';
const MIRROR_SIMULATE_SCHEMA_VERSION = '1.0.0';
const MIRROR_SIMULATE_MC_DEFAULT_PATHS = 2000;
const MIRROR_SIMULATE_MC_DEFAULT_STEPS = 48;
const MIRROR_SIMULATE_MC_DEFAULT_SEED = 42;
const USDC_DECIMALS = 6;
const USDC_SCALE = 10 ** USDC_DECIMALS;

function toRawUsdc(usdc) {
  const numeric = toOptionalNumber(usdc);
  if (numeric === null) return null;
  return BigInt(Math.round(numeric * USDC_SCALE));
}

function rawUsdcToNumber(rawValue) {
  if (typeof rawValue !== 'bigint') return null;
  return round(Number(rawValue) / USDC_SCALE, 6);
}

function toPercent(value) {
  const numeric = toOptionalNumber(value);
  if (numeric === null) return null;
  if (numeric >= 0 && numeric <= 100) return round(numeric, 6);
  return null;
}

function yesPctToProbability(yesPct) {
  const normalized = normalizeProbability(yesPct);
  if (normalized === null) return null;
  return normalized;
}

function resolveDistribution(options = {}) {
  const diagnostics = [];
  const sourceYesPct = toPercent(options.sourceYesPct);

  const explicitYes = toOptionalNumber(options.distributionYes);
  const explicitNo = toOptionalNumber(options.distributionNo);
  if (explicitYes !== null || explicitNo !== null) {
    if (explicitYes === null || explicitNo === null) {
      throw new Error('distributionYes and distributionNo must both be provided together.');
    }
    if (!Number.isInteger(explicitYes) || !Number.isInteger(explicitNo)) {
      throw new Error('distributionYes and distributionNo must be integers.');
    }
    if (explicitYes < 0 || explicitNo < 0 || explicitYes + explicitNo !== 1_000_000_000) {
      throw new Error('distributionYes + distributionNo must equal 1000000000.');
    }
    return {
      sourceYesPct,
      sourceYesProbability: sourceYesPct === null ? null : round(sourceYesPct / 100, 6),
      distributionYes: explicitYes,
      distributionNo: explicitNo,
      diagnostics,
      mode: 'explicit',
    };
  }

  const distribution = computeDistributionHint(sourceYesPct === null ? 0.5 : sourceYesPct / 100);
  if (sourceYesPct === null) {
    diagnostics.push('No source YES probability supplied; defaulted to balanced 50/50 distribution hint.');
  } else if (sourceYesPct === 0 || sourceYesPct === 100) {
    diagnostics.push('Degenerate source YES probability (0% or 100%) may create an extreme one-sided seed.');
  }

  return {
    sourceYesPct,
    sourceYesProbability:
      sourceYesPct === null
        ? null
        : round(sourceYesPct / 100, 6),
    distributionYes: distribution.distributionYes,
    distributionNo: distribution.distributionNo,
    diagnostics: diagnostics.concat(distribution.diagnostics || []),
    mode: sourceYesPct === null ? 'default' : 'derived-from-source-yes-pct',
  };
}

function deriveYesPctFromReserves(reserveYesUsdc, reserveNoUsdc) {
  const yesReserve = toOptionalNumber(reserveYesUsdc);
  const noReserve = toOptionalNumber(reserveNoUsdc);
  if (yesReserve === null || noReserve === null) return null;
  const total = yesReserve + noReserve;
  if (!Number.isFinite(total) || total <= 0) return null;
  return round((noReserve / total) * 100, 6);
}

function computeCompleteSetAllocation(options = {}) {
  const liquidityRaw = toRawUsdc(options.liquidityUsdc);
  if (liquidityRaw === null || liquidityRaw <= 0n) {
    throw new Error('liquidityUsdc must be a positive number.');
  }

  const distributionYes = toOptionalNumber(options.distributionYes);
  const distributionNo = toOptionalNumber(options.distributionNo);
  if (!Number.isInteger(distributionYes) || !Number.isInteger(distributionNo)) {
    throw new Error('distributionYes and distributionNo must be integers.');
  }
  if (distributionYes < 0 || distributionNo < 0 || distributionYes + distributionNo !== 1_000_000_000) {
    throw new Error('distributionYes + distributionNo must equal 1000000000.');
  }

  const yesWeight = BigInt(distributionYes);
  const noWeight = BigInt(distributionNo);

  const mintedYesRaw = liquidityRaw;
  const mintedNoRaw = liquidityRaw;

  let reserveYesRaw;
  let reserveNoRaw;
  if (noWeight >= yesWeight) {
    reserveYesRaw = liquidityRaw;
    reserveNoRaw = noWeight === 0n ? 0n : (liquidityRaw * yesWeight) / noWeight;
  } else {
    reserveNoRaw = liquidityRaw;
    reserveYesRaw = yesWeight === 0n ? 0n : (liquidityRaw * noWeight) / yesWeight;
  }

  const excessYesRaw = mintedYesRaw - reserveYesRaw;
  const excessNoRaw = mintedNoRaw - reserveNoRaw;
  const totalYesRaw = reserveYesRaw + excessYesRaw;
  const totalNoRaw = reserveNoRaw + excessNoRaw;

  return {
    liquidityRaw,
    mintedYesRaw,
    mintedNoRaw,
    reserveYesRaw,
    reserveNoRaw,
    excessYesRaw,
    excessNoRaw,
    totalYesRaw,
    totalNoRaw,
    impliedPoolYesPct: deriveYesPctFromReserves(rawUsdcToNumber(reserveYesRaw), rawUsdcToNumber(reserveNoRaw)),
    liquidityUsdc: rawUsdcToNumber(liquidityRaw),
    mintedYesUsdc: rawUsdcToNumber(mintedYesRaw),
    mintedNoUsdc: rawUsdcToNumber(mintedNoRaw),
    reserveYesUsdc: rawUsdcToNumber(reserveYesRaw),
    reserveNoUsdc: rawUsdcToNumber(reserveNoRaw),
    excessYesUsdc: rawUsdcToNumber(excessYesRaw),
    excessNoUsdc: rawUsdcToNumber(excessNoRaw),
    totalYesUsdc: rawUsdcToNumber(totalYesRaw),
    totalNoUsdc: rawUsdcToNumber(totalNoRaw),
    neutralCompleteSets: totalYesRaw === totalNoRaw,
  };
}

function simulateDirectionalSwap(options = {}) {
  const reserveYes = Math.max(0, toOptionalNumber(options.reserveYesUsdc) || 0);
  const reserveNo = Math.max(0, toOptionalNumber(options.reserveNoUsdc) || 0);
  const volumeUsdc = Math.max(0, toOptionalNumber(options.volumeUsdc) || 0);
  const feeTier = Number.isFinite(Number(options.feeTier)) ? Number(options.feeTier) : 3000;
  const feeRate = clamp(feeTier / 1_000_000, 0, 0.1);
  const side = String(options.side || 'none').toLowerCase();

  if (side !== 'yes' && side !== 'no') {
    return {
      side: 'none',
      volumeUsdc: round(volumeUsdc, 6),
      feeTier,
      feeRate: round(feeRate, 8),
      feesEarnedUsdc: 0,
      outputShares: 0,
      reserveYesUsdc: round(reserveYes, 6),
      reserveNoUsdc: round(reserveNo, 6),
      postYesPct: deriveYesPctFromReserves(reserveYes, reserveNo),
    };
  }

  const effectiveIn = volumeUsdc * (1 - feeRate);
  const feesEarnedUsdc = volumeUsdc - effectiveIn;

  if (side === 'yes') {
    const denominator = reserveNo + effectiveIn;
    const outputYes = denominator > 0 ? (reserveYes * effectiveIn) / denominator : 0;
    const postReserveYes = Math.max(0, reserveYes - outputYes);
    const postReserveNo = reserveNo + effectiveIn;
    return {
      side,
      volumeUsdc: round(volumeUsdc, 6),
      feeTier,
      feeRate: round(feeRate, 8),
      feesEarnedUsdc: round(feesEarnedUsdc, 6),
      outputShares: round(outputYes, 6),
      reserveYesUsdc: round(postReserveYes, 6),
      reserveNoUsdc: round(postReserveNo, 6),
      postYesPct: deriveYesPctFromReserves(postReserveYes, postReserveNo),
    };
  }

  const denominator = reserveYes + effectiveIn;
  const outputNo = denominator > 0 ? (reserveNo * effectiveIn) / denominator : 0;
  const postReserveNo = Math.max(0, reserveNo - outputNo);
  const postReserveYes = reserveYes + effectiveIn;
  return {
    side,
    volumeUsdc: round(volumeUsdc, 6),
    feeTier,
    feeRate: round(feeRate, 8),
    feesEarnedUsdc: round(feesEarnedUsdc, 6),
    outputShares: round(outputNo, 6),
    reserveYesUsdc: round(postReserveYes, 6),
    reserveNoUsdc: round(postReserveNo, 6),
    postYesPct: deriveYesPctFromReserves(postReserveYes, postReserveNo),
  };
}

function solveVolumeForTargetYesPct(options = {}) {
  const targetYesPct = toPercent(options.targetYesPct);
  const reserveYesUsdc = toOptionalNumber(options.reserveYesUsdc);
  const reserveNoUsdc = toOptionalNumber(options.reserveNoUsdc);
  const feeTier = Number.isFinite(Number(options.feeTier)) ? Number(options.feeTier) : 3000;

  if (targetYesPct === null || reserveYesUsdc === null || reserveNoUsdc === null) {
    return null;
  }

  const initialYesPct = deriveYesPctFromReserves(reserveYesUsdc, reserveNoUsdc);
  if (initialYesPct === null) return null;
  if (Math.abs(initialYesPct - targetYesPct) <= 0.01) return 0;

  const side = targetYesPct > initialYesPct ? 'yes' : 'no';
  const directionCheck = (yesPct) => (side === 'yes' ? yesPct >= targetYesPct : yesPct <= targetYesPct);
  const f = (volumeUsdc) =>
    simulateDirectionalSwap({
      reserveYesUsdc,
      reserveNoUsdc,
      side,
      volumeUsdc,
      feeTier,
    }).postYesPct;

  let lo = 0;
  let hi = Math.max(1, reserveYesUsdc + reserveNoUsdc);
  let yesAtHi = f(hi);
  let iterations = 0;
  while (!directionCheck(yesAtHi) && iterations < 32) {
    hi *= 2;
    yesAtHi = f(hi);
    iterations += 1;
  }

  if (!directionCheck(yesAtHi)) {
    return null;
  }

  for (let i = 0; i < 56; i += 1) {
    const mid = (lo + hi) / 2;
    const yesAtMid = f(mid);
    if (directionCheck(yesAtMid)) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  return round(hi, 6);
}

function normalizeVolumeScenarios(value, liquidityUsdc) {
  const fallback = () => {
    const liq = Math.max(1, toOptionalNumber(liquidityUsdc) || 0);
    return [
      round(liq * 0.25, 6),
      round(liq * 0.5, 6),
      round(liq, 6),
      round(liq * 2, 6),
    ];
  };

  if (Array.isArray(value)) {
    const parsed = value.map((item) => toOptionalNumber(item)).filter((item) => Number.isFinite(item) && item >= 0).map((item) => round(item, 6));
    return parsed.length ? parsed : fallback();
  }

  const raw = String(value || '').trim();
  if (raw) {
    const parsed = raw
      .split(',')
      .map((entry) => toOptionalNumber(entry.trim()))
      .filter((entry) => Number.isFinite(entry) && entry >= 0)
      .map((entry) => round(entry, 6));
    return parsed.length ? parsed : fallback();
  }

  return fallback();
}

function computeHedgeMetrics(options = {}) {
  const reserveYesUsdc = toOptionalNumber(options.reserveYesUsdc) || 0;
  const reserveNoUsdc = toOptionalNumber(options.reserveNoUsdc) || 0;
  const excessYesUsdc = toOptionalNumber(options.excessYesUsdc) || 0;
  const excessNoUsdc = toOptionalNumber(options.excessNoUsdc) || 0;
  const hedgeRatio = clamp(toOptionalNumber(options.hedgeRatio) || 1, 0, 5);
  const polymarketYesPct = toPercent(options.polymarketYesPct);
  const hedgeCostBps = Math.max(0, toOptionalNumber(options.hedgeCostBps) || 35);
  const feeTier = Number.isFinite(Number(options.feeTier)) ? Number(options.feeTier) : 3000;
  const feeRate = clamp(feeTier / 1_000_000, 0, 0.1);

  const deltaPoolUsdc = reserveYesUsdc - reserveNoUsdc;
  const deltaTotalUsdc = (reserveYesUsdc + excessYesUsdc) - (reserveNoUsdc + excessNoUsdc);
  const targetHedgeUsdcSigned = -deltaTotalUsdc * hedgeRatio;
  const targetHedgeUsdcAbs = Math.abs(targetHedgeUsdcSigned);
  const hedgeToken = targetHedgeUsdcSigned > 0 ? 'yes' : targetHedgeUsdcSigned < 0 ? 'no' : null;

  const yesPrice01 = polymarketYesPct === null ? null : clamp(polymarketYesPct / 100, 0.0001, 0.9999);
  const noPrice01 = yesPrice01 === null ? null : 1 - yesPrice01;
  const hedgePrice01 = hedgeToken === 'yes' ? yesPrice01 : hedgeToken === 'no' ? noPrice01 : null;
  const hedgeSharesApprox = hedgePrice01 ? round(targetHedgeUsdcAbs / hedgePrice01, 6) : null;

  const hedgeCostApproxUsdc = round(targetHedgeUsdcAbs * (hedgeCostBps / 10_000), 6) || 0;
  const breakEvenVolumeUsdc = feeRate > 0 ? round(hedgeCostApproxUsdc / feeRate, 6) : null;

  return {
    reserveYesUsdc: round(reserveYesUsdc, 6),
    reserveNoUsdc: round(reserveNoUsdc, 6),
    excessYesUsdc: round(excessYesUsdc, 6),
    excessNoUsdc: round(excessNoUsdc, 6),
    deltaPoolUsdc: round(deltaPoolUsdc, 6),
    deltaTotalUsdc: round(deltaTotalUsdc, 6),
    hedgeRatio: round(hedgeRatio, 6),
    targetHedgeUsdcSigned: round(targetHedgeUsdcSigned, 6),
    targetHedgeUsdcAbs: round(targetHedgeUsdcAbs, 6),
    hedgeToken,
    polymarketYesPct,
    polymarketNoPct: polymarketYesPct === null ? null : round(100 - polymarketYesPct, 6),
    hedgePrice01: hedgePrice01 === null ? null : round(hedgePrice01, 8),
    hedgeSharesApprox,
    hedgeCostBps: round(hedgeCostBps, 6),
    hedgeCostApproxUsdc,
    feeTier,
    feeRate: round(feeRate, 8),
    breakEvenVolumeUsdc,
  };
}

function buildMirrorLpExplain(options = {}) {
  const distribution = resolveDistribution(options);
  const allocation = computeCompleteSetAllocation({
    liquidityUsdc: options.liquidityUsdc,
    distributionYes: distribution.distributionYes,
    distributionNo: distribution.distributionNo,
  });

  const diagnostics = [];
  diagnostics.push(...distribution.diagnostics);
  diagnostics.push(
    'addLiquidity mints complete sets first, seeds reserves by distribution hint, then returns excess YES/NO tokens to the LP wallet.',
  );

  return {
    schemaVersion: MIRROR_LP_EXPLAIN_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    inputs: {
      liquidityUsdc: allocation.liquidityUsdc,
      sourceYesPct: distribution.sourceYesPct,
      distributionYes: distribution.distributionYes,
      distributionNo: distribution.distributionNo,
      distributionMode: distribution.mode,
    },
    flow: {
      mintedCompleteSets: {
        yesTokens: allocation.mintedYesUsdc,
        noTokens: allocation.mintedNoUsdc,
      },
      seededPoolReserves: {
        reserveYesUsdc: allocation.reserveYesUsdc,
        reserveNoUsdc: allocation.reserveNoUsdc,
        impliedPandoraYesPct: allocation.impliedPoolYesPct,
      },
      returnedExcessTokens: {
        excessYesUsdc: allocation.excessYesUsdc,
        excessNoUsdc: allocation.excessNoUsdc,
      },
      totalLpInventory: {
        totalYesUsdc: allocation.totalYesUsdc,
        totalNoUsdc: allocation.totalNoUsdc,
        deltaUsdc: round((allocation.totalYesUsdc || 0) - (allocation.totalNoUsdc || 0), 6),
        neutralCompleteSets: allocation.neutralCompleteSets,
      },
    },
    raw: {
      liquidityRaw: allocation.liquidityRaw.toString(),
      reserveYesRaw: allocation.reserveYesRaw.toString(),
      reserveNoRaw: allocation.reserveNoRaw.toString(),
      excessYesRaw: allocation.excessYesRaw.toString(),
      excessNoRaw: allocation.excessNoRaw.toString(),
    },
    diagnostics,
  };
}

function buildMirrorHedgeCalc(options = {}) {
  const scenarios = normalizeVolumeScenarios(options.volumeScenarios, options.reserveYesUsdc + options.reserveNoUsdc);
  const metrics = computeHedgeMetrics(options);

  const scenarioRows = scenarios.map((volumeUsdc) => {
    const fees = round(volumeUsdc * (metrics.feeRate || 0), 6) || 0;
    return {
      volumeUsdc,
      feeRevenueUsdc: fees,
      hedgeCostApproxUsdc: metrics.hedgeCostApproxUsdc,
      netPnlApproxUsdc: round(fees - (metrics.hedgeCostApproxUsdc || 0), 6),
    };
  });

  return {
    schemaVersion: MIRROR_HEDGE_CALC_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    metrics,
    scenarios: scenarioRows,
    diagnostics: [
      'Hedge sizing is notional-based and assumes FAK fills near the provided Polymarket mark price.',
      'P&L rows are approximation: LP fee accrual minus estimated hedge execution cost.',
    ],
  };
}

function normalizeSimulateEngine(value) {
  const normalized = String(value || 'linear')
    .trim()
    .toLowerCase();
  return normalized === 'mc' ? 'mc' : 'linear';
}

function toBoundedPositiveInteger(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return fallback;
  return clamp(numeric, min, max);
}

function normalizeMcConfig(options = {}) {
  return {
    engine: 'mc',
    paths: toBoundedPositiveInteger(options.paths, MIRROR_SIMULATE_MC_DEFAULT_PATHS, 10, 200_000),
    steps: toBoundedPositiveInteger(options.steps, MIRROR_SIMULATE_MC_DEFAULT_STEPS, 1, 1_000),
    seed: Number.isInteger(Number(options.seed)) ? Number(options.seed) : MIRROR_SIMULATE_MC_DEFAULT_SEED,
    importanceSampling: Boolean(options.importanceSampling),
    antithetic: Boolean(options.antithetic),
    controlVariate: Boolean(options.controlVariate),
    stratified: Boolean(options.stratified),
  };
}

function createSeededRng(seed) {
  let state = (Number(seed) >>> 0) || 0x6d2b79f5;
  return function nextRandom01() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleStandardNormal(rng, options = {}) {
  const pathCount = Number.isInteger(options.pathCount) && options.pathCount > 1 ? options.pathCount : 1;
  const pathIndex = Number.isInteger(options.pathIndex) ? options.pathIndex : 0;
  const stepIndex = Number.isInteger(options.stepIndex) ? options.stepIndex : 0;
  const useStratified = Boolean(options.stratified) && pathCount > 1;

  let u1 = rng();
  if (useStratified) {
    const rotation = (stepIndex * 0.6180339887498949) % 1;
    const shifted = (pathIndex + rotation * pathCount) % pathCount;
    const stratumIndex = Math.floor(shifted);
    u1 = (stratumIndex + u1) / pathCount;
  }
  const u2 = rng();

  const safeU1 = clamp(u1, 1e-12, 1 - 1e-12);
  const safeU2 = clamp(u2, 1e-12, 1 - 1e-12);
  const radius = Math.sqrt(-2 * Math.log(safeU1));
  const theta = 2 * Math.PI * safeU2;
  return radius * Math.cos(theta);
}

function weightedMean(values, weights) {
  if (!Array.isArray(values) || !values.length) return 0;
  const safeWeights =
    Array.isArray(weights) && weights.length === values.length ? weights : new Array(values.length).fill(1);
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = Number(values[i]);
    const weight = Number(safeWeights[i]);
    if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) continue;
    weightedSum += value * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

function weightedStdDev(values, weights, meanOverride = null) {
  if (!Array.isArray(values) || values.length <= 1) return 0;
  const safeWeights =
    Array.isArray(weights) && weights.length === values.length ? weights : new Array(values.length).fill(1);
  const mean = meanOverride === null ? weightedMean(values, safeWeights) : meanOverride;
  let weightedVar = 0;
  let totalWeight = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = Number(values[i]);
    const weight = Number(safeWeights[i]);
    if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) continue;
    const diff = value - mean;
    weightedVar += diff * diff * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? Math.sqrt(weightedVar / totalWeight) : 0;
}

function weightedQuantile(values, weights, quantile) {
  if (!Array.isArray(values) || !values.length) return 0;
  const q = clamp(Number(quantile), 0, 1);
  const safeWeights =
    Array.isArray(weights) && weights.length === values.length ? weights : new Array(values.length).fill(1);

  const sorted = values
    .map((value, index) => ({ value: Number(value), weight: Number(safeWeights[index]) }))
    .filter((entry) => Number.isFinite(entry.value) && Number.isFinite(entry.weight) && entry.weight > 0)
    .sort((a, b) => a.value - b.value);

  if (!sorted.length) return 0;
  const totalWeight = sorted.reduce((acc, entry) => acc + entry.weight, 0);
  if (totalWeight <= 0) return sorted[0].value;

  const threshold = totalWeight * q;
  let cumulative = 0;
  for (const entry of sorted) {
    cumulative += entry.weight;
    if (cumulative >= threshold) {
      return entry.value;
    }
  }
  return sorted[sorted.length - 1].value;
}

function weightedTailMean(values, weights, threshold) {
  if (!Array.isArray(values) || !values.length) return 0;
  const safeWeights =
    Array.isArray(weights) && weights.length === values.length ? weights : new Array(values.length).fill(1);
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = Number(values[i]);
    const weight = Number(safeWeights[i]);
    if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) continue;
    if (value + 1e-12 < threshold) continue;
    weightedSum += value * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

function effectiveSampleSize(weights) {
  if (!Array.isArray(weights) || !weights.length) return 0;
  let sum = 0;
  let sumSquares = 0;
  for (const rawWeight of weights) {
    const weight = Number(rawWeight);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    sum += weight;
    sumSquares += weight * weight;
  }
  if (sum <= 0 || sumSquares <= 0) return 0;
  return (sum * sum) / sumSquares;
}

function normalizeWeightsFromLog(logWeights) {
  if (!Array.isArray(logWeights) || !logWeights.length) return [];
  const finite = logWeights.filter((value) => Number.isFinite(value));
  const maxLogWeight = finite.length ? Math.max(...finite) : 0;
  return logWeights.map((value) => {
    if (!Number.isFinite(value)) return 0;
    return Math.exp(value - maxLogWeight);
  });
}

function applyControlVariate(pathResults, options = {}) {
  if (!Array.isArray(pathResults) || !pathResults.length) {
    return {
      adjustedPnlUsdc: [],
      beta: 0,
      expectedControl: 0,
    };
  }

  const pnl = pathResults.map((item) => Number(item.totalPnlUsdc) || 0);
  const controls = pathResults.map((item) => Number(item.totalFeesUsdc) || 0);
  const meanPnl = weightedMean(pnl);
  const meanControl = weightedMean(controls);
  const expectedControl = Number(options.expectedControl) || 0;

  let covariance = 0;
  let controlVariance = 0;
  for (let i = 0; i < pnl.length; i += 1) {
    const centeredPnl = pnl[i] - meanPnl;
    const centeredControl = controls[i] - meanControl;
    covariance += centeredPnl * centeredControl;
    controlVariance += centeredControl * centeredControl;
  }

  const beta = controlVariance > 0 ? covariance / controlVariance : 0;
  const adjustedPnlUsdc = pnl.map((value, index) => value - beta * (controls[index] - expectedControl));

  return {
    adjustedPnlUsdc,
    beta,
    expectedControl,
  };
}

function buildMirrorSimulateLinear(options = {}) {
  const distribution = resolveDistribution(options);
  const allocation = computeCompleteSetAllocation({
    liquidityUsdc: options.liquidityUsdc,
    distributionYes: distribution.distributionYes,
    distributionNo: distribution.distributionNo,
  });

  const targetYesPct = toPercent(options.targetYesPct !== undefined ? options.targetYesPct : distribution.sourceYesPct);
  const initialYesPct = allocation.impliedPoolYesPct;
  const tradeSide =
    targetYesPct === null || initialYesPct === null
      ? 'none'
      : targetYesPct > initialYesPct
        ? 'yes'
        : targetYesPct < initialYesPct
          ? 'no'
          : 'none';

  const feeTier = Number.isFinite(Number(options.feeTier)) ? Number(options.feeTier) : 3000;
  const hedgeRatio = clamp(toOptionalNumber(options.hedgeRatio) || 1, 0, 5);
  const hedgeCostBps = Math.max(0, toOptionalNumber(options.hedgeCostBps) || 35);
  const polymarketYesPct = toPercent(
    options.polymarketYesPct !== undefined ? options.polymarketYesPct : (targetYesPct !== null ? targetYesPct : 50),
  );

  const volumeScenarios = normalizeVolumeScenarios(options.volumeScenarios, allocation.liquidityUsdc);
  const volumeNeededToTargetUsdc =
    targetYesPct === null
      ? null
      : solveVolumeForTargetYesPct({
          targetYesPct,
          reserveYesUsdc: allocation.reserveYesUsdc,
          reserveNoUsdc: allocation.reserveNoUsdc,
          feeTier,
        });

  const scenarioResults = volumeScenarios.map((volumeUsdc) => {
    const swap = simulateDirectionalSwap({
      reserveYesUsdc: allocation.reserveYesUsdc,
      reserveNoUsdc: allocation.reserveNoUsdc,
      side: tradeSide,
      volumeUsdc,
      feeTier,
    });

    const hedge = computeHedgeMetrics({
      reserveYesUsdc: swap.reserveYesUsdc,
      reserveNoUsdc: swap.reserveNoUsdc,
      excessYesUsdc: allocation.excessYesUsdc,
      excessNoUsdc: allocation.excessNoUsdc,
      hedgeRatio,
      polymarketYesPct,
      hedgeCostBps,
      feeTier,
    });

    const netPnlApproxUsdc = round((swap.feesEarnedUsdc || 0) - (hedge.hedgeCostApproxUsdc || 0), 6);

    return {
      volumeUsdc: round(volumeUsdc, 6),
      tradeSide,
      feesEarnedUsdc: swap.feesEarnedUsdc,
      postReserveYesUsdc: swap.reserveYesUsdc,
      postReserveNoUsdc: swap.reserveNoUsdc,
      postYesPct: swap.postYesPct,
      driftToTargetBps:
        targetYesPct === null || swap.postYesPct === null
          ? null
          : round(Math.abs(targetYesPct - swap.postYesPct) * 100, 6),
      hedge: {
        targetHedgeUsdc: hedge.targetHedgeUsdcSigned,
        hedgeToken: hedge.hedgeToken,
        hedgeSharesApprox: hedge.hedgeSharesApprox,
        hedgeCostApproxUsdc: hedge.hedgeCostApproxUsdc,
      },
      netPnlApproxUsdc,
    };
  });

  return {
    schemaVersion: MIRROR_SIMULATE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    inputs: {
      liquidityUsdc: allocation.liquidityUsdc,
      feeTier,
      hedgeRatio,
      hedgeCostBps,
      sourceYesPct: distribution.sourceYesPct,
      targetYesPct,
      polymarketYesPct,
      distributionYes: distribution.distributionYes,
      distributionNo: distribution.distributionNo,
      distributionMode: distribution.mode,
      tradeSide,
      volumeScenarios,
    },
    initialState: {
      reserveYesUsdc: allocation.reserveYesUsdc,
      reserveNoUsdc: allocation.reserveNoUsdc,
      excessYesUsdc: allocation.excessYesUsdc,
      excessNoUsdc: allocation.excessNoUsdc,
      initialYesPct,
      neutralCompleteSets: allocation.neutralCompleteSets,
    },
    targeting: {
      volumeNeededToTargetUsdc,
      targetReachable: volumeNeededToTargetUsdc !== null,
    },
    scenarios: scenarioResults,
    diagnostics: [
      'Complete-set mint/split step is exact (raw integer math).',
      'Trade path models CPMM directional flow using net-of-fee input in reserve updates; fees are tracked as a separate accrual line.',
      'Use mirror sync + live orderbooks for execution-grade sizing; this command is planning-grade simulation.',
    ].concat(distribution.diagnostics || []),
  };
}

function buildMirrorSimulateMonteCarlo(options = {}, linearPayload) {
  const mcConfig = normalizeMcConfig(options);
  const inputs = linearPayload && linearPayload.inputs ? linearPayload.inputs : {};
  const initialState = linearPayload && linearPayload.initialState ? linearPayload.initialState : {};

  const reserveYesStart = toOptionalNumber(initialState.reserveYesUsdc) || 0;
  const reserveNoStart = toOptionalNumber(initialState.reserveNoUsdc) || 0;
  const excessYesUsdc = toOptionalNumber(initialState.excessYesUsdc) || 0;
  const excessNoUsdc = toOptionalNumber(initialState.excessNoUsdc) || 0;
  const feeTier = Number.isFinite(Number(inputs.feeTier)) ? Number(inputs.feeTier) : 3000;
  const hedgeRatio = clamp(toOptionalNumber(inputs.hedgeRatio) || 1, 0, 5);
  const hedgeCostBps = Math.max(0, toOptionalNumber(inputs.hedgeCostBps) || 35);
  const tradeSide = String(inputs.tradeSide || 'none').toLowerCase();
  const polymarketYesPct = toPercent(inputs.polymarketYesPct) === null ? 50 : toPercent(inputs.polymarketYesPct);
  const scenarioVolumes = Array.isArray(inputs.volumeScenarios)
    ? inputs.volumeScenarios.map((value) => toOptionalNumber(value)).filter((value) => Number.isFinite(value) && value >= 0)
    : [];
  const averageScenarioVolume =
    scenarioVolumes.length > 0
      ? scenarioVolumes.reduce((acc, value) => acc + value, 0) / scenarioVolumes.length
      : Math.max(1, toOptionalNumber(inputs.liquidityUsdc) || 1);
  const baseVolumeUsdc = round(averageScenarioVolume, 6) || 1;

  const rng = createSeededRng(mcConfig.seed);
  const importanceShift = -0.75;
  const pathResults = [];
  const basePathCount = mcConfig.antithetic ? Math.ceil(mcConfig.paths / 2) : mcConfig.paths;

  const runSinglePath = (pathIndex, antitheticSign) => {
    let reserveYesUsdc = reserveYesStart;
    let reserveNoUsdc = reserveNoStart;
    let totalPnlUsdc = 0;
    let totalFeesUsdc = 0;
    let totalHedgeCostUsdc = 0;
    let logWeight = 0;

    for (let stepIndex = 0; stepIndex < mcConfig.steps; stepIndex += 1) {
      let z =
        sampleStandardNormal(rng, {
          stratified: mcConfig.stratified,
          pathIndex,
          pathCount: mcConfig.paths,
          stepIndex,
        }) * antitheticSign;

      if (mcConfig.importanceSampling) {
        const shifted = z + importanceShift;
        logWeight += -importanceShift * shifted + 0.5 * importanceShift * importanceShift;
        z = shifted;
      }

      const volumeMultiplier = clamp(1 + 0.35 * z, 0.05, 3.5);
      const stepVolumeUsdc = round(baseVolumeUsdc * volumeMultiplier, 6) || 0;
      const swap = simulateDirectionalSwap({
        reserveYesUsdc,
        reserveNoUsdc,
        side: tradeSide,
        volumeUsdc: stepVolumeUsdc,
        feeTier,
      });

      reserveYesUsdc = toOptionalNumber(swap.reserveYesUsdc) || reserveYesUsdc;
      reserveNoUsdc = toOptionalNumber(swap.reserveNoUsdc) || reserveNoUsdc;

      const hedge = computeHedgeMetrics({
        reserveYesUsdc,
        reserveNoUsdc,
        excessYesUsdc,
        excessNoUsdc,
        hedgeRatio,
        polymarketYesPct,
        hedgeCostBps,
        feeTier,
      });

      const stressMultiplier = 1 + Math.max(0, -z) * 0.2;
      const hedgeCostUsdc = (hedge.hedgeCostApproxUsdc || 0) * stressMultiplier;
      const feesEarnedUsdc = swap.feesEarnedUsdc || 0;
      const stepPnlUsdc = feesEarnedUsdc - hedgeCostUsdc;

      totalFeesUsdc += feesEarnedUsdc;
      totalHedgeCostUsdc += hedgeCostUsdc;
      totalPnlUsdc += stepPnlUsdc;
    }

    return {
      totalPnlUsdc,
      totalFeesUsdc,
      totalHedgeCostUsdc,
      logWeight,
    };
  };

  for (let pathIndex = 0; pathIndex < basePathCount && pathResults.length < mcConfig.paths; pathIndex += 1) {
    pathResults.push(runSinglePath(pathIndex, 1));
    if (mcConfig.antithetic && pathResults.length < mcConfig.paths) {
      pathResults.push(runSinglePath(pathIndex, -1));
    }
  }

  const pathWeights = mcConfig.importanceSampling
    ? normalizeWeightsFromLog(pathResults.map((entry) => entry.logWeight))
    : new Array(pathResults.length).fill(1);

  const feeRate = clamp(feeTier / 1_000_000, 0, 0.1);
  const expectedControl = tradeSide === 'none' ? 0 : baseVolumeUsdc * mcConfig.steps * feeRate;
  const control = mcConfig.controlVariate
    ? applyControlVariate(pathResults, { expectedControl })
    : {
        adjustedPnlUsdc: pathResults.map((entry) => entry.totalPnlUsdc),
        beta: 0,
        expectedControl,
      };

  const adjustedPnlUsdc = control.adjustedPnlUsdc;
  const lossesUsdc = adjustedPnlUsdc.map((value) => Math.max(0, -value));

  const expectedPnlUsdc = weightedMean(adjustedPnlUsdc, pathWeights);
  const stdDevPnlUsdc = weightedStdDev(adjustedPnlUsdc, pathWeights, expectedPnlUsdc);
  const sampleCount = pathResults.length;
  const nEff = effectiveSampleSize(pathWeights);
  const sampleForCi = Math.max(1, nEff || sampleCount);
  const standardError = stdDevPnlUsdc / Math.sqrt(sampleForCi);
  const ci95LowUsdc = expectedPnlUsdc - 1.96 * standardError;
  const ci95HighUsdc = expectedPnlUsdc + 1.96 * standardError;
  const lossProbabilityPct = weightedMean(
    adjustedPnlUsdc.map((value) => (value < 0 ? 1 : 0)),
    pathWeights,
  ) * 100;

  const var95Usdc = weightedQuantile(lossesUsdc, pathWeights, 0.95);
  const var99Usdc = weightedQuantile(lossesUsdc, pathWeights, 0.99);
  const es95Usdc = weightedTailMean(lossesUsdc, pathWeights, var95Usdc);
  const es99Usdc = weightedTailMean(lossesUsdc, pathWeights, var99Usdc);

  const mcDiagnostics = [
    `Monte Carlo executed ${sampleCount} paths x ${mcConfig.steps} steps (seed=${mcConfig.seed}).`,
  ];
  if (mcConfig.antithetic) {
    mcDiagnostics.push('Variance reduction enabled: antithetic pairing.');
  }
  if (mcConfig.controlVariate) {
    mcDiagnostics.push('Variance reduction enabled: control variate adjustment on fee accrual.');
  }
  if (mcConfig.stratified) {
    mcDiagnostics.push('Variance reduction enabled: stratified normal draws.');
  }
  if (mcConfig.importanceSampling) {
    mcDiagnostics.push('Tail sampling enabled: importance-sampling likelihood reweighting.');
  }

  return {
    ...linearPayload,
    inputs: {
      ...inputs,
      engine: 'mc',
      paths: mcConfig.paths,
      steps: mcConfig.steps,
      seed: mcConfig.seed,
      varianceReduction: {
        importanceSampling: mcConfig.importanceSampling,
        antithetic: mcConfig.antithetic,
        controlVariate: mcConfig.controlVariate,
        stratified: mcConfig.stratified,
      },
    },
    mc: {
      summary: {
        paths: mcConfig.paths,
        steps: mcConfig.steps,
        seed: mcConfig.seed,
        expectedPnlUsdc: round(expectedPnlUsdc, 6),
        stdDevPnlUsdc: round(stdDevPnlUsdc, 6),
        ci95LowUsdc: round(ci95LowUsdc, 6),
        ci95HighUsdc: round(ci95HighUsdc, 6),
        lossProbabilityPct: round(lossProbabilityPct, 6),
        effectiveSampleSize: round(nEff || sampleCount, 6),
        controlVariateBeta: mcConfig.controlVariate ? round(control.beta, 6) : null,
      },
      distribution: {
        pnlUsdcPercentiles: {
          p01: round(weightedQuantile(adjustedPnlUsdc, pathWeights, 0.01), 6),
          p05: round(weightedQuantile(adjustedPnlUsdc, pathWeights, 0.05), 6),
          p50: round(weightedQuantile(adjustedPnlUsdc, pathWeights, 0.5), 6),
          p95: round(weightedQuantile(adjustedPnlUsdc, pathWeights, 0.95), 6),
          p99: round(weightedQuantile(adjustedPnlUsdc, pathWeights, 0.99), 6),
        },
        minPnlUsdc: round(Math.min(...adjustedPnlUsdc), 6),
        maxPnlUsdc: round(Math.max(...adjustedPnlUsdc), 6),
      },
      tailRisk: {
        var95Usdc: round(var95Usdc, 6),
        var99Usdc: round(var99Usdc, 6),
        es95Usdc: round(es95Usdc, 6),
        es99Usdc: round(es99Usdc, 6),
      },
      diagnostics: mcDiagnostics,
    },
    diagnostics: (Array.isArray(linearPayload.diagnostics) ? linearPayload.diagnostics : []).concat(mcDiagnostics),
  };
}

function buildMirrorSimulate(options = {}) {
  const engine = normalizeSimulateEngine(options.engine);
  const linearPayload = buildMirrorSimulateLinear(options);
  if (engine !== 'mc') return linearPayload;
  return buildMirrorSimulateMonteCarlo(options, linearPayload);
}

module.exports = {
  MIRROR_LP_EXPLAIN_SCHEMA_VERSION,
  MIRROR_HEDGE_CALC_SCHEMA_VERSION,
  MIRROR_SIMULATE_SCHEMA_VERSION,
  resolveDistribution,
  computeCompleteSetAllocation,
  simulateDirectionalSwap,
  solveVolumeForTargetYesPct,
  computeHedgeMetrics,
  buildMirrorLpExplain,
  buildMirrorHedgeCalc,
  buildMirrorSimulateLinear,
  buildMirrorSimulateMonteCarlo,
  buildMirrorSimulate,
};
