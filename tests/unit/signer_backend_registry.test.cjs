const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SIGNER_BACKEND_RESOLUTION_STATUSES,
  createSignerBackendRegistry,
  defineSignerBackend,
  normalizeSignerBackendResolution,
} = require('../../cli/lib/signers/index.cjs');

test('signer backend registry normalizes definitions, aliases, and cached runtime loads', () => {
  let loadCalls = 0;
  const registry = createSignerBackendRegistry({
    definitions: [
      {
        id: 'local-keystore',
        aliases: ['keystore', 'LOCAL-KEYSTORE'],
        displayName: 'Local Keystore',
        description: 'File-backed keystore signer.',
        profileBackends: ['local-keystore'],
        secretRefKinds: ['file'],
        approvalModes: ['manual', 'policy-gated'],
        implemented: false,
        load({ definition, context }) {
          loadCalls += 1;
          assert.equal(definition.id, 'local-keystore');
          assert.deepEqual(context, { lane: 'test' });
          return {
            resolveProfile(profile) {
              return { backend: definition.id, status: 'pending-integration', notes: [profile.id] };
            },
          };
        },
      },
    ],
  });

  assert.equal(registry.has('keystore'), true);
  assert.equal(registry.resolveId('LOCAL-KEYSTORE'), 'local-keystore');
  assert.equal(registry.get('local-keystore').supportsSecretMaterial, true);
  assert.deepEqual(registry.list().map((item) => item.id), ['local-keystore']);

  const runtimeA = registry.load('keystore', { context: { lane: 'test' } });
  const runtimeB = registry.load('local-keystore');
  assert.equal(runtimeA, runtimeB);
  assert.equal(loadCalls, 1);
  assert.equal(typeof runtimeA.resolveProfile, 'function');
  assert.equal(runtimeA.normalizeSecretRef, null);
});

test('signer backend helpers normalize backend definitions and resolution payloads', () => {
  const definition = defineSignerBackend({
    id: 'external-signer',
    displayName: 'Desk Signer',
    profileBackends: ['external-signer'],
    secretRefKinds: ['external-signer'],
    approvalModes: ['external'],
    requiresNetworkContext: true,
  });
  assert.equal(definition.id, 'external-signer');
  assert.equal(definition.requiresNetworkContext, true);
  assert.equal(definition.supportsSecretMaterial, true);

  const resolution = normalizeSignerBackendResolution({
    backend: 'external-signer',
    status: 'pending-integration',
    configured: true,
    secretSource: {
      kind: 'external-signer',
      reference: 'signer://desk',
    },
    missingSecrets: [],
    missingContext: ['RPC_URL'],
    missing: ['RPC_URL', 'CHAIN_ID'],
    notes: ['waiting on transport'],
  });

  assert.equal(SIGNER_BACKEND_RESOLUTION_STATUSES.includes(resolution.status), true);
  assert.equal(resolution.backend, 'external-signer');
  assert.deepEqual(resolution.missing, ['CHAIN_ID', 'RPC_URL']);
  assert.deepEqual(resolution.secretSource, {
    kind: 'external-signer',
    reference: 'signer://desk',
  });
});

test('signer backend registry rejects duplicate aliases and invalid backend ids', () => {
  const registry = createSignerBackendRegistry();
  registry.register({
    id: 'local-keystore',
    aliases: ['keystore'],
    displayName: 'Local Keystore',
    profileBackends: ['local-keystore'],
  });

  assert.throws(
    () => registry.register({
      id: 'external-signer',
      aliases: ['keystore'],
      displayName: 'External',
      profileBackends: ['external-signer'],
    }),
    /already registered/i,
  );

  assert.throws(
    () => defineSignerBackend({
      id: 'desk',
      displayName: 'Desk',
      profileBackends: ['not-a-backend'],
    }),
    /profileBackends must contain only/i,
  );
});
