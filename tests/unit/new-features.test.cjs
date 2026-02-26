const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { normalizeQuestion, questionSimilarity } = require('../../cli/lib/arbitrage_service.cjs');
const { buildSuggestions } = require('../../cli/lib/suggest_service.cjs');
const { evaluateMarket, AnalyzeProviderError } = require('../../cli/lib/analyze_provider.cjs');
const {
  strategyHash,
  saveState,
  pruneIdempotencyKeys,
  resetDailyCountersIfNeeded,
} = require('../../cli/lib/autopilot_state_store.cjs');
const { computeLiquidityRecommendation, computeDistributionHint } = require('../../cli/lib/mirror_sizing_service.cjs');
const { hashRules, buildRuleDiffSummary } = require('../../cli/lib/mirror_verify_service.cjs');
const {
  strategyHash: mirrorStrategyHash,
  saveState: saveMirrorState,
  loadState: loadMirrorState,
} = require('../../cli/lib/mirror_state_store.cjs');
const { calculateExecutableDepthUsd } = require('../../cli/lib/polymarket_trade_adapter.cjs');

test('normalizeQuestion strips punctuation and stopwords', () => {
  const value = normalizeQuestion('Will, the Arsenal win the PL?!');
  assert.equal(value, 'arsenal win pl');
});

test('questionSimilarity is high for equivalent phrasing', () => {
  const score = questionSimilarity('Will Arsenal win the PL?', 'Arsenal to win Premier League');
  assert.ok(score > 0.6);
});

test('buildSuggestions returns bounded deterministic suggestions', () => {
  const payload = buildSuggestions({
    wallet: '0xabc',
    risk: 'medium',
    budget: 60,
    count: 2,
    arbitrageOpportunities: [
      {
        groupId: 'g1',
        spreadYesPct: 8,
        spreadNoPct: 2,
        confidenceScore: 0.7,
        bestYesBuy: { venue: 'pandora', marketId: 'm1' },
        bestNoBuy: { venue: 'pandora', marketId: 'm2' },
        riskFlags: [],
      },
      {
        groupId: 'g2',
        spreadYesPct: 2,
        spreadNoPct: 6,
        confidenceScore: 0.6,
        bestYesBuy: { venue: 'polymarket', marketId: 'm3' },
        bestNoBuy: { venue: 'polymarket', marketId: 'm4' },
        riskFlags: ['LOW_LIQUIDITY'],
      },
    ],
  });

  assert.equal(payload.count, 2);
  assert.equal(payload.items[0].groupId, 'g1');
  assert.equal(payload.items[0].amountUsdc, 30);
});

test('evaluateMarket throws deterministic error without provider', async () => {
  await assert.rejects(
    () => evaluateMarket({ market: { yesPct: 50 } }, {}),
    (error) => {
      assert.equal(error instanceof AnalyzeProviderError, true);
      assert.equal(error.code, 'ANALYZE_PROVIDER_NOT_CONFIGURED');
      return true;
    },
  );
});

test('autopilot state helpers are deterministic', () => {
  const hash1 = strategyHash({ a: 1, b: 'x' });
  const hash2 = strategyHash({ a: 1, b: 'x' });
  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 16);

  const state = { idempotencyKeys: ['a', 'b', 'c', 'd', 'e'] };
  pruneIdempotencyKeys(state, 3);
  assert.deepEqual(state.idempotencyKeys, ['c', 'd', 'e']);

  const stale = {
    lastResetDay: '2000-01-01',
    dailySpendUsdc: 100,
    tradesToday: 10,
  };
  resetDailyCountersIfNeeded(stale, new Date('2026-02-26T00:00:00.000Z'));
  assert.equal(stale.dailySpendUsdc, 0);
  assert.equal(stale.tradesToday, 0);
  assert.equal(stale.lastResetDay, '2026-02-26');
});

