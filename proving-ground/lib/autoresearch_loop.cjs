const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { normalizeSimulationLock } = require('../../benchmarks/lib/simulation_world.cjs');
const { applyChangeSet, rollbackAppliedChangeSet } = require('./change_set_engine.cjs');
const { callMinimaxChat, DEFAULT_MINIMAX_API_KEY_ENV } = require('./minimax_client.cjs');
const { loadScenarioFamily } = require('./scenario_family_loader.cjs');
const { extractJsonObjectFromText } = require('./baton_common.cjs');

const RESEARCH_SCHEMA_VERSION = '1.0.0';
const DEFAULT_GOAL = 'Make Pandora faster, more simple, and more resilient without adding benchmark-only behavior.';
const DEFAULT_QUICK_VALIDATION = Object.freeze([
  'node --test tests/unit/simulation_world.test.cjs',
  'node --test tests/unit/proving_ground_scenario_loader.test.cjs',
  'node --test tests/unit/mirror_replay_service.test.cjs',
]);
const DEFAULT_FULL_VALIDATION = Object.freeze([
  'node --test tests/unit/benchmark_runner.test.cjs',
  'node --test tests/cli/mirror_replay.integration.test.cjs',
]);
const DEFAULT_FOCUS_FILES = Object.freeze([
  'benchmarks/lib/runner.cjs',
  'benchmarks/lib/simulation_world.cjs',
  'cli/lib/mirror_replay_service.cjs',
  'proving-ground/lib/scenario_family_loader.cjs',
]);

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeStringList(list, fallback = []) {
  const source = Array.isArray(list) && list.length > 0 ? list : fallback;
  return source
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadResearchConfig(configPath, options = {}) {
  const resolvedPath = path.resolve(options.cwd || process.cwd(), configPath || 'proving-ground/config/proving-ground.example.json');
  const document = readJson(resolvedPath);
  const rootDir = path.resolve(options.cwd || process.cwd());
  const researchLoop = document.researchLoop && typeof document.researchLoop === 'object' ? document.researchLoop : {};
  const model = document.model && typeof document.model === 'object' ? document.model : {};
  return {
    schemaVersion: RESEARCH_SCHEMA_VERSION,
    sourcePath: resolvedPath,
    rootDir,
    suite: normalizeText(document.suite) || 'daemon-in-loop',
    defaultFamilyPath: normalizeText(document.defaultFamilyPath) || 'proving-ground/scenarios/daemon-in-loop/family.json',
    reportDir: normalizeText(document.reportDir) || 'proving-ground/reports',
    holdoutPolicy: document.holdoutPolicy || { enabled: false },
    calibrationPolicy: document.calibrationPolicy || { enabled: false },
    model: {
      provider: 'minimax',
      apiKeyEnv: normalizeText(model.apiKeyEnv) || DEFAULT_MINIMAX_API_KEY_ENV,
      baseUrl: normalizeText(model.baseUrl) || undefined,
      model: normalizeText(model.model) || undefined,
      reasoningSplit: model.reasoningSplit !== false,
      timeoutMs: normalizeNumber(model.timeoutMs, 120000),
      maxAttempts: Math.max(1, Math.round(normalizeNumber(model.maxAttempts, 3))),
      retryDelayMs: Math.max(0, Math.round(normalizeNumber(model.retryDelayMs, 3000))),
    },
    researchLoop: {
      goal: normalizeText(researchLoop.goal) || DEFAULT_GOAL,
      mode: normalizeText(options.mode) || normalizeText(researchLoop.mode) || 'proposal',
      maxIterations: Math.max(1, Math.round(normalizeNumber(options.maxIterations, normalizeNumber(researchLoop.maxIterations, 1)))),
      allowDirtyTree: options.allowDirty === true || researchLoop.allowDirtyTree === true,
      focusFiles: normalizeStringList(researchLoop.focusFiles, DEFAULT_FOCUS_FILES),
      quickValidation: normalizeStringList(researchLoop.quickValidation, DEFAULT_QUICK_VALIDATION),
      fullValidation: normalizeStringList(researchLoop.fullValidation, DEFAULT_FULL_VALIDATION),
      maxSlowdownRatio: Math.max(1, normalizeNumber(researchLoop.maxSlowdownRatio, 1.02)),
    },
  };
}

function getWorkingTreeState(cwd) {
  const result = spawnSync('git', ['status', '--porcelain'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    return {
      ok: false,
      isDirty: true,
      entries: [],
      error: normalizeText(result.stderr) || 'git status failed',
    };
  }
  const entries = String(result.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    ok: true,
    isDirty: entries.length > 0,
    entries,
    error: null,
  };
}

function summarizeScenarioFamily(family) {
  const typeCounts = {};
  let totalExternalTradeCount = 0;
  let totalExternalTradeVolumeUsdc = 0;
  let totalVenueResponseCount = 0;
  let totalRestartCount = 0;
  let hedgeCaseCount = 0;
  let recoveryCaseCount = 0;
  let maxRecoveryMs = 0;

  for (const scenarioCase of family.cases) {
    if (scenarioCase.expectations && scenarioCase.expectations.requiresHedge) {
      hedgeCaseCount += 1;
    }
    if (scenarioCase.expectations && scenarioCase.expectations.requiresRecovery) {
      recoveryCaseCount += 1;
    }
    maxRecoveryMs = Math.max(maxRecoveryMs, Number(scenarioCase.expectations && scenarioCase.expectations.maxRecoveryMs) || 0);
    for (const event of scenarioCase.events) {
      const type = normalizeText(event.type) || 'unknown';
      typeCounts[type] = Number(typeCounts[type] || 0) + 1;
      if (type === 'external-trade') {
        totalExternalTradeCount += 1;
        totalExternalTradeVolumeUsdc += Number(event.amountUsdc) || 0;
      } else if (type === 'venue-response') {
        totalVenueResponseCount += 1;
      } else if (type === 'daemon-restart') {
        totalRestartCount += 1;
      }
    }
  }

  return {
    familyId: family.familyId,
    title: family.title,
    caseCount: family.caseCount,
    caseIds: family.cases.map((scenarioCase) => scenarioCase.id),
    typeCounts,
    totalExternalTradeCount,
    totalExternalTradeVolumeUsdc,
    totalVenueResponseCount,
    totalRestartCount,
    hedgeCaseCount,
    recoveryCaseCount,
    maxRecoveryMs,
    worldLock: normalizeSimulationLock({
      suite: 'proving-ground',
      name: family.familyId,
      simulation: {
        version: family.worldLock && family.worldLock.schemaVersion,
        seed: family.generator && family.generator.seed,
        scenarioFamily: family.familyId,
        feeModel: family.worldLock && family.worldLock.feeModel,
        latencyModel: family.worldLock && family.worldLock.latencyModel,
        marketModelHash: family.worldLock && family.worldLock.marketModel,
        policyHash: family.worldLock && family.worldLock.riskPolicy,
      },
      tags: ['proving-ground', family.familyId],
    }),
  };
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
  const result = spawnSync('bash', ['-lc', command], {
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
  const results = commands.map((command) => runValidationCommand(command, cwd));
  return {
    commands: results,
    summary: summarizeValidationResults(results),
  };
}

function selectGateSummary(validation) {
  if (validation.full && validation.full.summary.commandCount > 0) {
    return validation.full.summary;
  }
  return validation.quick.summary;
}

function loadFocusFileContext(focusFiles, cwd) {
  return focusFiles.map((filePath) => {
    const resolvedPath = path.resolve(cwd, filePath);
    const content = fs.readFileSync(resolvedPath, 'utf8');
    return {
      path: filePath,
      excerpt: content.length > 2400 ? `${content.slice(0, 2400)}\n...` : content,
    };
  });
}

function buildResearchPrompt(options) {
  const focusFiles = loadFocusFileContext(options.focusFiles, options.cwd);
  return {
    systemPrompt: [
      'You are the Pandora proving-ground improvement researcher.',
      'Return JSON only.',
      'Propose one bounded change that can improve speed, simplicity, or resilience without adding benchmark-only behavior.',
      'If you cannot propose a safe deterministic code mutation, return an empty changeSet and a strong written hypothesis.',
      'Allowed changeSet operations: replace_once, insert_after_once, insert_before_once.',
      'Every match or anchor must be exact current repo text.',
    ].join(' '),
    userPrompt: JSON.stringify({
      goal: options.goal,
      mode: options.mode,
      dirtyTree: options.dirtyTree,
      simulation: options.simulationSummary,
      baseline: options.baseline,
      focusFiles,
      returnShape: {
        hypothesisId: 'short-id',
        summary: 'plain-English summary',
        why: 'why this should help',
        targetFiles: ['relative/path'],
        expectedImpact: {
          speed: 'plain-English expectation',
          simplicity: 'plain-English expectation',
          resilience: 'plain-English expectation',
        },
        validationNotes: ['what to verify'],
        changeSet: [
          {
            kind: 'replace_once | insert_after_once | insert_before_once',
            path: 'relative/path',
            match: 'for replace_once only',
            replace: 'for replace_once only',
            anchor: 'for insert operations only',
            text: 'for insert operations only',
          },
        ],
      },
    }, null, 2),
  };
}

function extractFirstJsonObject(text) {
  return extractJsonObjectFromText(text, 'Model response');
}

function parseResearchProposal(text) {
  const proposal = JSON.parse(extractFirstJsonObject(text));
  return {
    hypothesisId: normalizeText(proposal.hypothesisId) || 'proposal',
    summary: normalizeText(proposal.summary),
    why: normalizeText(proposal.why),
    targetFiles: normalizeStringList(proposal.targetFiles),
    expectedImpact: proposal.expectedImpact && typeof proposal.expectedImpact === 'object'
      ? {
          speed: normalizeText(proposal.expectedImpact.speed),
          simplicity: normalizeText(proposal.expectedImpact.simplicity),
          resilience: normalizeText(proposal.expectedImpact.resilience),
        }
      : { speed: '', simplicity: '', resilience: '' },
    validationNotes: normalizeStringList(proposal.validationNotes),
    changeSet: Array.isArray(proposal.changeSet) ? proposal.changeSet : [],
  };
}

function buildInvalidProposalFallback(message) {
  return {
    hypothesisId: 'invalid-proposal',
    summary: 'Model returned an invalid JSON proposal; the loop discarded it safely.',
    why: normalizeText(message),
    targetFiles: [],
    expectedImpact: {
      speed: '',
      simplicity: '',
      resilience: 'The loop should keep running even when a proposal is malformed.',
    },
    validationNotes: [
      'Tighten the model response contract or add stronger proposal sanitation before the next mutation run.',
    ],
    changeSet: [],
  };
}

function buildDecisionSummary(baselineGate, candidateGate, appliedChangeSet, config) {
  const baselineElapsedMs = Number(baselineGate.totalElapsedMs || 0);
  const candidateElapsedMs = Number(candidateGate.totalElapsedMs || 0);
  const speedRatio = baselineElapsedMs > 0 ? candidateElapsedMs / baselineElapsedMs : 1;
  const improvedSpeed = candidateElapsedMs < baselineElapsedMs;
  const improvedResilience = candidateGate.passRate > baselineGate.passRate;
  const noRegression = candidateGate.failedCount <= baselineGate.failedCount && candidateGate.passRate >= baselineGate.passRate;
  const acceptableSpeed = speedRatio <= Number(config.researchLoop.maxSlowdownRatio || 1.02);
  const keep = noRegression && acceptableSpeed && (improvedSpeed || improvedResilience);
  return {
    keep,
    noRegression,
    acceptableSpeed,
    improvedSpeed,
    improvedResilience,
    speedRatio,
    simplicity: appliedChangeSet ? appliedChangeSet.summary : {
      touchedFiles: 0,
      addedLines: 0,
      removedLines: 0,
      netLineDelta: 0,
    },
  };
}

function formatDuration(ms) {
  const numeric = Number(ms);
  if (!Number.isFinite(numeric)) {
    return 'n/a';
  }
  if (numeric < 1000) {
    return `${numeric.toFixed(1)} ms`;
  }
  return `${(numeric / 1000).toFixed(2)} s`;
}

function buildResearchHandoff(report) {
  const gate = selectGateSummary(report.baseline);
  const iteration = report.iterations[0] || null;
  const modelUsage = iteration && iteration.model ? iteration.model.usage : {};
  const nextMoveLines = iteration && iteration.proposal && iteration.proposal.validationNotes.length > 0
    ? iteration.proposal.validationNotes.map((note) => `- ${note}`)
    : ['- Run the next bounded proposal after the runtime daemon simulator is wired in.'];
  return [
    '# Pandora Proving-Ground Handoff',
    '',
    '## What we tested',
    `- Sandbox family: ${report.simulation.familyId}`,
    `- Cases: ${report.simulation.caseCount}`,
    `- External trades: ${report.simulation.totalExternalTradeCount}`,
    `- Restarts: ${report.simulation.totalRestartCount}`,
    '',
    '## Baseline',
    `- Quick gate pass: ${report.baseline.quick.summary.overallPass}`,
    `- Full gate pass: ${report.baseline.full ? report.baseline.full.summary.overallPass : false}`,
    `- Gate time: ${formatDuration(gate.totalElapsedMs)}`,
    '',
    '## Research result',
    iteration
      ? `- Outcome: ${iteration.outcome}`
      : '- Outcome: baseline only',
    iteration && iteration.proposal
      ? `- Hypothesis: ${iteration.proposal.summary || 'n/a'}`
      : '- Hypothesis: n/a',
    iteration && iteration.decision
      ? `- Keep decision: ${iteration.decision.keep}`
      : '- Keep decision: n/a',
    '',
    '## Model',
    iteration && iteration.model
      ? `- Model: ${iteration.model.model}`
      : '- Model: not called',
    iteration && iteration.model
      ? `- Tokens: ${Number(modelUsage.total_tokens || 0)} total (${Number(modelUsage.prompt_tokens || 0)} prompt / ${Number(modelUsage.completion_tokens || 0)} completion)`
      : '- Tokens: 0',
    iteration && iteration.model
      ? `- Model time: ${formatDuration(iteration.model.elapsedMs)}`
      : '- Model time: n/a',
    '',
    '## Next move',
    ...nextMoveLines,
    '',
  ].join('\n');
}

function writeResearchArtifacts(report, config) {
  const runId = report.runId;
  const targetDir = path.resolve(config.rootDir, config.reportDir, runId);
  fs.mkdirSync(targetDir, { recursive: true });
  const reportPath = path.join(targetDir, 'report.json');
  const handoffPath = path.join(targetDir, 'handoff.md');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(handoffPath, `${buildResearchHandoff(report)}\n`);
  return {
    reportDir: targetDir,
    reportPath,
    handoffPath,
  };
}

function runGitCommand(cwd, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  return {
    exitCode: result.status === null ? 1 : result.status,
    stdout: normalizeText(result.stdout),
    stderr: normalizeText(result.stderr),
  };
}

function buildAcceptedCommitMessage(iteration) {
  const proposal = iteration && iteration.proposal ? iteration.proposal : {};
  const hypothesisId = normalizeText(proposal.hypothesisId) || `iteration-${Number(iteration && iteration.index) || 0}`;
  const summary = normalizeText(proposal.summary) || 'autoresearch accepted change';
  return `autoresearch: ${hypothesisId} - ${summary}`;
}

function commitAcceptedIteration(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const appliedChangeSet = options.appliedChangeSet;
  if (!appliedChangeSet || !Array.isArray(appliedChangeSet.files) || appliedChangeSet.files.length === 0) {
    throw new Error('commitAcceptedIteration requires an applied change-set with touched files');
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
      message: buildAcceptedCommitMessage(options.iteration),
    };
  }
  if (diffResult.exitCode !== 1) {
    throw new Error(diffResult.stderr || 'git diff --cached --quiet failed');
  }

  const message = buildAcceptedCommitMessage(options.iteration);
  const commitArgs = [
    '-c', 'user.name=Codex',
    '-c', 'user.email=codex@example.com',
    'commit',
    '-m', message,
    '--',
    ...files,
  ];
  const commitResult = runGitCommand(cwd, commitArgs);
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

async function loadModelProposal(options) {
  if (typeof options.modelLoader === 'function') {
    return options.modelLoader(options);
  }
  if (options.mockResponsePath) {
    const responseText = fs.readFileSync(path.resolve(options.cwd, options.mockResponsePath), 'utf8');
    return {
      provider: 'mock',
      model: 'mock-minimax',
      text: responseText,
      reasoning: '',
      usage: {},
      elapsedMs: 0,
    };
  }
  return callMinimaxChat({
    ...options.modelConfig,
    systemPrompt: options.prompt.systemPrompt,
    userPrompt: options.prompt.userPrompt,
  });
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

async function loadModelProposalWithRetry(options) {
  const maxAttempts = Math.max(1, Math.round(Number(options.modelConfig && options.modelConfig.maxAttempts) || 1));
  const retryDelayMs = Math.max(0, Math.round(Number(options.modelConfig && options.modelConfig.retryDelayMs) || 0));
  const attempts = [];
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await loadModelProposal(options);
      return {
        ...response,
        attempts,
      };
    } catch (error) {
      const message = normalizeText(error && error.message ? error.message : error) || 'Model call failed';
      attempts.push({
        attempt,
        message,
      });
      lastError = error;
      if (attempt < maxAttempts && retryDelayMs > 0) {
        await delay(retryDelayMs * attempt);
      }
    }
  }

  const failure = new Error(normalizeText(lastError && lastError.message ? lastError.message : lastError) || 'Model call failed');
  failure.attempts = attempts;
  throw failure;
}

async function runAutoresearchLoop(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const config = loadResearchConfig(options.configPath, {
    cwd,
    mode: options.mode,
    maxIterations: options.maxIterations,
    allowDirty: options.allowDirty,
  });
  const dirtyTree = getWorkingTreeState(cwd);
  if (config.researchLoop.mode === 'workspace' && dirtyTree.isDirty && !config.researchLoop.allowDirtyTree) {
    throw new Error('Workspace mutation mode requires a clean git tree. Run in proposal mode or pass --allow-dirty when you own the tree.');
  }

  const familyPath = path.resolve(cwd, options.familyPath || config.defaultFamilyPath);
  const family = loadScenarioFamily(familyPath);
  const simulationSummary = summarizeScenarioFamily(family);
  const baseline = {
    quick: runValidationPlan(config.researchLoop.quickValidation, cwd),
    full: null,
  };
  if (baseline.quick.summary.overallPass && config.researchLoop.fullValidation.length > 0) {
    baseline.full = runValidationPlan(config.researchLoop.fullValidation, cwd);
  }

  const report = {
    schemaVersion: RESEARCH_SCHEMA_VERSION,
    runId: options.runId || `pg-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    startedAt: new Date().toISOString(),
    cwd,
    mode: config.researchLoop.mode,
    goal: config.researchLoop.goal,
    dirtyTree,
    configSourcePath: config.sourcePath,
    simulation: simulationSummary,
    baseline,
    iterations: [],
  };

  if (options.skipModel || config.researchLoop.mode === 'baseline') {
    report.finishedAt = new Date().toISOString();
    report.artifacts = writeResearchArtifacts(report, config);
    return report;
  }

  report.artifacts = writeResearchArtifacts(report, config);

  for (let iterationIndex = 0; iterationIndex < config.researchLoop.maxIterations; iterationIndex += 1) {
    const prompt = buildResearchPrompt({
      cwd,
      goal: config.researchLoop.goal,
      mode: config.researchLoop.mode,
      dirtyTree,
      simulationSummary,
      baseline,
      focusFiles: config.researchLoop.focusFiles,
    });
    let model = null;
    try {
      model = await loadModelProposalWithRetry({
        cwd,
        mockResponsePath: options.mockResponsePath,
        prompt,
        modelConfig: config.model,
        modelLoader: options.modelLoader,
      });
    } catch (error) {
      report.iterations.push({
        index: iterationIndex + 1,
        proposal: buildInvalidProposalFallback('Model call failed before a proposal was returned.'),
        model: {
          provider: config.model.provider,
          model: config.model.model,
          usage: {},
          elapsedMs: 0,
          attempts: Array.isArray(error && error.attempts) ? error.attempts : [],
        },
        outcome: 'model-error',
        decision: {
          keep: false,
          reason: 'model-call-failed',
        },
        modelError: {
          message: normalizeText(error && error.message ? error.message : error),
        },
        postValidation: null,
      });
      report.artifacts = writeResearchArtifacts(report, config);
      continue;
    }
    let proposal = null;
    let parseError = null;
    try {
      proposal = parseResearchProposal(model.text);
    } catch (error) {
      parseError = error;
      proposal = buildInvalidProposalFallback(error && error.message ? error.message : error);
    }
    const iteration = {
      index: iterationIndex + 1,
      proposal,
      model: {
        provider: model.provider,
        model: model.model,
        usage: model.usage || {},
        elapsedMs: model.elapsedMs,
        attempts: Array.isArray(model.attempts) ? model.attempts : [],
      },
      outcome: 'proposal-only',
      decision: null,
      postValidation: null,
    };

    if (parseError) {
      iteration.outcome = 'invalid-proposal';
      iteration.decision = {
        keep: false,
        reason: 'proposal-parse-failed',
      };
      iteration.parseError = {
        message: normalizeText(parseError && parseError.message ? parseError.message : parseError),
      };
      iteration.rawProposalExcerpt = truncateOutput(model.text, 1200);
      report.iterations.push(iteration);
      continue;
    }

    if (config.researchLoop.mode === 'workspace' && Array.isArray(proposal.changeSet) && proposal.changeSet.length > 0) {
      let appliedChangeSet = null;
      try {
        appliedChangeSet = applyChangeSet(proposal.changeSet, { cwd });
        const postValidation = {
          quick: runValidationPlan(config.researchLoop.quickValidation, cwd),
          full: null,
        };
        if (postValidation.quick.summary.overallPass && config.researchLoop.fullValidation.length > 0) {
          postValidation.full = runValidationPlan(config.researchLoop.fullValidation, cwd);
        }
        iteration.postValidation = postValidation;
        iteration.decision = buildDecisionSummary(
          selectGateSummary(baseline),
          selectGateSummary(postValidation),
          appliedChangeSet,
          config,
        );
        iteration.outcome = iteration.decision.keep ? 'kept' : 'discarded';
        iteration.appliedChangeSet = {
          operations: appliedChangeSet.operations.length,
          files: appliedChangeSet.files,
          summary: appliedChangeSet.summary,
        };
        if (iteration.decision.keep) {
          try {
            iteration.commit = commitAcceptedIteration({
              cwd,
              iteration,
              appliedChangeSet,
            });
          } catch (error) {
            rollbackAppliedChangeSet(appliedChangeSet);
            iteration.outcome = 'discarded';
            iteration.decision = {
              ...iteration.decision,
              keep: false,
              reason: 'commit-failed',
            };
            iteration.commitError = {
              message: normalizeText(error && error.message ? error.message : error),
            };
          }
        } else {
          rollbackAppliedChangeSet(appliedChangeSet);
        }
      } catch (error) {
        if (appliedChangeSet) {
          rollbackAppliedChangeSet(appliedChangeSet);
        }
        iteration.outcome = 'invalid-change-set';
        iteration.decision = {
          keep: false,
          reason: 'change-set-apply-failed',
        };
        iteration.applyError = {
          message: normalizeText(error && error.message ? error.message : error),
        };
      }
    }

    report.iterations.push(iteration);
    report.artifacts = writeResearchArtifacts(report, config);
  }

  report.finishedAt = new Date().toISOString();
  report.artifacts = writeResearchArtifacts(report, config);
  return report;
}

module.exports = {
  RESEARCH_SCHEMA_VERSION,
  buildResearchHandoff,
  buildResearchPrompt,
  extractFirstJsonObject,
  getWorkingTreeState,
  loadResearchConfig,
  parseResearchProposal,
  buildInvalidProposalFallback,
  buildAcceptedCommitMessage,
  commitAcceptedIteration,
  runAutoresearchLoop,
  runValidationCommand,
  runGitCommand,
  runValidationPlan,
  summarizeScenarioFamily,
};
