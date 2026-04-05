const MIRROR_REPLAY_SCHEMA_VERSION = '1.0.0';
const KNOWN_LEDGER_CLASSIFICATIONS = new Set([
  'sync-action',
  'pandora-rebalance',
  'polymarket-hedge',
  'runtime-alert',
]);

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

function compareStableStrings(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  return a === b ? 0 : (a < b ? -1 : 1);
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

function computeDurationMs(startIso, endIso) {
  const start = Date.parse(String(startIso || ''));
  const end = Date.parse(String(endIso || ''));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

function buildEntryLineage(entry = {}, ledgerIndex = null, groupKey = null) {
  const details = entry && entry.details && typeof entry.details === 'object' ? entry.details : {};
  const directTxHash = firstDefined(details.txHash, details.transactionHash, entry.txHash);
  const transactionRef = normalizeText(details.transactionRef);
  return {
    ledgerIndex,
    groupKey,
    classification: normalizeText(entry.classification),
    timestamp: toIso(entry.timestamp),
    source: normalizeText(entry.source),
    venue: normalizeText(entry.venue),
    status: normalizeText(entry.status),
    code: normalizeText(entry.code),
    message: normalizeText(entry.message),
    eventId: normalizeText(firstDefined(details.eventId, details.actionId, details.id, entry.eventId, entry.id)),
    idempotencyKey: normalizeText(details.idempotencyKey),
    transactionRef,
    txHash: isLikelyTxHash(directTxHash) ? normalizeText(directTxHash) : (isLikelyTxHash(transactionRef) ? transactionRef : null),
  };
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
    normalizeText(firstDefined(details.eventId, details.actionId, details.id)) || normalizeText(details.idempotencyKey) || `group-${index}`,
    normalizeText(entry.timestamp) || '',
    normalizeText(entry.status) || '',
  ].join('|');
}

function normalizeLeg(entry = {}, lineage = {}) {
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
    lineage: lineage && typeof lineage === 'object'
      ? {
        ledgerIndex: Number.isInteger(lineage.ledgerIndex) ? lineage.ledgerIndex : null,
        groupKey: normalizeText(lineage.groupKey),
        actionIndex: Number.isInteger(lineage.actionIndex) ? lineage.actionIndex : null,
        positionInAction: Number.isInteger(lineage.positionInAction) ? lineage.positionInAction : null,
        classification: normalizeText(lineage.classification),
        timestamp: toIso(lineage.timestamp),
        source: normalizeText(lineage.source),
        eventId: normalizeText(lineage.eventId),
        txHash: isLikelyTxHash(lineage.txHash) ? normalizeText(lineage.txHash) : null,
      }
      : null,
  };
}

function sumLegMetric(legs, metricName, includeFailures) {
  const total = (Array.isArray(legs) ? legs : [])
    .filter((leg) => includeFailures || !leg.failed)
    .reduce((sum, leg) => sum + (toNumberOrNull(leg && leg[metricName]) || 0), 0);
  return round(total) || 0;
}

function sumLegAmounts(legs, classification, includeFailures) {
  const total = (Array.isArray(legs) ? legs : [])
    .filter((leg) => leg.classification === classification)
    .filter((leg) => includeFailures || !leg.failed)
    .reduce((sum, leg) => sum + (toNumberOrNull(leg.amountUsdc) || 0), 0);
  return round(total) || 0;
}

