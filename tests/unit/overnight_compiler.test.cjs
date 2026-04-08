const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compileEditSketch,
  normalizeTargetWindow,
} = require('../../proving-ground/lib/overnight_compiler.cjs');

function buildWindow() {
  return normalizeTargetWindow({
    id: 'src:calc:sanitizeCount',
    path: 'src/calc.cjs',
    kind: 'source',
    startLine: 1,
    endLine: 6,
    excerpt: [
      'function sanitizeCount(value) {',
      '  if (!Number.isFinite(value)) return 0;',
      '  return value < 0 ? 0 : value;',
      '}',
      '',
      'module.exports = { sanitizeCount };',
    ].join('\n'),
  }, 'source');
}

function buildTestWindow() {
  return normalizeTargetWindow({
    id: 'test:calc:sanitizeCount',
    path: 'tests/unit/calc.test.cjs',
    kind: 'test',
    startLine: 1,
    endLine: 8,
    excerpt: [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "const { sanitizeCount } = require('../../src/calc.cjs');",
      '',
      "test('sanitizeCount floors negatives', () => {",
      '  assert.equal(sanitizeCount(-5), 0);',
      '  assert.equal(sanitizeCount(9), 9);',
      '});',
    ].join('\n'),
  }, 'test');
}

test('compileEditSketch turns a bounded edit sketch into patch blocks', () => {
  const result = compileEditSketch({
    sketch: {
      decision: 'edit',
      source_edit: {
        target_id: 'src:calc:sanitizeCount',
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
        target_id: 'test:calc:sanitizeCount',
        operation: 'replace_block',
        start_line: 5,
        end_line: 8,
        replacement: [
          "test('sanitizeCount floors negatives', () => {",
          '  assert.equal(sanitizeCount(-5), 0);',
          '  assert.equal(sanitizeCount(9), 9);',
          '  assert.equal(sanitizeCount(400), 100);',
          '});',
        ].join('\n'),
      },
      logical_explanation: {
        problem: 'Clamp sanitizeCount at 100.',
        why_this_is_bounded: 'One helper and one test.',
      },
    },
    sourceWindow: buildWindow(),
    testWindow: buildTestWindow(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.decision, 'edit');
  assert.equal(result.codeChanges.length, 1);
  assert.equal(result.testChanges.length, 1);
  assert.match(result.patchSet[0].search, /sanitizeCount/);
  assert.match(result.patchSet[1].replace, /400/);
});

test('compileEditSketch rejects an edit that leaves the target boundary', () => {
  const result = compileEditSketch({
    sketch: {
      decision: 'edit',
      source_edit: {
        target_id: 'src:calc:sanitizeCount',
        operation: 'replace_block',
        start_line: 1,
        end_line: 999,
        replacement: 'broken',
      },
      test_edit: {
        target_id: 'test:calc:sanitizeCount',
        operation: 'replace_block',
        start_line: 5,
        end_line: 8,
        replacement: 'test',
      },
    },
    sourceWindow: buildWindow(),
    testWindow: buildTestWindow(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, 'out-of-bound-edit');
  assert.equal(result.failureKind, 'out-of-bound-edit');
});

test('compileEditSketch rejects stale and invalid target ids', () => {
  const stale = compileEditSketch({
    sketch: {
      decision: 'edit',
      source_edit: {
        target_id: 'src:calc:otherTarget',
        operation: 'replace_block',
        start_line: 1,
        end_line: 4,
        replacement: 'broken',
      },
      test_edit: {
        target_id: 'test:calc:sanitizeCount',
        operation: 'replace_block',
        start_line: 5,
        end_line: 8,
        replacement: 'test',
      },
    },
    sourceWindow: buildWindow(),
    testWindow: buildTestWindow(),
  });

  assert.equal(stale.ok, false);
  assert.equal(stale.reasonCode, 'stale-target');

  const invalid = compileEditSketch({
    sketch: {
      decision: 'edit',
      source_edit: {
        operation: 'replace_block',
        start_line: 1,
        end_line: 4,
        replacement: 'broken',
      },
    },
    sourceWindow: buildWindow(),
    testWindow: buildTestWindow(),
  });

  assert.equal(invalid.ok, false);
  assert.equal(invalid.reasonCode, 'invalid-target-id');
});

test('compileEditSketch binds omitted target ids to the caller-selected windows', () => {
  const result = compileEditSketch({
    sketch: {
      decision: 'edit',
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
        start_line: 5,
        end_line: 8,
        replacement: [
          "test('sanitizeCount floors negatives', () => {",
          '  assert.equal(sanitizeCount(-5), 0);',
          '  assert.equal(sanitizeCount(9), 9);',
          '  assert.equal(sanitizeCount(400), 100);',
          '});',
        ].join('\n'),
      },
    },
    sourceWindow: buildWindow(),
    testWindow: buildTestWindow(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.boundEdits.source.targetId, 'src:calc:sanitizeCount');
  assert.equal(result.boundEdits.test.targetId, 'test:calc:sanitizeCount');
});

test('compileEditSketch supports no_safe_change sketches', () => {
  const result = compileEditSketch({
    sketch: {
      decision: 'no_safe_change',
      logical_explanation: {
        problem: 'Nothing bounded enough to change.',
      },
    },
    sourceWindow: buildWindow(),
    testWindow: buildTestWindow(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.decision, 'no_safe_change');
  assert.deepEqual(result.patchSet, []);
});
