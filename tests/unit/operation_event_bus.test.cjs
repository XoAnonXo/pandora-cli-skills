'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OPERATION_EVENT_SCHEMA_VERSION,
  buildOperationLifecycleEvent,
  createOperationEventBus,
} = require('../../cli/lib/operation_event_bus.cjs');
const {
  OPERATION_WEBHOOK_SCHEMA_VERSION,
  createOperationWebhookService,
} = require('../../cli/lib/operation_webhook_service.cjs');

function createFixedClock(iso = '2026-03-07T12:00:00.000Z') {
  return () => new Date(iso);
}

test('buildOperationLifecycleEvent produces deterministic normalized envelopes', () => {
  const now = createFixedClock();
  const input = {
    operationId: 'mirror-sync-abc',
    operationKind: 'mirror.sync',
    phase: 'IN_PROGRESS',
    sequence: 2,
    runtimeHandle: 'pid:123',
    summary: 'Tick planned',
    message: 'Waiting for hedge leg.',
    source: 'daemon',
    tags: { chain: '1', empty: '   ' },
    data: { driftBps: 42, action: { side: 'yes' } },
  };

  const first = buildOperationLifecycleEvent(input, { now });
  const second = buildOperationLifecycleEvent(input, { now });

  assert.equal(first.schemaVersion, OPERATION_EVENT_SCHEMA_VERSION);
  assert.equal(first.phase, 'in-progress');
  assert.equal(first.emittedAt, '2026-03-07T12:00:00.000Z');
  assert.deepEqual(first.tags, { chain: '1' });
  assert.equal(first.eventId, second.eventId);
  assert.deepEqual(first, second);
});

test('operation event bus records lifecycle events even when listeners fail', async () => {
  const bus = createOperationEventBus({ now: createFixedClock('2026-03-07T12:01:00.000Z') });
  const observed = [];

  bus.subscribe((event) => {
    observed.push({ operationId: event.operationId, sequence: event.sequence });
    return { seen: event.eventId };
  });
  bus.subscribe(() => {
    throw Object.assign(new Error('listener exploded'), { code: 'LISTENER_FAIL' });
  });

  const first = await bus.emitLifecycleEvent({
    operationId: 'mirror-sync-1',
    operationKind: 'mirror.sync',
    phase: 'planned',
  });
  const second = await bus.emitLifecycleEvent({
    operationId: 'mirror-sync-1',
    operationKind: 'mirror.sync',
    phase: 'started',
  });
  const third = await bus.emitLifecycleEvent({
    operationId: 'sports-sync-1',
    operationKind: 'sports.sync',
    phase: 'planned',
  });

  assert.equal(first.event.sequence, 1);
  assert.equal(second.event.sequence, 2);
  assert.equal(third.event.sequence, 1);
  assert.equal(first.ok, true);
  assert.equal(first.failureCount, 1);
  assert.equal(first.listenerReports[0].ok, true);
  assert.equal(first.listenerReports[1].ok, false);
  assert.equal(first.listenerReports[1].error.code, 'LISTENER_FAIL');
  assert.deepEqual(observed, [
    { operationId: 'mirror-sync-1', sequence: 1 },
    { operationId: 'mirror-sync-1', sequence: 2 },
    { operationId: 'sports-sync-1', sequence: 1 },
  ]);
  assert.equal(bus.getLastSequence('mirror-sync-1'), 2);
  assert.equal(bus.getHistory({ operationId: 'mirror-sync-1' }).length, 2);
});

test('operation event bus bounds history and rejects stale explicit sequence', async () => {
  const bus = createOperationEventBus({ now: createFixedClock('2026-03-07T12:02:00.000Z'), maxHistory: 2 });

  await bus.emitLifecycleEvent({ operationId: 'op-1', phase: 'planned' });
  await bus.emitLifecycleEvent({ operationId: 'op-1', phase: 'started' });
  await bus.emitLifecycleEvent({ operationId: 'op-1', phase: 'completed' });

  assert.equal(bus.getHistory({ operationId: 'op-1' }).length, 2);
  await assert.rejects(
    () => bus.emitLifecycleEvent({ operationId: 'op-1', phase: 'completed', sequence: 2 }),
    /greater than the last emitted sequence/i,
  );
});

test('operation event bus keeps sequence monotonic even after older history is evicted', async () => {
  const bus = createOperationEventBus({ now: createFixedClock('2026-03-07T12:02:15.000Z'), maxHistory: 2 });

  await bus.emitLifecycleEvent({ operationId: 'op-a', phase: 'planned' });
  await bus.emitLifecycleEvent({ operationId: 'op-b', phase: 'planned' });
  await bus.emitLifecycleEvent({ operationId: 'op-c', phase: 'planned' });

  const next = await bus.emitLifecycleEvent({ operationId: 'op-a', phase: 'running' });
  assert.equal(next.event.sequence, 2);
});

test('operation event bus prunes stale sequence state while keeping active operations monotonic', async () => {
  const bus = createOperationEventBus({
    now: createFixedClock('2026-03-07T12:02:20.000Z'),
    maxHistory: 2,
    maxTrackedOperations: 2,
  });

  await bus.emitLifecycleEvent({ operationId: 'op-a', phase: 'planned' });
  await bus.emitLifecycleEvent({ operationId: 'op-b', phase: 'planned' });
  await bus.emitLifecycleEvent({ operationId: 'op-c', phase: 'planned' });

  assert.equal(bus.getLastSequence('op-a'), 0);
  assert.equal(bus.getLastSequence('op-b'), 1);
  assert.equal(bus.getLastSequence('op-c'), 1);

  const next = await bus.emitLifecycleEvent({ operationId: 'op-b', phase: 'running' });
  assert.equal(next.event.sequence, 2);
});

