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
  mirrorMarket: '0x6666666666666666666666666666666666666666',
  mirrorPoll: '0x7777777777777777777777777777777777777777',
};

const POLYMARKET_DEFAULTS = {
  usdc: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
  ctf: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045',
  funder: '0x8888888888888888888888888888888888888888',
  spenders: {
    exchange: '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
    negRiskExchange: '0xc5d563a36ae78145c45a50134d48a1215220f80a',
    negRiskAdapter: '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296',
  },
};

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function parseJsonOutput(result) {
  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  const payloadText = stdout || String(result.output || '').trim();
  assert.match(payloadText, /\{/);
  return JSON.parse(payloadText);
}

function parseNdjsonOutput(output) {
  const text = String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return text.map((line) => JSON.parse(line));
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
const FIXED_MIRROR_CLOSE_ISO = '2030-03-09T16:00:00Z';
const FIXED_MIRROR_CLOSE_TS = String(Math.floor(Date.parse(FIXED_MIRROR_CLOSE_ISO) / 1000));

function buildMirrorIndexerOverrides(overrides = {}) {
  const base = {
    markets: [
      {
        id: ADDRESSES.mirrorMarket,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: ADDRESSES.mirrorPoll,
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: FIXED_MIRROR_CLOSE_TS,
        totalVolume: '100000',
        currentTvl: '200000',
        yesChance: '0.55',
        reserveYes: '500000000',
        reserveNo: '500000000',
        createdAt: '1700000000',
      },
    ],
    polls: [
      {
        id: ADDRESSES.mirrorPoll,
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Will deterministic tests pass?',
        status: 0,
        category: 3,
        deadlineEpoch: Number(FIXED_MIRROR_CLOSE_TS),
        createdAt: 1700000000,
        createdTxHash: '0xhashpollmirror',
        rules:
          'Resolves YES if deterministic tests pass in CI. Resolves NO otherwise; canceled/postponed/abandoned/unresolved => NO.',
        sources: '["https://github.com","https://ci.example.com"]',
      },
    ],
  };

  return {
    markets: Array.isArray(overrides.markets) ? overrides.markets : base.markets,
    polls: Array.isArray(overrides.polls) ? overrides.polls : base.polls,
  };
}

function buildMirrorPolymarketOverrides() {
  return {
    markets: [
      {
        question: 'Will deterministic tests pass?',
        description:
          'Resolves YES if deterministic tests pass in CI. Resolves NO otherwise; canceled/postponed/abandoned/unresolved => NO.',
        condition_id: 'poly-cond-1',
        question_id: 'poly-q-1',
        market_slug: 'deterministic-tests-pass',
        end_date_iso: FIXED_MIRROR_CLOSE_ISO,
        active: true,
        closed: false,
        volume24hr: 100000,
        tokens: [
          { outcome: 'Yes', price: '0.74', token_id: 'poly-yes-1' },
          { outcome: 'No', price: '0.26', token_id: 'poly-no-1' },
        ],
      },
    ],
  };
}

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

function encodeUint256(value) {
  const normalized = BigInt(value || 0);
  return `0x${normalized.toString(16).padStart(64, '0')}`;
}

function encodeBool(value) {
  return value ? `0x${'0'.repeat(63)}1` : `0x${'0'.repeat(64)}`;
}

function decodeAddressFromCallData(data, index) {
  const raw = String(data || '').toLowerCase().replace(/^0x/, '');
  const start = 8 + index * 64 + 24;
  return `0x${raw.slice(start, start + 40)}`;
}

async function startPolymarketOpsRpcMock(options = {}) {
  const funder = String(options.funder || POLYMARKET_DEFAULTS.funder).toLowerCase();
  const usdc = String(options.usdc || POLYMARKET_DEFAULTS.usdc).toLowerCase();
  const ctf = String(options.ctf || POLYMARKET_DEFAULTS.ctf).toLowerCase();
  const chainIdHex = options.chainIdHex || '0x89';
  const safeOwner = options.safeOwner !== false;
  const usdcBalanceRaw = BigInt(options.usdcBalanceRaw || 0n);

  const allowanceBySpender = {};
  for (const [key, address] of Object.entries(POLYMARKET_DEFAULTS.spenders)) {
    const configured = options.allowanceBySpender && Object.prototype.hasOwnProperty.call(options.allowanceBySpender, key)
      ? options.allowanceBySpender[key]
      : 0n;
    allowanceBySpender[String(address).toLowerCase()] = BigInt(configured || 0n);
  }

  const operatorBySpender = {};
  for (const [key, address] of Object.entries(POLYMARKET_DEFAULTS.spenders)) {
    const configured = options.operatorBySpender && Object.prototype.hasOwnProperty.call(options.operatorBySpender, key)
      ? options.operatorBySpender[key]
      : false;
    operatorBySpender[String(address).toLowerCase()] = Boolean(configured);
  }

  return startJsonHttpServer(({ bodyJson }) => {
    const requests = Array.isArray(bodyJson) ? bodyJson : [bodyJson];
    const responses = requests.map((request, index) => {
      const id = request && request.id !== undefined ? request.id : index + 1;
      if (!request || typeof request !== 'object') {
        return {
          jsonrpc: '2.0',
          id,
          error: { message: 'Invalid JSON-RPC payload' },
        };
      }

      if (request.method === 'eth_chainId') {
        return { jsonrpc: '2.0', id, result: chainIdHex };
      }

      if (request.method === 'eth_getCode') {
        const address = String((request.params && request.params[0]) || '').toLowerCase();
        return {
          jsonrpc: '2.0',
          id,
          result: address === funder ? '0x6001600101' : '0x',
        };
      }

      if (request.method === 'eth_call') {
        const tx = request.params && request.params[0] ? request.params[0] : {};
        const target = String(tx.to || '').toLowerCase();
        const data = String(tx.data || '').toLowerCase();
        const selector = data.slice(0, 10);

        if (target === usdc && selector === '0x70a08231') {
          return { jsonrpc: '2.0', id, result: encodeUint256(usdcBalanceRaw) };
        }
        if (target === usdc && selector === '0xdd62ed3e') {
          const spender = decodeAddressFromCallData(data, 1);
          const allowance = Object.prototype.hasOwnProperty.call(allowanceBySpender, spender)
            ? allowanceBySpender[spender]
            : 0n;
          return { jsonrpc: '2.0', id, result: encodeUint256(allowance) };
        }
        if (target === ctf && selector === '0xe985e9c5') {
          const spender = decodeAddressFromCallData(data, 1);
          const approved = Object.prototype.hasOwnProperty.call(operatorBySpender, spender)
            ? operatorBySpender[spender]
            : false;
          return { jsonrpc: '2.0', id, result: encodeBool(approved) };
        }
        if (target === funder && selector === '0x2f54bf6e') {
          return { jsonrpc: '2.0', id, result: encodeBool(safeOwner) };
        }

        return {
          jsonrpc: '2.0',
          id,
          error: { message: `Unsupported eth_call target/selector ${target} ${selector}` },
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: { message: `Unsupported method ${request.method}` },
      };
    });

    return {
      body: Array.isArray(bodyJson) ? responses : responses[0],
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

async function startPolymarketMockServer(overrides = {}) {
  const basePayload = {
    markets: [
      {
        question: 'Will deterministic tests pass?',
        condition_id: 'poly-cond-1',
        question_id: 'poly-q-1',
        market_slug: 'deterministic-tests-pass',
        end_date_iso: '2024-03-09T16:00:00Z',
        active: true,
        closed: false,
        volume24hr: 100000,
        tokens: [
          { outcome: 'Yes', price: '0.74', token_id: 'poly-yes-1' },
          { outcome: 'No', price: '0.26', token_id: 'poly-no-1' },
        ],
      },
    ],
    orderbooks: {
      'poly-yes-1': {
        bids: [{ price: '0.73', size: '500' }],
        asks: [{ price: '0.74', size: '600' }],
      },
      'poly-no-1': {
        bids: [{ price: '0.25', size: '500' }],
        asks: [{ price: '0.26', size: '600' }],
      },
    },
  };

  const payload = {
    ...basePayload,
    ...overrides,
    markets: Array.isArray(overrides.markets) ? overrides.markets : basePayload.markets,
    orderbooks: overrides.orderbooks || basePayload.orderbooks,
  };

  return startJsonHttpServer(() => ({
    body: payload,
  }));
}

test('help prints usage with zero exit code', () => {
  const result = runCli([]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.output, /pandora - Prediction market CLI/);
  assert.match(result.output, /Usage:/);
});

test('help accepts optional leading pandora token for npx compatibility', () => {
  const result = runCli(['pandora', '--help']);
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

test('json error envelopes are emitted on stdout (not stderr)', () => {
  const result = runCli(['--output', 'json', 'not-a-command']);
  assert.equal(result.status, 1);
  assert.equal(String(result.stderr || '').trim(), '');
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'UNKNOWN_COMMAND');
});

test('invalid --output mode returns json error envelope', () => {
  const result = runCli(['--output', 'xml', 'help']);
  assert.equal(result.status, 1);
  assert.equal(String(result.stderr || '').trim(), '');
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_OUTPUT_MODE');
});

test('missing --output value returns json error envelope', () => {
  const result = runCli(['--output']);
  assert.equal(result.status, 1);
  assert.equal(String(result.stderr || '').trim(), '');
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'MISSING_FLAG_VALUE');
});

test('private key parse errors redact the provided key value', () => {
  const badPrivateKey = '0x1234';
  const result = runCli(['--output', 'json', 'mirror', 'deploy', '--private-key', badPrivateKey]);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /\[redacted\]/);
  assert.ok(!payload.error.message.includes(badPrivateKey));
});

test('unknown command prints help hint in table mode', () => {
  const result = runCli(['not-a-command']);
  assert.equal(result.status, 1);
  assert.match(result.output, /\[UNKNOWN_COMMAND\]/);
  assert.match(result.output, /Unknown command: not-a-command/);
  assert.match(result.output, /Run `pandora help` to see available commands\./);
});

test('schema command requires --output json mode', () => {
  const result = runCli(['schema']);
  assert.equal(result.status, 1);
  assert.match(result.output, /\[INVALID_USAGE\]/);
  assert.match(result.output, /only supported in --output json mode/i);
});

test('schema --help succeeds in table mode', () => {
  const result = runCli(['schema', '--help']);
  assert.equal(result.status, 0);
  assert.match(String(result.stdout || ''), /Usage:\s+pandora --output json schema/);
});

test('schema command returns envelope schema plus command descriptors', () => {
  const result = runCli(['--output', 'json', 'schema']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'schema');

  assert.equal(payload.data.title, 'PandoraCliEnvelope');
  assert.ok(String(payload.data.$schema).includes('json-schema.org'));
  assert.ok(payload.data.definitions && payload.data.definitions.SuccessEnvelope);
  assert.ok(payload.data.definitions && payload.data.definitions.ErrorEnvelope);

  assert.equal(payload.data.commandDescriptorVersion, '1.0.0');
  assert.ok(payload.data.commandDescriptors);
  assert.ok(payload.data.commandDescriptors.quote);
  assert.equal(payload.data.commandDescriptors.quote.dataSchema, '#/definitions/QuotePayload');
  assert.ok(payload.data.commandDescriptors.quote.emits.includes('quote'));
  assert.ok(payload.data.commandDescriptors.trade);
  assert.equal(payload.data.commandDescriptors.trade.dataSchema, '#/definitions/TradePayload');
  assert.ok(payload.data.commandDescriptors['mirror.plan']);
  assert.equal(payload.data.commandDescriptors['mirror.plan'].dataSchema, '#/definitions/MirrorPlanPayload');
  assert.ok(payload.data.commandDescriptors['risk.show']);
  assert.equal(payload.data.commandDescriptors['risk.show'].dataSchema, '#/definitions/RiskPayload');
  assert.ok(payload.data.commandDescriptors['risk.panic']);
  assert.equal(payload.data.commandDescriptors['risk.panic'].dataSchema, '#/definitions/RiskPayload');
  assert.ok(payload.data.commandDescriptors.lifecycle);
  assert.equal(payload.data.commandDescriptors.lifecycle.dataSchema, '#/definitions/LifecyclePayload');
  assert.ok(payload.data.commandDescriptors['odds.record']);
  assert.equal(payload.data.commandDescriptors['odds.record'].dataSchema, '#/definitions/OddsRecordPayload');
  assert.ok(payload.data.commandDescriptors['odds.history']);
  assert.equal(payload.data.commandDescriptors['odds.history'].dataSchema, '#/definitions/OddsHistoryPayload');
  assert.ok(payload.data.commandDescriptors.portfolio);
  assert.equal(payload.data.commandDescriptors.portfolio.dataSchema, '#/definitions/PortfolioPayload');
  assert.ok(payload.data.commandDescriptors.export);
  assert.equal(payload.data.commandDescriptors.export.dataSchema, '#/definitions/ExportPayload');
  assert.ok(payload.data.commandDescriptors['arb.scan']);
  assert.equal(payload.data.commandDescriptors['arb.scan'].dataSchema, '#/definitions/ArbScanPayload');
  assert.match(payload.data.commandDescriptors['arb.scan'].usage, /--combinatorial/);
  assert.match(payload.data.commandDescriptors['arb.scan'].usage, /--slippage-pct-per-leg/);
  assert.ok(payload.data.commandDescriptors['simulate.mc']);
  assert.equal(payload.data.commandDescriptors['simulate.mc'].dataSchema, '#/definitions/SimulateMcPayload');
  assert.ok(payload.data.commandDescriptors['simulate.particle-filter']);
  assert.equal(
    payload.data.commandDescriptors['simulate.particle-filter'].dataSchema,
    '#/definitions/SimulateParticleFilterPayload',
  );
  assert.ok(payload.data.commandDescriptors['simulate.agents']);
  assert.equal(payload.data.commandDescriptors['simulate.agents'].dataSchema, '#/definitions/SimulateAgentsPayload');
  assert.ok(payload.data.commandDescriptors['model.score.brier']);
  assert.equal(payload.data.commandDescriptors['model.score.brier'].dataSchema, '#/definitions/ModelScoreBrierPayload');
  assert.ok(payload.data.commandDescriptors['model.calibrate']);
  assert.equal(payload.data.commandDescriptors['model.calibrate'].dataSchema, '#/definitions/ModelCalibratePayload');
  assert.ok(payload.data.commandDescriptors['model.correlation']);
  assert.equal(payload.data.commandDescriptors['model.correlation'].dataSchema, '#/definitions/ModelCorrelationPayload');
  assert.ok(payload.data.commandDescriptors['model.diagnose']);
  assert.equal(payload.data.commandDescriptors['model.diagnose'].dataSchema, '#/definitions/ModelDiagnosePayload');
  assert.ok(payload.data.commandDescriptors.schema);
  assert.deepEqual(payload.data.commandDescriptors.schema.outputModes, ['json']);
  assert.ok(payload.data.commandDescriptors.mcp);
  assert.deepEqual(payload.data.commandDescriptors.mcp.outputModes, ['table']);
  assert.equal(payload.data.descriptorScope, 'curated-core');
  assert.ok(payload.data.definitions.QuotePayload);
  assert.ok(payload.data.definitions.TradePayload);
  assert.ok(payload.data.definitions.MirrorPlanPayload);
  assert.ok(payload.data.definitions.RiskPayload);
  assert.ok(payload.data.definitions.LifecyclePayload);
  assert.ok(payload.data.definitions.OddsRecordPayload);
  assert.ok(payload.data.definitions.OddsHistoryPayload);
  assert.ok(payload.data.definitions.PortfolioPayload);
  assert.ok(payload.data.definitions.ExportPayload);
  assert.ok(payload.data.definitions.ArbScanPayload);
  assert.ok(payload.data.definitions.SimulateMcPayload);
  assert.ok(payload.data.definitions.SimulateParticleFilterPayload);
  assert.ok(payload.data.definitions.SimulateAgentsPayload);
  assert.ok(payload.data.definitions.ModelScoreBrierPayload);
  assert.ok(payload.data.definitions.ModelCalibratePayload);
  assert.ok(payload.data.definitions.ModelCorrelationPayload);
  assert.ok(payload.data.definitions.ModelDiagnosePayload);
  assert.ok(payload.data.definitions.ErrorRecoveryPayload);
});

test('schema command rejects unknown trailing flags', () => {
  const result = runCli(['--output', 'json', 'schema', '--bad-flag']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_ARGS');
});

test('mcp command rejects --output json mode with stable CLI error', () => {
  const result = runCli(['--output', 'json', 'mcp']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'UNSUPPORTED_OUTPUT_MODE');
});

test('json success envelopes include schemaVersion and generatedAt metadata', () => {
  const result = runCli(['--output', 'json', 'quote', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(typeof payload.data.schemaVersion, 'string');
  assertIsoTimestamp(payload.data.generatedAt);
});

test('risk show and panic commands manage state in json envelopes', () => {
  const tempHome = createTempDir('pandora-risk-cli-');
  try {
    const env = { HOME: tempHome, PANDORA_RISK_FILE: path.join(tempHome, 'risk.json') };

    const showInitial = runCli(['--output', 'json', 'risk', 'show'], { env });
    assert.equal(showInitial.status, 0);
    const showInitialPayload = parseJsonOutput(showInitial);
    assert.equal(showInitialPayload.ok, true);
    assert.equal(showInitialPayload.command, 'risk.show');
    assert.equal(showInitialPayload.data.panic.active, false);

    const engage = runCli(['--output', 'json', 'risk', 'panic', '--reason', 'incident test'], { env });
    assert.equal(engage.status, 0);
    const engagePayload = parseJsonOutput(engage);
    assert.equal(engagePayload.ok, true);
    assert.equal(engagePayload.command, 'risk.panic');
    assert.equal(engagePayload.data.action, 'engage');
    assert.equal(engagePayload.data.panic.active, true);
    assert.equal(Array.isArray(engagePayload.data.stopFiles), true);
    assert.equal(engagePayload.data.stopFiles.length, 0);

    const showAfter = runCli(['--output', 'json', 'risk', 'show'], { env });
    assert.equal(showAfter.status, 0);
    const showAfterPayload = parseJsonOutput(showAfter);
    assert.equal(showAfterPayload.data.panic.active, true);

    const clear = runCli(['--output', 'json', 'risk', 'panic', '--clear'], { env });
    assert.equal(clear.status, 0);
    const clearPayload = parseJsonOutput(clear);
    assert.equal(clearPayload.ok, true);
    assert.equal(clearPayload.command, 'risk.panic');
    assert.equal(clearPayload.data.action, 'clear');
    assert.equal(clearPayload.data.panic.active, false);
  } finally {
    removeDir(tempHome);
  }
});

test('risk panic blocks live writes before onchain execution', () => {
  const tempHome = createTempDir('pandora-risk-block-live-');
  const env = { HOME: tempHome, PANDORA_RISK_FILE: path.join(tempHome, 'risk.json') };
  try {
    const panic = runCli(['--output', 'json', 'risk', 'panic', '--reason', 'block all'], { env });
    assert.equal(panic.status, 0);

    const blocked = runCli([
      '--output', 'json', 'resolve',
      '--poll-address', ADDRESSES.mirrorPoll,
      '--answer', 'yes',
      '--reason', 'manual resolve',
      '--execute',
    ], { env });
    assert.equal(blocked.status, 1);
    const payload = parseJsonOutput(blocked);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'RISK_PANIC_ACTIVE');
  } finally {
    removeDir(tempHome);
  }
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

test('setup --help returns structured JSON help payload', () => {
  const result = runCli(['--output', 'json', 'setup', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.command, 'setup.help');
  assert.match(payload.data.usage, /^pandora .* setup /);
  assert.equal(payload.data.schemaVersion, '1.0.0');
  assertIsoTimestamp(payload.data.generatedAt);
});

test('init-env writes env files with 0600 permissions (non-Windows)', () => {
  const tempDir = createTempDir('pandora-init-env-mode-');
  const examplePath = path.join(tempDir, 'example.env');
  const envPath = path.join(tempDir, 'generated.env');
  writeFile(examplePath, 'CHAIN_ID=1\n');

  const result = runCli([
    '--output',
    'json',
    'init-env',
    '--example',
    examplePath,
    '--dotenv-path',
    envPath,
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(fs.existsSync(envPath), true);
  if (process.platform !== 'win32') {
    const mode = fs.statSync(envPath).mode & 0o777;
    assert.equal(mode, 0o600);
  }

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

test('scan --help returns structured help instead of parser errors', () => {
  const result = runCli(['--output', 'json', 'scan', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'scan.help');
  assert.match(payload.data.usage, /scan/);
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
    assert.equal(typeof first.totalVolume, 'number');
    assert.equal(typeof first.currentTvl, 'number');
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
    assert.equal(typeof first.totalVolume, 'number');
    assert.equal(typeof first.currentTvl, 'number');
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
    assert.equal(payload.data.summary.totalDeposited, 1000);
    assert.equal(payload.data.summary.totalNetDelta, 1000);
    assert.equal(payload.data.summary.totalUnrealizedPnl, null);
    assert.equal(payload.data.summary.totalsPolicy.eventDerivedTotalsWhenEventsDisabled, null);
    assert.equal(payload.data.summary.totalsPolicy.eventDerivedTotalsDefaultWhenNoRows, 0);
    assert.equal(payload.data.summary.totalsPolicy.unrealizedRequiresLp, true);
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
    assert.equal(payload.data.summary.totalDeposited, null);
    assert.equal(payload.data.summary.totalNetDelta, null);
    assert.equal(payload.data.summary.totalUnrealizedPnl, null);
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
    assert.match(csv, /,date,market,action,amount,price,gas_usd,realized_pnl/);
    assert.match(csv, /0xtrade1/);
    assert.equal(Array.isArray(payload.data.rows), true);
    assert.equal(payload.data.rows.length > 0, true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'date'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'market'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'action'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'amount'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'price'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'gas_usd'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'realized_pnl'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'tx_hash'), true);
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
    assert.equal(payload.data.schemaVersion, '1.1.0');
    assert.equal(payload.data.parameters.crossVenueOnly, true);
    assert.equal(payload.data.count >= 1, true);
    assert.equal(Array.isArray(payload.data.opportunities), true);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('arbitrage defaults to cross-venue-only and allows same-venue override', async () => {
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: 'market-dup-1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-dup-1',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '12345',
        currentTvl: '4567000000',
        yesChance: '0.80',
        reserveYes: '80',
        reserveNo: '20',
        createdAt: '1700000001',
      },
      {
        id: 'market-dup-2',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-dup-2',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        marketType: 'amm',
        marketCloseTimestamp: '1710001000',
        totalVolume: '22345',
        currentTvl: '5567000000',
        yesChance: '0.55',
        reserveYes: '55',
        reserveNo: '45',
        createdAt: '1700000002',
      },
    ],
    polls: [
      {
        id: 'poll-dup-1',
        chainId: 1,
        chainName: 'ethereum',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        question: 'Will Arsenal win Premier League 2026?',
        status: 1,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpoll-dup-1',
      },
      {
        id: 'poll-dup-2',
        chainId: 1,
        chainName: 'ethereum',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        question: 'Will Arsenal FC win the Premier League in 2026?',
        status: 1,
        category: 3,
        deadlineEpoch: 1710001000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpoll-dup-2',
      },
    ],
  });

  try {
    const crossVenueOnly = await runCliAsync([
      '--output',
      'json',
      'arbitrage',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--venues',
      'pandora',
      '--limit',
      '10',
      '--min-spread-pct',
      '1',
      '--similarity-threshold',
      '0.5',
    ]);

    assert.equal(crossVenueOnly.status, 0);
    const crossPayload = parseJsonOutput(crossVenueOnly);
    assert.equal(crossPayload.data.parameters.crossVenueOnly, true);
    assert.equal(crossPayload.data.count, 0);

    const allowSameVenue = await runCliAsync([
      '--output',
      'json',
      'arbitrage',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--venues',
      'pandora',
      '--limit',
      '10',
      '--min-spread-pct',
      '1',
      '--similarity-threshold',
      '0.5',
      '--allow-same-venue',
    ]);

    assert.equal(allowSameVenue.status, 0);
    const sameVenuePayload = parseJsonOutput(allowSameVenue);
    assert.equal(sameVenuePayload.data.parameters.crossVenueOnly, false);
    assert.equal(sameVenuePayload.data.count >= 1, true);
    assert.equal(Array.isArray(sameVenuePayload.data.opportunities[0].venues), true);
    assert.deepEqual(sameVenuePayload.data.opportunities[0].venues, ['pandora']);
  } finally {
    await indexer.close();
  }
});

test('arbitrage exposes rules and similarity checks for agent verification', async () => {
  const indexer = await startIndexerMockServer({
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
        rules:
          'Resolves YES if deterministic tests pass in CI. Resolves NO if they fail. Unresolved or cancelled resolves NO.',
        sources: '["https://github.com","https://ci.example.com"]',
      },
    ],
  });
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
      '--with-rules',
      '--include-similarity',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'arbitrage');
    assert.equal(payload.data.parameters.withRules, true);
    assert.equal(payload.data.parameters.includeSimilarity, true);
    assert.equal(payload.data.count >= 1, true);

    const opportunity = payload.data.opportunities[0];
    assert.equal(Array.isArray(opportunity.similarityChecks), true);
    assert.equal(opportunity.similarityChecks.length >= 1, true);
    assert.equal(opportunity.similarityChecks.some((entry) => entry.accepted === true), true);
    const pandoraLeg = opportunity.legs.find((leg) => leg.venue === 'pandora');
    assert.equal(Boolean(pandoraLeg), true);
    assert.equal(typeof pandoraLeg.rules, 'string');
    assert.equal(Array.isArray(pandoraLeg.sources), true);
    assert.equal(pandoraLeg.sources.length, 2);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('lifecycle start/status/resolve persists state and requires explicit confirm', () => {
  const tempDir = createTempDir('pandora-lifecycle-');
  const lifecycleDir = path.join(tempDir, 'lifecycles');
  const configPath = path.join(tempDir, 'lifecycle.json');
  writeFile(
    configPath,
    JSON.stringify({
      id: 'phase-e2e-1',
      source: 'integration-test',
      marketId: 'market-1',
    }),
  );

  const env = {
    HOME: tempDir,
    PANDORA_LIFECYCLE_DIR: lifecycleDir,
  };

  try {
    const start = runCli(
      ['--output', 'json', 'lifecycle', 'start', '--config', configPath],
      { env },
    );
    assert.equal(start.status, 0);
    const startPayload = parseJsonOutput(start);
    assert.equal(startPayload.command, 'lifecycle.start');
    assert.equal(startPayload.data.id, 'phase-e2e-1');
    assert.equal(startPayload.data.phase, 'AWAITING_RESOLVE');
    const lifecycleFile = path.join(lifecycleDir, 'phase-e2e-1.json');
    assert.equal(fs.existsSync(lifecycleFile), true);
    if (process.platform !== 'win32') {
      const mode = fs.statSync(lifecycleFile).mode & 0o777;
      assert.equal(mode, 0o600);
    }

    const status = runCli(
      ['--output', 'json', 'lifecycle', 'status', '--id', 'phase-e2e-1'],
      { env },
    );
    assert.equal(status.status, 0);
    const statusPayload = parseJsonOutput(status);
    assert.equal(statusPayload.command, 'lifecycle.status');
    assert.equal(statusPayload.data.phase, 'AWAITING_RESOLVE');

    const missingConfirm = runCli(
      ['--output', 'json', 'lifecycle', 'resolve', '--id', 'phase-e2e-1'],
      { env },
    );
    assert.equal(missingConfirm.status, 1);
    const missingConfirmPayload = parseJsonOutput(missingConfirm);
    assert.equal(missingConfirmPayload.error.code, 'MISSING_REQUIRED_FLAG');

    const resolve = runCli(
      ['--output', 'json', 'lifecycle', 'resolve', '--id', 'phase-e2e-1', '--confirm'],
      { env },
    );
    assert.equal(resolve.status, 0);
    const resolvePayload = parseJsonOutput(resolve);
    assert.equal(resolvePayload.command, 'lifecycle.resolve');
    assert.equal(resolvePayload.data.phase, 'RESOLVED');
    assert.equal(resolvePayload.data.changed, true);

    const resolvedStatus = runCli(
      ['--output', 'json', 'lifecycle', 'status', '--id', 'phase-e2e-1'],
      { env },
    );
    assert.equal(resolvedStatus.status, 0);
    const resolvedStatusPayload = parseJsonOutput(resolvedStatus);
    assert.equal(resolvedStatusPayload.data.phase, 'RESOLVED');
    assert.equal(typeof resolvedStatusPayload.data.resolvedAt, 'string');
  } finally {
    removeDir(tempDir);
  }
});

test('odds record rejects insecure non-local indexer urls', () => {
  const result = runCli([
    '--output',
    'json',
    'odds',
    'record',
    '--indexer-url',
    'http://example.com',
  ]);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_INDEXER_URL');
});

test('odds record rejects insecure polymarket host urls', () => {
  const result = runCli([
    '--output',
    'json',
    'odds',
    'record',
    '--competition',
    'soccer_epl',
    '--interval',
    '60',
    '--polymarket-host',
    'http://example.com',
  ]);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /--polymarket-host must use https/i);
});

test('arb scan emits ndjson opportunities when net spread threshold is exceeded', async () => {
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: 'arb-m1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-1',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.40',
        reserveYes: '400',
        reserveNo: '600',
        createdAt: '1700000000',
      },
      {
        id: 'arb-m2',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-2',
        creator: ADDRESSES.wallet2,
        marketType: 'amm',
        marketCloseTimestamp: '1710000001',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.60',
        reserveYes: '600',
        reserveNo: '400',
        createdAt: '1700000001',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      'arb',
      'scan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--markets',
      'arb-m1,arb-m2',
      '--output',
      'ndjson',
      '--min-net-spread-pct',
      '10',
      '--fee-pct-per-leg',
      '0.5',
      '--amount-usdc',
      '100',
      '--iterations',
      '1',
      '--interval-ms',
      '1',
    ]);

    assert.equal(result.status, 0);
    const lines = parseNdjsonOutput(result.stdout);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].type, 'arb.scan.opportunity');
    assert.equal(lines[0].buyYesMarket, 'arb-m1');
    assert.equal(lines[0].buyNoMarket, 'arb-m2');
    assert.equal(lines[0].netSpreadPct, 19);
    assert.equal(lines[0].netSpread, 0.19);
    assert.equal(lines[0].profitUsdc, 19);
    assert.equal(lines[0].profit, 19);
  } finally {
    await indexer.close();
  }
});

test('arb scan supports bounded JSON envelope output for agent integrations', async () => {
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: 'arb-json-1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-json-1',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710001000',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.40',
        reserveYes: '400',
        reserveNo: '600',
        createdAt: '1700001000',
      },
      {
        id: 'arb-json-2',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-json-2',
        creator: ADDRESSES.wallet2,
        marketType: 'amm',
        marketCloseTimestamp: '1710001001',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.61',
        reserveYes: '610',
        reserveNo: '390',
        createdAt: '1700001001',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'arb',
      'scan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--markets',
      'arb-json-1,arb-json-2',
      '--output',
      'json',
      '--iterations',
      '1',
      '--min-net-spread-pct',
      '5',
      '--fee-pct-per-leg',
      '0.5',
      '--amount-usdc',
      '100',
    ]);

    assert.equal(result.status, 0, result.output);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'arb.scan');
    assert.equal(payload.data.iterationsCompleted, 1);
    assert.equal(Array.isArray(payload.data.opportunities), true);
    assert.equal(typeof payload.data.opportunities.length, 'number');
  } finally {
    await indexer.close();
  }
});

test('arb scan --combinatorial emits bundle opportunities with fee/slippage-adjusted net edge', async () => {
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: 'arb-combo-1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-combo-1',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710001100',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.20',
        reserveYes: '200',
        reserveNo: '800',
        createdAt: '1700001100',
      },
      {
        id: 'arb-combo-2',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-combo-2',
        creator: ADDRESSES.wallet2,
        marketType: 'amm',
        marketCloseTimestamp: '1710001101',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.25',
        reserveYes: '250',
        reserveNo: '750',
        createdAt: '1700001101',
      },
      {
        id: 'arb-combo-3',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-combo-3',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710001102',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.30',
        reserveYes: '300',
        reserveNo: '700',
        createdAt: '1700001102',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      'arb',
      'scan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--markets',
      'arb-combo-1,arb-combo-2,arb-combo-3',
      '--output',
      'ndjson',
      '--combinatorial',
      '--max-bundle-size',
      '3',
      '--min-net-spread-pct',
      '10',
      '--fee-pct-per-leg',
      '0.5',
      '--slippage-pct-per-leg',
      '0.25',
      '--amount-usdc',
      '100',
      '--iterations',
      '1',
      '--interval-ms',
      '1',
    ]);

    assert.equal(result.status, 0);
    const lines = parseNdjsonOutput(result.stdout);
    const combo = lines.find(
      (row) =>
        row &&
        row.opportunityType === 'combinatorial' &&
        row.strategy === 'buy_yes_bundle' &&
        Array.isArray(row.bundleMarketIds) &&
        row.bundleMarketIds.length === 3,
    );

    assert.ok(combo);
    assert.equal(combo.grossEdgePct, 25);
    assert.equal(combo.feeImpactPct, 1.5);
    assert.equal(combo.slippageImpactPct, 0.75);
    assert.equal(combo.netSpreadPct, 22.75);
    assert.equal(combo.profitUsdc, 22.75);
  } finally {
    await indexer.close();
  }
});

