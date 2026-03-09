const {
  buildMirrorDashboardItem,
  buildMirrorDashboardPayload,
  loadMirrorDashboardContexts,
  resolveMirrorSurfaceDaemonStatus,
} = require('./mirror_surface_service.cjs');
const { buildMirrorRuntimeTelemetry } = require('./mirror_sync/state.cjs');
const { DEFAULT_RPC_BY_CHAIN_ID, DEFAULT_USDC } = require('./shared/constants.cjs');
const { isSecureHttpUrlOrLocal } = require('./shared/utils.cjs');

const DASHBOARD_SCHEMA_VERSION = '1.0.0';
const DEFAULT_DRIFT_TRIGGER_BPS = 150;
const DEFAULT_HEDGE_TRIGGER_USDC = 10;

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`dashboard/fund-check service requires deps.${name}()`);
  }
  return deps[name];
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveInteger(value, flagName, CliError) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a positive integer.`);
  }
  return numeric;
}

function parsePositiveNumber(value, flagName, CliError) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a positive number.`);
  }
  return numeric;
}

function requireFlagValue(args, index, flagName, CliError) {
  if (index + 1 >= args.length || String(args[index + 1]).startsWith('--')) {
    throw new CliError('MISSING_REQUIRED_FLAG', `${flagName} requires a value.`);
  }
  return String(args[index + 1]);
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundNumber(value, decimals = 6) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return null;
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeAddress(value) {
  const raw = String(value || '').trim();
  return /^0x[a-fA-F0-9]{40}$/.test(raw) ? raw : null;
}

function isValidPrivateKey(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || '').trim());
}

async function loadViemRuntime() {
  const viem = await import('viem');
  return viem;
}

