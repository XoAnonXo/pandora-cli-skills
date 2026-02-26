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

async function startIndexerMockServer(overrides = {}) {
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
        yesChance: '0.625',
        reserveYes: '625',
        reserveNo: '375',
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
    trades: [
      {
        id: 'trade-1',
        chainId: 1,
        marketAddress: 'market-1',
        pollAddress: 'poll-1',
        trader: ADDRESSES.wallet1,
        side: 'yes',
        tradeType: 'buy',
        collateralAmount: '5000000',
        tokenAmount: '10000000',
        tokenAmountOut: '10000000',
        feeAmount: '50000',
        timestamp: 1700000600,
        txHash: '0xtrade1',
      },
      {
        id: 'trade-2',
        chainId: 1,
        marketAddress: 'market-1',
        pollAddress: 'poll-1',
        trader: ADDRESSES.wallet1,
        side: 'no',
        tradeType: 'buy',
        collateralAmount: '2000000',
        tokenAmount: '3000000',
        tokenAmountOut: '3000000',
        feeAmount: '20000',
        timestamp: 1700000700,
        txHash: '0xtrade2',
      },
    ],
    winnings: [
      {
        id: 'win-1',
        user: ADDRESSES.wallet1,
        marketAddress: 'market-1',
        collateralAmount: '9000000',
        feeAmount: '0',
        timestamp: 1700000800,
        txHash: '0xwin1',
      },
    ],
    users: [
      {
        id: 'user-1',
        address: ADDRESSES.wallet1,
        chainId: 1,
        realizedPnL: '123.45',
        totalVolume: '999.5',
        totalTrades: '7',
        totalWins: '5',
        totalLosses: '2',
        totalWinnings: '500',
      },
      {
        id: 'user-2',
        address: ADDRESSES.wallet2,
        chainId: 1,
        realizedPnL: '23.45',
        totalVolume: '1999.5',
        totalTrades: '10',
        totalWins: '4',
        totalLosses: '6',
        totalWinnings: '250',
      },
    ],
  };

  for (const [key, value] of Object.entries(overrides || {})) {
    if (Array.isArray(value)) {
      fixtures[key] = value;
    }
  }

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
      const item =
        fixtures.polls.find((entry) => entry.id === variables.id) ||
        (variables.id === fixtures.markets[0].pollAddress ? fixtures.polls[0] : null);
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

    if (query.includes('tradess(')) {
      const items = applyListControls(applyWhereFilter(fixtures.trades, variables.where), variables);
      return { body: { data: { tradess: asPage(items) } } };
    }

    if (query.includes('winningss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.winnings, variables.where), variables);
      return { body: { data: { winningss: asPage(items) } } };
    }

    if (query.includes('userss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.users, variables.where), variables);
      return { body: { data: { userss: asPage(items) } } };
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

async function startAnalyzeIndexerMockServer() {
  const marketAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const pollAddress = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const fixtures = {
    market: {
      id: marketAddress,
      chainId: 1,
      chainName: 'ethereum',
      pollAddress,
      creator: ADDRESSES.wallet1,
      marketType: 'amm',
      marketCloseTimestamp: '1710000000',
      totalVolume: '12345',
      currentTvl: '4567',
      createdAt: '1700000000',
    },
    poll: {
      id: pollAddress,
      chainId: 1,
      chainName: 'ethereum',
      creator: ADDRESSES.wallet1,
      question: 'Will deterministic analysis work?',
      status: 0,
      category: 3,
      deadlineEpoch: 1710000000,
      createdAt: 1700000000,
      createdTxHash: '0xhashpollanalyze',
    },
    liquidityEvents: [
      {
        id: 'analyze-liq-1',
        chainId: 1,
        chainName: 'ethereum',
        provider: ADDRESSES.wallet1,
        marketAddress,
        pollAddress,
        eventType: 'addLiquidity',
        collateralAmount: '1000',
        lpTokens: '500',
        yesTokenAmount: '610',
        noTokenAmount: '390',
        yesTokensReturned: '0',
        noTokensReturned: '0',
        txHash: '0xanalyze-liq-1',
        timestamp: 1700000100,
      },
    ],
  };

  return startJsonHttpServer(({ bodyJson }) => {
    const query = String((bodyJson && bodyJson.query) || '');
    const variables = (bodyJson && bodyJson.variables) || {};

    if (query.includes('markets(id:')) {
      return {
        body: {
          data: {
            markets: variables.id === fixtures.market.id ? fixtures.market : null,
          },
        },
      };
    }

    if (query.includes('polls(id:')) {
      return {
        body: {
          data: {
            polls: variables.id === fixtures.poll.id ? fixtures.poll : null,
          },
        },
      };
    }

    if (query.includes('liquidityEventss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.liquidityEvents, variables.where), variables);
      return { body: { data: { liquidityEventss: asPage(items) } } };
    }

    return {
      status: 400,
      body: {
        errors: [{ message: 'Unsupported query in analyze mock indexer' }],
      },
    };
  });
}

async function startPolymarketMockServer() {
  return startJsonHttpServer(() => ({
    body: {
      markets: [
        {
          question: 'Will deterministic tests pass?',
          condition_id: 'poly-cond-1',
          question_id: 'poly-q-1',
          market_slug: 'deterministic-tests-pass',
          end_date_iso: '2024-03-09T16:00:00Z',
          tokens: [
            { outcome: 'Yes', price: '0.74' },
            { outcome: 'No', price: '0.26' },
          ],
        },
      ],
    },
  }));
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

test('history returns deterministic analytics payload', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'history',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--limit',
      '10',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'history');
    assert.equal(payload.data.schemaVersion, '1.0.0');
    assert.equal(payload.data.wallet, ADDRESSES.wallet1.toLowerCase());
    assert.equal(Array.isArray(payload.data.items), true);
    assert.equal(payload.data.items.length, 2);
    assert.equal(typeof payload.data.summary.tradeCount, 'number');
  } finally {
    await indexer.close();
  }
});

test('export can materialize CSV to --out path', async () => {
  const indexer = await startIndexerMockServer();
  const tempDir = createTempDir('pandora-export-');
  const outPath = path.join(tempDir, 'history.csv');

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'export',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--format',
      'csv',
      '--out',
      outPath,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'export');
    assert.equal(payload.data.schemaVersion, '1.0.0');
    assert.equal(payload.data.format, 'csv');
    assert.equal(payload.data.outPath, outPath);
    assert.equal(fs.existsSync(outPath), true);
    const csv = fs.readFileSync(outPath, 'utf8');
    assert.match(csv, /timestamp,chain_id,wallet/);
  } finally {
    await indexer.close();
    removeDir(tempDir);
  }
});

