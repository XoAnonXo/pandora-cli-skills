/**
 * Implements the `schema` command to output standard JSON interfaces for Agent ingestion.
 */

const {
  buildCommandDescriptors,
  COMMAND_DESCRIPTOR_VERSION,
} = require('./agent_contract_registry.cjs');

function getJsonSchemaPrimitiveType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (value && typeof value === 'object') return 'object';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return null;
}

function sortUniqueStrings(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .filter((value) => typeof value === 'string' && value.trim())
        .map((value) => value.trim()),
    ),
  ).sort();
}

function sortObjectKeys(record) {
  const source = record && typeof record === 'object' ? record : {};
  const sorted = {};
  for (const key of Object.keys(source).sort((left, right) => left.localeCompare(right))) {
    sorted[key] = source[key];
  }
  return sorted;
}

function stringArraySchema(enumValues = null) {
  if (Array.isArray(enumValues) && enumValues.length) {
    return { type: 'array', items: { type: 'string', enum: enumValues } };
  }
  return { type: 'array', items: { type: 'string' } };
}

const DESCRIPTOR_FIELD_SCHEMA_OVERRIDES = Object.freeze({
  summary: { type: 'string' },
  usage: { type: 'string' },
  emits: stringArraySchema(),
  outputModes: stringArraySchema(['json', 'table']),
  dataSchema: { type: ['string', 'null'] },
  helpDataSchema: { type: ['string', 'null'] },
  inputSchema: { type: ['object', 'null'], additionalProperties: true },
  mcpExposed: { type: 'boolean' },
  aliasOf: { type: ['string', 'null'] },
  canonicalTool: { type: ['string', 'null'] },
  preferred: { type: 'boolean' },
  mcpMutating: { type: 'boolean' },
  mcpLongRunningBlocked: { type: 'boolean' },
  controlInputNames: stringArraySchema(),
  safeFlags: stringArraySchema(),
  executeFlags: stringArraySchema(),
  executeIntentRequired: { type: 'boolean' },
  executeIntentRequiredForLiveMode: { type: 'boolean' },
  canonicalCommandTokens: { type: ['array', 'null'], items: { type: 'string' } },
  canonicalUsage: { type: ['string', 'null'] },
  agentWorkflow: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
  riskLevel: { enum: ['low', 'medium', 'high', 'critical'] },
  idempotency: { enum: ['idempotent', 'conditional', 'non-idempotent'] },
  expectedLatencyMs: { type: 'number', minimum: 0 },
  requiresSecrets: { type: 'boolean' },
  recommendedPreflightTool: { type: ['string', 'null'] },
  safeEquivalent: { type: ['string', 'null'] },
  externalDependencies: stringArraySchema(),
  canRunConcurrent: { type: 'boolean' },
  returnsOperationId: { type: 'boolean' },
  returnsRuntimeHandle: { type: 'boolean' },
  jobCapable: { type: 'boolean' },
  supportsRemote: { type: 'boolean' },
  remoteEligible: { type: 'boolean' },
  remoteTransportActive: { type: 'boolean' },
  supportsWebhook: { type: 'boolean' },
  policyScopes: stringArraySchema(),
});

const CAPABILITIES_COMMAND_DIGEST_PROPERTIES = Object.freeze({
  summary: { type: ['string', 'null'] },
  outputModes: stringArraySchema(['json', 'table']),
  dataSchema: { type: ['string', 'null'] },
  helpDataSchema: { type: ['string', 'null'] },
  mcpExposed: { type: 'boolean' },
  aliasOf: { type: ['string', 'null'] },
  canonicalTool: { type: ['string', 'null'] },
  canonicalCommandTokens: { type: ['array', 'null'], items: { type: 'string' } },
  preferred: { type: 'boolean' },
  controlInputNames: stringArraySchema(),
  safeFlags: stringArraySchema(),
  executeFlags: stringArraySchema(),
  executeIntentRequired: { type: 'boolean' },
  executeIntentRequiredForLiveMode: { type: 'boolean' },
  requiredInputs: stringArraySchema(),
  mcpMutating: { type: 'boolean' },
  mcpLongRunningBlocked: { type: 'boolean' },
  riskLevel: { enum: ['low', 'medium', 'high', 'critical', null] },
  idempotency: { enum: ['idempotent', 'conditional', 'non-idempotent', null] },
  expectedLatencyMs: { type: ['number', 'null'], minimum: 0 },
  requiresSecrets: { type: 'boolean' },
  recommendedPreflightTool: { type: ['string', 'null'] },
  safeEquivalent: { type: ['string', 'null'] },
  externalDependencies: stringArraySchema(),
  canRunConcurrent: { type: 'boolean' },
  returnsOperationId: { type: 'boolean' },
  returnsRuntimeHandle: { type: 'boolean' },
  jobCapable: { type: 'boolean' },
  supportsRemote: { type: 'boolean' },
  remoteEligible: { type: 'boolean' },
  remoteTransportActive: { type: 'boolean' },
  remotePlanned: { type: 'boolean' },
  supportsWebhook: { type: 'boolean' },
  policyScopes: stringArraySchema(),
  emits: stringArraySchema(),
});

function inferArrayItemsSchema(values) {
  const items = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (!Array.isArray(value)) continue;
    items.push(...value);
  }

  const itemTypes = sortUniqueStrings(items.map(getJsonSchemaPrimitiveType).filter(Boolean));
  if (!itemTypes.length) {
    return {};
  }

  if (itemTypes.length === 1) {
    if (itemTypes[0] === 'string') {
      const enumValues = sortUniqueStrings(items);
      return enumValues.length > 0 && enumValues.length <= 12
        ? { type: 'string', enum: enumValues }
        : { type: 'string' };
    }
    if (itemTypes[0] === 'object') {
      return { type: 'object', additionalProperties: true };
    }
    return { type: itemTypes[0] };
  }

  return {
    oneOf: itemTypes.map((type) => {
      if (type === 'object') {
        return { type: 'object', additionalProperties: true };
      }
      return { type };
    }),
  };
}

