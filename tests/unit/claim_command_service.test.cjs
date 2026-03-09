const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildClaimOperationContext,
  createRunClaimCommand,
} = require('../../cli/lib/claim_command_service.cjs');

class TestCliError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'TestCliError';
    this.code = code;
    this.details = details;
  }
}

test('buildClaimOperationContext creates claim-all operation metadata', () => {
  const context = buildClaimOperationContext(
    {
      all: true,
      wallet: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      chainId: 1,
      execute: true,
    },
    {
      action: 'claim-all',
      mode: 'execute',
      runtime: { chainId: 1 },
      wallet: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      successCount: 2,
      failureCount: 0,
    },
  );

  assert.ok(context);
  assert.equal(context.operationId, 'claim-all:1:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert.deepEqual(context.runtimeHandle, {
    type: 'claim-all',
    chainId: 1,
    all: true,
    marketAddress: null,
    wallet: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  });
});

test('runClaimCommand applies optional operation decorator for claim-all payloads', async () => {
  const observed = {
    operationContext: null,
    emitted: null,
  };
  const runClaimCommand = createRunClaimCommand({
    includesHelpFlag: () => false,
    emitSuccess: (mode, command, payload) => {
      observed.emitted = { mode, command, payload };
    },
    commandHelpPayload: (usage) => ({ usage }),
    parseIndexerSharedFlags: (args) => ({
      indexerUrl: 'https://indexer.test',
      timeoutMs: 5000,
      rest: args,
    }),
    maybeLoadTradeEnv: () => {},
    parseClaimFlags: () => ({
      execute: false,
      dryRun: true,
      all: true,
      wallet: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      chainId: 1,
      indexerUrl: null,
      timeoutMs: null,
    }),
    runClaim: async () => ({
      schemaVersion: '1.0.0',
      generatedAt: '2026-03-07T00:00:00.000Z',
      action: 'claim-all',
      mode: 'dry-run',
      runtime: {
        mode: 'live',
        chainId: 1,
        rpcUrl: 'https://rpc.example',
      },
      wallet: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      successCount: 0,
      failureCount: 0,
      items: [],
      diagnostics: ['No candidate markets discovered for claim-all.'],
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

  await runClaimCommand(['--all', '--dry-run'], { outputMode: 'json' });

  assert.ok(observed.operationContext);
  assert.equal(observed.operationContext.command, 'claim');
  assert.equal(observed.operationContext.operationId, 'claim-all:1:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert.ok(observed.emitted);
  assert.equal(observed.emitted.command, 'claim');
  assert.equal(observed.emitted.payload.operationId, 'claim-all:1:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
});

test('runClaimCommand leaves payload unchanged when no decorator is provided', async () => {
  let emitted = null;
  const runClaimCommand = createRunClaimCommand({
    includesHelpFlag: () => false,
    emitSuccess: (_mode, command, payload) => {
      emitted = { command, payload };
    },
    commandHelpPayload: (usage) => ({ usage }),
    parseIndexerSharedFlags: (args) => ({ rest: args }),
    maybeLoadTradeEnv: () => {},
    parseClaimFlags: () => ({
      execute: false,
      dryRun: true,
      all: true,
      wallet: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      chainId: 1,
    }),
    runClaim: async () => ({
      schemaVersion: '1.0.0',
      action: 'claim-all',
      mode: 'dry-run',
      wallet: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      successCount: 0,
      failureCount: 0,
    }),
    renderSingleEntityTable: () => null,
    CliError: TestCliError,
  });

  await runClaimCommand(['--all', '--dry-run'], { outputMode: 'json' });

  assert.ok(emitted);
  assert.equal(emitted.payload.operationId, undefined);
});

test('runClaimCommand preserves payload shape when decoration fails without diagnostics array', async () => {
  let emitted = null;
  const runClaimCommand = createRunClaimCommand({
    includesHelpFlag: () => false,
    emitSuccess: (_mode, command, payload) => {
      emitted = { command, payload };
    },
    commandHelpPayload: (usage) => ({ usage }),
    parseIndexerSharedFlags: (args) => ({ rest: args }),
    maybeLoadTradeEnv: () => {},
    parseClaimFlags: () => ({
      execute: false,
      dryRun: true,
      all: true,
      wallet: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      chainId: 1,
    }),
    runClaim: async () => ({
      schemaVersion: '1.0.0',
      action: 'claim-all',
      mode: 'dry-run',
      wallet: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      successCount: 0,
      failureCount: 0,
    }),
    renderSingleEntityTable: () => null,
    CliError: TestCliError,
    decorateOperationPayload: async () => {
      throw new Error('decorator offline');
    },
  });

  await runClaimCommand(['--all', '--dry-run'], { outputMode: 'json' });

  assert.ok(emitted);
  assert.equal(emitted.payload.operationDiagnostics, undefined);
});