function buildChain(chainId, rpcUrl) {
  return {
    id: chainId,
    name: chainId === 1 ? 'Ethereum' : `Chain ${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
  };
}

function buildDisabledPortfolioSection(reason, extra = {}) {
  return {
    enabled: false,
    diagnostics: reason ? [reason] : [],
    ...extra,
  };
}

async function readPandoraWalletBalances(options = {}) {
  const walletAddress = normalizeAddress(options.walletAddress);
  const chainId = Number.isInteger(Number(options.chainId)) && Number(options.chainId) > 0
    ? Number(options.chainId)
    : 1;
  const rpcUrl = String(options.rpcUrl || process.env.RPC_URL || DEFAULT_RPC_BY_CHAIN_ID[chainId] || '').trim();
  const usdcAddress = normalizeAddress(options.usdcAddress || process.env.USDC || DEFAULT_USDC);
  const result = {
    enabled: Boolean(walletAddress),
    chainId,
    walletAddress: walletAddress || null,
    rpcUrl: rpcUrl || null,
    usdcAddress: usdcAddress || null,
    nativeBalance: null,
    usdcBalance: null,
    diagnostics: [],
  };

  if (!walletAddress) {
    result.enabled = false;
    result.diagnostics.push('Pandora liquid balance read skipped because no wallet address is available.');
    return result;
  }
  if (!isSecureHttpUrlOrLocal(rpcUrl)) {
    result.diagnostics.push('Pandora liquid balance read skipped because RPC URL is unavailable.');
    return result;
  }

  const { createPublicClient, http } = await loadViemRuntime();
  const publicClient = createPublicClient({
    chain: buildChain(chainId, rpcUrl),
    transport: http(rpcUrl),
  });

  try {
    const nativeRaw = await publicClient.getBalance({ address: walletAddress });
    result.nativeBalance = roundNumber(Number(nativeRaw) / 1e18, 6);
  } catch (error) {
    result.diagnostics.push(`Pandora native balance read failed: ${error && error.message ? error.message : String(error)}`);
  }

  if (usdcAddress) {
    try {
      const usdcRaw = await publicClient.readContract({
        address: usdcAddress,
        abi: [
          {
            type: 'function',
            stateMutability: 'view',
            name: 'balanceOf',
            inputs: [{ name: 'owner', type: 'address' }],
            outputs: [{ name: 'balance', type: 'uint256' }],
          },
        ],
        functionName: 'balanceOf',
        args: [walletAddress],
      });
      result.usdcBalance = roundNumber(Number(usdcRaw) / 1e6, 6);
    } catch (error) {
      result.diagnostics.push(`Pandora USDC balance read failed: ${error && error.message ? error.message : String(error)}`);
    }
  }

  return result;
}

function buildMirrorStatusCommand(item = {}, includeLive = true) {
  if (item.strategyHash) {
    return `pandora mirror status --strategy-hash ${item.strategyHash}${includeLive ? ' --with-live' : ''}`;
  }
  const selector = item.selector && typeof item.selector === 'object' ? item.selector : {};
  const parts = ['pandora mirror status'];
  if (selector.pandoraMarketAddress) {
    parts.push(`--pandora-market-address ${selector.pandoraMarketAddress}`);
  }
  if (selector.polymarketMarketId) {
    parts.push(`--polymarket-market-id ${selector.polymarketMarketId}`);
  } else if (selector.polymarketSlug) {
    parts.push(`--polymarket-slug ${selector.polymarketSlug}`);
  }
  if (includeLive) parts.push('--with-live');
  return parts.join(' ');
}

function buildMirrorSyncStatusCommand(item = {}) {
  if (item.strategyHash) {
    return `pandora mirror sync status --strategy-hash ${item.strategyHash}`;
  }
  return null;
}

function buildDashboardItemCommands(item = {}) {
  const commands = [];
  commands.push(buildMirrorStatusCommand(item, Boolean(item.liveAvailable)));
  const syncStatus = buildMirrorSyncStatusCommand(item);
  const runtimeStatus = item.runtime && item.runtime.health ? item.runtime.health.status : null;
  if (syncStatus && (runtimeStatus === 'blocked' || runtimeStatus === 'stale' || runtimeStatus === 'degraded' || runtimeStatus === 'error')) {
    commands.push(syncStatus);
  }
  return uniqueStrings(commands);
}

function parseDashboardFlags(args, CliError) {
  const options = {
    withLive: true,
    trustDeploy: false,
    manifestFile: null,
    driftTriggerBps: DEFAULT_DRIFT_TRIGGER_BPS,
    hedgeTriggerUsdc: DEFAULT_HEDGE_TRIGGER_USDC,
    watch: false,
    refreshMs: 5_000,
    iterations: null,
    wallet: null,
    chainId: 1,
    rpcUrl: null,
    polymarketRpcUrl: null,
    privateKey: null,
    profileId: null,
    profileFile: null,
    funder: null,
    usdc: null,
    polymarketHost: null,
    polymarketGammaUrl: null,
    polymarketGammaMockUrl: null,
    polymarketMockUrl: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i]);
    if (token === '--watch') {
      options.watch = true;
      continue;
    }
    if (token === '--refresh-ms') {
      options.refreshMs = parsePositiveInteger(
        requireFlagValue(args, i, '--refresh-ms', CliError),
        '--refresh-ms',
        CliError,
      );
      options.watch = true;
      i += 1;
      continue;
    }
    if (token === '--iterations') {
      options.iterations = parsePositiveInteger(
        requireFlagValue(args, i, '--iterations', CliError),
        '--iterations',
        CliError,
      );
      if (options.iterations > 1) {
        options.watch = true;
      }
      i += 1;
      continue;
    }
    if (token === '--with-live') {
      options.withLive = true;
      continue;
    }
    if (token === '--no-live') {
      options.withLive = false;
      continue;
    }
    if (token === '--trust-deploy') {
      options.trustDeploy = true;
      continue;
    }
    if (token === '--manifest-file') {
      options.manifestFile = requireFlagValue(args, i, '--manifest-file', CliError);
      i += 1;
      continue;
    }
    if (token === '--drift-trigger-bps') {
      options.driftTriggerBps = parsePositiveInteger(
        requireFlagValue(args, i, '--drift-trigger-bps', CliError),
        '--drift-trigger-bps',
        CliError,
      );
      i += 1;
      continue;
    }
    if (token === '--hedge-trigger-usdc') {
      options.hedgeTriggerUsdc = parsePositiveNumber(
        requireFlagValue(args, i, '--hedge-trigger-usdc', CliError),
        '--hedge-trigger-usdc',
        CliError,
      );
      i += 1;
      continue;
    }
    if (token === '--wallet') {
      options.wallet = normalizeAddress(requireFlagValue(args, i, '--wallet', CliError));
      if (!options.wallet) {
        throw new CliError('INVALID_FLAG_VALUE', '--wallet must be an EVM address.');
      }
      i += 1;
      continue;
    }
    if (token === '--chain-id') {
      options.chainId = parsePositiveInteger(
        requireFlagValue(args, i, '--chain-id', CliError),
        '--chain-id',
        CliError,
      );
      i += 1;
      continue;
    }
    if (token === '--rpc-url') {
      options.rpcUrl = requireFlagValue(args, i, '--rpc-url', CliError);
      i += 1;
      continue;
    }
    if (token === '--polymarket-rpc-url') {
      options.polymarketRpcUrl = requireFlagValue(args, i, '--polymarket-rpc-url', CliError);
      i += 1;
      continue;
    }
    if (token === '--private-key') {
      options.privateKey = requireFlagValue(args, i, '--private-key', CliError);
      if (!isValidPrivateKey(options.privateKey)) {
        throw new CliError('INVALID_FLAG_VALUE', '--private-key must be a 32-byte hex key.');
      }
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
      options.funder = normalizeAddress(requireFlagValue(args, i, '--funder', CliError));
      if (!options.funder) {
        throw new CliError('INVALID_FLAG_VALUE', '--funder must be an EVM address.');
      }
      i += 1;
      continue;
    }
    if (token === '--usdc') {
      options.usdc = normalizeAddress(requireFlagValue(args, i, '--usdc', CliError));
      if (!options.usdc) {
        throw new CliError('INVALID_FLAG_VALUE', '--usdc must be an EVM address.');
      }
      i += 1;
      continue;
    }
    if (token === '--polymarket-host') {
      options.polymarketHost = requireFlagValue(args, i, '--polymarket-host', CliError);
      i += 1;
      continue;
    }
    if (token === '--polymarket-gamma-url') {
      options.polymarketGammaUrl = requireFlagValue(args, i, '--polymarket-gamma-url', CliError);
      i += 1;
      continue;
    }
    if (token === '--polymarket-gamma-mock-url') {
      options.polymarketGammaMockUrl = requireFlagValue(args, i, '--polymarket-gamma-mock-url', CliError);
      i += 1;
      continue;
    }
    if (token === '--polymarket-mock-url') {
      options.polymarketMockUrl = requireFlagValue(args, i, '--polymarket-mock-url', CliError);
      i += 1;
      continue;
    }
    throw new CliError('UNKNOWN_FLAG', `Unknown flag for dashboard: ${token}`);
  }

  return options;
}

async function collectDashboardItems(options = {}, deps = {}) {
  const contexts = (deps.loadMirrorDashboardContexts || loadMirrorDashboardContexts)();
  const runtimeBuilder = deps.buildMirrorRuntimeTelemetry || buildMirrorRuntimeTelemetry;
  const verifyMirror = requireDep(deps, 'verifyMirror');
  const toMirrorStatusLivePayload = requireDep(deps, 'toMirrorStatusLivePayload');
  const resolveTrustedDeployPair = requireDep(deps, 'resolveTrustedDeployPair');
  const items = [];
  const diagnostics = [];

  for (const context of contexts) {
    const selector = context && context.selector && typeof context.selector === 'object'
      ? context.selector
      : {};
    const runtime = runtimeBuilder({
      state: context.state || {},
      stateFile: context.stateFile || null,
      daemonStatus: context.daemonStatus || resolveMirrorSurfaceDaemonStatus(selector, context.state || {}),
    });
    let live = null;
    const itemDiagnostics = [];

    if (options.withLive) {
      try {
        let trustDeploy = false;
        if (options.trustDeploy) {
          resolveTrustedDeployPair({
            pandoraMarketAddress: selector.pandoraMarketAddress || null,
            polymarketMarketId: selector.polymarketMarketId || null,
            polymarketSlug: selector.polymarketSlug || null,
            manifestFile: options.manifestFile || null,
          });
          trustDeploy = true;
        }
        const verifyPayload = await verifyMirror({
          indexerUrl: options.indexerUrl || null,
          timeoutMs: options.timeoutMs || null,
          pandoraMarketAddress: selector.pandoraMarketAddress || null,
          polymarketMarketId: selector.polymarketMarketId || null,
          polymarketSlug: selector.polymarketSlug || null,
          polymarketHost: options.polymarketHost || null,
          polymarketGammaUrl: options.polymarketGammaUrl || null,
          polymarketGammaMockUrl: options.polymarketGammaMockUrl || null,
          polymarketMockUrl: options.polymarketMockUrl || null,
          trustDeploy,
          includeSimilarity: false,
          allowRuleMismatch: false,
        });
        live = await toMirrorStatusLivePayload(verifyPayload, context.state || {}, {
          driftTriggerBps: options.driftTriggerBps,
          hedgeTriggerUsdc: options.hedgeTriggerUsdc,
          timeoutMs: options.timeoutMs || null,
          polymarketHost: options.polymarketHost || null,
          polymarketMockUrl: options.polymarketMockUrl || null,
        });
      } catch (error) {
        itemDiagnostics.push(error && error.message ? error.message : String(error));
      }
    }

    const item = buildMirrorDashboardItem({
      strategyHash: context.strategyHash || null,
      stateFile: context.stateFile || null,
      selector,
      state: context.state || {},
      runtime,
      live,
      diagnostics: itemDiagnostics,
    });
    item.suggestedNextCommands = buildDashboardItemCommands(item);
    items.push(item);
  }

  return { items, diagnostics };
}

function buildClaimableSummary(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const claimableItems = items
    .filter((item) => item && item.hasClaimableExposure)
    .map((item) => ({
      marketAddress: item.marketAddress || null,
      question: item.question || null,
      estimatedClaimUsdc: item.exposure && item.exposure.claimable ? item.exposure.claimable.estimatedClaimUsdc || null : null,
      pollFinalized: Boolean(item.exposure && item.exposure.claimable && item.exposure.claimable.pollFinalized),
      pollAnswer: item.exposure && item.exposure.claimable ? item.exposure.claimable.pollAnswer || null : null,
      diagnostics: Array.isArray(item.diagnostics) ? item.diagnostics : [],
    }));
  const estimatedClaimUsdcTotal = roundNumber(
    claimableItems.reduce((sum, item) => sum + (toFiniteNumber(item.estimatedClaimUsdc) || 0), 0),
    6,
  );
  const finalizedCount = claimableItems.filter((item) => item.pollFinalized).length;
  return {
    enabled: true,
    wallet: payload.wallet || null,
    walletSource: payload.walletSource || null,
    marketCount: claimableItems.length,
    ownedMarketCount: Number.isInteger(payload.count) ? payload.count : items.length,
    finalizedCount,
    pendingCount: Math.max(0, claimableItems.length - finalizedCount),
    estimatedClaimUsdcTotal,
    items: claimableItems,
    diagnostics: Array.isArray(payload.diagnostics) ? payload.diagnostics : [],
  };
}

function buildPolymarketLiquidCapitalSummary(payload = {}) {
  const runtime = payload.runtime && typeof payload.runtime === 'object' ? payload.runtime : {};
  const balances = payload.balances && typeof payload.balances === 'object' ? payload.balances : {};
  const roleAddresses = {
    wallet: payload.requestedWallet || null,
    signer: runtime.signerAddress || null,
    funder: runtime.funderAddress || null,
    owner: runtime.ownerAddress || null,
  };
  const distinctBalances = new Map();
  for (const [role, address] of Object.entries(roleAddresses)) {
    const normalized = normalizeAddress(address);
    if (!normalized) continue;
    const snapshot = balances[role] && typeof balances[role] === 'object' ? balances[role] : null;
    const formatted = snapshot ? toFiniteNumber(snapshot.formatted) : null;
    if (!distinctBalances.has(normalized)) {
      distinctBalances.set(normalized, {
        address: normalized,
        roles: [role],
        usdcBalance: formatted,
        ok: Boolean(snapshot && snapshot.ok),
      });
      continue;
    }
    const entry = distinctBalances.get(normalized);
    if (!entry.roles.includes(role)) {
      entry.roles.push(role);
    }
    if (entry.usdcBalance === null && formatted !== null) {
      entry.usdcBalance = formatted;
    }
    entry.ok = entry.ok || Boolean(snapshot && snapshot.ok);
  }

  const entries = Array.from(distinctBalances.values());
  return {
    enabled: true,
    rpcUrl: runtime.rpcUrl || null,
    ownerAddress: runtime.ownerAddress || null,
    funderAddress: runtime.funderAddress || null,
    signerAddress: runtime.signerAddress || null,
    requestedWallet: payload.requestedWallet || null,
    balances,
    distinctWalletCount: entries.length,
    totalDistinctUsdc: roundNumber(
      entries.reduce((sum, entry) => sum + (toFiniteNumber(entry.usdcBalance) || 0), 0),
      6,
    ),
    entries,
    diagnostics: Array.isArray(payload.diagnostics) ? payload.diagnostics : [],
  };
}

async function collectDashboardPortfolio(options = {}, deps = {}, dashboardSummary = {}) {
  const portfolio = {
    enabled: false,
    wallet: options.wallet || null,
    active: {
      marketCount: Number.isInteger(dashboardSummary.marketCount) ? dashboardSummary.marketCount : 0,
      liveCount: Number.isInteger(dashboardSummary.liveCount) ? dashboardSummary.liveCount : 0,
      actionNeededCount: Number.isInteger(dashboardSummary.actionNeededCount) ? dashboardSummary.actionNeededCount : 0,
      blockedCount: Number.isInteger(dashboardSummary.blockedCount) ? dashboardSummary.blockedCount : 0,
    },
    claimable: buildDisabledPortfolioSection('Claimable overview unavailable.'),
    liquidCapital: buildDisabledPortfolioSection('Liquid capital overview unavailable.'),
    diagnostics: [],
  };

  const resolvedPrivateKey = options.privateKey || (
    !options.privateKey && isValidPrivateKey(process.env.PANDORA_PRIVATE_KEY || process.env.PRIVATE_KEY)
      ? String(process.env.PANDORA_PRIVATE_KEY || process.env.PRIVATE_KEY).trim()
      : null
  );

  if (typeof deps.discoverOwnedMarkets === 'function') {
    try {
      const discoveryPayload = await deps.discoverOwnedMarkets({
        wallet: options.wallet || null,
        privateKey: resolvedPrivateKey,
        profileId: options.profileId || null,
        profileFile: options.profileFile || null,
        chainId: options.chainId || 1,
        rpcUrl: options.rpcUrl || null,
        indexerUrl: options.indexerUrl || null,
        timeoutMs: options.timeoutMs || null,
      });
      portfolio.claimable = buildClaimableSummary(discoveryPayload);
      portfolio.wallet = portfolio.wallet || discoveryPayload.wallet || null;
      portfolio.enabled = true;
    } catch (error) {
      portfolio.claimable = buildDisabledPortfolioSection(
        `Claimable overview unavailable: ${error && error.message ? error.message : String(error)}.`,
      );
    }
  }

  const balanceReader = typeof deps.readPandoraWalletBalances === 'function'
    ? deps.readPandoraWalletBalances
    : readPandoraWalletBalances;
  let pandoraBalance = buildDisabledPortfolioSection('Pandora liquid balance unavailable.');
  if (portfolio.wallet || options.wallet) {
    try {
      pandoraBalance = await balanceReader({
        walletAddress: portfolio.wallet || options.wallet,
        chainId: options.chainId || 1,
        rpcUrl: options.rpcUrl || null,
        usdcAddress: options.usdc || null,
      });
      pandoraBalance.enabled = true;
      portfolio.enabled = true;
    } catch (error) {
      pandoraBalance = buildDisabledPortfolioSection(
        `Pandora liquid balance unavailable: ${error && error.message ? error.message : String(error)}.`,
      );
    }
  }

  let polymarketBalance = buildDisabledPortfolioSection('Polymarket liquid balance unavailable.');
  if (typeof deps.runPolymarketBalance === 'function') {
    try {
      const payload = await deps.runPolymarketBalance({
        wallet: options.wallet || portfolio.wallet || null,
        rpcUrl: options.polymarketRpcUrl || null,
        privateKey: resolvedPrivateKey,
        funder: options.funder || null,
      });
      polymarketBalance = buildPolymarketLiquidCapitalSummary(payload);
      portfolio.enabled = true;
    } catch (error) {
      polymarketBalance = buildDisabledPortfolioSection(
        `Polymarket liquid balance unavailable: ${error && error.message ? error.message : String(error)}.`,
      );
    }
  }

  const pandoraUsdc = toFiniteNumber(pandoraBalance.usdcBalance);
  const polymarketUsdc = toFiniteNumber(polymarketBalance.totalDistinctUsdc);
  portfolio.liquidCapital = {
    enabled: Boolean(pandoraBalance.enabled || polymarketBalance.enabled),
    wallet: portfolio.wallet || options.wallet || null,
    chainId: options.chainId || 1,
    pandora: pandoraBalance,
    polymarket: polymarketBalance,
    totalDistinctUsdc: roundNumber((pandoraUsdc || 0) + (polymarketUsdc || 0), 6),
    diagnostics: uniqueStrings([
      ...(Array.isArray(pandoraBalance.diagnostics) ? pandoraBalance.diagnostics : []),
      ...(Array.isArray(polymarketBalance.diagnostics) ? polymarketBalance.diagnostics : []),
    ]),
  };
  portfolio.diagnostics = uniqueStrings([
    ...(Array.isArray(portfolio.claimable.diagnostics) ? portfolio.claimable.diagnostics : []),
    ...(Array.isArray(portfolio.liquidCapital.diagnostics) ? portfolio.liquidCapital.diagnostics : []),
  ]);
  portfolio.enabled = portfolio.enabled || portfolio.active.marketCount > 0;

  return portfolio;
}

async function buildDashboardSnapshot(options = {}, deps = {}) {
  const payloadBuilder = deps.buildMirrorDashboardPayload || buildMirrorDashboardPayload;
  const { items } = await collectDashboardItems(options, deps);
  const basePayload = payloadBuilder({ items });
  const portfolio = await collectDashboardPortfolio(options, deps, basePayload.summary || {});
  return {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    generatedAt: basePayload.generatedAt,
    summary: basePayload.summary,
    items: basePayload.items.map((item) => ({
      ...item,
      suggestedNextCommands: Array.isArray(item.suggestedNextCommands) ? item.suggestedNextCommands : [],
    })),
    diagnostics: basePayload.diagnostics,
    suggestedNextCommands: buildDashboardSuggestedNextCommands(items),
    portfolio,
  };
}

function buildDashboardPayloadFromSnapshots(snapshots = [], options = {}) {
  const latest = snapshots.length ? snapshots[snapshots.length - 1] : {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    summary: {},
    items: [],
    diagnostics: [],
    suggestedNextCommands: [],
    portfolio: null,
  };
  return {
    ...latest,
    watch: {
      enabled: Boolean(options.watch),
      refreshMs: options.refreshMs || null,
      iterationsRequested: Number.isInteger(options.iterations) ? options.iterations : null,
      count: snapshots.length || 1,
    },
    snapshots: Boolean(options.watch)
      ? snapshots.map((snapshot, index) => ({
          iteration: index + 1,
          ...snapshot,
        }))
      : undefined,
  };
}

function buildDashboardSuggestedNextCommands(items = []) {
  const actionItems = items.filter((item) => item && item.actionability && item.actionability.status === 'action-needed');
  const unhealthyItems = items.filter((item) => {
    const runtimeStatus = item && item.runtime && item.runtime.health ? item.runtime.health.status : null;
    return runtimeStatus === 'blocked' || runtimeStatus === 'stale' || runtimeStatus === 'degraded' || runtimeStatus === 'error';
  });

  const commands = [];
  for (const item of actionItems) {
    commands.push(...buildDashboardItemCommands(item));
  }
  for (const item of unhealthyItems) {
    commands.push(...buildDashboardItemCommands(item));
  }

  if (!items.length) {
    commands.push('pandora mirror go --help');
    commands.push('pandora mirror sync --help');
  }

  return uniqueStrings(commands).slice(0, 8);
}

function renderDashboardTable(data) {
  console.log('Dashboard');
  if (data && data.watch && data.watch.enabled) {
    console.log(`watch refreshMs=${data.watch.refreshMs || ''} snapshots=${data.watch.count || 0}`);
  }
  const summary = data && data.summary ? data.summary : {};
  console.log(`markets=${summary.marketCount || 0} live=${summary.liveCount || 0} actionNeeded=${summary.actionNeededCount || 0} blocked=${summary.blockedCount || 0} pnlApprox=${summary.totalNetPnlApproxUsdc ?? ''}`);
  const portfolio = data && data.portfolio ? data.portfolio : null;
  if (portfolio) {
    const claimable = portfolio.claimable || {};
    const liquidCapital = portfolio.liquidCapital || {};
    console.log(`portfolio wallet=${portfolio.wallet || ''} claimableMarkets=${claimable.marketCount || 0} claimableUsdc=${claimable.estimatedClaimUsdcTotal ?? ''} liquidUsdc=${liquidCapital.totalDistinctUsdc ?? ''}`);
  }
  const items = Array.isArray(data && data.items) ? data.items : [];
  for (const item of items) {
    const label = item.question || JSON.stringify(item.selector || {});
    const runtimeStatus = item.runtime && item.runtime.health ? item.runtime.health.status : '';
    const actionability = item.actionability && item.actionability.status ? item.actionability.status : '';
    const driftBps = item.drift && item.drift.driftBps !== null ? item.drift.driftBps : '';
    const hedgeGapUsdc = item.hedge && item.hedge.hedgeGapUsdc !== null ? item.hedge.hedgeGapUsdc : '';
    const pnlApprox = item.pnl && item.pnl.netPnlApproxUsdc !== null ? item.pnl.netPnlApproxUsdc : '';
    console.log(`${label}: runtime=${runtimeStatus} action=${actionability} driftBps=${driftBps} hedgeGapUsdc=${hedgeGapUsdc} netPnlApproxUsdc=${pnlApprox}`);
  }
  if (Array.isArray(data.suggestedNextCommands) && data.suggestedNextCommands.length) {
    console.log('next:');
    for (const command of data.suggestedNextCommands) {
      console.log(`  ${command}`);
    }
  }
}

function renderDashboardHelpTable(payload) {
  console.log(`Usage: ${payload.usage}`);
  const notes = Array.isArray(payload.notes) ? payload.notes : [];
  for (const note of notes) {
    console.log(note);
  }
}

function createRunDashboardCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseIndexerSharedFlags = requireDep(deps, 'parseIndexerSharedFlags');
  const maybeLoadIndexerEnv = requireDep(deps, 'maybeLoadIndexerEnv');
  const maybeLoadTradeEnv = requireDep(deps, 'maybeLoadTradeEnv');
  const resolveIndexerUrl = requireDep(deps, 'resolveIndexerUrl');

  return async function runDashboardCommand(args, context) {
    const usage =
      'pandora [--output table|json] dashboard [--with-live|--no-live] [--watch] [--refresh-ms <ms>] [--iterations <n>] [--wallet <address>] [--chain-id <id>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--usdc <address>] [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]';

    if (includesHelpFlag(args)) {
      const helpPayload = commandHelpPayload(usage, [
        'dashboard summarizes discovered mirror markets side-by-side from local mirror state files and daemon metadata.',
        'Live mode is enabled by default so actionability, hedge gaps, and PnL reuse the same mirror live payload used by mirror status/pnl.',
        'Use --watch or --refresh-ms to turn dashboard into a refreshing operator cockpit; JSON watch mode requires a bounded --iterations count.',
        'portfolio rollups reuse existing ownership and funding primitives to show claimable exposure and liquid capital alongside active mirrors.',
        'suggestedNextCommands highlights the next mirror status/sync status commands worth running for markets that need action or runtime repair.',
      ]);
      emitSuccess(
        context.outputMode,
        'dashboard.help',
        helpPayload,
        renderDashboardHelpTable,
      );
      return;
    }

    const shared = parseIndexerSharedFlags(args);
    const options = parseDashboardFlags(shared.rest, CliError);
    maybeLoadIndexerEnv(shared);
    maybeLoadTradeEnv(shared);
    if (!options.privateKey) {
      const envPrivateKey = String(process.env.PANDORA_PRIVATE_KEY || process.env.PRIVATE_KEY || '').trim();
      if (isValidPrivateKey(envPrivateKey)) {
        options.privateKey = envPrivateKey;
      }
    }

    options.indexerUrl = resolveIndexerUrl(shared.indexerUrl || null);
    options.timeoutMs = shared.timeoutMs;
    options.rpcUrl = options.rpcUrl || process.env.RPC_URL || null;
    options.usdc = options.usdc || normalizeAddress(process.env.USDC || DEFAULT_USDC);

    if (options.watch && context.outputMode === 'json' && !Number.isInteger(options.iterations)) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'dashboard watch in JSON mode requires --iterations <n>.');
    }

    if (options.watch && context.outputMode !== 'json') {
      const totalIterations = Number.isInteger(options.iterations) ? options.iterations : Number.POSITIVE_INFINITY;
      const sleeper = typeof deps.sleepMs === 'function' ? deps.sleepMs : sleepMs;
      for (let iteration = 1; iteration <= totalIterations; iteration += 1) {
        const payload = buildDashboardPayloadFromSnapshots([
          await buildDashboardSnapshot(options, deps),
        ], {
          watch: true,
          refreshMs: options.refreshMs,
          iterations: Number.isInteger(options.iterations) ? options.iterations : null,
        });
        if (process.stdout && process.stdout.isTTY) {
          process.stdout.write('\x1Bc');
        }
        console.log(`Dashboard watch iteration ${iteration}${Number.isFinite(totalIterations) ? `/${totalIterations}` : ''}`);
        renderDashboardTable(payload);
        if (!Number.isFinite(totalIterations) || iteration < totalIterations) {
          await sleeper(options.refreshMs);
        }
      }
      return;
    }

    const iterationCount = options.watch
      ? options.iterations
      : 1;
    const snapshots = [];
    const sleeper = typeof deps.sleepMs === 'function' ? deps.sleepMs : sleepMs;
    for (let iteration = 1; iteration <= iterationCount; iteration += 1) {
      snapshots.push(await buildDashboardSnapshot(options, deps));
      if (iteration < iterationCount) {
        await sleeper(options.refreshMs);
      }
    }
    const payload = buildDashboardPayloadFromSnapshots(snapshots, {
      watch: options.watch,
      refreshMs: options.refreshMs,
      iterations: iterationCount,
    });

    emitSuccess(context.outputMode, 'dashboard', payload, renderDashboardTable);
  };
}


module.exports = {
  DASHBOARD_SCHEMA_VERSION,
  createRunDashboardCommand,
  readPandoraWalletBalances,
};
