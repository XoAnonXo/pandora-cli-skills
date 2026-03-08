'use strict';
function loadJson(name) {
  try {
    return require(`./${name}`);
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
    return require('../../generated/' + name);
  }
}

const manifest = loadJson('manifest.json');
const commandDescriptors = loadJson('command-descriptors.json');
const mcpToolDefinitions = loadJson('mcp-tool-definitions.json');
const contractRegistry = loadJson('contract-registry.json');

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
