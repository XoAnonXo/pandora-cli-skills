const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { runCli, runCliAsync } = require('../helpers/cli_runner.cjs');
const { assertSchemaValid } = require('../helpers/json_schema_assert.cjs');
const {
  assertPolicyProfilePayloadConsistency,
  assertCommandDigestPolicyParity,
  assertBootstrapPolicyProfileRecommendations,
  assertCanonicalToolFirstCommandSet,
  assertResearchOnlyPolicyExplanation,
  sortStrings,
} = require('../helpers/policy_profile_assertions.cjs');


const BUILTIN_KEYSTORE_PASSWORD = 'test-password';
const BUILTIN_KEYSTORE_JSON = JSON.stringify({
  address: '19e7e376e7c213b7e7e7e46cc70a5dd086daff2a',
  id: 'c90cd9f1-6e40-4ff1-a2b1-8928c40bb9b0',
  version: 3,
  crypto: {
    cipher: 'aes-128-ctr',
    cipherparams: {
      iv: 'e0e590a09e186927ea81adad8b4b31af',
    },
    ciphertext: 'e077031220490dceff4c6762ce64620d3845c5fd40b4a9e0274b700f6930b3fa',
    kdf: 'scrypt',
    kdfparams: {
      salt: '07366f4bac8d02c3a806f67bea856b2dfa1e0b56548c079ccc34ee856c63ee0b',
      n: 1024,
      dklen: 32,
      p: 1,
      r: 8,
    },
    mac: '0abe3a58589b2bf285e0360e5768e6dff770476f76cd62b9af0a9e6e2da5dc47',
  },
}, null, 2);
const BUILTIN_KEYSTORE_ADDRESS = '0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a';
const BUILTIN_EXTERNAL_SIGNER_ADDRESS = '0x4444444444444444444444444444444444444444';

function writeBuiltinKeystoreFixture(rootDir) {
  const keystorePath = path.join(rootDir, 'home', '.pandora', 'keys', 'dev_keystore_operator.json');
  fs.mkdirSync(path.dirname(keystorePath), { recursive: true });
  fs.writeFileSync(keystorePath, BUILTIN_KEYSTORE_JSON, 'utf8');
  fs.chmodSync(keystorePath, 0o600);
  return keystorePath;
}

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

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function withRpcServer(handler, fn) {
  const server = http.createServer(handler);
  await listen(server);
  const rpcUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(rpcUrl);
  } finally {
    await close(server);
  }
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
    ['external-signer', 'local-env', 'local-keystore', 'read-only'],
  );
  assert.deepEqual(sortStrings(capabilitiesEnvelope.data.policyProfiles.signerProfiles.placeholderBackends), []);
  assert.equal(capabilitiesEnvelope.data.policyProfiles.signerProfiles.readyBuiltinIds.includes('market_observer_ro'), true);
  assert.equal(capabilitiesEnvelope.data.policyProfiles.signerProfiles.pendingBuiltinIds.includes('prod_trader_a'), true);
  assert.equal(capabilitiesEnvelope.data.policyProfiles.signerProfiles.pendingBuiltinIds.includes('dev_keystore_operator'), true);
  assert.equal(capabilitiesEnvelope.data.policyProfiles.signerProfiles.pendingBuiltinIds.includes('desk_signer_service'), true);
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

