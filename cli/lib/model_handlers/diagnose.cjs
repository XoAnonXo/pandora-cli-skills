const { buildModelDiagnose } = require('../model_diagnose_service.cjs');

function renderModelDiagnoseTable(payload) {
  const aggregate = payload && payload.aggregate ? payload.aggregate : {};
  const flags = payload && payload.flags ? payload.flags : {};

  // eslint-disable-next-line no-console
  console.log('model diagnose');
  // eslint-disable-next-line no-console
  console.log(`  score: ${aggregate.scorePct}% (${aggregate.classification})`);
  // eslint-disable-next-line no-console
  console.log(`  allow_execution: ${Boolean(flags.allowExecution)}`);
  // eslint-disable-next-line no-console
  console.log(`  require_human_review: ${Boolean(flags.requireHumanReview)}`);
  // eslint-disable-next-line no-console
  console.log(`  block_execution: ${Boolean(flags.blockExecution)}`);
}

/**
 * Handle `model diagnose` command execution.
 * @param {{actionArgs: string[], context: {outputMode: 'table'|'json'}, deps: object}} params
 * @returns {Promise<void>}
 */
module.exports = async function handleModelDiagnose({ actionArgs, context, deps }) {
  const {
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    parseModelDiagnoseFlags,
  } = deps;

  if (includesHelpFlag(actionArgs)) {
    const usage =
      'pandora [--output table|json] model diagnose [--calibration-rmse <n>] [--drift-bps <n>] [--spread-bps <n>] [--depth-coverage <0..1>] [--informed-flow-ratio <0..1>] [--noise-ratio <0..1>] [--anomaly-rate <0..1>] [--manipulation-alerts <n>] [--tail-dependence <0..1>]';
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'model.diagnose.help', commandHelpPayload(usage));
    } else {
      // eslint-disable-next-line no-console
      console.log(`Usage: ${usage}`);
    }
    return;
  }

  const options = parseModelDiagnoseFlags(actionArgs);
  const payload = buildModelDiagnose(options);
  emitSuccess(context.outputMode, 'model.diagnose', payload, renderModelDiagnoseTable);
};
