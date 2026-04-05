'use strict';

const fs = require('fs');
const path = require('path');

const { createSetupWizardService } = require('./setup_wizard_service.cjs');

const SETUP_GOAL_NOTES = Object.freeze([
  'Goal options:',
  '  explore           Read-only exploration of chain and market data',
  '  deploy            Deploy contracts with a signing wallet',
  '  paper-mirror      Follow Polymarket odds without live credentials',
  '  live-mirror       Follow Polymarket odds with live market making',
  '  hosted-gateway    Connect to a hosted remote gateway',
  '  paper-hedge-daemon  Delta-neutral Polymarket hedging (paper mode)',
  '  live-hedge-daemon   Delta-neutral Polymarket hedging (live mode)',
]);
const { buildSetupPlan, normalizeGoal } = require('./setup_plan_service.cjs');

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createSetupCommandService requires deps.${name}()`);
  }
  return deps[name];
}

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function formatEnvValue(value) {
  const text = String(value ?? '');
  if (text === '') return '';
  if (/[\s#"'`\\]/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

function parseEnvText(text) {
  const entries = [];
  const env = {};
  const lines = String(text || '').split(/\r?\n/);

  for (const line of lines) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) {
      entries.push({ type: 'raw', line });
      continue;
    }

    const key = match[1];
    const value = match[2];
    env[key] = value.replace(/^['"]|['"]$/g, '');
    entries.push({ type: 'kv', key, value });
  }

  return { entries, env };
}

function serializeEnvEntries(entries) {
  return entries.map((entry) => {
    if (!entry) return '';
    if (entry.type === 'kv') {
      return `${entry.key}=${formatEnvValue(entry.value)}`;
    }
    return String(entry.line ?? '');
  }).join('\n');
}

function mergeEnvText(existingText, updates, removeKeys = []) {
  const { entries } = parseEnvText(existingText);
  const byKey = new Map();

  entries.forEach((entry, index) => {
    if (entry && entry.type === 'kv') {
      byKey.set(entry.key, index);
    }
  });

  for (const key of removeKeys) {
    const index = byKey.get(key);
    if (index !== undefined) {
      entries[index] = null;
      byKey.delete(key);
    }
  }

  for (const [key, value] of Object.entries(updates || {})) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    const index = byKey.get(key);
    if (index === undefined) {
      byKey.set(key, entries.length);
      entries.push({ type: 'kv', key, value: normalized });
      continue;
    }
    entries[index] = { type: 'kv', key, value: normalized };
  }

  return serializeEnvEntries(entries.filter(Boolean));
}

function readFileIfPresent(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, text: '', env: {} };
  }
  const text = fs.readFileSync(filePath, 'utf8');
  const parsed = parseEnvText(text);
  return { exists: true, text, env: parsed.env };
}

function seedProcessEnv(text) {
  const parsed = parseEnvText(text);
  for (const [key, value] of Object.entries(parsed.env)) {
    process.env[key] = value;
  }
}

function syncProcessEnv(previousEnv, nextEnv) {
  const prior = previousEnv && typeof previousEnv === 'object' ? previousEnv : {};
  const next = nextEnv && typeof nextEnv === 'object' ? nextEnv : {};

  for (const key of Object.keys(prior)) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(next)) {
    process.env[key] = value;
  }
}

