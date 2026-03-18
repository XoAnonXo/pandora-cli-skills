const path = require('path');
const { createAsyncOperationBridge } = require('../shared/operation_bridge.cjs');
const { loadState: loadMirrorState } = require('../mirror_state_store.cjs');
const {
  buildMirrorRuntimeTelemetry,
  unlockPendingActionLock,
} = require('../mirror_sync/state.cjs');
const { buildMirrorRebalanceTradeOptions } = require('../mirror_sync/rebalance_trade.cjs');
const { DEFAULT_AMM_TRADE_DEADLINE_OFFSET_SEC } = require('../trade_market_type_service.cjs');
const POLYMARKET_CHAIN_ID = 137;

function normalizeMirrorRebalanceTradeOptions(executionOptions, runtimeOptions) {
  const tradeOptions = buildMirrorRebalanceTradeOptions(executionOptions, runtimeOptions);
  const deadlineSeconds = Number(tradeOptions && tradeOptions.deadlineSeconds);
  return {
    amount: null,
    fork: Boolean(runtimeOptions && runtimeOptions.fork),
    forkRpcUrl:
      runtimeOptions && typeof runtimeOptions.forkRpcUrl === 'string' && runtimeOptions.forkRpcUrl.trim()
        ? runtimeOptions.forkRpcUrl
        : null,
    forkChainId:
      runtimeOptions && Number.isInteger(runtimeOptions.forkChainId)
        ? runtimeOptions.forkChainId
        : null,
    profile: runtimeOptions && runtimeOptions.profile ? runtimeOptions.profile : null,
    minAmountOutRaw: null,
    deadlineSeconds: Number.isFinite(deadlineSeconds) && deadlineSeconds > 0
      ? deadlineSeconds
      : DEFAULT_AMM_TRADE_DEADLINE_OFFSET_SEC,
    ...tradeOptions,
  };
}

function buildMirrorSyncOperationResult(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  const lastAction = actions.length ? actions[actions.length - 1] : null;
  let lastRebalanceAction = null;
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const action = actions[index];
    if (action && action.rebalance && typeof action.rebalance === 'object') {
      lastRebalanceAction = action;
      break;
    }
  }
  const rebalanceAction = lastRebalanceAction || lastAction;
  const rebalanceResult =
    rebalanceAction &&
    rebalanceAction.rebalance &&
    rebalanceAction.rebalance.result &&
    typeof rebalanceAction.rebalance.result === 'object'
      ? rebalanceAction.rebalance.result
      : null;
  return {
    strategyHash: payload.strategyHash || null,
    mode: payload.mode || null,
    executeLive: Boolean(payload.executeLive),
    actionCount: Number.isFinite(payload.actionCount) ? payload.actionCount : actions.length,
    lastExecutionStatus: lastAction && lastAction.status ? lastAction.status : null,
    rebalance:
      rebalanceAction && rebalanceAction.rebalance
        ? {
            side: rebalanceAction.rebalance.side || null,
            amountUsdc: rebalanceAction.rebalance.amountUsdc ?? null,
            tradeTxHash:
              rebalanceResult && (rebalanceResult.tradeTxHash || rebalanceResult.txHash || null),
            approveTxHash:
              rebalanceResult && rebalanceResult.approveTxHash ? rebalanceResult.approveTxHash : null,
            executionRouteRequested:
              rebalanceResult && rebalanceResult.executionRouteRequested ? rebalanceResult.executionRouteRequested : null,
            executionRouteResolved:
              rebalanceResult && rebalanceResult.executionRouteResolved ? rebalanceResult.executionRouteResolved : null,
            executionRouteFallback:
              rebalanceResult && rebalanceResult.executionRouteFallback ? rebalanceResult.executionRouteFallback : null,
            executionRouteFallbackUsed:
              Boolean(rebalanceResult && rebalanceResult.executionRouteFallbackUsed),
            executionRouteFallbackReason:
              rebalanceResult && rebalanceResult.executionRouteFallbackReason ? rebalanceResult.executionRouteFallbackReason : null,
            flashbotsRelayUrl:
              rebalanceResult && rebalanceResult.flashbotsRelayUrl ? rebalanceResult.flashbotsRelayUrl : null,
            flashbotsRelayMethod:
              rebalanceResult && rebalanceResult.flashbotsRelayMethod ? rebalanceResult.flashbotsRelayMethod : null,
            flashbotsTargetBlockNumber:
              rebalanceResult && rebalanceResult.flashbotsTargetBlockNumber !== undefined
                ? rebalanceResult.flashbotsTargetBlockNumber
                : null,
            flashbotsRelayResponseId:
              rebalanceResult && rebalanceResult.flashbotsRelayResponseId !== undefined
                ? rebalanceResult.flashbotsRelayResponseId
                : null,
            flashbotsBundleHash:
              rebalanceResult && rebalanceResult.flashbotsBundleHash ? rebalanceResult.flashbotsBundleHash : null,
            flashbotsSimulation:
              rebalanceResult && rebalanceResult.flashbotsSimulation ? rebalanceResult.flashbotsSimulation : null,
          }
        : null,
  };
}

