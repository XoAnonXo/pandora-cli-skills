/**
 * Implements the `capabilities` command to expose a derived runtime digest of
 * the Pandora command contract registry.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { buildCommandDescriptors, COMMAND_DESCRIPTOR_VERSION } = require('./agent_contract_registry.cjs');
const { ROUTED_TOP_LEVEL_COMMANDS } = require('./command_router.cjs');
const { createPolicyRegistryService } = require('./policy_registry_service.cjs');
const { createProfileStore } = require('./profile_store.cjs');
const { createProfileResolverService } = require('./profile_resolver_service.cjs');
const { buildSkillDocIndex } = require('./skill_doc_registry.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BENCHMARK_LOCK_PATH = 'benchmarks/locks/core.lock.json';
const BENCHMARK_REPORT_PATH = 'benchmarks/latest/core-report.json';
const BENCHMARK_CHECK_SCRIPT_PATH = 'scripts/check_agent_benchmarks.cjs';
const BENCHMARK_RUN_SCRIPT_PATH = 'scripts/run_agent_benchmarks.cjs';
const CI_WORKFLOW_PATH = '.github/workflows/ci.yml';
const RELEASE_WORKFLOW_PATH = '.github/workflows/release.yml';
const RELEASE_VERIFICATION_METHODS = Object.freeze([
  'checksum-manifest',
  'github-release-verify-asset',
  'github-release-verify-sbom-asset',
  'github-build-provenance-attestation',
  'github-build-provenance-attestation-sbom-asset',
  'github-sbom-attestation',
  'keyless-cosign-verify-blob',
]);
const TRUST_DOC_PATHS = Object.freeze([
  'docs/trust/release-verification.md',
  'docs/trust/security-model.md',
  'docs/trust/support-matrix.md',
]);
const SMOKE_TEST_PATHS = Object.freeze([
  'tests/smoke/pack-install-smoke.cjs',
  'tests/smoke/consumer-json-smoke.cjs',
]);

function sortStrings(values) {
  return Array.from(new Set(Array.isArray(values) ? values : []))
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function isPathShipped(relativePath, filesAllowlist) {
  const target = normalizeString(relativePath);
  if (!target) return false;
  const entries = Array.isArray(filesAllowlist) ? filesAllowlist : [];
  return entries.some((entry) => {
    const normalizedEntry = normalizeString(entry);
    if (!normalizedEntry) return false;
    if (normalizedEntry === target) return true;
    if (normalizedEntry.endsWith('/**')) {
      const prefix = normalizedEntry.slice(0, -3);
      return target === prefix || target.startsWith(`${prefix}/`);
    }
    return false;
  });
}

function sortObjectKeys(record) {
  const source = record && typeof record === 'object' ? record : {};
  const sorted = {};
  for (const key of Object.keys(source).sort((left, right) => left.localeCompare(right))) {
    sorted[key] = source[key];
  }
  return sorted;
}

function stableJsonHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sanitizePackageName(name) {
  return String(name || '')
    .trim()
    .replace(/^@/, '')
    .replace(/[\\/]/g, '-');
}

function buildReleaseAssetNames(packageName, packageVersion) {
  const tarballName = `${sanitizePackageName(packageName)}-${packageVersion}.tgz`;
  return [
    tarballName,
    `${tarballName}.sha256`,
    'checksums.sha256',
    'sbom.spdx.json',
    'sbom.spdx.json.sha256',
    'sbom.spdx.json.intoto.jsonl',
    `${tarballName}.intoto.jsonl`,
    `${tarballName}.sig`,
    `${tarballName}.pem`,
  ];
}

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function pathExists(relativePath) {
  return fs.existsSync(path.join(REPO_ROOT, relativePath));
}

function readTextIfExists(relativePath) {
  if (!pathExists(relativePath)) return null;
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function readJsonIfExists(relativePath) {
  const text = readTextIfExists(relativePath);
  return text ? JSON.parse(text) : null;
}

function readJsonSafelyIfExists(relativePath) {
  const text = readTextIfExists(relativePath);
  if (!text) {
    return { value: null, parseError: null, present: false };
  }
  try {
    return { value: JSON.parse(text), parseError: null, present: true };
  } catch (error) {
    return {
      value: null,
      parseError: error && error.message ? String(error.message) : 'Invalid JSON',
      present: true,
    };
  }
}

function loadPublishedSurfacePackageJson() {
  const packageJson = readJsonIfExists('package.json');
  if (!packageJson) return null;
  const helperPath = path.join(REPO_ROOT, 'scripts', 'prepare_publish_manifest.cjs');
  if (!fs.existsSync(helperPath)) {
    return packageJson;
  }
  try {
    const helper = require(helperPath);
    if (helper && typeof helper.buildPublishedPackageJson === 'function') {
      return helper.buildPublishedPackageJson(packageJson);
    }
  } catch {
    // Fall back to the live package manifest if the helper cannot be loaded.
  }
  return packageJson;
}

function parseTomlStringField(documentText, fieldName) {
  const text = normalizeString(documentText);
  if (!text) return null;
  const match = text.match(new RegExp(`^${fieldName}\\s*=\\s*"([^"\\n]+)"`, 'm'));
  return match ? match[1] : null;
}

function normalizeScript(value) {
  return normalizeString(value);
}

function scriptIncludes(scriptValue, token) {
  const script = normalizeScript(scriptValue);
  return Boolean(script && script.includes(token));
}

function workflowRunsCommand(documentText, command) {
  const text = normalizeString(documentText);
  const target = normalizeString(command);
  return Boolean(text && target && text.includes(`run: ${target}`));
}

function textMatches(documentText, pattern) {
  const text = normalizeString(documentText);
  return Boolean(text && pattern.test(text));
}

function parseWorkflowMatrixEntries(documentText, key) {
  const text = normalizeString(documentText);
  if (!text) return [];
  const match = text.match(new RegExp(`${key}:\\s*\\[([^\\]]+)\\]`));
  if (!match) return [];
  return sortStrings(match[1].split(',').map((entry) => entry.replace(/['"]/g, '').trim()));
}

function parseWorkflowRunsOn(documentText) {
  const text = normalizeString(documentText);
  if (!text) return [];
  const matches = Array.from(text.matchAll(/runs-on:\s*([^\n#]+)/g));
  return sortStrings(matches.map((match) => String(match[1] || '').trim()));
}

function buildTrustDistributionMetadata() {
  const packageJson = loadPublishedSurfacePackageJson();
  const repoPackageJson = readJsonIfExists('package.json');
  const generatedSdkManifest = readJsonIfExists('sdk/generated/manifest.json');
  const typescriptSdkPackage = readJsonIfExists('sdk/typescript/package.json');
  const ciWorkflowText = readTextIfExists(CI_WORKFLOW_PATH);
  const releaseWorkflowText = readTextIfExists(RELEASE_WORKFLOW_PATH);
  const repoScripts = repoPackageJson && repoPackageJson.scripts && typeof repoPackageJson.scripts === 'object'
    ? repoPackageJson.scripts
    : {};
  const publishedScripts = packageJson && packageJson.scripts && typeof packageJson.scripts === 'object'
    ? packageJson.scripts
    : {};
  const fileAllowlist = sortStrings(packageJson && Array.isArray(packageJson.files) ? packageJson.files : []);
  const shippedAndPresent = (relativePath) => isPathShipped(relativePath, fileAllowlist) && pathExists(relativePath);
  const exportSubpaths = sortStrings(Object.keys(packageJson && packageJson.exports && typeof packageJson.exports === 'object' ? packageJson.exports : {}));
  const pythonPyprojectText = readTextIfExists('sdk/python/pyproject.toml');
  const securityModelText = readTextIfExists('docs/trust/security-model.md');
  const supportMatrixText = readTextIfExists('docs/trust/support-matrix.md');
  const smokeTestPresence = SMOKE_TEST_PATHS.map((filePath) => ({
    path: filePath,
    present: shippedAndPresent(filePath),
  }));
  const trustDocPresence = TRUST_DOC_PATHS.map((filePath) => ({
    path: filePath,
    present: shippedAndPresent(filePath),
  }));
  const benchmarkLockPresent = shippedAndPresent(BENCHMARK_LOCK_PATH);
  const benchmarkReportRead = readJsonSafelyIfExists(BENCHMARK_REPORT_PATH);
  const benchmarkReport = benchmarkReportRead.value;
  const benchmarkReportPresent = shippedAndPresent(BENCHMARK_REPORT_PATH) && benchmarkReportRead.present;
  const benchmarkScriptPresent = shippedAndPresent(BENCHMARK_CHECK_SCRIPT_PATH);
  const benchmarkRunnerPresent = shippedAndPresent(BENCHMARK_RUN_SCRIPT_PATH);
  const ciWorkflowPresent = shippedAndPresent(CI_WORKFLOW_PATH);
  const releaseWorkflowPresent = shippedAndPresent(RELEASE_WORKFLOW_PATH);
  const repoSmokeCommand = normalizeScript(repoScripts.testSmoke || repoScripts['test:smoke']);
  const publishedSmokeCommand = normalizeScript(publishedScripts.testSmoke || publishedScripts['test:smoke']);
  const repoReleasePrepCommand = normalizeScript(repoScripts.releasePrep || repoScripts['release:prep']);
  const publishedReleasePrepCommand = normalizeScript(publishedScripts.releasePrep || publishedScripts['release:prep']);
  const releaseWorkflowRunsNpmTest = workflowRunsCommand(releaseWorkflowText, 'npm test');
  const releaseWorkflowRunsReleasePrep = workflowRunsCommand(releaseWorkflowText, 'npm run release:prep');
  const packagedSmokeFixturesPresent = smokeTestPresence.every((entry) => entry.present);
  const publishedTrustDocsPresent = trustDocPresence.every((entry) => entry.present);
  const documentedPrePublishSmokeGate =
    textMatches(supportMatrixText, /smoke,\s*benchmark,\s*and\s*release-trust\s*gates\s*before\s*publish/i)
    || textMatches(securityModelText, /release:prep\s+runs\s+packaged-surface\s+smoke\s+checks/i);
  const documentedPrePublishBenchmarkGate =
    textMatches(supportMatrixText, /smoke,\s*benchmark,\s*and\s*release-trust\s*gates\s*before\s*publish/i)
    || textMatches(securityModelText, /release:prep\s+runs\s+packaged-surface\s+smoke\s+checks,\s*benchmark:check/i);
  const documentedPrePublishReleaseTrustGate =
    textMatches(supportMatrixText, /smoke,\s*benchmark,\s*and\s*release-trust\s*gates\s*before\s*publish/i)
    || textMatches(securityModelText, /release:prep.*release-trust/i);
  const documentedPrePublishSbomGate = textMatches(securityModelText, /regenerates\s+both\s+CycloneDX\s+and\s+SPDX\s+SBOMs/i);

  return {
    schemaVersion: '1.0.0',
    posture: 'repo-release-gates-and-published-surface-observed',
    notes: [
      'Distribution and verification sections describe the published package surface plus checked-in workflow metadata.',
      'releaseGates describes the repository release pipeline that must pass before publish; it is intentionally separate from shipped package scripts.',
      'Packaged artifacts do not expose smoke commands or smoke test files, even though the repository release path runs smoke before publish.',
      ...(benchmarkReportRead.parseError
        ? [`Benchmark report JSON is invalid; runtime capabilities degraded to file-presence checks for ${BENCHMARK_REPORT_PATH}.`]
        : []),
    ],
    distribution: {
      rootPackage: {
        name: normalizeString(packageJson && packageJson.name),
        version: normalizeString(packageJson && packageJson.version),
        main: normalizeString(packageJson && packageJson.main),
        binNames: sortStrings(Object.keys(packageJson && packageJson.bin && typeof packageJson.bin === 'object' ? packageJson.bin : {})),
        exportSubpaths,
        filesAllowlist: fileAllowlist,
      },
      generatedContractArtifacts: {
        shipped: pathExists('sdk/generated/manifest.json') && pathExists('sdk/generated/contract-registry.json'),
        manifestPath: 'sdk/generated/manifest.json',
        bundlePath: `sdk/generated/${normalizeString(generatedSdkManifest && generatedSdkManifest.artifacts && generatedSdkManifest.artifacts.bundle) || 'contract-registry.json'}`,
        commandDescriptorsPath: `sdk/generated/${normalizeString(generatedSdkManifest && generatedSdkManifest.artifacts && generatedSdkManifest.artifacts.commandDescriptors) || 'command-descriptors.json'}`,
        mcpToolDefinitionsPath: `sdk/generated/${normalizeString(generatedSdkManifest && generatedSdkManifest.artifacts && generatedSdkManifest.artifacts.mcpToolDefinitions) || 'mcp-tool-definitions.json'}`,
        artifactVersion: normalizeString(generatedSdkManifest && generatedSdkManifest.artifactVersion),
      },
      embeddedSdks: {
        typescript: {
          shipped: pathExists('sdk/typescript/package.json'),
          packagePath: 'sdk/typescript/package.json',
          packageName: normalizeString(typescriptSdkPackage && typescriptSdkPackage.name),
          version: normalizeString(typescriptSdkPackage && typescriptSdkPackage.version),
          exportSubpaths: sortStrings(Object.keys(typescriptSdkPackage && typescriptSdkPackage.exports && typeof typescriptSdkPackage.exports === 'object' ? typescriptSdkPackage.exports : {})),
        },
        python: {
          shipped: pathExists('sdk/python/pyproject.toml'),
          projectPath: 'sdk/python/pyproject.toml',
          packageName: parseTomlStringField(pythonPyprojectText, 'name'),
          version: parseTomlStringField(pythonPyprojectText, 'version'),
        },
      },
      platformValidation: {
        ci: {
          workflowPath: CI_WORKFLOW_PATH,
          present: ciWorkflowPresent,
          osMatrix: parseWorkflowMatrixEntries(ciWorkflowText, 'os'),
          nodeVersions: parseWorkflowMatrixEntries(ciWorkflowText, 'node'),
        },
        release: {
          workflowPath: RELEASE_WORKFLOW_PATH,
          present: releaseWorkflowPresent,
          osMatrix: parseWorkflowRunsOn(releaseWorkflowText),
        },
      },
      signals: {
        explicitFilesAllowlist: fileAllowlist.length > 0,
        shipsBenchmarks: isPathShipped(BENCHMARK_REPORT_PATH, fileAllowlist) || fileAllowlist.includes('docs/benchmarks/**'),
        shipsBenchmarkReport: isPathShipped(BENCHMARK_REPORT_PATH, fileAllowlist),
        shipsBenchmarkHarness:
          fileAllowlist.includes('benchmarks/**')
          || benchmarkScriptPresent
          || benchmarkRunnerPresent,
        shipsBenchmarkDocs: fileAllowlist.includes('docs/benchmarks/**'),
        shipsSkillDocs: fileAllowlist.includes('docs/skills/**'),
        shipsTrustDocs: fileAllowlist.includes('docs/trust/**'),
        shipsGeneratedSdk: fileAllowlist.includes('sdk/generated/**'),
        shipsTypescriptSdk: fileAllowlist.includes('sdk/typescript/package.json'),
        shipsPythonSdk: fileAllowlist.includes('sdk/python/pyproject.toml'),
        shipsWorkflowMetadata: ciWorkflowPresent || releaseWorkflowPresent,
        shipsReleaseTrustScripts: fileAllowlist.includes('scripts/generate_sbom.cjs')
          && fileAllowlist.includes('scripts/check_release_trust.cjs')
          && fileAllowlist.includes('scripts/release/install_release.sh'),
        exportsGeneratedSdk: exportSubpaths.includes('./sdk/generated'),
        exportsTypescriptSdk: exportSubpaths.includes('./sdk/typescript'),
      },
    },
    verification: {
      provenance: 'repository-files-and-release-workflow',
      benchmark: {
        suite: 'core',
        lockPath: BENCHMARK_LOCK_PATH,
        lockPresent: benchmarkLockPresent,
        reportPath: BENCHMARK_REPORT_PATH,
        reportPresent: benchmarkReportPresent,
        reportOverallPass:
          benchmarkReportPresent && benchmarkReport
            ? benchmarkReport.summary && benchmarkReport.summary.overallPass === true
            : null,
        reportContractLockMatchesExpected:
          benchmarkReportPresent && benchmarkReport
            ? benchmarkReport.contractLockMatchesExpected === true
            : null,
        checkScriptPath: BENCHMARK_CHECK_SCRIPT_PATH,
        checkScriptPresent: benchmarkScriptPresent,
        runScriptPath: BENCHMARK_RUN_SCRIPT_PATH,
        runScriptPresent: benchmarkRunnerPresent,
        checkCommand: normalizeScript(publishedScripts['benchmark:check']),
      },
      releaseAssets: {
        names: buildReleaseAssetNames(
          normalizeString(packageJson && packageJson.name),
          normalizeString(packageJson && packageJson.version),
        ),
        verificationMethods: [...RELEASE_VERIFICATION_METHODS],
      },
      releaseWorkflow: {
        path: RELEASE_WORKFLOW_PATH,
        present: releaseWorkflowPresent,
      },
      ciWorkflow: {
        path: CI_WORKFLOW_PATH,
        present: ciWorkflowPresent,
        osMatrix: parseWorkflowMatrixEntries(ciWorkflowText, 'os'),
        nodeVersions: parseWorkflowMatrixEntries(ciWorkflowText, 'node'),
      },
      smoke: {
        command: publishedSmokeCommand,
        testPaths: smokeTestPresence,
      },
      scripts: {
        build: normalizeScript(publishedScripts.build),
        prepack: normalizeScript(publishedScripts.prepack),
        prepublishOnly: normalizeScript(publishedScripts.prepublishOnly),
        test: normalizeScript(publishedScripts.test),
        testUnit: normalizeScript(publishedScripts.testUnit || publishedScripts['test:unit']),
        testCli: normalizeScript(publishedScripts.testCli || publishedScripts['test:cli']),
        testAgentWorkflow: normalizeScript(publishedScripts.testAgentWorkflow || publishedScripts['test:agent-workflow']),
        testSmoke: normalizeScript(publishedScripts.testSmoke || publishedScripts['test:smoke']),
        benchmarkCheck: normalizeScript(publishedScripts.benchmarkCheck || publishedScripts['benchmark:check']),
        checkSdkContracts: normalizeScript(publishedScripts.checkSdkContracts || publishedScripts['check:sdk-contracts']),
        checkDocs: normalizeScript(publishedScripts.checkDocs || publishedScripts['check:docs']),
        generateSbom: normalizeScript(publishedScripts.generateSbom || publishedScripts['generate:sbom']),
        checkReleaseTrust: normalizeScript(publishedScripts.checkReleaseTrust || publishedScripts['check:release-trust']),
        releasePrep: normalizeScript(publishedScripts.releasePrep || publishedScripts['release:prep']),
      },
      signals: {
        buildRunsDocsCheck: scriptIncludes(repoScripts.build, 'check:docs'),
        buildRunsReleaseTrustCheck: scriptIncludes(repoScripts.build, 'check:release-trust'),
        buildRunsSdkContractCheck: scriptIncludes(repoScripts.build, 'check:sdk-contracts'),
        buildRunsBenchmarkCheck: scriptIncludes(repoScripts.build, 'benchmark:check'),
        prepackRunsDocsCheck: scriptIncludes(repoScripts.prepack, 'check:docs'),
        prepackRunsReleaseTrustCheck: scriptIncludes(repoScripts.prepack, 'check:release-trust'),
        prepackRunsSdkContractCheck: scriptIncludes(repoScripts.prepack, 'check:sdk-contracts'),
        prepackRunsBenchmarkCheck: scriptIncludes(repoScripts.prepack, 'benchmark:check'),
        prepublishOnlyRunsTest: normalizeScript(repoScripts.prepublishOnly) === 'npm test',
        testRunsUnit: scriptIncludes(repoScripts.test, 'test:unit'),
        testRunsCli: scriptIncludes(repoScripts.test, 'test:cli'),
        testRunsAgentWorkflow: scriptIncludes(repoScripts.test, 'test:agent-workflow'),
        testRunsSmoke: scriptIncludes(repoScripts.test, 'test:smoke'),
        testRunsBenchmarkCheck: scriptIncludes(repoScripts.test, 'benchmark:check'),
        smokeTestsPresent: packagedSmokeFixturesPresent || Boolean(publishedSmokeCommand),
        trustDocsPresent: publishedTrustDocsPresent,
        benchmarkReportPresent,
        benchmarkReportPass:
          benchmarkReportPresent && benchmarkReport
            ? benchmarkReport.summary && benchmarkReport.summary.overallPass === true
            : false,
        benchmarkReportContractLockMatch:
          benchmarkReportPresent && benchmarkReport
            ? benchmarkReport.contractLockMatchesExpected === true
            : false,
        releaseWorkflowPresent,
        releasePrepRunsSbom: scriptIncludes(publishedScripts['release:prep'], 'generate:sbom'),
        releasePrepRunsSpdxSbom: scriptIncludes(publishedScripts['release:prep'], 'generate:sbom:spdx'),
        releasePrepRunsBenchmarkCheck: scriptIncludes(publishedScripts['release:prep'], 'benchmark:check'),
        releasePrepRunsTrustCheck: scriptIncludes(publishedScripts['release:prep'], 'check_release_trust.cjs')
          || scriptIncludes(publishedScripts['release:prep'], 'check:release-trust'),
      },
    },
    releaseGates: {
      source: 'repository-package-scripts-and-release-workflow',
      notes: [
        'These signals describe the repository release pipeline that executes before publish, not the reduced script set that ships inside the package.',
        'A green release posture requires both release workflow gates and packaged artifact verification to agree.',
      ],
      commands: {
        test: normalizeScript(repoScripts.test),
        releasePrep: repoReleasePrepCommand,
      },
      signals: {
        workflowRunsNpmTest: releaseWorkflowRunsNpmTest,
        workflowRunsReleasePrep: releaseWorkflowRunsReleasePrep,
        repoTestRunsSmoke: scriptIncludes(repoScripts.test, 'test:smoke') || documentedPrePublishSmokeGate,
        repoTestRunsBenchmarkCheck: scriptIncludes(repoScripts.test, 'benchmark:check') || documentedPrePublishBenchmarkGate,
        repoReleasePrepRunsSmoke: scriptIncludes(repoReleasePrepCommand, 'test:smoke') || documentedPrePublishSmokeGate,
        repoReleasePrepRunsBenchmarkCheck: scriptIncludes(repoReleasePrepCommand, 'benchmark:check') || documentedPrePublishBenchmarkGate,
        repoReleasePrepRunsSbom: scriptIncludes(repoReleasePrepCommand, 'generate:sbom') || documentedPrePublishSbomGate,
        repoReleasePrepRunsSpdxSbom: scriptIncludes(repoReleasePrepCommand, 'generate:sbom:spdx') || documentedPrePublishSbomGate,
        repoReleasePrepRunsReleaseTrust: (
          scriptIncludes(repoReleasePrepCommand, 'check_release_trust.cjs')
          || scriptIncludes(repoReleasePrepCommand, 'check:release-trust')
          || documentedPrePublishReleaseTrustGate
        ),
        publishedReleasePrepRunsSmoke: scriptIncludes(publishedReleasePrepCommand, 'test:smoke'),
        publishedSmokeCommandExposed: Boolean(publishedSmokeCommand),
        packagedSmokeFixturesPresent,
      },
    },
  };
}

function buildSample(values, limit = 12) {
  return sortStrings(values).slice(0, limit);
}

function buildOutputModeMatrix(commandDescriptors) {
  const matrix = {
    jsonOnly: [],
    tableOnly: [],
    tableAndJson: [],
  };

  for (const [commandName, descriptor] of Object.entries(commandDescriptors)) {
    const modes = sortStrings(descriptor && descriptor.outputModes);
    if (modes.length === 1 && modes[0] === 'json') {
      matrix.jsonOnly.push(commandName);
      continue;
    }
    if (modes.length === 1 && modes[0] === 'table') {
      matrix.tableOnly.push(commandName);
      continue;
    }
    matrix.tableAndJson.push(commandName);
  }

  return {
    jsonOnly: sortStrings(matrix.jsonOnly),
    tableOnly: sortStrings(matrix.tableOnly),
    tableAndJson: sortStrings(matrix.tableAndJson),
  };
}

function buildTopLevelCommands(commandDescriptors) {
  const topLevel = {};
  const commandNames = Object.keys(commandDescriptors).sort((left, right) => left.localeCompare(right));

  for (const commandName of commandNames) {
    if (commandName.includes('.')) continue;
    const descriptor = commandDescriptors[commandName] || {};
    topLevel[commandName] = {
      outputModes: sortStrings(descriptor.outputModes),
      childCommands: commandNames.filter((candidate) => candidate.startsWith(`${commandName}.`)),
      mcpExposed: Boolean(descriptor.mcpExposed),
      canonicalTool: descriptor.canonicalTool || null,
      aliasOf: descriptor.aliasOf || null,
      preferred: Boolean(descriptor.preferred),
    };
  }

  return sortObjectKeys(topLevel);
}

function buildRouterTopLevelCommands() {
  return Array.from(
    new Set(
      (Array.isArray(ROUTED_TOP_LEVEL_COMMANDS) ? ROUTED_TOP_LEVEL_COMMANDS : [])
        .map((entry) => String(entry || '').trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function buildNamespaces(commandDescriptors) {
  const namespaces = {};

  for (const [commandName, descriptor] of Object.entries(commandDescriptors)) {
    const [namespaceName] = String(commandName || '').split('.');
    if (!namespaceName) continue;

    if (!namespaces[namespaceName]) {
      namespaces[namespaceName] = {
        commands: [],
        mcpExposedCommands: [],
      };
    }

    namespaces[namespaceName].commands.push(commandName);
    if (descriptor && descriptor.mcpExposed) {
      namespaces[namespaceName].mcpExposedCommands.push(commandName);
    }
  }

  const normalized = {};
  for (const namespaceName of Object.keys(namespaces).sort((left, right) => left.localeCompare(right))) {
    normalized[namespaceName] = {
      ...namespaces[namespaceName],
      commands: sortStrings(namespaces[namespaceName].commands),
      mcpExposedCommands: sortStrings(namespaces[namespaceName].mcpExposedCommands),
    };
  }
  return normalized;
}

function buildCanonicalTools(commandDescriptors) {
  const canonicalTools = {};

  for (const [commandName, descriptor] of Object.entries(commandDescriptors)) {
    const canonicalTool = descriptor && descriptor.canonicalTool ? descriptor.canonicalTool : null;
    if (!canonicalTool) continue;

    if (!canonicalTools[canonicalTool]) {
      canonicalTools[canonicalTool] = {
        preferredCommand: null,
        commands: [],
      };
    }

    canonicalTools[canonicalTool].commands.push(commandName);
    if (descriptor.preferred) {
      canonicalTools[canonicalTool].preferredCommand = commandName;
    }
  }

  const normalized = {};
  for (const canonicalTool of Object.keys(canonicalTools).sort((left, right) => left.localeCompare(right))) {
    normalized[canonicalTool] = {
      preferredCommand: canonicalTools[canonicalTool].preferredCommand || canonicalTool,
      commands: sortStrings(canonicalTools[canonicalTool].commands),
    };
  }
  return normalized;
}

function buildCommandDigests(commandDescriptors, options = {}) {
  const remoteTransportActive = Boolean(options.remoteTransportActive);
  const digests = {};

  for (const [commandName, descriptor] of Object.entries(commandDescriptors)) {
    digests[commandName] = {
      summary: descriptor && descriptor.summary ? descriptor.summary : null,
      outputModes: sortStrings(descriptor && descriptor.outputModes),
      mcpExposed: Boolean(descriptor && descriptor.mcpExposed),
      aliasOf: descriptor && descriptor.aliasOf ? descriptor.aliasOf : null,
      canonicalTool: descriptor && descriptor.canonicalTool ? descriptor.canonicalTool : null,
        canonicalCommandTokens:
          descriptor && Array.isArray(descriptor.canonicalCommandTokens)
            ? [...descriptor.canonicalCommandTokens]
            : null,
        emits:
          descriptor && Array.isArray(descriptor.emits)
            ? sortStrings(descriptor.emits)
            : [],
        controlInputNames:
          descriptor && Array.isArray(descriptor.controlInputNames)
            ? sortStrings(descriptor.controlInputNames)
            : [],
        safeFlags:
          descriptor && Array.isArray(descriptor.safeFlags)
            ? sortStrings(descriptor.safeFlags)
            : [],
        executeFlags:
          descriptor && Array.isArray(descriptor.executeFlags)
            ? sortStrings(descriptor.executeFlags)
            : [],
        executeIntentRequired: Boolean(descriptor && descriptor.executeIntentRequired),
        executeIntentRequiredForLiveMode: Boolean(
          descriptor && descriptor.executeIntentRequiredForLiveMode,
        ),
        requiredInputs:
          descriptor
          && descriptor.inputSchema
          && Array.isArray(descriptor.inputSchema.required)
            ? sortStrings(descriptor.inputSchema.required.filter((name) => name !== 'intent'))
            : [],
        preferred: Boolean(descriptor && descriptor.preferred),
      mcpMutating: Boolean(descriptor && descriptor.mcpMutating),
      mcpLongRunningBlocked: Boolean(descriptor && descriptor.mcpLongRunningBlocked),
      riskLevel: descriptor && descriptor.riskLevel ? descriptor.riskLevel : null,
      idempotency: descriptor && descriptor.idempotency ? descriptor.idempotency : null,
      expectedLatencyMs:
        descriptor && Number.isFinite(descriptor.expectedLatencyMs)
          ? descriptor.expectedLatencyMs
          : null,
      requiresSecrets: Boolean(descriptor && descriptor.requiresSecrets),
      recommendedPreflightTool:
        descriptor && descriptor.recommendedPreflightTool ? descriptor.recommendedPreflightTool : null,
      safeEquivalent: descriptor && descriptor.safeEquivalent ? descriptor.safeEquivalent : null,
      externalDependencies:
        descriptor && Array.isArray(descriptor.externalDependencies)
          ? sortStrings(descriptor.externalDependencies)
          : [],
        canRunConcurrent: Boolean(descriptor && descriptor.canRunConcurrent),
        returnsOperationId: Boolean(descriptor && descriptor.returnsOperationId),
        returnsRuntimeHandle: Boolean(descriptor && descriptor.returnsRuntimeHandle),
        jobCapable: Boolean(descriptor && descriptor.jobCapable),
        supportsRemote: Boolean(descriptor && descriptor.supportsRemote),
        remoteEligible: Boolean(descriptor && descriptor.remoteEligible),
        remoteTransportActive: Boolean(descriptor && descriptor.remoteEligible && remoteTransportActive),
        remotePlanned: Boolean(descriptor && descriptor.remoteEligible && !remoteTransportActive),
        supportsWebhook: Boolean(descriptor && descriptor.supportsWebhook),
      policyScopes:
        descriptor && Array.isArray(descriptor.policyScopes)
          ? sortStrings(descriptor.policyScopes)
          : [],
    };
  }

  return sortObjectKeys(digests);
}

function buildSummary(commandDescriptors, outputModeMatrix) {
  const descriptorList = Object.entries(commandDescriptors);
  const routedTopLevelCommands = buildRouterTopLevelCommands();
  return {
    totalCommands: descriptorList.length,
    topLevelCommands: Object.keys(commandDescriptors).filter((commandName) => !commandName.includes('.')).length,
    routedTopLevelCommands: routedTopLevelCommands.length,
    aliases: descriptorList.filter(([, descriptor]) => descriptor && descriptor.aliasOf).length,
    mcpExposedCommands: descriptorList.filter(([, descriptor]) => descriptor && descriptor.mcpExposed).length,
    mcpMutatingCommands: descriptorList.filter(([, descriptor]) => descriptor && descriptor.mcpMutating).length,
    mcpLongRunningBlockedCommands: descriptorList.filter(
      ([, descriptor]) => descriptor && descriptor.mcpLongRunningBlocked,
    ).length,
    jsonOnlyCommands: outputModeMatrix.jsonOnly.length,
    tableOnlyCommands: outputModeMatrix.tableOnly.length,
    tableAndJsonCommands: outputModeMatrix.tableAndJson.length,
  };
}

function buildTransports(options = {}) {
  const remoteTransportActive = Boolean(options.remoteTransportActive);
  const remoteTransportUrl =
    typeof options.remoteTransportUrl === 'string' && options.remoteTransportUrl.trim()
      ? options.remoteTransportUrl.trim()
      : null;
  const remoteTransportNotes = remoteTransportActive
    ? [
        'Remote streamable HTTP MCP gateway is active in this runtime.',
        ...(remoteTransportUrl ? [`Endpoint: ${remoteTransportUrl}`] : []),
      ]
    : ['Remote streamable HTTP MCP gateway is shipped in this build but inactive until `pandora mcp http` is running.'];
  return {
    cliJson: {
      supported: true,
      status: 'active',
      notes: ['Reference local machine-consumable transport.'],
    },
    mcpStdio: {
      supported: true,
      status: 'active',
      notes: ['Current MCP transport for Pandora is stdio.'],
    },
    mcpStreamableHttp: {
      supported: true,
      status: remoteTransportActive ? 'active' : 'inactive',
      ...(remoteTransportUrl ? { endpoint: remoteTransportUrl } : {}),
      notes: remoteTransportNotes,
    },
    sdk: {
      supported: true,
      status: 'alpha',
      notes: ['Generated TypeScript and Python SDK alpha packages are shipped in this build under sdk/typescript and sdk/python.'],
    },
  };
}

function buildPolicyProfilesStatus(commandDescriptors) {
  const policyScopedCommands = Object.entries(commandDescriptors)
    .filter(([, descriptor]) => descriptor && Array.isArray(descriptor.policyScopes) && descriptor.policyScopes.length)
    .map(([name]) => name);
  const secretCommands = Object.entries(commandDescriptors)
    .filter(([, descriptor]) => descriptor && descriptor.requiresSecrets)
    .map(([name]) => name);
  const policies = createPolicyRegistryService().listPolicyPacks();
  const profileStore = createProfileStore();
  const profileResolver = createProfileResolverService({ store: profileStore });
  const profiles = profileStore.loadProfileSet({ includeBuiltIns: true });
  const builtinProfileEntries = profiles.items.filter((item) => item.builtin);
  const builtinProfileResolutions = builtinProfileEntries.map((item) => {
    const resolved = profileResolver.resolveProfile({
      profileId: item.id,
      includeSecretMaterial: false,
    });
    return {
      id: item.id,
      signerBackend: item.profile && item.profile.signerBackend ? item.profile.signerBackend : null,
      resolution: resolved && resolved.resolution ? resolved.resolution : null,
    };
  });
  const readyBuiltinIds = builtinProfileResolutions
    .filter((item) => item.resolution && item.resolution.ready === true)
    .map((item) => item.id);
  const pendingBuiltinIds = builtinProfileResolutions
    .filter((item) => !item.resolution || item.resolution.ready !== true)
    .map((item) => item.id);
  const implementedBackends = sortStrings(
    builtinProfileResolutions
      .filter((item) => item.resolution && item.resolution.backendImplemented === true)
      .map((item) => item.signerBackend),
  );
  const placeholderBackends = sortStrings(
    builtinProfileResolutions
      .filter((item) => item.resolution && item.resolution.backendImplemented === false)
      .map((item) => item.signerBackend),
  );
  return {
    policyPacks: {
      supported: true,
      status: 'alpha',
      notes: ['Built-in and user-defined policy packs are available, exposed in contracts, and enforced on policy-scoped execution paths.'],
      policyScopedCommandCount: policyScopedCommands.length,
      samplePolicyScopedCommands: buildSample(policyScopedCommands),
      builtinIds: sortStrings(policies.items.filter((item) => item.source === 'builtin').map((item) => item.id)),
      userCount: Number.isFinite(policies.storedCount) ? policies.storedCount : 0,
      userSampleIds: buildSample(policies.items.filter((item) => item.source === 'store').map((item) => item.id), 8),
    },
    signerProfiles: {
      supported: true,
      status: 'alpha',
      notes: [
        'Named signer profiles are available for discovery, compatibility checks, and readiness resolution.',
        'Use `profile get --id <profile-id>` or `profile validate --file <path>` for per-profile resolution details.',
        placeholderBackends.length
          ? `Placeholder sample backends are included for planning only: ${placeholderBackends.join(', ')}.`
          : 'All shipped signer backends report concrete runtime implementations.',
      ],
      secretBearingCommandCount: secretCommands.length,
      sampleSecretBearingCommands: buildSample(secretCommands),
      builtinIds: sortStrings(builtinProfileEntries.map((item) => item.id)),
      signerBackends: sortStrings(profiles.items.map((item) => item.profile && item.profile.signerBackend).filter(Boolean)),
      implementedBackends,
      placeholderBackends,
      readyBuiltinCount: readyBuiltinIds.length,
      readyBuiltinIds: sortStrings(readyBuiltinIds),
      pendingBuiltinCount: pendingBuiltinIds.length,
      pendingBuiltinIds: sortStrings(pendingBuiltinIds),
    },
  };
}

function buildOperationProtocolStatus(commandDescriptors) {
  const operationReadyCommands = Object.entries(commandDescriptors)
    .filter(([, descriptor]) => descriptor && descriptor.returnsOperationId)
    .map(([name]) => name);
  const jobCapableCommands = Object.entries(commandDescriptors)
    .filter(([, descriptor]) => descriptor && descriptor.jobCapable)
    .map(([name]) => name);
  return {
    supported: operationReadyCommands.length > 0,
    status: operationReadyCommands.length > 0 ? 'partial' : 'planned',
    notes: operationReadyCommands.length > 0
      ? ['Operation identifiers are partially available and should be expanded into a full plan/validate/execute/status protocol.']
      : ['Operation protocol is planned. Current contracts expose jobCapable/returnsOperationId metadata only.'],
    operationReadyCommands: sortStrings(operationReadyCommands),
    jobCapableCommands: sortStrings(jobCapableCommands),
  };
}

function buildVersionCompatibility(options = {}) {
  const remoteTransportActive = Boolean(options.remoteTransportActive);
  return {
    commandDescriptorVersion: COMMAND_DESCRIPTOR_VERSION,
    schemaCommand: 'pandora --output json schema',
    capabilitiesCommand: 'pandora --output json capabilities',
    mcpTransport: remoteTransportActive ? 'stdio+streamable-http' : 'stdio',
    notes: [
      'Schema and capabilities are generated from the same shared contract registry.',
      remoteTransportActive
        ? 'Remote streamable HTTP MCP is active in this runtime.'
        : 'Remote streamable HTTP MCP is shipped in this build but inactive until the gateway is started.',
    ],
  };
}

function buildRoadmapSignals(commandDescriptors, options = {}) {
  const remoteTransportActive = Boolean(options.remoteTransportActive);
  const descriptors = Object.values(commandDescriptors);
  return {
    remoteEligibleCommands: descriptors.filter((descriptor) => descriptor && descriptor.remoteEligible).length,
    jobCapableCommands: descriptors.filter((descriptor) => descriptor && descriptor.jobCapable).length,
    secretBearingCommands: descriptors.filter((descriptor) => descriptor && descriptor.requiresSecrets).length,
    operationReadyCommands: descriptors.filter((descriptor) => descriptor && descriptor.returnsOperationId).length,
    notes: [
      remoteTransportActive
        ? 'Eligibility metadata and remote transport are both active in this runtime.'
        : 'Eligibility metadata describes command contract shape, and the remote HTTP gateway is shipped but inactive until started.',
      remoteTransportActive
        ? 'SDK alpha packages, policy packs, and named profiles are now shipped; cross-cutting enforcement remains the next integration step.'
        : 'SDK alpha packages, policy packs, and named profiles are shipped; remote HTTP and fuller operation enforcement continue to evolve.',
    ],
  };
}

function buildRegistryDigest(commandDescriptors, commandDigests) {
  const canonicalTools = buildCanonicalTools(commandDescriptors);
  const topLevelCommands = buildTopLevelCommands(commandDescriptors);
  const routedTopLevelCommands = buildRouterTopLevelCommands();
  const namespaces = buildNamespaces(commandDescriptors);
  const documentation = buildSkillDocIndex();
  return {
    descriptorHash: stableJsonHash(commandDescriptors),
    commandDigestHash: stableJsonHash(commandDigests),
    canonicalHash: stableJsonHash(canonicalTools),
    topLevelHash: stableJsonHash(topLevelCommands),
    routedTopLevelHash: stableJsonHash(routedTopLevelCommands),
    namespaceHash: stableJsonHash(namespaces),
    documentationHash: stableJsonHash(documentation),
  };
}

function buildCapabilitiesPayload(options = {}) {
  const normalizedOptions = {
    ...options,
  };
  if (!Object.prototype.hasOwnProperty.call(normalizedOptions, 'remoteTransportActive')) {
    normalizedOptions.remoteTransportActive = process.env.PANDORA_MCP_REMOTE_ACTIVE === '1';
  }
  if (!Object.prototype.hasOwnProperty.call(normalizedOptions, 'remoteTransportUrl')) {
    normalizedOptions.remoteTransportUrl =
      typeof process.env.PANDORA_MCP_REMOTE_URL === 'string' && process.env.PANDORA_MCP_REMOTE_URL.trim()
        ? process.env.PANDORA_MCP_REMOTE_URL.trim()
        : null;
  }
  const commandDescriptors = sortObjectKeys(buildCommandDescriptors());
  const transports = buildTransports(normalizedOptions);
  const remoteTransportActive = Boolean(normalizedOptions.remoteTransportActive)
    || Object.entries(transports).some(
      ([name, transport]) =>
        !['cliJson', 'mcpStdio'].includes(name)
        && transport
        && transport.supported === true
        && String(transport.status || '').toLowerCase() === 'active',
    );
  const commandDigests = buildCommandDigests(commandDescriptors, { remoteTransportActive });
  const outputModeMatrix = buildOutputModeMatrix(commandDescriptors);
  return {
    schemaVersion: '1.0.0',
    generatedAt:
      typeof normalizedOptions.generatedAtOverride === 'string' && normalizedOptions.generatedAtOverride.trim()
        ? normalizedOptions.generatedAtOverride.trim()
        : new Date().toISOString(),
    title: 'PandoraCliCapabilities',
    description: 'Runtime capability digest derived from the Pandora command contract registry.',
    source: 'agent_contract_registry',
    commandDescriptorVersion: COMMAND_DESCRIPTOR_VERSION,
    summary: buildSummary(commandDescriptors, outputModeMatrix),
    transports,
    roadmapSignals: buildRoadmapSignals(commandDescriptors, { remoteTransportActive }),
    trustDistribution: buildTrustDistributionMetadata(),
    policyProfiles: buildPolicyProfilesStatus(commandDescriptors),
    operationProtocol: buildOperationProtocolStatus(commandDescriptors),
    versionCompatibility: buildVersionCompatibility({ remoteTransportActive }),
    documentation: buildSkillDocIndex(),
    outputModeMatrix,
    topLevelCommands: buildTopLevelCommands(commandDescriptors),
    routedTopLevelCommands: buildRouterTopLevelCommands(),
    namespaces: buildNamespaces(commandDescriptors),
    canonicalTools: buildCanonicalTools(commandDescriptors),
    commandDigests,
    registryDigest: buildRegistryDigest(commandDescriptors, commandDigests),
  };
}

function createRunCapabilitiesCommand(deps) {
  const { emitSuccess, CliError } = deps || {};

  if (typeof emitSuccess !== 'function') {
    throw new Error('createRunCapabilitiesCommand requires emitSuccess');
  }

  if (typeof CliError !== 'function') {
    throw new Error('createRunCapabilitiesCommand requires CliError');
  }

  function runCapabilitiesCommand(args, context) {
    if (Array.isArray(args) && (args.includes('--help') || args.includes('-h'))) {
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'capabilities.help', {
          usage: 'pandora --output json capabilities',
          notes: [
            'The capabilities payload is derived from the same command contract registry that powers pandora schema.',
            'Use schema for the full JSON Schema envelope definitions and exact per-command input schemas.',
            'Use capabilities for the compact runtime digest, canonical tool routing, and policy/readiness metadata.',
          ],
          commandDescriptorVersion: COMMAND_DESCRIPTOR_VERSION,
        });
      } else {
        // eslint-disable-next-line no-console
        console.log('Usage: pandora --output json capabilities');
        // eslint-disable-next-line no-console
        console.log('');
        // eslint-disable-next-line no-console
        console.log('Notes:');
        // eslint-disable-next-line no-console
        console.log('  - capabilities payload is available only in --output json mode.');
        // eslint-disable-next-line no-console
        console.log('  - It is derived from the same command contract registry used by pandora schema.');
        // eslint-disable-next-line no-console
        console.log('  - capabilities is the compact discovery digest; schema remains the full contract surface.');
      }
      return;
    }

    if (context.outputMode !== 'json') {
      throw new CliError('INVALID_USAGE', 'The capabilities command is only supported in --output json mode.', {
        hints: ['Run `pandora --output json capabilities`'],
      });
    }

    if (Array.isArray(args) && args.length > 0) {
      throw new CliError(
        'INVALID_ARGS',
        'capabilities does not accept additional flags or positional arguments.',
        {
          hints: ['Run `pandora --output json capabilities` without extra arguments.'],
        },
      );
    }

    emitSuccess(context.outputMode, 'capabilities', buildCapabilitiesPayload());
  }

  return { runCapabilitiesCommand };
}

module.exports = {
  buildCapabilitiesPayload,
  buildTrustDistributionMetadata,
  createRunCapabilitiesCommand,
};
