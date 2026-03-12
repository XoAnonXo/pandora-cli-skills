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

test('skill scenario evaluation normalizes canonical tool ids for trigger routing', () => {
  const trigger = evaluateSkillScenarioResponse(
    'trigger-should',
    {
      id: 'profile-readiness',
      mustMention: ['profile list', 'profile explain'],
      mustAvoid: [],
    },
    'Use `mcp__pandora__profile_list` first, then `mcp__pandora__profile_explain` for the live trade context.',
  );
  assert.equal(trigger.ok, true);
});

test('skill scenario evaluation applies transport heuristics for local vs hosted MCP', () => {
  const trigger = evaluateSkillScenarioResponse(
    'trigger-should',
    {
      id: 'start-mcp',
      mustMention: ['pandora mcp', 'pandora mcp http'],
      mustAvoid: ['treat remote http as the default for live user funds'],
    },
    'Use local stdio MCP when the LLM runs beside your wallet. Use the hosted HTTP gateway for intentional remote access, starting with read-only scopes.',
  );
  assert.equal(trigger.ok, true);
});

test('skill scenario evaluation rejects missing and forbidden guidance', () => {
  const functional = evaluateSkillScenarioResponse(
    'functional',
    {
      id: 'safe-bootstrap',
    },
    'Start with read-only bootstrap, capabilities, and schema discovery. Review policy and profile guidance before any live execution.',
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
