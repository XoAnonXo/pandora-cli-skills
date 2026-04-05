const test = require('node:test');
const assert = require('node:assert/strict');

const {
  appendEvent,
  buildEventTimeline,
  makeEventId,
  normalizeEvent,
  normalizeSimulationLock,
  stableJsonHash,
  validateSimulationLock,
} = require('../../benchmarks/lib/simulation_world.cjs');

test('normalizeSimulationLock produces a deterministic world lock and hash', () => {
  const lock = normalizeSimulationLock({
    suite: 'proving-ground',
    name: 'hedge-lab',
    simulation: {
      version: '7',
      seed: '42',
      scenarioFamily: 'mirror-hedge',
      strategyHash: 'abc123',
      policyHash: 'def456',
      venueModelHash: 'ghi789',
      feeModel: { kind: 'bps', makerBps: 2, takerBps: 6 },
      latencyModel: { kind: 'fixed', baseMs: 250, jitterMs: 0 },
    },
    tags: ['mirror', 'hedge'],
  });

  assert.equal(lock.schemaVersion, '1.0.0');
  assert.equal(lock.suite, 'proving-ground');
  assert.equal(lock.name, 'hedge-lab');
  assert.equal(lock.simulation.seed, '42');
  assert.equal(lock.simulation.strategyHash, 'abc123');
  assert.equal(lock.simulation.feeModel.makerBps, 2);
  assert.equal(lock.simulation.latencyModel.baseMs, 250);
  assert.match(lock.worldHash, /^[a-f0-9]{64}$/);

  const sameLock = normalizeSimulationLock({
    name: 'hedge-lab',
    suite: 'proving-ground',
    simulation: {
      scenarioFamily: 'mirror-hedge',
      version: '7',
      seed: '42',
      strategyHash: 'abc123',
      policyHash: 'def456',
      venueModelHash: 'ghi789',
      latencyModel: { jitterMs: 0, baseMs: 250, kind: 'fixed' },
      feeModel: { takerBps: 6, makerBps: 2, kind: 'bps' },
    },
    tags: ['mirror', 'hedge'],
  });

  assert.equal(sameLock.worldHash, lock.worldHash);
  assert.deepEqual(validateSimulationLock(lock), { ok: true, failures: [], lock });
});

test('makeEventId and normalizeEvent stay deterministic across equivalent input', () => {
  const first = normalizeEvent({
    type: 'outside-trade',
    sequence: 2,
    timestamp: '2026-03-09T10:00:00.000Z',
    actionId: 'trade-1',
    actor: 'market',
    label: 'external fill',
    payload: { amountUsdc: 12.5, side: 'yes' },
  });
  const second = normalizeEvent({
    label: 'external fill',
    actor: 'market',
    actionId: 'trade-1',
    timestamp: '2026-03-09T10:00:00.000Z',
    sequence: 2,
    type: 'outside-trade',
    payload: { side: 'yes', amountUsdc: 12.5 },
  });

  assert.equal(first.id, second.id);
  assert.equal(makeEventId(first), first.id);
  assert.equal(first.payload.amountUsdc, 12.5);
  assert.equal(first.payload.side, 'yes');
});

test('event ids change when payload changes even if metadata stays the same', () => {
  const yes = normalizeEvent({
    type: 'outside-trade',
    sequence: 1,
    timestamp: '2026-03-09T10:00:00.000Z',
    actionId: 'trade-1',
    actor: 'market',
    label: 'fill',
    payload: { amountUsdc: 5, side: 'yes' },
  });
  const no = normalizeEvent({
    type: 'outside-trade',
    sequence: 1,
    timestamp: '2026-03-09T10:00:00.000Z',
    actionId: 'trade-1',
    actor: 'market',
    label: 'fill',
    payload: { amountUsdc: 5, side: 'no' },
  });

  assert.notEqual(yes.id, no.id);
  assert.notEqual(yes.payloadHash, no.payloadHash);
});

