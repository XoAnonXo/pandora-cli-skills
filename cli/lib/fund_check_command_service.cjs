const { DEFAULT_RPC_BY_CHAIN_ID } = require('./shared/constants.cjs');
const { clamp, round, toOptionalNumber, isSecureHttpUrlOrLocal } = require('./shared/utils.cjs');
const { materializeExecutionSigner } = require('./signers/execution_signer_service.cjs');
const {
  planAmmTradeToTargetYesPct,
  simulateDirectionalSwap,
} = require('./amm_target_pct_service.cjs');
const { buildMirrorHedgeCalc } = require('./mirror_econ_service.cjs');
const {
  resolveMirrorSurfaceState,
  resolveMirrorSurfaceDaemonStatus,
} = require('./mirror_surface_service.cjs');
const { buildMirrorRuntimeTelemetry } = require('./mirror_sync/state.cjs');

const ERC20_ABI = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'balanceOf',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
];

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunFundCheckCommand requires deps.${name}()`);
  }
  return deps[name];
}

function requireFlagValue(args, index, flagName, CliError) {
  if (index + 1 >= args.length || String(args[index + 1]).startsWith('--')) {
    throw new CliError('MISSING_REQUIRED_FLAG', `${flagName} requires a value.`);
  }
  return String(args[index + 1]);
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toRawNumberString(raw, decimals) {
  if (raw === null || raw === undefined) return null;
  try {
    const value = BigInt(raw);
    const scale = 10n ** BigInt(decimals);
    const whole = value / scale;
    const fraction = value % scale;
    const fractionText = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
    return fractionText ? `${whole.toString()}.${fractionText}` : whole.toString();
  } catch {
    return null;
  }
}

function normalizeAddress(value) {
  const raw = String(value || '').trim();
  return /^0x[a-fA-F0-9]{40}$/.test(raw) ? raw : null;
}

async function loadViemRuntime() {
  const viem = await import('viem');
  const accounts = await import('viem/accounts');
  return { ...viem, ...accounts };
}

function buildChain(chainId, rpcUrl) {
  return {
    id: chainId,
    name: chainId === 1 ? 'Ethereum' : `Chain ${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
  };
}

async function createPublicClientFor(chainId, rpcUrl) {
  if (!isSecureHttpUrlOrLocal(rpcUrl)) return null;
  const { createPublicClient, http } = await loadViemRuntime();
  return createPublicClient({
    chain: buildChain(chainId, rpcUrl),
    transport: http(rpcUrl),
  });
}

async function resolveSignerAddress(options) {
  const envPrivateKey = String(options.privateKey || process.env.PANDORA_PRIVATE_KEY || process.env.PRIVATE_KEY || '').trim();
  if (envPrivateKey) {
    const { privateKeyToAccount } = await loadViemRuntime();
    return {
      address: privateKeyToAccount(envPrivateKey).address,
      source: options.privateKey ? 'flag-private-key' : 'env-private-key',
      privateKey: envPrivateKey,
    };
  }

  if (String(options.profileId || '').trim() || String(options.profileFile || '').trim()) {
    const chainId = Number.isInteger(Number(options.chainId)) && Number(options.chainId) > 0 ? Number(options.chainId) : 1;
    const rpcUrl = String(options.rpcUrl || process.env.RPC_URL || DEFAULT_RPC_BY_CHAIN_ID[chainId] || '').trim();
    if (!isSecureHttpUrlOrLocal(rpcUrl)) {
      return {
        address: null,
        source: 'profile-unresolved',
        privateKey: null,
        diagnostics: ['Profile-based signer resolution needs --rpc-url <url> (or RPC_URL) on the Pandora venue.'],
      };
    }
    const viemRuntime = await loadViemRuntime();
    const materialized = await materializeExecutionSigner({
      privateKey: null,
      profileId: options.profileId || null,
      profileFile: options.profileFile || null,
      chainId,
      chain: buildChain(chainId, rpcUrl),
      rpcUrl,
      viemRuntime,
      env: process.env,
      requireSigner: true,
      mode: 'read',
      liveRequested: false,
      mutating: false,
      command: 'fund-check',
      toolFamily: 'fund-check',
      metadata: { source: 'fund-check' },
    });
    return {
      address: normalizeAddress(materialized && materialized.signerAddress),
      source: materialized && materialized.signerMetadata && materialized.signerMetadata.backend
        ? materialized.signerMetadata.backend
        : 'profile',
      privateKey: null,
      diagnostics: [],
    };
  }

  return {
    address: null,
    source: 'unresolved',
    privateKey: null,
    diagnostics: ['Pass --private-key or --profile-id/--profile-file so fund-check can inspect signer-side balances.'],
  };
}

