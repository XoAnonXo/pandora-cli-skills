const MIRROR_CLOSE_SCHEMA_VERSION = '1.0.0';
const SHARED_OPERATION_PROTOCOL = 'shared-operation/v1';

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

function buildStepResult(step, ok, data, error) {
  return {
    step,
    ok,
    data: ok ? data : null,
    error: ok ? null : error,
  };
}

function buildSkippedDependencyError(failedStep) {
  return {
    code: 'STEP_SKIPPED_DEPENDENCY_FAILED',
    message: `Skipped because prior step "${failedStep}" failed.`,
    details: { failedStep },
  };
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
    diagnostics: [],
  };

  if (!options.execute) {
    payload.steps = [
      buildStepResult('stop-daemons', true, { planned: true }, null),
      buildStepResult('withdraw-lp', true, { planned: true }, null),
      buildStepResult('claim-winnings', true, { planned: true }, null),
    ];
    payload.summary.successCount = payload.steps.length;
    payload.summary.failureCount = 0;
    payload.diagnostics.push('Dry-run close plan generated.');
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
    payload.steps.push(buildStepResult('stop-daemons', true, stopResult, null));
  } catch (err) {
    payload.steps.push(buildStepResult('stop-daemons', false, null, normalizeError(err, 'MIRROR_CLOSE_STOP_FAILED')));
    canProceed = false;
    failedDependency = 'stop-daemons';
  }

  let lpResult;
  if (!canProceed) {
    payload.steps.push(buildStepResult('withdraw-lp', false, null, buildSkippedDependencyError(failedDependency)));
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
        indexerUrl: options.indexerUrl || null,
        timeoutMs: options.timeoutMs || null,
      });
      payload.steps.push(buildStepResult('withdraw-lp', true, lpResult, null));
    } catch (err) {
      payload.steps.push(buildStepResult('withdraw-lp', false, null, normalizeError(err, 'MIRROR_CLOSE_WITHDRAW_FAILED')));
      canProceed = false;
      failedDependency = 'withdraw-lp';
    }
  }

  let claimResult;
  if (!canProceed) {
    payload.steps.push(buildStepResult('claim-winnings', false, null, buildSkippedDependencyError(failedDependency)));
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
        indexerUrl: options.indexerUrl || null,
        timeoutMs: options.timeoutMs || null,
      });
      payload.steps.push(buildStepResult('claim-winnings', true, claimResult, null));
    } catch (err) {
      payload.steps.push(buildStepResult('claim-winnings', false, null, normalizeError(err, 'MIRROR_CLOSE_CLAIM_FAILED')));
    }
  }

  payload.summary.successCount = payload.steps.filter((item) => item.ok).length;
  payload.summary.failureCount = payload.steps.filter((item) => !item.ok).length;

  payload.diagnostics.push(
    'Polymarket hedge settlement remains manual in this command version; use polymarket trade/close flows as needed.',
  );

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
