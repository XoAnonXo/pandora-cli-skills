const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildResolveOperationContext,
  createRunResolveCommand,
} = require('../../cli/lib/resolve_command_service.cjs');

class TestCliError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'TestCliError';
    this.code = code;
    this.details = details;
  }
}

test('buildResolveOperationContext creates stable operation metadata', () => {
  const context = buildResolveOperationContext(
    {
      execute: false,
      pollAddress: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      answer: 'YES',
      chainId: 1,
    },
    {
      mode: 'dry-run',
      status: 'planned',
      runtime: { chainId: 1 },
    },
  );

  assert.ok(context);
  assert.equal(context.operationId, 'resolve:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:yes');
  assert.deepEqual(context.runtimeHandle, {
    type: 'resolve',
    chainId: 1,
    pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    answer: 'yes',
  });
  assert.deepEqual(context.target, {
    pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    answer: 'yes',
  });
});

test('runResolveCommand applies optional operation decorator with resolve context', async () => {
  const observed = {
    operationContext: null,
    emitted: null,
  };
  const runResolveCommand = createRunResolveCommand({
    includesHelpFlag: () => false,
    emitSuccess: (mode, command, payload) => {
      observed.emitted = { mode, command, payload };
    },
    commandHelpPayload: (usage) => ({ usage }),
    parseIndexerSharedFlags: (args) => ({ rest: args }),
    maybeLoadTradeEnv: () => {},
    parseResolveFlags: () => ({
      execute: false,
      fork: false,
      forkRpcUrl: null,
      pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      answer: 'yes',
      reason: 'settled',
      chainId: 1,
    }),
    runResolve: async () => ({
      schemaVersion: '1.0.0',
      generatedAt: '2026-03-07T00:00:00.000Z',
      mode: 'dry-run',
      status: 'planned',
      pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      answer: 'yes',
      runtime: {
        mode: 'live',
        chainId: 1,
        rpcUrl: 'https://rpc.example',
      },
    }),
    renderSingleEntityTable: () => null,
    CliError: TestCliError,
    decorateOperationPayload: (payload, operationContext) => {
      observed.operationContext = operationContext;
      return {
        ...payload,
        operationId: operationContext.operationId,
      };
    },
  });

  await runResolveCommand(['--poll-address', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], { outputMode: 'json' });

  assert.ok(observed.operationContext);
  assert.equal(observed.operationContext.command, 'resolve');
  assert.equal(observed.operationContext.operationId, 'resolve:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:yes');
  assert.ok(observed.emitted);
  assert.equal(observed.emitted.command, 'resolve');
  assert.equal(observed.emitted.payload.operationId, 'resolve:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:yes');
});

test('runResolveCommand leaves payload unchanged when no decorator is provided', async () => {
  let emitted = null;
  const runResolveCommand = createRunResolveCommand({
    includesHelpFlag: () => false,
    emitSuccess: (_mode, command, payload) => {
      emitted = { command, payload };
    },
    commandHelpPayload: (usage) => ({ usage }),
    parseIndexerSharedFlags: (args) => ({ rest: args }),
    maybeLoadTradeEnv: () => {},
    parseResolveFlags: () => ({
      execute: false,
      fork: false,
      forkRpcUrl: null,
      pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      answer: 'yes',
      reason: 'settled',
      chainId: 1,
    }),
    runResolve: async () => ({
      schemaVersion: '1.0.0',
      mode: 'dry-run',
      status: 'planned',
      pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      answer: 'yes',
      runtime: { chainId: 1 },
    }),
    renderSingleEntityTable: () => null,
    CliError: TestCliError,
  });

  await runResolveCommand(['--poll-address', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], { outputMode: 'json' });

  assert.ok(emitted);
  assert.equal(emitted.payload.operationId, undefined);
});

test('runResolveCommand preserves payload shape when decoration fails without diagnostics array', async () => {
  let emitted = null;
  const runResolveCommand = createRunResolveCommand({
    includesHelpFlag: () => false,
    emitSuccess: (_mode, command, payload) => {
      emitted = { command, payload };
    },
    commandHelpPayload: (usage) => ({ usage }),
    parseIndexerSharedFlags: (args) => ({ rest: args }),
    maybeLoadTradeEnv: () => {},
    parseResolveFlags: () => ({
      execute: false,
      fork: false,
      forkRpcUrl: null,
      pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      answer: 'yes',
      reason: 'settled',
      chainId: 1,
    }),
    runResolve: async () => ({
      schemaVersion: '1.0.0',
      mode: 'dry-run',
      status: 'planned',
      pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      answer: 'yes',
      runtime: { chainId: 1 },
    }),
    renderSingleEntityTable: () => null,
    CliError: TestCliError,
    decorateOperationPayload: async () => {
      throw new Error('decorator offline');
    },
  });

  await runResolveCommand(['--poll-address', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], { outputMode: 'json' });

  assert.ok(emitted);
  assert.equal(emitted.payload.operationDiagnostics, undefined);
});
