const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REMOTE_TRANSPORT_PARITY_KEYS = new Set(['supported', 'status', 'notes']);
const REMOTE_TRANSPORT_OPTIONAL_KEYS = new Set(['endpoint']);

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

function assertManifestParity(manifest, artifact) {
  assert.equal(manifest.schemaVersion, artifact.schemaVersion, 'manifest schemaVersion mismatch');
  assert.equal(manifest.packageVersion, artifact.packageVersion, 'manifest packageVersion mismatch');
  assert.equal(manifest.commandDescriptorVersion, artifact.commandDescriptorVersion, 'manifest commandDescriptorVersion mismatch');
  assert.equal(manifest.commandCount, Object.keys(artifact.commandDescriptors).length, 'manifest commandCount mismatch');
  assert.equal(manifest.mcpToolCount, Object.keys(artifact.tools).length, 'manifest mcpToolCount mismatch');
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
  normalizeCapabilitiesForTransportParity,
  assertManifestParity,
  createIsolatedPandoraEnv,
  withTemporaryEnv,
};
