const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pkg = require('../../package.json');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { buildCapabilitiesPayload } = require('../../cli/lib/capabilities_command_service.cjs');
const { createMcpToolRegistry } = require('../../cli/lib/mcp_tool_registry.cjs');
const { createMcpHttpGatewayService } = require('../../cli/lib/mcp_http_gateway_service.cjs');
const { createOperationService } = require('../../cli/lib/operation_service.cjs');
const { createOperationStateStore, upsertOperation } = require('../../cli/lib/operation_state_store.cjs');
const { createOperationWebhookDeliveryStore } = require('../../cli/lib/operation_webhook_delivery_store.cjs');
const { computeOperationHash } = require('../../cli/lib/shared/operation_hash.cjs');
const generatedManifest = require('../../sdk/generated/manifest.json');
const generatedContractRegistry = require('../../sdk/generated/contract-registry.json');

const { CLI_PATH, REPO_ROOT, createTempDir, removeDir, runCli, startJsonHttpServer } = require('../helpers/cli_runner.cjs');
const { assertSchemaValid } = require('../helpers/json_schema_assert.cjs');
const {
  omitGeneratedAt,
  omitTrustDistributionFromCapabilities,
  omitTrustDistributionDefinitions,
  normalizeCapabilitiesForTransportParity,
  normalizeCommandDescriptorsForParity,
  assertManifestParity,
  createIsolatedPandoraEnv,
  withTemporaryEnv,
} = require('../helpers/contract_parity_assertions.cjs');
const {
  assertBootstrapPolicyProfileRecommendations,
  assertCanonicalToolFirstCommandSet,
} = require('../helpers/policy_profile_assertions.cjs');
const {
  buildAllRemoteScopes,
  createMcpSweepFixtures,
  formatSweepSummary,
  getCompactModeFlag,
  runMcpToolSweep,
} = require('../helpers/mcp_tool_sweep.cjs');

async function withMcpClient(fn, options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const extraArgs = Array.isArray(options.extraArgs) ? options.extraArgs : [];
  const client = new Client({ name: 'pandora-mcp-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI_PATH, 'mcp', ...extraArgs],
    cwd: REPO_ROOT,
    stderr: 'pipe',
    env,
  });

  await client.connect(transport);
  try {
    return await fn(client, transport);
  } finally {
    await client.close();
  }
}

async function withMcpHttpGateway(fn, options = {}) {
  return withTemporaryEnv(options.env || {}, async () => {
    const tempDir = createTempDir('pandora-mcp-http-');
    const operationService = createOperationService({
      rootDir: path.join(tempDir, 'operations'),
    });
    const args = [
      '--host', '127.0.0.1',
      '--port', '0',
    ];
    if (Array.isArray(options.extraArgs) && options.extraArgs.length) {
      args.push(...options.extraArgs);
    }
    if (Array.isArray(options.authTokenRecords) && options.authTokenRecords.length) {
      const authTokensFile = path.join(tempDir, 'auth-tokens.json');
      fs.writeFileSync(authTokensFile, JSON.stringify({ schemaVersion: '1.0.0', tokens: options.authTokenRecords }, null, 2));
      args.push('--auth-tokens-file', authTokensFile);
    } else if (Object.prototype.hasOwnProperty.call(options, 'authToken')) {
      if (options.authToken) {
        args.push('--auth-token', options.authToken);
      }
    } else {
      args.push('--auth-token', 'test-token');
    }
    if (options.publicBaseUrl) {
      args.push('--public-base-url', options.publicBaseUrl);
    }
    const authScopes = options.authScopes || ['help:read', 'capabilities:read', 'contracts:read', 'operations:read', 'schema:read'];
    if (!(Array.isArray(options.authTokenRecords) && options.authTokenRecords.length)) {
      args.push('--auth-scopes', authScopes.join(','));
    }
    const service = createMcpHttpGatewayService({
      args,
      packageVersion: pkg.version,
      cliPath: CLI_PATH,
      operationService,
    });
    const gateway = await service.start();
    try {
      return await fn(gateway, operationService, tempDir);
    } finally {
      await gateway.close();
      removeDir(tempDir);
    }
  });
}

async function withRemoteMcpClient(fn, options = {}) {
  return withMcpHttpGateway(async (gateway, operationService, tempDir) => {
    const client = new Client({ name: 'pandora-mcp-http-test', version: '1.0.0' });
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
      return await fn(client, gateway, operationService, tempDir);
    } finally {
      await client.close();
    }
  }, options);
}

function extractStructuredEnvelope(callResult) {
  const envelope = callResult && callResult.structuredContent;
  assert.equal(typeof envelope, 'object');
  assert.notEqual(envelope, null);
  assert.equal(typeof envelope.ok, 'boolean');
  return envelope;
}

function parseJsonOutput(result) {
  assert.equal(result.status, 0, result.output || result.stderr || 'expected successful JSON CLI result');
  return JSON.parse(String(result.stdout || '').trim());
}

function stableJsonHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function buildMockHypeResponse() {
  return JSON.stringify({
    summary: 'Knicks-Celtics injury news is dominating the sports cycle.',
    searchQueries: ['knicks celtics march 2030 injury report', 'nba march 2030 breaking news'],
    candidates: [
      {
        headline: 'Knicks vs Celtics picks up late injury-driven buzz',
        topic: 'nba',
        whyNow: 'Roster uncertainty and playoff implications are driving attention.',
        category: 'Sports',
        question: 'Will the New York Knicks beat the Boston Celtics on March 20, 2030?',
        rules: 'YES: The New York Knicks win the game.\nNO: The New York Knicks do not win the game.\nEDGE: If the game is postponed and not completed by March 21, 2030, resolve N/A.',
        sources: [
          {
            title: 'ESPN preview',
            url: 'https://example.com/espn-knicks-celtics',
            publisher: 'ESPN',
            publishedAt: '2030-03-19T12:00:00Z',
          },
          {
            title: 'NBA injury report',
            url: 'https://example.com/nba-knicks-celtics',
            publisher: 'NBA',
            publishedAt: '2030-03-19T13:00:00Z',
          },
        ],
        suggestedResolutionDate: '2030-03-20T23:00:00Z',
        estimatedYesOdds: 57,
        freshnessScore: 86,
        attentionScore: 90,
        resolvabilityScore: 95,
        ammFitScore: 84,
        parimutuelFitScore: 68,
        marketTypeReasoning: 'Odds should move as lineup news changes through the trading window.',
      },
    ],
  });
}

async function startEmptyIndexerMockServer() {
  return startJsonHttpServer(() => ({
    body: {
      data: {
        marketss: {
          items: [],
          pageInfo: null,
        },
        polls: [],
      },
    },
  }));
}

test('mcp tools/list exposes command tools and excludes unsupported launch/clone-bet', async () => {
  await withMcpClient(async (client) => {
    const list = await client.listTools();
    const toolNames = Array.isArray(list && list.tools)
      ? list.tools.map((tool) => String(tool.name))
      : [];

    assert.ok(toolNames.includes('markets.list'));
    assert.ok(toolNames.includes('trade'));
    assert.ok(toolNames.includes('mirror.plan'));
    assert.ok(toolNames.includes('polymarket.check'));
    assert.ok(toolNames.includes('odds.history'));
    assert.ok(toolNames.includes('odds.record'));
    assert.ok(toolNames.includes('arb.scan'));
    assert.ok(toolNames.includes('sell'));
    assert.ok(toolNames.includes('simulate.mc'));
    assert.ok(toolNames.includes('simulate.particle-filter'));
    assert.ok(toolNames.includes('simulate.agents'));
    assert.ok(toolNames.includes('model.score.brier'));
    assert.ok(toolNames.includes('model.calibrate'));
    assert.ok(toolNames.includes('model.correlation'));
    assert.ok(toolNames.includes('model.diagnose'));
    assert.ok(toolNames.includes('lifecycle.status'));
    assert.ok(toolNames.includes('lifecycle.start'));
    assert.ok(toolNames.includes('lifecycle.resolve'));
    assert.ok(toolNames.includes('risk.show'));
    assert.ok(toolNames.includes('risk.panic'));
    assert.ok(toolNames.includes('operations.get'));
    assert.ok(toolNames.includes('operations.list'));
    assert.ok(toolNames.includes('operations.receipt'));
	    assert.ok(toolNames.includes('operations.cancel'));
	    assert.ok(toolNames.includes('operations.close'));
	    assert.ok(toolNames.includes('bootstrap'));
	    assert.ok(toolNames.includes('policy.list'));
	    assert.ok(toolNames.includes('policy.get'));
	    assert.ok(toolNames.includes('policy.explain'));
	    assert.ok(toolNames.includes('policy.recommend'));
	    assert.ok(toolNames.includes('policy.lint'));
	    assert.ok(toolNames.includes('profile.list'));
	    assert.ok(toolNames.includes('profile.get'));
    assert.ok(toolNames.includes('profile.explain'));
    assert.ok(toolNames.includes('profile.recommend'));
    assert.ok(toolNames.includes('profile.validate'));
	    assert.ok(toolNames.includes('agent.market.autocomplete'));
	    assert.ok(toolNames.includes('agent.market.hype'));
	    assert.ok(toolNames.includes('agent.market.validate'));
	    assert.ok(toolNames.includes('markets.hype'));
	    assert.ok(toolNames.includes('markets.hype.plan'));
	    assert.ok(toolNames.includes('markets.hype.run'));
	    assert.ok(!toolNames.includes('launch'));
	    assert.ok(!toolNames.includes('clone-bet'));
  });
});

test('mcp server advertises stable capabilities and version metadata', async () => {
  await withMcpClient(async (client) => {
    const capabilities = client.getServerCapabilities();
    const version = client.getServerVersion();

    assert.equal(typeof capabilities, 'object');
    assert.equal(capabilities.tools.listChanged, false);
    assert.equal(version.name, 'pandora-cli-skills');
    assert.match(version.version, /^\d+\.\d+\.\d+$/);
  });
});

test('mcp http --help prints gateway usage without stack traces', async () => {
  const result = runCli(['mcp', 'http', '--help']);
  assert.equal(result.status, 0, result.output || result.stderr);
  assert.match(result.stdout, /pandora mcp http/);
  assert.match(result.stdout, /auth-token/);
  assert.match(result.stdout, /bootstrap/);
});

test('mcp http supports multiple bearer tokens with distinct principals and scopes', async () => {
  await withMcpHttpGateway(async (gateway) => {
    const baseUrl = gateway.config.baseUrl;
    const reader = await fetch(`${baseUrl}${gateway.config.capabilitiesPath}`, {
      headers: { authorization: 'Bearer reader-token' },
    });
    assert.equal(reader.status, 200);
    const readerPayload = await reader.json();
    assert.equal(readerPayload.principalId, 'reader');

    const denied = await fetch(`${baseUrl}${gateway.config.operationsPath}`, {
      headers: { authorization: 'Bearer reader-token' },
    });
    assert.equal(denied.status, 403);

    const operator = await fetch(`${baseUrl}${gateway.config.operationsPath}`, {
      headers: { authorization: 'Bearer operator-token' },
    });
    assert.equal(operator.status, 200);
  }, {
	    authTokenRecords: [
	      { id: 'reader', token: 'reader-token', scopes: ['capabilities:read', 'contracts:read'] },
	      { id: 'operator', token: 'operator-token', scopes: ['capabilities:read', 'contracts:read', 'operations:read'] },
	    ],
	  });
	});

test('mcp http rotates generated auth tokens across restarts and rejects stale bearer tokens', async () => {
  const homeDir = createTempDir('pandora-mcp-http-home-');
  try {
    let firstToken = null;
    let tokenFile = null;

    await withMcpHttpGateway(async (gateway) => {
      firstToken = gateway.auth.token;
      tokenFile = gateway.auth.tokenFile;
      assert.equal(gateway.auth.generated, true);
      assert.equal(typeof tokenFile, 'string');
      assert.equal(fs.existsSync(tokenFile), true);
      assert.equal(fs.readFileSync(tokenFile, 'utf8').trim(), firstToken);
    }, {
      authToken: null,
      env: { HOME: homeDir },
    });

    await withMcpHttpGateway(async (gateway) => {
      const secondToken = gateway.auth.token;
      assert.equal(gateway.auth.generated, true);
      assert.equal(typeof gateway.auth.tokenFile, 'string');
      assert.equal(gateway.auth.tokenFile, tokenFile);
      assert.notEqual(secondToken, firstToken);
      assert.equal(fs.readFileSync(gateway.auth.tokenFile, 'utf8').trim(), secondToken);

      const staleResponse = await fetch(`${gateway.config.baseUrl}${gateway.config.capabilitiesPath}`, {
        headers: {
          authorization: `Bearer ${firstToken}`,
        },
      });
      assert.equal(staleResponse.status, 401);

      const liveResponse = await fetch(`${gateway.config.baseUrl}${gateway.config.capabilitiesPath}`, {
        headers: {
          authorization: `Bearer ${secondToken}`,
        },
      });
      assert.equal(liveResponse.status, 200);
    }, {
      authToken: null,
      env: { HOME: homeDir },
    });
  } finally {
    removeDir(homeDir);
  }
});

