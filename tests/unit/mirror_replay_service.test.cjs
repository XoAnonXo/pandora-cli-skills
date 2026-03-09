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

test('buildMirrorReplayPayload keeps reconciled leg spend totals when ledger rows use notional fields', () => {
  const payload = buildMirrorReplayPayload({
    audit: {
      ledger: {
        source: 'mirror-audit-log',
        entries: [
          {
            classification: 'sync-action',
            venue: 'mirror',
            source: 'mirror-sync.execution',
            timestamp: '2026-03-09T10:00:00.000Z',
            status: 'ok',
            details: {
              idempotencyKey: 'bucket-2',
              model: {
                plannedRebalanceUsdc: 10,
                plannedHedgeUsdc: 4,
                plannedSpendUsdc: 14,
              },
            },
          },
          {
            classification: 'pandora-rebalance',
            venue: 'pandora',
            source: 'mirror-ledger.reconciled',
            timestamp: '2026-03-09T10:00:01.000Z',
            status: 'ok',
            details: {
              legType: 'rebalance-fill',
              notionalUsdc: 10,
              quantity: 20,
              feeUsdc: 0.11,
              gasUsdc: 0.09,
              txHash: '0xrebalance',
              blockNumber: 123,
              nonce: 7,
              side: 'yes',
            },
          },
          {
            classification: 'polymarket-hedge',
            venue: 'polymarket',
            source: 'mirror-ledger.reconciled',
            timestamp: '2026-03-09T10:00:02.000Z',
            status: 'ok',
            details: {
              legType: 'hedge-fill',
              notionalUsdc: 4,
              quantity: 8,
              feeUsdc: 0.03,
              txHash: '0xhedge',
              tokenSide: 'no',
              orderSide: 'buy',
            },
          },
          {
            classification: 'funding-transfer',
            venue: 'bridge',
            source: 'mirror-ledger.reconciled',
            timestamp: '2026-03-09T10:00:03.000Z',
            status: 'ok',
            details: {
              notionalUsdc: 4,
            },
          },
        ],
      },
    },
  });

  assert.equal(payload.summary.actionCount, 1);
  assert.equal(payload.summary.totalActualSpendUsdc, 14);
  assert.equal(payload.summary.totalSpendVarianceUsdc, 0);

  const action = payload.actions[0];
  assert.equal(action.actual.rebalanceUsdc, 10);
  assert.equal(action.actual.hedgeUsdc, 4);
  assert.equal(action.actual.spendUsdc, 14);
  assert.equal(action.legs[0].legType, 'rebalance-fill');
  assert.equal(action.legs[0].notionalUsdc, 10);
  assert.equal(action.legs[0].txHash, '0xrebalance');
  assert.equal(action.legs[0].blockNumber, 123);
  assert.equal(action.legs[1].legType, 'hedge-fill');
  assert.equal(action.legs[1].feeUsdc, 0.03);
  assert.match(payload.diagnostics[0], /funding-transfer/);
});

test('buildMirrorReplayPayload keeps non-hash transaction refs out of txHash', () => {
  const payload = buildMirrorReplayPayload({
    audit: {
      ledger: {
        source: 'mirror-audit-log',
        entries: [
          {
            classification: 'sync-action',
            venue: 'mirror',
            source: 'mirror-sync.execution',
            timestamp: '2026-03-09T10:00:00.000Z',
            status: 'ok',
            details: {
              idempotencyKey: 'bucket-3',
              model: {
                plannedSpendUsdc: 4,
              },
            },
          },
          {
            classification: 'polymarket-hedge',
            venue: 'polymarket',
            source: 'mirror-sync.execution.hedge',
            timestamp: '2026-03-09T10:00:01.000Z',
            status: 'ok',
            details: {
              amountUsdc: 4,
              transactionRef: 'order-123',
              tokenSide: 'yes',
              orderSide: 'buy',
            },
          },
        ],
      },
    },
  });

  assert.equal(payload.actions[0].legs[0].txHash, null);
  assert.equal(payload.actions[0].legs[0].transactionRef, 'order-123');
});
