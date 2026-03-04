const { MIN_AMM_FEE_TIER, MAX_AMM_FEE_TIER } = require('../shared/constants.cjs');

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParseMirrorDeployFlags requires deps.${name}()`);
  }
  return deps[name];
}

function normalizeSources(entries) {
  const values = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const parts = String(entry || '').split(/[\n,]/g);
    for (const part of parts) {
      const normalized = String(part || '').trim();
      if (normalized) values.push(normalized);
    }
  }
  return values;
}

/**
 * Creates the mirror deploy flags parser.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseMirrorDeployFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const parsePrivateKeyFlag = requireDep(deps, 'parsePrivateKeyFlag');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parseInteger = requireDep(deps, 'parseInteger');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');

  return function parseMirrorDeployFlags(args) {
    const options = {
      planFile: null,
      polymarketMarketId: null,
      polymarketSlug: null,
      dryRun: false,
      execute: false,
      marketType: 'amm',
      liquidityUsdc: null,
      feeTier: 3000,
      maxImbalance: 10_000,
      arbiter: null,
      category: 3,
      sources: [],
      sourcesProvided: false,
      chainId: null,
      rpcUrl: null,
      privateKey: null,
      oracle: null,
      factory: null,
      usdc: null,
      distributionYes: null,
      distributionNo: null,
      polymarketHost: null,
      polymarketGammaUrl: null,
      polymarketGammaMockUrl: null,
      polymarketMockUrl: null,
      manifestFile: null,
      minCloseLeadSeconds: 3600,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--plan-file') {
        options.planFile = requireFlagValue(args, i, '--plan-file');
        i += 1;
        continue;
      }
      if (token === '--polymarket-market-id') {
        options.polymarketMarketId = requireFlagValue(args, i, '--polymarket-market-id');
        i += 1;
        continue;
      }
      if (token === '--polymarket-slug') {
        options.polymarketSlug = requireFlagValue(args, i, '--polymarket-slug');
        i += 1;
        continue;
      }
      if (token === '--dry-run') {
        options.dryRun = true;
        continue;
      }
      if (token === '--execute') {
        options.execute = true;
        continue;
      }
      if (token === '--market-type') {
        options.marketType = requireFlagValue(args, i, '--market-type').toLowerCase();
        i += 1;
        continue;
      }
      if (token === '--liquidity-usdc') {
        options.liquidityUsdc = parsePositiveNumber(requireFlagValue(args, i, '--liquidity-usdc'), '--liquidity-usdc');
        i += 1;
        continue;
      }
      if (token === '--fee-tier') {
        options.feeTier = parsePositiveInteger(requireFlagValue(args, i, '--fee-tier'), '--fee-tier');
        i += 1;
        continue;
      }
      if (token === '--max-imbalance') {
        options.maxImbalance = parsePositiveInteger(requireFlagValue(args, i, '--max-imbalance'), '--max-imbalance');
        i += 1;
        continue;
      }
      if (token === '--arbiter') {
        options.arbiter = parseAddressFlag(requireFlagValue(args, i, '--arbiter'), '--arbiter');
        i += 1;
        continue;
      }
      if (token === '--category') {
        options.category = parseInteger(requireFlagValue(args, i, '--category'), '--category');
        i += 1;
        continue;
      }
      if (token === '--allow-rule-mismatch') {
        throw new CliError(
          'INVALID_ARGS',
          '--allow-rule-mismatch is not supported for mirror deploy. Use mirror verify --allow-rule-mismatch for diagnostics only.',
        );
      }
      if (token === '--sources') {
        let j = i + 1;
        const entries = [];
        while (j < args.length && !args[j].startsWith('--')) {
          entries.push(args[j]);
          j += 1;
        }
        if (!entries.length) {
          throw new CliError('MISSING_FLAG_VALUE', 'Missing value for --sources');
        }
        options.sourcesProvided = true;
        options.sources.push(...entries);
        i = j - 1;
        continue;
      }
      if (token === '--chain-id') {
        options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
        i += 1;
        continue;
      }
      if (token === '--rpc-url') {
        const rpcUrl = requireFlagValue(args, i, '--rpc-url');
        if (!isSecureHttpUrlOrLocal(rpcUrl)) {
          throw new CliError(
            'INVALID_FLAG_VALUE',
            '--rpc-url must use https:// (or http://localhost/127.0.0.1 for local testing).',
          );
        }
        options.rpcUrl = rpcUrl;
        i += 1;
        continue;
      }
      if (token === '--private-key') {
        options.privateKey = parsePrivateKeyFlag(requireFlagValue(args, i, '--private-key'), '--private-key');
        i += 1;
        continue;
      }
      if (token === '--oracle') {
        options.oracle = parseAddressFlag(requireFlagValue(args, i, '--oracle'), '--oracle');
        i += 1;
        continue;
      }
      if (token === '--factory') {
        options.factory = parseAddressFlag(requireFlagValue(args, i, '--factory'), '--factory');
        i += 1;
        continue;
      }
      if (token === '--usdc') {
        options.usdc = parseAddressFlag(requireFlagValue(args, i, '--usdc'), '--usdc');
        i += 1;
        continue;
      }
      if (token === '--distribution-yes') {
        options.distributionYes = parsePositiveInteger(requireFlagValue(args, i, '--distribution-yes'), '--distribution-yes');
        i += 1;
        continue;
      }
      if (token === '--distribution-no') {
        options.distributionNo = parsePositiveInteger(requireFlagValue(args, i, '--distribution-no'), '--distribution-no');
        i += 1;
        continue;
      }
      if (token === '--polymarket-host') {
        const polymarketHost = requireFlagValue(args, i, '--polymarket-host');
        if (!isSecureHttpUrlOrLocal(polymarketHost)) {
          throw new CliError(
            'INVALID_FLAG_VALUE',
            '--polymarket-host must use https:// (or http://localhost/127.0.0.1 for local testing).',
          );
        }
        options.polymarketHost = polymarketHost;
        i += 1;
        continue;
      }
      if (token === '--polymarket-gamma-url') {
        options.polymarketGammaUrl = requireFlagValue(args, i, '--polymarket-gamma-url');
        i += 1;
        continue;
      }
      if (token === '--polymarket-gamma-mock-url') {
        options.polymarketGammaMockUrl = requireFlagValue(args, i, '--polymarket-gamma-mock-url');
        i += 1;
        continue;
      }
      if (token === '--polymarket-mock-url') {
        options.polymarketMockUrl = requireFlagValue(args, i, '--polymarket-mock-url');
        i += 1;
        continue;
      }
      if (token === '--manifest-file') {
        options.manifestFile = requireFlagValue(args, i, '--manifest-file');
        i += 1;
        continue;
      }
      if (token === '--min-close-lead-seconds') {
        options.minCloseLeadSeconds = parsePositiveInteger(
          requireFlagValue(args, i, '--min-close-lead-seconds'),
          '--min-close-lead-seconds',
        );
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror deploy: ${token}`);
    }

    if (options.dryRun === options.execute) {
      throw new CliError('INVALID_ARGS', 'mirror deploy requires exactly one mode: --dry-run or --execute.');
    }
    if (options.marketType !== 'amm') {
      throw new CliError('INVALID_FLAG_VALUE', 'mirror deploy only supports --market-type amm in v1.');
    }
    if (!options.planFile && !options.polymarketMarketId && !options.polymarketSlug) {
      throw new CliError(
        'MISSING_REQUIRED_FLAG',
        'mirror deploy requires --plan-file <path> or a Polymarket selector (--polymarket-market-id/--polymarket-slug).',
      );
    }
    if (options.feeTier < MIN_AMM_FEE_TIER || options.feeTier > MAX_AMM_FEE_TIER) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        `--fee-tier must be between ${MIN_AMM_FEE_TIER} and ${MAX_AMM_FEE_TIER} (max 5%).`,
      );
    }
    if (
      (options.distributionYes === null && options.distributionNo !== null) ||
      (options.distributionYes !== null && options.distributionNo === null)
    ) {
      throw new CliError('INVALID_ARGS', 'Provide both --distribution-yes and --distribution-no together.');
    }
    if (
      options.distributionYes !== null &&
      options.distributionNo !== null &&
      options.distributionYes + options.distributionNo !== 1_000_000_000
    ) {
      throw new CliError('INVALID_ARGS', '--distribution-yes + --distribution-no must equal 1000000000.');
    }
    if (options.sourcesProvided && normalizeSources(options.sources).length < 2) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        '--sources requires at least two non-empty URLs when explicitly provided.',
      );
    }

    return options;
  };
}

/** Public mirror deploy parser factory export. */
module.exports = {
  createParseMirrorDeployFlags,
};
