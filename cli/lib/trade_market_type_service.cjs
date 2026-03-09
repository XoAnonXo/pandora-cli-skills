const PARI_MUTUEL_BUY_ABI = [
  {
    name: 'buy',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'isYes', type: 'bool' },
      { name: 'collateralAmount', type: 'uint256' },
      { name: 'minSharesOut', type: 'uint256' },
    ],
    outputs: [{ name: 'sharesOut', type: 'uint256' }],
  },
];

const PREDICTION_AMM_BUY_ABI = [
  {
    name: 'buy',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'isYes', type: 'bool' },
      { name: 'collateralAmount', type: 'uint256' },
      { name: 'minSharesOut', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'sharesOut', type: 'uint256' }],
  },
];

const PREDICTION_AMM_SELL_ABI = [
  {
    name: 'sell',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'isYes', type: 'bool' },
      { name: 'amount', type: 'uint112' },
      { name: 'minAmountOut', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
];

const PARI_MUTUEL_MARKER_ABI = [
  {
    type: 'function',
    name: 'curveFlattener',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
];

const PREDICTION_AMM_MARKER_ABI = [
  {
    type: 'function',
    name: 'tradingFee',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint24' }],
  },
];

const DEFAULT_AMM_TRADE_DEADLINE_OFFSET_SEC = 15 * 60;

function createTradeTypeError(code, message, details = undefined) {
  const err = new Error(message);
  err.code = code;
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

/**
 * Detects supported Pandora market type by probing stable view-method markers.
 * @param {{readContract: Function}} publicClient
 * @param {`0x${string}`} marketAddress
 * @returns {Promise<{marketType:'parimutuel'|'amm', detectedBy:string}>}
 */
async function detectTradeMarketType(publicClient, marketAddress) {
  let pariError = null;
  try {
    await publicClient.readContract({
      address: marketAddress,
      abi: PARI_MUTUEL_MARKER_ABI,
      functionName: 'curveFlattener',
    });
    return {
      marketType: 'parimutuel',
      detectedBy: 'curveFlattener',
    };
  } catch (err) {
    pariError = err;
  }

  let ammError = null;
  try {
    await publicClient.readContract({
      address: marketAddress,
      abi: PREDICTION_AMM_MARKER_ABI,
      functionName: 'tradingFee',
    });
    return {
      marketType: 'amm',
      detectedBy: 'tradingFee',
    };
  } catch (err) {
    ammError = err;
  }

  throw createTradeTypeError(
    'UNSUPPORTED_MARKET_TRADE_INTERFACE',
    'Market does not expose a supported Pandora trade interface.',
    {
      marketAddress,
      attemptedMarkers: ['curveFlattener', 'tradingFee'],
      markerErrors: {
        parimutuel: pariError && pariError.message ? pariError.message : String(pariError),
        amm: ammError && ammError.message ? ammError.message : String(ammError),
      },
    },
  );
}

function toEpochSeconds(value, fallback) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const truncated = Math.trunc(numeric);
    if (truncated >= 0) return truncated;
  }
  return fallback;
}

/**
 * Builds the market-specific buy call shape.
 * @param {{
 *   marketType: 'parimutuel'|'amm',
 *   side: 'yes'|'no',
 *   amountRaw: bigint,
 *   minSharesOutRaw: bigint,
 *   nowEpochSec?: number,
 *   ammDeadlineOffsetSec?: number,
 * }} input
 * @returns {{marketType:'parimutuel'|'amm', abi: object[], functionName: 'buy', args: (boolean|bigint)[], signature: string, ammDeadlineEpoch?: string}}
 */
function buildTradeBuyCall(input) {
  const marketType = String(input.marketType || '').toLowerCase();
  const isYes = String(input.side || '').toLowerCase() === 'yes';
  const amountRaw = input.amountRaw;
  const minSharesOutRaw = input.minSharesOutRaw;

  if (marketType === 'parimutuel') {
    return {
      marketType: 'parimutuel',
      abi: PARI_MUTUEL_BUY_ABI,
      functionName: 'buy',
      args: [isYes, amountRaw, minSharesOutRaw],
      signature: 'buy(bool,uint256,uint256)',
      ammDeadlineEpoch: null,
    };
  }

  if (marketType === 'amm') {
    const nowEpochSec = toEpochSeconds(input.nowEpochSec, Math.trunc(Date.now() / 1000));
    const offsetSec = toEpochSeconds(input.ammDeadlineOffsetSec, DEFAULT_AMM_TRADE_DEADLINE_OFFSET_SEC);
    const deadlineEpoch = BigInt(nowEpochSec + Math.max(1, offsetSec));
    return {
      marketType: 'amm',
      abi: PREDICTION_AMM_BUY_ABI,
      functionName: 'buy',
      args: [isYes, amountRaw, minSharesOutRaw, deadlineEpoch],
      signature: 'buy(bool,uint256,uint256,uint256)',
      ammDeadlineEpoch: deadlineEpoch.toString(),
    };
  }

  throw createTradeTypeError('UNSUPPORTED_MARKET_TYPE', `Unsupported market type for trade execution: ${marketType}`);
}

/**
 * Builds the market-specific sell call shape.
 * @param {{
 *   marketType: 'parimutuel'|'amm',
 *   side: 'yes'|'no',
 *   amountRaw: bigint,
 *   minAmountOutRaw: bigint,
 *   nowEpochSec?: number,
 *   ammDeadlineOffsetSec?: number,
 * }} input
 * @returns {{marketType:'amm', abi: object[], functionName: 'sell', args: (boolean|bigint)[], signature: string, ammDeadlineEpoch?: string}}
 */
function buildTradeSellCall(input) {
  const marketType = String(input.marketType || '').toLowerCase();
  const isYes = String(input.side || '').toLowerCase() === 'yes';
  const amountRaw = input.amountRaw;
  const minAmountOutRaw = input.minAmountOutRaw;

  if (marketType === 'parimutuel') {
    throw createTradeTypeError(
      'UNSUPPORTED_MARKET_TRADE_INTERFACE',
      'Parimutuel markets do not expose a sell() trade interface.',
      { marketType },
    );
  }

  if (marketType === 'amm') {
    const nowEpochSec = toEpochSeconds(input.nowEpochSec, Math.trunc(Date.now() / 1000));
    const offsetSec = toEpochSeconds(input.ammDeadlineOffsetSec, DEFAULT_AMM_TRADE_DEADLINE_OFFSET_SEC);
    const deadlineEpoch = BigInt(nowEpochSec + Math.max(1, offsetSec));
    return {
      marketType: 'amm',
      abi: PREDICTION_AMM_SELL_ABI,
      functionName: 'sell',
      args: [isYes, amountRaw, minAmountOutRaw, deadlineEpoch],
      signature: 'sell(bool,uint112,uint256,uint256)',
      ammDeadlineEpoch: deadlineEpoch.toString(),
    };
  }

  throw createTradeTypeError('UNSUPPORTED_MARKET_TYPE', `Unsupported market type for trade execution: ${marketType}`);
}

/**
 * Resolves market type then constructs the correct buy call descriptor.
 * @param {{
 *   publicClient: { readContract: Function },
 *   marketAddress: `0x${string}`,
 *   side: 'yes'|'no',
 *   amountRaw: bigint,
 *   minSharesOutRaw: bigint,
 *   nowEpochSec?: number,
 *   ammDeadlineOffsetSec?: number,
 * }} input
 * @returns {Promise<{marketType:'parimutuel'|'amm', detectedBy:string, abi: object[], functionName: 'buy', args: (boolean|bigint)[], signature: string, ammDeadlineEpoch?: string}>}
 */
async function resolveTradeBuyCall(input) {
  const detected = await detectTradeMarketType(input.publicClient, input.marketAddress);
  const call = buildTradeBuyCall({
    marketType: detected.marketType,
    side: input.side,
    amountRaw: input.amountRaw,
    minSharesOutRaw: input.minSharesOutRaw,
    nowEpochSec: input.nowEpochSec,
    ammDeadlineOffsetSec: input.ammDeadlineOffsetSec,
  });
  return {
    ...call,
    detectedBy: detected.detectedBy,
  };
}

/**
 * Resolves market type then constructs the correct sell call descriptor.
 * @param {{
 *   publicClient: { readContract: Function },
 *   marketAddress: `0x${string}`,
 *   side: 'yes'|'no',
 *   amountRaw: bigint,
 *   minAmountOutRaw: bigint,
 *   nowEpochSec?: number,
 *   ammDeadlineOffsetSec?: number,
 * }} input
 * @returns {Promise<{marketType:'amm', detectedBy:string, abi: object[], functionName: 'sell', args: (boolean|bigint)[], signature: string, ammDeadlineEpoch?: string}>}
 */
async function resolveTradeSellCall(input) {
  const detected = await detectTradeMarketType(input.publicClient, input.marketAddress);
  const call = buildTradeSellCall({
    marketType: detected.marketType,
    side: input.side,
    amountRaw: input.amountRaw,
    minAmountOutRaw: input.minAmountOutRaw,
    nowEpochSec: input.nowEpochSec,
    ammDeadlineOffsetSec: input.ammDeadlineOffsetSec,
  });
  return {
    ...call,
    detectedBy: detected.detectedBy,
  };
}

module.exports = {
  PARI_MUTUEL_BUY_ABI,
  PREDICTION_AMM_BUY_ABI,
  PREDICTION_AMM_SELL_ABI,
  DEFAULT_AMM_TRADE_DEADLINE_OFFSET_SEC,
  detectTradeMarketType,
  buildTradeBuyCall,
  buildTradeSellCall,
  resolveTradeBuyCall,
  resolveTradeSellCall,
};
