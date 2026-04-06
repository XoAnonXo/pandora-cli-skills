const { buildPolymarketForkPreview } = require('./fork_preview_service.cjs');
const DEFAULT_POLYMARKET_TIMEOUT_MS = 12_000;

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunPolymarketCommand requires deps.${name}()`);
  }
  return deps[name];
}

function requireStringDep(deps, name) {
  const value = deps ? deps[name] : undefined;
  if (typeof value !== 'string' || !value) {
    throw new Error(`createRunPolymarketCommand requires string deps.${name}`);
  }
  return value;
}

function parseAddressFlagValue(CliError, value, flagName) {
  const normalized = String(value || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a valid address.`);
  }
  return normalized.toLowerCase();
}

function requireFlagValue(args, index, flagName, CliError) {
  const value = args[index + 1];
  if (typeof value !== 'string' || value.startsWith('--')) {
    throw new CliError('MISSING_REQUIRED_FLAG', `Missing value for ${flagName}.`);
  }
  return value;
}

function parsePositiveNumberFlag(value, flagName, CliError) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a positive number.`);
  }
  return numeric;
}

function parsePositiveIntegerFlag(value, flagName, CliError) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a positive integer.`);
  }
  return numeric;
}

function parseFundingActionFlags(actionArgs, actionLabel, CliError) {
  const result = {
    amountUsdc: null,
    to: null,
    dryRun: false,
    execute: false,
  };
  for (let i = 0; i < actionArgs.length; i += 1) {
    const token = actionArgs[i];
    if (token === '--amount-usdc') {
      result.amountUsdc = parsePositiveNumberFlag(
        requireFlagValue(actionArgs, i, '--amount-usdc', CliError),
        '--amount-usdc',
        CliError,
      );
      i += 1;
      continue;
    }
    if (token === '--to') {
      result.to = parseAddressFlagValue(
        CliError,
        requireFlagValue(actionArgs, i, '--to', CliError),
        '--to',
      );
      i += 1;
      continue;
    }
    if (token === '--dry-run') {
      result.dryRun = true;
      continue;
    }
    if (token === '--execute') {
      result.execute = true;
      continue;
    }
  }
  if (result.dryRun === result.execute) {
    throw new CliError('INVALID_ARGS', `polymarket ${actionLabel} requires exactly one mode: --dry-run or --execute.`);
  }
  if (result.amountUsdc === null) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing --amount-usdc <amount>.');
  }
  return result;
}

function parsePolymarketFundingFlags(actionArgs, actionLabel, CliError, parsePolymarketSharedFlags) {
  const sharedArgs = [];
  const result = { rpcUrl: null, privateKey: null, funder: null, fork: false, forkRpcUrl: null, forkChainId: null };
  const fundingFlags = { amountUsdc: null, to: null, dryRun: false, execute: false };

  for (let i = 0; i < actionArgs.length; i += 1) {
    const token = actionArgs[i];
    if (token === '--amount-usdc' || token === '--to' || token === '--dry-run' || token === '--execute') {
      if (token === '--amount-usdc') {
        fundingFlags.amountUsdc = parsePositiveNumberFlag(
          requireFlagValue(actionArgs, i, '--amount-usdc', CliError),
          '--amount-usdc',
          CliError,
        );
      } else if (token === '--to') {
        fundingFlags.to = parseAddressFlagValue(
          CliError,
          requireFlagValue(actionArgs, i, '--to', CliError),
          '--to',
        );
      } else if (token === '--dry-run') {
        fundingFlags.dryRun = true;
      } else if (token === '--execute') {
        fundingFlags.execute = true;
      }
      i += 1;
      continue;
    }
    sharedArgs.push(token);
  }

  if (fundingFlags.dryRun === fundingFlags.execute) {
    throw new CliError('INVALID_ARGS', `polymarket ${actionLabel} requires exactly one mode: --dry-run or --execute.`);
  }
  if (fundingFlags.amountUsdc === null) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing --amount-usdc <amount>.');
  }

  const shared = parsePolymarketSharedFlags(sharedArgs, actionLabel);
  return {
    ...fundingFlags,
    rpcUrl: shared.rpcUrl,
    privateKey: shared.privateKey,
    funder: shared.funder,
    fork: shared.fork,
    forkRpcUrl: shared.forkRpcUrl,
    forkChainId: shared.forkChainId,
  };
}

