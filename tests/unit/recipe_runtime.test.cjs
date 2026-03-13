const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createRecipeRegistryService } = require('../../cli/lib/recipe_registry_service.cjs');
const { createRecipeRuntimeService } = require('../../cli/lib/recipe_runtime_service.cjs');
const { buildCommandDescriptors } = require('../../cli/lib/agent_contract_registry.cjs');
const { normalizeRecipeManifest } = require('../../cli/lib/shared/recipe_schema.cjs');

function createRuntime(overrides = {}) {
  return createRecipeRuntimeService({
    commandDescriptors: buildCommandDescriptors(),
    commandExecutor: overrides.commandExecutor || {
      executeJsonCommand(commandArgs) {
        return {
          ok: true,
          exitCode: 0,
          envelope: {
            ok: true,
            command: commandArgs[0],
            data: {
              operationId: 'op-123',
              argv: commandArgs,
            },
          },
        };
      },
    },
    policyEvaluator: overrides.policyEvaluator || {
      evaluateExecution(request) {
        return {
          ok: true,
          decision: 'allow',
          policyId: request.policyId || null,
          denials: [],
          warnings: [],
        };
      },
    },
    profileResolver: overrides.profileResolver || {
      async probeProfile(options) {
        return {
          profile: { id: options.profileId || 'market_observer_ro' },
          compatibility: { ok: true, violations: [] },
          resolution: { ready: true },
        };
      },
    },
    remoteActive: overrides.remoteActive === true,
  });
}

