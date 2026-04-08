const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  promoteOvernightBatch,
  resolveDeferredAudit,
  runOvernightBatch,
  runSurfaceAttempt,
} = require('../../proving-ground/lib/overnight_engine.cjs');
const { loadOvernightAdapter, findSurface } = require('../../proving-ground/lib/overnight_adapter.cjs');
const { buildOvernightManifestPaths, loadOvernightManifest } = require('../../proving-ground/lib/overnight_manifest.cjs');
const { loadOvernightObjective } = require('../../proving-ground/lib/overnight_objective.cjs');
const { buildTargetWindow, mineSurfaceCandidates, parsePlannerResponse } = require('../../proving-ground/lib/overnight_staged.cjs');
const { writeYamlFile } = require('../../proving-ground/lib/overnight_yaml.cjs');

function writeFixtureRepo(rootDir) {
  fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'tests', 'unit'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'src', 'calc.cjs'), [
    'function sanitizeCount(value) {',
    '  if (!Number.isFinite(value)) return 0;',
    '  return value < 0 ? 0 : value;',
    '}',
    '',
    'module.exports = { sanitizeCount };',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(rootDir, 'tests', 'unit', 'calc.test.cjs'), [
    "const test = require('node:test');",
    "const assert = require('node:assert/strict');",
    "const { sanitizeCount } = require('../../src/calc.cjs');",
    '',
    "test('sanitizeCount floors negatives', () => {",
    '  assert.equal(sanitizeCount(-5), 0);',
    '  assert.equal(sanitizeCount(9), 9);',
    '});',
    '',
  ].join('\n'));
  writeYamlFile(path.join(rootDir, 'overnight.yaml'), {
    repo: {
      name: 'fixture',
      setup: 'npm install',
      baseline_validation: ['node --test tests/unit/calc.test.cjs'],
      final_validation: ['node --test tests/unit/calc.test.cjs'],
    },
    surfaces: [
      {
        id: 'core',
        title: 'Core',
        description: 'Small safe fixture surface.',
        paths: ['src/calc.cjs'],
        test_paths: ['tests/unit/calc.test.cjs'],
        invariants: ['sanitizeCount must stay deterministic'],
        risk: 'guarded',
        required_test_kinds: ['regression'],
        context_patterns: [],
        allowed_dependencies: [],
        forbidden_paths: [],
        quick_validation: ['node --test tests/unit/calc.test.cjs'],
        full_validation: ['node --test tests/unit/calc.test.cjs'],
      },
    ],
    manual_only_paths: [],
    shared_paths: [],
    defaults: {
      report_dir: 'reports/overnight',
      branch_prefix: 'codex/overnight',
      attempt_limit: 1,
      repair_turns: 1,
      proposal_mode: 'legacy',
      staged: {
        max_source_files: 1,
        max_test_files: 1,
        max_code_blocks: 1,
        max_test_blocks: 1,
        window_line_cap: 120,
      },
      proposer: {
        provider: 'minimax',
        model: 'synthetic',
      },
      audit: {
        provider: 'auto',
      },
    },
  });
  writeYamlFile(path.join(rootDir, 'objective.yaml'), {
    goal: 'Add an upper bound to sanitizeCount safely.',
    allowed_surfaces: ['core'],
    success: ['sanitizeCount caps very large counts at 100'],
    required_tests: ['regression'],
    stop_conditions: ['would require touching another surface'],
    evidence: ['large counters should stay bounded'],
    priority: 'medium',
  });
  execFileSync('git', ['init'], { cwd: rootDir, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: rootDir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'], {
    cwd: rootDir,
    stdio: 'ignore',
  });
}