test('bootstrap emits canonical policy/profile recommendations and machine-usable cold-start outputs', (t) => {
  const { env } = createIsolatedPolicyProfileEnv(t);
  const bootstrapEnvelope = parseJsonOutput(runCli(['--output', 'json', 'bootstrap'], { env }));
  const capabilitiesEnvelope = parseJsonOutput(runCli(['--output', 'json', 'capabilities'], { env }));

  assert.equal(bootstrapEnvelope.command, 'bootstrap');
  assert.equal(bootstrapEnvelope.data.preferences.canonicalOnlyDefault, true);
  assert.equal(bootstrapEnvelope.data.preferences.recommendedFirstCall, 'bootstrap');
  assertCanonicalToolFirstCommandSet(
    capabilitiesEnvelope.data.commandDigests,
    ['bootstrap', 'policy.list', 'policy.get', 'profile.get', 'profile.explain'],
  );
  assertBootstrapPolicyProfileRecommendations(
    bootstrapEnvelope.data,
    capabilitiesEnvelope.data.commandDigests,
    { expectedMutableProfileId: null },
  );
  assert.ok(
    bootstrapEnvelope.data.nextSteps.some(
      (step) => step.id === 'list-policies'
        && step.command === 'pandora --output json policy list',
    ),
    'bootstrap should recommend policy.list as the canonical policy recommendation surface',
  );
  assert.ok(
    bootstrapEnvelope.data.nextSteps.some(
      (step) => step.id === 'inspect-read-only-profile'
        && step.command === 'pandora --output json profile get --id market_observer_ro',
    ),
    'bootstrap should recommend profile.get for the canonical read-only profile surface',
  );
  assert.ok(
    bootstrapEnvelope.data.warnings.some((warning) => warning.code === 'NO_RUNTIME_READY_MUTABLE_PROFILE'),
    'bootstrap should surface the missing mutable-profile recommendation as a warning, not a phantom command',
  );
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
  assert.equal(keystore.backendImplemented, true);
  assert.equal(typeof keystore.resolutionStatus, 'string');

  const profileGet = parseJsonOutput(runCli(['--output', 'json', 'profile', 'get', '--id', 'market_observer_ro'], { env }));
  assert.equal(profileGet.command, 'profile.get');
  assert.equal(profileGet.data.profile.id, 'market_observer_ro');
  assert.equal(profileGet.data.profile.defaultPolicy, 'research-only');
});

test('policy get returns machine-usable remediation that explains the current read-only policy posture', (t) => {
  const { env } = createIsolatedPolicyProfileEnv(t);
  const policyGet = parseJsonOutput(runCli(['--output', 'json', 'policy', 'get', '--id', 'research-only'], { env }));

  assert.equal(policyGet.command, 'policy.get');
  assertResearchOnlyPolicyExplanation(policyGet.data.item);
});

test('policy explain is canonical-tool-first and returns machine-usable remediation for exact denied execution contexts', (t) => {
  const { env } = createIsolatedPolicyProfileEnv(t);
  const envelope = parseJsonOutput(runCli([
    '--output', 'json',
    'policy', 'explain',
    '--id', 'research-only',
    '--command', 'trade.execute',
    '--mode', 'execute',
    '--chain-id', '1',
    '--category', 'Crypto',
    '--profile-id', 'market_observer_ro',
  ], { env }));

  assert.equal(envelope.command, 'policy.explain');
  assert.equal(envelope.data.explanation.policyId, 'research-only');
  assert.equal(envelope.data.explanation.requestedContext.command, 'trade.execute');
  assert.equal(envelope.data.explanation.requestedContext.canonicalTool, 'trade');
  assert.equal(envelope.data.explanation.requestedContext.aliasOf, 'trade');
  assert.equal(envelope.data.explanation.usable, false);
  assert.ok(Array.isArray(envelope.data.explanation.denials));
  assert.ok(envelope.data.explanation.denials.some((item) => item.code === 'POLICY_RESEARCH_ONLY_MUTATION_DENIED'));
  assert.ok(
    envelope.data.explanation.remediation.some((step) =>
      step.code === 'USE_CANONICAL_TOOL'
      && step.command === 'trade'
      && step.aliasOf === 'trade'),
  );
  assert.ok(
    envelope.data.explanation.remediation.some((step) =>
      step.code === 'RUN_PREFLIGHT'
      && step.command === 'quote'),
  );
});

test('policy recommend ranks canonical-tool-first recommendations and exposes exact-context summary fields', (t) => {
  const { env } = createIsolatedPolicyProfileEnv(t);
  const envelope = parseJsonOutput(runCli([
    '--output', 'json',
    'policy', 'recommend',
    '--command', 'trade.execute',
    '--mode', 'execute',
    '--chain-id', '1',
    '--category', 'Crypto',
    '--profile-id', 'prod_trader_a',
  ], { env }));

  assert.equal(envelope.command, 'policy.recommend');
  assert.equal(envelope.data.requestedContext.command, 'trade.execute');
  assert.equal(envelope.data.requestedContext.canonicalTool, 'trade');
  assert.equal(envelope.data.exact, true);
  assert.ok(envelope.data.count >= 1);
  assert.equal(envelope.data.compatibleCount, 0);
  assert.equal(envelope.data.recommendedReadOnlyPolicyId, 'research-only');
  assert.equal(typeof envelope.data.recommendedMutablePolicyId, 'string');
  assert.equal(typeof envelope.data.recommendedPolicyId, 'string');
  assert.ok(envelope.data.items.every((item) => item.canonicalTool === 'trade'));
  assert.ok(
    envelope.data.diagnostics.some((item) => item.code === 'USE_CANONICAL_TOOL' && item.command === 'trade'),
  );
  assert.ok(envelope.data.safestMatch);
  assert.equal(envelope.data.bestMatchForRequestedContext, null);
});

