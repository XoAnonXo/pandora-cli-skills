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
