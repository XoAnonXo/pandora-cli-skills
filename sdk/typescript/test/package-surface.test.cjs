const test = require('node:test');
const assert = require('node:assert/strict');

const sdk = require('@thisispandora/agent-sdk');
const backends = require('@thisispandora/agent-sdk/backends');
const catalog = require('@thisispandora/agent-sdk/catalog');
const errors = require('@thisispandora/agent-sdk/errors');
const generated = require('@thisispandora/agent-sdk/generated');
const manifest = require('@thisispandora/agent-sdk/generated/manifest');
const commandDescriptors = require('@thisispandora/agent-sdk/generated/command-descriptors');
const mcpToolDefinitions = require('@thisispandora/agent-sdk/generated/mcp-tool-definitions');
const contractRegistry = require('@thisispandora/agent-sdk/generated/contract-registry');
const packageJson = require('../package.json');

test('package self-reference exposes standalone subpaths', () => {
  assert.equal(typeof sdk.connectPandoraAgentClient, 'function');
  assert.equal(typeof backends.createPandoraAgentClient, 'function');
  assert.equal(typeof catalog.loadGeneratedCapabilities, 'function');
  assert.equal(typeof errors.normalizeStructuredEnvelope, 'function');
  assert.ok(Array.isArray(mcpToolDefinitions));
  assert.ok(commandDescriptors.capabilities);
  assert.ok(contractRegistry.capabilities);
  assert.equal(manifest.packageVersion, packageJson.version);
  assert.equal(generated.loadGeneratedManifest().packageVersion, packageJson.version);
});

test('package self-reference exposes native ESM entrypoints', async () => {
  const sdk = await import('@thisispandora/agent-sdk');
  const generated = await import('@thisispandora/agent-sdk/generated');
  const manifest = await import('@thisispandora/agent-sdk/generated/manifest');
  const contractRegistry = await import('@thisispandora/agent-sdk/generated/contract-registry');

  assert.equal(typeof sdk.connectPandoraAgentClient, 'function');
  assert.equal(typeof generated.default.loadGeneratedManifest, 'function');
  assert.equal(manifest.default.packageVersion, packageJson.version);
  assert.equal(contractRegistry.default.packageVersion, packageJson.version);
});
