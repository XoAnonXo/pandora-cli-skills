const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildCommandDescriptors } = require('../../cli/lib/agent_contract_registry.cjs');
const { buildSchemaPayload } = require('../../cli/lib/schema_command_service.cjs');
const { buildCapabilitiesPayload } = require('../../cli/lib/capabilities_command_service.cjs');
const { createMcpToolRegistry } = require('../../cli/lib/mcp_tool_registry.cjs');
const {
  buildSdkContractArtifact,
  SDK_ARTIFACT_GENERATED_AT,
} = require('../../cli/lib/sdk_contract_service.cjs');
const { createOperationService } = require('../../cli/lib/operation_service.cjs');
const { createOperationStateStore } = require('../../cli/lib/operation_state_store.cjs');
const { assertSchemaValid } = require('../helpers/json_schema_assert.cjs');
const { normalizeCapabilitiesForTransportParity } = require('../helpers/contract_parity_assertions.cjs');
const {
  assertPolicyProfilePayloadConsistency,
  assertCommandDigestPolicyParity,
  assertToolPolicyScopeParity,
} = require('../helpers/policy_profile_assertions.cjs');
const { PROFILE_BUILTIN_SAMPLE_PROFILES } = require('../../cli/lib/shared/profile_constants.cjs');
const { BUILTIN_POLICY_PACKS } = require('../../cli/lib/shared/policy_builtin_packs.cjs');

