const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  DOCTOR_ENV_KEYS,
  createTempDir,
  removeDir,
  runCli,
  runCliAsync,
  startJsonHttpServer,
} = require('../helpers/cli_runner.cjs');

const ADDRESSES = {
  oracle: '0x1111111111111111111111111111111111111111',
  factory: '0x2222222222222222222222222222222222222222',
  usdc: '0x3333333333333333333333333333333333333333',
  wallet1: '0x4444444444444444444444444444444444444444',
  wallet2: '0x5555555555555555555555555555555555555555',
};

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function parseJsonOutput(result) {
  assert.match(result.output, /\{/);
  return JSON.parse(result.output);
}

function buildValidEnv(rpcUrl, overrides = {}) {
  const entries = {
    CHAIN_ID: '1',
    RPC_URL: rpcUrl,
    PRIVATE_KEY: `0x${'1'.repeat(64)}`,
    ORACLE: ADDRESSES.oracle,
    FACTORY: ADDRESSES.factory,
    USDC: ADDRESSES.usdc,
    ...overrides,
  };

  return Object.entries(entries)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function buildRules() {
  return 'Resolves Yes if condition is true. Resolves No if false. If canceled/postponed/abandoned/unresolved, resolve No.';
}

const FIXED_FUTURE_TIMESTAMP = '1893456000'; // 2030-01-01T00:00:00Z

function buildLaunchArgs() {
  return [
    'launch',
    '--skip-dotenv',
    '--question',
    'Will this integration test pass?',
    '--rules',
    buildRules(),
    '--sources',
    'https://example.com/a',
    'https://example.com/b',
    '--target-timestamp',
    FIXED_FUTURE_TIMESTAMP,
    '--liquidity',
    '10',
  ];
}

function buildCloneArgs() {
  return [
    'clone-bet',
    '--skip-dotenv',
    '--question',
    'Will this clone integration test pass?',
    '--rules',
    buildRules(),
    '--sources',
    'https://example.com/a',
    'https://example.com/b',
    '--target-timestamp',
    FIXED_FUTURE_TIMESTAMP,
    '--liquidity',
    '10',
  ];
}

async function startRpcMockServer(options = {}) {
  const chainIdHex = options.chainIdHex || '0x1';
  const codeByAddress = {};

  for (const [address, code] of Object.entries(options.codeByAddress || {})) {
    codeByAddress[address.toLowerCase()] = code;
  }

  return startJsonHttpServer(({ bodyJson }) => {
    if (!bodyJson || typeof bodyJson !== 'object') {
      return {
        status: 400,
        body: {
          jsonrpc: '2.0',
          id: 1,
          error: { message: 'Invalid JSON-RPC payload' },
        },
      };
    }

    if (bodyJson.method === 'eth_chainId') {
      return {
        body: {
          jsonrpc: '2.0',
          id: bodyJson.id || 1,
          result: chainIdHex,
        },
      };
    }

    if (bodyJson.method === 'eth_getCode') {
      const address = String((bodyJson.params && bodyJson.params[0]) || '').toLowerCase();
      return {
        body: {
          jsonrpc: '2.0',
          id: bodyJson.id || 1,
          result: Object.prototype.hasOwnProperty.call(codeByAddress, address) ? codeByAddress[address] : '0x',
        },
      };
    }

    return {
      status: 400,
      body: {
        jsonrpc: '2.0',
        id: bodyJson.id || 1,
        error: { message: `Unsupported method ${bodyJson.method}` },
      },
    };
  });
}

function applyWhereFilter(items, where) {
  if (!where || typeof where !== 'object') return items;

  const entries = Object.entries(where);
  if (!entries.length) return items;

  return items.filter((item) =>
    entries.every(([key, value]) => {
      if (key.endsWith('_contains')) {
        const base = key.replace(/_contains$/, '');
        return String(item[base] || '').includes(String(value));
      }
      return String(item[key]) === String(value);
    }),
  );
}

function applyListControls(items, variables) {
  const orderBy = variables && variables.orderBy ? variables.orderBy : null;
  const orderDirection =
    variables && variables.orderDirection && String(variables.orderDirection).toLowerCase() === 'asc' ? 'asc' : 'desc';
  const limit = variables && Number.isInteger(variables.limit) ? variables.limit : items.length;

  const sorted = [...items];
  if (orderBy) {
    sorted.sort((a, b) => {
      const left = a[orderBy];
      const right = b[orderBy];
      if (left === right) return 0;
      if (left === undefined) return 1;
      if (right === undefined) return -1;
      return left > right ? 1 : -1;
    });
    if (orderDirection === 'desc') {
      sorted.reverse();
    }
  }

  return sorted.slice(0, limit);
}

function asPage(items) {
  return {
    items,
    pageInfo: {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: items.length ? `${items[0].id}` : null,
      endCursor: items.length ? `${items[items.length - 1].id}` : null,
    },
  };
}

async function startIndexerMockServer() {
  const fixtures = {
    markets: [
      {
        id: 'market-1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '12345',
        currentTvl: '4567',
        createdAt: '1700000000',
      },
    ],
    polls: [
      {
        id: 'poll-1',
        chainId: 1,
        chainName: 'ethereum',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        question: 'Will deterministic tests pass?',
        status: 1,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpoll1',
      },
    ],
    liquidityEvents: [
      {
        id: 'evt-liq-1',
        chainId: 1,
        chainName: 'ethereum',
        provider: ADDRESSES.wallet1,
        marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        eventType: 'addLiquidity',
        collateralAmount: '1000',
        lpTokens: '500',
        yesTokenAmount: '625',
        noTokenAmount: '375',
        yesTokensReturned: '0',
        noTokensReturned: '0',
        txHash: '0xtx-liq-1',
        timestamp: 1700000100,
      },
    ],
    oracleFeeEvents: [
      {
        id: 'evt-oracle-1',
        chainId: 1,
        chainName: 'ethereum',
        oracleAddress: ADDRESSES.oracle,
        eventName: 'FeeUpdated',
        newFee: '200',
        to: ADDRESSES.wallet2,
        amount: '0',
        txHash: '0xtx-oracle-1',
        blockNumber: 190,
        timestamp: 1700000200,
      },
    ],
    claimEvents: [
      {
        id: 'evt-claim-1',
        campaignAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
        userAddress: ADDRESSES.wallet1,
        amount: '42',
        signature: '0xsig',
        blockNumber: 200,
        timestamp: 1700000300,
        txHash: '0xtx-claim-1',
      },
    ],
    positions: [
      {
        id: 'pos-1',
        chainId: 1,
        marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        user: ADDRESSES.wallet1,
        lastTradeAt: 1700000400,
      },
      {
        id: 'pos-2',
        chainId: 1,
        marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        user: ADDRESSES.wallet2,
        lastTradeAt: 1700000500,
      },
    ],
  };

  return startJsonHttpServer(({ bodyJson }) => {
    const query = (bodyJson && bodyJson.query) || '';
    const variables = (bodyJson && bodyJson.variables) || {};

    if (query.includes('marketss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.markets, variables.where), variables);
      return { body: { data: { marketss: asPage(items) } } };
    }

    if (query.includes('markets(id:')) {
      const item = fixtures.markets.find((entry) => entry.id === variables.id) || null;
      return { body: { data: { markets: item } } };
    }

    if (query.includes('pollss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.polls, variables.where), variables);
      return { body: { data: { pollss: asPage(items) } } };
    }

    if (query.includes('polls(id:')) {
      const item = fixtures.polls.find((entry) => entry.id === variables.id) || null;
      return { body: { data: { polls: item } } };
    }

    if (query.includes('liquidityEventss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.liquidityEvents, variables.where), variables);
      return { body: { data: { liquidityEventss: asPage(items) } } };
    }

    if (query.includes('liquidityEvents(id:')) {
      const item = fixtures.liquidityEvents.find((entry) => entry.id === variables.id) || null;
      return { body: { data: { liquidityEvents: item } } };
    }

    if (query.includes('oracleFeeEventss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.oracleFeeEvents, variables.where), variables);
      return { body: { data: { oracleFeeEventss: asPage(items) } } };
    }

    if (query.includes('oracleFeeEvents(id:')) {
      const item = fixtures.oracleFeeEvents.find((entry) => entry.id === variables.id) || null;
      return { body: { data: { oracleFeeEvents: item } } };
    }

    if (query.includes('claimEventss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.claimEvents, variables.where), variables);
      return { body: { data: { claimEventss: asPage(items) } } };
    }

    if (query.includes('claimEvents(id:')) {
      const item = fixtures.claimEvents.find((entry) => entry.id === variables.id) || null;
      return { body: { data: { claimEvents: item } } };
    }

    if (query.includes('marketUserss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.positions, variables.where), variables);
      return { body: { data: { marketUserss: asPage(items) } } };
    }

    return {
      status: 400,
      body: {
        errors: [{ message: 'Unsupported query in mock indexer' }],
      },
    };
  });
}

function assertOddsShape(odds) {
  assert.equal(Boolean(odds && typeof odds === 'object' && !Array.isArray(odds)), true);
  assert.equal(typeof odds.yesPct, 'number');
  assert.equal(typeof odds.noPct, 'number');
  assert.ok(odds.yesPct >= 0 && odds.yesPct <= 100);
  assert.ok(odds.noPct >= 0 && odds.noPct <= 100);
  assert.ok(Math.abs(odds.yesPct + odds.noPct - 100) < 0.000001);
}

function assertIsoTimestamp(value) {
  assert.equal(typeof value, 'string');
  const parsed = Date.parse(value);
  assert.equal(Number.isNaN(parsed), false);
}

async function startPhaseOneIndexerMockServer() {
  const fixtures = {
    markets: [
      {
        id: 'market-phase1-1',
        chainId: 1,
        chainName: 'ethereum',
        pollId: 'poll-phase1-1',
        pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '12345',
        currentTvl: '4567',
        createdAt: '1700000000',
        question: 'Will Phase 1 contract tests remain deterministic?',
        status: 1,
        category: 3,
        deadlineEpoch: 1710000000,
        odds: {
          yesPct: 62.5,
          noPct: 37.5,
        },
        yesPct: 62.5,
        noPct: 37.5,
        yesPrice: '0.625',
        noPrice: '0.375',
        poll: {
          id: 'poll-phase1-1',
          question: 'Will Phase 1 contract tests remain deterministic?',
          status: 1,
          category: 3,
          deadlineEpoch: 1710000000,
        },
      },
    ],
    polls: [
      {
        id: 'poll-phase1-1',
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Will Phase 1 contract tests remain deterministic?',
        status: 1,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpollphase1',
      },
    ],
    positions: [
      {
        id: 'scan-pos-1',
        chainId: 1,
        marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        user: ADDRESSES.wallet1,
        lastTradeAt: 1700000400,
      },
    ],
    liquidityEvents: [
      {
        id: 'scan-liq-1',
        chainId: 1,
        chainName: 'ethereum',
        provider: ADDRESSES.wallet1,
        marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        eventType: 'addLiquidity',
        collateralAmount: '1000',
        lpTokens: '500',
        yesTokenAmount: '625',
        noTokenAmount: '375',
        yesTokensReturned: '0',
        noTokensReturned: '0',
        txHash: '0xscan-liq-1',
        timestamp: 1700000100,
      },
    ],
  };

  return startJsonHttpServer(({ bodyJson }) => {
    const query = String((bodyJson && bodyJson.query) || '');
    const variables = (bodyJson && bodyJson.variables) || {};
    const data = {};

    if (query.includes('marketss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.markets, variables.where), variables);
      data.marketss = asPage(items);
    }

    if (query.includes('markets(id:')) {
      data.markets = fixtures.markets.find((entry) => entry.id === variables.id) || null;
    }

    if (query.includes('pollss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.polls, variables.where), variables);
      data.pollss = asPage(items);
    }

    if (query.includes('polls(id:')) {
      data.polls = fixtures.polls.find((entry) => entry.id === variables.id) || null;
    }

    if (query.includes('marketUserss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.positions, variables.where), variables);
      data.marketUserss = asPage(items);
    }

    if (query.includes('liquidityEventss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.liquidityEvents, variables.where), variables);
      data.liquidityEventss = asPage(items);
    }

    if (Object.keys(data).length) {
      return { body: { data } };
    }

    return {
      status: 400,
      body: {
        errors: [{ message: 'Unsupported query in phase1 mock indexer' }],
      },
    };
  });
}

async function startLifecycleIndexerMockServer() {
  const now = Math.floor(Date.now() / 1000);
  const fixtures = {
    markets: [
      {
        id: 'market-past',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: String(now - 3600),
        totalVolume: '10',
        currentTvl: '1',
        createdAt: String(now - 10000),
      },
      {
        id: 'market-soon',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: String(now + 2 * 3600),
        totalVolume: '20',
        currentTvl: '2',
        createdAt: String(now - 5000),
      },
      {
        id: 'market-far',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
        creator: ADDRESSES.wallet1,
        marketType: 'pari',
        marketCloseTimestamp: String(now + 72 * 3600),
        totalVolume: '30',
        currentTvl: '3',
        createdAt: String(now - 3000),
      },
    ],
  };

  return startJsonHttpServer(({ bodyJson }) => {
    const query = (bodyJson && bodyJson.query) || '';
    const variables = (bodyJson && bodyJson.variables) || {};

    if (query.includes('marketss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.markets, variables.where), variables);
      return { body: { data: { marketss: asPage(items) } } };
    }

    if (query.includes('markets(id:')) {
      const item = fixtures.markets.find((entry) => entry.id === variables.id) || null;
      return { body: { data: { markets: item } } };
    }

    return {
      status: 400,
      body: {
        errors: [{ message: 'Unsupported lifecycle query in mock indexer' }],
      },
    };
  });
}

test('help prints usage with zero exit code', () => {
  const result = runCli([]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.output, /pandora - Prediction market CLI/);
  assert.match(result.output, /Usage:/);
});

test('global --output json returns structured error envelope', () => {
  const result = runCli(['--output', 'json', 'not-a-command']);
  assert.equal(result.status, 1);

  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'UNKNOWN_COMMAND');
});

test('unknown command prints help hint in table mode', () => {
  const result = runCli(['not-a-command']);
  assert.equal(result.status, 1);
  assert.match(result.output, /\[UNKNOWN_COMMAND\]/);
  assert.match(result.output, /Unknown command: not-a-command/);
  assert.match(result.output, /Run `pandora help` to see available commands\./);
});

test('init-env copies example file and enforces --force overwrite', () => {
  const tempDir = createTempDir('pandora-init-env-');
  const examplePath = path.join(tempDir, 'fixtures', 'custom.example.env');
  const targetPath = path.join(tempDir, 'runtime', '.env');
  const exampleContent = ['ALPHA=1', 'BETA=2', 'GAMMA=3'].join('\n');

  writeFile(examplePath, exampleContent);

  const first = runCli(['init-env', '--example', examplePath, '--dotenv-path', targetPath]);
  assert.equal(first.status, 0);
  assert.match(first.output, /Wrote env file:/);
  assert.equal(fs.readFileSync(targetPath, 'utf8'), exampleContent);

  const second = runCli(['init-env', '--example', examplePath, '--dotenv-path', targetPath]);
  assert.equal(second.status, 1);
  assert.match(second.output, /Env file already exists:/);

  const forced = runCli(['init-env', '--force', '--example', examplePath, '--dotenv-path', targetPath]);
  assert.equal(forced.status, 0);
  assert.match(forced.output, /Wrote env file:/);

  removeDir(tempDir);
});

test('doctor reports missing required env vars in json mode', () => {
  const tempDir = createTempDir('pandora-doctor-missing-');
  const envPath = path.join(tempDir, 'missing.env');

  writeFile(envPath, 'CHAIN_ID=1\n');

  const result = runCli(['--output', 'json', 'doctor', '--dotenv-path', envPath], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'DOCTOR_FAILED');
  assert.equal(payload.error.details.report.env.required.ok, false);
  assert.ok(payload.error.details.report.env.required.missing.includes('RPC_URL'));

  removeDir(tempDir);
});

test('doctor supports --env-file alias', () => {
  const tempDir = createTempDir('pandora-doctor-env-file-');
  const envPath = path.join(tempDir, 'valid.env');

  writeFile(envPath, buildValidEnv('http://127.0.0.1:1'));

  const result = runCli(['doctor', '--env-file', envPath], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });

  assert.equal(result.status, 1);
  assert.match(result.output, /RPC request failed:/);
  removeDir(tempDir);
});

test('doctor fails on missing --dotenv-path value', () => {
  const result = runCli(['doctor', '--dotenv-path']);
  assert.equal(result.status, 1);
  assert.match(result.output, /Missing value for --dotenv-path/);
});

test('init-env rejects unknown flags', () => {
  const result = runCli(['init-env', '--bogus']);
  assert.equal(result.status, 1);
  assert.match(result.output, /Unknown flag for init-env: --bogus/);
});

test('doctor fails when RPC is unreachable', () => {
  const tempDir = createTempDir('pandora-doctor-rpc-down-');
  const envPath = path.join(tempDir, 'rpc-down.env');

  writeFile(envPath, buildValidEnv('http://127.0.0.1:1'));

  const result = runCli(['--output', 'json', 'doctor', '--dotenv-path', envPath], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'DOCTOR_FAILED');
  assert.equal(payload.error.details.report.rpc.ok, false);

  removeDir(tempDir);
});

test('doctor validates rpc reachability and contract bytecode checks', async () => {
  const rpcServer = await startRpcMockServer({
    chainIdHex: '0x1',
    codeByAddress: {
      [ADDRESSES.oracle]: '0x6001600101',
      [ADDRESSES.factory]: '0x6002600202',
    },
  });

  const tempDir = createTempDir('pandora-doctor-valid-');
  const envPath = path.join(tempDir, 'valid.env');

  try {
    writeFile(envPath, buildValidEnv(rpcServer.url));

    const result = await runCliAsync(['doctor', '--dotenv-path', envPath], {
      unsetEnvKeys: DOCTOR_ENV_KEYS,
    });

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    assert.match(result.output, /Doctor checks passed\./);
  } finally {
    await rpcServer.close();
    removeDir(tempDir);
  }
});

test('setup creates env and coordinates doctor checks', async () => {
  const rpcServer = await startRpcMockServer({
    chainIdHex: '0x1',
    codeByAddress: {
      [ADDRESSES.oracle]: '0x6001600101',
      [ADDRESSES.factory]: '0x6002600202',
    },
  });

  const tempDir = createTempDir('pandora-setup-');
  const examplePath = path.join(tempDir, 'fixtures', '.env.example');
  const envPath = path.join(tempDir, 'runtime', '.env');

  try {
    writeFile(examplePath, buildValidEnv(rpcServer.url));

    const result = await runCliAsync([
      '--output',
      'json',
      'setup',
      '--example',
      examplePath,
      '--dotenv-path',
      envPath,
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    assert.equal(fs.existsSync(envPath), true);

    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.envStep.status, 'written');
    assert.equal(payload.data.doctor.summary.ok, true);
  } finally {
    await rpcServer.close();
    removeDir(tempDir);
  }
});

test('markets list/get uses indexer graphql with json output', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const listResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--limit',
      '5',
    ]);
    assert.equal(listResult.timedOut, false);
    assert.equal(listResult.status, 0);
    const listPayload = parseJsonOutput(listResult);
    assert.equal(listPayload.data.count, 1);
    assert.equal(listPayload.data.items[0].id, 'market-1');

    const getResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'get',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--id',
      'market-1',
    ]);
    assert.equal(getResult.timedOut, false);
    assert.equal(getResult.status, 0);
    const getPayload = parseJsonOutput(getResult);
    assert.equal(getPayload.data.item.id, 'market-1');
  } finally {
    await indexer.close();
  }
});

test('read-only subcommands expose scoped --help output', () => {
  const marketsList = runCli(['markets', 'list', '--help']);
  assert.equal(marketsList.status, 0);
  assert.match(marketsList.output, /pandora markets list - List markets/);
  assert.doesNotMatch(marketsList.output, /Unknown flag for markets list/);

  const pollsList = runCli(['polls', 'list', '--help']);
  assert.equal(pollsList.status, 0);
  assert.match(pollsList.output, /pandora polls list - List polls/);

  const eventsGet = runCli(['events', 'get', '--help']);
  assert.equal(eventsGet.status, 0);
  assert.match(eventsGet.output, /pandora events get - Get an event by id/);

  const positionsList = runCli(['positions', 'list', '--help']);
  assert.equal(positionsList.status, 0);
  assert.match(positionsList.output, /pandora positions - Query wallet position entities/);
});

test('markets list supports lifecycle convenience filters', async () => {
  const indexer = await startLifecycleIndexerMockServer();

  try {
    const activeResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--active',
    ]);
    assert.equal(activeResult.status, 0);
    const activePayload = parseJsonOutput(activeResult);
    assert.equal(activePayload.data.filters.lifecycle, 'active');
    assert.equal(activePayload.data.count, 2);

    const resolvedResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--resolved',
    ]);
    assert.equal(resolvedResult.status, 0);
    const resolvedPayload = parseJsonOutput(resolvedResult);
    assert.equal(resolvedPayload.data.filters.lifecycle, 'resolved');
    assert.equal(resolvedPayload.data.count, 1);
    assert.equal(resolvedPayload.data.items[0].id, 'market-past');

    const expiringSoonResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--expiring-soon',
    ]);
    assert.equal(expiringSoonResult.status, 0);
    const expiringSoonPayload = parseJsonOutput(expiringSoonResult);
    assert.equal(expiringSoonPayload.data.filters.lifecycle, 'expiring-soon');
    assert.equal(expiringSoonPayload.data.count, 1);
    assert.equal(expiringSoonPayload.data.items[0].id, 'market-soon');
    assert.equal(expiringSoonPayload.data.lifecycle.expiringHours, 24);
  } finally {
    await indexer.close();
  }
});

