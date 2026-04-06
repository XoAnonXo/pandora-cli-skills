const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const {
  buildDecisionSummary,
  buildInvalidProposalFallback,
  buildSectionCoverage,
  buildSectionPrompt,
  captureHelpContext,
  createEmptyValidationSummary,
  loadCliSectionResearchConfig,
  loadFocusFileContext,
  parseSectionProposal,
  selectGateSummary,
} = require('./cli_section_autoresearch.cjs');
const {
  commitAcceptedIteration,
  getWorkingTreeState,
  runValidationPlan,
} = require('./autoresearch_loop.cjs');
const {
  applyChangeSet,
  rollbackAppliedChangeSet,
} = require('./change_set_engine.cjs');
const { callMinimaxChat } = require('./minimax_client.cjs');
const {
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
  slugifyText,
  writeJsonAtomic,
} = require('./baton_common.cjs');
const {
  appendLaneHistory,
  BATON_MANIFEST_SCHEMA_VERSION,
  buildManifestPaths,
  createBatchManifest,
  findLane,
  loadBatchManifest,
  markBatchEvent,
  updateBatchManifest,
  writeLaneStatus,
} = require('./baton_manifest.cjs');
const {
  createWorktree,
  deleteBranch,
  getHeadCommit,
  gitStatus,
  prepareExistingWorktree,
  removeWorktree,
  runGit,
} = require('./baton_worktree_manager.cjs');
const {
  DEFAULT_REVIEWER_ROLES,
  reviewProposalWithCouncil,
} = require('./baton_council.cjs');

const CLI_BATON_SCHEMA_VERSION = '1.0.0';
const DEFAULT_BATON_REPORT_DIR = 'proving-ground/reports/baton';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  return value === true;
}

function loadCliBatonConfig(options = {}) {
  const sectionConfig = loadCliSectionResearchConfig(options);
  delete require.cache[sectionConfig.sourcePath];
  const raw = require(sectionConfig.sourcePath);
  const baton = raw && raw.baton && typeof raw.baton === 'object' ? raw.baton : {};
  const worker = raw && raw.worker && typeof raw.worker === 'object' ? raw.worker : {};
  const council = raw && raw.council && typeof raw.council === 'object' ? raw.council : {};
  const integration = raw && raw.integration && typeof raw.integration === 'object' ? raw.integration : {};
  const validation = raw && raw.validation && typeof raw.validation === 'object' ? raw.validation : {};
  const laneCount = Math.max(1, Math.round(normalizeNumber(baton.laneCount, sectionConfig.sections.length)));
  return {
    ...sectionConfig,
    baton: {
      reportDir: normalizeText(baton.reportDir) || DEFAULT_BATON_REPORT_DIR,
      laneCount,
      maxParallelWorkers: Math.max(1, Math.round(normalizeNumber(baton.maxParallelWorkers, laneCount))),
      heartbeatTimeoutMs: Math.max(1000, normalizeNumber(baton.heartbeatTimeoutMs, 30_000)),
      cleanupPolicy: normalizeText(baton.cleanupPolicy) || 'manual',
      pausePollMs: Math.max(100, normalizeNumber(baton.pausePollMs, 250)),
      worktreeRoot: normalizeText(baton.worktreeRoot) || '',
    },
    worker: {
      timeBudgetMs: Math.max(1000, normalizeNumber(worker.timeBudgetMs, 30 * 60 * 1000)),
      tokenBudget: Math.max(0, normalizeNumber(worker.tokenBudget, 120_000)),
      promptVersion: normalizeText(worker.promptVersion) || 'baton-v1',
      oneAttempt: normalizeBoolean(worker.oneAttempt, true),
      maxModelCalls: Math.max(1, Math.round(normalizeNumber(worker.maxModelCalls, 1))),
    },
    council: {
      roles: Array.isArray(council.roles) && council.roles.length > 0 ? council.roles.slice() : DEFAULT_REVIEWER_ROLES.slice(),
      quorum: Math.max(1, Math.round(normalizeNumber(council.quorum, 4))),
      reviseCap: Math.max(0, Math.round(normalizeNumber(council.reviseCap, 1))),
      dedupe: council.dedupe !== false,
    },
    integration: {
      branchPrefix: normalizeText(integration.branchPrefix) || 'codex/baton',
      mergeOrder: normalizeText(integration.mergeOrder) || 'lane-index',
      promotionBranch: normalizeText(integration.promotionBranch) || 'main',
      worktreeName: normalizeText(integration.worktreeName) || 'integration',
    },
    validation: {
      syntheticModel: validation.syntheticModel === true,
      syntheticCouncil: validation.syntheticCouncil === true,
      runRealWorktrees: validation.runRealWorktrees !== false,
      failureInjection: validation.failureInjection && typeof validation.failureInjection === 'object'
        ? cloneJson(validation.failureInjection)
        : {},
    },
  };
}

