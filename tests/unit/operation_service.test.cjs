'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  OPERATION_SCHEMA_VERSION,
  createOperationService,
} = require('../../cli/lib/operation_service.cjs');
const { createOperationStateStore } = require('../../cli/lib/operation_state_store.cjs');

function createTempRoot(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-operation-service-'));
  t.after(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
  return rootDir;
}

test('operation service creates durable planned operations with canonical fields', async (t) => {
  const rootDir = createTempRoot(t);
  const service = createOperationService({
    operationStateStore: createOperationStateStore({ rootDir }),
  });

  const operation = await service.createPlanned({
    command: 'mirror.sync.run',
    input: { marketAddress: '0xabc' },
    metadata: { source: 'test' },
    summary: 'Mirror sync plan',
  });

  assert.equal(operation.schemaVersion, OPERATION_SCHEMA_VERSION);
  assert.equal(operation.status, 'planned');
  assert.equal(operation.tool, 'mirror');
  assert.equal(operation.action, 'sync.run');
  assert.equal(operation.summary, 'Mirror sync plan');
  assert.equal(operation.input.marketAddress, '0xabc');
  assert.equal(typeof operation.operationId, 'string');
  assert.equal(operation.operationHash.length, 64);

  const fetched = await service.get(operation.operationId);
  assert.equal(fetched.operationId, operation.operationId);
  assert.deepEqual(fetched.input, operation.input);
});

test('operation service persists identity-affecting metadata in public payloads', async (t) => {
  const rootDir = createTempRoot(t);
  const service = createOperationService({
    operationStateStore: createOperationStateStore({ rootDir }),
  });

  const operation = await service.createPlanned({
    command: 'trade',
    input: { marketAddress: '0xabc', side: 'yes', amountUsdc: 25 },
    policyPack: 'desk-default',
    profile: 'prod-trader-a',
    environment: 'mainnet',
    mode: 'execute',
    parentOperationId: 'trade-seed-parent',
    tags: ['desk', 'execute'],
  });

  assert.equal(operation.policyPack, 'desk-default');
  assert.equal(operation.profile, 'prod-trader-a');
  assert.equal(operation.environment, 'mainnet');
  assert.equal(operation.mode, 'execute');
  assert.equal(operation.parentOperationId, 'trade-seed-parent');
  assert.deepEqual(operation.tags, ['desk', 'execute']);
});

test('operation service transitions through durable lifecycle and preserves checkpoints', async (t) => {
  const rootDir = createTempRoot(t);
  const service = createOperationService({
    operationStateStore: createOperationStateStore({ rootDir }),
  });

  const created = await service.createPlanned({
    command: 'sports.create.run',
    input: { eventId: 'evt-1' },
  });
  const validated = await service.markValidated(created.operationId);
  const executing = await service.markExecuting(validated.operationId, {
    checkpoint: {
      kind: 'execution',
      label: 'signed',
      message: 'signed and submitted',
    },
  });
  const completed = await service.markCompleted(executing.operationId, {
    result: { txHash: '0x1' },
  });
  const closed = await service.close(completed.operationId, {
    closure: { reason: 'archived' },
  });

  assert.equal(validated.status, 'validated');
  assert.equal(executing.status, 'executing');
  assert.equal(completed.status, 'completed');
  assert.equal(closed.status, 'closed');
  assert.equal(closed.result.txHash, '0x1');
  assert.equal(closed.closure.reason, 'archived');
  assert.equal(closed.checkpointCount, 1);
  assert.equal(closed.checkpoints.length, 1);
  assert.equal(closed.checkpoints[0].label, 'signed');
});

test('operation service preserves queued and paused lifecycle states in public payloads', async (t) => {
  const rootDir = createTempRoot(t);
  const service = createOperationService({
    operationStateStore: createOperationStateStore({ rootDir }),
  });

  const created = await service.createPlanned({
    command: 'mirror.sync.run',
    input: { marketAddress: '0xabc' },
  });
  const queued = await service.transition(created.operationId, 'queued');
  const executing = await service.transition(queued.operationId, 'executing');
  const paused = await service.transition(executing.operationId, 'paused', {
    checkpoints: [{
      kind: 'lifecycle',
      label: 'paused by operator',
      status: 'paused',
    }],
  });

  assert.equal(queued.status, 'queued');
  assert.equal(executing.status, 'executing');
  assert.equal(paused.status, 'paused');
  assert.equal(paused.latestCheckpoint.status, 'paused');
  assert.deepEqual(
    service.VALID_OPERATION_TRANSITIONS.executing,
    ['executing', 'paused', 'completed', 'failed', 'canceled'],
  );
});

test('operation service supports recovery and list envelopes from durable store', async (t) => {
  const rootDir = createTempRoot(t);
  const service = createOperationService({
    operationStateStore: createOperationStateStore({ rootDir }),
  });

  const operation = await service.createExecuting({
    command: 'mirror.close',
    input: { all: true },
  });
  await service.markFailed(operation.operationId, {
    error: { code: 'ERR_REVERT', message: 'execution reverted' },
  });
  const recovered = await service.updateRecovery(operation.operationId, {
    nextStep: 'manual-review',
    retryable: false,
  });
  const listing = await service.listOperations({ statuses: ['failed'], tool: 'mirror.close' });

  assert.equal(recovered.status, 'failed');
  assert.deepEqual(recovered.recovery, {
    nextStep: 'manual-review',
    retryable: false,
  });
  assert.equal(listing.count, 1);
  assert.equal(listing.total, 1);
  assert.equal(listing.items[0].operationId, operation.operationId);
  assert.equal(listing.items[0].status, 'failed');
});

test('operation service cancel/close reject unknown references cleanly', async (t) => {
  const rootDir = createTempRoot(t);
  const service = createOperationService({
    operationStateStore: createOperationStateStore({ rootDir }),
  });

  await assert.rejects(
    () => service.cancelOperation('missing-op', 'stop'),
    (error) => error && error.code === 'OPERATION_NOT_FOUND',
  );
  await assert.rejects(
    () => service.closeOperation('missing-op', 'archive'),
    (error) => error && error.code === 'OPERATION_NOT_FOUND',
  );
});
