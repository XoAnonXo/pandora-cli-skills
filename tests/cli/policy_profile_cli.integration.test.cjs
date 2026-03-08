const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runCli } = require('../helpers/cli_runner.cjs');
const { assertSchemaValid } = require('../helpers/json_schema_assert.cjs');
const {
  assertPolicyProfilePayloadConsistency,
  assertCommandDigestPolicyParity,
  sortStrings,
} = require('../helpers/policy_profile_assertions.cjs');

function createIsolatedPolicyProfileEnv(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-policy-profile-cli-'));
  const homeDir = path.join(rootDir, 'home');
  const policyDir = path.join(rootDir, 'policies');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(policyDir, { recursive: true });
  t.after(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
  return {
    rootDir,
    env: {
      HOME: homeDir,
      USERPROFILE: homeDir,
      PANDORA_PROFILE_FILE: path.join(rootDir, 'profiles.json'),
      PANDORA_POLICY_DIR: policyDir,
      PANDORA_POLICIES_DIR: policyDir,
    },
  };
}

function parseJsonOutput(result) {
  assert.equal(result.status, 0, result.output || result.stderr || 'expected successful JSON CLI result');
  return JSON.parse(String(result.stdout || '').trim());
}

test('cli schema and capabilities keep policy/profile metadata in parity', (t) => {
  const { env } = createIsolatedPolicyProfileEnv(t);
  const schemaEnvelope = parseJsonOutput(runCli(['--output', 'json', 'schema'], { env }));
  const capabilitiesEnvelope = parseJsonOutput(runCli(['--output', 'json', 'capabilities'], { env }));

  assert.equal(schemaEnvelope.command, 'schema');
  assert.equal(capabilitiesEnvelope.command, 'capabilities');

  assertPolicyProfilePayloadConsistency(
    capabilitiesEnvelope.data,
    schemaEnvelope.data.commandDescriptors,
  );
  assertCommandDigestPolicyParity(
    capabilitiesEnvelope.data.commandDigests,
    schemaEnvelope.data.commandDescriptors,
  );

  assert.deepEqual(
    capabilitiesEnvelope.data.commandDigests.capabilities.policyScopes,
    schemaEnvelope.data.commandDescriptors.capabilities.policyScopes,
  );
  assert.deepEqual(
    capabilitiesEnvelope.data.commandDigests.trade.policyScopes,
    sortStrings(schemaEnvelope.data.commandDescriptors.trade.policyScopes),
  );
  assert.ok(capabilitiesEnvelope.data.policyProfiles.policyPacks.policyScopedCommandCount > 0);
  assert.ok(capabilitiesEnvelope.data.policyProfiles.policyPacks.samplePolicyScopedCommands.length > 0);
  assert.equal(capabilitiesEnvelope.data.policyProfiles.policyPacks.userCount, 0);
  assert.deepEqual(capabilitiesEnvelope.data.policyProfiles.policyPacks.userSampleIds, []);
  assert.ok(capabilitiesEnvelope.data.policyProfiles.signerProfiles.secretBearingCommandCount > 0);
  assert.ok(capabilitiesEnvelope.data.policyProfiles.signerProfiles.sampleSecretBearingCommands.length > 0);
  assert.ok(capabilitiesEnvelope.data.policyProfiles.policyPacks.builtinIds.includes('execute-with-validation'));
  assert.ok(capabilitiesEnvelope.data.policyProfiles.signerProfiles.builtinIds.includes('prod_trader_a'));
  assert.deepEqual(
    sortStrings(capabilitiesEnvelope.data.policyProfiles.signerProfiles.signerBackends),
    ['external-signer', 'local-env', 'local-keystore', 'read-only'],
  );
  assert.deepEqual(
    sortStrings(capabilitiesEnvelope.data.policyProfiles.signerProfiles.implementedBackends),
    ['local-env', 'read-only'],
  );
  assert.deepEqual(
    sortStrings(capabilitiesEnvelope.data.policyProfiles.signerProfiles.placeholderBackends),
    ['external-signer', 'local-keystore'],
  );
  assert.equal(capabilitiesEnvelope.data.policyProfiles.signerProfiles.readyBuiltinIds.includes('market_observer_ro'), true);
  assert.equal(capabilitiesEnvelope.data.policyProfiles.signerProfiles.pendingBuiltinIds.includes('prod_trader_a'), true);
  assert.equal(
    capabilitiesEnvelope.data.policyProfiles.policyPacks.notes.some((note) => /enforced on policy-scoped execution paths/i.test(note)),
    true,
  );
});

test('cli schema publishes policy/profile definitions and operation provenance placeholders', (t) => {
  const { env } = createIsolatedPolicyProfileEnv(t);
  const schemaEnvelope = parseJsonOutput(runCli(['--output', 'json', 'schema'], { env }));
  const capabilitiesEnvelope = parseJsonOutput(runCli(['--output', 'json', 'capabilities'], { env }));
  const schemaDocument = schemaEnvelope.data;

  assert.ok(schemaDocument.definitions.CapabilitiesPolicyProfileSection);
  assert.ok(schemaDocument.definitions.CapabilitiesSignerProfileSection);
  assert.equal(schemaDocument.commandDescriptorMetadata.capabilities.policyScopes, true);
  assert.ok(schemaDocument.commandDescriptorMetadata.counts.policyScopes > 0);

  assertSchemaValid(
    schemaDocument,
    { $ref: '#/definitions/CapabilitiesPolicyProfileSection' },
    capabilitiesEnvelope.data.policyProfiles.policyPacks,
    'policyPacks',
  );
  assertSchemaValid(
    schemaDocument,
    { $ref: '#/definitions/CapabilitiesSignerProfileSection' },
    capabilitiesEnvelope.data.policyProfiles.signerProfiles,
    'signerProfiles',
  );

  assert.deepEqual(
    schemaDocument.commandDescriptors.trade.policyScopes,
    ['trade:write', 'secrets:use', 'network:rpc', 'network:indexer'],
  );
  assert.equal(schemaDocument.commandDescriptors.trade.requiresSecrets, true);
  assert.deepEqual(
    schemaDocument.commandDescriptors.capabilities.policyScopes,
    ['capabilities:read', 'contracts:read'],
  );

  const operationProperties = schemaDocument.definitions.OperationPayload.properties;
  for (const fieldName of ['policyPack', 'profile', 'environment', 'mode', 'scope']) {
    assert.deepEqual(operationProperties[fieldName].type, ['string', 'null']);
  }
});

test('profile validate reports runtime readiness separately from schema validity', (t) => {
  const { rootDir, env } = createIsolatedPolicyProfileEnv(t);
  const filePath = path.join(rootDir, 'profiles.json');
  fs.writeFileSync(filePath, JSON.stringify({
    profiles: [
      {
        id: 'observer',
        displayName: 'Observer',
        description: 'Read-only observer.',
        signerBackend: 'read-only',
        approvalMode: 'read-only',
      },
    ],
  }));
  const envelope = parseJsonOutput(runCli(['--output', 'json', 'profile', 'validate', '--file', filePath], { env }));
  assert.equal(envelope.command, 'profile.validate');
  assert.equal(envelope.data.valid, true);
  assert.equal(envelope.data.runtimeReady, true);
  assert.equal(envelope.data.runtimeReadyCount, 1);
  assert.equal(envelope.data.items[0].runtimeReady, true);
  assert.equal(typeof envelope.data.items[0].resolutionStatus, 'string');
});

test('policy list/get and profile list/get succeed over the CLI', (t) => {
  const { env } = createIsolatedPolicyProfileEnv(t);
  const policyList = parseJsonOutput(runCli(['--output', 'json', 'policy', 'list'], { env }));
  assert.equal(policyList.command, 'policy.list');
  assert.equal(policyList.data.userCount, 0);
  assert.ok(policyList.data.items.some((item) => item.id === 'execute-with-validation'));

  const policyGet = parseJsonOutput(runCli(['--output', 'json', 'policy', 'get', '--id', 'research-only'], { env }));
  assert.equal(policyGet.command, 'policy.get');
  assert.equal(policyGet.data.item.id, 'research-only');

  const profileList = parseJsonOutput(runCli(['--output', 'json', 'profile', 'list'], { env }));
  assert.equal(profileList.command, 'profile.list');
  assert.equal(profileList.data.fileCount, 0);
  assert.ok(profileList.data.items.some((item) => item.id === 'market_observer_ro'));
  const observer = profileList.data.items.find((item) => item.id === 'market_observer_ro');
  const keystore = profileList.data.items.find((item) => item.id === 'dev_keystore_operator');
  assert.equal(observer.runtimeReady, true);
  assert.equal(observer.backendImplemented, true);
  assert.equal(keystore.runtimeReady, false);
  assert.equal(keystore.backendImplemented, false);
  assert.equal(typeof keystore.resolutionStatus, 'string');

  const profileGet = parseJsonOutput(runCli(['--output', 'json', 'profile', 'get', '--id', 'market_observer_ro'], { env }));
  assert.equal(profileGet.command, 'profile.get');
  assert.equal(profileGet.data.profile.id, 'market_observer_ro');
  assert.equal(profileGet.data.profile.defaultPolicy, 'research-only');
});

test('policy lint accepts valid pack files over the CLI', (t) => {
  const { rootDir, env } = createIsolatedPolicyProfileEnv(t);
  const filePath = path.join(rootDir, 'policy.json');
  fs.writeFileSync(filePath, JSON.stringify({
    schemaVersion: '1.0.0',
    kind: 'policy-pack',
    id: 'cli-safe',
    version: '1.0.0',
    displayName: 'CLI Safe',
    description: 'CLI smoke policy.',
    rules: [
      {
        id: 'deny-live',
        kind: 'deny_live_execution',
        result: {
          code: 'LIVE_DENIED',
          message: 'deny',
        },
      },
    ],
  }));

  const envelope = parseJsonOutput(runCli(['--output', 'json', 'policy', 'lint', '--file', filePath], { env }));
  assert.equal(envelope.command, 'policy.lint');
  assert.equal(envelope.data.ok, true);
  assert.equal(envelope.data.item.id, 'cli-safe');
});
