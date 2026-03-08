const test = require('node:test');
const assert = require('node:assert/strict');

const sdk = require('@pandora/agent-sdk');
const backends = require('@pandora/agent-sdk/backends');
const catalog = require('@pandora/agent-sdk/catalog');
const errors = require('@pandora/agent-sdk/errors');
const generated = require('@pandora/agent-sdk/generated');
const manifest = require('@pandora/agent-sdk/generated/manifest');
const commandDescriptors = require('@pandora/agent-sdk/generated/command-descriptors');
const mcpToolDefinitions = require('@pandora/agent-sdk/generated/mcp-tool-definitions');
const contractRegistry = require('@pandora/agent-sdk/generated/contract-registry');
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
  const sdk = await import('@pandora/agent-sdk');
  const generated = await import('@pandora/agent-sdk/generated');
  const manifest = await import('@pandora/agent-sdk/generated/manifest');
  const contractRegistry = await import('@pandora/agent-sdk/generated/contract-registry');

  assert.equal(typeof sdk.connectPandoraAgentClient, 'function');
  assert.equal(typeof generated.default.loadGeneratedManifest, 'function');
  assert.equal(manifest.default.packageVersion, packageJson.version);
  assert.equal(contractRegistry.default.packageVersion, packageJson.version);
});