async function readVenueBalances({ chainId, rpcUrl, walletAddress, usdcAddress }) {
  const publicClient = await createPublicClientFor(chainId, rpcUrl);
  if (!publicClient || !walletAddress) {
    return {
      nativeBalance: null,
      usdcBalance: null,
      diagnostics: ['Venue balance read skipped because wallet address or RPC URL is unavailable.'],
    };
  }

  const diagnostics = [];
  let nativeRaw = null;
  let usdcRaw = null;
  try {
    nativeRaw = await publicClient.getBalance({ address: walletAddress });
  } catch (error) {
    diagnostics.push(`Native balance read failed: ${error && error.message ? error.message : String(error)}`);
  }
  if (normalizeAddress(usdcAddress)) {
    try {
      usdcRaw = await publicClient.readContract({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [walletAddress],
      });
    } catch (error) {
      diagnostics.push(`USDC balance read failed: ${error && error.message ? error.message : String(error)}`);
    }
  }

  return {
    nativeBalance: nativeRaw === null ? null : Number(toRawNumberString(nativeRaw, 18)),
    usdcBalance: usdcRaw === null ? null : Number(toRawNumberString(usdcRaw, 6)),
    diagnostics,
  };
}

function pushSuggestion(target, suggestion) {
  if (!suggestion) return;
  target.push(suggestion);
}

