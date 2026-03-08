'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { buildCommandDescriptors } = require('./agent_contract_registry.cjs');
const {
  PROFILE_DEFAULT_READ_ONLY_PROFILE_ID,
  PROFILE_ENV_CHAIN_ID_CANDIDATES,
  PROFILE_ENV_EXTERNAL_SIGNER_TOKEN_CANDIDATES,
  PROFILE_ENV_EXTERNAL_SIGNER_URL_CANDIDATES,
  PROFILE_ENV_RPC_URL_CANDIDATES,
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
const { createExternalSignerBackend } = require('./signers/external_signer_backend.cjs');
const { createLocalKeystoreSignerBackend } = require('./signers/local_keystore_signer.cjs');

const MUTATING_TOOL_FAMILY_SET = new Set(
  PROFILE_MUTATING_TOOL_FAMILIES.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean),
);

const READ_ONLY_TOOL_FAMILY_SET = new Set(
  PROFILE_READ_ONLY_TOOL_FAMILIES.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean),
);

const PROFILE_RECOMMENDATION_BACKEND_PRIORITY = Object.freeze({
  mutating: Object.freeze({
    'local-env': 40,
    'local-keystore': 30,
    'external-signer': 20,
    'read-only': 0,
  }),
  readOnly: Object.freeze({
    'read-only': 40,
    'local-env': 20,
    'local-keystore': 15,
    'external-signer': 10,
  }),
});

const COMMAND_DESCRIPTOR_SUFFIXES = new Set(['execute', 'plan', 'validate', 'status', 'cancel', 'close', 'run', 'start', 'stop', 'once']);
const COMMAND_DESCRIPTORS = buildCommandDescriptors();

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

function normalizeHexPrivateKey(value) {
  const text = normalizeOptionalString(value);
  if (!text) return null;
  return /^0x[a-fA-F0-9]{64}$/.test(text) ? text : null;
}

function normalizeWalletAddress(value) {
  const text = normalizeOptionalString(value);
  if (!text) return null;
  return /^0x[a-fA-F0-9]{40}$/.test(text) ? text : null;
}

function deriveAddressFromPrivateKey(privateKey) {
  const normalizedKey = normalizeHexPrivateKey(privateKey);
  if (!normalizedKey) return null;
  // viem/accounts is already a runtime dependency on the execution path. Use it
  // here to keep readiness semantics aligned with actual signer materialization.
  const { privateKeyToAccount } = require('viem/accounts');
  return privateKeyToAccount(normalizedKey).address;
}

function normalizeCommandForDescriptor(command, commandDescriptors = COMMAND_DESCRIPTORS) {
  const normalized = normalizeOptionalString(command);
  if (!normalized) return null;
  if (commandDescriptors[normalized]) return normalized;
  const parts = normalized.split('.');
  while (parts.length > 1 && COMMAND_DESCRIPTOR_SUFFIXES.has(parts[parts.length - 1])) {
    parts.pop();
    const candidate = parts.join('.');
    if (commandDescriptors[candidate]) return candidate;
  }
  return commandDescriptors[normalized.split('.')[0]] ? normalized.split('.')[0] : null;
}

function canonicalizeCommand(command, commandDescriptors = COMMAND_DESCRIPTORS) {
  const descriptorKey = normalizeCommandForDescriptor(command, commandDescriptors);
  if (!descriptorKey) return normalizeOptionalString(command);
  const descriptor = commandDescriptors[descriptorKey] || null;
  return normalizeOptionalString(descriptor && (descriptor.canonicalTool || descriptor.aliasOf || descriptorKey))
    || descriptorKey;
}

function getCommandDescriptor(command, commandDescriptors = COMMAND_DESCRIPTORS) {
  const canonicalCommand = canonicalizeCommand(command, commandDescriptors);
  if (canonicalCommand && commandDescriptors[canonicalCommand]) {
    return commandDescriptors[canonicalCommand];
  }
  const descriptorKey = normalizeCommandForDescriptor(command, commandDescriptors);
  return descriptorKey ? commandDescriptors[descriptorKey] || null : null;
}

