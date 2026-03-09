export interface PandoraRootPublishedSurface {
  artifactSubpaths: {
    bundle: string;
    commandDescriptors: string;
    entrypoint: string;
    manifest: string;
    mcpToolDefinitions: string;
    types: string;
  };
  binNames: string[];
  exportSubpaths: string[];
  format: 'node';
  main: string | null;
  name: string;
  sourceProjectPath: string;
  version: string;
}

export interface PandoraTypescriptPublishedSurface {
  artifactSubpaths: {
    bundle: string;
    commandDescriptors: string;
    entrypoint: string;
    manifest: string;
    mcpToolDefinitions: string;
    types: string;
  };
  exportSubpaths: string[];
  format: 'node';
  name: string;
  sourceProjectPath: string;
  version: string;
}

export interface PandoraPythonPublishedSurface {
  artifactSubpaths: {
    bundle: string;
    commandDescriptors: string;
    manifest: string;
    mcpToolDefinitions: string;
  };
  format: 'python';
  module: 'pandora_agent';
  name: string;
  sourceProjectPath: string;
  version: string;
}

export interface PandoraPublishedSurfaces {
  root: PandoraRootPublishedSurface;
  typescript: PandoraTypescriptPublishedSurface;
  python: PandoraPythonPublishedSurface;
}

export interface PandoraGeneratedManifest {
  artifactVersion: string;
  schemaVersion: string | number;
  packageVersion: string;
  contractVersion?: string | null;
  contractPackageVersion?: string | null;
  contractCommandDescriptorVersion?: string | null;
  generatedFrom: string;
  generator: string;
  commandDescriptorVersion: string;
  commandCount: number;
  mcpToolCount: number;
  registryDigest?: Record<string, string>;
  catalogSummary?: Record<string, unknown>;
  backends?: Record<string, unknown>;
  package?: PandoraRootPublishedSurface | PandoraTypescriptPublishedSurface | PandoraPythonPublishedSurface;
  publishedSurfaces?: PandoraPublishedSurfaces;
  artifacts: Record<string, string>;
}

export interface PandoraGeneratedMcpToolDefinition {
  name: string;
  command: string[];
  description: string;
  inputSchema: Record<string, unknown>;
  xPandora?: PandoraCommandDescriptor | Record<string, unknown> | null;
  mutating?: boolean;
  safeFlags?: string[];
  executeFlags?: string[];
  longRunningBlocked?: boolean;
  placeholderBlocked?: boolean;
  aliasOf?: string | null;
  canonicalTool?: string | null;
  preferred?: boolean;
  controlInputNames?: string[];
  agentWorkflow?: Record<string, unknown> | null;
  supportsRemote?: boolean;
  remoteEligible?: boolean;
  policyScopes?: string[];
  canonicalCommandTokens?: string[];
  canonicalUsage?: string | null;
  metadataProvenance?: string | null;
}

export interface PandoraCommandDescriptor {
  aliasOf?: string | null;
  canonicalCommandTokens?: string[] | null;
  canonicalTool?: string | null;
  canonicalUsage?: string | null;
  canRunConcurrent?: boolean;
  controlInputNames?: string[];
  dataSchema?: string | null;
  emits?: string[];
  executeFlags?: string[];
  executeIntentRequired?: boolean;
  executeIntentRequiredForLiveMode?: boolean;
  expectedLatencyMs?: number | null;
  externalDependencies?: string[];
  helpDataSchema?: string | null;
  idempotency?: string;
  inputSchema?: Record<string, unknown> | null;
  jobCapable?: boolean;
  mcpExposed?: boolean;
  mcpLongRunningBlocked?: boolean;
  mcpMutating?: boolean;
  outputModes?: string[];
  policyScopes?: string[];
  preferred?: boolean;
  recommendedPreflightTool?: string | null;
  remoteEligible?: boolean;
  requiresSecrets?: boolean;
  returnsOperationId?: boolean;
  returnsRuntimeHandle?: boolean;
  riskLevel?: string;
  safeEquivalent?: string | null;
  safeFlags?: string[];
  summary?: string;
  supportsRemote?: boolean;
  supportsWebhook?: boolean;
  usage?: string;
  [key: string]: unknown;
}

export interface PandoraCapabilityFeature {
  supported: boolean;
  status: string;
  notes: string[];
  [key: string]: unknown;
}

export interface PandoraPolicyPackCapability extends PandoraCapabilityFeature {
  commandsWithPolicyScopes?: string[];
  policyScopedCommandCount?: number;
  samplePolicyScopedCommands?: string[];
  builtinIds?: string[];
  userCount?: number;
  userSampleIds?: string[];
}

