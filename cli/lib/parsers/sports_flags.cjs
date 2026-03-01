function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParseSportsFlags requires deps.${name}()`);
  }
  return deps[name];
}

const PROVIDERS = new Set(['auto', 'primary', 'backup']);
const MARKET_TYPES = new Set(['amm', 'parimutuel']);
const RISK_PROFILES = new Set(['conservative', 'balanced', 'aggressive']);
const SYNC_ACTIONS = new Set(['once', 'run', 'start', 'stop', 'status']);
const CREATE_ACTIONS = new Set(['plan', 'run']);
const SELECTIONS = new Set(['home', 'away', 'draw']);

function norm(value) {
  return String(value || '').trim().toLowerCase();
}

function parseProvider(value, flagName, CliError) {
  const provider = norm(value);
  if (!PROVIDERS.has(provider)) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be primary|backup|auto.`);
  }
  return provider;
}

function parseMarketType(value, flagName, CliError) {
  const marketType = norm(value);
  if (!MARKET_TYPES.has(marketType)) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be amm|parimutuel.`);
  }
  return marketType;
}

function parseRiskProfile(value, flagName, CliError) {
  const riskProfile = norm(value);
  if (!RISK_PROFILES.has(riskProfile)) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be conservative|balanced|aggressive.`);
  }
  return riskProfile;
}

function parseSelection(value, flagName, CliError) {
  const selection = norm(value);
  if (!SELECTIONS.has(selection)) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be home|away|draw.`);
  }
  return selection;
}

function parseJson(value, flagName, CliError) {
  try {
    return JSON.parse(String(value));
  } catch {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be valid JSON.`);
  }
}

