const { buildMirrorRuntimeTelemetry } = require('../mirror_sync/state.cjs');
const {
  buildMirrorPnlPayload,
  resolveMirrorSurfaceDaemonStatus,
  resolveMirrorSurfaceState,
} = require('../mirror_surface_service.cjs');

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

function renderMirrorPnlTable(data) {
  const summary = data.summary || {};
  const scenarios = data.scenarios || {};
  renderKeyValueRows('Mirror PnL', [
    ['strategyHash', data.strategyHash || ''],
    ['stateFile', data.stateFile || ''],
    ['netPnlApproxUsdc', summary.netPnlApproxUsdc],
    ['pnlApprox', summary.pnlApprox],
    ['netDeltaApprox', summary.netDeltaApprox],
    ['driftBps', summary.driftBps],
    ['hedgeGapUsdc', summary.hedgeGapUsdc],
    ['crossVenueStatus', data.crossVenue && data.crossVenue.status ? data.crossVenue.status : ''],
    ['runtimeHealth', summary.runtimeHealth || ''],
    ['feeVolumeScenarioCount', Array.isArray(scenarios.feeVolumeScenarios) ? scenarios.feeVolumeScenarios.length : 0],
  ]);
}

module.exports = async function handleMirrorPnl({ actionArgs, shared, context, deps }) {
  const {
    CliError,
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    maybeLoadIndexerEnv,
    maybeLoadTradeEnv,
    parseMirrorPnlFlags,
    resolveTrustedDeployPair,
    resolveIndexerUrl,
    verifyMirror,
    coerceMirrorServiceError,
    toMirrorStatusLivePayload,
  } = deps;

  const usage =
    'pandora [--output table|json] mirror pnl --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]';

  if (includesHelpFlag(actionArgs)) {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'mirror.pnl.help',
        commandHelpPayload(usage, [
          'mirror pnl always resolves the live cross-venue scenario model used by mirror status --with-live.',
          'Polymarket balance/open-order visibility degrades into diagnostics instead of hard failure when those endpoints are unavailable.',
        ]),
      );
    } else {
      console.log(`Usage: ${usage}`);
      console.log('mirror pnl always resolves the live cross-venue scenario model used by mirror status --with-live.');
      console.log('Polymarket balance/open-order visibility degrades into diagnostics instead of hard failure when those endpoints are unavailable.');
    }
    return;
  }

  const options = parseMirrorPnlFlags(actionArgs);
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
      'mirror pnl requires --pandora-market-address/--market-address (or a state file containing it).',
    );
  }
  if (!selector.polymarketMarketId && !selector.polymarketSlug) {
    throw new CliError(
      'MISSING_REQUIRED_FLAG',
      'mirror pnl requires --polymarket-market-id or --polymarket-slug (or a state file containing one).',
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
    throw coerceMirrorServiceError(err, 'MIRROR_PNL_FAILED');
  }

  const live = await toMirrorStatusLivePayload(verifyPayload, loaded.state, {
    driftTriggerBps: options.driftTriggerBps,
    hedgeTriggerUsdc: options.hedgeTriggerUsdc,
    timeoutMs: options.timeoutMs,
    polymarketHost: options.polymarketHost,
    polymarketMockUrl: options.polymarketMockUrl,
  });

  emitSuccess(
    context.outputMode,
    'mirror.pnl',
    buildMirrorPnlPayload({
      stateFile: loaded.filePath,
      strategyHash: loaded.state.strategyHash || strategyHashValue,
      selector,
      state: loaded.state,
      runtime,
      live,
    }),
    renderMirrorPnlTable,
  );
};
