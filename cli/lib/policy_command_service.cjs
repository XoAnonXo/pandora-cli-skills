'use strict';

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunPolicyCommand requires deps.${name}()`);
  }
  return deps[name];
}

function renderPolicyTable(payload) {
  const items = Array.isArray(payload.items) ? payload.items : [payload.item || payload];
  for (const item of items) {
    if (!item) continue;
    // eslint-disable-next-line no-console
    console.log(`${item.id}  ${item.displayName}  ${item.source || '-'}  ${item.description || ''}`);
  }
}

function createRunPolicyCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parsePolicyFlags = requireDep(deps, 'parsePolicyFlags');
  const createPolicyRegistryService = requireDep(deps, 'createPolicyRegistryService');

  return async function runPolicyCommand(args, context) {
    const action = args[0];
    const actionArgs = args.slice(1);

    if (!action || action === '--help' || action === '-h') {
      const usage = 'pandora [--output table|json] policy list|get|lint [flags]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'policy.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'list' && includesHelpFlag(actionArgs)) {
      const usage = 'pandora [--output table|json] policy list';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'policy.list.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'get' && includesHelpFlag(actionArgs)) {
      const usage = 'pandora [--output table|json] policy get --id <policy-id>';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'policy.get.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'lint' && includesHelpFlag(actionArgs)) {
      const usage = 'pandora [--output table|json] policy lint --file <path>';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'policy.lint.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    const service = createPolicyRegistryService();
    const options = parsePolicyFlags(args);

    if (options.action === 'list') {
      const listing = service.listPolicyPacks();
      emitSuccess(context.outputMode, 'policy.list', {
        policyDir: listing.dir,
        count: listing.items.length,
        builtinCount: listing.builtinCount,
        userCount: listing.storedCount,
        errors: listing.errors,
        items: listing.items,
      }, renderPolicyTable);
      return;
    }

    if (options.action === 'get') {
      const item = service.getPolicyPack(options.id, { compiled: true });
      if (!item) {
        throw new CliError('POLICY_NOT_FOUND', `Policy pack not found: ${options.id}`);
      }
      emitSuccess(context.outputMode, 'policy.get', { item }, renderPolicyTable);
      return;
    }

    if (options.action === 'lint') {
      const result = service.lintPolicyPackFile(options.file);
      emitSuccess(context.outputMode, 'policy.lint', result, renderPolicyTable);
      return;
    }

    throw new CliError('INVALID_ARGS', `Unsupported policy subcommand: ${options.action}`);
  };
}

module.exports = {
  createRunPolicyCommand,
};
