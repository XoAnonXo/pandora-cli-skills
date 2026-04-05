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
              feeUsdc: 0.11,
              gasUsdc: 0.09,
              transactionRef: '0xrebalance',
            },
          },
          {
            classification: 'polymarket-hedge',
            venue: 'polymarket',
            source: 'mirror-sync.execution.hedge',
            timestamp: '2026-03-09T10:00:02.000Z',
            status: 'failed',
            code: 'POLY_FAIL',
            message: 'hedge failed',
            details: {
              tokenSide: 'no',
              orderSide: 'buy',
              amountUsdc: 7.25,
              feeUsdc: 0.03,
              gasUsdc: 0.04,
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
  assert.equal(payload.summary.totalActualFeeUsdc, 0.11);
  assert.equal(payload.summary.totalActualGasUsdc, 0.09);
  assert.equal(payload.summary.totalAttemptedFeeUsdc, 0.14);
  assert.equal(payload.summary.totalAttemptedGasUsdc, 0.13);
  assert.equal(payload.summary.totalActualCostUsdc, 0.2);
  assert.equal(payload.summary.totalAttemptedCostUsdc, 0.27);
  assert.equal(payload.summary.averageActionDurationMs, 2000);
  assert.equal(payload.summary.maxActionDurationMs, 2000);
  assert.equal(payload.summary.unknownClassificationCount, 0);
  assert.deepEqual(payload.summary.unknownClassificationTypes, []);
  assert.equal(payload.summary.runtimeAlertCount, 0);

  const action = payload.actions[0];
  assert.equal(action.idempotencyKey, 'bucket-1');
  assert.equal(action.lineage.actionIndex, 0);
  assert.equal(action.lineage.actionId, 'bucket-1');
  assert.equal(action.lineage.entryCount, 3);
  assert.deepEqual(action.lineage.ledgerIndexes, [0, 1, 2]);
  assert.deepEqual(action.lineage.classifications, ['sync-action', 'pandora-rebalance', 'polymarket-hedge']);
  assert.equal(action.lineage.durationMs, 2000);
  assert.equal(action.modeled.reserveSource, 'on-chain');
  assert.equal(action.modeled.rebalanceSizingMode, 'atomic');
  assert.equal(action.actual.rebalanceUsdc, 12.5);
  assert.equal(action.actual.hedgeUsdc, 0);
  assert.equal(action.actual.attemptedHedgeUsdc, 7.25);
  assert.equal(action.actual.actualFeeUsdc, 0.11);
  assert.equal(action.actual.actualGasUsdc, 0.09);
  assert.equal(action.actual.attemptedFeeUsdc, 0.14);
  assert.equal(action.actual.attemptedGasUsdc, 0.13);
  assert.equal(action.actual.actualCostUsdc, 0.2);
  assert.equal(action.actual.attemptedCostUsdc, 0.27);
  assert.equal(action.actual.netActualSpendUsdc, 12.7);
  assert.equal(action.actual.netAttemptedSpendUsdc, 20.02);
  assert.equal(action.actual.spendUsdc, 12.5);
  assert.equal(action.actual.attemptedSpendUsdc, 19.75);
  assert.equal(action.metrics.durationMs, 2000);
  assert.equal(action.metrics.rebalanceFillRatio, 1);
  assert.equal(action.metrics.hedgeFillRatio, 0);
  assert.equal(action.metrics.spendFillRatio, 0.632911);
  assert.equal(action.variance.spendUsdc, -7.25);
  assert.equal(action.failedLegCount, 1);
  assert.equal(action.successfulLegCount, 1);
  assert.equal(action.verdict, 'execution-failed');
  assert.deepEqual(payload.diagnostics, ['audit available']);
  assert.equal(action.legs[0].lineage.actionIndex, 0);
  assert.equal(action.legs[0].lineage.positionInAction, 1);
  assert.equal(action.legs[1].lineage.actionIndex, 0);
  assert.equal(action.legs[1].lineage.positionInAction, 2);
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

test('buildMirrorReplayPayload surfaces unknown classifications and runtime-alert lineage with diagnostics', () => {
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
              idempotencyKey: 'bucket-4',
              eventId: 'event-4',
              model: {
                plannedRebalanceUsdc: 5,
                plannedHedgeUsdc: 2,
                plannedSpendUsdc: 7,
              },
            },
          },
          {
            classification: 'pandora-rebalance',
            venue: 'pandora',
            source: 'mirror-sync.execution.rebalance',
            timestamp: '2026-03-09T10:00:01.000Z',
            status: 'ok',
            details: {
              amountUsdc: 5,
              feeUsdc: 0.05,
              gasUsdc: 0.01,
              side: 'yes',
            },
          },
          {
            classification: 'funding-transfer',
            venue: 'bridge',
            source: 'mirror-sync.execution.transfer',
            timestamp: '2026-03-09T10:00:02.000Z',
            status: 'ok',
            details: {
              amountUsdc: 7,
              transactionRef: 'transfer-1',
            },
          },
          {
            classification: 'runtime-alert',
            venue: 'mirror',
            source: 'mirror-sync.execution.alert',
            timestamp: '2026-03-09T10:00:03.000Z',
            status: 'ok',
            details: {
              message: 'stale quote',
            },
          },
          {
            classification: 'polymarket-hedge',
            venue: 'polymarket',
            source: 'mirror-sync.execution.hedge',
            timestamp: '2026-03-09T10:00:04.000Z',
            status: 'ok',
            details: {
              amountUsdc: 2,
              feeUsdc: 0.02,
              gasUsdc: 0.03,
              tokenSide: 'no',
              orderSide: 'buy',
              transactionRef: '0xhedge',
            },
          },
        ],
      },
    },
  });

  assert.equal(payload.ledger.syncActionCount, 1);
  assert.equal(payload.ledger.executionEntryCount, 2);
  assert.equal(payload.ledger.runtimeAlertCount, 1);
  assert.equal(payload.ledger.unknownEntryCount, 1);
  assert.equal(payload.summary.unknownClassificationCount, 1);
  assert.deepEqual(payload.summary.unknownClassificationTypes, ['funding-transfer']);
  assert.equal(payload.summary.runtimeAlertCount, 1);
  assert.equal(payload.summary.orphanEntryCount, 0);
  assert.equal(payload.actions[0].lineage.actionEventId, 'event-4');
  assert.equal(payload.actions[0].lineage.actionId, 'event-4');
  assert.equal(payload.actions[0].lineage.firstEventId, 'event-4');
  assert.equal(payload.actions[0].lineage.unknownClassificationCount, 1);
  assert.deepEqual(payload.actions[0].lineage.unknownClassifications, ['funding-transfer@2']);
  assert.equal(payload.actions[0].lineage.runtimeAlertCount, 1);
  assert.deepEqual(payload.actions[0].lineage.ledgerIndexes, [0, 1, 2, 3, 4]);
  assert.deepEqual(payload.actions[0].lineage.classifications, ['sync-action', 'pandora-rebalance', 'funding-transfer', 'runtime-alert', 'polymarket-hedge']);
  assert.match(payload.diagnostics.join(' | '), /unknown ledger classification/);
  assert.match(payload.actions[0].diagnostics[0], /Replay action event-4\|2026-03-09T10:00:00\.000Z\|ok includes 1 unknown ledger row\(s\): funding-transfer@2/);
  assert.equal(payload.actions[0].legs[0].lineage.actionIndex, 0);
  assert.equal(payload.actions[0].legs[0].lineage.positionInAction, 1);
  assert.equal(payload.actions[0].legs[1].lineage.positionInAction, 2);
});