function readCommandDescriptors(cwd, descriptorPath) {
  const absolutePath = path.resolve(cwd, descriptorPath);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function selectSections(config, sectionId) {
  const selected = normalizeText(sectionId)
    ? config.sections.filter((section) => section.id === normalizeText(sectionId))
    : config.sections.slice();
  if (selected.length === 0) {
    throw new Error(`Unknown CLI baton section: ${sectionId}`);
  }
  return selected;
}

function buildBatchBranchPrefix(config, batchId) {
  return `${config.integration.branchPrefix}/${batchId}`;
}

function buildLaneBranchName(config, batchId, lane, attemptId) {
  return `${buildBatchBranchPrefix(config, batchId)}/${lane.laneId}/${attemptId}`;
}

function buildIntegrationBranchName(config, batchId) {
  return `${buildBatchBranchPrefix(config, batchId)}/${config.integration.worktreeName}`;
}

function buildLanePaths(reportRoot, worktreeRoot, laneId) {
  const laneDir = path.join(reportRoot, 'lanes', laneId);
  return {
    laneDir,
    statusPath: path.join(laneDir, 'status.json'),
    historyPath: path.join(laneDir, 'history.ndjson'),
    latestPath: path.join(laneDir, 'latest.json'),
    attemptsDir: path.join(laneDir, 'attempts'),
    worktreePath: path.join(worktreeRoot, laneId),
  };
}

function buildAttemptPaths(batchDir, laneId, attemptId) {
  const attemptDir = path.join(batchDir, 'lanes', laneId, 'attempts', attemptId);
  return {
    attemptDir,
    statusPath: path.join(attemptDir, 'status.json'),
    eventsPath: path.join(attemptDir, 'events.ndjson'),
    metricsPath: path.join(attemptDir, 'metrics.json'),
    councilPath: path.join(attemptDir, 'council.json'),
    reportPath: path.join(attemptDir, 'report.json'),
    handoffJsonPath: path.join(attemptDir, 'handoff.json'),
    handoffMdPath: path.join(attemptDir, 'handoff.md'),
    stdoutPath: path.join(attemptDir, 'worker.stdout.log'),
    stderrPath: path.join(attemptDir, 'worker.stderr.log'),
  };
}

function buildSyntheticProposal(section, laneId, attemptIndex, options = {}) {
  const targetPath = options.conflictPath
    ? normalizeText(options.conflictPath)
    : normalizeText(section.focusFiles[0]);
  if (!targetPath) {
    return {
      hypothesisId: 'synthetic-empty',
      summary: 'Synthetic validation run had no focus files to touch.',
      why: 'This lane can only validate handoff and council plumbing.',
      targetFiles: [],
      expectedImpact: {
        clarity: 'No runtime change',
        speed: 'No runtime change',
        simplicity: 'Validation-only synthetic attempt',
      },
      validationNotes: ['No change-set emitted because the lane has no focus files.'],
      changeSet: [],
    };
  }
  return {
    hypothesisId: `synthetic-${laneId}-${attemptIndex}`,
    summary: `Add a baton validation marker for ${laneId}`,
    why: 'The hybrid validation run needs one safe, deterministic lane-local change.',
    targetFiles: [targetPath],
    expectedImpact: {
      clarity: 'No user-facing runtime change',
      speed: 'No user-facing runtime change',
      simplicity: 'Proves the baton can carry a bounded edit',
    },
    validationNotes: ['Verify the lane-local commit and the handoff chain.'],
    changeSet: [
      {
        kind: 'insert_before_once',
        path: targetPath,
        anchor: 'module.exports = {',
        text: `// baton-validation ${laneId} ${attemptIndex}\n`,
      },
    ],
  };
}

function buildSyntheticCouncilDecision(options = {}) {
  if (options.outcome === 'reject') {
    return {
      reviews: DEFAULT_REVIEWER_ROLES.map((role) => ({
        role,
        verdict: role === 'safety' ? 'reject' : 'revise',
        confidence: 1,
        blockers: [`${role} reviewer blocked the proposal during synthetic validation.`],
        evidence: [`Synthetic council forced ${options.outcome}.`],
      })),
    };
  }
  return {
    reviews: DEFAULT_REVIEWER_ROLES.map((role) => ({
      role,
      verdict: 'accept',
      confidence: 1,
      blockers: [],
      evidence: [`Synthetic ${role} reviewer accepted the proposal.`],
    })),
  };
}

function buildSyntheticScenario(config, laneId, attemptIndex) {
  const failure = config.validation && config.validation.failureInjection ? config.validation.failureInjection : {};
  const malformed = Array.isArray(failure.malformedProposalLaneIds) && failure.malformedProposalLaneIds.includes(laneId) && attemptIndex === 1;
  const rejected = Array.isArray(failure.rejectLaneIds) && failure.rejectLaneIds.includes(laneId) && attemptIndex === 1;
  const wrongLane = Array.isArray(failure.wrongLaneWriteLaneIds) && failure.wrongLaneWriteLaneIds.includes(laneId) && attemptIndex === 1;
  const conflictPair = Array.isArray(failure.integrationConflictLaneIds) ? failure.integrationConflictLaneIds : [];
  return {
    malformed,
    rejected,
    wrongLane,
    conflictPair,
  };
}

function validateProposalScope(proposal, section) {
  const allowed = new Set((section.focusFiles || []).map((filePath) => normalizeText(filePath)));
  const touched = Array.isArray(proposal.changeSet) ? proposal.changeSet.map((operation) => normalizeText(operation.path)).filter(Boolean) : [];
  const invalid = touched.filter((filePath) => !allowed.has(filePath));
  if (invalid.length > 0) {
    throw new Error(`Proposal touches files outside the lane scope: ${invalid.join(', ')}`);
  }
}

function buildWorkerPrompt(section, baseline, helpContext, focusFiles, previousHandoff, workerConfig) {
  const prompt = buildSectionPrompt({
    goal: `Make this CLI section clearer, faster, or simpler with one bounded change. Prompt version: ${workerConfig.promptVersion}.`,
    section,
    baseline,
    helpContext,
    focusFiles,
  });
  const batonAddon = {
    oneAttemptOnly: true,
    previousHandoff: previousHandoff || null,
    stopRules: [
      'You have one proposal attempt only.',
      'If the code you need is not visible, return an empty changeSet.',
      'Do not propose files outside the lane scope.',
    ],
  };
  return {
    systemPrompt: prompt.systemPrompt,
    userPrompt: `${prompt.userPrompt}\n\n${JSON.stringify(batonAddon, null, 2)}`,
  };
}

function buildAttemptHandoff(report) {
  return {
    batonId: report.batonId,
    parentBatonId: report.parentBatonId,
    laneId: report.laneId,
    workerId: report.workerId,
    attemptIndex: report.attemptIndex,
    status: report.outcome,
    reasonCode: report.reasonCode,
    proposal: report.proposal,
    councilDecision: report.council ? report.council.decision : null,
    changeSet: report.appliedChangeSet || null,
    validation: report.validation,
    diffSummary: report.diffSummary,
    rollbackApplied: report.rollbackApplied,
    headCommit: report.headCommit,
    nextStep: report.nextStep,
    createdAt: report.finishedAt,
  };
}

function buildAttemptHandoffMarkdown(report) {
  return [
    '# CLI Baton Handoff',
    '',
    '## What I tried',
    `- Lane: ${report.laneId}`,
    `- Attempt: ${report.attemptIndex}`,
    `- Proposal: ${report.proposal && report.proposal.summary ? report.proposal.summary : 'n/a'}`,
    '',
    '## Why I tried it',
    `- ${report.proposal && report.proposal.why ? report.proposal.why : report.reasonCode}`,
    '',
    '## What changed',
    report.diffSummary && Array.isArray(report.diffSummary.files) && report.diffSummary.files.length > 0
      ? `- Files: ${report.diffSummary.files.join(', ')}`
      : '- No files were kept.',
    '',
    '## Council',
    `- Outcome: ${report.council ? report.council.decision.outcome : 'n/a'}`,
    '',
    '## Validation',
    `- Quick gate: ${report.validation.quick.summary.overallPass}`,
    `- Full gate: ${report.validation.full ? report.validation.full.summary.overallPass : false}`,
    '',
    '## Next worker',
    `- ${report.nextStep}`,
    '',
  ].join('\n');
}

function writeAttemptArtifacts(paths, report) {
  ensureDir(paths.attemptDir);
  const handoff = buildAttemptHandoff(report);
  writeJsonAtomic(paths.statusPath, {
    laneId: report.laneId,
    attemptId: report.attemptId,
    stage: 'finished',
    heartbeatAt: report.finishedAt,
    outcome: report.outcome,
    reasonCode: report.reasonCode,
    workerId: report.workerId,
  });
  writeJsonAtomic(paths.metricsPath, report.metrics);
  writeJsonAtomic(paths.councilPath, report.council || { packet: null, reviews: [], decision: null });
  writeJsonAtomic(paths.reportPath, report);
  writeJsonAtomic(paths.handoffJsonPath, handoff);
  fs.writeFileSync(paths.handoffMdPath, `${buildAttemptHandoffMarkdown(report)}\n`, 'utf8');
  return {
    reportPath: paths.reportPath,
    handoffJsonPath: paths.handoffJsonPath,
    handoffMdPath: paths.handoffMdPath,
    councilPath: paths.councilPath,
  };
}

function summarizeBatch(manifest) {
  const laneSummary = manifest.lanes.map((lane) => ({
    laneId: lane.laneId,
    title: lane.title,
    status: lane.status,
    attemptCount: lane.attemptCount,
    latestDecision: lane.latestDecision,
    latestCommit: lane.latestCommit,
    acceptedCommits: Array.isArray(lane.acceptedCommits) ? lane.acceptedCommits.slice() : [],
  }));
  return {
    schemaVersion: manifest.schemaVersion,
    batchId: manifest.batchId,
    paused: manifest.paused,
    baseCommit: manifest.baseCommit,
    integration: manifest.integration,
    lanes: laneSummary,
  };
}

function summarizeLane(lane) {
  return cloneJson(lane);
}

async function updateLaneLifecycle(paths, laneId, mutator) {
  return updateBatchManifest(paths, (manifest) => {
    const lane = findLane(manifest, laneId);
    if (!lane) {
      throw new Error(`Lane not found: ${laneId}`);
    }
    return mutator(lane, manifest);
  });
}

async function setLaneRunning(paths, laneId, state) {
  return updateLaneLifecycle(paths, laneId, (lane) => {
    lane.status = 'running';
    lane.activeAttemptId = state.attemptId;
    lane.currentBranch = state.branchName;
    lane.claimToken = state.claimToken;
    lane.workerPid = state.workerPid;
    lane.heartbeatAt = nowIso();
    lane.startedAt = state.startedAt;
    lane.finishedAt = null;
    lane.lastError = null;
    lane.attemptCount = state.attemptIndex;
  });
}

async function finalizeLane(paths, laneId, finalState) {
  return updateLaneLifecycle(paths, laneId, (lane) => {
    lane.status = finalState.status;
    lane.activeAttemptId = null;
    lane.latestAttemptDir = finalState.attemptDir;
    lane.latestHandoffPath = finalState.handoffPath;
    lane.latestReportPath = finalState.reportPath;
    lane.latestDecision = finalState.latestDecision;
    lane.latestCommit = finalState.latestCommit || lane.latestCommit;
    if (!Array.isArray(lane.acceptedCommits)) {
      lane.acceptedCommits = [];
    }
    if (finalState.status === 'kept' && finalState.latestCommit) {
      const exists = lane.acceptedCommits.some((entry) => entry && entry.commit === finalState.latestCommit);
      if (!exists) {
        lane.acceptedCommits.push({
          attemptId: finalState.attemptId,
          branchName: finalState.branchName,
          commit: finalState.latestCommit,
          finishedAt: finalState.finishedAt,
        });
      }
    }
    lane.currentBranch = finalState.branchName;
    lane.claimToken = null;
    lane.workerPid = null;
    lane.heartbeatAt = finalState.finishedAt;
    lane.finishedAt = finalState.finishedAt;
    lane.lastError = finalState.lastError || null;
    lane.requeueRequested = false;
  });
}

async function bumpLaneHeartbeat(paths, laneId, stage) {
  return updateLaneLifecycle(paths, laneId, (lane) => {
    lane.heartbeatAt = nowIso();
    lane.status = stage || lane.status;
  });
}

function writeAttemptEvent(paths, event) {
  return appendNdjson(paths.eventsPath, {
    time: nowIso(),
    ...event,
  });
}

async function runCliBatonWorker(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const batchDir = path.resolve(options.batchDir);
  const manifestPaths = buildManifestPaths(batchDir);
  const manifest = loadBatchManifest(manifestPaths.manifestPath);
  const lane = findLane(manifest, options.laneId);
  if (!lane) {
    throw new Error(`Unknown lane: ${options.laneId}`);
  }
  const config = loadCliBatonConfig({
    cwd,
    configPath: manifest.configRelativePath || 'proving-ground/config/cli_section_research.cjs',
  });
  const section = config.sections.find((entry) => entry.id === lane.sectionId);
  if (!section) {
    throw new Error(`Section not found for lane ${lane.laneId}: ${lane.sectionId}`);
  }

  const attemptIndex = Number(options.attemptIndex);
  const attemptId = normalizeText(options.attemptId) || buildAttemptId(attemptIndex);
  const claimToken = normalizeText(options.claimToken) || createFingerprint({
    batchId: manifest.batchId,
    laneId: lane.laneId,
    attemptId,
    pid: process.pid,
  });
  const startedAt = nowIso();
  const attemptPaths = buildAttemptPaths(batchDir, lane.laneId, attemptId);
  const previousHandoff = readJsonIfExists(lane.latestHandoffPath, null);
  ensureDir(attemptPaths.attemptDir);

  await setLaneRunning(manifestPaths, lane.laneId, {
    attemptId,
    attemptIndex,
    branchName: options.branchName,
    claimToken,
    workerPid: process.pid,
    startedAt,
  });
  appendLaneHistory(lane, {
    type: 'attempt-started',
    attemptId,
    attemptIndex,
    branchName: options.branchName,
  });
  writeLaneStatus(lane, {
    stage: 'running',
    workerPid: process.pid,
    activeAttemptId: attemptId,
    heartbeatAt: startedAt,
  });
  writeAttemptEvent(attemptPaths, {
    type: 'attempt-started',
    laneId: lane.laneId,
    attemptId,
    attemptIndex,
  });

  const report = {
    schemaVersion: CLI_BATON_SCHEMA_VERSION,
    batchId: manifest.batchId,
    batonId: `${manifest.batchId}:${lane.laneId}:${attemptId}`,
    parentBatonId: previousHandoff && previousHandoff.batonId ? previousHandoff.batonId : null,
    laneId: lane.laneId,
    laneIndex: lane.laneIndex,
    sectionId: lane.sectionId,
    title: lane.title,
    workerId: options.workerId || buildWorkerId(),
    attemptId,
    attemptIndex,
    startedAt,
    finishedAt: null,
    promptVersion: config.worker.promptVersion,
    proposal: null,
    council: null,
    validation: {
      quick: createEmptyValidationSummary(),
      full: createEmptyValidationSummary(),
      baseline: null,
    },
    appliedChangeSet: null,
    diffSummary: {
      files: [],
      addedLines: 0,
      removedLines: 0,
      netLineDelta: 0,
    },
    rollbackApplied: false,
    headCommit: null,
    outcome: 'failed',
    reasonCode: 'not-finished',
    nextStep: 'Review the worker report before launching another baton.',
    metrics: {
      modelUsage: {},
      councilReviews: 0,
      elapsedMs: 0,
    },
  };

  try {
    const dirtyTree = getWorkingTreeState(cwd);
    if (dirtyTree.isDirty) {
      throw new Error('Worker worktree must start clean.');
    }

    await bumpLaneHeartbeat(manifestPaths, lane.laneId, 'baseline');
    const baseline = {
      quick: runValidationPlan(section.quickValidation, cwd),
      full: section.fullValidation.length > 0
        ? runValidationPlan(section.fullValidation, cwd)
        : createEmptyValidationSummary(),
    };
    report.validation.baseline = baseline;
    const helpContext = captureHelpContext(section.helpCommands, cwd);
    const focusFiles = loadFocusFileContext(section.focusFiles, cwd);
    const syntheticScenario = buildSyntheticScenario(config, lane.laneId, attemptIndex);

    await bumpLaneHeartbeat(manifestPaths, lane.laneId, 'proposing');
    let proposal = null;
    let model = null;
    if (options.syntheticModel || config.validation.syntheticModel) {
      if (syntheticScenario.malformed) {
        proposal = buildInvalidProposalFallback('Synthetic validation injected a malformed proposal.');
        report.reasonCode = 'proposal-parse-failed';
      } else {
        const conflictPath = syntheticScenario.conflictPair.includes(lane.laneId)
          ? section.focusFiles[0]
          : null;
        const wrongLanePath = syntheticScenario.wrongLane
          ? ((config.sections.find((entry) => entry.id !== section.id && Array.isArray(entry.focusFiles) && entry.focusFiles.length > 0) || {}).focusFiles || [])[0] || null
          : null;
        proposal = buildSyntheticProposal(section, lane.laneId, attemptIndex, {
          conflictPath,
        });
        if (wrongLanePath) {
          proposal.targetFiles = [wrongLanePath];
          proposal.changeSet[0].path = wrongLanePath;
        }
      }
      model = {
        provider: 'synthetic',
        model: 'synthetic-baton-worker',
        usage: {},
        elapsedMs: 0,
      };
    } else {
      const prompt = buildWorkerPrompt(section, baseline, helpContext, focusFiles, previousHandoff, config.worker);
      const startedModelAt = Date.now();
      const response = await callMinimaxChat({
        ...config.model,
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        temperature: 0.2,
      });
      model = {
        provider: response.provider,
        model: response.model,
        usage: response.usage || {},
        elapsedMs: Date.now() - startedModelAt,
      };
      try {
        proposal = parseSectionProposal(response.text);
      } catch (error) {
        proposal = buildInvalidProposalFallback(error && error.message ? error.message : error);
        report.reasonCode = 'proposal-parse-failed';
      }
    }
    report.metrics.modelUsage = model.usage || {};
    report.proposal = proposal;

    if (!proposal || !Array.isArray(proposal.changeSet)) {
      throw new Error('Worker proposal was malformed.');
    }

    await bumpLaneHeartbeat(manifestPaths, lane.laneId, 'reviewing');
    report.council = await reviewProposalWithCouncil({
      laneId: lane.laneId,
      attemptIndex,
      proposal,
      baseline: baseline.quick.summary,
      section,
      previousHandoff,
      promptVersion: config.worker.promptVersion,
      modelConfig: config.model,
      councilConfig: config.council,
      syntheticDecision: (options.syntheticCouncil || config.validation.syntheticCouncil || syntheticScenario.rejected)
        ? buildSyntheticCouncilDecision({ outcome: syntheticScenario.rejected ? 'reject' : 'accept' })
        : null,
    });
    report.metrics.councilReviews = Array.isArray(report.council.reviews) ? report.council.reviews.length : 0;
    writeJsonAtomic(attemptPaths.councilPath, report.council);

    if (report.reasonCode === 'proposal-parse-failed') {
      report.outcome = 'failed';
      report.nextStep = 'Start a fresh worker with tighter proposal constraints.';
      return report;
    }

    if (report.council.decision.outcome !== 'accept') {
      report.outcome = 'discarded';
      report.reasonCode = `council-${report.council.decision.outcome}`;
      report.nextStep = 'Start a fresh worker with the council blockers as the new baton brief.';
      return report;
    }

    validateProposalScope(proposal, section);
    if (gitStatus(cwd).length > 0) {
      throw new Error('Worker worktree became dirty before change application.');
    }

    await bumpLaneHeartbeat(manifestPaths, lane.laneId, 'applying');
    let appliedChangeSet = null;
    try {
      appliedChangeSet = applyChangeSet(proposal.changeSet, { cwd });
      report.appliedChangeSet = {
        operations: appliedChangeSet.operations.length,
        files: appliedChangeSet.files,
        summary: appliedChangeSet.summary,
      };
      report.diffSummary = {
        files: appliedChangeSet.files.map((file) => file.path),
        addedLines: appliedChangeSet.summary.addedLines,
        removedLines: appliedChangeSet.summary.removedLines,
        netLineDelta: appliedChangeSet.summary.netLineDelta,
      };

      await bumpLaneHeartbeat(manifestPaths, lane.laneId, 'validating');
      const postValidation = {
        quick: runValidationPlan(section.quickValidation, cwd),
        full: createEmptyValidationSummary(),
      };
      const quickDecision = buildDecisionSummary({
        baselineGate: baseline.quick.summary,
        candidateGate: postValidation.quick.summary,
        appliedChangeSet,
        section,
        maxSlowdownRatio: config.researchLoop.maxSlowdownRatio,
      });
      const shouldRunFull = postValidation.quick.summary.overallPass && (
        quickDecision.improvedSpeed
        || quickDecision.simplificationSignal
        || (section.allowNeutralKeep && quickDecision.compactSignal)
      );
      if (shouldRunFull && section.fullValidation.length > 0) {
        postValidation.full = runValidationPlan(section.fullValidation, cwd);
      }
      const finalDecision = shouldRunFull
        ? buildDecisionSummary({
            baselineGate: selectGateSummary(baseline),
            candidateGate: selectGateSummary(postValidation),
            appliedChangeSet,
            section,
            maxSlowdownRatio: config.researchLoop.maxSlowdownRatio,
          })
        : {
            ...quickDecision,
            keep: false,
            reason: 'not-promising-after-quick-gate',
          };
      if ((options.syntheticModel || config.validation.syntheticModel) && finalDecision.noRegression && finalDecision.compactSignal) {
        finalDecision.keep = true;
        delete finalDecision.reason;
      }
      report.validation.quick = postValidation.quick;
      report.validation.full = postValidation.full;
      report.validation.decision = finalDecision;

      if (finalDecision.keep) {
        const commit = commitAcceptedIteration({
          cwd,
          iteration: {
            index: attemptIndex,
            proposal,
          },
          appliedChangeSet,
        });
        if (commit.skipped) {
          report.outcome = 'discarded';
          report.reasonCode = 'no-staged-diff';
          rollbackAppliedChangeSet(appliedChangeSet);
          report.rollbackApplied = true;
        } else {
          report.outcome = 'kept';
          report.reasonCode = 'accepted';
          report.headCommit = commit.sha;
          report.commit = commit;
          report.nextStep = 'Route this kept commit into integration promotion once the batch is ready.';
        }
      } else {
        rollbackAppliedChangeSet(appliedChangeSet);
        report.rollbackApplied = true;
        report.outcome = 'discarded';
        report.reasonCode = normalizeText(finalDecision.reason) || 'validation-regressed';
        report.nextStep = 'Start a fresh worker with a smaller or cleaner proposal.';
      }
    } catch (error) {
      if (appliedChangeSet) {
        rollbackAppliedChangeSet(appliedChangeSet);
        report.rollbackApplied = true;
      }
      report.outcome = 'failed';
      report.reasonCode = 'change-apply-failed';
      report.applyError = {
        message: normalizeText(error && error.message ? error.message : error),
      };
      report.nextStep = 'Inspect the failed proposal and start a fresh worker with a safer lane-scoped edit.';
    }
    return report;
  } catch (error) {
    report.outcome = report.outcome === 'kept' ? 'kept' : 'failed';
    report.reasonCode = report.reasonCode === 'accepted' ? 'accepted' : (report.reasonCode || 'worker-failed');
    report.error = {
      message: normalizeText(error && error.message ? error.message : error),
    };
    if (!report.nextStep || /Review the worker report/.test(report.nextStep)) {
      report.nextStep = 'Inspect the worker failure, then issue a fresh baton for the lane.';
    }
    return report;
  } finally {
    report.finishedAt = nowIso();
    report.metrics.elapsedMs = Date.now() - new Date(startedAt).getTime();
    if (!report.headCommit) {
      try {
        report.headCommit = getHeadCommit(cwd);
      } catch {
        report.headCommit = null;
      }
    }
    const artifactPaths = writeAttemptArtifacts(attemptPaths, report);
    appendLaneHistory(lane, {
      type: 'attempt-finished',
      attemptId,
      attemptIndex,
      outcome: report.outcome,
      reasonCode: report.reasonCode,
      headCommit: report.headCommit,
    });
    await finalizeLane(manifestPaths, lane.laneId, {
      status: report.outcome,
      attemptDir: attemptPaths.attemptDir,
      handoffPath: artifactPaths.handoffJsonPath,
      reportPath: artifactPaths.reportPath,
      latestDecision: report.council ? report.council.decision : null,
      latestCommit: report.outcome === 'kept' ? report.headCommit : lane.latestCommit,
      attemptId,
      branchName: options.branchName,
      finishedAt: report.finishedAt,
      lastError: report.error ? report.error.message : null,
    });
    writeLaneStatus({
      ...lane,
      status: report.outcome,
      latestDecision: report.council ? report.council.decision : null,
      latestCommit: report.outcome === 'kept' ? report.headCommit : lane.latestCommit,
      workerPid: null,
      heartbeatAt: report.finishedAt,
      finishedAt: report.finishedAt,
      lastError: report.error ? report.error.message : null,
      attemptCount: attemptIndex,
      activeAttemptId: null,
    }, {
      stage: 'finished',
      attemptId,
    });
    writeAttemptEvent(attemptPaths, {
      type: 'attempt-finished',
      outcome: report.outcome,
      reasonCode: report.reasonCode,
      headCommit: report.headCommit,
    });
  }
}

function spawnWorkerProcess(workerScriptPath, args, logPaths, cwd) {
  ensureDir(path.dirname(logPaths.stdoutPath));
  const stdout = fs.openSync(logPaths.stdoutPath, 'a');
  const stderr = fs.openSync(logPaths.stderrPath, 'a');
  const child = spawn(process.execPath, [workerScriptPath, ...args], {
    cwd,
    stdio: ['ignore', stdout, stderr],
  });
  return new Promise((resolve) => {
    child.on('error', (error) => {
      fs.closeSync(stdout);
      fs.closeSync(stderr);
      resolve({
        code: 1,
        signal: null,
        pid: child.pid,
        error: normalizeText(error && error.message ? error.message : error),
      });
    });
    child.on('close', (code, signal) => {
      fs.closeSync(stdout);
      fs.closeSync(stderr);
      resolve({
        code: code === null ? 1 : code,
        signal: signal || null,
        pid: child.pid,
      });
    });
  });
}

async function prepareLaneForAttempt(repoRoot, config, batchId, laneRecord, attemptIndex, baseRef) {
  const attemptId = buildAttemptId(attemptIndex);
  const branchName = buildLaneBranchName(config, batchId, laneRecord, attemptId);
  if (fs.existsSync(laneRecord.worktreePath)) {
    prepareExistingWorktree(laneRecord.worktreePath, {
      branchName,
      startPoint: baseRef,
    });
  } else {
    createWorktree(repoRoot, {
      worktreePath: laneRecord.worktreePath,
      branchName,
      startPoint: baseRef,
    });
  }
  return {
    attemptId,
    branchName,
  };
}

async function runBatchWave(options) {
  const manifestPaths = buildManifestPaths(options.batchDir);
  await reclaimStaleLaneWorkers(manifestPaths, options.config);
  const manifest = loadBatchManifest(manifestPaths.manifestPath);
  const runnableLanes = manifest.lanes.filter((lane) => (
    lane.attemptCount < options.attemptsPerLane
    && lane.status !== 'paused'
  ));
  const maxParallelWorkers = Math.max(
    1,
    Number(options.config.baton.maxParallelWorkers || manifest.maxParallelWorkers || runnableLanes.length),
  );
  const results = [];
  for (let index = 0; index < runnableLanes.length; index += maxParallelWorkers) {
    const manifestState = loadBatchManifest(manifestPaths.manifestPath);
    if (manifestState.paused) {
      break;
    }
    const chunk = runnableLanes.slice(index, index + maxParallelWorkers);
    const workers = chunk.map(async (lane) => {
      const attemptIndex = lane.attemptCount + 1;
      const baseRef = lane.latestCommit || manifest.baseCommit;
      const { attemptId, branchName } = await prepareLaneForAttempt(
        options.repoRoot,
        options.config,
        manifest.batchId,
        lane,
        attemptIndex,
        baseRef,
      );
      const attemptPaths = buildAttemptPaths(options.batchDir, lane.laneId, attemptId);
      const workerScriptPath = path.join(lane.worktreePath, 'scripts', 'run_cli_baton_autoresearch.cjs');
      return spawnWorkerProcess(workerScriptPath, [
        'worker',
        '--batch-dir', options.batchDir,
        '--lane', lane.laneId,
        '--attempt-index', String(attemptIndex),
        '--attempt-id', attemptId,
        '--branch-name', branchName,
        ...(options.syntheticModel ? ['--synthetic-model'] : []),
        ...(options.syntheticCouncil ? ['--synthetic-council'] : []),
      ], attemptPaths, lane.worktreePath);
    });
    results.push(...(await Promise.all(workers)));
  }
  return results;
}

async function initializeBatchState(options) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const config = loadCliBatonConfig({
    cwd,
    configPath: options.configPath,
    allowDirty: options.allowDirty,
  });
  const dirtyTree = getWorkingTreeState(cwd);
  if (dirtyTree.isDirty && !config.researchLoop.allowDirtyTree) {
    throw new Error('CLI baton workspace mode requires a clean git tree.');
  }
  const commandDescriptors = readCommandDescriptors(cwd, config.commandDescriptorPath);
  const coverage = buildSectionCoverage(commandDescriptors, config.sections);
  if (coverage.uncoveredCommands.length > 0) {
    throw new Error(`CLI section coverage is incomplete. Uncovered commands: ${coverage.uncoveredCommands.join(', ')}`);
  }
  const sections = selectSections(config, options.section);
  const batchId = normalizeText(options.batchId) || buildBatchId('cli-baton');
  const reportRoot = path.resolve(cwd, config.baton.reportDir, batchId);
  const manifestPaths = buildManifestPaths(reportRoot);
  if (fs.existsSync(manifestPaths.manifestPath)) {
    return {
      cwd,
      config,
      batchDir: reportRoot,
      manifestPaths,
      manifest: loadBatchManifest(manifestPaths.manifestPath),
    };
  }
  const worktreeRoot = config.baton.worktreeRoot
    ? path.resolve(cwd, config.baton.worktreeRoot, batchId)
    : defaultWorktreeRoot(cwd, batchId);
  const integrationBranch = buildIntegrationBranchName(config, batchId);
  const integrationWorktreePath = path.join(worktreeRoot, config.integration.worktreeName);
  const lanes = sections.map((section, index) => {
    const laneId = formatLaneId(index + 1);
    const lanePaths = buildLanePaths(reportRoot, worktreeRoot, laneId);
    return {
      laneId,
      laneIndex: index + 1,
      sectionId: section.id,
      title: section.title,
      commandPrefixes: section.commandPrefixes,
      focusFiles: section.focusFiles,
      branchFamily: `${buildBatchBranchPrefix(config, batchId)}/${laneId}`,
      worktreePath: lanePaths.worktreePath,
      statusPath: lanePaths.statusPath,
      historyPath: lanePaths.historyPath,
      latestPath: lanePaths.latestPath,
      attemptsDir: lanePaths.attemptsDir,
    };
  });
  const batchDir = reportRoot;
  ensureDir(batchDir);
  const manifest = createBatchManifest({
    batchId,
    repoRoot: cwd,
    goal: config.researchLoop.goal,
    configSourcePath: config.sourcePath,
    configRelativePath: path.relative(cwd, config.sourcePath).split(path.sep).join('/'),
    baseCommit: getHeadCommit(cwd),
    cleanupPolicy: config.baton.cleanupPolicy,
    maxParallelWorkers: config.baton.maxParallelWorkers,
    worktreeRoot,
    reportRoot,
    integration: {
      branchName: integrationBranch,
      worktreePath: integrationWorktreePath,
    },
    lanes,
  });
  writeJsonAtomic(manifestPaths.manifestPath, manifest);
  markBatchEvent(manifestPaths, {
    type: 'batch-created',
    batchId,
    laneCount: lanes.length,
  });
  return {
    cwd,
    config,
    batchDir,
    manifestPaths,
    manifest,
  };
}

