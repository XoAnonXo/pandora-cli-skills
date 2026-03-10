const MIRROR_CLOSE_SCHEMA_VERSION = '1.0.0';
const SHARED_OPERATION_PROTOCOL = 'shared-operation/v1';
const SUCCESS_STEP_STATUSES = new Set(['planned', 'completed', 'not-needed']);

let cachedRunPolymarketPositions = null;

function normalizeError(err, fallbackCode) {
  return {
    code: err && err.code ? err.code : fallbackCode,
    message: err && err.message ? err.message : String(err),
    details: err && err.details ? err.details : null,
  };
}

function normalizeOperationToken(value, options = {}) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return options.preserveCase ? trimmed : trimmed.toLowerCase();
}

function encodeOperationIdPart(value, options = {}) {
  const normalized = normalizeOperationToken(value, options);
  return normalized ? encodeURIComponent(normalized) : null;
}

function normalizeOperationChainId(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

function inferMirrorCloseStatus(payload, options = {}) {
  if (payload && payload.mode === 'dry-run') {
    return 'planned';
  }
  const successCount = Number.isInteger(payload && payload.summary && payload.summary.successCount)
    ? payload.summary.successCount
    : null;
  const failureCount = Number.isInteger(payload && payload.summary && payload.summary.failureCount)
    ? payload.summary.failureCount
    : null;
  if (successCount === null || failureCount === null) {
    return options.execute ? 'submitted' : 'planned';
  }
  if (failureCount === 0) {
    return successCount > 0 ? 'completed' : 'no-op';
  }
  return successCount > 0 ? 'partial' : 'failed';
}

function isSuccessfulStepStatus(status) {
  return SUCCESS_STEP_STATUSES.has(status);
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = value === undefined || value === null ? '' : String(value).trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function buildMirrorCloseOperationContext(options = {}, payload = {}) {
  const chainId = normalizeOperationChainId(options.chainId);
  const all = Boolean((payload && payload.target && payload.target.all) || options.all);
  const pandoraMarketAddress = normalizeOperationToken(
    payload && payload.pandoraMarketAddress !== undefined
      ? payload.pandoraMarketAddress
      : options.pandoraMarketAddress,
  );
  const polymarketMarketId = normalizeOperationToken(
    payload && payload.polymarketMarketId !== undefined
      ? payload.polymarketMarketId
      : options.polymarketMarketId,
    { preserveCase: true },
  );
  const polymarketSlug = normalizeOperationToken(
    payload && payload.polymarketSlug !== undefined
      ? payload.polymarketSlug
      : options.polymarketSlug,
  );
  const wallet = normalizeOperationToken(
    options.wallet
    || payload.wallet
    || (typeof options.deriveWalletAddressFromPrivateKey === 'function' && options.privateKey
      ? options.deriveWalletAddressFromPrivateKey(options.privateKey)
      : null),
  );

  if (!all && !pandoraMarketAddress && !polymarketMarketId && !polymarketSlug) {
    return null;
  }

  const selector = all
    ? 'all'
    : [pandoraMarketAddress, polymarketMarketId, polymarketSlug].filter(Boolean).join(':');

  return {
    protocol: SHARED_OPERATION_PROTOCOL,
    command: 'mirror.close',
    mode: payload && payload.mode ? payload.mode : (options.execute ? 'execute' : 'dry-run'),
    status: inferMirrorCloseStatus(payload, options),
    operationId: [
      'mirror-close',
      chainId === null ? null : String(chainId),
      encodeOperationIdPart(selector, { preserveCase: true }),
      all ? encodeOperationIdPart(wallet) : null,
    ].filter(Boolean).join(':'),
    runtimeHandle: {
      type: 'mirror-close',
      chainId,
      all,
      wallet,
      pandoraMarketAddress,
      polymarketMarketId,
      polymarketSlug,
    },
    target: {
      all,
      wallet,
      pandoraMarketAddress,
      polymarketMarketId,
      polymarketSlug,
    },
  };
}

async function maybeDecorateOperationPayload(deps, payload, options) {
  if (!deps || typeof deps.decorateOperationPayload !== 'function') {
    return payload;
  }
  const operationContext = buildMirrorCloseOperationContext(options, payload);
  if (!operationContext) {
    return payload;
  }
  try {
    const nextPayload = await deps.decorateOperationPayload(payload, operationContext);
    return nextPayload === undefined ? payload : nextPayload;
  } catch (error) {
    const diagnostic = `Operation decoration failed: ${error && error.message ? error.message : String(error)}`;
    return Array.isArray(payload.diagnostics)
      ? {
          ...payload,
          diagnostics: payload.diagnostics.concat(diagnostic),
        }
      : payload;
  }
}

function buildStepResult(step, status, data, error, extras = {}) {
  return {
    step,
    status,
    ok: isSuccessfulStepStatus(status),
    data: data || null,
    error: error || null,
    resumeCommand: extras.resumeCommand || null,
    resumable:
      extras.resumable !== undefined
        ? Boolean(extras.resumable)
        : Boolean(extras.resumeCommand && !isSuccessfulStepStatus(status)),
  };
}

function buildSkippedDependencyError(failedStep) {
  return {
    code: 'STEP_SKIPPED_DEPENDENCY_FAILED',
    message: `Skipped because prior step "${failedStep}" failed.`,
    details: { failedStep },
  };
}

function buildMirrorSyncStopCommand(options = {}) {
  if (options.all) {
    return 'pandora mirror sync stop --all';
  }
  const parts = ['pandora mirror sync stop'];
  if (options.pandoraMarketAddress) {
    parts.push(`--market-address ${options.pandoraMarketAddress}`);
  }
  if (options.polymarketMarketId) {
    parts.push(`--polymarket-market-id ${options.polymarketMarketId}`);
  } else if (options.polymarketSlug) {
    parts.push(`--polymarket-slug ${options.polymarketSlug}`);
  }
  return parts.join(' ');
}

function buildLpRemoveCommand(options = {}) {
  const parts = ['pandora lp remove'];
  if (options.all) {
    parts.push('--all-markets');
  } else if (options.pandoraMarketAddress) {
    parts.push(`--market-address ${options.pandoraMarketAddress}`);
  }
  parts.push('--all');
  parts.push('--execute');
  if (options.wallet) {
    parts.push(`--wallet ${options.wallet}`);
  }
  if (Number.isInteger(options.chainId)) {
    parts.push(`--chain-id ${options.chainId}`);
  }
  if (options.rpcUrl) {
    parts.push(`--rpc-url ${options.rpcUrl}`);
  }
  if (options.profileId) {
    parts.push(`--profile-id ${options.profileId}`);
  } else if (options.profileFile) {
    parts.push(`--profile-file ${options.profileFile}`);
  }
  return parts.join(' ');
}

function buildClaimCommand(options = {}) {
  const parts = ['pandora claim'];
  if (options.all) {
    parts.push('--all');
  } else if (options.pandoraMarketAddress) {
    parts.push(`--market-address ${options.pandoraMarketAddress}`);
  }
  parts.push('--execute');
  if (options.wallet) {
    parts.push(`--wallet ${options.wallet}`);
  }
  if (Number.isInteger(options.chainId)) {
    parts.push(`--chain-id ${options.chainId}`);
  }
  if (options.rpcUrl) {
    parts.push(`--rpc-url ${options.rpcUrl}`);
  }
  if (options.indexerUrl) {
    parts.push(`--indexer-url ${options.indexerUrl}`);
  }
  if (options.profileId) {
    parts.push(`--profile-id ${options.profileId}`);
  } else if (options.profileFile) {
    parts.push(`--profile-file ${options.profileFile}`);
  }
  return parts.join(' ');
}

function buildPolymarketPositionsCommand(options = {}, wallet) {
  const parts = ['pandora polymarket positions'];
  parts.push(`--wallet ${wallet || '<wallet-address>'}`);
  if (options.polymarketMarketId) {
    parts.push(`--market-id ${options.polymarketMarketId}`);
  } else if (options.polymarketSlug) {
    parts.push(`--slug ${options.polymarketSlug}`);
  }
  return parts.join(' ');
}

function resolveSettlementWallet(options = {}, deps = {}) {
  if (options.wallet) return options.wallet;
  if (typeof deps.deriveWalletAddressFromPrivateKey === 'function' && options.privateKey) {
    try {
      return deps.deriveWalletAddressFromPrivateKey(options.privateKey);
    } catch {
      return null;
    }
  }
  return null;
}

function getRunPolymarketPositions(deps = {}) {
  if (typeof deps.runPolymarketPositions === 'function') {
    return deps.runPolymarketPositions;
  }
  if (cachedRunPolymarketPositions) {
    return cachedRunPolymarketPositions;
  }
  try {
    const moduleValue = require('./polymarket_ops_service.cjs');
    if (moduleValue && typeof moduleValue.runPolymarketPositions === 'function') {
      cachedRunPolymarketPositions = moduleValue.runPolymarketPositions;
      return cachedRunPolymarketPositions;
    }
  } catch {
    return null;
  }
  return null;
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildPolymarketSettlementSummary(step = {}) {
  const data = step && step.data && typeof step.data === 'object' ? step.data : {};
  return {
    stepStatus: step && step.status ? step.status : 'unknown',
    status:
      data.settlementStatus
      || (step && step.status ? step.status : 'unknown'),
    wallet: data.wallet || null,
    marketId: data.marketId || null,
    slug: data.slug || null,
    hasExposure: data.hasExposure === true,
    yesBalance: data.yesBalance !== undefined ? data.yesBalance : null,
    noBalance: data.noBalance !== undefined ? data.noBalance : null,
    openOrdersCount: data.openOrdersCount !== undefined ? data.openOrdersCount : null,
    openOrdersNotionalUsd: data.openOrdersNotionalUsd !== undefined ? data.openOrdersNotionalUsd : null,
    estimatedValueUsd: data.estimatedValueUsd !== undefined ? data.estimatedValueUsd : null,
    sourceResolved: data.sourceResolved || null,
    autoSettlementSupported: data.autoSettlementSupported === true,
    resumeCommand: step && step.resumeCommand ? step.resumeCommand : null,
    diagnostics: Array.isArray(data.diagnostics) ? data.diagnostics : [],
  };
}

async function inspectPolymarketSettlement(options = {}, deps = {}) {
  const settlementWallet = resolveSettlementWallet(options, deps);
  const resumeCommand = buildPolymarketPositionsCommand(options, settlementWallet);
  const baseData = {
    wallet: settlementWallet,
    marketId: options.polymarketMarketId || null,
    slug: options.polymarketSlug || null,
    autoSettlementSupported: false,
    settlementStatus: 'unknown',
    hasExposure: false,
    diagnostics: [],
  };

  if (!settlementWallet) {
    baseData.settlementStatus = 'discovery-unavailable';
    baseData.diagnostics.push('Polymarket settlement discovery requires --wallet or signer credentials that resolve a wallet address.');
    return buildStepResult(
      'settle-polymarket',
      options.execute ? 'discovery-unavailable' : 'planned',
      baseData,
      options.execute
        ? {
            code: 'POLYMARKET_SETTLEMENT_WALLET_REQUIRED',
            message: 'Polymarket settlement discovery requires a wallet address.',
            details: {
              marketId: options.polymarketMarketId || null,
              slug: options.polymarketSlug || null,
            },
          }
        : null,
      { resumeCommand },
    );
  }

  const runPolymarketPositions = getRunPolymarketPositions(deps);
  if (typeof runPolymarketPositions !== 'function') {
    baseData.settlementStatus = 'discovery-unavailable';
    baseData.diagnostics.push('Polymarket positions inspection is unavailable in this build.');
    return buildStepResult(
      'settle-polymarket',
      options.execute ? 'discovery-unavailable' : 'planned',
      baseData,
      options.execute
        ? {
            code: 'POLYMARKET_SETTLEMENT_UNAVAILABLE',
            message: 'Polymarket settlement inspection is unavailable in this build.',
            details: null,
          }
        : null,
      { resumeCommand },
    );
  }

  try {
    const settlementPayload = await runPolymarketPositions({
      wallet: settlementWallet,
      marketId: options.polymarketMarketId || null,
      slug: options.polymarketSlug || null,
      rpcUrl: options.rpcUrl || null,
      privateKey: options.privateKey || null,
      timeoutMs: options.timeoutMs || null,
      source: 'auto',
    });
    const summary = settlementPayload && settlementPayload.summary && typeof settlementPayload.summary === 'object'
      ? settlementPayload.summary
      : {};
    const yesBalance = toFiniteNumber(summary.yesBalance);
    const noBalance = toFiniteNumber(summary.noBalance);
    const openOrdersCount = Number.isInteger(summary.openOrdersCount) ? summary.openOrdersCount : 0;
    const openOrdersNotionalUsd = toFiniteNumber(summary.openOrdersNotionalUsd);
    const estimatedValueUsd = toFiniteNumber(summary.estimatedValueUsd);
    const positions = Array.isArray(settlementPayload && settlementPayload.positions) ? settlementPayload.positions : [];
    const hasExposure =
      (yesBalance !== null && yesBalance > 0)
      || (noBalance !== null && noBalance > 0)
      || openOrdersCount > 0
      || (estimatedValueUsd !== null && estimatedValueUsd > 0)
      || positions.length > 0;
    const data = {
      wallet: settlementWallet,
      marketId: (settlementPayload && settlementPayload.marketId) || options.polymarketMarketId || null,
      slug: (settlementPayload && settlementPayload.slug) || options.polymarketSlug || null,
      autoSettlementSupported: false,
      settlementStatus: hasExposure ? 'manual-action-required' : 'not-needed',
      hasExposure,
      yesBalance,
      noBalance,
      openOrdersCount,
      openOrdersNotionalUsd,
      estimatedValueUsd,
      sourceResolved: settlementPayload && settlementPayload.sourceResolved ? settlementPayload.sourceResolved : null,
      diagnostics: Array.isArray(settlementPayload && settlementPayload.diagnostics) ? settlementPayload.diagnostics : [],
    };

    if (!options.execute) {
      return buildStepResult('settle-polymarket', 'planned', data, null, { resumeCommand });
    }

    if (!hasExposure) {
      return buildStepResult('settle-polymarket', 'not-needed', data, null, { resumeCommand: null });
    }

    return buildStepResult(
      'settle-polymarket',
      'manual-action-required',
      data,
      {
        code: 'POLYMARKET_SETTLEMENT_MANUAL_REQUIRED',
        message: 'Polymarket exposure remains and this closeout flow can only inspect, not redeem or unwind it automatically.',
        details: {
          yesBalance,
          noBalance,
          openOrdersCount,
          estimatedValueUsd,
        },
      },
      { resumeCommand },
    );
  } catch (err) {
    const error = normalizeError(err, 'POLYMARKET_SETTLEMENT_DISCOVERY_FAILED');
    const data = {
      ...baseData,
      settlementStatus: 'discovery-failed',
      diagnostics: [error.message],
    };
    return buildStepResult(
      'settle-polymarket',
      options.execute ? 'discovery-failed' : 'planned',
      data,
      options.execute ? error : null,
      { resumeCommand },
    );
  }
}

function finalizeMirrorClosePayload(payload, options = {}) {
  payload.summary.successCount = payload.steps.filter((item) => item.ok).length;
  payload.summary.failureCount = payload.steps.filter((item) => !item.ok).length;
  payload.summary.statuses = payload.steps.reduce((acc, step) => {
    const status = step && step.status ? step.status : 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  payload.status = inferMirrorCloseStatus(payload, options);
  payload.resumeCommands = uniqueStrings(
    payload.steps
      .filter((step) => step && step.resumeCommand && !isSuccessfulStepStatus(step.status))
      .map((step) => step.resumeCommand),
  );
  const settlementStep = payload.steps.find((step) => step && step.step === 'settle-polymarket') || null;
  payload.polymarketSettlement = buildPolymarketSettlementSummary(settlementStep);
  return payload;
}

/**
 * Execute closeout workflow for a mirror position.
 * @param {object} options
 * @param {object} deps
 * @returns {Promise<object>}
 */
async function runMirrorClose(options = {}, deps = {}) {
  if (!deps || typeof deps.stopMirrorDaemon !== 'function' || typeof deps.runLp !== 'function' || typeof deps.runClaim !== 'function') {
    throw new Error('runMirrorClose requires deps.stopMirrorDaemon, deps.runLp, and deps.runClaim');
  }

  const mode = options.execute ? 'execute' : 'dry-run';
  const payload = {
    schemaVersion: MIRROR_CLOSE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode,
    target: options.all
      ? { all: true }
      : {
          all: false,
          pandoraMarketAddress: options.pandoraMarketAddress || null,
          polymarketMarketId: options.polymarketMarketId || null,
          polymarketSlug: options.polymarketSlug || null,
        },
    pandoraMarketAddress: options.all ? null : (options.pandoraMarketAddress || null),
    polymarketMarketId: options.all ? null : (options.polymarketMarketId || null),
    polymarketSlug: options.all ? null : (options.polymarketSlug || null),
    steps: [],
    summary: {
      successCount: 0,
      failureCount: 0,
    },
    status: 'planned',
    resumeCommands: [],
    polymarketSettlement: null,
    diagnostics: [],
  };

  if (!options.execute) {
    payload.steps = [
      buildStepResult('stop-daemons', 'planned', { planned: true }, null, {
        resumeCommand: buildMirrorSyncStopCommand(options),
      }),
      buildStepResult('withdraw-lp', 'planned', { planned: true }, null, {
        resumeCommand: buildLpRemoveCommand(options),
      }),
      buildStepResult('claim-winnings', 'planned', { planned: true }, null, {
        resumeCommand: buildClaimCommand(options),
      }),
    ];
    payload.steps.push(await inspectPolymarketSettlement(options, deps));
    payload.diagnostics.push('Dry-run close plan generated.');
    finalizeMirrorClosePayload(payload, options);
    return maybeDecorateOperationPayload(deps, payload, {
      ...options,
      deriveWalletAddressFromPrivateKey: deps && typeof deps.deriveWalletAddressFromPrivateKey === 'function'
        ? deps.deriveWalletAddressFromPrivateKey
        : options.deriveWalletAddressFromPrivateKey,
    });
  }

  let canProceed = true;
  let failedDependency = null;
  let stopResult;
  try {
    stopResult = await deps.stopMirrorDaemon(
      options.all
        ? { all: true }
        : { marketAddress: options.pandoraMarketAddress },
    );
    payload.steps.push(buildStepResult('stop-daemons', 'completed', stopResult, null, {
      resumeCommand: null,
    }));
  } catch (err) {
    payload.steps.push(buildStepResult(
      'stop-daemons',
      'failed',
      null,
      normalizeError(err, 'MIRROR_CLOSE_STOP_FAILED'),
      {
        resumeCommand: buildMirrorSyncStopCommand(options),
      },
    ));
    canProceed = false;
    failedDependency = 'stop-daemons';
  }

  let lpResult;
  if (!canProceed) {
    payload.steps.push(buildStepResult(
      'withdraw-lp',
      'skipped',
      null,
      buildSkippedDependencyError(failedDependency),
      {
        resumeCommand: buildLpRemoveCommand(options),
      },
    ));
  } else {
    try {
      lpResult = await deps.runLp({
        action: 'remove',
        execute: Boolean(options.execute),
        dryRun: Boolean(options.dryRun),
        allMarkets: Boolean(options.all),
        lpAll: true,
        lpTokens: null,
        marketAddress: options.all ? null : options.pandoraMarketAddress,
        wallet: options.wallet || null,
        chainId: options.chainId || null,
        rpcUrl: options.rpcUrl || null,
        privateKey: options.privateKey || null,
        profileId: options.profileId || null,
        profileFile: options.profileFile || null,
        indexerUrl: options.indexerUrl || null,
        timeoutMs: options.timeoutMs || null,
      });
      payload.steps.push(buildStepResult('withdraw-lp', 'completed', lpResult, null));
    } catch (err) {
      payload.steps.push(buildStepResult(
        'withdraw-lp',
        'failed',
        null,
        normalizeError(err, 'MIRROR_CLOSE_WITHDRAW_FAILED'),
        {
          resumeCommand: buildLpRemoveCommand(options),
        },
      ));
      canProceed = false;
      failedDependency = 'withdraw-lp';
    }
  }

  let claimResult;
  if (!canProceed) {
    payload.steps.push(buildStepResult(
      'claim-winnings',
      'skipped',
      null,
      buildSkippedDependencyError(failedDependency),
      {
        resumeCommand: buildClaimCommand(options),
      },
    ));
  } else {
    try {
      claimResult = await deps.runClaim({
        execute: Boolean(options.execute),
        dryRun: Boolean(options.dryRun),
        all: Boolean(options.all),
        marketAddress: options.all ? null : options.pandoraMarketAddress,
        wallet: options.wallet || null,
        chainId: options.chainId || null,
        rpcUrl: options.rpcUrl || null,
        privateKey: options.privateKey || null,
        profileId: options.profileId || null,
        profileFile: options.profileFile || null,
        indexerUrl: options.indexerUrl || null,
        timeoutMs: options.timeoutMs || null,
      });
      payload.steps.push(buildStepResult('claim-winnings', 'completed', claimResult, null));
    } catch (err) {
      payload.steps.push(buildStepResult(
        'claim-winnings',
        'failed',
        null,
        normalizeError(err, 'MIRROR_CLOSE_CLAIM_FAILED'),
        {
          resumeCommand: buildClaimCommand(options),
        },
      ));
    }
  }

  payload.steps.push(await inspectPolymarketSettlement(options, deps));
  finalizeMirrorClosePayload(payload, options);

  return maybeDecorateOperationPayload(deps, payload, {
    ...options,
    deriveWalletAddressFromPrivateKey: deps && typeof deps.deriveWalletAddressFromPrivateKey === 'function'
      ? deps.deriveWalletAddressFromPrivateKey
      : options.deriveWalletAddressFromPrivateKey,
  });
}

module.exports = {
  MIRROR_CLOSE_SCHEMA_VERSION,
  buildMirrorCloseOperationContext,
  runMirrorClose,
};