function inferDescriptorFieldSchema(values) {
  const fieldTypes = sortUniqueStrings((Array.isArray(values) ? values : []).map(getJsonSchemaPrimitiveType).filter(Boolean));
  if (!fieldTypes.length) {
    return {};
  }

  if (fieldTypes.length === 1) {
    if (fieldTypes[0] === 'array') {
      return {
        type: 'array',
        items: inferArrayItemsSchema(values),
      };
    }
    if (fieldTypes[0] === 'object') {
      return { type: 'object', additionalProperties: true };
    }
    return { type: fieldTypes[0] };
  }

  if (fieldTypes.length === 2 && fieldTypes.includes('null')) {
    const nonNullType = fieldTypes.find((type) => type !== 'null');
    if (nonNullType === 'object') {
      return { type: ['object', 'null'], additionalProperties: true };
    }
    if (nonNullType === 'array') {
      return {
        type: ['array', 'null'],
        items: inferArrayItemsSchema(values),
      };
    }
    return { type: [nonNullType, 'null'] };
  }

  return {
    oneOf: fieldTypes.map((type) => {
      if (type === 'array') {
        return { type: 'array', items: inferArrayItemsSchema(values) };
      }
      if (type === 'object') {
        return { type: 'object', additionalProperties: true };
      }
      return { type };
    }),
  };
}

function hasDescriptorSignal(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return false;
}

function buildCommandDescriptorMetadata(commandDescriptors) {
  const descriptorList = Object.values(commandDescriptors || {});
  const fieldNames = sortUniqueStrings(descriptorList.flatMap((descriptor) => Object.keys(descriptor || {})));
  const requiredFields = fieldNames.filter((fieldName) =>
    descriptorList.every((descriptor) => Object.prototype.hasOwnProperty.call(descriptor || {}, fieldName)),
  );

  const counts = {};
  const capabilities = {};
  for (const fieldName of fieldNames) {
    const presentCount = descriptorList.filter((descriptor) =>
      Object.prototype.hasOwnProperty.call(descriptor || {}, fieldName),
    ).length;
    counts[fieldName] = presentCount;
    capabilities[fieldName] = presentCount > 0;
  }

  const properties = {};
  for (const fieldName of fieldNames) {
    properties[fieldName] =
      DESCRIPTOR_FIELD_SCHEMA_OVERRIDES[fieldName]
      || inferDescriptorFieldSchema(descriptorList.map((descriptor) => descriptor[fieldName]));
  }

  return {
    source: 'agent_contract_registry.buildCommandDescriptors',
    totalCommands: descriptorList.length,
    fieldNames,
    requiredFields,
    capabilities: Object.freeze(capabilities),
    counts,
    descriptorValueSchema: {
      type: 'object',
      required: requiredFields,
      properties,
      additionalProperties: false,
    },
  };
}

function buildSchemaHelpPayload() {
  const commandDescriptorMetadata = buildCommandDescriptorMetadata(sortObjectKeys(buildCommandDescriptors()));
  return {
    usage: 'pandora --output json schema',
    notes: [
      'Command descriptors and descriptor metadata are derived from the shared agent contract registry.',
    ],
    commandCount: commandDescriptorMetadata.totalCommands,
    descriptorFields: commandDescriptorMetadata.fieldNames,
    capabilities: commandDescriptorMetadata.capabilities,
  };
}

