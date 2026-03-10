const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveWatchRiskPolicy,
  evaluateWatchRiskAlerts,
} = require('../../cli/lib/watch_risk_policy_service.cjs');

test('resolveWatchRiskPolicy applies override precedence with machine-readable sources', () => {
  const policy = resolveWatchRiskPolicy(
    {
      riskPolicy: {
        limits: {
          maxTradeSizeUsdc: 25,
          maxDailyVolumeUsdc: 80,
          maxTotalExposureUsdc: 120,
        },
      },
      riskOverrides: {
        maxTradeSizeUsdc: 12,
      },
      maxTotalExposureUsdc: 90,
    },
    {
      env: {
        PANDORA_WATCH_RISK_MAX_TRADE_SIZE_USDC: '15',
        PANDORA_WATCH_RISK_MAX_HEDGE_GAP_USDC: '7',
      },
    },
  );

  assert.equal(policy.configured, true);
  assert.equal(policy.limits.maxTradeSizeUsdc, 12);
  assert.equal(policy.limits.maxDailyVolumeUsdc, 80);
  assert.equal(policy.limits.maxTotalExposureUsdc, 90);
  assert.equal(policy.limits.maxHedgeGapUsdc, 7);
  assert.equal(policy.sources.maxTradeSizeUsdc, 'option:riskOverrides.maxTradeSizeUsdc');
  assert.equal(policy.sources.maxDailyVolumeUsdc, 'config:riskPolicy.limits.maxDailyVolumeUsdc');
  assert.equal(policy.sources.maxTotalExposureUsdc, 'option:maxTotalExposureUsdc');
  assert.equal(policy.sources.maxHedgeGapUsdc, 'env:PANDORA_WATCH_RISK_MAX_HEDGE_GAP_USDC');

  const tradeOverride = policy.overridesApplied.find((item) => item.key === 'maxTradeSizeUsdc');
  assert.deepEqual(tradeOverride.overriddenSources, [
    'env:PANDORA_WATCH_RISK_MAX_TRADE_SIZE_USDC',
    'config:riskPolicy.limits.maxTradeSizeUsdc',
  ]);
});

test('evaluateWatchRiskAlerts computes projected and observed exposure thresholds', () => {
  const policy = resolveWatchRiskPolicy({
    riskPolicy: {
      limits: {
        maxTradeSizeUsdc: 5,
        maxDailyVolumeUsdc: 10,
        maxTotalExposureUsdc: 8,
        maxPerMarketExposureUsdc: 4,
        maxHedgeGapUsdc: 2,
      },
    },
  });

  const state = {};
  const first = evaluateWatchRiskAlerts({
    snapshot: {
      iteration: 1,
      timestamp: '2026-03-10T00:00:00.000Z',
    },
    policy,
    options: {
      marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      amountUsdc: 6,
    },
    quote: {
      marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      amountUsdc: 6,
    },
    portfolio: {
      summary: {
        totalPositionMarkValueUsdc: 9,
      },
      positions: [
        {
          marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          markValueUsdc: 5,
        },
        {
          marketAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          markValueUsdc: 4,
        },
      ],
      live: {
        hedgeGapUsdc: -3,
      },
    },
    state,
  });

  assert.equal(first.metrics.tradeSizeUsdc, 6);
  assert.equal(first.metrics.projectedDailyVolumeUsdc, 6);
  assert.equal(first.metrics.totalExposureUsdc, 9);
  assert.equal(first.metrics.maxObservedMarketExposureUsdc, 5);
  assert.equal(first.metrics.hedgeGapUsdc, -3);
  assert.equal(first.metrics.hedgeGapAbsUsdc, 3);
  assert.deepEqual(
    first.alerts.map((item) => item.code),
    [
      'TRADE_SIZE_ABOVE_LIMIT',
      'TOTAL_EXPOSURE_ABOVE_LIMIT',
      'PER_MARKET_EXPOSURE_ABOVE_LIMIT',
      'HEDGE_GAP_ABOVE_LIMIT',
    ],
  );

  const second = evaluateWatchRiskAlerts({
    snapshot: {
      iteration: 2,
      timestamp: '2026-03-10T00:00:01.000Z',
    },
    policy,
    options: {
      marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      amountUsdc: 6,
    },
    quote: {
      marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      amountUsdc: 6,
    },
    portfolio: {
      summary: {
        totalPositionMarkValueUsdc: 9,
      },
      positions: [
        {
          marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          markValueUsdc: 5,
        },
      ],
    },
    state,
  });

  assert.equal(second.metrics.projectedDailyVolumeUsdc, 12);
  assert.ok(second.alerts.some((item) => item.code === 'DAILY_VOLUME_ABOVE_LIMIT'));
});
