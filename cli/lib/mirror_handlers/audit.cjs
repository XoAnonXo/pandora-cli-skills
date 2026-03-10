const { buildMirrorRuntimeTelemetry } = require('../mirror_sync/state.cjs');
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

function renderMirrorAuditTable(data) {
  const summary = data.summary || {};
  const ledger = data.ledger || {};
  renderKeyValueRows('Mirror Audit', [
    ['strategyHash', data.strategyHash || ''],
    ['stateFile', data.stateFile || ''],
    ['accountingMode', summary.accountingMode || 'append-only-ledger'],
    ['runtimeHealth', summary.runtimeHealth || ''],
    ['lastExecutionStatus', summary.lastExecutionStatus || ''],
    ['requiresManualReview', summary.requiresManualReview ? 'yes' : 'no'],
    ['entryCount', summary.entryCount],
    ['actionCount', summary.actionCount],
    ['legCount', summary.legCount],
    ['alertCount', summary.alertCount],
    ['errorCount', summary.errorCount],
    ['reconciledRowCount', summary.reconciledRowCount],
    ['realizedPnlUsdc', summary.realizedPnlUsdc],
    ['unrealizedPnlUsdc', summary.unrealizedPnlUsdc],
    ['netPnlUsdc', summary.netPnlUsdc],
    ['liveCrossVenueStatus', summary.liveCrossVenueStatus || ''],
    ['latestEntry', Array.isArray(ledger.entries) && ledger.entries.length ? ledger.entries[0].classification : ''],
  ]);
}

module.exports = async function handleMirrorAudit({ actionArgs, shared, context, deps }) {
  const {
    CliError,
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    maybeLoadIndexerEnv,
    maybeLoadTradeEnv,
    parseMirrorAuditFlags,
    resolveTrustedDeployPair,
    resolveIndexerUrl,
    verifyMirror,
    coerceMirrorServiceError,
    toMirrorStatusLivePayload,
  } = deps;

  const usage =
    'pandora [--output table|json] mirror audit --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) [--reconciled] [--with-live] [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]';

  if (includesHelpFlag(actionArgs)) {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'mirror.audit.help',
        commandHelpPayload(usage, [
          'mirror audit reads append-only mirror audit entries when available and falls back to persisted runtime state if no ledger exists yet.',
          'Use --reconciled to add normalized ledger rows, realized/unrealized components, and source provenance next to the append-only operational ledger.',
          'Add --with-live to attach current cross-venue context next to the persisted audit trail.',
        ]),
      );
    } else {
      console.log(`Usage: ${usage}`);
      console.log('mirror audit reads append-only mirror audit entries when available and falls back to persisted runtime state if no ledger exists yet.');
      console.log('Use --reconciled to add normalized ledger rows, realized/unrealized components, and source provenance next to the append-only operational ledger.');
      console.log('Add --with-live to attach current cross-venue context next to the persisted audit trail.');
    }
    return;
  }

  const options = parseMirrorAuditFlags(actionArgs);
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

  let live = null;
  if (options.withLive) {
    if (!selector.pandoraMarketAddress) {
      throw new CliError(
        'MISSING_REQUIRED_FLAG',
        'mirror audit --with-live requires --pandora-market-address/--market-address (or a state file containing it).',
      );
    }
    if (!selector.polymarketMarketId && !selector.polymarketSlug) {
      throw new CliError(
        'MISSING_REQUIRED_FLAG',
        'mirror audit --with-live requires --polymarket-market-id or --polymarket-slug (or a state file containing one).',
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
      throw coerceMirrorServiceError(err, 'MIRROR_AUDIT_FAILED');
    }
    live = await toMirrorStatusLivePayload(verifyPayload, loaded.state, {
      driftTriggerBps: options.driftTriggerBps,
      hedgeTriggerUsdc: options.hedgeTriggerUsdc,
      timeoutMs: options.timeoutMs,
      polymarketHost: options.polymarketHost,
      polymarketMockUrl: options.polymarketMockUrl,
    });
  }

  const auditLog = loadAuditEntries(loaded.filePath);

  const payload = buildMirrorAuditPayload({
    stateFile: loaded.filePath,
    strategyHash: loaded.state.strategyHash || strategyHashValue,
    selector,
    state: loaded.state,
    runtime,
    live,
    auditEntries: auditLog.entries,
    accounting: loaded.state.accounting || null,
    includeReconciled: options.reconciled,
  });

  payload.summary = {
    ...(payload.summary && typeof payload.summary === 'object' ? payload.summary : {}),
    accountingMode: options.reconciled && payload.reconciled ? payload.reconciled.status : 'append-only-ledger',
  };
  payload.reconciliation = {
    requested: Boolean(options.reconciled),
    mode: options.reconciled && payload.reconciled ? payload.reconciled.status : 'append-only-ledger',
    ledgerSource: payload.ledger && payload.ledger.source ? payload.ledger.source : null,
    missing: payload.reconciled && payload.reconciled.provenance ? payload.reconciled.provenance.missing : [],
  };
  payload.diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics.slice() : [];
  if (options.reconciled && payload.reconciled && Array.isArray(payload.reconciled.provenance && payload.reconciled.provenance.missing) && payload.reconciled.provenance.missing.length) {
    payload.diagnostics.push(
      `Reconciled ledger is partial; missing components: ${payload.reconciled.provenance.missing.join(', ')}.`,
    );
  }

  emitSuccess(context.outputMode, 'mirror.audit', payload, renderMirrorAuditTable);
};