test('mcp http tools and schema can expose denied tools with missing scopes for bootstrap', async () => {
  await withMcpHttpGateway(async (gateway) => {
    const baseUrl = gateway.config.baseUrl;
    const headers = { authorization: 'Bearer limited-token' };

    const toolsResponse = await fetch(`${baseUrl}${gateway.config.toolsPath}?include_denied=1`, { headers });
    assert.equal(toolsResponse.status, 200);
    const toolsPayload = await toolsResponse.json();
    const trade = toolsPayload.data.tools.find((tool) => tool.name === 'trade');
    assert.ok(trade);
    assert.equal(trade.xPandora.authorized, false);
    assert.ok(Array.isArray(trade.xPandora.missingScopes));
    assert.ok(trade.xPandora.missingScopes.length > 0);

    const schemaResponse = await fetch(`${baseUrl}${gateway.config.schemaPath}?include_denied=1`, { headers });
    assert.equal(schemaResponse.status, 200);
    const schemaPayload = await schemaResponse.json();
    assert.equal(schemaPayload.data.gatewayScopeAccess.principalId, 'default');
    assert.equal(schemaPayload.data.gatewayScopeAccess.commands.trade.authorized, false);
    assert.ok(schemaPayload.data.gatewayScopeAccess.commands.trade.missingScopes.length > 0);
  }, {
    authToken: 'limited-token',
    authScopes: ['schema:read', 'contracts:read'],
  });
});

test('mcp http keeps principal context consistent across authenticated bootstrap surfaces and health stays anonymous', async () => {
  await withMcpHttpGateway(async (gateway, operationService) => {
    await operationService.createCompleted({
      operationId: 'principal-audit-op',
      command: 'mirror.deploy',
      summary: 'principal consistency audit',
      result: { txHash: '0xprincipal' },
    });

    const healthResponse = await fetch(`${gateway.config.baseUrl}${gateway.config.healthPath}`);
    assert.equal(healthResponse.status, 200);
    const healthPayload = await healthResponse.json();
    assert.equal(healthPayload.ok, true);
    assert.equal(Object.prototype.hasOwnProperty.call(healthPayload, 'principalId'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(healthPayload.data, 'principalId'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(healthPayload.data, 'grantedScopes'), false);

    const headers = {
      authorization: 'Bearer auditor-token',
    };

    const capabilitiesResponse = await fetch(`${gateway.config.baseUrl}${gateway.config.capabilitiesPath}`, { headers });
    assert.equal(capabilitiesResponse.status, 200);
    const capabilitiesPayload = await capabilitiesResponse.json();
    assert.equal(capabilitiesPayload.principalId, 'auditor');
    assert.equal(capabilitiesPayload.data.gateway.principalId, 'auditor');
    assert.deepEqual(capabilitiesPayload.data.gateway.grantedScopes, ['capabilities:read', 'contracts:read', 'operations:read', 'schema:read']);

    const toolsResponse = await fetch(`${gateway.config.baseUrl}${gateway.config.toolsPath}?include_denied=1`, { headers });
    assert.equal(toolsResponse.status, 200);
    const toolsPayload = await toolsResponse.json();
    assert.equal(toolsPayload.data.principalId, 'auditor');
    assert.ok(toolsPayload.data.tools.every((tool) => tool.xPandora.principalId === 'auditor'));

    const schemaResponse = await fetch(`${gateway.config.baseUrl}${gateway.config.schemaPath}?include_denied=1`, { headers });
    assert.equal(schemaResponse.status, 200);
    const schemaPayload = await schemaResponse.json();
    assert.equal(schemaPayload.data.gatewayScopeAccess.principalId, 'auditor');

    const bootstrapResponse = await fetch(`${gateway.config.baseUrl}${gateway.config.bootstrapPath}?include_denied=1`, { headers });
    assert.equal(bootstrapResponse.status, 200);
    const bootstrapPayload = await bootstrapResponse.json();
    assert.equal(bootstrapPayload.principalId, 'auditor');
    assert.equal(bootstrapPayload.data.principalId, 'auditor');
    assert.equal(bootstrapPayload.data.gateway.principalId, 'auditor');
    assert.equal(bootstrapPayload.data.capabilities.gateway.principalId, 'auditor');
    assert.equal(bootstrapPayload.data.schema.gatewayScopeAccess.principalId, 'auditor');
    assert.equal(bootstrapPayload.data.tools.principalId, 'auditor');

    const operationsResponse = await fetch(`${gateway.config.baseUrl}${gateway.config.operationsPath}/principal-audit-op`, { headers });
    assert.equal(operationsResponse.status, 200);
    const operationsPayload = await operationsResponse.json();
    assert.equal(operationsPayload.ok, true);
    assert.equal(operationsPayload.command, 'operations.get');
    assert.equal(operationsPayload.data.operationId, 'principal-audit-op');
  }, {
    authTokenRecords: [
      {
        id: 'auditor',
        token: 'auditor-token',
        scopes: ['capabilities:read', 'contracts:read', 'operations:read', 'schema:read'],
      },
    ],
  });
});

test('mcp http bootstrap endpoint exposes principal context and scope-respecting bootstrap data', async () => {
  const cliCapabilities = parseJsonOutput(runCli(['--output', 'json', 'capabilities']));
  await withMcpHttpGateway(async (gateway) => {
    const baseUrl = gateway.config.baseUrl;

    const unauthorized = await fetch(`${baseUrl}${gateway.config.bootstrapPath}`);
    assert.equal(unauthorized.status, 401);

    const fullResponse = await fetch(`${baseUrl}${gateway.config.bootstrapPath}`, {
      headers: { authorization: 'Bearer bootstrap-full-token' },
    });
    assert.equal(fullResponse.status, 200);
    const fullPayload = await fullResponse.json();
    assert.equal(fullPayload.ok, true);
    assert.equal(fullPayload.command, 'mcp.bootstrap');
    assert.equal(fullPayload.principalId, 'bootstrap-full');
    assert.equal(fullPayload.data.principalId, 'bootstrap-full');
    assert.deepEqual(
      fullPayload.data.grantedScopes,
      ['arb:read', 'capabilities:read', 'contracts:read', 'network:indexer', 'schema:read'],
    );
    assert.equal(fullPayload.data.gateway.bootstrapPath, '/bootstrap');
	    assert.equal(fullPayload.data.summary.readinessMode, 'artifact-neutral');
	    assert.equal(fullPayload.data.summary.preferences.recommendedFirstCall, 'bootstrap');
	    assert.equal(fullPayload.data.summary.recommendedBootstrapFlow[0], 'bootstrap');
	    assertCanonicalToolFirstCommandSet(
	      cliCapabilities.data.commandDigests,
	      fullPayload.data.summary.recommendedBootstrapFlow,
	    );
	    assertBootstrapPolicyProfileRecommendations(
	      fullPayload.data.summary,
	      cliCapabilities.data.commandDigests,
	      { expectedMutableProfileId: null },
	    );
	    assert.equal(fullPayload.data.access.capabilities.authorized, true);
	    assert.equal(fullPayload.data.access.schema.authorized, true);
	    assert.equal(fullPayload.data.access.tools.authorized, true);
    assert.equal(typeof fullPayload.data.schema.commandDescriptors.trade, 'object');
    const fullToolNames = fullPayload.data.tools.tools.map((tool) => tool.name);
    assert.ok(fullToolNames.includes('arb.scan'));
    assert.ok(!fullToolNames.includes('arbitrage'));

    const limitedResponse = await fetch(`${baseUrl}${gateway.config.bootstrapPath}`, {
      headers: { authorization: 'Bearer bootstrap-limited-token' },
    });
    assert.equal(limitedResponse.status, 200);
    const limitedPayload = await limitedResponse.json();
    assert.equal(limitedPayload.data.principalId, 'bootstrap-limited');
    assert.equal(limitedPayload.data.access.capabilities.authorized, false);
    assert.deepEqual(limitedPayload.data.access.capabilities.missingScopes, ['capabilities:read']);
    assert.equal(limitedPayload.data.access.schema.authorized, true);
    assert.equal(limitedPayload.data.access.tools.authorized, true);
    assert.equal(limitedPayload.data.capabilities, null);
    assert.equal(typeof limitedPayload.data.schema.commandDescriptors.trade, 'object');
    const limitedToolNames = limitedPayload.data.tools.tools.map((tool) => tool.name);
    assert.ok(!limitedToolNames.includes('trade'));
    assert.ok(!limitedToolNames.includes('arbitrage'));

    const detailedResponse = await fetch(`${baseUrl}${gateway.config.bootstrapPath}?include_denied=1&include_aliases=1`, {
      headers: { authorization: 'Bearer bootstrap-limited-token' },
    });
    assert.equal(detailedResponse.status, 200);
    const detailedPayload = await detailedResponse.json();
	    assert.equal(detailedPayload.data.includeAliases, true);
	    assert.equal(detailedPayload.data.includeDenied, true);
	    const detailedTrade = detailedPayload.data.tools.tools.find((tool) => tool.name === 'trade');
    assert.ok(detailedTrade);
    assert.equal(detailedTrade.xPandora.authorized, false);
    assert.ok(detailedTrade.xPandora.missingScopes.length > 0);
    assert.ok(detailedPayload.data.tools.tools.some((tool) => tool.name === 'arbitrage'));
    assert.ok(!detailedPayload.data.summary.canonicalTools.includes('arbitrage'));
    assert.ok(detailedPayload.data.summary.includedToolCommands.includes('arbitrage'));
    assert.equal(detailedPayload.data.schema.gatewayScopeAccess.principalId, 'bootstrap-limited');
    assert.equal(detailedPayload.data.schema.gatewayScopeAccess.commands.trade.authorized, false);
  }, {
    authTokenRecords: [
      {
        id: 'bootstrap-full',
        token: 'bootstrap-full-token',
        scopes: ['capabilities:read', 'contracts:read', 'schema:read', 'arb:read', 'network:indexer'],
      },
      {
        id: 'bootstrap-limited',
        token: 'bootstrap-limited-token',
        scopes: ['contracts:read', 'schema:read'],
      },
    ],
  });
});

test('mcp http operations endpoint supports cancel and close lifecycle mutations over REST', async () => {
  await withMcpHttpGateway(async (gateway, operationService) => {
    const cancelOperation = await operationService.createExecuting({
      tool: 'mirror.sync.start',
      command: 'mirror.sync.start',
      operationHash: computeOperationHash({ command: 'mirror.sync.start', mode: 'execute' }),
      status: 'executing',
    });
    const closeOperation = await operationService.createCompleted({
      tool: 'claim',
      command: 'claim',
      operationHash: computeOperationHash({ command: 'claim', mode: 'execute' }),
      status: 'completed',
    });
    const headers = {
      authorization: 'Bearer rest-ops-token',
      'content-type': 'application/json',
    };

    const cancel = await fetch(`${gateway.config.baseUrl}${gateway.config.operationsPath}/${cancelOperation.operationId}/cancel`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ intent: 'execute', reason: 'stop' }),
    });
    assert.equal(cancel.status, 200);
    const cancelPayload = await cancel.json();
    assert.equal(cancelPayload.command, 'operations.cancel');
    assert.equal(cancelPayload.data.status, 'canceled');

    const close = await fetch(`${gateway.config.baseUrl}${gateway.config.operationsPath}/${closeOperation.operationId}/close`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ intent: 'execute', reason: 'archive' }),
    });
    assert.equal(close.status, 200);
    const closePayload = await close.json();
    assert.equal(closePayload.command, 'operations.close');
    assert.equal(closePayload.data.status, 'closed');
  }, {
    authToken: 'rest-ops-token',
    authScopes: ['operations:read', 'operations:write'],
  });
});

