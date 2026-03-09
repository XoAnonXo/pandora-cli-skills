const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');

const {
  CLI_PATH,
  REPO_ROOT,
  withChildEnv,
  startJsonHttpServer,
} = require('../helpers/cli_runner.cjs');

const FIXTURE_MARKETS = [
  {
    id: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    chainId: 1,
    chainName: 'ethereum',
    pollAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    creator: '0xcccccccccccccccccccccccccccccccccccccccc',
    marketType: 'amm',
    marketCloseTimestamp: '1893456000',
    totalVolume: '12345',
    currentTvl: '6789',
    createdAt: '1700000000',
  },
  {
    id: '0xdddddddddddddddddddddddddddddddddddddddd',
    chainId: 1,
    chainName: 'ethereum',
    pollAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    creator: '0xffffffffffffffffffffffffffffffffffffffff',
    marketType: 'amm',
    marketCloseTimestamp: '1893542400',
    totalVolume: '54321',
    currentTvl: '9876',
    createdAt: '1700001000',
  },
];

const FIXTURE_LIQUIDITY_BY_MARKET = new Map([
  [
    FIXTURE_MARKETS[0].id.toLowerCase(),
    {
      id: 'liq-1',
      marketAddress: FIXTURE_MARKETS[0].id,
      pollAddress: FIXTURE_MARKETS[0].pollAddress,
      yesTokenAmount: '300',
      noTokenAmount: '700',
      timestamp: '1700002000',
    },
  ],
]);

