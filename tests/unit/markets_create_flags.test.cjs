const test = require('node:test');
const assert = require('node:assert/strict');

const { createParseMarketsCreateFlags } = require('../../cli/lib/parsers/markets_create_flags.cjs');

class TestCliError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'TestCliError';
    this.code = code;
    this.details = details;
  }
}

function requireFlagValue(args, index, flagName) {
  const value = args[index + 1];
  if (typeof value !== 'string' || value.startsWith('--')) {
    throw new TestCliError('MISSING_FLAG_VALUE', `${flagName} requires a value.`);
  }
  return value;
}

function parsePositiveNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new TestCliError('INVALID_FLAG_VALUE', `${flagName} must be a positive number.`);
  }
  return parsed;
}

function parsePositiveInteger(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new TestCliError('INVALID_FLAG_VALUE', `${flagName} must be a positive integer.`);
  }
  return parsed;
}

function parseInteger(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new TestCliError('INVALID_FLAG_VALUE', `${flagName} must be an integer.`);
  }
  return parsed;
}

function parseAddressFlag(value, flagName) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(value || ''))) {
    throw new TestCliError('INVALID_FLAG_VALUE', `${flagName} must be an EVM address.`);
  }
  return String(value).toLowerCase();
}

function parsePrivateKeyFlag(value, flagName) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(value || ''))) {
    throw new TestCliError('INVALID_FLAG_VALUE', `${flagName} must be 0x + 64 hex chars.`);
  }
  return String(value);
}

function isSecureHttpUrlOrLocal(value) {
  return /^https:\/\//.test(String(value || '')) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(String(value || ''));
}

function buildParser() {
  return createParseMarketsCreateFlags({
    CliError: TestCliError,
    parseAddressFlag,
    parsePrivateKeyFlag,
    requireFlagValue,
    parsePositiveNumber,
    parsePositiveInteger,
    parseInteger,
    isSecureHttpUrlOrLocal,
  });
}

test('parseMarketsCreateFlags parses parimutuel plan payloads with curve controls', () => {
  const parseMarketsCreateFlags = buildParser();
  const parsed = parseMarketsCreateFlags([
    'plan',
    '--question',
    'Will Arsenal beat Chelsea?',
    '--rules',
    'YES if Arsenal wins in regulation.',
    '--sources',
    'https://one.example',
    'https://two.example',
    '--target-timestamp',
    '2030-01-01T12:00:00Z',
    '--market-type',
    'parimutuel',
    '--curve-flattener',
    '9',
    '--curve-offset',
    '25000',
    '--liquidity-usdc',
    '100',
    '--distribution-yes-pct',
    '62',
    '--distribution-no-pct',
    '38',
  ]);

  assert.equal(parsed.command, 'markets.create.plan');
  assert.equal(parsed.options.marketType, 'parimutuel');
  assert.equal(parsed.options.curveFlattener, 9);
  assert.equal(parsed.options.curveOffset, 25000);
  assert.equal(parsed.options.liquidityUsdc, 100);
  assert.deepEqual(parsed.options.sources, ['https://one.example', 'https://two.example']);
  assert.equal(parsed.options.targetTimestamp, 1893499200);
  assert.equal(parsed.options.dryRun, false);
  assert.equal(parsed.options.execute, false);
  assert.equal(parsed.options.distributionYes + parsed.options.distributionNo, 1_000_000_000);
});

