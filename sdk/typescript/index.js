'use strict';

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
let generated = null;
try {
  generated = require('./generated/index.js');
} catch {
  generated = require('../generated/index.js');
}

class PandoraSdkError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'PandoraSdkError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
      if (!Object.prototype.hasOwnProperty.call(this, 'cause') && details && details.cause !== undefined) {
        this.cause = details.cause;
      }
    }
  }
}

class PandoraToolCallError extends PandoraSdkError {
  constructor(message, details = undefined) {
    const detailObject = asObject(details) || {};
    const envelope = asObject(detailObject.envelope);
    const envelopeError = asObject(envelope && envelope.error);
    const code = typeof (envelopeError && envelopeError.code) === 'string' && envelopeError.code.trim()
      ? envelopeError.code.trim()
      : 'PANDORA_SDK_TOOL_ERROR';
    super(code, message, detailObject);
    this.name = 'PandoraToolCallError';
    this.sdkCode = 'PANDORA_SDK_TOOL_ERROR';
    this.envelope = envelope;
    this.rawResult = detailObject.result || null;
    this.toolName = typeof detailObject.toolName === 'string' && detailObject.toolName.trim()
      ? detailObject.toolName.trim()
      : null;
    this.toolError = envelopeError || null;
  }
}

function createSdkError(code, message, details = undefined) {
  return new PandoraSdkError(code, message, details);
}

function wrapSdkOperationError(code, message, error, details = undefined) {
  if (error instanceof PandoraSdkError) {
    throw error;
  }
  throw createSdkError(code, message, {
    ...asObject(details),
    cause: error,
    message: error && error.message ? error.message : String(error),
  });
}

function normalizeToolName(name) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) {
    throw createSdkError('PANDORA_SDK_INVALID_TOOL_NAME', 'Tool name is required.');
  }
  return normalizedName;
}

function parseStructuredEnvelope(result) {
  if (result && result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent;
  }
  const textContent = Array.isArray(result && result.content)
    ? result.content.find((entry) => entry && entry.type === 'text' && typeof entry.text === 'string')
    : null;
  if (!textContent) {
    throw createSdkError('PANDORA_SDK_INVALID_TOOL_RESULT', 'Tool result did not include structuredContent or parseable text.', {
      result,
    });
  }
  try {
    return JSON.parse(textContent.text);
  } catch (error) {
    throw createSdkError('PANDORA_SDK_INVALID_TOOL_RESULT', 'Tool text payload was not valid JSON.', {
      cause: error && error.message ? error.message : String(error),
    });
  }
}

function isFailureEnvelope(envelope) {
  const normalizedEnvelope = asObject(envelope);
  if (!normalizedEnvelope) return false;
  if (normalizedEnvelope.ok === false) return true;
  return Boolean(asObject(normalizedEnvelope.error));
}

function normalizeStructuredEnvelope(result, options = {}) {
  const envelope = parseStructuredEnvelope(result);
  if (!options || options.throwOnError !== false) {
    if (result && result.isError || isFailureEnvelope(envelope)) {
      const errorPayload = asObject(envelope && envelope.error);
      const message = errorPayload && typeof errorPayload.message === 'string' && errorPayload.message.trim()
        ? errorPayload.message.trim()
        : 'Pandora tool returned an MCP error result.';
      throw new PandoraToolCallError(message, {
        ...asObject(options),
        result,
        envelope,
      });
    }
  }
  return envelope;
}

function buildCatalogIndex(catalog) {
  const tools = catalog && catalog.tools && typeof catalog.tools === 'object' ? catalog.tools : {};
  return new Map(Object.entries(tools));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function toSortedUniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(
    values
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )).sort((left, right) => left.localeCompare(right));
}

