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

test('runResolveCommand help advertises watch guidance', async () => {
  let emitted = null;
  const runResolveCommand = createRunResolveCommand({
    includesHelpFlag: () => true,
    emitSuccess: (mode, command, payload) => {
      emitted = { mode, command, payload };
    },
    commandHelpPayload: (usage) => ({ usage }),
    parseIndexerSharedFlags: (args) => ({ rest: args }),
    maybeLoadTradeEnv: () => {
      throw new Error('maybeLoadTradeEnv should not run for help');
    },
    parseResolveFlags: () => {
      throw new Error('parseResolveFlags should not run for help');
    },
    runResolve: async () => {
      throw new Error('runResolve should not run for help');
    },
    renderSingleEntityTable: () => null,
    CliError: TestCliError,
  });

  await runResolveCommand(['--help'], { outputMode: 'json' });

  assert.ok(emitted);
  assert.equal(emitted.command, 'resolve.help');
  assert.match(emitted.payload.usage, /--watch/);
  assert.match(emitted.payload.notes.watch, /watch repeatedly runs dry-run prechecks/i);
});

test('runResolveCommand watch dry-run polls until resolution becomes executable', async () => {
  const emitted = [];
  const sleepCalls = [];
  const runResolveCalls = [];
  const responses = [
    {
      schemaVersion: '1.0.0',
      mode: 'dry-run',
      status: 'planned',
      pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      answer: 'yes',
      precheck: {
        pollFinalized: false,
        claimable: false,
        currentEpoch: '5909995',
        finalizationEpoch: '5910312',
        epochsUntilFinalization: 317,
      },
      runtime: { chainId: 1 },
    },
    {
      schemaVersion: '1.0.0',
      mode: 'dry-run',
      status: 'planned',
      pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      answer: 'yes',
      precheck: {
        pollFinalized: false,
        claimable: true,
        currentEpoch: '5910312',
        finalizationEpoch: '5910312',
        epochsUntilFinalization: 0,
      },
      runtime: { chainId: 1 },
    },
  ];
  const runResolveCommand = createRunResolveCommand({
    includesHelpFlag: () => false,
    emitSuccess: (mode, command, payload) => {
      emitted.push({ mode, command, payload });
    },
    commandHelpPayload: (usage) => ({ usage }),
    parseIndexerSharedFlags: (args) => ({ rest: args }),
    maybeLoadTradeEnv: () => {},
    parseResolveFlags: () => ({
      execute: false,
      dryRun: true,
      watch: true,
      watchIntervalMs: 25,
      watchTimeoutMs: 1000,
      fork: false,
      forkRpcUrl: null,
      pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      answer: 'yes',
      reason: 'settled',
      chainId: 1,
    }),
    runResolve: async (options) => {
      runResolveCalls.push({ execute: Boolean(options.execute), dryRun: Boolean(options.dryRun) });
      return responses.shift();
    },
    renderSingleEntityTable: () => null,
    CliError: TestCliError,
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
  });

  await runResolveCommand(['--poll-address', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], { outputMode: 'json' });

  assert.equal(runResolveCalls.length, 2);
  assert.deepEqual(runResolveCalls, [
    { execute: false, dryRun: true },
    { execute: false, dryRun: true },
  ]);
  assert.deepEqual(sleepCalls, [25]);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].command, 'resolve');
  assert.equal(emitted[0].payload.watch.ready, true);
  assert.equal(emitted[0].payload.watch.executionTriggered, false);
  assert.equal(emitted[0].payload.watch.attempts, 2);
  assert.equal(emitted[0].payload.watch.currentEpoch, '5910312');
  assert.equal(emitted[0].payload.watch.finalizationEpoch, '5910312');
  assert.equal(emitted[0].payload.watch.epochsUntilFinalization, 0);
  assert.match(emitted[0].payload.watch.reason, /Poll is executable/i);
  assert.match(emitted[0].payload.watch.reason, /Current epoch: 5910312/i);
});

test('runResolveCommand watch execute waits for readiness before the final submission', async () => {
  let assertLiveWriteAllowedCalls = 0;
  const runResolveCalls = [];
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
      execute: true,
      dryRun: false,
      watch: true,
      watchIntervalMs: 10,
      watchTimeoutMs: 1000,
      fork: false,
      forkRpcUrl: null,
      pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      answer: 'yes',
      reason: 'settled',
      chainId: 1,
    }),
    runResolve: async (options) => {
      runResolveCalls.push({ execute: Boolean(options.execute), dryRun: Boolean(options.dryRun) });
      if (!options.execute) {
        if (runResolveCalls.length === 1) {
          return {
            schemaVersion: '1.0.0',
            mode: 'dry-run',
            status: 'planned',
            pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            answer: 'yes',
            precheck: {
              pollFinalized: false,
              claimable: false,
              currentEpoch: '5909995',
              finalizationEpoch: '5910312',
              epochsUntilFinalization: 317,
            },
            runtime: { chainId: 1 },
          };
        }
        return {
          schemaVersion: '1.0.0',
          mode: 'dry-run',
          status: 'planned',
          pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          answer: 'yes',
          precheck: {
            pollFinalized: true,
            claimable: true,
            currentEpoch: '5910312',
            finalizationEpoch: '5910312',
            epochsUntilFinalization: 0,
          },
          runtime: { chainId: 1 },
        };
      }
      return {
        schemaVersion: '1.0.0',
        mode: 'execute',
        status: 'submitted',
        pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        answer: 'yes',
        tx: { hash: '0xabc' },
        runtime: { chainId: 1 },
      };
    },
    renderSingleEntityTable: () => null,
    CliError: TestCliError,
    assertLiveWriteAllowed: async () => {
      assertLiveWriteAllowedCalls += 1;
      assert.deepEqual(runResolveCalls, [
        { execute: false, dryRun: true },
        { execute: false, dryRun: true },
      ]);
    },
    sleep: async () => {},
  });

  await runResolveCommand(['--poll-address', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], { outputMode: 'json' });

  assert.equal(assertLiveWriteAllowedCalls, 1);
  assert.deepEqual(runResolveCalls, [
    { execute: false, dryRun: true },
    { execute: false, dryRun: true },
    { execute: true, dryRun: false },
  ]);
  assert.ok(emitted);
  assert.equal(emitted.command, 'resolve');
  assert.equal(emitted.payload.mode, 'execute');
  assert.equal(emitted.payload.watch.ready, true);
  assert.equal(emitted.payload.watch.executionTriggered, true);
  assert.equal(emitted.payload.watch.attempts, 2);
  assert.match(emitted.payload.watch.reason, /already finalized and executable/i);
});
