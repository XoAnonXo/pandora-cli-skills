function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunClaimCommand requires deps.${name}()`);
  }
  return deps[name];
}

/**
 * Creates `claim` command runner.
 * @param {object} deps
 * @returns {(args: string[], context: {outputMode: string}) => Promise<void>}
 */
function createRunClaimCommand(deps) {
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseIndexerSharedFlags = requireDep(deps, 'parseIndexerSharedFlags');
  const maybeLoadTradeEnv = requireDep(deps, 'maybeLoadTradeEnv');
  const parseClaimFlags = requireDep(deps, 'parseClaimFlags');
  const runClaim = requireDep(deps, 'runClaim');
  const renderSingleEntityTable = requireDep(deps, 'renderSingleEntityTable');
  const CliError = requireDep(deps, 'CliError');
  const assertLiveWriteAllowed = typeof deps.assertLiveWriteAllowed === 'function' ? deps.assertLiveWriteAllowed : null;

  return async function runClaimCommand(args, context) {
    const shared = parseIndexerSharedFlags(args);
    if (includesHelpFlag(shared.rest)) {
      const usage =
        'pandora [--output table|json] claim --market-address <address>|--all [--wallet <address>] --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--indexer-url <url>] [--timeout-ms <ms>]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'claim.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    maybeLoadTradeEnv(shared);
    const options = parseClaimFlags(shared.rest);
    if (!options.indexerUrl && shared.indexerUrl) {
      options.indexerUrl = shared.indexerUrl;
    }
    if (Number.isFinite(shared.timeoutMs)) {
      options.timeoutMs = shared.timeoutMs;
    }

    if (options.execute && assertLiveWriteAllowed) {
      await assertLiveWriteAllowed('claim.execute', {
        runtimeMode: options.fork || options.forkRpcUrl ? 'fork' : 'live',
      });
    }

    let payload;
    try {
      payload = await runClaim(options);
    } catch (err) {
      if (err && err.code) {
        throw new CliError(err.code, err.message || 'claim command failed.', err.details);
      }
      throw err;
    }

    emitSuccess(context.outputMode, 'claim', payload, renderSingleEntityTable);
  };
}

module.exports = {
  createRunClaimCommand,
};
