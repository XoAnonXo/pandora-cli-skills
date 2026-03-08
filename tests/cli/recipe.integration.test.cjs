const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runCli } = require('../helpers/cli_runner.cjs');

function parseJsonOutput(result) {
  assert.equal(result.status, 0, result.output || result.stderr || 'expected successful JSON CLI result');
  return JSON.parse(String(result.stdout || '').trim());
}

test('recipe list/get expose first-party recipes', () => {
  const list = parseJsonOutput(runCli(['--output', 'json', 'recipe', 'list']));
  assert.equal(list.command, 'recipe.list');
  assert.ok(list.data.items.some((item) => item.id === 'mirror.sync.paper-safe'));

  const get = parseJsonOutput(runCli(['--output', 'json', 'recipe', 'get', '--id', 'mirror.sync.paper-safe']));
  assert.equal(get.command, 'recipe.get');
  assert.equal(get.data.recipe.id, 'mirror.sync.paper-safe');
});

test('recipe validate compiles inputs and returns policy/profile validation payload', () => {
  const result = parseJsonOutput(runCli([
    '--output', 'json', 'recipe', 'validate',
    '--id', 'mirror.sync.paper-safe',
    '--set', 'market-address=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--policy-id', 'paper-trading',
  ]));

  assert.equal(result.command, 'recipe.validate');
  assert.equal(result.data.ok, true);
  assert.equal(result.data.validation.policyId, 'paper-trading');
  assert.equal(result.data.validation.profileId, null);
  assert.deepEqual(result.data.compiledCommand, [
    'mirror', 'sync', 'start', '--paper', '--market-address', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  ]);
});

test('recipe run delegates to the compiled command and returns nested result envelopes', () => {
  const result = parseJsonOutput(runCli([
    '--output', 'json', 'recipe', 'run',
    '--id', 'mirror.close.all',
  ]));

  assert.equal(result.command, 'recipe.run');
  assert.equal(result.data.ok, true);
  assert.deepEqual(result.data.compiledCommand, ['mirror', 'close', '--all', '--dry-run']);
  assert.equal(result.data.result.ok, true);
  assert.equal(typeof result.data.operationId, 'string');
});

test('recipe get/validate support external recipe files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-recipe-cli-'));
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

  const get = parseJsonOutput(runCli(['--output', 'json', 'recipe', 'get', '--file', file]));
  assert.equal(get.command, 'recipe.get');
  assert.equal(get.data.recipe.id, 'custom.capabilities');

  const validate = parseJsonOutput(runCli(['--output', 'json', 'recipe', 'validate', '--file', file]));
  assert.equal(validate.command, 'recipe.validate');
  assert.equal(validate.data.ok, true);
  assert.deepEqual(validate.data.compiledCommand, ['capabilities']);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('recipe run rejects unsafe external file recipes that delegate live or mutating commands', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-recipe-cli-'));
  const file = path.join(dir, 'recipe.json');
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: '1.0.0',
    kind: 'recipe',
    id: 'custom.trade-live',
    version: '1.0.0',
    displayName: 'Unsafe Live Trade',
    description: 'Attempts to delegate directly to trade execute.',
    tool: 'trade',
    commandTemplate: ['trade', '--market-address', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '--side', 'yes', '--amount-usdc', '25', '--execute'],
    inputs: [],
    execution: { safeByDefault: false, operationExpected: true, mutating: true },
    firstParty: false,
  }));

  const result = parseJsonOutput(runCli(['--output', 'json', 'recipe', 'run', '--file', file]));
  assert.equal(result.command, 'recipe.run');
  assert.equal(result.data.ok, false);
  assert.equal(result.data.result, null);
  assert.ok(result.data.validation.denials.some((entry) => entry.code === 'RECIPE_FILE_MUTATION_DENIED'));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('recipe validate denies delegated remote scopes that are not granted by the gateway runtime', () => {
  const result = parseJsonOutput(runCli([
    '--output', 'json', 'recipe', 'validate',
    '--id', 'mirror.close.all',
  ], {
    env: {
      PANDORA_MCP_REMOTE_ACTIVE: '1',
      PANDORA_MCP_GRANTED_SCOPES: 'capabilities:read,contracts:read,help:read,schema:read,operations:read',
    },
  }));

  assert.equal(result.command, 'recipe.validate');
  assert.equal(result.data.ok, false);
  assert.ok(result.data.validation.denials.some((entry) => entry.code === 'RECIPE_REMOTE_SCOPE_DENIED'));
});