test('parseMarketsCreateFlags parses amm run payloads with signer/profile-safe flags', () => {
  const parseMarketsCreateFlags = buildParser();
  const parsed = parseMarketsCreateFlags([
    'run',
    '--question',
    'Will BTC close above 100k?',
    '--rules',
    'YES if BTC/USD close is above 100k.',
    '--sources',
    'https://one.example,https://two.example',
    '--target-timestamp',
    '1893499200',
    '--dry-run',
    '--liquidity-usdc',
    '250',
    '--fee-tier',
    '3000',
    '--max-imbalance',
    '100',
    '--profile-id',
    'desk_signer',
    '--chain-id',
    '1',
    '--rpc-url',
    'https://rpc.example',
    '--oracle',
    '0x1111111111111111111111111111111111111111',
    '--factory',
    '0x2222222222222222222222222222222222222222',
    '--usdc',
    '0x3333333333333333333333333333333333333333',
    '--arbiter',
    '0x4444444444444444444444444444444444444444',
    '--tx-route',
    'flashbots-bundle',
    '--tx-route-fallback',
    'public',
    '--flashbots-relay-url',
    'https://relay.flashbots.example',
    '--flashbots-auth-key',
    `0x${'a'.repeat(64)}`,
    '--flashbots-target-block-offset',
    '3',
    '--category',
    'crypto',
    '--min-close-lead-seconds',
    '3600',
    '--validation-ticket',
    'market-validate:ticket',
    '--initial-yes-pct',
    '77',
  ]);

  assert.equal(parsed.command, 'markets.create.run');
  assert.equal(parsed.options.marketType, 'amm');
  assert.equal(parsed.options.dryRun, true);
  assert.equal(parsed.options.execute, false);
  assert.equal(parsed.options.profileId, 'desk_signer');
  assert.equal(parsed.options.chainId, 1);
  assert.equal(parsed.options.rpcUrl, 'https://rpc.example');
  assert.equal(parsed.options.feeTier, 3000);
  assert.equal(parsed.options.maxImbalance, 100);
  assert.equal(parsed.options.category, 3);
  assert.equal(parsed.options.txRoute, 'flashbots-bundle');
  assert.equal(parsed.options.txRouteFallback, 'public');
  assert.equal(parsed.options.flashbotsRelayUrl, 'https://relay.flashbots.example');
  assert.equal(parsed.options.flashbotsAuthKey, `0x${'a'.repeat(64)}`);
  assert.equal(parsed.options.flashbotsTargetBlockOffset, 3);
  assert.equal(parsed.options.distributionYes, 230_000_000);
  assert.equal(parsed.options.distributionNo, 770_000_000);
  assert.equal(parsed.options.initialYesPct, 77);
});

test('parseMarketsCreateFlags rejects run without exactly one execution mode', () => {
  const parseMarketsCreateFlags = buildParser();

  assert.throws(
    () =>
      parseMarketsCreateFlags([
        'run',
        '--question',
        'Q',
        '--rules',
        'R',
        '--sources',
        'https://one.example',
        'https://two.example',
        '--target-timestamp',
        '1893499200',
        '--liquidity-usdc',
        '50',
      ]),
    (error) => error && error.code === 'INVALID_ARGS' && /exactly one mode/i.test(error.message),
  );
});

test('parseMarketsCreateFlags rejects plan with execution mode flags', () => {
  const parseMarketsCreateFlags = buildParser();

  assert.throws(
    () =>
      parseMarketsCreateFlags([
        'plan',
        '--question',
        'Q',
        '--rules',
        'R',
        '--sources',
        'https://one.example',
        'https://two.example',
        '--target-timestamp',
        '1893499200',
        '--liquidity-usdc',
        '50',
        '--dry-run',
      ]),
    (error) => error && error.code === 'INVALID_ARGS' && /read-only/i.test(error.message),
  );
});

test('parseMarketsCreateFlags rejects market-type-specific flag combinations', () => {
  const parseMarketsCreateFlags = buildParser();

  assert.throws(
    () =>
      parseMarketsCreateFlags([
        'run',
        '--question',
        'Q',
        '--rules',
        'R',
        '--sources',
        'https://one.example',
        'https://two.example',
        '--target-timestamp',
        '1893499200',
        '--liquidity-usdc',
        '50',
        '--market-type',
        'amm',
        '--dry-run',
        '--curve-flattener',
        '7',
      ]),
    (error) => error && error.code === 'INVALID_ARGS' && /does not accept --curve-flattener or --curve-offset/i.test(error.message),
  );

  assert.throws(
    () =>
      parseMarketsCreateFlags([
        'run',
        '--question',
        'Q',
        '--rules',
        'R',
        '--sources',
        'https://one.example',
        'https://two.example',
        '--target-timestamp',
        '1893499200',
        '--liquidity-usdc',
        '50',
        '--market-type',
        'parimutuel',
        '--dry-run',
        '--fee-tier',
        '3000',
      ]),
    (error) => error && error.code === 'INVALID_ARGS' && /does not accept --fee-tier or --max-imbalance/i.test(error.message),
  );
});

test('parseMarketsCreateFlags rejects flashbots flags when tx-route stays public', () => {
  const parseMarketsCreateFlags = buildParser();

  assert.throws(
    () =>
      parseMarketsCreateFlags([
        'run',
        '--question',
        'Q',
        '--rules',
        'R',
        '--sources',
        'https://one.example',
        'https://two.example',
        '--target-timestamp',
        '1893499200',
        '--liquidity-usdc',
        '50',
        '--dry-run',
        '--flashbots-relay-url',
        'https://relay.flashbots.example',
      ]),
    (error) => error && error.code === 'INVALID_ARGS' && /require --tx-route auto, flashbots-private, or flashbots-bundle/i.test(error.message),
  );
});

