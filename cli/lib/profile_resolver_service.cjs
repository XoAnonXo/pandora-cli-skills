'use strict';

const fs = require('fs');
const path = require('path');

const {
  PROFILE_DEFAULT_READ_ONLY_PROFILE_ID,
  PROFILE_MUTATING_TOOL_FAMILIES,
  PROFILE_READ_ONLY_TOOL_FAMILIES,
} = require('./shared/profile_constants.cjs');
const {
  POLL_CATEGORY_IDS,
  getPollCategoryId,
} = require('./shared/poll_categories.cjs');
const { createProfileError } = require('./shared/profile_errors.cjs');
const { normalizeProfile, buildProfileSummary } = require('./profile_registry_service.cjs');
const { createProfileStore, expandHome } = require('./profile_store.cjs');

const MUTATING_TOOL_FAMILY_SET = new Set(
  PROFILE_MUTATING_TOOL_FAMILIES.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean),
);

const READ_ONLY_TOOL_FAMILY_SET = new Set(
  PROFILE_READ_ONLY_TOOL_FAMILIES.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean),
);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function cloneArray(value) {
  return Array.isArray(value) ? value.slice() : [];
}

function firstPopulatedEnv(env, candidates) {
  for (const name of Array.isArray(candidates) ? candidates : []) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) continue;
    const value = env[normalizedName];
    if (value === undefined || value === null || String(value).trim() === '') continue;
    return {
      name: normalizedName,
      value: String(value),
    };
  }
  return null;
}

function normalizeChainIdEnvValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (Number.isSafeInteger(numeric) && numeric > 0) return numeric;
  return String(value);
}

function normalizeComparableChainId(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    if (Number.isSafeInteger(numeric) && numeric > 0) {
      return numeric;
    }
  }
  return text;
}

function normalizeToolFamily(command) {
  const normalized = String(command || '').trim().toLowerCase();
  if (!normalized) return null;
  return normalized.split('.')[0] || null;
}

function normalizeCategoryValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const categoryId = getPollCategoryId(value);
  if (categoryId !== null) return categoryId;
  return String(value).trim().toLowerCase();
}

function profileAllowsCategory(profile, category) {
  if (category === null || category === undefined) return true;
  const allowlist = Array.isArray(profile.categoryAllowlist) ? profile.categoryAllowlist : [];
  if (!allowlist.length) return true;
  const normalizedCategory = normalizeCategoryValue(category);
  return allowlist.some((entry) => {
    const categoryId = getPollCategoryId(entry);
    if (typeof normalizedCategory === 'number' && categoryId !== null) {
      return categoryId === normalizedCategory;
    }
    if (typeof normalizedCategory === 'string' && categoryId === null) {
      return String(entry).trim().toLowerCase() === normalizedCategory;
    }
    if (typeof normalizedCategory === 'number' && categoryId === null) {
      return String(entry).trim().toLowerCase() === String(normalizedCategory);
    }
    return categoryId === normalizedCategory;
  });
}

function buildProfileConstraints(profile) {
  return {
    readOnly: Boolean(profile && profile.readOnly),
    defaultPolicy: profile && profile.defaultPolicy ? profile.defaultPolicy : null,
    allowedPolicies: cloneArray(profile && profile.allowedPolicies),
    chainAllowlist: cloneArray(profile && profile.chainAllowlist),
    categoryAllowlist: cloneArray(profile && profile.categoryAllowlist),
    toolFamilyAllowlist: cloneArray(profile && profile.toolFamilyAllowlist),
  };
}

