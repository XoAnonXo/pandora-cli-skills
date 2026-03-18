function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunMarketsMineCommand requires deps.${name}()`);
  }
  return deps[name];
}

function createRunMarketsMineCommand(deps) {
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const resolveIndexerUrl = requireDep(deps, 'resolveIndexerUrl');
  const parseMarketsMineFlags = requireDep(deps, 'parseMarketsMineFlags');
  const discoverOwnedMarkets = requireDep(deps, 'discoverOwnedMarkets');
  const CliError = requireDep(deps, 'CliError');
  const isValidPrivateKey = requireDep(deps, 'isValidPrivateKey');
  const renderMarketsMineTable = requireDep(deps, 'renderMarketsMineTable');

  return async function runMarketsMineCommand(args, context = {}) {
    if (includesHelpFlag(args)) {
      const usage =
        'pandora [--output table|json] markets mine [--wallet <address>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--indexer-url <url>] [--timeout-ms <ms>]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'markets.mine.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    const options = parseMarketsMineFlags(args);
    if (!options.wallet && !options.privateKey && !options.profileId && !options.profileFile) {
      const envPrivateKey = String(process.env.PANDORA_PRIVATE_KEY || process.env.PRIVATE_KEY || '').trim();
      if (isValidPrivateKey(envPrivateKey)) {
        options.privateKey = envPrivateKey;
      }
    }
    options.indexerUrl = resolveIndexerUrl(context.indexerUrl || options.indexerUrl || null);
    if (Number.isFinite(context.timeoutMs)) {
      options.timeoutMs = context.timeoutMs;
    }

    try {
      const payload = await discoverOwnedMarkets(options);
      emitSuccess(context.outputMode, 'markets.mine', payload, renderMarketsMineTable);
    } catch (error) {
      if (error && error.code) {
        throw new CliError(error.code, error.message || 'markets mine failed.', error.details);
      }
      throw error;
    }
  };
}

module.exports = {
  createRunMarketsMineCommand,
};
