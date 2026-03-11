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

const HISTORICAL_STATE_UNAVAILABLE_PATTERNS = [
  /missing trie node/i,
  /header not found/i,
  /historical state/i,
  /missing historical/i,
  /required historical state/i,
  /archive/i,
  /prun(?:ed|ing)/i,
  /state.*not available/i,
  /old state/i,
];
const MAX_RESERVE_TRACE_SNAPSHOTS = 1_000;
const SUPPORTED_BLOCK_TAGS = new Set(['latest', 'safe', 'finalized', 'pending']);

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

async function getReadClientForRpc(rpcUrl, options = {}, deps = {}, cache = null) {
  if (deps.publicClient && typeof deps.publicClient.readContract === 'function') {
    return deps.publicClient;
  }
  if (cache && cache.has(rpcUrl)) {
    return cache.get(rpcUrl);
  }
  const client = await createReadClient({ ...options, rpcUrl }, deps);
  if (cache) {
    cache.set(rpcUrl, client);
  }
  return client;
}

function normalizeRpcUrlCandidates(value) {
  const rawValues = Array.isArray(value) ? value : String(value || '').split(',');
  const candidates = rawValues
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  return Array.from(new Set(candidates));
}

function normalizeOptionalString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeStringList(value) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function normalizeRpcAttemptList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') return null;
      const rpcUrl = normalizeOptionalString(entry.rpcUrl);
      if (!rpcUrl) return null;
      const order = Number(entry.order);
      return {
        rpcUrl,
        ok: entry.ok === true,
        order: Number.isInteger(order) && order > 0 ? order : index + 1,
        chainId: entry.chainId !== undefined && entry.chainId !== null ? Number(entry.chainId) : null,
        code: normalizeOptionalString(entry.code),
        message: normalizeOptionalString(entry.message),
        details: entry.details && typeof entry.details === 'object' ? entry.details : null,
      };
    })
    .filter(Boolean);
}

function normalizeOptionalAddress(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed) ? trimmed : null;
}

function normalizeBlockTag(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (SUPPORTED_BLOCK_TAGS.has(normalized)) {
    return normalized;
  }
  return null;
}

function parseBlockTag(value, fieldName = 'blockTag') {
  const normalized = normalizeBlockTag(value);
  if (normalized) return normalized;
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const error = new Error(`${fieldName} must be one of: latest, safe, finalized, pending.`);
  error.code = 'MIRROR_TRACE_INVALID_BLOCK_TAG';
  error.details = {
    field: fieldName,
    value,
    allowed: Array.from(SUPPORTED_BLOCK_TAGS),
  };
  throw error;
}

function parseTraceBlockNumber(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'bigint' && value >= 0n) {
    return Number(value);
  }

  const text = String(value).trim();
  if (!text) return null;
  const numeric = /^0x[0-9a-f]+$/i.test(text) ? Number.parseInt(text, 16) : Number(text);
  if (!Number.isInteger(numeric) || numeric < 0) {
    const error = new Error(`${fieldName} must be a non-negative integer block number.`);
    error.code = 'MIRROR_TRACE_INVALID_BLOCK';
    error.details = {
      field: fieldName,
      value,
    };
    throw error;
  }
  return numeric;
}

function buildBlockReadOptions(options = {}) {
  const blockNumber = parseTraceBlockNumber(options.blockNumber, 'blockNumber');
  const blockTag = parseBlockTag(options.blockTag, 'blockTag');
  if (blockNumber !== null) {
    return {
      blockNumber,
      blockTag: null,
      historical: true,
    };
  }
  if (blockTag) {
    return {
      blockNumber: null,
      blockTag,
      historical: false,
    };
  }
  return {
    blockNumber: null,
    blockTag: null,
    historical: false,
  };
}

function buildReadContractOptions(request = {}) {
  if (request.blockNumber !== null && request.blockNumber !== undefined) {
    return { blockNumber: BigInt(request.blockNumber) };
  }
  if (request.blockTag) {
    return { blockTag: request.blockTag };
  }
  return {};
}

function buildGetBlockOptions(request = {}) {
  if (request.blockNumber !== null && request.blockNumber !== undefined) {
    return { blockNumber: BigInt(request.blockNumber) };
  }
  if (request.blockTag) {
    return { blockTag: request.blockTag };
  }
  return { blockTag: 'latest' };
}

