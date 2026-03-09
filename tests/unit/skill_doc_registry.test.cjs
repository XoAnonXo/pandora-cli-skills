const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { buildSkillDocIndex } = require('../../cli/lib/skill_doc_registry.cjs');
const { buildCommandDescriptors } = require('../../cli/lib/agent_contract_registry.cjs');
const { buildCapabilitiesPayload } = require('../../cli/lib/capabilities_command_service.cjs');

test('skill doc registry points to real docs and known canonical tools', () => {
  const rootDir = path.resolve(__dirname, '..', '..');
  const docs = buildSkillDocIndex();
  const descriptors = buildCommandDescriptors();

  assert.equal(docs.router.path, 'SKILL.md');
  assert.ok(fs.existsSync(path.join(rootDir, docs.router.path)));
  assert.equal(typeof docs.contentHash, 'string');
  assert.ok(Array.isArray(docs.sourceFiles));
  assert.ok(docs.sourceFiles.includes('SKILL.md'));
  assert.ok(Array.isArray(docs.skills));
  assert.ok(docs.skills.length >= 11);
  assert.ok(Array.isArray(docs.router.startHere));
  assert.ok(Array.isArray(docs.router.taskRoutes));
  assert.ok(docs.router.startHere.length >= 11);
  assert.ok(docs.router.taskRoutes.some((route) => route.label === 'First-time agent bootstrap'));
  assert.ok(docs.router.taskRoutes.some((route) => route.label === 'Benchmark methodology, scenarios, or scorecards'));
  assert.ok(docs.router.taskRoutes.some((route) => route.label === 'Release verification, support matrix, or security posture'));

  for (const doc of docs.skills) {
    assert.ok(fs.existsSync(path.join(rootDir, doc.path)), `missing doc path ${doc.path}`);
    assert.ok(doc.summary.length > 0, `missing summary for ${doc.id}`);
    assert.ok(Array.isArray(doc.canonicalTools), `missing canonical tools for ${doc.id}`);
    assert.equal(typeof doc.contentHash, 'string');
    for (const toolName of doc.canonicalTools) {
      assert.ok(descriptors[toolName], `unknown tool ${toolName} referenced by ${doc.id}`);
    }
  }
});

test('capabilities payload exposes the skill doc index', () => {
  const payload = buildCapabilitiesPayload({ generatedAtOverride: '2026-03-08T00:00:00.000Z' });
  const docIndex = buildSkillDocIndex();

  assert.deepEqual(payload.documentation, docIndex);
  assert.equal(typeof payload.registryDigest.documentationHash, 'string');
  assert.ok(payload.documentation.skills.some((doc) => doc.id === 'agent-quickstart'));
  assert.ok(payload.documentation.skills.some((doc) => doc.id === 'trading-workflows'));
  assert.ok(payload.documentation.skills.some((doc) => doc.id === 'portfolio-closeout'));
  assert.ok(payload.documentation.skills.some((doc) => doc.id === 'policy-profiles'));
  assert.ok(payload.documentation.skills.some((doc) => doc.id === 'release-verification'));
  assert.ok(payload.documentation.skills.some((doc) => doc.id === 'security-model'));
  assert.ok(payload.documentation.skills.some((doc) => doc.id === 'support-matrix'));
  assert.ok(payload.documentation.skills.some((doc) => doc.id === 'benchmark-overview'));
  assert.ok(payload.documentation.skills.some((doc) => doc.id === 'benchmark-scenarios'));
  assert.ok(payload.documentation.skills.some((doc) => doc.id === 'benchmark-scorecard'));
});
