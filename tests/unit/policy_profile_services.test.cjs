const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { createPolicyRegistryService } = require('../../cli/lib/policy_registry_service.cjs');
const { createPolicyEvaluatorService } = require('../../cli/lib/policy_evaluator_service.cjs');
const { createRunPolicyCommand } = require('../../cli/lib/policy_command_service.cjs');
const { createParsePolicyFlags } = require('../../cli/lib/parsers/policy_flags.cjs');
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

class TestCliError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

function requireFlagValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || String(value).startsWith('--')) {
    throw new TestCliError('MISSING_REQUIRED_FLAG', `${flag} requires a value.`, { flag });
  }
  return String(value);
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

test('policy command service explains denials and recommends the least-blocked policy pack', async () => {
  const emitted = [];
  const parsePolicyFlags = createParsePolicyFlags({
    CliError: TestCliError,
    requireFlagValue,
  });
  const runPolicyCommand = createRunPolicyCommand({
    CliError: TestCliError,
    includesHelpFlag: (args = []) => args.includes('--help') || args.includes('-h'),
    emitSuccess: (outputMode, command, data) => emitted.push({ outputMode, command, data }),
    commandHelpPayload: (usage) => ({ usage }),
    parsePolicyFlags,
    createPolicyRegistryService,
    createPolicyEvaluatorService,
  });

  await runPolicyCommand([
    'explain',
    '--id', 'paper-trading',
    '--command', 'trade.execute',
    '--mode', 'execute',
    '--secret-source', 'direct',
  ], { outputMode: 'json' });

  assert.equal(emitted[0].command, 'policy.explain');
  assert.equal(emitted[0].data.item.id, 'paper-trading');
  assert.equal(emitted[0].data.explanation.usable, false);
  assert.equal(emitted[0].data.explanation.decision, 'deny');
  assert.equal(
    emitted[0].data.explanation.blockers.some((item) => item.code === 'POLICY_PAPER_TRADING_SAFE_MODE_REQUIRED'),
    true,
  );
  assert.equal(
    emitted[0].data.explanation.blockers.some((item) => item.code === 'POLICY_PAPER_TRADING_LIVE_DENIED'),
    true,
  );
  assert.equal(
    emitted[0].data.explanation.remediation.some((item) => item.type === 'set_input' && item.field === 'paper'),
    true,
  );

  emitted.length = 0;

  await runPolicyCommand([
    'recommend',
    '--command', 'mirror.deploy.execute',
    '--mode', 'execute',
    '--validation-ticket', 'ticket-123',
    '--validation-decision', 'PASS',
    '--agent-preflight',
    '--notional-usdc', '800',
  ], { outputMode: 'json' });

  assert.equal(emitted[0].command, 'policy.recommend');
  assert.equal(emitted[0].data.recommendedPolicyId, 'execute-with-validation');
  assert.equal(emitted[0].data.recommended.id, 'execute-with-validation');
  assert.equal(emitted[0].data.candidates[0].id, 'execute-with-validation');
  const riskCap = emitted[0].data.candidates.find((item) => item.id === 'execute-with-risk-cap');
  assert.ok(riskCap, 'risk-cap candidate should be present');
  assert.equal(riskCap.usable, false);
  assert.equal(
    riskCap.denials.some((item) => item.code === 'POLICY_RISK_CAP_NOTIONAL_EXCEEDED'),
    true,
  );
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

test('profile resolver rejects malformed local-env private keys and mismatched configured wallets', () => {
  const resolver = createProfileResolverService({
    env: {
      PANDORA_PRIVATE_KEY: 'not-a-private-key',
      RPC_URL: 'https://rpc.example.invalid',
      CHAIN_ID: '1',
    },
  });

  const malformed = resolver.resolveProfile({
    profileId: 'prod_trader_a',
    policyId: 'execute-with-validation',
    command: 'trade.execute',
    chainId: 1,
    category: 'Crypto',
    mode: 'execute',
    liveRequested: true,
  });
  assert.equal(malformed.resolution.ready, false);
  assert.equal(malformed.resolution.status, 'error');
  assert.match(malformed.resolution.notes[0], /malformed/i);

  const mismatched = createProfileResolverService({
    env: {
      PANDORA_PRIVATE_KEY: `0x${'11'.repeat(32)}`,
      RPC_URL: 'https://rpc.example.invalid',
      CHAIN_ID: '1',
      WALLET: '0x9999999999999999999999999999999999999999',
    },
  }).resolveProfile({
    profileId: 'prod_trader_a',
    policyId: 'execute-with-validation',
    command: 'trade.execute',
    chainId: 1,
    category: 'Crypto',
    mode: 'execute',
    liveRequested: true,
  });
  assert.equal(mismatched.resolution.ready, false);
  assert.equal(mismatched.resolution.status, 'error');
  assert.match(mismatched.resolution.notes[0], /does not match/i);
});

test('profile resolver probes local-env readiness with an active RPC chain check', async () => {
  const resolver = createProfileResolverService({
    env: {
      PANDORA_PRIVATE_KEY: `0x${'11'.repeat(32)}`,
      CHAIN_ID: '1',
    },
  });

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
    const ready = await resolver.probeProfile({
      profileId: 'prod_trader_a',
      policyId: 'execute-with-validation',
      command: 'trade.execute',
      chainId: 1,
      rpcUrl,
      category: 'Crypto',
      mode: 'execute',
      liveRequested: true,
    });
    assert.equal(ready.resolution.status, 'ready');
    assert.equal(ready.resolution.ready, true);
    assert.equal(ready.resolution.secretSource.kind, 'env');
    assert.equal(ready.resolution.secretSource.envVar, 'PANDORA_PRIVATE_KEY');
    assert.equal(ready.resolution.rpcUrl, rpcUrl);
    assert.equal(ready.resolution.chainId, 1);
    assert.equal(ready.resolution.wallet.toLowerCase(), '0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a');
    assert.equal(ready.compatibility.ok, true);
    assert.equal(ready.resolution.activeCheck.ok, true);
    assert.equal(resolver.assertResolvedProfileUsable(ready), ready);
  });
});

