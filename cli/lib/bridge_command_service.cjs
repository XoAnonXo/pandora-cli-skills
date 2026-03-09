const { DEFAULT_RPC_BY_CHAIN_ID, DEFAULT_USDC } = require('./shared/constants.cjs');
const { resolveWalletFromOptions } = require('./markets_mine_service.cjs');
const { readPandoraWalletBalances } = require('./dashboard_fund_service.cjs');

const BRIDGE_PLAN_SCHEMA_VERSION = '1.0.0';
const POLYGON_CHAIN_ID = 137;
const POLYGON_USDC_E = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174';
const CHAIN_METADATA = {
  1: { id: 1, name: 'Ethereum', nativeSymbol: 'ETH', recommendedNativeGas: 0.005 },
  137: { id: 137, name: 'Polygon', nativeSymbol: 'MATIC', recommendedNativeGas: 0.2 },
};

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`bridge service requires deps.${name}()`);
  }
  return deps[name];
}

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
      action: 'bridge-manually',
      message: plan.bridge.sourceShortfallUsdc > 0
        ? `Source-side ${plan.route.source.token.symbol} is short ${plan.bridge.sourceShortfallUsdc} USDC for the proposed bridge.`
        : `Bridge ${plan.bridge.requiredAmountUsdc} ${plan.route.source.token.symbol} manually from ${plan.route.source.chain.name} to ${plan.route.destination.chain.name}; Pandora does not execute the bridge transfer itself.`,
      command: null,
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

function parseBridgePlanFlags(args, CliError) {
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
    throw new CliError('UNKNOWN_FLAG', `Unknown flag for bridge plan: ${token}`);
  }

  if (!options.target) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'bridge plan requires --target pandora|polymarket.');
  }
  if (!Number.isFinite(options.amountUsdc)) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'bridge plan requires --amount-usdc <n>.');
  }

  return options;
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
      'Planner only: Pandora does not execute bridge transactions or choose a bridge provider.',
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

function createRunBridgeCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseIndexerSharedFlags = requireDep(deps, 'parseIndexerSharedFlags');
  const maybeLoadTradeEnv = requireDep(deps, 'maybeLoadTradeEnv');

  return async function runBridgeCommand(args, context) {
    const usage =
      'pandora [--output table|json] bridge plan --target pandora|polymarket --amount-usdc <n> [--wallet <address>] [--to-wallet <address>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--usdc <address>] [--timeout-ms <ms>]';
    const shared = parseIndexerSharedFlags(args);
    const action = shared.rest[0] || null;
    const actionArgs = shared.rest.slice(1);

    if (!action || action === '--help' || action === '-h') {
      emitSuccess(context.outputMode, 'bridge.help', commandHelpPayload(usage, [
        'bridge plan is a read-only ETH <-> Polygon collateral planner for operator funding gaps.',
        'The planner returns explicit chain/token assumptions, source and destination balances, gas expectations, and manual next steps; Pandora does not execute the bridge itself.',
      ]));
      return;
    }

    if (action !== 'plan') {
      throw new CliError('INVALID_ARGS', 'bridge requires subcommand: plan');
    }

    if (includesHelpFlag(actionArgs)) {
      emitSuccess(context.outputMode, 'bridge.plan.help', commandHelpPayload(usage, [
        '--target polymarket plans Ethereum USDC -> Polygon USDC.e funding for the Polymarket side.',
        '--target pandora plans Polygon USDC.e -> Ethereum USDC funding for the Pandora side.',
      ]));
      return;
    }

    maybeLoadTradeEnv(shared);
    const options = parseBridgePlanFlags(actionArgs, CliError);
    const payload = await buildBridgePlan(options, deps);
    emitSuccess(context.outputMode, 'bridge.plan', payload, renderBridgePlanTable);
  };
}

module.exports = {
  BRIDGE_PLAN_SCHEMA_VERSION,
  createRunBridgeCommand,
  buildBridgePlan,
};
