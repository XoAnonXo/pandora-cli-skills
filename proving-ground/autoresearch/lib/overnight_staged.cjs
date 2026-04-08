const fs = require('node:fs');

const {
  createFingerprint,
  extractJsonObjectFromText,
  normalizeText,
  resolveRepoPath,
} = require('./baton_common.cjs');
const {
  buildSurfaceTargetRegistry,
  resolveSurfaceTarget,
} = require('./overnight_targets.cjs');
const { validatePatchSetAgainstContent } = require('./overnight_patch_engine.cjs');

const DEFAULT_WINDOW_LINE_CAP = 120;

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];
}

function normalizeProposalMode(value) {
  const mode = normalizeText(value).toLowerCase() || 'legacy';
  if (!['legacy', 'staged'].includes(mode)) {
    throw new Error(`proposal_mode must be legacy or staged`);
  }
  return mode;
}

function normalizeAnchorType(value, fallback, allowed, fieldName) {
  const anchorType = normalizeText(value) || fallback;
  if (!allowed.includes(anchorType)) {
    throw new Error(`${fieldName} must be one of ${allowed.join(', ')}`);
  }
  return anchorType;
}

function normalizePlannerTarget(value, fieldName, options = {}) {
  const required = options.required !== false;
  if (!required && (value === null || value === undefined)) {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  const target = {
    path: normalizeText(value.path),
    symbol: normalizeText(value.symbol),
    anchorType: normalizeAnchorType(
      value.anchor_type || value.anchorType,
      options.kind === 'test' ? 'test_name' : 'symbol',
      options.kind === 'test' ? ['test_name', 'line_contains'] : ['symbol', 'line_contains'],
      `${fieldName}.anchor_type`,
    ),
    anchorText: normalizeText(value.anchor_text || value.anchorText),
  };
  if (!target.path) {
    throw new Error(`${fieldName}.path is required`);
  }
  if (options.kind !== 'test' && target.anchorType === 'symbol' && !target.symbol) {
    throw new Error(`${fieldName}.symbol is required for source targets`);
  }
  if (!target.anchorText) {
    target.anchorText = target.symbol || '';
  }
  if (!target.anchorText) {
    throw new Error(`${fieldName}.anchor_text is required`);
  }
  return target;
}

function parsePlannerResponse(text) {
  const payload = JSON.parse(extractJsonObjectFromText(text, 'Planner response'));
  const decision = normalizeText(payload.decision).toLowerCase();
  if (!['propose', 'no_safe_change'].includes(decision)) {
    throw new Error('decision must be propose or no_safe_change');
  }
  const plan = {
    decision,
    changeSummary: normalizeText(payload.change_summary || payload.changeSummary),
    sourceTargetId: normalizeText(payload.source_target_id || payload.sourceTargetId),
    testTargetId: normalizeText(payload.test_target_id || payload.testTargetId),
    sourceTarget: null,
    testTarget: null,
    whyBounded: normalizeText(payload.why_bounded || payload.whyBounded),
    invariantsPreserved: normalizeStringList(payload.invariants_preserved || payload.invariantsPreserved),
    expectedTestKind: normalizeText(payload.expected_test_kind || payload.expectedTestKind),
  };
  if (decision === 'no_safe_change') {
    if (!plan.changeSummary) {
      plan.changeSummary = 'No safe bounded change was identified.';
    }
    return plan;
  }
  if (!plan.changeSummary) {
    throw new Error('change_summary is required');
  }
  if (!plan.whyBounded) {
    throw new Error('why_bounded is required');
  }
  if (!plan.expectedTestKind) {
    throw new Error('expected_test_kind is required');
  }
  if (plan.sourceTargetId && plan.testTargetId) {
    return plan;
  }
  plan.sourceTarget = normalizePlannerTarget(payload.source_target || payload.sourceTarget, 'source_target', { kind: 'source' });
  plan.testTarget = normalizePlannerTarget(payload.test_target || payload.testTarget, 'test_target', { kind: 'test' });
  plan.sourceTargetId = plan.sourceTarget.path ? `${plan.sourceTarget.path}::${plan.sourceTarget.symbol || plan.sourceTarget.anchorText}` : '';
  plan.testTargetId = plan.testTarget.path ? `${plan.testTarget.path}::${plan.testTarget.anchorText}` : '';
  return plan;
}

function buildCandidateFingerprint(objectiveHash, surfaceId, plan) {
  return createFingerprint({
    objectiveHash,
    surfaceId,
    sourceTargetId: plan && plan.sourceTargetId ? plan.sourceTargetId : null,
    testTargetId: plan && plan.testTargetId ? plan.testTargetId : null,
    sourceTarget: plan && plan.sourceTarget ? plan.sourceTarget : null,
    testTarget: plan && plan.testTarget ? plan.testTarget : null,
  });
}

function buildSourceTargetKey(target) {
  if (!target) {
    return '';
  }
  if (normalizeText(target.id)) {
    return normalizeText(target.id);
  }
  return `${normalizeText(target.path)}::${normalizeText(target.symbol || target.anchorText)}`;
}

function buildWindowFingerprint(sourceWindow, testWindow) {
  return createFingerprint({
    sourceWindow,
    testWindow,
  });
}

function truncateList(list, limit) {
  return Array.isArray(list) ? list.slice(0, limit) : [];
}

function extractSourceSymbols(content) {
  const lines = String(content || '').split('\n');
  const symbols = [];
  const patterns = [
    { kind: 'function', regex: /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/ },
    { kind: 'constant', regex: /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/ },
    { kind: 'class', regex: /^\s*class\s+([A-Za-z_$][\w$]*)\b/ },
    { kind: 'export', regex: /^\s*(?:module\.exports\.|exports\.)([A-Za-z_$][\w$]*)\s*=/ },
  ];
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern.regex);
      if (!match) {
        continue;
      }
      symbols.push({
        kind: pattern.kind,
        symbol: match[1],
        anchorText: line.trim(),
      });
      break;
    }
  }
  const deduped = [];
  const seen = new Set();
  for (const entry of symbols) {
    const key = `${entry.kind}:${entry.symbol}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

function extractTestAnchors(content) {
  const lines = String(content || '').split('\n');
  const anchors = [];
  for (const line of lines) {
    const match = line.match(/^\s*(?:test|it|describe)\s*\(\s*(['"`])(.+?)\1/);
    if (!match) {
      continue;
    }
    anchors.push({
      anchorType: 'test_name',
      anchorText: match[2],
      rawLine: line.trim(),
    });
  }
  return anchors;
}