test('parseMarketsCreateFlags rejects invalid flashbots auth keys and run-only route flags on plan', () => {
  const parseMarketsCreateFlags = buildParser();

  assert.throws(
    () =>
      parseMarketsCreateFlags([
        'run',
        '--question',
        'Q',
        '--rules',
        'R',
        '--sources',
        'https://one.example',
        'https://two.example',
        '--target-timestamp',
        '1893499200',
        '--liquidity-usdc',
        '50',
        '--dry-run',
        '--tx-route',
        'flashbots-private',
        '--flashbots-auth-key',
        'bad-key',
      ]),
    (error) => error && error.code === 'INVALID_FLAG_VALUE' && /--flashbots-auth-key must be 0x \+ 64 hex chars/i.test(error.message),
  );

  assert.throws(
    () =>
      parseMarketsCreateFlags([
        'plan',
        '--question',
        'Q',
        '--rules',
        'R',
        '--sources',
        'https://one.example',
        'https://two.example',
        '--target-timestamp',
        '1893499200',
        '--liquidity-usdc',
        '50',
        '--tx-route',
        'public',
      ]),
    (error) => error && error.code === 'INVALID_ARGS' && /markets create plan is read-only; do not pass --tx-route/i.test(error.message),
  );
});

test('parseMarketsCreateFlags does not retain deploy route flags across parser calls', () => {
  const parseMarketsCreateFlags = buildParser();

  const runParsed = parseMarketsCreateFlags([
    'run',
    '--question',
    'Q',
    '--rules',
    'R',
    '--sources',
    'https://one.example',
    'https://two.example',
    '--target-timestamp',
    '1893499200',
    '--liquidity-usdc',
    '50',
    '--dry-run',
    '--tx-route',
    'public',
  ]);

  assert.equal(runParsed.command, 'markets.create.run');

  const planParsed = parseMarketsCreateFlags([
    'plan',
    '--question',
    'Q',
    '--rules',
    'R',
    '--sources',
    'https://one.example',
    'https://two.example',
    '--target-timestamp',
    '1893499200',
    '--liquidity-usdc',
    '50',
  ]);

  assert.equal(planParsed.command, 'markets.create.plan');
});

test('parseMarketsCreateFlags rejects mixed signer selectors and weak create payloads', () => {
  const parseMarketsCreateFlags = buildParser();

  assert.throws(
    () =>
      parseMarketsCreateFlags([
        'run',
        '--question',
        'Q',
        '--rules',
        'R',
        '--sources',
        'https://one.example',
        'https://two.example',
        '--target-timestamp',
        '1893499200',
        '--liquidity-usdc',
        '50',
        '--dry-run',
        '--private-key',
        `0x${'1'.repeat(64)}`,
        '--profile-id',
        'desk_signer',
      ]),
    (error) => error && error.code === 'INVALID_FLAG_COMBINATION',
  );

  assert.throws(
    () =>
      parseMarketsCreateFlags([
        'run',
        '--question',
        'Q',
        '--rules',
        'R',
        '--sources',
        'https://one.example',
        '--target-timestamp',
        '1893499200',
        '--liquidity-usdc',
        '50',
        '--dry-run',
      ]),
    (error) => error && error.code === 'MISSING_REQUIRED_FLAG' && /--sources/i.test(error.message),
  );
});

test('parseMarketsCreateFlags allows zero curve-offset and requires liquidity explicitly', () => {
  const parseMarketsCreateFlags = buildParser();

  const parsed = parseMarketsCreateFlags([
    'run',
    '--question',
    'Q',
    '--rules',
    'R',
    '--sources',
    'https://one.example',
    'https://two.example',
    '--target-timestamp',
    '1893499200',
    '--liquidity-usdc',
    '75',
    '--market-type',
    'parimutuel',
    '--curve-offset',
    '0',
    '--dry-run',
  ]);
  assert.equal(Number(parsed.options.curveOffset), 0);

  assert.throws(
    () =>
      parseMarketsCreateFlags([
        'run',
        '--question',
        'Q',
        '--rules',
        'R',
        '--sources',
        'https://one.example',
        'https://two.example',
        '--target-timestamp',
        '1893499200',
        '--dry-run',
      ]),
    (error) => error && error.code === 'MISSING_REQUIRED_FLAG' && /--liquidity-usdc/i.test(error.message),
  );
});
