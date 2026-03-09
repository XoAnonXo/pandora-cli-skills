const { buildMirrorRuntimeTelemetry } = require('../mirror_sync/state.cjs');
const { resolveMirrorSurfaceDaemonStatus, resolveMirrorSurfaceState } = require('../mirror_surface_service.cjs');

/**
 * Handle `mirror status` command execution.
 * Reads sync state and optionally enriches with live verification/position diagnostics.
 * @param {{actionArgs: string[], shared: object, context: object, deps: object}} params
 * @returns {Promise<void>}
 */
module.exports = async function handleMirrorStatus({ actionArgs, shared, context, deps }) {
  const {
    CliError,
    includesHelpFlag,
    emitSuccess,
    maybeLoadIndexerEnv,
    maybeLoadTradeEnv,
    parseMirrorStatusFlags,
    resolveTrustedDeployPair,
    resolveIndexerUrl,
    verifyMirror,
    coerceMirrorServiceError,
    toMirrorStatusLivePayload,
    renderMirrorStatusTable,
  } = deps;

  if (includesHelpFlag(actionArgs)) {
    const usage =
      'pandora [--output table|json] mirror status --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) [--with-live] [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]';
    const polymarketEnv = [
      'POLYMARKET_PRIVATE_KEY',
      'POLYMARKET_FUNDER',
      'POLYMARKET_API_KEY',
      'POLYMARKET_API_SECRET',
      'POLYMARKET_API_PASSPHRASE',
      'POLYMARKET_HOST',
    ];
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'mirror.status.help', {
        usage,
        polymarketEnv,
        notes: {
          withLive:
            'When credentials are available, --with-live enriches diagnostics with cross-venue status, hedge-gap actionability, Polymarket balances/open orders, and scenario-style P&L estimates.',
          runtime:
            'mirror status can run selector-first without a state file; persisted state and daemon metadata are attached when they can be resolved.',
          funder:
            'POLYMARKET_FUNDER should be the Polymarket proxy wallet (Gnosis Safe), not the EOA signer address.',
          collateral:
            'Polymarket CLOB collateral is Polygon USDC.e; balances/allowances must exist on the proxy wallet for live hedging accounts.',
          gracefulFallback:
            '--with-live degrades gracefully when position endpoints or credentials are unavailable (diagnostics are returned instead of hard failures).',
        },
      });
    } else {
      console.log(`Usage: ${usage}`);
      console.log(
        'Polymarket env: POLYMARKET_PRIVATE_KEY, POLYMARKET_FUNDER, POLYMARKET_API_KEY, POLYMARKET_API_SECRET, POLYMARKET_API_PASSPHRASE, POLYMARKET_HOST.',
      );
      console.log('POLYMARKET_FUNDER must be the Polymarket proxy wallet (Gnosis Safe), not the EOA signer address.');
      console.log(
        '--with-live adds cross-venue status, hedge-gap actionability, and Polymarket balance/open-order diagnostics when credentials are available and degrades gracefully when unavailable.',
      );
      console.log('mirror status can run selector-first; persisted runtime/daemon metadata is attached when a state file or matching daemon can be resolved.');
    }
    return;
  }

  const options = parseMirrorStatusFlags(actionArgs);
  if (shared) {
    maybeLoadIndexerEnv(shared);
    if (options.withLive) {
      maybeLoadTradeEnv(shared);
    }
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

  let trustManifest = null;
  let trustDeploy = false;
  if (options.trustDeploy) {
    const trusted = resolveTrustedDeployPair({
      ...selector,
      manifestFile: options.manifestFile,
    });
    trustManifest = {
      filePath: trusted.manifestFile,
      pair: trusted.trustPair,
    };
    trustDeploy = true;
  }

  let live = null;
  if (options.withLive) {
    if (!selector.pandoraMarketAddress) {
      throw new CliError(
        'MISSING_REQUIRED_FLAG',
        'mirror status --with-live requires --pandora-market-address/--market-address (or a state file containing it).',
      );
    }
    if (!selector.polymarketMarketId && !selector.polymarketSlug) {
      throw new CliError(
        'MISSING_REQUIRED_FLAG',
        'mirror status --with-live requires --polymarket-market-id or --polymarket-slug (or a state file containing one).',
      );
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
      throw coerceMirrorServiceError(err, 'MIRROR_STATUS_LIVE_FAILED');
    }
    live = await toMirrorStatusLivePayload(verifyPayload, loaded.state, {
      driftTriggerBps: options.driftTriggerBps,
      hedgeTriggerUsdc: options.hedgeTriggerUsdc,
      timeoutMs: options.timeoutMs,
      polymarketHost: options.polymarketHost,
      polymarketMockUrl: options.polymarketMockUrl,
    });
  }

  emitSuccess(
    context.outputMode,
    'mirror.status',
    {
      schemaVersion: loaded.state.schemaVersion || '1.0.0',
      generatedAt: new Date().toISOString(),
      stateFile: loaded.filePath,
      strategyHash: loaded.state.strategyHash || strategyHashValue,
      selector,
      trustManifest,
      live,
      runtime,
      state: loaded.state,
    },
    renderMirrorStatusTable,
  );
};
