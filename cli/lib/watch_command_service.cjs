const {
  resolveWatchRiskPolicy,
  evaluateWatchRiskAlerts,
} = require('./watch_risk_policy_service.cjs');

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunWatchCommand requires deps.${name}()`);
  }
  return deps[name];
}

function optionalDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') return null;
  return deps[name];
}

function normalizeTrackedProbability(value) {
  if (!Number.isFinite(Number(value))) return null;
  const numeric = Number(value);
  const probability = numeric > 1 && numeric <= 100 ? numeric / 100 : numeric;
  if (probability < 0 || probability > 1) return null;
  return probability;
}

function resolveWatchProbabilityYes(options, quote) {
  const fromOdds = quote
    && quote.odds
    && Number.isFinite(Number(quote.odds.yesProbability))
    ? normalizeTrackedProbability(quote.odds.yesProbability)
    : null;
  if (fromOdds !== null) return fromOdds;

  if (quote && quote.estimate && Number.isFinite(Number(quote.estimate.impliedProbability))) {
    const implied = normalizeTrackedProbability(quote.estimate.impliedProbability);
    if (implied !== null) {
      return options.side === 'no' ? 1 - implied : implied;
    }
  }

  if (Number.isFinite(Number(options.yesPct))) {
    return normalizeTrackedProbability(options.yesPct);
  }
  return null;
}

/**
 * Creates the `watch` command runner.
 * @param {object} deps
 * @returns {(args: string[], context: {outputMode: string}) => Promise<void>}
 */
function createRunWatchCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const parseIndexerSharedFlags = requireDep(deps, 'parseIndexerSharedFlags');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const watchHelpJsonPayload = requireDep(deps, 'watchHelpJsonPayload');
  const printWatchHelpTable = requireDep(deps, 'printWatchHelpTable');
  const maybeLoadIndexerEnv = requireDep(deps, 'maybeLoadIndexerEnv');
  const resolveIndexerUrl = requireDep(deps, 'resolveIndexerUrl');
  const parseWatchFlags = requireDep(deps, 'parseWatchFlags');
  const collectPortfolioSnapshot = requireDep(deps, 'collectPortfolioSnapshot');
  const buildQuotePayload = requireDep(deps, 'buildQuotePayload');
  const evaluateWatchAlerts = requireDep(deps, 'evaluateWatchAlerts');
  const hasWebhookTargets = requireDep(deps, 'hasWebhookTargets');
  const sendWebhookNotifications = requireDep(deps, 'sendWebhookNotifications');
  const sleepMs = requireDep(deps, 'sleepMs');
  const renderWatchTable = requireDep(deps, 'renderWatchTable');
  const appendForecastRecord = optionalDep(deps, 'appendForecastRecord');
  const defaultForecastFile = optionalDep(deps, 'defaultForecastFile');

  return async function runWatchCommand(args, context) {
    const shared = parseIndexerSharedFlags(args);
    if (shared.rest.includes('--help') || shared.rest.includes('-h')) {
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'watch.help', watchHelpJsonPayload());
      } else {
        printWatchHelpTable();
      }
      return;
    }

    maybeLoadIndexerEnv(shared);
    const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
    const options = parseWatchFlags(shared.rest);

    const snapshots = [];
    const alerts = [];
    const webhookReports = [];
    const riskPolicy = resolveWatchRiskPolicy(options);
    const riskState = {};
    const brierTracking = {
      enabled: Boolean(options.trackBrier),
      source: options.brierSource || options.forecastSource || 'watch',
      filePath: options.brierFile || options.forecastFile || (defaultForecastFile ? defaultForecastFile() : null),
      recordsWritten: 0,
      skippedCount: 0,
      errorCount: 0,
      missingDependency: false,
    };
    if (brierTracking.enabled && !appendForecastRecord) {
      brierTracking.missingDependency = true;
    }

    for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
      const snapshot = {
        iteration,
        timestamp: new Date().toISOString(),
      };
      let portfolio = null;
      let quote = null;

      if (options.wallet) {
        portfolio = await collectPortfolioSnapshot(indexerUrl, options, shared.timeoutMs);
        snapshot.portfolioSummary = portfolio.summary;
      }

      if (options.marketAddress) {
        quote = await buildQuotePayload(indexerUrl, {
          marketAddress: options.marketAddress,
          side: options.side,
          amountUsdc: options.amountUsdc,
          yesPct: options.yesPct,
          slippageBps: options.slippageBps,
        }, shared.timeoutMs);
        snapshot.quote = quote;
      }

      if (brierTracking.enabled) {
        if (!appendForecastRecord) {
          snapshot.brierTracking = {
            tracked: false,
            reason: 'FORECAST_STORE_UNAVAILABLE',
          };
          brierTracking.skippedCount += 1;
        } else {
          const probabilityYes = resolveWatchProbabilityYes(options, snapshot.quote);
          if (probabilityYes === null) {
            snapshot.brierTracking = {
              tracked: false,
              reason: 'FORECAST_PROBABILITY_UNAVAILABLE',
            };
            brierTracking.skippedCount += 1;
          } else {
            try {
              const writeResult = appendForecastRecord(
                brierTracking.filePath || undefined,
                {
                  source: brierTracking.source,
                  modelId: options.modelId || null,
                  marketAddress: options.marketAddress || (snapshot.quote ? snapshot.quote.marketAddress : null),
                  marketId: options.marketId || null,
                  competition: options.competition || null,
                  eventId: options.eventId || null,
                  probabilityYes,
                  forecastAt: snapshot.timestamp,
                  metadata: {
                    iteration,
                    side: options.side,
                    slippageBps: options.slippageBps,
                    quoteSource: snapshot.quote && snapshot.quote.odds ? snapshot.quote.odds.source || null : null,
                  },
                },
                {
                  now: () => new Date(snapshot.timestamp),
                },
              );
              brierTracking.recordsWritten += 1;
              brierTracking.filePath = writeResult.filePath || brierTracking.filePath;
              snapshot.brierTracking = {
                tracked: true,
                recordId: writeResult.record ? writeResult.record.id : null,
                source: brierTracking.source,
                filePath: brierTracking.filePath,
                probabilityYes,
              };
            } catch (error) {
              brierTracking.errorCount += 1;
              snapshot.brierTracking = {
                tracked: false,
                reason: 'FORECAST_WRITE_FAILED',
                errorCode: error && error.code ? error.code : null,
                errorMessage: error && error.message ? error.message : String(error),
              };
            }
          }
        }
      }

      const baseAlerts = evaluateWatchAlerts(snapshot, options);
      const riskEvaluation = evaluateWatchRiskAlerts({
        snapshot,
        policy: riskPolicy,
        options,
        portfolio,
        quote,
        state: riskState,
      });
      snapshot.risk = {
        metrics: riskEvaluation.metrics,
        limits: riskPolicy.limits,
        configured: riskPolicy.configured,
        alertCount: riskEvaluation.alerts.length,
      };
      snapshot.alerts = [...baseAlerts, ...riskEvaluation.alerts];
      snapshot.alertCount = snapshot.alerts.length;
      if (snapshot.alertCount) {
        alerts.push(...snapshot.alerts);
      }

      if (snapshot.alertCount && hasWebhookTargets(options)) {
        const report = await sendWebhookNotifications(options, {
          event: 'watch.alert',
          iteration,
          alertCount: snapshot.alertCount,
          alerts: snapshot.alerts,
          snapshot,
          message: `[Pandora Watch] ${snapshot.alerts[0].message}`,
        });
        webhookReports.push({ iteration, report });
        if (options.failOnWebhookError && report.failureCount > 0) {
          throw new CliError(
            'WEBHOOK_DELIVERY_FAILED',
            `watch webhook delivery failed for iteration ${iteration}.`,
            { iteration, report, snapshot },
            2,
          );
        }
      }

      snapshots.push(snapshot);
      if (iteration < options.iterations) {
        // Keep watch responsive while still supporting deterministic tiny intervals in tests.
        await sleepMs(options.intervalMs);
      }
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      indexerUrl,
      iterationsRequested: options.iterations,
      intervalMs: options.intervalMs,
      count: snapshots.length,
      alertCount: alerts.length,
      parameters: {
        wallet: options.wallet,
        marketAddress: options.marketAddress,
        side: options.side,
        amountUsdc: options.amountUsdc,
        chainId: options.chainId,
        includeEvents: options.includeEvents,
        yesPct: options.yesPct,
        alertYesBelow: options.alertYesBelow,
        alertYesAbove: options.alertYesAbove,
        alertNetLiquidityBelow: options.alertNetLiquidityBelow,
        alertNetLiquidityAbove: options.alertNetLiquidityAbove,
        failOnAlert: options.failOnAlert,
        trackBrier: brierTracking.enabled,
        brierSource: brierTracking.source,
        brierFile: brierTracking.filePath,
        webhookEnabled: hasWebhookTargets(options),
        failOnWebhookError: options.failOnWebhookError,
      },
      snapshots,
      alerts,
      webhookReports,
      brierTracking,
      riskPolicy,
    };

    if (options.failOnAlert && alerts.length) {
      throw new CliError(
        'WATCH_ALERT_TRIGGERED',
        `watch detected ${alerts.length} alert(s).`,
        payload,
        2,
      );
    }

    emitSuccess(context.outputMode, 'watch', payload, renderWatchTable);
  };
}

module.exports = {
  createRunWatchCommand,
};
