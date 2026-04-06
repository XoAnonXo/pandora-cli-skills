const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_MINIMAX_API_KEY_ENV,
  callMinimaxChat,
} = require('./minimax_client.cjs');
const {
  applyChangeSet,
  rollbackAppliedChangeSet,
} = require('./change_set_engine.cjs');
const {
  commitAcceptedIteration,
  getWorkingTreeState,
  runValidationPlan,
} = require('./autoresearch_loop.cjs');

const CLI_SECTION_RESEARCH_SCHEMA_VERSION = '1.0.0';
const DEFAULT_CONFIG_PATH = 'proving-ground/config/cli_section_research.cjs';

function normalizeText(value) {
  return String(value ?? '').trim();
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

function normalizeStringList(list, fallback = []) {
  const source = Array.isArray(list) && list.length > 0 ? list : fallback;
  return source
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function readConfigDocument(configPath, cwd) {
  const absolutePath = path.resolve(cwd, configPath || DEFAULT_CONFIG_PATH);
  delete require.cache[absolutePath];
  const document = require(absolutePath);
  return {
    sourcePath: absolutePath,
    document: cloneJson(document),
  };
}

function normalizeSection(section, defaults = {}) {
  return {
    id: normalizeText(section.id),
    title: normalizeText(section.title) || normalizeText(section.id),
    description: normalizeText(section.description),
    commandPrefixes: normalizeStringList(section.commandPrefixes),
    focusFiles: normalizeStringList(section.focusFiles),
    helpCommands: normalizeStringList(section.helpCommands),
    quickValidation: normalizeStringList(section.quickValidation),
    fullValidation: normalizeStringList(section.fullValidation),
    allowNeutralKeep: normalizeBoolean(section.allowNeutralKeep, defaults.allowNeutralKeep),
  };
}

function loadCliSectionResearchConfig(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const { sourcePath, document } = readConfigDocument(options.configPath, cwd);
  const model = document.model && typeof document.model === 'object' ? document.model : {};
  const researchLoop = document.researchLoop && typeof document.researchLoop === 'object' ? document.researchLoop : {};
  const baton = document.baton && typeof document.baton === 'object' ? document.baton : {};
  const worker = document.worker && typeof document.worker === 'object' ? document.worker : {};
  const council = document.council && typeof document.council === 'object' ? document.council : {};
  const integration = document.integration && typeof document.integration === 'object' ? document.integration : {};
  const validation = document.validation && typeof document.validation === 'object' ? document.validation : {};
  const sections = Array.isArray(document.sections) ? document.sections.map((section) => normalizeSection(section, {
    allowNeutralKeep: false,
  })) : [];
  return {
    schemaVersion: CLI_SECTION_RESEARCH_SCHEMA_VERSION,
    cwd,
    sourcePath,
    reportDir: normalizeText(document.reportDir) || 'proving-ground/reports/cli-sections',
    commandDescriptorPath: normalizeText(document.commandDescriptorPath) || 'sdk/generated/command-descriptors.json',
    model: {
      provider: 'minimax',
      apiKeyEnv: normalizeText(model.apiKeyEnv) || DEFAULT_MINIMAX_API_KEY_ENV,
      baseUrl: normalizeText(model.baseUrl) || undefined,
      model: normalizeText(model.model) || undefined,
      temperature: normalizeNumber(model.temperature, 0.2),
      reasoningSplit: model.reasoningSplit !== false,
      timeoutMs: Math.max(1000, normalizeNumber(model.timeoutMs, 120000)),
      maxAttempts: Math.max(1, Math.round(normalizeNumber(model.maxAttempts, 3))),
      retryDelayMs: Math.max(0, Math.round(normalizeNumber(model.retryDelayMs, 3000))),
    },
    researchLoop: {
      goal: normalizeText(researchLoop.goal) || 'Make the Pandora CLI clearer, faster, and simpler without changing behavior.',
      mode: normalizeText(options.mode) || normalizeText(researchLoop.mode) || 'workspace',
      iterationsPerSection: Math.max(1, Math.round(normalizeNumber(
        options.iterationsPerSection,
        normalizeNumber(researchLoop.iterationsPerSection, 50),
      ))),
      allowDirtyTree: options.allowDirty === true || researchLoop.allowDirtyTree === true,
      maxSlowdownRatio: Math.max(1, normalizeNumber(researchLoop.maxSlowdownRatio, 1.02)),
      finalValidation: normalizeStringList(researchLoop.finalValidation),
    },
    baton: {
      reportDir: normalizeText(baton.reportDir) || 'proving-ground/reports/baton',
      laneCount: Math.max(1, Math.round(normalizeNumber(baton.laneCount, sections.length || 1))),
      maxParallelWorkers: Math.max(1, Math.round(normalizeNumber(baton.maxParallelWorkers, sections.length || 1))),
      heartbeatTimeoutMs: Math.max(1000, Math.round(normalizeNumber(baton.heartbeatTimeoutMs, 30000))),
      cleanupPolicy: normalizeText(baton.cleanupPolicy) || 'manual',
      pausePollMs: Math.max(100, Math.round(normalizeNumber(baton.pausePollMs, 250))),
      worktreeRoot: normalizeText(baton.worktreeRoot) || '',
    },
    worker: {
      timeBudgetMs: Math.max(1000, Math.round(normalizeNumber(worker.timeBudgetMs, 30 * 60 * 1000))),
      tokenBudget: Math.max(0, Math.round(normalizeNumber(worker.tokenBudget, 120000))),
      oneAttempt: normalizeBoolean(worker.oneAttempt, true),
      maxModelCalls: Math.max(1, Math.round(normalizeNumber(worker.maxModelCalls, 1))),
      promptVersion: normalizeText(worker.promptVersion) || 'baton-v1',
    },
    council: {
      roles: normalizeStringList(council.roles, ['correctness', 'determinism', 'safety', 'performance', 'simplicity', 'goal-fit']),
      quorum: Math.max(1, Math.round(normalizeNumber(council.quorum, 4))),
      reviseCap: Math.max(0, Math.round(normalizeNumber(council.reviseCap, 1))),
      dedupe: normalizeBoolean(council.dedupe, true),
    },
    integration: {
      branchPrefix: normalizeText(integration.branchPrefix) || 'codex/baton',
      mergeOrder: normalizeText(integration.mergeOrder) || 'lane-index',
      promotionBranch: normalizeText(integration.promotionBranch) || 'main',
      worktreeName: normalizeText(integration.worktreeName) || 'integration',
    },
    validation: {
      syntheticModel: normalizeBoolean(validation.syntheticModel, false),
      syntheticCouncil: normalizeBoolean(validation.syntheticCouncil, false),
      runRealWorktrees: normalizeBoolean(validation.runRealWorktrees, true),
      failureInjection: validation.failureInjection && typeof validation.failureInjection === 'object'
        ? cloneJson(validation.failureInjection)
        : {},
    },
    sections,
  };
}

function matchesCommandPrefix(commandName, prefix) {
  return commandName === prefix || commandName.startsWith(`${prefix}.`);
}

function buildSectionCoverage(commandDescriptors, sections) {
  const commands = Object.keys(commandDescriptors || {}).sort();
  const orderedPrefixes = sections
    .flatMap((section) => section.commandPrefixes.map((prefix) => ({
      sectionId: section.id,
      prefix,
    })))
    .sort((left, right) => right.prefix.length - left.prefix.length);

  const assignments = [];
  const perSection = new Map(sections.map((section) => [section.id, []]));
  const uncovered = [];

  for (const commandName of commands) {
    const match = orderedPrefixes.find((candidate) => matchesCommandPrefix(commandName, candidate.prefix));
    if (!match) {
      uncovered.push(commandName);
      continue;
    }
    assignments.push({
      commandName,
      sectionId: match.sectionId,
      prefix: match.prefix,
    });
    perSection.get(match.sectionId).push(commandName);
  }

  return {
    totalCommands: commands.length,
    coveredCommands: assignments.length,
    uncoveredCommands: uncovered,
    coverageRatio: commands.length === 0 ? 1 : assignments.length / commands.length,
    perSection: Object.fromEntries(
      [...perSection.entries()].map(([sectionId, names]) => [sectionId, {
        commandCount: names.length,
        commandNames: names,
      }]),
    ),
  };
}

function readCommandDescriptors(cwd, descriptorPath) {
  const absolutePath = path.resolve(cwd, descriptorPath);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function truncateText(text, maxLength = 2400) {
  const normalized = String(text || '').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}\n...`;
}

function loadFocusFileContext(focusFiles, cwd) {
  return focusFiles.map((filePath) => {
    const absolutePath = path.resolve(cwd, filePath);
    const content = fs.readFileSync(absolutePath, 'utf8');
    return {
      path: filePath,
      excerpt: truncateText(content, 5000),
    };
  });
}

function runShellCommand(command, cwd) {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync('bash', ['-lc', command], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    command,
    exitCode: result.status === null ? 1 : result.status,
    stdout: truncateText(result.stdout, 1200),
    stderr: truncateText(result.stderr, 800),
  };
}

function captureHelpContext(helpCommands, cwd) {
  return helpCommands.map((command) => runShellCommand(command, cwd));
}

function buildValidationSummary(validation) {
  if (!validation) {
    return null;
  }
  return {
    quick: validation.quick ? validation.quick.summary : null,
    full: validation.full ? validation.full.summary : null,
  };
}

function selectGateSummary(validation) {
  if (validation.full && validation.full.summary && validation.full.summary.commandCount > 0) {
    return validation.full.summary;
  }
  return validation.quick.summary;
}

function extractFirstJsonObject(text) {
  const trimmed = normalizeText(text);
  if (!trimmed) {
    throw new Error('Model returned an empty response');
  }
  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Model response does not contain a JSON object');
  }
  return trimmed.slice(firstBrace, lastBrace + 1);
}

function parseSectionProposal(text) {
  const proposal = JSON.parse(extractFirstJsonObject(text));
  return {
    hypothesisId: normalizeText(proposal.hypothesisId) || 'proposal',
    summary: normalizeText(proposal.summary),
    why: normalizeText(proposal.why),
    targetFiles: normalizeStringList(proposal.targetFiles),
    expectedImpact: proposal.expectedImpact && typeof proposal.expectedImpact === 'object'
      ? {
          clarity: normalizeText(proposal.expectedImpact.clarity),
          speed: normalizeText(proposal.expectedImpact.speed),
          simplicity: normalizeText(proposal.expectedImpact.simplicity),
        }
      : { clarity: '', speed: '', simplicity: '' },
    validationNotes: normalizeStringList(proposal.validationNotes),
    changeSet: Array.isArray(proposal.changeSet) ? proposal.changeSet : [],
  };
}

function buildInvalidProposalFallback(message) {
  return {
    hypothesisId: 'invalid-proposal',
    summary: 'MiniMax returned an invalid proposal and the loop discarded it safely.',
    why: normalizeText(message),
    targetFiles: [],
    expectedImpact: {
      clarity: '',
      speed: '',
      simplicity: '',
    },
    validationNotes: [
      'Tighten the response format or the prompt before the next mutation run.',
    ],
    changeSet: [],
  };
}

function buildSectionPrompt(options) {
  return {
    systemPrompt: [
      'You are the Pandora CLI improvement researcher.',
      'Return JSON only.',
      'Make one bounded change for the target CLI section.',
      'Improve clarity, speed, or simplicity without changing behavior and without adding benchmark-only logic.',
      'Prefer deleting indirection, tightening help surfaces, simplifying control flow, and speeding hot paths.',
      'Allowed changeSet operations: replace_once, insert_after_once, insert_before_once.',
      'Do not emit <think>, reasoning, markdown fences, or commentary before or after the JSON object.',
      'Every match or anchor must be exact current repo text.',
      'Only use match or anchor text copied verbatim from the provided focus-file excerpts.',
      'If the needed code is not visible in the excerpt, return an empty changeSet instead of guessing.',
      'Only touch the listed focus files.',
    ].join(' '),
    userPrompt: JSON.stringify({
      goal: options.goal,
      section: {
        id: options.section.id,
        title: options.section.title,
        description: options.section.description,
        commands: options.section.commandPrefixes,
      },
      baseline: {
        quick: options.baseline.quick.summary,
        full: options.baseline.full ? options.baseline.full.summary : null,
      },
      helpSnapshots: options.helpContext,
      focusFiles: options.focusFiles,
      returnShape: {
        hypothesisId: 'short-id',
        summary: 'plain-English summary',
        why: 'why this should help',
        targetFiles: ['relative/path'],
        expectedImpact: {
          clarity: 'plain-English expectation',
          speed: 'plain-English expectation',
          simplicity: 'plain-English expectation',
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
      const response = typeof options.modelLoader === 'function'
        ? await options.modelLoader(options)
        : await callMinimaxChat({
            ...options.modelConfig,
            systemPrompt: options.prompt.systemPrompt,
            userPrompt: options.prompt.userPrompt,
          });
      return {
        ...response,
        attempts,
      };
    } catch (error) {
      attempts.push({
        attempt,
        message: normalizeText(error && error.message ? error.message : error),
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

function buildDecisionSummary(options) {
  const baselineGate = options.baselineGate;
  const candidateGate = options.candidateGate;
  const appliedChangeSet = options.appliedChangeSet;
  const section = options.section;
  const maxSlowdownRatio = Number(options.maxSlowdownRatio || 1.02);

  const baselineElapsedMs = Number(baselineGate.totalElapsedMs || 0);
  const candidateElapsedMs = Number(candidateGate.totalElapsedMs || 0);
  const speedRatio = baselineElapsedMs > 0 ? candidateElapsedMs / baselineElapsedMs : 1;
  const improvedSpeed = candidateElapsedMs < baselineElapsedMs;
  const noRegression = candidateGate.failedCount <= baselineGate.failedCount && candidateGate.passRate >= baselineGate.passRate;
  const acceptableSpeed = speedRatio <= maxSlowdownRatio;
  const simplificationSignal = Boolean(
    appliedChangeSet
      && (
        appliedChangeSet.summary.netLineDelta <= 0
        || appliedChangeSet.summary.removedLines > appliedChangeSet.summary.addedLines
      ),
  );
  const compactSignal = Boolean(
    appliedChangeSet
      && appliedChangeSet.summary.touchedFiles <= 2
      && Math.abs(appliedChangeSet.summary.netLineDelta) <= 30,
  );
  const keep = noRegression && acceptableSpeed && (
    improvedSpeed
    || simplificationSignal
    || (section.allowNeutralKeep && compactSignal)
  );

  return {
    keep,
    noRegression,
    acceptableSpeed,
    improvedSpeed,
    simplificationSignal,
    compactSignal,
    speedRatio,
    changeSummary: appliedChangeSet ? appliedChangeSet.summary : {
      touchedFiles: 0,
      addedLines: 0,
      removedLines: 0,
      netLineDelta: 0,
    },
  };
}

function writeArtifacts(report, config) {
  const targetDir = path.resolve(config.cwd, config.reportDir, report.runId);
  fs.mkdirSync(targetDir, { recursive: true });
  const reportPath = path.join(targetDir, 'report.json');
  const handoffPath = path.join(targetDir, 'handoff.md');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(handoffPath, `${buildHandoff(report)}\n`);
  return {
    reportDir: targetDir,
    reportPath,
    handoffPath,
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

function buildHandoff(report) {
  const totalTokens = report.sections.reduce((sum, section) => sum + Number(section.summary.totalTokens || 0), 0);
  const totalAccepted = report.sections.reduce((sum, section) => sum + Number(section.summary.acceptedCount || 0), 0);
  return [
    '# CLI Section Autoresearch Handoff',
    '',
    '## What we tested',
    `- Sections: ${report.sections.length}`,
    `- Total loops: ${report.sections.reduce((sum, section) => sum + Number(section.summary.iterationCount || 0), 0)}`,
    `- Command coverage: ${report.coverage.coveredCommands}/${report.coverage.totalCommands}`,
    '',
    '## Outcome',
    `- Accepted changes: ${totalAccepted}`,
    `- MiniMax tokens: ${totalTokens}`,
    report.finalValidation
      ? `- Final validation pass: ${report.finalValidation.summary.overallPass}`
      : '- Final validation pass: not run',
    '',
    '## Section summary',
    ...report.sections.map((section) => `- ${section.title}: ${section.summary.acceptedCount} kept / ${section.summary.iterationCount} loops`),
    '',
  ].join('\n');
}

function createEmptyValidationSummary() {
  return {
    commands: [],
    summary: {
      commandCount: 0,
      passedCount: 0,
      failedCount: 0,
      passRate: 1,
      totalElapsedMs: 0,
      overallPass: true,
    },
  };
}

function summarizeSectionIterations(iterations) {
  const usage = iterations.reduce((accumulator, iteration) => {
    const modelUsage = iteration.model && iteration.model.usage ? iteration.model.usage : {};
    accumulator.totalTokens += Number(modelUsage.total_tokens || 0);
    accumulator.promptTokens += Number(modelUsage.prompt_tokens || 0);
    accumulator.completionTokens += Number(modelUsage.completion_tokens || 0);
    accumulator.reasoningTokens += Number(modelUsage.reasoning_tokens || 0);
    return accumulator;
  }, {
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
  });

  return {
    iterationCount: iterations.length,
    acceptedCount: iterations.filter((iteration) => iteration.outcome === 'kept').length,
    discardedCount: iterations.filter((iteration) => iteration.outcome === 'discarded').length,
    invalidProposalCount: iterations.filter((iteration) => iteration.outcome === 'invalid-proposal').length,
    invalidChangeSetCount: iterations.filter((iteration) => iteration.outcome === 'invalid-change-set').length,
    modelErrorCount: iterations.filter((iteration) => iteration.outcome === 'model-error').length,
    totalTokens: usage.totalTokens,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    reasoningTokens: usage.reasoningTokens,
  };
}

function buildSectionSnapshot(section, baseline, helpContext, iterations) {
  return {
    id: section.id,
    title: section.title,
    description: section.description,
    commandPrefixes: section.commandPrefixes,
    baseline,
    helpContext,
    iterations: cloneJson(iterations),
    summary: summarizeSectionIterations(iterations),
  };
}

async function runSectionLoop(options) {
  const { config, cwd, section, iterationsPerSection } = options;
  const baseline = {
    quick: runValidationPlan(section.quickValidation, cwd),
    full: section.fullValidation.length > 0
      ? runValidationPlan(section.fullValidation, cwd)
      : createEmptyValidationSummary(),
  };
  const helpContext = captureHelpContext(section.helpCommands, cwd);
  const focusFiles = loadFocusFileContext(section.focusFiles, cwd);
  const iterations = [];

  if (typeof options.onProgress === 'function') {
    options.onProgress(buildSectionSnapshot(section, baseline, helpContext, iterations));
  }

  if (options.skipModel) {
    return buildSectionSnapshot(section, baseline, helpContext, iterations);
  }

  for (let index = 0; index < iterationsPerSection; index += 1) {
    const prompt = buildSectionPrompt({
      goal: config.researchLoop.goal,
      section,
      baseline,
      helpContext,
      focusFiles,
    });
    let model = null;
    try {
      model = await loadModelProposalWithRetry({
        prompt,
        modelConfig: config.model,
        modelLoader: options.modelLoader,
      });
    } catch (error) {
      iterations.push({
        index: index + 1,
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
      });
      if (typeof options.onProgress === 'function') {
        options.onProgress(buildSectionSnapshot(section, baseline, helpContext, iterations));
      }
      continue;
    }

    let proposal = null;
    let parseError = null;
    try {
      proposal = parseSectionProposal(model.text);
    } catch (error) {
      parseError = error;
      proposal = buildInvalidProposalFallback(error && error.message ? error.message : error);
    }

    const iteration = {
      index: index + 1,
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
      iteration.rawProposalExcerpt = truncateText(model.text, 1200);
      iterations.push(iteration);
      if (typeof options.onProgress === 'function') {
        options.onProgress(buildSectionSnapshot(section, baseline, helpContext, iterations));
      }
      continue;
    }

    if (options.skipModel || config.researchLoop.mode !== 'workspace' || proposal.changeSet.length === 0) {
      iteration.outcome = proposal.changeSet.length === 0 ? 'discarded' : 'proposal-only';
      iteration.decision = {
        keep: false,
        reason: proposal.changeSet.length === 0 ? 'empty-change-set' : 'non-workspace-mode',
      };
      iterations.push(iteration);
      if (typeof options.onProgress === 'function') {
        options.onProgress(buildSectionSnapshot(section, baseline, helpContext, iterations));
      }
      continue;
    }

    let appliedChangeSet = null;
    try {
      appliedChangeSet = applyChangeSet(proposal.changeSet, { cwd });
      const postValidation = {
        quick: runValidationPlan(section.quickValidation, cwd),
        full: createEmptyValidationSummary(),
      };
      iteration.postValidation = postValidation;

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

      iteration.decision = finalDecision;
      iteration.appliedChangeSet = {
        operations: appliedChangeSet.operations.length,
        files: appliedChangeSet.files,
        summary: appliedChangeSet.summary,
      };

      if (finalDecision.keep) {
        iteration.outcome = 'kept';
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
        iteration.outcome = 'discarded';
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

    iterations.push(iteration);
    if (typeof options.onProgress === 'function') {
      options.onProgress(buildSectionSnapshot(section, baseline, helpContext, iterations));
    }
  }

  return buildSectionSnapshot(section, baseline, helpContext, iterations);
}

async function runCliSectionAutoresearch(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const config = loadCliSectionResearchConfig({
    cwd,
    configPath: options.configPath,
    iterationsPerSection: options.iterationsPerSection,
    mode: options.mode,
    allowDirty: options.allowDirty,
  });
  const dirtyTree = getWorkingTreeState(cwd);
  if (config.researchLoop.mode === 'workspace' && dirtyTree.isDirty && !config.researchLoop.allowDirtyTree) {
    throw new Error('CLI section mutation mode requires a clean git tree. Commit or stash work, or pass --allow-dirty when you own the tree.');
  }

  const commandDescriptors = readCommandDescriptors(cwd, config.commandDescriptorPath);
  const coverage = buildSectionCoverage(commandDescriptors, config.sections);
  if (coverage.uncoveredCommands.length > 0) {
    throw new Error(`CLI section coverage is incomplete. Uncovered commands: ${coverage.uncoveredCommands.join(', ')}`);
  }

  const selectedSections = normalizeText(options.section)
    ? config.sections.filter((section) => section.id === normalizeText(options.section))
    : config.sections;
  if (selectedSections.length === 0) {
    throw new Error(`Unknown CLI section: ${options.section}`);
  }

  const report = {
    schemaVersion: CLI_SECTION_RESEARCH_SCHEMA_VERSION,
    runId: options.runId || `cli-sections-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    startedAt: new Date().toISOString(),
    cwd,
    mode: config.researchLoop.mode,
    goal: config.researchLoop.goal,
    dirtyTree,
    configSourcePath: config.sourcePath,
    coverage,
    sections: [],
    finalValidation: null,
  };

  report.artifacts = writeArtifacts(report, config);

  for (const section of selectedSections) {
    const sectionIndex = report.sections.length;
    const sectionReport = await runSectionLoop({
      config,
      cwd,
      section,
      iterationsPerSection: config.researchLoop.iterationsPerSection,
      modelLoader: options.modelLoader,
      skipModel: options.skipModel,
      onProgress(snapshot) {
        report.sections[sectionIndex] = snapshot;
        report.artifacts = writeArtifacts(report, config);
      },
    });
    report.sections[sectionIndex] = sectionReport;
    report.artifacts = writeArtifacts(report, config);
  }

  if (config.researchLoop.finalValidation.length > 0) {
    report.finalValidation = runValidationPlan(config.researchLoop.finalValidation, cwd);
  }

  report.finishedAt = new Date().toISOString();
  report.artifacts = writeArtifacts(report, config);
  return report;
}

module.exports = {
  CLI_SECTION_RESEARCH_SCHEMA_VERSION,
  DEFAULT_CONFIG_PATH,
  buildDecisionSummary,
  buildInvalidProposalFallback,
  captureHelpContext,
  createEmptyValidationSummary,
  buildSectionCoverage,
  buildSectionPrompt,
  loadFocusFileContext,
  loadModelProposalWithRetry,
  loadCliSectionResearchConfig,
  matchesCommandPrefix,
  parseSectionProposal,
  runCliSectionAutoresearch,
  selectGateSummary,
};
