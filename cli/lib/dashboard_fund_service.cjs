const {
  buildMirrorDashboardItem,
  buildMirrorDashboardPayload,
  loadMirrorDashboardContexts,
  resolveMirrorSurfaceDaemonStatus,
} = require('./mirror_surface_service.cjs');
const { buildMirrorRuntimeTelemetry } = require('./mirror_sync/state.cjs');

const DASHBOARD_SCHEMA_VERSION = '1.0.0';
const DEFAULT_DRIFT_TRIGGER_BPS = 150;
const DEFAULT_HEDGE_TRIGGER_USDC = 10;

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`dashboard/fund-check service requires deps.${name}()`);
  }
  return deps[name];
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

function requireFlagValue(args, index, flagName, CliError) {
  if (index + 1 >= args.length || String(args[index + 1]).startsWith('--')) {
    throw new CliError('MISSING_REQUIRED_FLAG', `${flagName} requires a value.`);
  }
  return String(args[index + 1]);
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundNumber(value, decimals = 6) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return null;
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function buildMirrorStatusCommand(item = {}, includeLive = true) {
  if (item.strategyHash) {
    return `pandora mirror status --strategy-hash ${item.strategyHash}${includeLive ? ' --with-live' : ''}`;
  }
  const selector = item.selector && typeof item.selector === 'object' ? item.selector : {};
  const parts = ['pandora mirror status'];
  if (selector.pandoraMarketAddress) {
    parts.push(`--pandora-market-address ${selector.pandoraMarketAddress}`);
  }
  if (selector.polymarketMarketId) {
    parts.push(`--polymarket-market-id ${selector.polymarketMarketId}`);
  } else if (selector.polymarketSlug) {
    parts.push(`--polymarket-slug ${selector.polymarketSlug}`);
  }
  if (includeLive) parts.push('--with-live');
  return parts.join(' ');
}

function buildMirrorSyncStatusCommand(item = {}) {
  if (item.strategyHash) {
    return `pandora mirror sync status --strategy-hash ${item.strategyHash}`;
  }
  return null;
}

function buildDashboardItemCommands(item = {}) {
  const commands = [];
  commands.push(buildMirrorStatusCommand(item, Boolean(item.liveAvailable)));
  const syncStatus = buildMirrorSyncStatusCommand(item);
  const runtimeStatus = item.runtime && item.runtime.health ? item.runtime.health.status : null;
  if (syncStatus && (runtimeStatus === 'blocked' || runtimeStatus === 'stale' || runtimeStatus === 'degraded' || runtimeStatus === 'error')) {
    commands.push(syncStatus);
  }
  return uniqueStrings(commands);
}

function parseDashboardFlags(args, CliError) {
  const options = {
    withLive: true,
    trustDeploy: false,
    manifestFile: null,
    driftTriggerBps: DEFAULT_DRIFT_TRIGGER_BPS,
    hedgeTriggerUsdc: DEFAULT_HEDGE_TRIGGER_USDC,
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
      options.driftTriggerBps = parsePositiveInteger(
        requireFlagValue(args, i, '--drift-trigger-bps', CliError),
        '--drift-trigger-bps',
        CliError,
      );
      i += 1;
      continue;
    }
    if (token === '--hedge-trigger-usdc') {
      options.hedgeTriggerUsdc = parsePositiveNumber(
        requireFlagValue(args, i, '--hedge-trigger-usdc', CliError),
        '--hedge-trigger-usdc',
        CliError,
      );
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
    throw new CliError('UNKNOWN_FLAG', `Unknown flag for dashboard: ${token}`);
  }

  return options;
}

async function collectDashboardItems(options = {}, deps = {}) {
  const contexts = (deps.loadMirrorDashboardContexts || loadMirrorDashboardContexts)();
  const runtimeBuilder = deps.buildMirrorRuntimeTelemetry || buildMirrorRuntimeTelemetry;
  const verifyMirror = requireDep(deps, 'verifyMirror');
  const toMirrorStatusLivePayload = requireDep(deps, 'toMirrorStatusLivePayload');
  const resolveTrustedDeployPair = requireDep(deps, 'resolveTrustedDeployPair');
  const items = [];
  const diagnostics = [];

  for (const context of contexts) {
    const selector = context && context.selector && typeof context.selector === 'object'
      ? context.selector
      : {};
    const runtime = runtimeBuilder({
      state: context.state || {},
      stateFile: context.stateFile || null,
      daemonStatus: context.daemonStatus || resolveMirrorSurfaceDaemonStatus(selector, context.state || {}),
    });
    let live = null;
    const itemDiagnostics = [];

    if (options.withLive) {
      try {
        let trustDeploy = false;
        if (options.trustDeploy) {
          resolveTrustedDeployPair({
            pandoraMarketAddress: selector.pandoraMarketAddress || null,
            polymarketMarketId: selector.polymarketMarketId || null,
            polymarketSlug: selector.polymarketSlug || null,
            manifestFile: options.manifestFile || null,
          });
          trustDeploy = true;
        }
        const verifyPayload = await verifyMirror({
          indexerUrl: options.indexerUrl || null,
          timeoutMs: options.timeoutMs || null,
          pandoraMarketAddress: selector.pandoraMarketAddress || null,
          polymarketMarketId: selector.polymarketMarketId || null,
          polymarketSlug: selector.polymarketSlug || null,
          polymarketHost: options.polymarketHost || null,
          polymarketGammaUrl: options.polymarketGammaUrl || null,
          polymarketGammaMockUrl: options.polymarketGammaMockUrl || null,
          polymarketMockUrl: options.polymarketMockUrl || null,
          trustDeploy,
          includeSimilarity: false,
          allowRuleMismatch: false,
        });
        live = await toMirrorStatusLivePayload(verifyPayload, context.state || {}, {
          driftTriggerBps: options.driftTriggerBps,
          hedgeTriggerUsdc: options.hedgeTriggerUsdc,
          timeoutMs: options.timeoutMs || null,
          polymarketHost: options.polymarketHost || null,
          polymarketMockUrl: options.polymarketMockUrl || null,
        });
      } catch (error) {
        itemDiagnostics.push(error && error.message ? error.message : String(error));
      }
    }

    const item = buildMirrorDashboardItem({
      strategyHash: context.strategyHash || null,
      stateFile: context.stateFile || null,
      selector,
      state: context.state || {},
      runtime,
      live,
      diagnostics: itemDiagnostics,
    });
    item.suggestedNextCommands = buildDashboardItemCommands(item);
    items.push(item);
  }

  return { items, diagnostics };
}

function buildDashboardSuggestedNextCommands(items = []) {
  const actionItems = items.filter((item) => item && item.actionability && item.actionability.status === 'action-needed');
  const unhealthyItems = items.filter((item) => {
    const runtimeStatus = item && item.runtime && item.runtime.health ? item.runtime.health.status : null;
    return runtimeStatus === 'blocked' || runtimeStatus === 'stale' || runtimeStatus === 'degraded' || runtimeStatus === 'error';
  });

  const commands = [];
  for (const item of actionItems) {
    commands.push(...buildDashboardItemCommands(item));
  }
  for (const item of unhealthyItems) {
    commands.push(...buildDashboardItemCommands(item));
  }

  if (!items.length) {
    commands.push('pandora mirror go --help');
    commands.push('pandora mirror sync --help');
  }

  return uniqueStrings(commands).slice(0, 8);
}

function renderDashboardTable(data) {
  console.log('Dashboard');
  const summary = data && data.summary ? data.summary : {};
  console.log(`markets=${summary.marketCount || 0} live=${summary.liveCount || 0} actionNeeded=${summary.actionNeededCount || 0} blocked=${summary.blockedCount || 0} pnlApprox=${summary.totalNetPnlApproxUsdc ?? ''}`);
  const items = Array.isArray(data && data.items) ? data.items : [];
  for (const item of items) {
    const label = item.question || JSON.stringify(item.selector || {});
    const runtimeStatus = item.runtime && item.runtime.health ? item.runtime.health.status : '';
    const actionability = item.actionability && item.actionability.status ? item.actionability.status : '';
    const driftBps = item.drift && item.drift.driftBps !== null ? item.drift.driftBps : '';
    const hedgeGapUsdc = item.hedge && item.hedge.hedgeGapUsdc !== null ? item.hedge.hedgeGapUsdc : '';
    const pnlApprox = item.pnl && item.pnl.netPnlApproxUsdc !== null ? item.pnl.netPnlApproxUsdc : '';
    console.log(`${label}: runtime=${runtimeStatus} action=${actionability} driftBps=${driftBps} hedgeGapUsdc=${hedgeGapUsdc} netPnlApproxUsdc=${pnlApprox}`);
  }
  if (Array.isArray(data.suggestedNextCommands) && data.suggestedNextCommands.length) {
    console.log('next:');
    for (const command of data.suggestedNextCommands) {
      console.log(`  ${command}`);
    }
  }
}

function createRunDashboardCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseIndexerSharedFlags = requireDep(deps, 'parseIndexerSharedFlags');
  const maybeLoadIndexerEnv = requireDep(deps, 'maybeLoadIndexerEnv');
  const maybeLoadTradeEnv = requireDep(deps, 'maybeLoadTradeEnv');
  const resolveIndexerUrl = requireDep(deps, 'resolveIndexerUrl');

  return async function runDashboardCommand(args, context) {
    const usage =
      'pandora [--output table|json] dashboard [--with-live|--no-live] [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]';

    if (includesHelpFlag(args)) {
      emitSuccess(
        context.outputMode,
        'dashboard.help',
        commandHelpPayload(usage, [
          'dashboard summarizes discovered mirror markets side-by-side from local mirror state files and daemon metadata.',
          'Live mode is enabled by default so actionability, hedge gaps, and PnL reuse the same mirror live payload used by mirror status/pnl.',
          'suggestedNextCommands highlights the next mirror status/sync status commands worth running for markets that need action or runtime repair.',
        ]),
      );
      return;
    }

    const shared = parseIndexerSharedFlags(args);
    const options = parseDashboardFlags(shared.rest, CliError);
    maybeLoadIndexerEnv(shared);
    if (options.withLive) {
      maybeLoadTradeEnv(shared);
    }

    options.indexerUrl = options.withLive ? resolveIndexerUrl(shared.indexerUrl) : null;
    options.timeoutMs = shared.timeoutMs;

    const { items } = await collectDashboardItems(options, deps);
    const payloadBuilder = deps.buildMirrorDashboardPayload || buildMirrorDashboardPayload;
    const basePayload = payloadBuilder({ items });
    const payload = {
      schemaVersion: DASHBOARD_SCHEMA_VERSION,
      generatedAt: basePayload.generatedAt,
      summary: basePayload.summary,
      items: basePayload.items.map((item) => ({
        ...item,
        suggestedNextCommands: Array.isArray(item.suggestedNextCommands) ? item.suggestedNextCommands : [],
      })),
      diagnostics: basePayload.diagnostics,
      suggestedNextCommands: buildDashboardSuggestedNextCommands(items),
    };

    emitSuccess(context.outputMode, 'dashboard', payload, renderDashboardTable);
  };
}


module.exports = {
  DASHBOARD_SCHEMA_VERSION,
  createRunDashboardCommand,
};
