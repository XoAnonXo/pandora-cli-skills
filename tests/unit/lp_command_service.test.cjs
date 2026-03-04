const test = require('node:test');
const assert = require('node:assert/strict');

const { createRunLpCommand } = require('../../cli/lib/lp_command_service.cjs');

class TestCliError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'TestCliError';
    this.code = code;
    this.details = details;
  }
}

test('runLpCommand loads env via shared parser and forwards shared indexer timeout fields', async () => {
  const observed = {
    parseIndexerArgs: null,
    maybeLoadTradeEnvCalls: 0,
    parseLpArgs: null,
    runLpOptions: null,
    emitted: null,
  };

  const runLpCommand = createRunLpCommand({
    includesHelpFlag: () => false,
    emitSuccess: (mode, command, payload) => {
      observed.emitted = { mode, command, payload };
    },
    commandHelpPayload: (usage) => ({ usage }),
    parseIndexerSharedFlags: (args) => {
      observed.parseIndexerArgs = args;
      return {
        envFile: '/tmp/.env',
        envFileExplicit: true,
        useEnvFile: true,
        indexerUrl: 'https://indexer.test',
        timeoutMs: 9876,
        rest: ['remove', '--market-address', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '--all', '--dry-run'],
      };
    },
    maybeLoadTradeEnv: () => {
      observed.maybeLoadTradeEnvCalls += 1;
    },
    parseLpFlags: (args) => {
      observed.parseLpArgs = args;
      return {
        action: 'remove',
        execute: false,
        fork: false,
        forkRpcUrl: null,
        indexerUrl: null,
        timeoutMs: 12000,
      };
    },
    runLp: async (options) => {
      observed.runLpOptions = options;
      return {
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        action: 'remove',
        status: 'planned',
      };
    },
    renderSingleEntityTable: () => null,
    CliError: TestCliError,
  });

  await runLpCommand(
    ['--dotenv-path', '/tmp/.env', '--indexer-url', 'https://indexer.test', '--timeout-ms', '9876', 'remove'],
    { outputMode: 'json' },
  );

  assert.deepEqual(observed.parseIndexerArgs, [
    '--dotenv-path',
    '/tmp/.env',
    '--indexer-url',
    'https://indexer.test',
    '--timeout-ms',
    '9876',
    'remove',
  ]);
  assert.equal(observed.maybeLoadTradeEnvCalls, 1);
  assert.deepEqual(observed.parseLpArgs, [
    'remove',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--all',
    '--dry-run',
  ]);
  assert.equal(observed.runLpOptions.indexerUrl, 'https://indexer.test');
  assert.equal(observed.runLpOptions.timeoutMs, 9876);
  assert.ok(observed.emitted);
  assert.equal(observed.emitted.mode, 'json');
  assert.equal(observed.emitted.command, 'lp');
});

test('runLpCommand help output includes --all remove mode', async () => {
  let helpUsage = null;
  const runLpCommand = createRunLpCommand({
    includesHelpFlag: () => true,
    emitSuccess: (_mode, _command, payload) => {
      helpUsage = payload.usage;
    },
    commandHelpPayload: (usage) => ({ usage }),
    parseIndexerSharedFlags: () => {
      throw new Error('parseIndexerSharedFlags should not be called for help path.');
    },
    maybeLoadTradeEnv: () => {
      throw new Error('maybeLoadTradeEnv should not be called for help path.');
    },
    parseLpFlags: () => {
      throw new Error('parseLpFlags should not be called for help path.');
    },
    runLp: async () => {
      throw new Error('runLp should not be called for help path.');
    },
    renderSingleEntityTable: () => null,
    CliError: TestCliError,
  });

  await runLpCommand(['--help'], { outputMode: 'json' });

  assert.equal(typeof helpUsage, 'string');
  assert.match(helpUsage, /--lp-tokens <n>\|--all/);
});
