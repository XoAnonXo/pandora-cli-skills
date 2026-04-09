#!/usr/bin/env node

const path = require('node:path');

const {
  cleanupOvernightBatch,
  initOvernightEngine,
  inspectOvernightBatch,
  promoteOvernightBatch,
  resolveDeferredAudit,
  runOvernightBatch,
  validateOvernightAdapter,
} = require('../lib/overnight_engine.cjs');

function parseArgs(argv) {
  const options = {
    command: 'run',
    adapterPath: 'proving-ground/autoresearch/overnight.yaml',
    objectivePath: 'proving-ground/autoresearch/objective.yaml',
    batchDir: null,
    batchId: null,
    attemptLimit: null,
    maxParallelWorkers: null,
    maxTotalAttempts: null,
    syntheticAudit: null,
    proposalMode: null,
    surfaceId: null,
    attemptId: null,
    verdict: null,
    note: null,
    allowDirty: false,
    force: false,
  };
  const tokens = argv.slice();
  if (tokens.length > 0 && !tokens[0].startsWith('--')) {
    options.command = String(tokens.shift() || '').trim() || options.command;
  }
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--adapter') {
      options.adapterPath = String(tokens[index + 1] || '').trim() || options.adapterPath;
      index += 1;
      continue;
    }
    if (token === '--objective') {
      options.objectivePath = String(tokens[index + 1] || '').trim() || options.objectivePath;
      index += 1;
      continue;
    }
    if (token === '--batch-dir') {
      options.batchDir = String(tokens[index + 1] || '').trim() || null;
      index += 1;
      continue;
    }
    if (token === '--batch-id') {
      options.batchId = String(tokens[index + 1] || '').trim() || null;
      index += 1;
      continue;
    }
    if (token === '--attempt-limit') {
      options.attemptLimit = Number(tokens[index + 1] || 0) || null;
      index += 1;
      continue;
    }
    if (token === '--max-attempts') {
      options.maxTotalAttempts = Number(tokens[index + 1] || 0) || null;
      index += 1;
      continue;
    }
    if (token === '--max-parallel-workers') {
      options.maxParallelWorkers = Number(tokens[index + 1] || 0) || null;
      index += 1;
      continue;
    }
    if (token === '--synthetic-audit') {
      options.syntheticAudit = String(tokens[index + 1] || 'accept').trim().toLowerCase() || 'accept';
      index += 1;
      continue;
    }
    if (token === '--proposal-mode') {
      options.proposalMode = String(tokens[index + 1] || '').trim().toLowerCase() || null;
      index += 1;
      continue;
    }
    if (token === '--surface') {
      options.surfaceId = String(tokens[index + 1] || '').trim() || null;
      index += 1;
      continue;
    }
    if (token === '--attempt') {
      options.attemptId = String(tokens[index + 1] || '').trim() || null;
      index += 1;
      continue;
    }
    if (token === '--verdict') {
      options.verdict = String(tokens[index + 1] || '').trim().toLowerCase() || null;
      index += 1;
      continue;
    }
    if (token === '--note') {
      options.note = String(tokens[index + 1] || '').trim() || null;
      index += 1;
      continue;
    }
    if (token === '--allow-dirty') {
      options.allowDirty = true;
      continue;
    }
    if (token === '--force') {
      options.force = true;
      continue;
    }
    throw new Error(`Unknown overnight-engine flag: ${token}`);
  }
  return options;
}

async function dispatch(options) {
  const cwd = path.resolve(__dirname, '..', '..', '..');
  if (options.command === 'init') {
    return initOvernightEngine({
      cwd,
      adapterPath: options.adapterPath,
      objectivePath: options.objectivePath,
      force: options.force,
    });
  }
  if (options.command === 'validate-adapter') {
    return validateOvernightAdapter({
      cwd,
      adapterPath: options.adapterPath,
      objectivePath: options.objectivePath,
    });
  }
  if (options.command === 'run') {
    const syntheticAuditDecision = options.syntheticAudit
      ? {
          verdict: options.syntheticAudit === 'reject' ? 'reject' : 'accept',
          confidence: 1,
          blockers: options.syntheticAudit === 'reject' ? ['Synthetic audit gate rejected this attempt.'] : [],
          evidence: [`Synthetic audit gate ${options.syntheticAudit === 'reject' ? 'rejected' : 'accepted'} this attempt.`],
        }
      : null;
    return runOvernightBatch({
      cwd,
      adapterPath: options.adapterPath,
      objectivePath: options.objectivePath,
      batchId: options.batchId,
      attemptLimit: options.attemptLimit,
      maxParallelWorkers: options.maxParallelWorkers,
      maxTotalAttempts: options.maxTotalAttempts,
      proposalMode: options.proposalMode,
      syntheticAuditDecision,
      allowDirty: options.allowDirty,
    });
  }
  if (options.command === 'inspect') {
    if (!options.batchDir) {
      throw new Error('inspect requires --batch-dir');
    }
    return inspectOvernightBatch({
      batchDir: options.batchDir,
    });
  }
  if (options.command === 'promote') {
    if (!options.batchDir) {
      throw new Error('promote requires --batch-dir');
    }
    return promoteOvernightBatch({
      batchDir: options.batchDir,
    });
  }
  if (options.command === 'resolve-audit') {
    if (!options.batchDir) {
      throw new Error('resolve-audit requires --batch-dir');
    }
    return resolveDeferredAudit({
      batchDir: options.batchDir,
      surfaceId: options.surfaceId,
      attemptId: options.attemptId,
      verdict: options.verdict,
      note: options.note,
    });
  }
  if (options.command === 'cleanup') {
    if (!options.batchDir) {
      throw new Error('cleanup requires --batch-dir');
    }
    return cleanupOvernightBatch({
      batchDir: options.batchDir,
    });
  }
  throw new Error(`Unknown overnight-engine subcommand: ${options.command}`);
}

(async () => {
  const options = parseArgs(process.argv.slice(2));
  const payload = await dispatch(options);
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