function parseBaseSportsFlags(args, deps, defaults = {}) {
  const {
    CliError,
    requireFlagValue,
    parseAddressFlag,
    parsePrivateKeyFlag,
    parsePositiveInteger,
    parsePositiveNumber,
    parseNumber,
    parseCsvList,
    parseDateLikeFlag,
    isSecureHttpUrlOrLocal,
  } = deps;

  const options = {
    provider: 'auto',
    bookPriority: null,
    minTier1Books: 3,
    minTotalBooks: 6,
    consensus: 'trimmed-median',
    trimPercent: 20,
    eventId: null,
    competition: null,
    kickoffAfter: null,
    kickoffBefore: null,
    liveOnly: false,
    marketType: 'amm',
    selection: 'home',
    curveFlattener: 7,
    curveOffset: 30000,
    distributionYes: null,
    distributionNo: null,
    creationWindowOpenMin: 1440,
    creationWindowCloseMin: 90,
    syncCadencePrematchMs: 30000,
    syncCadenceLiveMs: 5000,
    syncCadenceNearSettleMs: 2000,
    maxOpenExposureUsdc: null,
    maxRebalanceUsdc: null,
    maxTradesPerDay: null,
    riskProfile: 'conservative',
    timeoutMs: null,
    limit: 50,
    execute: false,
    paper: true,
    liquidityUsdc: 100,
    feeTier: 3000,
    maxImbalance: 10000,
    minCloseLeadSeconds: 5400,
    targetTimestampOffsetHours: 1,
    chainId: null,
    rpcUrl: null,
    privateKey: null,
    usdc: null,
    oracle: null,
    factory: null,
    arbiter: null,
    category: 3,
    stateFile: null,
    checksJson: null,
    checksFile: null,
    pollAddress: null,
    reason: null,
    settleDelayMs: 600000,
    consecutiveChecksRequired: 2,
    now: null,
    nowMs: null,
    ...defaults,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--provider') {
      options.provider = parseProvider(requireFlagValue(args, i, '--provider'), '--provider', CliError);
      i += 1;
      continue;
    }
    if (token === '--provider-mode') {
      options.provider = parseProvider(requireFlagValue(args, i, '--provider-mode'), '--provider-mode', CliError);
      i += 1;
      continue;
    }
    if (token === '--book-priority') {
      options.bookPriority = parseCsvList(requireFlagValue(args, i, '--book-priority'), '--book-priority');
      i += 1;
      continue;
    }
    if (token === '--tier1-books') {
      options.bookPriority = parseCsvList(requireFlagValue(args, i, '--tier1-books'), '--tier1-books');
      i += 1;
      continue;
    }
    if (token === '--min-tier1-books') {
      options.minTier1Books = parsePositiveInteger(requireFlagValue(args, i, '--min-tier1-books'), '--min-tier1-books');
      i += 1;
      continue;
    }
    if (token === '--min-total-books') {
      options.minTotalBooks = parsePositiveInteger(requireFlagValue(args, i, '--min-total-books'), '--min-total-books');
      i += 1;
      continue;
    }
    if (token === '--consensus') {
      const mode = norm(requireFlagValue(args, i, '--consensus'));
      if (mode !== 'trimmed-median') {
        throw new CliError('INVALID_FLAG_VALUE', '--consensus must be trimmed-median in v1.');
      }
      options.consensus = mode;
      i += 1;
      continue;
    }
    if (token === '--trim-percent') {
      const trimPercent = parseNumber(requireFlagValue(args, i, '--trim-percent'), '--trim-percent');
      if (trimPercent < 0 || trimPercent > 49) {
        throw new CliError('INVALID_FLAG_VALUE', '--trim-percent must be between 0 and 49.');
      }
      options.trimPercent = trimPercent;
      i += 1;
      continue;
    }
    if (token === '--event-id') {
      options.eventId = requireFlagValue(args, i, '--event-id');
      i += 1;
      continue;
    }
    if (token === '--competition') {
      options.competition = requireFlagValue(args, i, '--competition');
      i += 1;
      continue;
    }
    if (token === '--kickoff-after') {
      options.kickoffAfter = parseDateLikeFlag(requireFlagValue(args, i, '--kickoff-after'), '--kickoff-after');
      i += 1;
      continue;
    }
    if (token === '--kickoff-before') {
      options.kickoffBefore = parseDateLikeFlag(requireFlagValue(args, i, '--kickoff-before'), '--kickoff-before');
      i += 1;
      continue;
    }
    if (token === '--live-only') {
      options.liveOnly = true;
      continue;
    }
    if (token === '--market-type') {
      options.marketType = parseMarketType(requireFlagValue(args, i, '--market-type'), '--market-type', CliError);
      i += 1;
      continue;
    }
    if (token === '--selection') {
      options.selection = parseSelection(requireFlagValue(args, i, '--selection'), '--selection', CliError);
      i += 1;
      continue;
    }
    if (token === '--curve-flattener') {
      options.curveFlattener = parsePositiveInteger(requireFlagValue(args, i, '--curve-flattener'), '--curve-flattener');
      if (options.curveFlattener < 1 || options.curveFlattener > 11) {
        throw new CliError('INVALID_FLAG_VALUE', '--curve-flattener must be in [1,11].');
      }
      i += 1;
      continue;
    }
    if (token === '--curve-offset') {
      options.curveOffset = parsePositiveInteger(requireFlagValue(args, i, '--curve-offset'), '--curve-offset');
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
    if (token === '--creation-window-open-min') {
      options.creationWindowOpenMin = parsePositiveInteger(requireFlagValue(args, i, '--creation-window-open-min'), '--creation-window-open-min');
      i += 1;
      continue;
    }
    if (token === '--creation-window-close-min') {
      options.creationWindowCloseMin = parsePositiveInteger(requireFlagValue(args, i, '--creation-window-close-min'), '--creation-window-close-min');
      i += 1;
      continue;
    }
    if (token === '--sync-cadence-prematch-ms') {
      options.syncCadencePrematchMs = parsePositiveInteger(requireFlagValue(args, i, '--sync-cadence-prematch-ms'), '--sync-cadence-prematch-ms');
      i += 1;
      continue;
    }
    if (token === '--sync-cadence-live-ms') {
      options.syncCadenceLiveMs = parsePositiveInteger(requireFlagValue(args, i, '--sync-cadence-live-ms'), '--sync-cadence-live-ms');
      i += 1;
      continue;
    }
    if (token === '--sync-cadence-near-settle-ms') {
      options.syncCadenceNearSettleMs = parsePositiveInteger(
        requireFlagValue(args, i, '--sync-cadence-near-settle-ms'),
        '--sync-cadence-near-settle-ms',
      );
      i += 1;
      continue;
    }
    if (token === '--max-open-exposure-usdc') {
      options.maxOpenExposureUsdc = parsePositiveNumber(requireFlagValue(args, i, '--max-open-exposure-usdc'), '--max-open-exposure-usdc');
      i += 1;
      continue;
    }
    if (token === '--max-rebalance-usdc') {
      options.maxRebalanceUsdc = parsePositiveNumber(requireFlagValue(args, i, '--max-rebalance-usdc'), '--max-rebalance-usdc');
      i += 1;
      continue;
    }
    if (token === '--max-trades-per-day') {
      options.maxTradesPerDay = parsePositiveInteger(requireFlagValue(args, i, '--max-trades-per-day'), '--max-trades-per-day');
      i += 1;
      continue;
    }
    if (token === '--risk-profile') {
      options.riskProfile = parseRiskProfile(requireFlagValue(args, i, '--risk-profile'), '--risk-profile', CliError);
      i += 1;
      continue;
    }
    if (token === '--timeout-ms') {
      options.timeoutMs = parsePositiveInteger(requireFlagValue(args, i, '--timeout-ms'), '--timeout-ms');
      i += 1;
      continue;
    }
    if (token === '--limit') {
      options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
      i += 1;
      continue;
    }
    if (token === '--execute') {
      options.execute = true;
      options.paper = false;
      continue;
    }
    if (token === '--dry-run' || token === '--paper') {
      options.paper = true;
      options.execute = false;
      continue;
    }
    if (token === '--execute-live') {
      options.execute = true;
      options.paper = false;
      continue;
    }
    if (token === '--liquidity-usdc' || token === '--liquidity') {
      options.liquidityUsdc = parsePositiveNumber(requireFlagValue(args, i, token), token);
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
    if (token === '--min-close-lead-seconds') {
      options.minCloseLeadSeconds = parsePositiveInteger(requireFlagValue(args, i, '--min-close-lead-seconds'), '--min-close-lead-seconds');
      i += 1;
      continue;
    }
    if (token === '--target-timestamp-offset-hours') {
      options.targetTimestampOffsetHours = parsePositiveInteger(requireFlagValue(args, i, '--target-timestamp-offset-hours'), '--target-timestamp-offset-hours');
      i += 1;
      continue;
    }
    if (token === '--chain-id') {
      options.chainId = parsePositiveInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
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
    if (token === '--usdc') {
      options.usdc = parseAddressFlag(requireFlagValue(args, i, '--usdc'), '--usdc');
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
    if (token === '--arbiter') {
      options.arbiter = parseAddressFlag(requireFlagValue(args, i, '--arbiter'), '--arbiter');
      i += 1;
      continue;
    }
    if (token === '--category') {
      options.category = parsePositiveInteger(requireFlagValue(args, i, '--category'), '--category');
      i += 1;
      continue;
    }
    if (token === '--state-file') {
      options.stateFile = requireFlagValue(args, i, '--state-file');
      i += 1;
      continue;
    }
    if (token === '--checks-json') {
      options.checksJson = parseJson(requireFlagValue(args, i, '--checks-json'), '--checks-json', CliError);
      i += 1;
      continue;
    }
    if (token === '--checks-file') {
      options.checksFile = requireFlagValue(args, i, '--checks-file');
      i += 1;
      continue;
    }
    if (token === '--poll-address') {
      options.pollAddress = requireFlagValue(args, i, '--poll-address');
      i += 1;
      continue;
    }
    if (token === '--reason') {
      options.reason = requireFlagValue(args, i, '--reason');
      i += 1;
      continue;
    }
    if (token === '--settle-delay-ms') {
      options.settleDelayMs = parsePositiveInteger(requireFlagValue(args, i, '--settle-delay-ms'), '--settle-delay-ms');
      i += 1;
      continue;
    }
    if (token === '--consecutive-checks-required') {
      options.consecutiveChecksRequired = parsePositiveInteger(
        requireFlagValue(args, i, '--consecutive-checks-required'),
        '--consecutive-checks-required',
      );
      i += 1;
      continue;
    }
    if (token === '--now') {
      options.now = parseDateLikeFlag(requireFlagValue(args, i, '--now'), '--now');
      i += 1;
      continue;
    }
    if (token === '--now-ms') {
      options.nowMs = parseNumber(requireFlagValue(args, i, '--now-ms'), '--now-ms');
      i += 1;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for sports: ${token}`);
  }

  if (options.distributionYes !== null || options.distributionNo !== null) {
    if (!Number.isInteger(options.distributionYes) || !Number.isInteger(options.distributionNo)) {
      throw new CliError('INVALID_ARGS', 'Both --distribution-yes and --distribution-no are required when setting distribution.');
    }
    if (options.distributionYes + options.distributionNo !== 1_000_000_000) {
      throw new CliError('INVALID_ARGS', '--distribution-yes + --distribution-no must equal 1000000000.');
    }
  }

  return options;
}

/**
 * Create parser for `sports` command family.
 * @param {object} deps
 * @returns {(args: string[]) => {scope: string, action: string, command: string, options: object}}
 */
function createParseSportsFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parseInteger = requireDep(deps, 'parseInteger');
  const parseNumber = requireDep(deps, 'parseNumber');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const parsePrivateKeyFlag = requireDep(deps, 'parsePrivateKeyFlag');
  const parseCsvList = requireDep(deps, 'parseCsvList');
  const parseDateLikeFlag = requireDep(deps, 'parseDateLikeFlag');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');

  const baseDeps = {
    CliError,
    requireFlagValue,
    parsePositiveInteger,
    parsePositiveNumber,
    parseInteger,
    parseNumber,
    parseAddressFlag,
    parsePrivateKeyFlag,
    parseCsvList,
    parseDateLikeFlag,
    isSecureHttpUrlOrLocal,
  };

  return function parseSportsFlags(args) {
    const scope = norm(args[0]);
    const action = norm(args[1]);
    const rest = args.slice(2);

    if (scope === 'books' && action === 'list') {
      return { scope, action, command: 'sports.books.list', options: parseBaseSportsFlags(rest, baseDeps, {}) };
    }
    if (scope === 'events' && (action === 'list' || action === 'live')) {
      const options = parseBaseSportsFlags(rest, baseDeps, { liveOnly: action === 'live' });
      return { scope, action, command: `sports.events.${action}`, options };
    }
    if (scope === 'odds' && action === 'snapshot') {
      const options = parseBaseSportsFlags(rest, baseDeps, {});
      if (!options.eventId) {
        throw new CliError('MISSING_REQUIRED_FLAG', 'sports odds snapshot requires --event-id <id>.');
      }
      return { scope, action, command: 'sports.odds.snapshot', options };
    }
    if (scope === 'consensus') {
      const options = parseBaseSportsFlags(args.slice(1), baseDeps, {});
      if (!options.eventId && !options.checksJson) {
        throw new CliError('MISSING_REQUIRED_FLAG', 'sports consensus requires --event-id <id> (or --checks-json for offline inputs).');
      }
      return { scope, action: 'consensus', command: 'sports.consensus', options };
    }
    if (scope === 'create' && CREATE_ACTIONS.has(action)) {
      const options = parseBaseSportsFlags(rest, baseDeps, {});
      if (!options.eventId) {
        throw new CliError('MISSING_REQUIRED_FLAG', `sports create ${action} requires --event-id <id>.`);
      }
      if (action === 'plan') {
        options.paper = true;
        options.execute = false;
      }
      return { scope, action, command: `sports.create.${action}`, options };
    }
    if (scope === 'sync' && SYNC_ACTIONS.has(action)) {
      const options = parseBaseSportsFlags(rest, baseDeps, { paper: true });
      if ((action === 'once' || action === 'run' || action === 'start') && !options.eventId) {
        throw new CliError('MISSING_REQUIRED_FLAG', `sports sync ${action} requires --event-id <id>.`);
      }
      return { scope, action, command: `sports.sync.${action}`, options };
    }
    if (scope === 'resolve' && action === 'plan') {
      const options = parseBaseSportsFlags(rest, baseDeps, {});
      if (!options.eventId && !options.checksJson && !options.checksFile) {
        throw new CliError('MISSING_REQUIRED_FLAG', 'sports resolve plan requires --event-id <id> or --checks-json/--checks-file.');
      }
      return { scope, action, command: 'sports.resolve.plan', options };
    }

    throw new CliError(
      'INVALID_USAGE',
      'sports requires one of: books list | events list|live | odds snapshot | consensus | create plan|run | sync once|run|start|stop|status | resolve plan',
    );
  };
}

module.exports = {
  createParseSportsFlags,
};
