const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  applyPatchSet,
  normalizePatchSet,
  rollbackAppliedPatchSet,
  validatePatchSetAgainstContent,
} = require('../../proving-ground/lib/overnight_patch_engine.cjs');

test('normalizePatchSet validates the SEARCH/REPLACE contract', () => {
  const patchSet = normalizePatchSet([{
    path: 'file.txt',
    search: 'alpha',
    replace: 'beta',
    context_before: '',
    context_after: '',
  }]);
  assert.equal(patchSet.length, 1);
  assert.equal(patchSet[0].path, 'file.txt');
});

test('applyPatchSet updates files and rollback restores them', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-patch-'));
  const targetPath = path.join(tempDir, 'sample.txt');
  fs.writeFileSync(targetPath, 'alpha\nbeta\n');

  const applied = applyPatchSet([{
    path: 'sample.txt',
    search: 'beta',
    replace: 'gamma',
    context_before: '\n',
    context_after: '\n',
  }], { cwd: tempDir });

  assert.match(fs.readFileSync(targetPath, 'utf8'), /gamma/);
  assert.equal(applied.summary.touchedFiles, 1);

  rollbackAppliedPatchSet(applied);
  assert.equal(fs.readFileSync(targetPath, 'utf8'), 'alpha\nbeta\n');
});

test('applyPatchSet rejects ambiguous matches without enough context', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-patch-'));
  const targetPath = path.join(tempDir, 'sample.txt');
  fs.writeFileSync(targetPath, 'alpha\nbeta\nalpha\nbeta\n');

  assert.throws(() => applyPatchSet([{
    path: 'sample.txt',
    search: 'alpha',
    replace: 'omega',
    context_before: '',
    context_after: '',
  }], { cwd: tempDir }), /ambiguous|multiple/i);
});

test('applyPatchSet disambiguates with surrounding context', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-patch-'));
  const targetPath = path.join(tempDir, 'sample.txt');
  fs.writeFileSync(targetPath, 'first\nalpha\nmiddle\nalpha\nlast\n');

  const applied = applyPatchSet([{
    path: 'sample.txt',
    search: 'alpha',
    replace: 'omega',
    context_before: 'middle\n',
    context_after: '\nlast',
  }], { cwd: tempDir });

  assert.equal(fs.readFileSync(targetPath, 'utf8'), 'first\nalpha\nmiddle\nomega\nlast\n');
  rollbackAppliedPatchSet(applied);
});

test('applyPatchSet window mode only matches inside the staged window', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-patch-'));
  const targetPath = path.join(tempDir, 'sample.txt');
  fs.writeFileSync(targetPath, [
    'alpha',
    'keep',
    'divider',
    'alpha',
    'last',
    '',
  ].join('\n'));

  const applied = applyPatchSet([{
    path: 'sample.txt',
    search: 'alpha',
    replace: 'omega',
    context_before: 'divider\n',
    context_after: '\nlast',
    match_mode: 'window',
    window_start_line: 3,
    window_end_line: 5,
  }], { cwd: tempDir });

  assert.equal(
    fs.readFileSync(targetPath, 'utf8'),
    ['alpha', 'keep', 'divider', 'omega', 'last', ''].join('\n'),
  );
  rollbackAppliedPatchSet(applied);
});

test('applyPatchSet window mode tolerates trailing whitespace inside the staged window', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-patch-'));
  const targetPath = path.join(tempDir, 'sample.txt');
  fs.writeFileSync(targetPath, 'alpha\nbeta   \nomega\n');

  const applied = applyPatchSet([{
    path: 'sample.txt',
    search: 'beta',
    replace: 'gamma',
    context_before: 'alpha\n',
    context_after: '\nomega',
    match_mode: 'window',
    window_start_line: 1,
    window_end_line: 3,
  }], { cwd: tempDir });

  assert.equal(fs.readFileSync(targetPath, 'utf8'), 'alpha\ngamma\nomega\n');
  rollbackAppliedPatchSet(applied);
});

test('applyPatchSet window mode rejects replacements that change staged line count', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-patch-'));
  const targetPath = path.join(tempDir, 'sample.txt');
  fs.writeFileSync(targetPath, 'alpha\nbeta\nomega\n');

  assert.throws(() => applyPatchSet([{
    path: 'sample.txt',
    search: 'beta',
    replace: 'gamma\ndelta',
    context_before: 'alpha\n',
    context_after: '\nomega',
    match_mode: 'window',
    window_start_line: 1,
    window_end_line: 3,
  }], { cwd: tempDir }), /line count inside staged window/i);
});

test('validatePatchSetAgainstContent checks SEARCH blocks against provided windows', () => {
  const matches = validatePatchSetAgainstContent([{
    path: 'sample.txt',
    search: 'beta',
    replace: 'gamma',
    context_before: 'alpha\n',
    context_after: '\nomega',
  }], {
    'sample.txt': 'alpha\nbeta\nomega\n',
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].path, 'sample.txt');

  assert.throws(() => validatePatchSetAgainstContent([{
    path: 'sample.txt',
    search: 'missing',
    replace: 'gamma',
    context_before: '',
    context_after: '',
  }], {
    'sample.txt': 'alpha\nbeta\nomega\n',
  }), /SEARCH block|missing|context/i);
});

test('validatePatchSetAgainstContent honors staged window boundaries', () => {
  const matches = validatePatchSetAgainstContent([{
    path: 'sample.txt',
    search: 'alpha',
    replace: 'omega',
    context_before: 'divider\n',
    context_after: '\nlast',
    match_mode: 'window',
    window_start_line: 3,
    window_end_line: 5,
  }], {
    'sample.txt': 'alpha\nkeep\ndivider\nalpha\nlast\n',
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].path, 'sample.txt');
  assert.equal(matches[0].matchIndex, 'alpha\nkeep\ndivider\n'.length);
});

test('validatePatchSetAgainstContent rejects staged window replacements that change line count', () => {
  assert.throws(() => validatePatchSetAgainstContent([{
    path: 'sample.txt',
    search: 'alpha',
    replace: 'omega\ndelta',
    context_before: 'divider\n',
    context_after: '\nlast',
    match_mode: 'window',
    window_start_line: 3,
    window_end_line: 5,
  }], {
    'sample.txt': 'alpha\nkeep\ndivider\nalpha\nlast\n',
  }), /line count inside staged window/i);
});
