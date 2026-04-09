const test = require('node:test');
const assert = require('node:assert/strict');

const { createRunAgentCommand } = require('../../cli/lib/agent_command_service.cjs');

class TestCliError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'TestCliError';
    this.code = code;
    this.details = details;
  }
}

function createAgentDeps(overrides = {}) {
  return {
    CliError: TestCliError,
    includesHelpFlag: () => false,
    emitSuccess: () => {},
    commandHelpPayload: (usage, notes) => ({ usage, notes }),
    ...overrides,
  };
}

test('agent autocomplete rejects a missing question value before the next flag', async () => {
  const { runAgentCommand } = createRunAgentCommand(createAgentDeps());

  await assert.rejects(
    () => runAgentCommand(['market', 'autocomplete', '--question', '--market-type', 'amm'], { outputMode: 'json' }),
    (error) => {
      assert.equal(error.code, 'MISSING_FLAG_VALUE');
      assert.match(error.message, /--question requires a value before --market-type/i);
      assert.deepEqual(error.details, {
        flag: '--question',
        nextToken: '--market-type',
      });
      return true;
    },
  );
});

test('agent validate rejects blank rules values as missing input', async () => {
  const { runAgentCommand } = createRunAgentCommand(createAgentDeps());

  await assert.rejects(
    () => runAgentCommand([
      'market',
      'validate',
      '--question',
      'Will deterministic tests pass?',
      '--rules',
      '',
      '--target-timestamp',
      '1735689600',
    ], { outputMode: 'json' }),
    (error) => {
      assert.equal(error.code, 'MISSING_FLAG_VALUE');
      assert.match(error.message, /--rules requires a value/i);
      assert.deepEqual(error.details, {
        flag: '--rules',
        nextToken: '',
      });
      return true;
    },
  );
});
