const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMirrorPnlPayload,
  buildMirrorAuditPayload,
} = require('../../cli/lib/mirror_surface_service.cjs');

test('buildMirrorPnlPayload preserves scenario outputs derived from live market inputs', () => {
  const payload = buildMirrorPnlPayload({
    stateFile: '/tmp/mirror-state.json',
    strategyHash: 'feedfacecafebeef',
    selector: {
      pandoraMarketAddress: '0x1111111111111111111111111111111111111111',
      polymarketMarketId: 'poly-1',
    },
    state: {
      currentHedgeUsdc: 5,
      cumulativeLpFeesApproxUsdc: 3,
      cumulativeHedgeCostApproxUsdc: 1.5,
    },
    runtime: {
      health: {
        status: 'running',
      },
    },
    live: {
      netPnlApproxUsdc: 1.5,
      pnlApprox: 8.75,
      netDeltaApprox: -2.25,
      driftBps: 140,
      hedgeGapUsdc: -4,
      reserveTotalUsdc: 22,
      pnlScenarios: {
        baseline: {
          markToMarketPnlApproxUsdc: 8.75,
        },
        feeVolumeScenarios: [
          {
            volumeUsdc: 10,
            netPnlApproxUsdc: 0.25,
          },
        ],
        resolutionScenarios: {
          yes: {
            hedgeInventoryPayoutUsd: 12.5,
          },
          no: {
            hedgeInventoryPayoutUsd: 3.25,
          },
        },
      },
      crossVenue: {
        status: 'attention',
      },
      hedgeStatus: {
        hedgeSide: 'no',
      },
      actionability: {
        status: 'action-needed',
      },
      polymarketPosition: {
        yesBalance: 12.5,
        diagnostics: ['position degraded'],
      },
      verifyDiagnostics: ['verify degraded'],
      actionableDiagnostics: [{ code: 'DRIFT_TRIGGERED', message: 'drift' }],
    },
  });

  assert.equal(payload.summary.netPnlApproxUsdc, 1.5);
  assert.equal(payload.summary.pnlApprox, 8.75);
  assert.equal(payload.summary.netDeltaApprox, -2.25);
  assert.equal(payload.summary.currentHedgeUsdc, 5);
  assert.equal(payload.summary.cumulativeLpFeesApproxUsdc, 3);
  assert.equal(payload.summary.cumulativeHedgeCostApproxUsdc, 1.5);
  assert.equal(payload.summary.runtimeHealth, 'running');
  assert.equal(payload.scenarios.resolutionScenarios.yes.hedgeInventoryPayoutUsd, 12.5);
  assert.equal(payload.scenarios.feeVolumeScenarios[0].netPnlApproxUsdc, 0.25);
  assert.equal(payload.crossVenue.status, 'attention');
  assert.equal(payload.hedgeStatus.hedgeSide, 'no');
  assert.equal(payload.actionability.status, 'action-needed');
  assert.deepEqual(payload.diagnostics, [
    'verify degraded',
    '{"code":"DRIFT_TRIGGERED","message":"drift"}',
    'position degraded',
  ]);
});