function parseFundCheckFlags(args, deps) {
  const { CliError, parseAddressFlag, parsePrivateKeyFlag, parsePositiveInteger, parseInteger, parseProbabilityPercent } = deps;
  const options = {
    stateFile: null,
    strategyHash: null,
    pandoraMarketAddress: null,
    polymarketMarketId: null,
    polymarketSlug: null,
    targetPct: null,
    trustDeploy: false,
    manifestFile: null,
    driftTriggerBps: 150,
    hedgeTriggerUsdc: 10,
    indexerUrl: null,
    timeoutMs: 60_000,
    polymarketHost: null,
    polymarketGammaUrl: null,
    polymarketGammaMockUrl: null,
    polymarketMockUrl: null,
    rpcUrl: null,
    polymarketRpcUrl: null,
    chainId: 1,
    privateKey: null,
    profileId: null,
    profileFile: null,
    funder: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i]);
    if (token === '--state-file') {
      options.stateFile = requireFlagValue(args, i, '--state-file', CliError).trim();
      i += 1;
      continue;
    }
    if (token === '--strategy-hash') {
      options.strategyHash = requireFlagValue(args, i, '--strategy-hash', CliError).trim();
      i += 1;
      continue;
    }
    if (token === '--pandora-market-address' || token === '--market-address') {
      options.pandoraMarketAddress = parseAddressFlag(requireFlagValue(args, i, token, CliError), token);
      i += 1;
      continue;
    }
    if (token === '--polymarket-market-id') {
      options.polymarketMarketId = requireFlagValue(args, i, '--polymarket-market-id', CliError).trim();
      i += 1;
      continue;
    }
    if (token === '--polymarket-slug') {
      options.polymarketSlug = requireFlagValue(args, i, '--polymarket-slug', CliError).trim();
      i += 1;
      continue;
    }
    if (token === '--target-pct') {
      options.targetPct = parseProbabilityPercent(requireFlagValue(args, i, '--target-pct', CliError), '--target-pct');
      i += 1;
      continue;
    }
    if (token === '--trust-deploy') {
      options.trustDeploy = true;
      continue;
    }
    if (token === '--manifest-file') {
      options.manifestFile = requireFlagValue(args, i, '--manifest-file', CliError).trim();
      i += 1;
      continue;
    }
    if (token === '--drift-trigger-bps') {
      options.driftTriggerBps = parsePositiveInteger(requireFlagValue(args, i, '--drift-trigger-bps', CliError), '--drift-trigger-bps');
      i += 1;
      continue;
    }
    if (token === '--hedge-trigger-usdc') {
      options.hedgeTriggerUsdc = Number(requireFlagValue(args, i, '--hedge-trigger-usdc', CliError));
      i += 1;
      continue;
    }
    if (token === '--indexer-url') {
      options.indexerUrl = requireFlagValue(args, i, '--indexer-url', CliError).trim();
      i += 1;
      continue;
    }
    if (token === '--timeout-ms') {
      options.timeoutMs = parsePositiveInteger(requireFlagValue(args, i, '--timeout-ms', CliError), '--timeout-ms');
      i += 1;
      continue;
    }
    if (token === '--polymarket-host') {
      options.polymarketHost = requireFlagValue(args, i, '--polymarket-host', CliError).trim();
      i += 1;
      continue;
    }
    if (token === '--polymarket-gamma-url') {
      options.polymarketGammaUrl = requireFlagValue(args, i, '--polymarket-gamma-url', CliError).trim();
      i += 1;
      continue;
    }
    if (token === '--polymarket-gamma-mock-url') {
      options.polymarketGammaMockUrl = requireFlagValue(args, i, '--polymarket-gamma-mock-url', CliError).trim();
      i += 1;
      continue;
    }
    if (token === '--polymarket-mock-url') {
      options.polymarketMockUrl = requireFlagValue(args, i, '--polymarket-mock-url', CliError).trim();
      i += 1;
      continue;
    }
    if (token === '--rpc-url') {
      const value = requireFlagValue(args, i, '--rpc-url', CliError).trim();
      if (!isSecureHttpUrlOrLocal(value)) {
        throw new CliError('INVALID_FLAG_VALUE', '--rpc-url must use https:// (or localhost for local testing).');
      }
      options.rpcUrl = value;
      i += 1;
      continue;
    }
    if (token === '--polymarket-rpc-url') {
      const value = requireFlagValue(args, i, '--polymarket-rpc-url', CliError).trim();
      if (!isSecureHttpUrlOrLocal(value)) {
        throw new CliError('INVALID_FLAG_VALUE', '--polymarket-rpc-url must use https:// (or localhost for local testing).');
      }
      options.polymarketRpcUrl = value;
      i += 1;
      continue;
    }
    if (token === '--chain-id') {
      options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id', CliError), '--chain-id');
      i += 1;
      continue;
    }
    if (token === '--private-key') {
      options.privateKey = parsePrivateKeyFlag(requireFlagValue(args, i, '--private-key', CliError), '--private-key');
      i += 1;
      continue;
    }
    if (token === '--profile-id') {
      options.profileId = requireFlagValue(args, i, '--profile-id', CliError).trim();
      i += 1;
      continue;
    }
    if (token === '--profile-file') {
      options.profileFile = requireFlagValue(args, i, '--profile-file', CliError).trim();
      i += 1;
      continue;
    }
    if (token === '--funder') {
      options.funder = parseAddressFlag(requireFlagValue(args, i, '--funder', CliError), '--funder');
      i += 1;
      continue;
    }
    throw new CliError('UNKNOWN_FLAG', `Unknown flag for fund-check: ${token}`);
  }

  if (!options.stateFile && !options.strategyHash && !options.pandoraMarketAddress) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'fund-check requires --state-file, --strategy-hash, or --market-address <address>.');
  }
  return options;
}

function renderFundCheckTable(data) {
  console.log('Fund Check');
  const rows = [
    ['strategyHash', data.strategyHash || ''],
    ['stateFile', data.stateFile || ''],
    ['pandoraRequiredUsdc', data.pandora && data.pandora.requiredUsdc !== undefined ? data.pandora.requiredUsdc : ''],
    ['pandoraAvailableUsdc', data.pandora && data.pandora.availableUsdc !== undefined ? data.pandora.availableUsdc : ''],
    ['pandoraShortfallUsdc', data.pandora && data.pandora.shortfallUsdc !== undefined ? data.pandora.shortfallUsdc : ''],
    ['polymarketRequiredUsdc', data.polymarket && data.polymarket.requiredUsdc !== undefined ? data.polymarket.requiredUsdc : ''],
    ['polymarketAvailableUsdc', data.polymarket && data.polymarket.availableUsdc !== undefined ? data.polymarket.availableUsdc : ''],
    ['polymarketShortfallUsdc', data.polymarket && data.polymarket.shortfallUsdc !== undefined ? data.polymarket.shortfallUsdc : ''],
    ['recommendedAction', data.actionability && data.actionability.recommendedAction ? data.actionability.recommendedAction : ''],
  ];
  for (const [label, value] of rows) {
    console.log(`${label}: ${value}`);
  }
}

