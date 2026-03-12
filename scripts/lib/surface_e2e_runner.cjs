'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const pkg = require('../../package.json');
const commandDescriptors = require('../../sdk/generated/command-descriptors.json');
const functionalScenarios = require('../../tests/skills/functional-scenarios.json');
const triggerFixtures = require('../../tests/skills/trigger-fixtures.json');
const { createMcpHttpGatewayService } = require('../../cli/lib/mcp_http_gateway_service.cjs');
const { createOperationService } = require('../../cli/lib/operation_service.cjs');
const { CLI_PATH, REPO_ROOT, createTempDir, removeDir } = require('../../tests/helpers/cli_runner.cjs');
const {
  buildAllRemoteScopes,
  createMcpSweepFixtures,
  runCliToolSweep,
  runMcpToolSweep,
} = require('../../tests/helpers/mcp_tool_sweep.cjs');

const REPORT_SCHEMA_VERSION = '1.0.0';
const REPORT_KIND = 'surface-e2e-report';
const DEFAULT_SURFACES = Object.freeze(['cli-json', 'mcp-stdio', 'mcp-http', 'skill-bundle']);
const SURFACE_SET = new Set(['cli-json', 'mcp-stdio', 'mcp-http', 'skill-bundle', 'skill-runtime']);
const DEFAULT_CLAUDE_SKILL_EXECUTOR = path.join(REPO_ROOT, 'scripts', 'claude_skill_executor.cjs');
const DEFAULT_SKILL_EXECUTOR_TIMEOUT_MS = 120000;
const DEFAULT_SKILL_EXECUTOR_TIMEOUT_RETRIES = 1;

