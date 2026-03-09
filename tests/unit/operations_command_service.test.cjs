'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createRunOperationsCommand } = require('../../cli/lib/operations_command_service.cjs');
const { parseOperationsFlags } = require('../../cli/lib/parsers/operations_flags.cjs');

class TestCliError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function createRunner(service) {
  const emitted = [];
  const runner = createRunOperationsCommand({
    CliError: TestCliError,
    includesHelpFlag: (args) => Array.isArray(args) && args.some((arg) => arg === '--help' || arg === '-h'),
    emitSuccess: (outputMode, command, data) => emitted.push({ outputMode, command, data }),
    commandHelpPayload: (usage) => ({ usage }),
    parseOperationsFlags,
    createOperationService: () => service,
  });
  return { emitted, runner };
}

test('parseOperationsFlags enforces action-specific flags', () => {
  assert.deepEqual(
    parseOperationsFlags(['list', '--status', 'planned,executing', '--tool', 'mirror.close', '--limit', '5'], {
      CliError: TestCliError,
    }),
    {
      action: 'list',
      id: null,
      statuses: ['planned', 'executing'],
      tool: 'mirror.close',
      limit: 5,
      reason: null,
      file: null,
      expectedOperationHash: null,
    },
  );

  assert.deepEqual(
    parseOperationsFlags(['receipt', '--id', 'op-1'], {
      CliError: TestCliError,
    }),
    {
      action: 'receipt',
      id: 'op-1',
      statuses: [],
      tool: null,
      limit: null,
      reason: null,
      file: null,
      expectedOperationHash: null,
    },
  );

  assert.deepEqual(
    parseOperationsFlags(['verify-receipt', '--file', '/tmp/op.receipt.json', '--expected-operation-hash', 'abcd'], {
      CliError: TestCliError,
    }),
    {
      action: 'verify-receipt',
      id: null,
      statuses: [],
      tool: null,
      limit: null,
      reason: null,
      file: '/tmp/op.receipt.json',
      expectedOperationHash: 'abcd',
    },
  );

  assert.throws(
    () => parseOperationsFlags(['get', '--id', 'op-1', '--status', 'planned'], { CliError: TestCliError }),
    (error) => error && error.code === 'UNKNOWN_FLAG',
  );
  assert.throws(
    () => parseOperationsFlags(['cancel'], { CliError: TestCliError }),
    (error) => error && error.code === 'MISSING_REQUIRED_FLAG',
  );
  assert.throws(
    () => parseOperationsFlags(['list', '--limit', '1.9'], { CliError: TestCliError }),
    (error) => error && error.code === 'INVALID_FLAG_VALUE',
  );
  assert.throws(
    () => parseOperationsFlags(['verify-receipt', '--id', 'op-1', '--file', '/tmp/op.receipt.json'], { CliError: TestCliError }),
    (error) => error && error.code === 'INVALID_ARGS',
  );
});

test('operations command emits service envelopes for list/get/cancel/close', async () => {
  const record = {
    operationId: 'op_1',
    status: 'planned',
    tool: 'mirror',
    action: 'deploy',
  };
  const service = {
    getOperation: async (id) => (id === 'op_1' ? record : null),
    listOperations: async () => ({ items: [record], count: 1, total: 1, schemaVersion: '1.0.0' }),
    cancelOperation: async () => ({ ...record, status: 'canceled' }),
    closeOperation: async () => ({ ...record, status: 'closed' }),
  };
  const { emitted, runner } = createRunner(service);

  await runner(['list'], { outputMode: 'json' });
  await runner(['get', '--id', 'op_1'], { outputMode: 'json' });
  await runner(['cancel', '--id', 'op_1', '--reason', 'stop'], { outputMode: 'json' });
  await runner(['close', '--id', 'op_1'], { outputMode: 'json' });

  assert.deepEqual(emitted.map((entry) => entry.command), [
    'operations.list',
    'operations.get',
    'operations.cancel',
    'operations.close',
  ]);
  assert.equal(emitted[0].data.total, 1);
  assert.equal(emitted[1].data.operationId, 'op_1');
  assert.equal(emitted[2].data.status, 'canceled');
  assert.equal(emitted[3].data.status, 'closed');
});

test('operations command converts null cancel/close/get results into OPERATION_NOT_FOUND', async () => {
  const service = {
    getOperation: async () => null,
    listOperations: async () => ({ items: [], count: 0, total: 0 }),
    cancelOperation: async () => null,
    closeOperation: async () => null,
  };
  const { runner } = createRunner(service);

  await assert.rejects(() => runner(['get', '--id', 'missing'], { outputMode: 'json' }), (error) => error.code === 'OPERATION_NOT_FOUND');
  await assert.rejects(() => runner(['cancel', '--id', 'missing'], { outputMode: 'json' }), (error) => error.code === 'OPERATION_NOT_FOUND');
  await assert.rejects(() => runner(['close', '--id', 'missing'], { outputMode: 'json' }), (error) => error.code === 'OPERATION_NOT_FOUND');
});

