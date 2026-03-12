const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildActionInventory,
  evaluateSkillScenarioResponse,
  parseSurfaceList,
} = require('../../scripts/lib/surface_e2e_runner.cjs');

test('surface e2e inventory classifies canonical Pandora actions', () => {
  const inventory = buildActionInventory();
  assert.equal(inventory.actionCount > 0, true);
  assert.equal(inventory.mcpActionCount > 0, true);

  const byName = new Map(inventory.actions.map((action) => [action.name, action]));
  assert.equal(byName.get('bootstrap').actionClass, 'read');
  assert.equal(byName.get('quote').actionClass, 'read');
  assert.equal(byName.get('trade').actionClass, 'simulate');
  assert.equal(byName.get('operations.cancel').actionClass, 'mutating-control');
});

test('surface parsing expands all and keeps explicit surfaces stable', () => {
  assert.deepEqual(parseSurfaceList('all'), ['mcp-stdio', 'mcp-http', 'skill-bundle']);
  assert.deepEqual(parseSurfaceList('mcp-stdio,skill-runtime'), ['mcp-stdio', 'skill-runtime']);
});

test('skill scenario evaluation enforces must-do and must-not-do phrases', () => {
  const functional = evaluateSkillScenarioResponse(
    'functional',
    {
      mustDo: ['bootstrap', 'schema'],
      mustNotDo: ['private key'],
    },
    'Start with bootstrap, then inspect schema before asking for anything sensitive.',
  );
  assert.equal(functional.ok, true);

  const failing = evaluateSkillScenarioResponse(
    'trigger-should',
    {
      mustMention: ['pandora mcp'],
      mustAvoid: ['execute live immediately'],
    },
    'You should execute live immediately.',
  );
  assert.equal(failing.ok, false);
  assert.deepEqual(failing.missing, ['pandora mcp']);
  assert.deepEqual(failing.forbidden, ['execute live immediately']);
});
