function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunOperationsCommand requires deps.${name}()`);
  }
  return deps[name];
}

function renderOperationTable(payload) {
  const items = Array.isArray(payload.items) ? payload.items : [payload];
  for (const item of items) {
    // eslint-disable-next-line no-console
    console.log(`${item.operationId}  ${item.status}  ${item.tool || '-'}  ${item.action || '-'}`);
  }
}

function createRunOperationsCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseOperationsFlags = requireDep(deps, 'parseOperationsFlags');
  const createOperationService = requireDep(deps, 'createOperationService');

  return async function runOperationsCommand(args, context) {
    const action = args[0];

    if (!action || action === '--help' || action === '-h') {
      const usage = 'pandora [--output table|json] operations get|list|cancel|close [flags]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'operations.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'get' && includesHelpFlag(args.slice(1))) {
      const usage = 'pandora [--output table|json] operations get --id <operation-id>';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'operations.get.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'list' && includesHelpFlag(args.slice(1))) {
      const usage = 'pandora [--output table|json] operations list [--status <csv>] [--tool <name>] [--limit <n>]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'operations.list.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'cancel' && includesHelpFlag(args.slice(1))) {
      const usage = 'pandora [--output table|json] operations cancel --id <operation-id> [--reason <text>]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'operations.cancel.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'close' && includesHelpFlag(args.slice(1))) {
      const usage = 'pandora [--output table|json] operations close --id <operation-id> [--reason <text>]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'operations.close.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    const service = createOperationService();
    const options = parseOperationsFlags(args, { CliError });

    if (options.action === 'get') {
      const record = await service.getOperation(options.id);
      if (!record) {
        throw new CliError('OPERATION_NOT_FOUND', `Operation not found: ${options.id}`, { operationId: options.id });
      }
      emitSuccess(context.outputMode, 'operations.get', record, renderOperationTable);
      return;
    }

    if (options.action === 'list') {
      const listing = await service.listOperations({
        statuses: options.statuses,
        tool: options.tool,
        limit: options.limit,
      });
      if (!listing || typeof listing !== 'object' || !Array.isArray(listing.items)) {
        throw new CliError('OPERATION_LIST_FAILED', 'Operation listing service returned an invalid payload.');
      }
      emitSuccess(context.outputMode, 'operations.list', listing, renderOperationTable);
      return;
    }

    if (options.action === 'cancel') {
      const record = await service.cancelOperation(options.id, options.reason);
      if (!record) {
        throw new CliError('OPERATION_NOT_FOUND', `Operation not found: ${options.id}`, { operationId: options.id });
      }
      emitSuccess(context.outputMode, 'operations.cancel', record, renderOperationTable);
      return;
    }

    if (options.action === 'close') {
      const record = await service.closeOperation(options.id, options.reason);
      if (!record) {
        throw new CliError('OPERATION_NOT_FOUND', `Operation not found: ${options.id}`, { operationId: options.id });
      }
      emitSuccess(context.outputMode, 'operations.close', record, renderOperationTable);
      return;
    }

    throw new CliError('INVALID_ARGS', `Unsupported operations subcommand: ${options.action}`);
  };
}

module.exports = {
  createRunOperationsCommand,
};
