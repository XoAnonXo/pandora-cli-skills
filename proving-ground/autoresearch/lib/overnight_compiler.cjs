const { normalizeText } = require('./baton_common.cjs');
const { validatePatchSetAgainstContent } = require('./overnight_patch_engine.cjs');

function normalizeDecision(value) {
  const decision = normalizeText(value).toLowerCase();
  if (!decision) {
    return 'edit';
  }
  if (['edit', 'replace_block'].includes(decision)) {
    return 'edit';
  }
  if (['no_safe_change', 'no-safe-change', 'no_op', 'no-op', 'noop'].includes(decision)) {
    return 'no_safe_change';
  }
  throw new Error('decision must be edit or no_safe_change');
}

function normalizeTargetWindow(window, role) {
  if (!window || typeof window !== 'object' || Array.isArray(window)) {
    throw new Error(`${role} window must be an object`);
  }
  const normalized = {
    id: normalizeText(window.id || window.targetId || window.target_id),
    path: normalizeText(window.path),
    kind: normalizeText(window.kind || role),
    startLine: Number(window.startLine || window.start_line),
    endLine: Number(window.endLine || window.end_line),
    excerpt: String(window.excerpt ?? window.text ?? ''),
  };
  if (!normalized.id) {
    throw new Error(`${role} window is missing id`);
  }
  if (!normalized.path) {
    throw new Error(`${role} window is missing path`);
  }
  if (!Number.isInteger(normalized.startLine) || normalized.startLine < 1) {
    throw new Error(`${role} window is missing a valid startLine`);
  }
  if (!Number.isInteger(normalized.endLine) || normalized.endLine < normalized.startLine) {
    throw new Error(`${role} window is missing a valid endLine`);
  }
  if (!normalized.excerpt) {
    throw new Error(`${role} window is missing excerpt`);
  }
  return normalized;
}

function normalizeEditBlock(block, role) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    throw new Error(`${role} edit must be an object`);
  }
  const normalized = {
    targetId: normalizeText(block.target_id || block.targetId || block.id),
    operation: normalizeText(block.operation).toLowerCase() || 'replace_block',
    startLine: block.start_line === undefined && block.startLine === undefined
      ? null
      : Number(block.start_line || block.startLine),
    endLine: block.end_line === undefined && block.endLine === undefined
      ? null
      : Number(block.end_line || block.endLine),
    replacement: String(block.replacement ?? block.new_code ?? block.newCode ?? ''),
  };
  if (normalized.operation !== 'replace_block') {
    throw new Error(`${role} edit operation must be replace_block`);
  }
  if (!normalized.replacement) {
    throw new Error(`${role} edit is missing replacement`);
  }
  return normalized;
}

function normalizeSketch(sketch) {
  if (!sketch || typeof sketch !== 'object' || Array.isArray(sketch)) {
    throw new Error('sketch must be an object');
  }
  const decision = normalizeDecision(sketch.decision);
  if (decision === 'no_safe_change') {
    return {
      decision,
      logicalExplanation: sketch.logical_explanation || sketch.logicalExplanation || null,
    };
  }
  const sourceEdit = normalizeEditBlock(
    sketch.source_edit || sketch.sourceEdit || sketch.code_change || sketch.codeChange,
    'source',
  );
  const testEditValue = sketch.test_edit || sketch.testEdit || sketch.test_change || sketch.testChange;
  const testEdit = testEditValue ? normalizeEditBlock(testEditValue, 'test') : null;
  return {
    decision,
    logicalExplanation: sketch.logical_explanation || sketch.logicalExplanation || null,
    sourceEdit,
    testEdit,
  };
}

function splitWindowLines(window) {
  return String(window.excerpt).split('\n');
}

function buildTextRange(lines, startIndex, endIndex) {
  return lines.slice(startIndex, endIndex).join('\n');
}

