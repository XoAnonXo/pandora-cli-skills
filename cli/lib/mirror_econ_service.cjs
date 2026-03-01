const { computeDistributionHint, normalizeProbability } = require('./mirror_sizing_service.cjs');
const { round, clamp, toOptionalNumber } = require('./shared/utils.cjs');

const MIRROR_LP_EXPLAIN_SCHEMA_VERSION = '1.0.0';
const MIRROR_HEDGE_CALC_SCHEMA_VERSION = '1.0.0';
const MIRROR_SIMULATE_SCHEMA_VERSION = '1.0.0';
const USDC_DECIMALS = 6;
const USDC_SCALE = 10 ** USDC_DECIMALS;

function toRawUsdc(usdc) {
  const numeric = toOptionalNumber(usdc);
  if (numeric === null) return null;
  return BigInt(Math.round(numeric * USDC_SCALE));
}

function rawUsdcToNumber(rawValue) {
  if (typeof rawValue !== 'bigint') return null;
  return round(Number(rawValue) / USDC_SCALE, 6);
}

function toPercent(value) {
  const numeric = toOptionalNumber(value);
  if (numeric === null) return null;
  if (numeric >= 0 && numeric <= 100) return round(numeric, 6);
  return null;
}

function yesPctToProbability(yesPct) {
  const normalized = normalizeProbability(yesPct);
  if (normalized === null) return null;
  return normalized;
}

function resolveDistribution(options = {}) {
  const diagnostics = [];
  const sourceYesPct = toPercent(options.sourceYesPct);

  const explicitYes = toOptionalNumber(options.distributionYes);
  const explicitNo = toOptionalNumber(options.distributionNo);
  if (explicitYes !== null || explicitNo !== null) {
    if (explicitYes === null || explicitNo === null) {
      throw new Error('distributionYes and distributionNo must both be provided together.');
    }
    if (!Number.isInteger(explicitYes) || !Number.isInteger(explicitNo)) {
      throw new Error('distributionYes and distributionNo must be integers.');
    }
    if (explicitYes < 0 || explicitNo < 0 || explicitYes + explicitNo !== 1_000_000_000) {
      throw new Error('distributionYes + distributionNo must equal 1000000000.');
    }
    return {
      sourceYesPct,
      sourceYesProbability: sourceYesPct === null ? null : round(sourceYesPct / 100, 6),
      distributionYes: explicitYes,
      distributionNo: explicitNo,
      diagnostics,
      mode: 'explicit',
    };
  }

  const distribution = computeDistributionHint(sourceYesPct === null ? 0.5 : sourceYesPct / 100);
  if (sourceYesPct === null) {
    diagnostics.push('No source YES probability supplied; defaulted to balanced 50/50 distribution hint.');
  } else if (sourceYesPct === 0 || sourceYesPct === 100) {
    diagnostics.push('Degenerate source YES probability (0% or 100%) may create an extreme one-sided seed.');
  }

  return {
    sourceYesPct,
    sourceYesProbability:
      sourceYesPct === null
        ? null
        : round(sourceYesPct / 100, 6),
    distributionYes: distribution.distributionYes,
    distributionNo: distribution.distributionNo,
    diagnostics: diagnostics.concat(distribution.diagnostics || []),
    mode: sourceYesPct === null ? 'default' : 'derived-from-source-yes-pct',
  };
}

function deriveYesPctFromReserves(reserveYesUsdc, reserveNoUsdc) {
  const yesReserve = toOptionalNumber(reserveYesUsdc);
  const noReserve = toOptionalNumber(reserveNoUsdc);
  if (yesReserve === null || noReserve === null) return null;
  const total = yesReserve + noReserve;
  if (!Number.isFinite(total) || total <= 0) return null;
  return round((noReserve / total) * 100, 6);
}

