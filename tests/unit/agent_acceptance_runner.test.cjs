const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_MODE,
  FAST_SKILL_SCENARIO_IDS,
  buildFamilySummary,
  buildInventorySummary,
  buildSkillScenarioCatalog,
  resolveAcceptanceModeOptions,
} = require('../../scripts/lib/agent_acceptance_runner.cjs');

test('agent acceptance family summary counts MCP and CLI-only actions by family', () => {
  const summary = buildFamilySummary([
    { name: 'bootstrap', mcpExposed: true, requiresSecrets: false, actionClass: 'read' },
    { name: 'mirror.plan', mcpExposed: true, requiresSecrets: false, actionClass: 'read' },
    { name: 'mirror.go', mcpExposed: true, requiresSecrets: true, actionClass: 'simulate' },
    { name: 'launch', mcpExposed: false, requiresSecrets: true, actionClass: 'non-mcp' },
  ]);

  const byFamily = new Map(summary.map((entry) => [entry.family, entry]));
  assert.deepEqual(byFamily.get('mirror'), {
    family: 'mirror',
    total: 2,
    mcpExposed: 2,
    cliOnly: 0,
    requiresSecrets: 1,
    readLike: 1,
    mutatingLike: 1,
  });
  assert.deepEqual(byFamily.get('launch'), {
    family: 'launch',
    total: 1,
    mcpExposed: 0,
    cliOnly: 1,
    requiresSecrets: 1,
    readLike: 1,
    mutatingLike: 0,
  });
});

test('agent acceptance inventory summary exposes skill and journey catalog counts', () => {
  const inventory = buildInventorySummary({
    actionCount: 3,
    mcpActionCount: 2,
    countsByClass: { read: 2, 'non-mcp': 1 },
    actions: [
      { name: 'bootstrap', mcpExposed: true, requiresSecrets: false, actionClass: 'read' },
      { name: 'quote', mcpExposed: true, requiresSecrets: false, actionClass: 'read' },
      { name: 'launch', mcpExposed: false, requiresSecrets: true, actionClass: 'non-mcp' },
    ],
  });

  assert.equal(inventory.actionCount, 3);
  assert.equal(inventory.mcpActionCount, 2);
  assert.equal(inventory.cliOnlyActionCount, 1);
  assert.ok(inventory.skillScenarioCatalog.totalCount > 0);
  assert.ok(inventory.supportedJourneyCount > 0);
});

test('skill scenario catalog includes the expanded functional coverage', () => {
  const catalog = buildSkillScenarioCatalog();
  assert.ok(catalog.functionalScenarioIds.includes('market-type-choice'));
  assert.ok(catalog.functionalScenarioIds.includes('market-suggestions'));
  assert.ok(catalog.functionalScenarioIds.includes('watch-risk-monitoring'));
  assert.ok(catalog.functionalScenarioIds.includes('sports-provider-onboarding'));
  assert.ok(catalog.functionalScenarioIds.includes('builder-surface-choice'));
});

test('agent acceptance mode defaults to fast and trims only the skill-runtime scenario subset', () => {
  const fast = resolveAcceptanceModeOptions({});
  assert.equal(fast.mode, DEFAULT_MODE);
  assert.deepEqual(fast.skillScenarioIds, [...FAST_SKILL_SCENARIO_IDS]);

  const full = resolveAcceptanceModeOptions({ mode: 'full' });
  assert.equal(full.mode, 'full');
  assert.equal(full.skillScenarioIds, null);

  const explicit = resolveAcceptanceModeOptions({ skillScenarioIds: ['safe-bootstrap'], mode: 'fast' });
  assert.deepEqual(explicit.skillScenarioIds, ['safe-bootstrap']);
});
