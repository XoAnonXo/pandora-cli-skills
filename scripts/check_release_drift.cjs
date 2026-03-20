#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const PACKAGE_PATH = path.join(ROOT_DIR, 'package.json');
const PACKAGE_LOCK_PATH = path.join(ROOT_DIR, 'package-lock.json');
const { BACKUP_DIR, BACKUP_PATH, buildPublishedPackageJson } = require('./prepare_publish_manifest.cjs');

const REQUIRED_REPO_SCRIPTS = Object.freeze([
  'prepare:publish-manifest',
  'restore:publish-manifest',
  'benchmark:check',
  'benchmark:history',
  'check:docs',
  'check:release-trust',
  'release:finalize',
  'release:prep',
  'test:unit',
  'test:cli',
  'test:smoke',
  'test',
]);

function parseArgs(argv) {
  const options = {
    json: false,
    requireCleanTree: false,
    tag: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') {
      options.json = true;
      continue;
    }
    if (token === '--require-clean-tree') {
      options.requireCleanTree = true;
      continue;
    }
    if (token === '--tag') {
      const value = argv[index + 1];
      if (!value) throw new Error('--tag requires a value');
      options.tag = String(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!options.tag && process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME) {
    options.tag = process.env.GITHUB_REF_NAME;
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
      out[key] = stableJson(value[key]);
    }
    return out;
  }
  return value;
}

function isPreparedPublishManifest(pkg) {
  const expectedPublished = buildPublishedPackageJson(pkg);
  return JSON.stringify(stableJson(pkg)) === JSON.stringify(stableJson(expectedPublished));
}

function normalizeTagVersion(tag) {
  if (!tag) return null;
  return String(tag).replace(/^refs\/tags\//, '').replace(/^v/, '');
}

function getWorktreeChanges(options = {}) {
  try {
    const args = ['status', '--porcelain', options.includeUntracked ? '--untracked-files=all' : '--untracked-files=no'];
    const output = execFileSync('git', args, {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 8,
    });
    return output
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean);
  } catch (error) {
    return [`git-status-failed:${error && error.message ? error.message : String(error)}`];
  }
}

function checkReleaseDrift(options = {}) {
  const pkg = readJson(PACKAGE_PATH);
  const packageLock = fs.existsSync(PACKAGE_LOCK_PATH) ? readJson(PACKAGE_LOCK_PATH) : null;
  const findings = [];

  for (const scriptName of REQUIRED_REPO_SCRIPTS) {
    if (!pkg.scripts || typeof pkg.scripts[scriptName] !== 'string') {
      findings.push({
        code: 'REPO_MANIFEST_STRIPPED',
        message: `package.json is missing required repo script: ${scriptName}`,
      });
    }
  }

  if (!pkg.devDependencies || typeof pkg.devDependencies !== 'object' || Object.keys(pkg.devDependencies).length === 0) {
    findings.push({
      code: 'REPO_MANIFEST_STRIPPED',
      message: 'package.json is missing devDependencies; the publish-safe manifest appears to be checked in or left behind.',
    });
  }

  if (isPreparedPublishManifest(pkg)) {
    findings.push({
      code: 'REPO_MANIFEST_PREPARED',
      message: 'package.json currently matches the publish-safe manifest; restore the repository manifest before continuing.',
    });
  }

  if (fs.existsSync(BACKUP_PATH) || fs.existsSync(BACKUP_DIR)) {
    findings.push({
      code: 'PUBLISH_BACKUP_LEFT_BEHIND',
      message: '.packaging backup artifacts are still present; publish-manifest preparation was not fully restored.',
    });
  }

  if (packageLock && packageLock.packages && packageLock.packages['']) {
    const lockRoot = packageLock.packages[''];
    if (lockRoot.version && lockRoot.version !== pkg.version) {
      findings.push({
        code: 'PACKAGE_LOCK_VERSION_MISMATCH',
        message: `package-lock.json root version (${lockRoot.version}) does not match package.json version (${pkg.version}).`,
      });
    }
  }

  const normalizedTag = normalizeTagVersion(options.tag);
  if (normalizedTag && normalizedTag !== pkg.version) {
    findings.push({
      code: 'RELEASE_TAG_VERSION_MISMATCH',
      message: `Release tag version (${normalizedTag}) does not match package.json version (${pkg.version}).`,
    });
  }

  const trackedChanges = getWorktreeChanges({ includeUntracked: false });
  const cleanTreeChanges = options.requireCleanTree
    ? getWorktreeChanges({ includeUntracked: true })
    : trackedChanges;
  if (options.requireCleanTree && cleanTreeChanges.length > 0) {
    findings.push({
      code: 'WORKTREE_DIRTY',
      message: `Worktree is dirty: ${cleanTreeChanges.join(', ')}`,
    });
  }

  return {
    ok: findings.length === 0,
    packageVersion: pkg.version,
    checkedTag: normalizedTag,
    backupPathPresent: fs.existsSync(BACKUP_PATH),
    backupDirPresent: fs.existsSync(BACKUP_DIR),
    trackedChanges,
    cleanTreeChanges,
    findings,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = checkReleaseDrift(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write(`Release drift checks passed for pandora-cli-skills@${result.packageVersion}\n`);
  } else {
    process.stderr.write(`Release drift checks failed for pandora-cli-skills@${result.packageVersion}:\n`);
    for (const finding of result.findings) {
      process.stderr.write(`- [${finding.code}] ${finding.message}\n`);
    }
  }
  if (!result.ok) process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  REQUIRED_REPO_SCRIPTS,
  checkReleaseDrift,
  getWorktreeChanges,
  normalizeTagVersion,
  isPreparedPublishManifest,
};
