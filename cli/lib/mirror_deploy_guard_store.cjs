const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MIRROR_DEPLOY_GUARD_SCHEMA_VERSION = '1.0.0';

function defaultMirrorDeployGuardDir() {
  return path.join(os.homedir(), '.pandora', 'mirror', 'deploy-guards');
}

function normalizeSourceIdentity(input = {}) {
  return {
    polymarketMarketId: input.polymarketMarketId ? String(input.polymarketMarketId).toLowerCase() : null,
    polymarketSlug: input.polymarketSlug ? String(input.polymarketSlug).toLowerCase() : null,
  };
}

function buildMirrorDeployGuardId(input = {}) {
  const normalized = normalizeSourceIdentity(input);
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(normalized));
  return hash.digest('hex').slice(0, 24);
}

function resolveMirrorDeployGuardFile(input = {}, options = {}) {
  const dir = path.resolve(options.guardDir || defaultMirrorDeployGuardDir());
  const guardId = buildMirrorDeployGuardId(input);
  return {
    guardId,
    filePath: path.join(dir, `${guardId}.json`),
  };
}

function readMirrorDeployGuard(input = {}, options = {}) {
  const resolved = resolveMirrorDeployGuardFile(input, options);
  if (!fs.existsSync(resolved.filePath)) {
    return {
      ...resolved,
      found: false,
      guard: null,
    };
  }

  try {
    return {
      ...resolved,
      found: true,
      guard: JSON.parse(fs.readFileSync(resolved.filePath, 'utf8')),
    };
  } catch (error) {
    error.code = error.code || 'MIRROR_DEPLOY_GUARD_INVALID';
    throw error;
  }
}

function writeMirrorDeployGuard(input = {}, guard = {}, options = {}) {
  const resolved = resolveMirrorDeployGuardFile(input, options);
  fs.mkdirSync(path.dirname(resolved.filePath), { recursive: true });
  const payload = {
    schemaVersion: MIRROR_DEPLOY_GUARD_SCHEMA_VERSION,
    guardId: resolved.guardId,
    ...guard,
  };
  const tmpPath = `${resolved.filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
    fs.renameSync(tmpPath, resolved.filePath);
    return {
      ...resolved,
      found: true,
      guard: payload,
    };
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // best-effort temp cleanup
    }
    throw err;
  }
}

function beginMirrorDeployGuard(input = {}, details = {}, options = {}) {
  const existing = readMirrorDeployGuard(input, options);
  if (
    existing.found
    && existing.guard
    && existing.guard.status
    && existing.guard.status !== 'failed_prewrite'
  ) {
    return {
      ...existing,
      reused: true,
    };
  }

  const nowIso = new Date().toISOString();
  const created = writeMirrorDeployGuard(
    input,
    {
      createdAt: existing.guard && existing.guard.createdAt ? existing.guard.createdAt : nowIso,
      updatedAt: nowIso,
      status: 'started',
      chainWriteStarted: false,
      ...details,
    },
    options,
  );
  return {
    ...created,
    reused: false,
  };
}

function updateMirrorDeployGuard(input = {}, patch = {}, options = {}) {
  const existing = readMirrorDeployGuard(input, options);
  const nowIso = new Date().toISOString();
  const next = {
    ...(existing.guard || {}),
    ...patch,
    updatedAt: nowIso,
  };
  if (!next.createdAt) {
    next.createdAt = nowIso;
  }
  return writeMirrorDeployGuard(input, next, options);
}

module.exports = {
  MIRROR_DEPLOY_GUARD_SCHEMA_VERSION,
  defaultMirrorDeployGuardDir,
  buildMirrorDeployGuardId,
  resolveMirrorDeployGuardFile,
  readMirrorDeployGuard,
  beginMirrorDeployGuard,
  updateMirrorDeployGuard,
  writeMirrorDeployGuard,
};