test('buildMirrorAuditPayload classifies persisted mirror execution legs and alerts', () => {
  const payload = buildMirrorAuditPayload({
    stateFile: '/tmp/mirror-state.json',
    strategyHash: 'feedfacecafebeef',
    selector: {
      pandoraMarketAddress: '0x1111111111111111111111111111111111111111',
      polymarketSlug: 'nba-final',
    },
    state: {
      lastExecution: {
        mode: 'live',
        status: 'failed',
        idempotencyKey: 'bucket-1',
        startedAt: '2026-03-09T09:58:00.000Z',
        completedAt: '2026-03-09T10:00:00.000Z',
        requiresManualReview: true,
        lockFile: '/tmp/mirror-state.json.pending-action.json',
        rebalance: {
          side: 'yes',
          amountUsdc: 12.5,
          result: {
            ok: true,
            txHash: '0xrebalance',
          },
        },
        hedge: {
          tokenSide: 'no',
          side: 'buy',
          amountUsdc: 7.25,
          stateDeltaUsdc: -7.25,
          executionMode: 'buy',
          result: {
            ok: false,
            error: {
              code: 'POLY_FAIL',
              message: 'hedge failed',
            },
          },
        },
        error: {
          code: 'HEDGE_EXECUTION_FAILED',
          message: 'hedge failed',
        },
      },
      alerts: [
        {
          level: 'warn',
          code: 'POLYMARKET_SOURCE_FRESH',
          message: 'cached source used',
          timestamp: '2026-03-09T10:01:00.000Z',
        },
        {
          level: 'error',
          code: 'LAST_ACTION_REQUIRES_REVIEW',
          message: 'manual review required',
          timestamp: '2026-03-09T10:02:00.000Z',
        },
      ],
    },
    runtime: {
      health: {
        status: 'attention',
      },
      lastError: {
        code: 'LAST_ACTION_REQUIRES_REVIEW',
        message: 'manual review required',
      },
    },
    live: {
      crossVenue: {
        status: 'attention',
      },
      verifyDiagnostics: ['verify degraded'],
      actionability: {
        status: 'blocked',
      },
      pnlApprox: 2.75,
      netPnlApproxUsdc: -1.5,
    },
  });

  assert.equal(payload.summary.entryCount, 5);
  assert.equal(payload.summary.actionCount, 1);
  assert.equal(payload.summary.legCount, 2);
  assert.equal(payload.summary.alertCount, 2);
  assert.equal(payload.summary.errorCount, 1);
  assert.equal(payload.summary.requiresManualReview, true);
  assert.equal(payload.summary.lastExecutionStatus, 'failed');
  assert.equal(payload.summary.runtimeHealth, 'attention');
  assert.equal(payload.summary.liveCrossVenueStatus, 'attention');
  assert.equal(payload.ledger.entries[0].classification, 'runtime-alert');
  assert.equal(payload.ledger.entries[0].code, 'LAST_ACTION_REQUIRES_REVIEW');

  const rebalanceEntry = payload.ledger.entries.find((entry) => entry.classification === 'pandora-rebalance');
  const hedgeEntry = payload.ledger.entries.find((entry) => entry.classification === 'polymarket-hedge');
  assert.ok(rebalanceEntry);
  assert.ok(hedgeEntry);
  assert.equal(rebalanceEntry.status, 'ok');
  assert.equal(rebalanceEntry.details.amountUsdc, 12.5);
  assert.equal(rebalanceEntry.details.transactionRef, '0xrebalance');
  assert.equal(hedgeEntry.status, 'failed');
  assert.equal(hedgeEntry.code, 'POLY_FAIL');
  assert.equal(hedgeEntry.details.stateDeltaUsdc, -7.25);
  assert.equal(payload.liveContext.actionability.status, 'blocked');
  assert.deepEqual(payload.diagnostics, ['manual review required', 'verify degraded']);
});

test('buildMirrorAuditPayload falls back to top-level execution failure counts when no leg failure is available', () => {
  const payload = buildMirrorAuditPayload({
    stateFile: '/tmp/mirror-state.json',
    strategyHash: 'feedfacecafebeef',
    state: {
      lastExecution: {
        mode: 'live',
        status: 'failed',
        startedAt: '2026-03-09T09:58:00.000Z',
        completedAt: '2026-03-09T10:00:00.000Z',
        error: {
          code: 'SYNC_FAILED',
          message: 'sync failed',
        },
      },
    },
  });

  assert.equal(payload.summary.entryCount, 1);
  assert.equal(payload.summary.legCount, 0);
  assert.equal(payload.summary.errorCount, 1);
  assert.equal(payload.ledger.entries[0].classification, 'sync-action');
  assert.equal(payload.ledger.entries[0].status, 'failed');
});

