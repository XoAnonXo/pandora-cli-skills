#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
const PACKAGE_PATH = path.join(ROOT_DIR, 'package.json');
const DEFAULT_OUT_PATH = path.join(ROOT_DIR, 'dist', 'release', 'benchmarks', 'benchmark-publication-manifest.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function parseArgs(argv) {
  const options = {
    packagePath: PACKAGE_PATH,
    outPath: DEFAULT_OUT_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || '');
    const next = argv[index + 1];
    if (token === '--package-json') {
      options.packagePath = path.resolve(ROOT_DIR, String(next || '').trim());
      index += 1;
      continue;
    }
    if (token === '--out') {
      options.outPath = path.resolve(ROOT_DIR, String(next || '').trim());
      index += 1;
      continue;
    }
    if (token.startsWith('--')) {
      const key = token.slice(2);
      options[key] = path.resolve(ROOT_DIR, String(next || '').trim());
      index += 1;
      continue;
    }
    throw new Error(`Unknown benchmark publication manifest flag: ${token}`);
  }

  return options;
}

function requiredPath(options, key) {
  const value = options[key];
  if (!value) {
    throw new Error(`Missing required flag: --${key}`);
  }
  if (!fs.existsSync(value)) {
    throw new Error(`Missing required file for --${key}: ${value}`);
  }
  return value;
}

function toRepoPath(filePath) {
  return path.relative(ROOT_DIR, filePath).split(path.sep).join('/');
}

function buildPublicationManifest(options) {
  const pkg = readJson(options.packagePath);
  const tarballPath = requiredPath(options, 'tarball');
  const reportPath = requiredPath(options, 'report');
  const lockPath = requiredPath(options, 'lock');
  const bundlePath = requiredPath(options, 'bundle');
  const historyPath = requiredPath(options, 'history');
  const docsHistoryPath = requiredPath(options, 'docsHistory');

  const report = readJson(reportPath);
  const lock = readJson(lockPath);
  const generatedAt = report && report.generatedAt ? report.generatedAt : new Date().toISOString();

  return {
    schemaVersion: '1.0.0',
    generatedAt,
    package: {
      name: pkg.name,
      version: pkg.version,
      tarballPath: toRepoPath(tarballPath),
      tarballSha256: sha256File(tarballPath),
    },
    benchmark: {
      suite: report && report.suite ? report.suite : 'core',
      reportPath: toRepoPath(reportPath),
      reportSha256: sha256File(reportPath),
      lockPath: toRepoPath(lockPath),
      lockSha256: sha256File(lockPath),
      bundlePath: toRepoPath(bundlePath),
      bundleSha256: sha256File(bundlePath),
      historyPath: toRepoPath(historyPath),
      historySha256: sha256File(historyPath),
      docsHistoryPath: toRepoPath(docsHistoryPath),
      docsHistorySha256: sha256File(docsHistoryPath),
      contractLockHash:
        lock && lock.publication && typeof lock.publication.contractLockHash === 'string'
          ? lock.publication.contractLockHash
          : null,
      lockDocumentHash:
        lock && lock.publication && typeof lock.publication.lockDocumentHash === 'string'
          ? lock.publication.lockDocumentHash
          : null,
      weightedScore:
        report && report.summary && Number.isFinite(Number(report.summary.weightedScore))
          ? Number(report.summary.weightedScore)
          : null,
      overallPass:
        report && report.summary ? report.summary.overallPass === true : null,
      contractLockMatchesExpected:
        report ? report.contractLockMatchesExpected === true : null,
    },
  };
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const manifest = buildPublicationManifest(options);
  writeJson(options.outPath, manifest);
  process.stdout.write(`${JSON.stringify({
    outPath: toRepoPath(options.outPath),
    packageVersion: manifest.package.version,
    suite: manifest.benchmark.suite,
  }, null, 2)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  ROOT_DIR,
  DEFAULT_OUT_PATH,
  buildPublicationManifest,
};