function summarizeLineageEntries(entries = []) {
  const normalized = Array.isArray(entries) ? entries : [];
  const ledgerIndexes = normalized
    .map((entry) => Number.isInteger(entry.ledgerIndex) ? entry.ledgerIndex : null)
    .filter((value) => Number.isInteger(value));
  const classifications = [];
  const eventIds = [];
  const sources = [];
  const unknownClassifications = [];
  const runtimeAlertIndexes = [];
  for (const entry of normalized) {
    pushUniqueText(classifications, entry && entry.classification);
    pushUniqueText(eventIds, entry && entry.eventId);
    pushUniqueText(sources, entry && entry.source);
    if (entry && entry.classification && !KNOWN_LEDGER_CLASSIFICATIONS.has(entry.classification)) {
      unknownClassifications.push(entry.classification);
    }
    if (entry && entry.classification === 'runtime-alert' && Number.isInteger(entry.ledgerIndex)) {
      runtimeAlertIndexes.push(entry.ledgerIndex);
    }
  }
  const first = normalized[0] || null;
  const last = normalized[normalized.length - 1] || null;
  return {
    entryCount: normalized.length,
    ledgerIndexes,
    firstLedgerIndex: ledgerIndexes.length ? ledgerIndexes[0] : null,
    lastLedgerIndex: ledgerIndexes.length ? ledgerIndexes[ledgerIndexes.length - 1] : null,
    classifications,
    eventIds,
    sourceSequence: sources,
    firstTimestamp: first ? first.timestamp || null : null,
    lastTimestamp: last ? last.timestamp || null : null,
    firstSource: first ? first.source || null : null,
    lastSource: last ? last.source || null : null,
    firstEventId: first ? first.eventId || null : null,
    lastEventId: last ? last.eventId || null : null,
    unknownClassifications,
    unknownClassificationCount: unknownClassifications.length,
    runtimeAlertIndexes,
    runtimeAlertCount: runtimeAlertIndexes.length,
  };
}

function buildCostSummary(legs = []) {
  const actualFeeUsdc = sumLegMetric(legs, 'feeUsdc', false);
  const actualGasUsdc = sumLegMetric(legs, 'gasUsdc', false);
  const attemptedFeeUsdc = sumLegMetric(legs, 'feeUsdc', true);
  const attemptedGasUsdc = sumLegMetric(legs, 'gasUsdc', true);
  const actualCostUsdc = round(actualFeeUsdc + actualGasUsdc) || 0;
  const attemptedCostUsdc = round(attemptedFeeUsdc + attemptedGasUsdc) || 0;
  return {
    actualFeeUsdc,
    actualGasUsdc,
    attemptedFeeUsdc,
    attemptedGasUsdc,
    actualCostUsdc,
    attemptedCostUsdc,
  };
}

