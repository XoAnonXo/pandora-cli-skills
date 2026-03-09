const { buildTradeForkPreview } = require('./fork_preview_service.cjs');

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunTradeCommand requires deps.${name}()`);
  }
  return deps[name];
}

/**
 * Creates a trade-like command runner.
 * @param {object} deps
 * @param {{commandName: string, defaultMode: 'buy'|'sell', helpPayload: Function, helpCommand: string, quoteHelpCommand: string, printHelpTable: Function}} config
 * @returns {(args: string[], context: {outputMode: string}) => Promise<void>}
 */
function createRunOutcomeTradeCommand(deps, config) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const parseIndexerSharedFlags = requireDep(deps, 'parseIndexerSharedFlags');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const quoteHelpJsonPayload = requireDep(deps, 'quoteHelpJsonPayload');
  const maybeLoadTradeEnv = requireDep(deps, 'maybeLoadTradeEnv');
  const parseQuoteFlags = requireDep(deps, 'parseQuoteFlags');
  const parseTradeFlags = requireDep(deps, 'parseTradeFlags');
  const resolveIndexerUrl = requireDep(deps, 'resolveIndexerUrl');
  const buildQuotePayload = requireDep(deps, 'buildQuotePayload');
  const enforceTradeRiskGuards = requireDep(deps, 'enforceTradeRiskGuards');
  const getSelectedOutcomeProbabilityPct = requireDep(deps, 'getSelectedOutcomeProbabilityPct');
  const buildTradeRiskGuardConfig = requireDep(deps, 'buildTradeRiskGuardConfig');
  const executeTradeOnchain = requireDep(deps, 'executeTradeOnchain');
  const resolveForkRuntime = requireDep(deps, 'resolveForkRuntime');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');
  const renderQuoteTable = requireDep(deps, 'renderQuoteTable');
  const renderTradeTable = requireDep(deps, 'renderTradeTable');
  const assertLiveWriteAllowed = typeof deps.assertLiveWriteAllowed === 'function' ? deps.assertLiveWriteAllowed : null;
  const {
    commandName,
    defaultMode,
    helpPayload,
    helpCommand,
    quoteHelpCommand,
    printHelpTable,
  } = config;

  return async function runOutcomeTradeCommand(args, context) {
    const shared = parseIndexerSharedFlags(args);
    if (shared.rest[0] === 'quote') {
      const quoteArgs = shared.rest.slice(1);
      if (includesHelpFlag(quoteArgs)) {
        if (context.outputMode === 'json') {
          emitSuccess(context.outputMode, quoteHelpCommand, quoteHelpJsonPayload(defaultMode));
        } else {
          // eslint-disable-next-line no-console
          if (typeof printHelpTable === 'function' && defaultMode === 'sell') {
            printHelpTable(true);
          } else {
            console.log('Usage: pandora trade quote --market-address <address> --side yes|no --amount-usdc <amount>|--amounts <csv> [--yes-pct <0-100>] [--slippage-bps <0-10000>]');
          }
        }
        return;
      }
      maybeLoadTradeEnv(shared);
      const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
      const parsedQuoteOptions = parseQuoteFlags(quoteArgs);
      const quoteOptions = {
        ...parsedQuoteOptions,
        mode: defaultMode === 'sell' ? 'sell' : (parsedQuoteOptions.mode || 'buy'),
      };
      const payload = await buildQuotePayload(indexerUrl, quoteOptions, shared.timeoutMs);
      emitSuccess(context.outputMode, `${commandName}.quote`, payload, renderQuoteTable);
      return;
    }

    if (shared.rest.includes('--help') || shared.rest.includes('-h')) {
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, helpCommand, helpPayload());
      } else {
        printHelpTable();
      }
      return;
    }
    maybeLoadTradeEnv(shared);
    const parsedOptions = parseTradeFlags(shared.rest);
    const options = {
      ...parsedOptions,
      mode: defaultMode === 'sell' ? 'sell' : (parsedOptions.mode || 'buy'),
    };
    const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
    const quote = await buildQuotePayload(indexerUrl, options, shared.timeoutMs);
    enforceTradeRiskGuards(options, quote);
    const selectedProbabilityPct = getSelectedOutcomeProbabilityPct(quote, options.side);
    const riskGuards = buildTradeRiskGuardConfig(options);

    if (options.dryRun) {
      let runtime;
      try {
        const resolved = resolveForkRuntime(options, {
          env: process.env,
          isSecureHttpUrlOrLocal,
          defaultChainId: Number(process.env.CHAIN_ID || 1) || 1,
        });
        runtime = {
          mode: resolved.mode,
          chainId: resolved.chainId,
          rpcUrl: resolved.mode === 'fork' ? resolved.rpcUrl : options.rpcUrl || null,
        };
      } catch (err) {
        if (err && err.code) {
          throw new CliError(err.code, err.message || 'Invalid runtime configuration.', err.details);
        }
        throw err;
      }

      const dryRunPayload = {
        mode: 'dry-run',
        generatedAt: new Date().toISOString(),
        status: 'ok',
        runtime,
        marketAddress: options.marketAddress,
        action: options.mode,
        side: options.side,
        amountUsdc: options.amountUsdc,
        amount: options.amount,
        minSharesOutRaw: options.minSharesOutRaw == null ? '0' : options.minSharesOutRaw.toString(),
        minAmountOutRaw: options.minAmountOutRaw == null ? '0' : options.minAmountOutRaw.toString(),
        selectedProbabilityPct,
        riskGuards,
        quote,
        executionPlan: {
          steps: options.mode === 'sell'
            ? ['check outcome token allowance', 'approve outcome token if needed', 'sell outcome shares']
            : ['check allowance', 'approve USDC if needed', 'buy outcome shares'],
          executeFlagRequired: '--execute',
        },
      };
      if (runtime.mode === 'fork') {
        dryRunPayload.preview = buildTradeForkPreview({
          quote,
          amountUsdc: options.amountUsdc,
          amount: options.amount,
          side: options.side,
          mode: options.mode,
        });
      }
      emitSuccess(context.outputMode, commandName, dryRunPayload, renderTradeTable);
      return;
    }

    if (assertLiveWriteAllowed) {
      const quoteEstimate = quote && quote.estimate && typeof quote.estimate === 'object' ? quote.estimate : {};
      await assertLiveWriteAllowed(`${commandName}.execute`, {
        notionalUsdc:
          options.mode === 'sell'
            ? Number(quoteEstimate.estimatedUsdcOut || quoteEstimate.grossUsdcOut || 0)
            : options.amountUsdc,
        runtimeMode: options.fork || options.forkRpcUrl ? 'fork' : 'live',
      });
    }

    const execution = await executeTradeOnchain(options);

    const payload = {
      mode: 'execute',
      generatedAt: new Date().toISOString(),
      status: 'submitted',
      runtime: {
        mode: execution.mode || 'live',
        chainId: execution.chainId,
        rpcUrl: execution.rpcUrl || null,
      },
      chainId: execution.chainId,
      marketAddress: options.marketAddress,
      action: execution.action || options.mode,
      marketType: execution.marketType || null,
      tradeSignature: execution.tradeSignature || null,
      buySignature: execution.action === 'buy' ? execution.tradeSignature || null : null,
      sellSignature: execution.action === 'sell' ? execution.tradeSignature || null : null,
      ammDeadlineEpoch: execution.ammDeadlineEpoch || null,
      side: options.side,
      amountUsdc: options.amountUsdc,
      amount: options.amount,
      amountRaw: execution.amountRaw,
      minSharesOutRaw: execution.minSharesOutRaw,
      minAmountOutRaw: execution.minAmountOutRaw,
      selectedProbabilityPct,
      riskGuards,
      account: execution.account,
      usdc: execution.usdc,
      approvalAsset: execution.approvalAsset || null,
      approveTxHash: execution.approveTxHash,
      approveTxUrl: execution.approveTxUrl,
      approveGasEstimate: execution.approveGasEstimate,
      approveStatus: execution.approveStatus,
      tradeTxHash: execution.tradeTxHash,
      tradeTxUrl: execution.tradeTxUrl,
      tradeGasEstimate: execution.tradeGasEstimate,
      tradeStatus: execution.tradeStatus,
      buyTxHash: execution.action === 'buy' ? execution.tradeTxHash : null,
      buyTxUrl: execution.action === 'buy' ? execution.tradeTxUrl : null,
      buyGasEstimate: execution.action === 'buy' ? execution.tradeGasEstimate : null,
      buyStatus: execution.action === 'buy' ? execution.tradeStatus : null,
      sellTxHash: execution.action === 'sell' ? execution.tradeTxHash : null,
      sellTxUrl: execution.action === 'sell' ? execution.tradeTxUrl : null,
      sellGasEstimate: execution.action === 'sell' ? execution.tradeGasEstimate : null,
      sellStatus: execution.action === 'sell' ? execution.tradeStatus : null,
      finalStatus: execution.status,
      quote,
    };

    emitSuccess(context.outputMode, commandName, payload, renderTradeTable);
  };
}

/**
 * Creates the `trade` command runner.
 * @param {object} deps
 * @returns {(args: string[], context: {outputMode: string}) => Promise<void>}
 */
function createRunTradeCommand(deps) {
  return createRunOutcomeTradeCommand(deps, {
    commandName: 'trade',
    defaultMode: 'buy',
    helpPayload: () => requireDep(deps, 'tradeHelpJsonPayload')(),
    helpCommand: 'trade.help',
    quoteHelpCommand: 'trade.quote.help',
    printHelpTable: requireDep(deps, 'printTradeHelpTable'),
  });
}

/**
 * Creates the `sell` command runner.
 * @param {object} deps
 * @returns {(args: string[], context: {outputMode: string}) => Promise<void>}
 */
function createRunSellCommand(deps) {
  return createRunOutcomeTradeCommand(deps, {
    commandName: 'sell',
    defaultMode: 'sell',
    helpPayload: () => requireDep(deps, 'sellHelpJsonPayload')(),
    helpCommand: 'sell.help',
    quoteHelpCommand: 'sell.quote.help',
    printHelpTable: requireDep(deps, 'printSellHelpTable'),
  });
}

module.exports = {
  createRunTradeCommand,
  createRunSellCommand,
};
