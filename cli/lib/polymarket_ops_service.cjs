const { ClobClient, Chain } = require('@polymarket/clob-client');
const {
  resolvePolymarketMarket,
  fetchPolymarketPositionInventory,
  fetchPolymarketPositionSummary,
  loadEthersWalletModule,
} = require('./polymarket_trade_adapter.cjs');

const POLYMARKET_OPS_SCHEMA_VERSION = '1.0.0';
const POLYGON_CHAIN_ID = 137;
const POLYMARKET_SIG_TYPE_EOA = 0;
const POLYMARKET_SIG_TYPE_PROXY = 2;
const MAX_UINT256 = (1n << 256n) - 1n;
const DEFAULT_ALLOWANCE_SUFFICIENT_FLOOR_RAW = 1n << 128n;
const POLYGON_MIN_GAS_PRICE_WEI = 25n * 1_000_000_000n; // 25 gwei floor on Polygon
const POLYGON_GAS_PRICE_MULTIPLIER_NUM = 2n;

// Polygon mainnet addresses from official Polymarket CLOB contract config/docs.
const POLYMARKET_POLYGON_DEFAULTS = {
  usdc: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC.e collateral (ERC20)
  ctf: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045', // Conditional Tokens (ERC1155)
  spenders: [
    { key: 'exchange', label: 'CTF Exchange', address: '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e' },
    { key: 'negRiskExchange', label: 'Neg Risk Exchange', address: '0xc5d563a36ae78145c45a50134d48a1215220f80a' },
    { key: 'negRiskAdapter', label: 'Neg Risk Adapter', address: '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296' },
  ],
};

const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
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
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
];

const CTF_ABI = [
  {
    type: 'function',
    name: 'isApprovedForAll',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'operator', type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'setApprovalForAll',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    outputs: [],
  },
];

const SAFE_OWNER_ABI = [
  {
    type: 'function',
    name: 'isOwner',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
];

function createServiceError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function isValidAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || '').trim());
}

function isValidPrivateKey(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || '').trim());
}

function normalizeAddress(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const trimmed = String(value).trim();
  if (!isValidAddress(trimmed)) {
    throw createServiceError('INVALID_ADDRESS', `${label} must be a valid address.`, {
      label,
      value: trimmed,
    });
  }
  return trimmed.toLowerCase();
}

