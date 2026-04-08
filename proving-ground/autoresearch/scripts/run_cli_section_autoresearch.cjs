#!/usr/bin/env node

const path = require('node:path');

const {
  runCliSectionAutoresearch,
} = require('../lib/cli_section_autoresearch.cjs');

function parseArgs(argv) {
  const options = {
    configPath: 'proving-ground/autoresearch/config/cli_section_research.cjs',
    section: null,
    iterationsPerSection: null,
    mode: null,
    allowDirty: false,
    skipModel: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--config') {
      options.configPath = String(argv[index + 1] || '').trim() || options.configPath;
      index += 1;
      continue;
    }
    if (token === '--section') {
      options.section = String(argv[index + 1] || '').trim() || null;
      index += 1;
      continue;
    }
    if (token === '--iterations-per-section') {
      options.iterationsPerSection = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--mode') {
      options.mode = String(argv[index + 1] || '').trim() || null;
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
    throw new Error(`Unknown CLI section autoresearch flag: ${token}`);
  }
  return options;
}

function summarizeReport(report) {
  return {
    runId: report.runId,
    mode: report.mode,
    goal: report.goal,
    coverage: {
      coveredCommands: report.coverage.coveredCommands,
      totalCommands: report.coverage.totalCommands,
      coverageRatio: report.coverage.coverageRatio,
    },
    sections: report.sections.map((section) => ({
      id: section.id,
      title: section.title,
      baseline: {
        quick: section.baseline.quick.summary,
        full: section.baseline.full.summary,
      },
      summary: section.summary,
    })),
    finalValidation: report.finalValidation ? report.finalValidation.summary : null,
    artifacts: report.artifacts ? {
      reportPath: path.relative(process.cwd(), report.artifacts.reportPath).split(path.sep).join('/'),
      handoffPath: path.relative(process.cwd(), report.artifacts.handoffPath).split(path.sep).join('/'),
    } : null,
  };
}

(async () => {
  const options = parseArgs(process.argv.slice(2));
  const report = await runCliSectionAutoresearch({
    cwd: path.resolve(__dirname, '..', '..', '..'),
    ...options,
  });
  process.stdout.write(`${JSON.stringify(summarizeReport(report), null, 2)}\n`);
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
