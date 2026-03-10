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
      wallet: '0xdddddddddddddddddddddddddddddddddddddddd',
      pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      polymarketMarketId: '123',
    },
    {
      stopMirrorDaemon: async () => ({}),
      runLp: async () => ({}),
      runClaim: async () => ({}),
      runPolymarketPositions: async () => ({
        marketId: '123',
        summary: {
          yesBalance: 12,
          noBalance: 0,
          openOrdersCount: 1,
          openOrdersNotionalUsd: 4.5,
          estimatedValueUsd: 16.5,
        },
        positions: [{ tokenId: 'yes-token', balance: '12' }],
        diagnostics: [],
      }),
    },
  );

  assert.equal(payload.mode, 'dry-run');
  assert.equal(payload.status, 'planned');
  assert.equal(payload.steps.length, 4);
  assert.deepEqual(
    payload.steps.map((step) => step.step),
    ['stop-daemons', 'withdraw-lp', 'claim-winnings', 'settle-polymarket'],
  );
  assert.deepEqual(
    payload.steps.map((step) => step.status),
    ['planned', 'planned', 'planned', 'planned'],
  );
  assert.equal(payload.summary.failureCount, 0);
  assert.equal(payload.polymarketSettlement.status, 'manual-action-required');
  assert.equal(payload.polymarketSettlement.marketId, '123');
  assert.match(payload.polymarketSettlement.resumeCommand, /pandora polymarket positions --wallet 0xdddddddddddddddddddddddddddddddddddddddd --market-id 123/);
  assert.deepEqual(payload.resumeCommands, []);
});

test('runMirrorClose skips dependent steps when stop-daemons fails', async () => {
  const payload = await runMirrorClose(
    {
      execute: true,
      dryRun: false,
      all: true,
      wallet: '0xdddddddddddddddddddddddddddddddddddddddd',
    },
    {
      stopMirrorDaemon: async () => {
        throw Object.assign(new Error('pid not found'), { code: 'STOP_FAILED' });
      },
      runLp: async () => ({ ok: true }),
      runClaim: async () => ({ ok: true }),
      runPolymarketPositions: async () => ({
        summary: {
          yesBalance: 0,
          noBalance: 0,
          openOrdersCount: 0,
          estimatedValueUsd: 0,
        },
        positions: [],
      }),
    },
  );

  assert.equal(payload.mode, 'execute');
  assert.equal(payload.status, 'partial');
  assert.equal(payload.steps.length, 4);
  assert.equal(payload.steps[0].ok, false);
  assert.equal(payload.steps[0].status, 'failed');
  assert.equal(payload.steps[0].error.code, 'STOP_FAILED');
  assert.equal(payload.steps[1].ok, false);
  assert.equal(payload.steps[1].status, 'skipped');
  assert.equal(payload.steps[1].error.code, 'STEP_SKIPPED_DEPENDENCY_FAILED');
  assert.equal(payload.steps[2].ok, false);
  assert.equal(payload.steps[2].status, 'skipped');
  assert.equal(payload.steps[2].error.code, 'STEP_SKIPPED_DEPENDENCY_FAILED');
  assert.equal(payload.steps[3].status, 'not-needed');
  assert.deepEqual(payload.resumeCommands, [
    'pandora mirror sync stop --all',
    'pandora lp remove --all-markets --all --execute --wallet 0xdddddddddddddddddddddddddddddddddddddddd',
    'pandora claim --all --execute --wallet 0xdddddddddddddddddddddddddddddddddddddddd',
  ]);
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
      runPolymarketPositions: async () => ({
        summary: {
          yesBalance: 0,
          noBalance: 0,
          openOrdersCount: 0,
          estimatedValueUsd: 0,
        },
        positions: [],
      }),
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
  assert.equal(payload.steps.length, 4);
  assert.equal(payload.status, 'completed');
  assert.equal(payload.summary.failureCount, 0);
  assert.equal(payload.polymarketSettlement.status, 'not-needed');
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
  let settlementWallet = null;

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
      runPolymarketPositions: async (options) => {
        settlementWallet = options.wallet;
        return {
          summary: {
            yesBalance: 0,
            noBalance: 0,
            openOrdersCount: 0,
            estimatedValueUsd: 0,
          },
          positions: [],
        };
      },
      deriveWalletAddressFromPrivateKey: () => '0xffffffffffffffffffffffffffffffffffffffff',
      decorateOperationPayload: (payload, context) => {
        operationContext = context;
        return payload;
      },
    },
  );

  assert.ok(operationContext);
  assert.equal(operationContext.operationId, 'mirror-close:1:all:0xffffffffffffffffffffffffffffffffffffffff');
  assert.equal(settlementWallet, '0xffffffffffffffffffffffffffffffffffffffff');
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
      runPolymarketPositions: async () => ({
        summary: {
          yesBalance: 0,
          noBalance: 0,
          openOrdersCount: 0,
          estimatedValueUsd: 0,
        },
        positions: [],
      }),
      decorateOperationPayload: async () => {
        throw new Error('decorator offline');
      },
    },
  );

  assert.equal(payload.operationDiagnostics, undefined);
});

test('runMirrorClose records resumable Polymarket settlement when exposure remains after closeout', async () => {
  const payload = await runMirrorClose(
    {
      execute: true,
      dryRun: false,
      all: false,
      wallet: '0xdddddddddddddddddddddddddddddddddddddddd',
      pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      polymarketMarketId: 'market-42',
    },
    {
      stopMirrorDaemon: async () => ({ ok: true }),
      runLp: async () => ({ ok: true }),
      runClaim: async () => ({ ok: true }),
      runPolymarketPositions: async () => ({
        marketId: 'market-42',
        summary: {
          yesBalance: 10,
          noBalance: 0,
          openOrdersCount: 2,
          openOrdersNotionalUsd: 8.5,
          estimatedValueUsd: 18.5,
        },
        positions: [{ tokenId: 'yes-token', balance: '10' }],
        diagnostics: ['mock position source'],
      }),
    },
  );

  const settlementStep = payload.steps.find((step) => step.step === 'settle-polymarket');
  assert.ok(settlementStep);
  assert.equal(payload.status, 'partial');
  assert.equal(settlementStep.status, 'manual-action-required');
  assert.equal(settlementStep.error.code, 'POLYMARKET_SETTLEMENT_MANUAL_REQUIRED');
  assert.equal(settlementStep.resumable, true);
  assert.equal(payload.polymarketSettlement.status, 'manual-action-required');
  assert.equal(payload.polymarketSettlement.estimatedValueUsd, 18.5);
  assert.deepEqual(payload.resumeCommands, [
    'pandora polymarket positions --wallet 0xdddddddddddddddddddddddddddddddddddddddd --market-id market-42',
  ]);
});