function parseBooleanFlag(value, defaultValue = false) {
  if (value === null || value === undefined || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function normalizePositionSource(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'api') return 'api';
  if (normalized === 'on-chain' || normalized === 'onchain' || normalized === 'on_chain') return 'on-chain';
  return 'auto';
}

function normalizeTokenId(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function toBigIntOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'bigint') return value;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function formatUnits6(raw) {
  const value = toBigIntOrNull(raw);
  if (value === null) return null;
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const whole = absolute / 1_000_000n;
  const fraction = absolute % 1_000_000n;
  const fractionText = fraction.toString().padStart(6, '0').replace(/0+$/, '');
  return fractionText ? `${sign}${whole.toString()}.${fractionText}` : `${sign}${whole.toString()}`;
}

function decimalUsdcToRaw(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return BigInt(Math.round(numeric * 1_000_000));
}

function buildUsdcBalanceSnapshot(address, readResult) {
  const raw = toBigIntOrNull(readResult && readResult.value);
  return {
    address: address || null,
    readOk: Boolean(readResult && readResult.ok),
    raw: raw === null ? null : raw.toString(),
    formatted: formatUnits6(raw),
    error: readResult && readResult.error ? readResult.error : null,
  };
}

async function readUsdcBalanceSnapshot(publicClient, usdcAddress, address) {
  if (!address) {
    return buildUsdcBalanceSnapshot(null, {
      ok: false,
      value: null,
      error: 'Address unavailable.',
    });
  }
  const result = await safeReadContract(publicClient, {
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
  });
  return buildUsdcBalanceSnapshot(address, result);
}

function cloneJsonCompatible(value) {
  return value && typeof value === 'object'
    ? JSON.parse(JSON.stringify(value))
    : value;
}

function dedupeList(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function buildSignedUsdcDelta(rawValue) {
  const raw = toBigIntOrNull(rawValue);
  if (raw === null) return null;
  return formatUnits6(raw);
}

function normalizeFundingTransferOptions(action, runtime, signerAddress, options = {}) {
  const explicitToAddress = normalizeAddress(options.to, 'to');
  if (action === 'deposit') {
    return {
      action,
      fromAddress: signerAddress || null,
      toAddress: explicitToAddress || runtime.funderAddress || null,
      manualProxyActionRequired: false,
    };
  }

  return {
    action,
    fromAddress: runtime.funderAddress || null,
    toAddress: explicitToAddress || signerAddress || null,
    manualProxyActionRequired: Boolean(runtime.funderAddress && signerAddress && runtime.funderAddress !== signerAddress),
  };
}

async function maybeSimulateUsdcTransfer(publicClient, accountAddress, runtime, toAddress, amountRaw) {
  if (!publicClient || !accountAddress || !toAddress || amountRaw === null) {
    return {
      attempted: false,
      ok: false,
      gasEstimate: null,
      request: null,
      error: null,
    };
  }
  try {
    const simulation = await publicClient.simulateContract({
      account: accountAddress,
      address: runtime.usdcAddress,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [toAddress, amountRaw],
    });
    return {
      attempted: true,
      ok: true,
      gasEstimate:
        simulation && simulation.request && simulation.request.gas !== undefined && simulation.request.gas !== null
          ? simulation.request.gas.toString()
          : null,
      request: simulation && simulation.request ? simulation.request : null,
      error: null,
    };
  } catch (err) {
    return {
      attempted: true,
      ok: false,
      gasEstimate: null,
      request: null,
      error: coerceErrorMessage(err),
    };
  }
}

function buildFundingPayloadBase(action, runtime, rpcSelection, signerAddress, transfer, amountUsdc, amountRaw, balances) {
  const sourceBalanceRaw = toBigIntOrNull(balances && balances.from && balances.from.raw);
  const destinationBalanceRaw = toBigIntOrNull(balances && balances.to && balances.to.raw);
  const sourceSufficient = sourceBalanceRaw === null ? null : sourceBalanceRaw >= amountRaw;
  const sourceAfterRaw = sourceBalanceRaw === null ? null : sourceBalanceRaw - amountRaw;
  const destinationAfterRaw = destinationBalanceRaw === null ? null : destinationBalanceRaw + amountRaw;

  return {
    schemaVersion: POLYMARKET_OPS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    status: 'planned',
    action,
    runtime: {
      rpcUrl: rpcSelection.selectedRpcUrl || runtime.configuredRpcUrl || null,
      configuredRpcUrl: runtime.configuredRpcUrl || null,
      rpcSource: rpcSelection.source || runtime.rpcSource || null,
      host: runtime.host,
      signerAddress: signerAddress || null,
      funderAddress: runtime.funderAddress || null,
      ownerAddress: transfer.fromAddress || runtime.funderAddress || signerAddress || null,
      usdcAddress: runtime.usdcAddress,
    },
    rpcSelection: cloneJsonCompatible(rpcSelection),
    signerAddress: signerAddress || null,
    funderAddress: runtime.funderAddress || null,
    fromAddress: transfer.fromAddress || null,
    toAddress: transfer.toAddress || null,
    amountUsdc,
    amountRaw: amountRaw.toString(),
    balances,
    txPlan: {
      contractAddress: runtime.usdcAddress,
      functionName: 'transfer',
      args: [transfer.toAddress || null, amountRaw.toString()],
      fromAddress: transfer.fromAddress || null,
    },
    preflight: {
      manualProxyActionRequired: transfer.manualProxyActionRequired,
      sourceBalanceSufficient: sourceSufficient,
      sourceBalanceAfterRaw: sourceAfterRaw === null ? null : sourceAfterRaw.toString(),
      sourceBalanceAfter: formatUnits6(sourceAfterRaw),
      destinationBalanceAfterRaw: destinationAfterRaw === null ? null : destinationAfterRaw.toString(),
      destinationBalanceAfter: formatUnits6(destinationAfterRaw),
      sourceDelta: buildSignedUsdcDelta(-amountRaw),
      destinationDelta: buildSignedUsdcDelta(amountRaw),
      transferGasEstimate: null,
      simulationAttempted: false,
      simulationOk: null,
      simulationError: null,
      executeSupported: transfer.manualProxyActionRequired !== true,
    },
    tx: null,
    diagnostics: [],
  };
}

function coerceErrorMessage(err) {
  if (err && typeof err.message === 'string') return err.message;
  return String(err);
}

function toFiniteNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundDecimal(value, decimals = 6) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
}

function buildPolymarketBalanceScope(context = {}) {
  const ownerAddress =
    context.ownerAddress || context.requestedWallet || context.funderAddress || context.signerAddress || '<address>';
  const requestedWallet = context.requestedWallet || null;
  const signerAddress = context.signerAddress || null;
  const funderAddress = context.funderAddress || null;
  const readTargets = requestedWallet
    ? [{ role: 'wallet', address: requestedWallet }]
    : [
        signerAddress ? { role: 'signer', address: signerAddress } : null,
        funderAddress ? { role: 'funder', address: funderAddress } : null,
        ownerAddress ? { role: 'owner', address: ownerAddress } : null,
      ].filter(Boolean);
  return {
    surface: 'polygon-usdc-wallet-collateral-only',
    asset: 'USDC.e',
    chainId: POLYGON_CHAIN_ID,
    ownerAddress,
    requestedWallet,
    signerAddress,
    funderAddress,
    uiBalanceParityExpected: false,
    description: 'Reads raw Polygon ERC20 USDC.e wallet balances for the resolved signer/funder/requested wallet addresses. This does not query authenticated Polymarket CLOB buying power.',
    excludes: [
      'authenticated Polymarket CLOB buying power',
      'YES/NO CTF inventory',
      'open orders',
    ],
    zeroBalanceInterpretation: 'A zero value here only means the queried wallet currently holds no raw Polygon USDC.e collateral on Polygon.',
    readTargets,
    suggestedChecks: {
      positions: `pandora polymarket positions --wallet ${ownerAddress} --source auto`,
      check: 'pandora polymarket check',
    },
  };
}

function buildPolymarketBalanceGuidance(context = {}) {
  const scope = buildPolymarketBalanceScope(context);
  const diagnostics = [
    'Funding-only surface: this command reads raw Polygon USDC.e ERC20 wallet balances, not authenticated Polymarket CLOB buying power, YES/NO CTF inventory, or open orders.',
  ];
  const ownerAddress = context.ownerAddress || null;
  const requestedWallet = context.requestedWallet || null;
  const signerAddress = context.signerAddress || null;
  const funderAddress = context.funderAddress || null;
  const ownerSnapshot =
    (requestedWallet && context.balances && context.balances.wallet)
    || (context.balances && context.balances.owner)
    || (context.balances && context.balances.funder)
    || (context.balances && context.balances.signer)
    || null;
  const ownerRaw = toBigIntOrNull(ownerSnapshot && ownerSnapshot.raw);

  if (requestedWallet) {
    diagnostics.push(`Requested wallet ${requestedWallet} overrides signer/funder address selection for this collateral read.`);
  } else if (ownerAddress) {
    diagnostics.push(`Resolved owner wallet for collateral checks: ${ownerAddress}.`);
  }
  if (ownerAddress && signerAddress && ownerAddress !== signerAddress) {
    diagnostics.push(`Signer ${signerAddress} differs from the wallet being read (${ownerAddress}); any Polymarket UI buying-power view tied to proxy/funder accounting can diverge from this raw wallet collateral read.`);
  }
  if (ownerAddress && funderAddress && ownerAddress !== funderAddress) {
    diagnostics.push(`Configured funder ${funderAddress} differs from the wallet being read (${ownerAddress}); proxy/funder funding can make the Polymarket UI look funded even when this raw wallet collateral read is zero.`);
  }

  if (ownerRaw !== null && ownerRaw <= 0n) {
    diagnostics.push(`A zero Polygon USDC.e wallet balance here does not prove the Polymarket UI buying-power view is zero; ${scope.surface} excludes proxy/CLOB accounting state.`);
  }

  diagnostics.push(
    `Use ${scope.suggestedChecks.positions} for YES/NO balances, open orders, and merge-readiness diagnostics.`,
  );
  return diagnostics;
}

function buildPolymarketMergeReadiness(summary = {}, context = {}) {
  const yesBalance = toFiniteNumberOrNull(summary.yesBalance);
  const noBalance = toFiniteNumberOrNull(summary.noBalance);
  const ownerAddress = context.ownerAddress || null;
  const signerAddress = context.signerAddress || null;
  const funderAddress = context.funderAddress || null;
  const diagnostics = [];
  const blockingReasons = [];
  const warnings = [];
  const missingBalances = [];
  let mergeablePairs = null;
  let residualYesBalance = null;
  let residualNoBalance = null;

  if (yesBalance === null) missingBalances.push('yes');
  if (noBalance === null) missingBalances.push('no');

  if (yesBalance !== null && noBalance !== null) {
    mergeablePairs = roundDecimal(Math.min(Math.max(yesBalance, 0), Math.max(noBalance, 0)));
    residualYesBalance = roundDecimal(Math.max(yesBalance - (mergeablePairs || 0), 0));
    residualNoBalance = roundDecimal(Math.max(noBalance - (mergeablePairs || 0), 0));
    if ((mergeablePairs || 0) > 0) {
      diagnostics.push(
        `Overlapping YES/NO inventory detected: up to ${mergeablePairs} complete pairs are merge-eligible for ${ownerAddress || 'the resolved owner wallet'}.`,
      );
    } else if (yesBalance > 0 || noBalance > 0) {
      diagnostics.push('No complete YES+NO overlap is currently available to merge.');
      blockingReasons.push('NO_OVERLAPPING_PAIRS');
    }
  } else {
    diagnostics.push('Merge readiness is partial because both YES and NO balances were not available.');
    if (yesBalance === null) {
      blockingReasons.push('YES_BALANCE_UNAVAILABLE');
    }
    if (noBalance === null) {
      blockingReasons.push('NO_BALANCE_UNAVAILABLE');
    }
  }

  if (ownerAddress && signerAddress && ownerAddress !== signerAddress) {
    diagnostics.push(
      `Signer ${signerAddress} differs from position owner ${ownerAddress}; merge execution must be submitted by the wallet that actually holds the positions.`,
    );
    blockingReasons.push('SIGNER_DIFFERS_FROM_OWNER');
  }
  if (ownerAddress && funderAddress && ownerAddress !== funderAddress) {
    diagnostics.push(
      `Configured funder ${funderAddress} differs from position owner ${ownerAddress}; proxy/funder-only signing can fail merge attempts.`,
    );
    blockingReasons.push('FUNDER_DIFFERS_FROM_OWNER');
  }
  warnings.push('Operator approval status is not verified by polymarket positions; use polymarket check/approve before attempting a merge.');
  if (ownerAddress) {
    warnings.push(`Merge execution must originate from ${ownerAddress} when positions are held there.`);
  }

  const uniqueBlockingReasons = dedupeList(blockingReasons);
  const uniqueWarnings = dedupeList(warnings);
  const inventoryReady = mergeablePairs !== null && mergeablePairs > 0;
  const executionWalletReady =
    !ownerAddress || ((!signerAddress || ownerAddress === signerAddress) && (!funderAddress || ownerAddress === funderAddress));
  const status = inventoryReady
    ? uniqueBlockingReasons.length === 0
      ? 'ready'
      : 'action-required'
    : missingBalances.length > 0
      ? 'partial'
      : 'not-ready';

  return {
    status,
    eligible: mergeablePairs === null ? null : mergeablePairs > 0,
    inventoryReady,
    executionWalletReady,
    mergeablePairs,
    residualYesBalance,
    residualNoBalance,
    ownerAddress,
    signerAddress,
    funderAddress,
    missingBalances,
    blockingReasons: uniqueBlockingReasons,
    warnings: uniqueWarnings,
    operatorApprovalStatus: 'unknown',
    executionWallet: ownerAddress,
    prerequisites: [
      'Submit merge transactions from the wallet that actually holds the YES/NO positions.',
      'Ensure the Conditional Tokens operator approval is granted before merge execution.',
    ],
    suggestedChecks: [
      'pandora polymarket check',
      ownerAddress ? `pandora polymarket positions --wallet ${ownerAddress} --source auto` : 'pandora polymarket positions --source auto',
    ],
    diagnostics,
  };
}

function normalizeRpcUrlCandidates(value) {
  if (value === null || value === undefined || value === '') return [];
  const normalized = [];
  const rawEntries = Array.isArray(value) ? value : String(value).split(',');
  for (const entry of rawEntries) {
    const candidate = String(entry || '').trim();
    if (candidate) normalized.push(candidate);
  }
  return Array.from(new Set(normalized));
}

function safeCodeToBoolean(code) {
  return String(code || '').trim().toLowerCase() !== '0x';
}

function resolveRpcInput(options = {}, env = process.env) {
  const sources = [
    { value: options.rpcUrl, source: 'options.rpcUrl' },
    { value: env.POLYMARKET_RPC_URL, source: 'env.POLYMARKET_RPC_URL' },
    { value: env.RPC_URL, source: 'env.RPC_URL' },
  ];

  for (const candidate of sources) {
    if (candidate.value !== null && candidate.value !== undefined) {
      const normalized = String(candidate.value).trim();
      if (normalized) {
        return {
          configuredRpcUrl: normalized,
          source: candidate.source,
        };
      }
    }
  }

  return {
    configuredRpcUrl: null,
    source: null,
  };
}

function resolveSpenders(options = {}, env = process.env) {
  const overrideByKey = {
    exchange: normalizeAddress(options.exchangeAddress || env.POLYMARKET_EXCHANGE_ADDRESS, 'exchangeAddress'),
    negRiskExchange: normalizeAddress(
      options.negRiskExchangeAddress || env.POLYMARKET_NEG_RISK_EXCHANGE_ADDRESS,
      'negRiskExchangeAddress',
    ),
    negRiskAdapter: normalizeAddress(
      options.negRiskAdapterAddress || env.POLYMARKET_NEG_RISK_ADAPTER_ADDRESS,
      'negRiskAdapterAddress',
    ),
  };

  return POLYMARKET_POLYGON_DEFAULTS.spenders.map((entry) => ({
    ...entry,
    address: overrideByKey[entry.key] || entry.address,
  }));
}

function resolveRuntime(options = {}) {
  const env = options.env || process.env;
  const rpcInput = resolveRpcInput(options, env);
  const privateKey = options.privateKey || env.POLYMARKET_PRIVATE_KEY || null;
  const funderAddress = normalizeAddress(options.funder || env.POLYMARKET_FUNDER, 'funder');
  const usdcAddress = normalizeAddress(options.usdcAddress || env.POLYMARKET_USDC_E_ADDRESS, 'usdcAddress')
    || POLYMARKET_POLYGON_DEFAULTS.usdc;
  const ctfAddress = normalizeAddress(options.ctfAddress || env.POLYMARKET_CTF_ADDRESS, 'ctfAddress')
    || POLYMARKET_POLYGON_DEFAULTS.ctf;
  const host = String(options.host || env.POLYMARKET_HOST || 'https://clob.polymarket.com').trim();
  const allowanceTargetRaw =
    toBigIntOrNull(options.allowanceTargetRaw || env.POLYMARKET_ALLOWANCE_TARGET_RAW) || MAX_UINT256;

  if (privateKey && !isValidPrivateKey(privateKey)) {
    throw createServiceError('INVALID_PRIVATE_KEY', 'privateKey must be a 32-byte hex string (0x + 64 hex chars).');
  }

  return {
    rpcUrl: null,
    configuredRpcUrl: rpcInput.configuredRpcUrl,
    rpcSource: rpcInput.source,
    rpcCandidates: normalizeRpcUrlCandidates(rpcInput.configuredRpcUrl),
    selectedRpcUrl: null,
    privateKey,
    funderAddress,
    host,
    usdcAddress,
    ctfAddress,
    spenders: resolveSpenders(options, env),
    apiKey: options.apiKey || env.POLYMARKET_API_KEY || null,
    apiSecret: options.apiSecret || env.POLYMARKET_API_SECRET || null,
    apiPassphrase: options.apiPassphrase || env.POLYMARKET_API_PASSPHRASE || null,
    allowanceTargetRaw,
    skipApiSanity:
      options.skipApiSanity === true || parseBooleanFlag(env.POLYMARKET_SKIP_API_KEY_SANITY, false),
  };
}

async function loadViemRuntime(deps = {}) {
  if (deps.viemRuntime) return deps.viemRuntime;
  const viem = await import('viem');
  const accounts = await import('viem/accounts');
  return { ...viem, ...accounts };
}

async function deriveSignerAddress(runtime, deps = {}) {
  if (!runtime.privateKey) return null;
  const { privateKeyToAccount } = await loadViemRuntime(deps);
  return privateKeyToAccount(runtime.privateKey).address.toLowerCase();
}

async function createPublicClient(runtime, deps = {}) {
  if (deps.publicClient) return deps.publicClient;
  const rpcSelection = await ensureRpcSelection(runtime, deps);
  return rpcSelection.publicClient || null;
}

async function createWalletClient(runtime, signerAddress, deps = {}) {
  if (deps.walletClient) return deps.walletClient;
  if (!runtime.privateKey || !signerAddress) return null;
  const rpcSelection = await ensureRpcSelection(runtime, deps);
  if (!rpcSelection.selectedRpcUrl) return null;
  if (runtime._walletClient && runtime._walletClientSignerAddress === signerAddress) {
    return runtime._walletClient;
  }
  const { createWalletClient, http, privateKeyToAccount } = await loadViemRuntime(deps);
  const account = privateKeyToAccount(runtime.privateKey);
  const walletClient = createWalletClient({ account, transport: http(rpcSelection.selectedRpcUrl) });
  runtime._walletClient = walletClient;
  runtime._walletClientSignerAddress = signerAddress;
  return walletClient;
}

async function ensureRpcSelection(runtime, deps = {}) {
  if (runtime._rpcSelection) return runtime._rpcSelection;

  const candidateUrls = Array.isArray(runtime.rpcCandidates) ? runtime.rpcCandidates.slice() : [];
  if (deps.publicClient) {
    const selectedRpcUrl = runtime.selectedRpcUrl || (candidateUrls.length === 1 ? candidateUrls[0] : null);
    runtime.rpcUrl = selectedRpcUrl;
    runtime.selectedRpcUrl = selectedRpcUrl;
    runtime._rpcSelection = {
      source: runtime.rpcSource || 'deps.publicClient',
      configuredRpcUrl: runtime.configuredRpcUrl || null,
      candidateUrls,
      selectedRpcUrl,
      fallbackUsed: Boolean(selectedRpcUrl && candidateUrls.indexOf(selectedRpcUrl) > 0),
      attempts: [],
      publicClient: deps.publicClient,
    };
    return runtime._rpcSelection;
  }

  if (!candidateUrls.length) {
    runtime.rpcUrl = null;
    runtime.selectedRpcUrl = null;
    runtime._rpcSelection = {
      source: runtime.rpcSource || null,
      configuredRpcUrl: runtime.configuredRpcUrl || null,
      candidateUrls,
      selectedRpcUrl: null,
      fallbackUsed: false,
      attempts: [],
      publicClient: null,
    };
    return runtime._rpcSelection;
  }

  const { createPublicClient: createViemPublicClient, http } = await loadViemRuntime(deps);
  const attempts = [];

  for (let index = 0; index < candidateUrls.length; index += 1) {
    const rpcUrl = candidateUrls[index];
    const publicClient = createViemPublicClient({ transport: http(rpcUrl) });
    const chain = await safeGetChainId(publicClient);
    attempts.push({
      order: index + 1,
      rpcUrl,
      ok: Boolean(chain.ok),
      chainId: chain.ok ? Number(chain.value) : null,
      error: chain.ok ? null : chain.error,
    });
    if (chain.ok) {
      runtime.rpcUrl = rpcUrl;
      runtime.selectedRpcUrl = rpcUrl;
      runtime._rpcSelection = {
        source: runtime.rpcSource || null,
        configuredRpcUrl: runtime.configuredRpcUrl || null,
        candidateUrls,
        selectedRpcUrl: rpcUrl,
        fallbackUsed: index > 0,
        attempts,
        publicClient,
      };
      return runtime._rpcSelection;
    }
  }

  runtime.rpcUrl = null;
  runtime.selectedRpcUrl = null;
  runtime._rpcSelection = {
    source: runtime.rpcSource || null,
    configuredRpcUrl: runtime.configuredRpcUrl || null,
    candidateUrls,
    selectedRpcUrl: null,
    fallbackUsed: false,
    attempts,
    publicClient: null,
  };
  return runtime._rpcSelection;
}

async function resolveWriteGasOverrides(chainId, publicClient) {
  if (chainId !== POLYGON_CHAIN_ID || !publicClient) {
    return {};
  }
  let networkGasPrice = null;
  try {
    networkGasPrice = await publicClient.getGasPrice();
  } catch {
    networkGasPrice = null;
  }
  const normalizedNetworkGasPrice =
    typeof networkGasPrice === 'bigint' && networkGasPrice > 0n ? networkGasPrice : null;
  const baseFee = normalizedNetworkGasPrice !== null && normalizedNetworkGasPrice > POLYGON_MIN_GAS_PRICE_WEI
    ? normalizedNetworkGasPrice
    : POLYGON_MIN_GAS_PRICE_WEI;
  return {
    maxPriorityFeePerGas: baseFee,
    maxFeePerGas: baseFee * POLYGON_GAS_PRICE_MULTIPLIER_NUM,
  };
}

async function safeReadContract(publicClient, params) {
  if (!publicClient) return { ok: false, value: null, error: 'RPC client not initialized.' };
  try {
    const value = await publicClient.readContract(params);
    return { ok: true, value, error: null };
  } catch (err) {
    return { ok: false, value: null, error: coerceErrorMessage(err) };
  }
}

async function safeGetBytecode(publicClient, address) {
  if (!publicClient || !address) return { ok: false, value: null, error: 'RPC client/address unavailable.' };
  try {
    const value = await publicClient.getBytecode({ address });
    return { ok: true, value: value || '0x', error: null };
  } catch (err) {
    return { ok: false, value: null, error: coerceErrorMessage(err) };
  }
}

async function safeGetChainId(publicClient) {
  if (!publicClient) return { ok: false, value: null, error: 'RPC client not initialized.' };
  try {
    const value = await publicClient.getChainId();
    return { ok: true, value, error: null };
  } catch (err) {
    return { ok: false, value: null, error: coerceErrorMessage(err) };
  }
}

function computeApprovalDiff(input = {}) {
  const ownerAddress = normalizeAddress(input.ownerAddress, 'ownerAddress');
  const spenders = Array.isArray(input.spenders) ? input.spenders : POLYMARKET_POLYGON_DEFAULTS.spenders;
  const allowanceTargetRaw = toBigIntOrNull(input.allowanceTargetRaw) || MAX_UINT256;
  const allowanceSufficientFloorRaw = toBigIntOrNull(input.allowanceSufficientFloorRaw) || DEFAULT_ALLOWANCE_SUFFICIENT_FLOOR_RAW;
  const allowanceRequiredForReadyRaw =
    allowanceTargetRaw > allowanceSufficientFloorRaw ? allowanceSufficientFloorRaw : allowanceTargetRaw;
  const allowanceBySpender = input.allowanceBySpender && typeof input.allowanceBySpender === 'object'
    ? input.allowanceBySpender
    : {};
  const operatorApprovalBySpender = input.operatorApprovalBySpender && typeof input.operatorApprovalBySpender === 'object'
    ? input.operatorApprovalBySpender
    : {};

  const checks = [];

  for (const spender of spenders) {
    const rawValue = allowanceBySpender[spender.key];
    const parsed = toBigIntOrNull(rawValue && rawValue.value !== undefined ? rawValue.value : rawValue);
    const readOk = Boolean(rawValue && typeof rawValue === 'object' && Object.prototype.hasOwnProperty.call(rawValue, 'ok'))
      ? Boolean(rawValue.ok)
      : parsed !== null;
    checks.push({
      type: 'erc20_allowance',
      key: `allowance:${spender.key}`,
      spenderKey: spender.key,
      label: `USDC.e allowance -> ${spender.label}`,
      ownerAddress,
      spender: spender.address,
      requiredRaw: allowanceTargetRaw.toString(),
      requiredForReadyRaw: allowanceRequiredForReadyRaw.toString(),
      currentRaw: parsed === null ? null : parsed.toString(),
      readOk,
      missing: !readOk || parsed === null || parsed < allowanceRequiredForReadyRaw,
      error: rawValue && rawValue.error ? rawValue.error : null,
    });
  }

  for (const spender of spenders) {
    const current = operatorApprovalBySpender[spender.key];
    const value = current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, 'value')
      ? current.value
      : current;
    const readOk = Boolean(current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, 'ok'))
      ? Boolean(current.ok)
      : typeof value === 'boolean';
    checks.push({
      type: 'ctf_operator',
      key: `operator:${spender.key}`,
      spenderKey: spender.key,
      label: `CTF setApprovalForAll -> ${spender.label}`,
      ownerAddress,
      spender: spender.address,
      required: true,
      current: typeof value === 'boolean' ? value : null,
      readOk,
      missing: !readOk || value !== true,
      error: current && current.error ? current.error : null,
    });
  }

  const missingChecks = checks.filter((item) => item.missing);
  return {
    targetAllowanceRaw: allowanceTargetRaw.toString(),
    allowanceSufficientFloorRaw: allowanceSufficientFloorRaw.toString(),
    allowanceRequiredForReadyRaw: allowanceRequiredForReadyRaw.toString(),
    checks,
    missingChecks,
    missingCount: missingChecks.length,
    allSatisfied: missingChecks.length === 0,
  };
}

