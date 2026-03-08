'use strict';

const { buildCommandDescriptors, COMMAND_DESCRIPTOR_VERSION } = require('./agent_contract_registry.cjs');
const { createMcpToolRegistry } = require('./mcp_tool_registry.cjs');
const { buildSchemaPayload } = require('./schema_command_service.cjs');
const { buildCapabilitiesPayload } = require('./capabilities_command_service.cjs');

const SDK_CONTRACT_ARTIFACT_VERSION = '1.0.0';
const SDK_ARTIFACT_GENERATED_AT = '1970-01-01T00:00:00.000Z';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function sortStrings(values) {
  return Array.from(new Set(Array.isArray(values) ? values : []))
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortObjectKeys(entry));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const sorted = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    sorted[key] = sortObjectKeys(value[key]);
  }
  return sorted;
}

function getToolXPandora(toolDefinition) {
  if (toolDefinition && isPlainObject(toolDefinition.xPandora)) {
    return toolDefinition.xPandora;
  }
  if (
    toolDefinition
    && isPlainObject(toolDefinition.inputSchema)
    && isPlainObject(toolDefinition.inputSchema.xPandora)
  ) {
    return toolDefinition.inputSchema.xPandora;
  }
  return null;
}

function sanitizeMetadataProvenance(rawMetadataProvenance) {
  if (!isPlainObject(rawMetadataProvenance)) return null;
  const metadataProvenance = cloneJson(rawMetadataProvenance);
  if (Array.isArray(metadataProvenance.descriptorDerived)) {
    metadataProvenance.descriptorDerived = metadataProvenance.descriptorDerived.filter(
      (fieldName) => fieldName !== 'remoteTransportActive',
    );
  }
  if (Array.isArray(metadataProvenance.runtimeEnforced)) {
    metadataProvenance.runtimeEnforced = metadataProvenance.runtimeEnforced.filter(
      (fieldName) => fieldName !== 'remoteTransportActive',
    );
  }
  if (!metadataProvenance.descriptorDerived || metadataProvenance.descriptorDerived.length === 0) {
    delete metadataProvenance.descriptorDerived;
  }
  if (!metadataProvenance.runtimeEnforced || metadataProvenance.runtimeEnforced.length === 0) {
    delete metadataProvenance.runtimeEnforced;
  }
  return Object.keys(metadataProvenance).length ? metadataProvenance : null;
}

function sanitizeToolXPandora(rawXPandora) {
  if (!isPlainObject(rawXPandora)) return null;
  const xPandora = cloneJson(rawXPandora);
  delete xPandora.remoteTransportActive;
  const metadataProvenance = sanitizeMetadataProvenance(xPandora.metadataProvenance);
  if (metadataProvenance) {
    xPandora.metadataProvenance = metadataProvenance;
  } else {
    delete xPandora.metadataProvenance;
  }
  return sortObjectKeys(xPandora);
}

function sanitizeToolInputSchema(rawInputSchema) {
  const inputSchema = isPlainObject(rawInputSchema)
    ? cloneJson(rawInputSchema)
    : { type: 'object', properties: {}, additionalProperties: false };
  if (isPlainObject(inputSchema.xPandora)) {
    const xPandora = sanitizeToolXPandora(inputSchema.xPandora);
    if (xPandora) {
      inputSchema.xPandora = xPandora;
    } else {
      delete inputSchema.xPandora;
    }
  }
  return sortObjectKeys(inputSchema);
}

