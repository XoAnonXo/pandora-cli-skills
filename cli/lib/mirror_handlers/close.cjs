/**
 * Handle `mirror close` command execution.
 * Executes stop/withdraw/claim workflow for one market or all tracked mirrors.
 * @param {{shared: object, context: object, deps: object}} params
 * @returns {Promise<void>}
 */
module.exports = async function handleMirrorClose({ shared, context, deps }) {
  const {
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    parseMirrorCloseFlags,
    maybeLoadTradeEnv,
    runMirrorClose,
    stopMirrorDaemon,
    runLp,
    runClaim,
    assertLiveWriteAllowed,
    renderMirrorCloseTable,
  } = deps;

  if (includesHelpFlag(shared.rest)) {
    const usage =
      'pandora [--output table|json] mirror close --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug>|--all --dry-run|--execute [--wallet <address>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--indexer-url <url>] [--timeout-ms <ms>]';
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'mirror.close.help', commandHelpPayload(usage));
    } else {
      console.log(`Usage: ${usage}`);
    }
    return;
  }

  maybeLoadTradeEnv(shared);
  const options = parseMirrorCloseFlags(shared.rest);
  if (!options.indexerUrl && shared.indexerUrl) {
    options.indexerUrl = shared.indexerUrl;
  }
  if (Number.isFinite(shared.timeoutMs)) {
    options.timeoutMs = shared.timeoutMs;
  }
  if (options.execute && typeof assertLiveWriteAllowed === 'function') {
    await assertLiveWriteAllowed('mirror.close.execute', {
      runtimeMode: options.fork || options.forkRpcUrl ? 'fork' : 'live',
    });
  }
  const payload = await runMirrorClose(options, {
    stopMirrorDaemon,
    runLp,
    runClaim,
  });
  emitSuccess(context.outputMode, 'mirror.close', payload, renderMirrorCloseTable);
};