function compareStableStrings(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function canonicalizeMatchText(value) {
  return normalizeText(value)
    .replace(/mcp__pandora__/g, '')
    .replace(/\bpandora__/g, '')
    .replace(/[_./:-]+/g, ' ')
    .replace(/[`"'()[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseNonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function includesNormalizedText(haystack, needle) {
  return canonicalizeMatchText(haystack).includes(canonicalizeMatchText(needle));
}

function includesAnyText(haystack, needles) {
  return (Array.isArray(needles) ? needles : []).some((needle) => includesNormalizedText(haystack, needle));
}

function includesAllText(haystack, needles) {
  return (Array.isArray(needles) ? needles : []).every((needle) => includesNormalizedText(haystack, needle));
}

function parseSurfaceList(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === 'all') return [...DEFAULT_SURFACES];
  const requested = raw.split(',').map((entry) => String(entry || '').trim()).filter(Boolean);
  if (!requested.length) return [...DEFAULT_SURFACES];
  for (const surface of requested) {
    if (!SURFACE_SET.has(surface)) {
      throw new Error(`Unknown surface: ${surface}`);
    }
  }
  return Array.from(new Set(requested));
}

function classifyAction(descriptor) {
  if (!descriptor || descriptor.mcpExposed !== true) return 'non-mcp';
  if (descriptor.mcpMutating !== true) return 'read';
  if (Array.isArray(descriptor.safeFlags) && descriptor.safeFlags.length) return 'simulate';
  if (descriptor.safeEquivalent) return 'simulate';
  if (descriptor.requiresSecrets === true) return 'live-only';
  return 'mutating-control';
}

function buildActionInventory(options = {}) {
  const includeCompatibilityAliases = options.includeCompatibilityAliases === true;
  const actions = Object.entries(commandDescriptors)
    .filter(([, descriptor]) => includeCompatibilityAliases || !descriptor.aliasOf)
    .map(([name, descriptor]) => ({
      name,
      aliasOf: descriptor.aliasOf || null,
      canonicalTool: descriptor.canonicalTool || name,
      preferred: descriptor.preferred !== false,
      mcpExposed: descriptor.mcpExposed === true,
      mcpMutating: descriptor.mcpMutating === true,
      requiresSecrets: descriptor.requiresSecrets === true,
      safeEquivalent: descriptor.safeEquivalent || null,
      safeFlags: Array.isArray(descriptor.safeFlags) ? [...descriptor.safeFlags] : [],
      executeFlags: Array.isArray(descriptor.executeFlags) ? [...descriptor.executeFlags] : [],
      executeIntentRequired: descriptor.executeIntentRequired === true,
      executeIntentRequiredForLiveMode: descriptor.executeIntentRequiredForLiveMode === true,
      recommendedPreflightTool: descriptor.recommendedPreflightTool || null,
      riskLevel: descriptor.riskLevel || 'unknown',
      idempotency: descriptor.idempotency || 'unknown',
      supportsRemote: descriptor.supportsRemote === true,
      mcpLongRunningBlocked: descriptor.mcpLongRunningBlocked === true,
      policyScopes: Array.isArray(descriptor.policyScopes) ? [...descriptor.policyScopes] : [],
      actionClass: classifyAction(descriptor),
      summary: descriptor.summary || '',
    }))
    .sort((left, right) => compareStableStrings(left.name, right.name));

  const counts = {};
  for (const action of actions) {
    counts[action.actionClass] = (counts[action.actionClass] || 0) + 1;
  }

  return {
    actionCount: actions.length,
    mcpActionCount: actions.filter((action) => action.mcpExposed).length,
    actions,
    countsByClass: counts,
  };
}

function buildInventoryMap(inventory) {
  return new Map((inventory.actions || []).map((action) => [action.name, action]));
}

function isLongRunningSweepSkip(result, action) {
  if (!result || !result.transportError || !action || action.mcpLongRunningBlocked !== true) return false;
  return includesAnyText(result.transportError, [
    'blocked in mcp v1 because it is long-running/unbounded',
    'long-running/unbounded',
  ]);
}

function getSweepRecordStatus(result, action) {
  if (isLongRunningSweepSkip(result, action)) return 'skipped-long-running';
  if (result.transportError) return 'transport-error';
  if (!result.structured) return 'unstructured';
  if (Array.isArray(result.schemaIssues) && result.schemaIssues.length) return 'schema-issue';
  if (result.ok) return 'ok';
  return 'structured-error';
}

function normalizeSweepRecord(result, inventoryMap) {
  const action = inventoryMap.get(result.name) || null;
  const status = getSweepRecordStatus(result, action);
  return {
    name: result.name,
    transport: result.transport,
    status,
    durationMs: Number(result.durationMs || 0),
    ok: result.ok === true,
    errorCode: result.errorCode || null,
    transportError: result.transportError || null,
    schemaIssues: Array.isArray(result.schemaIssues) ? [...result.schemaIssues] : [],
    structured: result.structured === true,
    command: result.command || null,
    actionClass: action ? action.actionClass : 'unknown',
    riskLevel: action ? action.riskLevel : 'unknown',
    requiresSecrets: action ? action.requiresSecrets === true : null,
    mcpLongRunningBlocked: action ? action.mcpLongRunningBlocked === true : null,
    safeEquivalent: action ? action.safeEquivalent : null,
    safeFlags: action ? [...action.safeFlags] : [],
    recommendedPreflightTool: action ? action.recommendedPreflightTool : null,
    policyScopes: action ? [...action.policyScopes] : [],
    args: cloneJson(result.args),
    skipReason: status === 'skipped-long-running'
      ? 'Long-running/unbounded command shape is intentionally excluded from this breadth sweep.'
      : null,
  };
}

function summarizeSweep(records, expectedNames, strict) {
  const countsByStatus = {};
  const countsByErrorCode = {};
  const failures = [];
  const skipped = [];

  for (const record of records) {
    countsByStatus[record.status] = (countsByStatus[record.status] || 0) + 1;
    const errorKey = record.status === 'skipped-long-running'
      ? 'SKIPPED_LONG_RUNNING'
      : (record.ok ? 'OK' : (record.errorCode || record.transportError || record.status));
    countsByErrorCode[errorKey] = (countsByErrorCode[errorKey] || 0) + 1;
    if (record.status === 'skipped-long-running') {
      skipped.push(record);
      continue;
    }
    if (
      record.status === 'transport-error'
      || record.status === 'unstructured'
      || record.status === 'schema-issue'
      || (strict && record.status === 'structured-error')
    ) {
      failures.push(record);
    }
  }

  const observedNames = new Set(records.map((record) => record.name));
  const missing = expectedNames
    .filter((name) => !observedNames.has(name))
    .sort(compareStableStrings)
    .map((name) => ({
      name,
      status: 'missing-from-sweep',
    }));

  return {
    recordCount: records.length,
    countsByStatus,
    countsByErrorCode,
    missing,
    skipped,
    failureCount: failures.length + missing.length,
    failures,
    strictFailureCount: strict
      ? records.filter((record) => record.status === 'structured-error').length + failures.filter((record) => record.status !== 'structured-error').length + missing.length
      : failures.length + missing.length,
  };
}

async function withMcpClient(fn, options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const extraArgs = Array.isArray(options.extraArgs) ? options.extraArgs : [];
  const client = new Client({ name: 'pandora-surface-e2e-stdio', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI_PATH, 'mcp', ...extraArgs],
    cwd: REPO_ROOT,
    stderr: 'pipe',
    env,
  });
  await client.connect(transport);
  try {
    return await fn(client, transport);
  } finally {
    await client.close();
  }
}

async function withMcpHttpGateway(fn, options = {}) {
  const tempDir = createTempDir('pandora-surface-e2e-http-');
  const operationService = createOperationService({
    rootDir: path.join(tempDir, 'operations'),
  });
  const args = ['--host', '127.0.0.1', '--port', '0'];
  const authScopes = Array.isArray(options.authScopes) && options.authScopes.length
    ? options.authScopes
    : ['help:read', 'capabilities:read', 'contracts:read', 'operations:read', 'schema:read'];

  if (Array.isArray(options.extraArgs) && options.extraArgs.length) {
    args.push(...options.extraArgs);
  }

  args.push('--auth-token', 'surface-e2e-token');
  args.push('--auth-scopes', authScopes.join(','));

  const service = createMcpHttpGatewayService({
    args,
    packageVersion: pkg.version,
    cliPath: CLI_PATH,
    operationService,
  });

  try {
    const gateway = await service.start();
    try {
      return await fn(gateway, operationService, tempDir);
    } finally {
      await gateway.close();
    }
  } finally {
    removeDir(tempDir);
  }
}

async function withRemoteMcpClient(fn, options = {}) {
  return withMcpHttpGateway(async (gateway, operationService, tempDir) => {
    const client = new Client({ name: 'pandora-surface-e2e-http', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(
      new URL(`${gateway.config.baseUrl}${gateway.config.mcpPath}`),
      {
        requestInit: {
          headers: {
            authorization: `Bearer ${gateway.auth.token}`,
          },
        },
      },
    );
    await client.connect(transport);
    try {
      return await fn(client, gateway, operationService, tempDir);
    } finally {
      await client.close();
    }
  }, options);
}

async function runMcpSurface(surfaceName, inventory, options = {}) {
  const fixtures = await createMcpSweepFixtures();
  const inventoryMap = buildInventoryMap(inventory);
  const expectedNames = inventory.actions
    .filter((action) => action.mcpExposed)
    .map((action) => action.name)
    .sort(compareStableStrings);

  try {
    const summary = surfaceName === 'mcp-http'
      ? await withRemoteMcpClient(
          (client) => runMcpToolSweep({ client, fixtures, transportLabel: 'http' }),
          {
            env: fixtures.env,
            authScopes: buildAllRemoteScopes(),
          },
        )
      : await withMcpClient(
          (client) => runMcpToolSweep({ client, fixtures, transportLabel: 'stdio' }),
          {
            env: fixtures.env,
          },
        );

    const records = summary.results.map((result) => normalizeSweepRecord(result, inventoryMap));
    const surfaceSummary = summarizeSweep(records, expectedNames, options.strict === true);
    return {
      surface: surfaceName,
      ok: surfaceSummary.failureCount === 0,
      toolCount: summary.toolCount,
      expectedToolCount: expectedNames.length,
      countsByStatus: surfaceSummary.countsByStatus,
      countsByErrorCode: surfaceSummary.countsByErrorCode,
      failures: surfaceSummary.failures,
      missing: surfaceSummary.missing,
      skipped: surfaceSummary.skipped,
      records,
      notes: options.strict === true
        ? ['Strict mode treats any structured tool error as a failing E2E result.']
        : ['Non-strict mode still reports structured tool errors, but only transport/schema/unstructured failures fail the surface.'],
    };
  } finally {
    await fixtures.cleanup();
  }
}

async function runCliJsonSurface(inventory, options = {}) {
  const fixtures = await createMcpSweepFixtures();
  const inventoryMap = buildInventoryMap(inventory);
  const expectedNames = inventory.actions
    .filter((action) => action.mcpExposed)
    .map((action) => action.name)
    .sort(compareStableStrings);

  try {
    const summary = await runCliToolSweep({
      fixtures,
      transportLabel: 'cli-json',
    });
    const records = summary.results.map((result) => normalizeSweepRecord(result, inventoryMap));
    const surfaceSummary = summarizeSweep(records, expectedNames, options.strict === true);
    return {
      surface: 'cli-json',
      ok: surfaceSummary.failureCount === 0,
      toolCount: summary.toolCount,
      expectedToolCount: expectedNames.length,
      countsByStatus: surfaceSummary.countsByStatus,
      countsByErrorCode: surfaceSummary.countsByErrorCode,
      failures: surfaceSummary.failures,
      missing: surfaceSummary.missing,
      skipped: surfaceSummary.skipped,
      records,
      notes: [
        'This surface executes the typed Pandora tool contract through raw CLI JSON instead of MCP transport.',
        'Long-running or daemon-like command families that are intentionally incompatible with this breadth sweep are reported as skipped-long-running instead of generic transport failures.',
        options.strict === true
          ? 'Strict mode treats any structured command error as a failing E2E result.'
          : 'Non-strict mode still reports structured command errors, but only transport/schema/unstructured failures fail the surface.',
      ],
    };
  } finally {
    await fixtures.cleanup();
  }
}

function buildSkillFixtureSummary() {
  return {
    triggerCounts: {
      shouldTrigger: Array.isArray(triggerFixtures.shouldTrigger) ? triggerFixtures.shouldTrigger.length : 0,
      paraphraseShouldTrigger: Array.isArray(triggerFixtures.paraphraseShouldTrigger) ? triggerFixtures.paraphraseShouldTrigger.length : 0,
      shouldNotTrigger: Array.isArray(triggerFixtures.shouldNotTrigger) ? triggerFixtures.shouldNotTrigger.length : 0,
    },
    functionalScenarioCount: Array.isArray(functionalScenarios.scenarios) ? functionalScenarios.scenarios.length : 0,
    functionalScenarioIds: Array.isArray(functionalScenarios.scenarios)
      ? functionalScenarios.scenarios.map((scenario) => scenario.id).sort(compareStableStrings)
      : [],
  };
}

function runAnthropicSkillBundleCheck() {
  const scriptPath = path.join(REPO_ROOT, 'scripts', 'check_anthropic_skill_bundle.cjs');
  const result = spawnSync(process.execPath, [scriptPath, '--build'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  const stdout = String(result.stdout || '').trim();
  let payload = null;
  if (stdout) {
    try {
      payload = JSON.parse(stdout);
    } catch {
      payload = null;
    }
  }
  return {
    status: result.status === null ? 1 : result.status,
    stdout,
    stderr: String(result.stderr || ''),
    payload,
  };
}

async function runSkillBundleSurface() {
  const bundleCheck = runAnthropicSkillBundleCheck();
  const fixtureSummary = buildSkillFixtureSummary();
  return {
    surface: 'skill-bundle',
    ok: bundleCheck.status === 0 && Boolean(bundleCheck.payload && bundleCheck.payload.ok === true),
    bundleCheck: {
      status: bundleCheck.status,
      bundleRoot: bundleCheck.payload && bundleCheck.payload.bundleRoot ? bundleCheck.payload.bundleRoot : null,
      markdownFileCount: bundleCheck.payload && Array.isArray(bundleCheck.payload.markdownFiles)
        ? bundleCheck.payload.markdownFiles.length
        : 0,
      markdownFiles: bundleCheck.payload && Array.isArray(bundleCheck.payload.markdownFiles)
        ? bundleCheck.payload.markdownFiles
        : [],
      stderr: bundleCheck.stderr || null,
    },
    fixtureSummary,
    notes: [
      'This surface validates the generated Anthropic skill bundle plus the declared trigger and functional scenario inventory.',
      'It does not execute a live runtime. Use skill-runtime with the bundled Claude adapter or an external executor for that.',
    ],
  };
}

function evaluatePhraseConstraints(responseText, mustContain = [], mustAvoid = []) {
  const missing = [];
  const forbidden = [];

  for (const phrase of mustContain) {
    if (!includesNormalizedText(responseText, phrase)) {
      missing.push(phrase);
    }
  }
  for (const phrase of mustAvoid) {
    if (includesNormalizedText(responseText, phrase)) {
      forbidden.push(phrase);
    }
  }

  return {
    ok: missing.length === 0 && forbidden.length === 0,
    missing,
    forbidden,
  };
}

function evaluateTriggerScenarioResponse(scenario, responseText) {
  const text = String(responseText || '');
  if (scenario && scenario.id === 'profile-readiness') {
    return {
      ok:
        includesAllText(text, ['profile list', 'profile explain'])
        && !includesAnyText(text, ['assume any mutable profile is ready', 'assume readiness without inspection']),
      missing: includesAllText(text, ['profile list', 'profile explain'])
        ? []
        : ['profile list/profile explain routing'],
      forbidden: includesAnyText(text, ['assume any mutable profile is ready', 'assume readiness without inspection'])
        ? ['assumed profile readiness']
        : [],
      evaluationMode: 'trigger-profile-heuristic',
    };
  }
  if (scenario && scenario.id === 'start-mcp') {
    const missing = [];
    const forbidden = [];
    if (!includesAnyText(text, ['local stdio', 'local mcp', 'pandora mcp'])) {
      missing.push('local stdio / Pandora MCP guidance');
    }
    if (!includesAnyText(text, ['hosted http', 'http gateway', 'pandora mcp http'])) {
      missing.push('hosted HTTP gateway guidance');
    }
    if (includesAnyText(text, ['treat remote http as the default for live user funds', 'hosted mutation by default'])) {
      forbidden.push('hosted HTTP as default for live funds');
    }
    return {
      ok: missing.length === 0 && forbidden.length === 0,
      missing,
      forbidden,
      evaluationMode: 'trigger-transport-heuristic',
    };
  }
  if (scenario && scenario.id === 'mirror-plan') {
    const missing = [];
    const forbidden = [];
    if (!includesAnyText(text, ['mirror'])) {
      missing.push('mirror');
    }
    if (!includesAnyText(text, ['plan'])) {
      missing.push('plan');
    }
    if (!includesAnyText(text, ['validation', 'validate'])) {
      missing.push('validation');
    }
    if (includesAnyText(text, scenario.mustAvoid || [])) {
      for (const phrase of scenario.mustAvoid || []) {
        if (includesAnyText(text, [phrase])) {
          forbidden.push(phrase);
        }
      }
    }
    return {
      ok: missing.length === 0 && forbidden.length === 0,
      missing,
      forbidden,
      evaluationMode: 'trigger-mirror-heuristic',
    };
  }
  const evaluation = evaluatePhraseConstraints(responseText, scenario.mustMention || [], scenario.mustAvoid || []);
  return { ...evaluation, evaluationMode: 'heuristic-phrase-check' };
}

function evaluateShouldNotTriggerScenarioResponse(responseText) {
  const routedToPandora = includesAnyText(responseText, [
    'pandora',
    'bootstrap',
    'capabilities',
    'schema',
    'quote',
    'mirror',
    'profile explain',
    'pandora mcp',
  ]);
  return {
    ok: routedToPandora === false,
    missing: [],
    forbidden: routedToPandora ? ['pandora-specific routing on a non-trigger scenario'] : [],
    evaluationMode: 'non-trigger-discipline',
  };
}

function evaluateFunctionalScenarioById(scenario, responseText) {
  const text = canonicalizeMatchText(responseText);
  const missing = [];
  const forbidden = [];
  const require = (condition, label) => {
    if (!condition) missing.push(label);
  };
  const forbid = (condition, label) => {
    if (condition) forbidden.push(label);
  };

  switch (scenario.id) {
    case 'safe-bootstrap':
      {
        const mentionsPrivateKey = includesAnyText(text, ['private key']);
        const defersSignerMaterial = includesAnyText(text, [
          'no secrets required',
          'stay read only',
          'stay read-only',
          'before any mutating workflow',
          'until secrets are configured',
          'until a mutable workflow',
          'before live execution',
        ]);
      require(includesAllText(text, ['bootstrap', 'capabilities', 'schema']), 'bootstrap/capabilities/schema guidance');
      require(includesAnyText(text, ['policy', 'profile']), 'policy/profile discovery before live execution');
      require(includesAnyText(text, ['read only', 'safe', 'discovery']), 'read-only-first guidance');
        forbid(mentionsPrivateKey && !defersSignerMaterial, 'private-key-first guidance');
      }
      break;
    case 'quote-workflow':
      require(includesAnyText(text, ['quote']), 'quote-first guidance');
      require(includesAnyText(text, ['trade', 'execute']), 'trade as later step');
      require(includesAnyText(text, ['before', 'after', 'once', 'review', 'acceptable']), 'execution separated from pricing');
      forbid(includesAnyText(text, ['trade execute without quoting', 'immediate trade execution']), 'immediate execution without pricing');
      break;
    case 'mirror-preflight':
      require(includesAnyText(text, ['mirror']), 'mirror routing');
      require(includesAnyText(text, ['plan', 'browse', 'simulate', 'dry run', 'paper']), 'dry-run or planning path');
      require(includesAnyText(text, ['validation', 'validate']), 'validation gating');
      require(
        includesAnyText(text, ['two', '2', 'multiple', 'independent'])
        && includesAnyText(text, ['public resolution source', 'sources', 'resolution']),
        'multiple public resolution sources',
      );
      forbid(
        includesAnyText(text, ['polymarket urls are valid resolution sources', 'use polymarket as resolution source']),
        'Polymarket as a valid resolution source',
      );
      break;
    case 'profile-go-no-go':
      require(includesAllText(text, ['profile list', 'profile explain']), 'profile list and profile explain semantics');
      require(includesAnyText(text, ['runtime', 'ready', 'readiness', 'usable']), 'runtime-readiness explanation');
      forbid(includesAnyText(text, ['assume', 'already ready']) && !includesAnyText(text, ['do not assume', 'cannot assume']), 'assumed mutable readiness');
      break;
    case 'mcp-transport-choice':
      require(includesAnyText(text, ['local stdio', 'local mcp', 'pandora mcp']), 'local runtime ownership');
      require(includesAnyText(text, ['hosted http', 'http gateway', 'pandora mcp http']), 'hosted runtime ownership');
      require(includesAnyText(text, ['read only', 'read-only', 'scopes']), 'read-only scopes guidance for hosted HTTP');
      forbid(includesAnyText(text, ['hosted mutation by default', 'remote http as the default for live user funds']), 'hosted mutation by default');
      break;
    case 'portfolio-closeout':
      require(includesAnyText(text, ['portfolio', 'history', 'claim', 'closeout']), 'portfolio/history/claim/closeout routing');
      require(includesAnyText(text, ['quote', 'simulate', 'dry run', 'inspect', 'review']), 'inspection before mutation');
      forbid(includesAnyText(text, ['claim all blindly', 'skip inspection']), 'blind closeout guidance');
      break;
    case 'market-type-choice':
      require(includesAllText(text, ['amm', 'parimutuel']), 'AMM and parimutuel explanation');
      require(includesAnyText(text, ['99.9/0.1', '99 9', 'skew', 'distribution']), 'extreme skew explanation');
      require(includesAnyText(text, ['pool', 'pooled', 'locked until resolution', 'resolution']), 'parimutuel pool explanation');
      require(includesAnyText(text, ['reprice', 'repricing', 'liquidity', 'probability']), 'AMM price-discovery explanation');
      require(includesAnyText(text, ['plan', 'validate', 'validation', 'dry run']), 'planning before execution');
      forbid(includesAnyText(text, ['execute live immediately', 'deploy immediately']) && !includesAnyText(text, ['do not', 'before']), 'immediate deploy without teaching');
      break;
    case 'market-suggestions':
      require(includesAnyText(text, ['markets hype plan', 'markets.hype.plan']), 'markets.hype.plan routing');
      require(includesAnyText(text, ['provider backed', 'provider-backed', 'openai', 'anthropic', 'auto']), 'provider-backed suggestion path');
      require(includesAnyText(text, ['mock', 'test only', 'test-only', 'deterministic']), 'mock as test-only guidance');
      require(includesAnyText(text, ['agent market hype', 'agent.market.hype', 'fallback']), 'agent fallback guidance');
      forbid(includesAnyText(text, ['use mock for real suggestions', 'mock is the default production path']), 'mock as production-default guidance');
      break;
    case 'watch-risk-monitoring':
      require(includesAnyText(text, ['watch']), 'watch routing');
      require(includesAnyText(text, ['risk show', 'risk', 'explain']), 'risk routing');
      require(includesAnyText(text, ['read only', 'read-only', 'monitor', 'before trading', 'before you trade', 'pre trade', 'pre-trade', 'only proceed']), 'monitoring-first guidance');
      forbid(includesAnyText(text, ['trade execute immediately', 'start with trade']) && !includesAnyText(text, ['do not', 'before']), 'direct execution before monitoring');
      break;
    case 'sports-provider-onboarding':
      require(includesAnyText(text, ['sports books list', 'books list']), 'sports books list preflight');
      require(includesAnyText(text, ['provider', 'configured', 'configuration', 'readiness']), 'provider-readiness guidance');
      forbid(includesAnyText(text, ['sports schedule first', 'run sports schedule first']) && !includesAnyText(text, ['books list']), 'schedule-first without provider preflight');
      break;
    case 'builder-surface-choice':
      require(includesAllText(text, ['mcp', 'cli', 'sdk']), 'MCP vs CLI vs SDK coverage');
      require(includesAnyText(text, ['agent', 'llm', 'tool use', 'tooling']), 'MCP agent-use explanation');
      require(includesAnyText(text, ['script', 'terminal', 'operator', 'automation']), 'CLI script/operator explanation');
      require(includesAnyText(text, ['embed', 'library', 'code', 'integration']), 'SDK embedding explanation');
      break;
    default:
      return {
        ok: true,
        missing: [],
        forbidden: [],
        evaluationMode: 'unimplemented-functional-check',
      };
  }

  return {
    ok: missing.length === 0 && forbidden.length === 0,
    missing,
    forbidden,
    evaluationMode: 'functional-heuristic',
  };
}

function evaluateSkillScenarioResponse(kind, scenario, responseText) {
  const text = String(responseText || '');
  if (!text.trim()) {
    return {
      ok: false,
      missing: ['non-empty responseText'],
      forbidden: [],
      evaluationMode: 'heuristic-phrase-check',
    };
  }

  if (kind === 'trigger-should') {
    return evaluateTriggerScenarioResponse(scenario, text);
  }
  if (kind === 'trigger-paraphrase') {
    return {
      ok: includesAnyText(text, ['pandora', 'bootstrap', 'quote', 'mirror', 'portfolio', 'mcp']),
      missing: [],
      forbidden: [],
      evaluationMode: 'paraphrase-trigger',
    };
  }
  if (kind === 'trigger-should-not') {
    return evaluateShouldNotTriggerScenarioResponse(text);
  }
  return evaluateFunctionalScenarioById(scenario, text);
}

function evaluateSkillRuntimeEvidence(kind, execution) {
  const parsed = execution && execution.parsed && typeof execution.parsed === 'object'
    ? execution.parsed
    : {};
  const toolUses = Array.isArray(parsed.toolUses) ? parsed.toolUses : [];
  const pandoraToolUses = Array.isArray(parsed.pandoraToolUses) ? parsed.pandoraToolUses : [];
  const permissionDenials = Array.isArray(parsed.permissionDenials) ? parsed.permissionDenials : [];
  const pandoraRouteSearches = toolUses
    .filter((entry) => entry && entry.name === 'ToolSearch')
    .filter((entry) => includesAnyText(entry.input && entry.input.query, ['mcp__pandora__', 'pandora']));
  const missing = [];
  const forbidden = [];

  if (permissionDenials.length) {
    forbidden.push(`permission-denied tools: ${permissionDenials.map((entry) => entry.toolName || 'unknown-tool').join(', ')}`);
  }
  if (kind === 'trigger-should' || kind === 'trigger-paraphrase' || kind === 'functional') {
    if (pandoraToolUses.length === 0 && pandoraRouteSearches.length === 0) {
      missing.push('at least one Pandora MCP tool call or Pandora-specific tool search');
    }
  }
  if (kind === 'trigger-should-not' && (pandoraToolUses.length > 0 || pandoraRouteSearches.length > 0)) {
    const leaked = [
      ...pandoraToolUses.map((entry) => entry.name || 'unknown-tool'),
      ...pandoraRouteSearches.map(() => 'ToolSearch(pandora)'),
    ];
    forbidden.push(`unexpected Pandora routing: ${leaked.join(', ')}`);
  }

  return {
    ok: missing.length === 0 && forbidden.length === 0,
    missing,
    forbidden,
    pandoraToolUses,
    pandoraRouteSearches,
    permissionDenials,
  };
}

function executeSkillScenarioWithAdapter(executorCommand, payload, bundleRoot) {
  const timeoutMs = parsePositiveInteger(
    payload && payload.executorTimeoutMs,
    DEFAULT_SKILL_EXECUTOR_TIMEOUT_MS,
  );
  const result = spawnSync(executorCommand, {
    cwd: REPO_ROOT,
    shell: true,
    encoding: 'utf8',
    input: `${JSON.stringify(payload, null, 2)}\n`,
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    env: {
      ...process.env,
      PANDORA_SKILL_BUNDLE_ROOT: bundleRoot,
      PANDORA_SKILL_SCENARIO_ID: payload.id,
      PANDORA_SKILL_SCENARIO_KIND: payload.kind,
    },
  });

  const stdout = String(result.stdout || '').trim();
  let parsed = null;
  if (stdout) {
    try {
      parsed = JSON.parse(stdout);
    } catch {
      parsed = { responseText: stdout };
    }
  }

  const executorError = result.error ? String(result.error.message || result.error) : null;
  const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');

  return {
    status: result.status === null ? 1 : result.status,
    stdout,
    stderr: timedOut
      ? `Executor timed out after ${timeoutMs}ms.${result.stderr ? ` ${String(result.stderr || '').trim()}` : ''}`.trim()
      : String(result.stderr || '').trim(),
    parsed,
    timeoutMs,
    timedOut,
    errorCode: result.error && result.error.code ? String(result.error.code) : null,
    executorError,
  };
}

function executeSkillScenarioWithRetries(executorCommand, payload, bundleRoot, maxTimeoutRetries = DEFAULT_SKILL_EXECUTOR_TIMEOUT_RETRIES) {
  const retryBudget = parseNonNegativeInteger(maxTimeoutRetries, DEFAULT_SKILL_EXECUTOR_TIMEOUT_RETRIES);
  const attempts = [];
  let execution = null;

  for (let attempt = 0; attempt <= retryBudget; attempt += 1) {
    execution = executeSkillScenarioWithAdapter(executorCommand, payload, bundleRoot);
    attempts.push({
      status: execution.status,
      timedOut: execution.timedOut === true,
      errorCode: execution.errorCode,
      executorError: execution.executorError,
    });
    if (execution.timedOut !== true) break;
  }

  return {
    ...execution,
    attemptCount: attempts.length,
    timeoutRetryCount: Math.max(0, attempts.length - 1),
    attempts,
  };
}

async function runSkillRuntimeSurface(options = {}) {
  const bundleSurface = await runSkillBundleSurface();
  const bundleRoot = bundleSurface.bundleCheck.bundleRoot
    ? path.join(REPO_ROOT, bundleSurface.bundleCheck.bundleRoot)
    : null;
  const configuredExecutor = String(options.skillExecutor || '').trim();
  const executorCommand = configuredExecutor
    || (fs.existsSync(DEFAULT_CLAUDE_SKILL_EXECUTOR) ? `${process.execPath} ${JSON.stringify(DEFAULT_CLAUDE_SKILL_EXECUTOR)}` : '');
  const executorTimeoutMs = parsePositiveInteger(
    options.skillTimeoutMs ?? process.env.PANDORA_SKILL_EXECUTOR_TIMEOUT_MS,
    DEFAULT_SKILL_EXECUTOR_TIMEOUT_MS,
  );
  const executorTimeoutRetries = parseNonNegativeInteger(
    options.skillTimeoutRetries ?? process.env.PANDORA_SKILL_EXECUTOR_TIMEOUT_RETRIES,
    DEFAULT_SKILL_EXECUTOR_TIMEOUT_RETRIES,
  );

  if (!bundleSurface.ok) {
    return {
      surface: 'skill-runtime',
      ok: false,
      configured: false,
      bundleSurface,
      scenarios: [],
      failures: [
        {
          id: 'skill-bundle-invalid',
          reason: 'The Anthropic skill bundle must build successfully before runtime execution.',
        },
      ],
    };
  }

  if (!executorCommand) {
    return {
      surface: 'skill-runtime',
      ok: false,
      configured: false,
      bundleSurface,
      scenarios: [],
      failures: [
        {
          id: 'skill-executor-missing',
          reason: 'No skill executor was available. Install the bundled Claude adapter dependencies or pass --skill-executor explicitly.',
        },
      ],
      notes: [
        'The executor command receives one scenario JSON object on stdin and should print JSON with either responseText or a richer evaluation payload.',
        'If the bundled Claude adapter is present, it is used automatically. Otherwise pass --skill-executor explicitly.',
      ],
    };
  }

  const scenarioPayloads = [];
  for (const scenario of triggerFixtures.shouldTrigger || []) {
    scenarioPayloads.push({ kind: 'trigger-should', ...scenario });
  }
  for (const scenario of triggerFixtures.paraphraseShouldTrigger || []) {
    scenarioPayloads.push({ kind: 'trigger-paraphrase', ...scenario });
  }
  for (const scenario of triggerFixtures.shouldNotTrigger || []) {
    scenarioPayloads.push({ kind: 'trigger-should-not', ...scenario });
  }
  for (const scenario of functionalScenarios.scenarios || []) {
    scenarioPayloads.push({ kind: 'functional', ...scenario });
  }
  const requestedScenarioIds = Array.isArray(options.skillScenarioIds) && options.skillScenarioIds.length
    ? new Set(options.skillScenarioIds.map((entry) => String(entry || '').trim()).filter(Boolean))
    : null;
  const filteredScenarios = requestedScenarioIds
    ? scenarioPayloads.filter((scenario) => requestedScenarioIds.has(scenario.id))
    : scenarioPayloads;

  if (requestedScenarioIds && filteredScenarios.length === 0) {
    return {
      surface: 'skill-runtime',
      ok: false,
      configured: true,
      executorCommand,
      executorTimeoutMs,
      executorTimeoutRetries,
      bundleSurface,
      scenarioCount: 0,
      failures: [
        {
          id: 'skill-scenarios-empty',
          reason: `No skill-runtime scenarios matched: ${Array.from(requestedScenarioIds).sort(compareStableStrings).join(', ')}`,
        },
      ],
      scenarios: [],
    };
  }

  const scenarioResults = [];
  for (const scenario of filteredScenarios) {
    const execution = executeSkillScenarioWithRetries(
      executorCommand,
      { ...scenario, executorTimeoutMs },
      bundleRoot,
      executorTimeoutRetries,
    );
    const responseText =
      execution.parsed && typeof execution.parsed.responseText === 'string'
        ? execution.parsed.responseText
        : execution.stdout;
    const evaluation = execution.status === 0
      ? evaluateSkillScenarioResponse(scenario.kind, scenario, responseText)
      : {
          ok: false,
          missing: [],
          forbidden: [],
          evaluationMode: 'executor-failed',
        };
    const runtimeEvidence = evaluateSkillRuntimeEvidence(scenario.kind, execution);
    scenarioResults.push({
      id: scenario.id,
      kind: scenario.kind,
      ok: execution.status === 0 && evaluation.ok && runtimeEvidence.ok,
      evaluationMode: evaluation.evaluationMode,
      missing: [...evaluation.missing, ...runtimeEvidence.missing],
      forbidden: [...evaluation.forbidden, ...runtimeEvidence.forbidden],
      executorStatus: execution.status,
      executorTimedOut: execution.timedOut === true,
      executorTimeoutMs: execution.timeoutMs,
      executorAttemptCount: execution.attemptCount,
      executorTimeoutRetryCount: execution.timeoutRetryCount,
      executorErrorCode: execution.errorCode,
      executorError: execution.executorError,
      permissionDenials: runtimeEvidence.permissionDenials,
      pandoraToolsUsed: runtimeEvidence.pandoraToolUses.map((entry) => entry.name || 'unknown-tool'),
      pandoraRouteSearches: runtimeEvidence.pandoraRouteSearches.map((entry) => entry.input && entry.input.query || ''),
      stderr: execution.stderr || null,
      responseText,
    });
  }

  const failures = scenarioResults.filter((scenario) => !scenario.ok);
  return {
    surface: 'skill-runtime',
    ok: failures.length === 0,
    configured: true,
    executorCommand,
    executorTimeoutMs,
    executorTimeoutRetries,
    bundleSurface,
    scenarioCount: scenarioResults.length,
    scenarioIds: filteredScenarios.map((scenario) => scenario.id),
    failures,
    scenarios: scenarioResults,
  };
}

async function runSurfaceE2e(options = {}) {
  const surfaces = parseSurfaceList(options.surface || 'all');
  const inventory = buildActionInventory({
    includeCompatibilityAliases: options.includeCompatibilityAliases === true,
  });

  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    kind: REPORT_KIND,
    generatedAt: new Date().toISOString(),
    packageVersion: pkg.version,
    strict: options.strict === true,
    surfacesRequested: surfaces,
    inventory,
    surfaces: {},
    failureSummary: [],
  };

  for (const surface of surfaces) {
    let surfaceResult;
    if (surface === 'mcp-stdio' || surface === 'mcp-http') {
      surfaceResult = await runMcpSurface(surface, inventory, options);
    } else if (surface === 'cli-json') {
      surfaceResult = await runCliJsonSurface(inventory, options);
    } else if (surface === 'skill-bundle') {
      surfaceResult = await runSkillBundleSurface();
    } else if (surface === 'skill-runtime') {
      surfaceResult = await runSkillRuntimeSurface(options);
    } else {
      throw new Error(`Unhandled surface: ${surface}`);
    }
    report.surfaces[surface] = surfaceResult;
  }

  for (const [surface, result] of Object.entries(report.surfaces)) {
    if (result.ok) continue;
    if (Array.isArray(result.failures) && result.failures.length) {
      for (const failure of result.failures) {
        report.failureSummary.push({
          surface,
          ...cloneJson(failure),
        });
      }
      continue;
    }
    report.failureSummary.push({ surface, reason: 'surface failed' });
  }

  report.ok = report.failureSummary.length === 0;
  return report;
}

module.exports = {
  DEFAULT_SURFACES,
  SURFACE_SET,
  buildActionInventory,
  evaluateSkillRuntimeEvidence,
  evaluateSkillScenarioResponse,
  executeSkillScenarioWithRetries,
  getSweepRecordStatus,
  parseSurfaceList,
  runSurfaceE2e,
  summarizeSweep,
};