function extractErrorText(err) {
  const parts = [];
  if (err && err.code) parts.push(String(err.code));
  if (err && err.shortMessage) parts.push(String(err.shortMessage));
  if (err && err.message) parts.push(String(err.message));
  if (err && err.details) {
    try {
      parts.push(typeof err.details === 'string' ? err.details : JSON.stringify(err.details));
    } catch {
      // ignore JSON stringify failures
    }
  }
  if (err && err.cause && err.cause !== err) {
    parts.push(extractErrorText(err.cause));
  }
  return parts.join(' | ');
}

function isHistoricalStateUnavailableError(err) {
  const errorText = extractErrorText(err);
  if (!errorText) return false;
  return HISTORICAL_STATE_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(errorText));
}

function wrapHistoricalStateError(err, rpcUrl, request = {}) {
  if (!request.historical || !isHistoricalStateUnavailableError(err)) return err;
  const blockRef =
    request.blockNumber !== null && request.blockNumber !== undefined
      ? `block ${request.blockNumber}`
      : request.blockTag
        ? `block tag ${request.blockTag}`
        : 'the requested historical state';
  const error = new Error(
    `RPC ${rpcUrl} cannot serve ${blockRef}; archive-capable historical state is unavailable.`,
  );
  error.code = 'MIRROR_ONCHAIN_ARCHIVE_STATE_UNAVAILABLE';
  error.details = {
    rpcUrl,
    blockNumber: request.blockNumber,
    blockTag: request.blockTag,
    cause: err && err.message ? err.message : String(err),
  };
  error.cause = err;
  return error;
}

async function readOptionalBlockMetadata(publicClient, request = {}) {
  if (!publicClient || typeof publicClient.getBlock !== 'function') return null;
  try {
    const block = await publicClient.getBlock(buildGetBlockOptions(request));
    return {
      blockNumber:
        block && block.number !== undefined && block.number !== null
          ? Number(block.number)
          : block && block.blockNumber !== undefined && block.blockNumber !== null
            ? Number(block.blockNumber)
            : request.blockNumber !== null && request.blockNumber !== undefined
              ? request.blockNumber
              : null,
      blockHash: block && typeof block.hash === 'string' ? block.hash : null,
      blockTimestamp:
        block && block.timestamp !== undefined && block.timestamp !== null
          ? new Date(Number(block.timestamp) * 1000).toISOString()
          : null,
    };
  } catch {
    return {
      blockNumber: request.blockNumber !== null && request.blockNumber !== undefined ? request.blockNumber : null,
      blockHash: null,
      blockTimestamp: null,
    };
  }
}

function parseTraceBlockList(value) {
  if (value === null || value === undefined || value === '') return [];
  const values = Array.isArray(value) ? value : String(value).split(',');
  const blocks = [];
  for (const entry of values) {
    const blockNumber = parseTraceBlockNumber(entry, 'blocks');
    if (blockNumber === null) continue;
    if (!blocks.includes(blockNumber)) {
      blocks.push(blockNumber);
    }
  }
  return blocks;
}

