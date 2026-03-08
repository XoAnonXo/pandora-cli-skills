const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');
const { assertMcpWorkspacePath } = require('./shared/mcp_path_guard.cjs');

const LIFECYCLE_PHASES = [
  'DETECTED',
  'PLANNED',
  'DEPLOYED',
  'SEEDED',
  'SYNCING',
  'AWAITING_RESOLVE',
  'RESOLVED',
];

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunLifecycleCommand requires deps.${name}()`);
  }
  return deps[name];
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function sanitizeLifecycleId(raw) {
  return String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function resolveLifecycleDir() {
  const override = String(process.env.PANDORA_LIFECYCLE_DIR || '').trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(os.homedir(), '.pandora', 'lifecycles');
}

function lifecycleFilePath(lifecycleDir, id) {
  return path.join(lifecycleDir, `${id}.json`);
}

function readJsonFile(filePath, CliError) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new CliError('LIFECYCLE_NOT_FOUND', `Lifecycle not found for id: ${path.basename(filePath, '.json')}`, {
        id: path.basename(filePath, '.json'),
        filePath,
      });
    }
    throw err;
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new CliError('INVALID_JSON', `Lifecycle state file is not valid JSON: ${filePath}`);
  }
}

function writeJsonFileAtomic(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, filePath);

  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort hardening
  }
}

function createJsonFileExclusive(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let fd;
  try {
    fd = fs.openSync(filePath, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch (error) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close failure
      }
    }
    throw error;
  }
  fs.closeSync(fd);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort hardening
  }
}

function normalizeLifecycleState(state, filePath, CliError) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new CliError('INVALID_JSON', `Lifecycle state file must contain a JSON object: ${filePath}`, {
      filePath,
    });
  }
  const phase = typeof state.phase === 'string' ? state.phase.trim() : '';
  if (!LIFECYCLE_PHASES.includes(phase)) {
    throw new CliError('LIFECYCLE_INVALID_PHASE', `Lifecycle file has unsupported phase: ${phase || '<empty>'}`, {
      filePath,
      phase: phase || null,
      phases: LIFECYCLE_PHASES,
    });
  }
  return {
    ...state,
    phase,
    phases: Array.isArray(state.phases) && state.phases.every((entry) => LIFECYCLE_PHASES.includes(entry))
      ? state.phases
      : LIFECYCLE_PHASES,
  };
}

function renderLifecycleTable(payload) {
  // eslint-disable-next-line no-console
  console.log(`Lifecycle: ${payload.id}`);
  // eslint-disable-next-line no-console
  console.log(`Phase: ${payload.phase}`);
  // eslint-disable-next-line no-console
  console.log(`File: ${payload.filePath}`);
  // eslint-disable-next-line no-console
  console.log(`Updated: ${payload.updatedAt}`);
  if (payload.resolvedAt) {
    // eslint-disable-next-line no-console
    console.log(`Resolved: ${payload.resolvedAt}`);
  }
}

/**
 * Create runner for `pandora lifecycle` commands.
 * @param {object} deps
 * @returns {(args: string[], context: {outputMode: 'table'|'json'}) => Promise<void>}
 */
function createRunLifecycleCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseLifecycleFlags = requireDep(deps, 'parseLifecycleFlags');

  function assertMcpReadablePathAllowed(targetPath, flagName) {
    assertMcpWorkspacePath(targetPath, {
      flagName,
      errorFactory: (code, message, details) => new CliError(code, message, details),
    });
  }

  return async function runLifecycleCommand(args, context) {
    const action = args[0];
    const actionArgs = args.slice(1);

    if (!action || action === '--help' || action === '-h') {
      const usage =
        'pandora [--output table|json] lifecycle start --config <file> | status --id <id> | resolve --id <id> --confirm';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'lifecycle.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'start' && includesHelpFlag(actionArgs)) {
      const usage = 'pandora [--output table|json] lifecycle start --config <file>';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'lifecycle.start.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'status' && includesHelpFlag(actionArgs)) {
      const usage = 'pandora [--output table|json] lifecycle status --id <id>';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'lifecycle.status.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'resolve' && includesHelpFlag(actionArgs)) {
      const usage = 'pandora [--output table|json] lifecycle resolve --id <id> --confirm';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'lifecycle.resolve.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    const options = parseLifecycleFlags(args);
    const lifecycleDir = resolveLifecycleDir();

    if (options.action === 'start') {
      const configPath = path.resolve(process.cwd(), options.configPath);
      assertMcpReadablePathAllowed(configPath, '--config');
      let configRaw;
      try {
        configRaw = fs.readFileSync(configPath, 'utf8');
      } catch (err) {
        if (err && err.code === 'ENOENT') {
          throw new CliError('CONFIG_FILE_NOT_FOUND', `Lifecycle config file not found: ${configPath}`, {
            configPath,
          });
        }
        throw err;
      }

      let config;
      try {
        config = JSON.parse(configRaw);
      } catch {
        throw new CliError('INVALID_JSON', `Lifecycle config must be valid JSON: ${configPath}`, {
          configPath,
        });
      }

      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new CliError('INVALID_JSON', 'Lifecycle config must decode to a JSON object.');
      }

      const idSource =
        typeof config.id === 'string' && config.id.trim()
          ? config.id.trim()
          : `lc-${createHash('sha256').update(stableStringify(config)).digest('hex').slice(0, 16)}`;
      const id = sanitizeLifecycleId(idSource);
      if (!id) {
        throw new CliError('INVALID_FLAG_VALUE', 'Lifecycle id is empty after sanitization.');
      }

      const filePath = lifecycleFilePath(lifecycleDir, id);
      const nowIso = new Date().toISOString();
      const preResolvePhases = LIFECYCLE_PHASES.slice(0, LIFECYCLE_PHASES.indexOf('AWAITING_RESOLVE') + 1);
      const payload = {
        schemaVersion: '1.0.0',
        id,
        phase: 'AWAITING_RESOLVE',
        phases: LIFECYCLE_PHASES,
        history: preResolvePhases.map((phase) => ({ phase, at: nowIso })),
        createdAt: nowIso,
        updatedAt: nowIso,
        resolvedAt: null,
        lifecycleDir,
        filePath,
        configPath,
        configDigest: createHash('sha256').update(stableStringify(config)).digest('hex'),
        config,
        changed: true,
      };

      try {
        createJsonFileExclusive(filePath, payload);
      } catch (error) {
        if (error && error.code === 'EEXIST') {
          throw new CliError('LIFECYCLE_EXISTS', `Lifecycle already exists for id: ${id}`, {
            id,
            filePath,
          });
        }
        throw error;
      }
      emitSuccess(context.outputMode, 'lifecycle.start', payload, renderLifecycleTable);
      return;
    }

    if (options.action === 'status') {
      const id = sanitizeLifecycleId(options.id);
      if (!id) {
        throw new CliError('INVALID_FLAG_VALUE', 'Lifecycle id is empty after sanitization.');
      }
      const filePath = lifecycleFilePath(lifecycleDir, id);
      const state = normalizeLifecycleState(readJsonFile(filePath, CliError), filePath, CliError);
      emitSuccess(
        context.outputMode,
        'lifecycle.status',
        {
          ...state,
          lifecycleDir,
          filePath,
        },
        renderLifecycleTable,
      );
      return;
    }

    if (options.action === 'resolve') {
      const id = sanitizeLifecycleId(options.id);
      if (!id) {
        throw new CliError('INVALID_FLAG_VALUE', 'Lifecycle id is empty after sanitization.');
      }
      const filePath = lifecycleFilePath(lifecycleDir, id);
      const state = normalizeLifecycleState(readJsonFile(filePath, CliError), filePath, CliError);

      if (state.phase === 'RESOLVED') {
        emitSuccess(
          context.outputMode,
          'lifecycle.resolve',
          {
            ...state,
            lifecycleDir,
            filePath,
            changed: false,
          },
          renderLifecycleTable,
        );
        return;
      }
      if (state.phase !== 'AWAITING_RESOLVE') {
        throw new CliError(
          'LIFECYCLE_INVALID_PHASE',
          `Lifecycle ${id} cannot resolve from phase ${state.phase}. Expected AWAITING_RESOLVE.`,
          {
            id,
            filePath,
            phase: state.phase,
            expectedPhase: 'AWAITING_RESOLVE',
          },
        );
      }

      const nowIso = new Date().toISOString();
      const updated = {
        ...state,
        phase: 'RESOLVED',
        updatedAt: nowIso,
        resolvedAt: nowIso,
        history: [...(Array.isArray(state.history) ? state.history : []), { phase: 'RESOLVED', at: nowIso }],
        lifecycleDir,
        filePath,
        changed: true,
      };

      writeJsonFileAtomic(filePath, updated);
      emitSuccess(context.outputMode, 'lifecycle.resolve', updated, renderLifecycleTable);
      return;
    }

    throw new CliError('INVALID_ARGS', 'lifecycle requires subcommand: start|status|resolve.');
  };
}

module.exports = {
  LIFECYCLE_PHASES,
  createRunLifecycleCommand,
};
