/**
 * Handle `mirror deploy` command execution.
 * Parses deploy flags, invokes deploy service, and emits deploy payloads.
 * @param {{shared: object, context: object, deps: object}} params
 * @returns {Promise<void>}
 */
module.exports = async function handleMirrorDeploy({ shared, context, deps }) {
  const {
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    maybeLoadTradeEnv,
    resolveIndexerUrl,
    parseMirrorDeployFlags,
    deployMirror,
    coerceMirrorServiceError,
    renderMirrorDeployTable,
    assertLiveWriteAllowed,
  } = deps;

  if (includesHelpFlag(shared.rest)) {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'mirror.deploy.help',
        commandHelpPayload(
          'pandora [--output table|json] mirror deploy --plan-file <path>|--polymarket-market-id <id>|--polymarket-slug <slug> --dry-run|--execute [--liquidity-usdc <n>] [--fee-tier <500-50000>] [--max-imbalance <n>] [--arbiter <address>] [--category <n>] [--sources <url...>] [--validation-ticket <ticket>] [--target-timestamp <unix|iso>] [--manifest-file <path>] [--min-close-lead-seconds <n>]',
        ),
      );
    } else {
      console.log(
        'Usage: pandora [--output table|json] mirror deploy --plan-file <path>|--polymarket-market-id <id>|--polymarket-slug <slug> --dry-run|--execute [--liquidity-usdc <n>] [--fee-tier <500-50000>] [--max-imbalance <n>] [--arbiter <address>] [--category <n>] [--sources <url...>] [--validation-ticket <ticket>] [--target-timestamp <unix|iso>] [--manifest-file <path>] [--min-close-lead-seconds <n>]',
      );
    }
    return;
  }

  maybeLoadTradeEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
  const options = parseMirrorDeployFlags(shared.rest);
  if (options.execute && typeof assertLiveWriteAllowed === 'function') {
    await assertLiveWriteAllowed('mirror.deploy.execute', {
      notionalUsdc: options.liquidityUsdc,
      runtimeMode: 'live',
    });
  }
  let payload;
  try {
    payload = await deployMirror({
      ...options,
      indexerUrl,
      timeoutMs: shared.timeoutMs,
      execute: options.execute,
    });
  } catch (err) {
    throw coerceMirrorServiceError(err, 'MIRROR_DEPLOY_FAILED');
  }

  emitSuccess(context.outputMode, 'mirror.deploy', payload, renderMirrorDeployTable);
};
