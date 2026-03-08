#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const {
  runBenchmarkSuite,
  normalizeBenchmarkReportForFreshness,
  loadScenarioSuite,
  getSuiteExpectation,
  loadSuiteLock,
  defaultSuiteLockPath,
} = require('../benchmarks/lib/runner.cjs');
const { buildPublicationArtifacts } = require('./build_benchmark_publication_bundle.cjs');

const ROOT_DIR = path.resolve(__dirname, '..');

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

function normalizeRepoRelativePath(filePath) {
  return path.relative(ROOT_DIR, path.resolve(filePath)).split(path.sep).join('/');
}

function stableJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableJsonValue(entry));
  }
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
      sorted[key] = stableJsonValue(value[key]);
    }
    return sorted;
  }
  return value;
}

function stableJsonString(value) {
  return JSON.stringify(stableJsonValue(value));
}

function computeExpectedBenchmarkPaths(suite) {
  const reportPath = path.resolve(ROOT_DIR, 'benchmarks', 'latest', `${suite}-report.json`);
  const bundlePath = path.resolve(ROOT_DIR, 'benchmarks', 'latest', `${suite}-bundle.json`);
  const historyPath = path.resolve(ROOT_DIR, 'benchmarks', 'latest', `${suite}-history.json`);
  const docsHistoryPath = path.resolve(ROOT_DIR, 'docs', 'benchmarks', 'history.json');
  const lockPath = defaultSuiteLockPath(suite);
  return {
    reportPath,
    bundlePath,
    historyPath,
    docsHistoryPath,
    lockPath,
    reportRelativePath: normalizeRepoRelativePath(reportPath),
    bundleRelativePath: normalizeRepoRelativePath(bundlePath),
    historyRelativePath: normalizeRepoRelativePath(historyPath),
    docsHistoryRelativePath: normalizeRepoRelativePath(docsHistoryPath),
    lockRelativePath: normalizeRepoRelativePath(lockPath),
  };
}

function computeOverallPass(summary, report) {
  return Boolean(
    summary
    && summary.failedCount === 0
    && summary.latencyPassRate === 1
    && Number(summary.failedParityGroupCount || 0) === 0
    && report
    && report.contractLockMatchesExpected === true
  );
}

function validateFreshBenchmarkReport(report, context) {
  const failures = [];
  const summary = report && report.summary ? report.summary : {};
  const suiteExpectation = context && context.suiteExpectation ? context.suiteExpectation : {};
  const expectedScenarioCount = context && Number.isInteger(context.expectedScenarioCount)
    ? context.expectedScenarioCount
    : 0;
  const minimumScore = context && Number.isFinite(Number(context.minimumScore))
    ? Number(context.minimumScore)
    : 0;

  if (summary.failedCount > 0) {
    failures.push(
      `Benchmark suite ${context.suite} has failing scenarios (${summary.failedCount}/${summary.scenarioCount || expectedScenarioCount}).`,
    );
  }
  if (summary.scenarioCount !== expectedScenarioCount) {
    failures.push(
      `Benchmark scenario count mismatch for suite ${context.suite}: expected ${expectedScenarioCount}, got ${summary.scenarioCount}.`,
    );
  }
  if (
    suiteExpectation
    && Number.isFinite(Number(suiteExpectation.expectedScenarioCount))
    && summary.scenarioCount !== Number(suiteExpectation.expectedScenarioCount)
  ) {
    failures.push(
      `Benchmark suite ${context.suite} no longer matches documented scenario count ${suiteExpectation.expectedScenarioCount}.`,
    );
  }
  if (Number(summary.weightedScore) < minimumScore) {
    failures.push(
      `Benchmark weighted score ${summary.weightedScore} is below required minimum ${minimumScore}.`,
    );
  }
  if (report.contractLockMatchesExpected !== true) {
    const mismatchDetails = Array.isArray(report.contractLockMismatches) && report.contractLockMismatches.length
      ? ` Mismatches: ${report.contractLockMismatches.join('; ')}.`
      : '';
    failures.push(
      `Benchmark contract lock does not match ${context.lockRelativePath}.${mismatchDetails}`,
    );
  }
  if (Array.isArray(report.parity && report.parity.failedGroups) && report.parity.failedGroups.length > 0) {
    failures.push(
      `Benchmark parity groups failed: ${report.parity.failedGroups.join(', ')}.`,
    );
  }

  return failures;
}

