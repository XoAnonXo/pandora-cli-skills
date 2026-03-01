const { DEFAULT_INDEXER_URL, DEFAULT_RPC_BY_CHAIN_ID } = require('./shared/constants.cjs');
const { isSecureHttpUrlOrLocal } = require('./shared/utils.cjs');
const { resolveForkRuntime } = require('./fork_runtime_service.cjs');

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

const RESOLVE_MARKET_ABI = [
  {
    type: 'function',
    name: 'resolveMarket',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'outcome', type: 'bool' }],
    outputs: [],
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

function normalizeResolveOutcome(answer) {
  const normalized = String(answer || '').trim().toLowerCase();
  if (normalized === 'yes') return true;
  if (normalized === 'no') return false;
  return null;
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

async function createClients(runtime, requireWallet = false) {
  const { createPublicClient, createWalletClient, http, privateKeyToAccount } = await loadViemRuntime();
  const publicClient = createPublicClient({ chain: runtime.chain, transport: http(runtime.rpcUrl) });
  let account = null;
  let walletClient = null;

  if (runtime.privateKey) {
    account = privateKeyToAccount(runtime.privateKey);
    walletClient = createWalletClient({ account, chain: runtime.chain, transport: http(runtime.rpcUrl) });
  }

  if (requireWallet && (!account || !walletClient)) {
    throw createServiceError('MISSING_REQUIRED_FLAG', 'Missing private key. Set PRIVATE_KEY or pass --private-key.');
  }

  return { publicClient, walletClient, account };
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

/**
 * Resolve a market outcome by calling `resolveMarket(bool)`.
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function runResolve(options = {}) {
  const schemaVersion = '1.0.0';
  const generatedAt = new Date().toISOString();
  const outcome = normalizeResolveOutcome(options.answer);
  if (outcome === null) {
    throw createServiceError(
      'INVALID_FLAG_VALUE',
      '--answer invalid is not supported by resolveMarket(bool). Use yes|no.',
    );
  }

  const deadlineSeconds = Number.isInteger(Number(options.deadlineSeconds))
    ? Math.max(60, Math.trunc(Number(options.deadlineSeconds)))
    : 1800;
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
      functionName: 'resolveMarket',
      args: [outcome],
      abiSignature: 'resolveMarket(bool)',
      notes: [
        'Resolution is restricted by arbiter/operator checks on-chain.',
        `Reason is recorded off-chain in CLI payload: ${options.reason}`,
      ],
    },
    tx: null,
    diagnostics: [],
  };

  if (!options.execute) {
    return payload;
  }

  const runtime = await resolveRuntime(options, { requirePrivateKey: true, requireUsdc: false });
  payload.runtime = {
    mode: runtime.mode,
    chainId: runtime.chainId,
    rpcUrl: runtime.rpcUrl,
  };
  const { publicClient, walletClient, account } = await createClients(runtime, true);
  const pollAddress = normalizeAddress(options.pollAddress, 'pollAddress');

  await ensureContractCode(publicClient, pollAddress, 'Poll contract');

  try {
    const simulation = await publicClient.simulateContract({
      account,
      address: pollAddress,
      abi: RESOLVE_MARKET_ABI,
      functionName: 'resolveMarket',
      args: [outcome],
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
    throw await decodeAndWrapError(err, 'RESOLVE_EXECUTION_FAILED', 'Failed to execute resolveMarket.');
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

  let markets = [];
  if (options.marketAddress) {
    markets = [normalizeAddress(options.marketAddress, '--market-address')];
  } else {
    const indexerUrl = options.indexerUrl || process.env.PANDORA_INDEXER_URL || process.env.INDEXER_URL || DEFAULT_INDEXER_URL;
    try {
      markets = await discoverLiquidityMarkets(indexerUrl, wallet, options.chainId || runtime.chainId, timeoutMs);
      if (!markets.length) {
        diagnostics.push('No LP markets discovered from indexer liquidity events for this wallet.');
      }
    } catch (err) {
      diagnostics.push(`Indexer market discovery failed: ${err && err.message ? err.message : String(err)}`);
    }
  }

  const { formatUnits } = await loadViemRuntime();
  const items = [];
  for (const marketAddress of markets) {
    const itemDiagnostics = [];
    try {
      await ensureContractCode(publicClient, marketAddress, 'Market');
    } catch (err) {
      itemDiagnostics.push(err.message || String(err));
      items.push({
        marketAddress,
        lpTokenDecimals: null,
        lpTokenBalanceRaw: null,
        lpTokenBalance: null,
        preview: null,
        diagnostics: itemDiagnostics,
      });
      continue;
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
        preview = {
          collateralOutRaw: calc.collateralOutRaw,
          collateralOutUsdc:
            calc.collateralOutRaw !== null ? formatUnits(BigInt(calc.collateralOutRaw), 6) : null,
          yesOutRaw: calc.yesOutRaw,
          yesOut:
            calc.yesOutRaw !== null ? formatUnits(BigInt(calc.yesOutRaw), 18) : null,
          noOutRaw: calc.noOutRaw,
          noOut:
            calc.noOutRaw !== null ? formatUnits(BigInt(calc.noOutRaw), 18) : null,
        };
      } else {
        itemDiagnostics.push('calcRemoveLiquidity unavailable for this market ABI.');
      }
    }

    items.push({
      marketAddress,
      lpTokenDecimals,
      lpTokenBalanceRaw: lpTokenBalanceRaw === null ? null : lpTokenBalanceRaw.toString(),
      lpTokenBalance:
        lpTokenBalanceRaw === null ? null : formatUnits(lpTokenBalanceRaw, lpTokenDecimals),
      preview,
      diagnostics: itemDiagnostics,
    });
  }

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

  const { publicClient, walletClient, account } = await createClients(runtime, true);
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
    lpTokens: options.lpTokens,
    deadlineSeconds,
    txPlan: null,
    preflight: null,
    tx: null,
    diagnostics: [],
  };

  const runtime = await resolveRuntime(options, {
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
    payload.txPlan = {
      lpTokenDecimalsAssumed: 18,
      sharesToBurnRaw: parseUnits(String(options.lpTokens), 18).toString(),
      minCollateralOutRaw: '0',
      deadline: deadline.toString(),
      removeLiquidityArgOrder: 'sharesToBurn, minCollateralOut, deadline',
    };
    return payload;
  }

  const { publicClient, walletClient, account } = await createClients(runtime, true);
  await ensureContractCode(publicClient, marketAddress, 'Market');

  const lpTokenDecimals = await readDecimals(publicClient, marketAddress, 18);
  const sharesToBurnRaw = parseUnits(String(options.lpTokens), lpTokenDecimals);
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
    preview: preview
      ? {
          collateralOutRaw: preview.collateralOutRaw,
          collateralOutUsdc:
            preview.collateralOutRaw !== null ? formatUnits(BigInt(preview.collateralOutRaw), 6) : null,
          yesOutRaw: preview.yesOutRaw,
          noOutRaw: preview.noOutRaw,
        }
      : null,
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
  if (options.action === 'remove') {
    return runLpRemove(options);
  }
  throw createServiceError('INVALID_ARGS', 'lp requires action add|remove|positions.');
}

/** Public market admin API consumed by CLI `resolve` and `lp` commands. */
module.exports = {
  runResolve,
  runLp,
  runLpPositions,
};
