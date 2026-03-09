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

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildResolveEpochWindow(precheck) {
  if (!precheck || typeof precheck !== 'object') return null;
  const currentEpoch =
    precheck.currentEpoch === undefined || precheck.currentEpoch === null || precheck.currentEpoch === ''
      ? null
      : String(precheck.currentEpoch);
  const finalizationEpoch =
    precheck.finalizationEpoch === undefined || precheck.finalizationEpoch === null || precheck.finalizationEpoch === ''
      ? null
      : String(precheck.finalizationEpoch);
  const epochsUntilFinalization = Number.isInteger(precheck.epochsUntilFinalization)
    ? precheck.epochsUntilFinalization
    : null;
  if (currentEpoch === null && finalizationEpoch === null && epochsUntilFinalization === null) {
    return null;
  }
  return {
    currentEpoch,
    finalizationEpoch,
    epochsUntilFinalization,
  };
}

function formatResolveEpochWindow(precheck) {
  const window = buildResolveEpochWindow(precheck);
  if (!window) return null;
  return [
    window.currentEpoch === null ? null : `Current epoch: ${window.currentEpoch}.`,
    window.finalizationEpoch === null ? null : `Finalization epoch: ${window.finalizationEpoch}.`,
    window.epochsUntilFinalization === null ? null : `Epochs remaining: ${window.epochsUntilFinalization}.`,
  ]
    .filter(Boolean)
    .join(' ');
}

function isResolvePayloadExecutable(payload) {
  const precheck = payload && payload.precheck && typeof payload.precheck === 'object' ? payload.precheck : null;
  if (!precheck) return false;
  if (precheck.pollFinalized === true) return true;
  if (precheck.claimable === true) return true;
  return Number.isInteger(precheck.epochsUntilFinalization) && precheck.epochsUntilFinalization <= 0;
}

function buildResolveWatchReason(payload) {
  const precheck = payload && payload.precheck && typeof payload.precheck === 'object' ? payload.precheck : null;
  if (!precheck) return 'Resolve precheck is unavailable.';
  const epochWindow = formatResolveEpochWindow(precheck);
  if (precheck.pollFinalized === true) {
    return ['Poll is already finalized and executable.', epochWindow].filter(Boolean).join(' ');
  }
  if (precheck.claimable === true) {
    return ['Poll is executable.', epochWindow].filter(Boolean).join(' ');
  }
  if (Number.isInteger(precheck.epochsUntilFinalization) && precheck.epochsUntilFinalization > 0) {
    return [
      'Resolution not yet available.',
      epochWindow,
      'Use --watch to keep polling until the market becomes executable.',
    ]
      .filter(Boolean)
      .join(' ');
  }
  return ['Finalization window is open.', epochWindow].filter(Boolean).join(' ');
}

function attachResolveWatch(payload, watch) {
  if (!payload || typeof payload !== 'object') return payload;
  return {
    ...payload,
    watch,
  };
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
  const sleep = typeof deps.sleep === 'function' ? deps.sleep : sleepMs;

  return async function runResolveCommand(args, context) {
    const shared = parseIndexerSharedFlags(args);
    if (includesHelpFlag(shared.rest)) {
      if (context.outputMode === 'json') {
        emitSuccess(
          context.outputMode,
          'resolve.help',
          {
            ...commandHelpPayload(
              'pandora [--output table|json] resolve [--dotenv-path <path>] [--skip-dotenv] --poll-address <address> --answer yes|no|invalid --reason <text> --dry-run|--execute [--watch] [--watch-interval-ms <ms>] [--watch-timeout-ms <ms>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>]',
            ),
            notes: {
              watch:
                '--watch repeatedly runs dry-run prechecks until finalization opens. Combine it with --execute to submit automatically once the market is executable.',
            },
          },
        );
      } else {
        // eslint-disable-next-line no-console
        console.log(
          'Usage: pandora [--output table|json] resolve [--dotenv-path <path>] [--skip-dotenv] --poll-address <address> --answer yes|no|invalid --reason <text> --dry-run|--execute [--watch] [--watch-interval-ms <ms>] [--watch-timeout-ms <ms>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>]',
        );
        console.log('--watch polls dry-run prechecks until the market becomes executable and can then promote into --execute.');
      }
      return;
    }
    maybeLoadTradeEnv(shared);
    const options = parseResolveFlags(shared.rest);

    async function maybeAssertResolveLiveWrite() {
      if (options.execute && assertLiveWriteAllowed) {
        await assertLiveWriteAllowed('resolve.execute', {
          runtimeMode: options.fork || options.forkRpcUrl ? 'fork' : 'live',
        });
      }
    }

    async function runResolveWithOptionalWatch() {
      if (!options.watch) {
        await maybeAssertResolveLiveWrite();
        return runResolve(options);
      }

      const startedAt = new Date();
      const startedAtIso = startedAt.toISOString();
      const timeoutAtMs = startedAt.getTime() + options.watchTimeoutMs;
      const previewOptions = {
        ...options,
        dryRun: true,
        execute: false,
      };
      let attempts = 0;
      let lastPayload = null;

      while (true) {
        attempts += 1;
        lastPayload = await runResolve(previewOptions);
        const precheck = lastPayload && lastPayload.precheck && typeof lastPayload.precheck === 'object'
          ? lastPayload.precheck
          : null;
        if (!precheck) {
          throw new CliError(
            'RESOLVE_WATCH_PRECHECK_UNAVAILABLE',
            'resolve --watch requires dry-run precheck data so it can observe remaining epochs.',
            {
              attempts,
              lastPayload,
            },
          );
        }

        if (isResolvePayloadExecutable(lastPayload)) {
          const watch = {
            enabled: true,
            ready: true,
            executionTriggered: Boolean(options.execute),
            startedAt: startedAtIso,
            checkedAt: new Date().toISOString(),
            attempts,
            intervalMs: options.watchIntervalMs,
            timeoutMs: options.watchTimeoutMs,
            reason: buildResolveWatchReason(lastPayload),
            finalizationEpoch: precheck.finalizationEpoch || null,
            currentEpoch: precheck.currentEpoch || null,
            epochsUntilFinalization:
              Number.isInteger(precheck.epochsUntilFinalization) ? precheck.epochsUntilFinalization : null,
          };
          if (!options.execute) {
            return attachResolveWatch(lastPayload, watch);
          }
          await maybeAssertResolveLiveWrite();
          return attachResolveWatch(await runResolve(options), watch);
        }

        if (Date.now() >= timeoutAtMs) {
          throw new CliError(
            'RESOLVE_WATCH_TIMEOUT',
            'resolve --watch timed out before the market became executable.',
            {
              attempts,
              watchIntervalMs: options.watchIntervalMs,
              watchTimeoutMs: options.watchTimeoutMs,
              lastPayload,
            },
          );
        }

        await sleep(options.watchIntervalMs);
      }
    }

    let payload;
    try {
      payload = await runResolveWithOptionalWatch();
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
  isResolvePayloadExecutable,
};
