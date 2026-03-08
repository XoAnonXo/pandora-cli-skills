const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createMcpHttpGatewayService } = require('../../cli/lib/mcp_http_gateway_service.cjs');
const {
  PandoraAgentClient,
  PandoraToolCallError,
  createLocalPandoraAgentClient,
  createRemotePandoraAgentClient,
  inspectToolPolicySurface,
  listPolicyScopes,
  loadGeneratedContractRegistry,
  loadGeneratedCommandDescriptors,
  loadGeneratedManifest,
  loadGeneratedMcpToolDefinitions,
  normalizeStructuredEnvelope,
} = require('../../sdk/typescript');
const generated = require('../../sdk/generated');
const pkg = require('../../package.json');
const typescriptPkg = require('../../sdk/typescript/package.json');
const { buildGeneratedArtifactFiles } = require('../../scripts/lib/agent_contract_sdk_export.cjs');

function readPythonPackageVersion() {
  const pyprojectText = fs.readFileSync(
    path.join(__dirname, '..', '..', 'sdk', 'python', 'pyproject.toml'),
    'utf8',
  );
  const match = pyprojectText.match(/^\s*version\s*=\s*"([^"\n]+)"\s*$/m);
  assert.ok(match, 'sdk/python/pyproject.toml is missing [project].version');
  return match[1];
}

function readGeneratedManifest(files, relativePath) {
  const file = files.find((entry) => entry.relativePath === relativePath);
  assert.ok(file, `Missing generated artifact: ${relativePath}`);
  return JSON.parse(file.content);
}

test('sdk contract generator emits surface-specific manifest package versions', () => {
  const pythonPackageVersion = readPythonPackageVersion();
  const files = buildGeneratedArtifactFiles({
    packageVersion: pkg.version,
    typescriptPackageVersion: typescriptPkg.version,
    pythonPackageVersion,
  });

  const sharedManifest = readGeneratedManifest(files, 'sdk/generated/manifest.json');
  const typescriptManifest = readGeneratedManifest(files, 'sdk/typescript/generated/manifest.json');
  const pythonManifest = readGeneratedManifest(files, 'sdk/python/pandora_agent/generated/manifest.json');

  assert.equal(sharedManifest.packageVersion, pkg.version);
  assert.equal(typescriptManifest.packageVersion, typescriptPkg.version);
  assert.equal(typescriptManifest.contractPackageVersion, pkg.version);
  assert.deepEqual(
    typescriptManifest.backends.packagedClients.notes,
    [
      'This generated manifest describes the standalone TypeScript SDK alpha package surface.',
      'The standalone TypeScript SDK package ships its own generated contract artifacts and client entrypoints only.',
    ],
  );
  assert.equal(pythonManifest.packageVersion, pythonPackageVersion);
  assert.equal(pythonManifest.contractPackageVersion, pkg.version);
  assert.deepEqual(
    pythonManifest.backends.packagedClients.notes,
    [
      'This generated manifest describes the standalone Python SDK alpha package surface.',
      'The standalone Python SDK package ships its own generated contract artifacts and client modules only.',
    ],
  );
});

test('generated sdk bundle exposes loader helpers', () => {
  assert.equal(typeof generated.loadGeneratedManifest, 'function');
  assert.equal(typeof generated.loadGeneratedCommandDescriptors, 'function');
  assert.equal(typeof generated.loadGeneratedMcpToolDefinitions, 'function');
  assert.equal(typeof generated.loadGeneratedContractRegistry, 'function');
  assert.equal(generated.loadGeneratedManifest().packageVersion, pkg.version);
  assert.equal(loadGeneratedManifest().contractPackageVersion, pkg.version);
  assert.equal(generated.loadGeneratedManifest().schemaVersion, loadGeneratedManifest().schemaVersion);
  assert.ok(generated.loadGeneratedCommandDescriptors().capabilities);
  assert.ok(Array.isArray(generated.loadGeneratedMcpToolDefinitions()));
  assert.ok(generated.loadGeneratedContractRegistry().commandDescriptors);
  assert.ok(loadGeneratedContractRegistry().commandDescriptors);
  assert.ok(loadGeneratedCommandDescriptors().capabilities);
  assert.ok(Array.isArray(loadGeneratedMcpToolDefinitions()));
});

