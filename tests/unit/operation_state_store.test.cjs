const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildOperationHash,
  buildOperationId,
  normalizeOperationHash,
  normalizeOperationId,
} = require('../../cli/lib/shared/operation_hash.cjs');
const {
  normalizeOperationState,
  validateOperationTransition,
  assertValidOperationTransition,
} = require('../../cli/lib/shared/operation_states.cjs');
const {
  createOperationStateStore,
  getOperation,
  getOperationByHash,
  listOperations,
  patchOperation,
  upsertOperation,
  setOperationStatus,
  appendCheckpoint,
  readCheckpoints,
} = require('../../cli/lib/operation_state_store.cjs');

function createTempRoot(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-operation-store-'));
  t.after(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
  return rootDir;
}

test('operation hash/id helpers are deterministic and normalized', () => {
  const left = buildOperationHash({
    command: 'mirror.sync.start',
    request: { market: '0xabc', mode: 'paper', nested: { b: 2, a: 1 } },
  });
  const right = buildOperationHash({
    request: { nested: { a: 1, b: 2 }, mode: 'paper', market: '0xabc' },
    command: 'mirror.sync.start',
  });

  assert.equal(left, right);
  assert.equal(left.length, 64);
  assert.equal(normalizeOperationHash(left.toUpperCase()), left);

  const operationId = buildOperationId({ command: 'Mirror Sync Start', operationHash: left });
  assert.equal(operationId.startsWith('mirror-sync-start-'), true);
  assert.equal(normalizeOperationId(operationId.toUpperCase()), operationId);

  const withEarlierDate = buildOperationHash({
    command: 'mirror.sync.start',
    request: { at: new Date('2026-03-08T00:00:00.000Z') },
  });
  const withLaterDate = buildOperationHash({
    command: 'mirror.sync.start',
    request: { at: new Date('2027-01-01T00:00:00.000Z') },
  });
  assert.notEqual(withEarlierDate, withLaterDate);
});

test('operation state helpers normalize aliases and reject invalid transitions', () => {
  assert.equal(normalizeOperationState('completed'), 'succeeded');
  assert.equal(normalizeOperationState('pending'), 'queued');

  const valid = validateOperationTransition('running', 'succeeded');
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.allowedNextStates, ['running', 'paused', 'succeeded', 'failed', 'cancelled']);

  assert.throws(() => assertValidOperationTransition('succeeded', 'running'), /Invalid operation state transition/);
});

test('operation store upsert/get/list persists normalized records', (t) => {
  const rootDir = createTempRoot(t);
  const request = { marketAddress: '0xabc', execute: false, riskProfile: 'balanced' };

  const created = upsertOperation(
    rootDir,
    {
      command: 'mirror.sync.start',
      request,
      summary: 'Start mirror sync runtime',
      tags: ['Mirror', 'Risk'],
    },
    { now: '2026-03-07T10:00:00.000Z' },
  );

  assert.equal(created.created, true);
  assert.equal(created.operation.status, 'planned');
  assert.equal(created.operation.command, 'mirror.sync.start');
  assert.deepEqual(created.operation.tags, ['mirror', 'risk']);
  assert.equal(created.operation.request.marketAddress, '0xabc');
  assert.equal(created.operation.operationHash.length, 64);
  assert.equal(created.operation.operationId.startsWith('mirror-sync-start-'), true);

  const fetchedById = getOperation(rootDir, created.operation.operationId);
  assert.equal(fetchedById.found, true);
  assert.equal(fetchedById.operation.operationId, created.operation.operationId);

  const fetchedByHash = getOperationByHash(rootDir, created.operation.operationHash);
  assert.equal(fetchedByHash.found, true);
  assert.equal(fetchedByHash.operation.operationId, created.operation.operationId);

  const listed = listOperations(rootDir);
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0].operationId, created.operation.operationId);
  assert.deepEqual(listed.diagnostics, []);
});

test('operation status updates preserve lifecycle timestamps and enforce terminal transitions', (t) => {
  const rootDir = createTempRoot(t);
  const created = upsertOperation(
    rootDir,
    {
      command: 'sports.sync.start',
      request: { eventId: 'evt-1', execute: true },
      status: 'planned',
    },
    { now: '2026-03-07T10:00:00.000Z' },
  );

  const queued = setOperationStatus(rootDir, created.operation.operationId, 'queued', {
    now: '2026-03-07T10:01:00.000Z',
  });
  assert.equal(queued.operation.status, 'queued');
  assert.equal(queued.operation.queuedAt, '2026-03-07T10:01:00.000Z');

  const running = setOperationStatus(rootDir, created.operation.operationId, 'running', {
    now: '2026-03-07T10:02:00.000Z',
  });
  assert.equal(running.operation.status, 'running');
  assert.equal(running.operation.startedAt, '2026-03-07T10:02:00.000Z');

  const succeeded = setOperationStatus(rootDir, created.operation.operationId, 'succeeded', {
    now: '2026-03-07T10:03:00.000Z',
  });
  assert.equal(succeeded.operation.status, 'succeeded');
  assert.equal(succeeded.operation.completedAt, '2026-03-07T10:03:00.000Z');
  assert.equal(succeeded.operation.succeededAt, '2026-03-07T10:03:00.000Z');

  assert.throws(
    () => setOperationStatus(rootDir, created.operation.operationId, 'running', {
      now: '2026-03-07T10:04:00.000Z',
    }),
    /Invalid operation state transition/,
  );
});