function createSetupCommandService(deps = {}) {
  const CliError = requireDep(deps, 'CliError');
  const buildDoctorReport = requireDep(deps, 'buildDoctorReport');
  const loadEnvFile = requireDep(deps, 'loadEnvFile');
  const defaultEnvFile = typeof deps.defaultEnvFile === 'string' ? deps.defaultEnvFile : path.join(process.cwd(), '.env');
  const defaultEnvExample = typeof deps.defaultEnvExample === 'string' ? deps.defaultEnvExample : path.join(process.cwd(), '.env.example');
  const isTTY = typeof deps.isTTY === 'boolean'
    ? deps.isTTY
    : Boolean(process.stdin && process.stdin.isTTY && process.stdout && process.stdout.isTTY);
  const wizard = createSetupWizardService({
    CliError,
    isTTY,
    stdin: deps.stdin || process.stdin,
    stdout: deps.stdout || process.stdout,
  });

  function runtimeInfo(options = {}) {
    return {
      cwd: options.cwd || process.cwd(),
      envFile: options.envFile || defaultEnvFile,
      exampleFile: options.exampleFile || defaultEnvExample,
      interactive: Boolean(options.interactive),
      goal: normalizeGoal(options.goal),
      isTTY,
      nodeVersion: process.version,
      platform: process.platform,
    };
  }

  function ensureExampleFile(exampleFile) {
    if (!fs.existsSync(exampleFile)) {
      throw new CliError('EXAMPLE_FILE_NOT_FOUND', `Example env file not found: ${exampleFile}`);
    }
  }

  function copyExample(envFile, exampleFile, force) {
    ensureExampleFile(exampleFile);
    if (fs.existsSync(envFile) && !force) {
      return {
        status: 'reused',
        changed: false,
        envFile,
        exampleFile,
        force: false,
      };
    }

    fs.mkdirSync(path.dirname(envFile), { recursive: true });
    fs.copyFileSync(exampleFile, envFile);
    try {
      fs.chmodSync(envFile, 0o600);
    } catch {
      // best-effort hardening
    }
    return {
      status: 'written',
      changed: true,
      envFile,
      exampleFile,
      force: Boolean(force),
    };
  }

  function mergeEnvFile(envFile, updates, removeKeys = []) {
    const state = readFileIfPresent(envFile);
    const text = mergeEnvText(state.text, updates, removeKeys);
    fs.mkdirSync(path.dirname(envFile), { recursive: true });
    fs.writeFileSync(envFile, `${text}\n`, 'utf8');
    try {
      fs.chmodSync(envFile, 0o600);
    } catch {
      // best-effort hardening
    }
    return {
      status: state.exists ? 'merged' : 'written',
      changed: true,
      envFile,
      text,
      currentEnv: state.env,
    };
  }

  function seedEnvFile(envFile) {
    const state = readFileIfPresent(envFile);
    if (state.exists) {
      seedProcessEnv(state.text);
    }
    return state;
  }

  function buildReadiness(report, goal) {
    const readiness = {
      goal: normalizeGoal(goal),
      status: 'ready',
      missing: [],
      warnings: [],
      notes: [],
      recommendations: [],
    };

    if (report && report.env && report.env.required && Array.isArray(report.env.required.missing)) {
      readiness.missing.push(...report.env.required.missing);
    }
    if (report && report.env && report.env.validation && Array.isArray(report.env.validation.errors)) {
      readiness.warnings.push(...report.env.validation.errors);
    }
    if (report && report.polymarket && Array.isArray(report.polymarket.failures)) {
      readiness.warnings.push(...report.polymarket.failures);
    }
    if (report && report.summary && Array.isArray(report.summary.failures)) {
      readiness.warnings.push(...report.summary.failures);
    }
    if (report && report.journeyReadiness && Array.isArray(report.journeyReadiness.recommendations)) {
      readiness.recommendations.push(...report.journeyReadiness.recommendations);
    }
    if (report && report.journeyReadiness && Array.isArray(report.journeyReadiness.notes)) {
      readiness.notes.push(...report.journeyReadiness.notes);
    }

    if (report && report.summary && report.summary.ok === false) {
      readiness.status = 'blocked';
    } else if (readiness.missing.length) {
      readiness.status = 'blocked';
    } else if (readiness.warnings.length || readiness.notes.length) {
      readiness.status = 'ready-with-notes';
    }

    return readiness;
  }

  async function runSetup(options = {}) {
    const envFile = options.envFile || defaultEnvFile;
    const exampleFile = options.exampleFile || defaultEnvExample;
    const goal = normalizeGoal(options.goal);
    const interactive = Boolean(options.interactive);
    const planOnly = Boolean(options.plan);
    const runtime = runtimeInfo({ ...options, envFile, exampleFile, goal, interactive });
    const seedState = seedEnvFile(envFile);
    const force = Boolean(options.force);
    let envStep = null;
    let wizardResult = null;

    if (planOnly) {
      const doctor = await buildDoctorReport({
        envFile,
        useEnvFile: seedState.exists,
        env: seedState.env,
        checkUsdcCode: Boolean(options.checkUsdcCode),
        checkPolymarket: Boolean(options.checkPolymarket) || goal === 'live-mirror',
        rpcTimeoutMs: options.rpcTimeoutMs,
        goal,
      });
      return {
        mode: 'plan',
        goal,
        runtimeInfo: runtime,
        envStep: {
          status: seedState.exists ? 'existing-env' : 'no-env',
          changed: false,
          envFile,
          exampleFile,
          message: seedState.exists ? 'Loaded current env values for planning.' : 'No env file was written during planning.',
        },
        plan: buildSetupPlan({ goal, currentEnv: seedState.env }),
        doctor,
        readiness: buildReadiness(doctor, goal),
        guidedNextSteps: [
          'Review the returned setup plan and collect the relevant fields.',
          goal ? `Run \`pandora doctor --goal ${goal}\` as you fill values in.` : 'Choose a goal, then rerun setup with `--goal` for a scoped plan.',
        ],
      };
    }

    if (interactive) {
      if (!isTTY) {
        throw new CliError('INTERACTIVE_TTY_REQUIRED', 'Interactive setup requires an attached TTY. Use manual setup instead.');
      }

      if (force || !seedState.exists) {
        ensureExampleFile(exampleFile);
      }

      const wizardState = (force || !seedState.exists) ? readFileIfPresent(exampleFile) : seedState;

      wizardResult = await wizard.runSetupWizard({
        goal,
        currentEnv: wizardState.env,
        runtimeInfo: runtime,
        validateStage: async (validationContext = {}) => buildDoctorReport({
          envFile,
          useEnvFile: false,
          env: validationContext.env,
          checkUsdcCode: Boolean(options.checkUsdcCode),
          checkPolymarket: Boolean(options.checkPolymarket)
            || validationContext.stageId === 'polymarket'
            || validationContext.stageId === 'final-preview'
            || goal === 'live-mirror',
          rpcTimeoutMs: options.rpcTimeoutMs,
          goal: validationContext.goal || goal,
        }),
      });

      if (wizardResult && wizardResult.cancelled) {
        envStep = {
          status: 'cancelled',
          changed: false,
          envFile,
          exampleFile,
          force,
          message: 'Review was cancelled before write. No files were changed.',
        };
      } else {
        if (force || !seedState.exists) {
          envStep = copyExample(envFile, exampleFile, force);
        } else {
          envStep = {
            status: 'reused',
            changed: false,
            envFile,
            exampleFile,
            force,
            message: 'Reused the existing env file before merging guided updates.',
          };
        }

        if (wizardResult && wizardResult.updates && Object.keys(wizardResult.updates).length) {
          const removeKeys = wizardResult.updates.PANDORA_PRIVATE_KEY ? ['PRIVATE_KEY'] : [];
          envStep = mergeEnvFile(envFile, wizardResult.updates, removeKeys);
        }

        if (wizardResult && Array.isArray(wizardResult.resolutionSources) && wizardResult.resolutionSources.length) {
          envStep = mergeEnvFile(envFile, {
            PANDORA_RESOLUTION_SOURCES: wizardResult.resolutionSources.join(','),
          });
        }
      }
    } else {
      envStep = copyExample(envFile, exampleFile, Boolean(options.force));
    }

    const postWriteState = readFileIfPresent(envFile);
    const stagedPreviewEnv = wizardResult && wizardResult.cancelled
      ? {
        ...seedState.env,
        ...(wizardResult.updates || {}),
        ...(Array.isArray(wizardResult.resolutionSources) && wizardResult.resolutionSources.length
          ? { PANDORA_RESOLUTION_SOURCES: wizardResult.resolutionSources.join(',') }
          : {}),
      }
      : postWriteState.env;

    syncProcessEnv(seedState.env, stagedPreviewEnv);
    if (!(wizardResult && wizardResult.cancelled)) {
      loadEnvFile(envFile);
    }

    const doctor = await buildDoctorReport({
      envFile,
      useEnvFile: !(wizardResult && wizardResult.cancelled),
      env: wizardResult && wizardResult.cancelled ? stagedPreviewEnv : undefined,
      checkUsdcCode: Boolean(options.checkUsdcCode),
      checkPolymarket: Boolean(options.checkPolymarket) || goal === 'live-mirror',
      rpcTimeoutMs: options.rpcTimeoutMs,
      goal,
    });

    const readiness = buildReadiness(doctor, goal);
    const guidedNextSteps = Array.from(new Set([
      ...(wizardResult && Array.isArray(wizardResult.notes) ? wizardResult.notes : []),
      ...(readiness.notes || []),
      ...(readiness.recommendations || []),
      ...(doctor && doctor.summary && Array.isArray(doctor.summary.failures) ? doctor.summary.failures : []),
    ].filter(Boolean)));

    return {
      mode: interactive ? (wizardResult && wizardResult.mode ? wizardResult.mode : 'guided') : 'manual',
      goal,
      runtimeInfo: runtime,
      envStep,
      wizard: wizardResult,
      cancelled: Boolean(wizardResult && wizardResult.cancelled),
      plan: wizardResult && wizardResult.plan ? wizardResult.plan : null,
      doctor,
      readiness,
      guidedNextSteps,
    };
  }

  return {
    runSetup,
    runtimeInfo,
    copyExample,
    mergeEnvFile,
    seedEnvFile,
    buildReadiness,
  };
}

module.exports = {
  createSetupCommandService,
  parseEnvText,
  mergeEnvText,
  readFileIfPresent,
  seedProcessEnv,
  syncProcessEnv,
};
