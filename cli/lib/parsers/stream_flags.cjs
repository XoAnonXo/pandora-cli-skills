function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParseStreamFlags requires deps.${name}()`);
  }
  return deps[name];
}

function isLocalHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function isSecureWebsocketOrLocal(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol === 'wss:') return true;
    if (parsed.protocol !== 'ws:') return false;
    return isLocalHost(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Create parser for `pandora stream prices|events ...`.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseStreamFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  requireDep(deps, 'isSecureHttpUrlOrLocal');

  return function parseStreamFlags(args) {
    const channel = String((args && args[0]) || '').trim().toLowerCase();
    if (!channel || !['prices', 'events'].includes(channel)) {
      throw new CliError('INVALID_ARGS', 'stream requires channel prices|events.');
    }

    const rest = args.slice(1);
    const options = {
      channel,
      indexerWsUrl: null,
      intervalMs: 2_000,
      marketAddress: null,
      chainId: null,
      limit: 20,
    };

    for (let i = 0; i < rest.length; i += 1) {
      const token = rest[i];

      if (token === '--indexer-ws-url') {
        const value = requireFlagValue(rest, i, '--indexer-ws-url');
        if (!isSecureWebsocketOrLocal(value)) {
          throw new CliError(
            'INVALID_FLAG_VALUE',
            '--indexer-ws-url must use wss:// (or ws://localhost/127.0.0.1 for local testing).',
          );
        }
        options.indexerWsUrl = value;
        i += 1;
        continue;
      }

      if (token === '--interval-ms') {
        options.intervalMs = parsePositiveInteger(requireFlagValue(rest, i, '--interval-ms'), '--interval-ms');
        if (options.intervalMs < 100) {
          throw new CliError('INVALID_FLAG_VALUE', '--interval-ms must be >= 100.');
        }
        i += 1;
        continue;
      }

      if (token === '--market-address') {
        options.marketAddress = parseAddressFlag(requireFlagValue(rest, i, '--market-address'), '--market-address');
        i += 1;
        continue;
      }

      if (token === '--chain-id') {
        options.chainId = parsePositiveInteger(requireFlagValue(rest, i, '--chain-id'), '--chain-id');
        i += 1;
        continue;
      }

      if (token === '--limit') {
        options.limit = parsePositiveInteger(requireFlagValue(rest, i, '--limit'), '--limit');
        if (options.limit > 100) {
          throw new CliError('INVALID_FLAG_VALUE', '--limit must be <= 100.');
        }
        i += 1;
        continue;
      }

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for stream ${channel}: ${token}`);
    }

    return options;
  };
}

module.exports = {
  createParseStreamFlags,
};