test('arb scan is silent when no opportunities clear the threshold', async () => {
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: 'arb-quiet-1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-quiet-1',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.47',
        reserveYes: '470',
        reserveNo: '530',
        createdAt: '1700000000',
      },
      {
        id: 'arb-quiet-2',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-quiet-2',
        creator: ADDRESSES.wallet2,
        marketType: 'amm',
        marketCloseTimestamp: '1710000001',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.52',
        reserveYes: '520',
        reserveNo: '480',
        createdAt: '1700000001',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      'arb',
      'scan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--markets',
      'arb-quiet-1,arb-quiet-2',
      '--output',
      'ndjson',
      '--min-net-spread-pct',
      '8',
      '--fee-pct-per-leg',
      '0.5',
      '--amount-usdc',
      '100',
      '--iterations',
      '1',
      '--interval-ms',
      '1',
    ]);

    assert.equal(result.status, 0);
    assert.equal(String(result.stdout || '').trim(), '');
  } finally {
    await indexer.close();
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

test('mirror plan returns deterministic sizing and distribution payload', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'plan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--with-rules',
      '--include-similarity',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.plan');
    assert.equal(payload.data.schemaVersion, '1.0.0');
    assert.equal(payload.data.sourceMarket.marketId, 'poly-cond-1');
    assert.equal(typeof payload.data.liquidityRecommendation.liquidityUsdc, 'number');
    assert.equal(payload.data.distributionHint.distributionYes + payload.data.distributionHint.distributionNo, 1000000000);
    assert.equal(Array.isArray(payload.data.similarityChecks), true);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror verify exposes confidence, rules hashes, and gate result for agent checks', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'verify',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--include-similarity',
      '--with-rules',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.verify');
    assert.equal(typeof payload.data.matchConfidence, 'number');
    assert.equal(payload.data.gateResult.ok, true);
    assert.equal(typeof payload.data.ruleHashLeft, 'string');
    assert.equal(typeof payload.data.ruleHashRight, 'string');
    assert.equal(Array.isArray(payload.data.similarityChecks), true);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror verify blocks strict rule gate when one side lacks rule text', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer({
    ...buildMirrorPolymarketOverrides(),
    markets: [
      {
        ...buildMirrorPolymarketOverrides().markets[0],
        description: '',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'verify',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--with-rules',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.verify');
    assert.equal(payload.data.gateResult.ok, false);
    assert.equal(payload.data.gateResult.failedChecks.includes('RULE_HASH_MATCH'), true);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror verify falls back to cached Polymarket snapshot when endpoint is unreachable', async () => {
  const tempDir = createTempDir('pandora-mirror-cache-');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const warmResult = await runCliAsync(
      [
        '--output',
        'json',
        'mirror',
        'verify',
        '--skip-dotenv',
        '--indexer-url',
        indexer.url,
        '--polymarket-mock-url',
        polymarket.url,
        '--pandora-market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
      ],
      { env: { HOME: tempDir } },
    );
    assert.equal(warmResult.status, 0);

    const cachedResult = await runCliAsync(
      [
        '--output',
        'json',
        'mirror',
        'verify',
        '--skip-dotenv',
        '--indexer-url',
        indexer.url,
        '--polymarket-mock-url',
        'http://127.0.0.1:9/unreachable',
        '--pandora-market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(cachedResult.status, 0);
    const payload = parseJsonOutput(cachedResult);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.verify');
    assert.equal(payload.data.sourceMarket.source, 'polymarket:cache');
    assert.equal(
      payload.data.sourceMarket.diagnostics.some((line) => String(line).toLowerCase().includes('cached polymarket')),
      true,
    );
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror lp-explain returns complete-set inventory walkthrough payload', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'lp-explain',
    '--liquidity-usdc',
    '10000',
    '--source-yes-pct',
    '58',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.lp-explain');
  assert.equal(payload.data.flow.totalLpInventory.neutralCompleteSets, true);
  assert.equal(payload.data.inputs.distributionYes + payload.data.inputs.distributionNo, 1000000000);
});

test('mirror hedge-calc supports manual reserve inputs', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'hedge-calc',
    '--reserve-yes-usdc',
    '8',
    '--reserve-no-usdc',
    '12',
    '--excess-no-usdc',
    '2',
    '--polymarket-yes-pct',
    '60',
    '--volume-scenarios',
    '1000,5000',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.hedge-calc');
  assert.equal(payload.data.metrics.hedgeToken, 'yes');
  assert.equal(payload.data.scenarios.length, 2);
});

test('mirror hedge-calc can auto-resolve reserves from a mirror pair', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides({
    markets: [
      {
        ...buildMirrorIndexerOverrides().markets[0],
        reserveYes: '8000000',
        reserveNo: '12000000',
      },
    ],
  }));
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'hedge-calc',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.hedge-calc');
    assert.equal(payload.data.metrics.reserveYesUsdc, 8);
    assert.equal(payload.data.metrics.reserveNoUsdc, 12);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror simulate returns deterministic scenarios for LP economics planning', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'simulate',
    '--liquidity-usdc',
    '5000',
    '--source-yes-pct',
    '60',
    '--target-yes-pct',
    '60',
    '--polymarket-yes-pct',
    '60',
    '--volume-scenarios',
    '500,2500',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.simulate');
  assert.equal(payload.data.scenarios.length, 2);
  assert.equal(payload.data.inputs.tradeSide, 'yes');
});

