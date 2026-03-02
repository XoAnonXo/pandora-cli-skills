const fs = require('fs');
const path = require('path');

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

function toLogReturns(prices) {
  const returns = [];
  for (let i = 1; i < prices.length; i += 1) {
    returns.push(Math.log(prices[i] / prices[i - 1]));
  }
  return returns;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function buildModelId(prefix = 'model-jd') {
  const now = new Date();
  const y = String(now.getUTCFullYear());
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  const nonce = Math.floor(Math.random() * 1e6)
    .toString(16)
    .padStart(5, '0');
  return `${prefix}-${y}${m}${d}-${hh}${mm}${ss}-${nonce}`;
}

function saveModelArtifact(filePath, artifact) {
  const absolutePath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const serialized = JSON.stringify(artifact, null, 2);
  fs.writeFileSync(absolutePath, serialized, { mode: 0o600 });
  try {
    fs.chmodSync(absolutePath, 0o600);
  } catch {
    // best-effort hardening on platforms that ignore chmod
  }
  return {
    saved: true,
    path: absolutePath,
    bytes: Buffer.byteLength(serialized, 'utf8'),
  };
}

function isMcpMode() {
  return String(process.env.PANDORA_MCP_MODE || '').trim() === '1';
}

function isPathInside(baseDir, candidatePath) {
  const relative = path.relative(baseDir, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertMcpWritablePathAllowed(rawPath, CliError) {
  if (!isMcpMode()) return;
  const workspaceRoot = path.resolve(process.cwd());
  const resolvedPath = path.resolve(String(rawPath || ''));
  if (isPathInside(workspaceRoot, resolvedPath)) {
    return;
  }

  throw new CliError(
    'MCP_FILE_ACCESS_BLOCKED',
    '--save-model must point to a file within the current workspace when running via MCP.',
    {
      flag: '--save-model',
      requestedPath: rawPath,
      resolvedPath,
      workspaceRoot,
    },
  );
}

function computeCalibratedModel(options) {
  const returns = Array.isArray(options.returns) ? options.returns.slice() : toLogReturns(options.prices || []);
  const observations = returns.length;
  const meanReturn = average(returns);
  const variance = sampleVariance(returns, meanReturn);
  const sigma = Math.sqrt(Math.max(variance, 0));
  const thresholdAbs = sigma * options.jumpThresholdSigma;

  const jumpReturns = [];
  const diffusionReturns = [];
  for (const value of returns) {
    if (thresholdAbs > 0 && Math.abs(value - meanReturn) >= thresholdAbs) {
      jumpReturns.push(value);
    } else {
      diffusionReturns.push(value);
    }
  }

  const jumpCount = jumpReturns.length;
  const jumpMean = jumpCount ? average(jumpReturns) : 0;
  const jumpStd = jumpCount > 1 ? Math.sqrt(sampleVariance(jumpReturns, jumpMean)) : 0;
  const jumpIntensityPerStep = observations > 0 ? jumpCount / observations : 0;
  const jumpIntensityAnnualized = options.dt > 0 ? jumpIntensityPerStep / options.dt : null;
  const diffusionMean = diffusionReturns.length ? average(diffusionReturns) : meanReturn;
  const diffusionSigma = diffusionReturns.length > 1 ? Math.sqrt(sampleVariance(diffusionReturns, diffusionMean)) : sigma;
  const driftAnnualized = options.dt > 0 ? meanReturn / options.dt : null;
  const sigmaAnnualized = options.dt > 0 ? sigma / Math.sqrt(options.dt) : null;

  const rmse = Math.sqrt(
    average(
      returns.map((value) => {
        const modeled = diffusionMean + (Math.abs(value - meanReturn) >= thresholdAbs && thresholdAbs > 0 ? jumpMean : 0);
        const error = value - modeled;
        return error * error;
      }),
    ),
  );

  const fitQuality = clamp01(1 - rmse / (sigma + 1e-9));
  const warnings = [];
  if (observations < 30) {
    warnings.push('Small sample size (< 30) can materially bias jump and volatility estimates.');
  }
  if (jumpCount < options.minJumpCount) {
    warnings.push(`Detected jump count (${jumpCount}) is below --min-jump-count (${options.minJumpCount}).`);
  }
  if (sigma === 0) {
    warnings.push('Estimated volatility is zero; input series appears constant.');
  }

  return {
    returns,
    parameters: {
      dt: options.dt,
      driftPerStep: meanReturn,
      driftAnnualized,
      sigmaPerSqrtStep: sigma,
      sigmaAnnualized,
      jumpIntensityPerStep,
      jumpIntensityAnnualized,
      jumpMean,
      jumpStd,
      diffusionMean,
      diffusionSigma,
    },
    diagnostics: {
      sampleSize: observations,
      jumpCount,
      thresholdSigma: options.jumpThresholdSigma,
      thresholdAbs,
      rmse,
      fitQuality,
      warnings,
    },
  };
}

/**
 * Handle `model calibrate` command execution.
 * @param {{actionArgs: string[], context: {outputMode: 'table'|'json'}, deps: object}} params
 * @returns {Promise<void>}
 */
module.exports = async function handleModelCalibrate({ actionArgs, context, deps }) {
  const {
    CliError,
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    parseModelCalibrateFlags,
  } = deps;

  if (includesHelpFlag(actionArgs)) {
    const usage =
      'pandora [--output table|json] model calibrate (--prices <csv>|--returns <csv>) [--dt <n>] [--jump-threshold-sigma <n>] [--min-jump-count <n>] [--model-id <id>] [--save-model <path>]';
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'model.calibrate.help', commandHelpPayload(usage));
    } else {
      // eslint-disable-next-line no-console
      console.log(`Usage: ${usage}`);
    }
    return;
  }

  const options = parseModelCalibrateFlags(actionArgs);
  const result = computeCalibratedModel(options);
  const timestamp = new Date().toISOString();
  const modelId = options.modelId || buildModelId();

  const artifact = {
    schemaVersion: '1.0.0',
    kind: 'jump_diffusion',
    modelId,
    calibratedAt: timestamp,
    source: {
      inputType: options.returns ? 'returns' : 'prices',
      observations: result.returns.length,
    },
    parameters: result.parameters,
    diagnostics: result.diagnostics,
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

  emitSuccess(context.outputMode, 'model.calibrate', {
    schemaVersion: '1.0.0',
    generatedAt: timestamp,
    action: 'calibrate',
    model: artifact,
    diagnostics: result.diagnostics,
    persistence,
  });
};
