#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const {
  runBenchmarkSuite,
  normalizeBenchmarkReportForFreshness,
  loadScenarioSuite,
  getSuiteExpectation,
} = require('../benchmarks/lib/runner.cjs');

function parseArgs(argv) {
  const options = { suite: 'core', minScore: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--suite') {
      options.suite = String(argv[index + 1] || '').trim() || options.suite;
      index += 1;
      continue;
    }
    if (token === '--min-score') {
      options.minScore = Number(argv[index + 1] || options.minScore);
      index += 1;
      continue;
    }
    throw new Error(`Unknown benchmark flag: ${token}`);
  }
  return options;
}

(async () => {
  const options = parseArgs(process.argv.slice(2));
  const suiteExpectation = getSuiteExpectation(options.suite) || {};
  const minimumScore = Number.isFinite(Number(options.minScore))
    ? Number(options.minScore)
    : (
      Number.isFinite(Number(suiteExpectation.minimumWeightedScore))
        ? Number(suiteExpectation.minimumWeightedScore)
        : 95
    );
  const report = await runBenchmarkSuite({ suite: options.suite });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const expectedReportPath = path.resolve(__dirname, '..', 'benchmarks', 'latest', `${options.suite}-report.json`);
  if (report.summary.failedCount > 0) {
    process.exit(1);
  }
  const suiteScenarios = loadScenarioSuite(options.suite);
  const expectedScenarioCount = Array.isArray(suiteScenarios) ? suiteScenarios.length : 0;
  if (report.summary.scenarioCount !== expectedScenarioCount) {
    console.error(`Benchmark scenario count mismatch for suite ${options.suite}: expected ${expectedScenarioCount}, got ${report.summary.scenarioCount}`);
    process.exit(1);
  }
  if (
    suiteExpectation
    && Number.isFinite(Number(suiteExpectation.expectedScenarioCount))
    && report.summary.scenarioCount !== Number(suiteExpectation.expectedScenarioCount)
  ) {
    console.error(
      `Benchmark suite ${options.suite} no longer matches the documented scenario count ${suiteExpectation.expectedScenarioCount}.`,
    );
    process.exit(1);
  }
  if (report.summary.weightedScore < minimumScore) {
    process.exit(1);
  }
  if (!report.contractLockMatchesExpected) {
    process.exit(1);
  }
  if (Array.isArray(report.parity && report.parity.failedGroups) && report.parity.failedGroups.length > 0) {
    process.exit(1);
  }
  if (!fs.existsSync(expectedReportPath)) {
    console.error(`Missing committed benchmark report: ${expectedReportPath}`);
    process.exit(1);
  }
  const committedReport = JSON.parse(fs.readFileSync(expectedReportPath, 'utf8'));
  const actualFreshnessHash = JSON.stringify(normalizeBenchmarkReportForFreshness(report));
  const committedFreshnessHash = JSON.stringify(normalizeBenchmarkReportForFreshness(committedReport));
  if (actualFreshnessHash !== committedFreshnessHash) {
    console.error(`Committed benchmark report is stale: ${path.relative(process.cwd(), expectedReportPath)}`);
    process.exit(1);
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
