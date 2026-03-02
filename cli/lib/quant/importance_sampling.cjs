const { createQuantError } = require('./errors.cjs');

function ensureNumericArray(values, name) {
  if (!Array.isArray(values) || values.length === 0) {
    throw createQuantError('QUANT_INVALID_INPUT', `${name} must be a non-empty array.`, {
      [name]: values,
    });
  }
  for (let i = 0; i < values.length; i += 1) {
    const numeric = Number(values[i]);
    if (!Number.isFinite(numeric)) {
      throw createQuantError('QUANT_INVALID_INPUT', `${name} must contain finite numeric values.`, {
        index: i,
        value: values[i],
      });
    }
  }
}

function logSumExp(logValues) {
  ensureNumericArray(logValues, 'logValues');
  let maxValue = Number(logValues[0]);
  for (let i = 1; i < logValues.length; i += 1) {
    const candidate = Number(logValues[i]);
    if (candidate > maxValue) {
      maxValue = candidate;
    }
  }
  let accumulator = 0;
  for (let i = 0; i < logValues.length; i += 1) {
    accumulator += Math.exp(Number(logValues[i]) - maxValue);
  }
  return maxValue + Math.log(accumulator);
}

function normalizeLogWeights(logWeights) {
  ensureNumericArray(logWeights, 'logWeights');
  const denominator = logSumExp(logWeights);
  const normalized = logWeights.map((value) => Math.exp(Number(value) - denominator));
  return normalizeWeights(normalized);
}

function normalizeWeights(weights) {
  ensureNumericArray(weights, 'weights');
  let sum = 0;
  const normalized = [];
  for (let i = 0; i < weights.length; i += 1) {
    const weight = Number(weights[i]);
    if (weight < 0) {
      throw createQuantError('QUANT_INVALID_INPUT', 'weights cannot contain negative values.', {
        index: i,
        value: weight,
      });
    }
    normalized.push(weight);
    sum += weight;
  }

  if (!(sum > 0)) {
    throw createQuantError('QUANT_INVALID_INPUT', 'weights must sum to a positive value.', {
      sum,
    });
  }

  for (let i = 0; i < normalized.length; i += 1) {
    normalized[i] /= sum;
  }
  return normalized;
}

function weightedMean(values, weights) {
  ensureNumericArray(values, 'values');
  const normalized = normalizeWeights(weights);
  if (values.length !== normalized.length) {
    throw createQuantError('QUANT_INVALID_INPUT', 'values and weights must have the same length.', {
      valueLength: values.length,
      weightLength: normalized.length,
    });
  }

  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    total += Number(values[i]) * normalized[i];
  }
  return total;
}

function weightedVariance(values, weights) {
  const avg = weightedMean(values, weights);
  const normalized = normalizeWeights(weights);
  if (values.length !== normalized.length) {
    throw createQuantError('QUANT_INVALID_INPUT', 'values and weights must have the same length.', {
      valueLength: values.length,
      weightLength: normalized.length,
    });
  }

  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    const delta = Number(values[i]) - avg;
    total += normalized[i] * delta * delta;
  }
  return total;
}

function effectiveSampleSize(weights) {
  const normalized = normalizeWeights(weights);
  let total = 0;
  for (const weight of normalized) {
    total += weight * weight;
  }
  return total > 0 ? 1 / total : 0;
}

function resampleSystematic(items, weights, rng) {
  if (!Array.isArray(items) || items.length === 0) {
    throw createQuantError('QUANT_INVALID_INPUT', 'items must be a non-empty array.', {
      itemCount: Array.isArray(items) ? items.length : null,
    });
  }
  if (!rng || typeof rng.next !== 'function') {
    throw createQuantError('QUANT_INVALID_INPUT', 'resampleSystematic requires rng.next().', {
      hasRng: Boolean(rng),
    });
  }

  const normalized = normalizeWeights(weights);
  if (normalized.length !== items.length) {
    throw createQuantError('QUANT_INVALID_INPUT', 'items and weights must have the same length.', {
      itemLength: items.length,
      weightLength: normalized.length,
    });
  }

  const output = [];
  const count = items.length;
  const step = 1 / count;
  let target = rng.next() * step;
  let cumulative = 0;
  let index = 0;

  for (let i = 0; i < count; i += 1) {
    while (index < normalized.length - 1 && cumulative + normalized[index] < target) {
      cumulative += normalized[index];
      index += 1;
    }
    output.push(items[index]);
    target += step;
  }

  return output;
}

function importanceSamplingEstimate(samples, options = {}) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw createQuantError('QUANT_INVALID_INPUT', 'samples must be a non-empty array.', {
      sampleCount: Array.isArray(samples) ? samples.length : null,
    });
  }

  const targetDensity = options.targetDensity;
  const proposalDensity = options.proposalDensity;
  const valueFn = typeof options.valueFn === 'function' ? options.valueFn : (sample) => sample;

  if (typeof targetDensity !== 'function' || typeof proposalDensity !== 'function') {
    throw createQuantError('QUANT_INVALID_INPUT', 'targetDensity and proposalDensity functions are required.', {
      hasTargetDensity: typeof targetDensity === 'function',
      hasProposalDensity: typeof proposalDensity === 'function',
    });
  }

  const weights = [];
  const values = [];
  for (const sample of samples) {
    const target = Number(targetDensity(sample));
    const proposal = Number(proposalDensity(sample));
    const value = Number(valueFn(sample));

    if (!Number.isFinite(target) || target < 0 || !Number.isFinite(proposal) || proposal <= 0 || !Number.isFinite(value)) {
      continue;
    }

    weights.push(target / proposal);
    values.push(value);
  }

  if (!weights.length) {
    throw createQuantError('QUANT_INVALID_INPUT', 'No valid samples remained after density evaluation.', {
      sampleCount: samples.length,
    });
  }

  const normalized = normalizeWeights(weights);
  const estimate = weightedMean(values, normalized);
  const variance = weightedVariance(values, normalized);

  return {
    estimate,
    variance,
    effectiveSampleSize: effectiveSampleSize(normalized),
    normalizedWeights: normalized,
    acceptedSampleCount: normalized.length,
  };
}

/**
 * Documented exports:
 * - normalizeWeights/normalizeLogWeights: stable weight normalization.
 * - effectiveSampleSize: ESS diagnostic for weighted samples.
 * - weightedMean/weightedVariance: weighted estimators.
 * - resampleSystematic: deterministic systematic resampling.
 * - importanceSamplingEstimate: generic IS estimator helper.
 */
module.exports = {
  logSumExp,
  normalizeWeights,
  normalizeLogWeights,
  weightedMean,
  weightedVariance,
  effectiveSampleSize,
  resampleSystematic,
  importanceSamplingEstimate,
};