function computeCompleteSetAllocation(options = {}) {
  const liquidityRaw = toRawUsdc(options.liquidityUsdc);
  if (liquidityRaw === null || liquidityRaw <= 0n) {
    throw new Error('liquidityUsdc must be a positive number.');
  }

  const distributionYes = toOptionalNumber(options.distributionYes);
  const distributionNo = toOptionalNumber(options.distributionNo);
  if (!Number.isInteger(distributionYes) || !Number.isInteger(distributionNo)) {
    throw new Error('distributionYes and distributionNo must be integers.');
  }
  if (distributionYes < 0 || distributionNo < 0 || distributionYes + distributionNo !== 1_000_000_000) {
    throw new Error('distributionYes + distributionNo must equal 1000000000.');
  }

  const yesWeight = BigInt(distributionYes);
  const noWeight = BigInt(distributionNo);

  const mintedYesRaw = liquidityRaw;
  const mintedNoRaw = liquidityRaw;

  let reserveYesRaw;
  let reserveNoRaw;
  if (noWeight >= yesWeight) {
    reserveYesRaw = liquidityRaw;
    reserveNoRaw = noWeight === 0n ? 0n : (liquidityRaw * yesWeight) / noWeight;
  } else {
    reserveNoRaw = liquidityRaw;
    reserveYesRaw = yesWeight === 0n ? 0n : (liquidityRaw * noWeight) / yesWeight;
  }

  const excessYesRaw = mintedYesRaw - reserveYesRaw;
  const excessNoRaw = mintedNoRaw - reserveNoRaw;
  const totalYesRaw = reserveYesRaw + excessYesRaw;
  const totalNoRaw = reserveNoRaw + excessNoRaw;

  return {
    liquidityRaw,
    mintedYesRaw,
    mintedNoRaw,
    reserveYesRaw,
    reserveNoRaw,
    excessYesRaw,
    excessNoRaw,
    totalYesRaw,
    totalNoRaw,
    impliedPoolYesPct: deriveYesPctFromReserves(rawUsdcToNumber(reserveYesRaw), rawUsdcToNumber(reserveNoRaw)),
    liquidityUsdc: rawUsdcToNumber(liquidityRaw),
    mintedYesUsdc: rawUsdcToNumber(mintedYesRaw),
    mintedNoUsdc: rawUsdcToNumber(mintedNoRaw),
    reserveYesUsdc: rawUsdcToNumber(reserveYesRaw),
    reserveNoUsdc: rawUsdcToNumber(reserveNoRaw),
    excessYesUsdc: rawUsdcToNumber(excessYesRaw),
    excessNoUsdc: rawUsdcToNumber(excessNoRaw),
    totalYesUsdc: rawUsdcToNumber(totalYesRaw),
    totalNoUsdc: rawUsdcToNumber(totalNoRaw),
    neutralCompleteSets: totalYesRaw === totalNoRaw,
  };
}

