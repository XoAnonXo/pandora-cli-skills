const { DEFAULT_RPC_BY_CHAIN_ID, DEFAULT_USDC } = require('./shared/constants.cjs');
const { resolveWalletFromOptions } = require('./markets_mine_service.cjs');
const { readPandoraWalletBalances } = require('./dashboard_fund_service.cjs');

const BRIDGE_PLAN_SCHEMA_VERSION = '1.0.0';
const BRIDGE_EXECUTE_SCHEMA_VERSION = '1.0.0';
const POLYGON_CHAIN_ID = 137;
const POLYGON_USDC_E = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174';
const LAYERZERO_PROVIDER = 'layerzero';
const CHAIN_METADATA = {
  1: { id: 1, name: 'Ethereum', nativeSymbol: 'ETH', recommendedNativeGas: 0.005 },
  137: { id: 137, name: 'Polygon', nativeSymbol: 'MATIC', recommendedNativeGas: 0.2 },
};

function requireDep(deps, name) {
const BRIDGE_USAGE =
  'pandora [--output table|json] bridge plan --target <polymarket|polymarket-cmg|odin|odincrosschain> --amount-usdc <n> [--rpc-url <url>] [--polymarket-rpc-url <url>] [--wallet <address>] [--to-wallet <address>] [--dry-run]\n' +
  'pandora [--output table|json] bridge execute --provider <layerzero|wormhole> --target <polymarket|polymarket-cmg|odin|odincrosschain> --amount-usdc <n> [--dry-run] [--yes]\n' +
  'pandora [--output table|json] bridge simulate --target <polymarket|polymarket-cmg|odin|odincrosschain> --amount-usdc <n> [--rpc-url <url>] [--polymarket-rpc-url <url>] [--private-key <hex>] [--profile-id <id>] [--profile-file <path>] [--funder <address>] [--usdc <address>]';

const BRIDGE_NOTES = [
  'bridge plan estimates gas, finds routes, and suggests next steps before committing funds.',
  'bridge execute submits cross-chain transfers via the selected provider.',
  'bridge simulate runs a dry-run estimate without on-chain state changes.',
  'Use --dry-run with plan or execute to preview without signing.',
];

  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`bridge service requires deps.${name}()`);
  }
  return deps[name];
}

const BRIDGE_USAGE =
  'pandora [--output table|json] bridge plan --target <polymarket|address> --amount-usdc <n> [--provider layerzero] [--wallet <address>|--private-key <hex>] [--rpc-url <url>] [--dry-run]';

const BRIDGE_EXECUTE_USAGE =
  'pandora [--output table|json] bridge execute --target <polymarket|address> --amount-usdc <n> --provider layerzero [--wallet <address>|--private-key <hex>] [--rpc-url <url>] [--dry-run]';

const BRIDGE_NOTES = [
  'pandora bridge plan shows source-side gas, USDC balances, shortfall, and route suggestions.',
  'pandora bridge execute submits a LayerZero preflight and optionally broadcasts the bridge transaction.',
  '--dry-run is recommended before executing to preview gas costs and token amounts.',
  'Polygon is required for Polymarket deposits; ensure --rpc-url points to a Polygon RPC.',
];

function normalizeAddress(value) {
  const raw = String(value || '').trim();
  return /^0x[a-fA-F0-9]{40}$/.test(raw) ? raw : null;
}

function isValidPrivateKey(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || '').trim());
}

function requireFlagValue(args, index, flagName, CliError) {
  if (index + 1 >= args.length || String(args[index + 1]).startsWith('--')) {
    throw new CliError('MISSING_REQUIRED_FLAG', `${flagName} requires a value.`);
  }
  return String(args[index + 1]);
}

