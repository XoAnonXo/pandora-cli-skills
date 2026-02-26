const SUGGEST_SCHEMA_VERSION = '1.0.0';

function clampBudget(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric;
}

function riskToPositionMultiplier(risk) {
  if (risk === 'low') return 0.6;
  if (risk === 'high') return 1.4;
  return 1;
}

function buildSuggestions(input) {
  const budget = clampBudget(input.budget);
  const count = Math.max(1, Number(input.count) || 3);
  const opportunities = Array.isArray(input.arbitrageOpportunities) ? input.arbitrageOpportunities : [];

  const ranked = [...opportunities].sort((a, b) => {
    const left = Math.max(Number(a.spreadYesPct) || 0, Number(a.spreadNoPct) || 0) * (Number(a.confidenceScore) || 0);
    const right = Math.max(Number(b.spreadYesPct) || 0, Number(b.spreadNoPct) || 0) * (Number(b.confidenceScore) || 0);
    return right - left;
  });

  const selected = ranked.slice(0, count);
  const multiplier = riskToPositionMultiplier(input.risk);
  const baseSize = selected.length ? (budget / selected.length) * multiplier : 0;

  const items = selected.map((opportunity, index) => {
    const yesSpread = Number(opportunity.spreadYesPct) || 0;
    const noSpread = Number(opportunity.spreadNoPct) || 0;
    const side = yesSpread >= noSpread ? 'yes' : 'no';
    const bestLeg = side === 'yes' ? opportunity.bestYesBuy : opportunity.bestNoBuy;

    return {
      rank: index + 1,
      groupId: opportunity.groupId,
      side,
      marketId: bestLeg && bestLeg.marketId ? bestLeg.marketId : null,
      venue: bestLeg && bestLeg.venue ? bestLeg.venue : null,
      amountUsdc: Number(baseSize.toFixed(2)),
      expectedEdgePct: Number(Math.max(yesSpread, noSpread).toFixed(4)),
      confidenceScore: opportunity.confidenceScore,
      rationale: `Selected from arbitrage group ${opportunity.groupId} with spread ${Math.max(yesSpread, noSpread).toFixed(2)}%.`,
      riskNotes: opportunity.riskFlags || [],
    };
  });

  return {
    schemaVersion: SUGGEST_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    wallet: input.wallet,
    risk: input.risk,
    budget,
    countRequested: count,
    count: items.length,
    items,
  };
}

module.exports = {
  SUGGEST_SCHEMA_VERSION,
  buildSuggestions,
};
