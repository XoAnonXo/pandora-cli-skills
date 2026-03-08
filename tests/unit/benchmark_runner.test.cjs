const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadScenarioSuite,
  loadSuiteLock,
  getSuiteExpectation,
  validateScenarioManifest,
  runBenchmarkSuite,
} = require('../../benchmarks/lib/runner.cjs');

test('benchmark suite manifests load and validate', () => {
  const scenarios = loadScenarioSuite('core');
  const expectation = getSuiteExpectation('core');
  assert.ok(Array.isArray(scenarios));
  assert.equal(scenarios.length, expectation.expectedScenarioCount);
  assert.equal(expectation.minimumWeightedScore, 95);
  const ids = new Set();
  for (const scenario of scenarios) {
    validateScenarioManifest(scenario);
    assert.ok(!ids.has(scenario.id), `duplicate scenario id ${scenario.id}`);
    ids.add(scenario.id);
  }
});

test('benchmark suite produces a fully-passing readiness report', async () => {
  const report = await runBenchmarkSuite({ suite: 'core' });
  const expectedLock = loadSuiteLock('core');
  assert.equal(report.summary.failedCount, 0);
  assert.equal(report.summary.passedCount, report.summary.scenarioCount);
  assert.ok(report.summary.weightedScore >= 95);
  assert.equal(typeof report.contractLock.commandDescriptorVersion, 'string');
  assert.equal(typeof report.contractLock.documentationRegistryHash, 'string');
  assert.equal(typeof report.contractLock.capabilitiesLocalHash, 'string');
  assert.equal(typeof report.contractLock.capabilitiesRemoteTemplateHash, 'string');
  assert.equal(report.contractLockMatchesExpected, true);
  assert.deepEqual(report.contractLockMismatches, []);
  assert.ok(expectedLock);
  assert.ok(report.scenarios.some((scenario) => scenario.id === 'mcp-http-scope-denial'));
  assert.ok(report.scenarios.some((scenario) => scenario.id === 'mcp-http-schema-bootstrap'));
  assert.ok(report.scenarios.some((scenario) => scenario.id === 'mcp-http-operations-get-seeded'));
  assert.ok(report.scenarios.every((scenario) => scenario.score && typeof scenario.score.weighted === 'number'));
  assert.ok(report.parity);
  assert.deepEqual(report.parity.failedGroups, []);
});