function createResolutionResult(profile, options = {}) {
  return {
    backend: profile.signerBackend,
    effectiveBackend: Object.prototype.hasOwnProperty.call(options, 'effectiveBackend')
      ? options.effectiveBackend
      : profile.signerBackend,
    status: options.status || 'pending',
    ready: options.ready === true,
    backendImplemented: options.backendImplemented === true,
    configured: options.configured === true,
    readOnly: Boolean(profile.readOnly),
    credentialsRequired: options.credentialsRequired !== false,
    signerReady: options.signerReady === true,
    networkContextReady: options.networkContextReady === true,
    secretSource: Object.prototype.hasOwnProperty.call(options, 'secretSource') ? options.secretSource : null,
    wallet: Object.prototype.hasOwnProperty.call(options, 'wallet') ? options.wallet : null,
    rpcUrl: Object.prototype.hasOwnProperty.call(options, 'rpcUrl') ? options.rpcUrl : null,
    chainId: Object.prototype.hasOwnProperty.call(options, 'chainId') ? options.chainId : null,
    missingSecrets: Array.isArray(options.missingSecrets) ? options.missingSecrets.filter(Boolean) : [],
    missingContext: Array.isArray(options.missingContext) ? options.missingContext.filter(Boolean) : [],
    missing: [
      ...(Array.isArray(options.missingSecrets) ? options.missingSecrets.filter(Boolean) : []),
      ...(Array.isArray(options.missingContext) ? options.missingContext.filter(Boolean) : []),
    ],
    notes: Array.isArray(options.notes) ? options.notes.filter(Boolean) : [],
    ...(Object.prototype.hasOwnProperty.call(options, 'secretMaterial')
      ? { secretMaterial: options.secretMaterial }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(options, 'activeCheck')
      ? { activeCheck: options.activeCheck }
      : {}),
  };
}

async function probeRpcChainContext(options = {}) {
  const rpcUrl = normalizeOptionalString(options.rpcUrl);
  const expectedChainId = normalizeComparableChainId(options.chainId);
  if (!rpcUrl || expectedChainId === null) {
    return {
      ok: false,
      reason: 'missing-context',
      message: 'rpcUrl/chainId are required for an active network probe.',
      chainId: null,
    };
  }

  const fetchImpl = typeof options.fetch === 'function' ? options.fetch : globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return {
      ok: false,
      reason: 'missing-fetch',
      message: 'No fetch implementation is available for RPC probing.',
      chainId: null,
    };
  }

  const controller = new AbortController();
  const timeoutMs = Number.isSafeInteger(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : 1500;
  const timeoutHandle = setTimeout(() => controller.abort(new Error(`RPC probe timed out after ${timeoutMs}ms.`)), timeoutMs);
  try {
    const response = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now(),
        method: 'eth_chainId',
        params: [],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        reason: 'http-error',
        message: `RPC probe failed with HTTP ${response.status}.`,
        chainId: null,
      };
    }
    const payload = await response.json();
    const rawChainId = payload && payload.result ? String(payload.result) : null;
    const normalizedChainId = normalizeComparableChainId(
      rawChainId && /^0x[a-fA-F0-9]+$/.test(rawChainId)
        ? Number.parseInt(rawChainId, 16)
        : rawChainId,
    );
    if (normalizedChainId === null) {
      return {
        ok: false,
        reason: 'invalid-response',
        message: 'RPC probe did not return a valid eth_chainId result.',
        chainId: null,
      };
    }
    if (normalizedChainId !== expectedChainId) {
      return {
        ok: false,
        reason: 'chain-mismatch',
        message: `RPC probe chain mismatch. Expected ${expectedChainId}, got ${normalizedChainId}.`,
        chainId: normalizedChainId,
      };
    }
    return {
      ok: true,
      reason: 'ok',
      message: `RPC probe confirmed chain ${normalizedChainId}.`,
      chainId: normalizedChainId,
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'network-error',
      message: error && error.message ? `RPC probe failed: ${error.message}` : 'RPC probe failed.',
      chainId: null,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function probeReadyResolution(profile, baseResolution, options = {}) {
  if (!baseResolution || baseResolution.ready !== true) {
    return baseResolution;
  }
  const rpcProbe = await probeRpcChainContext({
    rpcUrl: baseResolution.rpcUrl,
    chainId: baseResolution.chainId,
    fetch: options.fetch,
    timeoutMs: options.probeTimeoutMs,
  });
  if (!rpcProbe.ok) {
    return createResolutionResult(profile, {
      status: 'error',
      ready: false,
      backendImplemented: baseResolution.backendImplemented === true,
      configured: baseResolution.configured === true,
      signerReady: baseResolution.signerReady === true,
      networkContextReady: false,
      secretSource: baseResolution.secretSource,
      wallet: baseResolution.wallet,
      rpcUrl: baseResolution.rpcUrl,
      chainId: baseResolution.chainId,
      missingSecrets: baseResolution.missingSecrets,
      missingContext: baseResolution.missingContext,
      notes: [...(baseResolution.notes || []), rpcProbe.message],
      ...(baseResolution.secretMaterial ? { secretMaterial: baseResolution.secretMaterial } : {}),
      activeCheck: {
        kind: 'rpc-chain',
        ok: false,
        reason: rpcProbe.reason,
        chainId: rpcProbe.chainId,
      },
    });
  }
  return {
    ...baseResolution,
    notes: [...(baseResolution.notes || []), rpcProbe.message],
    activeCheck: {
      kind: 'rpc-chain',
      ok: true,
      reason: rpcProbe.reason,
      chainId: rpcProbe.chainId,
    },
  };
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

function getBackendRecommendationPriority(backend, mutatingRequested) {
  const table = mutatingRequested
    ? PROFILE_RECOMMENDATION_BACKEND_PRIORITY.mutating
    : PROFILE_RECOMMENDATION_BACKEND_PRIORITY.readOnly;
  return Number(table[String(backend || '').trim()] || 0);
}

function uniqueStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function compareRecommendationItems(left, right, keyField = 'id') {
  if ((right.score || 0) !== (left.score || 0)) {
    return (right.score || 0) - (left.score || 0);
  }
  if (Boolean(right.current) !== Boolean(left.current)) {
    return Boolean(right.current) ? 1 : -1;
  }
  if (Boolean(right.usable) !== Boolean(left.usable)) {
    return Boolean(right.usable) ? 1 : -1;
  }
  const leftKey = String(left && left[keyField] ? left[keyField] : '');
  const rightKey = String(right && right[keyField] ? right[keyField] : '');
  return leftKey.localeCompare(rightKey);
}

function buildToolRecommendation(toolName, reason, score = 0) {
  const canonicalTool = canonicalizeCommand(toolName);
  if (!canonicalTool) return null;
  const descriptor = getCommandDescriptor(canonicalTool);
  return {
    tool: canonicalTool,
    requestedTool: normalizeOptionalString(toolName),
    summary: descriptor && descriptor.summary ? descriptor.summary : null,
    score,
    reasons: uniqueStrings([reason]),
  };
}

function finalizeToolRecommendations(candidates) {
  const byTool = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate || !candidate.tool) continue;
    const current = byTool.get(candidate.tool);
    if (!current) {
      byTool.set(candidate.tool, {
        ...candidate,
        reasons: uniqueStrings(candidate.reasons),
      });
      continue;
    }
    current.score = Math.max(current.score || 0, candidate.score || 0);
    current.reasons = uniqueStrings([...(current.reasons || []), ...(candidate.reasons || [])]);
    current.summary = current.summary || candidate.summary || null;
  }
  return Array.from(byTool.values())
    .sort((left, right) => compareRecommendationItems(left, right, 'tool'))
    .map((candidate, index) => ({
      rank: index + 1,
      ...candidate,
    }));
}