function normalizeRpcUrlCandidates(value) {
  const rawValues = Array.isArray(value) ? value : String(value || '').split(',');
  const candidates = rawValues
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  return Array.from(new Set(candidates));
}

function buildRpcSelectionSummary(selection, label) {
  if (!selection || typeof selection !== 'object') return [];
  const attempts = Array.isArray(selection.attempts) ? selection.attempts : [];
  if (!attempts.length) return [];
  const failedCount = attempts.filter((entry) => entry && entry.ok === false).length;
  const selectedRpcUrl = selection.selectedRpcUrl ? String(selection.selectedRpcUrl) : null;
  const prefix = String(label || 'RPC').trim() || 'RPC';
  if (failedCount > 0 && selectedRpcUrl) {
    return [`${prefix} fallback used ${selectedRpcUrl} after ${failedCount} failed endpoint(s).`];
  }
  if (failedCount > 0 && !selectedRpcUrl) {
    return [`${prefix} exhausted ${attempts.length} configured endpoint(s) without a healthy candidate.`];
  }
  return [];
}

function normalizeStrategyHash(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{16}$/.test(normalized) ? normalized : null;
}

function parseMirrorSyncUnlockFlags(args, deps) {
  const {
    CliError,
    requireFlagValue,
    parsePositiveInteger,
  } = deps;
  const options = {
    stateFile: null,
    strategyHash: null,
    force: false,
    staleAfterMs: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--state-file') {
      options.stateFile = requireFlagValue(args, index, '--state-file');
      index += 1;
      continue;
    }
    if (token === '--strategy-hash') {
      const strategyHash = normalizeStrategyHash(requireFlagValue(args, index, '--strategy-hash'));
      if (!strategyHash) {
        throw new CliError('INVALID_FLAG_VALUE', '--strategy-hash must be a 16-character hex value.');
      }
      options.strategyHash = strategyHash;
      index += 1;
      continue;
    }
    if (token === '--force') {
      options.force = true;
      continue;
    }
    if (token === '--stale-after-ms') {
      options.staleAfterMs = parsePositiveInteger(requireFlagValue(args, index, '--stale-after-ms'), '--stale-after-ms');
      index += 1;
      continue;
    }
    throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror sync unlock: ${token}`);
  }

  if (!options.stateFile && !options.strategyHash) {
    throw new CliError(
      'MISSING_REQUIRED_FLAG',
      'mirror sync unlock requires --state-file <path> or --strategy-hash <hash>.',
    );
  }
  if (options.stateFile && options.strategyHash) {
    throw new CliError(
      'INVALID_ARGS',
      'mirror sync unlock accepts exactly one selector: --state-file <path> or --strategy-hash <hash>.',
    );
  }

  return options;
}

function resolveMirrorSyncUnlockStateFile(options) {
  if (options.stateFile) {
    return path.resolve(String(options.stateFile));
  }
  return path.join(
    process.env.HOME || process.env.USERPROFILE || '.',
    '.pandora',
    'mirror',
    `${options.strategyHash}.json`,
  );
}

function renderMirrorSyncUnlockTable(data) {
  const assessment = data && data.assessment && typeof data.assessment === 'object' ? data.assessment : {};
  const lock = data && data.lock && typeof data.lock === 'object' ? data.lock : {};
  const runtime = data && data.runtime && typeof data.runtime === 'object' ? data.runtime : {};
  const health = runtime.health && typeof runtime.health === 'object' ? runtime.health : {};
  const rows = [
    ['stateFile', data && data.stateFile ? data.stateFile : ''],
    ['strategyHash', data && data.strategyHash ? data.strategyHash : ''],
    ['cleared', data && data.cleared ? 'yes' : 'no'],
    ['reason', data && data.reason ? data.reason : ''],
    ['force', data && data.force ? 'yes' : 'no'],
    ['lockStatus', lock && lock.status ? lock.status : ''],
    ['assessmentCode', assessment && assessment.code ? assessment.code : ''],
    ['assessmentMessage', assessment && assessment.message ? assessment.message : ''],
    ['runtimeStatus', health && health.status ? health.status : ''],
    ['runtimeCode', health && health.code ? health.code : ''],
    ['runtimeMessage', health && health.message ? health.message : ''],
    ['nextAction', runtime && runtime.nextAction && runtime.nextAction.code ? runtime.nextAction.code : ''],
    ['review', assessment && assessment.reviewCommand ? assessment.reviewCommand : ''],
    ['command', assessment && assessment.recommendedCommand ? assessment.recommendedCommand : ''],
  ];
  console.log('Mirror Sync Unlock');
  for (const [label, value] of rows) {
    console.log(`${label}: ${value === null || value === undefined ? '' : value}`);
  }
  const guidance = assessment && Array.isArray(assessment.guidance) ? assessment.guidance : [];
  if (guidance.length) {
    console.log('guidance:');
    for (const entry of guidance) {
      console.log(`- ${entry}`);
    }
  }
}

function parseJsonRpcChainId(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^0x[0-9a-f]+$/i.test(text)) {
    return Number.parseInt(text, 16);
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

async function probePolymarketRpcCandidate(rpcUrl, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_chainId',
        params: [],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (payload && payload.error) {
      throw new Error(payload.error.message || 'JSON-RPC error.');
    }
    const chainId = parseJsonRpcChainId(payload && payload.result);
    if (chainId !== POLYMARKET_CHAIN_ID) {
      throw new Error(`unexpected chain id ${chainId === null ? 'unknown' : chainId}; expected ${POLYMARKET_CHAIN_ID}`);
    }
    return { chainId };
  } finally {
    clearTimeout(timeout);
  }
}

async function selectHealthyPolymarketRpc(options = {}) {
  const candidates = normalizeRpcUrlCandidates(
    options.polymarketRpcUrl || (options.env && options.env.POLYMARKET_RPC_URL) || options.rpcUrl || null,
  );
  const attempts = [];
  const diagnostics = [];
  if (!candidates.length) {
    return {
      selectedRpcUrl: null,
      fallbackUsed: false,
      attempts,
      diagnostics,
    };
  }

  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 4_000;
  for (let index = 0; index < candidates.length; index += 1) {
    const rpcUrl = candidates[index];
    try {
      const probe = await probePolymarketRpcCandidate(rpcUrl, timeoutMs);
      attempts.push({
        rpcUrl,
        ok: true,
        chainId: probe.chainId,
        order: index + 1,
      });
      const fallbackUsed = index > 0;
      diagnostics.push(
        fallbackUsed
          ? `Polymarket RPC fallback selected ${rpcUrl} after ${index} failed attempt(s).`
          : `Polymarket RPC connectivity check succeeded on primary endpoint ${rpcUrl}.`,
      );
      return {
        selectedRpcUrl: rpcUrl,
        fallbackUsed,
        attempts,
        diagnostics,
      };
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      attempts.push({
        rpcUrl,
        ok: false,
        error: message,
        order: index + 1,
      });
      diagnostics.push(`Polymarket RPC attempt ${index + 1} failed for ${rpcUrl}: ${message}`);
    }
  }

  return {
    selectedRpcUrl: null,
    fallbackUsed: false,
    attempts,
    diagnostics,
  };
}

/**
 * Handle `mirror sync` command execution (`run|once|start|stop|status|unlock`).
 * Orchestrates sync runtime, daemon lifecycle, and structured output emission.
 * @param {{shared: object, context: object, deps: object, mirrorSyncUsage: string}} params
 * @returns {Promise<void>}
 */
module.exports = async function handleMirrorSync({ shared, context, deps, mirrorSyncUsage }) {
  const selectPolymarketRpc =
    deps && typeof deps.selectHealthyPolymarketRpc === 'function'
      ? deps.selectHealthyPolymarketRpc
      : selectHealthyPolymarketRpc;
  const {
    CliError,
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    maybeLoadTradeEnv,
    resolveIndexerUrl,
    requireFlagValue,
    parsePositiveInteger,
    parseMirrorSyncDaemonSelectorFlags,
    stopMirrorDaemon,
    mirrorDaemonStatus,
    parseMirrorSyncFlags,
    buildMirrorSyncStrategy,
    mirrorStrategyHash,
    buildMirrorSyncDaemonCliArgs,
    startMirrorDaemon,
    resolveTrustedDeployPair,
    verifyMirror,
    runLivePolymarketPreflightForMirror,
    runMirrorSync,
    buildQuotePayload,
    enforceTradeRiskGuards,
    executeTradeOnchain,
    assertLiveWriteAllowed,
    hasWebhookTargets,
    sendWebhookNotifications,
    coerceMirrorServiceError,
    renderMirrorSyncTickLine,
    renderMirrorSyncDaemonTable,
    renderMirrorSyncTable,
    cliPath,
  } = deps;
  const requestedAction = shared.rest[0];
  const helpNotes = [
    'The default mirror stop file is ~/.pandora/mirror/STOP. Its presence intentionally blocks local mirror sync starts and ticks until cleared.',
    'Use `pandora mirror panic --clear ...` after incident review to remove the default stop file, or remove the file manually only if you know the emergency lock is stale.',
    'Use `pandora mirror sync unlock --state-file <path>|--strategy-hash <hash>` to clear stale or invalid pending-action locks; when the lock matches the last blocked execution, unlock also clears the common persisted manual-review blocker so operators do not need JSON surgery.',
    '`mirror sync` does not accept a `--source` flag. `--source auto|api|on-chain` belongs to `pandora polymarket positions`, not the daemon surfaces.',
    '`--stream` in CLI JSON mode is restricted. Use table output for live terminal streaming, or set `PANDORA_DAEMON_LOG_JSONL=1` when you need daemon JSONL logs.',
    'Live mirror sync requires both `--max-open-exposure-usdc` and `--max-trades-per-day` before any execution leg is allowed to start.',
    'Hedging is enabled by default. Add `--no-hedge` only when you intentionally want Pandora-only mirror operation.',
    'Use `--adopt-existing-positions` after a state wipe when the daemon should seed managed Polymarket inventory from live YES/NO holdings before enabling sell-side recycling.',
    'Default hedge scope is `total`, which includes held Pandora outcome tokens in addition to pool reserves. Use `--hedge-scope pool` only when you intentionally want pool-only hedging.',
    '`--skip-initial-hedge` captures the startup hedge gap as a baseline and only hedges later delta changes. It does not change the meaning of `--hedge-scope pool|total`.',
  ];
  const commandName =
    requestedAction === 'status' || requestedAction === 'stop' || requestedAction === 'unlock'
      ? `mirror.sync.${requestedAction}`
      : requestedAction === 'start'
        ? 'mirror.sync.start'
        : 'mirror.sync';
  const operation = createAsyncOperationBridge(
    {
      operationId: context && context.operationId ? context.operationId : null,
      operationContext: context && context.operationContext ? context.operationContext : null,
      operationHooks:
        (context && context.operationHooks)
        || (deps && deps.operationHooks)
        || null,
      operation:
        (context && context.operation)
        || (deps && deps.operation)
        || null,
    },
    {
      command: commandName,
    },
  );

  function finalizePayload(payload) {
    const withOperation = operation.attach(payload);
    if (!operation.diagnostics.length || !withOperation || typeof withOperation !== 'object' || Array.isArray(withOperation)) {
      return withOperation;
    }
    return {
      ...withOperation,
      diagnostics: (Array.isArray(withOperation.diagnostics) ? withOperation.diagnostics : []).concat(operation.diagnostics),
    };
  }

  function resolveRuntimeStateFile(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (payload.stateFile) return payload.stateFile;
    if (payload.metadata && payload.metadata.stateFile) return payload.metadata.stateFile;
    if (payload.strategyHash) {
      return path.join(
        process.env.HOME || process.env.USERPROFILE || '.',
        '.pandora',
        'mirror',
        `${payload.strategyHash}.json`,
      );
    }
    return null;
  }

  function attachRuntimeTelemetry(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return payload;
    }
    const stateFile = resolveRuntimeStateFile(payload);
    if (!stateFile) {
      return {
        ...payload,
        runtime: null,
      };
    }
    const loaded = loadMirrorState(stateFile, payload.strategyHash || null);
    return {
      ...payload,
      runtime: buildMirrorRuntimeTelemetry({
        state: loaded.state,
        stateFile: loaded.filePath,
        daemonStatus: payload,
      }),
    };
  }

  if (requestedAction === 'unlock' && includesHelpFlag(shared.rest.slice(1))) {
    const usage =
      'pandora [--output table|json] mirror sync unlock --state-file <path>|--strategy-hash <hash> [--force] [--stale-after-ms <ms>]';
    const notes = [
      'Unlock clears persisted pending-action lock files only; it does not settle venue state or mutate live positions.',
      'Invalid and zombie locks can be cleared without --force. Reconciliation-required or still-pending locks require operator review and --force.',
      'Use mirror status or mirror health first when you need the current blocking reason before forcing an unlock.',
    ];
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'mirror.sync.unlock.help',
        commandHelpPayload ? commandHelpPayload(usage, notes) : { usage, notes },
      );
    } else {
      console.log(`Usage: ${usage}`);
      for (const note of notes) {
        console.log(note);
      }
    }
    return;
  }

  if (includesHelpFlag(shared.rest)) {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'mirror.sync.help',
        {
          usage:
            mirrorSyncUsage,
          daemonLifecycle: {
            start:
              'pandora [--output table|json] mirror sync start --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [run flags]',
            stop:
              'pandora [--output table|json] mirror sync stop --pid-file <path>|--strategy-hash <hash>|--market-address <address>|--all',
            status:
              'pandora [--output table|json] mirror sync status --pid-file <path>|--strategy-hash <hash>',
            unlock:
              'pandora [--output table|json] mirror sync unlock --state-file <path>|--strategy-hash <hash> [--force] [--stale-after-ms <ms>]',
          },
          liveHedgeEnv: [
            'POLYMARKET_PRIVATE_KEY',
            'POLYMARKET_FUNDER',
            'POLYMARKET_RPC_URL',
            'POLYMARKET_API_KEY',
            'POLYMARKET_API_SECRET',
            'POLYMARKET_API_PASSPHRASE',
            'POLYMARKET_HOST',
          ],
          liveHedgeNotes: {
            POLYMARKET_FUNDER:
              'Set this to your Polymarket proxy wallet (Gnosis Safe) address, not your EOA wallet address.',
            collateral:
              'Polymarket CLOB settles against Polygon USDC.e collateral, but raw wallet collateral can diverge from authenticated CLOB buying power. If balances look wrong, treat that as a scope mismatch first and inspect `pandora polymarket balance` plus `pandora polymarket positions`.',
            inventoryRecycle:
              'Sync can recycle tracked hedge inventory by selling the opposite token when runtime depth proves the sell path is safe; otherwise it falls back to buy-side hedging. Use --adopt-existing-positions to seed managed inventory from existing Polymarket holdings after a state wipe.',
            rpcFallback:
              '--polymarket-rpc-url and POLYMARKET_RPC_URL accept comma-separated Polygon RPC fallbacks tried in order during live preflight.',
          },
          statusTelemetry: {
            health: 'runtime.health reports daemon/runtime status, heartbeat freshness, and pending-action blockers.',
            lastTrade: 'runtime.lastTrade reports the most recent rebalance/hedge execution summary.',
            errors: 'runtime.errorCount and runtime.summary.errorCount report aggregated runtime error alerts.',
            nextAction: 'runtime.nextAction and runtime.summary.nextAction report the operator follow-up the daemon needs next.',
          },
          daemonLogging:
            'Daemon children write compact JSONL records to their log file; inspect them with pandora mirror logs --follow.',
          staleCacheFallback:
            'When Polymarket is unreachable, mirror commands reuse cached snapshots from ~/.pandora/polymarket. Live mode blocks cached sources.',
          notes: helpNotes,
        },
      );
    } else {
      console.log(
        `Usage: ${mirrorSyncUsage}`,
      );
      console.log('Daemon stop: pandora mirror sync stop --pid-file <path>|--strategy-hash <hash>|--market-address <address>|--all');
      console.log('Daemon status: pandora mirror sync status --pid-file <path>|--strategy-hash <hash>');
      console.log('Pending-action unlock: pandora mirror sync unlock --state-file <path>|--strategy-hash <hash> [--force] [--stale-after-ms <ms>]');
      console.log(
        'Live hedge env: POLYMARKET_PRIVATE_KEY, POLYMARKET_FUNDER, POLYMARKET_RPC_URL, POLYMARKET_API_KEY, POLYMARKET_API_SECRET, POLYMARKET_API_PASSPHRASE, POLYMARKET_HOST.',
      );
      console.log('POLYMARKET_FUNDER must be your Polymarket proxy wallet (Gnosis Safe), not your EOA wallet address.');
      console.log('Polymarket CLOB collateral is Polygon USDC.e, but raw wallet collateral can diverge from authenticated CLOB buying power; if balances look wrong, treat it as a scope mismatch first and inspect `pandora polymarket balance` plus `pandora polymarket positions`.');
      console.log('Hedge inventory can be recycled with sell-side orders only when runtime depth proves the sell path is safe; otherwise sync keeps buy-side hedging. Use --adopt-existing-positions after a state wipe to seed managed inventory from live Polymarket YES/NO balances.');
      console.log('Default hedge scope is total exposure across pool reserves and held Pandora outcome tokens. Use --hedge-scope pool only when you intentionally want pool-only hedging.');
      console.log('Polymarket RPC preflight accepts comma-separated --polymarket-rpc-url / POLYMARKET_RPC_URL fallbacks and tries them in order.');
      console.log('Daemon status payloads expose runtime.health, runtime.lastTrade, runtime.errorCount, and runtime.nextAction for operator health checks.');
      console.log('Daemon children write compact JSONL records to their log file; use pandora mirror logs --follow to stream parsed entries.');
      console.log(
        'Polymarket outage fallback: cached snapshots under ~/.pandora/polymarket are reused; live mode blocks cached sources.',
      );
      for (const note of helpNotes) {
        console.log(note);
      }
    }
    return;
  }

  const syncAction = shared.rest[0];
  if (syncAction === 'unlock') {
    const options = parseMirrorSyncUnlockFlags(shared.rest.slice(1), {
      CliError,
      requireFlagValue,
      parsePositiveInteger,
    });
    const stateFile = resolveMirrorSyncUnlockStateFile(options);
    const loaded = loadMirrorState(stateFile, options.strategyHash || null);
    const strategyHash = loaded.state.strategyHash || options.strategyHash || null;
    await operation.ensure({
      phase: 'mirror.sync.unlock.requested',
      strategyHash,
      stateFile,
    });
    const result = unlockPendingActionLock(stateFile, {
      force: options.force,
      staleAfterMs: options.staleAfterMs || undefined,
      strategyHash,
    });
    const runtimeState = result.stateRecovery && result.stateRecovery.updated
      ? loadMirrorState(stateFile, strategyHash).state
      : loaded.state;
    const payload = {
      schemaVersion: '1.0.0',
      generatedAt: new Date().toISOString(),
      stateFile,
      strategyHash,
      force: Boolean(options.force),
      cleared: Boolean(result.cleared),
      reason: result.reason || null,
      assessment: {
        code: result.code,
        message: result.message,
        allowedWithoutForce: Boolean(result.allowedWithoutForce),
        forceRequired: Boolean(result.forceRequired),
        canClear: Boolean(result.canClear),
        blocking: Boolean(result.blocking),
        reviewCommand: result.reviewCommand || null,
        recommendedCommand: result.recommendedCommand || null,
        guidance: Array.isArray(result.guidance) ? result.guidance : [],
      },
      lock: result.clearedLock || result.lock || null,
      stateRecovery: result.stateRecovery || { updated: false, changes: [] },
      runtime: buildMirrorRuntimeTelemetry({
        state: runtimeState,
        stateFile,
      }),
    };
    await operation.update(payload.cleared ? 'cleared' : 'blocked', {
      phase: 'mirror.sync.unlock.complete',
      strategyHash,
      stateFile,
      cleared: payload.cleared,
      reason: payload.reason,
    });
    emitSuccess(
      context.outputMode,
      'mirror.sync.unlock',
      finalizePayload(payload),
      renderMirrorSyncUnlockTable,
    );
    return;
  }

  if (syncAction === 'stop') {
    const selector = parseMirrorSyncDaemonSelectorFlags(shared.rest.slice(1), 'stop');
    await operation.ensure({
      phase: 'mirror.sync.stop.requested',
      strategyHash: selector.strategyHash || null,
    });
    let payload;
    try {
      payload = await stopMirrorDaemon(selector);
    } catch (err) {
      const mirrorError = coerceMirrorServiceError(err, 'MIRROR_SYNC_DAEMON_STOP_FAILED');
      await operation.fail(mirrorError, {
        phase: 'mirror.sync.stop.failed',
      });
      throw mirrorError;
    }
    operation.setOperationId(payload && (payload.operationId || payload.strategyHash || selector.strategyHash || null));
    await operation.update(payload && payload.status ? payload.status : 'stopped', {
      phase: 'mirror.sync.stop.complete',
      found: payload && payload.found,
      alive: payload && payload.alive,
    });
    emitSuccess(
      context.outputMode,
      'mirror.sync.stop',
      finalizePayload(attachRuntimeTelemetry(payload)),
      renderMirrorSyncDaemonTable,
    );
    return;
  }

  if (syncAction === 'status') {
    const selector = parseMirrorSyncDaemonSelectorFlags(shared.rest.slice(1), 'status');
    await operation.ensure({
      phase: 'mirror.sync.status.requested',
      strategyHash: selector.strategyHash || null,
    });
    let payload;
    try {
      payload = mirrorDaemonStatus(selector);
    } catch (err) {
      const mirrorError = coerceMirrorServiceError(err, 'MIRROR_SYNC_DAEMON_STATUS_FAILED');
      await operation.fail(mirrorError, {
        phase: 'mirror.sync.status.failed',
      });
      throw mirrorError;
    }
    operation.setOperationId(payload && (payload.operationId || payload.strategyHash || selector.strategyHash || null));
    await operation.update(payload && payload.status ? payload.status : 'unknown', {
      phase: 'mirror.sync.status.complete',
      found: payload && payload.found,
      alive: payload && payload.alive,
    });
    emitSuccess(
      context.outputMode,
      'mirror.sync.status',
      finalizePayload(attachRuntimeTelemetry(payload)),
      renderMirrorSyncDaemonTable,
    );
    return;
  }

  const isStartAction = syncAction === 'start';
  const syncRunArgs = isStartAction ? ['run', ...shared.rest.slice(1)] : shared.rest;

  maybeLoadTradeEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
  const options = parseMirrorSyncFlags(syncRunArgs);
  const deprecatedForceGateWarning = options.forceGateDeprecatedUsed
    ? 'Flag --force-gate is deprecated; use --skip-gate instead.'
    : null;
  if (deprecatedForceGateWarning && context.outputMode === 'table') {
    console.error(`Warning: ${deprecatedForceGateWarning}`);
  }
  if (isStartAction) {
    options.daemon = true;
  }

  let trustManifest = null;
  let trustDeploy = false;
  if (options.trustDeploy) {
    const trusted = resolveTrustedDeployPair(options);
    trustManifest = {
      filePath: trusted.manifestFile,
      pair: trusted.trustPair,
    };
    trustDeploy = true;
  }

  if (options.daemon) {
    const strategy = buildMirrorSyncStrategy(options);
    const strategyHash = mirrorStrategyHash(strategy);
    if (operation.hasCreateHook || operation.getOperationId()) {
      const ensuredOperationId = await operation.ensure({
        phase: isStartAction ? 'mirror.sync.start.requested' : 'mirror.sync.run.requested',
        strategyHash,
      });
      if (!ensuredOperationId) {
        operation.setOperationId(strategyHash);
      }
    } else {
      operation.setOperationId(strategyHash);
    }
    await operation.checkpoint(isStartAction ? 'mirror.sync.start.requested' : 'mirror.sync.run.requested', {
      executeLive: Boolean(options.executeLive),
      pandoraMarketAddress: options.pandoraMarketAddress || null,
      polymarketMarketId: options.polymarketMarketId || null,
      polymarketSlug: options.polymarketSlug || null,
      strategyHash,
    });
    const daemonCliArgs = buildMirrorSyncDaemonCliArgs(
      {
        ...options,
        mode: 'run',
        stream: Boolean(options.stream),
        trustDeploy,
      },
      shared,
    );
    const daemonEnv = {
      ...process.env,
    };
    if (options.privateKey) {
      daemonEnv.POLYMARKET_PRIVATE_KEY = options.privateKey;
    }
    if (options.funder) {
      daemonEnv.POLYMARKET_FUNDER = options.funder;
    }

    let payload;
    try {
      payload = startMirrorDaemon({
        strategyHash,
        cliPath,
        cliArgs: daemonCliArgs,
        cwd: process.cwd(),
        env: daemonEnv,
        mode: 'run',
        executeLive: options.executeLive,
        stateFile: options.stateFile,
        killSwitchFile: options.killSwitchFile,
        pandoraMarketAddress: options.pandoraMarketAddress,
        polymarketMarketId: options.polymarketMarketId,
        polymarketSlug: options.polymarketSlug,
      });
    } catch (err) {
      const mirrorError = coerceMirrorServiceError(err, 'MIRROR_SYNC_DAEMON_START_FAILED');
      await operation.fail(mirrorError, {
        phase: isStartAction ? 'mirror.sync.start.failed' : 'mirror.sync.run.failed',
        strategyHash,
      });
      throw mirrorError;
    }

    const daemonPayload = {
      ...payload,
      operationId: payload.operationId || operation.getOperationId() || payload.strategyHash || null,
      found: true,
      alive: Boolean(payload.pidAlive),
      status: payload.status || (payload.pidAlive ? 'running' : 'unknown'),
      startupVerification: {
        delegatedToDaemon: true,
        executeLive: Boolean(options.executeLive),
        reason: 'Startup verification and live preflight run inside the daemon child so start remains non-blocking.',
      },
    };
    if (trustManifest) {
      daemonPayload.trustManifest = trustManifest;
    }
    if (deprecatedForceGateWarning) {
      const existingDiagnostics = Array.isArray(daemonPayload.diagnostics) ? daemonPayload.diagnostics : [];
      daemonPayload.diagnostics = [...existingDiagnostics, deprecatedForceGateWarning];
    }
    await operation.update(daemonPayload.status, {
      phase: isStartAction ? 'mirror.sync.start.complete' : 'mirror.sync.run.complete',
      strategyHash: daemonPayload.strategyHash || strategyHash,
      pid: daemonPayload.pid || null,
      alive: daemonPayload.alive,
    });

    emitSuccess(
      context.outputMode,
      isStartAction ? 'mirror.sync.start' : 'mirror.sync',
      finalizePayload(attachRuntimeTelemetry(daemonPayload)),
      renderMirrorSyncDaemonTable,
    );
    return;
  }

  if (context.outputMode === 'json' && options.stream && process.env.PANDORA_DAEMON_LOG_JSONL !== '1') {
    throw new CliError(
      'INVALID_ARGS',
      '--stream is only supported in table output mode. Use --output table or remove --stream.',
    );
  }

  const streamTicks = options.stream || (options.mode === 'run' && context.outputMode === 'table');
  let polymarketPreflight = null;
  let selectedPolymarketRpcUrl = options.polymarketRpcUrl || options.rpcUrl || null;

  if (options.executeLive) {
    try {
      const rpcSelection = await selectPolymarketRpc({
        polymarketRpcUrl: options.polymarketRpcUrl,
        rpcUrl: options.rpcUrl,
        timeoutMs: shared.timeoutMs,
        env: process.env,
      });
      if (rpcSelection.attempts.length && !rpcSelection.selectedRpcUrl) {
        throw new CliError(
          'POLYMARKET_RPC_UNREACHABLE',
          'Unable to reach a Polygon RPC endpoint for Polymarket preflight.',
          rpcSelection,
        );
      }
      selectedPolymarketRpcUrl = rpcSelection.selectedRpcUrl || options.polymarketRpcUrl || options.rpcUrl || null;
      polymarketPreflight = await runLivePolymarketPreflightForMirror({
        rpcUrl: selectedPolymarketRpcUrl || options.rpcUrl,
        polymarketRpcUrl: selectedPolymarketRpcUrl,
        privateKey: options.privateKey,
        funder: options.funder,
      });
      if (rpcSelection.attempts.length) {
        const existingDiagnostics = Array.isArray(polymarketPreflight.diagnostics) ? polymarketPreflight.diagnostics : [];
        polymarketPreflight = {
          ...polymarketPreflight,
          rpcSelection,
          diagnostics: existingDiagnostics.concat(rpcSelection.diagnostics),
        };
      }
    } catch (err) {
      throw coerceMirrorServiceError(err, 'MIRROR_SYNC_PREFLIGHT_FAILED');
    }
  }

  let payload;
  try {
    await operation.checkpoint('mirror.sync.execution.requested', {
      mode: options.mode,
      executeLive: Boolean(options.executeLive),
      pandoraMarketAddress: options.pandoraMarketAddress || null,
      polymarketMarketId: options.polymarketMarketId || null,
      polymarketSlug: options.polymarketSlug || null,
    });
    payload = await runMirrorSync(
      {
        ...options,
        trustDeploy,
        indexerUrl,
        timeoutMs: shared.timeoutMs,
        polymarketRpcUrl: selectedPolymarketRpcUrl,
      },
      {
        rebalanceFn: async (executionOptions) => {
          const tradeOptions = normalizeMirrorRebalanceTradeOptions(executionOptions, {
            chainId: options.chainId,
            rpcUrl: options.rpcUrl,
            fork: options.fork,
            forkRpcUrl: options.forkRpcUrl,
            forkChainId: options.forkChainId,
            privateKey: options.privateKey,
            profileId: options.profileId || null,
            profileFile: options.profileFile || null,
            usdc: options.usdc,
            rebalanceRoute: options.rebalanceRoute,
            rebalanceRouteFallback: options.rebalanceRouteFallback,
            flashbotsRelayUrl: options.flashbotsRelayUrl,
            flashbotsAuthKey: options.flashbotsAuthKey,
            flashbotsTargetBlockOffset: options.flashbotsTargetBlockOffset,
          });
          if (typeof assertLiveWriteAllowed === 'function') {
            await assertLiveWriteAllowed('mirror.sync.execute', {
              notionalUsdc: executionOptions.amountUsdc,
              runtimeMode: options.fork || options.forkRpcUrl ? 'fork' : 'live',
            });
          }
          const quote = await buildQuotePayload(indexerUrl, tradeOptions, shared.timeoutMs);
          enforceTradeRiskGuards(tradeOptions, quote);
          const execution = await executeTradeOnchain(tradeOptions);
          return {
            ...execution,
            quote,
          };
        },
        sendWebhook: async (webhookContext) => {
          if (!hasWebhookTargets(options)) {
            return {
              schemaVersion: null,
              generatedAt: new Date().toISOString(),
              count: 0,
              successCount: 0,
              failureCount: 0,
              results: [],
            };
          }
          const report = await sendWebhookNotifications(options, webhookContext);
          if (options.failOnWebhookError && report.failureCount > 0) {
            throw new CliError('WEBHOOK_DELIVERY_FAILED', 'mirror sync webhook delivery failed.', { report });
          }
          return report;
        },
        onTick: streamTicks ? (tickContext) => renderMirrorSyncTickLine({ ...tickContext, verbose: Boolean(options.verbose) }, context.outputMode) : null,
      },
    );
  } catch (err) {
    const mirrorError = coerceMirrorServiceError(err, 'MIRROR_SYNC_FAILED');
    await operation.fail(mirrorError, {
      phase: 'mirror.sync.execution.failed',
      mode: options.mode,
      error: {
        code: mirrorError.code || null,
        message: mirrorError.message || String(mirrorError),
        details: mirrorError.details || null,
      },
    });
    throw mirrorError;
  }

  operation.setOperationId(payload && (payload.operationId || payload.strategyHash || null));
  await operation.complete({
    phase: 'mirror.sync.execution.complete',
    mode: payload && payload.mode ? payload.mode : options.mode,
    strategyHash: payload && payload.strategyHash ? payload.strategyHash : null,
    actionCount: payload && Number.isFinite(payload.actionCount) ? payload.actionCount : null,
    result: buildMirrorSyncOperationResult(payload),
  });
  if (trustManifest) {
    payload.trustManifest = trustManifest;
  }
  if (polymarketPreflight) {
    payload.polymarketPreflight = polymarketPreflight;
    const rpcSelectionDiagnostics = buildRpcSelectionSummary(polymarketPreflight.rpcSelection, 'Polymarket RPC');
    if (rpcSelectionDiagnostics.length) {
      const existingDiagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
      payload.diagnostics = existingDiagnostics.concat(
        rpcSelectionDiagnostics.filter((entry) => !existingDiagnostics.includes(entry)),
      );
    }
  }
  if (deprecatedForceGateWarning) {
    const existingDiagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
    payload.diagnostics = [...existingDiagnostics, deprecatedForceGateWarning];
  }

  emitSuccess(
    context.outputMode,
    'mirror.sync',
    finalizePayload(attachRuntimeTelemetry(payload)),
    renderMirrorSyncTable,
  );
};

module.exports.normalizeMirrorRebalanceTradeOptions = normalizeMirrorRebalanceTradeOptions;
module.exports.selectHealthyPolymarketRpc = selectHealthyPolymarketRpc;
module.exports.probePolymarketRpcCandidate = probePolymarketRpcCandidate;
module.exports.buildMirrorSyncOperationResult = buildMirrorSyncOperationResult;
