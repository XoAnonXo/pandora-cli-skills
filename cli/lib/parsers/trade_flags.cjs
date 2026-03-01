function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParseTradeFlags requires deps.${name}()`);
  }
  return deps[name];
}

/**
 * Creates the trade flags parser.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseTradeFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const parseOutcomeSide = requireDep(deps, 'parseOutcomeSide');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parseProbabilityPercent = requireDep(deps, 'parseProbabilityPercent');
  const parseNonNegativeInteger = requireDep(deps, 'parseNonNegativeInteger');
  const parseBigIntString = requireDep(deps, 'parseBigIntString');
  const parseInteger = requireDep(deps, 'parseInteger');
  const parsePrivateKeyFlag = requireDep(deps, 'parsePrivateKeyFlag');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');

  return function parseTradeFlags(args) {
    const options = {
      marketAddress: null,
      side: null,
      amountUsdc: null,
      yesPct: null,
      slippageBps: 100,
      dryRun: false,
      execute: false,
      minSharesOutRaw: null,
      maxAmountUsdc: null,
      minProbabilityPct: null,
      maxProbabilityPct: null,
      allowUnquotedExecute: false,
      chainId: null,
      rpcUrl: null,
      fork: false,
      forkRpcUrl: null,
      forkChainId: null,
      privateKey: null,
      usdc: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];

      if (token === '--market-address') {
        options.marketAddress = parseAddressFlag(requireFlagValue(args, i, '--market-address'), '--market-address');
        i += 1;
        continue;
      }

      if (token === '--side') {
        options.side = parseOutcomeSide(requireFlagValue(args, i, '--side'), '--side');
        i += 1;
        continue;
      }

      if (token === '--amount-usdc' || token === '--amount') {
        options.amountUsdc = parsePositiveNumber(requireFlagValue(args, i, token), token);
        i += 1;
        continue;
      }

      if (token === '--yes-pct') {
        options.yesPct = parseProbabilityPercent(requireFlagValue(args, i, '--yes-pct'), '--yes-pct');
        i += 1;
        continue;
      }

      if (token === '--slippage-bps') {
        options.slippageBps = parseNonNegativeInteger(requireFlagValue(args, i, '--slippage-bps'), '--slippage-bps');
        if (options.slippageBps > 10_000) {
          throw new CliError('INVALID_FLAG_VALUE', '--slippage-bps must be between 0 and 10000.');
        }
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

      if (token === '--min-shares-out-raw') {
        options.minSharesOutRaw = parseBigIntString(requireFlagValue(args, i, '--min-shares-out-raw'), '--min-shares-out-raw');
        i += 1;
        continue;
      }

      if (token === '--max-amount-usdc') {
        options.maxAmountUsdc = parsePositiveNumber(requireFlagValue(args, i, '--max-amount-usdc'), '--max-amount-usdc');
        i += 1;
        continue;
      }

      if (token === '--min-probability-pct') {
        options.minProbabilityPct = parseProbabilityPercent(
          requireFlagValue(args, i, '--min-probability-pct'),
          '--min-probability-pct',
        );
        i += 1;
        continue;
      }

      if (token === '--max-probability-pct') {
        options.maxProbabilityPct = parseProbabilityPercent(
          requireFlagValue(args, i, '--max-probability-pct'),
          '--max-probability-pct',
        );
        i += 1;
        continue;
      }

      if (token === '--allow-unquoted-execute') {
        options.allowUnquotedExecute = true;
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
        options.privateKey = parsePrivateKeyFlag(requireFlagValue(args, i, '--private-key'), '--private-key');
        i += 1;
        continue;
      }

      if (token === '--usdc') {
        options.usdc = parseAddressFlag(requireFlagValue(args, i, '--usdc'), '--usdc');
        i += 1;
        continue;
      }

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for trade: ${token}`);
    }

    if (!options.marketAddress) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing market address. Use --market-address <address>.');
    }
    if (!options.side) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing side. Use --side yes|no.');
    }
    if (options.amountUsdc === null) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing trade amount. Use --amount-usdc <amount>.');
    }
    if (options.dryRun === options.execute) {
      throw new CliError('INVALID_ARGS', 'Use exactly one mode: --dry-run or --execute.');
    }
    if (
      options.minProbabilityPct !== null &&
      options.maxProbabilityPct !== null &&
      options.minProbabilityPct > options.maxProbabilityPct
    ) {
      throw new CliError('INVALID_ARGS', '--min-probability-pct cannot be greater than --max-probability-pct.');
    }

    return options;
  };
}

module.exports = {
  createParseTradeFlags,
};
