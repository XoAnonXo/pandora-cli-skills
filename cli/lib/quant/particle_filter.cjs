const { createRng } = require('./rng.cjs');
const {
  normalizeWeights,
  weightedMean,
  effectiveSampleSize,
  resampleSystematic,
} = require('./importance_sampling.cjs');
const { createQuantError } = require('./errors.cjs');

const PARTICLE_FILTER_SCHEMA_VERSION = '1.0.0';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sigmoid(value) {
  const x = Number(value);
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

function logit(probability) {
  const p = clamp(Number(probability), 1e-9, 1 - 1e-9);
  return Math.log(p / (1 - p));
}

function parseProbability(value, fieldName) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw createQuantError('QUANT_INVALID_INPUT', `${fieldName} must be numeric.`, {
      fieldName,
      value,
    });
  }
  const probability = numeric > 1 && numeric <= 100 ? numeric / 100 : numeric;
  if (probability < 0 || probability > 1) {
    throw createQuantError('QUANT_INVALID_INPUT', `${fieldName} must be between 0 and 1 (or 0-100 pct).`, {
      fieldName,
      value,
    });
  }
  return probability;
}

function normalizeObservation(entry, index) {
  if (Number.isFinite(Number(entry))) {
    return {
      step: index + 1,
      timestamp: null,
      probability: parseProbability(entry, `observations[${index}]`),
    };
  }

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw createQuantError('QUANT_INVALID_INPUT', 'Observation must be a number or object payload.', {
      index,
      observation: entry,
    });
  }

  const rawProbability =
    entry.probability
    ?? entry.yesProbability
    ?? entry.yes_price
    ?? entry.yesPct
    ?? entry.price
    ?? entry.value;

  if (rawProbability === undefined || rawProbability === null) {
    throw createQuantError('QUANT_INVALID_INPUT', 'Observation object is missing probability field.', {
      index,
      observation: entry,
    });
  }

  let timestamp = null;
  if (entry.timestamp !== undefined && entry.timestamp !== null) {
    const parsed = Date.parse(String(entry.timestamp));
    if (Number.isFinite(parsed)) {
      timestamp = new Date(parsed).toISOString();
    }
  }

  return {
    step: index + 1,
    timestamp,
    probability: parseProbability(rawProbability, `observations[${index}]`),
  };
}

function normalizeLogWeights(logWeights) {
  if (!Array.isArray(logWeights) || logWeights.length === 0) {
    throw createQuantError('QUANT_INVALID_INPUT', 'logWeights must be a non-empty array.', {
      logWeights,
    });
  }

  let maxLogWeight = Number(logWeights[0]);
  for (let i = 1; i < logWeights.length; i += 1) {
    const candidate = Number(logWeights[i]);
    if (candidate > maxLogWeight) {
      maxLogWeight = candidate;
    }
  }
  const shifted = logWeights.map((value) => Math.exp(value - maxLogWeight));
  return normalizeWeights(shifted);
}

function weightedQuantile(values, weights, q) {
  const alpha = Number(q);
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw createQuantError('QUANT_INVALID_INPUT', 'q must be between 0 and 1.', { q });
  }

  const normalized = normalizeWeights(weights);
  if (!Array.isArray(values) || values.length !== normalized.length || values.length === 0) {
    throw createQuantError('QUANT_INVALID_INPUT', 'values and weights must have equal non-zero length.', {
      valueLength: Array.isArray(values) ? values.length : null,
      weightLength: normalized.length,
    });
  }

  const pairs = values.map((value, index) => ({ value: Number(value), weight: normalized[index] }));
  pairs.sort((left, right) => left.value - right.value);

  let cumulative = 0;
  for (const pair of pairs) {
    cumulative += pair.weight;
    if (cumulative >= alpha) {
      return pair.value;
    }
  }
  return pairs[pairs.length - 1].value;
}

function gaussianLogLikelihood(observedProbability, latentProbability, observationStd) {
  const residual = observedProbability - latentProbability;
  const variance = observationStd * observationStd;
  return -0.5 * ((residual * residual) / variance + Math.log(2 * Math.PI * variance));
}

