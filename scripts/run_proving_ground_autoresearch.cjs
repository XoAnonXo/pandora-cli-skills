#!/usr/bin/env node

const path = require('node:path');

const { runAutoresearchLoop } = require('../proving-ground/lib/autoresearch_loop.cjs');

function parseArgs(argv) {
  const options = {
    configPath: 'proving-ground/config/proving-ground.example.json',
    mode: null,
    familyPath: null,
    maxIterations: null,
    allowDirty: false,
    skipModel: false,
    mockResponsePath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--config') {
      options.configPath = String(argv[index + 1] || '').trim() || options.configPath;
      index += 1;
      continue;
    }
    if (token === '--mode') {
      options.mode = String(argv[index + 1] || '').trim() || null;
      index += 1;
      continue;
    }
    if (token === '--family') {
      options.familyPath = String(argv[index + 1] || '').trim() || null;
      index += 1;
      continue;
    }
    if (token === '--max-iterations') {
      options.maxIterations = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--allow-dirty') {
      options.allowDirty = true;
      continue;
    }
    if (token === '--skip-model') {
      options.skipModel = true;
      continue;
    }
    if (token === '--mock-response') {
      options.mockResponsePath = String(argv[index + 1] || '').trim() || null;
      index += 1;
      continue;
    }
    throw new Error(`Unknown proving-ground flag: ${token}`);
  }
  return options;
}

function buildSummary(report) {
  const iteration = report.iterations[0] || null;
  return {
    runId: report.runId,
    mode: report.mode,
    goal: report.goal,
    simulation: {
      familyId: report.simulation.familyId,
      caseCount: report.simulation.caseCount,
      externalTrades: report.simulation.totalExternalTradeCount,
      restarts: report.simulation.totalRestartCount,
      maxRecoveryMs: report.simulation.maxRecoveryMs,
    },
    baseline: {
      quick: report.baseline.quick.summary,
      full: report.baseline.full ? report.baseline.full.summary : null,
    },
    iteration: iteration
      ? {
          outcome: iteration.outcome,
          hypothesisId: iteration.proposal && iteration.proposal.hypothesisId,
          summary: iteration.proposal && iteration.proposal.summary,
          model: iteration.model,
          decision: iteration.decision,
        }
      : null,
    artifacts: report.artifacts
      ? {
          reportPath: path.relative(process.cwd(), report.artifacts.reportPath).split(path.sep).join('/'),
          handoffPath: path.relative(process.cwd(), report.artifacts.handoffPath).split(path.sep).join('/'),
        }
      : null,
  };
}

(async () => {
  const options = parseArgs(process.argv.slice(2));
  const report = await runAutoresearchLoop({
    cwd: path.resolve(__dirname, '..'),
    ...options,
  });
  process.stdout.write(`${JSON.stringify(buildSummary(report), null, 2)}\n`);
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