test('typescript sdk policy inspection supports command families and compact registries', () => {
  const client = createLocalPandoraAgentClient();
  assert.ok(client.listPolicyScopedCommands().includes('policy'));
  assert.deepEqual(client.inspectToolPolicySurface('policy').policyScopes, ['policy:read']);
  assert.deepEqual(client.inspectToolPolicySurface('profile').policyScopes, ['profile:read']);

  const compactCatalog = JSON.parse(JSON.stringify(loadGeneratedContractRegistry()));
  delete compactCatalog.commandDescriptors;
  for (const tool of Object.values(compactCatalog.tools || {})) {
    if (tool && typeof tool === 'object') {
      delete tool.commandDescriptor;
    }
  }

  assert.ok(listPolicyScopes(compactCatalog).includes('operations:read'));
  const tradeSurface = inspectToolPolicySurface('trade', compactCatalog);
  assert.equal(tradeSurface.policyPackEligible, true);
  assert.equal(tradeSurface.signerProfileEligible, true);
  assert.equal(tradeSurface.supportsRemote, true);
  assert.equal(tradeSurface.remoteEligible, true);
});

test('typescript sdk local client can call capabilities over stdio MCP', async () => {
  const client = createLocalPandoraAgentClient({
    command: 'node',
    args: ['cli/pandora.cjs', 'mcp'],
    cwd: process.cwd(),
  });
  await client.connect();
  const envelope = await client.callTool('capabilities');
  await client.close();
  assert.equal(envelope.ok, true);
  assert.equal(envelope.command, 'capabilities');
  assert.ok(envelope.data.summary.totalCommands > 50);
  assert.equal(envelope.data.commandDescriptorVersion, loadGeneratedContractRegistry().commandDescriptorVersion);
  assert.deepEqual(envelope.data.policyProfiles, loadGeneratedContractRegistry().capabilities.policyProfiles);
});

test('typescript sdk listTools normalizes runtime xPandora metadata for consumers', async () => {
  const client = createLocalPandoraAgentClient({
    command: 'node',
    args: ['cli/pandora.cjs', 'mcp'],
    cwd: process.cwd(),
  });
  await client.connect();
  const tools = await client.listTools();
  await client.close();

  const capabilities = tools.find((tool) => tool.name === 'capabilities');
  assert.ok(capabilities);
  assert.equal(capabilities.supportsRemote, true);
  assert.equal(capabilities.remoteEligible, true);
  assert.deepEqual(capabilities.policyScopes, ['capabilities:read', 'contracts:read']);
  assert.equal(capabilities.commandDescriptor.canonicalTool, 'capabilities');
  assert.equal(capabilities.xPandora.canonicalTool, 'capabilities');
});

test('typescript sdk remote client can call capabilities over HTTP MCP', async () => {
  const service = createMcpHttpGatewayService({
    args: ['--host', '127.0.0.1', '--port', '0', '--auth-token', 'sdkts'],
    packageVersion: pkg.version,
  });
  const running = await service.start();
  const client = createRemotePandoraAgentClient({
    url: `${running.config.baseUrl}${running.config.mcpPath}`,
    authToken: 'sdkts',
  });
  await client.connect();
  const envelope = await client.callTool('capabilities');
  await client.close();
  await running.close();
  assert.equal(envelope.ok, true);
  assert.equal(envelope.command, 'capabilities');
  assert.ok(envelope.data.summary.totalCommands > 50);
  assert.equal(envelope.data.commandDescriptorVersion, loadGeneratedContractRegistry().commandDescriptorVersion);
  assert.deepEqual(envelope.data.policyProfiles, loadGeneratedContractRegistry().capabilities.policyProfiles);
});

test('typescript sdk allows forward-compatible tool calls and shapes Pandora tool failures', async () => {
  const recorded = [];
  const client = new PandoraAgentClient({
    backend: {
      async connect() {},
      async close() {},
      async listTools() {
        return [];
      },
      async callTool(name, args) {
        recorded.push({ name, args });
        return {
          structuredContent: {
            ok: false,
            command: name,
            error: {
              code: 'FORBIDDEN',
              message: 'blocked by test backend',
              details: {
                missingScopes: ['secrets:use'],
              },
            },
          },
          isError: false,
        };
      },
    },
  });

  await client.connect();
  await assert.rejects(
    () => client.callTool('future-tool', { dryRun: true }),
    (error) => {
      assert.ok(error instanceof PandoraToolCallError);
      assert.equal(error.code, 'FORBIDDEN');
      assert.equal(error.sdkCode, 'PANDORA_SDK_TOOL_ERROR');
      assert.equal(error.toolName, 'future-tool');
      assert.deepEqual(error.toolError.details.missingScopes, ['secrets:use']);
      return true;
    },
  );
  await client.close();

  assert.deepEqual(recorded, [{ name: 'future-tool', args: { dryRun: true } }]);
});

test('normalizeStructuredEnvelope throws on failure envelopes even without MCP isError', () => {
  assert.throws(
    () => normalizeStructuredEnvelope({
      structuredContent: {
        ok: false,
        error: {
          code: 'POLICY_DENIED',
          message: 'denied by policy',
        },
      },
      isError: false,
    }),
    (error) => {
      assert.ok(error instanceof PandoraToolCallError);
      assert.equal(error.code, 'POLICY_DENIED');
      return true;
    },
  );
});
