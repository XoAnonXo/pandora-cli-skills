'use strict';

const { buildCommandDescriptors } = require('./agent_contract_registry.cjs');
const { createPolicyRegistryService } = require('./policy_registry_service.cjs');
const { createProfileResolverService } = require('./profile_resolver_service.cjs');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeLowerList(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function commandMatchesExact(command, values) {
  const normalizedCommand = normalizeText(command);
  if (!normalizedCommand) return false;
  return (Array.isArray(values) ? values : []).some((entry) => normalizeText(entry) === normalizedCommand);
}

function commandMatchesPrefix(command, values) {
  const normalizedCommand = normalizeText(command);
  if (!normalizedCommand) return false;
  return (Array.isArray(values) ? values : []).some((entry) => {
    const normalized = normalizeText(entry);
    return normalized && (normalized === normalizedCommand || normalizedCommand.startsWith(`${normalized}.`));
  });
}

function matchesCommandSelectors(command, commands, commandPrefixes) {
  return commandMatchesExact(command, commands) || commandMatchesPrefix(command, commandPrefixes);
}

function toVariants(field) {
  const normalized = String(field || '').trim();
  if (!normalized) return [];
  const dashed = normalized
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
  const snake = dashed.replace(/-/g, '_');
  const camel = dashed
    .split('-')
    .map((token, index) => (index === 0 ? token : `${token.slice(0, 1).toUpperCase()}${token.slice(1)}`))
    .join('');
  return Array.from(new Set([normalized, dashed, snake, camel]));
}

function getRequestSources(request) {
  return [request, request && request.arguments, request && request.input].filter((value) => isPlainObject(value));
}

function readRequestValue(request, field) {
  for (const source of getRequestSources(request)) {
    for (const key of toVariants(field)) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        return source[key];
      }
    }
  }
  return undefined;
}

function readRequestObject(request, field) {
  const value = readRequestValue(request, field);
  return isPlainObject(value) ? value : null;
}

function readBooleanFlag(request, field) {
  return readRequestValue(request, field) === true;
}

function readIntentExecute(request) {
  const intent = readRequestObject(request, 'intent');
  return Boolean(intent && intent.execute === true);
}

function descriptorSupportsInput(descriptor, field) {
  if (!descriptor) return false;
  const variants = toVariants(field);
  if (descriptor.inputSchema && isPlainObject(descriptor.inputSchema.properties)) {
    for (const key of Object.keys(descriptor.inputSchema.properties)) {
      const propertyVariants = toVariants(key);
      if (propertyVariants.some((variant) => variants.includes(variant))) {
        return true;
      }
    }
  }
  if (Array.isArray(descriptor.controlInputNames)) {
    for (const inputName of descriptor.controlInputNames) {
      const inputVariants = toVariants(inputName);
      if (inputVariants.some((variant) => variants.includes(variant))) {
        return true;
      }
    }
  }
  return false;
}

function normalizeCommandForDescriptor(command, commandDescriptors) {
  const normalized = String(command || '').trim();
  if (!normalized) return null;
  if (commandDescriptors[normalized]) return normalized;
  const suffixes = new Set(['execute', 'plan', 'validate', 'status', 'cancel', 'close', 'run', 'start', 'stop', 'once']);
  const parts = normalized.split('.');
  while (parts.length > 1 && suffixes.has(parts[parts.length - 1])) {
    parts.pop();
    const candidate = parts.join('.');
    if (commandDescriptors[candidate]) return candidate;
  }
  return commandDescriptors[normalized.split('.')[0]] ? normalized.split('.')[0] : null;
}

function canonicalizeCommandName(command, commandDescriptors) {
  const descriptorKey = normalizeCommandForDescriptor(command, commandDescriptors);
  if (!descriptorKey) return normalizeText(command);
  const descriptor = commandDescriptors[descriptorKey] || null;
  return normalizeText(descriptor && (descriptor.canonicalTool || descriptor.aliasOf || descriptorKey)) || descriptorKey;
}

