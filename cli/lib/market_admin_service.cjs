const { DEFAULT_INDEXER_URL, DEFAULT_RPC_BY_CHAIN_ID } = require('./shared/constants.cjs');
const { isSecureHttpUrlOrLocal, round } = require('./shared/utils.cjs');
const { resolveForkRuntime } = require('./fork_runtime_service.cjs');
const { createIndexerClient } = require('./indexer_client.cjs');
const { materializeExecutionSigner } = require('./signers/execution_signer_service.cjs');

const READ_BATCH_CONCURRENCY = 4;
const INDEXER_MARKET_FIELDS = ['id', 'pollAddress', 'chainId'];

const ERC20_ABI = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
];

const LP_TOKEN_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
];

const PREDICTION_AMM_ABI = [
  {
    type: 'function',
    name: 'addLiquidity',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'collateralAmount', type: 'uint256' },
      { name: 'minOutcomeShares', type: 'uint256[2]' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'removeLiquidity',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'sharesToBurn', type: 'uint256' },
      { name: 'minCollateralOut', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
];

const OUTCOME_TOKEN_REF_ABI_CANDIDATES = [
  [
    { type: 'function', name: 'yesToken', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { type: 'function', name: 'noToken', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  ],
  [
    { type: 'function', name: 'yesTokenAddress', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { type: 'function', name: 'noTokenAddress', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  ],
];

const CALC_REMOVE_LIQUIDITY_ABI_CANDIDATES = [
  [
    {
      type: 'function',
      name: 'calcRemoveLiquidity',
      stateMutability: 'view',
      inputs: [{ name: 'sharesToBurn', type: 'uint256' }],
      outputs: [
        { name: 'collateralOut', type: 'uint256' },
        { name: 'yesOut', type: 'uint256' },
        { name: 'noOut', type: 'uint256' },
      ],
    },
  ],
  [
    {
      type: 'function',
      name: 'calcRemoveLiquidity',
      stateMutability: 'view',
      inputs: [{ name: 'sharesToBurn', type: 'uint256' }],
      outputs: [
        { name: 'collateralOut', type: 'uint256' },
        { name: 'yesOut', type: 'uint256' },
      ],
    },
  ],
  [
    {
      type: 'function',
      name: 'calcRemoveLiquidity',
      stateMutability: 'view',
      inputs: [{ name: 'sharesToBurn', type: 'uint256' }],
      outputs: [{ name: 'collateralOut', type: 'uint256' }],
    },
  ],
];

const RESOLVE_METHOD_CANDIDATES = [
  {
    functionName: 'resolveMarket',
    abiSignature: 'resolveMarket(bool)',
    role: 'legacy',
    supportsInvalid: false,
    abi: [
      {
        type: 'function',
        name: 'resolveMarket',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'outcome', type: 'bool' }],
        outputs: [],
      },
    ],
    buildArgs(answer) {
      return [answer === 'yes'];
    },
  },
  {
    functionName: 'setAnswer',
    abiSignature: 'setAnswer(uint8,string)',
    role: 'operator',
    supportsInvalid: true,
    abi: [
      {
        type: 'function',
        name: 'setAnswer',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'answer', type: 'uint8' }, { name: 'reason', type: 'string' }],
        outputs: [],
      },
    ],
    buildArgs(answer, reason) {
      return [normalizeResolveAnswerCode(answer), String(reason || '')];
    },
  },
  {
    functionName: 'resolveArbitration',
    abiSignature: 'resolveArbitration(uint8,string)',
    role: 'arbiter',
    supportsInvalid: true,
    abi: [
      {
        type: 'function',
        name: 'resolveArbitration',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'answer', type: 'uint8' }, { name: 'reason', type: 'string' }],
        outputs: [],
      },
    ],
    buildArgs(answer, reason) {
      return [normalizeResolveAnswerCode(answer), String(reason || '')];
    },
  },
];

const CLAIM_MARKET_ABI_CANDIDATES = [
  [
    {
      type: 'function',
      name: 'redeemWinnings',
      stateMutability: 'nonpayable',
      inputs: [],
      outputs: [{ type: 'uint256' }],
    },
  ],
  [
    {
      type: 'function',
      name: 'redeemWinnings',
      stateMutability: 'nonpayable',
      inputs: [],
      outputs: [],
    },
  ],
];

const POLL_STATUS_READ_CANDIDATES = [
  { fn: 'getStatus', abi: [{ type: 'function', name: 'getStatus', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] },
  { fn: 'status', abi: [{ type: 'function', name: 'status', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] },
  { fn: 'marketState', abi: [{ type: 'function', name: 'marketState', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] },
];

const POLL_FINALIZED_READ_CANDIDATES = [
  {
    fn: 'getFinalizedStatus',
    kind: 'status-answer-epoch',
    abi: [
      {
        type: 'function',
        name: 'getFinalizedStatus',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint8' }, { type: 'uint8' }, { type: 'uint32' }],
      },
    ],
  },
  {
    fn: 'getFinalizedStatus',
    kind: 'bool-answer-epoch',
    abi: [
      {
        type: 'function',
        name: 'getFinalizedStatus',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'bool' }, { type: 'uint8' }, { type: 'uint32' }],
      },
    ],
  },
  {
    fn: 'getFinalizedStatus',
    kind: 'bool-status',
    abi: [
      {
        type: 'function',
        name: 'getFinalizedStatus',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'bool' }, { type: 'uint256' }],
      },
    ],
  },
  { fn: 'getFinalizedStatus', abi: [{ type: 'function', name: 'getFinalizedStatus', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] }] },
  { fn: 'isFinalized', abi: [{ type: 'function', name: 'isFinalized', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] }] },
  { fn: 'finalized', abi: [{ type: 'function', name: 'finalized', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] }] },
];

