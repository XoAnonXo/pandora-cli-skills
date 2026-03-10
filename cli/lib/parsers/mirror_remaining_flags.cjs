const { MIN_AMM_FEE_TIER, MAX_AMM_FEE_TIER } = require('../shared/constants.cjs');
const { normalizeMirrorPathForMcp, validateMirrorUrl } = require('./mirror_parser_guard.cjs');

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`mirror remaining parser requires deps.${name}()`);
  }
  return deps[name];
}

function parseDefaultIndexerTimeoutMs(deps) {
  const value = deps && Number.isFinite(deps.defaultIndexerTimeoutMs) ? Number(deps.defaultIndexerTimeoutMs) : 60_000;
  return value > 0 ? value : 60_000;
}

function createParseMirrorSurfaceFlags(deps, config = {}) {
  const CliError = requireDep(deps, 'CliError');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');
  const defaultIndexerTimeoutMs = parseDefaultIndexerTimeoutMs(deps);
  const commandLabel = String(config.commandLabel || 'mirror status');
  const defaultWithLive = Boolean(config.defaultWithLive);
  const allowReconciled = Boolean(config.allowReconciled);
  const allowIncludeLegacyApprox = Boolean(config.allowIncludeLegacyApprox);

  return function parseMirrorSurfaceFlags(args) {
    const options = {
      stateFile: null,
      strategyHash: null,
      withLive: defaultWithLive,
      trustDeploy: false,
      manifestFile: null,
      pandoraMarketAddress: null,
      polymarketMarketId: null,
      polymarketSlug: null,
      driftTriggerBps: 150,
      hedgeTriggerUsdc: 10,
      indexerUrl: null,
      timeoutMs: defaultIndexerTimeoutMs,
      polymarketHost: null,
      polymarketGammaUrl: null,
      polymarketGammaMockUrl: null,
      polymarketMockUrl: null,
      reconciled: false,
      includeLegacyApprox: false,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--state-file') {
        options.stateFile = normalizeMirrorPathForMcp(
          requireFlagValue(args, i, '--state-file'),
          '--state-file',
          CliError,
        );
        i += 1;
        continue;
      }
      if (token === '--strategy-hash') {
        const value = requireFlagValue(args, i, '--strategy-hash');
        if (!/^[a-f0-9]{16}$/i.test(value)) {
          throw new CliError('INVALID_FLAG_VALUE', '--strategy-hash must be a 16-character hex value.');
        }
        options.strategyHash = value.toLowerCase();
        i += 1;
        continue;
      }
      if (token === '--with-live') {
        options.withLive = true;
        continue;
      }
      if (allowReconciled && token === '--reconciled') {
        options.reconciled = true;
        continue;
      }
      if (allowIncludeLegacyApprox && token === '--include-legacy-approx') {
        options.includeLegacyApprox = true;
        continue;
      }
      if (token === '--trust-deploy') {
        options.trustDeploy = true;
        continue;
      }
      if (token === '--manifest-file') {
        options.manifestFile = normalizeMirrorPathForMcp(
          requireFlagValue(args, i, '--manifest-file'),
          '--manifest-file',
          CliError,
        );
        i += 1;
        continue;
      }
      if (token === '--pandora-market-address' || token === '--market-address') {
        options.pandoraMarketAddress = parseAddressFlag(requireFlagValue(args, i, token), token);
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
      if (token === '--drift-trigger-bps') {
        options.driftTriggerBps = parsePositiveInteger(requireFlagValue(args, i, '--drift-trigger-bps'), '--drift-trigger-bps');
        i += 1;
        continue;
      }
      if (token === '--hedge-trigger-usdc') {
        options.hedgeTriggerUsdc = parsePositiveNumber(requireFlagValue(args, i, '--hedge-trigger-usdc'), '--hedge-trigger-usdc');
        i += 1;
        continue;
      }
      if (token === '--indexer-url') {
        options.indexerUrl = requireFlagValue(args, i, '--indexer-url');
        i += 1;
        continue;
      }
      if (token === '--timeout-ms') {
        options.timeoutMs = parsePositiveInteger(requireFlagValue(args, i, '--timeout-ms'), '--timeout-ms');
        i += 1;
        continue;
      }
      if (token === '--polymarket-host') {
        options.polymarketHost = validateMirrorUrl(
          requireFlagValue(args, i, '--polymarket-host'),
          '--polymarket-host',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      if (token === '--polymarket-gamma-url') {
        options.polymarketGammaUrl = validateMirrorUrl(
          requireFlagValue(args, i, '--polymarket-gamma-url'),
          '--polymarket-gamma-url',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      if (token === '--polymarket-gamma-mock-url') {
        options.polymarketGammaMockUrl = validateMirrorUrl(
          requireFlagValue(args, i, '--polymarket-gamma-mock-url'),
          '--polymarket-gamma-mock-url',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      if (token === '--polymarket-mock-url') {
        options.polymarketMockUrl = validateMirrorUrl(
          requireFlagValue(args, i, '--polymarket-mock-url'),
          '--polymarket-mock-url',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for ${commandLabel}: ${token}`);
    }

    const hasPersistedSelector = Boolean(options.stateFile || options.strategyHash);
    const hasSelectorHint = Boolean(
      options.pandoraMarketAddress || options.polymarketMarketId || options.polymarketSlug,
    );
    if (!hasPersistedSelector && !hasSelectorHint) {
      throw new CliError(
        'MISSING_REQUIRED_FLAG',
        `${commandLabel} requires --state-file <path>, --strategy-hash <hash>, or at least one selector hint (--pandora-market-address/--market-address and/or --polymarket-market-id|--polymarket-slug).`,
      );
    }

    if (options.includeLegacyApprox) {
      options.reconciled = true;
    }

    return options;
  };
}

/**
 * Creates the mirror browse parser.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseMirrorBrowseFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parseProbabilityPercent = requireDep(deps, 'parseProbabilityPercent');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parseDateLikeFlag = requireDep(deps, 'parseDateLikeFlag');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parseInteger = requireDep(deps, 'parseInteger');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');
  const allowedSortBy = new Set(['volume24h', 'liquidity', 'endDate']);
  const allowedCategories = new Set(['sports', 'crypto', 'politics', 'entertainment']);

  function parseBrowseWindowValue(value, flagName) {
    const text = String(value || '').trim();
    const relativeMatch = /^([1-9]\d*)([smhdw])$/i.exec(text);
    if (relativeMatch) {
      const quantity = Number(relativeMatch[1]);
      const unit = String(relativeMatch[2] || '').toLowerCase();
      const unitMs = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
        w: 7 * 24 * 60 * 60 * 1000,
      };
      const multiplier = unitMs[unit];
      if (!multiplier) {
        throw new CliError(
          'INVALID_FLAG_VALUE',
          `${flagName} relative window must use one of s|m|h|d|w (example: 72h). Received: "${text}"`,
        );
      }
      return new Date(Date.now() + quantity * multiplier).toISOString();
    }
    return parseDateLikeFlag(text, flagName);
  }

  function parseSortBy(rawValue) {
    const text = String(rawValue || '').trim().toLowerCase();
    if (!text) {
      throw new CliError('INVALID_FLAG_VALUE', '--sort-by requires a value: volume24h|liquidity|endDate.');
    }
    if (text === 'volume' || text === 'volume24h' || text === 'volume24husd') return 'volume24h';
    if (text === 'liquidity' || text === 'liquidityusd') return 'liquidity';
    if (text === 'enddate' || text === 'end-date' || text === 'close' || text === 'close-time' || text === 'closetimestamp') {
      return 'endDate';
    }
    throw new CliError(
      'INVALID_FLAG_VALUE',
      `--sort-by must be one of volume24h|liquidity|endDate. Received: "${rawValue}"`,
    );
  }

  function parseCategoryList(rawValue, flagName) {
    const values = String(rawValue || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (!values.length) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        `${flagName} must include at least one category: sports|crypto|politics|entertainment.`,
      );
    }
    for (const value of values) {
      if (!allowedCategories.has(value)) {
        throw new CliError(
          'INVALID_FLAG_VALUE',
          `${flagName} contains unsupported category "${value}". Allowed: sports|crypto|politics|entertainment.`,
        );
      }
    }
    return Array.from(new Set(values));
  }

  return function parseMirrorBrowseFlags(args) {
    const options = {
      minYesPct: null,
      maxYesPct: null,
      minVolume24h: 0,
      closesAfter: null,
      closesBefore: null,
      questionContains: null,
      limit: 10,
      chainId: null,
      polymarketGammaUrl: null,
      polymarketGammaMockUrl: null,
      polymarketMockUrl: null,
      polymarketTagIds: [],
      categories: [],
      excludeSports: false,
      sortBy: 'volume24h',
      keyword: null,
      slug: null,
    };

    function pushTagId(rawValue, flagName) {
      options.polymarketTagIds.push(parsePositiveInteger(rawValue, flagName));
    }

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--min-yes-pct') {
        options.minYesPct = parseProbabilityPercent(requireFlagValue(args, i, '--min-yes-pct'), '--min-yes-pct');
        i += 1;
        continue;
      }
      if (token === '--max-yes-pct') {
        options.maxYesPct = parseProbabilityPercent(requireFlagValue(args, i, '--max-yes-pct'), '--max-yes-pct');
        i += 1;
        continue;
      }
      if (token === '--min-volume-24h') {
        options.minVolume24h = parsePositiveNumber(requireFlagValue(args, i, '--min-volume-24h'), '--min-volume-24h');
        i += 1;
        continue;
      }
      if (token === '--closes-after' || token === '--end-date-after') {
        options.closesAfter = parseBrowseWindowValue(requireFlagValue(args, i, token), token);
        i += 1;
        continue;
      }
      if (token === '--closes-before' || token === '--end-date-before') {
        options.closesBefore = parseBrowseWindowValue(requireFlagValue(args, i, token), token);
        i += 1;
        continue;
      }
      if (token === '--question-contains') {
        options.questionContains = requireFlagValue(args, i, '--question-contains');
        i += 1;
        continue;
      }
      if (token === '--keyword') {
        options.keyword = requireFlagValue(args, i, '--keyword');
        i += 1;
        continue;
      }
      if (token === '--slug') {
        options.slug = requireFlagValue(args, i, '--slug');
        i += 1;
        continue;
      }
      if (token === '--limit') {
        options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
        i += 1;
        continue;
      }
      if (token === '--sort-by') {
        options.sortBy = parseSortBy(requireFlagValue(args, i, '--sort-by'));
        i += 1;
        continue;
      }
      if (token === '--category') {
        const parsed = parseCategoryList(requireFlagValue(args, i, '--category'), '--category');
        options.categories = Array.from(new Set(options.categories.concat(parsed)));
        i += 1;
        continue;
      }
      if (token === '--exclude-sports') {
        options.excludeSports = true;
        continue;
      }
      if (token === '--chain-id') {
        options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
        i += 1;
        continue;
      }
      if (token === '--polymarket-gamma-url') {
        options.polymarketGammaUrl = validateMirrorUrl(
          requireFlagValue(args, i, '--polymarket-gamma-url'),
          '--polymarket-gamma-url',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      if (token === '--polymarket-gamma-mock-url') {
        options.polymarketGammaMockUrl = validateMirrorUrl(
          requireFlagValue(args, i, '--polymarket-gamma-mock-url'),
          '--polymarket-gamma-mock-url',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      if (token === '--polymarket-mock-url') {
        options.polymarketMockUrl = validateMirrorUrl(
          requireFlagValue(args, i, '--polymarket-mock-url'),
          '--polymarket-mock-url',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      if (token === '--polymarket-tag-id' || token === '--sport-tag-id') {
        pushTagId(requireFlagValue(args, i, token), token);
        i += 1;
        continue;
      }
      if (token === '--polymarket-tag-ids' || token === '--sport-tag-ids') {
        const raw = requireFlagValue(args, i, token);
        const values = String(raw)
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        if (!values.length) {
          throw new CliError('INVALID_FLAG_VALUE', `${token} must include at least one positive integer tag id.`);
        }
        for (const value of values) {
          pushTagId(value, token);
        }
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror browse: ${token}`);
    }

    if (options.minYesPct !== null && options.maxYesPct !== null && options.minYesPct > options.maxYesPct) {
      throw new CliError('INVALID_ARGS', '--min-yes-pct cannot be greater than --max-yes-pct.');
    }
    if (
      options.closesAfter &&
      options.closesBefore &&
      Number.isFinite(Date.parse(options.closesAfter)) &&
      Number.isFinite(Date.parse(options.closesBefore)) &&
      Date.parse(options.closesAfter) > Date.parse(options.closesBefore)
    ) {
      throw new CliError('INVALID_ARGS', '--closes-after/--end-date-after cannot be later than --closes-before/--end-date-before.');
    }
    if (options.excludeSports && options.categories.includes('sports')) {
      throw new CliError('INVALID_ARGS', '--exclude-sports cannot be combined with --category sports.');
    }

    if (options.polymarketTagIds.length) {
      options.polymarketTagIds = Array.from(new Set(options.polymarketTagIds));
    }
    if (options.categories.length) {
      options.categories = Array.from(new Set(options.categories));
    }
    if (allowedSortBy.has(options.sortBy) !== true) {
      throw new CliError('INVALID_FLAG_VALUE', `Unsupported --sort-by value: "${options.sortBy}"`);
    }

    return options;
  };
}

/**
 * Creates the mirror verify parser.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseMirrorVerifyFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');

  return function parseMirrorVerifyFlags(args) {
    const options = {
      pandoraMarketAddress: null,
      polymarketMarketId: null,
      polymarketSlug: null,
      includeSimilarity: false,
      withRules: false,
      allowRuleMismatch: false,
      trustDeploy: false,
      manifestFile: null,
      polymarketHost: null,
      polymarketGammaUrl: null,
      polymarketGammaMockUrl: null,
      polymarketMockUrl: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--pandora-market-address' || token === '--market-address') {
        options.pandoraMarketAddress = parseAddressFlag(requireFlagValue(args, i, token), token);
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
      if (token === '--include-similarity') {
        options.includeSimilarity = true;
        continue;
      }
      if (token === '--with-rules') {
        options.withRules = true;
        continue;
      }
      if (token === '--allow-rule-mismatch') {
        options.allowRuleMismatch = true;
        continue;
      }
      if (token === '--trust-deploy') {
        options.trustDeploy = true;
        continue;
      }
      if (token === '--manifest-file') {
        options.manifestFile = normalizeMirrorPathForMcp(
          requireFlagValue(args, i, '--manifest-file'),
          '--manifest-file',
          CliError,
        );
        i += 1;
        continue;
      }
      if (token === '--polymarket-host') {
        options.polymarketHost = validateMirrorUrl(
          requireFlagValue(args, i, '--polymarket-host'),
          '--polymarket-host',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      if (token === '--polymarket-gamma-url') {
        options.polymarketGammaUrl = validateMirrorUrl(
          requireFlagValue(args, i, '--polymarket-gamma-url'),
          '--polymarket-gamma-url',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      if (token === '--polymarket-gamma-mock-url') {
        options.polymarketGammaMockUrl = validateMirrorUrl(
          requireFlagValue(args, i, '--polymarket-gamma-mock-url'),
          '--polymarket-gamma-mock-url',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      if (token === '--polymarket-mock-url') {
        options.polymarketMockUrl = validateMirrorUrl(
          requireFlagValue(args, i, '--polymarket-mock-url'),
          '--polymarket-mock-url',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror verify: ${token}`);
    }

    if (!options.pandoraMarketAddress) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing --pandora-market-address <address> (alias: --market-address).');
    }
    if (!options.polymarketMarketId && !options.polymarketSlug) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'mirror verify requires --polymarket-market-id <id> or --polymarket-slug <slug>.');
    }

    return options;
  };
}

/**
 * Creates the mirror status parser.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseMirrorStatusFlags(deps) {
  return createParseMirrorSurfaceFlags(deps, {
    commandLabel: 'mirror status',
    defaultWithLive: false,
  });
}

function createParseMirrorPnlFlags(deps) {
  return createParseMirrorSurfaceFlags(deps, {
    commandLabel: 'mirror pnl',
    defaultWithLive: true,
    allowReconciled: true,
    allowIncludeLegacyApprox: true,
  });
}

function createParseMirrorAuditFlags(deps) {
  return createParseMirrorSurfaceFlags(deps, {
    commandLabel: 'mirror audit',
    defaultWithLive: false,
    allowReconciled: true,
  });
}

function parseCsvPositiveIntegerList(value, flagName, parsePositiveInteger, CliError) {
  const entries = String(value || '').split(',');
  const parsed = [];
  for (const entry of entries) {
    const candidate = String(entry || '').trim();
    if (!candidate) {
      throw new CliError('INVALID_FLAG_VALUE', `${flagName} must not contain empty block values.`);
    }
    parsed.push(parsePositiveInteger(candidate, flagName));
  }
  return Array.from(new Set(parsed));
}

function parseCsvNonNegativeIntegerList(value, flagName, parseNonNegativeInteger, CliError) {
  const entries = String(value || '').split(',');
  const parsed = [];
  for (const entry of entries) {
    const candidate = String(entry || '').trim();
    if (!candidate) {
      throw new CliError('INVALID_FLAG_VALUE', `${flagName} must not contain empty block values.`);
    }
    parsed.push(parseNonNegativeInteger(candidate, flagName));
  }
  return Array.from(new Set(parsed));
}

function parseSecureUrlList(value, flagName, CliError, isSecureHttpUrlOrLocal) {
  const rawEntries = String(value || '').split(',');
  const normalized = [];
  for (const entry of rawEntries) {
    const candidate = String(entry || '').trim();
    if (!candidate) {
      throw new CliError('INVALID_FLAG_VALUE', `${flagName} must not contain empty RPC URL entries.`);
    }
    if (!isSecureHttpUrlOrLocal(candidate)) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        `${flagName} must use https:// (or http://localhost/127.0.0.1 for local testing).`,
      );
    }
    normalized.push(candidate);
  }

  return Array.from(new Set(normalized)).join(',');
}

function createParseMirrorTraceFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parseNonNegativeInteger = requireDep(deps, 'parseNonNegativeInteger');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');

  return function parseMirrorTraceFlags(args) {
    const options = {
      pandoraMarketAddress: null,
      rpcUrl: null,
      blocks: null,
      fromBlock: null,
      toBlock: null,
      step: 1,
      limit: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--pandora-market-address' || token === '--market-address') {
        options.pandoraMarketAddress = parseAddressFlag(requireFlagValue(args, i, token), token);
        i += 1;
        continue;
      }
      if (token === '--rpc-url') {
        options.rpcUrl = parseSecureUrlList(
          requireFlagValue(args, i, '--rpc-url'),
          '--rpc-url',
          CliError,
          isSecureHttpUrlOrLocal,
        );
        i += 1;
        continue;
      }
      if (token === '--blocks') {
        options.blocks = parseCsvNonNegativeIntegerList(
          requireFlagValue(args, i, '--blocks'),
          '--blocks',
          parseNonNegativeInteger,
          CliError,
        );
        i += 1;
        continue;
      }
      if (token === '--from-block') {
        options.fromBlock = parseNonNegativeInteger(requireFlagValue(args, i, '--from-block'), '--from-block');
        i += 1;
        continue;
      }
      if (token === '--to-block') {
        options.toBlock = parseNonNegativeInteger(requireFlagValue(args, i, '--to-block'), '--to-block');
        i += 1;
        continue;
      }
      if (token === '--step') {
        options.step = parsePositiveInteger(requireFlagValue(args, i, '--step'), '--step');
        i += 1;
        continue;
      }
      if (token === '--limit') {
        options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror trace: ${token}`);
    }

    if (!options.pandoraMarketAddress) {
      throw new CliError(
        'MISSING_REQUIRED_FLAG',
        'mirror trace requires --pandora-market-address/--market-address <address>.',
      );
    }
    if (!options.rpcUrl) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'mirror trace requires --rpc-url <url>.');
    }

    const hasExplicitBlocks = Array.isArray(options.blocks) && options.blocks.length > 0;
    const hasRange = options.fromBlock !== null || options.toBlock !== null;
    if (!hasExplicitBlocks && !hasRange) {
      throw new CliError(
        'MISSING_REQUIRED_FLAG',
        'mirror trace requires either --blocks <csv> or --from-block <n> plus --to-block <n>.',
      );
    }
    if (hasExplicitBlocks && hasRange) {
      throw new CliError(
        'INVALID_ARGS',
        'mirror trace --blocks <csv> cannot be combined with --from-block/--to-block.',
      );
    }
    if (options.fromBlock === null && options.toBlock !== null) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'mirror trace requires --from-block <n> when --to-block is provided.');
    }
    if (options.toBlock === null && options.fromBlock !== null) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'mirror trace requires --to-block <n> when --from-block is provided.');
    }
    return options;
  };
}

function createParseMirrorReplayFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');

  return function parseMirrorReplayFlags(args) {
    const options = {
      stateFile: null,
      strategyHash: null,
      pandoraMarketAddress: null,
      polymarketMarketId: null,
      polymarketSlug: null,
      limit: 200,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--state-file') {
        options.stateFile = normalizeMirrorPathForMcp(
          requireFlagValue(args, i, '--state-file'),
          '--state-file',
          CliError,
        );
        i += 1;
        continue;
      }
      if (token === '--strategy-hash') {
        const value = requireFlagValue(args, i, '--strategy-hash');
        if (!/^[a-f0-9]{16}$/i.test(value)) {
          throw new CliError('INVALID_FLAG_VALUE', '--strategy-hash must be a 16-character hex value.');
        }
        options.strategyHash = value.toLowerCase();
        i += 1;
        continue;
      }
      if (token === '--pandora-market-address' || token === '--market-address') {
        options.pandoraMarketAddress = parseAddressFlag(requireFlagValue(args, i, token), token);
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
      if (token === '--limit') {
        options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror replay: ${token}`);
    }

    const hasPersistedSelector = Boolean(options.stateFile || options.strategyHash);
    const hasLiveSelector = Boolean(
      options.pandoraMarketAddress && (options.polymarketMarketId || options.polymarketSlug),
    );
    if (!hasPersistedSelector && !hasLiveSelector) {
      throw new CliError(
        'MISSING_REQUIRED_FLAG',
        'mirror replay requires --state-file <path>, --strategy-hash <hash>, or a selector pair (--pandora-market-address/--market-address plus --polymarket-market-id|--polymarket-slug).',
      );
    }

    return options;
  };
}

function createParseMirrorLogsFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');

  return function parseMirrorLogsFlags(args) {
    const options = {
      stateFile: null,
      strategyHash: null,
      pandoraMarketAddress: null,
      polymarketMarketId: null,
      polymarketSlug: null,
      lines: 50,
      follow: false,
      pollIntervalMs: 500,
      followTimeoutMs: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--state-file') {
        options.stateFile = normalizeMirrorPathForMcp(
          requireFlagValue(args, i, '--state-file'),
          '--state-file',
          CliError,
        );
        i += 1;
        continue;
      }
      if (token === '--strategy-hash') {
        const value = requireFlagValue(args, i, '--strategy-hash');
        if (!/^[a-f0-9]{16}$/i.test(value)) {
          throw new CliError('INVALID_FLAG_VALUE', '--strategy-hash must be a 16-character hex value.');
        }
        options.strategyHash = value.toLowerCase();
        i += 1;
        continue;
      }
      if (token === '--pandora-market-address' || token === '--market-address') {
        options.pandoraMarketAddress = parseAddressFlag(requireFlagValue(args, i, token), token);
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
      if (token === '--lines') {
        options.lines = parsePositiveInteger(requireFlagValue(args, i, '--lines'), '--lines');
        i += 1;
        continue;
      }
      if (token === '--follow') {
        options.follow = true;
        continue;
      }
      if (token === '--poll-interval-ms') {
        options.pollIntervalMs = parsePositiveInteger(
          requireFlagValue(args, i, '--poll-interval-ms'),
          '--poll-interval-ms',
        );
        i += 1;
        continue;
      }
      if (token === '--follow-timeout-ms') {
        options.followTimeoutMs = parsePositiveInteger(
          requireFlagValue(args, i, '--follow-timeout-ms'),
          '--follow-timeout-ms',
        );
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror logs: ${token}`);
    }

    if (!options.stateFile && !options.strategyHash && !options.pandoraMarketAddress) {
      throw new CliError(
        'MISSING_REQUIRED_FLAG',
        'mirror logs requires --state-file <path>, --strategy-hash <hash>, or --pandora-market-address/--market-address <address>.',
      );
    }

    return options;
  };
}

/**
 * Creates the mirror close parser.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseMirrorCloseFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const parsePrivateKeyFlag = requireDep(deps, 'parsePrivateKeyFlag');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parseInteger = requireDep(deps, 'parseInteger');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');

  return function parseMirrorCloseFlags(args) {
    const options = {
      pandoraMarketAddress: null,
      polymarketMarketId: null,
      polymarketSlug: null,
      all: false,
      execute: false,
      dryRun: false,
      chainId: null,
      rpcUrl: null,
      privateKey: null,
      wallet: null,
      indexerUrl: null,
      timeoutMs: 12000,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--pandora-market-address' || token === '--market-address') {
        options.pandoraMarketAddress = parseAddressFlag(requireFlagValue(args, i, token), token);
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
      if (token === '--all') {
        options.all = true;
        continue;
      }
      if (token === '--wallet') {
        options.wallet = parseAddressFlag(requireFlagValue(args, i, '--wallet'), '--wallet');
        i += 1;
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
      if (token === '--indexer-url') {
        options.indexerUrl = requireFlagValue(args, i, '--indexer-url');
        i += 1;
        continue;
      }
      if (token === '--timeout-ms') {
        options.timeoutMs = parsePositiveInteger(requireFlagValue(args, i, '--timeout-ms'), '--timeout-ms');
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror close: ${token}`);
    }

    if (options.all && (options.pandoraMarketAddress || options.polymarketMarketId || options.polymarketSlug)) {
      throw new CliError('INVALID_ARGS', '--all cannot be combined with per-market mirror close selectors.');
    }
    if (!options.all && !options.pandoraMarketAddress) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing --pandora-market-address <address> (alias: --market-address).');
    }
    if (!options.all && !options.polymarketMarketId && !options.polymarketSlug) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'mirror close requires --polymarket-market-id <id> or --polymarket-slug <slug>.');
    }
    if (options.dryRun === options.execute) {
      throw new CliError('INVALID_ARGS', 'mirror close requires exactly one mode: --dry-run or --execute.');
    }

    return options;
  };
}

/**
 * Creates the mirror lp-explain parser.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseMirrorLpExplainFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parseProbabilityPercent = requireDep(deps, 'parseProbabilityPercent');
  const parseNonNegativeInteger = requireDep(deps, 'parseNonNegativeInteger');

  return function parseMirrorLpExplainFlags(args) {
    const options = {
      liquidityUsdc: null,
      sourceYesPct: null,
      distributionYes: null,
      distributionNo: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--liquidity-usdc') {
        options.liquidityUsdc = parsePositiveNumber(requireFlagValue(args, i, '--liquidity-usdc'), '--liquidity-usdc');
        i += 1;
        continue;
      }
      if (token === '--source-yes-pct') {
        options.sourceYesPct = parseProbabilityPercent(requireFlagValue(args, i, '--source-yes-pct'), '--source-yes-pct');
        i += 1;
        continue;
      }
      if (token === '--distribution-yes') {
        options.distributionYes = parseNonNegativeInteger(requireFlagValue(args, i, '--distribution-yes'), '--distribution-yes');
        i += 1;
        continue;
      }
      if (token === '--distribution-no') {
        options.distributionNo = parseNonNegativeInteger(requireFlagValue(args, i, '--distribution-no'), '--distribution-no');
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror lp-explain: ${token}`);
    }

    if (options.liquidityUsdc === null) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'mirror lp-explain requires --liquidity-usdc <n>.');
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

    return options;
  };
}

/**
 * Creates the mirror simulate parser.
 * @param {object} deps
 * @returns {(args: string[]) => object}
 */
function createParseMirrorSimulateFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveNumber = requireDep(deps, 'parsePositiveNumber');
  const parseProbabilityPercent = requireDep(deps, 'parseProbabilityPercent');
  const parseNonNegativeInteger = requireDep(deps, 'parseNonNegativeInteger');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parseInteger = requireDep(deps, 'parseInteger');
  const parseCsvNumberList = requireDep(deps, 'parseCsvNumberList');

  return function parseMirrorSimulateFlags(args) {
    const options = {
      liquidityUsdc: null,
      sourceYesPct: null,
      targetYesPct: null,
      polymarketYesPct: null,
      distributionYes: null,
      distributionNo: null,
      feeTier: 3000,
      hedgeRatio: 1,
      hedgeCostBps: 35,
      volumeScenarios: null,
      engine: 'linear',
      paths: 2000,
      steps: 48,
      seed: 42,
      importanceSampling: false,
      antithetic: false,
      controlVariate: false,
      stratified: false,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--liquidity-usdc') {
        options.liquidityUsdc = parsePositiveNumber(requireFlagValue(args, i, '--liquidity-usdc'), '--liquidity-usdc');
        i += 1;
        continue;
      }
      if (token === '--source-yes-pct') {
        options.sourceYesPct = parseProbabilityPercent(requireFlagValue(args, i, '--source-yes-pct'), '--source-yes-pct');
        i += 1;
        continue;
      }
      if (token === '--target-yes-pct') {
        options.targetYesPct = parseProbabilityPercent(requireFlagValue(args, i, '--target-yes-pct'), '--target-yes-pct');
        i += 1;
        continue;
      }
      if (token === '--polymarket-yes-pct') {
        options.polymarketYesPct = parseProbabilityPercent(requireFlagValue(args, i, '--polymarket-yes-pct'), '--polymarket-yes-pct');
        i += 1;
        continue;
      }
      if (token === '--distribution-yes') {
        options.distributionYes = parseNonNegativeInteger(requireFlagValue(args, i, '--distribution-yes'), '--distribution-yes');
        i += 1;
        continue;
      }
      if (token === '--distribution-no') {
        options.distributionNo = parseNonNegativeInteger(requireFlagValue(args, i, '--distribution-no'), '--distribution-no');
        i += 1;
        continue;
      }
      if (token === '--fee-tier') {
        options.feeTier = parsePositiveInteger(requireFlagValue(args, i, '--fee-tier'), '--fee-tier');
        i += 1;
        continue;
      }
      if (token === '--hedge-ratio') {
        options.hedgeRatio = parsePositiveNumber(requireFlagValue(args, i, '--hedge-ratio'), '--hedge-ratio');
        i += 1;
        continue;
      }
      if (token === '--hedge-cost-bps') {
        options.hedgeCostBps = parseNonNegativeInteger(requireFlagValue(args, i, '--hedge-cost-bps'), '--hedge-cost-bps');
        i += 1;
        continue;
      }
      if (token === '--volume-scenarios') {
        options.volumeScenarios = parseCsvNumberList(requireFlagValue(args, i, '--volume-scenarios'), '--volume-scenarios');
        i += 1;
        continue;
      }
      if (token === '--engine') {
        const engine = String(requireFlagValue(args, i, '--engine') || '')
          .trim()
          .toLowerCase();
        if (engine !== 'linear' && engine !== 'mc') {
          throw new CliError('INVALID_FLAG_VALUE', '--engine must be linear or mc.');
        }
        options.engine = engine;
        i += 1;
        continue;
      }
      if (token === '--paths') {
        options.paths = parsePositiveInteger(requireFlagValue(args, i, '--paths'), '--paths');
        i += 1;
        continue;
      }
      if (token === '--steps') {
        options.steps = parsePositiveInteger(requireFlagValue(args, i, '--steps'), '--steps');
        i += 1;
        continue;
      }
      if (token === '--seed') {
        options.seed = parseInteger(requireFlagValue(args, i, '--seed'), '--seed');
        i += 1;
        continue;
      }
      if (token === '--importance-sampling') {
        options.importanceSampling = true;
        continue;
      }
      if (token === '--antithetic') {
        options.antithetic = true;
        continue;
      }
      if (token === '--control-variate') {
        options.controlVariate = true;
        continue;
      }
      if (token === '--stratified') {
        options.stratified = true;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for mirror simulate: ${token}`);
    }

    if (options.liquidityUsdc === null) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'mirror simulate requires --liquidity-usdc <n>.');
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
    if (options.feeTier < MIN_AMM_FEE_TIER || options.feeTier > MAX_AMM_FEE_TIER) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        `--fee-tier must be between ${MIN_AMM_FEE_TIER} and ${MAX_AMM_FEE_TIER} (max 5%).`,
      );
    }
    if (options.hedgeRatio > 5) {
      throw new CliError('INVALID_FLAG_VALUE', '--hedge-ratio must be <= 5.');
    }
    if (options.paths > 200_000) {
      throw new CliError('INVALID_FLAG_VALUE', '--paths must be <= 200000.');
    }
    if (options.steps > 1_000) {
      throw new CliError('INVALID_FLAG_VALUE', '--steps must be <= 1000.');
    }

    return options;
  };
}

module.exports = {
  createParseMirrorBrowseFlags,
  createParseMirrorVerifyFlags,
  createParseMirrorStatusFlags,
  createParseMirrorPnlFlags,
  createParseMirrorAuditFlags,
  createParseMirrorTraceFlags,
  createParseMirrorReplayFlags,
  createParseMirrorLogsFlags,
  createParseMirrorCloseFlags,
  createParseMirrorLpExplainFlags,
  createParseMirrorSimulateFlags,
};
