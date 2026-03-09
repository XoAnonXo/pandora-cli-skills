const ROUTED_TOP_LEVEL_COMMANDS = Object.freeze([
  'init-env',
  'doctor',
  'setup',
  'markets',
  'scan',
  'sports',
  'lifecycle',
  'arb',
  'odds',
  'quote',
  'trade',
  'sell',
  'polls',
  'events',
  'positions',
  'portfolio',
  'watch',
  'history',
  'export',
  'arbitrage',
  'autopilot',
  'mirror',
  'polymarket',
  'webhook',
  'leaderboard',
  'analyze',
  'agent',
  'suggest',
  'resolve',
  'claim',
  'lp',
  'policy',
  'profile',
  'recipe',
  'risk',
  'operations',
  'model',
  'mcp',
  'stream',
  'simulate',
  'capabilities',
  'bootstrap',
  'schema',
  'launch',
  'clone-bet',
]);

/**
 * Build the top-level command dispatcher for `pandora`.
 * The returned function routes parsed command/args/context to subcommand handlers.
 * @param {object} deps
 * @returns {(command: string|undefined, args: string[], context: {outputMode: 'table'|'json'}) => Promise<void>}
 */
function createCommandRouter(deps = {}) {
  const {
    CliError,
    packageVersion,
    emitSuccess,
    helpJsonPayload,
    printHelpTable,
    includesHelpFlag,
    commandHelpPayload,
    runInitEnv,
    runDoctor,
    runSetup,
    runMarketsCommand,
    runScanCommand,
    runSportsCommand,
    runLifecycleCommand,
    runArbCommand,
    runOddsCommand,
    runQuoteCommand,
    runTradeCommand,
    runSellCommand,
    runPollsCommand,
    runEventsCommand,
    runPositionsCommand,
    runPortfolioCommand,
    runWatchCommand,
    runHistoryCommand,
    runExportCommand,
    runArbitrageCommand,
    runAutopilotCommand,
    runMirrorCommand,
    runPolymarketCommand,
    runWebhookCommand,
    runLeaderboardCommand,
    runAnalyzeCommand,
    runAgentCommand,
    runSuggestCommand,
    runResolveCommand,
    runClaimCommand,
    runLpCommand,
    runPolicyCommand,
    runProfileCommand,
    runRecipeCommand,
    runRiskCommand,
    runOperationsCommand,
    runModelCommand,
    runMcpCommand,
    runStreamCommand,
    runSimulateCommand,
    runCapabilitiesCommand,
    runBootstrapCommand,
    runScriptCommand,
  } = deps;

  if (typeof CliError !== 'function') {
    throw new Error('createCommandRouter requires CliError.');
  }

  if (typeof emitSuccess !== 'function') {
    throw new Error('createCommandRouter requires emitSuccess.');
  }

  function requireFn(name, fn) {
    if (typeof fn !== 'function') {
      throw new Error(`createCommandRouter requires ${name}.`);
    }
  }

  requireFn('helpJsonPayload', helpJsonPayload);
  requireFn('printHelpTable', printHelpTable);
  requireFn('includesHelpFlag', includesHelpFlag);
  requireFn('commandHelpPayload', commandHelpPayload);
  requireFn('runInitEnv', runInitEnv);
  requireFn('runDoctor', runDoctor);
  requireFn('runSetup', runSetup);
  requireFn('runMarketsCommand', runMarketsCommand);
  requireFn('runScanCommand', runScanCommand);
  requireFn('runSportsCommand', runSportsCommand);
  requireFn('runLifecycleCommand', runLifecycleCommand);
  requireFn('runArbCommand', runArbCommand);
  requireFn('runOddsCommand', runOddsCommand);
  requireFn('runQuoteCommand', runQuoteCommand);
  requireFn('runTradeCommand', runTradeCommand);
  requireFn('runSellCommand', runSellCommand);
  requireFn('runPollsCommand', runPollsCommand);
  requireFn('runEventsCommand', runEventsCommand);
  requireFn('runPositionsCommand', runPositionsCommand);
  requireFn('runPortfolioCommand', runPortfolioCommand);
  requireFn('runWatchCommand', runWatchCommand);
  requireFn('runHistoryCommand', runHistoryCommand);
  requireFn('runExportCommand', runExportCommand);
  requireFn('runArbitrageCommand', runArbitrageCommand);
  requireFn('runAutopilotCommand', runAutopilotCommand);
  requireFn('runMirrorCommand', runMirrorCommand);
  requireFn('runPolymarketCommand', runPolymarketCommand);
  requireFn('runWebhookCommand', runWebhookCommand);
  requireFn('runLeaderboardCommand', runLeaderboardCommand);
  requireFn('runAnalyzeCommand', runAnalyzeCommand);
  requireFn('runAgentCommand', runAgentCommand);
  requireFn('runSuggestCommand', runSuggestCommand);
  requireFn('runResolveCommand', runResolveCommand);
  requireFn('runClaimCommand', runClaimCommand);
  requireFn('runLpCommand', runLpCommand);
  requireFn('runPolicyCommand', runPolicyCommand);
  requireFn('runProfileCommand', runProfileCommand);
  requireFn('runRecipeCommand', runRecipeCommand);
  requireFn('runRiskCommand', runRiskCommand);
  requireFn('runOperationsCommand', runOperationsCommand);
  requireFn('runModelCommand', runModelCommand);
  requireFn('runMcpCommand', runMcpCommand);
  requireFn('runStreamCommand', runStreamCommand);
  requireFn('runSimulateCommand', runSimulateCommand);
  requireFn('runCapabilitiesCommand', runCapabilitiesCommand);
  requireFn('runBootstrapCommand', runBootstrapCommand);
  requireFn('runSchemaCommand', deps.runSchemaCommand);
  requireFn('runScriptCommand', runScriptCommand);

  return async function dispatch(command, args, context) {
    if (!command || command === 'help' || command === '--help' || command === '-h') {
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'help', helpJsonPayload());
      } else {
        printHelpTable();
      }
      return;
    }

    if (command === '--version' || command === '-V' || command === 'version') {
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'version', { version: packageVersion });
      } else {
        // eslint-disable-next-line no-console
        console.log(packageVersion);
      }
      return;
    }

    const handlers = {
      'init-env': async (handlerArgs, handlerContext) => {
        if (includesHelpFlag(handlerArgs)) {
          const usage = 'pandora [--output table|json] init-env [--force] [--dotenv-path <path>] [--example <path>]';
          if (handlerContext.outputMode === 'json') {
            emitSuccess(handlerContext.outputMode, 'init-env.help', commandHelpPayload(usage));
          } else {
            // eslint-disable-next-line no-console
            console.log(`Usage: ${usage}`);
          }
          return;
        }
        runInitEnv(handlerArgs, handlerContext.outputMode);
      },
      doctor: async (handlerArgs, handlerContext) => {
        if (includesHelpFlag(handlerArgs)) {
          const usage =
            'pandora [--output table|json] doctor [--dotenv-path <path>] [--skip-dotenv] [--check-usdc-code] [--check-polymarket] [--rpc-timeout-ms <ms>]';
          if (handlerContext.outputMode === 'json') {
            emitSuccess(handlerContext.outputMode, 'doctor.help', commandHelpPayload(usage));
          } else {
            // eslint-disable-next-line no-console
            console.log(`Usage: ${usage}`);
          }
          return;
        }
        await runDoctor(handlerArgs, handlerContext.outputMode);
      },
      setup: async (handlerArgs, handlerContext) => {
        if (includesHelpFlag(handlerArgs)) {
          const usage =
            'pandora [--output table|json] setup [--force] [--dotenv-path <path>] [--example <path>] [--check-usdc-code] [--check-polymarket] [--rpc-timeout-ms <ms>]';
          if (handlerContext.outputMode === 'json') {
            emitSuccess(handlerContext.outputMode, 'setup.help', commandHelpPayload(usage));
          } else {
            // eslint-disable-next-line no-console
            console.log(`Usage: ${usage}`);
          }
          return;
        }
        await runSetup(handlerArgs, handlerContext.outputMode);
      },
      markets: async (handlerArgs, handlerContext) => runMarketsCommand(handlerArgs, handlerContext),
      scan: async (handlerArgs, handlerContext) => runScanCommand(handlerArgs, handlerContext),
      sports: async (handlerArgs, handlerContext) => runSportsCommand(handlerArgs, handlerContext),
      lifecycle: async (handlerArgs, handlerContext) => runLifecycleCommand(handlerArgs, handlerContext),
      arb: async (handlerArgs, handlerContext) => runArbCommand(handlerArgs, handlerContext),
      odds: async (handlerArgs, handlerContext) => runOddsCommand(handlerArgs, handlerContext),
      quote: async (handlerArgs, handlerContext) => runQuoteCommand(handlerArgs, handlerContext),
      trade: async (handlerArgs, handlerContext) => runTradeCommand(handlerArgs, handlerContext),
      sell: async (handlerArgs, handlerContext) => runSellCommand(handlerArgs, handlerContext),
      polls: async (handlerArgs, handlerContext) => runPollsCommand(handlerArgs, handlerContext),
      events: async (handlerArgs, handlerContext) => runEventsCommand(handlerArgs, handlerContext),
      positions: async (handlerArgs, handlerContext) => runPositionsCommand(handlerArgs, handlerContext),
      portfolio: async (handlerArgs, handlerContext) => runPortfolioCommand(handlerArgs, handlerContext),
      watch: async (handlerArgs, handlerContext) => runWatchCommand(handlerArgs, handlerContext),
      history: async (handlerArgs, handlerContext) => runHistoryCommand(handlerArgs, handlerContext),
      export: async (handlerArgs, handlerContext) => runExportCommand(handlerArgs, handlerContext),
      arbitrage: async (handlerArgs, handlerContext) => runArbitrageCommand(handlerArgs, handlerContext),
      autopilot: async (handlerArgs, handlerContext) => runAutopilotCommand(handlerArgs, handlerContext),
      mirror: async (handlerArgs, handlerContext) => runMirrorCommand(handlerArgs, handlerContext),
      polymarket: async (handlerArgs, handlerContext) => runPolymarketCommand(handlerArgs, handlerContext),
      webhook: async (handlerArgs, handlerContext) => runWebhookCommand(handlerArgs, handlerContext),
      leaderboard: async (handlerArgs, handlerContext) => runLeaderboardCommand(handlerArgs, handlerContext),
      analyze: async (handlerArgs, handlerContext) => runAnalyzeCommand(handlerArgs, handlerContext),
      agent: async (handlerArgs, handlerContext) => runAgentCommand(handlerArgs, handlerContext),
      suggest: async (handlerArgs, handlerContext) => runSuggestCommand(handlerArgs, handlerContext),
      resolve: async (handlerArgs, handlerContext) => runResolveCommand(handlerArgs, handlerContext),
      claim: async (handlerArgs, handlerContext) => runClaimCommand(handlerArgs, handlerContext),
      lp: async (handlerArgs, handlerContext) => runLpCommand(handlerArgs, handlerContext),
      policy: async (handlerArgs, handlerContext) => runPolicyCommand(handlerArgs, handlerContext),
      profile: async (handlerArgs, handlerContext) => runProfileCommand(handlerArgs, handlerContext),
      recipe: async (handlerArgs, handlerContext) => runRecipeCommand(handlerArgs, handlerContext),
      risk: async (handlerArgs, handlerContext) => runRiskCommand(handlerArgs, handlerContext),
      operations: async (handlerArgs, handlerContext) => runOperationsCommand(handlerArgs, handlerContext),
      model: async (handlerArgs, handlerContext) => runModelCommand(handlerArgs, handlerContext),
      mcp: async (handlerArgs, handlerContext) => {
        if (handlerContext.outputMode === 'json') {
          throw new CliError(
            'UNSUPPORTED_OUTPUT_MODE',
            '--output json is not supported for mcp because MCP uses raw stdio transport.',
          );
        }
        await runMcpCommand(handlerArgs, handlerContext);
      },
      stream: async (handlerArgs, handlerContext) => runStreamCommand(handlerArgs, handlerContext),
      simulate: async (handlerArgs, handlerContext) => runSimulateCommand(handlerArgs, handlerContext),
      capabilities: async (handlerArgs, handlerContext) => runCapabilitiesCommand(handlerArgs, handlerContext),
      bootstrap: async (handlerArgs, handlerContext) => runBootstrapCommand(handlerArgs, handlerContext),
      schema: async (handlerArgs, handlerContext) => deps.runSchemaCommand(handlerArgs, handlerContext),
      launch: async (handlerArgs, handlerContext) => {
        if (handlerContext.outputMode === 'json') {
          throw new CliError(
            'UNSUPPORTED_OUTPUT_MODE',
            '--output json is not supported for launch/clone-bet because these commands stream script output directly.',
          );
        }
        runScriptCommand('launch', handlerArgs);
      },
      'clone-bet': async (handlerArgs, handlerContext) => {
        if (handlerContext.outputMode === 'json') {
          throw new CliError(
            'UNSUPPORTED_OUTPUT_MODE',
            '--output json is not supported for launch/clone-bet because these commands stream script output directly.',
          );
        }
        runScriptCommand('clone-bet', handlerArgs);
      },
    };

    const handler = handlers[command];
    if (!handler) {
      throw new CliError('UNKNOWN_COMMAND', `Unknown command: ${command}`, {
        hints: ['Run `pandora help` to see available commands.'],
      });
    }

    await handler(args, context);
  };
}

/** Public command-router factory export. */
module.exports = {
  createCommandRouter,
  ROUTED_TOP_LEVEL_COMMANDS,
};
