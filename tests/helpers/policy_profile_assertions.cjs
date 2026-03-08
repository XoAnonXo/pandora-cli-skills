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
  const expectedPolicyScopedCommands = derivePolicyScopedCommands(commandDescriptors);
  const expectedSecretCommands = deriveSecretCommands(commandDescriptors);

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
  for (const [commandName, descriptor] of Object.entries(commandDescriptors || {})) {
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
    assert.ok(tool, `missing MCP tool for ${commandName}`);
    assert.deepEqual(
      getToolPolicyScopes(tool),
      sortStrings(descriptor.policyScopes),
      `tool policyScopes mismatch for ${commandName}`,
    );
  }
}

module.exports = {
  sortStrings,
  derivePolicyScopedCommands,
  deriveSecretCommands,
  assertPolicyProfilePayloadConsistency,
  assertCommandDigestPolicyParity,
  assertToolPolicyScopeParity,
};
