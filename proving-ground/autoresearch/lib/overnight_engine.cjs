const fs = require('node:fs');
const path = require('node:path');

const {
  buildAttemptId,
  buildBatchId,
  createFingerprint,
  defaultWorktreeRoot,
  ensureDir,
  extractJsonObjectFromText,
  normalizeText,
  nowIso,
  readJsonIfExists,
  readTextIfExists,
  resolveRepoPath,
  writeJsonAtomic,
} = require('./baton_common.cjs');
const {
  createWorktree,
  deleteBranch,
  getHeadCommit,
  gitStatus,
  removeWorktree,
  runGit,
} = require('./baton_worktree_manager.cjs');
const {
  buildStarterAdapter,
  findSurface,
  isForbiddenPath,
  isManualOnlyPath,
  isPathAllowedForSurface,
  loadOvernightAdapter,
  matchesPathPattern,
  resolvePatternMatches,
} = require('./overnight_adapter.cjs');
const { runAuditGate } = require('./overnight_audit_gate.cjs');
const {
  appendOvernightEvent,
  appendSurfaceHistory,
  buildOvernightManifestPaths,
  createOvernightManifest,
  loadOvernightManifest,
  updateOvernightManifest,
  writeSurfaceStatus,
} = require('./overnight_manifest.cjs');
const { loadOvernightObjective } = require('./overnight_objective.cjs');
const {
  applyPatchSet,
  rollbackAppliedPatchSet,
} = require('./overnight_patch_engine.cjs');
const {
  compileEditSketch,
  normalizeSketch,
} = require('./overnight_compiler.cjs');
const { callMinimaxChat } = require('./minimax_client.cjs');
const {
  buildCandidateFingerprint,
  buildEditorPrompt,
  buildEditorRepairPrompt,
  buildPlannerPrompt,
  buildTargetWindows,
  listAnchorFailures,
  mineSurfaceCandidates,
  normalizeProposalMode,
  parsePlannerResponse,
  buildSourceTargetKey,
  shouldCoolSourceTarget,
  validateStagedEditorProposal,
} = require('./overnight_staged.cjs');
const { writeYamlFile } = require('./overnight_yaml.cjs');

const OVERNIGHT_ENGINE_SCHEMA_VERSION = '1.0.0';
const DEFAULT_REPORT_DIR = 'proving-ground/reports/overnight';

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];
}

