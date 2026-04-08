'use strict';

const { POLL_CATEGORY_IDS } = require('./shared/poll_categories.cjs');

const PROFILE_HELP_PREFIX = 'pandora [--output table|json] profile [--mode <safe|dry-run|paper|fork|execute|execute-live>]';

const EXACT_CONTEXT_FLAGS = Object.freeze([
  { key: 'command', flag: '--command' },
  { key: 'mode', flag: '--mode' },
  { key: 'chainId', flag: '--chain-id' },
  { key: 'category', flag: '--category' },
  { key: 'policyId', flag: '--policy-id' },
]);
const NON_MUTATING_PROFILE_MODES = new Set(['dry-run', 'paper', 'fork']);
const MUTATING_PROFILE_MODES = new Set(['execute', 'execute-live']);
const CATEGORY_NAME_BY_ID = Object.freeze(
  Object.fromEntries(
    Object.entries(POLL_CATEGORY_IDS).map(([name, id]) => [String(id), name]),
  ),
);

function buildProfileUsage(suffix) {
  return PROFILE_HELP_PREFIX + ' ' + suffix;
}

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunProfileCommand requires deps.${name}()`);
  }
  return deps[name];
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function hasContextValue(value) {
  return normalizeOptionalString(value) !== null;
}

function uniqueStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function formatValueList(values) {
  return uniqueStrings(values).map((value) => String(value)).join(', ');
}

function displayCategory(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!text) return null;
  return CATEGORY_NAME_BY_ID[text] || text;
}

function displayCategoryList(values) {
  return uniqueStrings((Array.isArray(values) ? values : []).map((value) => displayCategory(value) || value));
}

function renderProfileListTable(payload) {
  // eslint-disable-next-line no-console
  console.log('ID  SIGNER_BACKEND  MUTABLE  STATUS  SOURCE');
  const items = Array.isArray(payload && payload.items) ? payload.items : [];
  for (const item of items) {
    // eslint-disable-next-line no-console
    console.log(
      `${item.id}  ${item.signerBackend}  ${item.readOnly ? 'read-only' : 'mutable'}  ${item.runtimeReady ? 'ready' : (item.resolutionStatus || 'pending')}  ${item.source || '-'}`,
    );
  }
}

function renderProfileRow(profile) {
  if (!profile) return;
  // eslint-disable-next-line no-console
  console.log(`${profile.id}  ${profile.signerBackend}  ${profile.readOnly ? 'read-only' : 'mutable'}`);
}

function renderProfileGetTable(payload) {
  const profile = payload && payload.profile ? payload.profile : null;
  const resolution = payload && payload.resolution ? payload.resolution : null;
  if (!profile) return;
  // eslint-disable-next-line no-console
  console.log('ID  SIGNER_BACKEND  MUTABLE');
  renderProfileRow(profile);
  if (resolution) {
    // eslint-disable-next-line no-console
    console.log(`resolution=${resolution.status}  ready=${resolution.ready ? 'yes' : 'no'}`);
  }
}

function renderProfileExplainTable(payload) {
  const profile = payload && payload.profile ? payload.profile : null;
  const resolution = payload && payload.resolution ? payload.resolution : null;
  const explanation = payload && payload.explanation ? payload.explanation : null;
  if (!profile) return;
  // eslint-disable-next-line no-console
  console.log('ID  SIGNER_BACKEND  MUTABLE');
  renderProfileRow(profile);
  if (!explanation) {
    if (resolution) {
      // eslint-disable-next-line no-console
      console.log(`resolution=${resolution.status}  ready=${resolution.ready ? 'yes' : 'no'}`);
    }
    return;
  }
  const compatibilityState = explanation.compatibility
    ? explanation.compatibility.ok ? 'ok' : 'blocked'
    : 'unknown';
  // eslint-disable-next-line no-console
  console.log(
    `usable=${explanation.usable ? 'yes' : 'no'}  exact=${explanation.requestedContext && explanation.requestedContext.exact ? 'yes' : 'no'}  resolution=${resolution ? resolution.status : '-'}  compatibility=${compatibilityState}`,
  );
  for (const step of Array.isArray(explanation.remediation) ? explanation.remediation : []) {
    // eslint-disable-next-line no-console
    console.log(`action: ${step.message}`);
  }
}


function renderProfileRecommendTable(payload) {
  // eslint-disable-next-line no-console
  console.log('ID  RECOMMENDED_MODE  USABLE  TOOL');
  const items = Array.isArray(payload && payload.items) ? payload.items : [];
  for (const item of items) {
    // eslint-disable-next-line no-console
    console.log(`${item.id}  ${item.recommendedMode || '-'}  ${item.usable ? 'usable' : (item.resolutionStatus || 'blocked')}  ${item.canonicalTool || '-'}`);
  }
}

function renderProfileValidateTable(payload) {
  // eslint-disable-next-line no-console
  console.log('ID  SIGNER_BACKEND  MUTABLE  READY');
  const items = Array.isArray(payload && payload.items) ? payload.items : [];
  for (const item of items) {
    // eslint-disable-next-line no-console
    console.log(`${item.id}  ${item.signerBackend}  ${item.readOnly ? 'read-only' : 'mutable'}  ${item.runtimeReady ? 'ready' : 'pending'}`);
  }
}

function buildExplainCompatibility(resolved, options = {}) {
  const compatibility = resolved && resolved.compatibility ? resolved.compatibility : null;
  if (!compatibility) return null;

  const profile = resolved && resolved.profile ? resolved.profile : null;
  const constraints = compatibility.constraints || (resolved && resolved.constraints) || {};
  const requestedMode = normalizeOptionalString(options.mode);
  let mutatingRequested = Boolean(compatibility.mutatingRequested);
  if (requestedMode && NON_MUTATING_PROFILE_MODES.has(requestedMode)) {
    mutatingRequested = false;
  } else if (requestedMode && MUTATING_PROFILE_MODES.has(requestedMode)) {
    mutatingRequested = true;
  }

  const violations = (Array.isArray(compatibility.violations) ? compatibility.violations : [])
    .filter(Boolean)
    .filter((entry) => entry.code !== 'PROFILE_READ_ONLY_MUTATION_DENIED')
    .map((entry) => ({ ...entry }));

  if (mutatingRequested && constraints.readOnly) {
    violations.unshift({
      code: 'PROFILE_READ_ONLY_MUTATION_DENIED',
      message: `Profile ${profile && profile.id ? profile.id : 'selected-profile'} is read-only and cannot be used for mutating execution.`,
      command: compatibility.command,
      toolFamily: compatibility.toolFamily,
    });
  }

  return {
    ...compatibility,
    mutatingRequested,
    ok: violations.length === 0,
    violations,
  };
}

function buildRequestedContext(options = {}, compatibility = null) {
  const requested = {
    command: normalizeOptionalString(options.command),
    mode: normalizeOptionalString(options.mode),
    chainId: normalizeOptionalString(options.chainId),
    category: normalizeOptionalString(options.category),
    policyId: normalizeOptionalString(options.policyId),
  };
  const missingFlags = EXACT_CONTEXT_FLAGS
    .filter(({ key }) => !hasContextValue(requested[key]))
    .map(({ flag }) => flag);

  return {
    exact: missingFlags.length === 0,
    missingFlags,
    requested,
    evaluated: compatibility
      ? {
          command: compatibility.command,
          toolFamily: compatibility.toolFamily,
          mode: requested.mode,
          chainId: compatibility.chainId,
          category: compatibility.category,
          categoryName: displayCategory(compatibility.category),
          policyId: compatibility.policyId,
          approvalMode: compatibility.approvalMode,
          mutatingRequested: Boolean(compatibility.mutatingRequested),
        }
      : {
          command: requested.command,
          toolFamily: null,
          mode: requested.mode,
          chainId: requested.chainId,
          category: requested.category,
          categoryName: displayCategory(requested.category),
          policyId: requested.policyId,
          approvalMode: null,
          mutatingRequested: false,
        },
  };
}

function buildReadinessRemediation(resolution, profileId) {
  if (!resolution) return [];
  const steps = [];

  if (Array.isArray(resolution.missingSecrets) && resolution.missingSecrets.length) {
    steps.push({
      code: 'SET_SIGNER_SECRETS',
      target: 'readiness',
      message: `Provide signer secrets for ${profileId}: ${formatValueList(resolution.missingSecrets)}.`,
      missingSecrets: uniqueStrings(resolution.missingSecrets),
    });
  }

  if (Array.isArray(resolution.missingContext) && resolution.missingContext.length) {
    steps.push({
      code: 'SET_NETWORK_CONTEXT',
      target: 'readiness',
      message: `Provide missing signer/network context for ${profileId}: ${formatValueList(resolution.missingContext)}.`,
      missingContext: uniqueStrings(resolution.missingContext),
    });
  }

  if (resolution.status === 'missing-keystore') {
    steps.push({
      code: 'CREATE_OR_POINT_TO_KEYSTORE',
      target: 'readiness',
      message: 'Create the encrypted keystore file or update secretRef.path to a valid keystore JSON file.',
    });
  }

  if (resolution.status === 'unsafe-permissions') {
    steps.push({
      code: 'FIX_KEYSTORE_PERMISSIONS',
      target: 'readiness',
      message: 'Restrict keystore file permissions to owner-only read/write (0600) before retrying.',
    });
  }

  if (resolution.status === 'locked') {
    steps.push({
      code: 'UNLOCK_KEYSTORE',
      target: 'readiness',
      message: 'Provide the keystore password through the configured password source before retrying execute mode.',
    });
  }

  if (resolution.status === 'invalid-password') {
    steps.push({
      code: 'FIX_KEYSTORE_PASSWORD',
      target: 'readiness',
      message: 'Update the keystore password source with the correct password and retry.',
    });
  }

  if (resolution.status === 'invalid-keystore') {
    steps.push({
      code: 'REPLACE_INVALID_KEYSTORE',
      target: 'readiness',
      message: 'Replace or repair the keystore JSON; the current file is not a valid encrypted keystore.',
    });
  }

  if (resolution.status === 'missing-config') {
    steps.push({
      code: 'COMPLETE_SIGNER_CONFIGURATION',
      target: 'readiness',
      message: 'Complete the signer profile configuration before using this profile for execution.',
    });
  }

  if (resolution.status === 'error' && Array.isArray(resolution.notes) && resolution.notes.length) {
    steps.push({
      code: 'FIX_SIGNER_BACKEND_ERROR',
      target: 'readiness',
      message: `Resolve the signer/backend error and retry: ${resolution.notes[resolution.notes.length - 1]}`,
    });
  }

  return steps;
}

function buildCompatibilityRemediation(compatibility) {
  if (!compatibility || !Array.isArray(compatibility.violations)) return [];
  const steps = [];
  const constraints = compatibility.constraints || {};

  for (const violation of compatibility.violations) {
    if (!violation || !violation.code) continue;

    if (violation.code === 'PROFILE_READ_ONLY_MUTATION_DENIED') {
      steps.push({
        code: violation.code,
        target: 'compatibility',
        message: 'Retry with --mode dry-run, --mode paper, or --mode fork for simulation-only checks, or choose a mutable profile for execute mode.',
      });
      continue;
    }

    if (violation.code === 'PROFILE_POLICY_NOT_ALLOWED') {
      const recommendedPolicy = compatibility.recommendedPolicy || constraints.defaultPolicy || null;
      steps.push({
        code: violation.code,
        target: 'compatibility',
        message: recommendedPolicy
          ? `Retry with --policy-id ${recommendedPolicy}, or choose a profile that allows policy ${compatibility.policyId}.`
          : `Choose a profile that allows policy ${compatibility.policyId}.`,
        suggestedPolicyId: recommendedPolicy,
        allowedPolicies: uniqueStrings(constraints.allowedPolicies),
      });
      continue;
    }

    if (violation.code === 'PROFILE_TOOL_FAMILY_NOT_ALLOWED') {
      steps.push({
        code: violation.code,
        target: 'compatibility',
        message: `Choose a profile whose toolFamilyAllowlist includes ${compatibility.toolFamily}. Allowed families on this profile: ${formatValueList(constraints.toolFamilyAllowlist)}.`,
        allowedToolFamilies: uniqueStrings(constraints.toolFamilyAllowlist),
      });
      continue;
    }

    if (violation.code === 'PROFILE_CHAIN_NOT_ALLOWED') {
      steps.push({
        code: violation.code,
        target: 'compatibility',
        message: `Retry with an allowed --chain-id (${formatValueList(constraints.chainAllowlist)}), or choose a profile that allows chain ${compatibility.chainId}.`,
        allowedChainIds: uniqueStrings(constraints.chainAllowlist),
      });
      continue;
    }

    if (violation.code === 'PROFILE_CATEGORY_NOT_ALLOWED') {
      const allowedCategories = displayCategoryList(constraints.categoryAllowlist);
      steps.push({
        code: violation.code,
        target: 'compatibility',
        message: `Retry with an allowed --category (${formatValueList(allowedCategories)}), or choose a profile that allows category ${displayCategory(compatibility.category)}.`,
        allowedCategories,
      });
      continue;
    }

    steps.push({
      code: violation.code,
      target: 'compatibility',
      message: violation.message || 'Adjust the requested execution context or choose a compatible profile.',
    });
  }

  return steps;
}

function dedupeRemediation(steps) {
  const seen = new Set();
  const deduped = [];
  for (const step of Array.isArray(steps) ? steps : []) {
    if (!step || !step.code || !step.message) continue;
    const key = `${step.code}:${step.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(step);
  }
  return deduped;
}

