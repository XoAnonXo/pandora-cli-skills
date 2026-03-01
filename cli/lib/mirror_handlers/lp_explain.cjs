/**
 * Handle `mirror lp-explain` command execution.
 * Produces and emits LP inventory/price-balance explanation payloads.
 * @param {{shared: object, context: object, deps: object}} params
 * @returns {Promise<void>}
 */
module.exports = async function handleMirrorLpExplain({ shared, context, deps }) {
  const {
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    parseMirrorLpExplainFlags,
    buildMirrorLpExplain,
    coerceMirrorServiceError,
    renderMirrorLpExplainTable,
  } = deps;

  if (includesHelpFlag(shared.rest)) {
    const usage =
      'pandora [--output table|json] mirror lp-explain --liquidity-usdc <n> [--source-yes-pct <0-100>] [--distribution-yes <parts>] [--distribution-no <parts>]';
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'mirror.lp-explain.help', commandHelpPayload(usage));
    } else {
      console.log(`Usage: ${usage}`);
    }
    return;
  }

  const options = parseMirrorLpExplainFlags(shared.rest);
  let payload;
  try {
    payload = buildMirrorLpExplain(options);
  } catch (err) {
    throw coerceMirrorServiceError(err, 'MIRROR_LP_EXPLAIN_FAILED');
  }
  emitSuccess(context.outputMode, 'mirror.lp-explain', payload, renderMirrorLpExplainTable);
};
