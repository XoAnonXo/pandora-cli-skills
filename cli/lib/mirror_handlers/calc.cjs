const {
  planAmmTradeToTargetYesPct,
  simulateDirectionalSwap,
} = require('../amm_target_pct_service.cjs');

function requireFlagValue(args, index, flagName, CliError) {
  if (index + 1 >= args.length || String(args[index + 1]).startsWith('--')) {
    throw new CliError('MISSING_REQUIRED_FLAG', `${flagName} requires a value.`);
  }
  return String(args[index + 1]);
}

function extractTargetPctFlag(args, parseProbabilityPercent, CliError) {
  const remaining = [];
  let targetPct = null;
  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i]);
    if (token === '--target-pct') {
      targetPct = parseProbabilityPercent(requireFlagValue(args, i, '--target-pct', CliError), '--target-pct');
      i += 1;
      continue;
    }
    remaining.push(token);
  }
  if (targetPct === null) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'mirror calc requires --target-pct <0-100>.');
  }
  return { targetPct, remaining };
}

function renderMirrorCalcTable(data) {
  const rows = [
    ['strategyHash', data.strategyHash || ''],
    ['stateFile', data.stateFile || ''],
    ['currentYesPct', data.currentYesPct !== null && data.currentYesPct !== undefined ? data.currentYesPct : ''],
    ['targetPct', data.targetPct !== null && data.targetPct !== undefined ? data.targetPct : ''],
    ['requiredSide', data.requiredSide || ''],
    ['requiredAmountUsdc', data.requiredAmountUsdc !== null && data.requiredAmountUsdc !== undefined ? data.requiredAmountUsdc : ''],
    ['expectedSharesOut', data.expectedSharesOut !== null && data.expectedSharesOut !== undefined ? data.expectedSharesOut : ''],
    ['postTradeYesPct', data.postTradeYesPct !== null && data.postTradeYesPct !== undefined ? data.postTradeYesPct : ''],
    ['hedgeToken', data.hedge && data.hedge.hedgeToken ? data.hedge.hedgeToken : ''],
    ['targetHedgeUsdc', data.hedge && data.hedge.targetHedgeUsdcSigned !== undefined ? data.hedge.targetHedgeUsdcSigned : ''],
    ['hedgeSharesApprox', data.hedge && data.hedge.hedgeSharesApprox !== undefined ? data.hedge.hedgeSharesApprox : ''],
    ['hedgeCostApproxUsdc', data.hedge && data.hedge.hedgeCostApproxUsdc !== undefined ? data.hedge.hedgeCostApproxUsdc : ''],
    ['crossVenueStatus', data.crossVenue && data.crossVenue.status ? data.crossVenue.status : ''],
  ];
  console.log('Mirror Calc');
  for (const [label, value] of rows) {
    console.log(`${label}: ${value}`);
  }
}