async function collectOnchainState(runtime, signerAddress, deps = {}) {
  const rpcSelection = await ensureRpcSelection(runtime, deps);
  const publicClient = rpcSelection.publicClient;
  const ownerAddress = runtime.funderAddress || signerAddress || null;
  const selectedAttempt = Array.isArray(rpcSelection.attempts)
    ? rpcSelection.attempts.find((item) => item.ok && item.rpcUrl === rpcSelection.selectedRpcUrl)
    : null;
  const chain =
    selectedAttempt && selectedAttempt.chainId !== null
      ? { ok: true, value: selectedAttempt.chainId, error: null }
      : await safeGetChainId(publicClient);
  const funderCode = runtime.funderAddress
    ? await safeGetBytecode(publicClient, runtime.funderAddress)
    : { ok: false, value: null, error: null };

  let funderOwnerCheck = { ok: false, value: null, error: null };
  if (runtime.funderAddress && signerAddress && safeCodeToBoolean(funderCode.value)) {
    funderOwnerCheck = await safeReadContract(publicClient, {
      address: runtime.funderAddress,
      abi: SAFE_OWNER_ABI,
      functionName: 'isOwner',
      args: [signerAddress],
    });
  }

  const usdcBalance = ownerAddress
    ? await safeReadContract(publicClient, {
        address: runtime.usdcAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [ownerAddress],
      })
    : { ok: false, value: null, error: 'Owner address unavailable.' };

  const allowanceBySpender = {};
  const operatorApprovalBySpender = {};

  for (const spender of runtime.spenders) {
    allowanceBySpender[spender.key] = ownerAddress
      ? await safeReadContract(publicClient, {
          address: runtime.usdcAddress,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [ownerAddress, spender.address],
        })
      : { ok: false, value: null, error: 'Owner address unavailable.' };

    operatorApprovalBySpender[spender.key] = ownerAddress
      ? await safeReadContract(publicClient, {
          address: runtime.ctfAddress,
          abi: CTF_ABI,
          functionName: 'isApprovedForAll',
          args: [ownerAddress, spender.address],
        })
      : { ok: false, value: null, error: 'Owner address unavailable.' };
  }

  return {
    ownerAddress,
    rpcSelection,
    chain,
    funderCode,
    funderOwnerCheck,
    usdcBalance,
    allowanceBySpender,
    operatorApprovalBySpender,
  };
}

