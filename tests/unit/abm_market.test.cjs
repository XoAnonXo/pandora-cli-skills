const test = require('node:test');
const assert = require('node:assert/strict');

const { runAbmMarket, normalizeAbmOptions } = require('../../cli/lib/quant/abm_market.cjs');
const handleSimulateAgents = require('../../cli/lib/simulate_handlers/agents.cjs');

const { parseSimulateAgentsFlags, SIMULATE_AGENTS_USAGE } = handleSimulateAgents;

class TestCliError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'TestCliError';
    this.code = code;
    this.details = details;
  }
}

function snapshot(payload) {
  return {
    parameters: payload.parameters,
    convergenceError: payload.convergenceError,
    spreadTrajectory: payload.spreadTrajectory,
    volume: payload.volume,
    pnlByAgentType: payload.pnlByAgentType,
    finalState: payload.finalState,
    runtimeBounds: payload.runtimeBounds,
  };
}

test('runAbmMarket returns required ABM metrics and trajectories', () => {
  const payload = runAbmMarket({
    n_informed: 5,
    n_noise: 18,
    n_mm: 4,
    n_steps: 30,
    seed: 99,
  });

  assert.equal(payload.parameters.n_informed, 5);
  assert.equal(payload.parameters.n_noise, 18);
  assert.equal(payload.parameters.n_mm, 4);
  assert.equal(payload.parameters.n_steps, 30);
  assert.equal(payload.parameters.seed, 99);
  assert.ok(Number.isFinite(payload.convergenceError));
  assert.equal(payload.spreadTrajectory.length, 30);
  assert.ok(payload.spreadTrajectory.every((point) => Number.isFinite(point.spreadBps)));
  assert.ok(Number.isFinite(payload.volume.total));
  assert.ok(Number.isFinite(payload.volume.byAgentType.informed));
  assert.ok(Number.isFinite(payload.volume.byAgentType.noise));
  assert.ok(Number.isFinite(payload.volume.byAgentType.market_maker));
  assert.ok(Number.isFinite(payload.pnlByAgentType.informed));
  assert.ok(Number.isFinite(payload.pnlByAgentType.noise));
  assert.ok(Number.isFinite(payload.pnlByAgentType.market_maker));
});

test('runAbmMarket is deterministic for identical seeds', () => {
  const left = runAbmMarket({
    n_informed: 8,
    n_noise: 20,
    n_mm: 3,
    n_steps: 40,
    seed: 12345,
  });
  const right = runAbmMarket({
    n_informed: 8,
    n_noise: 20,
    n_mm: 3,
    n_steps: 40,
    seed: 12345,
  });

  assert.deepEqual(snapshot(left), snapshot(right));
});

test('runAbmMarket responds to seed changes', () => {
  const left = runAbmMarket({
    n_informed: 8,
    n_noise: 20,
    n_mm: 3,
    n_steps: 40,
    seed: 100,
  });
  const right = runAbmMarket({
    n_informed: 8,
    n_noise: 20,
    n_mm: 3,
    n_steps: 40,
    seed: 101,
  });

  assert.notDeepEqual(snapshot(left), snapshot(right));
});

test('runAbmMarket enforces bounded step/agent limits', () => {
  assert.throws(
    () =>
      runAbmMarket({
        n_informed: 1001,
        n_noise: 10,
        n_mm: 2,
        n_steps: 10,
        seed: 1,
      }),
    /must be <= 1000/,
  );

  assert.throws(
    () =>
      runAbmMarket({
        n_informed: 10,
        n_noise: 10,
        n_mm: 2,
        n_steps: 10001,
        seed: 1,
      }),
    /must be <= 10000/,
  );
});

test('runAbmMarket includes runtime bound metadata', () => {
  const payload = runAbmMarket({
    n_informed: 6,
    n_noise: 9,
    n_mm: 2,
    n_steps: 25,
    seed: 77,
  });

  assert.equal(payload.runtimeBounds.complexity, 'O(n_steps * (n_informed + n_noise))');
  assert.equal(payload.runtimeBounds.estimatedAgentDecisions, 25 * (6 + 9));
  assert.equal(payload.runtimeBounds.estimatedWorkUnits, 25 * (6 + 9 + 2));
});

