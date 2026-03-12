const fs = require('node:fs');
const path = require('node:path');

const { createOperationService } = require('../../cli/lib/operation_service.cjs');
const { computeOperationHash } = require('../../cli/lib/shared/operation_hash.cjs');
const { createMcpToolRegistry } = require('../../cli/lib/mcp_tool_registry.cjs');
const { createTempDir, removeDir, runCli, startJsonHttpServer } = require('./cli_runner.cjs');
const { createIsolatedPandoraEnv } = require('./contract_parity_assertions.cjs');

const FIXED_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const FIXED_PRIVATE_KEY = `0x${'1'.repeat(64)}`;
const FIXED_TX_HASH = `0x${'b'.repeat(64)}`;
const FIXED_TARGET_TIMESTAMP = '2030-01-01T00:00:00Z';
const FIXED_RULES = 'YES: The condition resolves true. NO: The condition resolves false. EDGE: unresolved or canceled cases resolve NO.';
const FIXED_REASON = 'MCP sweep fixture.';
const FIXED_RPC_URL = 'https://ethereum.publicnode.com';
const FIXED_HTTPS_URL = 'https://example.com/resource';
const FIXED_WEBHOOK_URL = 'http://127.0.0.1:9/hook';
const LOCAL_SWEEP_REGISTRY = createMcpToolRegistry();

