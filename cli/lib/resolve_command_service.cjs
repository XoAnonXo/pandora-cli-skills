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
  const parseResolveFlags = requireDep(deps, 'parseResolveFlags');
  const runResolve = requireDep(deps, 'runResolve');
  const renderSingleEntityTable = requireDep(deps, 'renderSingleEntityTable');
  const CliError = requireDep(deps, 'CliError');

  return async function runResolveCommand(args, context) {
    if (includesHelpFlag(args)) {
      if (context.outputMode === 'json') {
        emitSuccess(
          context.outputMode,
          'resolve.help',
          commandHelpPayload(
            'pandora [--output table|json] resolve --poll-address <address> --answer yes|no|invalid --reason <text> --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>]',
          ),
        );
      } else {
        // eslint-disable-next-line no-console
        console.log(
          'Usage: pandora [--output table|json] resolve --poll-address <address> --answer yes|no|invalid --reason <text> --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>]',
        );
      }
      return;
    }
    const options = parseResolveFlags(args);
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
