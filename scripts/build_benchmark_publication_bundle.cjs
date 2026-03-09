#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
const PACKAGE_PATH = path.join(ROOT_DIR, 'package.json');
const DEFAULT_REPORT_PATH = path.join(ROOT_DIR, 'benchmarks', 'latest', 'core-report.json');
const DEFAULT_LOCK_PATH = path.join(ROOT_DIR, 'benchmarks', 'locks', 'core.lock.json');
const DEFAULT_BUNDLE_PATH = path.join(ROOT_DIR, 'benchmarks', 'latest', 'core-bundle.json');
const DEFAULT_HISTORY_PATH = path.join(ROOT_DIR, 'benchmarks', 'latest', 'core-history.json');
const DEFAULT_DOC_HISTORY_PATH = path.join(ROOT_DIR, 'docs', 'benchmarks', 'history.json');

function compareStableStrings(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function stableJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableJsonValue(entry));
  }
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort(compareStableStrings)) {
      sorted[key] = stableJsonValue(value[key]);
    }
    return sorted;
  }
  return value;
}

function stableJsonString(value) {
  return JSON.stringify(stableJsonValue(value));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function findExistingHistoryEntry(existingHistory, version, suite) {
  const entries = Array.isArray(existingHistory && existingHistory.entries)
    ? existingHistory.entries
    : [];
  return entries.find((entry) =>
    entry
    && entry.packageVersion === version
    && entry.suite === suite
    && typeof entry.generatedAt === 'string'
    && entry.generatedAt.trim()) || null;
}

function resolveGeneratedAt(options) {
  const reportGeneratedAt = options.report && typeof options.report.generatedAt === 'string'
    ? options.report.generatedAt.trim()
    : '';
  if (reportGeneratedAt) return reportGeneratedAt;

  const historyEntry = findExistingHistoryEntry(options.existingHistory, options.packageVersion, options.suite);
  if (historyEntry) return historyEntry.generatedAt;

  const bundleGeneratedAt = options.existingBundle && typeof options.existingBundle.generatedAt === 'string'
    ? options.existingBundle.generatedAt.trim()
    : '';
  const bundleVersion = options.existingBundle && options.existingBundle.package && options.existingBundle.package.version;
  const bundleSuite = options.existingBundle && options.existingBundle.suite;
  if (bundleGeneratedAt && bundleVersion === options.packageVersion && bundleSuite === options.suite) {
    return bundleGeneratedAt;
  }

  return new Date().toISOString();
}

function sha256File(filePath) {
  const absolutePath = path.resolve(filePath);
  if (absolutePath.endsWith('.json')) {
    return crypto
      .createHash('sha256')
      .update(stableJsonString(readJson(absolutePath)))
      .digest('hex');
  }
  return crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
}

function buildHistoryEntry(pkg, report, lockDocument, digests, generatedAt) {
  const summary = report && report.summary ? report.summary : {};
  const contractLock = report && report.contractLock ? report.contractLock : {};
  return {
    schemaVersion: '1.0.0',
    suite: report && report.suite ? report.suite : 'core',
    packageName: pkg.name,
    version: pkg.version,
    packageVersion: pkg.version,
    generatedAt,
    summary: {
      weightedScore: Number(summary.weightedScore || 0),
      overallPass: summary.overallPass === true,
      scenarioCount: Number(summary.scenarioCount || 0),
      passedCount: Number(summary.passedCount || 0),
      failedCount: Number(summary.failedCount || 0),
      failedParityGroupCount: Number(summary.failedParityGroupCount || 0),
    },
    weightedScore: Number(summary.weightedScore || 0),
    overallPass: summary.overallPass === true,
    scenarioCount: Number(summary.scenarioCount || 0),
    passedCount: Number(summary.passedCount || 0),
    failedCount: Number(summary.failedCount || 0),
    failedParityGroupCount: Number(summary.failedParityGroupCount || 0),
    contractLockMatchesExpected: report && report.contractLockMatchesExpected === true,
    parityFailedGroups: Array.isArray(report && report.parity && report.parity.failedGroups)
      ? report.parity.failedGroups.slice()
      : [],
    descriptorHash: contractLock && contractLock.registryDigest ? contractLock.registryDigest.descriptorHash || null : null,
    documentationContentHash: contractLock.documentationContentHash || null,
    reportSha256: digests.reportSha256,
    lockSha256: digests.lockSha256,
    lockSchemaVersion: lockDocument && lockDocument.schemaVersion ? lockDocument.schemaVersion : null,
  };
}

function normalizeHistory(existingHistory, nextEntry) {
  const currentEntries = Array.isArray(existingHistory && existingHistory.entries)
    ? existingHistory.entries.slice()
    : [];
  const retained = currentEntries.filter((entry) => !(
    entry
    && entry.packageVersion === nextEntry.packageVersion
    && entry.suite === nextEntry.suite
  ));
  retained.push(nextEntry);
  retained.sort((left, right) => compareStableStrings(String(right.generatedAt || ''), String(left.generatedAt || '')));
  return retained;
}

function buildPublicationArtifacts(options = {}) {
  const pkg = readJson(options.packagePath || PACKAGE_PATH);
  const reportPath = path.resolve(options.reportPath || DEFAULT_REPORT_PATH);
  const lockPath = path.resolve(options.lockPath || DEFAULT_LOCK_PATH);
  const bundlePath = path.resolve(options.bundlePath || DEFAULT_BUNDLE_PATH);
  const historyPath = path.resolve(options.historyPath || DEFAULT_HISTORY_PATH);
  const docHistoryPath = path.resolve(options.docsHistoryPath || DEFAULT_DOC_HISTORY_PATH);
  const report = readJson(reportPath);
  const lockDocument = readJson(lockPath);
  const existingHistory = fs.existsSync(historyPath) ? readJson(historyPath) : null;
  const existingBundle = fs.existsSync(bundlePath) ? readJson(bundlePath) : null;
  const digests = {
    reportSha256: sha256File(reportPath),
    lockSha256: sha256File(lockPath),
  };
  const suite = report && report.suite ? report.suite : 'core';
  const generatedAt = resolveGeneratedAt({
    report,
    existingHistory,
    existingBundle,
    packageVersion: pkg.version,
    suite,
  });

  const nextHistoryEntry = buildHistoryEntry(pkg, report, lockDocument, digests, generatedAt);
  const history = {
    schemaVersion: '1.0.0',
    suite,
    generatedAt,
    latestVersion: pkg.version,
    latestGeneratedAt: generatedAt,
    entries: normalizeHistory(existingHistory, nextHistoryEntry),
  };

  const bundle = {
    schemaVersion: '1.0.0',
    suite,
    generatedAt,
    package: {
      name: pkg.name,
      version: pkg.version,
    },
    assets: {
      reportPath: path.relative(ROOT_DIR, reportPath).split(path.sep).join('/'),
      lockPath: path.relative(ROOT_DIR, lockPath).split(path.sep).join('/'),
      historyPath: path.relative(ROOT_DIR, historyPath).split(path.sep).join('/'),
      docsHistoryPath: path.relative(ROOT_DIR, docHistoryPath).split(path.sep).join('/'),
      reportSha256: digests.reportSha256,
      lockSha256: digests.lockSha256,
    },
    latest: {
      summary: report.summary || {},
      parity: report.parity || {},
      runtime: report.runtime || {},
      contractLock: report.contractLock || {},
      contractLockMatchesExpected: report.contractLockMatchesExpected === true,
    },
    history,
  };

  return {
    reportPath,
    lockPath,
    bundlePath,
    historyPath,
    docHistoryPath,
    report,
    lockDocument,
    history,
    bundle,
  };
}

function writePublicationArtifacts(options = {}) {
  const artifacts = buildPublicationArtifacts(options);
  writeJson(artifacts.historyPath, artifacts.history);
  writeJson(artifacts.docHistoryPath, artifacts.history);
  writeJson(artifacts.bundlePath, artifacts.bundle);
  return artifacts;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--report-path') {
      options.reportPath = next;
      index += 1;
      continue;
    }
    if (token === '--lock-path') {
      options.lockPath = next;
      index += 1;
      continue;
    }
    if (token === '--bundle-path') {
      options.bundlePath = next;
      index += 1;
      continue;
    }
    if (token === '--history-path') {
      options.historyPath = next;
      index += 1;
      continue;
    }
    if (token === '--docs-history-path') {
      options.docsHistoryPath = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown benchmark publication flag: ${token}`);
  }
  return options;
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  const artifacts = writePublicationArtifacts(options);
  process.stdout.write(`${JSON.stringify({
    bundlePath: path.relative(ROOT_DIR, artifacts.bundlePath),
    historyPath: path.relative(ROOT_DIR, artifacts.historyPath),
    docsHistoryPath: path.relative(ROOT_DIR, artifacts.docHistoryPath),
    packageVersion: artifacts.bundle.package.version,
    suite: artifacts.bundle.suite,
  }, null, 2)}\n`);
}

module.exports = {
  ROOT_DIR,
  DEFAULT_REPORT_PATH,
  DEFAULT_LOCK_PATH,
  DEFAULT_BUNDLE_PATH,
  DEFAULT_HISTORY_PATH,
  DEFAULT_DOC_HISTORY_PATH,
  buildPublicationArtifacts,
  writePublicationArtifacts,
};