function simulateDirectionalSwap(options = {}) {
  const reserveYes = Math.max(0, toOptionalNumber(options.reserveYesUsdc) || 0);
  const reserveNo = Math.max(0, toOptionalNumber(options.reserveNoUsdc) || 0);
  const volumeUsdc = Math.max(0, toOptionalNumber(options.volumeUsdc) || 0);
  const feeTier = Number.isFinite(Number(options.feeTier)) ? Number(options.feeTier) : 3000;
  const feeRate = clamp(feeTier / 1_000_000, 0, 0.1);
  const side = String(options.side || 'none').toLowerCase();

  if (side !== 'yes' && side !== 'no') {
    return {
      side: 'none',
      volumeUsdc: round(volumeUsdc, 6),
      feeTier,
      feeRate: round(feeRate, 8),
      feesEarnedUsdc: 0,
      outputShares: 0,
      reserveYesUsdc: round(reserveYes, 6),
      reserveNoUsdc: round(reserveNo, 6),
      postYesPct: deriveYesPctFromReserves(reserveYes, reserveNo),
    };
  }

  const effectiveIn = volumeUsdc * (1 - feeRate);
  const feesEarnedUsdc = volumeUsdc - effectiveIn;

  if (side === 'yes') {
    const denominator = reserveNo + effectiveIn;
    const outputYes = denominator > 0 ? (reserveYes * effectiveIn) / denominator : 0;
    const postReserveYes = Math.max(0, reserveYes - outputYes);
    const postReserveNo = reserveNo + effectiveIn;
    return {
      side,
      volumeUsdc: round(volumeUsdc, 6),
      feeTier,
      feeRate: round(feeRate, 8),
      feesEarnedUsdc: round(feesEarnedUsdc, 6),
      outputShares: round(outputYes, 6),
      reserveYesUsdc: round(postReserveYes, 6),
      reserveNoUsdc: round(postReserveNo, 6),
      postYesPct: deriveYesPctFromReserves(postReserveYes, postReserveNo),
    };
  }

  const denominator = reserveYes + effectiveIn;
  const outputNo = denominator > 0 ? (reserveNo * effectiveIn) / denominator : 0;
  const postReserveNo = Math.max(0, reserveNo - outputNo);
  const postReserveYes = reserveYes + effectiveIn;
  return {
    side,
    volumeUsdc: round(volumeUsdc, 6),
    feeTier,
    feeRate: round(feeRate, 8),
    feesEarnedUsdc: round(feesEarnedUsdc, 6),
    outputShares: round(outputNo, 6),
    reserveYesUsdc: round(postReserveYes, 6),
    reserveNoUsdc: round(postReserveNo, 6),
    postYesPct: deriveYesPctFromReserves(postReserveYes, postReserveNo),
  };
}