test('markets get supports repeated --id values and reports missing ids', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'markets',
      'get',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--id',
      'market-1',
      '--id',
      'market-missing',
    ]);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'markets.get');
    assert.equal(payload.data.requestedCount, 2);
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].id, 'market-1');
    assert.deepEqual(payload.data.missingIds, ['market-missing']);
  } finally {
    await indexer.close();
  }
});

test('markets list validates lifecycle flag combinations', () => {
  const conflicting = runCli([
    '--output',
    'json',
    'markets',
    'list',
    '--skip-dotenv',
    '--indexer-url',
    'http://127.0.0.1:1',
    '--active',
    '--resolved',
  ]);
  assert.equal(conflicting.status, 1);
  const conflictingPayload = parseJsonOutput(conflicting);
  assert.equal(conflictingPayload.error.code, 'INVALID_ARGS');
  assert.match(conflictingPayload.error.message, /mutually exclusive/);

  const missingLifecycle = runCli([
    '--output',
    'json',
    'markets',
    'list',
    '--skip-dotenv',
    '--indexer-url',
    'http://127.0.0.1:1',
    '--expiring-hours',
    '12',
  ]);
  assert.equal(missingLifecycle.status, 1);
  const missingLifecyclePayload = parseJsonOutput(missingLifecycle);
  assert.equal(missingLifecyclePayload.error.code, 'INVALID_ARGS');
  assert.match(missingLifecyclePayload.error.message, /requires --expiring-soon/);
});

