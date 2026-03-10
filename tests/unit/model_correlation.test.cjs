const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createParseModelCorrelationFlags } = require('../../cli/lib/parsers/model_flags.cjs');
const handleModelCorrelation = require('../../cli/lib/model_handlers/correlation.cjs');

class ParserCliError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function requireFlagValue(args, i, flagName) {
  const value = args[i + 1];
  if (typeof value !== 'string' || value.startsWith('--')) {
    throw new ParserCliError('MISSING_FLAG_VALUE', `Missing value for ${flagName}`);
  }
  return value;
}

function parseNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ParserCliError('INVALID_FLAG_VALUE', `${flagName} must be numeric.`);
  }
  return parsed;
}

function parsePositiveNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ParserCliError('INVALID_FLAG_VALUE', `${flagName} must be positive.`);
  }
  return parsed;
}

function parseCsvList(value, flagName) {
  const list = String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!list.length) {
    throw new ParserCliError('INVALID_FLAG_VALUE', `${flagName} must include at least one value.`);
  }
  return list;
}

function buildParser() {
  return createParseModelCorrelationFlags({
    CliError: ParserCliError,
    requireFlagValue,
    parseNumber,
    parsePositiveNumber,
    parseCsvList,
  });
}

test('createParseModelCorrelationFlags parses multiple series and compare mode', () => {
  const parse = buildParser();
  const options = parse([
    '--series',
    'a:0.01,-0.01,0.02,-0.03,0.01',
    '--series',
    'b:0.02,-0.02,0.01,-0.01,0.02',
    '--copula',
    't',
    '--compare',
    'gaussian,clayton,gumbel',
    '--tail-alpha',
    '0.1',
    '--df',
    '7',
  ]);

  assert.equal(options.series.length, 2);
  assert.equal(options.copula, 't');
  assert.deepEqual(options.compare, ['gaussian', 'clayton', 'gumbel']);
  assert.equal(options.tailAlpha, 0.1);
  assert.equal(options.degreesOfFreedom, 7);
});

test('createParseModelCorrelationFlags parses semicolon-delimited series lists from one flag', () => {
  const parse = buildParser();
  const options = parse([
    '--series',
    'a:0.01,-0.01,0.02,-0.03,0.01;b:0.02,-0.02,0.01,-0.01,0.02',
  ]);

  assert.equal(options.series.length, 2);
  assert.deepEqual(options.series.map((item) => item.id), ['a', 'b']);
});

test('createParseModelCorrelationFlags enforces equal-length series', () => {
  const parse = buildParser();
  assert.throws(
    () =>
      parse([
        '--series',
        'a:0.01,-0.01,0.02',
        '--series',
        'b:0.01,-0.02,0.03,0.04',
      ]),
    (error) => error && error.code === 'INVALID_ARGS',
  );
});

test('model correlation handler returns t-copula tail metrics and stress output', async () => {
  const parseModelCorrelationFlags = buildParser();
  const observed = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-model-correlation-'));
  const artifactFile = path.join(tempDir, 'copula-model.json');

  try {
    await handleModelCorrelation({
      actionArgs: [
        '--series',
        'btc:0.03,-0.04,0.01,-0.02,0.05,-0.06,0.02,-0.01',
        '--series',
        'eth:0.04,-0.05,0.02,-0.01,0.06,-0.08,0.03,-0.02',
        '--series',
        'sol:0.05,-0.06,0.02,-0.03,0.07,-0.1,0.04,-0.02',
        '--copula',
        't',
        '--compare',
        'gaussian,gumbel',
        '--model-id',
        'copula-test',
        '--save-model',
        artifactFile,
      ],
      context: { outputMode: 'json' },
      deps: {
        includesHelpFlag: () => false,
        emitSuccess: (mode, command, data) => observed.push({ mode, command, data }),
        commandHelpPayload: (usage) => ({ usage }),
        parseModelCorrelationFlags,
      },
    });

    assert.equal(observed.length, 1);
    assert.equal(observed[0].mode, 'json');
    assert.equal(observed[0].command, 'model.correlation');
    assert.equal(observed[0].data.copula.family, 't');
    assert.equal(observed[0].data.metrics.labels.length, 3);
    assert.ok(observed[0].data.metrics.pairwise.length >= 3);
    assert.equal(typeof observed[0].data.stress.jointExtremeProbability, 'number');
    assert.equal(observed[0].data.comparisons.length, 2);
    assert.equal(observed[0].data.persistence.saved, true);
    assert.equal(fs.existsSync(artifactFile), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