function writeParallelFixtureRepo(rootDir) {
  fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'tests', 'unit'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'src', 'calc_a.cjs'), [
    'function sanitizeCountA(value) {',
    '  if (!Number.isFinite(value)) return 0;',
    '  return value < 0 ? 0 : value;',
    '}',
    '',
    'module.exports = { sanitizeCountA };',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(rootDir, 'src', 'calc_b.cjs'), [
    'function sanitizeCountB(value) {',
    '  if (!Number.isFinite(value)) return 0;',
    '  return value < 0 ? 0 : value;',
    '}',
    '',
    'module.exports = { sanitizeCountB };',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(rootDir, 'tests', 'unit', 'calc_a.test.cjs'), [
    "const test = require('node:test');",
    "const assert = require('node:assert/strict');",
    "const { sanitizeCountA } = require('../../src/calc_a.cjs');",
    '',
    "test('sanitizeCountA floors negatives', () => {",
    '  assert.equal(sanitizeCountA(-5), 0);',
    '  assert.equal(sanitizeCountA(9), 9);',
    '});',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(rootDir, 'tests', 'unit', 'calc_b.test.cjs'), [
    "const test = require('node:test');",
    "const assert = require('node:assert/strict');",
    "const { sanitizeCountB } = require('../../src/calc_b.cjs');",
    '',
    "test('sanitizeCountB floors negatives', () => {",
    '  assert.equal(sanitizeCountB(-5), 0);',
    '  assert.equal(sanitizeCountB(9), 9);',
    '});',
    '',
  ].join('\n'));
  writeYamlFile(path.join(rootDir, 'overnight.yaml'), {
    repo: {
      name: 'parallel-fixture',
      setup: 'npm install',
      baseline_validation: ['node --test tests/unit/calc_a.test.cjs tests/unit/calc_b.test.cjs'],
      final_validation: ['node --test tests/unit/calc_a.test.cjs tests/unit/calc_b.test.cjs'],
    },
    surfaces: [
      {
        id: 'core-a',
        title: 'Core A',
        description: 'Parallel surface A.',
        paths: ['src/calc_a.cjs'],
        test_paths: ['tests/unit/calc_a.test.cjs'],
        invariants: ['sanitizeCountA must stay deterministic'],
        risk: 'guarded',
        required_test_kinds: ['regression'],
        context_patterns: [],
        allowed_dependencies: [],
        forbidden_paths: [],
        quick_validation: ['node --test tests/unit/calc_a.test.cjs tests/unit/calc_b.test.cjs'],
        full_validation: ['node --test tests/unit/calc_a.test.cjs tests/unit/calc_b.test.cjs'],
      },
      {
        id: 'core-b',
        title: 'Core B',
        description: 'Parallel surface B.',
        paths: ['src/calc_b.cjs'],
        test_paths: ['tests/unit/calc_b.test.cjs'],
        invariants: ['sanitizeCountB must stay deterministic'],
        risk: 'guarded',
        required_test_kinds: ['regression'],
        context_patterns: [],
        allowed_dependencies: [],
        forbidden_paths: [],
        quick_validation: ['node --test tests/unit/calc_a.test.cjs tests/unit/calc_b.test.cjs'],
        full_validation: ['node --test tests/unit/calc_a.test.cjs tests/unit/calc_b.test.cjs'],
      },
    ],
    manual_only_paths: [],
    shared_paths: [],
    defaults: {
      report_dir: 'reports/overnight',
      branch_prefix: 'codex/overnight',
      attempt_limit: 1,
      max_parallel_workers: 2,
      repair_turns: 1,
      proposal_mode: 'legacy',
      proposer: {
        provider: 'minimax',
        model: 'synthetic',
      },
      audit: {
        provider: 'auto',
      },
    },
  });
  writeYamlFile(path.join(rootDir, 'objective.yaml'), {
    goal: 'Clamp both sanitizers safely.',
    allowed_surfaces: ['core-a', 'core-b'],
    success: ['both sanitizers cap very large counts at 100'],
    required_tests: ['regression'],
    stop_conditions: ['would require touching another surface'],
    evidence: ['large counters should stay bounded'],
    priority: 'medium',
  });
  execFileSync('git', ['init'], { cwd: rootDir, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: rootDir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'], {
    cwd: rootDir,
    stdio: 'ignore',
  });
}

function buildAcceptedLegacyProposal(sourcePath, sourceSearch, testPath, testSearch, functionName) {
  return {
    logical_explanation: {
      problem: 'Clamp sanitizer at 100 so counters stay bounded.',
      why_this_surface: 'The sanitizer and its paired regression live in the same surface.',
      invariants_preserved: ['sanitizer stays deterministic'],
      why_this_is_bounded: 'One source edit plus one regression test.',
      residual_risks: [],
    },
    code_changes: [
      {
        path: sourcePath,
        search: sourceSearch,
        replace: '  if (value > 100) return 100;\n  return value < 0 ? 0 : value;',
        context_before: '  if (!Number.isFinite(value)) return 0;\n',
        context_after: '\n}\n',
      },
    ],
    test_changes: [
      {
        path: testPath,
        search: testSearch,
        replace: `${testSearch}\n  assert.equal(${functionName}(400), 100);`,
        context_before: '',
        context_after: '\n});',
      },
    ],
  };
}

function acceptedProposalLoader() {
  return {
    provider: 'synthetic',
    model: 'synthetic-worker',
    usage: {},
    elapsedMs: 0,
    text: JSON.stringify({
      logical_explanation: {
        problem: 'Clamp sanitizeCount at 100 so counters stay bounded.',
        why_this_surface: 'The count sanitizer lives in src/calc.cjs and the proof lives beside it in the unit test.',
        invariants_preserved: ['sanitizeCount stays deterministic'],
        why_this_is_bounded: 'One small production change plus one regression test.',
        residual_risks: [],
      },
      code_changes: [
        {
          path: 'src/calc.cjs',
          search: '  return value < 0 ? 0 : value;',
          replace: '  if (value > 100) return 100;\n  return value < 0 ? 0 : value;',
          context_before: '  if (!Number.isFinite(value)) return 0;\n',
          context_after: '\n}\n',
        },
      ],
      test_changes: [
        {
          path: 'tests/unit/calc.test.cjs',
          search: "  assert.equal(sanitizeCount(9), 9);",
          replace: "  assert.equal(sanitizeCount(9), 9);\n  assert.equal(sanitizeCount(400), 100);",
          context_before: "test('sanitizeCount floors negatives', () => {\n  assert.equal(sanitizeCount(-5), 0);\n",
          context_after: '\n});',
        },
      ],
    }),
  };
}

function codeOnlyProposalLoader() {
  return {
    provider: 'synthetic',
    model: 'synthetic-worker',
    usage: {},
    elapsedMs: 0,
    text: JSON.stringify({
      logical_explanation: {
        problem: 'Change sanitizeCount without tests.',
        why_this_surface: 'It is local.',
        invariants_preserved: ['sanitizeCount stays deterministic'],
        why_this_is_bounded: 'One edit.',
        residual_risks: ['missing test proof'],
      },
      code_changes: [
        {
          path: 'src/calc.cjs',
          search: '  return value < 0 ? 0 : value;',
          replace: '  return Math.max(0, value);',
          context_before: '  if (!Number.isFinite(value)) return 0;\n',
          context_after: '\n}\n',
        },
      ],
      test_changes: [],
    }),
  };
}

function acceptAudit() {
  return {
    verdict: 'accept',
    confidence: 1,
    blockers: [],
    evidence: ['Synthetic audit accepted the bounded change.'],
    provider: 'synthetic',
    model: 'synthetic-audit',
  };
}

function rejectAudit() {
  return {
    verdict: 'reject',
    confidence: 1,
    blockers: ['Synthetic audit rejected the bounded change.'],
    evidence: ['Synthetic audit rejected the bounded change.'],
    provider: 'synthetic',
    model: 'synthetic-audit',
  };
}

function deferredAudit() {
  return {
    verdict: 'deferred',
    confidence: 1,
    blockers: ['Deferred to Codex review.'],
    evidence: ['Synthetic audit deferred this change for Codex review.'],
    provider: 'deferred',
    model: null,
  };
}

function throwingProposalLoader() {
  throw new Error('synthetic proposal failure');
}

function repairDropsTestsProposalLoader({ prompt }) {
  if (String(prompt && prompt.userPrompt || '').includes('Repair the previous proposal')) {
    return {
      provider: 'synthetic',
      model: 'synthetic-worker',
      usage: {},
      elapsedMs: 0,
      text: JSON.stringify({
        logical_explanation: {
          problem: 'Repair removed the tests even though the source change stayed.',
          why_this_surface: 'Still local to the core surface.',
          invariants_preserved: ['sanitizeCount stays deterministic'],
          why_this_is_bounded: 'One source edit only.',
          residual_risks: ['missing tests after repair'],
        },
        code_changes: [
          {
            path: 'src/calc.cjs',
            search: '  return value < 0 ? 0 : value;',
            replace: '  return Math.max(0, value);',
            context_before: '  if (!Number.isFinite(value)) return 0;\n',
            context_after: '\n}\n',
          },
        ],
        test_changes: [],
      }),
    };
  }
  return {
    provider: 'synthetic',
    model: 'synthetic-worker',
    usage: {},
    elapsedMs: 0,
    text: JSON.stringify({
      logical_explanation: {
        problem: 'Initial proposal uses a brittle SEARCH block but includes the needed test.',
        why_this_surface: 'The calc file and its test are both in the same surface.',
        invariants_preserved: ['sanitizeCount stays deterministic'],
        why_this_is_bounded: 'One source edit plus one regression test.',
        residual_risks: [],
      },
      code_changes: [
        {
          path: 'src/calc.cjs',
          search: '  return value < 0 ? 0 : value;\n// missing anchor',
          replace: '  return Math.max(0, value);',
          context_before: '  if (!Number.isFinite(value)) return 0;\n',
          context_after: '\n}\n',
        },
      ],
      test_changes: [
        {
          path: 'tests/unit/calc.test.cjs',
          search: "  assert.equal(sanitizeCount(9), 9);",
          replace: "  assert.equal(sanitizeCount(9), 9);\n  assert.equal(sanitizeCount(400), 100);",
          context_before: "test('sanitizeCount floors negatives', () => {\n  assert.equal(sanitizeCount(-5), 0);\n",
          context_after: '\n});',
        },
      ],
    }),
  };
}

function buildSyntheticText(payload) {
  return JSON.stringify(payload);
}

function buildSyntheticResponse(payload) {
  return {
    provider: 'synthetic',
    model: 'synthetic-worker',
    usage: {},
    elapsedMs: 0,
    text: typeof payload === 'string' ? payload : buildSyntheticText(payload),
  };
}

function buildStagedPlan(overrides = {}) {
  return {
    decision: 'propose',
    change_summary: 'Clamp sanitizeCount at 100 with one paired regression test.',
    source_target_id: 'source:calc:sanitize-count',
    test_target_id: 'test:calc-test:sanitize-count-floors-negatives',
    why_bounded: 'One small source edit plus one small test update.',
    invariants_preserved: ['sanitizeCount stays deterministic'],
    expected_test_kind: 'regression',
    ...overrides,
  };
}

function buildStagedEditorProposal(overrides = {}) {
  return {
    decision: 'edit',
    source_edit: {
      target_id: 'source:calc:sanitize-count',
      operation: 'replace_block',
      start_line: 1,
      end_line: 4,
      replacement: [
        'function sanitizeCount(value) {',
        '  if (!Number.isFinite(value)) return 0;',
        '  if (value > 100) return 100;',
        '  return value < 0 ? 0 : value;',
        '}',
      ].join('\n'),
    },
    test_edit: {
      target_id: 'test:calc-test:sanitize-count-floors-negatives',
      operation: 'replace_block',
      start_line: 4,
      end_line: 8,
      replacement: [
        '',
        "test('sanitizeCount floors negatives', () => {",
        '  assert.equal(sanitizeCount(-5), 0);',
        '  assert.equal(sanitizeCount(9), 9);',
        '  assert.equal(sanitizeCount(400), 100);',
        '});',
      ].join('\n'),
    },
    logical_explanation: {
      problem: 'Clamp sanitizeCount at 100 so counters stay bounded.',
      why_this_surface: 'The calc implementation and its regression proof both live inside the core surface.',
      invariants_preserved: ['sanitizeCount stays deterministic'],
      why_this_is_bounded: 'One source edit plus one paired test edit.',
      residual_risks: [],
    },
    ...overrides,
  };
}

function createStagedProposalLoader(handlers = {}) {
  return ({ requestKind }) => {
    const handler = handlers[requestKind];
    if (typeof handler !== 'function') {
      throw new Error(`unexpected request kind: ${requestKind}`);
    }
    return buildSyntheticResponse(handler());
  };
}

test('parsePlannerResponse accepts propose and no_safe_change payloads', () => {
  const plan = parsePlannerResponse(buildSyntheticText(buildStagedPlan()));
  assert.equal(plan.decision, 'propose');
  assert.equal(plan.sourceTargetId, 'source:calc:sanitize-count');
  assert.equal(plan.testTargetId, 'test:calc-test:sanitize-count-floors-negatives');

  const noSafeChange = parsePlannerResponse(buildSyntheticText({
    decision: 'no_safe_change',
    change_summary: 'No safe bounded change found.',
  }));
  assert.equal(noSafeChange.decision, 'no_safe_change');
  assert.equal(noSafeChange.changeSummary, 'No safe bounded change found.');
});

test('mineSurfaceCandidates and buildTargetWindow extract bounded staged context', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-staged-'));
  writeFixtureRepo(rootDir);
  const adapter = loadOvernightAdapter(path.join(rootDir, 'overnight.yaml'), { repoRoot: rootDir });
  const surface = findSurface(adapter, 'core');

  const candidates = mineSurfaceCandidates(adapter, surface, rootDir);
  assert.equal(candidates.sourceTargets.some((entry) => entry.symbol === 'sanitizeCount'), true);
  assert.equal(candidates.testTargets.some((entry) => entry.anchorText === 'sanitizeCount floors negatives'), true);
  assert.equal(Boolean(candidates.registry.byId['source:calc:sanitize-count']), true);

  const parsedPlan = parsePlannerResponse(buildSyntheticText(buildStagedPlan()));
  const sourceWindow = buildTargetWindow({
    registry: candidates.registry,
    targetId: parsedPlan.sourceTargetId,
    kind: 'source',
    lineCap: 120,
  });
  assert.match(sourceWindow.excerpt, /function sanitizeCount/);

  assert.throws(() => buildTargetWindow({
    registry: candidates.registry,
    targetId: 'source:calc:missing-symbol',
    kind: 'source',
    lineCap: 120,
  }), /Could not locate source anchor/);
});

