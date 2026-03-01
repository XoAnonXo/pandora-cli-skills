/**
 * Handle `mirror close` command execution.
 * Builds and emits a close plan payload for dry-run/operator workflows.
 * @param {{shared: object, context: object, deps: object}} params
 * @returns {Promise<void>}
 */
module.exports = async function handleMirrorClose({ shared, context, deps }) {
  const {
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    parseMirrorCloseFlags,
    buildMirrorClosePlan,
    renderMirrorCloseTable,
  } = deps;

  if (includesHelpFlag(shared.rest)) {
    const usage =
      'pandora [--output table|json] mirror close --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> --dry-run|--execute';
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'mirror.close.help', commandHelpPayload(usage));
    } else {
      console.log(`Usage: ${usage}`);
    }
    return;
  }

  const options = parseMirrorCloseFlags(shared.rest);
  const payload = buildMirrorClosePlan(options);
  emitSuccess(context.outputMode, 'mirror.close', payload, renderMirrorCloseTable);
};