function buildProfileRecommendationEntry(entry, compatibility, resolution, options = {}) {
  const score = { value: 0 };
  const reasons = [];
  const requestedPolicyId = normalizeOptionalString(options.policyId);
  const mutatingRequested = compatibility ? Boolean(compatibility.mutatingRequested) : false;
  const violations = Array.isArray(compatibility && compatibility.violations) ? compatibility.violations : [];
  const violationCodes = new Set(violations.map((item) => item && item.code).filter(Boolean));
  const defaultPolicy = normalizeOptionalString(entry.profile && entry.profile.defaultPolicy);
  const allowedPolicies = cloneArray(entry.profile && entry.profile.allowedPolicies);

  if (compatibility && compatibility.ok) {
    score.value += 120;
    reasons.push('Compatible with the requested execution context.');
  } else {
    if (violationCodes.has('PROFILE_READ_ONLY_MUTATION_DENIED')) {
      score.value -= 100;
      reasons.push('Excluded because it is read-only for the requested mutating path.');
    }
    if (violationCodes.has('PROFILE_POLICY_NOT_ALLOWED')) {
      score.value -= 35;
      reasons.push('Current policy is not allowed on this profile.');
    }
    if (violationCodes.has('PROFILE_TOOL_FAMILY_NOT_ALLOWED')) {
      score.value -= 50;
      reasons.push('Tool family is not allowed on this profile.');
    }
    if (violationCodes.has('PROFILE_CHAIN_NOT_ALLOWED')) {
      score.value -= 40;
      reasons.push('Requested chain is not allowed on this profile.');
    }
    if (violationCodes.has('PROFILE_CATEGORY_NOT_ALLOWED')) {
      score.value -= 25;
      reasons.push('Requested category is not allowed on this profile.');
    }
  }

  if (resolution && resolution.ready) {
    score.value += 80;
    reasons.push('Runtime-ready in the current environment.');
  } else if (resolution && resolution.status === 'missing-context' && resolution.signerReady) {
    score.value += 30;
    reasons.push('Only runtime/network context is still missing.');
  } else if (resolution && resolution.status === 'missing-secrets') {
    score.value += 15;
    reasons.push('Configured backend is present but still missing secrets.');
  } else if (resolution && resolution.backendImplemented) {
    score.value += 5;
    reasons.push('Backend implementation exists, but runtime prerequisites are still incomplete.');
  }

  if (requestedPolicyId && defaultPolicy && defaultPolicy === requestedPolicyId) {
    score.value += 20;
    reasons.push(`Matches the requested policy ${requestedPolicyId}.`);
  } else if (requestedPolicyId && allowedPolicies.includes(requestedPolicyId)) {
    score.value += 12;
    reasons.push(`Allows the requested policy ${requestedPolicyId}.`);
  } else if (requestedPolicyId && allowedPolicies.length && !allowedPolicies.includes(requestedPolicyId)) {
    score.value -= 12;
  }

  score.value += getBackendRecommendationPriority(entry.profile && entry.profile.signerBackend, mutatingRequested);
  if (entry.builtin) score.value += 2;
  if (options.currentProfileId && entry.id === options.currentProfileId) {
    score.value += 3;
    reasons.push('Currently selected profile.');
  }

  return {
    id: entry.id,
    displayName: entry.profile && entry.profile.displayName ? entry.profile.displayName : entry.id,
    signerBackend: entry.profile && entry.profile.signerBackend ? entry.profile.signerBackend : null,
    source: entry.source,
    builtin: entry.builtin === true,
    readOnly: Boolean(entry.profile && entry.profile.readOnly),
    current: options.currentProfileId ? entry.id === options.currentProfileId : false,
    usable: Boolean(resolution && resolution.ready && compatibility && compatibility.ok),
    runtimeReady: Boolean(resolution && resolution.ready),
    resolutionStatus: resolution ? resolution.status : null,
    compatibilityOk: compatibility ? compatibility.ok : null,
    defaultPolicy,
    allowedPolicies,
    score: score.value,
    reasons: uniqueStrings(reasons),
    violations,
  };
}