function validateCommittedBenchmarkArtifacts(committedReport, lockDocument, context) {
  const failures = [];
  const suiteScenarios = Array.isArray(context && context.suiteScenarios) ? context.suiteScenarios : [];
  const expectedScenarioIds = suiteScenarios.map((scenario) => scenario.id);
  const committedScenarioIds = Array.isArray(committedReport && committedReport.scenarios)
    ? committedReport.scenarios.map((scenario) => scenario && scenario.id).filter(Boolean)
    : [];
  const committedSummary = committedReport && committedReport.summary ? committedReport.summary : {};
  const committedParity = committedReport && committedReport.parity ? committedReport.parity : {};
  const lockPayload = lockDocument && lockDocument.contractLock && typeof lockDocument.contractLock === 'object'
    ? lockDocument.contractLock
    : null;
  const publicationArtifacts = buildPublicationArtifacts({
    reportPath: context.reportPath,
    lockPath: context.lockPath,
    bundlePath: context.bundlePath,
    historyPath: context.historyPath,
    docsHistoryPath: context.docsHistoryPath,
  });

  if (!committedReport || typeof committedReport !== 'object') {
    return [`Committed benchmark report is invalid: ${context.reportRelativePath}.`];
  }
  if (!lockDocument || typeof lockDocument !== 'object') {
    return [`Committed benchmark lock is invalid: ${context.lockRelativePath}.`];
  }

  if (committedReport.schemaVersion !== '1.0.0') {
    failures.push(
      `Committed benchmark report schemaVersion must be 1.0.0 in ${context.reportRelativePath}.`,
    );
  }
  if (lockDocument.schemaVersion !== '1.0.0') {
    failures.push(
      `Committed benchmark lock schemaVersion must be 1.0.0 in ${context.lockRelativePath}.`,
    );
  }
  if (committedReport.suite !== context.suite) {
    failures.push(
      `Committed benchmark report suite mismatch in ${context.reportRelativePath}: expected ${context.suite}, got ${committedReport.suite}.`,
    );
  }
  if (lockDocument.suite !== context.suite) {
    failures.push(
      `Committed benchmark lock suite mismatch in ${context.lockRelativePath}: expected ${context.suite}, got ${lockDocument.suite}.`,
    );
  }
  if (committedReport.expectedContractLockPath !== context.lockRelativePath) {
    failures.push(
      `Committed benchmark report expectedContractLockPath must be ${context.lockRelativePath} in ${context.reportRelativePath}.`,
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(committedReport, 'writtenLockPath')
    && committedReport.writtenLockPath
    && path.resolve(committedReport.writtenLockPath) !== context.lockPath
  ) {
    failures.push(
      `Committed benchmark report writtenLockPath must resolve to ${context.lockRelativePath} in ${context.reportRelativePath}.`,
    );
  }
  if (committedReport.contractLockMatchesExpected !== true) {
    failures.push(
      `Committed benchmark report must record contractLockMatchesExpected=true in ${context.reportRelativePath}.`,
    );
  }
  if (Array.isArray(committedReport.contractLockMismatches) && committedReport.contractLockMismatches.length > 0) {
    failures.push(
      `Committed benchmark report still records contract lock mismatches in ${context.reportRelativePath}: ${committedReport.contractLockMismatches.join('; ')}.`,
    );
  }
  if (!lockPayload) {
    failures.push(`Committed benchmark lock is missing contractLock in ${context.lockRelativePath}.`);
  } else if (stableJsonString(committedReport.contractLock || null) !== stableJsonString(lockPayload)) {
    failures.push(
      `Committed benchmark report contractLock does not match ${context.lockRelativePath}.`,
    );
  }
  if (committedSummary.scenarioCount !== expectedScenarioIds.length) {
    failures.push(
      `Committed benchmark report scenarioCount must be ${expectedScenarioIds.length} in ${context.reportRelativePath}.`,
    );
  }
  if (committedScenarioIds.length !== expectedScenarioIds.length) {
    failures.push(
      `Committed benchmark report scenarios array length must be ${expectedScenarioIds.length} in ${context.reportRelativePath}.`,
    );
  }
  if (stableJsonString(committedScenarioIds) !== stableJsonString(expectedScenarioIds)) {
    failures.push(
      `Committed benchmark report scenario ids/order drift from suite manifest in ${context.reportRelativePath}.`,
    );
  }
  const derivedPassedCount = Array.isArray(committedReport.scenarios)
    ? committedReport.scenarios.filter((scenario) => scenario && scenario.passed === true).length
    : 0;
  const derivedFailedCount = Array.isArray(committedReport.scenarios)
    ? committedReport.scenarios.length - derivedPassedCount
    : 0;
  if (committedSummary.passedCount !== derivedPassedCount) {
    failures.push(
      `Committed benchmark report passedCount is inconsistent with scenarios in ${context.reportRelativePath}.`,
    );
  }
  if (committedSummary.failedCount !== derivedFailedCount) {
    failures.push(
      `Committed benchmark report failedCount is inconsistent with scenarios in ${context.reportRelativePath}.`,
    );
  }
  if (committedSummary.parityGroupCount !== (Array.isArray(committedParity.groups) ? committedParity.groups.length : 0)) {
    failures.push(
      `Committed benchmark report parityGroupCount is inconsistent with parity.groups in ${context.reportRelativePath}.`,
    );
  }
  if (
    committedSummary.failedParityGroupCount
    !== (Array.isArray(committedParity.failedGroups) ? committedParity.failedGroups.length : 0)
  ) {
    failures.push(
      `Committed benchmark report failedParityGroupCount is inconsistent with parity.failedGroups in ${context.reportRelativePath}.`,
    );
  }
  const derivedOverallPass = computeOverallPass(committedSummary, committedReport);
  if (committedSummary.overallPass !== derivedOverallPass) {
    failures.push(
      `Committed benchmark report overallPass is inconsistent with summary/parity/lock status in ${context.reportRelativePath}.`,
    );
  }

  if (!fs.existsSync(context.bundlePath)) {
    failures.push(`Missing committed benchmark publication bundle: ${context.bundleRelativePath}.`);
  } else {
    const committedBundle = JSON.parse(fs.readFileSync(context.bundlePath, 'utf8'));
    if (stableJsonString(committedBundle) !== stableJsonString(publicationArtifacts.bundle)) {
      failures.push(`Committed benchmark publication bundle is stale: ${context.bundleRelativePath}.`);
    }
  }

  if (!fs.existsSync(context.historyPath)) {
    failures.push(`Missing committed benchmark publication history: ${context.historyRelativePath}.`);
  } else {
    const committedHistory = JSON.parse(fs.readFileSync(context.historyPath, 'utf8'));
    if (stableJsonString(committedHistory) !== stableJsonString(publicationArtifacts.history)) {
      failures.push(`Committed benchmark publication history is stale: ${context.historyRelativePath}.`);
    }
  }

  if (!fs.existsSync(context.docsHistoryPath)) {
    failures.push(`Missing committed benchmark docs history: ${context.docsHistoryRelativePath}.`);
  } else {
    const committedDocsHistory = JSON.parse(fs.readFileSync(context.docsHistoryPath, 'utf8'));
    if (stableJsonString(committedDocsHistory) !== stableJsonString(publicationArtifacts.history)) {
      failures.push(`Committed docs benchmark history is stale: ${context.docsHistoryRelativePath}.`);
    }
  }

  return failures;
}

function buildRefreshHints(failures, context) {
  const hints = [];
  const reportRefreshHint = `node scripts/run_agent_benchmarks.cjs --suite ${context.suite} --write-lock --out ${context.reportRelativePath}`;
  const requiresBenchmarkRefresh = failures.some((failure) => (
    failure.includes('Benchmark contract lock does not match')
    || failure.includes('Benchmark suite')
    || failure.includes('Benchmark weighted score')
    || failure.includes('Committed benchmark report')
    || failure.includes('Missing committed benchmark report')
  ));
  const requiresPublicationRefresh = failures.some((failure) => (
    failure.includes('Committed benchmark publication bundle')
    || failure.includes('Committed benchmark publication history')
    || failure.includes('Committed docs benchmark history')
    || failure.includes('Missing committed benchmark publication bundle')
    || failure.includes('Missing committed benchmark publication history')
    || failure.includes('Missing committed benchmark docs history')
  ));

  if (requiresBenchmarkRefresh) {
    hints.push(`Refresh benchmark report/lock with: ${reportRefreshHint}`);
  }
  if (requiresPublicationRefresh) {
    hints.push('Refresh benchmark publication history with: npm run benchmark:history');
  }
  if (hints.length === 0) {
    hints.push(`Recompute benchmark artifacts with: ${reportRefreshHint}`);
  }
  return hints;
}

function formatFailureOutput(failures, context) {
  const refreshHints = buildRefreshHints(failures, context);
  return [
    'Benchmark trust artifact check failed:',
    ...failures.map((failure) => `- ${failure}`),
    ...refreshHints.map((hint) => `- ${hint}`),
  ].join('\n');
}

async function runChecks(options = {}) {
  const suite = options.suite || 'core';
  const suiteExpectation = getSuiteExpectation(suite) || {};
  const minimumScore = Number.isFinite(Number(options.minScore))
    ? Number(options.minScore)
    : (
      Number.isFinite(Number(suiteExpectation.minimumWeightedScore))
        ? Number(suiteExpectation.minimumWeightedScore)
        : 95
    );
  const paths = computeExpectedBenchmarkPaths(suite);
  const suiteScenarios = loadScenarioSuite(suite);
  const expectedScenarioCount = Array.isArray(suiteScenarios) ? suiteScenarios.length : 0;
  const report = await runBenchmarkSuite({ suite });

  const failures = validateFreshBenchmarkReport(report, {
    suite,
    suiteExpectation,
    minimumScore,
    expectedScenarioCount,
    lockRelativePath: paths.lockRelativePath,
  });

  if (!fs.existsSync(paths.reportPath)) {
    failures.push(`Missing committed benchmark report: ${paths.reportRelativePath}.`);
  } else {
    const committedReport = JSON.parse(fs.readFileSync(paths.reportPath, 'utf8'));
    const lockDocument = loadSuiteLock(suite);
    failures.push(...validateCommittedBenchmarkArtifacts(committedReport, lockDocument, {
      suite,
      suiteScenarios,
      reportPath: paths.reportPath,
      bundlePath: paths.bundlePath,
      historyPath: paths.historyPath,
      docsHistoryPath: paths.docsHistoryPath,
      reportRelativePath: paths.reportRelativePath,
      bundleRelativePath: paths.bundleRelativePath,
      historyRelativePath: paths.historyRelativePath,
      docsHistoryRelativePath: paths.docsHistoryRelativePath,
      lockRelativePath: paths.lockRelativePath,
      lockPath: paths.lockPath,
    }));

    const actualFreshnessHash = stableJsonString(normalizeBenchmarkReportForFreshness(report));
    const committedFreshnessHash = stableJsonString(normalizeBenchmarkReportForFreshness(committedReport));
    if (actualFreshnessHash !== committedFreshnessHash) {
      failures.push(`Committed benchmark report is stale: ${paths.reportRelativePath}.`);
    }
  }

  return {
    suite,
    minimumScore,
    report,
    failures,
    paths,
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await runChecks(options);
  process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  if (result.failures.length > 0) {
    console.error(formatFailureOutput(result.failures, {
      suite: result.suite,
      reportRelativePath: result.paths.reportRelativePath,
    }));
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = {
  ROOT_DIR,
  parseArgs,
  computeExpectedBenchmarkPaths,
  validateFreshBenchmarkReport,
  validateCommittedBenchmarkArtifacts,
  buildRefreshHints,
  formatFailureOutput,
  runChecks,
};
