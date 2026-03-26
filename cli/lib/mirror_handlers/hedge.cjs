function renderKeyValueRows(title, rows) {
  console.log(title);
  for (const [label, value] of rows) {
    const rendered =
      value === null || value === undefined
        ? ''
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
    console.log(`${label}: ${rendered}`);
  }
}

function renderMirrorHedgeTable(data) {
  const selector = data.selector || {};
  const plan = data.plan || {};
  const bundle = data.bundle || {};
  const daemon = data.daemon || {};
  const runtime = data.runtime || {};

  renderKeyValueRows('Mirror Hedge', [
    ['mode', data.mode || ''],
    ['stateFile', data.stateFile || ''],
    ['strategyHash', data.strategyHash || ''],
    ['pandoraMarketAddress', selector.pandoraMarketAddress || ''],
    ['polymarketMarketId', selector.polymarketMarketId || ''],
    ['polymarketSlug', selector.polymarketSlug || ''],
    ['status', data.status || daemon.status || ''],
    ['daemonPid', daemon.pid ?? ''],
    ['daemonAlive', daemon.alive === null || daemon.alive === undefined ? '' : daemon.alive ? 'yes' : 'no'],
    ['operationId', daemon.operationId || ''],
    ['planSummary', plan.summary || plan.actionSummary || plan.rebalanceSummary || ''],
    ['bundleSummary', bundle.summary || bundle.route || ''],
    ['runtimeStatus', runtime.status || ''],
    ['diagnostics', Array.isArray(data.diagnostics) ? data.diagnostics.join(' | ') : ''],
  ]);
}

function renderMirrorHedgeDaemonTable(data) {
  const daemon = data.daemon || {};
  const selector = data.selector || {};
  const runtime = data.runtime || {};
  const summary = data.summary || {};
  const readiness = data.readiness || {};
  renderKeyValueRows('Mirror Hedge Daemon', [
    ['mode', data.mode || ''],
    ['stateFile', data.stateFile || ''],
    ['strategyHash', data.strategyHash || ''],
    ['pid', daemon.pid ?? ''],
    ['pidFile', daemon.pidFile || ''],
    ['logFile', daemon.logFile || ''],
    ['operationId', daemon.operationId || ''],
    ['alive', daemon.alive === null || daemon.alive === undefined ? '' : daemon.alive ? 'yes' : 'no'],
    ['status', daemon.status || data.status || ''],
    ['runtimeStatus', runtime.status || ''],
    ['startedAt', runtime.startedAt || ''],
    ['lastTickAt', runtime.lastTickAt || ''],
    ['iterationsRequested', runtime.iterationsRequested === null || runtime.iterationsRequested === undefined ? '' : runtime.iterationsRequested],
    ['iterationsCompleted', runtime.iterationsCompleted === null || runtime.iterationsCompleted === undefined ? '' : runtime.iterationsCompleted],
    ['ready', readiness.ready === null || readiness.ready === undefined ? '' : readiness.ready ? 'yes' : 'no'],
    ['missing', Array.isArray(readiness.missing) ? readiness.missing.join(', ') : ''],
    ['marketAddress', selector.pandoraMarketAddress || ''],
    ['polymarketMarketId', selector.polymarketMarketId || ''],
    ['polymarketSlug', selector.polymarketSlug || ''],
    ['confirmedExposureCount', summary.confirmedExposureCount ?? ''],
    ['confirmedExposureUsdc', summary.confirmedExposureUsdc ?? ''],
    ['pendingOverlayCount', summary.pendingOverlayCount ?? ''],
    ['pendingOverlayUsdc', summary.pendingOverlayUsdc ?? ''],
    ['deferredHedgeCount', summary.deferredHedgeCount ?? ''],
    ['deferredHedgeUsdc', summary.deferredHedgeUsdc ?? ''],
    ['targetYesShares', summary.targetYesShares ?? ''],
    ['targetNoShares', summary.targetNoShares ?? ''],
    ['currentYesShares', summary.currentYesShares ?? ''],
    ['currentNoShares', summary.currentNoShares ?? ''],
    ['excessYesToSell', summary.excessYesToSell ?? ''],
    ['excessNoToSell', summary.excessNoToSell ?? ''],
    ['deficitYesToBuy', summary.deficitYesToBuy ?? ''],
    ['deficitNoToBuy', summary.deficitNoToBuy ?? ''],
    ['netTargetSide', summary.netTargetSide || ''],
    ['netTargetShares', summary.netTargetShares ?? ''],
    ['availableHedgeFeeBudgetUsdc', summary.availableHedgeFeeBudgetUsdc ?? ''],
    ['belowThresholdPendingUsdc', summary.belowThresholdPendingUsdc ?? ''],
    ['sellRetryAttemptedCount', summary.sellRetryAttemptedCount ?? ''],
    ['sellRetryBlockedCount', summary.sellRetryBlockedCount ?? ''],
    ['sellRetryFailedCount', summary.sellRetryFailedCount ?? ''],
    ['sellRetryRecoveredCount', summary.sellRetryRecoveredCount ?? ''],
    ['warningCount', summary.warningCount ?? ''],
    ['skippedVolumeUsdc', summary.skippedVolumeUsdc ?? ''],
    ['lastSuccessfulHedgeAt', summary.lastSuccessfulHedgeAt || ''],
    ['lastErrorCode', summary.lastErrorCode || ''],
    ['lastAlertCode', summary.lastAlertCode || ''],
    ['stoppedReason', runtime.stoppedReason || ''],
    ['exitCode', runtime.exitCode === null || runtime.exitCode === undefined ? '' : runtime.exitCode],
    ['exitAt', runtime.exitAt || ''],
    ['diagnostics', Array.isArray(data.diagnostics) ? data.diagnostics.join(' | ') : ''],
  ]);
  if (Array.isArray(data.warnings) && data.warnings.length) {
    console.log('warnings:');
    for (const warning of data.warnings) {
      const code = warning && warning.code ? `[${warning.code}] ` : '';
      console.log(`- ${code}${warning && warning.message ? warning.message : JSON.stringify(warning)}`);
    }
  }
}

