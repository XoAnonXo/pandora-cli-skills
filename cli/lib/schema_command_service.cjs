/**
 * Implements the `schema` command to output standard JSON interfaces for Agent ingestion.
 */

const {
  buildCommandDescriptors,
  COMMAND_DESCRIPTOR_VERSION,
} = require('./agent_contract_registry.cjs');
const { buildTrustDistributionMetadata } = require('./capabilities_command_service.cjs');
const { buildSkillDocIndex } = require('./skill_doc_registry.cjs');
const COMPATIBILITY_FLAG = '--include-compatibility';
const COMPATIBILITY_QUERY_PARAM = 'include_aliases=1';
const COMPATIBILITY_MODE_HINT = 'Compatibility aliases are hidden by default. Pass --include-compatibility or include_aliases=1 only for legacy/debug workflows.';

function compareStableStrings(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

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
  for (const key of Object.keys(source).sort(compareStableStrings)) {
    sorted[key] = source[key];
  }
  return sorted;
}

function countCompatibilityAliases(commandDescriptors) {
  return Object.values(commandDescriptors || {}).filter((descriptor) => descriptor && descriptor.aliasOf).length;
}

function countCanonicalToolsWithCompatibilityAliases(commandDescriptors) {
  const canonicalTools = new Set();
  for (const descriptor of Object.values(commandDescriptors || {})) {
    if (!(descriptor && descriptor.aliasOf)) continue;
    if (typeof descriptor.canonicalTool === 'string' && descriptor.canonicalTool.trim()) {
      canonicalTools.add(descriptor.canonicalTool.trim());
    }
  }
  return canonicalTools.size;
}

function buildDiscoveryPreferences(allCommandDescriptors, visibleCommandDescriptors, options = {}) {
  const totalAliasCount = countCompatibilityAliases(allCommandDescriptors);
  const visibleAliasCount = countCompatibilityAliases(visibleCommandDescriptors);
  return {
    canonicalOnlyDefault: true,
    includeCompatibility: Boolean(options && options.includeCompatibility),
    aliasesHiddenByDefault: true,
    compatibilityFlag: COMPATIBILITY_FLAG,
    compatibilityQueryParam: COMPATIBILITY_QUERY_PARAM,
    compatibilityModeHint: COMPATIBILITY_MODE_HINT,
    visibleCommandCount: Object.keys(visibleCommandDescriptors || {}).length,
    totalAliasCount,
    hiddenAliasCount: Math.max(totalAliasCount - visibleAliasCount, 0),
    canonicalToolsWithCompatibilityAliases: countCanonicalToolsWithCompatibilityAliases(allCommandDescriptors),
  };
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
  const commandDescriptorMetadata = buildCommandDescriptorMetadata(filterVisibleCommandDescriptors(buildCommandDescriptors()));
  return {
    usage: 'pandora --output json schema [--include-compatibility]',
    notes: [
      'Command descriptors and descriptor metadata are derived from the shared agent contract registry.',
      'Mirror accounting rollout is anchored on the existing `mirror audit` and `mirror pnl` descriptors; descriptor text distinguishes current approximate/operator outputs from the intended reconciled ledger-grade surfaces.',
      'By default schema returns canonical command descriptors only. Pass --include-compatibility to include compatibility aliases for legacy/debug workflows.',
    ],
    commandCount: commandDescriptorMetadata.totalCommands,
    descriptorFields: commandDescriptorMetadata.fieldNames,
    capabilities: commandDescriptorMetadata.capabilities,
  };
}

function filterVisibleCommandDescriptors(commandDescriptors, options = {}) {
  const includeCompatibility = Boolean(
    options
    && (options.includeCompatibility === true || options.includeAllTools === true),
  );
  const entries = Object.entries(commandDescriptors || {}).filter(([, descriptor]) =>
    includeCompatibility || !(descriptor && descriptor.aliasOf),
  );
  return sortObjectKeys(Object.fromEntries(entries));
}

