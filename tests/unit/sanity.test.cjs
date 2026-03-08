const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const pkg = require(path.resolve(__dirname, '..', '..', 'package.json'));
const ROOT = path.resolve(__dirname, '..', '..');
const { buildPublishedPackageJson } = require(path.join(ROOT, 'scripts', 'prepare_publish_manifest.cjs'));
const EXPECTED_PUBLISHED_SCRIPT_NAMES = [
  'cli',
  'init-env',
  'doctor',
  'setup',
  'dry-run',
  'execute',
  'dry-run:clone',
];

function packDryRun() {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 16,
  });
  const parsed = JSON.parse(output);
  assert.ok(Array.isArray(parsed) && parsed.length > 0, 'npm pack --dry-run --json must return an array');
  return parsed[parsed.length - 1];
}

test('package exposes pandora bin entrypoint and packed consumer surface', () => {
  assert.equal(pkg.name, 'pandora-cli-skills');
  assert.equal(pkg.bin.pandora, 'cli/pandora.cjs');
  assert.equal(pkg.exports['./sdk/typescript'], './sdk/typescript/index.js');
  assert.equal(pkg.exports['./sdk/generated'], './sdk/generated/index.js');
  assert.equal(pkg.exports['./sdk/typescript/generated'], './sdk/typescript/generated/index.js');
  assert.equal(pkg.exports['./sdk/typescript/generated/contract-registry'], './sdk/typescript/generated/contract-registry.json');
  const packed = packDryRun();
  const packedFiles = new Set((packed.files || []).map((entry) => entry.path));
  const publishedPkg = buildPublishedPackageJson(pkg);

  assert.deepEqual(
    Object.keys(publishedPkg.scripts || {}).sort(),
    [...EXPECTED_PUBLISHED_SCRIPT_NAMES].sort(),
    'published manifest should expose only the minimal published script allowlist',
  );
  assert.equal(publishedPkg.devDependencies, undefined, 'published manifest should not ship devDependencies');
  assert.equal(publishedPkg.bin?.pandora, 'cli/pandora.cjs');

  for (const required of [
    'package.json',
    'cli/pandora.cjs',
    'sdk/generated/index.js',
    'sdk/generated/contract-registry.json',
    'sdk/typescript/index.js',
    'sdk/typescript/backends.js',
    'sdk/typescript/catalog.js',
    'sdk/typescript/errors.js',
    'sdk/typescript/generated/contract-registry.json',
    'sdk/python/pandora_agent/__init__.py',
    'sdk/python/pandora_agent/generated/contract-registry.json',
    'scripts/create_market_launcher.ts',
    'scripts/create_polymarket_clone_and_bet.ts',
    'scripts/release/install_release.sh',
    'docs/skills/agent-quickstart.md',
    'docs/trust/support-matrix.md',
    'docs/benchmarks/README.md',
    'benchmarks/latest/core-report.json',
    'benchmarks/latest/core-bundle.json',
    'benchmarks/latest/core-history.json',
    'docs/benchmarks/history.json',
  ]) {
    assert.ok(packedFiles.has(required), `packed artifact missing ${required}`);
  }

  for (const forbiddenPrefix of [
    'benchmarks/lib/',
    'benchmarks/scenarios/',
    'tests/',
    'todos/',
    'docs/roadmaps/',
  ]) {
    assert.equal(
      Array.from(packedFiles).some((filePath) => filePath.startsWith(forbiddenPrefix)),
      false,
      `packed artifact should not include ${forbiddenPrefix}`,
    );
  }
});

