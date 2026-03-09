const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildMirrorRuntimeTelemetry } = require('../mirror_sync/state.cjs');
const { resolveMirrorSurfaceState } = require('../mirror_surface_service.cjs');
const { daemonStatus, findPidFilesByMarketAddress } = require('../mirror_daemon_service.cjs');
const { createParseMirrorLogsFlags } = require('../parsers/mirror_remaining_flags.cjs');

const MIRROR_LOGS_SCHEMA_VERSION = '1.0.0';
const MIRROR_LOGS_USAGE =
  'pandora [--output table|json] mirror logs --state-file <path>|--strategy-hash <hash>|--pandora-market-address <address>|--market-address <address> [--polymarket-market-id <id>|--polymarket-slug <slug>] [--lines <n>]';

function parseAddressFlag(value, flagName, CliError) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(value || ''))) {
    throw new CliError(
      'INVALID_FLAG_VALUE',
      `${flagName} must be a valid 20-byte hex address (0x + 40 hex chars). Received: "${value}"`,
    );
  }
  return String(value).toLowerCase();
}

function requireFlagValue(args, index, flagName, CliError) {
  const next = args[index + 1];
  if (!next || String(next).startsWith('--')) {
    throw new CliError('MISSING_REQUIRED_FLAG', `${flagName} requires a value.`);
  }
  return String(next);
}

