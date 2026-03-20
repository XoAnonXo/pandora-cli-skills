const {
  normalizeText,
  normalizeLowerText,
  firstDefined,
  toNumberOrNull,
  roundMirrorHedgeNumber,
  normalizeMirrorHedgeAddress,
  normalizeMirrorHedgeVenue,
  normalizeMirrorHedgeMarketType,
  normalizeMirrorHedgeOrderSide,
  normalizeMirrorHedgeTokenSide,
  normalizeMirrorHedgeTradeLike,
  isPolymarketVenue,
  buildMirrorHedgeEventKey,
  normalizeMirrorHedgeTimestamp,
} = require('./events.cjs');

function normalizeAddressList(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const output = new Set();
  for (const item of values) {
    const normalized = normalizeMirrorHedgeAddress(item);
    if (normalized) output.add(normalized);
  }
  return Array.from(output);
}

function normalizeTradeAmount(trade) {
  const requestedUsdc = roundMirrorHedgeNumber(
    Math.max(
      0,
      toNumberOrNull(firstDefined(trade && trade.amountUsdc, trade && trade.notionalUsdc, trade && trade.notional)) || 0,
    ),
    6,
  ) || 0;
  const requestedShares = roundMirrorHedgeNumber(
    Math.max(0, toNumberOrNull(firstDefined(trade && trade.amountShares, trade && trade.quantityShares, trade && trade.quantity)) || 0),
    6,
  ) || 0;
  return {
    requestedUsdc,
    requestedShares,
  };
}

function normalizeWalletCandidates(trade) {
  return [
    trade && trade.walletAddress,
    trade && trade.from,
    trade && trade.sourceWalletAddress,
    trade && trade.originWalletAddress,
    trade && trade.ownerAddress,
    trade && trade.accountAddress,
    trade && trade.traderAddress,
    trade && trade.initiatorAddress,
  ]
    .map(normalizeMirrorHedgeAddress)
    .filter(Boolean);
}

function shouldSkipInternalWallet(tradeLike, options = {}) {
  const trade = normalizeMirrorHedgeTradeLike(tradeLike, options);
  const internalWallets = new Set(
    normalizeAddressList(
      firstDefined(options.internalWallets, options.internalWalletAddress, options.internalWallet, options.wallets),
    ),
  );
  if (!internalWallets.size) {
    return {
      skipped: false,
      reasonCode: null,
      reason: null,
      matchedWallet: null,
      trade,
    };
  }
  const matchedWallet = normalizeWalletCandidates(trade).find((candidate) => internalWallets.has(candidate)) || null;
  if (!matchedWallet) {
    return {
      skipped: false,
      reasonCode: null,
      reason: null,
      matchedWallet: null,
      trade,
    };
  }
  return {
    skipped: true,
    reasonCode: 'internal-wallet',
    reason: 'Trade originated from an internal wallet and is excluded from hedge mutation.',
    matchedWallet,
    trade,
  };
}

function evaluateMinHedgeSkip(tradeLike, options = {}) {
  const trade = normalizeMirrorHedgeTradeLike(tradeLike, options);
  const amounts = normalizeTradeAmount(trade);
  const minHedgeUsdc = Math.max(0, toNumberOrNull(firstDefined(options.minHedgeUsdc, options.hedgeTriggerUsdc)) || 0);
  const minHedgeShares = Math.max(0, toNumberOrNull(options.minHedgeShares) || 0);
  const belowUsdc = minHedgeUsdc > 0 && amounts.requestedUsdc < minHedgeUsdc;
  const belowShares = minHedgeShares > 0 && amounts.requestedShares < minHedgeShares;
  if (!belowUsdc && !belowShares) {
    return {
      skipped: false,
      reasonCode: null,
      reason: null,
      trade,
      amounts,
    };
  }
  return {
    skipped: true,
    reasonCode: 'min-hedge',
    reason: 'Trade notional is below the configured hedge minimum.',
    thresholdUsdc: minHedgeUsdc || null,
    thresholdShares: minHedgeShares || null,
    trade,
    amounts,
  };
}

