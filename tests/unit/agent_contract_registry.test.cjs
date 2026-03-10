const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const generatedCommandDescriptors = require('../../sdk/generated/command-descriptors.json');
const generatedMcpToolDefinitions = require('../../sdk/generated/mcp-tool-definitions.json');
const { buildCommandDescriptors, buildMcpToolDefinitions } = require('../../cli/lib/agent_contract_registry.cjs');
const { ROUTED_TOP_LEVEL_COMMANDS } = require('../../cli/lib/command_router.cjs');
const { buildSdkContractComponents } = require('../../cli/lib/sdk_contract_service.cjs');
const {
  normalizeCommandDescriptorsForParity,
  normalizeToolDefinitionsForParity,
} = require('../helpers/contract_parity_assertions.cjs');

const CLI_ROOT = path.resolve(__dirname, '../../cli');
const EXCLUDED_FILES = new Set([
  path.resolve(CLI_ROOT, 'lib/agent_contract_registry.cjs'),
  path.resolve(CLI_ROOT, 'lib/schema_command_service.cjs'),
]);
const GENERATED_CONTRACT_GAP_COMMANDS = new Set([
  'bootstrap',
  'policy',
  'policy.explain',
  'policy.recommend',
  'profile',
  'profile.recommend',
  'markets',
  'markets.list',
  'markets.mine',
  'markets.scan',
  'scan',
  'quote',
  'dashboard',
  'fund-check',
  'mirror',
  'mirror.calc',
  'mirror.dashboard',
  'mirror.drift',
  'mirror.hedge-check',
  'mirror.hedge-calc',
  'mirror.status',
  'polymarket.check',
  'polymarket.preflight',
  'polymarket.balance',
  'trade.quote',
  'sell.quote',
  'arbitrage',
]);

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (entry.isFile() && full.endsWith('.cjs') && !EXCLUDED_FILES.has(full)) {
      files.push(full);
    }
  }
  return files;
}

