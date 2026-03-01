const test = require('node:test');
const assert = require('node:assert/strict');

const {
  deriveCadenceByEventState,
  evaluateAutoPauseTriggers,
  detectConcurrentSyncConflict,
  buildSyncStatusPayload,
} = require('../../cli/lib/sports_sync_service.cjs');

test('sports sync cadence logic selects prematch/live/near-settle defaults', () => {
  const prematch = deriveCadenceByEventState(
    { startTime: '2026-03-02T15:00:00.000Z', status: 'scheduled' },
    { now: '2026-03-02T14:00:00.000Z' },
  );
  assert.equal(prematch.state, 'prematch');
  assert.equal(prematch.cadenceMs, 30_000);

  const live = deriveCadenceByEventState(
    { startTime: '2026-03-02T13:00:00.000Z', status: 'live', isLive: true },
    { now: '2026-03-02T14:00:00.000Z' },
  );
  assert.equal(live.state, 'live');
  assert.equal(live.cadenceMs, 5_000);

  const nearSettle = deriveCadenceByEventState(
    { status: 'final pending', nearSettle: true },
    { now: '2026-03-02T14:00:00.000Z' },
  );
  assert.equal(nearSettle.state, 'near-settle');
  assert.equal(nearSettle.cadenceMs, 2_000);
});

test('sports sync auto-pause triggers fire on stale data/coverage collapse/spread jump', () => {
  const result = evaluateAutoPauseTriggers({
    dataAgeMs: 240_000,
    coverageRatio: 0.45,
    previousCoverageRatio: 0.9,
    spreadBps: 420,
    previousSpreadBps: 120,
    consecutiveFailures: 4,
    consecutiveGateFailures: 3,
    gatePassed: false,
  });

  assert.equal(result.autoPause, true);
  assert.equal(result.triggerCount >= 4, true);

  const codes = new Set(result.triggers.map((t) => t.code));
  assert.equal(codes.has('STALE_DATA'), true);
  assert.equal(codes.has('COVERAGE_COLLAPSE'), true);
  assert.equal(codes.has('SPREAD_JUMP'), true);
  assert.equal(codes.has('REPEATED_FAILURES'), true);
  assert.equal(codes.has('GATE_FAILURES'), true);
});

test('sports sync concurrent guard blocks second start while state is running', () => {
  const first = detectConcurrentSyncConflict(null, 'hash-a');
  assert.equal(first.conflict, false);

  const sameStrategy = detectConcurrentSyncConflict(
    { running: true, strategyHash: 'hash-a' },
    'hash-a',
  );
  assert.equal(sameStrategy.conflict, true);
  assert.equal(sameStrategy.reason, 'same-strategy-running');

  const differentStrategy = detectConcurrentSyncConflict(
    { running: true, strategyHash: 'hash-a' },
    'hash-b',
  );
  assert.equal(differentStrategy.conflict, true);
  assert.equal(differentStrategy.reason, 'different-strategy-running');
});

test('sports sync status payload exposes deterministic lifecycle fields', () => {
  const payload = buildSyncStatusPayload('status', {
    found: true,
    alive: false,
    strategyHash: 'abc123',
    pidFile: '/tmp/sports-sync.json',
    now: '2026-03-02T14:00:00.000Z',
    diagnostics: ['status-check'],
  });

  assert.equal(payload.action, 'status');
  assert.equal(payload.status, 'stopped');
  assert.equal(payload.strategyHash, 'abc123');
  assert.equal(payload.pidFile, '/tmp/sports-sync.json');
  assert.equal(Array.isArray(payload.diagnostics), true);
  assert.equal(payload.diagnostics.some((d) => d.message === 'status-check'), true);
});