test('mcp tools/list exposes typed per-tool schemas and canonical metadata', async () => {
  await withMcpClient(async (client) => {
    const list = await client.listTools();
    const tools = Array.isArray(list && list.tools) ? list.tools : [];
    const byName = new Map(tools.map((tool) => [String(tool.name), tool]));

    const trade = byName.get('trade');
    assert.ok(trade);
    assert.equal(trade.inputSchema.type, 'object');
    assert.equal(
      trade.inputSchema.properties['market-address'].type,
      'string',
    );
    assert.deepEqual(
      trade.inputSchema.properties.side.enum,
      ['yes', 'no'],
    );
    assert.equal(trade.inputSchema.properties.intent.type, 'object');
    assert.equal(trade.inputSchema.xPandora.canonicalTool, 'trade');
    assert.equal(trade.inputSchema.xPandora.aliasOf, null);
    assert.equal(trade.inputSchema.xPandora.preferred, true);
    assert.equal(trade.inputSchema.xPandora.executeIntentRequired, false);
    assert.equal(trade.inputSchema.xPandora.executeIntentRequiredForLiveMode, true);
    assert.equal(trade.inputSchema.xPandora.remoteEligible, true);
    assert.ok(!trade.inputSchema.xPandora.metadataProvenance.runtimeEnforced.includes('executeIntentRequired'));
    assert.ok(trade.inputSchema.xPandora.metadataProvenance.runtimeEnforced.includes('executeIntentRequiredForLiveMode'));

    const sell = byName.get('sell');
    assert.ok(sell);
    assert.equal(sell.inputSchema.properties.shares.type, 'number');
    assert.equal(Array.isArray(sell.inputSchema.allOf), false);
    assert.equal(Array.isArray(sell.inputSchema.anyOf), false);
    assert.equal(Array.isArray(sell.inputSchema.oneOf), false);
    assert.deepEqual(sell.inputSchema.xPandora.topLevelInputConstraints, {
      requiredAnyOf: [
        { required: ['shares'] },
        { required: ['amount'] },
      ],
    });
    assert.equal(sell.inputSchema.xPandora.canonicalTool, 'sell');
    assert.equal(sell.inputSchema.xPandora.preferred, true);

    const arbScan = byName.get('arb.scan');
    assert.ok(arbScan);
    assert.equal(arbScan.inputSchema.xPandora.canonicalTool, 'arb.scan');
    assert.equal(arbScan.inputSchema.xPandora.preferred, true);

    const operationsCancel = byName.get('operations.cancel');
    assert.ok(operationsCancel);
    assert.equal(operationsCancel.inputSchema.properties.id.type, 'string');
    assert.equal(operationsCancel.inputSchema.properties.intent.type, 'object');
    assert.equal(operationsCancel.inputSchema.xPandora.executeIntentRequired, true);
    assert.equal(operationsCancel.inputSchema.xPandora.canonicalTool, 'operations.cancel');

    const policyGet = byName.get('policy.get');
    assert.ok(policyGet);
    assert.equal(policyGet.inputSchema.properties.id.type, 'string');
    assert.equal(policyGet.inputSchema.xPandora.canonicalTool, 'policy.get');

    const profileValidate = byName.get('profile.validate');
    assert.ok(profileValidate);
    assert.equal(profileValidate.inputSchema.properties.file.type, 'string');
    assert.equal(profileValidate.inputSchema.xPandora.canonicalTool, 'profile.validate');

      const mirrorDeploy = byName.get('mirror.deploy');
      assert.ok(mirrorDeploy);
      assert.deepEqual(mirrorDeploy.inputSchema.xPandora.controlInputNames, ['agentPreflight']);
      assert.equal(mirrorDeploy.inputSchema.xPandora.agentWorkflow.executeRequiresValidation, true);
      assert.deepEqual(mirrorDeploy.inputSchema.xPandora.agentWorkflow.requiredTools, ['agent.market.validate']);
      assert.equal(mirrorDeploy.inputSchema.xPandora.agentPreflightRequired, false);
      assert.equal(mirrorDeploy.inputSchema.xPandora.agentPreflightRequiredForExecuteMode, true);
      assert.ok(mirrorDeploy.inputSchema.xPandora.metadataProvenance.runtimeEnforced.includes('agentPreflightRequiredForExecuteMode'));
      assert.ok(!mirrorDeploy.inputSchema.xPandora.metadataProvenance.runtimeEnforced.includes('agentPreflightRequired'));
      assert.ok(!mirrorDeploy.inputSchema.xPandora.metadataProvenance.runtimeEnforced.includes('agentWorkflow'));

    const agentValidate = byName.get('agent.market.validate');
    assert.ok(agentValidate);
    assert.equal(agentValidate.inputSchema.xPandora.canonicalTool, 'agent.market.validate');
    assert.equal(agentValidate.inputSchema.properties.question.type, 'string');
    assert.equal(Array.isArray(agentValidate.inputSchema.properties['target-timestamp'].anyOf), true);

      const arbitrage = byName.get('arbitrage');
      assert.equal(arbitrage, undefined);

      const riskPanic = byName.get('risk.panic');
      assert.ok(riskPanic);
      assert.equal(riskPanic.inputSchema.xPandora.executeIntentRequired, true);
      assert.equal(riskPanic.inputSchema.xPandora.executeIntentRequiredForLiveMode, false);

      const topLevelCombinatorOffenders = tools.filter(
        (tool) =>
          Array.isArray(tool.inputSchema && tool.inputSchema.allOf)
          || Array.isArray(tool.inputSchema && tool.inputSchema.anyOf)
          || Array.isArray(tool.inputSchema && tool.inputSchema.oneOf),
      );
      assert.deepEqual(topLevelCombinatorOffenders.map((tool) => tool.name), []);
    });

  const localTools = createMcpToolRegistry().listTools();
  const localByName = new Map(localTools.map((tool) => [String(tool.name), tool]));
  assert.equal(localByName.get('trade').xPandora.canonicalTool, 'trade');
  assert.equal(localByName.get('trade').xPandora.aliasOf, null);
  assert.equal(localByName.get('trade').xPandora.preferred, true);
  assert.deepEqual(localByName.get('mirror.deploy').xPandora.controlInputNames, ['agentPreflight']);
  assert.equal(localByName.get('mirror.deploy').xPandora.agentWorkflow.executeRequiresValidation, true);
  assert.equal(localByName.get('arb.scan').xPandora.canonicalTool, 'arb.scan');
  assert.equal(localByName.get('arb.scan').xPandora.preferred, true);
  assert.equal(localByName.has('arbitrage'), false);

  const arbitrageDescriptor = createMcpToolRegistry().describeTool('arbitrage');
  assert.ok(arbitrageDescriptor);
  assert.equal(arbitrageDescriptor.inputSchema.xPandora.aliasOf, 'arb.scan');
  assert.equal(arbitrageDescriptor.inputSchema.xPandora.canonicalTool, 'arb.scan');
  assert.equal(arbitrageDescriptor.inputSchema.xPandora.preferred, false);
});

test('mcp schema/capabilities calls preserve contract-export parity for SDK consumers', async () => {
  const envRoot = createTempDir('pandora-sdk-mcp-stdio-');
  const env = createIsolatedPandoraEnv(envRoot);
  try {
    const cliSchema = parseJsonOutput(runCli(['--output', 'json', 'schema'], { env }));
    const cliCapabilities = parseJsonOutput(runCli(['--output', 'json', 'capabilities'], { env }));
    const generatedArtifactsAligned = generatedManifest.commandDescriptorVersion === cliSchema.data.commandDescriptorVersion;
    assertManifestParity(generatedManifest, generatedContractRegistry);

    await withMcpClient(async (client) => {
      const schemaCall = await client.callTool({
        name: 'schema',
        arguments: {},
      });
      const capabilitiesCall = await client.callTool({
        name: 'capabilities',
        arguments: {},
      });

      const schemaEnvelope = extractStructuredEnvelope(schemaCall);
      const capabilitiesEnvelope = extractStructuredEnvelope(capabilitiesCall);

      assert.equal(schemaEnvelope.ok, true);
      assert.equal(schemaEnvelope.command, 'schema');
      assert.deepEqual(schemaEnvelope.data.commandDescriptors, cliSchema.data.commandDescriptors);
      assert.equal(schemaEnvelope.data.commandDescriptorVersion, cliSchema.data.commandDescriptorVersion);

      assert.equal(capabilitiesEnvelope.ok, true);
      assert.equal(capabilitiesEnvelope.command, 'capabilities');
      assert.deepEqual(
        normalizeCapabilitiesForTransportParity(
          omitTrustDistributionFromCapabilities(omitGeneratedAt(capabilitiesEnvelope.data)),
        ),
        normalizeCapabilitiesForTransportParity(
          omitTrustDistributionFromCapabilities(omitGeneratedAt(cliCapabilities.data)),
        ),
      );
      assert.equal(capabilitiesEnvelope.data.commandDescriptorVersion, schemaEnvelope.data.commandDescriptorVersion);
      assert.equal(capabilitiesEnvelope.data.transports.sdk.supported, true);
      assert.equal(capabilitiesEnvelope.data.transports.sdk.status, 'alpha');
      if (generatedArtifactsAligned) {
        assert.deepEqual(
          normalizeCommandDescriptorsForParity(generatedContractRegistry.commandDescriptors),
          normalizeCommandDescriptorsForParity(schemaEnvelope.data.commandDescriptors),
        );
        assert.deepEqual(
          omitTrustDistributionDefinitions(generatedContractRegistry.schemas.envelope.definitions),
          omitTrustDistributionDefinitions(schemaEnvelope.data.definitions),
        );
        const stableCapabilitiesArtifact = buildCapabilitiesPayload({
          stableArtifactTrustDistribution: true,
          generatedAtOverride: capabilitiesEnvelope.data.generatedAt,
        });
        assert.deepEqual(
          normalizeCapabilitiesForTransportParity(
            omitTrustDistributionFromCapabilities(omitGeneratedAt(stableCapabilitiesArtifact)),
          ),
          normalizeCapabilitiesForTransportParity(
            omitTrustDistributionFromCapabilities(omitGeneratedAt(generatedContractRegistry.capabilities)),
          ),
        );
      }
      assert.equal(
        capabilitiesEnvelope.data.registryDigest.descriptorHash,
        stableJsonHash(schemaEnvelope.data.commandDescriptors),
      );
      assert.deepEqual(
        capabilitiesEnvelope.data.commandDigests.capabilities.policyScopes,
        cliCapabilities.data.commandDigests.capabilities.policyScopes,
      );
      assert.deepEqual(
        capabilitiesEnvelope.data.commandDigests.schema.policyScopes,
        cliCapabilities.data.commandDigests.schema.policyScopes,
      );
    }, { env });
  } finally {
    removeDir(envRoot);
  }
});

