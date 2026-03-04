const { buildTradeForkPreview } = require('./fork_preview_service.cjs');

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunTradeCommand requires deps.${name}()`);
  }
  return deps[name];
}

/**
 * Creates the `trade` command runner.
 * @param {object} deps
 * @returns {(args: string[], context: {outputMode: string}) => Promise<void>}
 */
function createRunTradeCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const parseIndexerSharedFlags = requireDep(deps, 'parseIndexerSharedFlags');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const tradeHelpJsonPayload = requireDep(deps, 'tradeHelpJsonPayload');
  const quoteHelpJsonPayload = requireDep(deps, 'quoteHelpJsonPayload');
  const printTradeHelpTable = requireDep(deps, 'printTradeHelpTable');
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

  return async function runTradeCommand(args, context) {
    const shared = parseIndexerSharedFlags(args);
    if (shared.rest[0] === 'quote') {
      const quoteArgs = shared.rest.slice(1);
      if (includesHelpFlag(quoteArgs)) {
        if (context.outputMode === 'json') {
          emitSuccess(context.outputMode, 'trade.quote.help', quoteHelpJsonPayload());
        } else {
          // eslint-disable-next-line no-console
          console.log('Usage: pandora trade quote --market-address <address> --side yes|no --amount-usdc <amount>|--amounts <csv> [--yes-pct <0-100>] [--slippage-bps <0-10000>]');
        }
        return;
      }
      maybeLoadTradeEnv(shared);
      const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
      const quoteOptions = parseQuoteFlags(quoteArgs);
      const payload = await buildQuotePayload(indexerUrl, quoteOptions, shared.timeoutMs);
      emitSuccess(context.outputMode, 'trade.quote', payload, renderQuoteTable);
      return;
    }

    if (shared.rest.includes('--help') || shared.rest.includes('-h')) {
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'trade.help', tradeHelpJsonPayload());
      } else {
        printTradeHelpTable();
      }
      return;
    }
    maybeLoadTradeEnv(shared);
    const options = parseTradeFlags(shared.rest);
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
        side: options.side,
        amountUsdc: options.amountUsdc,
        minSharesOutRaw: options.minSharesOutRaw === null ? '0' : options.minSharesOutRaw.toString(),
        selectedProbabilityPct,
        riskGuards,
        quote,
        executionPlan: {
          steps: ['check allowance', 'approve USDC if needed', 'buy outcome shares'],
          executeFlagRequired: '--execute',
        },
      };
      if (runtime.mode === 'fork') {
        dryRunPayload.preview = buildTradeForkPreview({
          quote,
          amountUsdc: options.amountUsdc,
          side: options.side,
        });
      }
      emitSuccess(context.outputMode, 'trade', dryRunPayload, renderTradeTable);
      return;
    }

    if (assertLiveWriteAllowed) {
      await assertLiveWriteAllowed('trade.execute', {
        notionalUsdc: options.amountUsdc,
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
      marketType: execution.marketType || null,
      buySignature: execution.buySignature || null,
      ammDeadlineEpoch: execution.ammDeadlineEpoch || null,
      side: options.side,
      amountUsdc: options.amountUsdc,
      amountRaw: execution.amountRaw,
      minSharesOutRaw: execution.minSharesOutRaw,
      selectedProbabilityPct,
      riskGuards,
      account: execution.account,
      usdc: execution.usdc,
      approveTxHash: execution.approveTxHash,
      approveTxUrl: execution.approveTxUrl,
      approveGasEstimate: execution.approveGasEstimate,
      approveStatus: execution.approveStatus,
      buyTxHash: execution.buyTxHash,
      buyTxUrl: execution.buyTxUrl,
      buyGasEstimate: execution.buyGasEstimate,
      buyStatus: execution.buyStatus,
      finalStatus: execution.status,
      quote,
    };

    emitSuccess(context.outputMode, 'trade', payload, renderTradeTable);
  };
}

module.exports = {
  createRunTradeCommand,
};