function evaluateProfileCompatibility(profile, options = {}) {
  const constraints = buildProfileConstraints(profile);
  const violations = [];
  const policyId = normalizeOptionalString(options.policyId);
  const command = normalizeOptionalString(options.command);
  const toolFamily = normalizeToolFamily(options.toolFamily || command);
  const chainId = normalizeComparableChainId(options.chainId);
  const category = normalizeCategoryValue(options.category);
  const approvalMode = normalizeOptionalString(profile.approvalMode);
  const derivedMutatingFromFamily = toolFamily
    ? READ_ONLY_TOOL_FAMILY_SET.has(toolFamily)
      ? false
      : MUTATING_TOOL_FAMILY_SET.has(toolFamily)
    : false;
  const mutatingRequested = options.mutating === true
    || options.live === true
    || options.liveRequested === true
    || String(options.mode || '').trim().toLowerCase() === 'execute'
    || derivedMutatingFromFamily;

  if (mutatingRequested && constraints.readOnly) {
    violations.push({
      code: 'PROFILE_READ_ONLY_MUTATION_DENIED',
      message: `Profile ${profile.id} is read-only and cannot be used for mutating execution.`,
      command,
      toolFamily,
    });
  }

  if (policyId && constraints.allowedPolicies.length && !constraints.allowedPolicies.includes(policyId)) {
    violations.push({
      code: 'PROFILE_POLICY_NOT_ALLOWED',
      message: `Profile ${profile.id} does not allow policy ${policyId}.`,
      policyId,
      expected: constraints.allowedPolicies,
    });
  }

  if (
    toolFamily
    && constraints.toolFamilyAllowlist.length
    && !constraints.toolFamilyAllowlist.some((entry) => normalizeToolFamily(entry) === toolFamily)
  ) {
    violations.push({
      code: 'PROFILE_TOOL_FAMILY_NOT_ALLOWED',
      message: `Profile ${profile.id} does not allow tool family ${toolFamily}.`,
      toolFamily,
      command,
      expected: constraints.toolFamilyAllowlist,
    });
  }

  if (chainId !== null && constraints.chainAllowlist.length) {
    const allowed = constraints.chainAllowlist.map((entry) => normalizeComparableChainId(entry));
    if (!allowed.some((entry) => entry === chainId)) {
      violations.push({
        code: 'PROFILE_CHAIN_NOT_ALLOWED',
        message: `Profile ${profile.id} does not allow chain ${chainId}.`,
        chainId,
        expected: constraints.chainAllowlist,
      });
    }
  }

  if (category !== null && !profileAllowsCategory(profile, category)) {
    violations.push({
      code: 'PROFILE_CATEGORY_NOT_ALLOWED',
      message: `Profile ${profile.id} does not allow category ${typeof category === 'number' ? Object.keys(POLL_CATEGORY_IDS).find((name) => POLL_CATEGORY_IDS[name] === category) || category : category}.`,
      category,
      expected: constraints.categoryAllowlist,
    });
  }

  return {
    ok: violations.length === 0,
    evaluated: Boolean(policyId || command || chainId !== null || category !== null || mutatingRequested),
    policyId,
    command,
    toolFamily,
    chainId,
    category,
    approvalMode,
    mutatingRequested,
    recommendedPolicy: constraints.defaultPolicy,
    constraints,
    violations,
  };
}

function buildReadOnlyResolution(profile, options = {}) {
  const notes = Array.isArray(options.notes) ? options.notes.filter(Boolean) : [];
  return {
    backend: profile.signerBackend,
    effectiveBackend: 'read-only',
    status: 'ready',
    ready: true,
    backendImplemented: true,
    configured: true,
    readOnly: true,
    credentialsRequired: false,
    signerReady: true,
    networkContextReady: true,
    secretSource: null,
    wallet: null,
    rpcUrl: null,
    chainId: null,
    missingSecrets: [],
    missingContext: [],
    missing: [],
    notes,
  };
}