function buildProfileExplanation(resolved, options = {}) {
  const resolution = resolved && resolved.resolution ? resolved.resolution : null;
  const compatibility = buildExplainCompatibility(resolved, options);
  const requestedContext = buildRequestedContext(options, compatibility);
  const recommendations = resolved && resolved.recommendations ? resolved.recommendations : null;
  const blockers = [];
  if (resolution) {
    blockers.push(...(Array.isArray(resolution.notes) ? resolution.notes : []));
  }
  if (compatibility && Array.isArray(compatibility.violations)) {
    blockers.push(...compatibility.violations.map((entry) => entry && entry.message).filter(Boolean));
  }
  const remediation = [];
  if (!requestedContext.exact) {
    remediation.push({
      code: 'PROVIDE_EXACT_CONTEXT',
      target: 'context',
      message: `Add ${requestedContext.missingFlags.join(', ')} to evaluate the exact command/mode/chain/category/policy path instead of a partial profile-only check.`,
      missingFlags: requestedContext.missingFlags,
    });
  }
  remediation.push(...buildReadinessRemediation(resolution, resolved && resolved.profile ? resolved.profile.id : 'selected-profile'));
  remediation.push(...buildCompatibilityRemediation(compatibility));

  return {
    usable: Boolean(resolution && resolution.ready && (!compatibility || compatibility.ok)),
    activeCheckPerformed: Boolean(resolution && resolution.activeCheck),
    requestedContext,
    readiness: resolution
      ? {
          status: resolution.status,
          ready: Boolean(resolution.ready),
          signerReady: Boolean(resolution.signerReady),
          networkContextReady: Boolean(resolution.networkContextReady),
          backendImplemented: Boolean(resolution.backendImplemented),
        }
      : null,
    compatibility: compatibility
      ? {
          ok: Boolean(compatibility.ok),
          requestedCommand: compatibility.requestedCommand || null,
          canonicalCommand: compatibility.canonicalCommand || compatibility.command || null,
          command: compatibility.command,
          toolFamily: compatibility.toolFamily,
          chainId: compatibility.chainId,
          category: compatibility.category,
          categoryName: displayCategory(compatibility.category),
          policyId: compatibility.policyId,
          approvalMode: compatibility.approvalMode,
          mutatingRequested: Boolean(compatibility.mutatingRequested),
          violations: Array.isArray(compatibility.violations) ? compatibility.violations : [],
        }
      : null,
    recommendations,
    blockers,
    remediation: dedupeRemediation(remediation),
  };
}

