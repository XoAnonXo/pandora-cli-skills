const test = require('node:test');
const assert = require('node:assert/strict');

const {
  deriveJourneyClassification,
  deriveDeployerAssessment,
  deriveMcpParimutuelAssessment,
  parseScenarioList,
  SUPPORTED_SCENARIOS,
} = require('../../scripts/lib/user_journey_runner.cjs');

test('parseScenarioList expands all and rejects unknown scenarios', () => {
  assert.deepEqual(parseScenarioList('all'), SUPPORTED_SCENARIOS);
  assert.deepEqual(parseScenarioList('deployer'), ['deployer']);
  assert.deepEqual(parseScenarioList('amm-mirror-zero-prereqs'), ['amm-mirror-zero-prereqs']);
  assert.deepEqual(parseScenarioList('mcp-parimutuel'), ['mcp-parimutuel']);
  assert.throws(() => parseScenarioList('bogus'), /Unknown scenario: bogus/);
});

test('deriveDeployerAssessment flags the major deployer friction points', () => {
  const assessment = deriveDeployerAssessment([
    {
      id: 'cli.setup.default',
      status: 'ok',
    },
    {
      id: 'cli.setup.guided',
      status: 'ok',
    },
    {
      id: 'cli.profile.explain.deployer',
      status: 'ok',
      payloadSummary: {
        remediationCodes: [],
      },
    },
    {
      id: 'sdk.amm.plan.cliish-inputs',
      status: 'ok',
    },
    {
      id: 'cli.amm.execute.no-validation',
      status: 'expected-blocker',
    },
    {
      id: 'sdk.amm.dry-run',
      status: 'ok',
    },
    {
      id: 'cli.parimutuel.dry-run',
      status: 'ok',
    },
    {
      id: 'cli.amm.execute.with-validation',
      status: 'expected-blocker',
      errorMessage: 'insufficient funds for gas * price + value',
    },
    {
      id: 'cli.parimutuel.execute.with-validation',
      status: 'expected-blocker',
      errorMessage: 'insufficient funds for gas * price + value',
    },
  ]);

  const titles = assessment.frictionPoints.map((item) => item.title);
  assert.ok(titles.includes('Live deploy failure appears only at the final execute step'));

  const strengthTitles = assessment.strengths.map((item) => item.title);
  assert.ok(strengthTitles.includes('Default setup now guides fresh deployers past placeholder secrets'));
  assert.ok(strengthTitles.includes('Built-in deployer profile is compatible with market deployment'));
  assert.ok(strengthTitles.includes('SDK and MCP normalize CLI-like market input payloads'));
  assert.ok(strengthTitles.includes('Validation gating is explicit and protective'));
  assert.ok(strengthTitles.includes('AMM and parimutuel creation paths are isolated at plan and dry-run layers'));
});

test('deriveMcpParimutuelAssessment captures suggestion-quality and signer-attached dry-run friction', () => {
  const assessment = deriveMcpParimutuelAssessment([
    {
      id: 'mcp.parimutuel.bootstrap',
      status: 'ok',
    },
    {
      id: 'mcp.parimutuel.profile.recommend',
      status: 'ok',
      payloadSummary: {
        recommendedProfileId: 'market_deployer_a',
      },
    },
    {
      id: 'mcp.parimutuel.autocomplete',
      status: 'ok',
      outputSnippet: 'MARKET TYPE: Parimutuel (pool-based, funds remain locked until resolution)\nPARIMUTUEL GUIDANCE:\n- distribution percentages define the starting YES/NO pool skew.\n- An extreme setup like 99.9/0.1 means an almost one-sided directional pool.',
    },
    {
      id: 'mcp.parimutuel.hype.plan.mock',
      status: 'ok',
      payloadSummary: {
        candidateCount: 1,
        mockProviderTestOnly: true,
        selectedQuestion: 'Will the featured Suggest sharp parimutuel ideas for major 2026 headlines outcome happen by 2026-03-15?',
      },
    },
    {
      id: 'mcp.parimutuel.plan.skewed',
      status: 'ok',
      payloadSummary: {
        distributionYes: 999000000,
        distributionNo: 1000000,
      },
    },
    {
      id: 'mcp.parimutuel.dry-run.no-signer',
      status: 'ok',
    },
    {
      id: 'mcp.parimutuel.dry-run.unfunded-signer',
      status: 'ok',
      payloadSummary: {
        preflightReady: false,
        preflightBlockerCount: 2,
      },
    },
  ]);

  const frictionTitles = assessment.frictionPoints.map((item) => item.title);
  assert.equal(frictionTitles.includes('Mock hype suggestions are not production-quality market ideas'), false);
  assert.equal(frictionTitles.includes('Parimutuel dry-run becomes execution-like as soon as a signer is attached'), false);
  assert.equal(frictionTitles.includes('Parimutuel guidance does not explain skewed pool configuration'), false);

  const strengthTitles = assessment.strengths.map((item) => item.title);
  assert.ok(strengthTitles.includes('MCP bootstrap and profile recommendation expose the deployer path early'));
  assert.ok(strengthTitles.includes('MCP planning accepts an extreme 99.9/0.1 parimutuel skew'));
  assert.ok(strengthTitles.includes('Fresh MCP users can shape the parimutuel payload before attaching a signer'));
  assert.ok(strengthTitles.includes('Autocomplete now explains how an extreme 99.9/0.1 parimutuel skew works'));
  assert.ok(strengthTitles.includes('Mock hype mode is clearly framed as deterministic test-only guidance'));
  assert.ok(strengthTitles.includes('Signer-attached parimutuel dry-run now returns structured readiness blockers'));
});

test('amm-mirror zero-prereq journey summaries capture early profile and source guidance', () => {
  const { summarizePayload } = require('../../scripts/lib/user_journey_runner.cjs');

  const deployRecommend = summarizePayload({
    command: 'profile.recommend',
    data: {
      recommendedProfileId: 'market_deployer_a',
      decision: { bestTool: 'agent.market.validate' },
      onboardingGuidance: {
        companionProfileId: 'prod_trader_a',
      },
    },
  });
  const mirrorRecommend = summarizePayload({
    command: 'profile.recommend',
    data: {
      recommendedProfileId: 'prod_trader_a',
      decision: { bestTool: 'mirror.browse' },
      onboardingGuidance: {
        companionProfileId: 'market_deployer_a',
        sourceRequirement: { minimumSources: 2 },
      },
    },
  });

  assert.equal(deployRecommend.companionProfileId, 'prod_trader_a');
  assert.equal(mirrorRecommend.companionProfileId, 'market_deployer_a');
  assert.equal(mirrorRecommend.mentionsIndependentSourcesRequirement, true);
});

test('journey classification distinguishes clear external prerequisites from generic product state', () => {
  const external = deriveJourneyClassification('blocked-on-provider-configuration', {
    classification: {
      kind: 'external-prerequisite',
      guidanceQuality: 'clear',
      externallyBlocked: true,
      note: 'provider setup missing',
    },
  });
  assert.equal(external.kind, 'external-prerequisite');
  assert.equal(external.guidanceQuality, 'clear');
  assert.equal(external.externallyBlocked, true);

  const achieved = deriveJourneyClassification('achieved', null);
  assert.equal(achieved.kind, 'achieved');
  assert.equal(achieved.guidanceQuality, 'clear');
  assert.equal(achieved.externallyBlocked, false);
});