test('operations command emits receipt and verification payloads for id and file flows', async () => {
  const receipt = {
    schemaVersion: '1.0.0',
    operationId: 'op_1',
    operationHash: 'a'.repeat(64),
    status: 'completed',
    tool: 'mirror',
    action: 'deploy',
    result: { txHash: '0xabc123' },
    receiptHash: 'b'.repeat(64),
    verification: {
      algorithm: 'sha256',
      receiptHash: 'b'.repeat(64),
      checkpointDigest: 'c'.repeat(64),
      signatureAlgorithm: 'ed25519',
      signature: 'd'.repeat(88),
      publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMIIBfake\n-----END PUBLIC KEY-----\n',
      publicKeyFingerprint: 'e'.repeat(64),
      keyId: 'receipt-signing:eeeeeeeeeeeeeeee',
    },
  };
  const service = {
    getOperation: async () => null,
    listOperations: async () => ({ items: [], count: 0, total: 0 }),
    cancelOperation: async () => null,
    closeOperation: async () => null,
    getReceipt: async (id) => {
      assert.equal(id, 'op_1');
      return receipt;
    },
    verifyReceipt: async (payload, options = {}) => ({
      ok: true,
      code: 'OK',
      receiptHash: payload.receiptHash,
      signatureValid: true,
      signatureAlgorithm: payload.verification.signatureAlgorithm,
      publicKeyFingerprint: payload.verification.publicKeyFingerprint,
      keyId: payload.verification.keyId,
      mismatches: [],
      expectedOperationHash: options.expectedOperationHash || null,
    }),
  };
  const { emitted, runner } = createRunner(service);

  await runner(['receipt', '--id', 'op_1'], { outputMode: 'json' });
  assert.equal(emitted[0].command, 'operations.receipt');
  assert.equal(emitted[0].data.operationId, 'op_1');
  assert.equal(emitted[0].data.result.txHash, '0xabc123');

  await runner(['verify-receipt', '--id', 'op_1', '--expected-operation-hash', 'c'.repeat(64)], { outputMode: 'json' });
  assert.equal(emitted[1].command, 'operations.verify-receipt');
  assert.equal(emitted[1].data.ok, true);
  assert.equal(emitted[1].data.source.type, 'operation-id');
  assert.equal(emitted[1].data.source.value, 'op_1');
  assert.equal(emitted[1].data.expectedOperationHash, 'c'.repeat(64));
  assert.equal(emitted[1].data.signatureValid, true);
  assert.equal(emitted[1].data.signatureAlgorithm, 'ed25519');
  assert.equal(emitted[1].data.publicKeyFingerprint, 'e'.repeat(64));

  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-ops-receipt-')), 'operation.receipt.json');
  try {
    fs.writeFileSync(filePath, JSON.stringify(receipt), 'utf8');
    await runner(['verify-receipt', '--file', filePath], { outputMode: 'json' });
    assert.equal(emitted[2].command, 'operations.verify-receipt');
    assert.equal(emitted[2].data.ok, true);
    assert.equal(emitted[2].data.source.type, 'file');
    assert.equal(emitted[2].data.source.value, filePath);
  } finally {
    try {
      fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
    } catch {}
  }
});

test('operations command rejects unreadable or malformed receipt files cleanly', async () => {
  const { runner } = createRunner({
    getOperation: async () => null,
    listOperations: async () => ({ items: [], count: 0, total: 0 }),
    cancelOperation: async () => null,
    closeOperation: async () => null,
    getReceipt: async () => null,
    verifyReceipt: async () => ({ ok: false, code: 'OPERATION_RECEIPT_INVALID', mismatches: ['invalid'] }),
  });

  await assert.rejects(
    () => runner(['verify-receipt', '--file', '/tmp/does-not-exist.receipt.json'], { outputMode: 'json' }),
    (error) => error && error.code === 'FILE_NOT_FOUND',
  );

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-bad-receipt-'));
  const malformedFile = path.join(tempDir, 'malformed.receipt.json');
  const arrayFile = path.join(tempDir, 'array.receipt.json');
  try {
    fs.writeFileSync(malformedFile, '{not-json', 'utf8');
    await assert.rejects(
      () => runner(['verify-receipt', '--file', malformedFile], { outputMode: 'json' }),
      (error) => error && error.code === 'INVALID_ARGS' && /Unable to read receipt file/.test(error.message),
    );

    fs.writeFileSync(arrayFile, JSON.stringify(['not-an-object']), 'utf8');
    await assert.rejects(
      () => runner(['verify-receipt', '--file', arrayFile], { outputMode: 'json' }),
      (error) => error && error.code === 'INVALID_ARGS' && /Receipt file must contain a JSON object/.test(error.message),
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('operations help paths do not require creating the operation service', async () => {
  let createCalls = 0;
  const emitted = [];
  const runner = createRunOperationsCommand({
    CliError: TestCliError,
    includesHelpFlag: (args) => Array.isArray(args) && args.some((arg) => arg === '--help' || arg === '-h'),
    emitSuccess: (outputMode, command, data) => emitted.push({ outputMode, command, data }),
    commandHelpPayload: (usage) => ({ usage }),
    parseOperationsFlags,
    createOperationService: () => {
      createCalls += 1;
      throw new Error('operation service should not be created for help');
    },
  });

  await runner(['cancel', '--help'], { outputMode: 'json' });

  assert.equal(createCalls, 0);
  assert.equal(emitted[0].command, 'operations.cancel.help');
});

test('operations list rejects invalid backend payloads', async () => {
  const { runner } = createRunner({
    getOperation: async () => null,
    listOperations: async () => null,
    cancelOperation: async () => null,
    closeOperation: async () => null,
  });

  await assert.rejects(
    () => runner(['list'], { outputMode: 'json' }),
    (error) => error && error.code === 'OPERATION_LIST_FAILED',
  );
});
