'use strict';
const manifest = require('./manifest.json');
const commandDescriptors = require('./command-descriptors.json');
const mcpToolDefinitions = require('./mcp-tool-definitions.json');
const contractRegistry = require('./contract-registry.json');

function loadGeneratedManifest() {
  return manifest;
}

function loadGeneratedCommandDescriptors() {
  return commandDescriptors;
}

function loadGeneratedMcpToolDefinitions() {
  return mcpToolDefinitions;
}

function loadGeneratedContractRegistry() {
  return contractRegistry;
}

function loadGeneratedCapabilities() {
  return contractRegistry && contractRegistry.capabilities ? contractRegistry.capabilities : {};
}

function loadGeneratedToolCatalog() {
  return contractRegistry && contractRegistry.tools ? contractRegistry.tools : {};
}

module.exports = Object.freeze({
  manifest,
  commandDescriptors,
  mcpToolDefinitions,
  contractRegistry,
  loadGeneratedManifest,
  loadGeneratedCommandDescriptors,
  loadGeneratedMcpToolDefinitions,
  loadGeneratedContractRegistry,
  loadGeneratedCapabilities,
  loadGeneratedToolCatalog,
});