test('mcp http health/capabilities endpoints enforce auth and report remote transport', async () => {
  await withMcpHttpGateway(async (gateway) => {
    const healthRes = await fetch(`${gateway.config.baseUrl}${gateway.config.healthPath}`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.ok, true);
    assert.equal(health.data.authRequired, true);
    assert.equal(health.data.endpoints.bootstrap, '/bootstrap');

    const unauthorizedRes = await fetch(`${gateway.config.baseUrl}${gateway.config.capabilitiesPath}`);
    assert.equal(unauthorizedRes.status, 401);

    const capabilitiesRes = await fetch(`${gateway.config.baseUrl}${gateway.config.capabilitiesPath}`, {
      headers: {
        authorization: `Bearer ${gateway.auth.token}`,
      },
    });
    assert.equal(capabilitiesRes.status, 200);
    const capabilities = await capabilitiesRes.json();
    assert.equal(capabilities.ok, true);
    assert.equal(capabilities.data.transports.mcpStreamableHttp.supported, true);
    assert.equal(capabilities.data.transports.mcpStreamableHttp.status, 'active');
    assert.match(capabilities.data.transports.mcpStreamableHttp.endpoint, /\/mcp$/);
    assert.doesNotMatch(capabilities.data.transports.mcpStreamableHttp.endpoint, /:0\//);
    assert.equal(capabilities.data.gateway.schemaPath, '/schema');
    assert.equal(capabilities.data.gateway.toolsPath, '/tools');
    assert.equal(capabilities.data.transports.sdk.packages.typescript.name, '@thisispandora/agent-sdk');
    assert.equal(capabilities.data.transports.sdk.packages.python.name, 'pandora-agent');
  });
});

test('mcp http serves the readyPath and metricsPath advertised by capabilities', async () => {
  await withMcpHttpGateway(async (gateway) => {
    const capabilitiesRes = await fetch(`${gateway.config.baseUrl}${gateway.config.capabilitiesPath}`, {
      headers: {
        authorization: `Bearer ${gateway.auth.token}`,
      },
    });
    assert.equal(capabilitiesRes.status, 200);
    const capabilities = await capabilitiesRes.json();
    const { readyPath, metricsPath } = capabilities.data.gateway;

    const readyRes = await fetch(`${gateway.config.baseUrl}${readyPath}`);
    assert.equal(readyRes.status, 200);
    const readyPayload = await readyRes.json();
    assert.equal(readyPayload.ok, true);
    assert.equal(readyPayload.command, 'mcp.http.ready');
    assert.equal(readyPayload.data.ready, true);
    assert.equal(readyPayload.data.endpoints.ready, readyPath);
    assert.equal(readyPayload.data.endpoints.metrics, metricsPath);

    const unauthorizedMetrics = await fetch(`${gateway.config.baseUrl}${metricsPath}`);
    assert.equal(unauthorizedMetrics.status, 401);

    const metricsRes = await fetch(`${gateway.config.baseUrl}${metricsPath}`, {
      headers: {
        authorization: `Bearer ${gateway.auth.token}`,
      },
    });
    assert.equal(metricsRes.status, 200);
    const metricsPayload = await metricsRes.json();
    assert.equal(metricsPayload.ok, true);
    assert.equal(metricsPayload.command, 'mcp.http.metrics');
    assert.equal(metricsPayload.data.service, 'pandora-mcp-http');
    assert.equal(metricsPayload.data.principalId, gateway.auth.tokenRecords[0].id);
    assert.equal(typeof metricsPayload.data.requests.total, 'number');
  });
});

test('mcp http schema endpoint requires auth and returns schema envelope', async () => {
  await withMcpHttpGateway(async (gateway) => {
    const cliSchema = parseJsonOutput(runCli(['--output', 'json', 'schema']));
    const unauthorized = await fetch(`${gateway.config.baseUrl}${gateway.config.schemaPath}`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${gateway.config.baseUrl}${gateway.config.schemaPath}`, {
      headers: {
        authorization: `Bearer ${gateway.auth.token}`,
      },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'schema');
    assert.equal(payload.data.commandDescriptorVersion, cliSchema.data.commandDescriptorVersion);
    assert.equal(typeof payload.data.commandDescriptors, 'object');
  });
});

test('mcp http tools endpoint hides compatibility aliases by default and can include them explicitly', async () => {
  await withMcpHttpGateway(async (gateway) => {
    const response = await fetch(`${gateway.config.baseUrl}${gateway.config.toolsPath}`, {
      headers: {
        authorization: `Bearer ${gateway.auth.token}`,
      },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mcp.tools');
    assert.equal(payload.data.includeAliases, false);
    const names = payload.data.tools.map((tool) => tool.name);
    assert.ok(names.includes('arb.scan'));
    assert.ok(!names.includes('arbitrage'));

    const aliasResponse = await fetch(`${gateway.config.baseUrl}${gateway.config.toolsPath}?include_aliases=1`, {
      headers: {
        authorization: `Bearer ${gateway.auth.token}`,
      },
    });
    assert.equal(aliasResponse.status, 200);
    const aliasPayload = await aliasResponse.json();
    assert.equal(aliasPayload.data.includeAliases, true);
    const aliasNames = aliasPayload.data.tools.map((tool) => tool.name);
    assert.ok(aliasNames.includes('arb.scan'));
    assert.ok(aliasNames.includes('arbitrage'));
  }, {
    authScopes: ['capabilities:read', 'contracts:read', 'operations:read', 'arb:read', 'arbitrage:read', 'network:indexer'],
  });
});

test('mcp http capabilities endpoint requires the full capabilities tool scope set', async () => {
  await withMcpHttpGateway(async (gateway) => {
    const response = await fetch(`${gateway.config.baseUrl}${gateway.config.capabilitiesPath}`, {
      headers: {
        authorization: `Bearer ${gateway.auth.token}`,
      },
    });
    assert.equal(response.status, 403);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'FORBIDDEN');
    assert.deepEqual(payload.error.details.requiredScopes, ['capabilities:read', 'contracts:read']);
  }, {
    authScopes: ['help:read', 'operations:read'],
  });

  await withMcpHttpGateway(async (gateway) => {
    const response = await fetch(`${gateway.config.baseUrl}${gateway.config.capabilitiesPath}`, {
      headers: {
        authorization: `Bearer ${gateway.auth.token}`,
      },
    });
    assert.equal(response.status, 403);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'FORBIDDEN');
    assert.deepEqual(payload.error.details.requiredScopes, ['capabilities:read', 'contracts:read']);
    assert.deepEqual(payload.error.details.missingScopes, ['contracts:read']);
  }, {
    authScopes: ['capabilities:read', 'help:read', 'operations:read'],
  });
});

test('mcp http can advertise an explicit public base url and generated token file', async () => {
  await withMcpHttpGateway(async (gateway) => {
    assert.equal(gateway.auth.generated, true);
    assert.equal(typeof gateway.auth.tokenFile, 'string');
    assert.equal(fs.existsSync(gateway.auth.tokenFile), true);
    const storedToken = fs.readFileSync(gateway.auth.tokenFile, 'utf8').trim();
    assert.equal(storedToken, gateway.auth.token);

    const capabilitiesRes = await fetch(`${gateway.config.baseUrl}${gateway.config.capabilitiesPath}`, {
      headers: {
        authorization: `Bearer ${gateway.auth.token}`,
      },
    });
    assert.equal(capabilitiesRes.status, 200);
    const capabilities = await capabilitiesRes.json();
    assert.equal(
      capabilities.data.transports.mcpStreamableHttp.endpoint,
      'https://gateway.example.test/mcp',
    );
    assert.equal(capabilities.data.gateway.advertisedBaseUrl, 'https://gateway.example.test');
  }, {
    authToken: null,
    publicBaseUrl: 'https://gateway.example.test',
  });
});

test('mcp http derives a usable advertised endpoint from the request host when bound to a wildcard host', async () => {
  const tempDir = createTempDir('pandora-mcp-http-wildcard-');
  const service = createMcpHttpGatewayService({
    args: ['--host', '0.0.0.0', '--port', '0', '--auth-token', 'test-token', '--auth-scopes', 'capabilities:read,contracts:read,operations:read'],
    packageVersion: pkg.version,
    cliPath: CLI_PATH,
    operationService: createOperationService({
      rootDir: path.join(tempDir, 'operations'),
    }),
  });
  const gateway = await service.start();
  try {
    assert.match(gateway.config.baseUrl, /^http:\/\/localhost:/);
    assert.equal(gateway.config.advertisedBaseUrl, null);
    const response = await fetch(`${gateway.config.baseUrl}${gateway.config.capabilitiesPath}`, {
      headers: {
        authorization: `Bearer ${gateway.auth.token}`,
        'x-forwarded-host': 'gateway.example.test:9999',
        'x-forwarded-proto': 'https',
      },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.transports.mcpStreamableHttp.endpoint, 'https://gateway.example.test:9999/mcp');
    assert.equal(payload.data.gateway.advertisedBaseUrl, 'https://gateway.example.test:9999');
  } finally {
    await gateway.close();
    removeDir(tempDir);
  }
});

test('mcp http rejects unsupported methods on non-MCP endpoints with Allow headers', async () => {
  await withMcpHttpGateway(async (gateway) => {
    const response = await fetch(`${gateway.config.baseUrl}${gateway.config.capabilitiesPath}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${gateway.auth.token}`,
      },
    });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET');
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'METHOD_NOT_ALLOWED');
  });
});

test('mcp http rejects unauthenticated requests on the /mcp endpoint itself', async () => {
  await withMcpHttpGateway(async (gateway) => {
    const response = await fetch(`${gateway.config.baseUrl}${gateway.config.mcpPath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
    });
    assert.equal(response.status, 401);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'UNAUTHORIZED');
  });
});

test('mcp http listTools/callTool parity works through streamable HTTP client transport', async () => {
  await withRemoteMcpClient(async (client) => {
    const list = await client.listTools();
    const tools = Array.isArray(list && list.tools) ? list.tools : [];
    const byName = new Map(tools.map((tool) => [String(tool.name), tool]));

    const helpTool = byName.get('help');
    assert.ok(helpTool);
    assert.equal(helpTool.inputSchema.xPandora.supportsRemote, true);
    assert.equal(helpTool.inputSchema.xPandora.remoteEligible, true);

    const arbScan = byName.get('arb.scan');
    assert.ok(arbScan);
    assert.equal(arbScan.inputSchema.xPandora.aliasOf, null);
    assert.equal(arbScan.inputSchema.xPandora.supportsRemote, true);
    assert.equal(byName.get('arbitrage'), undefined);

    const call = await client.callTool({
      name: 'help',
      arguments: {},
    });
    const envelope = extractStructuredEnvelope(call);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'help');
  }, {
    authScopes: ['help:read', 'capabilities:read', 'operations:read', 'arb:read', 'network:indexer'],
  });
});

test('mcp http filters tools/list to the granted scope set', async () => {
  await withRemoteMcpClient(async (client) => {
    const list = await client.listTools();
    const toolNames = Array.isArray(list && list.tools)
      ? list.tools.map((tool) => String(tool.name))
      : [];
    assert.ok(toolNames.includes('simulate.mc'));
    assert.ok(!toolNames.includes('trade'));
    assert.ok(!toolNames.includes('mirror.deploy'));
  }, {
    authScopes: ['help:read', 'operations:read', 'simulate:read'],
  });
});

test('mcp http exposes schema/capabilities exports for remote SDK bootstrap clients', async () => {
  const envRoot = createTempDir('pandora-sdk-mcp-http-');
  const env = createIsolatedPandoraEnv(envRoot);
  try {
    const localSchema = parseJsonOutput(runCli(['--output', 'json', 'schema'], { env }));
    const localCapabilities = parseJsonOutput(runCli(['--output', 'json', 'capabilities'], { env }));
    const generatedArtifactsAligned = generatedManifest.commandDescriptorVersion === localSchema.data.commandDescriptorVersion;
    assertManifestParity(generatedManifest, generatedContractRegistry);

    await withRemoteMcpClient(async (client, gateway) => {
      const schemaCall = await client.callTool({
        name: 'schema',
        arguments: {},
      });
      const capabilitiesCall = await client.callTool({
        name: 'capabilities',
        arguments: {},
      });

      const schemaEnvelope = extractStructuredEnvelope(schemaCall);
      const capabilitiesEnvelope = extractStructuredEnvelope(capabilitiesCall);

      assert.equal(schemaEnvelope.ok, true);
      assert.equal(schemaEnvelope.command, 'schema');
      assert.equal(capabilitiesEnvelope.ok, true);
      assert.equal(capabilitiesEnvelope.command, 'capabilities');
      assert.equal(capabilitiesEnvelope.data.transports.mcpStreamableHttp.supported, true);
      assert.equal(capabilitiesEnvelope.data.transports.sdk.status, 'alpha');
      assert.equal(capabilitiesEnvelope.data.commandDigests.schema.remoteEligible, true);
      assert.equal(capabilitiesEnvelope.data.commandDigests.capabilities.remoteEligible, true);
      assert.equal(capabilitiesEnvelope.data.commandDescriptorVersion, schemaEnvelope.data.commandDescriptorVersion);
      assertSchemaValid(
        schemaEnvelope.data,
        { $ref: '#/definitions/CapabilitiesPayload' },
        capabilitiesEnvelope.data,
        'mcp-capabilities-tool-active-remote',
      );

      const endpointRes = await fetch(`${gateway.config.baseUrl}${gateway.config.capabilitiesPath}`, {
        headers: {
          authorization: `Bearer ${gateway.auth.token}`,
        },
      });
      assert.equal(endpointRes.status, 200);
      const endpointEnvelope = await endpointRes.json();
      assert.equal(endpointEnvelope.ok, true);
      assertSchemaValid(
        schemaEnvelope.data,
        { $ref: '#/definitions/CapabilitiesPayload' },
        endpointEnvelope.data,
        'mcp-capabilities-endpoint-active-remote',
      );

      if (generatedArtifactsAligned) {
        assert.deepEqual(
          normalizeCommandDescriptorsForParity(generatedContractRegistry.commandDescriptors),
          normalizeCommandDescriptorsForParity(schemaEnvelope.data.commandDescriptors),
        );
        assert.deepEqual(generatedContractRegistry.schemas.envelope.definitions, schemaEnvelope.data.definitions);
      }
      assert.equal(
        capabilitiesEnvelope.data.registryDigest.descriptorHash,
        stableJsonHash(schemaEnvelope.data.commandDescriptors),
      );

      assert.deepEqual(
        normalizeCapabilitiesForTransportParity(endpointEnvelope.data),
        normalizeCapabilitiesForTransportParity(capabilitiesEnvelope.data),
      );
      assert.deepEqual(
        normalizeCapabilitiesForTransportParity(capabilitiesEnvelope.data),
        normalizeCapabilitiesForTransportParity(localCapabilities.data),
      );
      if (generatedArtifactsAligned) {
        const stableCapabilitiesArtifact = buildCapabilitiesPayload({
          stableArtifactTrustDistribution: true,
          generatedAtOverride: capabilitiesEnvelope.data.generatedAt,
        });
        assert.deepEqual(
          normalizeCapabilitiesForTransportParity(
            omitTrustDistributionFromCapabilities(stableCapabilitiesArtifact),
          ),
          normalizeCapabilitiesForTransportParity(
            omitTrustDistributionFromCapabilities(generatedContractRegistry.capabilities),
          ),
        );
      }
    }, {
      authScopes: ['capabilities:read', 'contracts:read', 'operations:read', 'schema:read'],
      env,
    });
  } finally {
    removeDir(envRoot);
  }
});

test('mcp http executes nontrivial read-only tools over streamable HTTP', async () => {
  await withRemoteMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'simulate.mc',
      arguments: {
        trials: 250,
        horizon: 12,
        seed: 9,
      },
    });
    const envelope = extractStructuredEnvelope(call);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'simulate.mc');
    assert.equal(envelope.data.inputs.trials, 250);
    assert.equal(call.isError, false);
  }, {
    authScopes: ['help:read', 'capabilities:read', 'operations:read', 'simulate:read'],
  });
});