function buildRecommendMode(item, requestedMode) {
  if (!item) return null;
  if (item.readOnly) return 'read-only';
  if (item.usable && requestedMode && MUTATING_PROFILE_MODES.has(requestedMode)) {
    return requestedMode;
  }
  if (item.runtimeReady) return 'execute';
  return 'dry-run';
}

function profileSafetyRank(item) {
  if (item && item.readOnly) return 0;
  if (item && !item.runtimeReady) return 1;
  return 2;
}

function buildProfileRecommendOnboardingGuidance(canonicalTool) {
  const normalized = normalizeOptionalString(canonicalTool);
  if (!normalized) return null;

  if (normalized === 'markets.create.run' || normalized === 'launch') {
    return {
      journey: 'deploy-plus-mirror-operator',
      primaryProfileId: 'market_deployer_a',
      companionProfileId: 'prod_trader_a',
      notes: [
        'Use market_deployer_a for Pandora market deployment and deploy dry-run readiness.',
        'Use prod_trader_a for live mirror automation and Polymarket hedge operations after the market exists.',
        'These are separate mutable personas by design: deployment signer readiness and mirror hedge readiness are not the same contract.',
      ],
      nextCommands: [
        'pandora --output json profile recommend --command mirror.go --mode execute --chain-id 1 --category Sports --policy-id execute-with-validation',
      ],
    };
  }

  if (normalized === 'mirror.go' || normalized === 'mirror.sync' || normalized === 'mirror.sync.once' || normalized === 'mirror.sync.run' || normalized === 'mirror.sync.start') {
    return {
      journey: 'deploy-plus-mirror-operator',
      primaryProfileId: 'prod_trader_a',
      companionProfileId: 'market_deployer_a',
      sourceRequirement: {
        minimumSources: 2,
        independentHostsRequired: true,
        appliesInPaperMode: true,
      },
      notes: [
        'Use prod_trader_a for live mirror automation and Polymarket hedge operations.',
        'Use market_deployer_a for the Pandora market deployment leg when mirror go will create a fresh market first.',
        'If mirror go will deploy a fresh Pandora market, provide two independent public --sources even in paper mode. Polymarket URLs never satisfy this requirement.',
      ],
      nextCommands: [
        'pandora --output json profile recommend --command markets.create.run --mode execute --chain-id 1 --category Crypto --policy-id execute-with-validation',
        'pandora --output json mirror go --help',
      ],
    };
  }

  return null;
}