async function runCliBatonBatch(options = {}) {
  const state = await initializeBatchState(options);
  const attemptsPerLane = Math.max(1, Math.round(normalizeNumber(
    options.attemptsPerLane,
    options.validationMode ? 2 : 1,
  )));
  for (let wave = 1; wave <= attemptsPerLane; wave += 1) {
    const manifest = loadBatchManifest(state.manifestPaths.manifestPath);
    if (manifest.paused) {
      break;
    }
    markBatchEvent(state.manifestPaths, {
      type: 'wave-started',
      wave,
    });
    await runBatchWave({
      batchDir: state.batchDir,
      repoRoot: state.cwd,
      config: state.config,
      attemptsPerLane,
      syntheticModel: options.syntheticModel || state.config.validation.syntheticModel,
      syntheticCouncil: options.syntheticCouncil || state.config.validation.syntheticCouncil,
    });
    markBatchEvent(state.manifestPaths, {
      type: 'wave-finished',
      wave,
    });
  }
  const manifest = loadBatchManifest(state.manifestPaths.manifestPath);
  writeJsonAtomic(path.join(state.batchDir, 'report.json'), summarizeBatch(manifest));
  return {
    batchDir: state.batchDir,
    manifest,
  };
}

function inspectCliBatonBatch(options = {}) {
  const manifestPaths = buildManifestPaths(path.resolve(options.batchDir));
  return summarizeBatch(loadBatchManifest(manifestPaths.manifestPath));
}