function runCli(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: REPO_ROOT,
      env: withChildEnv(options.env, options.unsetEnvKeys),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timeoutHit = false;
    const timeoutMs = options.timeoutMs || 20_000;

    const timeout = setTimeout(() => {
      timeoutHit = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        status: 1,
        stdout,
        stderr,
        output: `${stdout}${stderr}`,
        error,
        timedOut: false,
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({
        status: code === null ? 1 : code,
        signal,
        stdout,
        stderr,
        output: `${stdout}${stderr}`,
        error: undefined,
        timedOut: timeoutHit,
      });
    });

    if (typeof options.stdin === 'string') {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
}

function parseJsonEnvelopeStrict(result, label) {
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();

  assert.equal(
    stderr,
    '',
    `${label} wrote to stderr in JSON mode.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.notEqual(stdout, '', `${label} returned empty stdout.`);

  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `${label} returned non-JSON or noisy-prefixed stdout.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\nerror: ${err.message}`,
    );
  }

  assert.equal(typeof payload, 'object');
  assert.notEqual(payload, null);
  assert.equal(typeof payload.ok, 'boolean');
  assert.equal(typeof payload.command, 'string');
  if (payload.ok) {
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'data'), true);
  } else {
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'error'), true);
  }
  return payload;
}

function buildPage(items) {
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

function resolveBatchEntitySelections(query, variables, fieldName, resolver) {
  const pattern = new RegExp(`([A-Za-z0-9_]+)\\s*:\\s*${fieldName}\\(id:\\s*\\$([A-Za-z0-9_]+)\\)`, 'g');
  const matches = Array.from(String(query || '').matchAll(pattern));
  if (!matches.length) return null;

  const data = {};
  for (const match of matches) {
    const alias = match[1];
    const variableName = match[2];
    data[alias] = resolver(variables ? variables[variableName] : undefined);
  }
  return data;
}

async function startMockIndexerServer() {
  const marketsById = new Map(FIXTURE_MARKETS.map((row) => [row.id, row]));

  return startJsonHttpServer(({ bodyJson }) => {
    const query = String(bodyJson && bodyJson.query ? bodyJson.query : '');
    const variables = bodyJson && typeof bodyJson.variables === 'object' && bodyJson.variables
      ? bodyJson.variables
      : {};

    if (query.includes('query marketssList')) {
      const limit = Number.isInteger(variables.limit) ? variables.limit : FIXTURE_MARKETS.length;
      return {
        body: {
          data: {
            marketss: buildPage(FIXTURE_MARKETS.slice(0, Math.max(0, limit))),
          },
        },
      };
    }

    if (query.includes('query marketsGet') && Object.prototype.hasOwnProperty.call(variables, 'id')) {
      const id = String(variables.id || '').trim();
      return {
        body: {
          data: {
            markets: marketsById.get(id) || null,
          },
        },
      };
    }

    const batchMarkets = resolveBatchEntitySelections(query, variables, 'markets', (id) =>
      marketsById.get(String(id || '').trim()) || null,
    );
    if (batchMarkets) {
      return {
        body: {
          data: batchMarkets,
        },
      };
    }

    if (query.includes('query liquidityEventssList')) {
      const marketAddress = String(
        variables &&
        variables.where &&
        variables.where.marketAddress !== undefined &&
        variables.where.marketAddress !== null
          ? variables.where.marketAddress
          : '',
      )
        .trim()
        .toLowerCase();
      const snapshot = FIXTURE_LIQUIDITY_BY_MARKET.get(marketAddress) || null;
      return {
        body: {
          data: {
            liquidityEventss: buildPage(snapshot ? [snapshot] : []),
          },
        },
      };
    }

    return {
      status: 400,
      body: {
        error: 'Unexpected query in agent workflow mock indexer.',
        query,
      },
    };
  });
}

test('agent pipeline composes markets list -> markets get --stdin -> trade --dry-run', async (t) => {
  const mock = await startMockIndexerServer();
  t.after(async () => {
    await mock.close();
  });

  const sharedIndexerArgs = ['--indexer-url', mock.url, '--skip-dotenv'];

  const listResult = await runCli([
    '--output',
    'json',
    'markets',
    ...sharedIndexerArgs,
    'list',
    '--limit',
    '2',
  ]);
  assert.equal(listResult.status, 0, listResult.output);
  const listPayload = parseJsonEnvelopeStrict(listResult, 'markets list');
  assert.equal(listPayload.ok, true);
  assert.equal(listPayload.command, 'markets.list');
  assert.equal(Array.isArray(listPayload.data.items), true);
  assert.equal(listPayload.data.items.length, 2);

  const listedIds = listPayload.data.items.map((item) => String(item.id));
  assert.deepEqual(listedIds, FIXTURE_MARKETS.map((item) => item.id));

  const stdinIds = `${listedIds.join('\n')}\n`;
  const getResult = await runCli(
    [
      '--output',
      'json',
      'markets',
      ...sharedIndexerArgs,
      'get',
      '--stdin',
    ],
    { stdin: stdinIds },
  );
  assert.equal(getResult.status, 0, getResult.output);
  const getPayload = parseJsonEnvelopeStrict(getResult, 'markets get --stdin');
  assert.equal(getPayload.ok, true);
  assert.equal(getPayload.command, 'markets.get');
  assert.equal(getPayload.data.requestedCount, 2);
  assert.equal(getPayload.data.count, 2);
  assert.deepEqual(getPayload.data.missingIds, []);
  assert.deepEqual(
    getPayload.data.items.map((item) => String(item.id)),
    listedIds,
  );

  const tradeResult = await runCli([
    '--output',
    'json',
    'trade',
    ...sharedIndexerArgs,
    '--dry-run',
    '--market-address',
    listedIds[0],
    '--side',
    'yes',
    '--amount-usdc',
    '10',
  ]);
  assert.equal(tradeResult.status, 0, tradeResult.output);
  const tradePayload = parseJsonEnvelopeStrict(tradeResult, 'trade --dry-run');
  assert.equal(tradePayload.ok, true);
  assert.equal(tradePayload.command, 'trade');
  assert.equal(tradePayload.data.mode, 'dry-run');
  assert.equal(tradePayload.data.marketAddress, listedIds[0]);
  assert.equal(tradePayload.data.side, 'yes');
  assert.equal(tradePayload.data.amountUsdc, 10);
  assert.equal(tradePayload.data.quote.quoteAvailable, true);
  assert.equal(tradePayload.data.quote.odds.source, 'liquidity-event:latest');
  assert.equal(Array.isArray(tradePayload.data.executionPlan.steps), true);
  assert.deepEqual(tradePayload.data.executionPlan.steps, [
    'check allowance',
    'approve USDC if needed',
    'buy outcome shares',
  ]);

  const queries = mock.requests.map((request) => String(request && request.bodyJson && request.bodyJson.query ? request.bodyJson.query : ''));
  assert.equal(queries.filter((query) => query.includes('query marketssList')).length, 1);
  assert.equal(queries.filter((query) => query.includes('markets(id:')).length, 2);
  assert.equal(queries.filter((query) => query.includes('query liquidityEventssList')).length, 1);
});
