'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_SCRIPT = path.join(REPO_ROOT, 'scripts', 'check_release_drift.cjs');

function makeTempRepo(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-release-drift-'));
  t.after(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  fs.mkdirSync(path.join(rootDir, 'scripts'), { recursive: true });
  fs.copyFileSync(SOURCE_SCRIPT, path.join(rootDir, 'scripts', 'check_release_drift.cjs'));
  fs.writeFileSync(
    path.join(rootDir, 'scripts', 'prepare_publish_manifest.cjs'),
    `'use strict';
function buildPublishedPackageJson(pkg) {
  const copy = JSON.parse(JSON.stringify(pkg));
  delete copy.devDependencies;
  copy.scripts = { cli: 'node cli/pandora.cjs' };
  return copy;
}
module.exports = {
  BACKUP_DIR: '.packaging',
  BACKUP_PATH: '.packaging/package.json.bak',
  buildPublishedPackageJson,
};
`,
  );

  fs.writeFileSync(
    path.join(rootDir, 'package.json'),
    `${JSON.stringify({
      name: 'pandora-cli-skills',
      version: '9.9.9',
      scripts: {
        'prepare:publish-manifest': 'node scripts/prepare_publish_manifest.cjs',
        'restore:publish-manifest': 'node scripts/restore_publish_manifest.cjs',
        'benchmark:check': 'node scripts/benchmark_check.cjs',
        'benchmark:history': 'node scripts/benchmark_history.cjs',
        'check:docs': 'node scripts/check_docs.cjs',
        'check:release-trust': 'node scripts/check_release_trust.cjs',
        'release:prep': 'node scripts/release_prep.cjs',
        'test:unit': 'node scripts/test_unit.cjs',
        'test:cli': 'node scripts/test_cli.cjs',
        'test:smoke': 'node scripts/test_smoke.cjs',
        test: 'node scripts/test_all.cjs',
      },
      devDependencies: {
        typescript: '^5.9.0',
      },
    }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(rootDir, 'package-lock.json'),
    `${JSON.stringify({
      name: 'pandora-cli-skills',
      version: '9.9.9',
      lockfileVersion: 3,
      packages: {
        '': {
          name: 'pandora-cli-skills',
          version: '9.9.9',
        },
      },
    }, null, 2)}\n`,
  );

  execFileSync('git', ['init'], { cwd: rootDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'codex@example.com'], { cwd: rootDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Codex'], { cwd: rootDir, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: rootDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: rootDir, stdio: 'ignore' });

  return rootDir;
}

test('release drift clean-tree mode rejects untracked files', (t) => {
  const rootDir = makeTempRepo(t);
  fs.writeFileSync(path.join(rootDir, 'UNTRACKED.md'), 'local artifact\n');

  const result = spawnSync(process.execPath, ['scripts/check_release_drift.cjs', '--require-clean-tree'], {
    cwd: rootDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_REF: '',
      GITHUB_REF_NAME: '',
      GITHUB_REF_TYPE: '',
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /WORKTREE_DIRTY/);
  assert.match(result.stderr, /UNTRACKED\.md/);
});

test('release drift check passes on a clean repository snapshot', (t) => {
  const rootDir = makeTempRepo(t);
  const result = spawnSync(process.execPath, ['scripts/check_release_drift.cjs'], {
    cwd: rootDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_REF: '',
      GITHUB_REF_NAME: '',
      GITHUB_REF_TYPE: '',
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Release drift checks passed/);
});
