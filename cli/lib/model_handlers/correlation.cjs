const { assertMcpWorkspacePath } = require('../shared/mcp_path_guard.cjs');
const { buildModelId, saveModelArtifact } = require('../shared/model_artifact.cjs');

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleVariance(values, meanValue) {
  if (!Array.isArray(values) || values.length < 2) return 0;
  const center = Number.isFinite(meanValue) ? meanValue : average(values);
  const sq = values.reduce((sum, value) => {
    const delta = value - center;
    return sum + delta * delta;
  }, 0);
  return sq / (values.length - 1);
}

function sampleStd(values, meanValue) {
  return Math.sqrt(Math.max(sampleVariance(values, meanValue), 0));
}

function clamp(value, minValue, maxValue) {
  return Math.min(maxValue, Math.max(minValue, value));
}

function pearsonCorrelation(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length < 2) {
    return 0;
  }
  const meanLeft = average(left);
  const meanRight = average(right);
  const stdLeft = sampleStd(left, meanLeft);
  const stdRight = sampleStd(right, meanRight);
  if (stdLeft === 0 || stdRight === 0) {
    return 0;
  }
  let covariance = 0;
  for (let i = 0; i < left.length; i += 1) {
    covariance += (left[i] - meanLeft) * (right[i] - meanRight);
  }
  covariance /= left.length - 1;
  return clamp(covariance / (stdLeft * stdRight), -0.9999, 0.9999);
}

function quantile(values, probability) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const p = clamp(probability, 0, 1);
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  const weight = index - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

function kendallTau(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length < 2) {
    return 0;
  }
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < left.length; i += 1) {
    for (let j = i + 1; j < left.length; j += 1) {
      const dx = left[i] - left[j];
      const dy = right[i] - right[j];
      const prod = dx * dy;
      if (prod > 0) concordant += 1;
      else if (prod < 0) discordant += 1;
    }
  }
  const total = concordant + discordant;
  if (!total) return 0;
  return (concordant - discordant) / total;
}

function erfApprox(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
  return sign * y;
}

function normalCdf(value) {
  return 0.5 * (1 + erfApprox(value / Math.sqrt(2)));
}

function approxStudentTCdf(value, degreesOfFreedom) {
  // Cheap approximation: rescale to normal domain.
  const nu = Math.max(3, Number.isFinite(degreesOfFreedom) ? degreesOfFreedom : 6);
  const adjusted = value * Math.sqrt((nu - 2) / nu);
  return normalCdf(adjusted);
}

function tCopulaTailDependence(rho, degreesOfFreedom) {
  const nu = Math.max(3, Number.isFinite(degreesOfFreedom) ? degreesOfFreedom : 6);
  const boundedRho = clamp(rho, -0.9999, 0.9999);
  const ratio = ((nu + 1) * (1 - boundedRho)) / (1 + boundedRho);
  const x = -Math.sqrt(Math.max(ratio, 0));
  const lambda = 2 * approxStudentTCdf(x, nu + 1);
  return clamp(lambda, 0, 1);
}

function estimateCopulaTailDependence(family, rho, tau, degreesOfFreedom) {
  if (family === 't') {
    const lambda = tCopulaTailDependence(rho, degreesOfFreedom);
    return {
      lower: lambda,
      upper: lambda,
    };
  }

  if (family === 'gaussian') {
    return {
      lower: 0,
      upper: 0,
    };
  }

  if (family === 'clayton') {
    const boundedTau = clamp(tau, 0, 0.99);
    if (boundedTau <= 0) {
      return { lower: 0, upper: 0 };
    }
    const theta = (2 * boundedTau) / (1 - boundedTau);
    const lower = theta > 0 ? Math.pow(2, -1 / theta) : 0;
    return {
      lower: clamp(lower, 0, 1),
      upper: 0,
    };
  }

  if (family === 'gumbel') {
    const boundedTau = clamp(tau, 0, 0.99);
    const theta = 1 / Math.max(1e-6, 1 - boundedTau);
    const upper = theta > 1 ? 2 - Math.pow(2, 1 / theta) : 0;
    return {
      lower: 0,
      upper: clamp(upper, 0, 1),
    };
  }

  return {
    lower: 0,
    upper: 0,
  };
}