function parsePolymarketBalanceFlags(actionArgs, CliError, parsePolymarketSharedFlags) {
  const options = {
    wallet: null,
    rpcUrl: null,
    privateKey: null,
    funder: null,
    fork: false,
    forkRpcUrl: null,
    forkChainId: null,
  };
  const shared = parsePolymarketSharedFlags(actionArgs, 'balance');
  for (const { token, value } of shared._rawTokens || []) {
    if (token === '--wallet') {
      options.wallet = parseAddressFlagValue(CliError, value, '--wallet');
    }
  }
  return {
    ...options,
    rpcUrl: shared.rpcUrl,
    privateKey: shared.privateKey,
    funder: shared.funder,
    fork: shared.fork,
    forkRpcUrl: shared.forkRpcUrl,
    forkChainId: shared.forkChainId,
  };
}

function parsePolymarketPreflightFlags(
  actionArgs,
  CliError,
  parsePolymarketSharedFlags,
  isSecureHttpUrlOrLocal,
) {
  const options = {
    conditionId: null,
    slug: null,
    token: null,
    tokenId: null,
    side: 'buy',
    amountUsdc: null,
    host: null,
    polymarketMockUrl: null,
    timeoutMs: null,
    rpcUrl: null,
    privateKey: null,
    funder: null,
    fork: false,
    forkRpcUrl: null,
    forkChainId: null,
  };

  let sawTradeSelector = false;
  let sawTradeInput = false;
  const sharedArgs = [];

  for (let i = 0; i < actionArgs.length; i += 1) {
    const token = actionArgs[i];
    if (token === '--condition-id' || token === '--market-id') {
      options.conditionId = requireFlagValue(actionArgs, i, token, CliError);
      sawTradeSelector = true;
      i += 1;
      continue;
    }
    if (token === '--slug') {
      options.slug = requireFlagValue(actionArgs, i, '--slug', CliError);
      sawTradeSelector = true;
      i += 1;
      continue;
    }
    if (token === '--token') {
      const value = String(requireFlagValue(actionArgs, i, '--token', CliError)).trim().toLowerCase();
      if (!['yes', 'no'].includes(value)) {
        throw new CliError('INVALID_FLAG_VALUE', '--token must be yes|no.');
      }
      options.token = value;
      sawTradeInput = true;
      i += 1;
      continue;
    }
    if (token === '--token-id') {
      options.tokenId = requireFlagValue(actionArgs, i, '--token-id', CliError);
      sawTradeSelector = true;
      sawTradeInput = true;
      i += 1;
      continue;
    }
    if (token === '--side') {
      const value = String(requireFlagValue(actionArgs, i, '--side', CliError)).trim().toLowerCase();
      if (!['buy', 'sell'].includes(value)) {
        throw new CliError('INVALID_FLAG_VALUE', '--side must be buy|sell.');
      }
      options.side = value;
      sawTradeInput = true;
      i += 1;
      continue;
    }
    if (token === '--amount-usdc') {
      options.amountUsdc = parsePositiveNumberFlag(
        requireFlagValue(actionArgs, i, '--amount-usdc', CliError),
        '--amount-usdc',
        CliError,
      );
      sawTradeInput = true;
      i += 1;
      continue;
    }
    if (token === '--polymarket-host') {
      const host = requireFlagValue(actionArgs, i, '--polymarket-host', CliError);
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
      const mockUrl = requireFlagValue(actionArgs, i, '--polymarket-mock-url', CliError);
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
      options.timeoutMs = parsePositiveIntegerFlag(
        requireFlagValue(actionArgs, i, '--timeout-ms', CliError),
        '--timeout-ms',
        CliError,
      );
      i += 1;
      continue;
    }
    sharedArgs.push(token);
  }

  const shared = parsePolymarketSharedFlags(sharedArgs, 'preflight');
  const tradeContextRequested = sawTradeSelector || sawTradeInput;
  if (tradeContextRequested) {
    if (options.amountUsdc === null) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Trade preflight requires --amount-usdc <amount>.');
    }
    if (!options.tokenId && !options.token) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Trade preflight requires --token yes|no (or --token-id <id>).');
    }
    if (!options.tokenId && !options.conditionId && !options.slug) {
      throw new CliError(
        'MISSING_REQUIRED_FLAG',
        'Trade preflight requires --condition-id <id> or --slug <slug> when --token-id is not set.',
      );
    }
  }

  return {
    ...options,
    timeoutMs: options.timeoutMs ?? shared.timeoutMs ?? null,
    rpcUrl: shared.rpcUrl,
    privateKey: shared.privateKey,
    funder: shared.funder,
    fork: shared.fork,
    forkRpcUrl: shared.forkRpcUrl,
    forkChainId: shared.forkChainId,
    tradeContextRequested,
  };
}

