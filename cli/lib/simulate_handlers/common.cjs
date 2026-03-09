const { clamp, round } = require('../shared/utils.cjs');

const PROBABILITY_EPSILON = 1e-9;

function clampProbability01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0.5;
  }
  return clamp(numeric, PROBABILITY_EPSILON, 1 - PROBABILITY_EPSILON);
}

function toProbabilityFromPercent(percent) {
  return clampProbability01(Number(percent) / 100);
}

function toPercent(probability) {
  return round(clampProbability01(probability) * 100, 6);
}

function logistic(value) {
  const x = Number(value);
  if (!Number.isFinite(x)) {
    return 0.5;
  }

  if (x >= 0) {
    const exp = Math.exp(-x);
    return 1 / (1 + exp);
  }

  const exp = Math.exp(x);
  return exp / (1 + exp);
}

function logit(probability) {
  const p = clampProbability01(probability);
  return Math.log(p / (1 - p));
}

function createSeededRandom(seed) {
  if (!Number.isInteger(seed)) {
    return Math.random;
  }

  let state = seed >>> 0;
  return function nextUniform() {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createNormalSampler(uniformSource) {
  let spare = null;

  return function sampleNormal() {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }

    let u1 = uniformSource();
    let u2 = uniformSource();
    if (u1 <= Number.EPSILON) u1 = Number.EPSILON;
    if (u2 <= Number.EPSILON) u2 = Number.EPSILON;

    const radius = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    const z0 = radius * Math.cos(theta);
    const z1 = radius * Math.sin(theta);
    spare = z1;
    return z0;
  };
}

function inverseStandardNormal(probability) {
  const p = clamp(probability, PROBABILITY_EPSILON, 1 - PROBABILITY_EPSILON);

  const a1 = -39.69683028665376;
  const a2 = 220.9460984245205;
  const a3 = -275.9285104469687;
  const a4 = 138.357751867269;
  const a5 = -30.66479806614716;
  const a6 = 2.506628277459239;

  const b1 = -54.47609879822406;
  const b2 = 161.5858368580409;
  const b3 = -155.6989798598866;
  const b4 = 66.80131188771972;
  const b5 = -13.28068155288572;

  const c1 = -0.007784894002430293;
  const c2 = -0.3223964580411365;
  const c3 = -2.400758277161838;
  const c4 = -2.549732539343734;
  const c5 = 4.374664141464968;
  const c6 = 2.938163982698783;

  const d1 = 0.007784695709041462;
  const d2 = 0.3224671290700398;
  const d3 = 2.445134137142996;
  const d4 = 3.754408661907416;

  const lower = 0.02425;
  const upper = 1 - lower;

  if (p < lower) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
      ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
  }

  if (p > upper) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
      ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
  }

  const q = p - 0.5;
  const r = q * q;
  return (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q /
    (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1);
}

function buildNormalPool(count, options = {}) {
  const total = Number.isInteger(count) && count > 0 ? count : 0;
  const uniformSource = typeof options.uniformSource === 'function' ? options.uniformSource : Math.random;

  if (total === 0) {
    return [];
  }

  if (options.stratified) {
    const draws = new Array(total);
    for (let i = 0; i < total; i += 1) {
      const u = (i + uniformSource()) / total;
      draws[i] = inverseStandardNormal(u);
    }

    for (let i = draws.length - 1; i > 0; i -= 1) {
      const swapIndex = Math.floor(uniformSource() * (i + 1));
      const temp = draws[i];
      draws[i] = draws[swapIndex];
      draws[swapIndex] = temp;
    }

    return draws;
  }

  const sampleNormal = createNormalSampler(uniformSource);
  const draws = new Array(total);
  for (let i = 0; i < total; i += 1) {
    draws[i] = sampleNormal();
  }
  return draws;
}

function quantile(values, probability) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const p = clamp(Number(probability), 0, 1);
  const position = (sorted.length - 1) * p;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);

  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }

  const weight = position - lowerIndex;
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return sum / values.length;
}

function standardDeviation(values, meanValue = null) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const avg = meanValue === null ? mean(values) : meanValue;
  if (avg === null) return null;

  let varianceSum = 0;
  for (const value of values) {
    const delta = value - avg;
    varianceSum += delta * delta;
  }

  return Math.sqrt(varianceSum / values.length);
}

function normalizeWeights(weights) {
  if (!Array.isArray(weights) || weights.length === 0) {
    return {
      normalized: [],
      sum: 0,
      valid: false,
    };
  }

  let sum = 0;
  for (const weight of weights) {
    sum += weight;
  }

  if (!Number.isFinite(sum) || sum <= 0) {
    return {
      normalized: new Array(weights.length).fill(1 / weights.length),
      sum,
      valid: false,
    };
  }

  return {
    normalized: weights.map((weight) => weight / sum),
    sum,
    valid: true,
  };
}

function effectiveSampleSize(weights) {
  if (!Array.isArray(weights) || weights.length === 0) {
    return 0;
  }

  let squaredSum = 0;
  for (const weight of weights) {
    squaredSum += weight * weight;
  }
  if (squaredSum <= 0) {
    return 0;
  }
  return 1 / squaredSum;
}

function weightedMean(values, weights) {
  if (!Array.isArray(values) || !Array.isArray(weights) || values.length !== weights.length || values.length === 0) {
    return null;
  }

  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < values.length; i += 1) {
    weightedSum += values[i] * weights[i];
    totalWeight += weights[i];
  }

  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    return null;
  }

  return weightedSum / totalWeight;
}

function weightedQuantile(values, weights, probability) {
  if (!Array.isArray(values) || !Array.isArray(weights) || values.length !== weights.length || values.length === 0) {
    return null;
  }

  const normalized = normalizeWeights(weights).normalized;
  const pairs = values.map((value, index) => ({
    value,
    weight: normalized[index],
  })).sort((left, right) => left.value - right.value);

  const target = clamp(Number(probability), 0, 1);
  let cumulative = 0;
  for (const pair of pairs) {
    cumulative += pair.weight;
    if (cumulative >= target) {
      return pair.value;
    }
  }

  return pairs[pairs.length - 1].value;
}

function systematicResampleIndices(weights, uniformSource) {
  const normalized = normalizeWeights(weights).normalized;
  const size = normalized.length;
  if (size === 0) {
    return [];
  }

  const indices = new Array(size);
  const step = 1 / size;
  const start = uniformSource() * step;
  let cumulative = normalized[0];
  let sourceIndex = 0;

  for (let i = 0; i < size; i += 1) {
    const threshold = start + i * step;
    while (threshold > cumulative && sourceIndex < size - 1) {
      sourceIndex += 1;
      cumulative += normalized[sourceIndex];
    }
    indices[i] = sourceIndex;
  }

  return indices;
}

function multinomialResampleIndices(weights, uniformSource) {
  const normalized = normalizeWeights(weights).normalized;
  const cumulative = new Array(normalized.length);
  let running = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    running += normalized[i];
    cumulative[i] = running;
  }

  const indices = new Array(normalized.length);
  for (let i = 0; i < normalized.length; i += 1) {
    const draw = uniformSource();
    let selected = 0;
    while (selected < cumulative.length - 1 && draw > cumulative[selected]) {
      selected += 1;
    }
    indices[i] = selected;
  }

  return indices;
}

module.exports = {
  PROBABILITY_EPSILON,
  clampProbability01,
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
  normalizeWeights,
  effectiveSampleSize,
  weightedMean,
  weightedQuantile,
  systematicResampleIndices,
  multinomialResampleIndices,
};
