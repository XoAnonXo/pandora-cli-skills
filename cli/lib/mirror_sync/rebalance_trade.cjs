const { DEFAULT_AMM_TRADE_DEADLINE_OFFSET_SEC } = require('../trade_market_type_service.cjs');

const DEFAULT_MIRROR_REBALANCE_SLIPPAGE_BPS = 150;

function buildMirrorRebalanceTradeOptions(executionOptions = {}, runtimeOptions = {}) {
  const amountUsdc = executionOptions.amountUsdc;
  return {
    marketAddress: executionOptions.marketAddress,
    side: executionOptions.side,
    mode: 'buy',
    amountUsdc,
    yesPct: null,
    slippageBps:
      Number.isFinite(Number(runtimeOptions.rebalanceSlippageBps))
        ? Number(runtimeOptions.rebalanceSlippageBps)
        : DEFAULT_MIRROR_REBALANCE_SLIPPAGE_BPS,
    dryRun: false,
    execute: true,
    minSharesOutRaw: null,
    minAmountOutRaw: null,
    maxAmountUsdc: amountUsdc,
    minProbabilityPct: null,
    maxProbabilityPct: null,
    allowUnquotedExecute: true,
    deadlineSeconds:
      Number.isFinite(Number(runtimeOptions.deadlineSeconds))
        ? Number(runtimeOptions.deadlineSeconds)
        : DEFAULT_AMM_TRADE_DEADLINE_OFFSET_SEC,
    chainId: runtimeOptions.chainId,
    rpcUrl: runtimeOptions.rpcUrl,
    privateKey: runtimeOptions.privateKey,
    profileId: runtimeOptions.profileId || null,
    profileFile: runtimeOptions.profileFile || null,
    usdc: runtimeOptions.usdc || null,
  };
}

module.exports = {
  DEFAULT_MIRROR_REBALANCE_SLIPPAGE_BPS,
  buildMirrorRebalanceTradeOptions,
};