async function runApiKeySanity(runtime, signerAddress, deps = {}, strict = false) {
  if (runtime.skipApiSanity) {
    return {
      attempted: false,
      ok: false,
      status: 'skipped',
      reason: 'API sanity disabled by POLYMARKET_SKIP_API_KEY_SANITY.',
    };
  }

  if (!runtime.privateKey || !signerAddress) {
    return {
      attempted: false,
      ok: false,
      status: 'missing_private_key',
      reason: 'Missing private key for API-key sanity check.',
    };
  }

  if (!runtime.funderAddress && strict) {
    return {
      attempted: false,
      ok: false,
      status: 'missing_funder',
      reason: 'Missing funder/proxy address for live signature mode.',
    };
  }

  if (runtime.apiKey && runtime.apiSecret && runtime.apiPassphrase) {
    return {
      attempted: false,
      ok: true,
      status: 'provided',
      reason: 'Static API credentials provided.',
    };
  }

  let Wallet;
  try {
    ({ Wallet } = loadEthersWalletModule(
      typeof deps.loadWalletModule === 'function' ? deps.loadWalletModule : require,
    ));
  } catch (err) {
    return {
      attempted: false,
      ok: false,
      status: 'dependency_error',
      code: err && err.code ? err.code : 'POLYMARKET_WALLET_DEPENDENCY_MISSING',
      reason: err && err.message ? err.message : `Unable to load @ethersproject/wallet: ${coerceErrorMessage(err)}`,
      remediation:
        err && err.details && err.details.remediation
          ? err.details.remediation
          : 'Reinstall pandora-cli-skills and verify @ethersproject/wallet is present before retrying live Polymarket execution.',
    };
  }

  const signatureType = runtime.funderAddress ? POLYMARKET_SIG_TYPE_PROXY : POLYMARKET_SIG_TYPE_EOA;

  try {
    const signer = new Wallet(runtime.privateKey);
    const bootstrap = new ClobClient(
      runtime.host,
      Chain.POLYGON,
      signer,
      undefined,
      signatureType,
      runtime.funderAddress || undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );

    let creds = null;
    if (typeof bootstrap.deriveApiKey === 'function') {
      try {
        // deriveApiKey expects nonce, not signature type; use nonce 0.
        creds = await bootstrap.deriveApiKey(0);
      } catch {
        creds = await bootstrap.deriveApiKey();
      }
    } else if (typeof bootstrap.createOrDeriveApiKey === 'function') {
      creds = await bootstrap.createOrDeriveApiKey();
    } else {
      return {
        attempted: true,
        ok: false,
        status: 'unsupported_client',
        reason: 'CLOB client does not expose deriveApiKey/createOrDeriveApiKey.',
      };
    }

    return {
      attempted: true,
      ok: Boolean(creds && creds.key && creds.secret && creds.passphrase),
      status: 'derived',
      hasKey: Boolean(creds && creds.key),
      hasSecret: Boolean(creds && creds.secret),
      hasPassphrase: Boolean(creds && creds.passphrase),
    };
  } catch (err) {
    return {
      attempted: true,
      ok: false,
      status: 'failed',
      reason: coerceErrorMessage(err),
    };
  }
}

function evaluateOwnership(runtime, signerAddress, onchainState) {
  const funderAddress = runtime.funderAddress || null;
  const signerMatchesFunder = Boolean(signerAddress && funderAddress && signerAddress === funderAddress);
  const funderCodePresent = safeCodeToBoolean(onchainState.funderCode && onchainState.funderCode.value);
  const safeOwner = Boolean(onchainState.funderOwnerCheck && onchainState.funderOwnerCheck.value === true);
  const ok = Boolean(
    funderAddress &&
      signerAddress &&
      (signerMatchesFunder || (funderCodePresent && safeOwner)),
  );

  return {
    ok,
    funderAddress,
    signerAddress: signerAddress || null,
    signerMatchesFunder,
    funderCodePresent: funderAddress ? funderCodePresent : null,
    safeOwnerCheckAttempted: Boolean(funderAddress && signerAddress && funderCodePresent),
    safeOwner,
    ownerCheckError:
      onchainState.funderOwnerCheck && !onchainState.funderOwnerCheck.ok && onchainState.funderOwnerCheck.error
        ? onchainState.funderOwnerCheck.error
        : null,
  };
}

function buildRpcSelectionPayload(runtime, onchainState) {
  const selection =
    onchainState && onchainState.rpcSelection && typeof onchainState.rpcSelection === 'object'
      ? onchainState.rpcSelection
      : runtime && runtime._rpcSelection && typeof runtime._rpcSelection === 'object'
        ? runtime._rpcSelection
        : {};
  const attempts = Array.isArray(selection.attempts)
    ? selection.attempts.map((entry) => ({
        order: entry.order,
        rpcUrl: entry.rpcUrl,
        ok: Boolean(entry.ok),
        chainId: entry.chainId === null || entry.chainId === undefined ? null : Number(entry.chainId),
        error: entry.error || null,
      }))
    : [];
  const candidateUrls = Array.isArray(selection.candidateUrls)
    ? selection.candidateUrls.slice()
    : Array.isArray(runtime.rpcCandidates)
      ? runtime.rpcCandidates.slice()
      : [];
  const selectedRpcUrl = selection.selectedRpcUrl || runtime.selectedRpcUrl || null;

  return {
    source: selection.source || runtime.rpcSource || null,
    configuredRpcUrl: selection.configuredRpcUrl || runtime.configuredRpcUrl || null,
    candidateUrls,
    selectedRpcUrl: selectedRpcUrl || null,
    fallbackUsed: Boolean(selectedRpcUrl && candidateUrls.indexOf(selectedRpcUrl) > 0),
    attempts,
  };
}

