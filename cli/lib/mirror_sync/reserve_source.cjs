const { round, toNumber } = require('../shared/utils.cjs');

const ERC20_BALANCE_OF_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
];

const ERC20_DECIMALS_ABI = [
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
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

const TRADING_FEE_ABI = [
  {
    type: 'function',
    name: 'tradingFee',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint24' }],
  },
];

async function loadViemRuntime(deps = {}) {
  if (deps.viemRuntime && typeof deps.viemRuntime === 'object') {
    return deps.viemRuntime;
  }
  return import('viem');
}

async function createReadClient(options = {}, deps = {}) {
  if (deps.publicClient && typeof deps.publicClient.readContract === 'function') {
    return deps.publicClient;
  }
  if (!options.rpcUrl) return null;
  const runtime = await loadViemRuntime(deps);
  return runtime.createPublicClient({ transport: runtime.http(options.rpcUrl) });
}

function normalizeRpcUrlCandidates(value) {
  const rawValues = Array.isArray(value) ? value : String(value || '').split(',');
  const candidates = rawValues
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  return Array.from(new Set(candidates));
}

function normalizeOptionalAddress(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed) ? trimmed : null;
}

async function readOptionalDecimals(publicClient, tokenAddress) {
  try {
    const value = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_DECIMALS_ABI,
      functionName: 'decimals',
      args: [],
    });
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 36) return null;
    return numeric;
  } catch {
    return null;
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
        return {
          yesToken: yes,
          noToken: no,
          source: `${yesFn}/${noFn}`,
        };
      }
    } catch {
      // Try the next ABI candidate.
    }
  }
  return null;
}

async function readOptionalTradingFee(publicClient, marketAddress) {
  try {
    const value = await publicClient.readContract({
      address: marketAddress,
      abi: TRADING_FEE_ABI,
      functionName: 'tradingFee',
      args: [],
    });
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
  } catch {
    return null;
  }
}

function derivePandoraYesPctFromReserves(reserveYesUsdc, reserveNoUsdc) {
  const reserveYes = toNumber(reserveYesUsdc);
  const reserveNo = toNumber(reserveNoUsdc);
  if (reserveYes === null || reserveNo === null) return null;
  const total = reserveYes + reserveNo;
  if (!Number.isFinite(total) || total <= 0) return null;
  return round((reserveNo / total) * 100, 6);
}

function buildReserveContextFromVerifyPayload(verifyPayload, overrides = {}) {
  const pandora = verifyPayload && verifyPayload.pandora ? verifyPayload.pandora : {};
  const reserveYesUsdc = toNumber(pandora.reserveYes);
  const reserveNoUsdc = toNumber(pandora.reserveNo);
  const derivedYesPct = derivePandoraYesPctFromReserves(reserveYesUsdc, reserveNoUsdc);
  const explicitYesPct = toNumber(pandora.yesPct);
  const feeTier = toNumber(pandora.feeTier);
  return {
    source: overrides.source || (pandora.reserveSource ? String(pandora.reserveSource) : 'verify-payload'),
    reserveYesUsdc,
    reserveNoUsdc,
    pandoraYesPct: explicitYesPct === null ? derivedYesPct : explicitYesPct,
    feeTier,
    readAt: overrides.readAt || null,
    readError: overrides.readError || null,
    outcomeTokenSource: overrides.outcomeTokenSource || null,
    rpcUrl: overrides.rpcUrl || null,
    fallbackUsed: Boolean(overrides.fallbackUsed),
    yesToken: overrides.yesToken || null,
    noToken: overrides.noToken || null,
  };
}

function applyReserveContextToVerifyPayload(verifyPayload, reserveContext) {
  if (!verifyPayload || typeof verifyPayload !== 'object' || !reserveContext || typeof reserveContext !== 'object') {
    return verifyPayload;
  }

  const pandora = verifyPayload.pandora && typeof verifyPayload.pandora === 'object' ? verifyPayload.pandora : {};
  const nextPandora = {
    ...pandora,
    reserveSource: reserveContext.source || pandora.reserveSource || null,
  };

  if (reserveContext.reserveYesUsdc !== null) nextPandora.reserveYes = reserveContext.reserveYesUsdc;
  if (reserveContext.reserveNoUsdc !== null) nextPandora.reserveNo = reserveContext.reserveNoUsdc;
  if (reserveContext.pandoraYesPct !== null) nextPandora.yesPct = reserveContext.pandoraYesPct;
  if (reserveContext.feeTier !== null) nextPandora.feeTier = reserveContext.feeTier;
  if (reserveContext.readAt) nextPandora.reserveReadAt = reserveContext.readAt;
  if (reserveContext.readError) nextPandora.reserveReadError = reserveContext.readError;

  return {
    ...verifyPayload,
    pandora: nextPandora,
    reserveContext: {
      source: reserveContext.source || null,
      reserveYesUsdc: reserveContext.reserveYesUsdc,
      reserveNoUsdc: reserveContext.reserveNoUsdc,
      pandoraYesPct: reserveContext.pandoraYesPct,
      feeTier: reserveContext.feeTier,
      readAt: reserveContext.readAt || null,
      readError: reserveContext.readError || null,
      outcomeTokenSource: reserveContext.outcomeTokenSource || null,
      rpcUrl: reserveContext.rpcUrl || null,
      fallbackUsed: Boolean(reserveContext.fallbackUsed),
      yesToken: reserveContext.yesToken || null,
      noToken: reserveContext.noToken || null,
    },
  };
}

