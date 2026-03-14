const { normalizeMirrorRebalanceTradeOptions, selectHealthyPolymarketRpc } = require('./sync.cjs');
const { isResolvePayloadExecutable } = require('../resolve_command_service.cjs');

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeLifecycleError(error, fallbackCode) {
  return {
    code: error && error.code ? error.code : fallbackCode,
    message: error && error.message ? error.message : String(error),
    details: error && error.details ? error.details : null,
  };
}

function quoteShellValue(value) {
  return JSON.stringify(String(value));
}

function buildLifecycleResolveCommand(options, pollAddress) {
  const parts = [
    'pandora resolve',
    `--poll-address ${pollAddress}`,
    `--answer ${options.resolveAnswer}`,
    `--reason ${quoteShellValue(options.resolveReason)}`,
    '--watch',
    `--watch-interval-ms ${options.resolveWatchIntervalMs}`,
    `--watch-timeout-ms ${options.resolveWatchTimeoutMs}`,
    '--execute',
  ];
  if (Number.isInteger(options.chainId)) {
    parts.push(`--chain-id ${options.chainId}`);
  }
  if (options.rpcUrl) {
    parts.push(`--rpc-url ${options.rpcUrl}`);
  }
  if (options.profileId) {
    parts.push(`--profile-id ${options.profileId}`);
  } else if (options.profileFile) {
    parts.push(`--profile-file ${options.profileFile}`);
  }
  return parts.join(' ');
}

function buildLifecycleCloseCommand(options, pandoraMarketAddress, sourceSelector = {}) {
  const parts = [
    'pandora mirror close',
    `--market-address ${pandoraMarketAddress}`,
  ];
  if (sourceSelector.polymarketMarketId) {
    parts.push(`--polymarket-market-id ${sourceSelector.polymarketMarketId}`);
  } else if (sourceSelector.polymarketSlug) {
    parts.push(`--polymarket-slug ${sourceSelector.polymarketSlug}`);
  }
  parts.push('--execute');
  if (Number.isInteger(options.chainId)) {
    parts.push(`--chain-id ${options.chainId}`);
  }
  if (options.rpcUrl) {
    parts.push(`--rpc-url ${options.rpcUrl}`);
  }
  if (options.profileId) {
    parts.push(`--profile-id ${options.profileId}`);
  } else if (options.profileFile) {
    parts.push(`--profile-file ${options.profileFile}`);
  }
  return parts.join(' ');
}

function extractCloseStepStatus(closePayload, stepName) {
  const step = closePayload && Array.isArray(closePayload.steps)
    ? closePayload.steps.find((item) => item && item.step === stepName)
    : null;
  if (!step) return 'unknown';
  if (step.status) return step.status;
  return step.ok ? 'completed' : 'failed';
}

function buildLifecycleFinalReport({
  pandoraMarketAddress,
  pollAddress,
  sourceSelector,
  resolveResult,
  closeResult,
}) {
  const polymarketSettlement =
    closeResult && closeResult.payload && closeResult.payload.polymarketSettlement
      ? closeResult.payload.polymarketSettlement
      : null;
  return {
    pandoraMarketAddress,
    pollAddress: pollAddress || null,
    polymarketMarketId: sourceSelector.polymarketMarketId || null,
    polymarketSlug: sourceSelector.polymarketSlug || null,
    resolveStatus: resolveResult ? resolveResult.status : 'disabled',
    closeStatus: closeResult ? closeResult.status : 'disabled',
    daemonStopStatus: closeResult && closeResult.payload ? extractCloseStepStatus(closeResult.payload, 'stop-daemons') : 'not-run',
    lpWithdrawalStatus: closeResult && closeResult.payload ? extractCloseStepStatus(closeResult.payload, 'withdraw-lp') : 'not-run',
    claimStatus: closeResult && closeResult.payload ? extractCloseStepStatus(closeResult.payload, 'claim-winnings') : 'not-run',
    polymarketSettlement:
      polymarketSettlement && polymarketSettlement.status
        ? polymarketSettlement.status
        : closeResult && closeResult.payload
          ? extractCloseStepStatus(closeResult.payload, 'settle-polymarket')
          : 'not-run',
    polymarketSettlementWallet: polymarketSettlement ? polymarketSettlement.wallet || null : null,
    polymarketSettlementValueUsd: polymarketSettlement ? polymarketSettlement.estimatedValueUsd ?? null : null,
    polymarketSettlementResumeCommand: polymarketSettlement ? polymarketSettlement.resumeCommand || null : null,
  };
}