function parsePositiveNumber(value, flagName, CliError) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a positive number.`);
  }
  return numeric;
}

function roundNumber(value, decimals = 6) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
}

function buildChainSummary(chainId, rpcUrl) {
  const metadata = CHAIN_METADATA[chainId] || {
    id: chainId,
    name: `Chain ${chainId}`,
    nativeSymbol: 'NATIVE',
    recommendedNativeGas: 0,
  };
  return {
    id: metadata.id,
    name: metadata.name,
    nativeSymbol: metadata.nativeSymbol,
    rpcUrl: rpcUrl || null,
  };
}

function buildGasExpectation(chainId, nativeBalance) {
  const metadata = CHAIN_METADATA[chainId] || { nativeSymbol: 'NATIVE', recommendedNativeGas: 0 };
  const recommendedMin = metadata.recommendedNativeGas;
  const balance = Number.isFinite(Number(nativeBalance)) ? Number(nativeBalance) : null;
  return {
    nativeSymbol: metadata.nativeSymbol,
    recommendedMin,
    available: balance,
    shortfall: balance === null ? recommendedMin : roundNumber(Math.max(0, recommendedMin - balance), 6),
  };
}

function pickPolymarketWallet(balancePayload = {}, options = {}) {
  const explicit = normalizeAddress(options.toWallet);
  if (explicit) return explicit;
  const runtime = balancePayload.runtime && typeof balancePayload.runtime === 'object' ? balancePayload.runtime : {};
  return normalizeAddress(
    balancePayload.requestedWallet
    || runtime.signerAddress
    || runtime.ownerAddress
    || runtime.funderAddress,
  );
}

function buildBridgeSuggestions(plan) {
  const suggestions = [];
  if (plan.bridge.requiredAmountUsdc > 0) {
    suggestions.push({
      id: 'manual-bridge-handoff',
      severity: plan.bridge.sourceShortfallUsdc > 0 ? 'error' : 'warn',
      action: plan.bridge.sourceShortfallUsdc > 0 ? 'top-up-source-wallet' : 'review-bridge-execute',
      message: plan.bridge.sourceShortfallUsdc > 0
        ? `Source-side ${plan.route.source.token.symbol} is short ${plan.bridge.sourceShortfallUsdc} USDC for the proposed bridge.`
        : `Bridge ${plan.bridge.requiredAmountUsdc} ${plan.route.source.token.symbol} from ${plan.route.source.chain.name} to ${plan.route.destination.chain.name}; use pandora bridge execute for LayerZero preflight or submission.`,
      command: plan.bridge.sourceShortfallUsdc > 0
        ? null
        : `pandora bridge execute --provider ${LAYERZERO_PROVIDER} --target ${plan.target} --amount-usdc ${plan.amountUsdc} --dry-run`,
    });
  }

  if (plan.target === 'polymarket') {
    suggestions.push({
      id: 'polymarket-deposit-after-bridge',
      severity: 'info',
      action: 'fund-polymarket-proxy',
      message: 'After bridge settlement on Polygon, move the bridged collateral into the Polymarket proxy wallet if needed.',
      command: `pandora polymarket deposit --amount-usdc ${plan.amountUsdc}`,
    });
  }

  return suggestions;
}

function renderBridgeHelp(context, CliError) {
  const usage = 'pandora [--output table|json] bridge plan|execute [--target <wallet|polymarket>] --amount-usdc <n> [--wallet <address>] [--to-wallet <address>] [--rpc-url <url>] [--provider layerzero] [--dry-run]';
  const notes = [
    'bridge plan previews cross-chain USDC movement with gas estimates and route suggestions.',
    'bridge execute submits a LayerZero bridge transaction or dry-runs preflight checks.',
    'Use --dry-run with execute to validate without signing.',
    'After bridging to Polygon, use `pandora polymarket deposit` to fund the proxy wallet.',
  ];

  if (context && context.outputMode === 'json') {
    process.stdout.write(JSON.stringify({ ok: true, command: 'bridge.help', data: { usage, notes } }, null, 2) + '\n');
  } else {
    // eslint-disable-next-line no-console
    console.log(`Usage: ${usage}`);
    notes.forEach((note) => {
      // eslint-disable-next-line no-console
      console.log(note);
    });
  }
}

function parseBridgeFlags(args, CliError, config = {}) {function buildBridgeUsageEnvelope() {
  const usage =
    'pandora [--output table|json] bridge plan --target <polymarket|polymarket-cctp> --amount-usdc <n> [--wallet <address>] [--to-wallet <address>] [--rpc-url <url>] [--provider layerzero] [--dry-run] [--execute]\n' +
    'pandora [--output table|json] bridge execute --provider <layerzero> --target <polymarket|polymarket-cctp> --amount-usdc <n> [--wallet <address>] [--dry-run] [--execute]';
  const notes = [
    'Use bridge plan to preview gas requirements, route, and any source-side shortfalls.',
    'Use bridge execute (or --execute with plan) to submit the LayerZero transaction.',
    'The target polymarket-cctp uses Circle CCTP for USDC-native transfers; polymarket uses ERC-20 bridging.',
    '--dry-run simulates preflight without submitting; --execute sends the transaction.',
  ];
  return { usage, notes };
}

function runBridgeHelp(context) {
  const { outputMode } = context;
  if (outputMode === 'json') {
    const { usage, notes } = buildBridgeUsageEnvelope();
    const envelope = { ok: true, command: 'bridge.help', data: { usage, notes } };
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  } else {
    // eslint-disable-next-line no-console
    console.log('Usage: pandora [--output table|json] bridge plan --target <polymarket|polymarket-cctp> --amount-usdc <n> [--wallet <address>] [--to-wallet <address>] [--rpc-url <url>] [--provider layerzero] [--dry-run] [--execute]');
    // eslint-disable-next-line no-console
    console.log('       pandora [--output table|json] bridge execute --provider <layerzero> --target <polymarket|polymarket-cctp> --amount-usdc <n> [--wallet <address>] [--dry-run] [--execute]');
    // eslint-disable-next-line no-console
    console.log('');
    // eslint-disable-next-line no-console
    console.log('Subcommands: plan, execute');
    // eslint-disable-next-line no-console
    console.log('');
    // eslint-disable-next-line no-console
    console.log('Use bridge plan to preview gas requirements, route, and any source-side shortfalls.');
    // eslint-disable-next-line no-console
    console.log('Use bridge execute (or --execute with plan) to submit the LayerZero transaction.');
    // eslint-disable-next-line no-console
    console.log("The target polymarket-cctp uses Circle CCTP for USDC-native transfers; polymarket uses ERC-20 bridging.");
    // eslint-disable-next-line no-console
    console.log('--dry-run simulates preflight without submitting; --execute sends the transaction.');
  }
}

  const actionLabel = String(config.actionLabel || 'plan');
  const includeMode = config.includeMode === true;
  const options = {
    target: null,
    amountUsdc: null,
    wallet: null,
    toWallet: null,
    rpcUrl: null,
    polymarketRpcUrl: null,
    privateKey: null,
    profileId: null,
    profileFile: null,
    funder: null,
    usdc: null,
    provider: LAYERZERO_PROVIDER,
    dryRun: false,
    execute: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i]);
    if (token === '--target') {
      const value = requireFlagValue(args, i, '--target', CliError).trim().toLowerCase();
      if (value !== 'pandora' && value !== 'polymarket') {
        throw new CliError('INVALID_FLAG_VALUE', '--target must be pandora|polymarket.');
      }
      options.target = value;
      i += 1;
      continue;
    }
    if (token === '--amount-usdc') {
      options.amountUsdc = parsePositiveNumber(
        requireFlagValue(args, i, '--amount-usdc', CliError),
        '--amount-usdc',
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
    if (token === '--to-wallet') {
      options.toWallet = normalizeAddress(requireFlagValue(args, i, '--to-wallet', CliError));
      if (!options.toWallet) {
        throw new CliError('INVALID_FLAG_VALUE', '--to-wallet must be an EVM address.');
      }
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
    if (includeMode && token === '--provider') {
      const provider = requireFlagValue(args, i, '--provider', CliError).trim().toLowerCase();
      if (provider !== LAYERZERO_PROVIDER) {
        throw new CliError('INVALID_FLAG_VALUE', '--provider must be layerzero.');
      }
      options.provider = provider;
      i += 1;
      continue;
    }
    if (includeMode && token === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (includeMode && token === '--execute') {
      options.execute = true;
      continue;
    }
    throw new CliError('UNKNOWN_FLAG', `Unknown flag for bridge ${actionLabel}: ${token}`);
  }

  if (!options.target) {
    throw new CliError('MISSING_REQUIRED_FLAG', `bridge ${actionLabel} requires --target pandora|polymarket.`);
  }
  if (!Number.isFinite(options.amountUsdc)) {
    throw new CliError('MISSING_REQUIRED_FLAG', `bridge ${actionLabel} requires --amount-usdc <n>.`);
  }
  if (includeMode && options.dryRun === options.execute) {
    throw new CliError('INVALID_ARGS', 'bridge execute requires exactly one mode: --dry-run or --execute.');
  }

  return options;
}

function parseBridgePlanFlags(args, CliError) {
  return parseBridgeFlags(args, CliError, { actionLabel: 'plan' });
}

function parseBridgeExecuteFlags(args, CliError) {
  return parseBridgeFlags(args, CliError, { actionLabel: 'execute', includeMode: true });
}

async function buildBridgePlan(options = {}, deps = {}) {
  const runPolymarketBalance = requireDep(deps, 'runPolymarketBalance');
  const venueBalanceReader = typeof deps.readPandoraWalletBalances === 'function'
    ? deps.readPandoraWalletBalances
    : readPandoraWalletBalances;
  const pandoraPrivateKey = options.privateKey
    || (isValidPrivateKey(process.env.PANDORA_PRIVATE_KEY || process.env.PRIVATE_KEY)
      ? String(process.env.PANDORA_PRIVATE_KEY || process.env.PRIVATE_KEY).trim()
      : null);
  const polymarketPrivateKey = options.privateKey
    || String(process.env.POLYMARKET_PRIVATE_KEY || '').trim()
    || pandoraPrivateKey
    || null;

  let pandoraWallet = null;
  const diagnostics = [];
  try {
    const walletInfo = await resolveWalletFromOptions({
      wallet: options.wallet || null,
      privateKey: pandoraPrivateKey,
      profileId: options.profileId || null,
      profileFile: options.profileFile || null,
      chainId: 1,
      rpcUrl: options.rpcUrl || process.env.RPC_URL || DEFAULT_RPC_BY_CHAIN_ID[1] || null,
    });
    pandoraWallet = walletInfo.wallet || null;
  } catch (error) {
    diagnostics.push(`Pandora wallet resolution failed: ${error && error.message ? error.message : String(error)}`);
  }

  let polymarketBalance = null;
  try {
    polymarketBalance = await runPolymarketBalance({
      wallet: options.wallet || null,
      privateKey: polymarketPrivateKey,
      funder: options.funder || process.env.POLYMARKET_FUNDER || null,
      rpcUrl: options.polymarketRpcUrl || process.env.POLYMARKET_RPC_URL || null,
    });
  } catch (error) {
    diagnostics.push(`Polymarket balance resolution failed: ${error && error.message ? error.message : String(error)}`);
    polymarketBalance = { balances: {}, runtime: {}, diagnostics: [] };
  }

  const polygonWallet = pickPolymarketWallet(polymarketBalance, options);
  const ethereumRpcUrl = options.rpcUrl || process.env.RPC_URL || DEFAULT_RPC_BY_CHAIN_ID[1] || null;
  const polygonRpcUrl = options.polymarketRpcUrl || process.env.POLYMARKET_RPC_URL || process.env.RPC_URL || null;

  const ethereumBalances = await venueBalanceReader({
    walletAddress: pandoraWallet,
    chainId: 1,
    rpcUrl: ethereumRpcUrl,
    usdcAddress: options.usdc || process.env.USDC || DEFAULT_USDC,
  });
  const polygonBalances = await venueBalanceReader({
    walletAddress: polygonWallet,
    chainId: POLYGON_CHAIN_ID,
    rpcUrl: polygonRpcUrl,
    usdcAddress: POLYGON_USDC_E,
  });

  const targetIsPolymarket = options.target === 'polymarket';
  const sourceChainId = targetIsPolymarket ? 1 : POLYGON_CHAIN_ID;
  const destinationChainId = targetIsPolymarket ? POLYGON_CHAIN_ID : 1;
  const sourceBalances = targetIsPolymarket ? ethereumBalances : polygonBalances;
  const destinationBalances = targetIsPolymarket ? polygonBalances : ethereumBalances;
  const requiredAmountUsdc = roundNumber(Math.max(0, options.amountUsdc - (Number(destinationBalances.usdcBalance) || 0)), 6);
  const sourceAvailableUsdc = Number.isFinite(Number(sourceBalances.usdcBalance)) ? Number(sourceBalances.usdcBalance) : null;
  const sourceShortfallUsdc = sourceAvailableUsdc === null
    ? roundNumber(requiredAmountUsdc, 6)
    : roundNumber(Math.max(0, requiredAmountUsdc - sourceAvailableUsdc), 6);

  const plan = {
    schemaVersion: BRIDGE_PLAN_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: 'plan',
    target: options.target,
    amountUsdc: roundNumber(options.amountUsdc, 6),
    route: {
      source: {
        chain: buildChainSummary(sourceChainId, sourceChainId === 1 ? ethereumRpcUrl : polygonRpcUrl),
        token: {
          symbol: targetIsPolymarket ? 'USDC' : 'USDC.e',
          address: targetIsPolymarket ? (options.usdc || process.env.USDC || DEFAULT_USDC) : POLYGON_USDC_E,
        },
        wallet: targetIsPolymarket ? pandoraWallet : polygonWallet,
        balanceUsdc: sourceBalances.usdcBalance,
        nativeBalance: sourceBalances.nativeBalance,
        gasExpectation: buildGasExpectation(sourceChainId, sourceBalances.nativeBalance),
      },
      destination: {
        chain: buildChainSummary(destinationChainId, destinationChainId === 1 ? ethereumRpcUrl : polygonRpcUrl),
        token: {
          symbol: targetIsPolymarket ? 'USDC.e' : 'USDC',
          address: targetIsPolymarket ? POLYGON_USDC_E : (options.usdc || process.env.USDC || DEFAULT_USDC),
        },
        wallet: targetIsPolymarket ? polygonWallet : pandoraWallet,
        balanceUsdc: destinationBalances.usdcBalance,
        nativeBalance: destinationBalances.nativeBalance,
        gasExpectation: buildGasExpectation(destinationChainId, destinationBalances.nativeBalance),
      },
    },
    bridge: {
      requiredAmountUsdc,
      sourceAvailableUsdc,
      sourceShortfallUsdc,
      bridgeNeeded: requiredAmountUsdc > 0,
      destinationAvailableUsdc: destinationBalances.usdcBalance,
      destinationShortfallUsdc: roundNumber(Math.max(0, options.amountUsdc - (Number(destinationBalances.usdcBalance) || 0)), 6),
    },
    providerAssumptions: [
      'Planner output is read-only; use `pandora bridge execute` when you want LayerZero preflight or source-chain submission.',
      targetIsPolymarket
        ? 'Assumes Ethereum mainnet USDC is the source asset and Polygon USDC.e is the destination collateral used by Polymarket.'
        : 'Assumes Polygon USDC.e is the source asset and Ethereum mainnet USDC is the destination asset used by Pandora.',
      'Bridge execution, settlement timing, and final destination confirmation stay manual and explicit.',
    ],
    suggestions: [],
    diagnostics: []
      .concat(Array.isArray(diagnostics) ? diagnostics : [])
      .concat(Array.isArray(sourceBalances.diagnostics) ? sourceBalances.diagnostics : [])
      .concat(Array.isArray(destinationBalances.diagnostics) ? destinationBalances.diagnostics : [])
      .concat(Array.isArray(polymarketBalance.diagnostics) ? polymarketBalance.diagnostics : []),
  };

  plan.suggestions = buildBridgeSuggestions(plan);
  return plan;
}

function buildLayerZeroProviderAssumptions(plan, mode, state = {}) {
  const targetIsPolymarket = plan && plan.target === 'polymarket';
  const assumptions = [
    'Provider is scoped to LayerZero only. No automatic fallback provider is selected.',
    targetIsPolymarket
      ? 'Assumes Ethereum mainnet USDC is the source asset and Polygon USDC.e is the destination collateral used by Polymarket.'
      : 'Assumes Polygon USDC.e is the source asset and Ethereum mainnet USDC is the destination asset used by Pandora.',
    'Cross-chain settlement is asynchronous. Final destination credit confirmation remains explicit and must be observed after submission.',
  ];

  if (mode === 'dry-run') {
    assumptions.push('Dry-run mode prepares a LayerZero submission plan and optional quote, but does not broadcast any transaction.');
  } else {
    assumptions.push('Execute mode submits only the source-chain LayerZero transaction. Destination settlement still completes later.');
  }
  if (state.quoteCaptured) {
    assumptions.push('A provider quote was captured for this request and is reflected in the preflight output.');
  } else {
    assumptions.push('No live provider quote was captured in this run; fee and receive estimates remain assumption-based.');
  }

  return assumptions;
}

function normalizeLayerZeroQuote(quote, defaultAmountUsdc) {
  if (!quote || typeof quote !== 'object') {
    return null;
  }
  return {
    provider: LAYERZERO_PROVIDER,
    quoteId: quote.quoteId || quote.routeId || null,
    estimatedBridgeAmountUsdc: roundNumber(
      quote.estimatedBridgeAmountUsdc != null ? quote.estimatedBridgeAmountUsdc : defaultAmountUsdc,
      6,
    ),
    estimatedReceiveAmountUsdc: roundNumber(quote.estimatedReceiveAmountUsdc, 6),
    minReceiveAmountUsdc: roundNumber(quote.minReceiveAmountUsdc, 6),
    estimatedFeeNative: roundNumber(quote.estimatedFeeNative, 8),
    estimatedFeeUsd: roundNumber(quote.estimatedFeeUsd, 6),
    slippageBps: Number.isFinite(Number(quote.slippageBps)) ? Number(quote.slippageBps) : null,
    estimatedCompletionSeconds: Number.isFinite(Number(quote.estimatedCompletionSeconds))
      ? Number(quote.estimatedCompletionSeconds)
      : null,
    raw: quote.raw && typeof quote.raw === 'object' ? quote.raw : null,
  };
}

function buildLayerZeroRequest(plan, options = {}, providerQuote = null) {
  return {
    provider: LAYERZERO_PROVIDER,
    target: plan.target,
    amountUsdc: plan.amountUsdc,
    requiredBridgeAmountUsdc: plan.bridge.requiredAmountUsdc,
    source: {
      chainId: plan.route.source.chain.id,
      chainName: plan.route.source.chain.name,
      rpcUrl: plan.route.source.chain.rpcUrl || null,
      wallet: plan.route.source.wallet || null,
      tokenAddress: plan.route.source.token.address || null,
      tokenSymbol: plan.route.source.token.symbol || null,
    },
    destination: {
      chainId: plan.route.destination.chain.id,
      chainName: plan.route.destination.chain.name,
      rpcUrl: plan.route.destination.chain.rpcUrl || null,
      wallet: plan.route.destination.wallet || null,
      tokenAddress: plan.route.destination.token.address || null,
      tokenSymbol: plan.route.destination.token.symbol || null,
    },
    signer: {
      privateKey: options.privateKey || null,
      funder: options.funder || null,
    },
    timeoutMs: Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : null,
    providerQuote,
  };
}

async function maybeQuoteLayerZeroBridge(plan, options = {}, deps = {}) {
  const diagnostics = [];
  const quoteLayerZeroBridge =
    typeof deps.quoteLayerZeroBridge === 'function' ? deps.quoteLayerZeroBridge : null;
  if (!plan.bridge.bridgeNeeded || !quoteLayerZeroBridge) {
    return { providerQuote: null, diagnostics, quoteCaptured: false };
  }

  try {
    const quote = await quoteLayerZeroBridge(buildLayerZeroRequest(plan, options));
    return {
      providerQuote: normalizeLayerZeroQuote(quote, plan.bridge.requiredAmountUsdc),
      diagnostics,
      quoteCaptured: true,
    };
  } catch (error) {
    diagnostics.push(`LayerZero quote failed: ${error && error.message ? error.message : String(error)}`);
    return { providerQuote: null, diagnostics, quoteCaptured: false };
  }
}

function buildBridgeExecutePreflight(plan, mode, providerQuote, deps = {}) {
  const sourceWalletReady = Boolean(plan.route && plan.route.source && plan.route.source.wallet);
  const destinationWalletReady = Boolean(plan.route && plan.route.destination && plan.route.destination.wallet);
  const sourceGasShortfall =
    plan.route && plan.route.source && plan.route.source.gasExpectation
      ? Number(plan.route.source.gasExpectation.shortfall || 0)
      : 0;
  const destinationGasShortfall =
    plan.route && plan.route.destination && plan.route.destination.gasExpectation
      ? Number(plan.route.destination.gasExpectation.shortfall || 0)
      : 0;
  const sourceBalanceSufficient = Number(plan.bridge.sourceShortfallUsdc || 0) <= 0;
  const quoteAvailable = Boolean(providerQuote);
  const providerExecutionAvailable = typeof deps.executeLayerZeroBridge === 'function';
  const blockers = [];
  const warnings = [];

  if (!sourceWalletReady) {
    blockers.push('Source wallet could not be resolved for LayerZero submission.');
  }
  if (!destinationWalletReady) {
    blockers.push('Destination wallet could not be resolved for LayerZero delivery.');
  }
  if (!sourceBalanceSufficient) {
    blockers.push(`Source wallet is short ${plan.bridge.sourceShortfallUsdc} ${plan.route.source.token.symbol}.`);
  }
  if (sourceGasShortfall > 0) {
    blockers.push(
      `Source wallet needs approximately ${sourceGasShortfall} more ${plan.route.source.gasExpectation.nativeSymbol} for bridge gas.`,
    );
  }
  if (destinationGasShortfall > 0) {
    warnings.push(
      `Destination wallet is below the suggested ${plan.route.destination.gasExpectation.nativeSymbol} buffer for post-bridge actions.`,
    );
  }
  if (plan.bridge.bridgeNeeded && !quoteAvailable) {
    warnings.push('No LayerZero quote was captured during preflight; fee and receive estimates are assumptions only.');
  }
  if (mode === 'execute' && !providerExecutionAvailable) {
    blockers.push('LayerZero execution is not configured in this build.');
  }

  let status = 'ready';
  if (!plan.bridge.bridgeNeeded) {
    status = 'not-needed';
  } else if (blockers.length > 0) {
    status = 'blocked';
  }

  return {
    provider: LAYERZERO_PROVIDER,
    status,
    bridgeNeeded: Boolean(plan.bridge.bridgeNeeded),
    sourceWalletReady,
    destinationWalletReady,
    sourceBalanceSufficient,
    sourceGasReady: sourceGasShortfall <= 0,
    destinationGasReady: destinationGasShortfall <= 0,
    sourceShortfallUsdc: roundNumber(plan.bridge.sourceShortfallUsdc, 6),
    sourceGasShortfallNative: roundNumber(sourceGasShortfall, 6),
    destinationGasShortfallNative: roundNumber(destinationGasShortfall, 6),
    quoteAvailable,
    providerExecutionAvailable,
    estimatedBridgeAmountUsdc: providerQuote && providerQuote.estimatedBridgeAmountUsdc != null
      ? providerQuote.estimatedBridgeAmountUsdc
      : roundNumber(plan.bridge.requiredAmountUsdc, 6),
    estimatedReceiveAmountUsdc: providerQuote ? providerQuote.estimatedReceiveAmountUsdc : null,
    estimatedFeeNative: providerQuote ? providerQuote.estimatedFeeNative : null,
    estimatedFeeUsd: providerQuote ? providerQuote.estimatedFeeUsd : null,
    blockers,
    warnings,
  };
}

function buildBridgeExecutionPlan(plan, preflight, mode, providerQuote) {
  if (!plan.bridge.bridgeNeeded) {
    return {
      provider: LAYERZERO_PROVIDER,
      executeFlagRequired: '--execute',
      steps: ['No bridge required; destination balance already covers the requested amount.'],
    };
  }

  const steps = [
    `verify ${plan.route.source.token.symbol} balance and gas on ${plan.route.source.chain.name}`,
    'submit LayerZero source-chain bridge transaction',
    `wait for delivery into ${plan.route.destination.chain.name}`,
    `confirm ${plan.route.destination.token.symbol} arrives in ${plan.route.destination.wallet || 'destination wallet'}`,
  ];

  if (plan.target === 'polymarket') {
    steps.push('fund the Polymarket proxy wallet after settlement if venue inventory still needs to move');
  }

  return {
    provider: LAYERZERO_PROVIDER,
    mode,
    executeFlagRequired: '--execute',
    steps,
    estimatedBridgeAmountUsdc: preflight.estimatedBridgeAmountUsdc,
    quoteId: providerQuote ? providerQuote.quoteId : null,
    estimatedFeeNative: providerQuote ? providerQuote.estimatedFeeNative : null,
    estimatedFeeUsd: providerQuote ? providerQuote.estimatedFeeUsd : null,
    estimatedReceiveAmountUsdc: providerQuote ? providerQuote.estimatedReceiveAmountUsdc : null,
  };
}

function buildBridgeExecuteSuggestions(plan, preflight, mode) {
  const suggestions = [];

  if (!plan.bridge.bridgeNeeded) {
    suggestions.push({
      id: 'bridge-not-needed',
      severity: 'info',
      action: 'skip-bridge',
      message: 'Destination-side collateral already covers the requested amount. No LayerZero bridge submission is required.',
      command: null,
    });
    return suggestions;
  }

  if (plan.bridge.sourceShortfallUsdc > 0) {
    suggestions.push({
      id: 'bridge-top-up-source',
      severity: 'error',
      action: 'top-up-source-wallet',
      message: `Top up ${plan.route.source.wallet || 'the source wallet'} with ${plan.bridge.sourceShortfallUsdc} more ${plan.route.source.token.symbol} before attempting LayerZero execution.`,
      command: null,
    });
  }

  if (!preflight.quoteAvailable) {
    suggestions.push({
      id: 'bridge-review-provider-assumptions',
      severity: 'warn',
      action: 'review-assumptions',
      message: 'No live LayerZero quote was captured. Review provider assumptions carefully before executing.',
      command: null,
    });
  }

  if (mode === 'dry-run' && preflight.status === 'ready') {
    suggestions.push({
      id: 'bridge-submit-layerzero',
      severity: 'info',
      action: 'submit-bridge',
      message: 'Preflight passed. Rerun with --execute to submit the LayerZero bridge transaction.',
      command: `pandora bridge execute --provider ${LAYERZERO_PROVIDER} --target ${plan.target} --amount-usdc ${plan.amountUsdc} --execute`,
    });
  }

  if (plan.target === 'polymarket') {
    suggestions.push({
      id: 'polymarket-deposit-after-layerzero',
      severity: 'info',
      action: 'fund-polymarket-proxy',
      message: 'After LayerZero settlement on Polygon, move the bridged collateral into the Polymarket proxy wallet if needed.',
      command: `pandora polymarket deposit --amount-usdc ${plan.amountUsdc}`,
    });
  }

  return suggestions;
}

function normalizeLayerZeroExecution(result, defaultAmountUsdc) {
  if (!result || typeof result !== 'object') {
    return {
      provider: LAYERZERO_PROVIDER,
      status: 'submitted',
      txHash: null,
      explorerUrl: null,
      messageId: null,
      estimatedBridgeAmountUsdc: roundNumber(defaultAmountUsdc, 6),
    };
  }

  return {
    provider: LAYERZERO_PROVIDER,
    status: result.status || 'submitted',
    txHash: result.txHash || result.transactionHash || null,
    explorerUrl: result.explorerUrl || null,
    messageId: result.messageId || null,
    quoteId: result.quoteId || result.routeId || null,
    chainId: Number.isFinite(Number(result.chainId)) ? Number(result.chainId) : null,
    estimatedBridgeAmountUsdc: roundNumber(
      result.estimatedBridgeAmountUsdc != null ? result.estimatedBridgeAmountUsdc : defaultAmountUsdc,
      6,
    ),
    estimatedFeeNative: roundNumber(result.estimatedFeeNative, 8),
    estimatedFeeUsd: roundNumber(result.estimatedFeeUsd, 6),
    estimatedReceiveAmountUsdc: roundNumber(result.estimatedReceiveAmountUsdc, 6),
    raw: result.raw && typeof result.raw === 'object' ? result.raw : null,
  };
}

async function buildBridgeExecution(options = {}, deps = {}) {
  const plan = await buildBridgePlan(options, deps);
  const CliError = deps && deps.CliError ? deps.CliError : Error;
  const assertLiveWriteAllowed =
    deps && typeof deps.assertLiveWriteAllowed === 'function' ? deps.assertLiveWriteAllowed : null;
  const mode = options.execute ? 'execute' : 'dry-run';
  const quoteState = await maybeQuoteLayerZeroBridge(plan, options, deps);
  const providerQuote = quoteState.providerQuote;
  const diagnostics = []
    .concat(Array.isArray(plan.diagnostics) ? plan.diagnostics : [])
    .concat(Array.isArray(quoteState.diagnostics) ? quoteState.diagnostics : []);
  const preflight = buildBridgeExecutePreflight(plan, mode, providerQuote, deps);
  const payload = {
    schemaVersion: BRIDGE_EXECUTE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode,
    status: mode === 'execute' ? 'submitted' : (preflight.status === 'ready' ? 'planned' : preflight.status),
    provider: LAYERZERO_PROVIDER,
    target: plan.target,
    amountUsdc: plan.amountUsdc,
    route: plan.route,
    bridge: plan.bridge,
    preflight,
    providerAssumptions: buildLayerZeroProviderAssumptions(plan, mode, quoteState),
    executionPlan: buildBridgeExecutionPlan(plan, preflight, mode, providerQuote),
    suggestions: buildBridgeExecuteSuggestions(plan, preflight, mode),
    diagnostics,
  };

  if (providerQuote) {
    payload.providerQuote = providerQuote;
  }

  if (!plan.bridge.bridgeNeeded) {
    payload.status = 'not-needed';
    return payload;
  }

  if (!options.execute) {
    return payload;
  }

  if (preflight.status !== 'ready') {
    throw new CliError('BRIDGE_PREFLIGHT_FAILED', 'bridge execute preflight failed.', {
      provider: LAYERZERO_PROVIDER,
      preflight,
      plan,
    });
  }

  if (assertLiveWriteAllowed) {
    await assertLiveWriteAllowed('bridge.execute', {
      notionalUsdc: plan.bridge.requiredAmountUsdc,
      runtimeMode: 'live',
    });
  }

  const executeLayerZeroBridge =
    deps && typeof deps.executeLayerZeroBridge === 'function' ? deps.executeLayerZeroBridge : null;
  if (!executeLayerZeroBridge) {
    throw new CliError('BRIDGE_PROVIDER_UNAVAILABLE', 'LayerZero execution is not configured in this build.', {
      provider: LAYERZERO_PROVIDER,
      preflight,
    });
  }

  const execution = await executeLayerZeroBridge(buildLayerZeroRequest(plan, options, providerQuote));
  payload.status = 'submitted';
  payload.execution = normalizeLayerZeroExecution(execution, plan.bridge.requiredAmountUsdc);
  return payload;
}

function renderBridgePlanTable(data) {
  console.log('Bridge Plan');
  console.log(`target=${data.target} amountUsdc=${data.amountUsdc}`);
  console.log(`source=${data.route.source.chain.name} ${data.route.source.token.symbol} wallet=${data.route.source.wallet || ''} balance=${data.route.source.balanceUsdc ?? ''}`);
  console.log(`destination=${data.route.destination.chain.name} ${data.route.destination.token.symbol} wallet=${data.route.destination.wallet || ''} balance=${data.route.destination.balanceUsdc ?? ''}`);
  console.log(`requiredBridgeUsdc=${data.bridge.requiredAmountUsdc ?? ''} sourceShortfallUsdc=${data.bridge.sourceShortfallUsdc ?? ''}`);
  if (Array.isArray(data.suggestions) && data.suggestions.length) {
    console.log('next:');
    for (const suggestion of data.suggestions) {
      console.log(`  ${suggestion.message}`);
      if (suggestion.command) {
        console.log(`  ${suggestion.command}`);
      }
    }
  }
}

function renderBridgeExecuteTable(data) {
  console.log('Bridge Execute');
  console.log(`mode=${data.mode} status=${data.status} provider=${data.provider} target=${data.target} amountUsdc=${data.amountUsdc}`);
  console.log(`source=${data.route.source.chain.name} ${data.route.source.token.symbol} wallet=${data.route.source.wallet || ''} balance=${data.route.source.balanceUsdc ?? ''}`);
  console.log(`destination=${data.route.destination.chain.name} ${data.route.destination.token.symbol} wallet=${data.route.destination.wallet || ''} balance=${data.route.destination.balanceUsdc ?? ''}`);
  console.log(`preflight=${data.preflight.status} requiredBridgeUsdc=${data.bridge.requiredAmountUsdc ?? ''} estimatedFeeNative=${data.preflight.estimatedFeeNative ?? ''}`);
  if (data.execution && data.execution.txHash) {
    console.log(`txHash=${data.execution.txHash}`);
  }
  if (Array.isArray(data.suggestions) && data.suggestions.length) {
    console.log('next:');
    for (const suggestion of data.suggestions) {
      console.log(`  ${suggestion.message}`);
      if (suggestion.command) {
        console.log(`  ${suggestion.command}`);
      }
    }
  }
}

function createRunBridgeCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseIndexerSharedFlags = requireDep(deps, 'parseIndexerSharedFlags');
  const maybeLoadTradeEnv = requireDep(deps, 'maybeLoadTradeEnv');

  return async function runBridgeCommand(args, context) {
    const bridgeUsage =
      'pandora [--output table|json] bridge plan|execute ...';
    const planUsage =
      'pandora [--output table|json] bridge plan --target pandora|polymarket --amount-usdc <n> [--wallet <address>] [--to-wallet <address>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--usdc <address>] [--timeout-ms <ms>]';
    const executeUsage =
      'pandora [--output table|json] bridge execute --target pandora|polymarket --amount-usdc <n> --dry-run|--execute [--provider layerzero] [--wallet <address>] [--to-wallet <address>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--usdc <address>] [--timeout-ms <ms>]';
    const shared = parseIndexerSharedFlags(args);
    const action = shared.rest[0] || null;
    const actionArgs = shared.rest.slice(1);

    if (!action || action === '--help' || action === '-h') {
      emitSuccess(context.outputMode, 'bridge.help', commandHelpPayload(bridgeUsage, [
        'bridge plan is a read-only ETH <-> Polygon collateral planner for operator funding gaps.',
        'bridge execute is LayerZero-only and always returns explicit preflight output; use --dry-run to inspect the request and --execute to submit the source-chain transaction.',
      ]));
      return;
    }

    if (action !== 'plan' && action !== 'execute') {
      throw new CliError('INVALID_ARGS', 'bridge requires subcommand: plan|execute');
    }

    if (action === 'plan' && includesHelpFlag(actionArgs)) {
      emitSuccess(context.outputMode, 'bridge.plan.help', commandHelpPayload(planUsage, [
        '--target polymarket plans Ethereum USDC -> Polygon USDC.e funding for the Polymarket side.',
        '--target pandora plans Polygon USDC.e -> Ethereum USDC funding for the Pandora side.',
      ]));
      return;
    }

    if (action === 'execute' && includesHelpFlag(actionArgs)) {
      emitSuccess(context.outputMode, 'bridge.execute.help', commandHelpPayload(executeUsage, [
        '--provider is currently fixed to layerzero. No other bridge provider is supported by this command.',
        '--dry-run returns preflight, provider assumptions, and an execution plan without broadcasting a transaction.',
        '--execute submits the LayerZero source-chain transaction only; destination settlement and venue funding remain explicit follow-up steps.',
      ]));
      return;
    }

    maybeLoadTradeEnv(shared);
    if (action === 'plan') {
      const options = {
        ...parseBridgePlanFlags(actionArgs, CliError),
        timeoutMs: shared.timeoutMs,
      };
      const payload = await buildBridgePlan(options, deps);
      emitSuccess(context.outputMode, 'bridge.plan', payload, renderBridgePlanTable);
      return;
    }

    const options = {
      ...parseBridgeExecuteFlags(actionArgs, CliError),
      timeoutMs: shared.timeoutMs,
    };
    const payload = await buildBridgeExecution({ ...options }, { ...deps, CliError });
    emitSuccess(context.outputMode, 'bridge.execute', payload, renderBridgeExecuteTable);
  };
}

module.exports = {
  BRIDGE_PLAN_SCHEMA_VERSION,
  BRIDGE_EXECUTE_SCHEMA_VERSION,
  createRunBridgeCommand,
  buildBridgePlan,
  buildBridgeExecution,
};
