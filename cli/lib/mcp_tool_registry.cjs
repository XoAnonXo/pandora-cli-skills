/**
 * @typedef {string|number|boolean|null|undefined|Array<string|number|boolean>} FlagInputValue
 */

const { buildCommandDescriptors, buildMcpToolDefinitions } = require('./agent_contract_registry.cjs');

/**
 * @typedef {{[flagName: string]: FlagInputValue}} ToolFlags
 */

/**
 * @typedef {{
 *   name: string,
 *   command: string[],
 *   description: string,
 *   mutating?: boolean,
 *   safeFlags?: string[],
 *   executeFlags?: string[],
 *   longRunningBlocked?: boolean,
 *   placeholderBlocked?: boolean,
 *   controlInputNames?: string[],
 *   agentWorkflow?: {
 *     requiredTools?: string[],
 *     recommendedTools?: string[],
 *     executeRequiresValidation?: boolean,
 *     notes?: string[],
 *   },
 * }} ToolDefinition
 */

/**
 * @typedef {{
 *   positionals?: Array<string|number|boolean>,
 *   flags?: ToolFlags,
 *   intent?: { execute?: boolean },
 *   [key: string]: unknown
 * }} ToolInvocationArgs
 */

function createInvocationError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function legacyNestedFlagsAllowed() {
  return process.env.PANDORA_MCP_ALLOW_LEGACY_FLAGS === '1';
}

function compatibilityAliasDebugModeEnabled(options = {}) {
  if (Boolean(options && options.compatibilityAliasDebugMode)) return true;
  return process.env.PANDORA_MCP_INCLUDE_COMPATIBILITY_ALIASES === '1'
    || process.env.PANDORA_MCP_DEBUG_COMPATIBILITY_ALIASES === '1';
}

function compareStableStrings(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isCompatibilityAliasDefinition(definition) {
  return Boolean(definition && (definition.compatibilityAlias || definition.aliasOf));
}

function compareToolDefinitions(left, right) {
  const leftCompatibility = isCompatibilityAliasDefinition(left);
  const rightCompatibility = isCompatibilityAliasDefinition(right);
  if (leftCompatibility !== rightCompatibility) {
    return leftCompatibility ? 1 : -1;
  }

  const leftPreferred = left && left.preferred !== false;
  const rightPreferred = right && right.preferred !== false;
  if (leftPreferred !== rightPreferred) {
    return leftPreferred ? -1 : 1;
  }

  return compareStableStrings(left && left.name, right && right.name);
}

function sortToolDefinitions(definitions) {
  return (Array.isArray(definitions) ? definitions : []).slice().sort(compareToolDefinitions);
}

/**
 * Normalize a flag token to a CLI-prefixed name.
 * Leaves existing `--foo`/`-f` tokens unchanged and prefixes bare names.
 *
 * @param {string} name Raw flag key.
 * @returns {string} Normalized CLI flag token or empty string.
 */
function normalizeFlagName(name) {
  const normalized = String(name || '').trim();
  if (!normalized) return '';
  if (normalized.startsWith('--')) return normalized;
  if (normalized.startsWith('-')) return normalized;
  return `--${normalized}`;
}

/**
 * Convert a flag value (including nested arrays) into scalar CLI values.
 * Booleans are preserved so callers can emit bare switch flags.
 *
 * @param {FlagInputValue} value Flag value candidate.
 * @returns {Array<string|boolean>} Flattened scalar values.
 */
function flagValueToStrings(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => flagValueToStrings(item));
  }
  if (typeof value === 'boolean') {
    return [value];
  }
  return [String(value)];
}

/**
 * Build argv segments from a JSON-style flags map.
 * Truthy booleans produce bare switch flags; scalar values produce pairs.
 *
 * @param {ToolFlags} flags Flag map where keys may be with/without `--`.
 * @returns {string[]} CLI argv segment for flags.
 */
function buildFlagArgv(flags) {
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) return [];
  const argv = [];
  for (const [rawName, rawValue] of Object.entries(flags)) {
    const name = normalizeFlagName(rawName);
    if (!name) continue;
    const values = flagValueToStrings(rawValue);
    if (!values.length) continue;

    for (const value of values) {
      if (typeof value === 'boolean') {
        if (value) argv.push(name);
      } else {
        argv.push(name, value);
      }
    }
  }
  return argv;
}