function resolveDepthCandidates(depth, tokenSide, orderSide) {
  if (!depth || typeof depth !== 'object') return [];
  const side = normalizeMirrorHedgeTokenSide(tokenSide);
  const order = normalizeMirrorHedgeOrderSide(orderSide);
  const entries = [];
  if (side === 'yes' && order === 'buy') entries.push(depth.buyYesDepth, depth.yesBuyDepth, depth.yesDepth);
  if (side === 'yes' && order === 'sell') entries.push(depth.sellYesDepth, depth.yesSellDepth, depth.sellDepth, depth.yesDepth);
  if (side === 'no' && order === 'buy') entries.push(depth.buyNoDepth, depth.noBuyDepth, depth.noDepth);
  if (side === 'no' && order === 'sell') entries.push(depth.sellNoDepth, depth.noSellDepth, depth.sellDepth, depth.noDepth);
  if (!entries.length) entries.push(depth.buyDepth, depth.sellDepth, depth.yesDepth, depth.noDepth);
  return entries.filter((entry) => entry && typeof entry === 'object');
}

function resolveDepthReferencePrice(depthEntry) {
  if (!depthEntry || typeof depthEntry !== 'object') return null;
  const referencePrice = toNumberOrNull(firstDefined(depthEntry.referencePrice, depthEntry.midPrice, depthEntry.worstPrice));
  if (referencePrice !== null && referencePrice > 0) return referencePrice;
  return null;
}

function resolveDepthCapacity(depthEntry) {
  if (!depthEntry || typeof depthEntry !== 'object') return null;
  const explicitShares = toNumberOrNull(firstDefined(depthEntry.depthShares, depthEntry.availableShares, depthEntry.fillableShares));
  if (explicitShares !== null) return Math.max(0, explicitShares);
  const explicitUsd = toNumberOrNull(firstDefined(depthEntry.depthUsd, depthEntry.availableUsd, depthEntry.fillableUsd));
  const referencePrice = resolveDepthReferencePrice(depthEntry);
  if (explicitUsd !== null && referencePrice !== null && referencePrice > 0) {
    return Math.max(0, roundMirrorHedgeNumber(explicitUsd / referencePrice, 6) || 0);
  }
  return null;
}

function evaluateDepthCheck(tradeLike, depth, options = {}) {
  const trade = normalizeMirrorHedgeTradeLike(tradeLike, options);
  const amounts = normalizeTradeAmount(trade);
  const depthEntry = resolveDepthCandidates(depth, trade.tokenSide, trade.orderSide)[0] || null;
  const referencePrice = resolveDepthReferencePrice(depthEntry);
  const depthShares = resolveDepthCapacity(depthEntry);
  const depthUsd = toNumberOrNull(firstDefined(depthEntry && depthEntry.depthUsd, depthEntry && depthEntry.availableUsd, depthEntry && depthEntry.fillableUsd));
  const capacityUsdc =
    depthUsd !== null
      ? Math.max(0, depthUsd)
      : depthShares !== null && referencePrice !== null
        ? Math.max(0, roundMirrorHedgeNumber(depthShares * referencePrice, 6) || 0)
        : null;
  const requestedUsdc = amounts.requestedUsdc;
  const requestedShares = amounts.requestedShares;
  const fillableUsdc =
    capacityUsdc === null
      ? null
      : Math.max(0, Math.min(requestedUsdc > 0 ? requestedUsdc : Number.POSITIVE_INFINITY, capacityUsdc));
  const fillableShares =
    depthShares === null
      ? null
      : Math.max(0, Math.min(requestedShares > 0 ? requestedShares : Number.POSITIVE_INFINITY, depthShares));
  let status = 'unavailable';
  if (depthEntry) {
    if ((fillableUsdc === null && fillableShares === null) || (capacityUsdc === null && depthShares === null)) {
      status = 'unavailable';
    } else if (
      (fillableUsdc !== null && requestedUsdc > 0 && fillableUsdc >= requestedUsdc)
      || (fillableShares !== null && requestedShares > 0 && fillableShares >= requestedShares)
    ) {
      status = 'sufficient';
    } else {
      status = 'partial';
    }
  }
  const residualUsdc =
    status === 'partial' && requestedUsdc > 0 && fillableUsdc !== null ? roundMirrorHedgeNumber(Math.max(0, requestedUsdc - fillableUsdc), 6) || 0 : 0;
  return {
    trade,
    orderSide: trade.orderSide,
    tokenSide: trade.tokenSide,
    requestedUsdc,
    requestedShares,
    depthEntry,
    referencePrice,
    depthShares,
    capacityUsdc,
    fillableUsdc,
    fillableShares,
    residualUsdc,
    status,
    depthKnown: Boolean(depthEntry),
    depthProofRequired: Boolean(options.requireDepthProof),
    allowed: status !== 'unavailable' || !options.requireDepthProof,
  };
}