function buildTraceBlockSequence(options = {}) {
  const explicitBlocks = parseTraceBlockList(options.blocks);
  const limit = parseTraceBlockNumber(options.limit, 'limit');
  if (explicitBlocks.length) {
    const limited = limit === null ? explicitBlocks : explicitBlocks.slice(0, limit);
    if (limited.length > MAX_RESERVE_TRACE_SNAPSHOTS) {
      const error = new Error(
        `Requested reserve trace expands to more than ${MAX_RESERVE_TRACE_SNAPSHOTS} snapshots. Narrow the selection or pass --limit.`,
      );
      error.code = 'MIRROR_TRACE_RANGE_TOO_LARGE';
      error.details = {
        requestedCount: limited.length,
        maxSnapshots: MAX_RESERVE_TRACE_SNAPSHOTS,
      };
      throw error;
    }
    return limited;
  }

  const fromBlock = parseTraceBlockNumber(options.fromBlock, 'fromBlock');
  const toBlock = parseTraceBlockNumber(options.toBlock, 'toBlock');
  if (fromBlock === null && toBlock === null) {
    const blockNumber = parseTraceBlockNumber(options.blockNumber, 'blockNumber');
    if (blockNumber !== null) return [blockNumber];
    return [];
  }
  if (fromBlock === null || toBlock === null) {
    const error = new Error('fromBlock and toBlock must be provided together for reserve trace ranges.');
    error.code = 'MIRROR_TRACE_RANGE_REQUIRED';
    error.details = {
      fromBlock,
      toBlock,
    };
    throw error;
  }

  const stepRaw = parseTraceBlockNumber(options.step === undefined ? 1 : options.step, 'step');
  const step = stepRaw === null ? 1 : stepRaw;
  if (step <= 0) {
    const error = new Error('step must be a positive integer.');
    error.code = 'MIRROR_TRACE_INVALID_STEP';
    error.details = { step: options.step };
    throw error;
  }

  const direction = fromBlock <= toBlock ? 1 : -1;
  const blocks = [];
  for (
    let current = fromBlock;
    direction === 1 ? current <= toBlock : current >= toBlock;
    current += step * direction
  ) {
    blocks.push(current);
    if (limit !== null && blocks.length >= limit) {
      break;
    }
    if (blocks.length > MAX_RESERVE_TRACE_SNAPSHOTS) {
      const error = new Error(
        `Requested reserve trace expands to more than ${MAX_RESERVE_TRACE_SNAPSHOTS} snapshots. Narrow the range or increase the step.`,
      );
      error.code = 'MIRROR_TRACE_RANGE_TOO_LARGE';
      error.details = {
        fromBlock,
        toBlock,
        step,
        maxSnapshots: MAX_RESERVE_TRACE_SNAPSHOTS,
      };
      throw error;
    }
  }

  return blocks;
}

async function readOptionalDecimals(publicClient, tokenAddress, request = {}) {
  try {
    const value = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_DECIMALS_ABI,
      functionName: 'decimals',
      args: [],
      ...buildReadContractOptions(request),
    });
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 36) return null;
    return numeric;
  } catch (err) {
    if (request.historical && isHistoricalStateUnavailableError(err)) {
      throw err;
    }
    return null;
  }
}

