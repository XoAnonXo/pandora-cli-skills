const { createIndexerClient, IndexerClientError } = require('./indexer_client.cjs');
const { DEFAULT_INDEXER_URL } = require('./shared/constants.cjs');

const DEBUG_SCHEMA_VERSION = '1.0.0';
const MARKET_FIELDS = [
  'id',
  'chainId',
  'chainName',
  'pollAddress',
  'creator',
  'marketType',
  'marketCloseTimestamp',
  'totalVolume',
  'currentTvl',
  'reserveYes',
  'reserveNo',
  'yesChance',
  'createdAt',
];
const POLL_FIELDS = [
  'id',
  'chainId',
  'chainName',
  'creator',
  'question',
  'status',
  'category',
  'deadlineEpoch',
  'createdAt',
  'createdTxHash',
  'rules',
  'sources',
  'resolvedAt',
];
const POSITION_FIELDS = ['id', 'chainId', 'marketAddress', 'user', 'lastTradeAt', 'yesTokenAmount', 'noTokenAmount', 'yesBalance', 'noBalance'];
const TRADE_FIELDS = ['id', 'chainId', 'marketAddress', 'pollAddress', 'trader', 'side', 'tradeType', 'collateralAmount', 'tokenAmount', 'tokenAmountOut', 'feeAmount', 'timestamp', 'txHash'];
const LIQUIDITY_FIELDS = ['id', 'chainId', 'chainName', 'provider', 'marketAddress', 'pollAddress', 'eventType', 'collateralAmount', 'lpTokens', 'yesTokenAmount', 'noTokenAmount', 'yesTokensReturned', 'noTokensReturned', 'txHash', 'timestamp'];
const CLAIM_FIELDS = ['id', 'campaignAddress', 'userAddress', 'amount', 'signature', 'blockNumber', 'timestamp', 'txHash'];
const ORACLE_FEE_FIELDS = ['id', 'chainId', 'chainName', 'oracleAddress', 'eventName', 'newFee', 'to', 'amount', 'txHash', 'blockNumber', 'timestamp'];

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunDebugCommand requires deps.${name}()`);
  }
  return deps[name];
}

function normalizeAddress(value) {
  const raw = String(value || '').trim();
  return /^0x[a-fA-F0-9]{40}$/.test(raw) ? raw : null;
}

function parsePositiveInteger(value, flagName, CliError) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a positive integer.`);
  }
  return numeric;
}

function requireFlagValue(args, index, flagName, CliError) {
  if (index + 1 >= args.length || String(args[index + 1]).startsWith('--')) {
    throw new CliError('MISSING_REQUIRED_FLAG', `${flagName} requires a value.`);
  }
  return args[index + 1];
}

function toOptionalNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function round(value, decimals = 6) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
}

function toUsdcAmount(value) {
  const numeric = toOptionalNumber(value);
  return numeric === null ? null : round(numeric / 1_000_000, 6);
}

function resolveIndexerUrl(explicitUrl) {
  return explicitUrl || process.env.PANDORA_INDEXER_URL || process.env.INDEXER_URL || DEFAULT_INDEXER_URL;
}

function toCliError(error, CliError, fallbackCode, fallbackMessage) {
  if (error instanceof IndexerClientError) {
    return new CliError(error.code, error.message, error.details);
  }
  if (error && error.code) {
    return new CliError(error.code, error.message || fallbackMessage, error.details);
  }
  return new CliError(fallbackCode, fallbackMessage, {
    cause: error && error.message ? error.message : String(error),
  });
}

function normalizeYesChance(raw) {
  const numeric = toOptionalNumber(raw);
  if (numeric === null) return null;
  if (numeric >= 0 && numeric <= 1) return numeric;
  if (numeric > 1 && numeric <= 100) return numeric / 100;
  return numeric / 1_000_000_000;
}

function buildMarketSummary(market) {
  const reserveYes = toOptionalNumber(market && market.reserveYes);
  const reserveNo = toOptionalNumber(market && market.reserveNo);
  const totalPool = reserveYes !== null && reserveNo !== null ? reserveYes + reserveNo : null;
  const yesChance = normalizeYesChance(market && market.yesChance);
  const yesPct = yesChance !== null
    ? round(yesChance * 100, 6)
    : totalPool && totalPool > 0
      ? round((reserveNo / totalPool) * 100, 6)
      : null;
  return {
    id: market && market.id ? market.id : null,
    chainId: toOptionalNumber(market && market.chainId),
    chainName: market && market.chainName ? market.chainName : null,
    pollAddress: market && market.pollAddress ? market.pollAddress : null,
    marketType: market && market.marketType ? market.marketType : null,
    currentTvl: toOptionalNumber(market && market.currentTvl),
    totalVolume: toOptionalNumber(market && market.totalVolume),
    reserveYes,
    reserveNo,
    marketCloseTimestamp: toOptionalNumber(market && market.marketCloseTimestamp),
    yesPct,
    noPct: yesPct === null ? null : round(100 - yesPct, 6),
  };
}

