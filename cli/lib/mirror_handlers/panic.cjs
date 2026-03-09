const fs = require('fs');
const path = require('path');

const MIRROR_PANIC_SCHEMA_VERSION = '1.0.0';

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

function renderMirrorPanicTable(data) {
  const risk = data.risk || {};
  const panic = risk.panic || {};
  const daemonStop = data.daemonStop || {};
  renderKeyValueRows('Mirror Panic', [
    ['action', data.action || ''],
    ['status', data.status || ''],
    ['selector.scope', data.selector && data.selector.scope ? data.selector.scope : ''],
    ['riskFile', risk.riskFile || ''],
    ['panic.active', panic.active ? 'yes' : 'no'],
    ['panic.reason', panic.reason || ''],
    ['daemonStop.status', daemonStop.status || ''],
    ['daemonStop.count', daemonStop.count === null || daemonStop.count === undefined ? '' : daemonStop.count],
    ['stopFiles.written', Array.isArray(data.stopFiles && data.stopFiles.written) ? data.stopFiles.written.length : 0],
    ['stopFiles.cleared', Array.isArray(data.stopFiles && data.stopFiles.cleared) ? data.stopFiles.cleared.length : 0],
    ['followUpActions', Array.isArray(data.followUpActions) ? data.followUpActions.length : 0],
  ]);
}

function normalizeStrategyHash(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{16}$/.test(normalized) ? normalized : null;
}

function parseMirrorPanicFlags(args, deps) {
  const { CliError, parseAddressFlag, requireFlagValue } = deps;
  const options = {
    pidFile: null,
    strategyHash: null,
    marketAddress: null,
    all: false,
    clear: false,
    reason: null,
    actor: null,
    riskFile: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--pid-file') {
      options.pidFile = requireFlagValue(args, i, '--pid-file');
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
    if (token === '--market-address' || token === '--pandora-market-address') {
      options.marketAddress = parseAddressFlag(requireFlagValue(args, i, token), token);
      i += 1;
      continue;
    }
    if (token === '--all') {
      options.all = true;
      continue;
    }
    if (token === '--clear') {
      options.clear = true;
      continue;
    }
    if (token === '--reason') {
      options.reason = requireFlagValue(args, i, '--reason');
      i += 1;
      continue;
    }
    if (token === '--actor') {
      options.actor = requireFlagValue(args, i, '--actor');
      i += 1;
      continue;
    }
    if (token === '--risk-file') {
      options.riskFile = requireFlagValue(args, i, '--risk-file');
      i += 1;
      continue;
    }
    throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror panic: ${token}`);
  }

  if (options.all && (options.pidFile || options.strategyHash || options.marketAddress)) {
    throw new CliError('INVALID_ARGS', '--all cannot be combined with --pid-file, --strategy-hash, or --market-address.');
  }
  if (!options.clear && (!options.reason || !String(options.reason).trim())) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'mirror panic requires --reason <text> unless --clear is supplied.');
  }
  if (options.clear && options.reason !== null) {
    throw new CliError('INVALID_ARGS', '--reason is not allowed with --clear.');
  }
  if (!options.clear && !options.pidFile && !options.strategyHash && !options.marketAddress && !options.all) {
    throw new CliError(
      'MISSING_REQUIRED_FLAG',
      'mirror panic requires --pid-file <path>, --strategy-hash <hash>, --market-address <address>, or --all.',
    );
  }

  return options;
}

function buildSelectorPayload(options) {
  return {
    scope: options.all
      ? 'all'
      : options.marketAddress
        ? 'market'
        : options.strategyHash
          ? 'strategy'
          : options.pidFile
            ? 'pid-file'
            : 'none',
    pidFile: options.pidFile || null,
    strategyHash: options.strategyHash || null,
    marketAddress: options.marketAddress || null,
    all: Boolean(options.all),
  };
}

function collectStopFilePaths(defaultMirrorKillSwitchFile) {
  const filePaths = new Set();
  if (typeof defaultMirrorKillSwitchFile === 'function') {
    filePaths.add(String(defaultMirrorKillSwitchFile()));
  }

  return Array.from(filePaths);
}

function writeStopFile(filePath) {
  const resolved = path.resolve(String(filePath || '').trim());
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${new Date().toISOString()} mirror panic\n`, { mode: 0o600 });
  try {
    fs.chmodSync(resolved, 0o600);
  } catch {
    // best-effort permission hardening
  }
  return resolved;
}