test('profile resolver denies wrong chain or tool family usage even when signer material exists', () => {
  const resolver = createProfileResolverService({
    env: {
      PANDORA_PRIVATE_KEY: `0x${'11'.repeat(32)}`,
      RPC_URL: 'https://rpc.example.invalid',
      CHAIN_ID: '1',
    },
  });

  const wrongChain = resolver.resolveProfile({
    profileId: 'prod_trader_a',
    policyId: 'execute-with-validation',
    command: 'trade.execute',
    chainId: 8453,
    category: 'Crypto',
    mode: 'execute',
    liveRequested: true,
  });
  assert.equal(wrongChain.compatibility.ok, false);
  assert.equal(
    wrongChain.compatibility.violations.some((item) => item.code === 'PROFILE_CHAIN_NOT_ALLOWED'),
    true,
  );
  assert.throws(
    () => resolver.assertProfileExecutionCompatible(wrongChain),
    (error) => error && error.code === 'PROFILE_INCOMPATIBLE'
      && Array.isArray(error.details && error.details.violations)
      && error.details.violations.some((item) => item.code === 'PROFILE_CHAIN_NOT_ALLOWED'),
  );

  const wrongMethod = resolver.resolveProfile({
    profileId: 'prod_trader_a',
    command: 'capabilities',
    chainId: 1,
    category: 'Crypto',
  });
  assert.equal(wrongMethod.compatibility.ok, false);
  assert.equal(
    wrongMethod.compatibility.violations.some((item) => item.code === 'PROFILE_TOOL_FAMILY_NOT_ALLOWED'),
    true,
  );
});

test('profile resolver marks local-env profiles unusable when the RPC probe fails', async () => {
  const resolver = createProfileResolverService({
    env: {
      PANDORA_PRIVATE_KEY: `0x${'11'.repeat(32)}`,
      CHAIN_ID: '1',
    },
  });

  const probed = await resolver.probeProfile({
    profileId: 'prod_trader_a',
    policyId: 'execute-with-validation',
    command: 'trade.execute',
    chainId: 1,
    rpcUrl: 'http://127.0.0.1:1',
    category: 'Crypto',
    mode: 'execute',
    liveRequested: true,
    probeTimeoutMs: 200,
  });
  assert.equal(probed.resolution.ready, false);
  assert.equal(probed.resolution.status, 'error');
  assert.equal(probed.resolution.activeCheck.ok, false);
  assert.match(probed.resolution.notes[probed.resolution.notes.length - 1], /RPC probe failed/i);
});

