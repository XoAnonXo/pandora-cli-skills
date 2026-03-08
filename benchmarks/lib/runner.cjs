const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pkg = require('../../package.json');
const { loadGeneratedManifest } = require('../../sdk/typescript');
const { COMMAND_DESCRIPTOR_VERSION } = require('../../cli/lib/agent_contract_registry.cjs');
const { buildCapabilitiesPayload } = require('../../cli/lib/capabilities_command_service.cjs');
const { buildSchemaPayload } = require('../../cli/lib/schema_command_service.cjs');
const { upsertOperation } = require('../../cli/lib/operation_state_store.cjs');
const {
  buildBenchmarkEnv,
  createTempDir,
  removeDir,
  runCli,
  parseJsonOutput,
  tryParseJsonOutput,
  withLocalClient,
  withRemoteClient,
  callMcpTool,
} = require('./runtime.cjs');
const { getAssertion, getErrorEnvelope } = require('./assertions.cjs');

const SCENARIO_SCHEMA_VERSION = '1.0.0';
const LOCK_SCHEMA_VERSION = '1.0.0';
const DEFAULT_SUITE = 'core';
const SUITE_EXPECTATIONS = Object.freeze({
  core: Object.freeze({
    expectedScenarioCount: 19,
    minimumWeightedScore: 95,
  }),
});
const SCENARIO_ROOT = path.resolve(__dirname, '..', 'scenarios');
const LOCK_ROOT = path.resolve(__dirname, '..', 'locks');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GENERATED_ARTIFACT_PATHS = Object.freeze({
  generatedContractRegistry: path.join(REPO_ROOT, 'sdk', 'generated', 'contract-registry.json'),
  generatedCommandDescriptors: path.join(REPO_ROOT, 'sdk', 'generated', 'command-descriptors.json'),
  generatedMcpToolDefinitions: path.join(REPO_ROOT, 'sdk', 'generated', 'mcp-tool-definitions.json'),
  generatedManifest: path.join(REPO_ROOT, 'sdk', 'generated', 'manifest.json'),
  tsContractRegistry: path.join(REPO_ROOT, 'sdk', 'generated', 'contract-registry.json'),
  tsCommandDescriptors: path.join(REPO_ROOT, 'sdk', 'generated', 'command-descriptors.json'),
  tsMcpToolDefinitions: path.join(REPO_ROOT, 'sdk', 'generated', 'mcp-tool-definitions.json'),
  tsManifest: path.join(REPO_ROOT, 'sdk', 'typescript', 'generated', 'manifest.json'),
  pyContractRegistry: path.join(REPO_ROOT, 'sdk', 'generated', 'contract-registry.json'),
  pyCommandDescriptors: path.join(REPO_ROOT, 'sdk', 'generated', 'command-descriptors.json'),
  pyMcpToolDefinitions: path.join(REPO_ROOT, 'sdk', 'generated', 'mcp-tool-definitions.json'),
  pyManifest: path.join(REPO_ROOT, 'sdk', 'python', 'pandora_agent', 'generated', 'manifest.json'),
});

function stableJsonHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
      sorted[key] = sortJsonValue(value[key]);
    }
    return sorted;
  }
  return value;
}

function loadScenarioSuite(suite = DEFAULT_SUITE) {
  const suiteDir = path.join(SCENARIO_ROOT, suite);
  return fs.readdirSync(suiteDir)
    .filter((name) => name.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => JSON.parse(fs.readFileSync(path.join(suiteDir, name), 'utf8')));
}

function defaultSuiteLockPath(suite = DEFAULT_SUITE) {
  return path.join(LOCK_ROOT, `${suite}.lock.json`);
}

function defaultSuiteLockId(suite = DEFAULT_SUITE) {
  return path.relative(REPO_ROOT, defaultSuiteLockPath(suite));
}

function getSuiteExpectation(suite = DEFAULT_SUITE) {
  return SUITE_EXPECTATIONS[suite] || null;
}

function loadSuiteLock(suite = DEFAULT_SUITE) {
  const lockPath = defaultSuiteLockPath(suite);
  if (!fs.existsSync(lockPath)) return null;
  return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
}

