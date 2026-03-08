'use strict';

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeModeFromArgs(commandArgs) {
  const args = Array.isArray(commandArgs) ? commandArgs : [];
  if (args.includes('--execute-live')) return 'execute-live';
  if (args.includes('--execute')) return 'execute';
  if (args.includes('--paper')) return 'paper';
  if (args.includes('--dry-run')) return 'dry-run';
  if (args.includes('--fork')) return 'fork';
  return null;
}

function resolveDelegatedCommand(commandArgs) {
  const args = Array.isArray(commandArgs) ? commandArgs : [];
  const commandTokens = [];
  for (const token of args) {
    const text = normalizeText(token);
    if (!text) continue;
    if (text.startsWith('--')) break;
    commandTokens.push(text);
  }
  return commandTokens.length ? commandTokens.join('.') : null;
}

function hasFlag(commandArgs, flagName) {
  const args = Array.isArray(commandArgs) ? commandArgs : [];
  return args.includes(flagName);
}

function parseGrantedScopesFromEnv(env = process.env) {
  const rawValue = env && typeof env.PANDORA_MCP_GRANTED_SCOPES === 'string'
    ? env.PANDORA_MCP_GRANTED_SCOPES.trim()
    : '';
  if (!rawValue) return [];
  return Array.from(new Set(rawValue.split(',').map((scope) => String(scope || '').trim()).filter(Boolean))).sort();
}

function scopeMatches(requiredScope, grantedScopes) {
  if (!requiredScope) return true;
  const granted = Array.isArray(grantedScopes) ? grantedScopes : [];
  if (granted.includes('*')) return true;
  if (granted.includes(requiredScope)) return true;
  const [namespace] = String(requiredScope).split(':');
  return granted.includes(`${namespace}:*`);
}

function injectSelectorArgs(commandArgs, overrides = {}) {
  const args = Array.isArray(commandArgs) ? [...commandArgs] : [];
  const policyId = normalizeText(overrides.policyId);
  const profileId = normalizeText(overrides.profileId);
  if (policyId && !hasFlag(args, '--policy-id')) {
    args.push('--policy-id', policyId);
  }
  if (profileId && !hasFlag(args, '--profile-id')) {
    args.push('--profile-id', profileId);
  }
  return args;
}

