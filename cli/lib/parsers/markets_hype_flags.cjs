const { assertMcpWorkspacePath } = require('../shared/mcp_path_guard.cjs');
const {
  parseDeployTxRoute,
  parseDeployTxRouteFallback,
  parseDeployFlashbotsRelayUrl,
  assertDeployFlashbotsFlagContract,
} = require('./deploy_route_flags.cjs');
const { consumeProfileSelectorFlag, assertNoMixedSignerSelectors } = require('./shared_profile_selector_flags.cjs');

const PLAN_ACTIONS = new Set(['plan', 'run']);
const PLAN_MARKET_TYPES = new Set(['auto', 'amm', 'parimutuel', 'both']);
const RUN_MARKET_TYPES = new Set(['selected', 'amm', 'parimutuel']);
const AREAS = new Map([
  ['sports', 'sports'],
  ['sport', 'sports'],
  ['esports', 'esports'],
  ['e-sports', 'esports'],
  ['egaming', 'esports'],
  ['e-gaming', 'esports'],
  ['gaming', 'esports'],
  ['politics', 'politics'],
  ['political', 'politics'],
  ['regional-news', 'regional-news'],
  ['regional', 'regional-news'],
  ['local-news', 'regional-news'],
  ['breaking-news', 'breaking-news'],
  ['breaking', 'breaking-news'],
  ['news', 'breaking-news'],
]);

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParseMarketsHypeFlags requires deps.${name}().`);
  }
  return deps[name];
}

function normalizeArea(value, CliError) {
  const normalized = String(value || '').trim().toLowerCase();
  const area = AREAS.get(normalized);
  if (!area) {
    throw new CliError(
      'INVALID_FLAG_VALUE',
      '--area must be sports|esports|politics|regional-news|breaking-news.',
    );
  }
  return area;
}

function parseMarketTypeMode(value, action, CliError) {
  const normalized = String(value || '').trim().toLowerCase();
  const allowed = action === 'plan' ? PLAN_MARKET_TYPES : RUN_MARKET_TYPES;
  if (!allowed.has(normalized)) {
    throw new CliError(
      'INVALID_FLAG_VALUE',
      action === 'plan'
        ? '--market-type must be auto|amm|parimutuel|both.'
        : '--market-type must be selected|amm|parimutuel.',
    );
  }
  return normalized;
}

function createParseMarketsHypeFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const parsePrivateKeyFlag = requireDep(deps, 'parsePrivateKeyFlag');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parseInteger = requireDep(deps, 'parseInteger');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');

  return function parseMarketsHypeFlags(args) {
    const action = String(args[0] || '').trim().toLowerCase();
    const rest = args.slice(1);
    if (!PLAN_ACTIONS.has(action)) {
      throw new CliError('INVALID_ARGS', 'markets hype requires subcommand plan|run.');
    }

    const options = {
      area: null,
      region: null,
      query: null,
      candidateCount: 3,
      marketType: action === 'plan' ? 'auto' : 'selected',
      liquidityUsdc: 100,
      aiProvider: 'auto',
      aiModel: null,
      searchDepth: 'standard',
      chainId: null,
      rpcUrl: null,
      privateKey: null,
      profileId: null,
      profileFile: null,
      oracle: null,
      factory: null,
      usdc: null,
      arbiter: null,
      txRoute: 'public',
      txRouteFallback: 'fail',
      flashbotsRelayUrl: null,
      flashbotsAuthKey: null,
      flashbotsTargetBlockOffset: null,
      minCloseLeadSeconds: 1800,
      planFile: null,
      candidateId: null,
      dryRun: false,
      execute: false,
    };

    for (let i = 0; i < rest.length; i += 1) {
      const token = rest[i];
      if (token === '--area') {
        options.area = normalizeArea(requireFlagValue(rest, i, '--area'), CliError);
        i += 1;
        continue;
      }
      if (token === '--region') {
        options.region = String(requireFlagValue(rest, i, '--region')).trim() || null;
        i += 1;
        continue;
      }
      if (token === '--query') {
        options.query = String(requireFlagValue(rest, i, '--query')).trim() || null;
        i += 1;
        continue;
      }
      if (token === '--candidate-count') {
        options.candidateCount = parsePositiveInteger(requireFlagValue(rest, i, '--candidate-count'), '--candidate-count');
        if (options.candidateCount > 5) {
          throw new CliError('INVALID_FLAG_VALUE', '--candidate-count must be between 1 and 5.');
        }
        i += 1;
        continue;
      }
      if (token === '--market-type') {
        options.marketType = parseMarketTypeMode(requireFlagValue(rest, i, '--market-type'), action, CliError);
        i += 1;
        continue;
      }
      if (token === '--liquidity-usdc') {
        options.liquidityUsdc = parsePositiveNumber(requireFlagValue(rest, i, '--liquidity-usdc'), '--liquidity-usdc');
        i += 1;
        continue;
      }
      if (token === '--ai-provider') {
        options.aiProvider = String(requireFlagValue(rest, i, '--ai-provider')).trim().toLowerCase();
        i += 1;
        continue;
      }
      if (token === '--ai-model') {
        options.aiModel = String(requireFlagValue(rest, i, '--ai-model')).trim() || null;
        i += 1;
        continue;
      }
      if (token === '--search-depth') {
        options.searchDepth = String(requireFlagValue(rest, i, '--search-depth')).trim().toLowerCase();
        if (!['fast', 'standard', 'deep'].includes(options.searchDepth)) {
          throw new CliError('INVALID_FLAG_VALUE', '--search-depth must be fast|standard|deep.');
        }
        i += 1;
        continue;
      }
      if (token === '--chain-id') {
        options.chainId = parseInteger(requireFlagValue(rest, i, '--chain-id'), '--chain-id');
        if (options.chainId <= 0) {
          throw new CliError('INVALID_FLAG_VALUE', '--chain-id must be a positive integer.');
        }
        i += 1;
        continue;
      }
      if (token === '--rpc-url') {
        const rpcUrl = requireFlagValue(rest, i, '--rpc-url');
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
        options.privateKey = parsePrivateKeyFlag(requireFlagValue(rest, i, '--private-key'), '--private-key');
        i += 1;
        continue;
      }
      {
        const nextIndex = consumeProfileSelectorFlag({
          token,
          args: rest,
          index: i,
          options,
          CliError,
          requireFlagValue,
        });
        if (nextIndex !== null) {
          i = nextIndex;
          continue;
        }
      }
      if (token === '--oracle') {
        options.oracle = parseAddressFlag(requireFlagValue(rest, i, '--oracle'), '--oracle');
        i += 1;
        continue;
      }
      if (token === '--factory') {
        options.factory = parseAddressFlag(requireFlagValue(rest, i, '--factory'), '--factory');
        i += 1;
        continue;
      }
      if (token === '--usdc') {
        options.usdc = parseAddressFlag(requireFlagValue(rest, i, '--usdc'), '--usdc');
        i += 1;
        continue;
      }
      if (token === '--arbiter') {
        options.arbiter = parseAddressFlag(requireFlagValue(rest, i, '--arbiter'), '--arbiter');
        i += 1;
        continue;
      }
      if (token === '--tx-route') {
        options.txRoute = parseDeployTxRoute(requireFlagValue(rest, i, '--tx-route'), '--tx-route', CliError);
        i += 1;
        continue;
      }
      if (token === '--tx-route-fallback') {
        options.txRouteFallback = parseDeployTxRouteFallback(
          requireFlagValue(rest, i, '--tx-route-fallback'),
          '--tx-route-fallback',
          CliError,
        );
        i += 1;
        continue;
      }
      if (token === '--flashbots-relay-url') {
        options.flashbotsRelayUrl = parseDeployFlashbotsRelayUrl(
          requireFlagValue(rest, i, '--flashbots-relay-url'),
          '--flashbots-relay-url',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      if (token === '--flashbots-auth-key') {
        options.flashbotsAuthKey = requireFlagValue(rest, i, '--flashbots-auth-key');
        i += 1;
        continue;
      }
      if (token === '--flashbots-target-block-offset') {
        options.flashbotsTargetBlockOffset = parsePositiveInteger(
          requireFlagValue(rest, i, '--flashbots-target-block-offset'),
          '--flashbots-target-block-offset',
        );
        i += 1;
        continue;
      }
      if (token === '--min-close-lead-seconds') {
        options.minCloseLeadSeconds = parsePositiveInteger(
          requireFlagValue(rest, i, '--min-close-lead-seconds'),
          '--min-close-lead-seconds',
        );
        i += 1;
        continue;
      }
      if (token === '--plan-file') {
        const rawPath = requireFlagValue(rest, i, '--plan-file');
        options.planFile = assertMcpWorkspacePath(rawPath, {
          flagName: '--plan-file',
          errorFactory: (code, message, details) => new CliError(code, message, details),
        });
        i += 1;
        continue;
      }
      if (token === '--candidate-id') {
        options.candidateId = String(requireFlagValue(rest, i, '--candidate-id')).trim() || null;
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
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for markets hype ${action}: ${token}`);
    }

    if (action === 'plan') {
      if (!options.area) {
        throw new CliError('MISSING_REQUIRED_FLAG', 'markets hype plan requires --area <name>.');
      }
      if (options.area === 'regional-news' && !String(options.region || '').trim()) {
        throw new CliError('MISSING_REQUIRED_FLAG', 'markets hype plan requires --region <text> when --area regional-news.');
      }
      if (options.dryRun || options.execute) {
        throw new CliError('INVALID_ARGS', 'markets hype plan is read-only; do not pass --dry-run or --execute.');
      }
    } else {
      if (!options.planFile) {
        throw new CliError('MISSING_REQUIRED_FLAG', 'markets hype run requires --plan-file <path>.');
      }
      if (options.dryRun === options.execute) {
        throw new CliError('INVALID_ARGS', 'markets hype run requires exactly one mode: --dry-run or --execute.');
      }
    }

    if (!['auto', 'anthropic', 'mock', 'openai'].includes(options.aiProvider)) {
      throw new CliError('INVALID_FLAG_VALUE', '--ai-provider supports auto|mock|openai|anthropic.');
    }

    assertDeployFlashbotsFlagContract(options, '--tx-route', CliError);
    assertNoMixedSignerSelectors(options, CliError);

    return {
      scope: 'hype',
      action,
      command: `markets.hype.${action}`,
      options,
    };
  };
}

module.exports = {
  createParseMarketsHypeFlags,
};
