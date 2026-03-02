function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunOddsCommand requires deps.${name}()`);
  }
  return deps[name];
}

const ODDS_RECORD_USAGE =
  'pandora [--output table|json] odds record --competition <id> --interval <sec> [--max-samples <n>] [--event-id <id>] [--venues pandora_amm,polymarket] [--indexer-url <url>] [--polymarket-host <url>] [--polymarket-mock-url <url>] [--timeout-ms <ms>]';
const ODDS_HISTORY_USAGE =
  'pandora [--output table|json] odds history --event-id <id> --output csv|json [--limit <n>]';

/**
 * Create runner for `pandora odds` commands.
 * @param {object} deps
 * @returns {(args: string[], context: {outputMode: 'table'|'json'}) => Promise<void>}
 */
function createRunOddsCommand(deps) {
  const parseIndexerSharedFlags = requireDep(deps, 'parseIndexerSharedFlags');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const maybeLoadIndexerEnv = requireDep(deps, 'maybeLoadIndexerEnv');
  const resolveIndexerUrl = requireDep(deps, 'resolveIndexerUrl');
  const parseOddsFlags = requireDep(deps, 'parseOddsFlags');
  const createOddsHistoryService = requireDep(deps, 'createOddsHistoryService');
  const createVenueConnectorFactory = requireDep(deps, 'createVenueConnectorFactory');
  const sleepMs = requireDep(deps, 'sleepMs');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const renderSingleEntityTable = requireDep(deps, 'renderSingleEntityTable');

  return async function runOddsCommand(args, context) {
    const shared = parseIndexerSharedFlags(args);
    if (!shared.rest.length || includesHelpFlag(shared.rest)) {
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'odds.help', {
          usage: ODDS_RECORD_USAGE,
          historyUsage: ODDS_HISTORY_USAGE,
        });
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${ODDS_RECORD_USAGE}`);
        // eslint-disable-next-line no-console
        console.log(`       ${ODDS_HISTORY_USAGE}`);
      }
      return;
    }

    maybeLoadIndexerEnv(shared);
    const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
    const parsed = parseOddsFlags(shared.rest);
    const options = parsed.options || {};

    const historyService = createOddsHistoryService();
    const connectorFactory = createVenueConnectorFactory();

    if (parsed.action === 'record') {
      const intervalMs = Number(options.intervalSec) * 1000;
      const maxSamples = Number.isInteger(options.maxSamples) && options.maxSamples > 0 ? options.maxSamples : 1;
      const sampleResults = [];
      let insertedTotal = 0;

      for (let sample = 1; sample <= maxSamples; sample += 1) {
        const rows = [];
        const diagnostics = [];
        for (const venue of options.venues) {
          try {
            const connector = connectorFactory.createConnector(venue, {
              indexerUrl,
              host: options.polymarketHost || null,
              mockUrl: options.polymarketMockUrl || null,
              timeoutMs: options.timeoutMs || shared.timeoutMs,
            });
            const pricePayload = await connector.getPrice({
              competition: options.competition,
              eventId: options.eventId,
              indexerUrl,
              host: options.polymarketHost || null,
              mockUrl: options.polymarketMockUrl || null,
              timeoutMs: options.timeoutMs || shared.timeoutMs,
            });
            if (pricePayload && Array.isArray(pricePayload.items)) {
              rows.push(...pricePayload.items);
            }
          } catch (err) {
            diagnostics.push({
              venue,
              code: err && err.code ? String(err.code) : 'ODDS_RECORD_CONNECTOR_FAILED',
              message: err && err.message ? err.message : String(err),
            });
          }
        }

        const writeResult = historyService.recordEntries(rows);
        insertedTotal += writeResult.inserted;
        sampleResults.push({
          sample,
          observedAt: new Date().toISOString(),
          inserted: writeResult.inserted,
          diagnostics,
        });

        if (sample < maxSamples) {
          await sleepMs(intervalMs);
        }
      }

      emitSuccess(context.outputMode, 'odds.record', {
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        action: 'record',
        competition: options.competition,
        eventId: options.eventId || null,
        intervalSec: options.intervalSec,
        maxSamples,
        venues: options.venues,
        backend: historyService.backend,
        storage: historyService.paths,
        insertedTotal,
        samples: sampleResults,
      }, renderSingleEntityTable);
      return;
    }

    const rows = historyService.queryByEventId(options.eventId, {
      limit: options.limit,
    });
    const basePayload = {
      schemaVersion: '1.0.0',
      generatedAt: new Date().toISOString(),
      action: 'history',
      eventId: options.eventId,
      backend: historyService.backend,
      storage: historyService.paths,
      count: rows.length,
      items: rows,
    };

    if (options.output === 'csv') {
      const csv = historyService.formatRows(rows, 'csv');
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'odds.history', {
          ...basePayload,
          output: 'csv',
          csv,
        });
      } else {
        // eslint-disable-next-line no-console
        console.log(csv);
      }
      return;
    }

    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'odds.history', {
        ...basePayload,
        output: 'json',
      });
    } else {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(basePayload, null, 2));
    }
  };
}

module.exports = {
  createRunOddsCommand,
  ODDS_RECORD_USAGE,
  ODDS_HISTORY_USAGE,
};
