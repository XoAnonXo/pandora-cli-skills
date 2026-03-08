'use strict';

const {
  SIGNER_BACKEND_SECRET_SOURCE_KINDS,
  SIGNER_BACKEND_RESOLUTION_STATUSES,
  SIGNER_BACKEND_RUNTIME_REQUIRED_METHODS,
  SIGNER_BACKEND_RUNTIME_OPTIONAL_METHODS,
  normalizeSignerBackendDefinition,
  normalizeSignerBackendId,
  normalizeSignerBackendResolution,
  normalizeSignerBackendRuntime,
} = require('./signer_backend_types.cjs');

function createSignerBackendRegistry(options = {}) {
  const definitionsById = new Map();
  const aliasesToId = new Map();
  const runtimeCache = new Map();

  function assertAvailableId(id) {
    if (definitionsById.has(id) || aliasesToId.has(id)) {
      throw new Error(`Signer backend "${id}" is already registered.`);
    }
  }

  function register(definition) {
    const normalized = normalizeSignerBackendDefinition(definition);
    assertAvailableId(normalized.id);
    for (const alias of normalized.aliases) {
      assertAvailableId(alias);
    }
    definitionsById.set(normalized.id, normalized);
    for (const alias of normalized.aliases) {
      aliasesToId.set(alias, normalized.id);
    }
    return normalized;
  }

  function registerMany(definitions) {
    if (!Array.isArray(definitions)) {
      throw new Error('definitions must be an array.');
    }
    return definitions.map((definition) => register(definition));
  }

  function resolveId(id) {
    if (id === undefined || id === null || id === '') {
      return null;
    }
    const normalized = normalizeSignerBackendId(id, 'backendId');
    if (definitionsById.has(normalized)) {
      return normalized;
    }
    return aliasesToId.get(normalized) || null;
  }

  function get(id) {
    const resolvedId = resolveId(id);
    return resolvedId ? definitionsById.get(resolvedId) || null : null;
  }

  function has(id) {
    return Boolean(resolveId(id));
  }

  function list() {
    return [...definitionsById.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  function clearCache(id) {
    if (id === undefined) {
      runtimeCache.clear();
      return;
    }
    const resolvedId = resolveId(id);
    if (resolvedId) {
      runtimeCache.delete(resolvedId);
    }
  }

  function load(id, options = {}) {
    const definition = get(id);
    if (!definition) {
      throw new Error(`Unknown signer backend: ${id}`);
    }

    if (options.reload !== true && runtimeCache.has(definition.id)) {
      return runtimeCache.get(definition.id);
    }
    if (typeof definition.load !== 'function') {
      throw new Error(`Signer backend "${definition.id}" does not provide a load() hook.`);
    }

    const runtime = normalizeSignerBackendRuntime(
      definition.load({
        id: definition.id,
        definition,
        registry: api,
        context: options.context || null,
      }),
      definition,
    );

    if (options.reload !== true) {
      runtimeCache.set(definition.id, runtime);
    }

    return runtime;
  }

  const api = {
    register,
    registerMany,
    resolveId,
    has,
    get,
    list,
    load,
    clearCache,
  };

  if (Array.isArray(options.definitions) && options.definitions.length > 0) {
    registerMany(options.definitions);
  }

  return api;
}

function defineSignerBackend(definition) {
  return normalizeSignerBackendDefinition(definition);
}

module.exports = {
  SIGNER_BACKEND_SECRET_SOURCE_KINDS,
  SIGNER_BACKEND_RESOLUTION_STATUSES,
  SIGNER_BACKEND_RUNTIME_REQUIRED_METHODS,
  SIGNER_BACKEND_RUNTIME_OPTIONAL_METHODS,
  createSignerBackendRegistry,
  defineSignerBackend,
  normalizeSignerBackendDefinition,
  normalizeSignerBackendId,
  normalizeSignerBackendResolution,
  normalizeSignerBackendRuntime,
};
