const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  loadScenarioSuite,
  loadSuiteLock,
  getSuiteExpectation,
  validateScenarioManifest,
  compareContractLock,
} = require('../../benchmarks/lib/runner.cjs');
const { getAssertion } = require('../../benchmarks/lib/assertions.cjs');
const {
  computeExpectedBenchmarkPaths,
  validateCommittedBenchmarkArtifacts,
  buildRefreshHints,
  formatFailureOutput,
} = require('../../scripts/check_agent_benchmarks.cjs');
const { buildPublicationArtifacts } = require('../../scripts/build_benchmark_publication_bundle.cjs');
const { createMcpToolRegistry } = require('../../cli/lib/mcp_tool_registry.cjs');

function loadJsonCommand(args) {
  const rootDir = path.resolve(__dirname, '..', '..');
  return JSON.parse(
    execFileSync(process.execPath, ['cli/pandora.cjs', ...args], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
}

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
  const rootDir = path.resolve(__dirname, '..', '..');
  const output = execFileSync(process.execPath, ['scripts/check_agent_benchmarks.cjs'], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const report = JSON.parse(output);
  const expectedLock = loadSuiteLock('core');
  const expectation = getSuiteExpectation('core');
  assert.equal(report.summary.failedCount, 0);
  assert.equal(report.summary.passedCount, report.summary.scenarioCount);
  assert.ok(
    report.summary.weightedScore >= expectation.minimumWeightedScore,
    `expected weightedScore >= ${expectation.minimumWeightedScore}, received ${report.summary.weightedScore}`,
  );
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

test('benchmark trust checker flags stale committed report path and lock inconsistencies', () => {
  const paths = computeExpectedBenchmarkPaths('core');
  const suiteScenarios = loadScenarioSuite('core');
  const lockDocument = loadSuiteLock('core');
  const committedReport = JSON.parse(fs.readFileSync(paths.reportPath, 'utf8'));

  const mutatedReport = JSON.parse(JSON.stringify(committedReport));
  mutatedReport.expectedContractLockPath = 'benchmarks/locks/not-core.lock.json';
  mutatedReport.writtenLockPath = path.join(path.dirname(paths.lockPath), 'wrong.lock.json');
  mutatedReport.contractLockMatchesExpected = false;
  mutatedReport.contractLockMismatches = ['contractLock.generatedArtifactHashes mismatch'];
  mutatedReport.summary.overallPass = true;
  mutatedReport.scenarios = mutatedReport.scenarios.slice().reverse();

  const failures = validateCommittedBenchmarkArtifacts(mutatedReport, lockDocument, {
    suite: 'core',
    suiteScenarios,
    reportRelativePath: paths.reportRelativePath,
    lockRelativePath: paths.lockRelativePath,
    lockPath: paths.lockPath,
  });

  assert.ok(
    failures.some((message) => message.includes('expectedContractLockPath must be')),
    `expected expectedContractLockPath failure, received: ${failures.join(' | ')}`,
  );
  assert.ok(
    failures.some((message) => message.includes('writtenLockPath must resolve')),
    `expected writtenLockPath failure, received: ${failures.join(' | ')}`,
  );
  assert.ok(
    failures.some((message) => message.includes('contractLockMatchesExpected=true')),
    `expected contractLockMatchesExpected failure, received: ${failures.join(' | ')}`,
  );
  assert.ok(
    failures.some((message) => message.includes('still records contract lock mismatches')),
    `expected contractLockMismatches failure, received: ${failures.join(' | ')}`,
  );
  assert.ok(
    failures.some((message) => message.includes('scenario ids/order drift')),
    `expected scenario order failure, received: ${failures.join(' | ')}`,
  );
  assert.ok(
    failures.some((message) => message.includes('overallPass is inconsistent')),
    `expected overallPass failure, received: ${failures.join(' | ')}`,
  );
});

test('committed public benchmark bundle is internally consistent and self-describing', () => {
  const paths = computeExpectedBenchmarkPaths('core');
  const suiteScenarios = loadScenarioSuite('core');
  const lockDocument = loadSuiteLock('core');
  const committedReport = JSON.parse(fs.readFileSync(paths.reportPath, 'utf8'));
  const committedBundle = JSON.parse(fs.readFileSync(paths.bundlePath, 'utf8'));
  const committedHistory = JSON.parse(fs.readFileSync(paths.historyPath, 'utf8'));
  const committedDocsHistory = JSON.parse(fs.readFileSync(paths.docsHistoryPath, 'utf8'));
  const expectedPublicationArtifacts = buildPublicationArtifacts({
    reportPath: paths.reportPath,
    lockPath: paths.lockPath,
    bundlePath: paths.bundlePath,
    historyPath: paths.historyPath,
    docsHistoryPath: paths.docsHistoryPath,
  });

  const failures = validateCommittedBenchmarkArtifacts(committedReport, lockDocument, {
    suite: 'core',
    suiteScenarios,
    reportPath: paths.reportPath,
    bundlePath: paths.bundlePath,
    historyPath: paths.historyPath,
    docsHistoryPath: paths.docsHistoryPath,
    reportRelativePath: paths.reportRelativePath,
    bundleRelativePath: paths.bundleRelativePath,
    historyRelativePath: paths.historyRelativePath,
    docsHistoryRelativePath: paths.docsHistoryRelativePath,
    lockRelativePath: paths.lockRelativePath,
    lockPath: paths.lockPath,
  });

  assert.deepEqual(failures, []);
  assert.equal(committedReport.expectedContractLockPath, paths.lockRelativePath);
  assert.equal(committedReport.contractLockMatchesExpected, true);
  assert.equal(committedReport.summary.overallPass, true);
  assert.equal(committedReport.summary.failedCount, 0);
  assert.equal(committedReport.summary.failedParityGroupCount, 0);
  assert.equal(committedBundle.assets.reportPath, paths.reportRelativePath);
  assert.equal(committedBundle.assets.lockPath, paths.lockRelativePath);
  assert.equal(committedBundle.assets.historyPath, paths.historyRelativePath);
  assert.equal(committedBundle.assets.docsHistoryPath, paths.docsHistoryRelativePath);
  assert.deepEqual(committedBundle, expectedPublicationArtifacts.bundle);
  assert.deepEqual(committedHistory, expectedPublicationArtifacts.history);
  assert.deepEqual(committedDocsHistory, expectedPublicationArtifacts.history);
  assert.equal(committedHistory.entries[0].version, committedReport.runtime.packageVersion);
  assert.equal(committedHistory.entries[0].overallPass, true);

  const scenarioIds = new Set();
  for (const scenario of committedReport.scenarios) {
    assert.equal(typeof scenario.id, 'string');
    assert.equal(typeof scenario.title, 'string');
    assert.equal(typeof scenario.description, 'string');
    assert.ok(Array.isArray(scenario.dimensions) && scenario.dimensions.length > 0);
    assert.equal(typeof scenario.score.weighted, 'number');
    assert.ok(!scenarioIds.has(scenario.id), `duplicate public benchmark scenario id ${scenario.id}`);
    scenarioIds.add(scenario.id);
    if (scenario.passed) {
      assert.equal(scenario.failure, null, `${scenario.id} should not expose failure details when passed`);
    }
  }

  for (const group of committedReport.parity.groups) {
    assert.ok(Array.isArray(group.scenarioIds) && group.scenarioIds.length > 0, `parity group ${group.groupId} must include scenario ids`);
    for (const scenarioId of group.scenarioIds) {
      assert.ok(scenarioIds.has(scenarioId), `parity group ${group.groupId} references missing scenario ${scenarioId}`);
    }
  }
});

test.todo('public benchmark bundle avoids absolute machine-specific paths such as writtenLockPath');

test('benchmark trust failure messaging distinguishes benchmark refresh from publication history refresh', () => {
  const failures = [
    'Benchmark contract lock does not match benchmarks/locks/core.lock.json.',
    'Committed benchmark publication bundle is stale: benchmarks/latest/core-bundle.json.',
    'Committed benchmark publication history is stale: benchmarks/latest/core-history.json.',
    'Committed docs benchmark history is stale: docs/benchmarks/history.json.',
    'Committed benchmark report is stale: benchmarks/latest/core-report.json.',
  ];
  const context = {
    suite: 'core',
    reportRelativePath: 'benchmarks/latest/core-report.json',
  };

  assert.deepEqual(buildRefreshHints(failures, context), [
    'Refresh benchmark report/lock with: node scripts/run_agent_benchmarks.cjs --suite core --write-lock --out benchmarks/latest/core-report.json',
    'Refresh benchmark publication history with: npm run benchmark:history',
  ]);

  const output = formatFailureOutput(failures, context);
  assert.match(output, /Refresh benchmark report\/lock with: node scripts\/run_agent_benchmarks\.cjs --suite core --write-lock --out benchmarks\/latest\/core-report\.json/);
  assert.match(output, /Refresh benchmark publication history with: npm run benchmark:history/);
});

test('contract lock comparison ignores nested object key order', () => {
  const actual = {
    suite: 'core',
    commandDescriptorVersion: '1.0.0',
    generatedManifestVersion: '1.0.0',
    generatedManifestCommandDescriptorVersion: '1.0.0',
    generatedManifestPackageVersion: '1.1.70',
    documentationContentHash: 'doc-hash',
    documentationRegistryHash: 'doc-reg-hash',
    schemaHash: 'schema-hash',
    capabilitiesLocalHash: 'cap-local',
    capabilitiesRemoteTemplateHash: 'cap-remote',
    registryDigest: {
      descriptorHash: 'a',
      commandDigestHash: 'b',
      canonicalHash: 'c',
    },
    generatedManifestRegistryDigest: {
      descriptorHash: 'a',
      commandDigestHash: 'b',
      canonicalHash: 'c',
    },
    generatedArtifactHashes: {
      generatedManifest: 'm',
      generatedContractRegistry: 'r',
      tsManifest: 'tm',
      pyManifest: 'pm',
    },
  };
  const expected = {
    schemaVersion: '1.0.0',
    suite: 'core',
    contractLock: {
      commandDescriptorVersion: '1.0.0',
      generatedManifestVersion: '1.0.0',
      generatedManifestCommandDescriptorVersion: '1.0.0',
      generatedManifestPackageVersion: '1.1.70',
      documentationContentHash: 'doc-hash',
      documentationRegistryHash: 'doc-reg-hash',
      schemaHash: 'schema-hash',
      capabilitiesLocalHash: 'cap-local',
      capabilitiesRemoteTemplateHash: 'cap-remote',
      registryDigest: {
        canonicalHash: 'c',
        commandDigestHash: 'b',
        descriptorHash: 'a',
      },
      generatedManifestRegistryDigest: {
        canonicalHash: 'c',
        commandDigestHash: 'b',
        descriptorHash: 'a',
      },
      generatedArtifactHashes: {
        pyManifest: 'pm',
        tsManifest: 'tm',
        generatedContractRegistry: 'r',
        generatedManifest: 'm',
      },
    },
  };

  const result = compareContractLock(actual, expected);
  assert.equal(result.matches, true);
  assert.deepEqual(result.mismatches, []);
});

test('benchmark capabilities assertion enforces canonical bootstrap defaults and hides aliases at top level', () => {
  const assertion = getAssertion('capabilities-bootstrap');
  const envelope = loadJsonCommand(['--output', 'json', 'capabilities']);

  assert.doesNotThrow(() => assertion({ envelope }));

  const recommendedFirstCallRegression = JSON.parse(JSON.stringify(envelope));
  recommendedFirstCallRegression.data.recommendedFirstCall = 'capabilities';
  assert.throws(
    () => assertion({ envelope: recommendedFirstCallRegression }),
    /recommendedFirstCall=bootstrap/,
  );

  const aliasLeakRegression = JSON.parse(JSON.stringify(envelope));
  aliasLeakRegression.data.canonicalTools.arbitrage = {
    preferredCommand: 'arbitrage',
    commands: ['arbitrage'],
  };
  assert.throws(
    () => assertion({ envelope: aliasLeakRegression }),
    /top-level canonicalTools map by default/,
  );
});

test('benchmark schema assertion enforces canonical-preferred descriptors and explicit alias opt-in metadata', () => {
  const assertion = getAssertion('schema-bootstrap');
  const envelope = loadJsonCommand(['--output', 'json', 'schema']);

  assert.doesNotThrow(() => assertion({ envelope }));

  const missingCompatibilityOptIn = JSON.parse(JSON.stringify(envelope));
  delete missingCompatibilityOptIn.data.definitions.BootstrapPreferences.properties.includeCompatibility;
  assert.throws(
    () => assertion({ envelope: missingCompatibilityOptIn }),
    /canonicalOnlyDefault\/includeCompatibility\/aliasesHiddenByDefault\/recommendedFirstCall/,
  );

  const aliasDescriptorRegression = JSON.parse(JSON.stringify(envelope));
  aliasDescriptorRegression.data.descriptorScope = 'command-surface';
  aliasDescriptorRegression.data.commandDescriptors.arbitrage = {
    aliasOf: 'arb.scan',
    canonicalTool: 'arb.scan',
    preferred: false,
  };
  assert.throws(
    () => assertion({ envelope: aliasDescriptorRegression }),
    /canonical-command-surface descriptorScope|stay out of the default canonical schema surface/,
  );
});

test('benchmark tools-list assertion keeps compatibility aliases opt-in only', () => {
  const assertion = getAssertion('tools-list-bootstrap');
  const registry = createMcpToolRegistry();
  const envelope = {
    ok: true,
    command: 'mcp.tools.list',
    data: {
      tools: registry.listTools(),
    },
  };

  assert.doesNotThrow(() => assertion({ envelope }));

  const aliasLeakEnvelope = JSON.parse(JSON.stringify(envelope));
  const aliasDescriptor = registry.describeTool('arbitrage');
  assert.ok(aliasDescriptor);
  aliasLeakEnvelope.data.tools.push(aliasDescriptor);
  assert.throws(
    () => assertion({ envelope: aliasLeakEnvelope }),
    /compatibility aliases to stay hidden from default MCP tool discovery|list only canonical\/preferred tools/,
  );
});
