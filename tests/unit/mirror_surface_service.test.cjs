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