test('mcp http hides out-of-scope tools instead of leaking scope-only denials', async () => {
  await withRemoteMcpClient(async (client) => {
    const hidden = await client.callTool({
      name: 'trade',
      arguments: {
        'market-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        side: 'yes',
        'amount-usdc': 10,
        'dry-run': true,
      },
    });
    const unknown = await client.callTool({
      name: 'definitely.not.a.real.tool',
      arguments: {},
    });
    const hiddenEnvelope = extractStructuredEnvelope(hidden);
    const unknownEnvelope = extractStructuredEnvelope(unknown);
    assert.equal(hiddenEnvelope.ok, false);
    assert.equal(unknownEnvelope.ok, false);
    assert.equal(hiddenEnvelope.error.code, 'UNKNOWN_TOOL');
    assert.equal(unknownEnvelope.error.code, 'UNKNOWN_TOOL');
    assert.equal(hiddenEnvelope.error.message, 'Unknown MCP tool: trade');
    assert.equal(unknownEnvelope.error.message, 'Unknown MCP tool: definitely.not.a.real.tool');
  });
});

test('mcp http propagates tool-boundary argument errors as structured error payloads', async () => {
  await withRemoteMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'simulate.mc',
      arguments: {
        trials: 'oops',
      },
    });
    const envelope = extractStructuredEnvelope(call);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'MCP_INVALID_ARGUMENTS');
    assert.equal(call.isError, true);
  }, {
    authScopes: ['help:read', 'capabilities:read', 'operations:read', 'simulate:read'],
  });
});

test('mcp http exposes operation records and receipts through the gateway operations endpoint', async () => {
  await withMcpHttpGateway(async (gateway, operationService) => {
    const created = await operationService.createCompleted({
      operationId: 'remote-op-1',
      command: 'mirror.deploy',
      summary: 'Remote test operation',
      result: { txHash: '0xremote' },
    });
    assert.equal(created.operationId, 'remote-op-1');

    const recordRes = await fetch(`${gateway.config.baseUrl}${gateway.config.operationsPath}/remote-op-1`, {
      headers: {
        authorization: `Bearer ${gateway.auth.token}`,
      },
    });
    assert.equal(recordRes.status, 200);
    const recordPayload = await recordRes.json();
    assert.equal(recordPayload.ok, true);
    assert.equal(recordPayload.command, 'operations.get');
    assert.equal(recordPayload.data.operationId, 'remote-op-1');

    const receiptRes = await fetch(`${gateway.config.baseUrl}${gateway.config.operationsPath}/remote-op-1/receipt`, {
      headers: {
        authorization: `Bearer ${gateway.auth.token}`,
      },
    });
    assert.equal(receiptRes.status, 200);
    const receiptPayload = await receiptRes.json();
    assert.equal(receiptPayload.ok, true);
    assert.equal(receiptPayload.command, 'operations.receipt');
    assert.equal(receiptPayload.data.operationId, 'remote-op-1');
    assert.equal(receiptPayload.data.result.txHash, '0xremote');

    const verifyRes = await fetch(`${gateway.config.baseUrl}${gateway.config.operationsPath}/remote-op-1/receipt/verify?expectedOperationHash=${created.operationHash}`, {
      headers: {
        authorization: `Bearer ${gateway.auth.token}`,
      },
    });
    assert.equal(verifyRes.status, 200);
    const verifyPayload = await verifyRes.json();
    assert.equal(verifyPayload.ok, true);
    assert.equal(verifyPayload.command, 'operations.verify-receipt');
    assert.equal(verifyPayload.data.ok, true);
    assert.equal(verifyPayload.data.operationId, 'remote-op-1');
    assert.equal(verifyPayload.data.expectedOperationHash, created.operationHash);
    assert.equal(verifyPayload.data.source.type, 'operation-id');

    const listRes = await fetch(`${gateway.config.baseUrl}${gateway.config.operationsPath}?limit=10`, {
      headers: {
        authorization: `Bearer ${gateway.auth.token}`,
      },
    });
    assert.equal(listRes.status, 200);
    const listPayload = await listRes.json();
    assert.equal(listPayload.ok, true);
    assert.equal(listPayload.command, 'operations.list');
    assert.ok(Array.isArray(listPayload.data.items));
    assert.ok(listPayload.data.items.some((item) => item.operationId === 'remote-op-1'));
  });
});

test('mcp http exposes persisted webhook delivery ledgers through the operations endpoint', async () => {
  await withMcpHttpGateway(async (gateway, operationService, tempDir) => {
    const rootDir = path.join(tempDir, 'operations');
    const created = await operationService.createCompleted({
      operationId: 'remote-op-webhooks',
      command: 'mirror.sync.run',
      summary: 'Webhook visibility test',
      result: { ok: true },
    });
    const deliveryStore = createOperationWebhookDeliveryStore({
      rootDir,
      operationStateStore: createOperationStateStore({ rootDir }),
    });
    await deliveryStore.append(created.operationId, {
      eventId: 'evt-webhook-1',
      phase: 'completed',
      delivered: false,
      deliveryPolicy: { timeoutMs: 5000, maxAttempts: 4 },
      context: { event: 'pandora.operation.lifecycle', operationId: created.operationId },
      report: {
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        count: 1,
        successCount: 0,
        failureCount: 1,
        permanentFailureCount: 0,
        retryExhaustedCount: 1,
        results: [{
          target: 'generic',
          ok: false,
          deliveryId: 'wh_test_delivery',
          terminalState: 'failed_retry_exhausted',
        }],
      },
      error: { code: 'WEBHOOK_TIMEOUT', message: 'Timed out' },
    });

    const response = await fetch(`${gateway.config.baseUrl}${gateway.config.operationsPath}/${created.operationId}/webhooks`, {
      headers: {
        authorization: `Bearer ${gateway.auth.token}`,
      },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'operations.webhooks');
    assert.equal(payload.data.operationId, created.operationId);
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.deliveries[0].delivered, false);
    assert.equal(payload.data.deliveries[0].report.results[0].terminalState, 'failed_retry_exhausted');
  });
});

test('mcp http returns 403 for operations lifecycle writes without operations:write scope', async () => {
  await withMcpHttpGateway(async (gateway, operationService) => {
    await operationService.createPlanned({
      operationId: 'op-read-only-denied',
      command: 'mirror.sync.run',
      summary: 'Read-only denial test',
    });

    const deniedResponse = await fetch(`${gateway.config.baseUrl}${gateway.config.operationsPath}/op-read-only-denied/cancel`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer reader-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ intent: 'execute', reason: 'should fail' }),
    });
    assert.equal(deniedResponse.status, 403);
    const deniedPayload = await deniedResponse.json();
    assert.equal(deniedPayload.ok, false);
    assert.equal(deniedPayload.error.code, 'FORBIDDEN');
  }, {
    authTokenRecords: [
      {
        id: 'reader',
        token: 'reader-token',
        scopes: ['operations:read'],
      },
    ],
  });
});

test('mcp http auth admin surface lists, rotates, and revokes principals in multi-principal mode', async () => {
  await withMcpHttpGateway(async (gateway) => {
    const baseUrl = gateway.config.baseUrl;
    const authHeaders = { authorization: 'Bearer admin-token' };

    const currentRes = await fetch(`${baseUrl}${gateway.config.authPath}/current`, { headers: authHeaders });
    assert.equal(currentRes.status, 200);
    const currentPayload = await currentRes.json();
    assert.equal(currentPayload.ok, true);
    assert.equal(currentPayload.command, 'mcp.auth.current');
    assert.equal(currentPayload.data.currentPrincipal.principalId, 'admin');

    const principalsRes = await fetch(`${baseUrl}${gateway.config.authPath}/principals`, { headers: authHeaders });
    assert.equal(principalsRes.status, 200);
    const principalsPayload = await principalsRes.json();
    assert.equal(principalsPayload.ok, true);
    assert.equal(principalsPayload.command, 'mcp.auth.principals');
    assert.ok(principalsPayload.data.principals.some((entry) => entry.principalId === 'reader'));

    const rotateRes = await fetch(`${baseUrl}${gateway.config.authPath}/principals/reader/rotate`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ intent: 'execute' }),
    });
    assert.equal(rotateRes.status, 200);
    const rotatePayload = await rotateRes.json();
    assert.equal(rotatePayload.ok, true);
    assert.equal(rotatePayload.command, 'mcp.auth.rotate');
    assert.equal(rotatePayload.data.targetPrincipalId, 'reader');
    assert.equal(typeof rotatePayload.data.issuedToken, 'string');
    assert.notEqual(rotatePayload.data.issuedToken, 'reader-token');

    const oldTokenRes = await fetch(`${baseUrl}${gateway.config.capabilitiesPath}`, {
      headers: { authorization: 'Bearer reader-token' },
    });
    assert.equal(oldTokenRes.status, 401);

    const newTokenRes = await fetch(`${baseUrl}${gateway.config.authPath}/current`, {
      headers: { authorization: `Bearer ${rotatePayload.data.issuedToken}` },
    });
    assert.equal(newTokenRes.status, 200);
    const newTokenPayload = await newTokenRes.json();
    assert.equal(newTokenPayload.data.currentPrincipal.principalId, 'reader');

    const revokeRes = await fetch(`${baseUrl}${gateway.config.authPath}/principals/reader/revoke`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ intent: 'execute' }),
    });
    assert.equal(revokeRes.status, 200);
    const revokePayload = await revokeRes.json();
    assert.equal(revokePayload.ok, true);
    assert.equal(revokePayload.command, 'mcp.auth.revoke');
    assert.equal(revokePayload.data.revoked, true);

    const revokedTokenRes = await fetch(`${baseUrl}${gateway.config.authPath}/current`, {
      headers: { authorization: `Bearer ${rotatePayload.data.issuedToken}` },
    });
    assert.equal(revokedTokenRes.status, 401);
  }, {
    authTokenRecords: [
      {
        id: 'admin',
        token: 'admin-token',
        scopes: ['capabilities:read', 'gateway:auth:read', 'gateway:auth:write'],
      },
      {
        id: 'reader',
        token: 'reader-token',
        scopes: ['capabilities:read'],
      },
    ],
  });
});

test('mcp http allows operations:write principals to cancel operations over REST', async () => {
  await withMcpHttpGateway(async (gateway, operationService) => {
    await operationService.createPlanned({
      operationId: 'op-read-write-split',
      command: 'mirror.sync',
      summary: 'Read/write split audit',
    });

    const allowedResponse = await fetch(`${gateway.config.baseUrl}${gateway.config.operationsPath}/op-read-write-split/cancel`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer operator-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ intent: 'execute', reason: 'authorized cancel' }),
    });
    assert.equal(allowedResponse.status, 200);
    const allowedPayload = await allowedResponse.json();
    assert.equal(allowedPayload.ok, true);
    assert.equal(allowedPayload.command, 'operations.cancel');
    assert.equal(allowedPayload.data.operationId, 'op-read-write-split');
    assert.equal(allowedPayload.data.status, 'canceled');
  }, {
    authTokenRecords: [
      {
        id: 'operator',
        token: 'operator-token',
        scopes: ['operations:read', 'operations:write'],
      },
    ],
  });
});

