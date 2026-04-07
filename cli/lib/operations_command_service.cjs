const fs = require('fs');

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
    console.log(`${item.operationId}  ${item.status}  ${item.tool ?? '-'}  ${item.action ?? '-'}`);
  }
}

function renderReceiptTable(payload) {
  // eslint-disable-next-line no-console
  console.log(`${payload.operationId}  ${payload.status}  ${payload.tool ?? '-'}  ${payload.receiptHash ?? '-'}`);
}

function renderReceiptVerificationTable(payload) {
  const source = payload?.source?.value ?? '-';
  // eslint-disable-next-line no-console
  console.log(`${payload.ok ? 'ok' : 'invalid'}  ${payload.operationId || '-'}  ${source}  ${(payload.mismatches || []).length}`);
}

function readReceiptFromFile(filePath, CliError) {
  try {
    const document = fs.readFileSync(filePath, 'utf8');
    const payload = JSON.parse(document);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new CliError('INVALID_ARGS', 'Receipt file must contain a JSON object.', {
        file: filePath,
      });
    }
    return payload;
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (error && error.code === 'ENOENT') {
      throw new CliError('FILE_NOT_FOUND', `Receipt file not found: ${filePath}`, {
        file: filePath,
      });
    }
    throw new CliError('INVALID_ARGS', `Unable to read receipt file: ${filePath}`, {
      file: filePath,
      cause: error?.message ?? String(error),
    });
  }
}

function createRunOperationsCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseOperationsFlags = requireDep(deps, 'parseOperationsFlags');
  const createOperationService = requireDep(deps, 'createOperationService');

  function showActionHelp(eventName, usage, outputMode) {
    if (outputMode === 'json') {
      emitSuccess(outputMode, eventName, commandHelpPayload(usage));
    } else {
      // eslint-disable-next-line no-console
      console.log(`Usage: ${usage}`);
    }
  }

  const VALID_ACTIONS = new Set(['get', 'list', 'receipt', 'verify-receipt', 'cancel', 'close']);
const VALID_ACTIONS_DISPLAY = [...VALID_ACTIONS].join('|');

const ACTION_USAGE = Object.freeze({
  get: 'pandora [--output table|json] operations get --id <operation-id>',
  list: 'pandora [--output table|json] operations list [--status <csv>] [--tool <name>] [--limit <n>]',
  receipt: 'pandora [--output table|json] operations receipt --id <operation-id>',
  'verify-receipt': 'pandora [--output table|json] operations verify-receipt (--id <operation-id> | --file <path>) [--expected-operation-hash <hash>]',
  cancel: 'pandora [--output table|json] operations cancel --id <operation-id> [--reason <text>]',
  close: 'pandora [--output table|json] operations close --id <operation-id> [--reason <text>]',
});

  return async function runOperationsCommand(args, context) {
    const action = args[0];

    if (!action || action === '--help' || action === '-h') {
      showActionHelp('operations.help', 'pandora [--output table|json] operations ' + VALID_ACTIONS_DISPLAY + ' [--actor <id>]', context.outputMode);
      return;
    }

    if (!VALID_ACTIONS.has(action)) {
      throw new CliError('INVALID_ARGS', `Unknown operations subcommand: ${action}. Valid: ${VALID_ACTIONS_DISPLAY}. Run pandora operations --help for usage.`);
    }

    if (includesHelpFlag(args.slice(1))) {
      showActionHelp(`operations.${action}.help`, ACTION_USAGE[action], context.outputMode);
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

    if (options.action === 'receipt') {
      const receipt = await service.getReceipt(options.id);
      emitSuccess(context.outputMode, 'operations.receipt', receipt, renderReceiptTable);
      return;
    }

    if (options.action === 'verify-receipt') {
      const receipt = options.file
        ? readReceiptFromFile(options.file, CliError)
        : await service.getReceipt(options.id);
      const verification = await service.verifyReceipt(receipt, {
        ...(options.expectedOperationHash ? { expectedOperationHash: options.expectedOperationHash } : {}),
      });
      emitSuccess(
        context.outputMode,
        'operations.verify-receipt',
        {
          ok: Boolean(verification && verification.ok),
          code: verification && Object.prototype.hasOwnProperty.call(verification, 'code') ? verification.code : null,
          operationId: receipt && receipt.operationId ? receipt.operationId : null,
          operationHash: receipt && receipt.operationHash ? receipt.operationHash : null,
          expectedOperationHash: options.expectedOperationHash || null,
          receiptHash: verification && verification.receiptHash ? verification.receiptHash : (receipt && receipt.receiptHash ? receipt.receiptHash : null),
          signatureValid: Boolean(verification && verification.signatureValid),
          signatureAlgorithm: verification && Object.prototype.hasOwnProperty.call(verification, 'signatureAlgorithm') ? verification.signatureAlgorithm : (receipt && receipt.verification ? receipt.verification.signatureAlgorithm || null : null),
          publicKeyFingerprint: verification && Object.prototype.hasOwnProperty.call(verification, 'publicKeyFingerprint') ? verification.publicKeyFingerprint : (receipt && receipt.verification ? receipt.verification.publicKeyFingerprint || null : null),
          keyId: verification && Object.prototype.hasOwnProperty.call(verification, 'keyId') ? verification.keyId : (receipt && receipt.verification ? receipt.verification.keyId || null : null),
          mismatches: Array.isArray(verification && verification.mismatches) ? verification.mismatches : [],
          source: {
            type: options.file ? 'file' : 'operation-id',
            value: options.file || options.id,
          },
          schemaVersion: '1.0.0',
          generatedAt: new Date().toISOString(),
        },
        renderReceiptVerificationTable,
      );
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