/**
 * Collect normalized flags that are meaningfully provided by the caller.
 * Used by execution guardrails to detect safe/live mode intent flags.
 *
 * @param {ToolFlags} flags Candidate flags object.
 * @returns {Set<string>} Set of normalized provided flag names.
 */
function providedFlagSet(flags) {
  const set = new Set();
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) return set;

  for (const [rawName, rawValue] of Object.entries(flags)) {
    const name = normalizeFlagName(rawName);
    if (!name) continue;
    if (rawValue === null || rawValue === undefined) continue;
    if (typeof rawValue === 'boolean' && !rawValue) continue;
    if (Array.isArray(rawValue) && rawValue.length === 0) continue;
    set.add(name);
  }

  return set;
}

/**
 * Return the top-level MCP input keys that map to CLI flags for a definition.
 *
 * @param {ToolDefinition & {inputSchema?: object}} definition
 * @returns {string[]}
 */
function getTopLevelFlagNames(definition) {
  const properties = definition && definition.inputSchema && definition.inputSchema.properties;
  if (!properties || typeof properties !== 'object') return [];
  const controlInputNames = Array.isArray(definition && definition.controlInputNames)
    ? definition.controlInputNames
    : [];
  return Object.keys(properties).filter((name) => name !== 'intent' && !controlInputNames.includes(name));
}

/**
 * Return top-level MCP input keys that should be consumed as control metadata,
 * not rendered into CLI argv flags.
 *
 * @param {ToolDefinition & {inputSchema?: object}} definition
 * @returns {string[]}
 */
function getControlInputNames(definition) {
  return Array.isArray(definition && definition.controlInputNames)
    ? definition.controlInputNames
    : [];
}

function getAllowedTopLevelInputNames(definition) {
  return new Set([
    ...getTopLevelFlagNames(definition),
    ...getControlInputNames(definition),
    'intent',
    'flags',
    'positionals',
  ]);
}

function normalizeLegacyFlagKey(name) {
  const normalized = normalizeFlagName(name);
  if (!normalized) return '';
  return normalized.replace(/^--/, '');
}

function listUnknownTopLevelInputs(definition, args) {
  const allowed = getAllowedTopLevelInputNames(definition);
  return Object.keys(args || {}).filter((name) => !allowed.has(name));
}

function listUnknownLegacyFlagInputs(definition, flags) {
  const allowed = new Set(getTopLevelFlagNames(definition));
  return Object.keys(flags || {}).filter((name) => !allowed.has(normalizeLegacyFlagKey(name)));
}

function hasMeaningfulValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function hasProvidedInput(args, name) {
  if (!args || typeof args !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(args, name) && hasMeaningfulValue(args[name])) {
    return true;
  }
  const flags = args.flags;
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) return false;
  for (const [rawName, rawValue] of Object.entries(flags)) {
    if (normalizeLegacyFlagKey(rawName) === name && hasMeaningfulValue(rawValue)) {
      return true;
    }
  }
  return false;
}

function formatValidationPath(path) {
  return path && path.length ? path.join('.') : 'arguments';
}