test('arbitrage combines pandora + polymarket fixtures', async () => {
  const indexer = await startIndexerMockServer();
  const polymarket = await startPolymarketMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'arbitrage',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--venues',
      'pandora,polymarket',
      '--polymarket-mock-url',
      polymarket.url,
      '--limit',
      '10',
      '--min-spread-pct',
      '1',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'arbitrage');
    assert.equal(payload.data.schemaVersion, '1.0.0');
    assert.equal(payload.data.count >= 1, true);
    assert.equal(Array.isArray(payload.data.opportunities), true);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('autopilot once paper mode persists state and emits action', async () => {
  const tempDir = createTempDir('pandora-autopilot-');
  const stateFile = path.join(tempDir, 'state.json');
  const killFile = path.join(tempDir, 'STOP');

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'autopilot',
      'once',
      '--skip-dotenv',
      '--market-address',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--side',
      'no',
      '--amount-usdc',
      '10',
      '--trigger-yes-above',
      '50',
      '--yes-pct',
      '60',
      '--paper',
      '--state-file',
      stateFile,
      '--kill-switch-file',
      killFile,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'autopilot');
    assert.equal(payload.data.mode, 'once');
    assert.equal(payload.data.executeLive, false);
    assert.equal(payload.data.actionCount, 1);
    assert.equal(fs.existsSync(stateFile), true);
  } finally {
    removeDir(tempDir);
  }
});

