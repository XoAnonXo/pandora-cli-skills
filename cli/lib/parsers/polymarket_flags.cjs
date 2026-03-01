function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`Polymarket parser factory requires deps.${name}()`);
  }
  return deps[name];
}

function requireNumericDep(deps, name) {
  const value = deps ? deps[name] : undefined;
  if (!Number.isFinite(value)) {
    throw new Error(`Polymarket parser factory requires numeric deps.${name}`);
  }
  return value;
}

/**
 * Creates parser for shared polymarket auth/network flags.
 * @param {object} deps
 * @returns {(args: string[], actionLabel: string) => object}
 */
function createParsePolymarketSharedFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const parseInteger = requireDep(deps, 'parseInteger');
  const isValidPrivateKey = requireDep(deps, 'isValidPrivateKey');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');

  return function parsePolymarketSharedFlags(args, actionLabel) {
    const options = {
      rpcUrl: null,
      privateKey: null,
      funder: null,
      fork: false,
      forkRpcUrl: null,
      forkChainId: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
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
      if (token === '--private-key') {
        const value = requireFlagValue(args, i, '--private-key');
        if (!isValidPrivateKey(value)) {
          throw new CliError('INVALID_FLAG_VALUE', '--private-key must be 0x + 64 hex chars.');
        }
        options.privateKey = value;
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
      if (token === '--funder') {
        options.funder = parseAddressFlag(requireFlagValue(args, i, '--funder'), '--funder');
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for polymarket ${actionLabel}: ${token}`);
    }

    return options;
  };
}

/**
 * Creates parser for `polymarket approve`.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParsePolymarketApproveFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const parsePolymarketSharedFlags = requireDep(deps, 'parsePolymarketSharedFlags');

  return function parsePolymarketApproveFlags(args) {
    const options = {
      dryRun: false,
      execute: false,
      rpcUrl: null,
      privateKey: null,
      funder: null,
      fork: false,
      forkRpcUrl: null,
      forkChainId: null,
    };

    const sharedArgs = [];
    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--dry-run') {
        options.dryRun = true;
        continue;
      }
      if (token === '--execute') {
        options.execute = true;
        continue;
      }
      sharedArgs.push(token);
    }

    if (options.dryRun === options.execute) {
      throw new CliError('INVALID_ARGS', 'polymarket approve requires exactly one mode: --dry-run or --execute.');
    }

    const shared = parsePolymarketSharedFlags(sharedArgs, 'approve');
    options.rpcUrl = shared.rpcUrl;
    options.privateKey = shared.privateKey;
    options.funder = shared.funder;
    options.fork = shared.fork;
    options.forkRpcUrl = shared.forkRpcUrl;
    options.forkChainId = shared.forkChainId;
    return options;
  };
}

/**
 * Creates parser for `polymarket trade`.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParsePolymarketTradeFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parsePolymarketSharedFlags = requireDep(deps, 'parsePolymarketSharedFlags');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');
  const defaultTimeoutMs = requireNumericDep(deps, 'defaultTimeoutMs');

  return function parsePolymarketTradeFlags(args) {
    const options = {
      conditionId: null,
      slug: null,
      token: null,
      tokenId: null,
      side: 'buy',
      amountUsdc: null,
      dryRun: false,
      execute: false,
      host: null,
      timeoutMs: defaultTimeoutMs,
      rpcUrl: null,
      privateKey: null,
      funder: null,
      fork: false,
      forkRpcUrl: null,
      forkChainId: null,
      polymarketMockUrl: null,
    };

    const sharedArgs = [];
    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--condition-id' || token === '--market-id') {
        options.conditionId = requireFlagValue(args, i, token);
        i += 1;
        continue;
      }
      if (token === '--slug') {
        options.slug = requireFlagValue(args, i, '--slug');
        i += 1;
        continue;
      }
      if (token === '--token') {
        const value = String(requireFlagValue(args, i, '--token')).trim().toLowerCase();
        if (!['yes', 'no'].includes(value)) {
          throw new CliError('INVALID_FLAG_VALUE', '--token must be yes|no.');
        }
        options.token = value;
        i += 1;
        continue;
      }
      if (token === '--token-id') {
        options.tokenId = requireFlagValue(args, i, '--token-id');
        i += 1;
        continue;
      }
      if (token === '--side') {
        const value = String(requireFlagValue(args, i, '--side')).trim().toLowerCase();
        if (!['buy', 'sell'].includes(value)) {
          throw new CliError('INVALID_FLAG_VALUE', '--side must be buy|sell.');
        }
        options.side = value;
        i += 1;
        continue;
      }
      if (token === '--amount-usdc') {
        options.amountUsdc = parsePositiveNumber(requireFlagValue(args, i, '--amount-usdc'), '--amount-usdc');
        i += 1;
        continue;
      }
      if (token === '--polymarket-host') {
        const host = requireFlagValue(args, i, '--polymarket-host');
        if (!isSecureHttpUrlOrLocal(host)) {
          throw new CliError(
            'INVALID_FLAG_VALUE',
            '--polymarket-host must use https:// (or http://localhost/127.0.0.1 for local testing).',
          );
        }
        options.host = host;
        i += 1;
        continue;
      }
      if (token === '--polymarket-mock-url') {
        const mockUrl = requireFlagValue(args, i, '--polymarket-mock-url');
        if (!isSecureHttpUrlOrLocal(mockUrl)) {
          throw new CliError(
            'INVALID_FLAG_VALUE',
            '--polymarket-mock-url must use https:// (or http://localhost/127.0.0.1 for local testing).',
          );
        }
        options.polymarketMockUrl = mockUrl;
        i += 1;
        continue;
      }
      if (token === '--timeout-ms') {
        options.timeoutMs = parsePositiveInteger(requireFlagValue(args, i, '--timeout-ms'), '--timeout-ms');
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
      sharedArgs.push(token);
    }

    if (options.dryRun === options.execute) {
      throw new CliError('INVALID_ARGS', 'polymarket trade requires exactly one mode: --dry-run or --execute.');
    }
    if (options.amountUsdc === null) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing --amount-usdc <amount>.');
    }
    if (!options.tokenId && !options.token) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Provide --token yes|no (or --token-id <id>).');
    }
    if (!options.tokenId && !options.conditionId && !options.slug) {
      throw new CliError(
        'MISSING_REQUIRED_FLAG',
        'Provide --condition-id <id> or --slug <slug> when --token-id is not set.',
      );
    }

    const shared = parsePolymarketSharedFlags(sharedArgs, 'trade');
    options.rpcUrl = shared.rpcUrl;
    options.privateKey = shared.privateKey;
    options.funder = shared.funder;
    options.fork = shared.fork;
    options.forkRpcUrl = shared.forkRpcUrl;
    options.forkChainId = shared.forkChainId;
    return options;
  };
}

module.exports = {
  createParsePolymarketSharedFlags,
  createParsePolymarketApproveFlags,
  createParsePolymarketTradeFlags,
};