function buildTradeSummary(items) {
  const trades = Array.isArray(items) ? items : [];
  return {
    count: trades.length,
    totalCollateralUsdc: round(trades.reduce((sum, item) => sum + (toUsdcAmount(item && item.collateralAmount) || 0), 0), 6) || 0,
    totalFeesUsdc: round(trades.reduce((sum, item) => sum + (toUsdcAmount(item && item.feeAmount) || 0), 0), 6) || 0,
    uniqueTraders: Array.from(new Set(trades.map((item) => String(item && item.trader ? item.trader : '').trim().toLowerCase()).filter(Boolean))).length,
  };
}

function buildPositionsSummary(items) {
  const positions = Array.isArray(items) ? items : [];
  return {
    count: positions.length,
    uniqueUsers: Array.from(new Set(positions.map((item) => String(item && item.user ? item.user : '').trim().toLowerCase()).filter(Boolean))).length,
  };
}

function buildLiquiditySummary(items) {
  const events = Array.isArray(items) ? items : [];
  return {
    count: events.length,
    totalCollateralUsdc: round(events.reduce((sum, item) => sum + (toUsdcAmount(item && item.collateralAmount) || 0), 0), 6) || 0,
  };
}

function buildClaimSummary(items) {
  const claims = Array.isArray(items) ? items : [];
  return {
    count: claims.length,
    totalAmountUsdc: round(claims.reduce((sum, item) => sum + (toUsdcAmount(item && item.amount) || 0), 0), 6) || 0,
  };
}

function renderDebugMarketTable(data) {
  const market = data.market || {};
  const poll = data.poll || {};
  const summary = data.summary || {};
  // eslint-disable-next-line no-console
  console.log('Debug Market');
  // eslint-disable-next-line no-console
  console.log(`marketAddress: ${market.id || ''}`);
  // eslint-disable-next-line no-console
  console.log(`pollAddress: ${market.pollAddress || poll.id || ''}`);
  // eslint-disable-next-line no-console
  console.log(`question: ${poll.question || ''}`);
  // eslint-disable-next-line no-console
  console.log(`yesPct: ${market.yesPct ?? ''}`);
  // eslint-disable-next-line no-console
  console.log(`trades: ${summary.trades ? summary.trades.count : 0}`);
  // eslint-disable-next-line no-console
  console.log(`positions: ${summary.positions ? summary.positions.count : 0}`);
}

function renderDebugTxTable(data) {
  const summary = data.summary || {};
  // eslint-disable-next-line no-console
  console.log('Debug Tx');
  // eslint-disable-next-line no-console
  console.log(`txHash: ${data.txHash || ''}`);
  // eslint-disable-next-line no-console
  console.log(`trades: ${summary.trades || 0}`);
  // eslint-disable-next-line no-console
  console.log(`liquidityEvents: ${summary.liquidityEvents || 0}`);
  // eslint-disable-next-line no-console
  console.log(`oracleFeeEvents: ${summary.oracleFeeEvents || 0}`);
  // eslint-disable-next-line no-console
  console.log(`claimEvents: ${summary.claimEvents || 0}`);
}

function parseDebugMarketFlags(args, CliError) {
  const options = {
    marketAddress: null,
    pollAddress: null,
    chainId: null,
    limit: 10,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i]);
    if (token === '--market-address' || token === '--id') {
      options.marketAddress = normalizeAddress(requireFlagValue(args, i, token, CliError));
      if (!options.marketAddress) {
        throw new CliError('INVALID_FLAG_VALUE', `${token} must be an EVM address.`);
      }
      i += 1;
      continue;
    }
    if (token === '--poll-address') {
      options.pollAddress = normalizeAddress(requireFlagValue(args, i, '--poll-address', CliError));
      if (!options.pollAddress) {
        throw new CliError('INVALID_FLAG_VALUE', '--poll-address must be an EVM address.');
      }
      i += 1;
      continue;
    }
    if (token === '--chain-id') {
      options.chainId = parsePositiveInteger(requireFlagValue(args, i, '--chain-id', CliError), '--chain-id', CliError);
      i += 1;
      continue;
    }
    if (token === '--limit') {
      options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit', CliError), '--limit', CliError);
      i += 1;
      continue;
    }
    throw new CliError('UNKNOWN_FLAG', `Unknown flag for debug market: ${token}`);
  }

  if ((options.marketAddress ? 1 : 0) + (options.pollAddress ? 1 : 0) !== 1) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'debug market requires exactly one selector: --market-address <address>|--id <address> or --poll-address <address>.');
  }

  return options;
}

