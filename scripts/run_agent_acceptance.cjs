#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  ACCEPTANCE_MODES,
  DEFAULT_JOURNEYS,
  DEFAULT_MODE,
  DEFAULT_SURFACES,
  FAST_SKILL_SCENARIO_IDS,
  runAgentAcceptance,
} = require('./lib/agent_acceptance_runner.cjs');

function printHelp() {
  process.stdout.write(`Pandora agent acceptance runner

Usage:
  node scripts/run_agent_acceptance.cjs [--out <path>] [--mode fast|full] [--strict] [--keep-workdir]
                                        [--surface <list>] [--scenario <list|all>]
                                        [--skill-executor <shell command>] [--skill-timeout-ms <ms>]
                                        [--scenario-ids <id1,id2,...>] [--include-compatibility]

Defaults:
  --mode ${DEFAULT_MODE}
  --surface ${DEFAULT_SURFACES.join(',')}
  --scenario ${DEFAULT_JOURNEYS}

Notes:
  - Runs the MCP surface sweep, the full user-journey suite, and skill-runtime in one report.
  - fast mode trims only the expensive skill-runtime slice to: ${FAST_SKILL_SCENARIO_IDS.join(', ')}
  - full mode keeps the full skill-runtime catalog.
  - Use --scenario-ids to override only the skill-runtime scenario subset while keeping the full MCP and journey coverage.
`);
}

function parseArgs(argv) {
  const options = {
    out: null,
    mode: DEFAULT_MODE,
    strict: false,
    keepWorkdir: false,
    surface: DEFAULT_SURFACES.join(','),
    scenario: DEFAULT_JOURNEYS,
    includeCompatibilityAliases: false,
    skillExecutor: null,
    skillTimeoutMs: null,
    skillScenarioIds: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--out') {
      options.out = String(argv[index + 1] || '').trim() || null;
      index += 1;
      continue;
    }
    if (token === '--mode') {
      const value = String(argv[index + 1] || '').trim() || DEFAULT_MODE;
      if (!ACCEPTANCE_MODES.includes(value)) {
        throw new Error(`Invalid --mode value: ${value}`);
      }
      options.mode = value;
      index += 1;
      continue;
    }
    if (token === '--surface') {
      options.surface = String(argv[index + 1] || '').trim() || options.surface;
      index += 1;
      continue;
    }
    if (token === '--scenario') {
      options.scenario = String(argv[index + 1] || '').trim() || options.scenario;
      index += 1;
      continue;
    }
    if (token === '--skill-executor') {
      options.skillExecutor = String(argv[index + 1] || '').trim() || null;
      index += 1;
      continue;
    }
    if (token === '--skill-timeout-ms') {
      const raw = String(argv[index + 1] || '').trim();
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --skill-timeout-ms value: ${raw || '(empty)'}`);
      }
      options.skillTimeoutMs = parsed;
      index += 1;
      continue;
    }
    if (token === '--scenario-ids') {
      const ids = String(argv[index + 1] || '')
        .split(',')
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
      options.skillScenarioIds = ids.length ? ids : null;
      index += 1;
      continue;
    }
    if (token === '--strict') {
      options.strict = true;
      continue;
    }
    if (token === '--keep-workdir') {
      options.keepWorkdir = true;
      continue;
    }
    if (token === '--include-compatibility') {
      options.includeCompatibilityAliases = true;
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
  return {
    ok: report.ok,
    generatedAt: report.generatedAt,
    packageVersion: report.packageVersion,
    mode: report.mode,
    inventory: {
      actionCount: report.inventory && report.inventory.actionCount,
      mcpActionCount: report.inventory && report.inventory.mcpActionCount,
      cliOnlyActionCount: report.inventory && report.inventory.cliOnlyActionCount,
      skillScenarioCount: report.inventory && report.inventory.skillScenarioCatalog && report.inventory.skillScenarioCatalog.totalCount,
      supportedJourneyCount: report.inventory && report.inventory.supportedJourneyCount,
    },
    summary: report.summary,
    failureSummary: Array.isArray(report.failureSummary) ? report.failureSummary.slice(0, 25) : [],
    reportPath: outPath || null,
  };
}

(async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const report = await runAgentAcceptance(options);
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