function createTempRoot(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-phase4-policy-tests-'));
  t.after(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
  return rootDir;
}

test('capabilities payload derives planned policy and signer profile sections from shared descriptors', () => {
  const descriptors = buildCommandDescriptors();
  const payload = buildCapabilitiesPayload({
    generatedAtOverride: SDK_ARTIFACT_GENERATED_AT,
  });

  assertPolicyProfilePayloadConsistency(payload, descriptors);
  assertCommandDigestPolicyParity(payload.commandDigests, descriptors);

  assert.ok(payload.policyProfiles.policyPacks.policyScopedCommandCount > 0);
  assert.ok(payload.policyProfiles.policyPacks.samplePolicyScopedCommands.length > 0);
  assert.equal(payload.policyProfiles.policyPacks.userCount, 0);
  assert.deepEqual(payload.policyProfiles.policyPacks.userSampleIds, []);
  assert.ok(payload.policyProfiles.signerProfiles.secretBearingCommandCount > 0);
  assert.ok(payload.policyProfiles.signerProfiles.sampleSecretBearingCommands.length > 0);
  assert.ok(payload.policyProfiles.policyPacks.builtinIds.includes('execute-with-validation'));
  assert.ok(payload.policyProfiles.signerProfiles.builtinIds.includes('prod_trader_a'));
  assert.deepEqual(
    payload.policyProfiles.signerProfiles.signerBackends.slice().sort(),
    ['external-signer', 'local-env', 'local-keystore', 'read-only'],
  );
});

test('schema definitions validate policy profile sections and reserve operation provenance fields', () => {
  const schemaDocument = buildSchemaPayload();
  const capabilitiesPayload = buildCapabilitiesPayload({
    generatedAtOverride: SDK_ARTIFACT_GENERATED_AT,
  });
  const activeRemoteCapabilitiesPayload = buildCapabilitiesPayload({
    generatedAtOverride: SDK_ARTIFACT_GENERATED_AT,
    remoteTransportActive: true,
    remoteTransportUrl: 'https://gateway.example.test/mcp',
  });

  assert.ok(schemaDocument.definitions.CapabilitiesPolicyProfileSection);
  assert.ok(schemaDocument.definitions.CapabilitiesSignerProfileSection);
  assert.equal(schemaDocument.commandDescriptorMetadata.capabilities.policyScopes, true);
  assert.ok(schemaDocument.commandDescriptorMetadata.counts.policyScopes > 0);

  assertSchemaValid(
    schemaDocument,
    { $ref: '#/definitions/CapabilitiesPayload' },
    capabilitiesPayload,
    'capabilities',
  );
  assertSchemaValid(
    schemaDocument,
    { $ref: '#/definitions/CapabilitiesPayload' },
    activeRemoteCapabilitiesPayload,
    'capabilities.activeRemote',
  );
  assertSchemaValid(
    schemaDocument,
    { $ref: '#/definitions/CapabilitiesPolicyProfileSection' },
    capabilitiesPayload.policyProfiles.policyPacks,
    'policyPacks',
  );
  assertSchemaValid(
    schemaDocument,
    { $ref: '#/definitions/CapabilitiesSignerProfileSection' },
    capabilitiesPayload.policyProfiles.signerProfiles,
    'signerProfiles',
  );
  assert.deepEqual(
    normalizeCapabilitiesForTransportParity(capabilitiesPayload).transports.mcpStreamableHttpUnexpectedKeys,
    [],
  );
  assert.deepEqual(
    normalizeCapabilitiesForTransportParity(activeRemoteCapabilitiesPayload).transports.mcpStreamableHttpUnexpectedKeys,
    [],
  );

  const operationProperties = schemaDocument.definitions.OperationPayload.properties;
  for (const fieldName of ['policyPack', 'profile', 'environment', 'mode', 'scope']) {
    assert.deepEqual(
      operationProperties[fieldName].type,
      ['string', 'null'],
      `${fieldName} should remain published as a nullable operation provenance field`,
    );
  }
});

test('sdk artifact and local MCP registry preserve policy scope parity for alpha consumers', () => {
  const artifact = buildSdkContractArtifact({
    packageVersion: '1.1.68',
    remoteTransportActive: true,
    remoteTransportUrl: 'https://gateway.example.test/mcp',
  });
  const localTools = createMcpToolRegistry({ remoteTransportActive: true }).listTools();

  assertPolicyProfilePayloadConsistency(artifact.capabilities, artifact.commandDescriptors);
  assertCommandDigestPolicyParity(artifact.capabilities.commandDigests, artifact.commandDescriptors);
  assertToolPolicyScopeParity(localTools, artifact.commandDescriptors);
  assertToolPolicyScopeParity(Object.values(artifact.tools), artifact.commandDescriptors);

  assert.ok(artifact.tools.trade.xPandora.policyScopes.includes('secrets:use'));
  assert.deepEqual(
    artifact.tools.capabilities.xPandora.policyScopes,
    artifact.commandDescriptors.capabilities.policyScopes,
  );
});

test('operation identity changes when policy or profile context changes even before public propagation is wired', async (t) => {
  const rootDir = createTempRoot(t);
  const service = createOperationService({
    operationStateStore: createOperationStateStore({ rootDir }),
  });

  const base = {
    command: 'trade',
    input: {
      marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      side: 'yes',
      amountUsdc: 10,
    },
    summary: 'Policy test trade',
  };

  const plain = await service.createPlanned(base);
  const withPolicyPack = await service.createPlanned({
    ...base,
    policyPack: 'desk-default',
  });
  const withProfile = await service.createPlanned({
    ...base,
    policyPack: 'desk-default',
    profile: 'hot-wallet',
  });

  assert.notEqual(plain.operationHash, withPolicyPack.operationHash);
  assert.notEqual(withPolicyPack.operationHash, withProfile.operationHash);
  assert.notEqual(plain.operationId, withPolicyPack.operationId);
  assert.notEqual(withPolicyPack.operationId, withProfile.operationId);
});

test('built-in profiles only reference built-in policy ids that exist', () => {
  const policyIds = new Set(BUILTIN_POLICY_PACKS.map((item) => item.id));
  for (const profile of PROFILE_BUILTIN_SAMPLE_PROFILES) {
    if (profile.defaultPolicy) {
      assert.equal(
        policyIds.has(profile.defaultPolicy),
        true,
        `defaultPolicy ${profile.defaultPolicy} must exist for profile ${profile.id}`,
      );
    }
    for (const policyId of profile.allowedPolicies || []) {
      assert.equal(
        policyIds.has(policyId),
        true,
        `allowed policy ${policyId} must exist for profile ${profile.id}`,
      );
    }
  }
});
