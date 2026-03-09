function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParseMarketsMineFlags requires deps.${name}()`);
  }
  return deps[name];
}

function createParseMarketsMineFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parseInteger = requireDep(deps, 'parseInteger');
  const isValidPrivateKey = requireDep(deps, 'isValidPrivateKey');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');

  return function parseMarketsMineFlags(args) {
    const options = {
      wallet: null,
      chainId: 1,
      rpcUrl: null,
      privateKey: null,
      profileId: null,
      profileFile: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];

      if (token === '--wallet') {
        options.wallet = parseAddressFlag(requireFlagValue(args, i, '--wallet'), '--wallet');
        i += 1;
        continue;
      }

      if (token === '--chain-id') {
        options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
        if (options.chainId <= 0) {
          throw new CliError('INVALID_FLAG_VALUE', '--chain-id must be a positive integer.');
        }
        i += 1;
        continue;
      }

      if (token === '--rpc-url') {
        const value = requireFlagValue(args, i, '--rpc-url');
        if (!isSecureHttpUrlOrLocal(value)) {
          throw new CliError(
            'INVALID_FLAG_VALUE',
            '--rpc-url must use https:// (or http://localhost/127.0.0.1 for local testing).',
          );
        }
        options.rpcUrl = value;
        i += 1;
        continue;
      }

      if (token === '--private-key') {
        const value = requireFlagValue(args, i, '--private-key');
        if (!isValidPrivateKey(value)) {
          throw new CliError('INVALID_FLAG_VALUE', 'Invalid --private-key. Expected 0x + 64 hex chars.');
        }
        options.privateKey = value;
        i += 1;
        continue;
      }

      if (token === '--profile-id') {
        options.profileId = requireFlagValue(args, i, '--profile-id').trim();
        if (!options.profileId) {
          throw new CliError('INVALID_FLAG_VALUE', '--profile-id cannot be empty.');
        }
        i += 1;
        continue;
      }

      if (token === '--profile-file') {
        options.profileFile = requireFlagValue(args, i, '--profile-file').trim();
        if (!options.profileFile) {
          throw new CliError('INVALID_FLAG_VALUE', '--profile-file cannot be empty.');
        }
        i += 1;
        continue;
      }

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for markets mine: ${token}`);
    }

    return options;
  };
}

module.exports = {
  createParseMarketsMineFlags,
};