function loadGeneratedValue(loaderName, propertyName) {
  if (generated && typeof generated[loaderName] === 'function') {
    return generated[loaderName]();
  }
  if (generated && Object.prototype.hasOwnProperty.call(generated, propertyName)) {
    return generated[propertyName];
  }
  throw createSdkError(
    'PANDORA_SDK_MISSING_GENERATED_ARTIFACT',
    `Generated SDK artifact is missing ${propertyName}.`,
  );
}

function buildCommandDescriptorIndex(catalog) {
  const index = new Map();
  const commandDescriptors = asObject(catalog && catalog.commandDescriptors);
  if (commandDescriptors) {
    for (const [name, descriptor] of Object.entries(commandDescriptors)) {
      if (asObject(descriptor)) {
        index.set(name, descriptor);
      }
    }
  }

  const tools = asObject(catalog && catalog.tools);
  if (tools) {
    for (const [name, tool] of Object.entries(tools)) {
      const descriptor = asObject(tool && tool.commandDescriptor);
      if (descriptor && !index.has(name)) {
        index.set(name, descriptor);
      }
    }
  }

  const commandDigests = asObject(getCatalogCapabilities(catalog).commandDigests);
  if (commandDigests) {
    for (const [name, descriptor] of Object.entries(commandDigests)) {
      if (asObject(descriptor) && !index.has(name)) {
        index.set(name, descriptor);
      }
    }
  }

  return index;
}

function getCatalogCapabilities(catalog) {
  return asObject(catalog && catalog.capabilities) || {};
}

function getRawPolicyProfiles(catalog) {
  return asObject(getCatalogCapabilities(catalog).policyProfiles) || {};
}

function getCommandDescriptor(catalog, name) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) return null;
  const commandDescriptors = buildCommandDescriptorIndex(catalog);
  return commandDescriptors.get(normalizedName) || null;
}

function getPolicyScopeListFromDescriptor(descriptor) {
  return toSortedUniqueStrings(descriptor && descriptor.policyScopes);
}

function derivePolicyScopedCommands(catalog) {
  const rawPolicyProfiles = getRawPolicyProfiles(catalog);
  const explicit = toSortedUniqueStrings(rawPolicyProfiles.policyPacks && rawPolicyProfiles.policyPacks.commandsWithPolicyScopes);
  if (explicit.length) return explicit;

  const commandDescriptors = buildCommandDescriptorIndex(catalog);
  return Array.from(commandDescriptors.entries())
    .filter(([, descriptor]) => getPolicyScopeListFromDescriptor(descriptor).length > 0)
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right));
}

function deriveSignerProfileCommands(catalog) {
  const rawPolicyProfiles = getRawPolicyProfiles(catalog);
  const explicit = toSortedUniqueStrings(rawPolicyProfiles.signerProfiles && rawPolicyProfiles.signerProfiles.commandsRequiringSecrets);
  if (explicit.length) return explicit;

  const commandDescriptors = buildCommandDescriptorIndex(catalog);
  return Array.from(commandDescriptors.entries())
    .filter(([, descriptor]) => descriptor && descriptor.requiresSecrets === true)
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right));
}

function normalizeCapabilityFeature(feature, defaults = {}) {
  const raw = asObject(feature) || {};
  const fallbackStatus = typeof defaults.status === 'string' && defaults.status.trim()
    ? defaults.status.trim()
    : raw.supported === true
      ? 'active'
      : 'unknown';
  const fallbackNotes = toSortedUniqueStrings(defaults.notes);
  const notes = toSortedUniqueStrings(raw.notes);
  const normalized = {
    ...raw,
    supported: typeof raw.supported === 'boolean' ? raw.supported : Boolean(defaults.supported),
    status: typeof raw.status === 'string' && raw.status.trim() ? raw.status.trim() : fallbackStatus,
    notes: notes.length ? notes : fallbackNotes,
  };
  if (Object.prototype.hasOwnProperty.call(defaults, 'commandsWithPolicyScopes') || Object.prototype.hasOwnProperty.call(raw, 'commandsWithPolicyScopes')) {
    const commands = toSortedUniqueStrings(raw.commandsWithPolicyScopes);
    normalized.commandsWithPolicyScopes = commands.length
      ? commands
      : toSortedUniqueStrings(defaults.commandsWithPolicyScopes);
  }
  if (Object.prototype.hasOwnProperty.call(defaults, 'commandsRequiringSecrets') || Object.prototype.hasOwnProperty.call(raw, 'commandsRequiringSecrets')) {
    const commands = toSortedUniqueStrings(raw.commandsRequiringSecrets);
    normalized.commandsRequiringSecrets = commands.length
      ? commands
      : toSortedUniqueStrings(defaults.commandsRequiringSecrets);
  }
  return normalized;
}

