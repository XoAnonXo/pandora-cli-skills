const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBootstrapPayload,
  createRunBootstrapCommand,
} = require('../../cli/lib/bootstrap_command_service.cjs');

class TestCliError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function createBootstrapDeps(overrides = {}) {
  const docs = {
    contentHash: 'docs-hash',
    router: {
      path: 'SKILL.md',
      title: 'Pandora CLI & Skills',
    },
    skills: [
      {
        id: 'agent-quickstart',
        path: 'docs/skills/agent-quickstart.md',
        title: 'Agent Quickstart',
        summary: 'Cold-start guide for local CLI, MCP, remote HTTP, SDK, policy, and profile bootstrap.',
        kind: 'quickstart',
        canonicalTools: ['capabilities', 'schema', 'policy.list', 'profile.list'],
      },
      {
        id: 'capabilities',
        path: 'docs/skills/capabilities.md',
        title: 'Capabilities',
        summary: 'Runtime capability map and canonical tool routing.',
        kind: 'routing',
        canonicalTools: ['capabilities', 'schema', 'policy.list', 'profile.list'],
      },
      {
        id: 'agent-interfaces',
        path: 'docs/skills/agent-interfaces.md',
        title: 'Agent Interfaces',
        summary: 'Schema and transport contracts.',
        kind: 'contract',
        canonicalTools: ['schema'],
      },
      {
        id: 'policy-profiles',
        path: 'docs/skills/policy-profiles.md',
        title: 'Policy And Profiles',
        summary: 'Policy pack and signer-profile guidance.',
        kind: 'workflow',
        canonicalTools: ['policy.list', 'profile.list'],
      },
      {
        id: 'recipes',
        path: 'docs/skills/recipes.md',
        title: 'Recipes',
        summary: 'Reusable safe workflows.',
        kind: 'workflow',
        canonicalTools: ['recipe.list'],
      },
    ],
  };

  const commandDigests = {
    capabilities: {
      aliasOf: null,
      canonicalTool: 'capabilities',
      outputModes: ['json'],
      policyScopes: [],
      requiresSecrets: false,
      summary: 'Inspect runtime capabilities.',
      supportsRemote: true,
    },
    schema: {
      aliasOf: null,
      canonicalTool: 'schema',
      outputModes: ['json'],
      policyScopes: [],
      requiresSecrets: false,
      summary: 'Inspect the machine schema.',
      supportsRemote: true,
    },
    policy: {
      aliasOf: 'policy.list',
      canonicalTool: 'policy.list',
      outputModes: ['json'],
      policyScopes: [],
      requiresSecrets: false,
      summary: 'Alias for listing policy packs.',
      supportsRemote: true,
    },
    'policy.list': {
      aliasOf: null,
      canonicalTool: 'policy.list',
      outputModes: ['json'],
      policyScopes: [],
      requiresSecrets: false,
      summary: 'List policy packs.',
      supportsRemote: true,
    },
    profile: {
      aliasOf: 'profile.list',
      canonicalTool: 'profile.list',
      outputModes: ['json'],
      policyScopes: [],
      requiresSecrets: false,
      summary: 'Alias for listing profiles.',
      supportsRemote: true,
    },
    'profile.list': {
      aliasOf: null,
      canonicalTool: 'profile.list',
      outputModes: ['json'],
      policyScopes: [],
      requiresSecrets: false,
      summary: 'List signer profiles.',
      supportsRemote: true,
    },
    'recipe.list': {
      aliasOf: null,
      canonicalTool: 'recipe.list',
      outputModes: ['json'],
      policyScopes: [],
      requiresSecrets: false,
      summary: 'List recipes.',
      supportsRemote: true,
    },
  };