function buildSchemaPayload(options = {}) {
  const allCommandDescriptors = sortObjectKeys(buildCommandDescriptors());
  const includeCompatibility = Boolean(
    options
    && (options.includeCompatibility === true || options.includeAllTools === true),
  );
  const commandDescriptors = filterVisibleCommandDescriptors(allCommandDescriptors, { includeCompatibility });
  const commandDescriptorMetadata = buildCommandDescriptorMetadata(allCommandDescriptors);
  const discoveryPreferences = buildDiscoveryPreferences(allCommandDescriptors, commandDescriptors, { includeCompatibility });
  const trustDistribution = buildTrustDistributionMetadata();
  const documentation = buildSkillDocIndex();
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
    descriptorScope: includeCompatibility ? 'command-surface+compatibility' : 'canonical-command-surface',
    discoveryPreferences,
    commandDescriptors,
    commandDescriptorMetadata,
    capabilities: commandDescriptorMetadata.capabilities,
    documentation,
    trustDistribution,
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
      TrustDistributionPayload: {
        type: 'object',
        required: ['schemaVersion', 'posture', 'notes', 'distribution', 'verification', 'releaseGates'],
        properties: {
          schemaVersion: { type: 'string' },
          posture: { enum: ['repo-release-gates-and-published-surface-observed'] },
          notes: { type: 'array', items: { type: 'string' } },
          distribution: { $ref: '#/definitions/TrustDistributionSection' },
          verification: { $ref: '#/definitions/TrustVerificationSection' },
          releaseGates: { $ref: '#/definitions/TrustReleaseGateSection' },
        },
        additionalProperties: false,
      },
      TrustDistributionSection: {
        type: 'object',
        required: ['rootPackage', 'generatedContractArtifacts', 'embeddedSdks', 'platformValidation', 'signals'],
        properties: {
          rootPackage: { $ref: '#/definitions/TrustDistributionRootPackage' },
          generatedContractArtifacts: { $ref: '#/definitions/TrustGeneratedContractArtifacts' },
          embeddedSdks: { $ref: '#/definitions/TrustEmbeddedSdks' },
          platformValidation: { $ref: '#/definitions/TrustPlatformValidation' },
          signals: { $ref: '#/definitions/TrustDistributionSignals' },
        },
        additionalProperties: false,
      },
      TrustDistributionRootPackage: {
        type: 'object',
        required: ['name', 'version', 'main', 'binNames', 'exportSubpaths', 'filesAllowlist'],
        properties: {
          name: { type: ['string', 'null'] },
          version: { type: ['string', 'null'] },
          main: { type: ['string', 'null'] },
          binNames: { type: 'array', items: { type: 'string' } },
          exportSubpaths: { type: 'array', items: { type: 'string' } },
          filesAllowlist: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
      TrustGeneratedContractArtifacts: {
        type: 'object',
        required: [
          'shipped',
          'manifestPath',
          'bundlePath',
          'commandDescriptorsPath',
          'mcpToolDefinitionsPath',
          'artifactVersion',
        ],
        properties: {
          shipped: { type: 'boolean' },
          manifestPath: { type: 'string' },
          bundlePath: { type: 'string' },
          commandDescriptorsPath: { type: 'string' },
          mcpToolDefinitionsPath: { type: 'string' },
          artifactVersion: { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
      TrustEmbeddedSdks: {
        type: 'object',
        required: ['typescript', 'python'],
        properties: {
          typescript: { $ref: '#/definitions/TrustTypescriptSdkDistribution' },
          python: { $ref: '#/definitions/TrustPythonSdkDistribution' },
        },
        additionalProperties: false,
      },
      TrustTypescriptSdkDistribution: {
        type: 'object',
        required: ['shipped', 'packagePath', 'packageName', 'version', 'exportSubpaths'],
        properties: {
          shipped: { type: 'boolean' },
          packagePath: { type: 'string' },
          packageName: { type: ['string', 'null'] },
          version: { type: ['string', 'null'] },
          exportSubpaths: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
      TrustPythonSdkDistribution: {
        type: 'object',
        required: ['shipped', 'projectPath', 'packageName', 'version'],
        properties: {
          shipped: { type: 'boolean' },
          projectPath: { type: 'string' },
          packageName: { type: ['string', 'null'] },
          version: { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
      TrustPlatformValidation: {
        type: 'object',
        required: ['ci', 'release'],
        properties: {
          ci: { $ref: '#/definitions/TrustPlatformValidationCi' },
          release: { $ref: '#/definitions/TrustPlatformValidationRelease' },
        },
        additionalProperties: false,
      },
      TrustPlatformValidationCi: {
        type: 'object',
        required: ['workflowPath', 'present', 'osMatrix', 'nodeVersions'],
        properties: {
          workflowPath: { type: 'string' },
          present: { type: 'boolean' },
          osMatrix: { type: 'array', items: { type: 'string' } },
          nodeVersions: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
      TrustPlatformValidationRelease: {
        type: 'object',
        required: ['workflowPath', 'present', 'osMatrix'],
        properties: {
          workflowPath: { type: 'string' },
          present: { type: 'boolean' },
          osMatrix: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
      TrustDistributionSignals: {
        type: 'object',
        required: [
          'explicitFilesAllowlist',
          'shipsBenchmarks',
          'shipsBenchmarkReport',
          'shipsBenchmarkHarness',
          'shipsBenchmarkDocs',
          'shipsSkillDocs',
          'shipsTrustDocs',
          'shipsGeneratedSdk',
          'shipsTypescriptSdk',
          'shipsPythonSdk',
          'shipsWorkflowMetadata',
          'shipsReleaseTrustScripts',
          'exportsGeneratedSdk',
          'exportsTypescriptSdk',
        ],
        properties: {
          explicitFilesAllowlist: { type: 'boolean' },
          shipsBenchmarks: { type: 'boolean' },
          shipsBenchmarkReport: { type: 'boolean' },
          shipsBenchmarkHarness: { type: 'boolean' },
          shipsBenchmarkDocs: { type: 'boolean' },
          shipsSkillDocs: { type: 'boolean' },
          shipsTrustDocs: { type: 'boolean' },
          shipsGeneratedSdk: { type: 'boolean' },
          shipsTypescriptSdk: { type: 'boolean' },
          shipsPythonSdk: { type: 'boolean' },
          shipsWorkflowMetadata: { type: 'boolean' },
          shipsReleaseTrustScripts: { type: 'boolean' },
          exportsGeneratedSdk: { type: 'boolean' },
          exportsTypescriptSdk: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      TrustVerificationSection: {
        type: 'object',
        required: ['provenance', 'benchmark', 'releaseAssets', 'releaseWorkflow', 'ciWorkflow', 'smoke', 'scripts', 'signals'],
        properties: {
          provenance: { enum: ['repository-files-and-release-workflow'] },
          benchmark: { $ref: '#/definitions/TrustBenchmarkVerification' },
          releaseAssets: { $ref: '#/definitions/TrustReleaseAssetsVerification' },
          releaseWorkflow: {
            type: 'object',
            required: ['path', 'present'],
            properties: {
              path: { type: 'string' },
              present: { type: 'boolean' },
            },
            additionalProperties: false,
          },
          ciWorkflow: {
            type: 'object',
            required: ['path', 'present', 'osMatrix', 'nodeVersions'],
            properties: {
              path: { type: 'string' },
              present: { type: 'boolean' },
              osMatrix: { type: 'array', items: { type: 'string' } },
              nodeVersions: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: false,
          },
          smoke: { $ref: '#/definitions/TrustSmokeVerification' },
          scripts: { $ref: '#/definitions/TrustVerificationScripts' },
          signals: { $ref: '#/definitions/TrustVerificationSignals' },
        },
        additionalProperties: false,
      },
      TrustReleaseAssetsVerification: {
        type: 'object',
        required: ['names', 'verificationMethods'],
        properties: {
          names: { type: 'array', items: { type: 'string' } },
          verificationMethods: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
      TrustBenchmarkVerification: {
        type: 'object',
        required: [
          'suite',
          'lockPath',
          'lockPresent',
          'reportPath',
          'reportPresent',
          'bundlePath',
          'bundlePresent',
          'historyPath',
          'historyPresent',
          'docsHistoryPath',
          'docsHistoryPresent',
          'reportOverallPass',
          'reportContractLockMatchesExpected',
          'checkScriptPath',
          'checkScriptPresent',
          'runScriptPath',
          'runScriptPresent',
          'checkCommand',
        ],
        properties: {
          suite: { type: 'string' },
          lockPath: { type: 'string' },
          lockPresent: { type: 'boolean' },
          reportPath: { type: 'string' },
          reportPresent: { type: 'boolean' },
          bundlePath: { type: 'string' },
          bundlePresent: { type: 'boolean' },
          historyPath: { type: 'string' },
          historyPresent: { type: 'boolean' },
          docsHistoryPath: { type: 'string' },
          docsHistoryPresent: { type: 'boolean' },
          reportOverallPass: { type: ['boolean', 'null'] },
          reportContractLockMatchesExpected: { type: ['boolean', 'null'] },
          checkScriptPath: { type: 'string' },
          checkScriptPresent: { type: 'boolean' },
          runScriptPath: { type: 'string' },
          runScriptPresent: { type: 'boolean' },
          checkCommand: { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
      TrustSmokeVerification: {
        type: 'object',
        required: ['command', 'testPaths'],
        properties: {
          command: { type: ['string', 'null'] },
          testPaths: {
            type: 'array',
            items: { $ref: '#/definitions/TrustPathPresence' },
          },
        },
        additionalProperties: false,
      },
      TrustPathPresence: {
        type: 'object',
        required: ['path', 'present'],
        properties: {
          path: { type: 'string' },
          present: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      TrustVerificationScripts: {
        type: 'object',
        required: [
          'build',
          'prepack',
          'prepublishOnly',
          'test',
          'testUnit',
          'testCli',
          'testAgentWorkflow',
          'testSmoke',
          'benchmarkCheck',
          'checkSdkContracts',
          'checkDocs',
          'generateSbom',
          'checkReleaseTrust',
          'releasePrep',
        ],
        properties: {
          build: { type: ['string', 'null'] },
          prepack: { type: ['string', 'null'] },
          prepublishOnly: { type: ['string', 'null'] },
          test: { type: ['string', 'null'] },
          testUnit: { type: ['string', 'null'] },
          testCli: { type: ['string', 'null'] },
          testAgentWorkflow: { type: ['string', 'null'] },
          testSmoke: { type: ['string', 'null'] },
          benchmarkCheck: { type: ['string', 'null'] },
          checkSdkContracts: { type: ['string', 'null'] },
          checkDocs: { type: ['string', 'null'] },
          generateSbom: { type: ['string', 'null'] },
          checkReleaseTrust: { type: ['string', 'null'] },
          releasePrep: { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
      TrustVerificationSignals: {
        type: 'object',
        required: [
          'buildRunsDocsCheck',
          'buildRunsReleaseTrustCheck',
          'buildRunsSdkContractCheck',
          'buildRunsBenchmarkCheck',
          'prepackRunsDocsCheck',
          'prepackRunsReleaseTrustCheck',
          'prepackRunsSdkContractCheck',
          'prepackRunsBenchmarkCheck',
          'prepublishOnlyRunsTest',
          'testRunsUnit',
          'testRunsCli',
          'testRunsAgentWorkflow',
          'testRunsSmoke',
          'testRunsBenchmarkCheck',
          'smokeTestsPresent',
          'trustDocsPresent',
          'benchmarkReportPresent',
          'benchmarkReportPass',
          'benchmarkReportContractLockMatch',
          'releaseWorkflowPresent',
          'releasePrepRunsSbom',
          'releasePrepRunsSpdxSbom',
          'releasePrepRunsBenchmarkCheck',
          'releasePrepRunsTrustCheck',
        ],
        properties: {
          buildRunsDocsCheck: { type: 'boolean' },
          buildRunsReleaseTrustCheck: { type: 'boolean' },
          buildRunsSdkContractCheck: { type: 'boolean' },
          buildRunsBenchmarkCheck: { type: 'boolean' },
          prepackRunsDocsCheck: { type: 'boolean' },
          prepackRunsReleaseTrustCheck: { type: 'boolean' },
          prepackRunsSdkContractCheck: { type: 'boolean' },
          prepackRunsBenchmarkCheck: { type: 'boolean' },
          prepublishOnlyRunsTest: { type: 'boolean' },
          testRunsUnit: { type: 'boolean' },
          testRunsCli: { type: 'boolean' },
          testRunsAgentWorkflow: { type: 'boolean' },
          testRunsSmoke: { type: 'boolean' },
          testRunsBenchmarkCheck: { type: 'boolean' },
          smokeTestsPresent: { type: 'boolean' },
          trustDocsPresent: { type: 'boolean' },
          benchmarkReportPresent: { type: 'boolean' },
          benchmarkReportPass: { type: 'boolean' },
          benchmarkReportContractLockMatch: { type: 'boolean' },
          releaseWorkflowPresent: { type: 'boolean' },
          releasePrepRunsSbom: { type: 'boolean' },
          releasePrepRunsSpdxSbom: { type: 'boolean' },
          releasePrepRunsBenchmarkCheck: { type: 'boolean' },
          releasePrepRunsTrustCheck: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      TrustReleaseGateSection: {
        type: 'object',
        required: ['source', 'notes', 'commands', 'signals'],
        properties: {
          source: { enum: ['repository-package-scripts-and-release-workflow'] },
          notes: { type: 'array', items: { type: 'string' } },
          commands: { $ref: '#/definitions/TrustReleaseGateCommands' },
          signals: { $ref: '#/definitions/TrustReleaseGateSignals' },
        },
        additionalProperties: false,
      },
      TrustReleaseGateCommands: {
        type: 'object',
        required: ['test', 'releasePrep'],
        properties: {
          test: { type: ['string', 'null'] },
          releasePrep: { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
      TrustReleaseGateSignals: {
        type: 'object',
        required: [
          'workflowRunsNpmTest',
          'workflowRunsReleasePrep',
          'repoTestRunsSmoke',
          'repoTestRunsBenchmarkCheck',
          'repoReleasePrepRunsSmoke',
          'repoReleasePrepRunsBenchmarkCheck',
          'repoReleasePrepRunsSbom',
          'repoReleasePrepRunsSpdxSbom',
          'repoReleasePrepRunsReleaseTrust',
          'publishedReleasePrepRunsSmoke',
          'publishedSmokeCommandExposed',
          'packagedSmokeFixturesPresent',
        ],
        properties: {
          workflowRunsNpmTest: { type: 'boolean' },
          workflowRunsReleasePrep: { type: 'boolean' },
          repoTestRunsSmoke: { type: 'boolean' },
          repoTestRunsBenchmarkCheck: { type: 'boolean' },
          repoReleasePrepRunsSmoke: { type: 'boolean' },
          repoReleasePrepRunsBenchmarkCheck: { type: 'boolean' },
          repoReleasePrepRunsSbom: { type: 'boolean' },
          repoReleasePrepRunsSpdxSbom: { type: 'boolean' },
          repoReleasePrepRunsReleaseTrust: { type: 'boolean' },
          publishedReleasePrepRunsSmoke: { type: 'boolean' },
          publishedSmokeCommandExposed: { type: 'boolean' },
          packagedSmokeFixturesPresent: { type: 'boolean' },
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
          'recommendedFirstCall',
          'discoveryPreferences',
          'readinessMode',
          'summary',
          'transports',
          'roadmapSignals',
          'certification',
          'trustDistribution',
          'policyProfiles',
          'principalTemplates',
          'operationProtocol',
          'versionCompatibility',
          'documentation',
          'outputModeMatrix',
          'topLevelCommands',
          'routedTopLevelCommands',
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
          recommendedFirstCall: { type: 'string' },
          discoveryPreferences: { $ref: '#/definitions/DiscoveryPreferences' },
          readinessMode: { enum: ['artifact-neutral', 'runtime-local'] },
          summary: {
            type: 'object',
            required: [
              'totalCommands',
              'discoveryCommands',
              'topLevelCommands',
              'aliases',
              'mcpExposedCommands',
              'mcpMutatingCommands',
              'mcpLongRunningBlockedCommands',
              'jsonOnlyCommands',
              'tableOnlyCommands',
              'tableAndJsonCommands',
              'routedTopLevelCommands',
            ],
            properties: {
              totalCommands: { type: 'integer' },
              discoveryCommands: { type: 'integer' },
              topLevelCommands: { type: 'integer' },
              routedTopLevelCommands: { type: 'integer' },
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
          gateway: { $ref: '#/definitions/CapabilitiesGatewayDetails' },
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
          certification: { $ref: '#/definitions/CapabilitiesCertificationPayload' },
          trustDistribution: { $ref: '#/definitions/TrustDistributionPayload' },
          policyProfiles: {
            type: 'object',
            required: ['policyPacks', 'signerProfiles'],
            properties: {
              policyPacks: { $ref: '#/definitions/CapabilitiesPolicyProfileSection' },
              signerProfiles: { $ref: '#/definitions/CapabilitiesSignerProfileSection' },
            },
            additionalProperties: false,
          },
          principalTemplates: { $ref: '#/definitions/CapabilitiesPrincipalTemplateSection' },
          operationProtocol: {
            type: 'object',
            required: [
              'supported',
              'status',
              'notes',
              'operationReadyCommands',
              'jobCapableCommands',
              'receiptCommands',
              'receiptCommandsSupported',
              'receiptVerificationSupported',
              'receiptIntegrityModel',
              'receiptSignatureAlgorithm',
              'signedReceipts',
            ],
            properties: {
              supported: { type: 'boolean' },
              status: { enum: ['planned', 'partial'] },
              notes: { type: 'array', items: { type: 'string' } },
              operationReadyCommands: { type: 'array', items: { type: 'string' } },
              jobCapableCommands: { type: 'array', items: { type: 'string' } },
              receiptCommands: { type: 'array', items: { type: 'string' } },
              receiptCommandsSupported: { type: 'boolean' },
              receiptVerificationSupported: { type: 'boolean' },
              receiptIntegrityModel: { enum: ['hash-and-signature-verified-json'] },
              receiptSignatureAlgorithm: { type: 'string', enum: ['ed25519'] },
              signedReceipts: { type: 'boolean' },
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
          documentation: {
            $ref: '#/definitions/SkillDocIndex',
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
              required: ['outputModes', 'childCommands', 'mcpExposed', 'callableViaMcp', 'hasMcpChildren', 'canonicalTool', 'aliasOf', 'preferred'],
              properties: {
                outputModes: stringArraySchema(['json', 'table']),
                childCommands: { type: 'array', items: { type: 'string' } },
                mcpExposed: { type: 'boolean' },
                callableViaMcp: { type: 'boolean' },
                hasMcpChildren: { type: 'boolean' },
                canonicalTool: { type: ['string', 'null'] },
                aliasOf: { type: ['string', 'null'] },
                preferred: { type: 'boolean' },
              },
              additionalProperties: false,
            },
          },
          routedTopLevelCommands: {
            type: 'array',
            items: { type: 'string' },
          },
          namespaces: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              required: ['commands', 'mcpExposedCommands'],
              properties: {
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
              required: ['preferredCommand', 'commands', 'compatibilityAliasCount', 'compatibilityIncluded'],
              properties: {
                preferredCommand: { type: 'string' },
                commands: { type: 'array', items: { type: 'string' } },
                compatibilityAliasCount: { type: 'integer' },
                compatibilityIncluded: { type: 'boolean' },
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
            required: ['descriptorHash', 'commandDigestHash', 'canonicalHash', 'topLevelHash', 'routedTopLevelHash', 'namespaceHash', 'documentationHash', 'policyProfilesHash', 'principalTemplatesHash', 'trustDistributionHash'],
            properties: {
              descriptorHash: { type: 'string' },
              fullDescriptorHash: { type: 'string' },
              commandDigestHash: { type: 'string' },
              canonicalHash: { type: 'string' },
              topLevelHash: { type: 'string' },
              routedTopLevelHash: { type: 'string' },
              namespaceHash: { type: 'string' },
              documentationHash: { type: 'string' },
              policyProfilesHash: { type: 'string' },
              principalTemplatesHash: { type: 'string' },
              trustDistributionHash: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      SkillDocIndex: {
        type: 'object',
        required: ['version', 'contentHash', 'sourceFiles', 'router', 'skills'],
        properties: {
          version: { type: 'string' },
          contentHash: { type: 'string' },
          sourceFiles: { type: 'array', items: { type: 'string' } },
          router: { $ref: '#/definitions/SkillDocRouter' },
          skills: {
            type: 'array',
            items: { $ref: '#/definitions/SkillDocEntry' },
          },
        },
        additionalProperties: false,
      },
      SkillDocRouter: {
        type: 'object',
        required: ['title', 'path', 'summary', 'contentHash', 'startHere', 'taskRoutes'],
        properties: {
          title: { type: 'string' },
          path: { type: 'string' },
          summary: { type: 'string' },
          contentHash: { type: 'string' },
          startHere: {
            type: 'array',
            items: { $ref: '#/definitions/SkillDocRoute' },
          },
          taskRoutes: {
            type: 'array',
            items: { $ref: '#/definitions/SkillDocRoute' },
          },
        },
        additionalProperties: false,
      },
      SkillDocRoute: {
        type: 'object',
        required: ['label', 'docId', 'path', 'title', 'summary', 'order'],
        properties: {
          label: { type: 'string' },
          docId: { type: 'string' },
          path: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          order: { type: 'integer', minimum: 1 },
        },
        additionalProperties: false,
      },
      SkillDocEntry: {
        type: 'object',
        required: ['id', 'path', 'title', 'summary', 'audience', 'kind', 'featured', 'tags', 'canonicalTools', 'order', 'contentHash'],
        properties: {
          id: { type: 'string' },
          path: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          audience: { enum: ['agent', 'operator', 'mixed'] },
          kind: { enum: ['routing', 'quickstart', 'contract', 'workflow', 'reference', 'trust'] },
          featured: { type: 'boolean' },
          tags: { type: 'array', items: { type: 'string' } },
          canonicalTools: { type: 'array', items: { type: 'string' } },
          order: { type: 'integer', minimum: 1 },
          contentHash: { type: 'string' },
        },
        additionalProperties: false,
      },
      CapabilitiesTransport: {
        type: 'object',
        required: ['supported', 'status', 'notes'],
        properties: {
          supported: { type: 'boolean' },
          status: { enum: ['active', 'inactive', 'planned', 'alpha', 'beta'] },
          notes: { type: 'array', items: { type: 'string' } },
          recommendedBootstrapCommand: { type: ['string', 'null'] },
          endpoint: { type: ['string', 'null'] },
          deploymentModel: { type: ['string', 'null'] },
          publicManagedService: { type: ['boolean', 'null'] },
          operatorDocsPath: { type: ['string', 'null'] },
          operatorDocsPresent: { type: ['boolean', 'null'] },
          operationsApiAvailable: { type: ['boolean', 'null'] },
          webhookSupport: { type: ['boolean', 'null'] },
          packages: {
            type: 'object',
            required: ['typescript', 'python'],
            properties: {
              typescript: { $ref: '#/definitions/CapabilitiesSdkPackageDescriptor' },
              python: { $ref: '#/definitions/CapabilitiesSdkPackageDescriptor' },
            },
            additionalProperties: false,
          },
          generatedBundle: { $ref: '#/definitions/CapabilitiesSdkGeneratedBundle' },
        },
        additionalProperties: false,
      },
      APlusCertificationCheck: {
        type: 'object',
        required: ['id', 'title', 'status', 'expectation', 'actual', 'reason', 'evidencePaths', 'remediationCommands'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          status: { enum: ['pass', 'fail', 'not-evaluable'] },
          expectation: { type: 'string' },
          actual: { type: 'object' },
          reason: { type: 'string' },
          evidencePaths: { type: 'array', items: { type: 'string' } },
          remediationCommands: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
      APlusCertificationPayload: {
        type: 'object',
        required: [
          'targetTier',
          'status',
          'eligible',
          'readinessMode',
          'passCount',
          'failCount',
          'notEvaluableCount',
          'blockingCheckIds',
          'blockers',
          'nextCommands',
          'notes',
          'checks',
        ],
        properties: {
          targetTier: { const: 'A+' },
          status: { enum: ['certified', 'not-certified', 'not-evaluable'] },
          eligible: { type: 'boolean' },
          readinessMode: { enum: ['artifact-neutral', 'runtime-local'] },
          passCount: { type: 'integer', minimum: 0 },
          failCount: { type: 'integer', minimum: 0 },
          notEvaluableCount: { type: 'integer', minimum: 0 },
          blockingCheckIds: { type: 'array', items: { type: 'string' } },
          blockers: { type: 'array', items: { type: 'string' } },
          nextCommands: { type: 'array', items: { type: 'string' } },
          notes: { type: 'array', items: { type: 'string' } },
          checks: { type: 'array', items: { $ref: '#/definitions/APlusCertificationCheck' } },
        },
        additionalProperties: false,
      },
      CapabilitiesCertificationPayload: {
        type: 'object',
        required: ['aPlus'],
        properties: {
          aPlus: { $ref: '#/definitions/APlusCertificationPayload' },
        },
        additionalProperties: false,
      },
      DiscoveryPreferences: {
        type: 'object',
        required: [
          'canonicalOnlyDefault',
          'includeCompatibility',
          'aliasesHiddenByDefault',
          'compatibilityFlag',
          'compatibilityQueryParam',
          'compatibilityModeHint',
          'visibleCommandCount',
          'totalAliasCount',
          'hiddenAliasCount',
          'canonicalToolsWithCompatibilityAliases',
        ],
        properties: {
          canonicalOnlyDefault: { type: 'boolean' },
          includeCompatibility: { type: 'boolean' },
          aliasesHiddenByDefault: { type: 'boolean' },
          compatibilityFlag: { type: 'string' },
          compatibilityQueryParam: { type: 'string' },
          compatibilityModeHint: { type: 'string' },
          visibleCommandCount: { type: 'integer' },
          totalAliasCount: { type: 'integer' },
          hiddenAliasCount: { type: 'integer' },
          canonicalToolsWithCompatibilityAliases: { type: 'integer' },
        },
        additionalProperties: false,
      },
      BootstrapPrincipal: {
        type: 'object',
        required: ['id', 'grantedScopes', 'authRequired', 'transport', 'remoteTransportActive', 'remoteTransportUrl'],
        properties: {
          id: { type: ['string', 'null'] },
          grantedScopes: { type: 'array', items: { type: 'string' } },
          authRequired: { type: 'boolean' },
          transport: { enum: ['cli-json', 'mcp-http'] },
          remoteTransportActive: { type: 'boolean' },
          remoteTransportUrl: { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
      BootstrapPreferences: {
        type: 'object',
        required: [
          'canonicalOnlyDefault',
          'includeCompatibility',
          'aliasesHiddenByDefault',
          'compatibilityFlag',
          'compatibilityQueryParam',
          'compatibilityModeHint',
          'visibleCommandCount',
          'totalAliasCount',
          'hiddenAliasCount',
          'canonicalToolsWithCompatibilityAliases',
          'recommendedFirstCall',
        ],
        properties: {
          canonicalOnlyDefault: { type: 'boolean' },
          includeCompatibility: { type: 'boolean' },
          aliasesHiddenByDefault: { type: 'boolean' },
          compatibilityFlag: { type: 'string' },
          compatibilityQueryParam: { type: 'string' },
          compatibilityModeHint: { type: 'string' },
          visibleCommandCount: { type: 'integer' },
          totalAliasCount: { type: 'integer' },
          hiddenAliasCount: { type: 'integer' },
          canonicalToolsWithCompatibilityAliases: { type: 'integer' },
          recommendedFirstCall: { type: 'string' },
        },
        additionalProperties: false,
      },
      BootstrapNextCall: {
        type: 'object',
        required: ['tool', 'cliCommand', 'httpUrl', 'via', 'reason'],
        properties: {
          tool: { type: 'string' },
          cliCommand: { type: 'string' },
          httpUrl: { type: ['string', 'null'] },
          via: { type: 'string' },
          reason: { type: 'string' },
        },
        additionalProperties: false,
      },
      BootstrapTrustSummary: {
        type: ['object', 'null'],
        properties: {
          posture: { type: ['string', 'null'] },
          notes: { type: 'array', items: { type: 'string' } },
          verificationSignals: { type: ['object', 'null'], additionalProperties: true },
          releaseGateSignals: { type: ['object', 'null'], additionalProperties: true },
        },
        additionalProperties: false,
      },
      BootstrapDefaults: {
        type: 'object',
        required: ['policyId', 'profileId', 'mode'],
        properties: {
          policyId: { type: ['string', 'null'] },
          profileId: { type: ['string', 'null'] },
          mode: { type: 'string' },
        },
        additionalProperties: false,
      },
      BootstrapSummarySection: {
        type: 'object',
        required: ['recommendedStartingMode', 'totalCommands', 'canonicalToolCount', 'starterToolCount', 'policyCount', 'profileCount', 'recipeCount', 'remoteTransportStatus'],
        properties: {
          recommendedStartingMode: { type: 'string' },
          totalCommands: { type: ['integer', 'null'] },
          canonicalToolCount: { type: 'integer' },
          starterToolCount: { type: 'integer' },
          policyCount: { type: 'integer' },
          profileCount: { type: 'integer' },
          recipeCount: { type: 'integer' },
          remoteTransportStatus: { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
      BootstrapCapabilitiesSummary: {
        type: 'object',
        required: ['totalCommands', 'topLevelCommands', 'routedTopLevelCommands', 'mcpExposedCommands', 'transports', 'registryDigest'],
        properties: {
          totalCommands: { type: ['integer', 'null'] },
          topLevelCommands: { type: ['integer', 'null'] },
          routedTopLevelCommands: { type: ['integer', 'null'] },
          mcpExposedCommands: { type: ['integer', 'null'] },
          transports: {
            type: 'object',
            required: ['cliJson', 'mcpStdio', 'mcpStreamableHttp', 'sdk'],
            properties: {
              cliJson: { type: ['string', 'null'] },
              mcpStdio: { type: ['string', 'null'] },
              mcpStreamableHttp: { type: ['string', 'null'] },
              sdk: { type: ['string', 'null'] },
            },
            additionalProperties: false,
          },
          registryDigest: {
            type: 'object',
            required: ['descriptorHash', 'documentationHash'],
            properties: {
              descriptorHash: { type: ['string', 'null'] },
              fullDescriptorHash: { type: ['string', 'null'] },
              documentationHash: { type: ['string', 'null'] },
            },
            additionalProperties: true,
          },
        },
        additionalProperties: false,
      },
      BootstrapSchemaSummary: {
        type: 'object',
        required: ['commandCount', 'descriptorFieldCount', 'descriptorFieldsSample'],
        properties: {
          commandCount: { type: ['integer', 'null'] },
          descriptorFieldCount: { type: 'integer' },
          descriptorFieldsSample: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
      BootstrapDocItem: {
        type: 'object',
        required: ['id', 'path', 'title', 'summary', 'kind', 'canonicalTools'],
        properties: {
          id: { type: 'string' },
          path: { type: 'string' },
          title: { type: 'string' },
          summary: { type: ['string', 'null'] },
          kind: { type: ['string', 'null'] },
          canonicalTools: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
      BootstrapDocumentationSummary: {
        type: 'object',
        required: ['routerPath', 'routerTitle', 'contentHash', 'items'],
        properties: {
          routerPath: { type: ['string', 'null'] },
          routerTitle: { type: ['string', 'null'] },
          contentHash: { type: ['string', 'null'] },
          items: { type: 'array', items: { $ref: '#/definitions/BootstrapDocItem' } },
        },
        additionalProperties: false,
      },
      BootstrapPolicyItem: {
        type: 'object',
        required: ['id', 'displayName', 'description', 'source', 'extends'],
        properties: {
          id: { type: 'string' },
          displayName: { type: ['string', 'null'] },
          description: { type: ['string', 'null'] },
          source: { type: ['string', 'null'] },
          extends: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
      BootstrapPolicySummary: {
        type: 'object',
        required: ['count', 'builtinCount', 'userCount', 'recommendedReadOnlyPolicyId', 'recommendedMutablePolicyId', 'items'],
        properties: {
          count: { type: 'integer' },
          builtinCount: { type: 'integer' },
          userCount: { type: 'integer' },
          recommendedReadOnlyPolicyId: { type: ['string', 'null'] },
          recommendedMutablePolicyId: { type: ['string', 'null'] },
          items: { type: 'array', items: { $ref: '#/definitions/BootstrapPolicyItem' } },
        },
        additionalProperties: false,
      },
      BootstrapProfileItem: {
        type: 'object',
        required: ['id', 'displayName', 'signerBackend', 'readOnly', 'builtin', 'source', 'defaultPolicy', 'allowedPolicies', 'runtimeReady', 'resolutionStatus', 'backendImplemented'],
        properties: {
          id: { type: 'string' },
          displayName: { type: ['string', 'null'] },
          signerBackend: { type: ['string', 'null'] },
          readOnly: { type: 'boolean' },
          builtin: { type: 'boolean' },
          source: { type: ['string', 'null'] },
          defaultPolicy: { type: ['string', 'null'] },
          allowedPolicies: { type: 'array', items: { type: 'string' } },
          runtimeReady: { type: 'boolean' },
          resolutionStatus: { type: ['string', 'null'] },
          backendImplemented: { type: ['boolean', 'null'] },
        },
        additionalProperties: false,
      },
      BootstrapProfileSummary: {
        type: 'object',
        required: ['count', 'builtInCount', 'fileCount', 'recommendedReadOnlyProfileId', 'recommendedMutableProfileId', 'readyBuiltinCount', 'readyMutableBuiltinCount', 'items'],
        properties: {
          count: { type: 'integer' },
          builtInCount: { type: 'integer' },
          fileCount: { type: 'integer' },
          recommendedReadOnlyProfileId: { type: ['string', 'null'] },
          recommendedMutableProfileId: { type: ['string', 'null'] },
          readyBuiltinCount: { type: 'integer' },
          readyMutableBuiltinCount: { type: 'integer' },
          items: { type: 'array', items: { $ref: '#/definitions/BootstrapProfileItem' } },
        },
        additionalProperties: false,
      },
      BootstrapRecipeItem: {
        type: 'object',
        required: ['id', 'displayName', 'description', 'summary', 'tool', 'defaultPolicy', 'defaultProfile', 'approvalStatus', 'riskLevel', 'mutating', 'safeByDefault', 'operationExpected', 'supportsRemote', 'source', 'origin'],
        properties: {
          id: { type: 'string' },
          displayName: { type: ['string', 'null'] },
          description: { type: ['string', 'null'] },
          summary: { type: ['string', 'null'] },
          tool: { type: ['string', 'null'] },
          defaultPolicy: { type: ['string', 'null'] },
          defaultProfile: { type: ['string', 'null'] },
          approvalStatus: { type: ['string', 'null'] },
          riskLevel: { type: ['string', 'null'] },
          mutating: { type: 'boolean' },
          safeByDefault: { type: 'boolean' },
          operationExpected: { type: 'boolean' },
          supportsRemote: { type: 'boolean' },
          source: { type: ['string', 'null'] },
          origin: { type: ['string', 'null'] },
          docs: { type: ['string', 'null'] },
          benchmark: { type: ['string', 'null'] },
          tags: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
      BootstrapRecipeSummary: {
        type: 'object',
        required: ['count', 'builtinCount', 'userCount', 'safeByDefaultCount', 'operationExpectedCount', 'sourceCounts', 'approvalStatusCounts', 'riskLevelCounts', 'appliedFilters', 'items'],
        properties: {
          count: { type: 'integer' },
          builtinCount: { type: 'integer' },
          userCount: { type: 'integer' },
          safeByDefaultCount: { type: 'integer' },
          operationExpectedCount: { type: 'integer' },
          sourceCounts: { type: ['object', 'null'], additionalProperties: { type: 'integer' } },
          approvalStatusCounts: { type: ['object', 'null'], additionalProperties: { type: 'integer' } },
          riskLevelCounts: { type: ['object', 'null'], additionalProperties: { type: 'integer' } },
          appliedFilters: {
            type: ['object', 'null'],
            properties: {
              source: { type: ['string', 'null'] },
              approvalStatus: { type: ['string', 'null'] },
              riskLevel: { type: ['string', 'null'] },
            },
            additionalProperties: false,
          },
          items: { type: 'array', items: { $ref: '#/definitions/BootstrapRecipeItem' } },
        },
        additionalProperties: false,
      },
      BootstrapSdkSummary: {
        type: 'object',
        required: ['status', 'notes', 'generatedBundle', 'packages'],
        properties: {
          status: { type: ['string', 'null'] },
          notes: { type: 'array', items: { type: 'string' } },
          recommendedBootstrapCommand: { type: ['string', 'null'] },
          generatedBundle: {
            oneOf: [{ $ref: '#/definitions/CapabilitiesSdkGeneratedBundle' }, { type: 'null' }],
          },
          packages: {
            type: 'object',
            required: ['typescript', 'python'],
            properties: {
              typescript: { oneOf: [{ $ref: '#/definitions/CapabilitiesSdkPackageDescriptor' }, { type: 'null' }] },
              python: { oneOf: [{ $ref: '#/definitions/CapabilitiesSdkPackageDescriptor' }, { type: 'null' }] },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      BootstrapToolSummary: {
        type: 'object',
        required: ['command', 'canonicalTool', 'aliasOf', 'summary', 'usage', 'outputModes', 'policyScopes', 'requiresSecrets', 'recommendedPreflightTool', 'safeEquivalent', 'supportsRemote'],
        properties: {
          command: { type: 'string' },
          canonicalTool: { type: ['string', 'null'] },
          aliasOf: { type: ['string', 'null'] },
          summary: { type: ['string', 'null'] },
          usage: { type: ['string', 'null'] },
          outputModes: { type: 'array', items: { type: 'string' } },
          policyScopes: { type: 'array', items: { type: 'string' } },
          requiresSecrets: { type: 'boolean' },
          recommendedPreflightTool: { type: ['string', 'null'] },
          safeEquivalent: { type: ['string', 'null'] },
          supportsRemote: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      BootstrapWarning: {
        type: 'object',
        required: ['code', 'severity', 'message'],
        properties: {
          code: { type: 'string' },
          severity: { type: 'string' },
          message: { type: 'string' },
          profileIds: { type: 'array', items: { type: 'string' } },
          nextStepCommand: { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
      BootstrapNextStep: {
        type: 'object',
        required: ['id', 'type', 'title', 'reason'],
        properties: {
          id: { type: 'string' },
          type: { type: 'string' },
          title: { type: 'string' },
          command: { type: ['string', 'null'] },
          path: { type: ['string', 'null'] },
          reason: { type: 'string' },
        },
        additionalProperties: false,
      },
      BootstrapPayload: {
        type: 'object',
        required: [
          'schemaVersion',
          'generatedAt',
          'title',
          'description',
          'source',
          'commandDescriptorVersion',
          'readinessMode',
          'principal',
          'preferences',
          'defaults',
          'summary',
          'capabilities',
          'schema',
          'documentation',
          'policies',
          'profiles',
          'recipes',
          'sdk',
          'canonicalTools',
          'includedToolCommands',
          'recommendedBootstrapFlow',
          'tools',
          'warnings',
          'nextSteps',
        ],
        properties: {
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
          title: { type: 'string' },
          description: { type: 'string' },
          source: { type: 'string' },
          commandDescriptorVersion: { type: 'string' },
          readinessMode: { enum: ['artifact-neutral', 'runtime-local'] },
          principal: { $ref: '#/definitions/BootstrapPrincipal' },
          preferences: { $ref: '#/definitions/BootstrapPreferences' },
          defaults: { $ref: '#/definitions/BootstrapDefaults' },
          summary: { $ref: '#/definitions/BootstrapSummarySection' },
          capabilities: { $ref: '#/definitions/BootstrapCapabilitiesSummary' },
          schema: { $ref: '#/definitions/BootstrapSchemaSummary' },
          documentation: { $ref: '#/definitions/BootstrapDocumentationSummary' },
          policies: { $ref: '#/definitions/BootstrapPolicySummary' },
          profiles: { $ref: '#/definitions/BootstrapProfileSummary' },
          recipes: { $ref: '#/definitions/BootstrapRecipeSummary' },
          sdk: { $ref: '#/definitions/BootstrapSdkSummary' },
          canonicalTools: { type: 'array', items: { type: 'string' } },
          includedToolCommands: { type: 'array', items: { type: 'string' } },
          recommendedBootstrapFlow: { type: 'array', items: { type: 'string' } },
          tools: { type: 'array', items: { $ref: '#/definitions/BootstrapToolSummary' } },
          warnings: { type: 'array', items: { $ref: '#/definitions/BootstrapWarning' } },
          nextSteps: { type: 'array', items: { $ref: '#/definitions/BootstrapNextStep' } },
        },
        additionalProperties: false,
      },
      CapabilitiesGatewayDetails: {
        type: 'object',
        required: [
          'bootstrapPath',
          'capabilitiesPath',
          'healthPath',
          'readyPath',
          'metricsPath',
          'mcpPath',
          'schemaPath',
          'toolsPath',
          'authPath',
          'operationsPath',
          'operationsReceiptPathTemplate',
          'operationsReceiptVerifyPathTemplate',
          'operationsDetachedReceiptVerifyPath',
          'operationsWebhookPathTemplate',
          'advertisedBaseUrl',
          'authRequired',
          'grantedScopes',
        ],
        properties: {
          baseUrl: { type: ['string', 'null'] },
          bootstrapPath: { type: 'string' },
          capabilitiesPath: { type: 'string' },
          healthPath: { type: 'string' },
          readyPath: { type: 'string' },
          metricsPath: { type: 'string' },
          mcpPath: { type: 'string' },
          schemaPath: { type: 'string' },
          toolsPath: { type: 'string' },
          authPath: { type: 'string' },
          operationsPath: { type: 'string' },
          operationsReceiptPathTemplate: { type: 'string' },
          operationsReceiptVerifyPathTemplate: { type: 'string' },
          operationsDetachedReceiptVerifyPath: { type: 'string' },
          operationsWebhookPathTemplate: { type: 'string' },
          toolExposureMode: {
            type: 'string',
            enum: ['full', 'compact'],
          },
          advertisedBaseUrl: { type: ['string', 'null'] },
          authRequired: { type: 'boolean' },
          grantedScopes: { type: 'array', items: { type: 'string' } },
          principalId: { type: ['string', 'null'] },
          principal: { $ref: '#/definitions/CapabilitiesGatewayPrincipalSummary' },
          authManagement: { $ref: '#/definitions/CapabilitiesGatewayAuthManagementSummary' },
        },
        additionalProperties: false,
      },
      CapabilitiesGatewayPrincipalSummary: {
        type: 'object',
        required: ['principalId', 'status', 'scopes', 'sourceMode', 'current', 'runtimeReady', 'backendImplemented', 'rotation', 'revocation'],
        properties: {
          principalId: { type: 'string' },
          label: { type: ['string', 'null'] },
          principalType: { type: ['string', 'null'] },
          principalTemplate: { type: ['string', 'null'] },
          status: { type: 'string' },
          scopes: { type: 'array', items: { type: 'string' } },
          sourceMode: { type: 'string' },
          sourceFile: { type: ['string', 'null'] },
          createdAt: { type: ['string', 'null'] },
          rotatedAt: { type: ['string', 'null'] },
          revokedAt: { type: ['string', 'null'] },
          lastAuthenticatedAt: { type: ['string', 'null'] },
          tokenDigest: { type: ['string', 'null'] },
          revokedTokenDigest: { type: ['string', 'null'] },
          lastRotatedBy: { type: ['string', 'null'] },
          lastRevokedBy: { type: ['string', 'null'] },
          current: { type: 'boolean' },
          backendImplemented: { type: 'boolean' },
          runtimeReady: { type: 'boolean' },
          rotation: {
            type: 'object',
            required: ['supported', 'persistent', 'mode'],
            properties: {
              supported: { type: 'boolean' },
              persistent: { type: 'boolean' },
              mode: { type: 'string' },
            },
            additionalProperties: false,
          },
          revocation: {
            type: 'object',
            required: ['supported', 'persistent', 'mode'],
            properties: {
              supported: { type: 'boolean' },
              persistent: { type: 'boolean' },
              mode: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      CapabilitiesGatewayAuthManagementSummary: {
        type: 'object',
        required: [
          'mode',
          'principalCount',
          'supportsLiveReload',
          'supportsRotation',
          'supportsRevocation',
          'supportsProvisioning',
          'supportsDeletion',
          'persistence',
          'principalsPath',
          'currentPrincipalPath',
          'createPrincipalPath',
          'deletePrincipalPathTemplate',
          'rotatePathTemplate',
          'revokePathTemplate',
        ],
        properties: {
          mode: { type: 'string' },
          principalCount: { type: 'integer' },
          supportsLiveReload: { type: 'boolean' },
          supportsRotation: { type: 'boolean' },
          supportsRevocation: { type: 'boolean' },
          supportsProvisioning: { type: 'boolean' },
          supportsDeletion: { type: 'boolean' },
          persistence: { type: 'string' },
          authTokensFile: { type: ['string', 'null'] },
          authTokenFile: { type: ['string', 'null'] },
          principalsPath: { type: 'string' },
          currentPrincipalPath: { type: 'string' },
          createPrincipalPath: { type: 'string' },
          deletePrincipalPathTemplate: { type: 'string' },
          rotatePathTemplate: { type: 'string' },
          revokePathTemplate: { type: 'string' },
        },
        additionalProperties: false,
      },
      CapabilitiesSdkPackageDescriptor: {
        type: 'object',
        required: ['distributionStatus', 'vendoredInRootPackage'],
        properties: {
          name: { type: ['string', 'null'] },
          version: { type: ['string', 'null'] },
          repoPath: { type: ['string', 'null'] },
          moduleName: { type: ['string', 'null'] },
          distributionStatus: { type: 'string' },
          vendoredInRootPackage: { type: 'boolean' },
          publicationStatus: { type: ['string', 'null'] },
          publicRegistryPublished: { type: ['boolean', 'null'] },
          recommendedConsumption: { type: ['string', 'null'] },
          releaseAssetPatterns: { type: 'array', items: { type: 'string' } },
          installExamples: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
      CapabilitiesSdkGeneratedBundle: {
        type: 'object',
        properties: {
          repoPath: { type: ['string', 'null'] },
          bundlePath: { type: ['string', 'null'] },
          artifactVersion: { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
      CapabilitiesPolicyProfileSection: {
        type: 'object',
        required: ['supported', 'status', 'notes', 'policyScopedCommandCount', 'samplePolicyScopedCommands'],
        properties: {
          supported: { type: 'boolean' },
          status: { enum: ['active', 'planned', 'alpha', 'beta'] },
          notes: { type: 'array', items: { type: 'string' } },
          policyScopedCommandCount: { type: 'integer', minimum: 0 },
          samplePolicyScopedCommands: { type: 'array', items: { type: 'string' } },
          builtinIds: { type: 'array', items: { type: 'string' } },
          userCount: { type: 'integer', minimum: 0 },
          userSampleIds: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
      CapabilitiesSignerProfileSection: {
        type: 'object',
        required: [
          'supported',
          'status',
          'notes',
          'statusAxes',
          'secretBearingCommandCount',
          'sampleSecretBearingCommands',
          'backendStatuses',
          'readyBuiltinCount',
          'readyBuiltinIds',
          'degradedBuiltinCount',
          'degradedBuiltinIds',
          'placeholderBuiltinCount',
          'placeholderBuiltinIds',
          'pendingBuiltinCount',
          'pendingBuiltinIds',
        ],
        properties: {
          supported: { type: 'boolean' },
          status: { enum: ['active', 'planned', 'alpha', 'beta'] },
          notes: { type: 'array', items: { type: 'string' } },
          statusAxes: {
            type: 'object',
            required: ['implementation', 'runtime'],
            properties: {
              implementation: {
                type: 'object',
                required: ['implemented', 'placeholder'],
                properties: {
                  implemented: { type: 'string' },
                  placeholder: { type: 'string' },
                },
                additionalProperties: false,
              },
              runtime: {
                type: 'object',
                required: ['ready', 'degraded', 'placeholder', 'unknown'],
                properties: {
                  ready: { type: 'string' },
                  degraded: { type: 'string' },
                  placeholder: { type: 'string' },
                  unknown: { type: 'string' },
                },
                additionalProperties: false,
              },
            },
            additionalProperties: false,
          },
          secretBearingCommandCount: { type: 'integer', minimum: 0 },
          sampleSecretBearingCommands: { type: 'array', items: { type: 'string' } },
          builtinIds: { type: 'array', items: { type: 'string' } },
          mutableBuiltinCount: { type: 'integer', minimum: 0 },
          mutableBuiltinIds: { type: 'array', items: { type: 'string' } },
          signerBackends: { type: 'array', items: { type: 'string' } },
          implementedBackends: { type: 'array', items: { type: 'string' } },
          placeholderBackends: { type: 'array', items: { type: 'string' } },
          backendStatuses: {
            type: 'object',
            additionalProperties: { $ref: '#/definitions/CapabilitiesSignerBackendStatus' },
          },
          readyBuiltinCount: { type: 'integer', minimum: 0 },
          readyBuiltinIds: { type: 'array', items: { type: 'string' } },
          readyMutableBuiltinCount: { type: 'integer', minimum: 0 },
          readyMutableBuiltinIds: { type: 'array', items: { type: 'string' } },
          degradedBuiltinCount: { type: 'integer', minimum: 0 },
          degradedBuiltinIds: { type: 'array', items: { type: 'string' } },
          degradedMutableBuiltinCount: { type: 'integer', minimum: 0 },
          degradedMutableBuiltinIds: { type: 'array', items: { type: 'string' } },
          placeholderBuiltinCount: { type: 'integer', minimum: 0 },
          placeholderBuiltinIds: { type: 'array', items: { type: 'string' } },
          pendingBuiltinCount: { type: 'integer', minimum: 0 },
          pendingBuiltinIds: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
      CapabilitiesPrincipalTemplateSection: {
        type: 'object',
        required: ['supported', 'status', 'notes', 'templates'],
        properties: {
          supported: { type: 'boolean' },
          status: { enum: ['active', 'planned', 'alpha', 'beta'] },
          notes: { type: 'array', items: { type: 'string' } },
          templates: {
            type: 'array',
            items: { $ref: '#/definitions/CapabilitiesPrincipalTemplate' },
          },
        },
        additionalProperties: false,
      },
      CapabilitiesPrincipalTemplate: {
        type: 'object',
        required: [
          'id',
          'summary',
          'authMode',
          'mutating',
          'signerRequired',
          'canonicalTools',
          'recommendedCommands',
          'grantedScopes',
          'optionalScopes',
          'tokenRecordTemplate',
          'notes',
        ],
        properties: {
          id: { type: 'string' },
          summary: { type: 'string' },
          authMode: { enum: ['remote-gateway-token-record'] },
          mutating: { type: 'boolean' },
          signerRequired: { type: 'boolean' },
          canonicalTools: { type: 'array', items: { type: 'string' } },
          recommendedCommands: { type: 'array', items: { type: 'string' } },
          grantedScopes: { type: 'array', items: { type: 'string' } },
          optionalScopes: { type: 'array', items: { type: 'string' } },
          tokenRecordTemplate: { $ref: '#/definitions/CapabilitiesPrincipalTemplateTokenRecord' },
          notes: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
      CapabilitiesPrincipalTemplateTokenRecord: {
        type: 'object',
        required: ['id', 'tokenPlaceholder', 'scopes'],
        properties: {
          id: { type: 'string' },
          tokenPlaceholder: { type: 'string' },
          scopes: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
      CapabilitiesSignerBackendStatus: {
        type: 'object',
        required: [
          'implementationStatus',
          'runtimeStatus',
          'builtinProfileCount',
          'readyBuiltinIds',
          'degradedBuiltinIds',
          'placeholderBuiltinIds',
          'notes',
        ],
        properties: {
          implementationStatus: { enum: ['implemented', 'placeholder'] },
          runtimeStatus: { enum: ['ready', 'degraded', 'placeholder', 'unknown'] },
          builtinProfileCount: { type: 'integer', minimum: 0 },
          readyBuiltinIds: { type: 'array', items: { type: 'string' } },
          degradedBuiltinIds: { type: 'array', items: { type: 'string' } },
          placeholderBuiltinIds: { type: 'array', items: { type: 'string' } },
          notes: { type: 'array', items: { type: 'string' } },
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
          goal: { type: ['string', 'null'] },
          runtimeInfo: { type: ['object', 'null'] },
          report: { type: 'object' },
          checks: { type: 'object' },
          diagnostics: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'object' }] } },
          journeyReadiness: { type: ['object', 'null'] },
          recommendedCommands: { type: ['array', 'null'], items: { type: 'string' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
        additionalProperties: true,
      },
      SetupPayload: {
        type: 'object',
        properties: {
          action: { type: ['string', 'null'] },
          mode: { type: ['string', 'null'] },
          goal: { type: ['string', 'null'] },
          runtimeInfo: { type: ['object', 'null'] },
          envFile: { type: ['string', 'null'] },
          envChanges: { type: ['array', 'null'], items: { type: 'object' } },
          wizard: { type: ['object', 'null'] },
          doctor: { type: ['object', 'null'] },
          readiness: { type: ['object', 'null'] },
          guidedNextSteps: { type: ['array', 'null'], items: { oneOf: [{ type: 'string' }, { type: 'object' }] } },
          diagnostics: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'object' }] } },
          warnings: { type: ['array', 'null'], items: { oneOf: [{ type: 'string' }, { type: 'object' }] } },
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
      SportsSchedulePayload: {
        type: 'object',
        properties: {
          provider: { type: ['string', 'null'] },
          mode: { type: ['string', 'null'] },
          competition: { type: ['string', 'null'] },
          count: { type: 'integer' },
          schedule: { type: 'array', items: { type: 'object' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SportsScoresPayload: {
        type: 'object',
        properties: {
          provider: { type: ['string', 'null'] },
          mode: { type: ['string', 'null'] },
          queriedEventId: { type: ['string', 'null'] },
          competition: { type: ['string', 'null'] },
          liveOnly: { type: 'boolean' },
          count: { type: 'integer' },
          scores: { type: 'array', items: { type: 'object' } },
          diagnostics: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'object' }] } },
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
      SportsBulkOddsPayload: {
        type: 'object',
        properties: {
          provider: { type: ['string', 'null'] },
          mode: { type: ['string', 'null'] },
          competitionId: { type: 'string' },
          marketType: { type: 'string' },
          count: { type: 'integer' },
          odds: { type: 'array', items: { type: 'object' } },
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
          status: { type: 'string' },
          safeToResolve: { type: 'boolean' },
          recommendedAnswer: { type: ['string', 'null'] },
          recommendedCommand: { type: ['string', 'null'] },
          summary: { type: 'object' },
          resolution: { type: 'object' },
          execution: { type: 'object' },
          checksAnalyzed: { type: 'integer' },
          stableWindowStartAt: { type: ['string', 'null'] },
          settleDelaySatisfied: { type: 'boolean' },
          checks: { type: 'array', items: { type: 'object' } },
          blockers: { type: 'array', items: { type: 'object' } },
          blockingCodes: { type: 'array', items: { type: 'string' } },
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
          preview: { type: ['object', 'null'] },
          lpTokens: { type: ['string', 'null'] },
          lpTokenDecimals: { type: ['integer', 'null'] },
          sharesToBurnRaw: { type: ['string', 'null'] },
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
          indexerUrl: { type: ['string', 'null'] },
          iterationsRequested: { type: ['integer', 'null'] },
          intervalMs: { type: ['integer', 'null'] },
          count: { type: 'integer' },
          alertCount: { type: 'integer' },
          snapshots: { type: 'array', items: { type: 'object' } },
          alerts: { type: 'array', items: { type: 'object' } },
          webhookReports: { type: 'array', items: { type: 'object' } },
          brierTracking: { type: ['object', 'null'] },
          riskPolicy: { type: ['object', 'null'] },
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
          phase: { enum: ['DETECTED', 'PLANNED', 'DEPLOYED', 'SEEDED', 'SYNCING', 'AWAITING_RESOLVE', 'RESOLVED'] },
          phases: {
            type: 'array',
            items: { enum: ['DETECTED', 'PLANNED', 'DEPLOYED', 'SEEDED', 'SYNCING', 'AWAITING_RESOLVE', 'RESOLVED'] },
          },
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
      PolymarketPositionsPayload: {
        type: 'object',
        properties: {
          runtime: { type: ['object', 'null'] },
          selector: {
            type: ['object', 'null'],
            properties: {
              wallet: { type: ['string', 'null'] },
              conditionId: { type: ['string', 'null'] },
              slug: { type: ['string', 'null'] },
              tokenId: { type: ['string', 'null'] },
              funder: { type: ['string', 'null'] },
              source: { type: ['string', 'null'] },
            },
            additionalProperties: true,
          },
          source: { type: ['string', 'null'] },
          market: {
            type: ['object', 'null'],
            properties: {
              marketId: { type: ['string', 'null'] },
              conditionId: { type: ['string', 'null'] },
              slug: { type: ['string', 'null'] },
              question: { type: ['string', 'null'] },
              yesTokenId: { type: ['string', 'null'] },
              noTokenId: { type: ['string', 'null'] },
            },
            additionalProperties: true,
          },
          summary: {
            type: ['object', 'null'],
            properties: {
              yesBalance: { type: ['number', 'null'] },
              noBalance: { type: ['number', 'null'] },
              openOrdersCount: { type: ['integer', 'null'] },
              openOrdersNotionalUsd: { type: ['number', 'null'] },
              estimatedValueUsd: { type: ['number', 'null'] },
              positionDeltaApprox: { type: ['number', 'null'] },
              prices: {
                type: ['object', 'null'],
                properties: {
                  yes: { type: ['number', 'null'] },
                  no: { type: ['number', 'null'] },
                },
                additionalProperties: true,
              },
              diagnostics: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'object' }] } },
            },
            additionalProperties: true,
          },
          positions: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              properties: {
                tokenId: { type: ['string', 'null'] },
                outcome: { type: ['string', 'null'] },
                balance: { type: ['number', 'null'] },
                balanceRaw: { type: ['string', 'null'] },
                decimals: { type: ['integer', 'null'] },
                price: { type: ['number', 'null'] },
                estimatedValueUsd: { type: ['number', 'null'] },
              },
              additionalProperties: true,
            },
          },
          openOrders: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              properties: {
                orderId: { type: ['string', 'null'] },
                tokenId: { type: ['string', 'null'] },
                side: { type: ['string', 'null'] },
                outcome: { type: ['string', 'null'] },
                size: { type: ['number', 'null'] },
                price: { type: ['number', 'null'] },
                notionalUsd: { type: ['number', 'null'] },
                status: { type: ['string', 'null'] },
              },
              additionalProperties: true,
            },
          },
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
          polymarketPreflight: { type: ['object', 'null'] },
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
      MirrorStatusPayload: {
        type: 'object',
        properties: {
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
          stateFile: { type: ['string', 'null'] },
          strategyHash: { type: ['string', 'null'] },
          selector: { type: ['object', 'null'] },
          trustManifest: { type: ['object', 'null'] },
          runtime: { type: ['object', 'null'] },
          live: { type: ['object', 'null'] },
          state: { type: ['object', 'null'] },
        },
      },
      MirrorReconciliationMetadata: {
        type: 'object',
        properties: {
          requested: { type: 'boolean' },
          mode: { type: ['string', 'null'] },
          requestedLegacyApprox: { type: 'boolean' },
          legacyApproxIncluded: { type: 'boolean' },
          ledgerSource: { type: ['string', 'null'] },
          missing: { type: 'array', items: { type: 'string' } },
        },
      },
      MirrorReconciledLedgerRow: {
        type: 'object',
        properties: {
          id: { type: ['string', 'null'] },
          rowId: { type: ['string', 'null'] },
          sequence: { type: ['number', 'null'] },
          timestamp: { type: ['string', 'null'], format: 'date-time' },
          venue: { type: ['string', 'null'] },
          chain: { type: ['string', 'null'] },
          component: { type: ['string', 'null'] },
          classification: { type: ['string', 'null'] },
          direction: { type: ['string', 'null'] },
          amountUsdc: { type: ['number', 'null'] },
          cashFlowUsdc: { type: ['number', 'null'] },
          realizedPnlUsdc: { type: ['number', 'null'] },
          unrealizedPnlUsdc: { type: ['number', 'null'] },
          feeUsdc: { type: ['number', 'null'] },
          gasUsdc: { type: ['number', 'null'] },
          txHash: { type: ['string', 'null'] },
          orderRef: { type: ['string', 'null'] },
          blockNumber: { type: ['number', 'null'] },
          status: { type: ['string', 'null'] },
          source: { type: ['string', 'null'] },
          provenance: { type: ['string', 'object', 'null'] },
          notes: { type: ['string', 'null'] },
        },
      },
      MirrorReconciledPayload: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          summary: { type: ['object', 'null'] },
          components: { type: ['object', 'null'] },
          trace: { type: ['object', 'null'] },
          provenance: {
            type: ['object', 'null'],
            properties: {
              sources: { type: 'array', items: { type: 'string' } },
              missing: { type: 'array', items: { type: 'string' } },
              usedAccountingRows: { type: 'boolean' },
              usedAuditLedger: { type: 'boolean' },
              usedTraceRows: { type: 'boolean' },
              usedLiveMark: { type: 'boolean' },
              sourceInputs: { type: ['object', 'null'] },
              usedLegacyApproximation: { type: 'boolean' },
            },
          },
          ledger: {
            type: ['object', 'null'],
            properties: {
              rows: { type: 'array', items: { $ref: '#/definitions/MirrorReconciledLedgerRow' } },
              exportColumns: { type: 'array', items: { type: 'string' } },
              exportRows: { type: 'array', items: { type: 'object' } },
            },
          },
        },
      },
      MirrorPnlPayload: {
        type: 'object',
        description:
          'Canonical mirror P&L payload. Current builds expose approximate/operator scenario fields. Reconciled rollout keeps this payload name and promotes ledger-grade realized/unrealized component breakout onto the same surface.',
        properties: {
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
          stateFile: { type: ['string', 'null'] },
          strategyHash: { type: ['string', 'null'] },
          selector: { type: ['object', 'null'] },
          summary: {
            type: ['object', 'null'],
            description: 'Top-level P&L summary. Treat current fields as approximate until reconciled accounting rollout adds explicit component attribution and accounting mode/provenance.',
          },
          crossVenue: { type: ['object', 'null'] },
          hedgeStatus: { type: ['object', 'null'] },
          actionability: { type: ['object', 'null'] },
          polymarketPosition: { type: ['object', 'null'] },
          sourceMarket: { type: ['object', 'null'] },
          pandoraMarket: { type: ['object', 'null'] },
          scenarios: {
            type: ['object', 'null'],
            description: 'Scenario-model outputs used by the approximate/operator P&L surface. These remain projections even when reconciled accounting is attached.',
          },
          runtime: { type: ['object', 'null'] },
          reconciled: {
            anyOf: [
              { $ref: '#/definitions/MirrorReconciledPayload' },
              { type: 'null' },
            ],
            description: 'Optional ledger-grade accounting breakout with normalized rows, component summaries, provenance, and export-ready rows.',
          },
          reconciliation: {
            anyOf: [
              { $ref: '#/definitions/MirrorReconciliationMetadata' },
              { type: 'null' },
            ],
            description: 'Top-level reconciliation mode metadata for the current request.',
          },
          diagnostics: { type: 'array', items: { type: 'string' } },
        },
      },
      MirrorAuditPayload: {
        type: 'object',
        description:
          'Canonical mirror audit payload. Current builds expose operational/classified audit history. Reconciled rollout keeps this payload name and upgrades it to a ledger-grade cross-venue audit with deterministic provenance.',
        properties: {
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
          stateFile: { type: ['string', 'null'] },
          strategyHash: { type: ['string', 'null'] },
          selector: { type: ['object', 'null'] },
          summary: {
            type: ['object', 'null'],
            description: 'Audit rollup summary. During rollout, inspect this together with diagnostics to tell whether the payload is still operational/classified or fully reconciled.',
          },
          runtime: { type: ['object', 'null'] },
          liveContext: {
            type: ['object', 'null'],
            description: 'Optional current live context attached beside the persisted ledger. This is additive context, not the canonical accounting ledger itself.',
          },
          ledger: {
            type: ['object', 'null'],
            description: 'Operational audit ledger payload. This remains append-only/audit-log-first even when reconciled accounting is attached separately.',
          },
          reconciled: {
            anyOf: [
              { $ref: '#/definitions/MirrorReconciledPayload' },
              { type: 'null' },
            ],
            description: 'Optional normalized cross-venue ledger with component summaries, provenance, and export-ready rows.',
          },
          reconciliation: {
            anyOf: [
              { $ref: '#/definitions/MirrorReconciliationMetadata' },
              { type: 'null' },
            ],
            description: 'Top-level reconciliation mode metadata for the current request.',
          },
          diagnostics: { type: 'array', items: { type: 'string' } },
        },
      },
      MirrorTracePayload: {
        type: 'object',
        properties: {
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
          selector: { type: ['object', 'null'] },
          summary: { type: ['object', 'null'] },
          snapshots: { type: 'array', items: { type: 'object' } },
          diagnostics: { type: 'array', items: { type: 'string' } },
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
          status: { type: 'string' },
          resumeCommands: { type: 'array', items: { type: 'string' } },
          polymarketSettlement: { type: ['object', 'null'] },
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
      ExplainPayload: {
        type: 'object',
        required: ['input', 'error', 'explanation', 'nextCommands', 'schemaVersion', 'generatedAt'],
        properties: {
          input: {
            type: ['object', 'null'],
            properties: {
              source: { type: ['string', 'null'] },
              format: { type: ['string', 'null'] },
            },
            additionalProperties: false,
          },
          error: {
            type: ['object', 'null'],
            properties: {
              code: { type: ['string', 'null'] },
              normalizedCode: { type: ['string', 'null'] },
              message: { type: ['string', 'null'] },
              details: { type: ['object', 'null'] },
            },
            additionalProperties: false,
          },
          explanation: {
            type: ['object', 'null'],
            properties: {
              recognized: { type: ['boolean', 'null'] },
              category: { type: ['string', 'null'] },
              summary: { type: ['string', 'null'] },
              retryable: { type: ['boolean', 'null'] },
              recovery: {
                oneOf: [
                  { $ref: '#/definitions/ErrorRecoveryPayload' },
                  { type: 'null' },
                ],
              },
              remediation: { type: 'array', items: { type: 'object' } },
              diagnostics: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'object' }] } },
            },
            additionalProperties: false,
          },
          nextCommands: {
            type: 'array',
            items: {
              type: 'object',
              required: ['command', 'action', 'retryable', 'canonical', 'source'],
              properties: {
                command: { type: 'string' },
                action: { type: ['string', 'null'] },
                retryable: { type: 'boolean' },
                canonical: { type: 'boolean' },
                source: { type: 'string' },
              },
              additionalProperties: false,
            },
          },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
        additionalProperties: false,
      },
      PolicyPayload: {
        type: 'object',
        properties: {
          item: { type: ['object', 'null'] },
          filePath: { type: ['string', 'null'] },
          ok: { type: ['boolean', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      PolicyExplainPayload: {
        type: 'object',
        properties: {
          id: { type: ['string', 'null'] },
          source: { type: ['string', 'null'] },
          builtin: { type: ['boolean', 'null'] },
          filePath: { type: ['string', 'null'] },
          item: { type: ['object', 'null'] },
          summary: { type: ['object', 'null'] },
          requestedContext: { type: ['object', 'null'] },
          compatibility: { type: ['object', 'null'] },
          explanation: { type: ['object', 'null'] },
          blockers: { type: 'array', items: { type: ['object', 'string'] } },
          remediation: { type: 'array', items: { type: 'object' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      PolicyListPayload: {
        type: 'object',
        properties: {
          policyDir: { type: ['string', 'null'] },
          count: { type: 'integer' },
          builtinCount: { type: 'integer' },
          userCount: { type: 'integer' },
          errors: { type: 'array', items: { type: 'object' } },
          items: { type: 'array', items: { type: 'object' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      PolicyRecommendPayload: {
        type: 'object',
        properties: {
          requestedContext: { type: ['object', 'null'] },
          exact: { type: ['boolean', 'null'] },
          count: { type: ['integer', 'null'] },
          builtinCount: { type: ['integer', 'null'] },
          userCount: { type: ['integer', 'null'] },
          compatibleCount: { type: ['integer', 'null'] },
          recommendedPolicyId: { type: ['string', 'null'] },
          recommendedReadOnlyPolicyId: { type: ['string', 'null'] },
          recommendedMutablePolicyId: { type: ['string', 'null'] },
          diagnostics: { type: 'array', items: { type: 'object' } },
          items: { type: 'array', items: { type: 'object' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ProfilePayload: {
        type: 'object',
        properties: {
          item: { type: ['object', 'null'] },
          filePath: { type: ['string', 'null'] },
          ok: { type: ['boolean', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ProfileListPayload: {
        type: 'object',
        properties: {
          profileDir: { type: ['string', 'null'] },
          count: { type: 'integer' },
          builtinCount: { type: 'integer' },
          userCount: { type: 'integer' },
          errors: { type: 'array', items: { type: 'object' } },
          items: { type: 'array', items: { type: 'object' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ProfileRecommendPayload: {
        type: 'object',
        properties: {
          profileStoreFile: { type: ['string', 'null'] },
          profileStoreExists: { type: ['boolean', 'null'] },
          requestedContext: { type: ['object', 'null'] },
          exact: { type: ['boolean', 'null'] },
          builtInCount: { type: ['integer', 'null'] },
          fileCount: { type: ['integer', 'null'] },
          count: { type: ['integer', 'null'] },
          compatibleCount: { type: ['integer', 'null'] },
          recommendedProfileId: { type: ['string', 'null'] },
          recommendedReadOnlyProfileId: { type: ['string', 'null'] },
          recommendedMutableProfileId: { type: ['string', 'null'] },
          diagnostics: { type: 'array', items: { type: 'object' } },
          items: { type: 'array', items: { type: 'object' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      RecipePayload: {
        type: 'object',
        properties: {
          item: { type: ['object', 'null'] },
          recipe: { type: ['object', 'null'] },
          source: { type: ['string', 'null'] },
          origin: { type: ['string', 'null'] },
          filePath: { type: ['string', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      RecipeListPayload: {
        type: 'object',
        properties: {
          count: { type: 'integer' },
          builtinCount: { type: 'integer' },
          userCount: { type: 'integer' },
          safeByDefaultCount: { type: ['integer', 'null'] },
          operationExpectedCount: { type: ['integer', 'null'] },
          sourceCounts: { type: ['object', 'null'], additionalProperties: { type: 'integer' } },
          approvalStatusCounts: { type: ['object', 'null'], additionalProperties: { type: 'integer' } },
          riskLevelCounts: { type: ['object', 'null'], additionalProperties: { type: 'integer' } },
          appliedFilters: {
            type: ['object', 'null'],
            properties: {
              source: { type: ['string', 'null'] },
              approvalStatus: { type: ['string', 'null'] },
              riskLevel: { type: ['string', 'null'] },
            },
            additionalProperties: false,
          },
          errors: { type: 'array', items: { type: 'object' } },
          items: { type: 'array', items: { type: 'object' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      RecipeRunPayload: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          item: { type: ['object', 'null'] },
          compiledCommand: { type: 'array', items: { type: 'string' } },
          policyId: { type: ['string', 'null'] },
          profileId: { type: ['string', 'null'] },
          operationId: { type: ['string', 'null'] },
          inputs: { type: ['object', 'null'] },
          validation: { type: ['object', 'null'] },
          result: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
          exitCode: { type: ['integer', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      OperationPayload: {
        type: 'object',
        properties: {
          operationId: { type: 'string' },
          id: { type: 'string' },
          operationHash: { type: ['string', 'null'] },
          hash: { type: ['string', 'null'] },
          tool: { type: ['string', 'null'] },
          action: { type: ['string', 'null'] },
          command: { type: ['string', 'null'] },
          summary: { type: ['string', 'null'] },
          description: { type: ['string', 'null'] },
          status: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          policyPack: { type: ['string', 'null'] },
          profile: { type: ['string', 'null'] },
          environment: { type: ['string', 'null'] },
          mode: { type: ['string', 'null'] },
          parentOperationId: { type: ['string', 'null'] },
          scope: { type: ['string', 'null'] },
          tags: { type: 'array', items: { type: 'string' } },
          cancelable: { type: 'boolean' },
          closable: { type: 'boolean' },
          target: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
          input: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
          request: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
          context: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
          checkpoints: { type: ['array', 'null'], items: { type: 'object' } },
          latestCheckpoint: { type: ['object', 'null'] },
          checkpointCount: { type: 'integer' },
          metadata: { type: ['object', 'null'] },
          result: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
          recovery: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
          error: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
          cancellation: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
          closure: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
          validatedAt: { type: ['string', 'null'], format: 'date-time' },
          queuedAt: { type: ['string', 'null'], format: 'date-time' },
          executingAt: { type: ['string', 'null'], format: 'date-time' },
          startedAt: { type: ['string', 'null'], format: 'date-time' },
          completedAt: { type: ['string', 'null'], format: 'date-time' },
          failedAt: { type: ['string', 'null'], format: 'date-time' },
          canceledAt: { type: ['string', 'null'], format: 'date-time' },
          cancelledAt: { type: ['string', 'null'], format: 'date-time' },
          closedAt: { type: ['string', 'null'], format: 'date-time' },
          schemaVersion: { type: 'string' },
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
      OperationReceiptPayload: {
        type: 'object',
        properties: {
          receiptId: { type: 'string' },
          receiptKind: { type: 'string' },
          receiptVersion: { type: 'integer' },
          operationId: { type: 'string' },
          operationHash: { type: ['string', 'null'] },
          command: { type: ['string', 'null'] },
          canonicalCommand: { type: ['string', 'null'] },
          canonicalTool: { type: ['string', 'null'] },
          tool: { type: ['string', 'null'] },
          action: { type: ['string', 'null'] },
          status: { type: 'string' },
          terminal: { type: 'boolean' },
          createdAt: { type: ['string', 'null'], format: 'date-time' },
          updatedAt: { type: ['string', 'null'], format: 'date-time' },
          terminalAt: { type: ['string', 'null'], format: 'date-time' },
          summary: { type: ['string', 'null'] },
          description: { type: ['string', 'null'] },
          policyPack: { type: ['string', 'null'] },
          profile: { type: ['string', 'null'] },
          environment: { type: ['string', 'null'] },
          mode: { type: ['string', 'null'] },
          scope: { type: ['string', 'null'] },
          tags: { type: 'array', items: { type: 'string' } },
          parentOperationId: { type: ['string', 'null'] },
          validatedAt: { type: ['string', 'null'], format: 'date-time' },
          queuedAt: { type: ['string', 'null'], format: 'date-time' },
          executingAt: { type: ['string', 'null'], format: 'date-time' },
          startedAt: { type: ['string', 'null'], format: 'date-time' },
          completedAt: { type: ['string', 'null'], format: 'date-time' },
          failedAt: { type: ['string', 'null'], format: 'date-time' },
          canceledAt: { type: ['string', 'null'], format: 'date-time' },
          cancelledAt: { type: ['string', 'null'], format: 'date-time' },
          closedAt: { type: ['string', 'null'], format: 'date-time' },
          target: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
          input: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
          request: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
          result: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
          recovery: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
          error: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
          cancellation: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
          closure: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
          metadata: { type: ['object', 'null'] },
          context: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
          checkpointCount: { type: 'integer' },
          latestCheckpoint: { type: ['object', 'null'] },
          checkpoints: { type: 'array', items: { type: 'object' } },
          stateDigest: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
          issuedAt: { type: 'string', format: 'date-time' },
          sealedAt: { type: 'string', format: 'date-time' },
          supersedesReceiptHash: { type: ['string', 'null'] },
          checkpointDigest: { type: 'string' },
          hashes: {
            type: 'object',
            properties: {
              targetHash: { type: 'string' },
              inputHash: { type: 'string' },
              requestHash: { type: 'string' },
              contextHash: { type: 'string' },
              metadataHash: { type: 'string' },
              resultHash: { type: 'string' },
              recoveryHash: { type: 'string' },
              errorHash: { type: 'string' },
              cancellationHash: { type: 'string' },
              closureHash: { type: 'string' },
              checkpointsHash: { type: 'string' },
            },
            required: ['targetHash', 'inputHash', 'requestHash', 'contextHash', 'metadataHash', 'resultHash', 'recoveryHash', 'errorHash', 'cancellationHash', 'closureHash', 'checkpointsHash'],
            additionalProperties: false,
          },
          verification: {
            type: 'object',
            properties: {
              algorithm: { type: 'string' },
              receiptHash: { type: 'string' },
              checkpointDigest: { type: 'string' },
              signatureAlgorithm: { type: 'string' },
              signature: { type: 'string' },
              publicKeyPem: { type: 'string' },
              publicKeyFingerprint: { type: 'string' },
              keyId: { type: 'string' },
            },
            required: ['algorithm', 'receiptHash', 'checkpointDigest', 'signatureAlgorithm', 'signature', 'publicKeyPem', 'publicKeyFingerprint', 'keyId'],
            additionalProperties: false,
          },
          receiptHash: { type: 'string' },
          schemaVersion: { type: 'string' },
        },
      },
      OperationReceiptVerificationPayload: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          code: { type: ['string', 'null'] },
          operationId: { type: ['string', 'null'] },
          operationHash: { type: ['string', 'null'] },
          expectedOperationHash: { type: ['string', 'null'] },
          receiptHash: { type: ['string', 'null'] },
          signatureValid: { type: 'boolean' },
          signatureAlgorithm: { type: ['string', 'null'] },
          publicKeyFingerprint: { type: ['string', 'null'] },
          keyId: { type: ['string', 'null'] },
          mismatches: { type: 'array', items: { type: 'string' } },
          source: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['file', 'operation-id', 'detached'] },
              value: { type: ['string', 'null'] },
            },
            required: ['type', 'value'],
            additionalProperties: false,
          },
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
          'documentation',
          'trustDistribution',
          'definitions',
        ],
        properties: {
          $schema: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          type: { const: 'object' },
          oneOf: { type: 'array', items: { type: 'object' } },
          commandDescriptorVersion: { type: 'string' },
          descriptorScope: { enum: ['canonical-command-surface', 'command-surface+compatibility'] },
          discoveryPreferences: { $ref: '#/definitions/DiscoveryPreferences' },
          commandDescriptors: {
            type: 'object',
            additionalProperties: commandDescriptorMetadata.descriptorValueSchema,
          },
          commandDescriptorMetadata: { $ref: '#/definitions/CommandDescriptorMetadata' },
          capabilities: { $ref: '#/definitions/SchemaDescriptorCapabilities' },
          documentation: { $ref: '#/definitions/SkillDocIndex' },
          trustDistribution: { $ref: '#/definitions/TrustDistributionPayload' },
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
        console.log('Usage: pandora --output json schema [--include-compatibility]');
        // eslint-disable-next-line no-console
        console.log('');
        // eslint-disable-next-line no-console
        console.log('Notes:');
        // eslint-disable-next-line no-console
        console.log('  - schema payload is available only in --output json mode.');
        // eslint-disable-next-line no-console
        console.log('  - By default it returns canonical command descriptors only.');
        // eslint-disable-next-line no-console
        console.log('  - Pass --include-compatibility only for legacy/debug workflows that need alias descriptors.');
      }
      return;
    }

    if (context.outputMode !== 'json') {
      throw new CliError('INVALID_USAGE', 'The schema command is only supported in --output json mode.', {
        hints: ['Run `pandora --output json schema`'],
      });
    }

    const includeCompatibility = Array.isArray(args) && args.includes('--include-compatibility');
    const unsupportedArgs = Array.isArray(args)
      ? args.filter((arg) => arg !== '--include-compatibility')
      : [];

    if (unsupportedArgs.length > 0) {
      throw new CliError('INVALID_ARGS', 'schema does not accept additional flags or positional arguments.', {
        hints: [
          'Run `pandora --output json schema`.',
          'Use `pandora --output json schema --include-compatibility` only when alias descriptors are required.',
        ],
      });
    }

    emitSuccess(context.outputMode, 'schema', buildSchemaPayload({ includeCompatibility }));
  }

  return { runSchemaCommand };
}

module.exports = {
  buildSchemaPayload,
  createRunSchemaCommand,
};