test('markets list --with-odds falls back to latest liquidity event when market payload omits odds fields', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--with-odds',
      '--limit',
      '5',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'markets.list');
    assert.equal(payload.data.count, 1);

    const first = payload.data.items[0];
    assert.equal(typeof first.id, 'string');
    assert.equal(Boolean(first.odds && typeof first.odds === 'object'), true);
    assert.equal(first.odds.source, 'liquidity-event:latest');
    assert.equal(typeof first.odds.yesPct, 'number');
    assert.equal(typeof first.odds.noPct, 'number');
    assert.ok(Math.abs(first.odds.yesPct - 37.5) < 0.000001);
    assert.ok(Math.abs(first.odds.noPct - 62.5) < 0.000001);
  } finally {
    await indexer.close();
  }
});

test('markets list --expand includes poll details in json items', async () => {
  const indexer = await startPhaseOneIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--limit',
      '5',
      '--expand',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);

    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'markets.list');
    assert.equal(payload.data.count, 1);

    const first = payload.data.items[0];
    assert.equal(typeof first.id, 'string');
    assert.equal(Boolean(first.poll && typeof first.poll === 'object' && !Array.isArray(first.poll)), true);
    assert.equal(typeof first.poll.id, 'string');
    assert.equal(typeof first.poll.question, 'string');
    assert.equal(Number.isInteger(first.poll.status), true);
    assert.equal(Number.isInteger(first.poll.category), true);
    assert.ok(first.poll.deadlineEpoch !== undefined && first.poll.deadlineEpoch !== null);
  } finally {
    await indexer.close();
  }
});

