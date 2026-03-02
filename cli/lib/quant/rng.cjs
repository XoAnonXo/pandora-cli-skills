const UINT32_MAX_PLUS_ONE = 0x100000000;
const { createQuantError } = require('./errors.cjs');

function hashStringSeed(seed) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function normalizeSeed(seed) {
  if (seed === undefined || seed === null || seed === '') {
    throw createQuantError('QUANT_INVALID_SEED', 'A deterministic numeric or string seed is required.', {
      seed,
    });
  }

  if (typeof seed === 'number') {
    if (!Number.isFinite(seed)) {
      throw createQuantError('QUANT_INVALID_SEED', 'Seed must be a finite number.', { seed });
    }
    return (Math.trunc(seed) >>> 0) || 1;
  }

  if (typeof seed === 'bigint') {
    const masked = Number(seed & BigInt(0xffffffff));
    return (masked >>> 0) || 1;
  }

  if (typeof seed === 'string') {
    const trimmed = seed.trim();
    if (!trimmed) {
      throw createQuantError('QUANT_INVALID_SEED', 'Seed string cannot be empty.', { seed });
    }
    return hashStringSeed(trimmed) || 1;
  }

  throw createQuantError('QUANT_INVALID_SEED', 'Seed must be a number, bigint, or string.', {
    seedType: typeof seed,
  });
}

function validateFiniteNumber(value, name) {
  if (!Number.isFinite(value)) {
    throw createQuantError('QUANT_INVALID_INPUT', `${name} must be a finite number.`, {
      [name]: value,
    });
  }
}

function createRng(seed) {
  let state = normalizeSeed(seed);
  let spareNormal = null;

  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_MAX_PLUS_ONE;
  }

  function nextFloat(min = 0, max = 1) {
    validateFiniteNumber(min, 'min');
    validateFiniteNumber(max, 'max');
    if (max <= min) {
      throw createQuantError('QUANT_INVALID_RANGE', 'max must be greater than min.', { min, max });
    }
    return min + (max - min) * next();
  }

  function nextInt(min, maxExclusive) {
    validateFiniteNumber(min, 'min');
    validateFiniteNumber(maxExclusive, 'maxExclusive');
    if (!Number.isInteger(min) || !Number.isInteger(maxExclusive)) {
      throw createQuantError('QUANT_INVALID_RANGE', 'nextInt requires integer bounds.', { min, maxExclusive });
    }
    if (maxExclusive <= min) {
      throw createQuantError('QUANT_INVALID_RANGE', 'maxExclusive must be greater than min.', { min, maxExclusive });
    }
    return min + Math.floor(next() * (maxExclusive - min));
  }

  function nextNormal(mean = 0, stdDev = 1) {
    validateFiniteNumber(mean, 'mean');
    validateFiniteNumber(stdDev, 'stdDev');
    if (stdDev <= 0) {
      throw createQuantError('QUANT_INVALID_RANGE', 'stdDev must be greater than 0.', { stdDev });
    }

    if (spareNormal !== null) {
      const cached = spareNormal;
      spareNormal = null;
      return mean + cached * stdDev;
    }

    let u1 = 0;
    let u2 = 0;
    while (u1 <= Number.EPSILON) {
      u1 = next();
    }
    u2 = next();

    const radius = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    const z0 = radius * Math.cos(theta);
    const z1 = radius * Math.sin(theta);
    spareNormal = z1;
    return mean + z0 * stdDev;
  }

  function choice(items) {
    if (!Array.isArray(items) || items.length === 0) {
      throw createQuantError('QUANT_INVALID_INPUT', 'choice requires a non-empty array.', {
        itemCount: Array.isArray(items) ? items.length : null,
      });
    }
    return items[nextInt(0, items.length)];
  }

  function shuffleInPlace(items) {
    if (!Array.isArray(items)) {
      throw createQuantError('QUANT_INVALID_INPUT', 'shuffleInPlace requires an array.', {
        itemType: typeof items,
      });
    }
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = nextInt(0, i + 1);
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return items;
  }

  function sampleWithoutReplacement(items, count) {
    if (!Array.isArray(items)) {
      throw createQuantError('QUANT_INVALID_INPUT', 'sampleWithoutReplacement requires an array.', {
        itemType: typeof items,
      });
    }
    if (!Number.isInteger(count) || count < 0 || count > items.length) {
      throw createQuantError('QUANT_INVALID_INPUT', 'count must be an integer between 0 and array length.', {
        count,
        itemCount: items.length,
      });
    }
    const cloned = items.slice();
    shuffleInPlace(cloned);
    return cloned.slice(0, count);
  }

  function snapshot() {
    return {
      state,
      spareNormal,
    };
  }

  function clone() {
    const cloned = createRng(state);
    const current = snapshot();
    if (current.spareNormal !== null) {
      const originalNextNormal = cloned.nextNormal;
      let remainingSpare = current.spareNormal;
      cloned.nextNormal = function patchedNextNormal(mean = 0, stdDev = 1) {
        if (remainingSpare !== null) {
          validateFiniteNumber(mean, 'mean');
          validateFiniteNumber(stdDev, 'stdDev');
          if (stdDev <= 0) {
            throw createQuantError('QUANT_INVALID_RANGE', 'stdDev must be greater than 0.', { stdDev });
          }
          const cached = remainingSpare;
          remainingSpare = null;
          return mean + cached * stdDev;
        }
        return originalNextNormal(mean, stdDev);
      };
    }
    return cloned;
  }

  return {
    next,
    nextFloat,
    nextInt,
    nextNormal,
    choice,
    shuffleInPlace,
    sampleWithoutReplacement,
    snapshot,
    clone,
  };
}

/**
 * Documented exports:
 * - createRng(seed): deterministic pseudo-random generator.
 * - normalizeSeed(seed): seed normalization helper used by quant modules.
 */
module.exports = {
  createRng,
  normalizeSeed,
};
