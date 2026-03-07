const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMirrorCloseOperationContext,
  runMirrorClose,
} = require('../../cli/lib/mirror_close_service.cjs');

test('runMirrorClose dry-run returns deterministic planned steps', async () => {
  const payload = await runMirrorClose(
    {
      dryRun: true,
      execute: false,
      all: false,
      pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      polymarketMarketId: '123',
    },
    {
      stopMirrorDaemon: async () => ({}),
      runLp: async () => ({}),
      runClaim: async () => ({}),
    },
  );

  assert.equal(payload.mode, 'dry-run');
  assert.equal(payload.steps.length, 3);
  assert.deepEqual(
    payload.steps.map((step) => step.step),
    ['stop-daemons', 'withdraw-lp', 'claim-winnings'],
  );
  assert.equal(payload.summary.failureCount, 0);
});

test('runMirrorClose skips dependent steps when stop-daemons fails', async () => {
  const payload = await runMirrorClose(
    {
      execute: true,
      dryRun: false,
      all: true,
    },
    {
      stopMirrorDaemon: async () => {
        throw Object.assign(new Error('pid not found'), { code: 'STOP_FAILED' });
      },
      runLp: async () => ({ ok: true }),
      runClaim: async () => ({ ok: true }),
    },
  );

  assert.equal(payload.mode, 'execute');
  assert.equal(payload.steps.length, 3);
  assert.equal(payload.steps[0].ok, false);
  assert.equal(payload.steps[0].error.code, 'STOP_FAILED');
  assert.equal(payload.steps[1].ok, false);
  assert.equal(payload.steps[1].error.code, 'STEP_SKIPPED_DEPENDENCY_FAILED');
  assert.equal(payload.steps[2].ok, false);
  assert.equal(payload.steps[2].error.code, 'STEP_SKIPPED_DEPENDENCY_FAILED');
});

test('buildMirrorCloseOperationContext creates stable selector metadata', () => {
  const context = buildMirrorCloseOperationContext(
    {
      execute: true,
      chainId: 137,
      wallet: '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
      pandoraMarketAddress: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      polymarketMarketId: 'market-42',
    },
    {
      mode: 'execute',
      target: {
        all: false,
      },
      pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      polymarketMarketId: 'market-42',
      summary: {
        successCount: 3,
        failureCount: 0,
      },
    },
  );

  assert.ok(context);
  assert.equal(
    context.operationId,
    'mirror-close:137:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa%3Amarket-42',
  );
  assert.deepEqual(context.runtimeHandle, {
    type: 'mirror-close',
    chainId: 137,
    all: false,
    wallet: '0xdddddddddddddddddddddddddddddddddddddddd',
    pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    polymarketMarketId: 'market-42',
    polymarketSlug: null,
  });
});

test('runMirrorClose applies optional operation decorator without changing step flow', async () => {
  const observed = {
    operationContext: null,
  };
  const payload = await runMirrorClose(
    {
      execute: true,
      dryRun: false,
      all: true,
      wallet: '0xdddddddddddddddddddddddddddddddddddddddd',
      chainId: 137,
    },
    {
      stopMirrorDaemon: async () => ({ ok: true }),
      runLp: async () => ({ ok: true }),
      runClaim: async () => ({ ok: true }),
      decorateOperationPayload: (inputPayload, operationContext) => {
        observed.operationContext = operationContext;
        return {
          ...inputPayload,
          operationId: operationContext.operationId,
        };
      },
    },
  );

  assert.ok(observed.operationContext);
  assert.equal(observed.operationContext.command, 'mirror.close');
  assert.equal(observed.operationContext.operationId, 'mirror-close:137:all:0xdddddddddddddddddddddddddddddddddddddddd');
  assert.equal(payload.operationId, 'mirror-close:137:all:0xdddddddddddddddddddddddddddddddddddddddd');
  assert.equal(payload.steps.length, 3);
  assert.equal(payload.summary.failureCount, 0);
});

test('buildMirrorCloseOperationContext can derive wallet identity from private key helper', () => {
  const context = buildMirrorCloseOperationContext(
    {
      execute: true,
      all: true,
      chainId: 1,
      privateKey: '0xabc',
      deriveWalletAddressFromPrivateKey: () => '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    },
    {
      mode: 'execute',
      target: { all: true },
      summary: { successCount: 1, failureCount: 0 },
    },
  );

  assert.ok(context);
  assert.equal(context.operationId, 'mirror-close:1:all:0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
});

test('runMirrorClose can derive wallet identity from deps helper during decoration', async () => {
  let operationContext = null;

  await runMirrorClose(
    {
      execute: true,
      dryRun: false,
      all: true,
      chainId: 1,
      privateKey: '0xabc',
    },
    {
      stopMirrorDaemon: async () => ({ ok: true }),
      runLp: async () => ({ ok: true }),
      runClaim: async () => ({ ok: true }),
      deriveWalletAddressFromPrivateKey: () => '0xffffffffffffffffffffffffffffffffffffffff',
      decorateOperationPayload: (payload, context) => {
        operationContext = context;
        return payload;
      },
    },
  );

  assert.ok(operationContext);
  assert.equal(operationContext.operationId, 'mirror-close:1:all:0xffffffffffffffffffffffffffffffffffffffff');
});

test('runMirrorClose preserves payload shape when decoration fails without diagnostics array', async () => {
  const payload = await runMirrorClose(
    {
      execute: true,
      dryRun: false,
      all: true,
    },
    {
      stopMirrorDaemon: async () => ({ ok: true }),
      runLp: async () => ({ ok: true }),
      runClaim: async () => ({ ok: true }),
      decorateOperationPayload: async () => {
        throw new Error('decorator offline');
      },
    },
  );

  assert.equal(payload.operationDiagnostics, undefined);
});