test('policy explain returns structured denials and remediation over the CLI', (t) => {
  const { env } = createIsolatedPolicyProfileEnv(t);
  const envelope = parseJsonOutput(runCli([
    '--output', 'json',
    'policy', 'explain',
    '--id', 'paper-trading',
    '--command', 'trade.execute',
    '--mode', 'execute',
    '--secret-source', 'direct',
  ], { env }));

  assert.equal(envelope.command, 'policy.explain');
  assert.equal(envelope.data.item.id, 'paper-trading');
  assert.equal(envelope.data.explanation.usable, false);
  assert.equal(envelope.data.explanation.decision, 'deny');
  assert.equal(
    envelope.data.explanation.blockers.some((item) => item.code === 'POLICY_PAPER_TRADING_SAFE_MODE_REQUIRED'),
    true,
  );
  assert.equal(
    envelope.data.explanation.blockers.some((item) => item.code === 'POLICY_PAPER_TRADING_LIVE_DENIED'),
    true,
  );
  assert.equal(
    envelope.data.explanation.blockers.some((item) => item.code === 'POLICY_PAPER_TRADING_SECRET_DENIED'),
    true,
  );
  assert.equal(
    envelope.data.explanation.remediation.some((item) => item.type === 'set_input' && item.field === 'paper'),
    true,
  );
  assert.equal(
    envelope.data.explanation.remediation.some((item) => item.type === 'use_profile' && item.profileId === 'market_observer_ro'),
    true,
  );
});

test('policy recommend ranks policy packs for a validated live execution context', (t) => {
  const { env } = createIsolatedPolicyProfileEnv(t);
  const envelope = parseJsonOutput(runCli([
    '--output', 'json',
    'policy', 'recommend',
    '--command', 'mirror.deploy.execute',
    '--mode', 'execute',
    '--validation-ticket', 'ticket-123',
    '--validation-decision', 'PASS',
    '--agent-preflight',
    '--notional-usdc', '800',
  ], { env }));

  assert.equal(envelope.command, 'policy.recommend');
  assert.equal(envelope.data.recommendedPolicyId, 'execute-with-validation');
  assert.equal(envelope.data.recommended.id, 'execute-with-validation');
  assert.equal(envelope.data.candidates[0].id, 'execute-with-validation');
  const riskCap = envelope.data.candidates.find((item) => item.id === 'execute-with-risk-cap');
  assert.ok(riskCap, 'execute-with-risk-cap should be evaluated');
  assert.equal(riskCap.usable, false);
  assert.equal(
    riskCap.denials.some((item) => item.code === 'POLICY_RISK_CAP_NOTIONAL_EXCEEDED'),
    true,
  );
});