test('simulate namespace supports scoped json help', () => {
  const result = runCli(['--output', 'json', 'simulate', '--help']);
  assert.equal(result.status, 0);

  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'simulate.help');
  assert.match(payload.data.usage, /simulate mc\|particle-filter\|agents/);
});

test('simulate mc returns deterministic CI + VaR/ES with seed replay', () => {
  const args = [
    '--output',
    'json',
    'simulate',
    'mc',
    '--trials',
    '2500',
    '--horizon',
    '48',
    '--start-yes-pct',
    '57',
    '--entry-yes-pct',
    '57',
    '--position',
    'yes',
    '--stake-usdc',
    '100',
    '--drift-bps',
    '0',
    '--vol-bps',
    '175',
    '--confidence',
    '95',
    '--var-level',
    '95',
    '--seed',
    '23',
    '--antithetic',
  ];

  const first = runCli(args);
  const second = runCli(args);
  assert.equal(first.status, 0);
  assert.equal(second.status, 0);

  const firstPayload = parseJsonOutput(first);
  const secondPayload = parseJsonOutput(second);

  assert.equal(firstPayload.command, 'simulate.mc');
  assert.equal(secondPayload.command, 'simulate.mc');
  assert.equal(firstPayload.data.summary.finalYesPct.mean, secondPayload.data.summary.finalYesPct.mean);
  assert.equal(firstPayload.data.summary.pnlUsdc.mean, secondPayload.data.summary.pnlUsdc.mean);
  assert.equal(
    firstPayload.data.summary.risk.valueAtRiskUsdc,
    secondPayload.data.summary.risk.valueAtRiskUsdc,
  );
  assert.equal(
    firstPayload.data.summary.risk.expectedShortfallUsdc,
    secondPayload.data.summary.risk.expectedShortfallUsdc,
  );
  assert.equal(typeof firstPayload.data.summary.finalYesPct.ciLower, 'number');
  assert.equal(typeof firstPayload.data.summary.finalYesPct.ciUpper, 'number');
  assert.equal(typeof firstPayload.data.summary.risk.valueAtRiskUsdc, 'number');
  assert.equal(typeof firstPayload.data.summary.risk.expectedShortfallUsdc, 'number');
});

