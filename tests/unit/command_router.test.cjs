const test = require('node:test');
const assert = require('node:assert/strict');

const { createCommandRouter } = require('../../cli/lib/command_router.cjs');

class CliError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function createRouterDeps(overrides = {}) {
  const noop = async () => {};
  const deps = {
    CliError,
    packageVersion: '0.0.0-test',
    emitSuccess: () => {},
    helpJsonPayload: () => ({}),
    printHelpTable: () => {},
    includesHelpFlag: () => false,
    commandHelpPayload: (usage) => ({ usage }),
    runInitEnv: noop,
    runDoctor: noop,
    runSetup: noop,
    runDashboardCommand: noop,
    runFundCheckCommand: noop,
    runBridgeCommand: noop,
    runFeesCommand: noop,
    runDebugCommand: noop,
    runMarketsCommand: noop,
    runScanCommand: noop,
    runSportsCommand: noop,
    runLifecycleCommand: noop,
    runArbCommand: noop,
    runOddsCommand: noop,
    runQuoteCommand: noop,
    runTradeCommand: noop,
    runSellCommand: noop,
    runPollsCommand: noop,
    runEventsCommand: noop,
    runPositionsCommand: noop,
    runPortfolioCommand: noop,
    runWatchCommand: noop,
    runHistoryCommand: noop,
    runExportCommand: noop,
    runArbitrageCommand: noop,
    runAutopilotCommand: noop,
    runMirrorCommand: noop,
    runPolymarketCommand: noop,
    runWebhookCommand: noop,
    runLeaderboardCommand: noop,
    runAnalyzeCommand: noop,
    runAgentCommand: noop,
    runSuggestCommand: noop,
    runResolveCommand: noop,
    runClaimCommand: noop,
    runLpCommand: noop,
    runPolicyCommand: noop,
    runProfileCommand: noop,
    runRecipeCommand: noop,
    runRiskCommand: noop,
    runExplainCommand: noop,
    runOperationsCommand: noop,
    runModelCommand: noop,
    runMcpCommand: noop,
    runStreamCommand: noop,
    runSimulateCommand: noop,
    runCapabilitiesCommand: noop,
    runBootstrapCommand: noop,
    runSchemaCommand: noop,
    runScriptCommand: noop,
  };
  return { ...deps, ...overrides };
}

test('command router validates bridge handler at construction time', () => {
  const deps = createRouterDeps({ runBridgeCommand: undefined });

  assert.throws(
    () => createCommandRouter(deps),
    /createCommandRouter requires runBridgeCommand/,
  );
});