function getPolicyProfileCapabilities(catalog = loadGeneratedContractRegistry()) {
  const rawPolicyProfiles = getRawPolicyProfiles(catalog);
  return {
    policyPacks: normalizeCapabilityFeature(rawPolicyProfiles.policyPacks, {
      commandsWithPolicyScopes: derivePolicyScopedCommands(catalog),
    }),
    signerProfiles: normalizeCapabilityFeature(rawPolicyProfiles.signerProfiles, {
      commandsRequiringSecrets: deriveSignerProfileCommands(catalog),
    }),
  };
}

function getPolicyPackCapability(catalog = loadGeneratedContractRegistry()) {
  return getPolicyProfileCapabilities(catalog).policyPacks;
}

function getSignerProfileCapability(catalog = loadGeneratedContractRegistry()) {
  return getPolicyProfileCapabilities(catalog).signerProfiles;
}

function listPolicyScopes(catalog = loadGeneratedContractRegistry()) {
  const commandDescriptors = buildCommandDescriptorIndex(catalog);
  const scopes = new Set();
  for (const descriptor of commandDescriptors.values()) {
    for (const scope of getPolicyScopeListFromDescriptor(descriptor)) {
      scopes.add(scope);
    }
  }
  return Array.from(scopes).sort((left, right) => left.localeCompare(right));
}

function listPolicyScopedCommands(catalog = loadGeneratedContractRegistry()) {
  return getPolicyPackCapability(catalog).commandsWithPolicyScopes.slice();
}

function listSignerProfileCommands(catalog = loadGeneratedContractRegistry()) {
  return getSignerProfileCapability(catalog).commandsRequiringSecrets.slice();
}

function inspectToolPolicySurface(name, catalog = loadGeneratedContractRegistry()) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) {
    throw createSdkError('PANDORA_SDK_INVALID_TOOL_NAME', 'Tool name is required for policy/profile inspection.');
  }

  const tools = buildCatalogIndex(catalog);
  const tool = tools.get(normalizedName) || null;
  const descriptor = asObject(tool && tool.commandDescriptor) || getCommandDescriptor(catalog, normalizedName) || {};
  if (!tool && !Object.keys(descriptor).length) {
    throw createSdkError('PANDORA_SDK_UNKNOWN_TOOL', `Unknown Pandora tool or command: ${normalizedName}`);
  }
  const policyProfiles = getPolicyProfileCapabilities(catalog);
  const policyScopes = getPolicyScopeListFromDescriptor(descriptor);
  const requiresSecrets = descriptor.requiresSecrets === true;

  return {
    name: normalizedName,
    canonicalTool: descriptor.canonicalTool || normalizedName,
    aliasOf: descriptor.aliasOf || null,
    preferred: descriptor.preferred === true,
    policyScopes,
    requiresSecrets,
    policyPackEligible: policyScopes.length > 0,
    signerProfileEligible: requiresSecrets,
    supportsRemote: descriptor.supportsRemote === true,
    remoteEligible: descriptor.remoteEligible === true,
    policyPackStatus: policyProfiles.policyPacks.status,
    signerProfileStatus: policyProfiles.signerProfiles.status,
  };
}

