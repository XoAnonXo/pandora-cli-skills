const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTradeForkPreview,
  buildPolymarketForkPreview,
} = require('../../cli/lib/fork_preview_service.cjs');
const { createRunTradeCommand } = require('../../cli/lib/trade_command_service.cjs');
const { createRunPolymarketCommand } = require('../../cli/lib/polymarket_command_service.cjs');

class TestCliError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const TEST_MARKET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

test('buildTradeForkPreview derives slippage/impact/net-delta from quote estimate', () => {
  const preview = buildTradeForkPreview({
    quote: {
      quoteAvailable: true,
      estimate: {
        estimatedShares: 20,
        minSharesOut: 19,
        slippageBps: 75,
      },
    },
  });

  assert.equal(preview.estimatedGasUsd, null);
  assert.equal(preview.slippagePct, 0.75);
  assert.equal(preview.priceImpact, 5);
  assert.equal(preview.netDeltaChange, 20);
  assert.equal(Array.isArray(preview.diagnostics), true);
});

test('buildTradeForkPreview returns null fields with diagnostics when quote data is unavailable', () => {
  const preview = buildTradeForkPreview({
    quote: {
      quoteAvailable: false,
    },
  });

  assert.equal(preview.estimatedGasUsd, null);
  assert.equal(preview.slippagePct, null);
  assert.equal(preview.priceImpact, null);
  assert.equal(preview.netDeltaChange, null);
  assert.equal(preview.diagnostics.some((line) => /quote data unavailable/i.test(String(line))), true);
});

test('buildPolymarketForkPreview computes VWAP/slippage/priceImpact from /book depth walk', async () => {
  const preview = await buildPolymarketForkPreview({
    host: 'https://clob.polymarket.com',
    tokenId: 'poly-yes-1',
    side: 'buy',
    amountUsdc: 6,
    fetchFn: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        bids: [{ price: '0.49', size: '20' }],
        asks: [
          { price: '0.50', size: '10' },
          { price: '0.52', size: '10' },
        ],
      }),
    }),
  });

  assert.equal(preview.estimatedGasUsd, null);
  assert.ok(preview.slippagePct > 0);
  assert.ok(preview.priceImpact > 0);
  assert.ok(preview.netDeltaChange > 0);
  assert.ok(preview.vwapFill && preview.vwapFill.vwap > 0);
});

test('buildPolymarketForkPreview fails gracefully when /book endpoint is unavailable', async () => {
  const preview = await buildPolymarketForkPreview({
    host: 'https://clob.polymarket.com',
    tokenId: 'poly-yes-1',
    side: 'buy',
    amountUsdc: 10,
    fetchFn: async () => {
      throw new Error('upstream unavailable');
    },
  });

  assert.equal(preview.estimatedGasUsd, null);
  assert.equal(preview.slippagePct, null);
  assert.equal(preview.priceImpact, null);
  assert.equal(preview.netDeltaChange, null);
  assert.equal(preview.diagnostics.some((line) => /depth walk unavailable/i.test(String(line))), true);
});