function buildSchemaPayload() {
  const commandDescriptors = sortObjectKeys(buildCommandDescriptors());
  const commandDescriptorMetadata = buildCommandDescriptorMetadata(commandDescriptors);
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'PandoraCliEnvelope',
    description:
      'The standard envelope format returned by the Pandora CLI in --output json mode. Exception: `pandora stream` emits NDJSON ticks directly instead of success/error envelopes.',
    type: 'object',
    oneOf: [
      { $ref: '#/definitions/SuccessEnvelope' },
      { $ref: '#/definitions/ErrorEnvelope' },
    ],
    commandDescriptorVersion: COMMAND_DESCRIPTOR_VERSION,
    descriptorScope: 'command-surface',
    commandDescriptors,
    commandDescriptorMetadata,
    capabilities: commandDescriptorMetadata.capabilities,
    definitions: {
      SuccessEnvelope: {
        type: 'object',
        required: ['ok', 'command', 'data'],
        properties: {
          ok: { type: 'boolean', const: true },
          command: { type: 'string', description: 'The CLI verb executed (e.g., "markets.list").' },
          data: {
            type: 'object',
            description: 'The primary payload.',
          },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ErrorEnvelope: {
        type: 'object',
        required: ['ok', 'error'],
        properties: {
          ok: { type: 'boolean', const: false },
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', description: 'A stable error code (e.g., "INVALID_USAGE").' },
              message: { type: 'string', description: 'Human-readable error explanation.' },
              details: { type: 'object', description: 'Contextual debugging metadata.' },
              recovery: { $ref: '#/definitions/ErrorRecoveryPayload' },
            },
          },
        },
      },
      ErrorRecoveryPayload: {
        type: 'object',
        required: ['action', 'command', 'retryable'],
        properties: {
          action: { type: 'string' },
          command: { type: 'string' },
          retryable: { type: 'boolean' },
        },
      },
      McpHelpPayload: {
        type: 'object',
        properties: {
          usage: { type: 'string' },
          notes: {
            oneOf: [
              {
                type: 'array',
                items: {
                  oneOf: [
                    { type: 'string' },
                    { type: 'object' },
                  ],
                },
              },
              { type: 'object' },
            ],
          },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
        additionalProperties: true,
      },
      CommandHelpPayload: {
        type: 'object',
        required: ['usage'],
        properties: {
          usage: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
          },
          notes: {
            oneOf: [
              {
                type: 'array',
                items: {
                  oneOf: [
                    { type: 'string' },
                    { type: 'object' },
                  ],
                },
              },
              { type: 'object' },
            ],
          },
          commandCount: { type: 'integer' },
          descriptorFields: { type: 'array', items: { type: 'string' } },
          capabilities: { $ref: '#/definitions/SchemaDescriptorCapabilities' },
          modeRouting: {
            type: 'object',
            properties: {
              jsonOnly: { type: 'array', items: { type: 'string' } },
              stdioOnly: { type: 'array', items: { type: 'string' } },
              scriptNative: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: false,
          },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
        additionalProperties: true,
      },
      CapabilitiesHelpPayload: {
        allOf: [
          { $ref: '#/definitions/CommandHelpPayload' },
          {
            type: 'object',
            required: ['commandDescriptorVersion'],
            properties: {
              commandDescriptorVersion: { type: 'string' },
            },
            additionalProperties: true,
          },
        ],
      },
      SchemaHelpPayload: {
        allOf: [
          { $ref: '#/definitions/CommandHelpPayload' },
          {
            type: 'object',
            required: ['commandCount', 'descriptorFields', 'capabilities'],
            properties: {
              commandCount: { type: 'integer' },
              descriptorFields: { type: 'array', items: { type: 'string' } },
              capabilities: { $ref: '#/definitions/SchemaDescriptorCapabilities' },
            },
            additionalProperties: true,
          },
        ],
      },
      OddsHelpPayload: {
        allOf: [
          { $ref: '#/definitions/CommandHelpPayload' },
          {
            type: 'object',
            properties: {
              historyUsage: { type: 'string' },
            },
            additionalProperties: true,
          },
        ],
      },
      MirrorStatusHelpPayload: {
        allOf: [
          { $ref: '#/definitions/CommandHelpPayload' },
          {
            type: 'object',
            properties: {
              polymarketEnv: {
                oneOf: [
                  { type: 'string' },
                  { type: 'array', items: { type: 'string' } },
                ],
              },
            },
            additionalProperties: true,
          },
        ],
      },
      SchemaDescriptorCapabilities: {
        type: 'object',
        properties: Object.fromEntries(
          commandDescriptorMetadata.fieldNames.map((fieldName) => [fieldName, { type: 'boolean' }]),
        ),
        required: [...commandDescriptorMetadata.fieldNames],
        additionalProperties: false,
      },
      CommandDescriptorMetadata: {
        type: 'object',
        required: [
          'source',
          'totalCommands',
          'fieldNames',
          'requiredFields',
          'capabilities',
          'counts',
          'descriptorValueSchema',
        ],
        properties: {
          source: { type: 'string' },
          totalCommands: { type: 'integer' },
          fieldNames: { type: 'array', items: { type: 'string' } },
          requiredFields: { type: 'array', items: { type: 'string' } },
          capabilities: { $ref: '#/definitions/SchemaDescriptorCapabilities' },
          counts: {
            type: 'object',
            properties: Object.fromEntries(
              commandDescriptorMetadata.fieldNames.map((fieldName) => [fieldName, { type: 'integer' }]),
            ),
            required: [...commandDescriptorMetadata.fieldNames],
            additionalProperties: false,
          },
          descriptorValueSchema: {
            type: 'object',
            required: ['type', 'required', 'properties', 'additionalProperties'],
            properties: {
              type: { const: 'object' },
              required: { type: 'array', items: { type: 'string' } },
              properties: { type: 'object', additionalProperties: true },
              additionalProperties: { const: false },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      GenericCommandData: {
        type: 'object',
        description: 'Fallback schema for command payloads without a dedicated descriptor.',
      },
      CapabilitiesPayload: {
        type: 'object',
        required: [
          'schemaVersion',
          'generatedAt',
          'title',
          'description',
          'source',
          'commandDescriptorVersion',
          'summary',
          'transports',
          'roadmapSignals',
          'policyProfiles',
          'operationProtocol',
          'versionCompatibility',
          'outputModeMatrix',
          'topLevelCommands',
          'namespaces',
          'canonicalTools',
          'commandDigests',
          'registryDigest',
        ],
        properties: {
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
          title: { type: 'string' },
          description: { type: 'string' },
          source: { type: 'string' },
          commandDescriptorVersion: { type: 'string' },
          summary: {
            type: 'object',
            required: [
              'totalCommands',
              'topLevelCommands',
              'aliases',
              'mcpExposedCommands',
              'mcpMutatingCommands',
              'mcpLongRunningBlockedCommands',
              'jsonOnlyCommands',
              'tableOnlyCommands',
              'tableAndJsonCommands',
            ],
            properties: {
              totalCommands: { type: 'integer' },
              topLevelCommands: { type: 'integer' },
              aliases: { type: 'integer' },
              mcpExposedCommands: { type: 'integer' },
              mcpMutatingCommands: { type: 'integer' },
              mcpLongRunningBlockedCommands: { type: 'integer' },
              jsonOnlyCommands: { type: 'integer' },
              tableOnlyCommands: { type: 'integer' },
              tableAndJsonCommands: { type: 'integer' },
            },
            additionalProperties: false,
          },
          transports: {
            type: 'object',
            required: ['cliJson', 'mcpStdio', 'mcpStreamableHttp', 'sdk'],
            properties: {
              cliJson: { $ref: '#/definitions/CapabilitiesTransport' },
              mcpStdio: { $ref: '#/definitions/CapabilitiesTransport' },
              mcpStreamableHttp: { $ref: '#/definitions/CapabilitiesTransport' },
              sdk: { $ref: '#/definitions/CapabilitiesTransport' },
            },
            additionalProperties: false,
          },
          roadmapSignals: {
            type: 'object',
            required: [
              'remoteEligibleCommands',
              'jobCapableCommands',
              'secretBearingCommands',
              'operationReadyCommands',
              'notes',
            ],
            properties: {
              remoteEligibleCommands: { type: 'integer' },
              jobCapableCommands: { type: 'integer' },
              secretBearingCommands: { type: 'integer' },
              operationReadyCommands: { type: 'integer' },
              notes: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: false,
          },
          policyProfiles: {
            type: 'object',
            required: ['policyPacks', 'signerProfiles'],
            properties: {
              policyPacks: { $ref: '#/definitions/CapabilitiesPolicyProfileSection' },
              signerProfiles: { $ref: '#/definitions/CapabilitiesSignerProfileSection' },
            },
            additionalProperties: false,
          },
          operationProtocol: {
            type: 'object',
            required: ['supported', 'status', 'notes', 'operationReadyCommands', 'jobCapableCommands'],
            properties: {
              supported: { type: 'boolean' },
              status: { enum: ['planned', 'partial'] },
              notes: { type: 'array', items: { type: 'string' } },
              operationReadyCommands: { type: 'array', items: { type: 'string' } },
              jobCapableCommands: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: false,
          },
          versionCompatibility: {
            type: 'object',
            required: [
              'commandDescriptorVersion',
              'schemaCommand',
              'capabilitiesCommand',
              'mcpTransport',
              'notes',
            ],
            properties: {
              commandDescriptorVersion: { type: 'string' },
              schemaCommand: { type: 'string' },
              capabilitiesCommand: { type: 'string' },
              mcpTransport: { type: 'string' },
              notes: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: false,
          },
          outputModeMatrix: {
            type: 'object',
            required: ['jsonOnly', 'tableOnly', 'tableAndJson'],
            properties: {
              jsonOnly: { type: 'array', items: { type: 'string' } },
              tableOnly: { type: 'array', items: { type: 'string' } },
              tableAndJson: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: false,
          },
          topLevelCommands: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              required: ['summary', 'usage', 'outputModes', 'childCommands', 'mcpExposed', 'canonicalTool', 'aliasOf', 'preferred'],
              properties: {
                summary: { type: ['string', 'null'] },
                usage: { type: ['string', 'null'] },
                outputModes: stringArraySchema(['json', 'table']),
                childCommands: { type: 'array', items: { type: 'string' } },
                mcpExposed: { type: 'boolean' },
                canonicalTool: { type: ['string', 'null'] },
                aliasOf: { type: ['string', 'null'] },
                preferred: { type: 'boolean' },
              },
              additionalProperties: false,
            },
          },
          namespaces: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              required: ['summary', 'usage', 'outputModes', 'commands', 'mcpExposedCommands'],
              properties: {
                summary: { type: ['string', 'null'] },
                usage: { type: ['string', 'null'] },
                outputModes: stringArraySchema(['json', 'table']),
                commands: { type: 'array', items: { type: 'string' } },
                mcpExposedCommands: { type: 'array', items: { type: 'string' } },
              },
              additionalProperties: false,
            },
          },
          canonicalTools: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              required: ['preferredCommand', 'commands'],
              properties: {
                preferredCommand: { type: 'string' },
                commands: { type: 'array', items: { type: 'string' } },
              },
              additionalProperties: false,
            },
          },
          commandDigests: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              required: Object.keys(CAPABILITIES_COMMAND_DIGEST_PROPERTIES),
              properties: CAPABILITIES_COMMAND_DIGEST_PROPERTIES,
              additionalProperties: false,
            },
          },
          registryDigest: {
            type: 'object',
            required: ['descriptorHash', 'commandDigestHash', 'canonicalHash', 'topLevelHash', 'namespaceHash'],
            properties: {
              descriptorHash: { type: 'string' },
              commandDigestHash: { type: 'string' },
              canonicalHash: { type: 'string' },
              topLevelHash: { type: 'string' },
              namespaceHash: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      CapabilitiesTransport: {
        type: 'object',
        required: ['supported', 'status', 'notes'],
        properties: {
          supported: { type: 'boolean' },
          status: { enum: ['active', 'inactive', 'planned'] },
          notes: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
      CapabilitiesPolicyProfileSection: {
        type: 'object',
        required: ['supported', 'status', 'notes', 'commandsWithPolicyScopes'],
        properties: {
          supported: { type: 'boolean' },
          status: { enum: ['active', 'planned'] },
          notes: { type: 'array', items: { type: 'string' } },
          commandsWithPolicyScopes: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
      CapabilitiesSignerProfileSection: {
        type: 'object',
        required: ['supported', 'status', 'notes', 'commandsRequiringSecrets'],
        properties: {
          supported: { type: 'boolean' },
          status: { enum: ['active', 'planned'] },
          notes: { type: 'array', items: { type: 'string' } },
          commandsRequiringSecrets: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
      AgentValidationAttestation: {
        type: 'object',
        properties: {
          validationTicket: { type: 'string' },
          validationDecision: { enum: ['PASS', 'FAIL'] },
          validationSummary: { type: 'string' },
          autocompleteTicket: { type: ['string', 'null'] },
        },
        required: ['validationTicket', 'validationDecision', 'validationSummary'],
        additionalProperties: true,
      },
      AgentMarketPromptPayload: {
        type: 'object',
        properties: {
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
          promptKind: { type: 'string' },
          promptVersion: { type: 'string' },
          ticket: { type: ['string', 'null'] },
          input: { type: 'object' },
          prompt: { type: 'string' },
          workflow: { type: 'object' },
          requiredAttestation: {
            oneOf: [
              { $ref: '#/definitions/AgentValidationAttestation' },
              { type: 'null' },
            ],
          },
        },
        additionalProperties: true,
      },
      VersionPayload: {
        type: 'object',
        properties: {
          version: { type: 'string' },
          packageName: { type: ['string', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
        additionalProperties: true,
      },
      InitEnvPayload: {
        type: 'object',
        properties: {
          targetPath: { type: ['string', 'null'] },
          examplePath: { type: ['string', 'null'] },
          force: { type: ['boolean', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
        additionalProperties: true,
      },
      DoctorPayload: {
        type: 'object',
        properties: {
          report: { type: 'object' },
          checks: { type: 'object' },
          diagnostics: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'object' }] } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
        additionalProperties: true,
      },
      SetupPayload: {
        type: 'object',
        properties: {
          action: { type: ['string', 'null'] },
          envFile: { type: ['string', 'null'] },
          doctor: { type: ['object', 'null'] },
          diagnostics: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'object' }] } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
        additionalProperties: true,
      },
      SportsBooksPayload: {
        type: 'object',
        properties: {
          provider: { type: 'string' },
          requestedBooks: { type: ['array', 'null'], items: { type: 'string' } },
          books: { type: ['array', 'null'], items: { type: 'string' } },
          health: { type: 'object' },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SportsEventsPayload: {
        type: 'object',
        properties: {
          provider: { type: 'string' },
          mode: { type: 'string' },
          count: { type: 'integer' },
          events: { type: 'array', items: { type: 'object' } },
          marketType: { type: 'string' },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SportsOddsPayload: {
        type: 'object',
        properties: {
          provider: { type: 'string' },
          mode: { type: 'string' },
          event: { type: 'object' },
          books: { type: 'array', items: { type: 'object' } },
          bestOdds: { type: 'object' },
          source: { type: 'object' },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SportsConsensusPayload: {
        type: 'object',
        properties: {
          eventId: { type: ['string', 'null'] },
          method: { type: 'string' },
          source: { type: 'object' },
          diagnostics: { type: 'array', items: { type: 'string' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SportsCreatePayload: {
        type: 'object',
        properties: {
          event: { type: 'object' },
          source: { type: 'object' },
          timing: { type: 'object' },
          marketTemplate: { type: 'object' },
          mechanics: { type: 'object' },
          safety: { type: 'object' },
          deployment: { type: ['object', 'null'] },
          mode: { type: ['string', 'null'] },
          runtime: { type: ['object', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SportsSyncPayload: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          mode: { type: 'string' },
          status: { type: 'string' },
          found: { type: ['boolean', 'null'] },
          alive: { type: 'boolean' },
            pid: { type: ['number', 'null'] },
            pidFile: { type: ['string', 'null'] },
            strategyHash: { type: ['string', 'null'] },
            operationId: { type: ['string', 'null'] },
            metadata: { type: ['object', 'null'] },
          cadence: { type: ['object', 'null'] },
          autoPause: { type: ['object', 'null'] },
          diagnostics: { type: 'array', items: { type: 'object' } },
          event: { type: ['object', 'null'] },
          source: { type: ['object', 'null'] },
          runtime: { type: ['object', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SportsResolvePlanPayload: {
        type: 'object',
        properties: {
          policy: { type: 'object' },
          safeToResolve: { type: 'boolean' },
          recommendedAnswer: { type: ['string', 'null'] },
          recommendedCommand: { type: ['string', 'null'] },
          checksAnalyzed: { type: 'integer' },
          stableWindowStartAt: { type: ['string', 'null'] },
          settleDelaySatisfied: { type: 'boolean' },
          checks: { type: 'array', items: { type: 'object' } },
          unsafeDiagnostics: { type: 'array', items: { type: 'object' } },
          diagnostics: { type: 'array', items: { type: 'object' } },
          timing: { type: ['object', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      HelpPayload: {
        allOf: [
          { $ref: '#/definitions/CommandHelpPayload' },
          {
            type: 'object',
            properties: {
              globalFlags: {
                type: 'object',
                additionalProperties: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
          },
        ],
      },
      QuotePayload: {
        type: 'object',
        required: ['marketAddress', 'side', 'mode'],
        properties: {
          indexerUrl: { type: ['string', 'null'] },
          marketAddress: { type: 'string' },
          marketType: { type: ['string', 'null'] },
          mode: { enum: ['buy', 'sell'] },
          side: { enum: ['yes', 'no'] },
          amountUsdc: { type: ['number', 'null'] },
          amount: { type: ['number', 'null'] },
          slippageBps: { type: ['integer', 'null'] },
          quoteAvailable: { type: ['boolean', 'null'] },
          odds: { type: 'object' },
          estimate: { type: ['object', 'null'] },
          curve: { type: 'array', items: { type: 'object' } },
          liquidity: { type: ['object', 'null'] },
          parimutuel: { type: ['object', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
        additionalProperties: true,
      },
      TradePayload: {
        type: 'object',
        required: ['mode', 'marketAddress', 'side'],
        properties: {
          mode: { enum: ['dry-run', 'execute'] },
          action: { enum: ['buy', 'sell'] },
          status: { type: 'string' },
          runtime: { type: ['object', 'null'] },
          chainId: { type: ['integer', 'null'] },
          marketAddress: { type: 'string' },
          marketType: { type: ['string', 'null'] },
          tradeSignature: { type: ['string', 'null'] },
          buySignature: { type: ['string', 'null'] },
          sellSignature: { type: ['string', 'null'] },
          ammDeadlineEpoch: { type: ['string', 'null'] },
          side: { enum: ['yes', 'no'] },
          amountUsdc: { type: ['number', 'null'] },
          amount: { type: ['number', 'null'] },
          amountRaw: { type: ['string', 'null'] },
          minSharesOutRaw: { type: ['string', 'null'] },
          minAmountOutRaw: { type: ['string', 'null'] },
          selectedProbabilityPct: { type: ['number', 'null'] },
          quote: { type: 'object' },
          executionPlan: { type: 'object' },
          riskGuards: { type: 'object' },
          preview: { type: ['object', 'null'] },
          account: { type: ['string', 'null'] },
          usdc: { type: ['string', 'null'] },
          approvalAsset: { type: ['string', 'null'] },
          tradeTxHash: { type: ['string', 'null'] },
          tradeTxUrl: { type: ['string', 'null'] },
          tradeGasEstimate: { type: ['string', 'null'] },
          tradeStatus: { type: ['string', 'null'] },
          buyTxHash: { type: ['string', 'null'] },
          buyTxUrl: { type: ['string', 'null'] },
          buyGasEstimate: { type: ['string', 'null'] },
          buyStatus: { type: ['string', 'null'] },
          sellTxHash: { type: ['string', 'null'] },
          sellTxUrl: { type: ['string', 'null'] },
          sellGasEstimate: { type: ['string', 'null'] },
          sellStatus: { type: ['string', 'null'] },
          approveTxHash: { type: ['string', 'null'] },
          approveTxUrl: { type: ['string', 'null'] },
          approveGasEstimate: { type: ['string', 'null'] },
          approveStatus: { type: ['string', 'null'] },
          finalStatus: { type: ['string', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
        additionalProperties: true,
      },
      LpPayload: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          mode: { type: 'string' },
          runtime: { type: ['object', 'null'] },
          status: { type: ['string', 'null'] },
          marketAddress: { type: ['string', 'null'] },
          wallet: { type: ['string', 'null'] },
          count: { type: ['integer', 'null'] },
          successCount: { type: ['integer', 'null'] },
          failureCount: { type: ['integer', 'null'] },
          txPlan: { type: ['object', 'null'] },
          preflight: { type: ['object', 'null'] },
          tx: { type: ['object', 'null'] },
          items: { type: ['array', 'null'], items: { type: 'object' } },
          diagnostics: { type: ['array', 'null'], items: { type: 'string' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ResolvePayload: {
        type: 'object',
        properties: {
          mode: { enum: ['dry-run', 'execute'] },
          status: { type: 'string' },
          runtime: { type: ['object', 'null'] },
          pollAddress: { type: ['string', 'null'] },
          answer: { type: ['string', 'null'] },
          reason: { type: ['string', 'null'] },
          txPlan: { type: ['object', 'null'] },
          precheck: { type: ['object', 'null'] },
          tx: { type: ['object', 'null'] },
          diagnostics: { type: ['array', 'null'], items: { type: 'string' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ClaimPayload: {
        type: 'object',
        properties: {
          mode: { type: 'string' },
          runtime: { type: ['object', 'null'] },
          status: { type: ['string', 'null'] },
          action: { type: ['string', 'null'] },
          marketAddress: { type: ['string', 'null'] },
          wallet: { type: ['string', 'null'] },
          pollAddress: { type: ['string', 'null'] },
          claimable: { type: ['boolean', 'null'] },
          resolution: { type: ['object', 'null'] },
          txPlan: { type: ['object', 'null'] },
          preflight: { type: ['object', 'null'] },
          tx: { type: ['object', 'null'] },
          count: { type: ['integer', 'null'] },
          successCount: { type: ['integer', 'null'] },
          failureCount: { type: ['integer', 'null'] },
          items: { type: ['array', 'null'], items: { type: 'object' } },
          diagnostics: { type: ['array', 'null'], items: { type: 'string' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      WatchPayload: {
        type: 'object',
        properties: {
          count: { type: 'integer' },
          alertCount: { type: 'integer' },
          snapshots: { type: 'array', items: { type: 'object' } },
          alerts: { type: 'array', items: { type: 'object' } },
          parameters: { type: 'object' },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      PortfolioPayload: {
        type: 'object',
        properties: {
          indexerUrl: { type: 'string' },
          wallet: { type: 'string' },
          chainId: { type: ['integer', 'null'] },
          limit: { type: ['integer', 'null'] },
          withLp: { type: 'boolean' },
          summary: { type: 'object' },
          positions: { type: 'array', items: { type: 'object' } },
          lpPositions: { type: 'array', items: { type: 'object' } },
          events: { type: ['array', 'null'], items: { type: 'object' } },
          diagnostics: { type: 'array', items: { type: 'string' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      HistoryPayload: {
        type: 'object',
        properties: {
          wallet: { type: ['string', 'null'] },
          count: { type: ['integer', 'null'] },
          items: { type: ['array', 'null'], items: { type: 'object' } },
          pagination: { type: ['object', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
        additionalProperties: true,
      },
      ExportPayload: {
        type: 'object',
        properties: {
          format: { enum: ['csv', 'json'] },
          wallet: { type: 'string' },
          chainId: { type: ['integer', 'null'] },
          count: { type: 'integer' },
          filters: { type: 'object' },
          columns: { type: 'array', items: { type: 'string' } },
          outPath: { type: ['string', 'null'] },
          rows: { type: 'array', items: { type: 'object' } },
          content: { type: ['string', 'array'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      LifecyclePayload: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          phase: { type: 'string' },
          phases: { type: 'array', items: { type: 'string' } },
          history: { type: 'array', items: { type: 'object' } },
          changed: { type: ['boolean', 'null'] },
          createdAt: { type: ['string', 'null'], format: 'date-time' },
          updatedAt: { type: ['string', 'null'], format: 'date-time' },
          resolvedAt: { type: ['string', 'null'], format: 'date-time' },
          lifecycleDir: { type: ['string', 'null'] },
          filePath: { type: ['string', 'null'] },
          configPath: { type: ['string', 'null'] },
          configDigest: { type: ['string', 'null'] },
          config: { type: ['object', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ArbitragePayload: {
        type: 'object',
        properties: {
          parameters: { type: 'object' },
          count: { type: ['integer', 'null'] },
          opportunities: { type: ['array', 'null'], items: { type: 'object' } },
          diagnostics: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'object' }] } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
        additionalProperties: true,
      },
      OddsRecordPayload: {
        type: 'object',
        properties: {
          action: { const: 'record' },
          competition: { type: 'string' },
          eventId: { type: ['string', 'null'] },
          intervalSec: { type: 'number' },
          maxSamples: { type: 'integer' },
          venues: { type: 'array', items: { type: 'string' } },
          backend: { type: 'string' },
          storage: { type: 'object' },
          insertedTotal: { type: 'integer' },
          samples: { type: 'array', items: { type: 'object' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      PolymarketPayload: {
        type: 'object',
        properties: {
          runtime: { type: ['object', 'null'] },
          approvals: { type: ['object', 'null'] },
          tx: { type: ['object', 'null'] },
          mode: { type: ['string', 'null'] },
          diagnostics: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'object' }] } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
        additionalProperties: true,
      },
      WebhookPayload: {
        type: 'object',
        properties: {
          count: { type: ['integer', 'null'] },
          failureCount: { type: ['integer', 'null'] },
          deliveries: { type: ['array', 'null'], items: { type: 'object' } },
          diagnostics: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'object' }] } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
        additionalProperties: true,
      },
      AnalyzePayload: {
        type: 'object',
        properties: {
          provider: { type: ['string', 'null'] },
          result: { type: ['object', 'null'] },
          diagnostics: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'object' }] } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
        additionalProperties: true,
      },
      SuggestPayload: {
        type: 'object',
        properties: {
          wallet: { type: ['string', 'null'] },
          risk: { type: ['string', 'null'] },
          items: { type: ['array', 'null'], items: { type: 'object' } },
          diagnostics: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'object' }] } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
        additionalProperties: true,
      },
      OddsHistoryPayload: {
        type: 'object',
        properties: {
          action: { const: 'history' },
          eventId: { type: 'string' },
          output: { enum: ['json', 'csv'] },
          backend: { type: 'string' },
          storage: { type: 'object' },
          count: { type: 'integer' },
          items: { type: 'array', items: { type: 'object' } },
          csv: { type: ['string', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ArbScanPayload: {
        type: 'object',
        properties: {
          action: { const: 'scan' },
          indexerUrl: { type: 'string' },
          iterationsCompleted: { type: 'integer' },
          requestedIterations: { type: ['integer', 'null'] },
          intervalMs: { type: 'integer' },
          filters: { type: 'object' },
          opportunities: { type: 'array', items: { type: 'object' } },
          diagnostics: { type: 'array', items: { type: 'string' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SimulateMcPayload: {
        type: 'object',
        properties: {
          inputs: { type: 'object' },
          summary: { type: 'object' },
          distribution: { type: 'object' },
          diagnostics: { type: 'array', items: { type: ['string', 'object'] } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SimulateParticleFilterPayload: {
        type: 'object',
        properties: {
          inputs: { type: 'object' },
          summary: { type: 'object' },
          trajectory: { type: 'array', items: { type: 'object' } },
          diagnostics: { type: 'array', items: { type: ['string', 'object'] } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SimulateAgentsPayload: {
        type: 'object',
        properties: {
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
          parameters: { type: 'object' },
          convergenceError: { type: 'number' },
          spreadTrajectory: { type: 'array', items: { type: 'object' } },
          volume: { type: 'object' },
          pnlByAgentType: { type: 'object' },
          finalState: { type: 'object' },
          runtimeBounds: { type: 'object' },
        },
      },
      ModelScoreBrierPayload: {
        type: 'object',
        properties: {
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
          action: { const: 'score.brier' },
          filters: { type: 'object' },
          ledger: { type: 'object' },
          report: { type: 'object' },
          diagnostics: { type: 'array', items: { type: ['string', 'object'] } },
        },
      },
      ModelCalibratePayload: {
        type: 'object',
        properties: {
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
          action: { const: 'calibrate' },
          model: { type: 'object' },
          diagnostics: { type: 'object' },
          persistence: { type: 'object' },
        },
      },
      ModelCorrelationPayload: {
        type: 'object',
        properties: {
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
          action: { const: 'correlation' },
          copula: { type: 'object' },
          metrics: { type: 'object' },
          stress: { type: 'object' },
          comparisons: { type: 'array', items: { type: 'object' } },
          diagnostics: { type: 'object' },
          model: { type: 'object' },
          persistence: { type: 'object' },
        },
      },
      ModelDiagnosePayload: {
        type: 'object',
        properties: {
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
          inputs: { type: 'object' },
          components: { type: 'object' },
          aggregate: { type: 'object' },
          recommendations: { type: 'object' },
          flags: { type: 'object' },
          diagnostics: { type: 'array', items: { type: ['string', 'object'] } },
        },
      },
      StreamTickPayload: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          ts: { type: 'string', format: 'date-time' },
          seq: { type: 'integer' },
          channel: { enum: ['prices', 'events'] },
          source: { type: 'object' },
          data: { type: 'object' },
        },
      },
      PagedEntityPayload: {
        type: 'object',
        properties: {
          count: { type: 'integer' },
          items: { type: 'array', items: { type: 'object' } },
          pageInfo: { type: ['object', 'null'] },
          pagination: { type: ['object', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      EntityCollectionPayload: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'object' } },
          count: { type: 'integer' },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      MirrorBrowsePayload: {
        type: 'object',
        properties: {
          source: { type: 'string' },
          gammaApiError: { type: ['string', 'null'] },
          filters: { type: 'object' },
          count: { type: 'integer' },
          items: { type: 'array', items: { type: 'object' } },
          diagnostics: { type: 'array', items: { type: 'string' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      MirrorPlanPayload: {
        type: 'object',
        properties: {
          sourceMarket: { type: 'object' },
          timing: { type: 'object' },
          liquidityRecommendation: { type: 'object' },
          distributionHint: { type: 'object' },
          rules: { type: 'object' },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      MirrorDeployPayload: {
        type: 'object',
        properties: {
          mode: { enum: ['dry-run', 'execute'] },
          planDigest: { type: ['string', 'null'] },
          deploymentArgs: { type: ['object', 'null'] },
          timing: { type: ['object', 'null'] },
          dryRun: { type: ['boolean', 'null'] },
          requiredValidation: { type: ['object', 'null'] },
          agentValidation: { type: ['object', 'null'] },
          pandora: { type: 'object' },
          sourceMarket: { type: 'object' },
          postDeployChecks: { type: ['object', 'null'] },
          trustManifest: { type: ['object', 'null'] },
          diagnostics: { type: 'array', items: { type: 'string' } },
          tx: { type: ['object', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      MirrorVerifyPayload: {
        type: 'object',
        properties: {
          matchConfidence: { type: ['number', 'null'] },
          gateResult: { type: 'object' },
          similarity: { type: 'object' },
          ruleHashLeft: { type: ['string', 'null'] },
          ruleHashRight: { type: ['string', 'null'] },
          ruleDiffSummary: { type: 'object' },
          expiry: { type: 'object' },
          pandora: { type: 'object' },
          sourceMarket: { type: 'object' },
          diagnostics: { type: 'array', items: { type: 'string' } },
          strictGate: { type: 'object' },
          confidence: { type: ['number', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      MirrorSyncPayload: {
        type: 'object',
        properties: {
          mode: { type: 'string' },
          executeLive: { type: 'boolean' },
          strategyHash: { type: ['string', 'null'] },
          stateFile: { type: ['string', 'null'] },
          killSwitchFile: { type: ['string', 'null'] },
          parameters: { type: 'object' },
          state: { type: ['object', 'null'] },
          actionCount: { type: 'integer' },
          actions: { type: 'array', items: { type: 'object' } },
          snapshots: { type: 'array', items: { type: 'object' } },
          webhookReports: { type: 'array', items: { type: 'object' } },
          iterationsRequested: { type: ['integer', 'null'] },
          iterationsCompleted: { type: 'integer' },
          stoppedReason: { type: ['string', 'null'] },
            pid: { type: ['integer', 'null'] },
            pidFile: { type: ['string', 'null'] },
            logFile: { type: ['string', 'null'] },
            operationId: { type: ['string', 'null'] },
            alive: { type: ['boolean', 'null'] },
          status: { type: ['string', 'null'] },
          metadata: { type: ['object', 'null'] },
          diagnostics: { type: 'array', items: { type: 'string' } },
          schemaVersion: { type: 'string' },
          stateSchemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      MirrorClosePayload: {
        type: 'object',
        properties: {
          mode: { enum: ['dry-run', 'execute'] },
          target: { type: 'object' },
          pandoraMarketAddress: { type: ['string', 'null'] },
          polymarketMarketId: { type: ['string', 'null'] },
          polymarketSlug: { type: ['string', 'null'] },
          steps: { type: 'array', items: { type: 'object' } },
          summary: { type: 'object' },
          diagnostics: { type: 'array', items: { type: 'string' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      MirrorHedgeCalcPayload: {
        type: 'object',
        properties: {
          inputs: { type: 'object' },
          metrics: { type: 'object' },
          scenarios: { type: 'array', items: { type: 'object' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      AutopilotPayload: {
        type: 'object',
        properties: {
          mode: { enum: ['once', 'run'] },
          status: { type: 'string' },
          trigger: { type: ['object', 'null'] },
          action: { type: ['object', 'null'] },
          state: { type: ['object', 'null'] },
          diagnostics: { type: 'array', items: { type: 'string' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      LeaderboardPayload: {
        type: 'object',
        properties: {
          metric: { enum: ['profit', 'volume', 'win-rate'] },
          count: { type: 'integer' },
          items: { type: 'array', items: { type: 'object' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      RiskPayload: {
        type: 'object',
        properties: {
          action: { type: ['string', 'null'] },
          changed: { type: ['boolean', 'null'] },
          riskFile: { type: 'string' },
          panic: { type: 'object' },
          guardrails: { type: 'object' },
          counters: { type: 'object' },
          stopFiles: { type: 'array', items: { type: 'string' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      OperationPayload: {
        type: 'object',
        properties: {
          operationId: { type: 'string' },
          operationHash: { type: ['string', 'null'] },
          tool: { type: ['string', 'null'] },
          action: { type: ['string', 'null'] },
          command: { type: ['string', 'null'] },
          summary: { type: ['string', 'null'] },
          status: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          policyPack: { type: ['string', 'null'] },
          profile: { type: ['string', 'null'] },
          environment: { type: ['string', 'null'] },
          mode: { type: ['string', 'null'] },
          scope: { type: ['string', 'null'] },
          cancelable: { type: 'boolean' },
          closable: { type: 'boolean' },
          input: { type: 'object' },
          normalizedInput: { type: 'object' },
          checkpoints: { type: 'array', items: { type: 'object' } },
          metadata: { type: 'object' },
          result: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
          recovery: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
          error: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
          validatedAt: { type: ['string', 'null'], format: 'date-time' },
          queuedAt: { type: ['string', 'null'], format: 'date-time' },
          startedAt: { type: ['string', 'null'], format: 'date-time' },
          completedAt: { type: ['string', 'null'], format: 'date-time' },
          failedAt: { type: ['string', 'null'], format: 'date-time' },
          canceledAt: { type: ['string', 'null'], format: 'date-time' },
          closedAt: { type: ['string', 'null'], format: 'date-time' },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      OperationListPayload: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { $ref: '#/definitions/OperationPayload' } },
          count: { type: 'integer' },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SchemaCommandPayload: {
        type: 'object',
        required: [
          '$schema',
          'title',
          'description',
          'type',
          'oneOf',
          'commandDescriptorVersion',
          'descriptorScope',
          'commandDescriptors',
          'commandDescriptorMetadata',
          'capabilities',
          'definitions',
        ],
        properties: {
          $schema: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          type: { const: 'object' },
          oneOf: { type: 'array', items: { type: 'object' } },
          commandDescriptorVersion: { type: 'string' },
          descriptorScope: { enum: ['command-surface'] },
          commandDescriptors: {
            type: 'object',
            additionalProperties: commandDescriptorMetadata.descriptorValueSchema,
          },
          commandDescriptorMetadata: { $ref: '#/definitions/CommandDescriptorMetadata' },
          capabilities: { $ref: '#/definitions/SchemaDescriptorCapabilities' },
          definitions: { type: 'object' },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
        additionalProperties: false,
      },
    },
  };
}

function createRunSchemaCommand(deps) {
  const { emitSuccess, CliError } = deps;

  if (typeof emitSuccess !== 'function') {
    throw new Error('createRunSchemaCommand requires emitSuccess');
  }

  function runSchemaCommand(args, context) {
    if (Array.isArray(args) && (args.includes('--help') || args.includes('-h'))) {
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'schema.help', buildSchemaHelpPayload());
      } else {
        // eslint-disable-next-line no-console
        console.log('Usage: pandora --output json schema');
        // eslint-disable-next-line no-console
        console.log('');
        // eslint-disable-next-line no-console
        console.log('Notes:');
        // eslint-disable-next-line no-console
        console.log('  - schema payload is available only in --output json mode.');
      }
      return;
    }

    if (context.outputMode !== 'json') {
      throw new CliError('INVALID_USAGE', 'The schema command is only supported in --output json mode.', {
        hints: ['Run `pandora --output json schema`'],
      });
    }

    if (Array.isArray(args) && args.length > 0) {
      throw new CliError('INVALID_ARGS', 'schema does not accept additional flags or positional arguments.', {
        hints: ['Run `pandora --output json schema` without extra arguments.'],
      });
    }

    emitSuccess(context.outputMode, 'schema', buildSchemaPayload());
  }

  return { runSchemaCommand };
}

module.exports = {
  createRunSchemaCommand,
};