function helpPayload(emitSuccess, commandHelpPayload, context, kind, usage, notes) {
  if (context.outputMode === 'json') {
    emitSuccess(context.outputMode, `mirror.hedge.${kind}.help`, commandHelpPayload(usage, notes));
  } else {
    console.log(`Usage: ${usage}`);
    if (notes && notes.length) {
      console.log('');
      console.log('Notes:');
      for (const note of notes) {
        console.log(`- ${note}`);
      }
    }
  }
}

function buildFamilyNotes() {
  return [
    'mirror hedge is the LP-hedging runtime family; it plans and manages LP hedge posture separately from mirror sync, which remains the Pandora rebalance plus Polymarket hedge leg workflow.',
    'plan and bundle are read-only planning surfaces. run and start are mutating runtime surfaces. status and stop are selector-first detached daemon controls.',
    'bundle produces deterministic VPS deployment artifacts for the packaged hedge daemon; it does not change live positions by itself.',
  ];
}

function buildPlanNotes() {
  return [
    'mirror hedge plan is read-only and should be used before any live hedge execution.',
    'The planner prefers selector-first resolution from state files, strategy hashes, or resolved market pairs so MCP agents can reason about LP hedge posture without writing state.',
    'LP hedging keeps separate from mirror sync: sync still drives the Pandora rebalance plus Polymarket hedge legs, while hedge focuses on LP hedge posture and bundle/run lifecycle.',
    'Provide --internal-wallets-file so the planner can exclude internal wallet volume from hedge calculations.',
  ];
}

function buildRunNotes() {
  return [
    'mirror hedge run executes the LP hedge loop in the foreground.',
    'Live hedge execution still needs a valid internal-wallet whitelist plus Polymarket signer/funder readiness.',
    '--min-hedge-usdc is an execution threshold for the net target-vs-actual hedge gap; it no longer permanently ignores small external trades.',
    '--adopt-existing-positions treats observed Polymarket inventory as the starting live hedge baseline and then trades only the delta to target.',
    'Use start for detached daemon mode, and status/stop for selector-first lifecycle control.',
  ];
}

