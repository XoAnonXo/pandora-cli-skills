const fs = require('fs');
const path = require('path');
const { assertMcpWorkspacePath } = require('../shared/mcp_path_guard.cjs');

function requireFn(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createCoreCommandFlagParsers requires deps.${name}()`);
  }
  return deps[name];
}

function requireValue(deps, name) {
  if (!deps || deps[name] === undefined || deps[name] === null) {
    throw new Error(`createCoreCommandFlagParsers requires deps.${name}`);
  }
  return deps[name];
}

/**
 * Creates core command-level flag parsers used by the main CLI router.
 * @param {object} deps
 * @returns {object}
 */
function createCoreCommandFlagParsers(deps) {
  const CliError = requireFn(deps, 'CliError');
  const formatErrorValue = requireFn(deps, 'formatErrorValue');
  const hasWebhookTargets = requireFn(deps, 'hasWebhookTargets');
  const requireFlagValue = requireFn(deps, 'requireFlagValue');
  const parsePositiveInteger = requireFn(deps, 'parsePositiveInteger');
  const parseInteger = requireFn(deps, 'parseInteger');
  const parseNonNegativeInteger = requireFn(deps, 'parseNonNegativeInteger');
  const parsePositiveNumber = requireFn(deps, 'parsePositiveNumber');
  const parseNumber = requireFn(deps, 'parseNumber');
  const parseCsvList = requireFn(deps, 'parseCsvList');
  const parseProbabilityPercent = requireFn(deps, 'parseProbabilityPercent');
  const parseAddressFlag = requireFn(deps, 'parseAddressFlag');
  const parsePositionsOrderBy = requireFn(deps, 'parsePositionsOrderBy');
  const parseOutcomeSide = requireFn(deps, 'parseOutcomeSide');
  const mergeWhere = requireFn(deps, 'mergeWhere');
  const normalizeDirection = requireFn(deps, 'normalizeDirection');
  const isSecureHttpUrlOrLocal = requireFn(deps, 'isSecureHttpUrlOrLocal');

  const defaultEnvFile = requireValue(deps, 'defaultEnvFile');
  const defaultEnvExample = requireValue(deps, 'defaultEnvExample');
  const defaultRpcTimeoutMs = requireValue(deps, 'defaultRpcTimeoutMs');
  const defaultIndexerTimeoutMs = requireValue(deps, 'defaultIndexerTimeoutMs');
  const defaultExpiringSoonHours = requireValue(deps, 'defaultExpiringSoonHours');

  function resolveMcpWorkspacePath(next, flagName) {
    assertMcpWorkspacePath(next, {
      flagName,
      errorFactory: (code, message, details) => new CliError(code, message, details),
    });
    return path.resolve(process.cwd(), next);
  }

  function parseScriptEnvFlags(args) {
    let envFile = defaultEnvFile;
    let useEnvFile = true;
    const passthrough = [];

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--dotenv-path' || token === '--env-file') {
        const next = requireFlagValue(args, i, '--dotenv-path');
        envFile = resolveMcpWorkspacePath(next, '--dotenv-path');
        i += 1;
        continue;
      }

      if (token === '--skip-dotenv' || token === '--no-env-file') {
        useEnvFile = false;
        continue;
      }

      passthrough.push(token);
    }

    return { envFile, useEnvFile, passthrough };
  }

  function parseDoctorFlags(args) {
    let envFile = defaultEnvFile;
    let useEnvFile = true;
    let checkUsdcCode = false;
    let checkPolymarket = false;
    let rpcTimeoutMs = defaultRpcTimeoutMs;

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];

      if (token === '--dotenv-path' || token === '--env-file') {
        const next = requireFlagValue(args, i, '--dotenv-path');
        envFile = resolveMcpWorkspacePath(next, '--dotenv-path');
        i += 1;
        continue;
      }

      if (token === '--skip-dotenv' || token === '--no-env-file') {
        useEnvFile = false;
        continue;
      }

      if (token === '--check-usdc-code') {
        checkUsdcCode = true;
        continue;
      }

      if (token === '--check-polymarket') {
        checkPolymarket = true;
        continue;
      }

      if (token === '--rpc-timeout-ms') {
        const next = requireFlagValue(args, i, '--rpc-timeout-ms');
        rpcTimeoutMs = parsePositiveInteger(next, '--rpc-timeout-ms');
        i += 1;
        continue;
      }

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for doctor: ${token}`);
    }

    return { envFile, useEnvFile, checkUsdcCode, checkPolymarket, rpcTimeoutMs };
  }

  function parseSetupFlags(args) {
    let envFile = defaultEnvFile;
    let exampleFile = defaultEnvExample;
    let force = false;
    let checkUsdcCode = false;
    let checkPolymarket = false;
    let rpcTimeoutMs = defaultRpcTimeoutMs;

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];

      if (token === '--force') {
        force = true;
        continue;
      }

      if (token === '--dotenv-path' || token === '--env-file') {
        const next = requireFlagValue(args, i, '--dotenv-path');
        envFile = resolveMcpWorkspacePath(next, '--dotenv-path');
        i += 1;
        continue;
      }

      if (token === '--example') {
        const next = requireFlagValue(args, i, '--example');
        exampleFile = resolveMcpWorkspacePath(next, '--example');
        i += 1;
        continue;
      }

      if (token === '--check-usdc-code') {
        checkUsdcCode = true;
        continue;
      }

      if (token === '--check-polymarket') {
        checkPolymarket = true;
        continue;
      }

      if (token === '--rpc-timeout-ms') {
        const next = requireFlagValue(args, i, '--rpc-timeout-ms');
        rpcTimeoutMs = parsePositiveInteger(next, '--rpc-timeout-ms');
        i += 1;
        continue;
      }

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for setup: ${token}`);
    }

    return { envFile, exampleFile, force, checkUsdcCode, checkPolymarket, rpcTimeoutMs };
  }

  function parseInitEnvFlags(args) {
    let envFile = defaultEnvFile;
    let exampleFile = defaultEnvExample;
    let force = false;

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];

      if (token === '--force') {
        force = true;
        continue;
      }

      if (token === '--dotenv-path' || token === '--env-file') {
        const next = requireFlagValue(args, i, '--dotenv-path');
        envFile = resolveMcpWorkspacePath(next, '--dotenv-path');
        i += 1;
        continue;
      }

      if (token === '--example') {
        const next = requireFlagValue(args, i, '--example');
        exampleFile = resolveMcpWorkspacePath(next, '--example');
        i += 1;
        continue;
      }

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for init-env: ${token}`);
    }

    return { envFile, exampleFile, force };
  }

  function parseIndexerSharedFlags(args) {
    let envFile = defaultEnvFile;
    let envFileExplicit = false;
    let useEnvFile = true;
    let indexerUrl = null;
    let timeoutMs = defaultIndexerTimeoutMs;
    const rest = [];

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];

      if (token === '--dotenv-path' || token === '--env-file') {
        const next = requireFlagValue(args, i, '--dotenv-path');
        envFile = resolveMcpWorkspacePath(next, '--dotenv-path');
        envFileExplicit = true;
        i += 1;
        continue;
      }

      if (token === '--skip-dotenv' || token === '--no-env-file') {
        useEnvFile = false;
        continue;
      }

      if (token === '--indexer-url') {
        const next = requireFlagValue(args, i, '--indexer-url');
        indexerUrl = next;
        i += 1;
        continue;
      }

      if (token === '--timeout-ms') {
        const next = requireFlagValue(args, i, '--timeout-ms');
        timeoutMs = parsePositiveInteger(next, '--timeout-ms');
        i += 1;
        continue;
      }

      rest.push(token);
    }

    return {
      envFile,
      envFileExplicit,
      useEnvFile,
      indexerUrl,
      timeoutMs,
      rest,
    };
  }

  function parseGetIdFlags(args, entityName) {
    let id = null;

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];

      if (token === '--id') {
        const next = requireFlagValue(args, i, '--id');
        id = next;
        i += 1;
        continue;
      }

      if (token.startsWith('--')) {
        throw new CliError('UNKNOWN_FLAG', `Unknown flag for ${entityName} get: ${token}`);
      }

      if (id) {
        throw new CliError('INVALID_ARGS', `Unexpected extra argument for ${entityName} get: ${token}`);
      }

      id = token;
    }

    if (!id) {
      throw new CliError('MISSING_REQUIRED_FLAG', `Missing ${entityName} id. Use --id <id>.`);
    }

    return { id };
  }

  function parseMarketsGetFlags(args) {
    const options = {
      ids: [],
      readFromStdin: false,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];

      if (token === '--id') {
        options.ids.push(requireFlagValue(args, i, '--id'));
        i += 1;
        continue;
      }

      if (token === '--stdin') {
        options.readFromStdin = true;
        continue;
      }

      if (token.startsWith('--')) {
        throw new CliError('UNKNOWN_FLAG', `Unknown flag for markets get: ${token}`);
      }

      options.ids.push(token);
    }

    if (!options.ids.length && !options.readFromStdin) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing market id. Use --id <id> or --stdin.');
    }

    return options;
  }

  function readIdsFromStdin() {
    if (process.stdin.isTTY) {
      throw new CliError('MISSING_REQUIRED_FLAG', '--stdin requires piped newline-delimited ids.');
    }

    let raw = '';
    try {
      raw = fs.readFileSync(0, 'utf8');
    } catch (err) {
      throw new CliError('STDIN_READ_FAILED', `Unable to read ids from stdin: ${formatErrorValue(err)}`);
    }

    const ids = String(raw)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!ids.length) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'No market ids were provided on stdin.');
    }

    return ids;
  }

  function setLifecycleFilter(current, next, flagName) {
    if (current === next || current === 'all') {
      return next;
    }
    throw new CliError(
      'INVALID_ARGS',
      `Lifecycle filters are mutually exclusive. Received ${flagName} with existing --${current}.`,
    );
  }

  function parseMarketsListFlags(args) {
    const options = {
      where: {},
      limit: 20,
      after: null,
      before: null,
      orderBy: 'createdAt',
      orderDirection: 'desc',
      lifecycle: 'all',
      expiringSoonHours: defaultExpiringSoonHours,
      expand: false,
      withOdds: false,
      minTvlUsdc: null,
      hedgeable: false,
    };
    let expiringSoonHoursExplicit = false;

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];

      if (token === '--limit') {
        options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
        i += 1;
        continue;
      }

      if (token === '--after') {
        options.after = requireFlagValue(args, i, '--after');
        i += 1;
        continue;
      }

      if (token === '--before') {
        options.before = requireFlagValue(args, i, '--before');
        i += 1;
        continue;
      }

      if (token === '--order-by') {
        options.orderBy = requireFlagValue(args, i, '--order-by');
        i += 1;
        continue;
      }

      if (token === '--order-direction') {
        options.orderDirection = normalizeDirection(requireFlagValue(args, i, '--order-direction'));
        i += 1;
        continue;
      }

      if (token === '--chain-id') {
        options.where.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
        i += 1;
        continue;
      }

      if (token === '--creator') {
        options.where.creator = parseAddressFlag(requireFlagValue(args, i, '--creator'), '--creator');
        i += 1;
        continue;
      }

      if (token === '--poll-address') {
        options.where.pollAddress = parseAddressFlag(requireFlagValue(args, i, '--poll-address'), '--poll-address');
        i += 1;
        continue;
      }

      if (token === '--market-type') {
        options.where.marketType = requireFlagValue(args, i, '--market-type');
        i += 1;
        continue;
      }
      if (token === '--type') {
        options.where.marketType = requireFlagValue(args, i, '--type');
        i += 1;
        continue;
      }

      if (token === '--where-json') {
        options.where = mergeWhere(options.where, requireFlagValue(args, i, '--where-json'), '--where-json');
        i += 1;
        continue;
      }

      if (token === '--active') {
        options.lifecycle = setLifecycleFilter(options.lifecycle, 'active', '--active');
        continue;
      }

      if (token === '--resolved') {
        options.lifecycle = setLifecycleFilter(options.lifecycle, 'resolved', '--resolved');
        continue;
      }

      if (token === '--expiring-soon') {
        options.lifecycle = setLifecycleFilter(options.lifecycle, 'expiring-soon', '--expiring-soon');
        continue;
      }

      if (token === '--expiring-hours') {
        options.expiringSoonHours = parsePositiveInteger(requireFlagValue(args, i, '--expiring-hours'), '--expiring-hours');
        expiringSoonHoursExplicit = true;
        i += 1;
        continue;
      }

      if (token === '--expand') {
        options.expand = true;
        continue;
      }

      if (token === '--with-odds') {
        options.withOdds = true;
        continue;
      }
      if (token === '--min-tvl') {
        options.minTvlUsdc = parsePositiveNumber(requireFlagValue(args, i, '--min-tvl'), '--min-tvl');
        i += 1;
        continue;
      }
      if (token === '--hedgeable') {
        options.hedgeable = true;
        continue;
      }

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for markets list: ${token}`);
    }

    if (expiringSoonHoursExplicit && options.lifecycle !== 'expiring-soon') {
      throw new CliError('INVALID_ARGS', '--expiring-hours requires --expiring-soon.');
    }

    return options;
  }

  function parseQuoteFlags(args) {
    const options = {
      mode: 'buy',
      marketAddress: null,
      side: null,
      amountUsdc: null,
      amountsUsdc: [],
      amount: null,
      amounts: [],
      yesPct: null,
      targetPct: null,
      slippageBps: 100,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];

      if (token === '--market-address') {
        options.marketAddress = parseAddressFlag(requireFlagValue(args, i, '--market-address'), '--market-address');
        i += 1;
        continue;
      }

      if (token === '--side') {
        options.side = parseOutcomeSide(requireFlagValue(args, i, '--side'), '--side');
        i += 1;
        continue;
      }

      if (token === '--mode') {
        const mode = requireFlagValue(args, i, '--mode').toLowerCase();
        if (mode !== 'buy' && mode !== 'sell') {
          throw new CliError('INVALID_FLAG_VALUE', '--mode must be buy|sell.');
        }
        options.mode = mode;
        i += 1;
        continue;
      }

      if (token === '--amount-usdc' || token === '--amount') {
        const parsedAmount = parsePositiveNumber(requireFlagValue(args, i, token), token);
        if (token === '--amount-usdc') {
          options.amountUsdc = parsedAmount;
        } else {
          options.amount = parsedAmount;
        }
        i += 1;
        continue;
      }
      if (token === '--shares') {
        options.amount = parsePositiveNumber(requireFlagValue(args, i, '--shares'), '--shares');
        i += 1;
        continue;
      }
      if (token === '--amounts') {
        const raw = parseCsvList(requireFlagValue(args, i, '--amounts'), '--amounts');
        if (options.mode === 'sell') {
          options.amounts = raw.map((value) => parsePositiveNumber(value, '--amounts'));
        } else {
          options.amountsUsdc = raw.map((value) => parsePositiveNumber(value, '--amounts'));
        }
        i += 1;
        continue;
      }

      if (token === '--yes-pct') {
        options.yesPct = parseProbabilityPercent(requireFlagValue(args, i, '--yes-pct'), '--yes-pct');
        i += 1;
        continue;
      }

      if (token === '--target-pct') {
        options.targetPct = parseProbabilityPercent(requireFlagValue(args, i, '--target-pct'), '--target-pct');
        i += 1;
        continue;
      }

      if (token === '--slippage-bps') {
        options.slippageBps = parseNonNegativeInteger(requireFlagValue(args, i, '--slippage-bps'), '--slippage-bps');
        if (options.slippageBps > 10_000) {
          throw new CliError('INVALID_FLAG_VALUE', '--slippage-bps must be between 0 and 10000.');
        }
        i += 1;
        continue;
      }

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for quote: ${token}`);
    }

    if (!options.marketAddress) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing market address. Use --market-address <address>.');
    }
    if (!options.side) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing side. Use --side yes|no.');
    }
    if (options.targetPct !== null && options.mode === 'sell') {
      throw new CliError('INVALID_FLAG_COMBINATION', '--target-pct is only supported for buy quotes.');
    }
    if (options.mode === 'buy') {
      if (options.amountUsdc === null && options.amount !== null) {
        options.amountUsdc = options.amount;
      }
      if (!options.amountsUsdc.length && options.amounts.length) {
        options.amountsUsdc = [...options.amounts];
      }
      if (
        options.targetPct !== null
        && (options.amountUsdc !== null || (Array.isArray(options.amountsUsdc) && options.amountsUsdc.length))
      ) {
        throw new CliError(
          'INVALID_FLAG_COMBINATION',
          'Use either --target-pct or --amount-usdc/--amounts for quote buy.',
        );
      }
      if (
        options.targetPct === null
        && options.amountUsdc === null
        && (!Array.isArray(options.amountsUsdc) || !options.amountsUsdc.length)
      ) {
        throw new CliError('MISSING_REQUIRED_FLAG', 'Missing trade amount. Use --amount-usdc <amount> or --amounts <csv>.');
      }
      if (
        options.targetPct === null
        && options.amountUsdc === null
        && Array.isArray(options.amountsUsdc)
        && options.amountsUsdc.length
      ) {
        options.amountUsdc = options.amountsUsdc[0];
      }
    } else {
      if (options.amount === null && options.amountUsdc !== null) {
        options.amount = options.amountUsdc;
      }
      if (!options.amounts.length && options.amountsUsdc.length) {
        options.amounts = [...options.amountsUsdc];
      }
      if (options.amount === null && (!Array.isArray(options.amounts) || !options.amounts.length)) {
        throw new CliError('MISSING_REQUIRED_FLAG', 'Missing token amount. Use --shares <amount> or --amounts <csv>.');
      }
      if (options.amount === null && Array.isArray(options.amounts) && options.amounts.length) {
        options.amount = options.amounts[0];
      }
    }

    return options;
  }

  function parsePollsListFlags(args) {
    const options = {
      where: {},
      limit: 20,
      after: null,
      before: null,
      orderBy: 'createdAt',
      orderDirection: 'desc',
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];

      if (token === '--limit') {
        options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
        i += 1;
        continue;
      }

      if (token === '--after') {
        options.after = requireFlagValue(args, i, '--after');
        i += 1;
        continue;
      }

      if (token === '--before') {
        options.before = requireFlagValue(args, i, '--before');
        i += 1;
        continue;
      }

      if (token === '--order-by') {
        options.orderBy = requireFlagValue(args, i, '--order-by');
        i += 1;
        continue;
      }

      if (token === '--order-direction') {
        options.orderDirection = normalizeDirection(requireFlagValue(args, i, '--order-direction'));
        i += 1;
        continue;
      }

      if (token === '--chain-id') {
        options.where.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
        i += 1;
        continue;
      }

      if (token === '--creator') {
        options.where.creator = parseAddressFlag(requireFlagValue(args, i, '--creator'), '--creator');
        i += 1;
        continue;
      }

      if (token === '--status') {
        options.where.status = parseInteger(requireFlagValue(args, i, '--status'), '--status');
        i += 1;
        continue;
      }

      if (token === '--category') {
        options.where.category = parseInteger(requireFlagValue(args, i, '--category'), '--category');
        i += 1;
        continue;
      }

      if (token === '--question-contains') {
        options.where.question_contains = requireFlagValue(args, i, '--question-contains');
        i += 1;
        continue;
      }

      if (token === '--where-json') {
        options.where = mergeWhere(options.where, requireFlagValue(args, i, '--where-json'), '--where-json');
        i += 1;
        continue;
      }

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for polls list: ${token}`);
    }

    return options;
  }

  function parsePositionsListFlags(args) {
    const options = {
      where: {},
      wallet: null,
      limit: 20,
      after: null,
      before: null,
      orderBy: 'lastTradeAt',
      orderDirection: 'desc',
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];

      if (token === '--limit') {
        options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
        i += 1;
        continue;
      }

      if (token === '--after') {
        options.after = requireFlagValue(args, i, '--after');
        i += 1;
        continue;
      }

      if (token === '--before') {
        options.before = requireFlagValue(args, i, '--before');
        i += 1;
        continue;
      }

      if (token === '--order-by') {
        options.orderBy = parsePositionsOrderBy(requireFlagValue(args, i, '--order-by'));
        i += 1;
        continue;
      }

      if (token === '--order-direction') {
        options.orderDirection = normalizeDirection(requireFlagValue(args, i, '--order-direction'));
        i += 1;
        continue;
      }

      if (token === '--wallet') {
        options.wallet = parseAddressFlag(requireFlagValue(args, i, '--wallet'), '--wallet');
        options.where.user = options.wallet;
        i += 1;
        continue;
      }

      if (token === '--market-address') {
        options.where.marketAddress = parseAddressFlag(requireFlagValue(args, i, '--market-address'), '--market-address');
        i += 1;
        continue;
      }

      if (token === '--chain-id') {
        options.where.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
        i += 1;
        continue;
      }

      if (token === '--where-json') {
        options.where = mergeWhere(options.where, requireFlagValue(args, i, '--where-json'), '--where-json');
        i += 1;
        continue;
      }

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for positions list: ${token}`);
    }

    return options;
  }

  function parsePortfolioFlags(args) {
    const options = {
      wallet: null,
      chainId: null,
      limit: 100,
      includeEvents: true,
      withLp: false,
      rpcUrl: null,
      allChains: false,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];

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
      if (token === '--all-chains') {
        options.chainId = null;
        options.allChains = true;
        continue;
      }

      if (token === '--limit') {
        options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
        i += 1;
        continue;
      }

      if (token === '--include-events') {
        options.includeEvents = true;
        continue;
      }

      if (token === '--no-events') {
        options.includeEvents = false;
        continue;
      }

      if (token === '--with-lp') {
        options.withLp = true;
        continue;
      }

      if (token === '--rpc-url') {
        options.rpcUrl = requireFlagValue(args, i, '--rpc-url');
        i += 1;
        continue;
      }

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for portfolio: ${token}`);
    }

    if (!options.wallet) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing wallet address. Use --wallet <address>.');
    }

    return options;
  }

  function parseWebhookFlagIntoOptions(args, i, token, options) {
    if (token === '--webhook-url') {
      const value = requireFlagValue(args, i, '--webhook-url');
      if (!isSecureHttpUrlOrLocal(value)) {
        throw new CliError(
          'INVALID_FLAG_VALUE',
          '--webhook-url must use https:// (or http://localhost/127.0.0.1 for local testing).',
        );
      }
      options.webhookUrl = value;
      return 1;
    }
    if (token === '--webhook-template') {
      options.webhookTemplate = requireFlagValue(args, i, '--webhook-template');
      return 1;
    }
    if (token === '--webhook-secret') {
      options.webhookSecret = requireFlagValue(args, i, '--webhook-secret');
      return 1;
    }
    if (token === '--webhook-timeout-ms') {
      options.webhookTimeoutMs = parsePositiveInteger(
        requireFlagValue(args, i, '--webhook-timeout-ms'),
        '--webhook-timeout-ms',
      );
      return 1;
    }
    if (token === '--webhook-retries') {
      options.webhookRetries = parseNonNegativeInteger(
        requireFlagValue(args, i, '--webhook-retries'),
        '--webhook-retries',
      );
      return 1;
    }
    if (token === '--telegram-bot-token') {
      options.telegramBotToken = requireFlagValue(args, i, '--telegram-bot-token');
      return 1;
    }
    if (token === '--telegram-chat-id') {
      options.telegramChatId = requireFlagValue(args, i, '--telegram-chat-id');
      return 1;
    }
    if (token === '--discord-webhook-url') {
      const value = requireFlagValue(args, i, '--discord-webhook-url');
      if (!isSecureHttpUrlOrLocal(value)) {
        throw new CliError(
          'INVALID_FLAG_VALUE',
          '--discord-webhook-url must use https:// (or http://localhost/127.0.0.1 for local testing).',
        );
      }
      options.discordWebhookUrl = value;
      return 1;
    }
    if (token === '--fail-on-webhook-error') {
      options.failOnWebhookError = true;
      return 0;
    }

    return null;
  }

  function parseEventsListFlags(args) {
    const options = {
      type: 'all',
      limit: 20,
      after: null,
      before: null,
      orderDirection: 'desc',
      chainId: null,
      wallet: null,
      marketAddress: null,
      pollAddress: null,
      txHash: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];

      if (token === '--type') {
        const value = requireFlagValue(args, i, '--type').toLowerCase();
        if (value !== 'all' && value !== 'liquidity' && value !== 'oracle-fee' && value !== 'claim') {
          throw new CliError('INVALID_FLAG_VALUE', `--type must be one of all|liquidity|oracle-fee|claim. Received: "${value}"`);
        }
        options.type = value;
        i += 1;
        continue;
      }

      if (token === '--limit') {
        options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
        i += 1;
        continue;
      }

      if (token === '--after') {
        options.after = requireFlagValue(args, i, '--after');
        i += 1;
        continue;
      }

      if (token === '--before') {
        options.before = requireFlagValue(args, i, '--before');
        i += 1;
        continue;
      }

      if (token === '--order-direction') {
        options.orderDirection = normalizeDirection(requireFlagValue(args, i, '--order-direction'));
        i += 1;
        continue;
      }

      if (token === '--chain-id') {
        options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
        i += 1;
        continue;
      }

      if (token === '--wallet') {
        options.wallet = parseAddressFlag(requireFlagValue(args, i, '--wallet'), '--wallet');
        i += 1;
        continue;
      }

      if (token === '--market-address') {
        options.marketAddress = parseAddressFlag(requireFlagValue(args, i, '--market-address'), '--market-address');
        i += 1;
        continue;
      }

      if (token === '--poll-address') {
        options.pollAddress = parseAddressFlag(requireFlagValue(args, i, '--poll-address'), '--poll-address');
        i += 1;
        continue;
      }

      if (token === '--tx-hash') {
        options.txHash = requireFlagValue(args, i, '--tx-hash').toLowerCase();
        i += 1;
        continue;
      }

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for events list: ${token}`);
    }

    return options;
  }

  function parseEventsGetFlags(args) {
    const options = { id: null, type: 'all' };
    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--id') {
        options.id = requireFlagValue(args, i, '--id');
        i += 1;
        continue;
      }

      if (token === '--type') {
        const value = requireFlagValue(args, i, '--type').toLowerCase();
        if (value !== 'all' && value !== 'liquidity' && value !== 'oracle-fee' && value !== 'claim') {
          throw new CliError('INVALID_FLAG_VALUE', `--type must be one of all|liquidity|oracle-fee|claim. Received: "${value}"`);
        }
        options.type = value;
        i += 1;
        continue;
      }

      if (token.startsWith('--')) {
        throw new CliError('UNKNOWN_FLAG', `Unknown flag for events get: ${token}`);
      }

      if (options.id) {
        throw new CliError('INVALID_ARGS', `Unexpected extra argument for events get: ${token}`);
      }

      options.id = token;
    }

    if (!options.id) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing event id. Use --id <id>.');
    }

    return options;
  }

  function parseHistoryFlags(args) {
    const options = {
      wallet: null,
      chainId: null,
      marketAddress: null,
      side: 'both',
      status: 'all',
      limit: 50,
      after: null,
      before: null,
      orderBy: 'timestamp',
      orderDirection: 'desc',
      includeSeed: false,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
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
      if (token === '--market-address') {
        options.marketAddress = parseAddressFlag(requireFlagValue(args, i, '--market-address'), '--market-address');
        i += 1;
        continue;
      }
      if (token === '--side') {
        const side = requireFlagValue(args, i, '--side').toLowerCase();
        if (side !== 'yes' && side !== 'no' && side !== 'both') {
          throw new CliError('INVALID_FLAG_VALUE', '--side must be yes|no|both.');
        }
        options.side = side;
        i += 1;
        continue;
      }
      if (token === '--status') {
        const status = requireFlagValue(args, i, '--status').toLowerCase();
        if (!['all', 'open', 'won', 'lost', 'closed'].includes(status)) {
          throw new CliError('INVALID_FLAG_VALUE', '--status must be all|open|won|lost|closed.');
        }
        options.status = status;
        i += 1;
        continue;
      }
      if (token === '--limit') {
        options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
        i += 1;
        continue;
      }
      if (token === '--after') {
        options.after = requireFlagValue(args, i, '--after');
        i += 1;
        continue;
      }
      if (token === '--before') {
        options.before = requireFlagValue(args, i, '--before');
        i += 1;
        continue;
      }
      if (token === '--order-by') {
        const orderBy = requireFlagValue(args, i, '--order-by').toLowerCase();
        if (!['timestamp', 'pnl', 'entry-price', 'mark-price'].includes(orderBy)) {
          throw new CliError('INVALID_FLAG_VALUE', '--order-by must be timestamp|pnl|entry-price|mark-price.');
        }
        options.orderBy = orderBy;
        i += 1;
        continue;
      }
      if (token === '--order-direction') {
        options.orderDirection = normalizeDirection(requireFlagValue(args, i, '--order-direction'));
        i += 1;
        continue;
      }
      if (token === '--include-seed') {
        options.includeSeed = true;
        continue;
      }

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for history: ${token}`);
    }

    if (!options.wallet) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing wallet address. Use --wallet <address>.');
    }

    return options;
  }

  function parseExportFlags(args) {
    const options = {
      wallet: null,
      chainId: null,
      format: null,
      year: null,
      from: null,
      to: null,
      outPath: null,
      limit: 1000,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
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
      if (token === '--format') {
        const format = requireFlagValue(args, i, '--format').toLowerCase();
        if (format !== 'csv' && format !== 'json') {
          throw new CliError('INVALID_FLAG_VALUE', '--format must be csv|json.');
        }
        options.format = format;
        i += 1;
        continue;
      }
      if (token === '--year') {
        const year = parseInteger(requireFlagValue(args, i, '--year'), '--year');
        if (year < 1970 || year > 3000) {
          throw new CliError('INVALID_FLAG_VALUE', '--year must be between 1970 and 3000.');
        }
        options.year = year;
        i += 1;
        continue;
      }
      if (token === '--from') {
        options.from = parseInteger(requireFlagValue(args, i, '--from'), '--from');
        i += 1;
        continue;
      }
      if (token === '--to') {
        options.to = parseInteger(requireFlagValue(args, i, '--to'), '--to');
        i += 1;
        continue;
      }
      if (token === '--out') {
        options.outPath = requireFlagValue(args, i, '--out');
        i += 1;
        continue;
      }
      if (token === '--limit') {
        options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for export: ${token}`);
    }

    if (!options.wallet) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing wallet address. Use --wallet <address>.');
    }
    if (!options.format) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing export format. Use --format csv|json.');
    }
    if (options.from !== null && options.to !== null && options.from > options.to) {
      throw new CliError('INVALID_ARGS', '--from cannot be greater than --to.');
    }

    return options;
  }

  function parseArbitrageFlags(args) {
    const options = {
      chainId: null,
      venues: ['pandora', 'polymarket'],
      limit: 20,
      minSpreadPct: 3,
      minLiquidityUsd: 1000,
      maxCloseDiffHours: 24,
      similarityThreshold: 0.7,
      minTokenScore: 0.12,
      crossVenueOnly: true,
      withRules: false,
      includeSimilarity: false,
      questionContains: null,
      polymarketHost: null,
      polymarketMockUrl: null,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--chain-id') {
        options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
        i += 1;
        continue;
      }
      if (token === '--venues') {
        const venues = parseCsvList(requireFlagValue(args, i, '--venues'), '--venues').map((value) => value.toLowerCase());
        const allowed = new Set(['pandora', 'polymarket']);
        for (const venue of venues) {
          if (!allowed.has(venue)) {
            throw new CliError('INVALID_FLAG_VALUE', `Unsupported venue in --venues: ${venue}`);
          }
        }
        options.venues = venues;
        i += 1;
        continue;
      }
      if (token === '--limit') {
        options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
        i += 1;
        continue;
      }
      if (token === '--min-spread-pct') {
        options.minSpreadPct = parseNumber(requireFlagValue(args, i, '--min-spread-pct'), '--min-spread-pct');
        i += 1;
        continue;
      }
      if (token === '--min-liquidity-usdc') {
        options.minLiquidityUsd = parsePositiveNumber(requireFlagValue(args, i, '--min-liquidity-usdc'), '--min-liquidity-usdc');
        i += 1;
        continue;
      }
      if (token === '--max-close-diff-hours') {
        options.maxCloseDiffHours = parsePositiveNumber(
          requireFlagValue(args, i, '--max-close-diff-hours'),
          '--max-close-diff-hours',
        );
        i += 1;
        continue;
      }
      if (token === '--similarity-threshold') {
        options.similarityThreshold = parseNumber(
          requireFlagValue(args, i, '--similarity-threshold'),
          '--similarity-threshold',
        );
        if (options.similarityThreshold < 0 || options.similarityThreshold > 1) {
          throw new CliError('INVALID_FLAG_VALUE', '--similarity-threshold must be between 0 and 1.');
        }
        i += 1;
        continue;
      }
      if (token === '--min-token-score') {
        options.minTokenScore = parseNumber(requireFlagValue(args, i, '--min-token-score'), '--min-token-score');
        if (options.minTokenScore < 0 || options.minTokenScore > 1) {
          throw new CliError('INVALID_FLAG_VALUE', '--min-token-score must be between 0 and 1.');
        }
        i += 1;
        continue;
      }
      if (token === '--cross-venue-only') {
        options.crossVenueOnly = true;
        continue;
      }
      if (token === '--allow-same-venue') {
        options.crossVenueOnly = false;
        continue;
      }
      if (token === '--with-rules') {
        options.withRules = true;
        continue;
      }
      if (token === '--include-similarity') {
        options.includeSimilarity = true;
        continue;
      }
      if (token === '--question-contains') {
        options.questionContains = requireFlagValue(args, i, '--question-contains');
        i += 1;
        continue;
      }
      if (token === '--polymarket-host') {
        options.polymarketHost = requireFlagValue(args, i, '--polymarket-host');
        i += 1;
        continue;
      }
      if (token === '--polymarket-mock-url') {
        options.polymarketMockUrl = requireFlagValue(args, i, '--polymarket-mock-url');
        i += 1;
        continue;
      }

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for arbitrage: ${token}`);
    }

    if (options.minSpreadPct < 0) {
      throw new CliError('INVALID_FLAG_VALUE', '--min-spread-pct must be >= 0.');
    }

    return options;
  }

  function parseWebhookTestFlags(args) {
    const options = {
      webhookUrl: null,
      webhookTemplate: null,
      webhookSecret: null,
      webhookTimeoutMs: 5_000,
      webhookRetries: 3,
      telegramBotToken: null,
      telegramChatId: null,
      discordWebhookUrl: null,
      failOnWebhookError: false,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      const step = parseWebhookFlagIntoOptions(args, i, token, options);
      if (step !== null) {
        i += step;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for webhook test: ${token}`);
    }

    if (!hasWebhookTargets(options)) {
      throw new CliError(
        'MISSING_REQUIRED_FLAG',
        'webhook test requires at least one target: --webhook-url, Telegram, or Discord flags.',
      );
    }
    if ((options.telegramBotToken && !options.telegramChatId) || (!options.telegramBotToken && options.telegramChatId)) {
      throw new CliError(
        'INVALID_ARGS',
        'Telegram webhook requires both --telegram-bot-token and --telegram-chat-id.',
      );
    }

    return options;
  }

  function parseLeaderboardFlags(args) {
    const options = {
      metric: 'profit',
      chainId: null,
      limit: 20,
      minTrades: 0,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--metric') {
        const metric = requireFlagValue(args, i, '--metric').toLowerCase();
        if (!['profit', 'volume', 'win-rate'].includes(metric)) {
          throw new CliError('INVALID_FLAG_VALUE', '--metric must be profit|volume|win-rate.');
        }
        options.metric = metric;
        i += 1;
        continue;
      }
      if (token === '--chain-id') {
        options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
        i += 1;
        continue;
      }
      if (token === '--limit') {
        options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
        i += 1;
        continue;
      }
      if (token === '--min-trades') {
        options.minTrades = parseNonNegativeInteger(requireFlagValue(args, i, '--min-trades'), '--min-trades');
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for leaderboard: ${token}`);
    }

    return options;
  }

  function parseAnalyzeFlags(args) {
    const options = {
      marketAddress: null,
      provider: null,
      model: null,
      maxCostUsd: null,
      temperature: null,
      timeoutMs: 12_000,
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--market-address') {
        options.marketAddress = parseAddressFlag(requireFlagValue(args, i, '--market-address'), '--market-address');
        i += 1;
        continue;
      }
      if (token === '--provider') {
        options.provider = requireFlagValue(args, i, '--provider');
        i += 1;
        continue;
      }
      if (token === '--model') {
        options.model = requireFlagValue(args, i, '--model');
        i += 1;
        continue;
      }
      if (token === '--max-cost-usd') {
        options.maxCostUsd = parsePositiveNumber(requireFlagValue(args, i, '--max-cost-usd'), '--max-cost-usd');
        i += 1;
        continue;
      }
      if (token === '--temperature') {
        options.temperature = parseNumber(requireFlagValue(args, i, '--temperature'), '--temperature');
        i += 1;
        continue;
      }
      if (token === '--timeout-ms') {
        options.timeoutMs = parsePositiveInteger(requireFlagValue(args, i, '--timeout-ms'), '--timeout-ms');
        i += 1;
        continue;
      }

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for analyze: ${token}`);
    }

    if (!options.marketAddress) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing market address. Use --market-address <address>.');
    }

    return options;
  }

  function parseSuggestFlags(args) {
    const options = {
      wallet: null,
      risk: null,
      budget: null,
      count: 3,
      includeVenues: ['pandora', 'polymarket'],
    };

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--wallet') {
        options.wallet = parseAddressFlag(requireFlagValue(args, i, '--wallet'), '--wallet');
        i += 1;
        continue;
      }
      if (token === '--risk') {
        const risk = requireFlagValue(args, i, '--risk').toLowerCase();
        if (!['low', 'medium', 'high'].includes(risk)) {
          throw new CliError('INVALID_FLAG_VALUE', '--risk must be low|medium|high.');
        }
        options.risk = risk;
        i += 1;
        continue;
      }
      if (token === '--budget') {
        options.budget = parsePositiveNumber(requireFlagValue(args, i, '--budget'), '--budget');
        i += 1;
        continue;
      }
      if (token === '--count') {
        options.count = parsePositiveInteger(requireFlagValue(args, i, '--count'), '--count');
        i += 1;
        continue;
      }
      if (token === '--include-venues') {
        const venues = parseCsvList(requireFlagValue(args, i, '--include-venues'), '--include-venues').map((value) =>
          value.toLowerCase(),
        );
        const allowed = new Set(['pandora', 'polymarket']);
        for (const venue of venues) {
          if (!allowed.has(venue)) {
            throw new CliError('INVALID_FLAG_VALUE', `Unsupported venue in --include-venues: ${venue}`);
          }
        }
        options.includeVenues = venues;
        i += 1;
        continue;
      }

      throw new CliError('UNKNOWN_FLAG', `Unknown flag for suggest: ${token}`);
    }

    if (!options.wallet) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing wallet address. Use --wallet <address>.');
    }
    if (!options.risk) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing risk profile. Use --risk low|medium|high.');
    }
    if (options.budget === null) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'Missing budget. Use --budget <amount>.');
    }

    return options;
  }

  return {
    parseScriptEnvFlags,
    parseDoctorFlags,
    parseSetupFlags,
    parseInitEnvFlags,
    parseIndexerSharedFlags,
    parseGetIdFlags,
    parseMarketsGetFlags,
    readIdsFromStdin,
    parseMarketsListFlags,
    parseQuoteFlags,
    parsePollsListFlags,
    parsePositionsListFlags,
    parsePortfolioFlags,
    parseWebhookFlagIntoOptions,
    parseEventsListFlags,
    parseEventsGetFlags,
    parseHistoryFlags,
    parseExportFlags,
    parseArbitrageFlags,
    parseWebhookTestFlags,
    parseLeaderboardFlags,
    parseAnalyzeFlags,
    parseSuggestFlags,
  };
}

module.exports = {
  createCoreCommandFlagParsers,
};