function parseDebugTxFlags(args, CliError) {
  const options = {
    txHash: null,
    chainId: null,
    limit: 20,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i]);
    if (token === '--tx-hash') {
      options.txHash = String(requireFlagValue(args, i, '--tx-hash', CliError)).trim();
      i += 1;
      continue;
    }
    if (token === '--chain-id') {
      options.chainId = parsePositiveInteger(requireFlagValue(args, i, '--chain-id', CliError), '--chain-id', CliError);
      i += 1;
      continue;
    }
    if (token === '--limit') {
      options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit', CliError), '--limit', CliError);
      i += 1;
      continue;
    }
    throw new CliError('UNKNOWN_FLAG', `Unknown flag for debug tx: ${token}`);
  }

  if (!options.txHash) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'debug tx requires --tx-hash <hash>.');
  }

  return options;
}

async function fetchMarketBySelector(client, options) {
  if (options.marketAddress) {
    return client.getById({
      queryName: 'markets',
      fields: MARKET_FIELDS,
      id: options.marketAddress,
    });
  }

  const page = await client.list({
    queryName: 'marketss',
    filterType: 'marketsFilter',
    fields: MARKET_FIELDS,
    variables: {
      where: {
        pollAddress: options.pollAddress,
        ...(options.chainId !== null ? { chainId: options.chainId } : {}),
      },
      orderBy: 'createdAt',
      orderDirection: 'desc',
      before: null,
      after: null,
      limit: 2,
    },
  });

  return page.items && page.items[0] ? page.items[0] : null;
}

async function fetchDebugMarketPayload(indexerUrl, options, timeoutMs, CliError) {
  const client = createIndexerClient(indexerUrl, timeoutMs);
  const market = await fetchMarketBySelector(client, options);
  if (!market) {
    throw new CliError('NOT_FOUND', 'Market not found for the provided selector.');
  }

  const pollAddress = market.pollAddress || options.pollAddress;
  const [poll, positionsPage, tradesPage, liquidityPage, claimsPage] = await Promise.all([
    pollAddress
      ? client.getById({
          queryName: 'polls',
          fields: POLL_FIELDS,
          id: pollAddress,
        })
      : null,
    client.list({
      queryName: 'marketUserss',
      filterType: 'marketUsersFilter',
      fields: POSITION_FIELDS,
      variables: {
        where: {
          marketAddress: market.id,
          ...(options.chainId !== null ? { chainId: options.chainId } : {}),
        },
        orderBy: 'lastTradeAt',
        orderDirection: 'desc',
        before: null,
        after: null,
        limit: options.limit,
      },
    }),
    client.list({
      queryName: 'tradess',
      filterType: 'tradesFilter',
      fields: TRADE_FIELDS,
      variables: {
        where: {
          marketAddress: market.id,
          ...(options.chainId !== null ? { chainId: options.chainId } : {}),
        },
        orderBy: 'timestamp',
        orderDirection: 'desc',
        before: null,
        after: null,
        limit: options.limit,
      },
    }),
    client.list({
      queryName: 'liquidityEventss',
      filterType: 'liquidityEventsFilter',
      fields: LIQUIDITY_FIELDS,
      variables: {
        where: {
          marketAddress: market.id,
          ...(options.chainId !== null ? { chainId: options.chainId } : {}),
        },
        orderBy: 'timestamp',
        orderDirection: 'desc',
        before: null,
        after: null,
        limit: options.limit,
      },
    }),
    client.list({
      queryName: 'claimEventss',
      filterType: 'claimEventsFilter',
      fields: CLAIM_FIELDS,
      variables: {
        where: { campaignAddress: market.id },
        orderBy: 'blockNumber',
        orderDirection: 'desc',
        before: null,
        after: null,
        limit: options.limit,
      },
    }),
  ]);

  const normalizedMarket = buildMarketSummary(market);
  const payload = {
    schemaVersion: DEBUG_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    indexerUrl,
    selector: {
      marketAddress: options.marketAddress || normalizedMarket.id,
      pollAddress: options.pollAddress || normalizedMarket.pollAddress,
      chainId: options.chainId,
      limit: options.limit,
    },
    market: normalizedMarket,
    poll: poll || null,
    summary: {
      positions: buildPositionsSummary(positionsPage.items),
      trades: buildTradeSummary(tradesPage.items),
      liquidityEvents: buildLiquiditySummary(liquidityPage.items),
      claimEvents: buildClaimSummary(claimsPage.items),
    },
    recent: {
      positions: positionsPage.items || [],
      trades: tradesPage.items || [],
      liquidityEvents: liquidityPage.items || [],
      claimEvents: claimsPage.items || [],
    },
    pageInfo: {
      positions: positionsPage.pageInfo || null,
      trades: tradesPage.pageInfo || null,
      liquidityEvents: liquidityPage.pageInfo || null,
      claimEvents: claimsPage.pageInfo || null,
    },
    diagnostics: [],
  };

  if (positionsPage.pageInfo && positionsPage.pageInfo.hasNextPage) {
    payload.diagnostics.push('Position rows were truncated by --limit.');
  }
  if (tradesPage.pageInfo && tradesPage.pageInfo.hasNextPage) {
    payload.diagnostics.push('Trade rows were truncated by --limit.');
  }
  if (liquidityPage.pageInfo && liquidityPage.pageInfo.hasNextPage) {
    payload.diagnostics.push('Liquidity-event rows were truncated by --limit.');
  }
  if (claimsPage.pageInfo && claimsPage.pageInfo.hasNextPage) {
    payload.diagnostics.push('Claim-event rows were truncated by --limit.');
  }

  return payload;
}

