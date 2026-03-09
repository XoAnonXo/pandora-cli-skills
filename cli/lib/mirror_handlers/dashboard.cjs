const { buildMirrorRuntimeTelemetry } = require('../mirror_sync/state.cjs');
const {
  buildMirrorDashboardItem,
  buildMirrorDashboardPayload,
  loadMirrorDashboardContexts,
  resolveMirrorSurfaceDaemonStatus,
} = require('../mirror_surface_service.cjs');

function requireFlagValue(args, index, flagName, CliError) {
  if (index + 1 >= args.length || String(args[index + 1]).startsWith('--')) {
    throw new CliError('MISSING_REQUIRED_FLAG', `${flagName} requires a value.`);
  }
  return String(args[index + 1]);
}

function parsePositiveInteger(value, flagName, CliError) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a positive integer.`);
  }
  return numeric;
}

function parsePositiveNumber(value, flagName, CliError) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a positive number.`);
  }
  return numeric;
}

function parseMirrorDashboardFlags(args, CliError, defaultTimeoutMs) {
  const options = {
    withLive: false,
    trustDeploy: false,
    manifestFile: null,
    driftTriggerBps: 150,
    hedgeTriggerUsdc: 10,
    indexerUrl: null,
    timeoutMs: defaultTimeoutMs,
    polymarketHost: null,
    polymarketGammaUrl: null,
    polymarketGammaMockUrl: null,
    polymarketMockUrl: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i]);
    if (token === '--with-live') {
      options.withLive = true;
      continue;
    }
    if (token === '--no-live') {
      options.withLive = false;
      continue;
    }
    if (token === '--trust-deploy') {
      options.trustDeploy = true;
      continue;
    }
    if (token === '--manifest-file') {
      options.manifestFile = requireFlagValue(args, i, '--manifest-file', CliError);
      i += 1;
      continue;
    }
    if (token === '--drift-trigger-bps') {
      options.driftTriggerBps = parsePositiveInteger(requireFlagValue(args, i, '--drift-trigger-bps', CliError), '--drift-trigger-bps', CliError);
      i += 1;
      continue;
    }
    if (token === '--hedge-trigger-usdc') {
      options.hedgeTriggerUsdc = parsePositiveNumber(requireFlagValue(args, i, '--hedge-trigger-usdc', CliError), '--hedge-trigger-usdc', CliError);
      i += 1;
      continue;
    }
    if (token === '--indexer-url') {
      options.indexerUrl = requireFlagValue(args, i, '--indexer-url', CliError);
      i += 1;
      continue;
    }
    if (token === '--timeout-ms') {
      options.timeoutMs = parsePositiveInteger(requireFlagValue(args, i, '--timeout-ms', CliError), '--timeout-ms', CliError);
      i += 1;
      continue;
    }
    if (token === '--polymarket-host') {
      options.polymarketHost = requireFlagValue(args, i, '--polymarket-host', CliError);
      i += 1;
      continue;
    }
    if (token === '--polymarket-gamma-url') {
      options.polymarketGammaUrl = requireFlagValue(args, i, '--polymarket-gamma-url', CliError);
      i += 1;
      continue;
    }
    if (token === '--polymarket-gamma-mock-url') {
      options.polymarketGammaMockUrl = requireFlagValue(args, i, '--polymarket-gamma-mock-url', CliError);
      i += 1;
      continue;
    }
    if (token === '--polymarket-mock-url') {
      options.polymarketMockUrl = requireFlagValue(args, i, '--polymarket-mock-url', CliError);
      i += 1;
      continue;
    }
    throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror dashboard: ${token}`);
  }

  return options;
}

function normalizeError(err, fallbackCode) {
  if (!err) {
    return {
      code: fallbackCode,
      message: fallbackCode,
    };
  }
  return {
    code: err.code ? String(err.code) : fallbackCode,
    message: err.message ? String(err.message) : String(err),
  };
}

function renderMirrorDashboardTable(data) {
  console.log('Mirror Dashboard');
  const items = Array.isArray(data.items) ? data.items : [];
  for (const item of items) {
    const driftBps = item && item.drift ? item.drift.driftBps : '';
    const hedgeGapUsdc = item && item.hedge ? item.hedge.hedgeGapUsdc : '';
    const pnlApprox = item && item.pnl ? item.pnl.netPnlApproxUsdc : '';
    const runtimeHealth = item && item.runtime && item.runtime.health ? item.runtime.health.status : '';
    const crossVenueStatus = item && item.drift ? item.drift.crossVenueStatus : '';
    const question = item && item.question ? item.question : item && item.selector ? JSON.stringify(item.selector) : '';
    console.log(`${question}: driftBps=${driftBps} hedgeGapUsdc=${hedgeGapUsdc} netPnlApproxUsdc=${pnlApprox} runtime=${runtimeHealth} crossVenue=${crossVenueStatus}`);
  }
}

module.exports = async function handleMirrorDashboard({ actionArgs, shared, context, deps }) {
  const {
    CliError,
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    maybeLoadIndexerEnv,
    maybeLoadTradeEnv,
    resolveIndexerUrl,
    resolveTrustedDeployPair,
    verifyMirror,
    toMirrorStatusLivePayload,
  } = deps;

  const usage =
    'pandora [--output table|json] mirror dashboard [--with-live|--no-live] [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]';

  if (includesHelpFlag(actionArgs)) {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'mirror.dashboard.help',
        commandHelpPayload(usage, [
          'mirror dashboard scans local mirror state and daemon metadata to summarize active mirror markets in one machine-usable payload.',
          '--with-live enriches each discovered market with the same drift, hedge, and PnL signals used by mirror status and mirror pnl; per-market live failures degrade into item diagnostics instead of aborting the whole dashboard.',
          '--no-live disables live enrichment and returns state/daemon-only summaries.',
        ]),
      );
    } else {
      console.log(`Usage: ${usage}`);
      console.log('mirror dashboard scans local mirror state and daemon metadata to summarize active mirror markets in one machine-usable payload.');
      console.log('--with-live enriches each discovered market with the same drift, hedge, and PnL signals used by mirror status and mirror pnl; per-market live failures degrade into item diagnostics instead of aborting the whole dashboard.');
      console.log('--no-live disables live enrichment and returns state/daemon-only summaries.');
    }
    return;
  }

  const options = parseMirrorDashboardFlags(actionArgs, CliError, shared && shared.timeoutMs ? shared.timeoutMs : 60_000);
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

  const contexts = loadMirrorDashboardContexts();
  const indexerUrl = options.withLive ? resolveIndexerUrl(options.indexerUrl) : null;
  const items = await Promise.all(contexts.map(async (entry) => {
    const runtime = buildMirrorRuntimeTelemetry({
      state: entry.state,
      stateFile: entry.stateFile || (entry.daemonStatus && entry.daemonStatus.metadata ? entry.daemonStatus.metadata.stateFile || null : null),
      daemonStatus: entry.daemonStatus || resolveMirrorSurfaceDaemonStatus(entry.selector, entry.state),
    });
    let live = null;
    const diagnostics = [];

    if (options.withLive) {
      if (!entry.selector.pandoraMarketAddress || !(entry.selector.polymarketMarketId || entry.selector.polymarketSlug)) {
        diagnostics.push('Live dashboard enrichment skipped because the discovered mirror context does not have a complete selector pair.');
      } else {
        let trustDeploy = false;
        if (options.trustDeploy) {
          try {
            resolveTrustedDeployPair({
              ...entry.selector,
              manifestFile: options.manifestFile,
            });
            trustDeploy = true;
          } catch (err) {
            const normalized = normalizeError(err, 'MIRROR_DASHBOARD_TRUST_DEPLOY_FAILED');
            diagnostics.push(`${normalized.code}: ${normalized.message}`);
          }
        }

        if (!diagnostics.length) {
          try {
            const verifyPayload = await verifyMirror({
              indexerUrl,
              timeoutMs: options.timeoutMs,
              pandoraMarketAddress: entry.selector.pandoraMarketAddress,
              polymarketMarketId: entry.selector.polymarketMarketId,
              polymarketSlug: entry.selector.polymarketSlug,
              polymarketHost: options.polymarketHost,
              polymarketGammaUrl: options.polymarketGammaUrl,
              polymarketGammaMockUrl: options.polymarketGammaMockUrl,
              polymarketMockUrl: options.polymarketMockUrl,
              trustDeploy,
              includeSimilarity: false,
              allowRuleMismatch: false,
            });
            live = await toMirrorStatusLivePayload(verifyPayload, entry.state, {
              driftTriggerBps: options.driftTriggerBps,
              hedgeTriggerUsdc: options.hedgeTriggerUsdc,
              timeoutMs: options.timeoutMs,
              polymarketHost: options.polymarketHost,
              polymarketMockUrl: options.polymarketMockUrl,
            });
          } catch (err) {
            const normalized = normalizeError(err, 'MIRROR_DASHBOARD_LIVE_FAILED');
            diagnostics.push(`${normalized.code}: ${normalized.message}`);
          }
        }
      }
    }

    return buildMirrorDashboardItem({
      strategyHash: entry.strategyHash,
      stateFile: entry.stateFile,
      selector: entry.selector,
      state: entry.state,
      runtime,
      live,
      diagnostics,
    });
  }));

  emitSuccess(
    context.outputMode,
    'mirror.dashboard',
    buildMirrorDashboardPayload({
      items,
    }),
    renderMirrorDashboardTable,
  );
};
