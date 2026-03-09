const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createParseModelCalibrateFlags } = require('../../cli/lib/parsers/model_flags.cjs');
const handleModelCalibrate = require('../../cli/lib/model_handlers/calibrate.cjs');

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

function parsePositiveInteger(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ParserCliError('INVALID_FLAG_VALUE', `${flagName} must be a positive integer.`);
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
  return createParseModelCalibrateFlags({
    CliError: ParserCliError,
    requireFlagValue,
    parseNumber,
    parsePositiveNumber,
    parsePositiveInteger,
    parseCsvList,
  });
}

test('createParseModelCalibrateFlags parses returns and optional controls', () => {
  const parse = buildParser();
  const options = parse([
    '--returns',
    '0.01,-0.02,0.03,-0.01,0.02',
    '--dt',
    '0.5',
    '--jump-threshold-sigma',
    '3',
    '--min-jump-count',
    '4',
    '--model-id',
    'desk-jd',
  ]);

  assert.equal(options.returns.length, 5);
  assert.equal(options.prices, null);
  assert.equal(options.dt, 0.5);
  assert.equal(options.jumpThresholdSigma, 3);
  assert.equal(options.minJumpCount, 4);
  assert.equal(options.modelId, 'desk-jd');
});

test('createParseModelCalibrateFlags rejects conflicting price/return inputs', () => {
  const parse = buildParser();
  assert.throws(
    () => parse(['--prices', '100,101,102', '--returns', '0.1,0.2,0.3']),
    (error) => error && error.code === 'INVALID_ARGS',
  );
});

test('model calibrate handler emits jump-diffusion payload and writes artifact', async () => {
  const parseModelCalibrateFlags = buildParser();
  const observed = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-model-calibrate-'));
  const artifactFile = path.join(tempDir, 'model.json');

  try {
    await handleModelCalibrate({
      actionArgs: [
        '--returns',
        '0.04,-0.07,0.02,0.01,-0.03,0.06,-0.08,0.02',
        '--jump-threshold-sigma',
        '1.1',
        '--model-id',
        'jd-test',
        '--save-model',
        artifactFile,
      ],
      context: { outputMode: 'json' },
      deps: {
        includesHelpFlag: () => false,
        emitSuccess: (mode, command, data) => observed.push({ mode, command, data }),
        commandHelpPayload: (usage) => ({ usage }),
        parseModelCalibrateFlags,
      },
    });

    assert.equal(observed.length, 1);
    assert.equal(observed[0].mode, 'json');
    assert.equal(observed[0].command, 'model.calibrate');
    assert.equal(observed[0].data.model.kind, 'jump_diffusion');
    assert.equal(observed[0].data.model.modelId, 'jd-test');
    assert.equal(typeof observed[0].data.model.parameters.sigmaPerSqrtStep, 'number');
    assert.equal(Array.isArray(observed[0].data.diagnostics.warnings), true);
    assert.equal(observed[0].data.persistence.saved, true);
    assert.equal(fs.existsSync(artifactFile), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
