#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const {
  runBenchmarkSuite,
  writeSuiteLock,
  defaultSuiteLockPath,
  getSuiteExpectation,
  normalizeBenchmarkReportForFreshness,
} = require('../benchmarks/lib/runner.cjs');

function parseArgs(argv) {
  const options = { suite: 'core', out: null, writeLock: false, lockPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--suite') {
      options.suite = String(argv[index + 1] || '').trim() || options.suite;
      index += 1;
      continue;
    }
    if (token === '--out') {
      options.out = String(argv[index + 1] || '').trim() || null;
      index += 1;
      continue;
    }
    if (token === '--write-lock') {
      options.writeLock = true;
      continue;
    }
    if (token === '--lock-path') {
      options.lockPath = String(argv[index + 1] || '').trim() || null;
      index += 1;
      continue;
    }
    throw new Error(`Unknown benchmark flag: ${token}`);
  }
  return options;
}

(async () => {
  const options = parseArgs(process.argv.slice(2));
  const report = await runBenchmarkSuite({ suite: options.suite });
  const suiteExpectation = getSuiteExpectation(options.suite) || {};
  const minimumWeightedScore = Number.isFinite(Number(suiteExpectation.minimumWeightedScore))
    ? Number(suiteExpectation.minimumWeightedScore)
    : 95;
  if (options.writeLock) {
    const lockPath = writeSuiteLock(options.suite, report.contractLock, options.lockPath || defaultSuiteLockPath(options.suite));
    const relativeLockPath = path.relative(process.cwd(), lockPath).split(path.sep).join("/");
    report.writtenLockPath = relativeLockPath;
    report.expectedContractLockPath = relativeLockPath;
    report.contractLockMatchesExpected = true;
    report.contractLockMismatches = [];
    if (report.summary && typeof report.summary === 'object') {
      report.summary.overallPass =
        Number(report.summary.failedCount || 0) === 0
        && Number(report.summary.weightedScore || 0) >= minimumWeightedScore
        && Number(report.summary.latencyPassRate || 0) === 1
        && Number(report.summary.failedParityGroupCount || 0) === 0
        && report.contractLockMatchesExpected === true;
    }
  }
  if (options.out) {
    const outPath = path.resolve(process.cwd(), options.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(normalizeBenchmarkReportForFreshness(report), null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