function buildRecommendedPoliciesFromProfiles(profileCandidates, requestedPolicyId) {
  const byId = new Map();
  function addCandidate(policyId, score, reason, sourceProfileId) {
    const normalized = normalizeOptionalString(policyId);
    if (!normalized) return;
    const current = byId.get(normalized);
    if (!current) {
      byId.set(normalized, {
        id: normalized,
        score,
        reasons: uniqueStrings([reason]),
        sourceProfileIds: uniqueStrings([sourceProfileId]),
      });
      return;
    }
    current.score = Math.max(current.score, score);
    current.reasons = uniqueStrings([...(current.reasons || []), reason]);
    current.sourceProfileIds = uniqueStrings([...(current.sourceProfileIds || []), sourceProfileId]);
  }

  for (const candidate of Array.isArray(profileCandidates) ? profileCandidates : []) {
    if (candidate.defaultPolicy) {
      addCandidate(candidate.defaultPolicy, candidate.score + 20, 'Default policy on a highly ranked compatible profile.', candidate.id);
    }
    if (requestedPolicyId && Array.isArray(candidate.allowedPolicies) && candidate.allowedPolicies.includes(requestedPolicyId)) {
      addCandidate(requestedPolicyId, candidate.score + 10, 'Requested policy remains compatible with this profile.', candidate.id);
    }
  }

  return Array.from(byId.values())
    .sort((left, right) => compareRecommendationItems(left, right))
    .map((candidate, index) => ({
      rank: index + 1,
      ...candidate,
    }));
}

function buildProfileNextToolRecommendations(options = {}) {
  const requestedDescriptor = getCommandDescriptor(options.command);
  const compatibility = options.compatibility || null;
  const tools = [];

  if (requestedDescriptor && requestedDescriptor.recommendedPreflightTool) {
    tools.push(buildToolRecommendation(
      requestedDescriptor.recommendedPreflightTool,
      'Recommended preflight tool for the requested command.',
      100,
    ));
  }
  if (requestedDescriptor && requestedDescriptor.safeEquivalent && (options.liveRequested === true || (compatibility && compatibility.mutatingRequested))) {
    tools.push(buildToolRecommendation(
      requestedDescriptor.safeEquivalent,
      'Canonical safe equivalent for the requested mutating path.',
      95,
    ));
  }
  if (compatibility && Array.isArray(compatibility.violations) && compatibility.violations.some((entry) => entry && entry.code === 'PROFILE_POLICY_NOT_ALLOWED')) {
    tools.push(buildToolRecommendation('policy.get', 'Inspect the policy contract and choose an allowed pack.', 85));
  }
  if (compatibility && compatibility.ok === false) {
    tools.push(buildToolRecommendation('profile.list', 'Inspect alternative profiles ranked for the same context.', 80));
  }
  tools.push(buildToolRecommendation('profile.explain', 'Re-run profile explain against an exact execution context when inputs change.', 70));

  return finalizeToolRecommendations(tools);
}

