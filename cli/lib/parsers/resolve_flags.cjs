function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParseResolveFlags requires deps.${name}()`);
  }
  return deps[name];
}

/**
 * Creates the resolve command flags parser.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseResolveFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parseInteger = requireDep(deps, 'parseInteger');
  const isValidPrivateKey = requireDep(deps, 'isValidPrivateKey');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');

  return function parseResolveFlags(args) {
    const options = {
      pollAddress: null,
      answer: null,
      reason: null,
      dryRun: false,
      execute: false,
      chainId: null,
      rpcUrl: null,
      fork: false,
      forkRpcUrl: null,
      forkChainId: null,
      privateKey: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--poll-address') {
        options.pollAddress = parseAddressFlag(requireFlagValue(args, i, '--poll-address'), '--poll-address');
        i += 1;
        continue;
      }
      if (token === '--answer') {
        const answer = requireFlagValue(args, i, '--answer').toLowerCase();
        if (!['yes', 'no', 'invalid'].includes(answer)) {
          throw new CliError('INVALID_FLAG_VALUE', '--answer must be yes|no|invalid.');
        }
        options.answer = answer;
        i += 1;
        continue;
      }
      if (token === '--reason') {
        options.reason = requireFlagValue(args, i, '--reason');
        i += 1;
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
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for resolve: ${token}`);
    }

    if (!options.pollAddress) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing poll address. Use --poll-address <address>.');
    }
    if (!options.answer) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing answer. Use --answer yes|no|invalid.');
    }
    if (!options.reason) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing reason. Use --reason <text>.');
    }
    if (options.dryRun === options.execute) {
      throw new CliError('INVALID_ARGS', 'Use exactly one mode: --dry-run or --execute.');
    }

    return options;
  };
}

module.exports = {
  createParseResolveFlags,
};
