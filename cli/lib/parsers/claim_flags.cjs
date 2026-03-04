function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParseClaimFlags requires deps.${name}()`);
  }
  return deps[name];
}

/**
 * Creates parser for `claim` command flags.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseClaimFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parseInteger = requireDep(deps, 'parseInteger');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const isValidPrivateKey = requireDep(deps, 'isValidPrivateKey');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');

  return function parseClaimFlags(args) {
    const options = {
      marketAddress: null,
      wallet: null,
      all: false,
      dryRun: false,
      execute: false,
      chainId: null,
      rpcUrl: null,
      fork: false,
      forkRpcUrl: null,
      forkChainId: null,
      privateKey: null,
      indexerUrl: null,
      timeoutMs: 12000,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--market-address') {
        options.marketAddress = parseAddressFlag(requireFlagValue(args, i, '--market-address'), '--market-address');
        i += 1;
        continue;
      }
      if (token === '--wallet') {
        options.wallet = parseAddressFlag(requireFlagValue(args, i, '--wallet'), '--wallet');
        i += 1;
        continue;
      }
      if (token === '--all') {
        options.all = true;
        continue;
      }
      if (token === '--dry-run') {
        options.dryRun = true;
        continue;
      }
      if (token === '--execute') {
        options.execute = true;
        continue;
      }
      if (token === '--chain-id') {
        options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
        i += 1;
        continue;
      }
      if (token === '--rpc-url') {
        const rpcUrl = requireFlagValue(args, i, '--rpc-url');
        if (!isSecureHttpUrlOrLocal(rpcUrl)) {
          throw new CliError(
            'INVALID_FLAG_VALUE',
            '--rpc-url must use https:// (or http://localhost/127.0.0.1 for local testing).',
          );
        }
        options.rpcUrl = rpcUrl;
        i += 1;
        continue;
      }
      if (token === '--fork') {
        options.fork = true;
        continue;
      }
      if (token === '--fork-rpc-url') {
        const forkRpcUrl = requireFlagValue(args, i, '--fork-rpc-url');
        if (!isSecureHttpUrlOrLocal(forkRpcUrl)) {
          throw new CliError(
            'INVALID_FLAG_VALUE',
            '--fork-rpc-url must use https:// (or http://localhost/127.0.0.1 for local testing).',
          );
        }
        options.forkRpcUrl = forkRpcUrl;
        i += 1;
        continue;
      }
      if (token === '--fork-chain-id') {
        options.forkChainId = parseInteger(requireFlagValue(args, i, '--fork-chain-id'), '--fork-chain-id');
        i += 1;
        continue;
      }
      if (token === '--private-key') {
        const value = requireFlagValue(args, i, '--private-key');
        if (!isValidPrivateKey(value)) {
          throw new CliError('INVALID_FLAG_VALUE', '--private-key must be 0x + 64 hex chars.');
        }
        options.privateKey = value;
        i += 1;
        continue;
      }
      if (token === '--indexer-url') {
        options.indexerUrl = requireFlagValue(args, i, '--indexer-url');
        i += 1;
        continue;
      }
      if (token === '--timeout-ms') {
        options.timeoutMs = parsePositiveInteger(requireFlagValue(args, i, '--timeout-ms'), '--timeout-ms');
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for claim: ${token}`);
    }

    if (options.all && options.marketAddress) {
      throw new CliError('INVALID_ARGS', 'Use either --market-address <address> or --all, not both.');
    }
    if (!options.all && !options.marketAddress) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing claim target. Use --market-address <address> or --all.');
    }
    if (options.dryRun === options.execute) {
      throw new CliError('INVALID_ARGS', 'Use exactly one mode: --dry-run or --execute.');
    }

    return options;
  };
}

module.exports = {
  createParseClaimFlags,
};