function inspectCliBatonLane(options = {}) {
  const manifestPaths = buildManifestPaths(path.resolve(options.batchDir));
  const manifest = loadBatchManifest(manifestPaths.manifestPath);
  const lane = findLane(manifest, options.laneId);
  if (!lane) {
    throw new Error(`Unknown lane: ${options.laneId}`);
  }
  return {
    lane: summarizeLane(lane),
    latestHandoff: readJsonIfExists(lane.latestHandoffPath, null),
    latestReport: readJsonIfExists(lane.latestReportPath, null),
  };
}

function inspectCliBatonLatestHandoff(options = {}) {
  return inspectCliBatonLane(options).latestHandoff;
}

async function pauseCliBatonBatch(options = {}) {
  const manifestPaths = buildManifestPaths(path.resolve(options.batchDir));
  await updateBatchManifest(manifestPaths, (manifest) => {
    manifest.paused = true;
    manifest.pauseReason = normalizeText(options.reason) || 'paused-by-operator';
  });
  markBatchEvent(manifestPaths, {
    type: 'batch-paused',
    reason: normalizeText(options.reason) || 'paused-by-operator',
  });
  return inspectCliBatonBatch(options);
}

async function resumeCliBatonBatch(options = {}) {
  const manifestPaths = buildManifestPaths(path.resolve(options.batchDir));
  await updateBatchManifest(manifestPaths, (manifest) => {
    manifest.paused = false;
    manifest.pauseReason = null;
  });
  markBatchEvent(manifestPaths, {
    type: 'batch-resumed',
  });
  return inspectCliBatonBatch(options);
}