function evaluateFeeRevenueGate(tradeLike, options = {}) {
  const trade = normalizeMirrorHedgeTradeLike(tradeLike, options);
  const feeUsdc = Math.max(
    0,
    roundMirrorHedgeNumber(
      (toNumberOrNull(trade.feeUsdc) || 0)
      + (toNumberOrNull(trade.gasUsdc) || 0)
      + (toNumberOrNull(options.extraFeeUsdc) || 0),
      6,
    ) || 0,
  );
  const revenueUsdc = toNumberOrNull(firstDefined(trade.expectedRevenueUsdc, trade.revenueUsdc, trade.edgeUsdc, options.expectedRevenueUsdc, options.revenueUsdc));
  const minNetUsdc = Math.max(0, toNumberOrNull(options.minNetUsdc) || 0);
  if (revenueUsdc === null) {
    return {
      passed: true,
      reasonCode: null,
      reason: null,
      feeUsdc,
      revenueUsdc,
      netUsdc: null,
      trade,
    };
  }
  const netUsdc = roundMirrorHedgeNumber(revenueUsdc - feeUsdc, 6);
  if (netUsdc !== null && netUsdc >= minNetUsdc) {
    return {
      passed: true,
      reasonCode: null,
      reason: null,
      feeUsdc,
      revenueUsdc,
      netUsdc,
      trade,
    };
  }
  return {
    passed: false,
    reasonCode: 'fee-vs-revenue',
    reason: 'Expected execution fee exceeds the expected revenue edge.',
    feeUsdc,
    revenueUsdc,
    netUsdc,
    trade,
  };
}

function evaluatePartialVsSkipPolicy(tradeLike, depthCheck, options = {}) {
  const trade = normalizeMirrorHedgeTradeLike(tradeLike, options);
  const requestedUsdc = Math.max(0, toNumberOrNull(depthCheck && depthCheck.requestedUsdc) || normalizeTradeAmount(trade).requestedUsdc || 0);
  const fillableUsdc = Math.max(0, toNumberOrNull(depthCheck && depthCheck.fillableUsdc) || 0);
  const residualUsdc = Math.max(0, roundMirrorHedgeNumber(requestedUsdc - fillableUsdc, 6) || 0);
  if (depthCheck && depthCheck.status === 'unavailable' && options.allowDepthlessExecution !== true) {
    return {
      status: 'skip',
      reasonCode: 'depth-unavailable',
      reason: 'Execution depth snapshot is unavailable and depthless execution is disabled.',
      requestedUsdc,
      fillableUsdc: 0,
      residualUsdc: requestedUsdc,
      allowedUsdc: 0,
      trade,
      partial: false,
    };
  }
  const partialPolicy = normalizeLowerText(firstDefined(options.partialPolicy, options.partialMode, options.partialExecutionPolicy));
  const allowPartial = options.allowPartialExecution !== false && partialPolicy !== 'skip';

  if (residualUsdc <= 0) {
    return {
      status: 'execute',
      reasonCode: null,
      reason: null,
      requestedUsdc,
      fillableUsdc,
      residualUsdc: 0,
      allowedUsdc: requestedUsdc,
      trade,
      partial: false,
    };
  }

  if (!allowPartial) {
    return {
      status: 'skip',
      reasonCode: 'partial-disabled',
      reason: 'Partial execution is disabled and the requested hedge cannot be fully filled.',
      requestedUsdc,
      fillableUsdc,
      residualUsdc,
      allowedUsdc: 0,
      trade,
      partial: false,
    };
  }

  return {
    status: 'partial',
    reasonCode: 'partial-fill',
    reason: 'Depth supports only a partial hedge fill.',
    requestedUsdc,
    fillableUsdc,
    residualUsdc,
    allowedUsdc: fillableUsdc,
    trade,
    partial: true,
  };
}