function recommendProfiles(options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const store = options.store || createProfileStore({ env });
  const listing = store.loadProfileSet({
    filePath: options.storeFile || null,
    includeBuiltIns: options.includeBuiltIns !== false,
    builtinOnly: options.builtinOnly === true,
  });
  const selected = (() => {
    try {
      return selectProfile({ ...options, env, store });
    } catch (_error) {
      return null;
    }
  })();

  const entries = listing.items.map((entry) => ({
    id: entry.id,
    source: entry.source,
    builtin: entry.builtin,
    filePath: entry.filePath,
    profile: entry.profile,
  }));

  if (selected && !entries.some((entry) => entry.id === selected.profile.id)) {
    entries.unshift({
      id: selected.profile.id,
      source: selected.source,
      builtin: selected.builtin,
      filePath: selected.filePath,
      profile: selected.profile,
    });
  }

  const profileCandidates = entries
    .map((entry) => {
      const compatibility = evaluateProfileCompatibility(entry.profile, options);
      const resolution = resolveNormalizedProfile(entry.profile, { ...options, env, includeSecretMaterial: false });
      return buildProfileRecommendationEntry(entry, compatibility, resolution, {
        ...options,
        currentProfileId: selected && selected.profile ? selected.profile.id : null,
      });
    })
    .sort((left, right) => compareRecommendationItems(left, right))
    .map((candidate, index) => ({
      rank: index + 1,
      ...candidate,
    }));

  const requestedPolicyId = normalizeOptionalString(options.policyId);
  const selectedCandidate = profileCandidates.find((candidate) => candidate.current) || profileCandidates[0] || null;
  const policies = buildRecommendedPoliciesFromProfiles(profileCandidates, requestedPolicyId);
  const nextTools = buildProfileNextToolRecommendations({
    ...options,
    compatibility: selectedCandidate
      ? {
          ok: selectedCandidate.compatibilityOk,
          violations: selectedCandidate.violations,
          mutatingRequested: options.mutating === true
            || options.liveRequested === true
            || String(options.mode || '').trim().toLowerCase() === 'execute',
        }
      : null,
    liveRequested: options.liveRequested === true,
  });

  return {
    requestedCommand: normalizeOptionalString(options.command),
    canonicalCommand: canonicalizeCommand(options.command),
    profiles: profileCandidates.slice(0, 5),
    policies: policies.slice(0, 5),
    nextTools: nextTools.slice(0, 5),
    decision: {
      bestProfileId: profileCandidates[0] ? profileCandidates[0].id : null,
      bestPolicyId: policies[0] ? policies[0].id : null,
      bestTool: nextTools[0] ? nextTools[0].tool : null,
    },
  };
}

function evaluateProfileCompatibility(profile, options = {}) {
  const constraints = buildProfileConstraints(profile);
  const violations = [];
  const policyId = normalizeOptionalString(options.policyId);
  const requestedCommand = normalizeOptionalString(options.command);
  const canonicalCommand = canonicalizeCommand(requestedCommand);
  const command = canonicalCommand || requestedCommand;
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
    requestedCommand,
    canonicalCommand: command,
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
  return createResolutionResult(profile, {
    status: options.status || 'pending',
    ready: false,
    backendImplemented: options.backendImplemented === true,
    configured: options.configured === true,
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
    notes,
  });
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

  const normalizedPrivateKey = privateKey ? normalizeHexPrivateKey(privateKey.value) : null;
  const derivedWallet = normalizedPrivateKey ? deriveAddressFromPrivateKey(normalizedPrivateKey) : null;
  const normalizedConfiguredWallet = wallet ? normalizeWalletAddress(wallet.value) : null;

  if (privateKey && !normalizedPrivateKey) {
    return createResolutionResult(profile, {
      status: 'error',
      ready: false,
      backendImplemented: true,
      configured: Array.isArray(secretRef.privateKeyEnv) && secretRef.privateKeyEnv.length > 0,
      signerReady: false,
      networkContextReady: Boolean(rpcUrl && chainId),
      secretSource: {
        kind: 'env',
        envVar: privateKey.name,
      },
      wallet: null,
      rpcUrl: rpcUrl ? rpcUrl.value : null,
      chainId: chainId ? normalizeChainIdEnvValue(chainId.value) : null,
      missingSecrets,
      missingContext,
      notes: ['Configured local-env private key is malformed. Expected 0x + 64 hex chars.'],
    });
  }

  if (wallet && !normalizedConfiguredWallet) {
    return createResolutionResult(profile, {
      status: 'error',
      ready: false,
      backendImplemented: true,
      configured: Array.isArray(secretRef.privateKeyEnv) && secretRef.privateKeyEnv.length > 0,
      signerReady: Boolean(normalizedPrivateKey),
      networkContextReady: Boolean(rpcUrl && chainId),
      secretSource: privateKey
        ? {
            kind: 'env',
            envVar: privateKey.name,
          }
        : null,
      wallet: derivedWallet,
      rpcUrl: rpcUrl ? rpcUrl.value : null,
      chainId: chainId ? normalizeChainIdEnvValue(chainId.value) : null,
      missingSecrets,
      missingContext,
      notes: ['Configured wallet override is malformed. Expected 0x + 40 hex chars.'],
      ...(includeSecretMaterial && normalizedPrivateKey
        ? { secretMaterial: { privateKey: normalizedPrivateKey } }
        : {}),
    });
  }

  if (normalizedPrivateKey && normalizedConfiguredWallet && derivedWallet
    && derivedWallet.toLowerCase() !== normalizedConfiguredWallet.toLowerCase()) {
    return createResolutionResult(profile, {
      status: 'error',
      ready: false,
      backendImplemented: true,
      configured: Array.isArray(secretRef.privateKeyEnv) && secretRef.privateKeyEnv.length > 0,
      signerReady: true,
      networkContextReady: Boolean(rpcUrl && chainId),
      secretSource: {
        kind: 'env',
        envVar: privateKey.name,
      },
      wallet: derivedWallet,
      rpcUrl: rpcUrl ? rpcUrl.value : null,
      chainId: chainId ? normalizeChainIdEnvValue(chainId.value) : null,
      missingSecrets,
      missingContext,
      notes: [`Configured wallet override does not match the signer address derived from the private key (${derivedWallet}).`],
      ...(includeSecretMaterial
        ? { secretMaterial: { privateKey: normalizedPrivateKey } }
        : {}),
    });
  }

  const signerReady = Boolean(normalizedPrivateKey && derivedWallet);
  const networkContextReady = Boolean(rpcUrl && chainId);
  const ready = signerReady && networkContextReady;
  const status = !signerReady ? 'missing-secrets' : ready ? 'ready' : 'missing-context';

  return createResolutionResult(profile, {
    status,
    ready,
    backendImplemented: true,
    configured: Array.isArray(secretRef.privateKeyEnv) && secretRef.privateKeyEnv.length > 0,
    signerReady,
    networkContextReady,
    secretSource: privateKey
      ? {
          kind: 'env',
          envVar: privateKey.name,
        }
      : null,
    wallet: derivedWallet,
    rpcUrl: rpcUrl ? rpcUrl.value : null,
    chainId: chainId ? normalizeChainIdEnvValue(chainId.value) : null,
    missingSecrets,
    missingContext,
    notes: !signerReady
      ? ['Local-env signer requires a configured valid private key environment variable.']
      : ready
        ? ['Resolved local-env signer material and network context from environment/input overrides.']
        : ['Signer material is valid, but rpcUrl/chainId context is still missing.'],
    ...(includeSecretMaterial && normalizedPrivateKey
      ? {
          secretMaterial: {
            privateKey: normalizedPrivateKey,
          },
        }
      : {}),
  });
}

