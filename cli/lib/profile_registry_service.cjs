'use strict';

const {
  PROFILE_SCHEMA_VERSION,
  PROFILE_STORE_SCHEMA_VERSION,
  PROFILE_SIGNER_BACKENDS,
  PROFILE_APPROVAL_MODES,
  PROFILE_BUILTIN_SAMPLE_PROFILES,
  PROFILE_ENV_PRIVATE_KEY_CANDIDATES,
  PROFILE_ENV_WALLET_CANDIDATES,
  PROFILE_ENV_RPC_URL_CANDIDATES,
  PROFILE_ENV_CHAIN_ID_CANDIDATES,
  PROFILE_ENV_KEYSTORE_PASSWORD_CANDIDATES,
  PROFILE_ENV_EXTERNAL_SIGNER_URL_CANDIDATES,
  PROFILE_ENV_EXTERNAL_SIGNER_TOKEN_CANDIDATES,
} = require('./shared/profile_constants.cjs');
const { createProfileError } = require('./shared/profile_errors.cjs');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function sortObjectKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortObjectKeysDeep(entry));
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const sorted = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    sorted[key] = sortObjectKeysDeep(value[key]);
  }
  return sorted;
}

function normalizeNonEmptyString(value, fieldName, options = {}) {
  if (value === undefined || value === null) {
    if (options.allowNull) return null;
    throw createProfileError('PROFILE_INVALID', `${fieldName} is required.`, { field: fieldName });
  }
  const text = String(value).trim();
  if (!text) {
    if (options.allowNull) return null;
    throw createProfileError('PROFILE_INVALID', `${fieldName} must be a non-empty string.`, {
      field: fieldName,
      value,
    });
  }
  return text;
}

function normalizeId(value, fieldName = 'id') {
  const text = normalizeNonEmptyString(value, fieldName);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text)) {
    throw createProfileError('PROFILE_INVALID', `${fieldName} must match /^[A-Za-z0-9][A-Za-z0-9._-]*$/.`, {
      field: fieldName,
      value,
    });
  }
  return text;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return Boolean(value);
}

function normalizeStringList(value, fieldName) {
  if (value === undefined || value === null || value === '') return [];
  const items = Array.isArray(value) ? value : [value];
  const normalized = items.map((entry) => normalizeNonEmptyString(entry, fieldName));
  return Array.from(new Set(normalized)).sort((left, right) => left.localeCompare(right));
}