test('runOvernightBatch keeps an accepted change, writes receipts, and promotes cleanly', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-engine-'));
  writeFixtureRepo(rootDir);

  const batch = await runOvernightBatch({
    cwd: rootDir,
    adapterPath: 'overnight.yaml',
    objectivePath: 'objective.yaml',
    proposalLoader: acceptedProposalLoader,
    reviewLoader: acceptAudit,
  });

  assert.equal(batch.status, 'awaiting-promotion');
  assert.equal(batch.surfaces[0].status, 'kept');
  assert.equal(batch.ledger.length, 1);
  assert.equal(fs.existsSync(batch.surfaces[0].latestProofPath), true);
  assert.equal(fs.existsSync(batch.surfaces[0].latestHandoffPath), true);

  const promotion = await promoteOvernightBatch({
    batchDir: batch.reportRoot,
  });
  assert.equal(promotion.ready, true);
  assert.equal(promotion.conflicts.length, 0);
  assert.equal(promotion.pickedCommits.length, 1);
});

test('runOvernightBatch can hold a locally valid change for deferred Codex audit and promote it after approval', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-engine-'));
  writeFixtureRepo(rootDir);

  const batch = await runOvernightBatch({
    cwd: rootDir,
    adapterPath: 'overnight.yaml',
    objectivePath: 'objective.yaml',
    proposalLoader: acceptedProposalLoader,
    reviewLoader: deferredAudit,
  });

  assert.equal(batch.status, 'awaiting-promotion');
  assert.equal(batch.surfaces[0].status, 'pending-audit');
  assert.equal(batch.surfaces[0].acceptedCommits.length, 0);
  assert.equal(batch.surfaces[0].pendingAuditCommits.length, 1);
  assert.equal(batch.ledger[0].reasonCode, 'awaiting-codex-audit');

  const resolved = await resolveDeferredAudit({
    batchDir: batch.reportRoot,
    surfaceId: 'core',
    verdict: 'accept',
    note: 'Synthetic Codex audit approved the bounded change.',
  });

  assert.equal(resolved.surfaceId, 'core');
  assert.equal(resolved.verdict, 'accept');

  const manifestPaths = buildOvernightManifestPaths(batch.reportRoot);
  const manifest = loadOvernightManifest(manifestPaths.manifestPath);
  assert.equal(manifest.surfaces[0].status, 'kept');
  assert.equal(manifest.surfaces[0].pendingAuditCommits.length, 0);
  assert.equal(manifest.surfaces[0].acceptedCommits.length, 1);
  assert.equal(manifest.ledger[0].reasonCode, 'accepted');

  const promotion = await promoteOvernightBatch({
    batchDir: batch.reportRoot,
  });
  assert.equal(promotion.ready, true);
  assert.equal(promotion.pickedCommits.length, 1);
});