function toBalanceNumber(snapshot) {
  if (!snapshot || snapshot.formatted === null || snapshot.formatted === undefined) return null;
  return toNumber(snapshot.formatted);
}

function buildSuggestion(id, severity, action, message, command) {
  return { id, severity, action, message, command: command || null };
}

function determinePandoraRequirement(live, targetPct) {
  const reserveYesUsdc = toNumber(live && live.reserveYesUsdc);
  const reserveNoUsdc = toNumber(live && live.reserveNoUsdc);
  if (reserveYesUsdc === null || reserveNoUsdc === null) return null;
  const feeTier = 3000;
  const targeting = planAmmTradeToTargetYesPct({
    reserveYesUsdc,
    reserveNoUsdc,
    targetYesPct: targetPct,
    feeTier,
  });
  if (!targeting || targeting.targetReachable === false || !Number.isFinite(Number(targeting.requiredAmountUsdc))) {
    return { targeting, swap: null, hedge: null };
  }
  const swap = simulateDirectionalSwap({
    reserveYesUsdc,
    reserveNoUsdc,
    side: targeting.requiredSide,
    volumeUsdc: targeting.requiredAmountUsdc,
    feeTier,
  });
  const hedge = buildMirrorHedgeCalc({
    reserveYesUsdc: swap.reserveYesUsdc,
    reserveNoUsdc: swap.reserveNoUsdc,
    polymarketYesPct: live && live.sourceMarket ? live.sourceMarket.yesPct : null,
    hedgeRatio: 1,
    hedgeCostBps: 35,
    feeTier,
  });
  return { targeting, swap, hedge };
}

function buildShortfall(required, available) {
  if (!Number.isFinite(required)) return null;
  if (!Number.isFinite(available)) return round(required, 6);
  return round(Math.max(0, required - available), 6);
}

function makeCapabilitiesLikeActionability(live) {
  return live && live.actionability ? live.actionability : { status: 'monitor', urgency: 'low', recommendedAction: 'monitor', diagnostics: [] };
}

