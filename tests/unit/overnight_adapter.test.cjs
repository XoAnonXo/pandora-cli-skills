const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildStarterAdapter,
  loadOvernightAdapter,
  matchesPathPattern,
} = require('../../proving-ground/lib/overnight_adapter.cjs');
const { loadOvernightObjective } = require('../../proving-ground/lib/overnight_objective.cjs');
const { writeYamlFile } = require('../../proving-ground/lib/overnight_yaml.cjs');

test('matchesPathPattern handles direct paths and globs', () => {
  assert.equal(matchesPathPattern('cli/lib/file.cjs', 'cli/lib/file.cjs'), true);
  assert.equal(matchesPathPattern('cli/lib/file.cjs', 'cli/lib/*.cjs'), true);
  assert.equal(matchesPathPattern('cli/lib/sub/file.cjs', 'cli/lib/**/*.cjs'), true);
  assert.equal(matchesPathPattern('tests/unit/file.test.cjs', 'cli/lib/**/*.cjs'), false);
});

test('loadOvernightAdapter parses Pandora overnight adapter', () => {
  const adapter = loadOvernightAdapter('overnight.yaml', {
    repoRoot: path.resolve(__dirname, '..', '..'),
  });
  assert.equal(adapter.surfaces.length, 10);
  assert.equal(adapter.defaults.proposer.provider, 'minimax');
  assert.equal(adapter.defaults.audit.provider, 'deferred');
  assert.equal(adapter.defaults.proposalMode, 'legacy');
  assert.deepEqual(adapter.defaults.staged, {
    maxSourceFiles: 1,
    maxTestFiles: 1,
    maxCodeBlocks: 1,
    maxTestBlocks: 1,
    windowLineCap: 120,
  });
});

test('loadOvernightObjective rejects unknown surfaces', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-objective-'));
  writeYamlFile(path.join(repoRoot, 'overnight.yaml'), {
    repo: {
      name: 'fixture',
      setup: 'npm install',
      baseline_validation: ['node --test tests/unit/example.test.cjs'],
      final_validation: ['node --test tests/unit/example.test.cjs'],
    },
    surfaces: [
      {
        id: 'core',
        title: 'Core',
        paths: ['src/example.cjs'],
        test_paths: ['tests/unit/example.test.cjs'],
        invariants: ['keep behavior stable'],
        risk: 'safe',
        required_test_kinds: ['regression'],
        context_patterns: [],
        allowed_dependencies: [],
        forbidden_paths: [],
      },
    ],
    manual_only_paths: [],
    shared_paths: [],
    defaults: {},
  });
  writeYamlFile(path.join(repoRoot, 'objective.yaml'), {
    goal: 'break it',
    allowed_surfaces: ['missing'],
    success: ['do something'],
    required_tests: ['regression'],
    stop_conditions: ['none'],
    evidence: [],
    priority: 'medium',
  });
  const adapter = loadOvernightAdapter(path.join(repoRoot, 'overnight.yaml'), { repoRoot });
  assert.throws(() => loadOvernightObjective(path.join(repoRoot, 'objective.yaml'), adapter, { repoRoot }), /unknown surface/);
});

test('buildStarterAdapter creates a conservative scaffold', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-starter-'));
  fs.mkdirSync(path.join(repoRoot, 'src'));
  fs.mkdirSync(path.join(repoRoot, 'tests'));
  fs.writeFileSync(path.join(repoRoot, 'src', 'index.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(repoRoot, 'tests', 'index.test.js'), 'ok\n');
  fs.writeFileSync(path.join(repoRoot, '.gitignore'), 'node_modules\n');
  require('node:child_process').execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
  require('node:child_process').execFileSync('git', ['add', '.'], { cwd: repoRoot, stdio: 'ignore' });
  require('node:child_process').execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'], { cwd: repoRoot, stdio: 'ignore' });
  const starter = buildStarterAdapter(repoRoot);
  assert.equal(starter.surfaces[0].id, 'core');
  assert.equal(Array.isArray(starter.defaults.repo_scan_hint.top_level_dirs), true);
  assert.equal(starter.defaults.proposal_mode, 'legacy');
  assert.equal(starter.defaults.staged.window_line_cap, 120);
});
