#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_SURFACES, SURFACE_SET, parseSurfaceList, runSurfaceE2e } = require('./lib/surface_e2e_runner.cjs');

function printHelp() {
  process.stdout.write(`Pandora surface E2E runner

Usage:
  node scripts/run_surface_e2e.cjs [--surface <list|all>] [--out <path>] [--strict]
                                   [--skill-executor <shell command>] [--include-compatibility]

Surfaces:
  ${Array.from(SURFACE_SET).sort().join(', ')}

Defaults:
  --surface all   expands to: ${DEFAULT_SURFACES.join(', ')}

Notes:
  - skill-bundle validates the generated Anthropic skill bundle plus the declared scenario fixtures.
  - skill-runtime requires --skill-executor and is meant for a real external agent adapter.
  - strict mode treats any structured MCP tool error as a failing E2E result.
`);
}

function parseArgs(argv) {
  const options = {
    surface: 'all',
    out: null,
    strict: false,
    includeCompatibilityAliases: false,
    skillExecutor: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--surface') {
      options.surface = String(argv[index + 1] || '').trim() || options.surface;
      index += 1;
      continue;
    }
    if (token === '--out') {
      options.out = String(argv[index + 1] || '').trim() || null;
      index += 1;
      continue;
    }
    if (token === '--skill-executor') {
      options.skillExecutor = String(argv[index + 1] || '').trim() || null;
      index += 1;
      continue;
    }
    if (token === '--strict') {
      options.strict = true;
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
    strict: report.strict,
    generatedAt: report.generatedAt,
    packageVersion: report.packageVersion,
    surfacesRequested: report.surfacesRequested,
    inventory: {
      actionCount: report.inventory && report.inventory.actionCount,
      mcpActionCount: report.inventory && report.inventory.mcpActionCount,
      countsByClass: report.inventory && report.inventory.countsByClass,
    },
    surfaces: Object.fromEntries(
      Object.entries(report.surfaces || {}).map(([name, surface]) => [
        name,
        {
          ok: surface.ok === true,
          toolCount: Number.isFinite(Number(surface.toolCount)) ? Number(surface.toolCount) : null,
          expectedToolCount: Number.isFinite(Number(surface.expectedToolCount)) ? Number(surface.expectedToolCount) : null,
          countsByStatus: surface.countsByStatus || null,
          failureCount: Array.isArray(surface.failures)
            ? surface.failures.length + (Array.isArray(surface.missing) ? surface.missing.length : 0)
            : 0,
        },
      ]),
    ),
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

  parseSurfaceList(options.surface);
  const report = await runSurfaceE2e(options);
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