function parsePositiveInteger(value, flagName, CliError) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a positive integer. Received: "${value}"`);
  }
  return parsed;
}

function getParseMirrorLogsFlags(CliError) {
  return createParseMirrorLogsFlags({
    CliError,
    parseAddressFlag: (value, flagName) => parseAddressFlag(value, flagName, CliError),
    requireFlagValue: (args, index, flagName) => requireFlagValue(args, index, flagName, CliError),
    parsePositiveInteger: (value, flagName) => parsePositiveInteger(value, flagName, CliError),
  });
}

function fileExists(filePath) {
  try {
    return Boolean(filePath) && fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function defaultMirrorLogFile(strategyHash) {
  const hash = String(strategyHash || '').trim().toLowerCase();
  if (!/^[a-f0-9]{16}$/.test(hash)) return null;
  return path.join(os.homedir(), '.pandora', 'mirror', 'logs', `${hash}.log`);
}

function normalizeSelector(selector = {}) {
  return {
    pandoraMarketAddress: selector.pandoraMarketAddress || null,
    polymarketMarketId: selector.polymarketMarketId || null,
    polymarketSlug: selector.polymarketSlug || null,
  };
}

function matchesSelector(metadata = {}, selector = {}) {
  if (selector.polymarketMarketId && metadata.polymarketMarketId !== selector.polymarketMarketId) {
    return false;
  }
  if (selector.polymarketSlug && metadata.polymarketSlug !== selector.polymarketSlug) {
    return false;
  }
  return true;
}

function resolveLogsDaemonStatus(selector = {}, state = {}) {
  const diagnostics = [];
  const strategyHash = state && state.strategyHash ? String(state.strategyHash) : null;

  if (strategyHash) {
    const status = daemonStatus({ strategyHash });
    return {
      status,
      matchedBy: 'strategy-hash',
      ambiguousPidFiles:
        status && status.metadata && Array.isArray(status.metadata.ambiguousPidFiles)
          ? status.metadata.ambiguousPidFiles
          : [],
      diagnostics,
    };
  }

  const marketAddress = selector && selector.pandoraMarketAddress ? String(selector.pandoraMarketAddress).toLowerCase() : null;
  if (!marketAddress) {
    return {
      status: null,
      matchedBy: null,
      ambiguousPidFiles: [],
      diagnostics,
    };
  }

  const pidFiles = findPidFilesByMarketAddress(marketAddress).sort();
  if (!pidFiles.length) {
    diagnostics.push('No mirror daemon metadata matched the requested Pandora market address.');
    return {
      status: null,
      matchedBy: 'market-selector',
      ambiguousPidFiles: [],
      diagnostics,
    };
  }

  const resolved = pidFiles.map((pidFile) => daemonStatus({ pidFile }));
  const exactMatches = resolved.filter((item) => item && item.metadata && matchesSelector(item.metadata, selector));
  if ((selector.polymarketMarketId || selector.polymarketSlug) && !exactMatches.length) {
    diagnostics.push('No mirror daemon metadata matched the requested Polymarket selector for this Pandora market.');
    return {
      status: null,
      matchedBy: 'market-selector',
      ambiguousPidFiles: pidFiles,
      diagnostics,
    };
  }

  const matches = exactMatches.length ? exactMatches : resolved;
  const selected = matches[matches.length - 1] || null;
  const ambiguousPidFiles = matches.length > 1 ? matches.map((item) => item.pidFile) : [];
  if (ambiguousPidFiles.length) {
    diagnostics.push('Multiple mirror daemons matched the selector; returning the most recent pid file.');
  }

  return {
    status: selected,
    matchedBy: 'market-selector',
    ambiguousPidFiles,
    diagnostics,
  };
}

function readTailEntries(filePath, requestedLines) {
  const text = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') {
    lines.pop();
  }
  const totalLines = lines.length;
  const start = Math.max(0, totalLines - requestedLines);
  const sliced = lines.slice(start);
  return {
    totalLines,
    truncated: totalLines > sliced.length,
    entries: sliced.map((line, index) => ({
      lineNumber: start + index + 1,
      text: line,
    })),
  };
}

function renderMirrorLogsTable(data) {
  const log = data.log || {};
  const runtime = data.runtime || {};
  const daemon = runtime.daemon || {};
  console.log('Mirror Logs');
  console.log(`strategyHash: ${data.strategyHash || ''}`);
  console.log(`stateFile: ${data.stateFile || ''}`);
  console.log(`logFile: ${log.file || ''}`);
  console.log(`available: ${log.exists ? 'yes' : 'no'}`);
  console.log(`requestedLines: ${log.requestedLines || 0}`);
  console.log(`returnedLines: ${log.returnedLines || 0}`);
  console.log(`truncated: ${log.truncated ? 'yes' : 'no'}`);
  console.log(`daemonStatus: ${daemon.status || ''}`);
  if (Array.isArray(data.diagnostics) && data.diagnostics.length) {
    console.log(`diagnostics: ${data.diagnostics.join(' | ')}`);
  }
  if (Array.isArray(log.entries) && log.entries.length) {
    console.log('');
    for (const entry of log.entries) {
      console.log(`${entry.lineNumber}: ${entry.text}`);
    }
  }
}

module.exports = async function handleMirrorLogs({ actionArgs, context, deps }) {
  const {
    CliError,
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
  } = deps;

  if (includesHelpFlag(actionArgs)) {
    const notes = [
      'mirror logs resolves daemon log files from a state file, strategy hash, or Pandora market selector when daemon metadata exists.',
      '--polymarket-market-id and --polymarket-slug narrow market-selector matches when more than one daemon shares the same Pandora market address.',
      'The payload returns tailed log entries plus runtime/daemon metadata; missing log files surface diagnostics instead of hard failures.',
    ];
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'mirror.logs.help', commandHelpPayload(MIRROR_LOGS_USAGE, notes));
    } else {
      console.log(`Usage: ${MIRROR_LOGS_USAGE}`);
      for (const note of notes) {
        console.log(note);
      }
    }
    return;
  }

  const parseMirrorLogsFlags = getParseMirrorLogsFlags(CliError);
  const options = parseMirrorLogsFlags(actionArgs);

  let loaded = resolveMirrorSurfaceState({
    stateFile: options.stateFile || null,
    strategyHash: options.strategyHash || null,
  });

  let selector = {
    pandoraMarketAddress: options.pandoraMarketAddress || loaded.state.pandoraMarketAddress || null,
    polymarketMarketId: options.polymarketMarketId || loaded.state.polymarketMarketId || null,
    polymarketSlug: options.polymarketSlug || loaded.state.polymarketSlug || null,
  };

  let resolution = resolveLogsDaemonStatus(selector, loaded.state);
  const daemonMeta = resolution.status && resolution.status.metadata && typeof resolution.status.metadata === 'object'
    ? resolution.status.metadata
    : null;

  if ((!fileExists(loaded.filePath)) && daemonMeta && daemonMeta.stateFile && fileExists(daemonMeta.stateFile)) {
    loaded = resolveMirrorSurfaceState({
      stateFile: daemonMeta.stateFile,
      strategyHash: options.strategyHash || loaded.state.strategyHash || null,
    });
    selector = {
      pandoraMarketAddress: options.pandoraMarketAddress || loaded.state.pandoraMarketAddress || daemonMeta.pandoraMarketAddress || null,
      polymarketMarketId: options.polymarketMarketId || loaded.state.polymarketMarketId || daemonMeta.polymarketMarketId || null,
      polymarketSlug: options.polymarketSlug || loaded.state.polymarketSlug || daemonMeta.polymarketSlug || null,
    };
    resolution = resolveLogsDaemonStatus(selector, loaded.state);
  } else {
    selector = {
      pandoraMarketAddress: options.pandoraMarketAddress || loaded.state.pandoraMarketAddress || (daemonMeta && daemonMeta.pandoraMarketAddress) || null,
      polymarketMarketId: options.polymarketMarketId || loaded.state.polymarketMarketId || (daemonMeta && daemonMeta.polymarketMarketId) || null,
      polymarketSlug: options.polymarketSlug || loaded.state.polymarketSlug || (daemonMeta && daemonMeta.polymarketSlug) || null,
    };
  }

  const selectedDaemonMeta = resolution.status && resolution.status.metadata && typeof resolution.status.metadata === 'object'
    ? resolution.status.metadata
    : null;
  const stateFile =
    (fileExists(loaded.filePath) && loaded.filePath)
    || (selectedDaemonMeta && selectedDaemonMeta.stateFile)
    || loaded.filePath
    || null;
  const runtime = buildMirrorRuntimeTelemetry({
    state: loaded.state,
    stateFile,
    daemonStatus: resolution.status,
  });

  const strategyHash =
    loaded.state.strategyHash
    || options.strategyHash
    || (runtime.daemon && runtime.daemon.strategyHash)
    || null;
  const logFileFromDaemon =
    (runtime.daemon && runtime.daemon.logFile)
    || (selectedDaemonMeta && selectedDaemonMeta.logFile)
    || null;
  const inferredLogFile = !logFileFromDaemon ? defaultMirrorLogFile(strategyHash) : null;
  const logFile = logFileFromDaemon || inferredLogFile || null;
  const diagnostics = Array.isArray(resolution.diagnostics) ? [...resolution.diagnostics] : [];
  const log = {
    file: logFile,
    requestedLines: options.lines,
    exists: false,
    returnedLines: 0,
    totalLines: 0,
    truncated: false,
    readError: null,
    entries: [],
  };

  if (!logFile) {
    diagnostics.push('No mirror log file could be resolved from daemon metadata or the default strategy-hash log path.');
  } else if (!fileExists(logFile)) {
    diagnostics.push(`Mirror log file not found at ${logFile}.`);
  } else {
    try {
      const tailed = readTailEntries(logFile, options.lines);
      log.exists = true;
      log.returnedLines = tailed.entries.length;
      log.totalLines = tailed.totalLines;
      log.truncated = tailed.truncated;
      log.entries = tailed.entries;
    } catch (err) {
      log.readError = err && err.message ? err.message : String(err);
      diagnostics.push(`Failed to read mirror log file: ${log.readError}`);
    }
  }

  emitSuccess(
    context.outputMode,
    'mirror.logs',
    {
      schemaVersion: MIRROR_LOGS_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      stateFile,
      strategyHash,
      selector: normalizeSelector(selector),
      resolution: {
        matchedBy:
          options.stateFile
            ? 'state-file'
            : options.strategyHash
              ? 'strategy-hash'
              : resolution.matchedBy || 'market-selector',
        stateResolved: fileExists(stateFile),
        daemonResolved: Boolean(runtime.daemon && runtime.daemon.found),
        selectedPidFile: runtime.daemon && runtime.daemon.pidFile ? runtime.daemon.pidFile : null,
        ambiguousPidFiles: Array.isArray(resolution.ambiguousPidFiles) ? resolution.ambiguousPidFiles : [],
        logFileSource: logFileFromDaemon ? 'daemon-metadata' : inferredLogFile ? 'strategy-hash-default' : null,
      },
      runtime: {
        health: runtime.health || null,
        daemon: runtime.daemon || null,
      },
      log,
      diagnostics,
    },
    renderMirrorLogsTable,
  );
};
