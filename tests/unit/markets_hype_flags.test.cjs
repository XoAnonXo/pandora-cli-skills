const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createParseMarketsHypeFlags } = require('../../cli/lib/parsers/markets_hype_flags.cjs');

const WORKSPACE_PLAN_PATH = path.join(process.cwd(), 'tests', 'fixtures', 'hype-plan.json');

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
  return createParseMarketsHypeFlags({
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

test('parseMarketsHypeFlags parses run payloads with validated flashbots routing flags', () => {
  const parseMarketsHypeFlags = buildParser();
  const parsed = parseMarketsHypeFlags([
    'run',
    '--plan-file',
    WORKSPACE_PLAN_PATH,
    '--candidate-id',
    'cand-1',
    '--dry-run',
    '--market-type',
    'amm',
    '--liquidity-usdc',
    '150',
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
    'flashbots-private',
    '--tx-route-fallback',
    'public',
    '--flashbots-relay-url',
    'https://relay.flashbots.example',
    '--flashbots-auth-key',
    `0x${'b'.repeat(64)}`,
    '--flashbots-target-block-offset',
    '2',
  ]);

  assert.equal(parsed.command, 'markets.hype.run');
  assert.equal(parsed.options.txRoute, 'flashbots-private');
  assert.equal(parsed.options.txRouteFallback, 'public');
  assert.equal(parsed.options.flashbotsRelayUrl, 'https://relay.flashbots.example');
  assert.equal(parsed.options.flashbotsAuthKey, `0x${'b'.repeat(64)}`);
  assert.equal(parsed.options.flashbotsTargetBlockOffset, 2);
});

test('parseMarketsHypeFlags rejects invalid flashbots auth keys', () => {
  const parseMarketsHypeFlags = buildParser();

  assert.throws(
    () =>
      parseMarketsHypeFlags([
        'run',
        '--plan-file',
        WORKSPACE_PLAN_PATH,
        '--candidate-id',
        'cand-1',
        '--dry-run',
        '--tx-route',
        'flashbots-private',
        '--flashbots-auth-key',
        'bad-key',
      ]),
    (error) => error && error.code === 'INVALID_FLAG_VALUE' && /--flashbots-auth-key must be 0x \+ 64 hex chars/i.test(error.message),
  );
});

test('parseMarketsHypeFlags rejects tx-route flags on plan surfaces', () => {
  const parseMarketsHypeFlags = buildParser();

  assert.throws(
    () =>
      parseMarketsHypeFlags([
        'plan',
        '--area',
        'sports',
        '--tx-route',
        'public',
      ]),
    (error) => error && error.code === 'INVALID_ARGS' && /markets hype plan is read-only; do not pass --tx-route/i.test(error.message),
  );
});

test('parseMarketsHypeFlags does not retain deploy route flags across parser calls', () => {
  const parseMarketsHypeFlags = buildParser();

  const runParsed = parseMarketsHypeFlags([
    'run',
    '--plan-file',
    WORKSPACE_PLAN_PATH,
    '--candidate-id',
    'cand-1',
    '--dry-run',
    '--tx-route',
    'public',
  ]);

  assert.equal(runParsed.command, 'markets.hype.run');

  const planParsed = parseMarketsHypeFlags([
    'plan',
    '--area',
    'sports',
  ]);

  assert.equal(planParsed.command, 'markets.hype.plan');
});