test('simulate particle-filter consumes inline observations and emits ESS diagnostics', () => {
  const result = runCli([
    '--output',
    'json',
    'simulate',
    'particle-filter',
    '--observations-json',
    '[{\"yesPct\":52},null,{\"yesPct\":49},{\"yesPct\":51}]',
    '--particles',
    '600',
    '--process-noise',
    '0.15',
    '--observation-noise',
    '0.08',
    '--resample-threshold',
    '0.55',
    '--resample-method',
    'systematic',
    '--credible-interval',
    '90',
    '--seed',
    '31',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.command, 'simulate.particle-filter');
  assert.equal(payload.data.trajectory.length, 4);
  assert.equal(payload.data.summary.observedCount, 3);
  assert.equal(payload.data.summary.missingCount, 1);
  assert.equal(typeof payload.data.summary.averageEss, 'number');
  assert.equal(Array.isArray(payload.data.diagnostics), true);
  assert.equal(payload.data.diagnostics.some((item) => item && item.code === 'SPARSE_OBSERVATIONS'), true);
});

test('simulate particle-filter accepts NDJSON file input', () => {
  const tempDir = createTempDir('pandora-simulate-pf-');
  const inputPath = path.join(tempDir, 'observations.ndjson');
  writeFile(
    inputPath,
    ['{\"yesPct\":48}', '{\"yesPct\":49}', '{\"yesPct\":52}', '{\"yesPct\":54}'].join('\n'),
  );

  try {
    const result = runCli([
      '--output',
      'json',
      'simulate',
      'particle-filter',
      '--input',
      inputPath,
      '--particles',
      '700',
      '--seed',
      '5',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.command, 'simulate.particle-filter');
    assert.equal(payload.data.trajectory.length, 4);
    assert.equal(typeof payload.data.summary.final.filteredYesPct, 'number');
  } finally {
    removeDir(tempDir);
  }
});

test('simulate agents returns deterministic ABM diagnostics in json mode', () => {
  const args = [
    '--output',
    'json',
    'simulate',
    'agents',
    '--n-informed',
    '6',
    '--n-noise',
    '20',
    '--n-mm',
    '4',
    '--n-steps',
    '35',
    '--seed',
    '99',
  ];

  const first = runCli(args);
  const second = runCli(args);
  assert.equal(first.status, 0);
  assert.equal(second.status, 0);

  const firstPayload = parseJsonOutput(first);
  const secondPayload = parseJsonOutput(second);
  const { generatedAt: _firstGeneratedAt, ...firstDataStable } = firstPayload.data;
  const { generatedAt: _secondGeneratedAt, ...secondDataStable } = secondPayload.data;

  assert.equal(firstPayload.ok, true);
  assert.equal(firstPayload.command, 'simulate.agents');
  assert.deepEqual(firstDataStable, secondDataStable);
  assert.equal(firstPayload.data.parameters.n_informed, 6);
  assert.equal(firstPayload.data.parameters.n_noise, 20);
  assert.equal(firstPayload.data.parameters.n_mm, 4);
  assert.equal(firstPayload.data.parameters.n_steps, 35);
  assert.equal(typeof firstPayload.data.finalState.midPrice, 'number');
  assert.equal(typeof firstPayload.data.volume.total, 'number');
  assert.equal(typeof firstPayload.data.runtimeBounds.estimatedWorkUnits, 'number');
});

test('mirror simulate --engine mc returns Monte Carlo summary and tail risk blocks', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'simulate',
    '--liquidity-usdc',
    '5000',
    '--source-yes-pct',
    '60',
    '--target-yes-pct',
    '60',
    '--polymarket-yes-pct',
    '60',
    '--engine',
    'mc',
    '--paths',
    '400',
    '--steps',
    '16',
    '--seed',
    '17',
    '--importance-sampling',
    '--antithetic',
    '--control-variate',
    '--stratified',
    '--volume-scenarios',
    '500,2500',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.simulate');
  assert.equal(payload.data.inputs.engine, 'mc');
  assert.equal(payload.data.mc.summary.paths, 400);
  assert.equal(payload.data.mc.summary.steps, 16);
  assert.equal(payload.data.mc.summary.seed, 17);
  assert.equal(typeof payload.data.mc.tailRisk.var95Usdc, 'number');
  assert.equal(typeof payload.data.mc.tailRisk.var99Usdc, 'number');
  assert.equal(typeof payload.data.mc.tailRisk.es95Usdc, 'number');
  assert.equal(typeof payload.data.mc.tailRisk.es99Usdc, 'number');
  assert.ok(payload.data.mc.tailRisk.var99Usdc >= payload.data.mc.tailRisk.var95Usdc);
});

test('model diagnose returns classification and machine-readable gating flags', () => {
  const result = runCli([
    '--output',
    'json',
    'model',
    'diagnose',
    '--calibration-rmse',
    '0.12',
    '--drift-bps',
    '85',
    '--spread-bps',
    '70',
    '--depth-coverage',
    '0.72',
    '--informed-flow-ratio',
    '0.61',
    '--noise-ratio',
    '0.34',
    '--anomaly-rate',
    '0.08',
    '--manipulation-alerts',
    '1',
    '--tail-dependence',
    '0.22',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'model.diagnose');
  assert.equal(typeof payload.data.aggregate.classification, 'string');
  assert.equal(typeof payload.data.flags.allowExecution, 'boolean');
  assert.equal(typeof payload.data.flags.requireHumanReview, 'boolean');
  assert.equal(typeof payload.data.flags.blockExecution, 'boolean');
});

test('mirror deploy dry-run materializes deployment args without chain writes', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'deploy',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--dry-run',
      '--fee-tier',
      '50000',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.deploy');
    assert.equal(payload.data.schemaVersion, '1.0.0');
    assert.equal(payload.data.dryRun, true);
    assert.equal(payload.data.tx, null);
    assert.equal(payload.data.deploymentArgs.feeTier, 50000);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror deploy rejects fee tiers above 5%', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'deploy',
    '--dry-run',
    '--polymarket-market-id',
    'poly-cond-1',
    '--fee-tier',
    '50001',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /--fee-tier must be between 500 and 50000/i);
});

