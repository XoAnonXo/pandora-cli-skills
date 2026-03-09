const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRemoveLiquidityPreviewPayload,
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