function buildFillRatio(actualValue, modeledValue) {
  const actual = toNumberOrNull(actualValue);
  const modeled = toNumberOrNull(modeledValue);
  if (actual === null || modeled === null || modeled === 0) return null;
  return round(actual / modeled, 6);
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

function buildReplayAction(current = {}, actionIndex = 0) {
  const entry = current && current.entry && typeof current.entry === 'object' ? current.entry : {};
  const details = entry && entry.details && typeof entry.details === 'object' ? entry.details : {};
  const model = details.model && typeof details.model === 'object' ? details.model : details;
  const lineageEntries = Array.isArray(current.lineageEntries) ? current.lineageEntries.slice() : [];
  const unknownEntries = Array.isArray(current.unknownEntries) ? current.unknownEntries.slice() : [];
  const runtimeAlertEntries = Array.isArray(current.runtimeAlertEntries) ? current.runtimeAlertEntries.slice() : [];
  const legs = (Array.isArray(current.legs) ? current.legs : []).map((leg, index) => ({
    ...leg,
    lineage: leg && leg.lineage && typeof leg.lineage === 'object'
      ? {
        ...leg.lineage,
        actionIndex,
        groupKey: normalizeText(current.key),
        positionInAction: index + 1,
      }
      : {
        ledgerIndex: null,
        groupKey: normalizeText(current.key),
        actionIndex,
        positionInAction: index + 1,
        classification: normalizeText(leg && leg.classification),
        timestamp: normalizeText(leg && leg.timestamp),
        source: normalizeText(leg && leg.source),
        eventId: null,
        txHash: null,
      },
  }));
  const lineageSummary = summarizeLineageEntries(lineageEntries);
  const cost = buildCostSummary(legs);
  const attemptedRebalanceUsdc = sumLegAmounts(legs, 'pandora-rebalance', true);
  const attemptedHedgeUsdc = sumLegAmounts(legs, 'polymarket-hedge', true);
  const actualRebalanceUsdc = sumLegAmounts(legs, 'pandora-rebalance', false);
  const actualHedgeUsdc = sumLegAmounts(legs, 'polymarket-hedge', false);
  const actualSpendUsdc = round(actualRebalanceUsdc + actualHedgeUsdc) || 0;
  const attemptedSpendUsdc = round(attemptedRebalanceUsdc + attemptedHedgeUsdc) || 0;
  const durationMs = computeDurationMs(lineageSummary.firstTimestamp, lineageSummary.lastTimestamp);
  const unknownLabels = lineageSummary.unknownClassifications
    .map((classification, index) => {
      const entryAtIndex = unknownEntries[index];
      const ledgerIndex = entryAtIndex && Number.isInteger(entryAtIndex.ledgerIndex) ? entryAtIndex.ledgerIndex : null;
      return ledgerIndex === null ? classification : `${classification}@${ledgerIndex}`;
    });
  const replay = {
    id: normalizeText(current.key),
    timestamp: toIso(entry.timestamp),
    status: normalizeText(entry.status),
    code: normalizeText(entry.code),
    message: normalizeText(entry.message),
    idempotencyKey: normalizeText(details.idempotencyKey),
    requiresManualReview: Boolean(details.requiresManualReview),
    mode: normalizeText(details.mode),
    lineage: {
      actionIndex,
      groupKey: normalizeText(current.key),
      syncAction: current.syncLineage ? { ...current.syncLineage } : null,
      actionId: current.syncLineage
        ? normalizeText(firstDefined(current.syncLineage.eventId, current.syncLineage.idempotencyKey, current.key))
        : normalizeText(current.key),
      actionEventId: current.syncLineage ? normalizeText(current.syncLineage.eventId) : null,
      entryCount: lineageSummary.entryCount,
      ledgerIndexes: lineageSummary.ledgerIndexes,
      firstLedgerIndex: lineageSummary.firstLedgerIndex,
      lastLedgerIndex: lineageSummary.lastLedgerIndex,
      classifications: lineageSummary.classifications,
      eventIds: lineageSummary.eventIds,
      sourceSequence: lineageSummary.sourceSequence,
      firstTimestamp: lineageSummary.firstTimestamp,
      lastTimestamp: lineageSummary.lastTimestamp,
      durationMs,
      firstSource: lineageSummary.firstSource,
      lastSource: lineageSummary.lastSource,
      firstEventId: lineageSummary.firstEventId,
      lastEventId: lineageSummary.lastEventId,
      unknownClassificationCount: lineageSummary.unknownClassificationCount,
      unknownClassifications: unknownLabels,
      unknownLedgerIndexes: unknownEntries
        .map((item) => (Number.isInteger(item.ledgerIndex) ? item.ledgerIndex : null))
        .filter((value) => Number.isInteger(value)),
      runtimeAlertCount: runtimeAlertEntries.length,
      runtimeAlertLedgerIndexes: lineageSummary.runtimeAlertIndexes,
    },
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
      actualFeeUsdc: cost.actualFeeUsdc,
      actualGasUsdc: cost.actualGasUsdc,
      attemptedFeeUsdc: cost.attemptedFeeUsdc,
      attemptedGasUsdc: cost.attemptedGasUsdc,
      actualCostUsdc: cost.actualCostUsdc,
      attemptedCostUsdc: cost.attemptedCostUsdc,
      netActualSpendUsdc: round(actualSpendUsdc + cost.actualCostUsdc) || 0,
      netAttemptedSpendUsdc: round(attemptedSpendUsdc + cost.attemptedCostUsdc) || 0,
    },
    metrics: {
      durationMs,
      rebalanceFillRatio: buildFillRatio(actualRebalanceUsdc, model.plannedRebalanceUsdc),
      hedgeFillRatio: buildFillRatio(actualHedgeUsdc, model.plannedHedgeUsdc),
      spendFillRatio: buildFillRatio(actualSpendUsdc, model.plannedSpendUsdc),
      actualFeeUsdc: cost.actualFeeUsdc,
      actualGasUsdc: cost.actualGasUsdc,
      attemptedFeeUsdc: cost.attemptedFeeUsdc,
      attemptedGasUsdc: cost.attemptedGasUsdc,
      actualCostUsdc: cost.actualCostUsdc,
      attemptedCostUsdc: cost.attemptedCostUsdc,
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
    successfulLegCount: legs.filter((leg) => !leg.failed).length,
    unknownClassifications: unknownLabels,
    legs,
  };
  replay.verdict = deriveVerdict(replay);
  replay.sideMismatch = hasSideMismatch(replay);
  if (unknownLabels.length) {
    replay.diagnostics = [
      `Replay action ${replay.id} includes ${unknownLabels.length} unknown ledger row(s): ${unknownLabels.join(', ')}`,
    ];
  } else if (runtimeAlertEntries.length) {
    replay.diagnostics = [
      `Replay action ${replay.id} includes ${runtimeAlertEntries.length} runtime-alert ledger row(s).`,
    ];
  } else {
    replay.diagnostics = [];
  }
  return replay;
}

function buildMirrorReplayPayload(params = {}) {
  const audit = params.audit && typeof params.audit === 'object' ? params.audit : {};
  const ledger = audit.ledger && typeof audit.ledger === 'object' ? audit.ledger : {};
  const entries = Array.isArray(ledger.entries) ? ledger.entries : [];
  const actions = [];
  const diagnostics = [];
  const unknownClassificationMap = new Map();
  const classificationCounts = new Map();
  const orphanEntries = [];
  const orphanUnknownEntries = [];
  const orphanRuntimeAlertEntries = [];
  const currentDiagnostics = Array.isArray(params.diagnostics) ? params.diagnostics : [];
  for (const diagnostic of currentDiagnostics.concat(Array.isArray(audit.diagnostics) ? audit.diagnostics : [])) {
    const normalized = normalizeText(diagnostic);
    if (normalized && !diagnostics.includes(normalized)) diagnostics.push(normalized);
  }

  const sortedEntries = entries
    .map((entry, index) => ({
      entry,
      ledgerIndex: index,
      timestamp: Date.parse(String((entry && entry.timestamp) || '')) || 0,
    }))
    .sort((left, right) => {
      if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
      return left.ledgerIndex - right.ledgerIndex;
    });

  let current = null;
  let syncActionCount = 0;
  let executionEntryCount = 0;
  let runtimeAlertCount = 0;
  const recordUnknown = (lineageEntry, bucket) => {
    if (!lineageEntry) return;
    const classification = lineageEntry.classification || 'unknown';
    if (!unknownClassificationMap.has(classification)) {
      unknownClassificationMap.set(classification, []);
    }
    unknownClassificationMap.get(classification).push(lineageEntry.ledgerIndex);
    if (bucket === 'orphan') {
      orphanUnknownEntries.push(lineageEntry);
    } else if (current && Array.isArray(current.unknownEntries)) {
      current.unknownEntries.push(lineageEntry);
    }
  };

  const finalizeCurrent = () => {
    if (!current) return;
    actions.push(buildReplayAction(current, actions.length));
    current = null;
  };

  for (const { entry, ledgerIndex } of sortedEntries) {
    if (!entry || typeof entry !== 'object') continue;
    const classification = normalizeText(entry.classification);
    const lineageEntry = buildEntryLineage(entry, ledgerIndex, current ? current.key : null);
    const normalizedClassification = classification || 'unknown';
    const classificationCount = classificationCounts.get(normalizedClassification) || 0;
    classificationCounts.set(normalizedClassification, classificationCount + 1);

    if (classification === 'sync-action') {
      finalizeCurrent();
      syncActionCount += 1;
      const actionKey = buildActionGroupKey(entry, ledgerIndex);
      current = {
        key: actionKey,
        entry,
        syncLineage: {
          ...lineageEntry,
          groupKey: actionKey,
        },
        lineageEntries: [{
          ...lineageEntry,
          groupKey: actionKey,
        }],
        legs: [],
        unknownEntries: [],
        runtimeAlertEntries: [],
      };
      continue;
    }

    if (!current) {
      orphanEntries.push(lineageEntry);
      if (classification === 'runtime-alert') {
        orphanRuntimeAlertEntries.push(lineageEntry);
        runtimeAlertCount += 1;
      } else if (!KNOWN_LEDGER_CLASSIFICATIONS.has(normalizedClassification)) {
        recordUnknown(lineageEntry, 'orphan');
      }
      continue;
    }

    current.lineageEntries.push(lineageEntry);

    if (classification === 'pandora-rebalance' || classification === 'polymarket-hedge') {
      executionEntryCount += 1;
      current.legs.push(normalizeLeg(entry, {
        ...lineageEntry,
        actionIndex: actions.length,
        positionInAction: current.legs.length + 1,
      }));
      continue;
    }

    if (classification === 'runtime-alert') {
      runtimeAlertCount += 1;
      current.runtimeAlertEntries.push(lineageEntry);
      continue;
    }

    if (!KNOWN_LEDGER_CLASSIFICATIONS.has(normalizedClassification)) {
      recordUnknown(lineageEntry, 'current');
    }
  }

  finalizeCurrent();

  if (orphanEntries.length) {
    const orphanLabels = orphanEntries
      .map((entry) => {
        const label = entry.classification || 'unknown';
        return entry.ledgerIndex === null || entry.ledgerIndex === undefined ? label : `${label}@${entry.ledgerIndex}`;
      });
    diagnostics.push(`Replay found ${orphanEntries.length} orphan ledger row(s) before the first sync-action: ${orphanLabels.join(', ')}`);
  }
  if (orphanUnknownEntries.length) {
    const orphanLabels = orphanUnknownEntries
      .map((entry) => {
        const label = entry.classification || 'unknown';
        return entry.ledgerIndex === null || entry.ledgerIndex === undefined ? label : `${label}@${entry.ledgerIndex}`;
      });
    diagnostics.push(`Replay found ${orphanUnknownEntries.length} unknown orphan ledger row(s): ${orphanLabels.join(', ')}`);
  }
  if (unknownClassificationMap.size) {
    const labels = Array.from(unknownClassificationMap.entries())
      .sort((left, right) => compareStableStrings(left[0], right[0]))
      .map(([classification, ledgerIndexes]) => ledgerIndexes.map((ledgerIndex) => `${classification}@${ledgerIndex}`).join(', '))
      .join('; ');
    diagnostics.push(`Replay observed ${Array.from(unknownClassificationMap.values()).reduce((total, ledgerIndexes) => total + ledgerIndexes.length, 0)} unknown ledger classification row(s): ${labels}`);
  }
  if (orphanRuntimeAlertEntries.length) {
    diagnostics.push(`Replay found ${orphanRuntimeAlertEntries.length} runtime-alert row(s) before the first sync-action.`);
  }

  const actionDurations = actions
    .map((item) => Number(item.metrics && item.metrics.durationMs))
    .filter((value) => Number.isFinite(value));
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
    totalActualFeeUsdc: round(actions.reduce((total, item) => total + (item.actual.actualFeeUsdc || 0), 0)) || 0,
    totalActualGasUsdc: round(actions.reduce((total, item) => total + (item.actual.actualGasUsdc || 0), 0)) || 0,
    totalAttemptedFeeUsdc: round(actions.reduce((total, item) => total + (item.actual.attemptedFeeUsdc || 0), 0)) || 0,
    totalAttemptedGasUsdc: round(actions.reduce((total, item) => total + (item.actual.attemptedGasUsdc || 0), 0)) || 0,
    totalActualCostUsdc: round(actions.reduce((total, item) => total + (item.actual.actualCostUsdc || 0), 0)) || 0,
    totalAttemptedCostUsdc: round(actions.reduce((total, item) => total + (item.actual.attemptedCostUsdc || 0), 0)) || 0,
    averageActionDurationMs: actionDurations.length ? round(actionDurations.reduce((total, value) => total + value, 0) / actionDurations.length) || 0 : 0,
    maxActionDurationMs: actionDurations.length ? Math.max(...actionDurations) : 0,
    unknownClassificationCount: Array.from(unknownClassificationMap.values()).reduce((total, ledgerIndexes) => total + ledgerIndexes.length, 0),
    unknownClassificationTypes: Array.from(new Set([
      ...Array.from(unknownClassificationMap.keys()),
      ...orphanUnknownEntries.map((entry) => entry.classification || 'unknown'),
    ])).sort(compareStableStrings),
    runtimeAlertCount,
    orphanEntryCount: orphanEntries.length,
    syncActionCount,
    executionEntryCount,
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
      syncActionCount,
      executionEntryCount,
      runtimeAlertCount,
      unknownEntryCount: summary.unknownClassificationCount,
      classificationCounts: Object.fromEntries(
        Array.from(classificationCounts.entries()).sort((left, right) => compareStableStrings(left[0], right[0])),
      ),
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
