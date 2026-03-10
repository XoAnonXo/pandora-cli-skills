const MIRROR_HEALTH_SCHEMA_VERSION = '1.0.0';

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

function renderMirrorHealthTable(data) {
  const summary = data.summary || {};
  const runtime = data.runtime || {};
  const health = runtime.health || {};
  const daemon = runtime.daemon || {};
  renderKeyValueRows('Mirror Health', [
    ['strategyHash', data.strategyHash || ''],
    ['stateFile', data.stateFile || ''],
    ['healthy', data.healthy ? 'yes' : 'no'],
    ['severity', data.severity || ''],
    ['status', summary.status || health.status || ''],
    ['code', summary.code || health.code || ''],
    ['daemonStatus', daemon.status || ''],
    ['daemonAlive', daemon.alive ? 'yes' : 'no'],
    ['daemonPid', daemon.pid === null || daemon.pid === undefined ? '' : daemon.pid],
    ['heartbeatAgeMs', health.heartbeatAgeMs === null || health.heartbeatAgeMs === undefined ? '' : health.heartbeatAgeMs],
    ['pendingAction', health.hasPendingAction ? 'yes' : 'no'],
    ['lastTradeStatus', summary.lastTradeStatus || ''],
    ['nextAction', runtime.nextAction && runtime.nextAction.code ? runtime.nextAction.code : ''],
  ]);
}

function normalizeStrategyHash(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{16}$/.test(normalized) ? normalized : null;
}

