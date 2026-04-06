const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ensureSharedNodeModules,
} = require('../../proving-ground/lib/baton_worktree_manager.cjs');
const {
  createTempDir,
  removeDir,
} = require('../helpers/cli_runner.cjs');

test('ensureSharedNodeModules links a lane worktree back to the repo dependency tree', () => {
  const tempDir = createTempDir('pandora-baton-worktree-');
  const repoRoot = path.join(tempDir, 'repo');
  const worktreePath = path.join(tempDir, 'lane-01');
  const sourcePath = path.join(repoRoot, 'node_modules');
  const packagePath = path.join(sourcePath, '@polymarket', 'clob-client');

  fs.mkdirSync(packagePath, { recursive: true });
  fs.mkdirSync(worktreePath, { recursive: true });

  try {
    const first = ensureSharedNodeModules(repoRoot, worktreePath);
    const targetPath = path.join(worktreePath, 'node_modules');
    assert.equal(first.reason, 'linked');
    assert.equal(fs.lstatSync(targetPath).isSymbolicLink(), true);
    assert.equal(fs.realpathSync(targetPath), fs.realpathSync(sourcePath));

    const second = ensureSharedNodeModules(repoRoot, worktreePath);
    assert.equal(second.reason, 'already-linked');
  } finally {
    removeDir(tempDir);
  }
});