function buildRepeatedConstantOpportunities(sourceFiles) {
  const constantMap = new Map();
  for (const file of sourceFiles) {
    const lines = String(file.content || '').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*const\s+([A-Z][A-Z0-9_]{2,})\s*=/);
      if (!match) {
        continue;
      }
      const name = match[1];
      if (!constantMap.has(name)) {
        constantMap.set(name, new Set());
      }
      constantMap.get(name).add(file.path);
    }
  }
  return Array.from(constantMap.entries())
    .filter(([, paths]) => paths.size > 1)
    .map(([name, paths]) => `Repeated constant ${name} appears in ${Array.from(paths).join(', ')}`);
}

function buildHeuristicOpportunities(sourceTargets, testTargets, repeatedConstants) {
  const opportunities = [];
  opportunities.push(...repeatedConstants);
  for (const target of sourceTargets) {
    if (/(parse|validate|selector|flag|hint|error|watch|risk|policy|recipe|mirror|model|stream)/i.test(target.symbol || target.anchorText)) {
      opportunities.push(`Bounded candidate around ${target.symbol || target.anchorText} in ${target.path}`);
    }
  }
  for (const target of testTargets) {
    if (/(invalid|error|reject|panic|warning|selector|policy|recipe|mirror|model)/i.test(target.anchorText)) {
      opportunities.push(`Existing regression anchor "${target.anchorText}" in ${target.path}`);
    }
  }
  return truncateList(Array.from(new Set(opportunities)), 24);
}