function buildSchemaValidationError(toolName, path, reason, details = undefined) {
  return createInvocationError(
    'MCP_INVALID_ARGUMENTS',
    `${toolName}: ${formatValidationPath(path)} ${reason}`,
    {
      toolName,
      path: formatValidationPath(path),
      ...(details && typeof details === 'object' ? details : {}),
    },
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function schemaMatchesValue(toolName, schema, value, path) {
  try {
    validateSchemaValue(toolName, schema, value, path);
    return true;
  } catch {
    return false;
  }
}

function validateSchemaValue(toolName, schema, value, path = []) {
  if (!schema || typeof schema !== 'object') {
    return;
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length) {
    const anyOfMatch = schema.anyOf.some((branch) => schemaMatchesValue(toolName, branch, value, path));
    if (!anyOfMatch) {
      throw buildSchemaValidationError(toolName, path, 'does not satisfy any supported input shape.');
    }
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length) {
    const oneOfMatches = schema.oneOf.filter((branch) => schemaMatchesValue(toolName, branch, value, path)).length;
    if (oneOfMatches !== 1) {
      throw buildSchemaValidationError(
        toolName,
        path,
        oneOfMatches === 0
          ? 'does not satisfy any required exclusive argument combination.'
          : 'matches multiple mutually-exclusive argument combinations.',
      );
    }
  }

  if (schema.not && schemaMatchesValue(toolName, schema.not, value, path)) {
    throw buildSchemaValidationError(toolName, path, 'violates a forbidden argument combination.');
  }

  if (Array.isArray(schema.required) && schema.required.length) {
    if (!isPlainObject(value)) {
      throw buildSchemaValidationError(toolName, path, 'must be an object.');
    }
    const missing = schema.required.filter((name) => !hasMeaningfulValue(value[name]));
    if (missing.length) {
      throw buildSchemaValidationError(toolName, path, `is missing required fields: ${missing.join(', ')}`, {
        missingArguments: missing,
      });
    }
  }

  if (Array.isArray(schema.enum) && schema.enum.length) {
    const matched = schema.enum.some((candidate) => candidate === value);
    if (!matched) {
      throw buildSchemaValidationError(toolName, path, `must be one of: ${schema.enum.join(', ')}`);
    }
  }

  if (schema.type) {
    switch (schema.type) {
      case 'string':
        if (typeof value !== 'string') {
          throw buildSchemaValidationError(toolName, path, 'must be a string.');
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          throw buildSchemaValidationError(toolName, path, 'must be a boolean.');
        }
        break;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw buildSchemaValidationError(toolName, path, 'must be a finite number.');
        }
        break;
      case 'integer':
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          throw buildSchemaValidationError(toolName, path, 'must be an integer.');
        }
        break;
      case 'array':
        if (!Array.isArray(value)) {
          throw buildSchemaValidationError(toolName, path, 'must be an array.');
        }
        break;
      case 'object':
        if (!isPlainObject(value)) {
          throw buildSchemaValidationError(toolName, path, 'must be an object.');
        }
        break;
      default:
        break;
    }
  }

  if (typeof schema.minimum === 'number') {
    if (typeof value !== 'number' || value < schema.minimum) {
      throw buildSchemaValidationError(toolName, path, `must be >= ${schema.minimum}.`);
    }
  }

  if (typeof schema.maximum === 'number') {
    if (typeof value !== 'number' || value > schema.maximum) {
      throw buildSchemaValidationError(toolName, path, `must be <= ${schema.maximum}.`);
    }
  }

  if (schema.pattern) {
    if (typeof value !== 'string') {
      throw buildSchemaValidationError(toolName, path, 'must be a string matching the required pattern.');
    }
    const regex = new RegExp(schema.pattern);
    if (!regex.test(value)) {
      throw buildSchemaValidationError(toolName, path, 'does not match the required format.');
    }
  }

  if (schema.type === 'array' && schema.items) {
    value.forEach((item, index) => {
      validateSchemaValue(toolName, schema.items, item, [...path, String(index)]);
    });
  }

  if (isPlainObject(value)) {
    const properties = isPlainObject(schema.properties) ? schema.properties : null;
    if (schema.additionalProperties === false && properties) {
      const unknownKeys = Object.keys(value).filter((key) => !Object.prototype.hasOwnProperty.call(properties, key));
      if (unknownKeys.length) {
        throw buildSchemaValidationError(toolName, path, `contains unknown fields: ${unknownKeys.join(', ')}`, {
          unknownArguments: unknownKeys,
        });
      }
    }

    if (properties) {
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined) {
          validateSchemaValue(toolName, propertySchema, value[key], [...path, key]);
        }
      }
    }
  }
}

function buildNormalizedSchemaArgs(definition, args) {
  const normalized = {};
  const legacyFlags = legacyNestedFlagsAllowed()
    && args
    && args.flags
    && typeof args.flags === 'object'
    && !Array.isArray(args.flags)
    ? args.flags
    : null;

  for (const flagName of getTopLevelFlagNames(definition)) {
    let value;
    let hasValue = false;
    if (Object.prototype.hasOwnProperty.call(args, flagName) && args[flagName] !== undefined) {
      value = args[flagName];
      hasValue = true;
    } else if (legacyFlags) {
      for (const [rawName, rawValue] of Object.entries(legacyFlags)) {
        if (normalizeLegacyFlagKey(rawName) === flagName && rawValue !== undefined) {
          value = rawValue;
          hasValue = true;
          break;
        }
      }
    }
    if (hasValue) {
      normalized[flagName] = value;
    }
  }

  for (const inputName of getControlInputNames(definition)) {
    if (Object.prototype.hasOwnProperty.call(args, inputName) && args[inputName] !== undefined) {
      normalized[inputName] = args[inputName];
    }
  }

  if (Object.prototype.hasOwnProperty.call(args, 'intent') && args.intent !== undefined) {
    normalized.intent = args.intent;
  }

  return normalized;
}