function clearStopFile(filePath) {
  const resolved = path.resolve(String(filePath || '').trim());
  if (!fs.existsSync(resolved)) {
    return {
      path: resolved,
      removed: false,
      reason: 'missing',
    };
  }
  fs.unlinkSync(resolved);
  return {
    path: resolved,
    removed: true,
    reason: null,
  };
}

function buildClearCommand(options, riskFile) {
  const parts = ['pandora', 'mirror', 'panic', '--clear'];
  if (riskFile) {
    parts.push('--risk-file', riskFile);
  }
  if (options.all) {
    parts.push('--all');
  } else if (options.marketAddress) {
    parts.push('--market-address', options.marketAddress);
  } else if (options.strategyHash) {
    parts.push('--strategy-hash', options.strategyHash);
  } else if (options.pidFile) {
    parts.push('--pid-file', options.pidFile);
  }
  if (options.actor) {
    parts.push('--actor', options.actor);
  }
  return parts.join(' ');
}

function buildFollowUpActions(options, params = {}) {
  const riskFile = params.riskFile || null;
  const action = params.action || 'engage';
  if (action === 'clear') {
    return [
      {
        code: 'VERIFY_RUNTIME_HEALTH',
        message: 'Verify mirror runtime health before resuming automation.',
        blocking: false,
        command:
          options.strategyHash
            ? `pandora mirror health --strategy-hash ${options.strategyHash}`
            : options.pidFile
              ? `pandora mirror health --pid-file ${options.pidFile}`
              : options.marketAddress
                ? `pandora mirror health --market-address ${options.marketAddress}`
                : null,
      },
    ];
  }

  return [
    {
      code: 'VERIFY_PANIC_ACTIVE',
      message: 'Confirm the risk panic is active and the targeted daemon/runtime is stopped or blocked.',
      blocking: false,
      command:
        options.strategyHash
          ? `pandora mirror health --strategy-hash ${options.strategyHash}`
          : options.pidFile
            ? `pandora mirror health --pid-file ${options.pidFile}`
            : options.marketAddress
              ? `pandora mirror health --market-address ${options.marketAddress}`
              : riskFile
                ? `pandora risk show --risk-file ${riskFile}`
                : 'pandora risk show',
    },
    {
      code: 'CLEAR_PANIC_WHEN_SAFE',
      message: 'Clear mirror panic and remove stop files only after the incident is reviewed.',
      blocking: true,
      command: buildClearCommand(options, riskFile),
    },
  ];
}

