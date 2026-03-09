const test = require('node:test');
const assert = require('node:assert/strict');

const { createParseLpFlags } = require('../../cli/lib/parsers/lp_flags.cjs');

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
    throw new TestCliError('MISSING_FLAG_VALUE', `Missing value for ${flagName}`);
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

function parseAddress(value, flagName) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(value))) {
    throw new TestCliError('INVALID_FLAG_VALUE', `${flagName} must be an EVM address.`);
  }
  return value;
}

function isSecureHttpUrlOrLocal(value) {
  return /^https:\/\//.test(String(value)) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(String(value));
}

function buildParser() {
  return createParseLpFlags({
    CliError: TestCliError,
    parseAddressFlag: parseAddress,
    requireFlagValue,
    parsePositiveNumber,
    parseInteger,
    parsePositiveInteger,
    isValidPrivateKey: (value) => /^0x[a-fA-F0-9]{64}$/.test(String(value)),
    isSecureHttpUrlOrLocal,
    defaultTimeoutMs: 12000,
  });
}

const TEST_MARKET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

test('parseLpFlags supports remove --all without --lp-tokens', () => {
  const parseLpFlags = buildParser();
  const options = parseLpFlags(['remove', '--market-address', TEST_MARKET, '--all', '--dry-run']);
  assert.equal(options.action, 'remove');
  assert.equal(options.lpAll, true);
  assert.equal(options.lpTokens, null);
});

test('parseLpFlags rejects remove with both --lp-tokens and --all', () => {
  const parseLpFlags = buildParser();
  assert.throws(
    () => parseLpFlags(['remove', '--market-address', TEST_MARKET, '--lp-tokens', '10', '--all', '--dry-run']),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGS');
      assert.match(error.message, /Use only one remove mode/i);
      return true;
    },
  );
});

test('parseLpFlags rejects --all-markets combined with --lp-tokens', () => {
  const parseLpFlags = buildParser();
  assert.throws(
    () => parseLpFlags(['remove', '--all-markets', '--lp-tokens', '10', '--dry-run']),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGS');
      assert.match(error.message, /--all-markets cannot be combined with --lp-tokens/i);
      return true;
    },
  );
});

test('parseLpFlags rejects --all-markets combined with --market-address', () => {
  const parseLpFlags = buildParser();
  assert.throws(
    () => parseLpFlags(['remove', '--all-markets', '--market-address', TEST_MARKET, '--dry-run']),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGS');
      assert.match(error.message, /--all-markets cannot be combined with --market-address/i);
      return true;
    },
  );
});

test('parseLpFlags accepts simulate-remove preview mode without dry-run/execute', () => {
  const parseLpFlags = buildParser();
  const options = parseLpFlags(['simulate-remove', '--market-address', TEST_MARKET, '--lp-tokens', '12.5']);
  assert.equal(options.action, 'simulate-remove');
  assert.equal(options.lpTokens, 12.5);
  assert.equal(options.dryRun, false);
  assert.equal(options.execute, false);
});

test('parseLpFlags rejects simulate-remove with execute flags', () => {
  const parseLpFlags = buildParser();
  assert.throws(
    () => parseLpFlags(['simulate-remove', '--market-address', TEST_MARKET, '--lp-tokens', '12.5', '--dry-run']),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGS');
      assert.match(error.message, /preview-only/i);
      return true;
    },
  );
});
