const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  createWorktree,
  ensureSharedNodeModules,
  prepareExistingWorktree,
  removeWorktree,
} = require('../../proving-ground/lib/baton_worktree_manager.cjs');
const { createTempDir, removeDir } = require('../helpers/cli_runner.cjs');

function initRepo(tempDir) {
  const init = spawnSync('git', ['init', '-b', 'main'], { cwd: tempDir, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name":"baton-fixture"}\n', 'utf8');
  fs.writeFileSync(path.join(tempDir, '.gitignore'), 'node_modules/\n', 'utf8');
  fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'base\n', 'utf8');
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: tempDir, encoding: 'utf8' }).status, 0);
  const commit = spawnSync(
    'git',
    ['-c', 'user.name=Codex', '-c', 'user.email=codex@example.com', 'commit', '-m', 'snapshot'],
    { cwd: tempDir, encoding: 'utf8' },
  );
  assert.equal(commit.status, 0, commit.stderr || commit.stdout);
  fs.mkdirSync(path.join(tempDir, 'node_modules', '@scope', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'node_modules', '@scope', 'pkg', 'index.js'), 'module.exports = 1;\n', 'utf8');
}

test('createWorktree links shared node_modules into a fresh lane worktree', () => {
  const tempDir = createTempDir('pandora-baton-worktree-');
  const worktreePath = path.join(tempDir, 'worktrees', 'lane-01');
  try {
    initRepo(tempDir);
    createWorktree(tempDir, {
      worktreePath,
      branchName: 'codex/baton/test/lane-01',
      startPoint: 'HEAD',
    });
    const worktreeNodeModules = path.join(worktreePath, 'node_modules');
    assert.equal(fs.lstatSync(worktreeNodeModules).isSymbolicLink(), true);
    assert.equal(
      fs.realpathSync(worktreeNodeModules),
      fs.realpathSync(path.join(tempDir, 'node_modules')),
    );
  } finally {
    try {
      removeWorktree(tempDir, worktreePath, { force: true });
    } catch {
      // Ignore cleanup failures in the test harness.
    }
    removeDir(tempDir);
  }
});

test('prepareExistingWorktree restores the shared node_modules link when it is missing', () => {
  const tempDir = createTempDir('pandora-baton-worktree-reuse-');
  const worktreePath = path.join(tempDir, 'worktrees', 'lane-01');
  try {
    initRepo(tempDir);
    createWorktree(tempDir, {
      worktreePath,
      branchName: 'codex/baton/test/lane-01',
      startPoint: 'HEAD',
    });
    fs.rmSync(path.join(worktreePath, 'node_modules'), { force: true, recursive: true });
    prepareExistingWorktree(tempDir, worktreePath, {
      branchName: 'codex/baton/test/lane-02',
      startPoint: 'HEAD',
    });
    const worktreeNodeModules = path.join(worktreePath, 'node_modules');
    assert.equal(fs.lstatSync(worktreeNodeModules).isSymbolicLink(), true);
    assert.equal(
      fs.realpathSync(worktreeNodeModules),
      fs.realpathSync(path.join(tempDir, 'node_modules')),
    );
  } finally {
    try {
      removeWorktree(tempDir, worktreePath, { force: true });
    } catch {
      // Ignore cleanup failures in the test harness.
    }
    removeDir(tempDir);
  }
});

test('ensureSharedNodeModules stays non-fatal when the main repo has no node_modules yet', () => {
  const tempDir = createTempDir('pandora-baton-worktree-empty-modules-');
  const worktreePath = path.join(tempDir, 'lane-01');
  try {
    fs.mkdirSync(worktreePath, { recursive: true });
    const result = ensureSharedNodeModules(tempDir, worktreePath);
    assert.equal(result.linked, false);
    assert.equal(result.reason, 'missing-source');
    assert.equal(fs.existsSync(path.join(worktreePath, 'node_modules')), false);
  } finally {
    removeDir(tempDir);
  }
});