test('mirror deploy validates --private-key format', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'deploy',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--dry-run',
      '--private-key',
      '0x1234',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
    assert.match(payload.error.message, /--private-key must be a valid private key/i);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror deploy copies exact Polymarket question and full rules text', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer({
    ...buildMirrorPolymarketOverrides(),
    markets: [
      {
        ...buildMirrorPolymarketOverrides().markets[0],
        question: 'Will Team A win (OT included)?',
        rules: 'Primary rule block from Polymarket.',
        description: 'Supplemental market description details.',
        resolution_source: 'https://docs.polymarket.com/rules',
        events: [{ description: 'Event-level resolution context.' }],
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'deploy',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--dry-run',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.deploy');
    assert.equal(payload.data.deploymentArgs.question, 'Will Team A win (OT included)?');
    assert.match(payload.data.deploymentArgs.rules, /Primary rule block from Polymarket\./);
    assert.match(payload.data.deploymentArgs.rules, /Supplemental market description details\./);
    assert.match(payload.data.deploymentArgs.rules, /Resolution Source: https:\/\/docs\.polymarket\.com\/rules/);
    assert.match(payload.data.deploymentArgs.rules, /Event: Event-level resolution context\./);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror go accepts named --skip-gate lists during parsing', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'go',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--paper',
      '--auto-sync',
      '--skip-gate',
      'MAX_TRADES_PER_DAY,DEPTH_COVERAGE',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'MIRROR_GO_SYNC_REQUIRES_DEPLOYED_MARKET');
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror sync once paper mode performs deterministic simulated action and persists state', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const killFile = path.join(tempDir, 'STOP');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'sync',
      'once',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--paper',
      '--funder',
      '0x2222222222222222222222222222222222222222',
      '--drift-trigger-bps',
      '25',
      '--hedge-trigger-usdc',
      '1000000',
      '--hedge-ratio',
      '0.75',
      '--state-file',
      stateFile,
      '--kill-switch-file',
      killFile,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.sync');
    assert.equal(payload.data.mode, 'once');
    assert.equal(payload.data.executeLive, false);
    assert.equal(payload.data.parameters.hedgeEnabled, true);
    assert.equal(payload.data.parameters.hedgeRatio, 0.75);
    assert.equal(payload.data.actionCount, 1);
    assert.equal(payload.data.snapshots[0].metrics.rebalanceSizingBasis, 'pool-size-drift');
    assert.equal(payload.data.snapshots[0].metrics.plannedRebalanceUsdc, 25);
    assert.equal(fs.existsSync(stateFile), true);
    assert.equal(payload.data.actions[0].status, 'simulated');
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror sync --skip-gate keeps legacy skip-all bypass behavior', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-skip-all-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        lastResetDay: new Date().toISOString().slice(0, 10),
        tradesToday: 1,
      },
      null,
      2,
    ),
  );

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'sync',
      'once',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--paper',
      '--drift-trigger-bps',
      '25',
      '--hedge-trigger-usdc',
      '1000000',
      '--max-trades-per-day',
      '1',
      '--skip-gate',
      '--state-file',
      stateFile,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.sync');
    assert.equal(payload.data.actionCount, 1);
    assert.equal(payload.data.actions[0].status, 'simulated');
    assert.equal(payload.data.actions[0].forcedGateBypass, true);
    assert.equal(payload.data.actions[0].bypassedFailedChecks.includes('MAX_TRADES_PER_DAY'), true);
    assert.equal(payload.data.snapshots[0].strictGate.ok, true);
    assert.equal(payload.data.snapshots[0].strictGate.failedChecksRaw.includes('MAX_TRADES_PER_DAY'), true);
    assert.equal(payload.data.snapshots[0].strictGate.bypassedFailedChecks.includes('MAX_TRADES_PER_DAY'), true);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror sync --skip-gate with named checks bypasses only matching failures', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-skip-selective-');
  const bypassStateFile = path.join(tempDir, 'mirror-state-bypass.json');
  const blockedStateFile = path.join(tempDir, 'mirror-state-blocked.json');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  fs.writeFileSync(
    bypassStateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        lastResetDay: new Date().toISOString().slice(0, 10),
        tradesToday: 1,
      },
      null,
      2,
    ),
  );

  try {
    const selectiveBypassResult = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'sync',
      'once',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--paper',
      '--drift-trigger-bps',
      '25',
      '--hedge-trigger-usdc',
      '1000000',
      '--max-trades-per-day',
      '1',
      '--skip-gate=MAX_TRADES_PER_DAY',
      '--state-file',
      bypassStateFile,
    ]);

    assert.equal(selectiveBypassResult.status, 0);
    const selectiveBypassPayload = parseJsonOutput(selectiveBypassResult);
    assert.equal(selectiveBypassPayload.ok, true);
    assert.equal(selectiveBypassPayload.command, 'mirror.sync');
    assert.equal(selectiveBypassPayload.data.parameters.forceGate, false);
    assert.deepEqual(selectiveBypassPayload.data.parameters.skipGateChecks, ['MAX_TRADES_PER_DAY']);
    assert.equal(selectiveBypassPayload.data.actionCount, 1);
    assert.equal(selectiveBypassPayload.data.actions[0].status, 'simulated');
    assert.equal(selectiveBypassPayload.data.actions[0].failedChecks.length, 0);
    assert.equal(selectiveBypassPayload.data.actions[0].bypassedFailedChecks.includes('MAX_TRADES_PER_DAY'), true);

    fs.writeFileSync(
      blockedStateFile,
      JSON.stringify(
        {
          schemaVersion: '1.0.0',
          lastResetDay: new Date().toISOString().slice(0, 10),
          tradesToday: 1,
        },
        null,
        2,
      ),
    );

    const selectiveNoBypassResult = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'sync',
      'once',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--paper',
      '--drift-trigger-bps',
      '25',
      '--hedge-trigger-usdc',
      '1000000',
      '--max-trades-per-day',
      '1',
      '--skip-gate',
      'DEPTH_COVERAGE',
      '--state-file',
      blockedStateFile,
    ]);

    assert.equal(selectiveNoBypassResult.status, 0);
    const selectiveNoBypassPayload = parseJsonOutput(selectiveNoBypassResult);
    assert.equal(selectiveNoBypassPayload.ok, true);
    assert.equal(selectiveNoBypassPayload.command, 'mirror.sync');
    assert.deepEqual(selectiveNoBypassPayload.data.parameters.skipGateChecks, ['DEPTH_COVERAGE']);
    assert.equal(selectiveNoBypassPayload.data.actionCount, 0);
    assert.equal(selectiveNoBypassPayload.data.snapshots[0].action.status, 'blocked');
    assert.equal(selectiveNoBypassPayload.data.snapshots[0].action.failedChecks.includes('MAX_TRADES_PER_DAY'), true);
    assert.equal(selectiveNoBypassPayload.data.snapshots[0].action.bypassedFailedChecks.length, 0);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror sync --no-hedge suppresses hedge trigger path while preserving snapshot diagnostics', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-no-hedge-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const indexer = await startIndexerMockServer(
    buildMirrorIndexerOverrides({
      markets: [
        {
          id: ADDRESSES.mirrorMarket,
          chainId: 1,
          chainName: 'ethereum',
          pollAddress: ADDRESSES.mirrorPoll,
          creator: ADDRESSES.wallet1,
          marketType: 'amm',
          marketCloseTimestamp: FIXED_MIRROR_CLOSE_TS,
          totalVolume: '100000',
          currentTvl: '200000',
          yesChance: '0.80',
          reserveYes: '80000000',
          reserveNo: '20000000',
          createdAt: '1700000000',
        },
      ],
    }),
  );
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'sync',
      'once',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--paper',
      '--drift-trigger-bps',
      '2000',
      '--hedge-trigger-usdc',
      '10',
      '--no-hedge',
      '--state-file',
      stateFile,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.sync');
    assert.equal(payload.data.parameters.hedgeEnabled, false);
    assert.equal(payload.data.actionCount, 0);
    assert.equal(payload.data.snapshots[0].metrics.rawHedgeTriggered, true);
    assert.equal(payload.data.snapshots[0].metrics.hedgeTriggered, false);
    assert.equal(payload.data.snapshots[0].metrics.hedgeSuppressed, true);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror sync validates --hedge-ratio upper bound', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'sync',
    'once',
    '--skip-dotenv',
    '--pandora-market-address',
    ADDRESSES.mirrorMarket,
    '--polymarket-market-id',
    'poly-cond-1',
    '--paper',
    '--hedge-ratio',
    '2.5',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /--hedge-ratio/);
});

