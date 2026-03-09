'use strict';

const { buildCommandDescriptors } = require('./agent_contract_registry.cjs');

const SAFE_MODES = new Set(['dry-run', 'paper', 'fork']);
const LIVE_MODES = new Set(['execute', 'execute-live']);
const EXPLAIN_SUFFIXES = new Set(['execute', 'plan', 'validate', 'status', 'cancel', 'close', 'run', 'start', 'stop', 'once']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeMode(value) {
  const text = normalizeText(value);
  return text ? text.toLowerCase() : null;
}

function stableSortById(items) {
  return items.slice().sort((left, right) => String(left.id || '').localeCompare(String(right.id || '')));
}

function normalizeCommandForDescriptor(command, descriptors) {
  const normalized = normalizeText(command);
  if (!normalized) return null;
  if (descriptors[normalized]) return normalized;
  const parts = normalized.split('.');
  while (parts.length > 1 && EXPLAIN_SUFFIXES.has(parts[parts.length - 1])) {
    parts.pop();
    const candidate = parts.join('.');
    if (descriptors[candidate]) return candidate;
  }
  return descriptors[parts[0]] ? parts[0] : null;
}

function buildCanonicalCommandContext(command, descriptors) {
  const requestedCommand = normalizeText(command);
  const descriptorKey = normalizeCommandForDescriptor(requestedCommand, descriptors);
  const descriptor = descriptorKey ? descriptors[descriptorKey] || null : null;
  const normalizedVariant = Boolean(requestedCommand && descriptorKey && requestedCommand !== descriptorKey);
  return {
    requestedCommand,
    descriptorKey,
    canonicalTool: descriptor ? (descriptor.canonicalTool || descriptor.aliasOf || descriptor.name) : requestedCommand,
    aliasOf: normalizedVariant ? descriptorKey : (descriptor ? descriptor.aliasOf || null : null),
    normalizedVariant,
    safeEquivalent: descriptor ? descriptor.safeEquivalent || null : null,
    recommendedPreflightTool: descriptor ? descriptor.recommendedPreflightTool || null : null,
    mutating: Boolean(descriptor && descriptor.mcpMutating),
    requiresSecrets: Boolean(descriptor && descriptor.requiresSecrets),
    policyScopes: descriptor && Array.isArray(descriptor.policyScopes) ? descriptor.policyScopes.slice() : [],
  };
}

function remediationActionsFromOutcomes(outcomes) {
  const steps = [];
  for (const outcome of Array.isArray(outcomes) ? outcomes : []) {
    const remediation = outcome && outcome.remediation && isPlainObject(outcome.remediation) ? outcome.remediation : null;
    if (!remediation) continue;
    const actions = Array.isArray(remediation.actions) ? remediation.actions : [];
    for (const action of actions) {
      if (!action || !action.type) continue;
      const step = {
        code: outcome.code || 'POLICY_REMEDIATION',
        target: 'policy',
        type: action.type,
        actionType: action.type,
        message: remediation.summary || outcome.message || 'Adjust the policy/execution context and retry.',
      };
      if (action.command) step.command = action.command;
      if (action.packId) step.policyId = action.packId;
      if (action.profileId) step.profileId = action.profileId;
      if (action.field) step.field = action.field;
      if (Object.prototype.hasOwnProperty.call(action, 'value')) step.value = action.value;
      steps.push(step);
    }
  }
  return steps;
}

function dedupeSteps(steps) {
  const seen = new Set();
  const result = [];
  for (const step of Array.isArray(steps) ? steps : []) {
    const key = JSON.stringify(step);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(step);
  }
  return result;
}

function determinePolicyMode(policyId, context, evaluation) {
  if (policyId === 'research-only') return 'read-only';
  if (policyId === 'paper-trading') return 'paper';
  const requestedMode = normalizeMode(context && context.mode);
  if (requestedMode && (SAFE_MODES.has(requestedMode) || LIVE_MODES.has(requestedMode))) {
    return requestedMode;
  }
  if (evaluation && evaluation.ok && context && context.mutating) return 'execute';
  return 'paper';
}

function policySafetyRank(recommendedMode) {
  if (recommendedMode === 'read-only') return 0;
  if (SAFE_MODES.has(recommendedMode)) return 1;
  return 2;
}

function profileSafetyRank(item) {
  if (item.readOnly) return 0;
  if (!item.ready) return 1;
  return 2;
}

function isExactPolicyContext(request = {}) {
  return Boolean(
    normalizeText(request.command)
    && normalizeMode(request.mode)
    && normalizeText(request.chainId)
    && normalizeText(request.category),
  );
}

function pickRecommendedPolicyId(items, predicate) {
  const pool = Array.isArray(items) ? items : [];
  return pool.find((item) => predicate(item) && item.usable)?.id
    || pool.find((item) => predicate(item))?.id
    || null;
}

function pickRecommendedProfileId(items, predicate) {
  const pool = Array.isArray(items) ? items : [];
  return pool.find((item) => predicate(item) && item.usable)?.id
    || pool.find((item) => predicate(item))?.id
    || null;
}

function buildMachineUsableRemediation(context, evaluation, options = {}) {
  const steps = [];
  if (context && context.requestedCommand && context.aliasOf) {
    steps.push({
      code: 'USE_CANONICAL_TOOL',
      target: 'command',
      message: `Use canonical tool ${context.canonicalTool} instead of compatibility alias ${context.requestedCommand}.`,
      command: context.canonicalTool,
      aliasOf: context.aliasOf,
    });
  }
  if (context && context.recommendedPreflightTool && evaluation && evaluation.denials && evaluation.denials.length) {
    steps.push({
      code: 'RUN_PREFLIGHT',
      target: 'command',
      message: `Run ${context.recommendedPreflightTool} before retrying the requested workflow.`,
      command: context.recommendedPreflightTool,
    });
  }
  if (context && context.safeEquivalent && evaluation && evaluation.denials && evaluation.denials.length) {
    steps.push({
      code: 'USE_SAFE_EQUIVALENT',
      target: 'command',
      message: `Use safe equivalent ${context.safeEquivalent} while the requested execution path is denied.`,
      command: context.safeEquivalent,
    });
  }
  steps.push(...remediationActionsFromOutcomes([...(evaluation && evaluation.denials || []), ...(evaluation && evaluation.warnings || [])]));
  if (options.profileExplanation && Array.isArray(options.profileExplanation.remediation)) {
    steps.push(...options.profileExplanation.remediation.map((step) => ({ ...step })));
  }
  return dedupeSteps(steps);
}

function createPolicyProfileGuidanceService(options = {}) {
  const commandDescriptors = options.commandDescriptors || buildCommandDescriptors();
  const policyRegistry = options.policyRegistry;
  const policyEvaluator = options.policyEvaluator;
  const profileStore = options.profileStore || null;
  const profileResolver = options.profileResolver || null;
  if (!policyRegistry || typeof policyRegistry.listPolicyPacks !== 'function' || typeof policyRegistry.getPolicyPack !== 'function') {
    throw new Error('createPolicyProfileGuidanceService requires a policyRegistry with listPolicyPacks/getPolicyPack.');
  }
  if (!policyEvaluator || typeof policyEvaluator.evaluateExecution !== 'function') {
    throw new Error('createPolicyProfileGuidanceService requires policyEvaluator.evaluateExecution().');
  }

  async function resolveProfileAssessment(request = {}) {
    const profileId = normalizeText(request.profileId);
    if (!profileId || !profileStore || !profileResolver) return null;
    const entry = profileStore.getProfile(profileId, {
      filePath: request.storeFile || null,
      includeBuiltIns: true,
    });
    if (!entry) {
      return {
        id: profileId,
        found: false,
        usable: false,
        resolution: null,
        explanation: null,
      };
    }
    const resolved = await profileResolver.probeProfile({
      profileId,
      storeFile: request.storeFile || null,
      command: request.command,
      mode: request.mode,
      chainId: request.chainId,
      category: request.category,
      policyId: request.policyId,
    });
    const compatibility = resolved && resolved.compatibility ? resolved.compatibility : (resolved.resolution ? resolved.resolution.compatibility : null);
    return {
      id: profileId,
      found: true,
      usable: Boolean(resolved && resolved.resolution && resolved.resolution.ready && (!compatibility || compatibility.ok)),
      entry,
      resolution: resolved ? resolved.resolution : null,
      compatibility,
      resolved,
    };
  }

  async function explainPolicy(request = {}) {
    const policyId = normalizeText(request.policyId || request.id);
    if (!policyId) {
      throw new Error('explainPolicy requires policyId/id.');
    }
    const commandContext = buildCanonicalCommandContext(request.command, commandDescriptors);
    const evaluation = policyEvaluator.evaluateExecution({
      ...request,
      command: commandContext.canonicalTool || request.command,
      policyId,
    });
    const profileAssessment = await resolveProfileAssessment({ ...request, policyId, command: commandContext.canonicalTool || request.command });
    const remediation = buildMachineUsableRemediation(commandContext, evaluation, {});
    return {
      policyId,
      requestedContext: {
        command: commandContext.requestedCommand,
        canonicalTool: commandContext.canonicalTool,
        aliasOf: commandContext.aliasOf,
        mode: normalizeMode(request.mode),
        chainId: normalizeText(request.chainId),
        category: normalizeText(request.category),
        profileId: normalizeText(request.profileId),
      },
      decision: evaluation.decision,
      usable: Boolean(evaluation.ok && (!profileAssessment || profileAssessment.usable || !profileAssessment.found)),
      denials: evaluation.denials || [],
      warnings: evaluation.warnings || [],
      safeEquivalent: evaluation.safeEquivalent || commandContext.safeEquivalent || null,
      recommendedNextTool: evaluation.recommendedNextTool || commandContext.recommendedPreflightTool || null,
      remediation,
      profileAssessment: profileAssessment
        ? {
            id: profileAssessment.id,
            found: profileAssessment.found,
            usable: profileAssessment.usable,
            resolutionStatus: profileAssessment.resolution ? profileAssessment.resolution.status : null,
            ready: profileAssessment.resolution ? Boolean(profileAssessment.resolution.ready) : false,
            compatibilityOk: profileAssessment.compatibility ? Boolean(profileAssessment.compatibility.ok) : null,
          }
        : null,
    };
  }

  function recommendPolicies(request = {}) {
    const commandContext = buildCanonicalCommandContext(request.command, commandDescriptors);
    const requested = {
      ...request,
      command: commandContext.canonicalTool || request.command,
    };
    const listing = policyRegistry.listPolicyPacks();
    const items = stableSortById(listing.items).map((item) => {
      const evaluation = policyEvaluator.evaluateExecution({
        ...requested,
        policyId: item.id,
      });
      const recommendedMode = determinePolicyMode(item.id, requested, evaluation);
      const safetyRank = policySafetyRank(recommendedMode);
      const exactMatch = Boolean(evaluation.ok && normalizeMode(request.mode) === recommendedMode);
      const usable = Boolean(evaluation.ok);
      return {
        id: item.id,
        displayName: item.displayName,
        description: item.description,
        builtin: item.source === 'builtin',
        source: item.source,
        decision: evaluation.decision,
        usable,
        recommendedMode,
        safetyRank,
        exactMatch,
        canonicalTool: commandContext.canonicalTool,
        aliasOf: commandContext.aliasOf,
        remediation: buildMachineUsableRemediation(commandContext, evaluation),
        denials: evaluation.denials || [],
        warnings: evaluation.warnings || [],
        recommendedNextTool: evaluation.recommendedNextTool || commandContext.recommendedPreflightTool || null,
      };
    }).sort((left, right) => {
      if (left.safetyRank !== right.safetyRank) return left.safetyRank - right.safetyRank;
      if (left.usable !== right.usable) return left.usable ? -1 : 1;
      if (left.exactMatch !== right.exactMatch) return left.exactMatch ? -1 : 1;
      return String(left.id).localeCompare(String(right.id));
    });

    const safestMatch = items.find((item) => item.usable) || items[0] || null;
    const bestMatchForRequestedContext = items.find((item) => item.usable && item.exactMatch)
      || items.find((item) => item.usable && item.safetyRank === 2)
      || items.find((item) => item.usable)
      || null;

    const diagnostics = [];
    if (commandContext.aliasOf) {
      diagnostics.push({
        code: 'USE_CANONICAL_TOOL',
        severity: 'info',
        command: commandContext.canonicalTool,
        aliasOf: commandContext.aliasOf,
        message: `Recommendations are ranked for canonical tool ${commandContext.canonicalTool}, not compatibility alias ${commandContext.requestedCommand}.`,
      });
    }
    if (!isExactPolicyContext(request)) {
      diagnostics.push({
        code: 'PARTIAL_CONTEXT',
        severity: 'info',
        message: 'Recommendations are based on a partial execution context. Add command, mode, chain-id, and category for an exact recommendation.',
      });
    }

    const recommendedReadOnlyPolicyId = pickRecommendedPolicyId(items, (item) => item.recommendedMode === 'read-only');
    const recommendedMutablePolicyId = pickRecommendedPolicyId(items, (item) => item.recommendedMode !== 'read-only');
    const recommendedPolicyId = (bestMatchForRequestedContext && bestMatchForRequestedContext.id)
      || items.find((item) => item.usable && item.recommendedMode !== 'read-only')?.id
      || items.find((item) => item.usable)?.id
      || recommendedMutablePolicyId
      || recommendedReadOnlyPolicyId
      || null;

    return {
      requestedContext: {
        command: commandContext.requestedCommand,
        canonicalTool: commandContext.canonicalTool,
        aliasOf: commandContext.aliasOf,
        mode: normalizeMode(request.mode),
        chainId: normalizeText(request.chainId),
        category: normalizeText(request.category),
        profileId: normalizeText(request.profileId),
      },
      exact: isExactPolicyContext(request),
      count: items.length,
      builtinCount: items.filter((item) => item.builtin).length,
      userCount: items.filter((item) => !item.builtin).length,
      compatibleCount: items.filter((item) => item.usable).length,
      recommendedPolicyId,
      recommendedReadOnlyPolicyId,
      recommendedMutablePolicyId,
      diagnostics,
      safestMatch,
      bestMatchForRequestedContext,
      items,
    };
  }

  async function recommendProfiles(request = {}) {
    if (!profileStore || !profileResolver) {
      throw new Error('recommendProfiles requires profileStore and profileResolver.');
    }
    const commandContext = buildCanonicalCommandContext(request.command, commandDescriptors);
    const listing = profileStore.loadProfileSet({
      filePath: request.storeFile || null,
      includeBuiltIns: request.includeBuiltIns !== false,
      builtinOnly: request.builtinOnly === true,
    });
    const requestedMode = normalizeMode(request.mode);
    const items = [];
    for (const entry of stableSortById(listing.items)) {
      const resolved = await profileResolver.probeProfile({
        profileId: entry.id,
        storeFile: request.storeFile || null,
        command: commandContext.canonicalTool || request.command,
        mode: requestedMode,
        chainId: request.chainId,
        category: request.category,
        policyId: request.policyId,
      });
      const compatibility = resolved && resolved.compatibility ? resolved.compatibility : (resolved.resolution ? resolved.resolution.compatibility : null);
      const ready = Boolean(resolved && resolved.resolution && resolved.resolution.ready);
      const usable = Boolean(ready && (!compatibility || compatibility.ok));
      const recommendedMode = entry.profile && entry.profile.readOnly
        ? 'read-only'
        : usable && requestedMode && LIVE_MODES.has(requestedMode)
          ? requestedMode
          : ready
            ? 'execute'
            : 'dry-run';
      items.push({
        id: entry.id,
        displayName: entry.profile.displayName,
        description: entry.profile.description,
        builtin: entry.builtin,
        source: entry.source,
        readOnly: Boolean(entry.profile.readOnly),
        signerBackend: entry.profile.signerBackend,
        runtimeReady: ready,
        usable,
        compatibilityOk: compatibility ? Boolean(compatibility.ok) : null,
        recommendedMode,
        safetyRank: profileSafetyRank({ readOnly: entry.profile.readOnly, ready }),
        exactMatch: Boolean(usable && requestedMode && recommendedMode === requestedMode),
        canonicalTool: commandContext.canonicalTool,
        aliasOf: commandContext.aliasOf,
        resolutionStatus: resolved.resolution ? resolved.resolution.status : null,
        remediation: dedupeSteps([
          ...(commandContext.aliasOf ? [{ code: 'USE_CANONICAL_TOOL', target: 'command', message: `Use canonical tool ${commandContext.canonicalTool} instead of compatibility alias ${commandContext.requestedCommand}.`, command: commandContext.canonicalTool, aliasOf: commandContext.aliasOf }] : []),
          ...((resolved.resolution && Array.isArray(resolved.resolution.notes)) ? resolved.resolution.notes.map((note) => ({ code: 'PROFILE_NOTE', target: 'profile', message: note })) : []),
          ...((compatibility && Array.isArray(compatibility.violations)) ? compatibility.violations.map((violation) => ({ code: violation.code || 'PROFILE_COMPATIBILITY', target: 'profile', message: violation.message || 'Profile compatibility blocker.' })) : []),
        ]),
      });
    }
    items.sort((left, right) => {
      if (left.safetyRank !== right.safetyRank) return left.safetyRank - right.safetyRank;
      if (left.usable !== right.usable) return left.usable ? -1 : 1;
      if (left.exactMatch !== right.exactMatch) return left.exactMatch ? -1 : 1;
      return String(left.id).localeCompare(String(right.id));
    });

    const safestMatch = items.find((item) => item.usable) || items[0] || null;
    const bestMatchForRequestedContext = items.find((item) => item.usable && item.exactMatch)
      || items.find((item) => item.usable && !item.readOnly)
      || items.find((item) => item.usable)
      || null;

    const diagnostics = [];
    if (commandContext.aliasOf) {
      diagnostics.push({
        code: 'USE_CANONICAL_TOOL',
        severity: 'info',
        command: commandContext.canonicalTool,
        aliasOf: commandContext.aliasOf,
        message: `Recommendations are ranked for canonical tool ${commandContext.canonicalTool}, not compatibility alias ${commandContext.requestedCommand}.`,
      });
    }
    if (!isExactPolicyContext(request) || !normalizeText(request.policyId)) {
      diagnostics.push({
        code: 'PARTIAL_CONTEXT',
        severity: 'info',
        message: 'Recommendations are based on a partial execution context. Add command, mode, chain-id, category, and policy-id for an exact recommendation.',
      });
    }

    const recommendedReadOnlyProfileId = pickRecommendedProfileId(items, (item) => item.readOnly);
    const recommendedMutableProfileId = pickRecommendedProfileId(items, (item) => !item.readOnly);
    const recommendedProfileId = (bestMatchForRequestedContext && bestMatchForRequestedContext.id)
      || recommendedMutableProfileId
      || recommendedReadOnlyProfileId
      || null;

    return {
      profileStoreFile: listing.filePath || null,
      profileStoreExists: Boolean(listing.exists),
      requestedContext: {
        command: commandContext.requestedCommand,
        canonicalTool: commandContext.canonicalTool,
        aliasOf: commandContext.aliasOf,
        mode: requestedMode,
        chainId: normalizeText(request.chainId),
        category: normalizeText(request.category),
        policyId: normalizeText(request.policyId),
      },
      exact: Boolean(isExactPolicyContext(request) && normalizeText(request.policyId)),
      builtInCount: listing.builtInCount || 0,
      fileCount: listing.fileCount || 0,
      count: items.length,
      compatibleCount: items.filter((item) => item.usable).length,
      recommendedProfileId,
      recommendedReadOnlyProfileId,
      recommendedMutableProfileId,
      diagnostics,
      safestMatch,
      bestMatchForRequestedContext,
      items,
    };
  }

  return {
    explainPolicy,
    recommendPolicies,
    recommendProfiles,
  };
}

module.exports = {
  createPolicyProfileGuidanceService,
};