function mineSurfaceCandidates(adapter, surface, repoRoot = adapter.repoRoot) {
  const registry = buildSurfaceTargetRegistry({
    repoRoot,
    surface,
    lineCap: adapter && adapter.defaults && adapter.defaults.staged
      ? adapter.defaults.staged.windowLineCap
      : DEFAULT_WINDOW_LINE_CAP,
  });
  const sourceFiles = [];
  for (const relativePath of surface.paths) {
    if (relativePath.includes('*')) {
      continue;
    }
    const resolved = resolveRepoPath(repoRoot, relativePath);
    const content = fs.readFileSync(resolved.absolutePath, 'utf8');
    sourceFiles.push({ path: relativePath, content });
  }
  const repeatedConstants = buildRepeatedConstantOpportunities(sourceFiles);
  return {
    registry,
    sourceTargets: truncateList(registry.sourceTargets.map((entry) => ({
      id: entry.id,
      path: entry.path,
      symbol: entry.symbol,
      anchorType: entry.anchorType,
      anchorText: entry.anchorText,
      displayName: entry.displayName,
      startLine: entry.startLine,
      endLine: entry.endLine,
    })), 30),
    testTargets: truncateList(registry.testTargets.map((entry) => ({
      id: entry.id,
      path: entry.path,
      anchorType: entry.anchorType,
      anchorText: entry.anchorText,
      displayName: entry.displayName,
      startLine: entry.startLine,
      endLine: entry.endLine,
    })), 24),
    opportunities: buildHeuristicOpportunities(registry.sourceTargets, registry.testTargets, repeatedConstants)
      .concat(truncateList(registry.opportunities || [], 12).map((entry) => entry.summary || entry.displayName))
      .filter(Boolean)
      .slice(0, 24),
  };
}

function buildPlannerPrompt(options) {
  const plannerCandidates = {
    sourceTargets: truncateList(options.candidates.sourceTargets, 12).map((entry) => ({
      id: entry.id,
      path: entry.path,
      displayName: entry.displayName || entry.symbol || entry.anchorText,
    })),
    testTargets: truncateList(options.candidates.testTargets, 10).map((entry) => ({
      id: entry.id,
      path: entry.path,
      displayName: entry.displayName || entry.anchorText,
    })),
    opportunities: truncateList(options.candidates.opportunities, 10),
  };
  return {
    systemPrompt: [
      'You are the staged overnight planner.',
      'Return JSON only.',
      'Pick one bounded change candidate or return no_safe_change.',
      'Do not write patches.',
      'Choose exactly one source target and one test target for propose.',
      'Only choose files from the provided candidate list.',
      'If the change would need more than one source file or one test file, return no_safe_change.',
      'Do not repeat ideas listed in no_retry_ideas or anchor_failures.',
    ].join(' '),
    userPrompt: JSON.stringify({
      objective: options.context.objective,
      surface: {
        id: options.context.surface.id,
        title: options.context.surface.title,
        invariants: options.context.surface.invariants,
        requiredTestKinds: options.context.surface.requiredTestKinds,
      },
      candidates: plannerCandidates,
      no_retry_ideas: truncateList(options.noRetryIdeas, 8).map((entry) => ({
        outcome: entry.outcome,
        reasonCode: entry.reasonCode,
        summary: entry.summary,
      })),
      anchor_failures: truncateList(options.anchorFailures, 6).map((entry) => ({
        stage: entry.stage,
        failureKind: entry.failureKind,
        summary: entry.summary,
      })),
      return_shape: {
        decision: 'propose | no_safe_change',
        change_summary: 'one bounded change idea',
        source_target_id: 'stable source target id from candidates.sourceTargets',
        test_target_id: 'stable test target id from candidates.testTargets',
        why_bounded: 'why this fits one source file and one test file',
        invariants_preserved: ['which invariants stay true'],
        expected_test_kind: 'regression | integration | contract',
      },
    }, null, 2),
  };
}