function empiricalTailMetrics(left, right, alpha) {
  const n = left.length;
  const qLeftLow = quantile(left, alpha);
  const qRightLow = quantile(right, alpha);
  const qLeftHigh = quantile(left, 1 - alpha);
  const qRightHigh = quantile(right, 1 - alpha);

  let lowerJointCount = 0;
  let upperJointCount = 0;
  for (let i = 0; i < n; i += 1) {
    if (left[i] <= qLeftLow && right[i] <= qRightLow) {
      lowerJointCount += 1;
    }
    if (left[i] >= qLeftHigh && right[i] >= qRightHigh) {
      upperJointCount += 1;
    }
  }

  const lowerJointProbability = n > 0 ? lowerJointCount / n : 0;
  const upperJointProbability = n > 0 ? upperJointCount / n : 0;
  const lowerTailDependence = alpha > 0 ? clamp(lowerJointProbability / alpha, 0, 1) : 0;
  const upperTailDependence = alpha > 0 ? clamp(upperJointProbability / alpha, 0, 1) : 0;
  return {
    lowerJointCount,
    upperJointCount,
    lowerJointProbability,
    upperJointProbability,
    lowerTailDependence,
    upperTailDependence,
  };
}

function assertMcpWritablePathAllowed(rawPath, CliError) {
  assertMcpWorkspacePath(rawPath, {
    flagName: '--save-model',
    errorFactory: (code, message, details) => new CliError(code, message, details),
    message: '--save-model must point to a file within the current workspace when running via MCP.',
  });
}

function runCorrelationAnalysis(options) {
  const labels = options.series.map((item) => item.id);
  const rows = options.series.map((item) => item.values);
  const sampleSize = rows[0].length;
  const warnings = [];

  if (sampleSize < 50) {
    warnings.push('Small sample size (< 50) can distort tail dependence and copula comparisons.');
  }
  if (options.copula === 't' && sampleSize < 30) {
    warnings.push('t-copula degrees-of-freedom estimates are sensitive on short histories.');
  }

  const matrix = labels.map((_, i) =>
    labels.map((__, j) => {
      if (i === j) return 1;
      return pearsonCorrelation(rows[i], rows[j]);
    }),
  );

  const pairwise = [];
  let absCorrelationSum = 0;
  let pairCount = 0;
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      const rho = matrix[i][j];
      const tau = kendallTau(rows[i], rows[j]);
      absCorrelationSum += Math.abs(rho);
      pairCount += 1;

      const empirical = empiricalTailMetrics(rows[i], rows[j], options.tailAlpha);
      pairwise.push({
        left: labels[i],
        right: labels[j],
        pearson: rho,
        kendallTau: tau,
        empirical,
      });
    }
  }

  const avgAbsCorrelation = pairCount > 0 ? absCorrelationSum / pairCount : 0;
  const inferredDf = Math.max(4, Math.min(30, Math.round(8 + (1 - avgAbsCorrelation) * 12)));
  const degreesOfFreedom = options.copula === 't' ? options.degreesOfFreedom || inferredDf : null;

  const modeledPairs = pairwise.map((item) => {
    const modeled = estimateCopulaTailDependence(options.copula, item.pearson, item.kendallTau, degreesOfFreedom);
    return {
      left: item.left,
      right: item.right,
      pearson: item.pearson,
      kendallTau: item.kendallTau,
      lowerTailDependence: modeled.lower,
      upperTailDependence: modeled.upper,
      empiricalLowerTailDependence: item.empirical.lowerTailDependence,
      empiricalUpperTailDependence: item.empirical.upperTailDependence,
      empiricalLowerJointProbability: item.empirical.lowerJointProbability,
      empiricalUpperJointProbability: item.empirical.upperJointProbability,
    };
  });

  const zScoresBySeries = rows.map((series) => {
    const meanValue = average(series);
    const stdValue = sampleStd(series, meanValue);
    return series.map((value) => (stdValue > 0 ? (value - meanValue) / stdValue : 0));
  });

  let jointExtremeCount = 0;
  for (let k = 0; k < sampleSize; k += 1) {
    let isJoint = true;
    for (let s = 0; s < zScoresBySeries.length; s += 1) {
      if (zScoresBySeries[s][k] > options.jointThresholdZ) {
        isJoint = false;
        break;
      }
    }
    if (isJoint) jointExtremeCount += 1;
  }

  const scenarioResults = options.scenarioShocks.map((shock) => {
    let count = 0;
    for (let k = 0; k < sampleSize; k += 1) {
      let inScenario = true;
      for (let s = 0; s < rows.length; s += 1) {
        if (rows[s][k] > shock) {
          inScenario = false;
          break;
        }
      }
      if (inScenario) count += 1;
    }
    return {
      shock,
      jointProbability: sampleSize > 0 ? count / sampleSize : 0,
      jointCount: count,
    };
  });

  const comparisons = options.compare.map((family) => ({
    family,
    pairwise: pairwise.map((item) => {
      const modeled = estimateCopulaTailDependence(family, item.pearson, item.kendallTau, degreesOfFreedom);
      return {
        left: item.left,
        right: item.right,
        lowerTailDependence: modeled.lower,
        upperTailDependence: modeled.upper,
      };
    }),
  }));

  return {
    labels,
    matrix,
    pairwise: modeledPairs,
    stress: {
      tailAlpha: options.tailAlpha,
      jointThresholdZ: options.jointThresholdZ,
      jointExtremeCount,
      jointExtremeProbability: sampleSize > 0 ? jointExtremeCount / sampleSize : 0,
      scenarioResults,
    },
    diagnostics: {
      sampleSize,
      warnings,
      pairCount,
      avgAbsCorrelation,
      inferredDegreesOfFreedom: inferredDf,
    },
    comparisons,
    degreesOfFreedom,
  };
}

