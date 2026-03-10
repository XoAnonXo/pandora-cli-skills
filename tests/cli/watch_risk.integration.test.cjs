const test = require('node:test');
const assert = require('node:assert/strict');

const { runCliAsync, startJsonHttpServer } = require('../helpers/cli_runner.cjs');

const ADDRESSES = {
  wallet1: '0x1111111111111111111111111111111111111111',
  market1: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};

function parseJsonOutput(result) {
  const text = String(result.stdout || result.output || '').trim();
  assert.ok(text.length > 0, 'expected JSON output');
  return JSON.parse(text);
}

function asPage(items) {
  return {
    items,
    pageInfo: {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    },
  };
}

function buildBatchPayload(variables, finder) {
  const data = {};
  for (const [key, value] of Object.entries(variables || {})) {
    const match = /^id(\d+)$/.exec(key);
    if (!match) continue;
    data[`item${match[1]}`] = finder(value) || null;
  }
  return data;
}

async function startWatchIndexerMockServer() {
  const fixtures = {
    markets: [
      {
        id: ADDRESSES.market1,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: ADDRESSES.market1,
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '1000',
        currentTvl: '1000',
        reserveYes: '500',
        reserveNo: '500',
        createdAt: '1700000000',
      },
    ],
    polls: [
      {
        id: ADDRESSES.market1,
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Will watch risk alerts trigger?',
        status: 0,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
      },
    ],
    positions: [
      {
        id: 'pos-1',
        chainId: 1,
        marketAddress: ADDRESSES.market1,
        user: ADDRESSES.wallet1,
        lastTradeAt: 1700000400,
        yesTokenAmount: '20',
      },
    ],
  };

  return startJsonHttpServer(({ bodyJson }) => {
    const query = (bodyJson && bodyJson.query) || '';
    const variables = (bodyJson && bodyJson.variables) || {};

    if (query.includes('marketUserss(')) {
      return {
        body: {
          data: {
            marketUserss: asPage(
              fixtures.positions.filter((item) => String(item.user).toLowerCase() === String(variables.where && variables.where.user || '').toLowerCase()),
            ),
          },
        },
      };
    }

    if (query.includes('tradess(')) {
      return { body: { data: { tradess: asPage([]) } } };
    }

    if (query.includes('markets(id:')) {
      return {
        body: {
          data: buildBatchPayload(variables, (id) => fixtures.markets.find((item) => item.id === id)),
        },
      };
    }

    if (query.includes('polls(id:')) {
      return {
        body: {
          data: buildBatchPayload(variables, (id) => fixtures.polls.find((item) => item.id === id)),
        },
      };
    }

    return {
      status: 400,
      body: {
        errors: [{ message: 'Unsupported query in watch risk mock indexer' }],
      },
    };
  });
}

test('watch uses env-backed risk limits for projected trade and session volume alerts', async () => {
  const result = await runCliAsync([
    '--output',
    'json',
    'watch',
    '--skip-dotenv',
    '--market-address',
    ADDRESSES.market1,
    '--side',
    'yes',
    '--amount-usdc',
    '6',
    '--yes-pct',
    '55',
    '--iterations',
    '2',
    '--interval-ms',
    '1',
  ], {
    env: {
      PANDORA_WATCH_RISK_MAX_TRADE_SIZE_USDC: '5',
      PANDORA_WATCH_RISK_MAX_DAILY_VOLUME_USDC: '10',
    },
    timeoutMs: 30_000,
  });

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.riskPolicy.limits.maxTradeSizeUsdc, 5);
  assert.equal(payload.data.riskPolicy.limits.maxDailyVolumeUsdc, 10);
  assert.ok(payload.data.alerts.some((item) => item.code === 'TRADE_SIZE_ABOVE_LIMIT'));
  assert.ok(payload.data.alerts.some((item) => item.code === 'DAILY_VOLUME_ABOVE_LIMIT'));
});

test('watch emits exposure alerts from wallet portfolio snapshots using env-backed limits', async () => {
  const indexer = await startWatchIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'watch',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--iterations',
      '1',
      '--interval-ms',
      '1',
      '--no-events',
    ], {
      env: {
        PANDORA_WATCH_RISK_MAX_TOTAL_EXPOSURE_USDC: '9',
        PANDORA_WATCH_RISK_MAX_PER_MARKET_EXPOSURE_USDC: '9',
        RPC_URL: 'http://127.0.0.1:1',
      },
      timeoutMs: 30_000,
    });

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.snapshots[0].risk.metrics.totalExposureUsdc, 10);
    assert.ok(payload.data.alerts.some((item) => item.code === 'TOTAL_EXPOSURE_ABOVE_LIMIT'));
    assert.ok(payload.data.alerts.some((item) => item.code === 'PER_MARKET_EXPOSURE_ABOVE_LIMIT'));
  } finally {
    await indexer.close();
  }
});

test('watch rejects wallet-backed exposure and hedge-gap thresholds without --wallet', async () => {
  const hedgeGapResult = await runCliAsync([
    '--output',
    'json',
    'watch',
    '--skip-dotenv',
    '--market-address',
    ADDRESSES.market1,
    '--alert-hedge-gap-above',
    '5',
    '--iterations',
    '1',
    '--interval-ms',
    '1',
  ], { timeoutMs: 30_000 });

  assert.equal(hedgeGapResult.status, 1);
  const hedgeGapPayload = parseJsonOutput(hedgeGapResult);
  assert.equal(hedgeGapPayload.ok, false);
  assert.equal(hedgeGapPayload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.match(hedgeGapPayload.error.message, /Hedge-gap thresholds require --wallet/);

  const exposureResult = await runCliAsync([
    '--output',
    'json',
    'watch',
    '--skip-dotenv',
    '--market-address',
    ADDRESSES.market1,
    '--max-per-market-exposure-usdc',
    '5',
    '--iterations',
    '1',
    '--interval-ms',
    '1',
  ], { timeoutMs: 30_000 });

  assert.equal(exposureResult.status, 1);
  const exposurePayload = parseJsonOutput(exposureResult);
  assert.equal(exposurePayload.ok, false);
  assert.equal(exposurePayload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.match(exposurePayload.error.message, /Exposure thresholds require --wallet/);
});
