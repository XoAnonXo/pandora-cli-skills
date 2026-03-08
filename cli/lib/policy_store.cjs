'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isMcpMode } = require('./shared/mcp_path_guard.cjs');
const {
  DEFAULT_POLICY_DIR,
  POLICY_FILE_EXTENSION,
  POLICY_ID_PATTERN,
} = require('./shared/policy_constants.cjs');

function createPolicyStoreError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function expandHome(filePath) {
  if (!filePath) return filePath;
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith('~/')) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function compareStableStrings(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function defaultPolicyDir() {
  const configuredRoot = normalizeText(process.env.PANDORA_POLICY_DIR || process.env.PANDORA_POLICIES_DIR);
  if (configuredRoot) {
    return configuredRoot;
  }
  if (isMcpMode()) {
    return path.resolve(process.cwd(), '.pandora', 'policies');
  }
  return path.join(os.homedir(), DEFAULT_POLICY_DIR);
}

function resolvePolicyDir(rootDir) {
  return path.resolve(expandHome(rootDir || defaultPolicyDir()));
}

function ensurePrivateDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // best-effort permission hardening
  }
}

function hardenPrivateFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort permission hardening
  }
}

function normalizePolicyId(policyId) {
  const normalizedId = normalizeText(policyId);
  if (!normalizedId || !POLICY_ID_PATTERN.test(normalizedId)) {
    throw createPolicyStoreError('POLICY_ID_INVALID', 'Policy id must be kebab-case.', { policyId });
  }
  return normalizedId;
}

function defaultPolicyFile(policyId, options = {}) {
  const rootDir = resolvePolicyDir(options.rootDir);
  const normalizedId = normalizePolicyId(policyId);
  return path.join(rootDir, `${normalizedId}${POLICY_FILE_EXTENSION}`);
}

function atomicWriteJson(filePath, payload) {
  ensurePrivateDirectory(path.dirname(filePath));
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  fs.writeFileSync(tempFile, serialized, { mode: 0o600 });
  fs.renameSync(tempFile, filePath);
  hardenPrivateFile(filePath);
  return filePath;
}

function listStoredPolicyFiles(rootDir) {
  const dir = resolvePolicyDir(rootDir);
  if (!fs.existsSync(dir)) {
    return { dir, files: [] };
  }
  const files = fs.readdirSync(dir)
    .filter((name) => name.endsWith(POLICY_FILE_EXTENSION))
    .map((name) => path.join(dir, name))
    .sort(compareStableStrings);
  return { dir, files };
}

function readPolicyFile(filePath, options = {}) {
  const resolvedPath = path.resolve(String(filePath || ''));
  if (!fs.existsSync(resolvedPath)) {
    if (options.missingOk === true) return null;
    throw createPolicyStoreError('POLICY_FILE_NOT_FOUND', `Policy file not found: ${resolvedPath}`, {
      filePath: resolvedPath,
    });
  }

  try {
    const raw = fs.readFileSync(resolvedPath, 'utf8');
    return {
      filePath: resolvedPath,
      raw,
      data: JSON.parse(raw),
    };
  } catch (error) {
    throw createPolicyStoreError('POLICY_FILE_INVALID', `Unable to read policy file: ${resolvedPath}`, {
      filePath: resolvedPath,
      cause: error && error.message ? error.message : String(error),
    });
  }
}

function readStoredPolicyPack(policyId, options = {}) {
  const filePath = defaultPolicyFile(policyId, options);
  return readPolicyFile(filePath, { missingOk: options.missingOk === true });
}

function writeStoredPolicyPack(policyPack, options = {}) {
  const normalizedId = normalizePolicyId(policyPack && policyPack.id);
  const filePath = defaultPolicyFile(normalizedId, options);
  const exists = fs.existsSync(filePath);
  if (exists && options.replace !== true) {
    throw createPolicyStoreError('POLICY_ALREADY_EXISTS', `Policy pack already exists: ${normalizedId}`, {
      id: normalizedId,
      filePath,
    });
  }

  atomicWriteJson(filePath, policyPack);
  return {
    id: normalizedId,
    filePath,
    replaced: exists,
  };
}

module.exports = {
  createPolicyStoreError,
  resolvePolicyDir,
  defaultPolicyFile,
  listStoredPolicyFiles,
  readPolicyFile,
  readStoredPolicyPack,
  writeStoredPolicyPack,
};
