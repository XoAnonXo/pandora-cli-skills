'use strict';

const DISTRIBUTION_SCALE = 1_000_000_000;
const LEGACY_DISTRIBUTION_YES_PCT_FLAG = '--distribution-yes-pct';
const LEGACY_DISTRIBUTION_NO_PCT_FLAG = '--distribution-no-pct';
const YES_RESERVE_WEIGHT_PCT_FLAG = '--yes-reserve-weight-pct';
const NO_RESERVE_WEIGHT_PCT_FLAG = '--no-reserve-weight-pct';

function roundPct(value) {
  return Math.round(Number(value) * 1_000_000) / 1_000_000;
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizePercent(value) {
  const numeric = toFiniteNumber(value);
  if (numeric === null || numeric < 0 || numeric > 100) {
    return null;
  }
  return numeric;
}

function deriveAmmProbabilityContract(distributionYes, distributionNo) {
  const yes = toFiniteNumber(distributionYes);
  const no = toFiniteNumber(distributionNo);
  if (!Number.isFinite(yes) || !Number.isFinite(no)) {
    return null;
  }
  const total = yes + no;
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }

  const yesReserveWeightPct = roundPct((yes / total) * 100);
  const noReserveWeightPct = roundPct((no / total) * 100);
  const initialYesProbabilityPct = noReserveWeightPct;
  const initialNoProbabilityPct = yesReserveWeightPct;

  return {
    distributionScale: DISTRIBUTION_SCALE,
    initialYesProbabilityPct,
    initialNoProbabilityPct,
    yesReserveWeightPct,
    noReserveWeightPct,
    interpretation:
      'AMM YES probability is derived from NO reserve share. A higher initial YES probability requires a lower YES reserve weight.',
  };
}

function deriveDistributionFromInitialYesProbabilityPct(initialYesProbabilityPct) {
  const normalizedYes = normalizePercent(initialYesProbabilityPct);
  if (normalizedYes === null) {
    return null;
  }
  const distributionNo = Math.round(normalizedYes * (DISTRIBUTION_SCALE / 100));
  const distributionYes = DISTRIBUTION_SCALE - distributionNo;
  return {
    distributionYes,
    distributionNo,
    contract: deriveAmmProbabilityContract(distributionYes, distributionNo),
  };
}

function buildLegacyDistributionPercentMigrationMessage(flagName) {
  return `${flagName} has been retired. Use ${YES_RESERVE_WEIGHT_PCT_FLAG}/${NO_RESERVE_WEIGHT_PCT_FLAG} for explicit reserve weights. For AMM opening probability, use --initial-yes-pct/--initial-no-pct instead. Raw --distribution-yes/--distribution-no remain available for low-level unit control.`;
}

module.exports = {
  DISTRIBUTION_SCALE,
  LEGACY_DISTRIBUTION_YES_PCT_FLAG,
  LEGACY_DISTRIBUTION_NO_PCT_FLAG,
  YES_RESERVE_WEIGHT_PCT_FLAG,
  NO_RESERVE_WEIGHT_PCT_FLAG,
  normalizePercent,
  deriveAmmProbabilityContract,
  deriveDistributionFromInitialYesProbabilityPct,
  buildLegacyDistributionPercentMigrationMessage,
};