function getCommandDescriptor(command, commandDescriptors) {
  const canonicalCommand = canonicalizeCommandName(command, commandDescriptors);
  if (canonicalCommand && commandDescriptors[canonicalCommand]) return commandDescriptors[canonicalCommand];
  const descriptorKey = normalizeCommandForDescriptor(command, commandDescriptors);
  return descriptorKey ? commandDescriptors[descriptorKey] || null : null;
}

function deriveSafeModeRequested(request, descriptor) {
  const safeFlags = descriptor && Array.isArray(descriptor.safeFlags) ? descriptor.safeFlags : [];
  return Boolean(
    request.safeModeRequested
    || safeFlags.some((flagName) => readBooleanFlag(request, flagName))
    || readBooleanFlag(request, 'paper')
    || readBooleanFlag(request, 'dry-run')
    || readBooleanFlag(request, 'fork'),
  );
}

function deriveLiveRequested(request, descriptor, explicitMode) {
  const executeFlags = descriptor && Array.isArray(descriptor.executeFlags) ? descriptor.executeFlags : [];
  return Boolean(
    request.live
    || explicitMode === 'execute'
    || explicitMode === 'execute-live'
    || executeFlags.some((flagName) => readBooleanFlag(request, flagName))
    || readBooleanFlag(request, 'execute')
    || readBooleanFlag(request, 'execute-live')
    || readIntentExecute(request),
  );
}

function deriveWebhookConfigured(request) {
  const webhookUrl = normalizeText(readRequestValue(request, 'webhook-url'));
  const discordWebhookUrl = normalizeText(readRequestValue(request, 'discord-webhook-url'));
  const telegramBotToken = normalizeText(readRequestValue(request, 'telegram-bot-token'));
  const telegramChatId = normalizeText(readRequestValue(request, 'telegram-chat-id'));
  return Boolean(
    request.hasWebhook
    || webhookUrl
    || discordWebhookUrl
    || (telegramBotToken && telegramChatId),
  );
}