function collectEmittedHelpCommands() {
  const emitted = new Set();
  for (const file of walk(CLI_ROOT)) {
    const text = fs.readFileSync(file, 'utf8');
    const regex = /emitSuccess\([\s\S]{0,200}?["']([a-z0-9.-]+\.help)["']/g;
    let match;
    while ((match = regex.exec(text))) {
      emitted.add(match[1]);
    }
  }
  return emitted;
}

function sortByName(left, right) {
  return String(left && left.name ? left.name : '').localeCompare(String(right && right.name ? right.name : ''));
}

function omitGeneratedGapDescriptors(descriptors) {
  const next = { ...descriptors };
  for (const commandName of GENERATED_CONTRACT_GAP_COMMANDS) {
    delete next[commandName];
  }
  return next;
}

function omitGeneratedGapToolDefinitions(definitions) {
  return definitions.filter((definition) => definition && !GENERATED_CONTRACT_GAP_COMMANDS.has(definition.name));
}

function getCompositeBranches(schema, keyword) {
  if (!schema || typeof schema !== 'object') return [];
  const allOf = Array.isArray(schema.allOf) ? schema.allOf : [];
  const branch = allOf.find((entry) => entry && typeof entry === 'object' && Array.isArray(entry[keyword]));
  if (branch && Array.isArray(branch[keyword])) {
    return branch[keyword];
  }
  const pandora = schema.xPandora && typeof schema.xPandora === 'object' ? schema.xPandora : null;
  if (!pandora) return [];
  if (keyword === 'anyOf' && Array.isArray(pandora.requiredAnyOf)) {
    return pandora.requiredAnyOf;
  }
  if (keyword === 'oneOf' && Array.isArray(pandora.exclusiveOneOf)) {
    return pandora.exclusiveOneOf;
  }
  return [];
}

test('shared agent contract registry covers all MCP tools with canonical metadata', () => {
  const descriptors = buildCommandDescriptors();
  const mcpTools = buildMcpToolDefinitions();
  const mcpToolNames = new Set(mcpTools.map((tool) => tool.name));

  for (const tool of mcpTools) {
    const descriptor = descriptors[tool.name];
    assert.ok(descriptor, `missing descriptor for ${tool.name}`);
    assert.equal(descriptor.mcpExposed, true, `descriptor should mark ${tool.name} as MCP-exposed`);
    assert.equal(descriptor.canonicalTool, tool.canonicalTool, `canonicalTool mismatch for ${tool.name}`);
    assert.equal(descriptor.aliasOf, tool.aliasOf || null, `aliasOf mismatch for ${tool.name}`);
    assert.equal(descriptor.preferred, tool.preferred !== false, `preferred mismatch for ${tool.name}`);
    assert.equal(descriptor.mcpMutating, Boolean(tool.mutating), `mcpMutating mismatch for ${tool.name}`);
    assert.equal(
      descriptor.mcpLongRunningBlocked,
      Boolean(tool.longRunningBlocked),
      `mcpLongRunningBlocked mismatch for ${tool.name}`,
    );
    assert.deepEqual(
      descriptor.controlInputNames,
      Array.isArray(tool.controlInputNames) ? tool.controlInputNames : [],
      `controlInputNames mismatch for ${tool.name}`,
    );
    assert.deepEqual(
      descriptor.agentWorkflow,
      tool.agentWorkflow || null,
      `agentWorkflow mismatch for ${tool.name}`,
    );
    assert.equal(typeof descriptor.inputSchema, 'object', `missing inputSchema for ${tool.name}`);
  }

  for (const [commandName, descriptor] of Object.entries(descriptors)) {
    if (descriptor.mcpExposed) {
      assert.ok(mcpToolNames.has(commandName), `descriptor marked ${commandName} as MCP-exposed but no MCP tool exists`);
    }
  }
});

test('generated MCP tool schemas avoid top-level allOf/anyOf/oneOf combinators', () => {
  const toolDefinitions = buildMcpToolDefinitions();

  for (const tool of toolDefinitions) {
    assert.equal(Array.isArray(tool.inputSchema && tool.inputSchema.allOf), false, `${tool.name} should not expose top-level allOf`);
    assert.equal(Array.isArray(tool.inputSchema && tool.inputSchema.anyOf), false, `${tool.name} should not expose top-level anyOf`);
    assert.equal(Array.isArray(tool.inputSchema && tool.inputSchema.oneOf), false, `${tool.name} should not expose top-level oneOf`);
  }
});

test('shared agent contract registry declares every emitted help command', () => {
  const descriptors = buildCommandDescriptors();
  const declaredHelps = new Set();
  for (const descriptor of Object.values(descriptors)) {
    for (const emit of descriptor.emits || []) {
      if (String(emit).endsWith('.help') || emit === 'help') {
        declaredHelps.add(String(emit));
      }
    }
  }

  const emittedHelps = collectEmittedHelpCommands();
  for (const helpCommand of emittedHelps) {
    assert.ok(declaredHelps.has(helpCommand), `missing emitted help contract for ${helpCommand}`);
  }
});

test('shared agent contract registry covers every routed top-level command family', () => {
  const descriptors = buildCommandDescriptors();
  const topLevelDescriptors = new Set(
    Object.keys(descriptors).filter((name) => !String(name).includes('.')),
  );

  for (const commandName of ROUTED_TOP_LEVEL_COMMANDS) {
    assert.ok(topLevelDescriptors.has(commandName), `missing top-level descriptor for routed command ${commandName}`);
  }
});

test('mirror and sports create schemas expose category names and required selector invariants', () => {
  const descriptors = buildCommandDescriptors();

  const mirrorDeploy = descriptors['mirror.deploy'];
  assert.ok(mirrorDeploy);
  assert.deepEqual(
    mirrorDeploy.inputSchema.properties.category.anyOf[1].enum,
    ['Politics', 'Sports', 'Finance', 'Crypto', 'Culture', 'Technology', 'Science', 'Entertainment', 'Health', 'Environment', 'Other'],
  );
  assert.ok(
    getCompositeBranches(mirrorDeploy.inputSchema, 'anyOf').some((branch) =>
      Array.isArray(branch.required) && branch.required.includes('plan-file') && branch.required.includes('dry-run')),
    'mirror.deploy should require a selector plus mode branch',
  );
  assert.ok(
    getCompositeBranches(mirrorDeploy.inputSchema, 'oneOf').some((branch) =>
      Array.isArray(branch.required)
        && branch.required.includes('plan-file')
        && branch.required.includes('dry-run')
        && branch.not
        && Array.isArray(branch.not.anyOf),
    ),
    'mirror.deploy should encode exclusive selector/mode branches',
  );

  const mirrorClose = descriptors['mirror.close'];
  assert.ok(
    getCompositeBranches(mirrorClose.inputSchema, 'anyOf').some((branch) =>
      Array.isArray(branch.required) && branch.required.includes('all') && branch.required.includes('execute')),
    'mirror.close should allow all+execute branch',
  );
  assert.ok(
    getCompositeBranches(mirrorClose.inputSchema, 'anyOf').some((branch) =>
      Array.isArray(branch.required)
        && branch.required.includes('pandora-market-address')
        && branch.required.includes('polymarket-market-id')
        && branch.required.includes('dry-run')),
    'mirror.close should allow paired selector dry-run branch',
  );
  assert.ok(
    getCompositeBranches(mirrorClose.inputSchema, 'oneOf').some((branch) =>
      Array.isArray(branch.required)
        && branch.required.includes('all')
        && branch.required.includes('execute')
        && branch.not
        && Array.isArray(branch.not.anyOf),
    ),
    'mirror.close should encode exclusive selector/mode branches',
  );

  const sportsCreatePlan = descriptors['sports.create.plan'];
  assert.ok(sportsCreatePlan);
  assert.equal(sportsCreatePlan.inputSchema.properties.category.anyOf[1].enum[1], 'Sports');
});

test('policy and profile command contracts are exposed with typed MCP schemas', () => {
  const descriptors = buildCommandDescriptors();

  const policyList = descriptors['policy.list'];
  assert.ok(policyList);
  assert.equal(policyList.mcpExposed, true);
  assert.equal(policyList.dataSchema, '#/definitions/PolicyListPayload');

  const policyGet = descriptors['policy.get'];
  assert.ok(policyGet);
  assert.equal(policyGet.inputSchema.properties.id.type, 'string');

  const policyExplain = descriptors['policy.explain'];
  assert.ok(policyExplain);
  assert.equal(policyExplain.mcpExposed, true);
  assert.equal(policyExplain.dataSchema, '#/definitions/PolicyExplainPayload');
  assert.equal(policyExplain.inputSchema.properties.id.type, 'string');
  assert.equal(policyExplain.inputSchema.properties.command.type, 'string');
  assert.equal(policyExplain.inputSchema.properties['profile-id'].type, 'string');

  const policyRecommend = descriptors['policy.recommend'];
  assert.ok(policyRecommend);
  assert.equal(policyRecommend.mcpExposed, true);
  assert.equal(policyRecommend.dataSchema, '#/definitions/PolicyRecommendPayload');
  assert.equal(policyRecommend.inputSchema.properties.command.type, 'string');
  assert.equal(policyRecommend.inputSchema.properties['profile-id'].type, 'string');

  const profileList = descriptors['profile.list'];
  assert.ok(profileList);
  assert.equal(profileList.mcpExposed, true);
  assert.equal(profileList.dataSchema, '#/definitions/ProfileListPayload');

  const profileValidate = descriptors['profile.validate'];
  assert.ok(profileValidate);
  assert.equal(profileValidate.inputSchema.properties.file.type, 'string');

  const profileGet = descriptors['profile.get'];
  assert.ok(profileGet);
  assert.equal(profileGet.inputSchema.properties.command.type, 'string');
  assert.equal(profileGet.inputSchema.properties.mode.type, 'string');
  assert.equal(profileGet.inputSchema.properties['chain-id'].type, 'string');
  assert.equal(profileGet.inputSchema.properties.category.type, 'string');
  assert.equal(profileGet.inputSchema.properties['policy-id'].type, 'string');

  const profileExplain = descriptors['profile.explain'];
  assert.ok(profileExplain);
  assert.equal(profileExplain.inputSchema.properties.command.type, 'string');
  assert.equal(profileExplain.inputSchema.properties['policy-id'].type, 'string');

  const profileRecommend = descriptors['profile.recommend'];
  assert.ok(profileRecommend);
  assert.equal(profileRecommend.mcpExposed, true);
  assert.equal(profileRecommend.dataSchema, '#/definitions/ProfileRecommendPayload');
  assert.equal(profileRecommend.inputSchema.properties.command.type, 'string');
  assert.equal(profileRecommend.inputSchema.properties['policy-id'].type, 'string');
  assert.equal(profileRecommend.inputSchema.properties['no-builtins'].type, 'boolean');
  assert.equal(profileRecommend.inputSchema.properties['builtin-only'].type, 'boolean');

  const sportsOddsBulk = descriptors['sports.odds.bulk'];
  assert.ok(sportsOddsBulk);
  assert.equal(sportsOddsBulk.mcpExposed, true);
  assert.equal(sportsOddsBulk.dataSchema, '#/definitions/SportsBulkOddsPayload');
  assert.equal(sportsOddsBulk.inputSchema.properties.competition.type, 'string');

  const operationsReceipt = descriptors['operations.receipt'];
  assert.ok(operationsReceipt);
  assert.equal(operationsReceipt.mcpExposed, true);
  assert.equal(operationsReceipt.dataSchema, '#/definitions/OperationReceiptPayload');
  assert.equal(operationsReceipt.inputSchema.properties.id.type, 'string');

  const operationsVerifyReceipt = descriptors['operations.verify-receipt'];
  assert.ok(operationsVerifyReceipt);
  assert.equal(operationsVerifyReceipt.mcpExposed, true);
  assert.equal(operationsVerifyReceipt.dataSchema, '#/definitions/OperationReceiptVerificationPayload');
  assert.equal(operationsVerifyReceipt.inputSchema.properties.id.type, 'string');
});

test('direct signer-bearing command contracts expose profile selectors alongside raw-key fallback', () => {
  const descriptors = buildCommandDescriptors();
  for (const commandName of ['trade', 'sell', 'lp.add', 'lp.remove', 'resolve', 'claim', 'sports.create.run', 'mirror.deploy', 'mirror.go', 'mirror.sync.once', 'mirror.sync.run', 'mirror.sync.start']) {
    const descriptor = descriptors[commandName];
    assert.ok(descriptor, `missing descriptor for ${commandName}`);
    assert.equal(descriptor.inputSchema.properties['profile-id'].type, 'string', `${commandName} missing profile-id schema`);
    assert.equal(descriptor.inputSchema.properties['profile-file'].type, 'string', `${commandName} missing profile-file schema`);
    assert.equal(descriptor.inputSchema.properties['private-key'].type, 'string', `${commandName} missing private-key compatibility schema`);
    assert.match(descriptor.usage, /--profile-id <id>\|--profile-file <path>/, `${commandName} usage missing profile selector guidance`);
  }
});

test('mirror contract descriptors expose separate-leg sync truth, reserve provenance, and fallback knobs', () => {
  const descriptors = buildCommandDescriptors();

  assert.match(
    descriptors['mirror.go'].summary,
    /separate Pandora rebalance and Polymarket hedge legs/i,
  );
  assert.match(
    descriptors['mirror.go'].inputSchema.properties['polymarket-rpc-url'].description,
    /comma-separated fallbacks/i,
  );
  assert.deepEqual(
    descriptors['mirror.go'].inputSchema.properties['rebalance-mode'].enum,
    ['atomic', 'incremental'],
  );
  assert.deepEqual(
    descriptors['mirror.go'].inputSchema.properties['price-source'].enum,
    ['on-chain', 'indexer'],
  );
  assert.equal(
    descriptors['mirror.go'].inputSchema.properties['depth-slippage-bps'].type,
    'integer',
  );
  assert.equal(
    descriptors['mirror.go'].inputSchema.properties['min-time-to-close-sec'].type,
    'integer',
  );
  assert.equal(
    descriptors['mirror.go'].inputSchema.properties['strict-close-time-delta'].type,
    'boolean',
  );
  assert.equal(
    descriptors['mirror.go'].inputSchema.properties['auto-resolve'].type,
    'boolean',
  );
  assert.deepEqual(
    descriptors['mirror.go'].inputSchema.properties['resolve-answer'].enum,
    ['yes', 'no'],
  );
  assert.match(
    descriptors['mirror.go'].usage,
    /--auto-resolve.*--auto-close.*--resolve-answer yes\|no.*--resolve-reason <text>/,
  );
  assert.match(
    descriptors['mirror.go'].usage,
    /--depth-slippage-bps <n>.*--min-time-to-close-sec <n>.*--strict-close-time-delta/,
  );

  assert.match(
    descriptors['mirror.sync'].summary,
    /separate Pandora rebalance and Polymarket hedge legs/i,
  );
  assert.match(
    descriptors['mirror.sync.once'].usage,
    /--strict-close-time-delta/,
  );
  assert.match(
    descriptors['mirror.sync.once'].summary,
    /separate Pandora rebalance and Polymarket hedge legs/i,
  );
  assert.match(
    descriptors['mirror.sync.once'].inputSchema.properties['strict-close-time-delta'].description,
    /diagnostic to blocking/i,
  );
  assert.match(
    descriptors['mirror.sync.once'].inputSchema.properties['polymarket-rpc-url'].description,
    /comma-separated fallbacks/i,
  );
  assert.deepEqual(
    descriptors['mirror.sync.once'].inputSchema.properties['rebalance-mode'].enum,
    ['atomic', 'incremental'],
  );
  assert.deepEqual(
    descriptors['mirror.sync.once'].inputSchema.properties['price-source'].enum,
    ['on-chain', 'indexer'],
  );
  assert.deepEqual(
    descriptors['mirror.sync.run'].inputSchema.properties['rebalance-mode'].enum,
    ['atomic', 'incremental'],
  );
  assert.deepEqual(
    descriptors['mirror.sync.start'].inputSchema.properties['price-source'].enum,
    ['on-chain', 'indexer'],
  );

  assert.match(
    descriptors['mirror.sync.status'].summary,
    /health\/status metadata/i,
  );

  assert.match(
    descriptors['mirror.status'].summary,
    /graceful fallback behavior/i,
  );
  assert.match(
    descriptors['mirror.health'].summary,
    /machine-usable mirror daemon\/runtime health/i,
  );
  assert.match(
    descriptors['mirror.health'].usage,
    /--pid-file <path>/,
  );
  assert.match(
    descriptors['mirror.panic'].summary,
    /global risk panic lock/i,
  );
  assert.match(
    descriptors['mirror.panic'].usage,
    /--all \[--risk-file <path>\] \[--reason <text>\] \[--actor <id>\] \[--clear\]/,
  );
  assert.match(
    descriptors['mirror.status'].usage,
    /--indexer-url <url>/,
  );
  assert.match(
    descriptors['mirror.status'].usage,
    /--polymarket-host <url>/,
  );
  assert.match(
    descriptors['mirror.status'].inputSchema.properties['with-live'].description,
    /diagnostics instead of hard failure/i,
  );
  assert.equal(
    descriptors['mirror.status'].dataSchema,
    '#/definitions/MirrorStatusPayload',
  );
  assert.match(
    descriptors['mirror.pnl'].summary,
    /scenario P&L surface/i,
  );
  assert.match(
    descriptors['mirror.pnl'].usage,
    /--indexer-url <url>/,
  );
  assert.equal(
    descriptors['mirror.pnl'].dataSchema,
    '#/definitions/MirrorPnlPayload',
  );
  assert.match(
    descriptors['mirror.audit'].summary,
    /audit ledger/i,
  );
  assert.match(
    descriptors['mirror.audit'].inputSchema.properties['with-live'].description,
    /live cross-venue context/i,
  );
  assert.equal(
    descriptors['mirror.audit'].dataSchema,
    '#/definitions/MirrorAuditPayload',
  );
  assert.match(
    descriptors['mirror.hedge-calc'].summary,
    /offline hedge sizing/i,
  );
  assert.match(
    descriptors['mirror.hedge-calc'].usage,
    /--reserve-yes-usdc <n> --reserve-no-usdc <n>/,
  );
  assert.equal(
    descriptors['mirror.hedge-calc'].inputSchema.properties['reserve-yes-usdc'].type,
    'number',
  );
  assert.equal(
    descriptors['mirror.hedge-calc'].inputSchema.properties['reserve-no-usdc'].type,
    'number',
  );
  assert.equal(
    descriptors['mirror.hedge-calc'].inputSchema.properties['fee-tier'].type,
    'integer',
  );
  assert.ok(descriptors['lp.simulate-remove']);
  assert.equal(
    descriptors['lp.simulate-remove'].dataSchema,
    '#/definitions/LpPayload',
  );
  assert.match(
    descriptors.lp.usage,
    /lp simulate-remove --market-address <address>/,
  );
});

test('registry exposes the implemented batch-1 public surfaces and workflow aliases', () => {
  const descriptors = buildCommandDescriptors();
  const toolDefinitions = Object.fromEntries(buildMcpToolDefinitions().map((tool) => [tool.name, tool]));

  assert.match(descriptors.quote.usage, /--target-pct <0-100>/);
  assert.equal(descriptors.quote.inputSchema.properties['target-pct'].type, 'number');
  assert.match(toolDefinitions.quote.description, /buy-only/i);
  assert.ok(descriptors.dashboard);
  assert.ok(descriptors['fund-check']);
  assert.ok(descriptors.fees);
  assert.ok(descriptors['fees.withdraw']);
  assert.ok(descriptors['debug.market']);
  assert.ok(descriptors['debug.tx']);
  assert.ok(descriptors['mirror.dashboard']);
  assert.ok(descriptors['mirror.calc']);
  assert.match(descriptors.dashboard.summary, /active-mirror operator dashboard/i);
  assert.match(descriptors['fund-check'].summary, /hedge funding needs/i);
  assert.match(descriptors.fees.summary, /oracle-fee history/i);
  assert.match(descriptors['fees.withdraw'].summary, /withdrawProtocolFees/i);
  assert.equal(descriptors['fees.withdraw'].mcpMutating, true);
  assert.deepEqual(descriptors['fees.withdraw'].safeFlags, ['--dry-run']);
  assert.deepEqual(descriptors['fees.withdraw'].executeFlags, ['--execute']);
  assert.match(descriptors['debug.market'].summary, /single-market forensic snapshot/i);
  assert.match(descriptors['debug.tx'].summary, /transaction hash/i);
  assert.match(descriptors['mirror.dashboard'].summary, /operator summary/i);
  assert.match(descriptors['mirror.calc'].summary, /target percentage/i);
  assert.ok(descriptors['markets.mine']);
  assert.match(descriptors['markets.mine'].summary, /wallet-owned/i);
  assert.equal(toolDefinitions['markets.mine'].canonicalTool, 'markets.mine');
  assert.match(descriptors['mirror.status'].summary, /dashboard/i);
  assert.ok(descriptors['mirror.drift']);
  assert.ok(descriptors['mirror.hedge-check']);
  assert.ok(descriptors['mirror.logs']);
  assert.ok(descriptors['mirror.replay']);
  assert.match(descriptors['mirror.drift'].summary, /drift\/readiness/i);
  assert.match(descriptors['mirror.hedge-check'].summary, /hedge-gap\/readiness/i);
  assert.equal(descriptors['mirror.trace'].dataSchema, '#/definitions/MirrorTracePayload');
  assert.deepEqual(descriptors['mirror.trace'].inputSchema.required, ['rpc-url']);
  assert.deepEqual(
    getCompositeBranches(descriptors['mirror.trace'].inputSchema, 'oneOf').map((branch) => branch.required),
    [['blocks'], ['from-block', 'to-block']],
  );
  assert.deepEqual(
    getCompositeBranches(descriptors['mirror.trace'].inputSchema, 'oneOf')[0].not.anyOf,
    [{ required: ['from-block', 'to-block'] }, { required: ['from-block'] }, { required: ['to-block'] }],
  );
  assert.ok(
    getCompositeBranches(descriptors['mirror.trace'].inputSchema, 'oneOf')[1].not.anyOf.some((branch) =>
      Array.isArray(branch.required) && branch.required.length === 1 && branch.required[0] === 'blocks'
    ),
  );
  assert.match(descriptors['mirror.logs'].summary, /daemon log/i);
  assert.match(descriptors['mirror.logs'].usage, /--follow/);
  assert.equal(descriptors['mirror.logs'].inputSchema.properties.follow.type, 'boolean');
  assert.equal(descriptors['mirror.logs'].inputSchema.properties['poll-interval-ms'].type, 'integer');
  assert.equal(descriptors['mirror.logs'].inputSchema.properties['follow-timeout-ms'].type, 'integer');
  assert.match(descriptors['mirror.replay'].summary, /persisted mirror execution history/i);
  assert.match(toolDefinitions['mirror.status'].description, /status\/dashboard payload/i);
  assert.match(toolDefinitions['mirror.drift'].description, /drift\/readiness/i);
  assert.match(toolDefinitions['mirror.hedge-check'].description, /hedge-gap\/readiness/i);
  assert.equal(toolDefinitions['mirror.logs'].canonicalTool, 'mirror.logs');
  assert.match(toolDefinitions['mirror.logs'].description, /structured daemon JSONL/i);
  assert.equal(toolDefinitions['mirror.replay'].canonicalTool, 'mirror.replay');
  assert.match(descriptors['mirror.hedge-calc'].summary, /offline hedge sizing/i);
  assert.match(descriptors['polymarket.check'].summary, /lower-level readiness primitive/i);
  assert.equal(descriptors['polymarket.positions'].dataSchema, '#/definitions/PolymarketPositionsPayload');
  assert.deepEqual(
    getCompositeBranches(descriptors['polymarket.positions'].inputSchema, 'oneOf').map((branch) => branch.required),
    [undefined, ['condition-id'], ['slug'], ['token-id']],
  );
  assert.match(toolDefinitions['polymarket.positions'].description, /YES\/NO inventory/i);
  assert.match(toolDefinitions['polymarket.balance'].description, /signer\/proxy funding balances/i);
  assert.match(toolDefinitions.fees.description, /oracle-fee events/i);
  assert.match(toolDefinitions['fees.withdraw'].description, /withdrawProtocolFees/i);
  assert.match(toolDefinitions['debug.market'].description, /forensic snapshot/i);
  assert.match(toolDefinitions['debug.tx'].description, /transaction hash/i);
});

test('generated descriptor and MCP tool slices stay in sync with the live registry builders', () => {
  assert.deepEqual(
    normalizeCommandDescriptorsForParity(omitGeneratedGapDescriptors(generatedCommandDescriptors)),
    normalizeCommandDescriptorsForParity(omitGeneratedGapDescriptors(buildCommandDescriptors())),
  );
  const compiled = buildSdkContractComponents({
    packageVersion: require('../../package.json').version,
    remoteTransportActive: false,
  });
  assert.deepEqual(
    normalizeToolDefinitionsForParity(omitGeneratedGapToolDefinitions(generatedMcpToolDefinitions)),
    normalizeToolDefinitionsForParity(omitGeneratedGapToolDefinitions(compiled.mcpToolDefinitions.slice().sort(sortByName))),
  );
});

test('bootstrap contract exists as a canonical remote-eligible discovery tool and aliases remain demoted', () => {
  const descriptors = buildCommandDescriptors();
  const bootstrap = descriptors.bootstrap;
  assert.ok(bootstrap);
  assert.equal(bootstrap.mcpExposed, true);
  assert.equal(bootstrap.canonicalTool, 'bootstrap');
  assert.equal(bootstrap.preferred, true);
  assert.deepEqual(bootstrap.outputModes, ['json']);
  assert.equal(bootstrap.riskLevel, 'low');
  assert.equal(bootstrap.supportsRemote, true);
  assert.equal(bootstrap.remoteEligible, true);
  assert.deepEqual(bootstrap.agentWorkflow.requiredTools, ['capabilities', 'schema']);
  assert.deepEqual(bootstrap.agentWorkflow.recommendedTools, ['help']);
  assert.match(bootstrap.agentWorkflow.notes[2], /aliasOf entries/);

  const arbitrage = descriptors.arbitrage;
  assert.ok(arbitrage);
  assert.equal(arbitrage.aliasOf, 'arb.scan');
  assert.equal(arbitrage.preferred, false);
  assert.equal(arbitrage.canonicalTool, 'arb.scan');
});

test('shared agent contract registry normalizes MCP metadata defaults and alias metadata', () => {
  const descriptors = buildCommandDescriptors();
  const mcpDefinitions = new Map(buildMcpToolDefinitions().map((definition) => [definition.name, definition]));

  const helpDefinition = mcpDefinitions.get('help');
  assert.ok(helpDefinition);
  assert.equal(helpDefinition.aliasOf, null);
  assert.equal(helpDefinition.canonicalTool, 'help');
  assert.equal(helpDefinition.preferred, true);
  assert.equal(helpDefinition.mutating, false);
  assert.equal(helpDefinition.longRunningBlocked, false);
  assert.equal(helpDefinition.placeholderBlocked, false);
  assert.deepEqual(helpDefinition.safeFlags, []);
  assert.deepEqual(helpDefinition.executeFlags, []);
  assert.deepEqual(helpDefinition.controlInputNames, []);
  assert.equal(helpDefinition.agentWorkflow, null);

  const helpDescriptor = descriptors.help;
  assert.ok(helpDescriptor);
  assert.equal(helpDescriptor.aliasOf, null);
  assert.equal(helpDescriptor.canonicalTool, 'help');
  assert.equal(helpDescriptor.preferred, true);
  assert.equal(helpDescriptor.mcpMutating, false);
  assert.equal(helpDescriptor.mcpLongRunningBlocked, false);
  assert.deepEqual(helpDescriptor.controlInputNames, []);
  assert.equal(helpDescriptor.agentWorkflow, null);

  const bootstrapDefinition = mcpDefinitions.get('bootstrap');
  assert.ok(bootstrapDefinition);
  assert.equal(bootstrapDefinition.aliasOf, null);
  assert.equal(bootstrapDefinition.canonicalTool, 'bootstrap');
  assert.equal(bootstrapDefinition.preferred, true);
  assert.equal(bootstrapDefinition.mutating, false);
  assert.equal(bootstrapDefinition.longRunningBlocked, false);
  assert.equal(bootstrapDefinition.placeholderBlocked, false);
  assert.deepEqual(bootstrapDefinition.safeFlags, []);
  assert.deepEqual(bootstrapDefinition.executeFlags, []);
  assert.deepEqual(bootstrapDefinition.controlInputNames, []);
  assert.deepEqual(bootstrapDefinition.agentWorkflow.requiredTools, ['capabilities', 'schema']);

  const bootstrapDescriptor = descriptors.bootstrap;
  assert.ok(bootstrapDescriptor);
  assert.equal(bootstrapDescriptor.aliasOf, null);
  assert.equal(bootstrapDescriptor.canonicalTool, 'bootstrap');
  assert.equal(bootstrapDescriptor.preferred, true);
  assert.equal(bootstrapDescriptor.mcpMutating, false);
  assert.equal(bootstrapDescriptor.mcpLongRunningBlocked, false);
  assert.deepEqual(bootstrapDescriptor.controlInputNames, []);
  assert.deepEqual(bootstrapDescriptor.agentWorkflow, bootstrapDefinition.agentWorkflow);
  assert.equal(bootstrapDescriptor.executeIntentRequired, false);
  assert.equal(bootstrapDescriptor.executeIntentRequiredForLiveMode, false);
  assert.equal(bootstrapDescriptor.supportsRemote, true);
  assert.equal(bootstrapDescriptor.remoteEligible, true);

  const policyRecommendDefinition = mcpDefinitions.get('policy.recommend');
  assert.ok(policyRecommendDefinition);
  assert.equal(policyRecommendDefinition.aliasOf, null);
  assert.equal(policyRecommendDefinition.canonicalTool, 'policy.recommend');
  assert.equal(policyRecommendDefinition.preferred, true);
  assert.equal(policyRecommendDefinition.mutating, false);
  assert.deepEqual(policyRecommendDefinition.controlInputNames, []);

  const policyRecommendDescriptor = descriptors['policy.recommend'];
  assert.ok(policyRecommendDescriptor);
  assert.equal(policyRecommendDescriptor.aliasOf, null);
  assert.equal(policyRecommendDescriptor.canonicalTool, 'policy.recommend');
  assert.equal(policyRecommendDescriptor.preferred, true);
  assert.equal(policyRecommendDescriptor.mcpMutating, false);
  assert.equal(policyRecommendDescriptor.supportsRemote, true);
  assert.equal(policyRecommendDescriptor.remoteEligible, true);

  const profileRecommendDefinition = mcpDefinitions.get('profile.recommend');
  assert.ok(profileRecommendDefinition);
  assert.equal(profileRecommendDefinition.aliasOf, null);
  assert.equal(profileRecommendDefinition.canonicalTool, 'profile.recommend');
  assert.equal(profileRecommendDefinition.preferred, true);
  assert.equal(profileRecommendDefinition.mutating, false);
  assert.deepEqual(profileRecommendDefinition.controlInputNames, []);

  const profileRecommendDescriptor = descriptors['profile.recommend'];
  assert.ok(profileRecommendDescriptor);
  assert.equal(profileRecommendDescriptor.aliasOf, null);
  assert.equal(profileRecommendDescriptor.canonicalTool, 'profile.recommend');
  assert.equal(profileRecommendDescriptor.preferred, true);
  assert.equal(profileRecommendDescriptor.mcpMutating, false);
  assert.equal(profileRecommendDescriptor.supportsRemote, true);
  assert.equal(profileRecommendDescriptor.remoteEligible, true);

  const aliasDefinition = mcpDefinitions.get('arbitrage');
  assert.ok(aliasDefinition);
  assert.equal(aliasDefinition.aliasOf, 'arb.scan');
  assert.equal(aliasDefinition.canonicalTool, 'arb.scan');
  assert.equal(aliasDefinition.preferred, false);
  assert.equal(aliasDefinition.mutating, false);
  assert.equal(aliasDefinition.longRunningBlocked, false);
  assert.equal(aliasDefinition.placeholderBlocked, false);
  assert.deepEqual(aliasDefinition.safeFlags, []);
  assert.deepEqual(aliasDefinition.executeFlags, []);
  assert.deepEqual(aliasDefinition.controlInputNames, []);
  assert.equal(aliasDefinition.agentWorkflow, null);

  const aliasDescriptor = descriptors.arbitrage;
  assert.ok(aliasDescriptor);
  assert.equal(aliasDescriptor.aliasOf, 'arb.scan');
  assert.equal(aliasDescriptor.canonicalTool, 'arb.scan');
  assert.equal(aliasDescriptor.preferred, false);
  assert.equal(aliasDescriptor.mcpMutating, false);
  assert.equal(aliasDescriptor.mcpLongRunningBlocked, false);
  assert.deepEqual(aliasDescriptor.controlInputNames, []);
  assert.equal(aliasDescriptor.agentWorkflow, null);

  const mirrorDeployDefinition = mcpDefinitions.get('mirror.deploy');
  assert.ok(mirrorDeployDefinition);
  assert.deepEqual(mirrorDeployDefinition.controlInputNames, ['agentPreflight']);
  assert.equal(typeof mirrorDeployDefinition.agentWorkflow, 'object');

  const mirrorDeployDescriptor = descriptors['mirror.deploy'];
  assert.ok(mirrorDeployDescriptor);
  assert.deepEqual(mirrorDeployDescriptor.controlInputNames, ['agentPreflight']);
  assert.deepEqual(mirrorDeployDescriptor.agentWorkflow, mirrorDeployDefinition.agentWorkflow);

  const tradeDefinition = mcpDefinitions.get('trade');
  assert.ok(tradeDefinition);
  assert.deepEqual(tradeDefinition.safeFlags, ['--dry-run']);
  assert.deepEqual(tradeDefinition.executeFlags, ['--execute']);

    const tradeDescriptor = descriptors.trade;
    assert.ok(tradeDescriptor);
    assert.equal(tradeDescriptor.safeEquivalent, 'quote');
    assert.equal(tradeDescriptor.recommendedPreflightTool, 'quote');
    assert.equal(tradeDescriptor.returnsRuntimeHandle, false);
    assert.equal(tradeDescriptor.supportsRemote, true);
    assert.equal(tradeDescriptor.remoteEligible, true);
    assert.deepEqual(tradeDescriptor.safeFlags, ['--dry-run']);
    assert.deepEqual(tradeDescriptor.executeFlags, ['--execute']);
    assert.equal(tradeDescriptor.executeIntentRequired, false);
    assert.equal(tradeDescriptor.executeIntentRequiredForLiveMode, true);

    const mirrorSyncRunDefinition = mcpDefinitions.get('mirror.sync.run');
  assert.ok(mirrorSyncRunDefinition);
  assert.equal(mirrorSyncRunDefinition.longRunningBlocked, true);
  assert.deepEqual(mirrorSyncRunDefinition.safeFlags, ['--paper', '--dry-run']);
  assert.deepEqual(mirrorSyncRunDefinition.executeFlags, ['--execute-live', '--execute']);

    const lifecycleStartDefinition = mcpDefinitions.get('lifecycle.start');
    assert.ok(lifecycleStartDefinition);
    assert.equal(lifecycleStartDefinition.mutating, true);
    assert.deepEqual(lifecycleStartDefinition.safeFlags, []);
    assert.deepEqual(lifecycleStartDefinition.executeFlags, []);

    const mirrorSyncStartDescriptor = descriptors['mirror.sync.start'];
    assert.ok(mirrorSyncStartDescriptor);
    assert.equal(mirrorSyncStartDescriptor.returnsOperationId, true);
    assert.equal(mirrorSyncStartDescriptor.returnsRuntimeHandle, false);
    assert.ok(mirrorSyncStartDescriptor.externalDependencies.includes('wallet-secrets'));
    assert.ok(mirrorSyncStartDescriptor.externalDependencies.includes('notification-secrets'));

    const sportsSyncStartDescriptor = descriptors['sports.sync.start'];
    assert.ok(sportsSyncStartDescriptor);
    assert.equal(sportsSyncStartDescriptor.returnsOperationId, true);
    assert.equal(sportsSyncStartDescriptor.returnsRuntimeHandle, false);

    const mirrorSyncStopDescriptor = descriptors['mirror.sync.stop'];
    assert.deepEqual(mirrorSyncStopDescriptor.externalDependencies, ['filesystem']);
    assert.equal(mirrorSyncStopDescriptor.riskLevel, 'medium');
    assert.equal(mirrorSyncStopDescriptor.returnsOperationId, true);
    assert.equal(mirrorSyncStopDescriptor.returnsRuntimeHandle, false);

    const sportsSyncStopDescriptor = descriptors['sports.sync.stop'];
    assert.deepEqual(sportsSyncStopDescriptor.externalDependencies, ['filesystem']);
    assert.equal(sportsSyncStopDescriptor.returnsOperationId, true);
    assert.equal(sportsSyncStopDescriptor.returnsRuntimeHandle, false);

    const mirrorStatusDescriptor = descriptors['mirror.status'];
    assert.deepEqual(mirrorStatusDescriptor.externalDependencies, ['filesystem', 'indexer-api', 'polymarket-api']);
    assert.equal(mirrorStatusDescriptor.recommendedPreflightTool, null);

    const polymarketPreflightDescriptor = descriptors['polymarket.preflight'];
    assert.equal(polymarketPreflightDescriptor.riskLevel, 'medium');

    const doctorDescriptor = descriptors.doctor;
    assert.equal(doctorDescriptor.recommendedPreflightTool, null);

    const capabilitiesDescriptor = descriptors.capabilities;
    assert.equal(capabilitiesDescriptor.safeEquivalent, null);
    assert.equal(capabilitiesDescriptor.supportsRemote, true);
    assert.equal(capabilitiesDescriptor.remoteEligible, true);
    assert.equal(capabilitiesDescriptor.executeIntentRequired, false);
    assert.equal(capabilitiesDescriptor.executeIntentRequiredForLiveMode, false);

    const webhookTestDescriptor = descriptors['webhook.test'];
    assert.deepEqual(webhookTestDescriptor.externalDependencies, ['notification-secrets', 'webhook-endpoint']);

    assert.deepEqual(descriptors['arb.scan'].canonicalCommandTokens, ['arb', 'scan']);
    assert.deepEqual(descriptors.capabilities.canonicalCommandTokens, ['capabilities']);

    assert.equal(descriptors.schema.helpDataSchema, '#/definitions/SchemaHelpPayload');
    assert.equal(descriptors.capabilities.helpDataSchema, '#/definitions/CapabilitiesHelpPayload');
  });
