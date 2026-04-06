function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunLpCommand requires deps.${name}()`);
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

function buildLpOperationContext(options = {}, payload = {}) {
  const action = payload && payload.action ? payload.action : options.action;
  const wallet = normalizeOperationToken(payload.wallet || options.wallet);
  if (!wallet) {
    return null;
  }

  const chainId = normalizeOperationChainId(
    payload && payload.runtime && payload.runtime.chainId !== undefined
      ? payload.runtime.chainId
      : options.chainId,
  );
  const mode = payload && payload.mode ? payload.mode : (options.execute ? 'execute' : 'dry-run');

  return {
    protocol: 'shared-operation/v1',
    command: 'lp',
    mode,
    status: inferOperationStatus(payload, mode === 'execute' ? 'submitted' : 'planned'),
    operationId: [
      'lp-remove-all-markets',
      chainId === null ? null : String(chainId),
      encodeOperationIdPart(wallet),
    ].filter(Boolean).join(':'),
    runtimeHandle: {
      type: 'lp-remove-all-markets',
      chainId,
      wallet,
      allMarkets: true,
    },
    target: {
      action: 'remove-all-markets',
      allMarkets: true,
      wallet,
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
 * Creates the `lp` command runner.
 * @param {object} deps
 * @returns {(args: string[], context: {outputMode: string}) => Promise<void>}
 */
function createRunLpCommand(deps) {
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseIndexerSharedFlags = requireDep(deps, 'parseIndexerSharedFlags');
  const maybeLoadTradeEnv = requireDep(deps, 'maybeLoadTradeEnv');
  const parseLpFlags = requireDep(deps, 'parseLpFlags');
  const runLp = requireDep(deps, 'runLp');
  const renderSingleEntityTable = requireDep(deps, 'renderSingleEntityTable');
  const CliError = requireDep(deps, 'CliError');
  const assertLiveWriteAllowed = typeof deps.assertLiveWriteAllowed === 'function' ? deps.assertLiveWriteAllowed : null;
  const decorateOperationPayload =
    typeof deps.decorateOperationPayload === 'function' ? deps.decorateOperationPayload : null;

  return async function runLpCommand(args, context) {
    if (includesHelpFlag(args)) {
      if (context.outputMode === 'json') {
        emitSuccess(
          context.outputMode,
          'lp.help',
          commandHelpPayload(
            'pandora [--output table|json] lp add|remove|positions [--market-address <address>] [--wallet <address>] [--amount-usdc <n>] [--lp-tokens <n>|--all|--all-markets] [--dry-run|--execute] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--usdc <address>] [--deadline-seconds <n>] [--indexer-url <url>] [--timeout-ms <ms>]\n'
              + 'pandora [--output table|json] lp simulate-remove --market-address <address> [--wallet <address>] [--lp-tokens <n>|--all] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>]',
          ),
        );
      } else {
        // eslint-disable-next-line no-console
        console.log(
          'Usage: pandora [--output table|json] lp add|remove|positions [--market-address <address>] [--wallet <address>] [--amount-usdc <n>] [--lp-tokens <n>|--all|--all-markets] [--dry-run|--execute] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--usdc <address>] [--deadline-seconds <n>] [--indexer-url <url>] [--timeout-ms <ms>]\n'
            + '       pandora [--output table|json] lp simulate-remove --market-address <address> [--wallet <address>] [--lp-tokens <n>|--all] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>]',
        );
      }
      return;
    }
    const shared = parseIndexerSharedFlags(args);
    maybeLoadTradeEnv(shared);
    const options = parseLpFlags(shared.rest);
    if (shared.indexerUrl) {
      options.indexerUrl = shared.indexerUrl;
    }
    if (Number.isFinite(shared.timeoutMs)) {
      options.timeoutMs = shared.timeoutMs;
    }
    if (options.execute && options.action !== 'positions' && assertLiveWriteAllowed) {
      await assertLiveWriteAllowed(`lp.${options.action}.execute`, {
        notionalUsdc: options.action === 'add' ? options.amountUsdc : null,
        runtimeMode: options.fork || options.forkRpcUrl ? 'fork' : 'live',
      });
    }
    let payload;
    try {
      payload = await runLp(options);
    } catch (err) {
      if (err && err.code) {
        throw new CliError(err.code, err.message || 'lp command failed.', err.details);
      }
      throw err;
    }
    payload = await maybeDecorateOperationPayload(
      decorateOperationPayload,
      payload,
      buildLpOperationContext(options, payload),
    );
    emitSuccess(context.outputMode, 'lp', payload, renderSingleEntityTable);
  };
}

module.exports = {
  buildLpOperationContext,
  createRunLpCommand,
};