test('resolveDeferredAudit can reject a pending change and keep it out of promotion', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-engine-'));
  writeFixtureRepo(rootDir);

  const batch = await runOvernightBatch({
    cwd: rootDir,
    adapterPath: 'overnight.yaml',
    objectivePath: 'objective.yaml',
    proposalLoader: acceptedProposalLoader,
    reviewLoader: deferredAudit,
  });

  const resolved = await resolveDeferredAudit({
    batchDir: batch.reportRoot,
    surfaceId: 'core',
    verdict: 'reject',
    note: 'Synthetic Codex audit rejected the change.',
  });

  assert.equal(resolved.verdict, 'reject');

  const manifestPaths = buildOvernightManifestPaths(batch.reportRoot);
  const manifest = loadOvernightManifest(manifestPaths.manifestPath);
  assert.equal(manifest.surfaces[0].status, 'discarded');
  assert.equal(manifest.surfaces[0].pendingAuditCommits.length, 0);
  assert.equal(manifest.surfaces[0].acceptedCommits.length, 0);
  assert.equal(manifest.ledger[0].reasonCode, 'audit-reject');

  const promotion = await promoteOvernightBatch({
    batchDir: batch.reportRoot,
  });
  assert.equal(promotion.pickedCommits.length, 0);
});

test('runOvernightBatch rejects production edits that do not include tests', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-engine-'));
  writeFixtureRepo(rootDir);

  const batch = await runOvernightBatch({
    cwd: rootDir,
    adapterPath: 'overnight.yaml',
    objectivePath: 'objective.yaml',
    proposalLoader: codeOnlyProposalLoader,
    reviewLoader: acceptAudit,
  });

  assert.equal(batch.surfaces[0].status, 'discarded');
  assert.equal(batch.ledger[0].reasonCode, 'missing-tests');
});