async function readPandoraOnchainReserveContext(options = {}, deps = {}) {
  if (!options.marketAddress) {
    const error = new Error('Pandora market address is required for on-chain reserve reads.');
    error.code = 'MIRROR_SYNC_MARKET_ADDRESS_REQUIRED';
    throw error;
  }

  const rpcCandidates = normalizeRpcUrlCandidates(options.rpcUrl);
  if (!rpcCandidates.length) {
    const error = new Error('Pandora RPC URL is required for on-chain reserve reads.');
    error.code = 'MIRROR_SYNC_RPC_REQUIRED';
    throw error;
  }

  const runtime = await loadViemRuntime(deps);
  const errors = [];

  for (let index = 0; index < rpcCandidates.length; index += 1) {
    const rpcUrl = rpcCandidates[index];
    try {
      const publicClient = await createReadClient({ ...options, rpcUrl }, deps);
      if (!publicClient) {
        throw new Error('No public client available for Pandora reserve read.');
      }

      const refs = await readOutcomeTokenRefs(publicClient, options.marketAddress);
      if (!refs) {
        const error = new Error('Unable to resolve Pandora outcome token references on-chain.');
        error.code = 'MIRROR_SYNC_OUTCOME_TOKEN_REFS_UNAVAILABLE';
        throw error;
      }

      const [yesDecimals, noDecimals, yesRaw, noRaw, feeTier] = await Promise.all([
        readOptionalDecimals(publicClient, refs.yesToken),
        readOptionalDecimals(publicClient, refs.noToken),
        publicClient.readContract({
          address: refs.yesToken,
          abi: ERC20_BALANCE_OF_ABI,
          functionName: 'balanceOf',
          args: [options.marketAddress],
        }),
        publicClient.readContract({
          address: refs.noToken,
          abi: ERC20_BALANCE_OF_ABI,
          functionName: 'balanceOf',
          args: [options.marketAddress],
        }),
        readOptionalTradingFee(publicClient, options.marketAddress),
      ]);

      if (yesDecimals === null || noDecimals === null || feeTier === null) {
        const error = new Error('Unable to read Pandora reserve metadata on-chain.');
        error.code = 'MIRROR_ONCHAIN_RESERVE_METADATA_UNAVAILABLE';
        error.details = {
          rpcUrl,
          yesDecimalsRead: yesDecimals !== null,
          noDecimalsRead: noDecimals !== null,
          tradingFeeRead: feeTier !== null,
        };
        throw error;
      }

      const reserveYesUsdc = round(Number(runtime.formatUnits(yesRaw, yesDecimals)), 6);
      const reserveNoUsdc = round(Number(runtime.formatUnits(noRaw, noDecimals)), 6);
      const fallbackUsed = index > 0;

      return {
        source: fallbackUsed ? 'onchain:outcome-token-balances:fallback' : 'onchain:outcome-token-balances',
        reserveYesUsdc,
        reserveNoUsdc,
        pandoraYesPct: derivePandoraYesPctFromReserves(reserveYesUsdc, reserveNoUsdc),
        feeTier,
        readAt:
          options.now instanceof Date
            ? options.now.toISOString()
            : typeof options.now === 'string'
              ? options.now
              : new Date().toISOString(),
        outcomeTokenSource: refs.source,
        fallbackUsed,
        yesToken: refs.yesToken,
        noToken: refs.noToken,
        rpcUrl,
      };
    } catch (err) {
      errors.push({
        rpcUrl,
        code: err && err.code ? String(err.code) : null,
        message: err && err.message ? err.message : String(err),
        details: err && err.details ? err.details : null,
      });
    }
  }

  const error = new Error(
    `Unable to read Pandora reserves on-chain from any configured RPC candidate: ${errors.map((entry) => `[${entry.rpcUrl}] ${entry.message}`).join(' | ')}`,
  );
  error.code = 'MIRROR_ONCHAIN_RESERVES_UNAVAILABLE';
  error.details = { attempts: errors };
  throw error;
}

module.exports = {
  buildReserveContextFromVerifyPayload,
  applyReserveContextToVerifyPayload,
  readPandoraOnchainReserveContext,
  derivePandoraYesPctFromReserves,
};