test('markets list --with-odds includes normalized yes/no percentages in json items', async () => {
  const indexer = await startPhaseOneIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--limit',
      '5',
      '--with-odds',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);

    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'markets.list');
    assert.equal(payload.data.count, 1);

    const first = payload.data.items[0];
    assert.equal(typeof first.id, 'string');
    assertOddsShape(first.odds);
  } finally {
    await indexer.close();
  }
});

test('scan returns deterministic json contract for market candidates', async () => {
  const indexer = await startPhaseOneIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'scan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--limit',
      '5',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);

    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'scan');
    assert.equal(typeof payload.data.indexerUrl, 'string');
    assert.equal(typeof payload.data.count, 'number');
    assert.equal(Array.isArray(payload.data.items), true);
    assert.equal(payload.data.items.length, 1);
    assertIsoTimestamp(payload.data.generatedAt);

    const first = payload.data.items[0];
    assert.equal(typeof first.id, 'string');
    assert.equal(typeof first.chainId, 'number');
    assert.equal(typeof first.marketType, 'string');
    assert.equal(typeof first.question, 'string');
    assert.ok(first.marketCloseTimestamp !== undefined && first.marketCloseTimestamp !== null);
    assertOddsShape(first.odds);
  } finally {
    await indexer.close();
  }
});