test('profile get surfaces degraded readiness for keystore and external signer samples', (t) => {
  const { env, rootDir } = createIsolatedPolicyProfileEnv(t);

  const keystore = parseJsonOutput(runCli(['--output', 'json', 'profile', 'get', '--id', 'dev_keystore_operator'], { env }));
  assert.equal(keystore.command, 'profile.get');
  assert.equal(keystore.data.profile.id, 'dev_keystore_operator');
  assert.equal(keystore.data.resolution.status, 'missing-keystore');
  assert.equal(keystore.data.resolution.ready, false);
  assert.equal(keystore.data.resolution.backendImplemented, true);
  assert.equal(keystore.data.resolution.secretSource.kind, 'file');
  assert.equal(keystore.data.resolution.secretSource.exists, false);
  assert.equal(
    keystore.data.resolution.secretSource.path,
    path.join(rootDir, 'home', '.pandora', 'keys', 'dev_keystore_operator.json'),
  );

  const externalSigner = parseJsonOutput(runCli(['--output', 'json', 'profile', 'get', '--id', 'desk_signer_service'], { env }));
  assert.equal(externalSigner.command, 'profile.get');
  assert.equal(externalSigner.data.profile.id, 'desk_signer_service');
  assert.equal(externalSigner.data.resolution.status, 'missing-context');
  assert.equal(externalSigner.data.resolution.ready, false);
  assert.equal(externalSigner.data.resolution.backendImplemented, true);
  assert.equal(externalSigner.data.resolution.secretSource.kind, 'external-signer');
  assert.equal(externalSigner.data.resolution.secretSource.reference, 'signer://desk-signer-service');
  assert.ok(
    externalSigner.data.resolution.missingContext.includes('PANDORA_EXTERNAL_SIGNER_URL')
      || externalSigner.data.resolution.missingContext.includes('EXTERNAL_SIGNER_URL'),
  );
});

test('built-in mutable profiles stay non-ready by default across capabilities, profile list, and profile get', (t) => {
  const { env } = createIsolatedPolicyProfileEnv(t);
  const capabilities = parseJsonOutput(runCli(['--output', 'json', 'capabilities'], { env }));
  const profileList = parseJsonOutput(runCli(['--output', 'json', 'profile', 'list'], { env }));
  const itemsById = new Map(profileList.data.items.map((item) => [item.id, item]));
  const expectedMutableBuiltinIds = ['desk_signer_service', 'dev_keystore_operator', 'prod_trader_a'];

  assert.deepEqual(
    sortStrings(capabilities.data.policyProfiles.signerProfiles.readyBuiltinIds),
    ['market_observer_ro'],
  );
  assert.deepEqual(
    sortStrings(capabilities.data.policyProfiles.signerProfiles.degradedBuiltinIds),
    expectedMutableBuiltinIds,
  );
  assert.deepEqual(
    sortStrings(capabilities.data.policyProfiles.signerProfiles.pendingBuiltinIds),
    expectedMutableBuiltinIds,
  );

  for (const profileId of expectedMutableBuiltinIds) {
    const item = itemsById.get(profileId);
    assert.ok(item, `profile list should include ${profileId}`);
    assert.equal(item.readOnly, false, `${profileId} should remain mutable`);
    assert.equal(item.backendImplemented, true, `${profileId} should expose an implemented backend`);
    assert.equal(item.runtimeReady, false, `${profileId} should not be runtime-ready by default`);
    assert.notEqual(item.resolutionStatus, 'ready', `${profileId} should not report ready status by default`);
  }

  const prodTrader = parseJsonOutput(runCli(['--output', 'json', 'profile', 'get', '--id', 'prod_trader_a'], { env }));
  assert.equal(prodTrader.command, 'profile.get');
  assert.equal(prodTrader.data.resolution.status, 'missing-secrets');
  assert.equal(prodTrader.data.resolution.ready, false);
  assert.equal(prodTrader.data.resolution.backendImplemented, true);
  assert.ok(
    prodTrader.data.resolution.notes.some((note) => /private key/i.test(note)),
    'prod_trader_a should explain the missing local-env signer material.',
  );
});

