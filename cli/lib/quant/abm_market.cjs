const { createQuantError } = require('./errors.cjs');

const ABM_SCHEMA_VERSION = '1.0.0';
const MAX_ABM_AGENTS = 1_000;
const MAX_ABM_STEPS = 10_000;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createRng(seed) {
  let state = Number.isInteger(seed) ? seed >>> 0 : 1;

  function next() {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  let spare = null;
  function nextNormal(meanValue = 0, stdDev = 1) {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return meanValue + value * stdDev;
    }

    let u1 = next();
    let u2 = next();
    if (u1 <= Number.EPSILON) u1 = Number.EPSILON;
    if (u2 <= Number.EPSILON) u2 = Number.EPSILON;

    const radius = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    const z0 = radius * Math.cos(theta);
    const z1 = radius * Math.sin(theta);
    spare = z1;
    return meanValue + z0 * stdDev;
  }

  return {
    next,
    nextNormal,
  };
}

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total / values.length;
}

function standardDeviation(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const average = mean(values);
  let variance = 0;
  for (const value of values) {
    const delta = value - average;
    variance += delta * delta;
  }
  return Math.sqrt(variance / values.length);
}

function validatePositiveInteger(value, name) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw createQuantError('QUANT_INVALID_INPUT', `${name} must be a positive integer.`, {
      [name]: value,
    });
  }
  return numeric;
}

function validateBoundedPositiveInteger(value, name, maxValue) {
  const numeric = validatePositiveInteger(value, name);
  if (numeric > maxValue) {
    throw createQuantError('QUANT_INVALID_INPUT', `${name} must be <= ${maxValue}.`, {
      [name]: value,
      max: maxValue,
    });
  }
  return numeric;
}

function validateFinite(value, name) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw createQuantError('QUANT_INVALID_INPUT', `${name} must be a finite number.`, {
      [name]: value,
    });
  }
  return numeric;
}

function parseOptionalPositiveInteger(value, name, maxValue = null) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (Number.isFinite(Number(maxValue))) {
    return validateBoundedPositiveInteger(value, name, maxValue);
  }
  return validatePositiveInteger(value, name);
}

function parseOptionalInteger(value, name) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    throw createQuantError('QUANT_INVALID_INPUT', `${name} must be an integer.`, {
      [name]: value,
    });
  }
  return numeric;
}

function normalizeAbmOptions(options = {}) {
  const normalized = {};
  normalized.n_informed = parseOptionalPositiveInteger(
    options.n_informed !== undefined ? options.n_informed : options.nInformed,
    'n_informed',
    MAX_ABM_AGENTS,
  );
  normalized.n_noise = parseOptionalPositiveInteger(
    options.n_noise !== undefined ? options.n_noise : options.nNoise,
    'n_noise',
    MAX_ABM_AGENTS,
  );
  normalized.n_mm = parseOptionalPositiveInteger(
    options.n_mm !== undefined ? options.n_mm : options.nMm !== undefined ? options.nMm : options.nMarketMakers,
    'n_mm',
    MAX_ABM_AGENTS,
  );
  normalized.n_steps = parseOptionalPositiveInteger(
    options.n_steps !== undefined ? options.n_steps : options.nSteps,
    'n_steps',
    MAX_ABM_STEPS,
  );
  normalized.seed = parseOptionalInteger(options.seed, 'seed');
  return normalized;
}