test('buildMirrorAuditPayload preserves modeled execution metadata on state fallback entries', () => {
  const payload = buildMirrorAuditPayload({
    stateFile: '/tmp/mirror-state.json',
    strategyHash: 'feedfacecafebeef',
    selector: {
      pandoraMarketAddress: '0x1111111111111111111111111111111111111111',
      polymarketMarketId: 'poly-cond-1',
    },
    state: {
      lastExecution: {
        mode: 'live',
        status: 'executed',
        idempotencyKey: 'bucket-2',
        startedAt: '2026-03-09T09:58:00.000Z',
        completedAt: '2026-03-09T10:00:00.000Z',
        model: {
          plannedRebalanceUsdc: 12.5,
          plannedHedgeUsdc: 7.25,
          plannedSpendUsdc: 19.75,
          rebalanceSide: 'yes',
          hedgeTokenSide: 'no',
          hedgeOrderSide: 'buy',
          hedgeExecutionMode: 'buy',
          reserveSource: 'on-chain',
          rebalanceSizingMode: 'atomic',
          rebalanceTargetUsdc: 12.5,
        },
      },
    },
  });

  const syncEntry = payload.ledger.entries.find((entry) => entry.classification === 'sync-action');
  assert.ok(syncEntry);
  assert.deepEqual(syncEntry.details.model, {
    plannedRebalanceUsdc: 12.5,
    plannedHedgeUsdc: 7.25,
    plannedSpendUsdc: 19.75,
    rebalanceSide: 'yes',
    hedgeTokenSide: 'no',
    hedgeOrderSide: 'buy',
    hedgeExecutionMode: 'buy',
    reserveSource: 'on-chain',
    rebalanceSizingMode: 'atomic',
    rebalanceTargetUsdc: 12.5,
  });
});

test('buildMirrorPnlPayload exposes reconciled accounting alongside approximate live summary fields', () => {
  const payload = buildMirrorPnlPayload({
    stateFile: '/tmp/mirror-state.json',
    strategyHash: 'feedfacecafebeef',
    selector: {
      pandoraMarketAddress: '0x1111111111111111111111111111111111111111',
      polymarketMarketId: 'poly-1',
    },
    state: {
      cumulativeLpFeesApproxUsdc: 2.5,
      cumulativeHedgeCostApproxUsdc: 1.25,
      accounting: {
        provenance: {
          status: 'complete',
        },
        components: {
          lpFeeIncomeUsdc: 2.5,
          hedgeCostUsdc: 1.25,
          markToMarketInventoryUsd: 10.095,
        },
        rows: [
          {
            component: 'funding',
            venue: 'bridge',
            chain: 'polygon',
            timestamp: '2026-03-09T09:59:00.000Z',
            cashFlowUsdc: 15,
            txHash: '0xfunding',
            source: 'state.accounting.rows',
          },
          {
            component: 'gas-cost',
            venue: 'pandora',
            chain: 'ethereum',
            timestamp: '2026-03-09T10:00:30.000Z',
            gasUsdc: 0.25,
            realizedPnlUsdc: -0.25,
            txHash: '0xgas123',
            source: 'state.accounting.rows',
          },
        ],
        traceSnapshots: [
          {
            blockNumber: 111,
            blockTimestamp: '2026-03-09T09:55:00.000Z',
            reserveYesUsdc: 4,
            reserveNoUsdc: 6,
            impermanentLossUsdc: 0.75,
          },
          {
            blockNumber: 112,
            blockTimestamp: '2026-03-09T10:05:00.000Z',
            reserveYesUsdc: 5,
            reserveNoUsdc: 5,
            impermanentLossUsdc: 0.75,
          },
        ],
      },
    },
    live: {
      generatedAt: '2026-03-09T10:06:00.000Z',
      netPnlApproxUsdc: 1.25,
      pnlApprox: 11.345,
      netDeltaApprox: 9.25,
      cumulativeLpFeesApproxUsdc: 2.5,
      cumulativeHedgeCostApproxUsdc: 1.25,
      polymarketPosition: {
        yesBalance: 12.5,
        noBalance: 3.25,
        estimatedValueUsd: 10.095,
        openOrdersCount: 2,
        openOrdersNotionalUsd: 4.96,
      },
    },
    auditEntries: [
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
        timestamp: '2026-03-09T10:00:05.000Z',
        status: 'ok',
        details: {
          tokenSide: 'no',
          orderSide: 'buy',
          amountUsdc: 7.25,
          transactionRef: '0xhedge',
        },
      },
    ],
    includeReconciled: true,
  });

  assert.equal(payload.summary.netPnlApproxUsdc, 1.25);
  assert.equal(payload.summary.pnlApprox, 11.345);
  assert.equal(payload.summary.netDeltaApprox, 9.25);
  assert.equal(payload.summary.realizedPnlUsdc, 1);
  assert.equal(payload.summary.unrealizedPnlUsdc, 9.345);
  assert.equal(payload.summary.netPnlUsdc, 10.345);
  assert.equal(payload.summary.lpFeeIncomeUsdc, 2.5);
  assert.equal(payload.summary.hedgeCostUsdc, 1.25);
  assert.equal(payload.summary.gasCostUsdc, 0.25);
  assert.equal(payload.summary.impermanentLossUsdc, 0.75);
  assert.equal(payload.reconciled.status, 'complete');
  assert.equal(payload.reconciled.summary.rowCount, 8);
  assert.equal(payload.reconciled.summary.fundingNetUsdc, 15);
  assert.equal(payload.reconciled.summary.transactionHashCount, 4);
  assert.deepEqual(payload.reconciled.provenance.missing, []);
  assert.equal(payload.reconciled.ledger.rows.some((row) => row.component === 'funding' && row.txHash === '0xfunding'), true);
  assert.equal(payload.reconciled.ledger.rows.some((row) => row.component === 'impermanent-loss'), true);
  assert.equal(payload.reconciled.ledger.exportRows.length, 8);
});

