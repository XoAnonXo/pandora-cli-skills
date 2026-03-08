const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('path');
const pkg = require('../../package.json');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { createMcpHttpGatewayService } = require('../../cli/lib/mcp_http_gateway_service.cjs');
const { createOperationService } = require('../../cli/lib/operation_service.cjs');
const { buildCommandDescriptors } = require('../../cli/lib/agent_contract_registry.cjs');
const {
  CLI_PATH,
  REPO_ROOT,
  createTempDir,
  removeDir,
  runCli,
} = require('../helpers/cli_runner.cjs');
const {
  assertPolicyProfilePayloadConsistency,
  assertCommandDigestPolicyParity,
  assertBootstrapPolicyProfileRecommendations,
  assertCanonicalToolFirstCommandSet,
  assertToolPolicyScopeParity,
} = require('../helpers/policy_profile_assertions.cjs');

function parseJsonOutput(result) {
  assert.equal(result.status, 0, result.output || result.stderr || 'expected successful JSON CLI result');
  return JSON.parse(String(result.stdout || '').trim());
}

function extractStructuredEnvelope(callResult) {
  const envelope = callResult && callResult.structuredContent;
  assert.equal(typeof envelope, 'object');
  assert.notEqual(envelope, null);
  return envelope;
}

function omitGeneratedAt(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const clone = { ...payload };
  delete clone.generatedAt;
  return clone;
}

function createIsolatedPolicyProfileEnv(t) {
  const rootDir = fs.mkdtempSync(path.join(REPO_ROOT, '.pandora-policy-profile-mcp-'));
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

async function withTemporaryEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides || {})) {
    previous.set(key, process.env[key]);
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function withMcpClient(fn, options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const client = new Client({ name: 'pandora-phase4-stdio-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI_PATH, 'mcp'],
    cwd: REPO_ROOT,
    stderr: 'pipe',
    env,
  });

  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

async function withMcpHttpGateway(fn, options = {}) {
  return withTemporaryEnv(options.env || {}, async () => {
    const tempDir = createTempDir('pandora-phase4-mcp-http-');
    const operationService = createOperationService({
      rootDir: path.join(tempDir, 'operations'),
    });
    const args = [
      '--host', '127.0.0.1',
      '--port', '0',
    ];

    if (Object.prototype.hasOwnProperty.call(options, 'authToken')) {
      if (options.authToken) {
        args.push('--auth-token', options.authToken);
      }
    } else {
      args.push('--auth-token', 'phase4-token');
    }

    const authScopes = Array.isArray(options.authScopes) ? options.authScopes : ['capabilities:read', 'contracts:read'];
    args.push('--auth-scopes', authScopes.join(','));

    const service = createMcpHttpGatewayService({
      args,
      packageVersion: pkg.version,
      cliPath: CLI_PATH,
      operationService,
    });
    const gateway = await service.start();
    try {
      return await fn(gateway);
    } finally {
      await gateway.close();
      removeDir(tempDir);
    }
  });
}

async function withRemoteMcpClient(fn, options = {}) {
  return withMcpHttpGateway(async (gateway) => {
    const client = new Client({ name: 'pandora-phase4-http-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(
      new URL(`${gateway.config.baseUrl}${gateway.config.mcpPath}`),
      {
        requestInit: {
          headers: {
            authorization: `Bearer ${gateway.auth.token}`,
          },
        },
      },
    );

    await client.connect(transport);
    try {
      return await fn(client, gateway);
    } finally {
      await client.close();
    }
  }, options);
}

test('stdio MCP schema and capabilities preserve policy/profile parity for SDK bootstrap clients', async (t) => {
  const { env } = createIsolatedPolicyProfileEnv(t);
  const cliSchema = parseJsonOutput(runCli(['--output', 'json', 'schema'], { env }));
  const cliCapabilities = parseJsonOutput(runCli(['--output', 'json', 'capabilities'], { env }));

  await withMcpClient(async (client) => {
    const schemaCall = await client.callTool({
      name: 'schema',
      arguments: {},
    });
    const capabilitiesCall = await client.callTool({
      name: 'capabilities',
      arguments: {},
    });
    const list = await client.listTools();

    const schemaEnvelope = extractStructuredEnvelope(schemaCall);
    const capabilitiesEnvelope = extractStructuredEnvelope(capabilitiesCall);

    assert.equal(schemaEnvelope.ok, true);
    assert.equal(capabilitiesEnvelope.ok, true);
    assert.deepEqual(schemaEnvelope.data.commandDescriptors, cliSchema.data.commandDescriptors);
    assert.deepEqual(omitGeneratedAt(capabilitiesEnvelope.data), omitGeneratedAt(cliCapabilities.data));
    assert.equal(capabilitiesEnvelope.data.policyProfiles.policyPacks.userCount, 0);
    assert.deepEqual(capabilitiesEnvelope.data.policyProfiles.policyPacks.userSampleIds, []);
    assert.deepEqual(
      capabilitiesEnvelope.data.policyProfiles.signerProfiles.signerBackends.slice().sort(),
      ['external-signer', 'local-env', 'local-keystore', 'read-only'],
    );

    assertPolicyProfilePayloadConsistency(
      capabilitiesEnvelope.data,
      schemaEnvelope.data.commandDescriptors,
    );
    assertCommandDigestPolicyParity(
      capabilitiesEnvelope.data.commandDigests,
      schemaEnvelope.data.commandDescriptors,
    );
    assertToolPolicyScopeParity(list.tools, schemaEnvelope.data.commandDescriptors);
  }, { env });
});

test('remote MCP gateway capabilities export preserves planned policy/profile metadata while reporting active transport', { concurrency: false }, async (t) => {
  const descriptors = buildCommandDescriptors();
  const capabilitiesScopes = descriptors.capabilities.policyScopes;
  const { env } = createIsolatedPolicyProfileEnv(t);
  const cliCapabilities = parseJsonOutput(runCli(['--output', 'json', 'capabilities'], { env }));

  await withMcpHttpGateway(async (gateway) => {
    const response = await fetch(`${gateway.config.baseUrl}${gateway.config.capabilitiesPath}`, {
      headers: {
        authorization: `Bearer ${gateway.auth.token}`,
      },
    });
    assert.equal(response.status, 200);
    const envelope = await response.json();

    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.transports.mcpStreamableHttp.status, 'active');
    assert.deepEqual(envelope.data.policyProfiles, cliCapabilities.data.policyProfiles);
    assert.equal(envelope.data.policyProfiles.policyPacks.userCount, 0);

    assertPolicyProfilePayloadConsistency(envelope.data, descriptors);
    assertCommandDigestPolicyParity(envelope.data.commandDigests, descriptors);
  }, {
    authScopes: capabilitiesScopes,
    env,
  });
});

test('remote MCP scope evaluation hides out-of-scope signer-profile-bound tools', { concurrency: false }, async (t) => {
  const descriptors = buildCommandDescriptors();
  const tradeScopesWithoutSecrets = descriptors.trade.policyScopes.filter((scope) => scope !== 'secrets:use');
  const { env } = createIsolatedPolicyProfileEnv(t);

  await withRemoteMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'trade',
      arguments: {
        'market-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        side: 'yes',
        'amount-usdc': 10,
        'dry-run': true,
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'UNKNOWN_TOOL');
    assert.equal(envelope.error.details?.missingScopes, undefined);
    assert.equal(call.isError, true);
  }, {
    authScopes: tradeScopesWithoutSecrets,
    env,
  });
});

