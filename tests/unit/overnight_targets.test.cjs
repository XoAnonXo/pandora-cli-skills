const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildSurfaceTargetRegistry,
  findTargetById,
  listTargetIds,
  resolveSurfaceTarget,
  resolveTargetById,
} = require('../../proving-ground/lib/overnight_targets.cjs');

function writeFixtureRepo(rootDir) {
  fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'tests', 'unit'), { recursive: true });

  fs.writeFileSync(path.join(rootDir, 'src', 'calc.cjs'), [
    'function sanitizeCount(value) {',
    '  if (!Number.isFinite(value)) return 0;',
    '  return value < 0 ? 0 : value;',
    '}',
    '',
    'const buildCounter = () => sanitizeCount(1);',
    '',
    'class CounterBox {',
    '  value() {',
    '    return sanitizeCount(4);',
    '  }',
    '}',
    '',
    'module.exports = { sanitizeCount, buildCounter, CounterBox };',
    '',
  ].join('\n'));

  fs.writeFileSync(path.join(rootDir, 'tests', 'unit', 'calc.test.cjs'), [
    "const test = require('node:test');",
    "const assert = require('node:assert/strict');",
    "const { sanitizeCount, buildCounter } = require('../../src/calc.cjs');",
    '',
    "test('sanitizeCount floors negatives', () => {",
    '  assert.equal(sanitizeCount(-5), 0);',
    '  assert.equal(sanitizeCount(9), 9);',
    '});',
    '',
    "test('buildCounter returns a safe count', () => {",
    '  assert.equal(buildCounter(), 1);',
    '});',
    '',
  ].join('\n'));
}

test('buildSurfaceTargetRegistry discovers stable source and test target ids', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-targets-'));
  writeFixtureRepo(repoRoot);

  const registry = buildSurfaceTargetRegistry({
    repoRoot,
    surface: {
      id: 'core',
      title: 'Core',
      paths: ['src/**/*.cjs'],
      testPaths: ['tests/**/*.cjs'],
    },
  });

  assert.equal(registry.entries.length, registry.sourceTargets.length + registry.testTargets.length);
  assert.equal(typeof registry.byId['source:calc:sanitize-count'], 'object');
  assert.match(registry.byId['source:calc:sanitize-count'].displayName, /sanitizeCount/i);
  assert.equal(Array.isArray(registry.opportunities), true);
  assert.match(registry.opportunities[0].displayName, /buildCounter|sanitizeCount|CounterBox/i);
  assert.equal(registry.sourceTargets.length >= 3, true);
  assert.equal(registry.testTargets.length >= 2, true);
  assert.deepEqual(listTargetIds(registry, 'source').slice(0, 2), [
    'source:calc:build-counter',
    'source:calc:counter-box',
  ]);
  assert.deepEqual(listTargetIds(registry, 'test').slice(0, 2), [
    'test:calc-test:build-counter-returns-a-safe-count',
    'test:calc-test:sanitize-count-floors-negatives',
  ]);
});

test('resolveTargetById returns the discovered target with span data', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-targets-'));
  writeFixtureRepo(repoRoot);

  const registry = buildSurfaceTargetRegistry({
    repoRoot,
    surface: {
      id: 'core',
      title: 'Core',
      paths: ['src/**/*.cjs'],
      testPaths: ['tests/**/*.cjs'],
    },
  });

  const target = resolveSurfaceTarget(registry, 'source:calc:sanitize-count');
  assert.equal(target.kind, 'source');
  assert.equal(target.path, 'src/calc.cjs');
  assert.equal(target.symbol, 'sanitizeCount');
  assert.equal(target.startLine, 1);
  assert.equal(target.endLine, 4);
  assert.match(target.excerpt, /function sanitizeCount/);
  assert.match(target.excerpt, /return value < 0 \? 0 : value;/);
  assert.doesNotMatch(target.excerpt, /module\.exports/);
  assert.equal(resolveTargetById(registry, 'source:calc:sanitize-count').id, target.id);
});

test('findTargetById returns null and resolveTargetById throws for unknown ids', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-targets-'));
  writeFixtureRepo(repoRoot);

  const registry = buildSurfaceTargetRegistry({
    repoRoot,
    surface: {
      id: 'core',
      title: 'Core',
      paths: ['src/**/*.cjs'],
      testPaths: ['tests/**/*.cjs'],
    },
  });

  assert.equal(findTargetById(registry, 'source:calc:missing'), null);
  assert.throws(() => resolveTargetById(registry, 'source:calc:missing'), /Target not found/);
});
