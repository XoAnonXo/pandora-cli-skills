const fs = require('fs');
const path = require('path');
const { round } = require('../shared/utils.cjs');
const {
  clampProbability01,
  toProbabilityFromPercent,
  toPercent,
  logistic,
  logit,
  createSeededRandom,
  createNormalSampler,
  normalizeWeights,
  effectiveSampleSize,
  weightedMean,
  weightedQuantile,
  systematicResampleIndices,
  multinomialResampleIndices,
} = require('./common.cjs');

const SIMULATE_PARTICLE_FILTER_SCHEMA_VERSION = '1.0.0';

function readObservationSource(options) {
  if (options.readFromStdin) {
    return fs.readFileSync(0, 'utf8');
  }

  if (typeof options.inputFile === 'string' && options.inputFile) {
    const absolutePath = path.resolve(options.inputFile);
    return fs.readFileSync(absolutePath, 'utf8');
  }

  if (typeof options.observationsJson === 'string') {
    return options.observationsJson;
  }

  return '';
}

function parseObservationsPayload(rawText) {
  const text = String(rawText || '').trim();
  if (!text) {
    return [];
  }

  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (parsed && Array.isArray(parsed.observations)) {
        return parsed.observations;
      }
      throw new Error('JSON observation payload must be an array or an object with an observations array.');
    } catch (error) {
      // Fall through for NDJSON payloads where each line is an independent JSON object.
      if (!text.includes('\n')) {
        throw error;
      }
    }
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Invalid NDJSON at line ${index + 1}.`);
    }
  });
}

function parseObservationValue(value, explicitPercent = false) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return {
      ok: false,
      reason: 'non-numeric',
    };
  }

  if (explicitPercent || numeric > 1) {
    if (numeric < 0 || numeric > 100) {
      return {
        ok: false,
        reason: 'percent-out-of-range',
      };
    }

    return {
      ok: true,
      probability: clampProbability01(numeric / 100),
    };
  }

  if (numeric < 0 || numeric > 1) {
    return {
      ok: false,
      reason: 'probability-out-of-range',
    };
  }

  return {
    ok: true,
    probability: clampProbability01(numeric),
  };
}

function normalizeObservationRow(row, index) {
  const fallback = {
    index,
    timestamp: null,
    observedProbability: null,
    diagnostics: [],
  };

  if (row === null || row === undefined || row === '') {
    return {
      ...fallback,
      diagnostics: [{ code: 'MISSING_OBSERVATION', message: 'Observation is empty and was skipped.' }],
    };
  }

  if (typeof row === 'number' || typeof row === 'string') {
    const parsed = parseObservationValue(row, Number(row) > 1);
    if (!parsed.ok) {
      return {
        ...fallback,
        diagnostics: [{ code: 'INVALID_OBSERVATION', message: `Invalid scalar observation (${parsed.reason}).` }],
      };
    }
    return {
      ...fallback,
      observedProbability: parsed.probability,
    };
  }

  if (typeof row !== 'object' || Array.isArray(row)) {
    return {
      ...fallback,
      diagnostics: [{ code: 'INVALID_OBSERVATION', message: 'Observation must be number, string, or object.' }],
    };
  }

  const timestamp = row.timestamp || row.ts || row.time || null;

  const keys = [
    ['probability', false],
    ['prob', false],
    ['yesProbability', false],
    ['yesProb', false],
    ['yesPct', true],
    ['yes_pct', true],
    ['value', false],
  ];

  for (const [key, explicitPercent] of keys) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) {
      continue;
    }

    const parsed = parseObservationValue(row[key], explicitPercent);
    if (!parsed.ok) {
      return {
        ...fallback,
        timestamp,
        diagnostics: [{ code: 'INVALID_OBSERVATION', message: `Observation key ${key} is invalid (${parsed.reason}).` }],
      };
    }

    return {
      ...fallback,
      timestamp,
      observedProbability: parsed.probability,
    };
  }

  return {
    ...fallback,
    timestamp,
    diagnostics: [{ code: 'MISSING_OBSERVATION', message: 'No supported observation key found; prediction-only update used.' }],
  };
}

function gaussianWeight(observed, expected, sigma) {
  const residual = (observed - expected) / sigma;
  return Math.exp(-0.5 * residual * residual);
}

async function runSimulateParticleFilter(options = {}) {
  const rawSource = readObservationSource(options);
  const rawRows = parseObservationsPayload(rawSource);

  if (!rawRows.length) {
    throw new Error('simulate particle-filter requires at least one observation row.');
  }

  const steps = rawRows.map((row, index) => normalizeObservationRow(row, index));

  const seed = Number.isInteger(options.seed) ? options.seed : null;
  const particleCount = Number(options.particles);
  const processNoise = Number(options.processNoise);
  const observationNoise = Number(options.observationNoise);
  const initialProbability = toProbabilityFromPercent(options.initialYesPct);
  const initialSpread = Number(options.initialSpread);
  const credibleIntervalPct = Number(options.credibleIntervalPct);
  const resampleThreshold = Number(options.resampleThreshold);
  const resampleMethod = options.resampleMethod;
  const driftPerStep = Number(options.driftBps) / 10_000;

  const uniformSource = createSeededRandom(seed);
  const sampleNormal = createNormalSampler(uniformSource);

  let particles = new Array(particleCount);
  const initialLogit = logit(initialProbability);
  for (let i = 0; i < particleCount; i += 1) {
    particles[i] = initialLogit + initialSpread * sampleNormal();
  }

  let weights = new Array(particleCount).fill(1 / particleCount);
  const alpha = (1 - credibleIntervalPct / 100) / 2;
  const trajectory = [];
  const diagnostics = [];
  let resampleCount = 0;
  let minEss = Number.POSITIVE_INFINITY;
  let essAccumulator = 0;
  let observedCount = 0;

  for (const step of steps) {
    for (let i = 0; i < particleCount; i += 1) {
      particles[i] += driftPerStep + processNoise * sampleNormal();
    }

    const particleProbabilities = particles.map((value) => logistic(value));

    let stepWeights = weights;
    if (step.observedProbability !== null) {
      observedCount += 1;
      const unnormalized = new Array(particleCount);
      let maxWeight = 0;

      for (let i = 0; i < particleCount; i += 1) {
        const weight = stepWeights[i] * gaussianWeight(step.observedProbability, particleProbabilities[i], observationNoise);
        unnormalized[i] = weight;
        if (weight > maxWeight) {
          maxWeight = weight;
        }
      }

      if (maxWeight <= 0 || !Number.isFinite(maxWeight)) {
        diagnostics.push({
          code: 'WEIGHT_COLLAPSE',
          step: step.index,
          message: 'Particle weights collapsed to zero; weights were reset to uniform.',
        });
        stepWeights = new Array(particleCount).fill(1 / particleCount);
      } else {
        const normalized = normalizeWeights(unnormalized);
        if (!normalized.valid) {
          diagnostics.push({
            code: 'WEIGHT_NORMALIZATION_FALLBACK',
            step: step.index,
            message: 'Weight normalization failed numerically; weights were reset to uniform.',
          });
        }
        stepWeights = normalized.normalized;
      }
    }

    weights = stepWeights;

    for (const item of step.diagnostics) {
      diagnostics.push({
        ...item,
        step: step.index,
      });
    }

    const ess = effectiveSampleSize(weights);
    minEss = Math.min(minEss, ess);
    essAccumulator += ess;

    const filteredMeanProbability = weightedMean(particleProbabilities, weights);
    const lowerProbability = weightedQuantile(particleProbabilities, weights, alpha);
    const upperProbability = weightedQuantile(particleProbabilities, weights, 1 - alpha);

    const thresholdCount = resampleThreshold * particleCount;
    let resampled = false;
    if (ess < thresholdCount) {
      const indices =
        resampleMethod === 'multinomial'
          ? multinomialResampleIndices(weights, uniformSource)
          : systematicResampleIndices(weights, uniformSource);

      particles = indices.map((index) => particles[index]);
      weights = new Array(particleCount).fill(1 / particleCount);
      resampled = true;
      resampleCount += 1;
    }

    trajectory.push({
      step: step.index,
      timestamp: step.timestamp,
      observedYesPct: step.observedProbability === null ? null : toPercent(step.observedProbability),
      filteredYesPct: toPercent(filteredMeanProbability),
      credibleIntervalYesPct: {
        lower: toPercent(lowerProbability),
        upper: toPercent(upperProbability),
      },
      ess: round(ess, 6),
      resampled,
    });
  }

  const missingCount = steps.length - observedCount;
  if (missingCount > 0) {
    diagnostics.push({
      code: 'SPARSE_OBSERVATIONS',
      message: `Processed ${missingCount} sparse/missing observations using prediction-only updates.`,
      missingCount,
    });
  }

  if (resampleCount === 0) {
    diagnostics.push({
      code: 'RESAMPLING_NOT_TRIGGERED',
      message: 'ESS remained above threshold for all steps; no resampling performed.',
    });
  }

  const averageEss = trajectory.length ? essAccumulator / trajectory.length : 0;
  const finalStep = trajectory[trajectory.length - 1] || null;

  return {
    schemaVersion: SIMULATE_PARTICLE_FILTER_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    inputs: {
      particles: particleCount,
      processNoise: round(processNoise, 6),
      observationNoise: round(observationNoise, 6),
      driftBps: round(Number(options.driftBps), 6),
      initialYesPct: toPercent(initialProbability),
      initialSpread: round(initialSpread, 6),
      resampleThreshold: round(resampleThreshold, 6),
      resampleMethod,
      credibleIntervalPct,
      seed,
      steps: steps.length,
    },
    summary: {
      observedCount,
      missingCount,
      resamples: resampleCount,
      averageEss: round(averageEss, 6),
      minEss: round(Number.isFinite(minEss) ? minEss : 0, 6),
      final: finalStep,
    },
    trajectory,
    diagnostics,
  };
}

module.exports = {
  SIMULATE_PARTICLE_FILTER_SCHEMA_VERSION,
  runSimulateParticleFilter,
};
