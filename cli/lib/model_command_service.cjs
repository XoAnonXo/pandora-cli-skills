const INVALID_SUBCOMMAND_MESSAGE = 'model requires subcommand: calibrate|correlation|diagnose|score brier <metric>';

/**
 * Build the `model` subcommand dispatcher with lazy-loaded action handlers.
 * @param {object} deps
 * @returns {(args: string[], context: {outputMode: 'table'|'json'}) => Promise<void>}
 */
function createRunModelCommand(deps) {
  const { CliError, emitSuccess, commandHelpPayload } = deps || {};
  if (typeof CliError !== 'function') {
    throw new Error('createRunModelCommand requires deps.CliError()');
  }
  if (typeof emitSuccess !== 'function') {
    throw new Error('createRunModelCommand requires deps.emitSuccess()');
  }
  if (typeof commandHelpPayload !== 'function') {
    throw new Error('createRunModelCommand requires deps.commandHelpPayload()');
  }

  const handlerLoaders = {
    calibrate: () => require('./model_handlers/calibrate.cjs'),
    correlation: () => require('./model_handlers/correlation.cjs'),
    diagnose: () => require('./model_handlers/diagnose.cjs'),
    score: () => require('./model_handlers/score_brier.cjs'),
  };
  const handlerCache = new Map();

  function getHandler(action) {
    if (handlerCache.has(action)) {
      return handlerCache.get(action);
    }

    const load = handlerLoaders[action];
    if (!load) {
      return null;
    }

    const loaded = load();
    const handler =
      typeof loaded === 'function'
        ? loaded
        : loaded && typeof loaded.handle === 'function'
          ? loaded.handle
          : null;

    if (!handler) {
      throw new Error(`Invalid model handler module for action: ${action}`);
    }

    handlerCache.set(action, handler);
    return handler;
  }

  return async function runModelCommand(args, context) {
    const action = args[0];
    const actionArgs = args.slice(1);

    if (!action || action === '--help' || action === '-h') {
      const usage = 'pandora [--output table|json] model calibrate|correlation|diagnose|score brier';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'model.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'score') {
      const metric = actionArgs[0];
      if (metric !== 'brier') {
        throw new CliError('INVALID_ARGS', INVALID_SUBCOMMAND_MESSAGE);
      }
    }

    const handler = getHandler(action);
    if (!handler) {
      throw new CliError('INVALID_ARGS', INVALID_SUBCOMMAND_MESSAGE);
    }

    if (action === 'score') {
      await handler({
        actionArgs: actionArgs.slice(1),
        context,
        deps,
      });
      return;
    }

    await handler({
      actionArgs,
      context,
      deps,
    });
  };
}

module.exports = {
  createRunModelCommand,
  INVALID_SUBCOMMAND_MESSAGE,
};
