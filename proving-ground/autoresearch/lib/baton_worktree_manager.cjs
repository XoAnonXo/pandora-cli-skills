const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { ensureDir, normalizeText } = require('./baton_common.cjs');

function runGit(repoRoot, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  return {
    exitCode: result.status === null ? 1 : result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

function assertGitOk(result, label) {
  if (!result || result.exitCode !== 0) {
    throw new Error(`${label} failed: ${result && (result.stderr || result.stdout || result.exitCode)}`);
  }
  return result;
}

function getHeadCommit(repoRoot) {
  const result = runGit(repoRoot, ['rev-parse', 'HEAD']);
  assertGitOk(result, 'git rev-parse HEAD');
  return normalizeText(result.stdout);
}

function gitStatus(repoRoot) {
  const result = runGit(repoRoot, ['status', '--porcelain']);
  assertGitOk(result, 'git status --porcelain');
  return String(result.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function branchExists(repoRoot, branchName) {
  const result = runGit(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`]);
  return result.exitCode === 0;
}

function ensureBranchCheckedOut(worktreePath, branchName, startPoint) {
  const args = branchExists(worktreePath, branchName)
    ? ['checkout', '-B', branchName, startPoint]
    : ['checkout', '-b', branchName, startPoint];
  const result = runGit(worktreePath, args);
  assertGitOk(result, `git ${args.join(' ')}`);
  return branchName;
}

function ensureSharedNodeModules(repoRoot, worktreePath) {
  const sourcePath = path.resolve(repoRoot, 'node_modules');
  if (!fs.existsSync(sourcePath)) {
    return {
      linked: false,
      targetPath: path.resolve(worktreePath, 'node_modules'),
      sourcePath,
      reason: 'missing-source',
    };
  }
  const targetPath = path.resolve(worktreePath, 'node_modules');
  if (fs.existsSync(targetPath)) {
    try {
      if (fs.realpathSync(targetPath) === fs.realpathSync(sourcePath)) {
        return {
          linked: false,
          targetPath,
          sourcePath,
          reason: 'already-linked',
        };
      }
    } catch {
      // Leave existing content alone if it cannot be resolved safely.
    }
    return {
      linked: false,
      targetPath,
      sourcePath,
      reason: 'present',
    };
  }
  fs.symlinkSync(sourcePath, targetPath, 'dir');
  return {
    linked: true,
    targetPath,
    sourcePath,
    reason: 'linked',
  };
}

function createWorktree(repoRoot, options) {
  const worktreePath = path.resolve(options.worktreePath);
  const branchName = normalizeText(options.branchName);
  const startPoint = normalizeText(options.startPoint) || 'HEAD';
  ensureDir(path.dirname(worktreePath));
  if (fs.existsSync(worktreePath)) {
    throw new Error(`Worktree path already exists: ${worktreePath}`);
  }
  const args = ['worktree', 'add', '-b', branchName, worktreePath, startPoint];
  const result = runGit(repoRoot, args);
  assertGitOk(result, `git ${args.join(' ')}`);
  ensureSharedNodeModules(repoRoot, worktreePath);
  return {
    worktreePath,
    branchName,
    startPoint,
  };
}

function prepareExistingWorktree(repoRoot, worktreePath, options = {}) {
  const branchName = normalizeText(options.branchName);
  const startPoint = normalizeText(options.startPoint) || 'HEAD';
  if (!fs.existsSync(worktreePath)) {
    throw new Error(`Worktree path not found: ${worktreePath}`);
  }
  const dirtyEntries = gitStatus(worktreePath);
  if (dirtyEntries.length > 0) {
    throw new Error(`Worktree is dirty and cannot be reused safely: ${worktreePath}`);
  }
  const checkoutArgs = branchExists(worktreePath, branchName)
    ? ['checkout', '-B', branchName, startPoint]
    : ['checkout', '-b', branchName, startPoint];
  assertGitOk(runGit(worktreePath, checkoutArgs), `git ${checkoutArgs.join(' ')}`);
  ensureSharedNodeModules(repoRoot, worktreePath);
  return {
    worktreePath,
    branchName,
    startPoint,
  };
}

function removeWorktree(repoRoot, worktreePath, options = {}) {
  if (!fs.existsSync(worktreePath)) {
    return { skipped: true };
  }
  const args = ['worktree', 'remove'];
  if (options.force) {
    args.push('--force');
  }
  args.push(worktreePath);
  const result = runGit(repoRoot, args);
  assertGitOk(result, `git ${args.join(' ')}`);
  return {
    skipped: false,
    worktreePath,
  };
}

function deleteBranch(repoRoot, branchName, options = {}) {
  const args = [options.force ? 'branch' : 'branch', options.force ? '-D' : '-d', branchName];
  const result = runGit(repoRoot, args);
  if (result.exitCode !== 0) {
    return {
      deleted: false,
      error: result.stderr || result.stdout,
    };
  }
  return {
    deleted: true,
  };
}

module.exports = {
  branchExists,
  createWorktree,
  deleteBranch,
  ensureBranchCheckedOut,
  ensureSharedNodeModules,
  getHeadCommit,
  gitStatus,
  prepareExistingWorktree,
  removeWorktree,
  runGit,
};
