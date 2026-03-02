const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createParseSimulateMcFlags,
  createParseSimulateParticleFilterFlags,
} = require('../../cli/lib/parsers/simulate_flags.cjs');

class ParserCliError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ParserCliError';
    this.code = code;
  }
}

function requireFlagValue(args, index, flagName) {
  const next = args[index + 1];
  if (!next || String(next).startsWith('--')) {
    throw new ParserCliError('MISSING_FLAG_VALUE', `Missing value for ${flagName}`);
  }
  return next;
}

function parsePositiveInteger(value, flagName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ParserCliError('INVALID_FLAG_VALUE', `${flagName} must be a positive integer.`);
  }
  return parsed;
}

function parsePositiveNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ParserCliError('INVALID_FLAG_VALUE', `${flagName} must be a positive number.`);
  }
  return parsed;
}

function parseProbabilityPercent(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new ParserCliError('INVALID_FLAG_VALUE', `${flagName} must be between 0 and 100.`);
  }
  return parsed;
}

function parseNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ParserCliError('INVALID_FLAG_VALUE', `${flagName} must be numeric.`);
  }
  return parsed;
}

function parseOutcomeSide(value, flagName) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'yes' || normalized === 'no') {
    return normalized;
  }
  throw new ParserCliError('INVALID_FLAG_VALUE', `${flagName} must be yes|no.`);
}

function parseNonNegativeInteger(value, flagName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ParserCliError('INVALID_FLAG_VALUE', `${flagName} must be a non-negative integer.`);
  }
  return parsed;
}

function buildParserDeps() {
  return {
    CliError: ParserCliError,
    requireFlagValue,
    parsePositiveInteger,
    parsePositiveNumber,
    parseProbabilityPercent,
    parseNumber,
    parseOutcomeSide,
    parseNonNegativeInteger,
  };
}

test('simulate mc parser supports deterministic replay and variance flags', () => {
  const parse = createParseSimulateMcFlags(buildParserDeps());
  const options = parse([
    '--trials',
    '1200',
    '--horizon',
    '32',
    '--start-yes-pct',
    '58',
    '--position',
    'no',
    '--stake-usdc',
    '250',
    '--drift-bps',
    '-5',
    '--vol-bps',
    '220',
    '--confidence',
    '90',
    '--var-level',
    '97.5',
    '--seed',
    '42',
    '--antithetic',
    '--stratified',
  ]);

  assert.equal(options.trials, 1200);
  assert.equal(options.horizon, 32);
  assert.equal(options.startYesPct, 58);
  assert.equal(options.entryYesPct, 58);
  assert.equal(options.positionSide, 'no');
  assert.equal(options.seed, 42);
  assert.equal(options.antithetic, true);
  assert.equal(options.stratified, true);
});

test('simulate mc parser enforces confidence bounds', () => {
  const parse = createParseSimulateMcFlags(buildParserDeps());

  assert.throws(
    () => parse(['--confidence', '50']),
    (error) => {
      assert.equal(error.code, 'INVALID_FLAG_VALUE');
      assert.match(error.message, /--confidence must be > 50 and < 100/i);
      return true;
    },
  );
});

test('simulate particle-filter parser requires exactly one observation source', () => {
  const parse = createParseSimulateParticleFilterFlags(buildParserDeps());

  assert.throws(
    () => parse(['--particles', '500']),
    (error) => {
      assert.equal(error.code, 'MISSING_REQUIRED_FLAG');
      return true;
    },
  );

  assert.throws(
    () => parse(['--stdin', '--observations-json', '[1,2,3]']),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGS');
      return true;
    },
  );
});

test('simulate particle-filter parser reads source + resampling options', () => {
  const parse = createParseSimulateParticleFilterFlags(buildParserDeps());
  const options = parse([
    '--observations-json',
    '[{"yesPct":52},{"yesPct":49}]',
    '--particles',
    '750',
    '--process-noise',
    '0.2',
    '--observation-noise',
    '0.09',
    '--resample-threshold',
    '0.4',
    '--resample-method',
    'multinomial',
    '--credible-interval',
    '95',
    '--seed',
    '9',
  ]);

  assert.equal(options.observationsJson.includes('yesPct'), true);
  assert.equal(options.particles, 750);
  assert.equal(options.processNoise, 0.2);
  assert.equal(options.observationNoise, 0.09);
  assert.equal(options.resampleThreshold, 0.4);
  assert.equal(options.resampleMethod, 'multinomial');
  assert.equal(options.credibleIntervalPct, 95);
  assert.equal(options.seed, 9);
});