function validateSeedOperation(seedOperation, scenarioId, index) {
  if (!seedOperation || typeof seedOperation !== 'object') {
    throw new Error(`Scenario ${scenarioId} seedOperations[${index}] must be an object`);
  }
  if (!String(seedOperation.operationId || '').trim()) {
    throw new Error(`Scenario ${scenarioId} seedOperations[${index}] is missing operationId`);
  }
  if (!String(seedOperation.command || '').trim()) {
    throw new Error(`Scenario ${scenarioId} seedOperations[${index}] is missing command`);
  }
  if (!String(seedOperation.status || '').trim()) {
    throw new Error(`Scenario ${scenarioId} seedOperations[${index}] is missing status`);
  }
}

function validateScenarioManifest(scenario) {
  if (!scenario || scenario.schemaVersion !== SCENARIO_SCHEMA_VERSION) {
    throw new Error(`Invalid scenario schemaVersion for ${scenario && scenario.id}`);
  }
  if (!String(scenario.id || '').trim()) {
    throw new Error(`Scenario is missing id: ${JSON.stringify(scenario)}`);
  }
  if (!String(scenario.title || '').trim()) {
    throw new Error(`Scenario ${scenario.id} is missing title`);
  }
  if (!String(scenario.description || '').trim()) {
    throw new Error(`Scenario ${scenario.id} is missing description`);
  }
  if (!String(scenario.transport || '').trim()) {
    throw new Error(`Scenario ${scenario.id} is missing transport`);
  }
  if (!String(scenario.assertionId || '').trim()) {
    throw new Error(`Scenario ${scenario.id} is missing assertionId`);
  }
  if (!Number.isFinite(Number(scenario.weight)) || Number(scenario.weight) <= 0) {
    throw new Error(`Scenario ${scenario.id} must declare a positive numeric weight`);
  }
  if (!Number.isFinite(Number(scenario.targetLatencyMs)) || Number(scenario.targetLatencyMs) <= 0) {
    throw new Error(`Scenario ${scenario.id} must declare a positive targetLatencyMs`);
  }
  if (!Array.isArray(scenario.dimensions) || scenario.dimensions.length === 0) {
    throw new Error(`Scenario ${scenario.id} must declare at least one dimension`);
  }
  if (!scenario.request || typeof scenario.request !== 'object') {
    throw new Error(`Scenario ${scenario.id} is missing request`);
  }
  if (scenario.transport === 'cli-json') {
    if (!Array.isArray(scenario.request.args) || scenario.request.args.length === 0) {
      throw new Error(`CLI scenario ${scenario.id} requires request.args[]`);
    }
  }
  if (scenario.transport === 'mcp-stdio' || scenario.transport === 'mcp-http') {
    const requestMode = String(scenario.request.mode || 'callTool').trim() || 'callTool';
    if (!['callTool', 'listTools'].includes(requestMode)) {
      throw new Error(`MCP scenario ${scenario.id} request.mode must be callTool or listTools`);
    }
    if (requestMode === 'callTool' && !String(scenario.request.tool || '').trim()) {
      throw new Error(`MCP scenario ${scenario.id} requires request.tool`);
    }
    if (scenario.request.arguments !== undefined && (scenario.request.arguments === null || typeof scenario.request.arguments !== 'object' || Array.isArray(scenario.request.arguments))) {
      throw new Error(`MCP scenario ${scenario.id} request.arguments must be an object when provided`);
    }
    if (scenario.transport === 'mcp-http' && scenario.request.authScopes !== undefined) {
      if (!Array.isArray(scenario.request.authScopes) || scenario.request.authScopes.some((scope) => !String(scope || '').trim())) {
        throw new Error(`MCP HTTP scenario ${scenario.id} authScopes must be a non-empty string array when provided`);
      }
    }
  }
  if (scenario.parityGroup !== undefined && !String(scenario.parityGroup || '').trim()) {
    throw new Error(`Scenario ${scenario.id} parityGroup must be a non-empty string when provided`);
  }
  if (scenario.parityExpectedTransports !== undefined) {
    if (!Array.isArray(scenario.parityExpectedTransports) || scenario.parityExpectedTransports.length === 0) {
      throw new Error(`Scenario ${scenario.id} parityExpectedTransports must be a non-empty array when provided`);
    }
    const invalidTransport = scenario.parityExpectedTransports.find((entry) =>
      !['cli-json', 'mcp-stdio', 'mcp-http'].includes(String(entry || '').trim()));
    if (invalidTransport) {
      throw new Error(`Scenario ${scenario.id} parityExpectedTransports contains unsupported transport: ${invalidTransport}`);
    }
  }
  if (scenario.seedOperations !== undefined) {
    if (!Array.isArray(scenario.seedOperations)) {
      throw new Error(`Scenario ${scenario.id} seedOperations must be an array when provided`);
    }
    scenario.seedOperations.forEach((seedOperation, index) => validateSeedOperation(seedOperation, scenario.id, index));
  }
}

