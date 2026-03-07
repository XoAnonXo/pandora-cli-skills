/**
 * @typedef {string|number|boolean|null|undefined|Array<string|number|boolean>} FlagInputValue
 */

const { buildMcpToolDefinitions } = require('./agent_contract_registry.cjs');

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
  const legacyFlags = args && args.flags && typeof args.flags === 'object' && !Array.isArray(args.flags)
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
  return Object.keys(env).length ? env : undefined;
}

/**
 * Convert a tool definition to MCP descriptor format.
 *
 * @param {ToolDefinition} definition Tool registration definition.
 * @returns {{name: string, description: string, inputSchema: object}} MCP tool descriptor.
 */
function toToolDescriptor(definition) {
  const xPandora = {
    canonicalTool: definition.canonicalTool || definition.aliasOf || definition.name,
    aliasOf: definition.aliasOf || null,
    preferred: definition.preferred !== false,
    mutating: Boolean(definition.mutating),
    longRunningBlocked: Boolean(definition.longRunningBlocked),
    controlInputNames: Array.isArray(definition.controlInputNames) ? [...definition.controlInputNames] : [],
    agentWorkflow: definition.agentWorkflow || null,
  };
  const inputSchema = definition.inputSchema || {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };

  return {
    name: definition.name,
    description: definition.description,
    inputSchema: {
      ...inputSchema,
      xPandora,
    },
    xPandora,
  };
}

/** @type {ToolDefinition[]} */
const TOOL_DEFINITIONS = buildMcpToolDefinitions();

/**
 * Registry for MCP-exposed Pandora tools with execution guardrails.
 *
 * @returns {{
 *   listTools: () => object[],
 *   prepareInvocation: (toolName: string, args?: ToolInvocationArgs) => {argv: string[], env?: object},
 *   hasTool: (toolName: string) => boolean
 * }} MCP tool registry API.
 */
function createMcpToolRegistry() {
  const byName = new Map(TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));

  /**
   * List all MCP-exposed Pandora tools and their shared JSON contract.
   *
   * @returns {object[]} Tool descriptors.
   */
  function listTools() {
    return TOOL_DEFINITIONS.map((definition) => toToolDescriptor(definition));
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
      const hasSafe = safeFlags.some((flag) => flagSet.has(flag));
      const hasExecute = executeFlags.some((flag) => flagSet.has(flag));
      const executeIntent = Boolean(args && args.intent && args.intent.execute === true);
      const hasModeFlags = safeFlags.length > 0 || executeFlags.length > 0;

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
    prepareInvocation,
    hasTool: (toolName) => byName.has(String(toolName || '').trim()),
  };
}

module.exports = {
  createMcpToolRegistry,
};