test('recipe registry lists first-party recipes and returns one by id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-recipe-empty-'));
  const registry = createRecipeRegistryService({ env: { PANDORA_RECIPE_DIR: dir } });
  const listing = registry.listRecipes();
  assert.ok(listing.count >= 4);
  assert.ok(listing.items.some((item) => item.id === 'mirror.sync.paper-safe'));
  assert.ok(listing.items.every((item) => item.source === 'first-party'));
  assert.ok(listing.items.every((item) => item.approvalStatus === 'approved'));
  assert.equal(listing.sourceCounts['first-party'], listing.count);

  const record = registry.getRecipe('mirror.sync.paper-safe');
  assert.equal(record.recipe.tool, 'mirror.sync.start');
  assert.equal(record.recipe.defaultPolicy, 'paper-trading');
  assert.equal(record.recipe.defaultProfile, null);
  assert.equal(record.recipe.source, 'first-party');
  assert.equal(record.recipe.approvalStatus, 'approved');
  assert.equal(record.recipe.riskLevel, 'paper');

  const arbRecipe = registry.getRecipe('arb.scan.poly');
  assert.ok(arbRecipe);
  assert.deepEqual(arbRecipe.recipe.commandTemplate, ['arb', 'scan', '--source', 'polymarket', '--output', 'json', '--iterations', '1']);

  const portfolioRecipe = registry.getRecipe('portfolio.snapshot');
  assert.ok(portfolioRecipe);
  assert.equal(portfolioRecipe.recipe.supportsRemote, true);

  const debugRecipe = registry.getRecipe('debug.market.inspect');
  assert.ok(debugRecipe);
  assert.equal(debugRecipe.recipe.supportsRemote, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('recipe registry validates recipe files', () => {
  const registry = createRecipeRegistryService();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-recipe-registry-'));
  const file = path.join(dir, 'recipe.json');
  fs.writeFileSync(file, JSON.stringify({
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
  }));

  const result = registry.validateRecipeFile(file);
  assert.equal(result.ok, true);
  assert.equal(result.recipe.id, 'custom.capabilities');
  assert.equal(result.recipe.source, 'user');
  assert.equal(result.recipe.approvalStatus, 'unreviewed');
  assert.equal(result.origin, 'file');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('recipe schema normalizes trust metadata defaults and explicit risk metadata', () => {
  const approved = normalizeRecipeManifest({
    schemaVersion: '1.0.0',
    kind: 'recipe',
    id: 'custom.paper-safe',
    version: '1.0.0',
    displayName: 'Paper Safe',
    description: 'Paper recipe.',
    tool: 'capabilities',
    commandTemplate: ['capabilities'],
    inputs: [],
    source: 'first-party',
    execution: { safeByDefault: true, operationExpected: false, mutating: false },
  });
  assert.equal(approved.source, 'first-party');
  assert.equal(approved.approvalStatus, 'approved');
  assert.equal(approved.riskLevel, 'read-only');

  const liveUser = normalizeRecipeManifest({
    schemaVersion: '1.0.0',
    kind: 'recipe',
    id: 'custom.live-user',
    version: '1.0.0',
    displayName: 'Live User',
    description: 'User live recipe.',
    tool: 'trade',
    commandTemplate: ['trade', '--execute'],
    inputs: [],
    source: 'user',
    approvalStatus: 'experimental',
    riskLevel: 'live',
    execution: { safeByDefault: false, operationExpected: true, mutating: true },
  });
  assert.equal(liveUser.source, 'user');
  assert.equal(liveUser.approvalStatus, 'experimental');
  assert.equal(liveUser.riskLevel, 'live');
});

test('recipe registry list supports trust and risk filters', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-recipe-empty-'));
  const registry = createRecipeRegistryService({ env: { PANDORA_RECIPE_DIR: dir } });
  const approved = registry.listRecipes({ approvalStatus: 'approved' });
  assert.equal(approved.count, approved.items.length);
  assert.ok(approved.items.every((item) => item.approvalStatus === 'approved'));

  const paper = registry.listRecipes({ riskLevel: 'paper' });
  assert.ok(paper.items.length >= 1);
  assert.ok(paper.items.every((item) => item.riskLevel === 'paper'));

  const users = registry.listRecipes({ source: 'user' });
  assert.equal(users.count, 0);
  assert.equal(users.sourceCounts.user, 0);
  assert.equal(users.appliedFilters.source, 'user');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('recipe registry lists stored user recipes from the recipe directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-recipe-store-'));
  const file = path.join(dir, 'user-recipe.json');
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: '1.0.0',
    kind: 'recipe',
    id: 'custom.capabilities',
    version: '1.0.0',
    displayName: 'Capabilities',
    description: 'Delegates to capabilities.',
    tool: 'capabilities',
    commandTemplate: ['capabilities'],
    inputs: [],
    approvalStatus: 'approved',
    execution: { safeByDefault: true, operationExpected: false, mutating: false },
  }));

  const registry = createRecipeRegistryService({ env: { PANDORA_RECIPE_DIR: dir } });
  const listing = registry.listRecipes({ source: 'user' });
  assert.equal(listing.count, 1);
  assert.equal(listing.userCount, 1);
  assert.equal(listing.items[0].id, 'custom.capabilities');
  assert.equal(listing.items[0].source, 'user');
  assert.equal(listing.items[0].origin, 'file');
  assert.equal(listing.items[0].approvalStatus, 'unreviewed');
  assert.equal(listing.items[0].riskLevel, 'read-only');

  const record = registry.getRecipe('custom.capabilities');
  assert.ok(record);
  assert.equal(record.origin, 'file');
  assert.equal(record.recipe.source, 'user');
  assert.equal(record.recipe.approvalStatus, 'unreviewed');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('recipe runtime compiles inputs and validates against policy/profile services', async () => {
  const registry = createRecipeRegistryService();
  const runtime = createRuntime();
  const record = registry.getRecipe('mirror.sync.paper-safe');
  const compiled = runtime.compileRecipe(record.recipe, {
    'market-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  });

  assert.deepEqual(compiled.commandArgs, [
    'mirror', 'sync', 'start', '--paper', '--market-address', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  ]);

  const validation = await runtime.validateRecipeExecution(compiled, {
    policyId: 'paper-trading',
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.policyId, 'paper-trading');
  assert.equal(validation.profileId, null);
});

test('recipe runtime blocks execution when policy or profile compatibility fails', async () => {
  const registry = createRecipeRegistryService();
  const runtime = createRuntime({
    policyEvaluator: {
      evaluateExecution() {
        return {
          ok: false,
          decision: 'deny',
          policyId: 'research-only',
          denials: [{ code: 'DENIED', message: 'denied' }],
          warnings: [],
        };
      },
    },
    profileResolver: {
      async probeProfile() {
        return {
          profile: { id: 'market_observer_ro' },
          compatibility: { ok: false, violations: [{ code: 'PROFILE_INCOMPATIBLE', message: 'bad' }] },
          resolution: { ready: true },
        };
      },
    },
  });
  const record = registry.getRecipe('claim.all.finalized');
  const compiled = runtime.compileRecipe(record.recipe, {});
  const result = await runtime.runRecipe(compiled, {
    policyId: 'research-only',
    profileId: 'market_observer_ro',
  });

  assert.equal(result.ok, false);
  assert.equal(result.result, null);
  assert.equal(result.validation.denials.length, 2);
});

test('recipe runtime returns delegated operation ids when the underlying command exposes them', async () => {
  const registry = createRecipeRegistryService();
  const runtime = createRuntime();
  const record = registry.getRecipe('mirror.close.all');
  const compiled = runtime.compileRecipe(record.recipe, {});
  const result = await runtime.runRecipe(compiled, { policyId: 'paper-trading' });

  assert.equal(result.ok, true);
  assert.equal(result.operationId, 'op-123');
  assert.equal(result.result.command, 'mirror');
});

test('recipe runtime rejects external file recipes that delegate mutating commands', async () => {
  const runtime = createRuntime();
  const compiled = runtime.compileRecipe({
    id: 'custom.trade-live',
    tool: 'trade',
    commandTemplate: ['trade', '--market-address', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '--side', 'yes', '--amount-usdc', '25', '--execute'],
    inputs: [],
    defaultPolicy: null,
    defaultProfile: null,
    source: 'user',
    approvalStatus: 'unreviewed',
    riskLevel: 'live',
    mutating: true,
    safeByDefault: false,
    firstParty: false,
  }, {}, { source: 'user', origin: 'file', filePath: '/tmp/recipe.json' });

  const result = await runtime.runRecipe(compiled, {});
  assert.equal(result.ok, false);
  assert.equal(result.result, null);
  assert.ok(result.validation.denials.some((entry) => entry.code === 'RECIPE_FILE_MUTATION_DENIED'));
  assert.ok(result.validation.denials.some((entry) => entry.code === 'RECIPE_UNREVIEWED_LIVE_DENIED'));
  assert.ok(result.validation.denials.some((entry) => entry.code === 'RECIPE_PROFILE_REQUIRED'));
  assert.ok(result.validation.warnings.some((entry) => entry.code === 'RECIPE_UNREVIEWED_SOURCE'));
});

test('recipe runtime warns stored user recipes as unreviewed even when the manifest self-attests approved', async () => {
  const runtime = createRuntime();
  const compiled = runtime.compileRecipe({
    id: 'custom.approved-user',
    tool: 'capabilities',
    commandTemplate: ['capabilities'],
    inputs: [],
    defaultPolicy: null,
    defaultProfile: null,
    source: 'user',
    approvalStatus: 'approved',
    riskLevel: 'read-only',
    mutating: false,
    safeByDefault: true,
    firstParty: false,
    supportsRemote: true,
  }, {}, { source: 'user', origin: 'file', filePath: '/tmp/recipe.json' });

  const validation = await runtime.validateRecipeExecution(compiled, {});
  assert.equal(validation.ok, true);
  assert.ok(validation.warnings.some((entry) => entry.code === 'RECIPE_UNREVIEWED_SOURCE'));
});

test('recipe runtime rejects delegated command mismatches and non-ready profiles', async () => {
  const runtime = createRuntime({
    profileResolver: {
      async probeProfile() {
        return {
          profile: { id: 'prod_trader_a' },
          compatibility: { ok: true, violations: [] },
          resolution: { ready: false, missing: ['private-key'] },
        };
      },
    },
  });
  const compiled = runtime.compileRecipe({
    id: 'custom.bad-mapping',
    tool: 'capabilities',
    commandTemplate: ['trade', '--market-address', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '--side', 'yes', '--amount-usdc', '25', '--dry-run'],
    inputs: [],
    defaultPolicy: null,
    defaultProfile: 'prod_trader_a',
    source: 'user',
    approvalStatus: 'unreviewed',
    riskLevel: 'read-only',
    mutating: false,
    safeByDefault: true,
    firstParty: false,
  }, {}, { source: 'user', origin: 'file', filePath: '/tmp/recipe.json' });

  const validation = await runtime.validateRecipeExecution(compiled, {});
  assert.equal(validation.ok, false);
  assert.ok(validation.denials.some((entry) => entry.code === 'RECIPE_COMMAND_MISMATCH'));
  assert.ok(validation.denials.some((entry) => entry.code === 'RECIPE_PROFILE_NOT_READY'));
});

test('recipe runtime denies remote execution for recipes that delegate remote-blocked long-running tools', async () => {
  const registry = createRecipeRegistryService();
  const runtime = createRuntime({ remoteActive: true });
  const record = registry.getRecipe('mirror.sync.paper-safe');
  const compiled = runtime.compileRecipe(record.recipe, {
    'market-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  });

  const validation = await runtime.validateRecipeExecution(compiled, {
    policyId: 'paper-trading',
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.denials.some((entry) => entry.code === 'RECIPE_REMOTE_EXECUTION_DENIED'));
  assert.ok(validation.denials.some((entry) => entry.code === 'RECIPE_REMOTE_LONG_RUNNING_DENIED'));
});

test('recipe runtime allows bounded remote arb.scan.poly recipe execution contract', async () => {
  const previousScopes = process.env.PANDORA_MCP_GRANTED_SCOPES;
  process.env.PANDORA_MCP_GRANTED_SCOPES = 'arb:read,network:indexer';
  try {
    const registry = createRecipeRegistryService();
    const runtime = createRuntime({ remoteActive: true });
    const record = registry.getRecipe('arb.scan.poly');
    const compiled = runtime.compileRecipe(record.recipe, {});

    const validation = await runtime.validateRecipeExecution(compiled, {});
    assert.equal(validation.ok, true);
    assert.ok(!validation.denials.some((entry) => entry.code === 'RECIPE_REMOTE_LONG_RUNNING_DENIED'));
  } finally {
    if (previousScopes === undefined) {
      delete process.env.PANDORA_MCP_GRANTED_SCOPES;
    } else {
      process.env.PANDORA_MCP_GRANTED_SCOPES = previousScopes;
    }
  }
});

test('recipe runtime allows approved remote read-only inspection recipes', async () => {
  const previousScopes = process.env.PANDORA_MCP_GRANTED_SCOPES;
  process.env.PANDORA_MCP_GRANTED_SCOPES = 'portfolio:read,debug:read,network:indexer,network:rpc';
  try {
    const registry = createRecipeRegistryService();
    const runtime = createRuntime({ remoteActive: true });

    const portfolio = runtime.compileRecipe(registry.getRecipe('portfolio.snapshot').recipe, {
      wallet: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const portfolioValidation = await runtime.validateRecipeExecution(portfolio, {});
    assert.equal(portfolioValidation.ok, true);

    const debugMarket = runtime.compileRecipe(registry.getRecipe('debug.market.inspect').recipe, {
      'market-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const debugValidation = await runtime.validateRecipeExecution(debugMarket, {});
    assert.equal(debugValidation.ok, true);
  } finally {
    if (previousScopes === undefined) {
      delete process.env.PANDORA_MCP_GRANTED_SCOPES;
    } else {
      process.env.PANDORA_MCP_GRANTED_SCOPES = previousScopes;
    }
  }
});

test('recipe runtime denies remote execution for delegated commands that are not MCP-exposed or remote-eligible', async () => {
  const runtime = createRecipeRuntimeService({
    commandDescriptors: {
      'custom.readonly': {
        mcpExposed: false,
        remoteEligible: false,
        mcpMutating: false,
        requiresSecrets: false,
        policyScopes: [],
      },
    },
    commandExecutor: {
      executeJsonCommand() {
        throw new Error('should not execute');
      },
    },
    policyEvaluator: {
      evaluateExecution() {
        return { ok: true, decision: 'allow', policyId: null, denials: [], warnings: [] };
      },
    },
    profileResolver: {
      async probeProfile() {
        return { compatibility: { ok: true, violations: [] }, resolution: { ready: true } };
      },
    },
    remoteActive: true,
  });
  const compiled = runtime.compileRecipe({
    id: 'custom.remote-check',
    tool: 'custom.readonly',
    commandTemplate: ['custom', 'readonly'],
    inputs: [],
    defaultPolicy: null,
    defaultProfile: null,
    mutating: false,
    safeByDefault: true,
    firstParty: true,
    supportsRemote: true,
  }, {});

  const validation = await runtime.validateRecipeExecution(compiled, {});
  assert.equal(validation.ok, false);
  assert.ok(validation.denials.some((entry) => entry.code === 'RECIPE_REMOTE_MCP_EXPOSURE_REQUIRED'));
  assert.ok(validation.denials.some((entry) => entry.code === 'RECIPE_REMOTE_TOOL_NOT_ELIGIBLE'));
});

test('recipe runtime denies remote execution when delegated scopes exceed granted gateway scopes', async () => {
  const previousScopes = process.env.PANDORA_MCP_GRANTED_SCOPES;
  process.env.PANDORA_MCP_GRANTED_SCOPES = 'capabilities:read';
  try {
    const runtime = createRuntime({ remoteActive: true });
    const compiled = runtime.compileRecipe({
      id: 'custom.scope-check',
      tool: 'scan',
      commandTemplate: ['scan', '--limit', '5'],
      inputs: [],
      defaultPolicy: null,
      defaultProfile: null,
      mutating: false,
      safeByDefault: true,
      firstParty: true,
      supportsRemote: true,
    }, {});
    const validation = await runtime.validateRecipeExecution(compiled, {});
    assert.equal(validation.ok, false);
    const scopeDenial = validation.denials.find((entry) => entry.code === 'RECIPE_REMOTE_SCOPE_DENIED');
    assert.ok(scopeDenial);
    assert.ok(Array.isArray(scopeDenial.missingScopes));
    assert.ok(scopeDenial.missingScopes.includes('scan:read'));
  } finally {
    if (previousScopes === undefined) {
      delete process.env.PANDORA_MCP_GRANTED_SCOPES;
    } else {
      process.env.PANDORA_MCP_GRANTED_SCOPES = previousScopes;
    }
  }
});
