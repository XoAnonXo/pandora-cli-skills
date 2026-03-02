const { createRng } = require('./rng.cjs');

const COPULA_SCHEMA_VERSION = '1.0.0';

function createQuantError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function erf(x) {
  // Abramowitz and Stegun approximation for numerical stability in CDF transforms.
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * abs);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-abs * abs);
  return sign * y;
}

function normalCdf(x) {
  return 0.5 * (1 + erf(Number(x) / Math.SQRT2));
}

function inverseNormalCdf(p) {
  const probability = Number(p);
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) {
    throw createQuantError('QUANT_INVALID_INPUT', 'p must be between 0 and 1 for inverseNormalCdf.', {
      p,
    });
  }

  const a = [
    -3.969683028665376e+01,
    2.209460984245205e+02,
    -2.759285104469687e+02,
    1.38357751867269e+02,
    -3.066479806614716e+01,
    2.506628277459239e+00,
  ];
  const b = [
    -5.447609879822406e+01,
    1.615858368580409e+02,
    -1.556989798598866e+02,
    6.680131188771972e+01,
    -1.328068155288572e+01,
  ];
  const c = [
    -7.784894002430293e-03,
    -3.223964580411365e-01,
    -2.400758277161838e+00,
    -2.549732539343734e+00,
    4.374664141464968e+00,
    2.938163982698783e+00,
  ];
  const d = [
    7.784695709041462e-03,
    3.224671290700398e-01,
    2.445134137142996e+00,
    3.754408661907416e+00,
  ];

  const plow = 0.02425;
  const phigh = 1 - plow;
  let q;
  let r;

  if (probability < plow) {
    q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  if (probability > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  q = probability - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function ensureSquareMatrix(matrix, name = 'matrix') {
  if (!Array.isArray(matrix) || matrix.length === 0) {
    throw createQuantError('QUANT_INVALID_INPUT', `${name} must be a non-empty matrix.`, {
      [name]: matrix,
    });
  }

  const dimension = matrix.length;
  for (let row = 0; row < matrix.length; row += 1) {
    if (!Array.isArray(matrix[row]) || matrix[row].length !== dimension) {
      throw createQuantError('QUANT_INVALID_INPUT', `${name} must be square.`, {
        row,
        rowLength: Array.isArray(matrix[row]) ? matrix[row].length : null,
        dimension,
      });
    }
    for (let col = 0; col < matrix[row].length; col += 1) {
      const value = Number(matrix[row][col]);
      if (!Number.isFinite(value)) {
        throw createQuantError('QUANT_INVALID_INPUT', `${name} must contain finite numeric values.`, {
          row,
          col,
          value: matrix[row][col],
        });
      }
    }
  }

  return dimension;
}

function normalizeCorrelationMatrix(correlation, dimension = 2) {
  if (Number.isFinite(Number(correlation))) {
    const rho = clamp(Number(correlation), -0.999, 0.999);
    if (!Number.isInteger(dimension) || dimension < 2) {
      throw createQuantError('QUANT_INVALID_INPUT', 'dimension must be an integer >= 2.', {
        dimension,
      });
    }
    const matrix = [];
    for (let row = 0; row < dimension; row += 1) {
      const values = [];
      for (let col = 0; col < dimension; col += 1) {
        values.push(row === col ? 1 : rho);
      }
      matrix.push(values);
    }
    return matrix;
  }

  const matrix = Array.isArray(correlation) ? correlation.map((row) => row.slice()) : null;
  const resolvedDimension = ensureSquareMatrix(matrix, 'correlation');

  for (let row = 0; row < resolvedDimension; row += 1) {
    for (let col = 0; col < resolvedDimension; col += 1) {
      if (row === col && Math.abs(matrix[row][col] - 1) > 1e-8) {
        throw createQuantError('QUANT_INVALID_INPUT', 'Correlation matrix diagonal must be 1.', {
          row,
          col,
          value: matrix[row][col],
        });
      }
      if (row !== col && Math.abs(matrix[row][col] - matrix[col][row]) > 1e-8) {
        throw createQuantError('QUANT_INVALID_INPUT', 'Correlation matrix must be symmetric.', {
          row,
          col,
          left: matrix[row][col],
          right: matrix[col][row],
        });
      }
    }
  }
  return matrix;
}

function cholesky(matrix) {
  const dimension = ensureSquareMatrix(matrix, 'matrix');
  const lower = Array.from({ length: dimension }, () => Array(dimension).fill(0));

  for (let i = 0; i < dimension; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = 0;
      for (let k = 0; k < j; k += 1) {
        sum += lower[i][k] * lower[j][k];
      }

      if (i === j) {
        const diagonal = Number(matrix[i][i]) - sum;
        if (diagonal <= 0) {
          throw createQuantError('QUANT_INVALID_INPUT', 'Correlation matrix must be positive definite.', {
            row: i,
            diagonal,
          });
        }
        lower[i][j] = Math.sqrt(diagonal);
      } else {
        lower[i][j] = (Number(matrix[i][j]) - sum) / lower[j][j];
      }
    }
  }

  return lower;
}

function multiplyLowerTriangular(lower, vector) {
  const dimension = lower.length;
  const out = Array(dimension).fill(0);
  for (let row = 0; row < dimension; row += 1) {
    let total = 0;
    for (let col = 0; col <= row; col += 1) {
      total += lower[row][col] * vector[col];
    }
    out[row] = total;
  }
  return out;
}

function sampleChiSquare(df, rng) {
  if (!Number.isInteger(df) || df <= 0) {
    throw createQuantError('QUANT_INVALID_INPUT', 'degreesOfFreedom must be a positive integer for t-copula sampling.', {
      degreesOfFreedom: df,
    });
  }
  let total = 0;
  for (let i = 0; i < df; i += 1) {
    const z = rng.nextNormal();
    total += z * z;
  }
  return total;
}

function toPseudoObservations(samples) {
  if (!Array.isArray(samples) || samples.length === 0 || !Array.isArray(samples[0])) {
    throw createQuantError('QUANT_INVALID_INPUT', 'samples must be a non-empty matrix.', {
      samples,
    });
  }

  const rowCount = samples.length;
  const dimension = samples[0].length;
  const uniforms = Array.from({ length: rowCount }, () => Array(dimension).fill(0));

  for (let column = 0; column < dimension; column += 1) {
    const sortable = [];
    for (let row = 0; row < rowCount; row += 1) {
      sortable.push({ row, value: Number(samples[row][column]) });
    }
    sortable.sort((left, right) => left.value - right.value);

    for (let rankIndex = 0; rankIndex < sortable.length; rankIndex += 1) {
      const row = sortable[rankIndex].row;
      uniforms[row][column] = (rankIndex + 0.5) / rowCount;
    }
  }

  return uniforms;
}

function sampleGaussianCopula(options = {}) {
  const sampleCount = options.sampleCount === undefined ? 1000 : Number(options.sampleCount);
  const seed = options.seed === undefined ? 1 : options.seed;
  const correlation = normalizeCorrelationMatrix(options.correlation === undefined ? 0 : options.correlation, options.dimension || 2);

  if (!Number.isInteger(sampleCount) || sampleCount <= 0) {
    throw createQuantError('QUANT_INVALID_INPUT', 'sampleCount must be a positive integer.', {
      sampleCount: options.sampleCount,
    });
  }

  const lower = cholesky(correlation);
  const dimension = correlation.length;
  const rng = createRng(seed);
  const samples = [];

  for (let i = 0; i < sampleCount; i += 1) {
    const base = [];
    for (let d = 0; d < dimension; d += 1) {
      base.push(rng.nextNormal());
    }
    const correlated = multiplyLowerTriangular(lower, base);
    samples.push(correlated.map((value) => clamp(normalCdf(value), 1e-12, 1 - 1e-12)));
  }

  return {
    schemaVersion: COPULA_SCHEMA_VERSION,
    family: 'gaussian',
    dimension,
    sampleCount,
    correlation,
    samples,
  };
}

function sampleStudentTCopula(options = {}) {
  const sampleCount = options.sampleCount === undefined ? 1000 : Number(options.sampleCount);
  const seed = options.seed === undefined ? 1 : options.seed;
  const degreesOfFreedom = options.degreesOfFreedom === undefined ? 4 : Number(options.degreesOfFreedom);
  const correlation = normalizeCorrelationMatrix(options.correlation === undefined ? 0 : options.correlation, options.dimension || 2);

  if (!Number.isInteger(sampleCount) || sampleCount <= 0) {
    throw createQuantError('QUANT_INVALID_INPUT', 'sampleCount must be a positive integer.', {
      sampleCount: options.sampleCount,
    });
  }
  if (!Number.isInteger(degreesOfFreedom) || degreesOfFreedom <= 1) {
    throw createQuantError('QUANT_INVALID_INPUT', 'degreesOfFreedom must be an integer greater than 1.', {
      degreesOfFreedom: options.degreesOfFreedom,
    });
  }

  const lower = cholesky(correlation);
  const dimension = correlation.length;
  const rng = createRng(seed);
  const tSamples = [];

  for (let i = 0; i < sampleCount; i += 1) {
    const base = [];
    for (let d = 0; d < dimension; d += 1) {
      base.push(rng.nextNormal());
    }
    const correlated = multiplyLowerTriangular(lower, base);
    const chiSquare = sampleChiSquare(degreesOfFreedom, rng);
    const scale = Math.sqrt(chiSquare / degreesOfFreedom);
    tSamples.push(correlated.map((value) => value / scale));
  }

  const samples = toPseudoObservations(tSamples);
  return {
    schemaVersion: COPULA_SCHEMA_VERSION,
    family: 't',
    dimension,
    sampleCount,
    degreesOfFreedom,
    correlation,
    samples,
  };
}

function pairwiseTailDependence(uniformSamples, options = {}) {
  if (!Array.isArray(uniformSamples) || uniformSamples.length === 0 || !Array.isArray(uniformSamples[0])) {
    throw createQuantError('QUANT_INVALID_INPUT', 'uniformSamples must be a non-empty matrix.', {
      uniformSamples,
    });
  }

  const threshold = options.threshold === undefined ? 0.95 : Number(options.threshold);
  if (!Number.isFinite(threshold) || threshold <= 0.5 || threshold >= 1) {
    throw createQuantError('QUANT_INVALID_INPUT', 'threshold must be between 0.5 and 1.', {
      threshold: options.threshold,
    });
  }

  const dimension = uniformSamples[0].length;
  const lowerThreshold = 1 - threshold;
  const pairs = [];

  for (let left = 0; left < dimension; left += 1) {
    for (let right = left + 1; right < dimension; right += 1) {
      let upperNumerator = 0;
      let upperDenominator = 0;
      let lowerNumerator = 0;
      let lowerDenominator = 0;

      for (let i = 0; i < uniformSamples.length; i += 1) {
        const uLeft = Number(uniformSamples[i][left]);
        const uRight = Number(uniformSamples[i][right]);

        if (uLeft >= threshold) {
          upperDenominator += 1;
          if (uRight >= threshold) upperNumerator += 1;
        }

        if (uLeft <= lowerThreshold) {
          lowerDenominator += 1;
          if (uRight <= lowerThreshold) lowerNumerator += 1;
        }
      }

      pairs.push({
        left,
        right,
        upper: upperDenominator > 0 ? upperNumerator / upperDenominator : 0,
        lower: lowerDenominator > 0 ? lowerNumerator / lowerDenominator : 0,
      });
    }
  }

  return {
    threshold,
    pairs,
  };
}

/**
 * Documented exports:
 * - sampleGaussianCopula: seeded Gaussian copula sampler.
 * - sampleStudentTCopula: seeded t-copula sampler with rank-based uniforms.
 * - toPseudoObservations: convert raw samples into uniform marginals.
 * - pairwiseTailDependence: upper/lower tail dependence diagnostics.
 * - inverseNormalCdf/normalCdf: reusable transforms for model commands.
 */
module.exports = {
  COPULA_SCHEMA_VERSION,
  normalCdf,
  inverseNormalCdf,
  toPseudoObservations,
  sampleGaussianCopula,
  sampleStudentTCopula,
  pairwiseTailDependence,
};