test('mirror sync --help json includes live hedge environment requirements', () => {
  const result = runCli(['--output', 'json', 'mirror', 'sync', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.sync.help');
  assert.equal(Array.isArray(payload.data.liveHedgeEnv), true);
  assert.equal(payload.data.liveHedgeEnv.includes('POLYMARKET_PRIVATE_KEY'), true);
  assert.equal(payload.data.liveHedgeEnv.includes('POLYMARKET_API_KEY'), true);
  assert.match(payload.data.usage, /--funder <address>/);
});

test('polymarket check returns deterministic JSON payload shape', async () => {
  const rpc = await startPolymarketOpsRpcMock({
    funder: POLYMARKET_DEFAULTS.funder,
    usdcBalanceRaw: 2_500_000n,
    safeOwner: true,
  });

  try {
    const result = await runCliAsync(
      [
        '--output',
        'json',
        'polymarket',
        'check',
        '--rpc-url',
        rpc.url,
        '--private-key',
        `0x${'1'.repeat(64)}`,
        '--funder',
        POLYMARKET_DEFAULTS.funder,
      ],
      {
        env: {
          POLYMARKET_SKIP_API_KEY_SANITY: '1',
        },
      },
    );

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'polymarket.check');
    assert.equal(payload.data.schemaVersion, '1.0.0');
    assert.equal(payload.data.chainId, 137);
    assert.equal(Array.isArray(payload.data.runtime.spenders), true);
    assert.equal(payload.data.runtime.spenders.length, 3);
    assert.equal(Array.isArray(payload.data.approvals.checks), true);
    assert.equal(payload.data.approvals.checks.length, 6);
    assert.equal(payload.data.apiKeySanity.status, 'skipped');
  } finally {
    await rpc.close();
  }
});

test('polymarket approve --dry-run returns deterministic JSON plan shape', async () => {
  const rpc = await startPolymarketOpsRpcMock({
    funder: POLYMARKET_DEFAULTS.funder,
    usdcBalanceRaw: 1_000_000n,
    safeOwner: true,
  });

  try {
    const result = await runCliAsync(
      [
        '--output',
        'json',
        'polymarket',
        'approve',
        '--dry-run',
        '--rpc-url',
        rpc.url,
        '--private-key',
        `0x${'1'.repeat(64)}`,
        '--funder',
        POLYMARKET_DEFAULTS.funder,
      ],
      {
        env: {
          POLYMARKET_SKIP_API_KEY_SANITY: '1',
        },
      },
    );

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'polymarket.approve');
    assert.equal(payload.data.mode, 'dry-run');
    assert.equal(payload.data.status, 'planned');
    assert.equal(Array.isArray(payload.data.txPlan), true);
    assert.equal(payload.data.txPlan.length, 6);
    assert.equal(payload.data.approvalSummary.missingCount, 6);
  } finally {
    await rpc.close();
  }
});

test('mirror sync --execute-live enforces required risk caps', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'sync',
    'once',
    '--skip-dotenv',
    '--pandora-market-address',
    ADDRESSES.mirrorMarket,
    '--polymarket-market-id',
    'poly-cond-1',
    '--execute-live',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.match(payload.error.message, /max-open-exposure-usdc/);
});

