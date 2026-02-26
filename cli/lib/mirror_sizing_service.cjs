const MIRROR_SIZING_SCHEMA_VERSION = '1.0.0';

function toNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, decimals = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeProbability(raw) {
  const numeric = toNumber(raw);
  if (numeric === null) return null;
  if (numeric >= 0 && numeric <= 1) return numeric;
  if (numeric >= 0 && numeric <= 100) return numeric / 100;
  return null;
}

function computeDistributionHint(yesProbability) {
  const p = normalizeProbability(yesProbability);
  if (p === null) {
    return {
      probabilityYes: null,
      probabilityNo: null,
      distributionYes: 500_000_000,
      distributionNo: 500_000_000,
      diagnostics: ['YES probability unavailable; using balanced 50/50 distribution hint.'],
    };
  }

  const distributionNo = Math.round(1_000_000_000 * p);
  const distributionYes = 1_000_000_000 - distributionNo;
  return {
    probabilityYes: round(p, 6),
    probabilityNo: round(1 - p, 6),
    distributionYes,
    distributionNo,
    diagnostics: [],
  };
}

function computeLiquidityRecommendation(input = {}) {
  const diagnostics = [];

  const v24 = Math.max(0, toNumber(input.volume24hUsd) || 0);
  const depthEpsUsd = Math.max(0, toNumber(input.depthWithinSlippageUsd) || 0);

  const targetSlippageBps = clamp(toNumber(input.targetSlippageBps) || 150, 1, 10_000);
  const targetSlippage = targetSlippageBps / 10_000;
  const turnoverTarget = Math.max(0.01, toNumber(input.turnoverTarget) || 1.25);

  const depthUtilization = clamp(toNumber(input.depthUtilization) || 0.6, 0.01, 1);
  const safetyMultiplier = Math.max(1, toNumber(input.safetyMultiplier) || 1.2);

  const beta = Math.max(0.000001, toNumber(input.beta) || 0.003);
  const qMin = Math.max(0, toNumber(input.qMin) || 25);
  const qMax = Math.max(qMin, toNumber(input.qMax) || 2000);

  const minLiquidityUsd = Math.max(10, toNumber(input.minLiquidityUsd) || 100);
  const maxLiquidityUsd = Math.max(minLiquidityUsd, toNumber(input.maxLiquidityUsd) || 50_000);

  const qTarget = clamp(beta * v24, qMin, qMax);

  const lVolume = v24 > 0 ? v24 / turnoverTarget : 0;
  const lDepth = depthEpsUsd > 0 ? depthEpsUsd / depthUtilization : 0;
  const lImpact = qTarget / targetSlippage;

  if (v24 <= 0) diagnostics.push('Source 24h volume unavailable/zero; liquidity model relies on depth + impact floors.');
  if (depthEpsUsd <= 0) diagnostics.push('Source orderbook depth unavailable/zero; liquidity model relies on volume + impact floors.');

  const baseLiquidity = Math.max(lVolume, lDepth, lImpact);
  const recommendedLiquidityUsd = clamp(baseLiquidity * safetyMultiplier, minLiquidityUsd, maxLiquidityUsd);

  if (recommendedLiquidityUsd === minLiquidityUsd) {
    diagnostics.push('Recommendation hit minimum liquidity floor.');
  }
  if (recommendedLiquidityUsd === maxLiquidityUsd) {
    diagnostics.push('Recommendation hit maximum liquidity cap.');
  }

  return {
    schemaVersion: MIRROR_SIZING_SCHEMA_VERSION,
    inputs: {
      volume24hUsd: round(v24, 6),
      depthWithinSlippageUsd: round(depthEpsUsd, 6),
      targetSlippageBps: round(targetSlippageBps, 6),
      targetSlippage: round(targetSlippage, 6),
      turnoverTarget: round(turnoverTarget, 6),
      depthUtilization: round(depthUtilization, 6),
      safetyMultiplier: round(safetyMultiplier, 6),
      beta: round(beta, 6),
      qMin: round(qMin, 6),
      qMax: round(qMax, 6),
      minLiquidityUsd: round(minLiquidityUsd, 6),
      maxLiquidityUsd: round(maxLiquidityUsd, 6),
    },
    derived: {
      qTarget: round(qTarget, 6),
      lVolume: round(lVolume, 6),
      lDepth: round(lDepth, 6),
      lImpact: round(lImpact, 6),
      baseLiquidity: round(baseLiquidity, 6),
    },
    recommendation: {
      liquidityUsd: round(recommendedLiquidityUsd, 6),
      boundedByMin: recommendedLiquidityUsd === minLiquidityUsd,
      boundedByMax: recommendedLiquidityUsd === maxLiquidityUsd,
    },
    diagnostics,
  };
}

module.exports = {
  MIRROR_SIZING_SCHEMA_VERSION,
  normalizeProbability,
  computeDistributionHint,
  computeLiquidityRecommendation,
};