export interface PandoraSignerProfileCapability extends PandoraCapabilityFeature {
  commandsRequiringSecrets?: string[];
  secretBearingCommandCount?: number;
  sampleSecretBearingCommands?: string[];
  builtinIds?: string[];
  signerBackends?: string[];
  implementedBackends?: string[];
  placeholderBackends?: string[];
  readyBuiltinIds?: string[];
  pendingBuiltinIds?: string[];
  degradedBuiltinIds?: string[];
  placeholderBuiltinIds?: string[];
  readyBuiltinCount?: number;
  pendingBuiltinCount?: number;
  degradedBuiltinCount?: number;
  placeholderBuiltinCount?: number;
  backendStatuses?: Record<string, unknown>;
  statusAxes?: Record<string, unknown>;
}

export interface PandoraPolicyProfileCapabilities {
  policyPacks: PandoraPolicyPackCapability;
  signerProfiles: PandoraSignerProfileCapability;
}

export interface PandoraToolPolicySurface {
  name: string;
  canonicalTool: string;
  aliasOf: string | null;
  preferred: boolean;
  policyScopes: string[];
  requiresSecrets: boolean;
  policyPackEligible: boolean;
  signerProfileEligible: boolean;
  supportsRemote: boolean;
  remoteEligible: boolean;
  policyPackStatus: string;
  signerProfileStatus: string;
}

export interface PandoraPolicyScopeInspection {
  scope: string;
  commands: string[];
  tools: PandoraToolPolicySurface[];
}

export interface PandoraToolContract {
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown>;
  xPandora?: Record<string, unknown> | null;
  commandDescriptor?: PandoraCommandDescriptor | null;
}

export interface PandoraRuntimeToolDefinition {
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown>;
  xPandora?: PandoraCommandDescriptor | Record<string, unknown> | null;
  commandDescriptor?: PandoraCommandDescriptor | null;
  policyScopes: string[];
  requiresSecrets: boolean;
  supportsRemote: boolean;
  remoteEligible: boolean;
  canonicalTool: string | null;
  aliasOf: string | null;
  preferred: boolean;
  [key: string]: unknown;
}

export interface PandoraCompatibilityCatalogSummary {
  mode: 'compatibility-aliases';
  commandCount: number;
  mcpToolCount: number;
  commandNames: string[];
  toolNames: string[];
}

export interface PandoraCompatibilityCatalog {
  mode: 'explicit';
  commandDescriptors: Record<string, PandoraCommandDescriptor>;
  mcpToolDefinitions: PandoraGeneratedMcpToolDefinition[];
  tools: Record<string, PandoraToolContract>;
  summary: PandoraCompatibilityCatalogSummary;
}

export interface PandoraContractRegistry {
  artifactVersion?: string;
  schemaVersion: string;
  packageVersion: string;
  commandDescriptorVersion: string;
  summary: Record<string, unknown>;
  backends?: Record<string, unknown>;
  registryDigest?: Record<string, string>;
  tools: Record<string, PandoraToolContract>;
  commandDescriptors?: Record<string, PandoraCommandDescriptor>;
  compatibility?: PandoraCompatibilityCatalog;
  schemas: {
    envelope: Record<string, unknown>;
    definitions: Record<string, unknown>;
  };
  capabilities: {
    schemaVersion: string;
    commandDescriptorVersion: string;
    transports: Record<string, unknown>;
    commandDigests: Record<string, PandoraCommandDescriptor>;
    registryDigest: Record<string, string>;
    policyProfiles?: PandoraPolicyProfileCapabilities;
    [key: string]: unknown;
  };
}

export interface PandoraCallToolRawResult {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface PandoraSdkErrorDetails {
  cause?: unknown;
  [key: string]: unknown;
}

export declare class PandoraSdkError extends Error {
  code: string;
  details?: PandoraSdkErrorDetails;
  cause?: unknown;
  constructor(code: string, message: string, details?: PandoraSdkErrorDetails);
}

export declare class PandoraToolCallError extends PandoraSdkError {
  sdkCode: string;
  envelope: Record<string, unknown> | null;
  rawResult: PandoraCallToolRawResult | null;
  toolName: string | null;
  toolError: Record<string, unknown> | null;
  constructor(message: string, details?: PandoraSdkErrorDetails);
}

export interface PandoraStdioBackendOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stderr?: 'pipe' | 'inherit' | 'overlapped';
  clientName?: string;
  clientVersion?: string;
}

export interface PandoraRemoteBackendOptions {
  url: string | URL;
  authToken?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  clientName?: string;
  clientVersion?: string;
}

