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
  const usage =
    'pandora [--output table|json] mirror deploy --plan-file <path>|--polymarket-market-id <id>|--polymarket-slug <slug> --dry-run|--execute [--liquidity-usdc <n>] [--fee-tier <500-50000>] [--max-imbalance <n>] [--arbiter <address>] [--category <id|name>] [--sources <url...>] [--validation-ticket <ticket>] [--target-timestamp <unix|iso>] [--manifest-file <path>] [--initial-yes-pct <pct>|--initial-no-pct <pct>] [--distribution-yes <parts>] [--distribution-no <parts>] [--yes-reserve-weight-pct <pct>] [--no-reserve-weight-pct <pct>] [--min-close-lead-seconds <n>]';
  const notes = [
    'mirror deploy dry-run returns the exact Pandora deployment payload and required validation ticket.',
    'Validation tickets are bound to the exact final deploy payload. Any change to question, rules, sources, target timestamp, liquidity, fee params, or distribution requires a fresh validation pass.',
    'mirror deploy never auto-copies Polymarket URLs into sources; pass independent public resolution URLs with --sources.',
    'For AMM deploy flows, prefer --initial-yes-pct/--initial-no-pct to set the opening probability directly. Use --yes-reserve-weight-pct/--no-reserve-weight-pct only for explicit reserve-weight control.',
    'Legacy --distribution-yes-pct/--distribution-no-pct are rejected with a migration error because they were ambiguous for AMM pricing.',
  ];

  if (includesHelpFlag(shared.rest)) {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'mirror.deploy.help',
        commandHelpPayload(usage, notes),
      );
    } else {
      console.log(`Usage: ${usage}`);
      console.log('');
      console.log('Notes:');
      for (const note of notes) {
        console.log(`- ${note}`);
      }
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
