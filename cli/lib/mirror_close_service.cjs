const MIRROR_CLOSE_SCHEMA_VERSION = '1.0.0';

function normalizeError(err, fallbackCode) {
  return {
    code: err && err.code ? err.code : fallbackCode,
    message: err && err.message ? err.message : String(err),
    details: err && err.details ? err.details : null,
  };
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
    return payload;
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

  return payload;
}

module.exports = {
  MIRROR_CLOSE_SCHEMA_VERSION,
  runMirrorClose,
};