test('checkpoint append/read updates operation summary and supports filtering', (t) => {
  const rootDir = createTempRoot(t);
  const store = createOperationStateStore({ rootDir });
  const created = store.upsert(
    {
      command: 'mirror.sync.start',
      request: { marketAddress: '0xdef', execute: true },
      status: 'planned',
    },
    { now: '2026-03-07T11:00:00.000Z' },
  );

  const first = store.appendCheckpoint(
    created.operation.operationId,
    {
      kind: 'execute',
      label: 'dispatch',
      status: 'running',
      message: 'daemon started',
      progress: 25,
      details: { pid: 12345 },
    },
    { now: '2026-03-07T11:01:00.000Z' },
  );
  assert.equal(first.checkpoint.index, 1);
  assert.equal(first.checkpoint.status, 'running');
  assert.equal(first.checkpoint.progress, 0.25);
  assert.equal(first.operation.status, 'running');
  assert.equal(first.operation.checkpointCount, 1);

  const second = appendCheckpoint(
    rootDir,
    created.operation.operationId,
    {
      kind: 'execute',
      label: 'complete',
      status: 'succeeded',
      message: 'daemon detached',
      progress: 1,
      metadata: { pidFile: '/tmp/daemon.pid' },
    },
    { now: '2026-03-07T11:02:00.000Z' },
  );
  assert.equal(second.checkpoint.index, 2);
  assert.equal(second.operation.status, 'succeeded');
  assert.equal(second.operation.checkpointCount, 2);
  assert.equal(second.operation.latestCheckpoint.status, 'succeeded');
  assert.equal(second.operation.lastCheckpointAt, '2026-03-07T11:02:00.000Z');

  const allCheckpoints = readCheckpoints(rootDir, created.operation.operationId, { order: 'asc' });
  assert.equal(allCheckpoints.found, true);
  assert.equal(allCheckpoints.total, 2);
  assert.equal(allCheckpoints.items[0].index, 1);
  assert.equal(allCheckpoints.items[1].index, 2);

  const filtered = store.readCheckpoints(created.operation.operationId, { status: 'succeeded' });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0].status, 'succeeded');
});

test('appendCheckpoint validates lifecycle before mutating checkpoint log', (t) => {
  const rootDir = createTempRoot(t);
  const store = createOperationStateStore({ rootDir });
  const created = store.upsert(
    {
      command: 'mirror.sync.start',
      request: { marketAddress: '0xdef', execute: true },
      status: 'planned',
    },
    { now: '2026-03-07T11:00:00.000Z' },
  );

  assert.throws(
    () => store.appendCheckpoint(created.operation.operationId, {
      kind: 'execute',
      label: 'bad',
      status: 'banana',
      message: 'invalid status should not persist',
    }),
    /Invalid operation state transition|unknown/i,
  );

  const checkpoints = store.readCheckpoints(created.operation.operationId);
  assert.equal(checkpoints.total, 0);
  const lookup = store.get(created.operation.operationId);
  assert.equal(lookup.operation.checkpointCount, 0);
});

test('appendCheckpoint rolls back state updates if checkpoint log append fails', (t) => {
  const rootDir = createTempRoot(t);
  const store = createOperationStateStore({ rootDir });
  const created = store.upsert(
    {
      command: 'mirror.sync.start',
      request: { marketAddress: '0xdef', execute: true },
      status: 'planned',
    },
    { now: '2026-03-07T11:00:00.000Z' },
  );

  const originalRenameSync = fs.renameSync;
  fs.renameSync = (source, target) => {
    if (String(target).endsWith('.checkpoints.jsonl')) {
      throw new Error('checkpoint rename failed');
    }
    return originalRenameSync(source, target);
  };
  t.after(() => {
    fs.renameSync = originalRenameSync;
  });

  assert.throws(
    () => store.appendCheckpoint(created.operation.operationId, {
      kind: 'execute',
      label: 'dispatch',
      status: 'running',
      message: 'daemon started',
    }),
    /checkpoint rename failed/i,
  );

  const checkpoints = store.readCheckpoints(created.operation.operationId);
  assert.equal(checkpoints.total, 0);
  const lookup = store.get(created.operation.operationId);
  assert.equal(lookup.operation.status, 'planned');
  assert.equal(lookup.operation.checkpointCount, 0);
  assert.equal(lookup.operation.latestCheckpoint, null);
});

test('patchOperation merges against the latest durable state under lock', (t) => {
  const rootDir = createTempRoot(t);
  const created = upsertOperation(
    rootDir,
    {
      command: 'mirror.sync.start',
      request: { marketAddress: '0xdef', execute: true },
      status: 'planned',
    },
    { now: '2026-03-07T11:00:00.000Z' },
  );
  appendCheckpoint(
    rootDir,
    created.operation.operationId,
    {
      kind: 'execute',
      label: 'dispatch',
      status: 'running',
      message: 'daemon started',
    },
    { now: '2026-03-07T11:01:00.000Z' },
  );

  const patched = patchOperation(rootDir, created.operation.operationId, {
    summary: 'updated summary',
  });
  assert.equal(patched.operation.summary, 'updated summary');
  assert.equal(patched.operation.checkpointCount, 1);
  assert.equal(patched.operation.latestCheckpoint.label, 'dispatch');
});

test('listOperations tolerates corrupted files and still returns valid records', (t) => {
  const rootDir = createTempRoot(t);
  const created = upsertOperation(
    rootDir,
    {
      command: 'mirror.sync.stop',
      request: { stateFile: '/tmp/mirror.json' },
      status: 'queued',
    },
    { now: '2026-03-07T12:00:00.000Z' },
  );

  fs.writeFileSync(path.join(rootDir, 'broken.json'), '{not-json\n', 'utf8');

  const listed = listOperations(rootDir);
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0].operationId, created.operation.operationId);
  assert.equal(listed.diagnostics.length, 1);
  assert.equal(listed.diagnostics[0].code, 'OPERATION_STORE_INVALID_STATE_FILE');
});
