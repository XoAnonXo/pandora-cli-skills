const test = require('node:test');
const assert = require('node:assert/strict');

const { createMcpToolRegistry } = require('../../cli/lib/mcp_tool_registry.cjs');
const ORIGINAL_ALLOW_LEGACY_FLAGS = process.env.PANDORA_MCP_ALLOW_LEGACY_FLAGS;

function withLegacyFlagsEnabled(fn) {
  process.env.PANDORA_MCP_ALLOW_LEGACY_FLAGS = '1';
  try {
    return fn();
  } finally {
    if (ORIGINAL_ALLOW_LEGACY_FLAGS === undefined) {
      delete process.env.PANDORA_MCP_ALLOW_LEGACY_FLAGS;
    } else {
      process.env.PANDORA_MCP_ALLOW_LEGACY_FLAGS = ORIGINAL_ALLOW_LEGACY_FLAGS;
    }
  }
}

test('market execute tools expose agent workflow metadata and control inputs', () => {
  const registry = createMcpToolRegistry();
  const tools = registry.listTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const mirrorDeploy = byName.get('mirror.deploy');
  assert.ok(mirrorDeploy);
  assert.deepEqual(mirrorDeploy.inputSchema.xPandora.controlInputNames, ['agentPreflight']);
  assert.deepEqual(mirrorDeploy.inputSchema.xPandora.safeFlags, ['--dry-run']);
  assert.deepEqual(mirrorDeploy.inputSchema.xPandora.executeFlags, ['--execute']);
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

test('compatibility alias tools advertise their canonical replacement', () => {
  const registry = createMcpToolRegistry();
  const tool = registry.describeTool('arbitrage');

  assert.ok(tool);
  assert.equal(tool.inputSchema.xPandora.aliasOf, 'arb.scan');
  assert.equal(tool.inputSchema.xPandora.compatibilityAlias, true);
  assert.match(tool.description, /prefer arb\.scan/i);
});

test('default tool discovery hides compatibility aliases', () => {
  const registry = createMcpToolRegistry();
  const toolNames = registry.listTools().map((entry) => entry.name);

  assert.ok(toolNames.includes('arb.scan'));
  assert.equal(toolNames.includes('arbitrage'), false);
});

test('prepareInvocation rejects unknown top-level MCP arguments', () => {
  const registry = createMcpToolRegistry();

  assert.throws(
    () =>
      registry.prepareInvocation('help', {
        typoFlag: 'oops',
      }),
    (error) => error && error.code === 'MCP_UNKNOWN_ARGUMENTS' && /typoFlag/.test(error.message),
  );
});

test('prepareInvocation rejects raw positional MCP arguments', () => {
  const registry = createMcpToolRegistry();

  assert.throws(
    () =>
      registry.prepareInvocation('trade', {
        positionals: ['--execute'],
        'market-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        side: 'yes',
        'amount-usdc': 10,
      }),
    (error) => error && error.code === 'MCP_POSITIONALS_NOT_SUPPORTED',
  );
});

test('prepareInvocation rejects legacy nested flags by default', () => {
  const registry = createMcpToolRegistry();

  assert.throws(
    () =>
      registry.prepareInvocation('trade', {
        flags: {
          'market-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          side: 'yes',
          'amount-usdc': 10,
          'dry-run': true,
        },
      }),
    (error) => error && error.code === 'MCP_LEGACY_FLAGS_UNSUPPORTED',
  );
});

test('prepareInvocation accepts legacy nested flags only with explicit compatibility opt-in', () => {
  withLegacyFlagsEnabled(() => {
    const registry = createMcpToolRegistry();
    const invocation = registry.prepareInvocation('trade', {
      flags: {
        'market-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        side: 'yes',
        'amount-usdc': 10,
        'dry-run': true,
      },
    });

    assert.deepEqual(invocation.argv, [
      'trade',
      '--market-address',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--side',
      'yes',
      '--amount-usdc',
      '10',
      '--dry-run',
    ]);
  });
});

test('prepareInvocation still rejects unknown legacy flags when compatibility mode is enabled', () => {
  withLegacyFlagsEnabled(() => {
    const registry = createMcpToolRegistry();

    assert.throws(
      () =>
        registry.prepareInvocation('trade', {
          flags: {
            'market-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            side: 'yes',
            'amount-usdc': 10,
            'dry-run': true,
            typoFlag: 'oops',
          },
        }),
      (error) => error && error.code === 'MCP_UNKNOWN_ARGUMENTS' && /typoFlag/.test(error.message),
    );
  });
});

test('recipe MCP tools keep structured inputs out of argv and forward them via env', () => {
  const registry = createMcpToolRegistry();
  const invocation = registry.prepareInvocation('recipe.validate', {
    id: 'mirror.sync.paper-safe',
    inputs: {
      'market-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    'policy-id': 'paper-trading',
  });

  assert.deepEqual(invocation.argv, [
    'recipe',
    'validate',
    '--id',
    'mirror.sync.paper-safe',
    '--policy-id',
    'paper-trading',
  ]);
  assert.equal(
    invocation.env.PANDORA_RECIPE_INPUTS,
    JSON.stringify({ 'market-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
  );
});

test('prepareInvocation enforces typed schema values at the MCP boundary', () => {
  const registry = createMcpToolRegistry();

  assert.throws(
    () =>
      registry.prepareInvocation('mirror.deploy', {
        'polymarket-market-id': '0x-market',
        'dry-run': true,
        category: 3,
      }),
    (error) => error && error.code === 'MCP_INVALID_ARGUMENTS' && /category/i.test(error.message),
  );
});

test('prepareInvocation enforces structured agentPreflight payloads', () => {
  const registry = createMcpToolRegistry();

  assert.throws(
    () =>
      registry.prepareInvocation('mirror.deploy', {
        intent: { execute: true },
        'polymarket-market-id': '0x-market',
        execute: true,
        agentPreflight: {
          validationTicket: 'market-validate:abc123',
          validationDecision: 'PASS',
        },
      }),
    (error) => error && error.code === 'MCP_INVALID_ARGUMENTS' && /agentPreflight/i.test(error.message),
  );
});

test('prepareInvocation rejects mutually-exclusive mirror argument combinations', () => {
  const registry = createMcpToolRegistry();

  assert.throws(
    () =>
      registry.prepareInvocation('mirror.deploy', {
        'polymarket-market-id': '0x-market',
        'dry-run': true,
        execute: true,
      }),
    (error) => error && error.code === 'MCP_INVALID_ARGUMENTS' && /mutually-exclusive|exclusive argument combination/i.test(error.message),
  );

  assert.throws(
    () =>
      registry.prepareInvocation('mirror.close', {
        all: true,
        'market-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'dry-run': true,
      }),
    (error) => error && error.code === 'MCP_INVALID_ARGUMENTS' && /mutually-exclusive|exclusive argument combination/i.test(error.message),
  );
});
