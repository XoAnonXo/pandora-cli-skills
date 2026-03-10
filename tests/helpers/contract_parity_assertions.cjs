const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REMOTE_TRANSPORT_PARITY_KEYS = new Set(['supported', 'status', 'notes']);
const REMOTE_TRANSPORT_OPTIONAL_KEYS = new Set([
  'endpoint',
  'deploymentModel',
  'operationsApiAvailable',
  'operatorDocsPath',
  'operatorDocsPresent',
  'publicManagedService',
  'webhookSupport',
]);
const TRUST_DISTRIBUTION_SCHEMA_DEFINITION_NAMES = Object.freeze([
  'TrustDistributionPayload',
  'TrustDistributionSection',
  'TrustDistributionRootPackage',
  'TrustGeneratedContractArtifacts',
  'TrustEmbeddedSdks',
  'TrustTypescriptSdkDistribution',
  'TrustPythonSdkDistribution',
  'TrustDistributionSignals',
  'TrustVerificationSection',
  'TrustBenchmarkVerification',
  'TrustSmokeVerification',
  'TrustPathPresence',
  'TrustVerificationScripts',
  'TrustVerificationSignals',
]);

function omitGeneratedAt(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const clone = { ...payload };
  delete clone.generatedAt;
  return clone;
}

function normalizeCapabilitiesForTransportParity(payload) {
  const clone = JSON.parse(JSON.stringify(payload));

  delete clone.generatedAt;
  delete clone.gateway;

  if (clone.transports && clone.transports.mcpStreamableHttp) {
    const remoteTransport = clone.transports.mcpStreamableHttp;
    clone.transports.mcpStreamableHttpUnexpectedKeys = Object.keys(remoteTransport)
      .filter((key) => !REMOTE_TRANSPORT_PARITY_KEYS.has(key) && !REMOTE_TRANSPORT_OPTIONAL_KEYS.has(key))
      .sort((left, right) => left.localeCompare(right));
    delete remoteTransport.status;
    delete remoteTransport.notes;
    for (const key of REMOTE_TRANSPORT_OPTIONAL_KEYS) {
      delete remoteTransport[key];
    }
    for (const key of clone.transports.mcpStreamableHttpUnexpectedKeys) {
      delete remoteTransport[key];
    }
  }

  if (clone.roadmapSignals) {
    delete clone.roadmapSignals.notes;
  }

  if (clone.versionCompatibility) {
    delete clone.versionCompatibility.mcpTransport;
    delete clone.versionCompatibility.notes;
  }

  if (clone.registryDigest) {
    delete clone.registryDigest.commandDigestHash;
    delete clone.registryDigest.trustDistributionHash;
  }

  if (clone.commandDigests && typeof clone.commandDigests === 'object') {
    for (const digest of Object.values(clone.commandDigests)) {
      if (!digest || typeof digest !== 'object') continue;
      delete digest.remoteTransportActive;
      delete digest.remotePlanned;
    }
  }

  return clone;
}

function omitTrustDistributionFromCapabilities(value) {
  const clone = JSON.parse(JSON.stringify(value));
  delete clone.trustDistribution;
  if (clone.registryDigest && typeof clone.registryDigest === 'object') {
    delete clone.registryDigest.trustDistributionHash;
  }
  return clone;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeTopLevelCompositeInputSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return schema;
  }

  const clone = cloneJson(schema);
  const allOf = Array.isArray(clone.allOf) ? [...clone.allOf] : [];
  const pandora = clone.xPandora && typeof clone.xPandora === 'object' && !Array.isArray(clone.xPandora)
    ? { ...clone.xPandora }
    : null;

  if (Array.isArray(clone.anyOf) && clone.anyOf.length) {
    allOf.push({ anyOf: clone.anyOf });
    delete clone.anyOf;
  }
  if (Array.isArray(clone.oneOf) && clone.oneOf.length) {
    allOf.push({ oneOf: clone.oneOf });
    delete clone.oneOf;
  }
  if (pandora && Array.isArray(pandora.requiredAnyOf) && pandora.requiredAnyOf.length) {
    allOf.push({ anyOf: pandora.requiredAnyOf });
    delete pandora.requiredAnyOf;
  }
  if (pandora && Array.isArray(pandora.exclusiveOneOf) && pandora.exclusiveOneOf.length) {
    allOf.push({ oneOf: pandora.exclusiveOneOf });
    delete pandora.exclusiveOneOf;
  }

  if (allOf.length) {
    clone.allOf = allOf;
  } else {
    delete clone.allOf;
  }

  if (pandora) {
    clone.xPandora = pandora;
  }

  return clone;
}

function normalizeCommandDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    return descriptor;
  }
  const clone = cloneJson(descriptor);
  if (clone.inputSchema && typeof clone.inputSchema === 'object' && !Array.isArray(clone.inputSchema)) {
    clone.inputSchema = normalizeTopLevelCompositeInputSchema(clone.inputSchema);
  }
  return clone;
}

