'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  OPERATION_SCHEMA_VERSION,
  OPERATION_RECEIPT_SCHEMA_VERSION,
  createOperationService,
} = require('../../cli/lib/operation_service.cjs');
const {
  createOperationStateStore,
  defaultOperationReceiptFile,
} = require('../../cli/lib/operation_state_store.cjs');
const {
  defaultOperationReceiptVersionDir,
} = require('../../cli/lib/operation_receipt_store.cjs');

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

test('operation service emits deterministic receipts only for terminal operations', async (t) => {
  const rootDir = createTempRoot(t);
  const service = createOperationService({
    operationStateStore: createOperationStateStore({ rootDir }),
  });

  const planned = await service.createPlanned({
    command: 'mirror.deploy',
    input: { marketId: 'poly-1' },
  });
  assert.equal(await service.maybeGetReceipt(planned.operationId), null);

  const executing = await service.markExecuting(planned.operationId);
  const completed = await service.markCompleted(executing.operationId, {
    result: { txHash: '0xabc123' },
  });
  const receipt = await service.getReceipt(completed.operationId);

  assert.equal(receipt.schemaVersion, OPERATION_RECEIPT_SCHEMA_VERSION);
  assert.equal(receipt.operationId, completed.operationId);
  assert.equal(receipt.operationHash, completed.operationHash);
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.result.txHash, '0xabc123');
  assert.equal(receipt.verification.algorithm, 'sha256');
  assert.equal(receipt.verification.signatureAlgorithm, 'ed25519');
  assert.equal(typeof receipt.verification.signature, 'string');
  assert.ok(receipt.verification.signature.length > 20);
  assert.equal(typeof receipt.verification.publicKeyFingerprint, 'string');
  assert.equal(receipt.verification.receiptHash, receipt.receiptHash);
  const verification = await service.verifyReceipt(completed.operationId);
  assert.equal(verification.ok, true);
  assert.equal(verification.receiptHash, receipt.receiptHash);
  assert.equal(verification.signatureValid, true);
});

test('operation service refreshes receipt content when terminal operation mutates', async (t) => {
  const rootDir = createTempRoot(t);
  const service = createOperationService({
    operationStateStore: createOperationStateStore({ rootDir }),
  });

  const completed = await service.createCompleted({
    command: 'claim',
    input: { marketAddress: '0xabc' },
    result: { usdcClaimed: '10.00' },
  });
  const firstReceipt = await service.getReceipt(completed.operationId);
  const updated = await service.updateRecovery(completed.operationId, {
    retryable: false,
    nextStep: 'record-ledger',
  });
  const updatedReceipt = await service.getReceipt(updated.operationId);
  const closed = await service.close(updated.operationId, {
    closure: { reason: 'receipt finalization' },
  });
  const finalReceipt = await service.getReceipt(closed.operationId);
  const latestReceiptPath = defaultOperationReceiptFile(closed.operationId, { rootDir });
  const versionDir = defaultOperationReceiptVersionDir(closed.operationId, { rootDir });
  const versionFiles = fs.readdirSync(versionDir).filter((entry) => entry.endsWith('.json')).sort();

  assert.equal(finalReceipt.status, 'closed');
  assert.equal(finalReceipt.recovery.nextStep, 'record-ledger');
  assert.equal(finalReceipt.closure.reason, 'receipt finalization');
  assert.notEqual(finalReceipt.receiptHash, firstReceipt.receiptHash);
  assert.equal(firstReceipt.receiptVersion, 1);
  assert.equal(updatedReceipt.receiptVersion > firstReceipt.receiptVersion, true);
  assert.equal(finalReceipt.receiptVersion > updatedReceipt.receiptVersion, true);
  assert.equal(updatedReceipt.supersedesReceiptHash, firstReceipt.receiptHash);
  assert.equal(finalReceipt.supersedesReceiptHash, updatedReceipt.receiptHash);
  assert.equal(finalReceipt.stateDigest !== firstReceipt.stateDigest, true);
  assert.equal(fs.existsSync(latestReceiptPath), true);
  assert.equal(versionFiles.length >= 3, true);

  const storedLatestReceipt = JSON.parse(fs.readFileSync(latestReceiptPath, 'utf8'));
  assert.equal(storedLatestReceipt.receiptHash, finalReceipt.receiptHash);

  const storedVersionReceipts = versionFiles.map((entry) =>
    JSON.parse(fs.readFileSync(path.join(versionDir, entry), 'utf8')),
  );
  assert.equal(
    storedVersionReceipts.some((receipt) => receipt.receiptHash === firstReceipt.receiptHash && receipt.receiptVersion === 1),
    true,
  );
  assert.equal(
    storedVersionReceipts.some((receipt) => receipt.receiptHash === updatedReceipt.receiptHash && receipt.receiptVersion === updatedReceipt.receiptVersion),
    true,
  );
  assert.equal(
    storedVersionReceipts.some((receipt) => receipt.receiptHash === finalReceipt.receiptHash && receipt.receiptVersion === finalReceipt.receiptVersion),
    true,
  );

  const tampered = JSON.parse(JSON.stringify(finalReceipt));
  tampered.result.usdcClaimed = '999.00';
  const verification = await service.verifyReceipt(tampered, {
    expectedOperationHash: closed.operationHash,
  });
  assert.equal(verification.ok, false);
  assert.match(verification.mismatches.join(' | '), /receiptHash mismatch|verification\.receiptHash mismatch/);
});

test('operation service transparently upgrades legacy unsigned receipts when they are fetched again', async (t) => {
  const rootDir = createTempRoot(t);
  const service = createOperationService({
    operationStateStore: createOperationStateStore({ rootDir }),
  });

  const completed = await service.createCompleted({
    command: 'trade',
    input: { marketAddress: '0xabc', side: 'yes', amountUsdc: 25 },
    result: { txHash: '0xdeadbeef' },
  });
  const receipt = await service.getReceipt(completed.operationId);
  const receiptPath = path.join(rootDir, `${completed.operationId}.receipt.json`);
  const legacy = JSON.parse(JSON.stringify(receipt));
  delete legacy.verification.signatureAlgorithm;
  delete legacy.verification.signature;
  delete legacy.verification.publicKeyPem;
  delete legacy.verification.publicKeyFingerprint;
  delete legacy.verification.keyId;
  fs.writeFileSync(receiptPath, JSON.stringify(legacy, null, 2), 'utf8');

  const refreshed = await service.getReceipt(completed.operationId);
  assert.equal(refreshed.verification.signatureAlgorithm, 'ed25519');
  assert.equal(typeof refreshed.verification.signature, 'string');
  const verification = await service.verifyReceipt(refreshed);
  assert.equal(verification.ok, true);
  assert.equal(verification.signatureValid, true);
});
