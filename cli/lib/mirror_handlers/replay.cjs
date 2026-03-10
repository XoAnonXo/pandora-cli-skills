const { buildMirrorRuntimeTelemetry } = require('../mirror_sync/state.cjs');
const { buildMirrorReplayPayload } = require('../mirror_replay_service.cjs');
const {
  buildMirrorAuditPayload,
  loadAuditEntries,
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

function renderMirrorReplayTable(data) {
  const summary = data.summary || {};
  renderKeyValueRows('Mirror Replay', [
    ['strategyHash', data.strategyHash || ''],
    ['stateFile', data.stateFile || ''],
    ['ledgerSource', data.ledger && data.ledger.source ? data.ledger.source : ''],
    ['actionCount', summary.actionCount || 0],
    ['modeledActionCount', summary.modeledActionCount || 0],
    ['matchedModelCount', summary.matchedModelCount || 0],
    ['deviatedCount', summary.deviatedCount || 0],
    ['failedCount', summary.failedCount || 0],
    ['totalPlannedSpendUsdc', summary.totalPlannedSpendUsdc],
    ['totalActualSpendUsdc', summary.totalActualSpendUsdc],
    ['totalSpendVarianceUsdc', summary.totalSpendVarianceUsdc],
  ]);
  if (Array.isArray(data.actions) && data.actions.length) {
    console.table(
      data.actions.slice(0, 10).map((action) => ({
        timestamp: action.timestamp,
        verdict: action.verdict,
        status: action.status,
        plannedSpendUsdc: action.modeled && action.modeled.plannedSpendUsdc,
        actualSpendUsdc: action.actual && action.actual.spendUsdc,
        attemptedSpendUsdc: action.actual && action.actual.attemptedSpendUsdc,
        spendVarianceUsdc: action.variance && action.variance.spendUsdc,
        idempotencyKey: action.idempotencyKey,
      })),
    );
  }
}

function hasMeaningfulState(state = {}) {
  return Boolean(
    state
    && (
      state.lastExecution
      || (Array.isArray(state.alerts) && state.alerts.length)
      || (Array.isArray(state.idempotencyKeys) && state.idempotencyKeys.length)
    ),
  );
}

function resolveReplayState(options = {}) {
  const strategyHash = options.strategyHash || null;
  let loaded = resolveMirrorSurfaceState({
    stateFile: options.stateFile || null,
    strategyHash,
    pandoraMarketAddress: options.pandoraMarketAddress || null,
    polymarketMarketId: options.polymarketMarketId || null,
    polymarketSlug: options.polymarketSlug || null,
  });
  let selector = {
    pandoraMarketAddress: options.pandoraMarketAddress || loaded.state.pandoraMarketAddress || null,
    polymarketMarketId: options.polymarketMarketId || loaded.state.polymarketMarketId || null,
    polymarketSlug: options.polymarketSlug || loaded.state.polymarketSlug || null,
  };
  let daemon = resolveMirrorSurfaceDaemonStatus(selector, loaded.state);

  if (!loaded.filePath && selector.pandoraMarketAddress && daemon && daemon.metadata && daemon.metadata.stateFile) {
    loaded = resolveMirrorSurfaceState({
      stateFile: daemon.metadata.stateFile,
      strategyHash: daemon.strategyHash || strategyHash,
      pandoraMarketAddress: selector.pandoraMarketAddress || null,
      polymarketMarketId: selector.polymarketMarketId || null,
      polymarketSlug: selector.polymarketSlug || null,
    });
    selector = {
      pandoraMarketAddress: selector.pandoraMarketAddress || loaded.state.pandoraMarketAddress || null,
      polymarketMarketId: selector.polymarketMarketId || loaded.state.polymarketMarketId || null,
      polymarketSlug: selector.polymarketSlug || loaded.state.polymarketSlug || null,
    };
    daemon = resolveMirrorSurfaceDaemonStatus(selector, loaded.state) || daemon;
  }

  return {
    loaded,
    selector,
    daemon,
  };
}

module.exports = async function handleMirrorReplay({ actionArgs, context, deps }) {
  const {
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    parseMirrorReplayFlags,
  } = deps;

  const usage =
    'pandora [--output table|json] mirror replay --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) [--limit <n>]';

  if (includesHelpFlag(actionArgs)) {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'mirror.replay.help',
        commandHelpPayload(usage, [
          'mirror replay is read-only and compares modeled rebalance/hedge sizing against persisted execution outcomes from the mirror audit log.',
          'When no append-only audit log exists yet, replay falls back to persisted lastExecution state so operators still get a machine-usable summary.',
          'Selector-first replay resolves a matching daemon state file when one is running; otherwise it returns an empty replay with diagnostics instead of submitting any live lookup.',
        ]),
      );
    } else {
      console.log(`Usage: ${usage}`);
      console.log('mirror replay is read-only and compares modeled rebalance/hedge sizing against persisted execution outcomes from the mirror audit log.');
      console.log('When no append-only audit log exists yet, replay falls back to persisted lastExecution state so operators still get a machine-usable summary.');
      console.log('Selector-first replay resolves a matching daemon state file when one is running; otherwise it returns an empty replay with diagnostics instead of submitting any live lookup.');
    }
    return;
  }

  const options = parseMirrorReplayFlags(actionArgs);
  const { loaded, selector, daemon } = resolveReplayState(options);
  const runtime = buildMirrorRuntimeTelemetry({
    state: loaded.state,
    stateFile: loaded.filePath,
    daemonStatus: daemon,
  });
  const auditLog = loaded.filePath ? loadAuditEntries(loaded.filePath, options.limit) : { entries: [] };
  const diagnostics = [];

  if (!loaded.filePath && !hasMeaningfulState(loaded.state)) {
    diagnostics.push('No persisted mirror state matched the selector; replay is empty until mirror sync writes state or audit entries.');
  } else if (!auditLog.entries.length && !loaded.state.lastExecution) {
    diagnostics.push('No persisted mirror execution history is available for replay yet.');
  }

  const auditPayload = buildMirrorAuditPayload({
    stateFile: loaded.filePath,
    strategyHash: loaded.state.strategyHash || options.strategyHash || null,
    selector,
    state: loaded.state,
    runtime,
    auditEntries: auditLog.entries,
    diagnostics,
  });

  emitSuccess(
    context.outputMode,
    'mirror.replay',
    buildMirrorReplayPayload({
      audit: auditPayload,
      diagnostics,
    }),
    renderMirrorReplayTable,
  );
};
