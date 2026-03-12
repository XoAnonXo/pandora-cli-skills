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
const { buildAllRemoteScopes, createMcpSweepFixtures, runMcpToolSweep } = require('../../tests/helpers/mcp_tool_sweep.cjs');

const REPORT_SCHEMA_VERSION = '1.0.0';
const REPORT_KIND = 'surface-e2e-report';
const DEFAULT_SURFACES = Object.freeze(['mcp-stdio', 'mcp-http', 'skill-bundle']);
const SURFACE_SET = new Set(['mcp-stdio', 'mcp-http', 'skill-bundle', 'skill-runtime']);

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

function includesNormalizedText(haystack, needle) {
  return normalizeText(haystack).includes(normalizeText(needle));
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

function getSweepRecordStatus(result) {
  if (result.transportError) return 'transport-error';
  if (!result.structured) return 'unstructured';
  if (Array.isArray(result.schemaIssues) && result.schemaIssues.length) return 'schema-issue';
  if (result.ok) return 'ok';
  return 'structured-error';
}

function normalizeSweepRecord(result, inventoryMap) {
  const action = inventoryMap.get(result.name) || null;
  return {
    name: result.name,
    transport: result.transport,
    status: getSweepRecordStatus(result),
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
    safeEquivalent: action ? action.safeEquivalent : null,
    safeFlags: action ? [...action.safeFlags] : [],
    recommendedPreflightTool: action ? action.recommendedPreflightTool : null,
    policyScopes: action ? [...action.policyScopes] : [],
    args: cloneJson(result.args),
  };
}

function summarizeSweep(records, expectedNames, strict) {
  const countsByStatus = {};
  const countsByErrorCode = {};
  const failures = [];

  for (const record of records) {
    countsByStatus[record.status] = (countsByStatus[record.status] || 0) + 1;
    const errorKey = record.ok ? 'OK' : (record.errorCode || record.transportError || record.status);
    countsByErrorCode[errorKey] = (countsByErrorCode[errorKey] || 0) + 1;
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
      records,
      notes: options.strict === true
        ? ['Strict mode treats any structured tool error as a failing E2E result.']
        : ['Non-strict mode still reports structured tool errors, but only transport/schema/unstructured failures fail the surface.'],
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
      'It does not execute a live external model. Use skill-runtime with an executor adapter for that.',
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
    const evaluation = evaluatePhraseConstraints(text, scenario.mustMention || [], scenario.mustAvoid || []);
    return { ...evaluation, evaluationMode: 'heuristic-phrase-check' };
  }
  if (kind === 'trigger-paraphrase') {
    return {
      ok: true,
      missing: [],
      forbidden: [],
      evaluationMode: 'presence-only',
    };
  }
  if (kind === 'trigger-should-not') {
    return {
      ok: true,
      missing: [],
      forbidden: [],
      evaluationMode: 'presence-only',
    };
  }
  const evaluation = evaluatePhraseConstraints(text, scenario.mustDo || [], scenario.mustNotDo || []);
  return { ...evaluation, evaluationMode: 'heuristic-phrase-check' };
}

function executeSkillScenarioWithAdapter(executorCommand, payload, bundleRoot) {
  const result = spawnSync(executorCommand, {
    cwd: REPO_ROOT,
    shell: true,
    encoding: 'utf8',
    input: `${JSON.stringify(payload, null, 2)}\n`,
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

  return {
    status: result.status === null ? 1 : result.status,
    stdout,
    stderr: String(result.stderr || '').trim(),
    parsed,
  };
}

async function runSkillRuntimeSurface(options = {}) {
  const bundleSurface = await runSkillBundleSurface();
  const bundleRoot = bundleSurface.bundleCheck.bundleRoot
    ? path.join(REPO_ROOT, bundleSurface.bundleCheck.bundleRoot)
    : null;
  const executorCommand = String(options.skillExecutor || '').trim();

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
          reason: 'No --skill-executor command was provided. This surface requires an external agent adapter.',
        },
      ],
      notes: [
        'The executor command receives one scenario JSON object on stdin and should print JSON with either responseText or a richer evaluation payload.',
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

  const scenarioResults = [];
  for (const scenario of scenarioPayloads) {
    const execution = executeSkillScenarioWithAdapter(executorCommand, scenario, bundleRoot);
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
    scenarioResults.push({
      id: scenario.id,
      kind: scenario.kind,
      ok: execution.status === 0 && evaluation.ok,
      evaluationMode: evaluation.evaluationMode,
      missing: evaluation.missing,
      forbidden: evaluation.forbidden,
      executorStatus: execution.status,
      stderr: execution.stderr || null,
      responseText,
    });
  }

  const failures = scenarioResults.filter((scenario) => !scenario.ok);
  return {
    surface: 'skill-runtime',
    ok: failures.length === 0,
    configured: true,
    bundleSurface,
    scenarioCount: scenarioResults.length,
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
  evaluateSkillScenarioResponse,
  parseSurfaceList,
  runSurfaceE2e,
};