function inspectPolicyScope(scope, catalog = loadGeneratedContractRegistry()) {
  const normalizedScope = String(scope || '').trim();
  if (!normalizedScope) {
    throw createSdkError('PANDORA_SDK_INVALID_POLICY_SCOPE', 'Policy scope is required.');
  }

  const commandDescriptors = buildCommandDescriptorIndex(catalog);
  const commands = Array.from(commandDescriptors.entries())
    .filter(([, descriptor]) => getPolicyScopeListFromDescriptor(descriptor).includes(normalizedScope))
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right));

  return {
    scope: normalizedScope,
    commands,
    tools: commands.map((name) => inspectToolPolicySurface(name, catalog)),
  };
}

function loadGeneratedContractRegistry() {
  return loadGeneratedValue('loadGeneratedContractRegistry', 'contractRegistry');
}

function loadGeneratedManifest() {
  return loadGeneratedValue('loadGeneratedManifest', 'manifest');
}

function loadGeneratedCommandDescriptors() {
  return loadGeneratedValue('loadGeneratedCommandDescriptors', 'commandDescriptors');
}

function loadGeneratedMcpToolDefinitions() {
  return loadGeneratedValue('loadGeneratedMcpToolDefinitions', 'mcpToolDefinitions');
}

function normalizeRuntimeToolDefinition(tool, catalog = loadGeneratedContractRegistry()) {
  const rawTool = asObject(tool) || {};
  const name = typeof rawTool.name === 'string' && rawTool.name.trim()
    ? rawTool.name.trim()
    : '';
  const inputSchema = asObject(rawTool.inputSchema) || {};
  const runtimeMetadata = asObject(inputSchema.xPandora) || asObject(rawTool.xPandora);
  const descriptor = asObject(rawTool.commandDescriptor) || getCommandDescriptor(catalog, name) || null;
  const xPandora = runtimeMetadata || descriptor;

  return {
    ...rawTool,
    name,
    description: typeof rawTool.description === 'string' ? rawTool.description : null,
    inputSchema,
    xPandora: xPandora || null,
    commandDescriptor: descriptor,
    policyScopes: xPandora ? getPolicyScopeListFromDescriptor(xPandora) : [],
    requiresSecrets: Boolean(xPandora && xPandora.requiresSecrets === true),
    supportsRemote: Boolean(xPandora && xPandora.supportsRemote === true),
    remoteEligible: Boolean(xPandora && xPandora.remoteEligible === true),
    canonicalTool: xPandora && typeof xPandora.canonicalTool === 'string' ? xPandora.canonicalTool : null,
    aliasOf: xPandora && typeof xPandora.aliasOf === 'string' ? xPandora.aliasOf : null,
    preferred: Boolean(xPandora && xPandora.preferred === true),
  };
}

function normalizeAuthorizationHeaders(headers = {}, authToken = null) {
  const entries = Object.entries(headers || {}).filter(([key]) => typeof key === 'string' && key.trim());
  const authorizationEntries = entries.filter(([key]) => key.toLowerCase() === 'authorization');
  if (authorizationEntries.length > 1) {
    throw createSdkError(
      'PANDORA_SDK_INVALID_REMOTE_CONFIG',
      'Remote backend received multiple Authorization header variants. Provide only one authorization header.',
      {
        headerKeys: authorizationEntries.map(([key]) => key),
      },
    );
  }
  if (authToken && authorizationEntries.length) {
    throw createSdkError(
      'PANDORA_SDK_INVALID_REMOTE_CONFIG',
      'Remote backend cannot accept authToken together with an explicit Authorization header.',
      {
        headerKey: authorizationEntries[0][0],
      },
    );
  }
  const normalized = {};
  for (const [key, value] of entries) {
    normalized[key] = value;
  }
  if (authorizationEntries.length === 1) {
    const [[originalKey, authorizationValue]] = authorizationEntries;
    if (originalKey !== 'Authorization') {
      delete normalized[originalKey];
      normalized.Authorization = authorizationValue;
    }
  }
  return normalized;
}