test('runSurfaceAttempt freezes an accepted surface until the objective changes', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-engine-'));
  writeFixtureRepo(rootDir);

  const batch = await runOvernightBatch({
    cwd: rootDir,
    adapterPath: 'overnight.yaml',
    objectivePath: 'objective.yaml',
    proposalLoader: acceptedProposalLoader,
    reviewLoader: acceptAudit,
  });

  const adapter = loadOvernightAdapter(path.join(rootDir, 'overnight.yaml'), { repoRoot: rootDir });
  const objective = loadOvernightObjective(path.join(rootDir, 'objective.yaml'), adapter, { repoRoot: rootDir });
  const manifestPaths = buildOvernightManifestPaths(batch.reportRoot);
  const manifest = loadOvernightManifest(manifestPaths.manifestPath);
  const report = await runSurfaceAttempt({
    adapter,
    objective,
    manifestPaths,
    manifest,
    surface: findSurface(adapter, 'core'),
    proposalLoader: acceptedProposalLoader,
    reviewLoader: acceptAudit,
  });

  assert.equal(report.reasonCode, 'surface-frozen');
  const updatedManifest = loadOvernightManifest(manifestPaths.manifestPath);
  assert.equal(updatedManifest.ledger.length, 2);
  assert.equal(updatedManifest.ledger[1].reasonCode, 'surface-frozen');
});

