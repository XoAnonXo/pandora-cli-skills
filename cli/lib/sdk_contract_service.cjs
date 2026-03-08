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

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

function getTrustDistribution(capabilitiesPayload) {
  if (
    !isPlainObject(capabilitiesPayload)
    || !isPlainObject(capabilitiesPayload.trustDistribution)
    || !isPlainObject(capabilitiesPayload.trustDistribution.distribution)
  ) {
    return {};
  }
  return capabilitiesPayload.trustDistribution.distribution;
}

function buildPublishedSdkSurfaceMetadata(capabilitiesPayload) {
  const distribution = getTrustDistribution(capabilitiesPayload);
  const rootPackage = isPlainObject(distribution.rootPackage) ? distribution.rootPackage : {};
  const embeddedSdks = isPlainObject(distribution.embeddedSdks) ? distribution.embeddedSdks : {};
  const surfaces = {};

  if (Object.keys(rootPackage).length) {
    surfaces.root = sortObjectKeys({
      artifactSubpaths: {
        bundle: 'sdk/generated/contract-registry.json',
        commandDescriptors: 'sdk/generated/command-descriptors.json',
        entrypoint: 'sdk/generated/index.js',
        manifest: 'sdk/generated/manifest.json',
        mcpToolDefinitions: 'sdk/generated/mcp-tool-definitions.json',
        types: 'sdk/generated/index.d.ts',
      },
      binNames: sortStrings(rootPackage.binNames),
      exportSubpaths: sortStrings(rootPackage.exportSubpaths),
      format: 'node',
      main: normalizeString(rootPackage.main),
      name: normalizeString(rootPackage.name),
      sourceProjectPath: 'package.json',
      version: normalizeString(rootPackage.version),
    });
  }

  if (isPlainObject(embeddedSdks.typescript)) {
    const typescript = embeddedSdks.typescript;
    surfaces.typescript = sortObjectKeys({
      artifactSubpaths: {
        bundle: 'generated/contract-registry.json',
        commandDescriptors: 'generated/command-descriptors.json',
        entrypoint: 'index.js',
        manifest: 'generated/manifest.json',
        mcpToolDefinitions: 'generated/mcp-tool-definitions.json',
        types: 'index.d.ts',
      },
      exportSubpaths: sortStrings(typescript.exportSubpaths),
      format: 'node',
      name: normalizeString(typescript.packageName),
      sourceProjectPath: normalizeString(typescript.packagePath),
      version: normalizeString(typescript.version),
    });
  }

  if (isPlainObject(embeddedSdks.python)) {
    const python = embeddedSdks.python;
    surfaces.python = sortObjectKeys({
      artifactSubpaths: {
        bundle: 'pandora_agent/generated/contract-registry.json',
        commandDescriptors: 'pandora_agent/generated/command-descriptors.json',
        manifest: 'pandora_agent/generated/manifest.json',
        mcpToolDefinitions: 'pandora_agent/generated/mcp-tool-definitions.json',
      },
      format: 'python',
      module: 'pandora_agent',
      name: normalizeString(python.packageName),
      sourceProjectPath: normalizeString(python.projectPath),
      version: normalizeString(python.version),
    });
  }

  return Object.keys(surfaces).length ? sortObjectKeys(surfaces) : null;
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

function buildGeneratedToolDefinitions(remoteTransportActive, options = {}) {
  const includeCompatibilityAliases = Boolean(options.includeCompatibilityAliases);
  const aliasesOnly = Boolean(options.aliasesOnly);
  return createMcpToolRegistry({ remoteTransportActive })
    .listTools({ includeCompatibilityAliases })
    .filter((definition) => {
      if (!aliasesOnly) return true;
      const xPandora = getToolXPandora(definition);
      return Boolean(xPandora && xPandora.aliasOf);
    })
    .map((definition) => buildGeneratedToolDefinition(definition))
    .filter(Boolean)
    .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
}

function splitCommandDescriptorsByCompatibility(commandDescriptors) {
  const canonical = {};
  const compatibility = {};
  for (const [commandName, descriptor] of Object.entries(commandDescriptors || {})) {
    if (descriptor && descriptor.aliasOf) {
      compatibility[commandName] = descriptor;
      continue;
    }
    canonical[commandName] = descriptor;
  }
  return {
    canonical: sortObjectKeys(canonical),
    compatibility: sortObjectKeys(compatibility),
  };
}

function buildCompatibilityCatalogSummary(commandDescriptors, mcpToolDefinitions) {
  const descriptorNames = Object.keys(commandDescriptors || {});
  const toolNames = (Array.isArray(mcpToolDefinitions) ? mcpToolDefinitions : [])
    .map((definition) => String(definition && definition.name ? definition.name : '').trim())
    .filter(Boolean);
  return {
    mode: 'compatibility-aliases',
    aliasCommands: descriptorNames.length,
    aliasTools: toolNames.length,
    available: descriptorNames.length > 0 || toolNames.length > 0,
  };
}

function buildSdkBackendMetadata(capabilitiesPayload) {
  const transports = capabilitiesPayload && isPlainObject(capabilitiesPayload.transports)
    ? capabilitiesPayload.transports
    : {};
  const stdio = isPlainObject(transports.mcpStdio) ? transports.mcpStdio : {};
  const remote = isPlainObject(transports.mcpStreamableHttp) ? transports.mcpStreamableHttp : {};
  const sdk = isPlainObject(transports.sdk) ? transports.sdk : {};
  const publishedSdkSurfaces = buildPublishedSdkSurfaceMetadata(capabilitiesPayload);
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
      notes: sortStrings([
        'Generated SDK catalogs default to canonical-only command and tool surfaces.',
        'Compatibility aliases are available only through the explicit contractRegistry.compatibility surface.',
        ...sortStrings(sdk.notes),
      ]),
      publishedPackages: publishedSdkSurfaces,
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

  const allCommandDescriptors = sortObjectKeys(buildCommandDescriptors());
  const splitDescriptors = splitCommandDescriptorsByCompatibility(allCommandDescriptors);
  const commandDescriptors = splitDescriptors.canonical;
  const compatibilityCommandDescriptors = splitDescriptors.compatibility;
  const mcpToolDefinitions = buildGeneratedToolDefinitions(remoteTransportActive);
  const compatibilityMcpToolDefinitions = buildGeneratedToolDefinitions(remoteTransportActive, {
    includeCompatibilityAliases: true,
    aliasesOnly: true,
  });
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
    artifactNeutralProfileReadiness: true,
    stableArtifactTrustDistribution: true,
  });
  const backends = buildSdkBackendMetadata(capabilitiesPayload);

  return {
    packageVersion,
    remoteTransportActive,
    remoteTransportUrl,
    allCommandDescriptors,
    commandDescriptors,
    compatibilityCommandDescriptors,
    mcpToolDefinitions,
    compatibilityMcpToolDefinitions,
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

function buildCatalogSummary(commandDescriptors, mcpToolDefinitions, options = {}) {
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
    defaultCatalogMode: typeof options.defaultCatalogMode === 'string' ? options.defaultCatalogMode : 'canonical-only',
    compatibilityRegistryPath:
      options.compatibility && options.compatibility.available
        ? 'compatibility'
        : null,
    compatibilityAliasCommands:
      options.compatibility && Number.isInteger(options.compatibility.aliasCommands)
        ? options.compatibility.aliasCommands
        : 0,
    compatibilityAliasTools:
      options.compatibility && Number.isInteger(options.compatibility.aliasTools)
        ? options.compatibility.aliasTools
        : 0,
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
    compatibilityCommandDescriptors,
    mcpToolDefinitions,
    compatibilityMcpToolDefinitions,
    schemaPayload,
    capabilitiesPayload,
    backends,
  } = buildSdkContractComponents(options);
  const compatibility = {
    mode: 'explicit',
    commandDescriptors: compatibilityCommandDescriptors,
    mcpToolDefinitions: compatibilityMcpToolDefinitions,
    tools: buildToolCatalog(compatibilityCommandDescriptors, compatibilityMcpToolDefinitions),
    summary: buildCompatibilityCatalogSummary(compatibilityCommandDescriptors, compatibilityMcpToolDefinitions),
  };
  const compatibilitySummary = compatibility.summary;

  return sortObjectKeys({
    artifactVersion: SDK_CONTRACT_ARTIFACT_VERSION,
    schemaVersion: SDK_CONTRACT_ARTIFACT_VERSION,
    packageVersion,
    commandDescriptorVersion: COMMAND_DESCRIPTOR_VERSION,
    summary: buildCatalogSummary(commandDescriptors, mcpToolDefinitions, {
      defaultCatalogMode: 'canonical-only',
      compatibility: compatibilitySummary,
    }),
    tools: buildToolCatalog(commandDescriptors, mcpToolDefinitions),
    commandDescriptors,
    compatibility,
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
  buildPublishedSdkSurfaceMetadata,
  buildSdkContractComponents,
  buildSdkContractArtifact,
};
