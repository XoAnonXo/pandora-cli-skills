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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-recipe-cli-empty-'));
  const list = parseJsonOutput(runCli(['--output', 'json', 'recipe', 'list'], {
    env: { PANDORA_RECIPE_DIR: dir },
  }));
  assert.equal(list.command, 'recipe.list');
  assert.ok(list.data.items.some((item) => item.id === 'mirror.sync.paper-safe'));
  assert.equal(list.data.appliedFilters.source, 'all');
  assert.ok(list.data.items.every((item) => item.source === 'first-party'));
  assert.ok(list.data.items.every((item) => item.approvalStatus === 'approved'));

  const get = parseJsonOutput(runCli(['--output', 'json', 'recipe', 'get', '--id', 'mirror.sync.paper-safe'], {
    env: { PANDORA_RECIPE_DIR: dir },
  }));
  assert.equal(get.command, 'recipe.get');
  assert.equal(get.data.recipe.id, 'mirror.sync.paper-safe');
  assert.equal(get.data.recipe.source, 'first-party');
  assert.equal(get.data.recipe.approvalStatus, 'approved');
  assert.equal(get.data.item.riskLevel, 'paper');

  const arb = parseJsonOutput(runCli(['--output', 'json', 'recipe', 'get', '--id', 'arb.scan.poly'], {
    env: { PANDORA_RECIPE_DIR: dir },
  }));
  assert.deepEqual(arb.data.recipe.commandTemplate, ['arb', 'scan', '--source', 'polymarket', '--output', 'json', '--iterations', '1']);

  const portfolio = parseJsonOutput(runCli(['--output', 'json', 'recipe', 'get', '--id', 'portfolio.snapshot'], {
    env: { PANDORA_RECIPE_DIR: dir },
  }));
  assert.equal(portfolio.data.recipe.supportsRemote, true);

  const debugMarket = parseJsonOutput(runCli(['--output', 'json', 'recipe', 'get', '--id', 'debug.market.inspect'], {
    env: { PANDORA_RECIPE_DIR: dir },
  }));
  assert.equal(debugMarket.data.recipe.supportsRemote, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('recipe list supports trust and risk filters', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-recipe-cli-empty-'));
  const approved = parseJsonOutput(runCli(['--output', 'json', 'recipe', 'list', '--approval-status', 'approved'], {
    env: { PANDORA_RECIPE_DIR: dir },
  }));
  assert.equal(approved.command, 'recipe.list');
  assert.equal(approved.data.appliedFilters.approvalStatus, 'approved');
  assert.ok(approved.data.items.every((item) => item.approvalStatus === 'approved'));

  const paper = parseJsonOutput(runCli(['--output', 'json', 'recipe', 'list', '--risk-level', 'paper'], {
    env: { PANDORA_RECIPE_DIR: dir },
  }));
  assert.equal(paper.data.appliedFilters.riskLevel, 'paper');
  assert.ok(paper.data.items.every((item) => item.riskLevel === 'paper'));

  const user = parseJsonOutput(runCli(['--output', 'json', 'recipe', 'list', '--source', 'user'], {
    env: { PANDORA_RECIPE_DIR: dir },
  }));
  assert.equal(user.data.appliedFilters.source, 'user');
  assert.equal(user.data.count, 0);
  assert.equal(user.data.sourceCounts.user, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('recipe list surfaces stored user recipes from the recipe directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-recipe-cli-store-'));
  const file = path.join(dir, 'approved-user.json');
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
    source: 'user',
    approvalStatus: 'approved',
    execution: { safeByDefault: true, operationExpected: false, mutating: false },
  }));

  const list = parseJsonOutput(runCli(['--output', 'json', 'recipe', 'list', '--source', 'user'], {
    env: { PANDORA_RECIPE_DIR: dir },
  }));
  assert.equal(list.command, 'recipe.list');
  assert.equal(list.data.count, 1);
  assert.equal(list.data.items[0].id, 'custom.capabilities');
  assert.equal(list.data.items[0].source, 'user');
  assert.equal(list.data.items[0].approvalStatus, 'unreviewed');
  assert.equal(list.data.items[0].riskLevel, 'read-only');

  fs.rmSync(dir, { recursive: true, force: true });
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
  assert.equal(get.data.recipe.source, 'user');
  assert.equal(get.data.recipe.approvalStatus, 'unreviewed');
  assert.equal(get.data.origin, 'file');

  const validate = parseJsonOutput(runCli(['--output', 'json', 'recipe', 'validate', '--file', file]));
  assert.equal(validate.command, 'recipe.validate');
  assert.equal(validate.data.ok, true);
  assert.deepEqual(validate.data.compiledCommand, ['capabilities']);
  assert.ok(validate.data.validation.warnings.some((entry) => entry.code === 'RECIPE_UNREVIEWED_SOURCE'));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('recipe validate still warns user recipes as unreviewed when the manifest self-attests approved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-recipe-cli-approved-'));
  const file = path.join(dir, 'recipe.json');
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: '1.0.0',
    kind: 'recipe',
    id: 'custom.capabilities-approved',
    version: '1.0.0',
    displayName: 'Capabilities Approved',
    description: 'Delegates to capabilities.',
    tool: 'capabilities',
    commandTemplate: ['capabilities'],
    inputs: [],
    source: 'user',
    approvalStatus: 'approved',
    execution: { safeByDefault: true, operationExpected: false, mutating: false },
  }));

  const validate = parseJsonOutput(runCli(['--output', 'json', 'recipe', 'validate', '--file', file]));
  assert.equal(validate.command, 'recipe.validate');
  assert.equal(validate.data.ok, true);
  assert.equal(validate.data.item.approvalStatus, 'unreviewed');
  assert.ok(validate.data.validation.warnings.some((entry) => entry.code === 'RECIPE_UNREVIEWED_SOURCE'));

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