test('mcp tools/list preserves xPandora metadata defaults and live registry parity', async () => {
  const schemaPayload = parseJsonOutput(runCli(['--output', 'json', 'schema']));
  const descriptors = schemaPayload.data.commandDescriptors;

  await withMcpClient(async (client) => {
    const list = await client.listTools();
    const liveByName = new Map((Array.isArray(list && list.tools) ? list.tools : []).map((tool) => [String(tool.name), tool]));
    const localByName = new Map(createMcpToolRegistry().listTools().map((tool) => [String(tool.name), tool]));

    for (const [toolName, localTool] of localByName) {
      const liveTool = liveByName.get(toolName);
      assert.ok(liveTool, `missing live MCP tool ${toolName}`);
      const descriptor = descriptors[toolName];
      assert.ok(descriptor, `missing schema descriptor for MCP tool ${toolName}`);
      assert.equal(liveTool.inputSchema.xPandora.canonicalTool, descriptor.canonicalTool, `canonicalTool mismatch for ${toolName}`);
      assert.equal(liveTool.inputSchema.xPandora.aliasOf, descriptor.aliasOf, `aliasOf mismatch for ${toolName}`);
      assert.equal(liveTool.inputSchema.xPandora.preferred, descriptor.preferred, `preferred mismatch for ${toolName}`);
      assert.equal(liveTool.inputSchema.xPandora.riskLevel, descriptor.riskLevel, `riskLevel mismatch for ${toolName}`);
      assert.equal(liveTool.inputSchema.xPandora.idempotency, descriptor.idempotency, `idempotency mismatch for ${toolName}`);
      assert.equal(liveTool.inputSchema.xPandora.expectedLatencyMs, descriptor.expectedLatencyMs, `expectedLatencyMs mismatch for ${toolName}`);
      assert.equal(liveTool.inputSchema.xPandora.requiresSecrets, descriptor.requiresSecrets, `requiresSecrets mismatch for ${toolName}`);
      assert.equal(liveTool.inputSchema.xPandora.recommendedPreflightTool, descriptor.recommendedPreflightTool, `recommendedPreflightTool mismatch for ${toolName}`);
      assert.equal(liveTool.inputSchema.xPandora.safeEquivalent, descriptor.safeEquivalent, `safeEquivalent mismatch for ${toolName}`);
      assert.deepEqual(liveTool.inputSchema.xPandora.externalDependencies, descriptor.externalDependencies, `externalDependencies mismatch for ${toolName}`);
        assert.equal(liveTool.inputSchema.xPandora.canRunConcurrent, descriptor.canRunConcurrent, `canRunConcurrent mismatch for ${toolName}`);
        assert.equal(liveTool.inputSchema.xPandora.returnsOperationId, descriptor.returnsOperationId, `returnsOperationId mismatch for ${toolName}`);
        assert.equal(liveTool.inputSchema.xPandora.returnsRuntimeHandle, descriptor.returnsRuntimeHandle, `returnsRuntimeHandle mismatch for ${toolName}`);
      assert.equal(liveTool.inputSchema.xPandora.jobCapable, descriptor.jobCapable, `jobCapable mismatch for ${toolName}`);
      assert.equal(liveTool.inputSchema.xPandora.supportsRemote, descriptor.supportsRemote, `supportsRemote mismatch for ${toolName}`);
      assert.equal(liveTool.inputSchema.xPandora.remoteEligible, descriptor.remoteEligible, `remoteEligible mismatch for ${toolName}`);
      assert.equal(liveTool.inputSchema.xPandora.supportsWebhook, descriptor.supportsWebhook, `supportsWebhook mismatch for ${toolName}`);
      assert.deepEqual(liveTool.inputSchema.xPandora.policyScopes, descriptor.policyScopes, `policyScopes mismatch for ${toolName}`);
      assert.deepEqual(liveTool.inputSchema.xPandora.canonicalCommandTokens, descriptor.canonicalCommandTokens, `canonicalCommandTokens mismatch for ${toolName}`);
      assert.equal(liveTool.inputSchema.xPandora.canonicalUsage, descriptor.canonicalUsage, `canonicalUsage mismatch for ${toolName}`);
      assert.deepEqual(liveTool.inputSchema.xPandora.safeFlags, descriptor.safeFlags, `safeFlags mismatch for ${toolName}`);
      assert.deepEqual(liveTool.inputSchema.xPandora.executeFlags, descriptor.executeFlags, `executeFlags mismatch for ${toolName}`);
      assert.equal(liveTool.inputSchema.xPandora.executeIntentRequired, descriptor.executeIntentRequired, `executeIntentRequired mismatch for ${toolName}`);
      assert.equal(liveTool.inputSchema.xPandora.executeIntentRequiredForLiveMode, descriptor.executeIntentRequiredForLiveMode, `executeIntentRequiredForLiveMode mismatch for ${toolName}`);
      assert.deepEqual(liveTool.inputSchema.xPandora.controlInputNames, localTool.inputSchema.xPandora.controlInputNames, `controlInputNames mismatch for ${toolName}`);
      assert.deepEqual(liveTool.inputSchema.xPandora.agentWorkflow, localTool.inputSchema.xPandora.agentWorkflow, `agentWorkflow mismatch for ${toolName}`);
    }

    for (const [commandName, descriptor] of Object.entries(descriptors)) {
      if (descriptor.mcpExposed && !descriptor.aliasOf) {
        assert.ok(liveByName.has(commandName), `schema marks ${commandName} MCP-exposed but live MCP is missing it`);
      }
    }

    const help = liveByName.get('help');
    assert.ok(help);
    assert.equal(help.inputSchema.xPandora.aliasOf, null);
    assert.equal(help.inputSchema.xPandora.compatibilityAlias, false);
    assert.equal(help.inputSchema.xPandora.mutating, false);
    assert.equal(help.inputSchema.xPandora.longRunningBlocked, false);
    assert.deepEqual(help.inputSchema.xPandora.safeFlags, []);
    assert.deepEqual(help.inputSchema.xPandora.executeFlags, []);
    assert.deepEqual(help.inputSchema.xPandora.controlInputNames, []);
    assert.equal(help.inputSchema.xPandora.agentWorkflow, null);

    const arbitrage = liveByName.get('arbitrage');
    assert.equal(arbitrage, undefined);

    const arbScan = liveByName.get('arb.scan');
    assert.ok(arbScan);
    assert.equal(arbScan.inputSchema.xPandora.aliasOf, null);
    assert.equal(arbScan.inputSchema.xPandora.canonicalTool, 'arb.scan');
    assert.equal(arbScan.inputSchema.xPandora.preferred, true);
    assert.equal(arbScan.inputSchema.xPandora.compatibilityAlias, false);
  });
});

test('mcp rejects mutually-exclusive execution mode flags before CLI dispatch', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'trade',
      arguments: {
        'market-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        side: 'yes',
        'amount-usdc': 10,
        'dry-run': true,
        execute: true,
        intent: { execute: true },
      },
    });

    const content = Array.isArray(call && call.content) ? call.content : [];
    const text = content.map((entry) => String(entry && entry.text ? entry.text : '')).join('\n');
    assert.match(text, /MCP_MUTUALLY_EXCLUSIVE_MODE_FLAGS/);
  });
});

test('mcp tools/call returns structured success envelope for read-only commands', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'help',
      arguments: {},
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'help');
    assert.equal(Array.isArray(envelope.data.usage), true);
    assert.ok(envelope.data.usage.length > 0);
  });
});

test('mcp rejects non-object argument payloads at the protocol boundary', async () => {
  await withMcpClient(async (client) => {
    await assert.rejects(
      () => client.callTool({ name: 'help', arguments: 'not-an-object' }),
      /params\.arguments|InvalidParams|expected record|invalid input/i,
    );
  });
});

test('mcp write tools require explicit execute intent', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'trade',
      arguments: {
        'market-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        side: 'yes',
        'amount-usdc': 10,
        execute: true,
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'MCP_EXECUTE_INTENT_REQUIRED');
    assert.equal(call.isError, true);
  });
});

test('mcp execute-mode market creation requires agentPreflight', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'mirror.deploy',
      arguments: {
        'polymarket-market-id': '0x-market',
        execute: true,
        intent: { execute: true },
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'MCP_AGENT_PREFLIGHT_REQUIRED');
    assert.equal(call.isError, true);
  });
});

test('mcp rejects invalid typed values before CLI parser execution', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'mirror.deploy',
      arguments: {
        'polymarket-market-id': '0x-market',
        'dry-run': true,
        category: 3,
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'MCP_INVALID_ARGUMENTS');
    assert.match(envelope.error.message, /category/i);
    assert.equal(call.isError, true);
  });
});

test('mcp polymarket.trade rejects selectorless dry-run payloads at the schema boundary', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'polymarket.trade',
      arguments: {
        token: 'yes',
        'amount-usdc': 10,
        'dry-run': true,
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'MCP_INVALID_ARGUMENTS');
    assert.match(envelope.error.message, /supported input shape|required/i);
    assert.equal(call.isError, true);
  });
});

test('mcp polymarket.trade rejects selector payloads without an execution mode at the schema boundary', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'polymarket.trade',
      arguments: {
        'condition-id': '0xcondition',
        token: 'yes',
        'amount-usdc': 10,
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'MCP_INVALID_ARGUMENTS');
    assert.match(envelope.error.message, /supported input shape|required/i);
    assert.equal(call.isError, true);
  });
});

test('mcp simulate.particle-filter rejects missing or conflicting input sources at the schema boundary', async () => {
  await withMcpClient(async (client) => {
    const missingSource = await client.callTool({
      name: 'simulate.particle-filter',
      arguments: {},
    });
    const missingEnvelope = extractStructuredEnvelope(missingSource);
    assert.equal(missingEnvelope.ok, false);
    assert.equal(missingEnvelope.error.code, 'MCP_INVALID_ARGUMENTS');
    assert.match(missingEnvelope.error.message, /exclusive|required/i);
    assert.equal(missingSource.isError, true);

    const conflictingSources = await client.callTool({
      name: 'simulate.particle-filter',
      arguments: {
        input: '/tmp/obs.json',
        stdin: true,
      },
    });
    const conflictingEnvelope = extractStructuredEnvelope(conflictingSources);
    assert.equal(conflictingEnvelope.ok, false);
    assert.equal(conflictingEnvelope.error.code, 'MCP_INVALID_ARGUMENTS');
    assert.match(conflictingEnvelope.error.message, /multiple mutually-exclusive|exclusive/i);
    assert.equal(conflictingSources.isError, true);
  });
});

test('mcp rejects mutually-exclusive mirror argument combinations at the tool boundary', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'mirror.deploy',
      arguments: {
        'polymarket-market-id': '0x-market',
        'dry-run': true,
        execute: true,
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'MCP_INVALID_ARGUMENTS');
    assert.match(envelope.error.message, /exclusive argument combination|mutually-exclusive/i);
    assert.equal(call.isError, true);
  });
});

test('mcp agentPreflight payload must satisfy the published nested schema', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'mirror.deploy',
      arguments: {
        'polymarket-market-id': '0x-market',
        execute: true,
        intent: { execute: true },
        agentPreflight: {
          validationTicket: 'market-validate:abc123',
          validationDecision: 'PASS',
        },
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'MCP_INVALID_ARGUMENTS');
    assert.match(envelope.error.message, /agentPreflight/i);
    assert.equal(call.isError, true);
  });
});

test('mcp agent.market.validate returns structured prompt payload', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'agent.market.validate',
      arguments: {
        question: 'Will Arsenal beat Chelsea?',
        rules:
          'YES: Arsenal wins in official full-time result. NO: Chelsea wins or match ends draw. EDGE: Abandoned match resolves NO unless officially replayed before targetTimestamp.',
        'target-timestamp': 1777777777,
        sources: ['https://www.premierleague.com', 'https://www.espn.com'],
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'agent.market.validate');
    assert.equal(typeof envelope.data.ticket, 'string');
    assert.equal(envelope.data.ticket.startsWith('market-validate:'), true);
    assert.equal(envelope.data.requiredAttestation.validationDecision, 'PASS');
  });
});

test('mcp agent.market.validate accepts ISO timestamps and normalizes them', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'agent.market.validate',
      arguments: {
        question: 'Will Arsenal beat Chelsea?',
        rules: 'YES if Arsenal wins. NO otherwise.',
        'target-timestamp': '2030-01-01T00:00:00Z',
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'agent.market.validate');
    assert.equal(envelope.data.input.targetTimestamp, 1893456000);
  });
});

test('mcp agent.market.hype returns structured prompt payload', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'agent.market.hype',
      arguments: {
        area: 'sports',
        query: 'nba injury buzz',
        'market-type': 'both',
        'candidate-count': 2,
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'agent.market.hype');
    assert.equal(envelope.data.promptKind, 'agent.market.hype');
    assert.equal(envelope.data.input.area, 'sports');
    assert.equal(envelope.data.input.query, 'nba injury buzz');
    assert.equal(envelope.data.input.marketType, 'both');
    assert.equal(envelope.data.input.candidateCount, 2);
    assert.equal(envelope.data.workflow.nextTool, 'agent.market.validate');
  });
});

test('mcp mutating tools without mode flags require execute intent', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'webhook.test',
      arguments: {
        'webhook-url': 'https://example.com/hook',
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'MCP_EXECUTE_INTENT_REQUIRED');
    assert.equal(call.isError, true);
  });
});

test('mcp lifecycle.start requires explicit execute intent', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'lifecycle.start',
      arguments: {
        config: '/tmp/lifecycle.json',
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'MCP_EXECUTE_INTENT_REQUIRED');
    assert.equal(call.isError, true);
  });
});

test('mcp safe-mode mutating tools default without execute intent', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'trade',
      arguments: {
        'market-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        side: 'yes',
        'amount-usdc': 10,
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'trade');
    assert.equal(envelope.data.mode, 'dry-run');
  });
});

test('mcp markets.create.run rejects missing liquidity at the schema boundary', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'markets.create.run',
      arguments: {
        question: 'Will ETH close above $8k by end of 2026?',
        rules: 'YES: ETH/USD closes above $8k. NO: ETH/USD closes at or below $8k. EDGE: Unresolved/cancelled markets resolve NO.',
        sources: ['https://example.com/a', 'https://example.com/b'],
        'target-timestamp': '2030-01-01T00:00:00Z',
        'dry-run': true,
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'MCP_INVALID_ARGUMENTS');
    assert.match(envelope.error.message, /liquidity-usdc/i);
    assert.equal(call.isError, true);
  });
});

