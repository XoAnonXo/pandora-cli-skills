/**
 * Implements the `capabilities` command to expose a derived runtime digest of
 * the Pandora command contract registry.
 */

const crypto = require('crypto');
const { buildCommandDescriptors, COMMAND_DESCRIPTOR_VERSION } = require('./agent_contract_registry.cjs');

function sortStrings(values) {
  return Array.from(new Set(Array.isArray(values) ? values : []))
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function sortObjectKeys(record) {
  const source = record && typeof record === 'object' ? record : {};
  const sorted = {};
  for (const key of Object.keys(source).sort((left, right) => left.localeCompare(right))) {
    sorted[key] = source[key];
  }
  return sorted;
}

function stableJsonHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function buildOutputModeMatrix(commandDescriptors) {
  const matrix = {
    jsonOnly: [],
    tableOnly: [],
    tableAndJson: [],
  };

  for (const [commandName, descriptor] of Object.entries(commandDescriptors)) {
    const modes = sortStrings(descriptor && descriptor.outputModes);
    if (modes.length === 1 && modes[0] === 'json') {
      matrix.jsonOnly.push(commandName);
      continue;
    }
    if (modes.length === 1 && modes[0] === 'table') {
      matrix.tableOnly.push(commandName);
      continue;
    }
    matrix.tableAndJson.push(commandName);
  }

  return {
    jsonOnly: sortStrings(matrix.jsonOnly),
    tableOnly: sortStrings(matrix.tableOnly),
    tableAndJson: sortStrings(matrix.tableAndJson),
  };
}

function buildTopLevelCommands(commandDescriptors) {
  const topLevel = {};
  const commandNames = Object.keys(commandDescriptors).sort((left, right) => left.localeCompare(right));

  for (const commandName of commandNames) {
    if (commandName.includes('.')) continue;
    const descriptor = commandDescriptors[commandName] || {};
    topLevel[commandName] = {
      summary: descriptor.summary || null,
      usage: descriptor.usage || null,
      outputModes: sortStrings(descriptor.outputModes),
      childCommands: commandNames.filter((candidate) => candidate.startsWith(`${commandName}.`)),
      mcpExposed: Boolean(descriptor.mcpExposed),
      canonicalTool: descriptor.canonicalTool || null,
      aliasOf: descriptor.aliasOf || null,
      preferred: Boolean(descriptor.preferred),
    };
  }

  return sortObjectKeys(topLevel);
}

function buildNamespaces(commandDescriptors) {
  const namespaces = {};

  for (const [commandName, descriptor] of Object.entries(commandDescriptors)) {
    const [namespaceName] = String(commandName || '').split('.');
    if (!namespaceName) continue;

    if (!namespaces[namespaceName]) {
      const namespaceDescriptor = commandDescriptors[namespaceName] || null;
      namespaces[namespaceName] = {
        summary: namespaceDescriptor && namespaceDescriptor.summary ? namespaceDescriptor.summary : null,
        usage: namespaceDescriptor && namespaceDescriptor.usage ? namespaceDescriptor.usage : null,
        outputModes:
          namespaceDescriptor && namespaceDescriptor.outputModes
            ? sortStrings(namespaceDescriptor.outputModes)
            : [],
        commands: [],
        mcpExposedCommands: [],
      };
    }

    namespaces[namespaceName].commands.push(commandName);
    if (descriptor && descriptor.mcpExposed) {
      namespaces[namespaceName].mcpExposedCommands.push(commandName);
    }
  }

  const normalized = {};
  for (const namespaceName of Object.keys(namespaces).sort((left, right) => left.localeCompare(right))) {
    normalized[namespaceName] = {
      ...namespaces[namespaceName],
      commands: sortStrings(namespaces[namespaceName].commands),
      mcpExposedCommands: sortStrings(namespaces[namespaceName].mcpExposedCommands),
    };
  }
  return normalized;
}

function buildCanonicalTools(commandDescriptors) {
  const canonicalTools = {};

  for (const [commandName, descriptor] of Object.entries(commandDescriptors)) {
    const canonicalTool = descriptor && descriptor.canonicalTool ? descriptor.canonicalTool : null;
    if (!canonicalTool) continue;

    if (!canonicalTools[canonicalTool]) {
      canonicalTools[canonicalTool] = {
        preferredCommand: null,
        commands: [],
      };
    }

    canonicalTools[canonicalTool].commands.push(commandName);
    if (descriptor.preferred) {
      canonicalTools[canonicalTool].preferredCommand = commandName;
    }
  }

  const normalized = {};
  for (const canonicalTool of Object.keys(canonicalTools).sort((left, right) => left.localeCompare(right))) {
    normalized[canonicalTool] = {
      preferredCommand: canonicalTools[canonicalTool].preferredCommand || canonicalTool,
      commands: sortStrings(canonicalTools[canonicalTool].commands),
    };
  }
  return normalized;
}

function buildCommandDigests(commandDescriptors, options = {}) {
  const remoteTransportActive = Boolean(options.remoteTransportActive);
  const digests = {};

  for (const [commandName, descriptor] of Object.entries(commandDescriptors)) {
    digests[commandName] = {
      summary: descriptor && descriptor.summary ? descriptor.summary : null,
      outputModes: sortStrings(descriptor && descriptor.outputModes),
      dataSchema: descriptor && descriptor.dataSchema ? descriptor.dataSchema : null,
      helpDataSchema: descriptor && descriptor.helpDataSchema ? descriptor.helpDataSchema : null,
      mcpExposed: Boolean(descriptor && descriptor.mcpExposed),
      aliasOf: descriptor && descriptor.aliasOf ? descriptor.aliasOf : null,
      canonicalTool: descriptor && descriptor.canonicalTool ? descriptor.canonicalTool : null,
        canonicalCommandTokens:
          descriptor && Array.isArray(descriptor.canonicalCommandTokens)
            ? [...descriptor.canonicalCommandTokens]
            : null,
        emits:
          descriptor && Array.isArray(descriptor.emits)
            ? sortStrings(descriptor.emits)
            : [],
        controlInputNames:
          descriptor && Array.isArray(descriptor.controlInputNames)
            ? sortStrings(descriptor.controlInputNames)
            : [],
        safeFlags:
          descriptor && Array.isArray(descriptor.safeFlags)
            ? sortStrings(descriptor.safeFlags)
            : [],
        executeFlags:
          descriptor && Array.isArray(descriptor.executeFlags)
            ? sortStrings(descriptor.executeFlags)
            : [],
        executeIntentRequired: Boolean(descriptor && descriptor.executeIntentRequired),
        executeIntentRequiredForLiveMode: Boolean(
          descriptor && descriptor.executeIntentRequiredForLiveMode,
        ),
        requiredInputs:
          descriptor
          && descriptor.inputSchema
          && Array.isArray(descriptor.inputSchema.required)
            ? sortStrings(descriptor.inputSchema.required.filter((name) => name !== 'intent'))
            : [],
        preferred: Boolean(descriptor && descriptor.preferred),
      mcpMutating: Boolean(descriptor && descriptor.mcpMutating),
      mcpLongRunningBlocked: Boolean(descriptor && descriptor.mcpLongRunningBlocked),
      riskLevel: descriptor && descriptor.riskLevel ? descriptor.riskLevel : null,
      idempotency: descriptor && descriptor.idempotency ? descriptor.idempotency : null,
      expectedLatencyMs:
        descriptor && Number.isFinite(descriptor.expectedLatencyMs)
          ? descriptor.expectedLatencyMs
          : null,
      requiresSecrets: Boolean(descriptor && descriptor.requiresSecrets),
      recommendedPreflightTool:
        descriptor && descriptor.recommendedPreflightTool ? descriptor.recommendedPreflightTool : null,
      safeEquivalent: descriptor && descriptor.safeEquivalent ? descriptor.safeEquivalent : null,
      externalDependencies:
        descriptor && Array.isArray(descriptor.externalDependencies)
          ? sortStrings(descriptor.externalDependencies)
          : [],
        canRunConcurrent: Boolean(descriptor && descriptor.canRunConcurrent),
        returnsOperationId: Boolean(descriptor && descriptor.returnsOperationId),
        returnsRuntimeHandle: Boolean(descriptor && descriptor.returnsRuntimeHandle),
        jobCapable: Boolean(descriptor && descriptor.jobCapable),
        supportsRemote: Boolean(descriptor && descriptor.supportsRemote),
        remoteEligible: Boolean(descriptor && descriptor.remoteEligible),
        remoteTransportActive: Boolean(descriptor && descriptor.remoteEligible && remoteTransportActive),
        remotePlanned: Boolean(descriptor && descriptor.remoteEligible && !remoteTransportActive),
        supportsWebhook: Boolean(descriptor && descriptor.supportsWebhook),
      policyScopes:
        descriptor && Array.isArray(descriptor.policyScopes)
          ? sortStrings(descriptor.policyScopes)
          : [],
    };
  }

  return sortObjectKeys(digests);
}

function buildSummary(commandDescriptors, outputModeMatrix) {
  const descriptorList = Object.entries(commandDescriptors);
  return {
    totalCommands: descriptorList.length,
    topLevelCommands: Object.keys(commandDescriptors).filter((commandName) => !commandName.includes('.')).length,
    aliases: descriptorList.filter(([, descriptor]) => descriptor && descriptor.aliasOf).length,
    mcpExposedCommands: descriptorList.filter(([, descriptor]) => descriptor && descriptor.mcpExposed).length,
    mcpMutatingCommands: descriptorList.filter(([, descriptor]) => descriptor && descriptor.mcpMutating).length,
    mcpLongRunningBlockedCommands: descriptorList.filter(
      ([, descriptor]) => descriptor && descriptor.mcpLongRunningBlocked,
    ).length,
    jsonOnlyCommands: outputModeMatrix.jsonOnly.length,
    tableOnlyCommands: outputModeMatrix.tableOnly.length,
    tableAndJsonCommands: outputModeMatrix.tableAndJson.length,
  };
}

function buildTransports(options = {}) {
  const remoteTransportActive = Boolean(options.remoteTransportActive);
  const remoteTransportUrl =
    typeof options.remoteTransportUrl === 'string' && options.remoteTransportUrl.trim()
      ? options.remoteTransportUrl.trim()
      : null;
  const remoteTransportNotes = remoteTransportActive
    ? [
        'Remote streamable HTTP MCP gateway is active in this runtime.',
        ...(remoteTransportUrl ? [`Endpoint: ${remoteTransportUrl}`] : []),
      ]
    : ['Remote streamable HTTP MCP gateway is shipped in this build but inactive until `pandora mcp http` is running.'];
  return {
    cliJson: {
      supported: true,
      status: 'active',
      notes: ['Reference local machine-consumable transport.'],
    },
    mcpStdio: {
      supported: true,
      status: 'active',
      notes: ['Current MCP transport for Pandora is stdio.'],
    },
    mcpStreamableHttp: {
      supported: true,
      status: remoteTransportActive ? 'active' : 'inactive',
      ...(remoteTransportUrl ? { endpoint: remoteTransportUrl } : {}),
      notes: remoteTransportNotes,
    },
    sdk: {
      supported: false,
      status: 'planned',
      notes: ['Generated agent SDKs are planned, not shipped in this build.'],
    },
  };
}

function buildPolicyProfilesStatus(commandDescriptors) {
  const policyScopedCommands = Object.entries(commandDescriptors)
    .filter(([, descriptor]) => descriptor && Array.isArray(descriptor.policyScopes) && descriptor.policyScopes.length)
    .map(([name]) => name);
  const secretCommands = Object.entries(commandDescriptors)
    .filter(([, descriptor]) => descriptor && descriptor.requiresSecrets)
    .map(([name]) => name);
  return {
    policyPacks: {
      supported: false,
      status: 'planned',
      notes: ['Policy pack enforcement is planned. Current contracts expose policyScopes metadata only.'],
      commandsWithPolicyScopes: sortStrings(policyScopedCommands),
    },
    signerProfiles: {
      supported: false,
      status: 'planned',
      notes: ['Named signer profiles are planned. Current commands still resolve credentials from flags/env.'],
      commandsRequiringSecrets: sortStrings(secretCommands),
    },
  };
}

function buildOperationProtocolStatus(commandDescriptors) {
  const operationReadyCommands = Object.entries(commandDescriptors)
    .filter(([, descriptor]) => descriptor && descriptor.returnsOperationId)
    .map(([name]) => name);
  const jobCapableCommands = Object.entries(commandDescriptors)
    .filter(([, descriptor]) => descriptor && descriptor.jobCapable)
    .map(([name]) => name);
  return {
    supported: operationReadyCommands.length > 0,
    status: operationReadyCommands.length > 0 ? 'partial' : 'planned',
    notes: operationReadyCommands.length > 0
      ? ['Operation identifiers are partially available and should be expanded into a full plan/validate/execute/status protocol.']
      : ['Operation protocol is planned. Current contracts expose jobCapable/returnsOperationId metadata only.'],
    operationReadyCommands: sortStrings(operationReadyCommands),
    jobCapableCommands: sortStrings(jobCapableCommands),
  };
}

function buildVersionCompatibility(options = {}) {
  const remoteTransportActive = Boolean(options.remoteTransportActive);
  return {
    commandDescriptorVersion: COMMAND_DESCRIPTOR_VERSION,
    schemaCommand: 'pandora --output json schema',
    capabilitiesCommand: 'pandora --output json capabilities',
    mcpTransport: remoteTransportActive ? 'stdio+streamable-http' : 'stdio',
    notes: [
      'Schema and capabilities are generated from the same shared contract registry.',
      remoteTransportActive
        ? 'Remote streamable HTTP MCP is active in this runtime.'
        : 'Remote streamable HTTP MCP is shipped in this build but inactive until the gateway is started.',
    ],
  };
}

function buildRoadmapSignals(commandDescriptors, options = {}) {
  const remoteTransportActive = Boolean(options.remoteTransportActive);
  const descriptors = Object.values(commandDescriptors);
  return {
    remoteEligibleCommands: descriptors.filter((descriptor) => descriptor && descriptor.remoteEligible).length,
    jobCapableCommands: descriptors.filter((descriptor) => descriptor && descriptor.jobCapable).length,
    secretBearingCommands: descriptors.filter((descriptor) => descriptor && descriptor.requiresSecrets).length,
    operationReadyCommands: descriptors.filter((descriptor) => descriptor && descriptor.returnsOperationId).length,
    notes: [
      remoteTransportActive
        ? 'Eligibility metadata and remote transport are both active in this runtime.'
        : 'Eligibility metadata describes command contract shape, and the remote HTTP gateway is shipped but inactive until started.',
      remoteTransportActive
        ? 'SDKs, policy packs, and a fuller operation protocol remain roadmap items.'
        : 'Generated SDKs, policy packs, and a fuller operation protocol remain roadmap items.',
    ],
  };
}

function buildRegistryDigest(commandDescriptors, commandDigests) {
  const canonicalTools = buildCanonicalTools(commandDescriptors);
  const topLevelCommands = buildTopLevelCommands(commandDescriptors);
  const namespaces = buildNamespaces(commandDescriptors);
  return {
    descriptorHash: stableJsonHash(commandDescriptors),
    commandDigestHash: stableJsonHash(commandDigests),
    canonicalHash: stableJsonHash(canonicalTools),
    topLevelHash: stableJsonHash(topLevelCommands),
    namespaceHash: stableJsonHash(namespaces),
  };
}

function buildCapabilitiesPayload(options = {}) {
  const commandDescriptors = sortObjectKeys(buildCommandDescriptors());
  const transports = buildTransports(options);
  const remoteTransportActive = Boolean(options.remoteTransportActive)
    || Object.entries(transports).some(
      ([name, transport]) =>
        !['cliJson', 'mcpStdio'].includes(name)
        && transport
        && transport.supported === true
        && String(transport.status || '').toLowerCase() === 'active',
    );
  const commandDigests = buildCommandDigests(commandDescriptors, { remoteTransportActive });
  const outputModeMatrix = buildOutputModeMatrix(commandDescriptors);
  return {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    title: 'PandoraCliCapabilities',
    description: 'Runtime capability digest derived from the Pandora command contract registry.',
    source: 'agent_contract_registry',
    commandDescriptorVersion: COMMAND_DESCRIPTOR_VERSION,
    summary: buildSummary(commandDescriptors, outputModeMatrix),
    transports,
    roadmapSignals: buildRoadmapSignals(commandDescriptors, { remoteTransportActive }),
    policyProfiles: buildPolicyProfilesStatus(commandDescriptors),
    operationProtocol: buildOperationProtocolStatus(commandDescriptors),
    versionCompatibility: buildVersionCompatibility({ remoteTransportActive }),
    outputModeMatrix,
    topLevelCommands: buildTopLevelCommands(commandDescriptors),
    namespaces: buildNamespaces(commandDescriptors),
    canonicalTools: buildCanonicalTools(commandDescriptors),
    commandDigests,
    registryDigest: buildRegistryDigest(commandDescriptors, commandDigests),
  };
}

function createRunCapabilitiesCommand(deps) {
  const { emitSuccess, CliError } = deps || {};

  if (typeof emitSuccess !== 'function') {
    throw new Error('createRunCapabilitiesCommand requires emitSuccess');
  }

  if (typeof CliError !== 'function') {
    throw new Error('createRunCapabilitiesCommand requires CliError');
  }

  function runCapabilitiesCommand(args, context) {
    if (Array.isArray(args) && (args.includes('--help') || args.includes('-h'))) {
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'capabilities.help', {
          usage: 'pandora --output json capabilities',
          notes: [
            'The capabilities payload is derived from the same command contract registry that powers pandora schema.',
            'Use schema for the full JSON Schema envelope definitions and exact per-command input schemas.',
            'Use capabilities for the compact runtime digest, canonical tool routing, and policy/readiness metadata.',
          ],
          commandDescriptorVersion: COMMAND_DESCRIPTOR_VERSION,
        });
      } else {
        // eslint-disable-next-line no-console
        console.log('Usage: pandora --output json capabilities');
        // eslint-disable-next-line no-console
        console.log('');
        // eslint-disable-next-line no-console
        console.log('Notes:');
        // eslint-disable-next-line no-console
        console.log('  - capabilities payload is available only in --output json mode.');
        // eslint-disable-next-line no-console
        console.log('  - It is derived from the same command contract registry used by pandora schema.');
        // eslint-disable-next-line no-console
        console.log('  - capabilities is the compact discovery digest; schema remains the full contract surface.');
      }
      return;
    }

    if (context.outputMode !== 'json') {
      throw new CliError('INVALID_USAGE', 'The capabilities command is only supported in --output json mode.', {
        hints: ['Run `pandora --output json capabilities`'],
      });
    }

    if (Array.isArray(args) && args.length > 0) {
      throw new CliError(
        'INVALID_ARGS',
        'capabilities does not accept additional flags or positional arguments.',
        {
          hints: ['Run `pandora --output json capabilities` without extra arguments.'],
        },
      );
    }

    emitSuccess(context.outputMode, 'capabilities', buildCapabilitiesPayload());
  }

  return { runCapabilitiesCommand };
}

module.exports = {
  buildCapabilitiesPayload,
  createRunCapabilitiesCommand,
};
