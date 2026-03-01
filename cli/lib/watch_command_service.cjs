function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunWatchCommand requires deps.${name}()`);
  }
  return deps[name];
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
    for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
      const snapshot = {
        iteration,
        timestamp: new Date().toISOString(),
      };

      if (options.wallet) {
        const portfolio = await collectPortfolioSnapshot(indexerUrl, options, shared.timeoutMs);
        snapshot.portfolioSummary = portfolio.summary;
      }

      if (options.marketAddress) {
        const quote = await buildQuotePayload(indexerUrl, {
          marketAddress: options.marketAddress,
          side: options.side,
          amountUsdc: options.amountUsdc,
          yesPct: options.yesPct,
          slippageBps: options.slippageBps,
        }, shared.timeoutMs);
        snapshot.quote = quote;
      }

      snapshot.alerts = evaluateWatchAlerts(snapshot, options);
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
        webhookEnabled: hasWebhookTargets(options),
        failOnWebhookError: options.failOnWebhookError,
      },
      snapshots,
      alerts,
      webhookReports,
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