test('mcp markets.create.run rejects missing execution mode at the schema boundary', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'markets.create.run',
      arguments: {
        question: 'Will ETH close above $8k by end of 2026?',
        rules: 'YES: ETH/USD closes above $8k. NO: ETH/USD closes at or below $8k. EDGE: Unresolved/cancelled markets resolve NO.',
        sources: ['https://example.com/a', 'https://example.com/b'],
        'target-timestamp': '2030-01-01T00:00:00Z',
        'liquidity-usdc': 100,
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'MCP_INVALID_ARGUMENTS');
    assert.match(envelope.error.message, /exclusive argument combination|dry-run|execute/i);
    assert.equal(call.isError, true);
  });
});

test('mcp markets.create.plan returns canonical normalized plan payload', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'markets.create.plan',
      arguments: {
        question: 'Will BTC close above $120k by end of 2026?',
        rules: 'YES: BTC/USD closes above $120k. NO: BTC/USD closes at or below $120k. EDGE: Unresolved/cancelled markets resolve NO.',
        sources: ['https://example.com/a', 'https://example.com/b'],
        'target-timestamp': '2030-01-01T00:00:00Z',
        'liquidity-usdc': 100,
        'market-type': 'parimutuel',
        'curve-flattener': 7,
        'curve-offset': 30000,
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'markets.create.plan');
    assert.equal(envelope.data.mode, 'plan');
    assert.equal(envelope.data.marketTemplate.marketType, 'parimutuel');
    assert.equal(envelope.data.requiredValidation.promptTool, 'agent.market.validate');
  });
});

test('mcp markets.create.plan coerces CLI-like numeric strings into the typed input contract', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'markets.create.plan',
      arguments: {
        question: 'Will BTC close above $120k by end of 2026?',
        rules: 'YES: BTC/USD closes above $120k. NO: BTC/USD closes at or below $120k. EDGE: Unresolved/cancelled markets resolve NO.',
        sources: ['https://example.com/a', 'https://example.com/b'],
        'target-timestamp': '2030-01-01T00:00:00Z',
        'liquidity-usdc': '100',
        'curve-flattener': '7',
        'curve-offset': '30000',
        'market-type': 'parimutuel',
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'markets.create.plan');
    assert.equal(envelope.data.marketTemplate.marketType, 'parimutuel');
  });
});

test('mcp markets.create.run preserves post-poll tx-route metadata on dry-run payloads', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'markets.create.run',
      arguments: {
        question: 'Will BTC close above $120k by end of 2026?',
        rules: 'YES: BTC/USD closes above $120k. NO: BTC/USD closes at or below $120k. EDGE: Unresolved/cancelled markets resolve NO.',
        sources: ['https://example.com/a', 'https://example.com/b'],
        'target-timestamp': '2030-01-01T00:00:00Z',
        'liquidity-usdc': 100,
        'market-type': 'amm',
        'fee-tier': 3000,
        'tx-route': 'flashbots-bundle',
        'dry-run': true,
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'markets.create.run');
    assert.equal(envelope.data.mode, 'dry-run');
    assert.equal(envelope.data.marketTemplate.marketType, 'amm');
    assert.equal(envelope.data.deployment.mode, 'dry-run');
    assert.equal(envelope.data.deployment.txRouteRequested, 'flashbots-bundle');
    assert.equal(envelope.data.deployment.txRouteResolved, 'flashbots-bundle');
    assert.equal(envelope.data.requiredValidation.promptTool, 'agent.market.validate');
  });
});

test('mcp markets.hype.plan and markets.hype.run support the frozen plan workflow', async () => {
  const envRoot = createTempDir('pandora-mcp-hype-env-');
  const workspaceDir = fs.mkdtempSync(path.join(REPO_ROOT, '.tmp-mcp-hype-'));
  const planFile = path.join(workspaceDir, 'hype-plan.json');
  const indexer = await startEmptyIndexerMockServer();
  const env = createIsolatedPandoraEnv(envRoot, {
    PANDORA_INDEXER_URL: indexer.url,
    PANDORA_HYPE_MOCK_RESPONSE: buildMockHypeResponse(),
  });

  try {
    await withMcpClient(async (client) => {
      const planCall = await client.callTool({
        name: 'markets.hype.plan',
        arguments: {
          area: 'sports',
          'candidate-count': 1,
          'ai-provider': 'mock',
        },
      });
      const planEnvelope = extractStructuredEnvelope(planCall);

      assert.equal(planEnvelope.ok, true);
      assert.equal(planEnvelope.command, 'markets.hype.plan');
      assert.equal(planEnvelope.data.provider.name, 'mock');
      assert.equal(planEnvelope.data.selectedCandidate.validation.attestation.validationDecision, 'PASS');

      fs.writeFileSync(planFile, JSON.stringify(planEnvelope), 'utf8');

      const runCall = await client.callTool({
        name: 'markets.hype.run',
        arguments: {
          'plan-file': planFile,
          'candidate-id': planEnvelope.data.selectedCandidateId,
          'market-type': 'selected',
          'tx-route': 'flashbots-bundle',
          'dry-run': true,
        },
      });
      const runEnvelope = extractStructuredEnvelope(runCall);

      assert.equal(runEnvelope.ok, true);
      assert.equal(runEnvelope.command, 'markets.hype.run');
      assert.equal(runEnvelope.data.mode, 'dry-run');
      assert.equal(runEnvelope.data.selectedMarketType, 'amm');
      assert.equal(runEnvelope.data.deployment.mode, 'dry-run');
      assert.equal(runEnvelope.data.deployment.txRouteRequested, 'flashbots-bundle');
      assert.equal(runEnvelope.data.deployment.txRouteResolved, 'flashbots-bundle');
      assert.equal(runEnvelope.data.validationResult.decision, 'PASS');
    }, { env });
  } finally {
    await indexer.close();
    removeDir(envRoot);
    removeDir(workspaceDir);
  }
});

test('mcp normalizes explicit camelCase aliases before trade CLI dispatch', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'trade',
      arguments: {
        marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        side: 'yes',
        amountUsdc: 10,
        dryRun: true,
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'trade');
    assert.equal(envelope.data.marketAddress, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.equal(envelope.data.amountUsdc, 10);
    assert.equal(envelope.data.mode, 'dry-run');
  });
});

test('mcp normalizes explicit snake_case aliases before agent validation CLI dispatch', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'agent.market.validate',
      arguments: {
        question: 'Will Arsenal beat Chelsea?',
        rules: 'YES if Arsenal wins in official full-time result.',
        target_timestamp: 1777777777,
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'agent.market.validate');
    assert.equal(typeof envelope.data.ticket, 'string');
    assert.equal(envelope.data.ticket.startsWith('market-validate:'), true);
    assert.equal(envelope.data.requiredAttestation.validationDecision, 'PASS');
  });
});

test('mcp execute-flag detection does not misread flag values as execute flags', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'resolve',
      arguments: {
        'poll-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        answer: 'yes',
        reason: '--execute',
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'resolve');
    assert.equal(envelope.data.mode, 'dry-run');
  });
});

test('mcp long-running modes are blocked with actionable error', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'watch',
      arguments: {
        'market-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        side: 'yes',
        'amount-usdc': 5,
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'MCP_LONG_RUNNING_MODE_BLOCKED');
    assert.equal(call.isError, true);
  });
});

test('mcp rejects legacy nested flags payloads by default', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'quote',
      arguments: {
        flags: {
          'market-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          side: 'yes',
          'amount-usdc': 5,
        },
      },
    });
    const envelope = extractStructuredEnvelope(call);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'MCP_LEGACY_FLAGS_UNSUPPORTED');
    assert.equal(call.isError, true);
  });
});

test('mcp blocks odds.record because it is long-running/unbounded', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'odds.record',
      arguments: {
        competition: 'soccer_epl',
        interval: 60,
        'max-samples': 1000,
      },
    });
    const envelope = extractStructuredEnvelope(call);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'MCP_LONG_RUNNING_MODE_BLOCKED');
    assert.equal(call.isError, true);
  });
});

test('mcp simulate.mc executes bounded simulation and returns structured payload', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'simulate.mc',
      arguments: {
        trials: 500,
        horizon: 16,
        seed: 17,
      },
    });
    const envelope = extractStructuredEnvelope(call);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'simulate.mc');
    assert.equal(envelope.data.inputs.trials, 500);
    assert.equal(envelope.data.inputs.horizon, 16);
    assert.equal(envelope.data.inputs.seed, 17);
    assert.equal(typeof envelope.data.summary.risk.valueAtRiskUsdc, 'number');
    assert.equal(call.isError, false);
  });
});

test('mcp model.score.brier executes and returns structured payload', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'model.score.brier',
      arguments: {
        'group-by': 'source',
        'bucket-count': 5,
      },
    });
    const envelope = extractStructuredEnvelope(call);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'model.score.brier');
    assert.equal(envelope.data.action, 'score.brier');
    assert.equal(typeof envelope.data.report, 'object');
    assert.equal(call.isError, false);
  });
});

test('mcp simulate.particle-filter blocks reading input files outside workspace', async () => {
  const outsideDir = createTempDir('pandora-mcp-outside-pf-');
  const inputPath = path.join(outsideDir, 'obs.ndjson');
  fs.writeFileSync(inputPath, '{"yesPct":52}\n');

  try {
    await withMcpClient(async (client) => {
      const call = await client.callTool({
        name: 'simulate.particle-filter',
        arguments: {
          input: inputPath,
        },
      });
      const envelope = extractStructuredEnvelope(call);
      assert.equal(envelope.ok, false);
      assert.equal(envelope.error.code, 'MCP_FILE_ACCESS_BLOCKED');
      assert.equal(call.isError, true);
    });
  } finally {
    removeDir(outsideDir);
  }
});

test('mcp model.calibrate blocks --save-model paths outside workspace', async () => {
  const outsideDir = createTempDir('pandora-mcp-outside-save-model-');
  const modelPath = path.join(outsideDir, 'artifact.json');

  try {
    await withMcpClient(async (client) => {
      const call = await client.callTool({
        name: 'model.calibrate',
        arguments: {
          returns: '0.01,0.02,-0.01,0.03,-0.02',
          'save-model': modelPath,
        },
      });
      const envelope = extractStructuredEnvelope(call);
      assert.equal(envelope.ok, false);
      assert.equal(envelope.error.code, 'MCP_FILE_ACCESS_BLOCKED');
      assert.equal(call.isError, true);
    });
  } finally {
    removeDir(outsideDir);
  }
});

test('mcp lifecycle.start blocks reading config outside workspace', async () => {
  const outsideDir = createTempDir('pandora-mcp-outside-lifecycle-');
  const configPath = path.join(outsideDir, 'lifecycle.json');
  fs.writeFileSync(configPath, '{}\n');

  try {
    await withMcpClient(async (client) => {
      const call = await client.callTool({
        name: 'lifecycle.start',
        arguments: {
          config: configPath,
          intent: {
            execute: true,
          },
        },
      });
      const envelope = extractStructuredEnvelope(call);
      assert.equal(envelope.ok, false);
      assert.equal(envelope.error.code, 'MCP_FILE_ACCESS_BLOCKED');
      assert.equal(call.isError, true);
    });
  } finally {
    removeDir(outsideDir);
  }
});

test('mcp resolve blocks --dotenv-path outside workspace', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'resolve',
      arguments: {
        'poll-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        answer: 'yes',
        reason: 'dry-run justification',
        'dotenv-path': '/tmp/outside.env',
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'MCP_FILE_ACCESS_BLOCKED');
    assert.equal(call.isError, true);
  });
});

test('mcp sports.create.plan blocks reading model files outside workspace', async () => {
  const outsideDir = createTempDir('pandora-mcp-outside-model-');
  const modelPath = path.join(outsideDir, 'model.json');
  fs.writeFileSync(modelPath, '{"probability":0.62,"confidence":"high","source":"test"}\n');

  try {
    await withMcpClient(async (client) => {
      const call = await client.callTool({
        name: 'sports.create.plan',
        arguments: {
          'event-id': 'evt-1',
          'model-file': modelPath,
        },
      });
      const envelope = extractStructuredEnvelope(call);
      assert.equal(envelope.ok, false);
      assert.equal(envelope.error.code, 'MCP_FILE_ACCESS_BLOCKED');
      assert.equal(call.isError, true);
    });
  } finally {
    removeDir(outsideDir);
  }
});

test('mcp sports.resolve.plan blocks reading checks files outside workspace', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'sports.resolve.plan',
      arguments: {
        'event-id': 'evt-1',
        'checks-file': '/tmp/outside-checks.json',
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'MCP_FILE_ACCESS_BLOCKED');
  });
});

test('mcp mirror.deploy blocks reading plan files outside workspace', async () => {
  const outsideDir = createTempDir('pandora-mcp-outside-mirror-plan-');
  const planPath = path.join(outsideDir, 'mirror-plan.json');
  fs.writeFileSync(planPath, '{}\n');

  try {
    await withMcpClient(async (client) => {
      const call = await client.callTool({
        name: 'mirror.deploy',
        arguments: {
          'plan-file': planPath,
          'dry-run': true,
        },
      });
      const envelope = extractStructuredEnvelope(call);
      assert.equal(envelope.ok, false);
      assert.equal(envelope.error.code, 'MCP_FILE_ACCESS_BLOCKED');
      assert.equal(call.isError, true);
    });
  } finally {
    removeDir(outsideDir);
  }
});