function solveVolumeForTargetYesPct(options = {}) {
  const targetYesPct = toPercent(options.targetYesPct);
  const reserveYesUsdc = toOptionalNumber(options.reserveYesUsdc);
  const reserveNoUsdc = toOptionalNumber(options.reserveNoUsdc);
  const feeTier = Number.isFinite(Number(options.feeTier)) ? Number(options.feeTier) : 3000;

  if (targetYesPct === null || reserveYesUsdc === null || reserveNoUsdc === null) {
    return null;
  }

  const initialYesPct = deriveYesPctFromReserves(reserveYesUsdc, reserveNoUsdc);
  if (initialYesPct === null) return null;
  if (Math.abs(initialYesPct - targetYesPct) <= 0.01) return 0;

  const side = targetYesPct > initialYesPct ? 'yes' : 'no';
  const directionCheck = (yesPct) => (side === 'yes' ? yesPct >= targetYesPct : yesPct <= targetYesPct);
  const f = (volumeUsdc) =>
    simulateDirectionalSwap({
      reserveYesUsdc,
      reserveNoUsdc,
      side,
      volumeUsdc,
      feeTier,
    }).postYesPct;

  let lo = 0;
  let hi = Math.max(1, reserveYesUsdc + reserveNoUsdc);
  let yesAtHi = f(hi);
  let iterations = 0;
  while (!directionCheck(yesAtHi) && iterations < 32) {
    hi *= 2;
    yesAtHi = f(hi);
    iterations += 1;
  }

  if (!directionCheck(yesAtHi)) {
    return null;
  }

  for (let i = 0; i < 56; i += 1) {
    const mid = (lo + hi) / 2;
    const yesAtMid = f(mid);
    if (directionCheck(yesAtMid)) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  return round(hi, 6);
}

function normalizeVolumeScenarios(value, liquidityUsdc) {
  const fallback = () => {
    const liq = Math.max(1, toOptionalNumber(liquidityUsdc) || 0);
    return [
      round(liq * 0.25, 6),
      round(liq * 0.5, 6),
      round(liq, 6),
      round(liq * 2, 6),
    ];
  };

  if (Array.isArray(value)) {
    const parsed = value.map((item) => toOptionalNumber(item)).filter((item) => Number.isFinite(item) && item >= 0).map((item) => round(item, 6));
    return parsed.length ? parsed : fallback();
  }

  const raw = String(value || '').trim();
  if (raw) {
    const parsed = raw
      .split(',')
      .map((entry) => toOptionalNumber(entry.trim()))
      .filter((entry) => Number.isFinite(entry) && entry >= 0)
      .map((entry) => round(entry, 6));
    return parsed.length ? parsed : fallback();
  }

  return fallback();
}

function computeHedgeMetrics(options = {}) {
  const reserveYesUsdc = toOptionalNumber(options.reserveYesUsdc) || 0;
  const reserveNoUsdc = toOptionalNumber(options.reserveNoUsdc) || 0;
  const excessYesUsdc = toOptionalNumber(options.excessYesUsdc) || 0;
  const excessNoUsdc = toOptionalNumber(options.excessNoUsdc) || 0;
  const hedgeRatio = clamp(toOptionalNumber(options.hedgeRatio) || 1, 0, 5);
  const polymarketYesPct = toPercent(options.polymarketYesPct);
  const hedgeCostBps = Math.max(0, toOptionalNumber(options.hedgeCostBps) || 35);
  const feeTier = Number.isFinite(Number(options.feeTier)) ? Number(options.feeTier) : 3000;
  const feeRate = clamp(feeTier / 1_000_000, 0, 0.1);

  const deltaPoolUsdc = reserveYesUsdc - reserveNoUsdc;
  const deltaTotalUsdc = (reserveYesUsdc + excessYesUsdc) - (reserveNoUsdc + excessNoUsdc);
  const targetHedgeUsdcSigned = -deltaTotalUsdc * hedgeRatio;
  const targetHedgeUsdcAbs = Math.abs(targetHedgeUsdcSigned);
  const hedgeToken = targetHedgeUsdcSigned > 0 ? 'yes' : targetHedgeUsdcSigned < 0 ? 'no' : null;

  const yesPrice01 = polymarketYesPct === null ? null : clamp(polymarketYesPct / 100, 0.0001, 0.9999);
  const noPrice01 = yesPrice01 === null ? null : 1 - yesPrice01;
  const hedgePrice01 = hedgeToken === 'yes' ? yesPrice01 : hedgeToken === 'no' ? noPrice01 : null;
  const hedgeSharesApprox = hedgePrice01 ? round(targetHedgeUsdcAbs / hedgePrice01, 6) : null;

  const hedgeCostApproxUsdc = round(targetHedgeUsdcAbs * (hedgeCostBps / 10_000), 6) || 0;
  const breakEvenVolumeUsdc = feeRate > 0 ? round(hedgeCostApproxUsdc / feeRate, 6) : null;

  return {
    reserveYesUsdc: round(reserveYesUsdc, 6),
    reserveNoUsdc: round(reserveNoUsdc, 6),
    excessYesUsdc: round(excessYesUsdc, 6),
    excessNoUsdc: round(excessNoUsdc, 6),
    deltaPoolUsdc: round(deltaPoolUsdc, 6),
    deltaTotalUsdc: round(deltaTotalUsdc, 6),
    hedgeRatio: round(hedgeRatio, 6),
    targetHedgeUsdcSigned: round(targetHedgeUsdcSigned, 6),
    targetHedgeUsdcAbs: round(targetHedgeUsdcAbs, 6),
    hedgeToken,
    polymarketYesPct,
    polymarketNoPct: polymarketYesPct === null ? null : round(100 - polymarketYesPct, 6),
    hedgePrice01: hedgePrice01 === null ? null : round(hedgePrice01, 8),
    hedgeSharesApprox,
    hedgeCostBps: round(hedgeCostBps, 6),
    hedgeCostApproxUsdc,
    feeTier,
    feeRate: round(feeRate, 8),
    breakEvenVolumeUsdc,
  };
}

function buildMirrorLpExplain(options = {}) {
  const distribution = resolveDistribution(options);
  const allocation = computeCompleteSetAllocation({
    liquidityUsdc: options.liquidityUsdc,
    distributionYes: distribution.distributionYes,
    distributionNo: distribution.distributionNo,
  });

  const diagnostics = [];
  diagnostics.push(...distribution.diagnostics);
  diagnostics.push(
    'addLiquidity mints complete sets first, seeds reserves by distribution hint, then returns excess YES/NO tokens to the LP wallet.',
  );

  return {
    schemaVersion: MIRROR_LP_EXPLAIN_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    inputs: {
      liquidityUsdc: allocation.liquidityUsdc,
      sourceYesPct: distribution.sourceYesPct,
      distributionYes: distribution.distributionYes,
      distributionNo: distribution.distributionNo,
      distributionMode: distribution.mode,
    },
    flow: {
      mintedCompleteSets: {
        yesTokens: allocation.mintedYesUsdc,
        noTokens: allocation.mintedNoUsdc,
      },
      seededPoolReserves: {
        reserveYesUsdc: allocation.reserveYesUsdc,
        reserveNoUsdc: allocation.reserveNoUsdc,
        impliedPandoraYesPct: allocation.impliedPoolYesPct,
      },
      returnedExcessTokens: {
        excessYesUsdc: allocation.excessYesUsdc,
        excessNoUsdc: allocation.excessNoUsdc,
      },
      totalLpInventory: {
        totalYesUsdc: allocation.totalYesUsdc,
        totalNoUsdc: allocation.totalNoUsdc,
        deltaUsdc: round((allocation.totalYesUsdc || 0) - (allocation.totalNoUsdc || 0), 6),
        neutralCompleteSets: allocation.neutralCompleteSets,
      },
    },
    raw: {
      liquidityRaw: allocation.liquidityRaw.toString(),
      reserveYesRaw: allocation.reserveYesRaw.toString(),
      reserveNoRaw: allocation.reserveNoRaw.toString(),
      excessYesRaw: allocation.excessYesRaw.toString(),
      excessNoRaw: allocation.excessNoRaw.toString(),
    },
    diagnostics,
  };
}

function buildMirrorHedgeCalc(options = {}) {
  const scenarios = normalizeVolumeScenarios(options.volumeScenarios, options.reserveYesUsdc + options.reserveNoUsdc);
  const metrics = computeHedgeMetrics(options);

  const scenarioRows = scenarios.map((volumeUsdc) => {
    const fees = round(volumeUsdc * (metrics.feeRate || 0), 6) || 0;
    return {
      volumeUsdc,
      feeRevenueUsdc: fees,
      hedgeCostApproxUsdc: metrics.hedgeCostApproxUsdc,
      netPnlApproxUsdc: round(fees - (metrics.hedgeCostApproxUsdc || 0), 6),
    };
  });

  return {
    schemaVersion: MIRROR_HEDGE_CALC_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    metrics,
    scenarios: scenarioRows,
    diagnostics: [
      'Hedge sizing is notional-based and assumes FAK fills near the provided Polymarket mark price.',
      'P&L rows are approximation: LP fee accrual minus estimated hedge execution cost.',
    ],
  };
}

function buildMirrorSimulate(options = {}) {
  const distribution = resolveDistribution(options);
  const allocation = computeCompleteSetAllocation({
    liquidityUsdc: options.liquidityUsdc,
    distributionYes: distribution.distributionYes,
    distributionNo: distribution.distributionNo,
  });

  const targetYesPct = toPercent(options.targetYesPct !== undefined ? options.targetYesPct : distribution.sourceYesPct);
  const initialYesPct = allocation.impliedPoolYesPct;
  const tradeSide =
    targetYesPct === null || initialYesPct === null
      ? 'none'
      : targetYesPct > initialYesPct
        ? 'yes'
        : targetYesPct < initialYesPct
          ? 'no'
          : 'none';

  const feeTier = Number.isFinite(Number(options.feeTier)) ? Number(options.feeTier) : 3000;
  const hedgeRatio = clamp(toOptionalNumber(options.hedgeRatio) || 1, 0, 5);
  const hedgeCostBps = Math.max(0, toOptionalNumber(options.hedgeCostBps) || 35);
  const polymarketYesPct = toPercent(
    options.polymarketYesPct !== undefined ? options.polymarketYesPct : (targetYesPct !== null ? targetYesPct : 50),
  );

  const volumeScenarios = normalizeVolumeScenarios(options.volumeScenarios, allocation.liquidityUsdc);
  const volumeNeededToTargetUsdc =
    targetYesPct === null
      ? null
      : solveVolumeForTargetYesPct({
          targetYesPct,
          reserveYesUsdc: allocation.reserveYesUsdc,
          reserveNoUsdc: allocation.reserveNoUsdc,
          feeTier,
        });

  const scenarioResults = volumeScenarios.map((volumeUsdc) => {
    const swap = simulateDirectionalSwap({
      reserveYesUsdc: allocation.reserveYesUsdc,
      reserveNoUsdc: allocation.reserveNoUsdc,
      side: tradeSide,
      volumeUsdc,
      feeTier,
    });

    const hedge = computeHedgeMetrics({
      reserveYesUsdc: swap.reserveYesUsdc,
      reserveNoUsdc: swap.reserveNoUsdc,
      excessYesUsdc: allocation.excessYesUsdc,
      excessNoUsdc: allocation.excessNoUsdc,
      hedgeRatio,
      polymarketYesPct,
      hedgeCostBps,
      feeTier,
    });

    const netPnlApproxUsdc = round((swap.feesEarnedUsdc || 0) - (hedge.hedgeCostApproxUsdc || 0), 6);

    return {
      volumeUsdc: round(volumeUsdc, 6),
      tradeSide,
      feesEarnedUsdc: swap.feesEarnedUsdc,
      postReserveYesUsdc: swap.reserveYesUsdc,
      postReserveNoUsdc: swap.reserveNoUsdc,
      postYesPct: swap.postYesPct,
      driftToTargetBps:
        targetYesPct === null || swap.postYesPct === null
          ? null
          : round(Math.abs(targetYesPct - swap.postYesPct) * 100, 6),
      hedge: {
        targetHedgeUsdc: hedge.targetHedgeUsdcSigned,
        hedgeToken: hedge.hedgeToken,
        hedgeSharesApprox: hedge.hedgeSharesApprox,
        hedgeCostApproxUsdc: hedge.hedgeCostApproxUsdc,
      },
      netPnlApproxUsdc,
    };
  });

  return {
    schemaVersion: MIRROR_SIMULATE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    inputs: {
      liquidityUsdc: allocation.liquidityUsdc,
      feeTier,
      hedgeRatio,
      hedgeCostBps,
      sourceYesPct: distribution.sourceYesPct,
      targetYesPct,
      polymarketYesPct,
      distributionYes: distribution.distributionYes,
      distributionNo: distribution.distributionNo,
      distributionMode: distribution.mode,
      tradeSide,
      volumeScenarios,
    },
    initialState: {
      reserveYesUsdc: allocation.reserveYesUsdc,
      reserveNoUsdc: allocation.reserveNoUsdc,
      excessYesUsdc: allocation.excessYesUsdc,
      excessNoUsdc: allocation.excessNoUsdc,
      initialYesPct,
      neutralCompleteSets: allocation.neutralCompleteSets,
    },
    targeting: {
      volumeNeededToTargetUsdc,
      targetReachable: volumeNeededToTargetUsdc !== null,
    },
    scenarios: scenarioResults,
    diagnostics: [
      'Complete-set mint/split step is exact (raw integer math).',
      'Trade path models CPMM directional flow using net-of-fee input in reserve updates; fees are tracked as a separate accrual line.',
      'Use mirror sync + live orderbooks for execution-grade sizing; this command is planning-grade simulation.',
    ].concat(distribution.diagnostics || []),
  };
}

module.exports = {
  MIRROR_LP_EXPLAIN_SCHEMA_VERSION,
  MIRROR_HEDGE_CALC_SCHEMA_VERSION,
  MIRROR_SIMULATE_SCHEMA_VERSION,
  resolveDistribution,
  computeCompleteSetAllocation,
  simulateDirectionalSwap,
  solveVolumeForTargetYesPct,
  computeHedgeMetrics,
  buildMirrorLpExplain,
  buildMirrorHedgeCalc,
  buildMirrorSimulate,
};
