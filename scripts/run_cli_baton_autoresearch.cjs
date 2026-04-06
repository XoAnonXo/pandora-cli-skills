#!/usr/bin/env node

const path = require('node:path');

const {
  archiveCliBatonLane,
  cleanupCliBatonBatch,
  inspectCliBatonLatestHandoff,
  inspectCliBatonBatch,
  inspectCliBatonLane,
  pauseCliBatonBatch,
  promoteCliBatonBatch,
  requeueCliBatonLane,
  resumeCliBatonBatch,
  runCliBatonBatch,
  runCliBatonValidation,
  runCliBatonWorker,
} = require('../proving-ground/lib/cli_baton_autoresearch.cjs');

function parseArgs(argv) {
  const options = {
    command: 'start',
    configPath: 'proving-ground/config/cli_section_research.cjs',
    batchDir: null,
    batchId: null,
    laneId: null,
    section: null,
    attemptsPerLane: null,
    allowDirty: false,
    syntheticModel: false,
    syntheticCouncil: false,
    attemptIndex: null,
    attemptId: null,
    branchName: null,
    reason: null,
    removeBranches: false,
    removeBranch: false,
  };

  const tokens = argv.slice();
  if (tokens.length > 0 && !tokens[0].startsWith('--')) {
    options.command = String(tokens.shift() || '').trim() || options.command;
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--config') {
      options.configPath = String(tokens[index + 1] || '').trim() || options.configPath;
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
    if (token === '--lane') {
      options.laneId = String(tokens[index + 1] || '').trim() || null;
      index += 1;
      continue;
    }
    if (token === '--section') {
      options.section = String(tokens[index + 1] || '').trim() || null;
      index += 1;
      continue;
    }
    if (token === '--attempts-per-lane') {
      options.attemptsPerLane = Number(tokens[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--attempt-index') {
      options.attemptIndex = Number(tokens[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--attempt-id') {
      options.attemptId = String(tokens[index + 1] || '').trim() || null;
      index += 1;
      continue;
    }
    if (token === '--branch-name') {
      options.branchName = String(tokens[index + 1] || '').trim() || null;
      index += 1;
      continue;
    }
    if (token === '--reason') {
      options.reason = String(tokens[index + 1] || '').trim() || null;
      index += 1;
      continue;
    }
    if (token === '--allow-dirty') {
      options.allowDirty = true;
      continue;
    }
    if (token === '--synthetic-model') {
      options.syntheticModel = true;
      continue;
    }
    if (token === '--synthetic-council') {
      options.syntheticCouncil = true;
      continue;
    }
    if (token === '--remove-branches') {
      options.removeBranches = true;
      continue;
    }
    if (token === '--remove-branch') {
      options.removeBranch = true;
      continue;
    }
    throw new Error(`Unknown CLI baton flag: ${token}`);
  }
  return options;
}

async function dispatch(options) {
  const cwd = path.resolve(__dirname, '..');
  if (options.command === 'start') {
    return runCliBatonBatch({
      cwd,
      configPath: options.configPath,
      batchId: options.batchId,
      section: options.section,
      attemptsPerLane: options.attemptsPerLane,
      allowDirty: options.allowDirty,
      syntheticModel: options.syntheticModel,
      syntheticCouncil: options.syntheticCouncil,
    });
  }
  if (options.command === 'worker') {
    if (!options.batchDir || !options.laneId || !options.attemptIndex) {
      throw new Error('worker requires --batch-dir, --lane, and --attempt-index');
    }
    return runCliBatonWorker({
      cwd: process.cwd(),
      batchDir: options.batchDir,
      laneId: options.laneId,
      attemptIndex: options.attemptIndex,
      attemptId: options.attemptId,
      branchName: options.branchName,
      syntheticModel: options.syntheticModel,
      syntheticCouncil: options.syntheticCouncil,
    });
  }
  if (options.command === 'inspect-batch') {
    if (!options.batchDir) {
      throw new Error('inspect-batch requires --batch-dir');
    }
    return inspectCliBatonBatch({
      batchDir: options.batchDir,
    });
  }
  if (options.command === 'inspect-lane') {
    if (!options.batchDir || !options.laneId) {
      throw new Error('inspect-lane requires --batch-dir and --lane');
    }
    return inspectCliBatonLane({
      batchDir: options.batchDir,
      laneId: options.laneId,
    });
  }
  if (options.command === 'inspect-handoff') {
    if (!options.batchDir || !options.laneId) {
      throw new Error('inspect-handoff requires --batch-dir and --lane');
    }
    return inspectCliBatonLatestHandoff({
      batchDir: options.batchDir,
      laneId: options.laneId,
    });
  }
  if (options.command === 'pause') {
    if (!options.batchDir) {
      throw new Error('pause requires --batch-dir');
    }
    return pauseCliBatonBatch({
      batchDir: options.batchDir,
      reason: options.reason,
    });
  }
  if (options.command === 'resume') {
    if (!options.batchDir) {
      throw new Error('resume requires --batch-dir');
    }
    return resumeCliBatonBatch({
      batchDir: options.batchDir,
    });
  }
  if (options.command === 'requeue') {
    if (!options.batchDir || !options.laneId) {
      throw new Error('requeue requires --batch-dir and --lane');
    }
    return requeueCliBatonLane({
      batchDir: options.batchDir,
      laneId: options.laneId,
    });
  }
  if (options.command === 'archive-lane') {
    if (!options.batchDir || !options.laneId) {
      throw new Error('archive-lane requires --batch-dir and --lane');
    }
    return archiveCliBatonLane({
      batchDir: options.batchDir,
      laneId: options.laneId,
      removeBranch: options.removeBranch,
    });
  }
  if (options.command === 'promote') {
    if (!options.batchDir) {
      throw new Error('promote requires --batch-dir');
    }
    return promoteCliBatonBatch({
      batchDir: options.batchDir,
    });
  }
  if (options.command === 'cleanup') {
    if (!options.batchDir) {
      throw new Error('cleanup requires --batch-dir');
    }
    return cleanupCliBatonBatch({
      batchDir: options.batchDir,
      removeBranches: options.removeBranches,
    });
  }
  if (options.command === 'validate') {
    return runCliBatonValidation({
      cwd,
      configPath: options.configPath,
      batchId: options.batchId,
      allowDirty: options.allowDirty,
    });
  }
  throw new Error(`Unknown CLI baton subcommand: ${options.command}`);
}

(async () => {
  const options = parseArgs(process.argv.slice(2));
  const payload = await dispatch(options);
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
