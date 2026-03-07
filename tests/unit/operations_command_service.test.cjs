'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

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