test('profile recommend returns exact-context mutable recommendations when runtime-local readiness is satisfied', async (t) => {
  const { env, rootDir } = createIsolatedPolicyProfileEnv(t);
  writeBuiltinKeystoreFixture(rootDir);

  await withRpcServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }
    const payload = JSON.parse(body);
    if (payload.method === 'eth_chainId') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: '0x1' }));
      return;
    }
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'unexpected method' }));
  }, async (rpcUrl) => {
    const readyEnv = {
      ...env,
      PANDORA_PRIVATE_KEY: `0x${'33'.repeat(32)}`,
      RPC_URL: rpcUrl,
      CHAIN_ID: '1',
      PANDORA_KEYSTORE_PASSWORD: BUILTIN_KEYSTORE_PASSWORD,
      PANDORA_EXTERNAL_SIGNER_URL: 'https://signer.example.invalid',
      PANDORA_EXTERNAL_SIGNER_TOKEN: 'secret-token',
      PANDORA_EXTERNAL_SIGNER_WALLET: BUILTIN_EXTERNAL_SIGNER_ADDRESS,
    };

    const envelope = parseJsonOutput(runCli([
      '--output', 'json',
      'profile', 'recommend',
      '--command', 'trade.execute',
      '--mode', 'execute',
      '--chain-id', '1',
      '--category', 'Crypto',
      '--policy-id', 'execute-with-validation',
    ], { env: readyEnv }));

    assert.equal(envelope.command, 'profile.recommend');
    assert.equal(envelope.data.requestedContext.command, 'trade.execute');
    assert.equal(envelope.data.requestedContext.canonicalTool, 'trade');
    assert.equal(envelope.data.exact, true);
    assert.ok(envelope.data.count >= 1);
    assert.ok(envelope.data.compatibleCount >= 1);
    assert.equal(envelope.data.recommendedReadOnlyProfileId, 'market_observer_ro');
    assert.equal(typeof envelope.data.recommendedMutableProfileId, 'string');
    assert.equal(typeof envelope.data.recommendedProfileId, 'string');
    assert.ok(envelope.data.items.some((item) => item.id === 'prod_trader_a' && item.usable === true));
    assert.ok(envelope.data.items.every((item) => item.canonicalTool === 'trade'));
    assert.ok(
      envelope.data.diagnostics.some((item) => item.code === 'USE_CANONICAL_TOOL' && item.command === 'trade'),
    );
    assert.ok(envelope.data.safestMatch);
    assert.ok(envelope.data.bestMatchForRequestedContext);
  });
});

test('runtime-local capabilities and profile list promote prod_trader_a only after signer material and rpc chain checks pass', async (t) => {
  const { env } = createIsolatedPolicyProfileEnv(t);

  await withRpcServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }
    const payload = JSON.parse(body);
    assert.equal(payload.method, 'eth_chainId');
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      id: payload.id,
      result: '0x1',
    }));
  }, async (rpcUrl) => {
    const readyEnv = {
      ...env,
      PANDORA_PRIVATE_KEY: `0x${'33'.repeat(32)}`,
      RPC_URL: rpcUrl,
      CHAIN_ID: '1',
    };

    const capabilities = parseJsonOutput(await runCliAsync(['--output', 'json', 'capabilities', '--runtime-local-readiness'], { env: readyEnv }));
    const profileList = parseJsonOutput(await runCliAsync(['--output', 'json', 'profile', 'list'], { env: readyEnv }));
    const prodTrader = parseJsonOutput(await runCliAsync(['--output', 'json', 'profile', 'get', '--id', 'prod_trader_a'], { env: readyEnv }));
    const prodListItem = profileList.data.items.find((item) => item.id === 'prod_trader_a');

    assert.ok(capabilities.data.policyProfiles.signerProfiles.readyBuiltinIds.includes('prod_trader_a'));
    assert.ok(!capabilities.data.policyProfiles.signerProfiles.pendingBuiltinIds.includes('prod_trader_a'));
    assert.ok(!capabilities.data.policyProfiles.signerProfiles.degradedBuiltinIds.includes('prod_trader_a'));
    assert.ok(prodListItem, 'profile list should include prod_trader_a');
    assert.equal(prodListItem.runtimeReady, true);
    assert.equal(prodListItem.resolutionStatus, 'ready');
    assert.equal(prodTrader.data.resolution.ready, true);
    assert.equal(prodTrader.data.resolution.status, 'ready');
    assert.equal(prodTrader.data.resolution.chainId, 1);
    assert.equal(prodTrader.data.resolution.rpcUrl, rpcUrl);
    assert.equal(prodTrader.data.resolution.activeCheck.kind, 'rpc-chain');
    assert.equal(prodTrader.data.resolution.activeCheck.ok, true);
  });
});