function truncateOutput(text, maxLength = 800) {
  const normalized = String(text || '').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function runValidationCommand(command, cwd) {
  const startedAt = Date.now();
  const result = require('node:child_process').spawnSync('bash', ['-lc', command], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    command,
    exitCode: result.status === null ? 1 : result.status,
    passed: result.status === 0,
    elapsedMs: Date.now() - startedAt,
    stdout: truncateOutput(result.stdout),
    stderr: truncateOutput(result.stderr),
  };
}

function summarizeValidationResults(results) {
  const passedCount = results.filter((result) => result.passed).length;
  const failedCount = results.length - passedCount;
  const totalElapsedMs = results.reduce((sum, result) => sum + Number(result.elapsedMs || 0), 0);
  return {
    commandCount: results.length,
    passedCount,
    failedCount,
    passRate: results.length === 0 ? 1 : passedCount / results.length,
    totalElapsedMs,
    overallPass: failedCount === 0,
  };
}

function runValidationPlan(commands, cwd) {
  const results = normalizeStringList(commands).map((command) => runValidationCommand(command, cwd));
  return {
    commands: results,
    summary: summarizeValidationResults(results),
  };
}

function getWorkingTreeState(cwd) {
  const result = require('node:child_process').spawnSync('git', ['status', '--porcelain'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const entries = String(result.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    ok: result.status === 0,
    isDirty: entries.length > 0,
    entries,
    error: normalizeText(result.stderr),
  };
}

function runGitCommand(cwd, args) {
  const result = require('node:child_process').spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    exitCode: result.status === null ? 1 : result.status,
    stdout: normalizeText(result.stdout),
    stderr: normalizeText(result.stderr),
  };
}

function commitAcceptedIteration(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const appliedChangeSet = options.appliedChangeSet;
  if (!appliedChangeSet || !Array.isArray(appliedChangeSet.files) || appliedChangeSet.files.length === 0) {
    throw new Error('commitAcceptedIteration requires touched files');
  }
  const files = appliedChangeSet.files
    .map((entry) => normalizeText(entry && entry.path))
    .filter(Boolean);
  const addResult = runGitCommand(cwd, ['add', '--', ...files]);
  if (addResult.exitCode !== 0) {
    throw new Error(addResult.stderr || 'git add failed');
  }
  const diffResult = runGitCommand(cwd, ['diff', '--cached', '--quiet', '--', ...files]);
  if (diffResult.exitCode === 0) {
    return {
      skipped: true,
      reason: 'no-staged-diff',
      files,
    };
  }
  if (diffResult.exitCode !== 1) {
    throw new Error(diffResult.stderr || 'git diff --cached --quiet failed');
  }
  const message = `overnight: ${normalizeText(options.summary) || 'objective-driven change'}`;
  const commitResult = runGitCommand(cwd, [
    '-c', 'user.name=Codex',
    '-c', 'user.email=codex@example.com',
    'commit',
    '-m', message,
    '--',
    ...files,
  ]);
  if (commitResult.exitCode !== 0) {
    throw new Error(commitResult.stderr || commitResult.stdout || 'git commit failed');
  }
  const headResult = runGitCommand(cwd, ['rev-parse', 'HEAD']);
  if (headResult.exitCode !== 0) {
    throw new Error(headResult.stderr || 'git rev-parse HEAD failed');
  }
  return {
    skipped: false,
    sha: headResult.stdout,
    message,
    files,
  };
}

function summarizeValidation(validation) {
  return validation && validation.summary ? validation.summary : {
    commandCount: 0,
    passedCount: 0,
    failedCount: 0,
    passRate: 0,
    totalElapsedMs: 0,
    overallPass: false,
  };
}

function buildSurfacePaths(reportRoot, worktreeRoot, surfaceId) {
  const surfaceDir = path.join(reportRoot, 'surfaces', surfaceId);
  return {
    surfaceDir,
    statusPath: path.join(surfaceDir, 'status.json'),
    latestPath: path.join(surfaceDir, 'latest.json'),
    historyPath: path.join(surfaceDir, 'history.ndjson'),
    attemptsDir: path.join(surfaceDir, 'attempts'),
    worktreePath: path.join(worktreeRoot, surfaceId),
  };
}

function buildAttemptPaths(batchDir, surfaceId, attemptId) {
  const attemptDir = path.join(batchDir, 'surfaces', surfaceId, 'attempts', attemptId);
  return {
    attemptDir,
    reportPath: path.join(attemptDir, 'report.json'),
    proofPath: path.join(attemptDir, 'proof.json'),
    handoffPath: path.join(attemptDir, 'handoff.md'),
    auditPath: path.join(attemptDir, 'audit.json'),
    proposalPath: path.join(attemptDir, 'proposal.json'),
    planPath: path.join(attemptDir, 'plan.json'),
    windowPath: path.join(attemptDir, 'window.json'),
    editorProposalPath: path.join(attemptDir, 'editor-proposal.json'),
  };
}

function buildBatchBranchPrefix(adapter, batchId) {
  return `${adapter.defaults.branchPrefix}/${batchId}`;
}

function buildSurfaceBranchName(adapter, batchId, surfaceId, attemptId) {
  return `${buildBatchBranchPrefix(adapter, batchId)}/${surfaceId}/${attemptId}`;
}

function buildIntegrationBranchName(adapter, batchId) {
  return `${buildBatchBranchPrefix(adapter, batchId)}/integration`;
}

function isNonCodePath(filePath) {
  const normalized = normalizeText(filePath).toLowerCase();
  return [
    '.md',
    '.txt',
    '.rst',
    '.adoc',
    '.yaml',
    '.yml',
    '.toml',
    '.ini',
    '.json',
  ].some((suffix) => normalized.endsWith(suffix));
}

function classifySyntaxFailure(validation) {
  const commands = Array.isArray(validation && validation.commands) ? validation.commands : [];
  const haystack = commands
    .map((entry) => `${entry.stdout || ''}\n${entry.stderr || ''}`)
    .join('\n');
  return /SyntaxError|Unexpected token|ParseError|ReferenceError:.*is not defined|Cannot use import statement|ERR_MODULE_NOT_FOUND/i.test(haystack);
}

function buildSurfaceBudget(surface) {
  if (surface.risk === 'safe') {
    return { maxFiles: 4, maxBlocks: 8 };
  }
  if (surface.risk === 'guarded') {
    return { maxFiles: 6, maxBlocks: 12 };
  }
  return { maxFiles: 0, maxBlocks: 0 };
}

function collectProposalPaths(proposal) {
  if (!proposal || typeof proposal !== 'object') {
    return [];
  }
  const codeChanges = Array.isArray(proposal.codeChanges) ? proposal.codeChanges : [];
  const testChanges = Array.isArray(proposal.testChanges) ? proposal.testChanges : [];
  return Array.from(new Set(
    codeChanges.concat(testChanges).map((entry) => normalizeText(entry.path)).filter(Boolean),
  ));
}

function createPatchFingerprint(objectiveHash, surfaceId, proposal) {
  return createFingerprint({
    objectiveHash,
    surfaceId,
    codeChanges: proposal.codeChanges,
    testChanges: proposal.testChanges,
  });
}

function listNoRetryIdeas(ledger, objectiveHash, surfaceId) {
  return ledger
    .filter((entry) => entry.objectiveHash === objectiveHash && entry.surfaceId === surfaceId)
    .map((entry) => ({
      patchFingerprint: entry.patchFingerprint,
      outcome: entry.outcome,
      reasonCode: entry.reasonCode,
      changedPaths: entry.changedPaths,
      summary: entry.summary,
    }));
}

function buildPromptContext(adapter, objective, surface, contextRepoRoot = adapter.repoRoot) {
  const repoRoot = path.resolve(contextRepoRoot || adapter.repoRoot);
  const excerpts = [];
  const contextFiles = surface.paths
    .concat(surface.testPaths)
    .concat(resolvePatternMatches(adapter, surface.contextPatterns))
    .slice(0, 12);
  const seen = new Set();
  for (const relativePath of contextFiles) {
    if (seen.has(relativePath)) {
      continue;
    }
    seen.add(relativePath);
    const resolved = resolveRepoPath(repoRoot, relativePath);
    const content = fs.readFileSync(resolved.absolutePath, 'utf8');
    excerpts.push({
      path: relativePath,
      excerpt: content.length > 2200 ? `${content.slice(0, 2200)}\n...` : content,
    });
  }
  return {
    objective: {
      goal: objective.goal,
      success: objective.success,
      requiredTests: objective.requiredTests,
      stopConditions: objective.stopConditions,
      evidence: objective.evidence,
    },
    surface: {
      id: surface.id,
      title: surface.title,
      description: surface.description,
      risk: surface.risk,
      invariants: surface.invariants,
      paths: surface.paths,
      testPaths: surface.testPaths,
      requiredTestKinds: surface.requiredTestKinds,
      allowedDependencies: surface.allowedDependencies,
      guidance: [
        'Use SEARCH blocks copied from the current file text, not guessed text.',
        'Prefer stable anchors such as test names, function names, export names, or complete small blocks.',
        'Avoid brittle anchors such as version literals, timestamps, generated IDs, or repeated strings when a stronger anchor exists.',
        'If you cannot build a stable SEARCH block from the provided file excerpts, return no safe change.',
        'If you touch a source file such as .js, .cjs, .mjs, .ts, or .tsx, include matching test_changes even when the edit only improves wording or comments.',
      ],
    },
    focusFiles: excerpts,
  };
}

function buildProposalPrompt(options) {
  return {
    systemPrompt: [
      'You are the objective-driven overnight code worker.',
      'Return JSON only.',
      'Make one bounded proposal that satisfies the objective without violating the surface invariants.',
      'Do not touch files outside the allowed surface paths and test paths.',
      'Do not retry ideas listed in no_retry_ideas.',
      'The only top-level keys allowed are logical_explanation, code_changes, and test_changes.',
      'Each patch block must use path, search, replace, context_before, and context_after.',
      'SEARCH blocks must be copied from the current file excerpts and anchored on stable surrounding text.',
      'If a stable SEARCH block is not available, return no safe change instead of guessing.',
      'When editing any source-code file, always include matching test_changes, even for clarity, comments, or guidance text.',
      'If no safe change exists, return empty code_changes and empty test_changes with a clear logical_explanation.',
    ].join(' '),
    userPrompt: JSON.stringify({
      objective: options.context.objective,
      surface: options.context.surface,
      focusFiles: options.context.focusFiles,
      no_retry_ideas: options.noRetryIdeas,
      return_shape: {
        logical_explanation: {
          problem: 'what is being solved',
          why_this_surface: 'why the chosen surface is correct',
          invariants_preserved: ['which invariants stay true'],
          why_this_is_bounded: 'why the change stays small',
          residual_risks: ['remaining risks or empty list'],
        },
        code_changes: [
          {
            path: 'relative/path',
            search: 'exact current text',
            replace: 'new text',
            context_before: 'optional exact text before search',
            context_after: 'optional exact text after search',
          },
        ],
        test_changes: [
          {
            path: 'relative/path',
            search: 'exact current text',
            replace: 'new text',
            context_before: 'optional exact text before search',
            context_after: 'optional exact text after search',
          },
        ],
      },
    }, null, 2),
  };
}

function extractPatchPathFromError(errorMessage) {
  const normalized = normalizeText(errorMessage);
  const match = normalized.match(/ in ([^ ]+\.(?:cjs|mjs|js|ts|tsx|json|md))$/i);
  return match ? normalizeText(match[1]) : '';
}

function buildRepairContext(cwd, errorMessage) {
  const failedPath = extractPatchPathFromError(errorMessage);
  if (!failedPath) {
    return null;
  }
  const resolved = resolveRepoPath(cwd, failedPath);
  const content = readTextIfExists(resolved.absolutePath);
  return {
    failed_path: failedPath,
    file_excerpt: content.length > 2600 ? `${content.slice(0, 2600)}\n...` : content,
  };
}

function buildRepairPrompt(prompt, originalText, errorMessage, options = {}) {
  const repairContext = options.cwd ? buildRepairContext(options.cwd, errorMessage) : null;
  return {
    systemPrompt: prompt.systemPrompt,
    userPrompt: JSON.stringify({
      task: 'Repair the previous proposal. Keep the same intent. Only fix JSON shape, SEARCH/REPLACE blocks, or syntax-oriented mistakes.',
      error: errorMessage,
      original_response: originalText,
      repair_context: repairContext,
      patch_rules: [
        'Use the provided current file excerpt when repairing SEARCH or context mismatches.',
        'Prefer stable anchors such as named tests, function declarations, or exact small blocks.',
        'Do not keep version strings or other brittle literals as the main SEARCH anchor when a stronger anchor exists.',
        'Keep matching test_changes whenever you edit a source-code file.',
      ],
      reminder: 'Return JSON only with top-level keys logical_explanation, code_changes, test_changes.',
    }, null, 2),
  };
}

function normalizePatchList(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${fieldName}[${index}] must be an object`);
    }
    return {
      path: normalizeText(entry.path),
      search: String(entry.search ?? ''),
      replace: String(entry.replace ?? ''),
      context_before: String(entry.context_before ?? entry.contextBefore ?? ''),
      context_after: String(entry.context_after ?? entry.contextAfter ?? ''),
    };
  });
}

function normalizeExplanation(value) {
  const explanation = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    problem: normalizeText(explanation.problem),
    whyThisSurface: normalizeText(explanation.why_this_surface || explanation.whyThisSurface),
    invariantsPreserved: normalizeStringList(explanation.invariants_preserved || explanation.invariantsPreserved),
    whyThisIsBounded: normalizeText(explanation.why_this_is_bounded || explanation.whyThisIsBounded),
    residualRisks: normalizeStringList(explanation.residual_risks || explanation.residualRisks),
  };
}

function parseProposal(text) {
  const payload = JSON.parse(extractJsonObjectFromText(text, 'Proposal response'));
  const proposal = {
    logicalExplanation: normalizeExplanation(payload.logical_explanation),
    codeChanges: normalizePatchList(payload.code_changes || [], 'code_changes'),
    testChanges: normalizePatchList(payload.test_changes || [], 'test_changes'),
  };
  if (!proposal.logicalExplanation.problem) {
    throw new Error('logical_explanation.problem is required');
  }
  return proposal;
}

function parseStagedEditorProposal(text) {
  const payload = JSON.parse(extractJsonObjectFromText(text, 'Staged editor response'));
  const sketch = normalizeSketch(payload);
  return {
    decision: sketch.decision,
    sourceEdit: sketch.sourceEdit || null,
    testEdit: sketch.testEdit || null,
    logicalExplanation: normalizeExplanation(sketch.logicalExplanation),
  };
}

function proposalSummary(proposal) {
  if (!proposal || typeof proposal !== 'object') {
    return 'objective-driven overnight change';
  }
  return normalizeText(proposal.logicalExplanation && proposal.logicalExplanation.problem) || 'objective-driven overnight change';
}

function buildLedgerProposalFallback(report) {
  if (report.editorProposal && typeof report.editorProposal === 'object') {
    return {
      codeChanges: [],
      testChanges: [],
      logicalExplanation: report.editorProposal.logicalExplanation || {
        problem: report.reasonCode || 'no-safe-change',
      },
    };
  }
  return report.proposal || {
    codeChanges: [],
    testChanges: [],
    logicalExplanation: {
      problem: report.reasonCode || 'no-safe-change',
    },
  };
}

function buildLedgerEntry(report, objectiveHash, surface, patchFingerprint) {
  const proposal = buildLedgerProposalFallback(report);
  return {
    time: nowIso(),
    attemptId: report.attemptId,
    objectiveHash,
    surfaceId: surface.id,
    pipelineMode: report.pipelineMode || 'legacy',
    stage: report.failureStage || (report.outcome === 'kept' ? 'accepted' : 'legacy'),
    patchFingerprint,
    candidateFingerprint: report.candidateFingerprint || null,
    sourceTarget: report.sourceTarget || null,
    testTarget: report.testTarget || null,
    windowFingerprint: report.windowFingerprint || null,
    changedPaths: collectProposalPaths(proposal),
    changedSymbols: [],
    outcome: report.outcome,
    reasonCode: report.reasonCode,
    failureKind: report.failureKind || report.reasonCode,
    failedPath: report.failedPath || null,
    failedSearchExcerpt: normalizeText(report.failedSearchExcerpt),
    baseCommit: report.baseCommit,
    commitSha: report.commit && report.commit.sha ? report.commit.sha : null,
    summary: proposalSummary(proposal),
  };
}

function shouldCoolSurfaceDown(ledger, objectiveHash, surfaceId) {
  const relevant = ledger.filter((entry) => entry.objectiveHash === objectiveHash && entry.surfaceId === surfaceId);
  const noBenefit = relevant.filter((entry) => [
    'no-safe-change',
    'validation-failed',
    'audit-reject',
    'missing-tests',
    'scope-gate',
    'duplicate',
    'anchor-preflight-failed',
    'invalid-target-window',
    'planner-schema-failed',
    'editor-schema-failed',
    'out-of-bound-edit',
    'stale-target',
    'invalid-target-id',
  ].includes(entry.reasonCode) || [
    'anchor-preflight-failed',
    'invalid-target-window',
    'planner-schema-failed',
    'editor-schema-failed',
    'out-of-bound-edit',
    'stale-target',
    'invalid-target-id',
  ].includes(entry.failureKind));
  return noBenefit.length >= 2;
}

function proposalHasNoChanges(proposal) {
  if (!proposal || typeof proposal !== 'object') {
    return true;
  }
  return proposal.codeChanges.length === 0 && proposal.testChanges.length === 0;
}

function buildCandidateRejection(reasonCode, nextStep) {
  return {
    ok: false,
    reasonCode,
    nextStep,
  };
}

function gatePlannerDecision(adapter, objective, surface, plan, ledger, surfaceState) {
  if (surfaceState && surfaceState.frozen) {
    return buildCandidateRejection('surface-frozen', 'Wait for a new objective or a new base commit before reopening this surface.');
  }
  if (surface.risk === 'manual') {
    return buildCandidateRejection('manual-surface', 'Leave this surface for manual review.');
  }
  if (plan.decision === 'no_safe_change') {
    return {
      ok: true,
      noSafeChange: true,
      candidateFingerprint: null,
    };
  }
  if (!isPathAllowedForSurface(adapter, surface, plan.sourceTarget.path, { includeTests: false })) {
    return buildCandidateRejection('scope-gate', 'Keep the planned source target inside the allowed surface.');
  }
  if (!isPathAllowedForSurface(adapter, surface, plan.testTarget.path, { includeTests: true })) {
    return buildCandidateRejection('scope-gate', 'Keep the planned test target inside the allowed surface.');
  }
  if (isManualOnlyPath(adapter, plan.sourceTarget.path) || isManualOnlyPath(adapter, plan.testTarget.path)) {
    return buildCandidateRejection('manual-only-path', 'Leave manual-only paths untouched.');
  }
  if (isForbiddenPath(surface, plan.sourceTarget.path) || isForbiddenPath(surface, plan.testTarget.path)) {
    return buildCandidateRejection('forbidden-path', 'Remove forbidden paths from the planned target pair.');
  }
  const candidateFingerprint = buildCandidateFingerprint(objective.objectiveHash, surface.id, plan);
  const duplicate = ledger.find((entry) => (
    entry.objectiveHash === objective.objectiveHash
    && entry.surfaceId === surface.id
    && entry.candidateFingerprint === candidateFingerprint
  ));
  if (duplicate) {
    return buildCandidateRejection('duplicate', 'Choose a materially different target pair.');
  }
  if (shouldCoolSourceTarget(ledger, objective.objectiveHash, surface.id, plan.sourceTarget)) {
    return buildCandidateRejection('surface-cooled-down', 'Wait for new evidence before reopening this source target.');
  }
  if (shouldCoolSurfaceDown(ledger, objective.objectiveHash, surface.id)) {
    return buildCandidateRejection('surface-cooled-down', 'Wait for new evidence or a new objective before reopening this surface.');
  }
  return {
    ok: true,
    candidateFingerprint,
  };
}

function buildAuditPacket(options) {
  return {
    goal: options.objective.goal,
    surface: {
      id: options.surface.id,
      title: options.surface.title,
      risk: options.surface.risk,
      invariants: options.surface.invariants,
    },
    proposal: {
      summary: proposalSummary(options.proposal),
      logical_explanation: options.proposal.logicalExplanation,
      code_changes: options.proposal.codeChanges,
      test_changes: options.proposal.testChanges,
    },
    validation: {
      baseline: summarizeValidation(options.baseline),
      quick: summarizeValidation(options.quickValidation),
      full: summarizeValidation(options.fullValidation),
    },
    diff: options.unifiedDiff,
  };
}

async function callProposer(prompt, modelConfig, options = {}) {
  if (typeof options.proposalLoader === 'function') {
    return options.proposalLoader({
      prompt,
      requestKind: options.requestKind || 'proposal',
      surface: options.surface,
      objective: options.objective,
      errorMessage: options.errorMessage || null,
      priorText: options.priorText || null,
    });
  }
  const response = await callMinimaxChat({
    ...modelConfig,
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    temperature: modelConfig.temperature === null || modelConfig.temperature === undefined ? 0.2 : modelConfig.temperature,
  });
  return response;
}

async function loadStructuredResponseWithRepair(prompt, modelConfig, repairTurns, parser, repairPromptBuilder, options = {}) {
  let currentPrompt = prompt;
  let turnsUsed = 0;
  let lastText = null;
  const initialRequestKind = options.requestKind || 'proposal';
  const repairRequestKind = options.repairRequestKind || 'repair';
  while (true) {
    const response = await callProposer(currentPrompt, modelConfig, {
      ...options,
      requestKind: turnsUsed === 0 ? initialRequestKind : repairRequestKind,
      errorMessage: options.errorMessage,
      priorText: lastText,
    });
    lastText = response.text;
    try {
      return {
        response,
        parsed: parser(response.text),
        repairTurnsUsed: turnsUsed,
      };
    } catch (error) {
      if (turnsUsed >= repairTurns) {
        error.responseText = response.text;
        throw error;
      }
      currentPrompt = repairPromptBuilder(currentPrompt, response.text, error.message);
      turnsUsed += 1;
    }
  }
}

async function loadProposalWithRepair(prompt, modelConfig, repairTurns, options = {}) {
  const loaded = await loadStructuredResponseWithRepair(
    prompt,
    modelConfig,
    repairTurns,
    parseProposal,
    (currentPrompt, originalText, errorMessage) => buildRepairPrompt(currentPrompt, originalText, errorMessage, {
      cwd: options.cwd,
    }),
    options,
  );
  return {
    response: loaded.response,
    proposal: loaded.parsed,
    repairTurnsUsed: loaded.repairTurnsUsed,
  };
}

async function loadPlannerWithRepair(prompt, modelConfig, repairTurns, options = {}) {
  const loaded = await loadStructuredResponseWithRepair(
    prompt,
    modelConfig,
    repairTurns,
    parsePlannerResponse,
    (currentPrompt, originalText, errorMessage) => ({
      systemPrompt: currentPrompt.systemPrompt,
      userPrompt: JSON.stringify({
        task: 'Repair the staged planner response. Keep the same intent. Only fix malformed JSON or missing required planner fields.',
        error: errorMessage,
        original_response: originalText,
        reminder: 'Return JSON only with decision, change_summary, source_target, test_target, why_bounded, invariants_preserved, expected_test_kind.',
      }, null, 2),
    }),
    {
      ...options,
      requestKind: options.requestKind || 'planner',
    },
  );
  return {
    response: loaded.response,
    plan: loaded.parsed,
    repairTurnsUsed: loaded.repairTurnsUsed,
  };
}

function buildUnifiedDiff(cwd, changedFiles) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    return '';
  }
  const result = runGit(cwd, ['diff', '--', ...changedFiles]);
  if (result.exitCode !== 0) {
    return '';
  }
  return result.stdout || '';
}

function createAttemptReport(options) {
  return {
    schemaVersion: OVERNIGHT_ENGINE_SCHEMA_VERSION,
    batchId: options.batchId,
    objectiveHash: options.objectiveHash,
    surfaceId: options.surface.id,
    title: options.surface.title,
    risk: options.surface.risk,
    attemptId: options.attemptId,
    startedAt: options.startedAt,
    finishedAt: null,
    baseCommit: options.baseCommit,
    pipelineMode: options.pipelineMode || 'legacy',
    failureStage: null,
    failureKind: null,
    candidateFingerprint: null,
    windowFingerprint: null,
    sourceTarget: null,
    testTarget: null,
    failedPath: null,
    failedSearchExcerpt: '',
    plan: null,
    windows: null,
    editorProposal: null,
    proposal: null,
    repairTurnsUsed: 0,
    validation: {
      baseline: null,
      quick: null,
      full: null,
    },
    audit: null,
    diffSummary: {
      files: [],
      addedLines: 0,
      removedLines: 0,
      netLineDelta: 0,
      unifiedDiff: '',
    },
    commit: null,
    outcome: 'failed',
    reasonCode: 'not-finished',
    nextStep: 'Inspect the attempt report before retrying.',
    applyError: null,
    rollbackApplied: false,
  };
}

function buildProofPacket(report) {
  const fallbackProposal = buildLedgerProposalFallback(report);
  return {
    schemaVersion: OVERNIGHT_ENGINE_SCHEMA_VERSION,
    batchId: report.batchId,
    surfaceId: report.surfaceId,
    attemptId: report.attemptId,
    pipelineMode: report.pipelineMode,
    outcome: report.outcome,
    reasonCode: report.reasonCode,
    failureStage: report.failureStage,
    failureKind: report.failureKind,
    sourceTarget: report.sourceTarget,
    testTarget: report.testTarget,
    logicalExplanation: fallbackProposal.logicalExplanation || null,
    validation: report.validation,
    audit: report.audit,
    diffSummary: report.diffSummary,
    commit: report.commit,
  };
}

function buildHandoffMarkdown(report) {
  const explanation = buildLedgerProposalFallback(report).logicalExplanation || null;
  return [
    '# Overnight Handoff',
    '',
    '## What I tried',
    `- ${explanation ? explanation.problem : 'No valid proposal was produced.'}`,
    '',
    '## Why this surface',
    `- ${explanation ? explanation.whyThisSurface : 'n/a'}`,
    '',
    '## Chosen targets',
    `- Source: ${report.sourceTarget ? `${report.sourceTarget.path} :: ${report.sourceTarget.symbol || report.sourceTarget.anchorText}` : 'n/a'}`,
    `- Test: ${report.testTarget ? `${report.testTarget.path} :: ${report.testTarget.anchorText}` : 'n/a'}`,
    '',
    '## What changed',
    ...report.diffSummary.files.map((filePath) => `- ${filePath}`),
    ...(report.diffSummary.files.length === 0 ? ['- No files were kept.'] : []),
    '',
    '## Validation',
    `- Quick validation passed: ${Boolean(summarizeValidation(report.validation.quick).overallPass)}`,
    `- Full validation passed: ${Boolean(summarizeValidation(report.validation.full).overallPass)}`,
    '',
    '## Audit gate',
    `- Verdict: ${report.audit ? report.audit.verdict : 'not-run'}`,
    ...(report.audit && report.audit.blockers.length > 0 ? report.audit.blockers.map((entry) => `- Blocker: ${entry}`) : []),
    '',
    '## Failure stage',
    `- ${report.failureStage || 'n/a'}`,
    '',
    '## Next move',
    `- ${report.nextStep}`,
  ].join('\n');
}

function writeAttemptArtifacts(paths, report) {
  ensureDir(paths.attemptDir);
  writeJsonAtomic(paths.reportPath, report);
  writeJsonAtomic(paths.proofPath, buildProofPacket(report));
  writeJsonAtomic(paths.auditPath, report.audit || { verdict: 'not-run', blockers: [], evidence: [] });
  writeJsonAtomic(paths.proposalPath, report.proposal || null);
  writeJsonAtomic(paths.planPath, report.plan || null);
  writeJsonAtomic(paths.windowPath, report.windows || null);
  writeJsonAtomic(paths.editorProposalPath, report.editorProposal || null);
  fs.writeFileSync(paths.handoffPath, `${buildHandoffMarkdown(report)}\n`, 'utf8');
  return paths;
}

async function finalizeSurfaceAttempt(manifestPaths, report, surfacePaths, proofPath, handoffPath, ledgerEntry) {
  await updateOvernightManifest(manifestPaths, (manifest) => {
    const surfaceState = manifest.surfaces.find((entry) => entry.surfaceId === report.surfaceId);
    surfaceState.status = report.outcome;
    surfaceState.attemptCount += 1;
    surfaceState.latestAttemptId = report.attemptId;
    surfaceState.latestDecision = report.audit ? report.audit.verdict : null;
    surfaceState.latestReasonCode = report.reasonCode;
    surfaceState.latestProofPath = proofPath;
    surfaceState.latestHandoffPath = handoffPath;
    surfaceState.lastError = report.outcome === 'failed' ? (report.applyError && report.applyError.message) || report.reasonCode : null;
    surfaceState.cooled = report.reasonCode === 'surface-cooled-down';
    if (report.commit && report.commit.sha) {
      surfaceState.latestCommit = report.commit.sha;
      if (report.outcome === 'kept') {
        surfaceState.acceptedCommits.push({
          commit: report.commit.sha,
          summary: proposalSummary(report.proposal),
          attemptId: report.attemptId,
        });
        surfaceState.auditPending = false;
        surfaceState.frozen = true;
      } else if (report.outcome === 'pending-audit') {
        surfaceState.pendingAuditCommits.push({
          commit: report.commit.sha,
          summary: proposalSummary(report.proposal),
          attemptId: report.attemptId,
          proofPath,
          handoffPath,
        });
        surfaceState.auditPending = true;
        surfaceState.frozen = true;
      }
    }
    manifest.ledger.push(ledgerEntry);
  });
  const nextManifest = loadOvernightManifest(manifestPaths.manifestPath);
  const updatedSurfaceState = nextManifest.surfaces.find((entry) => entry.surfaceId === report.surfaceId);
  writeSurfaceStatus(updatedSurfaceState, {
    proofPath,
    handoffPath,
  });
  appendSurfaceHistory({
    surfaceId: report.surfaceId,
    historyPath: surfacePaths.historyPath,
  }, {
    type: 'attempt-finished',
    attemptId: report.attemptId,
    outcome: report.outcome,
    reasonCode: report.reasonCode,
  });
}

function gateProposal(adapter, objective, surface, proposal, ledger, surfaceState) {
  const allBlocks = proposal.codeChanges.concat(proposal.testChanges);
  const touchedPaths = collectProposalPaths(proposal);
  const budget = buildSurfaceBudget(surface);
  if (surfaceState && surfaceState.frozen) {
    return { ok: false, reasonCode: 'surface-frozen', nextStep: 'Wait for a new objective or a new base commit before reopening this surface.' };
  }
  if (surface.risk === 'manual') {
    return { ok: false, reasonCode: 'manual-surface', nextStep: 'Leave this surface for manual review.' };
  }
  if (proposal.codeChanges.length > 0 && proposal.testChanges.length === 0) {
    const nonCodeOnly = proposal.codeChanges.every((entry) => isNonCodePath(entry.path));
    if (!nonCodeOnly) {
      return { ok: false, reasonCode: 'missing-tests', nextStep: 'Add test changes before changing production files.' };
    }
  }
  if (touchedPaths.length > budget.maxFiles || allBlocks.length > budget.maxBlocks) {
    return { ok: false, reasonCode: 'risk-budget-exceeded', nextStep: 'Make the proposal smaller.' };
  }
  for (const targetPath of touchedPaths) {
    if (isManualOnlyPath(adapter, targetPath)) {
      return { ok: false, reasonCode: 'manual-only-path', nextStep: 'Leave manual-only paths untouched.' };
    }
    if (!isPathAllowedForSurface(adapter, surface, targetPath, { includeTests: true })) {
      return { ok: false, reasonCode: 'scope-gate', nextStep: 'Keep edits inside the allowed surface.' };
    }
    if (isForbiddenPath(surface, targetPath)) {
      return { ok: false, reasonCode: 'forbidden-path', nextStep: 'Remove forbidden paths from the proposal.' };
    }
  }
  if (shouldCoolSurfaceDown(ledger, objective.objectiveHash, surface.id)) {
    return { ok: false, reasonCode: 'surface-cooled-down', nextStep: 'Wait for new evidence or a new objective before reopening this surface.' };
  }
  return { ok: true };
}

function getPatchFingerprintOrReject(manifest, objectiveHash, surfaceId, proposal) {
  const patchFingerprint = createPatchFingerprint(objectiveHash, surfaceId, proposal);
  const duplicate = manifest.ledger.find((entry) => (
    entry.objectiveHash === objectiveHash
    && entry.surfaceId === surfaceId
    && entry.patchFingerprint === patchFingerprint
  ));
  if (duplicate) {
    return {
      ok: false,
      patchFingerprint,
      duplicate,
    };
  }
  return {
    ok: true,
    patchFingerprint,
  };
}

function recheckProposalAfterRepair(options) {
  const gate = gateProposal(
    options.adapter,
    options.objective,
    options.surface,
    options.proposal,
    options.manifest.ledger,
    options.surfaceState,
  );
  if (!gate.ok) {
    return {
      ok: false,
      reasonCode: gate.reasonCode,
      nextStep: gate.nextStep,
      patchFingerprint: createPatchFingerprint(options.objective.objectiveHash, options.surface.id, options.proposal),
    };
  }
  const novelty = getPatchFingerprintOrReject(
    options.manifest,
    options.objective.objectiveHash,
    options.surface.id,
    options.proposal,
  );
  if (!novelty.ok) {
    return {
      ok: false,
      reasonCode: 'duplicate',
      nextStep: 'Start from a materially different idea or wait for new evidence.',
      patchFingerprint: novelty.patchFingerprint,
    };
  }
  return {
    ok: true,
    patchFingerprint: novelty.patchFingerprint,
  };
}

function resolveSurfaceValidation(surface, adapter) {
  return {
    baseline: adapter.repo.baselineValidation,
    quick: surface.quickValidation.length > 0 ? surface.quickValidation : adapter.repo.baselineValidation,
    full: surface.fullValidation.length > 0 ? surface.fullValidation : adapter.repo.finalValidation,
  };
}

function buildSurfaceManifestRecord(reportRoot, worktreeRoot, adapter, surface, batchId) {
  const paths = buildSurfacePaths(reportRoot, worktreeRoot, surface.id);
  return {
    surfaceId: surface.id,
    title: surface.title,
    risk: surface.risk,
    worktreePath: paths.worktreePath,
    branchFamily: `${buildBatchBranchPrefix(adapter, batchId)}/${surface.id}`,
    statusPath: paths.statusPath,
    latestPath: paths.latestPath,
    historyPath: paths.historyPath,
    attemptsDir: paths.attemptsDir,
  };
}

function discardAttempt(report, details = {}) {
  report.outcome = 'discarded';
  report.reasonCode = details.reasonCode || 'discarded';
  report.nextStep = details.nextStep || 'Inspect the attempt report before retrying.';
  report.failureStage = details.failureStage || report.failureStage || 'discarded';
  report.failureKind = details.failureKind || report.failureKind || report.reasonCode;
  report.failedPath = details.failedPath || report.failedPath || null;
  report.failedSearchExcerpt = normalizeText(details.failedSearchExcerpt || report.failedSearchExcerpt);
  if (details.applyError) {
    report.applyError = {
      message: normalizeText(details.applyError && details.applyError.message ? details.applyError.message : details.applyError),
    };
  }
  return report;
}

function failAttempt(report, error, details = {}) {
  report.outcome = 'failed';
  report.reasonCode = details.reasonCode || 'worker-failed';
  report.nextStep = details.nextStep || 'Inspect the attempt failure before reopening this surface.';
  report.failureStage = details.failureStage || report.failureStage || 'worker';
  report.failureKind = details.failureKind || report.failureKind || report.reasonCode;
  report.failedPath = details.failedPath || report.failedPath || extractPatchPathFromError(error && error.message ? error.message : error) || null;
  report.failedSearchExcerpt = normalizeText(details.failedSearchExcerpt || report.failedSearchExcerpt);
  report.applyError = {
    message: normalizeText(error && error.message ? error.message : error),
  };
  return report;
}

async function executeLegacySurfaceAttempt(options) {
  const {
    adapter,
    objective,
    manifest,
    surface,
    surfaceState,
    surfacePaths,
    proposalLoader,
    reviewLoader,
    fetchFn,
    report,
    validationCommands,
    syntheticAuditDecision,
  } = options;
  let appliedPatchSet = null;
  let patchFingerprint = null;
  let repairedForApply = false;
  try {
    const promptContext = buildPromptContext(adapter, objective, surface, surfacePaths.worktreePath);
    const noRetryIdeas = listNoRetryIdeas(manifest.ledger, objective.objectiveHash, surface.id);
    const prompt = buildProposalPrompt({
      context: promptContext,
      noRetryIdeas,
    });
    report.failureStage = 'proposal';
    const loaded = await loadProposalWithRepair(prompt, adapter.defaults.proposer, adapter.defaults.repairTurns, {
      proposalLoader,
      surface,
      objective,
      cwd: surfacePaths.worktreePath,
    });
    report.proposal = loaded.proposal;
    report.editorProposal = loaded.proposal;
    report.repairTurnsUsed = loaded.repairTurnsUsed;

    if (proposalHasNoChanges(report.proposal)) {
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: 'no-safe-change',
          nextStep: 'No bounded safe change was identified for this surface.',
          failureStage: 'proposal',
          failureKind: 'no-safe-change',
        }),
      };
    }

    const gate = gateProposal(adapter, objective, surface, report.proposal, manifest.ledger, surfaceState);
    if (!gate.ok) {
      patchFingerprint = createPatchFingerprint(objective.objectiveHash, surface.id, report.proposal);
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: gate.reasonCode,
          nextStep: gate.nextStep,
          failureStage: 'proposal',
          failureKind: gate.reasonCode,
        }),
      };
    }

    const novelty = getPatchFingerprintOrReject(manifest, objective.objectiveHash, surface.id, report.proposal);
    patchFingerprint = novelty.patchFingerprint;
    if (!novelty.ok) {
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: 'duplicate',
          nextStep: 'Start from a materially different idea or wait for new evidence.',
          failureStage: 'proposal',
          failureKind: 'duplicate',
        }),
      };
    }

    report.failureStage = 'apply';
    const combinedPatchSet = report.proposal.codeChanges.concat(report.proposal.testChanges);
    try {
      appliedPatchSet = applyPatchSet(combinedPatchSet, { cwd: surfacePaths.worktreePath });
    } catch (error) {
      if (adapter.defaults.repairTurns <= report.repairTurnsUsed) {
        throw error;
      }
      const repairPrompt = buildRepairPrompt(prompt, JSON.stringify({
        logical_explanation: report.proposal.logicalExplanation,
        code_changes: report.proposal.codeChanges,
        test_changes: report.proposal.testChanges,
      }, null, 2), error.message, {
        cwd: surfacePaths.worktreePath,
      });
      const repaired = await loadProposalWithRepair(repairPrompt, adapter.defaults.proposer, 0, {
        proposalLoader,
        surface,
        objective,
        cwd: surfacePaths.worktreePath,
      });
      report.proposal = repaired.proposal;
      report.editorProposal = repaired.proposal;
      report.repairTurnsUsed += 1;
      if (proposalHasNoChanges(report.proposal)) {
        return {
          patchFingerprint,
          report: discardAttempt(report, {
            reasonCode: 'no-safe-change',
            nextStep: 'Repair collapsed into no safe change.',
            failureStage: 'apply',
            failureKind: 'no-safe-change',
          }),
        };
      }
      const repairedCheck = recheckProposalAfterRepair({
        adapter,
        objective,
        surface,
        manifest,
        surfaceState,
        proposal: report.proposal,
      });
      patchFingerprint = repairedCheck.patchFingerprint;
      if (!repairedCheck.ok) {
        return {
          patchFingerprint,
          report: discardAttempt(report, {
            reasonCode: repairedCheck.reasonCode,
            nextStep: repairedCheck.nextStep,
            failureStage: 'apply',
            failureKind: repairedCheck.reasonCode,
          }),
        };
      }
      appliedPatchSet = applyPatchSet(report.proposal.codeChanges.concat(report.proposal.testChanges), {
        cwd: surfacePaths.worktreePath,
      });
      repairedForApply = true;
    }

    report.diffSummary.files = appliedPatchSet.files.map((entry) => entry.path);
    report.diffSummary.addedLines = appliedPatchSet.summary.addedLines;
    report.diffSummary.removedLines = appliedPatchSet.summary.removedLines;
    report.diffSummary.netLineDelta = appliedPatchSet.summary.netLineDelta;

    report.failureStage = 'validation';
    let quickValidation = runValidationPlan(validationCommands.quick, surfacePaths.worktreePath);
    if (!summarizeValidation(quickValidation).overallPass && classifySyntaxFailure(quickValidation) && report.repairTurnsUsed < adapter.defaults.repairTurns) {
      rollbackAppliedPatchSet(appliedPatchSet);
      report.rollbackApplied = true;
      const repairPrompt = buildRepairPrompt(prompt, JSON.stringify({
        logical_explanation: report.proposal.logicalExplanation,
        code_changes: report.proposal.codeChanges,
        test_changes: report.proposal.testChanges,
      }, null, 2), 'Quick validation failed with a syntax-oriented error.', {
        cwd: surfacePaths.worktreePath,
      });
      const repaired = await loadProposalWithRepair(repairPrompt, adapter.defaults.proposer, 0, {
        proposalLoader,
        surface,
        objective,
        cwd: surfacePaths.worktreePath,
      });
      report.proposal = repaired.proposal;
      report.editorProposal = repaired.proposal;
      report.repairTurnsUsed += 1;
      if (proposalHasNoChanges(report.proposal)) {
        return {
          patchFingerprint,
          report: discardAttempt(report, {
            reasonCode: 'no-safe-change',
            nextStep: 'Validation repair collapsed into no safe change.',
            failureStage: 'validation',
            failureKind: 'no-safe-change',
          }),
        };
      }
      const repairedCheck = recheckProposalAfterRepair({
        adapter,
        objective,
        surface,
        manifest,
        surfaceState,
        proposal: report.proposal,
      });
      patchFingerprint = repairedCheck.patchFingerprint;
      if (!repairedCheck.ok) {
        return {
          patchFingerprint,
          report: discardAttempt(report, {
            reasonCode: repairedCheck.reasonCode,
            nextStep: repairedCheck.nextStep,
            failureStage: 'validation',
            failureKind: repairedCheck.reasonCode,
          }),
        };
      }
      appliedPatchSet = applyPatchSet(report.proposal.codeChanges.concat(report.proposal.testChanges), {
        cwd: surfacePaths.worktreePath,
      });
      quickValidation = runValidationPlan(validationCommands.quick, surfacePaths.worktreePath);
    }
    report.validation.quick = quickValidation;
    if (!summarizeValidation(quickValidation).overallPass) {
      rollbackAppliedPatchSet(appliedPatchSet);
      report.rollbackApplied = true;
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: 'validation-failed',
          nextStep: repairedForApply
            ? 'The repaired proposal still failed validation; try a smaller change.'
            : 'Tighten the change and add stronger tests before retrying.',
          failureStage: 'validation',
          failureKind: 'validation-failed',
        }),
      };
    }

    const fullValidation = runValidationPlan(validationCommands.full, surfacePaths.worktreePath);
    report.validation.full = fullValidation;
    if (!summarizeValidation(fullValidation).overallPass) {
      rollbackAppliedPatchSet(appliedPatchSet);
      report.rollbackApplied = true;
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: 'full-validation-failed',
          nextStep: 'Keep the proof local and retry with a smaller change.',
          failureStage: 'validation',
          failureKind: 'full-validation-failed',
        }),
      };
    }

    report.diffSummary.unifiedDiff = buildUnifiedDiff(surfacePaths.worktreePath, report.diffSummary.files);
    report.failureStage = 'audit';
    report.audit = await runAuditGate({
      packet: buildAuditPacket({
        objective,
        surface,
        proposal: report.proposal,
        baseline: report.validation.baseline,
        quickValidation,
        fullValidation,
        unifiedDiff: report.diffSummary.unifiedDiff,
      }),
      config: adapter.defaults.audit,
      reviewLoader,
      fetchFn,
      syntheticDecision: syntheticAuditDecision || null,
    });
    if (!report.audit) {
      rollbackAppliedPatchSet(appliedPatchSet);
      report.rollbackApplied = true;
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: 'audit-reject',
          nextStep: 'Use the audit blockers as the next design brief.',
          failureStage: 'audit',
          failureKind: 'audit-reject',
        }),
      };
    }
    if (report.audit.verdict === 'deferred') {
      report.failureStage = 'audit';
      const commit = commitAcceptedIteration({
        cwd: surfacePaths.worktreePath,
        summary: proposalSummary(report.proposal),
        appliedChangeSet: {
          files: appliedPatchSet.files,
        },
      });
      if (commit.skipped) {
        return {
          patchFingerprint,
          report: discardAttempt(report, {
            reasonCode: 'no-staged-diff',
            nextStep: 'No persistent diff remained after validation.',
            failureStage: 'commit',
            failureKind: 'no-staged-diff',
          }),
        };
      }
      report.commit = commit;
      report.outcome = 'pending-audit';
      report.reasonCode = 'awaiting-codex-audit';
      report.nextStep = 'Run the deferred Codex audit before morning promotion.';
      report.failureKind = 'awaiting-codex-audit';
      return {
        patchFingerprint,
        report,
      };
    }
    if (report.audit.verdict !== 'accept') {
      rollbackAppliedPatchSet(appliedPatchSet);
      report.rollbackApplied = true;
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: 'audit-reject',
          nextStep: 'Use the audit blockers as the next design brief.',
          failureStage: 'audit',
          failureKind: 'audit-reject',
        }),
      };
    }

    report.failureStage = 'commit';
    const commit = commitAcceptedIteration({
      cwd: surfacePaths.worktreePath,
      summary: proposalSummary(report.proposal),
      appliedChangeSet: {
        files: appliedPatchSet.files,
      },
    });
    if (commit.skipped) {
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: 'no-staged-diff',
          nextStep: 'No persistent diff remained after validation.',
          failureStage: 'commit',
          failureKind: 'no-staged-diff',
        }),
      };
    }
    report.commit = commit;
    report.outcome = 'kept';
    report.reasonCode = 'accepted';
    report.nextStep = 'This surface is ready for manual morning promotion.';
    report.failureStage = 'accepted';
    report.failureKind = null;
    return {
      patchFingerprint,
      report,
    };
  } catch (error) {
    if (appliedPatchSet) {
      rollbackAppliedPatchSet(appliedPatchSet);
      report.rollbackApplied = true;
    }
    return {
      patchFingerprint,
      report: failAttempt(report, error),
    };
  }
}

async function executeStagedSurfaceAttempt(options) {
  const {
    adapter,
    objective,
    manifest,
    surface,
    surfaceState,
    surfacePaths,
    proposalLoader,
    reviewLoader,
    fetchFn,
    report,
    validationCommands,
    syntheticAuditDecision,
  } = options;
  const stagedRepairBudget = Math.min(1, Math.max(0, Number(adapter.defaults.repairTurns) || 0));
  let appliedPatchSet = null;
  let patchFingerprint = null;
  try {
    const promptContext = buildPromptContext(adapter, objective, surface, surfacePaths.worktreePath);
    const noRetryIdeas = listNoRetryIdeas(manifest.ledger, objective.objectiveHash, surface.id);
    const plannerAnchorFailures = listAnchorFailures(manifest.ledger, objective.objectiveHash, surface.id);
    const candidates = mineSurfaceCandidates(adapter, surface, surfacePaths.worktreePath);
    const plannerPrompt = buildPlannerPrompt({
      context: promptContext,
      candidates,
      noRetryIdeas,
      anchorFailures: plannerAnchorFailures,
    });

    report.failureStage = 'planning';
    let loadedPlan;
    try {
      loadedPlan = await loadPlannerWithRepair(
        plannerPrompt,
        adapter.defaults.proposer,
        Math.max(0, stagedRepairBudget - report.repairTurnsUsed),
        {
          proposalLoader,
          surface,
          objective,
          requestKind: 'planner',
          repairRequestKind: 'planner-repair',
        },
      );
    } catch (error) {
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: 'planner-schema-failed',
          nextStep: 'Repair the planner JSON or return no_safe_change.',
          failureStage: 'planning',
          failureKind: 'planner-schema-failed',
          applyError: error,
        }),
      };
    }
    report.plan = loadedPlan.plan;
    report.repairTurnsUsed += loadedPlan.repairTurnsUsed;

    if (!report.plan.sourceTarget && report.plan.sourceTargetId) {
      report.plan.sourceTarget = candidates.registry && candidates.registry.byId
        ? candidates.registry.byId[report.plan.sourceTargetId] || null
        : null;
    }
    if (!report.plan.testTarget && report.plan.testTargetId) {
      report.plan.testTarget = candidates.registry && candidates.registry.byId
        ? candidates.registry.byId[report.plan.testTargetId] || null
        : null;
    }
    if (!report.plan.sourceTarget || !report.plan.testTarget) {
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: 'invalid-target-id',
          nextStep: 'Pick source and test target ids from the provided candidate list.',
          failureStage: 'planning',
          failureKind: 'invalid-target-id',
        }),
      };
    }

    const plannerGate = gatePlannerDecision(adapter, objective, surface, report.plan, manifest.ledger, surfaceState);
    if (plannerGate.noSafeChange) {
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: 'no-safe-change',
          nextStep: 'Planner did not identify a safe bounded target pair.',
          failureStage: 'planning',
          failureKind: 'no-safe-change',
        }),
      };
    }
    if (!plannerGate.ok) {
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: plannerGate.reasonCode,
          nextStep: plannerGate.nextStep,
          failureStage: 'planning',
          failureKind: plannerGate.reasonCode,
        }),
      };
    }
    report.candidateFingerprint = plannerGate.candidateFingerprint;
    report.sourceTarget = report.plan.sourceTarget;
    report.testTarget = report.plan.testTarget;

    try {
      const windows = buildTargetWindows({
        repoRoot: surfacePaths.worktreePath,
        registry: candidates.registry,
        plan: report.plan,
        lineCap: adapter.defaults.staged.windowLineCap,
      });
      report.windows = windows;
      report.windowFingerprint = windows.windowFingerprint;
    } catch (error) {
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: 'invalid-target-window',
          nextStep: 'Pick a source/test pair with a stable named anchor.',
          failureStage: 'windowing',
          failureKind: 'invalid-target-window',
          failedPath: extractPatchPathFromError(error && error.message ? error.message : error) || report.sourceTarget.path,
          applyError: error,
        }),
      };
    }

    report.failureStage = 'editing';
    const editorAnchorFailures = listAnchorFailures(manifest.ledger, objective.objectiveHash, surface.id, report.sourceTarget);
    const editorPrompt = buildEditorPrompt({
      context: promptContext,
      plan: report.plan,
      windows: report.windows,
      noRetryIdeas,
      anchorFailures: editorAnchorFailures,
    });
    let loadedEditor;
    try {
      loadedEditor = await loadStructuredResponseWithRepair(
        editorPrompt,
        adapter.defaults.proposer,
        Math.max(0, stagedRepairBudget - report.repairTurnsUsed),
        parseStagedEditorProposal,
        (currentPrompt, originalText, errorMessage) => buildEditorRepairPrompt({
          prompt: currentPrompt,
          originalText,
          errorMessage,
          plan: report.plan,
          windows: report.windows,
        }),
        {
          proposalLoader,
          surface,
          objective,
          requestKind: 'editor',
          repairRequestKind: 'editor-repair',
        },
      );
    } catch (error) {
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: 'editor-schema-failed',
          nextStep: 'Repair the editor JSON so it matches the staged contract.',
          failureStage: 'editing',
          failureKind: 'editor-schema-failed',
          applyError: error,
        }),
      };
    }
    report.repairTurnsUsed += loadedEditor.repairTurnsUsed;
    report.editorProposal = loadedEditor.parsed;
    report.proposal = null;

    let stagedCheck = validateStagedEditorProposal({
      proposal: report.editorProposal,
      plan: report.plan,
      staged: adapter.defaults.staged,
    });
    let compiledProposal = null;
    if (stagedCheck.ok) {
      compiledProposal = compileEditSketch({
        sketch: report.editorProposal,
        sourceWindow: report.windows.sourceWindow,
        testWindow: report.windows.testWindow,
      });
      if (!compiledProposal.ok) {
        stagedCheck = {
          ok: false,
          reasonCode: compiledProposal.reasonCode,
          nextStep: compiledProposal.message || 'Repair the staged edit sketch inside the chosen target boundary.',
          failureStage: ['out-of-bound-edit', 'stale-target', 'invalid-target-id'].includes(compiledProposal.reasonCode) ? 'preflight' : 'editing',
          failureKind: compiledProposal.failureKind,
          failedPath: compiledProposal.path || null,
          failedSearchExcerpt: '',
          errorMessage: compiledProposal.message || '',
        };
      }
    }
    if (!stagedCheck.ok && ['anchor-preflight-failed', 'out-of-bound-edit', 'stale-target'].includes(stagedCheck.reasonCode) && report.repairTurnsUsed < stagedRepairBudget) {
      const repairPrompt = buildEditorRepairPrompt({
        prompt: editorPrompt,
        originalText: loadedEditor.response.text,
        errorMessage: stagedCheck.errorMessage || stagedCheck.nextStep,
        plan: report.plan,
        windows: report.windows,
      });
      const repairResponse = await callProposer(repairPrompt, adapter.defaults.proposer, {
        proposalLoader,
        surface,
        objective,
        requestKind: 'editor-repair',
        errorMessage: stagedCheck.errorMessage || stagedCheck.nextStep,
        priorText: loadedEditor.response.text,
      });
      report.repairTurnsUsed += 1;
      try {
        report.editorProposal = parseStagedEditorProposal(repairResponse.text);
        report.proposal = null;
      } catch (error) {
        return {
          patchFingerprint,
          report: discardAttempt(report, {
            reasonCode: 'editor-schema-failed',
            nextStep: 'The staged repair still failed to return valid JSON.',
            failureStage: 'editing',
            failureKind: 'editor-schema-failed',
            applyError: error,
          }),
        };
      }
      stagedCheck = validateStagedEditorProposal({
        proposal: report.editorProposal,
        plan: report.plan,
        staged: adapter.defaults.staged,
      });
      if (stagedCheck.ok) {
        compiledProposal = compileEditSketch({
          sketch: report.editorProposal,
          sourceWindow: report.windows.sourceWindow,
          testWindow: report.windows.testWindow,
        });
        if (!compiledProposal.ok) {
          stagedCheck = {
            ok: false,
            reasonCode: compiledProposal.reasonCode,
            nextStep: compiledProposal.message || 'Repair the staged edit sketch inside the chosen target boundary.',
            failureStage: ['out-of-bound-edit', 'stale-target', 'invalid-target-id'].includes(compiledProposal.reasonCode) ? 'preflight' : 'editing',
            failureKind: compiledProposal.failureKind,
            failedPath: compiledProposal.path || null,
            failedSearchExcerpt: '',
            errorMessage: compiledProposal.message || '',
          };
        }
      }
    }

    if (!stagedCheck.ok) {
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: stagedCheck.reasonCode,
          nextStep: stagedCheck.nextStep,
          failureStage: stagedCheck.failureStage,
          failureKind: stagedCheck.failureKind,
          failedPath: stagedCheck.failedPath,
          failedSearchExcerpt: stagedCheck.failedSearchExcerpt,
          applyError: stagedCheck.errorMessage ? { message: stagedCheck.errorMessage } : null,
        }),
      };
    }

    report.proposal = {
      logicalExplanation: compiledProposal.logicalExplanation || report.editorProposal.logicalExplanation,
      codeChanges: compiledProposal.codeChanges,
      testChanges: compiledProposal.testChanges,
    };

    const gate = gateProposal(adapter, objective, surface, report.proposal, manifest.ledger, surfaceState);
    if (!gate.ok) {
      patchFingerprint = createPatchFingerprint(objective.objectiveHash, surface.id, report.proposal);
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: gate.reasonCode,
          nextStep: gate.nextStep,
          failureStage: 'editing',
          failureKind: gate.reasonCode,
        }),
      };
    }

    const novelty = getPatchFingerprintOrReject(manifest, objective.objectiveHash, surface.id, report.proposal);
    patchFingerprint = novelty.patchFingerprint;
    if (!novelty.ok) {
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: 'duplicate',
          nextStep: 'Start from a materially different idea or wait for new evidence.',
          failureStage: 'editing',
          failureKind: 'duplicate',
        }),
      };
    }

    report.failureStage = 'apply';
    try {
      appliedPatchSet = applyPatchSet(report.proposal.codeChanges.concat(report.proposal.testChanges), {
        cwd: surfacePaths.worktreePath,
      });
    } catch (error) {
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: 'anchor-preflight-failed',
          nextStep: 'The staged patch still did not land cleanly inside the chosen windows.',
          failureStage: 'apply',
          failureKind: 'anchor-preflight-failed',
          failedPath: extractPatchPathFromError(error && error.message ? error.message : error) || report.sourceTarget.path,
          failedSearchExcerpt: report.proposal.codeChanges[0] ? report.proposal.codeChanges[0].search : '',
          applyError: error,
        }),
      };
    }

    report.diffSummary.files = appliedPatchSet.files.map((entry) => entry.path);
    report.diffSummary.addedLines = appliedPatchSet.summary.addedLines;
    report.diffSummary.removedLines = appliedPatchSet.summary.removedLines;
    report.diffSummary.netLineDelta = appliedPatchSet.summary.netLineDelta;

    report.failureStage = 'validation';
    const quickValidation = runValidationPlan(validationCommands.quick, surfacePaths.worktreePath);
    report.validation.quick = quickValidation;
    if (!summarizeValidation(quickValidation).overallPass) {
      rollbackAppliedPatchSet(appliedPatchSet);
      report.rollbackApplied = true;
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: 'validation-failed',
          nextStep: 'Keep the staged change smaller or strengthen the paired test proof.',
          failureStage: 'validation',
          failureKind: 'validation-failed',
        }),
      };
    }

    const fullValidation = runValidationPlan(validationCommands.full, surfacePaths.worktreePath);
    report.validation.full = fullValidation;
    if (!summarizeValidation(fullValidation).overallPass) {
      rollbackAppliedPatchSet(appliedPatchSet);
      report.rollbackApplied = true;
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: 'full-validation-failed',
          nextStep: 'Keep the proof local and retry with a smaller staged change.',
          failureStage: 'validation',
          failureKind: 'full-validation-failed',
        }),
      };
    }

    report.diffSummary.unifiedDiff = buildUnifiedDiff(surfacePaths.worktreePath, report.diffSummary.files);
    report.failureStage = 'audit';
    report.audit = await runAuditGate({
      packet: buildAuditPacket({
        objective,
        surface,
        proposal: report.proposal,
        baseline: report.validation.baseline,
        quickValidation,
        fullValidation,
        unifiedDiff: report.diffSummary.unifiedDiff,
      }),
      config: adapter.defaults.audit,
      reviewLoader,
      fetchFn,
      syntheticDecision: syntheticAuditDecision || null,
    });
    if (!report.audit) {
      rollbackAppliedPatchSet(appliedPatchSet);
      report.rollbackApplied = true;
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: 'audit-reject',
          nextStep: 'Use the audit blockers as the next design brief.',
          failureStage: 'audit',
          failureKind: 'audit-reject',
        }),
      };
    }
    if (report.audit.verdict === 'deferred') {
      report.failureStage = 'audit';
      const commit = commitAcceptedIteration({
        cwd: surfacePaths.worktreePath,
        summary: proposalSummary(report.proposal),
        appliedChangeSet: {
          files: appliedPatchSet.files,
        },
      });
      if (commit.skipped) {
        return {
          patchFingerprint,
          report: discardAttempt(report, {
            reasonCode: 'no-staged-diff',
            nextStep: 'No persistent diff remained after validation.',
            failureStage: 'commit',
            failureKind: 'no-staged-diff',
          }),
        };
      }
      report.commit = commit;
      report.outcome = 'pending-audit';
      report.reasonCode = 'awaiting-codex-audit';
      report.nextStep = 'Run the deferred Codex audit before morning promotion.';
      report.failureKind = 'awaiting-codex-audit';
      return {
        patchFingerprint,
        report,
      };
    }
    if (report.audit.verdict !== 'accept') {
      rollbackAppliedPatchSet(appliedPatchSet);
      report.rollbackApplied = true;
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: 'audit-reject',
          nextStep: 'Use the audit blockers as the next design brief.',
          failureStage: 'audit',
          failureKind: 'audit-reject',
        }),
      };
    }

    report.failureStage = 'commit';
    const commit = commitAcceptedIteration({
      cwd: surfacePaths.worktreePath,
      summary: proposalSummary(report.proposal),
      appliedChangeSet: {
        files: appliedPatchSet.files,
      },
    });
    if (commit.skipped) {
      return {
        patchFingerprint,
        report: discardAttempt(report, {
          reasonCode: 'no-staged-diff',
          nextStep: 'No persistent diff remained after validation.',
          failureStage: 'commit',
          failureKind: 'no-staged-diff',
        }),
      };
    }
    report.commit = commit;
    report.outcome = 'kept';
    report.reasonCode = 'accepted';
    report.nextStep = 'This surface is ready for manual morning promotion.';
    report.failureStage = 'accepted';
    report.failureKind = null;
    return {
      patchFingerprint,
      report,
    };
  } catch (error) {
    if (appliedPatchSet) {
      rollbackAppliedPatchSet(appliedPatchSet);
      report.rollbackApplied = true;
    }
    return {
      patchFingerprint,
      report: failAttempt(report, error),
    };
  }
}

async function runSurfaceAttempt(options) {
  const {
    adapter,
    objective,
    manifestPaths,
    manifest,
    surface,
    proposalLoader,
    reviewLoader,
    fetchFn,
  } = options;
  const proposalMode = normalizeProposalMode(options.proposalMode || adapter.defaults.proposalMode || 'legacy');
  const surfaceState = manifest.surfaces.find((entry) => entry.surfaceId === surface.id);
  const attemptId = buildAttemptId(surfaceState.attemptCount + 1);
  const surfacePaths = buildSurfacePaths(manifest.reportRoot, manifest.worktreeRoot, surface.id);
  const attemptPaths = buildAttemptPaths(manifestPaths.rootDir, surface.id, attemptId);
  const branchName = buildSurfaceBranchName(adapter, manifest.batchId, surface.id, attemptId);
  createWorktree(adapter.repoRoot, {
    worktreePath: surfacePaths.worktreePath,
    branchName,
    startPoint: manifest.baseCommit,
  });
  writeSurfaceStatus({
    ...surfaceState,
    status: 'running',
    latestAttemptId: attemptId,
  }, {
    branchName,
  });
  appendOvernightEvent(manifestPaths, {
    type: 'surface-started',
    surfaceId: surface.id,
    attemptId,
    proposalMode,
  });

  const report = createAttemptReport({
    batchId: manifest.batchId,
    objectiveHash: objective.objectiveHash,
    surface,
    attemptId,
    startedAt: nowIso(),
    baseCommit: manifest.baseCommit,
    pipelineMode: proposalMode,
  });
  const validationCommands = resolveSurfaceValidation(surface, adapter);
  const baseline = runValidationPlan(validationCommands.baseline, surfacePaths.worktreePath);
  report.validation.baseline = baseline;
  let patchFingerprint = null;
  try {
    if (gitStatus(surfacePaths.worktreePath).length > 0) {
      throw new Error('Surface worktree must start clean.');
    }
    const execution = proposalMode === 'staged'
      ? await executeStagedSurfaceAttempt({
          adapter,
          objective,
          manifest,
          surface,
          surfaceState,
          surfacePaths,
          proposalLoader,
          reviewLoader,
          fetchFn,
          report,
          validationCommands,
          syntheticAuditDecision: options.syntheticAuditDecision,
        })
      : await executeLegacySurfaceAttempt({
          adapter,
          objective,
          manifest,
          surface,
          surfaceState,
          surfacePaths,
          proposalLoader,
          reviewLoader,
          fetchFn,
          report,
          validationCommands,
          syntheticAuditDecision: options.syntheticAuditDecision,
        });
    patchFingerprint = execution && execution.patchFingerprint ? execution.patchFingerprint : patchFingerprint;
  } catch (error) {
    failAttempt(report, error, {
      failureStage: report.failureStage || 'worker',
    });
  } finally {
    report.finishedAt = nowIso();
    const artifacts = writeAttemptArtifacts(attemptPaths, report);
    const fallbackProposal = buildLedgerProposalFallback(report);
    const fallbackFingerprint = createPatchFingerprint(objective.objectiveHash, surface.id, fallbackProposal);
    const ledgerEntry = buildLedgerEntry(report, objective.objectiveHash, surface, patchFingerprint || fallbackFingerprint);
    await finalizeSurfaceAttempt(manifestPaths, report, surfacePaths, artifacts.proofPath, artifacts.handoffPath, ledgerEntry);
    removeWorktree(adapter.repoRoot, surfacePaths.worktreePath, { force: true });
  }
  return report;
}

async function initOvernightEngine(options = {}) {
  const repoRoot = path.resolve(options.cwd || process.cwd());
  const adapterPath = path.resolve(repoRoot, options.adapterPath || 'proving-ground/autoresearch/overnight.yaml');
  const objectivePath = path.resolve(repoRoot, options.objectivePath || 'proving-ground/autoresearch/objective.yaml');
  if (!options.force && (fs.existsSync(adapterPath) || fs.existsSync(objectivePath))) {
    throw new Error('overnight init refused to overwrite existing files. Use --force to replace them.');
  }
  const starterAdapter = buildStarterAdapter(repoRoot);
  const starterObjective = {
    goal: 'Define the first safe overnight objective for this repo.',
    allowed_surfaces: ['core'],
    success: [
      'Describe the exact safe outcome you want before turning the engine loose.',
    ],
    required_tests: [
      'regression',
    ],
    stop_conditions: [
      'Would require touching a manual-only path.',
    ],
    evidence: [],
    priority: 'medium',
  };
  writeYamlFile(adapterPath, starterAdapter);
  writeYamlFile(objectivePath, starterObjective);
  return {
    adapterPath,
    objectivePath,
  };
}

function validateOvernightAdapter(options = {}) {
  const adapter = loadOvernightAdapter(options.adapterPath, {
    repoRoot: options.cwd || process.cwd(),
  });
  const objective = options.objectivePath
    ? loadOvernightObjective(options.objectivePath, adapter, {
        repoRoot: options.cwd || process.cwd(),
      })
    : null;
  return {
    adapter: {
      sourcePath: adapter.sourcePath,
      surfaceCount: adapter.surfaces.length,
      manualOnlyPaths: adapter.manualOnlyPaths.length,
      sharedPaths: adapter.sharedPaths.length,
      proposalMode: adapter.defaults.proposalMode,
      staged: adapter.defaults.staged,
    },
    objective: objective
      ? {
          sourcePath: objective.sourcePath,
          allowedSurfaces: objective.allowedSurfaces,
          priority: objective.priority,
        }
      : null,
  };
}

async function runOvernightBatch(options = {}) {
  const repoRoot = path.resolve(options.cwd || process.cwd());
  const adapter = loadOvernightAdapter(options.adapterPath, { repoRoot });
  const objective = loadOvernightObjective(options.objectivePath, adapter, { repoRoot });
  const workingTree = getWorkingTreeState(repoRoot);
  if (!options.allowDirty && workingTree.isDirty) {
    throw new Error('Overnight engine requires a clean repo working tree unless --allow-dirty is set.');
  }
  const attemptLimit = Math.max(1, Number(options.attemptLimit) || adapter.defaults.attemptLimit || 1);
  const maxParallelWorkers = Math.max(
    1,
    Number(options.maxParallelWorkers || adapter.defaults.maxParallelWorkers || objective.allowedSurfaces.length || 1),
  );
  const proposalMode = normalizeProposalMode(options.proposalMode || adapter.defaults.proposalMode || 'legacy');
  const maxTotalAttempts = Number.isFinite(Number(options.maxTotalAttempts)) && Number(options.maxTotalAttempts) > 0
    ? Math.max(1, Math.floor(Number(options.maxTotalAttempts)))
    : null;

  const batchId = normalizeText(options.batchId) || buildBatchId('overnight');
  const reportRoot = path.resolve(repoRoot, adapter.defaults.reportDir || DEFAULT_REPORT_DIR, batchId);
  const worktreeRoot = defaultWorktreeRoot(repoRoot, batchId);
  const manifestPaths = buildOvernightManifestPaths(reportRoot);
  ensureDir(reportRoot);
  ensureDir(worktreeRoot);
  const baseCommit = getHeadCommit(repoRoot);
  const promotion = {
    branchName: buildIntegrationBranchName(adapter, batchId),
    worktreePath: path.join(worktreeRoot, 'integration'),
  };
  const manifest = createOvernightManifest({
    batchId,
    repoRoot,
    adapterPath: adapter.sourcePath,
    objectivePath: objective.sourcePath,
    objectiveHash: objective.objectiveHash,
    baseCommit,
    reportRoot,
    worktreeRoot,
    branchPrefix: adapter.defaults.branchPrefix,
    proposalMode,
    attemptLimit,
    maxParallelWorkers,
    maxTotalAttempts,
    promotion,
    surfaces: objective.allowedSurfaces.map((surfaceId) => {
      const surface = findSurface(adapter, surfaceId);
      return buildSurfaceManifestRecord(reportRoot, worktreeRoot, adapter, surface, batchId);
    }),
  });
  writeJsonAtomic(manifestPaths.manifestPath, manifest);
  appendOvernightEvent(manifestPaths, {
    type: 'batch-started',
    batchId,
    objectiveHash: objective.objectiveHash,
    attemptLimit,
    maxParallelWorkers,
    proposalMode,
    maxTotalAttempts,
  });
  let totalAttemptsStarted = 0;
  let wave = 0;
  while (true) {
    const liveManifest = loadOvernightManifest(manifestPaths.manifestPath);
    const runnableSurfaceIds = objective.allowedSurfaces.filter((surfaceId) => {
      const surfaceState = liveManifest.surfaces.find((entry) => entry.surfaceId === surfaceId);
      if (!surfaceState) {
        return false;
      }
      if (surfaceState.attemptCount >= attemptLimit) {
        return false;
      }
      if (surfaceState.frozen || surfaceState.cooled) {
        return false;
      }
      return true;
    });
    if (runnableSurfaceIds.length === 0) {
      break;
    }
    wave += 1;
    appendOvernightEvent(manifestPaths, {
      type: 'wave-started',
      batchId,
      wave,
      runnableSurfaceIds,
      maxParallelWorkers,
    });
    let attemptsThisWave = 0;
    for (let index = 0; index < runnableSurfaceIds.length; index += maxParallelWorkers) {
      if (maxTotalAttempts && totalAttemptsStarted >= maxTotalAttempts) {
        break;
      }
      const currentManifest = loadOvernightManifest(manifestPaths.manifestPath);
      const remainingAttempts = maxTotalAttempts ? Math.max(0, maxTotalAttempts - totalAttemptsStarted) : null;
      const chunkSurfaceIds = runnableSurfaceIds
        .slice(index, index + maxParallelWorkers)
        .filter((surfaceId) => {
          const surfaceState = currentManifest.surfaces.find((entry) => entry.surfaceId === surfaceId);
          if (!surfaceState || surfaceState.attemptCount >= attemptLimit || surfaceState.frozen || surfaceState.cooled) {
            return false;
          }
          return true;
        })
        .slice(0, remainingAttempts === null ? undefined : remainingAttempts);
      if (chunkSurfaceIds.length === 0) {
        continue;
      }
      await Promise.all(chunkSurfaceIds.map(async (surfaceId) => {
        const manifestSnapshot = loadOvernightManifest(manifestPaths.manifestPath);
        const surface = findSurface(adapter, surfaceId);
        await runSurfaceAttempt({
          adapter,
          objective,
          manifestPaths,
          manifest: manifestSnapshot,
          surface,
          proposalLoader: options.proposalLoader,
          reviewLoader: options.reviewLoader,
          fetchFn: options.fetchFn,
          syntheticAuditDecision: options.syntheticAuditDecision,
          proposalMode,
        });
      }));
      totalAttemptsStarted += chunkSurfaceIds.length;
      attemptsThisWave += chunkSurfaceIds.length;
    }
    appendOvernightEvent(manifestPaths, {
      type: 'wave-finished',
      batchId,
      wave,
      attemptsThisWave,
      totalAttemptsStarted,
    });
    if (attemptsThisWave === 0) {
      break;
    }
    if (maxTotalAttempts && totalAttemptsStarted >= maxTotalAttempts) {
      break;
    }
  }

  await updateOvernightManifest(manifestPaths, (next) => {
    next.status = 'awaiting-promotion';
  });
  appendOvernightEvent(manifestPaths, {
    type: 'batch-finished',
    batchId,
    totalAttemptsStarted,
    waveCount: wave,
  });
  return inspectOvernightBatch({
    batchDir: reportRoot,
  });
}

function inspectOvernightBatch(options = {}) {
  const batchDir = path.resolve(options.batchDir);
  const manifestPaths = buildOvernightManifestPaths(batchDir);
  const manifest = loadOvernightManifest(manifestPaths.manifestPath);
  const stageCounts = {};
  const reasonCounts = {};
  const outcomeCounts = {};
  const targetWindowFailures = {};
  for (const entry of Array.isArray(manifest.ledger) ? manifest.ledger : []) {
    const stageKey = normalizeText(entry.stage) || 'unknown';
    const reasonKey = normalizeText(entry.reasonCode) || 'unknown';
    const outcomeKey = normalizeText(entry.outcome) || 'unknown';
    stageCounts[stageKey] = (stageCounts[stageKey] || 0) + 1;
    reasonCounts[reasonKey] = (reasonCounts[reasonKey] || 0) + 1;
    outcomeCounts[outcomeKey] = (outcomeCounts[outcomeKey] || 0) + 1;
    if (['invalid-target-window', 'anchor-preflight-failed', 'out-of-bound-edit', 'stale-target', 'invalid-target-id'].includes(entry.failureKind)) {
      const sourceTarget = entry.sourceTarget || {};
      const targetKey = buildSourceTargetKey(sourceTarget) || 'unknown';
      if (!targetWindowFailures[targetKey]) {
        targetWindowFailures[targetKey] = {
          count: 0,
          failureKinds: {},
          paths: new Set(),
        };
      }
      targetWindowFailures[targetKey].count += 1;
      targetWindowFailures[targetKey].failureKinds[entry.failureKind] = (targetWindowFailures[targetKey].failureKinds[entry.failureKind] || 0) + 1;
      if (entry.failedPath) {
        targetWindowFailures[targetKey].paths.add(entry.failedPath);
      }
    }
  }
  const normalizedTargetWindowFailures = Object.fromEntries(
    Object.entries(targetWindowFailures).map(([key, value]) => [key, {
      count: value.count,
      failureKinds: value.failureKinds,
      paths: Array.from(value.paths),
    }]),
  );
  return {
    ...manifest,
    summary: {
      pipelineMode: manifest.proposalMode || 'legacy',
      outcomes: outcomeCounts,
      reasonCodes: reasonCounts,
      stages: stageCounts,
      targetWindowFailures: normalizedTargetWindowFailures,
      pendingAuditSurfaces: manifest.surfaces
        .filter((surface) => Boolean(surface.auditPending) || (Array.isArray(surface.pendingAuditCommits) && surface.pendingAuditCommits.length > 0))
        .map((surface) => ({
          surfaceId: surface.surfaceId,
          pendingAuditCount: Array.isArray(surface.pendingAuditCommits) ? surface.pendingAuditCommits.length : 0,
          latestCommit: surface.latestCommit,
          latestProofPath: surface.latestProofPath,
        })),
    },
  };
}

async function resolveDeferredAudit(options = {}) {
  const batchDir = path.resolve(options.batchDir);
  const surfaceId = normalizeText(options.surfaceId);
  const attemptId = normalizeText(options.attemptId);
  const verdict = normalizeText(options.verdict).toLowerCase();
  const note = normalizeText(options.note || options.notes);
  if (!surfaceId) {
    throw new Error('resolveDeferredAudit requires surfaceId');
  }
  if (!['accept', 'reject'].includes(verdict)) {
    throw new Error('resolveDeferredAudit verdict must be accept or reject');
  }
  const manifestPaths = buildOvernightManifestPaths(batchDir);
  const manifest = loadOvernightManifest(manifestPaths.manifestPath);
  const surface = manifest.surfaces.find((entry) => entry.surfaceId === surfaceId);
  if (!surface) {
    throw new Error(`Unknown surface in deferred audit: ${surfaceId}`);
  }
  const pendingAuditCommits = Array.isArray(surface.pendingAuditCommits) ? surface.pendingAuditCommits : [];
  const pending = attemptId
    ? pendingAuditCommits.find((entry) => entry.attemptId === attemptId)
    : pendingAuditCommits[0];
  if (!pending) {
    throw new Error(`No pending deferred audit found for ${surfaceId}${attemptId ? ` (${attemptId})` : ''}`);
  }

  const attemptPaths = buildAttemptPaths(manifestPaths.rootDir, surfaceId, pending.attemptId);
  const report = readJsonIfExists(attemptPaths.reportPath);
  if (!report) {
    throw new Error(`Attempt report not found for deferred audit: ${attemptPaths.reportPath}`);
  }

  report.audit = {
    verdict,
    confidence: 1,
    blockers: verdict === 'reject'
      ? [note || 'Deferred Codex audit rejected this attempt.']
      : [],
    evidence: [note || `Deferred Codex audit ${verdict === 'accept' ? 'accepted' : 'rejected'} this attempt.`],
    provider: 'codex',
    model: normalizeText(options.model) || 'subagent',
  };
  if (verdict === 'accept') {
    report.outcome = 'kept';
    report.reasonCode = 'accepted';
    report.nextStep = 'This surface is ready for manual morning promotion.';
    report.failureStage = 'accepted';
    report.failureKind = null;
  } else {
    report.outcome = 'discarded';
    report.reasonCode = 'audit-reject';
    report.nextStep = 'Use the Codex audit blockers as the next design brief.';
    report.failureStage = 'audit';
    report.failureKind = 'audit-reject';
  }
  writeAttemptArtifacts(attemptPaths, report);

  await updateOvernightManifest(manifestPaths, (next) => {
    const surfaceState = next.surfaces.find((entry) => entry.surfaceId === surfaceId);
    const pendingIndex = Array.isArray(surfaceState.pendingAuditCommits)
      ? surfaceState.pendingAuditCommits.findIndex((entry) => entry.attemptId === pending.attemptId)
      : -1;
    if (pendingIndex !== -1) {
      surfaceState.pendingAuditCommits.splice(pendingIndex, 1);
    }
    surfaceState.auditPending = surfaceState.pendingAuditCommits.length > 0;
    surfaceState.latestDecision = verdict;
    surfaceState.latestReasonCode = report.reasonCode;
    surfaceState.latestProofPath = attemptPaths.proofPath;
    surfaceState.latestHandoffPath = attemptPaths.handoffPath;
    surfaceState.latestCommit = pending.commit;
    surfaceState.status = report.outcome;
    surfaceState.lastError = null;
    if (verdict === 'accept') {
      const alreadyAccepted = surfaceState.acceptedCommits.some((entry) => entry.commit === pending.commit);
      if (!alreadyAccepted) {
        surfaceState.acceptedCommits.push({
          commit: pending.commit,
          summary: pending.summary,
          attemptId: pending.attemptId,
        });
      }
    }
    surfaceState.frozen = surfaceState.auditPending || surfaceState.acceptedCommits.length > 0;

    const ledgerEntry = next.ledger.find((entry) => entry.surfaceId === surfaceId && entry.attemptId === pending.attemptId);
    if (ledgerEntry) {
      ledgerEntry.outcome = report.outcome;
      ledgerEntry.reasonCode = report.reasonCode;
      ledgerEntry.failureKind = report.failureKind || report.reasonCode;
      ledgerEntry.stage = report.failureStage || (verdict === 'accept' ? 'accepted' : 'audit');
      ledgerEntry.commitSha = pending.commit;
      ledgerEntry.summary = proposalSummary(report.proposal);
    }
  });
  const nextManifest = loadOvernightManifest(manifestPaths.manifestPath);
  const updatedSurfaceState = nextManifest.surfaces.find((entry) => entry.surfaceId === surfaceId);
  writeSurfaceStatus(updatedSurfaceState, {
    proofPath: attemptPaths.proofPath,
    handoffPath: attemptPaths.handoffPath,
  });
  appendSurfaceHistory({
    surfaceId,
    historyPath: updatedSurfaceState.historyPath,
  }, {
    type: 'deferred-audit-resolved',
    attemptId: pending.attemptId,
    outcome: report.outcome,
    reasonCode: report.reasonCode,
    verdict,
  });
  appendOvernightEvent(manifestPaths, {
    type: 'deferred-audit-resolved',
    surfaceId,
    attemptId: pending.attemptId,
    verdict,
  });

  return {
    batchDir,
    surfaceId,
    attemptId: pending.attemptId,
    verdict,
    commit: pending.commit,
    proofPath: attemptPaths.proofPath,
    handoffPath: attemptPaths.handoffPath,
  };
}

async function promoteOvernightBatch(options = {}) {
  const batchDir = path.resolve(options.batchDir);
  const manifestPaths = buildOvernightManifestPaths(batchDir);
  const manifest = loadOvernightManifest(manifestPaths.manifestPath);
  const adapter = loadOvernightAdapter(manifest.adapterPath, { repoRoot: manifest.repoRoot });
  const integration = manifest.promotion;
  if (fs.existsSync(integration.worktreePath)) {
    removeWorktree(manifest.repoRoot, integration.worktreePath, { force: true });
  }
  deleteBranch(manifest.repoRoot, integration.branchName, { force: true });
  createWorktree(manifest.repoRoot, {
    worktreePath: integration.worktreePath,
    branchName: integration.branchName,
    startPoint: manifest.baseCommit,
  });
  const pickedCommits = [];
  const conflicts = [];
  try {
    for (const surface of manifest.surfaces) {
      for (const accepted of surface.acceptedCommits) {
        const result = runGit(integration.worktreePath, ['cherry-pick', accepted.commit]);
        if (result.exitCode !== 0) {
          conflicts.push({
            surfaceId: surface.surfaceId,
            commit: accepted.commit,
            message: result.stderr || result.stdout,
          });
          runGit(integration.worktreePath, ['cherry-pick', '--abort']);
          break;
        }
        pickedCommits.push({
          surfaceId: surface.surfaceId,
          commit: accepted.commit,
        });
      }
      if (conflicts.length > 0) {
        break;
      }
    }
    const validation = conflicts.length === 0
      ? runValidationPlan(adapter.repo.finalValidation, integration.worktreePath)
      : null;
    await updateOvernightManifest(manifestPaths, (next) => {
      next.promotion.status = conflicts.length > 0
        ? 'blocked'
        : (summarizeValidation(validation).overallPass ? 'ready' : 'validated');
      next.promotion.latestCommit = conflicts.length === 0 ? getHeadCommit(integration.worktreePath) : null;
      next.promotion.validation = validation;
      next.promotion.conflicts = conflicts;
      next.promotion.promotedAt = nowIso();
    });
    return {
      pickedCommits,
      conflicts,
      validation,
      ready: conflicts.length === 0 && summarizeValidation(validation).overallPass,
    };
  } finally {
    appendOvernightEvent(manifestPaths, {
      type: 'batch-promoted',
      pickedCommits: pickedCommits.length,
      conflicts: conflicts.length,
    });
  }
}

async function cleanupOvernightBatch(options = {}) {
  const batchDir = path.resolve(options.batchDir);
  const manifestPaths = buildOvernightManifestPaths(batchDir);
  const manifest = loadOvernightManifest(manifestPaths.manifestPath);
  const cleaned = [];
  for (const surface of manifest.surfaces) {
    if (fs.existsSync(surface.worktreePath)) {
      removeWorktree(manifest.repoRoot, surface.worktreePath, { force: true });
      cleaned.push(surface.surfaceId);
    }
  }
  if (fs.existsSync(manifest.promotion.worktreePath)) {
    removeWorktree(manifest.repoRoot, manifest.promotion.worktreePath, { force: true });
  }
  appendOvernightEvent(manifestPaths, {
    type: 'batch-cleaned',
    cleaned,
  });
  return {
    cleaned,
  };
}

module.exports = {
  buildProposalPrompt,
  cleanupOvernightBatch,
  initOvernightEngine,
  inspectOvernightBatch,
  loadProposalWithRepair,
  parseProposal,
  promoteOvernightBatch,
  resolveDeferredAudit,
  runOvernightBatch,
  runSurfaceAttempt,
  validateOvernightAdapter,
};
