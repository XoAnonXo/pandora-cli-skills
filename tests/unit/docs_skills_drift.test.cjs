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
  const supportMatrixText = read('docs/trust/support-matrix.md');
  const benchmarkOverviewText = read('docs/benchmarks/README.md');
  const benchmarkScenarioCatalogText = read('docs/benchmarks/scenario-catalog.md');

  assert.equal(capabilities.ok, true);
  assert.equal(capabilities.command, 'capabilities');
  assert.equal(schema.ok, true);
  assert.equal(schema.command, 'schema');

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
  assert.match(read('README.md'), /docs\/benchmarks\/README\.md/);
  assert.match(read('README.md'), /docs\/benchmarks\/scenario-catalog\.md/);
  assert.match(read('README.md'), /docs\/benchmarks\/scorecard\.md/);
  assert.match(read('SKILL.md'), /docs\/benchmarks\/README\.md/);
  assert.match(read('SKILL.md'), /docs\/benchmarks\/scenario-catalog\.md/);
  assert.match(read('SKILL.md'), /docs\/benchmarks\/scorecard\.md/);
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
  assert.equal(sdkPackages.typescript.publicRegistryPublished, false);
  assert.equal(sdkPackages.python.publicRegistryPublished, false);
  assert.match(quickstartText, /public npm\/PyPI publication is not claimed/i);
  assert.match(supportMatrixText, /does not yet claim public npm publication/i);
  assert.match(supportMatrixText, /does not yet claim public PyPI publication/i);

  const readyProfiles = capabilities.data.policyProfiles.signerProfiles.readyBuiltinIds;
  const degradedProfiles = capabilities.data.policyProfiles.signerProfiles.degradedBuiltinIds;
  for (const profileId of readyProfiles) {
    assert.match(policyProfilesText, new RegExp(profileId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const profileId of degradedProfiles) {
    assert.match(policyProfilesText, new RegExp(profileId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
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