function buildCheckPayload(runtime, signerAddress, onchainState, approvalDiff, apiSanity) {
  const ownership = evaluateOwnership(runtime, signerAddress, onchainState);
  const chainId = onchainState.chain && onchainState.chain.ok ? onchainState.chain.value : null;
  const rpcOk = Boolean(onchainState.chain && onchainState.chain.ok);
  const usdcBalanceRaw = toBigIntOrNull(onchainState.usdcBalance && onchainState.usdcBalance.value);
  const rpcSelection = buildRpcSelectionPayload(runtime, onchainState);
  const unhealthyRpcAttempts = rpcSelection.attempts.filter((entry) => !entry.ok);

  const readyForLive =
    rpcOk &&
    chainId === POLYGON_CHAIN_ID &&
    ownership.ok &&
    usdcBalanceRaw !== null &&
    usdcBalanceRaw > 0n &&
    approvalDiff.allSatisfied &&
    apiSanity.ok;

  return {
    schemaVersion: POLYMARKET_OPS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    chainId,
    chainOk: rpcOk,
    chainExpected: POLYGON_CHAIN_ID,
    readyForLive,
    runtime: {
      rpcUrl: rpcSelection.selectedRpcUrl,
      configuredRpcUrl: rpcSelection.configuredRpcUrl,
      rpcSource: rpcSelection.source,
      host: runtime.host,
      signerAddress: signerAddress || null,
      funderAddress: runtime.funderAddress || null,
      ownerAddress: onchainState.ownerAddress || null,
      usdcAddress: runtime.usdcAddress,
      ctfAddress: runtime.ctfAddress,
      spenders: runtime.spenders,
    },
    rpcSelection,
    ownership,
    balances: {
      usdc: {
        readOk: Boolean(onchainState.usdcBalance && onchainState.usdcBalance.ok),
        raw: usdcBalanceRaw === null ? null : usdcBalanceRaw.toString(),
        formatted: formatUnits6(usdcBalanceRaw),
        error: onchainState.usdcBalance && onchainState.usdcBalance.error ? onchainState.usdcBalance.error : null,
      },
    },
    approvals: approvalDiff,
    apiKeySanity: apiSanity,
    diagnostics: [
      rpcSelection.fallbackUsed
        ? `RPC fallback used ${rpcSelection.selectedRpcUrl} after ${unhealthyRpcAttempts.length} failed endpoint(s).`
        : null,
      !rpcOk && unhealthyRpcAttempts.length > 0
        ? `RPC check failed across ${unhealthyRpcAttempts.length} configured endpoint(s).`
        : null,
      !rpcOk && onchainState.chain && onchainState.chain.error ? `RPC check failed: ${onchainState.chain.error}` : null,
      chainId !== null && chainId !== POLYGON_CHAIN_ID
        ? `Connected chainId ${chainId}; expected Polygon ${POLYGON_CHAIN_ID}.`
        : null,
      !runtime.funderAddress ? 'POLYMARKET_FUNDER is not configured.' : null,
      !signerAddress ? 'Private key is not configured; signer identity unavailable.' : null,
      !ownership.ok ? 'Signer/funder ownership relation is not verified.' : null,
      usdcBalanceRaw === null ? 'Unable to read USDC.e balance for owner wallet.' : null,
      usdcBalanceRaw !== null && usdcBalanceRaw <= 0n ? 'USDC.e balance is zero.' : null,
      approvalDiff.missingCount > 0 ? `${approvalDiff.missingCount} approval checks are missing.` : null,
      !apiSanity.ok ? `API-key sanity status: ${apiSanity.status}.` : null,
    ].filter(Boolean),
  };
}

async function runPolymarketCheck(options = {}, deps = {}) {
  const runtime = resolveRuntime(options);
  const signerAddress = await deriveSignerAddress(runtime, deps);
  const onchainState = await collectOnchainState(runtime, signerAddress, deps);
  const approvalDiff = computeApprovalDiff({
    ownerAddress: onchainState.ownerAddress,
    spenders: runtime.spenders,
    allowanceTargetRaw: runtime.allowanceTargetRaw,
    allowanceBySpender: onchainState.allowanceBySpender,
    operatorApprovalBySpender: onchainState.operatorApprovalBySpender,
  });
  const apiSanity = await runApiKeySanity(runtime, signerAddress, deps, false);
  return buildCheckPayload(runtime, signerAddress, onchainState, approvalDiff, apiSanity);
}

function buildApproveTxPlan(checkPayload) {
  const runtime = checkPayload.runtime || {};
  const missing = checkPayload.approvals && Array.isArray(checkPayload.approvals.missingChecks)
    ? checkPayload.approvals.missingChecks
    : [];
  const targetAllowanceRaw = checkPayload.approvals ? checkPayload.approvals.targetAllowanceRaw : MAX_UINT256.toString();

  return missing.map((entry) => {
    if (entry.type === 'erc20_allowance') {
      return {
        key: entry.key,
        type: entry.type,
        ownerAddress: runtime.ownerAddress || null,
        contractAddress: runtime.usdcAddress || null,
        spender: entry.spender,
        functionName: 'approve',
        args: [entry.spender, targetAllowanceRaw],
      };
    }

    return {
      key: entry.key,
      type: entry.type,
      ownerAddress: runtime.ownerAddress || null,
      contractAddress: runtime.ctfAddress || null,
      spender: entry.spender,
      functionName: 'setApprovalForAll',
      args: [entry.spender, true],
    };
  });
}

async function executeApprovePlan(runtime, signerAddress, txPlan, deps = {}) {
  const walletClient = await createWalletClient(runtime, signerAddress, deps);
  const publicClient = await createPublicClient(runtime, deps);
  if (!walletClient || !publicClient) {
    throw createServiceError('RPC_CLIENT_UNAVAILABLE', 'Unable to initialize wallet/public clients for execute mode.');
  }

  const chainIdResult = await safeGetChainId(publicClient);
  const chainId = chainIdResult.ok ? Number(chainIdResult.value) : null;
  const gasOverrides = await resolveWriteGasOverrides(chainId, publicClient);

  const receipts = [];
  for (const step of txPlan) {
    let hash;
    if (step.type === 'erc20_allowance') {
      hash = await walletClient.writeContract({
        address: runtime.usdcAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [step.spender, runtime.allowanceTargetRaw],
        ...gasOverrides,
      });
    } else {
      hash = await walletClient.writeContract({
        address: runtime.ctfAddress,
        abi: CTF_ABI,
        functionName: 'setApprovalForAll',
        args: [step.spender, true],
        ...gasOverrides,
      });
    }

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    receipts.push({
      key: step.key,
      type: step.type,
      spender: step.spender,
      txHash: hash,
      status: receipt && receipt.status ? receipt.status : null,
      blockNumber:
        receipt && receipt.blockNumber !== undefined && receipt.blockNumber !== null
          ? receipt.blockNumber.toString()
          : null,
    });
  }

  return receipts;
}

async function runPolymarketApprove(options = {}, deps = {}) {
  const execute = options.execute === true;
  const dryRun = options.dryRun === true || !execute;
  const runtime = resolveRuntime(options);
  const checkPayload = await runPolymarketCheck({ ...options, skipApiSanity: true }, deps);
  const txPlan = buildApproveTxPlan(checkPayload);

  const signerAddress = checkPayload.runtime ? checkPayload.runtime.signerAddress : null;
  const ownerAddress = checkPayload.runtime ? checkPayload.runtime.ownerAddress : null;
  const signerMatchesOwner = Boolean(signerAddress && ownerAddress && signerAddress === ownerAddress);
  const manualProxyActionRequired = Boolean(ownerAddress && signerAddress && ownerAddress !== signerAddress);

  if (execute && !signerAddress) {
    throw createServiceError(
      'MISSING_REQUIRED_INPUT',
      'Execute mode requires a signer private key (POLYMARKET_PRIVATE_KEY or --private-key).',
      { signerAddress, ownerAddress },
    );
  }
  if (execute && !ownerAddress) {
    throw createServiceError(
      'MISSING_REQUIRED_INPUT',
      'Unable to resolve owner wallet for approval transactions. Provide --funder or a signer private key.',
      { signerAddress, ownerAddress },
    );
  }
  if (execute && !signerMatchesOwner) {
    throw createServiceError(
      'POLYMARKET_PROXY_APPROVAL_REQUIRES_MANUAL_EXECUTION',
      'Signer and funder addresses differ. Execute mode cannot submit proxy/Safe approvals directly.',
      {
        signerAddress,
        ownerAddress,
        hint: 'Use --dry-run output and execute equivalent approvals from the proxy wallet (Safe/UI).',
      },
    );
  }

  let txReceipts = [];
  if (execute && txPlan.length > 0) {
    txReceipts = await executeApprovePlan(runtime, signerAddress, txPlan, deps);
  }

  return {
    schemaVersion: POLYMARKET_OPS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: execute ? 'execute' : 'dry-run',
    runtime: checkPayload.runtime,
    signerMatchesOwner,
    manualProxyActionRequired,
    approvalSummary: {
      missingCount: checkPayload.approvals.missingCount,
      allSatisfied: checkPayload.approvals.allSatisfied,
      checks: checkPayload.approvals.checks,
    },
    txPlan,
    txReceipts,
    executedCount: txReceipts.length,
    status: execute
      ? txReceipts.length > 0
        ? 'submitted'
        : 'noop'
      : 'planned',
    check: checkPayload,
    dryRun,
  };
}

function buildPreflightChecks(checkPayload) {
  const checks = [];
  const runtime = checkPayload.runtime || {};
  const rpcSelection = checkPayload.rpcSelection || {};
  const ownership = checkPayload.ownership || {};
  const usdcRaw = toBigIntOrNull(checkPayload.balances && checkPayload.balances.usdc && checkPayload.balances.usdc.raw);
  const apiSanity = checkPayload.apiKeySanity || {};

  checks.push({
    code: 'RPC_CONNECTED',
    ok: Boolean(checkPayload.chainOk),
    message: 'RPC endpoint must be reachable.',
    details: {
      rpcUrl: runtime.rpcUrl || null,
      configuredRpcUrl: rpcSelection.configuredRpcUrl || runtime.configuredRpcUrl || null,
      source: rpcSelection.source || runtime.rpcSource || null,
      candidateUrls: Array.isArray(rpcSelection.candidateUrls) ? rpcSelection.candidateUrls : [],
      attempts: Array.isArray(rpcSelection.attempts) ? rpcSelection.attempts : [],
    },
  });
  checks.push({
    code: 'POLYGON_CHAIN',
    ok: checkPayload.chainId === POLYGON_CHAIN_ID,
    message: 'RPC endpoint must be Polygon mainnet.',
    details: { chainId: checkPayload.chainId, expected: POLYGON_CHAIN_ID },
  });
  checks.push({
    code: 'FUNDER_PRESENT',
    ok: Boolean(runtime.funderAddress),
    message: 'POLYMARKET_FUNDER (proxy wallet) must be configured.',
    details: { funderAddress: runtime.funderAddress || null },
  });
  checks.push({
    code: 'SIGNER_PRESENT',
    ok: Boolean(runtime.signerAddress),
    message: 'Signer private key must be configured.',
    details: { signerAddress: runtime.signerAddress || null },
  });
  checks.push({
    code: 'PROXY_OWNERSHIP',
    ok: Boolean(ownership.ok),
    message: 'Signer must match funder or be a Safe owner of the funder wallet.',
    details: ownership,
  });
  checks.push({
    code: 'USDC_BALANCE',
    ok: usdcRaw !== null && usdcRaw > 0n,
    message: 'Owner wallet must hold Polygon USDC.e collateral.',
    details: { raw: usdcRaw === null ? null : usdcRaw.toString(), formatted: formatUnits6(usdcRaw) },
  });
  checks.push({
    code: 'APPROVALS_READY',
    ok: Boolean(checkPayload.approvals && checkPayload.approvals.allSatisfied),
    message: 'All ERC20 allowances and CTF operator approvals must be configured.',
    details: {
      missingCount: checkPayload.approvals ? checkPayload.approvals.missingCount : null,
      missingKeys:
        checkPayload.approvals && Array.isArray(checkPayload.approvals.missingChecks)
          ? checkPayload.approvals.missingChecks.map((item) => item.key)
          : [],
    },
  });
  checks.push({
    code: 'API_KEY_SANITY',
    ok: Boolean(apiSanity.ok),
    message: 'Polymarket API credentials must be usable (provided or derivable).',
    details: apiSanity,
  });

  return checks;
}

