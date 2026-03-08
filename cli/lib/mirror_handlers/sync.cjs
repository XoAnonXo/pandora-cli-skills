const { createAsyncOperationBridge } = require('../shared/operation_bridge.cjs');

/**
 * Handle `mirror sync` command execution (`run|once|start|stop|status`).
 * Orchestrates sync runtime, daemon lifecycle, and structured output emission.
 * @param {{shared: object, context: object, deps: object, mirrorSyncUsage: string}} params
 * @returns {Promise<void>}
 */
module.exports = async function handleMirrorSync({ shared, context, deps, mirrorSyncUsage }) {
  const {
    CliError,
    includesHelpFlag,
    emitSuccess,
    maybeLoadTradeEnv,
    resolveIndexerUrl,
    parseMirrorSyncDaemonSelectorFlags,
    stopMirrorDaemon,
    mirrorDaemonStatus,
    parseMirrorSyncFlags,
    buildMirrorSyncStrategy,
    mirrorStrategyHash,
    buildMirrorSyncDaemonCliArgs,
    startMirrorDaemon,
    resolveTrustedDeployPair,
    runLivePolymarketPreflightForMirror,
    runMirrorSync,
    buildQuotePayload,
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
  const commandName =
    requestedAction === 'status' || requestedAction === 'stop'
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
              'Polymarket CLOB settles against Polygon USDC.e collateral. Ensure USDC.e balance/allowances are configured on the proxy wallet.',
            inventoryRecycle:
              'Sync can recycle tracked hedge inventory by selling the opposite token when runtime depth proves the sell path is safe; otherwise it falls back to buy-side hedging.',
          },
          staleCacheFallback:
            'When Polymarket is unreachable, mirror commands reuse cached snapshots from ~/.pandora/polymarket. Live mode blocks cached sources.',
        },
      );
    } else {
      console.log(
        `Usage: ${mirrorSyncUsage}`,
      );
      console.log('Daemon stop: pandora mirror sync stop --pid-file <path>|--strategy-hash <hash>|--market-address <address>|--all');
      console.log('Daemon status: pandora mirror sync status --pid-file <path>|--strategy-hash <hash>');
      console.log(
        'Live hedge env: POLYMARKET_PRIVATE_KEY, POLYMARKET_FUNDER, POLYMARKET_RPC_URL, POLYMARKET_API_KEY, POLYMARKET_API_SECRET, POLYMARKET_API_PASSPHRASE, POLYMARKET_HOST.',
      );
      console.log('POLYMARKET_FUNDER must be your Polymarket proxy wallet (Gnosis Safe), not your EOA wallet address.');
      console.log('Polymarket CLOB collateral is Polygon USDC.e; ensure proxy wallet USDC.e balance and approvals are configured.');
      console.log('Hedge inventory can be recycled with sell-side orders only when runtime depth proves the sell path is safe; otherwise sync keeps buy-side hedging.');
      console.log(
        'Polymarket outage fallback: cached snapshots under ~/.pandora/polymarket are reused; live mode blocks cached sources.',
      );
    }
    return;
  }

  const syncAction = shared.rest[0];
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
    emitSuccess(context.outputMode, 'mirror.sync.stop', finalizePayload(payload), renderMirrorSyncDaemonTable);
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
    emitSuccess(context.outputMode, 'mirror.sync.status', finalizePayload(payload), renderMirrorSyncDaemonTable);
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
        stream: true,
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
      finalizePayload(daemonPayload),
      renderMirrorSyncDaemonTable,
    );
    return;
  }

  if (context.outputMode === 'json' && options.stream) {
    throw new CliError(
      'INVALID_ARGS',
      '--stream is only supported in table output mode. Use --output table or remove --stream.',
    );
  }

  const streamTicks = options.stream || (options.mode === 'run' && context.outputMode === 'table');
  let polymarketPreflight = null;

  if (options.executeLive) {
    try {
      polymarketPreflight = await runLivePolymarketPreflightForMirror({
        rpcUrl: options.polymarketRpcUrl || options.rpcUrl,
        polymarketRpcUrl: options.polymarketRpcUrl,
        privateKey: options.privateKey,
        funder: options.funder,
      });
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
      },
      {
        rebalanceFn: async (executionOptions) => {
          const tradeOptions = {
            marketAddress: executionOptions.marketAddress,
            side: executionOptions.side,
            amountUsdc: executionOptions.amountUsdc,
            yesPct: null,
            slippageBps: 150,
            dryRun: false,
            execute: true,
            minSharesOutRaw: null,
            maxAmountUsdc: executionOptions.amountUsdc,
            minProbabilityPct: null,
            maxProbabilityPct: null,
            allowUnquotedExecute: true,
            chainId: options.chainId,
            rpcUrl: options.rpcUrl,
            privateKey: options.privateKey,
            profileId: options.profileId || null,
            profileFile: options.profileFile || null,
            usdc: options.usdc,
          };
          if (typeof assertLiveWriteAllowed === 'function') {
            await assertLiveWriteAllowed('mirror.sync.execute', {
              notionalUsdc: executionOptions.amountUsdc,
              runtimeMode: options.fork || options.forkRpcUrl ? 'fork' : 'live',
            });
          }
          const quote = await buildQuotePayload(indexerUrl, tradeOptions, shared.timeoutMs);
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
        onTick: streamTicks ? (tickContext) => renderMirrorSyncTickLine(tickContext, context.outputMode) : null,
      },
    );
  } catch (err) {
    const mirrorError = coerceMirrorServiceError(err, 'MIRROR_SYNC_FAILED');
    await operation.fail(mirrorError, {
      phase: 'mirror.sync.execution.failed',
      mode: options.mode,
    });
    throw mirrorError;
  }

  operation.setOperationId(payload && (payload.operationId || payload.strategyHash || null));
  await operation.complete({
    phase: 'mirror.sync.execution.complete',
    mode: payload && payload.mode ? payload.mode : options.mode,
    strategyHash: payload && payload.strategyHash ? payload.strategyHash : null,
    actionCount: payload && Number.isFinite(payload.actionCount) ? payload.actionCount : null,
  });
  if (trustManifest) {
    payload.trustManifest = trustManifest;
  }
  if (polymarketPreflight) {
    payload.polymarketPreflight = polymarketPreflight;
  }
  if (deprecatedForceGateWarning) {
    const existingDiagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
    payload.diagnostics = [...existingDiagnostics, deprecatedForceGateWarning];
  }

  emitSuccess(context.outputMode, 'mirror.sync', finalizePayload(payload), renderMirrorSyncTable);
};