function simulateAbmMarket(options = {}) {
  const steps = validateBoundedPositiveInteger(options.steps === undefined ? 100 : options.steps, 'steps', MAX_ABM_STEPS);
  const nInformed = validateBoundedPositiveInteger(
    options.nInformed === undefined ? 20 : options.nInformed,
    'nInformed',
    MAX_ABM_AGENTS,
  );
  const nNoise = validateBoundedPositiveInteger(
    options.nNoise === undefined ? 80 : options.nNoise,
    'nNoise',
    MAX_ABM_AGENTS,
  );
  const nMarketMakers = validateBoundedPositiveInteger(
    options.nMarketMakers === undefined ? 10 : options.nMarketMakers,
    'nMarketMakers',
    MAX_ABM_AGENTS,
  );

  const seed = options.seed === undefined ? 1 : options.seed;
  const initialPrice = clamp(validateFinite(options.initialPrice === undefined ? 0.5 : options.initialPrice, 'initialPrice'), 0.001, 0.999);
  const fundamentalPrice = clamp(
    validateFinite(options.fundamentalPrice === undefined ? initialPrice : options.fundamentalPrice, 'fundamentalPrice'),
    0.001,
    0.999,
  );
  const impact = Math.max(0, validateFinite(options.impact === undefined ? 0.003 : options.impact, 'impact'));
  const meanReversion = Math.max(0, validateFinite(options.meanReversion === undefined ? 0.06 : options.meanReversion, 'meanReversion'));
  const noiseScale = Math.max(0, validateFinite(options.noiseScale === undefined ? 0.6 : options.noiseScale, 'noiseScale'));
  const mmInventorySensitivity = Math.max(
    0,
    validateFinite(options.mmInventorySensitivity === undefined ? 0.03 : options.mmInventorySensitivity, 'mmInventorySensitivity'),
  );
  const spreadBase = Math.max(0, validateFinite(options.spreadBase === undefined ? 0.01 : options.spreadBase, 'spreadBase'));

  const rng = createRng(seed);

  let price = initialPrice;
  let mmInventory = 0;
  let pnlInformed = 0;
  let pnlNoise = 0;
  let pnlMarketMakers = 0;
  let totalVolume = 0;

  const trajectory = [];
  const returns = [];
  const spreads = [];

  for (let step = 1; step <= steps; step += 1) {
    const priorPrice = price;

    const mispricing = fundamentalPrice - priorPrice;
    const informedIntensity = clamp(Math.abs(mispricing) * 6, 0, 1);
    const informedDirection = mispricing >= 0 ? 1 : -1;
    const informedFlow = nInformed * informedDirection * informedIntensity * (0.5 + 0.5 * rng.next());

    const noiseFlow = rng.nextNormal(0, Math.sqrt(nNoise) * noiseScale);

    const mmFlow = -mmInventory * mmInventorySensitivity;

    const netFlow = informedFlow + noiseFlow + mmFlow;
    const priceImpact = netFlow * impact;
    const reversion = (fundamentalPrice - priorPrice) * meanReversion;

    price = clamp(priorPrice + priceImpact + reversion, 0.001, 0.999);

    const spread = spreadBase
      + Math.abs(netFlow) * impact * 0.5
      + (nMarketMakers > 0 ? 0.004 / nMarketMakers : 0.02);

    const stepReturn = price - priorPrice;
    returns.push(stepReturn);
    spreads.push(spread);

    const flowWithoutMm = informedFlow + noiseFlow;
    mmInventory = clamp(mmInventory - flowWithoutMm / Math.max(nMarketMakers, 1), -1_000, 1_000);

    const stepVolume = Math.abs(informedFlow) + Math.abs(noiseFlow) + Math.abs(mmFlow);
    totalVolume += stepVolume;

    pnlInformed += informedFlow * stepReturn;
    pnlNoise += noiseFlow * stepReturn - Math.abs(noiseFlow) * spread * 0.5;
    pnlMarketMakers += Math.abs(flowWithoutMm) * spread * 0.5 - Math.abs(mmInventory) * impact * 0.01;

    trajectory.push({
      step,
      price,
      spread,
      netFlow,
      informedFlow,
      noiseFlow,
      marketMakerFlow: mmFlow,
      volume: stepVolume,
      marketMakerInventory: mmInventory,
    });
  }

  return {
    schemaVersion: ABM_SCHEMA_VERSION,
    configuration: {
      steps,
      seed,
      nInformed,
      nNoise,
      nMarketMakers,
      initialPrice,
      fundamentalPrice,
      impact,
      meanReversion,
      noiseScale,
      mmInventorySensitivity,
      spreadBase,
    },
    trajectory,
    summary: {
      finalPrice: price,
      convergenceError: Math.abs(price - fundamentalPrice),
      totalVolume,
      averageSpread: spreads.length ? mean(spreads) : 0,
      realizedVolatility: returns.length ? standardDeviation(returns) : 0,
      pnlByAgentType: {
        informed: pnlInformed,
        noise: pnlNoise,
        marketMakers: pnlMarketMakers,
      },
    },
  };
}