test('runtime-local capabilities keep the built-in external signer sample non-ready when active signer probing is unauthorized', async (t) => {
  const { env } = createIsolatedPolicyProfileEnv(t);

  await withRpcServer(async (_req, res) => {
    res.statusCode = 401;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized external signer request.',
      },
    }));
  }, async (signerUrl) => {
    const signerEnv = {
      ...env,
      PANDORA_EXTERNAL_SIGNER_URL: signerUrl,
      RPC_URL: 'http://127.0.0.1:8545',
      CHAIN_ID: '1',
    };

    const capabilities = parseJsonOutput(await runCliAsync(['--output', 'json', 'capabilities', '--runtime-local-readiness'], { env: signerEnv }));
    const profileGet = parseJsonOutput(await runCliAsync(['--output', 'json', 'profile', 'get', '--id', 'desk_signer_service'], { env: signerEnv }));

    assert.ok(!capabilities.data.policyProfiles.signerProfiles.readyBuiltinIds.includes('desk_signer_service'));
    assert.ok(capabilities.data.policyProfiles.signerProfiles.degradedBuiltinIds.includes('desk_signer_service'));
    assert.ok(capabilities.data.policyProfiles.signerProfiles.pendingBuiltinIds.includes('desk_signer_service'));
    assert.equal(profileGet.data.resolution.ready, false);
    assert.equal(profileGet.data.resolution.status, 'error');
    assert.equal(profileGet.data.resolution.backendImplemented, true);
    assert.equal(profileGet.data.resolution.secretSource.kind, 'external-signer');
    assert.equal(profileGet.data.resolution.secretSource.reference, 'signer://desk-signer-service');
    assert.ok(
      profileGet.data.resolution.notes.some((note) => /unauthorized|401/i.test(note)),
      'desk_signer_service should surface the failed active probe instead of claiming readiness.',
    );
  });
});


test('runtime-local capabilities promote dev_keystore_operator when the built-in keystore profile has a valid keystore, password, and rpc context', async (t) => {
  const { rootDir, env } = createIsolatedPolicyProfileEnv(t);
  writeBuiltinKeystoreFixture(rootDir);

  await withRpcServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }
    const payload = JSON.parse(body);
    assert.equal(payload.method, 'eth_chainId');
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      id: payload.id,
      result: '0x1',
    }));
  }, async (rpcUrl) => {
    const readyEnv = {
      ...env,
      PANDORA_KEYSTORE_PASSWORD: BUILTIN_KEYSTORE_PASSWORD,
      RPC_URL: rpcUrl,
      CHAIN_ID: '1',
    };

    const capabilities = parseJsonOutput(await runCliAsync(['--output', 'json', 'capabilities', '--runtime-local-readiness'], { env: readyEnv }));
    const profileList = parseJsonOutput(await runCliAsync(['--output', 'json', 'profile', 'list'], { env: readyEnv }));
    const profileGet = parseJsonOutput(await runCliAsync(['--output', 'json', 'profile', 'get', '--id', 'dev_keystore_operator'], { env: readyEnv }));
    const explain = parseJsonOutput(await runCliAsync([
      '--output', 'json', 'profile', 'explain',
      '--id', 'dev_keystore_operator',
      '--command', 'trade.execute',
      '--mode', 'execute',
      '--chain-id', '1',
      '--category', 'Sports',
      '--policy-id', 'execute-with-validation',
    ], { env: readyEnv }));
    const listItem = profileList.data.items.find((item) => item.id === 'dev_keystore_operator');

    assert.ok(capabilities.data.policyProfiles.signerProfiles.readyBuiltinIds.includes('dev_keystore_operator'));
    assert.ok(!capabilities.data.policyProfiles.signerProfiles.degradedBuiltinIds.includes('dev_keystore_operator'));
    assert.ok(!capabilities.data.policyProfiles.signerProfiles.pendingBuiltinIds.includes('dev_keystore_operator'));
    assert.ok(listItem, 'profile list should include dev_keystore_operator');
    assert.equal(listItem.runtimeReady, true);
    assert.equal(listItem.resolutionStatus, 'ready');
    assert.equal(profileGet.data.resolution.ready, true);
    assert.equal(profileGet.data.resolution.status, 'ready');
    assert.equal(profileGet.data.resolution.wallet, BUILTIN_KEYSTORE_ADDRESS);
    assert.equal(profileGet.data.resolution.activeCheck.kind, 'rpc-chain');
    assert.equal(profileGet.data.resolution.activeCheck.ok, true);
    assert.equal(explain.data.explanation.usable, true);
    assert.equal(explain.data.resolution.ready, true);
  });
});

