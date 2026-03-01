/**
 * Handle `mirror plan` command execution.
 * Resolves source market inputs and emits mirror plan payloads.
 * @param {{shared: object, context: object, deps: object}} params
 * @returns {Promise<void>}
 */
module.exports = async function handleMirrorPlan({ shared, context, deps }) {
  const {
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    maybeLoadIndexerEnv,
    resolveIndexerUrl,
    parseMirrorPlanFlags,
    buildMirrorPlan,
    renderMirrorPlanTable,
  } = deps;

  if (includesHelpFlag(shared.rest)) {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'mirror.plan.help',
        commandHelpPayload(
          'pandora [--output table|json] mirror plan --source polymarket --polymarket-market-id <id>|--polymarket-slug <slug> [--chain-id <id>] [--target-slippage-bps <n>] [--turnover-target <n>] [--depth-slippage-bps <n>] [--safety-multiplier <n>] [--min-liquidity-usdc <n>] [--max-liquidity-usdc <n>] [--with-rules] [--include-similarity] [--polymarket-gamma-url <url>]',
        ),
      );
    } else {
      console.log(
        'Usage: pandora [--output table|json] mirror plan --source polymarket --polymarket-market-id <id>|--polymarket-slug <slug> [--chain-id <id>] [--target-slippage-bps <n>] [--turnover-target <n>] [--depth-slippage-bps <n>] [--safety-multiplier <n>] [--min-liquidity-usdc <n>] [--max-liquidity-usdc <n>] [--with-rules] [--include-similarity] [--polymarket-gamma-url <url>]',
      );
    }
    return;
  }

  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
  const options = parseMirrorPlanFlags(shared.rest);
  const payload = await buildMirrorPlan({
    ...options,
    indexerUrl,
    timeoutMs: shared.timeoutMs,
  });

  emitSuccess(context.outputMode, 'mirror.plan', payload, renderMirrorPlanTable);
};