function buildPatchBlock(window, edit, role) {
  const lines = splitWindowLines(window);
  const windowStart = window.startLine;
  const windowEnd = window.endLine;
  const startLine = edit.startLine === null ? windowStart : edit.startLine;
  const endLine = edit.endLine === null ? windowEnd : edit.endLine;
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
    throw new Error(`${role} edit must include valid startLine and endLine or omit both`);
  }
  if (startLine < windowStart || endLine > windowEnd || endLine < startLine) {
    const error = new Error(`${role} edit leaves the target boundary`);
    error.reasonCode = 'out-of-bound-edit';
    throw error;
  }
  const startIndex = startLine - windowStart;
  const endIndex = endLine - windowStart + 1;
  const search = buildTextRange(lines, startIndex, endIndex);
  if (!search) {
    const error = new Error(`${role} edit selects an empty range`);
    error.reasonCode = 'invalid-target-id';
    throw error;
  }
  const contextBefore = startIndex > 0 ? `${buildTextRange(lines, 0, startIndex)}\n` : '';
  const contextAfter = endIndex < lines.length ? `\n${buildTextRange(lines, endIndex, lines.length)}` : '';
  const patch = {
    path: window.path,
    search,
    replace: edit.replacement,
    context_before: contextBefore,
    context_after: contextAfter,
  };
  validatePatchSetAgainstContent([patch], {
    [window.path]: window.excerpt,
  });
  return patch;
}

function rejectCompilation(reasonCode, failureKind, message, details = {}) {
  return {
    ok: false,
    decision: 'reject',
    reasonCode,
    failureKind,
    message,
    ...details,
  };
}

function compileEditSketch(options = {}) {
  const sketch = normalizeSketch(options.sketch || options.proposal);
  if (sketch.decision === 'no_safe_change') {
    return {
      ok: true,
      decision: 'no_safe_change',
      codeChanges: [],
      testChanges: [],
      patchSet: [],
      logicalExplanation: sketch.logicalExplanation || null,
      reasonCode: 'no-safe-change',
    };
  }

  const sourceWindow = normalizeTargetWindow(options.sourceWindow || options.sourceSpan, 'source');
  const testWindow = options.testWindow || options.testSpan
    ? normalizeTargetWindow(options.testWindow || options.testSpan, 'test')
    : null;

  const boundSourceEdit = {
    ...sketch.sourceEdit,
    targetId: sketch.sourceEdit.targetId || sourceWindow.id,
  };
  const boundTestEdit = sketch.testEdit
    ? {
        ...sketch.testEdit,
        targetId: sketch.testEdit.targetId || (testWindow ? testWindow.id : ''),
      }
    : null;

  if (boundSourceEdit.targetId !== sourceWindow.id) {
    return rejectCompilation(
      'stale-target',
      'stale-target',
      'source target id does not match the caller context',
      { targetId: boundSourceEdit.targetId, path: sourceWindow.path },
    );
  }

  if (!boundTestEdit || !boundTestEdit.targetId) {
    return rejectCompilation(
      'invalid-target-id',
      'invalid-target-id',
      'test target id is required for a source change',
      { path: testWindow ? testWindow.path : null },
    );
  }
  if (!testWindow) {
    return rejectCompilation(
      'invalid-target-id',
      'invalid-target-id',
      'test target window is required for a source change',
      { targetId: boundTestEdit.targetId },
    );
  }
  if (boundTestEdit.targetId !== testWindow.id) {
    return rejectCompilation(
      'stale-target',
      'stale-target',
      'test target id does not match the caller context',
      { targetId: boundTestEdit.targetId, path: testWindow.path },
    );
  }

  let codeBlock;
  let testBlock;
  try {
    codeBlock = buildPatchBlock(sourceWindow, boundSourceEdit, 'source');
    testBlock = buildPatchBlock(testWindow, boundTestEdit, 'test');
  } catch (error) {
    const reasonCode = error && error.reasonCode ? error.reasonCode : 'out-of-bound-edit';
    return rejectCompilation(
      reasonCode,
      reasonCode,
      normalizeText(error && error.message) || 'edit could not be compiled inside the target boundary',
      {
        path: error && error.path ? error.path : (reasonCode === 'out-of-bound-edit' ? sourceWindow.path : null),
        targetId: error && error.targetId ? error.targetId : null,
      },
    );
  }

  return {
    ok: true,
    decision: 'edit',
    reasonCode: null,
    failureKind: null,
    logicalExplanation: sketch.logicalExplanation || null,
    codeChanges: [codeBlock],
    testChanges: [testBlock],
    patchSet: [codeBlock, testBlock],
    boundEdits: {
      source: boundSourceEdit,
      test: boundTestEdit,
    },
    targets: {
      source: sourceWindow,
      test: testWindow,
    },
  };
}

module.exports = {
  buildPatchBlock,
  compileEditSketch,
  normalizeEditBlock,
  normalizeSketch,
  normalizeTargetWindow,
};
