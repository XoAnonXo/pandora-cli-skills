'use strict';

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunRecipeCommand requires deps.${name}()`);
  }
  return deps[name];
}

function renderRecipeTable(payload) {
  const items = Array.isArray(payload.items)
    ? payload.items
    : [payload.item || payload.summary || payload];
  for (const item of items) {
    if (!item) continue;
    // eslint-disable-next-line no-console
    console.log(
      `${item.id || '-'}  ${item.displayName || '-'}  ${item.source || '-'}  ${item.approvalStatus || '-'}  ${item.riskLevel || '-'}  ${item.tool || '-'}  ${item.defaultPolicy || '-'}  ${item.defaultProfile || '-'}`,
    );
  }
}

function createRunRecipeCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseRecipeFlags = requireDep(deps, 'parseRecipeFlags');
  const createRecipeRegistryService = requireDep(deps, 'createRecipeRegistryService');
  const createRecipeRuntimeService = requireDep(deps, 'createRecipeRuntimeService');
  const createCommandExecutorService = requireDep(deps, 'createCommandExecutorService');
  const createPolicyEvaluatorService = requireDep(deps, 'createPolicyEvaluatorService');
  const createProfileResolverService = requireDep(deps, 'createProfileResolverService');
  const buildCommandDescriptors = requireDep(deps, 'buildCommandDescriptors');

  function loadRecipe(options, registry) {
    if (options.file) {
      return registry.validateRecipeFile(options.file);
    }
    const recipeRecord = registry.getRecipe(options.id);
    if (!recipeRecord) {
      throw new CliError('RECIPE_NOT_FOUND', `Recipe not found: ${options.id}`, { id: options.id });
    }
    return recipeRecord;
  }

  return async function runRecipeCommand(args, context) {
    const action = args[0];
    const actionArgs = args.slice(1);

    if (!action || action === '--help' || action === '-h') {
      const usage = 'pandora [--output table|json] recipe list|get|validate|run [flags]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'recipe.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'list' && includesHelpFlag(actionArgs)) {
      const usage = 'pandora [--output table|json] recipe list [--source first-party|user|all] [--approval-status approved|unreviewed|experimental|deprecated|all] [--risk-level read-only|paper|dry-run|live|all]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'recipe.list.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'get' && includesHelpFlag(actionArgs)) {
      const usage = 'pandora [--output table|json] recipe get --id <recipe-id>|--file <path>';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'recipe.get.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'validate' && includesHelpFlag(actionArgs)) {
      const usage = 'pandora [--output table|json] recipe validate --id <recipe-id>|--file <path> [--policy-id <id>] [--profile-id <id>]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'recipe.validate.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'run' && includesHelpFlag(actionArgs)) {
      const usage = 'pandora [--output table|json] recipe run --id <recipe-id>|--file <path> [--set key=value] [--policy-id <id>] [--profile-id <id>] [--timeout-ms <ms>]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'recipe.run.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    const registry = createRecipeRegistryService();
    const options = parseRecipeFlags(args);

    if (options.action === 'list') {
      const listing = registry.listRecipes({
        source: options.source,
        approvalStatus: options.approvalStatus,
        riskLevel: options.riskLevel,
      });
      emitSuccess(context.outputMode, 'recipe.list', listing, renderRecipeTable);
      return;
    }

    const record = loadRecipe(options, registry);
    const recipe = record.recipe;

    if (options.action === 'get') {
      emitSuccess(context.outputMode, 'recipe.get', {
        item: record.summary || record.item,
        recipe,
        source: record.source || recipe.source || 'user',
        origin: record.origin || 'file',
        filePath: record.filePath || options.file || null,
      }, renderRecipeTable);
      return;
    }

    const runtime = createRecipeRuntimeService({
      commandDescriptors: buildCommandDescriptors(),
      commandExecutor: createCommandExecutorService(),
      policyEvaluator: createPolicyEvaluatorService(),
      profileResolver: createProfileResolverService(),
      remoteActive: process.env.PANDORA_MCP_REMOTE_ACTIVE === '1',
    });
    const compiled = runtime.compileRecipe(recipe, options.inputs, {
      source: record.source || recipe.source || 'user',
      origin: record.origin || (record.filePath ? 'file' : 'builtin'),
      filePath: record.filePath || options.file || null,
    });

    if (options.action === 'validate') {
      const validation = await runtime.validateRecipeExecution(compiled, {
        policyId: options.policyId,
        profileId: options.profileId,
      });
      emitSuccess(context.outputMode, 'recipe.validate', {
        ok: validation.ok,
        item: record.summary || record.item,
        compiledCommand: validation.commandArgs,
        inputs: validation.inputs,
        policyId: validation.policyId,
        profileId: validation.profileId,
        denials: validation.denials,
        warnings: validation.warnings,
        validation,
      }, renderRecipeTable);
      return;
    }

    if (options.action === 'run') {
      const result = await runtime.runRecipe(compiled, {
        policyId: options.policyId,
        profileId: options.profileId,
        timeoutMs: options.timeoutMs,
      });
      emitSuccess(context.outputMode, 'recipe.run', {
        ok: result.ok,
        item: record.summary || record.item,
        compiledCommand: result.compiledCommand,
        policyId: result.validation.policyId,
        profileId: result.validation.profileId,
        operationId: result.operationId,
        validation: result.validation,
        result: result.result,
        exitCode: result.exitCode,
      }, renderRecipeTable);
      return;
    }

    throw new CliError('INVALID_ARGS', `Unsupported recipe subcommand: ${options.action}`);
  };
}

module.exports = {
  createRunRecipeCommand,
};
