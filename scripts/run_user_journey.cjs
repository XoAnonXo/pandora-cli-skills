#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_SCENARIOS,
  SCENARIO_SET,
  SUPPORTED_SCENARIOS,
  parseScenarioList,
  runUserJourneys,
} = require('./lib/user_journey_runner.cjs');

function printHelp() {
  process.stdout.write(`Pandora user journey runner

Usage:
  node scripts/run_user_journey.cjs [--scenario <list|all>] [--out <path>] [--keep-workdir]

Scenarios:
  ${Array.from(SCENARIO_SET).sort().join(', ')}

Defaults:
  --scenario all   expands to: ${SUPPORTED_SCENARIOS.join(', ')}
`);
}

function parseArgs(argv) {
  const options = {
    scenario: 'all',
    out: null,
    keepWorkdir: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--scenario') {
      options.scenario = String(argv[index + 1] || '').trim() || options.scenario;
      index += 1;
      continue;
    }
    if (token === '--out') {
      options.out = String(argv[index + 1] || '').trim() || null;
      index += 1;
      continue;
    }
    if (token === '--keep-workdir') {
      options.keepWorkdir = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown flag: ${token}`);
  }

  return options;
}

function buildStdoutSummary(report, outPath) {
  const scenarioSummaries = Object.fromEntries(
    Object.entries(report.reports || {}).map(([scenarioId, scenarioReport]) => [
      scenarioId,
      {
        ok: scenarioReport && scenarioReport.ok,
        userGoalStatus: scenarioReport && scenarioReport.userGoalStatus,
        frictionTitles:
          scenarioReport && Array.isArray(scenarioReport.frictionPoints)
            ? scenarioReport.frictionPoints.map((item) => item.title)
            : [],
      },
    ]),
  );
  return {
    ok: report.ok,
    generatedAt: report.generatedAt,
    scenariosRequested: report.scenariosRequested,
    summary: report.summary,
    scenarios: scenarioSummaries,
    reportPath: outPath || null,
  };
}

(async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  parseScenarioList(options.scenario);
  const report = await runUserJourneys(options);
  const output = `${JSON.stringify(report, null, 2)}\n`;

  if (options.out) {
    const outPath = path.resolve(process.cwd(), options.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output);
    process.stdout.write(`${JSON.stringify(buildStdoutSummary(report, outPath), null, 2)}\n`);
    process.exit(report.ok ? 0 : 1);
  }

  process.stdout.write(output);
  process.exit(report.ok ? 0 : 1);
})().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exit(1);
});
