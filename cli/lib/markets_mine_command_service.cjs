function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunMarketsMineCommand requires deps.${name}()`);
  }
  return deps[name];
}

function renderMarketsMineTable(payload) {
  const items = Array.isArray(payload && payload.items) ? payload.items : [];
  if (!items.length) {
    // eslint-disable-next-line no-console
    console.log('No owned market exposure found.');
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`Wallet: ${payload.wallet}`);
  // eslint-disable-next-line no-console
  console.log(`Markets: ${items.length}`);
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log('Market                                      Exposure              Question');
  for (const item of items) {
    const market = String(item && item.marketAddress ? item.marketAddress : '').padEnd(42, ' ');
    const exposure = String(Array.isArray(item && item.exposureTypes) ? item.exposureTypes.join(',') : '').padEnd(20, ' ');
    const question = String(item && item.question ? item.question : '');
    // eslint-disable-next-line no-console
    console.log(`${market} ${exposure} ${question}`);
  }
}

function createRunMarketsMineCommand(deps) {
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseIndexerSharedFlags = requireDep(deps, 'parseIndexerSharedFlags');
  const maybeLoadIndexerEnv = requireDep(deps, 'maybeLoadIndexerEnv');
  const resolveIndexerUrl = requireDep(deps, 'resolveIndexerUrl');
  const parseMarketsMineFlags = requireDep(deps, 'parseMarketsMineFlags');
  const discoverOwnedMarkets = requireDep(deps, 'discoverOwnedMarkets');
  const CliError = requireDep(deps, 'CliError');

  return async function runMarketsMineCommand(args, context) {
    const shared = parseIndexerSharedFlags(args);
    if (includesHelpFlag(shared.rest)) {
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

    maybeLoadIndexerEnv(shared);
    const options = parseMarketsMineFlags(shared.rest.slice(1));
    options.indexerUrl = resolveIndexerUrl(shared.indexerUrl || options.indexerUrl || null);
    if (Number.isFinite(shared.timeoutMs)) {
      options.timeoutMs = shared.timeoutMs;
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
