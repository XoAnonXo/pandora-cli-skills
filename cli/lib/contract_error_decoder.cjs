const CONTRACT_ERROR_ABI = [
  {
    type: 'error',
    name: 'TxTooOld',
    inputs: [
      { name: 'blockTimestamp', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'SlippageExceeded',
    inputs: [
      { name: 'expected', type: 'uint256' },
      { name: 'actual', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'InsufficientLiquidity',
    inputs: [],
  },
  {
    type: 'error',
    name: 'PriceSwingExceeded',
    inputs: [
      { name: 'before', type: 'uint64' },
      { name: 'after', type: 'uint64' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidOutcome',
    inputs: [],
  },
];

const REVERT_SELECTOR_HINTS = {
  // Market-specific minimum-notional guard seen on some Pandora AMM deployments.
  '0x7e2d7787': 'Trade too small for this market. Increase --amount-usdc and retry.',
};

function isHexData(value) {
  return /^0x[0-9a-fA-F]*$/.test(String(value || ''));
}

function normalizeErrorArg(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map((item) => normalizeErrorArg(item));
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    const output = {};
    for (const [key, nested] of entries) {
      output[key] = normalizeErrorArg(nested);
    }
    return output;
  }
  return value;
}

function extractRevertData(error, depth = 0) {
  if (!error || depth > 4) return null;
  const directCandidates = [
    error.data,
    error.revertData,
    error.cause && error.cause.data,
    error.cause && error.cause.revertData,
    error.walk && error.walk().data,
    error.walk && error.walk().revertData,
    error.details && error.details.data,
  ];

  for (const candidate of directCandidates) {
    if (isHexData(candidate) && String(candidate).length >= 4) {
      return String(candidate);
    }
  }

  return (
    extractRevertData(error.cause, depth + 1) ||
    extractRevertData(error.details, depth + 1) ||
    null
  );
}

async function decodeContractError(error, deps = {}) {
  const data = extractRevertData(error);
  if (!data || data === '0x') {
    return null;
  }

  let decodeErrorResult;
  try {
    if (deps.viemRuntime && typeof deps.viemRuntime.decodeErrorResult === 'function') {
      decodeErrorResult = deps.viemRuntime.decodeErrorResult;
    } else {
      ({ decodeErrorResult } = await import('viem'));
    }
  } catch {
    return { data };
  }

  try {
    const decoded = decodeErrorResult({
      abi: CONTRACT_ERROR_ABI,
      data,
    });
    const args = normalizeErrorArg(decoded.args);
    return {
      data,
      errorName: decoded.errorName,
      args,
    };
  } catch {
    return { data };
  }
}

function formatDecodedContractError(decoded) {
  if (!decoded) return null;
  if (decoded.errorName === 'TxTooOld' && decoded.args) {
    return `TxTooOld: blockTimestamp=${decoded.args.blockTimestamp}, deadline=${decoded.args.deadline}`;
  }
  if (decoded.errorName === 'SlippageExceeded' && decoded.args) {
    return `SlippageExceeded: expected=${decoded.args.expected}, actual=${decoded.args.actual}`;
  }
  if (decoded.errorName === 'PriceSwingExceeded' && decoded.args) {
    return `PriceSwingExceeded: before=${decoded.args.before}, after=${decoded.args.after}`;
  }
  if (decoded.errorName) {
    return decoded.errorName;
  }
  if (decoded.data) {
    const selector = String(decoded.data).slice(0, 10).toLowerCase();
    if (REVERT_SELECTOR_HINTS[selector]) {
      return `${REVERT_SELECTOR_HINTS[selector]} (selector ${selector})`;
    }
    return `Contract reverted (${decoded.data})`;
  }
  return null;
}

module.exports = {
  CONTRACT_ERROR_ABI,
  decodeContractError,
  formatDecodedContractError,
};
