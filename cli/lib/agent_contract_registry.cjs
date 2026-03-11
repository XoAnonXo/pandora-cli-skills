const COMMAND_HELP_SCHEMA_REF = '#/definitions/CommandHelpPayload';
const GENERIC_DATA_SCHEMA_REF = '#/definitions/GenericCommandData';
const HELP_PAYLOAD_SCHEMA_REF = '#/definitions/HelpPayload';
const MCP_HELP_SCHEMA_REF = '#/definitions/McpHelpPayload';
const ODDS_HELP_SCHEMA_REF = '#/definitions/OddsHelpPayload';
const MIRROR_STATUS_HELP_SCHEMA_REF = '#/definitions/MirrorStatusHelpPayload';
const SCHEMA_HELP_SCHEMA_REF = '#/definitions/SchemaHelpPayload';
const CAPABILITIES_HELP_SCHEMA_REF = '#/definitions/CapabilitiesHelpPayload';
const COMMAND_DESCRIPTOR_VERSION = '1.4.3';
const { POLL_CATEGORY_NAME_LIST } = require('./shared/poll_categories.cjs');
const { MIRROR_SYNC_GATE_CODES } = require('./mirror_sync/gates.cjs');

function stringSchema(description, extras = {}) {
  return { type: 'string', ...(description ? { description } : {}), ...extras };
}

function booleanSchema(description, extras = {}) {
  return { type: 'boolean', ...(description ? { description } : {}), ...extras };
}

function numberSchema(description, extras = {}) {
  return { type: 'number', ...(description ? { description } : {}), ...extras };
}

function integerSchema(description, extras = {}) {
  return { type: 'integer', ...(description ? { description } : {}), ...extras };
}

function enumSchema(values, description) {
  return { enum: values, ...(description ? { description } : {}) };
}

function stringArraySchema(description, extras = {}) {
  return {
    type: 'array',
    items: { type: 'string' },
    ...(description ? { description } : {}),
    ...extras,
  };
}

function flexibleArraySchema(itemSchema, description, extras = {}) {
  return {
    type: 'array',
    items: itemSchema,
    ...(description ? { description } : {}),
    ...extras,
  };
}

function buildMirrorSkipGateSchema() {
  return stringSchema(
    'Set to "true" to skip all mirror sync gates, or provide a comma-delimited named skip list.',
    {
      examples: ['true', MIRROR_SYNC_GATE_CODES.slice(0, 2).join(',')],
      xPandora: {
        allowedGateCodes: MIRROR_SYNC_GATE_CODES,
        acceptsBooleanString: true,
      },
    },
  );
}

function buildAgentPreflightSchema(description) {
  return {
    type: 'object',
    properties: {
      validationTicket: stringSchema('Ticket returned by agent.market.validate for the exact market payload.'),
      validationDecision: enumSchema(['PASS', 'FAIL'], 'Validation verdict from the agent AI run.'),
      validationSummary: stringSchema('Short summary of the validation result.'),
      autocompleteTicket: stringSchema('Optional ticket from agent.market.autocomplete when the agent drafted the market.'),
    },
    required: ['validationTicket', 'validationDecision', 'validationSummary'],
    additionalProperties: false,
    ...(description ? { description } : {}),
  };
}

function buildIntentSchema() {
  return {
    type: 'object',
    properties: {
      execute: {
        type: 'boolean',
        description: 'Set true to permit live/mutating execution when supported by the tool.',
      },
    },
    additionalProperties: false,
  };
}

