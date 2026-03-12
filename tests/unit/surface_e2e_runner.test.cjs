const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildActionInventory,
  evaluateSkillRuntimeEvidence,
  evaluateSkillScenarioResponse,
  getSweepRecordStatus,
  parseSurfaceList,
  summarizeSweep,
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
  assert.deepEqual(parseSurfaceList('all'), ['cli-json', 'mcp-stdio', 'mcp-http', 'skill-bundle']);
  assert.deepEqual(parseSurfaceList('cli-json,skill-runtime'), ['cli-json', 'skill-runtime']);
});

test('surface sweep classifies MCP-blocked long-running commands as skipped instead of transport failures', () => {
  const action = { mcpLongRunningBlocked: true };
  const status = getSweepRecordStatus(
    {
      transportError: 'watch is blocked in MCP v1 because it is long-running/unbounded.',
      structured: false,
      ok: false,
    },
    action,
  );
  assert.equal(status, 'skipped-long-running');

  const summary = summarizeSweep(
    [
      {
        name: 'watch',
        status,
        ok: false,
        transportError: 'watch is blocked in MCP v1 because it is long-running/unbounded.',
      },
    ],
    ['watch'],
    false,
  );
  assert.equal(summary.failureCount, 0);
  assert.equal(summary.skipped.length, 1);
  assert.equal(summary.countsByStatus['skipped-long-running'], 1);
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

test('skill scenario evaluation accepts validate wording for mirror planning', () => {
  const trigger = evaluateSkillScenarioResponse(
    'trigger-should',
    {
      id: 'mirror-plan',
      mustMention: ['mirror', 'plan', 'validation'],
      mustAvoid: ['execute live immediately'],
    },
    'Pick a candidate market, then I will run mirror plan and validate the final payload before any deploy step.',
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

test('skill scenario evaluation covers market suggestions and builder choice heuristics', () => {
  const suggestions = evaluateSkillScenarioResponse(
    'functional',
    {
      id: 'market-suggestions',
    },
    'Use markets.hype.plan as the default Pandora suggestion path. For real suggestions prefer provider-backed planning with auto, OpenAI, or Anthropic. Keep mock as deterministic test-only mode, and use agent.market.hype only as fallback orchestration.',
  );
  assert.equal(suggestions.ok, true);

  const builder = evaluateSkillScenarioResponse(
    'functional',
    {
      id: 'builder-surface-choice',
    },
    'Use MCP for agent tool use, CLI for terminal scripts and operators, and the SDK for embedding Pandora into application code. Start all three with bootstrap, and keep local stdio versus hosted HTTP ownership explicit.',
  );
  assert.equal(builder.ok, true);
});

test('safe bootstrap allows deferred signer-secret mentions after read-only guidance', () => {
  const functional = evaluateSkillScenarioResponse(
    'functional',
    {
      id: 'safe-bootstrap',
    },
    'Start with read-only bootstrap, capabilities, and schema discovery. Review policy and profile readiness before live execution. No secrets required for these steps. Before any mutating workflow, resolve the missing private key or signer context for the mutable profile you plan to use.',
  );
  assert.equal(functional.ok, true);
});

test('skill functional evaluation accepts market-type and suggestion-routing guidance', () => {
  const marketType = evaluateSkillScenarioResponse(
    'functional',
    {
      id: 'market-type-choice',
    },
    'For a 99.9/0.1 setup, explain both AMM and parimutuel first. Parimutuel is pool-based and funds stay locked until resolution, while AMM reprices continuously as liquidity and probability move. Keep the user in plan and validation mode before any deploy step.',
  );
  assert.equal(marketType.ok, true);

  const suggestions = evaluateSkillScenarioResponse(
    'functional',
    {
      id: 'market-suggestions',
    },
    'For an MCP user, start with markets.hype.plan. Use provider-backed planning with auto, OpenAI, or Anthropic for real suggestions, treat mock as deterministic test-only mode, and fall back to agent.market.hype only when the host agent must do the research itself.',
  );
  assert.equal(suggestions.ok, true);
});

test('skill functional evaluation accepts monitoring, sports onboarding, and builder-surface guidance', () => {
  const monitoring = evaluateSkillScenarioResponse(
    'functional',
    {
      id: 'watch-risk-monitoring',
    },
    'Start read-only with watch plus risk show and explain before any trade workflow.',
  );
  assert.equal(monitoring.ok, true);

  const sports = evaluateSkillScenarioResponse(
    'functional',
    {
      id: 'sports-provider-onboarding',
    },
    'If sportsbook providers are missing, run sports books list first and fix provider configuration before trying schedule or event discovery.',
  );
  assert.equal(sports.ok, true);

  const builder = evaluateSkillScenarioResponse(
    'functional',
    {
      id: 'builder-surface-choice',
    },
    'Use MCP for agent tool use, the CLI for terminal scripts and operator automation, and the SDK when you need to embed Pandora in application code.',
  );
  assert.equal(builder.ok, true);
});

test('skill runtime evidence requires Pandora tool execution for trigger scenarios', () => {
  const evidence = evaluateSkillRuntimeEvidence('trigger-should', {
    parsed: {
      pandoraToolUses: [{ name: 'mcp__pandora__bootstrap' }],
      toolUses: [{ name: 'mcp__pandora__bootstrap' }],
      permissionDenials: [],
    },
  });
  assert.equal(evidence.ok, true);

  const routed = evaluateSkillRuntimeEvidence('trigger-should', {
    parsed: {
      pandoraToolUses: [],
      toolUses: [{ name: 'ToolSearch', input: { query: 'select:mcp__pandora__quote,mcp__pandora__markets_mine' } }],
      permissionDenials: [],
    },
  });
  assert.equal(routed.ok, true);

  const missing = evaluateSkillRuntimeEvidence('trigger-should', {
    parsed: {
      pandoraToolUses: [],
      toolUses: [],
      permissionDenials: [],
    },
  });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing, ['at least one Pandora MCP tool call or Pandora-specific tool search']);
});

test('skill runtime evidence flags permission denials and non-trigger leakage', () => {
  const denied = evaluateSkillRuntimeEvidence('functional', {
    parsed: {
      pandoraToolUses: [{ name: 'mcp__pandora__quote' }],
      toolUses: [{ name: 'mcp__pandora__quote' }],
      permissionDenials: [{ toolName: 'mcp__pandora__quote' }],
    },
  });
  assert.equal(denied.ok, false);
  assert.deepEqual(denied.forbidden, ['permission-denied tools: mcp__pandora__quote']);

  const leaked = evaluateSkillRuntimeEvidence('trigger-should-not', {
    parsed: {
      pandoraToolUses: [],
      toolUses: [{ name: 'ToolSearch', input: { query: 'select:mcp__pandora__portfolio' } }],
      permissionDenials: [],
    },
  });
  assert.equal(leaked.ok, false);
  assert.deepEqual(leaked.forbidden, ['unexpected Pandora routing: ToolSearch(pandora)']);
});