function stripCapabilitiesParityNoise(envelope) {
  const clone = deepClone(envelope);
  if (clone.data && typeof clone.data === 'object') {
    delete clone.data.generatedAt;
    delete clone.data.gateway;
    if (clone.data.transports && clone.data.transports.mcpStreamableHttp) {
      delete clone.data.transports.mcpStreamableHttp.status;
      delete clone.data.transports.mcpStreamableHttp.endpoint;
      delete clone.data.transports.mcpStreamableHttp.notes;
    }
    if (clone.data.roadmapSignals) {
      delete clone.data.roadmapSignals.notes;
    }
    if (clone.data.versionCompatibility) {
      delete clone.data.versionCompatibility.mcpTransport;
      delete clone.data.versionCompatibility.notes;
    }
    if (clone.data.registryDigest) {
      delete clone.data.registryDigest.commandDigestHash;
    }
    if (clone.data.commandDigests && typeof clone.data.commandDigests === 'object') {
      for (const digest of Object.values(clone.data.commandDigests)) {
        if (!digest || typeof digest !== 'object') continue;
        delete digest.remoteTransportActive;
        delete digest.remotePlanned;
      }
    }
  }
  return clone;
}

function normalizeSchemaPayloadForLock(schemaPayload) {
  const clone = deepClone(schemaPayload);
  if (clone && typeof clone === 'object') {
    delete clone.generatedAt;
  }
  return sortJsonValue(clone);
}

function normalizeCapabilitiesForLock(capabilities) {
  const clone = deepClone(capabilities);
  if (clone && typeof clone === 'object') {
    delete clone.generatedAt;
  }
  return sortJsonValue(clone);
}

function normalizeBenchmarkReportForFreshness(report) {
  const clone = deepClone(report);
  if (clone && typeof clone === 'object') {
    delete clone.generatedAt;
    delete clone.writtenLockPath;
  }
  if (clone && Array.isArray(clone.scenarios)) {
    clone.scenarios = clone.scenarios.map((scenario) => ({
      id: scenario.id,
      title: scenario.title || null,
      description: scenario.description || null,
      transport: scenario.transport,
      dimensions: Array.isArray(scenario.dimensions) ? scenario.dimensions.slice().sort() : [],
      weight: scenario.weight,
      passed: scenario.passed,
      runtimeState: scenario.runtimeState || null,
      parityGroup: scenario.parityGroup || null,
      parityExpectedTransports: Array.isArray(scenario.parityExpectedTransports)
        ? scenario.parityExpectedTransports.slice().sort()
        : [],
      parityHash: scenario.parityHash || null,
      score: scenario.score,
      failure: scenario.failure || null,
      checks: Array.isArray(scenario.checks)
        ? scenario.checks.map((check) => ({
          id: check && check.id ? check.id : null,
          passed: Boolean(check && check.passed),
          message: check && check.message ? check.message : null,
        }))
        : [],
    })).sort((left, right) => String(left.id || '').localeCompare(String(right.id || '')));
  }
  return sortJsonValue(clone);
}

function stripToolsListParityNoise(envelope) {
  const clone = deepClone(envelope);
  const tools = clone && clone.data && Array.isArray(clone.data.tools) ? clone.data.tools : [];
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;
    if (tool.xPandora && typeof tool.xPandora === 'object') {
      delete tool.xPandora.remoteTransportActive;
      delete tool.xPandora.remotePlanned;
    }
    if (tool.commandDescriptor && typeof tool.commandDescriptor === 'object') {
      delete tool.commandDescriptor.remoteTransportActive;
      delete tool.commandDescriptor.remotePlanned;
    }
    if (tool.inputSchema && typeof tool.inputSchema === 'object' && tool.inputSchema.xPandora && typeof tool.inputSchema.xPandora === 'object') {
      delete tool.inputSchema.xPandora.remoteTransportActive;
      delete tool.inputSchema.xPandora.remotePlanned;
    }
  }
  clone.data.tools = tools.sort((left, right) => String(left && left.name || '').localeCompare(String(right && right.name || '')));
  return sortJsonValue(clone);
}

