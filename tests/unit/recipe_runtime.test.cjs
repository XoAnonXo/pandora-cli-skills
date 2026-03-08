const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createRecipeRegistryService } = require('../../cli/lib/recipe_registry_service.cjs');
const { createRecipeRuntimeService } = require('../../cli/lib/recipe_runtime_service.cjs');
const { buildCommandDescriptors } = require('../../cli/lib/agent_contract_registry.cjs');

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
      resolveProfile(options) {
        return {
          profile: { id: options.profileId || 'market_observer_ro' },
          compatibility: { ok: true, violations: [] },
          resolution: { ready: true },
        };
      },
    },
  });
}

test('recipe registry lists first-party recipes and returns one by id', () => {
  const registry = createRecipeRegistryService();
  const listing = registry.listRecipes();
  assert.ok(listing.count >= 4);
  assert.ok(listing.items.some((item) => item.id === 'mirror.sync.paper-safe'));

  const record = registry.getRecipe('mirror.sync.paper-safe');
  assert.equal(record.recipe.tool, 'mirror.sync.start');
  assert.equal(record.recipe.defaultPolicy, 'paper-trading');
  assert.equal(record.recipe.defaultProfile, null);
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

  fs.rmSync(dir, { recursive: true, force: true });
});

test('recipe runtime compiles inputs and validates against policy/profile services', () => {
  const registry = createRecipeRegistryService();
  const runtime = createRuntime();
  const record = registry.getRecipe('mirror.sync.paper-safe');
  const compiled = runtime.compileRecipe(record.recipe, {
    'market-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  });

  assert.deepEqual(compiled.commandArgs, [
    'mirror', 'sync', 'start', '--paper', '--market-address', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  ]);

  const validation = runtime.validateRecipeExecution(compiled, {
    policyId: 'paper-trading',
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.policyId, 'paper-trading');
  assert.equal(validation.profileId, null);
});

test('recipe runtime blocks execution when policy or profile compatibility fails', () => {
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
      resolveProfile() {
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
  const result = runtime.runRecipe(compiled, {
    policyId: 'research-only',
    profileId: 'market_observer_ro',
  });

  assert.equal(result.ok, false);
  assert.equal(result.result, null);
  assert.equal(result.validation.denials.length, 2);
});

test('recipe runtime returns delegated operation ids when the underlying command exposes them', () => {
  const registry = createRecipeRegistryService();
  const runtime = createRuntime();
  const record = registry.getRecipe('mirror.close.all');
  const compiled = runtime.compileRecipe(record.recipe, {});
  const result = runtime.runRecipe(compiled, { policyId: 'paper-trading' });

  assert.equal(result.ok, true);
  assert.equal(result.operationId, 'op-123');
  assert.equal(result.result.command, 'mirror');
});

test('recipe runtime rejects external file recipes that delegate mutating commands', () => {
  const runtime = createRuntime();
  const compiled = runtime.compileRecipe({
    id: 'custom.trade-live',
    tool: 'trade',
    commandTemplate: ['trade', '--market-address', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '--side', 'yes', '--amount-usdc', '25', '--execute'],
    inputs: [],
    defaultPolicy: null,
    defaultProfile: null,
    mutating: true,
    safeByDefault: false,
    firstParty: false,
  }, {}, { source: 'file', filePath: '/tmp/recipe.json' });

  const result = runtime.runRecipe(compiled, {});
  assert.equal(result.ok, false);
  assert.equal(result.result, null);
  assert.ok(result.validation.denials.some((entry) => entry.code === 'RECIPE_FILE_MUTATION_DENIED'));
  assert.ok(result.validation.denials.some((entry) => entry.code === 'RECIPE_PROFILE_REQUIRED'));
});

test('recipe runtime rejects delegated command mismatches and non-ready profiles', () => {
  const runtime = createRuntime({
    profileResolver: {
      resolveProfile() {
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
    mutating: false,
    safeByDefault: true,
    firstParty: false,
  }, {}, { source: 'file', filePath: '/tmp/recipe.json' });

  const validation = runtime.validateRecipeExecution(compiled, {});
  assert.equal(validation.ok, false);
  assert.ok(validation.denials.some((entry) => entry.code === 'RECIPE_COMMAND_MISMATCH'));
  assert.ok(validation.denials.some((entry) => entry.code === 'RECIPE_PROFILE_NOT_READY'));
});
