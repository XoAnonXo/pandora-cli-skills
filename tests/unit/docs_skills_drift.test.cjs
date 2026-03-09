const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { runCli, REPO_ROOT } = require('../helpers/cli_runner.cjs');
const { buildSkillDocIndex } = require('../../cli/lib/skill_doc_registry.cjs');

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function assertMentionsAll(text, values, messagePrefix) {
  for (const value of values) {
    assert.match(
      text,
      new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `${messagePrefix}: missing ${value}`,
    );
  }
}

test('runtime capabilities and schema stay aligned with shipped skill docs', () => {
  const capabilitiesResult = runCli(['--output', 'json', 'capabilities']);
  assert.equal(capabilitiesResult.status, 0, capabilitiesResult.output);
  const capabilities = JSON.parse(capabilitiesResult.stdout);

  const schemaResult = runCli(['--output', 'json', 'schema']);
  assert.equal(schemaResult.status, 0, schemaResult.output);
  const schema = JSON.parse(schemaResult.stdout);

  const docIndex = buildSkillDocIndex();
  const files = [
    'README.md',
    'README_FOR_SHARING.md',
  ].concat(docIndex.sourceFiles);
  const mergedText = files.map(read).join('\n');
  const quickstartText = read('docs/skills/agent-quickstart.md');
  const policyProfilesText = read('docs/skills/policy-profiles.md');
  const mirrorOperationsText = read('docs/skills/mirror-operations.md');
  const commandReferenceText = read('docs/skills/command-reference.md');
  const agentInterfacesText = read('docs/skills/agent-interfaces.md');
  const portfolioCloseoutText = read('docs/skills/portfolio-closeout.md');
  const supportMatrixText = read('docs/trust/support-matrix.md');
  const benchmarkOverviewText = read('docs/benchmarks/README.md');
  const benchmarkScenarioCatalogText = read('docs/benchmarks/scenario-catalog.md');
  const mirrorHelp = JSON.parse(runCli(['--output', 'json', 'mirror', '--help']).stdout);
  const mirrorSyncHelp = JSON.parse(runCli(['--output', 'json', 'mirror', 'sync', '--help']).stdout);
  const mirrorStatusHelp = JSON.parse(runCli(['--output', 'json', 'mirror', 'status', '--help']).stdout);

  assert.equal(capabilities.ok, true);
  assert.equal(capabilities.command, 'capabilities');
  assert.equal(schema.ok, true);
  assert.equal(schema.command, 'schema');
  assert.equal(mirrorHelp.ok, true);
  assert.equal(mirrorHelp.command, 'mirror.help');
  assert.equal(mirrorSyncHelp.ok, true);
  assert.equal(mirrorSyncHelp.command, 'mirror.sync.help');
  assert.equal(mirrorStatusHelp.ok, true);
  assert.equal(mirrorStatusHelp.command, 'mirror.status.help');

  assert.equal(capabilities.data.transports.sdk.supported, true);
  assert.equal(capabilities.data.policyProfiles.policyPacks.supported, true);
  assert.equal(capabilities.data.policyProfiles.signerProfiles.supported, true);

  assert.equal(capabilities.data.documentation.router.path, 'SKILL.md');
  assert.equal(typeof capabilities.data.documentation.contentHash, 'string');
  assert.ok(capabilities.data.documentation.router.startHere.some((route) => route.docId === 'agent-quickstart'));
  assert.ok(capabilities.data.documentation.router.startHere.some((route) => route.docId === 'benchmark-overview'));
  assert.ok(capabilities.data.documentation.router.taskRoutes.some((route) => route.label === 'Mirror deployment, verification, sync, or closeout'));
  assert.ok(capabilities.data.documentation.router.taskRoutes.some((route) => route.label === 'Benchmark methodology, scenarios, or scorecards'));
  assert.ok(capabilities.data.documentation.router.taskRoutes.some((route) => route.label === 'Benchmark scenario catalog and parity coverage'));
  assert.ok(capabilities.data.documentation.router.taskRoutes.some((route) => route.label === 'Benchmark weighted scoring and score interpretation'));
  assert.ok(capabilities.data.documentation.router.taskRoutes.some((route) => route.label === 'Release verification, support matrix, or security posture'));
  assert.ok(capabilities.data.documentation.skills.some((doc) => doc.path === 'docs/skills/agent-quickstart.md'));
  assert.ok(capabilities.data.documentation.skills.some((doc) => doc.path === 'docs/skills/policy-profiles.md'));
  assert.ok(capabilities.data.documentation.skills.some((doc) => doc.path === 'docs/skills/mirror-operations.md'));
  assert.ok(capabilities.data.documentation.skills.some((doc) => doc.path === 'docs/benchmarks/README.md'));
  assert.ok(capabilities.data.documentation.skills.some((doc) => doc.path === 'docs/benchmarks/scenario-catalog.md'));
  assert.ok(capabilities.data.documentation.skills.some((doc) => doc.path === 'docs/benchmarks/scorecard.md'));
  assert.ok(capabilities.data.documentation.skills.some((doc) => doc.path === 'docs/trust/release-verification.md'));
  assert.ok(capabilities.data.documentation.skills.some((doc) => doc.path === 'docs/trust/security-model.md'));
  assert.ok(capabilities.data.documentation.skills.some((doc) => doc.path === 'docs/trust/support-matrix.md'));
  assert.equal(
    schema.data.definitions.CapabilitiesPayload.properties.documentation.$ref,
    '#/definitions/SkillDocIndex',
  );

  for (const file of files) {
    assert.equal(fs.existsSync(path.join(REPO_ROOT, file)), true, `missing documented file ${file}`);
  }

  assert.match(mergedText, /pandora --output json bootstrap/);
  assert.match(mergedText, /pandora --output json capabilities/);
  assert.match(mergedText, /pandora --output json schema/);
  assert.match(mergedText, /pandora mcp http/);
  assert.match(mergedText, /policy list/);
  assert.match(mergedText, /profile list/);
  assert.match(mergedText, /recipe list/);
  assert.match(mergedText, /npm run generate:sdk-contracts/);
  assertMentionsAll(read('README.md'), [
    'docs/benchmarks/README.md',
    'docs/benchmarks/scenario-catalog.md',
    'docs/benchmarks/scorecard.md',
  ], 'README benchmark doc links');
  assertMentionsAll(read('SKILL.md'), [
    'docs/benchmarks/README.md',
    'docs/benchmarks/scenario-catalog.md',
    'docs/benchmarks/scorecard.md',
  ], 'SKILL benchmark doc links');
  assert.match(benchmarkOverviewText, /documentation\.router\.taskRoutes/i);
  assert.match(benchmarkOverviewText, /Benchmark methodology, scenarios, or scorecards/);
  assert.match(benchmarkOverviewText, /Benchmark scenario catalog and parity coverage/);
  assert.match(benchmarkOverviewText, /Benchmark weighted scoring and score interpretation/);
  assert.match(benchmarkOverviewText, /docs\/trust\/support-matrix\.md/);
  assert.match(benchmarkScenarioCatalogText, /Benchmark scenario catalog and parity coverage/);
  assert.match(benchmarkScenarioCatalogText, /scorecard\.md/);
  assert.match(mergedText, /release-verification\.md/);
  assert.match(mergedText, /security-model\.md/);
  assert.match(mergedText, /support-matrix\.md/);
  assert.match(commandReferenceText, /--polymarket-rpc-url <url>/);
  assert.match(commandReferenceText, /--profile-id <id>\|--profile-file <path>/);
  assert.match(commandReferenceText, /--min-time-to-close-sec <n>/);
  assert.match(commandReferenceText, /--strict-close-time-delta/);
  assert.match(commandReferenceText, /reserveSource/);
  assert.match(commandReferenceText, /metadata\.pidAlive/);
  assert.match(commandReferenceText, /mirror status --with-live/);
  assert.match(commandReferenceText, /mirror pnl/);
  assert.match(commandReferenceText, /mirror audit/);
  assert.match(mirrorOperationsText, /not atomic/i);
  assert.match(mirrorOperationsText, /MIRROR_EXPIRY_TOO_CLOSE/);
  assert.match(mirrorOperationsText, /POLYMARKET_SOURCE_FRESH/);
  assert.match(mirrorOperationsText, /reserveSource/);
  assert.match(mirrorOperationsText, /onchain:outcome-token-balances/);
  assert.match(mirrorOperationsText, /strict-close-time-delta/);
  assert.match(agentInterfacesText, /verifyDiagnostics/);
  assert.match(agentInterfacesText, /polymarketPosition\.diagnostics/);
  assert.match(agentInterfacesText, /logFile/);
  assert.match(agentInterfacesText, /MIRROR_EXPIRY_TOO_CLOSE/);
  assert.match(agentInterfacesText, /reserveSource/);
  assert.match(agentInterfacesText, /metadata\.pidAlive/);
  assert.match(agentInterfacesText, /strict-close-time-delta/);
  assert.match(portfolioCloseoutText, /stop-daemons/);
  assert.match(portfolioCloseoutText, /claim-winnings/);
  assert.match(portfolioCloseoutText, /lp simulate-remove/);
  assert.match(portfolioCloseoutText, /mirror pnl/);
  assert.match(portfolioCloseoutText, /mirror audit/);
  assert.equal(Array.isArray(mirrorHelp.data.notes), true);
  assert.equal(mirrorHelp.data.notes.some((note) => /not atomic/i.test(note)), true);
  assert.equal(mirrorHelp.data.notes.some((note) => /MIRROR_EXPIRY_TOO_CLOSE/.test(note)), true);
  assert.equal(mirrorHelp.data.notes.some((note) => /reserveSource/.test(note)), true);
  assert.equal(mirrorHelp.data.notes.some((note) => /strict-close-time-delta/.test(note)), true);
  assert.equal(mirrorHelp.data.notes.some((note) => /cached snapshots/.test(note)), true);
  assert.equal(mirrorHelp.data.notes.some((note) => /--polymarket-rpc-url/.test(note)), true);
  assert.equal(mirrorHelp.data.notes.some((note) => /verifyDiagnostics/.test(note)), true);
  assert.match(mirrorSyncHelp.data.usage, /--polymarket-rpc-url <url>/);
  assert.match(mirrorSyncHelp.data.usage, /--profile-id <id>\|--profile-file <path>/);
  assert.match(mirrorSyncHelp.data.usage, /--min-time-to-close-sec <n>/);
  assert.match(mirrorSyncHelp.data.usage, /--strict-close-time-delta/);
  assert.match(mirrorSyncHelp.data.liveHedgeNotes.rpcFallback, /comma-separated/i);
  assert.match(mirrorSyncHelp.data.staleCacheFallback, /cached snapshots/i);
  assert.match(mirrorStatusHelp.data.notes.gracefulFallback, /diagnostics are returned instead of hard failures/i);
  for (const scope of ['capabilities:read', 'contracts:read', 'help:read', 'schema:read', 'operations:read']) {
    assert.match(mergedText, new RegExp(scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(mergedText, /profile get --id <profile-id>|profile get --id market_observer_ro/);

  const bootstrapChecks = [
    ['bootstrap'],
    ['capabilities'],
    ['schema'],
    ['policy', 'list'],
    ['profile', 'list'],
    ['recipe', 'list'],
  ];
  for (const args of bootstrapChecks) {
    const result = runCli(['--output', 'json', ...args]);
    assert.equal(result.status, 0, result.output || `expected ${args.join(' ')} to succeed`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true, `${args.join(' ')} should return ok=true`);
  }

  const sdkPackages = capabilities.data.transports.sdk.packages;
  assert.equal(sdkPackages.typescript.publicRegistryPublished, true);
  assert.equal(sdkPackages.python.publicRegistryPublished, true);
  assert.match(quickstartText, /public npm package `@thisispandora\/agent-sdk`/i);
  assertMentionsAll(supportMatrixText, [
    sdkPackages.typescript.name,
    sdkPackages.python.name,
  ], 'support matrix sdk package names');
  assert.match(supportMatrixText, /public npm publication is available today/i);
  assert.match(supportMatrixText, /public pypi publication is now live/i);

  const readyProfiles = capabilities.data.policyProfiles.signerProfiles.readyBuiltinIds;
  const degradedProfiles = capabilities.data.policyProfiles.signerProfiles.degradedBuiltinIds;
  assertMentionsAll(policyProfilesText, readyProfiles, 'policy-profiles ready ids');
  assertMentionsAll(policyProfilesText, degradedProfiles, 'policy-profiles degraded ids');
});

test('benchmark docs and support matrix stay aligned with the shipped latest report and trust metadata', () => {
  const capabilitiesResult = runCli(['--output', 'json', 'capabilities']);
  assert.equal(capabilitiesResult.status, 0, capabilitiesResult.output);
  const capabilities = JSON.parse(capabilitiesResult.stdout);
  const trustDistribution = capabilities.data.trustDistribution;
  const benchmarkReadme = read('docs/benchmarks/README.md');
  const supportMatrix = read('docs/trust/support-matrix.md');
  const benchmarkReport = readJson('benchmarks/latest/core-report.json');

  const scenarioCountMatch = benchmarkReadme.match(/current suite currently contains\s+(\d+)\s+scenarios/i);
  assert.ok(scenarioCountMatch, 'docs/benchmarks/README.md must declare the current suite size');
  assert.equal(Number(scenarioCountMatch[1]), benchmarkReport.summary.scenarioCount);

  assert.match(benchmarkReadme, /benchmarks\/latest\/core-report\.json/);
  assert.match(benchmarkReadme, /summary\.overallPass === true/);
  assert.match(benchmarkReadme, /contractLockMatchesExpected === true/);
  assert.equal(benchmarkReport.summary.overallPass, true);
  assert.equal(benchmarkReport.contractLockMatchesExpected, true);
  assert.equal(benchmarkReport.summary.failedCount, 0);
  assert.equal(benchmarkReport.summary.failedParityGroupCount, 0);
  assert.ok(benchmarkReport.summary.weightedScore >= 95);

  assert.match(supportMatrix, /Benchmark harness \(scenario manifests, lock file, runner scripts\)/);
  assert.match(supportMatrix, /Benchmark docs and latest report/);
  assert.match(supportMatrix, /repository maintainer surface|repository\/release-maintainer surface/i);
  assert.equal(trustDistribution.distribution.signals.shipsBenchmarkDocs, true);
  assert.equal(trustDistribution.distribution.signals.shipsBenchmarkReport, true);
  assert.equal(trustDistribution.distribution.signals.shipsBenchmarkHarness, false);
  assert.equal(trustDistribution.verification.benchmark.reportPresent, true);
  assert.equal(
    trustDistribution.verification.benchmark.reportOverallPass,
    benchmarkReport.summary.overallPass,
  );
  assert.equal(
    trustDistribution.verification.benchmark.reportContractLockMatchesExpected,
    benchmarkReport.contractLockMatchesExpected,
  );
});