test('stdio MCP can execute policy/profile discovery tools with structured envelopes', async (t) => {
  const { env } = createIsolatedPolicyProfileEnv(t);
  await withMcpClient(async (client) => {
    const policyListCall = await client.callTool({ name: 'policy.list', arguments: {} });
    const policyGetCall = await client.callTool({ name: 'policy.get', arguments: { id: 'research-only' } });
    const profileListCall = await client.callTool({ name: 'profile.list', arguments: {} });
    const profileGetCall = await client.callTool({ name: 'profile.get', arguments: { id: 'market_observer_ro' } });
    const profileExplainCall = await client.callTool({ name: 'profile.explain', arguments: { id: 'market_observer_ro' } });

    const policyList = extractStructuredEnvelope(policyListCall);
    const policyGet = extractStructuredEnvelope(policyGetCall);
    const profileList = extractStructuredEnvelope(profileListCall);
    const profileGet = extractStructuredEnvelope(profileGetCall);
    const profileExplain = extractStructuredEnvelope(profileExplainCall);

    assert.equal(policyList.ok, true);
    assert.equal(policyGet.ok, true);
    assert.equal(profileList.ok, true);
    assert.equal(profileGet.ok, true);
    assert.equal(profileExplain.ok, true);
    assert.equal(policyList.data.userCount, 0);
    assert.ok(policyList.data.items.some((item) => item.id === 'research-only'));
    assert.equal(policyGet.data.item.id, 'research-only');
    assert.equal(profileList.data.fileCount, 0);
    assert.ok(profileList.data.items.some((item) => item.id === 'market_observer_ro'));
    assert.equal(profileGet.data.profile.defaultPolicy, 'research-only');
    assert.equal(profileExplain.data.explanation.usable, true);
    assert.equal(profileExplain.data.explanation.requestedContext.exact, false);
    assert.deepEqual(
      profileExplain.data.explanation.requestedContext.missingFlags,
      ['--command', '--mode', '--chain-id', '--category', '--policy-id'],
    );
    assert.ok(
      profileExplain.data.explanation.remediation.some((step) => step.code === 'PROVIDE_EXACT_CONTEXT'),
    );
  }, { env });
});