test('runOvernightBatch records worker failures even when no proposal was produced', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-engine-'));
  writeFixtureRepo(rootDir);

  const batch = await runOvernightBatch({
    cwd: rootDir,
    adapterPath: 'overnight.yaml',
    objectivePath: 'objective.yaml',
    proposalLoader: throwingProposalLoader,
    reviewLoader: acceptAudit,
  });

  assert.equal(batch.status, 'awaiting-promotion');
  assert.equal(batch.surfaces[0].status, 'failed');
  assert.equal(batch.ledger.length, 1);
  assert.equal(batch.ledger[0].reasonCode, 'worker-failed');
  assert.deepEqual(batch.ledger[0].changedPaths, []);
  assert.equal(batch.ledger[0].summary, 'worker-failed');
});

test('runOvernightBatch honors repeated attempts and shared-ledger duplicate blocking', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-engine-'));
  writeFixtureRepo(rootDir);

  const batch = await runOvernightBatch({
    cwd: rootDir,
    adapterPath: 'overnight.yaml',
    objectivePath: 'objective.yaml',
    proposalLoader: acceptedProposalLoader,
    reviewLoader: rejectAudit,
    attemptLimit: 2,
  });

  assert.equal(batch.status, 'awaiting-promotion');
  assert.equal(batch.surfaces[0].attemptCount, 2);
  assert.equal(batch.ledger.length, 2);
  assert.equal(batch.ledger[0].reasonCode, 'audit-reject');
  assert.equal(batch.ledger[1].reasonCode, 'duplicate');
});

