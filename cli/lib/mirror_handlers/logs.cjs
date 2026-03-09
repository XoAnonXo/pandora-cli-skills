const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildMirrorRuntimeTelemetry } = require('../mirror_sync/state.cjs');
const { resolveMirrorSurfaceState } = require('../mirror_surface_service.cjs');
const { daemonStatus, findPidFilesByMarketAddress } = require('../mirror_daemon_service.cjs');
const { readMirrorLogFromLine, readMirrorLogTail } = require('../mirror_log_format.cjs');
const { createParseMirrorLogsFlags } = require('../parsers/mirror_remaining_flags.cjs');

const MIRROR_LOGS_SCHEMA_VERSION = '1.0.0';
const MIRROR_LOGS_USAGE =
  'pandora [--output table|json] mirror logs --state-file <path>|--strategy-hash <hash>|--pandora-market-address <address>|--market-address <address> [--polymarket-market-id <id>|--polymarket-slug <slug>] [--lines <n>] [--follow] [--poll-interval-ms <ms>] [--follow-timeout-ms <ms>]';

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function buildLogSummary(logFile, requestedLines, diagnostics) {
  const log = {
    file: logFile,
    requestedLines,
    exists: false,
    returnedLines: 0,
    totalLines: 0,
    truncated: false,
    readError: null,
    format: 'empty',
    structuredEntryCount: 0,
    textEntryCount: 0,
    entries: [],
  };

  if (!logFile) {
    diagnostics.push('No mirror log file could be resolved from daemon metadata or the default strategy-hash log path.');
    return log;
  }
  if (!fileExists(logFile)) {
    diagnostics.push(`Mirror log file not found at ${logFile}.`);
    return log;
  }

  try {
    const tailed = readMirrorLogTail(logFile, requestedLines);
    log.exists = true;
    log.returnedLines = tailed.entries.length;
    log.totalLines = tailed.totalLines;
    log.truncated = tailed.truncated;
    log.format = tailed.format;
    log.structuredEntryCount = tailed.structuredEntryCount;
    log.textEntryCount = tailed.textEntryCount;
    log.entries = tailed.entries;
  } catch (err) {
    log.readError = err && err.message ? err.message : String(err);
    diagnostics.push(`Failed to read mirror log file: ${log.readError}`);
  }

  return log;
}

function buildResponsePayload({
  options,
  stateFile,
  strategyHash,
  selector,
  resolution,
  runtime,
  log,
  diagnostics,
  logFileFromDaemon,
  inferredLogFile,
  follow,
}) {
  return {
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
    follow: follow || null,
  };
}

function renderMirrorLogEntryTable(entry) {
  console.log(`${entry.lineNumber}: ${entry.text}`);
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
  console.log(`format: ${log.format || 'empty'}`);
  console.log(`structuredEntries: ${log.structuredEntryCount || 0}`);
  console.log(`truncated: ${log.truncated ? 'yes' : 'no'}`);
  console.log(`daemonStatus: ${daemon.status || ''}`);
  if (data.follow && data.follow.active) {
    const timeoutText = data.follow.timeoutMs ? ` timeout=${data.follow.timeoutMs}ms` : '';
    console.log(`follow: yes poll=${data.follow.pollIntervalMs}ms${timeoutText}`);
  }
  if (Array.isArray(data.diagnostics) && data.diagnostics.length) {
    console.log(`diagnostics: ${data.diagnostics.join(' | ')}`);
  }
  if (Array.isArray(log.entries) && log.entries.length) {
    console.log('');
    for (const entry of log.entries) {
      renderMirrorLogEntryTable(entry);
    }
  }
}

function emitJsonLine(command, data) {
  console.log(
    JSON.stringify({
      ok: true,
      command,
      data: {
        schemaVersion: MIRROR_LOGS_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        ...data,
      },
    }),
  );
}

async function followMirrorLogFile({
  logFile,
  pollIntervalMs,
  followTimeoutMs,
  initialTotalLines,
  onEntries,
}) {
  let lastSeenLine = Number.isInteger(initialTotalLines) && initialTotalLines >= 0 ? initialTotalLines : 0;
  const startedAt = Date.now();

  while (true) {
    if (followTimeoutMs && Date.now() - startedAt >= followTimeoutMs) {
      return {
        reason: 'timeout',
        lastSeenLine,
      };
    }

    if (fileExists(logFile)) {
      try {
        const delta = readMirrorLogFromLine(logFile, lastSeenLine + 1);
        if (delta.entries.length) {
          await onEntries(delta.entries);
        }
        lastSeenLine = delta.totalLines;
      } catch (err) {
        return {
          reason: 'read-error',
          lastSeenLine,
          error: err && err.message ? err.message : String(err),
        };
      }
    }

    await sleep(pollIntervalMs);
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
      'Structured daemon logs are compact JSONL records; legacy plain-text lines are still surfaced with raw text for compatibility.',
      '--follow behaves like tail -f: it returns the requested tail first, then polls for appended lines until interrupted or --follow-timeout-ms elapses.',
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
  const log = buildLogSummary(logFile, options.lines, diagnostics);
  const follow = options.follow
    ? {
        active: true,
        pollIntervalMs: options.pollIntervalMs,
        timeoutMs: options.followTimeoutMs,
      }
    : null;
  const payload = buildResponsePayload({
    options,
    stateFile,
    strategyHash,
    selector,
    resolution,
    runtime,
    log,
    diagnostics,
    logFileFromDaemon,
    inferredLogFile,
    follow,
  });

  if (!options.follow) {
    emitSuccess(
      context.outputMode,
      'mirror.logs',
      payload,
      renderMirrorLogsTable,
    );
    return;
  }

  if (context.outputMode === 'json') {
    emitJsonLine('mirror.logs.follow', payload);
  } else {
    renderMirrorLogsTable(payload);
    console.log('');
    console.log('Following log file for new entries. Press Ctrl+C to stop.');
  }

  if (!logFile) {
    const completion = {
      strategyHash,
      logFile: null,
      reason: 'unresolved-log-file',
      lastSeenLine: log.totalLines,
    };
    if (context.outputMode === 'json') {
      emitJsonLine('mirror.logs.follow.complete', completion);
    } else {
      console.log('Follow stopped: no log file could be resolved.');
    }
    return;
  }

  const completion = await followMirrorLogFile({
    logFile,
    pollIntervalMs: options.pollIntervalMs,
    followTimeoutMs: options.followTimeoutMs,
    initialTotalLines: log.totalLines,
    onEntries: async (entries) => {
      for (const entry of entries) {
        if (context.outputMode === 'json') {
          emitJsonLine('mirror.logs.entry', {
            strategyHash,
            logFile,
            entry,
          });
        } else {
          renderMirrorLogEntryTable(entry);
        }
      }
    },
  });

  if (context.outputMode === 'json') {
    emitJsonLine('mirror.logs.follow.complete', {
      strategyHash,
      logFile,
      ...completion,
    });
  } else if (completion.reason === 'timeout') {
    console.log(`Follow stopped after ${options.followTimeoutMs}ms.`);
  } else if (completion.reason === 'read-error') {
    console.log(`Follow stopped after a log read error: ${completion.error}`);
  }
};