function validateInvocationArgs(definition, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw createInvocationError('MCP_INVALID_ARGUMENTS', 'Tool arguments must be a JSON object.');
  }

  const unknownTopLevelInputs = listUnknownTopLevelInputs(definition, args);
  if (unknownTopLevelInputs.length) {
    throw createInvocationError(
      'MCP_UNKNOWN_ARGUMENTS',
      `Unknown MCP arguments for ${definition.name}: ${unknownTopLevelInputs.join(', ')}`,
      {
        toolName: definition.name,
        unknownArguments: unknownTopLevelInputs,
        allowedArguments: Array.from(getAllowedTopLevelInputNames(definition)).sort(),
      },
    );
  }

  if (Object.prototype.hasOwnProperty.call(args, 'positionals')) {
    const positionals = args.positionals;
    if (!Array.isArray(positionals)) {
      throw createInvocationError('MCP_INVALID_ARGUMENTS', 'positionals must be an array when provided.');
    }
    if (positionals.length) {
      throw createInvocationError(
        'MCP_POSITIONALS_NOT_SUPPORTED',
        `${definition.name} does not accept positional MCP arguments. Use named top-level tool inputs only.`,
        {
          toolName: definition.name,
          positionals,
        },
      );
    }
  }

  if (Object.prototype.hasOwnProperty.call(args, 'flags')) {
    if (!legacyNestedFlagsAllowed()) {
      throw createInvocationError(
        'MCP_LEGACY_FLAGS_UNSUPPORTED',
        `${definition.name} no longer accepts nested flags. Use the typed top-level MCP inputs from the published inputSchema.`,
        {
          toolName: definition.name,
          allowedArguments: getTopLevelFlagNames(definition).sort(),
        },
      );
    }
    const flags = args.flags;
    if (!flags || typeof flags !== 'object' || Array.isArray(flags)) {
      throw createInvocationError('MCP_INVALID_ARGUMENTS', 'flags must be an object when provided.');
    }
    const unknownLegacyFlags = listUnknownLegacyFlagInputs(definition, flags);
    if (unknownLegacyFlags.length) {
      throw createInvocationError(
        'MCP_UNKNOWN_ARGUMENTS',
        `Unknown legacy MCP flags for ${definition.name}: ${unknownLegacyFlags.join(', ')}`,
        {
          toolName: definition.name,
          unknownArguments: unknownLegacyFlags,
          allowedArguments: getTopLevelFlagNames(definition).sort(),
        },
      );
    }
  }

  if (Object.prototype.hasOwnProperty.call(args, 'intent')) {
    const intent = args.intent;
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
      throw createInvocationError('MCP_INVALID_ARGUMENTS', 'intent must be an object when provided.');
    }
    if (
      Object.prototype.hasOwnProperty.call(intent, 'execute')
      && intent.execute !== undefined
      && typeof intent.execute !== 'boolean'
    ) {
      throw createInvocationError('MCP_INVALID_ARGUMENTS', 'intent.execute must be a boolean when provided.');
    }
  }

  const schema = definition && definition.inputSchema && typeof definition.inputSchema === 'object'
    ? definition.inputSchema
    : null;
  if (!schema) return;

  const normalizedArgs = buildNormalizedSchemaArgs(definition, args);
  validateSchemaValue(definition.name, schema, normalizedArgs, []);
}

/**
 * Merge supported top-level MCP input fields with legacy `flags` payloads.
 * Top-level fields win so the typed schema is authoritative, but the older
 * nested `flags` shape remains accepted for backward compatibility.
 *
 * @param {ToolDefinition & {inputSchema?: object}} definition
 * @param {ToolInvocationArgs} args
 * @returns {ToolFlags}
 */
function extractInvocationFlags(definition, args) {
  const merged = {};
  const legacyFlags = legacyNestedFlagsAllowed()
    && args
    && args.flags
    && typeof args.flags === 'object'
    && !Array.isArray(args.flags)
    ? args.flags
    : null;

  if (legacyFlags) {
    Object.assign(merged, legacyFlags);
  }

  for (const flagName of getTopLevelFlagNames(definition)) {
    if (Object.prototype.hasOwnProperty.call(args, flagName) && args[flagName] !== undefined) {
      merged[flagName] = args[flagName];
    }
  }

  return merged;
}

/**
 * Extract control-only invocation inputs that should not become CLI flags.
 *
 * @param {ToolDefinition & {inputSchema?: object}} definition
 * @param {ToolInvocationArgs} args
 * @returns {{[key: string]: unknown}}
 */
