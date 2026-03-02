function createQuantError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function ensureNumericArray(values, name = 'values') {
  if (!Array.isArray(values) || values.length === 0) {
    throw createQuantError('QUANT_INVALID_SAMPLES', `${name} must be a non-empty array.`, {
      [name]: values,
    });
  }
  for (let i = 0; i < values.length; i += 1) {
    const value = Number(values[i]);
    if (!Number.isFinite(value)) {
      throw createQuantError('QUANT_INVALID_SAMPLES', `${name} must contain finite numeric entries.`, {
        index: i,
        value: values[i],
      });
    }
  }
}

function sortedCopy(values) {
  return values.map((value) => Number(value)).sort((a, b) => a - b);
}

function sum(values) {
  ensureNumericArray(values, 'values');
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    total += Number(values[i]);
  }
  return total;
}

function mean(values) {
  return sum(values) / values.length;
}

function variance(values, options = {}) {
  ensureNumericArray(values, 'values');
  const sample = Boolean(options.sample);
  if (sample && values.length < 2) {
    return 0;
  }

  const avg = mean(values);
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    const delta = Number(values[i]) - avg;
    total += delta * delta;
  }
  const denominator = sample ? values.length - 1 : values.length;
  return denominator > 0 ? total / denominator : 0;
}

function standardDeviation(values, options = {}) {
  return Math.sqrt(variance(values, options));
}

function quantile(values, q) {
  ensureNumericArray(values, 'values');
  const alpha = Number(q);
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw createQuantError('QUANT_INVALID_QUANTILE', 'q must be between 0 and 1.', { q });
  }

  const sorted = sortedCopy(values);
  if (sorted.length === 1) return sorted[0];

  const position = (sorted.length - 1) * alpha;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sorted[lowerIndex];

  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  return lower + (upper - lower) * (position - lowerIndex);
}

function zScoreForConfidence(confidenceLevel) {
  const level = Number(confidenceLevel);
  if (!Number.isFinite(level) || level <= 0 || level >= 1) {
    throw createQuantError('QUANT_INVALID_INPUT', 'confidenceLevel must be between 0 and 1.', {
      confidenceLevel,
    });
  }

  if (Math.abs(level - 0.9) < 1e-12) return 1.6448536269514722;
  if (Math.abs(level - 0.95) < 1e-12) return 1.959963984540054;
  if (Math.abs(level - 0.99) < 1e-12) return 2.5758293035489004;

  // Approximation from Abramowitz and Stegun 26.2.23 (sufficient for CI reporting).
  const p = 1 - (1 - level) / 2;
  const t = Math.sqrt(-2 * Math.log(1 - p));
  const c0 = 2.515517;
  const c1 = 0.802853;
  const c2 = 0.010328;
  const d1 = 1.432788;
  const d2 = 0.189269;
  const d3 = 0.001308;
  return t - ((c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t));
}

function computeTailRisk(samples, options = {}) {
  ensureNumericArray(samples, 'samples');
  const levels = Array.isArray(options.levels) && options.levels.length ? options.levels : [0.95, 0.99];

  const out = {};
  for (const levelValue of levels) {
    const level = Number(levelValue);
    if (!Number.isFinite(level) || level <= 0 || level >= 1) {
      throw createQuantError('QUANT_INVALID_INPUT', 'Tail risk levels must be between 0 and 1.', {
        level: levelValue,
      });
    }
    const threshold = 1 - level;
    const varValue = quantile(samples, threshold);
    const tail = [];
    for (const sample of samples) {
      const numeric = Number(sample);
      if (numeric <= varValue) {
        tail.push(numeric);
      }
    }
    const expectedShortfall = tail.length ? mean(tail) : varValue;
    const keySuffix = String(Math.round(level * 100));
    out[`var${keySuffix}`] = varValue;
    out[`es${keySuffix}`] = expectedShortfall;
  }
  return out;
}

function summarizeSamples(samples, options = {}) {
  ensureNumericArray(samples, 'samples');
  const confidenceLevel = options.confidenceLevel === undefined ? 0.95 : Number(options.confidenceLevel);
  const count = samples.length;
  const avg = mean(samples);
  const varianceValue = variance(samples);
  const stdDev = Math.sqrt(varianceValue);
  const stdErr = count > 0 ? stdDev / Math.sqrt(count) : 0;
  const z = zScoreForConfidence(confidenceLevel);

  return {
    count,
    mean: avg,
    variance: varianceValue,
    stdDev,
    min: quantile(samples, 0),
    p05: quantile(samples, 0.05),
    p25: quantile(samples, 0.25),
    p50: quantile(samples, 0.5),
    p75: quantile(samples, 0.75),
    p95: quantile(samples, 0.95),
    max: quantile(samples, 1),
    confidenceLevel,
    confidenceInterval: {
      lower: avg - z * stdErr,
      upper: avg + z * stdErr,
    },
    tailRisk: computeTailRisk(samples, {
      levels: Array.isArray(options.tailLevels) && options.tailLevels.length ? options.tailLevels : [0.95, 0.99],
    }),
  };
}

/**
 * Documented exports:
 * - sum/mean/variance/standardDeviation: core Monte Carlo aggregate stats.
 * - quantile(values, q): deterministic percentile interpolation.
 * - computeTailRisk(samples): left-tail VaR/ES metrics.
 * - summarizeSamples(samples): canonical summary payload used by quant commands.
 */
module.exports = {
  sum,
  mean,
  variance,
  standardDeviation,
  quantile,
  computeTailRisk,
  summarizeSamples,
};