test('operation event bus does not advance sequence when validation fails', async () => {
  const bus = createOperationEventBus({ now: createFixedClock('2026-03-07T12:02:30.000Z') });

  await assert.rejects(
    () => bus.emitLifecycleEvent({ operationId: 'op-invalid', phase: '' }),
    /phase must be a non-empty string/i,
  );
  assert.equal(bus.getLastSequence('op-invalid'), 0);

  const next = await bus.emitLifecycleEvent({ operationId: 'op-invalid', phase: 'planned' });
  assert.equal(next.event.sequence, 1);
});

test('operation event bus times out slow listeners without blocking emission success', async () => {
  const bus = createOperationEventBus({
    now: createFixedClock('2026-03-07T12:03:00.000Z'),
    listenerTimeoutMs: 10,
  });

  bus.subscribe(() => new Promise(() => {}));
  const report = await bus.emitLifecycleEvent({ operationId: 'op-2', phase: 'planned' });

  assert.equal(report.ok, true);
  assert.equal(report.failureCount, 1);
  assert.equal(report.listenerReports[0].error.code, 'OPERATION_EVENT_LISTENER_TIMEOUT');
});

test('operation event bus aborts listeners that honor timeout signals', async () => {
  const bus = createOperationEventBus({
    now: createFixedClock('2026-03-07T12:03:30.000Z'),
    listenerTimeoutMs: 10,
  });
  let aborted = false;

  bus.subscribe((_event, context) => new Promise((resolve) => {
    context.signal.addEventListener('abort', () => {
      aborted = true;
      resolve('aborted');
    }, { once: true });
  }));

  const report = await bus.emitLifecycleEvent({ operationId: 'op-abort', phase: 'planned' });

  assert.equal(report.ok, true);
  assert.equal(report.failureCount, 1);
  assert.equal(aborted, true);
});

test('operation webhook service skips delivery cleanly when no targets are configured', async () => {
  let called = 0;
  const service = createOperationWebhookService({
    now: createFixedClock('2026-03-07T12:04:00.000Z'),
    sendWebhookNotifications: async () => {
      called += 1;
      return null;
    },
  });

  const event = buildOperationLifecycleEvent(
    {
      operationId: 'mirror-sync-2',
      operationKind: 'mirror.sync',
      phase: 'completed',
      sequence: 1,
    },
    { now: createFixedClock('2026-03-07T12:04:00.000Z') },
  );

  const report = await service.notifyLifecycleEvent({}, event);

  assert.equal(report.schemaVersion, OPERATION_WEBHOOK_SCHEMA_VERSION);
  assert.equal(report.attempted, false);
  assert.equal(report.delivered, false);
  assert.equal(report.skippedReason, 'no-targets');
  assert.equal(report.report.count, 0);
  assert.equal(called, 0);
});

test('operation webhook service sanitizes event payloads before delivery context', async () => {
  const seen = [];
  const service = createOperationWebhookService({
    now: createFixedClock('2026-03-07T12:05:00.000Z'),
    sendWebhookNotifications: async (options, context) => {
      seen.push({ options, context });
      return {
        schemaVersion: OPERATION_WEBHOOK_SCHEMA_VERSION,
        generatedAt: '2026-03-07T12:05:01.000Z',
        count: 1,
        successCount: 1,
        failureCount: 0,
        results: [{ target: 'generic', ok: true, attempt: 1 }],
      };
    },
  });

  const event = buildOperationLifecycleEvent(
    {
      operationId: 'claim-1',
      operationKind: 'claim',
      phase: 'failed',
      sequence: 1,
      summary: 'Claim failed',
      data: { secret: 'should-not-leak', reason: 'network' },
    },
    { now: createFixedClock('2026-03-07T12:05:00.000Z') },
  );

  const report = await service.notifyLifecycleEvent({ webhookUrl: 'https://example.com/hook' }, event);

  assert.equal(report.attempted, true);
  assert.equal(report.delivered, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].context.operationEvent.operationId, 'claim-1');
  assert.equal(Object.prototype.hasOwnProperty.call(seen[0].context.operationEvent, 'data'), false);
});

test('operation webhook service catches delivery exceptions and returns failure reports', async () => {
  const service = createOperationWebhookService({
    now: createFixedClock('2026-03-07T12:06:00.000Z'),
    sendWebhookNotifications: async () => {
      throw Object.assign(new Error('network unreachable'), { code: 'ECONNRESET' });
    },
  });

  const event = buildOperationLifecycleEvent(
    {
      operationId: 'claim-2',
      operationKind: 'claim',
      phase: 'failed',
      sequence: 1,
    },
    { now: createFixedClock('2026-03-07T12:06:00.000Z') },
  );

  const report = await service.notifyLifecycleEvent({ webhookUrl: 'https://example.com/hook' }, event);

  assert.equal(report.attempted, true);
  assert.equal(report.delivered, false);
  assert.equal(report.error.code, 'ECONNRESET');
  assert.match(report.error.message, /network unreachable/i);
  assert.equal(report.report.failureCount, 1);
});