  const capabilities = {
    generatedAt: '2026-03-08T00:00:00.000Z',
    commandDescriptorVersion: '1.0.0',
    summary: {
      totalCommands: 7,
      topLevelCommands: 5,
      routedTopLevelCommands: 5,
      mcpExposedCommands: 7,
    },
    transports: {
      cliJson: { status: 'active' },
      mcpStdio: { status: 'active' },
      mcpStreamableHttp: { status: 'inactive' },
      sdk: { status: 'alpha' },
    },
    registryDigest: {
      descriptorHash: 'descriptor-hash',
      documentationHash: 'documentation-hash',
    },
    canonicalTools: {
      capabilities: { preferredCommand: 'capabilities', commands: ['capabilities'] },
      schema: { preferredCommand: 'schema', commands: ['schema'] },
      'policy.list': { preferredCommand: 'policy.list', commands: ['policy', 'policy.list'] },
      'profile.list': { preferredCommand: 'profile.list', commands: ['profile', 'profile.list'] },
      'recipe.list': { preferredCommand: 'recipe.list', commands: ['recipe.list'] },
    },
    commandDigests,
    policyProfiles: {
      signerProfiles: {
        degradedBuiltinCount: 0,
        degradedBuiltinIds: [],
        placeholderBuiltinCount: 0,
        placeholderBuiltinIds: [],
      },
    },
  };

  const schema = {
    commandDescriptorVersion: '1.0.0',
    commandDescriptorMetadata: {
      totalCommands: 7,
      fieldNames: [
        'summary',
        'usage',
        'canonicalTool',
        'canonicalUsage',
        'outputModes',
        'policyScopes',
        'requiresSecrets',
        'supportsRemote',
      ],
    },
    commandDescriptors: {
      capabilities: {
        canonicalTool: 'capabilities',
        canonicalUsage: 'pandora --output json capabilities',
        summary: 'Inspect runtime capabilities.',
        outputModes: ['json'],
      },
      schema: {
        canonicalTool: 'schema',
        canonicalUsage: 'pandora --output json schema',
        summary: 'Inspect the machine schema.',
        outputModes: ['json'],
      },
      'policy.list': {
        canonicalTool: 'policy.list',
        canonicalUsage: 'pandora --output json policy list',
        summary: 'List policy packs.',
        outputModes: ['json'],
      },
      'profile.list': {
        canonicalTool: 'profile.list',
        canonicalUsage: 'pandora --output json profile list',
        summary: 'List signer profiles.',
        outputModes: ['json'],
      },
      'recipe.list': {
        canonicalTool: 'recipe.list',
        canonicalUsage: 'pandora --output json recipe list',
        summary: 'List recipes.',
        outputModes: ['json'],
      },
      policy: {
        canonicalTool: 'policy.list',
        aliasOf: 'policy.list',
        canonicalUsage: 'pandora --output json policy list',
        summary: 'Alias for policy list.',
        outputModes: ['json'],
      },
      profile: {
        canonicalTool: 'profile.list',
        aliasOf: 'profile.list',
        canonicalUsage: 'pandora --output json profile list',
        summary: 'Alias for profile list.',
        outputModes: ['json'],
      },
    },
  };

  const policies = {
    count: 2,
    builtinCount: 2,
    storedCount: 0,
    items: [
      {
        id: 'research-only',
        displayName: 'Research Only',
        description: 'Read-only discovery policy.',
        source: 'builtin',
        extends: [],
      },
      {
        id: 'execute-with-validation',
        displayName: 'Execute With Validation',
        description: 'Validated mutable execution policy.',
        source: 'builtin',
        extends: [],
      },
    ],
  };

  const profileItems = overrides.profileItems || [
    {
      id: 'market_observer_ro',
      builtin: true,
      source: 'builtin',
      summary: {
        id: 'market_observer_ro',
        displayName: 'Market Observer RO',
        signerBackend: 'read-only',
        readOnly: true,
        defaultPolicy: 'research-only',
        allowedPolicies: ['research-only'],
      },
    },
    {
      id: 'prod_trader_a',
      builtin: true,
      source: 'builtin',
      summary: {
        id: 'prod_trader_a',
        displayName: 'Prod Trader A',
        signerBackend: 'local-env',
        readOnly: false,
        defaultPolicy: 'execute-with-validation',
        allowedPolicies: ['execute-with-validation'],
      },
    },
  ];

  const profileResolutions = overrides.profileResolutions || {
    market_observer_ro: {
      resolution: {
        ready: true,
        status: 'ready',
        backendImplemented: true,
      },
    },
    prod_trader_a: {
      resolution: {
        ready: true,
        status: 'ready',
        backendImplemented: true,
      },
    },
  };