function buildProfileRecommendPayload(recommendation, listing, options = {}) {
  const requestedCommand = normalizeOptionalString(options.command);
  const canonicalTool = recommendation && recommendation.canonicalCommand
    ? recommendation.canonicalCommand
    : requestedCommand;
  const aliasOf = requestedCommand && canonicalTool && requestedCommand !== canonicalTool
    ? canonicalTool
    : null;
  const requestedMode = normalizeOptionalString(options.mode);
  const items = (Array.isArray(recommendation && recommendation.profiles) ? recommendation.profiles : []).map((item) => ({
    id: item.id,
    displayName: item.displayName,
    description: null,
    builtin: item.builtin,
    source: item.source,
    readOnly: Boolean(item.readOnly),
    signerBackend: item.signerBackend,
    runtimeReady: Boolean(item.runtimeReady),
    usable: Boolean(item.usable),
    compatibilityOk: item.compatibilityOk,
    recommendedMode: buildRecommendMode(item, requestedMode),
    exactMatch: Boolean(item.usable && requestedMode && buildRecommendMode(item, requestedMode) === requestedMode),
    canonicalTool,
    aliasOf,
    resolutionStatus: item.resolutionStatus,
    safetyRank: profileSafetyRank({ readOnly: item.readOnly, ready: item.runtimeReady }),
    score: item.score,
    reasons: Array.isArray(item.reasons) ? item.reasons : [],
    violations: Array.isArray(item.violations) ? item.violations : [],
  }));
  const recommendedReadOnly = items.find((item) => item.readOnly) || null;
  const recommendedMutable = items.find((item) => !item.readOnly) || null;
  const safestMatch = items
    .slice()
    .sort((left, right) => {
      if (left.safetyRank !== right.safetyRank) return left.safetyRank - right.safetyRank;
      if (left.usable !== right.usable) return left.usable ? -1 : 1;
      return String(left.id).localeCompare(String(right.id));
    })[0] || null;
  const bestMatchForRequestedContext = items.find((item) => item.usable && item.exactMatch)
    || items.find((item) => item.usable && !item.readOnly)
    || items.find((item) => item.usable)
    || null;
  const diagnostics = aliasOf
    ? [{
        code: 'USE_CANONICAL_TOOL',
        severity: 'info',
        command: canonicalTool,
        aliasOf,
        message: `Recommendations are ranked for canonical tool ${canonicalTool}, not compatibility alias ${requestedCommand}.`,
      }]
    : [];

  return {
    profileStoreFile: listing && Object.prototype.hasOwnProperty.call(listing, 'filePath') ? listing.filePath : null,
    profileStoreExists: Boolean(listing && listing.exists),
    builtInCount: Number(listing && listing.builtInCount) || 0,
    fileCount: Number(listing && listing.fileCount) || 0,
    requestedContext: {
      command: requestedCommand,
      canonicalTool,
      aliasOf,
      mode: requestedMode,
      chainId: normalizeOptionalString(options.chainId),
      category: normalizeOptionalString(options.category),
      policyId: normalizeOptionalString(options.policyId),
    },
    exact: EXACT_CONTEXT_FLAGS.every(({ key }) => hasContextValue(options[key])),
    count: items.length,
    compatibleCount: items.filter((item) => item.usable).length,
    recommendedProfileId: recommendation && recommendation.decision ? recommendation.decision.bestProfileId : null,
    recommendedReadOnlyProfileId: recommendedReadOnly ? recommendedReadOnly.id : null,
    recommendedMutableProfileId: recommendedMutable ? recommendedMutable.id : null,
    diagnostics,
    safestMatch,
    bestMatchForRequestedContext,
    items,
    profiles: Array.isArray(recommendation && recommendation.profiles) ? recommendation.profiles : [],
    policies: Array.isArray(recommendation && recommendation.policies) ? recommendation.policies : [],
    nextTools: Array.isArray(recommendation && recommendation.nextTools) ? recommendation.nextTools : [],
    onboardingGuidance: buildProfileRecommendOnboardingGuidance(canonicalTool),
    decision: recommendation && recommendation.decision ? recommendation.decision : {
      bestProfileId: null,
      bestPolicyId: null,
      bestTool: null,
    },
  };
}

function createRunProfileCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseProfileFlags = requireDep(deps, 'parseProfileFlags');
  const createProfileStore = requireDep(deps, 'createProfileStore');
  const createProfileResolverService = requireDep(deps, 'createProfileResolverService');
  const createPolicyRegistryService = requireDep(deps, 'createPolicyRegistryService');
  const createPolicyEvaluatorService = requireDep(deps, 'createPolicyEvaluatorService');

  return async function runProfileCommand(args, context) {
    const action = args[0];
    const actionArgs = args.slice(1);

    if (!action || action === '--help' || action === '-h') {
      const usage = 'pandora [--output table|json] profile list|get|explain|recommend|validate [--command <cmd>] [--mode <mode>] [--chain-id <id>] [--category <cat>] [--profile-id <id>]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'profile.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'list' && includesHelpFlag(actionArgs)) {
      const usage =
        'pandora [--output table|json] profile list [--store-file <path>] [--no-builtins|--builtin-only]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'profile.list.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'get' && includesHelpFlag(actionArgs)) {
      const usage = 'pandora [--output table|json] profile get --id <profile-id> [--store-file <path>] [--command <tool>] [--mode dry-run|paper|fork|execute|execute-live] [--chain-id <id>] [--category <id|name>] [--policy-id <id>]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'profile.get.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'explain' && includesHelpFlag(actionArgs)) {
      const usage = 'pandora [--output table|json] profile explain --id <profile-id> [--store-file <path>] [--command <tool>] [--mode dry-run|paper|fork|execute|execute-live] [--chain-id <id>] [--category <id|name>] [--policy-id <id>]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'profile.explain.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }


    if (action === 'recommend' && includesHelpFlag(actionArgs)) {
      const usage = 'pandora [--output table|json] profile recommend [--store-file <path>] [--no-builtins|--builtin-only] [--command <tool>] [--mode dry-run|paper|fork|execute|execute-live] [--chain-id <id>] [--category <id|name>] [--policy-id <id>]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'profile.recommend.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'validate' && includesHelpFlag(actionArgs)) {
      const usage = 'pandora [--output table|json] profile validate --file <path>';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'profile.validate.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    const options = parseProfileFlags(args, { CliError });
    const store = createProfileStore();
    const policyRegistry = createPolicyRegistryService();
    const policyEvaluator = createPolicyEvaluatorService({ policyRegistry });
    const resolver = createProfileResolverService({ store, profileStore: store, policyRegistry, policyEvaluator });

    if (options.action === 'list') {
      const listing = store.loadProfileSet({
        filePath: options.storeFile,
        includeBuiltIns: options.includeBuiltIns,
        builtinOnly: options.builtinOnly,
      });
      const items = await Promise.all(listing.items.map(async (entry) => {
        const resolved = await resolver.probeProfile({
          profileId: entry.id,
          storeFile: options.storeFile,
          includeSecretMaterial: false,
        });
        return {
          ...entry.summary,
          runtimeReady: Boolean(resolved.resolution && resolved.resolution.ready),
          resolutionStatus: resolved.resolution ? resolved.resolution.status : null,
          backendImplemented: Boolean(resolved.resolution && resolved.resolution.backendImplemented),
        };
      }));
      emitSuccess(
        context.outputMode,
        'profile.list',
        {
          profileStoreFile: listing.filePath,
          profileStoreExists: listing.exists,
          builtInCount: listing.builtInCount,
          fileCount: listing.fileCount,
          items,
        },
        renderProfileListTable,
      );
      return;
    }

    if (options.action === 'get') {
      const entry = store.getProfile(options.id, {
        filePath: options.storeFile,
        includeBuiltIns: true,
      });
      if (!entry) {
        throw new CliError('PROFILE_NOT_FOUND', `Profile not found: ${options.id}`, {
          id: options.id,
        });
      }

      const resolved = await resolver.probeProfile({
        profileId: options.id,
        storeFile: options.storeFile,
        command: options.command,
        mode: options.mode,
        chainId: options.chainId,
        category: options.category,
        policyId: options.policyId,
      });

      emitSuccess(
        context.outputMode,
        'profile.get',
        {
          id: entry.id,
          source: entry.source,
          builtin: entry.builtin,
          filePath: entry.filePath,
          profile: entry.profile,
          summary: entry.summary,
          resolution: resolved.resolution,
        },
        renderProfileGetTable,
      );
      return;
    }

    if (options.action === 'explain') {
      const entry = store.getProfile(options.id, {
        filePath: options.storeFile,
        includeBuiltIns: true,
      });
      if (!entry) {
        throw new CliError('PROFILE_NOT_FOUND', `Profile not found: ${options.id}`, {
          id: options.id,
        });
      }

      const resolved = await resolver.probeProfile({
        profileId: options.id,
        storeFile: options.storeFile,
        command: options.command,
        mode: options.mode,
        chainId: options.chainId,
        category: options.category,
        policyId: options.policyId,
      });

      emitSuccess(
        context.outputMode,
        'profile.explain',
        {
          id: entry.id,
          source: entry.source,
          builtin: entry.builtin,
          filePath: entry.filePath,
          profile: entry.profile,
          summary: entry.summary,
          resolution: resolved.resolution
            ? {
                ...resolved.resolution,
                compatibility: buildExplainCompatibility(resolved, options),
              }
            : null,
          explanation: buildProfileExplanation(resolved, options),
        },
        renderProfileExplainTable,
      );
      return;
    }


    if (options.action === 'recommend') {
      const listing = store.loadProfileSet({
        filePath: options.storeFile || null,
        includeBuiltIns: options.includeBuiltIns !== false,
        builtinOnly: options.builtinOnly === true,
      });
      const recommendation = resolver.recommendProfiles({
        storeFile: options.storeFile,
        includeBuiltIns: options.includeBuiltIns,
        builtinOnly: options.builtinOnly,
        command: options.command,
        mode: options.mode,
        chainId: options.chainId,
        category: options.category,
        policyId: options.policyId,
        liveRequested: MUTATING_PROFILE_MODES.has(String(options.mode || '').trim().toLowerCase()),
        mutating: MUTATING_PROFILE_MODES.has(String(options.mode || '').trim().toLowerCase()),
      });
      const payload = buildProfileRecommendPayload(recommendation, listing, options);
      emitSuccess(
        context.outputMode,
        'profile.recommend',
        payload,
        renderProfileRecommendTable,
      );
      return;
    }

    if (options.action === 'validate') {
      const validation = store.validateProfileFile(options.file);
      const resolutions = await Promise.all(validation.profiles.map(async (profile) =>
        (await resolver.probeProfile({
          profileId: profile.id,
          storeFile: validation.filePath,
          includeSecretMaterial: false,
        })).resolution));
      const readyCount = resolutions.filter((resolution) => resolution && resolution.ready === true).length;
      emitSuccess(
        context.outputMode,
        'profile.validate',
        {
          filePath: validation.filePath,
          valid: true,
          runtimeReady: readyCount === validation.profiles.length,
          runtimeReadyCount: readyCount,
          profileCount: validation.profileCount,
          items: validation.items.map((item, index) => ({
            ...item,
            runtimeReady: Boolean(resolutions[index] && resolutions[index].ready),
            resolutionStatus: resolutions[index] ? resolutions[index].status : null,
          })),
          profiles: validation.profiles,
          resolutions,
        },
        renderProfileValidateTable,
      );
      return;
    }

    throw new CliError('INVALID_ARGS', `Unsupported profile subcommand: ${options.action}`);
  };
}

module.exports = {
  createRunProfileCommand,
};
