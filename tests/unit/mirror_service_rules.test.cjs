const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { deployMirror } = require('../../cli/lib/mirror_service.cjs');
const { buildRequiredAgentMarketValidation } = require('../../cli/lib/agent_market_prompt_service.cjs');
const { upsertPair } = require('../../cli/lib/mirror_manifest_store.cjs');
const { writeMirrorDeployGuard } = require('../../cli/lib/mirror_deploy_guard_store.cjs');

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

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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
      assert.match(error.message, /requires explicit independent public resolution sources/i);
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

test('deployMirror ignores administrative source outcomes and derives winner rules from the question', async () => {
  const payload = await deployMirror({
    execute: false,
    sources: ['https://www.fifa.com', 'https://en.wikipedia.org/wiki/2026_FIFA_World_Cup'],
    planData: buildPlanData({
      sourceMarket: {
        question: 'Will France win the 2026 FIFA World Cup?',
        description: [
          'This market will resolve according to the national team that wins the 2026 FIFA World Cup.',
          'If at any point it becomes impossible for this team to win the FIFA World Cup based on the rules of FIFA, this market will resolve immediately to "No".',
          'If the 2026 FIFA World Cup is permanently canceled or has not been completed by October 13, 2026, 11:59 PM this market will resolve to "Other".',
        ].join('\n\n'),
      },
      rules: {
        sourceRules: null,
        proposedPandoraRules: null,
      },
    }),
  });

  assert.match(payload.deploymentArgs.rules, /^YES: The official winner of the event described in the market question is France\./);
  assert.match(payload.deploymentArgs.rules, /^NO: France is not the official winner of the event described in the market question\./m);
  assert.ok(payload.diagnostics.some((entry) => /ignored administrative source outcome label/i.test(String(entry))));
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

test('deployMirror execute blocks when a canonical pair already exists for the source market', async () => {
  const tempDir = createTempDir('pandora-mirror-existing-pair-');
  const manifestFile = path.join(tempDir, 'pairs.json');
  const planData = buildPlanData();
  const sources = ['https://www.nba.com', 'https://www.espn.com'];

  try {
    const dryRunPayload = await deployMirror({
      execute: false,
      sources,
      planData,
      manifestFile,
    });
    const validation = buildRequiredAgentMarketValidation({
      question: planData.sourceMarket.question,
      rules: dryRunPayload.deploymentArgs.rules,
      sources,
      targetTimestamp: planData.sourceMarket.closeTimestamp,
    });

    upsertPair(manifestFile, {
      trusted: true,
      canonical: true,
      pandoraMarketAddress: '0x1111111111111111111111111111111111111111',
      pandoraPollAddress: '0x2222222222222222222222222222222222222222',
      polymarketMarketId: 'poly-1',
      polymarketSlug: 'pistons-vs-nets',
      sourceQuestion: planData.sourceMarket.question,
      sourceRuleHash: 'rule-hash-1',
    });

    await assert.rejects(
      () =>
        deployMirror({
          execute: true,
          sources,
          validationTicket: validation.ticket,
          planData,
          manifestFile,
        }),
      (error) => {
        assert.equal(error.code, 'MIRROR_DEPLOY_ALREADY_EXISTS');
        assert.equal(error.details.pair.pandoraMarketAddress, '0x1111111111111111111111111111111111111111');
        return true;
      },
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('deployMirror execute blocks when a prior deploy guard requires manual review', async () => {
  const tempDir = createTempDir('pandora-mirror-guard-');
  const guardDir = path.join(tempDir, 'guards');
  const planData = buildPlanData();
  const sources = ['https://www.nba.com', 'https://www.espn.com'];

  try {
    const dryRunPayload = await deployMirror({
      execute: false,
      sources,
      planData,
      deployGuardDir: guardDir,
    });
    const validation = buildRequiredAgentMarketValidation({
      question: planData.sourceMarket.question,
      rules: dryRunPayload.deploymentArgs.rules,
      sources,
      targetTimestamp: planData.sourceMarket.closeTimestamp,
    });

    writeMirrorDeployGuard(
      {
        polymarketMarketId: 'poly-1',
        polymarketSlug: 'pistons-vs-nets',
      },
      {
        status: 'manual_review_required',
        chainWriteStarted: true,
        pollTxHash: '0xabc',
        createdAt: new Date().toISOString(),
      },
      {
        guardDir,
      },
    );

    await assert.rejects(
      () =>
        deployMirror({
          execute: true,
          sources,
          validationTicket: validation.ticket,
          planData,
          deployGuardDir: guardDir,
        }),
      (error) => {
        assert.equal(error.code, 'MIRROR_DEPLOY_IN_PROGRESS');
        assert.equal(error.details.guard.status, 'manual_review_required');
        return true;
      },
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('deployMirror execute resumes an orphan poll from a manual-review guard instead of duplicating deploy', async () => {
  const tempDir = createTempDir('pandora-mirror-guard-resume-');
  const guardDir = path.join(tempDir, 'guards');
  const manifestFile = path.join(tempDir, 'pairs.json');
  const planData = buildPlanData();
  const sources = ['https://www.nba.com', 'https://www.espn.com'];
  let receivedResumePollAddress = null;

  try {
    const dryRunPayload = await deployMirror({
      execute: false,
      sources,
      planData,
      deployGuardDir: guardDir,
      manifestFile,
    });
    const validation = buildRequiredAgentMarketValidation({
      question: planData.sourceMarket.question,
      rules: dryRunPayload.deploymentArgs.rules,
      sources,
      targetTimestamp: planData.sourceMarket.closeTimestamp,
    });

    writeMirrorDeployGuard(
      {
        polymarketMarketId: 'poly-1',
        polymarketSlug: 'pistons-vs-nets',
      },
      {
        status: 'manual_review_required',
        chainWriteStarted: true,
        pollAddress: '0x1234567890abcdef1234567890abcdef12345678',
        marketTxHash: null,
        createdAt: new Date().toISOString(),
      },
      {
        guardDir,
      },
    );

    const payload = await deployMirror({
      execute: true,
      sources,
      validationTicket: validation.ticket,
      planData,
      deployGuardDir: guardDir,
      manifestFile,
      deployPandoraAmmMarket: async (options = {}) => {
        receivedResumePollAddress = options.resumePollAddress;
        return {
          mode: 'execute',
          diagnostics: [],
          tx: {
            pollTxHash: null,
            approveTxHash: '0xaaa',
            marketTxHash: '0xbbb',
          },
          pandora: {
            pollAddress: options.resumePollAddress,
            marketAddress: '0x9999999999999999999999999999999999999999',
          },
        };
      },
    });

    assert.equal(receivedResumePollAddress, '0x1234567890abcdef1234567890abcdef12345678');
    assert.equal(payload.pandora.marketAddress, '0x9999999999999999999999999999999999999999');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