test('stdio MCP bootstrap and policy/profile discovery stay canonical-tool-first and machine-usable', async (t) => {
  const { env } = createIsolatedPolicyProfileEnv(t);
  const cliCapabilities = parseJsonOutput(runCli(['--output', 'json', 'capabilities'], { env }));

  await withMcpClient(async (client) => {
    const bootstrapCall = await client.callTool({ name: 'bootstrap', arguments: {} });
    const list = await client.listTools();

    const bootstrap = extractStructuredEnvelope(bootstrapCall);
    const toolNames = list.tools.map((tool) => tool.name);

    assert.equal(bootstrap.ok, true);
    assertCanonicalToolFirstCommandSet(
      cliCapabilities.data.commandDigests,
      ['bootstrap', 'policy.list', 'policy.get', 'profile.get', 'profile.explain'],
    );
    assertBootstrapPolicyProfileRecommendations(
      bootstrap.data,
      cliCapabilities.data.commandDigests,
      { expectedMutableProfileId: null },
    );
    assert.ok(toolNames.includes('bootstrap'));
    assert.ok(toolNames.includes('profile.explain'));
    assert.ok(toolNames.includes('policy.explain'));
    assert.ok(toolNames.includes('policy.recommend'));
    assert.ok(toolNames.includes('profile.recommend'));
  }, { env });
});

test('stdio MCP profile.explain evaluates exact execution context and returns actionable remediation', async (t) => {
  const { env } = createIsolatedPolicyProfileEnv(t);
  await withMcpClient(async (client) => {
    const incompatibleCall = await client.callTool({
      name: 'profile.explain',
      arguments: {
        id: 'market_observer_ro',
        command: 'trade.execute',
        mode: 'execute',
        'chain-id': '1',
        category: 'Crypto',
        'policy-id': 'execute-with-validation',
      },
    });
    const readinessCall = await client.callTool({
      name: 'profile.explain',
      arguments: {
        id: 'prod_trader_a',
        command: 'trade.execute',
        mode: 'execute',
        'chain-id': '1',
        category: 'Crypto',
        'policy-id': 'execute-with-validation',
      },
    });

    const incompatible = extractStructuredEnvelope(incompatibleCall);
    const readiness = extractStructuredEnvelope(readinessCall);

    assert.equal(incompatible.ok, true);
    assert.equal(incompatible.data.explanation.requestedContext.exact, true);
    assert.deepEqual(incompatible.data.explanation.requestedContext.missingFlags, []);
    assert.equal(incompatible.data.explanation.requestedContext.requested.command, 'trade.execute');
    assert.equal(incompatible.data.explanation.requestedContext.requested.mode, 'execute');
    assert.equal(incompatible.data.explanation.requestedContext.requested.chainId, '1');
    assert.equal(incompatible.data.explanation.requestedContext.requested.category, 'Crypto');
    assert.equal(incompatible.data.explanation.requestedContext.requested.policyId, 'execute-with-validation');
    assert.equal(incompatible.data.explanation.compatibility.ok, false);
    assert.equal(incompatible.data.explanation.compatibility.toolFamily, 'trade');
    assert.equal(incompatible.data.explanation.compatibility.categoryName, 'Crypto');
    assert.ok(
      incompatible.data.explanation.remediation.some(
        (step) => step.code === 'PROFILE_READ_ONLY_MUTATION_DENIED'
          && step.message.includes('--mode dry-run'),
      ),
    );
    assert.ok(
      incompatible.data.explanation.remediation.some(
        (step) => step.code === 'PROFILE_POLICY_NOT_ALLOWED'
          && step.suggestedPolicyId === 'research-only',
      ),
    );
    assert.ok(
      incompatible.data.explanation.remediation.some(
        (step) => step.code === 'PROFILE_TOOL_FAMILY_NOT_ALLOWED'
          && Array.isArray(step.allowedToolFamilies)
          && step.allowedToolFamilies.includes('mirror'),
      ),
    );

    assert.equal(readiness.ok, true);
    assert.equal(readiness.data.explanation.requestedContext.exact, true);
    assert.equal(readiness.data.explanation.compatibility.ok, true);
    assert.equal(readiness.data.explanation.readiness.ready, false);
    assert.ok(
      readiness.data.explanation.remediation.some(
        (step) => step.code === 'SET_SIGNER_SECRETS'
          && Array.isArray(step.missingSecrets)
          && step.missingSecrets.includes('PANDORA_PRIVATE_KEY'),
      ),
    );
    assert.ok(
      readiness.data.explanation.remediation.some(
        (step) => step.code === 'SET_NETWORK_CONTEXT'
          && Array.isArray(step.missingContext)
          && step.missingContext.includes('RPC_URL'),
      ),
    );
  }, { env });
});

