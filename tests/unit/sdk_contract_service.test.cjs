const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const generatedManifest = require('../../sdk/generated/manifest.json');
const generatedContractRegistry = require('../../sdk/generated/contract-registry.json');
const generatedCommandDescriptors = require('../../sdk/generated/command-descriptors.json');
const generatedMcpToolDefinitions = require('../../sdk/generated/mcp-tool-definitions.json');
const { buildCommandDescriptors } = require('../../cli/lib/agent_contract_registry.cjs');
const { createMcpToolRegistry } = require('../../cli/lib/mcp_tool_registry.cjs');
const { buildSchemaPayload } = require('../../cli/lib/schema_command_service.cjs');
const { buildCapabilitiesPayload } = require('../../cli/lib/capabilities_command_service.cjs');
const {
  buildSdkContractComponents,
  buildSdkContractArtifact,
  SDK_CONTRACT_ARTIFACT_VERSION,
  SDK_ARTIFACT_GENERATED_AT,
} = require('../../cli/lib/sdk_contract_service.cjs');
const {
  omitGeneratedAt,
  createIsolatedPandoraEnv,
  withTemporaryEnv,
} = require('../helpers/contract_parity_assertions.cjs');

function withIsolatedRuntime(t, fn) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-sdk-contract-test-'));
  t.after(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
  return withTemporaryEnv(createIsolatedPandoraEnv(rootDir), () => fn(rootDir));
}

test('buildSdkContractArtifact exposes generated SDK contract bundle', async (t) => {
  await withIsolatedRuntime(t, () => {
    const artifact = buildSdkContractArtifact({ packageVersion: '1.1.68', remoteTransportActive: true, remoteTransportUrl: 'http://127.0.0.1:8787/mcp' });
    assert.equal(artifact.schemaVersion, SDK_CONTRACT_ARTIFACT_VERSION);
    assert.equal(artifact.packageVersion, '1.1.68');
    assert.ok(artifact.commandDescriptors['capabilities']);
    assert.ok(artifact.tools['markets.list']);
    assert.equal(artifact.tools['arb.scan'].xPandora.canonicalTool, 'arb.scan');
    assert.equal(artifact.tools['arbitrage'], undefined);
    assert.equal(artifact.compatibility.commandDescriptors['arbitrage'].aliasOf, 'arb.scan');
    assert.ok(artifact.summary.canonicalTools.includes('arb.scan'));
    assert.ok(artifact.schemas.definitions.SuccessEnvelope);
    assert.equal(artifact.capabilities.generatedAt, SDK_ARTIFACT_GENERATED_AT);
    assert.equal(artifact.capabilities.transports.mcpStreamableHttp.status, 'active');
    assert.equal(artifact.capabilities.transports.sdk.status, 'alpha');
    assert.equal(artifact.capabilities.trustDistribution.verification.benchmark.reportOverallPass, null);
    assert.equal(artifact.capabilities.trustDistribution.verification.benchmark.reportContractLockMatchesExpected, null);
    assert.equal(artifact.capabilities.trustDistribution.verification.signals.benchmarkReportPass, null);
    assert.equal(artifact.capabilities.trustDistribution.verification.signals.benchmarkReportContractLockMatch, null);
  });
});

test('generated SDK manifest and contract bundle stay in lockstep with the artifact builder', async (t) => {
  await withIsolatedRuntime(t, () => {
    const components = buildSdkContractComponents({
      packageVersion: generatedManifest.packageVersion,
      remoteTransportActive: false,
    });
    const artifact = buildSdkContractArtifact({
      packageVersion: generatedManifest.packageVersion,
      remoteTransportActive: false,
    });

    assert.equal(generatedManifest.schemaVersion, artifact.schemaVersion);
    assert.equal(generatedManifest.packageVersion, artifact.packageVersion);
    assert.equal(generatedManifest.commandDescriptorVersion, artifact.commandDescriptorVersion);
    assert.deepEqual(generatedManifest.backends || {}, artifact.backends || {});
    assert.deepEqual(generatedCommandDescriptors, artifact.commandDescriptors);
    assert.deepEqual(generatedContractRegistry.commandDescriptors, artifact.commandDescriptors);
    assert.deepEqual(generatedContractRegistry.tools, artifact.tools);
    const generatedToolDefinitions = new Map(generatedMcpToolDefinitions.map((tool) => [tool.name, tool]));
    const liveToolDefinitions = new Map(components.mcpToolDefinitions.map((tool) => [tool.name, tool]));
    assert.deepEqual(
      generatedMcpToolDefinitions.map((tool) => tool.name),
      components.mcpToolDefinitions.map((tool) => tool.name),
    );
    assert.equal(
      generatedToolDefinitions.get('help').inputSchema.xPandora.remoteTransportActive,
      liveToolDefinitions.get('help').inputSchema.xPandora.remoteTransportActive,
      'Generated help tool definition should preserve remoteTransportActive metadata.',
    );
    assert.equal(
      generatedToolDefinitions.get('trade').inputSchema.xPandora.remoteTransportActive,
      liveToolDefinitions.get('trade').inputSchema.xPandora.remoteTransportActive,
      'Generated trade tool definition should preserve remoteTransportActive metadata.',
    );
  });
});

