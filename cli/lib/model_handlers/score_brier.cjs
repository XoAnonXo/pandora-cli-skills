const path = require('path');
const { isMcpMode, assertMcpWorkspacePath } = require('../shared/mcp_path_guard.cjs');

function ensureFileAccessAllowed(rawPath, CliError) {
  const target = String(rawPath || '').trim();
  if (!target) return null;
  return assertMcpWorkspacePath(target, {
    flagName: '--forecast-file',
    errorFactory: (code, message, details) => new CliError(code, message, details),
  });
}

function defaultMcpForecastFile() {
  return path.join(process.cwd(), '.pandora', 'forecasts', 'forecasts.jsonl');
}

/**
 * Handle `model score brier` command execution.
 * @param {{actionArgs: string[], context: {outputMode: 'table'|'json'}, deps: object}} params
 * @returns {Promise<void>}
 */
module.exports = async function handleModelScoreBrier({ actionArgs, context, deps }) {
  const {
    CliError,
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    parseModelScoreBrierFlags,
    readForecastRecords,
    defaultForecastFile,
    computeBrierReport,
  } = deps;

  if (includesHelpFlag(actionArgs)) {
    const usage =
      'pandora [--output table|json] model score brier [--source <name>] [--market-address <address>] [--competition <id>] [--event-id <id>] [--model-id <id>] [--group-by source|market|competition|model|none] [--window-days <n>] [--bucket-count <n>] [--forecast-file <path>] [--include-records] [--include-unresolved] [--limit <n>]';
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'model.score.brier.help', commandHelpPayload(usage));
    } else {
      // eslint-disable-next-line no-console
      console.log(`Usage: ${usage}`);
    }
    return;
  }

  const options = parseModelScoreBrierFlags(actionArgs);
  let forecastFilePath = null;
  if (options.forecastFile) {
    forecastFilePath = ensureFileAccessAllowed(options.forecastFile, CliError);
  } else if (isMcpMode()) {
    forecastFilePath = defaultMcpForecastFile();
  } else {
    forecastFilePath = typeof defaultForecastFile === 'function' ? defaultForecastFile() : null;
  }

  const readResult = readForecastRecords(forecastFilePath || undefined, {
    source: options.source,
    marketAddress: options.marketAddress,
    competition: options.competition,
    eventId: options.eventId,
    modelId: options.modelId,
    includeUnresolved: options.includeUnresolved,
    windowDays: options.windowDays,
    limit: options.limit,
  });

  const report = computeBrierReport(readResult.records, {
    groupBy: options.groupBy,
    bucketCount: options.bucketCount,
    includeRecords: options.includeRecords,
  });

  emitSuccess(context.outputMode, 'model.score.brier', {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    action: 'score.brier',
    filters: {
      source: options.source,
      marketAddress: options.marketAddress,
      competition: options.competition,
      eventId: options.eventId,
      modelId: options.modelId,
      groupBy: options.groupBy,
      windowDays: options.windowDays,
      bucketCount: options.bucketCount,
      includeRecords: options.includeRecords,
      includeUnresolved: options.includeUnresolved,
      limit: options.limit,
      forecastFile: readResult.filePath,
    },
    ledger: {
      exists: readResult.exists,
      invalidLineCount: readResult.invalidLineCount,
      totalLineCount: readResult.totalLineCount,
      matchedRecordCount: readResult.records.length,
    },
    report,
    diagnostics: [
      'Brier score is lower-is-better for binary probability calibration.',
      'Reliability buckets compare predicted probabilities against empirical hit rates.',
    ],
  });
};