export interface PandoraAgentClientFactoryOptions extends PandoraStdioBackendOptions {
  backend?: PandoraMcpBackend;
  catalog?: PandoraContractRegistry;
  mode?: 'local' | 'remote';
  url?: string | URL;
  authToken?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

export interface PandoraGeneratedCatalogModule {
  manifest: PandoraGeneratedManifest;
  commandDescriptors: Record<string, PandoraCommandDescriptor>;
  mcpToolDefinitions: PandoraGeneratedMcpToolDefinition[];
  contractRegistry: PandoraContractRegistry;
  loadGeneratedManifest(): PandoraGeneratedManifest;
  loadGeneratedCommandDescriptors(): Record<string, PandoraCommandDescriptor>;
  loadGeneratedMcpToolDefinitions(): PandoraGeneratedMcpToolDefinition[];
  loadGeneratedContractRegistry(): PandoraContractRegistry;
  loadGeneratedCapabilities(): PandoraContractRegistry['capabilities'];
  loadGeneratedToolCatalog(): PandoraContractRegistry['tools'];
}

export declare class PandoraMcpBackend {
  connect(): Promise<void>;
  close(): Promise<void>;
  listTools(): Promise<PandoraRuntimeToolDefinition[] | Array<Record<string, unknown>>>;
  callTool(name: string, args?: Record<string, unknown>): Promise<PandoraCallToolRawResult>;
}

export declare class PandoraStdioBackend extends PandoraMcpBackend {
  constructor(options?: PandoraStdioBackendOptions);
}

export declare class PandoraRemoteBackend extends PandoraMcpBackend {
  constructor(options: PandoraRemoteBackendOptions);
}

export declare class PandoraAgentClient {
  constructor(options: { backend: PandoraMcpBackend; catalog?: PandoraContractRegistry });
  connect(): Promise<this>;
  close(): Promise<void>;
  getManifest(): PandoraGeneratedManifest;
  getCatalog(): PandoraContractRegistry;
  getPolicyProfileCapabilities(): PandoraPolicyProfileCapabilities;
  getPolicyPackCapability(): PandoraPolicyPackCapability;
  getSignerProfileCapability(): PandoraSignerProfileCapability;
  listPolicyScopes(): string[];
  listPolicyScopedCommands(): string[];
  listSignerProfileCommands(): string[];
  inspectPolicyScope(scope: string): PandoraPolicyScopeInspection;
  inspectToolPolicySurface(name: string): PandoraToolPolicySurface;
  listGeneratedTools(): string[];
  getTool(name: string): PandoraToolContract | null;
  requireTool(name: string): PandoraToolContract;
  listTools(): Promise<PandoraRuntimeToolDefinition[]>;
  callToolRaw(name: string, args?: Record<string, unknown>): Promise<PandoraCallToolRawResult>;
  callToolEnvelope(name: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>;
  callToolData(name: string, args?: Record<string, unknown>): Promise<unknown>;
  getBootstrapEnvelope(args?: Record<string, unknown>): Promise<Record<string, unknown>>;
  getBootstrap(args?: Record<string, unknown>): Promise<unknown>;
  callTool(name: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export declare function loadGeneratedContractRegistry(): PandoraContractRegistry;
export declare function loadGeneratedManifest(): PandoraGeneratedManifest;
export declare function loadGeneratedCommandDescriptors(): Record<string, PandoraCommandDescriptor>;
export declare function loadGeneratedMcpToolDefinitions(): PandoraGeneratedMcpToolDefinition[];
export declare function loadGeneratedCapabilities(): PandoraContractRegistry['capabilities'];
export declare function loadGeneratedToolCatalog(): PandoraContractRegistry['tools'];
export declare function normalizeStructuredEnvelope(result: PandoraCallToolRawResult): Record<string, unknown>;
export declare function normalizeRuntimeToolDefinition(
  tool: Record<string, unknown>,
  catalog?: PandoraContractRegistry,
): PandoraRuntimeToolDefinition;
export declare function getPolicyProfileCapabilities(catalog?: PandoraContractRegistry): PandoraPolicyProfileCapabilities;
export declare function getPolicyPackCapability(catalog?: PandoraContractRegistry): PandoraPolicyPackCapability;
export declare function getSignerProfileCapability(catalog?: PandoraContractRegistry): PandoraSignerProfileCapability;
export declare function listPolicyScopes(catalog?: PandoraContractRegistry): string[];
export declare function listPolicyScopedCommands(catalog?: PandoraContractRegistry): string[];
export declare function listSignerProfileCommands(catalog?: PandoraContractRegistry): string[];
export declare function inspectPolicyScope(scope: string, catalog?: PandoraContractRegistry): PandoraPolicyScopeInspection;
export declare function inspectToolPolicySurface(name: string, catalog?: PandoraContractRegistry): PandoraToolPolicySurface;
export declare function createPandoraStdioBackend(options?: PandoraStdioBackendOptions): PandoraStdioBackend;
export declare function createPandoraRemoteBackend(options: PandoraRemoteBackendOptions): PandoraRemoteBackend;
export declare function createLocalPandoraAgentClient(options?: PandoraStdioBackendOptions & { catalog?: PandoraContractRegistry }): PandoraAgentClient;
export declare function createRemotePandoraAgentClient(options: PandoraRemoteBackendOptions & { catalog?: PandoraContractRegistry }): PandoraAgentClient;
export declare function createPandoraAgentClient(options?: PandoraAgentClientFactoryOptions): PandoraAgentClient;
export declare function connectPandoraAgentClient(options?: PandoraAgentClientFactoryOptions): Promise<PandoraAgentClient>;
export declare const generated: PandoraGeneratedCatalogModule;
