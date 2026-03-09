import type {
  PandoraCommandDescriptor,
  PandoraContractRegistry,
  PandoraGeneratedManifest,
  PandoraGeneratedMcpToolDefinition,
} from '../typescript';

declare const sdk: {
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
};

export = sdk;
