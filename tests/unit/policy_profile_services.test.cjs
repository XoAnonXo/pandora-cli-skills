const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createPolicyRegistryService } = require('../../cli/lib/policy_registry_service.cjs');
const { createPolicyEvaluatorService } = require('../../cli/lib/policy_evaluator_service.cjs');
const { createProfileStore } = require('../../cli/lib/profile_store.cjs');
const { createProfileResolverService } = require('../../cli/lib/profile_resolver_service.cjs');
const { POLICY_PACK_KIND, POLICY_SCHEMA_VERSION } = require('../../cli/lib/shared/policy_constants.cjs');

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('policy registry lists built-in packs and lints user files', () => {
  withTempDir('pandora-policy-', (dir) => {
    const policiesDir = path.join(dir, 'policies');
    fs.mkdirSync(policiesDir, { recursive: true });
    const filePath = path.join(policiesDir, 'custom.json');
    fs.writeFileSync(filePath, JSON.stringify({
      schemaVersion: POLICY_SCHEMA_VERSION,
      kind: POLICY_PACK_KIND,
      id: 'custom-safe',
      version: '1.0.0',
      displayName: 'Custom Safe',
      description: 'Custom pack.',
      rules: [
        {
          id: 'deny-live',
          kind: 'deny_live_execution',
          result: {
            code: 'CUSTOM_LIVE_DENIED',
            message: 'deny live',
          },
        },
      ],
    }));

    const registry = createPolicyRegistryService({ rootDir: policiesDir });
    const listing = registry.listPolicyPacks();
    assert.equal(listing.builtinCount >= 5, true);
    assert.equal(listing.items.some((item) => item.id === 'custom-safe'), true);

    const lint = registry.lintPolicyPackFile(filePath);
    assert.equal(lint.ok, true);
    assert.equal(lint.item.id, 'custom-safe');
  });
});

test('policy evaluator denies live execution for paper-trading and requires validation for execute-with-validation', () => {
  const evaluator = createPolicyEvaluatorService();

  const paper = evaluator.evaluateExecution({
    policyId: 'paper-trading',
    command: 'trade.execute',
    mode: 'execute',
    live: true,
    profileId: 'paper-local',
  });
  assert.equal(paper.ok, false);
  assert.equal(paper.violations.some((item) => item.code === 'POLICY_PAPER_TRADING_LIVE_DENIED'), true);

  const validated = evaluator.evaluateExecution({
    policyId: 'execute-with-validation',
    command: 'mirror.deploy.execute',
    mode: 'execute',
    live: true,
    profileId: 'local-env-default',
    hasValidationTicket: false,
    hasAgentPreflight: false,
    validationSupported: true,
  });
  assert.equal(validated.ok, false);
  assert.equal(validated.violations.some((item) => item.code === 'POLICY_EXECUTE_VALIDATION_REQUIRED'), true);
  assert.equal(validated.violations.some((item) => item.code === 'POLICY_EXECUTE_PREFLIGHT_REQUIRED'), true);
});

test('policy evaluator respects command prefixes, nested agentPreflight, and warn semantics', () => {
  const registry = createPolicyRegistryService();
  const evaluator = createPolicyEvaluatorService({ policyRegistry: registry });

  const denyViaPrefix = evaluator.evaluateExecution({
    policyId: 'market-creation-conservative',
    command: 'mirror.sync.run',
    mode: 'execute',
    live: true,
    hasValidationTicket: true,
    validationDecision: 'PASS',
  });
  assert.equal(denyViaPrefix.ok, false);
  assert.equal(denyViaPrefix.violations.some((item) => item.code === 'POLICY_MARKET_CREATION_COMMAND_DENIED'), true);

  const inlineWarnRegistry = {
    getPolicyPack(id) {
      if (id !== 'warn-only') return null;
      return {
        id: 'warn-only',
        compiledRules: [
          {
            id: 'warn-live',
            kind: 'deny_live_execution',
            effect: 'warn',
            result: { code: 'WARN_LIVE', message: 'live requested' },
          },
        ],
      };
    },
  };
  const warnEvaluator = createPolicyEvaluatorService({ policyRegistry: inlineWarnRegistry });
  const warned = warnEvaluator.evaluateExecution({
    policyId: 'warn-only',
    command: 'trade.execute',
    mode: 'execute',
    live: true,
  });
  assert.equal(warned.ok, true);
  assert.equal(warned.decision, 'warn');
  assert.equal(warned.warnings.some((item) => item.code === 'WARN_LIVE'), true);

  const withPreflight = evaluator.evaluateExecution({
    policyId: 'execute-with-validation',
    command: 'mirror.deploy.execute',
    mode: 'execute',
    live: true,
    validationSupported: true,
    agentPreflight: {
      validationTicket: 'ticket-123',
      validationDecision: 'PASS',
    },
  });
  assert.equal(withPreflight.ok, true);
  assert.equal(withPreflight.violations.some((item) => item.code === 'POLICY_EXECUTE_VALIDATION_REQUIRED'), false);
  assert.equal(withPreflight.violations.some((item) => item.code === 'POLICY_EXECUTE_PREFLIGHT_REQUIRED'), false);
});

test('profile registry lists built-in profiles and validateProfileFile parses custom profiles', () => {
  withTempDir('pandora-profile-', (dir) => {
    const filePath = path.join(dir, 'profiles.json');
    fs.writeFileSync(filePath, JSON.stringify({
      profiles: [
        {
          id: 'desk',
          displayName: 'Desk',
          description: 'Desk profile.',
          signerBackend: 'local-env',
          approvalMode: 'manual',
        },
      ],
    }));

    const store = createProfileStore();
    const listing = store.loadProfileSet({ filePath, includeBuiltIns: true });
    assert.equal(listing.builtInCount >= 4, true);
    assert.equal(listing.items.some((item) => item.id === 'desk'), true);

    const lint = store.validateProfileFile(filePath);
    assert.equal(lint.profileCount, 1);
    assert.equal(lint.profiles[0].id, 'desk');
  });
});

test('profile resolver enforces read-only and policy compatibility', () => {
  const resolver = createProfileResolverService();

  const readOnly = resolver.resolveProfile({
    profileId: 'market_observer_ro',
    command: 'trade.execute',
    includeSecretMaterial: false,
  });
  assert.equal(readOnly.resolution.readOnly, true);
  assert.equal(readOnly.profile.id, 'market_observer_ro');

  const badPolicy = resolver.resolveProfile({
    profileId: 'prod_trader_a',
    policyId: 'research-only',
    command: 'trade.execute',
    chainId: 1,
    category: 'Crypto',
  });
  assert.equal(badPolicy.profile.id, 'prod_trader_a');
  assert.equal(badPolicy.summary.defaultPolicy, 'execute-with-validation');
  assert.equal(badPolicy.compatibility.ok, false);
  assert.equal(badPolicy.compatibility.violations.some((item) => item.code === 'PROFILE_POLICY_NOT_ALLOWED'), true);
});

test('profile resolver requires rpc and chain metadata for local-env readiness', () => {
  const resolver = createProfileResolverService({
    env: {
      PANDORA_PRIVATE_KEY: `0x${'11'.repeat(32)}`,
    },
  });

  const result = resolver.resolveProfile({
    profileId: 'prod_trader_a',
  });
  assert.equal(result.resolution.ready, false);
  assert.equal(result.resolution.missing.includes('RPC_URL'), true);
  assert.equal(result.resolution.missing.includes('CHAIN_ID'), true);
});
