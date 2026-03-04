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
      console.log(
        'Polymarket outage fallback: cached snapshots under ~/.pandora/polymarket are reused; live mode blocks cached sources.',
      );
    }
    return;
  }

  const syncAction = shared.rest[0];
  if (syncAction === 'stop') {
    const selector = parseMirrorSyncDaemonSelectorFlags(shared.rest.slice(1), 'stop');
    let payload;
    try {
      payload = await stopMirrorDaemon(selector);
    } catch (err) {
      throw coerceMirrorServiceError(err, 'MIRROR_SYNC_DAEMON_STOP_FAILED');
    }
    emitSuccess(context.outputMode, 'mirror.sync.stop', payload, renderMirrorSyncDaemonTable);
    return;
  }

  if (syncAction === 'status') {
    const selector = parseMirrorSyncDaemonSelectorFlags(shared.rest.slice(1), 'status');
    let payload;
    try {
      payload = mirrorDaemonStatus(selector);
    } catch (err) {
      throw coerceMirrorServiceError(err, 'MIRROR_SYNC_DAEMON_STATUS_FAILED');
    }
    emitSuccess(context.outputMode, 'mirror.sync.status', payload, renderMirrorSyncDaemonTable);
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
      throw coerceMirrorServiceError(err, 'MIRROR_SYNC_DAEMON_START_FAILED');
    }

    const daemonPayload = {
      ...payload,
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

    emitSuccess(
      context.outputMode,
      isStartAction ? 'mirror.sync.start' : 'mirror.sync',
      daemonPayload,
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
    throw coerceMirrorServiceError(err, 'MIRROR_SYNC_FAILED');
  }

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

  emitSuccess(context.outputMode, 'mirror.sync', payload, renderMirrorSyncTable);
};
