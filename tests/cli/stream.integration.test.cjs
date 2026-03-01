const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocketServer } = require('ws');

const { runCli, runCliAsync, startJsonHttpServer } = require('../helpers/cli_runner.cjs');

function parseNdjsonLines(stdout) {
  return String(stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function startStreamIndexerMock() {
  return startJsonHttpServer(({ bodyJson }) => {
    const query = String(bodyJson && bodyJson.query ? bodyJson.query : '');

    if (query.includes('query StreamPrices')) {
      return {
        body: {
          data: {
            marketss: {
              items: [
                {
                  id: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                  chainId: 1,
                  chainName: 'ethereum',
                  yesChance: '0.62',
                  reserveYes: '510000000',
                  reserveNo: '490000000',
                  totalVolume: '120000',
                  currentTvl: '100000',
                  marketCloseTimestamp: '1893456000',
                  createdAt: '1700000000',
                },
              ],
            },
          },
        },
      };
    }

    if (query.includes('query StreamEvents')) {
      return {
        body: {
          data: {
            liquidityEventss: {
              items: [
                {
                  id: 'evt-1',
                  chainId: 1,
                  chainName: 'ethereum',
                  provider: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                  marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                  pollAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
                  eventType: 'add',
                  collateralAmount: '10000000',
                  yesTokenAmount: '3000000',
                  noTokenAmount: '7000000',
                  txHash: '0xhash',
                  timestamp: '1700001234',
                },
              ],
            },
          },
        },
      };
    }

    return {
      status: 400,
      body: {
        error: 'Unexpected stream query.',
        query,
      },
    };
  });
}

async function startClosingWebSocketServer() {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    wss.on('error', reject);
    wss.on('connection', (socket) => {
      setTimeout(() => {
        try {
          socket.close();
        } catch {
          // ignore
        }
      }, 120);
    });
    wss.on('listening', () => {
      const address = wss.address();
      resolve({
        url: `ws://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((resolveClose, rejectClose) => {
            wss.close((err) => {
              if (err) {
                rejectClose(err);
                return;
              }
              resolveClose();
            });
          }),
      });
    });
  });
}

test('stream prices emits NDJSON ticks with polling fallback', async (t) => {
  const mock = await startStreamIndexerMock();
  t.after(async () => {
    await mock.close();
  });

  const result = await runCliAsync(
    [
      'stream',
      'prices',
      '--indexer-url',
      mock.url,
      '--indexer-ws-url',
      'ws://127.0.0.1:65534',
      '--interval-ms',
      '200',
      '--limit',
      '1',
    ],
    { timeoutMs: 1400 },
  );

  assert.equal(result.timedOut, true, result.output);
  const lines = parseNdjsonLines(result.stdout);
  const ticks = lines.filter((entry) => entry && entry.type === 'stream.tick' && entry.channel === 'prices');
  assert.ok(ticks.length >= 1, result.stdout);
  assert.equal(ticks[0].source.transport, 'polling');
  assert.equal(typeof ticks[0].seq, 'number');
  assert.equal(typeof ticks[0].data, 'object');
});

test('stream events emits NDJSON ticks with expected envelope fields', async (t) => {
  const mock = await startStreamIndexerMock();
  t.after(async () => {
    await mock.close();
  });

  const result = await runCliAsync(
    [
      'stream',
      'events',
      '--indexer-url',
      mock.url,
      '--interval-ms',
      '200',
      '--limit',
      '1',
    ],
    { timeoutMs: 1400 },
  );

  assert.equal(result.timedOut, true, result.output);
  const lines = parseNdjsonLines(result.stdout);
  const ticks = lines.filter((entry) => entry && entry.type === 'stream.tick' && entry.channel === 'events');
  assert.ok(ticks.length >= 1, result.stdout);
  assert.equal(ticks[0].source.transport, 'polling');
  assert.equal(typeof ticks[0].ts, 'string');
  assert.equal(typeof ticks[0].data, 'object');
});

test('stream falls back to polling when websocket closes after connect', async (t) => {
  const mock = await startStreamIndexerMock();
  const wsServer = await startClosingWebSocketServer();
  t.after(async () => {
    await wsServer.close();
    await mock.close();
  });

  const result = await runCliAsync(
    [
      'stream',
      'prices',
      '--indexer-url',
      mock.url,
      '--indexer-ws-url',
      wsServer.url,
      '--interval-ms',
      '200',
      '--limit',
      '1',
    ],
    { timeoutMs: 1800 },
  );

  assert.equal(result.timedOut, true, result.output);
  const lines = parseNdjsonLines(result.stdout);
  const ticks = lines.filter((entry) => entry && entry.type === 'stream.tick' && entry.channel === 'prices');
  assert.ok(ticks.some((entry) => entry.source && entry.source.transport === 'polling'), result.stdout);
});

test('stream rejects non-websocket --indexer-ws-url values', () => {
  const result = runCli([
    '--output',
    'json',
    'stream',
    'prices',
    '--indexer-url',
    'https://pandoraindexer.up.railway.app/',
    '--indexer-ws-url',
    'https://example.com/socket',
  ]);
  assert.equal(result.status, 1);
  const payload = JSON.parse(String(result.stdout || '').trim());
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
});