function buildEditorPrompt(options) {
  return {
    systemPrompt: [
      'You are the staged overnight editor.',
      'Return JSON only.',
      'Edit only inside the provided source_window and test_window.',
      'Do not change files, symbols, or target ids chosen by the planner.',
      'Return one bounded edit sketch, not raw SEARCH/REPLACE patches.',
      'Use replace_block only.',
      'If no safe change fits inside the provided windows, return decision no_safe_change.',
    ].join(' '),
    userPrompt: JSON.stringify({
      objective: options.context.objective,
      surface: {
        id: options.context.surface.id,
        title: options.context.surface.title,
        invariants: options.context.surface.invariants,
      },
      plan: options.plan,
      source_window: options.windows.sourceWindow,
      test_window: options.windows.testWindow,
      no_retry_ideas: options.noRetryIdeas,
      anchor_failures: options.anchorFailures,
      return_shape: {
        decision: 'edit | no_safe_change',
        source_edit: {
          target_id: options.windows.sourceWindow.id,
          operation: 'replace_block',
          start_line: options.windows.sourceWindow.startLine,
          end_line: options.windows.sourceWindow.endLine,
          replacement: 'full replacement text for the chosen source block',
        },
        test_edit: {
          target_id: options.windows.testWindow.id,
          operation: 'replace_block',
          start_line: options.windows.testWindow.startLine,
          end_line: options.windows.testWindow.endLine,
          replacement: 'full replacement text for the chosen test block',
        },
        logical_explanation: {
          problem: 'what is being solved',
          why_this_surface: 'why the chosen surface is correct',
          invariants_preserved: ['which invariants stay true'],
          why_this_is_bounded: 'why the change stays small',
          residual_risks: ['remaining risks or empty list'],
        },
      },
    }, null, 2),
  };
}

function buildEditorRepairPrompt(options) {
  return {
    systemPrompt: options.prompt.systemPrompt,
    userPrompt: JSON.stringify({
      task: 'Repair the staged editor response without changing the chosen files, symbols, or test target.',
      error: options.errorMessage,
      original_response: options.originalText,
      locked_plan: options.plan,
      source_window: options.windows.sourceWindow,
      test_window: options.windows.testWindow,
      reminder: 'Fix only malformed JSON, missing fields, or target-boundary mistakes inside the same chosen windows.',
    }, null, 2),
  };
}

