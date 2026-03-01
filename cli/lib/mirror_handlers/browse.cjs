/**
 * Handle `mirror browse` command execution.
 * Emits help or filtered mirror browse results through CLI output services.
 * @param {{shared: object, context: object, deps: object}} params
 * @returns {Promise<void>}
 */
module.exports = async function handleMirrorBrowse({ shared, context, deps }) {
  const {
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    maybeLoadIndexerEnv,
    resolveIndexerUrl,
    parseMirrorBrowseFlags,
    browseMirrorMarkets,
    renderMirrorBrowseTable,
  } = deps;

  if (includesHelpFlag(shared.rest)) {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'mirror.browse.help',
        commandHelpPayload(
          'pandora [--output table|json] mirror browse [--min-yes-pct <n>] [--max-yes-pct <n>] [--min-volume-24h <n>] [--closes-after <date>] [--closes-before <date>] [--question-contains <text>] [--limit <n>]',
        ),
      );
    } else {
      console.log(
        'Usage: pandora [--output table|json] mirror browse [--min-yes-pct <n>] [--max-yes-pct <n>] [--min-volume-24h <n>] [--closes-after <date>] [--closes-before <date>] [--question-contains <text>] [--limit <n>]',
      );
    }
    return;
  }

  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
  const options = parseMirrorBrowseFlags(shared.rest);
  const payload = await browseMirrorMarkets({
    ...options,
    indexerUrl,
    timeoutMs: shared.timeoutMs,
  });

  emitSuccess(context.outputMode, 'mirror.browse', payload, renderMirrorBrowseTable);
};
