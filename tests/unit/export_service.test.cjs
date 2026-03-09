const test = require('node:test');
const assert = require('node:assert/strict');

const { buildExportPayload, CSV_COLUMNS } = require('../../cli/lib/export_service.cjs');

test('buildExportPayload keeps legacy columns and appends replay-friendly fields', () => {
  const historyPayload = {
    wallet: '0x1111111111111111111111111111111111111111',
    chainId: 1,
    items: [
      {
        timestamp: 1700000600,
        chainId: 1,
        marketAddress: 'market-1',
        pollAddress: 'poll-1',
        question: 'Will deterministic tests pass?',
        side: 'yes',
        tradeType: 'buy',
        collateralAmountUsdc: 5,
        tokenAmount: 10,
        entryPriceUsdcPerToken: 0.5,
        markPriceUsdcPerToken: 1,
        currentValueUsdc: 10,
        pnlUnrealizedApproxUsdc: 5,
        pnlRealizedApproxUsdc: null,
        status: 'open',
        txHash: '0xtrade1',
        feeAmountUsdc: 0.05,
      },
      {
        timestamp: 1700000700,
        chainId: 1,
        marketAddress: 'market-1',
        pollAddress: 'poll-1',
        question: 'Will deterministic tests pass?',
        side: 'no',
        tradeType: 'sell',
        collateralAmountUsdc: 2,
        tokenAmount: 3,
        entryPriceUsdcPerToken: 0.666667,
        markPriceUsdcPerToken: 0,
        currentValueUsdc: 0,
        pnlUnrealizedApproxUsdc: null,
        pnlRealizedApproxUsdc: -2,
        status: 'lost',
        txHash: '0xtrade2',
      },
    ],
  };

  const payload = buildExportPayload(historyPayload, {
    format: 'json',
    year: null,
    from: null,
    to: null,
    outPath: null,
  });

  assert.equal(payload.format, 'json');
  assert.equal(payload.count, 2);
  assert.equal(CSV_COLUMNS.includes('timestamp'), true);
  assert.equal(CSV_COLUMNS.includes('tx_hash'), true);
  assert.equal(CSV_COLUMNS.includes('date'), true);
  assert.equal(CSV_COLUMNS.includes('market'), true);
  assert.equal(CSV_COLUMNS.includes('action'), true);
  assert.equal(CSV_COLUMNS.includes('amount'), true);
  assert.equal(CSV_COLUMNS.includes('price'), true);
  assert.equal(CSV_COLUMNS.includes('gas_usd'), true);
  assert.equal(CSV_COLUMNS.includes('realized_pnl'), true);
  assert.equal(CSV_COLUMNS.includes('classification'), true);
  assert.equal(CSV_COLUMNS.includes('idempotency_key'), true);

  const first = payload.rows[0];
  assert.equal(first.date, '2023-11-14');
  assert.equal(first.market, 'market-1');
  assert.equal(first.action, 'buy');
  assert.equal(first.side, 'yes');
  assert.equal(first.amount, 5);
  assert.equal(first.price, 0.5);
  assert.equal(first.gas_usd, 0.05);
  assert.equal(first.realized_pnl, null);
  assert.equal(first.tx_hash, '0xtrade1');

  const second = payload.rows[1];
  assert.equal(second.action, 'sell');
  assert.equal(second.gas_usd, null);
  assert.equal(second.realized_pnl, -2);
});

test('buildExportPayload preserves mirror classification metadata and ISO timestamps', () => {
  const payload = buildExportPayload({
    wallet: null,
    chainId: null,
    strategyHash: 'feedfacecafebeef',
    stateFile: '/tmp/mirror-state.json',
    items: [
      {
        timestamp: '2026-03-09T10:00:00.000Z',
        classification: 'sync-action',
        venue: 'mirror',
        source: 'mirror-sync.execution',
        status: 'failed',
        code: 'HEDGE_EXECUTION_FAILED',
        message: 'hedge failed',
        details: {
          mode: 'live',
          idempotencyKey: 'bucket-1',
        },
      },
    ],
  }, {
    format: 'json',
    year: null,
    from: null,
    to: null,
    outPath: null,
  });

  assert.equal(payload.count, 1);
  const row = payload.rows[0];
  assert.equal(row.date, '2026-03-09');
  assert.equal(row.action, 'sync-action');
  assert.equal(row.classification, 'sync-action');
  assert.equal(row.venue, 'mirror');
  assert.equal(row.source, 'mirror-sync.execution');
  assert.equal(row.code, 'HEDGE_EXECUTION_FAILED');
  assert.equal(row.message, 'hedge failed');
  assert.equal(row.mode, 'live');
  assert.equal(row.strategy_hash, 'feedfacecafebeef');
  assert.equal(row.state_file, '/tmp/mirror-state.json');
  assert.equal(row.idempotency_key, 'bucket-1');
});