async function requeueCliBatonLane(options = {}) {
  const manifestPaths = buildManifestPaths(path.resolve(options.batchDir));
  await updateBatchManifest(manifestPaths, (manifest) => {
    const lane = findLane(manifest, options.laneId);
    if (!lane) {
      throw new Error(`Unknown lane: ${options.laneId}`);
    }
    lane.status = 'pending';
    lane.requeueRequested = true;
    lane.requestedAttempts = Math.max(lane.requestedAttempts || lane.attemptCount, lane.attemptCount + 1);
  });
  markBatchEvent(manifestPaths, {
    type: 'lane-requeued',
    laneId: options.laneId,
  });
  return inspectCliBatonLane(options);
}

async function archiveCliBatonLane(options = {}) {
  const batchDir = path.resolve(options.batchDir);
  const manifestPaths = buildManifestPaths(batchDir);
  const manifest = loadBatchManifest(manifestPaths.manifestPath);
  const lane = findLane(manifest, options.laneId);
  if (!lane) {
    throw new Error(`Unknown lane: ${options.laneId}`);
  }
  if (lane.activeAttemptId) {
    throw new Error(`Lane is still active and cannot be archived: ${options.laneId}`);
  }
  if (fs.existsSync(lane.worktreePath)) {
    removeWorktree(manifest.repoRoot, lane.worktreePath, { force: true });
  }
  if (options.removeBranch && lane.currentBranch) {
    deleteBranch(manifest.repoRoot, lane.currentBranch, { force: true });
  }
  await updateBatchManifest(manifestPaths, (next) => {
    const nextLane = findLane(next, options.laneId);
    nextLane.status = 'archived';
    nextLane.finishedAt = nowIso();
    nextLane.lastError = null;
    nextLane.activeAttemptId = null;
    nextLane.workerPid = null;
    nextLane.claimToken = null;
  });
  const refreshed = loadBatchManifest(manifestPaths.manifestPath);
  const refreshedLane = findLane(refreshed, options.laneId);
  appendLaneHistory(refreshedLane, {
    type: 'lane-archived',
    removeBranch: options.removeBranch === true,
  });
  writeLaneStatus(refreshedLane, {
    stage: 'archived',
  });
  markBatchEvent(manifestPaths, {
    type: 'lane-archived',
    laneId: options.laneId,
    removeBranch: options.removeBranch === true,
  });
  return inspectCliBatonLane({
    batchDir,
    laneId: options.laneId,
  });
}

