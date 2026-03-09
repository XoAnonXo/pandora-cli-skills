const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  createTempDir,
  removeDir,
  runCli,
} = require('../helpers/cli_runner.cjs');

function parseJsonOutput(result, label) {
  assert.equal(result.status, 0, `${label} exited non-zero.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const stdout = String(result.stdout || '').trim();
  assert.equal(String(result.stderr || '').trim(), '', `${label} wrote to stderr in JSON mode.`);
  return JSON.parse(stdout);
}

const MIRROR_SELECTOR = {
  pandoraMarketAddress: '0x1111111111111111111111111111111111111111',
  polymarketMarketId: 'poly-cond-1',
};

test('mirror replay prefers append-only audit log entries over state fallback and exposes modeled reserve metadata', () => {
  const tempHome = createTempDir('pandora-mirror-replay-audit-');
  const stateFile = path.join(tempHome, 'mirror-state.json');
  const auditFile = `${path.resolve(stateFile)}.audit.jsonl`;

  try {
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        schemaVersion: '1.0.0',
        strategyHash: 'feedfacecafebeef',
        pandoraMarketAddress: MIRROR_SELECTOR.pandoraMarketAddress,
        polymarketMarketId: MIRROR_SELECTOR.polymarketMarketId,
        lastExecution: {
          mode: 'live',
          status: 'executed',
          idempotencyKey: 'state-fallback-should-not-win',
          model: {
            plannedSpendUsdc: 999,
            reserveSource: 'state-fallback',
          },
        },
      }, null, 2),
    );
    fs.writeFileSync(
      auditFile,
      [
        {
          schemaVersion: '1.0.0',
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
          schemaVersion: '1.0.0',
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
          schemaVersion: '1.0.0',
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
      ].map((entry) => JSON.stringify(entry)).join('\n') + '\n',
    );

    const payload = parseJsonOutput(
      runCli(['--output', 'json', 'mirror', 'replay', '--state-file', stateFile], {
        env: { HOME: tempHome },
      }),
      'mirror replay --state-file',
    );

    assert.equal(payload.command, 'mirror.replay');
    assert.equal(payload.data.ledger.source, 'mirror-audit-log');
    assert.equal(payload.data.summary.failedCount, 1);
    assert.equal(payload.data.actions[0].modeled.plannedSpendUsdc, 19.75);
    assert.equal(payload.data.actions[0].modeled.reserveSource, 'on-chain');
    assert.equal(payload.data.actions[0].actual.hedgeUsdc, 0);
    assert.equal(payload.data.actions[0].actual.attemptedHedgeUsdc, 7.25);
    assert.equal(payload.data.actions[0].verdict, 'execution-failed');
  } finally {
    removeDir(tempHome);
  }
});

test('mirror replay falls back to persisted lastExecution model metadata when no audit log exists', () => {
  const tempHome = createTempDir('pandora-mirror-replay-state-');
  const stateFile = path.join(tempHome, 'mirror-state.json');

  try {
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        schemaVersion: '1.0.0',
        strategyHash: 'feedfacecafebeef',
        pandoraMarketAddress: MIRROR_SELECTOR.pandoraMarketAddress,
        polymarketMarketId: MIRROR_SELECTOR.polymarketMarketId,
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
            executionMode: 'buy',
            result: {
              ok: true,
              orderId: 'order-2',
            },
          },
        },
      }, null, 2),
    );

    const payload = parseJsonOutput(
      runCli(['--output', 'json', 'mirror', 'replay', '--state-file', stateFile], {
        env: { HOME: tempHome },
      }),
      'mirror replay state fallback',
    );

    assert.equal(payload.command, 'mirror.replay');
    assert.equal(payload.data.ledger.source, 'mirror-state-runtime');
    assert.equal(payload.data.summary.matchedModelCount, 1);
    assert.equal(payload.data.actions[0].modeled.rebalanceSizingMode, 'atomic');
    assert.equal(payload.data.actions[0].actual.spendUsdc, 19.75);
    assert.equal(payload.data.actions[0].verdict, 'matched-model');
  } finally {
    removeDir(tempHome);
  }
});

test('mirror replay selector-first returns an empty replay with diagnostics when no persisted state exists yet', () => {
  const tempHome = createTempDir('pandora-mirror-replay-selector-');

  try {
    const payload = parseJsonOutput(
      runCli([
        '--output',
        'json',
        'mirror',
        'replay',
        '--market-address',
        MIRROR_SELECTOR.pandoraMarketAddress,
        '--polymarket-market-id',
        MIRROR_SELECTOR.polymarketMarketId,
      ], {
        env: { HOME: tempHome },
      }),
      'mirror replay selector-first',
    );

    assert.equal(payload.command, 'mirror.replay');
    assert.equal(payload.data.stateFile, null);
    assert.equal(payload.data.summary.actionCount, 0);
    assert.equal(
      payload.data.diagnostics.some((line) => /No persisted mirror state matched the selector/i.test(String(line))),
      true,
    );
  } finally {
    removeDir(tempHome);
  }
});
