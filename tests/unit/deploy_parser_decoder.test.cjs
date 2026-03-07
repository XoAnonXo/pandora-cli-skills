const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDeploymentArgs, deployPandoraAmmMarket } = require('../../cli/lib/pandora_deploy_service.cjs');
const { formatDecodedContractError } = require('../../cli/lib/contract_error_decoder.cjs');
const { createParseMirrorDeployFlags } = require('../../cli/lib/parsers/mirror_deploy_flags.cjs');
const { createParseMirrorGoFlags } = require('../../cli/lib/parsers/mirror_go_flags.cjs');
const { createParseSportsFlags } = require('../../cli/lib/parsers/sports_flags.cjs');
const { parsePollCategory } = require('../../cli/lib/shared/poll_categories.cjs');

class TestCliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const TEST_PRIVATE_KEY = `0x${'1'.repeat(64)}`;
const TEST_ACCOUNT = { address: '0x1111111111111111111111111111111111111111' };
const TEST_ORACLE = '0x2222222222222222222222222222222222222222';
const TEST_FACTORY = '0x3333333333333333333333333333333333333333';
const TEST_USDC = '0x4444444444444444444444444444444444444444';
const TEST_POLL = '0x5555555555555555555555555555555555555555';
const TEST_MARKET = '0x6666666666666666666666666666666666666666';
const FUTURE_TS = Math.floor(Date.now() / 1000) + 7_200;
const MAX_UINT24 = 16_777_215;
const ORIGINAL_MCP_MODE = process.env.PANDORA_MCP_MODE;

function requireFlagValue(args, index, flagName) {
  const value = args[index + 1];
  if (typeof value !== 'string' || value.startsWith('--')) {
    throw new TestCliError('MISSING_FLAG_VALUE', `${flagName} requires a value.`);
  }
  return value;
}

function parseInteger(value, flagName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new TestCliError('INVALID_FLAG_VALUE', `${flagName} must be an integer.`);
  }
  return parsed;
}

function parsePositiveInteger(value, flagName) {
  const parsed = parseInteger(value, flagName);
  if (parsed <= 0) {
    throw new TestCliError('INVALID_FLAG_VALUE', `${flagName} must be a positive integer.`);
  }
  return parsed;
}

function parsePositiveNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new TestCliError('INVALID_FLAG_VALUE', `${flagName} must be a positive number.`);
  }
  return parsed;
}

function parseNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TestCliError('INVALID_FLAG_VALUE', `${flagName} must be numeric.`);
  }
  return parsed;
}

function parseAddressFlag(value, flagName) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(value))) {
    throw new TestCliError('INVALID_FLAG_VALUE', `${flagName} must be an EVM address.`);
  }
  return String(value).toLowerCase();
}

function parsePrivateKeyFlag(value, flagName) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(value))) {
    throw new TestCliError('INVALID_FLAG_VALUE', `${flagName} must be a 32-byte hex key.`);
  }
  return value;
}

function isSecureHttpUrlOrLocal(value) {
  return /^https:\/\//.test(String(value)) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(String(value));
}

function parseCsvList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDateLikeFlag(value, flagName) {
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw new TestCliError('INVALID_FLAG_VALUE', `${flagName} must be an ISO date/time string.`);
  }
  return String(value);
}