test('quote derives odds and estimates from latest liquidity snapshot', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'quote',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-address',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--side',
      'yes',
      '--amount-usdc',
      '50',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);

    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'quote');
    assert.equal(payload.data.marketAddress, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.equal(payload.data.side, 'yes');
    assert.equal(payload.data.quoteAvailable, true);
    assert.equal(payload.data.odds.source, 'liquidity-event:latest');
    assert.equal(typeof payload.data.estimate.estimatedShares, 'number');
    assert.ok(payload.data.estimate.estimatedShares > 0);
    assert.ok(payload.data.estimate.minSharesOut <= payload.data.estimate.estimatedShares);
  } finally {
    await indexer.close();
  }
});

test('quote supports manual odds override via --yes-pct without indexer calls', () => {
  const result = runCli([
    '--output',
    'json',
    'quote',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'no',
    '--amount-usdc',
    '20',
    '--yes-pct',
    '60',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'quote');
  assert.equal(payload.data.odds.source, 'manual:yes-pct');
  assert.equal(payload.data.quoteAvailable, true);
  assert.ok(payload.data.estimate.estimatedShares > 0);
});

test('quote --help prints command help without parser errors', () => {
  const result = runCli(['quote', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.output, /pandora quote - Estimate a YES\/NO trade/);
  assert.doesNotMatch(result.output, /Unknown flag for quote/);
});

test('trade requires exactly one execution mode flag', () => {
  const result = runCli([
    '--output',
    'json',
    'trade',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '10',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'INVALID_ARGS');
  assert.match(payload.error.message, /--dry-run or --execute/);
});

test('trade enforces --max-amount-usdc guardrail', () => {
  const result = runCli([
    '--output',
    'json',
    'trade',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '25',
    '--yes-pct',
    '55',
    '--max-amount-usdc',
    '10',
    '--dry-run',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'TRADE_RISK_GUARD');
  assert.match(payload.error.message, /exceeds --max-amount-usdc/);
});

test('trade enforces probability guardrails', () => {
  const result = runCli([
    '--output',
    'json',
    'trade',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '10',
    '--yes-pct',
    '40',
    '--min-probability-pct',
    '50',
    '--dry-run',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'TRADE_RISK_GUARD');
  assert.match(payload.error.message, /below --min-probability-pct/);
});

test('trade --execute blocks unquoted execution by default', () => {
  const result = runCli([
    '--output',
    'json',
    'trade',
    '--skip-dotenv',
    '--indexer-url',
    'http://127.0.0.1:1',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '10',
    '--execute',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'TRADE_RISK_GUARD');
  assert.match(payload.error.message, /requires a quote by default/);
});

test('trade --allow-unquoted-execute bypasses quote-availability guardrail', () => {
  const result = runCli([
    '--output',
    'json',
    'trade',
    '--skip-dotenv',
    '--indexer-url',
    'http://127.0.0.1:1',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '10',
    '--allow-unquoted-execute',
    '--execute',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.notEqual(payload.error.code, 'TRADE_RISK_GUARD');
});

test('trade --help prints command help', () => {
  const result = runCli(['trade', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.output, /pandora trade - Execute a buy on a market/);
});

test('trade --dry-run returns execution plan and embedded quote', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'trade',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-address',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--side',
      'yes',
      '--amount-usdc',
      '25',
      '--dry-run',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'trade');
    assert.equal(payload.data.mode, 'dry-run');
    assert.equal(payload.data.status, 'ok');
    assert.equal(payload.data.quote.quoteAvailable, true);
    assert.equal(Array.isArray(payload.data.executionPlan.steps), true);
    assert.equal(payload.data.executionPlan.steps.length, 3);
  } finally {
    await indexer.close();
  }
});

test('polls list/get uses indexer graphql with filters', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const listResult = await runCliAsync([
      '--output',
      'json',
      'polls',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--question-contains',
      'deterministic',
    ]);
    assert.equal(listResult.timedOut, false);
    assert.equal(listResult.status, 0);
    const listPayload = parseJsonOutput(listResult);
    assert.equal(listPayload.data.count, 1);
    assert.equal(listPayload.data.items[0].id, 'poll-1');

    const getResult = await runCliAsync([
      '--output',
      'json',
      'polls',
      'get',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--id',
      'poll-1',
    ]);
    assert.equal(getResult.timedOut, false);
    assert.equal(getResult.status, 0);
    const getPayload = parseJsonOutput(getResult);
    assert.equal(getPayload.data.item.id, 'poll-1');
  } finally {
    await indexer.close();
  }
});

test('events list/get aggregates configured event sources', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const listResult = await runCliAsync([
      '--output',
      'json',
      'events',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--type',
      'all',
      '--limit',
      '10',
    ]);

    assert.equal(listResult.timedOut, false);
    assert.equal(listResult.status, 0);
    const listPayload = parseJsonOutput(listResult);
    assert.equal(listPayload.data.count, 3);

    const sources = new Set(listPayload.data.items.map((item) => item.source));
    assert.equal(sources.has('liquidity'), true);
    assert.equal(sources.has('oracle-fee'), true);
    assert.equal(sources.has('claim'), true);

    const getResult = await runCliAsync([
      '--output',
      'json',
      'events',
      'get',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--id',
      'evt-oracle-1',
    ]);

    assert.equal(getResult.timedOut, false);
    assert.equal(getResult.status, 0);
    const getPayload = parseJsonOutput(getResult);
    assert.equal(getPayload.data.item.source, 'oracle-fee');
  } finally {
    await indexer.close();
  }
});

test('events list with --chain-id does not send chainId to claim filters', async () => {
  const indexer = await startJsonHttpServer(({ bodyJson }) => {
    const query = (bodyJson && bodyJson.query) || '';
    const variables = (bodyJson && bodyJson.variables) || {};

    if (query.includes('liquidityEventss(')) {
      return { body: { data: { liquidityEventss: asPage([]) } } };
    }

    if (query.includes('oracleFeeEventss(')) {
      return { body: { data: { oracleFeeEventss: asPage([]) } } };
    }

    if (query.includes('claimEventss(')) {
      if (variables.where && Object.prototype.hasOwnProperty.call(variables.where, 'chainId')) {
        return {
          body: {
            errors: [{ message: 'Field "chainId" is not defined by type "claimEventsFilter".' }],
          },
        };
      }
      return {
        body: {
          data: {
            claimEventss: asPage([
              {
                id: 'evt-claim-safe',
                campaignAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
                userAddress: ADDRESSES.wallet1,
                amount: '5',
                signature: '0xsig',
                blockNumber: 500,
                timestamp: 1700000000,
                txHash: '0xtx-claim-safe',
              },
            ]),
          },
        },
      };
    }

    return {
      status: 400,
      body: {
        errors: [{ message: 'Unsupported query in mock indexer' }],
      },
    };
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'events',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--chain-id',
      '1',
      '--limit',
      '10',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].source, 'claim');

    const claimRequest = indexer.requests.find((req) =>
      String((req.bodyJson && req.bodyJson.query) || '').includes('claimEventss('),
    );
    assert.equal(Boolean(claimRequest), true);
    assert.equal(Object.prototype.hasOwnProperty.call(claimRequest.bodyJson.variables.where, 'chainId'), false);
  } finally {
    await indexer.close();
  }
});

test('table-mode GraphQL errors render human-readable messages', async () => {
  const indexer = await startJsonHttpServer(() => ({
    body: {
      errors: [{ message: 'Invalid field for orderBy', extensions: { code: 'BAD_USER_INPUT' } }],
    },
  }));

  try {
    const result = await runCliAsync([
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 1);
    assert.match(result.output, /Indexer GraphQL query failed\./);
    assert.match(result.output, /- Invalid field for orderBy/);
    assert.doesNotMatch(result.output, /\[object Object\]/);
  } finally {
    await indexer.close();
  }
});

test('positions list supports wallet filtering', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const listResult = await runCliAsync([
      '--output',
      'json',
      'positions',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
    ]);

    assert.equal(listResult.timedOut, false);
    assert.equal(listResult.status, 0);
    const payload = parseJsonOutput(listResult);
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].user.toLowerCase(), ADDRESSES.wallet1.toLowerCase());
  } finally {
    await indexer.close();
  }
});

