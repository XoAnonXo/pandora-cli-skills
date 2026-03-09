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
const { createIsolatedPandoraEnv } = require('../helpers/contract_parity_assertions.cjs');
const {
  createTempDir,
  removeDir,
  run,
  ensureExitCode,
  parseJsonStdout,
  getPackedTarballName,
} = require('../helpers/sdk_consumer_runner.cjs');

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
  const typescriptRegistry = readGeneratedManifest(files, 'sdk/typescript/generated/contract-registry.json');
  const pythonRegistry = readGeneratedManifest(files, 'sdk/python/pandora_agent/generated/contract-registry.json');

  assert.equal(sharedManifest.packageVersion, pkg.version);
  assert.equal(typescriptManifest.packageVersion, typescriptPkg.version);
  assert.equal(typescriptRegistry.packageVersion, typescriptPkg.version);
  assert.equal(typescriptManifest.contractPackageVersion, pkg.version);
  assert.deepEqual(
    typescriptManifest.backends.packagedClients.notes,
    [
      'This generated manifest describes the standalone TypeScript SDK alpha package surface.',
      'The standalone TypeScript SDK package ships its own generated contract artifacts and client entrypoints only.',
    ],
  );
  assert.equal(pythonManifest.packageVersion, pythonPackageVersion);
  assert.equal(pythonRegistry.packageVersion, pythonPackageVersion);
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

test('typescript sdk rejects non-object JSON tool payloads', () => {
  assert.throws(
    () => normalizeStructuredEnvelope({
      content: [{ type: 'text', text: '[1,2,3]' }],
    }),
    (error) => {
      assert.equal(error.code, 'PANDORA_SDK_INVALID_TOOL_RESULT');
      return true;
    },
  );
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

test('typescript sdk exposes bootstrap helper for cold-agent startup', async () => {
  const client = createLocalPandoraAgentClient({
    command: 'node',
    args: ['cli/pandora.cjs', 'mcp'],
    cwd: process.cwd(),
  });
  await client.connect();
  const bootstrap = await client.getBootstrap();
  await client.close();

  assert.equal(typeof bootstrap, 'object');
  assert.ok(Array.isArray(bootstrap.canonicalTools));
  assert.ok(bootstrap.canonicalTools.length > 0);
  assert.ok(Array.isArray(bootstrap.recommendedBootstrapFlow));
  assert.ok(bootstrap.recommendedBootstrapFlow.includes('bootstrap'));
});

test('standalone typescript sdk tarball installs into a fresh consumer app and stays usable', async (t) => {
  const tempRoot = createTempDir('pandora-ts-sdk-consumer-');
  const packDir = path.join(tempRoot, 'pack');
  const appDir = path.join(tempRoot, 'app');
  const runtimeDir = path.join(tempRoot, 'runtime');
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  t.after(() => removeDir(tempRoot));

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const packResult = run(npmCommand, ['pack', '--silent', path.join(process.cwd(), 'sdk', 'typescript')], {
    cwd: packDir,
  });
  ensureExitCode(packResult, 0, 'npm pack ./sdk/typescript');
  const tarballPath = path.join(packDir, getPackedTarballName(packResult, 'npm pack ./sdk/typescript'));

  const npmInitResult = run(npmCommand, ['init', '-y'], { cwd: appDir });
  ensureExitCode(npmInitResult, 0, 'npm init -y (standalone typescript sdk consumer)');

  const installResult = run(npmCommand, ['install', '--ignore-scripts', '--omit=dev', tarballPath], {
    cwd: appDir,
  });
  ensureExitCode(installResult, 0, 'npm install standalone typescript sdk tarball');

  const consumerEnv = {
    ...process.env,
    ...createIsolatedPandoraEnv(runtimeDir),
  };
  const consumerScript = `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    const sdk = require('@thisispandora/agent-sdk');
    const generated = require('@thisispandora/agent-sdk/generated');
    (async () => {
      const installedPackagePath = path.join(process.cwd(), 'node_modules', '@thisispandora', 'agent-sdk', 'package.json');
      const installedPackage = JSON.parse(fs.readFileSync(installedPackagePath, 'utf8'));
      const manifest = sdk.loadGeneratedManifest();
      const registry = sdk.loadGeneratedContractRegistry();
      const generatedManifest = generated.loadGeneratedManifest();
      const client = sdk.createLocalPandoraAgentClient({
        command: process.execPath,
        args: [${JSON.stringify(path.join(process.cwd(), 'cli', 'pandora.cjs'))}, 'mcp'],
        cwd: ${JSON.stringify(process.cwd())},
        env: process.env,
      });
      await client.connect();
      const envelope = await client.callTool('capabilities');
      await client.close();
      const tradeSurface = sdk.inspectToolPolicySurface('trade');
      assert.equal(installedPackage.name, '@thisispandora/agent-sdk');
      assert.deepEqual(installedPackage.exports['./generated'], {
        types: './generated/index.d.ts',
        import: './generated/index.mjs',
        require: './generated/index.js',
        default: './generated/index.js',
      });
      assert.equal(typeof generated.loadGeneratedManifest, 'function');
      console.log(JSON.stringify({
        installedVersion: installedPackage.version,
        manifestVersion: manifest.packageVersion,
        contractPackageVersion: manifest.contractPackageVersion,
        generatedManifestVersion: generatedManifest.packageVersion,
        toolCount: Object.keys(registry.tools || {}).length,
        tradePolicyScopes: tradeSurface.policyScopes,
        tradeRequiresSecrets: tradeSurface.requiresSecrets,
        command: envelope.command,
        ok: envelope.ok,
        policyStatus: envelope.data.policyProfiles.policyPacks.status,
      }));
    })().catch((error) => {
      console.error(error && error.stack ? error.stack : String(error));
      process.exit(1);
    });
  `;
  const consumerRun = run(process.execPath, ['-e', consumerScript], {
    cwd: appDir,
    env: consumerEnv,
    timeoutMs: 120_000,
  });
  ensureExitCode(consumerRun, 0, 'standalone typescript sdk consumer run');
  const payload = parseJsonStdout(consumerRun, 'standalone typescript sdk consumer run');

  assert.equal(payload.installedVersion, typescriptPkg.version);
  assert.equal(payload.manifestVersion, typescriptPkg.version);
  assert.equal(payload.generatedManifestVersion, typescriptPkg.version);
  assert.equal(payload.contractPackageVersion, pkg.version);
  assert.ok(payload.toolCount > 0);
  assert.equal(payload.command, 'capabilities');
  assert.equal(payload.ok, true);
  assert.equal(payload.policyStatus, 'alpha');
  assert.equal(payload.tradeRequiresSecrets, true);
  assert.ok(Array.isArray(payload.tradePolicyScopes));
  assert.ok(payload.tradePolicyScopes.includes('secrets:use'));
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
