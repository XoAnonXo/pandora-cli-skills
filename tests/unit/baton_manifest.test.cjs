const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  buildManifestPaths,
  createBatchManifest,
  findLane,
  loadBatchManifest,
  updateBatchManifest,
} = require('../../proving-ground/lib/baton_manifest.cjs');
const { createTempDir, removeDir } = require('../helpers/cli_runner.cjs');
const { writeJsonAtomic } = require('../../proving-ground/lib/baton_common.cjs');

test('baton manifest creates and updates lane records atomically', async () => {
  const tempDir = createTempDir('pandora-baton-manifest-');
  try {
    const batchDir = path.join(tempDir, 'proving-ground', 'reports', 'baton', 'batch-1');
    const manifestPaths = buildManifestPaths(batchDir);
    const manifest = createBatchManifest({
      batchId: 'batch-1',
      repoRoot: tempDir,
      goal: 'test',
      configSourcePath: path.join(tempDir, 'config.cjs'),
      configRelativePath: 'config.cjs',
      baseCommit: 'abc123',
      cleanupPolicy: 'manual',
      maxParallelWorkers: 2,
      worktreeRoot: path.join(tempDir, 'worktrees'),
      reportRoot: batchDir,
      integration: {
        branchName: 'codex/baton/batch-1/integration',
        worktreePath: path.join(tempDir, 'worktrees', 'integration'),
      },
      lanes: [
        {
          laneId: 'lane-01',
          laneIndex: 1,
          sectionId: 'alpha',
          title: 'Alpha',
          commandPrefixes: ['alpha'],
          focusFiles: ['src/alpha.cjs'],
          branchFamily: 'codex/baton/batch-1/lane-01',
          worktreePath: path.join(tempDir, 'worktrees', 'lane-01'),
          statusPath: path.join(batchDir, 'lanes', 'lane-01', 'status.json'),
          historyPath: path.join(batchDir, 'lanes', 'lane-01', 'history.ndjson'),
          latestPath: path.join(batchDir, 'lanes', 'lane-01', 'latest.json'),
          attemptsDir: path.join(batchDir, 'lanes', 'lane-01', 'attempts'),
        },
      ],
    });
    writeJsonAtomic(manifestPaths.manifestPath, manifest);

    await updateBatchManifest(manifestPaths, (next) => {
      const lane = findLane(next, 'lane-01');
      lane.status = 'running';
      lane.activeAttemptId = 'attempt-0001';
    });

    const loaded = loadBatchManifest(manifestPaths.manifestPath);
    const lane = findLane(loaded, 'lane-01');
    assert.equal(lane.status, 'running');
    assert.equal(lane.activeAttemptId, 'attempt-0001');
    assert.equal(Array.isArray(loaded.lanes), true);
  } finally {
    removeDir(tempDir);
  }
});
