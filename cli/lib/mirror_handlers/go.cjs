const { normalizeMirrorRebalanceTradeOptions, selectHealthyPolymarketRpc } = require('./sync.cjs');

/**
 * Handle `mirror go` command execution.
 * Orchestrates plan -> deploy -> verify -> optional sync/trade flow and emits a combined payload.
 * @param {{shared: object, context: object, deps: object, mirrorGoUsage: string}} params
 * @returns {Promise<void>}
 */
module.exports = async function handleMirrorGo({ shared, context, deps, mirrorGoUsage }) {
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
    parseMirrorGoFlags,
    buildMirrorPlan,
    deployMirror,
    resolveTrustedDeployPair,
    findMirrorPair,
    defaultMirrorManifestFile,
    hasContractCodeAtAddress,
    verifyMirror,
    runLivePolymarketPreflightForMirror,
    runMirrorSync,
    buildQuotePayload,
    enforceTradeRiskGuards,
    executeTradeOnchain,
    assertLiveWriteAllowed,
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

  const diagnostics = [];
  if (deprecatedForceGateWarning) diagnostics.push(deprecatedForceGateWarning);
  let planPayload;
  try {
    planPayload = await buildMirrorPlan({
      ...options,
      indexerUrl,
      timeoutMs: shared.timeoutMs,
    });
  } catch (err) {
    throw coerceMirrorServiceError(err, 'MIRROR_GO_FAILED');
  }

  const sourceSelector = {
    polymarketMarketId:
      (planPayload && planPayload.sourceMarket && planPayload.sourceMarket.marketId) || options.polymarketMarketId || null,
    polymarketSlug:
      (planPayload && planPayload.sourceMarket && planPayload.sourceMarket.slug) || options.polymarketSlug || null,
  };

  let reusedManifestLookup = null;
  if (
    options.executeLive &&
    typeof findMirrorPair === 'function' &&
    (sourceSelector.polymarketMarketId || sourceSelector.polymarketSlug)
  ) {
    const manifestFilePath =
      options.manifestFile || (typeof defaultMirrorManifestFile === 'function' ? defaultMirrorManifestFile() : null);
    if (manifestFilePath) {
      try {
        const lookup = findMirrorPair(manifestFilePath, sourceSelector);
        if (
          lookup &&
          lookup.pair &&
          lookup.pair.trusted !== false &&
          lookup.pair.pandoraMarketAddress
        ) {
          let allowReuse = true;
          if (typeof hasContractCodeAtAddress === 'function') {
            try {
              const hasCode = await hasContractCodeAtAddress({
                marketAddress: lookup.pair.pandoraMarketAddress,
                chainId: options.chainId,
                rpcUrl: options.rpcUrl,
              });
              if (!hasCode) {
                allowReuse = false;
                diagnostics.push(
                  `Trusted mirror pair exists but has no bytecode at ${lookup.pair.pandoraMarketAddress}; continuing with fresh deploy.`,
                );
              }
            } catch (err) {
              diagnostics.push(
                `On-chain deploy dedupe probe failed (${lookup.pair.pandoraMarketAddress}): ${err && err.message ? err.message : String(err)}. Conservatively reusing trusted pair to avoid duplicate spend.`,
              );
            }
          }
          if (allowReuse) {
            reusedManifestLookup = lookup;
            diagnostics.push(
              `Trusted mirror pair already exists (${lookup.pair.pandoraMarketAddress}); deploy step skipped to prevent duplicate market creation.`,
            );
          }
        }
      } catch (err) {
        diagnostics.push(`Mirror manifest lookup failed: ${err && err.message ? err.message : String(err)}`);
      }
    }
  }

  let deployPayload;
  try {
    if (reusedManifestLookup) {
      deployPayload = {
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        mode: 'execute',
        dryRun: false,
        sourceMarket: planPayload && planPayload.sourceMarket ? planPayload.sourceMarket : null,
        planDigest: planPayload && planPayload.planDigest ? planPayload.planDigest : null,
        pandora: {
          marketAddress: reusedManifestLookup.pair.pandoraMarketAddress,
          pollAddress: reusedManifestLookup.pair.pandoraPollAddress || null,
        },
        trustManifest: {
          filePath: reusedManifestLookup.filePath,
          pair: reusedManifestLookup.pair,
        },
        diagnostics: [
          'Deploy skipped because trusted manifest already maps this source to an on-chain market.',
        ],
      };
    } else {
      if (options.executeLive && typeof assertLiveWriteAllowed === 'function') {
        await assertLiveWriteAllowed('mirror.go.deploy.execute', {
          notionalUsdc: options.liquidityUsdc,
          runtimeMode: 'live',
        });
      }
      deployPayload = await deployMirror({
        ...options,
        planData: planPayload,
        execute: options.executeLive,
        indexerUrl,
        timeoutMs: shared.timeoutMs,
      });
    }
  } catch (err) {
    throw coerceMirrorServiceError(err, 'MIRROR_GO_FAILED');
  }

  const pandoraMarketAddress = deployPayload && deployPayload.pandora ? deployPayload.pandora.marketAddress : null;

  let verifyPayload = null;
  let syncPayload = null;
  let polymarketPreflight = null;
  let suggestedSyncCommand = null;
  let trustManifest =
    (deployPayload && deployPayload.trustManifest ? deployPayload.trustManifest : null)
    || (reusedManifestLookup
      ? {
          filePath: reusedManifestLookup.filePath,
          pair: reusedManifestLookup.pair,
        }
      : null);
  let trustDeploy = Boolean(options.trustDeploy);
  if (!trustDeploy && trustManifest && trustManifest.pair) {
    trustDeploy = true;
  }

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
      if (options.executeLive) {
        throw new CliError(
          'MIRROR_GO_VERIFY_PENDING',
          `Mirror market ${pandoraMarketAddress} is deployed, but verification failed (likely indexer/indexing lag). Do not rerun mirror go --execute-live; run mirror verify against this market address.`,
          {
            pandoraMarketAddress,
            polymarketMarketId: sourceSelector.polymarketMarketId || null,
            polymarketSlug: sourceSelector.polymarketSlug || null,
            manifestFile:
              (trustManifest && trustManifest.filePath)
              || options.manifestFile
              || (typeof defaultMirrorManifestFile === 'function' ? defaultMirrorManifestFile() : null),
            reusedManifestPair: Boolean(reusedManifestLookup),
            cause: err && err.message ? err.message : String(err),
          },
        );
      }
      throw coerceMirrorServiceError(err, 'MIRROR_GO_VERIFY_FAILED');
    }

    if (!options.withRules && verifyPayload && verifyPayload.pandora) {
      delete verifyPayload.pandora.rules;
      if (verifyPayload.sourceMarket) delete verifyPayload.sourceMarket.description;
    }

    if (options.autoSync) {
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
          const selectedPolymarketRpcUrl =
            rpcSelection.selectedRpcUrl || options.polymarketRpcUrl || options.rpcUrl || null;
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
        rebalanceSizingMode: options.rebalanceSizingMode,
        priceSource: options.priceSource,
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
        depthSlippageBps: options.depthSlippageBps,
        minTimeToCloseSec: options.minTimeToCloseSec,
        strictCloseTimeDelta: options.strictCloseTimeDelta,
        iterations: options.syncOnce ? 1 : null,
        stateFile: null,
        killSwitchFile: null,
        chainId: options.chainId,
        rpcUrl: options.rpcUrl,
        polymarketRpcUrl: options.polymarketRpcUrl,
        privateKey: options.privateKey,
        profileId: options.profileId || null,
        profileFile: options.profileFile || null,
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
            });
            if (typeof assertLiveWriteAllowed === 'function') {
              await assertLiveWriteAllowed('mirror.go.sync.execute', {
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
        options.polymarketRpcUrl ? `--polymarket-rpc-url ${options.polymarketRpcUrl}` : null,
        `--drift-trigger-bps ${options.driftTriggerBps}`,
        `--hedge-trigger-usdc ${options.hedgeTriggerUsdc}`,
        `--hedge-ratio ${options.hedgeRatio}`,
        `--rebalance-mode ${options.rebalanceSizingMode}`,
        `--price-source ${options.priceSource}`,
        !options.hedgeEnabled ? '--no-hedge' : null,
        `--max-rebalance-usdc ${options.maxRebalanceUsdc}`,
        `--max-hedge-usdc ${options.maxHedgeUsdc}`,
        Number.isFinite(options.maxOpenExposureUsdc) && options.maxOpenExposureUsdc !== Number.POSITIVE_INFINITY
          ? `--max-open-exposure-usdc ${options.maxOpenExposureUsdc}`
          : null,
        Number.isFinite(options.maxTradesPerDay) && options.maxTradesPerDay !== Number.MAX_SAFE_INTEGER
          ? `--max-trades-per-day ${options.maxTradesPerDay}`
          : null,
        `--cooldown-ms ${options.cooldownMs}`,
        `--depth-slippage-bps ${options.depthSlippageBps}`,
        options.minTimeToCloseSec !== 1800 ? `--min-time-to-close-sec ${options.minTimeToCloseSec}` : null,
        options.strictCloseTimeDelta ? '--strict-close-time-delta' : null,
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
