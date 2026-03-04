function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunResolveCommand requires deps.${name}()`);
  }
  return deps[name];
}

/**
 * Creates the `resolve` command runner.
 * @param {object} deps
 * @returns {(args: string[], context: {outputMode: string}) => Promise<void>}
 */
function createRunResolveCommand(deps) {
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseIndexerSharedFlags = requireDep(deps, 'parseIndexerSharedFlags');
  const maybeLoadTradeEnv = requireDep(deps, 'maybeLoadTradeEnv');
  const parseResolveFlags = requireDep(deps, 'parseResolveFlags');
  const runResolve = requireDep(deps, 'runResolve');
  const renderSingleEntityTable = requireDep(deps, 'renderSingleEntityTable');
  const CliError = requireDep(deps, 'CliError');
  const assertLiveWriteAllowed = typeof deps.assertLiveWriteAllowed === 'function' ? deps.assertLiveWriteAllowed : null;

  return async function runResolveCommand(args, context) {
    const shared = parseIndexerSharedFlags(args);
    if (includesHelpFlag(shared.rest)) {
      if (context.outputMode === 'json') {
        emitSuccess(
          context.outputMode,
          'resolve.help',
          commandHelpPayload(
            'pandora [--output table|json] resolve [--dotenv-path <path>] [--skip-dotenv] --poll-address <address> --answer yes|no|invalid --reason <text> --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>]',
          ),
        );
      } else {
        // eslint-disable-next-line no-console
        console.log(
          'Usage: pandora [--output table|json] resolve [--dotenv-path <path>] [--skip-dotenv] --poll-address <address> --answer yes|no|invalid --reason <text> --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>]',
        );
      }
      return;
    }
    maybeLoadTradeEnv(shared);
    const options = parseResolveFlags(shared.rest);
    if (options.execute && assertLiveWriteAllowed) {
      await assertLiveWriteAllowed('resolve.execute', {
        runtimeMode: options.fork || options.forkRpcUrl ? 'fork' : 'live',
      });
    }
    let payload;
    try {
      payload = await runResolve(options);
    } catch (err) {
      if (err && err.code) {
        throw new CliError(err.code, err.message || 'resolve command failed.', err.details);
      }
      throw err;
    }
    emitSuccess(context.outputMode, 'resolve', payload, renderSingleEntityTable);
  };
}

module.exports = {
  createRunResolveCommand,
};