function buildInputSchema({
  flagProperties = null,
  requiredFlags = [],
  includeIntent = false,
  anyOf = null,
  oneOf = null,
} = {}) {
  const schema = {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };

  if (flagProperties && Object.keys(flagProperties).length) {
    Object.assign(schema.properties, flagProperties);
    if (Array.isArray(requiredFlags) && requiredFlags.length) {
      schema.required = [...requiredFlags];
    }
  }

  if (includeIntent) {
    schema.properties.intent = buildIntentSchema();
  }

  const xPandora = {};

  if (Array.isArray(anyOf) && anyOf.length) {
    const branches = anyOf
      .filter((requiredSet) => Array.isArray(requiredSet) && requiredSet.length)
      .map((requiredSet) => ({ required: [...requiredSet] }));
    if (branches.length) {
      xPandora.requiredAnyOf = branches;
    }
  }

  if (Array.isArray(oneOf) && oneOf.length) {
    const branches = oneOf
      .filter((branch) => branch && typeof branch === 'object')
      .map((branch) => ({ ...branch }));
    if (branches.length) {
      xPandora.exclusiveOneOf = branches;
    }
  }

  if (Object.keys(xPandora).length) {
    schema.xPandora = xPandora;
  }

  return schema;
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildCaseInsensitiveEnumPattern(values) {
  const options = (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((value) =>
      value
        .split('')
        .map((char) => {
          if (/[a-z]/i.test(char)) {
            return `[${char.toLowerCase()}${char.toUpperCase()}]`;
          }
          return escapeRegex(char);
        })
        .join(''),
    );
  return `^(?:${options.join('|')})$`;
}

function buildRequiredSetCombinations(...groups) {
  const normalizedGroups = groups
    .filter((group) => Array.isArray(group) && group.length)
    .map((group) =>
      group
        .filter((entry) => Array.isArray(entry) && entry.length)
        .map((entry) => Array.from(new Set(entry.map((value) => String(value || '').trim()).filter(Boolean)))),
    )
    .filter((group) => group.length);
  if (!normalizedGroups.length) return [];

  let combos = [[]];
  for (const group of normalizedGroups) {
    const nextCombos = [];
    for (const base of combos) {
      for (const entry of group) {
        nextCombos.push(Array.from(new Set([...base, ...entry])));
      }
    }
    combos = nextCombos;
  }
  return combos;
}

function buildExclusivePresenceBranches(...groups) {
  const normalizedGroups = groups
    .filter((group) => Array.isArray(group) && group.length)
    .map((group) =>
      group
        .filter((entry) => Array.isArray(entry))
        .map((entry) => Array.from(new Set(entry.map((value) => String(value || '').trim()).filter(Boolean)))),
    )
    .filter((group) => group.length);

  if (!normalizedGroups.length) return [];

  let combos = [[]];
  for (let groupIndex = 0; groupIndex < normalizedGroups.length; groupIndex += 1) {
    const group = normalizedGroups[groupIndex];
    const nextCombos = [];
    for (const combo of combos) {
      for (let optionIndex = 0; optionIndex < group.length; optionIndex += 1) {
        nextCombos.push([
          ...combo,
          {
            groupIndex,
            optionIndex,
            required: group[optionIndex],
          },
        ]);
      }
    }
    combos = nextCombos;
  }

  return combos.map((combo) => {
    const required = Array.from(new Set(combo.flatMap((selection) => selection.required)));
    const forbidden = [];
    const chosenFields = new Set(required);
    for (const selection of combo) {
      const group = normalizedGroups[selection.groupIndex];
      for (let optionIndex = 0; optionIndex < group.length; optionIndex += 1) {
        if (optionIndex === selection.optionIndex) continue;
        const entry = group[optionIndex];
        if (!entry.length) continue;
        forbidden.push({ required: [...entry] });
        for (const field of entry) {
          if (!chosenFields.has(field)) {
            forbidden.push({ required: [field] });
          }
        }
      }
    }
    return {
      ...(required.length ? { required } : {}),
      ...(forbidden.length ? { not: { anyOf: forbidden } } : {}),
    };
  });
}

function buildPollCategorySchema(description = 'Category id or canonical category name.') {
  const categoryNames = [...POLL_CATEGORY_NAME_LIST];
  return stringSchema(description, {
    examples: ['Sports', '3'],
    xPandora: {
      allowedCategoryNames: categoryNames,
      acceptsIntegerStrings: true,
      caseInsensitivePattern: buildCaseInsensitiveEnumPattern(categoryNames),
    },
  });
}

function buildTargetTimestampSchema(description = 'Resolution timestamp in unix seconds or ISO-8601 datetime.') {
  return stringSchema(description, {
    examples: ['1777777777', '2026-12-31T00:00:00Z'],
    xPandora: {
      acceptsUnixSeconds: true,
      acceptsIsoDatetime: true,
    },
  });
}

function commandContract(options) {
  return {
    outputModes: ['table', 'json'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
    helpDataSchema: COMMAND_HELP_SCHEMA_REF,
    emits: [],
    mcpExposed: false,
    agentPlatform: null,
    ...options,
  };
}

const DEFAULT_AGENT_PLATFORM_METADATA = Object.freeze({
  riskLevel: 'low',
  idempotency: 'idempotent',
  expectedLatencyMs: 750,
  requiresSecrets: false,
  recommendedPreflightTool: null,
  safeEquivalent: null,
  externalDependencies: Object.freeze([]),
  canRunConcurrent: true,
  returnsOperationId: false,
  returnsRuntimeHandle: false,
  jobCapable: false,
  supportsRemote: false,
  remoteEligible: false,
  supportsWebhook: false,
  policyScopes: Object.freeze([]),
});

const AGENT_PLATFORM_NON_REMOTE_COMMANDS = new Set(['launch', 'clone-bet', 'mcp']);
const AGENT_PLATFORM_CRITICAL_RISK_COMMANDS = new Set(['risk.panic', 'mirror.panic']);
const AGENT_PLATFORM_FAST_LOCAL_COMMANDS = new Set(['help', 'version', 'schema', 'bootstrap']);
const AGENT_PLATFORM_LOCAL_DAEMON_CONTROL_COMMANDS = new Set([
  'sports.sync.stop',
  'sports.sync.status',
  'mirror.sync.stop',
  'mirror.sync.status',
  'mirror.sync.unlock',
  'mirror.health',
  'mirror.panic',
]);
const AGENT_PLATFORM_FILESYSTEM_WRITE_COMMANDS = new Set([
  'init-env',
  'setup',
  'export',
  'odds.record',
  'model.calibrate',
  'model.correlation',
]);

function mergeUniqueStringList(...lists) {
  return Array.from(
    new Set(
      lists.flatMap((list) =>
        Array.isArray(list)
          ? list.map((entry) => String(entry || '').trim()).filter(Boolean)
          : [],
      ),
    ),
  );
}

function commandMatchesPrefix(commandName, prefix) {
  return commandName === prefix || commandName.startsWith(`${prefix}.`);
}

function usageMentionsFlag(contract, flagName) {
  if (!contract || typeof contract.usage !== 'string') return false;
  const normalizedFlag = String(flagName || '').startsWith('--') ? String(flagName || '') : `--${flagName}`;
  const escapedFlag = escapeRegex(normalizedFlag);
  return new RegExp(`(^|[^A-Za-z0-9-])${escapedFlag}(?=$|[^A-Za-z0-9-])`).test(contract.usage);
}

function hasInputProperty(contract, propertyName) {
  const inputSchema = contract && contract.mcp && contract.mcp.inputSchema;
  return Boolean(
    inputSchema
      && inputSchema.properties
      && Object.prototype.hasOwnProperty.call(inputSchema.properties, propertyName),
  );
}

function commandHasFlag(contract, flagName) {
  const normalizedName = String(flagName || '').replace(/^--/, '');
  return hasInputProperty(contract, normalizedName) || usageMentionsFlag(contract, normalizedName);
}

function commandHasAnyFlag(contract, ...flagNames) {
  return flagNames.some((flagName) => commandHasFlag(contract, flagName));
}

function isMutatingContract(contract) {
  if (contract && contract.mcp && contract.mcp.mutating) return true;
  return commandHasFlag(contract, 'execute');
}

function writesFilesystemContract(contract) {
  if (!contract || !contract.name) return false;
  if (AGENT_PLATFORM_FILESYSTEM_WRITE_COMMANDS.has(contract.name)) return true;
  if (commandHasAnyFlag(contract, 'out', 'save-model', 'save-forecast')) return true;
  if (contract.name === 'watch' && commandHasFlag(contract, 'brier-file')) return true;
  return false;
}

function hasSafeModeContract(contract) {
  return Boolean(
    (contract && contract.mcp && Array.isArray(contract.mcp.safeFlags) && contract.mcp.safeFlags.length)
      || commandHasFlag(contract, 'dry-run'),
  );
}

function inferRequiresSecrets(contract, isMutating) {
  if (commandHasFlag(contract, 'private-key')) return true;
  if (contract.name === 'launch' || contract.name === 'clone-bet') return true;
  if (commandHasAnyFlag(contract, 'webhook-secret', 'telegram-bot-token', 'discord-webhook-url')) return true;
  return Boolean(isMutating && commandHasAnyFlag(contract, 'dotenv-path', 'skip-dotenv'));
}

function inferJobCapable(contract) {
  if (!contract || !contract.name) return false;
  return Boolean(
    (contract.mcp && contract.mcp.longRunningBlocked)
      || /^(watch|stream)$/.test(contract.name)
      || /\.(run|start)$/.test(contract.name)
      || contract.name === 'mirror.go',
  );
}

function inferSupportsWebhook(contract) {
  return Boolean(
    commandMatchesPrefix(contract.name, 'webhook')
      || commandHasAnyFlag(contract, 'webhook-url', 'telegram-bot-token', 'discord-webhook-url'),
  );
}

function inferRemoteEligible(contract, jobCapable) {
  if (!contract || AGENT_PLATFORM_NON_REMOTE_COMMANDS.has(contract.name)) return false;
  return Boolean(jobCapable || contract.mcpExposed);
}

function inferExternalDependencies(contract, requiresSecrets, supportsWebhook) {
  const dependencies = [];
  const isLocalDaemonControlCommand = AGENT_PLATFORM_LOCAL_DAEMON_CONTROL_COMMANDS.has(contract.name);
  const isMirrorStatusCommand = contract.name === 'mirror.status';

  if (
    commandHasAnyFlag(
      contract,
      'dotenv-path',
      'example',
      'state-file',
      'plan-file',
      'pid-file',
      'risk-file',
      'brier-file',
      'out',
    )
    || contract.name === 'init-env'
  ) {
    dependencies.push('filesystem');
  }

  if (requiresSecrets) {
    if (commandHasFlag(contract, 'private-key')) {
      dependencies.push('wallet-secrets');
    }
    if (
      commandMatchesPrefix(contract.name, 'webhook')
      || commandHasAnyFlag(contract, 'webhook-secret', 'telegram-bot-token', 'discord-webhook-url')
    ) {
      dependencies.push('notification-secrets');
    }
  }

  if (
    commandHasAnyFlag(contract, 'indexer-url', 'indexer-ws-url')
    || [
      'scan',
      'markets',
      'polls',
      'events',
      'positions',
      'portfolio',
      'history',
      'export',
      'watch',
      'stream',
      'odds',
      'arb',
      'arbitrage',
      'leaderboard',
    ].some((prefix) => commandMatchesPrefix(contract.name, prefix))
  ) {
    dependencies.push('indexer-api');
  }

  if (
    commandHasAnyFlag(contract, 'rpc-url', 'fork-rpc-url')
    || [
      'doctor',
      'setup',
      'launch',
      'clone-bet',
      'trade',
      'sell',
      'lp',
      'resolve',
      'claim',
      'lifecycle',
      'mirror',
      'polymarket',
    ].some((prefix) => commandMatchesPrefix(contract.name, prefix))
  ) {
    if (!isLocalDaemonControlCommand && !isMirrorStatusCommand) {
      dependencies.push('chain-rpc');
    }
  }

  if (commandMatchesPrefix(contract.name, 'sports')) {
    if (!isLocalDaemonControlCommand) {
      dependencies.push('sports-data-provider');
    }
  }

  if (
    commandMatchesPrefix(contract.name, 'mirror')
    || commandMatchesPrefix(contract.name, 'polymarket')
    || contract.name === 'clone-bet'
  ) {
    if (!isLocalDaemonControlCommand) {
      dependencies.push('polymarket-api');
    }
  }

  if (contract.name === 'mcp') {
    dependencies.push('stdio-transport');
  }

  if (supportsWebhook) {
    dependencies.push('webhook-endpoint');
  }

  return mergeUniqueStringList(dependencies);
}

function inferRiskLevel(contract, isMutating, requiresSecrets, jobCapable) {
  if (AGENT_PLATFORM_CRITICAL_RISK_COMMANDS.has(contract.name)) return 'critical';
  if (requiresSecrets && !isMutating) return 'medium';
  if (
    isMutating
    && (
      requiresSecrets
      || commandMatchesPrefix(contract.name, 'mirror')
      || commandMatchesPrefix(contract.name, 'polymarket')
      || commandMatchesPrefix(contract.name, 'lifecycle')
    )
  ) {
    return 'high';
  }
  if (isMutating || jobCapable) return 'medium';
  return 'low';
}

function inferIdempotency(contract, isMutating) {
  if (!isMutating) {
    return writesFilesystemContract(contract) ? 'conditional' : 'idempotent';
  }
  return hasSafeModeContract(contract) ? 'conditional' : 'non-idempotent';
}

function inferExpectedLatencyMs(contract, isMutating, jobCapable, externalDependencies) {
  if (AGENT_PLATFORM_FAST_LOCAL_COMMANDS.has(contract.name)) return 150;
  if (jobCapable) return 60000;
  if (
    isMutating
    && externalDependencies.length
    && externalDependencies.every((dependency) => ['filesystem', 'wallet-secrets'].includes(dependency))
  ) {
    return 1000;
  }
  if (isMutating) return 15000;
  if (
    externalDependencies.some((dependency) =>
      ['chain-rpc', 'indexer-api', 'sports-data-provider', 'polymarket-api', 'webhook-endpoint'].includes(dependency),
    )
  ) {
    return 5000;
  }
  if (externalDependencies.includes('filesystem')) return 1000;
  return DEFAULT_AGENT_PLATFORM_METADATA.expectedLatencyMs;
}

function inferSafeEquivalent(contract, isMutating) {
  if (contract.name === 'polymarket.trade' || contract.name === 'polymarket.approve') {
    return 'polymarket.preflight';
  }
  if (contract.name === 'trade' || contract.name === 'sell') {
    return 'quote';
  }
  if (!isMutating || hasSafeModeContract(contract)) return null;
  return null;
}

function inferRecommendedPreflightTool(contract, safeEquivalent, externalDependencies, requiresSecrets) {
  const requiredTools = contract.agentWorkflow && Array.isArray(contract.agentWorkflow.requiredTools)
    ? contract.agentWorkflow.requiredTools
    : [];
  if (requiredTools.length) return requiredTools[0];
  if (contract.name === 'doctor') return null;
  if (contract.name === 'polymarket.trade' || contract.name === 'polymarket.approve') {
    return 'polymarket.preflight';
  }
  if (safeEquivalent && safeEquivalent !== contract.name) return safeEquivalent;
  if (hasSafeModeContract(contract)) return null;
  return null;
}

function inferPolicyScopes(contract, metadata) {
  const rootScope = String(contract && contract.name ? contract.name : 'command').split('.')[0];
  const actionScope = metadata.jobCapable ? 'run' : metadata.idempotency === 'idempotent' ? 'read' : 'write';
  const scopes = [`${rootScope}:${actionScope}`];

  if (metadata.requiresSecrets) scopes.push('secrets:use');
  if (metadata.externalDependencies.includes('chain-rpc')) scopes.push('network:rpc');
  if (metadata.externalDependencies.includes('indexer-api')) scopes.push('network:indexer');
  if (metadata.externalDependencies.includes('sports-data-provider')) scopes.push('network:sports');
  if (metadata.externalDependencies.includes('polymarket-api')) scopes.push('network:polymarket');
  if (metadata.jobCapable) scopes.push('jobs:run');
  if (metadata.supportsWebhook) scopes.push('webhooks:use');

  return mergeUniqueStringList(scopes);
}

function resolveAgentPlatformMetadata(contract) {
  const isMutating = isMutatingContract(contract);
  const requiresSecrets = inferRequiresSecrets(contract, isMutating);
  const jobCapable = inferJobCapable(contract);
  const supportsWebhook = inferSupportsWebhook(contract);
  const remoteEligible = inferRemoteEligible(contract, jobCapable);
  const externalDependencies = inferExternalDependencies(contract, requiresSecrets, supportsWebhook);
  const safeEquivalent = inferSafeEquivalent(contract, isMutating);
  const writesFilesystem = writesFilesystemContract(contract);

  const inferredMetadata = {
    riskLevel: inferRiskLevel(contract, isMutating, requiresSecrets, jobCapable),
    idempotency: inferIdempotency(contract, isMutating),
    expectedLatencyMs: inferExpectedLatencyMs(contract, isMutating, jobCapable, externalDependencies),
    requiresSecrets,
    recommendedPreflightTool: inferRecommendedPreflightTool(
      contract,
      safeEquivalent,
      externalDependencies,
      requiresSecrets,
    ),
    safeEquivalent,
    externalDependencies,
    canRunConcurrent: !isMutating && !jobCapable && !writesFilesystem && contract.name !== 'mcp',
    returnsOperationId: false,
    returnsRuntimeHandle: false,
    jobCapable,
    supportsRemote: remoteEligible,
    remoteEligible,
    supportsWebhook,
    policyScopes: [],
  };

  const overrideMetadata = contract && contract.agentPlatform && typeof contract.agentPlatform === 'object'
    ? contract.agentPlatform
    : null;

  const metadata = {
    ...DEFAULT_AGENT_PLATFORM_METADATA,
    ...inferredMetadata,
    ...(overrideMetadata || {}),
  };

  metadata.externalDependencies = mergeUniqueStringList(
    inferredMetadata.externalDependencies,
    overrideMetadata && overrideMetadata.externalDependencies,
  );
  metadata.policyScopes = mergeUniqueStringList(
    inferPolicyScopes(contract, metadata),
    overrideMetadata && overrideMetadata.policyScopes,
  );

  return metadata;
}

const commonFlags = {
  indexerUrl: stringSchema('Indexer base URL.'),
  timeoutMs: integerSchema('Request timeout in milliseconds.', { minimum: 1 }),
  chainId: integerSchema('Chain id.', { minimum: 1 }),
  rpcUrl: stringSchema('RPC URL.'),
  privateKey: stringSchema('Hex private key.'),
  profileId: stringSchema('Named signer profile id.'),
  profileFile: stringSchema('Path to a signer profile file.'),
  wallet: stringSchema('Wallet address.'),
  marketAddress: stringSchema('Market address.'),
  pollAddress: stringSchema('Poll address.'),
  eventId: stringSchema('Event identifier.'),
  competition: stringSchema('Competition identifier or slug.'),
  limit: integerSchema('Maximum number of results.', { minimum: 1 }),
  stateFile: stringSchema('State file path.'),
  paper: booleanSchema('Run in paper/simulation mode.'),
  dryRun: booleanSchema('Run in dry-run mode.'),
  execute: booleanSchema('Execute live/write path.'),
  executeLive: booleanSchema('Execute live continuous workflow.'),
  provider: enumSchema(['primary', 'backup', 'auto'], 'Sports provider selection.'),
};

const MIRROR_REBALANCE_ROUTE_VALUES = ['public', 'auto', 'flashbots-private', 'flashbots-bundle'];
const MIRROR_REBALANCE_ROUTE_FALLBACK_VALUES = ['fail', 'public'];

function buildMirrorRebalanceRouteSchema() {
  return enumSchema(
    MIRROR_REBALANCE_ROUTE_VALUES,
    'Pandora-leg execution route. public preserves ordinary mempool submission; auto chooses a private route when supported; flashbots-private requests single-tx private relay submission; flashbots-bundle requests Flashbots bundle semantics for approval+trade paths. This affects only the Ethereum Pandora leg.',
  );
}

function buildMirrorRebalanceRouteFallbackSchema() {
  return enumSchema(
    MIRROR_REBALANCE_ROUTE_FALLBACK_VALUES,
    'Fallback policy when the requested Pandora-leg private route is unsupported or rejected. fail stops the run; public degrades to ordinary public submission. This does not change Polygon hedge semantics.',
  );
}

const mirrorPandoraSelectorAnyOf = [['pandora-market-address'], ['market-address']];
const mirrorPolymarketSelectorAnyOf = [['polymarket-market-id'], ['polymarket-slug']];
const mirrorPandoraPolymarketSelectorAnyOf = buildRequiredSetCombinations(
  mirrorPandoraSelectorAnyOf,
  mirrorPolymarketSelectorAnyOf,
);
const mirrorOptionalModeChoices = [[], ['paper'], ['dry-run'], ['execute-live'], ['execute']];
const mirrorSelectorAndModeAnyOf = buildRequiredSetCombinations(
  [['plan-file'], ['polymarket-market-id'], ['polymarket-slug']],
  [['dry-run'], ['execute']],
);
const mirrorCloseSelectorAnyOf = [['all'], ...mirrorPandoraPolymarketSelectorAnyOf];
const mirrorCloseSelectorAndModeAnyOf = buildRequiredSetCombinations(
  mirrorCloseSelectorAnyOf,
  [['dry-run'], ['execute']],
);
const mirrorStatusLookupAnyOf = [['state-file'], ['strategy-hash']];
const mirrorResolvedLookupAnyOf = [
  ...mirrorStatusLookupAnyOf,
  ...mirrorPandoraSelectorAnyOf,
  ...mirrorPolymarketSelectorAnyOf,
];
const mirrorHealthLookupAnyOf = [['state-file'], ['strategy-hash'], ['pid-file'], ...mirrorPandoraSelectorAnyOf];
const mirrorLogsLookupAnyOf = [['state-file'], ['strategy-hash'], ...mirrorPandoraSelectorAnyOf];
const mirrorSyncStopSelectorAnyOf = [['pid-file'], ['strategy-hash'], ...mirrorPandoraSelectorAnyOf, ['all']];
const mirrorSyncStatusSelectorAnyOf = [['pid-file'], ['strategy-hash']];
const mirrorSyncUnlockSelectorAnyOf = [['state-file'], ['strategy-hash']];
const polymarketPositionsSelectorChoices = [[], ['condition-id'], ['slug'], ['token-id']];
const mirrorVerifySelectorOneOf = buildExclusivePresenceBranches(
  mirrorPandoraSelectorAnyOf,
  mirrorPolymarketSelectorAnyOf,
);
const mirrorDeploySelectorAndModeOneOf = buildExclusivePresenceBranches(
  [['plan-file'], ['polymarket-market-id'], ['polymarket-slug']],
  [['dry-run'], ['execute']],
);
const mirrorGoSelectorAndModeOneOf = buildExclusivePresenceBranches(
  mirrorPolymarketSelectorAnyOf,
  mirrorOptionalModeChoices,
);
const mirrorSyncSelectorAndOptionalModeOneOf = buildExclusivePresenceBranches(
  mirrorPandoraSelectorAnyOf,
  mirrorPolymarketSelectorAnyOf,
  mirrorOptionalModeChoices,
);
const mirrorCloseSelectorAndModeOneOf = buildExclusivePresenceBranches(
  mirrorCloseSelectorAnyOf,
  [['dry-run'], ['execute']],
);
const mirrorStatusLookupOneOf = buildExclusivePresenceBranches(mirrorStatusLookupAnyOf);
const mirrorResolvedLookupOneOf = [];
const mirrorLogsLookupOneOf = buildExclusivePresenceBranches(mirrorStatusLookupAnyOf, mirrorPandoraSelectorAnyOf);
const mirrorSyncStopSelectorOneOf = buildExclusivePresenceBranches(mirrorSyncStopSelectorAnyOf);
const mirrorSyncStatusSelectorOneOf = buildExclusivePresenceBranches(mirrorSyncStatusSelectorAnyOf);
const mirrorSyncUnlockSelectorOneOf = buildExclusivePresenceBranches(mirrorSyncUnlockSelectorAnyOf);
const polymarketPositionsSelectorOneOf = buildExclusivePresenceBranches(polymarketPositionsSelectorChoices);
const polymarketTradeSelectorChoices = [['token-id'], ['condition-id', 'token'], ['slug', 'token']];
const polymarketTradeModeChoices = [['dry-run'], ['execute']];
const polymarketTradeSelectorAndModeAnyOf = buildRequiredSetCombinations(
  polymarketTradeSelectorChoices,
  polymarketTradeModeChoices,
);
const polymarketTradeModeOneOf = buildExclusivePresenceBranches(polymarketTradeModeChoices);
const simulateParticleFilterSourceChoices = [['observations-json'], ['input'], ['stdin']];
const simulateParticleFilterSourceOneOf = buildExclusivePresenceBranches(simulateParticleFilterSourceChoices);
const mirrorTraceSelectorOneOf = buildExclusivePresenceBranches([['blocks'], ['from-block', 'to-block']]);

const commandContracts = [
  commandContract({
    name: 'help',
    summary: 'Display top-level usage and global flag metadata.',
    usage: 'pandora [--output table|json] help',
    emits: ['help'],
    dataSchema: HELP_PAYLOAD_SCHEMA_REF,
    helpDataSchema: null,
    mcpExposed: true,
    mcp: {
      command: ['help'],
      description: 'Show top-level command help.',
      inputSchema: buildInputSchema(),
      preferred: true,
    },
  }),
  commandContract({
    name: 'version',
    summary: 'Return the installed Pandora CLI version.',
    usage: 'pandora [--output table|json] version',
    emits: ['version'],
    dataSchema: '#/definitions/VersionPayload',
    helpDataSchema: null,
    mcpExposed: true,
    mcp: {
      command: ['version'],
      description: 'Return the installed CLI version.',
      inputSchema: buildInputSchema(),
      preferred: true,
    },
  }),
  commandContract({
    name: 'init-env',
    summary: 'Write a starter env file from the example template.',
    usage: 'pandora [--output table|json] init-env [--force] [--dotenv-path <path>] [--example <path>]',
    emits: ['init-env', 'init-env.help'],
    dataSchema: '#/definitions/InitEnvPayload',
  }),
  commandContract({
    name: 'doctor',
    summary: 'Run environment and connectivity diagnostics.',
    usage: 'pandora [--output table|json] doctor [--dotenv-path <path>] [--skip-dotenv] [--check-usdc-code] [--check-polymarket] [--rpc-timeout-ms <ms>]',
    emits: ['doctor', 'doctor.help'],
    dataSchema: '#/definitions/DoctorPayload',
  }),
  commandContract({
    name: 'setup',
    summary: 'Write env file if needed and run doctor checks.',
    usage: 'pandora [--output table|json] setup [--force] [--dotenv-path <path>] [--example <path>] [--check-usdc-code] [--check-polymarket] [--rpc-timeout-ms <ms>]',
    emits: ['setup', 'setup.help'],
    dataSchema: '#/definitions/SetupPayload',
  }),
  commandContract({
    name: 'capabilities',
    summary: 'Return a compact runtime capability digest for agents.',
    usage: 'pandora [--output json] capabilities [--include-compatibility] [--runtime-local-readiness]',
    emits: ['capabilities', 'capabilities.help'],
    outputModes: ['json'],
    dataSchema: '#/definitions/CapabilitiesPayload',
    helpDataSchema: CAPABILITIES_HELP_SCHEMA_REF,
    mcpExposed: true,
    mcp: {
      command: ['capabilities'],
      description: 'Return runtime capability metadata derived from the Pandora agent contract registry.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'include-compatibility': booleanSchema('Include compatibility aliases in default discovery maps and digests.'),
          'runtime-local-readiness': booleanSchema('Use current host readiness instead of artifact-neutral readiness.'),
        },
      }),
      preferred: true,
    },
      agentPlatform: {
        expectedLatencyMs: 250,
        safeEquivalent: null,
        externalDependencies: [],
        supportsRemote: true,
        policyScopes: ['capabilities:read', 'contracts:read'],
      },
  }),
  commandContract({
    name: 'bootstrap',
    summary: 'Canonical agent bootstrap payload for cold clients and preferred-tool discovery.',
    usage: 'pandora [--output json] bootstrap [--include-compatibility]',
    emits: ['bootstrap', 'bootstrap.help'],
    outputModes: ['json'],
    dataSchema: '#/definitions/BootstrapPayload',
    helpDataSchema: COMMAND_HELP_SCHEMA_REF,
    agentWorkflow: {
      requiredTools: ['capabilities', 'schema'],
      recommendedTools: ['help'],
      notes: [
        'Start with capabilities to detect transport availability, remote endpoints, and documentation digests.',
        'Load schema next to capture JSON envelopes, command descriptors, and canonicalTool/preferred guidance before selecting tools.',
        'Prefer canonical tools whose preferred flag is true; treat aliasOf entries as backward-compatible compatibility aliases.',
      ],
    },
    mcpExposed: true,
    mcp: {
      command: ['bootstrap'],
      description: 'Return the preferred first-call bootstrap payload for cold agent clients.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'include-compatibility': booleanSchema('Include compatibility aliases in the bootstrap tool view.'),
        },
      }),
      preferred: true,
    },
    agentPlatform: {
      expectedLatencyMs: 250,
      safeEquivalent: 'capabilities',
      externalDependencies: [],
      supportsRemote: true,
      remoteEligible: true,
      policyScopes: ['capabilities:read', 'contracts:read', 'schema:read'],
    },
  }),
  commandContract({
    name: 'schema',
    summary: 'Emit JSON envelope schema plus command descriptor map for agents.',
    usage: 'pandora [--output json] schema [--include-compatibility]',
    emits: ['schema', 'schema.help'],
    outputModes: ['json'],
    dataSchema: '#/definitions/SchemaCommandPayload',
    helpDataSchema: SCHEMA_HELP_SCHEMA_REF,
    mcpExposed: true,
    mcp: {
      command: ['schema'],
      description: 'Return official Pandora JSON envelope schema.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'include-compatibility': booleanSchema('Include compatibility alias descriptors in addition to canonical commands.'),
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'mcp',
    summary: 'Run Pandora MCP server over stdio transport.',
    usage: 'pandora mcp',
    emits: ['mcp.help'],
    outputModes: ['table'],
    dataSchema: MCP_HELP_SCHEMA_REF,
    helpDataSchema: null,
  }),
  commandContract({
    name: 'agent',
    summary: 'Agent prompt workflow namespace for market drafting and validation.',
    usage: 'pandora [--output table|json] agent market hype|autocomplete|validate ...',
    emits: ['agent.help'],
    dataSchema: COMMAND_HELP_SCHEMA_REF,
    helpDataSchema: null,
  }),
  commandContract({
    name: 'agent.market.hype',
    summary: 'Emit AI prompt text for researching current trending topics and drafting hype market candidates.',
    usage:
      'pandora [--output table|json] agent market hype --area <sports|esports|politics|regional-news|breaking-news> [--region <text>] [--query <text>] [--market-type auto|amm|parimutuel|both] [--candidate-count <n>]',
    emits: ['agent.market.hype', 'agent.help'],
    dataSchema: '#/definitions/AgentMarketPromptPayload',
    mcpExposed: true,
    mcp: {
      command: ['agent', 'market', 'hype'],
      description: 'Emit AI prompt text for researching current trending topics and drafting hype market candidates.',
      inputSchema: buildInputSchema({
        flagProperties: {
          area: enumSchema(['sports', 'esports', 'politics', 'regional-news', 'breaking-news'], 'Trending topic area.'),
          region: stringSchema('Regional focus. Required when --area regional-news.'),
          query: stringSchema('Optional extra search hint or topic constraint.'),
          'market-type': enumSchema(['auto', 'amm', 'parimutuel', 'both'], 'Planning preference for market type.'),
          'candidate-count': integerSchema('Maximum number of candidate markets to draft.', { minimum: 1, maximum: 5 }),
        },
        requiredFlags: ['area'],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'agent.market.autocomplete',
    summary: 'Emit AI prompt text for drafting market rules, sources, and timing.',
    usage:
      'pandora [--output table|json] agent market autocomplete --question <text> [--market-type amm|parimutuel]',
    emits: ['agent.market.autocomplete', 'agent.help'],
    dataSchema: '#/definitions/AgentMarketPromptPayload',
    mcpExposed: true,
    mcp: {
      command: ['agent', 'market', 'autocomplete'],
      description: 'Emit AI autocomplete prompt for market drafting.',
      inputSchema: buildInputSchema({
        flagProperties: {
          question: stringSchema('Seed market question to refine into rules, sources, and timing.'),
          'market-type': enumSchema(['amm', 'parimutuel'], 'Target market type.'),
        },
        requiredFlags: ['question'],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'agent.market.validate',
    summary: 'Emit AI validation prompt text plus the exact attestation ticket required for execute mode.',
    usage:
      'pandora [--output table|json] agent market validate --question <text> --rules <text> --target-timestamp <unix-seconds> [--sources <url...>]',
    emits: ['agent.market.validate', 'agent.help'],
    dataSchema: '#/definitions/AgentMarketPromptPayload',
    mcpExposed: true,
    mcp: {
      command: ['agent', 'market', 'validate'],
      description: 'Emit AI validation prompt and required attestation ticket for market execution.',
      inputSchema: buildInputSchema({
        flagProperties: {
          question: stringSchema('Exact market question to validate.'),
          rules: stringSchema('Exact market rules to validate.'),
          'target-timestamp': integerSchema('Resolution timestamp in unix seconds.', { minimum: 1 }),
          sources: flexibleArraySchema(stringSchema(), 'Source URL list.'),
        },
        requiredFlags: ['question', 'rules', 'target-timestamp'],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'launch',
    summary: 'Launch a one-off market via the interactive/non-JSON deployment flow.',
    usage:
      'pandora launch --dry-run|--execute [options] --question "<text>" --rules "<resolution rules>" --sources "<url1>" "<url2>" [more] --target-timestamp <unix-seconds>',
    emits: ['launch.help'],
    outputModes: ['table'],
    agentWorkflow: {
      requiredTools: ['agent.market.validate'],
      recommendedTools: ['agent.market.autocomplete'],
      executeRequiresValidation: true,
      notes: [
        'When an agent drafts or executes a manual launch market, run autocomplete first if rules or timing still need refinement.',
        'Run agent.market.validate on the final payload before any execute path.',
      ],
    },
  }),
  commandContract({
    name: 'clone-bet',
    summary: 'Clone a market and optionally place an initial bet via the interactive/non-JSON flow.',
    usage:
      'pandora clone-bet --dry-run|--execute [options] --question "<text>" --rules "<resolution rules>" --sources "<url1>" "<url2>" [more] --target-timestamp <unix-seconds>',
    emits: ['clone-bet.help'],
    outputModes: ['table'],
    agentWorkflow: {
      requiredTools: ['agent.market.validate'],
      recommendedTools: ['agent.market.autocomplete'],
      executeRequiresValidation: true,
      notes: [
        'When an agent drafts or executes a clone-bet market, validate the final payload before execute mode.',
      ],
    },
  }),
  commandContract({
    name: 'markets',
    summary: 'Market command family help and routing entrypoint.',
    usage: 'pandora [--output table|json] markets list|get|mine|create plan|create run|hype plan|hype run|scan ...',
    emits: ['markets.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
  }),
  commandContract({
    name: 'markets.create',
    summary: 'Canonical JSON-safe market creation surface for agents and MCP clients. Legacy `launch` remains script-native.',
    usage:
      'pandora [--output table|json] markets create plan|run --question <text> --rules <text> --sources <url...> --target-timestamp <unix-seconds|iso> [--market-type amm|parimutuel] ...',
    emits: ['markets.create.help', 'markets.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
    mcpExposed: true,
    agentWorkflow: {
      requiredTools: ['agent.market.validate'],
      recommendedTools: ['agent.market.autocomplete'],
      executeRequiresValidation: true,
      notes: [
        'Use markets.create.plan to normalize a launch payload into a JSON-safe agent contract.',
        'Legacy launch remains script-native; use markets.create.run for the canonical agent/MCP creation surface.',
        'Validation tickets are bound to the exact final payload. Any change to question, rules, sources, target timestamp, liquidity, market type, fee/curve params, or distribution requires a fresh ticket.',
        'If distribution flags are omitted, markets.create seeds a balanced 50/50 pool. Set explicit percentage flags for directional markets.',
      ],
    },
    mcp: {
      command: ['markets', 'create'],
      description: 'Canonical JSON-safe market creation command family for agents and MCP clients. Use `markets.create.plan` to shape a creation payload and `markets.create.run` for dry-run or execute flows. Legacy `launch` remains script-native.',
      inputSchema: buildInputSchema(),
      preferred: true,
    },
  }),
  commandContract({
    name: 'markets.create.plan',
    summary: 'Normalize a market creation payload for agents and MCP clients. Legacy `launch` remains script-native.',
    usage:
      'pandora [--output table|json] markets create plan --question <text> --rules <text> --sources <url...> --target-timestamp <unix-seconds|iso> --liquidity-usdc <n> [--market-type amm|parimutuel] [--category <id|name>] [--distribution-yes <parts>] [--distribution-no <parts>] [--distribution-yes-pct <pct>] [--distribution-no-pct <pct>] [--fee-tier <500-50000>] [--max-imbalance <n>] [--curve-flattener <1-11>] [--curve-offset <0-16777215>] [--chain-id <id>] [--rpc-url <url>] [--oracle <address>] [--factory <address>] [--usdc <address>] [--arbiter <address>] [--min-close-lead-seconds <n>]',
    emits: ['markets.create.plan', 'markets.create.help', 'markets.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
    mcpExposed: true,
    agentWorkflow: {
      requiredTools: [],
      recommendedTools: ['agent.market.autocomplete'],
      executeRequiresValidation: false,
      notes: [
        'Use agent.market.autocomplete when the question, rules, or target timestamp still need refinement before creation.',
        'markets.create.plan is the canonical JSON-safe planning surface; legacy launch remains script-native.',
        'The emitted validation ticket is bound to the exact final payload. Any change to question, rules, sources, target timestamp, liquidity, market type, fee/curve params, or distribution requires a fresh validation pass.',
        'If distribution flags are omitted, markets.create seeds a balanced 50/50 pool. Set explicit percentage flags for directional markets.',
      ],
    },
    mcp: {
      command: ['markets', 'create', 'plan'],
      description: 'Normalize a market creation payload into a JSON-safe agent contract. Legacy `launch` remains script-native.',
      inputSchema: buildInputSchema({
        flagProperties: {
          question: stringSchema('Exact market question.'),
          rules: stringSchema('Exact resolution rules.'),
          sources: flexibleArraySchema(stringSchema(), 'Source URL list.'),
          'target-timestamp': buildTargetTimestampSchema('Resolution timestamp in unix seconds or ISO-8601 datetime.'),
          'market-type': enumSchema(['amm', 'parimutuel'], 'Market type.'),
          category: buildPollCategorySchema('Category id or canonical category name.'),
          'liquidity-usdc': numberSchema('Initial liquidity amount in USDC.', { minimum: 0 }),
          'distribution-yes': integerSchema('Initial YES distribution in parts-per-billion.', { minimum: 0, maximum: 1_000_000_000 }),
          'distribution-no': integerSchema('Initial NO distribution in parts-per-billion.', { minimum: 0, maximum: 1_000_000_000 }),
          'distribution-yes-pct': numberSchema('Initial YES distribution in percent.', { minimum: 0, maximum: 100 }),
          'distribution-no-pct': numberSchema('Initial NO distribution in percent.', { minimum: 0, maximum: 100 }),
          'fee-tier': integerSchema('Fee tier in hundredths of a bip.', { minimum: 500, maximum: 50000 }),
          'max-imbalance': integerSchema('Maximum AMM price imbalance guard.', { minimum: 0, maximum: 16_777_215 }),
          'curve-flattener': integerSchema('Pari-mutuel curve flattener.', { minimum: 1, maximum: 11 }),
          'curve-offset': integerSchema('Pari-mutuel curve offset.', { minimum: 0, maximum: 16_777_215 }),
          'chain-id': commonFlags.chainId,
          'rpc-url': commonFlags.rpcUrl,
          oracle: stringSchema('Oracle contract address.'),
          factory: stringSchema('Factory contract address.'),
          usdc: stringSchema('Collateral token address.'),
          arbiter: stringSchema('Arbiter address.'),
          'min-close-lead-seconds': integerSchema('Minimum required lead time before close.', { minimum: 1 }),
        },
        requiredFlags: ['question', 'rules', 'sources', 'target-timestamp', 'liquidity-usdc'],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'markets.create.run',
    summary: 'Dry-run or execute a canonical JSON-safe market creation payload. Legacy `launch` remains script-native.',
    usage:
      'pandora [--output table|json] markets create run --question <text> --rules <text> --sources <url...> --target-timestamp <unix-seconds|iso> --liquidity-usdc <n> [--market-type amm|parimutuel] [--category <id|name>] [--distribution-yes <parts>] [--distribution-no <parts>] [--distribution-yes-pct <pct>] [--distribution-no-pct <pct>] [--fee-tier <500-50000>] [--max-imbalance <n>] [--curve-flattener <1-11>] [--curve-offset <0-16777215>] [--dry-run|--execute] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--oracle <address>] [--factory <address>] [--usdc <address>] [--arbiter <address>] [--validation-ticket <ticket>] [--min-close-lead-seconds <n>]',
    emits: ['markets.create.run', 'markets.create.help', 'markets.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
    mcpExposed: true,
    agentWorkflow: {
      requiredTools: ['agent.market.validate'],
      recommendedTools: ['agent.market.autocomplete'],
      executeRequiresValidation: true,
      notes: [
        'Run agent.market.validate on the exact final market payload before execute mode.',
        'Legacy launch remains script-native; markets.create.run is the canonical agent/MCP market creation surface.',
        'Validation tickets are bound to the exact final payload. Any change to question, rules, sources, target timestamp, liquidity, market type, fee/curve params, or distribution requires a fresh ticket.',
        'If distribution flags are omitted, markets.create seeds a balanced 50/50 pool. Set explicit percentage flags for directional markets.',
      ],
    },
    mcp: {
      command: ['markets', 'create', 'run'],
      description: 'Dry-run or execute a canonical JSON-safe market creation payload. Legacy `launch` remains script-native.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          question: stringSchema('Exact market question.'),
          rules: stringSchema('Exact resolution rules.'),
          sources: flexibleArraySchema(stringSchema(), 'Source URL list.'),
          'target-timestamp': buildTargetTimestampSchema('Resolution timestamp in unix seconds or ISO-8601 datetime.'),
          'market-type': enumSchema(['amm', 'parimutuel'], 'Market type.'),
          category: buildPollCategorySchema('Category id or canonical category name.'),
          'liquidity-usdc': numberSchema('Initial liquidity amount in USDC.', { minimum: 0 }),
          'distribution-yes': integerSchema('Initial YES distribution in parts-per-billion.', { minimum: 0, maximum: 1_000_000_000 }),
          'distribution-no': integerSchema('Initial NO distribution in parts-per-billion.', { minimum: 0, maximum: 1_000_000_000 }),
          'distribution-yes-pct': numberSchema('Initial YES distribution in percent.', { minimum: 0, maximum: 100 }),
          'distribution-no-pct': numberSchema('Initial NO distribution in percent.', { minimum: 0, maximum: 100 }),
          'fee-tier': integerSchema('Fee tier in hundredths of a bip.', { minimum: 500, maximum: 50000 }),
          'max-imbalance': integerSchema('Maximum AMM price imbalance guard.', { minimum: 0, maximum: 16_777_215 }),
          'curve-flattener': integerSchema('Pari-mutuel curve flattener.', { minimum: 1, maximum: 11 }),
          'curve-offset': integerSchema('Pari-mutuel curve offset.', { minimum: 0, maximum: 16_777_215 }),
          'dry-run': booleanSchema('Run dry-run mode.'),
          execute: booleanSchema('Execute live creation.'),
          'chain-id': commonFlags.chainId,
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          'profile-id': commonFlags.profileId,
          'profile-file': commonFlags.profileFile,
          oracle: stringSchema('Oracle contract address.'),
          factory: stringSchema('Factory contract address.'),
          usdc: stringSchema('Collateral token address.'),
          arbiter: stringSchema('Arbiter address.'),
          'validation-ticket': stringSchema('Ticket returned by agent.market.validate for the exact final payload (CLI execute mode).'),
          'min-close-lead-seconds': integerSchema('Minimum required lead time before close.', { minimum: 1 }),
          agentPreflight: buildAgentPreflightSchema('Agent validation attestation for execute mode.'),
        },
        requiredFlags: ['question', 'rules', 'sources', 'target-timestamp', 'liquidity-usdc'],
        oneOf: buildExclusivePresenceBranches([['dry-run'], ['execute']]),
      }),
      preferred: true,
      mutating: true,
      safeFlags: ['--dry-run'],
      executeFlags: ['--execute'],
      controlInputNames: ['agentPreflight'],
    },
  }),
  commandContract({
    name: 'markets.hype',
    summary: 'Research current public-web trends, draft hype market candidates, and optionally run a frozen hype plan.',
    usage:
      'pandora [--output table|json] markets hype plan|run --area <sports|esports|politics|regional-news|breaking-news> ...',
    emits: ['markets.hype.help', 'markets.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
    mcpExposed: true,
    agentWorkflow: {
      requiredTools: ['agent.market.validate'],
      recommendedTools: ['agent.market.hype', 'scan'],
      executeRequiresValidation: true,
      notes: [
        'Use markets.hype.plan to turn fresh public-web research into a frozen, reusable market plan.',
        'The selected candidate is validated before planning completes; pass the emitted PASS attestation back as agentPreflight for execute-mode MCP runs.',
        'markets.hype.run should consume a saved plan file so the research snapshot, sources, and validation result do not drift between planning and deployment.',
      ],
    },
    mcp: {
      command: ['markets', 'hype'],
      description: 'Research current trends, draft hype market candidates, and optionally run a frozen plan file.',
      inputSchema: buildInputSchema(),
      preferred: true,
    },
  }),
  commandContract({
    name: 'markets.hype.plan',
    summary: 'Research current trending topics, score hype candidates, recommend AMM vs pari-mutuel, and validate the drafted market payloads.',
    usage:
      'pandora [--output table|json] markets hype plan --area <sports|esports|politics|regional-news|breaking-news> [--region <text>] [--query <text>] [--candidate-count <n>] [--market-type auto|amm|parimutuel|both] [--liquidity-usdc <n>] [--ai-provider auto|openai|anthropic|mock] [--ai-model <id>] [--search-depth fast|standard|deep] [--chain-id <id>] [--rpc-url <url>] [--oracle <address>] [--factory <address>] [--usdc <address>] [--arbiter <address>] [--min-close-lead-seconds <n>]',
    emits: ['markets.hype.plan', 'markets.hype.help', 'markets.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
    mcpExposed: true,
    agentWorkflow: {
      requiredTools: [],
      recommendedTools: ['agent.market.hype', 'scan'],
      executeRequiresValidation: false,
      notes: [
        'markets.hype.plan performs bounded provider-backed trend research and freezes the resulting candidate set into a reusable plan payload.',
        'Use the emitted candidate validation results and attestation for execute-mode MCP runs instead of re-running live research during deployment.',
        'Review duplicateRiskScore and duplicateMatches before choosing a candidate to deploy.',
      ],
    },
    mcp: {
      command: ['markets', 'hype', 'plan'],
      description: 'Research current trending topics, draft hype market candidates, and validate them into a frozen planning payload.',
      inputSchema: buildInputSchema({
        flagProperties: {
          area: enumSchema(['sports', 'esports', 'politics', 'regional-news', 'breaking-news'], 'Trending topic area.'),
          region: stringSchema('Regional focus. Required when --area regional-news.'),
          query: stringSchema('Optional extra search hint or topic constraint.'),
          'candidate-count': integerSchema('Maximum number of candidate markets to draft.', { minimum: 1, maximum: 5 }),
          'market-type': enumSchema(['auto', 'amm', 'parimutuel', 'both'], 'Planning preference for market type.'),
          'liquidity-usdc': numberSchema('Suggested initial liquidity for generated drafts.', { minimum: 0 }),
          'ai-provider': enumSchema(['auto', 'openai', 'anthropic', 'mock'], 'Research provider selection.'),
          'ai-model': stringSchema('Model override for the selected provider.'),
          'search-depth': enumSchema(['fast', 'standard', 'deep'], 'Bounded search depth hint for the provider.'),
          'chain-id': commonFlags.chainId,
          'rpc-url': commonFlags.rpcUrl,
          oracle: stringSchema('Oracle contract address.'),
          factory: stringSchema('Factory contract address.'),
          usdc: stringSchema('Collateral token address.'),
          arbiter: stringSchema('Arbiter address.'),
          'min-close-lead-seconds': integerSchema('Minimum required lead time before close.', { minimum: 1 }),
        },
        requiredFlags: ['area'],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'markets.hype.run',
    summary: 'Dry-run or execute a frozen hype plan candidate without re-running live trend research.',
    usage:
      'pandora [--output table|json] markets hype run --plan-file <path> [--candidate-id <id>] [--market-type selected|amm|parimutuel] --dry-run|--execute [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--oracle <address>] [--factory <address>] [--usdc <address>] [--arbiter <address>]',
    emits: ['markets.hype.run', 'markets.hype.help', 'markets.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
    mcpExposed: true,
    agentWorkflow: {
      requiredTools: ['markets.hype.plan'],
      recommendedTools: ['agent.market.validate'],
      executeRequiresValidation: true,
      notes: [
        'markets.hype.run is intentionally plan-file based so the exact research snapshot and validation attestation remain frozen between plan and execute.',
        'Execute-mode MCP calls should copy the selected candidate PASS attestation from markets.hype.plan back as agentPreflight.',
        'Avoid editing question, rules, sources, or targetTimestamp after planning; regenerate the hype plan instead.',
      ],
    },
    mcp: {
      command: ['markets', 'hype', 'run'],
      description: 'Dry-run or execute a frozen hype plan candidate without re-running live trend research.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'plan-file': stringSchema('Saved hype plan file path.'),
          'candidate-id': stringSchema('Explicit candidate id from the plan payload.'),
          'market-type': enumSchema(['selected', 'amm', 'parimutuel'], 'Draft to deploy from the selected candidate.'),
          'dry-run': booleanSchema('Run dry-run mode.'),
          execute: booleanSchema('Execute live deployment.'),
          'chain-id': commonFlags.chainId,
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          'profile-id': commonFlags.profileId,
          'profile-file': commonFlags.profileFile,
          oracle: stringSchema('Oracle contract address.'),
          factory: stringSchema('Factory contract address.'),
          usdc: stringSchema('Collateral token address.'),
          arbiter: stringSchema('Arbiter address.'),
          agentPreflight: buildAgentPreflightSchema('PASS attestation from the selected hype-plan candidate validation.'),
        },
        requiredFlags: ['plan-file'],
        oneOf: buildExclusivePresenceBranches([['dry-run'], ['execute']]),
      }),
      preferred: true,
      mutating: true,
      safeFlags: ['--dry-run'],
      executeFlags: ['--execute'],
      controlInputNames: ['agentPreflight'],
    },
  }),
  commandContract({
    name: 'markets.list',
    summary: 'Raw Pandora market browse view with filters and pagination.',
    usage:
      'pandora [--output table|json] markets list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>|--type <type>] [--where-json <json>] [--active|--resolved|--expiring-soon] [--expiring-hours <n>] [--min-tvl <usdc>] [--hedgeable] [--expand] [--with-odds]',
    emits: ['markets.list', 'markets.list.help'],
    dataSchema: '#/definitions/PagedEntityPayload',
    mcpExposed: true,
    mcp: {
      command: ['markets', 'list'],
      description: 'List Pandora markets with filters. Use `--creator` for creator-scoped discovery; use `markets mine` for wallet-owned exposure discovery.',
      inputSchema: buildInputSchema({
        flagProperties: {
          limit: commonFlags.limit,
          after: stringSchema('Pagination cursor.'),
          before: stringSchema('Pagination cursor.'),
          'order-by': enumSchema(['createdAt', 'marketCloseTimestamp', 'totalVolume', 'currentTvl'], 'Sort field.'),
          'order-direction': enumSchema(['asc', 'desc'], 'Sort direction.'),
          'chain-id': commonFlags.chainId,
          creator: stringSchema('Creator address.'),
          'poll-address': commonFlags.pollAddress,
          'market-type': stringSchema('Market type filter.'),
          type: stringSchema('Alias for market type filter.'),
          'where-json': stringSchema('Raw JSON filter override.'),
          active: booleanSchema('Filter active markets.'),
          resolved: booleanSchema('Filter resolved markets.'),
          'expiring-soon': booleanSchema('Filter expiring markets.'),
          'expiring-hours': numberSchema('Expiring-soon window in hours.', { minimum: 0 }),
          'min-tvl': numberSchema('Minimum TVL in USDC.', { minimum: 0 }),
          hedgeable: booleanSchema('Keep only hedgeable markets.'),
          expand: booleanSchema('Expand enriched market payload.'),
          'with-odds': booleanSchema('Include odds enrichment.'),
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'markets.get',
    summary: 'Get one or many markets by id.',
    usage: 'pandora [--output table|json] markets get [--id <id> ...] [--stdin]',
    emits: ['markets.get', 'markets.get.help'],
    dataSchema: '#/definitions/EntityCollectionPayload',
    mcpExposed: true,
    mcp: {
      command: ['markets', 'get'],
      description: 'Get one or more markets by id.',
      inputSchema: buildInputSchema({
        flagProperties: {
          id: stringSchema('Market id, or a comma-delimited list of market ids.', {
            minLength: 1,
            xPandora: {
              acceptsCommaSeparatedList: true,
            },
          }),
          stdin: booleanSchema('Read newline-delimited ids from stdin.'),
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'markets.mine',
    summary: 'Discover wallet-owned Pandora market exposure from positions, LP balances, and claimable outcomes.',
    usage:
      'pandora [--output table|json] markets mine [--wallet <address>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--indexer-url <url>] [--timeout-ms <ms>]',
    emits: ['markets.mine', 'markets.mine.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
    mcpExposed: true,
    mcp: {
      command: ['markets', 'mine'],
      description: 'Discover wallet-owned Pandora market exposure. Accepts an explicit wallet or signer credentials; profile-based signer resolution needs `--rpc-url`.',
      inputSchema: buildInputSchema({
        flagProperties: {
          wallet: stringSchema('Wallet address to inspect.'),
          'chain-id': commonFlags.chainId,
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          'profile-id': commonFlags.profileId,
          'profile-file': commonFlags.profileFile,
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'scan',
    summary: 'Canonical enriched market discovery view with odds and lifecycle filters.',
    usage:
      'pandora [--output table|json] scan [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>|--type <type>] [--where-json <json>] [--active|--resolved|--expiring-soon] [--expiring-hours <n>] [--min-tvl <usdc>] [--hedgeable] [--expand] [--with-odds]',
    emits: ['scan', 'scan.help'],
    dataSchema: '#/definitions/PagedEntityPayload',
    mcpExposed: true,
    canonicalTool: 'scan',
    mcp: {
      command: ['scan'],
      description: 'Canonical enriched market discovery flow. Use `--creator` for creator-scoped discovery; use `markets mine` for wallet-owned exposure discovery.',
      inputSchema: buildInputSchema({
        flagProperties: {
          limit: commonFlags.limit,
          after: stringSchema('Pagination cursor.'),
          before: stringSchema('Pagination cursor.'),
          'order-by': enumSchema(['createdAt', 'marketCloseTimestamp', 'totalVolume', 'currentTvl'], 'Sort field.'),
          'order-direction': enumSchema(['asc', 'desc'], 'Sort direction.'),
          'chain-id': commonFlags.chainId,
          creator: stringSchema('Creator address.'),
          'poll-address': commonFlags.pollAddress,
          'market-type': stringSchema('Market type filter.'),
          type: stringSchema('Alias for market type filter.'),
          'where-json': stringSchema('Raw JSON filter override.'),
          active: booleanSchema('Filter active markets.'),
          resolved: booleanSchema('Filter resolved markets.'),
          'expiring-soon': booleanSchema('Filter expiring markets.'),
          'expiring-hours': numberSchema('Expiring-soon window in hours.', { minimum: 0 }),
          'min-tvl': numberSchema('Minimum TVL in USDC.', { minimum: 0 }),
          hedgeable: booleanSchema('Keep only hedgeable markets.'),
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'markets.scan',
    summary: 'Backward-compatible alias of `scan`.',
    usage:
      'pandora [--output table|json] markets scan [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>|--type <type>] [--where-json <json>] [--active|--resolved|--expiring-soon] [--expiring-hours <n>] [--min-tvl <usdc>] [--hedgeable] [--expand] [--with-odds]',
    emits: ['scan', 'scan.help'],
    dataSchema: '#/definitions/PagedEntityPayload',
    aliasOf: 'scan',
  }),
  commandContract({
    name: 'quote',
    summary: 'Estimate a YES/NO buy or sell quote from current market conditions, including AMM buy quotes that solve to a target YES percentage.',
    usage:
      'pandora [--output table|json] quote [--indexer-url <url>] [--timeout-ms <ms>] --market-address <address> --side yes|no [--mode buy|sell] --amount-usdc <amount>|--shares <amount>|--amounts <csv>|--target-pct <0-100> [--yes-pct <0-100>] [--slippage-bps <0-10000>]',
    emits: ['quote', 'quote.help'],
    dataSchema: '#/definitions/QuotePayload',
    mcpExposed: true,
    mcp: {
      command: ['quote'],
      description: 'Build YES/NO quote estimates. `--target-pct` is buy-only and solves the required AMM trade size to reach a target YES percentage; do not combine it with explicit buy amounts.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
          'market-address': commonFlags.marketAddress,
          side: enumSchema(['yes', 'no'], 'Outcome side.'),
          mode: enumSchema(['buy', 'sell'], 'Quote mode.'),
          'amount-usdc': numberSchema('Trade notional in USDC.', { minimum: 0 }),
          shares: numberSchema('Outcome-token amount for sell mode.', { minimum: 0 }),
          amounts: stringSchema('Comma-delimited curve sizes in USDC.'),
          'target-pct': numberSchema('Target YES probability percent for AMM buy quotes.', { minimum: 0, maximum: 100 }),
          'yes-pct': numberSchema('Override YES probability percent.', { minimum: 0, maximum: 100 }),
          'slippage-bps': integerSchema('Slippage in basis points.', { minimum: 0, maximum: 10000 }),
        },
        requiredFlags: ['market-address', 'side'],
        anyOf: [['amount-usdc'], ['shares'], ['amounts'], ['target-pct']],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'trade',
    summary: 'Execute or dry-run a buy flow with optional risk constraints.',
    usage:
      'pandora [--output table|json] trade [--indexer-url <url>] [--timeout-ms <ms>] [--dotenv-path <path>] [--skip-dotenv] --market-address <address> --side yes|no --amount-usdc <amount> --dry-run|--execute [--yes-pct <0-100>] [--slippage-bps <0-10000>] [--min-shares-out-raw <uint>] [--max-amount-usdc <amount>] [--min-probability-pct <0-100>] [--max-probability-pct <0-100>] [--allow-unquoted-execute] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--usdc <address>]',
    emits: ['trade', 'trade.help', 'trade.quote.help'],
    dataSchema: '#/definitions/TradePayload',
    mcpExposed: true,
    mcp: {
      command: ['trade'],
      description: 'Dry-run or execute a Pandora trade.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
          'dotenv-path': stringSchema('Env file path.'),
          'skip-dotenv': booleanSchema('Skip env loading.'),
          'market-address': commonFlags.marketAddress,
          side: enumSchema(['yes', 'no'], 'Outcome side.'),
          'amount-usdc': numberSchema('Trade notional in USDC.', { minimum: 0 }),
          'dry-run': booleanSchema('Run dry-run mode.'),
          execute: booleanSchema('Execute live trade.'),
          'yes-pct': numberSchema('Override YES probability percent.', { minimum: 0, maximum: 100 }),
          'slippage-bps': integerSchema('Slippage in basis points.', { minimum: 0, maximum: 10000 }),
          'min-shares-out-raw': stringSchema('Minimum shares out as raw uint.'),
          'max-amount-usdc': numberSchema('Maximum notional guard.', { minimum: 0 }),
          'min-probability-pct': numberSchema('Minimum allowed probability percent.', { minimum: 0, maximum: 100 }),
          'max-probability-pct': numberSchema('Maximum allowed probability percent.', { minimum: 0, maximum: 100 }),
          'allow-unquoted-execute': booleanSchema('Allow execution without quote freshness guard.'),
          fork: booleanSchema('Run in fork mode.'),
          'fork-rpc-url': stringSchema('Fork RPC URL.'),
          'fork-chain-id': integerSchema('Fork chain id.', { minimum: 1 }),
          'chain-id': commonFlags.chainId,
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          'profile-id': commonFlags.profileId,
          'profile-file': commonFlags.profileFile,
          usdc: stringSchema('USDC token address override.'),
        },
        requiredFlags: ['market-address', 'side', 'amount-usdc'],
      }),
      preferred: true,
      mutating: true,
      safeFlags: ['--dry-run'],
      executeFlags: ['--execute'],
    },
  }),
  commandContract({
    name: 'trade.quote',
    summary: 'Backward-compatible subcommand alias of `quote` under `trade`.',
    usage:
      'pandora [--output table|json] trade quote --market-address <address> --side yes|no [--mode buy|sell] --amount-usdc <amount>|--shares <amount>|--amounts <csv> [--yes-pct <0-100>] [--slippage-bps <0-10000>]',
    emits: ['trade.quote.help'],
    dataSchema: '#/definitions/QuotePayload',
    aliasOf: 'quote',
  }),
  commandContract({
    name: 'sell',
    summary: 'Execute or dry-run an AMM sell flow.',
    usage:
      'pandora [--output table|json] sell [--indexer-url <url>] [--timeout-ms <ms>] [--dotenv-path <path>] [--skip-dotenv] --market-address <address> --side yes|no --shares <amount>|--amount <amount> --dry-run|--execute [--yes-pct <0-100>] [--slippage-bps <0-10000>] [--min-amount-out-raw <uint>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--usdc <address>]',
    emits: ['sell', 'sell.help', 'sell.quote.help'],
    dataSchema: '#/definitions/TradePayload',
    mcpExposed: true,
    mcp: {
      command: ['sell'],
      description: 'Dry-run or execute an AMM sell.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
          'dotenv-path': stringSchema('Env file path.'),
          'skip-dotenv': booleanSchema('Skip env loading.'),
          'market-address': commonFlags.marketAddress,
          side: enumSchema(['yes', 'no'], 'Outcome side.'),
          shares: numberSchema('Outcome-token amount to sell.', { minimum: 0 }),
          amount: numberSchema('Outcome-token amount to sell.', { minimum: 0 }),
          'dry-run': booleanSchema('Run dry-run mode.'),
          execute: booleanSchema('Execute live sell.'),
          'yes-pct': numberSchema('Override YES probability percent.', { minimum: 0, maximum: 100 }),
          'slippage-bps': integerSchema('Slippage in basis points.', { minimum: 0, maximum: 10000 }),
          'min-amount-out-raw': stringSchema('Minimum collateral out as raw uint.'),
          fork: booleanSchema('Run in fork mode.'),
          'fork-rpc-url': stringSchema('Fork RPC URL.'),
          'fork-chain-id': integerSchema('Fork chain id.', { minimum: 1 }),
          'chain-id': commonFlags.chainId,
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          'profile-id': commonFlags.profileId,
          'profile-file': commonFlags.profileFile,
          usdc: stringSchema('USDC token address override.'),
        },
        requiredFlags: ['market-address', 'side'],
        anyOf: [['shares'], ['amount']],
      }),
      preferred: true,
      mutating: true,
      safeFlags: ['--dry-run'],
      executeFlags: ['--execute'],
    },
  }),
  commandContract({
    name: 'sell.quote',
    summary: 'Backward-compatible quote entrypoint under `sell`.',
    usage:
      'pandora [--output table|json] sell quote --market-address <address> --side yes|no --shares <amount>|--amount <amount>|--amounts <csv> [--yes-pct <0-100>] [--slippage-bps <0-10000>]',
    emits: ['sell.quote.help'],
    dataSchema: '#/definitions/QuotePayload',
    aliasOf: 'quote',
  }),
  commandContract({
    name: 'lp',
    summary: 'LP command family help and routing entrypoint.',
    usage:
      'pandora [--output table|json] lp add|remove|positions [--market-address <address>] [--wallet <address>] [--amount-usdc <n>] [--lp-tokens <n>|--all|--all-markets] [--dry-run|--execute] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--usdc <address>] [--deadline-seconds <n>] [--indexer-url <url>] [--timeout-ms <ms>]\n'
      + 'pandora [--output table|json] lp simulate-remove --market-address <address> [--wallet <address>] [--lp-tokens <n>|--all] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>]',
    emits: ['lp.help'],
    dataSchema: '#/definitions/LpPayload',
  }),
  commandContract({
    name: 'lp.add',
    summary: 'Dry-run or execute LP add.',
    usage:
      'pandora [--output table|json] lp add --market-address <address> --amount-usdc <n> --dry-run|--execute [--wallet <address>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--usdc <address>] [--deadline-seconds <n>] [--indexer-url <url>] [--timeout-ms <ms>]',
    emits: ['lp.help'],
    dataSchema: '#/definitions/LpPayload',
    mcpExposed: true,
    mcp: {
      command: ['lp', 'add'],
      description: 'Dry-run or execute LP add.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'market-address': commonFlags.marketAddress,
          'amount-usdc': numberSchema('LP add amount in USDC.', { minimum: 0 }),
          wallet: commonFlags.wallet,
          'dry-run': booleanSchema('Run dry-run mode.'),
          execute: booleanSchema('Execute live LP add.'),
          fork: booleanSchema('Run in fork mode.'),
          'fork-rpc-url': stringSchema('Fork RPC URL.'),
          'fork-chain-id': integerSchema('Fork chain id.', { minimum: 1 }),
          'chain-id': commonFlags.chainId,
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          'profile-id': commonFlags.profileId,
          'profile-file': commonFlags.profileFile,
          usdc: stringSchema('USDC token address override.'),
          'deadline-seconds': integerSchema('Deadline offset in seconds.', { minimum: 1 }),
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
        },
        requiredFlags: ['market-address', 'amount-usdc'],
      }),
      preferred: true,
      mutating: true,
      safeFlags: ['--dry-run'],
      executeFlags: ['--execute'],
    },
  }),
  commandContract({
    name: 'lp.remove',
    summary: 'Dry-run or execute LP remove.',
    usage:
      'pandora [--output table|json] lp remove [--market-address <address>] [--wallet <address>] [--lp-tokens <n>|--all|--all-markets] --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--usdc <address>] [--deadline-seconds <n>] [--indexer-url <url>] [--timeout-ms <ms>]',
    emits: ['lp.help'],
    dataSchema: '#/definitions/LpPayload',
    mcpExposed: true,
    mcp: {
      command: ['lp', 'remove'],
      description: 'Dry-run or execute LP remove.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'market-address': commonFlags.marketAddress,
          wallet: commonFlags.wallet,
          'lp-tokens': numberSchema('LP token amount to remove.', { minimum: 0 }),
          all: booleanSchema('Remove full LP balance for the selected market.'),
          'all-markets': booleanSchema('Remove LP from every discovered market.'),
          'dry-run': booleanSchema('Run dry-run mode.'),
          execute: booleanSchema('Execute live LP remove.'),
          fork: booleanSchema('Run in fork mode.'),
          'fork-rpc-url': stringSchema('Fork RPC URL.'),
          'fork-chain-id': integerSchema('Fork chain id.', { minimum: 1 }),
          'chain-id': commonFlags.chainId,
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          'profile-id': commonFlags.profileId,
          'profile-file': commonFlags.profileFile,
          usdc: stringSchema('USDC token address override.'),
          'deadline-seconds': integerSchema('Deadline offset in seconds.', { minimum: 1 }),
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
        },
      }),
      preferred: true,
      mutating: true,
      safeFlags: ['--dry-run'],
      executeFlags: ['--execute'],
    },
  }),
  commandContract({
    name: 'lp.positions',
    summary: 'Read LP positions for a wallet.',
    usage:
      'pandora [--output table|json] lp positions [--market-address <address>] [--wallet <address>] [--indexer-url <url>] [--timeout-ms <ms>] [--rpc-url <url>]',
    emits: ['lp.help'],
    dataSchema: '#/definitions/LpPayload',
    mcpExposed: true,
    mcp: {
      command: ['lp', 'positions'],
      description: 'Read LP positions for wallet.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'market-address': commonFlags.marketAddress,
          wallet: commonFlags.wallet,
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
          'rpc-url': commonFlags.rpcUrl,
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'lp.simulate-remove',
    summary: 'Preview LP removal without submitting a transaction.',
    usage:
      'pandora [--output table|json] lp simulate-remove --market-address <address> [--wallet <address>] [--lp-tokens <n>|--all] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>]',
    emits: ['lp.help'],
    dataSchema: '#/definitions/LpPayload',
    mcpExposed: true,
    mcp: {
      command: ['lp', 'simulate-remove'],
      description: 'Preview LP removal without submitting a transaction.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'market-address': commonFlags.marketAddress,
          wallet: commonFlags.wallet,
          'lp-tokens': numberSchema('LP token amount to preview removing.', { minimum: 0 }),
          all: booleanSchema('Preview removing the full LP balance for the selected market.'),
          fork: booleanSchema('Run in fork mode.'),
          'fork-rpc-url': stringSchema('Fork RPC URL.'),
          'fork-chain-id': integerSchema('Fork chain id.', { minimum: 1 }),
          'chain-id': commonFlags.chainId,
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          'profile-id': commonFlags.profileId,
          'profile-file': commonFlags.profileFile,
        },
        requiredFlags: ['market-address'],
        anyOf: [['lp-tokens'], ['all']],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'resolve',
    summary: 'Dry-run or execute poll resolution.',
    usage:
      'pandora [--output table|json] resolve [--dotenv-path <path>] [--skip-dotenv] --poll-address <address> --answer yes|no|invalid --reason <text> --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>]',
    emits: ['resolve', 'resolve.help'],
    dataSchema: '#/definitions/ResolvePayload',
    mcpExposed: true,
    mcp: {
      command: ['resolve'],
      description: 'Dry-run or execute poll resolution.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'dotenv-path': stringSchema('Env file path.'),
          'skip-dotenv': booleanSchema('Skip env loading.'),
          'poll-address': commonFlags.pollAddress,
          answer: enumSchema(['yes', 'no', 'invalid'], 'Resolution answer.'),
          reason: stringSchema('Operator reason string.'),
          'dry-run': booleanSchema('Run dry-run mode.'),
          execute: booleanSchema('Execute live resolution.'),
          fork: booleanSchema('Run in fork mode.'),
          'fork-rpc-url': stringSchema('Fork RPC URL.'),
          'fork-chain-id': integerSchema('Fork chain id.', { minimum: 1 }),
          'chain-id': commonFlags.chainId,
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          'profile-id': commonFlags.profileId,
          'profile-file': commonFlags.profileFile,
        },
        requiredFlags: ['poll-address', 'answer', 'reason'],
      }),
      preferred: true,
      mutating: true,
      safeFlags: ['--dry-run'],
      executeFlags: ['--execute'],
    },
  }),
  commandContract({
    name: 'claim',
    summary: 'Dry-run or execute winnings redemption for one market or all discovered markets.',
    usage:
      'pandora [--output table|json] claim [--dotenv-path <path>] [--skip-dotenv] --market-address <address>|--all [--wallet <address>] --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--indexer-url <url>] [--timeout-ms <ms>]',
    emits: ['claim', 'claim.help'],
    dataSchema: '#/definitions/ClaimPayload',
    mcpExposed: true,
    mcp: {
      command: ['claim'],
      description: 'Dry-run or execute winnings redemption.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'dotenv-path': stringSchema('Env file path.'),
          'skip-dotenv': booleanSchema('Skip env loading.'),
          'market-address': commonFlags.marketAddress,
          all: booleanSchema('Claim on all discovered finalized markets.'),
          wallet: commonFlags.wallet,
          'dry-run': booleanSchema('Run dry-run mode.'),
          execute: booleanSchema('Execute live claims.'),
          fork: booleanSchema('Run in fork mode.'),
          'fork-rpc-url': stringSchema('Fork RPC URL.'),
          'fork-chain-id': integerSchema('Fork chain id.', { minimum: 1 }),
          'chain-id': commonFlags.chainId,
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          'profile-id': commonFlags.profileId,
          'profile-file': commonFlags.profileFile,
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
        },
      }),
      preferred: true,
      mutating: true,
      safeFlags: ['--dry-run'],
      executeFlags: ['--execute'],
    },
  }),
  commandContract({
    name: 'watch',
    summary: 'Poll portfolio and/or market snapshots with alert thresholds plus watch-scoped exposure and hedge-gap risk limits.',
    usage:
      'pandora [--output table|json] watch [--wallet <address>] [--market-address <address>] [--side yes|no] [--amount-usdc <amount>] [--once|--iterations <n>] [--interval-ms <ms>] [--chain-id <id>] [--include-events|--no-events] [--yes-pct <0-100>] [--alert-yes-below <0-100>] [--alert-yes-above <0-100>] [--alert-net-liquidity-below <amount>] [--alert-net-liquidity-above <amount>] [--alert-exposure-above <amount>] [--alert-hedge-gap-above <amount>] [--max-trade-size-usdc <amount>] [--max-daily-volume-usdc <amount>] [--max-total-exposure-usdc <amount>] [--max-per-market-exposure-usdc <amount>] [--max-hedge-gap-usdc <amount>] [--fail-on-alert] [--track-brier] [--brier-source <name>] [--brier-file <path>] [--group-by source|market|competition]',
    emits: ['watch', 'watch.help'],
    dataSchema: '#/definitions/WatchPayload',
    mcpExposed: true,
    mcp: {
      command: ['watch'],
      description: 'Run watch snapshots with optional quote alerts and watch-scoped exposure or hedge-gap guardrails. Use `once=true` for a single bounded snapshot in MCP; unbounded watch-style polling remains blocked in MCP v1 because it is long-running.',
      inputSchema: buildInputSchema({
        flagProperties: {
          wallet: commonFlags.wallet,
          'market-address': commonFlags.marketAddress,
          side: enumSchema(['yes', 'no'], 'Outcome side.'),
          'amount-usdc': numberSchema('Trade notional in USDC.', { minimum: 0 }),
          once: booleanSchema('Run exactly one watch snapshot (equivalent to --once / --iterations 1).'),
          iterations: integerSchema('Number of watch iterations.', { minimum: 1 }),
          'interval-ms': integerSchema('Delay between watch iterations.', { minimum: 1 }),
          'chain-id': commonFlags.chainId,
          'include-events': booleanSchema('Include event aggregation.'),
          'no-events': booleanSchema('Skip event aggregation.'),
          'yes-pct': numberSchema('Override YES probability percent.', { minimum: 0, maximum: 100 }),
          'alert-yes-below': numberSchema('Alert threshold for low YES probability.', { minimum: 0, maximum: 100 }),
          'alert-yes-above': numberSchema('Alert threshold for high YES probability.', { minimum: 0, maximum: 100 }),
          'alert-net-liquidity-below': numberSchema('Alert threshold for low liquidity.', { minimum: 0 }),
          'alert-net-liquidity-above': numberSchema('Alert threshold for high liquidity.', { minimum: 0 }),
          'alert-exposure-above': numberSchema('Alert threshold for observed total exposure in USDC.', { minimum: 0 }),
          'alert-hedge-gap-above': numberSchema('Alert threshold for observed hedge gap in USDC.', { minimum: 0 }),
          'max-trade-size-usdc': numberSchema('Maximum projected trade size in USDC for watch risk policy.', { minimum: 0 }),
          'max-daily-volume-usdc': numberSchema('Maximum projected daily volume in USDC for watch risk policy.', { minimum: 0 }),
          'max-total-exposure-usdc': numberSchema('Maximum observed total exposure in USDC for watch risk policy.', { minimum: 0 }),
          'max-per-market-exposure-usdc': numberSchema('Maximum observed single-market exposure in USDC for watch risk policy.', { minimum: 0 }),
          'max-hedge-gap-usdc': numberSchema('Maximum observed hedge gap in USDC for watch risk policy.', { minimum: 0 }),
          'fail-on-alert': booleanSchema('Exit non-zero when alerts fire.'),
          'track-brier': booleanSchema('Persist forecast records for Brier scoring.'),
          'brier-source': stringSchema('Forecast source label.'),
          'brier-file': stringSchema('Forecast ledger path.'),
          'group-by': enumSchema(['source', 'market', 'competition'], 'Brier grouping label.'),
        },
      }),
      preferred: true,
      longRunningBlocked: true,
    },
  }),
  commandContract({
    name: 'stream',
    summary: 'Emit NDJSON stream ticks for prices or events.',
    usage:
      'pandora stream prices|events [--indexer-url <url>] [--indexer-ws-url <url>] [--timeout-ms <ms>] [--interval-ms <ms>] [--market-address <address>] [--chain-id <id>] [--limit <n>]',
    emits: ['stream.help'],
    outputModes: ['table', 'json'],
    dataSchema: '#/definitions/StreamTickPayload',
  }),
  commandContract({
    name: 'polls',
    summary: 'Poll command family help and routing entrypoint.',
    usage: 'pandora [--output table|json] polls list|get ...',
    emits: ['polls.help'],
    dataSchema: '#/definitions/PagedEntityPayload',
  }),
  commandContract({
    name: 'polls.list',
    summary: 'List poll entities.',
    usage:
      'pandora [--output table|json] polls list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--where-json <json>]',
    emits: ['polls.list', 'polls.list.help', 'polls.help'],
    dataSchema: '#/definitions/PagedEntityPayload',
    mcpExposed: true,
    mcp: {
      command: ['polls', 'list'],
      description: 'List poll entities.',
      inputSchema: buildInputSchema({
        flagProperties: {
          limit: commonFlags.limit,
          after: stringSchema('Pagination cursor.'),
          before: stringSchema('Pagination cursor.'),
          'order-by': stringSchema('Sort field.'),
          'order-direction': enumSchema(['asc', 'desc'], 'Sort direction.'),
          'chain-id': commonFlags.chainId,
          creator: stringSchema('Creator address.'),
          'where-json': stringSchema('Raw JSON filter override.'),
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'polls.get',
    summary: 'Get one poll by id.',
    usage: 'pandora [--output table|json] polls get --id <id>',
    emits: ['polls.get', 'polls.get.help', 'polls.help'],
    dataSchema: '#/definitions/EntityCollectionPayload',
    mcpExposed: true,
    mcp: {
      command: ['polls', 'get'],
      description: 'Get one poll by id.',
      inputSchema: buildInputSchema({
        flagProperties: { id: stringSchema('Poll id.') },
        requiredFlags: ['id'],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'events',
    summary: 'Event command family help and routing entrypoint.',
    usage: 'pandora [--output table|json] events list|get ...',
    emits: ['events.help'],
    dataSchema: '#/definitions/PagedEntityPayload',
  }),
  commandContract({
    name: 'events.list',
    summary: 'List event entities.',
    usage:
      'pandora [--output table|json] events list [--wallet <address>] [--market-address <address>] [--chain-id <id>] [--status open|won|lost|closed|all] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc]',
    emits: ['events.list', 'events.list.help', 'events.help'],
    dataSchema: '#/definitions/PagedEntityPayload',
    mcpExposed: true,
    mcp: {
      command: ['events', 'list'],
      description: 'List event entities.',
      inputSchema: buildInputSchema({
        flagProperties: {
          wallet: commonFlags.wallet,
          'market-address': commonFlags.marketAddress,
          'chain-id': commonFlags.chainId,
          status: enumSchema(['open', 'won', 'lost', 'closed', 'all'], 'Event status filter.'),
          limit: commonFlags.limit,
          after: stringSchema('Pagination cursor.'),
          before: stringSchema('Pagination cursor.'),
          'order-by': stringSchema('Sort field.'),
          'order-direction': enumSchema(['asc', 'desc'], 'Sort direction.'),
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'events.get',
    summary: 'Get one event by id.',
    usage: 'pandora [--output table|json] events get --id <id>',
    emits: ['events.get', 'events.get.help', 'events.help'],
    dataSchema: '#/definitions/EntityCollectionPayload',
    mcpExposed: true,
    mcp: {
      command: ['events', 'get'],
      description: 'Get one event by id.',
      inputSchema: buildInputSchema({
        flagProperties: { id: stringSchema('Event id.') },
        requiredFlags: ['id'],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'positions',
    summary: 'Position command family help and routing entrypoint.',
    usage: 'pandora [--output table|json] positions list ...',
    emits: ['positions.help'],
    dataSchema: '#/definitions/PagedEntityPayload',
  }),
  commandContract({
    name: 'positions.list',
    summary: 'List wallet positions.',
    usage:
      'pandora [--output table|json] positions list --wallet <address> [--chain-id <id>] [--market-address <address>] [--side yes|no|both] [--status all|open|won|lost|closed] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by timestamp|pnl|entry-price|mark-price] [--order-direction asc|desc] [--include-seed]',
    emits: ['positions.list', 'positions.list.help', 'positions.help'],
    dataSchema: '#/definitions/PagedEntityPayload',
    mcpExposed: true,
    mcp: {
      command: ['positions', 'list'],
      description: 'List wallet positions.',
      inputSchema: buildInputSchema({
        flagProperties: {
          wallet: commonFlags.wallet,
          'chain-id': commonFlags.chainId,
          'market-address': commonFlags.marketAddress,
          side: enumSchema(['yes', 'no', 'both'], 'Outcome side filter.'),
          status: enumSchema(['all', 'open', 'won', 'lost', 'closed'], 'Position status filter.'),
          limit: commonFlags.limit,
          after: stringSchema('Pagination cursor.'),
          before: stringSchema('Pagination cursor.'),
          'order-by': enumSchema(['timestamp', 'pnl', 'entry-price', 'mark-price'], 'Sort field.'),
          'order-direction': enumSchema(['asc', 'desc'], 'Sort direction.'),
          'include-seed': booleanSchema('Include seed trades.'),
        },
        requiredFlags: ['wallet'],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'portfolio',
    summary: 'Build portfolio snapshot across positions, LP, and events.',
    usage:
      'pandora [--output table|json] portfolio --wallet <address> [--chain-id <id>|--all-chains] [--limit <n>] [--include-events|--no-events] [--with-lp] [--rpc-url <url>]',
    emits: ['portfolio', 'portfolio.help'],
    dataSchema: '#/definitions/PortfolioPayload',
    mcpExposed: true,
    mcp: {
      command: ['portfolio'],
      description: 'Build portfolio snapshot.',
      inputSchema: buildInputSchema({
        flagProperties: {
          wallet: commonFlags.wallet,
          'chain-id': commonFlags.chainId,
          'all-chains': booleanSchema('Aggregate across all chains.'),
          limit: commonFlags.limit,
          'include-events': booleanSchema('Include events in output.'),
          'no-events': booleanSchema('Skip event aggregation.'),
          'with-lp': booleanSchema('Include LP positions.'),
          'rpc-url': commonFlags.rpcUrl,
        },
        requiredFlags: ['wallet'],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'history',
    summary: 'Query historical trades with approximated mark and PnL analytics.',
    usage:
      'pandora [--output table|json] history --wallet <address> [--chain-id <id>] [--market-address <address>] [--side yes|no|both] [--status all|open|won|lost|closed] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by timestamp|pnl|entry-price|mark-price] [--order-direction asc|desc] [--include-seed]',
    emits: ['history', 'history.help'],
    dataSchema: '#/definitions/HistoryPayload',
    mcpExposed: true,
    mcp: {
      command: ['history'],
      description: 'Query historical trades.',
      inputSchema: buildInputSchema({
        flagProperties: {
          wallet: commonFlags.wallet,
          'chain-id': commonFlags.chainId,
          'market-address': commonFlags.marketAddress,
          side: enumSchema(['yes', 'no', 'both'], 'Outcome side filter.'),
          status: enumSchema(['all', 'open', 'won', 'lost', 'closed'], 'History status filter.'),
          limit: commonFlags.limit,
          after: stringSchema('Pagination cursor.'),
          before: stringSchema('Pagination cursor.'),
          'order-by': enumSchema(['timestamp', 'pnl', 'entry-price', 'mark-price'], 'Sort field.'),
          'order-direction': enumSchema(['asc', 'desc'], 'Sort direction.'),
          'include-seed': booleanSchema('Include seed trades.'),
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
        },
        requiredFlags: ['wallet'],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'export',
    summary: 'Export deterministic history rows as csv or json.',
    usage:
      'pandora [--output table|json] export --wallet <address> --format csv|json [--chain-id <id>] [--year <yyyy>] [--from <unix>] [--to <unix>] [--out <path>]',
    emits: ['export', 'export.help'],
    dataSchema: '#/definitions/ExportPayload',
    mcpExposed: true,
    mcp: {
      command: ['export'],
      description: 'Export historical rows to csv/json.',
      inputSchema: buildInputSchema({
        flagProperties: {
          wallet: commonFlags.wallet,
          format: enumSchema(['csv', 'json'], 'Export format.'),
          'chain-id': commonFlags.chainId,
          year: integerSchema('Calendar year filter.', { minimum: 2000 }),
          from: integerSchema('Unix timestamp lower bound.', { minimum: 0 }),
          to: integerSchema('Unix timestamp upper bound.', { minimum: 0 }),
          out: stringSchema('Output file path.'),
        },
        requiredFlags: ['wallet', 'format'],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'arb',
    summary: 'Arbitrage command family help and routing entrypoint.',
    usage: 'pandora [--output table|json] arb scan ...',
    emits: ['arb.scan.help'],
    dataSchema: '#/definitions/GenericCommandData',
  }),
  commandContract({
    name: 'arbitrage',
    summary: 'Backward-compatible one-shot cross-venue arbitrage wrapper.',
    usage:
      'pandora [--output table|json] arbitrage [--chain-id <id>] [--venues pandora,polymarket] [--limit <n>] [--min-spread-pct <n>] [--min-liquidity-usdc <n>] [--max-close-diff-hours <n>] [--matcher heuristic|hybrid] [--similarity-threshold <0-1>] [--min-token-score <0-1>] [--ai-provider auto|none|mock|openai|anthropic] [--ai-model <id>] [--ai-threshold <0-1>] [--ai-max-candidates <n>] [--ai-timeout-ms <ms>] [--cross-venue-only|--allow-same-venue] [--with-rules] [--include-similarity] [--question-contains <text>] [--polymarket-host <url>] [--polymarket-mock-url <url>]',
    emits: ['arbitrage', 'arbitrage.help'],
    dataSchema: '#/definitions/ArbitragePayload',
    aliasOf: 'arb.scan',
    mcpExposed: true,
    mcp: {
      command: ['arbitrage'],
      description: 'Backward-compatible one-shot wrapper; prefer arb.scan.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'chain-id': commonFlags.chainId,
          venues: stringSchema('Comma-delimited venue list.'),
          limit: commonFlags.limit,
          'min-spread-pct': numberSchema('Minimum spread percent.', { minimum: 0 }),
          'min-liquidity-usdc': numberSchema('Minimum liquidity in USDC.', { minimum: 0 }),
          'max-close-diff-hours': numberSchema('Maximum close-time difference in hours.', { minimum: 0 }),
          matcher: enumSchema(['heuristic', 'hybrid'], 'Arbitrage matcher mode.'),
          'similarity-threshold': numberSchema('Question similarity threshold.', { minimum: 0, maximum: 1 }),
          'min-token-score': numberSchema('Token-overlap threshold.', { minimum: 0, maximum: 1 }),
          'ai-provider': enumSchema(['auto', 'none', 'mock', 'openai', 'anthropic'], 'Provider-backed adjudication mode.'),
          'ai-model': stringSchema('Optional provider model override.'),
          'ai-threshold': numberSchema('Minimum model confidence required to override deterministic matching.', {
            minimum: 0,
            maximum: 1,
          }),
          'ai-max-candidates': integerSchema('Maximum borderline pairs to adjudicate per scan.', { minimum: 1 }),
          'ai-timeout-ms': integerSchema('Timeout for each provider adjudication request.', { minimum: 1 }),
          'cross-venue-only': booleanSchema('Require cross-venue opportunities.'),
          'allow-same-venue': booleanSchema('Allow same-venue opportunities.'),
          'with-rules': booleanSchema('Include rule payloads.'),
          'include-similarity': booleanSchema('Include similarity diagnostics.'),
          'question-contains': stringSchema('Question substring filter.'),
          'polymarket-host': stringSchema('Polymarket host override.'),
          'polymarket-mock-url': stringSchema('Polymarket mock host override.'),
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
        },
      }),
      preferred: false,
      canonicalTool: 'arb.scan',
    },
  }),
  commandContract({
    name: 'arb.scan',
    summary: 'Canonical arbitrage scan command for streaming or bounded spread detection.',
    usage:
      'pandora arb scan [--source pandora|polymarket] [--markets <csv>] --output ndjson|json [--limit <n>] [--min-net-spread-pct <n>|--min-spread-pct <n>] [--min-tvl <usdc>] [--fee-pct-per-leg <n>] [--slippage-pct-per-leg <n>] [--amount-usdc <n>] [--combinatorial] [--max-bundle-size <n>] [--matcher heuristic|hybrid] [--similarity-threshold <0-1>] [--min-token-score <0-1>] [--ai-provider auto|none|mock|openai|anthropic] [--ai-model <id>] [--ai-threshold <0-1>] [--ai-max-candidates <n>] [--ai-timeout-ms <ms>] [--max-close-diff-hours <n>] [--question-contains <text>] [--interval-ms <ms>] [--iterations <n>] [--indexer-url <url>] [--timeout-ms <ms>]',
    emits: ['arb.help', 'arb.scan'],
    dataSchema: '#/definitions/ArbScanPayload',
    mcpExposed: true,
    canonicalTool: 'arb.scan',
    mcp: {
      command: ['arb', 'scan', '--output', 'json', '--iterations', '1'],
      description: 'Run one bounded arb scan iteration and return a structured payload.',
      inputSchema: buildInputSchema({
        flagProperties: {
          source: enumSchema(['pandora', 'polymarket'], 'Opportunity source.'),
          markets: stringSchema('Comma-delimited market ids when source=pandora.'),
          limit: commonFlags.limit,
          'min-net-spread-pct': numberSchema('Minimum net spread percent.', { minimum: 0 }),
          'min-spread-pct': numberSchema('Alias for minimum spread percent.', { minimum: 0 }),
          'min-tvl': numberSchema('Minimum leg liquidity in USDC.', { minimum: 0 }),
          'fee-pct-per-leg': numberSchema('Fee percent per leg.', { minimum: 0 }),
          'slippage-pct-per-leg': numberSchema('Slippage percent per leg.', { minimum: 0 }),
          'amount-usdc': numberSchema('Sizing notional in USDC.', { minimum: 0 }),
          combinatorial: booleanSchema('Enable combinatorial bundle search.'),
          'max-bundle-size': integerSchema('Maximum combinatorial bundle size.', { minimum: 3 }),
          matcher: enumSchema(['heuristic', 'hybrid'], 'Arbitrage matcher mode.'),
          'similarity-threshold': numberSchema('Question similarity threshold.', { minimum: 0, maximum: 1 }),
          'min-token-score': numberSchema('Token-overlap threshold.', { minimum: 0, maximum: 1 }),
          'ai-provider': enumSchema(['auto', 'none', 'mock', 'openai', 'anthropic'], 'Provider-backed adjudication mode.'),
          'ai-model': stringSchema('Optional provider model override.'),
          'ai-threshold': numberSchema('Minimum model confidence required to override deterministic matching.', {
            minimum: 0,
            maximum: 1,
          }),
          'ai-max-candidates': integerSchema('Maximum borderline pairs to adjudicate per scan.', { minimum: 1 }),
          'ai-timeout-ms': integerSchema('Timeout for each provider adjudication request.', { minimum: 1 }),
          'max-close-diff-hours': numberSchema('Maximum close-time difference in hours.', { minimum: 0 }),
          'question-contains': stringSchema('Question substring filter.'),
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'odds',
    summary: 'Odds command family help and routing entrypoint.',
    usage:
      'pandora [--output table|json] odds record --competition <id> --interval <sec> [--max-samples <n>] [--event-id <id>] [--venues pandora_amm,polymarket] [--indexer-url <url>] [--polymarket-host <url>] [--polymarket-mock-url <url>] [--timeout-ms <ms>] | pandora [--output table|json] odds history --event-id <id> --output csv|json [--limit <n>]',
    emits: ['odds.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
    helpDataSchema: ODDS_HELP_SCHEMA_REF,
  }),
  commandContract({
    name: 'odds.record',
    summary: 'Record venue odds snapshots into local history storage.',
    usage:
      'pandora [--output table|json] odds record --competition <id> --interval <sec> [--max-samples <n>] [--event-id <id>] [--venues pandora_amm,polymarket] [--indexer-url <url>] [--polymarket-host <url>] [--polymarket-mock-url <url>] [--timeout-ms <ms>]',
    emits: ['odds.record', 'odds.help'],
    dataSchema: '#/definitions/OddsRecordPayload',
    helpDataSchema: ODDS_HELP_SCHEMA_REF,
    mcpExposed: true,
    mcp: {
      command: ['odds', 'record'],
      description: 'Record venue odds snapshots into local history storage.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          competition: commonFlags.competition,
          interval: numberSchema('Recording interval in seconds.', { minimum: 1 }),
          'max-samples': integerSchema('Maximum sample count.', { minimum: 1 }),
          'event-id': commonFlags.eventId,
          venues: stringSchema('Comma-delimited venue list.'),
          'indexer-url': commonFlags.indexerUrl,
          'polymarket-host': stringSchema('Polymarket host override.'),
          'polymarket-mock-url': stringSchema('Polymarket mock host override.'),
          'timeout-ms': commonFlags.timeoutMs,
        },
        requiredFlags: ['competition', 'interval'],
      }),
      preferred: true,
      mutating: true,
      longRunningBlocked: true,
    },
  }),
  commandContract({
    name: 'odds.history',
    summary: 'Read stored venue odds history for one event.',
    usage: 'pandora [--output table|json] odds history --event-id <id> --output csv|json [--limit <n>]',
    emits: ['odds.history', 'odds.help'],
    dataSchema: '#/definitions/OddsHistoryPayload',
    helpDataSchema: ODDS_HELP_SCHEMA_REF,
    mcpExposed: true,
    mcp: {
      command: ['odds', 'history'],
      description: 'Read stored venue odds history for one event.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'event-id': commonFlags.eventId,
          output: enumSchema(['csv', 'json'], 'History output mode.'),
          limit: commonFlags.limit,
        },
        requiredFlags: ['event-id'],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'sports',
    summary: 'Sports command family help and routing entrypoint.',
    usage:
      'pandora [--output table|json] sports schedule|scores|books list|events list|events live|odds snapshot|odds bulk|consensus|create plan|create run|sync once|run|start|stop|status|resolve plan ...',
    emits: ['sports.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
  }),
  commandContract({
    name: 'sports.schedule',
    summary: 'Operator-oriented schedule view for normalized soccer fixtures.',
    usage:
      'pandora [--output table|json] sports schedule [--provider primary|backup|auto] [--competition <id|slug>] [--date <YYYY-MM-DD>] [--kickoff-after <iso>] [--kickoff-before <iso>] [--limit <n>] [--timeout-ms <ms>]',
    emits: ['sports.schedule', 'sports.schedule.help', 'sports.help'],
    dataSchema: '#/definitions/SportsSchedulePayload',
    mcpExposed: true,
    mcp: {
      command: ['sports', 'schedule'],
      description: 'List normalized soccer fixtures in schedule order for operator readouts.',
      inputSchema: buildInputSchema({
        flagProperties: {
          provider: commonFlags.provider,
          competition: commonFlags.competition,
          date: stringSchema('UTC calendar date shorthand in YYYY-MM-DD form. Expands to kickoff-after/before for that day.'),
          'kickoff-after': stringSchema('ISO timestamp lower bound.'),
          'kickoff-before': stringSchema('ISO timestamp upper bound.'),
          limit: commonFlags.limit,
          'timeout-ms': commonFlags.timeoutMs,
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'sports.scores',
    summary: 'Operator-oriented live score and status view for soccer events.',
    usage:
      'pandora [--output table|json] sports scores [--event-id <id>|--game <id>] [--provider primary|backup|auto] [--competition <id|slug>] [--date <YYYY-MM-DD>] [--kickoff-after <iso>] [--kickoff-before <iso>] [--limit <n>] [--timeout-ms <ms>]',
    emits: ['sports.scores', 'sports.scores.help', 'sports.help'],
    dataSchema: '#/definitions/SportsScoresPayload',
    mcpExposed: true,
    mcp: {
      command: ['sports', 'scores'],
      description: 'Return current live score and status rows for one event or the active slate.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'event-id': commonFlags.eventId,
          game: stringSchema('Alias for --event-id.'),
          provider: commonFlags.provider,
          competition: commonFlags.competition,
          date: stringSchema('UTC calendar date shorthand in YYYY-MM-DD form. Expands to kickoff-after/before for that day.'),
          'kickoff-after': stringSchema('ISO timestamp lower bound.'),
          'kickoff-before': stringSchema('ISO timestamp upper bound.'),
          limit: commonFlags.limit,
          'timeout-ms': commonFlags.timeoutMs,
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'sports.books.list',
    summary: 'List sportsbook provider health and configured book priorities.',
    usage:
      'pandora [--output table|json] sports books list [--provider primary|backup|auto] [--book-priority <csv>] [--timeout-ms <ms>]',
    emits: ['sports.books.list', 'sports.help'],
    dataSchema: '#/definitions/SportsBooksPayload',
    mcpExposed: true,
    mcp: {
      command: ['sports', 'books', 'list'],
      description: 'List sportsbook provider health and configured book priorities.',
      inputSchema: buildInputSchema({
        flagProperties: {
          provider: commonFlags.provider,
          'book-priority': stringSchema('Comma-delimited bookmaker priority list.'),
          'timeout-ms': commonFlags.timeoutMs,
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'sports.events.list',
    summary: 'List normalized soccer events from sportsbook providers.',
    usage:
      'pandora [--output table|json] sports events list [--provider primary|backup|auto] [--competition <id|slug>] [--kickoff-after <iso>] [--kickoff-before <iso>] [--limit <n>] [--timeout-ms <ms>]',
    emits: ['sports.events.list', 'sports.help'],
    dataSchema: '#/definitions/SportsEventsPayload',
    mcpExposed: true,
    mcp: {
      command: ['sports', 'events', 'list'],
      description: 'List normalized soccer events from sportsbook providers.',
      inputSchema: buildInputSchema({
        flagProperties: {
          provider: commonFlags.provider,
          competition: commonFlags.competition,
          'kickoff-after': stringSchema('ISO timestamp lower bound.'),
          'kickoff-before': stringSchema('ISO timestamp upper bound.'),
          limit: commonFlags.limit,
          'timeout-ms': commonFlags.timeoutMs,
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'sports.events.live',
    summary: 'List currently-live soccer events from sportsbook providers.',
    usage:
      'pandora [--output table|json] sports events live [--provider primary|backup|auto] [--competition <id|slug>] [--limit <n>] [--timeout-ms <ms>]',
    emits: ['sports.events.live', 'sports.help'],
    dataSchema: '#/definitions/SportsEventsPayload',
    mcpExposed: true,
    mcp: {
      command: ['sports', 'events', 'live'],
      description: 'List currently-live soccer events from sportsbook providers.',
      inputSchema: buildInputSchema({
        flagProperties: {
          provider: commonFlags.provider,
          competition: commonFlags.competition,
          limit: commonFlags.limit,
          'timeout-ms': commonFlags.timeoutMs,
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'sports.odds.snapshot',
    summary: 'Fetch event odds snapshot and consensus context.',
    usage:
      'pandora [--output table|json] sports odds snapshot --event-id <id> [--provider primary|backup|auto] [--book-priority <csv>] [--trim-percent <n>] [--min-tier1-books <n>] [--min-total-books <n>]',
    emits: ['sports.odds.snapshot', 'sports.help'],
    dataSchema: '#/definitions/SportsOddsPayload',
    mcpExposed: true,
    mcp: {
      command: ['sports', 'odds', 'snapshot'],
      description: 'Get normalized event odds snapshot and consensus.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'event-id': commonFlags.eventId,
          provider: commonFlags.provider,
          'book-priority': stringSchema('Comma-delimited bookmaker priority list.'),
          'trim-percent': numberSchema('Outlier trim percent.', { minimum: 0, maximum: 100 }),
          'min-tier1-books': integerSchema('Minimum tier-1 bookmaker count.', { minimum: 0 }),
          'min-total-books': integerSchema('Minimum total bookmaker count.', { minimum: 0 }),
        },
        requiredFlags: ['event-id'],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'sports.odds.bulk',
    summary: 'Fetch all competition odds and refresh the local bulk cache.',
    usage:
      'pandora [--output table|json] sports odds bulk --competition <id|slug> [--provider primary|backup|auto] [--timeout-ms <ms>] [--limit <n>]',
    emits: ['sports.odds.bulk', 'sports.help'],
    dataSchema: '#/definitions/SportsBulkOddsPayload',
    mcpExposed: true,
    mcp: {
      command: ['sports', 'odds', 'bulk'],
      description: 'Fetch all competition odds and refresh the local bulk cache.',
      inputSchema: buildInputSchema({
        flagProperties: {
          competition: commonFlags.competition,
          provider: commonFlags.provider,
          'timeout-ms': commonFlags.timeoutMs,
          limit: commonFlags.limit,
        },
        requiredFlags: ['competition'],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'sports.consensus',
    summary: 'Compute majority-book trimmed-median consensus.',
    usage:
      'pandora [--output table|json] sports consensus --event-id <id>|--checks-json <json> [--provider primary|backup|auto] [--book-priority <csv>] [--trim-percent <n>] [--min-tier1-books <n>] [--min-total-books <n>]',
    emits: ['sports.consensus', 'sports.help'],
    dataSchema: '#/definitions/SportsConsensusPayload',
    mcpExposed: true,
    mcp: {
      command: ['sports', 'consensus'],
      description: 'Compute majority-book trimmed-median consensus for one event.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'event-id': commonFlags.eventId,
          'checks-json': stringSchema('Raw consensus input JSON.'),
          provider: commonFlags.provider,
          'book-priority': stringSchema('Comma-delimited bookmaker priority list.'),
          'trim-percent': numberSchema('Outlier trim percent.', { minimum: 0, maximum: 100 }),
          'min-tier1-books': integerSchema('Minimum tier-1 bookmaker count.', { minimum: 0 }),
          'min-total-books': integerSchema('Minimum total bookmaker count.', { minimum: 0 }),
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'sports.create.plan',
    summary: 'Build conservative market creation plan from sportsbook consensus.',
    usage:
      'pandora [--output table|json] sports create plan --event-id <id> [--market-type amm|parimutuel] [--selection home|away|draw] [--creation-window-open-min <n>] [--creation-window-close-min <n>] [--category <id|name>] [--book-priority <csv>] [--model-file <path>|--model-stdin]',
    emits: ['sports.create.plan', 'sports.help'],
    dataSchema: '#/definitions/SportsCreatePayload',
    mcpExposed: true,
    mcp: {
      command: ['sports', 'create', 'plan'],
      description: 'Build conservative market creation plan from sportsbook consensus.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'event-id': commonFlags.eventId,
          'market-type': enumSchema(['amm', 'parimutuel'], 'Market type.'),
          selection: enumSchema(['home', 'away', 'draw'], 'Outcome selection.'),
          'creation-window-open-min': integerSchema('Creation window open minutes before kickoff.', { minimum: 0 }),
          'creation-window-close-min': integerSchema('Creation window close minutes before kickoff.', { minimum: 0 }),
          category: buildPollCategorySchema('Category id or canonical category name.'),
          'book-priority': stringSchema('Comma-delimited bookmaker priority list.'),
          'model-file': stringSchema('Path to BYOM probability JSON.'),
          'model-stdin': booleanSchema('Read BYOM probability JSON from stdin.'),
        },
        requiredFlags: ['event-id'],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'sports.create.run',
    summary: 'Execute or dry-run sports market creation; pari-mutuel execute remains unsupported.',
    usage:
      'pandora [--output table|json] sports create run --event-id <id> [--market-type amm|parimutuel] [--category <id|name>] [--dry-run|--execute] [--liquidity-usdc <n>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>]',
    emits: ['sports.create.run', 'sports.help'],
    dataSchema: '#/definitions/SportsCreatePayload',
    mcpExposed: true,
    agentWorkflow: {
      requiredTools: ['agent.market.validate'],
      recommendedTools: ['agent.market.autocomplete'],
      executeRequiresValidation: true,
      notes: [
        'Use agent.market.autocomplete when the agent must rewrite the question, rules, or timing before market creation.',
        'Run agent.market.validate on the exact final sports market payload before any execute path.',
      ],
    },
    mcp: {
      command: ['sports', 'create', 'run'],
      description:
        'Execute or dry-run sports market creation. `--market-type parimutuel` is supported for planning/dry-run payloads, but live execute currently supports AMM only.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'event-id': commonFlags.eventId,
          'market-type': enumSchema(['amm', 'parimutuel'], 'Market type.'),
          category: buildPollCategorySchema('Category id or canonical category name.'),
          'dry-run': booleanSchema('Run dry-run mode.'),
          paper: booleanSchema('Run in paper mode.'),
          execute: booleanSchema('Execute live creation.'),
          'liquidity-usdc': numberSchema('Initial liquidity amount in USDC.', { minimum: 0 }),
          'chain-id': commonFlags.chainId,
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          'profile-id': commonFlags.profileId,
          'profile-file': commonFlags.profileFile,
          agentPreflight: buildAgentPreflightSchema('Agent validation attestation for execute mode.'),
        },
        requiredFlags: ['event-id'],
      }),
      preferred: true,
      mutating: true,
      safeFlags: ['--dry-run', '--paper'],
      executeFlags: ['--execute'],
      controlInputNames: ['agentPreflight'],
    },
  }),
  commandContract({
    name: 'sports.sync',
    summary: 'Run sports sync once/run and runtime lifecycle actions.',
    usage:
      'pandora [--output table|json] sports sync once|run|start|stop|status [--event-id <id>] [--paper|--execute-live] [--risk-profile conservative|balanced|aggressive] [--state-file <path>]',
    emits: ['sports.help'],
    dataSchema: '#/definitions/SportsSyncPayload',
  }),
  commandContract({
    name: 'sports.sync.once',
    summary: 'Run one bounded sports sync iteration.',
    usage:
      'pandora [--output table|json] sports sync once --event-id <id> [--paper|--execute-live] [--risk-profile conservative|balanced|aggressive] [--state-file <path>]',
    emits: ['sports.sync.once', 'sports.help'],
    dataSchema: '#/definitions/SportsSyncPayload',
    mcpExposed: true,
    mcp: {
      command: ['sports', 'sync', 'once'],
      description: 'Run one sports sync evaluation tick.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'event-id': commonFlags.eventId,
          paper: commonFlags.paper,
          'dry-run': commonFlags.dryRun,
          'execute-live': booleanSchema('Execute live sync actions.'),
          execute: commonFlags.execute,
          'risk-profile': enumSchema(['conservative', 'balanced', 'aggressive'], 'Risk profile.'),
          'state-file': commonFlags.stateFile,
        },
      }),
      preferred: true,
      mutating: true,
      safeFlags: ['--paper', '--dry-run'],
      executeFlags: ['--execute-live', '--execute'],
    },
  }),
  commandContract({
    name: 'sports.sync.run',
    summary: 'Run continuous sports sync loop.',
    usage:
      'pandora [--output table|json] sports sync run --event-id <id> [--paper|--execute-live] [--risk-profile conservative|balanced|aggressive] [--state-file <path>]',
    emits: ['sports.sync.run', 'sports.help'],
    dataSchema: '#/definitions/SportsSyncPayload',
    mcpExposed: true,
    mcp: {
      command: ['sports', 'sync', 'run'],
      description: 'Continuous sports sync loop. Use paper or dry-run flags for safe planning; long-running execution remains blocked in MCP v1, and live mutation requires intent.execute with execute or execute-live.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'event-id': commonFlags.eventId,
          paper: commonFlags.paper,
          'dry-run': commonFlags.dryRun,
          'execute-live': booleanSchema('Execute live sync actions.'),
          execute: commonFlags.execute,
          'risk-profile': enumSchema(['conservative', 'balanced', 'aggressive'], 'Risk profile.'),
          'state-file': commonFlags.stateFile,
        },
      }),
      preferred: true,
      longRunningBlocked: true,
      mutating: true,
      safeFlags: ['--paper', '--dry-run'],
      executeFlags: ['--execute-live', '--execute'],
    },
  }),
    commandContract({
      name: 'sports.sync.start',
    summary: 'Start detached sports sync runtime.',
    usage:
      'pandora [--output table|json] sports sync start --event-id <id> [--paper|--execute-live] [--risk-profile conservative|balanced|aggressive] [--state-file <path>]',
    emits: ['sports.sync.start', 'sports.help'],
    dataSchema: '#/definitions/SportsSyncPayload',
    mcpExposed: true,
      mcp: {
      command: ['sports', 'sync', 'start'],
      description: 'Start detached sports sync runtime. Long-running detached execution remains blocked in MCP v1, and live mutation requires intent.execute with execute or execute-live.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'event-id': commonFlags.eventId,
          paper: commonFlags.paper,
          'dry-run': commonFlags.dryRun,
          'execute-live': booleanSchema('Execute live sync actions.'),
          execute: commonFlags.execute,
          'risk-profile': enumSchema(['conservative', 'balanced', 'aggressive'], 'Risk profile.'),
          'state-file': commonFlags.stateFile,
        },
      }),
      preferred: true,
      longRunningBlocked: true,
      mutating: true,
      safeFlags: ['--paper', '--dry-run'],
        executeFlags: ['--execute-live', '--execute'],
      },
      agentPlatform: {
        returnsOperationId: true,
        returnsRuntimeHandle: false,
      },
    }),
    commandContract({
      name: 'sports.sync.stop',
    summary: 'Stop detached sports sync runtime.',
    usage: 'pandora [--output table|json] sports sync stop [--state-file <path>]',
    emits: ['sports.sync.stop', 'sports.help'],
    dataSchema: '#/definitions/SportsSyncPayload',
    mcpExposed: true,
      mcp: {
      command: ['sports', 'sync', 'stop'],
      description: 'Stop sports sync runtime.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: { 'state-file': commonFlags.stateFile },
      }),
        preferred: true,
        mutating: true,
      },
      agentPlatform: {
        externalDependencies: ['filesystem'],
        expectedLatencyMs: 1000,
        returnsOperationId: true,
        returnsRuntimeHandle: false,
      },
    }),
    commandContract({
      name: 'sports.sync.status',
    summary: 'Inspect detached sports sync runtime status.',
    usage: 'pandora [--output table|json] sports sync status [--state-file <path>]',
    emits: ['sports.sync.status', 'sports.help'],
    dataSchema: '#/definitions/SportsSyncPayload',
    mcpExposed: true,
      mcp: {
      command: ['sports', 'sync', 'status'],
      description: 'Inspect sports sync runtime status.',
        inputSchema: buildInputSchema({
          flagProperties: { 'state-file': commonFlags.stateFile },
        }),
        preferred: true,
      },
      agentPlatform: {
        externalDependencies: ['filesystem'],
        expectedLatencyMs: 1000,
        returnsOperationId: true,
        returnsRuntimeHandle: false,
      },
    }),
  commandContract({
    name: 'sports.resolve.plan',
    summary: 'Build an opt-in sports resolution safety verdict with blockers, timing, and optional execute-ready resolve args.',
    usage:
      'pandora [--output table|json] sports resolve plan --event-id <id>|--checks-json <json>|--checks-file <path> [--poll-address <address>] [--settle-delay-ms <ms>] [--consecutive-checks-required <n>] [--now <iso>|--now-ms <ms>] [--reason <text>] [--rpc-url <url>]',
    emits: ['sports.resolve.plan', 'sports.help'],
    dataSchema: '#/definitions/SportsResolvePlanPayload',
    mcpExposed: true,
    mcp: {
      command: ['sports', 'resolve', 'plan'],
      description: 'Build an opt-in sports resolution safety verdict from official-first checks. Safe payloads can include execute-ready resolve args; unsafe payloads return structured blockers and retry timing.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'event-id': commonFlags.eventId,
          'checks-json': stringSchema('Raw resolution checks JSON.'),
          'checks-file': stringSchema('Resolution checks file path.'),
          'poll-address': commonFlags.pollAddress,
          'settle-delay-ms': integerSchema('Minimum settle delay in milliseconds.', { minimum: 0 }),
          'consecutive-checks-required': integerSchema('Required consecutive final checks.', { minimum: 1 }),
          now: stringSchema('Current time override as ISO timestamp.'),
          'now-ms': integerSchema('Current time override in milliseconds.', { minimum: 0 }),
          reason: stringSchema('Operator note for resolve plan.'),
          'rpc-url': commonFlags.rpcUrl,
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'lifecycle',
    summary: 'Manage file-based lifecycle state for detect to resolve workflow.',
    usage: 'pandora [--output table|json] lifecycle start --config <file> | status --id <id> | resolve --id <id> --confirm',
    emits: ['lifecycle.help'],
    dataSchema: '#/definitions/LifecyclePayload',
  }),
  commandContract({
    name: 'lifecycle.start',
    summary: 'Create lifecycle state from a config file.',
    usage: 'pandora [--output table|json] lifecycle start --config <file>',
    emits: ['lifecycle.start', 'lifecycle.start.help', 'lifecycle.help'],
    dataSchema: '#/definitions/LifecyclePayload',
    mcpExposed: true,
    mcp: {
      command: ['lifecycle', 'start'],
      description: 'Create lifecycle state from a config file.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          config: stringSchema('Lifecycle config JSON path.'),
        },
        requiredFlags: ['config'],
      }),
      preferred: true,
      mutating: true,
    },
  }),
  commandContract({
    name: 'lifecycle.status',
    summary: 'Inspect lifecycle state by id.',
    usage: 'pandora [--output table|json] lifecycle status --id <id>',
    emits: ['lifecycle.status', 'lifecycle.status.help', 'lifecycle.help'],
    dataSchema: '#/definitions/LifecyclePayload',
    mcpExposed: true,
    mcp: {
      command: ['lifecycle', 'status'],
      description: 'Inspect lifecycle state by id.',
      inputSchema: buildInputSchema({
        flagProperties: { id: stringSchema('Lifecycle id.') },
        requiredFlags: ['id'],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'lifecycle.resolve',
    summary: 'Mark lifecycle as resolved after explicit operator confirmation.',
    usage: 'pandora [--output table|json] lifecycle resolve --id <id> --confirm',
    emits: ['lifecycle.resolve', 'lifecycle.resolve.help', 'lifecycle.help'],
    dataSchema: '#/definitions/LifecyclePayload',
    mcpExposed: true,
    mcp: {
      command: ['lifecycle', 'resolve'],
      description: 'Mark lifecycle as resolved (requires --confirm).',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          id: stringSchema('Lifecycle id.'),
          confirm: booleanSchema('Explicit confirmation to resolve lifecycle.'),
        },
        requiredFlags: ['id', 'confirm'],
      }),
      preferred: true,
      mutating: true,
    },
  }),
  commandContract({
    name: 'simulate',
    summary: 'Simulation command family help and routing entrypoint.',
    usage: 'pandora [--output table|json] simulate mc|particle-filter|agents ...',
    emits: ['simulate.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
  }),
  commandContract({
    name: 'simulate.mc',
    summary: 'Run desk-grade Monte Carlo simulation with CI and VaR/ES risk outputs.',
    usage:
      'pandora [--output table|json] simulate mc [--trials <n>] [--horizon <n>] [--start-yes-pct <0-100>] [--entry-yes-pct <0-100>] [--position yes|no] [--stake-usdc <n>] [--drift-bps <n>] [--vol-bps <n>] [--confidence <50-100>] [--var-level <50-100>] [--seed <n>] [--antithetic] [--stratified]',
    emits: ['simulate.mc', 'simulate.mc.help', 'simulate.help'],
    dataSchema: '#/definitions/SimulateMcPayload',
    mcpExposed: true,
    mcp: {
      command: ['simulate', 'mc'],
      description: 'Run bounded Monte Carlo simulations with risk metrics.',
      inputSchema: buildInputSchema({
        flagProperties: {
          trials: integerSchema('Simulation trial count.', { minimum: 1, maximum: 250000 }),
          horizon: integerSchema('Horizon step count.', { minimum: 1 }),
          'start-yes-pct': numberSchema('Starting YES probability percent.', { minimum: 0, maximum: 100 }),
          'entry-yes-pct': numberSchema('Entry YES probability percent.', { minimum: 0, maximum: 100 }),
          position: enumSchema(['yes', 'no'], 'Position side.'),
          'stake-usdc': numberSchema('Stake in USDC.', { minimum: 0 }),
          'drift-bps': numberSchema('Drift in basis points.'),
          'vol-bps': numberSchema('Volatility in basis points.', { minimum: 0 }),
          confidence: numberSchema('Confidence interval level.', { minimum: 50, maximum: 100 }),
          'var-level': numberSchema('Value-at-risk level.', { minimum: 50, maximum: 100 }),
          seed: integerSchema('Deterministic random seed.'),
          antithetic: booleanSchema('Enable antithetic variates.'),
          stratified: booleanSchema('Enable stratified sampling.'),
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'simulate.particle-filter',
    summary: 'Run sequential Monte Carlo filtering with ESS diagnostics and credible intervals.',
    usage:
      'pandora [--output table|json] simulate particle-filter (--observations-json <json>|--input <path>|--stdin) [--particles <n>] [--process-noise <n>] [--observation-noise <n>] [--drift-bps <n>] [--initial-yes-pct <0-100>] [--initial-spread <n>] [--resample-threshold <0-1>] [--resample-method systematic|multinomial] [--credible-interval <50-100>] [--seed <n>]',
    emits: ['simulate.particle-filter', 'simulate.particle-filter.help', 'simulate.help'],
    dataSchema: '#/definitions/SimulateParticleFilterPayload',
    mcpExposed: true,
    mcp: {
      command: ['simulate', 'particle-filter'],
      description: 'Run bounded particle-filter simulations with ESS diagnostics.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'observations-json': stringSchema('Observation series JSON.'),
          input: stringSchema('Observation file path.'),
          stdin: booleanSchema('Read observations JSON from stdin.'),
          particles: integerSchema('Particle count.', { minimum: 1, maximum: 100000 }),
          'process-noise': numberSchema('Process noise parameter.', { minimum: 0 }),
          'observation-noise': numberSchema('Observation noise parameter.', { minimum: 0 }),
          'drift-bps': numberSchema('Drift in basis points.'),
          'initial-yes-pct': numberSchema('Initial YES probability percent.', { minimum: 0, maximum: 100 }),
          'initial-spread': numberSchema('Initial spread parameter.', { minimum: 0 }),
          'resample-threshold': numberSchema('ESS resample threshold.', { minimum: 0, maximum: 1 }),
          'resample-method': enumSchema(['systematic', 'multinomial'], 'Particle resample method.'),
          'credible-interval': numberSchema('Credible interval level.', { minimum: 50, maximum: 100 }),
          seed: integerSchema('Deterministic random seed.'),
        },
        oneOf: simulateParticleFilterSourceOneOf,
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'simulate.agents',
    summary: 'Run deterministic agent-based market simulation with ABM diagnostics.',
    usage:
      'pandora [--output table|json] simulate agents [--n-informed <n>] [--n-noise <n>] [--n-mm <n>] [--n-steps <n>] [--seed <int>]',
    emits: ['simulate.agents', 'simulate.agents.help', 'simulate.help'],
    dataSchema: '#/definitions/SimulateAgentsPayload',
    mcpExposed: true,
    mcp: {
      command: ['simulate', 'agents'],
      description: 'Run bounded agent-based market simulations.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'n-informed': integerSchema('Informed agent count.', { minimum: 1, maximum: 1000 }),
          'n-noise': integerSchema('Noise agent count.', { minimum: 1, maximum: 1000 }),
          'n-mm': integerSchema('Market-maker count.', { minimum: 1, maximum: 1000 }),
          'n-steps': integerSchema('Simulation step count.', { minimum: 1, maximum: 10000 }),
          seed: integerSchema('Deterministic random seed.'),
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'model',
    summary: 'Model command family help and routing entrypoint.',
    usage: 'pandora [--output table|json] model calibrate|correlation|diagnose|score brier ...',
    emits: ['model.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
  }),
  commandContract({
    name: 'model.calibrate',
    summary: 'Calibrate jump-diffusion parameters from historical price or return inputs.',
    usage:
      'pandora [--output table|json] model calibrate (--prices <csv>|--returns <csv>) [--dt <n>] [--jump-threshold-sigma <n>] [--min-jump-count <n>] [--model-id <id>] [--save-model <path>]',
    emits: ['model.calibrate', 'model.calibrate.help', 'model.help'],
    dataSchema: '#/definitions/ModelCalibratePayload',
    mcpExposed: true,
    mcp: {
      command: ['model', 'calibrate'],
      description: 'Calibrate jump-diffusion parameters from historical inputs.',
      inputSchema: buildInputSchema({
        flagProperties: {
          prices: stringSchema('Comma-delimited price series.'),
          returns: stringSchema('Comma-delimited return series.'),
          dt: numberSchema('Observation interval.'),
          'jump-threshold-sigma': numberSchema('Jump threshold in sigma units.', { minimum: 0 }),
          'min-jump-count': integerSchema('Minimum jump observation count.', { minimum: 0 }),
          'model-id': stringSchema('Model identifier.'),
          'save-model': stringSchema('Output artifact path.'),
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'model.correlation',
    summary: 'Estimate dependency structure and tail dependence via copula methods.',
    usage:
      'pandora [--output table|json] model correlation --series <id:v1,v2,...> --series <id:v1,v2,...> [--copula t|gaussian|clayton|gumbel] [--compare <csv>] [--tail-alpha <n>] [--df <n>] [--joint-threshold-z <n>] [--scenario-shocks <csv>] [--model-id <id>] [--save-model <path>]',
    emits: ['model.correlation', 'model.correlation.help', 'model.help'],
    dataSchema: '#/definitions/ModelCorrelationPayload',
    mcpExposed: true,
    mcp: {
      command: ['model', 'correlation'],
      description: 'Estimate dependency and tail metrics with copula methods.',
      inputSchema: buildInputSchema({
        flagProperties: {
          series: {
            ...stringSchema('Series specification id:v1,v2,..., or a semicolon-delimited list of series specifications.', {
              xPandora: {
                acceptsSemicolonSeparatedList: true,
              },
            }),
            minLength: 1,
          },
          copula: enumSchema(['t', 'gaussian', 'clayton', 'gumbel'], 'Copula family.'),
          compare: stringSchema('Comma-delimited comparison list.'),
          'tail-alpha': numberSchema('Tail alpha level.', { minimum: 0, maximum: 1 }),
          df: numberSchema('Student-t degrees of freedom.', { minimum: 0 }),
          'joint-threshold-z': numberSchema('Joint tail threshold in z-space.'),
          'scenario-shocks': stringSchema('Comma-delimited scenario shocks.'),
          'model-id': stringSchema('Model identifier.'),
          'save-model': stringSchema('Output artifact path.'),
        },
        requiredFlags: ['series'],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'model.diagnose',
    summary: 'Diagnose market or model informativeness with machine-readable flags.',
    usage:
      'pandora [--output table|json] model diagnose [--calibration-rmse <n>] [--drift-bps <n>] [--spread-bps <n>] [--depth-coverage <0..1>] [--informed-flow-ratio <0..1>] [--noise-ratio <0..1>] [--anomaly-rate <0..1>] [--manipulation-alerts <n>] [--tail-dependence <0..1>]',
    emits: ['model.diagnose', 'model.diagnose.help', 'model.help'],
    dataSchema: '#/definitions/ModelDiagnosePayload',
    mcpExposed: true,
    mcp: {
      command: ['model', 'diagnose'],
      description: 'Diagnose market/model signal quality for execution gating.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'calibration-rmse': numberSchema('Calibration RMSE.', { minimum: 0 }),
          'drift-bps': numberSchema('Drift in basis points.'),
          'spread-bps': numberSchema('Spread in basis points.', { minimum: 0 }),
          'depth-coverage': numberSchema('Depth coverage ratio.', { minimum: 0, maximum: 1 }),
          'informed-flow-ratio': numberSchema('Informed flow ratio.', { minimum: 0, maximum: 1 }),
          'noise-ratio': numberSchema('Noise flow ratio.', { minimum: 0, maximum: 1 }),
          'anomaly-rate': numberSchema('Anomaly rate.', { minimum: 0, maximum: 1 }),
          'manipulation-alerts': integerSchema('Manipulation alert count.', { minimum: 0 }),
          'tail-dependence': numberSchema('Tail dependence metric.', { minimum: 0, maximum: 1 }),
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'model.score.brier',
    summary: 'Score forecast calibration via Brier metrics.',
    usage:
      'pandora [--output table|json] model score brier [--source <name>] [--market-address <address>] [--competition <id>] [--event-id <id>] [--model-id <id>] [--group-by source|market|competition|model|none] [--window-days <n>] [--bucket-count <n>] [--forecast-file <path>] [--include-records] [--include-unresolved] [--limit <n>]',
    emits: ['model.score.brier', 'model.score.brier.help', 'model.help'],
    dataSchema: '#/definitions/ModelScoreBrierPayload',
    mcpExposed: true,
    mcp: {
      command: ['model', 'score', 'brier'],
      description: 'Score forecast calibration with Brier metrics.',
      inputSchema: buildInputSchema({
        flagProperties: {
          source: stringSchema('Forecast source label.'),
          'market-address': commonFlags.marketAddress,
          competition: commonFlags.competition,
          'event-id': commonFlags.eventId,
          'model-id': stringSchema('Model identifier.'),
          'group-by': enumSchema(['source', 'market', 'competition', 'model', 'none'], 'Aggregation grouping.'),
          'window-days': integerSchema('Window size in days.', { minimum: 1 }),
          'bucket-count': integerSchema('Reliability bucket count.', { minimum: 1 }),
          'forecast-file': stringSchema('Forecast ledger path.'),
          'include-records': booleanSchema('Include resolved records in payload.'),
          'include-unresolved': booleanSchema('Include unresolved records in payload.'),
          limit: commonFlags.limit,
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'autopilot',
    summary: 'Autopilot command family help and routing entrypoint.',
    usage:
      'pandora [--output table|json] autopilot run|once --market-address <address> --side yes|no --amount-usdc <amount> [--trigger-yes-below <0-100>] [--trigger-yes-above <0-100>] [--paper|--execute-live] [--interval-ms <ms>] [--cooldown-ms <ms>] [--max-amount-usdc <amount>] [--max-open-exposure-usdc <amount>] [--max-trades-per-day <n>] [--state-file <path>] [--kill-switch-file <path>] [--webhook-url <url>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>]',
    emits: ['autopilot.help'],
    dataSchema: '#/definitions/AutopilotPayload',
  }),
  commandContract({
    name: 'autopilot.once',
    summary: 'Run one guarded autopilot iteration.',
    usage:
      'pandora [--output table|json] autopilot once --market-address <address> --side yes|no --amount-usdc <amount> [--trigger-yes-below <0-100>] [--trigger-yes-above <0-100>] [--paper|--execute-live] [--interval-ms <ms>] [--cooldown-ms <ms>] [--max-amount-usdc <amount>] [--max-open-exposure-usdc <amount>] [--max-trades-per-day <n>] [--state-file <path>] [--kill-switch-file <path>] [--webhook-url <url>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>]',
    emits: ['autopilot', 'autopilot.help'],
    dataSchema: '#/definitions/AutopilotPayload',
    mcpExposed: true,
    mcp: {
      command: ['autopilot', 'once'],
      description: 'Run one guarded autopilot iteration.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'market-address': commonFlags.marketAddress,
          side: enumSchema(['yes', 'no'], 'Outcome side.'),
          'amount-usdc': numberSchema('Trade notional in USDC.', { minimum: 0 }),
          'trigger-yes-below': numberSchema('Low YES trigger percent.', { minimum: 0, maximum: 100 }),
          'trigger-yes-above': numberSchema('High YES trigger percent.', { minimum: 0, maximum: 100 }),
          paper: commonFlags.paper,
          'execute-live': booleanSchema('Execute live autopilot action.'),
          'interval-ms': integerSchema('Tick interval in milliseconds.', { minimum: 1 }),
          'cooldown-ms': integerSchema('Cooldown in milliseconds.', { minimum: 0 }),
          'max-amount-usdc': numberSchema('Maximum trade amount in USDC.', { minimum: 0 }),
          'max-open-exposure-usdc': numberSchema('Maximum open exposure in USDC.', { minimum: 0 }),
          'max-trades-per-day': integerSchema('Maximum daily trade count.', { minimum: 0 }),
          'state-file': commonFlags.stateFile,
          'kill-switch-file': stringSchema('Kill-switch file path.'),
        },
        requiredFlags: ['market-address', 'side', 'amount-usdc'],
      }),
      preferred: true,
      mutating: true,
      safeFlags: ['--paper'],
      executeFlags: ['--execute-live'],
    },
  }),
  commandContract({
    name: 'autopilot.run',
    summary: 'Run continuous guarded autopilot loop.',
    usage:
      'pandora [--output table|json] autopilot run --market-address <address> --side yes|no --amount-usdc <amount> [--trigger-yes-below <0-100>] [--trigger-yes-above <0-100>] [--paper|--execute-live] [--interval-ms <ms>] [--cooldown-ms <ms>] [--max-amount-usdc <amount>] [--max-open-exposure-usdc <amount>] [--max-trades-per-day <n>] [--state-file <path>] [--kill-switch-file <path>] [--webhook-url <url>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>]',
    emits: ['autopilot', 'autopilot.help'],
    dataSchema: '#/definitions/AutopilotPayload',
    mcpExposed: true,
    mcp: {
      command: ['autopilot', 'run'],
      description: 'Start continuous autopilot loop. Long-running execution remains blocked in MCP v1, and live mutation requires intent.execute with execute-live.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'market-address': commonFlags.marketAddress,
          side: enumSchema(['yes', 'no'], 'Outcome side.'),
          'amount-usdc': numberSchema('Trade notional in USDC.', { minimum: 0 }),
          paper: commonFlags.paper,
          'execute-live': booleanSchema('Execute live autopilot action.'),
          'interval-ms': integerSchema('Tick interval in milliseconds.', { minimum: 1 }),
          'cooldown-ms': integerSchema('Cooldown in milliseconds.', { minimum: 0 }),
          'max-amount-usdc': numberSchema('Maximum trade amount in USDC.', { minimum: 0 }),
          'max-open-exposure-usdc': numberSchema('Maximum open exposure in USDC.', { minimum: 0 }),
          'max-trades-per-day': integerSchema('Maximum daily trade count.', { minimum: 0 }),
          'state-file': commonFlags.stateFile,
          'kill-switch-file': stringSchema('Kill-switch file path.'),
        },
        requiredFlags: ['market-address', 'side', 'amount-usdc'],
      }),
      preferred: true,
      longRunningBlocked: true,
      mutating: true,
      safeFlags: ['--paper'],
      executeFlags: ['--execute-live'],
    },
  }),
  commandContract({
    name: 'mirror',
    summary: 'Mirror command family help and routing entrypoint.',
    usage:
      'pandora [--output table|json] mirror browse|plan|deploy|verify|lp-explain|hedge-calc|calc|simulate|go|sync|dashboard|status|health|panic|drift|hedge-check|pnl|audit|replay|trace|logs|close ...',
    emits: ['mirror.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
  }),
  commandContract({
    name: 'mirror.browse',
    summary: 'Browse Polymarket mirror candidates with optional sports tag filters.',
    usage:
      'pandora [--output table|json] mirror browse [--min-yes-pct <n>] [--max-yes-pct <n>] [--min-volume-24h <n>] [--closes-after <date>|--end-date-after <date|72h>] [--closes-before <date>|--end-date-before <date|72h>] [--question-contains <text>|--keyword <text>] [--slug <text>] [--category sports|crypto|politics|entertainment] [--exclude-sports] [--sort-by volume24h|liquidity|endDate] [--limit <n>] [--chain-id <id>] [--polymarket-tag-id <id>] [--polymarket-tag-ids <csv>] [--sport-tag-id <id>] [--sport-tag-ids <csv>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
    emits: ['mirror.browse', 'mirror.browse.help'],
    dataSchema: '#/definitions/MirrorBrowsePayload',
    mcpExposed: true,
    mcp: {
      command: ['mirror', 'browse'],
      description: 'Browse candidate Polymarket mirrors.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'min-yes-pct': numberSchema('Minimum YES probability percent.', { minimum: 0, maximum: 100 }),
          'max-yes-pct': numberSchema('Maximum YES probability percent.', { minimum: 0, maximum: 100 }),
          'min-volume-24h': numberSchema('Minimum 24h volume.', { minimum: 0 }),
          'closes-after': stringSchema('Lower close-date bound.'),
          'end-date-after': stringSchema('Alias for lower close-date bound.'),
          'closes-before': stringSchema('Upper close-date bound.'),
          'end-date-before': stringSchema('Alias for upper close-date bound.'),
          'question-contains': stringSchema('Question substring filter.'),
          keyword: stringSchema('Alias for question substring filter.'),
          slug: stringSchema('Slug substring filter.'),
          category: enumSchema(['sports', 'crypto', 'politics', 'entertainment'], 'Category filter.'),
          'exclude-sports': booleanSchema('Exclude sports-tagged markets.'),
          'sort-by': enumSchema(['volume24h', 'liquidity', 'endDate'], 'Sort field.'),
          limit: commonFlags.limit,
          'chain-id': commonFlags.chainId,
          'polymarket-tag-id': integerSchema('Single Polymarket tag id.', { minimum: 0 }),
          'polymarket-tag-ids': stringSchema('Comma-delimited Polymarket tag ids.'),
          'sport-tag-id': integerSchema('Single sports tag id.', { minimum: 0 }),
          'sport-tag-ids': stringSchema('Comma-delimited sports tag ids.'),
          'polymarket-gamma-url': stringSchema('Polymarket Gamma API base URL.'),
          'polymarket-gamma-mock-url': stringSchema('Polymarket Gamma mock URL.'),
          'polymarket-mock-url': stringSchema('Polymarket mock CLOB URL.'),
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'mirror.plan',
    summary: 'Generate mirror sizing and distribution plan from a Polymarket source market.',
    usage:
      'pandora [--output table|json] mirror plan --source polymarket --polymarket-market-id <id>|--polymarket-slug <slug> [--chain-id <id>] [--target-slippage-bps <n>] [--turnover-target <n>] [--depth-slippage-bps <n>] [--safety-multiplier <n>] [--min-liquidity-usdc <n>] [--max-liquidity-usdc <n>] [--with-rules] [--include-similarity] [--min-close-lead-seconds <n>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
    emits: ['mirror.plan', 'mirror.plan.help'],
    dataSchema: '#/definitions/MirrorPlanPayload',
    mcpExposed: true,
    mcp: {
      command: ['mirror', 'plan'],
      description: 'Build mirror sizing/deploy plan.',
      inputSchema: buildInputSchema({
        flagProperties: {
          source: enumSchema(['polymarket'], 'Source venue.'),
          'polymarket-market-id': stringSchema('Polymarket market id.'),
          'polymarket-slug': stringSchema('Polymarket slug.'),
          'chain-id': commonFlags.chainId,
          'target-slippage-bps': numberSchema('Target slippage in basis points.', { minimum: 0 }),
          'turnover-target': numberSchema('Turnover target.', { minimum: 0 }),
          'depth-slippage-bps': numberSchema('Depth slippage in basis points.', { minimum: 0 }),
          'safety-multiplier': numberSchema('Safety multiplier.', { minimum: 0 }),
          'min-liquidity-usdc': numberSchema('Minimum liquidity in USDC.', { minimum: 0 }),
          'max-liquidity-usdc': numberSchema('Maximum liquidity in USDC.', { minimum: 0 }),
          'with-rules': booleanSchema('Include market rules payloads.'),
          'include-similarity': booleanSchema('Include similarity diagnostics.'),
          'min-close-lead-seconds': integerSchema('Lead time before targetTimestamp when Pandora trading closes.', { minimum: 1 }),
          'polymarket-gamma-url': stringSchema('Polymarket Gamma API base URL.'),
          'polymarket-gamma-mock-url': stringSchema('Polymarket Gamma mock URL.'),
          'polymarket-mock-url': stringSchema('Polymarket mock CLOB URL.'),
        },
        requiredFlags: ['source'],
        anyOf: mirrorPolymarketSelectorAnyOf,
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'mirror.deploy',
    summary: 'Deploy a mirror market from selector or plan in dry-run or execute mode.',
    usage:
      'pandora [--output table|json] mirror deploy --plan-file <path>|--polymarket-market-id <id>|--polymarket-slug <slug> --dry-run|--execute [--liquidity-usdc <n>] [--fee-tier <500-50000>] [--max-imbalance <n>] [--arbiter <address>] [--category <id|name>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--oracle <address>] [--factory <address>] [--usdc <address>] [--distribution-yes <parts>] [--distribution-no <parts>] [--distribution-yes-pct <pct>] [--distribution-no-pct <pct>] [--sources <url...>] [--validation-ticket <ticket>] [--target-timestamp <unix|iso>] [--manifest-file <path>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>] [--min-close-lead-seconds <n>]',
    emits: ['mirror.deploy', 'mirror.deploy.help'],
    dataSchema: '#/definitions/MirrorDeployPayload',
    mcpExposed: true,
    agentWorkflow: {
      requiredTools: ['agent.market.validate'],
      recommendedTools: ['agent.market.autocomplete'],
      executeRequiresValidation: true,
      notes: [
        'Mirror deploy dry-run returns the exact Pandora deployment payload and required validation ticket.',
        'Mirror deploy never auto-copies Polymarket URLs into sources; pass independent public resolution URLs with --sources.',
        'Run agent.market.validate on that exact final payload before rerunning mirror.deploy with execute mode, then pass --validation-ticket locally or agentPreflight in MCP.',
        'Validation tickets are bound to the exact final deploy payload. Any change to question, rules, sources, target timestamp, liquidity, fee params, or distribution requires a fresh validation pass.',
      ],
    },
    mcp: {
      command: ['mirror', 'deploy'],
      description: 'Dry-run or execute mirror deployment. Execute mode expects a validation ticket for the exact final deploy payload.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'plan-file': stringSchema('Mirror plan file path.'),
          'polymarket-market-id': stringSchema('Polymarket market id.'),
          'polymarket-slug': stringSchema('Polymarket slug.'),
          'dry-run': booleanSchema('Run dry-run mode.'),
          execute: booleanSchema('Execute live deployment.'),
          'liquidity-usdc': numberSchema('Initial liquidity in USDC.', { minimum: 0 }),
          'fee-tier': integerSchema('Fee tier in hundredths of a bip.', { minimum: 500, maximum: 50000 }),
          'max-imbalance': numberSchema('Maximum imbalance ratio.', { minimum: 0 }),
          arbiter: stringSchema('Arbiter address.'),
          category: buildPollCategorySchema('Category id or canonical category name.'),
          'chain-id': commonFlags.chainId,
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          'profile-id': commonFlags.profileId,
          'profile-file': commonFlags.profileFile,
          oracle: stringSchema('Oracle address.'),
          factory: stringSchema('Factory address.'),
          usdc: stringSchema('USDC token address.'),
          'distribution-yes': numberSchema('Initial YES distribution parts.', { minimum: 0 }),
          'distribution-no': numberSchema('Initial NO distribution parts.', { minimum: 0 }),
          'distribution-yes-pct': numberSchema('Initial YES distribution percent.', { minimum: 0, maximum: 100 }),
          'distribution-no-pct': numberSchema('Initial NO distribution percent.', { minimum: 0, maximum: 100 }),
          sources: flexibleArraySchema(stringSchema(), 'Source URL list.'),
          'validation-ticket': stringSchema('Ticket returned by agent.market.validate for the exact final payload (CLI execute mode).'),
          'target-timestamp': buildTargetTimestampSchema('Explicit target timestamp override.'),
          'manifest-file': stringSchema('Mirror manifest path.'),
          'polymarket-host': stringSchema('Polymarket host override.'),
          'polymarket-gamma-url': stringSchema('Polymarket Gamma API base URL.'),
          'polymarket-gamma-mock-url': stringSchema('Polymarket Gamma mock URL.'),
          'polymarket-mock-url': stringSchema('Polymarket mock CLOB URL.'),
          'min-close-lead-seconds': integerSchema('Minimum close lead time in seconds.', { minimum: 0 }),
          agentPreflight: buildAgentPreflightSchema('Agent validation attestation for execute mode.'),
        },
        anyOf: mirrorSelectorAndModeAnyOf,
        oneOf: mirrorDeploySelectorAndModeOneOf,
      }),
      preferred: true,
      mutating: true,
      safeFlags: ['--dry-run'],
      executeFlags: ['--execute'],
      controlInputNames: ['agentPreflight'],
    },
  }),
  commandContract({
    name: 'mirror.verify',
    summary: 'Verify a Pandora market against a Polymarket source pair.',
    usage:
      'pandora [--output table|json] mirror verify --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [--trust-deploy] [--manifest-file <path>] [--include-similarity] [--with-rules] [--allow-rule-mismatch] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
    emits: ['mirror.verify', 'mirror.verify.help'],
    dataSchema: '#/definitions/MirrorVerifyPayload',
    mcpExposed: true,
    mcp: {
      command: ['mirror', 'verify'],
      description: 'Verify Pandora/Polymarket mirror pair.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'pandora-market-address': commonFlags.marketAddress,
          'market-address': commonFlags.marketAddress,
          'polymarket-market-id': stringSchema('Polymarket market id.'),
          'polymarket-slug': stringSchema('Polymarket slug.'),
          'trust-deploy': booleanSchema('Trust manifest deploy pair.'),
          'manifest-file': stringSchema('Mirror manifest path.'),
          'include-similarity': booleanSchema('Include similarity diagnostics.'),
          'with-rules': booleanSchema('Include rule payloads.'),
          'allow-rule-mismatch': booleanSchema('Downgrade rule mismatch to warning.'),
          'polymarket-host': stringSchema('Polymarket host override.'),
          'polymarket-gamma-url': stringSchema('Polymarket Gamma API base URL.'),
          'polymarket-gamma-mock-url': stringSchema('Polymarket Gamma mock URL.'),
          'polymarket-mock-url': stringSchema('Polymarket mock CLOB URL.'),
        },
        anyOf: mirrorPandoraPolymarketSelectorAnyOf,
        oneOf: mirrorVerifySelectorOneOf,
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'mirror.lp-explain',
    summary: 'Explain complete-set LP mechanics and inventory split.',
    usage:
      'pandora [--output table|json] mirror lp-explain --liquidity-usdc <n> [--source-yes-pct <0-100>] [--distribution-yes <parts>] [--distribution-no <parts>]',
    emits: ['mirror.lp-explain', 'mirror.lp-explain.help'],
    dataSchema: '#/definitions/MirrorHedgeCalcPayload',
    mcpExposed: true,
    mcp: {
      command: ['mirror', 'lp-explain'],
      description: 'Explain LP economics from odds.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'liquidity-usdc': numberSchema('Initial liquidity in USDC.', { minimum: 0 }),
          'source-yes-pct': numberSchema('Source YES probability percent.', { minimum: 0, maximum: 100 }),
          'distribution-yes': numberSchema('Initial YES distribution parts.', { minimum: 0 }),
          'distribution-no': numberSchema('Initial NO distribution parts.', { minimum: 0 }),
        },
        requiredFlags: ['liquidity-usdc'],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'mirror.hedge-calc',
    summary: 'Compute offline hedge sizing and leg diagnostics from explicit reserves or a resolved mirror pair. This is analytical sizing, not the live dashboard/actionability gate.',
    usage:
      'pandora [--output table|json] mirror hedge-calc [--reserve-yes-usdc <n> --reserve-no-usdc <n>] [--excess-yes-usdc <n>] [--excess-no-usdc <n>] [--polymarket-yes-pct <0-100>] [--hedge-ratio <n>] [--hedge-cost-bps <n>] [--fee-tier <500-50000>] [--volume-scenarios <csv>] [--pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug>] [--trust-deploy] [--manifest-file <path>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
    emits: ['mirror.hedge-calc', 'mirror.hedge-calc.help'],
    dataSchema: '#/definitions/MirrorHedgeCalcPayload',
    mcpExposed: true,
    mcp: {
      command: ['mirror', 'hedge-calc'],
      description: 'Compute offline hedge sizing and legs from explicit reserves or a resolved mirror pair. Use `mirror hedge-check` or `mirror status --with-live` for current live hedge posture.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'reserve-yes-usdc': numberSchema('Pandora YES-side reserve in USDC.', { minimum: 0 }),
          'reserve-no-usdc': numberSchema('Pandora NO-side reserve in USDC.', { minimum: 0 }),
          'excess-yes-usdc': numberSchema('Existing YES-side hedge inventory in USDC terms.', { minimum: 0 }),
          'excess-no-usdc': numberSchema('Existing NO-side hedge inventory in USDC terms.', { minimum: 0 }),
          'hedge-ratio': numberSchema('Desired hedge ratio.', { minimum: 0 }),
          'hedge-cost-bps': integerSchema('Estimated hedge cost in basis points.', { minimum: 0 }),
          'fee-tier': integerSchema('Fee tier in hundredths of a bip.', { minimum: 500, maximum: 50000 }),
          'volume-scenarios': stringSchema('Comma-delimited fee-volume scenarios in USDC.'),
          'polymarket-yes-pct': numberSchema('Polymarket YES probability percent.', { minimum: 0, maximum: 100 }),
          'pandora-market-address': commonFlags.marketAddress,
          'market-address': commonFlags.marketAddress,
          'polymarket-market-id': stringSchema('Polymarket market id.'),
          'polymarket-slug': stringSchema('Polymarket slug.'),
          'trust-deploy': booleanSchema('Trust manifest deploy pair.'),
          'manifest-file': stringSchema('Mirror manifest path.'),
          'polymarket-host': stringSchema('Polymarket host override for selector-based resolution.'),
          'polymarket-gamma-url': stringSchema('Polymarket Gamma API base URL for selector-based resolution.'),
          'polymarket-gamma-mock-url': stringSchema('Polymarket Gamma mock URL for selector-based resolution.'),
          'polymarket-mock-url': stringSchema('Polymarket mock CLOB URL for selector-based resolution.'),
        },
        anyOf: [['reserve-yes-usdc', 'reserve-no-usdc'], ...mirrorPandoraPolymarketSelectorAnyOf],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'mirror.calc',
    summary: 'Compute exact Pandora rebalance sizing to reach a target percentage, then derive the corresponding hedge inventory needed on Polymarket.',
    usage:
      'pandora [--output table|json] mirror calc --target-pct <0-100> --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) [--trust-deploy] [--manifest-file <path>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
    emits: ['mirror.calc', 'mirror.calc.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
    mcpExposed: true,
    mcp: {
      command: ['mirror', 'calc'],
      description: 'Compute exact Pandora notional needed to reach a target percentage, then derive the corresponding hedge inventory needed on Polymarket.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'target-pct': numberSchema('Target Pandora YES probability percent.', { minimum: 0, maximum: 100 }),
          'state-file': commonFlags.stateFile,
          'strategy-hash': stringSchema('Mirror strategy hash.'),
          'pandora-market-address': commonFlags.marketAddress,
          'market-address': commonFlags.marketAddress,
          'polymarket-market-id': stringSchema('Polymarket market id.'),
          'polymarket-slug': stringSchema('Polymarket slug.'),
          'trust-deploy': booleanSchema('Trust manifest deploy pair.'),
          'manifest-file': stringSchema('Mirror manifest path.'),
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
          'polymarket-host': stringSchema('Polymarket host override for live diagnostics.'),
          'polymarket-gamma-url': stringSchema('Polymarket Gamma API base URL for live diagnostics.'),
          'polymarket-gamma-mock-url': stringSchema('Polymarket Gamma mock URL for live diagnostics.'),
          'polymarket-mock-url': stringSchema('Polymarket mock CLOB URL for live diagnostics.'),
        },
        requiredFlags: ['target-pct'],
        anyOf: mirrorResolvedLookupAnyOf,
        oneOf: mirrorResolvedLookupOneOf,
      }),
      preferred: true,
    },
    agentPlatform: {
      externalDependencies: ['filesystem', 'polymarket-api'],
      expectedLatencyMs: 1500,
    },
  }),
  commandContract({
    name: 'mirror.drift',
    summary: 'Read the dedicated live drift/readiness surface for a mirror pair via persisted state or selector-first lookup.',
    usage:
      'pandora [--output table|json] mirror drift --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
    emits: ['mirror.drift', 'mirror.drift.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
    mcpExposed: true,
    mcp: {
      command: ['mirror', 'drift'],
      description: 'Read the dedicated live drift/readiness surface for a mirror pair using persisted state or direct selectors.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'state-file': commonFlags.stateFile,
          'strategy-hash': stringSchema('Mirror strategy hash.'),
          'pandora-market-address': commonFlags.marketAddress,
          'market-address': commonFlags.marketAddress,
          'polymarket-market-id': stringSchema('Polymarket market id.'),
          'polymarket-slug': stringSchema('Polymarket slug.'),
          'trust-deploy': booleanSchema('Trust manifest deploy pair.'),
          'manifest-file': stringSchema('Mirror manifest path.'),
          'drift-trigger-bps': integerSchema('Drift trigger in basis points used when projecting live sync posture.', { minimum: 1 }),
          'hedge-trigger-usdc': numberSchema('Hedge trigger size in USDC used when projecting live sync posture.', { minimum: 0 }),
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
          'polymarket-host': stringSchema('Polymarket host override for live diagnostics.'),
          'polymarket-gamma-url': stringSchema('Polymarket Gamma API base URL for live diagnostics.'),
          'polymarket-gamma-mock-url': stringSchema('Polymarket Gamma mock URL for live diagnostics.'),
          'polymarket-mock-url': stringSchema('Polymarket mock CLOB URL for live diagnostics.'),
        },
        anyOf: mirrorResolvedLookupAnyOf,
        oneOf: mirrorResolvedLookupOneOf,
      }),
      preferred: true,
    },
    agentPlatform: {
      externalDependencies: ['filesystem', 'polymarket-api'],
      expectedLatencyMs: 1500,
    },
  }),
  commandContract({
    name: 'mirror.hedge-check',
    summary: 'Read the dedicated live hedge-gap/readiness surface for a mirror pair via persisted state or selector-first lookup.',
    usage:
      'pandora [--output table|json] mirror hedge-check --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
    emits: ['mirror.hedge-check', 'mirror.hedge-check.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
    mcpExposed: true,
    mcp: {
      command: ['mirror', 'hedge-check'],
      description: 'Read the dedicated live hedge-gap/readiness surface for a mirror pair using persisted state or direct selectors.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'state-file': commonFlags.stateFile,
          'strategy-hash': stringSchema('Mirror strategy hash.'),
          'pandora-market-address': commonFlags.marketAddress,
          'market-address': commonFlags.marketAddress,
          'polymarket-market-id': stringSchema('Polymarket market id.'),
          'polymarket-slug': stringSchema('Polymarket slug.'),
          'trust-deploy': booleanSchema('Trust manifest deploy pair.'),
          'manifest-file': stringSchema('Mirror manifest path.'),
          'drift-trigger-bps': integerSchema('Drift trigger in basis points used when projecting live sync posture.', { minimum: 1 }),
          'hedge-trigger-usdc': numberSchema('Hedge trigger size in USDC used when projecting live sync posture.', { minimum: 0 }),
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
          'polymarket-host': stringSchema('Polymarket host override for live diagnostics.'),
          'polymarket-gamma-url': stringSchema('Polymarket Gamma API base URL for live diagnostics.'),
          'polymarket-gamma-mock-url': stringSchema('Polymarket Gamma mock URL for live diagnostics.'),
          'polymarket-mock-url': stringSchema('Polymarket mock CLOB URL for live diagnostics.'),
        },
        anyOf: mirrorResolvedLookupAnyOf,
        oneOf: mirrorResolvedLookupOneOf,
      }),
      preferred: true,
    },
    agentPlatform: {
      externalDependencies: ['filesystem', 'polymarket-api'],
      expectedLatencyMs: 1500,
    },
  }),
  commandContract({
    name: 'mirror.simulate',
    summary: 'Run mirror LP economics simulation.',
    usage:
      'pandora [--output table|json] mirror simulate --liquidity-usdc <n> [--source-yes-pct <0-100>] [--target-yes-pct <0-100>] [--distribution-yes <parts>] [--distribution-no <parts>] [--fee-tier <500-50000>] [--volume-scenarios <csv>] [--hedge-ratio <n>] [--polymarket-yes-pct <0-100>]',
    emits: ['mirror.simulate', 'mirror.simulate.help'],
    dataSchema: '#/definitions/GenericCommandData',
    mcpExposed: true,
    mcp: {
      command: ['mirror', 'simulate'],
      description: 'Simulate LP PnL scenarios.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'liquidity-usdc': numberSchema('Initial liquidity in USDC.', { minimum: 0 }),
          'source-yes-pct': numberSchema('Source YES probability percent.', { minimum: 0, maximum: 100 }),
          'target-yes-pct': numberSchema('Target YES probability percent.', { minimum: 0, maximum: 100 }),
          'distribution-yes': numberSchema('Initial YES distribution parts.', { minimum: 0 }),
          'distribution-no': numberSchema('Initial NO distribution parts.', { minimum: 0 }),
          'fee-tier': integerSchema('Fee tier in hundredths of a bip.', { minimum: 500, maximum: 50000 }),
          'volume-scenarios': stringSchema('Comma-delimited volume scenarios.'),
          'hedge-ratio': numberSchema('Desired hedge ratio.', { minimum: 0 }),
          'polymarket-yes-pct': numberSchema('Polymarket YES probability percent.', { minimum: 0, maximum: 100 }),
        },
        requiredFlags: ['liquidity-usdc'],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'mirror.go',
    summary: 'Run mirror deploy, verify, and optional sync workflow. Rebalance-route flags apply only to the Ethereum Pandora leg; any sync leg still remains separate Pandora rebalance and Polymarket hedge legs, not atomic.',
    usage:
      'pandora [--output table|json] mirror go --polymarket-market-id <id>|--polymarket-slug <slug> [--liquidity-usdc <n>] [--fee-tier <500-50000>] [--max-imbalance <n>] [--arbiter <address>] [--category <id|name>] [--paper|--dry-run|--execute-live|--execute] [--auto-sync] [--sync-once] [--auto-resolve] [--auto-close] [--resolve-answer yes|no] [--resolve-reason <text>] [--resolve-watch-interval-ms <ms>] [--resolve-watch-timeout-ms <ms>] [--sync-interval-ms <ms>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--hedge-ratio <n>] [--no-hedge] [--rebalance-mode atomic|incremental] [--price-source on-chain|indexer] [--rebalance-route public|auto|flashbots-private|flashbots-bundle] [--rebalance-route-fallback fail|public] [--flashbots-relay-url <url>] [--flashbots-auth-key <key>] [--flashbots-target-block-offset <n>] [--max-rebalance-usdc <n>] [--max-hedge-usdc <n>] [--max-open-exposure-usdc <amount>] [--max-trades-per-day <n>] [--cooldown-ms <ms>] [--depth-slippage-bps <n>] [--min-time-to-close-sec <n>] [--strict-close-time-delta] [--chain-id <id>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--usdc <address>] [--oracle <address>] [--factory <address>] [--distribution-yes <parts>] [--distribution-no <parts>] [--distribution-yes-pct <pct>] [--distribution-no-pct <pct>] [--sources <url...>] [--validation-ticket <ticket>] [--target-timestamp <unix|iso>] [--manifest-file <path>] [--trust-deploy] [--skip-gate] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>] [--with-rules] [--include-similarity] [--min-close-lead-seconds <n>] [--dotenv-path <path>]',
    emits: ['mirror.go', 'mirror.go.help'],
    dataSchema: '#/definitions/MirrorDeployPayload',
    mcpExposed: true,
    agentWorkflow: {
      requiredTools: ['agent.market.validate'],
      recommendedTools: ['agent.market.autocomplete'],
      executeRequiresValidation: true,
      notes: [
        'Mirror go inherits the exact market payload from its deploy stage; use the returned validation ticket from paper/dry-run output.',
        'When mirror go will execute a fresh deploy, provide independent public --sources and a matching validation ticket.',
        'Run agent.market.validate on that exact payload before rerunning mirror.go with execute or execute-live.',
        'Validation tickets are bound to the exact final deploy payload. Any change to question, rules, sources, target timestamp, liquidity, fee params, or distribution requires a fresh validation pass.',
        'Private-routing flags affect only the Ethereum Pandora rebalance leg. They do not make the Polygon hedge leg atomic.',
      ],
    },
    mcp: {
      command: ['mirror', 'go'],
      description: 'Plan/deploy/verify/go orchestration. Rebalance-route flags affect only the Ethereum Pandora leg. Auto-sync still executes separate Pandora rebalance and Polymarket hedge legs, cross-venue settlement is not atomic, and lifecycle automation can optionally chain explicit resolve-watch plus closeout while returning structured Polymarket settlement status and resume guidance.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'polymarket-market-id': stringSchema('Polymarket market id.'),
          'polymarket-slug': stringSchema('Polymarket slug.'),
          'liquidity-usdc': numberSchema('Initial liquidity in USDC.', { minimum: 0 }),
          'fee-tier': integerSchema('Fee tier in hundredths of a bip.', { minimum: 500, maximum: 50000 }),
          'max-imbalance': numberSchema('Maximum imbalance ratio.', { minimum: 0 }),
          arbiter: stringSchema('Arbiter address.'),
          category: buildPollCategorySchema('Category id or canonical category name.'),
          'chain-id': commonFlags.chainId,
          paper: commonFlags.paper,
          'dry-run': commonFlags.dryRun,
          'execute-live': booleanSchema('Execute live workflow.'),
          execute: commonFlags.execute,
          'auto-sync': booleanSchema('Start sync automatically after deploy.'),
          'sync-once': booleanSchema('Run one sync tick after deploy.'),
          'auto-resolve': booleanSchema('After deploy/verify and any finite sync step, watch until resolution is executable and submit resolve automatically. Requires live mode plus explicit resolve inputs.'),
          'auto-close': booleanSchema('After auto-resolve completes, run mirror close automatically and include structured Polymarket settlement status in the final report.'),
          'resolve-answer': enumSchema(['yes', 'no'], 'Explicit resolution answer used by lifecycle automation.'),
          'resolve-reason': stringSchema('Operator reason recorded in the lifecycle resolve payload.'),
          'resolve-watch-interval-ms': integerSchema('Polling interval used by mirror go lifecycle resolve watch.', { minimum: 1 }),
          'resolve-watch-timeout-ms': integerSchema('Timeout used by mirror go lifecycle resolve watch.', { minimum: 1 }),
          'sync-interval-ms': integerSchema('Sync interval in milliseconds.', { minimum: 1 }),
          'drift-trigger-bps': integerSchema('Drift trigger in basis points.', { minimum: 1 }),
          'hedge-trigger-usdc': numberSchema('Hedge trigger size in USDC.', { minimum: 0 }),
          'hedge-ratio': numberSchema('Desired hedge ratio.', { minimum: 0 }),
          'hedge-scope': enumSchema(['pool', 'total'], 'Hedge basis. total includes held Pandora outcome tokens in addition to pool reserves; pool hedges only the AMM reserves.'),
          verbose: booleanSchema('Emit expanded per-tick console diagnostics.'),
          'adopt-existing-positions': booleanSchema('Seed managed Polymarket inventory from existing live YES/NO balances before sell-side recycling.'),
          'no-hedge': booleanSchema('Disable source hedge leg.'),
          'rebalance-mode': enumSchema(['atomic', 'incremental'], 'Rebalance sizing mode. atomic targets the source price in one Pandora leg when reserves are available; incremental sizes by observed drift.'),
          'price-source': enumSchema(['on-chain', 'indexer'], 'Reserve source for Pandora pricing. on-chain refreshes outcome-token balances before sizing; indexer uses verify payload reserves.'),
          'rebalance-route': buildMirrorRebalanceRouteSchema(),
          'rebalance-route-fallback': buildMirrorRebalanceRouteFallbackSchema(),
          'flashbots-relay-url': stringSchema('Optional Flashbots/private relay URL for the Ethereum Pandora rebalance leg.'),
          'flashbots-auth-key': stringSchema('Optional Flashbots auth key or signer reference for the Ethereum Pandora rebalance leg.'),
          'flashbots-target-block-offset': integerSchema('Optional target block offset for Flashbots/private bundle submission.', { minimum: 1 }),
          'max-rebalance-usdc': numberSchema('Maximum rebalance notional in USDC.', { minimum: 0 }),
          'max-hedge-usdc': numberSchema('Maximum hedge notional in USDC.', { minimum: 0 }),
          'max-open-exposure-usdc': numberSchema('Maximum open exposure in USDC.', { minimum: 0 }),
          'max-trades-per-day': integerSchema('Maximum daily trade count.', { minimum: 0 }),
          'cooldown-ms': integerSchema('Idempotency cooldown in milliseconds.', { minimum: 1 }),
          'depth-slippage-bps': integerSchema('Depth slippage in basis points.', { minimum: 1, maximum: 10000 }),
          'min-time-to-close-sec': integerSchema('Minimum time-to-close in seconds.', { minimum: 1 }),
          'strict-close-time-delta': booleanSchema('Promote close-time delta mismatches from diagnostic to blocking.'),
          'polymarket-rpc-url': stringSchema('Polygon RPC URL for Polymarket preflight; comma-separated fallbacks are tried in order. This does not override Pandora reserve reads on --rpc-url.'),
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          'profile-id': commonFlags.profileId,
          'profile-file': commonFlags.profileFile,
          funder: stringSchema('Polymarket proxy/safe address.'),
          usdc: stringSchema('USDC token address override.'),
          oracle: stringSchema('Oracle address override.'),
          factory: stringSchema('Factory address override.'),
          'distribution-yes': numberSchema('Initial YES distribution parts.', { minimum: 0 }),
          'distribution-no': numberSchema('Initial NO distribution parts.', { minimum: 0 }),
          'distribution-yes-pct': numberSchema('Initial YES distribution percent.', { minimum: 0, maximum: 100 }),
          'distribution-no-pct': numberSchema('Initial NO distribution percent.', { minimum: 0, maximum: 100 }),
          sources: flexibleArraySchema(stringSchema(), 'Independent public source URL list.'),
          'validation-ticket': stringSchema('Ticket returned by agent.market.validate for the exact final payload (CLI execute mode).'),
          'target-timestamp': buildTargetTimestampSchema('Explicit target timestamp override.'),
          'manifest-file': stringSchema('Mirror manifest path.'),
          'trust-deploy': booleanSchema('Trust manifest deploy pair.'),
          'skip-gate': buildMirrorSkipGateSchema(),
          'polymarket-host': stringSchema('Polymarket host override.'),
          'polymarket-gamma-url': stringSchema('Polymarket Gamma API base URL.'),
          'polymarket-gamma-mock-url': stringSchema('Polymarket Gamma mock URL.'),
          'polymarket-mock-url': stringSchema('Polymarket mock CLOB URL.'),
          'with-rules': booleanSchema('Include rule payloads and copy diagnostics.'),
          'include-similarity': booleanSchema('Include similarity diagnostics.'),
          'min-close-lead-seconds': integerSchema('Minimum lead time before targetTimestamp when Pandora trading closes.', { minimum: 1 }),
          'dotenv-path': stringSchema('Env file path.'),
          agentPreflight: buildAgentPreflightSchema('Agent validation attestation for execute or execute-live mode.'),
        },
        anyOf: mirrorPolymarketSelectorAnyOf,
        oneOf: mirrorGoSelectorAndModeOneOf,
      }),
      preferred: true,
      mutating: true,
      safeFlags: ['--paper', '--dry-run'],
      executeFlags: ['--execute-live', '--execute'],
      controlInputNames: ['agentPreflight'],
    },
  }),
  commandContract({
    name: 'mirror.sync',
    summary: 'Mirror sync runtime command family for separate Pandora rebalance and Polymarket hedge legs. Rebalance-route flags affect only the Ethereum Pandora leg; cross-venue settlement is not atomic.',
    usage: 'pandora [--output table|json] mirror sync once|run|start|stop|status|unlock ...',
    emits: ['mirror.sync.help'],
    dataSchema: '#/definitions/MirrorStatusPayload',
  }),
  commandContract({
    name: 'mirror.sync.once',
    summary: 'Execute one mirror sync tick with separate Pandora rebalance and Polymarket hedge legs. Rebalance-route flags affect only the Ethereum Pandora leg; cross-venue settlement is not atomic.',
    usage:
      'pandora [--output table|json] mirror sync once --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [--paper|--dry-run|--execute-live|--execute] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--usdc <address>] [--trust-deploy] [--manifest-file <path>] [--skip-gate] [--strict-close-time-delta] [--stream|--no-stream] [--verbose] [--interval-ms <ms>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--hedge-ratio <n>] [--hedge-scope pool|total] [--adopt-existing-positions] [--no-hedge] [--rebalance-mode atomic|incremental] [--price-source on-chain|indexer] [--rebalance-route public|auto|flashbots-private|flashbots-bundle] [--rebalance-route-fallback fail|public] [--flashbots-relay-url <url>] [--flashbots-auth-key <key>] [--flashbots-target-block-offset <n>] [--max-rebalance-usdc <n>] [--max-hedge-usdc <n>] [--max-open-exposure-usdc <amount>] [--max-trades-per-day <n>] [--cooldown-ms <ms>] [--depth-slippage-bps <n>] [--min-time-to-close-sec <n>] [--iterations <n>] [--state-file <path>] [--kill-switch-file <path>] [--chain-id <id>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>] [--webhook-url <url>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>]',
    emits: ['mirror.sync.once', 'mirror.sync.help'],
    dataSchema: '#/definitions/MirrorStatusPayload',
    mcpExposed: true,
    agentWorkflow: {
      requiredTools: [],
      recommendedTools: ['mirror.panic'],
      executeRequiresValidation: false,
      notes: [
        'The default mirror stop file is ~/.pandora/mirror/STOP. Its presence intentionally blocks local mirror sync starts and ticks until cleared.',
        'Use mirror.panic clear mode after incident review, or remove the stop file manually only if you know the emergency lock is stale.',
      ],
    },
    mcp: {
      command: ['mirror', 'sync', 'once'],
      description: 'Execute one mirror sync tick. Rebalance-route flags affect only the Ethereum Pandora leg. Snapshot/action payloads expose reserveSource and rebalance sizing provenance.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'pandora-market-address': commonFlags.marketAddress,
          'market-address': commonFlags.marketAddress,
          'polymarket-market-id': stringSchema('Polymarket market id.'),
          'polymarket-slug': stringSchema('Polymarket slug.'),
          'state-file': commonFlags.stateFile,
          paper: commonFlags.paper,
          'dry-run': commonFlags.dryRun,
          'execute-live': booleanSchema('Execute live sync actions.'),
          execute: commonFlags.execute,
          'interval-ms': integerSchema('Sync interval in milliseconds.', { minimum: 1000 }),
          'drift-trigger-bps': integerSchema('Drift trigger in basis points.', { minimum: 1 }),
          'hedge-trigger-usdc': numberSchema('Hedge trigger size in USDC.', { minimum: 0 }),
          'hedge-ratio': numberSchema('Desired hedge ratio.', { minimum: 0 }),
          'hedge-scope': enumSchema(['pool', 'total'], 'Hedge basis. total includes held Pandora outcome tokens in addition to pool reserves; pool hedges only the AMM reserves.'),
          verbose: booleanSchema('Emit expanded per-tick console diagnostics.'),
          'adopt-existing-positions': booleanSchema('Seed managed Polymarket inventory from existing live YES/NO balances before sell-side recycling.'),
          'no-hedge': booleanSchema('Disable source hedge leg.'),
          'rebalance-mode': enumSchema(['atomic', 'incremental'], 'Rebalance sizing mode. atomic targets the source price in one Pandora leg when reserves are available; incremental sizes by observed drift.'),
          'price-source': enumSchema(['on-chain', 'indexer'], 'Reserve source for Pandora pricing. on-chain refreshes outcome-token balances before sizing; indexer uses verify payload reserves.'),
          'rebalance-route': buildMirrorRebalanceRouteSchema(),
          'rebalance-route-fallback': buildMirrorRebalanceRouteFallbackSchema(),
          'flashbots-relay-url': stringSchema('Optional Flashbots/private relay URL for the Ethereum Pandora rebalance leg.'),
          'flashbots-auth-key': stringSchema('Optional Flashbots auth key or signer reference for the Ethereum Pandora rebalance leg.'),
          'flashbots-target-block-offset': integerSchema('Optional target block offset for Flashbots/private bundle submission.', { minimum: 1 }),
          'max-rebalance-usdc': numberSchema('Maximum rebalance notional in USDC.', { minimum: 0 }),
          'max-hedge-usdc': numberSchema('Maximum hedge notional in USDC.', { minimum: 0 }),
          'max-open-exposure-usdc': numberSchema('Maximum open exposure in USDC.', { minimum: 0 }),
          'max-trades-per-day': integerSchema('Maximum daily trade count.', { minimum: 0 }),
          'cooldown-ms': integerSchema('Idempotency cooldown in milliseconds.', { minimum: 1 }),
          'depth-slippage-bps': integerSchema('Depth slippage in basis points.', { minimum: 1, maximum: 10000 }),
          'min-time-to-close-sec': integerSchema('Minimum time-to-close in seconds.', { minimum: 1 }),
          'strict-close-time-delta': booleanSchema('Promote close-time delta mismatches from diagnostic to blocking.'),
          iterations: integerSchema('Maximum tick iterations before exit.', { minimum: 1 }),
          stream: booleanSchema('Emit streaming tick lines.'),
          'no-stream': booleanSchema('Disable streaming tick lines.'),
          'kill-switch-file': stringSchema('Kill-switch file path.'),
          'chain-id': commonFlags.chainId,
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          'profile-id': commonFlags.profileId,
          'profile-file': commonFlags.profileFile,
          funder: stringSchema('Polymarket proxy/safe address.'),
          usdc: stringSchema('USDC token address override.'),
          'polymarket-rpc-url': stringSchema('Polygon RPC URL for Polymarket preflight; comma-separated fallbacks are tried in order. This does not override Pandora reserve reads on --rpc-url.'),
          'polymarket-host': stringSchema('Polymarket host override.'),
          'polymarket-gamma-url': stringSchema('Polymarket Gamma API base URL.'),
          'polymarket-gamma-mock-url': stringSchema('Polymarket Gamma mock URL.'),
          'polymarket-mock-url': stringSchema('Polymarket mock CLOB URL.'),
          'trust-deploy': booleanSchema('Trust manifest deploy pair.'),
          'skip-gate': buildMirrorSkipGateSchema(),
          'manifest-file': stringSchema('Mirror manifest path.'),
          'webhook-url': stringSchema('Webhook target URL.'),
          'telegram-bot-token': stringSchema('Telegram bot token.'),
          'telegram-chat-id': stringSchema('Telegram chat id.'),
          'discord-webhook-url': stringSchema('Discord webhook URL.'),
        },
        anyOf: mirrorPandoraPolymarketSelectorAnyOf,
        oneOf: mirrorSyncSelectorAndOptionalModeOneOf,
      }),
      preferred: true,
      mutating: true,
      safeFlags: ['--paper', '--dry-run'],
      executeFlags: ['--execute-live', '--execute'],
    },
  }),
  commandContract({
    name: 'mirror.sync.run',
    summary: 'Run continuous mirror sync loop with separate Pandora rebalance and Polymarket hedge legs. Rebalance-route flags affect only the Ethereum Pandora leg; cross-venue settlement is not atomic.',
    usage:
      'pandora [--output table|json] mirror sync run --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [--paper|--dry-run|--execute-live|--execute] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--usdc <address>] [--trust-deploy] [--manifest-file <path>] [--skip-gate] [--strict-close-time-delta] [--daemon] [--stream|--no-stream] [--verbose] [--interval-ms <ms>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--hedge-ratio <n>] [--hedge-scope pool|total] [--adopt-existing-positions] [--no-hedge] [--rebalance-mode atomic|incremental] [--price-source on-chain|indexer] [--rebalance-route public|auto|flashbots-private|flashbots-bundle] [--rebalance-route-fallback fail|public] [--flashbots-relay-url <url>] [--flashbots-auth-key <key>] [--flashbots-target-block-offset <n>] [--max-rebalance-usdc <n>] [--max-hedge-usdc <n>] [--max-open-exposure-usdc <amount>] [--max-trades-per-day <n>] [--cooldown-ms <ms>] [--depth-slippage-bps <n>] [--min-time-to-close-sec <n>] [--iterations <n>] [--state-file <path>] [--kill-switch-file <path>] [--chain-id <id>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>] [--webhook-url <url>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>]',
    emits: ['mirror.sync.run', 'mirror.sync.help'],
    dataSchema: '#/definitions/MirrorStatusPayload',
    mcpExposed: true,
    agentWorkflow: {
      requiredTools: [],
      recommendedTools: ['mirror.panic'],
      executeRequiresValidation: false,
      notes: [
        'The default mirror stop file is ~/.pandora/mirror/STOP. Its presence intentionally blocks local mirror sync starts and ticks until cleared.',
        'Use mirror.panic clear mode after incident review, or remove the stop file manually only if you know the emergency lock is stale.',
      ],
    },
    mcp: {
      command: ['mirror', 'sync', 'run'],
      description: 'Continuous mirror sync loop. Rebalance-route flags affect only the Ethereum Pandora leg. Snapshot/action payloads expose reserveSource and rebalance sizing provenance. Long-running execution remains blocked in MCP v1, and live mutation requires intent.execute with execute or execute-live.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'pandora-market-address': commonFlags.marketAddress,
          'market-address': commonFlags.marketAddress,
          'polymarket-market-id': stringSchema('Polymarket market id.'),
          'polymarket-slug': stringSchema('Polymarket slug.'),
          'state-file': commonFlags.stateFile,
          paper: commonFlags.paper,
          'dry-run': commonFlags.dryRun,
          'execute-live': booleanSchema('Execute live sync actions.'),
          execute: commonFlags.execute,
          'interval-ms': integerSchema('Sync interval in milliseconds.', { minimum: 1 }),
          'drift-trigger-bps': integerSchema('Drift trigger in basis points.', { minimum: 1 }),
          'hedge-trigger-usdc': numberSchema('Hedge trigger size in USDC.', { minimum: 0 }),
          'hedge-ratio': numberSchema('Desired hedge ratio.', { minimum: 0 }),
          'hedge-scope': enumSchema(['pool', 'total'], 'Hedge basis. total includes held Pandora outcome tokens in addition to pool reserves; pool hedges only the AMM reserves.'),
          verbose: booleanSchema('Emit expanded per-tick console diagnostics.'),
          'adopt-existing-positions': booleanSchema('Seed managed Polymarket inventory from existing live YES/NO balances before sell-side recycling.'),
          'no-hedge': booleanSchema('Disable source hedge leg.'),
          'rebalance-mode': enumSchema(['atomic', 'incremental'], 'Rebalance sizing mode. atomic targets the source price in one Pandora leg when reserves are available; incremental sizes by observed drift.'),
          'price-source': enumSchema(['on-chain', 'indexer'], 'Reserve source for Pandora pricing. on-chain refreshes outcome-token balances before sizing; indexer uses verify payload reserves.'),
          'rebalance-route': buildMirrorRebalanceRouteSchema(),
          'rebalance-route-fallback': buildMirrorRebalanceRouteFallbackSchema(),
          'flashbots-relay-url': stringSchema('Optional Flashbots/private relay URL for the Ethereum Pandora rebalance leg.'),
          'flashbots-auth-key': stringSchema('Optional Flashbots auth key or signer reference for the Ethereum Pandora rebalance leg.'),
          'flashbots-target-block-offset': integerSchema('Optional target block offset for Flashbots/private bundle submission.', { minimum: 1 }),
          'max-rebalance-usdc': numberSchema('Maximum rebalance notional in USDC.', { minimum: 0 }),
          'max-hedge-usdc': numberSchema('Maximum hedge notional in USDC.', { minimum: 0 }),
          'max-open-exposure-usdc': numberSchema('Maximum open exposure in USDC.', { minimum: 0 }),
          'max-trades-per-day': integerSchema('Maximum daily trade count.', { minimum: 0 }),
          'cooldown-ms': integerSchema('Idempotency cooldown in milliseconds.', { minimum: 1 }),
          'depth-slippage-bps': integerSchema('Depth slippage in basis points.', { minimum: 1, maximum: 10000 }),
          'min-time-to-close-sec': integerSchema('Minimum time-to-close in seconds.', { minimum: 1 }),
          'strict-close-time-delta': booleanSchema('Promote close-time delta mismatches from diagnostic to blocking.'),
          iterations: integerSchema('Maximum tick iterations before exit.', { minimum: 1 }),
          stream: booleanSchema('Emit streaming tick lines.'),
          'no-stream': booleanSchema('Disable streaming tick lines.'),
          daemon: booleanSchema('Request daemonized run mode.'),
          'kill-switch-file': stringSchema('Kill-switch file path.'),
          'chain-id': commonFlags.chainId,
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          'profile-id': commonFlags.profileId,
          'profile-file': commonFlags.profileFile,
          funder: stringSchema('Polymarket proxy/safe address.'),
          usdc: stringSchema('USDC token address override.'),
          'polymarket-rpc-url': stringSchema('Polygon RPC URL for Polymarket preflight; comma-separated fallbacks are tried in order. This does not override Pandora reserve reads on --rpc-url.'),
          'polymarket-host': stringSchema('Polymarket host override.'),
          'polymarket-gamma-url': stringSchema('Polymarket Gamma API base URL.'),
          'polymarket-gamma-mock-url': stringSchema('Polymarket Gamma mock URL.'),
          'polymarket-mock-url': stringSchema('Polymarket mock CLOB URL.'),
          'trust-deploy': booleanSchema('Trust manifest deploy pair.'),
          'skip-gate': buildMirrorSkipGateSchema(),
          'manifest-file': stringSchema('Mirror manifest path.'),
          'webhook-url': stringSchema('Webhook target URL.'),
          'telegram-bot-token': stringSchema('Telegram bot token.'),
          'telegram-chat-id': stringSchema('Telegram chat id.'),
          'discord-webhook-url': stringSchema('Discord webhook URL.'),
        },
        anyOf: mirrorPandoraPolymarketSelectorAnyOf,
        oneOf: mirrorSyncSelectorAndOptionalModeOneOf,
      }),
      preferred: true,
      longRunningBlocked: true,
      mutating: true,
      safeFlags: ['--paper', '--dry-run'],
      executeFlags: ['--execute-live', '--execute'],
    },
  }),
    commandContract({
      name: 'mirror.sync.start',
    summary: 'Start detached mirror sync daemon for separate Pandora rebalance and Polymarket hedge legs. Rebalance-route flags affect only the Ethereum Pandora leg; cross-venue settlement is not atomic.',
    usage:
      'pandora [--output table|json] mirror sync start --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [--paper|--dry-run|--execute-live|--execute] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--usdc <address>] [--trust-deploy] [--manifest-file <path>] [--skip-gate] [--strict-close-time-delta] [--verbose] [--interval-ms <ms>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--hedge-ratio <n>] [--hedge-scope pool|total] [--adopt-existing-positions] [--no-hedge] [--rebalance-mode atomic|incremental] [--price-source on-chain|indexer] [--rebalance-route public|auto|flashbots-private|flashbots-bundle] [--rebalance-route-fallback fail|public] [--flashbots-relay-url <url>] [--flashbots-auth-key <key>] [--flashbots-target-block-offset <n>] [--max-rebalance-usdc <n>] [--max-hedge-usdc <n>] [--max-open-exposure-usdc <amount>] [--max-trades-per-day <n>] [--cooldown-ms <ms>] [--depth-slippage-bps <n>] [--min-time-to-close-sec <n>] [--iterations <n>] [--state-file <path>] [--kill-switch-file <path>] [--chain-id <id>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>] [--webhook-url <url>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>]',
    emits: ['mirror.sync.start', 'mirror.sync.help'],
    dataSchema: '#/definitions/MirrorStatusPayload',
    mcpExposed: true,
      agentWorkflow: {
        requiredTools: [],
        recommendedTools: ['mirror.panic'],
        executeRequiresValidation: false,
        notes: [
          'The default mirror stop file is ~/.pandora/mirror/STOP. Its presence intentionally blocks local mirror sync starts and ticks until cleared.',
          'Use mirror.panic clear mode after incident review, or remove the stop file manually only if you know the emergency lock is stale.',
        ],
      },
      mcp: {
      command: ['mirror', 'sync', 'start'],
      description: 'Start detached mirror sync daemon. Rebalance-route flags affect only the Ethereum Pandora leg. Snapshot/action payloads expose reserveSource and rebalance sizing provenance. Detached execution remains blocked in MCP v1, and live mutation requires intent.execute with execute or execute-live.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'pandora-market-address': commonFlags.marketAddress,
          'market-address': commonFlags.marketAddress,
          'polymarket-market-id': stringSchema('Polymarket market id.'),
          'polymarket-slug': stringSchema('Polymarket slug.'),
          'state-file': commonFlags.stateFile,
          paper: commonFlags.paper,
          'dry-run': commonFlags.dryRun,
          'execute-live': booleanSchema('Execute live sync actions.'),
          execute: commonFlags.execute,
          'interval-ms': integerSchema('Sync interval in milliseconds.', { minimum: 1 }),
          'drift-trigger-bps': integerSchema('Drift trigger in basis points.', { minimum: 1 }),
          'hedge-trigger-usdc': numberSchema('Hedge trigger size in USDC.', { minimum: 0 }),
          'hedge-ratio': numberSchema('Desired hedge ratio.', { minimum: 0 }),
          'hedge-scope': enumSchema(['pool', 'total'], 'Hedge basis. total includes held Pandora outcome tokens in addition to pool reserves; pool hedges only the AMM reserves.'),
          verbose: booleanSchema('Emit expanded per-tick console diagnostics.'),
          'adopt-existing-positions': booleanSchema('Seed managed Polymarket inventory from existing live YES/NO balances before sell-side recycling.'),
          'no-hedge': booleanSchema('Disable source hedge leg.'),
          'rebalance-mode': enumSchema(['atomic', 'incremental'], 'Rebalance sizing mode. atomic targets the source price in one Pandora leg when reserves are available; incremental sizes by observed drift.'),
          'price-source': enumSchema(['on-chain', 'indexer'], 'Reserve source for Pandora pricing. on-chain refreshes outcome-token balances before sizing; indexer uses verify payload reserves.'),
          'rebalance-route': buildMirrorRebalanceRouteSchema(),
          'rebalance-route-fallback': buildMirrorRebalanceRouteFallbackSchema(),
          'flashbots-relay-url': stringSchema('Optional Flashbots/private relay URL for the Ethereum Pandora rebalance leg.'),
          'flashbots-auth-key': stringSchema('Optional Flashbots auth key or signer reference for the Ethereum Pandora rebalance leg.'),
          'flashbots-target-block-offset': integerSchema('Optional target block offset for Flashbots/private bundle submission.', { minimum: 1 }),
          'max-rebalance-usdc': numberSchema('Maximum rebalance notional in USDC.', { minimum: 0 }),
          'max-hedge-usdc': numberSchema('Maximum hedge notional in USDC.', { minimum: 0 }),
          'max-open-exposure-usdc': numberSchema('Maximum open exposure in USDC.', { minimum: 0 }),
          'max-trades-per-day': integerSchema('Maximum daily trade count.', { minimum: 0 }),
          'cooldown-ms': integerSchema('Idempotency cooldown in milliseconds.', { minimum: 1 }),
          'depth-slippage-bps': integerSchema('Depth slippage in basis points.', { minimum: 1, maximum: 10000 }),
          'min-time-to-close-sec': integerSchema('Minimum time-to-close in seconds.', { minimum: 1 }),
          'strict-close-time-delta': booleanSchema('Promote close-time delta mismatches from diagnostic to blocking.'),
          iterations: integerSchema('Maximum tick iterations before exit.', { minimum: 1 }),
          'kill-switch-file': stringSchema('Kill-switch file path.'),
          'chain-id': commonFlags.chainId,
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          'profile-id': commonFlags.profileId,
          'profile-file': commonFlags.profileFile,
          funder: stringSchema('Polymarket proxy/safe address.'),
          usdc: stringSchema('USDC token address override.'),
          'polymarket-rpc-url': stringSchema('Polygon RPC URL for Polymarket preflight; comma-separated fallbacks are tried in order. This does not override Pandora reserve reads on --rpc-url.'),
          'polymarket-host': stringSchema('Polymarket host override.'),
          'polymarket-gamma-url': stringSchema('Polymarket Gamma API base URL.'),
          'polymarket-gamma-mock-url': stringSchema('Polymarket Gamma mock URL.'),
          'polymarket-mock-url': stringSchema('Polymarket mock CLOB URL.'),
          'trust-deploy': booleanSchema('Trust manifest deploy pair.'),
          'skip-gate': buildMirrorSkipGateSchema(),
          'manifest-file': stringSchema('Mirror manifest path.'),
          'webhook-url': stringSchema('Webhook target URL.'),
          'telegram-bot-token': stringSchema('Telegram bot token.'),
          'telegram-chat-id': stringSchema('Telegram chat id.'),
          'discord-webhook-url': stringSchema('Discord webhook URL.'),
        },
        anyOf: mirrorPandoraPolymarketSelectorAnyOf,
        oneOf: mirrorSyncSelectorAndOptionalModeOneOf,
      }),
      preferred: true,
      longRunningBlocked: true,
      mutating: true,
      safeFlags: ['--paper', '--dry-run'],
        executeFlags: ['--execute-live', '--execute'],
      },
      agentPlatform: {
        returnsOperationId: true,
        returnsRuntimeHandle: false,
      },
    }),
    commandContract({
      name: 'mirror.sync.stop',
    summary: 'Stop detached mirror sync daemon.',
    usage: 'pandora [--output table|json] mirror sync stop --pid-file <path>|--strategy-hash <hash>|--market-address <address>|--all',
    emits: ['mirror.sync.stop', 'mirror.sync.help'],
    dataSchema: '#/definitions/MirrorSyncPayload',
    mcpExposed: true,
      mcp: {
      command: ['mirror', 'sync', 'stop'],
      description: 'Stop mirror sync daemon.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'pid-file': stringSchema('Mirror daemon pid file path.'),
          'strategy-hash': stringSchema('Mirror strategy hash.'),
          'market-address': commonFlags.marketAddress,
          all: booleanSchema('Stop all mirror sync daemons.'),
        },
        anyOf: mirrorSyncStopSelectorAnyOf,
        oneOf: mirrorSyncStopSelectorOneOf,
      }),
        preferred: true,
        mutating: true,
      },
      agentPlatform: {
        externalDependencies: ['filesystem'],
        expectedLatencyMs: 1000,
        riskLevel: 'medium',
        returnsOperationId: true,
        returnsRuntimeHandle: false,
      },
    }),
    commandContract({
      name: 'mirror.sync.status',
    summary: 'Inspect detached mirror sync daemon health/status metadata.',
    usage: 'pandora [--output table|json] mirror sync status --pid-file <path>|--strategy-hash <hash>',
    emits: ['mirror.sync.status', 'mirror.sync.help'],
    dataSchema: '#/definitions/MirrorSyncPayload',
    mcpExposed: true,
      mcp: {
      command: ['mirror', 'sync', 'status'],
      description: 'Inspect mirror sync daemon status and health metadata such as alive, checkedAt, pidFile, logFile, and metadata.pidAlive.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'pid-file': stringSchema('Mirror daemon pid file path.'),
          'strategy-hash': stringSchema('Mirror strategy hash.'),
        },
        anyOf: mirrorSyncStatusSelectorAnyOf,
        oneOf: mirrorSyncStatusSelectorOneOf,
        }),
        preferred: true,
      },
      agentPlatform: {
        externalDependencies: ['filesystem'],
        expectedLatencyMs: 1000,
        returnsOperationId: true,
        returnsRuntimeHandle: false,
      },
    }),
  commandContract({
      name: 'mirror.sync.unlock',
    summary: 'Clear persisted pending-action locks for one mirror strategy after operator review.',
    usage: 'pandora [--output table|json] mirror sync unlock --state-file <path>|--strategy-hash <hash> [--force] [--stale-after-ms <ms>]',
    emits: ['mirror.sync.unlock', 'mirror.sync.unlock.help', 'mirror.sync.help'],
    dataSchema: '#/definitions/MirrorStatusPayload',
    mcpExposed: true,
      agentWorkflow: {
        requiredTools: ['mirror.status'],
        recommendedTools: ['mirror.health'],
        executeRequiresValidation: false,
        notes: [
          'Unlock clears only the persisted pending-action lock file. It does not settle venue state or change live positions.',
          'Invalid and zombie locks can be cleared without --force. Reconciliation-required or still-pending locks require operator review and --force.',
        ],
      },
      mcp: {
      command: ['mirror', 'sync', 'unlock'],
      description: 'Clear a persisted mirror pending-action lock after operator review. Invalid and zombie locks clear without force; reconciliation-required or still-pending locks require force.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'state-file': commonFlags.stateFile,
          'strategy-hash': stringSchema('Mirror strategy hash.'),
          force: booleanSchema('Override a reconciliation-required or still-pending lock after operator review.'),
          'stale-after-ms': integerSchema('Override the stale threshold used to classify pending-action locks.', { minimum: 1 }),
        },
        anyOf: mirrorSyncUnlockSelectorAnyOf,
        oneOf: mirrorSyncUnlockSelectorOneOf,
        }),
        preferred: true,
        mutating: true,
      },
      agentPlatform: {
        externalDependencies: ['filesystem'],
        expectedLatencyMs: 1000,
        riskLevel: 'medium',
        returnsOperationId: true,
        returnsRuntimeHandle: false,
      },
    }),
    commandContract({
      name: 'mirror.health',
      summary: 'Read machine-usable mirror daemon/runtime health for one strategy via state, strategy hash, pid file, or market selector.',
      usage:
        'pandora [--output table|json] mirror health --state-file <path>|--strategy-hash <hash>|--pid-file <path>|--market-address <address> [--polymarket-market-id <id>|--polymarket-slug <slug>] [--stale-after-ms <ms>]',
      emits: ['mirror.health', 'mirror.health.help'],
      dataSchema: GENERIC_DATA_SCHEMA_REF,
      mcpExposed: true,
      mcp: {
        command: ['mirror', 'health'],
        description: 'Read machine-usable mirror daemon/runtime status including runtime.health, daemon metadata, pending-action blockers, and next action.',
        inputSchema: buildInputSchema({
          flagProperties: {
            'state-file': commonFlags.stateFile,
            'strategy-hash': stringSchema('Mirror strategy hash.'),
            'pid-file': stringSchema('Mirror daemon pid file path.'),
            'market-address': commonFlags.marketAddress,
            'pandora-market-address': commonFlags.marketAddress,
            'polymarket-market-id': stringSchema('Optional Polymarket market id to disambiguate selector-first state lookups.'),
            'polymarket-slug': stringSchema('Optional Polymarket slug to disambiguate selector-first state lookups.'),
            'stale-after-ms': integerSchema('Override heartbeat stale threshold in milliseconds.', { minimum: 1 }),
          },
          anyOf: mirrorHealthLookupAnyOf,
        }),
        preferred: true,
      },
      agentPlatform: {
        externalDependencies: ['filesystem'],
        expectedLatencyMs: 1000,
        returnsOperationId: false,
        returnsRuntimeHandle: false,
      },
    }),
    commandContract({
      name: 'mirror.panic',
      summary: 'Engage or clear the global risk panic lock while writing the default ~/.pandora/mirror/STOP stop file and attempting daemon stop for the selected mirror scope.',
      usage:
        'pandora [--output table|json] mirror panic --pid-file <path>|--strategy-hash <hash>|--market-address <address>|--all [--risk-file <path>] [--reason <text>] [--actor <id>] [--clear]',
      emits: ['mirror.panic', 'mirror.panic.help'],
      dataSchema: GENERIC_DATA_SCHEMA_REF,
      mcpExposed: true,
      agentWorkflow: {
        requiredTools: [],
        recommendedTools: ['mirror.health'],
        executeRequiresValidation: false,
        notes: [
          'Engage mode writes the default ~/.pandora/mirror/STOP stop file, which intentionally blocks local mirror daemons until cleared.',
          'Use clear mode after incident review to remove the default stop file and release local mirror automation.',
        ],
      },
      mcp: {
        command: ['mirror', 'panic'],
        description: 'Engage or clear global risk panic while applying the default ~/.pandora/mirror/STOP stop-file and daemon-stop emergency flow for the selected scope.',
        inputSchema: buildInputSchema({
          includeIntent: true,
          flagProperties: {
            'pid-file': stringSchema('Mirror daemon pid file path.'),
            'strategy-hash': stringSchema('Mirror strategy hash.'),
            'market-address': commonFlags.marketAddress,
            'pandora-market-address': commonFlags.marketAddress,
            all: booleanSchema('Target every discovered mirror daemon.'),
            clear: booleanSchema('Clear panic state and remove the default mirror stop file.'),
            reason: stringSchema('Reason for engaging panic mode. Required unless clear=true.'),
            actor: stringSchema('Operator or agent identifier recorded with the panic action.'),
            'risk-file': stringSchema('Override risk state file path.'),
          },
          anyOf: [['clear'], ...mirrorSyncStopSelectorAnyOf],
        }),
        preferred: true,
        mutating: true,
      },
      agentPlatform: {
        externalDependencies: ['filesystem'],
        expectedLatencyMs: 1000,
        returnsOperationId: false,
        returnsRuntimeHandle: false,
      },
    }),
  commandContract({
    name: 'mirror.dashboard',
    summary: 'Read the multi-market mirror operator summary/dashboard across discovered state files, with optional live enrichment and suggested next commands.',
    usage:
      'pandora [--output table|json] mirror dashboard [--with-live|--no-live] [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
    emits: ['mirror.dashboard', 'mirror.dashboard.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
    mcpExposed: true,
      mcp: {
      command: ['mirror', 'dashboard'],
      description: 'Read the multi-market mirror dashboard across discovered state files. Top-level `dashboard` is the canonical alias for this operator summary.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'with-live': booleanSchema('Enrich each dashboard item with live cross-venue diagnostics.'),
          'no-live': booleanSchema('Disable live cross-venue diagnostics and use local state/daemon data only.'),
          'trust-deploy': booleanSchema('Trust manifest deploy pairs when enriching dashboard items.'),
          'manifest-file': stringSchema('Mirror manifest path.'),
          'drift-trigger-bps': integerSchema('Drift trigger in basis points used when projecting live sync posture.', { minimum: 1 }),
          'hedge-trigger-usdc': numberSchema('Hedge trigger size in USDC used when projecting live sync posture.', { minimum: 0 }),
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
          'polymarket-host': stringSchema('Polymarket host override for live diagnostics.'),
          'polymarket-gamma-url': stringSchema('Polymarket Gamma API base URL for live diagnostics.'),
          'polymarket-gamma-mock-url': stringSchema('Polymarket Gamma mock URL for live diagnostics.'),
          'polymarket-mock-url': stringSchema('Polymarket mock CLOB URL for live diagnostics.'),
        },
      }),
        preferred: true,
      },
      agentPlatform: {
        externalDependencies: ['filesystem', 'polymarket-api'],
        expectedLatencyMs: 1500,
      },
    }),
  commandContract({
    name: 'mirror.status',
    summary: 'Read the single-mirror operator status/dashboard surface with selector-first lookup, graceful fallback behavior, runtime health, and optional live diagnostics.',
    usage:
      'pandora [--output table|json] mirror status --state-file <path>|--strategy-hash <hash>|--pandora-market-address <address>|--market-address <address>|--polymarket-market-id <id>|--polymarket-slug <slug> [--with-live] [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
    emits: ['mirror.status', 'mirror.status.help'],
    dataSchema: '#/definitions/MirrorStatusPayload',
    helpDataSchema: MIRROR_STATUS_HELP_SCHEMA_REF,
    mcpExposed: true,
      mcp: {
      command: ['mirror', 'status'],
      description: 'Read single-mirror status/dashboard payload. Selector hints can resolve persisted local mirror state when a matching file exists. Use `mirror dashboard` for multi-market operator summaries and `mirror drift` or `mirror hedge-check` for narrower live actionability views.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'state-file': commonFlags.stateFile,
          'strategy-hash': stringSchema('Mirror strategy hash.'),
          'with-live': booleanSchema('Enrich with live Polymarket diagnostics; partial visibility degrades into diagnostics instead of hard failure.'),
          'pandora-market-address': commonFlags.marketAddress,
          'market-address': commonFlags.marketAddress,
          'polymarket-market-id': stringSchema('Polymarket market id.'),
          'polymarket-slug': stringSchema('Polymarket slug.'),
          'trust-deploy': booleanSchema('Trust manifest deploy pair.'),
          'manifest-file': stringSchema('Mirror manifest path.'),
          'drift-trigger-bps': integerSchema('Drift trigger in basis points used when projecting live sync posture.', { minimum: 1 }),
          'hedge-trigger-usdc': numberSchema('Hedge trigger size in USDC used when projecting live sync posture.', { minimum: 0 }),
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
          'polymarket-host': stringSchema('Polymarket host override for live diagnostics.'),
          'polymarket-gamma-url': stringSchema('Polymarket Gamma API base URL for live diagnostics.'),
          'polymarket-gamma-mock-url': stringSchema('Polymarket Gamma mock URL for live diagnostics.'),
          'polymarket-mock-url': stringSchema('Polymarket mock CLOB URL for live diagnostics.'),
        },
        anyOf: mirrorResolvedLookupAnyOf,
        oneOf: mirrorResolvedLookupOneOf,
          }),
        preferred: true,
      },
      agentPlatform: {
        externalDependencies: ['filesystem', 'polymarket-api'],
        expectedLatencyMs: 1500,
      },
    }),
    commandContract({
      name: 'mirror.pnl',
      summary: 'Read the canonical mirror P&L surface for a pair. It remains the dedicated cross-venue scenario P&L surface; `--reconciled` adds normalized realized/unrealized accounting, provenance, and export-ready ledger rows beside the legacy approximate fields.',
      usage:
        'pandora [--output table|json] mirror pnl --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) [--reconciled] [--include-legacy-approx] [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
      emits: ['mirror.pnl', 'mirror.pnl.help'],
      dataSchema: '#/definitions/MirrorPnlPayload',
      mcpExposed: true,
      mcp: {
        command: ['mirror', 'pnl'],
        description: 'Read the mirror P&L/accounting summary surface for a pair. `--reconciled` adds normalized realized/unrealized components, provenance, and export-ready ledger rows.',
        inputSchema: buildInputSchema({
          flagProperties: {
            'state-file': commonFlags.stateFile,
            'strategy-hash': stringSchema('Mirror strategy hash.'),
            'pandora-market-address': commonFlags.marketAddress,
            'market-address': commonFlags.marketAddress,
            'polymarket-market-id': stringSchema('Polymarket market id.'),
            'polymarket-slug': stringSchema('Polymarket slug.'),
            reconciled: booleanSchema('Attach the normalized reconciled accounting payload beside the approximate scenario surface.'),
            'include-legacy-approx': booleanSchema('Keep approximate scenario fields visible while requesting reconciled accounting.'),
            'trust-deploy': booleanSchema('Trust manifest deploy pair.'),
            'manifest-file': stringSchema('Mirror manifest path.'),
            'drift-trigger-bps': integerSchema('Drift trigger in basis points used when projecting live sync posture.', { minimum: 1 }),
            'hedge-trigger-usdc': numberSchema('Hedge trigger size in USDC used when projecting live sync posture.', { minimum: 0 }),
            'indexer-url': commonFlags.indexerUrl,
            'timeout-ms': commonFlags.timeoutMs,
            'polymarket-host': stringSchema('Polymarket host override for live diagnostics.'),
            'polymarket-gamma-url': stringSchema('Polymarket Gamma API base URL for live diagnostics.'),
            'polymarket-gamma-mock-url': stringSchema('Polymarket Gamma mock URL for live diagnostics.'),
            'polymarket-mock-url': stringSchema('Polymarket mock CLOB URL for live diagnostics.'),
          },
          anyOf: mirrorResolvedLookupAnyOf,
          oneOf: mirrorResolvedLookupOneOf,
        }),
        preferred: true,
      },
      agentPlatform: {
        externalDependencies: ['filesystem', 'polymarket-api'],
        expectedLatencyMs: 1500,
      },
    }),
    commandContract({
      name: 'mirror.audit',
      summary: 'Read the canonical mirror audit ledger surface. `--reconciled` adds a normalized cross-venue ledger with provenance and export-ready rows beside the append-only operational audit log.',
      usage:
        'pandora [--output table|json] mirror audit --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) [--reconciled] [--with-live] [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
      emits: ['mirror.audit', 'mirror.audit.help'],
      dataSchema: '#/definitions/MirrorAuditPayload',
      mcpExposed: true,
      mcp: {
        command: ['mirror', 'audit'],
        description: 'Read the mirror audit/ledger surface. `--reconciled` adds normalized venue, funding, gas, and reserve-trace provenance beside the operational audit log.',
        inputSchema: buildInputSchema({
          flagProperties: {
            'state-file': commonFlags.stateFile,
            'strategy-hash': stringSchema('Mirror strategy hash.'),
            reconciled: booleanSchema('Attach the normalized reconciled ledger beside the append-only operational audit payload.'),
            'with-live': booleanSchema('Attach current live cross-venue context to the persisted audit ledger.'),
            'pandora-market-address': commonFlags.marketAddress,
            'market-address': commonFlags.marketAddress,
            'polymarket-market-id': stringSchema('Polymarket market id.'),
            'polymarket-slug': stringSchema('Polymarket slug.'),
            'trust-deploy': booleanSchema('Trust manifest deploy pair.'),
            'manifest-file': stringSchema('Mirror manifest path.'),
            'drift-trigger-bps': integerSchema('Drift trigger in basis points used when projecting live sync posture.', { minimum: 1 }),
            'hedge-trigger-usdc': numberSchema('Hedge trigger size in USDC used when projecting live sync posture.', { minimum: 0 }),
            'indexer-url': commonFlags.indexerUrl,
            'timeout-ms': commonFlags.timeoutMs,
            'polymarket-host': stringSchema('Polymarket host override for live diagnostics.'),
            'polymarket-gamma-url': stringSchema('Polymarket Gamma API base URL for live diagnostics.'),
            'polymarket-gamma-mock-url': stringSchema('Polymarket Gamma mock URL for live diagnostics.'),
            'polymarket-mock-url': stringSchema('Polymarket mock CLOB URL for live diagnostics.'),
          },
          anyOf: mirrorResolvedLookupAnyOf,
          oneOf: mirrorResolvedLookupOneOf,
        }),
        preferred: true,
      },
      agentPlatform: {
        externalDependencies: ['filesystem', 'polymarket-api'],
        expectedLatencyMs: 1200,
      },
    }),
    commandContract({
      name: 'mirror.replay',
      summary: 'Replay persisted mirror execution history against modeled rebalance and hedge outcomes using the append-only audit log, or lastExecution fallback when no ledger exists.',
      usage:
        'pandora [--output table|json] mirror replay --state-file <path>|--strategy-hash <hash>|[--pandora-market-address <address>|--market-address <address>] [--polymarket-market-id <id>|--polymarket-slug <slug>] [--limit <n>]',
      emits: ['mirror.replay', 'mirror.replay.help'],
      dataSchema: GENERIC_DATA_SCHEMA_REF,
      mcpExposed: true,
      mcp: {
        command: ['mirror', 'replay'],
        description: 'Replay persisted mirror execution history against modeled rebalance and hedge outcomes. Uses the append-only audit log when available, falls back to lastExecution state when needed, and can start from a single selector hint when a persisted local mirror state matches.',
        inputSchema: buildInputSchema({
          flagProperties: {
            'state-file': commonFlags.stateFile,
            'strategy-hash': stringSchema('Mirror strategy hash.'),
            'pandora-market-address': commonFlags.marketAddress,
            'market-address': commonFlags.marketAddress,
            'polymarket-market-id': stringSchema('Polymarket market id.'),
            'polymarket-slug': stringSchema('Polymarket slug.'),
            limit: commonFlags.limit,
          },
          anyOf: mirrorResolvedLookupAnyOf,
          oneOf: mirrorResolvedLookupOneOf,
        }),
        preferred: true,
      },
      agentPlatform: {
        externalDependencies: ['filesystem'],
        expectedLatencyMs: 1200,
      },
    }),
    commandContract({
      name: 'mirror.trace',
      summary: 'Read block-aware historical Pandora reserve snapshots for one market via explicit block lists or sampled block ranges.',
      usage:
        'pandora [--output table|json] mirror trace --pandora-market-address <address>|--market-address <address> --rpc-url <url> [--blocks <csv>|--from-block <n> --to-block <n> [--step <n>]] [--limit <n>]',
      emits: ['mirror.trace', 'mirror.trace.help'],
      dataSchema: '#/definitions/MirrorTracePayload',
      mcpExposed: true,
      mcp: {
        command: ['mirror', 'trace'],
        description: 'Read historical Pandora reserve snapshots at explicit blocks or sampled block ranges. Deep history requires an archive-capable RPC endpoint.',
        inputSchema: buildInputSchema({
          flagProperties: {
            'pandora-market-address': commonFlags.marketAddress,
            'market-address': commonFlags.marketAddress,
            'rpc-url': commonFlags.rpcUrl,
            blocks: stringSchema('Comma-delimited explicit block numbers to sample.'),
            'from-block': integerSchema('Inclusive start block number.', { minimum: 0 }),
            'to-block': integerSchema('Inclusive end block number.', { minimum: 0 }),
            step: integerSchema('Sampling step for block ranges.', { minimum: 1 }),
            limit: commonFlags.limit,
          },
          requiredFlags: ['rpc-url'],
          anyOf: [['pandora-market-address'], ['market-address']],
          oneOf: mirrorTraceSelectorOneOf,
        }),
        preferred: true,
      },
      agentPlatform: {
        expectedLatencyMs: 1500,
      },
    }),
  commandContract({
    name: 'mirror.logs',
    summary: 'Read mirror daemon logs via state, strategy hash, or Pandora market selector, including structured JSONL parsing, follow mode, and missing-file diagnostics.',
    usage:
      'pandora [--output table|json] mirror logs --state-file <path>|--strategy-hash <hash>|--pandora-market-address <address>|--market-address <address> [--polymarket-market-id <id>|--polymarket-slug <slug>] [--lines <n>] [--follow] [--poll-interval-ms <ms>] [--follow-timeout-ms <ms>]',
    emits: ['mirror.logs', 'mirror.logs.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
    mcpExposed: true,
    mcp: {
      command: ['mirror', 'logs'],
      description: 'Read mirror daemon logs resolved from state, strategy hash, or Pandora market selector. The surface parses structured daemon JSONL when present, preserves raw text compatibility for legacy logs, supports follow mode, and degrades missing or unreadable logs into diagnostics instead of a transport failure.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'state-file': commonFlags.stateFile,
          'strategy-hash': stringSchema('Mirror strategy hash.'),
          'pandora-market-address': commonFlags.marketAddress,
          'market-address': commonFlags.marketAddress,
          'polymarket-market-id': stringSchema('Optional Polymarket market id used to disambiguate selector-first log lookup.'),
          'polymarket-slug': stringSchema('Optional Polymarket slug used to disambiguate selector-first log lookup.'),
          lines: commonFlags.limit,
          follow: booleanSchema('Keep polling for appended daemon log lines after returning the initial tail.'),
          'poll-interval-ms': integerSchema('Polling interval used by mirror logs --follow.', { minimum: 1 }),
          'follow-timeout-ms': integerSchema('Optional timeout for mirror logs --follow.', { minimum: 1 }),
        },
        anyOf: mirrorLogsLookupAnyOf,
        oneOf: mirrorLogsLookupOneOf,
      }),
        preferred: true,
      },
      agentPlatform: {
        externalDependencies: ['filesystem'],
        expectedLatencyMs: 1000,
      },
    }),
  commandContract({
    name: 'mirror.close',
    summary: 'Build or execute close plan for a mirror pair, including structured Polymarket settlement discovery and resume guidance.',
    usage:
      'pandora [--output table|json] mirror close --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug>|--all --dry-run|--execute [--wallet <address>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--indexer-url <url>] [--timeout-ms <ms>]',
    emits: ['mirror.close', 'mirror.close.help'],
    dataSchema: '#/definitions/MirrorClosePayload',
    mcpExposed: true,
    mcp: {
      command: ['mirror', 'close'],
      description: 'Build or execute close plan for a mirror pair, including Pandora LP/claim steps plus structured Polymarket settlement discovery and resume guidance.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'pandora-market-address': commonFlags.marketAddress,
          'market-address': commonFlags.marketAddress,
          'polymarket-market-id': stringSchema('Polymarket market id.'),
          'polymarket-slug': stringSchema('Polymarket slug.'),
          all: booleanSchema('Close all discovered mirror positions.'),
          'dry-run': booleanSchema('Run dry-run mode.'),
          execute: booleanSchema('Execute live closeout steps.'),
          wallet: commonFlags.wallet,
          'chain-id': commonFlags.chainId,
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
        },
        anyOf: mirrorCloseSelectorAndModeAnyOf,
        oneOf: mirrorCloseSelectorAndModeOneOf,
      }),
      preferred: true,
      mutating: true,
      safeFlags: ['--dry-run'],
      executeFlags: ['--execute'],
    },
  }),
  commandContract({
    name: 'dashboard',
    summary: 'Read the active-mirror operator dashboard across discovered mirror contexts, with optional refresh mode plus claimable and liquid-capital rollups.',
    usage:
      'pandora [--output table|json] dashboard [--with-live|--no-live] [--watch] [--refresh-ms <ms>] [--iterations <n>] [--wallet <address>] [--chain-id <id>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--usdc <address>] [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
    emits: ['dashboard', 'dashboard.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
    mcpExposed: true,
    mcp: {
      command: ['dashboard'],
      description: 'Read the active-mirror operator dashboard across discovered mirror contexts. This top-level operator cockpit can refresh on an interval, and it can compose claimable exposure plus liquid-capital rollups when wallet credentials are available.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'with-live': booleanSchema('Force live enrichment on for the dashboard items.'),
          'no-live': booleanSchema('Disable live enrichment and return state/daemon-only dashboard data.'),
          watch: booleanSchema('Refresh the dashboard on an interval. JSON mode requires a bounded `--iterations` count.'),
          'refresh-ms': integerSchema('Refresh interval in milliseconds.', { minimum: 1 }),
          iterations: integerSchema('Number of snapshots to collect in watch mode.', { minimum: 1 }),
          wallet: commonFlags.wallet,
          'chain-id': commonFlags.chainId,
          'rpc-url': commonFlags.rpcUrl,
          'polymarket-rpc-url': stringSchema('Polymarket RPC URL override used for liquid-capital balance reads.'),
          'private-key': commonFlags.privateKey,
          'profile-id': commonFlags.profileId,
          'profile-file': commonFlags.profileFile,
          funder: stringSchema('Polymarket proxy wallet override used for liquid-capital balance reads.'),
          usdc: stringSchema('USDC token address override.'),
          'trust-deploy': booleanSchema('Trust manifest deploy pairs during live enrichment.'),
          'manifest-file': stringSchema('Mirror manifest path.'),
          'drift-trigger-bps': integerSchema('Drift trigger in basis points used when projecting live sync posture.', { minimum: 1 }),
          'hedge-trigger-usdc': numberSchema('Hedge trigger size in USDC used when projecting live sync posture.', { minimum: 0 }),
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
          'polymarket-host': stringSchema('Polymarket host override for live diagnostics.'),
          'polymarket-gamma-url': stringSchema('Polymarket Gamma API base URL for live diagnostics.'),
          'polymarket-gamma-mock-url': stringSchema('Polymarket Gamma mock URL for live diagnostics.'),
          'polymarket-mock-url': stringSchema('Polymarket mock CLOB URL for live diagnostics.'),
        },
      }),
      preferred: true,
    },
    agentPlatform: {
      externalDependencies: ['filesystem', 'polymarket-api', 'wallet-secrets'],
      expectedLatencyMs: 2500,
    },
  }),
  commandContract({
    name: 'bridge',
    summary: 'Bridge planning and LayerZero execution help and routing entrypoint.',
    usage:
      'pandora [--output table|json] bridge plan|execute --target pandora|polymarket --amount-usdc <n> [--wallet <address>] [--to-wallet <address>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--usdc <address>] [--timeout-ms <ms>]',
    emits: ['bridge.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
  }),
  commandContract({
    name: 'bridge.plan',
    summary: 'Read a planner-only ETH <-> Polygon USDC funding route for Pandora or Polymarket shortfalls.',
    usage:
      'pandora [--output table|json] bridge plan --target pandora|polymarket --amount-usdc <n> [--wallet <address>] [--to-wallet <address>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--usdc <address>] [--timeout-ms <ms>]',
    emits: ['bridge.plan', 'bridge.plan.help', 'bridge.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
    mcpExposed: true,
    mcp: {
      command: ['bridge', 'plan'],
      description: 'Read-only bridge planner for Ethereum <-> Polygon operator funding gaps. It returns explicit source/destination chain and token assumptions, balance shortfalls, gas expectations, and manual next steps; it does not execute the bridge.',
      inputSchema: buildInputSchema({
        flagProperties: {
          target: enumSchema(['pandora', 'polymarket'], 'Funding destination to plan for.'),
          'amount-usdc': numberSchema('Amount of collateral that must land on the destination side.', { minimum: 0 }),
          wallet: commonFlags.wallet,
          'to-wallet': stringSchema('Destination wallet override.'),
          'rpc-url': commonFlags.rpcUrl,
          'polymarket-rpc-url': stringSchema('Polygon RPC URL override used for destination-side balance reads.'),
          'private-key': commonFlags.privateKey,
          'profile-id': commonFlags.profileId,
          'profile-file': commonFlags.profileFile,
          funder: stringSchema('Polymarket proxy wallet override.'),
          usdc: stringSchema('USDC token address override.'),
          'timeout-ms': commonFlags.timeoutMs,
        },
        requiredFlags: ['target', 'amount-usdc'],
      }),
      preferred: true,
    },
    agentPlatform: {
      externalDependencies: ['wallet-secrets', 'rpc'],
      expectedLatencyMs: 1500,
    },
  }),
  commandContract({
    name: 'bridge.execute',
    summary: 'Dry-run or execute a LayerZero bridge submission for Pandora or Polymarket collateral funding.',
    usage:
      'pandora [--output table|json] bridge execute --target pandora|polymarket --amount-usdc <n> --dry-run|--execute [--provider layerzero] [--wallet <address>] [--to-wallet <address>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--usdc <address>] [--timeout-ms <ms>]',
    emits: ['bridge.execute', 'bridge.execute.help', 'bridge.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
    mcpExposed: true,
    mcp: {
      command: ['bridge', 'execute'],
      description: 'Dry-run or execute a LayerZero bridge submission after planner-style preflight. --dry-run returns route assumptions, quote/preflight output, and follow-up steps; --execute submits only the source-chain transaction.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          target: enumSchema(['pandora', 'polymarket'], 'Funding destination to bridge for.'),
          'amount-usdc': numberSchema('Amount of collateral that must land on the destination side.', { minimum: 0 }),
          provider: enumSchema(['layerzero'], 'Bridge provider. Only layerzero is currently supported.'),
          'dry-run': booleanSchema('Return LayerZero preflight without broadcasting a transaction.'),
          execute: booleanSchema('Submit the LayerZero source-chain transaction after preflight passes.'),
          wallet: commonFlags.wallet,
          'to-wallet': stringSchema('Destination wallet override.'),
          'rpc-url': commonFlags.rpcUrl,
          'polymarket-rpc-url': stringSchema('Polygon RPC URL override used for destination-side balance reads.'),
          'private-key': commonFlags.privateKey,
          'profile-id': commonFlags.profileId,
          'profile-file': commonFlags.profileFile,
          funder: stringSchema('Polymarket proxy wallet override.'),
          usdc: stringSchema('USDC token address override.'),
          'timeout-ms': commonFlags.timeoutMs,
        },
        requiredFlags: ['target', 'amount-usdc'],
        oneOf: [
          { required: ['dry-run'] },
          { required: ['execute'] },
        ],
      }),
      preferred: true,
      mutating: true,
      safeFlags: ['--dry-run'],
      executeFlags: ['--execute'],
    },
    agentPlatform: {
      externalDependencies: ['wallet-secrets', 'rpc'],
      expectedLatencyMs: 2000,
      canRunConcurrent: false,
      idempotency: 'conditional',
      riskLevel: 'medium',
      policyScopes: ['bridge:write', 'network:rpc'],
    },
  }),
  commandContract({
    name: 'fees',
    summary: 'Read indexed oracle-fee history and recipient summaries. Use `fees.withdraw` for market-level protocol-fee withdrawals.',
    usage:
      'pandora [--output table|json] fees [--wallet <address>] [--chain-id <id>] [--tx-hash <hash>] [--event-name <name>] [--limit <n>] [--before <cursor>] [--after <cursor>] [--order-direction asc|desc] [--indexer-url <url>] [--timeout-ms <ms>]',
    emits: ['fees', 'fees.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
    mcpExposed: true,
    mcp: {
      command: ['fees'],
      description: 'Read indexed oracle-fee events and recipient history. Use `fees withdraw` when you need the live market-level protocol-fee withdrawal surface.',
      inputSchema: buildInputSchema({
        flagProperties: {
          wallet: commonFlags.wallet,
          'chain-id': commonFlags.chainId,
          'tx-hash': stringSchema('Transaction hash filter.'),
          'event-name': stringSchema('Oracle-fee event name filter.'),
          limit: commonFlags.limit,
          before: stringSchema('Cursor before.'),
          after: stringSchema('Cursor after.'),
          'order-direction': enumSchema(['asc', 'desc'], 'Sort direction.'),
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
        },
      }),
      preferred: true,
    },
    agentPlatform: {
      externalDependencies: ['indexer'],
      expectedLatencyMs: 800,
    },
  }),
  commandContract({
    name: 'fees.withdraw',
    summary: 'Dry-run or execute a market-level `withdrawProtocolFees()` call on a Pandora AMM market contract.',
    usage:
      'pandora [--output table|json] fees withdraw --market-address <address> --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--dotenv-path <path>] [--skip-dotenv] [--timeout-ms <ms>]',
    emits: ['fees.withdraw', 'fees.withdraw.help', 'fees.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
    mcpExposed: true,
    mcp: {
      command: ['fees', 'withdraw'],
      description: 'Dry-run or execute a Pandora market contract `withdrawProtocolFees()` call. This withdraws collected collateral fees and splits them between the platform treasury and market creator.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'dotenv-path': stringSchema('Env file path.'),
          'skip-dotenv': booleanSchema('Skip env loading.'),
          'market-address': commonFlags.marketAddress,
          'dry-run': booleanSchema('Run dry-run mode.'),
          execute: booleanSchema('Execute the withdrawal transaction.'),
          fork: booleanSchema('Run in fork mode.'),
          'fork-rpc-url': stringSchema('Fork RPC URL.'),
          'fork-chain-id': integerSchema('Fork chain id.', { minimum: 1 }),
          'chain-id': commonFlags.chainId,
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          'profile-id': commonFlags.profileId,
          'profile-file': commonFlags.profileFile,
          'timeout-ms': commonFlags.timeoutMs,
        },
        requiredFlags: ['market-address'],
      }),
      preferred: true,
      mutating: true,
      safeFlags: ['--dry-run'],
      executeFlags: ['--execute'],
    },
    agentPlatform: {
      externalDependencies: ['rpc', 'wallet-secrets'],
      expectedLatencyMs: 1200,
      canRunConcurrent: false,
      idempotency: 'conditional',
      riskLevel: 'medium',
      policyScopes: ['fees:write', 'network:rpc'],
    },
  }),
  commandContract({
    name: 'debug',
    summary: 'Debug command family help and routing entrypoint.',
    usage: 'pandora [--output table|json] debug market|tx ...',
    emits: ['debug.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
  }),
  commandContract({
    name: 'debug.market',
    summary: 'Read a single-market forensic snapshot with poll, position, trade, liquidity, and claim context.',
    usage:
      'pandora [--output table|json] debug market --market-address <address>|--poll-address <address> [--chain-id <id>] [--limit <n>] [--indexer-url <url>] [--timeout-ms <ms>]',
    emits: ['debug.market', 'debug.market.help', 'debug.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
    mcpExposed: true,
    mcp: {
      command: ['debug', 'market'],
      description: 'Read a single-market forensic snapshot with poll, position, trade, liquidity-event, and claim-event context for debugging and operator triage.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'market-address': commonFlags.marketAddress,
          'poll-address': commonFlags.pollAddress,
          'chain-id': commonFlags.chainId,
          limit: commonFlags.limit,
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
        },
        anyOf: [['market-address'], ['poll-address']],
        oneOf: buildExclusivePresenceBranches([['market-address'], ['poll-address']]),
      }),
      preferred: true,
    },
    agentPlatform: {
      externalDependencies: ['indexer'],
      expectedLatencyMs: 1200,
    },
  }),
  commandContract({
    name: 'debug.tx',
    summary: 'Correlate indexed trades and events for a single transaction hash.',
    usage:
      'pandora [--output table|json] debug tx --tx-hash <hash> [--chain-id <id>] [--limit <n>] [--indexer-url <url>] [--timeout-ms <ms>]',
    emits: ['debug.tx', 'debug.tx.help', 'debug.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
    mcpExposed: true,
    mcp: {
      command: ['debug', 'tx'],
      description: 'Correlate indexed trades, liquidity events, oracle-fee events, and claim events for a single transaction hash.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'tx-hash': stringSchema('Transaction hash.'),
          'chain-id': commonFlags.chainId,
          limit: commonFlags.limit,
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
        },
        requiredFlags: ['tx-hash'],
      }),
      preferred: true,
    },
    agentPlatform: {
      externalDependencies: ['indexer'],
      expectedLatencyMs: 1200,
    },
  }),
  commandContract({
    name: 'fund-check',
    summary: 'Estimate immediate hedge funding needs from live mirror gaps, then compare them against Polymarket balances, approvals, and gas reserve. This is the canonical high-level wallet shortfall planner.',
    usage:
      'pandora [--output table|json] fund-check --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) [--target-pct <0-100>] [--trust-deploy] [--manifest-file <path>] [--indexer-url <url>] [--timeout-ms <ms>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
    emits: ['fund-check', 'fund-check.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
    mcpExposed: true,
    mcp: {
      command: ['fund-check'],
      description: 'Estimate live mirror hedge funding shortfalls and compare them against Polymarket wallet balances, approvals, risk guardrails, and native gas reserve. Use this canonical planner before dropping to `polymarket check` or `polymarket balance`.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'trust-deploy': booleanSchema('Trust manifest deploy pairs during live enrichment.'),
          'manifest-file': stringSchema('Mirror manifest path.'),
          'drift-trigger-bps': integerSchema('Drift trigger in basis points used when projecting live sync posture.', { minimum: 1 }),
          'hedge-trigger-usdc': numberSchema('Hedge trigger size in USDC used when projecting live sync posture.', { minimum: 0 }),
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
          'target-pct': numberSchema('Target Pandora YES probability percent used for exact rebalance sizing.', { minimum: 0, maximum: 100 }),
          'rpc-url': commonFlags.rpcUrl,
          'polymarket-rpc-url': stringSchema('Polygon RPC URL used for Polymarket balance and readiness checks.'),
          'private-key': commonFlags.privateKey,
          'profile-id': commonFlags.profileId,
          'profile-file': commonFlags.profileFile,
          'state-file': commonFlags.stateFile,
          'strategy-hash': stringSchema('Mirror strategy hash.'),
          'pandora-market-address': commonFlags.marketAddress,
          'market-address': commonFlags.marketAddress,
          'polymarket-market-id': stringSchema('Polymarket market id.'),
          'polymarket-slug': stringSchema('Polymarket slug.'),
          funder: stringSchema('Polymarket proxy wallet.'),
          'polymarket-host': stringSchema('Polymarket host override.'),
          'polymarket-gamma-url': stringSchema('Polymarket Gamma API base URL.'),
          'polymarket-gamma-mock-url': stringSchema('Polymarket Gamma mock URL.'),
          'polymarket-mock-url': stringSchema('Polymarket mock CLOB URL.'),
        },
      }),
      preferred: true,
    },
    agentPlatform: {
      externalDependencies: ['filesystem', 'polymarket-api'],
      expectedLatencyMs: 1500,
    },
  }),
  commandContract({
    name: 'polymarket',
    summary: 'Polymarket command family help and routing entrypoint.',
    usage: 'pandora [--output table|json] polymarket check|approve|preflight|balance|positions|deposit|withdraw|trade ...',
    emits: ['polymarket.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
  }),
  commandContract({
    name: 'polymarket.check',
    summary: 'Run Polymarket funding, auth, and allowance checks. This is the lower-level readiness primitive that complements the top-level `fund-check` planner.',
    usage:
      'pandora [--output table|json] polymarket check [--polymarket-host <url>] [--polymarket-mock-url <url>] [--timeout-ms <ms>] [--private-key <hex>] [--funder <address>] [--rpc-url <url>]',
    emits: ['polymarket.check', 'polymarket.check.help', 'polymarket.help'],
    dataSchema: '#/definitions/PolymarketPayload',
    mcpExposed: true,
    mcp: {
      command: ['polymarket', 'check'],
      description: 'Run Polymarket funding, auth, and allowance checks. Use this when `fund-check` recommends drilling into ownership, allowance, or RPC readiness; pair it with `polymarket balance` for raw wallet balances.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'polymarket-host': stringSchema('Polymarket host override.'),
          'polymarket-mock-url': stringSchema('Polymarket mock URL.'),
          'timeout-ms': commonFlags.timeoutMs,
          'private-key': commonFlags.privateKey,
          funder: stringSchema('Polymarket proxy wallet.'),
          'rpc-url': commonFlags.rpcUrl,
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'polymarket.approve',
    summary: 'Dry-run or execute Polymarket approvals.',
    usage:
      'pandora [--output table|json] polymarket approve --dry-run|--execute [--polymarket-host <url>] [--polymarket-mock-url <url>] [--timeout-ms <ms>] [--private-key <hex>] [--funder <address>] [--rpc-url <url>]',
    emits: ['polymarket.approve', 'polymarket.approve.help', 'polymarket.help'],
    dataSchema: '#/definitions/PolymarketPayload',
    mcpExposed: true,
    mcp: {
      command: ['polymarket', 'approve'],
      description: 'Dry-run or execute Polymarket approvals.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'dry-run': booleanSchema('Run dry-run mode.'),
          execute: booleanSchema('Execute live approval transactions.'),
          'polymarket-host': stringSchema('Polymarket host override.'),
          'polymarket-mock-url': stringSchema('Polymarket mock URL.'),
          'timeout-ms': commonFlags.timeoutMs,
          'private-key': commonFlags.privateKey,
          funder: stringSchema('Polymarket proxy wallet.'),
          'rpc-url': commonFlags.rpcUrl,
        },
      }),
      preferred: true,
      mutating: true,
      safeFlags: ['--dry-run'],
      executeFlags: ['--execute'],
    },
  }),
  commandContract({
      name: 'polymarket.preflight',
    summary: 'Run strict Polymarket readiness and optional trade-context preflight checks.',
    usage:
      'pandora [--output table|json] polymarket preflight [--condition-id <id>|--slug <slug>|--token-id <id>] [--token yes|no] [--amount-usdc <n>] [--side buy|sell] [--polymarket-host <url>] [--polymarket-mock-url <url>] [--timeout-ms <ms>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]',
    emits: ['polymarket.preflight', 'polymarket.preflight.help', 'polymarket.help'],
    dataSchema: '#/definitions/PolymarketPayload',
    mcpExposed: true,
      mcp: {
      command: ['polymarket', 'preflight'],
      description: 'Run strict Polymarket readiness preflight, optionally with trade context. Add condition/slug, token or token-id, side, and amount-usdc when you need a concrete trade go/no-go gate rather than wallet-only readiness.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'condition-id': stringSchema('Polymarket condition/market id for trade-context preflight.'),
          slug: stringSchema('Polymarket slug for trade-context preflight.'),
          token: enumSchema(['yes', 'no'], 'Outcome token for trade-context preflight when token-id is not supplied.'),
          'token-id': stringSchema('Explicit token id for trade-context preflight.'),
          side: enumSchema(['buy', 'sell'], 'Trade side for trade-context preflight.'),
          'amount-usdc': numberSchema('Trade notional in USDC for trade-context preflight.', { minimum: 0 }),
          'polymarket-host': stringSchema('Polymarket host override for market-resolution checks.'),
          'polymarket-mock-url': stringSchema('Polymarket mock host override for local/forked trade-context checks.'),
          'timeout-ms': commonFlags.timeoutMs,
          fork: booleanSchema('Run in fork mode.'),
          'fork-rpc-url': stringSchema('Fork RPC URL.'),
          'fork-chain-id': integerSchema('Fork chain id.'),
          'private-key': commonFlags.privateKey,
          funder: stringSchema('Polymarket proxy wallet.'),
          'rpc-url': commonFlags.rpcUrl,
        },
        }),
        preferred: true,
      },
      agentPlatform: {
        riskLevel: 'medium',
      },
    }),
  commandContract({
    name: 'polymarket.balance',
    summary: 'Read Polymarket signer/proxy funding balances. This is the raw balance companion to `fund-check` and `polymarket check`.',
    usage:
      'pandora [--output table|json] polymarket balance [--wallet <address>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]',
    emits: ['polymarket.balance', 'polymarket.balance.help', 'polymarket.help'],
    dataSchema: '#/definitions/PolymarketPayload',
    mcpExposed: true,
    mcp: {
      command: ['polymarket', 'balance'],
      description: 'Read signer/proxy funding balances for Polymarket. Use this when `fund-check` or `polymarket check` needs the raw signer, funder, or owner balances after readiness checks.',
      inputSchema: buildInputSchema({
        flagProperties: {
          wallet: stringSchema('Wallet address to inspect.'),
          fork: booleanSchema('Run in fork mode.'),
          'fork-rpc-url': stringSchema('Fork RPC URL.'),
          'fork-chain-id': integerSchema('Fork chain id.', { minimum: 1 }),
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          funder: stringSchema('Polymarket proxy wallet.'),
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'polymarket.positions',
    summary: 'Read Polymarket YES/NO position inventory and open-order exposure. This is distinct from `polymarket balance`, which remains funding and collateral only.',
    usage:
      'pandora [--output table|json] polymarket positions [--wallet <address>|--funder <address>] [--condition-id <id>|--market-id <id>|--slug <slug>|--token-id <id>] [--source auto|api|on-chain] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-data-api-url <url>] [--polymarket-mock-url <url>] [--timeout-ms <ms>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>]',
    emits: ['polymarket.positions', 'polymarket.positions.help', 'polymarket.help'],
    dataSchema: '#/definitions/PolymarketPositionsPayload',
    mcpExposed: true,
    mcp: {
      command: ['polymarket', 'positions'],
      description: 'Read Polymarket YES/NO inventory, conditional token balances, and open-order exposure. Use this for position inventory; use `polymarket balance` for funding and collateral balances.',
      inputSchema: buildInputSchema({
        flagProperties: {
          wallet: stringSchema('Wallet address to inspect.'),
          'condition-id': stringSchema('Polymarket condition id / market id selector.'),
          slug: stringSchema('Polymarket slug selector.'),
          'token-id': stringSchema('Conditional token id selector.'),
          source: enumSchema(['auto', 'api', 'on-chain'], 'Inventory source preference.'),
          'polymarket-host': stringSchema('Polymarket host override.'),
          'polymarket-mock-url': stringSchema('Polymarket mock URL.'),
          'timeout-ms': commonFlags.timeoutMs,
          fork: booleanSchema('Run in fork mode.'),
          'fork-rpc-url': stringSchema('Fork RPC URL.'),
          'fork-chain-id': integerSchema('Fork chain id.', { minimum: 1 }),
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          funder: stringSchema('Polymarket proxy wallet.'),
        },
        oneOf: polymarketPositionsSelectorOneOf,
      }),
      preferred: true,
    },
    agentPlatform: {
      externalDependencies: ['polymarket-api', 'rpc'],
      expectedLatencyMs: 1200,
    },
  }),
  commandContract({
    name: 'polymarket.deposit',
    summary: 'Dry-run or execute a signer-to-proxy Polymarket funding transfer.',
    usage:
      'pandora [--output table|json] polymarket deposit --amount-usdc <n> --dry-run|--execute [--to <address>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]',
    emits: ['polymarket.deposit', 'polymarket.deposit.help', 'polymarket.help'],
    dataSchema: '#/definitions/PolymarketPayload',
    mcpExposed: true,
    mcp: {
      command: ['polymarket', 'deposit'],
      description: 'Dry-run or execute a signer-to-proxy Polymarket funding transfer.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'amount-usdc': numberSchema('Funding amount in USDC.', { minimum: 0 }),
          to: stringSchema('Override destination wallet address.'),
          'dry-run': booleanSchema('Run dry-run mode.'),
          execute: booleanSchema('Execute live funding transfer.'),
          fork: booleanSchema('Run in fork mode.'),
          'fork-rpc-url': stringSchema('Fork RPC URL.'),
          'fork-chain-id': integerSchema('Fork chain id.', { minimum: 1 }),
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          funder: stringSchema('Polymarket proxy wallet.'),
        },
        requiredFlags: ['amount-usdc'],
      }),
      preferred: true,
      mutating: true,
      safeFlags: ['--dry-run'],
      executeFlags: ['--execute'],
    },
  }),
  commandContract({
    name: 'polymarket.withdraw',
    summary: 'Dry-run or execute a proxy-to-signer Polymarket funding transfer.',
    usage:
      'pandora [--output table|json] polymarket withdraw --amount-usdc <n> --dry-run|--execute [--to <address>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]',
    emits: ['polymarket.withdraw', 'polymarket.withdraw.help', 'polymarket.help'],
    dataSchema: '#/definitions/PolymarketPayload',
    mcpExposed: true,
    mcp: {
      command: ['polymarket', 'withdraw'],
      description: 'Dry-run or execute a proxy-to-signer Polymarket funding transfer. Execute mode requires the signer to control the source wallet.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'amount-usdc': numberSchema('Funding amount in USDC.', { minimum: 0 }),
          to: stringSchema('Override destination wallet address.'),
          'dry-run': booleanSchema('Run dry-run mode.'),
          execute: booleanSchema('Execute live funding transfer.'),
          fork: booleanSchema('Run in fork mode.'),
          'fork-rpc-url': stringSchema('Fork RPC URL.'),
          'fork-chain-id': integerSchema('Fork chain id.', { minimum: 1 }),
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          funder: stringSchema('Polymarket proxy wallet.'),
        },
        requiredFlags: ['amount-usdc'],
      }),
      preferred: true,
      mutating: true,
      safeFlags: ['--dry-run'],
      executeFlags: ['--execute'],
    },
  }),
  commandContract({
    name: 'polymarket.trade',
    summary: 'Dry-run or execute a Polymarket trade.',
    usage:
      'pandora [--output table|json] polymarket trade --condition-id <id>|--slug <slug>|--token-id <id> --token yes|no --amount-usdc <n> --dry-run|--execute [--side buy|sell] [--polymarket-host <url>] [--polymarket-mock-url <url>] [--timeout-ms <ms>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]',
    emits: ['polymarket.trade', 'polymarket.trade.help', 'polymarket.help'],
    dataSchema: '#/definitions/PolymarketPayload',
    mcpExposed: true,
    mcp: {
      command: ['polymarket', 'trade'],
      description: 'Dry-run or execute Polymarket trade.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'condition-id': stringSchema('Polymarket condition id or market id.'),
          slug: stringSchema('Polymarket slug.'),
          'token-id': stringSchema('Polymarket token id.'),
          token: enumSchema(['yes', 'no'], 'Token/outcome side.'),
          'amount-usdc': numberSchema('Trade notional in USDC.', { exclusiveMinimum: 0 }),
          'dry-run': booleanSchema('Run dry-run mode.'),
          execute: booleanSchema('Execute live trade.'),
          side: enumSchema(['buy', 'sell'], 'Order side.'),
          'polymarket-host': stringSchema('Polymarket host override.'),
          'polymarket-mock-url': stringSchema('Polymarket mock URL.'),
          'timeout-ms': commonFlags.timeoutMs,
          fork: booleanSchema('Run in fork mode.'),
          'fork-rpc-url': stringSchema('Fork RPC URL.'),
          'fork-chain-id': integerSchema('Fork chain id.', { minimum: 1 }),
          'rpc-url': commonFlags.rpcUrl,
          'private-key': commonFlags.privateKey,
          funder: stringSchema('Polymarket proxy wallet.'),
        },
        requiredFlags: ['amount-usdc'],
        anyOf: polymarketTradeSelectorAndModeAnyOf,
        oneOf: polymarketTradeModeOneOf,
      }),
      preferred: true,
      mutating: true,
      safeFlags: ['--dry-run'],
      executeFlags: ['--execute'],
    },
  }),
  commandContract({
    name: 'webhook',
    summary: 'Webhook command family help and routing entrypoint.',
    usage:
      'pandora [--output table|json] webhook test [--webhook-url <url>] [--webhook-template <json>] [--webhook-secret <secret>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>] [--webhook-timeout-ms <ms>] [--webhook-retries <n>]',
    emits: ['webhook.help'],
    dataSchema: GENERIC_DATA_SCHEMA_REF,
  }),
  commandContract({
    name: 'webhook.test',
    summary: 'Send generic, Telegram, and Discord webhook test payloads.',
    usage:
      'pandora [--output table|json] webhook test [--webhook-url <url>] [--webhook-template <json>] [--webhook-secret <secret>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>] [--webhook-timeout-ms <ms>] [--webhook-retries <n>]',
    emits: ['webhook.test', 'webhook.test.help', 'webhook.help'],
    dataSchema: '#/definitions/WebhookPayload',
    mcpExposed: true,
    mcp: {
      command: ['webhook', 'test'],
      description: 'Send webhook/notification test payload.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          'webhook-url': stringSchema('Generic webhook target URL.'),
          'webhook-template': stringSchema('Webhook payload template JSON.'),
          'webhook-secret': stringSchema('Webhook signing secret.'),
          'telegram-bot-token': stringSchema('Telegram bot token.'),
          'telegram-chat-id': stringSchema('Telegram chat id.'),
          'discord-webhook-url': stringSchema('Discord webhook URL.'),
          'webhook-timeout-ms': integerSchema('Webhook timeout in milliseconds.', { minimum: 1 }),
          'webhook-retries': integerSchema('Webhook retry count.', { minimum: 0 }),
          'fail-on-webhook-error': booleanSchema('Exit non-zero if any delivery fails.'),
        },
      }),
      preferred: true,
      mutating: true,
    },
  }),
  commandContract({
    name: 'leaderboard',
    summary: 'Compute wallet rankings from historical trade outcomes.',
    usage: 'pandora [--output table|json] leaderboard [--metric profit|volume|win-rate] [--chain-id <id>] [--limit <n>] [--min-trades <n>]',
    emits: ['leaderboard', 'leaderboard.help'],
    dataSchema: '#/definitions/LeaderboardPayload',
    mcpExposed: true,
    mcp: {
      command: ['leaderboard'],
      description: 'Compute leaderboard from history.',
      inputSchema: buildInputSchema({
        flagProperties: {
          metric: enumSchema(['profit', 'volume', 'win-rate'], 'Leaderboard metric.'),
          'chain-id': commonFlags.chainId,
          limit: commonFlags.limit,
          'min-trades': integerSchema('Minimum trade count.', { minimum: 0 }),
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
        },
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'analyze',
    summary: 'Run strategy analysis provider against one market context.',
    usage: 'pandora [--output table|json] analyze --market-address <address> [--provider <name>] [--model <id>] [--max-cost-usd <n>] [--temperature <n>] [--timeout-ms <ms>]',
    emits: ['analyze', 'analyze.help'],
    dataSchema: '#/definitions/AnalyzePayload',
    mcpExposed: true,
    mcp: {
      command: ['analyze'],
      description: 'Run strategy analysis provider.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'market-address': commonFlags.marketAddress,
          provider: stringSchema('Analyze provider name.'),
          model: stringSchema('Model identifier.'),
          'max-cost-usd': numberSchema('Maximum allowed provider cost in USD.', { minimum: 0 }),
          temperature: numberSchema('Model temperature.', { minimum: 0 }),
          'timeout-ms': commonFlags.timeoutMs,
          'indexer-url': commonFlags.indexerUrl,
        },
        requiredFlags: ['market-address'],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'suggest',
    summary: 'Produce trade suggestions from wallet history and cross-venue context.',
    usage: 'pandora [--output table|json] suggest --wallet <address> --risk low|medium|high --budget <amount> [--count <n>] [--include-venues pandora,polymarket]',
    emits: ['suggest', 'suggest.help'],
    dataSchema: '#/definitions/SuggestPayload',
    mcpExposed: true,
    mcp: {
      command: ['suggest'],
      description: 'Produce trade suggestions from risk profile.',
      inputSchema: buildInputSchema({
        flagProperties: {
          wallet: commonFlags.wallet,
          risk: enumSchema(['low', 'medium', 'high'], 'Risk profile.'),
          budget: numberSchema('Budget in USDC.', { minimum: 0 }),
          count: integerSchema('Maximum suggestion count.', { minimum: 1 }),
          'include-venues': stringSchema('Comma-delimited venue list.'),
          'indexer-url': commonFlags.indexerUrl,
          'timeout-ms': commonFlags.timeoutMs,
        },
        requiredFlags: ['wallet', 'risk', 'budget'],
      }),
      preferred: true,
    },
  }),
  commandContract({
    name: 'operations',
    summary: 'Inspect and control durable operation records for mutable workflows.',
    usage: 'pandora [--output table|json] operations get|list|receipt|verify-receipt|cancel|close [flags]',
    emits: ['operations.help'],
    dataSchema: '#/definitions/CommandHelpPayload',
  }),
  commandContract({
    name: 'operations.get',
    summary: 'Return a single operation record including lifecycle and checkpoints.',
    usage: 'pandora [--output table|json] operations get --id <operation-id>',
    emits: ['operations.get', 'operations.get.help', 'operations.help'],
    dataSchema: '#/definitions/OperationPayload',
    mcpExposed: true,
    mcp: {
      command: ['operations', 'get'],
      description: 'Inspect a single Pandora operation record.',
      inputSchema: buildInputSchema({
        flagProperties: {
          id: stringSchema('Operation id to inspect.'),
        },
        requiredFlags: ['id'],
      }),
      preferred: true,
    },
    agentPlatform: {
      expectedLatencyMs: 200,
      externalDependencies: [],
      supportsRemote: true,
      remoteEligible: true,
      policyScopes: ['operations:read'],
    },
  }),
  commandContract({
    name: 'operations.list',
    summary: 'List operation records, optionally filtered by status or tool.',
    usage: 'pandora [--output table|json] operations list [--status <csv>] [--tool <name>] [--limit <n>]',
    emits: ['operations.list', 'operations.list.help', 'operations.help'],
    dataSchema: '#/definitions/OperationListPayload',
    mcpExposed: true,
    mcp: {
      command: ['operations', 'list'],
      description: 'List Pandora operation records by status/tool filters.',
      inputSchema: buildInputSchema({
        flagProperties: {
          status: stringSchema('Optional comma-delimited operation statuses to include.'),
          statuses: stringArraySchema('Optional operation statuses to include.'),
          tool: stringSchema('Optional tool/command family filter.'),
          limit: integerSchema('Maximum result count.', { minimum: 1 }),
        },
      }),
      preferred: true,
    },
    agentPlatform: {
      expectedLatencyMs: 250,
      externalDependencies: [],
      supportsRemote: true,
      remoteEligible: true,
      policyScopes: ['operations:read'],
    },
  }),
  commandContract({
    name: 'operations.receipt',
    summary: 'Return the terminal receipt for a completed, failed, canceled, or closed operation.',
    usage: 'pandora [--output table|json] operations receipt --id <operation-id>',
    emits: ['operations.receipt', 'operations.receipt.help', 'operations.help'],
    dataSchema: '#/definitions/OperationReceiptPayload',
    mcpExposed: true,
    mcp: {
      command: ['operations', 'receipt'],
      description: 'Inspect the terminal receipt for a Pandora operation.',
      inputSchema: buildInputSchema({
        flagProperties: {
          id: stringSchema('Operation id whose terminal receipt should be returned.'),
        },
        requiredFlags: ['id'],
      }),
      preferred: true,
    },
    agentPlatform: {
      expectedLatencyMs: 225,
      externalDependencies: [],
      supportsRemote: true,
      remoteEligible: true,
      policyScopes: ['operations:read'],
    },
  }),
  commandContract({
    name: 'operations.verify-receipt',
    summary: 'Verify a stored or on-disk operation receipt for tampering and operation-hash mismatch.',
    usage: 'pandora [--output table|json] operations verify-receipt --id <operation-id>|--file <path> [--expected-operation-hash <hash>]',
    emits: ['operations.verify-receipt', 'operations.verify-receipt.help', 'operations.help'],
    dataSchema: '#/definitions/OperationReceiptVerificationPayload',
    mcpExposed: true,
    mcp: {
      command: ['operations', 'verify-receipt'],
      description: 'Verify the stored terminal receipt for a Pandora operation by id. File-based verification remains CLI-only.',
      inputSchema: buildInputSchema({
        flagProperties: {
          id: stringSchema('Operation id whose terminal receipt should be verified.'),
          'expected-operation-hash': stringSchema('Optional expected operation hash to bind the verification result.'),
        },
        requiredFlags: ['id'],
      }),
      preferred: true,
    },
    agentPlatform: {
      expectedLatencyMs: 250,
      externalDependencies: [],
      supportsRemote: true,
      remoteEligible: true,
      policyScopes: ['operations:read'],
    },
  }),
  commandContract({
    name: 'operations.cancel',
    summary: 'Request cancellation of a cancelable operation.',
    usage: 'pandora [--output table|json] operations cancel --id <operation-id> [--reason <text>]',
    emits: ['operations.cancel', 'operations.cancel.help', 'operations.help'],
    dataSchema: '#/definitions/OperationPayload',
    mcpExposed: true,
    mcp: {
      command: ['operations', 'cancel'],
      description: 'Cancel a cancelable Pandora operation.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          id: stringSchema('Operation id to cancel.'),
          reason: stringSchema('Optional operator reason for the cancellation request.'),
        },
        requiredFlags: ['id'],
      }),
      preferred: true,
      mutating: true,
    },
    agentPlatform: {
      riskLevel: 'medium',
      idempotency: 'conditional',
      expectedLatencyMs: 400,
      externalDependencies: [],
      supportsRemote: true,
      remoteEligible: true,
      policyScopes: ['operations:write'],
    },
  }),
  commandContract({
    name: 'operations.close',
    summary: 'Close a terminal operation record after follow-up is complete.',
    usage: 'pandora [--output table|json] operations close --id <operation-id> [--reason <text>]',
    emits: ['operations.close', 'operations.close.help', 'operations.help'],
    dataSchema: '#/definitions/OperationPayload',
    mcpExposed: true,
    mcp: {
      command: ['operations', 'close'],
      description: 'Close a terminal Pandora operation record.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          id: stringSchema('Operation id to close.'),
          reason: stringSchema('Optional operator reason for closing the operation record.'),
        },
        requiredFlags: ['id'],
      }),
      preferred: true,
      mutating: true,
    },
    agentPlatform: {
      riskLevel: 'medium',
      idempotency: 'conditional',
      expectedLatencyMs: 400,
      externalDependencies: [],
      supportsRemote: true,
      remoteEligible: true,
      policyScopes: ['operations:write'],
    },
  }),
  commandContract({
    name: 'policy',
    summary: 'Policy pack command family help and routing entrypoint.',
    usage: 'pandora [--output table|json] policy list|get|explain|recommend|lint [flags]',
    emits: ['policy.help'],
    dataSchema: '#/definitions/PolicyListPayload',
  }),
  commandContract({
    name: 'policy.list',
    summary: 'List built-in and user-defined policy packs.',
    usage: 'pandora [--output table|json] policy list',
    emits: ['policy.list', 'policy.list.help', 'policy.help'],
    dataSchema: '#/definitions/PolicyListPayload',
    mcpExposed: true,
    mcp: {
      command: ['policy', 'list'],
      description: 'List built-in and user-defined policy packs.',
      inputSchema: buildInputSchema(),
      preferred: true,
    },
    agentPlatform: {
      expectedLatencyMs: 150,
      externalDependencies: [],
      supportsRemote: true,
      remoteEligible: true,
      policyScopes: ['contracts:read'],
    },
  }),
  commandContract({
    name: 'policy.get',
    summary: 'Return one policy pack by id.',
    usage: 'pandora [--output table|json] policy get --id <policy-id>',
    emits: ['policy.get', 'policy.get.help', 'policy.help'],
    dataSchema: '#/definitions/PolicyPayload',
    mcpExposed: true,
    mcp: {
      command: ['policy', 'get'],
      description: 'Return one policy pack by id.',
      inputSchema: buildInputSchema({
        flagProperties: {
          id: stringSchema('Policy pack id.'),
        },
        requiredFlags: ['id'],
      }),
      preferred: true,
    },
    agentPlatform: {
      expectedLatencyMs: 150,
      externalDependencies: [],
      supportsRemote: true,
      remoteEligible: true,
      policyScopes: ['contracts:read'],
    },
  }),
  commandContract({
    name: 'policy.lint',
    summary: 'Validate a policy pack file before use.',
    usage: 'pandora [--output table|json] policy lint --file <path>',
    emits: ['policy.lint', 'policy.lint.help', 'policy.help'],
    dataSchema: '#/definitions/PolicyPayload',
    mcpExposed: true,
    mcp: {
      command: ['policy', 'lint'],
      description: 'Validate a policy pack file before use.',
      inputSchema: buildInputSchema({
        flagProperties: {
          file: stringSchema('Workspace-relative path to a policy JSON file.'),
        },
        requiredFlags: ['file'],
      }),
      preferred: true,
    },
    agentPlatform: {
      expectedLatencyMs: 200,
      externalDependencies: [],
      supportsRemote: true,
      remoteEligible: true,
      policyScopes: ['contracts:read'],
    },
  }),
  commandContract({
    name: 'policy.explain',
    summary: 'Evaluate one policy pack against an exact execution context and return remediation.',
    usage: 'pandora [--output table|json] policy explain --id <policy-id> [--command <tool>] [--mode dry-run|paper|fork|execute|execute-live] [--chain-id <id>] [--category <id|name>] [--profile-id <id>]',
    emits: ['policy.explain', 'policy.explain.help', 'policy.help'],
    dataSchema: '#/definitions/PolicyExplainPayload',
    mcpExposed: true,
    mcp: {
      command: ['policy', 'explain'],
      description: 'Evaluate one policy pack against an exact command/mode/chain/category/profile context and return actionable remediation.',
      inputSchema: buildInputSchema({
        flagProperties: {
          id: stringSchema('Policy pack id.'),
          command: stringSchema('Exact target command to evaluate. Add together with mode/chain/category/profile for the full execution context.'),
          mode: stringSchema('Execution mode to evaluate exactly: dry-run, paper, fork, execute, or execute-live.'),
          'chain-id': stringSchema('Chain id to evaluate exactly.'),
          category: stringSchema('Poll category id or canonical name to evaluate exactly.'),
          'profile-id': stringSchema('Optional signer profile id to include as compatibility context.'),
        },
        requiredFlags: ['id'],
      }),
      preferred: true,
    },
    agentPlatform: {
      expectedLatencyMs: 200,
      externalDependencies: [],
      supportsRemote: true,
      remoteEligible: true,
      policyScopes: ['contracts:read'],
    },
  }),
  commandContract({
    name: 'policy.recommend',
    summary: 'Recommend policy packs for an execution context.',
    usage: 'pandora [--output table|json] policy recommend [--command <tool>] [--mode dry-run|paper|fork|execute|execute-live] [--chain-id <id>] [--category <id|name>] [--profile-id <id>]',
    emits: ['policy.recommend', 'policy.recommend.help', 'policy.help'],
    dataSchema: '#/definitions/PolicyRecommendPayload',
    mcpExposed: true,
    mcp: {
      command: ['policy', 'recommend'],
      description: 'Recommend policy packs for a command/mode/chain/category/profile execution context.',
      inputSchema: buildInputSchema({
        flagProperties: {
          command: stringSchema('Exact target command to evaluate.'),
          mode: stringSchema('Execution mode to evaluate: dry-run, paper, fork, execute, or execute-live.'),
          'chain-id': stringSchema('Chain id to evaluate.'),
          category: stringSchema('Poll category id or canonical name to evaluate.'),
          'profile-id': stringSchema('Optional signer profile id to include as compatibility context.'),
        },
      }),
      preferred: true,
    },
    agentPlatform: {
      expectedLatencyMs: 200,
      externalDependencies: [],
      supportsRemote: true,
      remoteEligible: true,
      policyScopes: ['contracts:read'],
    },
  }),
  commandContract({
    name: 'profile',
    summary: 'Signer profile command family help and routing entrypoint.',
    usage: 'pandora [--output table|json] profile list|get|explain|recommend|validate [flags]',
    emits: ['profile.help'],
    dataSchema: '#/definitions/ProfileListPayload',
  }),
  commandContract({
    name: 'profile.list',
    summary: 'List built-in and user-defined signer profiles.',
    usage: 'pandora [--output table|json] profile list',
    emits: ['profile.list', 'profile.list.help', 'profile.help'],
    dataSchema: '#/definitions/ProfileListPayload',
    mcpExposed: true,
    mcp: {
      command: ['profile', 'list'],
      description: 'List built-in and user-defined signer profiles.',
      inputSchema: buildInputSchema(),
      preferred: true,
    },
    agentPlatform: {
      expectedLatencyMs: 150,
      externalDependencies: [],
      supportsRemote: true,
      remoteEligible: true,
      policyScopes: ['contracts:read'],
    },
  }),
  commandContract({
    name: 'profile.get',
    summary: 'Inspect one signer profile by id and optionally annotate it with compatibility context.',
    usage: 'pandora [--output table|json] profile get --id <profile-id> [--store-file <path>] [--command <tool>] [--mode dry-run|paper|fork|execute|execute-live] [--chain-id <id>] [--category <id|name>] [--policy-id <id>]',
    emits: ['profile.get', 'profile.get.help', 'profile.help'],
    dataSchema: '#/definitions/ProfilePayload',
    mcpExposed: true,
    mcp: {
      command: ['profile', 'get'],
      description: 'Inspect one signer profile by id and optionally include compatibility context.',
      inputSchema: buildInputSchema({
        flagProperties: {
          id: stringSchema('Signer profile id.'),
          'store-file': stringSchema('Optional profile store file path.'),
          command: stringSchema('Optional exact target command to annotate compatibility context.'),
          mode: stringSchema('Optional execution mode to annotate compatibility context.'),
          'chain-id': stringSchema('Optional chain id to annotate compatibility context.'),
          category: stringSchema('Optional poll category id or name to annotate compatibility context.'),
          'policy-id': stringSchema('Optional policy id to annotate compatibility context.'),
        },
        requiredFlags: ['id'],
      }),
      preferred: true,
    },
    agentPlatform: {
      expectedLatencyMs: 150,
      externalDependencies: [],
      supportsRemote: true,
      remoteEligible: true,
      policyScopes: ['contracts:read'],
    },
  }),
  commandContract({
    name: 'profile.explain',
    summary: 'Evaluate one signer profile against an exact execution context and return remediation.',
    usage: 'pandora [--output table|json] profile explain --id <profile-id> [--store-file <path>] [--command <tool>] [--mode dry-run|paper|fork|execute|execute-live] [--chain-id <id>] [--category <id|name>] [--policy-id <id>]',
    emits: ['profile.explain', 'profile.explain.help', 'profile.help'],
    dataSchema: '#/definitions/ProfilePayload',
    mcpExposed: true,
    mcp: {
      command: ['profile', 'explain'],
      description: 'Evaluate one signer profile against an exact command/mode/chain/category/policy context and return actionable remediation.',
      inputSchema: buildInputSchema({
        flagProperties: {
          id: stringSchema('Signer profile id.'),
          'store-file': stringSchema('Optional profile store file path.'),
          command: stringSchema('Exact target command to evaluate. Add together with mode/chain/category/policy for the full execution context.'),
          mode: stringSchema('Execution mode to evaluate exactly: dry-run, paper, fork, execute, or execute-live.'),
          'chain-id': stringSchema('Chain id to evaluate exactly.'),
          category: stringSchema('Poll category id or canonical name to evaluate exactly.'),
          'policy-id': stringSchema('Policy id to evaluate exactly.'),
        },
        requiredFlags: ['id'],
      }),
      preferred: true,
    },
    agentPlatform: {
      expectedLatencyMs: 200,
      externalDependencies: [],
      supportsRemote: true,
      remoteEligible: true,
      policyScopes: ['contracts:read'],
    },
  }),
  commandContract({
    name: 'profile.recommend',
    summary: 'Recommend signer profiles for an execution context.',
    usage: 'pandora [--output table|json] profile recommend [--store-file <path>] [--command <tool>] [--mode dry-run|paper|fork|execute|execute-live] [--chain-id <id>] [--category <id|name>] [--policy-id <id>] [--no-builtins|--builtin-only]',
    emits: ['profile.recommend', 'profile.recommend.help', 'profile.help'],
    dataSchema: '#/definitions/ProfileRecommendPayload',
    mcpExposed: true,
    mcp: {
      command: ['profile', 'recommend'],
      description: 'Recommend signer profiles for a command/mode/chain/category/policy execution context.',
      inputSchema: buildInputSchema({
        flagProperties: {
          'store-file': stringSchema('Optional profile store file path.'),
          command: stringSchema('Exact target command to evaluate.'),
          mode: stringSchema('Execution mode to evaluate: dry-run, paper, fork, execute, or execute-live.'),
          'chain-id': stringSchema('Chain id to evaluate.'),
          category: stringSchema('Poll category id or canonical name to evaluate.'),
          'policy-id': stringSchema('Optional policy id to include as compatibility context.'),
          'no-builtins': booleanSchema('Exclude built-in profiles from recommendation results.'),
          'builtin-only': booleanSchema('Restrict recommendations to built-in profiles.'),
        },
      }),
      preferred: true,
    },
    agentPlatform: {
      expectedLatencyMs: 200,
      externalDependencies: [],
      supportsRemote: true,
      remoteEligible: true,
      policyScopes: ['contracts:read'],
    },
  }),
  commandContract({
    name: 'profile.validate',
    summary: 'Validate a signer profile file before use.',
    usage: 'pandora [--output table|json] profile validate --file <path>',
    emits: ['profile.validate', 'profile.validate.help', 'profile.help'],
    dataSchema: '#/definitions/ProfilePayload',
    mcpExposed: true,
    mcp: {
      command: ['profile', 'validate'],
      description: 'Validate a signer profile file before use.',
      inputSchema: buildInputSchema({
        flagProperties: {
          file: stringSchema('Workspace-relative path to a signer profile JSON file.'),
        },
        requiredFlags: ['file'],
      }),
      preferred: true,
    },
    agentPlatform: {
      expectedLatencyMs: 200,
      externalDependencies: [],
      supportsRemote: true,
      remoteEligible: true,
      policyScopes: ['contracts:read'],
    },
  }),
  commandContract({
    name: 'recipe',
    summary: 'Recipe command family help and routing entrypoint.',
    usage: 'pandora [--output table|json] recipe list|get|validate|run [flags]',
    emits: ['recipe.help'],
    dataSchema: '#/definitions/RecipeListPayload',
  }),
  commandContract({
    name: 'recipe.list',
    summary: 'List first-party Pandora recipes.',
    usage: 'pandora [--output table|json] recipe list',
    emits: ['recipe.list', 'recipe.list.help', 'recipe.help'],
    dataSchema: '#/definitions/RecipeListPayload',
    mcpExposed: true,
    mcp: {
      command: ['recipe', 'list'],
      description: 'List first-party Pandora recipes.',
      inputSchema: buildInputSchema(),
      preferred: true,
    },
    agentPlatform: {
      expectedLatencyMs: 150,
      externalDependencies: [],
      supportsRemote: true,
      remoteEligible: true,
      policyScopes: ['contracts:read'],
    },
  }),
  commandContract({
    name: 'recipe.get',
    summary: 'Return one recipe manifest by id or file.',
    usage: 'pandora [--output table|json] recipe get --id <recipe-id>|--file <path>',
    emits: ['recipe.get', 'recipe.get.help', 'recipe.help'],
    dataSchema: '#/definitions/RecipePayload',
    mcpExposed: true,
    mcp: {
      command: ['recipe', 'get'],
      description: 'Return one recipe manifest by id or file.',
      inputSchema: buildInputSchema({
        flagProperties: {
          id: stringSchema('Built-in recipe id.'),
          file: stringSchema('Workspace-relative path to a recipe JSON file.'),
        },
        oneOf: buildExclusivePresenceBranches([['id'], ['file']]),
      }),
      preferred: true,
    },
    agentPlatform: {
      expectedLatencyMs: 200,
      externalDependencies: [],
      supportsRemote: true,
      remoteEligible: true,
      policyScopes: ['contracts:read'],
    },
  }),
  commandContract({
    name: 'recipe.validate',
    summary: 'Validate a recipe manifest and its policy/profile compatibility.',
    usage: 'pandora [--output table|json] recipe validate --id <recipe-id>|--file <path> [--set key=value] [--policy-id <id>] [--profile-id <id>]',
    emits: ['recipe.validate', 'recipe.validate.help', 'recipe.help'],
    dataSchema: '#/definitions/RecipeRunPayload',
    mcpExposed: true,
    mcp: {
      command: ['recipe', 'validate'],
      description: 'Validate a recipe manifest and its policy/profile compatibility.',
      inputSchema: buildInputSchema({
        flagProperties: {
          id: stringSchema('Built-in recipe id.'),
          file: stringSchema('Workspace-relative path to a recipe JSON file.'),
          inputs: {
            type: 'object',
            description: 'Recipe input values keyed by recipe input id.',
            additionalProperties: {
              type: ['string', 'number', 'integer', 'boolean'],
            },
          },
          'policy-id': stringSchema('Optional policy pack id override.'),
          'profile-id': stringSchema('Optional signer profile id override.'),
        },
        oneOf: buildExclusivePresenceBranches([['id'], ['file']]),
      }),
      preferred: true,
      controlInputNames: ['inputs'],
    },
    agentPlatform: {
      expectedLatencyMs: 350,
      externalDependencies: [],
      supportsRemote: true,
      remoteEligible: true,
      policyScopes: ['contracts:read'],
    },
  }),
  commandContract({
    name: 'recipe.run',
    summary: 'Run a safe first-party recipe by compiling it into an ordinary Pandora command.',
    usage: 'pandora [--output table|json] recipe run --id <recipe-id>|--file <path> [--set key=value] [--policy-id <id>] [--profile-id <id>] [--timeout-ms <ms>]',
    emits: ['recipe.run', 'recipe.run.help', 'recipe.help'],
    dataSchema: '#/definitions/RecipeRunPayload',
    mcpExposed: true,
    mcp: {
      command: ['recipe', 'run'],
      description: 'Run a safe recipe by compiling it into an ordinary Pandora command.',
      inputSchema: buildInputSchema({
        flagProperties: {
          id: stringSchema('Built-in recipe id.'),
          file: stringSchema('Workspace-relative path to a recipe JSON file.'),
          inputs: {
            type: 'object',
            description: 'Recipe input values keyed by recipe input id.',
            additionalProperties: {
              type: ['string', 'number', 'integer', 'boolean'],
            },
          },
          'policy-id': stringSchema('Optional policy pack id override.'),
          'profile-id': stringSchema('Optional signer profile id override.'),
          'timeout-ms': integerSchema('Optional timeout for delegated command execution.', { minimum: 1000 }),
        },
        oneOf: buildExclusivePresenceBranches([['id'], ['file']]),
      }),
      preferred: true,
      controlInputNames: ['inputs'],
    },
    agentPlatform: {
      riskLevel: 'low',
      idempotency: 'conditional',
      expectedLatencyMs: 1200,
      externalDependencies: [],
      supportsRemote: true,
      remoteEligible: true,
      policyScopes: ['contracts:read'],
    },
  }),
  commandContract({
    name: 'risk',
    summary: 'Risk command family help and routing entrypoint.',
    usage: 'pandora [--output table|json] risk show|panic [--risk-file <path>] [--clear] [--reason <text>] [--actor <id>]',
    emits: ['risk.help'],
    dataSchema: '#/definitions/RiskPayload',
  }),
  commandContract({
    name: 'risk.show',
    summary: 'Inspect current risk panic and guardrail state.',
    usage: 'pandora [--output table|json] risk show',
    emits: ['risk.show', 'risk.show.help', 'risk.help'],
    dataSchema: '#/definitions/RiskPayload',
    mcpExposed: true,
    mcp: {
      command: ['risk', 'show'],
      description: 'Inspect current risk panic/guardrail state.',
      inputSchema: buildInputSchema(),
      preferred: true,
    },
  }),
  commandContract({
    name: 'risk.panic',
    summary: 'Engage or clear the global risk panic lock.',
    usage: 'pandora [--output table|json] risk panic [--clear] [--reason <text>] [--actor <id>]',
    emits: ['risk.panic', 'risk.panic.help', 'risk.help'],
    dataSchema: '#/definitions/RiskPayload',
    mcpExposed: true,
    mcp: {
      command: ['risk', 'panic'],
      description: 'Engage or clear global risk panic lock.',
      inputSchema: buildInputSchema({
        includeIntent: true,
        flagProperties: {
          clear: booleanSchema('Clear the panic lock.'),
          reason: stringSchema('Reason for engaging panic mode. Required unless clear=true.'),
          actor: stringSchema('Operator or agent identifier recorded with the panic action.'),
        },
        anyOf: [['clear'], ['reason']],
      }),
      preferred: true,
      mutating: true,
    },
  }),
  commandContract({
    name: 'explain',
    summary: 'Explain a Pandora error code or error envelope and return canonical remediation.',
    usage: 'pandora [--output table|json] explain <error-code>|--code <code> [--message <text>] [--details-json <json>] [--stdin]',
    emits: ['explain', 'explain.help'],
    dataSchema: '#/definitions/ExplainPayload',
    mcpExposed: true,
    mcp: {
      command: ['explain'],
      description: 'Explain a Pandora error and return canonical remediation plus next commands.',
      inputSchema: buildInputSchema({
        flagProperties: {
          code: stringSchema('Canonical Pandora error code to explain.'),
          message: stringSchema('Optional error message to preserve alongside the code.'),
          'details-json': stringSchema('Optional JSON object string containing structured error details.'),
          stdin: booleanSchema('Local CLI helper: read a raw error object or full Pandora JSON failure envelope from stdin.'),
        },
        anyOf: [['code'], ['stdin']],
      }),
      preferred: true,
    },
    agentPlatform: {
      expectedLatencyMs: 100,
      externalDependencies: [],
      supportsRemote: true,
      remoteEligible: true,
      policyScopes: ['contracts:read'],
    },
  }),
];

function isCompatibilityAliasContract(contract) {
  return Boolean(contract && contract.aliasOf);
}

function resolveCanonicalToolName(contract) {
  return contract.canonicalTool || contract.aliasOf || (contract.mcpExposed ? contract.name : null);
}

function isPreferredMcpContract(contract, canonicalTool) {
  if (contract.mcp && contract.mcp.preferred === false) return false;
  if (canonicalTool) return contract.name === canonicalTool;
  if (contract.aliasOf) return false;
  return Boolean(contract.mcpExposed);
}

function buildCommandDescriptors() {
  const contractByName = new Map(commandContracts.map((contract) => [contract.name, contract]));
  const descriptors = {};
  for (const contract of commandContracts) {
    const canonicalTool = resolveCanonicalToolName(contract);
    const canonicalContract = canonicalTool ? contractByName.get(canonicalTool) || null : null;
    const compatibilityAlias = isCompatibilityAliasContract(contract);
    const agentPlatform = resolveAgentPlatformMetadata(contract);
    const safeFlags =
      contract.mcp && Array.isArray(contract.mcp.safeFlags)
        ? [...contract.mcp.safeFlags]
        : [];
    const executeFlags =
      contract.mcp && Array.isArray(contract.mcp.executeFlags)
        ? [...contract.mcp.executeFlags]
        : [];
    const mcpMutating = Boolean(contract.mcp && contract.mcp.mutating);
    descriptors[contract.name] = {
      summary: contract.summary,
      usage: contract.usage,
      emits: contract.emits,
      outputModes: contract.outputModes,
      dataSchema: contract.dataSchema,
      helpDataSchema: contract.helpDataSchema,
      inputSchema: contract.mcp && contract.mcp.inputSchema ? contract.mcp.inputSchema : null,
      mcpExposed: Boolean(contract.mcpExposed),
      aliasOf: contract.aliasOf || null,
      canonicalTool,
      preferred: isPreferredMcpContract(contract, canonicalTool),
      mcpMutating,
      mcpLongRunningBlocked: Boolean(contract.mcp && contract.mcp.longRunningBlocked),
      controlInputNames:
        contract.mcp && Array.isArray(contract.mcp.controlInputNames)
          ? [...contract.mcp.controlInputNames]
          : [],
      safeFlags,
      executeFlags,
      executeIntentRequired: Boolean(mcpMutating && safeFlags.length === 0),
      executeIntentRequiredForLiveMode: Boolean(mcpMutating && executeFlags.length > 0),
      canonicalCommandTokens:
        canonicalContract && typeof canonicalContract.name === 'string'
          ? canonicalContract.name.split('.')
          : null,
      canonicalUsage: canonicalContract && canonicalContract.usage ? canonicalContract.usage : null,
      agentWorkflow: contract.agentWorkflow || null,
      ...agentPlatform,
    };
  }
  return descriptors;
}

function buildMcpToolDefinitions(options = {}) {
  const includeCompatibilityAliases =
    !options || !Object.prototype.hasOwnProperty.call(options, 'includeCompatibilityAliases')
      ? true
      : Boolean(options.includeCompatibilityAliases);
  return commandContracts
    .filter((contract) => contract.mcpExposed && contract.mcp)
    .filter((contract) => includeCompatibilityAliases || !isCompatibilityAliasContract(contract))
    .map((contract) => {
      const agentPlatform = resolveAgentPlatformMetadata(contract);
      const compatibilityAlias = isCompatibilityAliasContract(contract);
      const canonicalTool = resolveCanonicalToolName(contract);
      return {
        name: contract.name,
        command: contract.mcp.command,
        description: contract.mcp.description,
        inputSchema: contract.mcp.inputSchema,
        mutating: Boolean(contract.mcp.mutating),
        safeFlags: Array.isArray(contract.mcp.safeFlags) ? [...contract.mcp.safeFlags] : [],
        executeFlags: Array.isArray(contract.mcp.executeFlags) ? [...contract.mcp.executeFlags] : [],
        longRunningBlocked: Boolean(contract.mcp.longRunningBlocked),
        placeholderBlocked: Boolean(contract.mcp.placeholderBlocked),
        aliasOf: contract.aliasOf || null,
        canonicalTool,
        preferred: isPreferredMcpContract(contract, canonicalTool),
        ...(compatibilityAlias
          ? {
              compatibilityAlias: true,
              compatibilityOptInRequired: true,
              defaultDiscoveryVisible: false,
              discoveryTier: 'compatibility',
            }
          : {}),
        controlInputNames: Array.isArray(contract.mcp.controlInputNames) ? [...contract.mcp.controlInputNames] : [],
        agentWorkflow: contract.agentWorkflow || null,
        ...agentPlatform,
      };
    });
}

module.exports = {
  COMMAND_DESCRIPTOR_VERSION,
  COMMAND_HELP_SCHEMA_REF,
  GENERIC_DATA_SCHEMA_REF,
  HELP_PAYLOAD_SCHEMA_REF,
  MCP_HELP_SCHEMA_REF,
  ODDS_HELP_SCHEMA_REF,
  MIRROR_STATUS_HELP_SCHEMA_REF,
  SCHEMA_HELP_SCHEMA_REF,
  CAPABILITIES_HELP_SCHEMA_REF,
  buildCommandDescriptors,
  buildMcpToolDefinitions,
};
