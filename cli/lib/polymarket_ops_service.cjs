const { ClobClient, Chain } = require('@polymarket/clob-client');

const POLYMARKET_OPS_SCHEMA_VERSION = '1.0.0';
const POLYGON_CHAIN_ID = 137;
const POLYMARKET_SIG_TYPE_EOA = 0;
const POLYMARKET_SIG_TYPE_PROXY = 2;
const MAX_UINT256 = (1n << 256n) - 1n;
const DEFAULT_ALLOWANCE_SUFFICIENT_FLOOR_RAW = 1n << 128n;

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

function coerceErrorMessage(err) {
  if (err && typeof err.message === 'string') return err.message;
  return String(err);
}

function safeCodeToBoolean(code) {
  return String(code || '').trim().toLowerCase() !== '0x';
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
  const rpcUrl = options.rpcUrl || env.POLYMARKET_RPC_URL || env.RPC_URL || null;
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
    rpcUrl: rpcUrl ? String(rpcUrl).trim() : null,
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
  if (!runtime.rpcUrl) return null;
  const { createPublicClient, http } = await loadViemRuntime(deps);
  return createPublicClient({ transport: http(runtime.rpcUrl) });
}

async function createWalletClient(runtime, signerAddress, deps = {}) {
  if (deps.walletClient) return deps.walletClient;
  if (!runtime.rpcUrl || !runtime.privateKey || !signerAddress) return null;
  const { createWalletClient, http, privateKeyToAccount } = await loadViemRuntime(deps);
  const account = privateKeyToAccount(runtime.privateKey);
  return createWalletClient({ account, transport: http(runtime.rpcUrl) });
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
  const publicClient = await createPublicClient(runtime, deps);
  const ownerAddress = runtime.funderAddress || signerAddress || null;
  const chain = await safeGetChainId(publicClient);
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
    ({ Wallet } = require('@ethersproject/wallet'));
  } catch (err) {
    return {
      attempted: false,
      ok: false,
      status: 'dependency_error',
      reason: `Unable to load @ethersproject/wallet: ${coerceErrorMessage(err)}`,
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

function buildCheckPayload(runtime, signerAddress, onchainState, approvalDiff, apiSanity) {
  const ownership = evaluateOwnership(runtime, signerAddress, onchainState);
  const chainId = onchainState.chain && onchainState.chain.ok ? onchainState.chain.value : null;
  const rpcOk = Boolean(onchainState.chain && onchainState.chain.ok);
  const usdcBalanceRaw = toBigIntOrNull(onchainState.usdcBalance && onchainState.usdcBalance.value);

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
      rpcUrl: runtime.rpcUrl,
      host: runtime.host,
      signerAddress: signerAddress || null,
      funderAddress: runtime.funderAddress || null,
      ownerAddress: onchainState.ownerAddress || null,
      usdcAddress: runtime.usdcAddress,
      ctfAddress: runtime.ctfAddress,
      spenders: runtime.spenders,
    },
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

  const receipts = [];
  for (const step of txPlan) {
    let hash;
    if (step.type === 'erc20_allowance') {
      hash = await walletClient.writeContract({
        address: runtime.usdcAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [step.spender, runtime.allowanceTargetRaw],
      });
    } else {
      hash = await walletClient.writeContract({
        address: runtime.ctfAddress,
        abi: CTF_ABI,
        functionName: 'setApprovalForAll',
        args: [step.spender, true],
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
  const ownership = checkPayload.ownership || {};
  const usdcRaw = toBigIntOrNull(checkPayload.balances && checkPayload.balances.usdc && checkPayload.balances.usdc.raw);
  const apiSanity = checkPayload.apiKeySanity || {};

  checks.push({
    code: 'RPC_CONNECTED',
    ok: Boolean(checkPayload.chainOk),
    message: 'RPC endpoint must be reachable.',
    details: { rpcUrl: runtime.rpcUrl || null },
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

async function runPolymarketPreflight(options = {}, deps = {}) {
  const checkPayload = await runPolymarketCheck(options, deps);
  const checks = buildPreflightChecks(checkPayload);
  const failedChecks = checks.filter((item) => !item.ok).map((item) => item.code);
  const payload = {
    schemaVersion: POLYMARKET_OPS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ok: failedChecks.length === 0,
    failedChecks,
    checks,
    check: checkPayload,
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

module.exports = {
  POLYMARKET_OPS_SCHEMA_VERSION,
  POLYMARKET_POLYGON_DEFAULTS,
  computeApprovalDiff,
  runPolymarketCheck,
  runPolymarketApprove,
  runPolymarketPreflight,
};