function evaluateDepthCheckedSellPolicy(tradeLike, depthCheck, options = {}) {
  const trade = normalizeMirrorHedgeTradeLike(tradeLike, options);
  if (normalizeMirrorHedgeOrderSide(trade.orderSide) !== 'sell') {
    return {
      enforced: false,
      passed: true,
      reasonCode: null,
      reason: null,
      trade,
    };
  }
  const requireSellDepthProof = options.requireSellDepthProof !== false;
  if (!requireSellDepthProof) {
    return {
      enforced: true,
      passed: true,
      reasonCode: null,
      reason: null,
      trade,
    };
  }
  if (!depthCheck || !depthCheck.depthKnown) {
    return {
      enforced: true,
      passed: false,
      reasonCode: 'sell-depth-unavailable',
      reason: 'Sell mutation requires a proven depth snapshot before execution.',
      trade,
    };
  }
  if (depthCheck.status === 'unavailable') {
    return {
      enforced: true,
      passed: false,
      reasonCode: 'sell-depth-unavailable',
      reason: 'Sell mutation requires a proven depth snapshot before execution.',
      trade,
    };
  }
  return {
    enforced: true,
    passed: true,
    reasonCode: null,
    reason: null,
    trade,
  };
}

function queueResidualExposure(tradeLike, policyResult, options = {}) {
  const trade = normalizeMirrorHedgeTradeLike(tradeLike, options);
  const residualUsdc = Math.max(
    0,
    toNumberOrNull(firstDefined(policyResult && policyResult.residualUsdc, policyResult && policyResult.remainingUsdc)) || 0,
  );
  if (!(residualUsdc > 0)) return null;
  return {
    schemaVersion: '1.0.0',
    kind: 'residual-exposure',
    status: 'queued',
    queuedAt: normalizeMirrorHedgeTimestamp(options.queuedAt || new Date()),
    venue: trade.venue,
    mutationVenue: normalizeMirrorHedgeVenue(firstDefined(options.mutationVenue, 'polymarket')),
    source: trade.source,
    sourceType: trade.sourceType,
    txHash: trade.txHash || null,
    canonicalKey: trade.canonicalKey || buildMirrorHedgeEventKey(trade),
    marketAddress: trade.marketAddress || null,
    marketId: trade.marketId || null,
    walletAddress: trade.walletAddress || null,
    tokenSide: trade.tokenSide || null,
    orderSide: trade.orderSide || null,
    direction: trade.direction || null,
    requestedUsdc: normalizeTradeAmount(trade).requestedUsdc,
    fillableUsdc: Math.max(0, toNumberOrNull(policyResult && policyResult.fillableUsdc) || 0),
    residualUsdc,
    reasonCode: normalizeText(policyResult && policyResult.reasonCode) || null,
    reason: normalizeText(policyResult && policyResult.reason) || null,
    policy: {
      partial: Boolean(policyResult && policyResult.partial),
      status: normalizeText(policyResult && policyResult.status) || null,
    },
    raw: trade.raw,
  };
}

