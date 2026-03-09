'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function makeTempRepo(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-publish-restore-'));
  t.after(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  fs.mkdirSync(path.join(rootDir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'benchmarks', 'locks'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'benchmarks', 'latest'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'docs', 'benchmarks'), { recursive: true });

  for (const scriptName of ['prepare_publish_manifest.cjs', 'restore_publish_manifest.cjs']) {
    fs.copyFileSync(
      path.join(REPO_ROOT, 'scripts', scriptName),
      path.join(rootDir, 'scripts', scriptName),
    );
  }

  fs.writeFileSync(
    path.join(rootDir, 'package.json'),
    `${JSON.stringify({
      name: 'pandora-cli-skills',
      version: '9.9.9',
      scripts: {
        cli: 'node cli/pandora.cjs',
        'prepare:publish-manifest': 'node scripts/prepare_publish_manifest.cjs',
        'restore:publish-manifest': 'node scripts/restore_publish_manifest.cjs',
      },
      devDependencies: {
        typescript: '^5.9.0',
      },
    }, null, 2)}\n`,
  );

  for (const fixturePath of [
    path.join(rootDir, 'benchmarks', 'locks', 'core.lock.json'),
    path.join(rootDir, 'benchmarks', 'latest', 'core-report.json'),
    path.join(rootDir, 'benchmarks', 'latest', 'core-bundle.json'),
    path.join(rootDir, 'benchmarks', 'latest', 'core-history.json'),
    path.join(rootDir, 'docs', 'benchmarks', 'history.json'),
  ]) {
    fs.writeFileSync(fixturePath, '{}\n');
  }

  return rootDir;
}

test('restore publish manifest removes stale backup directories without a package backup file', (t) => {
  const rootDir = makeTempRepo(t);
  const staleDir = path.join(rootDir, '.packaging', 'benchmarks', 'latest');
  fs.mkdirSync(staleDir, { recursive: true });

  const result = spawnSync(process.execPath, ['scripts/restore_publish_manifest.cjs'], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Removed stale publish manifest backup directory/);
  assert.equal(fs.existsSync(path.join(rootDir, '.packaging')), false);
});

test('prepare publish manifest clears stale backup directories before writing a fresh backup', (t) => {
  const rootDir = makeTempRepo(t);
  const staleFile = path.join(rootDir, '.packaging', 'benchmarks', 'latest', 'stale.txt');
  fs.mkdirSync(path.dirname(staleFile), { recursive: true });
  fs.writeFileSync(staleFile, 'stale\n');

  const result = spawnSync(process.execPath, ['scripts/prepare_publish_manifest.cjs'], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Prepared publish-safe package\.json manifest/);
  assert.equal(fs.existsSync(staleFile), false);
  assert.equal(fs.existsSync(path.join(rootDir, '.packaging', 'package.json.backup')), true);
});
