function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunClaimCommand requires deps.${name}()`);
  }
  return deps[name];
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

function inferOperationStatus(payload, defaultStatus) {
  if (payload && payload.mode === 'dry-run') {
    return 'planned';
  }
  if (payload && typeof payload.status === 'string' && payload.status.trim()) {
    return payload.status.trim();
  }
  const successCount = Number.isInteger(payload && payload.successCount) ? payload.successCount : null;
  const failureCount = Number.isInteger(payload && payload.failureCount) ? payload.failureCount : null;
  if (successCount === null || failureCount === null) {
    return defaultStatus;
  }
  if (failureCount === 0) {
    return successCount > 0 ? 'completed' : 'no-op';
  }
  return successCount > 0 ? 'partial' : 'failed';
}

function buildClaimOperationContext(options = {}, payload = {}) {
  const chainId = normalizeOperationChainId(
    payload && payload.runtime && payload.runtime.chainId !== undefined
      ? payload.runtime.chainId
      : options.chainId,
  );
  const mode = payload && payload.mode ? payload.mode : (options.execute ? 'execute' : 'dry-run');
  const all = Boolean((payload && payload.action === 'claim-all') || options.all);
  const runtimeHandle = {
    type: all ? 'claim-all' : 'claim',
    chainId,
    all,
    marketAddress: null,
    wallet: null,
  };

  if (all) {
    const wallet = normalizeOperationToken(payload.wallet || options.wallet);
    if (!wallet) {
      return null;
    }
    runtimeHandle.wallet = wallet;
    return {
      protocol: 'shared-operation/v1',
      command: 'claim',
      mode,
      status: inferOperationStatus(payload, mode === 'execute' ? 'submitted' : 'planned'),
      operationId: [
        'claim-all',
        chainId === null ? null : String(chainId),
        encodeOperationIdPart(wallet),
      ].filter(Boolean).join(':'),
      runtimeHandle,
      target: {
        all: true,
        wallet,
      },
    };
  }

  const marketAddress = normalizeOperationToken(payload.marketAddress || options.marketAddress);
  if (!marketAddress) {
    return null;
  }
  runtimeHandle.marketAddress = marketAddress;
  return {
    protocol: 'shared-operation/v1',
    command: 'claim',
    mode,
    status: inferOperationStatus(payload, mode === 'execute' ? 'submitted' : 'planned'),
    operationId: [
      'claim',
      chainId === null ? null : String(chainId),
      encodeOperationIdPart(marketAddress),
    ].filter(Boolean).join(':'),
    runtimeHandle,
    target: {
      all: false,
      marketAddress,
    },
  };
}

async function maybeDecorateOperationPayload(decorateOperationPayload, payload, operationContext) {
  if (typeof decorateOperationPayload !== 'function' || !payload || !operationContext) {
    return payload;
  }
  try {
    const nextPayload = await decorateOperationPayload(payload, operationContext);
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

/**
 * Creates `claim` command runner.
 * @param {object} deps
 * @returns {(args: string[], context: {outputMode: string}) => Promise<void>}
 */
function createRunClaimCommand(deps) {
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseIndexerSharedFlags = requireDep(deps, 'parseIndexerSharedFlags');
  const maybeLoadTradeEnv = requireDep(deps, 'maybeLoadTradeEnv');
  const parseClaimFlags = requireDep(deps, 'parseClaimFlags');
  const runClaim = requireDep(deps, 'runClaim');
  const renderSingleEntityTable = requireDep(deps, 'renderSingleEntityTable');
  const CliError = requireDep(deps, 'CliError');
  const assertLiveWriteAllowed = typeof deps.assertLiveWriteAllowed === 'function' ? deps.assertLiveWriteAllowed : null;
  const decorateOperationPayload =
    typeof deps.decorateOperationPayload === 'function' ? deps.decorateOperationPayload : null;

  return async function runClaimCommand(args, context) {
    const shared = parseIndexerSharedFlags(args);
    if (includesHelpFlag(shared.rest)) {
      const usage =
        'pandora [--output table|json] claim --market-address <address>|--all [--wallet <address>] --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--indexer-url <url>] [--timeout-ms <ms>]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'claim.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    maybeLoadTradeEnv(shared);
    const options = parseClaimFlags(shared.rest);
    if (!options.indexerUrl && shared.indexerUrl) {
      options.indexerUrl = shared.indexerUrl;
    }
    if (Number.isFinite(shared.timeoutMs)) {
      options.timeoutMs = shared.timeoutMs;
    }

    if (options.execute && assertLiveWriteAllowed) {
      await assertLiveWriteAllowed('claim.execute', {
        runtimeMode: options.fork || options.forkRpcUrl ? 'fork' : 'live',
      });
    }

    let payload;
    try {
      payload = await runClaim(options);
    } catch (err) {
      if (err && err.code) {
        throw new CliError(err.code, err.message || 'claim command failed.', err.details);
      }
      throw err;
    }

    payload = await maybeDecorateOperationPayload(
      decorateOperationPayload,
      payload,
      buildClaimOperationContext(options, payload),
    );

    emitSuccess(context.outputMode, 'claim', payload, renderSingleEntityTable);
  };
}

module.exports = {
  buildClaimOperationContext,
  createRunClaimCommand,
};