  const recipes = {
    count: 1,
    builtinCount: 1,
    userCount: 0,
    items: [
      {
        id: 'safe-discovery',
        displayName: 'Safe Discovery',
        description: 'Read-only market discovery recipe.',
        tool: 'scan',
        defaultPolicy: 'research-only',
        defaultProfile: 'market_observer_ro',
        safeByDefault: true,
        operationExpected: false,
        supportsRemote: true,
        source: 'builtin',
      },
    ],
  };

  const emitted = [];

  return {
    CliError: TestCliError,
    emitSuccess: (outputMode, command, data) => emitted.push({ outputMode, command, data }),
    commandHelpPayload: (usage, notes) => ({ usage, notes }),
    buildCapabilitiesPayload: () => ({
      ...capabilities,
      policyProfiles: overrides.signerProfiles
        ? { signerProfiles: overrides.signerProfiles }
        : capabilities.policyProfiles,
    }),
    buildSchemaPayload: () => schema,
    createPolicyRegistryService: () => ({
      listPolicyPacks: () => policies,
    }),
    createProfileStore: () => ({
      loadProfileSet: () => ({
        builtInCount: profileItems.filter((item) => item.builtin).length,
        fileCount: profileItems.filter((item) => item.source === 'file').length,
        items: profileItems,
      }),
    }),
    createProfileResolverService: () => ({
      resolveProfile: ({ profileId }) => profileResolutions[profileId] || {
        resolution: {
          ready: false,
          status: 'pending',
          backendImplemented: null,
        },
      },
    }),
    createRecipeRegistryService: () => ({
      listRecipes: () => recipes,
    }),
    buildSkillDocIndex: () => docs,
    emitted,
  };
}

test('bootstrap command gives a cold agent actionable next steps', async () => {
  const deps = createBootstrapDeps();
  const runBootstrapCommand = createRunBootstrapCommand(deps);

  await runBootstrapCommand([], { outputMode: 'json' });

  assert.equal(deps.emitted.length, 1);
  assert.equal(deps.emitted[0].command, 'bootstrap');

  const payload = deps.emitted[0].data;
  assert.equal(payload.readinessMode, 'artifact-neutral');
  assert.equal(payload.principal.transport, 'cli-json');
  assert.equal(payload.preferences.canonicalOnlyDefault, true);
  assert.equal(payload.preferences.aliasesHiddenByDefault, true);
  assert.equal(payload.defaults.policyId, 'research-only');
  assert.equal(payload.defaults.profileId, 'market_observer_ro');
  assert.equal(payload.defaults.mode, 'validated-execution-available');
  assert.ok(payload.warnings.some((warning) => warning.code === 'SIGNER_PROFILES_DEGRADED'));
  assert.ok(payload.warnings.some((warning) => warning.code === 'SDK_PUBLIC_REGISTRY_PENDING'));
  assert.ok(!payload.warnings.some((warning) => warning.code === 'NO_RUNTIME_READY_MUTABLE_PROFILE'));
  assert.equal(payload.recommendedBootstrapFlow[0], 'bootstrap');
  assert.deepEqual(payload.canonicalTools, ['bootstrap', 'capabilities', 'schema', 'policy.list', 'profile.get', 'recipe.list']);
  assert.ok(Array.isArray(payload.includedToolCommands));
  assert.ok(payload.includedToolCommands.includes('bootstrap') === false);

  assert.ok(payload.nextSteps.some((step) => step.command === 'pandora --output json capabilities'));
  assert.ok(payload.nextSteps.some((step) => step.command === 'pandora --output json schema'));
  assert.ok(payload.nextSteps.some((step) => step.command === 'pandora --output json policy list'));
  assert.ok(payload.nextSteps.some((step) => step.command === 'pandora --output json profile list'));
  assert.ok(payload.nextSteps.some((step) => step.command === 'pandora --output json profile get --id market_observer_ro'));
  assert.ok(payload.nextSteps.some((step) => step.command === 'pandora --output json recipe list'));
  assert.ok(payload.nextSteps.some((step) => step.path === 'docs/skills/agent-quickstart.md'));
});

