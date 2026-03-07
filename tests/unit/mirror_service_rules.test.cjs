const test = require('node:test');
const assert = require('node:assert/strict');

const { deployMirror } = require('../../cli/lib/mirror_service.cjs');
const { buildRequiredAgentMarketValidation } = require('../../cli/lib/agent_market_prompt_service.cjs');

const FUTURE_TS = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

function buildPlanData(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    sourceMarket: {
      marketId: 'poly-1',
      slug: 'pistons-vs-nets',
      question: 'Will the Detroit Pistons beat the Brooklyn Nets?',
      description: 'This market resolves to Detroit Pistons.',
      closeTimestamp: FUTURE_TS,
      ...(overrides.sourceMarket || {}),
    },
    rules: {
      sourceRules: 'This market resolves to Detroit Pistons.',
      proposedPandoraRules: 'This market resolves to Detroit Pistons.',
      ...(overrides.rules || {}),
    },
    liquidityRecommendation: {
      liquidityUsdc: 100,
      ...(overrides.liquidityRecommendation || {}),
    },
    distributionHint: {
      distributionYes: 500_000_000,
      distributionNo: 500_000_000,
      ...(overrides.distributionHint || {}),
    },
  };
}

test('deployMirror upgrades non-binary mirror rules into Pandora YES/NO rules', async () => {
  const payload = await deployMirror({
    execute: false,
    sources: ['https://www.nba.com', 'https://www.espn.com'],
    planData: buildPlanData(),
  });

  assert.match(payload.deploymentArgs.rules, /^YES: The official winner of the event described in the market question is the Detroit Pistons\./);
  assert.match(payload.deploymentArgs.rules, /^NO: The official winner is the Brooklyn Nets,/m);
  assert.match(payload.deploymentArgs.rules, /^EDGE: /m);
  assert.ok(payload.diagnostics.some((entry) => /upgraded non-binary source rules/i.test(entry)));
});

test('deployMirror rejects missing or dependent mirror sources', async () => {
  await assert.rejects(
    () =>
      deployMirror({
        execute: false,
        sources: [],
        planData: buildPlanData(),
      }),
    (error) => {
      assert.equal(error.code, 'MIRROR_SOURCES_REQUIRED');
      assert.match(error.message, /requires explicit independent resolution sources/i);
      return true;
    },
  );

  await assert.rejects(
    () =>
      deployMirror({
        execute: false,
        sources: ['https://polymarket.com/event/test', 'https://clob.polymarket.com'],
        planData: buildPlanData(),
      }),
    (error) => {
      assert.equal(error.code, 'MIRROR_SOURCES_INVALID');
      assert.match(error.message, /independent resolution sources/i);
      return true;
    },
  );

  await assert.rejects(
    () =>
      deployMirror({
        execute: false,
        sources: ['https://www.nba.com/game/1', 'https://www.nba.com/game/2'],
        planData: buildPlanData(),
      }),
    (error) => {
      assert.equal(error.code, 'MIRROR_SOURCES_REQUIRED');
      assert.match(error.message, /different hosts/i);
      return true;
    },
  );
});

test('deployMirror execute requires an exact validation ticket in local CLI mode', async () => {
  const planData = buildPlanData();
  const sources = ['https://www.nba.com', 'https://www.espn.com'];
  const dryRunPayload = await deployMirror({
    execute: false,
    sources,
    planData,
  });
  const requiredValidation = buildRequiredAgentMarketValidation({
    question: planData.sourceMarket.question,
    rules: dryRunPayload.deploymentArgs.rules,
    sources,
    targetTimestamp: planData.sourceMarket.closeTimestamp,
  });

  await assert.rejects(
    () =>
      deployMirror({
        execute: true,
        sources,
        planData,
      }),
    (error) => {
      assert.equal(error.code, 'MIRROR_VALIDATION_REQUIRED');
      assert.equal(error.details.requiredValidation.ticket, requiredValidation.ticket);
      return true;
    },
  );

  await assert.rejects(
    () =>
      deployMirror({
        execute: true,
        sources,
        validationTicket: 'market-validate:wrongticket',
        planData,
      }),
    (error) => {
      assert.equal(error.code, 'MIRROR_VALIDATION_MISMATCH');
      assert.equal(error.details.expectedTicket, requiredValidation.ticket);
      return true;
    },
  );
});