test('runtime-local capabilities promote desk_signer_service when the built-in external signer profile passes health and account checks', async (t) => {
  const { env } = createIsolatedPolicyProfileEnv(t);

  await withRpcServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        data: {
          healthy: true,
          protocolVersion: 'pandora-external-signer/v1',
          methods: ['signTransaction', 'signTypedData'],
          chainIds: [1],
        },
      }));
      return;
    }
    if (req.method === 'GET' && req.url === '/accounts?chainId=1') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        data: {
          protocolVersion: 'pandora-external-signer/v1',
          methods: ['signTransaction', 'signTypedData'],
          chainIds: [1],
          accounts: [
            {
              address: BUILTIN_EXTERNAL_SIGNER_ADDRESS,
              chainIds: [1],
              methods: ['signTransaction', 'signTypedData'],
            },
          ],
        },
      }));
      return;
    }
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'not found' } }));
  }, async (signerUrl) => {
    const signerEnv = {
      ...env,
      PANDORA_EXTERNAL_SIGNER_URL: signerUrl,
      PANDORA_EXTERNAL_SIGNER_TOKEN: 'secret-token',
      RPC_URL: 'https://rpc.example.invalid',
      CHAIN_ID: '1',
    };

    const capabilities = parseJsonOutput(await runCliAsync(['--output', 'json', 'capabilities', '--runtime-local-readiness'], { env: signerEnv }));
    const profileList = parseJsonOutput(await runCliAsync(['--output', 'json', 'profile', 'list'], { env: signerEnv }));
    const profileGet = parseJsonOutput(await runCliAsync(['--output', 'json', 'profile', 'get', '--id', 'desk_signer_service'], { env: signerEnv }));
    const explain = parseJsonOutput(await runCliAsync([
      '--output', 'json', 'profile', 'explain',
      '--id', 'desk_signer_service',
      '--command', 'mirror.deploy',
      '--mode', 'execute',
      '--chain-id', '1',
      '--category', 'Sports',
      '--policy-id', 'execute-with-validation',
    ], { env: signerEnv }));
    const listItem = profileList.data.items.find((item) => item.id === 'desk_signer_service');

    assert.ok(capabilities.data.policyProfiles.signerProfiles.readyBuiltinIds.includes('desk_signer_service'));
    assert.ok(!capabilities.data.policyProfiles.signerProfiles.degradedBuiltinIds.includes('desk_signer_service'));
    assert.ok(!capabilities.data.policyProfiles.signerProfiles.pendingBuiltinIds.includes('desk_signer_service'));
    assert.ok(listItem, 'profile list should include desk_signer_service');
    assert.equal(listItem.runtimeReady, true);
    assert.equal(listItem.resolutionStatus, 'ready');
    assert.equal(profileGet.data.resolution.ready, true);
    assert.equal(profileGet.data.resolution.status, 'ready');
    assert.equal(profileGet.data.resolution.wallet, BUILTIN_EXTERNAL_SIGNER_ADDRESS.toLowerCase());
    assert.equal(profileGet.data.resolution.activeCheck.kind, 'external-signer');
    assert.equal(profileGet.data.resolution.activeCheck.ok, true);
    assert.equal(explain.data.explanation.usable, true);
    assert.equal(explain.data.resolution.ready, true);
  });
});

