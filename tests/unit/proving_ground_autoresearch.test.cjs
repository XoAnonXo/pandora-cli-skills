const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  buildAcceptedCommitMessage,
  buildInvalidProposalFallback,
  buildResearchHandoff,
  commitAcceptedIteration,
  extractFirstJsonObject,
  parseResearchProposal,
  runGitCommand,
  runAutoresearchLoop,
  runValidationPlan,
  summarizeScenarioFamily,
} = require('../../proving-ground/lib/autoresearch_loop.cjs');
const { applyChangeSet } = require('../../proving-ground/lib/change_set_engine.cjs');
const { loadScenarioFamily } = require('../../proving-ground/lib/scenario_family_loader.cjs');
const { createTempDir, removeDir } = require('../helpers/cli_runner.cjs');

test('summarizeScenarioFamily captures the proving-ground shape', () => {
  const family = loadScenarioFamily(path.resolve(__dirname, '..', '..', 'proving-ground', 'scenarios', 'daemon-in-loop', 'family.json'));
  const summary = summarizeScenarioFamily(family);

  assert.equal(summary.caseCount, 3);
  assert.equal(summary.totalExternalTradeCount, 6);
  assert.equal(summary.totalRestartCount, 1);
  assert.equal(summary.totalVenueResponseCount, 2);
  assert.equal(summary.maxRecoveryMs, 2500);
});

test('extractFirstJsonObject and parseResearchProposal handle fenced JSON', () => {
  const text = [
    '```json',
    JSON.stringify({
      hypothesisId: 'h1',
      summary: 'Trim one validator',
      why: 'Faster quick gate',
      targetFiles: ['package.json'],
      expectedImpact: {
        speed: 'Lower gate time',
        simplicity: 'Smaller loop',
        resilience: 'No runtime regression',
      },
      validationNotes: ['Run the quick gate again'],
      changeSet: [],
    }, null, 2),
    '```',
  ].join('\n');

  assert.match(extractFirstJsonObject(text), /"hypothesisId": "h1"/);
  const proposal = parseResearchProposal(text);
  assert.equal(proposal.hypothesisId, 'h1');
  assert.equal(proposal.validationNotes.length, 1);
});

test('runValidationPlan records passing and failing commands', () => {
  const plan = runValidationPlan([
    'node -e "process.exit(0)"',
    'node -e "process.exit(1)"',
  ], path.resolve(__dirname, '..', '..'));

  assert.equal(plan.summary.commandCount, 2);
  assert.equal(plan.summary.failedCount, 1);
  assert.equal(plan.summary.overallPass, false);
});

test('buildResearchHandoff includes model usage when present', () => {
  const report = {
    runId: 'pg-test',
    simulation: {
      familyId: 'daemon-in-loop',
      caseCount: 3,
      totalExternalTradeCount: 5,
      totalRestartCount: 1,
    },
    baseline: {
      quick: { summary: { overallPass: true, totalElapsedMs: 120, commandCount: 2 } },
      full: { summary: { overallPass: true, totalElapsedMs: 320, commandCount: 2, passRate: 1 } },
    },
    iterations: [{
      outcome: 'proposal-only',
      proposal: {
        summary: 'Shrink the quick gate',
        validationNotes: ['Re-run full gate after change'],
      },
      decision: { keep: false },
      model: {
        model: 'MiniMax-M2.7-highspeed',
        elapsedMs: 300,
        usage: {
          prompt_tokens: 20,
          completion_tokens: 10,
          total_tokens: 30,
        },
      },
    }],
  };

  const handoff = buildResearchHandoff(report);
  assert.match(handoff, /MiniMax-M2\.7-highspeed/);
  assert.match(handoff, /Tokens: 30 total/);
});

test('buildInvalidProposalFallback keeps the loop in a safe no-change shape', () => {
  const proposal = buildInvalidProposalFallback('Bad JSON');
  assert.equal(proposal.hypothesisId, 'invalid-proposal');
  assert.equal(proposal.changeSet.length, 0);
  assert.match(proposal.summary, /invalid JSON proposal/i);
});

