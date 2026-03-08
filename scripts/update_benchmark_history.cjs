#!/usr/bin/env node
'use strict';

const path = require('path');
const {
  DEFAULT_REPORT_PATH,
  DEFAULT_LOCK_PATH,
  DEFAULT_BUNDLE_PATH,
  DEFAULT_HISTORY_PATH,
  DEFAULT_DOC_HISTORY_PATH,
  writePublicationArtifacts,
} = require('./build_benchmark_publication_bundle.cjs');

const ROOT_DIR = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const options = {
    reportPath: DEFAULT_REPORT_PATH,
    lockPath: DEFAULT_LOCK_PATH,
    bundlePath: DEFAULT_BUNDLE_PATH,
    historyPath: DEFAULT_HISTORY_PATH,
    docsHistoryPath: DEFAULT_DOC_HISTORY_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || '');
    const next = argv[index + 1];
    switch (token) {
      case '--report':
      case '--report-path':
        options.reportPath = path.resolve(ROOT_DIR, String(next || '').trim());
        index += 1;
        break;
      case '--lock':
      case '--lock-path':
        options.lockPath = path.resolve(ROOT_DIR, String(next || '').trim());
        index += 1;
        break;
      case '--bundle':
      case '--bundle-path':
        options.bundlePath = path.resolve(ROOT_DIR, String(next || '').trim());
        index += 1;
        break;
      case '--history':
      case '--history-path':
      case '--latest-history-path':
        options.historyPath = path.resolve(ROOT_DIR, String(next || '').trim());
        index += 1;
        break;
      case '--out':
      case '--docs-history-path':
        options.docsHistoryPath = path.resolve(ROOT_DIR, String(next || '').trim());
        index += 1;
        break;
      default:
        throw new Error(`Unknown benchmark history flag: ${token}`);
    }
  }

  return options;
}

function main() {
  const artifacts = writePublicationArtifacts(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({
    bundlePath: path.relative(ROOT_DIR, artifacts.bundlePath),
    historyPath: path.relative(ROOT_DIR, artifacts.historyPath),
    docsHistoryPath: path.relative(ROOT_DIR, artifacts.docHistoryPath),
    packageVersion: artifacts.bundle.package.version,
    suite: artifacts.bundle.suite,
  }, null, 2)}\n`);
}

main();
