const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildScenarioPrompt,
} = require('../../scripts/claude_skill_executor.cjs');

test('generic buy workflow prompt gets quote-first instructions', () => {
  const prompt = buildScenarioPrompt({
    kind: 'functional',
    userPrompt: 'I want to buy into a Pandora market. Walk me through the safe first step and show the command family I should use.',
  });
  assert.match(prompt, /quote first/i);
  assert.match(prompt, /do not start with polymarket preflight/i);
  assert.match(prompt, /scan or markets list\|get/i);
});

test('mirror planning prompt requires independent public resolution sources', () => {
  const prompt = buildScenarioPrompt({
    kind: 'functional',
    userPrompt: 'Plan a Pandora mirror from a Polymarket market, but keep it dry-run only and tell me what I need before any live step.',
  });
  assert.match(prompt, /two independent public resolution sources/i);
  assert.match(prompt, /polymarket, gamma, and clob urls are discovery inputs/i);
});

test('market suggestion prompt prefers provider-backed planning and mock test mode', () => {
  const prompt = buildScenarioPrompt({
    kind: 'functional',
    userPrompt: 'Suggest Pandora markets I could launch this week and tell me the safest suggestion path.',
  });
  assert.match(prompt, /markets\.hype\.plan|markets hype plan/i);
  assert.match(prompt, /provider-backed/i);
  assert.match(prompt, /mock deterministic test-only mode/i);
  assert.match(prompt, /agent market hype/i);
});

test('builder surface-choice prompt keeps bootstrap and runtime ownership explicit', () => {
  const prompt = buildScenarioPrompt({
    kind: 'functional',
    userPrompt: 'I am integrating Pandora into my own agent product. Should I use MCP, the SDK, or CLI JSON first?',
  });
  assert.match(prompt, /bootstrap/i);
  assert.match(prompt, /mcp/i);
  assert.match(prompt, /sdk/i);
  assert.match(prompt, /cli/i);
  assert.match(prompt, /local stdio versus hosted http ownership explicit/i);
  assert.match(prompt, /do not imply that the sdk bypasses transport, policy, or runtime readiness checks/i);
});