test('profile resolver treats keystore and external-signer backends as implemented and surfaces actionable readiness states', () => {
  withTempDir('pandora-profile-pending-', (dir) => {
    const keystorePath = path.join(dir, 'operator-keystore.json');
    fs.writeFileSync(keystorePath, JSON.stringify({ encrypted: true }));
    fs.chmodSync(keystorePath, 0o600);

    const resolver = createProfileResolverService();
    const keystore = resolver.resolveProfile({
      profile: {
        id: 'keystore-operator',
        displayName: 'Keystore Operator',
        description: 'Inline keystore profile.',
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
      command: 'trade.execute',
      chainId: 1,
      category: 'Sports',
      policyId: 'execute-with-validation',
      mode: 'execute',
      liveRequested: true,
    });
    assert.equal(keystore.resolution.status, 'missing-secrets');
    assert.equal(keystore.resolution.ready, false);
    assert.equal(keystore.resolution.backendImplemented, true);
    assert.equal(keystore.resolution.secretSource.kind, 'file');
    assert.equal(keystore.resolution.secretSource.path, keystorePath);
    assert.equal(keystore.resolution.secretSource.exists, true);
    assert.ok(keystore.resolution.missingSecrets.includes('PANDORA_KEYSTORE_PASSWORD'));
    assert.throws(
      () => resolver.assertResolvedProfileReady(keystore),
      (error) => error && error.code === 'PROFILE_RESOLUTION_UNAVAILABLE',
    );

    const externalSigner = resolver.resolveProfile({
      profile: {
        id: 'desk-signer',
        displayName: 'Desk Signer',
        description: 'Inline external signer profile.',
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
      command: 'trade.execute',
      chainId: 1,
      category: 'Sports',
      policyId: 'execute-with-validation',
      mode: 'execute',
      liveRequested: true,
    });
    assert.equal(externalSigner.resolution.status, 'missing-context');
    assert.equal(externalSigner.resolution.ready, false);
    assert.equal(externalSigner.resolution.backendImplemented, true);
    assert.equal(externalSigner.resolution.secretSource.kind, 'external-signer');
    assert.equal(externalSigner.resolution.secretSource.reference, 'signer://desk-service');
    assert.ok(externalSigner.resolution.missingContext.includes('PANDORA_EXTERNAL_SIGNER_URL'));
  });
});

test('profile resolver requires explicit selection when a profile file contains multiple profiles', () => {
  withTempDir('pandora-profile-select-', (dir) => {
    const filePath = path.join(dir, 'profiles.json');
    fs.writeFileSync(filePath, JSON.stringify({
      profiles: [
        {
          id: 'desk_a',
          displayName: 'Desk A',
          description: 'First profile.',
          signerBackend: 'read-only',
          approvalMode: 'read-only',
        },
        {
          id: 'desk_b',
          displayName: 'Desk B',
          description: 'Second profile.',
          signerBackend: 'read-only',
          approvalMode: 'read-only',
        },
      ],
    }));

    const resolver = createProfileResolverService();
    assert.throws(
      () => resolver.selectProfile({ profileFile: filePath }),
      (error) => error && error.code === 'PROFILE_SELECTION_REQUIRED'
        && error.details
        && error.details.profileCount === 2,
    );
  });
});

test('local-keystore profiles reject unsafe file permissions once keystore permission checks exist', () => {
  withTempDir('pandora-profile-keystore-perms-', (dir) => {
    const keystorePath = path.join(dir, 'operator-keystore.json');
    fs.writeFileSync(keystorePath, JSON.stringify({ encrypted: true }));
    fs.chmodSync(keystorePath, 0o644);

    const resolver = createProfileResolverService();
    const keystore = resolver.resolveProfile({
      profile: {
        id: 'keystore-operator',
        displayName: 'Keystore Operator',
        description: 'Inline keystore profile.',
        signerBackend: 'local-keystore',
        approvalMode: 'manual',
        chainAllowlist: [1],
        categoryAllowlist: ['Sports'],
        toolFamilyAllowlist: ['trade'],
        defaultPolicy: 'execute-with-validation',
        allowedPolicies: ['execute-with-validation'],
        secretRef: { path: keystorePath },
      },
    });
    assert.equal(keystore.resolution.status, 'error');
    assert.equal(keystore.resolution.ready, false);
    assert.match(keystore.resolution.notes[0], /permissions/i);
  });
});

test('local-keystore profiles distinguish locked keystores from other pending states once keystore loading exists', () => {
  withTempDir('pandora-profile-keystore-locked-', (dir) => {
    const keystorePath = path.join(dir, 'operator-keystore.json');
    fs.writeFileSync(keystorePath, JSON.stringify({ encrypted: true }));
    fs.chmodSync(keystorePath, 0o600);

    const resolver = createProfileResolverService();
    const keystore = resolver.resolveProfile({
      profile: {
        id: 'keystore-operator',
        displayName: 'Keystore Operator',
        description: 'Inline keystore profile.',
        signerBackend: 'local-keystore',
        approvalMode: 'manual',
        chainAllowlist: [1],
        categoryAllowlist: ['Sports'],
        toolFamilyAllowlist: ['trade'],
        defaultPolicy: 'execute-with-validation',
        allowedPolicies: ['execute-with-validation'],
        secretRef: {
          path: keystorePath,
          passwordEnv: ['PANDORA_KEYSTORE_PASSWORD'],
        },
      },
      env: {},
    });
    assert.equal(keystore.resolution.status, 'missing-secrets');
    assert.equal(keystore.resolution.ready, false);
    assert.ok(keystore.resolution.missingSecrets.includes('PANDORA_KEYSTORE_PASSWORD'));
  });
});

test('external-signer profiles surface auth-denied readiness failures once signer transport integration exists', async () => {
  await withRpcServer(async (req, res) => {
    if (req.url === '/health') {
      res.statusCode = 401;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Signer token rejected.',
        },
      }));
      return;
    }
    res.statusCode = 404;
    res.end();
  }, async (baseUrl) => {
    const resolver = createProfileResolverService({
      env: {
        PANDORA_EXTERNAL_SIGNER_URL: baseUrl,
        PANDORA_EXTERNAL_SIGNER_TOKEN: 'expired-token',
        RPC_URL: 'http://127.0.0.1:8545',
        CHAIN_ID: '1',
      },
    });
    const result = await resolver.probeProfile({
      profileId: 'desk_signer_service',
      command: 'trade.execute',
      chainId: 1,
      category: 'Sports',
      policyId: 'execute-with-validation',
      mode: 'execute',
      liveRequested: true,
    });
    assert.equal(result.resolution.ready, false);
    assert.equal(result.resolution.status, 'error');
    assert.match(result.resolution.notes[result.resolution.notes.length - 1], /unauthorized|token rejected/i);
  });
});

