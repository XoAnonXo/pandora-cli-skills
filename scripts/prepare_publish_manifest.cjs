#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PACKAGE_PATH = path.join(ROOT_DIR, 'package.json');
const BACKUP_DIR = path.join(ROOT_DIR, '.packaging');
const BACKUP_PATH = path.join(BACKUP_DIR, 'package.json.backup');
const BENCHMARK_FIXTURE_PATHS = Object.freeze([
  path.join(ROOT_DIR, 'benchmarks', 'locks', 'core.lock.json'),
  path.join(ROOT_DIR, 'benchmarks', 'latest', 'core-report.json'),
  path.join(ROOT_DIR, 'benchmarks', 'latest', 'core-bundle.json'),
  path.join(ROOT_DIR, 'benchmarks', 'latest', 'core-history.json'),
  path.join(ROOT_DIR, 'docs', 'benchmarks', 'history.json'),
]);

const PUBLISHED_SCRIPT_NAMES = Object.freeze([
  'cli',
  'init-env',
  'doctor',
  'setup',
  'dry-run',
  'execute',
  'dry-run:clone',
]);

const PUBLISHED_FILE_DENYLIST = Object.freeze([
  'scripts/check_skill_docs.cjs',
  'scripts/clean_sdk_python_cache.cjs',
  'scripts/generate_agent_contract_sdk.cjs',
  'scripts/prepare_publish_manifest.cjs',
  'scripts/restore_publish_manifest.cjs',
  'scripts/lib/**',
]);

function readPackageJson() {
  return JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
}

function writePackageJson(pkg) {
  fs.writeFileSync(PACKAGE_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
}

function backupBenchmarkFixtures() {
  for (const fixturePath of BENCHMARK_FIXTURE_PATHS) {
    if (!fs.existsSync(fixturePath)) continue;
    const relativeFixturePath = path.relative(ROOT_DIR, fixturePath);
    const backupFixturePath = path.join(BACKUP_DIR, relativeFixturePath);
    fs.mkdirSync(path.dirname(backupFixturePath), { recursive: true });
    fs.copyFileSync(fixturePath, backupFixturePath);
  }
}

function buildPublishedPackageJson(pkg) {
  const publishedPkg = JSON.parse(JSON.stringify(pkg));
  const nextScripts = {};

  for (const scriptName of PUBLISHED_SCRIPT_NAMES) {
    if (publishedPkg.scripts && Object.prototype.hasOwnProperty.call(publishedPkg.scripts, scriptName)) {
      nextScripts[scriptName] = publishedPkg.scripts[scriptName];
    }
  }

  publishedPkg.scripts = nextScripts;

  if (Array.isArray(publishedPkg.files)) {
    publishedPkg.files = publishedPkg.files.filter((entry) => !PUBLISHED_FILE_DENYLIST.includes(entry));
  }

  delete publishedPkg.devDependencies;

  return publishedPkg;
}

function main() {
  if (fs.existsSync(BACKUP_PATH)) {
    process.stdout.write('Publish manifest backup already exists; package.json is already prepared.\n');
    return;
  }

  const pkg = readPackageJson();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(BACKUP_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
  backupBenchmarkFixtures();
  writePackageJson(buildPublishedPackageJson(pkg));
  process.stdout.write('Prepared publish-safe package.json manifest.\n');
}

if (require.main === module) {
  main();
}

module.exports = {
  BACKUP_DIR,
  BACKUP_PATH,
  PUBLISHED_FILE_DENYLIST,
  PUBLISHED_SCRIPT_NAMES,
  BENCHMARK_FIXTURE_PATHS,
  backupBenchmarkFixtures,
  buildPublishedPackageJson,
  main,
  readPackageJson,
  writePackageJson,
};
