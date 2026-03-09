const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { createIndexerClient } = require('../../cli/lib/indexer_client.cjs');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('indexer client batches getManyByIds into a single GraphQL request for small sets', async () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body || '{}');
    requests.push(payload);

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      data: {
        item0: { id: payload.variables.id0, question: 'Q1' },
        item1: { id: payload.variables.id1, question: 'Q2' },
        item2: { id: payload.variables.id2, question: 'Q3' },
      },
    }));
  });

  await listen(server);
  const url = `http://127.0.0.1:${server.address().port}/graphql`;

  try {
    const client = createIndexerClient(url, 2000);
    const result = await client.getManyByIds({
      queryName: 'polls',
      fields: ['id', 'question'],
      ids: ['poll-1', 'poll-2', 'poll-3'],
    });

    assert.equal(requests.length, 1);
    assert.match(String(requests[0].query || ''), /item0:\s*polls\(id:\s*\$id0\)/);
    assert.equal(result.get('poll-1').id, 'poll-1');
    assert.equal(result.get('poll-2').id, 'poll-2');
    assert.equal(result.get('poll-3').id, 'poll-3');
  } finally {
    await close(server);
  }
});

test('indexer client falls back to single requests when a batch request fails', async () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body || '{}');
    requests.push(payload);

    const query = String(payload.query || '');
    res.setHeader('content-type', 'application/json');
    if (query.includes('query BatchGet')) {
      res.statusCode = 500;
      res.end(JSON.stringify({ errors: [{ message: 'batch unavailable' }] }));
      return;
    }

    res.statusCode = 200;
    res.end(JSON.stringify({
      data: {
        polls: {
          id: payload.variables.id,
          question: `Question for ${payload.variables.id}`,
        },
      },
    }));
  });

  await listen(server);
  const url = `http://127.0.0.1:${server.address().port}/graphql`;

  try {
    const client = createIndexerClient(url, 2000);
    const result = await client.getManyByIds({
      queryName: 'polls',
      fields: ['id', 'question'],
      ids: ['poll-a', 'poll-b'],
    });

    assert.equal(requests.length, 3);
    assert.match(String(requests[0].query || ''), /query BatchGet/);
    assert.match(String(requests[1].query || ''), /query Get/);
    assert.match(String(requests[2].query || ''), /query Get/);
    assert.equal(result.get('poll-a').id, 'poll-a');
    assert.equal(result.get('poll-b').id, 'poll-b');
  } finally {
    await close(server);
  }
});