function normalizeChainAllowlist(value) {
  if (value === undefined || value === null || value === '') return [];
  const items = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const normalized = [];
  for (const entry of items) {
    if (entry === undefined || entry === null || entry === '') continue;
    let nextValue = null;
    if (typeof entry === 'number' && Number.isSafeInteger(entry) && entry > 0) {
      nextValue = entry;
    } else {
      const text = String(entry).trim();
      if (!text) continue;
      if (/^\d+$/.test(text)) {
        const numeric = Number(text);
        if (!Number.isSafeInteger(numeric) || numeric <= 0) {
          throw createProfileError('PROFILE_INVALID', 'chainAllowlist entries must be positive integers or non-empty chain ids.', {
            field: 'chainAllowlist',
            value: entry,
          });
        }
        nextValue = numeric;
      } else {
        nextValue = text;
      }
    }
    const dedupeKey = `${typeof nextValue}:${String(nextValue)}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      normalized.push(nextValue);
    }
  }
  return normalized.sort((left, right) => String(left).localeCompare(String(right)));
}

function normalizeLabels(value) {
  if (value === undefined || value === null || value === '') return {};
  if (!isPlainObject(value)) {
    throw createProfileError('PROFILE_INVALID', 'labels must be a JSON object when provided.', {
      field: 'labels',
      value,
    });
  }
  const normalized = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    const labelKey = normalizeId(key, 'labels key');
    const rawValue = value[key];
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;
    if (typeof rawValue === 'object') {
      throw createProfileError('PROFILE_INVALID', 'labels values must be scalar.', {
        field: `labels.${labelKey}`,
        value: rawValue,
      });
    }
    normalized[labelKey] = String(rawValue).trim();
  }
  return normalized;
}

function normalizeRiskCeilings(value) {
  if (value === undefined || value === null || value === '') return {};
  if (!isPlainObject(value)) {
    throw createProfileError('PROFILE_INVALID', 'riskCeilings must be a JSON object when provided.', {
      field: 'riskCeilings',
      value,
    });
  }
  const normalized = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    const rawValue = value[key];
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw createProfileError('PROFILE_INVALID', 'riskCeilings values must be non-negative numbers.', {
        field: `riskCeilings.${key}`,
        value: rawValue,
      });
    }
    normalized[key] = numeric;
  }
  return normalized;
}

function normalizeGenericSecretRef(value, fieldName = 'secretRef') {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') {
    return normalizeNonEmptyString(value, fieldName);
  }
  if (!isPlainObject(value)) {
    throw createProfileError('PROFILE_INVALID', `${fieldName} must be a string, object, or null.`, {
      field: fieldName,
      value,
    });
  }
  const normalized = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    const rawValue = value[key];
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;
    if (Array.isArray(rawValue)) {
      normalized[key] = normalizeStringList(rawValue, `${fieldName}.${key}`);
      continue;
    }
    if (isPlainObject(rawValue)) {
      normalized[key] = sortObjectKeysDeep(cloneJson(rawValue));
      continue;
    }
    normalized[key] = String(rawValue).trim();
  }
  if (Object.keys(normalized).length === 0) {
    return null;
  }
  return normalized;
}

function normalizeLocalEnvSecretRef(value, readOnly) {
  if (readOnly) return null;
  const base = normalizeGenericSecretRef(value, 'secretRef');
  const normalized = isPlainObject(base)
    ? { ...base }
    : typeof base === 'string'
      ? { privateKeyEnv: [base] }
      : {};
  normalized.kind = 'env';
  normalized.privateKeyEnv = normalizeStringList(
    normalized.privateKeyEnv || normalized.privateKey || PROFILE_ENV_PRIVATE_KEY_CANDIDATES,
    'secretRef.privateKeyEnv',
  );
  normalized.walletEnv = normalizeStringList(
    normalized.walletEnv || normalized.addressEnv || PROFILE_ENV_WALLET_CANDIDATES,
    'secretRef.walletEnv',
  );
  normalized.rpcUrlEnv = normalizeStringList(
    normalized.rpcUrlEnv || PROFILE_ENV_RPC_URL_CANDIDATES,
    'secretRef.rpcUrlEnv',
  );
  normalized.chainIdEnv = normalizeStringList(
    normalized.chainIdEnv || PROFILE_ENV_CHAIN_ID_CANDIDATES,
    'secretRef.chainIdEnv',
  );
  return sortObjectKeysDeep(normalized);
}

function normalizeLocalKeystoreSecretRef(value, readOnly) {
  if (readOnly) return null;
  const base = normalizeGenericSecretRef(value, 'secretRef');
  const normalized = isPlainObject(base)
    ? { ...base }
    : typeof base === 'string'
      ? { path: base }
      : {};
  normalized.kind = 'file';
  normalized.path = normalizeNonEmptyString(
    normalized.path || normalized.file || normalized.keystorePath,
    'secretRef.path',
  );
  normalized.passwordEnv = normalizeStringList(
    normalized.passwordEnv || normalized.passphraseEnv || PROFILE_ENV_KEYSTORE_PASSWORD_CANDIDATES,
    'secretRef.passwordEnv',
  );
  normalized.rpcUrlEnv = normalizeStringList(
    normalized.rpcUrlEnv || PROFILE_ENV_RPC_URL_CANDIDATES,
    'secretRef.rpcUrlEnv',
  );
  normalized.chainIdEnv = normalizeStringList(
    normalized.chainIdEnv || PROFILE_ENV_CHAIN_ID_CANDIDATES,
    'secretRef.chainIdEnv',
  );
  return sortObjectKeysDeep(normalized);
}

function normalizeExternalSignerSecretRef(value, readOnly) {
  if (readOnly) return null;
  const base = normalizeGenericSecretRef(value, 'secretRef');
  const normalized = isPlainObject(base)
    ? { ...base }
    : typeof base === 'string'
      ? { reference: base }
      : {};
  normalized.kind = 'external-signer';
  normalized.reference = normalizeNonEmptyString(
    normalized.reference || normalized.signerRef || normalized.signerId,
    'secretRef.reference',
  );
  normalized.baseUrlEnv = normalizeStringList(
    normalized.baseUrlEnv || normalized.urlEnv || PROFILE_ENV_EXTERNAL_SIGNER_URL_CANDIDATES,
    'secretRef.baseUrlEnv',
  );
  normalized.authTokenEnv = normalizeStringList(
    normalized.authTokenEnv || normalized.tokenEnv || PROFILE_ENV_EXTERNAL_SIGNER_TOKEN_CANDIDATES,
    'secretRef.authTokenEnv',
  );
  normalized.rpcUrlEnv = normalizeStringList(
    normalized.rpcUrlEnv || PROFILE_ENV_RPC_URL_CANDIDATES,
    'secretRef.rpcUrlEnv',
  );
  normalized.chainIdEnv = normalizeStringList(
    normalized.chainIdEnv || PROFILE_ENV_CHAIN_ID_CANDIDATES,
    'secretRef.chainIdEnv',
  );
  return sortObjectKeysDeep(normalized);
}

function normalizeSecretRefForBackend(value, signerBackend, readOnly) {
  if (readOnly || signerBackend === 'read-only') {
    return null;
  }
  if (signerBackend === 'local-env') {
    return normalizeLocalEnvSecretRef(value, readOnly);
  }
  if (signerBackend === 'local-keystore') {
    return normalizeLocalKeystoreSecretRef(value, readOnly);
  }
  if (signerBackend === 'external-signer') {
    return normalizeExternalSignerSecretRef(value, readOnly);
  }
  return sortObjectKeysDeep(normalizeGenericSecretRef(value, 'secretRef'));
}

function normalizeApprovalMode(value, signerBackend, readOnly) {
  const fallback =
    signerBackend === 'external-signer'
      ? 'external'
      : readOnly || signerBackend === 'read-only'
        ? 'read-only'
        : 'manual';
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = normalizeNonEmptyString(value, 'approvalMode');
  if (!PROFILE_APPROVAL_MODES.includes(normalized)) {
    throw createProfileError(
      'PROFILE_INVALID',
      `approvalMode must be one of ${PROFILE_APPROVAL_MODES.join(', ')}.`,
      { field: 'approvalMode', value },
    );
  }
  if ((readOnly || signerBackend === 'read-only') && normalized !== 'read-only') {
    throw createProfileError(
      'PROFILE_INVALID',
      'readOnly profiles must use approvalMode "read-only".',
      { field: 'approvalMode', value: normalized, signerBackend },
    );
  }
  if (signerBackend === 'external-signer' && normalized !== 'external') {
    throw createProfileError(
      'PROFILE_INVALID',
      'external-signer profiles must use approvalMode "external".',
      { field: 'approvalMode', value: normalized, signerBackend },
    );
  }
  if (['local-env', 'local-keystore'].includes(signerBackend) && !['manual', 'policy-gated'].includes(normalized)) {
    throw createProfileError(
      'PROFILE_INVALID',
      `${signerBackend} profiles must use approvalMode "manual" or "policy-gated".`,
      { field: 'approvalMode', value: normalized, signerBackend },
    );
  }
  return normalized;
}

function normalizeProfile(input, options = {}) {
  if (!isPlainObject(input)) {
    throw createProfileError('PROFILE_INVALID', 'Profile must be a JSON object.', {
      input,
      source: options.source || null,
    });
  }

  const signerBackend = normalizeNonEmptyString(input.signerBackend, 'signerBackend');
  if (!PROFILE_SIGNER_BACKENDS.includes(signerBackend)) {
    throw createProfileError(
      'PROFILE_INVALID',
      `signerBackend must be one of ${PROFILE_SIGNER_BACKENDS.join(', ')}.`,
      {
        field: 'signerBackend',
        value: input.signerBackend,
      },
    );
  }

  const readOnly = signerBackend === 'read-only'
    ? true
    : normalizeBoolean(input.readOnly, false);

  const defaultPolicy = input.defaultPolicy === undefined || input.defaultPolicy === null || input.defaultPolicy === ''
    ? null
    : normalizeNonEmptyString(input.defaultPolicy, 'defaultPolicy');

  const allowedPolicies = normalizeStringList(input.allowedPolicies, 'allowedPolicies');
  if (defaultPolicy && !allowedPolicies.includes(defaultPolicy)) {
    allowedPolicies.push(defaultPolicy);
    allowedPolicies.sort((left, right) => left.localeCompare(right));
  }

  return sortObjectKeysDeep({
    id: normalizeId(input.id, 'id'),
    version: normalizeNonEmptyString(input.version || PROFILE_SCHEMA_VERSION, 'version'),
    displayName: normalizeNonEmptyString(input.displayName, 'displayName'),
    description:
      input.description === undefined || input.description === null || input.description === ''
        ? null
        : normalizeNonEmptyString(input.description, 'description', { allowNull: true }),
    signerBackend,
    chainAllowlist: normalizeChainAllowlist(input.chainAllowlist),
    categoryAllowlist: normalizeStringList(input.categoryAllowlist, 'categoryAllowlist'),
    toolFamilyAllowlist: normalizeStringList(input.toolFamilyAllowlist, 'toolFamilyAllowlist'),
    defaultPolicy,
    allowedPolicies,
    secretRef: normalizeSecretRefForBackend(input.secretRef, signerBackend, readOnly),
    approvalMode: normalizeApprovalMode(input.approvalMode, signerBackend, readOnly),
    riskCeilings: normalizeRiskCeilings(input.riskCeilings),
    labels: normalizeLabels(input.labels),
    readOnly,
  });
}

function ensureUniqueProfileIds(profiles, source = null) {
  const seen = new Set();
  for (const profile of profiles) {
    const id = profile && profile.id ? profile.id : null;
    if (!id) continue;
    if (seen.has(id)) {
      throw createProfileError('PROFILE_INVALID', `Duplicate profile id detected: ${id}`, {
        id,
        source,
      });
    }
    seen.add(id);
  }
}

function normalizeProfileDocument(input, options = {}) {
  let rawProfiles = null;
  let inputSchemaVersion = PROFILE_STORE_SCHEMA_VERSION;

  if (Array.isArray(input)) {
    rawProfiles = input;
  } else if (isPlainObject(input) && Array.isArray(input.profiles)) {
    rawProfiles = input.profiles;
    if (typeof input.schemaVersion === 'string' && input.schemaVersion.trim()) {
      inputSchemaVersion = input.schemaVersion.trim();
    }
  } else if (isPlainObject(input)) {
    rawProfiles = [input];
  } else {
    throw createProfileError('PROFILE_INVALID', 'Profile document must be a JSON object or array.', {
      input,
      source: options.source || null,
    });
  }

  const profiles = rawProfiles.map((profile, index) =>
    normalizeProfile(profile, {
      source: options.source || null,
      index,
    }),
  );
  ensureUniqueProfileIds(profiles, options.source || null);

  return sortObjectKeysDeep({
    schemaVersion: inputSchemaVersion || PROFILE_STORE_SCHEMA_VERSION,
    profileCount: profiles.length,
    profiles,
  });
}

function validateProfile(input, options = {}) {
  try {
    const profile = normalizeProfile(input, options);
    return {
      ok: true,
      profile,
      errors: [],
    };
  } catch (error) {
    return {
      ok: false,
      profile: null,
      errors: [
        {
          code: error && error.code ? error.code : 'PROFILE_INVALID',
          message: error && error.message ? error.message : String(error),
          details: error && error.details ? error.details : undefined,
        },
      ],
    };
  }
}

function validateProfileDocument(input, options = {}) {
  try {
    const document = normalizeProfileDocument(input, options);
    return {
      ok: true,
      document,
      errors: [],
    };
  } catch (error) {
    return {
      ok: false,
      document: null,
      errors: [
        {
          code: error && error.code ? error.code : 'PROFILE_INVALID',
          message: error && error.message ? error.message : String(error),
          details: error && error.details ? error.details : undefined,
        },
      ],
    };
  }
}

function buildProfileSummary(profile, metadata = {}) {
  const labels = isPlainObject(profile && profile.labels) ? profile.labels : {};
  const source = metadata.source || 'unknown';
  return sortObjectKeysDeep({
    id: profile.id,
    version: profile.version,
    displayName: profile.displayName,
    description: profile.description || null,
    signerBackend: profile.signerBackend,
    readOnly: Boolean(profile.readOnly),
    defaultPolicy: profile.defaultPolicy || null,
    allowedPolicies: Array.isArray(profile.allowedPolicies) ? profile.allowedPolicies.slice() : [],
    approvalMode: profile.approvalMode || null,
    chainAllowlist: Array.isArray(profile.chainAllowlist) ? profile.chainAllowlist.slice() : [],
    categoryAllowlist: Array.isArray(profile.categoryAllowlist) ? profile.categoryAllowlist.slice() : [],
    toolFamilyAllowlist: Array.isArray(profile.toolFamilyAllowlist) ? profile.toolFamilyAllowlist.slice() : [],
    labels,
    source,
    builtin: metadata.builtin === true,
    filePath: metadata.filePath || null,
    sample: String(labels.sample || '').trim().toLowerCase() === 'true',
  });
}

let cachedBuiltInProfiles = null;

function getBuiltInProfiles() {
  if (!cachedBuiltInProfiles) {
    cachedBuiltInProfiles = normalizeProfileDocument(PROFILE_BUILTIN_SAMPLE_PROFILES, {
      source: 'builtin',
    }).profiles;
  }
  return cloneJson(cachedBuiltInProfiles);
}

function getBuiltInProfile(id) {
  const normalizedId = normalizeId(id, 'id');
  return getBuiltInProfiles().find((profile) => profile.id === normalizedId) || null;
}

module.exports = {
  PROFILE_SCHEMA_VERSION,
  PROFILE_STORE_SCHEMA_VERSION,
  normalizeProfile,
  normalizeProfileDocument,
  validateProfile,
  validateProfileDocument,
  buildProfileSummary,
  getBuiltInProfiles,
  getBuiltInProfile,
};
