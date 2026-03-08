'use strict';

const {
  PROFILE_APPROVAL_MODES,
  PROFILE_SIGNER_BACKENDS,
} = require('../shared/profile_constants.cjs');

const SIGNER_BACKEND_SECRET_SOURCE_KINDS = Object.freeze([
  'env',
  'file',
  'external-signer',
]);

const SIGNER_BACKEND_RESOLUTION_STATUSES = Object.freeze([
  'ready',
  'pending',
  'missing-config',
  'missing-secrets',
  'missing-context',
  'missing-keystore',
  'pending-integration',
  'unsupported',
  'error',
]);

const SIGNER_BACKEND_RUNTIME_REQUIRED_METHODS = Object.freeze([
  'resolveProfile',
]);

const SIGNER_BACKEND_RUNTIME_OPTIONAL_METHODS = Object.freeze([
  'normalizeSecretRef',
  'materializeSigner',
  'describeConfig',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalString(value, fieldName, options = {}) {
  if (value === undefined || value === null) {
    if (options.allowNull === false) {
      throw new Error(`${fieldName} is required.`);
    }
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    if (options.allowNull === false) {
      throw new Error(`${fieldName} is required.`);
    }
    return null;
  }
  return text;
}

function compareStableStrings(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function normalizeStringList(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }
  const seen = new Set();
  const items = [];
  for (const entry of value) {
    const text = normalizeOptionalString(entry, fieldName, { allowNull: false });
    if (seen.has(text)) continue;
    seen.add(text);
    items.push(text);
  }
  items.sort(compareStableStrings);
  return items;
}

function normalizeBoolean(value, fallback = false) {
  return value === undefined ? fallback : value === true;
}

function normalizeSignerBackendId(value, fieldName = 'id') {
  return normalizeOptionalString(value, fieldName, { allowNull: false }).toLowerCase();
}

function normalizeKnownValueList(value, fieldName, allowedValues) {
  const items = normalizeStringList(value, fieldName).map((entry) => entry.toLowerCase());
  for (const entry of items) {
    if (!allowedValues.includes(entry)) {
      throw new Error(`${fieldName} must contain only: ${allowedValues.join(', ')}.`);
    }
  }
  return Object.freeze([...new Set(items)].sort(compareStableStrings));
}

function normalizeSignerBackendDefinition(input) {
  if (!isPlainObject(input)) {
    throw new Error('Signer backend definition must be an object.');
  }

  const id = normalizeSignerBackendId(input.id || input.backend || input.name, 'definition.id');
  const aliases = normalizeStringList(input.aliases, 'definition.aliases')
    .map((entry) => normalizeSignerBackendId(entry, 'definition.aliases'))
    .filter((entry) => entry !== id);
  const uniqueAliases = [...new Set(aliases)].sort(compareStableStrings);
  const profileBackends = normalizeKnownValueList(
    input.profileBackends === undefined ? [id] : input.profileBackends,
    'definition.profileBackends',
    PROFILE_SIGNER_BACKENDS,
  );
  const secretRefKinds = normalizeKnownValueList(
    input.secretRefKinds,
    'definition.secretRefKinds',
    SIGNER_BACKEND_SECRET_SOURCE_KINDS,
  );
  const approvalModes = normalizeKnownValueList(
    input.approvalModes,
    'definition.approvalModes',
    PROFILE_APPROVAL_MODES,
  );
  const load = input.load === undefined || input.load === null
    ? null
    : typeof input.load === 'function'
      ? input.load
      : (() => {
          throw new Error('definition.load must be a function when provided.');
        })();

  return Object.freeze({
    id,
    aliases: Object.freeze(uniqueAliases),
    displayName: normalizeOptionalString(input.displayName || input.name || id, 'definition.displayName', {
      allowNull: false,
    }),
    description: normalizeOptionalString(input.description, 'definition.description'),
    profileBackends,
    secretRefKinds,
    approvalModes,
    implemented: normalizeBoolean(input.implemented, false),
    supportsReadOnlyProfiles: normalizeBoolean(
      input.supportsReadOnlyProfiles,
      profileBackends.includes('read-only'),
    ),
    supportsSecretMaterial: normalizeBoolean(
      input.supportsSecretMaterial,
      secretRefKinds.length > 0,
    ),
    requiresNetworkContext: normalizeBoolean(input.requiresNetworkContext, false),
    load,
  });
}

function assertFunction(value, fieldName) {
  if (typeof value !== 'function') {
    throw new Error(`${fieldName} must be a function.`);
  }
  return value;
}

function normalizeSignerBackendRuntime(runtime, definition) {
  const base = typeof runtime === 'function'
    ? { resolveProfile: runtime }
    : runtime;

  if (!isPlainObject(base)) {
    throw new Error(`Signer backend runtime for ${definition.id} must be an object or function.`);
  }

  const id = normalizeSignerBackendId(base.id || definition.id, 'runtime.id');
  if (id !== definition.id) {
    throw new Error(`Signer backend runtime id mismatch: expected ${definition.id}, received ${id}.`);
  }

  const normalized = {
    id,
    resolveProfile: assertFunction(base.resolveProfile, 'runtime.resolveProfile'),
  };

  for (const methodName of SIGNER_BACKEND_RUNTIME_OPTIONAL_METHODS) {
    if (base[methodName] === undefined || base[methodName] === null) {
      normalized[methodName] = null;
      continue;
    }
    normalized[methodName] = assertFunction(base[methodName], `runtime.${methodName}`);
  }

  return Object.freeze(normalized);
}

function normalizeSecretSource(source) {
  if (source === undefined || source === null) {
    return null;
  }
  if (!isPlainObject(source)) {
    throw new Error('resolution.secretSource must be an object when provided.');
  }

  const kind = normalizeOptionalString(source.kind, 'resolution.secretSource.kind', { allowNull: false }).toLowerCase();
  if (!SIGNER_BACKEND_SECRET_SOURCE_KINDS.includes(kind)) {
    throw new Error(
      `resolution.secretSource.kind must be one of ${SIGNER_BACKEND_SECRET_SOURCE_KINDS.join(', ')}.`,
    );
  }

  if (kind === 'env') {
    return Object.freeze({
      kind,
      envVar: normalizeOptionalString(source.envVar, 'resolution.secretSource.envVar', { allowNull: false }),
    });
  }

  if (kind === 'file') {
    return Object.freeze({
      kind,
      path: normalizeOptionalString(source.path, 'resolution.secretSource.path', { allowNull: false }),
      exists: source.exists === true,
    });
  }

  return Object.freeze({
    kind,
    reference: normalizeOptionalString(source.reference, 'resolution.secretSource.reference', { allowNull: false }),
  });
}

function normalizeChainIdLike(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? value : value;
  }
  if (typeof value === 'string') {
    return value.trim() || null;
  }
  throw new Error('resolution.chainId must be a number, string, or null.');
}

function normalizeSignerBackendResolution(input, options = {}) {
  if (!isPlainObject(input)) {
    throw new Error('Signer backend resolution must be an object.');
  }

  const backend = normalizeSignerBackendId(
    options.backend || input.backend || input.effectiveBackend,
    'resolution.backend',
  );
  const effectiveBackend = normalizeSignerBackendId(
    input.effectiveBackend || backend,
    'resolution.effectiveBackend',
  );
  const status = normalizeOptionalString(
    input.status || (input.ready === true ? 'ready' : 'pending'),
    'resolution.status',
    { allowNull: false },
  ).toLowerCase();

  if (!SIGNER_BACKEND_RESOLUTION_STATUSES.includes(status)) {
    throw new Error(
      `resolution.status must be one of ${SIGNER_BACKEND_RESOLUTION_STATUSES.join(', ')}.`,
    );
  }

  const missingSecrets = normalizeStringList(input.missingSecrets, 'resolution.missingSecrets');
  const missingContext = normalizeStringList(input.missingContext, 'resolution.missingContext');
  const missing = [
    ...normalizeStringList(input.missing, 'resolution.missing'),
    ...missingSecrets,
    ...missingContext,
  ];

  return Object.freeze({
    backend,
    effectiveBackend,
    status,
    ready: input.ready === true,
    backendImplemented: input.backendImplemented === true,
    configured: input.configured === true,
    readOnly: input.readOnly === true,
    credentialsRequired: input.credentialsRequired === true,
    signerReady: input.signerReady === true,
    networkContextReady: input.networkContextReady === true,
    secretSource: normalizeSecretSource(input.secretSource),
    wallet: normalizeOptionalString(input.wallet, 'resolution.wallet'),
    rpcUrl: normalizeOptionalString(input.rpcUrl, 'resolution.rpcUrl'),
    chainId: normalizeChainIdLike(input.chainId),
    missingSecrets: Object.freeze(missingSecrets),
    missingContext: Object.freeze(missingContext),
    missing: Object.freeze([...new Set(missing)].sort(compareStableStrings)),
    notes: Object.freeze(normalizeStringList(input.notes, 'resolution.notes')),
    secretMaterial: Object.prototype.hasOwnProperty.call(input, 'secretMaterial')
      ? (input.secretMaterial === null || isPlainObject(input.secretMaterial) ? input.secretMaterial : (() => {
          throw new Error('resolution.secretMaterial must be an object or null.');
        })())
      : undefined,
  });
}

module.exports = {
  SIGNER_BACKEND_SECRET_SOURCE_KINDS,
  SIGNER_BACKEND_RESOLUTION_STATUSES,
  SIGNER_BACKEND_RUNTIME_REQUIRED_METHODS,
  SIGNER_BACKEND_RUNTIME_OPTIONAL_METHODS,
  normalizeSignerBackendId,
  normalizeSignerBackendDefinition,
  normalizeSignerBackendRuntime,
  normalizeSignerBackendResolution,
};