function isHeartbeatExpired(heartbeatAt, timeoutMs) {
  const heartbeatMs = Date.parse(String(heartbeatAt || ''));
  if (!Number.isFinite(heartbeatMs)) {
    return true;
  }
  return (Date.now() - heartbeatMs) >= Math.max(1000, Number(timeoutMs) || 30_000);
}

async function reclaimStaleLaneWorkers(manifestPaths, config) {
  const reclaimed = [];
  await updateBatchManifest(manifestPaths, (manifest) => {
    for (const lane of manifest.lanes) {
      if (!lane.activeAttemptId) {
        continue;
      }
      const previousPid = lane.workerPid;
      if (!isHeartbeatExpired(lane.heartbeatAt, config.baton.heartbeatTimeoutMs)) {
        continue;
      }
      if (previousPid && isProcessAlive(previousPid)) {
        continue;
      }
      const previousAttemptId = lane.activeAttemptId;
      lane.status = 'pending';
      lane.activeAttemptId = null;
      lane.claimToken = null;
      lane.workerPid = null;
      lane.heartbeatAt = nowIso();
      lane.finishedAt = lane.heartbeatAt;
      lane.requeueRequested = true;
      lane.requestedAttempts = Math.max(lane.requestedAttempts || lane.attemptCount, lane.attemptCount + 1);
      lane.lastError = `stale-worker-reclaimed:${previousAttemptId}`;
      reclaimed.push({
        laneId: lane.laneId,
        previousAttemptId,
        previousPid,
        lane: cloneJson(lane),
      });
    }
  });
  for (const entry of reclaimed) {
    appendLaneHistory(entry.lane, {
      type: 'lane-reclaimed',
      previousAttemptId: entry.previousAttemptId,
      previousPid: entry.previousPid,
    });
    writeLaneStatus(entry.lane, {
      stage: 'reclaimed',
      reclaimedAttemptId: entry.previousAttemptId,
      reclaimedWorkerPid: entry.previousPid,
    });
    markBatchEvent(manifestPaths, {
      type: 'lane-reclaimed',
      laneId: entry.laneId,
      previousAttemptId: entry.previousAttemptId,
      previousPid: entry.previousPid,
    });
  }
  return reclaimed;
}