test('commitAcceptedIteration stages a kept change into a durable git checkpoint', () => {
  const tempDir = createTempDir('pandora-autoresearch-commit-');
  const targetPath = path.join(tempDir, 'focus.txt');
  fs.writeFileSync(targetPath, 'slow\n', 'utf8');

  try {
    const init = runGitCommand(tempDir, ['init', '-b', 'main']);
    assert.equal(init.exitCode, 0, init.stderr || init.stdout);
    assert.equal(runGitCommand(tempDir, ['add', '-A']).exitCode, 0);
    const firstCommit = runGitCommand(tempDir, [
      '-c', 'user.name=Codex',
      '-c', 'user.email=codex@example.com',
      'commit',
      '-m', 'snapshot',
    ]);
    assert.equal(firstCommit.exitCode, 0, firstCommit.stderr || firstCommit.stdout);

    const appliedChangeSet = applyChangeSet([
      {
        kind: 'replace_once',
        path: 'focus.txt',
        match: 'slow\n',
        replace: 'fast\n',
      },
    ], { cwd: tempDir });
    const iteration = {
      index: 1,
      proposal: {
        hypothesisId: 'speed-up-focus-file',
        summary: 'Switch the flag to fast mode',
      },
    };
    const commit = commitAcceptedIteration({
      cwd: tempDir,
      iteration,
      appliedChangeSet,
    });

    assert.equal(commit.skipped, false);
    assert.match(commit.message, /speed-up-focus-file/);
    assert.equal(fs.readFileSync(targetPath, 'utf8'), 'fast\n');
    const head = runGitCommand(tempDir, ['log', '--oneline', '-1']);
    assert.equal(head.exitCode, 0, head.stderr || head.stdout);
    assert.match(head.stdout, /autoresearch: speed-up-focus-file - Switch the flag to fast mode/);
  } finally {
    removeDir(tempDir);
  }
});