test('sdk contract artifact exposes live policy/profile explain and recommend commands with canonical metadata', async (t) => {
  await withIsolatedRuntime(t, () => {
    const artifact = buildSdkContractArtifact({
      packageVersion: '1.1.68',
      remoteTransportActive: true,
      remoteTransportUrl: 'https://gateway.example.test/mcp',
    });

    for (const commandName of ['policy.explain', 'policy.recommend', 'profile.recommend']) {
      assert.ok(artifact.commandDescriptors[commandName], `missing descriptor for ${commandName}`);
      assert.ok(artifact.tools[commandName], `missing tool catalog entry for ${commandName}`);
      assert.equal(artifact.commandDescriptors[commandName].canonicalTool, commandName);
      assert.equal(artifact.commandDescriptors[commandName].aliasOf, null);
      assert.equal(artifact.commandDescriptors[commandName].preferred, true);
      assert.equal(artifact.commandDescriptors[commandName].supportsRemote, true);
      assert.equal(artifact.commandDescriptors[commandName].remoteEligible, true);
      assert.equal(artifact.tools[commandName].xPandora.canonicalTool, commandName);
      assert.equal(artifact.tools[commandName].xPandora.aliasOf, null);
      assert.equal(artifact.tools[commandName].xPandora.preferred, true);
    }

    assert.ok(artifact.schemas.definitions.PolicyExplainPayload);
    assert.ok(artifact.schemas.definitions.PolicyRecommendPayload);
    assert.ok(artifact.schemas.definitions.ProfileRecommendPayload);
  });
});

test('sdk contract artifact stays in parity with live schema, capabilities, and registry exports', async (t) => {
  await withIsolatedRuntime(t, () => {
    const options = {
      packageVersion: '1.1.68',
      remoteTransportActive: true,
      remoteTransportUrl: 'https://gateway.example.test/mcp',
    };
    const artifact = buildSdkContractArtifact(options);
    const components = buildSdkContractComponents(options);
    const descriptors = buildCommandDescriptors();
    const schemaPayload = buildSchemaPayload();
    const capabilitiesPayload = buildCapabilitiesPayload({
      packageVersion: '1.1.68',
      remoteTransportActive: true,
      remoteTransportUrl: 'https://gateway.example.test/mcp',
      generatedAtOverride: SDK_ARTIFACT_GENERATED_AT,
      artifactNeutralProfileReadiness: true,
      stableArtifactTrustDistribution: true,
    });
    const tools = components.mcpToolDefinitions;
    const expectedSchemaEnvelope = {
      ...schemaPayload,
      schemaVersion: SDK_CONTRACT_ARTIFACT_VERSION,
      generatedAt: SDK_ARTIFACT_GENERATED_AT,
    };

    const compatibilitySchemaPayload = buildSchemaPayload({ includeCompatibility: true });
    assert.deepEqual(artifact.commandDescriptors, schemaPayload.commandDescriptors);
    assert.deepEqual(artifact.schemas.envelope, expectedSchemaEnvelope);
    assert.deepEqual(artifact.schemas.definitions, schemaPayload.definitions);
    assert.deepEqual(artifact.capabilities, capabilitiesPayload);
    assert.equal(artifact.summary.totalCommands, Object.keys(schemaPayload.commandDescriptors).length);
    assert.equal(artifact.summary.totalMcpTools, tools.length);
    assert.equal(artifact.summary.remoteEligibleTools, tools.filter((tool) => tool.xPandora.remoteEligible).length);
    assert.deepEqual(
      omitGeneratedAt(artifact.capabilities),
      omitGeneratedAt(capabilitiesPayload),
    );

    for (const tool of tools) {
      const catalogEntry = artifact.tools[tool.name];
      assert.ok(catalogEntry, `missing tool catalog entry for ${tool.name}`);
      assert.equal(catalogEntry.name, tool.name, `tool catalog name mismatch for ${tool.name}`);
      assert.equal(catalogEntry.xPandora.canonicalTool, tool.xPandora.canonicalTool, `canonicalTool mismatch for ${tool.name}`);
      assert.equal(
        catalogEntry.inputSchema.xPandora.remoteTransportActive,
        tool.inputSchema.xPandora.remoteTransportActive,
        `remoteTransportActive mismatch for ${tool.name}`,
      );
      assert.deepEqual(catalogEntry.commandDescriptor, descriptors[tool.name], `commandDescriptor mismatch for ${tool.name}`);
    }
    assert.deepEqual(artifact.compatibility.commandDescriptors, compatibilitySchemaPayload.commandDescriptors
      ? Object.fromEntries(
          Object.entries(compatibilitySchemaPayload.commandDescriptors).filter(([, descriptor]) => descriptor && descriptor.aliasOf),
        )
      : {});
  });
});

test('sdk contract capabilities stay artifact-neutral even when signer env is present', async (t) => {
  await withIsolatedRuntime(t, () => {
    withTemporaryEnv({
      PRIVATE_KEY: '0x' + '11'.repeat(32),
      RPC_URL: 'https://rpc.example.test',
      CHAIN_ID: '8453',
    }, () => {
      const artifact = buildSdkContractArtifact({
        packageVersion: '1.1.68',
        remoteTransportActive: false,
      });
      const direct = buildCapabilitiesPayload({
        packageVersion: '1.1.68',
        remoteTransportActive: false,
        generatedAtOverride: SDK_ARTIFACT_GENERATED_AT,
        artifactNeutralProfileReadiness: true,
        stableArtifactTrustDistribution: true,
      });
      assert.deepEqual(artifact.capabilities, direct);
    });
  });
});