function resolveLocalKeystoreProfile(profile, options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const backend = createLocalKeystoreSignerBackend({ env });
  return backend.resolveProfile(profile, options);
}

function resolveExternalSignerProfile(profile, options = {}) {
  const secretRef = isPlainObject(profile.secretRef) ? profile.secretRef : {};
  const reference = normalizeOptionalString(secretRef.reference);
  const baseUrlEntry = firstPopulatedEnv(
    options.env || process.env,
    Array.isArray(secretRef.baseUrlEnv) && secretRef.baseUrlEnv.length
      ? secretRef.baseUrlEnv
      : PROFILE_ENV_EXTERNAL_SIGNER_URL_CANDIDATES,
  );
  const rpcUrlOverride = normalizeOptionalString(options.rpcUrl);
  const chainIdOverride = normalizeComparableChainId(options.chainId);
  const rpcUrl = rpcUrlOverride
    ? { source: 'input', value: rpcUrlOverride }
    : firstPopulatedEnv(
      options.env || process.env,
      Array.isArray(secretRef.rpcUrlEnv) && secretRef.rpcUrlEnv.length
        ? secretRef.rpcUrlEnv
        : PROFILE_ENV_RPC_URL_CANDIDATES,
    );
  const chainId = chainIdOverride !== null
    ? { source: 'input', value: chainIdOverride }
    : firstPopulatedEnv(
      options.env || process.env,
      Array.isArray(secretRef.chainIdEnv) && secretRef.chainIdEnv.length
        ? secretRef.chainIdEnv
        : PROFILE_ENV_CHAIN_ID_CANDIDATES,
    );
  const baseUrl = normalizeOptionalString(secretRef.baseUrl) || (baseUrlEntry ? baseUrlEntry.value : null);
  const missingSecrets = [];
  const missingContext = [];
  const notes = [];

  if (!reference) {
    missingSecrets.push('secretRef.reference');
  }
  if (!baseUrl) {
    missingContext.push(...(
      Array.isArray(secretRef.baseUrlEnv) && secretRef.baseUrlEnv.length
        ? secretRef.baseUrlEnv
        : PROFILE_ENV_EXTERNAL_SIGNER_URL_CANDIDATES
    ));
  }
  if (!rpcUrl) {
    missingContext.push(...(
      Array.isArray(secretRef.rpcUrlEnv) && secretRef.rpcUrlEnv.length
        ? secretRef.rpcUrlEnv
        : PROFILE_ENV_RPC_URL_CANDIDATES
    ));
  }
  if (!chainId) {
    missingContext.push(...(
      Array.isArray(secretRef.chainIdEnv) && secretRef.chainIdEnv.length
        ? secretRef.chainIdEnv
        : PROFILE_ENV_CHAIN_ID_CANDIDATES
    ));
  }

  if (!reference || !baseUrl) {
    notes.push(!reference ? 'external-signer profiles require secretRef.reference.' : 'External signer base URL is not configured.');
    return buildPendingResolution(profile, notes[0], {
      status: !reference ? 'missing-config' : 'missing-context',
      configured: Boolean(reference),
      backendImplemented: true,
      signerReady: false,
      networkContextReady: Boolean(rpcUrl && chainId),
      secretSource: reference
        ? {
            kind: 'external-signer',
            reference,
          }
        : null,
      rpcUrl: rpcUrl ? rpcUrl.value : null,
      chainId: chainId ? normalizeChainIdEnvValue(chainId.value) : null,
      missingSecrets,
      missingContext,
      notes,
    });
  }

  if (!rpcUrl || !chainId) {
    notes.push('External signer is configured, but rpcUrl/chainId context is still missing.');
    return buildPendingResolution(profile, notes[0], {
      status: 'missing-context',
      configured: true,
      backendImplemented: true,
      signerReady: true,
      networkContextReady: false,
      secretSource: {
        kind: 'external-signer',
        reference,
      },
      rpcUrl: rpcUrl ? rpcUrl.value : null,
      chainId: chainId ? normalizeChainIdEnvValue(chainId.value) : null,
      missingSecrets,
      missingContext,
      notes,
    });
  }

  notes.push('External signer transport is configured. Active health and account checks are required to prove runtime readiness.');
  return createResolutionResult(profile, {
    status: 'ready',
    ready: true,
    backendImplemented: true,
    configured: true,
    signerReady: true,
    networkContextReady: true,
    secretSource: {
      kind: 'external-signer',
      reference,
    },
    wallet: normalizeWalletAddress(secretRef.wallet),
    rpcUrl: rpcUrl.value,
    chainId: normalizeChainIdEnvValue(chainId.value),
    missingSecrets,
    missingContext,
    notes,
  });
}