function buildPendingResolution(profile, message, options = {}) {
  const missingSecrets = Array.isArray(options.missingSecrets) ? options.missingSecrets.filter(Boolean) : [];
  const missingContext = Array.isArray(options.missingContext) ? options.missingContext.filter(Boolean) : [];
  const notes = Array.isArray(options.notes) ? options.notes.filter(Boolean) : [message];
  return {
    backend: profile.signerBackend,
    effectiveBackend: profile.signerBackend,
    status: options.status || 'pending',
    ready: false,
    backendImplemented: options.backendImplemented === true,
    configured: options.configured === true,
    readOnly: Boolean(profile.readOnly),
    credentialsRequired: !profile.readOnly,
    signerReady: options.signerReady === true,
    networkContextReady: options.networkContextReady === true,
    secretSource: Object.prototype.hasOwnProperty.call(options, 'secretSource')
      ? options.secretSource
      : null,
    wallet: Object.prototype.hasOwnProperty.call(options, 'wallet') ? options.wallet : null,
    rpcUrl: Object.prototype.hasOwnProperty.call(options, 'rpcUrl') ? options.rpcUrl : null,
    chainId: Object.prototype.hasOwnProperty.call(options, 'chainId') ? options.chainId : null,
    missingSecrets,
    missingContext,
    missing: [...missingSecrets, ...missingContext],
    notes,
  };
}

function resolveLocalEnvProfile(profile, env, includeSecretMaterial, options = {}) {
  const secretRef = isPlainObject(profile.secretRef) ? profile.secretRef : {};
  const privateKey = firstPopulatedEnv(env, secretRef.privateKeyEnv);
  const walletOverride = normalizeOptionalString(options.wallet);
  const rpcUrlOverride = normalizeOptionalString(options.rpcUrl);
  const chainIdOverride = normalizeComparableChainId(options.chainId);
  const wallet = walletOverride
    ? { source: 'input', value: walletOverride }
    : firstPopulatedEnv(env, secretRef.walletEnv);
  const rpcUrl = rpcUrlOverride
    ? { source: 'input', value: rpcUrlOverride }
    : firstPopulatedEnv(env, secretRef.rpcUrlEnv);
  const chainId = chainIdOverride !== null
    ? { source: 'input', value: chainIdOverride }
    : firstPopulatedEnv(env, secretRef.chainIdEnv);
  const missingSecrets = [];
  const missingContext = [];

  if (!privateKey) {
    missingSecrets.push(...(Array.isArray(secretRef.privateKeyEnv) ? secretRef.privateKeyEnv : []));
  }
  if (!rpcUrl) {
    missingContext.push(...(Array.isArray(secretRef.rpcUrlEnv) ? secretRef.rpcUrlEnv : []));
  }
  if (!chainId) {
    missingContext.push(...(Array.isArray(secretRef.chainIdEnv) ? secretRef.chainIdEnv : []));
  }

  const signerReady = Boolean(privateKey);
  const networkContextReady = Boolean(rpcUrl && chainId);
  const ready = signerReady && networkContextReady;
  const status = !signerReady
    ? 'missing-secrets'
    : ready
      ? 'ready'
      : 'missing-context';

  return {
    backend: 'local-env',
    effectiveBackend: 'local-env',
    status,
    ready,
    backendImplemented: true,
    configured: Array.isArray(secretRef.privateKeyEnv) && secretRef.privateKeyEnv.length > 0,
    readOnly: false,
    credentialsRequired: true,
    signerReady,
    networkContextReady,
    secretSource: privateKey
      ? {
          kind: 'env',
          envVar: privateKey.name,
        }
      : null,
    wallet: wallet ? wallet.value : null,
    rpcUrl: rpcUrl ? rpcUrl.value : null,
    chainId: chainId ? normalizeChainIdEnvValue(chainId.value) : null,
    missingSecrets,
    missingContext,
    missing: [...missingSecrets, ...missingContext],
    notes: !signerReady
      ? ['Local-env signer requires a configured private key environment variable.']
      : ready
        ? ['Resolved signer secret reference and network context from local environment/input overrides.']
        : ['Signer secret is available, but rpcUrl/chainId context is still missing.'],
    ...(includeSecretMaterial && privateKey
      ? {
          secretMaterial: {
            privateKey: privateKey.value,
          },
        }
      : {}),
  };
}