/**
 * Creates `polymarket` command runner.
 * @param {object} deps
 * @returns {(args: string[], context: {outputMode: string}) => Promise<void>}
 */
function createRunPolymarketCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const loadEnvIfPresent = requireDep(deps, 'loadEnvIfPresent');
  const parsePolymarketSharedFlags = requireDep(deps, 'parsePolymarketSharedFlags');
  const parsePolymarketApproveFlags = requireDep(deps, 'parsePolymarketApproveFlags');
  const parsePolymarketTradeFlags = requireDep(deps, 'parsePolymarketTradeFlags');
  const resolveForkRuntime = requireDep(deps, 'resolveForkRuntime');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');
  const runPolymarketCheck = requireDep(deps, 'runPolymarketCheck');
  const runPolymarketApprove = requireDep(deps, 'runPolymarketApprove');
  const runPolymarketPreflight = requireDep(deps, 'runPolymarketPreflight');
  const resolvePolymarketMarket = requireDep(deps, 'resolvePolymarketMarket');
  const readTradingCredsFromEnv = requireDep(deps, 'readTradingCredsFromEnv');
  const placeHedgeOrder = requireDep(deps, 'placeHedgeOrder');
  const renderPolymarketCheckTable = requireDep(deps, 'renderPolymarketCheckTable');
  const renderPolymarketApproveTable = requireDep(deps, 'renderPolymarketApproveTable');
  const renderPolymarketPreflightTable = requireDep(deps, 'renderPolymarketPreflightTable');
  const renderSingleEntityTable = requireDep(deps, 'renderSingleEntityTable');
  const defaultEnvFile = requireStringDep(deps, 'defaultEnvFile');
  const assertLiveWriteAllowed = typeof deps.assertLiveWriteAllowed === 'function' ? deps.assertLiveWriteAllowed : null;
  const opsService = typeof deps.runPolymarketBalance === 'function'
    && typeof deps.runPolymarketDeposit === 'function'
    && typeof deps.runPolymarketWithdraw === 'function'
    && typeof deps.runPolymarketPositions === 'function'
      ? null
      : require('./polymarket_ops_service.cjs');
  const runPolymarketBalance =
    typeof deps.runPolymarketBalance === 'function' ? deps.runPolymarketBalance : opsService.runPolymarketBalance;
  const runPolymarketPositions =
    typeof deps.runPolymarketPositions === 'function' ? deps.runPolymarketPositions : opsService.runPolymarketPositions;
  const runPolymarketDeposit =
    typeof deps.runPolymarketDeposit === 'function' ? deps.runPolymarketDeposit : opsService.runPolymarketDeposit;
  const runPolymarketWithdraw =
    typeof deps.runPolymarketWithdraw === 'function' ? deps.runPolymarketWithdraw : opsService.runPolymarketWithdraw;
  let cachedParsePolymarketPositionsFlags = null;
  let cachedFetchPolymarketPositionInventory = undefined;

  function toCliError(err, fallbackCode, fallbackMessage) {
    if (err && err.code) {
      return new CliError(err.code, err.message || fallbackMessage, err.details);
    }
    return new CliError(
      fallbackCode,
      fallbackMessage,
      { cause: err && err.message ? err.message : String(err) },
    );
  }

  function resolvePolymarketForkRuntime(options) {
    try {
      return resolveForkRuntime(options, {
        defaultChainId: 137,
        env: process.env,
        isSecureHttpUrlOrLocal,
      });
    } catch (err) {
      throw toCliError(err, 'POLYMARKET_RUNTIME_CONFIG_FAILED', 'Invalid polymarket runtime configuration.');
    }
  }

  function getParsePolymarketPositionsFlags() {
    if (typeof deps.parsePolymarketPositionsFlags === 'function') {
      return deps.parsePolymarketPositionsFlags;
    }
    if (cachedParsePolymarketPositionsFlags) {
      return cachedParsePolymarketPositionsFlags;
    }
    const parserModule = require('./parsers/polymarket_flags.cjs');
    if (typeof parserModule.createParsePolymarketPositionsFlags !== 'function') {
      return null;
    }
    cachedParsePolymarketPositionsFlags = parserModule.createParsePolymarketPositionsFlags({
      CliError,
      parsePolymarketSharedFlags,
      requireFlagValue: (argv, index, flagName) => requireFlagValue(argv, index, flagName, CliError),
      parseAddressFlag: (value, flagName) => parseAddressFlagValue(CliError, value, flagName),
      parsePositiveInteger: (value, flagName) => parsePositiveIntegerFlag(value, flagName, CliError),
      isSecureHttpUrlOrLocal,
      defaultTimeoutMs: DEFAULT_POLYMARKET_TIMEOUT_MS,
    });
    return cachedParsePolymarketPositionsFlags;
  }

  function getFetchPolymarketPositionInventory() {
    if (typeof deps.fetchPolymarketPositionInventory === 'function') {
      return deps.fetchPolymarketPositionInventory;
    }
    if (cachedFetchPolymarketPositionInventory !== undefined) {
      return cachedFetchPolymarketPositionInventory;
    }
    const tradeAdapter = require('./polymarket_trade_adapter.cjs');
    cachedFetchPolymarketPositionInventory =
      typeof tradeAdapter.fetchPolymarketPositionInventory === 'function'
        ? tradeAdapter.fetchPolymarketPositionInventory
        : null;
    return cachedFetchPolymarketPositionInventory;
  }

  return async function runPolymarketCommand(args, context) {
    loadEnvIfPresent(defaultEnvFile);

    const action = args[0];
    const actionArgs = args.slice(1);

    if (!action || action === '--help' || action === '-h') {
      const usage = 'pandora [--output table|json] polymarket check|approve|preflight|balance|positions|deposit|withdraw|trade ...';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'polymarket.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
        // eslint-disable-next-line no-console
        console.log('');
        // eslint-disable-next-line no-console
        console.log('Subcommands:');
        // eslint-disable-next-line no-console
        console.log('  check [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]');
        // eslint-disable-next-line no-console
        console.log('  approve --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]');
        // eslint-disable-next-line no-console
        console.log('  preflight [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]');
        // eslint-disable-next-line no-console
        console.log('  balance [--wallet <address>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]');
        // eslint-disable-next-line no-console
        console.log('  positions [--wallet <address>|--funder <address>] [--condition-id <id>|--market-id <id>|--slug <slug>|--token-id <id>] [--source auto|api|on-chain] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-data-api-url <url>] [--polymarket-mock-url <url>] [--timeout-ms <ms>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>]');
        // eslint-disable-next-line no-console
        console.log('  deposit --amount-usdc <n> --dry-run|--execute [--to <address>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]');
        // eslint-disable-next-line no-console
        console.log('  withdraw --amount-usdc <n> --dry-run|--execute [--to <address>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]');
        // eslint-disable-next-line no-console
        console.log(
          '  trade --condition-id <id>|--slug <slug>|--token-id <id> --token yes|no --amount-usdc <n> --dry-run|--execute [--side buy|sell] [--polymarket-host <url>] [--polymarket-mock-url <url>] [--timeout-ms <ms>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]',
        );
      }
      return;
    }

    if (action === 'check') {
      if (includesHelpFlag(actionArgs)) {
        const usage =
          'pandora [--output table|json] polymarket check [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]';
        if (context.outputMode === 'json') {
          emitSuccess(context.outputMode, 'polymarket.check.help', commandHelpPayload(usage));
        } else {
          // eslint-disable-next-line no-console
          console.log(`Usage: ${usage}`);
        }
        return;
      }

      const options = parsePolymarketSharedFlags(actionArgs, 'check');
      const runtime = resolvePolymarketForkRuntime(options);
      if (runtime.mode === 'fork') {
        options.rpcUrl = runtime.rpcUrl;
      }
      let payload;
      try {
        payload = await runPolymarketCheck(options);
      } catch (err) {
        throw toCliError(err, 'POLYMARKET_CHECK_FAILED', 'Polymarket check failed.');
      }
      payload.runtime = {
        ...(payload.runtime && typeof payload.runtime === 'object' ? payload.runtime : {}),
        mode: runtime.mode,
        forkChainId: runtime.chainId,
        forkRpcUrl: runtime.rpcUrl || null,
      };
      emitSuccess(context.outputMode, 'polymarket.check', payload, renderPolymarketCheckTable);
      return;
    }

    if (action === 'approve') {
      if (includesHelpFlag(actionArgs)) {
        const usage =
          'pandora [--output table|json] polymarket approve --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]';
        if (context.outputMode === 'json') {
          emitSuccess(context.outputMode, 'polymarket.approve.help', commandHelpPayload(usage));
        } else {
          // eslint-disable-next-line no-console
          console.log(`Usage: ${usage}`);
        }
        return;
      }

      const options = parsePolymarketApproveFlags(actionArgs);
      if (options.execute && assertLiveWriteAllowed) {
        await assertLiveWriteAllowed('polymarket.approve.execute', {
          runtimeMode: options.fork || options.forkRpcUrl ? 'fork' : 'live',
        });
      }
      const runtime = resolvePolymarketForkRuntime(options);
      if (runtime.mode === 'fork') {
        options.rpcUrl = runtime.rpcUrl;
      }
      let payload;
      try {
        payload = await runPolymarketApprove(options);
      } catch (err) {
        throw toCliError(err, 'POLYMARKET_APPROVE_FAILED', 'Polymarket approve failed.');
      }
      payload.runtime = {
        ...(payload.runtime && typeof payload.runtime === 'object' ? payload.runtime : {}),
        mode: runtime.mode,
        forkChainId: runtime.chainId,
        forkRpcUrl: runtime.rpcUrl || null,
      };
      emitSuccess(context.outputMode, 'polymarket.approve', payload, renderPolymarketApproveTable);
      return;
    }

    if (action === 'preflight') {
      if (includesHelpFlag(actionArgs)) {
        const usage =
          'pandora [--output table|json] polymarket preflight [--condition-id <id>|--slug <slug>|--token-id <id>] [--token yes|no] [--amount-usdc <n>] [--side buy|sell] [--polymarket-host <url>] [--polymarket-mock-url <url>] [--timeout-ms <ms>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]';
        if (context.outputMode === 'json') {
          emitSuccess(context.outputMode, 'polymarket.preflight.help', commandHelpPayload(usage));
        } else {
          // eslint-disable-next-line no-console
          console.log(`Usage: ${usage}`);
        }
        return;
      }

      const options = parsePolymarketPreflightFlags(
        actionArgs,
        CliError,
        parsePolymarketSharedFlags,
        isSecureHttpUrlOrLocal,
      );
      const runtime = resolvePolymarketForkRuntime(options);
      if (runtime.mode === 'fork') {
        options.rpcUrl = runtime.rpcUrl;
      }
      let payload;
      try {
        payload = await runPolymarketPreflight(options);
      } catch (err) {
        throw toCliError(err, 'POLYMARKET_PREFLIGHT_FAILED', 'Polymarket preflight failed.');
      }
      payload.runtime = {
        ...(payload.runtime && typeof payload.runtime === 'object' ? payload.runtime : {}),
        mode: runtime.mode,
        forkChainId: runtime.chainId,
        forkRpcUrl: runtime.rpcUrl || null,
      };
      emitSuccess(context.outputMode, 'polymarket.preflight', payload, renderPolymarketPreflightTable);
      return;
    }

    if (action === 'balance') {
      if (includesHelpFlag(actionArgs)) {
        const usage =
          'pandora [--output table|json] polymarket balance [--wallet <address>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]';
        const notes = [
          'Funding-only surface: reads raw Polygon USDC.e wallet collateral only; it does not query authenticated Polymarket CLOB buying power, YES/NO inventory, or open orders.',
          'If this command shows 0 while the Polymarket UI shows buying power, treat that as a scope mismatch first: proxy/CLOB accounting can differ from raw wallet collateral.',
          'Use polymarket positions --wallet <address> --source auto when you need CTF balances, open orders, or merge-readiness diagnostics.',
        ];
        if (context.outputMode === 'json') {
          emitSuccess(context.outputMode, 'polymarket.balance.help', commandHelpPayload(usage, notes));
        } else {
          // eslint-disable-next-line no-console
          console.log(`Usage: ${usage}`);
          for (const note of notes) {
            // eslint-disable-next-line no-console
            console.log(`Note: ${note}`);
          }
        }
        return;
      }

      const options = parsePolymarketBalanceFlags(actionArgs, CliError, parsePolymarketSharedFlags);
      const runtime = resolvePolymarketForkRuntime(options);
      if (runtime.mode === 'fork') {
        options.rpcUrl = runtime.rpcUrl;
      }
      let payload;
      try {
        payload = await runPolymarketBalance(options);
      } catch (err) {
        throw toCliError(err, 'POLYMARKET_BALANCE_FAILED', 'Polymarket balance failed.');
      }
      payload.runtime = {
        ...(payload.runtime && typeof payload.runtime === 'object' ? payload.runtime : {}),
        mode: runtime.mode,
        forkChainId: runtime.chainId,
        forkRpcUrl: runtime.rpcUrl || null,
      };
      emitSuccess(context.outputMode, 'polymarket.balance', payload, renderSingleEntityTable);
      return;
    }

    if (action === 'positions') {
      if (includesHelpFlag(actionArgs)) {
        const usage =
          'pandora [--output table|json] polymarket positions [--wallet <address>|--funder <address>] [--condition-id <id>|--market-id <id>|--slug <slug>|--token-id <id>] [--source auto|api|on-chain] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-data-api-url <url>] [--polymarket-mock-url <url>] [--timeout-ms <ms>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>]';
        const notes = [
          '--source auto prefers Polymarket API/CLOB enrichment and falls back to raw on-chain CTF balances when available.',
          '--source api prefers public Polymarket enrichment for metadata, open orders, and marked value fields.',
          '--source on-chain forces Polygon RPC / CTF balance reads and may leave prices or open-order fields as diagnostics/null.',
          'Merge-readiness diagnostics are advisory: they highlight overlapping YES/NO pairs, owner-vs-signer mismatches, and known blockers, but they do not execute merges or prove operator approvals.',
        ];
        if (context.outputMode === 'json') {
          emitSuccess(context.outputMode, 'polymarket.positions.help', commandHelpPayload(usage, notes));
        } else {
          // eslint-disable-next-line no-console
          console.log(`Usage: ${usage}`);
          for (const note of notes) {
            // eslint-disable-next-line no-console
            console.log(`Note: ${note}`);
          }
        }
        return;
      }

      const parsePositionsFlags = getParsePolymarketPositionsFlags();
      if (typeof parsePositionsFlags !== 'function') {
        throw new CliError(
          'POLYMARKET_POSITIONS_UNAVAILABLE',
          'polymarket positions flag parsing is unavailable in this build.',
        );
      }
      const options = parsePositionsFlags(actionArgs);
      const runtime = resolvePolymarketForkRuntime(options);
      if (runtime.mode === 'fork') {
        options.rpcUrl = runtime.rpcUrl;
      }

      let payload;
      try {
        payload = await runPolymarketPositions({
          wallet: options.wallet,
          conditionId: options.conditionId,
          marketId: options.conditionId,
          slug: options.slug,
          tokenId: options.tokenIds.length === 1 ? options.tokenIds[0] : null,
          tokenIds: options.tokenIds,
          source: options.source,
          rpcUrl: options.rpcUrl,
          privateKey: options.privateKey,
          funder: options.funder,
          fork: options.fork,
          forkRpcUrl: options.forkRpcUrl,
          forkChainId: options.forkChainId,
          host: options.host,
          gammaUrl: options.gammaUrl,
          dataApiUrl: options.dataApiUrl,
          polymarketMockUrl: options.polymarketMockUrl,
          timeoutMs: options.timeoutMs,
          env: process.env,
        });
      } catch (err) {
        throw toCliError(err, 'POLYMARKET_POSITIONS_FAILED', 'Polymarket positions lookup failed.');
      }
      payload.runtime = {
        ...(payload.runtime && typeof payload.runtime === 'object' ? payload.runtime : {}),
        mode: runtime.mode,
        forkChainId: runtime.chainId,
        forkRpcUrl: runtime.rpcUrl || null,
      };
      emitSuccess(context.outputMode, 'polymarket.positions', payload, renderSingleEntityTable);
      return;
    }

    if (action === 'deposit' || action === 'withdraw') {
      if (includesHelpFlag(actionArgs)) {
        const usage = action === 'withdraw'
          ? 'pandora [--output table|json] polymarket withdraw --amount-usdc <n> --dry-run|--execute [--to <address>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]'
          : 'pandora [--output table|json] polymarket deposit --amount-usdc <n> --dry-run|--execute [--to <address>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]';
        if (context.outputMode === 'json') {
          const notes = action === 'withdraw'
            ? ['Execute mode only works when the signer controls the source wallet. Proxy-originated withdrawals usually need manual execution from the proxy wallet.']
            : null;
          emitSuccess(context.outputMode, `polymarket.${action}.help`, commandHelpPayload(usage, notes));
        } else {
          // eslint-disable-next-line no-console
          console.log(`Usage: ${usage}`);
          if (action === 'withdraw') {
            // eslint-disable-next-line no-console
            console.log('Note: execute mode only works when the signer controls the source wallet. Proxy-originated withdrawals usually need manual execution from the proxy wallet.');
          }
        }
        return;
      }

      const options = parsePolymarketFundingFlags(actionArgs, action, CliError, parsePolymarketSharedFlags);
      if (options.execute && assertLiveWriteAllowed) {
        await assertLiveWriteAllowed(`polymarket.${action}.execute`, {
          notionalUsdc: options.amountUsdc,
          runtimeMode: options.fork || options.forkRpcUrl ? 'fork' : 'live',
        });
      }
      const runtime = resolvePolymarketForkRuntime(options);
      if (runtime.mode === 'fork') {
        options.rpcUrl = runtime.rpcUrl;
      }
      let payload;
      try {
        payload = action === 'deposit'
          ? await runPolymarketDeposit(options)
          : await runPolymarketWithdraw(options);
      } catch (err) {
        throw toCliError(
          err,
          action === 'deposit' ? 'POLYMARKET_DEPOSIT_FAILED' : 'POLYMARKET_WITHDRAW_FAILED',
          `Polymarket ${action} failed.`,
        );
      }
      payload.runtime = {
        ...(payload.runtime && typeof payload.runtime === 'object' ? payload.runtime : {}),
        mode: runtime.mode,
        forkChainId: runtime.chainId,
        forkRpcUrl: runtime.rpcUrl || null,
      };
      emitSuccess(context.outputMode, `polymarket.${action}`, payload, renderSingleEntityTable);
      return;
    }

    if (action === 'trade') {
      if (includesHelpFlag(actionArgs)) {
        const usage =
          'pandora [--output table|json] polymarket trade --condition-id <id>|--slug <slug>|--token-id <id> --token yes|no --amount-usdc <n> --dry-run|--execute [--side buy|sell] [--polymarket-host <url>] [--polymarket-mock-url <url>] [--timeout-ms <ms>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]';
        if (context.outputMode === 'json') {
          emitSuccess(context.outputMode, 'polymarket.trade.help', commandHelpPayload(usage));
        } else {
          // eslint-disable-next-line no-console
          console.log(`Usage: ${usage}`);
        }
        return;
      }

      const options = parsePolymarketTradeFlags(actionArgs);
      if (options.execute && assertLiveWriteAllowed) {
        await assertLiveWriteAllowed('polymarket.trade.execute', {
          notionalUsdc: options.amountUsdc,
          runtimeMode: options.fork || options.forkRpcUrl ? 'fork' : 'live',
        });
      }
      const runtime = resolvePolymarketForkRuntime(options);
      if (runtime.mode === 'fork') {
        options.rpcUrl = runtime.rpcUrl;
      }
      let market = null;
      let tokenId = options.tokenId;
      if (!tokenId) {
        try {
          market = await resolvePolymarketMarket({
            host: options.host || process.env.POLYMARKET_HOST || null,
            timeoutMs: options.timeoutMs,
            marketId: options.conditionId,
            slug: options.slug,
          });
        } catch (err) {
          throw toCliError(
            err,
            'POLYMARKET_MARKET_RESOLUTION_FAILED',
            'Unable to resolve Polymarket market details.',
          );
        }
        tokenId = options.token === 'yes' ? market.yesTokenId : market.noTokenId;
        if (!tokenId) {
          throw new CliError(
            'POLYMARKET_TOKEN_MAPPING_FAILED',
            `Unable to resolve ${String(options.token || '').toUpperCase()} token id for target market.`,
            {
              conditionId: options.conditionId,
              slug: options.slug,
              market,
            },
          );
        }
      }

      if (options.dryRun) {
        const tradeHost = options.host || process.env.POLYMARKET_HOST || null;
        const previewHost = tradeHost || options.polymarketMockUrl || null;
        const payload = {
          mode: 'dry-run',
          status: 'planned',
          runtime: {
            mode: runtime.mode,
            forkChainId: runtime.chainId,
            forkRpcUrl: runtime.rpcUrl || null,
          },
          transportRuntime: {
            mode: runtime.mode,
            chainId: runtime.chainId,
            rpcUrl: runtime.rpcUrl || options.rpcUrl || null,
          },
          conditionId: options.conditionId || (market && market.marketId) || null,
          slug: options.slug || (market && market.slug) || null,
          token: options.token || null,
          tokenId,
          side: options.side,
          amountUsdc: options.amountUsdc,
          host: tradeHost,
        };
        if (runtime.mode === 'fork') {
          payload.preview = await buildPolymarketForkPreview({
            host: previewHost,
            tokenId,
            side: options.side,
            amountUsdc: options.amountUsdc,
            timeoutMs: options.timeoutMs,
          });
        }
        emitSuccess(context.outputMode, 'polymarket.trade', payload, renderSingleEntityTable);
        return;
      }

      const envCreds = readTradingCredsFromEnv();
      if (!options.privateKey && envCreds.privateKeyInvalid) {
        throw new CliError(
          'INVALID_FLAG_VALUE',
          'POLYMARKET_PRIVATE_KEY must be a valid private key (0x + 64 hex chars).',
        );
      }
      if (runtime.mode === 'fork' && !options.polymarketMockUrl) {
        throw new CliError(
          'FORK_EXECUTION_REQUIRES_MOCK_URL',
          'polymarket trade --execute in fork mode is simulation-only unless --polymarket-mock-url is provided.',
          {
            hints: [
              'Pass --polymarket-mock-url http://127.0.0.1:xxxx to emulate CLOB order posting in fork mode.',
              'Or rerun with --dry-run for planning only.',
            ],
          },
        );
      }
      let result;
      try {
        result = await placeHedgeOrder({
          host: options.polymarketMockUrl || options.host || envCreds.host || null,
          tokenId,
          side: options.side,
          amountUsd: options.amountUsdc,
          privateKey: options.privateKey || envCreds.privateKey,
          funder: options.funder || envCreds.funder,
          apiKey: envCreds.apiKey,
          apiSecret: envCreds.apiSecret,
          apiPassphrase: envCreds.apiPassphrase,
        });
      } catch (err) {
        throw toCliError(err, 'POLYMARKET_TRADE_FAILED', 'Polymarket trade execution failed.');
      }

      if (!result || result.ok === false) {
        throw new CliError(
          'POLYMARKET_TRADE_FAILED',
          result && result.error && result.error.message ? result.error.message : 'Polymarket order was rejected.',
          { result },
        );
      }

      emitSuccess(context.outputMode, 'polymarket.trade', {
        mode: 'execute',
        status: 'submitted',
        runtime: {
          mode: runtime.mode,
          forkChainId: runtime.chainId,
          forkRpcUrl: runtime.rpcUrl || null,
        },
        transportRuntime: {
          mode: runtime.mode,
          chainId: runtime.chainId,
          rpcUrl: runtime.rpcUrl || options.rpcUrl || null,
        },
        conditionId: options.conditionId || (market && market.marketId) || null,
        slug: options.slug || (market && market.slug) || null,
        token: options.token || null,
        tokenId,
        side: options.side,
        amountUsdc: options.amountUsdc,
        result,
      }, renderSingleEntityTable);
      return;
    }

    throw new CliError('INVALID_ARGS', 'polymarket requires subcommand: check|approve|preflight|balance|positions|deposit|withdraw|trade');
  };
}

module.exports = {
  createRunPolymarketCommand,
};