function buildEvaluationContext(request, commandDescriptors) {
  const requestedCommand = String(request.command || '').trim();
  const canonicalCommand = canonicalizeCommandName(requestedCommand, commandDescriptors);
  const command = canonicalCommand || requestedCommand;
  const descriptor = getCommandDescriptor(command, commandDescriptors);
  const explicitMode = normalizeText(request.mode);
  const normalizedMode = explicitMode ? explicitMode.toLowerCase() : null;
  const safeModeRequested = deriveSafeModeRequested(request, descriptor);
  const liveRequested = deriveLiveRequested(request, descriptor, normalizedMode);
  const agentPreflight = readRequestObject(request, 'agentPreflight');
  const validationTicket = normalizeText(readRequestValue(request, 'validation-ticket'))
    || normalizeText(readRequestValue(request, 'validationTicket'))
    || normalizeText(agentPreflight && agentPreflight.validationTicket);
  const validationDecision = normalizeText(readRequestValue(request, 'validationDecision'))
    || normalizeText(agentPreflight && agentPreflight.validationDecision);
  const validationTicketSupported = Boolean(
    descriptor && (
      descriptorSupportsInput(descriptor, 'validation-ticket')
      || descriptorSupportsInput(descriptor, 'validationTicket')
      || (descriptor.agentWorkflow && descriptor.agentWorkflow.executeRequiresValidation === true)
    ),
  );
  const agentPreflightSupported = Boolean(descriptor && descriptorSupportsInput(descriptor, 'agentPreflight'));
  const validationSupported = Boolean(
    request.validationSupported === true
    || validationTicketSupported
    || agentPreflightSupported,
  );
  const runtimeValues = {
    activeOperationCount: Number(readRequestValue(request, 'activeOperationCount')),
    notionalUsd: Number(readRequestValue(request, 'notionalUsd')),
    notionalUsdc: Number(readRequestValue(request, 'notionalUsdc')),
    projectedTradesToday: Number(readRequestValue(request, 'projectedTradesToday')),
    runtimeSeconds: Number(readRequestValue(request, 'runtimeSeconds')),
  };

  return {
    requestedCommand: requestedCommand || null,
    canonicalCommand: command,
    command,
    descriptor,
    mode: normalizedMode
      || (readBooleanFlag(request, 'execute-live') ? 'execute-live' : null)
      || (liveRequested ? 'execute' : null)
      || (safeModeRequested ? 'safe' : null),
    liveRequested,
    mutating: request.mutating === true || Boolean(descriptor && descriptor.mcpMutating) || liveRequested,
    jobCapable: request.jobCapable === true || Boolean(descriptor && descriptor.jobCapable),
    longRunning: request.longRunning === true || Boolean(descriptor && (descriptor.jobCapable || descriptor.mcpLongRunningBlocked)),
    requiresSecrets: request.requiresSecrets === true || Boolean(descriptor && descriptor.requiresSecrets),
    safeModeRequested,
    validationSupported,
    validationTicketSupported,
    agentPreflightSupported,
    policyScopes: normalizeLowerList(request.policyScopes || (descriptor && descriptor.policyScopes)),
    riskLevel: String(request.riskLevel || (descriptor && descriptor.riskLevel) || '').trim().toLowerCase() || null,
    commandKnown: Boolean(descriptor),
    externalDependencies: normalizeLowerList(request.externalDependencies || (descriptor && descriptor.externalDependencies)),
    profileId: String(request.profileId || '').trim() || null,
    category: String(request.category || '').trim().toLowerCase() || null,
    chainId: request.chainId === undefined || request.chainId === null ? null : String(request.chainId).trim(),
    secretSource: String(request.secretSource || '').trim().toLowerCase() || null,
    hasValidationTicket: Boolean(request.hasValidationTicket || validationTicket),
    validationTicket,
    hasAgentPreflight: Boolean(request.hasAgentPreflight || agentPreflight),
    agentPreflight,
    validationDecision: validationDecision ? validationDecision.toUpperCase() : null,
    webhookConfigured: deriveWebhookConfigured(request),
    safeEquivalent: descriptor && descriptor.safeEquivalent ? descriptor.safeEquivalent : null,
    recommendedPreflightTool: descriptor && descriptor.recommendedPreflightTool ? descriptor.recommendedPreflightTool : null,
    runtimeValues,
    request,
  };
}

function ruleMatchApplies(rule, context) {
  const match = rule && rule.match && typeof rule.match === 'object' ? rule.match : null;
  if (!match) return true;
  if (match.commandKnown !== null && match.commandKnown !== undefined && Boolean(match.commandKnown) !== context.commandKnown) return false;
  if (Array.isArray(match.commands) && match.commands.length && !commandMatchesExact(context.command, match.commands)) return false;
  if (Array.isArray(match.commandPrefixes) && match.commandPrefixes.length && !commandMatchesPrefix(context.command, match.commandPrefixes)) return false;
  if (match.jobCapable !== null && match.jobCapable !== undefined && Boolean(match.jobCapable) !== context.jobCapable) return false;
  if (match.liveRequested !== null && match.liveRequested !== undefined && Boolean(match.liveRequested) !== context.liveRequested) return false;
  if (match.longRunning !== null && match.longRunning !== undefined && Boolean(match.longRunning) !== context.longRunning) return false;
  if (match.mutating !== null && match.mutating !== undefined && Boolean(match.mutating) !== context.mutating) return false;
  if (match.requiresSecrets !== null && match.requiresSecrets !== undefined && Boolean(match.requiresSecrets) !== context.requiresSecrets) return false;
  if (match.safeModeRequested !== null && match.safeModeRequested !== undefined && Boolean(match.safeModeRequested) !== context.safeModeRequested) return false;
  if (match.validationSupported !== null && match.validationSupported !== undefined && Boolean(match.validationSupported) !== context.validationSupported) return false;
  if (Array.isArray(match.policyScopesAny) && match.policyScopesAny.length) {
    const required = normalizeLowerList(match.policyScopesAny);
    if (!required.some((scope) => context.policyScopes.includes(scope))) return false;
  }
  if (Array.isArray(match.riskLevels) && match.riskLevels.length) {
    const allowed = normalizeLowerList(match.riskLevels);
    if (!context.riskLevel || !allowed.includes(context.riskLevel)) return false;
  }
  return true;
}