class PandoraMcpBackend {
  constructor(options = {}) {
    this.clientInfo = {
      name: options.clientName || 'pandora-agent-sdk',
      version: options.clientVersion || '0.1.0-alpha.1',
    };
    this.client = null;
    this.transport = null;
  }

  async connect() {
    if (this.client) return;
    const transport = this.createTransport();
    const client = new Client(this.clientInfo, {
      capabilities: {},
    });
    try {
      await client.connect(transport);
    } catch (error) {
      if (transport && typeof transport.close === 'function') {
        await transport.close().catch(() => {});
      }
      wrapSdkOperationError(
        'PANDORA_SDK_CONNECT_FAILED',
        'Failed to connect Pandora MCP backend.',
        error,
        {
          backend: this.constructor && this.constructor.name ? this.constructor.name : 'PandoraMcpBackend',
        },
      );
    }
    this.transport = transport;
    this.client = client;
  }

  async close() {
    if (this.transport && typeof this.transport.close === 'function') {
      await this.transport.close();
    }
    this.transport = null;
    this.client = null;
  }

  async listTools() {
    if (!this.client) {
      throw createSdkError('PANDORA_SDK_NOT_CONNECTED', 'Call connect() before listTools().');
    }
    try {
      const result = await this.client.listTools();
      return Array.isArray(result && result.tools) ? result.tools : [];
    } catch (error) {
      wrapSdkOperationError(
        'PANDORA_SDK_LIST_TOOLS_FAILED',
        'Failed to list Pandora MCP tools.',
        error,
        {
          backend: this.constructor && this.constructor.name ? this.constructor.name : 'PandoraMcpBackend',
        },
      );
    }
  }

  async callTool(name, args = {}) {
    if (!this.client) {
      throw createSdkError('PANDORA_SDK_NOT_CONNECTED', 'Call connect() before callTool().');
    }
    const normalizedName = normalizeToolName(name);
    try {
      return await this.client.callTool({ name: normalizedName, arguments: args });
    } catch (error) {
      wrapSdkOperationError(
        'PANDORA_SDK_CALL_FAILED',
        `Failed to call Pandora tool: ${normalizedName}`,
        error,
        {
          backend: this.constructor && this.constructor.name ? this.constructor.name : 'PandoraMcpBackend',
          toolName: normalizedName,
        },
      );
    }
  }
}

class PandoraStdioBackend extends PandoraMcpBackend {
  constructor(options = {}) {
    super(options);
    this.command = options.command || 'pandora';
    this.args = Array.isArray(options.args) && options.args.length ? options.args.slice() : ['mcp'];
    this.cwd = options.cwd || process.cwd();
    this.env = options.env && typeof options.env === 'object' ? { ...options.env } : undefined;
    this.stderr = options.stderr || 'inherit';
  }

  createTransport() {
    return new StdioClientTransport({
      command: this.command,
      args: this.args,
      cwd: this.cwd,
      env: this.env,
      stderr: this.stderr,
    });
  }
}

class PandoraRemoteBackend extends PandoraMcpBackend {
  constructor(options = {}) {
    super(options);
    if (!options.url) {
      throw createSdkError('PANDORA_SDK_INVALID_REMOTE_CONFIG', 'Remote backend requires url.');
    }
    this.url = options.url instanceof URL ? options.url : new URL(String(options.url));
    this.authToken = options.authToken || null;
    this.headers = normalizeAuthorizationHeaders(
      options.headers && typeof options.headers === 'object' ? { ...options.headers } : {},
      this.authToken,
    );
    this.fetch = typeof options.fetch === 'function' ? options.fetch : undefined;
  }

  createTransport() {
    const headers = { ...this.headers };
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }
    return new StreamableHTTPClientTransport(this.url, {
      fetch: this.fetch,
      requestInit: {
        headers,
      },
    });
  }
}