test('autopilot --execute-live enforces required risk caps', () => {
  const result = runCli([
    '--output',
    'json',
    'autopilot',
    'once',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '10',
    '--trigger-yes-below',
    '20',
    '--execute-live',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.match(payload.error.message, /max-amount-usdc/);
});

test('webhook test sends generic and discord payloads', async () => {
  const generic = await startJsonHttpServer(() => ({ body: { ok: true } }));
  const discord = await startJsonHttpServer(() => ({ body: { ok: true } }));

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'webhook',
      'test',
      '--webhook-url',
      generic.url,
      '--discord-webhook-url',
      discord.url,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'webhook.test');
    assert.equal(payload.data.count, 2);
    assert.equal(payload.data.failureCount, 0);
    assert.equal(generic.requests.length, 1);
    assert.equal(discord.requests.length, 1);
  } finally {
    await generic.close();
    await discord.close();
  }
});

test('leaderboard ranks by requested metric', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'leaderboard',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--metric',
      'volume',
      '--limit',
      '2',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'leaderboard');
    assert.equal(payload.data.items.length, 2);
    assert.equal(payload.data.items[0].address.toLowerCase(), ADDRESSES.wallet2.toLowerCase());
  } finally {
    await indexer.close();
  }
});

test('leaderboard clamps inconsistent indexer totals and surfaces diagnostics', async () => {
  const indexer = await startIndexerMockServer({
    users: [
      {
        id: 'user-1',
        address: ADDRESSES.wallet1,
        chainId: 1,
        realizedPnL: '123.45',
        totalVolume: '999.5',
        totalTrades: '7',
        totalWins: '5',
        totalLosses: '2',
        totalWinnings: '500',
      },
      {
        id: 'user-invalid',
        address: '0x6666666666666666666666666666666666666666',
        chainId: 1,
        realizedPnL: '10',
        totalVolume: '100',
        totalTrades: '5',
        totalWins: '19',
        totalLosses: '0',
        totalWinnings: '50',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'leaderboard',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--metric',
      'win-rate',
      '--limit',
      '5',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'leaderboard');
    assert.equal(payload.data.schemaVersion, '1.0.1');

    const item = payload.data.items.find(
      (entry) => entry.address.toLowerCase() === '0x6666666666666666666666666666666666666666',
    );
    assert.equal(Boolean(item), true);
    assert.equal(item.totalTrades, 5);
    assert.equal(item.totalWins, 5);
    assert.equal(item.winRate, 1);
    assert.equal(item.sourceTotals.totalWins, 19);
    assert.equal(Array.isArray(item.diagnostics), true);
    assert.equal(item.diagnostics.length >= 1, true);
    assert.equal(payload.data.diagnostics.length >= 1, true);
  } finally {
    await indexer.close();
  }
});

test('analyze fails gracefully when provider is missing', async () => {
  const indexer = await startAnalyzeIndexerMockServer();
  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'analyze',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-address',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.error.code, 'ANALYZE_PROVIDER_NOT_CONFIGURED');
  } finally {
    await indexer.close();
  }
});

test('analyze supports mock provider output', async () => {
  const indexer = await startAnalyzeIndexerMockServer();
  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'analyze',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-address',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--provider',
      'mock',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'analyze');
    assert.equal(payload.data.provider, 'mock');
    assert.equal(typeof payload.data.result.fairYesPct, 'number');
  } finally {
    await indexer.close();
  }
});

test('suggest returns deterministic envelope', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'suggest',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--risk',
      'medium',
      '--budget',
      '50',
      '--include-venues',
      'pandora',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'suggest');
    assert.equal(payload.data.wallet, ADDRESSES.wallet1.toLowerCase());
    assert.equal(payload.data.risk, 'medium');
    assert.equal(Array.isArray(payload.data.items), true);
  } finally {
    await indexer.close();
  }
});

test('resolve and lp are ABI-gated', () => {
  const resolveResult = runCli([
    '--output',
    'json',
    'resolve',
    '--poll-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--answer',
    'yes',
    '--reason',
    'fixture',
    '--dry-run',
  ]);
  assert.equal(resolveResult.status, 1);
  const resolvePayload = parseJsonOutput(resolveResult);
  assert.equal(resolvePayload.error.code, 'ABI_READY_REQUIRED');

  const lpResult = runCli([
    '--output',
    'json',
    'lp',
    'positions',
    '--wallet',
    ADDRESSES.wallet1,
  ]);
  assert.equal(lpResult.status, 1);
  const lpPayload = parseJsonOutput(lpResult);
  assert.equal(lpPayload.error.code, 'ABI_READY_REQUIRED');
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
