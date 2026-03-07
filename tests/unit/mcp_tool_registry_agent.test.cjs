const test = require('node:test');
const assert = require('node:assert/strict');

const { createMcpToolRegistry } = require('../../cli/lib/mcp_tool_registry.cjs');

test('market execute tools expose agent workflow metadata and control inputs', () => {
  const registry = createMcpToolRegistry();
  const tools = registry.listTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const mirrorDeploy = byName.get('mirror.deploy');
  assert.ok(mirrorDeploy);
  assert.deepEqual(mirrorDeploy.inputSchema.xPandora.controlInputNames, ['agentPreflight']);
  assert.equal(mirrorDeploy.inputSchema.xPandora.agentWorkflow.executeRequiresValidation, true);
  assert.deepEqual(mirrorDeploy.inputSchema.xPandora.agentWorkflow.requiredTools, ['agent.market.validate']);

  const sportsCreateRun = byName.get('sports.create.run');
  assert.ok(sportsCreateRun);
  assert.deepEqual(sportsCreateRun.inputSchema.xPandora.controlInputNames, ['agentPreflight']);
  assert.equal(sportsCreateRun.inputSchema.xPandora.agentWorkflow.executeRequiresValidation, true);
});

test('prepareInvocation requires agentPreflight for execute-mode market creation tools', () => {
  const registry = createMcpToolRegistry();

  assert.throws(
    () =>
      registry.prepareInvocation('mirror.go', {
        intent: { execute: true },
        'polymarket-market-id': '0x-market',
      }),
    (error) => error && error.code === 'MCP_AGENT_PREFLIGHT_REQUIRED',
  );
});

test('prepareInvocation keeps agentPreflight out of argv and passes it through env', () => {
  const registry = createMcpToolRegistry();
  const agentPreflight = {
    validationTicket: 'market-validate:abc123',
    validationDecision: 'PASS',
    validationSummary: 'Resolvable.',
  };

  const invocation = registry.prepareInvocation('mirror.go', {
    intent: { execute: true },
    'polymarket-market-id': '0x-market',
    agentPreflight,
  });

  assert.equal(invocation.argv.includes('--agentPreflight'), false);
  assert.equal(invocation.argv.includes('--execute-live'), true);
  assert.equal(invocation.env.PANDORA_AGENT_PREFLIGHT, JSON.stringify(agentPreflight));
});
