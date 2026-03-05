const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { browseMirrorMarkets } = require('../../cli/lib/mirror_service.cjs');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('browseMirrorMarkets preloads Pandora candidates once and scores each source market locally', async () => {
  const indexerRequests = {
    marketss: 0,
    polls: 0,
  };

  const indexerServer = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;

    const payload = JSON.parse(body || '{}');
    const query = String(payload.query || '');
    const variables = payload.variables || {};

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    if (query.includes('marketss(')) {
      indexerRequests.marketss += 1;
      res.end(
        JSON.stringify({
          data: {
            marketss: {
              items: [
                {
                  id: 'pandora-market-1',
                  chainId: 1,
                  marketType: 'BINARY',
                  pollAddress: 'poll-1',
                  marketCloseTimestamp: 1_900_000_000,
                  yesChance: 600_000_000,
                  reserveYes: null,
                  reserveNo: null,
                },
                {
                  id: 'pandora-market-2',
                  chainId: 1,
                  marketType: 'BINARY',
                  pollAddress: 'poll-2',
                  marketCloseTimestamp: 1_900_000_100,
                  yesChance: 450_000_000,
                  reserveYes: null,
                  reserveNo: null,
                },
              ],
              pageInfo: {
                hasNextPage: false,
                hasPreviousPage: false,
                startCursor: null,
                endCursor: null,
              },
            },
          },
        }),
      );
      return;
    }

    if (query.includes('polls(')) {
      indexerRequests.polls += 1;
      const pollById = {
        'poll-1': {
          id: 'poll-1',
          question: 'Will Team A win?',
          status: 0,
          deadlineEpoch: 1_900_000_000,
          rules: 'Resolves YES if Team A wins.',
        },
        'poll-2': {
          id: 'poll-2',
          question: 'Will Team B win?',
          status: 0,
          deadlineEpoch: 1_900_000_100,
          rules: 'Resolves YES if Team B wins.',
        },
      };

      res.end(
        JSON.stringify({
          data: {
            polls: pollById[String(variables.id || '')] || null,
          },
        }),
      );
      return;
    }

    res.end(JSON.stringify({ data: {} }));
  });

  const polymarketServer = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        markets: [
          {
            condition_id: 'poly-1',
            market_slug: 'team-a-market',
            question: 'Will Team A win?',
            end_date_iso: '2030-03-09T16:00:00Z',
            active: true,
            closed: false,
            volume24hr: 120000,
            tokens: [
              { outcome: 'Yes', price: '0.6', token_id: 'yes-1' },
              { outcome: 'No', price: '0.4', token_id: 'no-1' },
            ],
          },
          {
            condition_id: 'poly-2',
            market_slug: 'team-b-market',
            question: 'Will Team B win?',
            end_date_iso: '2030-03-09T18:00:00Z',
            active: true,
            closed: false,
            volume24hr: 99000,
            tokens: [
              { outcome: 'Yes', price: '0.45', token_id: 'yes-2' },
              { outcome: 'No', price: '0.55', token_id: 'no-2' },
            ],
          },
          {
            condition_id: 'poly-3',
            market_slug: 'team-c-market',
            question: 'Will bitcoin exceed 200k in 2028?',
            end_date_iso: '2030-03-09T20:00:00Z',
            active: true,
            closed: false,
            volume24hr: 75000,
            tokens: [
              { outcome: 'Yes', price: '0.1', token_id: 'yes-3' },
              { outcome: 'No', price: '0.9', token_id: 'no-3' },
            ],
          },
        ],
      }),
    );
  });

  await Promise.all([listen(indexerServer), listen(polymarketServer)]);

  const indexerUrl = `http://127.0.0.1:${indexerServer.address().port}/graphql`;
  const polymarketMockUrl = `http://127.0.0.1:${polymarketServer.address().port}/markets`;

  try {
    const payload = await browseMirrorMarkets({
      indexerUrl,
      chainId: 1,
      polymarketMockUrl,
      limit: 10,
      timeoutMs: 2000,
    });

    assert.equal(payload.count, 3);
    assert.equal(payload.schemaVersion, '1.0.0');
    assert.equal(indexerRequests.marketss, 1);
    assert.equal(indexerRequests.polls, 2);

    const first = payload.items.find((item) => item.slug === 'team-a-market');
    const second = payload.items.find((item) => item.slug === 'team-b-market');
    const third = payload.items.find((item) => item.slug === 'team-c-market');

    assert.equal(first.existingMirror.marketAddress, 'pandora-market-1');
    assert.ok(first.existingMirror.similarity >= 0.86);
    assert.equal(second.existingMirror.marketAddress, 'pandora-market-2');
    assert.ok(second.existingMirror.similarity >= 0.86);
    assert.equal(third.existingMirror, null);
    assert.deepEqual(payload.diagnostics, []);
  } finally {
    await Promise.all([close(indexerServer), close(polymarketServer)]);
  }
});
