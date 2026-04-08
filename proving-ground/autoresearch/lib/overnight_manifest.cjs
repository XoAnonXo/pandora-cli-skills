const fs = require('node:fs');
const path = require('node:path');

const {
  appendNdjson,
  ensureDir,
  nowIso,
  readJsonIfExists,
  sleep,
  writeJsonAtomic,
} = require('./baton_common.cjs');

const OVERNIGHT_MANIFEST_SCHEMA_VERSION = '1.0.0';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildOvernightManifestPaths(batchDir) {
  const rootDir = path.resolve(batchDir);
  return {
    rootDir,
    manifestPath: path.join(rootDir, 'manifest.json'),
    eventsPath: path.join(rootDir, 'events.ndjson'),
    lockPath: path.join(rootDir, '.manifest.lock'),
  };
}

function loadOvernightManifest(manifestPath) {
  const manifest = readJsonIfExists(manifestPath);
  if (!manifest) {
    throw new Error(`Overnight manifest not found: ${manifestPath}`);
  }
  return manifest;
}

async function withManifestLock(lockPath, fn, options = {}) {
  const timeoutMs = Math.max(100, Number(options.timeoutMs) || 10_000);
  const pollMs = Math.max(10, Number(options.pollMs) || 50);
  const startedAt = Date.now();
  ensureDir(path.dirname(lockPath));
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      break;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') {
        throw error;
      }
      if ((Date.now() - startedAt) >= timeoutMs) {
        throw new Error(`Timed out waiting for overnight manifest lock: ${lockPath}`);
      }
      await sleep(pollMs);
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

async function updateOvernightManifest(paths, mutate, options = {}) {
  return withManifestLock(paths.lockPath, async () => {
    const current = loadOvernightManifest(paths.manifestPath);
    const next = cloneJson(current);
    const result = await mutate(next);
    next.schemaVersion = OVERNIGHT_MANIFEST_SCHEMA_VERSION;
    next.updatedAt = nowIso();
    writeJsonAtomic(paths.manifestPath, next);
    return result === undefined ? next : result;
  }, options);
}

function createSurfaceRecord(options) {
  return {
    surfaceId: options.surfaceId,
    title: options.title,
    risk: options.risk,
    worktreePath: options.worktreePath,
    branchFamily: options.branchFamily,
    statusPath: options.statusPath,
    latestPath: options.latestPath,
    historyPath: options.historyPath,
    attemptsDir: options.attemptsDir,
    status: 'pending',
    attemptCount: 0,
    latestAttemptId: null,
    latestCommit: null,
    latestDecision: null,
    latestReasonCode: null,
    latestProofPath: null,
    latestHandoffPath: null,
    acceptedCommits: [],
    pendingAuditCommits: [],
    auditPending: false,
    lastError: null,
    frozen: false,
    cooled: false,
  };
}

function createOvernightManifest(options) {
  return {
    schemaVersion: OVERNIGHT_MANIFEST_SCHEMA_VERSION,
    batchId: options.batchId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    repoRoot: options.repoRoot,
    adapterPath: options.adapterPath,
    objectivePath: options.objectivePath,
    objectiveHash: options.objectiveHash,
    baseCommit: options.baseCommit,
    reportRoot: options.reportRoot,
    worktreeRoot: options.worktreeRoot,
    branchPrefix: options.branchPrefix,
    proposalMode: options.proposalMode || 'legacy',
    attemptLimit: Math.max(1, Number(options.attemptLimit) || 1),
    maxParallelWorkers: Math.max(1, Number(options.maxParallelWorkers) || 1),
    maxTotalAttempts: Number.isFinite(Number(options.maxTotalAttempts)) && Number(options.maxTotalAttempts) > 0
      ? Math.max(1, Math.floor(Number(options.maxTotalAttempts)))
      : null,
    status: 'running',
    ledger: [],
    promotion: {
      branchName: options.promotion.branchName,
      worktreePath: options.promotion.worktreePath,
      status: 'pending',
      latestCommit: null,
      validation: null,
      conflicts: [],
      promotedAt: null,
    },
    surfaces: options.surfaces.map((surface) => createSurfaceRecord(surface)),
  };
}

function appendOvernightEvent(paths, event) {
  return appendNdjson(paths.eventsPath, {
    time: nowIso(),
    ...event,
  });
}

function appendSurfaceHistory(surface, event) {
  return appendNdjson(surface.historyPath, {
    time: nowIso(),
    surfaceId: surface.surfaceId,
    ...event,
  });
}

function writeSurfaceStatus(surface, payload) {
  const state = {
    surfaceId: surface.surfaceId,
    title: surface.title,
    risk: surface.risk,
    status: surface.status,
    attemptCount: surface.attemptCount,
    latestAttemptId: surface.latestAttemptId,
    latestCommit: surface.latestCommit,
    latestDecision: surface.latestDecision,
    latestReasonCode: surface.latestReasonCode,
    auditPending: Boolean(surface.auditPending),
    pendingAuditCount: Array.isArray(surface.pendingAuditCommits) ? surface.pendingAuditCommits.length : 0,
    frozen: surface.frozen,
    cooled: surface.cooled,
    lastError: surface.lastError,
    ...payload,
  };
  writeJsonAtomic(surface.statusPath, state);
  writeJsonAtomic(surface.latestPath, state);
  return state;
}

module.exports = {
  OVERNIGHT_MANIFEST_SCHEMA_VERSION,
  appendOvernightEvent,
  appendSurfaceHistory,
  buildOvernightManifestPaths,
  createOvernightManifest,
  loadOvernightManifest,
  updateOvernightManifest,
  writeSurfaceStatus,
};