async function resolvePreflightTradeContext(options = {}, checkPayload = {}, deps = {}) {
  const tradeContextRequested = Boolean(
    options.tradeContextRequested
    || options.tokenId
    || options.token
    || options.conditionId
    || options.slug
    || Number.isFinite(Number(options.amountUsdc)),
  );
  if (!tradeContextRequested) return null;

  const resolveMarket = typeof deps.resolvePolymarketMarket === 'function'
    ? deps.resolvePolymarketMarket
    : resolvePolymarketMarket;
  const amountUsdc = Number.isFinite(Number(options.amountUsdc)) ? Number(options.amountUsdc) : null;
  const amountRaw = amountUsdc === null ? null : decimalUsdcToRaw(amountUsdc);
  const requestedToken = typeof options.token === 'string' ? String(options.token).trim().toLowerCase() : null;
  const requestedSide = typeof options.side === 'string' ? String(options.side).trim().toLowerCase() : 'buy';
  let market = null;
  let marketError = null;
  let resolvedTokenId = options.tokenId || null;

  if (!resolvedTokenId && (options.conditionId || options.slug)) {
    try {
      market = await resolveMarket({
        host: options.host || process.env.POLYMARKET_HOST || null,
        timeoutMs: options.timeoutMs,
        marketId: options.conditionId,
        slug: options.slug,
      });
    } catch (error) {
      marketError = coerceErrorMessage(error);
    }
  }

  if (!resolvedTokenId && market && requestedToken) {
    resolvedTokenId = requestedToken === 'yes' ? market.yesTokenId || null : market.noTokenId || null;
  }

  const ownerUsdcRaw = toBigIntOrNull(checkPayload && checkPayload.balances && checkPayload.balances.usdc && checkPayload.balances.usdc.raw);
  return {
    requested: {
      conditionId: options.conditionId || null,
      slug: options.slug || null,
      token: requestedToken,
      tokenId: options.tokenId || null,
      side: requestedSide,
      amountUsdc,
      amountRaw: amountRaw === null ? null : amountRaw.toString(),
      host: options.host || null,
      timeoutMs: Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : null,
    },
    resolved: {
      tokenId: resolvedTokenId,
      marketId: market && market.marketId ? market.marketId : options.conditionId || null,
      slug: market && market.slug ? market.slug : options.slug || null,
      question: market && market.question ? market.question : null,
      yesTokenId: market && market.yesTokenId ? market.yesTokenId : null,
      noTokenId: market && market.noTokenId ? market.noTokenId : null,
      ownerUsdcRaw: ownerUsdcRaw === null ? null : ownerUsdcRaw.toString(),
      ownerUsdc: formatUnits6(ownerUsdcRaw),
    },
    diagnostics: marketError ? [`Market resolution failed: ${marketError}`] : [],
    checks: [
      {
        code: 'TRADE_MARKET_RESOLVED',
        ok: Boolean(options.tokenId || market),
        message: 'Trade target market must resolve when token-id is not provided.',
        details: {
          conditionId: options.conditionId || null,
          slug: options.slug || null,
          host: options.host || null,
          error: marketError,
        },
      },
      {
        code: 'TRADE_TOKEN_RESOLVED',
        ok: Boolean(resolvedTokenId),
        message: 'Trade token id must be derivable from token selection or provided directly.',
        details: {
          requestedToken,
          requestedTokenId: options.tokenId || null,
          resolvedTokenId,
        },
      },
      {
        code: 'TRADE_NOTIONAL_COVERED',
        ok: amountRaw !== null && ownerUsdcRaw !== null ? ownerUsdcRaw >= amountRaw : false,
        message: 'Owner wallet must hold enough Polygon USDC.e for the requested trade amount.',
        details: {
          requestedAmountUsdc: amountUsdc,
          requestedAmountRaw: amountRaw === null ? null : amountRaw.toString(),
          ownerUsdcRaw: ownerUsdcRaw === null ? null : ownerUsdcRaw.toString(),
          ownerUsdc: formatUnits6(ownerUsdcRaw),
        },
      },
    ],
  };
}

async function runPolymarketPreflight(options = {}, deps = {}) {
  const checkPayload = await runPolymarketCheck(options, deps);
  const trade = await resolvePreflightTradeContext(options, checkPayload, deps);
  const checks = buildPreflightChecks(checkPayload).concat(trade && Array.isArray(trade.checks) ? trade.checks : []);
  const failedChecks = checks.filter((item) => !item.ok).map((item) => item.code);
  const payload = {
    schemaVersion: POLYMARKET_OPS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ok: failedChecks.length === 0,
    failedChecks,
    checks,
    check: checkPayload,
    trade,
  };

  if (!payload.ok) {
    throw createServiceError(
      'POLYMARKET_PREFLIGHT_FAILED',
      'Polymarket live-trading preflight failed.',
      payload,
    );
  }

  return payload;
}

async function runPolymarketBalance(options = {}, deps = {}) {
  const runtime = resolveRuntime(options);
  const signerAddress = await deriveSignerAddress(runtime, deps);
  const rpcSelection = await ensureRpcSelection(runtime, deps);
  const publicClient = rpcSelection.publicClient;
  const requestedWallet = normalizeAddress(options.wallet, 'wallet');
  const ownerAddress = requestedWallet || runtime.funderAddress || signerAddress || null;
  const roleEntries = requestedWallet
    ? [{ role: 'wallet', address: requestedWallet }]
    : [
        { role: 'signer', address: signerAddress || null },
        { role: 'funder', address: runtime.funderAddress || null },
        { role: 'owner', address: ownerAddress || null },
      ];

  const balances = {};
  const diagnostics = [];
  for (const entry of roleEntries) {
    if (!entry.address) {
      balances[entry.role] = buildUsdcBalanceSnapshot(null, {
        ok: false,
        value: null,
        error: 'Address unavailable.',
      });
      continue;
    }
    balances[entry.role] = await readUsdcBalanceSnapshot(publicClient, runtime.usdcAddress, entry.address);
  }

  if (!rpcSelection.selectedRpcUrl) {
    diagnostics.push('RPC URL is not configured; balance reads may be unavailable.');
  }
  if (!requestedWallet && !runtime.funderAddress) {
    diagnostics.push('POLYMARKET_FUNDER is not configured; funder balance is unavailable.');
  }
  if (!requestedWallet && !signerAddress) {
    diagnostics.push('Signer private key is not configured; signer balance is unavailable.');
  }
  if (!ownerAddress) {
    diagnostics.push('No wallet address was resolved for Polymarket balance checks.');
  }
  diagnostics.push(...buildPolymarketBalanceGuidance({
    requestedWallet,
    ownerAddress,
    signerAddress,
    funderAddress: runtime.funderAddress || null,
    balances,
  }));

  return {
    schemaVersion: POLYMARKET_OPS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: 'read',
    status: 'ready',
    action: 'balance',
    runtime: {
      rpcUrl: rpcSelection.selectedRpcUrl || runtime.configuredRpcUrl || null,
      configuredRpcUrl: runtime.configuredRpcUrl || null,
      rpcSource: rpcSelection.source || runtime.rpcSource || null,
      host: runtime.host,
      signerAddress: signerAddress || null,
      funderAddress: runtime.funderAddress || null,
      ownerAddress,
      usdcAddress: runtime.usdcAddress,
    },
    rpcSelection: buildRpcSelectionPayload(runtime, { rpcSelection }),
    requestedWallet: requestedWallet || null,
    balanceScope: buildPolymarketBalanceScope({
      requestedWallet,
      ownerAddress,
      signerAddress,
      funderAddress: runtime.funderAddress || null,
    }),
    balances,
    diagnostics: dedupeList(diagnostics),
  };
}

