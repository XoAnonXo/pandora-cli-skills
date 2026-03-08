const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { runCli, REPO_ROOT } = require('../helpers/cli_runner.cjs');
const { buildSkillDocIndex } = require('../../cli/lib/skill_doc_registry.cjs');

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
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
  assert.ok(capabilities.data.documentation.router.taskRoutes.some((route) => route.label === 'Mirror deployment, verification, sync, or closeout'));
  assert.ok(capabilities.data.documentation.router.taskRoutes.some((route) => route.label === 'Release verification, support matrix, or security posture'));
  assert.ok(capabilities.data.documentation.skills.some((doc) => doc.path === 'docs/skills/agent-quickstart.md'));
  assert.ok(capabilities.data.documentation.skills.some((doc) => doc.path === 'docs/skills/policy-profiles.md'));
  assert.ok(capabilities.data.documentation.skills.some((doc) => doc.path === 'docs/skills/mirror-operations.md'));
  assert.ok(capabilities.data.documentation.skills.some((doc) => doc.path === 'docs/trust/release-verification.md'));
  assert.ok(capabilities.data.documentation.skills.some((doc) => doc.path === 'docs/trust/security-model.md'));
  assert.ok(capabilities.data.documentation.skills.some((doc) => doc.path === 'docs/trust/support-matrix.md'));
  assert.equal(
    schema.data.definitions.CapabilitiesPayload.properties.documentation.$ref,
    '#/definitions/SkillDocIndex',
  );

  assert.match(mergedText, /pandora --output json capabilities/);
  assert.match(mergedText, /pandora --output json schema/);
  assert.match(mergedText, /pandora mcp http/);
  assert.match(mergedText, /policy list\|get\|lint|policy list/);
  assert.match(mergedText, /profile list\|get\|validate|profile list/);
  assert.match(mergedText, /npm run generate:sdk-contracts/);
  assert.match(mergedText, /sdk\/generated/);
  assert.match(mergedText, /sdk\/typescript/);
  assert.match(mergedText, /sdk\/python/);
  assert.match(read('README.md'), /docs\/benchmarks\/README\.md/);
  assert.match(read('README.md'), /docs\/benchmarks\/scenario-catalog\.md/);
  assert.match(read('README.md'), /docs\/benchmarks\/scorecard\.md/);
  assert.match(read('SKILL.md'), /docs\/benchmarks\/README\.md/);
  assert.match(read('SKILL.md'), /docs\/benchmarks\/scenario-catalog\.md/);
  assert.match(read('SKILL.md'), /docs\/benchmarks\/scorecard\.md/);
  assert.match(mergedText, /release-verification\.md/);
  assert.match(mergedText, /security-model\.md/);
  assert.match(mergedText, /support-matrix\.md/);
  for (const scope of ['capabilities:read', 'contracts:read', 'help:read', 'schema:read', 'policy:read', 'profile:read', 'operations:read']) {
    assert.match(mergedText, new RegExp(scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(mergedText, /profile get --id <profile-id>|profile get --id market_observer_ro/);
});
