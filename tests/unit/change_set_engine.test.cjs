const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  applyChangeSet,
  normalizeChangeSet,
  rollbackAppliedChangeSet,
} = require('../../proving-ground/lib/change_set_engine.cjs');

test('normalizeChangeSet validates supported operations', () => {
  const changeSet = normalizeChangeSet([{
    kind: 'replace_once',
    path: 'file.txt',
    match: 'hello',
    replace: 'world',
  }]);

  assert.equal(changeSet.length, 1);
  assert.equal(changeSet[0].kind, 'replace_once');
});

test('applyChangeSet updates files and rollback restores them', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-change-set-'));
  const targetPath = path.join(tempDir, 'sample.txt');
  fs.writeFileSync(targetPath, 'alpha\nbeta\n');

  const applied = applyChangeSet([
    {
      kind: 'replace_once',
      path: 'sample.txt',
      match: 'beta',
      replace: 'gamma',
    },
  ], { cwd: tempDir });

  assert.match(fs.readFileSync(targetPath, 'utf8'), /gamma/);
  assert.equal(applied.summary.touchedFiles, 1);

  rollbackAppliedChangeSet(applied);
  assert.equal(fs.readFileSync(targetPath, 'utf8'), 'alpha\nbeta\n');
});

test('applyChangeSet rejects repo-escaping paths', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-change-set-'));
  assert.throws(() => applyChangeSet([{
    kind: 'replace_once',
    path: '../escape.txt',
    match: 'a',
    replace: 'b',
  }], { cwd: tempDir }));
});