test('buildMirrorAuditPayload derives partial reconciled status from missing components even when persisted provenance says complete', () => {
  const payload = buildMirrorAuditPayload({
    auditEntries: [
      {
        classification: 'sync-action',
        venue: 'mirror',
        source: 'mirror-sync.execution',
        timestamp: '2026-03-09T10:00:00.000Z',
        status: 'ok',
        details: {
          idempotencyKey: 'bucket-4',
        },
      },
    ],
    state: {
      accounting: {
        provenance: {
          status: 'complete',
        },
        components: {
          lpFeeIncomeUsdc: 2.5,
          hedgeCostUsdc: 1.25,
          markToMarketInventoryUsd: 10.095,
        },
        rows: [
          {
            component: 'funding',
            venue: 'bridge',
            timestamp: '2026-03-09T09:59:00.000Z',
            cashFlowUsdc: 5,
          },
        ],
      },
    },
    includeReconciled: true,
  });

  assert.equal(payload.reconciled.status, 'partial');
  assert.match(payload.reconciled.provenance.missing.join(','), /gas-cost/);
  assert.match(payload.reconciled.provenance.missing.join(','), /reserve-trace/);
});

test('buildMirrorAuditPayload keeps live inventory marks out of reconciled ledger rows when they are not persisted', () => {
  const payload = buildMirrorAuditPayload({
    auditEntries: [
      {
        classification: 'sync-action',
        venue: 'mirror',
        source: 'mirror-sync.execution',
        timestamp: '2026-03-09T10:00:00.000Z',
        status: 'ok',
        details: {
          idempotencyKey: 'bucket-5',
        },
      },
      {
        classification: 'polymarket-hedge',
        venue: 'polymarket',
        source: 'mirror-sync.execution.hedge',
        timestamp: '2026-03-09T10:00:02.000Z',
        status: 'ok',
        details: {
          tokenSide: 'no',
          orderSide: 'buy',
          amountUsdc: 7.25,
          transactionRef: 'order-123',
        },
      },
    ],
    state: {
      accounting: {
        provenance: {
          status: 'partial',
        },
      },
    },
    live: {
      polymarketPosition: {
        estimatedValueUsd: 10.095,
      },
    },
    includeReconciled: true,
  });

  assert.equal(payload.reconciled.ledger.rows.some((row) => row.component === 'inventory-mark'), false);
  assert.equal(payload.reconciled.ledger.rows.some((row) => row.component === 'polymarket-hedge' && row.txHash === null && row.orderRef === 'order-123'), true);
});