test('doc router and scoped skills are present on disk', () => {
  const root = path.resolve(__dirname, '..', '..');
  const readmePath = path.join(root, 'README.md');
  const shareableReadmePath = path.join(root, 'README_FOR_SHARING.md');
  const skillPath = path.join(root, 'SKILL.md');
  const commandReferencePath = path.join(root, 'docs', 'skills', 'command-reference.md');
  const capabilitiesPath = path.join(root, 'docs', 'skills', 'capabilities.md');
  const agentInterfacesPath = path.join(root, 'docs', 'skills', 'agent-interfaces.md');
  const agentQuickstartPath = path.join(root, 'docs', 'skills', 'agent-quickstart.md');
  const tradingWorkflowsPath = path.join(root, 'docs', 'skills', 'trading-workflows.md');
  const portfolioCloseoutPath = path.join(root, 'docs', 'skills', 'portfolio-closeout.md');
  const policyProfilesPath = path.join(root, 'docs', 'skills', 'policy-profiles.md');
  const benchmarkOverviewPath = path.join(root, 'docs', 'benchmarks', 'README.md');
  const benchmarkScenarioCatalogPath = path.join(root, 'docs', 'benchmarks', 'scenario-catalog.md');
  const benchmarkScorecardPath = path.join(root, 'docs', 'benchmarks', 'scorecard.md');
  const benchmarkDocsHistoryPath = path.join(root, 'docs', 'benchmarks', 'history.json');
  const benchmarkLatestReportPath = path.join(root, 'benchmarks', 'latest', 'core-report.json');
  const benchmarkLatestBundlePath = path.join(root, 'benchmarks', 'latest', 'core-bundle.json');
  const benchmarkLatestHistoryPath = path.join(root, 'benchmarks', 'latest', 'core-history.json');
  const releaseVerificationPath = path.join(root, 'docs', 'trust', 'release-verification.md');
  const securityModelPath = path.join(root, 'docs', 'trust', 'security-model.md');
  const supportMatrixPath = path.join(root, 'docs', 'trust', 'support-matrix.md');

  assert.equal(fs.existsSync(readmePath), true);
  assert.equal(fs.existsSync(shareableReadmePath), true);
  assert.equal(fs.existsSync(skillPath), true);
  assert.equal(fs.existsSync(commandReferencePath), true);
  assert.equal(fs.existsSync(capabilitiesPath), true);
  assert.equal(fs.existsSync(agentInterfacesPath), true);
  assert.equal(fs.existsSync(agentQuickstartPath), true);
  assert.equal(fs.existsSync(tradingWorkflowsPath), true);
  assert.equal(fs.existsSync(portfolioCloseoutPath), true);
  assert.equal(fs.existsSync(policyProfilesPath), true);
  assert.equal(fs.existsSync(benchmarkOverviewPath), true);
  assert.equal(fs.existsSync(benchmarkScenarioCatalogPath), true);
  assert.equal(fs.existsSync(benchmarkScorecardPath), true);
  assert.equal(fs.existsSync(benchmarkDocsHistoryPath), true);
  assert.equal(fs.existsSync(benchmarkLatestReportPath), true);
  assert.equal(fs.existsSync(benchmarkLatestBundlePath), true);
  assert.equal(fs.existsSync(benchmarkLatestHistoryPath), true);
  assert.equal(fs.existsSync(releaseVerificationPath), true);
  assert.equal(fs.existsSync(securityModelPath), true);
  assert.equal(fs.existsSync(supportMatrixPath), true);

  const readmeText = fs.readFileSync(readmePath, 'utf8');
  const shareableReadmeText = fs.readFileSync(shareableReadmePath, 'utf8');
  const skillText = fs.readFileSync(skillPath, 'utf8');
  const commandReferenceText = fs.readFileSync(commandReferencePath, 'utf8');
  const capabilitiesText = fs.readFileSync(capabilitiesPath, 'utf8');
  const agentInterfacesText = fs.readFileSync(agentInterfacesPath, 'utf8');
  const agentQuickstartText = fs.readFileSync(agentQuickstartPath, 'utf8');
  const tradingWorkflowsText = fs.readFileSync(tradingWorkflowsPath, 'utf8');
  const portfolioCloseoutText = fs.readFileSync(portfolioCloseoutPath, 'utf8');
  const policyProfilesText = fs.readFileSync(policyProfilesPath, 'utf8');
  const benchmarkOverviewText = fs.readFileSync(benchmarkOverviewPath, 'utf8');
  const benchmarkScenarioCatalogText = fs.readFileSync(benchmarkScenarioCatalogPath, 'utf8');
  const benchmarkScorecardText = fs.readFileSync(benchmarkScorecardPath, 'utf8');
  const benchmarkDocsHistory = JSON.parse(fs.readFileSync(benchmarkDocsHistoryPath, 'utf8'));
  const benchmarkLatestReport = JSON.parse(fs.readFileSync(benchmarkLatestReportPath, 'utf8'));
  const benchmarkLatestBundle = JSON.parse(fs.readFileSync(benchmarkLatestBundlePath, 'utf8'));
  const benchmarkLatestHistory = JSON.parse(fs.readFileSync(benchmarkLatestHistoryPath, 'utf8'));
  const releaseVerificationText = fs.readFileSync(releaseVerificationPath, 'utf8');
  const securityModelText = fs.readFileSync(securityModelPath, 'utf8');
  const supportMatrixText = fs.readFileSync(supportMatrixPath, 'utf8');
  assert.match(readmeText, /Standalone SDKs? And Contract Export/);
  assert.match(readmeText, /transports\.sdk/);
  assert.match(readmeText, /registryDigest\.descriptorHash/);
  assert.match(shareableReadmeText, /Standalone SDKs? And Contract Export/);
  assert.match(shareableReadmeText, /standalone SDK artifacts are built and verified in release flow/i);
  assert.match(skillText, /pandora --output json capabilities/);
  assert.match(skillText, /SDK alpha source\/artifact surfaces/i);
  assert.match(skillText, /docs\/skills\/command-reference\.md/);
  assert.match(skillText, /docs\/skills\/agent-quickstart\.md/);
  assert.match(skillText, /docs\/skills\/trading-workflows\.md/);
  assert.match(skillText, /docs\/skills\/portfolio-closeout\.md/);
  assert.match(skillText, /docs\/skills\/policy-profiles\.md/);
  assert.match(skillText, /pandora mcp/);
  assert.match(commandReferenceText, /High-value command routing reference/);
  assert.match(commandReferenceText, /pandora --output json schema/);
  assert.match(commandReferenceText, /compact digest, not the full contract surface/i);
  assert.match(commandReferenceText, /pandora mcp/);
  assert.match(commandReferenceText, /sports create run/);
  assert.match(commandReferenceText, /agentPreflight/);
  assert.match(commandReferenceText, /--category/);
  assert.match(commandReferenceText, /--polymarket-rpc-url/);
  assert.match(capabilitiesText, /Small-doc routing/);
  assert.match(capabilitiesText, /Agent-native integration/);
  assert.match(capabilitiesText, /Contract export for SDK generators/);
  assert.match(capabilitiesText, /commandDescriptorVersion/);
  assert.match(capabilitiesText, /capabilities/);
  assert.match(agentInterfacesText, /SDK generation and contract export/);
  assert.match(agentInterfacesText, /npm run generate:sdk-contracts/);
  assert.match(agentInterfacesText, /odds\.record/);
  assert.match(agentInterfacesText, /sports sync run\|start/);
  assert.match(agentQuickstartText, /Preferred bootstrap order/);
  assert.match(agentQuickstartText, /pandora mcp http/);
  assert.match(tradingWorkflowsText, /trade --output json --dry-run/);
  assert.match(tradingWorkflowsText, /sell --output json --dry-run/);
  assert.match(portfolioCloseoutText, /operations list/);
  assert.match(portfolioCloseoutText, /mirror close/);
  assert.match(policyProfilesText, /policy list/);
  assert.match(policyProfilesText, /profile list/);
  assert.match(benchmarkOverviewText, /latest benchmark report/i);
  assert.match(benchmarkOverviewText, /core-bundle\.json/);
  assert.match(benchmarkOverviewText, /core-history\.json/);
  assert.match(benchmarkOverviewText, /history\.json/);
  assert.match(benchmarkOverviewText, /contractLockMatchesExpected === true/);
  assert.match(benchmarkOverviewText, /Benchmark methodology, scenarios, or scorecards/);
  assert.match(benchmarkOverviewText, /Benchmark scenario catalog and parity coverage/);
  assert.match(benchmarkOverviewText, /Benchmark weighted scoring and score interpretation/);
  assert.match(benchmarkScenarioCatalogText, /cli-capabilities-bootstrap/);
  assert.match(benchmarkScenarioCatalogText, /Benchmark scenario catalog and parity coverage/);
  assert.match(benchmarkScenarioCatalogText, /scorecard\.md/);
  assert.match(benchmarkScorecardText, /weightedScore/i);
  assert.equal(Array.isArray(benchmarkDocsHistory.entries), true);
  assert.equal(benchmarkLatestBundle.latest.summary.overallPass, true);
  assert.equal(Array.isArray(benchmarkLatestHistory.entries), true);
  assert.equal(benchmarkLatestReport.summary.overallPass, true);
  assert.equal(benchmarkLatestReport.contractLockMatchesExpected, true);
  assert.match(releaseVerificationText, /gh attestation verify/);
  assert.match(releaseVerificationText, /sbom\.spdx\.json/);
  assert.match(securityModelText, /Remote gateway auth model/);
  assert.match(supportMatrixText, /Trust docs/);
});
