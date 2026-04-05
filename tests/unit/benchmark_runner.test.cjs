const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  loadScenarioSuite,
  loadSuiteLock,
  defaultSuiteLockPath,
  getSuiteExpectation,
  validateScenarioManifest,
  compareContractLock,
  createPublishedBenchmarkReport,
  normalizeBenchmarkReportForFreshness,
  runBenchmarkSuite,
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

test('surface-core aliases to the current release-proof transport surface', () => {
  const coreScenarios = loadScenarioSuite('core');
  const surfaceScenarios = loadScenarioSuite('surface-core');
  const coreLock = loadSuiteLock('core');
  const surfaceLock = loadSuiteLock('surface-core');
  const coreExpectation = getSuiteExpectation('core');
  const surfaceExpectation = getSuiteExpectation('surface-core');

  assert.equal(surfaceScenarios.length, coreScenarios.length);
  assert.deepEqual(surfaceScenarios.map((scenario) => scenario.id), coreScenarios.map((scenario) => scenario.id));
  assert.deepEqual(surfaceLock, coreLock);
  assert.deepEqual(surfaceExpectation, coreExpectation);
  assert.equal(defaultSuiteLockPath('surface-core'), defaultSuiteLockPath('core'));
});

test('benchmark suite produces a stable runtime report for the release-proof surface lane', async () => {
  const report = await runBenchmarkSuite({ suite: 'core' });
  const expectation = getSuiteExpectation('core');
  assert.equal(report.summary.failedCount, 0);
  assert.equal(report.summary.passedCount, report.summary.scenarioCount);
  assert.ok(
    report.summary.weightedScore >= expectation.minimumWeightedScore,
    `expected weightedScore >= ${expectation.minimumWeightedScore}, received ${report.summary.weightedScore}`,
  );
  assert.equal(report.suite, 'core');
  assert.equal(report.requestedSuite, 'core');
  assert.ok(report.scenarios.some((scenario) => scenario.id === 'mcp-http-scope-denial'));
  assert.ok(report.scenarios.some((scenario) => scenario.id === 'mcp-http-schema-bootstrap'));
  assert.ok(report.scenarios.some((scenario) => scenario.id === 'mcp-http-operations-get-seeded'));
  assert.ok(report.scenarios.every((scenario) => scenario.score && typeof scenario.score.weighted === 'number'));
  assert.ok(report.parity);
  assert.deepEqual(report.parity.failedGroups, []);
});