test('normalizeAbmOptions accepts snake_case and camelCase forms', () => {
  const normalizedSnake = normalizeAbmOptions({
    n_informed: 4,
    n_noise: 10,
    n_mm: 2,
    n_steps: 12,
    seed: 8,
  });
  const normalizedCamel = normalizeAbmOptions({
    nInformed: 4,
    nNoise: 10,
    nMm: 2,
    nSteps: 12,
    seed: 8,
  });

  assert.deepEqual(normalizedSnake, normalizedCamel);
});

test('parseSimulateAgentsFlags parses supported aliases', () => {
  const options = parseSimulateAgentsFlags(
    ['--n-informed', '3', '--n_noise', '7', '--n-mm', '2', '--n_steps', '15', '--seed', '42'],
    { CliError: TestCliError },
  );

  assert.deepEqual(options, {
    n_informed: 3,
    n_noise: 7,
    n_mm: 2,
    n_steps: 15,
    seed: 42,
  });
});

test('parseSimulateAgentsFlags rejects unknown flags', () => {
  assert.throws(
    () => parseSimulateAgentsFlags(['--unknown-flag'], { CliError: TestCliError }),
    (error) => {
      assert.equal(error instanceof TestCliError, true);
      assert.equal(error.code, 'UNKNOWN_FLAG');
      return true;
    },
  );
});

test('parseSimulateAgentsFlags enforces bounded agent/step limits', () => {
  assert.throws(
    () => parseSimulateAgentsFlags(['--n-informed', '1001'], { CliError: TestCliError }),
    (error) => {
      assert.equal(error instanceof TestCliError, true);
      assert.equal(error.code, 'INVALID_FLAG_VALUE');
      return true;
    },
  );

  assert.throws(
    () => parseSimulateAgentsFlags(['--n-steps', '10001'], { CliError: TestCliError }),
    (error) => {
      assert.equal(error instanceof TestCliError, true);
      assert.equal(error.code, 'INVALID_FLAG_VALUE');
      return true;
    },
  );
});

test('simulate agents handler emits help payload in json mode', async () => {
  const emitted = [];
  await handleSimulateAgents({
    actionArgs: ['--help'],
    context: { outputMode: 'json' },
    deps: {
      emitSuccess: (mode, command, data) => emitted.push({ mode, command, data }),
      commandHelpPayload: (usage) => ({ usage }),
    },
  });

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].mode, 'json');
  assert.equal(emitted[0].command, 'simulate.agents.help');
  assert.equal(emitted[0].data.usage, SIMULATE_AGENTS_USAGE);
});

test('simulate agents handler emits simulation payload', async () => {
  const emitted = [];
  let receivedOptions = null;

  await handleSimulateAgents({
    actionArgs: ['--n-informed', '4', '--n-noise', '12', '--n-mm', '2', '--n-steps', '10', '--seed', '5'],
    context: { outputMode: 'json' },
    deps: {
      CliError: TestCliError,
      emitSuccess: (mode, command, data) => emitted.push({ mode, command, data }),
      runAbmMarket: (options) => {
        receivedOptions = options;
        return {
          parameters: { n_informed: 4, n_noise: 12, n_mm: 2, n_steps: 10, seed: 5 },
          convergenceError: 0.01,
          spreadTrajectory: [],
          volume: { total: 0, averagePerStep: 0, byAgentType: { informed: 0, noise: 0, market_maker: 0 } },
          pnlByAgentType: { informed: 0, noise: 0, market_maker: 0, total: 0 },
          finalState: { midPrice: 0.5, fundamentalValue: 0.51, distanceToFundamental: 0.01 },
          runtimeBounds: {
            complexity: 'O(n_steps * (n_informed + n_noise))',
            estimatedAgentDecisions: 160,
            estimatedWorkUnits: 180,
            notes: 'test',
          },
        };
      },
    },
  });

  assert.deepEqual(receivedOptions, {
    n_informed: 4,
    n_noise: 12,
    n_mm: 2,
    n_steps: 10,
    seed: 5,
  });
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].mode, 'json');
  assert.equal(emitted[0].command, 'simulate.agents');
});

test('simulate agents handler surfaces parser errors as CliError', async () => {
  await assert.rejects(
    () =>
      handleSimulateAgents({
        actionArgs: ['--bad'],
        context: { outputMode: 'json' },
        deps: { CliError: TestCliError },
      }),
    (error) => {
      assert.equal(error instanceof TestCliError, true);
      assert.equal(error.code, 'UNKNOWN_FLAG');
      return true;
    },
  );
});
