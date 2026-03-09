const assert = require('node:assert/strict');

function sortStrings(values) {
  return Array.from(new Set(Array.isArray(values) ? values : []))
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function getToolPolicyScopes(tool) {
  if (tool && tool.xPandora && typeof tool.xPandora === 'object') {
    return sortStrings(tool.xPandora.policyScopes);
  }
  if (
    tool
    && tool.inputSchema
    && tool.inputSchema.xPandora
    && typeof tool.inputSchema.xPandora === 'object'
  ) {
    return sortStrings(tool.inputSchema.xPandora.policyScopes);
  }
  return [];
}

function derivePolicyScopedCommands(commandDescriptors) {
  return sortStrings(
    Object.entries(commandDescriptors || {})
      .filter(([, descriptor]) => descriptor && Array.isArray(descriptor.policyScopes) && descriptor.policyScopes.length)
      .map(([name]) => name),
  );
}

function deriveSecretCommands(commandDescriptors) {
  return sortStrings(
    Object.entries(commandDescriptors || {})
      .filter(([, descriptor]) => descriptor && descriptor.requiresSecrets)
      .map(([name]) => name),
  );
}

function assertPolicyProfilePayloadConsistency(capabilitiesPayload, commandDescriptors) {
  const publicCommandDigests = capabilitiesPayload && typeof capabilitiesPayload.commandDigests === 'object'
    ? capabilitiesPayload.commandDigests
    : {};
  const digestBackedDescriptors = Object.keys(publicCommandDigests).length
    ? Object.fromEntries(
      Object.entries(commandDescriptors || {}).filter(([commandName]) => Object.prototype.hasOwnProperty.call(publicCommandDigests, commandName)),
    )
    : (commandDescriptors || {});
  const expectedPolicyScopedCommands = derivePolicyScopedCommands(digestBackedDescriptors);
  const expectedSecretCommands = deriveSecretCommands(digestBackedDescriptors);

  assert.equal(capabilitiesPayload.policyProfiles.policyPacks.supported, true);
  assert.equal(capabilitiesPayload.policyProfiles.policyPacks.status, 'alpha');
  assert.ok(
    capabilitiesPayload.policyProfiles.policyPacks.notes.some((note) => /policy pack|policy/i.test(String(note))),
    'policyPacks notes should mention policy metadata status',
  );
  assert.equal(
    capabilitiesPayload.policyProfiles.policyPacks.policyScopedCommandCount,
    expectedPolicyScopedCommands.length,
  );
  for (const commandName of capabilitiesPayload.policyProfiles.policyPacks.samplePolicyScopedCommands || []) {
    assert.ok(expectedPolicyScopedCommands.includes(commandName), `unexpected policy pack sample command ${commandName}`);
  }

  assert.equal(capabilitiesPayload.policyProfiles.signerProfiles.supported, true);
  assert.equal(capabilitiesPayload.policyProfiles.signerProfiles.status, 'alpha');
  assert.ok(
    capabilitiesPayload.policyProfiles.signerProfiles.notes.some((note) => /signer|direct flags|env/i.test(String(note))),
    'signerProfiles notes should mention current credential resolution status',
  );
  assert.equal(
    capabilitiesPayload.policyProfiles.signerProfiles.secretBearingCommandCount,
    expectedSecretCommands.length,
  );
  for (const commandName of capabilitiesPayload.policyProfiles.signerProfiles.sampleSecretBearingCommands || []) {
    assert.ok(expectedSecretCommands.includes(commandName), `unexpected signer profile sample command ${commandName}`);
  }

  for (const commandName of expectedSecretCommands) {
    const descriptor = commandDescriptors[commandName];
    assert.ok(descriptor, `missing descriptor for ${commandName}`);
    assert.ok(
      sortStrings(descriptor.policyScopes).includes('secrets:use'),
      `${commandName} requires secrets but is missing secrets:use policy scope`,
    );
  }
}

function assertCommandDigestPolicyParity(commandDigests, commandDescriptors) {
  const visibleCommandNames = new Set(Object.keys(commandDigests || {}));
  for (const [commandName, descriptor] of Object.entries(commandDescriptors || {})) {
    if (!visibleCommandNames.has(commandName)) continue;
    const digest = commandDigests[commandName];
    assert.ok(digest, `missing command digest for ${commandName}`);
    assert.deepEqual(
      sortStrings(digest.policyScopes),
      sortStrings(descriptor && descriptor.policyScopes),
      `policyScopes mismatch for ${commandName}`,
    );
    assert.equal(
      Boolean(digest.requiresSecrets),
      Boolean(descriptor && descriptor.requiresSecrets),
      `requiresSecrets mismatch for ${commandName}`,
    );
  }
}

function assertToolPolicyScopeParity(tools, commandDescriptors) {
  const byName = new Map(
    (Array.isArray(tools) ? tools : []).map((tool) => [String(tool && tool.name ? tool.name : ''), tool]),
  );

  for (const [commandName, descriptor] of Object.entries(commandDescriptors || {})) {
    if (!descriptor || !descriptor.mcpExposed) continue;
    const tool = byName.get(commandName);
    if (!tool && descriptor.aliasOf) {
      continue;
    }
    assert.ok(tool, `missing MCP tool for ${commandName}`);
    assert.deepEqual(
      getToolPolicyScopes(tool),
      sortStrings(descriptor.policyScopes),
      `tool policyScopes mismatch for ${commandName}`,
    );
  }
}

function assertCanonicalToolFirstMetadata(metadata, expectedCommandName, options = {}) {
  assert.ok(metadata, `missing canonical metadata for ${expectedCommandName}`);
  assert.equal(metadata.canonicalTool, expectedCommandName, `canonicalTool mismatch for ${expectedCommandName}`);
  assert.equal(metadata.aliasOf, null, `${expectedCommandName} should be canonical, not an alias`);
  assert.equal(metadata.preferred, true, `${expectedCommandName} should be marked preferred`);

  if (options.requireJsonOutput !== false) {
    assert.ok(
      Array.isArray(metadata.outputModes) && metadata.outputModes.includes('json'),
      `${expectedCommandName} should support json output for machine use`,
    );
  }

  if (options.requireCommandEmit !== false) {
    assert.ok(
      Array.isArray(metadata.emits) && metadata.emits.includes(expectedCommandName),
      `${expectedCommandName} should emit its canonical command name`,
    );
  }
}

function assertCanonicalToolFirstCommandSet(commandMetadata, commandNames, options = {}) {
  for (const commandName of Array.isArray(commandNames) ? commandNames : []) {
    assertCanonicalToolFirstMetadata(commandMetadata && commandMetadata[commandName], commandName, options);
  }
}

function assertBootstrapPolicyProfileRecommendations(bootstrapPayload, commandMetadata, options = {}) {
  const expectedReadOnlyPolicyId = options.expectedReadOnlyPolicyId || 'research-only';
  const expectedMutablePolicyId = options.expectedMutablePolicyId || 'execute-with-validation';
  const expectedReadOnlyProfileId = options.expectedReadOnlyProfileId || 'market_observer_ro';
  const expectedMutableProfileId = Object.prototype.hasOwnProperty.call(options, 'expectedMutableProfileId')
    ? options.expectedMutableProfileId
    : null;

  assert.deepEqual(
    bootstrapPayload.canonicalTools,
    bootstrapPayload.recommendedBootstrapFlow,
    'bootstrap should recommend canonical tools first',
  );
  assertCanonicalToolFirstCommandSet(commandMetadata, bootstrapPayload.recommendedBootstrapFlow, {
    requireJsonOutput: true,
  });

  const policyItems = new Map((bootstrapPayload.policies && bootstrapPayload.policies.items || []).map((item) => [item.id, item]));
  const profileItems = new Map((bootstrapPayload.profiles && bootstrapPayload.profiles.items || []).map((item) => [item.id, item]));

  assert.equal(bootstrapPayload.policies.recommendedReadOnlyPolicyId, expectedReadOnlyPolicyId);
  assert.equal(bootstrapPayload.policies.recommendedMutablePolicyId, expectedMutablePolicyId);
  assert.ok(policyItems.has(expectedReadOnlyPolicyId), `missing recommended read-only policy ${expectedReadOnlyPolicyId}`);
  assert.ok(policyItems.has(expectedMutablePolicyId), `missing recommended mutable policy ${expectedMutablePolicyId}`);

  assert.equal(bootstrapPayload.profiles.recommendedReadOnlyProfileId, expectedReadOnlyProfileId);
  assert.ok(profileItems.has(expectedReadOnlyProfileId), `missing recommended read-only profile ${expectedReadOnlyProfileId}`);

  const readOnlyProfile = profileItems.get(expectedReadOnlyProfileId);
  assert.equal(readOnlyProfile.readOnly, true, `${expectedReadOnlyProfileId} should be read-only`);
  assert.equal(readOnlyProfile.runtimeReady, true, `${expectedReadOnlyProfileId} should be runtime-ready`);

  if (expectedMutableProfileId === null) {
    assert.equal(bootstrapPayload.profiles.recommendedMutableProfileId, null);
  } else {
    assert.equal(bootstrapPayload.profiles.recommendedMutableProfileId, expectedMutableProfileId);
    assert.ok(profileItems.has(expectedMutableProfileId), `missing recommended mutable profile ${expectedMutableProfileId}`);
    const mutableProfile = profileItems.get(expectedMutableProfileId);
    assert.equal(mutableProfile.readOnly, false, `${expectedMutableProfileId} should be mutable`);
    assert.equal(mutableProfile.runtimeReady, true, `${expectedMutableProfileId} should be runtime-ready`);
  }
}

function assertResearchOnlyPolicyExplanation(policyItem) {
  assert.ok(policyItem, 'expected a policy item');
  assert.equal(policyItem.id, 'research-only');

  const compiledRules = Array.isArray(policyItem.compiledRules) ? policyItem.compiledRules : [];
  const byId = new Map(compiledRules.map((rule) => [rule.id, rule]));
  const denyMutating = byId.get('deny-mutating');
  const denyDirectSecrets = byId.get('deny-direct-secrets');

  assert.ok(denyMutating, 'research-only should explain mutating denial');
  assert.equal(denyMutating.result.code, 'POLICY_RESEARCH_ONLY_MUTATION_DENIED');
  assert.ok(
    Array.isArray(denyMutating.result.remediation.actions)
    && denyMutating.result.remediation.actions.some((action) => action.type === 'switch_policy_pack' && action.packId === 'paper-trading'),
    'research-only should recommend paper-trading as the next mutable-safe pack',
  );
  assert.ok(
    denyMutating.result.remediation.actions.some((action) => action.type === 'run_command' && action.command === 'capabilities'),
    'research-only should surface a machine-usable follow-up command',
  );

  assert.ok(denyDirectSecrets, 'research-only should explain direct secret denial');
  assert.equal(denyDirectSecrets.result.code, 'POLICY_RESEARCH_ONLY_SECRET_DENIED');
  assert.ok(
    Array.isArray(denyDirectSecrets.result.remediation.actions)
    && denyDirectSecrets.result.remediation.actions.some((action) => action.type === 'use_profile' && action.profileId === 'market_observer_ro'),
    'research-only should recommend a read-only profile',
  );
  assert.ok(
    denyDirectSecrets.result.remediation.actions.some((action) => action.type === 'set_input' && action.field === 'private-key' && action.value === null),
    'research-only should include a machine-usable secret-removal action',
  );
}

module.exports = {
  sortStrings,
  derivePolicyScopedCommands,
  deriveSecretCommands,
  assertPolicyProfilePayloadConsistency,
  assertCommandDigestPolicyParity,
  assertToolPolicyScopeParity,
  assertCanonicalToolFirstMetadata,
  assertCanonicalToolFirstCommandSet,
  assertBootstrapPolicyProfileRecommendations,
  assertResearchOnlyPolicyExplanation,
};