async function readOutcomeTokenRefs(publicClient, marketAddress, request = {}) {
  for (const abi of OUTCOME_TOKEN_REF_ABI_CANDIDATES) {
    try {
      const yesFn = abi[0].name;
      const noFn = abi[1].name;
      const [yesToken, noToken] = await Promise.all([
        publicClient.readContract({ address: marketAddress, abi, functionName: yesFn, args: [], ...buildReadContractOptions(request) }),
        publicClient.readContract({ address: marketAddress, abi, functionName: noFn, args: [], ...buildReadContractOptions(request) }),
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
    } catch (err) {
      if (request.historical && isHistoricalStateUnavailableError(err)) {
        throw err;
      }
      // Try the next ABI candidate.
    }
  }
  return null;
}

async function readOptionalTradingFee(publicClient, marketAddress, request = {}) {
  try {
    const value = await publicClient.readContract({
      address: marketAddress,
      abi: TRADING_FEE_ABI,
      functionName: 'tradingFee',
      args: [],
      ...buildReadContractOptions(request),
    });
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
  } catch (err) {
    if (request.historical && isHistoricalStateUnavailableError(err)) {
      throw err;
    }
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
  const existingReserveContext =
    verifyPayload && verifyPayload.reserveContext && typeof verifyPayload.reserveContext === 'object'
      ? verifyPayload.reserveContext
      : {};
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
    walletYesUsdc:
      overrides.walletYesUsdc !== undefined && overrides.walletYesUsdc !== null
        ? toNumber(overrides.walletYesUsdc)
        : toNumber(existingReserveContext.walletYesUsdc),
    walletNoUsdc:
      overrides.walletNoUsdc !== undefined && overrides.walletNoUsdc !== null
        ? toNumber(overrides.walletNoUsdc)
        : toNumber(existingReserveContext.walletNoUsdc),
    inventoryAddress: overrides.inventoryAddress || existingReserveContext.inventoryAddress || null,
    configuredRpcUrl:
      overrides.configuredRpcUrl !== undefined
        ? normalizeOptionalString(overrides.configuredRpcUrl)
        : normalizeOptionalString(existingReserveContext.configuredRpcUrl),
    candidateUrls:
      Object.prototype.hasOwnProperty.call(overrides, 'candidateUrls')
        ? normalizeStringList(overrides.candidateUrls)
        : normalizeStringList(existingReserveContext.candidateUrls),
    attempts:
      Object.prototype.hasOwnProperty.call(overrides, 'attempts')
        ? normalizeRpcAttemptList(overrides.attempts)
        : normalizeRpcAttemptList(existingReserveContext.attempts),
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
      walletYesUsdc: reserveContext.walletYesUsdc !== undefined ? reserveContext.walletYesUsdc : null,
      walletNoUsdc: reserveContext.walletNoUsdc !== undefined ? reserveContext.walletNoUsdc : null,
      inventoryAddress: reserveContext.inventoryAddress || null,
      configuredRpcUrl: normalizeOptionalString(reserveContext.configuredRpcUrl),
      candidateUrls: normalizeStringList(reserveContext.candidateUrls),
      attempts: normalizeRpcAttemptList(reserveContext.attempts),
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
  const readRequest = buildBlockReadOptions(options);
  const clientCache = new Map();
  const includePoolReserves = options.includePoolReserves !== false;
  const inventoryAddress = normalizeOptionalAddress(options.inventoryAddress);
  const configuredRpcUrl =
    Array.isArray(options.rpcUrl)
      ? options.rpcUrl.map((entry) => String(entry || '').trim()).filter(Boolean).join(',')
      : normalizeOptionalString(options.rpcUrl);

  for (let index = 0; index < rpcCandidates.length; index += 1) {
    const rpcUrl = rpcCandidates[index];
    try {
      const publicClient = await getReadClientForRpc(rpcUrl, options, deps, clientCache);
      if (!publicClient) {
        throw new Error('No public client available for Pandora reserve read.');
      }

      const refs = await readOutcomeTokenRefs(publicClient, options.marketAddress, readRequest);
      if (!refs) {
        const error = new Error('Unable to resolve Pandora outcome token references on-chain.');
        error.code = 'MIRROR_SYNC_OUTCOME_TOKEN_REFS_UNAVAILABLE';
        throw error;
      }

      const [yesDecimals, noDecimals, yesRaw, noRaw, feeTier, walletYesRaw, walletNoRaw] = await Promise.all([
        readOptionalDecimals(publicClient, refs.yesToken, readRequest),
        readOptionalDecimals(publicClient, refs.noToken, readRequest),
        includePoolReserves
          ? publicClient.readContract({
            address: refs.yesToken,
            abi: ERC20_BALANCE_OF_ABI,
            functionName: 'balanceOf',
            args: [options.marketAddress],
            ...buildReadContractOptions(readRequest),
          })
          : Promise.resolve(null),
        includePoolReserves
          ? publicClient.readContract({
            address: refs.noToken,
            abi: ERC20_BALANCE_OF_ABI,
            functionName: 'balanceOf',
            args: [options.marketAddress],
            ...buildReadContractOptions(readRequest),
          })
          : Promise.resolve(null),
        includePoolReserves
          ? readOptionalTradingFee(publicClient, options.marketAddress, readRequest)
          : Promise.resolve(null),
        inventoryAddress
          ? publicClient.readContract({
            address: refs.yesToken,
            abi: ERC20_BALANCE_OF_ABI,
            functionName: 'balanceOf',
            args: [inventoryAddress],
            ...buildReadContractOptions(readRequest),
          })
          : Promise.resolve(null),
        inventoryAddress
          ? publicClient.readContract({
            address: refs.noToken,
            abi: ERC20_BALANCE_OF_ABI,
            functionName: 'balanceOf',
            args: [inventoryAddress],
            ...buildReadContractOptions(readRequest),
          })
          : Promise.resolve(null),
      ]);

      if (yesDecimals === null || noDecimals === null || (includePoolReserves && feeTier === null)) {
        const error = new Error('Unable to read Pandora reserve metadata on-chain.');
        error.code = 'MIRROR_ONCHAIN_RESERVE_METADATA_UNAVAILABLE';
        error.details = {
          rpcUrl,
          yesDecimalsRead: yesDecimals !== null,
          noDecimalsRead: noDecimals !== null,
          tradingFeeRead: includePoolReserves ? feeTier !== null : null,
        };
        throw error;
      }

      const reserveYesUsdc =
        yesRaw === null || yesRaw === undefined
          ? null
          : round(Number(runtime.formatUnits(yesRaw, yesDecimals)), 6);
      const reserveNoUsdc =
        noRaw === null || noRaw === undefined
          ? null
          : round(Number(runtime.formatUnits(noRaw, noDecimals)), 6);
      const walletYesUsdc =
        walletYesRaw === null || walletYesRaw === undefined
          ? null
          : round(Number(runtime.formatUnits(walletYesRaw, yesDecimals)), 6);
      const walletNoUsdc =
        walletNoRaw === null || walletNoRaw === undefined
          ? null
          : round(Number(runtime.formatUnits(walletNoRaw, noDecimals)), 6);
      const fallbackUsed = index > 0;
      const blockMetadata =
        options.includeBlockMetadata === true || readRequest.historical
          ? await readOptionalBlockMetadata(publicClient, readRequest)
          : null;
      const attempts = errors.concat([
        {
          rpcUrl,
          ok: true,
          order: index + 1,
        },
      ]);

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
        walletYesUsdc,
        walletNoUsdc,
        inventoryAddress,
        rpcUrl,
        blockNumber:
          blockMetadata && blockMetadata.blockNumber !== null && blockMetadata.blockNumber !== undefined
            ? blockMetadata.blockNumber
            : readRequest.blockNumber,
        blockHash: blockMetadata ? blockMetadata.blockHash : null,
        blockTimestamp: blockMetadata ? blockMetadata.blockTimestamp : null,
        blockTag: readRequest.blockNumber === null ? readRequest.blockTag : null,
        configuredRpcUrl,
        candidateUrls: rpcCandidates,
        attempts,
      };
    } catch (err) {
      const wrapped = wrapHistoricalStateError(err, rpcUrl, readRequest);
      errors.push({
        rpcUrl,
        code: wrapped && wrapped.code ? String(wrapped.code) : null,
        message: wrapped && wrapped.message ? wrapped.message : String(wrapped),
        details: wrapped && wrapped.details ? wrapped.details : null,
        ok: false,
        order: index + 1,
      });
    }
  }

  const allArchiveUnavailable =
    readRequest.historical
    && errors.length > 0
    && errors.every((entry) => entry.code === 'MIRROR_ONCHAIN_ARCHIVE_STATE_UNAVAILABLE');
  const error = new Error(
    allArchiveUnavailable
      ? `Requested Pandora historical reserve state is unavailable on every configured RPC candidate; archive-capable history is required. ${errors.map((entry) => `[${entry.rpcUrl}] ${entry.message}`).join(' | ')}`
      : `Unable to read Pandora reserves on-chain from any configured RPC candidate: ${errors.map((entry) => `[${entry.rpcUrl}] ${entry.message}`).join(' | ')}`,
  );
  error.code = allArchiveUnavailable ? 'MIRROR_ONCHAIN_ARCHIVE_STATE_UNAVAILABLE' : 'MIRROR_ONCHAIN_RESERVES_UNAVAILABLE';
  error.details = {
    configuredRpcUrl,
    candidateUrls: rpcCandidates,
    attempts: errors,
    blockNumber: readRequest.blockNumber,
    blockTag: readRequest.blockTag,
  };
  throw error;
}

async function readPandoraOnchainReserveTrace(options = {}, deps = {}) {
  const marketAddress = options.marketAddress || options.pandoraMarketAddress || null;
  if (!marketAddress) {
    const error = new Error('Pandora market address is required for reserve tracing.');
    error.code = 'MIRROR_TRACE_MARKET_ADDRESS_REQUIRED';
    throw error;
  }

  const blocks = buildTraceBlockSequence(options);
  const blockTag = parseBlockTag(options.blockTag, 'blockTag');
  const requestedBlockNumber = parseTraceBlockNumber(options.blockNumber, 'blockNumber');
  const requestedBlocks = parseTraceBlockList(options.blocks);
  const hasExplicitBlockList = requestedBlocks.length > 0;
  const hasRangeSelection =
    !hasExplicitBlockList
    && options.fromBlock !== null
    && options.fromBlock !== undefined
    && options.toBlock !== null
    && options.toBlock !== undefined;
  const requestedStep = hasRangeSelection
    ? (() => {
        const parsed = parseTraceBlockNumber(options.step === undefined ? 1 : options.step, 'step');
        return parsed === null ? 1 : parsed;
      })()
    : null;
  if (!blocks.length && !blockTag) {
    const error = new Error(
      'Pandora reserve trace requires --blocks, --from-block/--to-block, or a blockTag/blockNumber input.',
    );
    error.code = 'MIRROR_TRACE_BLOCK_SELECTION_REQUIRED';
    throw error;
  }

  const snapshots = [];
  const diagnostics = [];

  if (blocks.length) {
    for (const blockNumber of blocks) {
      try {
        const snapshot = await readPandoraOnchainReserveContext(
          {
            ...options,
            marketAddress,
            blockNumber,
            blockTag: null,
            includeBlockMetadata: true,
          },
          deps,
        );
        snapshots.push(snapshot);
      } catch (err) {
        if (err && err.code === 'MIRROR_ONCHAIN_ARCHIVE_STATE_UNAVAILABLE') {
          throw err;
        }
        diagnostics.push(
          `Reserve trace read failed for block ${blockNumber}: ${err && err.message ? err.message : String(err)}`,
        );
        throw err;
      }
    }
  } else {
    snapshots.push(
      await readPandoraOnchainReserveContext(
        {
          ...options,
          marketAddress,
          blockTag,
          includeBlockMetadata: true,
        },
        deps,
      ),
    );
  }

  const firstSnapshot = snapshots[0] || null;
  const lastSnapshot = snapshots[snapshots.length - 1] || null;
  const rpcUrlsUsed = Array.from(
    new Set(
      snapshots
        .map((entry) => String(entry && entry.rpcUrl ? entry.rpcUrl : '').trim())
        .filter(Boolean),
    ),
  );
  const firstBlockNumber = firstSnapshot && Number.isInteger(firstSnapshot.blockNumber) ? firstSnapshot.blockNumber : null;
  const lastBlockNumber = lastSnapshot && Number.isInteger(lastSnapshot.blockNumber) ? lastSnapshot.blockNumber : null;

  return {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    selector: {
      selectionMode:
        hasExplicitBlockList
          ? 'blocks'
          : hasRangeSelection
            ? 'range'
            : requestedBlockNumber !== null
              ? 'block-number'
              : blockTag
                ? 'block-tag'
                : null,
      pandoraMarketAddress: marketAddress,
      rpcUrl: options.rpcUrl || null,
      blocks: hasExplicitBlockList ? blocks : [],
      blockNumber: requestedBlockNumber,
      fromBlock: hasRangeSelection ? parseTraceBlockNumber(options.fromBlock, 'fromBlock') : null,
      toBlock: hasRangeSelection ? parseTraceBlockNumber(options.toBlock, 'toBlock') : null,
      step: hasRangeSelection ? requestedStep : null,
      blockTag: hasExplicitBlockList || hasRangeSelection || requestedBlockNumber !== null ? null : blockTag,
      limit: options.limit === undefined || options.limit === null ? null : Number(options.limit),
    },
    summary: {
      snapshotCount: snapshots.length,
      firstBlockNumber,
      lastBlockNumber,
      blockSpan:
        firstBlockNumber === null
          ? null
          : firstBlockNumber === lastBlockNumber
            ? String(firstBlockNumber)
            : `${firstBlockNumber}..${lastBlockNumber}`,
      rpcUrl: rpcUrlsUsed.length === 1 ? rpcUrlsUsed[0] : rpcUrlsUsed.length ? 'mixed' : options.rpcUrl || null,
      rpcUrlsUsed,
      fallbackRpcCount: snapshots.filter((entry) => entry && entry.fallbackUsed).length,
      archiveRequired: blockTag ? false : null,
      archiveRequirement: blockTag ? 'not-required' : 'depends-on-history-depth',
    },
    snapshots,
    diagnostics,
  };
}

module.exports = {
  buildReserveContextFromVerifyPayload,
  applyReserveContextToVerifyPayload,
  readPandoraOnchainReserveContext,
  readPandoraOnchainReserveTrace,
  derivePandoraYesPctFromReserves,
};
