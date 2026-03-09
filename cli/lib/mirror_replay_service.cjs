const MIRROR_REPLAY_SCHEMA_VERSION = '1.0.0';

function toNumberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toIso(value) {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function round(value, decimals = 6) {
  const numeric = toNumberOrNull(value);
  if (numeric === null) return null;
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
}

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function isLikelyTxHash(value) {
  const text = normalizeText(value);
  return Boolean(text && /^0x[a-z0-9]{4,}$/i.test(text));
}

function firstDefined() {
  for (const value of arguments) {
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

function isFailureStatus(status) {
  if (!status) return false;
  const normalized = String(status).trim().toLowerCase();
  return normalized === 'failed' || normalized === 'error';
}

function pushUniqueText(target, value) {
  const normalized = normalizeText(value);
  if (!normalized) return;
  if (!target.includes(normalized)) target.push(normalized);
}

function collectDistinctValue(legs, fieldName) {
  const distinct = [];
  for (const leg of Array.isArray(legs) ? legs : []) {
    if (!leg || typeof leg !== 'object') continue;
    pushUniqueText(distinct, leg[fieldName]);
  }
  if (!distinct.length) return null;
  return distinct.length === 1 ? distinct[0] : 'mixed';
}

function buildActionGroupKey(entry = {}, index = 0) {
  const details = entry && entry.details && typeof entry.details === 'object' ? entry.details : {};
  return [
    normalizeText(details.idempotencyKey) || `group-${index}`,
    normalizeText(entry.timestamp) || '',
    normalizeText(entry.status) || '',
  ].join('|');
}

function normalizeLeg(entry = {}) {
  const details = entry && entry.details && typeof entry.details === 'object' ? entry.details : {};
  const classification = normalizeText(entry.classification);
  const directTxHash = firstDefined(details.txHash, details.transactionHash, entry.txHash);
  const transactionRef = normalizeText(details.transactionRef);
  return {
    classification,
    venue: normalizeText(entry.venue),
    source: normalizeText(entry.source),
    status: normalizeText(entry.status),
    timestamp: toIso(entry.timestamp),
    amountUsdc: toNumberOrNull(firstDefined(details.amountUsdc, details.notionalUsdc, entry.amountUsdc, entry.notionalUsdc)),
    legType: normalizeText(firstDefined(details.legType, details.ledgerLegType, entry.legType)),
    quantity: toNumberOrNull(firstDefined(details.quantity, details.tokenAmount, entry.quantity)),
    notionalUsdc: toNumberOrNull(firstDefined(details.notionalUsdc, details.amountUsdc, entry.notionalUsdc, entry.amountUsdc)),
    feeUsdc: toNumberOrNull(firstDefined(details.feeUsdc, details.feesUsdc, entry.feeUsdc)),
    gasUsdc: toNumberOrNull(firstDefined(details.gasUsdc, details.gasCostUsdc, entry.gasUsdc)),
    blockNumber: toNumberOrNull(firstDefined(details.blockNumber, entry.blockNumber)),
    nonce: toNumberOrNull(firstDefined(details.nonce, entry.nonce)),
    txHash: isLikelyTxHash(directTxHash) ? normalizeText(directTxHash) : (isLikelyTxHash(transactionRef) ? transactionRef : null),
    rebalanceSide: classification === 'pandora-rebalance' ? normalizeText(details.side) : null,
    hedgeTokenSide: classification === 'polymarket-hedge' ? normalizeText(details.tokenSide) : null,
    hedgeOrderSide: classification === 'polymarket-hedge' ? normalizeText(details.orderSide) : null,
    executionMode: normalizeText(details.executionMode),
    stateDeltaUsdc: toNumberOrNull(details.stateDeltaUsdc),
    transactionRef,
    code: normalizeText(entry.code),
    message: normalizeText(entry.message),
    failed: isFailureStatus(entry.status),
  };
}

function sumLegAmounts(legs, classification, includeFailures) {
  const total = (Array.isArray(legs) ? legs : [])
    .filter((leg) => leg.classification === classification)
    .filter((leg) => includeFailures || !leg.failed)
    .reduce((sum, leg) => sum + (toNumberOrNull(leg.amountUsdc) || 0), 0);
  return round(total) || 0;
}

function hasSideMismatch(action) {
  if (!action || typeof action !== 'object') return false;
  const modeled = action.modeled || {};
  const actual = action.actual || {};
  if (modeled.rebalanceSide && actual.rebalanceSide && modeled.rebalanceSide !== actual.rebalanceSide) {
    return true;
  }
  if (modeled.hedgeTokenSide && actual.hedgeTokenSide && modeled.hedgeTokenSide !== actual.hedgeTokenSide) {
    return true;
  }
  if (modeled.hedgeOrderSide && actual.hedgeOrderSide && modeled.hedgeOrderSide !== actual.hedgeOrderSide) {
    return true;
  }
  return false;
}

function deriveVerdict(action = {}) {
  const legs = Array.isArray(action.legs) ? action.legs : [];
  if (legs.some((leg) => leg.failed)) {
    return 'execution-failed';
  }
  if (action.modeled.plannedSpendUsdc === null) {
    return 'actual-only';
  }
  if (hasSideMismatch(action)) {
    return 'deviated-from-model';
  }
  const variance = Math.abs(Number(action.variance.spendUsdc || 0));
  return variance <= 0.01 ? 'matched-model' : 'deviated-from-model';
}

function buildReplayAction(entry = {}, legs = [], actionKey = null) {
  const details = entry && entry.details && typeof entry.details === 'object' ? entry.details : {};
  const model = details.model && typeof details.model === 'object' ? details.model : details;
  const attemptedRebalanceUsdc = sumLegAmounts(legs, 'pandora-rebalance', true);
  const attemptedHedgeUsdc = sumLegAmounts(legs, 'polymarket-hedge', true);
  const actualRebalanceUsdc = sumLegAmounts(legs, 'pandora-rebalance', false);
  const actualHedgeUsdc = sumLegAmounts(legs, 'polymarket-hedge', false);
  const actualSpendUsdc = round(actualRebalanceUsdc + actualHedgeUsdc) || 0;
  const attemptedSpendUsdc = round(attemptedRebalanceUsdc + attemptedHedgeUsdc) || 0;

  const replay = {
    id: actionKey,
    timestamp: toIso(entry.timestamp),
    status: normalizeText(entry.status),
    code: normalizeText(entry.code),
    message: normalizeText(entry.message),
    idempotencyKey: normalizeText(details.idempotencyKey),
    requiresManualReview: Boolean(details.requiresManualReview),
    mode: normalizeText(details.mode),
    modeled: {
      plannedRebalanceUsdc: toNumberOrNull(model.plannedRebalanceUsdc),
      plannedHedgeUsdc: toNumberOrNull(model.plannedHedgeUsdc),
      plannedSpendUsdc: toNumberOrNull(model.plannedSpendUsdc),
      rebalanceSide: normalizeText(model.rebalanceSide),
      hedgeTokenSide: normalizeText(model.hedgeTokenSide),
      hedgeOrderSide: normalizeText(model.hedgeOrderSide),
      hedgeExecutionMode: normalizeText(model.hedgeExecutionMode),
      reserveSource: normalizeText(model.reserveSource),
      rebalanceSizingMode: normalizeText(model.rebalanceSizingMode),
      rebalanceTargetUsdc: toNumberOrNull(model.rebalanceTargetUsdc),
    },
    actual: {
      rebalanceSide: collectDistinctValue(
        legs.filter((leg) => leg.classification === 'pandora-rebalance' && !leg.failed),
        'rebalanceSide',
      ),
      hedgeTokenSide: collectDistinctValue(
        legs.filter((leg) => leg.classification === 'polymarket-hedge' && !leg.failed),
        'hedgeTokenSide',
      ),
      hedgeOrderSide: collectDistinctValue(
        legs.filter((leg) => leg.classification === 'polymarket-hedge' && !leg.failed),
        'hedgeOrderSide',
      ),
      rebalanceUsdc: actualRebalanceUsdc,
      hedgeUsdc: actualHedgeUsdc,
      spendUsdc: actualSpendUsdc,
      attemptedRebalanceUsdc,
      attemptedHedgeUsdc,
      attemptedSpendUsdc,
    },
    variance: {
      rebalanceUsdc:
        toNumberOrNull(model.plannedRebalanceUsdc) === null
          ? null
          : round(actualRebalanceUsdc - Number(model.plannedRebalanceUsdc)),
      hedgeUsdc:
        toNumberOrNull(model.plannedHedgeUsdc) === null
          ? null
          : round(actualHedgeUsdc - Number(model.plannedHedgeUsdc)),
      spendUsdc:
        toNumberOrNull(model.plannedSpendUsdc) === null
          ? null
          : round(actualSpendUsdc - Number(model.plannedSpendUsdc)),
    },
    failedLegCount: legs.filter((leg) => leg.failed).length,
    legs,
  };
  replay.verdict = deriveVerdict(replay);
  replay.sideMismatch = hasSideMismatch(replay);
  return replay;
}

function buildMirrorReplayPayload(params = {}) {
  const audit = params.audit && typeof params.audit === 'object' ? params.audit : {};
  const ledger = audit.ledger && typeof audit.ledger === 'object' ? audit.ledger : {};
  const entries = Array.isArray(ledger.entries) ? ledger.entries : [];
  const actions = [];
  const diagnostics = [];
  const ignoredClassifications = new Set();
  const currentDiagnostics = Array.isArray(params.diagnostics) ? params.diagnostics : [];
  for (const diagnostic of currentDiagnostics.concat(Array.isArray(audit.diagnostics) ? audit.diagnostics : [])) {
    const normalized = normalizeText(diagnostic);
    if (normalized && !diagnostics.includes(normalized)) diagnostics.push(normalized);
  }

  let current = null;
  entries
    .slice()
    .sort((left, right) => {
      const leftTime = Date.parse(String((left && left.timestamp) || '')) || 0;
      const rightTime = Date.parse(String((right && right.timestamp) || '')) || 0;
      return leftTime - rightTime;
    })
    .forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return;
      if (entry.classification === 'sync-action') {
        if (current) {
          actions.push(buildReplayAction(current.entry, current.legs, current.key));
        }
        current = {
          key: buildActionGroupKey(entry, index),
          entry,
          legs: [],
        };
        return;
      }
      if (!current) return;
      if (entry.classification === 'pandora-rebalance' || entry.classification === 'polymarket-hedge') {
        current.legs.push(normalizeLeg(entry));
        return;
      }
      if (entry.classification && entry.classification !== 'runtime-alert') {
        ignoredClassifications.add(String(entry.classification));
      }
    });

  if (current) {
    actions.push(buildReplayAction(current.entry, current.legs, current.key));
  }
  if (ignoredClassifications.size) {
    diagnostics.push(`Replay ignored non-execution ledger classifications: ${Array.from(ignoredClassifications).sort().join(', ')}`);
  }

  const summary = {
    actionCount: actions.length,
    modeledActionCount: actions.filter((item) => item.modeled.plannedSpendUsdc !== null).length,
    matchedModelCount: actions.filter((item) => item.verdict === 'matched-model').length,
    deviatedCount: actions.filter((item) => item.verdict === 'deviated-from-model').length,
    failedCount: actions.filter((item) => item.verdict === 'execution-failed').length,
    actualOnlyCount: actions.filter((item) => item.verdict === 'actual-only').length,
    sideMismatchCount: actions.filter((item) => item.sideMismatch).length,
    totalPlannedSpendUsdc: round(actions.reduce((total, item) => total + (item.modeled.plannedSpendUsdc || 0), 0)) || 0,
    totalActualSpendUsdc: round(actions.reduce((total, item) => total + (item.actual.spendUsdc || 0), 0)) || 0,
    totalAttemptedSpendUsdc: round(actions.reduce((total, item) => total + (item.actual.attemptedSpendUsdc || 0), 0)) || 0,
  };
  summary.totalSpendVarianceUsdc = round(summary.totalActualSpendUsdc - summary.totalPlannedSpendUsdc) || 0;

  return {
    schemaVersion: MIRROR_REPLAY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    stateFile: audit.stateFile || null,
    strategyHash: audit.strategyHash || null,
    selector: audit.selector || null,
    ledger: {
      source: ledger.source || null,
      entryCount: entries.length,
    },
    summary,
    actions: actions.slice().reverse(),
    diagnostics,
  };
}

module.exports = {
  MIRROR_REPLAY_SCHEMA_VERSION,
  buildMirrorReplayPayload,
};