function createOutcomeFromRule(rule, details = {}) {
  return {
    code: rule && rule.result && rule.result.code ? rule.result.code : 'POLICY_RULE_VIOLATION',
    message: rule && rule.result && rule.result.message ? rule.result.message : 'Policy rule violation.',
    ruleId: rule && rule.id ? rule.id : null,
    ruleKind: rule && rule.kind ? rule.kind : null,
    effect: rule && rule.effect ? rule.effect : 'deny',
    remediation: rule && rule.result ? rule.result.remediation || null : null,
    ...details,
  };
}

function readContextNumericValue(context, field) {
  if (context && context.runtimeValues && Object.prototype.hasOwnProperty.call(context.runtimeValues, field)) {
    const value = context.runtimeValues[field];
    if (Number.isFinite(value)) return value;
  }
  const observed = Number(readRequestValue(context.request, field));
  return Number.isFinite(observed) ? observed : null;
}

function evaluateRule(rule, context) {
  if (!ruleMatchApplies(rule, context)) return null;
  switch (rule.kind) {
    case 'deny_mutating':
      return context.mutating ? createOutcomeFromRule(rule, { command: context.command }) : null;
    case 'require_no_direct_secrets':
      return context.secretSource === 'direct' ? createOutcomeFromRule(rule, { command: context.command }) : null;
    case 'require_safe_mode':
      return context.safeModeRequested ? null : createOutcomeFromRule(rule, { command: context.command });
    case 'deny_live_execution':
      return context.liveRequested ? createOutcomeFromRule(rule, { command: context.command, mode: context.mode }) : null;
    case 'require_validation_support':
      return context.validationSupported ? null : createOutcomeFromRule(rule, { command: context.command });
    case 'require_validation':
      if (!context.validationSupported) return null;
      if (!context.hasValidationTicket) return createOutcomeFromRule(rule, { command: context.command });
      if (Array.isArray(rule.acceptedDecisions) && rule.acceptedDecisions.length) {
        const accepted = normalizeLowerList(rule.acceptedDecisions).map((value) => value.toUpperCase());
        if (!context.validationDecision || !accepted.includes(context.validationDecision)) {
          return createOutcomeFromRule(rule, { command: context.command, validationDecision: context.validationDecision });
        }
      }
      return null;
    case 'require_agent_preflight':
      if (!context.agentPreflightSupported) return null;
      return context.hasAgentPreflight ? null : createOutcomeFromRule(rule, { command: context.command });
    case 'max_context_number': {
      const observed = readContextNumericValue(context, rule.field);
      if (!Number.isFinite(observed)) return null;
      return observed > Number(rule.limit)
        ? createOutcomeFromRule(rule, { field: rule.field, requested: observed, limit: Number(rule.limit) })
        : null;
    }
    case 'max_input_number': {
      const observed = Number(readRequestValue(context.request, rule.field));
      if (!Number.isFinite(observed)) return null;
      return observed > Number(rule.limit)
        ? createOutcomeFromRule(rule, { field: rule.field, requested: observed, limit: Number(rule.limit) })
        : null;
    }
    case 'allow_input_enum': {
      const rawValue = readRequestValue(context.request, rule.field);
      if (rawValue === undefined || rawValue === null || rawValue === '') return null;
      const allowed = normalizeLowerList(rule.values);
      const actual = String(rawValue).trim().toLowerCase();
      return allowed.includes(actual)
        ? null
        : createOutcomeFromRule(rule, { field: rule.field, value: rawValue, expected: allowed });
    }
    case 'allow_commands_only':
      return matchesCommandSelectors(context.command, rule.commands, rule.commandPrefixes)
        ? null
        : createOutcomeFromRule(rule, { command: context.command });
    case 'deny_commands':
      return matchesCommandSelectors(context.command, rule.commands, rule.commandPrefixes)
        ? createOutcomeFromRule(rule, { command: context.command })
        : null;
    case 'allow_external_dependencies': {
      const allowlist = normalizeLowerList(rule.dependencies);
      const disallowed = context.externalDependencies.filter((item) => !allowlist.includes(item));
      return disallowed.length
        ? createOutcomeFromRule(rule, { dependencies: disallowed, expected: allowlist })
        : null;
    }
    case 'require_webhook_for_long_running':
      if (!context.longRunning) return null;
      return context.webhookConfigured
        ? null
        : createOutcomeFromRule(rule, { command: context.command });
    default:
      return null;
  }
}