test('mcp autopilot.once blocks state paths outside workspace', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'autopilot.once',
      arguments: {
        'market-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        side: 'yes',
        'amount-usdc': 5,
        'trigger-yes-below': 40,
        'state-file': '/tmp/outside-autopilot.json',
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'MCP_FILE_ACCESS_BLOCKED');
  });
});

test('mcp mirror.plan rejects insecure gamma override urls', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'mirror.plan',
      arguments: {
        source: 'polymarket',
        'polymarket-market-id': 'poly-1',
        'polymarket-gamma-url': 'http://example.com/gamma',
      },
    });
    const envelope = extractStructuredEnvelope(call);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'INVALID_FLAG_VALUE');
    assert.equal(call.isError, true);
  });
});

test('mcp risk.panic requires explicit execute intent', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'risk.panic',
      arguments: {
        reason: 'incident',
      },
    });
    const envelope = extractStructuredEnvelope(call);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'MCP_EXECUTE_INTENT_REQUIRED');
    assert.equal(call.isError, true);
  });
});

test('mcp operations.cancel requires explicit execute intent', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'operations.cancel',
      arguments: {
        id: 'op_demo',
      },
    });
    const envelope = extractStructuredEnvelope(call);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'MCP_EXECUTE_INTENT_REQUIRED');
    assert.equal(call.isError, true);
  });
});

test('mcp operations.get can inspect seeded operation records', async () => {
  const tempDir = createTempDir('pandora-mcp-operations-');
  try {
    const operationDir = path.join(tempDir, 'operations');
    const created = upsertOperation(
      operationDir,
      {
        command: 'mirror.deploy',
        request: { marketAddress: '0xabc', execute: false },
        status: 'planned',
      },
      { now: '2026-03-07T10:00:00.000Z' },
    );
    await withMcpClient(async (client) => {
      const call = await client.callTool({
        name: 'operations.get',
        arguments: {
          id: created.operation.operationId,
        },
      });
      const envelope = extractStructuredEnvelope(call);
      assert.equal(envelope.ok, true);
      assert.equal(envelope.command, 'operations.get');
      assert.equal(envelope.data.operationId, created.operation.operationId);
    }, {
      env: {
        ...process.env,
        PANDORA_OPERATION_DIR: operationDir,
        HOME: tempDir,
      },
    });
  } finally {
    removeDir(tempDir);
  }
});

test('mcp operations.receipt can inspect a terminal operation receipt', async () => {
  const tempDir = createTempDir('pandora-mcp-operations-receipt-');
  try {
    const operationDir = path.join(tempDir, 'operations');
    const operationService = createOperationService({
      rootDir: operationDir,
    });
    const created = await operationService.createCompleted({
      command: 'mirror.deploy',
      request: { marketAddress: '0xabc', execute: false },
      result: { txHash: '0xabc123' },
    });
    await withMcpClient(async (client) => {
      const call = await client.callTool({
        name: 'operations.receipt',
        arguments: {
          id: created.operationId,
        },
      });
      const envelope = extractStructuredEnvelope(call);
      assert.equal(envelope.ok, true);
      assert.equal(envelope.command, 'operations.receipt');
      assert.equal(envelope.data.operationId, created.operationId);
      assert.equal(envelope.data.result.txHash, '0xabc123');
    }, {
      env: {
        ...process.env,
        PANDORA_OPERATION_DIR: operationDir,
        HOME: tempDir,
      },
    });
  } finally {
    removeDir(tempDir);
  }
});

test('mcp operations.verify-receipt can verify a terminal operation receipt by id', async () => {
  const tempDir = createTempDir('pandora-mcp-operations-verify-receipt-');
  try {
    const operationDir = path.join(tempDir, 'operations');
    const operationService = createOperationService({
      rootDir: operationDir,
    });
    const created = await operationService.createCompleted({
      command: 'mirror.deploy',
      request: { marketAddress: '0xabc', execute: false },
      result: { txHash: '0xabc123' },
    });
    await withMcpClient(async (client) => {
      const call = await client.callTool({
        name: 'operations.verify-receipt',
        arguments: {
          id: created.operationId,
          'expected-operation-hash': created.operationHash,
        },
      });
      const envelope = extractStructuredEnvelope(call);
      assert.equal(envelope.ok, true);
      assert.equal(envelope.command, 'operations.verify-receipt');
      assert.equal(envelope.data.ok, true);
      assert.equal(envelope.data.operationId, created.operationId);
      assert.equal(envelope.data.expectedOperationHash, created.operationHash);
      assert.equal(envelope.data.source.type, 'operation-id');
    }, {
      env: {
        ...process.env,
        PANDORA_OPERATION_DIR: operationDir,
        HOME: tempDir,
      },
    });
  } finally {
    removeDir(tempDir);
  }
});

test('mcp panic lock blocks live write tools until cleared', async () => {
  const tempHome = createTempDir('pandora-mcp-risk-');
  try {
    await withMcpClient(async (client) => {
      const engage = await client.callTool({
        name: 'risk.panic',
        arguments: {
          reason: 'incident',
          intent: {
            execute: true,
          },
        },
      });
      const engageEnvelope = extractStructuredEnvelope(engage);
      assert.equal(engageEnvelope.ok, true);
      assert.equal(engageEnvelope.command, 'risk.panic');
      assert.equal(engageEnvelope.data.panic.active, true);

      const blocked = await client.callTool({
        name: 'resolve',
        arguments: {
          'poll-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          answer: 'yes',
          reason: 'mcp resolve',
          execute: true,
          intent: {
            execute: true,
          },
        },
      });
      const blockedEnvelope = extractStructuredEnvelope(blocked);
      assert.equal(blockedEnvelope.ok, false);
      assert.equal(blockedEnvelope.error.code, 'RISK_PANIC_ACTIVE');

      const clear = await client.callTool({
        name: 'risk.panic',
        arguments: {
          clear: true,
          intent: {
            execute: true,
          },
        },
      });
      const clearEnvelope = extractStructuredEnvelope(clear);
      assert.equal(clearEnvelope.ok, true);
      assert.equal(clearEnvelope.command, 'risk.panic');
      assert.equal(clearEnvelope.data.panic.active, false);
    }, {
      env: {
        ...process.env,
        HOME: tempHome,
        PANDORA_RISK_FILE: `${tempHome}/risk.json`,
      },
    });
  } finally {
    removeDir(tempHome);
  }
});

test('mcp stdio exhaustive sweep invokes every exposed tool with structured results', { concurrency: false }, async (t) => {
  const fixtures = await createMcpSweepFixtures();
  t.after(async () => {
    await fixtures.cleanup();
  });

  await withMcpClient(async (client) => {
    const summary = await runMcpToolSweep({
      client,
      fixtures,
      transportLabel: 'stdio',
    });

    t.diagnostic(formatSweepSummary(summary));
    assert.equal(summary.results.length, summary.toolCount);
    assert.equal(summary.toolCount > 0, true);
    assert.deepEqual(summary.transportErrors, []);
    assert.deepEqual(summary.unstructured, []);
    assert.deepEqual(summary.schemaIssueResults, []);
  }, {
    env: fixtures.env,
  });
});

test('mcp http exhaustive sweep invokes every remote-exposed tool with structured results', { concurrency: false }, async (t) => {
  const fixtures = await createMcpSweepFixtures();
  t.after(async () => {
    await fixtures.cleanup();
  });

  await withRemoteMcpClient(async (client) => {
    const summary = await runMcpToolSweep({
      client,
      fixtures,
      transportLabel: 'http',
    });

    t.diagnostic(formatSweepSummary(summary));
    assert.equal(summary.results.length, summary.toolCount);
    assert.equal(summary.toolCount > 0, true);
    assert.deepEqual(summary.transportErrors, []);
    assert.deepEqual(summary.unstructured, []);
    assert.deepEqual(summary.schemaIssueResults, []);
  }, {
    authScopes: buildAllRemoteScopes(),
    env: fixtures.env,
  });
});

test('mcp compact/code mode, when advertised, exposes a materially reduced discovery surface', { concurrency: false }, async (t) => {
  const compactFlag = getCompactModeFlag();
  if (!compactFlag) {
    t.diagnostic('compact/code mode flag not advertised by `pandora mcp --help`; skipping');
    return;
  }

  const fixtures = await createMcpSweepFixtures();
  t.after(async () => {
    await fixtures.cleanup();
  });

  await withMcpClient(async (client) => {
    const listed = await client.listTools();
    const tools = Array.isArray(listed && listed.tools) ? listed.tools : [];
    const toolNames = tools.map((tool) => String(tool.name || ''));
    const sortedToolNames = toolNames.slice().sort();

    const hiddenCall = await client.callTool({
      name: 'trade',
      arguments: {
        'market-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        side: 'yes',
        'amount-usdc': 10,
        'dry-run': true,
      },
    });
    const hiddenEnvelope = extractStructuredEnvelope(hiddenCall);

    const searchCall = await client.callTool({
      name: 'search',
      arguments: {
        query: 'trade',
        limit: 3,
      },
    });
    const searchEnvelope = extractStructuredEnvelope(searchCall);

    const executeCall = await client.callTool({
      name: 'execute',
      arguments: {
        calls: [
          { name: 'help', arguments: {} },
          { name: 'capabilities', arguments: {} },
        ],
      },
    });
    const executeEnvelope = extractStructuredEnvelope(executeCall);

    t.diagnostic(JSON.stringify({ compactFlag, toolNames }, null, 2));
    assert.deepEqual(sortedToolNames, ['execute', 'search']);
    assert.equal(hiddenEnvelope.ok, false);
    assert.equal(hiddenEnvelope.error.code, 'UNKNOWN_TOOL');
    assert.equal(searchEnvelope.ok, true);
    assert.equal(searchEnvelope.command, 'mcp.search');
    assert.equal(searchEnvelope.data.mode, 'compact');
    assert.ok(searchEnvelope.data.matches.some((match) => match.name === 'trade'));
    assert.equal(executeEnvelope.ok, true);
    assert.equal(executeEnvelope.command, 'mcp.execute');
    assert.equal(executeEnvelope.data.mode, 'compact');
    assert.equal(executeEnvelope.data.executedCalls, 2);
    assert.equal(executeEnvelope.data.failed, 0);
  }, {
    env: fixtures.env,
    extraArgs: [compactFlag],
  });
});

test('mcp http compact/code mode preserves compact exposure through streamable HTTP', { concurrency: false }, async (t) => {
  const compactFlag = getCompactModeFlag();
  if (!compactFlag) {
    t.diagnostic('compact/code mode flag not advertised by `pandora mcp --help`; skipping');
    return;
  }

  const fixtures = await createMcpSweepFixtures();
  t.after(async () => {
    await fixtures.cleanup();
  });

  await withRemoteMcpClient(async (client, gateway) => {
    const listed = await client.listTools();
    const tools = Array.isArray(listed && listed.tools) ? listed.tools : [];
    const toolNames = tools.map((tool) => String(tool.name || '')).sort();

    const hiddenCall = await client.callTool({
      name: 'trade',
      arguments: {
        'market-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        side: 'yes',
        'amount-usdc': 10,
        'dry-run': true,
      },
    });
    const hiddenEnvelope = extractStructuredEnvelope(hiddenCall);

    const searchCall = await client.callTool({
      name: 'search',
      arguments: {
        query: 'mirror plan',
        limit: 3,
      },
    });
    const searchEnvelope = extractStructuredEnvelope(searchCall);

    const executeCall = await client.callTool({
      name: 'execute',
      arguments: {
        calls: [{ name: 'help', arguments: {} }],
      },
    });
    const executeEnvelope = extractStructuredEnvelope(executeCall);

    const toolsRes = await fetch(`${gateway.config.baseUrl}${gateway.config.toolsPath}`, {
      headers: {
        authorization: `Bearer ${gateway.auth.token}`,
      },
    });
    assert.equal(toolsRes.status, 200);
    const toolsEnvelope = await toolsRes.json();

    assert.deepEqual(toolNames, ['execute', 'search']);
    assert.equal(hiddenEnvelope.ok, false);
    assert.equal(hiddenEnvelope.error.code, 'UNKNOWN_TOOL');
    assert.equal(searchEnvelope.ok, true);
    assert.equal(searchEnvelope.data.mode, 'compact');
    assert.ok(searchEnvelope.data.matches.some((match) => match.name === 'mirror.plan'));
    assert.equal(executeEnvelope.ok, true);
    assert.equal(executeEnvelope.data.executedCalls, 1);
    assert.equal(executeEnvelope.data.failed, 0);
    assert.equal(toolsEnvelope.data.toolExposureMode, 'compact');
    assert.equal(gateway.config.toolExposureMode, 'compact');
  }, {
    authScopes: buildAllRemoteScopes(),
    env: fixtures.env,
    extraArgs: [compactFlag],
  });
});