function normalizeParityEnvelope(scenario, envelope) {
  if (!scenario.parityGroup || !envelope || typeof envelope !== 'object') return null;
  if (scenario.assertionId === 'capabilities-bootstrap') {
    return stripCapabilitiesParityNoise(envelope);
  }
  if (scenario.assertionId === 'schema-bootstrap' || scenario.assertionId === 'operations-get-seeded') {
    const clone = deepClone(envelope);
    if (clone.data && typeof clone.data === 'object') {
      delete clone.data.generatedAt;
    }
    return clone;
  }
  if (scenario.assertionId === 'workspace-path-denial') {
    const clone = deepClone(envelope);
    if (clone.error && typeof clone.error === 'object') {
      delete clone.error.message;
      if (clone.error.recovery && typeof clone.error.recovery === 'object') {
        delete clone.error.recovery.command;
      }
      if (clone.error.details && typeof clone.error.details === 'object') {
        delete clone.error.details.requestedPath;
        delete clone.error.details.workspaceRoot;
      }
    }
    return sortJsonValue(clone);
  }
  if (scenario.assertionId === 'tools-list-bootstrap') {
    return stripToolsListParityNoise(envelope);
  }
  return deepClone(envelope);
}

function readJsonArtifactHash(filePath) {
  return stableJsonHash(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function loadGeneratedArtifactHashes() {
  const hashes = {};
  for (const [key, filePath] of Object.entries(GENERATED_ARTIFACT_PATHS)) {
    hashes[key] = readJsonArtifactHash(filePath);
  }
  return hashes;
}

function buildScenarioScore(result, scenario) {
  const latencyTarget = Number(scenario.targetLatencyMs || 0);
  const latencyPass = latencyTarget > 0 ? result.durationMs <= latencyTarget : true;
  const totalChecks = Math.max(1, Number(result.totalChecks || 0));
  const passedChecks = Math.max(0, Number(result.passedChecks || 0));
  const checkRatio = passedChecks / totalChecks;
  const successScore = Math.round(checkRatio * 100);
  const latencyScore = latencyPass ? 100 : 0;
  const weighted = Math.round((successScore * 0.8) + (latencyScore * 0.2));
  return {
    latencyTargetMs: latencyTarget,
    latencyPass,
    totalChecks,
    passedChecks,
    successScore,
    latencyScore,
    weighted,
  };
}

function buildContractLock(capabilities, schemaPayload, generatedManifest) {
  const remoteCapabilities = buildCapabilitiesPayload({
    generatedAtOverride: '1970-01-01T00:00:00.000Z',
    remoteTransportActive: true,
    remoteTransportUrl: 'https://gateway.example.test/mcp',
  });
  return {
    commandDescriptorVersion: COMMAND_DESCRIPTOR_VERSION,
    generatedManifestVersion: generatedManifest.schemaVersion,
    generatedManifestCommandDescriptorVersion: generatedManifest.commandDescriptorVersion || generatedManifest.contractCommandDescriptorVersion || null,
    generatedManifestPackageVersion: generatedManifest.packageVersion || generatedManifest.contractPackageVersion || null,
    generatedManifestRegistryDigest: generatedManifest.registryDigest || null,
    registryDigest: capabilities.registryDigest,
    documentationContentHash: capabilities.documentation.contentHash,
    documentationRegistryHash: capabilities.registryDigest.documentationHash,
    schemaHash: stableJsonHash(normalizeSchemaPayloadForLock(schemaPayload)),
    capabilitiesLocalHash: stableJsonHash(normalizeCapabilitiesForLock(capabilities)),
    capabilitiesRemoteTemplateHash: stableJsonHash(normalizeCapabilitiesForLock(remoteCapabilities)),
    generatedArtifactHashes: loadGeneratedArtifactHashes(),
  };
}

function compareContractLock(actual, expected) {
  if (!expected) {
    return {
      matches: false,
      mismatches: ['missing lock file'],
    };
  }
  const mismatches = [];
  if (expected.schemaVersion !== LOCK_SCHEMA_VERSION) {
    mismatches.push(`lock schemaVersion mismatch: expected ${LOCK_SCHEMA_VERSION}, received ${expected.schemaVersion}`);
  }
  if (expected.suite !== undefined && expected.suite !== actual.suite) {
    mismatches.push(`lock suite mismatch: expected ${expected.suite}, received ${actual.suite}`);
  }
  const expectedLock = expected.contractLock && typeof expected.contractLock === 'object' ? expected.contractLock : {};
  for (const key of [
    'commandDescriptorVersion',
    'generatedManifestVersion',
    'generatedManifestCommandDescriptorVersion',
    'generatedManifestPackageVersion',
    'documentationContentHash',
    'documentationRegistryHash',
    'schemaHash',
    'capabilitiesLocalHash',
    'capabilitiesRemoteTemplateHash',
  ]) {
    if (expectedLock[key] !== actual[key]) {
      mismatches.push(`contractLock.${key} mismatch`);
    }
  }
  if (stableJsonHash(expectedLock.registryDigest || null) !== stableJsonHash(actual.registryDigest || null)) {
    mismatches.push('contractLock.registryDigest mismatch');
  }
  if (stableJsonHash(expectedLock.generatedManifestRegistryDigest || null) !== stableJsonHash(actual.generatedManifestRegistryDigest || null)) {
    mismatches.push('contractLock.generatedManifestRegistryDigest mismatch');
  }
  if (stableJsonHash(expectedLock.generatedArtifactHashes || null) !== stableJsonHash(actual.generatedArtifactHashes || null)) {
    mismatches.push('contractLock.generatedArtifactHashes mismatch');
  }
  return {
    matches: mismatches.length === 0,
    mismatches,
  };
}

function createLockDocument(suite, contractLock) {
  return {
    schemaVersion: LOCK_SCHEMA_VERSION,
    suite,
    contractLock,
  };
}

function writeSuiteLock(suite, contractLock, lockPath = defaultSuiteLockPath(suite)) {
  const resolvedPath = path.resolve(lockPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(createLockDocument(suite, contractLock), null, 2)}\n`);
  return resolvedPath;
}

function seedOperationsForScenario(scenario, env) {
  const operations = Array.isArray(scenario.seedOperations) ? scenario.seedOperations : [];
  if (!operations.length) return;
  const operationDir = String(env.PANDORA_OPERATION_DIR || '').trim();
  if (!operationDir) {
    throw new Error(`Scenario ${scenario.id} attempted to seed operations without PANDORA_OPERATION_DIR`);
  }
  for (const seedOperation of operations) {
    upsertOperation(operationDir, seedOperation, {
      now: seedOperation.updatedAt || seedOperation.createdAt || '2026-03-08T00:00:00.000Z',
    });
  }
}

function listOperationIds(env) {
  const operationDir = String(env && env.PANDORA_OPERATION_DIR || '').trim();
  if (!operationDir || !fs.existsSync(operationDir)) return [];
  return fs.readdirSync(operationDir)
    .filter((name) => name.endsWith('.json') && !name.endsWith('.checkpoints.jsonl'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort((left, right) => left.localeCompare(right));
}

function buildParitySummary(results) {
  const groups = new Map();
  for (const result of results) {
    if (!result.parityGroup || !result.parityHash) continue;
    if (!groups.has(result.parityGroup)) {
      groups.set(result.parityGroup, []);
    }
    groups.get(result.parityGroup).push(result);
  }

  const summary = [];
  for (const [groupId, groupResults] of groups.entries()) {
    const hashes = Array.from(new Set(groupResults.map((result) => result.parityHash)));
    const expectedTransports = Array.from(new Set(
      groupResults.flatMap((result) => Array.isArray(result.parityExpectedTransports) ? result.parityExpectedTransports : []),
    )).sort((left, right) => left.localeCompare(right));
    const actualTransports = Array.from(new Set(groupResults.map((result) => result.transport))).sort((left, right) => left.localeCompare(right));
    const missingTransports = expectedTransports.filter((transport) => !actualTransports.includes(transport));
    summary.push({
      groupId,
      scenarioIds: groupResults.map((result) => result.id),
      expectedTransports,
      actualTransports,
      missingTransports,
      matches: hashes.length <= 1 && missingTransports.length === 0,
      hashCount: hashes.length,
      hashes,
    });
  }

  return {
    groups: summary,
      failedGroups: summary.filter((group) => !group.matches).map((group) => group.groupId),
  };
}

function buildDimensionSummary(results) {
  const dimensions = new Map();
  for (const result of results) {
    for (const dimension of Array.isArray(result.dimensions) ? result.dimensions : []) {
      if (!dimensions.has(dimension)) {
        dimensions.set(dimension, []);
      }
      dimensions.get(dimension).push(result);
    }
  }
  const summary = {};
  for (const [dimension, entries] of dimensions.entries()) {
    const weightTotal = entries.reduce((sum, entry) => sum + entry.weight, 0);
    const passed = entries.filter((entry) => entry.passed).length;
    const latencyPassed = entries.filter((entry) => entry.score && entry.score.latencyPass).length;
    summary[dimension] = {
      scenarioCount: entries.length,
      passedCount: passed,
      failedCount: entries.length - passed,
      latencyPassRate: entries.length ? Number((latencyPassed / entries.length).toFixed(4)) : 0,
      weightedScore: weightTotal > 0
        ? Number((entries.reduce((sum, entry) => sum + (entry.score.weighted * entry.weight), 0) / weightTotal).toFixed(2))
        : 0,
    };
  }
  return summary;
}

async function executeScenario(scenario, options = {}) {
  validateScenarioManifest(scenario);
  const tempDir = createTempDir(`pandora-benchmark-${scenario.id}-`);
  const env = buildBenchmarkEnv(tempDir, options.env);
  try {
    seedOperationsForScenario(scenario, env);
    const runtimeStateBefore = {
      operationIds: listOperationIds(env),
    };
    let execution;
    if (scenario.transport === 'cli-json') {
      const result = runCli(scenario.request.args || [], { env, cwd: options.cwd });
      const failedEnvelope = result.status === 0 ? null : tryParseJsonOutput(result);
      const cliError = result.status === 0
        ? null
        : (() => {
            const error = new Error(
              (failedEnvelope && failedEnvelope.error && failedEnvelope.error.message)
              || result.output
              || `CLI exited ${result.status}`,
            );
            if (failedEnvelope && failedEnvelope.error && typeof failedEnvelope.error.code === 'string') {
              error.code = failedEnvelope.error.code;
            }
            if (failedEnvelope) {
              error.envelope = failedEnvelope;
            }
            return error;
          })();
      execution = {
        ok: result.status === 0,
        durationMs: result.durationMs,
        envelope: result.status === 0 ? parseJsonOutput(result, scenario.id) : failedEnvelope,
        error: cliError,
      };
    } else if (scenario.transport === 'mcp-stdio') {
      execution = await withLocalClient(env, async (client) => {
        if (scenario.request.mode === 'listTools') {
          const startedAt = Date.now();
          const tools = await client.listTools();
          return {
            ok: true,
            envelope: {
              ok: true,
              command: 'mcp.tools.list',
              data: { tools },
            },
            durationMs: Date.now() - startedAt,
            error: null,
          };
        }
        return callMcpTool(client, scenario.request.tool, scenario.request.arguments);
      });
    } else if (scenario.transport === 'mcp-http') {
      execution = await withRemoteClient(env, scenario.request.authScopes || ['capabilities:read'], async (client) => {
        if (scenario.request.mode === 'listTools') {
          const startedAt = Date.now();
          const tools = await client.listTools();
          return {
            ok: true,
            envelope: {
              ok: true,
              command: 'mcp.tools.list',
              data: { tools },
            },
            durationMs: Date.now() - startedAt,
            error: null,
          };
        }
        return callMcpTool(client, scenario.request.tool, scenario.request.arguments);
      });
    } else {
      throw new Error(`Unsupported benchmark transport: ${scenario.transport}`);
    }
    const runtimeStateAfter = {
      operationIds: listOperationIds(env),
    };

    let passed = false;
    let failure = null;
    let checks = [];
    try {
      checks = getAssertion(scenario.assertionId)(execution, scenario) || [];
      passed = true;
    } catch (error) {
      failure = error;
      checks = Array.isArray(error && error.checks) ? error.checks : [];
    }

    const passedChecks = checks.filter((check) => check && check.passed).length;
    const totalChecks = checks.length || 1;
    const score = buildScenarioScore({ passed, durationMs: execution.durationMs, passedChecks, totalChecks }, scenario);
    const normalizedParityEnvelope = normalizeParityEnvelope(
      scenario,
      execution.envelope || getErrorEnvelope(execution.error),
    );
    return {
      id: scenario.id,
      title: scenario.title,
      description: scenario.description,
      transport: scenario.transport,
      dimensions: Array.isArray(scenario.dimensions) ? scenario.dimensions : [],
      weight: Number(scenario.weight || 0),
      passed,
      durationMs: execution.durationMs,
      checks,
      score,
      parityGroup: scenario.parityGroup || null,
      parityExpectedTransports: Array.isArray(scenario.parityExpectedTransports) ? scenario.parityExpectedTransports.slice() : [],
      parityHash: normalizedParityEnvelope ? stableJsonHash(normalizedParityEnvelope) : null,
      failure: failure ? { message: String(failure.message || failure) } : null,
      runtimeState: {
        before: runtimeStateBefore,
        after: runtimeStateAfter,
      },
    };
  } finally {
    removeDir(tempDir);
  }
}

async function runBenchmarkSuite(options = {}) {
  const suite = options.suite || DEFAULT_SUITE;
  const scenarios = loadScenarioSuite(suite);
  const results = [];
  for (const scenario of scenarios) {
    results.push(await executeScenario(scenario, options));
  }
  const totalWeight = results.reduce((sum, result) => sum + result.weight, 0);
  const weightedScoreBase = totalWeight > 0
    ? Number((results.reduce((sum, result) => sum + (result.score.weighted * result.weight), 0) / totalWeight).toFixed(2))
    : 0;
  const passedCount = results.filter((result) => result.passed).length;
  const latencyPassCount = results.filter((result) => result.score.latencyPass).length;
  const capabilities = buildCapabilitiesPayload({ generatedAtOverride: '1970-01-01T00:00:00.000Z' });
  const schemaPayload = buildSchemaPayload();
  const generatedManifest = loadGeneratedManifest();
  const contractLock = buildContractLock(capabilities, schemaPayload, generatedManifest);
  const parity = buildParitySummary(results);
  const expectedLock = loadSuiteLock(suite);
  const lockStatus = compareContractLock({ suite, ...contractLock }, expectedLock);
  const weightedScore = parity.failedGroups.length > 0 ? 0 : weightedScoreBase;
  const dimensions = buildDimensionSummary(results);
  const overallPass =
    passedCount === results.length
    && latencyPassCount === results.length
    && parity.failedGroups.length === 0
    && lockStatus.matches;

  return {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    suite,
    runtime: {
      packageVersion: pkg.version,
    },
    summary: {
      scenarioCount: results.length,
      passedCount,
      failedCount: results.length - passedCount,
      successRate: results.length ? Number((passedCount / results.length).toFixed(4)) : 0,
      latencyPassRate: results.length ? Number((latencyPassCount / results.length).toFixed(4)) : 0,
      weightedScoreBase: weightedScoreBase,
      weightedScore,
      parityGroupCount: parity.groups.length,
      failedParityGroupCount: parity.failedGroups.length,
      overallPass,
    },
    dimensions,
    contractLock,
    expectedContractLockPath: defaultSuiteLockId(suite),
    contractLockMatchesExpected: lockStatus.matches,
    contractLockMismatches: lockStatus.mismatches,
    parity,
    scenarios: results,
  };
}

module.exports = {
  SCENARIO_SCHEMA_VERSION,
  LOCK_SCHEMA_VERSION,
  DEFAULT_SUITE,
  SUITE_EXPECTATIONS,
  loadScenarioSuite,
  loadSuiteLock,
  defaultSuiteLockPath,
  getSuiteExpectation,
  validateScenarioManifest,
  executeScenario,
  runBenchmarkSuite,
  writeSuiteLock,
  createLockDocument,
  buildContractLock,
  normalizeBenchmarkReportForFreshness,
};