test('portfolio requires --wallet flag', () => {
  const result = runCli([
    '--output',
    'json',
    'portfolio',
    '--skip-dotenv',
    '--indexer-url',
    'http://127.0.0.1:1',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.match(payload.error.message, /--wallet/);
});

test('portfolio aggregates positions and event metrics for wallet', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'portfolio',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--chain-id',
      '1',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'portfolio');
    assert.equal(payload.data.wallet, ADDRESSES.wallet1.toLowerCase());
    assert.equal(payload.data.summary.positionCount, 1);
    assert.equal(payload.data.summary.uniqueMarkets, 1);
    assert.equal(payload.data.summary.liquidityAdded, 1000);
    assert.equal(payload.data.summary.claims, 42);
    assert.equal(payload.data.summary.cashflowNet, -958);
    assert.equal(payload.data.summary.pnlProxy, -958);
    assert.equal(payload.data.summary.eventsIncluded, true);
    assert.equal(Array.isArray(payload.data.positions), true);
    assert.equal(Array.isArray(payload.data.events.liquidity), true);
    assert.equal(Array.isArray(payload.data.events.claims), true);
  } finally {
    await indexer.close();
  }
});

test('portfolio --no-events skips event aggregation', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'portfolio',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--no-events',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.summary.eventsIncluded, false);
    assert.equal(payload.data.summary.liquidityAdded, 0);
    assert.equal(payload.data.summary.claims, 0);
    assert.equal(payload.data.summary.cashflowNet, 0);
    assert.equal(payload.data.summary.pnlProxy, 0);
    assert.equal(payload.data.events.liquidity.length, 0);
    assert.equal(payload.data.events.claims.length, 0);
  } finally {
    await indexer.close();
  }
});