function createRunFundCheckCommand(deps) {
  const CliError = deps.CliError;
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const maybeLoadIndexerEnv = requireDep(deps, 'maybeLoadIndexerEnv');
  const maybeLoadTradeEnv = requireDep(deps, 'maybeLoadTradeEnv');
  const resolveIndexerUrl = requireDep(deps, 'resolveIndexerUrl');
  const resolveTrustedDeployPair = requireDep(deps, 'resolveTrustedDeployPair');
  const verifyMirror = requireDep(deps, 'verifyMirror');
  const coerceMirrorServiceError = requireDep(deps, 'coerceMirrorServiceError');
  const toMirrorStatusLivePayload = requireDep(deps, 'toMirrorStatusLivePayload');
  const runPolymarketCheck = requireDep(deps, 'runPolymarketCheck');
  const runPolymarketBalance = requireDep(deps, 'runPolymarketBalance');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const parsePrivateKeyFlag = requireDep(deps, 'parsePrivateKeyFlag');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parseInteger = requireDep(deps, 'parseInteger');
  const parseProbabilityPercent = requireDep(deps, 'parseProbabilityPercent');
  const resolveSignerAddressFn = typeof deps.resolveSignerAddress === 'function'
    ? deps.resolveSignerAddress
    : resolveSignerAddress;
  const readVenueBalancesFn = typeof deps.readVenueBalances === 'function'
    ? deps.readVenueBalances
    : readVenueBalances;

  return async function runFundCheckCommand(args, context) {
    const usage =
      'pandora [--output table|json] fund-check --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) [--target-pct <0-100>] [--trust-deploy] [--manifest-file <path>] [--indexer-url <url>] [--timeout-ms <ms>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]';

    if (includesHelpFlag(args)) {
      if (context.outputMode === 'json') {
        emitSuccess(
          context.outputMode,
          'fund-check.help',
          commandHelpPayload(usage, [
            'fund-check estimates immediate hedge funding needs for mirror operators. It is the unified wallet shortfall surface that combines live mirror sizing, Pandora signer balances, and Polymarket readiness/balances into one machine-usable payload.',
            'Use it before live mirror rebalance or hedge actions when an agent needs exact shortfalls and next commands instead of composing mirror status, mirror calc, polymarket check, and polymarket balance separately.',
          ]),
        );
      } else {
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    maybeLoadIndexerEnv({});
    maybeLoadTradeEnv({});
    const options = parseFundCheckFlags(args, {
      CliError,
      parseAddressFlag,
      parsePrivateKeyFlag,
      parsePositiveInteger,
      parseInteger,
      parseProbabilityPercent,
    });

    const loaded = resolveMirrorSurfaceState({
      stateFile: options.stateFile || null,
      strategyHash: options.strategyHash || null,
      pandoraMarketAddress: options.pandoraMarketAddress || null,
      polymarketMarketId: options.polymarketMarketId || null,
      polymarketSlug: options.polymarketSlug || null,
    });
    const selector = {
      pandoraMarketAddress: options.pandoraMarketAddress || loaded.state.pandoraMarketAddress || null,
      polymarketMarketId: options.polymarketMarketId || loaded.state.polymarketMarketId || null,
      polymarketSlug: options.polymarketSlug || loaded.state.polymarketSlug || null,
    };
    if (!selector.pandoraMarketAddress) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'fund-check requires --pandora-market-address/--market-address (or a state file containing it).');
    }
    if (!selector.polymarketMarketId && !selector.polymarketSlug) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'fund-check requires --polymarket-market-id or --polymarket-slug (or a state file containing one).');
    }

    const runtime = buildMirrorRuntimeTelemetry({
      state: loaded.state,
      stateFile: loaded.filePath,
      daemonStatus: resolveMirrorSurfaceDaemonStatus(selector, loaded.state),
    });

    let trustDeploy = false;
    if (options.trustDeploy) {
      resolveTrustedDeployPair({ ...selector, manifestFile: options.manifestFile });
      trustDeploy = true;
    }

    const indexerUrl = resolveIndexerUrl(options.indexerUrl || null);
    let verifyPayload;
    try {
      verifyPayload = await verifyMirror({
        indexerUrl,
        timeoutMs: options.timeoutMs,
        pandoraMarketAddress: selector.pandoraMarketAddress,
        polymarketMarketId: selector.polymarketMarketId,
        polymarketSlug: selector.polymarketSlug,
        polymarketHost: options.polymarketHost,
        polymarketGammaUrl: options.polymarketGammaUrl,
        polymarketGammaMockUrl: options.polymarketGammaMockUrl,
        polymarketMockUrl: options.polymarketMockUrl,
        trustDeploy,
        includeSimilarity: false,
        allowRuleMismatch: false,
      });
    } catch (err) {
      throw coerceMirrorServiceError(err, 'FUND_CHECK_VERIFY_FAILED');
    }

    const live = await toMirrorStatusLivePayload(verifyPayload, loaded.state, {
      driftTriggerBps: options.driftTriggerBps,
      hedgeTriggerUsdc: options.hedgeTriggerUsdc,
      timeoutMs: options.timeoutMs,
      polymarketHost: options.polymarketHost,
      polymarketMockUrl: options.polymarketMockUrl,
    });

    const targetPct = options.targetPct !== null && options.targetPct !== undefined
      ? options.targetPct
      : toNumber(live && live.sourceMarket && live.sourceMarket.yesPct);
    const requirement = determinePandoraRequirement(live, targetPct);
    const signer = await resolveSignerAddressFn(options);
    const chainId = Number.isInteger(Number(options.chainId)) && Number(options.chainId) > 0 ? Number(options.chainId) : 1;
    const pandoraRpcUrl = String(options.rpcUrl || process.env.RPC_URL || DEFAULT_RPC_BY_CHAIN_ID[chainId] || '').trim();
    const pandoraBalances = await readVenueBalancesFn({
      chainId,
      rpcUrl: pandoraRpcUrl,
      walletAddress: signer.address,
      usdcAddress: verifyPayload && verifyPayload.pandora ? verifyPayload.pandora.usdcAddress || process.env.USDC_ADDRESS || null : process.env.USDC_ADDRESS || null,
    });

    const polymarketPrivateKey = String(options.privateKey || process.env.POLYMARKET_PRIVATE_KEY || process.env.PANDORA_PRIVATE_KEY || process.env.PRIVATE_KEY || '').trim() || null;
    let polymarketCheck = null;
    let polymarketBalance = null;
    try {
      polymarketCheck = await runPolymarketCheck({
        privateKey: polymarketPrivateKey,
        funder: options.funder || process.env.POLYMARKET_FUNDER || null,
        rpcUrl: options.polymarketRpcUrl || options.rpcUrl || process.env.POLYMARKET_RPC_URL || process.env.RPC_URL || null,
        polymarketHost: options.polymarketHost,
        polymarketMockUrl: options.polymarketMockUrl,
        timeoutMs: options.timeoutMs,
      });
    } catch (error) {
      polymarketCheck = {
        readyForLive: false,
        diagnostics: [`Polymarket check failed: ${error && error.message ? error.message : String(error)}`],
        runtime: {
          signerAddress: null,
          ownerAddress: null,
          funderAddress: options.funder || process.env.POLYMARKET_FUNDER || null,
        },
        approvals: { missingCount: null },
      };
    }
    try {
      polymarketBalance = await runPolymarketBalance({
        privateKey: polymarketPrivateKey,
        funder: options.funder || process.env.POLYMARKET_FUNDER || null,
        rpcUrl: options.polymarketRpcUrl || options.rpcUrl || process.env.POLYMARKET_RPC_URL || process.env.RPC_URL || null,
      });
    } catch (error) {
      polymarketBalance = {
        balances: {},
        diagnostics: [`Polymarket balance failed: ${error && error.message ? error.message : String(error)}`],
      };
    }

    const pandoraRequiredUsdc = requirement && requirement.targeting && Number.isFinite(Number(requirement.targeting.requiredAmountUsdc))
      ? Number(requirement.targeting.requiredAmountUsdc)
      : null;
    const pandoraAvailableUsdc = toNumber(pandoraBalances.usdcBalance);
    const pandoraShortfallUsdc = buildShortfall(pandoraRequiredUsdc, pandoraAvailableUsdc);

    const polymarketRequiredUsdc = requirement && requirement.hedge && requirement.hedge.metrics
      ? Math.abs(Number(requirement.hedge.metrics.targetHedgeUsdcSigned || 0))
      : Math.abs(Number(live && live.hedgeGapUsdc || 0)) || null;
    const polymarketAvailableUsdc = toBalanceNumber(
      polymarketBalance && polymarketBalance.balances
        ? polymarketBalance.balances.owner || polymarketBalance.balances.funder || polymarketBalance.balances.wallet || null
        : null,
    );
    const polymarketShortfallUsdc = buildShortfall(polymarketRequiredUsdc, polymarketAvailableUsdc);

    const suggestions = [];
    if (Number.isFinite(pandoraShortfallUsdc) && pandoraShortfallUsdc > 0) {
      pushSuggestion(
        suggestions,
        buildSuggestion(
          'fund-pandora-usdc',
          'warn',
          'fund-pandora-wallet',
          `Pandora signer wallet is short ${pandoraShortfallUsdc} USDC for the target rebalance.`,
          null,
        ),
      );
    }
    if (Number.isFinite(polymarketShortfallUsdc) && polymarketShortfallUsdc > 0) {
      pushSuggestion(
        suggestions,
        buildSuggestion(
          'fund-polymarket-usdc',
          'warn',
          'fund-polymarket-proxy',
          `Polymarket owner/funder wallet is short ${polymarketShortfallUsdc} USDC for the target hedge.`,
          `pandora polymarket deposit --amount-usdc ${polymarketShortfallUsdc}`,
        ),
      );
      if (Number.isFinite(pandoraAvailableUsdc) && pandoraAvailableUsdc >= polymarketShortfallUsdc) {
        pushSuggestion(
          suggestions,
          buildSuggestion(
            'bridge-plan-polymarket',
            'warn',
            'plan-bridge-to-polygon',
            `Ethereum-side Pandora liquidity can cover the Polygon shortfall; plan a cross-chain bridge for ${polymarketShortfallUsdc} USDC before depositing to the proxy.`,
            `pandora bridge plan --target polymarket --amount-usdc ${polymarketShortfallUsdc}`,
          ),
        );
      }
    }
    if (
      Number.isFinite(pandoraShortfallUsdc)
      && pandoraShortfallUsdc > 0
      && Number.isFinite(polymarketAvailableUsdc)
      && polymarketAvailableUsdc >= pandoraShortfallUsdc
    ) {
      pushSuggestion(
        suggestions,
        buildSuggestion(
          'bridge-plan-pandora',
          'warn',
          'plan-bridge-to-ethereum',
          `Polygon-side liquidity can cover the Pandora signer shortfall; plan a cross-chain bridge for ${pandoraShortfallUsdc} USDC back to Ethereum.`,
          `pandora bridge plan --target pandora --amount-usdc ${pandoraShortfallUsdc}`,
        ),
      );
    }
    if (polymarketCheck && polymarketCheck.approvals && Number(polymarketCheck.approvals.missingCount) > 0) {
      pushSuggestion(
        suggestions,
        buildSuggestion(
          'polymarket-approve',
          'warn',
          'approve-polymarket-spenders',
          `${polymarketCheck.approvals.missingCount} Polymarket approval checks are missing.`,
          'pandora polymarket approve --dry-run',
        ),
      );
    }
    if (polymarketCheck && polymarketCheck.readyForLive === false) {
      pushSuggestion(
        suggestions,
        buildSuggestion(
          'polymarket-readiness',
          'warn',
          'inspect-polymarket-readiness',
          'Polymarket readiness is not yet green for live hedging.',
          'pandora polymarket check',
        ),
      );
    }
    if (live && live.actionability && live.actionability.status === 'blocked') {
      pushSuggestion(
        suggestions,
        buildSuggestion(
          'mirror-verify-gates',
          'error',
          'inspect-verify-gates',
          'Mirror verification gates are blocking action.',
          `pandora mirror verify --market-address ${selector.pandoraMarketAddress} ${selector.polymarketMarketId ? `--polymarket-market-id ${selector.polymarketMarketId}` : `--polymarket-slug ${selector.polymarketSlug}`}`,
        ),
      );
    }

    emitSuccess(
      context.outputMode,
      'fund-check',
      {
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        stateFile: loaded.filePath,
        strategyHash: loaded.state.strategyHash || options.strategyHash || null,
        selector,
        targetPct,
        actionability: makeCapabilitiesLikeActionability(live),
        pandora: {
          wallet: signer.address,
          walletSource: signer.source,
          requiredSide: requirement && requirement.targeting ? requirement.targeting.requiredSide : null,
          requiredUsdc: pandoraRequiredUsdc,
          availableUsdc: pandoraAvailableUsdc,
          shortfallUsdc: pandoraShortfallUsdc,
          nativeBalance: pandoraBalances.nativeBalance,
          diagnostics: []
            .concat(Array.isArray(signer.diagnostics) ? signer.diagnostics : [])
            .concat(Array.isArray(pandoraBalances.diagnostics) ? pandoraBalances.diagnostics : []),
        },
        polymarket: {
          readyForLive: polymarketCheck ? Boolean(polymarketCheck.readyForLive) : false,
          signerAddress: polymarketCheck && polymarketCheck.runtime ? polymarketCheck.runtime.signerAddress : null,
          ownerAddress: polymarketCheck && polymarketCheck.runtime ? polymarketCheck.runtime.ownerAddress : null,
          funderAddress: polymarketCheck && polymarketCheck.runtime ? polymarketCheck.runtime.funderAddress : null,
          requiredUsdc: polymarketRequiredUsdc,
          availableUsdc: polymarketAvailableUsdc,
          shortfallUsdc: polymarketShortfallUsdc,
          balances: polymarketBalance && polymarketBalance.balances ? polymarketBalance.balances : {},
          check: polymarketCheck,
        },
        mirror: {
          currentYesPct: live && live.pandoraMarket ? live.pandoraMarket.yesPct : null,
          sourceYesPct: live && live.sourceMarket ? live.sourceMarket.yesPct : null,
          targeting: requirement ? requirement.targeting : null,
          hedge: requirement && requirement.hedge ? requirement.hedge.metrics : null,
          crossVenue: live && live.crossVenue ? live.crossVenue : null,
        },
        runtime: {
          health: runtime.health || null,
          daemon: runtime.daemon || null,
        },
        suggestions,
        diagnostics: []
          .concat(Array.isArray(live && live.verifyDiagnostics) ? live.verifyDiagnostics : [])
          .concat(Array.isArray(live && live.actionableDiagnostics) ? live.actionableDiagnostics : [])
          .concat(Array.isArray(polymarketCheck && polymarketCheck.diagnostics) ? polymarketCheck.diagnostics : [])
          .concat(Array.isArray(polymarketBalance && polymarketBalance.diagnostics) ? polymarketBalance.diagnostics : [])
          .concat(Array.isArray(signer.diagnostics) ? signer.diagnostics : []),
      },
      renderFundCheckTable,
    );
  };
}

module.exports = {
  createRunFundCheckCommand,
};