function resolvePositionTokenSelection(options = {}, market = null) {
  const diagnostics = [];
  const explicitMap =
    options.tokenIds && typeof options.tokenIds === 'object' && !Array.isArray(options.tokenIds)
      ? options.tokenIds
      : {};
  const explicitArray = Array.isArray(options.tokenIds)
    ? options.tokenIds.map((value) => normalizeTokenId(value)).filter(Boolean)
    : [];
  let yesTokenId =
    normalizeTokenId(options.yesTokenId)
    || normalizeTokenId(explicitMap.yes)
    || null;
  let noTokenId =
    normalizeTokenId(options.noTokenId)
    || normalizeTokenId(explicitMap.no)
    || null;
  const marketYesTokenId = normalizeTokenId(market && market.yesTokenId);
  const marketNoTokenId = normalizeTokenId(market && market.noTokenId);
  const singleTokenId = normalizeTokenId(options.tokenId);

  if (!yesTokenId && explicitArray[0]) {
    yesTokenId = explicitArray[0];
  }
  if (!noTokenId && explicitArray[1]) {
    noTokenId = explicitArray[1];
  }
  if (explicitArray.length >= 2) {
    diagnostics.push('Explicit tokenIds array was interpreted as [YES, NO].');
  }

  if (singleTokenId && !yesTokenId && !noTokenId) {
    if (marketYesTokenId && singleTokenId === marketYesTokenId) {
      yesTokenId = singleTokenId;
    } else if (marketNoTokenId && singleTokenId === marketNoTokenId) {
      noTokenId = singleTokenId;
    } else if (!marketYesTokenId && !marketNoTokenId) {
      diagnostics.push('Single tokenId provided without YES/NO mapping; balances will remain partially scoped.');
      yesTokenId = singleTokenId;
    } else {
      diagnostics.push('Explicit tokenId did not match resolved market YES/NO token ids.');
    }
  }

  if (!yesTokenId && marketYesTokenId) {
    yesTokenId = marketYesTokenId;
  }
  if (!noTokenId && marketNoTokenId) {
    noTokenId = marketNoTokenId;
  }

  return {
    yesTokenId,
    noTokenId,
    diagnostics,
  };
}

async function runPolymarketPositions(options = {}, deps = {}) {
  const runtime = resolveRuntime(options);
  const signerAddress = await deriveSignerAddress(runtime, deps);
  const rpcSelection = await ensureRpcSelection(runtime, deps);
  const publicClient = rpcSelection.publicClient;
  const requestedWallet = normalizeAddress(
    options.wallet !== undefined ? options.wallet : options.walletAddress || options.ownerAddress,
    'wallet',
  );
  const sourceRequested = normalizePositionSource(options.source);
  const apiWalletAddress = runtime.funderAddress || signerAddress || null;
  const ownerAddress = requestedWallet || apiWalletAddress || null;
  const marketId = normalizeTokenId(options.marketId || options.conditionId);
  const slug = normalizeTokenId(options.slug);
  const diagnostics = [];
  const providedMarket = options.market && typeof options.market === 'object' ? options.market : null;

  const hasTokenSelector = Boolean(
    normalizeTokenId(options.yesTokenId)
      || normalizeTokenId(options.noTokenId)
      || normalizeTokenId(options.tokenId)
      || (Array.isArray(options.tokenIds) && options.tokenIds.some((value) => normalizeTokenId(value)))
      || (options.tokenIds && typeof options.tokenIds === 'object' && !Array.isArray(options.tokenIds)
        && (normalizeTokenId(options.tokenIds.yes) || normalizeTokenId(options.tokenIds.no))),
  );
  const hasProvidedMarketSelector = Boolean(
    providedMarket
      && (normalizeTokenId(providedMarket.marketId || providedMarket.conditionId) || normalizeTokenId(providedMarket.slug)),
  );
  if (!marketId && !slug && !hasTokenSelector && !hasProvidedMarketSelector && !ownerAddress) {
    throw createServiceError(
      'MISSING_REQUIRED_INPUT',
      'Polymarket positions requires a wallet context or a market/token selector.',
      {
        supportedSelectors: ['wallet', 'marketId', 'slug', 'yesTokenId', 'noTokenId', 'tokenId'],
      },
    );
  }
  if (sourceRequested === 'on-chain' && !marketId && !slug && !hasTokenSelector && !hasProvidedMarketSelector) {
    throw createServiceError(
      'MISSING_REQUIRED_INPUT',
      'On-chain Polymarket positions lookup requires --market-id/--slug or explicit token ids.',
      {
        supportedSelectors: ['marketId', 'slug', 'yesTokenId', 'noTokenId', 'tokenId'],
      },
    );
  }

  let market = providedMarket;
  if (!market && (marketId || slug)) {
    try {
      market = await resolvePolymarketMarket({
        host: options.host || runtime.host,
        mockUrl: options.polymarketMockUrl || options.mockUrl || null,
        timeoutMs: Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 12_000,
        marketId,
        slug,
      });
    } catch (err) {
      if (!hasTokenSelector) {
        throw createServiceError(
          'POLYMARKET_MARKET_RESOLUTION_FAILED',
          'Unable to resolve Polymarket market details for positions lookup.',
          {
            marketId,
            slug,
            cause: coerceErrorMessage(err),
          },
        );
      }
      diagnostics.push(`Market resolution failed; continuing with explicit token ids: ${coerceErrorMessage(err)}`);
      market = null;
    }
  }

  const tokenSelection = resolvePositionTokenSelection(options, market);
  diagnostics.push(...tokenSelection.diagnostics);

  const inventory = await fetchPolymarketPositionInventory({
    source: sourceRequested,
    market,
    marketId: marketId || (market && market.marketId) || null,
    conditionId: marketId || (market && market.marketId) || null,
    slug: slug || (market && market.slug) || null,
    walletAddress: ownerAddress,
    ownerAddress,
    tokenIds: [
      tokenSelection.yesTokenId,
      tokenSelection.noTokenId,
      normalizeTokenId(options.tokenId),
      ...(Array.isArray(options.tokenIds) ? options.tokenIds : []),
    ].filter(Boolean),
    host: options.host || runtime.host,
    gammaUrl: options.gammaUrl || null,
    dataApiUrl: options.dataApiUrl || null,
    mockUrl: options.polymarketMockUrl || options.mockUrl || null,
    timeoutMs: Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 12_000,
    publicClient,
    ctfAddress: runtime.ctfAddress,
    privateKey: runtime.privateKey,
    funder: runtime.funderAddress,
    apiKey: runtime.apiKey,
    apiSecret: runtime.apiSecret,
    apiPassphrase: runtime.apiPassphrase,
    env: options.env || process.env,
  });
  const position = await fetchPolymarketPositionSummary({
    source: sourceRequested,
    market,
    marketId: marketId || (market && market.marketId) || null,
    conditionId: marketId || (market && market.marketId) || null,
    slug: slug || (market && market.slug) || null,
    walletAddress: ownerAddress,
    ownerAddress,
    apiWalletAddress,
    yesTokenId: tokenSelection.yesTokenId,
    noTokenId: tokenSelection.noTokenId,
    host: options.host || runtime.host,
    mockUrl: options.polymarketMockUrl || options.mockUrl || null,
    timeoutMs: Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 12_000,
    publicClient,
    ctfAddress: runtime.ctfAddress,
    privateKey: runtime.privateKey,
    funder: runtime.funderAddress,
    apiKey: runtime.apiKey,
    apiSecret: runtime.apiSecret,
    apiPassphrase: runtime.apiPassphrase,
  });

  const conditionId = position && position.conditionId ? position.conditionId : marketId || (market && market.marketId) || null;
  const marketPayload = {
    marketId: conditionId,
    conditionId,
    slug: (inventory && inventory.market && inventory.market.slug) || (position && position.slug) || (market && market.slug) || slug || null,
    question: (inventory && inventory.market && inventory.market.question) || (market && market.question ? market.question : null),
    url: market && market.url ? market.url : null,
    yesTokenId:
      (inventory && inventory.market && inventory.market.yesTokenId)
      || (position && position.yesTokenId)
      || tokenSelection.yesTokenId,
    noTokenId:
      (inventory && inventory.market && inventory.market.noTokenId)
      || (position && position.noTokenId)
      || tokenSelection.noTokenId,
    yesPrice: position && position.prices ? position.prices.yes : null,
    noPrice: position && position.prices ? position.prices.no : null,
    source: market && market.source ? market.source : null,
  };
  const summary = inventory && inventory.summary && typeof inventory.summary === 'object'
    ? inventory.summary
    : {
        yesBalance: position && position.yesBalance !== undefined ? position.yesBalance : null,
        noBalance: position && position.noBalance !== undefined ? position.noBalance : null,
        openOrdersCount: position && position.openOrdersCount !== undefined ? position.openOrdersCount : null,
        openOrdersNotionalUsd: position && position.openOrdersNotionalUsd !== undefined ? position.openOrdersNotionalUsd : null,
        estimatedValueUsd: position && position.estimatedValueUsd !== undefined ? position.estimatedValueUsd : null,
        positionDeltaApprox: position && position.positionDeltaApprox !== undefined ? position.positionDeltaApprox : null,
        prices: position && position.prices ? cloneJsonCompatible(position.prices) : null,
      };
  const mergeReadiness = buildPolymarketMergeReadiness(summary, {
    ownerAddress,
    signerAddress: signerAddress || null,
    funderAddress: runtime.funderAddress || null,
  });
  const normalizedSummary = {
    ...cloneJsonCompatible(summary),
    mergeablePairs: mergeReadiness.mergeablePairs,
    mergeReadiness: cloneJsonCompatible(mergeReadiness),
  };
  const combinedDiagnostics = dedupeList(
    diagnostics
      .concat(Array.isArray(inventory && inventory.diagnostics) ? inventory.diagnostics : [])
      .concat(Array.isArray(position && position.diagnostics) ? position.diagnostics : [])
      .concat(Array.isArray(mergeReadiness.diagnostics) ? mergeReadiness.diagnostics : []),
  );

  return {
    schemaVersion: POLYMARKET_OPS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: 'read',
    status: 'ready',
    action: 'positions',
    marketId: marketPayload.marketId,
    conditionId: marketPayload.conditionId,
    slug: marketPayload.slug,
    ownerAddress,
    requestedWallet: requestedWallet || null,
    yesTokenId: marketPayload.yesTokenId,
    noTokenId: marketPayload.noTokenId,
    yesBalance: summary.yesBalance !== undefined ? summary.yesBalance : null,
    noBalance: summary.noBalance !== undefined ? summary.noBalance : null,
    openOrdersCount: summary.openOrdersCount !== undefined ? summary.openOrdersCount : null,
    openOrdersNotionalUsd: summary.openOrdersNotionalUsd !== undefined ? summary.openOrdersNotionalUsd : null,
    estimatedValueUsd: summary.estimatedValueUsd !== undefined ? summary.estimatedValueUsd : null,
    positionDeltaApprox: summary.positionDeltaApprox !== undefined ? summary.positionDeltaApprox : null,
    sourceRequested,
    sourceResolved:
      (inventory && inventory.source)
      || (position && position.source ? position.source.resolved : null),
    runtime: {
      rpcUrl: rpcSelection.selectedRpcUrl || runtime.configuredRpcUrl || null,
      configuredRpcUrl: runtime.configuredRpcUrl || null,
      rpcSource: rpcSelection.source || runtime.rpcSource || null,
      host: runtime.host,
      signerAddress: signerAddress || null,
      funderAddress: runtime.funderAddress || null,
      ownerAddress,
      ctfAddress: runtime.ctfAddress,
      usdcAddress: runtime.usdcAddress,
    },
    rpcSelection: buildRpcSelectionPayload(runtime, { rpcSelection }),
    selector: {
      wallet: requestedWallet || null,
      ownerAddress,
      marketId: marketPayload.marketId,
      conditionId: marketPayload.conditionId,
      slug: marketPayload.slug,
      sourceRequested,
      sourceResolved:
        (inventory && inventory.source)
        || (position && position.source ? position.source.resolved : null),
      yesTokenId: marketPayload.yesTokenId,
      noTokenId: marketPayload.noTokenId,
    },
    market: marketPayload,
    summary: normalizedSummary,
    mergeReadiness: cloneJsonCompatible(mergeReadiness),
    positions: inventory && Array.isArray(inventory.positions) ? cloneJsonCompatible(inventory.positions) : [],
    openOrders: inventory && Array.isArray(inventory.openOrders) ? cloneJsonCompatible(inventory.openOrders) : [],
    position: {
      walletAddress: ownerAddress,
      marketId: position && position.marketId ? position.marketId : marketPayload.marketId,
      conditionId: position && position.conditionId ? position.conditionId : marketPayload.conditionId,
      slug: position && position.slug ? position.slug : marketPayload.slug,
      yesTokenId: position && position.yesTokenId ? position.yesTokenId : marketPayload.yesTokenId,
      noTokenId: position && position.noTokenId ? position.noTokenId : marketPayload.noTokenId,
      tokenIds: position && position.tokenIds ? cloneJsonCompatible(position.tokenIds) : null,
      yesBalance: position && position.yesBalance !== undefined ? position.yesBalance : null,
      noBalance: position && position.noBalance !== undefined ? position.noBalance : null,
      balances: position && position.balances ? cloneJsonCompatible(position.balances) : null,
      openOrdersCount: position && position.openOrdersCount !== undefined ? position.openOrdersCount : null,
      openOrdersNotionalUsd: position && position.openOrdersNotionalUsd !== undefined ? position.openOrdersNotionalUsd : null,
      openOrders:
        position && Array.isArray(position.openOrders)
          ? cloneJsonCompatible(position.openOrders)
          : inventory && Array.isArray(inventory.openOrders)
            ? cloneJsonCompatible(inventory.openOrders)
            : [],
      estimatedValueUsd: summary.estimatedValueUsd !== undefined ? summary.estimatedValueUsd : null,
      positionDeltaApprox: summary.positionDeltaApprox !== undefined ? summary.positionDeltaApprox : null,
      prices: summary.prices ? cloneJsonCompatible(summary.prices) : position && position.prices ? cloneJsonCompatible(position.prices) : null,
      source: position && position.source ? cloneJsonCompatible(position.source) : null,
    },
    diagnostics: combinedDiagnostics,
  };
}