test('watch requires wallet and/or market target', () => {
  const result = runCli([
    '--output',
    'json',
    'watch',
    '--skip-dotenv',
    '--iterations',
    '1',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.match(payload.error.message, /--wallet and\/or --market-address/);
});

test('watch validates alert target requirements', () => {
  const missingMarket = runCli([
    '--output',
    'json',
    'watch',
    '--skip-dotenv',
    '--wallet',
    ADDRESSES.wallet1,
    '--alert-yes-above',
    '50',
  ]);

  assert.equal(missingMarket.status, 1);
  const missingMarketPayload = parseJsonOutput(missingMarket);
  assert.equal(missingMarketPayload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.match(missingMarketPayload.error.message, /require --market-address/i);

  const missingWallet = runCli([
    '--output',
    'json',
    'watch',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--alert-net-liquidity-above',
    '1',
  ]);

  assert.equal(missingWallet.status, 1);
  const missingWalletPayload = parseJsonOutput(missingWallet);
  assert.equal(missingWalletPayload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.match(missingWalletPayload.error.message, /require --wallet/i);
});

test('watch supports deterministic multi-iteration market snapshots', async () => {
  const result = await runCliAsync([
    '--output',
    'json',
    'watch',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '5',
    '--yes-pct',
    '55',
    '--iterations',
    '2',
    '--interval-ms',
    '1',
  ], { timeoutMs: 30_000 });

  assert.equal(result.timedOut, false);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'watch');
  assert.equal(payload.data.count, 2);
  assert.equal(payload.data.iterationsRequested, 2);
  assert.equal(Array.isArray(payload.data.snapshots), true);
  assert.equal(payload.data.snapshots.length, 2);
  for (const snap of payload.data.snapshots) {
    assert.equal(typeof snap.iteration, 'number');
    assertIsoTimestamp(snap.timestamp);
    assert.equal(snap.quote.quoteAvailable, true);
    assert.equal(snap.quote.odds.source, 'manual:yes-pct');
  }
});

test('watch emits YES-threshold alerts in JSON payload', async () => {
  const result = await runCliAsync([
    '--output',
    'json',
    'watch',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '5',
    '--yes-pct',
    '55',
    '--alert-yes-above',
    '50',
    '--iterations',
    '2',
    '--interval-ms',
    '1',
  ], { timeoutMs: 30_000 });

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'watch');
  assert.equal(payload.data.alertCount, 2);
  assert.equal(payload.data.alerts.length, 2);
  assert.equal(payload.data.alerts[0].code, 'YES_ABOVE_THRESHOLD');
});

test('watch --fail-on-alert exits non-zero when threshold triggers', async () => {
  const result = await runCliAsync([
    '--output',
    'json',
    'watch',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '5',
    '--yes-pct',
    '60',
    '--alert-yes-above',
    '50',
    '--fail-on-alert',
    '--iterations',
    '1',
    '--interval-ms',
    '1',
  ], { timeoutMs: 30_000 });

  assert.equal(result.status, 2);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'WATCH_ALERT_TRIGGERED');
  assert.equal(payload.error.details.alertCount, 1);
});

test('watch can monitor wallet portfolio summary', async () => {
  const indexer = await startIndexerMockServer();

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
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'watch');
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.snapshots[0].portfolioSummary.positionCount, 1);
    assert.equal(payload.data.snapshots[0].portfolioSummary.eventsIncluded, false);
  } finally {
    await indexer.close();
  }
});