function runAbmMarket(options = {}) {
  const normalized = normalizeAbmOptions(options);
  const base = simulateAbmMarket({
    seed: normalized.seed !== undefined ? normalized.seed : options.seed,
    steps: normalized.n_steps !== undefined ? normalized.n_steps : options.steps,
    nInformed: normalized.n_informed !== undefined ? normalized.n_informed : options.nInformed,
    nNoise: normalized.n_noise !== undefined ? normalized.n_noise : options.nNoise,
    nMarketMakers: normalized.n_mm !== undefined ? normalized.n_mm : options.nMarketMakers,
    initialPrice: options.initialPrice,
    fundamentalPrice: options.fundamentalPrice,
    impact: options.impact,
    meanReversion: options.meanReversion,
    noiseScale: options.noiseScale,
    mmInventorySensitivity: options.mmInventorySensitivity,
    spreadBase: options.spreadBase,
  });

  const params = base.configuration || {};
  const trajectory = Array.isArray(base.trajectory) ? base.trajectory : [];
  const summary = base.summary || {};
  const flowTotals = trajectory.reduce(
    (acc, point) => {
      acc.informed += Math.abs(Number(point.informedFlow) || 0);
      acc.noise += Math.abs(Number(point.noiseFlow) || 0);
      acc.market_maker += Math.abs(Number(point.marketMakerFlow) || 0);
      return acc;
    },
    { informed: 0, noise: 0, market_maker: 0 },
  );

  const spreadTrajectory = trajectory.map((point) => ({
    step: point.step,
    spreadBps: (Number(point.spread) || 0) * 10_000,
    midPrice: point.price,
  }));

  const pnlByAgentType = {
    informed: Number(summary.pnlByAgentType && summary.pnlByAgentType.informed) || 0,
    noise: Number(summary.pnlByAgentType && summary.pnlByAgentType.noise) || 0,
    market_maker: Number(summary.pnlByAgentType && summary.pnlByAgentType.marketMakers) || 0,
  };
  pnlByAgentType.total = pnlByAgentType.informed + pnlByAgentType.noise + pnlByAgentType.market_maker;

  const nInformed = Number(params.nInformed) || 0;
  const nNoise = Number(params.nNoise) || 0;
  const nMm = Number(params.nMarketMakers) || 0;
  const nSteps = Number(params.steps) || 0;

  return {
    schemaVersion: ABM_SCHEMA_VERSION,
    parameters: {
      n_informed: nInformed,
      n_noise: nNoise,
      n_mm: nMm,
      n_steps: nSteps,
      seed: params.seed,
    },
    convergenceError: Number(summary.convergenceError) || 0,
    spreadTrajectory,
    volume: {
      total: Number(summary.totalVolume) || 0,
      averagePerStep: nSteps > 0 ? (Number(summary.totalVolume) || 0) / nSteps : 0,
      byAgentType: flowTotals,
    },
    pnlByAgentType,
    finalState: {
      midPrice: Number(summary.finalPrice) || 0,
      fundamentalValue: Number(params.fundamentalPrice) || 0,
      distanceToFundamental: Number(summary.convergenceError) || 0,
      averageSpreadBps: (Number(summary.averageSpread) || 0) * 10_000,
    },
    runtimeBounds: {
      complexity: 'O(n_steps * (n_informed + n_noise))',
      estimatedAgentDecisions: nSteps * (nInformed + nNoise),
      estimatedWorkUnits: nSteps * (nInformed + nNoise + nMm),
      notes: 'Deterministic seeded simulation under simplified ABM assumptions.',
    },
  };
}

/**
 * Documented exports:
 * - normalizeAbmOptions: canonicalize snake_case and camelCase simulate.agents inputs.
 * - runAbmMarket: adapter payload for simulate.agents command contract.
 * - simulateAbmMarket: seeded simplified market ABM with trajectory + summary diagnostics.
 */
module.exports = {
  ABM_SCHEMA_VERSION,
  normalizeAbmOptions,
  runAbmMarket,
  simulateAbmMarket,
};