test('trade command dry-run adds preview for fork runtime without changing base payload', async () => {
  const emissions = [];
  const runTradeCommand = createRunTradeCommand({
    CliError: TestCliError,
    includesHelpFlag: () => false,
    parseIndexerSharedFlags: () => ({ rest: [], indexerUrl: null, timeoutMs: 5_000 }),
    emitSuccess: (mode, command, data) => {
      emissions.push({ mode, command, data });
    },
    tradeHelpJsonPayload: () => ({}),
    quoteHelpJsonPayload: () => ({}),
    printTradeHelpTable: () => null,
    maybeLoadTradeEnv: () => null,
    parseQuoteFlags: () => ({
      marketAddress: TEST_MARKET,
      side: 'yes',
      amountUsdc: 10,
      amountsUsdc: [10],
      slippageBps: 100,
      yesPct: null,
    }),
    parseTradeFlags: () => ({
      marketAddress: TEST_MARKET,
      side: 'yes',
      amountUsdc: 10,
      minSharesOutRaw: null,
      maxAmountUsdc: null,
      minProbabilityPct: null,
      maxProbabilityPct: null,
      allowUnquotedExecute: false,
      dryRun: true,
      execute: false,
      chainId: 1,
      rpcUrl: null,
      fork: true,
      forkRpcUrl: 'http://127.0.0.1:8545',
      forkChainId: 1,
    }),
    resolveIndexerUrl: () => 'https://indexer.example',
    buildQuotePayload: async () => ({
      quoteAvailable: true,
      estimate: {
        estimatedShares: 20,
        minSharesOut: 19.8,
        slippageBps: 100,
      },
    }),
    enforceTradeRiskGuards: () => null,
    getSelectedOutcomeProbabilityPct: () => 55,
    buildTradeRiskGuardConfig: () => ({}),
    executeTradeOnchain: async () => {
      throw new Error('execute path should not be invoked');
    },
    resolveForkRuntime: () => ({
      mode: 'fork',
      chainId: 1,
      rpcUrl: 'http://127.0.0.1:8545',
    }),
    isSecureHttpUrlOrLocal: () => true,
    renderQuoteTable: () => null,
    renderTradeTable: () => null,
  });

  await runTradeCommand([], { outputMode: 'json' });
  assert.equal(emissions.length, 1);
  const payload = emissions[0];
  assert.equal(payload.command, 'trade');
  assert.equal(payload.data.runtime.mode, 'fork');
  assert.equal(payload.data.marketAddress, TEST_MARKET);
  assert.equal(typeof payload.data.preview, 'object');
  assert.equal(Object.prototype.hasOwnProperty.call(payload.data.preview, 'estimatedGasUsd'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.data.preview, 'slippagePct'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.data.preview, 'priceImpact'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.data.preview, 'netDeltaChange'), true);
});

test('polymarket trade dry-run in fork mode adds preview and remains non-fatal when /book fails', async () => {
  const emissions = [];
  const runPolymarketCommand = createRunPolymarketCommand({
    CliError: TestCliError,
    includesHelpFlag: () => false,
    emitSuccess: (mode, command, data) => {
      emissions.push({ mode, command, data });
    },
    commandHelpPayload: (usage) => ({ usage }),
    loadEnvIfPresent: () => null,
    parsePolymarketSharedFlags: () => ({}),
    parsePolymarketApproveFlags: () => ({}),
    parsePolymarketTradeFlags: () => ({
      conditionId: null,
      slug: null,
      token: 'yes',
      tokenId: 'poly-yes-1',
      side: 'buy',
      amountUsdc: 12,
      dryRun: true,
      execute: false,
      host: 'https://clob.polymarket.com',
      timeoutMs: 5_000,
      rpcUrl: null,
      privateKey: null,
      funder: null,
      fork: true,
      forkRpcUrl: 'http://127.0.0.1:8545',
      forkChainId: 137,
      polymarketMockUrl: null,
    }),
    resolveForkRuntime: () => ({
      mode: 'fork',
      chainId: 137,
      rpcUrl: 'http://127.0.0.1:8545',
    }),
    isSecureHttpUrlOrLocal: () => true,
    runPolymarketCheck: async () => ({}),
    runPolymarketApprove: async () => ({}),
    runPolymarketPreflight: async () => ({}),
    resolvePolymarketMarket: async () => {
      throw new Error('market resolution should not be invoked when tokenId is provided');
    },
    readTradingCredsFromEnv: () => ({}),
    placeHedgeOrder: async () => ({}),
    renderPolymarketCheckTable: () => null,
    renderPolymarketApproveTable: () => null,
    renderPolymarketPreflightTable: () => null,
    renderSingleEntityTable: () => null,
    defaultEnvFile: '.env',
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('book endpoint down');
  };
  try {
    await runPolymarketCommand(['trade'], { outputMode: 'json' });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(emissions.length, 1);
  const payload = emissions[0];
  assert.equal(payload.command, 'polymarket.trade');
  assert.equal(payload.data.mode, 'dry-run');
  assert.equal(payload.data.runtime.mode, 'fork');
  assert.equal(typeof payload.data.preview, 'object');
  assert.equal(payload.data.preview.estimatedGasUsd, null);
  assert.equal(payload.data.preview.slippagePct, null);
  assert.equal(payload.data.preview.priceImpact, null);
  assert.equal(payload.data.preview.netDeltaChange, null);
  assert.equal(payload.data.preview.diagnostics.some((line) => /depth walk unavailable/i.test(String(line))), true);
  assert.equal(payload.data.tokenId, 'poly-yes-1');
  assert.equal(payload.data.amountUsdc, 12);
});
