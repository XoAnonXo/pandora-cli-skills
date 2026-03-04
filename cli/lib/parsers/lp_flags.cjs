function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParseLpFlags requires deps.${name}()`);
  }
  return deps[name];
}

function requireNumericDep(deps, name) {
  const value = deps ? deps[name] : undefined;
  if (!Number.isFinite(value)) {
    throw new Error(`createParseLpFlags requires numeric deps.${name}`);
  }
  return value;
}

/**
 * Creates parser for `lp add|remove|positions` command flags.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseLpFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parseInteger = requireDep(deps, 'parseInteger');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const isValidPrivateKey = requireDep(deps, 'isValidPrivateKey');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');
  const defaultTimeoutMs = requireNumericDep(deps, 'defaultTimeoutMs');

  return function parseLpFlags(args) {
    const action = args[0];
    if (!action || !['add', 'remove', 'positions'].includes(action)) {
      throw new CliError('INVALID_ARGS', 'lp requires subcommand add|remove|positions.');
    }

    const rest = args.slice(1);
    const options = {
      action,
      marketAddress: null,
      wallet: null,
      amountUsdc: null,
      lpTokens: null,
      lpAll: false,
      allMarkets: false,
      chainId: null,
      dryRun: false,
      execute: false,
      rpcUrl: null,
      fork: false,
      forkRpcUrl: null,
      forkChainId: null,
      privateKey: null,
      usdc: null,
      deadlineSeconds: 1800,
      indexerUrl: null,
      timeoutMs: defaultTimeoutMs,
    };

    for (let i = 0; i < rest.length; i += 1) {
      const token = rest[i];
      if (token === '--market-address') {
        options.marketAddress = parseAddressFlag(requireFlagValue(rest, i, '--market-address'), '--market-address');
        i += 1;
        continue;
      }
      if (token === '--wallet') {
        options.wallet = parseAddressFlag(requireFlagValue(rest, i, '--wallet'), '--wallet');
        i += 1;
        continue;
      }
      if (token === '--amount-usdc') {
        options.amountUsdc = parsePositiveNumber(requireFlagValue(rest, i, '--amount-usdc'), '--amount-usdc');
        i += 1;
        continue;
      }
      if (token === '--lp-tokens') {
        options.lpTokens = parsePositiveNumber(requireFlagValue(rest, i, '--lp-tokens'), '--lp-tokens');
        i += 1;
        continue;
      }
      if (token === '--all') {
        options.lpAll = true;
        continue;
      }
      if (token === '--all-markets') {
        options.allMarkets = true;
        continue;
      }
      if (token === '--chain-id') {
        options.chainId = parseInteger(requireFlagValue(rest, i, '--chain-id'), '--chain-id');
        i += 1;
        continue;
      }
      if (token === '--rpc-url') {
        const rpcUrl = requireFlagValue(rest, i, '--rpc-url');
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
        const forkRpcUrl = requireFlagValue(rest, i, '--fork-rpc-url');
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
        options.forkChainId = parseInteger(requireFlagValue(rest, i, '--fork-chain-id'), '--fork-chain-id');
        i += 1;
        continue;
      }
      if (token === '--private-key') {
        const value = requireFlagValue(rest, i, '--private-key');
        if (!isValidPrivateKey(value)) {
          throw new CliError('INVALID_FLAG_VALUE', '--private-key must be 0x + 64 hex chars.');
        }
        options.privateKey = value;
        i += 1;
        continue;
      }
      if (token === '--usdc') {
        options.usdc = parseAddressFlag(requireFlagValue(rest, i, '--usdc'), '--usdc');
        i += 1;
        continue;
      }
      if (token === '--deadline-seconds') {
        options.deadlineSeconds = parsePositiveInteger(requireFlagValue(rest, i, '--deadline-seconds'), '--deadline-seconds');
        if (options.deadlineSeconds < 60) {
          throw new CliError('INVALID_FLAG_VALUE', '--deadline-seconds must be >= 60.');
        }
        i += 1;
        continue;
      }
      if (token === '--indexer-url') {
        options.indexerUrl = requireFlagValue(rest, i, '--indexer-url');
        i += 1;
        continue;
      }
      if (token === '--timeout-ms') {
        options.timeoutMs = parsePositiveInteger(requireFlagValue(rest, i, '--timeout-ms'), '--timeout-ms');
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
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for lp ${action}: ${token}`);
    }

    if (action === 'positions') {
      if (!options.wallet) {
        throw new CliError('MISSING_REQUIRED_FLAG', 'Missing wallet address. Use --wallet <address>.');
      }
      return options;
    }

    if (action === 'remove' && options.allMarkets && options.marketAddress) {
      throw new CliError('INVALID_ARGS', '--all-markets cannot be combined with --market-address.');
    }
    if (action === 'remove' && options.allMarkets && options.lpTokens !== null) {
      throw new CliError('INVALID_ARGS', '--all-markets cannot be combined with --lp-tokens.');
    }
    if (!options.marketAddress && !(action === 'remove' && options.allMarkets)) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing market address. Use --market-address <address>.');
    }
    if (action === 'add' && options.amountUsdc === null) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing liquidity amount. Use --amount-usdc <amount>.');
    }
    if (action === 'remove' && options.lpTokens === null && !options.lpAll) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing LP token amount. Use --lp-tokens <amount> or --all.');
    }
    if (action === 'remove' && options.lpTokens !== null && options.lpAll) {
      throw new CliError('INVALID_ARGS', 'Use only one remove mode: --lp-tokens <amount> or --all.');
    }
    if (action !== 'remove' && options.allMarkets) {
      throw new CliError('INVALID_ARGS', '--all-markets is only supported for lp remove.');
    }
    if (action === 'remove' && options.allMarkets) {
      options.lpAll = true;
      options.lpTokens = null;
    }
    if (options.dryRun === options.execute) {
      throw new CliError('INVALID_ARGS', 'Use exactly one mode: --dry-run or --execute.');
    }

    return options;
  };
}

module.exports = {
  createParseLpFlags,
};
