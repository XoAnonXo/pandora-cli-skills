const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function normalizeText(value) {
  return String(value ?? '').trim();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function writeJsonAtomic(filePath, payload) {
  const targetPath = path.resolve(filePath);
  ensureDir(path.dirname(targetPath));
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, targetPath);
  return targetPath;
}

function readJsonIfExists(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw error;
  }
}

function appendNdjson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
  return filePath;
}

function buildBatchId(prefix = 'baton') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}-${stamp}`;
}

function formatLaneId(index) {
  return `lane-${String(Number(index) || 0).padStart(2, '0')}`;
}

function buildAttemptId(index) {
  return `attempt-${String(Number(index) || 0).padStart(4, '0')}`;
}

function slugifyText(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'item';
}

function stableStringify(value) {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function createFingerprint(value) {
  return crypto.createHash('sha1').update(stableStringify(value)).digest('hex');
}

function defaultWorktreeRoot(repoRoot, batchId) {
  const repoName = path.basename(path.resolve(repoRoot));
  return path.resolve(repoRoot, '..', `${repoName}-baton-worktrees`, batchId);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

function formatDuration(ms) {
  const numeric = Number(ms);
  if (!Number.isFinite(numeric)) {
    return 'n/a';
  }
  if (numeric < 1000) {
    return `${numeric.toFixed(1)} ms`;
  }
  return `${(numeric / 1000).toFixed(2)} s`;
}

function buildWorkerId(prefix = 'worker') {
  const entropy = crypto.randomBytes(4).toString('hex');
  return `${prefix}-${process.pid}-${entropy}`;
}

function resolveRepoPath(repoRoot, relativePath) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const normalizedRelative = path.relative(repoRoot, absolutePath);
  if (!normalizedRelative || normalizedRelative.startsWith('..') || path.isAbsolute(normalizedRelative)) {
    throw new Error(`Path escapes repo root: ${relativePath}`);
  }
  return {
    absolutePath,
    relativePath: normalizedRelative.split(path.sep).join('/'),
  };
}

function readTextIfExists(filePath, fallback = '') {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw error;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function isProcessAlive(pid) {
  const numeric = Number(pid);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return false;
  }
  try {
    process.kill(numeric, 0);
    return true;
  } catch (error) {
    if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
      return true;
    }
    return false;
  }
}

module.exports = {
  appendNdjson,
  buildAttemptId,
  buildBatchId,
  buildWorkerId,
  createFingerprint,
  defaultWorktreeRoot,
  ensureDir,
  formatDuration,
  formatLaneId,
  isProcessAlive,
  normalizeText,
  nowIso,
  readJsonIfExists,
  readTextIfExists,
  resolveRepoPath,
  sleep,
  slugifyText,
  stableStringify,
  writeJsonAtomic,
};