test('watch emits net-liquidity threshold alerts from wallet snapshots', async () => {
  const indexer = await startIndexerMockServer();

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
      '--alert-net-liquidity-above',
      '900',
      '--iterations',
      '1',
      '--interval-ms',
      '1',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.alertCount, 1);
    assert.equal(payload.data.alerts[0].code, 'NET_LIQUIDITY_ABOVE_THRESHOLD');
  } finally {
    await indexer.close();
  }
});

test('positions list validates --order-by values client-side', () => {
  const result = runCli([
    '--output',
    'json',
    'positions',
    'list',
    '--skip-dotenv',
    '--indexer-url',
    'http://127.0.0.1:1',
    '--order-by',
    'createdAt',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /--order-by must be one of/);
  assert.match(payload.error.message, /lastTradeAt/);
});

test('events list validates address filters client-side', () => {
  const result = runCli([
    '--output',
    'json',
    'events',
    'list',
    '--skip-dotenv',
    '--indexer-url',
    'http://127.0.0.1:1',
    '--wallet',
    'invalid',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /--wallet must be a valid 20-byte hex address/);
});

test('launch enforces mode flag and dry-run reaches deterministic preflight', () => {
  const args = buildLaunchArgs();

  const missingMode = runCli(args, {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });
  assert.equal(missingMode.status, 1);
  assert.match(missingMode.output, /You must pass either --dry-run or --execute/);

  const dryRunPreflight = runCli([...args, '--dry-run'], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
    env: {
      CHAIN_ID: '999',
      PRIVATE_KEY: `0x${'1'.repeat(64)}`,
    },
  });
  assert.equal(dryRunPreflight.status, 1);
  assert.match(dryRunPreflight.output, /Unsupported CHAIN_ID=999\. Supported: 1 or 146/);
});

test('clone-bet enforces mode flag and dry-run reaches deterministic preflight', () => {
  const args = buildCloneArgs();

  const missingMode = runCli(args, {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });
  assert.equal(missingMode.status, 1);
  assert.match(missingMode.output, /Use either --dry-run or --execute/);

  const dryRunPreflight = runCli([...args, '--dry-run'], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
    env: {
      CHAIN_ID: '999',
      PRIVATE_KEY: `0x${'1'.repeat(64)}`,
    },
  });
  assert.equal(dryRunPreflight.status, 1);
  assert.match(dryRunPreflight.output, /Unsupported CHAIN_ID, use 1 or 146/);
});

test('clone-bet --help prints usage without stack traces', () => {
  const result = runCli(['clone-bet', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.output, /Usage:/);
  assert.match(result.output, /pandora clone-bet --dry-run\|--execute/);
  assert.doesNotMatch(result.output, /Missing value for --help|at parseArgs/);
});

test('launch --help prints usage without requiring env file', () => {
  const result = runCli(['launch', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.output, /Usage:/);
  assert.match(result.output, /pandora launch --dry-run\|--execute/);
  assert.doesNotMatch(result.output, /Env file not found/);
});

test('launch supports --no-env-file alias', () => {
  const result = runCli([
    'launch',
    '--no-env-file',
    '--question',
    'Alias test?',
    '--rules',
    buildRules(),
    '--sources',
    'https://example.com/a',
    'https://example.com/b',
    '--target-timestamp',
    FIXED_FUTURE_TIMESTAMP,
    '--liquidity',
    '10',
  ], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });

  assert.equal(result.status, 1);
  assert.match(result.output, /You must pass either --dry-run or --execute/);
});

test('launch rejects --output json mode', () => {
  const result = runCli([
    '--output',
    'json',
    'launch',
    '--skip-dotenv',
    '--question',
    'Output mode contract',
    '--rules',
    buildRules(),
    '--sources',
    'https://example.com/a',
    'https://example.com/b',
    '--target-timestamp',
    FIXED_FUTURE_TIMESTAMP,
    '--liquidity',
    '10',
    '--dry-run',
  ], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'UNSUPPORTED_OUTPUT_MODE');
});