function extractControlInputs(definition, args) {
  const controlInputs = {};
  for (const inputName of getControlInputNames(definition)) {
    if (Object.prototype.hasOwnProperty.call(args, inputName) && args[inputName] !== undefined) {
      controlInputs[inputName] = args[inputName];
    }
  }
  return controlInputs;
}

function buildInvocationEnv(controlInputs) {
  const env = {};
  if (
    controlInputs
    && Object.prototype.hasOwnProperty.call(controlInputs, 'agentPreflight')
    && controlInputs.agentPreflight !== undefined
  ) {
    try {
      env.PANDORA_AGENT_PREFLIGHT = JSON.stringify(controlInputs.agentPreflight);
    } catch (error) {
      const err = new Error('agentPreflight must be JSON-serializable.');
      err.code = 'MCP_AGENT_PREFLIGHT_INVALID';
      err.details = {
        cause: error && error.message ? error.message : String(error),
      };
      throw err;
    }
  }
  if (
    controlInputs
    && Object.prototype.hasOwnProperty.call(controlInputs, 'inputs')
    && controlInputs.inputs !== undefined
  ) {
    try {
      env.PANDORA_RECIPE_INPUTS = JSON.stringify(controlInputs.inputs);
    } catch (error) {
      const err = new Error('inputs must be JSON-serializable.');
      err.code = 'MCP_RECIPE_INPUTS_INVALID';
      err.details = {
        cause: error && error.message ? error.message : String(error),
      };
      throw err;
    }
  }
  return Object.keys(env).length ? env : undefined;
}

/**
 * Convert a tool definition to MCP descriptor format.
 *
 * @param {ToolDefinition} definition Tool registration definition.
 * @returns {{name: string, description: string, inputSchema: object}} MCP tool descriptor.
 */
