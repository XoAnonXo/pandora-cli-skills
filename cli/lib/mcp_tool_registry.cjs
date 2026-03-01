/**
 * @typedef {string|number|boolean|null|undefined|Array<string|number|boolean>} FlagInputValue
 */

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
 *   longRunningBlocked?: boolean
 * }} ToolDefinition
 */

/**
 * @typedef {{
 *   positionals?: Array<string|number|boolean>,
 *   flags?: ToolFlags,
 *   intent?: { execute?: boolean }
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
  if (!flags || typeof flags !== 'object') return [];
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
 * Convert a tool definition to MCP descriptor format.
 *
 * @param {ToolDefinition} definition Tool registration definition.
 * @returns {{name: string, description: string, inputSchema: object}} MCP tool descriptor.
 */
function toToolDescriptor(definition) {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: {
      type: 'object',
      properties: {
        positionals: {
          type: 'array',
          description: 'Additional positional arguments appended after the command tokens.',
          items: { type: 'string' },
        },
        flags: {
          type: 'object',
          description: 'CLI flags map (keys may include or omit leading --).',
          additionalProperties: {
            anyOf: [
              { type: 'string' },
              { type: 'number' },
              { type: 'integer' },
              { type: 'boolean' },
              {
                type: 'array',
                items: {
                  anyOf: [
                    { type: 'string' },
                    { type: 'number' },
                    { type: 'integer' },
                    { type: 'boolean' },
                  ],
                },
              },
            ],
          },
        },
        intent: {
          type: 'object',
          properties: {
            execute: {
              type: 'boolean',
              description: 'Required true for live write/mutating actions.',
            },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  };
}

/** @type {ToolDefinition[]} */
const TOOL_DEFINITIONS = [
  { name: 'help', command: ['help'], description: 'Show top-level command help.' },
  { name: 'version', command: ['version'], description: 'Return the installed CLI version.' },
  { name: 'schema', command: ['schema'], description: 'Return official Pandora JSON envelope schema.' },

  { name: 'markets.list', command: ['markets', 'list'], description: 'List Pandora markets with filters.' },
  { name: 'markets.get', command: ['markets', 'get'], description: 'Get one or more markets by id.' },
  { name: 'scan', command: ['scan'], description: 'Scan markets with lifecycle filters.' },
  { name: 'sports.books.list', command: ['sports', 'books', 'list'], description: 'List sportsbook provider health and configured book priorities.' },
  { name: 'sports.events.list', command: ['sports', 'events', 'list'], description: 'List normalized soccer events from sportsbook providers.' },
  { name: 'sports.events.live', command: ['sports', 'events', 'live'], description: 'List currently-live soccer events from sportsbook providers.' },
  { name: 'sports.odds.snapshot', command: ['sports', 'odds', 'snapshot'], description: 'Get normalized event odds snapshot and consensus.' },
  { name: 'sports.consensus', command: ['sports', 'consensus'], description: 'Compute majority-book trimmed-median consensus for one event.' },
  { name: 'sports.create.plan', command: ['sports', 'create', 'plan'], description: 'Build conservative market creation plan from sportsbook consensus.' },
  {
    name: 'sports.create.run',
    command: ['sports', 'create', 'run'],
    description: 'Execute or dry-run sports market creation.',
    mutating: true,
    safeFlags: ['--dry-run', '--paper'],
    executeFlags: ['--execute'],
  },
  {
    name: 'sports.sync.once',
    command: ['sports', 'sync', 'once'],
    description: 'Run one sports sync evaluation tick.',
    mutating: true,
    safeFlags: ['--paper', '--dry-run'],
    executeFlags: ['--execute-live', '--execute'],
  },
  {
    name: 'sports.sync.run',
    command: ['sports', 'sync', 'run'],
    description: 'Continuous sports sync loop (blocked in MCP v1).',
    longRunningBlocked: true,
    mutating: true,
    safeFlags: ['--paper', '--dry-run'],
    executeFlags: ['--execute-live', '--execute'],
  },
  {
    name: 'sports.sync.start',
    command: ['sports', 'sync', 'start'],
    description: 'Start detached sports sync runtime (blocked in MCP v1).',
    longRunningBlocked: true,
    mutating: true,
    safeFlags: ['--paper', '--dry-run'],
    executeFlags: ['--execute-live', '--execute'],
  },
  {
    name: 'sports.sync.stop',
    command: ['sports', 'sync', 'stop'],
    description: 'Stop sports sync runtime.',
    mutating: true,
  },
  { name: 'sports.sync.status', command: ['sports', 'sync', 'status'], description: 'Inspect sports sync runtime status.' },
  { name: 'sports.resolve.plan', command: ['sports', 'resolve', 'plan'], description: 'Build manual-final resolution recommendation.' },
  { name: 'quote', command: ['quote'], description: 'Build YES/NO quote estimates.' },
  {
    name: 'trade',
    command: ['trade'],
    description: 'Dry-run or execute a Pandora trade.',
    mutating: true,
    safeFlags: ['--dry-run'],
    executeFlags: ['--execute'],
  },
  { name: 'polls.list', command: ['polls', 'list'], description: 'List poll entities.' },
  { name: 'polls.get', command: ['polls', 'get'], description: 'Get one poll by id.' },
  { name: 'events.list', command: ['events', 'list'], description: 'List event entities.' },
  { name: 'events.get', command: ['events', 'get'], description: 'Get one event by id.' },
  { name: 'positions.list', command: ['positions', 'list'], description: 'List wallet positions.' },
  { name: 'portfolio', command: ['portfolio'], description: 'Build portfolio snapshot.' },
  {
    name: 'watch',
    command: ['watch'],
    description: 'Run watch snapshots (blocked in MCP v1 because it is long-running).',
    longRunningBlocked: true,
  },
  { name: 'history', command: ['history'], description: 'Query historical trades.' },
  { name: 'export', command: ['export'], description: 'Export historical rows to csv/json.' },
  { name: 'arbitrage', command: ['arbitrage'], description: 'Find arbitrage opportunities.' },
  {
    name: 'autopilot.once',
    command: ['autopilot', 'once'],
    description: 'Run one guarded autopilot iteration.',
    mutating: true,
    safeFlags: ['--paper'],
    executeFlags: ['--execute-live'],
  },
  {
    name: 'autopilot.run',
    command: ['autopilot', 'run'],
    description: 'Start continuous autopilot loop (blocked in MCP v1).',
    longRunningBlocked: true,
    mutating: true,
    safeFlags: ['--paper'],
    executeFlags: ['--execute-live'],
  },

  { name: 'mirror.browse', command: ['mirror', 'browse'], description: 'Browse candidate Polymarket mirrors.' },
  { name: 'mirror.plan', command: ['mirror', 'plan'], description: 'Build mirror sizing/deploy plan.' },
  {
    name: 'mirror.deploy',
    command: ['mirror', 'deploy'],
    description: 'Dry-run or execute mirror deployment.',
    mutating: true,
    safeFlags: ['--dry-run'],
    executeFlags: ['--execute'],
  },
  { name: 'mirror.verify', command: ['mirror', 'verify'], description: 'Verify Pandora/Polymarket mirror pair.' },
  { name: 'mirror.lp-explain', command: ['mirror', 'lp-explain'], description: 'Explain LP economics from odds.' },
  { name: 'mirror.hedge-calc', command: ['mirror', 'hedge-calc'], description: 'Compute hedge sizing and legs.' },
  { name: 'mirror.simulate', command: ['mirror', 'simulate'], description: 'Simulate LP PnL scenarios.' },
  {
    name: 'mirror.go',
    command: ['mirror', 'go'],
    description: 'Plan/deploy/verify/go orchestration.',
    mutating: true,
    safeFlags: ['--paper'],
    executeFlags: ['--execute-live'],
  },
  {
    name: 'mirror.sync.once',
    command: ['mirror', 'sync', 'once'],
    description: 'Execute one mirror sync tick.',
    mutating: true,
    safeFlags: ['--paper'],
    executeFlags: ['--execute-live'],
  },
  {
    name: 'mirror.sync.run',
    command: ['mirror', 'sync', 'run'],
    description: 'Continuous mirror sync loop (blocked in MCP v1).',
    longRunningBlocked: true,
    mutating: true,
    safeFlags: ['--paper'],
    executeFlags: ['--execute-live'],
  },
  {
    name: 'mirror.sync.start',
    command: ['mirror', 'sync', 'start'],
    description: 'Start detached mirror sync daemon (blocked in MCP v1).',
    longRunningBlocked: true,
    mutating: true,
    safeFlags: ['--paper'],
    executeFlags: ['--execute-live'],
  },
  {
    name: 'mirror.sync.stop',
    command: ['mirror', 'sync', 'stop'],
    description: 'Stop mirror sync daemon.',
    mutating: true,
  },
  { name: 'mirror.sync.status', command: ['mirror', 'sync', 'status'], description: 'Inspect mirror sync daemon status.' },
  { name: 'mirror.status', command: ['mirror', 'status'], description: 'Read mirror state/status payload.' },
  {
    name: 'mirror.close',
    command: ['mirror', 'close'],
    description: 'Build/execute close plan for a mirror pair.',
    mutating: true,
    safeFlags: ['--dry-run'],
    executeFlags: ['--execute'],
  },

  { name: 'polymarket.check', command: ['polymarket', 'check'], description: 'Run Polymarket auth/allowance checks.' },
  {
    name: 'polymarket.approve',
    command: ['polymarket', 'approve'],
    description: 'Dry-run or execute Polymarket approvals.',
    mutating: true,
    safeFlags: ['--dry-run'],
    executeFlags: ['--execute'],
  },
  { name: 'polymarket.preflight', command: ['polymarket', 'preflight'], description: 'Run Polymarket trade preflight checks.' },
  {
    name: 'polymarket.trade',
    command: ['polymarket', 'trade'],
    description: 'Dry-run or execute Polymarket trade.',
    mutating: true,
    safeFlags: ['--dry-run'],
    executeFlags: ['--execute'],
  },

  {
    name: 'webhook.test',
    command: ['webhook', 'test'],
    description: 'Send webhook/notification test payload.',
    mutating: true,
  },
  { name: 'leaderboard', command: ['leaderboard'], description: 'Compute leaderboard from history.' },
  { name: 'analyze', command: ['analyze'], description: 'Run strategy analysis provider.' },
  { name: 'suggest', command: ['suggest'], description: 'Produce trade suggestions from risk profile.' },
  {
    name: 'resolve',
    command: ['resolve'],
    description: 'Dry-run or execute poll resolution.',
    mutating: true,
    safeFlags: ['--dry-run'],
    executeFlags: ['--execute'],
  },
  {
    name: 'lp.add',
    command: ['lp', 'add'],
    description: 'Dry-run or execute LP add.',
    mutating: true,
    safeFlags: ['--dry-run'],
    executeFlags: ['--execute'],
  },
  {
    name: 'lp.remove',
    command: ['lp', 'remove'],
    description: 'Dry-run or execute LP remove.',
    mutating: true,
    safeFlags: ['--dry-run'],
    executeFlags: ['--execute'],
  },
  { name: 'lp.positions', command: ['lp', 'positions'], description: 'Read LP positions for wallet.' },
];

/**
 * Registry for MCP-exposed Pandora tools with execution guardrails.
 *
 * @returns {{
 *   listTools: () => object[],
 *   prepareInvocation: (toolName: string, args?: ToolInvocationArgs) => {argv: string[]},
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
   * @returns {{argv: string[]}} Prepared command argv (without binary prefix).
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
    const flagArgv = buildFlagArgv(args.flags);
    const argv = [...definition.command, ...positionals, ...flagArgv];

    if (definition.mutating) {
      const safeFlags = Array.isArray(definition.safeFlags) ? definition.safeFlags : [];
      const executeFlags = Array.isArray(definition.executeFlags) ? definition.executeFlags : [];
      const flagSet = providedFlagSet(args.flags);
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
        } else if (safeFlags.length) {
          argv.push(safeFlags[0]);
        }
      }
    }

    return { argv };
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