function resolveLocalKeystoreProfile(profile) {
  const secretRef = isPlainObject(profile.secretRef) ? profile.secretRef : {};
  const rawPath = normalizeOptionalString(secretRef.path);
  const resolvedPath = rawPath ? path.resolve(expandHome(rawPath)) : null;
  const exists = resolvedPath ? fs.existsSync(resolvedPath) : false;
  const status = !resolvedPath
    ? 'missing-config'
    : exists
      ? 'pending-integration'
      : 'missing-keystore';
  const missingSecrets = !resolvedPath
    ? ['secretRef.path']
    : exists
      ? []
      : [resolvedPath];
  const notes = !resolvedPath
    ? ['local-keystore profiles require secretRef.path.']
    : exists
      ? ['Keystore file is present, but keystore materialization is not implemented in this lane.']
      : ['Configured keystore file does not exist at the resolved path.'];

  return buildPendingResolution(profile, notes[0], {
    status,
    configured: Boolean(resolvedPath),
    backendImplemented: false,
    signerReady: false,
    networkContextReady: false,
    secretSource: resolvedPath
      ? {
          kind: 'file',
          path: resolvedPath,
          exists,
        }
      : null,
    missingSecrets,
    notes,
  });
}

function resolveExternalSignerProfile(profile) {
  const secretRef = isPlainObject(profile.secretRef) ? profile.secretRef : {};
  const reference = normalizeOptionalString(secretRef.reference);
  const status = reference ? 'pending-integration' : 'missing-config';
  const missingSecrets = reference ? [] : ['secretRef.reference'];
  const notes = reference
    ? ['External signer reference is configured, but the external signer transport is not implemented in this lane.']
    : ['external-signer profiles require secretRef.reference.'];

  return buildPendingResolution(profile, notes[0], {
    status,
    configured: Boolean(reference),
    backendImplemented: false,
    signerReady: false,
    networkContextReady: false,
    secretSource: reference
      ? {
          kind: 'external-signer',
          reference,
        }
      : null,
    missingSecrets,
    notes,
  });
}

function resolveNormalizedProfile(profile, options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const includeSecretMaterial = options.includeSecretMaterial === true;

  if (profile.readOnly === true) {
    return buildReadOnlyResolution(profile, {
      notes: profile.signerBackend === 'read-only'
        ? []
        : ['Profile is flagged readOnly; signer secret resolution is intentionally skipped.'],
    });
  }

  if (profile.signerBackend === 'read-only') {
    return buildReadOnlyResolution(profile);
  }

  if (profile.signerBackend === 'local-env') {
    return resolveLocalEnvProfile(profile, env, includeSecretMaterial, options);
  }

  if (profile.signerBackend === 'local-keystore') {
    return resolveLocalKeystoreProfile(profile);
  }

  if (profile.signerBackend === 'external-signer') {
    return resolveExternalSignerProfile(profile);
  }

  return buildPendingResolution(profile, 'Unknown signer backend.');
}

