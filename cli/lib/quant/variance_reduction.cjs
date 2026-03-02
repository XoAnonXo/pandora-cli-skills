const { mean, variance } = require('./mc_stats.cjs');

function createQuantError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function ensureRng(rng) {
  if (!rng || typeof rng.next !== 'function' || typeof rng.nextNormal !== 'function') {
    throw createQuantError('QUANT_INVALID_INPUT', 'A RNG with next() and nextNormal() is required.', {
      hasRng: Boolean(rng),
    });
  }
}

function antitheticUniformPairs(rng, pairCount) {
  ensureRng(rng);
  const pairs = Number(pairCount);
  if (!Number.isInteger(pairs) || pairs <= 0) {
    throw createQuantError('QUANT_INVALID_INPUT', 'pairCount must be a positive integer.', {
      pairCount,
    });
  }

  const out = [];
  for (let i = 0; i < pairs; i += 1) {
    const u = rng.next();
    out.push([u, 1 - u]);
  }
  return out;
}

function antitheticNormalSamples(rng, pairCount, options = {}) {
  ensureRng(rng);
  const pairs = Number(pairCount);
  if (!Number.isInteger(pairs) || pairs <= 0) {
    throw createQuantError('QUANT_INVALID_INPUT', 'pairCount must be a positive integer.', {
      pairCount,
    });
  }

  const meanValue = options.mean === undefined ? 0 : Number(options.mean);
  const stdDev = options.stdDev === undefined ? 1 : Number(options.stdDev);
  if (!Number.isFinite(meanValue) || !Number.isFinite(stdDev) || stdDev <= 0) {
    throw createQuantError('QUANT_INVALID_INPUT', 'mean and stdDev must be finite; stdDev must be > 0.', {
      mean: options.mean,
      stdDev: options.stdDev,
    });
  }

  const samples = [];
  for (let i = 0; i < pairs; i += 1) {
    const z = rng.nextNormal();
    samples.push(meanValue + stdDev * z);
    samples.push(meanValue + stdDev * (-z));
  }
  return samples;
}

function stratifiedUniformSamples(rng, count) {
  if (!rng || typeof rng.next !== 'function') {
    throw createQuantError('QUANT_INVALID_INPUT', 'A RNG with next() is required.', {
      hasRng: Boolean(rng),
    });
  }

  const n = Number(count);
  if (!Number.isInteger(n) || n <= 0) {
    throw createQuantError('QUANT_INVALID_INPUT', 'count must be a positive integer.', {
      count,
    });
  }

  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push((i + rng.next()) / n);
  }
  return out;
}

function covariance(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length === 0) {
    throw createQuantError('QUANT_INVALID_INPUT', 'covariance requires arrays with equal non-zero length.', {
      leftLength: Array.isArray(left) ? left.length : null,
      rightLength: Array.isArray(right) ? right.length : null,
    });
  }

  const leftMean = mean(left);
  const rightMean = mean(right);
  let total = 0;
  for (let i = 0; i < left.length; i += 1) {
    total += (Number(left[i]) - leftMean) * (Number(right[i]) - rightMean);
  }
  return total / left.length;
}

function applyControlVariate(targetSamples, controlSamples, controlMean) {
  if (!Array.isArray(targetSamples) || !Array.isArray(controlSamples) || targetSamples.length !== controlSamples.length) {
    throw createQuantError(
      'QUANT_INVALID_INPUT',
      'targetSamples and controlSamples must be arrays of equal length.',
      {
        targetLength: Array.isArray(targetSamples) ? targetSamples.length : null,
        controlLength: Array.isArray(controlSamples) ? controlSamples.length : null,
      },
    );
  }
  if (targetSamples.length === 0) {
    throw createQuantError('QUANT_INVALID_INPUT', 'targetSamples cannot be empty.', {});
  }

  const controlAvg = controlMean === undefined ? mean(controlSamples) : Number(controlMean);
  if (!Number.isFinite(controlAvg)) {
    throw createQuantError('QUANT_INVALID_INPUT', 'controlMean must be a finite number.', { controlMean });
  }

  const controlVariance = variance(controlSamples);
  const beta = controlVariance > 0 ? covariance(targetSamples, controlSamples) / controlVariance : 0;
  const adjustedSamples = targetSamples.map((target, index) => {
    return Number(target) - beta * (Number(controlSamples[index]) - controlAvg);
  });

  const targetVariance = variance(targetSamples);
  const adjustedVariance = variance(adjustedSamples);
  const varianceReductionPct =
    targetVariance > 0 ? ((targetVariance - adjustedVariance) / targetVariance) * 100 : 0;

  return {
    beta,
    targetMean: mean(targetSamples),
    adjustedMean: mean(adjustedSamples),
    targetVariance,
    adjustedVariance,
    varianceReductionPct,
    adjustedSamples,
  };
}

/**
 * Documented exports:
 * - antitheticUniformPairs: generate deterministic antithetic uniforms.
 * - antitheticNormalSamples: generate +/- normal pairs for path simulation.
 * - stratifiedUniformSamples: one sample per stratum in [0, 1).
 * - applyControlVariate: control variate adjustment with diagnostics.
 */
module.exports = {
  antitheticUniformPairs,
  antitheticNormalSamples,
  stratifiedUniformSamples,
  applyControlVariate,
};
