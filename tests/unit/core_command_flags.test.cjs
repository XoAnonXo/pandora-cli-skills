const test = require('node:test');
const assert = require('node:assert/strict');

const { createCoreCommandFlagParsers } = require('../../cli/lib/parsers/core_command_flags.cjs');

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

function parseNumber(value, flagName) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be numeric.`);
  }
  return numeric;
}

function parsePositiveNumber(value, flagName) {
  const numeric = parseNumber(value, flagName);
  if (numeric <= 0) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a positive number.`);
  }
  return numeric;
}

function parseInteger(value, flagName) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be an integer.`);
  }
  return numeric;
}

function parsePositiveInteger(value, flagName) {
  const numeric = parseInteger(value, flagName);
  if (numeric <= 0) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a positive integer.`);
  }
  return numeric;
}

function createParsers() {
  return createCoreCommandFlagParsers({
    CliError,
    formatErrorValue: (value) => String(value),
    hasWebhookTargets: () => false,
    requireFlagValue,
    parsePositiveInteger,
    parseInteger,
    parseNonNegativeInteger: (value, flagName) => {
      const numeric = parseInteger(value, flagName);
      if (numeric < 0) {
        throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be >= 0.`);
      }
      return numeric;
    },
    parsePositiveNumber,
    parseNumber,
    parseCsvList: (value) =>
      String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    parseProbabilityPercent: parseNumber,
    parseAddressFlag: (value) => String(value || '').toLowerCase(),
    parsePositionsOrderBy: (value) => value,
    parseOutcomeSide: (value) => value,
    mergeWhere: (left, _raw) => left,
    normalizeDirection: (value) => value,
    isSecureHttpUrlOrLocal: () => true,
    defaultEnvFile: '/tmp/.env',
    defaultEnvExample: '/tmp/.env.example',
    defaultRpcTimeoutMs: 1000,
    defaultIndexerTimeoutMs: 1000,
    defaultExpiringSoonHours: 24,
  });
}

test('parseArbitrageFlags accepts --min-spread-pct 0 for discovery flows', () => {
  const parsers = createParsers();
  const options = parsers.parseArbitrageFlags(['--min-spread-pct', '0']);
  assert.equal(options.minSpreadPct, 0);
});

test('parseArbitrageFlags rejects negative --min-spread-pct values', () => {
  const parsers = createParsers();
  assert.throws(
    () => parsers.parseArbitrageFlags(['--min-spread-pct', '-0.01']),
    (error) => error && error.code === 'INVALID_FLAG_VALUE' && /--min-spread-pct/.test(error.message),
  );
});

test('parseArbitrageFlags supports --min-token-score bounds', () => {
  const parsers = createParsers();
  const options = parsers.parseArbitrageFlags(['--min-token-score', '0.25']);
  assert.equal(options.minTokenScore, 0.25);

  assert.throws(
    () => parsers.parseArbitrageFlags(['--min-token-score', '1.5']),
    (error) => error && error.code === 'INVALID_FLAG_VALUE' && /--min-token-score/.test(error.message),
  );
});

test('parseQuoteFlags supports sell mode share sizing', () => {
  const parsers = createParsers();
  const options = parsers.parseQuoteFlags([
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--mode',
    'sell',
    '--shares',
    '12.5',
    '--amounts',
    '12.5,25',
  ]);

  assert.equal(options.mode, 'sell');
  assert.equal(options.amountUsdc, null);
  assert.equal(options.amount, 12.5);
  assert.deepEqual(options.amounts, [12.5, 25]);
});