async function probeExternalSignerProfile(profile, options = {}) {
  const baseResolution = resolveExternalSignerProfile(profile, options);
  if (!baseResolution.ready) {
    return baseResolution;
  }
  try {
    const secretRef = isPlainObject(profile.secretRef) ? profile.secretRef : {};
    const env = options.env && typeof options.env === 'object' ? options.env : process.env;
    const baseUrlEntry = firstPopulatedEnv(
      env,
      Array.isArray(secretRef.baseUrlEnv) && secretRef.baseUrlEnv.length
        ? secretRef.baseUrlEnv
        : PROFILE_ENV_EXTERNAL_SIGNER_URL_CANDIDATES,
    );
    const authTokenEntry = firstPopulatedEnv(
      env,
      Array.isArray(secretRef.authTokenEnv) && secretRef.authTokenEnv.length
        ? secretRef.authTokenEnv
        : PROFILE_ENV_EXTERNAL_SIGNER_TOKEN_CANDIDATES,
    );
    const baseUrl = normalizeOptionalString(secretRef.baseUrl) || (baseUrlEntry ? baseUrlEntry.value : null);
    const reference = baseResolution.secretSource && baseResolution.secretSource.reference
      ? baseResolution.secretSource.reference
      : normalizeOptionalString(secretRef.reference);
    const backend = createExternalSignerBackend({
      baseUrl,
      authToken: authTokenEntry ? authTokenEntry.value : null,
      reference,
      supportedMethods: secretRef.supportedMethods,
      chainIds: Array.isArray(profile.chainAllowlist) ? profile.chainAllowlist : null,
      headers: isPlainObject(secretRef.headers) ? secretRef.headers : null,
      timeoutMs: secretRef.timeoutMs,
    });
    const health = await backend.healthCheck();
    const accounts = await backend.listAccounts({ chainId: baseResolution.chainId });
    const discoveredAccounts = Array.isArray(accounts.accounts) ? accounts.accounts : [];
    const configuredWallet = normalizeWalletAddress(
      baseResolution.wallet
      || (isPlainObject(secretRef) ? secretRef.wallet : null),
    );
    if (!discoveredAccounts.length) {
      return buildPendingResolution(profile, 'External signer returned no accounts for the requested chain.', {
        status: 'error',
        configured: true,
        backendImplemented: true,
        signerReady: false,
        networkContextReady: true,
        secretSource: baseResolution.secretSource,
        rpcUrl: baseResolution.rpcUrl,
        chainId: baseResolution.chainId,
        notes: ['External signer returned no accounts for the requested chain.'],
      });
    }
    if (!configuredWallet && discoveredAccounts.length > 1) {
      return buildPendingResolution(profile, 'External signer returned multiple accounts. Configure a pinned wallet before treating the profile as runtime-ready.', {
        status: 'error',
        configured: true,
        backendImplemented: true,
        signerReady: false,
        networkContextReady: true,
        secretSource: baseResolution.secretSource,
        rpcUrl: baseResolution.rpcUrl,
        chainId: baseResolution.chainId,
        notes: ['External signer returned multiple accounts. Configure a pinned wallet before treating the profile as runtime-ready.'],
      });
    }
    if (configuredWallet && !discoveredAccounts.some((entry) => normalizeWalletAddress(entry.address) === configuredWallet)) {
      return buildPendingResolution(profile, 'Configured external-signer wallet is not available from the remote signer.', {
        status: 'error',
        configured: true,
        backendImplemented: true,
        signerReady: false,
        networkContextReady: true,
        secretSource: baseResolution.secretSource,
        rpcUrl: baseResolution.rpcUrl,
        chainId: baseResolution.chainId,
        wallet: configuredWallet,
        notes: ['Configured external-signer wallet is not available from the remote signer.'],
      });
    }
    const resolvedWallet = configuredWallet || normalizeWalletAddress(discoveredAccounts[0].address);
    const notes = [
      ...baseResolution.notes.filter((note) => !String(note).includes('Use profile get/validate for active health checks')),
      'External signer passed active health and account checks.',
    ];
    return {
      ...baseResolution,
      status: health.healthy === false ? 'error' : 'ready',
      ready: health.healthy !== false,
      signerReady: health.healthy !== false,
      wallet: resolvedWallet,
      notes,
      activeCheck: {
        kind: 'external-signer',
        ok: health.healthy !== false,
        accountsDiscovered: discoveredAccounts.length,
      },
    };
  } catch (error) {
    const notes = [
      ...baseResolution.notes.filter((note) => !String(note).includes('Use profile get/validate for active health checks')),
      error && error.message ? error.message : 'External signer health check failed.',
    ];
    return buildPendingResolution(profile, notes[notes.length - 1], {
      status: 'error',
      configured: true,
      backendImplemented: true,
      signerReady: false,
      networkContextReady: true,
      secretSource: baseResolution.secretSource,
      rpcUrl: baseResolution.rpcUrl,
      chainId: baseResolution.chainId,
      missingSecrets: baseResolution.missingSecrets,
      missingContext: baseResolution.missingContext,
      notes,
    });
  }
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
    return resolveLocalKeystoreProfile(profile, { ...options, env, includeSecretMaterial });
  }

  if (profile.signerBackend === 'external-signer') {
    return resolveExternalSignerProfile(profile, { ...options, env });
  }

  return buildPendingResolution(profile, 'Unknown signer backend.');
}