test('published benchmark reports strip raw lane metadata from the public artifact', () => {
  const report = {
    schemaVersion: '1.0.0',
    suite: 'core',
    requestedSuite: 'surface-core',
    runtime: { packageVersion: '1.1.71' },
    summary: {
      scenarioCount: 1,
      passedCount: 1,
      failedCount: 0,
      latencyPassRate: 1,
      failedParityGroupCount: 0,
      overallPass: true,
      weightedScore: 100,
    },
    contractLock: {},
    expectedContractLockPath: 'benchmarks/locks/core.lock.json',
    contractLockMatchesExpected: true,
    contractLockMismatches: [],
    parity: { groups: [], failedGroups: [] },
    scenarios: [{
      id: 'scenario',
      title: 'Scenario',
      description: 'desc',
      transport: 'cli-json',
      dimensions: ['bootstrap'],
      weight: 1,
      passed: true,
      score: { weighted: 100, latencyPass: true },
      failure: null,
      checks: [],
    }],
  };

  const published = createPublishedBenchmarkReport(report);
  assert.equal('requestedSuite' in published, false);
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



test('published benchmark report strips passing check messages but keeps failing ones', () => {
  const report = {
    schemaVersion: "1.0.0",
    suite: "core",
    runtime: { packageVersion: "1.1.71" },
    summary: { scenarioCount: 1, passedCount: 1, failedCount: 0, latencyPassRate: 1, failedParityGroupCount: 0 },
    contractLock: {},
    expectedContractLockPath: "benchmarks/locks/core.lock.json",
    contractLockMatchesExpected: true,
    contractLockMismatches: [],
    parity: { groups: [], failedGroups: [] },
    scenarios: [{
      id: "s", title: "Scenario", description: "desc", transport: "cli-json", dimensions: [], weight: 1, passed: true, runtimeState: null, parityGroup: null, parityExpectedTransports: [], parityHash: null, score: { weighted: 100 }, failure: null,
      checks: [
        { id: "pass-check", passed: true, message: "machine specific /tmp/foo" },
        { id: "fail-check", passed: false, message: "actual failure detail" },
      ]
    }]
  };
  const published = createPublishedBenchmarkReport(report);
  assert.equal(published.scenarios[0].checks[0].message, null);
  assert.equal(published.scenarios[0].checks[1].message, "actual failure detail");
});

test('published benchmark report normalizes suite publication paths to forward slashes', () => {
  const report = {
    schemaVersion: '1.0.0',
    suite: 'core',
    runtime: { packageVersion: '1.1.74' },
    summary: {
      scenarioCount: 1,
      passedCount: 1,
      failedCount: 0,
      latencyPassRate: 1,
      failedParityGroupCount: 0,
      overallPass: true,
    },
    contractLock: {},
    expectedContractLockPath: 'benchmarks\\locks\\core.lock.json',
    contractLockMatchesExpected: true,
    contractLockMismatches: [],
    parity: { groups: [], failedGroups: [] },
    scenarios: [{
      id: 's',
      title: 'Scenario',
      description: 'desc',
      transport: 'cli-json',
      dimensions: ['bootstrap'],
      weight: 1,
      passed: true,
      runtimeState: null,
      parityGroup: null,
      parityExpectedTransports: [],
      parityHash: null,
      score: { weighted: 100 },
      failure: null,
      checks: [],
    }],
  };
  const published = createPublishedBenchmarkReport(report);
  assert.equal(published.expectedContractLockPath, 'benchmarks/locks/core.lock.json');
  assert.equal(published.publication.reportPath, 'benchmarks/latest/core-report.json');
  assert.equal(published.publication.suiteLockPath, 'benchmarks/locks/core.lock.json');
});

test('published benchmark report preserves evidence overallPass instead of recomputing it', () => {
  const report = {
    schemaVersion: '1.0.0',
    suite: 'core',
    runtime: { packageVersion: '1.1.128' },
    summary: {
      scenarioCount: 1,
      passedCount: 1,
      failedCount: 0,
      latencyPassRate: 1,
      failedParityGroupCount: 0,
      weightedScore: 100,
      overallPass: false,
    },
    contractLock: {},
    expectedContractLockPath: 'benchmarks/locks/core.lock.json',
    contractLockMatchesExpected: true,
    contractLockMismatches: [],
    parity: { groups: [], failedGroups: [] },
    scenarios: [{
      id: 's',
      title: 'Scenario',
      description: 'desc',
      transport: 'cli-json',
      dimensions: ['bootstrap'],
      weight: 1,
      passed: true,
      score: { weighted: 100, latencyPass: true },
      failure: null,
      checks: [],
    }],
  };

  const published = createPublishedBenchmarkReport(report);
  assert.equal(published.summary.overallPass, false);
  assert.equal(published.publication.releaseGatePass, false);
  assert.equal(published.publication.contractLockStatus, 'locked');
});

test('public benchmark bundle avoids absolute machine-specific paths such as writtenLockPath', (t) => {
  const rootDir = path.resolve(__dirname, '..', '..');
  const tempDir = fs.mkdtempSync(path.join(rootDir, '.tmp-benchmark-run-'));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const output = execFileSync(
    process.execPath,
    [
      'scripts/run_agent_benchmarks.cjs',
      '--suite',
      'core',
      '--write-lock',
      '--out',
      path.relative(rootDir, path.join(tempDir, 'core-report.json')),
      '--lock-path',
      path.relative(rootDir, path.join(tempDir, 'core.lock.json')),
    ],
    {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const report = JSON.parse(output);
  assert.equal(path.isAbsolute(report.writtenLockPath), false);
  assert.equal(path.isAbsolute(report.expectedContractLockPath), false);
  assert.match(report.writtenLockPath, /\.tmp-benchmark-run-/);
  assert.match(report.expectedContractLockPath, /\.tmp-benchmark-run-/);
});

test('run_agent_benchmarks writes the published deterministic report to disk', (t) => {
  const rootDir = path.resolve(__dirname, '..', '..');
  const tempDir = fs.mkdtempSync(path.join(rootDir, '.tmp-benchmark-published-'));
  const outPath = path.join(tempDir, 'core-report.json');
  const lockPath = path.join(tempDir, 'core.lock.json');
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const output = execFileSync(
    process.execPath,
    [
      'scripts/run_agent_benchmarks.cjs',
      '--suite',
      'core',
      '--write-lock',
      '--out',
      path.relative(rootDir, outPath),
      '--lock-path',
      path.relative(rootDir, lockPath),
    ],
    {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const stdoutReport = JSON.parse(output);
  const writtenReport = JSON.parse(fs.readFileSync(outPath, 'utf8'));

  assert.ok(typeof stdoutReport.generatedAt === 'string' && stdoutReport.generatedAt.length > 0);
  assert.ok(Array.isArray(stdoutReport.scenarios) && stdoutReport.scenarios.length > 0);
  assert.equal(typeof stdoutReport.scenarios[0].durationMs, 'number');
  assert.deepEqual(writtenReport, normalizeBenchmarkReportForFreshness(stdoutReport));
  assert.equal('generatedAt' in writtenReport, false);
  assert.equal('durationMs' in writtenReport.scenarios[0], false);
  assert.equal('runtimeState' in writtenReport.scenarios[0], false);
  assert.equal('parityHash' in writtenReport.scenarios[0], false);
  assert.equal('writtenLockPath' in writtenReport, false);
});

test('publication artifacts preserve evidence overallPass through bundle and history', (t) => {
  const rootDir = path.resolve(__dirname, '..', '..');
  const tempDir = fs.mkdtempSync(path.join(rootDir, '.tmp-benchmark-publication-evidence-'));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const packagePath = path.join(tempDir, 'package.json');
  const reportPath = path.join(tempDir, 'core-report.json');
  const lockPath = path.join(tempDir, 'core.lock.json');
  const bundlePath = path.join(tempDir, 'core-bundle.json');
  const historyPath = path.join(tempDir, 'core-history.json');
  const docsHistoryPath = path.join(tempDir, 'docs-history.json');
  const generatedAt = '2026-03-09T16:19:46.514Z';

  fs.writeFileSync(packagePath, `${JSON.stringify({
    name: 'pandora-cli-skills',
    version: '9.9.10',
  }, null, 2)}\n`);

  const report = {
    schemaVersion: '1.0.0',
    suite: 'core',
    generatedAt,
    runtime: { packageVersion: '9.9.10' },
    summary: {
      scenarioCount: 1,
      passedCount: 1,
      failedCount: 0,
      latencyPassRate: 1,
      failedParityGroupCount: 0,
      weightedScore: 100,
      overallPass: false,
    },
    dimensions: {},
    contractLock: {},
    expectedContractLockPath: 'benchmarks/locks/core.lock.json',
    contractLockMatchesExpected: true,
    contractLockMismatches: [],
    parity: { groups: [], failedGroups: [] },
    scenarios: [{
      id: 'scenario',
      title: 'Scenario',
      description: 'desc',
      transport: 'cli-json',
      dimensions: ['bootstrap'],
      weight: 1,
      passed: true,
      durationMs: 1,
      score: { weighted: 100, latencyPass: true },
      failure: null,
      checks: [],
    }],
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(lockPath, `${JSON.stringify({
    schemaVersion: '1.0.0',
    suite: 'core',
    publication: {
      contractLockHash: 'lock-hash',
      lockDocumentHash: 'doc-hash',
    },
    contractLock: {},
  }, null, 2)}\n`);

  const artifacts = buildPublicationArtifacts({
    packagePath,
    reportPath,
    lockPath,
    bundlePath,
    historyPath,
    docsHistoryPath,
  });

  assert.equal(artifacts.bundle.latest.summary.overallPass, false);
  assert.equal(artifacts.history.entries[0].overallPass, false);
});

test('benchmark publication artifacts reuse the current version generatedAt when report output is deterministic', (t) => {
  const rootDir = path.resolve(__dirname, '..', '..');
  const tempDir = fs.mkdtempSync(path.join(rootDir, '.tmp-benchmark-history-'));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const packagePath = path.join(tempDir, 'package.json');
  const reportPath = path.join(tempDir, 'core-report.json');
  const lockPath = path.join(tempDir, 'core.lock.json');
  const bundlePath = path.join(tempDir, 'core-bundle.json');
  const historyPath = path.join(tempDir, 'core-history.json');
  const docsHistoryPath = path.join(tempDir, 'docs-history.json');
  const generatedAt = '2026-03-09T16:19:46.514Z';

  fs.writeFileSync(packagePath, `${JSON.stringify({
    name: 'pandora-cli-skills',
    version: '9.9.9',
  }, null, 2)}\n`);

  fs.writeFileSync(reportPath, `${JSON.stringify(createPublishedBenchmarkReport({
    schemaVersion: '1.0.0',
    suite: 'core',
    runtime: { packageVersion: '9.9.9' },
    summary: {
      scenarioCount: 1,
      passedCount: 1,
      failedCount: 0,
      latencyPassRate: 1,
      failedParityGroupCount: 0,
      overallPass: true,
      weightedScore: 100,
    },
    contractLock: {},
    expectedContractLockPath: 'benchmarks/locks/core.lock.json',
    contractLockMatchesExpected: true,
    contractLockMismatches: [],
    parity: { groups: [], failedGroups: [] },
    scenarios: [{
      id: 'scenario',
      title: 'Scenario',
      description: 'desc',
      transport: 'cli-json',
      dimensions: ['bootstrap'],
      weight: 1,
      passed: true,
      score: { weighted: 100, latencyPass: true },
      failure: null,
      checks: [],
    }],
  }), null, 2)}\n`);

  fs.writeFileSync(lockPath, `${JSON.stringify({
    schemaVersion: '1.0.0',
    suite: 'core',
    publication: {
      contractLockHash: 'lock-hash',
      lockDocumentHash: 'doc-hash',
    },
    contractLock: {},
  }, null, 2)}\n`);

  fs.writeFileSync(historyPath, `${JSON.stringify({
    schemaVersion: '1.0.0',
    suite: 'core',
    generatedAt,
    latestVersion: '9.9.9',
    latestGeneratedAt: generatedAt,
    entries: [{
      schemaVersion: '1.0.0',
      suite: 'core',
      packageName: 'pandora-cli-skills',
      version: '9.9.9',
      packageVersion: '9.9.9',
      generatedAt,
      summary: {
        weightedScore: 100,
        overallPass: true,
        scenarioCount: 1,
        passedCount: 1,
        failedCount: 0,
        failedParityGroupCount: 0,
      },
      weightedScore: 100,
      overallPass: true,
      scenarioCount: 1,
      passedCount: 1,
      failedCount: 0,
      failedParityGroupCount: 0,
      contractLockMatchesExpected: true,
      parityFailedGroups: [],
      descriptorHash: null,
      documentationContentHash: null,
      reportSha256: 'old-report-sha',
      lockSha256: 'old-lock-sha',
      lockSchemaVersion: '1.0.0',
    }],
  }, null, 2)}\n`);

  const artifacts = buildPublicationArtifacts({
    packagePath,
    reportPath,
    lockPath,
    bundlePath,
    historyPath,
    docsHistoryPath,
  });

  assert.equal(artifacts.bundle.generatedAt, generatedAt);
  assert.equal(artifacts.history.generatedAt, generatedAt);
  assert.equal(artifacts.history.latestGeneratedAt, generatedAt);
  assert.equal(artifacts.history.entries[0].generatedAt, generatedAt);
});

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