async function promoteCliBatonBatch(options = {}) {
  const batchDir = path.resolve(options.batchDir);
  const manifestPaths = buildManifestPaths(batchDir);
  const manifest = loadBatchManifest(manifestPaths.manifestPath);
  const config = loadCliBatonConfig({
    cwd: manifest.repoRoot,
    configPath: path.relative(manifest.repoRoot, manifest.configSourcePath),
  });
  const integration = manifest.integration;
  const repoRoot = manifest.repoRoot;
  if (fs.existsSync(integration.worktreePath)) {
    removeWorktree(repoRoot, integration.worktreePath, { force: true });
  }
  deleteBranch(repoRoot, integration.branchName, { force: true });
  createWorktree(repoRoot, {
    worktreePath: integration.worktreePath,
    branchName: integration.branchName,
    startPoint: manifest.baseCommit,
  });

  const promotion = {
    branchName: integration.branchName,
    worktreePath: integration.worktreePath,
    pickedCommits: [],
    conflicts: [],
    validation: null,
    ready: false,
  };
  try {
    const orderedLanes = manifest.lanes.slice().sort((left, right) => left.laneIndex - right.laneIndex);
    for (const lane of orderedLanes) {
      const commits = Array.isArray(lane.acceptedCommits) ? lane.acceptedCommits.slice() : [];
      if (commits.length === 0) {
        continue;
      }
      for (const accepted of commits) {
        const cherryPick = runGit(integration.worktreePath, ['cherry-pick', accepted.commit]);
        if (cherryPick.exitCode !== 0) {
          promotion.conflicts.push({
            laneId: lane.laneId,
            commit: accepted.commit,
            message: cherryPick.stderr || cherryPick.stdout,
          });
          runGit(integration.worktreePath, ['cherry-pick', '--abort']);
          break;
        }
        promotion.pickedCommits.push({
          laneId: lane.laneId,
          commit: accepted.commit,
        });
      }
      if (promotion.conflicts.length > 0) {
        break;
      }
    }
    if (promotion.conflicts.length === 0) {
      promotion.validation = runValidationPlan(config.researchLoop.finalValidation, integration.worktreePath);
      promotion.ready = Boolean(promotion.validation.summary.overallPass);
    }
  } finally {
    await updateBatchManifest(manifestPaths, (next) => {
      next.integration.status = promotion.ready ? 'ready' : (promotion.conflicts.length > 0 ? 'blocked' : 'validated');
      next.integration.latestCommit = promotion.ready ? getHeadCommit(integration.worktreePath) : null;
      next.integration.validation = promotion.validation;
      next.integration.lastError = promotion.conflicts.length > 0 ? promotion.conflicts[0].message : null;
      next.integration.promotedAt = nowIso();
    });
    markBatchEvent(manifestPaths, {
      type: 'batch-promoted',
      ready: promotion.ready,
      pickedCommits: promotion.pickedCommits.length,
      conflicts: promotion.conflicts.length,
    });
  }
  return promotion;
}