test('buildMirrorAuditPayload exposes reconciled ledger rows with venue provenance and tx refs', () => {
  const payload = buildMirrorAuditPayload({
    stateFile: '/tmp/mirror-state.json',
    strategyHash: 'feedfacecafebeef',
    auditEntries: [
      {
        classification: 'sync-action',
        venue: 'mirror',
        source: 'mirror-sync.execution',
        timestamp: '2026-03-09T10:00:00.000Z',
        status: 'ok',
        details: {
          idempotencyKey: 'bucket-3',
        },
      },
      {
        classification: 'pandora-rebalance',
        venue: 'pandora',
        source: 'mirror-sync.execution.rebalance',
        timestamp: '2026-03-09T10:00:01.000Z',
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
        timestamp: '2026-03-09T10:00:02.000Z',
        status: 'ok',
        details: {
          tokenSide: 'no',
          orderSide: 'buy',
          amountUsdc: 7.25,
          transactionRef: '0xhedge',
        },
      },
    ],
    state: {
      cumulativeLpFeesApproxUsdc: 2.5,
      cumulativeHedgeCostApproxUsdc: 1.25,
        accounting: {
          provenance: {
            status: 'complete',
          },
          components: {
            lpFeeIncomeUsdc: 2.5,
            hedgeCostUsdc: 1.25,
            markToMarketInventoryUsd: 10.095,
          },
          rows: [
          {
            component: 'funding',
            venue: 'bridge',
            chain: 'polygon',
            timestamp: '2026-03-09T09:59:00.000Z',
            cashFlowUsdc: 15,
            txHash: '0xfunding',
            source: 'state.accounting.rows',
          },
          {
            component: 'gas-cost',
            venue: 'pandora',
            chain: 'ethereum',
            timestamp: '2026-03-09T10:00:30.000Z',
            gasUsdc: 0.25,
            realizedPnlUsdc: -0.25,
            txHash: '0xgas123',
            source: 'state.accounting.rows',
          },
        ],
        traceSnapshots: [
          {
            blockNumber: 111,
            blockTimestamp: '2026-03-09T09:55:00.000Z',
            reserveYesUsdc: 4,
            reserveNoUsdc: 6,
            impermanentLossUsdc: 0.75,
          },
        ],
      },
    },
    live: {
      generatedAt: '2026-03-09T10:06:00.000Z',
      netPnlApproxUsdc: 1.25,
      pnlApprox: 11.345,
      polymarketPosition: {
        estimatedValueUsd: 10.095,
      },
    },
    includeReconciled: true,
  });

  assert.equal(payload.summary.entryCount, 3);
  assert.equal(payload.ledger.source, 'mirror-audit-log');
  assert.equal(payload.summary.reconciledStatus, 'complete');
  assert.equal(payload.summary.reconciledRowCount, 8);
  assert.equal(payload.summary.realizedPnlUsdc, 1);
  assert.equal(payload.summary.unrealizedPnlUsdc, 9.345);
  assert.equal(payload.summary.netPnlUsdc, 10.345);
  assert.equal(payload.reconciled.status, 'complete');
  assert.deepEqual(payload.reconciled.provenance.missing, []);
  assert.equal(payload.reconciled.ledger.rows.some((row) => row.component === 'pandora-rebalance' && row.txHash === '0xrebalance'), true);
  assert.equal(payload.reconciled.ledger.rows.some((row) => row.component === 'polymarket-hedge' && row.txHash === '0xhedge'), true);
  assert.equal(payload.reconciled.ledger.rows.some((row) => row.component === 'funding' && row.txHash === '0xfunding'), true);
  assert.equal(payload.reconciled.ledger.rows.some((row) => row.component === 'impermanent-loss'), true);
  assert.equal(payload.reconciled.ledger.exportRows.length, 8);
});