function toToolDescriptor(definition, options = {}) {
  const descriptor = COMMAND_DESCRIPTORS[definition.name] || null;
  const canonicalTool = definition.canonicalTool || definition.aliasOf || definition.name;
  const compatibilityAlias = isCompatibilityAliasDefinition(definition);
  const safeFlags = Array.isArray(definition.safeFlags) ? [...definition.safeFlags] : [];
  const executeFlags = Array.isArray(definition.executeFlags) ? [...definition.executeFlags] : [];
  const executeIntentRequired = Boolean(definition.mutating && safeFlags.length === 0);
  const executeIntentRequiredForLiveMode = Boolean(definition.mutating && executeFlags.length > 0);
  const agentPreflightRequiredForExecuteMode = Boolean(
    definition.agentWorkflow
    && definition.agentWorkflow.executeRequiresValidation,
  );
  const remoteTransportActive = Boolean(options.remoteTransportActive);
  const xPandora = {
    name: definition.name,
    registryName: definition.name,
    command: Array.isArray(definition.command) ? [...definition.command] : [],
    summary: descriptor ? descriptor.summary : null,
    usage: descriptor ? descriptor.usage : null,
    emits: descriptor && Array.isArray(descriptor.emits) ? [...descriptor.emits] : [],
    outputModes: descriptor && Array.isArray(descriptor.outputModes) ? [...descriptor.outputModes] : [],
    dataSchema: descriptor ? descriptor.dataSchema || null : null,
    helpDataSchema: descriptor ? descriptor.helpDataSchema || null : null,
    mcpExposed: descriptor ? Boolean(descriptor.mcpExposed) : true,
    canonicalTool,
    canonicalName: canonicalTool,
    canonicalCommandTokens:
      descriptor && Array.isArray(descriptor.canonicalCommandTokens)
        ? [...descriptor.canonicalCommandTokens]
        : Array.isArray(definition.command)
          ? [...definition.command]
          : [],
    canonicalUsage: descriptor ? descriptor.canonicalUsage || descriptor.usage || null : null,
    aliasOf: definition.aliasOf || null,
    preferred: descriptor ? Boolean(descriptor.preferred) : definition.preferred !== false,
    isCanonical: definition.name === canonicalTool,
    compatibilityAlias,
    mutating: Boolean(definition.mutating),
    mcpMutating: descriptor ? Boolean(descriptor.mcpMutating) : Boolean(definition.mutating),
    longRunningBlocked: Boolean(definition.longRunningBlocked),
    mcpLongRunningBlocked: descriptor
      ? Boolean(descriptor.mcpLongRunningBlocked)
      : Boolean(definition.longRunningBlocked),
    placeholderBlocked: Boolean(definition.placeholderBlocked),
    controlInputNames: Array.isArray(definition.controlInputNames) ? [...definition.controlInputNames] : [],
    safeFlags,
    executeFlags,
    agentWorkflow: definition.agentWorkflow || null,
    riskLevel: descriptor ? descriptor.riskLevel || null : null,
    idempotency: descriptor ? descriptor.idempotency || null : null,
    expectedLatencyMs: descriptor ? descriptor.expectedLatencyMs || null : null,
    requiresSecrets: descriptor ? Boolean(descriptor.requiresSecrets) : false,
    recommendedPreflightTool: descriptor ? descriptor.recommendedPreflightTool || null : null,
    safeEquivalent: descriptor ? descriptor.safeEquivalent || null : null,
    externalDependencies:
      descriptor && Array.isArray(descriptor.externalDependencies)
        ? [...descriptor.externalDependencies]
        : [],
      canRunConcurrent: descriptor ? Boolean(descriptor.canRunConcurrent) : false,
      returnsOperationId: descriptor ? Boolean(descriptor.returnsOperationId) : false,
      returnsRuntimeHandle: descriptor ? Boolean(descriptor.returnsRuntimeHandle) : false,
      jobCapable: descriptor ? Boolean(descriptor.jobCapable) : false,
      supportsRemote: descriptor ? Boolean(descriptor.supportsRemote) : false,
      remoteEligible: descriptor ? Boolean(descriptor.remoteEligible) : false,
      remoteTransportActive: Boolean(remoteTransportActive),
      supportsWebhook: descriptor ? Boolean(descriptor.supportsWebhook) : false,
      executeIntentRequired,
      executeIntentRequiredForLiveMode,
      agentPreflightRequired: Boolean(agentPreflightRequiredForExecuteMode && executeIntentRequired),
      agentPreflightRequiredForExecuteMode,
      policyScopes:
        descriptor && Array.isArray(descriptor.policyScopes)
          ? [...descriptor.policyScopes]
          : [],
      metadataProvenance: {
        runtimeEnforced: [
        'mutating',
        'mcpMutating',
        'longRunningBlocked',
        'mcpLongRunningBlocked',
          'placeholderBlocked',
          'controlInputNames',
          'safeFlags',
          'executeFlags',
          ...(executeIntentRequired ? ['executeIntentRequired'] : []),
          ...(executeIntentRequiredForLiveMode ? ['executeIntentRequiredForLiveMode'] : []),
          ...(agentPreflightRequiredForExecuteMode && executeIntentRequired ? ['agentPreflightRequired'] : []),
          ...(agentPreflightRequiredForExecuteMode ? ['agentPreflightRequiredForExecuteMode'] : []),
        ],
        descriptorDerived: [
        'summary',
        'usage',
        'emits',
        'outputModes',
        'dataSchema',
        'helpDataSchema',
        'canonicalTool',
        'canonicalCommandTokens',
          'canonicalUsage',
          'aliasOf',
          'preferred',
          'compatibilityAlias',
          ...(compatibilityAlias ? ['compatibilityOptInRequired', 'defaultDiscoveryVisible', 'discoveryTier'] : []),
          'riskLevel',
        'idempotency',
        'expectedLatencyMs',
        'requiresSecrets',
        'recommendedPreflightTool',
        'safeEquivalent',
        'externalDependencies',
          'canRunConcurrent',
          'returnsOperationId',
          'returnsRuntimeHandle',
          'jobCapable',
          'supportsRemote',
          'remoteEligible',
          'remoteTransportActive',
          'supportsWebhook',
          'policyScopes',
          'agentWorkflow',
        ],
      },
  };
  if (compatibilityAlias) {
    xPandora.compatibilityOptInRequired = true;
    xPandora.defaultDiscoveryVisible = false;
    xPandora.discoveryTier = 'compatibility';
  }
  const inputSchema = definition.inputSchema || {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };

  return {
    name: definition.name,
    description: compatibilityAlias
      ? `${definition.description} Compatibility alias for ${xPandora.canonicalTool}; hidden from default MCP discovery and intended only for explicit compatibility/debug workflows. Prefer ${xPandora.canonicalTool} (${xPandora.canonicalCommandTokens.join(' ')}).`
      : definition.description,
    inputSchema: {
      ...inputSchema,
      xPandora,
    },
    xPandora,
  };
}