function buildStartNotes() {
  return [
    'mirror hedge start launches the LP hedge daemon in detached mode.',
    'Use status or stop with the daemon selector flags to inspect or terminate a running hedge daemon.',
  ];
}

function buildStatusNotes() {
  return [
    'mirror hedge status is the detached-daemon health and runtime surface for LP hedge runs.',
    'Use pid-file or strategy-hash when you already know the daemon identity; use stop with the same selector family to terminate it.',
  ];
}

function buildStopNotes() {
  return [
    'mirror hedge stop terminates a selected LP hedge daemon without changing the documented sync semantics.',
    'market-address and all selectors are only supported for stop, matching the detached-daemon lifecycle pattern used by mirror sync.',
  ];
}

module.exports = async function handleMirrorHedge({ actionArgs, shared, context, deps }) {
  const {
    CliError,
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    maybeLoadIndexerEnv,
    maybeLoadTradeEnv,
    resolveIndexerUrl,
    parseMirrorHedgePlanFlags,
    parseMirrorHedgeRunFlags,
    parseMirrorHedgeDaemonSelectorFlags,
    buildMirrorHedgePlan,
    buildMirrorHedgeBundle,
    runMirrorHedge,
    startMirrorHedgeDaemon,
    getMirrorHedgeDaemonStatus,
    stopMirrorHedgeDaemon,
    coerceMirrorServiceError,
  } = deps;

  const mode = actionArgs[0];
  const rest = actionArgs.slice(1);
  const familyUsage = 'pandora [--output table|json] mirror hedge plan|run|start|status|stop|bundle ...';

  if (!mode || mode === '--help' || mode === '-h') {
    helpPayload(emitSuccess, commandHelpPayload, context, 'help', familyUsage, buildFamilyNotes());
    return;
  }

  if (!['plan', 'run', 'start', 'status', 'stop', 'bundle'].includes(mode)) {
    throw new CliError('INVALID_ARGS', 'mirror hedge requires subcommand plan|run|start|status|stop|bundle.');
  }

  const subcommandUsage = {
    plan:
      'pandora [--output table|json] mirror hedge plan --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) --internal-wallets-file <path> [--min-hedge-usdc <n>] [--partial-hedge-policy partial|skip] [--sell-hedge-policy depth-checked|manual-only] [--trust-deploy] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
    bundle:
      'pandora [--output table|json] mirror hedge bundle --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) --internal-wallets-file <path> [--output-dir <path>|--bundle-dir <path>] [--min-hedge-usdc <n>] [--partial-hedge-policy partial|skip] [--sell-hedge-policy depth-checked|manual-only] [--trust-deploy] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
    run:
      'pandora [--output table|json] mirror hedge run --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) --internal-wallets-file <path> [--paper|--dry-run|--execute-live|--execute] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--usdc <address>] [--chain-id <id>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--trust-deploy] [--indexer-url <url>] [--timeout-ms <ms>] [--interval-ms <ms>] [--iterations <n>] [--adopt-existing-positions] [--min-hedge-usdc <n>] [--partial-hedge-policy partial|skip] [--sell-hedge-policy depth-checked|manual-only] [--depth-slippage-bps <n>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
    start:
      'pandora [--output table|json] mirror hedge start --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) --internal-wallets-file <path> [--paper|--dry-run|--execute-live|--execute] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--usdc <address>] [--chain-id <id>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--trust-deploy] [--indexer-url <url>] [--timeout-ms <ms>] [--interval-ms <ms>] [--iterations <n>] [--adopt-existing-positions] [--min-hedge-usdc <n>] [--partial-hedge-policy partial|skip] [--sell-hedge-policy depth-checked|manual-only] [--depth-slippage-bps <n>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
    status:
      'pandora [--output table|json] mirror hedge status --pid-file <path>|--strategy-hash <hash>',
    stop:
      'pandora [--output table|json] mirror hedge stop --pid-file <path>|--strategy-hash <hash>|--market-address <address>|--all',
  };

  const subcommandNotes = {
    plan: buildPlanNotes(),
    bundle: [
      'mirror hedge bundle is the read-only bundle planning surface for LP hedging.',
      'Use it to emit deterministic VPS deployment artifacts without submitting a live hedge transaction.',
    ],
    run: buildRunNotes(),
    start: buildStartNotes(),
    status: buildStatusNotes(),
    stop: buildStopNotes(),
  };

  if (includesHelpFlag(rest)) {
    const usage = subcommandUsage[mode];
    const notes = subcommandNotes[mode] || buildFamilyNotes();
    helpPayload(emitSuccess, commandHelpPayload, context, mode, usage, notes);
    return;
  }

  if (mode === 'plan' || mode === 'bundle') {
    maybeLoadIndexerEnv(shared);
    const options = parseMirrorHedgePlanFlags([mode, ...rest]);
    if (!options.indexerUrl && shared && shared.indexerUrl) {
      options.indexerUrl = shared.indexerUrl;
    }
    if (!options.timeoutMs && shared) {
      options.timeoutMs = shared.timeoutMs;
    }
    let payload;
    try {
      payload = mode === 'bundle'
        ? await buildMirrorHedgeBundle({
            ...options,
            indexerUrl: resolveIndexerUrl(options.indexerUrl || shared.indexerUrl),
            timeoutMs: options.timeoutMs || shared.timeoutMs,
          })
        : await buildMirrorHedgePlan({
            ...options,
            indexerUrl: resolveIndexerUrl(options.indexerUrl || shared.indexerUrl),
            timeoutMs: options.timeoutMs || shared.timeoutMs,
          });
    } catch (err) {
      throw coerceMirrorServiceError(err, mode === 'bundle' ? 'MIRROR_HEDGE_BUNDLE_FAILED' : 'MIRROR_HEDGE_PLAN_FAILED');
    }
    emitSuccess(context.outputMode, `mirror.hedge.${mode}`, payload, mode === 'bundle' ? renderMirrorHedgeTable : renderMirrorHedgeTable);
    return;
  }

  if (mode === 'run' || mode === 'start') {
    maybeLoadIndexerEnv(shared);
    maybeLoadTradeEnv(shared);
    const options = parseMirrorHedgeRunFlags([mode, ...rest]);
    if (!options.indexerUrl && shared && shared.indexerUrl) {
      options.indexerUrl = shared.indexerUrl;
    }
    if (!options.timeoutMs && shared) {
      options.timeoutMs = shared.timeoutMs;
    }
    let payload;
    try {
      payload = mode === 'start'
        ? await startMirrorHedgeDaemon({
            ...options,
            indexerUrl: resolveIndexerUrl(options.indexerUrl || shared.indexerUrl),
            timeoutMs: options.timeoutMs || shared.timeoutMs,
            useEnvFile: shared.useEnvFile,
            envFileExplicit: shared.envFileExplicit,
            envFile: shared.envFile,
            daemon: true,
          })
        : await runMirrorHedge({
            ...options,
            indexerUrl: resolveIndexerUrl(options.indexerUrl || shared.indexerUrl),
            timeoutMs: options.timeoutMs || shared.timeoutMs,
          });
    } catch (err) {
      throw coerceMirrorServiceError(err, mode === 'start' ? 'MIRROR_HEDGE_START_FAILED' : 'MIRROR_HEDGE_RUN_FAILED');
    }
    emitSuccess(context.outputMode, `mirror.hedge.${mode}`, payload, renderMirrorHedgeTable);
    return;
  }

  const selector = parseMirrorHedgeDaemonSelectorFlags(rest, mode);
  let payload;
  try {
    payload = mode === 'status'
      ? await getMirrorHedgeDaemonStatus(selector)
      : await stopMirrorHedgeDaemon(selector);
  } catch (err) {
    throw coerceMirrorServiceError(err, mode === 'status' ? 'MIRROR_HEDGE_STATUS_FAILED' : 'MIRROR_HEDGE_STOP_FAILED');
  }

  emitSuccess(
    context.outputMode,
    `mirror.hedge.${mode}`,
    payload,
    mode === 'status' ? renderMirrorHedgeDaemonTable : renderMirrorHedgeDaemonTable,
  );
};
