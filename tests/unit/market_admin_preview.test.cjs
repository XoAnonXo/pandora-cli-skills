const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRemoveLiquidityPreviewPayload,
  readCalcRemoveLiquidity,
} = require('../../cli/lib/market_admin_service.cjs');

function formatUnits(value, decimals) {
  const raw = BigInt(value);
  const sign = raw < 0n ? '-' : '';
  const absolute = raw < 0n ? -raw : raw;
  const divisor = 10n ** BigInt(decimals);
  const whole = absolute / divisor;
  const fraction = (absolute % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${sign}${whole.toString()}.${fraction}` : `${sign}${whole.toString()}`;
}

test('buildRemoveLiquidityPreviewPayload derives yes/no outcome scenarios from raw preview balances', () => {
  const payload = buildRemoveLiquidityPreviewPayload(formatUnits, {
    collateralOutRaw: '833370000',
    yesOutRaw: '833370000000000000000',
    noOutRaw: '28738720000000000000000',
  });

  assert.deepEqual(payload, {
    collateralOutRaw: '833370000',
    collateralOutUsdc: '833.37',
    yesOutRaw: '833370000000000000000',
    yesOut: '833.37',
    noOutRaw: '28738720000000000000000',
    noOut: '28738.72',
    scenarioValues: {
      yesUsdc: 1666.74,
      noUsdc: 29572.09,
      minUsdc: 1666.74,
      maxUsdc: 29572.09,
    },
  });
});

test('buildRemoveLiquidityPreviewPayload returns null when liquidity preview is unavailable', () => {
  assert.equal(buildRemoveLiquidityPreviewPayload(formatUnits, null), null);
});

test('buildRemoveLiquidityPreviewPayload labels modern AMM yes/no/collateral outputs correctly', () => {
  const payload = buildRemoveLiquidityPreviewPayload(formatUnits, {
    collateralOutRaw: '2873872000',
    yesOutRaw: '833370000000000000000',
    noOutRaw: '0',
  });

  assert.deepEqual(payload, {
    collateralOutRaw: '2873872000',
    collateralOutUsdc: '2873.872',
    yesOutRaw: '833370000000000000000',
    yesOut: '833.37',
    noOutRaw: '0',
    noOut: '0',
    scenarioValues: {
      yesUsdc: 3707.242,
      noUsdc: 2873.872,
      minUsdc: 2873.872,
      maxUsdc: 3707.242,
    },
  });
});

test('readCalcRemoveLiquidity decodes modern AMM tuples using runtime family probe', async () => {
  const publicClient = {
    async call() {
      return { data: '0x01' };
    },
    async readContract() {
      return [833370000000000000000n, 0n, 2873872000n];
    },
  };

  const payload = await readCalcRemoveLiquidity(
    publicClient,
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    1000n,
  );

  assert.deepEqual(payload, {
    collateralOutRaw: '2873872000',
    yesOutRaw: '833370000000000000000',
    noOutRaw: '0',
  });
});

test('readCalcRemoveLiquidity keeps legacy collateral/yes/no tuples when modern probe is absent', async () => {
  const publicClient = {
    async call() {
      throw new Error('missing function');
    },
    async readContract() {
      return [2873872000n, 833370000000000000000n, 0n];
    },
  };

  const payload = await readCalcRemoveLiquidity(
    publicClient,
    '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    1000n,
  );

  assert.deepEqual(payload, {
    collateralOutRaw: '2873872000',
    yesOutRaw: '833370000000000000000',
    noOutRaw: '0',
  });
});