async function runLifecycleResolve(options, deps) {
  const {
    runResolve,
    assertLiveWriteAllowed,
    sleep = sleepMs,
  } = deps;
  const step = {
    enabled: true,
    status: 'pending',
    pollAddress: options.pollAddress,
    answer: options.resolveAnswer,
    reason: options.resolveReason,
    attempts: 0,
    watch: {
      intervalMs: options.resolveWatchIntervalMs,
      timeoutMs: options.resolveWatchTimeoutMs,
      startedAt: new Date().toISOString(),
      ready: false,
      executionTriggered: true,
    },
    payload: null,
    lastPayload: null,
    error: null,
    resumeCommand: buildLifecycleResolveCommand(options, options.pollAddress),
  };

  if (typeof runResolve !== 'function') {
    step.status = 'unsupported';
    step.error = normalizeLifecycleError(new Error('runResolve dependency is unavailable.'), 'MIRROR_GO_AUTO_RESOLVE_UNAVAILABLE');
    return step;
  }

  const baseResolveOptions = {
    pollAddress: options.pollAddress,
    answer: options.resolveAnswer,
    reason: options.resolveReason,
    chainId: options.chainId,
    rpcUrl: options.rpcUrl,
    fork: Boolean(options.fork),
    forkRpcUrl: options.forkRpcUrl || null,
    forkChainId: options.forkChainId || null,
    privateKey: options.privateKey || null,
    profileId: options.profileId || null,
    profileFile: options.profileFile || null,
  };
  const timeoutAt = Date.now() + options.resolveWatchTimeoutMs;

  while (true) {
    step.attempts += 1;
    try {
      step.lastPayload = await runResolve({
        ...baseResolveOptions,
        dryRun: true,
        execute: false,
      });
    } catch (error) {
      step.status = 'failed';
      step.error = normalizeLifecycleError(error, 'MIRROR_GO_AUTO_RESOLVE_FAILED');
      return step;
    }

    if (isResolvePayloadExecutable(step.lastPayload)) {
      step.watch.ready = true;
      step.watch.checkedAt = new Date().toISOString();
      try {
        if (typeof assertLiveWriteAllowed === 'function') {
          await assertLiveWriteAllowed('mirror.go.resolve.execute', {
            runtimeMode: options.fork || options.forkRpcUrl ? 'fork' : 'live',
          });
        }
        step.payload = await runResolve({
          ...baseResolveOptions,
          dryRun: false,
          execute: true,
        });
        step.status = 'completed';
      } catch (error) {
        step.status = 'failed';
        step.error = normalizeLifecycleError(error, 'MIRROR_GO_AUTO_RESOLVE_FAILED');
      }
      return step;
    }

    if (Date.now() >= timeoutAt) {
      step.status = 'timed-out';
      step.watch.checkedAt = new Date().toISOString();
      return step;
    }

    await sleep(options.resolveWatchIntervalMs);
  }
}