/**
 * Handle `model correlation` command execution.
 * @param {{actionArgs: string[], context: {outputMode: 'table'|'json'}, deps: object}} params
 * @returns {Promise<void>}
 */
module.exports = async function handleModelCorrelation({ actionArgs, context, deps }) {
  const {
    CliError,
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    parseModelCorrelationFlags,
  } = deps;

  if (includesHelpFlag(actionArgs)) {
    const usage =
      'pandora [--output table|json] model correlation --series <id:v1,v2,...> --series <id:v1,v2,...> [--copula t|gaussian|clayton|gumbel] [--compare <csv>] [--tail-alpha <n>] [--df <n>] [--joint-threshold-z <n>] [--scenario-shocks <csv>] [--model-id <id>] [--save-model <path>]';
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'model.correlation.help', commandHelpPayload(usage));
    } else {
      // eslint-disable-next-line no-console
      console.log(`Usage: ${usage}`);
    }
    return;
  }

  const options = parseModelCorrelationFlags(actionArgs);
  const result = runCorrelationAnalysis(options);
  const timestamp = new Date().toISOString();
  const modelId = options.modelId || buildModelId('model-copula');

  const artifact = {
    schemaVersion: '1.0.0',
    kind: 'copula_correlation',
    modelId,
    calibratedAt: timestamp,
    copula: {
      family: options.copula,
      degreesOfFreedom: result.degreesOfFreedom,
      tailAlpha: options.tailAlpha,
    },
    labels: result.labels,
    correlationMatrix: result.matrix,
    pairwise: result.pairwise,
    stress: result.stress,
    diagnostics: result.diagnostics,
    comparisons: result.comparisons,
  };

  let persistence = {
    saved: false,
    path: null,
    bytes: 0,
  };
  if (options.saveModel) {
    assertMcpWritablePathAllowed(options.saveModel, CliError);
    persistence = saveModelArtifact(options.saveModel, artifact);
  }

  emitSuccess(context.outputMode, 'model.correlation', {
    schemaVersion: '1.0.0',
    generatedAt: timestamp,
    action: 'correlation',
    copula: artifact.copula,
    metrics: {
      labels: result.labels,
      correlationMatrix: result.matrix,
      pairwise: result.pairwise,
    },
    stress: result.stress,
    comparisons: result.comparisons,
    diagnostics: result.diagnostics,
    model: artifact,
    persistence,
  });
};
