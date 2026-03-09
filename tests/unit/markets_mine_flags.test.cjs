const test = require('node:test');
const assert = require('node:assert/strict');

const { createParseMarketsMineFlags } = require('../../cli/lib/parsers/markets_mine_flags.cjs');

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function requireFlagValue(args, index, flagName) {
  const next = args[index + 1];
  if (next === undefined) {
    throw new CliError('MISSING_FLAG_VALUE', `${flagName} requires a value.`);
  }
  return next;
}

function parseInteger(value, flagName) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be an integer.`);
  }
  return numeric;
}

function createParser() {
  return createParseMarketsMineFlags({
    CliError,
    parseAddressFlag: (value) => String(value || '').toLowerCase(),
    requireFlagValue,
    parseInteger,
    isValidPrivateKey: (value) => /^0x[a-fA-F0-9]{64}$/.test(String(value || '')),
    isSecureHttpUrlOrLocal: (value) => /^https:\/\//.test(String(value || '')) || /^http:\/\/(localhost|127\.0\.0\.1)/.test(String(value || '')),
  });
}

test('parseMarketsMineFlags allows env-backed signer discovery with no explicit wallet flags', () => {
  const parseMarketsMineFlags = createParser();
  const options = parseMarketsMineFlags([]);
  assert.equal(options.wallet, null);
  assert.equal(options.privateKey, null);
  assert.equal(options.profileId, null);
  assert.equal(options.profileFile, null);
  assert.equal(options.chainId, 1);
});

test('parseMarketsMineFlags rejects non-positive chain ids', () => {
  const parseMarketsMineFlags = createParser();
  assert.throws(
    () => parseMarketsMineFlags(['--chain-id', '0']),
    (error) => error && error.code === 'INVALID_FLAG_VALUE' && /--chain-id/.test(error.message),
  );
});
