import api from './catalog.js';
export const {
  loadGeneratedContractRegistry,
  loadGeneratedManifest,
  loadGeneratedCommandDescriptors,
  loadGeneratedMcpToolDefinitions,
  loadGeneratedCapabilities,
  loadGeneratedToolCatalog,
  getPolicyProfileCapabilities,
  getPolicyPackCapability,
  getSignerProfileCapability,
  listPolicyScopes,
  listPolicyScopedCommands,
  listSignerProfileCommands,
  inspectPolicyScope,
  inspectToolPolicySurface,
} = api;
export default api;