function buildSweepPolymarketMockPayload() {
  return {
    markets: [
      {
        question: 'Will deterministic tests pass?',
        description: FIXED_RULES,
        condition_id: 'poly-sweep-1',
        question_id: 'poly-sweep-q-1',
        market_slug: 'poly-sweep-1',
        end_date_iso: FIXED_TARGET_TIMESTAMP,
        active: true,
        closed: false,
        volume24hr: 100000,
        tokens: [
          { outcome: 'Yes', price: '0.74', token_id: 'poly-yes-1' },
          { outcome: 'No', price: '0.26', token_id: 'poly-no-1' },
        ],
      },
    ],
    orderbooks: {
      'poly-yes-1': {
        bids: [{ price: '0.73', size: '500' }],
        asks: [{ price: '0.74', size: '600' }],
      },
      'poly-no-1': {
        bids: [{ price: '0.25', size: '500' }],
        asks: [{ price: '0.26', size: '600' }],
      },
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildPolicyFixture() {
  return {
    schemaVersion: '1.0.0',
    kind: 'policy-pack',
    id: 'mcp-safe',
    version: '1.0.0',
    displayName: 'MCP Safe',
    description: 'MCP sweep policy.',
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
  };
}

function buildProfileFixture() {
  return {
    profiles: [
      {
        id: 'observer',
        displayName: 'Observer',
        description: 'Read-only observer.',
        signerBackend: 'read-only',
        approvalMode: 'read-only',
      },
    ],
  };
}

function buildLifecycleConfig(id) {
  return {
    id,
    source: 'mcp-sweep',
    marketId: 'market-1',
  };
}

function buildRecipeFixture() {
  return {
    schemaVersion: '1.0.0',
    kind: 'recipe',
    id: 'custom.capabilities',
    version: '1.0.0',
    displayName: 'Capabilities',
    description: 'Delegates to capabilities.',
    tool: 'capabilities',
    commandTemplate: ['capabilities'],
    inputs: [],
    execution: { safeByDefault: true, operationExpected: false, mutating: false },
  };
}

async function createMcpSweepFixtures() {
  const rootDir = createTempDir('pandora-mcp-sweep-');
  const operationDir = path.join(rootDir, 'operations');
  const lifecycleDir = path.join(rootDir, 'lifecycles');
  const polymarketMockServer = await startJsonHttpServer(() => ({
    body: buildSweepPolymarketMockPayload(),
  }));
  fs.mkdirSync(operationDir, { recursive: true });
  fs.mkdirSync(lifecycleDir, { recursive: true });

  const policyFile = path.join(rootDir, 'policy.json');
  const profileFile = path.join(rootDir, 'profiles.json');
  const lifecycleConfigFile = path.join(rootDir, 'lifecycle-start.json');
  const lifecycleSeedConfigFile = path.join(rootDir, 'lifecycle-seeded.json');
  const recipeFile = path.join(rootDir, 'recipe.json');
  const modelFile = path.join(rootDir, 'model.json');
  const checksFile = path.join(rootDir, 'checks.json');
  const stateFile = path.join(rootDir, 'state.json');
  const killSwitchFile = path.join(rootDir, 'kill-switch.json');

  fs.writeFileSync(policyFile, JSON.stringify(buildPolicyFixture(), null, 2));
  fs.writeFileSync(profileFile, JSON.stringify(buildProfileFixture(), null, 2));
  fs.writeFileSync(lifecycleConfigFile, JSON.stringify(buildLifecycleConfig('phase-sweep-start'), null, 2));
  fs.writeFileSync(lifecycleSeedConfigFile, JSON.stringify(buildLifecycleConfig('phase-sweep-seeded'), null, 2));
  fs.writeFileSync(recipeFile, JSON.stringify(buildRecipeFixture(), null, 2));
  fs.writeFileSync(modelFile, JSON.stringify({ probability: 0.62, confidence: 'high', source: 'sweep' }, null, 2));
  fs.writeFileSync(checksFile, JSON.stringify([
    {
      provider: 'fixture',
      status: 'final',
      winner: 'home',
      checkedAt: '2030-01-01T00:00:00.000Z',
    },
  ], null, 2));
  fs.writeFileSync(stateFile, '{}\n');
  fs.writeFileSync(killSwitchFile, JSON.stringify({ enabled: false }, null, 2));

  const env = createIsolatedPandoraEnv(rootDir, {
    PANDORA_OPERATION_DIR: operationDir,
    PANDORA_LIFECYCLE_DIR: lifecycleDir,
  });

  const operationService = createOperationService({ rootDir: operationDir });
  await operationService.createCompleted({
    operationId: 'sweep-op-completed',
    command: 'mirror.deploy',
    summary: 'MCP sweep completed op',
    result: { txHash: FIXED_TX_HASH },
  });
  await operationService.createExecuting({
    operationId: 'sweep-op-executing',
    command: 'mirror.sync.start',
    operationHash: computeOperationHash({ command: 'mirror.sync.start', mode: 'execute' }),
    status: 'executing',
  });

  const lifecycleSeed = runCli([
    '--output',
    'json',
    'lifecycle',
    'start',
    '--config',
    lifecycleSeedConfigFile,
  ], { env });
  if (lifecycleSeed.status !== 0) {
    throw new Error(`Unable to seed lifecycle fixture: ${lifecycleSeed.output || lifecycleSeed.stderr || lifecycleSeed.stdout}`);
  }

  return {
    rootDir,
    env,
    files: {
      policyFile,
      profileFile,
      lifecycleConfigFile,
      lifecycleSeedConfigFile,
      recipeFile,
      modelFile,
      checksFile,
      stateFile,
      killSwitchFile,
    },
    ids: {
      operationCompleted: 'sweep-op-completed',
      operationExecuting: 'sweep-op-executing',
      lifecycleSeeded: 'phase-sweep-seeded',
      lifecycleStart: 'phase-sweep-start',
      policy: 'research-only',
      profile: 'market_observer_ro',
      recipeRead: 'mirror.sync.paper-safe',
      recipeRun: 'mirror.close.all',
    },
    urls: {
      polymarketMockUrl: polymarketMockServer.url,
    },
    async cleanup() {
      await polymarketMockServer.close();
      removeDir(rootDir);
    },
  };
}

function buildAllRemoteScopes() {
  const scopes = new Set();
  for (const tool of createMcpToolRegistry().listTools()) {
    const policyScopes = tool && tool.xPandora && Array.isArray(tool.xPandora.policyScopes)
      ? tool.xPandora.policyScopes
      : [];
    for (const scope of policyScopes) scopes.add(scope);
  }
  return Array.from(scopes).sort((left, right) => left.localeCompare(right));
}

function getCompactModeFlag() {
  const help = runCli(['mcp', '--help']);
  const output = `${help.stdout || ''}\n${help.stderr || ''}`;
  for (const flag of ['--code-mode', '--compact-tools', '--compact-mode']) {
    if (output.includes(flag)) return flag;
  }
  return null;
}

function validateArgsAgainstSchema(tool, args) {
  if (!tool || typeof tool.name !== 'string') return [];
  try {
    LOCAL_SWEEP_REGISTRY.prepareInvocation(tool.name, args);
    return [];
  } catch (error) {
    if (!error || !error.code) return [String(error)];
    const code = String(error.code);
    if (![
      'MCP_INVALID_ARGUMENTS',
      'MCP_UNKNOWN_ARGUMENTS',
      'MCP_POSITIONALS_NOT_SUPPORTED',
      'MCP_LEGACY_FLAGS_UNSUPPORTED',
      'MCP_MUTUALLY_EXCLUSIVE_MODE_FLAGS',
      'MCP_EXECUTE_INTENT_REQUIRED',
      'MCP_AGENT_PREFLIGHT_REQUIRED',
      'MCP_RECIPE_INPUTS_INVALID',
      'MCP_AGENT_PREFLIGHT_INVALID',
    ].includes(code)) {
      return [];
    }
    if (!code.startsWith('MCP_')) return [String(error.message || error.code)];
    return [`${error.code}: ${String(error.message || '').trim()}`.trim()];
  }
}

function ensureBranch(branch, args, toolName, tool, fixtures) {
  if (!branch || typeof branch !== 'object') return;
  if (Array.isArray(branch.required)) {
    for (const name of branch.required) {
      if (Object.prototype.hasOwnProperty.call(args, name)) continue;
      const propertySchema = tool.inputSchema && tool.inputSchema.properties
        ? tool.inputSchema.properties[name]
        : undefined;
      args[name] = generateValue(name, propertySchema, toolName, tool, fixtures, args);
    }
  }
}

function toolOverrides(toolName, fixtures) {
  const overrides = {
    'agent.market.autocomplete': { question: 'Will ETH close above $8k by end of 2026?' },
    'agent.market.validate': {
      question: 'Will ETH close above $8k by end of 2026?',
      rules: FIXED_RULES,
      'target-timestamp': 1893456000,
    },
    'bridge.plan': { target: 'pandora', 'amount-usdc': 5, 'timeout-ms': 250 },
    'bridge.execute': { target: 'pandora', 'amount-usdc': 5, 'dry-run': true, 'timeout-ms': 250 },
    'events.get': { id: 'evt-sweep' },
    export: { wallet: FIXED_ADDRESS, format: 'json' },
    history: { wallet: FIXED_ADDRESS },
    'lifecycle.resolve': { id: fixtures.ids.lifecycleSeeded, confirm: true },
    'lifecycle.start': { config: fixtures.files.lifecycleConfigFile, intent: { execute: true } },
    'lifecycle.status': { id: fixtures.ids.lifecycleSeeded },
    'markets.create.plan': {
      question: 'Will BTC close above $120k by end of 2026?',
      rules: FIXED_RULES,
      sources: [FIXED_HTTPS_URL, 'https://example.com/alt'],
      'target-timestamp': FIXED_TARGET_TIMESTAMP,
      'liquidity-usdc': 100,
    },
    'markets.create.run': {
      question: 'Will BTC close above $120k by end of 2026?',
      rules: FIXED_RULES,
      sources: [FIXED_HTTPS_URL, 'https://example.com/alt'],
      'target-timestamp': FIXED_TARGET_TIMESTAMP,
      'liquidity-usdc': 100,
      'dry-run': true,
    },
    'mirror.calc': { 'target-pct': 55 },
    'mirror.deploy': {
      'polymarket-market-id': 'poly-sweep-1',
      'polymarket-gamma-mock-url': fixtures.urls.polymarketMockUrl,
      'polymarket-mock-url': fixtures.urls.polymarketMockUrl,
      'dry-run': true,
    },
    'mirror.go': {
      'polymarket-market-id': 'poly-sweep-1',
      'polymarket-gamma-mock-url': fixtures.urls.polymarketMockUrl,
      'polymarket-mock-url': fixtures.urls.polymarketMockUrl,
      'dry-run': true,
    },
    'mirror.lp-explain': { 'liquidity-usdc': 100 },
    'mirror.plan': {
      source: 'polymarket',
      'polymarket-market-id': 'poly-sweep-1',
      'polymarket-gamma-mock-url': fixtures.urls.polymarketMockUrl,
      'polymarket-mock-url': fixtures.urls.polymarketMockUrl,
    },
    'mirror.simulate': { 'liquidity-usdc': 100 },
    'mirror.sync.once': {
      'market-address': FIXED_ADDRESS,
      'polymarket-market-id': 'poly-sweep-1',
      'polymarket-gamma-mock-url': fixtures.urls.polymarketMockUrl,
      'polymarket-mock-url': fixtures.urls.polymarketMockUrl,
      paper: true,
      'state-file': fixtures.files.stateFile,
      'kill-switch-file': fixtures.files.killSwitchFile,
    },
    'mirror.sync.run': {
      'market-address': FIXED_ADDRESS,
      'polymarket-market-id': 'poly-sweep-1',
      'polymarket-gamma-mock-url': fixtures.urls.polymarketMockUrl,
      'polymarket-mock-url': fixtures.urls.polymarketMockUrl,
      paper: true,
      'state-file': fixtures.files.stateFile,
      'kill-switch-file': fixtures.files.killSwitchFile,
    },
    'mirror.sync.start': {
      'market-address': FIXED_ADDRESS,
      'polymarket-market-id': 'poly-sweep-1',
      'polymarket-gamma-mock-url': fixtures.urls.polymarketMockUrl,
      'polymarket-mock-url': fixtures.urls.polymarketMockUrl,
      paper: true,
      'state-file': fixtures.files.stateFile,
      'kill-switch-file': fixtures.files.killSwitchFile,
    },
    'mirror.trace': { 'rpc-url': FIXED_RPC_URL },
    'model.correlation': { series: '1,2,3|1,2,4' },
    'odds.history': { 'event-id': 'evt-sweep' },
    'odds.record': { competition: 'nba', interval: 60 },
    'operations.cancel': { id: fixtures.ids.operationExecuting, intent: { execute: true } },
    'operations.close': { id: fixtures.ids.operationCompleted, intent: { execute: true } },
    'operations.get': { id: fixtures.ids.operationCompleted },
    'operations.receipt': { id: fixtures.ids.operationCompleted },
    'operations.verify-receipt': { id: fixtures.ids.operationCompleted },
    'policy.explain': { id: fixtures.ids.policy },
    'policy.get': { id: fixtures.ids.policy },
    'policy.lint': { file: fixtures.files.policyFile },
    'profile.explain': { id: fixtures.ids.profile },
    'profile.get': { id: fixtures.ids.profile },
    'profile.validate': { file: fixtures.files.profileFile },
    'recipe.get': { id: fixtures.ids.recipeRead },
    'recipe.run': { id: fixtures.ids.recipeRun },
    'recipe.validate': {
      id: fixtures.ids.recipeRead,
      inputs: { 'market-address': FIXED_ADDRESS },
    },
    resolve: {
      'poll-address': FIXED_ADDRESS,
      answer: 'yes',
      reason: FIXED_REASON,
      'dry-run': true,
    },
    sell: {
      'market-address': FIXED_ADDRESS,
      side: 'yes',
      shares: 5,
      'dry-run': true,
    },
    'sports.create.plan': { 'event-id': 'evt-sweep' },
    'sports.create.run': { 'event-id': 'evt-sweep', 'market-type': 'amm', 'dry-run': true },
    'sports.resolve.plan': { 'event-id': 'evt-sweep' },
    'sports.sync.once': { 'event-id': 'evt-sweep', paper: true, 'state-file': fixtures.files.stateFile },
    'sports.sync.run': { 'event-id': 'evt-sweep', paper: true, 'state-file': fixtures.files.stateFile },
    'sports.sync.start': { 'event-id': 'evt-sweep', paper: true, 'state-file': fixtures.files.stateFile },
    suggest: { wallet: FIXED_ADDRESS, risk: 'low', budget: 25 },
    trade: {
      'market-address': FIXED_ADDRESS,
      side: 'yes',
      'amount-usdc': 10,
      'dry-run': true,
    },
    watch: { 'market-address': FIXED_ADDRESS, 'interval-ms': 1000 },
    'webhook.test': {
      'webhook-url': FIXED_WEBHOOK_URL,
      'webhook-timeout-ms': 100,
      intent: { execute: true },
    },
  };
  return clone(overrides[toolName] || {});
}

function normalizeNumeric(schema, fallback = 1) {
  if (!schema || typeof schema !== 'object') return fallback;
  if (typeof schema.minimum === 'number') return schema.minimum === 0 ? 1 : schema.minimum;
  return fallback;
}

function generateStringValue(name, schema, toolName, fixtures) {
  const lower = String(name || '').toLowerCase();
  if (lower === 'question') return 'Will ETH close above $8k by end of 2026?';
  if (lower === 'rules') return FIXED_RULES;
  if (lower === 'reason') return FIXED_REASON;
  if (lower === 'series') return '1,2,3|1,2,4';
  if (lower === 'prompt') return 'How should an agent bootstrap Pandora safely?';
  if (lower === 'market-address' || lower === 'pandora-market-address' || lower === 'poll-address') return FIXED_ADDRESS;
  if (lower.endsWith('address') || lower === 'wallet' || lower === 'to-wallet' || lower === 'funder' || lower === 'usdc') return FIXED_ADDRESS;
  if (lower.includes('private-key')) return FIXED_PRIVATE_KEY;
  if (lower.includes('tx-hash') || lower === 'hash') return FIXED_TX_HASH;
  if (lower.includes('timestamp')) return FIXED_TARGET_TIMESTAMP;
  if (lower.includes('rpc-url')) return FIXED_RPC_URL;
  if (lower.includes('url')) return lower.includes('webhook') ? FIXED_WEBHOOK_URL : FIXED_HTTPS_URL;
  if (lower === 'config') return fixtures.files.lifecycleConfigFile;
  if (lower === 'file' || lower.endsWith('-file')) {
    if (toolName === 'policy.lint') return fixtures.files.policyFile;
    if (toolName === 'profile.validate') return fixtures.files.profileFile;
    if (toolName === 'lifecycle.start') return fixtures.files.lifecycleConfigFile;
    if (toolName === 'recipe.get' || toolName === 'recipe.validate' || toolName === 'recipe.run') return fixtures.files.recipeFile;
    if (lower === 'model-file') return fixtures.files.modelFile;
    if (lower === 'checks-file') return fixtures.files.checksFile;
    if (lower === 'state-file') return fixtures.files.stateFile;
    if (lower === 'kill-switch-file') return fixtures.files.killSwitchFile;
    return path.join(fixtures.rootDir, `${lower.replace(/[^a-z0-9]+/g, '-') || 'fixture'}.json`);
  }
  if (lower === 'id') {
    if (toolName.startsWith('operations.')) return fixtures.ids.operationCompleted;
    if (toolName.startsWith('policy.')) return fixtures.ids.policy;
    if (toolName.startsWith('profile.')) return fixtures.ids.profile;
    if (toolName.startsWith('recipe.')) return fixtures.ids.recipeRead;
    if (toolName.startsWith('lifecycle.')) return fixtures.ids.lifecycleSeeded;
    return 'fixture-id';
  }
  if (lower === 'event-id') return 'evt-sweep';
  if (lower === 'competition') return 'nba';
  if (lower === 'format') return 'json';
  if (lower === 'source') return 'polymarket';
  if (lower === 'target') return 'pandora';
  if (lower === 'side') return 'yes';
  if (lower === 'answer') return 'yes';
  if (lower === 'validation-ticket') return 'validation-ticket-sweep';
  if (lower === 'polymarket-market-id') return 'poly-sweep-1';
  if (lower === 'polymarket-slug') return 'poly-sweep-slug';
  if (schema && Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  return `${lower || 'value'}-fixture`;
}

function generateValue(name, schema, toolName, tool, fixtures, args) {
  if (schema && Array.isArray(schema.enum) && schema.enum.length) {
    return schema.enum[0];
  }

  if (schema && schema.type === 'array') {
    const itemSchema = schema.items && typeof schema.items === 'object' ? schema.items : { type: 'string' };
    return [generateValue(`${name}-item`, itemSchema, toolName, tool, fixtures, args)];
  }

  if (schema && schema.type === 'object') {
    if (name === 'intent') {
      return { execute: true };
    }
    if (name === 'agentPreflight') {
      return {
        validationTicket: 'validation-ticket-sweep',
        validationDecision: 'PASS',
        validationSummary: 'Sweep fixture approval.',
      };
    }
    if (name === 'inputs') {
      return { 'market-address': FIXED_ADDRESS };
    }
    return {};
  }

  if (schema && schema.type === 'integer') {
    return normalizeNumeric(schema, 1);
  }

  if (schema && schema.type === 'number') {
    return normalizeNumeric(schema, 1);
  }

  if (schema && schema.type === 'boolean') {
    return true;
  }

  return generateStringValue(name, schema, toolName, fixtures, args);
}

function applyCommonDefaults(toolName, tool, args, fixtures) {
  const properties = tool.inputSchema && tool.inputSchema.properties
    ? tool.inputSchema.properties
    : {};
  const xPandora = tool.inputSchema && tool.inputSchema.xPandora
    ? tool.inputSchema.xPandora
    : {};

  const safeFlags = Array.isArray(xPandora.safeFlags) ? xPandora.safeFlags : [];
  const executeFlags = Array.isArray(xPandora.executeFlags) ? xPandora.executeFlags : [];
  const hasExplicitMode = [...safeFlags, ...executeFlags].some((flag) => {
    const propertyName = String(flag || '').replace(/^--/, '');
    return Object.prototype.hasOwnProperty.call(args, propertyName);
  });
  if (!hasExplicitMode) {
    for (const safeFlag of safeFlags) {
      const propertyName = String(safeFlag || '').replace(/^--/, '');
      if (Object.prototype.hasOwnProperty.call(properties, propertyName)) {
        args[propertyName] = true;
        break;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(properties, 'skip-dotenv') && !Object.prototype.hasOwnProperty.call(args, 'skip-dotenv')) {
    args['skip-dotenv'] = true;
  }
  if (Object.prototype.hasOwnProperty.call(properties, 'timeout-ms') && !Object.prototype.hasOwnProperty.call(args, 'timeout-ms')) {
    args['timeout-ms'] = normalizeNumeric(properties['timeout-ms'], 250);
  }
  if (Object.prototype.hasOwnProperty.call(properties, 'webhook-timeout-ms') && !Object.prototype.hasOwnProperty.call(args, 'webhook-timeout-ms')) {
    args['webhook-timeout-ms'] = normalizeNumeric(properties['webhook-timeout-ms'], 100);
  }
  if (Object.prototype.hasOwnProperty.call(properties, 'interval-ms') && !Object.prototype.hasOwnProperty.call(args, 'interval-ms')) {
    args['interval-ms'] = normalizeNumeric(properties['interval-ms'], 1);
  }
  if (Object.prototype.hasOwnProperty.call(properties, 'cooldown-ms') && !Object.prototype.hasOwnProperty.call(args, 'cooldown-ms')) {
    args['cooldown-ms'] = normalizeNumeric(properties['cooldown-ms'], 1);
  }
  if (Object.prototype.hasOwnProperty.call(properties, 'iterations') && !Object.prototype.hasOwnProperty.call(args, 'iterations')) {
    args.iterations = 1;
  }
  if (Object.prototype.hasOwnProperty.call(properties, 'state-file') && !Object.prototype.hasOwnProperty.call(args, 'state-file')) {
    args['state-file'] = fixtures.files.stateFile;
  }
  if (Object.prototype.hasOwnProperty.call(properties, 'kill-switch-file') && !Object.prototype.hasOwnProperty.call(args, 'kill-switch-file')) {
    args['kill-switch-file'] = fixtures.files.killSwitchFile;
  }
  if (xPandora.executeIntentRequired && !Object.prototype.hasOwnProperty.call(args, 'intent')) {
    args.intent = { execute: true };
  }
}

function buildSweepArguments(tool, fixtures) {
  const toolName = String(tool.name);
  const args = toolOverrides(toolName, fixtures);
  const explicitOverrides = { ...args };
  const properties = tool.inputSchema && tool.inputSchema.properties
    ? tool.inputSchema.properties
    : {};
  const required = Array.isArray(tool.inputSchema && tool.inputSchema.required)
    ? tool.inputSchema.required
    : [];
  const constraints = tool.inputSchema && tool.inputSchema.xPandora && tool.inputSchema.xPandora.topLevelInputConstraints
    ? tool.inputSchema.xPandora.topLevelInputConstraints
    : null;

  applyCommonDefaults(toolName, tool, args, fixtures);

  for (const name of required) {
    if (Object.prototype.hasOwnProperty.call(args, name)) continue;
    args[name] = generateValue(name, properties[name], toolName, tool, fixtures, args);
  }

  if (constraints && Array.isArray(constraints.requiredAnyOf) && constraints.requiredAnyOf.length) {
    const satisfied = constraints.requiredAnyOf.some((branch) =>
      Array.isArray(branch.required) && branch.required.every((name) => Object.prototype.hasOwnProperty.call(args, name)));
    if (!satisfied) {
      ensureBranch(constraints.requiredAnyOf[0], args, toolName, tool, fixtures);
    }
  }

  if (constraints && Array.isArray(constraints.exclusiveOneOf) && constraints.exclusiveOneOf.length) {
    const satisfied = constraints.exclusiveOneOf.some((branch) =>
      Array.isArray(branch.required) && branch.required.every((name) => Object.prototype.hasOwnProperty.call(args, name)));
    if (!satisfied) {
      ensureBranch(constraints.exclusiveOneOf[0], args, toolName, tool, fixtures);
    }
  }

  const xPandora = tool.inputSchema && tool.inputSchema.xPandora
    ? tool.inputSchema.xPandora
    : {};
  const modePropertyNames = [
    ...(Array.isArray(xPandora.safeFlags) ? xPandora.safeFlags : []),
    ...(Array.isArray(xPandora.executeFlags) ? xPandora.executeFlags : []),
  ]
    .map((flag) => String(flag || '').replace(/^--/, ''))
    .filter((name, index, values) => name && values.indexOf(name) === index);
  const activeModeNames = modePropertyNames.filter((name) => Object.prototype.hasOwnProperty.call(args, name));
  if (activeModeNames.length > 1) {
    const preferredMode = modePropertyNames.find((name) => Object.prototype.hasOwnProperty.call(explicitOverrides, name))
      || activeModeNames[0];
    for (const modeName of activeModeNames) {
      if (modeName !== preferredMode) {
        delete args[modeName];
      }
    }
  }

  return args;
}

async function runMcpToolSweep({ client, fixtures, transportLabel = 'stdio' }) {
  const listed = await client.listTools();
  const tools = Array.isArray(listed && listed.tools) ? listed.tools : [];
  const results = [];

  for (const tool of tools) {
    const name = String(tool.name || '');
    const args = buildSweepArguments(tool, fixtures);
    const schemaIssues = validateArgsAgainstSchema(tool, args);
    const startedAt = Date.now();
    try {
      const call = await client.callTool({ name, arguments: args });
      const envelope = call && call.structuredContent;
      results.push({
        name,
        transport: transportLabel,
        args,
        durationMs: Date.now() - startedAt,
        schemaIssues,
        isError: Boolean(call && call.isError),
        structured: Boolean(envelope && typeof envelope === 'object' && typeof envelope.ok === 'boolean'),
        ok: Boolean(envelope && envelope.ok === true),
        errorCode: envelope && envelope.error && envelope.error.code ? envelope.error.code : null,
        command: envelope && envelope.command ? envelope.command : null,
      });
    } catch (error) {
      results.push({
        name,
        transport: transportLabel,
        args,
        durationMs: Date.now() - startedAt,
        schemaIssues,
        structured: false,
        ok: false,
        transportError: error && error.message ? error.message : String(error),
      });
    }
  }

  const transportErrors = results.filter((result) => result.transportError);
  const unstructured = results.filter((result) => !result.transportError && !result.structured);
  const schemaIssueResults = results.filter((result) => Array.isArray(result.schemaIssues) && result.schemaIssues.length > 0);
  const byErrorCode = {};
  for (const result of results) {
    const key = result.ok ? 'OK' : (result.errorCode || result.transportError || 'UNSTRUCTURED');
    byErrorCode[key] = (byErrorCode[key] || 0) + 1;
  }

  return {
    toolCount: tools.length,
    results,
    transportErrors,
    unstructured,
    schemaIssueResults,
    byErrorCode,
  };
}

function formatSweepSummary(summary) {
  return JSON.stringify({
    toolCount: summary.toolCount,
    transportErrors: summary.transportErrors.map((result) => ({
      name: result.name,
      transportError: result.transportError,
    })),
    unstructured: summary.unstructured.map((result) => result.name),
    schemaIssues: summary.schemaIssueResults.slice(0, 10).map((result) => ({
      name: result.name,
      schemaIssues: result.schemaIssues,
    })),
    byErrorCode: summary.byErrorCode,
  }, null, 2);
}

module.exports = {
  buildAllRemoteScopes,
  createMcpSweepFixtures,
  formatSweepSummary,
  getCompactModeFlag,
  runMcpToolSweep,
};