function buildGeneratedToolDefinition(toolDefinition) {
  const toolName = String(toolDefinition && toolDefinition.name ? toolDefinition.name : '').trim();
  if (!toolName) return null;
  const xPandora = sanitizeToolXPandora(getToolXPandora(toolDefinition));
  return sortObjectKeys({
    name: toolName,
    description: toolDefinition && toolDefinition.description ? toolDefinition.description : null,
    inputSchema: sanitizeToolInputSchema(toolDefinition && toolDefinition.inputSchema),
    xPandora,
    command: xPandora && Array.isArray(xPandora.command) ? [...xPandora.command] : [],
    mutating: Boolean(xPandora && xPandora.mutating),
    safeFlags: xPandora && Array.isArray(xPandora.safeFlags) ? [...xPandora.safeFlags] : [],
    executeFlags: xPandora && Array.isArray(xPandora.executeFlags) ? [...xPandora.executeFlags] : [],
    longRunningBlocked: Boolean(xPandora && xPandora.longRunningBlocked),
    placeholderBlocked: Boolean(xPandora && xPandora.placeholderBlocked),
    aliasOf: xPandora && xPandora.aliasOf ? xPandora.aliasOf : null,
    canonicalTool: xPandora && xPandora.canonicalTool ? xPandora.canonicalTool : toolName,
    preferred: Boolean(xPandora && xPandora.preferred),
    controlInputNames: xPandora && Array.isArray(xPandora.controlInputNames) ? [...xPandora.controlInputNames] : [],
    agentWorkflow: xPandora && isPlainObject(xPandora.agentWorkflow) ? cloneJson(xPandora.agentWorkflow) : null,
    supportsRemote: Boolean(xPandora && xPandora.supportsRemote),
    remoteEligible: Boolean(xPandora && xPandora.remoteEligible),
    policyScopes: xPandora && Array.isArray(xPandora.policyScopes) ? [...xPandora.policyScopes] : [],
    canRunConcurrent: Boolean(xPandora && xPandora.canRunConcurrent),
    expectedLatencyMs: xPandora && Number.isFinite(xPandora.expectedLatencyMs) ? xPandora.expectedLatencyMs : null,
    externalDependencies:
      xPandora && Array.isArray(xPandora.externalDependencies) ? [...xPandora.externalDependencies] : [],
    idempotency: xPandora && xPandora.idempotency ? xPandora.idempotency : null,
    jobCapable: Boolean(xPandora && xPandora.jobCapable),
    recommendedPreflightTool:
      xPandora && xPandora.recommendedPreflightTool ? xPandora.recommendedPreflightTool : null,
    requiresSecrets: Boolean(xPandora && xPandora.requiresSecrets),
    returnsOperationId: Boolean(xPandora && xPandora.returnsOperationId),
    returnsRuntimeHandle: Boolean(xPandora && xPandora.returnsRuntimeHandle),
    riskLevel: xPandora && xPandora.riskLevel ? xPandora.riskLevel : null,
    safeEquivalent: xPandora && xPandora.safeEquivalent ? xPandora.safeEquivalent : null,
    supportsWebhook: Boolean(xPandora && xPandora.supportsWebhook),
  });
}

function buildSdkBackendMetadata(capabilitiesPayload) {
  const transports = capabilitiesPayload && isPlainObject(capabilitiesPayload.transports)
    ? capabilitiesPayload.transports
    : {};
  const stdio = isPlainObject(transports.mcpStdio) ? transports.mcpStdio : {};
  const remote = isPlainObject(transports.mcpStreamableHttp) ? transports.mcpStreamableHttp : {};
  const sdk = isPlainObject(transports.sdk) ? transports.sdk : {};
  return sortObjectKeys({
    local: {
      supported: true,
      transport: 'mcpStdio',
      backendType: 'stdio',
      defaultCommand: 'pandora',
      defaultArgs: ['mcp'],
      requiresExternalCommand: true,
      transportStatus: typeof stdio.status === 'string' ? stdio.status : 'active',
      notes: sortStrings([
        'The local backend expects a compatible `pandora` CLI binary on PATH unless the caller overrides command/args.',
        'Use the local MCP stdio backend for same-machine execution.',
        ...sortStrings(stdio.notes),
      ]),
    },
    remote: {
      supported: true,
      transport: 'mcpStreamableHttp',
      backendType: 'streamable-http',
      requiresUrl: true,
      supportsAuthToken: true,
      supportsHeaders: true,
      transportStatus: typeof remote.status === 'string' ? remote.status : 'inactive',
      notes: sortStrings([
        'Use the remote MCP streamable HTTP backend against a running `pandora mcp http` gateway.',
        ...sortStrings(remote.notes),
      ]),
    },
    packagedClients: {
      supported: sdk.supported !== false,
      transport: 'sdk',
      backendType: 'generated-sdk',
      notes: sortStrings(sdk.notes),
    },
  });
}

