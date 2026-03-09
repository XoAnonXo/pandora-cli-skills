const { DEFAULT_AMM_TRADE_DEADLINE_OFFSET_SEC } = require('../trade_market_type_service.cjs');

const DEFAULT_MIRROR_REBALANCE_SLIPPAGE_BPS = 150;
const MIRROR_REBALANCE_ROUTE_VALUES = new Set(['public', 'auto', 'flashbots-private', 'flashbots-bundle']);
const MIRROR_REBALANCE_ROUTE_FALLBACK_VALUES = new Set(['fail', 'public']);

function firstDefined() {
  for (const value of arguments) {
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

function normalizeMirrorRebalanceRoute(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return MIRROR_REBALANCE_ROUTE_VALUES.has(normalized) ? normalized : null;
}

function normalizeMirrorRebalanceRouteFallback(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return MIRROR_REBALANCE_ROUTE_FALLBACK_VALUES.has(normalized) ? normalized : null;
}

function normalizeOptionalText(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeOptionalInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const integer = Math.trunc(numeric);
  return integer >= 0 ? integer : null;
}

function buildMirrorRebalanceTradeOptions(executionOptions = {}, runtimeOptions = {}) {
  const amountUsdc = executionOptions.amountUsdc;
  const rebalanceRoute = normalizeMirrorRebalanceRoute(
    firstDefined(executionOptions.rebalanceRoute, runtimeOptions.rebalanceRoute),
  );
  const rebalanceRouteFallback = normalizeMirrorRebalanceRouteFallback(
    firstDefined(executionOptions.rebalanceRouteFallback, runtimeOptions.rebalanceRouteFallback),
  );
  const flashbotsRelayUrl = normalizeOptionalText(
    firstDefined(executionOptions.flashbotsRelayUrl, runtimeOptions.flashbotsRelayUrl),
  );
  const flashbotsAuthKey = normalizeOptionalText(
    firstDefined(executionOptions.flashbotsAuthKey, runtimeOptions.flashbotsAuthKey),
  );
  const flashbotsTargetBlockOffset = normalizeOptionalInteger(
    firstDefined(executionOptions.flashbotsTargetBlockOffset, runtimeOptions.flashbotsTargetBlockOffset),
  );
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
    rebalanceRoute,
    rebalanceRouteFallback,
    flashbotsRelayUrl,
    flashbotsAuthKey,
    flashbotsTargetBlockOffset,
  };
}

module.exports = {
  DEFAULT_MIRROR_REBALANCE_SLIPPAGE_BPS,
  buildMirrorRebalanceTradeOptions,
};