function runParticleFilter(options = {}) {
  const rawObservations = Array.isArray(options.observations) ? options.observations : [];
  const particleCount = options.particleCount === undefined ? 500 : Number(options.particleCount);
  const seed = options.seed === undefined ? 1 : options.seed;
  const processStd = options.processStd === undefined ? 0.12 : Number(options.processStd);
  const observationStd = options.observationStd === undefined ? 0.08 : Number(options.observationStd);
  const initialProbability = options.initialProbability === undefined ? 0.5 : parseProbability(options.initialProbability, 'initialProbability');
  const initialLogitStd = options.initialLogitStd === undefined ? 0.35 : Number(options.initialLogitStd);
  const resampleThreshold = options.resampleThreshold === undefined ? 0.5 : Number(options.resampleThreshold);
  const skipInvalidObservations = options.skipInvalidObservations !== false;

  if (!Number.isInteger(particleCount) || particleCount <= 1) {
    throw createQuantError('QUANT_INVALID_INPUT', 'particleCount must be an integer greater than 1.', {
      particleCount: options.particleCount,
    });
  }
  if (!Number.isFinite(processStd) || processStd < 0) {
    throw createQuantError('QUANT_INVALID_INPUT', 'processStd must be a finite non-negative number.', {
      processStd: options.processStd,
    });
  }
  if (!Number.isFinite(observationStd) || observationStd <= 0) {
    throw createQuantError('QUANT_INVALID_INPUT', 'observationStd must be a finite positive number.', {
      observationStd: options.observationStd,
    });
  }
  if (!Number.isFinite(initialLogitStd) || initialLogitStd < 0) {
    throw createQuantError('QUANT_INVALID_INPUT', 'initialLogitStd must be a finite non-negative number.', {
      initialLogitStd: options.initialLogitStd,
    });
  }
  if (!Number.isFinite(resampleThreshold) || resampleThreshold <= 0 || resampleThreshold > 1) {
    throw createQuantError('QUANT_INVALID_INPUT', 'resampleThreshold must be in (0, 1].', {
      resampleThreshold: options.resampleThreshold,
    });
  }

  const normalizedObservations = [];
  let skippedObservationCount = 0;
  for (let i = 0; i < rawObservations.length; i += 1) {
    try {
      normalizedObservations.push(normalizeObservation(rawObservations[i], i));
    } catch (error) {
      if (!skipInvalidObservations) {
        throw error;
      }
      skippedObservationCount += 1;
    }
  }

  const rng = createRng(seed);
  const particles = [];
  const baseLogit = logit(initialProbability);
  for (let i = 0; i < particleCount; i += 1) {
    const perturbation = initialLogitStd > 0 ? rng.nextNormal(0, initialLogitStd) : 0;
    particles.push(baseLogit + perturbation);
  }

  let weights = Array.from({ length: particleCount }, () => 1 / particleCount);
  const trajectory = [];
  const essSeries = [];
  let resampleCount = 0;

  for (let stepIndex = 0; stepIndex < normalizedObservations.length; stepIndex += 1) {
    const observation = normalizedObservations[stepIndex];

    for (let i = 0; i < particleCount; i += 1) {
      if (processStd > 0) {
        particles[i] += rng.nextNormal(0, processStd);
      }
    }

    const logWeights = [];
    const latentProbabilities = [];
    for (let i = 0; i < particleCount; i += 1) {
      const latentProbability = sigmoid(particles[i]);
      latentProbabilities.push(latentProbability);
      logWeights.push(gaussianLogLikelihood(observation.probability, latentProbability, observationStd));
    }

    weights = normalizeLogWeights(logWeights);
    const ess = effectiveSampleSize(weights);
    essSeries.push(ess);

    const estimate = weightedMean(latentProbabilities, weights);
    const intervalLower = weightedQuantile(latentProbabilities, weights, 0.05);
    const intervalUpper = weightedQuantile(latentProbabilities, weights, 0.95);

    let resampled = false;
    if (ess < resampleThreshold * particleCount) {
      const nextParticles = resampleSystematic(particles, weights, rng);
      for (let i = 0; i < particleCount; i += 1) {
        particles[i] = nextParticles[i];
      }
      weights = Array.from({ length: particleCount }, () => 1 / particleCount);
      resampled = true;
      resampleCount += 1;
    }

    trajectory.push({
      step: observation.step,
      timestamp: observation.timestamp,
      observedProbability: observation.probability,
      estimate,
      intervalLower,
      intervalUpper,
      effectiveSampleSize: ess,
      resampled,
    });
  }

  const finalPoint = trajectory.length
    ? trajectory[trajectory.length - 1]
    : {
      estimate: initialProbability,
      intervalLower: initialProbability,
      intervalUpper: initialProbability,
    };

  const minEss = essSeries.length ? Math.min(...essSeries) : particleCount;
  let maxEss = particleCount;
  if (essSeries.length) {
    maxEss = essSeries[0];
    for (let i = 1; i < essSeries.length; i += 1) {
      if (essSeries[i] > maxEss) {
        maxEss = essSeries[i];
      }
    }
  }
  const meanEss = essSeries.length ? essSeries.reduce((acc, value) => acc + value, 0) / essSeries.length : particleCount;

  return {
    schemaVersion: PARTICLE_FILTER_SCHEMA_VERSION,
    particleCount,
    seed,
    observationCount: normalizedObservations.length,
    skippedObservationCount,
    finalEstimate: finalPoint.estimate,
    finalInterval: {
      lower: finalPoint.intervalLower,
      upper: finalPoint.intervalUpper,
    },
    trajectory,
    diagnostics: {
      resampleCount,
      minEss,
      maxEss,
      meanEss,
      resampleThreshold,
      processStd,
      observationStd,
      initialProbability,
    },
  };
}

/**
 * Documented exports:
 * - normalizeObservation: canonical observation parser for PF workloads.
 * - runParticleFilter: seeded bootstrap PF with ESS/resampling diagnostics.
 */
module.exports = {
  PARTICLE_FILTER_SCHEMA_VERSION,
  normalizeObservation,
  runParticleFilter,
};
