const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const pkg = require('../../package.json');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { createMcpToolRegistry } = require('../../cli/lib/mcp_tool_registry.cjs');
const { createMcpHttpGatewayService } = require('../../cli/lib/mcp_http_gateway_service.cjs');
const { createOperationService } = require('../../cli/lib/operation_service.cjs');
const { upsertOperation } = require('../../cli/lib/operation_state_store.cjs');

const { CLI_PATH, REPO_ROOT, createTempDir, removeDir, runCli } = require('../helpers/cli_runner.cjs');

async function withMcpClient(fn, options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const client = new Client({ name: 'pandora-mcp-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI_PATH, 'mcp'],
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
  const tempDir = createTempDir('pandora-mcp-http-');
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
    args.push('--auth-token', 'test-token');
  }
  if (options.publicBaseUrl) {
    args.push('--public-base-url', options.publicBaseUrl);
  }
  const authScopes = options.authScopes || ['help:read', 'capabilities:read', 'operations:read'];
  args.push('--auth-scopes', authScopes.join(','));
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
    assert.ok(toolNames.includes('operations.cancel'));
    assert.ok(toolNames.includes('operations.close'));
    assert.ok(toolNames.includes('agent.market.autocomplete'));
    assert.ok(toolNames.includes('agent.market.validate'));
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
    assert.equal(Array.isArray(sell.inputSchema.anyOf), true);
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
    assert.equal(agentValidate.inputSchema.properties['target-timestamp'].type, 'integer');

      const arbitrage = byName.get('arbitrage');
      assert.ok(arbitrage);
      assert.equal(arbitrage.inputSchema.xPandora.aliasOf, 'arb.scan');
      assert.equal(arbitrage.inputSchema.xPandora.canonicalTool, 'arb.scan');
      assert.equal(arbitrage.inputSchema.xPandora.preferred, false);

      const riskPanic = byName.get('risk.panic');
      assert.ok(riskPanic);
      assert.equal(riskPanic.inputSchema.xPandora.executeIntentRequired, true);
      assert.equal(riskPanic.inputSchema.xPandora.executeIntentRequiredForLiveMode, false);
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
  assert.equal(localByName.get('arbitrage').xPandora.aliasOf, 'arb.scan');
  assert.equal(localByName.get('arbitrage').xPandora.canonicalTool, 'arb.scan');
  assert.equal(localByName.get('arbitrage').xPandora.preferred, false);
});

test('mcp http health/capabilities endpoints enforce auth and report remote transport', async () => {
  await withMcpHttpGateway(async (gateway) => {
    const healthRes = await fetch(`${gateway.config.baseUrl}${gateway.config.healthPath}`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.ok, true);
    assert.equal(health.data.authRequired, true);

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

    const arbitrage = byName.get('arbitrage');
    assert.ok(arbitrage);
    assert.equal(arbitrage.inputSchema.xPandora.aliasOf, 'arb.scan');
    assert.equal(arbitrage.inputSchema.xPandora.supportsRemote, true);

    const call = await client.callTool({
      name: 'help',
      arguments: {},
    });
    const envelope = extractStructuredEnvelope(call);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'help');
  });
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

test('mcp http enforces scope denials for tools outside the granted token scopes', async () => {
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
    assert.equal(envelope.error.code, 'FORBIDDEN');
    assert.ok(Array.isArray(envelope.error.details.missingScopes));
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

test('mcp http exposes operation records through the gateway operations endpoint', async () => {
  await withMcpHttpGateway(async (gateway, operationService) => {
    const created = await operationService.createPlanned({
      operationId: 'remote-op-1',
      tool: 'mirror.deploy',
      summary: 'Remote test operation',
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
      if (descriptor.mcpExposed) {
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
      assert.ok(arbitrage);
      assert.equal(arbitrage.inputSchema.xPandora.aliasOf, 'arb.scan');
      assert.equal(arbitrage.inputSchema.xPandora.canonicalTool, 'arb.scan');
      assert.equal(arbitrage.inputSchema.xPandora.preferred, false);
      assert.equal(arbitrage.inputSchema.xPandora.compatibilityAlias, true);
      assert.match(arbitrage.description, /Compatibility alias for arb\.scan/);
      assert.match(arbitrage.description, /prefer arb\.scan/);
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
        category: 'Gaming',
      },
    });
    const envelope = extractStructuredEnvelope(call);

    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'MCP_INVALID_ARGUMENTS');
    assert.match(envelope.error.message, /category/i);
    assert.equal(call.isError, true);
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