test('buildEventTimeline orders events, links causal chain, and hashes the world', () => {
  const timeline = buildEventTimeline({
    worldLock: {
      suite: 'proving-ground',
      name: 'hedge-lab',
      simulation: {
        version: '1',
        seed: '99',
        scenarioFamily: 'stress',
      },
    },
    events: [
      {
        type: 'hedge-fill',
        sequence: 2,
        timestamp: '2026-03-09T10:00:02.000Z',
        actor: 'daemon',
        actionId: 'hedge-1',
        payload: { fill: 5 },
      },
      {
        type: 'outside-trade',
        sequence: 1,
        timestamp: '2026-03-09T10:00:01.000Z',
        actor: 'market',
        actionId: 'trade-1',
        payload: { amountUsdc: 5 },
      },
    ],
  });

  assert.equal(timeline.schemaVersion, '1.0.0');
  assert.equal(timeline.summary.eventCount, 2);
  assert.equal(timeline.summary.typeCount, 2);
  assert.equal(timeline.summary.actorCount, 2);
  assert.equal(timeline.events[0].type, 'outside-trade');
  assert.equal(timeline.events[1].type, 'hedge-fill');
  assert.equal(timeline.events[1].parentEventId, timeline.events[0].id);
  assert.equal(timeline.events[1].causalId, 'hedge-1');
  assert.match(timeline.timelineHash, /^[a-f0-9]{64}$/);
});

test('buildEventTimeline accepts equal-sequence events without throwing and keeps deterministic order', () => {
  const timeline = buildEventTimeline({
    worldLock: {
      suite: 'proving-ground',
      name: 'equal-sequence',
      simulation: {
        version: '1',
        seed: '101',
        scenarioFamily: 'ties',
      },
    },
    events: [
      {
        type: 'outside-trade',
        sequence: 1,
        timestamp: '2026-03-09T10:00:01.000Z',
        actor: 'market',
        actionId: 'trade-a',
        payload: { amountUsdc: 3, side: 'yes' },
      },
      {
        type: 'hedge-fill',
        sequence: 1,
        timestamp: '2026-03-09T10:00:01.000Z',
        actor: 'daemon',
        actionId: 'hedge-a',
        payload: { fill: 3, side: 'no' },
      },
    ],
  });

  assert.equal(timeline.summary.eventCount, 2);
  assert.equal(timeline.events[0].sequence, 1);
  assert.equal(timeline.events[1].sequence, 1);
  assert.equal(timeline.events[0].type, 'outside-trade');
  assert.equal(timeline.events[1].type, 'hedge-fill');
  assert.match(timeline.timelineHash, /^[a-f0-9]{64}$/);
});

test('appendEvent preserves determinism when new events are added incrementally', () => {
  const base = buildEventTimeline({
    worldLock: {
      suite: 'proving-ground',
      name: 'incremental',
      simulation: {
        version: '1',
        seed: '100',
        scenarioFamily: 'rolling',
      },
    },
    events: [],
  });

  const next = appendEvent(base, {
    type: 'outside-trade',
    actor: 'market',
    actionId: 'trade-1',
    timestamp: '2026-03-09T10:00:01.000Z',
    payload: { amountUsdc: 1 },
  });

  assert.equal(next.summary.eventCount, 1);
  assert.equal(next.events[0].sequence, 1);
  assert.equal(next.events[0].parentEventId, null);
  assert.equal(next.events[0].payload.amountUsdc, 1);
  assert.equal(next.worldLock.worldHash, base.worldLock.worldHash);
});

test('stableJsonHash is insensitive to key order', () => {
  const left = stableJsonHash({ b: 2, a: 1, nested: { y: 2, x: 1 } });
  const right = stableJsonHash({ nested: { x: 1, y: 2 }, a: 1, b: 2 });
  assert.equal(left, right);
});

test('stableJsonHash reflects object mutation instead of stale memoized content', () => {
  const subject = {
    event: 'outside-trade',
    payload: {
      amountUsdc: 5,
      side: 'yes',
    },
  };

  const before = stableJsonHash(subject);
  subject.payload.side = 'no';
  const after = stableJsonHash(subject);

  assert.notEqual(before, after);
});