async function probeNormalizedProfile(profile, options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;

  if (profile.readOnly === true || profile.signerBackend === 'read-only') {
    return resolveNormalizedProfile(profile, options);
  }

  if (profile.signerBackend === 'local-env' || profile.signerBackend === 'local-keystore') {
    return probeReadyResolution(profile, resolveNormalizedProfile(profile, options), options);
  }

  if (profile.signerBackend === 'external-signer') {
    return probeExternalSignerProfile(profile, { ...options, env, activeCheck: true });
  }

  return resolveNormalizedProfile(profile, options);
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
  const recommendations = recommendProfiles({
    ...options,
    env: options.env,
    store: options.store,
  });
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
    recommendations,
  };
}

async function probeProfile(options = {}) {
  const selected = selectProfile(options);
  const compatibility = evaluateProfileCompatibility(selected.profile, options);
  const constraints = buildProfileConstraints(selected.profile);
  const resolution = {
    ...(await probeNormalizedProfile(selected.profile, options)),
    compatibility,
    constraints,
  };
  const recommendations = recommendProfiles({
    ...options,
    env: options.env,
    store: options.store,
  });
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
    recommendations,
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
    recommendProfiles: (resolveOptions = {}) => recommendProfiles({ ...resolveOptions, env, store }),
    evaluateProfileCompatibility: (profile, resolveOptions = {}) =>
      evaluateProfileCompatibility(profile, { ...resolveOptions, env, store }),
    resolveProfile: (resolveOptions = {}) => resolveProfile({ ...resolveOptions, env, store }),
    probeProfile: (resolveOptions = {}) => probeProfile({ ...resolveOptions, env, store }),
    assertResolvedProfileReady,
    assertProfileExecutionCompatible,
    assertResolvedProfileUsable,
  };
}

module.exports = {
  buildProfileConstraints,
  resolveNormalizedProfile,
  probeNormalizedProfile,
  selectProfile,
  resolveProfile,
  probeProfile,
  evaluateProfileCompatibility,
  recommendProfiles,
  assertResolvedProfileReady,
  assertProfileExecutionCompatible,
  assertResolvedProfileUsable,
  createProfileResolverService,
};