function normalizeMempoolStatus(value, source = {}) {
  const normalized = normalizeLowerText(value);
  if (normalized) {
    if (normalized === 'confirmed' || normalized === 'success' || normalized === 'succeeded' || normalized === 'finalized') {
      return 'confirmed';
    }
    if (normalized === 'reverted' || normalized === 'revert' || normalized === 'failed' || normalized === 'error') {
      return 'reverted';
    }
    if (normalized === 'pending' || normalized === 'queued' || normalized === 'observed') {
      return 'pending';
    }
  }
  if (source && source.removed === true) return 'reverted';
  if (source && source.status !== undefined) {
    const status = normalizeLowerText(source.status);
    if (status === '0' || status === '0x0' || status === 'false') return 'reverted';
    if (status === '1' || status === '0x1' || status === 'true') return 'confirmed';
  }
  return 'unknown';
}

function reconcileMempoolConfirmRevert(record, observation, options = {}) {
  const trade = normalizeMirrorHedgeTradeLike(record, options);
  const source = observation && typeof observation === 'object' ? observation : {};
  const status = normalizeMempoolStatus(firstDefined(source.status, source.finality, source.state), source);
  const txHash = normalizeText(firstDefined(source.txHash, source.hash, trade.txHash));
  const receiptStatus = normalizeLowerText(firstDefined(source.receiptStatus, source.receipt && source.receipt.status));
  const confirmed = status === 'confirmed' || receiptStatus === 'success';
  const reverted = status === 'reverted' || receiptStatus === 'reverted';
  const residualUsdc = Math.max(
    0,
    toNumberOrNull(firstDefined(source.residualUsdc, source.remainingUsdc, record && record.residualUsdc, record && record.requestedUsdc)) || 0,
  );
  const shouldClearQueue = confirmed || reverted;
  const shouldRestoreResidualExposure = reverted && residualUsdc > 0;
  return {
    schemaVersion: '1.0.0',
    kind: 'mempool-reconciliation',
    txHash: txHash || null,
    canonicalKey: trade.canonicalKey || buildMirrorHedgeEventKey(trade),
    venue: trade.venue,
    mutationVenue: normalizeMirrorHedgeVenue(firstDefined(options.mutationVenue, 'polymarket')),
    status,
    confirmed,
    reverted,
    shouldClearQueue,
    shouldRestoreResidualExposure,
    residualUsdc: shouldRestoreResidualExposure ? residualUsdc : 0,
    queueKey: normalizeText(firstDefined(source.queueKey, trade.canonicalKey, trade.txHash)) || null,
    observedAt: normalizeMirrorHedgeTimestamp(firstDefined(source.observedAt, source.timestamp, options.observedAt, new Date())),
    confirmedAt: confirmed ? normalizeMirrorHedgeTimestamp(firstDefined(source.confirmedAt, source.blockTimestamp, source.timestamp, options.confirmedAt, new Date())) : null,
    revertedAt: reverted ? normalizeMirrorHedgeTimestamp(firstDefined(source.revertedAt, source.timestamp, options.revertedAt, new Date())) : null,
    trade,
    observation: source,
  };
}

