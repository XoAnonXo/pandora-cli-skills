function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunLpCommand requires deps.${name}()`);
  }
  return deps[name];
}

/**
 * Creates the `lp` command runner.
 * @param {object} deps
 * @returns {(args: string[], context: {outputMode: string}) => Promise<void>}
 */
function createRunLpCommand(deps) {
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseIndexerSharedFlags = requireDep(deps, 'parseIndexerSharedFlags');
  const maybeLoadTradeEnv = requireDep(deps, 'maybeLoadTradeEnv');
  const parseLpFlags = requireDep(deps, 'parseLpFlags');
  const runLp = requireDep(deps, 'runLp');
  const renderSingleEntityTable = requireDep(deps, 'renderSingleEntityTable');
  const CliError = requireDep(deps, 'CliError');
  const assertLiveWriteAllowed = typeof deps.assertLiveWriteAllowed === 'function' ? deps.assertLiveWriteAllowed : null;

  return async function runLpCommand(args, context) {
    if (includesHelpFlag(args)) {
      if (context.outputMode === 'json') {
        emitSuccess(
          context.outputMode,
          'lp.help',
          commandHelpPayload(
            'pandora [--output table|json] lp add|remove|positions [--market-address <address>] [--wallet <address>] [--amount-usdc <n>] [--lp-tokens <n>|--all|--all-markets] [--dry-run|--execute] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>] [--deadline-seconds <n>] [--indexer-url <url>] [--timeout-ms <ms>]',
          ),
        );
      } else {
        // eslint-disable-next-line no-console
        console.log(
          'Usage: pandora [--output table|json] lp add|remove|positions [--market-address <address>] [--wallet <address>] [--amount-usdc <n>] [--lp-tokens <n>|--all|--all-markets] [--dry-run|--execute] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>] [--deadline-seconds <n>] [--indexer-url <url>] [--timeout-ms <ms>]',
        );
      }
      return;
    }
    const shared = parseIndexerSharedFlags(args);
    maybeLoadTradeEnv(shared);
    const options = parseLpFlags(shared.rest);
    if (shared.indexerUrl) {
      options.indexerUrl = shared.indexerUrl;
    }
    if (Number.isFinite(shared.timeoutMs)) {
      options.timeoutMs = shared.timeoutMs;
    }
    if (options.execute && options.action !== 'positions' && assertLiveWriteAllowed) {
      await assertLiveWriteAllowed(`lp.${options.action}.execute`, {
        notionalUsdc: options.action === 'add' ? options.amountUsdc : null,
        runtimeMode: options.fork || options.forkRpcUrl ? 'fork' : 'live',
      });
    }
    let payload;
    try {
      payload = await runLp(options);
    } catch (err) {
      if (err && err.code) {
        throw new CliError(err.code, err.message || 'lp command failed.', err.details);
      }
      throw err;
    }
    emitSuccess(context.outputMode, 'lp', payload, renderSingleEntityTable);
  };
}

module.exports = {
  createRunLpCommand,
};