test('runOvernightBatch can execute multiple surfaces in parallel when maxParallelWorkers is raised', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-engine-parallel-'));
  writeParallelFixtureRepo(rootDir);

  const concurrency = { active: 0, max: 0 };
  const proposalLoader = async ({ surface }) => {
    concurrency.active += 1;
    concurrency.max = Math.max(concurrency.max, concurrency.active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 75));
      if (surface.id === 'core-a') {
        return {
          provider: 'synthetic',
          model: 'synthetic-worker',
          usage: {},
          elapsedMs: 0,
          text: JSON.stringify(buildAcceptedLegacyProposal(
            'src/calc_a.cjs',
            '  return value < 0 ? 0 : value;',
            'tests/unit/calc_a.test.cjs',
            '  assert.equal(sanitizeCountA(9), 9);',
            'sanitizeCountA',
          )),
        };
      }
      return {
        provider: 'synthetic',
        model: 'synthetic-worker',
        usage: {},
        elapsedMs: 0,
        text: JSON.stringify(buildAcceptedLegacyProposal(
          'src/calc_b.cjs',
          '  return value < 0 ? 0 : value;',
          'tests/unit/calc_b.test.cjs',
          '  assert.equal(sanitizeCountB(9), 9);',
          'sanitizeCountB',
        )),
      };
    } finally {
      concurrency.active -= 1;
    }
  };

  const batch = await runOvernightBatch({
    cwd: rootDir,
    adapterPath: 'overnight.yaml',
    objectivePath: 'objective.yaml',
    proposalLoader,
    reviewLoader: acceptAudit,
    maxParallelWorkers: 2,
  });

  assert.equal(batch.status, 'awaiting-promotion');
  assert.equal(batch.maxParallelWorkers, 2);
  assert.equal(batch.summary.outcomes.kept, 2);
  assert.equal(batch.surfaces.length, 2);
  assert.ok(concurrency.max >= 2);
});

test('runOvernightBatch re-checks repaired proposals before keeping them', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-engine-'));
  writeFixtureRepo(rootDir);

  const batch = await runOvernightBatch({
    cwd: rootDir,
    adapterPath: 'overnight.yaml',
    objectivePath: 'objective.yaml',
    proposalLoader: repairDropsTestsProposalLoader,
    reviewLoader: acceptAudit,
  });

  assert.equal(batch.status, 'awaiting-promotion');
  assert.equal(batch.surfaces[0].status, 'discarded');
  assert.equal(batch.ledger.length, 1);
  assert.equal(batch.ledger[0].reasonCode, 'missing-tests');
});

test('runOvernightBatch supports staged mode, writes staged receipts, and reports pipeline summary', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-staged-engine-'));
  writeFixtureRepo(rootDir);

  const batch = await runOvernightBatch({
    cwd: rootDir,
    adapterPath: 'overnight.yaml',
    objectivePath: 'objective.yaml',
    proposalMode: 'staged',
    proposalLoader: createStagedProposalLoader({
      planner: () => buildStagedPlan(),
      editor: () => buildStagedEditorProposal(),
    }),
    reviewLoader: acceptAudit,
  });

  assert.equal(batch.status, 'awaiting-promotion');
  assert.equal(batch.proposalMode, 'staged');
  assert.equal(batch.summary.pipelineMode, 'staged');
  assert.equal(batch.surfaces[0].status, 'kept');
  assert.equal(batch.summary.outcomes.kept, 1);
  assert.equal(batch.summary.stages.accepted, 1);

  const attemptDir = path.join(batch.reportRoot, 'surfaces', 'core', 'attempts', 'attempt-0001');
  assert.equal(fs.existsSync(path.join(attemptDir, 'plan.json')), true);
  assert.equal(fs.existsSync(path.join(attemptDir, 'window.json')), true);
  assert.equal(fs.existsSync(path.join(attemptDir, 'editor-proposal.json')), true);
});

