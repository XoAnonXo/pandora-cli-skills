'use strict';

const SAFE_POLICY_MODES = new Set(['safe', 'dry-run', 'paper', 'fork']);

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunPolicyCommand requires deps.${name}()`);
  }
  return deps[name];
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function uniqueStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function renderPolicyTable(payload) {
  // eslint-disable-next-line no-console
  console.log('ID  NAME  SOURCE  DESCRIPTION');
  const items = Array.isArray(payload.items) ? payload.items : [payload.item || payload];
  for (const item of items) {
    if (!item) continue;
    // eslint-disable-next-line no-console
    console.log(`${item.id}  ${item.displayName}  ${item.source || '-'}  ${item.description || ''}`);
  }
}

function renderPolicyExplainTable(payload) {
  const item = payload && payload.item ? payload.item : null;
  const explanation = payload && payload.explanation ? payload.explanation : null;
  if (!item || !explanation) return;
  // eslint-disable-next-line no-console
  console.log(`${item.id}  ${explanation.decision}  ${explanation.usable ? 'usable' : 'blocked'}  ${explanation.request.command || '-'}`);
  for (const step of Array.isArray(explanation.remediation) ? explanation.remediation : []) {
    // eslint-disable-next-line no-console
    console.log(`action: ${step.message}`);
  }
}

function renderPolicyRecommendTable(payload) {
  // eslint-disable-next-line no-console
  console.log('ID  DECISION  USABLE  SOURCE');
  const candidates = Array.isArray(payload && payload.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    // eslint-disable-next-line no-console
    console.log(`${candidate.id}  ${candidate.decision}  ${candidate.usable ? 'usable' : 'blocked'}  ${candidate.source || '-'}`);
  }
}

function remediationKey(action) {
  if (!action || typeof action !== 'object') return 'summary';
  return JSON.stringify(action);
}

function formatRemediationAction(action, summary) {
  if (!action || typeof action !== 'object') {
    return summary || 'Review the policy guidance and retry.';
  }
  switch (action.type) {
    case 'switch_policy_pack':
      return `Switch to policy pack ${action.packId}.`;
    case 'run_command':
      return `Run ${action.command}.${action.reason ? ` ${action.reason}` : ''}`.trim();
    case 'use_profile':
      return `Use profile ${action.profileId}.`;
    case 'set_input':
      return `Set ${action.field}${action.value !== undefined ? `=${action.value}` : ''}.`;
    case 'provide_context':
      return `Provide context field ${action.field}${action.value !== undefined ? `=${action.value}` : ''}.`;
    case 'provide_input':
      return `Provide input ${action.field}.`;
    default:
      return summary || `Apply remediation action ${action.type || 'unknown'}.`;
  }
}

function collectRemediation(outcomes) {
  const steps = [];
  const seen = new Set();

  for (const outcome of Array.isArray(outcomes) ? outcomes : []) {
    const remediation = outcome && outcome.remediation && typeof outcome.remediation === 'object'
      ? outcome.remediation
      : null;
    if (!remediation) continue;

    const summary = normalizeOptionalString(remediation.summary);
    if (summary && !seen.has(`summary:${summary}`)) {
      seen.add(`summary:${summary}`);
      steps.push({
        type: 'summary',
        message: summary,
        ruleId: outcome.ruleId || null,
        ruleKind: outcome.ruleKind || null,
      });
    }

    for (const action of Array.isArray(remediation.actions) ? remediation.actions : []) {
      const key = remediationKey(action);
      if (seen.has(`action:${key}`)) continue;
      seen.add(`action:${key}`);
      steps.push({
        ...(action || {}),
        message: formatRemediationAction(action, summary),
        summary,
        ruleId: outcome.ruleId || null,
        ruleKind: outcome.ruleKind || null,
      });
    }
  }

  return steps;
}

function buildEvaluationRequest(options, policyId) {
  const request = {
    policyId,
    command: options.command,
  };

  const mode = normalizeOptionalString(options.mode);
  if (mode) {
    request.mode = mode;
    if (SAFE_POLICY_MODES.has(mode)) {
      request.safeModeRequested = true;
    }
  }

  for (const key of ['chainId', 'category', 'profileId', 'secretSource']) {
    const value = normalizeOptionalString(options[key]);
    if (value !== null) {
      request[key] = value;
    }
  }

  for (const key of ['activeOperationCount', 'notionalUsd', 'notionalUsdc', 'projectedTradesToday', 'runtimeSeconds']) {
    if (Number.isFinite(options[key])) {
      request[key] = options[key];
    }
  }

  if (Array.isArray(options.externalDependencies) && options.externalDependencies.length) {
    request.externalDependencies = uniqueStrings(options.externalDependencies.map((value) => normalizeOptionalString(value)).filter(Boolean));
  }

  const validationTicket = normalizeOptionalString(options.validationTicket);
  const validationDecision = normalizeOptionalString(options.validationDecision);
  const webhookUrl = normalizeOptionalString(options.webhookUrl);
  if (validationTicket) {
    request.validationTicket = validationTicket;
  }
  if (validationDecision) {
    request.validationDecision = validationDecision.toUpperCase();
  }
  if (webhookUrl) {
    request.webhookUrl = webhookUrl;
  }

  if (options.agentPreflight || validationTicket || validationDecision) {
    request.agentPreflight = {};
    if (validationTicket) request.agentPreflight.validationTicket = validationTicket;
    if (validationDecision) request.agentPreflight.validationDecision = validationDecision.toUpperCase();
  }
  if (options.agentPreflight) {
    request.hasAgentPreflight = true;
  }

  return request;
}

function buildExplainPayload(item, evaluation, request) {
  return {
    item,
    request,
    evaluation,
    explanation: {
      usable: evaluation.ok,
      decision: evaluation.decision,
      request: {
        command: request.command || null,
        mode: request.mode || null,
        chainId: request.chainId || null,
        category: request.category || null,
        profileId: request.profileId || null,
      },
      blockers: Array.isArray(evaluation.denials) ? evaluation.denials : [],
      warnings: Array.isArray(evaluation.warnings) ? evaluation.warnings : [],
      remediation: collectRemediation([
        ...(Array.isArray(evaluation.denials) ? evaluation.denials : []),
        ...(Array.isArray(evaluation.warnings) ? evaluation.warnings : []),
      ]),
      safeEquivalent: evaluation.safeEquivalent || null,
      recommendedNextTool: evaluation.recommendedNextTool || null,
    },
  };
}

function decisionRank(decision) {
  if (decision === 'allow') return 0;
  if (decision === 'warn') return 1;
  return 2;
}

function compareCandidates(left, right) {
  if (Boolean(left.usable) !== Boolean(right.usable)) {
    return left.usable ? -1 : 1;
  }
  const decisionDiff = decisionRank(left.decision) - decisionRank(right.decision);
  if (decisionDiff !== 0) return decisionDiff;
  if (left.denialCount !== right.denialCount) return left.denialCount - right.denialCount;
  if (left.warningCount !== right.warningCount) return left.warningCount - right.warningCount;
  return String(left.id).localeCompare(String(right.id));
}

function buildRecommendPayload(listing, policyEvaluator, options) {
  const request = buildEvaluationRequest(options, null);
  const candidates = (Array.isArray(listing.items) ? listing.items : [])
    .slice()
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .map((item) => {
      const evaluation = policyEvaluator.evaluateExecution({
        ...request,
        policyId: item.id,
      });
      return {
        id: item.id,
        displayName: item.displayName || item.id,
        description: item.description || '',
        source: item.source || null,
        decision: evaluation.decision,
        usable: evaluation.ok,
        denialCount: Array.isArray(evaluation.denials) ? evaluation.denials.length : 0,
        warningCount: Array.isArray(evaluation.warnings) ? evaluation.warnings.length : 0,
        denials: Array.isArray(evaluation.denials) ? evaluation.denials : [],
        warnings: Array.isArray(evaluation.warnings) ? evaluation.warnings : [],
        remediation: collectRemediation([
          ...(Array.isArray(evaluation.denials) ? evaluation.denials : []),
          ...(Array.isArray(evaluation.warnings) ? evaluation.warnings : []),
        ]),
        safeEquivalent: evaluation.safeEquivalent || null,
        recommendedNextTool: evaluation.recommendedNextTool || null,
      };
    })
    .sort(compareCandidates);

  const recommended = candidates.find((item) => item && item.usable) || null;
  const fallback = candidates[0] || null;
  return {
    request,
    policyDir: listing.dir,
    count: candidates.length,
    errors: Array.isArray(listing.errors) ? listing.errors : [],
    recommendedPolicyId: recommended ? recommended.id : null,
    recommended,
    recommendedNextTool: recommended ? recommended.recommendedNextTool || null : (fallback ? fallback.recommendedNextTool || null : null),
    recommendedSafeEquivalent: recommended ? recommended.safeEquivalent || null : (fallback ? fallback.safeEquivalent || null : null),
    candidates,
  };
}

function createRunPolicyCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parsePolicyFlags = requireDep(deps, 'parsePolicyFlags');
  const createPolicyRegistryService = requireDep(deps, 'createPolicyRegistryService');
  const createPolicyEvaluatorService = typeof deps.createPolicyEvaluatorService === 'function'
    ? deps.createPolicyEvaluatorService
    : () => require('./policy_evaluator_service.cjs').createPolicyEvaluatorService();
  const createPolicyProfileGuidanceService = typeof deps.createPolicyProfileGuidanceService === 'function'
    ? deps.createPolicyProfileGuidanceService
    : (...args) => require('./policy_profile_guidance_service.cjs').createPolicyProfileGuidanceService(...args);
  const createProfileStore = typeof deps.createProfileStore === 'function'
    ? deps.createProfileStore
    : null;
  const createProfileResolverService = typeof deps.createProfileResolverService === 'function'
    ? deps.createProfileResolverService
    : null;

  return async function runPolicyCommand(args, context) {
    const action = args[0];
    const actionArgs = args.slice(1);

    if (!action || action === '--help' || action === '-h') {
      const usage = 'pandora [--output table|json] policy list|get|explain|recommend|lint [flags]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'policy.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'list' && includesHelpFlag(actionArgs)) {
      const usage = 'pandora [--output table|json] policy list';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'policy.list.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'get' && includesHelpFlag(actionArgs)) {
      const usage = 'pandora [--output table|json] policy get --id <policy-id>';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'policy.get.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'explain' && includesHelpFlag(actionArgs)) {
      const usage = 'pandora [--output table|json] policy explain --id <policy-id> --command <tool> [--mode safe|dry-run|paper|fork|execute|execute-live] [--chain-id <id>] [--category <id|name>] [--profile-id <profile-id>]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'policy.explain.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'recommend' && includesHelpFlag(actionArgs)) {
      const usage = 'pandora [--output table|json] policy recommend --command <tool> [--mode safe|dry-run|paper|fork|execute|execute-live] [--chain-id <id>] [--category <id|name>] [--profile-id <profile-id>]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'policy.recommend.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'lint' && includesHelpFlag(actionArgs)) {
      const usage = 'pandora [--output table|json] policy lint --file <path>';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'policy.lint.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    const service = createPolicyRegistryService();
    const policyEvaluator = createPolicyEvaluatorService({ policyRegistry: service });
    const profileStore = createProfileStore ? createProfileStore() : null;
    const profileResolver = createProfileResolverService
      ? createProfileResolverService({ profileStore, policyRegistry: service, policyEvaluator })
      : null;
    const guidance = createPolicyProfileGuidanceService({
      policyRegistry: service,
      policyEvaluator,
      profileStore,
      profileResolver,
    });
    const options = parsePolicyFlags(args);

    if (options.action === 'list') {
      const listing = service.listPolicyPacks();
      emitSuccess(context.outputMode, 'policy.list', {
        policyDir: listing.dir,
        count: listing.items.length,
        builtinCount: listing.builtinCount,
        userCount: listing.storedCount,
        errors: listing.errors,
        items: listing.items,
      }, renderPolicyTable);
      return;
    }

    if (options.action === 'get') {
      const item = service.getPolicyPack(options.id, { compiled: true });
      if (!item) {
        throw new CliError('POLICY_NOT_FOUND', `Policy pack not found: ${options.id}`);
      }
      emitSuccess(context.outputMode, 'policy.get', { item }, renderPolicyTable);
      return;
    }

    if (options.action === 'explain') {
      const item = service.getPolicyPack(options.id, { compiled: true });
      if (!item) {
        throw new CliError('POLICY_NOT_FOUND', `Policy pack not found: ${options.id}`);
      }
      const request = buildEvaluationRequest(options, options.id);
      const evaluation = policyEvaluator.evaluateExecution(request);
      const explained = await guidance.explainPolicy({
        ...options,
        policyId: options.id,
      });
      const payload = buildExplainPayload(item, evaluation, request);
      payload.explanation = {
        policyId: explained.policyId,
        requestedContext: explained.requestedContext,
        usable: explained.usable,
        decision: explained.decision,
        denials: Array.isArray(explained.denials) ? explained.denials : [],
        blockers: Array.isArray(explained.denials) ? explained.denials : [],
        warnings: Array.isArray(explained.warnings) ? explained.warnings : [],
        remediation: Array.isArray(explained.remediation) ? explained.remediation : [],
        safeEquivalent: explained.safeEquivalent || null,
        recommendedNextTool: explained.recommendedNextTool || null,
        profileAssessment: explained.profileAssessment || null,
      };
      emitSuccess(context.outputMode, 'policy.explain', payload, renderPolicyExplainTable);
      return;
    }

    if (options.action === 'recommend') {
      const listing = service.listPolicyPacks();
      const guidancePayload = guidance.recommendPolicies(options);
      const payload = buildRecommendPayload(listing, policyEvaluator, options);
      payload.requestedContext = guidancePayload.requestedContext;
      payload.exact = guidancePayload.exact;
      payload.builtinCount = guidancePayload.builtinCount;
      payload.userCount = guidancePayload.userCount;
      payload.compatibleCount = guidancePayload.compatibleCount;
      const usableCandidateIds = new Set(
        (Array.isArray(payload.candidates) ? payload.candidates : [])
          .filter((item) => item && item.usable)
          .map((item) => item.id),
      );
      const guidanceRecommendedIsUsable = guidancePayload.recommendedPolicyId
        ? usableCandidateIds.has(guidancePayload.recommendedPolicyId)
        : false;
      payload.recommendedPolicyId = guidanceRecommendedIsUsable
        ? guidancePayload.recommendedPolicyId
        : payload.recommendedPolicyId || null;
      payload.recommendedReadOnlyPolicyId = guidancePayload.recommendedReadOnlyPolicyId || null;
      payload.recommendedMutablePolicyId = guidancePayload.recommendedMutablePolicyId || null;
      payload.diagnostics = Array.isArray(guidancePayload.diagnostics) ? guidancePayload.diagnostics : [];
      payload.safestMatch = guidancePayload.safestMatch || null;
      payload.bestMatchForRequestedContext = guidancePayload.bestMatchForRequestedContext || null;
      payload.items = Array.isArray(guidancePayload.items) ? guidancePayload.items : [];
      if (payload.recommendedPolicyId) {
        payload.recommended = payload.candidates.find((item) => item.id === payload.recommendedPolicyId) || payload.recommended;
      } else {
        payload.recommended = null;
      }
      emitSuccess(
        context.outputMode,
        'policy.recommend',
        payload,
        renderPolicyRecommendTable,
      );
      return;
    }

    if (options.action === 'lint') {
      const result = service.lintPolicyPackFile(options.file);
      emitSuccess(context.outputMode, 'policy.lint', result, renderPolicyTable);
      return;
    }

    throw new CliError('INVALID_ARGS', `Unsupported policy subcommand: ${options.action}`);
  };
}

module.exports = {
  createRunPolicyCommand,
};