function normalizeCommandDescriptorsForParity(descriptors) {
  return Object.fromEntries(
    Object.entries(descriptors || {}).map(([name, descriptor]) => [name, normalizeCommandDescriptor(descriptor)]),
  );
}

function normalizeToolDefinitionForParity(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    return definition;
  }
  const clone = cloneJson(definition);
  if (clone.inputSchema && typeof clone.inputSchema === 'object' && !Array.isArray(clone.inputSchema)) {
    clone.inputSchema = normalizeTopLevelCompositeInputSchema(clone.inputSchema);
  }
  if (clone.commandDescriptor && typeof clone.commandDescriptor === 'object' && !Array.isArray(clone.commandDescriptor)) {
    clone.commandDescriptor = normalizeCommandDescriptor(clone.commandDescriptor);
  }
  return clone;
}

function normalizeToolDefinitionsForParity(definitions) {
  return (Array.isArray(definitions) ? definitions : []).map((definition) => normalizeToolDefinitionForParity(definition));
}

function normalizeToolCatalogForParity(tools) {
  return Object.fromEntries(
    Object.entries(tools || {}).map(([name, definition]) => [name, normalizeToolDefinitionForParity(definition)]),
  );
}

function omitTrustDistributionDefinitions(value) {
  const clone = JSON.parse(JSON.stringify(value));
  for (const definitionName of TRUST_DISTRIBUTION_SCHEMA_DEFINITION_NAMES) {
    delete clone[definitionName];
  }
  for (const definitionName of ['CapabilitiesPayload', 'SchemaCommandPayload']) {
    if (!clone[definitionName] || typeof clone[definitionName] !== 'object') continue;
    if (clone[definitionName].properties && typeof clone[definitionName].properties === 'object') {
      delete clone[definitionName].properties.trustDistribution;
    }
    if (Array.isArray(clone[definitionName].required)) {
      clone[definitionName].required = clone[definitionName].required.filter((fieldName) => fieldName !== 'trustDistribution');
    }
  }
  return clone;
}

function assertManifestParity(manifest, artifact) {
  assert.equal(manifest.schemaVersion, artifact.schemaVersion, 'manifest schemaVersion mismatch');
  assert.equal(manifest.packageVersion, artifact.packageVersion, 'manifest packageVersion mismatch');
  assert.equal(manifest.commandDescriptorVersion, artifact.commandDescriptorVersion, 'manifest commandDescriptorVersion mismatch');
  assert.equal(manifest.commandCount, Object.keys(artifact.commandDescriptors).length, 'manifest commandCount mismatch');
  assert.equal(manifest.mcpToolCount, Object.keys(artifact.tools).length, 'manifest mcpToolCount mismatch');
  assert.deepEqual(manifest.registryDigest || {}, artifact.registryDigest || {}, 'manifest registryDigest mismatch');
  assert.deepEqual(manifest.backends || {}, artifact.backends || {}, 'manifest backends mismatch');
  assert.ok(manifest.package && typeof manifest.package === 'object', 'manifest package metadata missing');
  assert.ok(manifest.publishedSurfaces && typeof manifest.publishedSurfaces === 'object', 'manifest publishedSurfaces missing');
  assert.ok(manifest.publishedSurfaces.root && typeof manifest.publishedSurfaces.root === 'object', 'manifest publishedSurfaces.root missing');
  assert.ok(manifest.publishedSurfaces.typescript && typeof manifest.publishedSurfaces.typescript === 'object', 'manifest publishedSurfaces.typescript missing');
  assert.ok(manifest.publishedSurfaces.python && typeof manifest.publishedSurfaces.python === 'object', 'manifest publishedSurfaces.python missing');
  assert.deepEqual(manifest.package || {}, manifest.publishedSurfaces.root || {}, 'manifest package metadata should match published root surface');
}

function createIsolatedPandoraEnv(rootDir, overrides = {}) {
  const homeDir = path.join(rootDir, 'home');
  const policyDir = path.join(rootDir, 'policies');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(policyDir, { recursive: true });
  return {
    HOME: homeDir,
    USERPROFILE: homeDir,
    PANDORA_PROFILE_FILE: path.join(rootDir, 'profiles.json'),
    PANDORA_POLICY_DIR: policyDir,
    PANDORA_POLICIES_DIR: policyDir,
    ...overrides,
  };
}

async function withTemporaryEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides || {})) {
    previous.set(key, process.env[key]);
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

module.exports = {
  omitGeneratedAt,
  omitTrustDistributionFromCapabilities,
  omitTrustDistributionDefinitions,
  normalizeCapabilitiesForTransportParity,
  normalizeCommandDescriptorsForParity,
  normalizeToolDefinitionsForParity,
  normalizeToolCatalogForParity,
  assertManifestParity,
  createIsolatedPandoraEnv,
  withTemporaryEnv,
};
