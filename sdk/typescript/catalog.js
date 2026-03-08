'use strict';

const sdk = require('./index.js');

const api = {
  loadGeneratedContractRegistry: sdk.loadGeneratedContractRegistry,
  loadGeneratedManifest: sdk.loadGeneratedManifest,
  loadGeneratedCommandDescriptors: sdk.loadGeneratedCommandDescriptors,
  loadGeneratedMcpToolDefinitions: sdk.loadGeneratedMcpToolDefinitions,
  loadGeneratedCapabilities: sdk.loadGeneratedCapabilities,
  loadGeneratedToolCatalog: sdk.loadGeneratedToolCatalog,
  getPolicyProfileCapabilities: sdk.getPolicyProfileCapabilities,
  getPolicyPackCapability: sdk.getPolicyPackCapability,
  getSignerProfileCapability: sdk.getSignerProfileCapability,
  listPolicyScopes: sdk.listPolicyScopes,
  listPolicyScopedCommands: sdk.listPolicyScopedCommands,
  listSignerProfileCommands: sdk.listSignerProfileCommands,
  inspectPolicyScope: sdk.inspectPolicyScope,
  inspectToolPolicySurface: sdk.inspectToolPolicySurface,
};

api.default = api;

module.exports = Object.freeze(api);