function selectProfile(options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const store = options.store || createProfileStore({ env });

  if (isPlainObject(options.profile)) {
    return {
      source: 'inline',
      builtin: false,
      filePath: null,
      profile: normalizeProfile(options.profile, { source: 'inline' }),
    };
  }

  if (options.profileFile) {
    const fileRecord = store.readProfileFile(options.profileFile, { allowMissing: false });
    const requestedId = options.profileId ? String(options.profileId).trim() : null;
    const profiles = fileRecord.document.profiles;

    if (requestedId) {
      const matched = profiles.find((profile) => profile.id === requestedId) || null;
      if (!matched) {
        throw createProfileError('PROFILE_NOT_FOUND', `Profile not found in file: ${requestedId}`, {
          filePath: fileRecord.filePath,
          id: requestedId,
        });
      }
      return {
        source: 'file',
        builtin: false,
        filePath: fileRecord.filePath,
        profile: matched,
      };
    }

    if (profiles.length !== 1) {
      throw createProfileError(
        'PROFILE_SELECTION_REQUIRED',
        'Profile file contains multiple profiles; pass profileId to disambiguate.',
        {
          filePath: fileRecord.filePath,
          profileCount: profiles.length,
        },
      );
    }

    return {
      source: 'file',
      builtin: false,
      filePath: fileRecord.filePath,
      profile: profiles[0],
    };
  }

  if (options.profileId) {
    const entry = store.getProfile(options.profileId, {
      filePath: options.storeFile || null,
      includeBuiltIns: options.includeBuiltIns !== false,
      builtinOnly: options.builtinOnly === true,
    });
    if (!entry) {
      throw createProfileError('PROFILE_NOT_FOUND', `Profile not found: ${options.profileId}`, {
        id: options.profileId,
      });
    }
    return {
      source: entry.source,
      builtin: entry.builtin,
      filePath: entry.filePath,
      profile: entry.profile,
    };
  }

  if (options.fallbackToReadOnly === true) {
    const entry = store.getProfile(PROFILE_DEFAULT_READ_ONLY_PROFILE_ID, {
      filePath: options.storeFile || null,
      includeBuiltIns: true,
    });
    if (entry) {
      return {
        source: entry.source,
        builtin: entry.builtin,
        filePath: entry.filePath,
        profile: entry.profile,
      };
    }
  }

  throw createProfileError('PROFILE_REQUIRED', 'Profile id, profile file, or inline profile is required.', {
    supportedSelectors: ['profileId', 'profileFile', 'profile'],
  });
}

function resolveProfile(options = {}) {
  const selected = selectProfile(options);
  const compatibility = evaluateProfileCompatibility(selected.profile, options);
  const constraints = buildProfileConstraints(selected.profile);
  const resolution = {
    ...resolveNormalizedProfile(selected.profile, options),
    compatibility,
    constraints,
  };
  return {
    source: selected.source,
    builtin: selected.builtin,
    filePath: selected.filePath,
    profile: selected.profile,
    summary: buildProfileSummary(selected.profile, {
      source: selected.source,
      builtin: selected.builtin,
      filePath: selected.filePath,
    }),
    resolution,
    compatibility,
    constraints,
  };
}

function assertResolvedProfileReady(result) {
  if (result && result.resolution && result.resolution.ready) {
    return result;
  }
  throw createProfileError('PROFILE_RESOLUTION_UNAVAILABLE', 'Profile could not be resolved into a ready signer/backend.', {
    result,
  });
}

function assertProfileExecutionCompatible(result) {
  const compatibility = result && result.compatibility
    ? result.compatibility
    : result && result.resolution
      ? result.resolution.compatibility
      : null;
  if (!compatibility || compatibility.ok) {
    return result;
  }
  throw createProfileError(
    'PROFILE_INCOMPATIBLE',
    'Profile is not compatible with the requested execution context.',
    {
      compatibility,
      violations: compatibility.violations,
    },
  );
}

function assertResolvedProfileUsable(result) {
  assertResolvedProfileReady(result);
  return assertProfileExecutionCompatible(result);
}

function createProfileResolverService(options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const store = options.store || createProfileStore({ env });

  return {
    selectProfile: (resolveOptions = {}) => selectProfile({ ...resolveOptions, env, store }),
    evaluateProfileCompatibility: (profile, resolveOptions = {}) =>
      evaluateProfileCompatibility(profile, { ...resolveOptions, env, store }),
    resolveProfile: (resolveOptions = {}) => resolveProfile({ ...resolveOptions, env, store }),
    assertResolvedProfileReady,
    assertProfileExecutionCompatible,
    assertResolvedProfileUsable,
  };
}

module.exports = {
  buildProfileConstraints,
  resolveNormalizedProfile,
  selectProfile,
  resolveProfile,
  evaluateProfileCompatibility,
  assertResolvedProfileReady,
  assertProfileExecutionCompatible,
  assertResolvedProfileUsable,
  createProfileResolverService,
};