function parseMirrorSyncGateSkipList(value) {
  return String(value)
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function mergeMirrorSyncGateSkipLists(left, right) {
  return Array.from(new Set([...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]));
}

function buildMirrorParserDeps() {
  return {
    CliError: TestCliError,
    parseAddressFlag,
    parsePrivateKeyFlag,
    requireFlagValue,
    parsePositiveNumber,
    parsePositiveInteger,
    parseInteger,
    isSecureHttpUrlOrLocal,
    parseMirrorSyncGateSkipList,
    mergeMirrorSyncGateSkipLists,
  };
}

function withMcpMode(fn) {
  process.env.PANDORA_MCP_MODE = '1';
  try {
    return fn();
  } finally {
    if (ORIGINAL_MCP_MODE === undefined) {
      delete process.env.PANDORA_MCP_MODE;
    } else {
      process.env.PANDORA_MCP_MODE = ORIGINAL_MCP_MODE;
    }
  }
}

function buildSportsParserDeps() {
  return {
    CliError: TestCliError,
    requireFlagValue,
    parseAddressFlag,
    parsePrivateKeyFlag,
    parsePositiveInteger,
    parsePositiveNumber,
    parseInteger,
    parseNumber,
    parseCsvList,
    parseDateLikeFlag,
    isSecureHttpUrlOrLocal,
  };
}

function baseDeployOptions(overrides = {}) {
  return {
    execute: true,
    question: 'Will deploy parser tests pass?',
    rules: 'Rules text',
    sources: ['https://one.test', 'https://two.test'],
    targetTimestamp: FUTURE_TS,
    liquidityUsdc: 100,
    distributionYes: 500_000_000,
    distributionNo: 500_000_000,
    feeTier: 3000,
    maxImbalance: MAX_UINT24,
    privateKey: TEST_PRIVATE_KEY,
    account: TEST_ACCOUNT,
    oracle: TEST_ORACLE,
    factory: TEST_FACTORY,
    usdc: TEST_USDC,
    rpcUrl: 'https://ethereum.publicnode.com',
    chainId: 1,
    ...overrides,
  };
}

function createDeployClients(overrides = {}) {
  const hashes = ['0xaaa', '0xbbb', '0xccc'];
  const publicClient = {
    readContract: async ({ functionName }) => {
      if (functionName === 'operatorGasFee') return 1_000n;
      if (functionName === 'protocolFee') return 500n;
      if (functionName === 'MAX_RULES_LENGTH') return 256n;
      if (functionName === 'balanceOf') return 1_000_000_000n;
      if (functionName === 'allowance') return 0n;
      throw new Error(`Unexpected readContract: ${functionName}`);
    },
    getBalance: async () => 10_000_000_000_000_000_000n,
    getGasPrice: async () => 1_000_000_000n,
    estimateContractGas: async (request) => {
      if (request.functionName === 'createPoll') return 120_000n;
      if (request.functionName === 'approve') return 40_000n;
      return 50_000n;
    },
    simulateContract: async ({ functionName }) => {
      if (functionName === 'createPoll') {
        return {
          request: {
            account: TEST_ACCOUNT,
            address: TEST_ORACLE,
            abi: [],
            functionName: 'createPoll',
            args: [],
            value: 1_500n,
          },
          result: TEST_POLL,
        };
      }
      if (functionName === 'createMarket') {
        return {
          request: {
            account: TEST_ACCOUNT,
            address: TEST_FACTORY,
            abi: [],
            functionName: 'createMarket',
            args: [],
          },
          result: TEST_MARKET,
        };
      }
      throw new Error(`Unexpected simulateContract: ${functionName}`);
    },
    waitForTransactionReceipt: async () => ({ logs: [] }),
    ...overrides.publicClient,
  };

  const walletClient = {
    writeContract: async () => hashes.shift() || '0xddd',
    ...overrides.walletClient,
  };

  return { publicClient, walletClient };
}

test('buildDeploymentArgs accepts zero and max uint24 maxImbalance bounds', () => {
  const zero = buildDeploymentArgs({
    question: 'Q',
    rules: 'R',
    sources: ['https://one.test', 'https://two.test'],
    targetTimestamp: FUTURE_TS,
    liquidityUsdc: 100,
    distributionYes: 500_000_000,
    distributionNo: 500_000_000,
    feeTier: 3000,
    maxImbalance: 0,
  });
  assert.equal(zero.maxImbalance, 0);

  const max = buildDeploymentArgs({
    question: 'Q',
    rules: 'R',
    sources: ['https://one.test', 'https://two.test'],
    targetTimestamp: FUTURE_TS,
    liquidityUsdc: 100,
    distributionYes: 500_000_000,
    distributionNo: 500_000_000,
    feeTier: 3000,
    maxImbalance: MAX_UINT24,
  });
  assert.equal(max.maxImbalance, MAX_UINT24);

  assert.throws(
    () =>
      buildDeploymentArgs({
        question: 'Q',
        rules: 'R',
        sources: ['https://one.test', 'https://two.test'],
        targetTimestamp: FUTURE_TS,
        liquidityUsdc: 100,
        distributionYes: 500_000_000,
        distributionNo: 500_000_000,
        feeTier: 3000,
        maxImbalance: MAX_UINT24 + 1,
      }),
    /between 0 and 16777215/,
  );
});

test('formatDecodedContractError maps updated deploy/trade semantics', () => {
  assert.match(
    formatDecodedContractError({ errorName: 'InvalidRulesLength' }),
    /rules text exceeds the oracle limit/i,
  );
  assert.match(
    formatDecodedContractError({ errorName: 'PriceSwingExceeded', args: { before: '1', after: '2' } }),
    /configured max imbalance guard/i,
  );
  assert.match(
    formatDecodedContractError({ data: '0x7e2d7787' }),
    /trade too large/i,
  );
  assert.match(
    formatDecodedContractError({ data: '0x7e2d7787' }),
    /--max-imbalance/i,
  );
});

test('mirror deploy parser defaults maxImbalance to max uint24 and preserves explicit zero', () => {
  const parseMirrorDeployFlags = createParseMirrorDeployFlags(buildMirrorParserDeps());

  const defaults = parseMirrorDeployFlags(['--polymarket-market-id', 'poly-1', '--dry-run']);
  assert.equal(defaults.maxImbalance, MAX_UINT24);

  const explicitZero = parseMirrorDeployFlags([
    '--polymarket-market-id',
    'poly-1',
    '--dry-run',
    '--max-imbalance',
    '0',
  ]);
  assert.equal(Number(explicitZero.maxImbalance), 0);
  assert.equal(Boolean(explicitZero.maxImbalance), true);

  const distribution = parseMirrorDeployFlags([
    '--polymarket-market-id',
    'poly-1',
    '--dry-run',
    '--distribution-yes-pct',
    '63',
    '--validation-ticket',
    'market-validate:abc123',
  ]);
  assert.equal(distribution.distributionYes, 630_000_000);
  assert.equal(distribution.distributionNo, 370_000_000);
  assert.equal(distribution.validationTicket, 'market-validate:abc123');
});

test('mirror go parser defaults maxImbalance to max uint24 and accepts percentage distributions', () => {
  const parseMirrorGoFlags = createParseMirrorGoFlags(buildMirrorParserDeps());

  const defaults = parseMirrorGoFlags(['--polymarket-market-id', 'poly-1']);
  assert.equal(defaults.maxImbalance, MAX_UINT24);

  const explicitZero = parseMirrorGoFlags([
    '--polymarket-market-id',
    'poly-1',
    '--max-imbalance',
    '0',
  ]);
  assert.equal(Number(explicitZero.maxImbalance), 0);
  assert.equal(Boolean(explicitZero.maxImbalance), true);

  const distribution = parseMirrorGoFlags([
    '--polymarket-market-id',
    'poly-1',
    '--distribution-yes-pct',
    '40',
    '--distribution-no-pct',
    '60',
    '--validation-ticket',
    'market-validate:def456',
  ]);
  assert.equal(distribution.distributionYes, 400_000_000);
  assert.equal(distribution.distributionNo, 600_000_000);
  assert.equal(distribution.validationTicket, 'market-validate:def456');
});

test('mirror deploy parser blocks external file paths in MCP mode', () => {
  const parseMirrorDeployFlags = createParseMirrorDeployFlags(buildMirrorParserDeps());

  withMcpMode(() => {
    assert.throws(
      () => parseMirrorDeployFlags(['--plan-file', '/tmp/plan.json', '--dry-run']),
      (error) => error && error.code === 'MCP_FILE_ACCESS_BLOCKED',
    );

    assert.throws(
      () =>
        parseMirrorDeployFlags([
          '--polymarket-market-id',
          'poly-1',
          '--dry-run',
          '--manifest-file',
          '/tmp/pairs.json',
        ]),
      (error) => error && error.code === 'MCP_FILE_ACCESS_BLOCKED',
    );
  });
});

test('mirror deploy parser validates all polymarket URL override flags', () => {
  const parseMirrorDeployFlags = createParseMirrorDeployFlags(buildMirrorParserDeps());

  assert.throws(
    () =>
      parseMirrorDeployFlags([
        '--polymarket-market-id',
        'poly-1',
        '--dry-run',
        '--polymarket-gamma-url',
        'http://example.com/gamma',
      ]),
    (error) => error && error.code === 'INVALID_FLAG_VALUE',
  );

  const parsed = parseMirrorDeployFlags([
    '--polymarket-market-id',
    'poly-1',
    '--dry-run',
    '--polymarket-gamma-url',
    'https://gamma.polymarket.test',
    '--polymarket-mock-url',
    'http://localhost:4010/mock',
  ]);
  assert.equal(parsed.polymarketGammaUrl, 'https://gamma.polymarket.test');
  assert.equal(parsed.polymarketMockUrl, 'http://localhost:4010/mock');
});

test('sports parser defaults maxImbalance to max uint24 and accepts percentage distributions', () => {
  const parseSportsFlags = createParseSportsFlags(buildSportsParserDeps());

  const defaults = parseSportsFlags(['create', 'plan', '--event-id', 'evt-1']);
  assert.equal(defaults.options.maxImbalance, MAX_UINT24);

  const explicitZero = parseSportsFlags([
    'create',
    'plan',
    '--event-id',
    'evt-1',
    '--max-imbalance',
    '0',
    '--distribution-yes-pct',
    '63.5',
  ]);
  assert.equal(Number(explicitZero.options.maxImbalance), 0);
  assert.equal(Boolean(explicitZero.options.maxImbalance), true);
  assert.equal(explicitZero.options.distributionYes, 635_000_000);
  assert.equal(explicitZero.options.distributionNo, 365_000_000);
});

test('poll category helper and creation parsers accept canonical names alongside numeric ids', () => {
  assert.equal(parsePollCategory('Politics', { flagName: '--category' }), 0);
  assert.equal(parsePollCategory('technology', { flagName: '--category' }), 5);
  assert.equal(parsePollCategory('10', { flagName: '--category' }), 10);

  const parseMirrorDeployFlags = createParseMirrorDeployFlags(buildMirrorParserDeps());
  const deploy = parseMirrorDeployFlags([
    '--polymarket-market-id',
    'poly-1',
    '--dry-run',
    '--category',
    'Health',
  ]);
  assert.equal(deploy.category, 8);

  const parseMirrorGoFlags = createParseMirrorGoFlags(buildMirrorParserDeps());
  const go = parseMirrorGoFlags([
    '--polymarket-market-id',
    'poly-1',
    '--category',
    '0',
  ]);
  assert.equal(go.category, 0);

  const parseSportsFlags = createParseSportsFlags(buildSportsParserDeps());
  const sports = parseSportsFlags([
    'create',
    'plan',
    '--event-id',
    'evt-1',
    '--category',
    'Environment',
  ]);
  assert.equal(sports.options.category, 9);
});

test('sports-oriented creation parsers default category to PollCategory.Sports', () => {
  const parseMirrorDeployFlags = createParseMirrorDeployFlags(buildMirrorParserDeps());
  const deploy = parseMirrorDeployFlags([
    '--polymarket-market-id',
    'poly-1',
    '--dry-run',
  ]);
  assert.equal(deploy.category, 1);

  const parseMirrorGoFlags = createParseMirrorGoFlags(buildMirrorParserDeps());
  const go = parseMirrorGoFlags(['--polymarket-market-id', 'poly-1']);
  assert.equal(go.category, 1);

  const parseSportsFlags = createParseSportsFlags(buildSportsParserDeps());
  const sports = parseSportsFlags(['create', 'plan', '--event-id', 'evt-1']);
  assert.equal(sports.options.category, 1);
});

test('creation parsers reject unsupported poll category values with enum guidance', () => {
  const parseMirrorDeployFlags = createParseMirrorDeployFlags(buildMirrorParserDeps());
  assert.throws(
    () =>
      parseMirrorDeployFlags([
        '--polymarket-market-id',
        'poly-1',
        '--dry-run',
        '--category',
        'Gaming',
      ]),
    (error) => {
      assert.equal(error.code, 'INVALID_FLAG_VALUE');
      assert.match(error.message, /Politics\|Sports\|Finance\|Crypto\|Culture\|Technology\|Science\|Entertainment\|Health\|Environment\|Other/);
      return true;
    },
  );

  const parseSportsFlags = createParseSportsFlags(buildSportsParserDeps());
  assert.throws(
    () =>
      parseSportsFlags([
        'create',
        'plan',
        '--event-id',
        'evt-1',
        '--category',
        '11',
      ]),
    (error) => {
      assert.equal(error.code, 'INVALID_FLAG_VALUE');
      assert.match(error.message, /integer between 0 and 10/i);
      return true;
    },
  );
});

test('deployPandoraAmmMarket rejects overlong rules before any transaction simulation', async () => {
  let simulateCalled = false;
  const { publicClient, walletClient } = createDeployClients({
    publicClient: {
      readContract: async ({ functionName }) => {
        if (functionName === 'operatorGasFee') return 1_000n;
        if (functionName === 'protocolFee') return 500n;
        if (functionName === 'MAX_RULES_LENGTH') return 8n;
        if (functionName === 'balanceOf') return 1_000_000_000n;
        if (functionName === 'allowance') return 0n;
        throw new Error(`Unexpected readContract: ${functionName}`);
      },
      simulateContract: async () => {
        simulateCalled = true;
        throw new Error('simulate should not run');
      },
    },
  });

  await assert.rejects(
    () =>
      deployPandoraAmmMarket(
        baseDeployOptions({
          rules: 'this rules text is definitely longer than eight bytes',
          publicClient,
          walletClient,
        }),
      ),
    (error) => {
      assert.equal(error.code, 'INVALID_RULES_LENGTH');
      assert.match(error.message, /oracle limit is 8 bytes/i);
      return true;
    },
  );

  assert.equal(simulateCalled, false);
});

test('deployPandoraAmmMarket computes dynamic gas reserve from live fee data', async () => {
  const low = createDeployClients();
  const lowPayload = await deployPandoraAmmMarket(
    baseDeployOptions({
      publicClient: low.publicClient,
      walletClient: low.walletClient,
    }),
  );

  const high = createDeployClients({
    publicClient: {
      getGasPrice: async () => 2_000_000_000n,
    },
  });
  const highPayload = await deployPandoraAmmMarket(
    baseDeployOptions({
      publicClient: high.publicClient,
      walletClient: high.walletClient,
    }),
  );

  assert.equal(lowPayload.preflight.gasReserveSource, 'dynamic');
  assert.equal(highPayload.preflight.gasReserveSource, 'dynamic');
  assert.notEqual(lowPayload.preflight.gasReserveNative, '0.005');
  assert.notEqual(lowPayload.preflight.gasReserveNative, highPayload.preflight.gasReserveNative);
});
