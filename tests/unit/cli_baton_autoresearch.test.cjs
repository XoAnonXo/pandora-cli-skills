const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  archiveCliBatonLane,
  inspectCliBatonLatestHandoff,
  inspectCliBatonBatch,
  inspectCliBatonLane,
  pauseCliBatonBatch,
  promoteCliBatonBatch,
  requeueCliBatonLane,
  resumeCliBatonBatch,
  runCliBatonBatch,
} = require('../../proving-ground/lib/cli_baton_autoresearch.cjs');
const {
  buildManifestPaths,
  loadBatchManifest,
  updateBatchManifest,
} = require('../../proving-ground/lib/baton_manifest.cjs');
const { createTempDir, removeDir } = require('../helpers/cli_runner.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function copyFileIntoRepo(tempRepo, relativePath) {
  const sourcePath = path.join(REPO_ROOT, relativePath);
  const targetPath = path.join(tempRepo, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function buildFixtureConfig(options = {}) {
  const sectionCount = Math.max(1, Number(options.sectionCount) || 10);
  const sections = [];
  const commandDescriptors = {};
  const conflictLaneIds = Array.isArray(options.failureInjection && options.failureInjection.integrationConflictLaneIds)
    ? options.failureInjection.integrationConflictLaneIds
    : [];
  for (let index = 1; index <= sectionCount; index += 1) {
    const laneId = String(index).padStart(2, '0');
    const sectionId = `section-${laneId}`;
    const prefix = `cmd${laneId}`;
    const focusFile = conflictLaneIds.includes(`lane-${laneId}`)
      ? 'src/shared-conflict.cjs'
      : `src/${sectionId}.cjs`;
    commandDescriptors[`${prefix}.run`] = {
      command: `${prefix}.run`,
    };
    sections.push({
      id: sectionId,
      title: `Section ${laneId}`,
      description: `Synthetic section ${laneId}`,
      commandPrefixes: [prefix],
      focusFiles: [focusFile],
      helpCommands: ['node -e "process.stdout.write(\'help\\n\')"'],
      quickValidation: ['node -e "process.exit(0)"'],
      fullValidation: ['node -e "process.exit(0)"'],
      allowNeutralKeep: true,
    });
  }
  return {
    commandDescriptors,
    config: {
      schemaVersion: '1.0.0',
      reportDir: 'proving-ground/reports/cli-sections',
      commandDescriptorPath: 'sdk/generated/command-descriptors.json',
      model: {
        provider: 'minimax',
        apiKeyEnv: 'MINIMAX_API_KEY',
        model: 'MiniMax-M2.7-highspeed',
        baseUrl: 'https://api.minimax.io/v1',
        temperature: 0.2,
        reasoningSplit: true,
        timeoutMs: 120000,
        maxAttempts: 1,
        retryDelayMs: 0,
      },
      researchLoop: {
        goal: 'Test the baton control plane in a tiny synthetic repo.',
        mode: 'workspace',
        iterationsPerSection: 1,
        allowDirtyTree: false,
        maxSlowdownRatio: 1.02,
        finalValidation: ['node -e "process.exit(0)"'],
      },
      baton: {
        reportDir: 'proving-ground/reports/baton',
        laneCount: sectionCount,
        maxParallelWorkers: sectionCount,
        heartbeatTimeoutMs: 30000,
        cleanupPolicy: 'manual',
        pausePollMs: 100,
        ...(options.baton || {}),
      },
      worker: {
        timeBudgetMs: 30000,
        tokenBudget: 10000,
        oneAttempt: true,
        maxModelCalls: 1,
        promptVersion: 'baton-v1',
      },
      council: {
        roles: ['correctness', 'determinism', 'safety', 'performance', 'simplicity', 'goal-fit'],
        quorum: 4,
        reviseCap: 1,
        dedupe: true,
      },
      integration: {
        branchPrefix: 'codex/baton',
        mergeOrder: 'lane-index',
        promotionBranch: 'main',
        worktreeName: 'integration',
      },
      validation: {
        syntheticModel: true,
        syntheticCouncil: true,
        runRealWorktrees: true,
        failureInjection: options.failureInjection || {},
      },
      sections,
    },
  };
}

function createBatonFixtureRepo(options = {}) {
  const tempRepo = createTempDir('pandora-baton-fixture-');
  const filesToCopy = [
    'scripts/run_cli_baton_autoresearch.cjs',
    'proving-ground/autoresearch/scripts/run_cli_baton_autoresearch.cjs',
    'proving-ground/autoresearch/config/cli_section_research.cjs',
    'proving-ground/lib/baton_common.cjs',
    'proving-ground/lib/baton_manifest.cjs',
    'proving-ground/lib/baton_worktree_manager.cjs',
    'proving-ground/lib/baton_council.cjs',
    'proving-ground/lib/cli_baton_autoresearch.cjs',
    'proving-ground/lib/cli_section_autoresearch.cjs',
    'proving-ground/lib/autoresearch_loop.cjs',
    'proving-ground/lib/change_set_engine.cjs',
    'proving-ground/lib/minimax_client.cjs',
    'proving-ground/lib/scenario_family_loader.cjs',
    'proving-ground/autoresearch/lib/baton_common.cjs',
    'proving-ground/autoresearch/lib/baton_manifest.cjs',
    'proving-ground/autoresearch/lib/baton_worktree_manager.cjs',
    'proving-ground/autoresearch/lib/baton_council.cjs',
    'proving-ground/autoresearch/lib/cli_baton_autoresearch.cjs',
    'proving-ground/autoresearch/lib/cli_section_autoresearch.cjs',
    'proving-ground/autoresearch/lib/autoresearch_loop.cjs',
    'proving-ground/autoresearch/lib/change_set_engine.cjs',
    'proving-ground/autoresearch/lib/minimax_client.cjs',
    'proving-ground/autoresearch/lib/scenario_family_loader.cjs',
    'benchmarks/lib/simulation_world.cjs',
  ];
  filesToCopy.forEach((relativePath) => copyFileIntoRepo(tempRepo, relativePath));

  const { commandDescriptors, config } = buildFixtureConfig(options);
  const sectionCount = Math.max(1, Number(options.sectionCount) || 10);
  fs.mkdirSync(path.join(tempRepo, 'sdk', 'generated'), { recursive: true });
  fs.writeFileSync(
    path.join(tempRepo, 'sdk', 'generated', 'command-descriptors.json'),
    `${JSON.stringify(commandDescriptors, null, 2)}\n`,
    'utf8',
  );
  fs.mkdirSync(path.join(tempRepo, 'proving-ground', 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(tempRepo, 'proving-ground', 'config', 'cli_section_research.cjs'),
    `module.exports = ${JSON.stringify(config, null, 2)};\n`,
    'utf8',
  );
  for (let index = 1; index <= sectionCount; index += 1) {
    const laneId = String(index).padStart(2, '0');
    const fileName = (options.failureInjection && Array.isArray(options.failureInjection.integrationConflictLaneIds) && options.failureInjection.integrationConflictLaneIds.includes(`lane-${laneId}`))
      ? 'shared-conflict.cjs'
      : `section-${laneId}.cjs`;
    const filePath = path.join(tempRepo, 'src', fileName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(
        filePath,
        [
          `'use strict';`,
          '',
          `const value = '${fileName.replace('.cjs', '')}';`,
          '',
          'module.exports = {',
          '  value,',
          '};',
          '',
        ].join('\n'),
        'utf8',
      );
    }
  }

  const init = spawnSync('git', ['init', '-b', 'main'], { cwd: tempRepo, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: tempRepo, encoding: 'utf8' }).status, 0);
  const commit = spawnSync(
    'git',
    ['-c', 'user.name=Codex', '-c', 'user.email=codex@example.com', 'commit', '-m', 'snapshot'],
    { cwd: tempRepo, encoding: 'utf8' },
  );
  assert.equal(commit.status, 0, commit.stderr || commit.stdout);
  return tempRepo;
}

test('cli baton batch creates 10 lanes, runs two baton waves, and promotes accepted commits', async () => {
  const tempRepo = createBatonFixtureRepo();
  try {
    const batch = await runCliBatonBatch({
      cwd: tempRepo,
      configPath: 'proving-ground/config/cli_section_research.cjs',
      syntheticModel: true,
      syntheticCouncil: true,
      attemptsPerLane: 2,
    });
    const summary = inspectCliBatonBatch({ batchDir: batch.batchDir });
    assert.equal(summary.lanes.length, 10);
    assert.equal(summary.lanes.every((lane) => lane.attemptCount === 2), true);
    assert.equal(summary.lanes.every((lane) => lane.status === 'kept'), true);

    const lane = inspectCliBatonLane({ batchDir: batch.batchDir, laneId: 'lane-01' });
    assert.equal(lane.lane.attemptCount, 2);
    assert.equal(typeof lane.latestHandoff.batonId, 'string');
    assert.equal(lane.latestHandoff.parentBatonId !== null, true);
    const handoff = inspectCliBatonLatestHandoff({ batchDir: batch.batchDir, laneId: 'lane-01' });
    assert.equal(handoff.laneId, 'lane-01');

    const promotion = await promoteCliBatonBatch({
      batchDir: batch.batchDir,
    });
    assert.equal(promotion.ready, true);
    assert.equal(promotion.validation.summary.overallPass, true);
    assert.equal(promotion.pickedCommits.length, 20);

    const archived = await archiveCliBatonLane({
      batchDir: batch.batchDir,
      laneId: 'lane-01',
    });
    assert.equal(archived.lane.status, 'archived');
    assert.equal(fs.existsSync(archived.lane.worktreePath), false);
  } finally {
    removeDir(tempRepo);
  }
});

test('cli baton batch records failed, discarded, and requeued lanes during synthetic failure injection', async () => {
  const tempRepo = createBatonFixtureRepo({
    failureInjection: {
      malformedProposalLaneIds: ['lane-01'],
      rejectLaneIds: ['lane-02'],
      wrongLaneWriteLaneIds: ['lane-03'],
      integrationConflictLaneIds: ['lane-04', 'lane-05'],
    },
  });
  try {
    const batch = await runCliBatonBatch({
      cwd: tempRepo,
      configPath: 'proving-ground/config/cli_section_research.cjs',
      syntheticModel: true,
      syntheticCouncil: true,
      attemptsPerLane: 1,
    });
    const summary = inspectCliBatonBatch({ batchDir: batch.batchDir });
    const statuses = Object.fromEntries(summary.lanes.map((lane) => [lane.laneId, lane.status]));
    assert.equal(statuses['lane-01'], 'failed');
    assert.equal(statuses['lane-02'], 'discarded');
    assert.equal(statuses['lane-03'], 'failed');
    assert.equal(statuses['lane-04'], 'kept');
    assert.equal(statuses['lane-05'], 'kept');

    const lane2 = await requeueCliBatonLane({
      batchDir: batch.batchDir,
      laneId: 'lane-02',
    });
    assert.equal(lane2.lane.requeueRequested, true);

    const paused = await pauseCliBatonBatch({
      batchDir: batch.batchDir,
      reason: 'operator check',
    });
    assert.equal(paused.paused, true);
    const resumed = await resumeCliBatonBatch({
      batchDir: batch.batchDir,
    });
    assert.equal(resumed.paused, false);

    const promotion = await promoteCliBatonBatch({
      batchDir: batch.batchDir,
    });
    assert.equal(promotion.ready, false);
    assert.equal(promotion.conflicts.length > 0, true);
  } finally {
    removeDir(tempRepo);
  }
});

test('cli baton batch reclaims stale workers before issuing a fresh baton', async () => {
  const tempRepo = createBatonFixtureRepo();
  try {
    const batch = await runCliBatonBatch({
      cwd: tempRepo,
      configPath: 'proving-ground/config/cli_section_research.cjs',
      syntheticModel: true,
      syntheticCouncil: true,
      attemptsPerLane: 1,
    });
    const manifestPaths = buildManifestPaths(batch.batchDir);
    await updateBatchManifest(manifestPaths, (manifest) => {
      const lane = manifest.lanes.find((entry) => entry.laneId === 'lane-06');
      lane.status = 'running';
      lane.activeAttemptId = 'attempt-zombie';
      lane.workerPid = 999999;
      lane.claimToken = 'zombie-claim';
      lane.heartbeatAt = '2000-01-01T00:00:00.000Z';
      lane.lastError = null;
    });

    await runCliBatonBatch({
      cwd: tempRepo,
      configPath: 'proving-ground/config/cli_section_research.cjs',
      batchId: loadBatchManifest(manifestPaths.manifestPath).batchId,
      syntheticModel: true,
      syntheticCouncil: true,
      attemptsPerLane: 2,
      allowDirty: true,
    });

    const lane = inspectCliBatonLane({ batchDir: batch.batchDir, laneId: 'lane-06' });
    assert.equal(lane.lane.attemptCount, 2);
    assert.equal(lane.lane.status, 'kept');
    const history = fs.readFileSync(lane.lane.historyPath, 'utf8');
    assert.match(history, /lane-reclaimed/);
  } finally {
    removeDir(tempRepo);
  }
});

test('cli baton batch can fan out more lanes than sections and honor worker overrides', async () => {
  const tempRepo = createBatonFixtureRepo({
    sectionCount: 3,
    baton: {
      laneCount: 3,
      maxParallelWorkers: 3,
    },
  });
  try {
    const batch = await runCliBatonBatch({
      cwd: tempRepo,
      configPath: 'proving-ground/config/cli_section_research.cjs',
      syntheticModel: true,
      syntheticCouncil: true,
      attemptsPerLane: 1,
      laneCount: 8,
      maxParallelWorkers: 8,
    });
    const summary = inspectCliBatonBatch({ batchDir: batch.batchDir });
    assert.equal(summary.lanes.length, 8);
    assert.equal(summary.lanes.every((lane) => lane.status === 'kept'), true);

    const manifestPaths = buildManifestPaths(batch.batchDir);
    const manifest = loadBatchManifest(manifestPaths.manifestPath);
    assert.equal(manifest.maxParallelWorkers, 8);
    assert.equal(manifest.lanes.length, 8);

    const laneSectionIds = manifest.lanes.map((lane) => lane.sectionId);
    assert.deepEqual(
      laneSectionIds,
      ['section-01', 'section-02', 'section-03', 'section-01', 'section-02', 'section-03', 'section-01', 'section-02'],
    );
    assert.equal(manifest.lanes[3].title.includes('[Shard 2/3]'), true);
    assert.equal(manifest.lanes[6].title.includes('[Shard 3/3]'), true);
  } finally {
    removeDir(tempRepo);
  }
});
