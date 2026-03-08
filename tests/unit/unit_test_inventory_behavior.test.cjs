'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_SCRIPT = path.join(REPO_ROOT, 'scripts', 'run_unit_tests.cjs');

function makeTempRepo(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-unit-tests-'));
  t.after(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  fs.mkdirSync(path.join(rootDir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'tests', 'unit'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'sdk', 'typescript', 'test'), { recursive: true });
  fs.copyFileSync(SOURCE_SCRIPT, path.join(rootDir, 'scripts', 'run_unit_tests.cjs'));

  fs.writeFileSync(
    path.join(rootDir, 'tests', 'unit', 'tracked.test.cjs'),
    `'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
test('tracked test runs', () => { assert.equal(1, 1); });
`,
  );
  fs.writeFileSync(
    path.join(rootDir, 'tests', 'unit', 'untracked.test.cjs'),
    `'use strict';
const test = require('node:test');
test('untracked test should never run', () => { throw new Error('untracked test executed'); });
`,
  );

  execFileSync('git', ['init'], { cwd: rootDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'codex@example.com'], { cwd: rootDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Codex'], { cwd: rootDir, stdio: 'ignore' });
  execFileSync('git', ['add', 'scripts/run_unit_tests.cjs', 'tests/unit/tracked.test.cjs'], { cwd: rootDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: rootDir, stdio: 'ignore' });

  return rootDir;
}

test('run_unit_tests executes only tracked tests and ignores untracked files', (t) => {
  const rootDir = makeTempRepo(t);
  const result = spawnSync(process.execPath, ['scripts/run_unit_tests.cjs'], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /untracked test should never run/);
});
