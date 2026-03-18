'use strict';

const { buildCapabilitiesPayload, buildCapabilitiesPayloadAsync } = require('./capabilities_command_service.cjs');
const { buildSchemaPayload } = require('./schema_command_service.cjs');
const { createPolicyRegistryService } = require('./policy_registry_service.cjs');
const { createProfileStore } = require('./profile_store.cjs');
const { createProfileResolverService } = require('./profile_resolver_service.cjs');
const { createRecipeRegistryService } = require('./recipe_registry_service.cjs');
const { buildSkillDocIndex } = require('./skill_doc_registry.cjs');

const BOOTSTRAP_DOC_IDS = Object.freeze([
  'agent-quickstart',
  'setup-and-onboarding',
  'capabilities',
  'agent-interfaces',
  'policy-profiles',
  'recipes',
]);
const COMPATIBILITY_FLAG = '--include-compatibility';
const COMPATIBILITY_QUERY_PARAM = 'include_aliases=1';
const COMPATIBILITY_MODE_HINT = 'Compatibility aliases are hidden by default. Pass --include-compatibility or include_aliases=1 only for legacy/debug workflows.';

function compareStableStrings(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sortStrings(values) {
  return Array.from(new Set(Array.isArray(values) ? values : []))
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .sort(compareStableStrings);
}

function dedupeStringsPreserveOrder(values) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function defaultHelpPayload(usage, notes = []) {
  return {
    usage,
    notes: Array.isArray(notes) ? notes.filter(Boolean) : [],
  };
}

function includesHelpFlag(args) {
  return Array.isArray(args) && args.some((arg) => arg === '--help' || arg === '-h');
}

function toSortedItems(items, mapper) {
  return (Array.isArray(items) ? items : [])
    .map((item) => mapper(item))
    .filter(Boolean)
    .sort((left, right) => compareStableStrings(left.id, right.id));
}

function buildDocumentationSummary(documentation) {
  const docIndex = documentation && typeof documentation === 'object' ? documentation : {};
  const skills = Array.isArray(docIndex.skills) ? docIndex.skills : [];
  const docsById = Object.fromEntries(skills.map((doc) => [doc.id, doc]));
  return {
    routerPath: normalizeString(docIndex.router && docIndex.router.path),
    routerTitle: normalizeString(docIndex.router && docIndex.router.title),
    contentHash: normalizeString(docIndex.contentHash),
    items: BOOTSTRAP_DOC_IDS.map((docId) => docsById[docId])
      .filter(Boolean)
      .map((doc) => ({
        id: doc.id,
        path: doc.path,
        title: doc.title,
        summary: doc.summary,
        kind: doc.kind,
        canonicalTools: sortStrings(doc.canonicalTools),
      })),
  };
}

function buildPolicySummary(policyListing) {
  const listing = policyListing && typeof policyListing === 'object' ? policyListing : {};
  const items = toSortedItems(listing.items, (item) => {
    if (!item || !item.id) return null;
    return {
      id: item.id,
      displayName: normalizeString(item.displayName),
      description: normalizeString(item.description),
      source: normalizeString(item.source),
      extends: sortStrings(item.extends),
    };
  });
  const recommendedReadOnlyPolicy = items.find((item) => item.id === 'research-only') || items[0] || null;
  const recommendedMutablePolicy = items.find((item) => item.id === 'execute-with-validation')
    || items.find((item) => item.id !== (recommendedReadOnlyPolicy && recommendedReadOnlyPolicy.id))
    || null;

  return {
    count: Number.isFinite(listing.count) ? listing.count : items.length,
    builtinCount: Number.isFinite(listing.builtinCount) ? listing.builtinCount : items.filter((item) => item.source === 'builtin').length,
    userCount: Number.isFinite(listing.storedCount) ? listing.storedCount : 0,
    recommendedReadOnlyPolicyId: recommendedReadOnlyPolicy ? recommendedReadOnlyPolicy.id : null,
    recommendedMutablePolicyId: recommendedMutablePolicy ? recommendedMutablePolicy.id : null,
    items,
  };
}

function buildProfileSummary(profileSet, profileResolver) {
  const set = profileSet && typeof profileSet === 'object' ? profileSet : {};
  const resolver = profileResolver && typeof profileResolver.resolveProfile === 'function'
    ? profileResolver
    : null;

  const items = toSortedItems(set.items, (entry) => {
    if (!entry || !entry.id || !entry.summary) return null;
    const resolved = resolver
      ? resolver.resolveProfile({
          profileId: entry.id,
          includeSecretMaterial: false,
        })
      : null;
    const resolution = resolved && resolved.resolution ? resolved.resolution : null;
    return {
      id: entry.id,
      displayName: normalizeString(entry.summary.displayName),
      signerBackend: normalizeString(entry.summary.signerBackend),
      readOnly: Boolean(entry.summary.readOnly),
      builtin: Boolean(entry.builtin),
      source: normalizeString(entry.source),
      defaultPolicy: normalizeString(entry.summary.defaultPolicy),
      allowedPolicies: sortStrings(entry.summary.allowedPolicies),
      runtimeReady: Boolean(resolution && resolution.ready),
      resolutionStatus: normalizeString(resolution && resolution.status),
      backendImplemented: resolution ? resolution.backendImplemented === true : null,
    };
  });

  const builtinItems = items.filter((item) => item.builtin);
  const mutableBuiltins = builtinItems.filter((item) => !item.readOnly);
  const readyMutableBuiltins = mutableBuiltins.filter((item) => item.runtimeReady);
  const recommendedReadOnlyProfile = builtinItems.find((item) => item.readOnly && item.runtimeReady)
    || builtinItems.find((item) => item.readOnly)
    || null;
  const recommendedMutableProfile = readyMutableBuiltins[0] || null;

  return {
    count: items.length,
    builtInCount: Number.isFinite(set.builtInCount) ? set.builtInCount : builtinItems.length,
    fileCount: Number.isFinite(set.fileCount) ? set.fileCount : items.filter((item) => item.source === 'file').length,
    recommendedReadOnlyProfileId: recommendedReadOnlyProfile ? recommendedReadOnlyProfile.id : null,
    recommendedMutableProfileId: recommendedMutableProfile ? recommendedMutableProfile.id : null,
    readyBuiltinCount: builtinItems.filter((item) => item.runtimeReady).length,
    readyMutableBuiltinCount: readyMutableBuiltins.length,
    items,
  };
}

async function buildProfileSummaryAsync(profileSet, profileResolver) {
  const artifactNeutral = Boolean(arguments[2] && arguments[2].artifactNeutralProfileReadiness === true);
  if (artifactNeutral) {
    return buildProfileSummary(profileSet, profileResolver);
  }
  const set = profileSet && typeof profileSet === 'object' ? profileSet : {};
  const resolver = profileResolver && typeof profileResolver.probeProfile === 'function'
    ? profileResolver
    : null;

  const rawItems = Array.isArray(set.items) ? set.items : [];
  const items = (await Promise.all(rawItems.map(async (entry) => {
    if (!entry || !entry.id || !entry.summary) return null;
    const resolved = resolver
      ? await resolver.probeProfile({
          profileId: entry.id,
          includeSecretMaterial: false,
        })
      : null;
    const resolution = resolved && resolved.resolution ? resolved.resolution : null;
    return {
      id: entry.id,
      displayName: normalizeString(entry.summary.displayName),
      signerBackend: normalizeString(entry.summary.signerBackend),
      readOnly: Boolean(entry.summary.readOnly),
      builtin: Boolean(entry.builtin),
      source: normalizeString(entry.source),
      defaultPolicy: normalizeString(entry.summary.defaultPolicy),
      allowedPolicies: sortStrings(entry.summary.allowedPolicies),
      runtimeReady: Boolean(resolution && resolution.ready),
      resolutionStatus: normalizeString(resolution && resolution.status),
      backendImplemented: resolution ? resolution.backendImplemented === true : null,
    };
  })))
    .filter(Boolean)
    .sort((left, right) => compareStableStrings(left.id, right.id));

  const builtinItems = items.filter((item) => item.builtin);
  const mutableBuiltins = builtinItems.filter((item) => !item.readOnly);
  const readyMutableBuiltins = mutableBuiltins.filter((item) => item.runtimeReady);
  const recommendedReadOnlyProfile = builtinItems.find((item) => item.readOnly && item.runtimeReady)
    || builtinItems.find((item) => item.readOnly)
    || null;
  const recommendedMutableProfile = readyMutableBuiltins[0] || null;

  return {
    count: items.length,
    builtInCount: Number.isFinite(set.builtInCount) ? set.builtInCount : builtinItems.length,
    fileCount: Number.isFinite(set.fileCount) ? set.fileCount : items.filter((item) => item.source === 'file').length,
    recommendedReadOnlyProfileId: recommendedReadOnlyProfile ? recommendedReadOnlyProfile.id : null,
    recommendedMutableProfileId: recommendedMutableProfile ? recommendedMutableProfile.id : null,
    readyBuiltinCount: builtinItems.filter((item) => item.runtimeReady).length,
    readyMutableBuiltinCount: readyMutableBuiltins.length,
    items,
  };
}

function buildRecipeSummary(recipeListing) {
  const listing = recipeListing && typeof recipeListing === 'object' ? recipeListing : {};
  const items = toSortedItems(listing.items, (item) => {
    if (!item || !item.id) return null;
    return {
      id: item.id,
      displayName: normalizeString(item.displayName),
      description: normalizeString(item.description),
      summary: normalizeString(item.summary),
      tool: normalizeString(item.tool),
      defaultPolicy: normalizeString(item.defaultPolicy),
      defaultProfile: normalizeString(item.defaultProfile),
      approvalStatus: normalizeString(item.approvalStatus),
      riskLevel: normalizeString(item.riskLevel),
      mutating: item.mutating === true,
      safeByDefault: item.safeByDefault === true,
      operationExpected: item.operationExpected === true,
      supportsRemote: item.supportsRemote === true,
      source: normalizeString(item.source),
      origin: normalizeString(item.origin),
    };
  });

  return {
    count: Number.isFinite(listing.count) ? listing.count : items.length,
    builtinCount: Number.isFinite(listing.builtinCount) ? listing.builtinCount : items.filter((item) => item.origin === 'builtin').length,
    userCount: Number.isFinite(listing.userCount) ? listing.userCount : items.filter((item) => item.source === 'user').length,
    safeByDefaultCount: items.filter((item) => item.safeByDefault).length,
    operationExpectedCount: items.filter((item) => item.operationExpected).length,
    sourceCounts: listing.sourceCounts || null,
    approvalStatusCounts: listing.approvalStatusCounts || null,
    riskLevelCounts: listing.riskLevelCounts || null,
    appliedFilters: listing.appliedFilters || null,
    items,
  };
}

function buildSdkSummary(capabilities) {
  const transports = capabilities && capabilities.transports && typeof capabilities.transports === 'object'
    ? capabilities.transports
    : {};
  const sdk = transports.sdk && typeof transports.sdk === 'object' ? transports.sdk : {};
  const packages = sdk.packages && typeof sdk.packages === 'object' ? sdk.packages : {};

  function normalizePackage(entry) {
    if (!entry || typeof entry !== 'object') return null;
    return {
      name: normalizeString(entry.name),
      version: normalizeString(entry.version),
      repoPath: normalizeString(entry.repoPath),
      moduleName: normalizeString(entry.moduleName),
      distributionStatus: normalizeString(entry.distributionStatus),
      publicationStatus: normalizeString(entry.publicationStatus),
      publicRegistryPublished: entry.publicRegistryPublished === true,
      recommendedConsumption: normalizeString(entry.recommendedConsumption),
      vendoredInRootPackage: entry.vendoredInRootPackage === true,
    };
  }

  return {
    status: normalizeString(sdk.status),
    notes: Array.isArray(sdk.notes) ? sdk.notes.filter(Boolean) : [],
    generatedBundle: sdk.generatedBundle && typeof sdk.generatedBundle === 'object'
      ? {
          repoPath: normalizeString(sdk.generatedBundle.repoPath),
          bundlePath: normalizeString(sdk.generatedBundle.bundlePath),
          artifactVersion: normalizeString(sdk.generatedBundle.artifactVersion),
        }
      : null,
    packages: {
      typescript: normalizePackage(packages.typescript),
      python: normalizePackage(packages.python),
    },
  };
}

function pickBootstrapToolCommands(capabilities, documentationSummary, includeAllTools) {
  const commandDigests = capabilities && capabilities.commandDigests && typeof capabilities.commandDigests === 'object'
    ? capabilities.commandDigests
    : {};

  if (includeAllTools) {
    return Object.keys(commandDigests).sort(compareStableStrings);
  }

  const canonicalTools = capabilities && capabilities.canonicalTools && typeof capabilities.canonicalTools === 'object'
    ? capabilities.canonicalTools
    : {};
  const selected = [];
  const seen = new Set();

  for (const doc of documentationSummary.items) {
    for (const toolName of sortStrings(doc.canonicalTools)) {
      const preferredCommand = normalizeString(
        canonicalTools[toolName] && canonicalTools[toolName].preferredCommand,
      ) || toolName;
      const digest = commandDigests[preferredCommand];
      if (!digest || digest.aliasOf) continue;
      if (seen.has(preferredCommand)) continue;
      seen.add(preferredCommand);
      selected.push(preferredCommand);
    }
  }

  return selected;
}

function buildToolSummaries(toolCommands, capabilities, schema) {
  const commandDigests = capabilities && capabilities.commandDigests && typeof capabilities.commandDigests === 'object'
    ? capabilities.commandDigests
    : {};
  const commandDescriptors = schema && schema.commandDescriptors && typeof schema.commandDescriptors === 'object'
    ? schema.commandDescriptors
    : {};

  return toolCommands
    .map((command) => {
      const digest = commandDigests[command];
      const descriptor = commandDescriptors[command];
      if (!digest && !descriptor) return null;
      return {
        command,
        canonicalTool: normalizeString((digest && digest.canonicalTool) || (descriptor && descriptor.canonicalTool) || command),
        aliasOf: normalizeString((digest && digest.aliasOf) || (descriptor && descriptor.aliasOf)),
        summary: normalizeString((digest && digest.summary) || (descriptor && descriptor.summary)),
        usage: normalizeString((descriptor && descriptor.canonicalUsage) || (descriptor && descriptor.usage)),
        outputModes: sortStrings((digest && digest.outputModes) || (descriptor && descriptor.outputModes)),
        policyScopes: sortStrings((digest && digest.policyScopes) || (descriptor && descriptor.policyScopes)),
        requiresSecrets: Boolean((digest && digest.requiresSecrets) || (descriptor && descriptor.requiresSecrets)),
        recommendedPreflightTool: normalizeString(
          (digest && digest.recommendedPreflightTool) || (descriptor && descriptor.recommendedPreflightTool),
        ),
        safeEquivalent: normalizeString((digest && digest.safeEquivalent) || (descriptor && descriptor.safeEquivalent)),
        supportsRemote: Boolean((digest && digest.supportsRemote) || (descriptor && descriptor.supportsRemote)),
      };
    })
    .filter(Boolean);
}

function buildWarnings(capabilities, profileSummary, sdkSummary) {
  const warnings = [];
  const signerProfiles = capabilities
    && capabilities.policyProfiles
    && capabilities.policyProfiles.signerProfiles
    && typeof capabilities.policyProfiles.signerProfiles === 'object'
    ? capabilities.policyProfiles.signerProfiles
    : {};
  const mutableBuiltins = profileSummary.items.filter((item) => item.builtin && !item.readOnly);
  const preferredMutableBuiltin = mutableBuiltins.find(
    (item) => item.backendImplemented === true && !item.runtimeReady,
  ) || mutableBuiltins[0] || null;

  if (!mutableBuiltins.some((item) => item.runtimeReady)) {
    warnings.push({
      code: 'NO_RUNTIME_READY_MUTABLE_PROFILE',
      severity: 'warning',
      message: 'No built-in mutable signer profile is runtime-ready in the current process. Start read-only, then inspect signer/profile readiness before execution.',
      profileIds: mutableBuiltins.map((item) => item.id),
      nextStepCommand: preferredMutableBuiltin
        ? `pandora --output json profile get --id ${preferredMutableBuiltin.id}`
        : 'pandora --output json profile list',
    });
  }

  if (Number.isFinite(signerProfiles.degradedBuiltinCount) && signerProfiles.degradedBuiltinCount > 0) {
    warnings.push({
      code: 'SIGNER_PROFILES_DEGRADED',
      severity: 'warning',
      message: `${signerProfiles.degradedBuiltinCount} built-in signer profile(s) have implemented backends but are not runtime-ready in the current process.`,
      profileIds: sortStrings(signerProfiles.degradedBuiltinIds),
      nextStepCommand: 'pandora --output json profile list',
    });
  }

  if (Number.isFinite(signerProfiles.placeholderBuiltinCount) && signerProfiles.placeholderBuiltinCount > 0) {
    warnings.push({
      code: 'SIGNER_PROFILES_PLACEHOLDER',
      severity: 'warning',
      message: `${signerProfiles.placeholderBuiltinCount} built-in signer profile(s) are planning placeholders only and should not be treated as executable backends yet.`,
      profileIds: sortStrings(signerProfiles.placeholderBuiltinIds),
      nextStepCommand: 'pandora --output json capabilities',
    });
  }

  const sdkPackages = sdkSummary && sdkSummary.packages && typeof sdkSummary.packages === 'object'
    ? sdkSummary.packages
    : {};
  const unpublishedPackages = Object.values(sdkPackages)
    .filter((entry) => entry && entry.publicRegistryPublished === false)
    .map((entry) => entry.name)
    .filter(Boolean);
  if (unpublishedPackages.length > 0) {
    warnings.push({
      code: 'SDK_PUBLIC_REGISTRY_PENDING',
      severity: 'info',
      message: `Standalone SDK package identities exist but are not publicly published yet: ${sortStrings(unpublishedPackages).join(', ')}. Use signed GitHub release artifacts until public registry publication is active.`,
      nextStepCommand: 'pandora --output json capabilities',
    });
  }

  return warnings;
}

function buildNextSteps(options) {
  const documentation = options.documentation;
  const policySummary = options.policies;
  const profileSummary = options.profiles;
  const recipeSummary = options.recipes;
  const sdkSummary = options.sdk;
  const warnings = options.warnings;
  const nextSteps = [];
  const onboardingDoc = documentation.items.find((doc) => doc.id === 'setup-and-onboarding') || null;
  const quickstartDoc = documentation.items.find((doc) => doc.id === 'agent-quickstart')
    || documentation.items[0]
    || null;

  nextSteps.push({
    id: 'inspect-capabilities',
    type: 'command',
    title: 'Inspect runtime capabilities',
    command: 'pandora --output json capabilities',
    reason: 'Load transport status, canonical tools, and trust/profile summaries from the shared contract registry.',
  });

  nextSteps.push({
    id: 'inspect-schema',
    type: 'command',
    title: 'Inspect the machine schema',
    command: 'pandora --output json schema',
    reason: 'Confirm descriptor fields, envelope contracts, and canonical command metadata before calling tools.',
  });

  if (profileSummary.readyMutableBuiltinCount === 0) {
    nextSteps.push({
      id: 'guided-first-run-setup',
      type: 'command',
      title: 'Run guided onboarding',
      command: 'pandora setup --interactive',
      reason: 'Use the guided setup path when you need to generate or import keys, initialize Polymarket, and optionally collect hosting and provider inputs.',
    });
  }

  if (onboardingDoc) {
    nextSteps.push({
      id: 'read-setup-and-onboarding',
      type: 'doc',
      title: onboardingDoc.title,
      path: onboardingDoc.path,
      reason: 'Use this first-run guide for the interactive and manual onboarding paths.',
    });
  }

  if (quickstartDoc) {
    nextSteps.push({
      id: 'read-agent-quickstart',
      type: 'doc',
      title: quickstartDoc.title,
      path: quickstartDoc.path,
      reason: 'Use the smallest doc that explains local CLI, MCP, remote HTTP, SDK, policy, and profile bootstrap.',
    });
  }

  if (policySummary.count > 0) {
    nextSteps.push({
      id: 'list-policies',
      type: 'command',
      title: 'List policy packs',
      command: 'pandora --output json policy list',
      reason: policySummary.recommendedReadOnlyPolicyId
        ? `Start with ${policySummary.recommendedReadOnlyPolicyId} unless you have an execution-specific reason to change policy.`
        : 'Inspect built-in and local policy packs before selecting execution scope.',
    });
  }

  if (profileSummary.count > 0) {
    nextSteps.push({
      id: 'list-profiles',
      type: 'command',
      title: 'List signer profiles',
      command: 'pandora --output json profile list',
      reason: 'Check read-only vs mutable profiles and current runtime readiness before any mutating workflow.',
    });
  }

  if (profileSummary.recommendedReadOnlyProfileId) {
    nextSteps.push({
      id: 'inspect-read-only-profile',
      type: 'command',
      title: 'Inspect the default read-only profile',
      command: `pandora --output json profile get --id ${profileSummary.recommendedReadOnlyProfileId}`,
      reason: 'Cold agents should begin with the recommended read-only profile and only escalate after validation.',
    });
  }

  if (recipeSummary.count > 0) {
    nextSteps.push({
      id: 'list-recipes',
      type: 'command',
      title: 'List reusable recipes',
      command: 'pandora --output json recipe list',
      reason: 'Recipes provide higher-level workflows that still compile to ordinary Pandora commands.',
    });
  }

  const sdkPackages = sdkSummary && sdkSummary.packages && typeof sdkSummary.packages === 'object'
    ? sdkSummary.packages
    : {};
  const unpublishedPackages = Object.values(sdkPackages).filter(
    (entry) => entry && entry.publicRegistryPublished === false,
  );
  if (unpublishedPackages.length > 0) {
    nextSteps.push({
      id: 'review-sdk-distribution-status',
      type: 'doc',
      title: 'Review SDK distribution and trust guidance',
      path: 'docs/trust/support-matrix.md',
      reason: 'The standalone SDK identities are artifact-verified but not publicly registry-published yet. Download signed GitHub release artifacts unless you are intentionally consuming the vendored repo copy.',
    });
  }

  const mutableProfileWarning = warnings.find((warning) => warning.code === 'NO_RUNTIME_READY_MUTABLE_PROFILE');
  if (mutableProfileWarning && mutableProfileWarning.nextStepCommand) {
    nextSteps.push({
      id: 'inspect-mutable-profile-readiness',
      type: 'command',
      title: 'Inspect mutable profile readiness',
      command: mutableProfileWarning.nextStepCommand,
      reason: 'Resolve signer/backend readiness explicitly before attempting execution.',
    });
  }

  return nextSteps;
}

function buildCanonicalBootstrapTools(policySummary, profileSummary, recipeSummary) {
  const commands = ['bootstrap', 'capabilities', 'schema'];
  if (policySummary && policySummary.count > 0) {
    commands.push('policy.list');
  }
  if (profileSummary) {
    if (profileSummary.recommendedReadOnlyProfileId) {
      commands.push('profile.get');
    } else if (profileSummary.count > 0) {
      commands.push('profile.list');
    }
  }
  if (recipeSummary && recipeSummary.count > 0) {
    commands.push('recipe.list');
  }
  return dedupeStringsPreserveOrder(commands);
}

function buildBootstrapPrincipal(options = {}) {
  const grantedScopes = sortStrings(options.grantedScopes);
  const remoteTransportActive = options.remoteTransportActive === true;
  return {
    id: normalizeString(options.principalId),
    grantedScopes,
    authRequired: remoteTransportActive,
    transport: remoteTransportActive ? 'mcp-http' : 'cli-json',
    remoteTransportActive,
    remoteTransportUrl: normalizeString(options.remoteTransportUrl),
  };
}

function buildBootstrapPreferences(options = {}, capabilities = null) {
  const includeCompatibility = options.includeCompatibility === true || options.includeAllTools === true;
  const discoveryPreferences = capabilities && typeof capabilities.discoveryPreferences === 'object'
    ? capabilities.discoveryPreferences
    : null;
  return {
    canonicalOnlyDefault: discoveryPreferences
      ? discoveryPreferences.canonicalOnlyDefault === true
      : !includeCompatibility,
    includeCompatibility,
    aliasesHiddenByDefault: discoveryPreferences
      ? discoveryPreferences.aliasesHiddenByDefault === true
      : true,
    compatibilityFlag: normalizeString(discoveryPreferences && discoveryPreferences.compatibilityFlag) || COMPATIBILITY_FLAG,
    compatibilityQueryParam: normalizeString(discoveryPreferences && discoveryPreferences.compatibilityQueryParam) || COMPATIBILITY_QUERY_PARAM,
    recommendedFirstCall: 'bootstrap',
    compatibilityModeHint: normalizeString(discoveryPreferences && discoveryPreferences.compatibilityModeHint) || COMPATIBILITY_MODE_HINT,
    visibleCommandCount: Number.isFinite(discoveryPreferences && discoveryPreferences.visibleCommandCount)
      ? discoveryPreferences.visibleCommandCount
      : 0,
    totalAliasCount: Number.isFinite(discoveryPreferences && discoveryPreferences.totalAliasCount)
      ? discoveryPreferences.totalAliasCount
      : 0,
    hiddenAliasCount: Number.isFinite(discoveryPreferences && discoveryPreferences.hiddenAliasCount)
      ? discoveryPreferences.hiddenAliasCount
      : 0,
    canonicalToolsWithCompatibilityAliases: Number.isFinite(discoveryPreferences && discoveryPreferences.canonicalToolsWithCompatibilityAliases)
      ? discoveryPreferences.canonicalToolsWithCompatibilityAliases
      : 0,
  };
}

function buildBootstrapPayload(options = {}, overrides = {}) {
  const buildCapabilities = typeof overrides.buildCapabilitiesPayload === 'function'
    ? overrides.buildCapabilitiesPayload
    : buildCapabilitiesPayload;
  const buildSchema = typeof overrides.buildSchemaPayload === 'function'
    ? overrides.buildSchemaPayload
    : buildSchemaPayload;
  const createPolicies = typeof overrides.createPolicyRegistryService === 'function'
    ? overrides.createPolicyRegistryService
    : createPolicyRegistryService;
  const createProfiles = typeof overrides.createProfileStore === 'function'
    ? overrides.createProfileStore
    : createProfileStore;
  const createResolver = typeof overrides.createProfileResolverService === 'function'
    ? overrides.createProfileResolverService
    : createProfileResolverService;
  const createRecipes = typeof overrides.createRecipeRegistryService === 'function'
    ? overrides.createRecipeRegistryService
    : createRecipeRegistryService;
  const buildDocs = typeof overrides.buildSkillDocIndex === 'function'
    ? overrides.buildSkillDocIndex
    : buildSkillDocIndex;

  const readinessOptions = {
    ...options,
    artifactNeutralProfileReadiness:
      options.runtimeLocalReadiness === true
        ? false
        : (options.artifactNeutralProfileReadiness !== false),
  };
  const compatibilityOptions = {
    ...options,
    includeCompatibility: options.includeCompatibility === true || options.includeAllTools === true,
  };
  const capabilities = buildCapabilities({ ...readinessOptions, ...compatibilityOptions });
  const schema = buildSchema(compatibilityOptions);
  const documentationSummary = buildDocumentationSummary(buildDocs());
  const policySummary = buildPolicySummary(createPolicies().listPolicyPacks());
  const profileStore = createProfiles();
  const profileResolver = createResolver({
    store: profileStore,
    env: readinessOptions.artifactNeutralProfileReadiness === true ? {} : process.env,
  });
  const profileSummary = buildProfileSummary(
    profileStore.loadProfileSet({ includeBuiltIns: true }),
    profileResolver,
  );
  const recipeSummary = buildRecipeSummary(createRecipes().listRecipes());
  const sdkSummary = buildSdkSummary(capabilities);
  const toolCommands = pickBootstrapToolCommands(
    capabilities,
    documentationSummary,
    options.includeCompatibility === true || options.includeAllTools === true,
  );
  const canonicalBootstrapTools = buildCanonicalBootstrapTools(policySummary, profileSummary, recipeSummary);
  const toolSummaries = buildToolSummaries(toolCommands, capabilities, schema);
  const warnings = buildWarnings(capabilities, profileSummary, sdkSummary);
  const nextSteps = buildNextSteps({
    documentation: documentationSummary,
    policies: policySummary,
    profiles: profileSummary,
    recipes: recipeSummary,
    sdk: sdkSummary,
    warnings,
  });
  const defaults = {
    policyId: policySummary.recommendedReadOnlyPolicyId,
    profileId: profileSummary.recommendedReadOnlyProfileId,
    mode: profileSummary.readyMutableBuiltinCount > 0 ? 'validated-execution-available' : 'read-only-first',
  };

  return {
    schemaVersion: '1.0.0',
    generatedAt: normalizeString(options.generatedAtOverride)
      || normalizeString(capabilities && capabilities.generatedAt)
      || new Date().toISOString(),
    title: 'PandoraAgentBootstrap',
    description: 'Compact bootstrap payload for cold-start agents, composed from existing runtime capability, schema, policy, profile, recipe, and doc summaries.',
    source: 'bootstrap_command_service',
    commandDescriptorVersion: normalizeString(schema && schema.commandDescriptorVersion)
      || normalizeString(capabilities && capabilities.commandDescriptorVersion),
    readinessMode: readinessOptions.artifactNeutralProfileReadiness === true ? 'artifact-neutral' : 'runtime-local',
    principal: buildBootstrapPrincipal(readinessOptions),
    preferences: buildBootstrapPreferences(options, capabilities),
    defaults,
    summary: {
      recommendedStartingMode: defaults.mode,
      totalCommands: Number.isFinite(capabilities && capabilities.summary && capabilities.summary.totalCommands)
        ? capabilities.summary.totalCommands
        : Array.isArray(schema && schema.commandDescriptors)
          ? schema.commandDescriptors.length
          : Object.keys((schema && schema.commandDescriptors) || {}).length,
      canonicalToolCount: Object.keys((capabilities && capabilities.canonicalTools) || {}).length,
      starterToolCount: toolSummaries.length,
      policyCount: policySummary.count,
      profileCount: profileSummary.count,
      recipeCount: recipeSummary.count,
      remoteTransportStatus: normalizeString(
        capabilities
        && capabilities.transports
        && capabilities.transports.mcpStreamableHttp
        && capabilities.transports.mcpStreamableHttp.status,
      ),
    },
    capabilities: {
      totalCommands: Number.isFinite(capabilities && capabilities.summary && capabilities.summary.totalCommands)
        ? capabilities.summary.totalCommands
        : null,
      topLevelCommands: Number.isFinite(capabilities && capabilities.summary && capabilities.summary.topLevelCommands)
        ? capabilities.summary.topLevelCommands
        : null,
      routedTopLevelCommands: Number.isFinite(capabilities && capabilities.summary && capabilities.summary.routedTopLevelCommands)
        ? capabilities.summary.routedTopLevelCommands
        : null,
      mcpExposedCommands: Number.isFinite(capabilities && capabilities.summary && capabilities.summary.mcpExposedCommands)
        ? capabilities.summary.mcpExposedCommands
        : null,
      transports: {
        cliJson: normalizeString(capabilities && capabilities.transports && capabilities.transports.cliJson && capabilities.transports.cliJson.status),
        mcpStdio: normalizeString(capabilities && capabilities.transports && capabilities.transports.mcpStdio && capabilities.transports.mcpStdio.status),
        mcpStreamableHttp: normalizeString(capabilities && capabilities.transports && capabilities.transports.mcpStreamableHttp && capabilities.transports.mcpStreamableHttp.status),
        sdk: normalizeString(capabilities && capabilities.transports && capabilities.transports.sdk && capabilities.transports.sdk.status),
      },
      registryDigest: {
        descriptorHash: normalizeString(capabilities && capabilities.registryDigest && capabilities.registryDigest.descriptorHash),
        documentationHash: normalizeString(capabilities && capabilities.registryDigest && capabilities.registryDigest.documentationHash),
      },
    },
    schema: {
      commandCount: Number.isFinite(schema && schema.commandDescriptorMetadata && schema.commandDescriptorMetadata.totalCommands)
        ? schema.commandDescriptorMetadata.totalCommands
        : Object.keys((schema && schema.commandDescriptors) || {}).length,
      descriptorFieldCount: Array.isArray(schema && schema.commandDescriptorMetadata && schema.commandDescriptorMetadata.fieldNames)
        ? schema.commandDescriptorMetadata.fieldNames.length
        : 0,
      descriptorFieldsSample: sortStrings(
        Array.isArray(schema && schema.commandDescriptorMetadata && schema.commandDescriptorMetadata.fieldNames)
          ? schema.commandDescriptorMetadata.fieldNames.slice(0, 12)
          : [],
      ),
    },
    documentation: documentationSummary,
    policies: policySummary,
    profiles: profileSummary,
    recipes: recipeSummary,
    sdk: sdkSummary,
    canonicalTools: canonicalBootstrapTools,
    includedToolCommands: dedupeStringsPreserveOrder(toolSummaries.map((tool) => tool && tool.command)),
    recommendedBootstrapFlow: canonicalBootstrapTools,
    tools: toolSummaries,
    warnings,
    nextSteps,
  };
}

async function buildBootstrapPayloadAsync(options = {}, overrides = {}) {
  const buildCapabilities = typeof overrides.buildCapabilitiesPayloadAsync === 'function'
    ? overrides.buildCapabilitiesPayloadAsync
    : buildCapabilitiesPayloadAsync;
  const buildSchema = typeof overrides.buildSchemaPayload === 'function'
    ? overrides.buildSchemaPayload
    : buildSchemaPayload;
  const createPolicies = typeof overrides.createPolicyRegistryService === 'function'
    ? overrides.createPolicyRegistryService
    : createPolicyRegistryService;
  const createProfiles = typeof overrides.createProfileStore === 'function'
    ? overrides.createProfileStore
    : createProfileStore;
  const createResolver = typeof overrides.createProfileResolverService === 'function'
    ? overrides.createProfileResolverService
    : createProfileResolverService;
  const createRecipes = typeof overrides.createRecipeRegistryService === 'function'
    ? overrides.createRecipeRegistryService
    : createRecipeRegistryService;
  const buildDocs = typeof overrides.buildSkillDocIndex === 'function'
    ? overrides.buildSkillDocIndex
    : buildSkillDocIndex;

  const readinessOptions = {
    ...options,
    artifactNeutralProfileReadiness:
      options.runtimeLocalReadiness === true
        ? false
        : (options.artifactNeutralProfileReadiness !== false),
  };
  const compatibilityOptions = {
    ...options,
    includeCompatibility: options.includeCompatibility === true || options.includeAllTools === true,
  };
  const capabilities = await buildCapabilities({ ...readinessOptions, ...compatibilityOptions });
  const schema = buildSchema(compatibilityOptions);
  const documentationSummary = buildDocumentationSummary(buildDocs());
  const policySummary = buildPolicySummary(createPolicies().listPolicyPacks());
  const profileStore = createProfiles();
  const profileResolver = createResolver({
    store: profileStore,
    env: readinessOptions.artifactNeutralProfileReadiness === true ? {} : process.env,
  });
  const profileSummary = await buildProfileSummaryAsync(
    profileStore.loadProfileSet({ includeBuiltIns: true }),
    profileResolver,
    readinessOptions,
  );
  const recipeSummary = buildRecipeSummary(createRecipes().listRecipes());
  const sdkSummary = buildSdkSummary(capabilities);
  const toolCommands = pickBootstrapToolCommands(
    capabilities,
    documentationSummary,
    options.includeCompatibility === true || options.includeAllTools === true,
  );
  const canonicalBootstrapTools = buildCanonicalBootstrapTools(policySummary, profileSummary, recipeSummary);
  const toolSummaries = buildToolSummaries(toolCommands, capabilities, schema);
  const warnings = buildWarnings(capabilities, profileSummary, sdkSummary);
  const nextSteps = buildNextSteps({
    documentation: documentationSummary,
    policies: policySummary,
    profiles: profileSummary,
    recipes: recipeSummary,
    sdk: sdkSummary,
    warnings,
  });
  const defaults = {
    policyId: policySummary.recommendedReadOnlyPolicyId,
    profileId: profileSummary.recommendedReadOnlyProfileId,
    mode: profileSummary.readyMutableBuiltinCount > 0 ? 'validated-execution-available' : 'read-only-first',
  };

  return {
    schemaVersion: '1.0.0',
    generatedAt: normalizeString(options.generatedAtOverride)
      || normalizeString(capabilities && capabilities.generatedAt)
      || new Date().toISOString(),
    title: 'PandoraAgentBootstrap',
    description: 'Compact bootstrap payload for cold-start agents, composed from existing runtime capability, schema, policy, profile, recipe, and doc summaries.',
    source: 'bootstrap_command_service',
    commandDescriptorVersion: normalizeString(schema && schema.commandDescriptorVersion)
      || normalizeString(capabilities && capabilities.commandDescriptorVersion),
    readinessMode: readinessOptions.artifactNeutralProfileReadiness === true ? 'artifact-neutral' : 'runtime-local',
    principal: buildBootstrapPrincipal(readinessOptions),
    preferences: buildBootstrapPreferences(options, capabilities),
    defaults,
    summary: {
      recommendedStartingMode: defaults.mode,
      totalCommands: Number.isFinite(capabilities && capabilities.summary && capabilities.summary.totalCommands)
        ? capabilities.summary.totalCommands
        : Array.isArray(schema && schema.commandDescriptors)
          ? schema.commandDescriptors.length
          : Object.keys((schema && schema.commandDescriptors) || {}).length,
      canonicalToolCount: Object.keys((capabilities && capabilities.canonicalTools) || {}).length,
      starterToolCount: toolSummaries.length,
      policyCount: policySummary.count,
      profileCount: profileSummary.count,
      recipeCount: recipeSummary.count,
      remoteTransportStatus: normalizeString(
        capabilities
        && capabilities.transports
        && capabilities.transports.mcpStreamableHttp
        && capabilities.transports.mcpStreamableHttp.status,
      ),
    },
    capabilities: {
      totalCommands: Number.isFinite(capabilities && capabilities.summary && capabilities.summary.totalCommands)
        ? capabilities.summary.totalCommands
        : null,
      topLevelCommands: Number.isFinite(capabilities && capabilities.summary && capabilities.summary.topLevelCommands)
        ? capabilities.summary.topLevelCommands
        : null,
      routedTopLevelCommands: Number.isFinite(capabilities && capabilities.summary && capabilities.summary.routedTopLevelCommands)
        ? capabilities.summary.routedTopLevelCommands
        : null,
      mcpExposedCommands: Number.isFinite(capabilities && capabilities.summary && capabilities.summary.mcpExposedCommands)
        ? capabilities.summary.mcpExposedCommands
        : null,
      transports: {
        cliJson: normalizeString(capabilities && capabilities.transports && capabilities.transports.cliJson && capabilities.transports.cliJson.status),
        mcpStdio: normalizeString(capabilities && capabilities.transports && capabilities.transports.mcpStdio && capabilities.transports.mcpStdio.status),
        mcpStreamableHttp: normalizeString(capabilities && capabilities.transports && capabilities.transports.mcpStreamableHttp && capabilities.transports.mcpStreamableHttp.status),
        sdk: normalizeString(capabilities && capabilities.transports && capabilities.transports.sdk && capabilities.transports.sdk.status),
      },
      registryDigest: {
        descriptorHash: normalizeString(capabilities && capabilities.registryDigest && capabilities.registryDigest.descriptorHash),
        documentationHash: normalizeString(capabilities && capabilities.registryDigest && capabilities.registryDigest.documentationHash),
      },
    },
    schema: {
      commandCount: Number.isFinite(schema && schema.commandDescriptorMetadata && schema.commandDescriptorMetadata.totalCommands)
        ? schema.commandDescriptorMetadata.totalCommands
        : Object.keys((schema && schema.commandDescriptors) || {}).length,
      descriptorFieldCount: Array.isArray(schema && schema.commandDescriptorMetadata && schema.commandDescriptorMetadata.fieldNames)
        ? schema.commandDescriptorMetadata.fieldNames.length
        : 0,
      descriptorFieldsSample: sortStrings(
        Array.isArray(schema && schema.commandDescriptorMetadata && schema.commandDescriptorMetadata.fieldNames)
          ? schema.commandDescriptorMetadata.fieldNames.slice(0, 12)
          : [],
      ),
    },
    documentation: documentationSummary,
    policies: policySummary,
    profiles: profileSummary,
    recipes: recipeSummary,
    sdk: sdkSummary,
    canonicalTools: canonicalBootstrapTools,
    includedToolCommands: dedupeStringsPreserveOrder(toolSummaries.map((tool) => tool && tool.command)),
    recommendedBootstrapFlow: canonicalBootstrapTools,
    tools: toolSummaries,
    warnings,
    nextSteps,
  };
}

function createRunBootstrapCommand(deps = {}) {
  const CliError = typeof deps.CliError === 'function' ? deps.CliError : null;
  const emitSuccess = typeof deps.emitSuccess === 'function' ? deps.emitSuccess : null;
  const commandHelpPayload = typeof deps.commandHelpPayload === 'function'
    ? deps.commandHelpPayload
    : defaultHelpPayload;

  if (!CliError) {
    throw new Error('createRunBootstrapCommand requires CliError');
  }
  if (!emitSuccess) {
    throw new Error('createRunBootstrapCommand requires emitSuccess');
  }

  return async function runBootstrapCommand(args, context) {
    const actionArgs = Array.isArray(args) ? args.slice() : [];
    if (includesHelpFlag(actionArgs)) {
      if (context.outputMode === 'json') {
        emitSuccess(
          context.outputMode,
          'bootstrap.help',
          commandHelpPayload(
            'pandora [--output json] bootstrap [--include-compatibility] [--runtime-local-readiness]',
            [
              'Composes a compact cold-start bootstrap payload from the existing capabilities, schema, policy, profile, recipe, and doc services.',
              'By default only canonical tools are returned. Pass --include-compatibility to include backward-compatible alias commands in the tool section.',
              'By default bootstrap is artifact-neutral for cold-agent discovery. Pass --runtime-local-readiness only when you intentionally want host-local readiness signals.',
            ],
          ),
        );
      } else {
        // eslint-disable-next-line no-console
        console.log('Usage: pandora --output json bootstrap [--include-compatibility] [--runtime-local-readiness]');
        // eslint-disable-next-line no-console
        console.log('');
        // eslint-disable-next-line no-console
        console.log('Notes:');
        // eslint-disable-next-line no-console
        console.log('  - bootstrap payload is available only in --output json mode.');
        // eslint-disable-next-line no-console
        console.log('  - By default it returns canonical tools only. Pass --include-compatibility to surface alias commands.');
        // eslint-disable-next-line no-console
        console.log('  - By default it is artifact-neutral. Pass --runtime-local-readiness to inspect current host readiness explicitly.');
      }
      return;
    }

    if (context.outputMode !== 'json') {
      throw new CliError('INVALID_USAGE', 'The bootstrap command is only supported in --output json mode.', {
        hints: ['Run `pandora --output json bootstrap`'],
      });
    }

    const includeCompatibility = actionArgs.includes('--include-compatibility');
    const runtimeLocalReadiness = actionArgs.includes('--runtime-local-readiness');
    const unsupportedArgs = actionArgs.filter(
      (arg) => arg !== '--include-compatibility' && arg !== '--runtime-local-readiness',
    );
    if (unsupportedArgs.length > 0) {
      throw new CliError('INVALID_ARGS', `Unsupported bootstrap arguments: ${unsupportedArgs.join(' ')}`);
    }

    emitSuccess(
      context.outputMode,
      'bootstrap',
      await buildBootstrapPayloadAsync(
        { includeCompatibility, runtimeLocalReadiness },
        deps,
      ),
    );
  };
}

module.exports = {
  buildBootstrapPayload,
  buildBootstrapPayloadAsync,
  createRunBootstrapCommand,
};