/** @type {ToolDefinition[]} */
const TOOL_DEFINITIONS = sortToolDefinitions(buildMcpToolDefinitions({ includeCompatibilityAliases: false }));
const TOOL_DEFINITIONS_WITH_COMPATIBILITY = sortToolDefinitions(buildMcpToolDefinitions({ includeCompatibilityAliases: true }));
const COMMAND_DESCRIPTORS = buildCommandDescriptors();

/**
 * Registry for MCP-exposed Pandora tools with execution guardrails.
 *
 * @returns {{
 *   listTools: (options?: {includeCompatibilityAliases?: boolean}) => object[],
 *   prepareInvocation: (toolName: string, args?: ToolInvocationArgs) => {argv: string[], env?: object},
 *   hasTool: (toolName: string) => boolean
 * }} MCP tool registry API.
 */
function createMcpToolRegistry(options = {}) {
  const remoteTransportActive = Boolean(options.remoteTransportActive);
  const remoteOnly = Boolean(options.remoteOnly);
  const compatibilityAliasDebugMode = compatibilityAliasDebugModeEnabled(options);
  const byName = new Map(TOOL_DEFINITIONS_WITH_COMPATIBILITY.map((definition) => [definition.name, definition]));

  /**
   * List all MCP-exposed Pandora tools and their shared JSON contract.
   *
   * @returns {object[]} Tool descriptors.
   */
  function listTools(options = {}) {
    const includeCompatibilityAliases = compatibilityAliasDebugMode || Boolean(options && options.includeCompatibilityAliases);
    const definitions = includeCompatibilityAliases ? TOOL_DEFINITIONS_WITH_COMPATIBILITY : TOOL_DEFINITIONS;
    return definitions
      .filter((definition) => {
        if (!remoteOnly) return true;
        const descriptor = COMMAND_DESCRIPTORS[definition.name] || null;
        return Boolean(descriptor && descriptor.remoteEligible);
      })
      .map((definition) => toToolDescriptor(definition, { remoteTransportActive }));
  }

  function describeTool(toolName) {
    const definition = byName.get(String(toolName || '').trim());
    if (!definition) return null;
    return toToolDescriptor(definition, { remoteTransportActive });
  }

  /**
   * Validate and convert a tool invocation request into Pandora CLI argv.
   * Applies guardrails for unknown/blocked tools and mutating intent rules.
   *
   * @param {string} toolName Registered MCP tool name.
   * @param {ToolInvocationArgs} [args={}] Invocation payload from MCP client.
   * @returns {{argv: string[], env?: object}} Prepared command argv (without binary prefix).
   */
  function prepareInvocation(toolName, args = {}) {
    if (toolName === 'launch' || toolName === 'clone-bet') {
      const unsupported = new Error(
        `${toolName} is intentionally not exposed over MCP because it streams interactive script output.`,
      );
      unsupported.code = 'UNSUPPORTED_OPERATION';
      unsupported.details = {
        hints: ['Use JSON-capable commands instead (for example, markets.list, trade, mirror.plan).'],
      };
      throw unsupported;
    }

    const definition = byName.get(String(toolName || '').trim());
    if (!definition) {
      const missing = new Error(`Unknown MCP tool: ${toolName}`);
      missing.code = 'UNKNOWN_TOOL';
      throw missing;
    }

    if (remoteOnly) {
      const descriptor = COMMAND_DESCRIPTORS[definition.name] || null;
      if (!descriptor || !descriptor.remoteEligible) {
        const unavailable = new Error(`${toolName} is not enabled for remote MCP transport in this build.`);
        unavailable.code = 'MCP_REMOTE_TOOL_UNAVAILABLE';
        unavailable.details = {
          toolName: definition.name,
          hints: ['Use the local CLI or stdio MCP transport for this tool.'],
        };
        throw unavailable;
      }
    }

    if (definition.placeholderBlocked) {
      const unavailable = new Error(
        `${toolName} is registered as an agent contract placeholder but is not executable in this build.`,
      );
      unavailable.code = 'MCP_TOOL_UNAVAILABLE';
      unavailable.details = {
        toolName: definition.name,
        hints: [
          'Use `pandora --output json schema` to inspect the placeholder contract.',
          'Update to a build that includes the target simulate/model command handlers.',
        ],
      };
      throw unavailable;
    }

    if (definition.longRunningBlocked) {
      const blocked = new Error(
        `${toolName} is blocked in MCP v1 because it is long-running/unbounded.`,
      );
      blocked.code = 'MCP_LONG_RUNNING_MODE_BLOCKED';
      blocked.details = {
        toolName: definition.name,
        hints: ['Use the non-long-running variant (for example, *.once) or call the CLI directly outside MCP.'],
      };
      throw blocked;
    }

    validateInvocationArgs(definition, args);

    const positionals = Array.isArray(args.positionals)
      ? args.positionals.map((value) => String(value))
      : [];
    const controlInputs = extractControlInputs(definition, args);
    const invocationFlags = extractInvocationFlags(definition, args);
    const flagArgv = buildFlagArgv(invocationFlags);
    const argv = [...definition.command, ...positionals, ...flagArgv];
    let willExecute = false;

    if (definition.mutating) {
      const safeFlags = Array.isArray(definition.safeFlags) ? definition.safeFlags : [];
      const executeFlags = Array.isArray(definition.executeFlags) ? definition.executeFlags : [];
      const flagSet = providedFlagSet(invocationFlags);
      const modeFlags = [...safeFlags, ...executeFlags].filter((flag) => flagSet.has(flag));
      const hasSafe = safeFlags.some((flag) => flagSet.has(flag));
      const hasExecute = executeFlags.some((flag) => flagSet.has(flag));
      const executeIntent = Boolean(args && args.intent && args.intent.execute === true);
      const hasModeFlags = safeFlags.length > 0 || executeFlags.length > 0;

      if (modeFlags.length > 1) {
        const err = new Error(
          `${toolName} received multiple mutually-exclusive execution mode flags: ${modeFlags.join(', ')}`,
        );
        err.code = 'MCP_MUTUALLY_EXCLUSIVE_MODE_FLAGS';
        err.details = {
          toolName: definition.name,
          modeFlags,
          safeFlags,
          executeFlags,
          hints: ['Provide exactly one execution mode flag, or omit mode flags and rely on intent.execute.'],
        };
        throw err;
      }

      if (!hasModeFlags && !executeIntent) {
        const err = new Error(`${toolName} requires intent.execute=true for mutating operations.`);
        err.code = 'MCP_EXECUTE_INTENT_REQUIRED';
        err.details = {
          hints: ['Set intent.execute=true to allow execution of this mutating tool.'],
        };
        throw err;
      }

      if (hasExecute && !executeIntent) {
        const err = new Error(
          `${toolName} requested live execution but intent.execute=true was not provided.`,
        );
        err.code = 'MCP_EXECUTE_INTENT_REQUIRED';
        err.details = {
          hints: [
            'Set intent.execute=true to allow live execution.',
            `Or remove ${executeFlags.join('/')} and allow the default safe mode.`,
          ],
        };
        throw err;
      }

      if (!hasSafe && !hasExecute) {
        if (executeIntent && executeFlags.length) {
          argv.push(executeFlags[0]);
          willExecute = true;
        } else if (safeFlags.length) {
          argv.push(safeFlags[0]);
        } else if (executeIntent) {
          willExecute = true;
        }
      } else if (hasExecute) {
        willExecute = true;
      }
    }

    if (
      definition.agentWorkflow
      && definition.agentWorkflow.executeRequiresValidation
      && willExecute
      && !Object.prototype.hasOwnProperty.call(controlInputs, 'agentPreflight')
    ) {
      const err = new Error(
        `${toolName} requires agentPreflight from agent.market.validate before execute mode is allowed.`,
      );
      err.code = 'MCP_AGENT_PREFLIGHT_REQUIRED';
      err.details = {
        toolName: definition.name,
        requiredInput: 'agentPreflight',
        requiredTools: Array.isArray(definition.agentWorkflow.requiredTools)
          ? [...definition.agentWorkflow.requiredTools]
          : [],
        recommendedTools: Array.isArray(definition.agentWorkflow.recommendedTools)
          ? [...definition.agentWorkflow.recommendedTools]
          : [],
        hints: [
          'Call agent.market.validate with the exact final market payload.',
          'Pass the PASS attestation back as arguments.agentPreflight on the execute-mode call.',
        ],
      };
      throw err;
    }

    return {
      argv,
      env: buildInvocationEnv(controlInputs),
    };
  }

  return {
    listTools,
    describeTool,
    prepareInvocation,
    hasTool: (toolName) => byName.has(String(toolName || '').trim()),
  };
}

module.exports = {
  createMcpToolRegistry,
};
