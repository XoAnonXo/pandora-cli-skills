const test = require('node:test');
const assert = require('node:assert/strict');

const { runMirrorClose } = require('../../cli/lib/mirror_close_service.cjs');

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

