const test = require('node:test');
const assert = require('node:assert/strict');

const { buildMirrorReplayPayload } = require('../../cli/lib/mirror_replay_service.cjs');

test('buildMirrorReplayPayload compares modeled spend to successful leg outcomes and keeps failed legs as attempted-only', () => {
  const payload = buildMirrorReplayPayload({
    audit: {
      stateFile: '/tmp/mirror-state.json',
      strategyHash: 'feedfacecafebeef',
      selector: {
        pandoraMarketAddress: '0x1111111111111111111111111111111111111111',
        polymarketMarketId: 'poly-cond-1',
      },
      ledger: {
        source: 'mirror-audit-log',
        entries: [
          {
            classification: 'sync-action',
            venue: 'mirror',
            source: 'mirror-sync.execution',
            timestamp: '2026-03-09T10:00:00.000Z',
            status: 'failed',
            code: 'HEDGE_EXECUTION_FAILED',
            message: 'hedge failed',
            details: {
              idempotencyKey: 'bucket-1',
              mode: 'live',
              model: {
                plannedRebalanceUsdc: 12.5,
                plannedHedgeUsdc: 7.25,
                plannedSpendUsdc: 19.75,
                rebalanceSide: 'yes',
                hedgeTokenSide: 'no',
                hedgeOrderSide: 'buy',
                reserveSource: 'on-chain',
                rebalanceSizingMode: 'atomic',
                rebalanceTargetUsdc: 12.5,
              },
            },
          },
          {
            classification: 'pandora-rebalance',
            venue: 'pandora',
            source: 'mirror-sync.execution.rebalance',
            timestamp: '2026-03-09T10:00:00.000Z',
            status: 'ok',
            details: {
              side: 'yes',
              amountUsdc: 12.5,
              transactionRef: '0xrebalance',
            },
          },
          {
            classification: 'polymarket-hedge',
            venue: 'polymarket',
            source: 'mirror-sync.execution.hedge',
            timestamp: '2026-03-09T10:00:00.000Z',
            status: 'failed',
            code: 'POLY_FAIL',
            message: 'hedge failed',
            details: {
              tokenSide: 'no',
              orderSide: 'buy',
              amountUsdc: 7.25,
              executionMode: 'buy',
              transactionRef: 'order-1',
            },
          },
        ],
      },
      diagnostics: ['audit available'],
    },
  });

  assert.equal(payload.ledger.source, 'mirror-audit-log');
  assert.equal(payload.summary.actionCount, 1);
  assert.equal(payload.summary.failedCount, 1);
  assert.equal(payload.summary.totalPlannedSpendUsdc, 19.75);
  assert.equal(payload.summary.totalActualSpendUsdc, 12.5);
  assert.equal(payload.summary.totalAttemptedSpendUsdc, 19.75);

  const action = payload.actions[0];
  assert.equal(action.idempotencyKey, 'bucket-1');
  assert.equal(action.modeled.reserveSource, 'on-chain');
  assert.equal(action.modeled.rebalanceSizingMode, 'atomic');
  assert.equal(action.actual.rebalanceUsdc, 12.5);
  assert.equal(action.actual.hedgeUsdc, 0);
  assert.equal(action.actual.attemptedHedgeUsdc, 7.25);
  assert.equal(action.actual.spendUsdc, 12.5);
  assert.equal(action.actual.attemptedSpendUsdc, 19.75);
  assert.equal(action.variance.spendUsdc, -7.25);
  assert.equal(action.failedLegCount, 1);
  assert.equal(action.verdict, 'execution-failed');
  assert.deepEqual(payload.diagnostics, ['audit available']);
});