function compareRecommendationItems(left, right, keyField = 'id') {
  if ((right.score || 0) !== (left.score || 0)) {
    return (right.score || 0) - (left.score || 0);
  }
  const leftKey = String(left && left[keyField] ? left[keyField] : '');
  const rightKey = String(right && right[keyField] ? right[keyField] : '');
  return leftKey.localeCompare(rightKey);
}

function uniqueStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function buildToolRecommendation(toolName, commandDescriptors, reason, score = 0) {
  const canonicalTool = canonicalizeCommandName(toolName, commandDescriptors);
  if (!canonicalTool) return null;
  const descriptor = getCommandDescriptor(canonicalTool, commandDescriptors);
  return {
    tool: canonicalTool,
    summary: descriptor && descriptor.summary ? descriptor.summary : null,
    reasons: uniqueStrings([reason]),
    score,
  };
}

function collectRemediationActions(outcomes) {
  const actions = [];
  for (const outcome of Array.isArray(outcomes) ? outcomes : []) {
    const remediation = outcome && outcome.remediation ? outcome.remediation : null;
    for (const action of Array.isArray(remediation && remediation.actions) ? remediation.actions : []) {
      if (action && typeof action === 'object') actions.push(action);
    }
  }
  return actions;
}

function finalizeToolRecommendations(candidates) {
  const byTool = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate || !candidate.tool) continue;
    const current = byTool.get(candidate.tool);
    if (!current) {
      byTool.set(candidate.tool, candidate);
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

function createPolicyEvaluatorService(options = {}) {
  const commandDescriptors = options.commandDescriptors || buildCommandDescriptors();
  const policyRegistry = options.policyRegistry || createPolicyRegistryService(options);

  function evaluateAgainstPolicy(policy, request = {}, context) {
    const denials = [];
    const warnings = [];
    for (const rule of Array.isArray(policy.compiledRules) ? policy.compiledRules : []) {
      const outcome = evaluateRule(rule, context);
      if (!outcome) continue;
      if (outcome.effect === 'warn') {
        warnings.push(outcome);
      } else {
        denials.push(outcome);
      }
    }
    return {
      ok: denials.length === 0,
      decision: denials.length
        ? 'deny'
        : warnings.length
          ? 'warn'
          : 'allow',
      policyId: policy.id,
      policy,
      denials,
      warnings,
      violations: denials,
    };
  }

  function buildPolicyRecommendations(request, context, denials, selectedProfile, profileRecommendations) {
    const actions = collectRemediationActions(denials);
    const seeded = new Map();

    function seed(policyId, score, reason) {
      const normalized = normalizeText(policyId);
      if (!normalized) return;
      const current = seeded.get(normalized);
      if (!current) {
        seeded.set(normalized, { id: normalized, seedScore: score, reasons: [reason] });
        return;
      }
      current.seedScore = Math.max(current.seedScore, score);
      current.reasons = uniqueStrings([...(current.reasons || []), reason]);
    }

    const profileDefaultPolicy = selectedProfile
      && selectedProfile.constraints
      && selectedProfile.constraints.defaultPolicy
      ? selectedProfile.constraints.defaultPolicy
      : null;

    const rankedBestPolicy = profileRecommendations
      && profileRecommendations.decision
      && profileRecommendations.decision.bestPolicyId
      ? profileRecommendations.decision.bestPolicyId
      : null;
    if (rankedBestPolicy) {
      seed(rankedBestPolicy, 115, 'Top-ranked policy from profile compatibility recommendations.');
    }
    for (const candidate of Array.isArray(profileRecommendations && profileRecommendations.policies)
      ? profileRecommendations.policies.slice(0, 5)
      : []) {
      seed(
        candidate.id,
        100 - (Math.max(Number(candidate.rank) || 1, 1) - 1) * 5,
        'Recommended by ranked profile compatibility.',
      );
    }
    if (profileDefaultPolicy) {
      seed(profileDefaultPolicy, 110, `Matches profile default policy for ${selectedProfile.profile.id}.`);
    }
    for (const action of actions) {
      if (action.type === 'switch_policy_pack' && action.packId) {
        seed(action.packId, 100, 'Referenced by policy remediation.');
      }
    }
    if (request.policyId) {
      seed(request.policyId, 40, 'Currently requested policy.');
    }

    return Array.from(seeded.values())
      .map((candidate) => {
        const policy = policyRegistry.getPolicyPack(candidate.id, { compiled: true });
        if (!policy) {
          return {
            id: candidate.id,
            score: candidate.seedScore - 100,
            decision: 'missing',
            reasons: uniqueStrings([...(candidate.reasons || []), 'Policy pack is not available in the current registry.']),
          };
        }
        const evaluation = evaluateAgainstPolicy(policy, { ...request, policyId: candidate.id }, context);
        const decisionScore = evaluation.ok
          ? 120
          : evaluation.decision === 'warn'
            ? 80
            : 20;
        return {
          id: candidate.id,
          score: candidate.seedScore + decisionScore,
          decision: evaluation.decision,
          reasons: uniqueStrings([
            ...(candidate.reasons || []),
            evaluation.ok
              ? 'Allows the requested context.'
              : evaluation.decision === 'warn'
                ? 'Allows the requested context with warnings.'
                : 'Still denies the requested context.',
          ]),
        };
      })
      .sort((left, right) => compareRecommendationItems(left, right))
      .map((candidate, index) => ({
        rank: index + 1,
        ...candidate,
      }));
  }

  function buildEvaluationRecommendations(request, context, denials) {
    const actions = collectRemediationActions(denials);
    const resolver = createProfileResolverService({
      env: request.env && typeof request.env === 'object' ? request.env : process.env,
    });
    const selectedProfile = (() => {
      if (!request.profileId && !request.profileFile && !(request.profile && typeof request.profile === 'object')) {
        return null;
      }
      try {
        return resolver.resolveProfile({
          profileId: request.profileId,
          profileFile: request.profileFile,
          profile: request.profile,
          storeFile: request.storeFile,
          command: context.command,
          mode: request.mode,
          chainId: request.chainId,
          category: request.category,
          policyId: request.policyId,
          liveRequested: context.liveRequested,
          mutating: context.mutating,
        });
      } catch (_error) {
        return null;
      }
    })();

    const profileRecommendations = resolver.recommendProfiles({
      profileId: request.profileId,
      profileFile: request.profileFile,
      profile: request.profile,
      storeFile: request.storeFile,
      command: context.command,
      mode: request.mode,
      chainId: request.chainId,
      category: request.category,
      policyId: request.policyId,
      liveRequested: context.liveRequested,
      mutating: context.mutating,
    });

    const toolCandidates = [];
    if (context.recommendedPreflightTool) {
      toolCandidates.push(buildToolRecommendation(
        context.recommendedPreflightTool,
        commandDescriptors,
        'Recommended preflight tool for this command.',
        110,
      ));
    }
    if (context.safeEquivalent && context.liveRequested) {
      toolCandidates.push(buildToolRecommendation(
        context.safeEquivalent,
        commandDescriptors,
        'Canonical safe equivalent for the requested live path.',
        105,
      ));
    }
    for (const action of actions) {
      if (action.type === 'run_command' && action.command) {
        toolCandidates.push(buildToolRecommendation(
          action.command,
          commandDescriptors,
          'Referenced by policy remediation.',
          100,
        ));
      }
    }
    if (request.policyId) {
      toolCandidates.push(buildToolRecommendation('policy.get', commandDescriptors, 'Inspect the current policy contract and remediation.', 90));
    } else {
      toolCandidates.push(buildToolRecommendation('policy.list', commandDescriptors, 'Choose a policy pack before execution.', 90));
    }
    if (request.profileId || profileRecommendations.decision.bestProfileId) {
      toolCandidates.push(buildToolRecommendation('profile.explain', commandDescriptors, 'Inspect ranked profile compatibility for the same context.', 85));
    }

    const nextTools = finalizeToolRecommendations([
      ...toolCandidates,
      ...(Array.isArray(profileRecommendations.nextTools) ? profileRecommendations.nextTools.map((item) => ({
        tool: item.tool,
        summary: item.summary,
        reasons: item.reasons,
        score: item.score || 0,
      })) : []),
    ]).slice(0, 5);

    const policies = buildPolicyRecommendations(
      request,
      context,
      denials,
      selectedProfile,
      profileRecommendations,
    ).slice(0, 5);

    return {
      profiles: Array.isArray(profileRecommendations.profiles) ? profileRecommendations.profiles.slice(0, 5) : [],
      policies,
      nextTools,
      decision: {
        bestProfileId: profileRecommendations.decision ? profileRecommendations.decision.bestProfileId : null,
        bestPolicyId: policies[0] ? policies[0].id : (profileRecommendations.decision ? profileRecommendations.decision.bestPolicyId : null),
        bestTool: nextTools[0] ? nextTools[0].tool : null,
      },
    };
  }

  function evaluateExecution(request = {}) {
    const policyId = String(request.policyId || '').trim() || null;
    const policy = policyId ? policyRegistry.getPolicyPack(policyId, { compiled: true }) : null;
    if (!policy) {
      const recommendedNextTool = canonicalizeCommandName('policy.list', commandDescriptors) || 'policy.list';
      return {
        ok: false,
        decision: 'deny',
        policyId,
        denials: [{ code: 'POLICY_NOT_FOUND', message: policyId ? `Unknown policy pack: ${policyId}` : 'Policy pack is required.' }],
        warnings: [],
        violations: [{ code: 'POLICY_NOT_FOUND', message: policyId ? `Unknown policy pack: ${policyId}` : 'Policy pack is required.' }],
        safeEquivalent: 'capabilities',
        recommendedNextTool,
        recommendations: {
          profiles: [],
          policies: [],
          nextTools: [{
            rank: 1,
            tool: recommendedNextTool,
            summary: (getCommandDescriptor(recommendedNextTool, commandDescriptors) || {}).summary || null,
            reasons: ['List available policy packs before retrying execution.'],
            score: 100,
          }],
          decision: {
            bestProfileId: null,
            bestPolicyId: null,
            bestTool: recommendedNextTool,
          },
        },
      };
    }

    const context = buildEvaluationContext(request, commandDescriptors);
    const evaluation = evaluateAgainstPolicy(policy, request, context);
    const recommendations = request.__skipRecommendations === true
      ? null
      : buildEvaluationRecommendations(request, context, evaluation.denials);

    return {
      ...evaluation,
      safeEquivalent: canonicalizeCommandName(context.safeEquivalent || (context.liveRequested ? 'paper-trading' : null), commandDescriptors),
      recommendedNextTool: evaluation.denials.length
        ? (recommendations && recommendations.decision ? recommendations.decision.bestTool : null)
          || canonicalizeCommandName(context.recommendedPreflightTool || 'policy.get', commandDescriptors)
        : null,
      recommendations,
    };
  }

  return {
    evaluateExecution,
  };
}

module.exports = {
  createPolicyEvaluatorService,
};