function parseMirrorHealthFlags(args, deps) {
  const { CliError, parseAddressFlag, requireFlagValue, parsePositiveInteger } = deps;
  const options = {
    stateFile: null,
    strategyHash: null,
    pidFile: null,
    pandoraMarketAddress: null,
    polymarketMarketId: null,
    polymarketSlug: null,
    staleAfterMs: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--state-file') {
      options.stateFile = requireFlagValue(args, i, '--state-file');
      i += 1;
      continue;
    }
    if (token === '--strategy-hash') {
      const strategyHash = normalizeStrategyHash(requireFlagValue(args, i, '--strategy-hash'));
      if (!strategyHash) {
        throw new CliError('INVALID_FLAG_VALUE', '--strategy-hash must be a 16-character hex value.');
      }
      options.strategyHash = strategyHash;
      i += 1;
      continue;
    }
    if (token === '--pid-file') {
      options.pidFile = requireFlagValue(args, i, '--pid-file');
      i += 1;
      continue;
    }
    if (token === '--pandora-market-address' || token === '--market-address') {
      options.pandoraMarketAddress = parseAddressFlag(requireFlagValue(args, i, token), token);
      i += 1;
      continue;
    }
    if (token === '--polymarket-market-id') {
      options.polymarketMarketId = requireFlagValue(args, i, '--polymarket-market-id');
      i += 1;
      continue;
    }
    if (token === '--polymarket-slug') {
      options.polymarketSlug = requireFlagValue(args, i, '--polymarket-slug');
      i += 1;
      continue;
    }
    if (token === '--stale-after-ms') {
      options.staleAfterMs = parsePositiveInteger(requireFlagValue(args, i, '--stale-after-ms'), '--stale-after-ms');
      i += 1;
      continue;
    }
    throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror health: ${token}`);
  }

  if (!options.stateFile && !options.strategyHash && !options.pidFile && !options.pandoraMarketAddress) {
    throw new CliError(
      'MISSING_REQUIRED_FLAG',
      'mirror health requires --state-file <path>, --strategy-hash <hash>, --pid-file <path>, or --market-address <address>.',
    );
  }

  if ((options.polymarketMarketId || options.polymarketSlug) && !options.pandoraMarketAddress && !options.stateFile && !options.strategyHash) {
    throw new CliError(
      'MISSING_REQUIRED_FLAG',
      'mirror health requires --market-address <address> when using --polymarket-market-id or --polymarket-slug without persisted state.',
    );
  }

  return options;
}

function deriveSeverity(runtime) {
  const health = runtime && runtime.health ? runtime.health : {};
  if (health.status === 'running') return 'ok';
  if (health.status === 'idle' && health.code === 'LAST_TICK_RECORDED') return 'ok';
  if (health.status === 'idle') return 'warn';
  if (health.status === 'degraded') return 'warn';
  return 'error';
}

function buildSelector(options, loaded, daemonStatus) {
  const daemonMeta = daemonStatus && daemonStatus.metadata && typeof daemonStatus.metadata === 'object'
    ? daemonStatus.metadata
    : null;
  const state = loaded && loaded.state && typeof loaded.state === 'object' ? loaded.state : {};
  return {
    pandoraMarketAddress:
      options.pandoraMarketAddress
      || state.pandoraMarketAddress
      || (daemonMeta && daemonMeta.pandoraMarketAddress)
      || null,
    polymarketMarketId:
      options.polymarketMarketId
      || state.polymarketMarketId
      || (daemonMeta && daemonMeta.polymarketMarketId)
      || null,
    polymarketSlug:
      options.polymarketSlug
      || state.polymarketSlug
      || (daemonMeta && daemonMeta.polymarketSlug)
      || null,
  };
}

function buildSelectorArgs(selector = {}) {
  const args = [];
  if (selector.pandoraMarketAddress) {
    args.push(`--market-address ${selector.pandoraMarketAddress}`);
  }
  if (selector.polymarketMarketId) {
    args.push(`--polymarket-market-id ${selector.polymarketMarketId}`);
  } else if (selector.polymarketSlug) {
    args.push(`--polymarket-slug ${selector.polymarketSlug}`);
  }
  return args;
}

function buildHealthCommand(options, payload) {
  if (options.pidFile) {
    return `pandora mirror health --pid-file ${options.pidFile}`;
  }
  if (options.stateFile) {
    return [
      'pandora mirror health',
      `--state-file ${options.stateFile}`,
      ...buildSelectorArgs(payload && payload.selector ? payload.selector : options),
    ].join(' ');
  }
  if (payload && payload.strategyHash) {
    return [
      'pandora mirror health',
      `--strategy-hash ${payload.strategyHash}`,
      ...buildSelectorArgs(payload && payload.selector ? payload.selector : options),
    ].join(' ');
  }
  if (options.pandoraMarketAddress) {
    return [
      'pandora mirror health',
      ...buildSelectorArgs(payload && payload.selector ? payload.selector : options),
    ].join(' ');
  }
  return null;
}

module.exports = async function handleMirrorHealth({ actionArgs, context, deps }) {
  const {
    CliError,
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    parseAddressFlag,
    requireFlagValue,
    parsePositiveInteger,
    resolveMirrorSurfaceState,
    resolveMirrorSurfaceDaemonStatus,
    mirrorDaemonStatus,
    buildMirrorRuntimeTelemetry,
  } = deps;

  const usage =
    'pandora [--output table|json] mirror health --state-file <path>|--strategy-hash <hash>|--pid-file <path>|--market-address <address> [--polymarket-market-id <id>|--polymarket-slug <slug>] [--stale-after-ms <ms>]';

  if (includesHelpFlag(actionArgs)) {
    const notes = [
      'mirror health is the machine-usable daemon/runtime status surface for a single mirror strategy.',
      'Use --pid-file or --strategy-hash for detached daemons, or --state-file/--market-address when you are reconciling persisted runtime state.',
      'The payload surfaces runtime.health, daemon metadata, pending-action blockers, last error context, and the next operator action.',
    ];
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'mirror.health.help', commandHelpPayload(usage, notes));
    } else {
      console.log(`Usage: ${usage}`);
      for (const note of notes) {
        console.log(note);
      }
    }
    return;
  }

  const options = parseMirrorHealthFlags(actionArgs, {
    CliError,
    parseAddressFlag,
    requireFlagValue,
    parsePositiveInteger,
  });

  let explicitDaemonStatus = null;
  if (options.pidFile) {
    explicitDaemonStatus = mirrorDaemonStatus({ pidFile: options.pidFile });
  } else if (options.strategyHash && !options.stateFile) {
    explicitDaemonStatus = mirrorDaemonStatus({ strategyHash: options.strategyHash });
  }

  const explicitStateFile =
    options.stateFile
    || (
      explicitDaemonStatus
      && explicitDaemonStatus.metadata
      && explicitDaemonStatus.metadata.stateFile
        ? explicitDaemonStatus.metadata.stateFile
        : null
    );
  const loaded = explicitStateFile || options.strategyHash
    ? resolveMirrorSurfaceState({
        stateFile: explicitStateFile,
        strategyHash: options.strategyHash || (explicitDaemonStatus && explicitDaemonStatus.strategyHash) || null,
        pandoraMarketAddress: options.pandoraMarketAddress || null,
        polymarketMarketId: options.polymarketMarketId || null,
        polymarketSlug: options.polymarketSlug || null,
      })
    : resolveMirrorSurfaceState({
        pandoraMarketAddress: options.pandoraMarketAddress || null,
        polymarketMarketId: options.polymarketMarketId || null,
        polymarketSlug: options.polymarketSlug || null,
      });

  const selector = buildSelector(options, loaded, explicitDaemonStatus);
  const daemonStatus = explicitDaemonStatus || resolveMirrorSurfaceDaemonStatus(selector, loaded.state);
  const runtime = buildMirrorRuntimeTelemetry({
    state: loaded.state,
    stateFile: loaded.filePath,
    daemonStatus,
    staleAfterMs: options.staleAfterMs || undefined,
  });

  const severity = deriveSeverity(runtime);
  const healthy = severity === 'ok';
  const payload = {
    schemaVersion: MIRROR_HEALTH_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    stateFile: loaded.filePath,
    strategyHash:
      loaded.state.strategyHash
      || options.strategyHash
      || (daemonStatus && daemonStatus.strategyHash)
      || null,
    selector,
    healthy,
    severity,
    summary: {
      healthy,
      severity,
      status: runtime.health ? runtime.health.status : null,
      code: runtime.health ? runtime.health.code : null,
      daemonFound: runtime.daemon ? Boolean(runtime.daemon.found) : false,
      daemonAlive: runtime.daemon ? Boolean(runtime.daemon.alive) : false,
      hasPendingAction: runtime.health ? Boolean(runtime.health.hasPendingAction) : false,
      errorCount: runtime.errorCount || 0,
      warningCount: runtime.warningCount || 0,
      nextAction: runtime.nextAction || null,
      lastTradeStatus: runtime.summary ? runtime.summary.lastTradeStatus : null,
      lastTradeAt: runtime.summary ? runtime.summary.lastTradeAt : null,
    },
    runtime,
    followUpActions: runtime.nextAction
      ? [
          {
            code: runtime.nextAction.code,
            message: runtime.nextAction.message,
            blocking: Boolean(runtime.nextAction.blocking),
            command: buildHealthCommand(options, {
              strategyHash:
                loaded.state.strategyHash
                || options.strategyHash
                || (daemonStatus && daemonStatus.strategyHash)
                || null,
              selector,
            }),
          },
        ]
      : [],
  };

  emitSuccess(
    context.outputMode,
    'mirror.health',
    payload,
    renderMirrorHealthTable,
  );
};