test('saveState uses unique temp files per write to avoid cross-process rename collisions', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-autopilot-state-'));
  const stateFile = path.join(tempDir, 'state.json');

  const originalWriteFileSync = fs.writeFileSync;
  const originalRenameSync = fs.renameSync;
  const writeTargets = [];
  const renameTargets = [];

  try {
    fs.writeFileSync = (target, content) => {
      writeTargets.push(target);
      return originalWriteFileSync(target, content);
    };
    fs.renameSync = (from, to) => {
      renameTargets.push([from, to]);
      return originalRenameSync(from, to);
    };

    saveState(stateFile, { iteration: 1 });
    saveState(stateFile, { iteration: 2 });
  } finally {
    fs.writeFileSync = originalWriteFileSync;
    fs.renameSync = originalRenameSync;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  assert.equal(writeTargets.length, 2);
  assert.equal(renameTargets.length, 2);
  assert.notEqual(writeTargets[0], writeTargets[1]);
  assert.match(path.basename(writeTargets[0]), /^state\.json\.\d+\.\d+\.[a-f0-9]{8}\.tmp$/);
  assert.match(path.basename(writeTargets[1]), /^state\.json\.\d+\.\d+\.[a-f0-9]{8}\.tmp$/);
});

test('mirror liquidity sizing applies model + depth caps deterministically', () => {
  const payload = computeLiquidityRecommendation({
    volume24hUsd: 100_000,
    depthWithinSlippageUsd: 6_000,
    targetSlippageBps: 150,
    turnoverTarget: 1.25,
    safetyMultiplier: 1.2,
    minLiquidityUsd: 100,
    maxLiquidityUsd: 50_000,
  });

  assert.equal(payload.schemaVersion, '1.0.0');
  assert.equal(payload.recommendation.liquidityUsd, 50000);
  assert.equal(payload.recommendation.boundedByMax, true);
  assert.ok(payload.derived.lImpact > 0);
});

test('mirror distribution hint maps YES probability into 1e9 parts', () => {
  const distribution = computeDistributionHint(0.37);
  assert.equal(distribution.distributionNo, 370000000);
  assert.equal(distribution.distributionYes, 630000000);
});

test('mirror rule hashing normalizes whitespace and case', () => {
  const left = hashRules('Resolves YES if A.\nResolves NO otherwise.');
  const right = hashRules('resolves yes if a. resolves no otherwise.');
  assert.equal(left, right);

  const diff = buildRuleDiffSummary('Resolves YES if A.', 'Resolves NO if B.');
  assert.equal(diff.equal, false);
  assert.ok(diff.overlapRatio < 1);
});

test('mirror state writes use unique temp paths and deterministic hash', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-mirror-state-'));
  const stateFile = path.join(tempDir, 'mirror.json');

  const hash1 = mirrorStrategyHash({ market: '0xabc', mode: 'once' });
  const hash2 = mirrorStrategyHash({ market: '0xabc', mode: 'once' });
  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 16);

  const originalWriteFileSync = fs.writeFileSync;
  const writeTargets = [];

  try {
    fs.writeFileSync = (target, content) => {
      writeTargets.push(target);
      return originalWriteFileSync(target, content);
    };

    saveMirrorState(stateFile, { iteration: 1 });
    saveMirrorState(stateFile, { iteration: 2 });
  } finally {
    fs.writeFileSync = originalWriteFileSync;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  assert.equal(writeTargets.length, 2);
  assert.notEqual(writeTargets[0], writeTargets[1]);
  assert.match(path.basename(writeTargets[0]), /^mirror\.json\.\d+\.\d+\.[a-f0-9]{8}\.tmp$/);
});

test('mirror state loader preserves stored strategy hash when lookup hash is omitted', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-mirror-state-load-'));
  const stateFile = path.join(tempDir, 'mirror.json');

  try {
    fs.writeFileSync(
      stateFile,
      JSON.stringify(
        {
          schemaVersion: '1.0.0',
          strategyHash: 'feedfacecafebeef',
          tradesToday: 1,
        },
        null,
        2,
      ),
    );

    const loaded = loadMirrorState(stateFile, null);
    assert.equal(loaded.state.strategyHash, 'feedfacecafebeef');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('orderbook depth calculation honors slippage window', () => {
  const depth = calculateExecutableDepthUsd(
    {
      bids: [
        { price: '0.48', size: '100' },
        { price: '0.47', size: '100' },
      ],
      asks: [
        { price: '0.52', size: '100' },
        { price: '0.53', size: '100' },
      ],
    },
    'buy',
    500,
  );

  assert.ok(depth.depthUsd > 0);
  assert.ok(depth.midPrice !== null);
  assert.ok(depth.worstPrice !== null);
});