async function runLifecycleClose(options, deps) {
  const {
    runMirrorClose,
    assertLiveWriteAllowed,
    deriveWalletAddressFromPrivateKey,
  } = deps;
  const step = {
    enabled: true,
    status: 'pending',
    payload: null,
    error: null,
    resumeCommand: buildLifecycleCloseCommand(options, options.pandoraMarketAddress, options.sourceSelector),
  };

  if (typeof runMirrorClose !== 'function') {
    step.status = 'unsupported';
    step.error = normalizeLifecycleError(new Error('runMirrorClose dependency is unavailable.'), 'MIRROR_GO_AUTO_CLOSE_UNAVAILABLE');
    return step;
  }

  try {
    if (typeof assertLiveWriteAllowed === 'function') {
      await assertLiveWriteAllowed('mirror.go.close.execute', {
        runtimeMode: options.fork || options.forkRpcUrl ? 'fork' : 'live',
      });
    }
    step.payload = await runMirrorClose(
      {
        execute: true,
        dryRun: false,
        all: false,
        pandoraMarketAddress: options.pandoraMarketAddress,
        polymarketMarketId: options.sourceSelector.polymarketMarketId || null,
        polymarketSlug: options.sourceSelector.polymarketSlug || null,
        wallet:
          options.wallet
          || (typeof deriveWalletAddressFromPrivateKey === 'function' && options.privateKey
            ? deriveWalletAddressFromPrivateKey(options.privateKey)
            : null),
        chainId: options.chainId || null,
        rpcUrl: options.rpcUrl || null,
        privateKey: options.privateKey || null,
        profileId: options.profileId || null,
        profileFile: options.profileFile || null,
        indexerUrl: options.indexerUrl || null,
        timeoutMs: options.timeoutMs || null,
      },
      {
        stopMirrorDaemon: deps.stopMirrorDaemon,
        runLp: deps.runLp,
        runClaim: deps.runClaim,
        decorateOperationPayload: deps.decorateOperationPayload,
        deriveWalletAddressFromPrivateKey,
      },
    );
    const summary = step.payload && step.payload.summary ? step.payload.summary : {};
    step.status =
      step.payload && typeof step.payload.status === 'string'
        ? step.payload.status
        : Number(summary.failureCount || 0) > 0
          ? 'partial'
          : 'completed';
    if (Array.isArray(step.payload && step.payload.resumeCommands) && step.payload.resumeCommands.length) {
      step.resumeCommands = step.payload.resumeCommands.slice();
      if (step.status !== 'completed') {
        step.resumeCommand = step.payload.resumeCommands[0];
      }
    }
  } catch (error) {
    step.status = 'failed';
    step.error = normalizeLifecycleError(error, 'MIRROR_GO_AUTO_CLOSE_FAILED');
  }

  return step;
}

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
    runResolve,
    runMirrorClose,
    stopMirrorDaemon,
    runLp,
    runClaim,
    decorateOperationPayload,
    buildQuotePayload,
    enforceTradeRiskGuards,
    executeTradeOnchain,
    assertLiveWriteAllowed,
    renderMirrorSyncTickLine,
    coerceMirrorServiceError,
    renderMirrorGoTable,
    deriveWalletAddressFromPrivateKey,
  } = deps;
  const helpNotes = [
    'mirror go inherits the exact deploy payload from its dry-run/paper stage and returns the validation ticket needed for execute flows.',
    'Validation tickets are bound to the exact final deploy payload. Any change to question, rules, sources, target timestamp, liquidity, fee params, or distribution requires a fresh validation pass.',
    'If mirror go will deploy a fresh Pandora market, provide two independent public --sources from different hosts even in paper mode. Polymarket URLs are never copied into sources automatically.',
    'Zero-prereq onboarding uses separate mutable personas: market_deployer_a for Pandora deployment and prod_trader_a for live mirror automation.',
    'Private-routing flags affect only the Ethereum Pandora rebalance leg. They do not make the Polygon hedge leg atomic or private.',
    '`auto` only degrades to public rebalance submission when `--rebalance-route-fallback public` is also set. Otherwise private-route failures stay fail-closed.',
    '`flashbots-private` cannot carry approval + trade together. Use `auto` or `flashbots-bundle` for approval-bearing Pandora paths.',
    '`mirror go` does not accept a daemon `--source` selector. Use explicit Polymarket market selectors here, and keep `--source auto|api|on-chain` for `pandora polymarket positions`.',
    'Any live path that continues into daemon sync still needs `--max-open-exposure-usdc` and `--max-trades-per-day`, and hedging stays enabled by default unless you add `--no-hedge`.',
  ];

  if (includesHelpFlag(shared.rest)) {
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'mirror.go.help', commandHelpPayload(mirrorGoUsage, helpNotes));
    } else {
      console.log(`Usage: ${mirrorGoUsage}`);
      console.log('');
      console.log('Notes:');
      for (const note of helpNotes) {
        console.log(`- ${note}`);
      }
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
  let lifecycle = null;
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
              rebalanceRoute: options.rebalanceRoute,
              rebalanceRouteFallback: options.rebalanceRouteFallback,
              flashbotsRelayUrl: options.flashbotsRelayUrl,
              flashbotsAuthKey: options.flashbotsAuthKey,
              flashbotsTargetBlockOffset: options.flashbotsTargetBlockOffset,
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
        `--rebalance-route ${options.rebalanceRoute}`,
        `--rebalance-route-fallback ${options.rebalanceRouteFallback}`,
        options.flashbotsRelayUrl ? `--flashbots-relay-url ${options.flashbotsRelayUrl}` : null,
        options.flashbotsAuthKey ? `--flashbots-auth-key ${options.flashbotsAuthKey}` : null,
        Number.isFinite(Number(options.flashbotsTargetBlockOffset))
          ? `--flashbots-target-block-offset ${Number(options.flashbotsTargetBlockOffset)}`
          : null,
        options.noHedge ? '--no-hedge' : null,
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

  if (options.autoResolve) {
    const pollAddress =
      (deployPayload && deployPayload.pandora && deployPayload.pandora.pollAddress)
      || (verifyPayload && verifyPayload.pandora && verifyPayload.pandora.pollAddress)
      || null;
    if (!pollAddress) {
      throw new CliError(
        'MIRROR_GO_AUTO_RESOLVE_REQUIRES_POLL',
        'mirror go lifecycle automation requires the deployed Pandora poll address.',
        {
          pandoraMarketAddress,
          polymarketMarketId: sourceSelector.polymarketMarketId || null,
          polymarketSlug: sourceSelector.polymarketSlug || null,
        },
      );
    }

    const resolveResult = await runLifecycleResolve(
      {
        pollAddress,
        resolveAnswer: options.resolveAnswer,
        resolveReason: options.resolveReason,
        resolveWatchIntervalMs: options.resolveWatchIntervalMs,
        resolveWatchTimeoutMs: options.resolveWatchTimeoutMs,
        chainId: options.chainId,
        rpcUrl: options.rpcUrl,
        fork: options.fork,
        forkRpcUrl: options.forkRpcUrl,
        forkChainId: options.forkChainId,
        privateKey: options.privateKey,
        profileId: options.profileId || null,
        profileFile: options.profileFile || null,
      },
      {
        runResolve,
        assertLiveWriteAllowed,
        sleep: deps.sleep,
      },
    );

    let closeResult = {
      enabled: Boolean(options.autoClose),
      status: options.autoClose ? 'skipped' : 'disabled',
      payload: null,
      error: null,
      resumeCommand: options.autoClose ? buildLifecycleCloseCommand(options, pandoraMarketAddress, sourceSelector) : null,
    };

    if (options.autoClose) {
      if (resolveResult.status === 'completed') {
        closeResult = await runLifecycleClose(
          {
            pandoraMarketAddress,
            sourceSelector,
            wallet: null,
            chainId: options.chainId,
            rpcUrl: options.rpcUrl,
            privateKey: options.privateKey,
            profileId: options.profileId || null,
            profileFile: options.profileFile || null,
            indexerUrl,
            timeoutMs: shared.timeoutMs,
            fork: options.fork,
            forkRpcUrl: options.forkRpcUrl,
          },
          {
            runMirrorClose,
            stopMirrorDaemon,
            runLp,
            runClaim,
            decorateOperationPayload,
            assertLiveWriteAllowed,
            deriveWalletAddressFromPrivateKey,
          },
        );
      } else {
        closeResult.error = {
          code: 'MIRROR_GO_AUTO_CLOSE_SKIPPED',
          message: 'Auto-close skipped because auto-resolve did not complete successfully.',
          details: {
            resolveStatus: resolveResult.status,
          },
        };
      }
    }

    const suggestedLifecycleCommands = [];
    if (resolveResult.status !== 'completed' && resolveResult.resumeCommand) {
      suggestedLifecycleCommands.push(resolveResult.resumeCommand);
    }
    if (options.autoClose && closeResult.status !== 'completed') {
      const closeResumeCommands =
        Array.isArray(closeResult.resumeCommands) && closeResult.resumeCommands.length
          ? closeResult.resumeCommands
          : closeResult.resumeCommand
            ? [closeResult.resumeCommand]
            : [];
      suggestedLifecycleCommands.push(...closeResumeCommands);
    }

    lifecycle = {
      enabled: true,
      status:
        resolveResult.status !== 'completed'
          ? resolveResult.status
          : closeResult.enabled
            ? closeResult.status
            : 'completed',
      resolve: resolveResult,
      close: closeResult,
      finalReport: buildLifecycleFinalReport({
        pandoraMarketAddress,
        pollAddress,
        sourceSelector,
        resolveResult,
        closeResult,
      }),
      suggestedResumeCommands: suggestedLifecycleCommands,
    };
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
      lifecycle,
      polymarketPreflight,
      suggestedSyncCommand,
      trustManifest,
      diagnostics,
    },
    renderMirrorGoTable,
  );
};