test('profile resolver recommendations normalize aliases and rank canonical policy/profile choices first', () => {
  const resolver = createProfileResolverService();

  const readOnlyRecommendation = resolver.recommendProfiles({
    command: 'trade.quote',
    mode: 'dry-run',
    chainId: 1,
    category: 'Crypto',
    policyId: 'research-only',
  });
  assert.equal(readOnlyRecommendation.requestedCommand, 'trade.quote');
  assert.equal(readOnlyRecommendation.canonicalCommand, 'quote');
  assert.equal(readOnlyRecommendation.profiles[0].id, 'market_observer_ro');
  assert.equal(readOnlyRecommendation.policies[0].id, 'research-only');
  assert.equal(readOnlyRecommendation.decision.bestProfileId, 'market_observer_ro');
  assert.equal(readOnlyRecommendation.decision.bestPolicyId, 'research-only');

  const mutatingRecommendation = resolver.recommendProfiles({
    command: 'trade.execute',
    mode: 'execute',
    chainId: 1,
    category: 'Crypto',
    policyId: 'execute-with-validation',
    liveRequested: true,
    mutating: true,
  });
  assert.equal(mutatingRecommendation.requestedCommand, 'trade.execute');
  assert.equal(mutatingRecommendation.canonicalCommand, 'trade');
  assert.equal(mutatingRecommendation.profiles[0].id, 'prod_trader_a');
  assert.equal(mutatingRecommendation.policies[0].id, 'execute-with-validation');
  assert.equal(mutatingRecommendation.nextTools[0].tool, 'quote');
  assert.equal(mutatingRecommendation.decision.bestProfileId, 'prod_trader_a');
  assert.equal(mutatingRecommendation.decision.bestPolicyId, 'execute-with-validation');
  assert.equal(mutatingRecommendation.decision.bestTool, 'quote');
});

test('policy evaluator denial recommendations stay canonical-tool-first and align policy ranking to top profile guidance', () => {
  const evaluator = createPolicyEvaluatorService();
  const denied = evaluator.evaluateExecution({
    policyId: 'research-only',
    command: 'trade.execute',
    mode: 'execute',
    live: true,
    chainId: 1,
    category: 'Crypto',
  });

  assert.equal(denied.ok, false);
  assert.equal(denied.safeEquivalent, 'quote');
  assert.equal(denied.recommendedNextTool, 'quote');
  assert.equal(denied.recommendations.profiles[0].id, 'prod_trader_a');
  assert.equal(denied.recommendations.policies[0].id, 'execute-with-validation');
  assert.equal(denied.recommendations.nextTools[0].tool, 'quote');
  assert.equal(denied.recommendations.decision.bestProfileId, 'prod_trader_a');
  assert.equal(denied.recommendations.decision.bestPolicyId, 'execute-with-validation');
  assert.equal(denied.recommendations.decision.bestTool, 'quote');
});