test('runAutoresearchLoop marks invalid workspace change sets as discarded evidence instead of crashing', async () => {
  const tempDir = createTempDir('pandora-autoresearch-invalid-change-set-');
  const configDir = path.join(tempDir, 'proving-ground', 'config');
  const scenariosDir = path.join(tempDir, 'proving-ground', 'scenarios', 'daemon-in-loop');
  const focusFile = path.join(tempDir, 'proving-ground', 'lib', 'focus-target.txt');
  const mockResponsePath = path.join(tempDir, 'mock-response.json');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(path.dirname(focusFile), { recursive: true });
  fs.mkdirSync(scenariosDir, { recursive: true });
  fs.copyFileSync(
    path.resolve(__dirname, '..', '..', 'proving-ground', 'scenarios', 'daemon-in-loop', 'family.json'),
    path.join(scenariosDir, 'family.json'),
  );
  fs.writeFileSync(focusFile, 'alpha\nbeta\n', 'utf8');
  fs.writeFileSync(
    path.join(configDir, 'proving-ground.example.json'),
    JSON.stringify({
      schemaVersion: '1.0.0',
      suite: 'daemon-in-loop',
      defaultFamilyPath: 'proving-ground/scenarios/daemon-in-loop/family.json',
      reportDir: 'proving-ground/reports',
      model: {
        provider: 'minimax',
        apiKeyEnv: 'MINIMAX_API_KEY',
        model: 'MiniMax-M2.7-highspeed',
      },
      researchLoop: {
        goal: 'Reject invalid patch proposals safely.',
        mode: 'workspace',
        maxIterations: 1,
        allowDirtyTree: false,
        focusFiles: ['proving-ground/lib/focus-target.txt'],
        quickValidation: ['node -e "process.exit(0)"'],
        fullValidation: ['node -e "process.exit(0)"'],
      },
    }, null, 2),
    'utf8',
  );
  fs.writeFileSync(
    mockResponsePath,
    JSON.stringify({
      hypothesisId: 'bad-anchor',
      summary: 'Broken exact-text patch',
      why: 'Exercise invalid change set handling.',
      targetFiles: ['proving-ground/lib/focus-target.txt'],
      expectedImpact: {
        speed: 'n/a',
        simplicity: 'n/a',
        resilience: 'The loop should not crash.',
      },
      validationNotes: ['Keep the report even when the patch is invalid.'],
      changeSet: [
        {
          kind: 'replace_once',
          path: 'proving-ground/lib/focus-target.txt',
          match: 'this text does not exist',
          replace: 'replacement',
        },
      ],
    }, null, 2),
    'utf8',
  );

  try {
    const init = spawnSync('git', ['init', '-b', 'main'], { cwd: tempDir, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr || init.stdout);
    assert.equal(spawnSync('git', ['add', '-A'], { cwd: tempDir, encoding: 'utf8' }).status, 0);
    const commit = spawnSync(
      'git',
      ['-c', 'user.name=Codex', '-c', 'user.email=codex@example.com', 'commit', '-m', 'snapshot'],
      { cwd: tempDir, encoding: 'utf8' },
    );
    assert.equal(commit.status, 0, commit.stderr || commit.stdout);

    const report = await runAutoresearchLoop({
      cwd: tempDir,
      configPath: 'proving-ground/config/proving-ground.example.json',
      mode: 'workspace',
      maxIterations: 1,
      mockResponsePath: 'mock-response.json',
    });

    assert.equal(report.iterations.length, 1);
    assert.equal(report.iterations[0].outcome, 'invalid-change-set');
    assert.equal(report.iterations[0].decision.keep, false);
    assert.match(report.iterations[0].applyError.message, /could not find match/i);
    assert.equal(fs.readFileSync(focusFile, 'utf8'), 'alpha\nbeta\n');
    assert.equal(typeof report.artifacts.reportPath, 'string');
    assert.equal(fs.existsSync(report.artifacts.reportPath), true);
    assert.equal(fs.existsSync(report.artifacts.handoffPath), true);
  } finally {
    removeDir(tempDir);
  }
});

test('runAutoresearchLoop records malformed model JSON as invalid-proposal instead of crashing', async () => {
  const tempDir = createTempDir('pandora-autoresearch-invalid-proposal-');
  const configDir = path.join(tempDir, 'proving-ground', 'config');
  const scenariosDir = path.join(tempDir, 'proving-ground', 'scenarios', 'daemon-in-loop');
  const focusFile = path.join(tempDir, 'proving-ground', 'lib', 'focus-target.txt');
  const mockResponsePath = path.join(tempDir, 'mock-response.txt');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(path.dirname(focusFile), { recursive: true });
  fs.mkdirSync(scenariosDir, { recursive: true });
  fs.copyFileSync(
    path.resolve(__dirname, '..', '..', 'proving-ground', 'scenarios', 'daemon-in-loop', 'family.json'),
    path.join(scenariosDir, 'family.json'),
  );
  fs.writeFileSync(focusFile, 'alpha\nbeta\n', 'utf8');
  fs.writeFileSync(
    path.join(configDir, 'proving-ground.example.json'),
    JSON.stringify({
      schemaVersion: '1.0.0',
      suite: 'daemon-in-loop',
      defaultFamilyPath: 'proving-ground/scenarios/daemon-in-loop/family.json',
      reportDir: 'proving-ground/reports',
      model: {
        provider: 'minimax',
        apiKeyEnv: 'MINIMAX_API_KEY',
        model: 'MiniMax-M2.7-highspeed',
      },
      researchLoop: {
        goal: 'Reject malformed proposals safely.',
        mode: 'proposal',
        maxIterations: 1,
        allowDirtyTree: false,
        focusFiles: ['proving-ground/lib/focus-target.txt'],
        quickValidation: ['node -e "process.exit(0)"'],
        fullValidation: ['node -e "process.exit(0)"'],
      },
    }, null, 2),
    'utf8',
  );
  fs.writeFileSync(
    mockResponsePath,
    '{"hypothesisId":"bad","summary":"oops \u0001 broken","validationNotes":[],"changeSet":[]}',
    'utf8',
  );

  try {
    const init = spawnSync('git', ['init', '-b', 'main'], { cwd: tempDir, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr || init.stdout);
    assert.equal(spawnSync('git', ['add', '-A'], { cwd: tempDir, encoding: 'utf8' }).status, 0);
    const commit = spawnSync(
      'git',
      ['-c', 'user.name=Codex', '-c', 'user.email=codex@example.com', 'commit', '-m', 'snapshot'],
      { cwd: tempDir, encoding: 'utf8' },
    );
    assert.equal(commit.status, 0, commit.stderr || commit.stdout);

    const report = await runAutoresearchLoop({
      cwd: tempDir,
      configPath: 'proving-ground/config/proving-ground.example.json',
      mode: 'proposal',
      maxIterations: 1,
      mockResponsePath: 'mock-response.txt',
    });

    assert.equal(report.iterations.length, 1);
    assert.equal(report.iterations[0].outcome, 'invalid-proposal');
    assert.equal(report.iterations[0].decision.keep, false);
    assert.match(report.iterations[0].parseError.message, /JSON/i);
    assert.equal(report.iterations[0].proposal.changeSet.length, 0);
    assert.equal(fs.existsSync(report.artifacts.reportPath), true);
    assert.equal(fs.existsSync(report.artifacts.handoffPath), true);
  } finally {
    removeDir(tempDir);
  }
});

test('runAutoresearchLoop records model transport failures and keeps going', async () => {
  const tempDir = createTempDir('pandora-autoresearch-model-error-');
  const configDir = path.join(tempDir, 'proving-ground', 'config');
  const scenariosDir = path.join(tempDir, 'proving-ground', 'scenarios', 'daemon-in-loop');
  const focusFile = path.join(tempDir, 'proving-ground', 'lib', 'focus-target.txt');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(path.dirname(focusFile), { recursive: true });
  fs.mkdirSync(scenariosDir, { recursive: true });
  fs.copyFileSync(
    path.resolve(__dirname, '..', '..', 'proving-ground', 'scenarios', 'daemon-in-loop', 'family.json'),
    path.join(scenariosDir, 'family.json'),
  );
  fs.writeFileSync(focusFile, 'alpha\nbeta\n', 'utf8');
  fs.writeFileSync(
    path.join(configDir, 'proving-ground.example.json'),
    JSON.stringify({
      schemaVersion: '1.0.0',
      suite: 'daemon-in-loop',
      defaultFamilyPath: 'proving-ground/scenarios/daemon-in-loop/family.json',
      reportDir: 'proving-ground/reports',
      model: {
        provider: 'minimax',
        apiKeyEnv: 'MINIMAX_API_KEY',
        model: 'MiniMax-M2.7-highspeed',
        maxAttempts: 3,
        retryDelayMs: 0,
      },
      researchLoop: {
        goal: 'Record model transport failures safely.',
        mode: 'proposal',
        maxIterations: 1,
        allowDirtyTree: false,
        focusFiles: ['proving-ground/lib/focus-target.txt'],
        quickValidation: ['node -e "process.exit(0)"'],
        fullValidation: ['node -e "process.exit(0)"'],
      },
    }, null, 2),
    'utf8',
  );

  try {
    const init = spawnSync('git', ['init', '-b', 'main'], { cwd: tempDir, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr || init.stdout);
    assert.equal(spawnSync('git', ['add', '-A'], { cwd: tempDir, encoding: 'utf8' }).status, 0);
    const commit = spawnSync(
      'git',
      ['-c', 'user.name=Codex', '-c', 'user.email=codex@example.com', 'commit', '-m', 'snapshot'],
      { cwd: tempDir, encoding: 'utf8' },
    );
    assert.equal(commit.status, 0, commit.stderr || commit.stdout);

    const report = await runAutoresearchLoop({
      cwd: tempDir,
      configPath: 'proving-ground/config/proving-ground.example.json',
      mode: 'proposal',
      maxIterations: 1,
      modelLoader: async () => {
        throw new Error('fetch failed');
      },
    });

    assert.equal(report.iterations.length, 1);
    assert.equal(report.iterations[0].outcome, 'model-error');
    assert.equal(report.iterations[0].decision.keep, false);
    assert.equal(report.iterations[0].decision.reason, 'model-call-failed');
    assert.equal(report.iterations[0].model.attempts.length, 3);
    assert.match(report.iterations[0].modelError.message, /fetch failed/i);
    assert.equal(fs.existsSync(report.artifacts.reportPath), true);
    assert.equal(fs.existsSync(report.artifacts.handoffPath), true);
  } finally {
    removeDir(tempDir);
  }
});

test('runAutoresearchLoop commits a kept workspace mutation when it improves the gate', async () => {
  const tempDir = createTempDir('pandora-autoresearch-keep-');
  const configDir = path.join(tempDir, 'proving-ground', 'config');
  const scenariosDir = path.join(tempDir, 'proving-ground', 'scenarios', 'daemon-in-loop');
  const focusFile = path.join(tempDir, 'proving-ground', 'lib', 'focus-target.txt');
  const mockResponsePath = path.join(tempDir, 'mock-response.json');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(path.dirname(focusFile), { recursive: true });
  fs.mkdirSync(scenariosDir, { recursive: true });
  fs.copyFileSync(
    path.resolve(__dirname, '..', '..', 'proving-ground', 'scenarios', 'daemon-in-loop', 'family.json'),
    path.join(scenariosDir, 'family.json'),
  );
  fs.writeFileSync(focusFile, 'mode=slow\n', 'utf8');

  const timingCommand = [
    'node -e',
    JSON.stringify(
      "const fs=require('fs'); const text=fs.readFileSync('proving-ground/lib/focus-target.txt','utf8'); const wait=text.includes('mode=slow') ? 120 : 1; const end=Date.now()+wait; while (Date.now()<end) {}"
    ),
  ].join(' ');

  fs.writeFileSync(
    path.join(configDir, 'proving-ground.example.json'),
    JSON.stringify({
      schemaVersion: '1.0.0',
      suite: 'daemon-in-loop',
      defaultFamilyPath: 'proving-ground/scenarios/daemon-in-loop/family.json',
      reportDir: 'proving-ground/reports',
      model: {
        provider: 'minimax',
        apiKeyEnv: 'MINIMAX_API_KEY',
        model: 'MiniMax-M2.7-highspeed',
      },
      researchLoop: {
        goal: 'Keep faster workspace mutations.',
        mode: 'workspace',
        maxIterations: 1,
        allowDirtyTree: false,
        maxSlowdownRatio: 1.02,
        focusFiles: ['proving-ground/lib/focus-target.txt'],
        quickValidation: [timingCommand],
        fullValidation: [timingCommand],
      },
    }, null, 2),
    'utf8',
  );

  fs.writeFileSync(
    mockResponsePath,
    JSON.stringify({
      hypothesisId: 'fast-flag',
      summary: 'Switch focus target to fast mode',
      why: 'The validation command runs faster when the file is in fast mode.',
      targetFiles: ['proving-ground/lib/focus-target.txt'],
      expectedImpact: {
        speed: 'Faster gate runtime.',
        simplicity: 'No structural change.',
        resilience: 'No behavioral regression.',
      },
      validationNotes: ['Confirm the validation gate is faster after the change.'],
      changeSet: [
        {
          kind: 'replace_once',
          path: 'proving-ground/lib/focus-target.txt',
          match: 'mode=slow\n',
          replace: 'mode=fast\n',
        },
      ],
    }, null, 2),
    'utf8',
  );

  try {
    const init = spawnSync('git', ['init', '-b', 'main'], { cwd: tempDir, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr || init.stdout);
    assert.equal(spawnSync('git', ['add', '-A'], { cwd: tempDir, encoding: 'utf8' }).status, 0);
    const commit = spawnSync(
      'git',
      ['-c', 'user.name=Codex', '-c', 'user.email=codex@example.com', 'commit', '-m', 'snapshot'],
      { cwd: tempDir, encoding: 'utf8' },
    );
    assert.equal(commit.status, 0, commit.stderr || commit.stdout);

    const report = await runAutoresearchLoop({
      cwd: tempDir,
      configPath: 'proving-ground/config/proving-ground.example.json',
      mode: 'workspace',
      maxIterations: 1,
      mockResponsePath: 'mock-response.json',
    });

    assert.equal(report.iterations.length, 1);
    assert.equal(report.iterations[0].outcome, 'kept');
    assert.equal(report.iterations[0].decision.keep, true);
    assert.equal(report.iterations[0].proposal.hypothesisId, 'fast-flag');
    assert.equal(report.iterations[0].commit.skipped, false);
    assert.match(report.iterations[0].commit.message, /fast-flag/);
    assert.equal(fs.readFileSync(focusFile, 'utf8'), 'mode=fast\n');
    const head = spawnSync('git', ['log', '--oneline', '-1'], { cwd: tempDir, encoding: 'utf8' });
    assert.equal(head.status, 0, head.stderr || head.stdout);
    assert.match(head.stdout, /autoresearch: fast-flag - Switch focus target to fast mode/);
  } finally {
    removeDir(tempDir);
  }
});
