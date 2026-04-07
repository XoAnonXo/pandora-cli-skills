const test = require('node:test');
const assert = require('node:assert/strict');

const { createRunModelCommand } = require('../../cli/lib/model_command_service.cjs');

class TestCliError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function buildDeps() {
  return {
    CliError: TestCliError,
    includesHelpFlag: (args) => Array.isArray(args) && args.includes('--help'),
    emitSuccess: (...args) => args,
    commandHelpPayload: (usage) => ({ usage }),
    parseModelCalibrateFlags: () => {
      throw new Error('not used');
    },
    parseModelCorrelationFlags: () => {
      throw new Error('not used');
    },
    parseModelDiagnoseFlags: () => {
      throw new Error('not used');
    },
    parseModelScoreBrierFlags: () => {
      throw new Error('not used');
    },
    readForecastRecords: () => {
      throw new Error('not used');
    },
    defaultForecastFile: () => null,
    computeBrierReport: () => {
      throw new Error('not used');
    },
  };
}

test('model command accepts direct-export handler modules on help paths', async () => {
  const observed = [];
  const runModelCommand = createRunModelCommand({
    ...buildDeps(),
    emitSuccess: (...args) => observed.push(args),
  });

  await runModelCommand(['calibrate', '--help'], { outputMode: 'json' });
  await runModelCommand(['correlation', '--help'], { outputMode: 'json' });
  await runModelCommand(['diagnose', '--help'], { outputMode: 'json' });
  await runModelCommand(['score', 'brier', '--help'], { outputMode: 'json' });

  assert.deepEqual(
    observed.map((entry) => entry[1]),
    [
      'model.calibrate.help',
      'model.correlation.help',
      'model.diagnose.help',
      'model.score.brier.help',
    ],
  );
});