test('staged mode rejects planner targets that leave the allowed surface', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-staged-engine-'));
  writeFixtureRepo(rootDir);

  const batch = await runOvernightBatch({
    cwd: rootDir,
    adapterPath: 'overnight.yaml',
    objectivePath: 'objective.yaml',
    proposalMode: 'staged',
    proposalLoader: createStagedProposalLoader({
      planner: () => buildStagedPlan({
        source_target_id: 'source:readme:readme',
      }),
    }),
    reviewLoader: acceptAudit,
  });

  assert.equal(batch.surfaces[0].status, 'discarded');
  assert.equal(batch.ledger[0].reasonCode, 'invalid-target-id');
  assert.equal(batch.ledger[0].stage, 'planning');
});

test('staged mode rejects editor patches that escape the chosen window', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-staged-engine-'));
  writeFixtureRepo(rootDir);

  const batch = await runOvernightBatch({
    cwd: rootDir,
    adapterPath: 'overnight.yaml',
    objectivePath: 'objective.yaml',
    proposalMode: 'staged',
    proposalLoader: createStagedProposalLoader({
      planner: () => buildStagedPlan(),
      editor: () => buildStagedEditorProposal({
        source_edit: {
          target_id: 'source:calc:sanitize-count',
          operation: 'replace_block',
          start_line: 1,
          end_line: 999,
          replacement: 'broken',
        },
      }),
      'editor-repair': () => buildStagedEditorProposal({
        source_edit: {
          target_id: 'source:calc:sanitize-count',
          operation: 'replace_block',
          start_line: 1,
          end_line: 999,
          replacement: 'still broken',
        },
      }),
    }),
    reviewLoader: acceptAudit,
  });

  assert.equal(batch.surfaces[0].status, 'discarded');
  assert.equal(batch.ledger[0].reasonCode, 'out-of-bound-edit');
  assert.equal(batch.ledger[0].stage, 'preflight');
  assert.equal(batch.summary.targetWindowFailures['source:calc:sanitize-count'].count, 1);
});

test('staged mode can repair one anchor mismatch without changing the chosen files', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-staged-engine-'));
  writeFixtureRepo(rootDir);

  const batch = await runOvernightBatch({
    cwd: rootDir,
    adapterPath: 'overnight.yaml',
    objectivePath: 'objective.yaml',
    proposalMode: 'staged',
    proposalLoader: createStagedProposalLoader({
      planner: () => buildStagedPlan(),
      editor: () => buildStagedEditorProposal({
        source_edit: {
          target_id: 'source:calc:sanitize-count',
          operation: 'replace_block',
          start_line: 1,
          end_line: 999,
          replacement: 'broken',
        },
      }),
      'editor-repair': () => buildStagedEditorProposal(),
    }),
    reviewLoader: acceptAudit,
  });

  assert.equal(batch.surfaces[0].status, 'kept');
  assert.equal(batch.ledger[0].reasonCode, 'accepted');
  assert.equal(batch.ledger[0].pipelineMode, 'staged');
  assert.equal(batch.ledger[0].candidateFingerprint.length > 0, true);
  assert.equal(batch.ledger[0].windowFingerprint.length > 0, true);
});

test('staged mode binds omitted editor target ids to the chosen planner targets', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-staged-engine-'));
  writeFixtureRepo(rootDir);

  const batch = await runOvernightBatch({
    cwd: rootDir,
    adapterPath: 'overnight.yaml',
    objectivePath: 'objective.yaml',
    proposalMode: 'staged',
    proposalLoader: createStagedProposalLoader({
      planner: () => buildStagedPlan(),
      editor: () => buildStagedEditorProposal({
        source_edit: {
          operation: 'replace_block',
          start_line: 1,
          end_line: 4,
          replacement: [
            'function sanitizeCount(value) {',
            '  if (!Number.isFinite(value)) return 0;',
            '  if (value > 100) return 100;',
            '  return value < 0 ? 0 : value;',
            '}',
          ].join('\n'),
        },
        test_edit: {
          operation: 'replace_block',
          start_line: 4,
          end_line: 8,
          replacement: [
            '',
            "test('sanitizeCount floors negatives', () => {",
            '  assert.equal(sanitizeCount(-5), 0);',
            '  assert.equal(sanitizeCount(9), 9);',
            '  assert.equal(sanitizeCount(400), 100);',
            '});',
          ].join('\n'),
        },
      }),
    }),
    reviewLoader: acceptAudit,
  });

  assert.equal(batch.surfaces[0].status, 'kept');
  assert.equal(batch.ledger[0].reasonCode, 'accepted');
});