function classifyMirrorHedgeExecution(input, options = {}) {
  const trade = normalizeMirrorHedgeTradeLike(input, options);
  const executionVenue = normalizeMirrorHedgeVenue(firstDefined(options.mutationVenue, trade.mutationVenue, 'polymarket'));
  const liveMutation = options.liveMutation !== false;
  if (liveMutation && !isPolymarketVenue(executionVenue)) {
    return {
      status: 'block',
      reasonCode: 'live-mutation-venue-not-allowed',
      reason: 'Live mutation is restricted to Polymarket.',
      trade,
      mutationVenue: executionVenue,
      liveMutation,
      guardrails: {
        venue: { passed: false, reasonCode: 'live-mutation-venue-not-allowed' },
      },
    };
  }

  const internalWallet = shouldSkipInternalWallet(trade, options);
  if (internalWallet.skipped) {
    return {
      status: 'skip',
      reasonCode: internalWallet.reasonCode,
      reason: internalWallet.reason,
      trade,
      mutationVenue: executionVenue,
      liveMutation,
      guardrails: { internalWallet },
    };
  }

  const minHedge = evaluateMinHedgeSkip(trade, options);
  if (minHedge.skipped) {
    return {
      status: 'skip',
      reasonCode: minHedge.reasonCode,
      reason: minHedge.reason,
      trade,
      mutationVenue: executionVenue,
      liveMutation,
      guardrails: { internalWallet, minHedge },
    };
  }

  const depthCheck = evaluateDepthCheck(trade, options.depth || options.orderbookDepth || {}, options);
  const sellPolicy = evaluateDepthCheckedSellPolicy(trade, depthCheck, options);
  if (!sellPolicy.passed) {
    return {
      status: 'skip',
      reasonCode: sellPolicy.reasonCode,
      reason: sellPolicy.reason,
      trade,
      mutationVenue: executionVenue,
      liveMutation,
      guardrails: { internalWallet, minHedge, depthCheck, sellPolicy },
    };
  }

  if (!depthCheck.depthKnown && options.allowDepthlessExecution !== true) {
    return {
      status: 'skip',
      reasonCode: 'depth-unavailable',
      reason: 'Execution depth snapshot is unavailable and depthless execution is disabled.',
      trade,
      mutationVenue: executionVenue,
      liveMutation,
      guardrails: { internalWallet, minHedge, depthCheck, sellPolicy },
    };
  }

  const feeGate = evaluateFeeRevenueGate(trade, options);
  if (!feeGate.passed) {
    return {
      status: 'skip',
      reasonCode: feeGate.reasonCode,
      reason: feeGate.reason,
      trade,
      mutationVenue: executionVenue,
      liveMutation,
      guardrails: { internalWallet, minHedge, depthCheck, sellPolicy, feeGate },
    };
  }

  const fillPolicy = evaluatePartialVsSkipPolicy(trade, depthCheck, options);
  const queue = queueResidualExposure(trade, fillPolicy, {
    ...options,
    mutationVenue: executionVenue,
  });

  return {
    status: fillPolicy.status,
    reasonCode: fillPolicy.reasonCode,
    reason: fillPolicy.reason,
    trade,
    mutationVenue: executionVenue,
    liveMutation,
    requestedUsdc: fillPolicy.requestedUsdc,
    allowedUsdc: fillPolicy.allowedUsdc,
    fillableUsdc: fillPolicy.fillableUsdc,
    residualUsdc: fillPolicy.residualUsdc,
    queue,
    guardrails: {
      internalWallet,
      minHedge,
      depthCheck,
      sellPolicy,
      feeGate,
      fillPolicy,
    },
  };
}

function createMirrorHedgeExecutionBundle(options = {}) {
  return {
    options: { ...options },
    shouldSkipInternalWallet,
    evaluateMinHedgeSkip,
    evaluateDepthCheck,
    evaluateFeeRevenueGate,
    evaluatePartialVsSkipPolicy,
    evaluateDepthCheckedSellPolicy,
    queueResidualExposure,
    reconcileMempoolConfirmRevert,
    classifyMirrorHedgeExecution,
    normalizeTradeAmount,
    normalizeWalletCandidates,
    resolveDepthCandidates,
    resolveDepthReferencePrice,
    resolveDepthCapacity,
    normalizeMempoolStatus,
    isPolymarketVenue,
  };
}

module.exports = {
  shouldSkipInternalWallet,
  evaluateMinHedgeSkip,
  resolveDepthCandidates,
  resolveDepthReferencePrice,
  resolveDepthCapacity,
  evaluateDepthCheck,
  evaluateFeeRevenueGate,
  evaluatePartialVsSkipPolicy,
  evaluateDepthCheckedSellPolicy,
  queueResidualExposure,
  normalizeMempoolStatus,
  reconcileMempoolConfirmRevert,
  classifyMirrorHedgeExecution,
  createMirrorHedgeExecutionBundle,
  normalizeTradeAmount,
  normalizeWalletCandidates,
};
