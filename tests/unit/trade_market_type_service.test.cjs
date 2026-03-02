const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_AMM_TRADE_DEADLINE_OFFSET_SEC,
  detectTradeMarketType,
  buildTradeBuyCall,
  resolveTradeBuyCall,
} = require('../../cli/lib/trade_market_type_service.cjs');

const MARKET = '0x1111111111111111111111111111111111111111';

test('detectTradeMarketType resolves parimutuel marker first', async () => {
  const publicClient = {
    async readContract(request) {
      if (request.functionName === 'curveFlattener') return 7n;
      throw new Error('unexpected');
    },
  };

  const detected = await detectTradeMarketType(publicClient, MARKET);
  assert.equal(detected.marketType, 'parimutuel');
  assert.equal(detected.detectedBy, 'curveFlattener');
});

test('detectTradeMarketType falls back to amm marker', async () => {
  const publicClient = {
    async readContract(request) {
      if (request.functionName === 'curveFlattener') throw new Error('function selector was not recognized');
      if (request.functionName === 'tradingFee') return 3000n;
      throw new Error('unexpected');
    },
  };

  const detected = await detectTradeMarketType(publicClient, MARKET);
  assert.equal(detected.marketType, 'amm');
  assert.equal(detected.detectedBy, 'tradingFee');
});

test('detectTradeMarketType throws unsupported interface when neither marker exists', async () => {
  const publicClient = {
    async readContract() {
      throw new Error('reverted');
    },
  };

  await assert.rejects(
    () => detectTradeMarketType(publicClient, MARKET),
    (error) => {
      assert.equal(error.code, 'UNSUPPORTED_MARKET_TRADE_INTERFACE');
      assert.equal(error.details.marketAddress, MARKET);
      return true;
    },
  );
});

test('buildTradeBuyCall uses 3-arg buy for parimutuel', () => {
  const call = buildTradeBuyCall({
    marketType: 'parimutuel',
    side: 'yes',
    amountRaw: 1_000_000n,
    minSharesOutRaw: 0n,
  });

  assert.equal(call.signature, 'buy(bool,uint256,uint256)');
  assert.deepEqual(call.args, [true, 1_000_000n, 0n]);
  assert.equal(call.ammDeadlineEpoch, null);
});

test('buildTradeBuyCall uses 4-arg deadline buy for amm', () => {
  const nowEpochSec = 1_700_000_000;
  const call = buildTradeBuyCall({
    marketType: 'amm',
    side: 'no',
    amountRaw: 2_500_000n,
    minSharesOutRaw: 12n,
    nowEpochSec,
  });

  assert.equal(call.signature, 'buy(bool,uint256,uint256,uint256)');
  assert.equal(call.args.length, 4);
  assert.deepEqual(call.args.slice(0, 3), [false, 2_500_000n, 12n]);
  assert.equal(call.ammDeadlineEpoch, String(nowEpochSec + DEFAULT_AMM_TRADE_DEADLINE_OFFSET_SEC));
});

test('resolveTradeBuyCall composes detection and call creation', async () => {
  const publicClient = {
    async readContract(request) {
      if (request.functionName === 'curveFlattener') throw new Error('not pari');
      if (request.functionName === 'tradingFee') return 500n;
      throw new Error('unexpected');
    },
  };

  const call = await resolveTradeBuyCall({
    publicClient,
    marketAddress: MARKET,
    side: 'yes',
    amountRaw: 9n,
    minSharesOutRaw: 1n,
    nowEpochSec: 1000,
    ammDeadlineOffsetSec: 5,
  });

  assert.equal(call.marketType, 'amm');
  assert.equal(call.detectedBy, 'tradingFee');
  assert.equal(call.signature, 'buy(bool,uint256,uint256,uint256)');
  assert.deepEqual(call.args, [true, 9n, 1n, 1005n]);
});
