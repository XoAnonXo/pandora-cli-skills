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

const BATON_MANIFEST_SCHEMA_VERSION = '1.0.0';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildManifestPaths(batchDir) {
  const rootDir = path.resolve(batchDir);
  const manifestPath = path.join(rootDir, 'manifest.json');
  const eventsPath = path.join(rootDir, 'events.ndjson');
  const lockPath = path.join(rootDir, '.manifest.lock');
  return {
    rootDir,
    manifestPath,
    eventsPath,
    lockPath,
  };
}

function loadBatchManifest(manifestPath) {
  const manifest = readJsonIfExists(manifestPath);
  if (!manifest) {
    throw new Error(`Batch manifest not found: ${manifestPath}`);
  }
  return manifest;
}

async function withManifestLock(lockPath, fn, options = {}) {
  const timeoutMs = Math.max(100, Number(options.timeoutMs) || 10_000);
  const pollMs = Math.max(10, Number(options.pollMs) || 50);
  const startedAt = Date.now();
  const lockDir = path.resolve(lockPath);
  ensureDir(path.dirname(lockDir));

  while (true) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') {
        throw error;
      }
      if ((Date.now() - startedAt) >= timeoutMs) {
        throw new Error(`Timed out waiting for manifest lock: ${lockDir}`);
      }
      await sleep(pollMs);
    }
  }

  try {
    return await fn();
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}

async function updateBatchManifest(paths, mutate, options = {}) {
  return withManifestLock(paths.lockPath, async () => {
    const current = loadBatchManifest(paths.manifestPath);
    const next = cloneJson(current);
    const result = await mutate(next);
    next.schemaVersion = BATON_MANIFEST_SCHEMA_VERSION;
    next.updatedAt = nowIso();
    writeJsonAtomic(paths.manifestPath, next);
    return result === undefined ? next : result;
  }, options);
}

function createLaneRecord(options) {
  return {
    laneId: options.laneId,
    laneIndex: options.laneIndex,
    sectionId: options.sectionId,
    title: options.title,
    commandPrefixes: Array.isArray(options.commandPrefixes) ? options.commandPrefixes.slice() : [],
    focusFiles: Array.isArray(options.focusFiles) ? options.focusFiles.slice() : [],
    branchFamily: options.branchFamily,
    worktreePath: options.worktreePath,
    statusPath: options.statusPath,
    historyPath: options.historyPath,
    latestPath: options.latestPath,
    attemptsDir: options.attemptsDir,
    status: 'pending',
    attemptCount: 0,
    requestedAttempts: 1,
    activeAttemptId: null,
    currentBranch: null,
    latestAttemptDir: null,
    latestHandoffPath: null,
    latestReportPath: null,
    latestDecision: null,
    latestCommit: null,
    acceptedCommits: [],
    requeueRequested: false,
    claimToken: null,
    workerPid: null,
    heartbeatAt: null,
    startedAt: null,
    finishedAt: null,
    lastError: null,
  };
}

function createBatchManifest(options) {
  return {
    schemaVersion: BATON_MANIFEST_SCHEMA_VERSION,
    batchId: options.batchId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    repoRoot: options.repoRoot,
    goal: options.goal,
    configSourcePath: options.configSourcePath,
    configRelativePath: options.configRelativePath,
    baseCommit: options.baseCommit,
    paused: false,
    pauseReason: null,
    cleanupPolicy: options.cleanupPolicy || 'manual',
    maxParallelWorkers: options.maxParallelWorkers,
    worktreeRoot: options.worktreeRoot,
    reportRoot: options.reportRoot,
    integration: {
      branchName: options.integration && options.integration.branchName,
      worktreePath: options.integration && options.integration.worktreePath,
      status: 'pending',
      latestCommit: null,
      lastError: null,
      promotedAt: null,
      validation: null,
    },
    lanes: options.lanes.map((lane) => createLaneRecord(lane)),
  };
}

function findLane(manifest, laneId) {
  return Array.isArray(manifest && manifest.lanes)
    ? manifest.lanes.find((lane) => lane.laneId === laneId) || null
    : null;
}

function markBatchEvent(paths, event) {
  return appendNdjson(paths.eventsPath, {
    time: nowIso(),
    ...event,
  });
}

function writeLaneStatus(lane, payload) {
  const next = {
    laneId: lane.laneId,
    title: lane.title,
    status: lane.status,
    attemptCount: lane.attemptCount,
    activeAttemptId: lane.activeAttemptId,
    latestDecision: lane.latestDecision,
    latestCommit: lane.latestCommit,
    workerPid: lane.workerPid,
    heartbeatAt: lane.heartbeatAt,
    startedAt: lane.startedAt,
    finishedAt: lane.finishedAt,
    lastError: lane.lastError,
    ...payload,
  };
  writeJsonAtomic(lane.statusPath, next);
  writeJsonAtomic(lane.latestPath, next);
  return next;
}

function appendLaneHistory(lane, event) {
  return appendNdjson(lane.historyPath, {
    time: nowIso(),
    laneId: lane.laneId,
    ...event,
  });
}

module.exports = {
  BATON_MANIFEST_SCHEMA_VERSION,
  appendLaneHistory,
  buildManifestPaths,
  createBatchManifest,
  findLane,
  loadBatchManifest,
  markBatchEvent,
  updateBatchManifest,
  withManifestLock,
  writeLaneStatus,
};
