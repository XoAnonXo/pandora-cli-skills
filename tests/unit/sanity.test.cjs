const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const pkg = require(path.resolve(__dirname, '..', '..', 'package.json'));
const ROOT = path.resolve(__dirname, '..', '..');
const { buildPublishedPackageJson } = require(path.join(ROOT, 'scripts', 'prepare_publish_manifest.cjs'));
const { buildSkillDocIndex } = require(path.join(ROOT, 'cli', 'lib', 'skill_doc_registry.cjs'));
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
  const command = process.platform === 'win32'
    ? { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', 'npm', 'pack', '--dry-run', '--json', '--ignore-scripts'] }
    : { file: 'npm', args: ['pack', '--dry-run', '--json', '--ignore-scripts'] };
  const output = execFileSync(command.file, command.args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 16,
  });
  const trimmed = String(output || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    assert.ok(start >= 0 && end >= start, 'npm pack --dry-run --json must emit a JSON array payload');
    parsed = JSON.parse(trimmed.slice(start, end + 1));
  }
  assert.ok(Array.isArray(parsed) && parsed.length > 0, 'npm pack --dry-run --json must return an array');
  return parsed[parsed.length - 1];
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
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
    'tests/unit/',
    'tests/cli/',
    'tests/smoke/',
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
  const docIndex = buildSkillDocIndex();
  const benchmarkDocsHistory = JSON.parse(readText('docs/benchmarks/history.json'));
  const benchmarkLatestReport = JSON.parse(readText('benchmarks/latest/core-report.json'));
  const benchmarkLatestBundle = JSON.parse(readText('benchmarks/latest/core-bundle.json'));
  const benchmarkLatestHistory = JSON.parse(readText('benchmarks/latest/core-history.json'));

  assert.equal(fs.existsSync(path.join(ROOT, 'README.md')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'README_FOR_SHARING.md')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'SKILL.md')), true);
  assert.equal(Array.isArray(docIndex.skills), true);
  assert.ok(docIndex.skills.length >= 10);
  for (const doc of docIndex.skills) {
    assert.equal(fs.existsSync(path.join(ROOT, doc.path)), true, `missing indexed skill doc ${doc.path}`);
    assert.equal(typeof doc.contentHash, 'string');
    assert.ok(Array.isArray(doc.canonicalTools));
  }

  const readmeText = readText('README.md');
  const shareableReadmeText = readText('README_FOR_SHARING.md');
  const skillText = readText('SKILL.md');
  const commandReferenceText = readText('docs/skills/command-reference.md');
  const capabilitiesText = readText('docs/skills/capabilities.md');
  const agentInterfacesText = readText('docs/skills/agent-interfaces.md');
  const agentQuickstartText = readText('docs/skills/agent-quickstart.md');
  const tradingWorkflowsText = readText('docs/skills/trading-workflows.md');
  const portfolioCloseoutText = readText('docs/skills/portfolio-closeout.md');
  const policyProfilesText = readText('docs/skills/policy-profiles.md');
  const benchmarkOverviewText = readText('docs/benchmarks/README.md');
  const benchmarkScenarioCatalogText = readText('docs/benchmarks/scenario-catalog.md');
  const benchmarkScorecardText = readText('docs/benchmarks/scorecard.md');
  const releaseVerificationText = readText('docs/trust/release-verification.md');
  const securityModelText = readText('docs/trust/security-model.md');
  const supportMatrixText = readText('docs/trust/support-matrix.md');

  for (const text of [readmeText, skillText, agentInterfacesText]) {
    assert.match(text, /pandora --output json capabilities/);
    assert.match(text, /pandora --output json schema/);
  }
  assert.match(shareableReadmeText, /pandora --output json capabilities/);
  assert.match(shareableReadmeText, /bootstrap/i);
  assert.match(skillText, /docs\/skills\/agent-quickstart\.md/);
  assert.match(commandReferenceText, /pandora mcp/);
  assert.match(commandReferenceText, /sports create run/);
  assert.match(commandReferenceText, /--category/);
  assert.match(commandReferenceText, /--polymarket-rpc-url/);
  assert.match(capabilitiesText, /commandDescriptorVersion/);
  assert.match(agentQuickstartText, /pandora mcp http/);
  assert.match(tradingWorkflowsText, /trade --output json --dry-run/);
  assert.match(tradingWorkflowsText, /sell --output json --dry-run/);
  assert.match(portfolioCloseoutText, /operations list/);
  assert.match(portfolioCloseoutText, /mirror close/);
  assert.match(policyProfilesText, /policy list/);
  assert.match(policyProfilesText, /profile list/);
  assert.match(benchmarkOverviewText, /core-bundle\.json/);
  assert.match(benchmarkOverviewText, /core-history\.json/);
  assert.match(benchmarkScenarioCatalogText, /cli-capabilities-bootstrap/);
  assert.match(benchmarkScorecardText, /weightedScore/i);
  assert.equal(Array.isArray(benchmarkDocsHistory.entries), true);
  assert.equal(Array.isArray(benchmarkLatestHistory.entries), true);
  assert.equal(benchmarkLatestReport.summary.overallPass, true);
  assert.equal(benchmarkLatestReport.contractLockMatchesExpected, true);
  assert.equal(benchmarkLatestBundle.latest.summary.overallPass, true);
  assert.match(releaseVerificationText, /gh attestation verify/);
  assert.match(releaseVerificationText, /sbom\.spdx\.json/);
  assert.match(securityModelText, /Remote gateway auth model/);
  assert.match(supportMatrixText, /Trust docs/);
});