test('bootstrap payload emits readiness warnings when mutable profiles are degraded or placeholder-only', () => {
  const payload = buildBootstrapPayload(
    { generatedAtOverride: '2026-03-08T00:00:00.000Z' },
    createBootstrapDeps({
      signerProfiles: {
        degradedBuiltinCount: 1,
        degradedBuiltinIds: ['prod_trader_a'],
        placeholderBuiltinCount: 1,
        placeholderBuiltinIds: ['desk_signer_service'],
      },
      profileItems: [
        {
          id: 'market_observer_ro',
          builtin: true,
          source: 'builtin',
          summary: {
            id: 'market_observer_ro',
            displayName: 'Market Observer RO',
            signerBackend: 'read-only',
            readOnly: true,
            defaultPolicy: 'research-only',
            allowedPolicies: ['research-only'],
          },
        },
        {
          id: 'desk_signer_service',
          builtin: true,
          source: 'builtin',
          summary: {
            id: 'desk_signer_service',
            displayName: 'Desk Signer Service',
            signerBackend: 'external-signer',
            readOnly: false,
            defaultPolicy: 'execute-with-validation',
            allowedPolicies: ['execute-with-validation'],
          },
        },
        {
          id: 'prod_trader_a',
          builtin: true,
          source: 'builtin',
          summary: {
            id: 'prod_trader_a',
            displayName: 'Prod Trader A',
            signerBackend: 'local-env',
            readOnly: false,
            defaultPolicy: 'execute-with-validation',
            allowedPolicies: ['execute-with-validation'],
          },
        },
      ],
      profileResolutions: {
        market_observer_ro: {
          resolution: {
            ready: true,
            status: 'ready',
            backendImplemented: true,
          },
        },
        desk_signer_service: {
          resolution: {
            ready: false,
            status: 'pending',
            backendImplemented: false,
          },
        },
        prod_trader_a: {
          resolution: {
            ready: false,
            status: 'missing-context',
            backendImplemented: true,
          },
        },
      },
    }),
  );

  assert.equal(payload.defaults.mode, 'read-only-first');
  assert.ok(payload.warnings.some((warning) => warning.code === 'NO_RUNTIME_READY_MUTABLE_PROFILE'));
  assert.ok(payload.warnings.some((warning) => warning.code === 'SIGNER_PROFILES_DEGRADED'));
  assert.ok(payload.warnings.some((warning) => warning.code === 'SIGNER_PROFILES_PLACEHOLDER'));
  assert.ok(
    payload.nextSteps.some(
      (step) =>
        step.id === 'inspect-mutable-profile-readiness'
        && step.command === 'pandora --output json profile get --id prod_trader_a',
    ),
  );
});

test('bootstrap payload returns canonical tools only by default', () => {
  const deps = createBootstrapDeps();
  const defaultPayload = buildBootstrapPayload(
    { generatedAtOverride: '2026-03-08T00:00:00.000Z' },
    deps,
  );
  const allToolsPayload = buildBootstrapPayload(
    { generatedAtOverride: '2026-03-08T00:00:00.000Z', includeAllTools: true },
    deps,
  );

  assert.ok(defaultPayload.tools.length > 0);
  assert.ok(defaultPayload.tools.every((tool) => tool.aliasOf === null));
  assert.ok(!defaultPayload.tools.some((tool) => tool.command === 'policy'));
  assert.ok(!defaultPayload.tools.some((tool) => tool.command === 'profile'));
  assert.ok(!defaultPayload.canonicalTools.includes('policy'));
  assert.ok(!defaultPayload.canonicalTools.includes('profile'));
  assert.ok(allToolsPayload.tools.some((tool) => tool.command === 'policy'));
  assert.ok(allToolsPayload.tools.some((tool) => tool.command === 'profile'));
  assert.ok(!allToolsPayload.canonicalTools.includes('policy'));
  assert.ok(!allToolsPayload.canonicalTools.includes('profile'));
  assert.ok(allToolsPayload.includedToolCommands.includes('policy'));
  assert.ok(allToolsPayload.includedToolCommands.includes('profile'));
});
