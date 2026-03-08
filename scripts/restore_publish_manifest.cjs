#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PACKAGE_PATH = path.join(ROOT_DIR, 'package.json');
const BACKUP_DIR = path.join(ROOT_DIR, '.packaging');
const BACKUP_PATH = path.join(BACKUP_DIR, 'package.json.backup');
const { BENCHMARK_FIXTURE_PATHS } = require('./prepare_publish_manifest.cjs');

function restoreBenchmarkFixtures() {
  for (const fixturePath of BENCHMARK_FIXTURE_PATHS) {
    const relativeFixturePath = path.relative(ROOT_DIR, fixturePath);
    const backupFixturePath = path.join(BACKUP_DIR, relativeFixturePath);
    if (!fs.existsSync(backupFixturePath)) continue;
    fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
    fs.copyFileSync(backupFixturePath, fixturePath);
  }
}

function main() {
  if (!fs.existsSync(BACKUP_PATH)) {
    process.stdout.write('No publish manifest backup found; package.json already restored.\n');
    return;
  }

  fs.copyFileSync(BACKUP_PATH, PACKAGE_PATH);
  restoreBenchmarkFixtures();
  fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
  process.stdout.write('Restored repository package.json manifest.\n');
}

if (require.main === module) {
  main();
}

module.exports = {
  BACKUP_PATH,
  restoreBenchmarkFixtures,
  main,
};
