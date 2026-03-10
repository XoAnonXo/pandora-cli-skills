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
  assert.equal(plan.status, 'unsafe');
  assert.equal(plan.recommendedCommand, null);
  assert.equal(plan.blockingCodes.includes('TIER_CONFLICT') || plan.blockingCodes.includes('NO_CONSECUTIVE_FINAL_MATCH'), true);
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

test('sports resolve plan exposes strict execution payload when safe to resolve', () => {
  const checks = [
    {
      checkId: 'c1',
      checkedAt: '2026-03-01T10:00:00.000Z',
      sources: [{ name: 'official-feed', official: true, finalResult: 'yes', checkedAt: '2026-03-01T10:00:00.000Z' }],
    },
    {
      checkId: 'c2',
      checkedAt: '2026-03-01T10:05:00.000Z',
      sources: [{ name: 'official-feed', official: true, finalResult: 'yes', checkedAt: '2026-03-01T10:05:00.000Z' }],
    },
  ];

  const plan = buildSportsResolvePlan({
    pollAddress: '0x1111111111111111111111111111111111111111',
    reason: 'Official final score confirmed.',
    checks,
    settleDelayMs: 600_000,
    consecutiveChecksRequired: 2,
    now: '2026-03-01T10:10:00.000Z',
    extraFlags: ['--rpc-url', 'https://rpc.example'],
  });

  assert.equal(plan.safeToResolve, true);
  assert.equal(plan.status, 'safe');
  assert.equal(plan.recommendedAnswer, 'yes');
  assert.equal(plan.summary.executionReady, true);
  assert.deepEqual(plan.blockingCodes, []);
  assert.equal(plan.resolution.sourceTier, 'official');
  assert.equal(plan.resolution.supportingChecks.length, 2);
  assert.equal(plan.execution.ready, true);
  assert.equal(plan.execution.commandName, 'resolve');
  assert.equal(plan.execution.flags.pollAddress, '0x1111111111111111111111111111111111111111');
  assert.equal(plan.execution.flags.answer, 'yes');
  assert.equal(plan.execution.flags.reason, 'Official final score confirmed.');
  assert.equal(plan.execution.flags.execute, true);
  assert.deepEqual(plan.execution.flags.extraFlags, ['--rpc-url', 'https://rpc.example']);
  assert.deepEqual(
    plan.execution.argv,
    [
      'resolve',
      '--poll-address',
      '0x1111111111111111111111111111111111111111',
      '--answer',
      'yes',
      '--reason',
      'Official final score confirmed.',
      '--execute',
      '--rpc-url',
      'https://rpc.example',
    ],
  );
  assert.match(plan.execution.command, /^pandora resolve --poll-address /);
});

test('sports resolve plan carries blocking codes and retry timing when settle delay is still pending', () => {
  const checks = [
    {
      checkId: 'c1',
      checkedAt: '2026-03-01T10:00:00.000Z',
      sources: [{ name: 'official-feed', official: true, finalResult: 'yes', checkedAt: '2026-03-01T10:00:00.000Z' }],
    },
    {
      checkId: 'c2',
      checkedAt: '2026-03-01T10:05:00.000Z',
      sources: [{ name: 'official-feed', official: true, finalResult: 'yes', checkedAt: '2026-03-01T10:05:00.000Z' }],
    },
  ];

  const plan = buildSportsResolvePlan({
    pollAddress: '0x1111111111111111111111111111111111111111',
    checks,
    settleDelayMs: 600_000,
    consecutiveChecksRequired: 2,
    now: '2026-03-01T10:09:00.000Z',
  });

  assert.equal(plan.safeToResolve, false);
  assert.equal(plan.status, 'unsafe');
  assert.equal(plan.recommendedAnswer, 'yes');
  assert.equal(plan.blockingCodes.includes('SETTLE_DELAY_PENDING'), true);
  assert.equal(plan.unsafeDiagnostics.some((entry) => entry.code === 'SETTLE_DELAY_PENDING'), true);
  assert.equal(plan.execution.ready, false);
  assert.equal(plan.execution.blockedBy.includes('SETTLE_DELAY_PENDING'), true);
  assert.equal(plan.timing.remainingSettleDelayMs, 60_000);
  assert.equal(plan.timing.recommendedRecheckAt, '2026-03-01T10:10:00.000Z');
  assert.equal(plan.summary.executionReady, false);
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
  assert.equal(plan.status, 'unsafe');
  assert.equal(plan.recommendedAnswer, null);
  assert.equal(plan.execution.ready, false);
  assert.equal(plan.blockingCodes.includes('NO_FINAL_RESULT') || plan.blockingCodes.includes('NO_CONSECUTIVE_FINAL_MATCH'), true);
  assert.equal(
    plan.diagnostics.some((d) => d.code === 'NO_FINAL_RESULT' || d.code === 'NO_CONSECUTIVE_FINAL_MATCH'),
    true,
  );
});
