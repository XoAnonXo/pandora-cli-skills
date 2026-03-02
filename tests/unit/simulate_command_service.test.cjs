const test = require('node:test');
const assert = require('node:assert/strict');

const { createRunSimulateCommand } = require('../../cli/lib/simulate_command_service.cjs');

class TestCliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function buildService(overrides = {}) {
  const emitted = [];

  const service = createRunSimulateCommand({
    CliError: TestCliError,
    includesHelpFlag: (args) => Array.isArray(args) && (args.includes('--help') || args.includes('-h')),
    emitSuccess: (mode, command, data) => {
      emitted.push({ mode, command, data });
    },
    commandHelpPayload: (usage) => ({ usage }),
    parseSimulateMcFlags: (args) => ({ parsed: 'mc', args }),
    parseSimulateParticleFilterFlags: (args) => ({ parsed: 'pf', args }),
    runSimulateMc: async (options) => ({ result: 'mc', options }),
    runSimulateParticleFilter: async (options) => ({ result: 'pf', options }),
    runSimulateAgents: async ({ actionArgs, context }) => {
      emitted.push({
        mode: context.outputMode,
        command: 'simulate.agents',
        data: { result: 'agents', args: actionArgs },
      });
    },
    ...overrides,
  });

  return {
    run: service.runSimulateCommand,
    emitted,
  };
}

test('simulate command emits namespace help in json mode', async () => {
  const { run, emitted } = buildService();
  await run([], { outputMode: 'json' });

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].command, 'simulate.help');
  assert.match(emitted[0].data.usage, /simulate mc\|particle-filter\|agents/);
});

test('simulate mc dispatches parser and handler', async () => {
  const { run, emitted } = buildService();
  await run(['mc', '--trials', '1000'], { outputMode: 'json' });

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].command, 'simulate.mc');
  assert.equal(emitted[0].data.result, 'mc');
  assert.deepEqual(emitted[0].data.options.args, ['--trials', '1000']);
});

test('simulate particle-filter help is scoped per subcommand', async () => {
  const { run, emitted } = buildService();
  await run(['particle-filter', '--help'], { outputMode: 'json' });

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].command, 'simulate.particle-filter.help');
  assert.match(emitted[0].data.usage, /simulate particle-filter/);
});

test('simulate command rejects unknown subcommands', async () => {
  const { run } = buildService();

  await assert.rejects(
    () => run(['unknown'], { outputMode: 'json' }),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGS');
      assert.match(error.message, /simulate requires subcommand/);
      return true;
    },
  );
});

test('simulate agents dispatches to agents handler', async () => {
  const { run, emitted } = buildService();
  await run(['agents', '--n-informed', '4'], { outputMode: 'json' });

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].command, 'simulate.agents');
  assert.deepEqual(emitted[0].data.args, ['--n-informed', '4']);
});