function buildSdkContractComponents(options = {}) {
  const packageVersion = typeof options.packageVersion === 'string' && options.packageVersion.trim()
    ? options.packageVersion.trim()
    : '0.0.0';
  const remoteTransportActive = Boolean(options.remoteTransportActive);
  const remoteTransportUrl = typeof options.remoteTransportUrl === 'string' && options.remoteTransportUrl.trim()
    ? options.remoteTransportUrl.trim()
    : null;

  const commandDescriptors = sortObjectKeys(buildCommandDescriptors());
  const mcpToolDefinitions = createMcpToolRegistry({ remoteTransportActive })
    .listTools()
    .map((definition) => buildGeneratedToolDefinition(definition))
    .filter(Boolean)
    .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
  const schemaPayload = sortObjectKeys({
    ...cloneJson(buildSchemaPayload()),
    schemaVersion: SDK_CONTRACT_ARTIFACT_VERSION,
    generatedAt: SDK_ARTIFACT_GENERATED_AT,
  });
  const capabilitiesPayload = buildCapabilitiesPayload({
    packageVersion,
    remoteTransportActive,
    remoteTransportUrl,
    generatedAtOverride: SDK_ARTIFACT_GENERATED_AT,
  });
  const backends = buildSdkBackendMetadata(capabilitiesPayload);

  return {
    packageVersion,
    remoteTransportActive,
    remoteTransportUrl,
    commandDescriptors,
    mcpToolDefinitions,
    schemaPayload,
    capabilitiesPayload,
    backends,
  };
}

function buildToolCatalog(commandDescriptors, mcpToolDefinitions) {
  const byName = {};
  for (const toolDefinition of mcpToolDefinitions) {
    const toolName = String(toolDefinition && toolDefinition.name ? toolDefinition.name : '').trim();
    if (!toolName) continue;
    const descriptor = commandDescriptors[toolName] || null;
    const xPandora = getToolXPandora(toolDefinition);
    byName[toolName] = sortObjectKeys({
      name: toolName,
      description: toolDefinition.description || null,
      inputSchema: sanitizeToolInputSchema(toolDefinition.inputSchema),
      xPandora: sanitizeToolXPandora(xPandora),
      commandDescriptor: descriptor,
    });
  }
  return sortObjectKeys(byName);
}

function buildCatalogSummary(commandDescriptors, mcpToolDefinitions) {
  const descriptorNames = Object.keys(commandDescriptors);
  const toolNames = mcpToolDefinitions
    .map((definition) => String(definition && definition.name ? definition.name : '').trim())
    .filter(Boolean);
  const canonicalTools = sortStrings(
    mcpToolDefinitions.map((definition) => {
      if (definition && definition.xPandora && definition.xPandora.canonicalTool) {
        return definition.xPandora.canonicalTool;
      }
      if (
        definition
        && definition.inputSchema
        && definition.inputSchema.xPandora
        && definition.inputSchema.xPandora.canonicalTool
      ) {
        return definition.inputSchema.xPandora.canonicalTool;
      }
      return null;
    }),
  );

  return {
    totalCommands: descriptorNames.length,
    totalMcpTools: toolNames.length,
    canonicalTools,
    topLevelCommands: descriptorNames.filter((name) => !name.includes('.')).length,
    aliases: descriptorNames.filter((name) => commandDescriptors[name] && commandDescriptors[name].aliasOf).length,
    mutatingTools: toolNames.filter(
      (toolName) => commandDescriptors[toolName] && commandDescriptors[toolName].mcpMutating,
    ).length,
    remoteEligibleTools: toolNames.filter(
      (toolName) => commandDescriptors[toolName] && commandDescriptors[toolName].remoteEligible,
    ).length,
    operationBackedCommands: descriptorNames.filter(
      (name) => commandDescriptors[name] && commandDescriptors[name].returnsOperationId,
    ).length,
  };
}

function buildSdkContractArtifact(options = {}) {
  const {
    packageVersion,
    commandDescriptors,
    mcpToolDefinitions,
    schemaPayload,
    capabilitiesPayload,
    backends,
  } = buildSdkContractComponents(options);

  return sortObjectKeys({
    artifactVersion: SDK_CONTRACT_ARTIFACT_VERSION,
    schemaVersion: SDK_CONTRACT_ARTIFACT_VERSION,
    packageVersion,
    commandDescriptorVersion: COMMAND_DESCRIPTOR_VERSION,
    summary: buildCatalogSummary(commandDescriptors, mcpToolDefinitions),
    tools: buildToolCatalog(commandDescriptors, mcpToolDefinitions),
    commandDescriptors,
    registryDigest:
      capabilitiesPayload && capabilitiesPayload.registryDigest ? capabilitiesPayload.registryDigest : {},
    backends,
    schemas: {
      envelope: schemaPayload,
      definitions: schemaPayload && schemaPayload.definitions ? schemaPayload.definitions : {},
    },
    capabilities: capabilitiesPayload,
  });
}

module.exports = {
  SDK_CONTRACT_ARTIFACT_VERSION,
  SDK_ARTIFACT_GENERATED_AT,
  buildSdkContractComponents,
  buildSdkContractArtifact,
};