function createRecipeRuntimeService(options = {}) {
  const commandDescriptors = options.commandDescriptors || {};
  const commandExecutor = options.commandExecutor;
  const policyEvaluator = options.policyEvaluator;
  const profileResolver = options.profileResolver;
  const remoteActive = options.remoteActive === true;

  if (!commandExecutor || typeof commandExecutor.executeJsonCommand !== 'function') {
    throw new Error('createRecipeRuntimeService requires commandExecutor.executeJsonCommand().');
  }
  if (!policyEvaluator || typeof policyEvaluator.evaluateExecution !== 'function') {
    throw new Error('createRecipeRuntimeService requires policyEvaluator.evaluateExecution().');
  }
  if (!profileResolver || typeof profileResolver.probeProfile !== 'function') {
    throw new Error('createRecipeRuntimeService requires profileResolver.probeProfile().');
  }

  function parseInputValue(type, rawValue, key) {
    if (type === 'string') return String(rawValue);
    if (type === 'boolean') {
      if (rawValue === true || rawValue === 'true') return true;
      if (rawValue === false || rawValue === 'false') return false;
      throw new Error(`Input ${key} must be boolean.`);
    }
    if (type === 'integer') {
      const parsed = Number(rawValue);
      if (!Number.isInteger(parsed)) throw new Error(`Input ${key} must be an integer.`);
      return parsed;
    }
    if (type === 'number') {
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed)) throw new Error(`Input ${key} must be a number.`);
      return parsed;
    }
    return rawValue;
  }

  function normalizeInputs(recipe, providedInputs = {}) {
    const normalized = {};
    for (const input of recipe.inputs) {
      const hasValue = Object.prototype.hasOwnProperty.call(providedInputs, input.key);
      if (!hasValue && input.defaultValue !== null && input.defaultValue !== undefined) {
        normalized[input.key] = input.defaultValue;
        continue;
      }
      if (!hasValue) {
        if (input.required) {
          const error = new Error(`Missing required recipe input: ${input.key}`);
          error.code = 'RECIPE_INPUT_REQUIRED';
          error.details = { key: input.key };
          throw error;
        }
        continue;
      }
      normalized[input.key] = parseInputValue(input.type, providedInputs[input.key], input.key);
    }
    for (const key of Object.keys(providedInputs || {})) {
      if (!recipe.inputs.some((input) => input.key === key)) {
        const error = new Error(`Unknown recipe input: ${key}`);
        error.code = 'RECIPE_INPUT_UNKNOWN';
        error.details = { key };
        throw error;
      }
    }
    return normalized;
  }

  function renderToken(token, inputs) {
    return String(token).replace(/\{\{\s*([a-z0-9-]+)\s*\}\}/gi, (match, key) => {
      const normalizedKey = String(key).trim().toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(inputs, normalizedKey)) {
        const error = new Error(`Missing recipe input for token ${match}`);
        error.code = 'RECIPE_INPUT_REQUIRED';
        error.details = { key: normalizedKey };
        throw error;
      }
      return String(inputs[normalizedKey]);
    });
  }

  function compileRecipe(recipe, providedInputs = {}, metadata = {}) {
    const inputs = normalizeInputs(recipe, providedInputs);
    const commandArgs = recipe.commandTemplate
      .map((token) => renderToken(token, inputs))
      .filter((token) => token !== '');
    const resolvedCommand = resolveDelegatedCommand(commandArgs) || recipe.tool;
    const descriptor = commandDescriptors[resolvedCommand] || null;
    return {
      recipe,
      inputs,
      commandArgs,
      descriptor,
      command: resolvedCommand,
      declaredCommand: recipe.tool,
      policyId: recipe.defaultPolicy || null,
      profileId: recipe.defaultProfile || null,
      source: metadata.source || (recipe.firstParty ? 'builtin' : 'file'),
      filePath: metadata.filePath || null,
    };
  }

  function buildPolicyRequest(compiled, overrides = {}) {
    const descriptor = compiled.descriptor || {};
    const flags = {};
    for (let index = 0; index < compiled.commandArgs.length; index += 1) {
      const token = compiled.commandArgs[index];
      if (!String(token).startsWith('--')) continue;
      const next = compiled.commandArgs[index + 1];
      if (!next || String(next).startsWith('--')) {
        flags[token.replace(/^--/, '')] = true;
        continue;
      }
      flags[token.replace(/^--/, '')] = next;
      index += 1;
    }
    const mode = normalizeModeFromArgs(compiled.commandArgs);
    return {
      command: compiled.command,
      arguments: flags,
      policyId: overrides.policyId || compiled.policyId || null,
      profileId: overrides.profileId || compiled.profileId || null,
      mode,
      mutating: Boolean(compiled.recipe.mutating || descriptor.mcpMutating || mode === 'execute' || mode === 'execute-live'),
      liveRequested: mode === 'execute' || mode === 'execute-live',
      requiresSecrets: Boolean(descriptor.requiresSecrets),
      policyScopes: Array.isArray(descriptor.policyScopes) ? descriptor.policyScopes : [],
      riskLevel: descriptor.riskLevel || null,
      externalDependencies: Array.isArray(descriptor.externalDependencies) ? descriptor.externalDependencies : [],
      recommendedPreflightTool: descriptor.recommendedPreflightTool || null,
      safeEquivalent: descriptor.safeEquivalent || null,
      category: Object.prototype.hasOwnProperty.call(flags, 'category') ? flags.category : null,
      chainId: Object.prototype.hasOwnProperty.call(flags, 'chain-id') ? flags['chain-id'] : null,
    };
  }

  async function validateRecipeExecution(compiled, overrides = {}) {
    const request = buildPolicyRequest(compiled, overrides);
    const denials = [];
    const warnings = [];
    const profileId = overrides.profileId || compiled.profileId || null;

    if (!compiled.descriptor) {
      denials.push({
        code: 'RECIPE_COMMAND_UNSUPPORTED',
        message: `Recipe delegated command is not a supported Pandora command: ${compiled.command || '<empty>'}.`,
        command: compiled.command || null,
        declaredCommand: compiled.declaredCommand || null,
      });
    }

    if (compiled.command !== compiled.declaredCommand) {
      denials.push({
        code: 'RECIPE_COMMAND_MISMATCH',
        message: `Recipe declared tool ${compiled.declaredCommand} does not match delegated command ${compiled.command}.`,
        command: compiled.command,
        declaredCommand: compiled.declaredCommand,
      });
    }

    if (remoteActive && compiled.recipe.supportsRemote === false) {
      denials.push({
        code: 'RECIPE_REMOTE_EXECUTION_DENIED',
        message: `Recipe ${compiled.recipe.id} is not eligible for remote execution.`,
        recipeId: compiled.recipe.id,
        command: compiled.command,
      });
    }

    if (remoteActive && compiled.descriptor && compiled.descriptor.mcpLongRunningBlocked) {
      denials.push({
        code: 'RECIPE_REMOTE_LONG_RUNNING_DENIED',
        message: `Recipe ${compiled.recipe.id} delegates to ${compiled.command}, which is blocked for remote/agent execution because it is long-running.`,
        recipeId: compiled.recipe.id,
        command: compiled.command,
      });
    }

    if (remoteActive && compiled.descriptor && compiled.descriptor.mcpExposed !== true) {
      denials.push({
        code: 'RECIPE_REMOTE_MCP_EXPOSURE_REQUIRED',
        message: `Recipe ${compiled.recipe.id} delegates to ${compiled.command}, which is not exposed as an MCP/agent tool.`,
        recipeId: compiled.recipe.id,
        command: compiled.command,
      });
    }

    if (remoteActive && compiled.descriptor && compiled.descriptor.remoteEligible !== true) {
      denials.push({
        code: 'RECIPE_REMOTE_TOOL_NOT_ELIGIBLE',
        message: `Recipe ${compiled.recipe.id} delegates to ${compiled.command}, which is not eligible for remote execution.`,
        recipeId: compiled.recipe.id,
        command: compiled.command,
      });
    }

    const externalRecipeUnsafe =
      compiled.source === 'file'
      && (request.mutating || request.liveRequested || request.requiresSecrets);
    if (externalRecipeUnsafe) {
      denials.push({
        code: 'RECIPE_FILE_MUTATION_DENIED',
        message: 'External recipe files may only run known read-only delegated commands. Use a built-in recipe or run the underlying command directly with policy/profile controls.',
        command: compiled.command,
        source: compiled.source,
      });
    }

    if (remoteActive) {
      const grantedScopes = parseGrantedScopesFromEnv(process.env);
      const delegatedScopes = Array.isArray(compiled.descriptor && compiled.descriptor.policyScopes)
        ? compiled.descriptor.policyScopes
        : [];
      const missingDelegatedScopes = delegatedScopes.filter((scope) => !scopeMatches(scope, grantedScopes));
      if (missingDelegatedScopes.length) {
        denials.push({
          code: 'RECIPE_REMOTE_SCOPE_DENIED',
          message: `Recipe ${compiled.recipe.id} delegates to ${compiled.command}, which requires scopes not granted to the current remote principal.`,
          recipeId: compiled.recipe.id,
          command: compiled.command,
          missingScopes: missingDelegatedScopes,
          grantedScopes,
        });
      }
    }

    const policyEvaluation = request.policyId ? policyEvaluator.evaluateExecution(request) : {
      ok: true,
      decision: 'allow',
      policyId: null,
      denials: [],
      warnings: [],
      safeEquivalent: null,
      recommendedNextTool: null,
    };

    const safeExecutionMode = request.mode === 'dry-run' || request.mode === 'paper' || request.mode === 'fork';
    const writeExecutionMode = request.mode === 'execute' || request.mode === 'execute-live';
    const profileRequired = Boolean(
      writeExecutionMode
      || (!safeExecutionMode && (
        request.liveRequested
        || request.mutating
        || request.requiresSecrets
        || (compiled.descriptor && compiled.descriptor.signerProfileEligible)
      )),
    );
    let profileResolution = null;
    let profileCompatibility = null;

    if (!profileId && profileRequired) {
      denials.push({
        code: 'RECIPE_PROFILE_REQUIRED',
        message: `Recipe command ${compiled.command} requires a signer profile for execution.`,
        command: compiled.command,
      });
    } else if (profileId) {
      try {
        profileResolution = await profileResolver.probeProfile({
          profileId,
          policyId: overrides.policyId || compiled.policyId || null,
          command: compiled.command,
          mode: request.mode,
          liveRequested: request.liveRequested,
          mutating: request.mutating,
          category: request.category,
          chainId: request.chainId,
        });
        profileCompatibility = profileResolution ? profileResolution.compatibility : null;
        if (profileResolution && profileResolution.resolution && profileResolution.resolution.ready !== true) {
          denials.push({
            code: 'RECIPE_PROFILE_NOT_READY',
            message: `Signer profile ${profileId} is not ready for recipe execution.`,
            profileId,
            missing: Array.isArray(profileResolution.resolution.missing) ? profileResolution.resolution.missing : [],
          });
        }
      } catch (error) {
        denials.push({
          code: error && error.code ? error.code : 'PROFILE_RESOLUTION_FAILED',
          message: error && error.message ? error.message : 'Profile resolution failed.',
          details: error && error.details ? error.details : null,
        });
      }
    }

    return {
      ok: Boolean(policyEvaluation.ok)
        && (!profileCompatibility || profileCompatibility.ok)
        && denials.length === 0,
      recipeId: compiled.recipe.id,
      command: compiled.command,
      commandArgs: compiled.commandArgs,
      inputs: compiled.inputs,
      policyId: overrides.policyId || compiled.policyId || null,
      profileId,
      policyEvaluation,
      profileResolution,
      profileCompatibility,
      warnings: [
        ...warnings,
        ...(Array.isArray(policyEvaluation.warnings) ? policyEvaluation.warnings : []),
      ],
      denials: [
        ...denials,
        ...(Array.isArray(policyEvaluation.denials) ? policyEvaluation.denials : []),
        ...(!profileCompatibility || profileCompatibility.ok ? [] : (profileCompatibility.violations || [])),
      ],
    };
  }

  function extractOperationId(envelope) {
    if (!envelope || typeof envelope !== 'object') return null;
    if (envelope.operationId) return envelope.operationId;
    if (envelope.data && typeof envelope.data === 'object') {
      if (typeof envelope.data.operationId === 'string') return envelope.data.operationId;
      if (envelope.data.operation && envelope.data.operation.operationId) return envelope.data.operation.operationId;
    }
    return null;
  }

  async function runRecipe(compiled, overrides = {}) {
    const validation = await validateRecipeExecution(compiled, overrides);
    if (!validation.ok) {
      return {
        ok: false,
        recipeId: compiled.recipe.id,
        compiledCommand: injectSelectorArgs(compiled.commandArgs, overrides),
        validation,
        operationId: null,
        result: null,
      };
    }

    const delegatedArgs = injectSelectorArgs(compiled.commandArgs, overrides);
    const execution = commandExecutor.executeJsonCommand(delegatedArgs, {
      timeoutMs: overrides.timeoutMs,
    });

    return {
      ok: execution.ok,
      recipeId: compiled.recipe.id,
      compiledCommand: delegatedArgs,
      validation,
      operationId: extractOperationId(execution.envelope),
      result: execution.envelope,
      exitCode: execution.exitCode,
    };
  }

  return {
    compileRecipe,
    validateRecipeExecution,
    runRecipe,
  };
}

module.exports = {
  createRecipeRuntimeService,
};