async function fetchDebugTxPayload(indexerUrl, options, timeoutMs, CliError) {
  const client = createIndexerClient(indexerUrl, timeoutMs);
  const tradeWhere = {
    txHash: options.txHash,
    ...(options.chainId !== null ? { chainId: options.chainId } : {}),
  };
  const eventWhere = {
    txHash: options.txHash,
    ...(options.chainId !== null ? { chainId: options.chainId } : {}),
  };

  const [tradesPage, liquidityPage, oracleFeePage, claimsPage] = await Promise.all([
    client.list({
      queryName: 'tradess',
      filterType: 'tradesFilter',
      fields: TRADE_FIELDS,
      variables: { where: tradeWhere, orderBy: 'timestamp', orderDirection: 'desc', before: null, after: null, limit: options.limit },
    }),
    client.list({
      queryName: 'liquidityEventss',
      filterType: 'liquidityEventsFilter',
      fields: LIQUIDITY_FIELDS,
      variables: { where: eventWhere, orderBy: 'timestamp', orderDirection: 'desc', before: null, after: null, limit: options.limit },
    }),
    client.list({
      queryName: 'oracleFeeEventss',
      filterType: 'oracleFeeEventsFilter',
      fields: ORACLE_FEE_FIELDS,
      variables: { where: eventWhere, orderBy: 'timestamp', orderDirection: 'desc', before: null, after: null, limit: options.limit },
    }),
    client.list({
      queryName: 'claimEventss',
      filterType: 'claimEventsFilter',
      fields: CLAIM_FIELDS,
      variables: { where: { txHash: options.txHash }, orderBy: 'blockNumber', orderDirection: 'desc', before: null, after: null, limit: options.limit },
    }),
  ]);

  const marketIds = Array.from(new Set([
    ...(tradesPage.items || []).map((item) => item.marketAddress),
    ...(liquidityPage.items || []).map((item) => item.marketAddress),
  ].filter(Boolean)));
  const marketsById = marketIds.length ? await client.getManyByIds({ queryName: 'markets', fields: MARKET_FIELDS, ids: marketIds }) : new Map();
  const pollIds = Array.from(new Set([
    ...(tradesPage.items || []).map((item) => item.pollAddress),
    ...Array.from(marketsById.values()).map((item) => item && item.pollAddress),
  ].filter(Boolean)));
  const pollsById = pollIds.length ? await client.getManyByIds({ queryName: 'polls', fields: POLL_FIELDS, ids: pollIds }) : new Map();

  const count = (tradesPage.items || []).length
    + (liquidityPage.items || []).length
    + (oracleFeePage.items || []).length
    + (claimsPage.items || []).length;
  if (!count) {
    throw new CliError('NOT_FOUND', `No indexed trades or events found for tx hash: ${options.txHash}`);
  }

  return {
    schemaVersion: DEBUG_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    indexerUrl,
    txHash: options.txHash,
    chainId: options.chainId,
    limit: options.limit,
    summary: {
      trades: (tradesPage.items || []).length,
      liquidityEvents: (liquidityPage.items || []).length,
      oracleFeeEvents: (oracleFeePage.items || []).length,
      claimEvents: (claimsPage.items || []).length,
      relatedMarkets: marketIds.length,
      relatedPolls: pollIds.length,
    },
    relatedMarkets: marketIds.map((id) => buildMarketSummary(marketsById.get(id))).filter(Boolean),
    relatedPolls: pollIds.map((id) => pollsById.get(id)).filter(Boolean),
    sections: {
      trades: tradesPage.items || [],
      liquidityEvents: liquidityPage.items || [],
      oracleFeeEvents: (oracleFeePage.items || []).map((item) => ({
        ...item,
        amountUsdc: toUsdcAmount(item && item.amount),
        newFeeBps: toOptionalNumber(item && item.newFee),
      })),
      claimEvents: (claimsPage.items || []).map((item) => ({
        ...item,
        amountUsdc: toUsdcAmount(item && item.amount),
      })),
    },
    pageInfo: {
      trades: tradesPage.pageInfo || null,
      liquidityEvents: liquidityPage.pageInfo || null,
      oracleFeeEvents: oracleFeePage.pageInfo || null,
      claimEvents: claimsPage.pageInfo || null,
    },
  };
}