const POLL_ANSWER_READ_CANDIDATES = [
  { fn: 'answer', abi: [{ type: 'function', name: 'answer', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] },
  { fn: 'getAnswer', abi: [{ type: 'function', name: 'getAnswer', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] },
  { fn: 'outcome', abi: [{ type: 'function', name: 'outcome', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] },
];

const POLL_FINALIZATION_EPOCH_READ_CANDIDATES = [
  {
    fn: 'getFinalizationEpoch',
    abi: [{ type: 'function', name: 'getFinalizationEpoch', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
  },
  {
    fn: 'finalizationEpoch',
    abi: [{ type: 'function', name: 'finalizationEpoch', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
  },
  {
    fn: 'deadlineEpoch',
    abi: [{ type: 'function', name: 'deadlineEpoch', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
  },
];

const POLL_CURRENT_EPOCH_READ_CANDIDATES = [
  {
    fn: 'getCurrentEpoch',
    abi: [{ type: 'function', name: 'getCurrentEpoch', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
  },
  {
    fn: 'currentEpoch',
    abi: [{ type: 'function', name: 'currentEpoch', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
  },
];

const POLL_EPOCH_LENGTH_READ_CANDIDATES = [
  {
    fn: 'getEpochLength',
    abi: [{ type: 'function', name: 'getEpochLength', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
  },
  {
    fn: 'epochLength',
    abi: [{ type: 'function', name: 'epochLength', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
  },
];

const POLL_OPERATOR_READ_CANDIDATES = [
  { fn: 'getArbiter', abi: [{ type: 'function', name: 'getArbiter', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] },
  { fn: 'arbiter', abi: [{ type: 'function', name: 'arbiter', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] },
  { fn: 'operator', abi: [{ type: 'function', name: 'operator', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] },
  { fn: 'owner', abi: [{ type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] },
];

const POLL_CALLER_OPERATOR_CHECK_CANDIDATES = [
  {
    fn: 'isOperator',
    abi: [{ type: 'function', name: 'isOperator', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] }],
  },
];

function createServiceError(code, message, details = undefined) {
  const err = new Error(message);
  err.code = code;
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function buildChain(chainId, rpcUrl) {
  if (chainId === 1) {
    return {
      id: 1,
      name: 'Ethereum',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
      blockExplorers: { default: { name: 'Etherscan', url: 'https://etherscan.io' } },
    };
  }

  throw createServiceError('INVALID_FLAG_VALUE', `Unsupported chain id ${chainId}. Supported values: 1.`);
}

function normalizeAddress(value, label) {
  const raw = String(value || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(raw)) {
    throw createServiceError('INVALID_FLAG_VALUE', `${label} must be a valid address.`);
  }
  return raw.toLowerCase();
}

function normalizePrivateKey(value, label = 'private key') {
  const raw = String(value || '').trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(raw)) {
    throw createServiceError('INVALID_FLAG_VALUE', `Invalid ${label}. Expected 0x + 64 hex chars.`);
  }
  return raw;
}

function normalizeTimeoutMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 12_000;
  return Math.trunc(numeric);
}

/**
 * Convert numeric-like input into a finite number.
 * Used by LP/resolve input normalization paths.
 * @param {*} value
 * @returns {number|null}
 */
function toFiniteNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function txExplorerUrl(chainId, txHash) {
  if (!txHash) return null;
  if (chainId === 1) return `https://etherscan.io/tx/${txHash}`;
  return null;
}

async function loadViemRuntime() {
  const viem = await import('viem');
  const accounts = await import('viem/accounts');
  return { ...viem, ...accounts };
}

async function resolveRuntime(options = {}, runtimeOptions = {}) {
  const forkRuntime = resolveForkRuntime(options, {
    env: process.env,
    isSecureHttpUrlOrLocal,
    defaultChainId: 1,
  });
  const preferredChainId =
    forkRuntime.mode === 'fork'
      ? forkRuntime.chainId
      : options.chainId !== null && options.chainId !== undefined
        ? options.chainId
        : forkRuntime.chainId;
  const chainId = Number(preferredChainId !== null && preferredChainId !== undefined ? preferredChainId : process.env.CHAIN_ID || 1);
  if (!Number.isInteger(chainId)) {
    throw createServiceError('INVALID_FLAG_VALUE', 'CHAIN_ID must be an integer.');
  }

  const rpcUrl = String(
    forkRuntime.mode === 'fork'
      ? forkRuntime.rpcUrl
      : options.rpcUrl || process.env.RPC_URL || DEFAULT_RPC_BY_CHAIN_ID[chainId] || '',
  ).trim();
  if (!isSecureHttpUrlOrLocal(rpcUrl)) {
    throw createServiceError('INVALID_FLAG_VALUE', `RPC URL must be a valid http/https URL. Received: "${rpcUrl}"`);
  }

  const chain = buildChain(chainId, rpcUrl);
  const runtime = {
    mode: forkRuntime.mode,
    chainId,
    rpcUrl,
    chain,
    privateKey: null,
    profileId: options.profileId || null,
    profileFile: options.profileFile || null,
    profile: options.profile || null,
    usdc: null,
  };

  if (runtimeOptions.requirePrivateKey) {
    runtime.privateKey = normalizePrivateKey(
      options.privateKey || process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY,
      'private key',
    );
  } else if (options.privateKey || process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY) {
    runtime.privateKey = normalizePrivateKey(
      options.privateKey || process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY,
      'private key',
    );
  }

  if (runtimeOptions.requireUsdc) {
    runtime.usdc = normalizeAddress(options.usdc || process.env.USDC, 'USDC');
  } else if (options.usdc || process.env.USDC) {
    runtime.usdc = normalizeAddress(options.usdc || process.env.USDC, 'USDC');
  }

  return runtime;
}

async function createClients(runtime, requireWallet = false, executionContext = {}) {
  const viemRuntime = await loadViemRuntime();
  const { createPublicClient, http } = viemRuntime;
  const publicClient = createPublicClient({ chain: runtime.chain, transport: http(runtime.rpcUrl) });
  let account = null;
  let walletClient = null;
  let signerMetadata = null;
  let resolvedProfile = null;

  try {
    const materialized = await materializeExecutionSigner({
      privateKey: runtime.privateKey,
      profileId: runtime.profileId,
      profileFile: runtime.profileFile,
      profile: runtime.profile,
      chain: runtime.chain,
      chainId: runtime.chainId,
      rpcUrl: runtime.rpcUrl,
      viemRuntime,
      env: process.env,
      requireSigner: requireWallet,
      mode: requireWallet ? 'execute' : 'read',
      liveRequested: requireWallet,
      mutating: requireWallet,
      command: executionContext.command || null,
      toolFamily: executionContext.toolFamily || null,
      category: executionContext.category || null,
      metadata: {
        source: 'market-admin',
        action: executionContext.command || null,
      },
    });
    if (materialized) {
      account = materialized.account || null;
      walletClient = materialized.walletClient || null;
      signerMetadata = materialized.signerMetadata || null;
      resolvedProfile = materialized.resolvedProfile || null;
    }
  } catch (error) {
    if (error && error.code === 'PROFILE_SIGNER_REQUIRED') {
      throw createServiceError(
        'MISSING_REQUIRED_FLAG',
        'Missing signer credentials. Set PRIVATE_KEY/DEPLOYER_PRIVATE_KEY or pass --profile-id/--profile-file.',
      );
    }
    if (error && error.code) {
      throw createServiceError(error.code, error.message || 'Unable to materialize execution signer.', error.details);
    }
    throw error;
  }

  if (requireWallet && (!account || !walletClient)) {
    throw createServiceError(
      'MISSING_REQUIRED_FLAG',
      'Missing signer credentials. Set PRIVATE_KEY/DEPLOYER_PRIVATE_KEY or pass --profile-id/--profile-file.',
    );
  }

  return { publicClient, walletClient, account, signerMetadata, resolvedProfile };
}

function hasBytecode(code) {
  const normalized = String(code || '').trim().toLowerCase();
  return normalized !== '0x' && normalized !== '0x0' && normalized.length > 2;
}

async function ensureContractCode(publicClient, address, label) {
  const code = await publicClient.getBytecode({ address });
  if (!hasBytecode(code)) {
    throw createServiceError('MARKET_ADDRESS_NO_CODE', `${label} has no bytecode: ${address}`, {
      address,
      label,
    });
  }
}

async function decodeAndWrapError(err, fallbackCode, fallbackMessage) {
  const { decodeContractError, formatDecodedContractError } = require('./contract_error_decoder.cjs');
  const decoded = await decodeContractError(err);
  const decodedMessage = formatDecodedContractError(decoded);
  const message = decodedMessage || (err && err.message ? err.message : fallbackMessage);
  return createServiceError(fallbackCode, message, {
    decoded,
    cause: err && err.message ? err.message : String(err),
  });
}

async function tryReadContractAny(publicClient, address, candidates = [], args = []) {
  for (const candidate of candidates) {
    try {
      const value = await publicClient.readContract({
        address,
        abi: candidate.abi,
        functionName: candidate.fn,
        args,
      });
      return { ok: true, fn: candidate.fn, value, candidate };
    } catch {
      // continue
    }
  }
  return { ok: false, fn: null, value: null, candidate: null };
}

function normalizeOptionalBigInt(value) {
  try {
    if (typeof value === 'bigint') return value;
    if (value === null || value === undefined) return null;
    const str = String(value).trim();
    if (!str) return null;
    return BigInt(str);
  } catch {
    return null;
  }
}

function normalizeOptionalAddress(value) {
  const raw = String(value || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(raw)) return null;
  return raw.toLowerCase();
}

function normalizePollAnswer(value) {
  const asBig = normalizeOptionalBigInt(value);
  if (asBig === null) return null;
  if (asBig === 1n) return 'yes';
  if (asBig === 0n) return 'no';
  if (asBig === 2n) return 'invalid';
  return String(asBig);
}

function normalizePollAnswerFromStatusWord(value) {
  const normalized = normalizePollAnswer(value);
  if (normalized === 'yes' || normalized === 'no' || normalized === 'invalid') {
    return normalized;
  }
  const asBig = normalizeOptionalBigInt(value);
  if (asBig === 3n) return 'yes';
  if (asBig === 4n) return 'no';
  if (asBig === 5n) return 'invalid';
  return normalized;
}

function normalizeResolveAnswerCode(answer) {
  if (answer === 'yes') return 1;
  if (answer === 'no') return 0;
  if (answer === 'invalid') return 2;
  throw createServiceError('INVALID_FLAG_VALUE', '--answer must be yes|no|invalid.');
}

function deriveOutcomePositionSide(yesRaw, noRaw) {
  const hasYes = typeof yesRaw === 'bigint' && yesRaw > 0n;
  const hasNo = typeof noRaw === 'bigint' && noRaw > 0n;
  if (hasYes && hasNo) return 'both';
  if (hasYes) return 'yes';
  if (hasNo) return 'no';
  return 'flat';
}

function buildOutcomeTokenVisibility(params) {
  const {
    refs,
    yesRaw,
    noRaw,
    yesDecimals,
    noDecimals,
    resolution,
    formatUnits,
  } = params;

  const normalizedYesRaw = typeof yesRaw === 'bigint' ? yesRaw : 0n;
  const normalizedNoRaw = typeof noRaw === 'bigint' ? noRaw : 0n;
  const yesBalance = formatUnits(normalizedYesRaw, yesDecimals);
  const noBalance = formatUnits(normalizedNoRaw, noDecimals);
  const positionSide = deriveOutcomePositionSide(normalizedYesRaw, normalizedNoRaw);
  const claimableOutcome =
    resolution && resolution.claimable && (resolution.pollAnswer === 'yes' || resolution.pollAnswer === 'no')
      ? resolution.pollAnswer
      : null;
  const claimableRaw =
    claimableOutcome === 'yes'
      ? normalizedYesRaw
      : claimableOutcome === 'no'
        ? normalizedNoRaw
        : null;
  const claimableAmount = claimableRaw === null
    ? null
    : claimableOutcome === 'yes'
      ? yesBalance
      : noBalance;

  return {
    source: refs.source,
    yesToken: refs.yesToken,
    noToken: refs.noToken,
    yesBalanceRaw: normalizedYesRaw.toString(),
    noBalanceRaw: normalizedNoRaw.toString(),
    yesBalance,
    noBalance,
    claimableUsdc: claimableAmount,
    marketResolved: resolution ? resolution.pollFinalized : null,
    finalizesInEpochs: resolution ? resolution.epochsUntilFinalization : null,
    hasInventory: positionSide !== 'flat',
    positionSide,
    claimable: resolution ? Boolean(resolution.claimable) : null,
    claimableOutcome,
    claimableAmountRaw: claimableRaw === null ? null : claimableRaw.toString(),
    claimableAmount,
    hasClaimableInventory: claimableRaw === null ? (resolution ? false : null) : claimableRaw > 0n,
    resolution: resolution
      ? {
          ...(resolution.pollAddress ? { pollAddress: resolution.pollAddress } : {}),
          marketState: resolution.marketState,
          pollFinalized: resolution.pollFinalized,
          pollAnswer: resolution.pollAnswer,
          finalizationEpoch: resolution.finalizationEpoch,
          currentEpoch: resolution.currentEpoch,
          epochsUntilFinalization: resolution.epochsUntilFinalization,
          claimable: resolution.claimable,
          operator: resolution.operator,
          readSources: resolution.readSources,
        }
      : null,
    yes: {
      token: refs.yesToken,
      decimals: yesDecimals,
      balanceRaw: normalizedYesRaw.toString(),
      balance: yesBalance,
    },
    no: {
      token: refs.noToken,
      decimals: noDecimals,
      balanceRaw: normalizedNoRaw.toString(),
      balance: noBalance,
    },
  };
}

function deriveCurrentEpochFromTimestamp(timestamp, epochLengthSeconds = 300n) {
  const ts = normalizeOptionalBigInt(timestamp);
  if (ts === null) return null;
  const epochLength = normalizeOptionalBigInt(epochLengthSeconds);
  if (epochLength === null || epochLength <= 0n) return null;
  return ts / epochLength;
}

async function readPollResolutionState(publicClient, pollAddress, options = {}) {
  const statusRead = await tryReadContractAny(publicClient, pollAddress, POLL_STATUS_READ_CANDIDATES);
  const finalizedRead = await tryReadContractAny(publicClient, pollAddress, POLL_FINALIZED_READ_CANDIDATES);
  const answerRead = await tryReadContractAny(publicClient, pollAddress, POLL_ANSWER_READ_CANDIDATES);
  const finalizationEpochRead = await tryReadContractAny(
    publicClient,
    pollAddress,
    POLL_FINALIZATION_EPOCH_READ_CANDIDATES,
  );
  const operatorRead = await tryReadContractAny(publicClient, pollAddress, POLL_OPERATOR_READ_CANDIDATES);
  const currentEpochRead = await tryReadContractAny(publicClient, pollAddress, POLL_CURRENT_EPOCH_READ_CANDIDATES);
  const epochLengthRead = await tryReadContractAny(publicClient, pollAddress, POLL_EPOCH_LENGTH_READ_CANDIDATES);
  const callerAddress = normalizeOptionalAddress(options.callerAddress);
  const callerOperatorRead = callerAddress
    ? await tryReadContractAny(publicClient, pollAddress, POLL_CALLER_OPERATOR_CHECK_CANDIDATES, [callerAddress])
    : { ok: false, fn: null, value: null, candidate: null };

  let currentEpoch = currentEpochRead.ok ? normalizeOptionalBigInt(currentEpochRead.value) : null;
  if (currentEpoch === null) {
    try {
      const block = await publicClient.getBlock({ blockTag: 'latest' });
      const epochLength = epochLengthRead.ok ? normalizeOptionalBigInt(epochLengthRead.value) : 300n;
      currentEpoch = deriveCurrentEpochFromTimestamp(block && block.timestamp, epochLength === null ? 300n : epochLength);
    } catch {
      currentEpoch = null;
    }
  }

  const statusNumeric = statusRead.ok ? Number(statusRead.value) : null;
  let finalizedBool = null;
  let finalizedAnswer = null;
  let finalizedEpoch = null;
  if (finalizedRead.ok) {
    const kind = finalizedRead.candidate && finalizedRead.candidate.kind ? finalizedRead.candidate.kind : null;
    if (kind === 'status-answer-epoch' || kind === 'bool-answer-epoch') {
      const tuple = Array.isArray(finalizedRead.value) ? finalizedRead.value : null;
      if (tuple && tuple.length >= 3) {
        if (kind === 'status-answer-epoch') {
          const statusRaw = normalizeOptionalBigInt(tuple[0]);
          finalizedBool = statusRaw === null ? null : statusRaw >= 2n;
        } else {
          finalizedBool = Boolean(tuple[0]);
        }
        finalizedAnswer = normalizePollAnswer(tuple[1]);
        finalizedEpoch = normalizeOptionalBigInt(tuple[2]);
      }
    } else if (kind === 'bool-status') {
      const tuple = Array.isArray(finalizedRead.value) ? finalizedRead.value : null;
      if (tuple && tuple.length >= 2) {
        finalizedBool = Boolean(tuple[0]);
        finalizedAnswer = normalizePollAnswerFromStatusWord(tuple[1]);
      }
    } else {
      finalizedBool = Boolean(finalizedRead.value);
    }
  }
  const answer = answerRead.ok ? normalizePollAnswer(answerRead.value) : finalizedAnswer;
  const finalizationEpoch = finalizationEpochRead.ok ? normalizeOptionalBigInt(finalizationEpochRead.value) : finalizedEpoch;
  const epochsUntilFinalization =
    (finalizationEpoch === null || currentEpoch === null)
      ? null
      : finalizationEpoch > currentEpoch
        ? Number(finalizationEpoch - currentEpoch)
        : 0;
  const claimable =
    answer !== null &&
    ((finalizedBool === true) || (epochsUntilFinalization !== null && epochsUntilFinalization <= 0));

  return {
    pollAddress,
    marketState: Number.isFinite(statusNumeric) ? statusNumeric : null,
    pollFinalized: finalizedBool,
    pollAnswer: answer,
    finalizationEpoch: finalizationEpoch === null ? null : finalizationEpoch.toString(),
    currentEpoch: currentEpoch === null ? null : currentEpoch.toString(),
    epochsUntilFinalization,
    claimable,
    operator: operatorRead.ok ? normalizeOptionalAddress(operatorRead.value) : null,
    callerIsOperator: callerOperatorRead.ok ? Boolean(callerOperatorRead.value) : null,
    callerAddress,
    readSources: {
      status: statusRead.fn,
      finalized: finalizedRead.fn,
      finalizedKind: finalizedRead.candidate && finalizedRead.candidate.kind ? finalizedRead.candidate.kind : null,
      answer: answerRead.fn,
      finalizationEpoch: finalizationEpochRead.fn,
      currentEpoch: currentEpochRead.fn,
      epochLength: epochLengthRead.fn,
      operator: operatorRead.fn,
      callerIsOperator: callerOperatorRead.fn,
    },
  };
}

function listSupportedResolveMethods(answer) {
  return RESOLVE_METHOD_CANDIDATES
    .filter((candidate) => candidate.supportsInvalid || answer !== 'invalid')
    .map((candidate) => ({
      functionName: candidate.functionName,
      abiSignature: candidate.abiSignature,
      role: candidate.role,
      supportsInvalid: candidate.supportsInvalid,
    }));
}

function buildResolveMethodSelection(precheck, caller, answer) {
  const supportedMethods = listSupportedResolveMethods(answer);
  const finalizedKind = precheck && precheck.readSources ? precheck.readSources.finalizedKind : null;
  const operatorSource = precheck && precheck.readSources ? precheck.readSources.operator : null;
  const callerIsArbiter = Boolean(precheck && precheck.operator && caller && precheck.operator === caller);
  const callerIsOperator = Boolean(precheck && precheck.callerIsOperator === true);
  const modernPollFamily = operatorSource === 'getArbiter' || finalizedKind === 'bool-status' || callerIsOperator;

  if (callerIsArbiter) {
    return {
      candidate: RESOLVE_METHOD_CANDIDATES.find((item) => item.functionName === 'resolveArbitration') || null,
      selection: 'arbiter',
      supportedMethods,
      callerIsArbiter,
      callerIsOperator,
      modernPollFamily,
    };
  }

  if (callerIsOperator) {
    return {
      candidate: RESOLVE_METHOD_CANDIDATES.find((item) => item.functionName === 'setAnswer') || null,
      selection: 'operator',
      supportedMethods,
      callerIsArbiter,
      callerIsOperator,
      modernPollFamily,
    };
  }

  if (modernPollFamily) {
    return {
      candidate: null,
      selection: caller ? 'unsupported-caller-role' : 'role-required',
      supportedMethods,
      callerIsArbiter,
      callerIsOperator,
      modernPollFamily,
    };
  }

  const legacyCandidate = RESOLVE_METHOD_CANDIDATES.find((item) => item.functionName === 'resolveMarket') || null;
  if (!legacyCandidate || (answer === 'invalid' && !legacyCandidate.supportsInvalid)) {
    return {
      candidate: null,
      selection: 'unsupported-answer',
      supportedMethods,
      callerIsArbiter,
      callerIsOperator,
      modernPollFamily,
    };
  }
  return {
    candidate: legacyCandidate,
    selection: 'legacy-default',
    supportedMethods,
    callerIsArbiter,
    callerIsOperator,
    modernPollFamily,
  };
}

async function readDecimals(publicClient, address, fallback = 18) {
  try {
    const value = await publicClient.readContract({
      address,
      abi: LP_TOKEN_ABI,
      functionName: 'decimals',
      args: [],
    });
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 36) return fallback;
    return numeric;
  } catch {
    return fallback;
  }
}

async function readOutcomeTokenRefs(publicClient, marketAddress) {
  for (const abi of OUTCOME_TOKEN_REF_ABI_CANDIDATES) {
    try {
      const yesFn = abi[0].name;
      const noFn = abi[1].name;
      const [yesToken, noToken] = await Promise.all([
        publicClient.readContract({ address: marketAddress, abi, functionName: yesFn, args: [] }),
        publicClient.readContract({ address: marketAddress, abi, functionName: noFn, args: [] }),
      ]);
      const yes = normalizeOptionalAddress(yesToken);
      const no = normalizeOptionalAddress(noToken);
      if (yes && no) {
        return { yesToken: yes, noToken: no, source: `${yesFn}/${noFn}` };
      }
    } catch {
      // try next pair
    }
  }
  return null;
}

/**
 * Read optional `calcRemoveLiquidity` preview outputs.
 * Returned values are raw on-chain integers as decimal strings.
 * @param {object} publicClient
 * @param {string} marketAddress
 * @param {bigint} sharesRaw
 * @returns {Promise<{collateralOutRaw: string|null, yesOutRaw: string|null, noOutRaw: string|null}|null>}
 */
async function readCalcRemoveLiquidity(publicClient, marketAddress, sharesRaw) {
  for (const abi of CALC_REMOVE_LIQUIDITY_ABI_CANDIDATES) {
    try {
      const value = await publicClient.readContract({
        address: marketAddress,
        abi,
        functionName: 'calcRemoveLiquidity',
        args: [sharesRaw],
      });
      const normalized = Array.isArray(value) ? value : [value];
      return {
        collateralOutRaw: normalized[0] ? normalized[0].toString() : null,
        yesOutRaw: normalized[1] ? normalized[1].toString() : null,
        noOutRaw: normalized[2] ? normalized[2].toString() : null,
      };
    } catch {
      // try next ABI candidate
    }
  }
  return null;
}

function toDecimalNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildRemoveLiquidityPreviewPayload(formatUnits, preview) {
  if (!preview) return null;
  const collateralOutUsdc =
    preview.collateralOutRaw !== null ? formatUnits(BigInt(preview.collateralOutRaw), 6) : null;
  const yesOut = preview.yesOutRaw !== null ? formatUnits(BigInt(preview.yesOutRaw), 18) : null;
  const noOut = preview.noOutRaw !== null ? formatUnits(BigInt(preview.noOutRaw), 18) : null;
  const collateralOutNumber = toDecimalNumber(collateralOutUsdc);
  const yesOutNumber = toDecimalNumber(yesOut);
  const noOutNumber = toDecimalNumber(noOut);
  const yesScenarioValueUsdc =
    collateralOutNumber === null || yesOutNumber === null ? null : round(collateralOutNumber + yesOutNumber, 6);
  const noScenarioValueUsdc =
    collateralOutNumber === null || noOutNumber === null ? null : round(collateralOutNumber + noOutNumber, 6);

  return {
    collateralOutRaw: preview.collateralOutRaw,
    collateralOutUsdc,
    yesOutRaw: preview.yesOutRaw,
    yesOut,
    noOutRaw: preview.noOutRaw,
    noOut,
    scenarioValues: {
      yesUsdc: yesScenarioValueUsdc,
      noUsdc: noScenarioValueUsdc,
      minUsdc:
        yesScenarioValueUsdc === null || noScenarioValueUsdc === null
          ? null
          : round(Math.min(yesScenarioValueUsdc, noScenarioValueUsdc), 6),
      maxUsdc:
        yesScenarioValueUsdc === null || noScenarioValueUsdc === null
          ? null
          : round(Math.max(yesScenarioValueUsdc, noScenarioValueUsdc), 6),
    },
  };
}

async function graphqlRequest(indexerUrl, query, variables, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(indexerUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw createServiceError('INDEXER_HTTP_ERROR', `Indexer returned HTTP ${response.status}.`);
    }
    const payload = await response.json();
    if (Array.isArray(payload.errors) && payload.errors.length) {
      throw createServiceError('INDEXER_QUERY_FAILED', payload.errors[0].message || 'Indexer query failed.');
    }
    return payload.data || {};
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchIndexerMarket(indexerUrl, marketAddress, timeoutMs) {
  const query = `
    query($id: String!) {
      markets(id: $id) {
        id
        pollAddress
        chainId
      }
    }
  `;
  const data = await graphqlRequest(indexerUrl, query, { id: marketAddress }, timeoutMs);
  return data.markets || null;
}

async function fetchIndexerMarketsMap(indexerUrl, marketAddresses, timeoutMs) {
  const ids = Array.from(
    new Set(
      (marketAddresses || [])
        .map((value) => String(value || '').trim().toLowerCase())
        .filter((value) => /^0x[a-f0-9]{40}$/.test(value)),
    ),
  );
  if (!ids.length) return new Map();

  try {
    const client = createIndexerClient(indexerUrl, timeoutMs);
    const items = await client.getManyByIds({
      queryName: 'markets',
      fields: INDEXER_MARKET_FIELDS,
      ids,
    });
    const map = new Map();
    for (const id of ids) {
      const item = items.get(id) || null;
      map.set(id, item);
      if (item && item.id) {
        map.set(String(item.id).trim().toLowerCase(), item);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

async function mapWithConcurrency(values, concurrency, iteratee) {
  const items = Array.isArray(values) ? values : [];
  const limit = Math.max(1, Math.min(items.length || 1, Number(concurrency) || 1));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await iteratee(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

async function discoverLiquidityMarkets(indexerUrl, wallet, chainId, timeoutMs) {
  const query = `
    query($where: liquidityEventsFilter, $limit: Int) {
      liquidityEventss(where: $where, orderBy: "timestamp", orderDirection: "desc", limit: $limit) {
        items {
          marketAddress
        }
      }
    }
  `;
  const where = { provider: wallet };
  if (Number.isInteger(chainId)) {
    where.chainId = chainId;
  }
  const data = await graphqlRequest(indexerUrl, query, { where, limit: 500 }, timeoutMs);
  const page = data.liquidityEventss;
  const items = page && Array.isArray(page.items) ? page.items : [];
  const addresses = items
    .map((item) => String(item && item.marketAddress ? item.marketAddress : '').toLowerCase())
    .filter((value) => /^0x[a-f0-9]{40}$/.test(value));
  return Array.from(new Set(addresses));
}

async function discoverMarketUserMarkets(indexerUrl, wallet, chainId, timeoutMs) {
  const query = `
    query($where: marketUsersFilter, $limit: Int) {
      marketUserss(where: $where, orderBy: "lastTradeAt", orderDirection: "desc", limit: $limit) {
        items {
          marketAddress
        }
      }
    }
  `;
  const where = { user: wallet };
  if (Number.isInteger(chainId)) {
    where.chainId = chainId;
  }
  const data = await graphqlRequest(indexerUrl, query, { where, limit: 500 }, timeoutMs);
  const page = data.marketUserss;
  const items = page && Array.isArray(page.items) ? page.items : [];
  const addresses = items
    .map((item) => String(item && item.marketAddress ? item.marketAddress : '').toLowerCase())
    .filter((value) => /^0x[a-f0-9]{40}$/.test(value));
  return Array.from(new Set(addresses));
}

/**
 * Resolve a market outcome using the poll ABI family supported by the target contract.
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function runResolve(options = {}) {
  const schemaVersion = '1.0.0';
  const generatedAt = new Date().toISOString();
  let runtimePreview;
  try {
    const forkRuntime = resolveForkRuntime(options, {
      env: process.env,
      isSecureHttpUrlOrLocal,
      defaultChainId: 1,
    });
    runtimePreview = {
      mode: forkRuntime.mode,
      chainId: forkRuntime.chainId,
      rpcUrl: forkRuntime.mode === 'fork' ? forkRuntime.rpcUrl : options.rpcUrl || null,
    };
  } catch (err) {
    if (err && err.code) {
      throw err;
    }
    throw createServiceError('INVALID_FLAG_VALUE', err && err.message ? err.message : 'Invalid fork runtime.');
  }

  const payload = {
    schemaVersion,
    generatedAt,
    mode: options.execute ? 'execute' : 'dry-run',
    runtime: runtimePreview,
    status: options.execute ? 'submitted' : 'planned',
    pollAddress: options.pollAddress,
    answer: options.answer,
    reason: options.reason,
    txPlan: {
      functionName: null,
      args: null,
      abiSignature: null,
      supportedMethods: listSupportedResolveMethods(options.answer),
      selection: 'precheck-unavailable',
      notes: [
        'Resolution method depends on the poll ABI family and caller role.',
        `Reason is recorded off-chain in CLI payload: ${options.reason}`,
      ],
    },
    tx: null,
    diagnostics: [],
  };

  const runtime = options.resolvedRuntime || await resolveRuntime(options, { requirePrivateKey: options.execute, requireUsdc: false });
  payload.runtime = {
    mode: runtime.mode,
    chainId: runtime.chainId,
    rpcUrl: runtime.rpcUrl,
  };
  const { publicClient, walletClient, account } = options.sharedClients || await createClients(runtime, options.execute, {
    command: 'resolve',
    toolFamily: 'resolve',
    category: options.category || null,
  });
  const pollAddress = normalizeAddress(options.pollAddress, 'pollAddress');
  const caller = normalizeOptionalAddress(account && account.address ? account.address : null);
  if (!options.execute) {
    try {
      await ensureContractCode(publicClient, pollAddress, 'Poll contract');
      const precheck = await readPollResolutionState(publicClient, pollAddress, { callerAddress: caller });
      const selection = buildResolveMethodSelection(precheck, caller, options.answer);
      if (selection.candidate) {
        payload.txPlan.functionName = selection.candidate.functionName;
        payload.txPlan.args = selection.candidate.buildArgs(options.answer, options.reason);
        payload.txPlan.abiSignature = selection.candidate.abiSignature;
      }
      payload.txPlan.selection = selection.selection;
      payload.precheck = {
        ...precheck,
        caller,
        callerIsArbiter: selection.callerIsArbiter,
        callerIsOperator: selection.callerIsOperator,
      };
      if (!selection.candidate) {
        payload.diagnostics.push('Resolve method could not be selected from precheck alone. A caller role may be required.');
      }
    } catch (err) {
      payload.precheck = null;
      payload.diagnostics.push(
        `Resolve precheck unavailable: ${err && err.message ? err.message : String(err)}`,
      );
    }
    return payload;
  }

  await ensureContractCode(publicClient, pollAddress, 'Poll contract');

  const precheck = await readPollResolutionState(publicClient, pollAddress, { callerAddress: caller });
  const selection = buildResolveMethodSelection(precheck, caller, options.answer);
  payload.precheck = {
    ...precheck,
    caller,
    callerIsArbiter: selection.callerIsArbiter,
    callerIsOperator: selection.callerIsOperator,
  };

  if (!selection.candidate) {
    throw createServiceError(
      'RESOLVE_UNSUPPORTED_CONTRACT',
      'Resolve could not determine a supported contract method for this poll and caller.',
      {
        pollAddress,
        caller,
        supportedMethods: selection.supportedMethods,
        readSources: precheck.readSources,
      },
    );
  }

  payload.txPlan.functionName = selection.candidate.functionName;
  payload.txPlan.args = selection.candidate.buildArgs(options.answer, options.reason);
  payload.txPlan.abiSignature = selection.candidate.abiSignature;
  payload.txPlan.selection = selection.selection;

  if (
    selection.candidate.role === 'arbiter'
    && precheck.operator
    && caller
    && !selection.callerIsArbiter
  ) {
    throw createServiceError(
      'RESOLVE_CALLER_NOT_ARBITER',
      `Cannot resolve: caller is not arbiter. Arbiter: ${precheck.operator}.`,
      {
        arbiter: precheck.operator,
        caller,
        finalizationEpoch: precheck.finalizationEpoch,
        currentEpoch: precheck.currentEpoch,
        epochsUntilFinalization: precheck.epochsUntilFinalization,
      },
    );
  }
  if (selection.candidate.role === 'operator' && !selection.callerIsOperator) {
    throw createServiceError(
      'RESOLVE_CALLER_NOT_OPERATOR',
      'Cannot resolve: caller is not an operator for this poll.',
      {
        arbiter: precheck.operator,
        caller,
        finalizationEpoch: precheck.finalizationEpoch,
        currentEpoch: precheck.currentEpoch,
        epochsUntilFinalization: precheck.epochsUntilFinalization,
      },
    );
  }

  try {
    const simulation = await publicClient.simulateContract({
      account,
      address: pollAddress,
      abi: selection.candidate.abi,
      functionName: selection.candidate.functionName,
      args: selection.candidate.buildArgs(options.answer, options.reason),
    });
    const txHash = await walletClient.writeContract(simulation.request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    payload.tx = {
      chainId: runtime.chainId,
      account: account.address,
      txHash,
      explorerUrl: txExplorerUrl(runtime.chainId, txHash),
      gasEstimate: simulation.request && simulation.request.gas ? simulation.request.gas.toString() : null,
      status: receipt && receipt.status ? receipt.status : null,
      blockNumber:
        receipt && receipt.blockNumber !== undefined && receipt.blockNumber !== null
          ? receipt.blockNumber.toString()
          : null,
    };
    return payload;
  } catch (err) {
    throw await decodeAndWrapError(
      err,
      'RESOLVE_EXECUTION_FAILED',
      `Failed to execute ${selection.candidate.functionName}.`,
    );
  }
}

/**
 * Read LP balances and remove-liquidity previews for a wallet.
 * LP/share values are raw and human-readable decimal strings in the payload.
 * `collateralOutUsdc` is decimal USDC (6 decimals).
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function runLpPositions(options = {}) {
  const schemaVersion = '1.0.0';
  const generatedAt = new Date().toISOString();
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const runtime = await resolveRuntime(options, { requirePrivateKey: false, requireUsdc: false });
  const { publicClient } = await createClients(runtime, false);
  const wallet = normalizeAddress(options.wallet, '--wallet');
  const diagnostics = [];
  const indexerUrl = options.indexerUrl || process.env.PANDORA_INDEXER_URL || process.env.INDEXER_URL || DEFAULT_INDEXER_URL;

  let markets = [];
  if (options.marketAddress) {
    markets = [normalizeAddress(options.marketAddress, '--market-address')];
  } else {
    try {
      markets = await discoverLiquidityMarkets(indexerUrl, wallet, options.chainId || runtime.chainId, timeoutMs);
      if (!markets.length) {
        diagnostics.push('No LP markets discovered from indexer liquidity events for this wallet.');
      }
    } catch (err) {
      diagnostics.push(`Indexer market discovery failed: ${err && err.message ? err.message : String(err)}`);
    }
  }

  const marketRowsByAddress = await fetchIndexerMarketsMap(indexerUrl, markets, timeoutMs);

  const { formatUnits } = await loadViemRuntime();
  const items = await mapWithConcurrency(markets, READ_BATCH_CONCURRENCY, async (marketAddress) => {
    const itemDiagnostics = [];
    try {
      await ensureContractCode(publicClient, marketAddress, 'Market');
    } catch (err) {
      itemDiagnostics.push(err.message || String(err));
      return {
        marketAddress,
        lpTokenDecimals: null,
        lpTokenBalanceRaw: null,
        lpTokenBalance: null,
        preview: null,
        diagnostics: itemDiagnostics,
      };
    }

    const lpTokenDecimals = await readDecimals(publicClient, marketAddress, 18);
    let lpTokenBalanceRaw = null;
    try {
      const value = await publicClient.readContract({
        address: marketAddress,
        abi: LP_TOKEN_ABI,
        functionName: 'balanceOf',
        args: [wallet],
      });
      lpTokenBalanceRaw = value;
    } catch (err) {
      itemDiagnostics.push(`balanceOf failed: ${err && err.message ? err.message : String(err)}`);
    }

    let preview = null;
    if (typeof lpTokenBalanceRaw === 'bigint' && lpTokenBalanceRaw > 0n) {
      const calc = await readCalcRemoveLiquidity(publicClient, marketAddress, lpTokenBalanceRaw);
      if (calc) {
        preview = buildRemoveLiquidityPreviewPayload(formatUnits, calc);
      } else {
        itemDiagnostics.push('calcRemoveLiquidity unavailable for this market ABI.');
      }
    }

    let outcomeTokens = null;
    try {
      const refs = await readOutcomeTokenRefs(publicClient, marketAddress);
      if (refs) {
        const [yesDecimals, noDecimals, yesRaw, noRaw] = await Promise.all([
          readDecimals(publicClient, refs.yesToken, 18),
          readDecimals(publicClient, refs.noToken, 18),
          publicClient.readContract({
            address: refs.yesToken,
            abi: LP_TOKEN_ABI,
            functionName: 'balanceOf',
            args: [wallet],
          }),
          publicClient.readContract({
            address: refs.noToken,
            abi: LP_TOKEN_ABI,
            functionName: 'balanceOf',
            args: [wallet],
          }),
        ]);
        let resolution = null;
        try {
          const marketRow = marketRowsByAddress.get(marketAddress) || null;
          const pollAddress = marketRow && marketRow.pollAddress ? normalizeAddress(marketRow.pollAddress, 'pollAddress') : null;
          if (pollAddress) {
            resolution = await readPollResolutionState(publicClient, pollAddress);
          }
        } catch {
          // best effort only
        }
        outcomeTokens = buildOutcomeTokenVisibility({
          refs,
          yesRaw,
          noRaw,
          yesDecimals,
          noDecimals,
          resolution,
          formatUnits,
        });
      }
    } catch (err) {
      itemDiagnostics.push(`Outcome token balance read failed: ${err && err.message ? err.message : String(err)}`);
    }

    return {
      marketAddress,
      lpTokenDecimals,
      lpTokenBalanceRaw: lpTokenBalanceRaw === null ? null : lpTokenBalanceRaw.toString(),
      lpTokenBalance:
        lpTokenBalanceRaw === null ? null : formatUnits(lpTokenBalanceRaw, lpTokenDecimals),
      preview,
      outcomeTokens,
      diagnostics: itemDiagnostics,
    };
  });

  return {
    schemaVersion,
    generatedAt,
    mode: 'read',
    runtime: {
      mode: runtime.mode,
      chainId: runtime.chainId,
      rpcUrl: runtime.rpcUrl,
    },
    action: 'positions',
    wallet,
    chainId: runtime.chainId,
    rpcUrl: runtime.rpcUrl,
    count: items.length,
    items,
    diagnostics,
  };
}

/**
 * Build or execute `addLiquidity`.
 * `amountUsdc` is decimal USDC input; `collateralAmountRaw` is 6-decimal raw units.
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function runLpAdd(options = {}) {
  const schemaVersion = '1.0.0';
  const generatedAt = new Date().toISOString();
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const deadlineSeconds = Number.isInteger(Number(options.deadlineSeconds))
    ? Math.max(60, Math.trunc(Number(options.deadlineSeconds)))
    : 1800;

  const payload = {
    schemaVersion,
    generatedAt,
    mode: options.execute ? 'execute' : 'dry-run',
    runtime: {
      mode: options.fork || options.forkRpcUrl ? 'fork' : 'live',
      chainId: options.forkChainId || options.chainId || null,
      rpcUrl: options.forkRpcUrl || options.rpcUrl || null,
    },
    status: options.execute ? 'submitted' : 'planned',
    action: 'add',
    marketAddress: options.marketAddress,
    amountUsdc: options.amountUsdc,
    deadlineSeconds,
    txPlan: null,
    preflight: null,
    tx: null,
    diagnostics: [],
  };

  const runtime = await resolveRuntime(options, {
    requirePrivateKey: options.execute,
    requireUsdc: options.execute,
  });
  payload.runtime = {
    mode: runtime.mode,
    chainId: runtime.chainId,
    rpcUrl: runtime.rpcUrl,
  };
  const marketAddress = normalizeAddress(options.marketAddress, '--market-address');

  const { parseUnits, formatUnits } = await loadViemRuntime();
  const collateralAmountRaw = parseUnits(String(options.amountUsdc), 6);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);
  const minOutcomeShares = [0n, 0n];

  payload.txPlan = {
    collateralAmountRaw: collateralAmountRaw.toString(),
    minOutcomeSharesRaw: minOutcomeShares.map((item) => item.toString()),
    deadline: deadline.toString(),
    removeLiquidityArgOrder: 'sharesToBurn, minCollateralOut, deadline',
  };

  if (!options.execute) {
    return payload;
  }

  const { publicClient, walletClient, account } = await createClients(runtime, true, {
    command: 'lp.add',
    toolFamily: 'lp',
    category: options.category || null,
  });
  await ensureContractCode(publicClient, marketAddress, 'Market');

  let marketInIndexer = null;
  const indexerUrl = options.indexerUrl || process.env.PANDORA_INDEXER_URL || process.env.INDEXER_URL || DEFAULT_INDEXER_URL;
  try {
    marketInIndexer = await fetchIndexerMarket(indexerUrl, marketAddress, timeoutMs);
    if (!marketInIndexer) {
      payload.diagnostics.push('Market address not found in indexer markets(). Verify the target market.');
    }
  } catch (err) {
    payload.diagnostics.push(`Indexer market validation skipped: ${err && err.message ? err.message : String(err)}`);
  }

  let allowance;
  try {
    allowance = await publicClient.readContract({
      address: runtime.usdc,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account.address, marketAddress],
    });
  } catch (err) {
    throw await decodeAndWrapError(err, 'LP_ADD_ALLOWANCE_READ_FAILED', 'Failed to read USDC allowance.');
  }

  const approveRequired = allowance < collateralAmountRaw;
  const preflight = {
    account: account.address,
    chainId: runtime.chainId,
    usdc: runtime.usdc,
    allowanceRaw: allowance.toString(),
    amountRaw: collateralAmountRaw.toString(),
    allowanceSufficient: !approveRequired,
    amountUsdc: formatUnits(collateralAmountRaw, 6),
    marketInIndexer: Boolean(marketInIndexer),
  };

  let approveSimulation = null;
  if (approveRequired) {
    try {
      approveSimulation = await publicClient.simulateContract({
        account,
        address: runtime.usdc,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [marketAddress, collateralAmountRaw],
      });
    } catch (err) {
      throw await decodeAndWrapError(err, 'LP_ADD_APPROVE_SIMULATION_FAILED', 'USDC approve simulation failed.');
    }
  }

  let addSimulation;
  try {
    addSimulation = await publicClient.simulateContract({
      account,
      address: marketAddress,
      abi: PREDICTION_AMM_ABI,
      functionName: 'addLiquidity',
      args: [collateralAmountRaw, minOutcomeShares, deadline],
    });
  } catch (err) {
    throw await decodeAndWrapError(err, 'LP_ADD_SIMULATION_FAILED', 'addLiquidity simulation failed.');
  }

  preflight.approveGasEstimate =
    approveSimulation && approveSimulation.request && approveSimulation.request.gas
      ? approveSimulation.request.gas.toString()
      : null;
  preflight.addLiquidityGasEstimate =
    addSimulation && addSimulation.request && addSimulation.request.gas
      ? addSimulation.request.gas.toString()
      : null;
  payload.preflight = preflight;

  try {
    let approveTxHash = null;
    let approveReceipt = null;
    if (approveRequired) {
      approveTxHash = await walletClient.writeContract(approveSimulation.request);
      approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
    }

    const addTxHash = await walletClient.writeContract(addSimulation.request);
    const addReceipt = await publicClient.waitForTransactionReceipt({ hash: addTxHash });
    payload.tx = {
      approveTxHash,
      approveTxUrl: txExplorerUrl(runtime.chainId, approveTxHash),
      approveStatus: approveReceipt && approveReceipt.status ? approveReceipt.status : null,
      addTxHash,
      addTxUrl: txExplorerUrl(runtime.chainId, addTxHash),
      addStatus: addReceipt && addReceipt.status ? addReceipt.status : null,
      addBlockNumber:
        addReceipt && addReceipt.blockNumber !== undefined && addReceipt.blockNumber !== null
          ? addReceipt.blockNumber.toString()
          : null,
    };
    return payload;
  } catch (err) {
    throw await decodeAndWrapError(err, 'LP_ADD_EXECUTION_FAILED', 'Failed to execute addLiquidity.');
  }
}

/**
 * Build or execute `removeLiquidity`.
 * `lpTokens` is decimal LP token amount; `sharesToBurnRaw` is on-chain raw units.
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function runLpRemove(options = {}) {
  const schemaVersion = '1.0.0';
  const generatedAt = new Date().toISOString();
  const deadlineSeconds = Number.isInteger(Number(options.deadlineSeconds))
    ? Math.max(60, Math.trunc(Number(options.deadlineSeconds)))
    : 1800;

  const payload = {
    schemaVersion,
    generatedAt,
    mode: options.execute ? 'execute' : 'dry-run',
    runtime: {
      mode: options.fork || options.forkRpcUrl ? 'fork' : 'live',
      chainId: options.forkChainId || options.chainId || null,
      rpcUrl: options.forkRpcUrl || options.rpcUrl || null,
    },
    status: options.execute ? 'submitted' : 'planned',
    action: 'remove',
    marketAddress: options.marketAddress,
    lpTokens: options.lpAll ? 'all' : options.lpTokens,
    deadlineSeconds,
    txPlan: null,
    preflight: null,
    tx: null,
    diagnostics: [],
  };

  const runtime = options.resolvedRuntime || await resolveRuntime(options, {
    requirePrivateKey: options.execute,
    requireUsdc: false,
  });
  payload.runtime = {
    mode: runtime.mode,
    chainId: runtime.chainId,
    rpcUrl: runtime.rpcUrl,
  };
  const marketAddress = normalizeAddress(options.marketAddress, '--market-address');
  const { parseUnits, formatUnits } = await loadViemRuntime();

  if (!options.execute) {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);
    if (options.lpAll) {
      payload.txPlan = {
        lpTokenDecimalsAssumed: 18,
        sharesToBurnRaw: null,
        sharesToBurnMode: 'all-onchain-balance-at-execution',
        minCollateralOutRaw: '0',
        deadline: deadline.toString(),
        removeLiquidityArgOrder: 'sharesToBurn, minCollateralOut, deadline',
      };
      payload.diagnostics.push(
        'Dry-run with --all defers LP token amount resolution to execution-time on-chain balance.',
      );
      return payload;
    }
    payload.txPlan = {
      lpTokenDecimalsAssumed: 18,
      sharesToBurnRaw: parseUnits(String(options.lpTokens), 18).toString(),
      minCollateralOutRaw: '0',
      deadline: deadline.toString(),
      removeLiquidityArgOrder: 'sharesToBurn, minCollateralOut, deadline',
    };
    return payload;
  }

  const { publicClient, walletClient, account } = await createClients(runtime, true, {
    command: 'lp.remove',
    toolFamily: 'lp',
    category: options.category || null,
  });
  await ensureContractCode(publicClient, marketAddress, 'Market');

  const lpTokenDecimals = await readDecimals(publicClient, marketAddress, 18);
  let sharesToBurnRaw;
  if (options.lpAll) {
    const balanceRaw = await publicClient.readContract({
      address: marketAddress,
      abi: LP_TOKEN_ABI,
      functionName: 'balanceOf',
      args: [account.address],
    });
    if (typeof balanceRaw !== 'bigint' || balanceRaw <= 0n) {
      throw createServiceError('LP_REMOVE_ZERO_BALANCE', 'No LP token balance available to remove with --all.', {
        marketAddress,
        account: account.address,
      });
    }
    sharesToBurnRaw = balanceRaw;
    payload.lpTokens = formatUnits(balanceRaw, lpTokenDecimals);
    payload.diagnostics.push('Using full LP token balance (--all) from on-chain balanceOf(account).');
  } else {
    sharesToBurnRaw = parseUnits(String(options.lpTokens), lpTokenDecimals);
  }
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);
  const minCollateralOutRaw = 0n;
  const preview = await readCalcRemoveLiquidity(publicClient, marketAddress, sharesToBurnRaw);

  payload.txPlan = {
    lpTokenDecimals,
    sharesToBurnRaw: sharesToBurnRaw.toString(),
    minCollateralOutRaw: minCollateralOutRaw.toString(),
    deadline: deadline.toString(),
    removeLiquidityArgOrder: 'sharesToBurn, minCollateralOut, deadline',
  };
  payload.preflight = {
    account: account.address,
    chainId: runtime.chainId,
    preview: buildRemoveLiquidityPreviewPayload(formatUnits, preview),
  };

  let simulation;
  try {
    simulation = await publicClient.simulateContract({
      account,
      address: marketAddress,
      abi: PREDICTION_AMM_ABI,
      functionName: 'removeLiquidity',
      args: [sharesToBurnRaw, minCollateralOutRaw, deadline],
    });
  } catch (err) {
    throw await decodeAndWrapError(err, 'LP_REMOVE_SIMULATION_FAILED', 'removeLiquidity simulation failed.');
  }
  payload.preflight.removeLiquidityGasEstimate =
    simulation && simulation.request && simulation.request.gas
      ? simulation.request.gas.toString()
      : null;

  try {
    const txHash = await walletClient.writeContract(simulation.request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    payload.tx = {
      txHash,
      txUrl: txExplorerUrl(runtime.chainId, txHash),
      status: receipt && receipt.status ? receipt.status : null,
      blockNumber:
        receipt && receipt.blockNumber !== undefined && receipt.blockNumber !== null
          ? receipt.blockNumber.toString()
          : null,
    };
    return payload;
  } catch (err) {
    throw await decodeAndWrapError(err, 'LP_REMOVE_EXECUTION_FAILED', 'Failed to execute removeLiquidity.');
  }
}

async function runLpSimulateRemove(options = {}) {
  const schemaVersion = '1.0.0';
  const generatedAt = new Date().toISOString();
  const runtime = await resolveRuntime(options, {
    requirePrivateKey: false,
    requireUsdc: false,
  });
  const { publicClient, account } = await createClients(runtime, false, {
    command: 'lp.simulate-remove',
    toolFamily: 'lp',
    category: options.category || null,
  });
  const marketAddress = normalizeAddress(options.marketAddress, '--market-address');
  await ensureContractCode(publicClient, marketAddress, 'Market');
  const { parseUnits, formatUnits } = await loadViemRuntime();
  const lpTokenDecimals = await readDecimals(publicClient, marketAddress, 18);
  const wallet = options.wallet
    ? normalizeAddress(options.wallet, '--wallet')
    : account && account.address
      ? account.address.toLowerCase()
      : null;
  const diagnostics = [];

  let sharesToBurnRaw;
  let lpTokens = options.lpTokens;
  if (options.lpAll) {
    if (!wallet) {
      throw createServiceError(
        'MISSING_REQUIRED_FLAG',
        'lp simulate-remove --all requires --wallet <address> or signer credentials for wallet discovery.',
      );
    }
    const balanceRaw = await publicClient.readContract({
      address: marketAddress,
      abi: LP_TOKEN_ABI,
      functionName: 'balanceOf',
      args: [wallet],
    });
    if (typeof balanceRaw !== 'bigint' || balanceRaw <= 0n) {
      throw createServiceError('LP_REMOVE_ZERO_BALANCE', 'No LP token balance available to preview with --all.', {
        marketAddress,
        wallet,
      });
    }
    sharesToBurnRaw = balanceRaw;
    lpTokens = formatUnits(balanceRaw, lpTokenDecimals);
    diagnostics.push('Using full LP token balance (--all) from on-chain balanceOf(wallet).');
  } else {
    sharesToBurnRaw = parseUnits(String(options.lpTokens), lpTokenDecimals);
  }

  const preview = await readCalcRemoveLiquidity(publicClient, marketAddress, sharesToBurnRaw);
  const previewPayload = buildRemoveLiquidityPreviewPayload(formatUnits, preview);
  if (!previewPayload) {
    diagnostics.push('calcRemoveLiquidity unavailable for this market ABI.');
  }

  return {
    schemaVersion,
    generatedAt,
    mode: 'preview',
    status: previewPayload ? 'ready' : 'unavailable',
    runtime: {
      mode: runtime.mode,
      chainId: runtime.chainId,
      rpcUrl: runtime.rpcUrl,
    },
    action: 'simulate-remove',
    marketAddress,
    wallet,
    lpTokens,
    lpTokenDecimals,
    sharesToBurnRaw: sharesToBurnRaw.toString(),
    preview: previewPayload,
    diagnostics,
  };
}

/**
 * Dispatch LP admin action (`positions`, `add`, `remove`).
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function runLp(options = {}) {
  if (options.action === 'positions') {
    return runLpPositions(options);
  }
  if (options.action === 'add') {
    return runLpAdd(options);
  }
  if (options.action === 'simulate-remove') {
    return runLpSimulateRemove(options);
  }
  if (options.action === 'remove') {
    if (options.allMarkets) {
      return runLpRemoveAllMarkets(options);
    }
    return runLpRemove(options);
  }
  throw createServiceError('INVALID_ARGS', 'lp requires action add|remove|positions|simulate-remove.');
}

async function runLpRemoveAllMarkets(options = {}) {
  const schemaVersion = '1.0.0';
  const generatedAt = new Date().toISOString();
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const runtime = await resolveRuntime(options, {
    requirePrivateKey: options.execute,
    requireUsdc: false,
  });
  const signerClients = options.wallet ? null : await createClients(runtime, false);
  const wallet =
    options.wallet ||
    (signerClients && signerClients.account && signerClients.account.address
      ? signerClients.account.address.toLowerCase()
      : null);
  if (!wallet) {
    throw createServiceError(
      'MISSING_REQUIRED_FLAG',
      'lp remove --all-markets requires --wallet <address> or signer credentials (--private-key or --profile-id/--profile-file) for wallet discovery.',
    );
  }
  const indexerUrl = options.indexerUrl || process.env.PANDORA_INDEXER_URL || process.env.INDEXER_URL || DEFAULT_INDEXER_URL;
  const markets = await discoverLiquidityMarkets(indexerUrl, wallet, options.chainId || runtime.chainId, timeoutMs);
  const batchConcurrency = options.execute ? 1 : READ_BATCH_CONCURRENCY;
  const items = await mapWithConcurrency(markets, batchConcurrency, async (marketAddress) => {
    try {
      const item = await runLpRemove({
        ...options,
        marketAddress,
        lpAll: true,
        lpTokens: null,
        wallet,
        resolvedRuntime: runtime,
      });
      return {
        marketAddress,
        ok: true,
        result: item,
      };
    } catch (err) {
      return {
        marketAddress,
        ok: false,
        error: {
          code: err && err.code ? err.code : 'LP_REMOVE_MARKET_FAILED',
          message: err && err.message ? err.message : String(err),
          details: err && err.details ? err.details : null,
        },
      };
    }
  });

  return {
    schemaVersion,
    generatedAt,
    mode: options.execute ? 'execute' : 'dry-run',
    runtime: {
      mode: runtime.mode,
      chainId: runtime.chainId,
      rpcUrl: runtime.rpcUrl,
    },
    action: 'remove-all-markets',
    wallet,
    indexerUrl,
    count: items.length,
    successCount: items.filter((item) => item.ok).length,
    failureCount: items.filter((item) => !item.ok).length,
    items,
  };
}

async function simulateRedeem(publicClient, account, marketAddress) {
  for (const abi of CLAIM_MARKET_ABI_CANDIDATES) {
    try {
      const simulation = await publicClient.simulateContract({
        account,
        address: marketAddress,
        abi,
        functionName: 'redeemWinnings',
        args: [],
      });
      return {
        ok: true,
        simulation,
        estimatedClaimRaw:
          simulation && simulation.result !== undefined && simulation.result !== null
            ? simulation.result.toString()
            : null,
      };
    } catch {
      // try next signature
    }
  }
  return {
    ok: false,
    simulation: null,
    estimatedClaimRaw: null,
  };
}

async function runClaimSingle(options = {}) {
  const schemaVersion = '1.0.0';
  const generatedAt = new Date().toISOString();
  const runtime = options.resolvedRuntime || await resolveRuntime(options, { requirePrivateKey: options.execute, requireUsdc: false });
  const { publicClient, walletClient, account } = options.sharedClients || await createClients(runtime, options.execute, {
    command: 'claim',
    toolFamily: 'claim',
    category: options.category || null,
  });
  const marketAddress = normalizeAddress(options.marketAddress, '--market-address');
  await ensureContractCode(publicClient, marketAddress, 'Market');

  const indexerUrl = options.indexerUrl || process.env.PANDORA_INDEXER_URL || process.env.INDEXER_URL || DEFAULT_INDEXER_URL;
  const market = Object.prototype.hasOwnProperty.call(options, 'prefetchedMarket')
    ? options.prefetchedMarket
    : await fetchIndexerMarket(indexerUrl, marketAddress, normalizeTimeoutMs(options.timeoutMs));
  const pollAddress = market && market.pollAddress ? normalizeAddress(market.pollAddress, 'pollAddress') : null;

  let pollState = null;
  if (pollAddress) {
    try {
      await ensureContractCode(publicClient, pollAddress, 'Poll contract');
      pollState = await readPollResolutionState(publicClient, pollAddress);
    } catch {
      pollState = null;
    }
  }

  const payload = {
    schemaVersion,
    generatedAt,
    mode: options.execute ? 'execute' : 'dry-run',
    runtime: {
      mode: runtime.mode,
      chainId: runtime.chainId,
      rpcUrl: runtime.rpcUrl,
    },
    status: options.execute ? 'submitted' : 'planned',
    marketAddress,
    pollAddress,
    resolution: pollState,
    claimable: pollState ? Boolean(pollState.claimable) : null,
    txPlan: {
      functionName: 'redeemWinnings',
      abiSignature: 'redeemWinnings()',
      args: [],
    },
    preflight: null,
    tx: null,
    diagnostics: [],
  };

  const simulationAccount = account || (options.wallet ? normalizeAddress(options.wallet, '--wallet') : null);
  if (!simulationAccount) {
    payload.diagnostics.push('No signer credentials supplied; simulation-based claimability check skipped.');
    return payload;
  }

  const redeemSimulation = await simulateRedeem(publicClient, simulationAccount, marketAddress);
  payload.preflight = {
    account: typeof simulationAccount === 'string' ? simulationAccount : simulationAccount.address,
    simulationOk: redeemSimulation.ok,
    estimatedClaimRaw: redeemSimulation.estimatedClaimRaw,
  };

  if (!redeemSimulation.ok) {
    payload.claimable = false;
    payload.diagnostics.push('Redeem simulation failed. Market may not be claimable yet.');
    return payload;
  }

  if (!options.execute) {
    payload.claimable = true;
    return payload;
  }

  try {
    const txHash = await walletClient.writeContract(redeemSimulation.simulation.request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    payload.tx = {
      txHash,
      explorerUrl: txExplorerUrl(runtime.chainId, txHash),
      status: receipt && receipt.status ? receipt.status : null,
      blockNumber:
        receipt && receipt.blockNumber !== undefined && receipt.blockNumber !== null
          ? receipt.blockNumber.toString()
          : null,
    };
    payload.claimable = true;
    return payload;
  } catch (err) {
    throw await decodeAndWrapError(err, 'CLAIM_EXECUTION_FAILED', 'Failed to execute redeemWinnings.');
  }
}

async function runClaim(options = {}) {
  if (!options.all) {
    return runClaimSingle(options);
  }
  const schemaVersion = '1.0.0';
  const generatedAt = new Date().toISOString();
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const runtime = await resolveRuntime(options, { requirePrivateKey: options.execute, requireUsdc: false });
  const signerClients = options.wallet ? null : await createClients(runtime, false);
  const wallet =
    options.wallet ||
    (signerClients && signerClients.account && signerClients.account.address
      ? signerClients.account.address.toLowerCase()
      : null);
  if (!wallet) {
    throw createServiceError(
      'MISSING_REQUIRED_FLAG',
      'claim --all requires --wallet <address> or signer credentials (--private-key or --profile-id/--profile-file) for wallet discovery.',
    );
  }
  const indexerUrl = options.indexerUrl || process.env.PANDORA_INDEXER_URL || process.env.INDEXER_URL || DEFAULT_INDEXER_URL;
  const diagnostics = [];
  const [lpMarketsResult, userMarketsResult] = await Promise.allSettled([
    discoverLiquidityMarkets(indexerUrl, wallet, options.chainId || runtime.chainId, timeoutMs),
    discoverMarketUserMarkets(indexerUrl, wallet, options.chainId || runtime.chainId, timeoutMs),
  ]);
  const lpMarkets = lpMarketsResult.status === 'fulfilled' ? lpMarketsResult.value : [];
  const userMarkets = userMarketsResult.status === 'fulfilled' ? userMarketsResult.value : [];
  if (lpMarketsResult.status === 'rejected') {
    diagnostics.push(`LP market discovery failed: ${lpMarketsResult.reason && lpMarketsResult.reason.message ? lpMarketsResult.reason.message : String(lpMarketsResult.reason)}`);
  }
  if (userMarketsResult.status === 'rejected') {
    diagnostics.push(`Position market discovery failed: ${userMarketsResult.reason && userMarketsResult.reason.message ? userMarketsResult.reason.message : String(userMarketsResult.reason)}`);
  }
  const markets = Array.from(new Set([...lpMarkets, ...userMarkets]));
  if (!markets.length) {
    diagnostics.push('No candidate markets discovered for claim-all.');
  }
  const prefetchedMarketsByAddress = await fetchIndexerMarketsMap(indexerUrl, markets, timeoutMs);
  const sharedClients = options.sharedClients || await createClients(runtime, options.execute, {
    command: 'claim',
    toolFamily: 'claim',
    category: options.category || null,
  });
  const batchConcurrency = options.execute ? 1 : READ_BATCH_CONCURRENCY;
  const items = await mapWithConcurrency(markets, batchConcurrency, async (marketAddress) => {
    try {
      const item = await runClaimSingle({
        ...options,
        all: false,
        marketAddress,
        wallet,
        indexerUrl,
        resolvedRuntime: runtime,
        sharedClients,
        prefetchedMarket: prefetchedMarketsByAddress.get(marketAddress) || null,
      });
      return { marketAddress, ok: true, result: item };
    } catch (err) {
      return {
        marketAddress,
        ok: false,
        error: {
          code: err && err.code ? err.code : 'CLAIM_FAILED',
          message: err && err.message ? err.message : String(err),
          details: err && err.details ? err.details : null,
        },
      };
    }
  });
  return {
    schemaVersion,
    generatedAt,
    mode: options.execute ? 'execute' : 'dry-run',
    runtime: {
      mode: runtime.mode,
      chainId: runtime.chainId,
      rpcUrl: runtime.rpcUrl,
    },
    action: 'claim-all',
    wallet,
    indexerUrl,
    count: items.length,
    successCount: items.filter((item) => item.ok).length,
    failureCount: items.filter((item) => !item.ok).length,
    items,
    diagnostics,
  };
}

/** Public market admin API consumed by CLI `resolve` and `lp` commands. */
module.exports = {
  runResolve,
  runLp,
  runLpPositions,
  runClaim,
  readPollResolutionState,
  buildOutcomeTokenVisibility,
  buildRemoveLiquidityPreviewPayload,
};