test('mirror sync start/status/stop manages daemon lifecycle in paper mode', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-daemon-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());
  let strategyHash = null;
  let daemonPid = null;

  try {
    const startResult = runCli(
      [
        '--output',
        'json',
        'mirror',
        'sync',
        'start',
        '--skip-dotenv',
        '--indexer-url',
        indexer.url,
        '--polymarket-mock-url',
        polymarket.url,
        '--pandora-market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
        '--paper',
        '--interval-ms',
        '1000',
        '--iterations',
        '30',
        '--drift-trigger-bps',
        '25',
        '--hedge-trigger-usdc',
        '1000000',
        '--state-file',
        stateFile,
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(startResult.status, 0);
    const startPayload = parseJsonOutput(startResult);
    assert.equal(startPayload.ok, true);
    assert.equal(startPayload.command, 'mirror.sync.start');
    assert.equal(startPayload.data.found, true);
    assert.equal(typeof startPayload.data.strategyHash, 'string');
    assert.equal(startPayload.data.strategyHash.length, 16);
    assert.equal(typeof startPayload.data.pid, 'number');
    assert.equal(fs.existsSync(startPayload.data.pidFile), true);
    assert.equal(fs.existsSync(startPayload.data.logFile), true);

    strategyHash = startPayload.data.strategyHash;
    daemonPid = startPayload.data.pid;

    const statusResult = runCli(
      [
        '--output',
        'json',
        'mirror',
        'sync',
        'status',
        '--strategy-hash',
        strategyHash,
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(statusResult.status, 0);
    const statusPayload = parseJsonOutput(statusResult);
    assert.equal(statusPayload.ok, true);
    assert.equal(statusPayload.command, 'mirror.sync.status');
    assert.equal(statusPayload.data.found, true);
    assert.equal(statusPayload.data.strategyHash, strategyHash);
    assert.equal(typeof statusPayload.data.pid, 'number');
    assert.equal(statusPayload.data.alive, true);

    const stopResult = runCli(
      [
        '--output',
        'json',
        'mirror',
        'sync',
        'stop',
        '--strategy-hash',
        strategyHash,
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(stopResult.status, 0);
    const stopPayload = parseJsonOutput(stopResult);
    assert.equal(stopPayload.ok, true);
    assert.equal(stopPayload.command, 'mirror.sync.stop');
    assert.equal(stopPayload.data.strategyHash, strategyHash);
    assert.equal(stopPayload.data.alive, false);

    const afterStopResult = runCli(
      [
        '--output',
        'json',
        'mirror',
        'sync',
        'status',
        '--strategy-hash',
        strategyHash,
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(afterStopResult.status, 0);
    const afterStopPayload = parseJsonOutput(afterStopResult);
    assert.equal(afterStopPayload.ok, true);
    assert.equal(afterStopPayload.data.found, true);
    assert.equal(afterStopPayload.data.alive, false);
  } finally {
    if (strategyHash) {
      runCli(['--output', 'json', 'mirror', 'sync', 'stop', '--strategy-hash', strategyHash], {
        env: { HOME: tempDir },
      });
    }
    if (daemonPid && Number.isInteger(daemonPid)) {
      try {
        process.kill(daemonPid, 'SIGKILL');
      } catch {
        // best-effort cleanup
      }
    }
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror sync start does not leak --private-key in daemon metadata', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-daemon-private-key-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());
  let strategyHash = null;
  let daemonPid = null;
  const privateKey = `0x${'1'.repeat(64)}`;
  const funder = '0x9999999999999999999999999999999999999999';

  try {
    const startResult = runCli(
      [
        '--output',
        'json',
        'mirror',
        'sync',
        'start',
        '--skip-dotenv',
        '--indexer-url',
        indexer.url,
        '--polymarket-mock-url',
        polymarket.url,
        '--pandora-market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
        '--paper',
        '--private-key',
        privateKey,
        '--funder',
        funder,
        '--interval-ms',
        '1000',
        '--iterations',
        '30',
        '--drift-trigger-bps',
        '25',
        '--hedge-trigger-usdc',
        '1000000',
        '--state-file',
        stateFile,
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(startResult.status, 0);
    const startPayload = parseJsonOutput(startResult);
    assert.equal(startPayload.ok, true);
    assert.equal(startPayload.command, 'mirror.sync.start');
    assert.equal(Array.isArray(startPayload.data.cliArgs), true);
    assert.equal(startPayload.data.cliArgs.includes('--private-key'), false);
    assert.equal(startPayload.data.launchCommand.includes('--private-key'), false);
    assert.equal(startPayload.data.launchCommand.includes(privateKey), false);

    strategyHash = startPayload.data.strategyHash;
    daemonPid = startPayload.data.pid;

    const stopResult = runCli(
      [
        '--output',
        'json',
        'mirror',
        'sync',
        'stop',
        '--strategy-hash',
        strategyHash,
      ],
      { env: { HOME: tempDir } },
    );
    assert.equal(stopResult.status, 0);
  } finally {
    if (strategyHash) {
      runCli(['--output', 'json', 'mirror', 'sync', 'stop', '--strategy-hash', strategyHash], {
        env: { HOME: tempDir },
      });
    }
    if (daemonPid && Number.isInteger(daemonPid)) {
      try {
        process.kill(daemonPid, 'SIGKILL');
      } catch {
        // best-effort cleanup
      }
    }
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror status can load state via strategy hash path', async () => {
  const tempDir = createTempDir('pandora-mirror-status-');
  const strategyHash = '0123456789abcdef';
  const stateDir = path.join(tempDir, '.pandora', 'mirror');
  const statePath = path.join(stateDir, `${strategyHash}.json`);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        tradesToday: 2,
        dailySpendUsdc: 42,
      },
      null,
      2,
    ),
  );

  const result = runCli(['--output', 'json', 'mirror', 'status', '--strategy-hash', strategyHash], {
    env: { HOME: tempDir },
  });

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.status');
  assert.equal(payload.data.strategyHash, strategyHash);
  assert.equal(payload.data.state.tradesToday, 2);

  removeDir(tempDir);
});

test('mirror status --help returns usage payload', () => {
  const result = runCli(['--output', 'json', 'mirror', 'status', '--help']);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.status.help');
  assert.match(payload.data.usage, /mirror status/);
});

test('--version returns package version in json mode', () => {
  const result = runCli(['--output', 'json', '--version']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'version');
  assert.match(payload.data.version, /^\d+\.\d+\.\d+/);
});

test('conflicting --output values fail with INVALID_ARGS in json envelope', () => {
  const result = runCli(['--output', 'json', '--output', 'table', 'help']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_ARGS');
  assert.match(payload.error.message, /Conflicting --output values/);
});

test('mirror browse validates invalid date strings', () => {
  const result = runCli(['--output', 'json', 'mirror', 'browse', '--closes-after', 'not-a-date']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /--closes-after must be an ISO date\/time string/);
});

test('mirror browse rejects numeric-only date strings', () => {
  const result = runCli(['--output', 'json', 'mirror', 'browse', '--closes-after', '-1000']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /not a bare number/);
});

test('mirror browse rejects invalid calendar rollover dates', () => {
  const result = runCli(['--output', 'json', 'mirror', 'browse', '--closes-after', '2026-02-31']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /real calendar date/);
});

test('boolean flags with --key=false do not silently flip behavior', () => {
  const result = runCli(['--output', 'json', 'scan', '--active=false']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'UNKNOWN_FLAG');
  assert.match(payload.error.message, /--active=false/);
});

test('subcommand flags support --key=value syntax', () => {
  const tempDir = createTempDir('pandora-equals-flags-');
  const strategyHash = '0123456789abcdef';
  const stateDir = path.join(tempDir, '.pandora', 'mirror');
  const statePath = path.join(stateDir, `${strategyHash}.json`);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        tradesToday: 1,
      },
      null,
      2,
    ),
  );

  const result = runCli(['--output=json', 'mirror', 'status', `--strategy-hash=${strategyHash}`], {
    env: { HOME: tempDir },
  });

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.status');
  assert.equal(payload.data.strategyHash, strategyHash);
  removeDir(tempDir);
});

test('mirror close accepts --market-address alias', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'close',
    '--market-address',
    ADDRESSES.mirrorMarket,
    '--polymarket-market-id',
    'poly-cond-1',
    '--dry-run',
  ]);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.close');
  assert.equal(payload.data.pandoraMarketAddress, ADDRESSES.mirrorMarket.toLowerCase());
});

test('mirror browse returns candidate markets with existing mirror hint', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'browse',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--limit',
      '5',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.browse');
    assert.equal(Array.isArray(payload.data.items), true);
    assert.equal(payload.data.filters.minYesPct, null);
    assert.equal(payload.data.filters.maxYesPct, null);
    assert.equal(payload.data.filters.limit, 5);
    if (payload.data.items.length > 0) {
      assert.equal(Object.prototype.hasOwnProperty.call(payload.data.items[0], 'existingMirror'), true);
      if (payload.data.items[0].existingMirror) {
        assert.equal(typeof payload.data.items[0].existingMirror.marketAddress, 'string');
        assert.equal(typeof payload.data.items[0].existingMirror.similarity, 'number');
      }
    }
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror sync accepts --market-address with --dry-run mode alias', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-aliases-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'sync',
      'once',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--dry-run',
      '--drift-trigger-bps',
      '25',
      '--hedge-trigger-usdc',
      '1000000',
      '--state-file',
      stateFile,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.sync');
    assert.equal(payload.data.mode, 'once');
    assert.equal(payload.data.executeLive, false);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror plan resolves slug selectors via gamma mock endpoint', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'plan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-slug',
      'deterministic-tests-pass',
      '--polymarket-gamma-mock-url',
      polymarket.url,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.plan');
    assert.equal(payload.data.sourceMarket.sourceType, 'polymarket:gamma');
    assert.equal(payload.data.sourceMarket.slug, 'deterministic-tests-pass');
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror verify --trust-deploy bypasses similarity for trusted manifest pairs', async () => {
  const tempDir = createTempDir('pandora-mirror-trust-');
  const manifestFile = path.join(tempDir, '.pandora', 'mirror', 'pairs.json');
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  fs.writeFileSync(
    manifestFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        pairs: [
          {
            id: 'pair-1',
            trusted: true,
            pandoraMarketAddress: ADDRESSES.mirrorMarket,
            polymarketMarketId: 'poly-cond-1',
            polymarketSlug: 'deterministic-tests-pass',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
      null,
      2,
    ),
  );

  const indexer = await startIndexerMockServer(
    buildMirrorIndexerOverrides({
      polls: [
        {
          ...buildMirrorIndexerOverrides().polls[0],
          question: 'Completely different wording for Pandora side',
        },
      ],
    }),
  );
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync(
      [
        '--output',
        'json',
        'mirror',
        'verify',
        '--skip-dotenv',
        '--indexer-url',
        indexer.url,
        '--polymarket-mock-url',
        polymarket.url,
        '--pandora-market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
        '--trust-deploy',
        '--manifest-file',
        manifestFile,
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.verify');
    assert.equal(payload.data.gateResult.ok, true);
    const matchCheck = payload.data.gateResult.checks.find((item) => item.code === 'MATCH_CONFIDENCE');
    assert.equal(Boolean(matchCheck && matchCheck.ok), true);
    assert.equal(Boolean(matchCheck && matchCheck.meta && matchCheck.meta.trustDeploy), true);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror sync --trust-deploy fails fast when trusted pair is missing', () => {
  const tempDir = createTempDir('pandora-mirror-trust-missing-');
  try {
    const result = runCli(
      [
        '--output',
        'json',
        'mirror',
        'sync',
        'once',
        '--skip-dotenv',
        '--pandora-market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
        '--paper',
        '--trust-deploy',
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.error.code, 'TRUST_DEPLOY_PAIR_NOT_FOUND');
  } finally {
    removeDir(tempDir);
  }
});

test('mirror status --with-live includes polymarket position visibility diagnostics', async () => {
  const tempDir = createTempDir('pandora-mirror-status-live-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: 'feedfacecafebeef',
        pandoraMarketAddress: ADDRESSES.mirrorMarket,
        polymarketMarketId: 'poly-cond-1',
        currentHedgeUsdc: 5,
        cumulativeLpFeesApproxUsdc: 2.5,
        cumulativeHedgeCostApproxUsdc: 1.25,
      },
      null,
      2,
    ),
  );

  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer({
    ...buildMirrorPolymarketOverrides(),
    balances: {
      'poly-yes-1': '12.5',
      'poly-no-1': '3.25',
    },
    openOrders: [
      {
        id: 'order-1',
        market: 'poly-cond-1',
        asset_id: 'poly-yes-1',
        original_size: '10',
        size_matched: '4',
        price: '0.74',
      },
      {
        id: 'order-2',
        market: 'poly-cond-1',
        asset_id: 'poly-no-1',
        remaining_size: '2',
        price: '0.26',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'status',
      '--state-file',
      stateFile,
      '--with-live',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.status');
    assert.equal(typeof payload.data.live.driftBps, 'number');
    assert.equal(typeof payload.data.live.netPnlApproxUsdc, 'number');
    assert.equal(payload.data.live.netPnlApproxUsdc, 1.25);
    assert.equal(typeof payload.data.live.netDeltaApprox, 'number');
    assert.equal(typeof payload.data.live.pnlApprox, 'number');
    assert.equal(payload.data.live.polymarketPosition.yesBalance, 12.5);
    assert.equal(payload.data.live.polymarketPosition.noBalance, 3.25);
    assert.equal(payload.data.live.polymarketPosition.openOrdersCount, 2);
    assert.equal(payload.data.live.polymarketPosition.estimatedValueUsd, 10.095);
    assert.equal(Array.isArray(payload.data.live.polymarketPosition.diagnostics), true);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror close dry-run returns deterministic close plan scaffold', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'close',
    '--pandora-market-address',
    ADDRESSES.mirrorMarket,
    '--polymarket-market-id',
    'poly-cond-1',
    '--dry-run',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.close');
  assert.equal(payload.data.mode, 'dry-run');
  assert.equal(Array.isArray(payload.data.steps), true);
  assert.equal(payload.data.steps.length >= 3, true);
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

test('webhook test --help returns structured JSON help payload', () => {
  const result = runCli(['--output', 'json', 'webhook', 'test', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.command, 'webhook.test.help');
  assert.match(payload.data.usage, /^pandora .* webhook test /);
  assert.equal(payload.data.schemaVersion, '1.0.0');
  assertIsoTimestamp(payload.data.generatedAt);
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
    assert.equal(payload.data.schemaVersion, '1.0.0');

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

test('leaderboard payload diagnostics only include returned rows', async () => {
  const indexer = await startIndexerMockServer({
    users: [
      {
        id: 'user-top-clean',
        address: ADDRESSES.wallet1,
        chainId: 1,
        realizedPnL: '10',
        totalVolume: '5000',
        totalTrades: '10',
        totalWins: '5',
        totalLosses: '5',
        totalWinnings: '200',
      },
      {
        id: 'user-lower-anomaly',
        address: '0x7777777777777777777777777777777777777777',
        chainId: 1,
        realizedPnL: '5',
        totalVolume: '100',
        totalTrades: '5',
        totalWins: '12',
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
      'volume',
      '--limit',
      '1',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'leaderboard');
    assert.equal(payload.data.items.length, 1);
    assert.equal(payload.data.items[0].address.toLowerCase(), ADDRESSES.wallet1.toLowerCase());
    assert.deepEqual(payload.data.diagnostics, []);
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

test('resolve and lp commands are enabled', () => {
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
  assert.equal(resolveResult.status, 0);
  const resolvePayload = parseJsonOutput(resolveResult);
  assert.equal(resolvePayload.ok, true);
  assert.equal(resolvePayload.command, 'resolve');
  assert.equal(resolvePayload.data.mode, 'dry-run');
  assert.equal(resolvePayload.data.txPlan.functionName, 'resolveMarket');

  const lpResult = runCli([
    '--output',
    'json',
    'lp',
    'positions',
    '--wallet',
    ADDRESSES.wallet1,
  ]);
  assert.equal(lpResult.status, 0);
  const lpPayload = parseJsonOutput(lpResult);
  assert.equal(lpPayload.ok, true);
  assert.equal(lpPayload.command, 'lp');
  assert.equal(lpPayload.data.action, 'positions');
  assert.equal(lpPayload.data.wallet, ADDRESSES.wallet1.toLowerCase());
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

test('json errors include next-best-action recovery hints', () => {
  const result = runCli([
    '--output',
    'json',
    'trade',
    '--dry-run',
    '--side',
    'yes',
    '--amount-usdc',
    '10',
  ]);

  assert.equal(result.status, 1, result.output);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.equal(typeof payload.error.recovery, 'object');
  assert.equal(payload.error.recovery.retryable, true);
  assert.equal(typeof payload.error.recovery.command, 'string');
  assert.match(payload.error.recovery.command, /pandora help|pandora trade --dry-run/);
});

test('unknown command errors include structured recovery hints', () => {
  const result = runCli(['--output', 'json', 'totally-unknown-command']);
  assert.equal(result.status, 1, result.output);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'UNKNOWN_COMMAND');
  assert.equal(typeof payload.error.recovery, 'object');
  assert.equal(payload.error.recovery.retryable, true);
  assert.equal(payload.error.recovery.command, 'pandora help');
});

test('trade dry-run with fork flags marks runtime.mode=fork', () => {
  const result = runCli([
    '--output',
    'json',
    'trade',
    '--dry-run',
    '--market-address',
    ADDRESSES.mirrorMarket,
    '--side',
    'yes',
    '--amount-usdc',
    '10',
    '--yes-pct',
    '55',
    '--fork-rpc-url',
    'http://127.0.0.1:8545',
    '--fork-chain-id',
    '1',
  ]);

  assert.equal(result.status, 0, result.output);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'trade');
  assert.equal(payload.data.runtime.mode, 'fork');
});

test('resolve dry-run with fork flags marks runtime.mode=fork', () => {
  const result = runCli([
    '--output',
    'json',
    'resolve',
    '--poll-address',
    ADDRESSES.mirrorPoll,
    '--answer',
    'yes',
    '--reason',
    'Fork simulation',
    '--dry-run',
    '--fork-rpc-url',
    'http://127.0.0.1:8545',
  ]);

  assert.equal(result.status, 0, result.output);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'resolve');
  assert.equal(payload.data.runtime.mode, 'fork');
});

test('lp add dry-run with fork flags marks runtime.mode=fork', () => {
  const result = runCli([
    '--output',
    'json',
    'lp',
    'add',
    '--market-address',
    ADDRESSES.mirrorMarket,
    '--amount-usdc',
    '15',
    '--dry-run',
    '--fork-rpc-url',
    'http://127.0.0.1:8545',
  ]);

  assert.equal(result.status, 0, result.output);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'lp');
  assert.equal(payload.data.runtime.mode, 'fork');
});

test('polymarket trade execute in fork mode requires --polymarket-mock-url', () => {
  const result = runCli([
    '--output',
    'json',
    'polymarket',
    'trade',
    '--token-id',
    '12345',
    '--amount-usdc',
    '1',
    '--execute',
    '--fork-rpc-url',
    'http://127.0.0.1:8545',
  ]);

  assert.equal(result.status, 1, result.output);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'FORK_EXECUTION_REQUIRES_MOCK_URL');
});

test('polymarket fork mode reports structured missing FORK_RPC_URL errors', () => {
  const result = runCli(
    ['--output', 'json', 'polymarket', 'check', '--fork'],
    { unsetEnvKeys: ['FORK_RPC_URL'] },
  );

  assert.equal(result.status, 1, result.output);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'MISSING_REQUIRED_FLAG');
});

test('polymarket fork mode validates FORK_RPC_URL from env', () => {
  const result = runCli(
    ['--output', 'json', 'polymarket', 'check', '--fork'],
    { env: { FORK_RPC_URL: 'ftp://example.com' } },
  );

  assert.equal(result.status, 1, result.output);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
});

test('model calibrate returns jump-diffusion artifact and persists with --save-model', () => {
  const tempDir = createTempDir('pandora-model-calibrate-cli-');
  const modelPath = path.join(tempDir, 'jd-model.json');

  try {
    const result = runCli([
      '--output',
      'json',
      'model',
      'calibrate',
      '--returns',
      '0.03,-0.04,0.01,-0.02,0.05,-0.06,0.02,-0.01',
      '--jump-threshold-sigma',
      '1.2',
      '--model-id',
      'cli-jd',
      '--save-model',
      modelPath,
    ]);

    assert.equal(result.status, 0, result.output);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'model.calibrate');
    assert.equal(payload.data.model.kind, 'jump_diffusion');
    assert.equal(payload.data.model.modelId, 'cli-jd');
    assert.equal(payload.data.persistence.saved, true);
    assert.equal(fs.existsSync(modelPath), true);
  } finally {
    removeDir(tempDir);
  }
});

test('model correlation defaults to t-copula and emits stress metrics', () => {
  const result = runCli([
    '--output',
    'json',
    'model',
    'correlation',
    '--series',
    'btc:0.03,-0.04,0.01,-0.02,0.05,-0.06,0.02,-0.01',
    '--series',
    'eth:0.04,-0.05,0.02,-0.01,0.06,-0.08,0.03,-0.02',
    '--series',
    'sol:0.05,-0.06,0.02,-0.03,0.07,-0.1,0.04,-0.02',
    '--compare',
    'gaussian,clayton',
  ]);

  assert.equal(result.status, 0, result.output);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'model.correlation');
  assert.equal(payload.data.copula.family, 't');
  assert.equal(payload.data.metrics.labels.length, 3);
  assert.ok(payload.data.metrics.pairwise.length >= 3);
  assert.equal(typeof payload.data.stress.jointExtremeProbability, 'number');
  assert.equal(Array.isArray(payload.data.stress.scenarioResults), true);
});