function isCommentLike(line) {
  const trimmed = String(line || '').trim();
  return trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function isTestBoundary(line) {
  return /^\s*(?:test|it|describe)\s*\(/.test(String(line || ''));
}

function stripLineForBlockScan(line) {
  return String(line || '')
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '')
    .replace(/\/\/.*$/g, '');
}

function countCharacters(line, character) {
  return (String(line || '').match(new RegExp(`\\${character}`, 'g')) || []).length;
}

function findStatementEnd(lines, startIndex, lineCap) {
  const limit = Math.min(lines.length, startIndex + lineCap);
  for (let index = startIndex; index < limit; index += 1) {
    const sanitized = stripLineForBlockScan(lines[index]).trim();
    if (sanitized.endsWith(';') || sanitized.endsWith(');') || sanitized.endsWith('})')) {
      return index + 1;
    }
  }
  return Math.min(lines.length, startIndex + 1);
}

function findAnchorLineIndex(lines, target, kind) {
  const anchorText = normalizeText(target.anchorText);
  const symbol = normalizeText(target.symbol);
  if (kind === 'test') {
    return lines.findIndex((line) => isTestBoundary(line) && line.includes(anchorText));
  }
  if (target.anchorType === 'line_contains' && anchorText) {
    return lines.findIndex((line) => line.includes(anchorText));
  }
  const symbolPatterns = [
    new RegExp(`^\\s*(?:async\\s+)?function\\s+${symbol}\\s*\\(`),
    new RegExp(`^\\s*(?:const|let|var)\\s+${symbol}\\s*=`),
    new RegExp(`^\\s*class\\s+${symbol}\\b`),
    new RegExp(`^\\s*(?:module\\.exports\\.|exports\\.)${symbol}\\s*=`),
  ];
  const bySymbol = lines.findIndex((line) => symbolPatterns.some((pattern) => pattern.test(line)));
  if (bySymbol !== -1) {
    return bySymbol;
  }
  if (anchorText) {
    return lines.findIndex((line) => line.includes(anchorText));
  }
  return -1;
}

function buildWindowBounds(lines, anchorIndex, kind, lineCap) {
  let start = anchorIndex;
  while (start > 0 && isCommentLike(lines[start - 1])) {
    start -= 1;
  }
  let end = null;
  let braceDepth = 0;
  let sawBlockStart = false;
  const limit = Math.min(lines.length, start + lineCap);
  for (let index = anchorIndex; index < limit; index += 1) {
    const sanitized = stripLineForBlockScan(lines[index]);
    const openCount = countCharacters(sanitized, '{');
    const closeCount = countCharacters(sanitized, '}');
    if (openCount > 0) {
      sawBlockStart = true;
    }
    braceDepth += openCount;
    braceDepth -= closeCount;
    if (sawBlockStart && braceDepth <= 0) {
      end = index + 1;
      break;
    }
  }
  if (end === null) {
    end = sawBlockStart ? Math.min(lines.length, start + lineCap) : findStatementEnd(lines, anchorIndex, lineCap);
  }
  return { start, end };
}

function buildTargetWindow(options) {
  if (options.target && typeof options.target === 'object' && typeof options.target.excerpt === 'string') {
    return {
      id: options.target.id || null,
      path: options.target.path,
      kind: options.target.kind || options.kind,
      symbol: options.target.symbol || null,
      anchorType: options.target.anchorType,
      anchorText: options.target.anchorText,
      startLine: Number(options.target.startLine),
      endLine: Number(options.target.endLine),
      excerpt: options.target.excerpt,
    };
  }
  if (options.registry && options.targetId) {
    const resolvedTarget = resolveSurfaceTarget(options.registry, options.targetId);
    if (!resolvedTarget) {
      throw new Error(`Could not locate ${options.kind} anchor for ${options.targetId}`);
    }
    return buildTargetWindow({
      target: resolvedTarget,
      kind: options.kind,
    });
  }
  const repoRoot = options.repoRoot;
  const target = options.target;
  const kind = options.kind;
  const lineCap = Math.max(20, Number(options.lineCap) || DEFAULT_WINDOW_LINE_CAP);
  const resolved = resolveRepoPath(repoRoot, target.path);
  const content = fs.readFileSync(resolved.absolutePath, 'utf8');
  const lines = content.split('\n');
  const anchorIndex = findAnchorLineIndex(lines, target, kind);
  if (anchorIndex === -1) {
    throw new Error(`Could not locate ${kind} anchor in ${target.path}`);
  }
  const bounds = buildWindowBounds(lines, anchorIndex, kind, lineCap);
  return {
    path: target.path,
    kind,
    symbol: target.symbol || null,
    anchorType: target.anchorType,
    anchorText: target.anchorText,
    startLine: bounds.start + 1,
    endLine: bounds.end,
    excerpt: lines.slice(bounds.start, bounds.end).join('\n'),
  };
}

function buildTargetWindows(options) {
  const sourceWindow = buildTargetWindow({
    repoRoot: options.repoRoot,
    registry: options.registry || null,
    targetId: options.plan.sourceTargetId,
    target: options.plan.sourceTarget,
    kind: 'source',
    lineCap: options.lineCap,
  });
  const testWindow = buildTargetWindow({
    repoRoot: options.repoRoot,
    registry: options.registry || null,
    targetId: options.plan.testTargetId,
    target: options.plan.testTarget,
    kind: 'test',
    lineCap: options.lineCap,
  });
  return {
    sourceWindow,
    testWindow,
    windowFingerprint: buildWindowFingerprint(sourceWindow, testWindow),
  };
}

function listAnchorFailures(ledger, objectiveHash, surfaceId, sourceTarget) {
  const sourceKey = sourceTarget ? buildSourceTargetKey(sourceTarget) : null;
  return ledger
    .filter((entry) => entry.objectiveHash === objectiveHash && entry.surfaceId === surfaceId)
    .filter((entry) => entry.failureKind && (
      /anchor|window|schema/i.test(entry.failureKind)
      || ['out-of-bound-edit', 'stale-target', 'invalid-target-id'].includes(entry.failureKind)
    ))
    .filter((entry) => !sourceKey || buildSourceTargetKey(entry.sourceTarget) === sourceKey)
    .map((entry) => ({
      stage: entry.stage,
      failureKind: entry.failureKind,
      sourceTarget: entry.sourceTarget,
      testTarget: entry.testTarget,
      failedPath: entry.failedPath,
      failedSearchExcerpt: entry.failedSearchExcerpt,
      summary: entry.summary,
    }));
}

function shouldCoolSourceTarget(ledger, objectiveHash, surfaceId, sourceTarget) {
  const sourceKey = buildSourceTargetKey(sourceTarget);
  const count = ledger
    .filter((entry) => entry.objectiveHash === objectiveHash && entry.surfaceId === surfaceId)
    .filter((entry) => buildSourceTargetKey(entry.sourceTarget) === sourceKey)
    .filter((entry) => ['invalid-target-window', 'anchor-preflight-failed', 'editor-schema-failed', 'out-of-bound-edit', 'stale-target', 'invalid-target-id'].includes(entry.failureKind))
    .length;
  return count >= 2;
}

function validateStagedEditorProposal(options) {
  const proposal = options.proposal;
  const plan = options.plan;
  const staged = options.staged || {};
  const maxSourceFiles = Math.max(1, Number(staged.maxSourceFiles) || 1);
  const maxTestFiles = Math.max(1, Number(staged.maxTestFiles) || 1);
  const maxCodeBlocks = Math.max(1, Number(staged.maxCodeBlocks) || 1);
  const maxTestBlocks = Math.max(1, Number(staged.maxTestBlocks) || 1);

  if (!proposal || typeof proposal !== 'object') {
    return {
      ok: false,
      reasonCode: 'editor-schema-failed',
      nextStep: 'Return a valid staged edit sketch.',
      failureStage: 'editing',
      failureKind: 'editor-schema-failed',
      failedPath: null,
      failedSearchExcerpt: '',
    };
  }

  if (proposal.decision === 'no_safe_change') {
    return {
      ok: false,
      reasonCode: 'no-safe-change',
      nextStep: 'No bounded safe change was identified inside the staged windows.',
      failureStage: 'editing',
      failureKind: 'no-safe-change',
      failedPath: null,
      failedSearchExcerpt: '',
    };
  }

  const sourceEdits = proposal.sourceEdit ? [proposal.sourceEdit] : [];
  const testEdits = proposal.testEdit ? [proposal.testEdit] : [];
  const sourceTargetIds = Array.from(new Set(sourceEdits.map((entry) => normalizeText(entry.targetId)).filter(Boolean)));
  const testTargetIds = Array.from(new Set(testEdits.map((entry) => normalizeText(entry.targetId)).filter(Boolean)));

  if (sourceTargetIds.length > maxSourceFiles || testTargetIds.length > maxTestFiles || sourceEdits.length > maxCodeBlocks || testEdits.length > maxTestBlocks) {
    return {
      ok: false,
      reasonCode: 'too-broad-for-staged-mode',
      nextStep: 'Shrink the staged edit to one source file, one test file, and one block each.',
      failureStage: 'editing',
      failureKind: 'too-broad-for-staged-mode',
      failedPath: null,
      failedSearchExcerpt: '',
    };
  }

  if (sourceEdits.length > 0 && testEdits.length === 0) {
    return {
      ok: false,
      reasonCode: 'missing-tests',
      nextStep: 'Add a matching test edit for the staged source change.',
      failureStage: 'editing',
      failureKind: 'missing-tests',
      failedPath: plan.sourceTarget.path,
      failedSearchExcerpt: '',
    };
  }

  if (sourceTargetIds.some((entry) => entry !== plan.sourceTargetId) || testTargetIds.some((entry) => entry !== plan.testTargetId)) {
    return {
      ok: false,
      reasonCode: 'stale-target',
      nextStep: 'Keep the editor sketch inside the chosen source and test target ids.',
      failureStage: 'editing',
      failureKind: 'stale-target',
      failedPath: null,
      failedSearchExcerpt: '',
    };
  }

  return {
    ok: true,
  };
}

module.exports = {
  DEFAULT_WINDOW_LINE_CAP,
  buildCandidateFingerprint,
  buildEditorPrompt,
  buildEditorRepairPrompt,
  buildPlannerPrompt,
  buildSourceTargetKey,
  buildTargetWindow,
  buildTargetWindows,
  buildWindowFingerprint,
  listAnchorFailures,
  mineSurfaceCandidates,
  normalizeProposalMode,
  parsePlannerResponse,
  shouldCoolSourceTarget,
  validateStagedEditorProposal,
};