test('stdio MCP policy/profile recommendation tools return canonical-tool-first machine-usable guidance', async (t) => {
  const { env } = createIsolatedPolicyProfileEnv(t);
  await withMcpClient(async (client) => {
    const policyExplainCall = await client.callTool({
      name: 'policy.explain',
      arguments: {
        id: 'research-only',
        command: 'trade.execute',
        mode: 'execute',
        'chain-id': '1',
        category: 'Crypto',
        'profile-id': 'market_observer_ro',
      },
    });
    const policyRecommendCall = await client.callTool({
      name: 'policy.recommend',
      arguments: {
        command: 'trade.execute',
        mode: 'execute',
        'chain-id': '1',
        category: 'Crypto',
        'profile-id': 'prod_trader_a',
      },
    });
    const profileRecommendCall = await client.callTool({
      name: 'profile.recommend',
      arguments: {
        command: 'trade.execute',
        mode: 'execute',
        'chain-id': '1',
        category: 'Crypto',
        'policy-id': 'execute-with-validation',
      },
    });

    const policyExplain = extractStructuredEnvelope(policyExplainCall);
    const policyRecommend = extractStructuredEnvelope(policyRecommendCall);
    const profileRecommend = extractStructuredEnvelope(profileRecommendCall);

    assert.equal(policyExplain.ok, true);
    assert.equal(policyExplain.data.explanation.requestedContext.canonicalTool, 'trade');
    assert.ok(
      policyExplain.data.explanation.remediation.some((step) => step.code === 'USE_CANONICAL_TOOL' && step.command === 'trade'),
    );

    assert.equal(policyRecommend.ok, true);
    assert.equal(policyRecommend.data.requestedContext.canonicalTool, 'trade');
    assert.equal(policyRecommend.data.exact, true);
    assert.equal(typeof policyRecommend.data.recommendedPolicyId, 'string');
    assert.ok(
      policyRecommend.data.diagnostics.some((item) => item.code === 'USE_CANONICAL_TOOL' && item.command === 'trade'),
    );

    assert.equal(profileRecommend.ok, true);
    assert.equal(profileRecommend.data.requestedContext.canonicalTool, 'trade');
    assert.equal(profileRecommend.data.exact, true);
    assert.ok(Object.prototype.hasOwnProperty.call(profileRecommend.data, 'recommendedProfileId'));
    assert.ok(
      profileRecommend.data.diagnostics.some((item) => item.code === 'USE_CANONICAL_TOOL' && item.command === 'trade'),
    );
  }, { env });
});

test('stdio MCP can lint policy files and validate profiles with structured envelopes', async (t) => {
  const { rootDir, env } = createIsolatedPolicyProfileEnv(t);
  const policyFile = path.join(rootDir, 'policy.json');
  const profileFile = path.join(rootDir, 'profiles.json');

  fs.writeFileSync(policyFile, JSON.stringify({
    schemaVersion: '1.0.0',
    kind: 'policy-pack',
    id: 'mcp-safe',
    version: '1.0.0',
    displayName: 'MCP Safe',
    description: 'MCP smoke policy.',
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
  fs.writeFileSync(profileFile, JSON.stringify({
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

  await withMcpClient(async (client) => {
    const policyLintCall = await client.callTool({ name: 'policy.lint', arguments: { file: policyFile } });
    const profileValidateCall = await client.callTool({ name: 'profile.validate', arguments: { file: profileFile } });

    const policyLint = extractStructuredEnvelope(policyLintCall);
    const profileValidate = extractStructuredEnvelope(profileValidateCall);

    assert.equal(policyLint.ok, true);
    assert.equal(policyLint.data.ok, true);
    assert.equal(policyLint.data.item.id, 'mcp-safe');
    assert.equal(profileValidate.ok, true);
    assert.equal(profileValidate.data.valid, true);
    assert.equal(profileValidate.data.runtimeReady, true);
  }, { env });
});
