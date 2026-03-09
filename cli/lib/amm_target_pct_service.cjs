const { round, clamp, toOptionalNumber } = require('./shared/utils.cjs');

function toPercent(value) {
  const numeric = toOptionalNumber(value);
  if (numeric === null) return null;
  if (numeric < 0 || numeric > 100) return null;
  return round(numeric, 6);
}

function deriveYesPctFromReserves(reserveYesUsdc, reserveNoUsdc) {
  const reserveYes = toOptionalNumber(reserveYesUsdc);
  const reserveNo = toOptionalNumber(reserveNoUsdc);
  if (reserveYes === null || reserveNo === null) return null;
  const total = reserveYes + reserveNo;
  if (!Number.isFinite(total) || total <= 0) return null;
  return round((reserveNo / total) * 100, 6);
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
  const solveYesPctAtVolume = (volumeUsdc) =>
    simulateDirectionalSwap({
      reserveYesUsdc,
      reserveNoUsdc,
      side,
      volumeUsdc,
      feeTier,
    }).postYesPct;

  let lo = 0;
  let hi = Math.max(1, reserveYesUsdc + reserveNoUsdc);
  let yesAtHi = solveYesPctAtVolume(hi);
  let iterations = 0;
  while (!directionCheck(yesAtHi) && iterations < 32) {
    hi *= 2;
    yesAtHi = solveYesPctAtVolume(hi);
    iterations += 1;
  }

  if (!directionCheck(yesAtHi)) {
    return null;
  }

  for (let i = 0; i < 56; i += 1) {
    const mid = (lo + hi) / 2;
    const yesAtMid = solveYesPctAtVolume(mid);
    if (directionCheck(yesAtMid)) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  return round(hi, 6);
}

function planAmmTradeToTargetYesPct(options = {}) {
  const reserveYesUsdc = toOptionalNumber(options.reserveYesUsdc);
  const reserveNoUsdc = toOptionalNumber(options.reserveNoUsdc);
  const targetYesPct = toPercent(options.targetYesPct);
  const feeTier = Number.isFinite(Number(options.feeTier)) ? Number(options.feeTier) : 3000;
  const requestedSide = String(options.requestedSide || '').trim().toLowerCase();
  const normalizedRequestedSide = requestedSide === 'yes' || requestedSide === 'no' ? requestedSide : null;
  const currentYesPct = deriveYesPctFromReserves(reserveYesUsdc, reserveNoUsdc);

  if (targetYesPct === null) {
    const diagnostics = ['Target percentage must be between 0 and 100.'];
    return {
      currentPct: currentYesPct,
      targetPct: null,
      targetYesPct: null,
      currentYesPct,
      requestedSide: normalizedRequestedSide,
      requiredSide: null,
      sideMatchesTarget: normalizedRequestedSide === null,
      requiredAmountUsdc: null,
      volumeNeededUsdc: null,
      postTradePct: null,
      postTradeYesPct: null,
      targetReachable: false,
      diagnostic: diagnostics[0],
      diagnostics,
    };
  }

  if (currentYesPct === null) {
    const diagnostics = ['AMM reserve context is required to solve a target percentage quote.'];
    return {
      currentPct: null,
      targetPct: targetYesPct,
      targetYesPct,
      currentYesPct: null,
      requestedSide: normalizedRequestedSide,
      requiredSide: null,
      sideMatchesTarget: normalizedRequestedSide === null,
      requiredAmountUsdc: null,
      volumeNeededUsdc: null,
      postTradePct: null,
      postTradeYesPct: null,
      targetReachable: false,
      diagnostic: diagnostics[0],
      diagnostics,
    };
  }

  const atTarget = Math.abs(currentYesPct - targetYesPct) <= 0.01;
  const requiredSide = atTarget ? 'none' : targetYesPct > currentYesPct ? 'yes' : 'no';
  const sideMatchesTarget =
    normalizedRequestedSide === null || requiredSide === 'none' || normalizedRequestedSide === requiredSide;
  const volumeNeededUsdc = solveVolumeForTargetYesPct({
    targetYesPct,
    reserveYesUsdc,
    reserveNoUsdc,
    feeTier,
  });
  const swap =
    Number.isFinite(volumeNeededUsdc) && volumeNeededUsdc >= 0
      ? simulateDirectionalSwap({
          reserveYesUsdc,
          reserveNoUsdc,
          side: requiredSide,
          volumeUsdc: volumeNeededUsdc,
          feeTier,
        })
      : null;

  let diagnostic = null;
  if (requiredSide !== 'none' && !sideMatchesTarget && normalizedRequestedSide) {
    diagnostic = `Target ${targetYesPct}% requires buying ${requiredSide.toUpperCase()}, not ${normalizedRequestedSide.toUpperCase()}.`;
  } else if (requiredSide !== 'none' && !Number.isFinite(volumeNeededUsdc)) {
    diagnostic = `Target ${targetYesPct}% is not reachable with finite volume under the current curve model.`;
  }
  const diagnostics = diagnostic ? [diagnostic] : [];

  return {
    currentPct: currentYesPct,
    targetPct: targetYesPct,
    targetYesPct,
    currentYesPct,
    requestedSide: normalizedRequestedSide,
    requiredSide,
    sideMatchesTarget,
    atTarget,
    feeTier,
    feeRate: round(clamp(feeTier / 1_000_000, 0, 0.1), 8),
    reserveYesUsdc: reserveYesUsdc === null ? null : round(reserveYesUsdc, 6),
    reserveNoUsdc: reserveNoUsdc === null ? null : round(reserveNoUsdc, 6),
    requiredAmountUsdc: Number.isFinite(volumeNeededUsdc) ? round(volumeNeededUsdc, 6) : null,
    volumeNeededUsdc: Number.isFinite(volumeNeededUsdc) ? round(volumeNeededUsdc, 6) : null,
    targetReachable: Number.isFinite(volumeNeededUsdc),
    postTradePct: swap && Number.isFinite(swap.postYesPct) ? round(swap.postYesPct, 6) : null,
    postTradeYesPct: swap && Number.isFinite(swap.postYesPct) ? round(swap.postYesPct, 6) : null,
    driftToTargetBps:
      swap && Number.isFinite(swap.postYesPct)
        ? round(Math.abs(targetYesPct - swap.postYesPct) * 100, 6)
        : null,
    diagnostic,
    diagnostics,
  };
}

module.exports = {
  deriveYesPctFromReserves,
  simulateDirectionalSwap,
  solveVolumeForTargetYesPct,
  planAmmTradeToTargetYesPct,
};
