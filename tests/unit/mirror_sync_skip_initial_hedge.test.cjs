const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSyncStrategy, buildTickPlan } = require('../../cli/lib/mirror_sync/planning.cjs');
const { createState } = require('../../cli/lib/mirror_state_store.cjs');

function buildPlanOptions(overrides = {}) {
  return {
    hedgeEnabled: true,
    hedgeTriggerUsdc: 1,
    hedgeRatio: 1,
    maxHedgeUsdc: 10_000,
    maxRebalanceUsdc: 10_000,
    driftTriggerBps: 10_000,
    ...overrides,
  };
}

test('buildSyncStrategy includes normalized skip-initial-hedge state for hashing', () => {
  const strategyEnabled = buildSyncStrategy({
    mode: 'sync',
    pandoraMarketAddress: '0x1111111111111111111111111111111111111111',
    polymarketMarketId: 'poly-1',
    skipInitialHedge: 'true',
  });
  const strategyDisabled = buildSyncStrategy({
    mode: 'sync',
    pandoraMarketAddress: '0x1111111111111111111111111111111111111111',
    polymarketMarketId: 'poly-1',
    skipInitialHedge: false,
  });

  assert.equal(strategyEnabled.skipInitialHedge, true);
  assert.equal(strategyDisabled.skipInitialHedge, false);
});

test('buildTickPlan captures and persists startup hedge baseline on first skip-initial tick', () => {
  const state = createState('strategy-hash', { currentHedgeUsdc: 2 });
  const options = buildPlanOptions({ skipInitialHedge: true });
  const snapshotMetrics = {
    reserveYesUsdc: 80,
    reserveNoUsdc: 20,
    sourceYesPct: 50,
    pandoraYesPct: 50,
  };

  const plan = buildTickPlan({
    snapshotMetrics,
    state,
    options,
  });

  assert.equal(plan.rawGapUsdc, -62);
  assert.equal(plan.gapUsdc, 0);
  assert.equal(plan.hedgeTriggered, false);
  assert.equal(plan.skipInitialHedge, true);
  assert.equal(plan.skipInitialHedgeApplied, true);
  assert.equal(plan.startupHedgeBaselineCaptured, true);
  assert.equal(plan.startupHedgeBaselineUsdc, -62);
  assert.equal(state.currentHedgeUsdc, 2);
  assert.equal(state.startupHedgeBaselineUsdc, -62);
  assert.equal(state.startupHedgeBaseline.source, 'skip-initial-hedge');
  assert.ok(typeof state.startupHedgeBaselineCapturedAt === 'string' && state.startupHedgeBaselineCapturedAt.length > 0);
});

test('buildTickPlan uses persisted startup baseline deltas on subsequent ticks', () => {
  const state = createState('strategy-hash', {
    currentHedgeUsdc: 2,
    startupHedgeBaselineUsdc: -62,
    startupHedgeBaselineCapturedAt: '2026-03-18T00:00:00.000Z',
  });
  const options = buildPlanOptions({ skipInitialHedge: true });
  const snapshotMetrics = {
    reserveYesUsdc: 85,
    reserveNoUsdc: 20,
    sourceYesPct: 50,
    pandoraYesPct: 50,
  };

  const plan = buildTickPlan({
    snapshotMetrics,
    state,
    options,
  });

  assert.equal(plan.rawGapUsdc, -67);
  assert.equal(plan.gapUsdc, -5);
  assert.equal(plan.skipInitialHedgeApplied, false);
  assert.equal(plan.startupHedgeBaselineCaptured, false);
  assert.equal(plan.hedgeTriggered, true);
  assert.equal(plan.plannedHedgeUsdc, 5);
  assert.equal(state.startupHedgeBaselineUsdc, -62);
});

test('buildTickPlan preserves pool vs total hedge scope semantics', () => {
  const snapshotMetrics = {
    reserveYesUsdc: 2000,
    reserveNoUsdc: 857,
    sourceYesPct: 30,
    pandoraYesPct: 30,
  };
  const state = {
    currentHedgeUsdc: 0,
    accounting: {
      pandoraWalletYesUsdc: 1143,
      pandoraWalletNoUsdc: 0,
    },
  };
  const options = buildPlanOptions({ skipInitialHedge: false });

  const totalPlan = buildTickPlan({
    snapshotMetrics,
    state,
    options,
  });
  const poolPlan = buildTickPlan({
    snapshotMetrics,
    state,
    options: { ...options, hedgeScope: 'pool' },
  });

  assert.equal(totalPlan.rawGapUsdc, -2286);
  assert.equal(totalPlan.gapUsdc, -2286);
  assert.equal(poolPlan.rawGapUsdc, -1143);
  assert.equal(poolPlan.gapUsdc, -1143);
});

test('createState normalizes persisted startup hedge baseline aliases', () => {
  const normalized = createState('strategy-hash', {
    startupHedgeBaseline: {
      baselineUsdc: '-12.5',
      capturedAt: '2026-03-18T01:23:45.000Z',
      source: 'manual-seed',
    },
  });
  const fromLegacyAliases = createState('strategy-hash', {
    startupHedgeBaselineUsdc: '7.25',
    startupHedgeBaselineCapturedAt: '2026-03-18T02:34:56.000Z',
  });

  assert.equal(normalized.startupHedgeBaseline.baselineUsdc, -12.5);
  assert.equal(normalized.startupHedgeBaselineUsdc, -12.5);
  assert.equal(normalized.startupHedgeBaselineCapturedAt, '2026-03-18T01:23:45.000Z');
  assert.equal(normalized.startupHedgeBaselineSource, 'manual-seed');

  assert.equal(fromLegacyAliases.startupHedgeBaseline.baselineUsdc, 7.25);
  assert.equal(fromLegacyAliases.startupHedgeBaselineUsdc, 7.25);
  assert.equal(fromLegacyAliases.startupHedgeBaselineCapturedAt, '2026-03-18T02:34:56.000Z');
  assert.equal(fromLegacyAliases.startupHedgeBaselineSource, 'skip-initial-hedge');
});