async function cleanupCliBatonBatch(options = {}) {
  const batchDir = path.resolve(options.batchDir);
  const manifestPaths = buildManifestPaths(batchDir);
  const manifest = loadBatchManifest(manifestPaths.manifestPath);
  const cleaned = [];
  for (const lane of manifest.lanes) {
    if (lane.activeAttemptId) {
      continue;
    }
    if (fs.existsSync(lane.worktreePath)) {
      removeWorktree(manifest.repoRoot, lane.worktreePath, { force: true });
      cleaned.push(lane.laneId);
    }
    if (options.removeBranches && lane.currentBranch) {
      deleteBranch(manifest.repoRoot, lane.currentBranch, { force: true });
    }
  }
  if (fs.existsSync(manifest.integration.worktreePath)) {
    removeWorktree(manifest.repoRoot, manifest.integration.worktreePath, { force: true });
  }
  markBatchEvent(manifestPaths, {
    type: 'batch-cleaned',
    cleanedLanes: cleaned,
  });
  return {
    cleanedLanes: cleaned,
  };
}

async function runCliBatonValidation(options = {}) {
  const success = await runCliBatonBatch({
    ...options,
    syntheticModel: true,
    syntheticCouncil: true,
    validationMode: true,
    attemptsPerLane: 2,
  });
  const promotion = await promoteCliBatonBatch({
    batchDir: success.batchDir,
  });
  return {
    batch: inspectCliBatonBatch({ batchDir: success.batchDir }),
    promotion,
  };
}

module.exports = {
  BATON_MANIFEST_SCHEMA_VERSION,
  CLI_BATON_SCHEMA_VERSION,
  archiveCliBatonLane,
  cleanupCliBatonBatch,
  inspectCliBatonLatestHandoff,
  inspectCliBatonBatch,
  inspectCliBatonLane,
  loadCliBatonConfig,
  pauseCliBatonBatch,
  promoteCliBatonBatch,
  requeueCliBatonLane,
  resumeCliBatonBatch,
  runCliBatonBatch,
  runCliBatonValidation,
  runCliBatonWorker,
};
