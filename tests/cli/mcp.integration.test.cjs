const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { createMcpToolRegistry } = require('../../cli/lib/mcp_tool_registry.cjs');

const { CLI_PATH, REPO_ROOT, createTempDir, removeDir } = require('../helpers/cli_runner.cjs');

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

function extractStructuredEnvelope(callResult) {
  const envelope = callResult && callResult.structuredContent;
  assert.equal(typeof envelope, 'object');
  assert.notEqual(envelope, null);
  assert.equal(typeof envelope.ok, 'boolean');
  return envelope;
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
    assert.ok(toolNames.includes('agent.market.autocomplete'));
    assert.ok(toolNames.includes('agent.market.validate'));
    assert.ok(!toolNames.includes('launch'));
    assert.ok(!toolNames.includes('clone-bet'));
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

    const mirrorDeploy = byName.get('mirror.deploy');
    assert.ok(mirrorDeploy);
    assert.deepEqual(mirrorDeploy.inputSchema.xPandora.controlInputNames, ['agentPreflight']);
    assert.equal(mirrorDeploy.inputSchema.xPandora.agentWorkflow.executeRequiresValidation, true);
    assert.deepEqual(mirrorDeploy.inputSchema.xPandora.agentWorkflow.requiredTools, ['agent.market.validate']);

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

test('mcp still accepts legacy nested flags payloads for backward compatibility', async () => {
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
    assert.equal(envelope.command, 'quote');
  });
});

test('mcp blocks odds.record because it is long-running/unbounded', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'odds.record',
      arguments: {
        flags: {
          competition: 'soccer_epl',
          interval: 60,
          'max-samples': 1000,
        },
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
        flags: {
          trials: 500,
          horizon: 16,
          seed: 17,
        },
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
        flags: {
          'group-by': 'source',
          'bucket-count': 5,
        },
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
          flags: {
            input: inputPath,
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

test('mcp model.calibrate blocks --save-model paths outside workspace', async () => {
  const outsideDir = createTempDir('pandora-mcp-outside-save-model-');
  const modelPath = path.join(outsideDir, 'artifact.json');

  try {
    await withMcpClient(async (client) => {
      const call = await client.callTool({
        name: 'model.calibrate',
        arguments: {
          flags: {
            returns: '0.01,0.02,-0.01,0.03,-0.02',
            'save-model': modelPath,
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

test('mcp lifecycle.start blocks reading config outside workspace', async () => {
  const outsideDir = createTempDir('pandora-mcp-outside-lifecycle-');
  const configPath = path.join(outsideDir, 'lifecycle.json');
  fs.writeFileSync(configPath, '{}\n');

  try {
    await withMcpClient(async (client) => {
      const call = await client.callTool({
        name: 'lifecycle.start',
        arguments: {
          flags: {
            config: configPath,
          },
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

test('mcp sports.create.plan blocks reading model files outside workspace', async () => {
  const outsideDir = createTempDir('pandora-mcp-outside-model-');
  const modelPath = path.join(outsideDir, 'model.json');
  fs.writeFileSync(modelPath, '{"probability":0.62,"confidence":"high","source":"test"}\n');

  try {
    await withMcpClient(async (client) => {
      const call = await client.callTool({
        name: 'sports.create.plan',
        arguments: {
          flags: {
            'event-id': 'evt-1',
            'model-file': modelPath,
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

test('mcp risk.panic requires explicit execute intent', async () => {
  await withMcpClient(async (client) => {
    const call = await client.callTool({
      name: 'risk.panic',
      arguments: {
        flags: {
          reason: 'incident',
        },
      },
    });
    const envelope = extractStructuredEnvelope(call);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'MCP_EXECUTE_INTENT_REQUIRED');
    assert.equal(call.isError, true);
  });
});

test('mcp panic lock blocks live write tools until cleared', async () => {
  const tempHome = createTempDir('pandora-mcp-risk-');
  try {
    await withMcpClient(async (client) => {
      const engage = await client.callTool({
        name: 'risk.panic',
        arguments: {
          flags: {
            reason: 'incident',
          },
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
          flags: {
            'poll-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            answer: 'yes',
            reason: 'mcp resolve',
            execute: true,
          },
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
          flags: {
            clear: true,
          },
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
