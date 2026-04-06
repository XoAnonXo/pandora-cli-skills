const { createParseStreamFlags } = require('./parsers/stream_flags.cjs');
const { graphqlRequest } = require('./indexer_client.cjs');

/**
 * Validate and return a required function dependency.
 * @param {object} deps
 * @param {string} name
 * @returns {Function}
 */
function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunStreamCommand requires deps.${name}()`);
  }
  return deps[name];
}

/**
 * Convert an HTTP(S) indexer URL to WS(S) for stream transport.
 * @param {string} indexerUrl
 * @returns {string|null}
 */
function toWsUrl(indexerUrl) {
  const parsed = new URL(String(indexerUrl || ''));
  if (parsed.protocol === 'https:') parsed.protocol = 'wss:';
  if (parsed.protocol === 'http:') parsed.protocol = 'ws:';
  return parsed.toString();
}

/**
 * Emit one NDJSON line to stdout with backpressure awareness.
 * @param {object} payload
 * @returns {Promise<void>}
 */
function writeNdjson(payload) {
  const line = `${JSON.stringify(payload)}\n`;
  if (process.stdout.write(line)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    process.stdout.once('drain', resolve);
  });
}

/**
 * Serialize stream writes so payloads are emitted in-order.
 * @returns {(payload: object) => Promise<void>}
 */
function createQueuedWriter() {
  let busy = false;
  const queue = [];

  async function flush() {
    while (queue.length > 0) {
      const payload = queue.shift();
      await writeNdjson(payload);
    }
    busy = false;
  }

  return (payload) => {
    queue.push(payload);
    if (!busy) {
      busy = true;
      flush();
    }
  };
}

/**
 * Create stable stream event metadata shared by tick/diagnostic envelopes.
 * @param {'prices'|'events'} channel
 * @param {number} seq
 * @param {'polling'|'websocket'} sourceTransport
 * @param {string|null} sourceUrl
 * @returns {object}
 */
function toTickBase(channel, seq, sourceTransport, sourceUrl) {
  return {
    type: 'stream.tick',
    ts: new Date().toISOString(),
    seq,
    channel,
    source: {
      transport: sourceTransport,
      url: sourceUrl || null,
    },
  };
}

/**
 * Query latest market rows used by the `prices` channel.
 * @param {string} indexerUrl
 * @param {{marketAddress?: string|null, chainId?: number|null, limit: number}} options
 * @param {number} timeoutMs
 * @returns {Promise<object[]>}
 */
async function fetchPriceRows(indexerUrl, options, timeoutMs) {
  const where = {};
  if (options.marketAddress) where.id = options.marketAddress;
  if (options.chainId !== null && options.chainId !== undefined) where.chainId = options.chainId;
  const query = `query StreamPrices($where: marketssFilter, $limit: Int) {
  marketss(where: $where, orderBy: "createdAt", orderDirection: "desc", limit: $limit) {
    items {
      id
      chainId
      chainName
      yesChance
      reserveYes
      reserveNo
      totalVolume
      currentTvl
      marketCloseTimestamp
      createdAt
    }
  }
}`;
  const data = await graphqlRequest(indexerUrl, query, { where, limit: options.limit }, timeoutMs);
  const page = data && data.marketss && Array.isArray(data.marketss.items) ? data.marketss.items : [];
  return page;
}

/**
 * Query latest liquidity event rows used by the `events` channel.
 * @param {string} indexerUrl
 * @param {{marketAddress?: string|null, chainId?: number|null, limit: number}} options
 * @param {number} timeoutMs
 * @returns {Promise<object[]>}
 */
async function fetchEventRows(indexerUrl, options, timeoutMs) {
  const where = {};
  if (options.marketAddress) where.marketAddress = options.marketAddress;
  if (options.chainId !== null && options.chainId !== undefined) where.chainId = options.chainId;
  const query = `query StreamEvents($where: liquidityEventsFilter, $limit: Int) {
  liquidityEventss(where: $where, orderBy: "timestamp", orderDirection: "desc", limit: $limit) {
    items {
      id
      chainId
      chainName
      provider
      marketAddress
      pollAddress
      eventType
      collateralAmount
      yesTokenAmount
      noTokenAmount
      txHash
      timestamp
    }
  }
}`;
  const data = await graphqlRequest(indexerUrl, query, { where, limit: options.limit }, timeoutMs);
  const page = data && data.liquidityEventss && Array.isArray(data.liquidityEventss.items) ? data.liquidityEventss.items : [];
  return page;
}

/**
 * Run polling-mode stream loop.
 * Emits `stream.tick` records for fetched rows and `stream.diagnostic` on fetch failures.
 * @param {string} indexerUrl
 * @param {{channel: 'prices'|'events', intervalMs: number}} options
 * @param {number} timeoutMs
 * @param {(ms: number) => Promise<void>} sleepMs
 * @param {(payload: object) => Promise<void>} emitNdjson
 * @returns {Promise<never>}
 */
async function runPollingStream(indexerUrl, options, timeoutMs, sleepMs, emitNdjson) {
  let seq = 0;
  const channelFetcher = options.channel === 'prices' ? fetchPriceRows : fetchEventRows;

  while (true) {
    try {
      const rows = await channelFetcher(indexerUrl, options, timeoutMs);
      const timestamp = new Date().toISOString();
      for (const row of rows) {
        seq += 1;
        await emitNdjson({
          ...toTickBase(options.channel, seq, 'polling', indexerUrl),
          ts: timestamp,
          data: row,
        });
      }
    } catch (error) {
      seq += 1;
      await emitNdjson({
        ...toTickBase(options.channel, seq, 'polling', indexerUrl),
        type: 'stream.diagnostic',
        data: {
          code: 'STREAM_POLL_ERROR',
          message: error && error.message ? error.message : String(error),
          retryInMs: options.intervalMs,
        },
      });
    }
    await sleepMs(options.intervalMs);
  }
}

/**
 * Attempt websocket streaming and return whether to continue with polling fallback.
 * Resolves `false` on connection/setup failure or close, rejects on runtime WS errors after open.
 * @param {string} wsUrl
 * @param {{channel: 'prices'|'events'}} options
 * @param {(payload: object) => Promise<void>} emitNdjson
 * @returns {Promise<boolean>}
 */
async function tryWebSocketStream(wsUrl, options, emitNdjson) {
  const { WebSocket } = require('ws');
  let seq = 0;

  return new Promise((resolve, reject) => {
    let opened = false;
    let settled = false;
    const ws = new WebSocket(wsUrl);

    const failoverTimer = setTimeout(() => {
      if (opened || settled) return;
      settled = true;
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      resolve(false);
    }, 1_500);

    ws.on('open', () => {
      opened = true;
      clearTimeout(failoverTimer);
      try {
        ws.send(JSON.stringify({ type: 'subscribe', channel: options.channel }));
      } catch {
        // non-fatal; some endpoints are passive feeds
      }
    });

    ws.on('message', (chunk) => {
      const text = String(chunk || '');
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
      seq += 1;
      void emitNdjson({
        ...toTickBase(options.channel, seq, 'websocket', wsUrl),
        data: parsed,
      });
    });

    ws.on('close', () => {
      clearTimeout(failoverTimer);
      if (settled) return;
      settled = true;
      resolve(false);
    });

    ws.on('error', (error) => {
      clearTimeout(failoverTimer);
      if (settled) return;
      if (!opened) {
        settled = true;
        resolve(false);
        return;
      }
      settled = true;
      reject(error);
    });
  });
}

/**
 * Create runner for `pandora stream`.
 * In active mode this command emits NDJSON lines continuously, independent of `--output`.
 * @param {object} deps
 * @returns {{runStreamCommand: (args: string[], context: {outputMode: 'table'|'json'}) => Promise<void>}}
 */
function createRunStreamCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseIndexerSharedFlags = requireDep(deps, 'parseIndexerSharedFlags');
  const maybeLoadIndexerEnv = requireDep(deps, 'maybeLoadIndexerEnv');
  const resolveIndexerUrl = requireDep(deps, 'resolveIndexerUrl');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parseAddressFlag = requireDep(deps, 'parseAddressFlag');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');
  const sleepMs = requireDep(deps, 'sleepMs');

  const parseStreamFlags = createParseStreamFlags({
    CliError,
    requireFlagValue,
    parseAddressFlag,
    parsePositiveInteger,
    isSecureHttpUrlOrLocal,
  });

  /**
   * Dispatch `stream` subcommands and start websocket/polling event emission.
   * @param {string[]} args
   * @param {{outputMode: 'table'|'json'}} context
   * @returns {Promise<void>}
   */
  async function runStreamCommand(args, context) {
    const shared = parseIndexerSharedFlags(args);
    if (!shared.rest.length || includesHelpFlag(shared.rest)) {
      const usage =
        'pandora stream prices|events [--indexer-url <url>] [--indexer-ws-url <url>] [--timeout-ms <ms>] [--interval-ms <ms>] [--market-address <address>] [--chain-id <id>] [--limit <n>]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'stream.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
        // eslint-disable-next-line no-console
        console.log('NDJSON is always emitted for active streams (one JSON object per line).');
      }
      return;
    }

    maybeLoadIndexerEnv(shared);
    const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
    const options = parseStreamFlags(shared.rest);
    const wsUrl = options.indexerWsUrl || toWsUrl(indexerUrl);
    const emitNdjson = createQueuedWriter();

    if (wsUrl) {
      try {
        await tryWebSocketStream(wsUrl, options, emitNdjson);
      } catch (error) {
        await emitNdjson({
          ...toTickBase(options.channel, 0, 'websocket', wsUrl),
          type: 'stream.diagnostic',
          data: {
            code: 'STREAM_WS_ERROR',
            message: error && error.message ? error.message : String(error),
            fallback: 'polling',
          },
        });
      }
    }

    await runPollingStream(indexerUrl, options, shared.timeoutMs, sleepMs, emitNdjson);
  }

  return {
    runStreamCommand,
  };
}

module.exports = {
  createRunStreamCommand,
};
