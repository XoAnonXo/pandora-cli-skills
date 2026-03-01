/**
 * Handle `mirror go` command execution.
 * Orchestrates plan -> deploy -> verify -> optional sync/trade flow and emits a combined payload.
 * @param {{shared: object, context: object, deps: object, mirrorGoUsage: string}} params
 * @returns {Promise<void>}
 */
module.exports = async function handleMirrorGo({ shared, context, deps, mirrorGoUsage }) {
  const {
    CliError,
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    maybeLoadTradeEnv,
    resolveIndexerUrl,
    parseMirrorGoFlags,
    buildMirrorPlan,
    deployMirror,
    resolveTrustedDeployPair,
    verifyMirror,
    runLivePolymarketPreflightForMirror,
    runMirrorSync,
    buildQuotePayload,
    executeTradeOnchain,
    renderMirrorSyncTickLine,
    coerceMirrorServiceError,
    renderMirrorGoTable,
  } = deps;

  if (includesHelpFlag(shared.rest)) {
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'mirror.go.help', commandHelpPayload(mirrorGoUsage));
    } else {
      console.log(`Usage: ${mirrorGoUsage}`);
    }
    return;
  }

  maybeLoadTradeEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
  const options = parseMirrorGoFlags(shared.rest);
  const deprecatedForceGateWarning = options.forceGateDeprecatedUsed
    ? 'Flag --force-gate is deprecated; use --skip-gate instead.'
    : null;
  if (deprecatedForceGateWarning && context.outputMode === 'table') {
    console.error(`Warning: ${deprecatedForceGateWarning}`);
  }

  let planPayload;
  let deployPayload;
  try {
    planPayload = await buildMirrorPlan({
      ...options,
      indexerUrl,
      timeoutMs: shared.timeoutMs,
    });
    deployPayload = await deployMirror({
      ...options,
      planData: planPayload,
      execute: options.executeLive,
      indexerUrl,
      timeoutMs: shared.timeoutMs,
    });
  } catch (err) {
    throw coerceMirrorServiceError(err, 'MIRROR_GO_FAILED');
  }

  const pandoraMarketAddress = deployPayload && deployPayload.pandora ? deployPayload.pandora.marketAddress : null;
  const sourceSelector = {
    polymarketMarketId:
      (planPayload && planPayload.sourceMarket && planPayload.sourceMarket.marketId) || options.polymarketMarketId || null,
    polymarketSlug:
      (planPayload && planPayload.sourceMarket && planPayload.sourceMarket.slug) || options.polymarketSlug || null,
  };

  let verifyPayload = null;
  let syncPayload = null;
  let polymarketPreflight = null;
  let suggestedSyncCommand = null;
  let trustManifest = deployPayload && deployPayload.trustManifest ? deployPayload.trustManifest : null;
  let trustDeploy = Boolean(options.trustDeploy);
  if (!trustDeploy && trustManifest && trustManifest.pair) {
    trustDeploy = true;
  }
  const diagnostics = [];
  if (deprecatedForceGateWarning) diagnostics.push(deprecatedForceGateWarning);

  if (pandoraMarketAddress) {
    if (!trustManifest && (options.executeLive || options.trustDeploy)) {
      try {
        const trusted = resolveTrustedDeployPair({
          pandoraMarketAddress,
          ...sourceSelector,
          manifestFile: options.manifestFile,
        });
        trustManifest = {
          filePath: trusted.manifestFile,
          pair: trusted.trustPair,
        };
        trustDeploy = true;
      } catch (err) {
        if (options.trustDeploy) {
          throw err;
        }
        diagnostics.push(err && err.message ? err.message : String(err));
      }
    }

    try {
      verifyPayload = await verifyMirror({
        indexerUrl,
        timeoutMs: shared.timeoutMs,
        pandoraMarketAddress,
        ...sourceSelector,
        polymarketHost: options.polymarketHost,
        polymarketGammaUrl: options.polymarketGammaUrl,
        polymarketGammaMockUrl: options.polymarketGammaMockUrl,
        polymarketMockUrl: options.polymarketMockUrl,
        trustDeploy,
        includeSimilarity: options.includeSimilarity,
        allowRuleMismatch: false,
      });
    } catch (err) {
      throw coerceMirrorServiceError(err, 'MIRROR_GO_VERIFY_FAILED');
    }

    if (!options.withRules && verifyPayload && verifyPayload.pandora) {
      delete verifyPayload.pandora.rules;
      if (verifyPayload.sourceMarket) delete verifyPayload.sourceMarket.description;
    }

    if (options.autoSync) {
      if (options.executeLive) {
        try {
          polymarketPreflight = await runLivePolymarketPreflightForMirror({
            rpcUrl: options.rpcUrl,
            privateKey: options.privateKey,
            funder: options.funder,
          });
        } catch (err) {
          throw coerceMirrorServiceError(err, 'MIRROR_GO_PREFLIGHT_FAILED');
        }
      }

      const syncOptions = {
        mode: options.syncOnce ? 'once' : 'run',
        pandoraMarketAddress,
        ...sourceSelector,
        executeLive: options.executeLive,
        hedgeEnabled: !options.noHedge,
        hedgeRatio: options.hedgeRatio,
        intervalMs: options.syncIntervalMs,
        driftTriggerBps: options.driftTriggerBps,
        hedgeTriggerUsdc: options.hedgeTriggerUsdc,
        maxRebalanceUsdc: options.maxRebalanceUsdc,
        maxHedgeUsdc: options.maxHedgeUsdc,
        maxOpenExposureUsdc: options.executeLive
          ? options.maxOpenExposureUsdc
          : Number.POSITIVE_INFINITY,
        maxTradesPerDay: options.executeLive
          ? options.maxTradesPerDay
          : Number.MAX_SAFE_INTEGER,
        cooldownMs: options.cooldownMs,
        depthSlippageBps: 100,
        iterations: options.syncOnce ? 1 : null,
        stateFile: null,
        killSwitchFile: null,
        chainId: options.chainId,
        rpcUrl: options.rpcUrl,
        privateKey: options.privateKey,
        funder: options.funder,
        usdc: options.usdc,
        polymarketHost: options.polymarketHost,
        polymarketGammaUrl: options.polymarketGammaUrl,
        polymarketGammaMockUrl: options.polymarketGammaMockUrl,
        polymarketMockUrl: options.polymarketMockUrl,
        trustDeploy,
        forceGate: options.forceGate,
        skipGateChecks: options.skipGateChecks,
        webhookUrl: null,
        webhookTemplate: null,
        webhookSecret: null,
        webhookTimeoutMs: 5000,
        webhookRetries: 3,
        telegramBotToken: null,
        telegramChatId: null,
        discordWebhookUrl: null,
        failOnWebhookError: false,
      };

      try {
        syncPayload = await runMirrorSync(syncOptions, {
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
            const quote = await buildQuotePayload(indexerUrl, tradeOptions, shared.timeoutMs);
            const execution = await executeTradeOnchain(tradeOptions);
            return {
              ...execution,
              quote,
            };
          },
          onTick:
            context.outputMode === 'table'
              ? (tickContext) => renderMirrorSyncTickLine(tickContext, context.outputMode)
              : null,
        });
      } catch (err) {
        throw coerceMirrorServiceError(err, 'MIRROR_GO_SYNC_FAILED');
      }
      if (polymarketPreflight) {
        syncPayload.polymarketPreflight = polymarketPreflight;
      }
    } else {
      suggestedSyncCommand = [
        'pandora mirror sync run',
        `--pandora-market-address ${pandoraMarketAddress}`,
        sourceSelector.polymarketMarketId ? `--polymarket-market-id ${sourceSelector.polymarketMarketId}` : null,
        !sourceSelector.polymarketMarketId && sourceSelector.polymarketSlug
          ? `--polymarket-slug ${sourceSelector.polymarketSlug}`
          : null,
        '--paper',
        `--drift-trigger-bps ${options.driftTriggerBps}`,
        `--hedge-trigger-usdc ${options.hedgeTriggerUsdc}`,
        options.forceGate
          ? '--skip-gate'
          : Array.isArray(options.skipGateChecks) && options.skipGateChecks.length
            ? `--skip-gate ${[...options.skipGateChecks].sort().join(',')}`
            : null,
      ]
        .filter(Boolean)
        .join(' ');
    }
  } else if (options.autoSync) {
    throw new CliError(
      'MIRROR_GO_SYNC_REQUIRES_DEPLOYED_MARKET',
      'mirror go --auto-sync requires a deployed Pandora market address (dry-run deploy does not produce one).',
    );
  } else {
    diagnostics.push('Verify skipped because deploy mode was dry-run (no Pandora market address available).');
  }

  emitSuccess(
    context.outputMode,
    'mirror.go',
    {
      schemaVersion: '1.0.0',
      generatedAt: new Date().toISOString(),
      mode: options.executeLive ? 'execute-live' : 'paper',
      plan: planPayload,
      deploy: deployPayload,
      verify: verifyPayload,
      sync: syncPayload,
      polymarketPreflight,
      suggestedSyncCommand,
      trustManifest,
      diagnostics,
    },
    renderMirrorGoTable,
  );
};
