const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSportsResolvePlan,
  evaluateResolveCheck,
  evaluateResolveSafety,
} = require('../../cli/lib/sports_resolve_plan_service.cjs');

test('sports resolve plan detects provider disagreement in official tier', () => {
  const checks = [
    {
      checkId: 'c1',
      checkedAt: '2026-03-01T10:00:00.000Z',
      sources: [
        { name: 'official-a', official: true, finalResult: 'yes' },
        { name: 'official-b', official: true, finalResult: 'no' },
      ],
    },
    {
      checkId: 'c2',
      checkedAt: '2026-03-01T10:05:00.000Z',
      sources: [{ name: 'official-a', official: true, finalResult: 'yes' }],
    },
  ];

  const plan = buildSportsResolvePlan({
    pollAddress: '0x1111111111111111111111111111111111111111',
    checks,
    settleDelayMs: 600_000,
    consecutiveChecksRequired: 2,
    now: '2026-03-01T10:20:00.000Z',
  });

  assert.equal(plan.safeToResolve, false);
  assert.equal(plan.recommendedCommand, null);
  assert.equal(
    plan.diagnostics.some((d) => d.code === 'TIER_CONFLICT' || d.code === 'NO_CONSECUTIVE_FINAL_MATCH'),
    true,
  );
});

test('sports resolve safety enforces settle-delay timing boundary exactly', () => {
  const evaluated = [
    evaluateResolveCheck({
      checkId: 'c1',
      checkedAt: '2026-03-01T10:00:00.000Z',
      sources: [{ name: 'official-feed', official: true, finalResult: 'yes' }],
    }),
    evaluateResolveCheck({
      checkId: 'c2',
      checkedAt: '2026-03-01T10:05:00.000Z',
      sources: [{ name: 'official-feed', official: true, finalResult: 'yes' }],
    }),
  ];

  const pending = evaluateResolveSafety(evaluated, {
    consecutiveChecksRequired: 2,
    settleDelayMs: 600_000,
    now: '2026-03-01T10:09:59.999Z',
  });
  assert.equal(pending.safe, false);
  assert.equal(pending.settleDelaySatisfied, false);

  const atBoundary = evaluateResolveSafety(evaluated, {
    consecutiveChecksRequired: 2,
    settleDelayMs: 600_000,
    now: '2026-03-01T10:10:00.000Z',
  });
  assert.equal(atBoundary.safe, true);
  assert.equal(atBoundary.settleDelaySatisfied, true);
  assert.equal(atBoundary.recommendedAnswer, 'yes');
});

test('sports resolve plan remains unsafe for stale checks with missing final outcomes', () => {
  const oldChecks = [
    {
      checkId: 'old-1',
      checkedAt: '2026-02-25T08:00:00.000Z',
      sources: [{ name: 'official-feed', official: true, finalResult: null }],
    },
    {
      checkId: 'old-2',
      checkedAt: '2026-02-25T08:05:00.000Z',
      sources: [{ name: 'official-feed', official: true, finalResult: null }],
    },
  ];

  const plan = buildSportsResolvePlan({
    pollAddress: '0x1111111111111111111111111111111111111111',
    checks: oldChecks,
    settleDelayMs: 600_000,
    consecutiveChecksRequired: 2,
    now: '2026-03-01T12:00:00.000Z',
  });

  assert.equal(plan.safeToResolve, false);
  assert.equal(plan.recommendedAnswer, null);
  assert.equal(
    plan.diagnostics.some((d) => d.code === 'NO_FINAL_RESULT' || d.code === 'NO_CONSECUTIVE_FINAL_MATCH'),
    true,
  );
});