function createRunDebugCommand(deps) {
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseIndexerSharedFlags = requireDep(deps, 'parseIndexerSharedFlags');
  const maybeLoadIndexerEnv = requireDep(deps, 'maybeLoadIndexerEnv');
  const CliError = requireDep(deps, 'CliError');

  return async function runDebugCommand(args, context) {
    const shared = parseIndexerSharedFlags(args);
    maybeLoadIndexerEnv(shared);
    const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
    const action = shared.rest[0];
    const actionArgs = shared.rest.slice(1);
    const familyUsage = 'pandora [--output table|json] debug market|tx ...';

    if (!action || action === '--help' || action === '-h' || action === 'help') {
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'debug.help', commandHelpPayload(familyUsage, [
          '`debug market` stitches together market, poll, position, trade, and liquidity context for one selector.',
          '`debug tx` correlates indexed trades and events for one transaction hash.',
        ]));
      } else {
        // eslint-disable-next-line no-console
        console.log('Usage: pandora [--output table|json] debug market --market-address <address>|--poll-address <address> [--chain-id <id>] [--limit <n>] [--indexer-url <url>] [--timeout-ms <ms>]');
        // eslint-disable-next-line no-console
        console.log('       pandora [--output table|json] debug tx --tx-hash <hash> [--chain-id <id>] [--limit <n>] [--indexer-url <url>] [--timeout-ms <ms>]');
      }
      return;
    }

    if (action === 'market') {
      if (includesHelpFlag(actionArgs)) {
        const usage = 'pandora [--output table|json] debug market --market-address <address>|--poll-address <address> [--chain-id <id>] [--limit <n>] [--indexer-url <url>] [--timeout-ms <ms>]';
        if (context.outputMode === 'json') {
          emitSuccess(context.outputMode, 'debug.market.help', commandHelpPayload(usage));
        } else {
          // eslint-disable-next-line no-console
          console.log(`Usage: ${usage}`);
        }
        return;
      }

      try {
        const payload = await fetchDebugMarketPayload(indexerUrl, parseDebugMarketFlags(actionArgs, CliError), shared.timeoutMs, CliError);
        emitSuccess(context.outputMode, 'debug.market', payload, renderDebugMarketTable);
        return;
      } catch (error) {
        throw toCliError(error, CliError, 'DEBUG_MARKET_FAILED', 'debug market failed.');
      }
    }

    if (action === 'tx') {
      if (includesHelpFlag(actionArgs)) {
        const usage = 'pandora [--output table|json] debug tx --tx-hash <hash> [--chain-id <id>] [--limit <n>] [--indexer-url <url>] [--timeout-ms <ms>]';
        if (context.outputMode === 'json') {
          emitSuccess(context.outputMode, 'debug.tx.help', commandHelpPayload(usage));
        } else {
          // eslint-disable-next-line no-console
          console.log(`Usage: ${usage}`);
        }
        return;
      }

      try {
        const payload = await fetchDebugTxPayload(indexerUrl, parseDebugTxFlags(actionArgs, CliError), shared.timeoutMs, CliError);
        emitSuccess(context.outputMode, 'debug.tx', payload, renderDebugTxTable);
        return;
      } catch (error) {
        throw toCliError(error, CliError, 'DEBUG_TX_FAILED', 'debug tx failed.');
      }
    }

    throw new CliError('INVALID_ARGS', 'debug requires a subcommand: market|tx.');
  };
}

module.exports = {
  createRunDebugCommand,
};