test('profile validate and profile explain succeed when a local-env signer profile is truly runtime-ready', async (t) => {
  const { rootDir, env } = createIsolatedPolicyProfileEnv(t);
  const filePath = path.join(rootDir, 'profiles.json');
  fs.writeFileSync(filePath, JSON.stringify({
    profiles: [
      {
        id: 'desk_local',
        displayName: 'Desk Local',
        description: 'Local env signer for recipe execution.',
        signerBackend: 'local-env',
        approvalMode: 'manual',
        chainAllowlist: [1],
        categoryAllowlist: ['Crypto'],
        toolFamilyAllowlist: ['mirror'],
        defaultPolicy: 'execute-with-validation',
        allowedPolicies: ['execute-with-validation'],
      },
    ],
  }));

  await withRpcServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }
    const payload = JSON.parse(body);
    assert.equal(payload.method, 'eth_chainId');
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      id: payload.id,
      result: '0x1',
    }));
  }, async (rpcUrl) => {
    const readyEnv = {
      ...env,
      PANDORA_PRIVATE_KEY: `0x${'22'.repeat(32)}`,
      RPC_URL: rpcUrl,
      CHAIN_ID: '1',
    };

    const validate = parseJsonOutput(await runCliAsync(['--output', 'json', 'profile', 'validate', '--file', filePath], { env: readyEnv }));
    assert.equal(validate.command, 'profile.validate');
    assert.equal(validate.data.valid, true);
    assert.equal(validate.data.runtimeReady, true);
    assert.equal(validate.data.runtimeReadyCount, 1);
    assert.equal(validate.data.items[0].runtimeReady, true);
    assert.equal(validate.data.items[0].resolutionStatus, 'ready');
    assert.equal(validate.data.resolutions[0].secretSource.kind, 'env');
    assert.equal(validate.data.resolutions[0].secretSource.envVar, 'PANDORA_PRIVATE_KEY');
    assert.equal(validate.data.resolutions[0].chainId, 1);
    assert.equal(validate.data.resolutions[0].rpcUrl, rpcUrl);
    assert.equal(validate.data.resolutions[0].activeCheck.ok, true);

    const explain = parseJsonOutput(await runCliAsync([
      '--output', 'json', 'profile', 'explain',
      '--id', 'prod_trader_a',
      '--command', 'trade.execute',
      '--mode', 'execute',
      '--chain-id', '1',
      '--category', 'Crypto',
      '--policy-id', 'execute-with-validation',
    ], { env: readyEnv }));
    assert.equal(explain.command, 'profile.explain');
    assert.equal(explain.data.explanation.usable, true);
    assert.equal(explain.data.explanation.activeCheckPerformed, true);
    assert.equal(explain.data.resolution.ready, true);
  });
});

test('profile validate keeps schema-valid signer backends out of runtime-ready state when runtime prerequisites are missing', (t) => {
  const { rootDir, env } = createIsolatedPolicyProfileEnv(t);
  const keystorePath = path.join(rootDir, 'operator-keystore.json');
  fs.writeFileSync(keystorePath, JSON.stringify({ encrypted: true }));
  fs.chmodSync(keystorePath, 0o600);
  const filePath = path.join(rootDir, 'profiles.json');
  fs.writeFileSync(filePath, JSON.stringify({
    profiles: [
      {
        id: 'keystore_operator',
        displayName: 'Keystore Operator',
        description: 'Keystore-backed placeholder.',
        signerBackend: 'local-keystore',
        approvalMode: 'manual',
        chainAllowlist: [1],
        categoryAllowlist: ['Sports'],
        toolFamilyAllowlist: ['trade'],
        defaultPolicy: 'execute-with-validation',
        allowedPolicies: ['execute-with-validation'],
        secretRef: {
          path: keystorePath,
        },
      },
      {
        id: 'external_service',
        displayName: 'External Signer Service',
        description: 'External signer placeholder.',
        signerBackend: 'external-signer',
        approvalMode: 'external',
        chainAllowlist: [1],
        categoryAllowlist: ['Sports'],
        toolFamilyAllowlist: ['trade'],
        defaultPolicy: 'execute-with-validation',
        allowedPolicies: ['execute-with-validation'],
        secretRef: {
          reference: 'signer://desk-service',
        },
      },
    ],
  }));

  const envelope = parseJsonOutput(runCli(['--output', 'json', 'profile', 'validate', '--file', filePath], { env }));
  assert.equal(envelope.command, 'profile.validate');
  assert.equal(envelope.data.valid, true);
  assert.equal(envelope.data.runtimeReady, false);
  assert.equal(envelope.data.runtimeReadyCount, 0);
  assert.equal(envelope.data.items[0].runtimeReady, false);
  assert.equal(envelope.data.items[0].resolutionStatus, 'missing-secrets');
  assert.equal(envelope.data.items[1].runtimeReady, false);
  assert.equal(envelope.data.items[1].resolutionStatus, 'missing-context');
  assert.equal(envelope.data.resolutions[0].backendImplemented, true);
  assert.equal(envelope.data.resolutions[0].secretSource.kind, 'file');
  assert.equal(envelope.data.resolutions[0].secretSource.exists, true);
  assert.equal(envelope.data.resolutions[1].backendImplemented, true);
  assert.equal(envelope.data.resolutions[1].secretSource.kind, 'external-signer');
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