module.exports = async function handleMirrorPanic({ actionArgs, context, deps }) {
  const {
    CliError,
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    parseAddressFlag,
    requireFlagValue,
    setRiskPanic,
    clearRiskPanic,
    stopMirrorDaemon,
    defaultMirrorKillSwitchFile,
  } = deps;

  const usage =
    'pandora [--output table|json] mirror panic --pid-file <path>|--strategy-hash <hash>|--market-address <address>|--all [--risk-file <path>] [--reason <text>] [--actor <id>] [--clear]';

  if (includesHelpFlag(actionArgs)) {
    const notes = [
      'mirror panic is the mirror-focused emergency shell around the global risk panic state.',
      'Engage mode writes mirror stop files and attempts daemon stop for the selected mirror scope while also enabling the global risk panic lock.',
      'Clear mode removes the default mirror stop file and clears the global risk panic lock; restart daemons manually after incident review.',
    ];
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'mirror.panic.help', commandHelpPayload(usage, notes));
    } else {
      console.log(`Usage: ${usage}`);
      for (const note of notes) {
        console.log(note);
      }
    }
    return;
  }

  const options = parseMirrorPanicFlags(actionArgs, {
    CliError,
    parseAddressFlag,
    requireFlagValue,
  });
  const selector = buildSelectorPayload(options);

  if (options.clear) {
    const risk = clearRiskPanic({
      riskFile: options.riskFile,
      actor: options.actor,
    });

    const stopFilesCleared = [];
    const stopFileClearErrors = [];
    for (const stopFile of collectStopFilePaths(defaultMirrorKillSwitchFile)) {
      try {
        const result = clearStopFile(stopFile);
        if (result.removed) {
          stopFilesCleared.push(result.path);
        }
      } catch (err) {
        stopFileClearErrors.push({
          path: stopFile,
          code: err && err.code ? err.code : 'STOP_FILE_CLEAR_FAILED',
          message: err && err.message ? err.message : String(err),
        });
      }
    }

    const payload = {
      schemaVersion: MIRROR_PANIC_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      action: 'clear',
      status: stopFileClearErrors.length ? 'partial' : 'cleared',
      selector,
      risk,
      daemonStop: null,
      stopFiles: {
        written: [],
        cleared: stopFilesCleared,
        errors: stopFileClearErrors,
      },
      followUpActions: buildFollowUpActions(options, {
        action: 'clear',
        riskFile: risk.riskFile,
      }),
    };
    emitSuccess(context.outputMode, 'mirror.panic', payload, renderMirrorPanicTable);
    return;
  }

  const risk = setRiskPanic({
    riskFile: options.riskFile,
    reason: options.reason,
    actor: options.actor,
    touchStopFiles: false,
  });

  let daemonStop = null;
  let daemonStopError = null;
  try {
    if (options.all) {
      daemonStop = await stopMirrorDaemon({ all: true });
    } else if (options.marketAddress) {
      daemonStop = await stopMirrorDaemon({ marketAddress: options.marketAddress });
    } else if (options.strategyHash) {
      daemonStop = await stopMirrorDaemon({ strategyHash: options.strategyHash });
    } else if (options.pidFile) {
      daemonStop = await stopMirrorDaemon({ pidFile: options.pidFile });
    }
  } catch (err) {
    daemonStopError = {
      code: err && err.code ? err.code : 'MIRROR_PANIC_STOP_FAILED',
      message: err && err.message ? err.message : String(err),
      details: err && err.details ? err.details : null,
    };
  }

  const stopFilesWritten = [];
  const stopFileWriteErrors = [];
  for (const stopFile of collectStopFilePaths(defaultMirrorKillSwitchFile)) {
    try {
      stopFilesWritten.push(writeStopFile(stopFile));
    } catch (err) {
      stopFileWriteErrors.push({
        path: stopFile,
        code: err && err.code ? err.code : 'STOP_FILE_WRITE_FAILED',
        message: err && err.message ? err.message : String(err),
      });
    }
  }

  const payload = {
    schemaVersion: MIRROR_PANIC_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    action: 'engage',
    status: daemonStopError || stopFileWriteErrors.length ? 'partial' : 'engaged',
    selector,
    risk,
    daemonStop:
      daemonStopError
        ? {
            status: 'error',
            error: daemonStopError,
          }
        : daemonStop,
    stopFiles: {
      written: stopFilesWritten,
      cleared: [],
      errors: stopFileWriteErrors,
    },
    followUpActions: buildFollowUpActions(options, {
      action: 'engage',
      riskFile: risk.riskFile,
    }),
  };

  emitSuccess(context.outputMode, 'mirror.panic', payload, renderMirrorPanicTable);
};
