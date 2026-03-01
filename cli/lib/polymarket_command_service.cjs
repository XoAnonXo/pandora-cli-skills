const { buildPolymarketForkPreview } = require('./fork_preview_service.cjs');

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

  return async function runPolymarketCommand(args, context) {
    loadEnvIfPresent(defaultEnvFile);

    const action = args[0];
    const actionArgs = args.slice(1);

    if (!action || action === '--help' || action === '-h') {
      const usage = 'pandora [--output table|json] polymarket check|approve|preflight|trade ...';
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
          'pandora [--output table|json] polymarket preflight [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]';
        if (context.outputMode === 'json') {
          emitSuccess(context.outputMode, 'polymarket.preflight.help', commandHelpPayload(usage));
        } else {
          // eslint-disable-next-line no-console
          console.log(`Usage: ${usage}`);
        }
        return;
      }

      const options = parsePolymarketSharedFlags(actionArgs, 'preflight');
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

    throw new CliError('INVALID_ARGS', 'polymarket requires subcommand: check|approve|preflight|trade');
  };
}

module.exports = {
  createRunPolymarketCommand,
};
