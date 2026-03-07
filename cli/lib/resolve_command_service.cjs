function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunResolveCommand requires deps.${name}()`);
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

function buildResolveOperationContext(options = {}, payload = {}) {
  const pollAddress = normalizeOperationToken(payload.pollAddress || options.pollAddress);
  const answer = normalizeOperationToken(payload.answer || options.answer);
  if (!pollAddress || !answer) {
    return null;
  }

  const chainId = normalizeOperationChainId(
    payload && payload.runtime && payload.runtime.chainId !== undefined
      ? payload.runtime.chainId
      : options.chainId,
  );

  return {
    protocol: 'shared-operation/v1',
    command: 'resolve',
    mode: payload && payload.mode ? payload.mode : (options.execute ? 'execute' : 'dry-run'),
    status: payload && payload.status ? payload.status : (options.execute ? 'submitted' : 'planned'),
    operationId: [
      'resolve',
      chainId === null ? null : String(chainId),
      encodeOperationIdPart(pollAddress),
      encodeOperationIdPart(answer),
    ].filter(Boolean).join(':'),
    runtimeHandle: {
      type: 'resolve',
      chainId,
      pollAddress,
      answer,
    },
    target: {
      pollAddress,
      answer,
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
 * Creates the `resolve` command runner.
 * @param {object} deps
 * @returns {(args: string[], context: {outputMode: string}) => Promise<void>}
 */
function createRunResolveCommand(deps) {
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseIndexerSharedFlags = requireDep(deps, 'parseIndexerSharedFlags');
  const maybeLoadTradeEnv = requireDep(deps, 'maybeLoadTradeEnv');
  const parseResolveFlags = requireDep(deps, 'parseResolveFlags');
  const runResolve = requireDep(deps, 'runResolve');
  const renderSingleEntityTable = requireDep(deps, 'renderSingleEntityTable');
  const CliError = requireDep(deps, 'CliError');
  const assertLiveWriteAllowed = typeof deps.assertLiveWriteAllowed === 'function' ? deps.assertLiveWriteAllowed : null;
  const decorateOperationPayload =
    typeof deps.decorateOperationPayload === 'function' ? deps.decorateOperationPayload : null;

  return async function runResolveCommand(args, context) {
    const shared = parseIndexerSharedFlags(args);
    if (includesHelpFlag(shared.rest)) {
      if (context.outputMode === 'json') {
        emitSuccess(
          context.outputMode,
          'resolve.help',
          commandHelpPayload(
            'pandora [--output table|json] resolve [--dotenv-path <path>] [--skip-dotenv] --poll-address <address> --answer yes|no|invalid --reason <text> --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>]',
          ),
        );
      } else {
        // eslint-disable-next-line no-console
        console.log(
          'Usage: pandora [--output table|json] resolve [--dotenv-path <path>] [--skip-dotenv] --poll-address <address> --answer yes|no|invalid --reason <text> --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>]',
        );
      }
      return;
    }
    maybeLoadTradeEnv(shared);
    const options = parseResolveFlags(shared.rest);
    if (options.execute && assertLiveWriteAllowed) {
      await assertLiveWriteAllowed('resolve.execute', {
        runtimeMode: options.fork || options.forkRpcUrl ? 'fork' : 'live',
      });
    }
    let payload;
    try {
      payload = await runResolve(options);
    } catch (err) {
      if (err && err.code) {
        throw new CliError(err.code, err.message || 'resolve command failed.', err.details);
      }
      throw err;
    }
    payload = await maybeDecorateOperationPayload(
      decorateOperationPayload,
      payload,
      buildResolveOperationContext(options, payload),
    );
    emitSuccess(context.outputMode, 'resolve', payload, renderSingleEntityTable);
  };
}

module.exports = {
  buildResolveOperationContext,
  createRunResolveCommand,
};
