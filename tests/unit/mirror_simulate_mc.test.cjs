const test = require('node:test');
const assert = require('node:assert/strict');

const { buildMirrorSimulate } = require('../../cli/lib/mirror_econ_service.cjs');
const { createParseMirrorSimulateFlags } = require('../../cli/lib/parsers/mirror_remaining_flags.cjs');
const { createParsePrimitives } = require('../../cli/lib/shared/parse_primitives.cjs');

class TestCliError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function buildParserDeps() {
  const primitives = createParsePrimitives({
    CliError: TestCliError,
    getMirrorSyncGateCodes: () => [],
    positionsOrderByFields: ['openedAt'],
    positionsOrderByFieldSet: new Set(['openedAt']),
  });
  return {
    CliError: TestCliError,
    ...primitives,
  };
}

test('mirror simulate keeps legacy linear mode payload shape by default', () => {
  const payload = buildMirrorSimulate({
    liquidityUsdc: 5000,
    sourceYesPct: 60,
    targetYesPct: 60,
    polymarketYesPct: 60,
    feeTier: 3000,
    hedgeRatio: 1,
    volumeScenarios: [500, 2500],
  });

  assert.equal(payload.schemaVersion, '1.0.0');
  assert.equal(payload.inputs.tradeSide, 'yes');
  assert.equal(Array.isArray(payload.scenarios), true);
  assert.equal(payload.scenarios.length, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'mc'), false);
});

test('mirror simulate mc returns summary, distribution, and tail risk with VaR/ES fields', () => {
  const payload = buildMirrorSimulate({
    engine: 'mc',
    liquidityUsdc: 5000,
    sourceYesPct: 60,
    targetYesPct: 60,
    polymarketYesPct: 60,
    feeTier: 3000,
    hedgeRatio: 1,
    paths: 600,
    steps: 24,
    seed: 19,
    antithetic: true,
    controlVariate: true,
    stratified: true,
    importanceSampling: true,
    volumeScenarios: [500, 2500],
  });

  assert.equal(payload.inputs.engine, 'mc');
  assert.equal(payload.mc.summary.paths, 600);
  assert.equal(payload.mc.summary.steps, 24);
  assert.equal(payload.mc.summary.seed, 19);
  assert.equal(typeof payload.mc.summary.expectedPnlUsdc, 'number');
  assert.equal(typeof payload.mc.distribution.pnlUsdcPercentiles.p50, 'number');
  assert.equal(typeof payload.mc.tailRisk.var95Usdc, 'number');
  assert.equal(typeof payload.mc.tailRisk.var99Usdc, 'number');
  assert.equal(typeof payload.mc.tailRisk.es95Usdc, 'number');
  assert.equal(typeof payload.mc.tailRisk.es99Usdc, 'number');
  assert.ok(payload.mc.tailRisk.var99Usdc >= payload.mc.tailRisk.var95Usdc);
  assert.ok(payload.mc.tailRisk.es99Usdc >= payload.mc.tailRisk.var99Usdc);
});

test('mirror simulate mc is deterministic when using the same seed', () => {
  const options = {
    engine: 'mc',
    liquidityUsdc: 5000,
    sourceYesPct: 60,
    targetYesPct: 60,
    polymarketYesPct: 60,
    paths: 400,
    steps: 20,
    seed: 123,
    antithetic: true,
    stratified: true,
    controlVariate: true,
    importanceSampling: true,
    volumeScenarios: [500, 2500],
  };

  const left = buildMirrorSimulate(options);
  const right = buildMirrorSimulate(options);

  assert.deepEqual(left.mc.summary, right.mc.summary);
  assert.deepEqual(left.mc.distribution, right.mc.distribution);
  assert.deepEqual(left.mc.tailRisk, right.mc.tailRisk);
});

test('createParseMirrorSimulateFlags parses mc variance-reduction flags', () => {
  const parseMirrorSimulateFlags = createParseMirrorSimulateFlags(buildParserDeps());

  const options = parseMirrorSimulateFlags([
    '--liquidity-usdc',
    '5000',
    '--engine',
    'mc',
    '--paths',
    '4096',
    '--steps',
    '64',
    '--seed',
    '7',
    '--importance-sampling',
    '--antithetic',
    '--control-variate',
    '--stratified',
  ]);

  assert.equal(options.engine, 'mc');
  assert.equal(options.paths, 4096);
  assert.equal(options.steps, 64);
  assert.equal(options.seed, 7);
  assert.equal(options.importanceSampling, true);
  assert.equal(options.antithetic, true);
  assert.equal(options.controlVariate, true);
  assert.equal(options.stratified, true);
});

test('createParseMirrorSimulateFlags validates --engine values', () => {
  const parseMirrorSimulateFlags = createParseMirrorSimulateFlags(buildParserDeps());

  assert.throws(
    () =>
      parseMirrorSimulateFlags([
        '--liquidity-usdc',
        '5000',
        '--engine',
        'stochastic',
      ]),
    (error) => {
      assert.equal(error.code, 'INVALID_FLAG_VALUE');
      assert.match(error.message, /--engine must be linear or mc/i);
      return true;
    },
  );
});