async function runPolymarketFundingTransfer(action, options = {}, deps = {}) {
  const execute = options.execute === true;
  const runtime = resolveRuntime(options);
  const signerAddress = await deriveSignerAddress(runtime, deps);
  const rpcSelection = await ensureRpcSelection(runtime, deps);
  const publicClient = rpcSelection.publicClient;
  const transfer = normalizeFundingTransferOptions(action, runtime, signerAddress, options);

  if (!transfer.toAddress) {
    throw createServiceError(
      'MISSING_REQUIRED_INPUT',
      action === 'deposit'
        ? 'Deposit target unavailable. Configure POLYMARKET_FUNDER/--funder or pass --to <address>.'
        : 'Withdraw destination unavailable. Configure a signer private key or pass --to <address>.',
      {
        action,
        signerAddress,
        funderAddress: runtime.funderAddress || null,
      },
    );
  }
  if (!transfer.fromAddress) {
    throw createServiceError(
      'MISSING_REQUIRED_INPUT',
      action === 'deposit'
        ? 'Deposit source unavailable. Provide signer credentials with --private-key or POLYMARKET_PRIVATE_KEY.'
        : 'Withdraw source unavailable. Configure POLYMARKET_FUNDER/--funder.',
      {
        action,
        signerAddress,
        funderAddress: runtime.funderAddress || null,
      },
    );
  }

  const { parseUnits } = await loadViemRuntime(deps);
  const amountUsdc = Number(options.amountUsdc);
  const amountRaw = parseUnits(String(options.amountUsdc), 6);
  const balances = {
    from: await readUsdcBalanceSnapshot(publicClient, runtime.usdcAddress, transfer.fromAddress),
    to: await readUsdcBalanceSnapshot(publicClient, runtime.usdcAddress, transfer.toAddress),
  };
  const payload = buildFundingPayloadBase(
    action,
    runtime,
    buildRpcSelectionPayload(runtime, { rpcSelection }),
    signerAddress,
    transfer,
    amountUsdc,
    amountRaw,
    balances,
  );

  if (transfer.manualProxyActionRequired) {
    payload.diagnostics.push('Signer and funder differ; proxy-originated transfer requires manual execution from the funder wallet.');
  }
  if (balances.from.error) {
    payload.diagnostics.push(`Source balance read failed: ${balances.from.error}`);
  }
  if (balances.to.error) {
    payload.diagnostics.push(`Destination balance read failed: ${balances.to.error}`);
  }

  const simulation = await maybeSimulateUsdcTransfer(
    publicClient,
    signerAddress && signerAddress === transfer.fromAddress ? signerAddress : null,
    runtime,
    transfer.toAddress,
    amountRaw,
  );
  payload.preflight.transferGasEstimate = simulation.gasEstimate;
  payload.preflight.simulationAttempted = simulation.attempted;
  payload.preflight.simulationOk = simulation.attempted ? simulation.ok : null;
  payload.preflight.simulationError = simulation.error;
  if (simulation.error) {
    payload.diagnostics.push(`Transfer simulation failed: ${simulation.error}`);
  }

  if (!execute) {
    return payload;
  }

  if (!signerAddress) {
    throw createServiceError(
      'MISSING_REQUIRED_INPUT',
      'Execute mode requires a signer private key (POLYMARKET_PRIVATE_KEY or --private-key).',
      {
        action,
        fromAddress: transfer.fromAddress,
        toAddress: transfer.toAddress,
      },
    );
  }
  if (transfer.fromAddress !== signerAddress) {
    throw createServiceError(
      'POLYMARKET_PROXY_TRANSFER_REQUIRES_MANUAL_EXECUTION',
      'Execute mode cannot submit a transfer from a proxy/funder wallet that differs from the signer address.',
      {
        action,
        signerAddress,
        fromAddress: transfer.fromAddress,
        toAddress: transfer.toAddress,
        hint: 'Use --dry-run output and execute the equivalent ERC20 transfer from the funder/proxy wallet.',
      },
    );
  }
  if (payload.preflight.sourceBalanceSufficient === false) {
    throw createServiceError(
      'POLYMARKET_INSUFFICIENT_USDC_BALANCE',
      `USDC.e balance is insufficient for ${action}.`,
      {
        action,
        requiredRaw: amountRaw.toString(),
        requiredFormatted: formatUnits6(amountRaw),
        balance: balances.from,
      },
    );
  }

  const walletClient = await createWalletClient(runtime, signerAddress, deps);
  if (!walletClient || !publicClient) {
    throw createServiceError('RPC_CLIENT_UNAVAILABLE', 'Unable to initialize wallet/public clients for execute mode.');
  }

  const chainIdResult = await safeGetChainId(publicClient);
  const chainId = chainIdResult.ok ? Number(chainIdResult.value) : null;
  const gasOverrides = await resolveWriteGasOverrides(chainId, publicClient);

  let txHash;
  if (simulation.request) {
    txHash = await walletClient.writeContract({
      ...simulation.request,
      ...gasOverrides,
    });
  } else {
    txHash = await walletClient.writeContract({
      address: runtime.usdcAddress,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [transfer.toAddress, amountRaw],
      ...gasOverrides,
    });
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  payload.mode = 'execute';
  payload.status = 'submitted';
  payload.tx = {
    txHash,
    status: receipt && receipt.status ? receipt.status : null,
    blockNumber:
      receipt && receipt.blockNumber !== undefined && receipt.blockNumber !== null
        ? receipt.blockNumber.toString()
        : null,
  };
  return payload;
}

async function runPolymarketDeposit(options = {}, deps = {}) {
  return runPolymarketFundingTransfer('deposit', options, deps);
}

async function runPolymarketWithdraw(options = {}, deps = {}) {
  return runPolymarketFundingTransfer('withdraw', options, deps);
}

module.exports = {
  POLYMARKET_OPS_SCHEMA_VERSION,
  POLYMARKET_POLYGON_DEFAULTS,
  buildPolymarketBalanceScope,
  buildPolymarketMergeReadiness,
  computeApprovalDiff,
  runPolymarketCheck,
  runPolymarketApprove,
  runPolymarketPreflight,
  runPolymarketBalance,
  runPolymarketPositions,
  runPolymarketDeposit,
  runPolymarketWithdraw,
};
