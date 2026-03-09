/**
 * Handle `mirror simulate` command execution.
 * Computes scenario projections and emits simulation payloads.
 * @param {{shared: object, context: object, deps: object}} params
 * @returns {Promise<void>}
 */
module.exports = async function handleMirrorSimulate({ shared, context, deps }) {
  const {
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    parseMirrorSimulateFlags,
    buildMirrorSimulate,
    coerceMirrorServiceError,
    renderMirrorSimulateTable,
  } = deps;

  if (includesHelpFlag(shared.rest)) {
    const usage =
      'pandora [--output table|json] mirror simulate --liquidity-usdc <n> [--engine linear|mc] [--source-yes-pct <0-100>] [--target-yes-pct <0-100>] [--distribution-yes <parts>] [--distribution-no <parts>] [--fee-tier <500-50000>] [--volume-scenarios <csv>] [--hedge-ratio <n>] [--hedge-cost-bps <n>] [--polymarket-yes-pct <0-100>] [--paths <n>] [--steps <n>] [--seed <int>] [--importance-sampling] [--antithetic] [--control-variate] [--stratified]';
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'mirror.simulate.help', commandHelpPayload(usage));
    } else {
      console.log(`Usage: ${usage}`);
    }
    return;
  }

  const options = parseMirrorSimulateFlags(shared.rest);
  let payload;
  try {
    payload = buildMirrorSimulate(options);
  } catch (err) {
    throw coerceMirrorServiceError(err, 'MIRROR_SIMULATE_FAILED');
  }
  emitSuccess(context.outputMode, 'mirror.simulate', payload, renderMirrorSimulateTable);
};