module.exports = async function handleMirrorCalc({ actionArgs, shared, context, deps }) {
  const {
    CliError,
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    maybeLoadIndexerEnv,
    maybeLoadTradeEnv,
    parseMirrorPnlFlags,
    parseProbabilityPercent,
    resolveTrustedDeployPair,
    resolveIndexerUrl,
    verifyMirror,
    coerceMirrorServiceError,
    toMirrorStatusLivePayload,
    buildMirrorHedgeCalc,
    buildMirrorRuntimeTelemetry,
    resolveMirrorSurfaceState,
    resolveMirrorSurfaceDaemonStatus,
  } = deps;

  const usage =
    'pandora [--output table|json] mirror calc --target-pct <0-100> --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) [--trust-deploy] [--manifest-file <path>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]';

  if (includesHelpFlag(actionArgs)) {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'mirror.calc.help',
        commandHelpPayload(usage, [
          'mirror calc computes the exact Pandora notional needed to move a market to a target percentage, then derives the corresponding hedge inventory needed on Polymarket.',
          'Use this when operators need precise rebalance sizing instead of threshold-only drift or hedge-gap alerts.',
        ]),
      );
    } else {
      console.log(`Usage: ${usage}`);
      console.log('mirror calc computes the exact Pandora notional needed to move a market to a target percentage, then derives the corresponding hedge inventory needed on Polymarket.');
      console.log('Use this when operators need precise rebalance sizing instead of threshold-only drift or hedge-gap alerts.');
    }
    return;
  }

  const extracted = extractTargetPctFlag(actionArgs, parseProbabilityPercent, CliError);
  const options = parseMirrorPnlFlags(extracted.remaining);
  if (shared) {
    maybeLoadIndexerEnv(shared);
    maybeLoadTradeEnv(shared);
    if (!options.indexerUrl && shared.indexerUrl) {
      options.indexerUrl = shared.indexerUrl;
    }
    options.timeoutMs = shared.timeoutMs;
  }

  const strategyHashValue = options.strategyHash || null;
  const loaded = resolveMirrorSurfaceState({
    stateFile: options.stateFile || null,
    strategyHash: strategyHashValue,
    pandoraMarketAddress: options.pandoraMarketAddress || null,
    polymarketMarketId: options.polymarketMarketId || null,
    polymarketSlug: options.polymarketSlug || null,
  });
  const selector = {
    pandoraMarketAddress: options.pandoraMarketAddress || loaded.state.pandoraMarketAddress || null,
    polymarketMarketId: options.polymarketMarketId || loaded.state.polymarketMarketId || null,
    polymarketSlug: options.polymarketSlug || loaded.state.polymarketSlug || null,
  };
  const runtime = buildMirrorRuntimeTelemetry({
    state: loaded.state,
    stateFile: loaded.filePath,
    daemonStatus: resolveMirrorSurfaceDaemonStatus(selector, loaded.state),
  });

  if (!selector.pandoraMarketAddress) {
    throw new CliError(
      'MISSING_REQUIRED_FLAG',
      'mirror calc requires --pandora-market-address/--market-address (or a state file containing it).',
    );
  }
  if (!selector.polymarketMarketId && !selector.polymarketSlug) {
    throw new CliError(
      'MISSING_REQUIRED_FLAG',
      'mirror calc requires --polymarket-market-id or --polymarket-slug (or a state file containing one).',
    );
  }

  let trustDeploy = false;
  if (options.trustDeploy) {
    resolveTrustedDeployPair({
      ...selector,
      manifestFile: options.manifestFile,
    });
    trustDeploy = true;
  }

  const indexerUrl = resolveIndexerUrl(options.indexerUrl);
  let verifyPayload;
  try {
    verifyPayload = await verifyMirror({
      indexerUrl,
      timeoutMs: options.timeoutMs,
      pandoraMarketAddress: selector.pandoraMarketAddress,
      polymarketMarketId: selector.polymarketMarketId,
      polymarketSlug: selector.polymarketSlug,
      polymarketHost: options.polymarketHost,
      polymarketGammaUrl: options.polymarketGammaUrl,
      polymarketGammaMockUrl: options.polymarketGammaMockUrl,
      polymarketMockUrl: options.polymarketMockUrl,
      trustDeploy,
      includeSimilarity: false,
      allowRuleMismatch: false,
    });
  } catch (err) {
    throw coerceMirrorServiceError(err, 'MIRROR_CALC_FAILED');
  }

  const live = await toMirrorStatusLivePayload(verifyPayload, loaded.state, {
    driftTriggerBps: options.driftTriggerBps,
    hedgeTriggerUsdc: options.hedgeTriggerUsdc,
    timeoutMs: options.timeoutMs,
    polymarketHost: options.polymarketHost,
    polymarketMockUrl: options.polymarketMockUrl,
  });

  const reserveYesUsdc = Number(live.reserveYesUsdc);
  const reserveNoUsdc = Number(live.reserveNoUsdc);
  const feeTier = Number.isFinite(Number(loaded.state && loaded.state.feeTier)) ? Number(loaded.state.feeTier) : 3000;
  const targeting = planAmmTradeToTargetYesPct({
    reserveYesUsdc,
    reserveNoUsdc,
    targetYesPct: extracted.targetPct,
    feeTier,
  });

  if (!targeting || targeting.targetReachable === false || !Number.isFinite(Number(targeting.requiredAmountUsdc))) {
    throw new CliError(
      'MIRROR_CALC_UNREACHABLE',
      targeting && targeting.diagnostic
        ? targeting.diagnostic
        : 'mirror calc could not solve a finite trade size for the requested target percentage.',
      { targeting },
    );
  }

  const swap = simulateDirectionalSwap({
    reserveYesUsdc,
    reserveNoUsdc,
    side: targeting.requiredSide,
    volumeUsdc: targeting.requiredAmountUsdc,
    feeTier,
  });
  const hedgePayload = buildMirrorHedgeCalc({
    reserveYesUsdc: swap.reserveYesUsdc,
    reserveNoUsdc: swap.reserveNoUsdc,
    polymarketYesPct: live.sourceMarket && live.sourceMarket.yesPct !== undefined ? live.sourceMarket.yesPct : null,
    hedgeRatio: 1,
    hedgeCostBps: 35,
    feeTier,
  });

  emitSuccess(
    context.outputMode,
    'mirror.calc',
    {
      schemaVersion: '1.0.0',
      generatedAt: new Date().toISOString(),
      stateFile: loaded.filePath,
      strategyHash: loaded.state.strategyHash || strategyHashValue,
      selector,
      currentYesPct: live.pandoraMarket && live.pandoraMarket.yesPct !== undefined ? live.pandoraMarket.yesPct : null,
      sourceYesPct: live.sourceMarket && live.sourceMarket.yesPct !== undefined ? live.sourceMarket.yesPct : null,
      targetPct: extracted.targetPct,
      requiredSide: targeting.requiredSide,
      requiredAmountUsdc: targeting.requiredAmountUsdc,
      expectedSharesOut: swap.outputShares,
      postTradeYesPct: swap.postYesPct,
      postTradeReserves: {
        reserveYesUsdc: swap.reserveYesUsdc,
        reserveNoUsdc: swap.reserveNoUsdc,
      },
      hedge: hedgePayload.metrics,
      scenarios: hedgePayload.scenarios,
      crossVenue: live.crossVenue || null,
      actionability: live.actionability || null,
      runtime: {
        health: runtime.health || null,
        daemon: runtime.daemon || null,
      },
      diagnostics: []
        .concat(Array.isArray(targeting.diagnostics) ? targeting.diagnostics : [])
        .concat(Array.isArray(hedgePayload.diagnostics) ? hedgePayload.diagnostics : [])
        .concat(Array.isArray(live.verifyDiagnostics) ? live.verifyDiagnostics : []),
    },
    renderMirrorCalcTable,
  );
};