class PandoraAgentClient {
  constructor(options = {}) {
    if (!options.backend) {
      throw createSdkError('PANDORA_SDK_INVALID_CLIENT_CONFIG', 'PandoraAgentClient requires a backend instance.');
    }
    this.backend = options.backend;
    this.catalog = options.catalog || loadGeneratedContractRegistry();
    this.toolIndex = buildCatalogIndex(this.catalog);
    this.commandDescriptorIndex = buildCommandDescriptorIndex(this.catalog);
  }

  async connect() {
    await this.backend.connect();
    return this;
  }

  async close() {
    await this.backend.close();
  }

  getManifest() {
    return loadGeneratedManifest();
  }

  getCatalog() {
    return this.catalog;
  }

  getPolicyProfileCapabilities() {
    return getPolicyProfileCapabilities(this.catalog);
  }

  getPolicyPackCapability() {
    return getPolicyPackCapability(this.catalog);
  }

  getSignerProfileCapability() {
    return getSignerProfileCapability(this.catalog);
  }

  listPolicyScopes() {
    return listPolicyScopes(this.catalog);
  }

  listPolicyScopedCommands() {
    return listPolicyScopedCommands(this.catalog);
  }

  listSignerProfileCommands() {
    return listSignerProfileCommands(this.catalog);
  }

  inspectPolicyScope(scope) {
    return inspectPolicyScope(scope, this.catalog);
  }

  inspectToolPolicySurface(name) {
    return inspectToolPolicySurface(name, this.catalog);
  }

  listGeneratedTools() {
    return Array.from(this.toolIndex.keys()).sort((left, right) => left.localeCompare(right));
  }

  getTool(name) {
    return this.toolIndex.get(String(name || '').trim()) || null;
  }

  requireTool(name) {
    const tool = this.getTool(name);
    if (!tool) {
      throw createSdkError('PANDORA_SDK_UNKNOWN_TOOL', `Unknown Pandora tool: ${name}`);
    }
    return tool;
  }

  async listTools() {
    const tools = await this.backend.listTools();
    return tools.map((tool) => normalizeRuntimeToolDefinition(tool, this.catalog));
  }

  async callToolRaw(name, args = {}) {
    const normalizedName = normalizeToolName(name);
    return this.backend.callTool(normalizedName, args);
  }

  async callToolEnvelope(name, args = {}) {
    const result = await this.callToolRaw(name, args);
    return normalizeStructuredEnvelope(result, { toolName: name });
  }

  async callToolData(name, args = {}) {
    const envelope = await this.callToolEnvelope(name, args);
    if (envelope && Object.prototype.hasOwnProperty.call(envelope, 'data')) {
      return envelope.data;
    }
    return envelope;
  }

  async callTool(name, args = {}) {
    return this.callToolEnvelope(name, args);
  }
}

function createLocalPandoraAgentClient(options = {}) {
  return new PandoraAgentClient({
    backend: new PandoraStdioBackend(options),
    catalog: options.catalog,
  });
}

function createRemotePandoraAgentClient(options = {}) {
  return new PandoraAgentClient({
    backend: new PandoraRemoteBackend(options),
    catalog: options.catalog,
  });
}

module.exports = {
  PandoraSdkError,
  PandoraToolCallError,
  loadGeneratedContractRegistry,
  loadGeneratedManifest,
  loadGeneratedCommandDescriptors,
  loadGeneratedMcpToolDefinitions,
  normalizeStructuredEnvelope,
  normalizeRuntimeToolDefinition,
  getPolicyProfileCapabilities,
  getPolicyPackCapability,
  getSignerProfileCapability,
  listPolicyScopes,
  listPolicyScopedCommands,
  listSignerProfileCommands,
  inspectPolicyScope,
  inspectToolPolicySurface,
  PandoraAgentClient,
  PandoraMcpBackend,
  PandoraStdioBackend,
  PandoraRemoteBackend,
  createLocalPandoraAgentClient,
  createRemotePandoraAgentClient,
};
