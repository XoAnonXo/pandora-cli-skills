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
const BENCHMARK_BUNDLE_PATH = 'benchmarks/latest/core-bundle.json';
const BENCHMARK_HISTORY_PATH = 'benchmarks/latest/core-history.json';
const BENCHMARK_DOC_HISTORY_PATH = 'docs/benchmarks/history.json';
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
const COMPATIBILITY_FLAG = '--include-compatibility';
const COMPATIBILITY_QUERY_PARAM = 'include_aliases=1';
const COMPATIBILITY_MODE_HINT = 'Compatibility aliases are hidden by default. Pass --include-compatibility or include_aliases=1 only for legacy/debug workflows.';
const A_PLUS_TARGET_TIER = 'A+';

function compareStableStrings(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

const PRINCIPAL_TEMPLATE_SPECS = Object.freeze([
  {
    id: 'read-only-researcher',
    summary: 'Read-only market and contract discovery for external agents and analysts.',
    authMode: 'remote-gateway-token-record',
    mutating: false,
    signerRequired: false,
    commandNames: [
      'bootstrap',
      'capabilities',
      'schema',
      'scan',
      'quote',
      'portfolio',
      'policy.list',
      'profile.list',
      'recipe.list',
      'operations.list',
      'operations.get',
    ],
    optionalScopes: ['help:read', 'operations.receipt:read', 'operations.verify-receipt:read'],
    notes: [
      'Start here for cold-agent exploration and research-only automations.',
      'Pair with a separate narrower execute persona instead of widening this template into a trader token.',
    ],
  },
  {
    id: 'operator',
    summary: 'Live operator persona for profile-backed trading, mirror, sports, and closeout workflows.',
    authMode: 'remote-gateway-token-record',
    mutating: true,
    signerRequired: true,
    commandNames: [
      'bootstrap',
      'capabilities',
      'schema',
      'policy.recommend',
      'profile.recommend',
      'profile.explain',
      'operations.list',
      'operations.get',
      'operations.receipt',
      'operations.verify-receipt',
      'trade',
      'sell',
      'lp.add',
      'lp.remove',
      'claim',
      'resolve',
      'mirror.deploy',
      'mirror.go',
      'mirror.sync.start',
      'mirror.sync.stop',
      'sports.create.run',
    ],
    optionalScopes: ['help:read'],
    notes: [
      'Use only with a runtime-ready mutable profile and host-local signer material.',
      'This template grants mutation scopes but does not itself provide signer credentials or policy approval.',
    ],
  },
  {
    id: 'auditor',
    summary: 'Read-only audit persona for schema, policy/profile posture, and operation receipt verification.',
    authMode: 'remote-gateway-token-record',
    mutating: false,
    signerRequired: false,
    commandNames: [
      'bootstrap',
      'capabilities',
      'schema',
      'policy.list',
      'profile.list',
      'profile.get',
      'profile.explain',
      'operations.list',
      'operations.get',
      'operations.receipt',
      'operations.verify-receipt',
    ],
    optionalScopes: ['help:read'],
    notes: [
      'Intended for post-execution review, policy inspection, and receipt verification without mutation rights.',
      'Prefer this persona for third-party auditors and release-validation agents.',
    ],
  },
  {
    id: 'recipe-validator',
    summary: 'Read-only persona for recipe linting, validation, and workflow planning.',
    authMode: 'remote-gateway-token-record',
    mutating: false,
    signerRequired: false,
    commandNames: [
      'bootstrap',
      'capabilities',
      'schema',
      'policy.list',
      'policy.recommend',
      'profile.list',
      'profile.get',
      'profile.explain',
      'recipe.list',
      'recipe.validate',
    ],
    optionalScopes: ['help:read'],
    notes: [
      'Use this persona for CI or agent planning loops that must validate recipes without executing them.',
      'If a recipe later needs live execution, switch to a separate operator persona rather than widening this token.',
    ],
  },
  {
    id: 'benchmark-runner',
    summary: 'Read-only benchmark and parity persona for bootstrap, schema, receipt, and discovery checks.',
    authMode: 'remote-gateway-token-record',
    mutating: false,
    signerRequired: false,
    commandNames: [
      'bootstrap',
      'capabilities',
      'schema',
      'scan',
      'quote',
      'portfolio',
      'policy.list',
      'profile.list',
      'recipe.list',
      'operations.list',
      'operations.get',
      'operations.receipt',
      'operations.verify-receipt',
    ],
    optionalScopes: ['help:read', 'mirror.read', 'sports.read'],
    notes: [
      'Covers the shipped read-only benchmark and trust-validation surfaces.',
      'Specialized denial-path benchmark scenarios may still use dedicated scenario tokens outside this baseline template.',
    ],
  },
]);

function sortStrings(values) {
  return Array.from(new Set(Array.isArray(values) ? values : []))
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .sort(compareStableStrings);
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
  for (const key of Object.keys(source).sort(compareStableStrings)) {
    sorted[key] = source[key];
  }
  return sorted;
}

function stableJsonHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function sanitizePackageName(name) {
  return String(name || '')
    .trim()
    .replace(/^@/, '')
    .replace(/[\\/]/g, '-');
}

function buildReleaseAssetNames(packageName, packageVersion, options = {}) {
  const tarballName = `${sanitizePackageName(packageName)}-${packageVersion}.tgz`;
  const names = [
    tarballName,
    `${tarballName}.sha256`,
    'checksums.sha256',
    'core-report.json',
    'core-bundle.json',
    'core-history.json',
    'core.lock.json',
    'benchmark-publication-bundle.tar.gz',
    'benchmark-publication-bundle.tar.gz.sha256',
    'benchmark-publication-bundle.tar.gz.intoto.jsonl',
    'benchmark-publication-manifest.json',
    'benchmark-publication-manifest.json.sha256',
    'benchmark-publication-manifest.json.intoto.jsonl',
    'sdk-checksums.sha256',
    'sdk-release-manifest.json',
    'sbom.spdx.json',
    'sbom.spdx.json.sha256',
    'sbom.spdx.json.intoto.jsonl',
    `${tarballName}.intoto.jsonl`,
    `${tarballName}.sig`,
    `${tarballName}.pem`,
  ];
  const typescriptPackageName = normalizeString(options.typescriptPackageName);
  const typescriptVersion = normalizeString(options.typescriptVersion);
  if (typescriptPackageName && typescriptVersion) {
    names.push(`${sanitizePackageName(typescriptPackageName)}-${typescriptVersion}.tgz`);
  }
  const pythonPackageName = normalizeString(options.pythonPackageName);
  const pythonVersion = normalizeString(options.pythonVersion);
  if (pythonPackageName && pythonVersion) {
    const sanitizedPythonPackageName = String(pythonPackageName).replace(/-/g, '_');
    names.push(
      `${sanitizedPythonPackageName}-${pythonVersion}-py3-none-any.whl`,
      `${sanitizedPythonPackageName}-${pythonVersion}.tar.gz`,
    );
  }
  return sortStrings(names);
}

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isCompatibilityAliasDescriptor(descriptor) {
  return Boolean(descriptor && descriptor.aliasOf);
}

function countCompatibilityAliases(commandDescriptors) {
  return Object.values(commandDescriptors || {}).filter((descriptor) => isCompatibilityAliasDescriptor(descriptor)).length;
}

function countCanonicalToolsWithCompatibilityAliases(commandDescriptors) {
  const canonicalTools = new Set();
  for (const descriptor of Object.values(commandDescriptors || {})) {
    if (!isCompatibilityAliasDescriptor(descriptor)) continue;
    const canonicalTool = normalizeString(descriptor && descriptor.canonicalTool);
    if (canonicalTool) canonicalTools.add(canonicalTool);
  }
  return canonicalTools.size;
}

function filterDiscoveryCommandDescriptors(commandDescriptors, options = {}) {
  if (options.includeCompatibility === true) {
    return sortObjectKeys(commandDescriptors);
  }
  const filtered = {};
  for (const [commandName, descriptor] of Object.entries(commandDescriptors || {})) {
    if (isCompatibilityAliasDescriptor(descriptor)) continue;
    filtered[commandName] = descriptor;
  }
  return sortObjectKeys(filtered);
}

function buildDiscoveryPreferences(fullCommandDescriptors, visibleCommandDescriptors, options = {}) {
  const totalAliasCount = countCompatibilityAliases(fullCommandDescriptors);
  const visibleAliasCount = countCompatibilityAliases(visibleCommandDescriptors);
  return {
    canonicalOnlyDefault: true,
    includeCompatibility: options.includeCompatibility === true,
    aliasesHiddenByDefault: true,
    compatibilityFlag: COMPATIBILITY_FLAG,
    compatibilityQueryParam: COMPATIBILITY_QUERY_PARAM,
    compatibilityModeHint: COMPATIBILITY_MODE_HINT,
    visibleCommandCount: Object.keys(visibleCommandDescriptors || {}).length,
    totalAliasCount,
    hiddenAliasCount: Math.max(totalAliasCount - visibleAliasCount, 0),
    canonicalToolsWithCompatibilityAliases: countCanonicalToolsWithCompatibilityAliases(fullCommandDescriptors),
  };
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
  if (!text || !target) return false;
  return text.includes(`run: ${target}`)
    || (
      text.includes(`test_command: ${target}`)
      && text.includes('run: ${{ matrix.test_command }}')
    );
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
  const benchmarkBundleRead = readJsonSafelyIfExists(BENCHMARK_BUNDLE_PATH);
  const benchmarkHistoryRead = readJsonSafelyIfExists(BENCHMARK_HISTORY_PATH);
  const benchmarkReport = benchmarkReportRead.value;
  const benchmarkReportPresent = shippedAndPresent(BENCHMARK_REPORT_PATH) && benchmarkReportRead.present;
  const benchmarkBundlePresent = shippedAndPresent(BENCHMARK_BUNDLE_PATH) && benchmarkBundleRead.present;
  const benchmarkHistoryPresent = shippedAndPresent(BENCHMARK_HISTORY_PATH) && benchmarkHistoryRead.present;
  const benchmarkDocsHistoryPresent = shippedAndPresent(BENCHMARK_DOC_HISTORY_PATH);
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
        bundlePath: BENCHMARK_BUNDLE_PATH,
        bundlePresent: benchmarkBundlePresent,
        historyPath: BENCHMARK_HISTORY_PATH,
        historyPresent: benchmarkHistoryPresent,
        docsHistoryPath: BENCHMARK_DOC_HISTORY_PATH,
        docsHistoryPresent: benchmarkDocsHistoryPresent,
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
          {
            typescriptPackageName: normalizeString(typescriptSdkPackage && typescriptSdkPackage.name),
            typescriptVersion: normalizeString(typescriptSdkPackage && typescriptSdkPackage.version),
            pythonPackageName: parseTomlStringField(pythonPyprojectText, 'name'),
            pythonVersion: parseTomlStringField(pythonPyprojectText, 'version'),
          },
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
        prepublishOnlyRunsTest: scriptIncludes(repoScripts.prepublishOnly, 'npm test'),
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

function buildStableTrustDistributionMetadata(trustDistribution) {
  if (!trustDistribution || typeof trustDistribution !== 'object') return trustDistribution;
  const stable = cloneJson(trustDistribution);
  if (stable.verification && stable.verification.benchmark && typeof stable.verification.benchmark === 'object') {
    stable.verification.benchmark.reportOverallPass = null;
    stable.verification.benchmark.reportContractLockMatchesExpected = null;
  }
  if (stable.verification && stable.verification.signals && typeof stable.verification.signals === 'object') {
    stable.verification.signals.benchmarkReportPass = null;
    stable.verification.signals.benchmarkReportContractLockMatch = null;
  }
  if (Array.isArray(stable.notes)) {
    const note = 'Generated contract artifacts normalize live benchmark pass-state so SDK bundles stay stable across benchmark refreshes.';
    if (!stable.notes.includes(note)) {
      stable.notes.push(note);
    }
  }
  return stable;
}

function buildSample(values, limit = 12) {
  return sortStrings(values).slice(0, limit);
}

function mergeUniqueStringList(values = []) {
  return sortStrings(
    values.flatMap((value) => {
      if (Array.isArray(value)) return value;
      if (value === null || value === undefined) return [];
      return [value];
    }),
  );
}

function describeSignerImplementationStatus(status) {
  if (status === 'implemented') {
    return 'Backend code path exists in the current runtime.';
  }
  if (status === 'placeholder') {
    return 'Sample/profile metadata is shipped, but the backend code path is not implemented yet.';
  }
  return 'No implementation signal is currently available for this backend in the active runtime snapshot.';
}

function describeSignerRuntimeStatus(status) {
  if (status === 'ready') {
    return 'At least one built-in profile using this backend resolved as runtime-ready in the current process.';
  }
  if (status === 'degraded') {
    return 'Backend is implemented, but the current runtime is missing signer material, network context, or compatibility prerequisites for built-in profiles using it.';
  }
  if (status === 'placeholder') {
    return 'Backend is still a placeholder in the current runtime and cannot become ready yet.';
  }
  return 'Runtime readiness is not currently observable for this backend from built-in profiles in this process.';
}

function getDescriptorPolicyScopes(commandDescriptors, commandName) {
  const descriptor = commandDescriptors && commandDescriptors[commandName];
  return Array.isArray(descriptor && descriptor.policyScopes)
    ? sortStrings(descriptor.policyScopes)
    : [];
}

function getDescriptorCanonicalTool(commandDescriptors, commandName) {
  const descriptor = commandDescriptors && commandDescriptors[commandName];
  return normalizeString(descriptor && descriptor.canonicalTool) || normalizeString(commandName);
}

function buildPrincipalTemplates(commandDescriptors) {
  const templates = PRINCIPAL_TEMPLATE_SPECS.map((spec) => {
    const grantedScopes = mergeUniqueStringList(
      spec.commandNames.map((commandName) => getDescriptorPolicyScopes(commandDescriptors, commandName)),
    );
    const canonicalTools = mergeUniqueStringList(
      spec.commandNames.map((commandName) => getDescriptorCanonicalTool(commandDescriptors, commandName)),
    );
    return {
      id: spec.id,
      summary: spec.summary,
      authMode: spec.authMode,
      mutating: Boolean(spec.mutating),
      signerRequired: Boolean(spec.signerRequired),
      canonicalTools,
      recommendedCommands: sortStrings(spec.commandNames),
      grantedScopes,
      optionalScopes: sortStrings(spec.optionalScopes),
      tokenRecordTemplate: {
        id: spec.id,
        tokenPlaceholder: '<replace-with-random-secret>',
        scopes: grantedScopes,
      },
      notes: Array.isArray(spec.notes) ? spec.notes.slice() : [],
    };
  });
  return {
    supported: true,
    status: 'active',
    notes: [
      'Principal templates are least-privilege starter personas for remote `pandora mcp http` bearer tokens.',
      'They are reference templates for `--auth-tokens-file` entries, not a hosted identity provider or automatic gateway provisioning layer.',
      'Prefer creating one token per persona and widening scopes only when `policy explain`, `profile explain`, or `bootstrap` says a target workflow requires it.',
    ],
    templates,
  };
}

function classifyBuiltinProfileRuntimeStatus(resolution) {
  if (resolution && resolution.ready === true) {
    return 'ready';
  }
  if (resolution && resolution.backendImplemented === false) {
    return 'placeholder';
  }
  if (resolution && resolution.backendImplemented === true) {
    return 'degraded';
  }
  return 'unknown';
}

function buildSignerBackendStatuses(builtinProfileResolutions, signerBackends) {
  const backendStatuses = {};
  const backends = sortStrings(signerBackends);

  for (const signerBackend of backends) {
    const matchingProfiles = builtinProfileResolutions.filter((item) => item.signerBackend === signerBackend);
    const readyBuiltinIds = sortStrings(
      matchingProfiles
        .filter((item) => item.runtimeStatus === 'ready')
        .map((item) => item.id),
    );
    const degradedBuiltinIds = sortStrings(
      matchingProfiles
        .filter((item) => item.runtimeStatus === 'degraded')
        .map((item) => item.id),
    );
    const placeholderBuiltinIds = sortStrings(
      matchingProfiles
        .filter((item) => item.runtimeStatus === 'placeholder')
        .map((item) => item.id),
    );
    const hasImplemented = matchingProfiles.some(
      (item) => item.resolution && item.resolution.backendImplemented === true,
    );
    const implementationStatus = hasImplemented ? 'implemented' : 'placeholder';
    let runtimeStatus = 'unknown';
    if (implementationStatus === 'placeholder') {
      runtimeStatus = 'placeholder';
    } else if (readyBuiltinIds.length > 0) {
      runtimeStatus = 'ready';
    } else if (matchingProfiles.length > 0) {
      runtimeStatus = 'degraded';
    }

    backendStatuses[signerBackend] = {
      implementationStatus,
      runtimeStatus,
      builtinProfileCount: matchingProfiles.length,
      readyBuiltinIds,
      degradedBuiltinIds,
      placeholderBuiltinIds,
      notes: [
        describeSignerImplementationStatus(implementationStatus),
        describeSignerRuntimeStatus(runtimeStatus),
      ],
    };
  }

  return sortObjectKeys(backendStatuses);
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
  const commandNames = Object.keys(commandDescriptors).sort(compareStableStrings);

  for (const commandName of commandNames) {
    if (commandName.includes('.')) continue;
    const descriptor = commandDescriptors[commandName] || {};
    const childCommands = commandNames.filter((candidate) => candidate.startsWith(`${commandName}.`));
    const childMcpExposed = childCommands.some((candidate) => commandDescriptors[candidate] && commandDescriptors[candidate].mcpExposed);
    const callableViaMcp = Boolean(descriptor.mcpExposed);
    topLevel[commandName] = {
      outputModes: sortStrings(descriptor.outputModes),
      childCommands,
      mcpExposed: Boolean(descriptor.mcpExposed || childMcpExposed),
      callableViaMcp,
      hasMcpChildren: childMcpExposed,
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
  ).sort(compareStableStrings);
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
  for (const namespaceName of Object.keys(namespaces).sort(compareStableStrings)) {
    normalized[namespaceName] = {
      ...namespaces[namespaceName],
      commands: sortStrings(namespaces[namespaceName].commands),
      mcpExposedCommands: sortStrings(namespaces[namespaceName].mcpExposedCommands),
    };
  }
  return normalized;
}

function buildCanonicalTools(commandDescriptors, options = {}) {
  const includeCompatibility = options.includeCompatibility === true;
  const canonicalTools = {};

  for (const [commandName, descriptor] of Object.entries(commandDescriptors)) {
    const canonicalTool = descriptor && descriptor.canonicalTool ? descriptor.canonicalTool : null;
    if (!canonicalTool) continue;

    if (!canonicalTools[canonicalTool]) {
      canonicalTools[canonicalTool] = {
        preferredCommand: null,
        nonAliasPreferredCommand: null,
        commands: [],
        compatibilityAliasCount: 0,
      };
    }

    canonicalTools[canonicalTool].commands.push(commandName);
    if (isCompatibilityAliasDescriptor(descriptor)) {
      canonicalTools[canonicalTool].compatibilityAliasCount += 1;
    }
    if (descriptor.preferred) {
      canonicalTools[canonicalTool].preferredCommand = commandName;
    }
    if (!isCompatibilityAliasDescriptor(descriptor) && !canonicalTools[canonicalTool].nonAliasPreferredCommand) {
      canonicalTools[canonicalTool].nonAliasPreferredCommand = commandName;
    }
  }

  const normalized = {};
  for (const canonicalTool of Object.keys(canonicalTools).sort(compareStableStrings)) {
    const preferredCommand = includeCompatibility
      ? (canonicalTools[canonicalTool].preferredCommand || canonicalTools[canonicalTool].nonAliasPreferredCommand || canonicalTool)
      : (canonicalTools[canonicalTool].nonAliasPreferredCommand || canonicalTools[canonicalTool].preferredCommand || canonicalTool);
    normalized[canonicalTool] = {
      preferredCommand,
      commands: includeCompatibility
        ? sortStrings(canonicalTools[canonicalTool].commands)
        : [preferredCommand],
      compatibilityAliasCount: canonicalTools[canonicalTool].compatibilityAliasCount,
      compatibilityIncluded: includeCompatibility,
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

function buildSummary(allCommandDescriptors, discoveryCommandDescriptors, outputModeMatrix) {
  const descriptorList = Object.entries(allCommandDescriptors);
  const discoveryList = Object.entries(discoveryCommandDescriptors);
  const routedTopLevelCommands = buildRouterTopLevelCommands();
  return {
    totalCommands: descriptorList.length,
    discoveryCommands: discoveryList.length,
    topLevelCommands: Object.keys(discoveryCommandDescriptors).filter((commandName) => !commandName.includes('.')).length,
    routedTopLevelCommands: routedTopLevelCommands.length,
    aliases: descriptorList.filter(([, descriptor]) => descriptor && descriptor.aliasOf).length,
    mcpExposedCommands: discoveryList.filter(([, descriptor]) => descriptor && descriptor.mcpExposed).length,
    mcpMutatingCommands: discoveryList.filter(([, descriptor]) => descriptor && descriptor.mcpMutating).length,
    mcpLongRunningBlockedCommands: discoveryList.filter(
      ([, descriptor]) => descriptor && descriptor.mcpLongRunningBlocked,
    ).length,
    jsonOnlyCommands: outputModeMatrix.jsonOnly.length,
    tableOnlyCommands: outputModeMatrix.tableOnly.length,
    tableAndJsonCommands: outputModeMatrix.tableAndJson.length,
  };
}

function buildTransports(options = {}, trustDistribution = null) {
  const remoteTransportActive = Boolean(options.remoteTransportActive);
  const remoteTransportUrl =
    typeof options.remoteTransportUrl === 'string' && options.remoteTransportUrl.trim()
      ? options.remoteTransportUrl.trim()
      : null;
  const distribution = trustDistribution && trustDistribution.distribution ? trustDistribution.distribution : {};
  const embeddedSdks = distribution && distribution.embeddedSdks ? distribution.embeddedSdks : {};
  const generatedArtifacts = distribution && distribution.generatedContractArtifacts ? distribution.generatedContractArtifacts : {};
  const typescriptPackageName = normalizeString(embeddedSdks.typescript && embeddedSdks.typescript.packageName) || '@thisispandora/agent-sdk';
  const typescriptPackageVersion = normalizeString(embeddedSdks.typescript && embeddedSdks.typescript.version);
  const pythonPackageName = normalizeString(embeddedSdks.python && embeddedSdks.python.packageName) || 'pandora-agent';
  const pythonPackageVersion = normalizeString(embeddedSdks.python && embeddedSdks.python.version);
  const typescriptInstallExamples = [
    `npm install ${typescriptPackageName}${typescriptPackageVersion ? `@${typescriptPackageVersion}` : '@alpha'}`,
    'npm install /path/to/downloaded/pandora-agent-sdk-<version>.tgz',
  ];
  const pythonInstallExamples = [
    `pip install ${pythonPackageName}${pythonPackageVersion ? `==${pythonPackageVersion}` : ''}`,
    'pip install /path/to/downloaded/pandora_agent-<version>-py3-none-any.whl',
    'pip install /path/to/downloaded/pandora_agent-<version>.tar.gz',
  ];
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
      deploymentModel: 'self-hosted-operator-gateway',
      publicManagedService: false,
      operatorDocsPath: pathExists('docs/trust/operator-deployment.md') ? 'docs/trust/operator-deployment.md' : null,
      operatorDocsPresent: pathExists('docs/trust/operator-deployment.md'),
      operationsApiAvailable: true,
      webhookSupport: true,
      ...(remoteTransportUrl ? { endpoint: remoteTransportUrl } : {}),
      notes: remoteTransportNotes,
    },
    sdk: {
      supported: true,
      status: 'alpha',
      recommendedBootstrapCommand: 'bootstrap',
      notes: [
        'Generated TypeScript and Python SDK alpha packages are shipped in this build under sdk/typescript and sdk/python.',
        'Cold agents should prefer the canonical bootstrap surface before lower-level capabilities/schema discovery.',
      ],
      packages: {
        typescript: {
          name: typescriptPackageName,
          version: typescriptPackageVersion,
          repoPath: normalizeString(embeddedSdks.typescript && embeddedSdks.typescript.packagePath),
          distributionStatus: 'vendored-alpha',
          publicationStatus: 'public-registry-published',
          publicRegistryPublished: true,
          recommendedConsumption: 'public-npm-package',
          vendoredInRootPackage: true,
          releaseAssetPatterns: ['pandora-agent-sdk-*.tgz'],
          installExamples: typescriptInstallExamples,
        },
        python: {
          name: pythonPackageName,
          version: pythonPackageVersion,
          repoPath: normalizeString(embeddedSdks.python && embeddedSdks.python.projectPath),
          moduleName: 'pandora_agent',
          distributionStatus: 'vendored-alpha',
          publicationStatus: 'public-registry-published',
          publicRegistryPublished: true,
          recommendedConsumption: 'public-pypi-package',
          vendoredInRootPackage: true,
          releaseAssetPatterns: ['pandora_agent-*.whl', 'pandora_agent-*.tar.gz'],
          installExamples: pythonInstallExamples,
        },
      },
      generatedBundle: {
        repoPath: normalizeString(generatedArtifacts.manifestPath),
        bundlePath: normalizeString(generatedArtifacts.bundlePath),
        artifactVersion: normalizeString(generatedArtifacts.artifactVersion),
      },
    },
  };
}

function buildPolicyProfilesStatus(commandDescriptors, options = {}) {
  const policyScopedCommands = Object.entries(commandDescriptors)
    .filter(([, descriptor]) => descriptor && Array.isArray(descriptor.policyScopes) && descriptor.policyScopes.length)
    .map(([name]) => name);
  const secretCommands = Object.entries(commandDescriptors)
    .filter(([, descriptor]) => descriptor && descriptor.requiresSecrets)
    .map(([name]) => name);
  const policies = createPolicyRegistryService().listPolicyPacks();
  const profileStore = createProfileStore();
  const profileResolver = createProfileResolverService({
    store: profileStore,
    env: options.artifactNeutralProfileReadiness === true ? {} : process.env,
  });
  const profiles = profileStore.loadProfileSet({ includeBuiltIns: true });
  const builtinProfileEntries = profiles.items.filter((item) => item.builtin);
  const mutableBuiltinIds = sortStrings(
    builtinProfileEntries
      .filter((item) => !(item.profile && item.profile.readOnly))
      .map((item) => item.id),
  );
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
  const builtinRuntimeStates = builtinProfileResolutions.map((item) => ({
    ...item,
    runtimeStatus: classifyBuiltinProfileRuntimeStatus(item.resolution),
  }));
  const readyBuiltinIds = builtinProfileResolutions
    .filter((item) => item.resolution && item.resolution.ready === true)
    .map((item) => item.id);
  const readyMutableBuiltinIds = sortStrings(
    readyBuiltinIds.filter((id) => mutableBuiltinIds.includes(id)),
  );
  const degradedBuiltinIds = builtinRuntimeStates
    .filter((item) => item.runtimeStatus === 'degraded')
    .map((item) => item.id);
  const degradedMutableBuiltinIds = sortStrings(
    degradedBuiltinIds.filter((id) => mutableBuiltinIds.includes(id)),
  );
  const placeholderBuiltinIds = builtinRuntimeStates
    .filter((item) => item.runtimeStatus === 'placeholder')
    .map((item) => item.id);
  const pendingBuiltinIds = builtinRuntimeStates
    .filter((item) => item.runtimeStatus !== 'ready')
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
  const signerBackends = sortStrings(
    profiles.items.map((item) => item.profile && item.profile.signerBackend).filter(Boolean),
  );
  const backendStatuses = buildSignerBackendStatuses(builtinRuntimeStates, signerBackends);
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
        'Implementation status and runtime readiness are separate axes: an implemented backend can still report degraded until the current runtime supplies signer material and network context.',
        placeholderBackends.length
          ? `Placeholder sample backends are included for planning only: ${placeholderBackends.join(', ')}.`
          : 'All shipped signer backends report concrete runtime implementations.',
      ],
      statusAxes: {
        implementation: {
          implemented: 'Executable backend code path exists in the current runtime.',
          placeholder: 'Profile/backend metadata ships for planning, but the executable backend is not implemented yet.',
        },
        runtime: {
          ready: 'Implemented backend plus current runtime prerequisites are satisfied for at least one shipped built-in profile.',
          degraded: 'Implemented backend exists, but the current runtime is missing signer material, network context, or execution compatibility prerequisites.',
          placeholder: 'Backend is still a placeholder in the current runtime and cannot become ready yet.',
          unknown: 'Current runtime could not derive readiness for this backend from built-in profiles.',
        },
      },
      secretBearingCommandCount: secretCommands.length,
      sampleSecretBearingCommands: buildSample(secretCommands),
      builtinIds: sortStrings(builtinProfileEntries.map((item) => item.id)),
      mutableBuiltinCount: mutableBuiltinIds.length,
      mutableBuiltinIds,
      signerBackends,
      implementedBackends,
      placeholderBackends,
      backendStatuses,
      readyBuiltinCount: readyBuiltinIds.length,
      readyBuiltinIds: sortStrings(readyBuiltinIds),
      readyMutableBuiltinCount: readyMutableBuiltinIds.length,
      readyMutableBuiltinIds,
      degradedBuiltinCount: degradedBuiltinIds.length,
      degradedBuiltinIds: sortStrings(degradedBuiltinIds),
      degradedMutableBuiltinCount: degradedMutableBuiltinIds.length,
      degradedMutableBuiltinIds,
      placeholderBuiltinCount: placeholderBuiltinIds.length,
      placeholderBuiltinIds: sortStrings(placeholderBuiltinIds),
      pendingBuiltinCount: pendingBuiltinIds.length,
      pendingBuiltinIds: sortStrings(pendingBuiltinIds),
    },
  };
}

async function buildPolicyProfilesStatusAsync(commandDescriptors, options = {}) {
  if (options.artifactNeutralProfileReadiness === true) {
    return buildPolicyProfilesStatus(commandDescriptors, options);
  }
  const policyScopedCommands = Object.entries(commandDescriptors)
    .filter(([, descriptor]) => descriptor && Array.isArray(descriptor.policyScopes) && descriptor.policyScopes.length)
    .map(([name]) => name);
  const secretCommands = Object.entries(commandDescriptors)
    .filter(([, descriptor]) => descriptor && descriptor.requiresSecrets)
    .map(([name]) => name);
  const policies = createPolicyRegistryService().listPolicyPacks();
  const profileStore = createProfileStore();
  const profileResolver = createProfileResolverService({
    store: profileStore,
    env: options.artifactNeutralProfileReadiness === true ? {} : process.env,
  });
  const profiles = profileStore.loadProfileSet({ includeBuiltIns: true });
  const builtinProfileEntries = profiles.items.filter((item) => item.builtin);
  const mutableBuiltinIds = sortStrings(
    builtinProfileEntries
      .filter((item) => !(item.profile && item.profile.readOnly))
      .map((item) => item.id),
  );
  const builtinProfileResolutions = await Promise.all(builtinProfileEntries.map(async (item) => {
    const resolved = await profileResolver.probeProfile({
      profileId: item.id,
      includeSecretMaterial: false,
      fetch: options.fetch,
    });
    return {
      id: item.id,
      signerBackend: item.profile && item.profile.signerBackend ? item.profile.signerBackend : null,
      resolution: resolved && resolved.resolution ? resolved.resolution : null,
    };
  }));
  const builtinRuntimeStates = builtinProfileResolutions.map((item) => ({
    ...item,
    runtimeStatus: classifyBuiltinProfileRuntimeStatus(item.resolution),
  }));
  const readyBuiltinIds = builtinProfileResolutions
    .filter((item) => item.resolution && item.resolution.ready === true)
    .map((item) => item.id);
  const readyMutableBuiltinIds = sortStrings(
    readyBuiltinIds.filter((id) => mutableBuiltinIds.includes(id)),
  );
  const degradedBuiltinIds = builtinRuntimeStates
    .filter((item) => item.runtimeStatus === 'degraded')
    .map((item) => item.id);
  const degradedMutableBuiltinIds = sortStrings(
    degradedBuiltinIds.filter((id) => mutableBuiltinIds.includes(id)),
  );
  const placeholderBuiltinIds = builtinRuntimeStates
    .filter((item) => item.runtimeStatus === 'placeholder')
    .map((item) => item.id);
  const pendingBuiltinIds = builtinRuntimeStates
    .filter((item) => item.runtimeStatus !== 'ready')
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
  const signerBackends = sortStrings(
    profiles.items.map((item) => item.profile && item.profile.signerBackend).filter(Boolean),
  );
  const backendStatuses = buildSignerBackendStatuses(builtinRuntimeStates, signerBackends);
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
        'Implementation status and runtime readiness are separate axes: an implemented backend can still report degraded until the current runtime supplies signer material and network context.',
        placeholderBackends.length
          ? `Placeholder sample backends are included for planning only: ${placeholderBackends.join(', ')}.`
          : 'All shipped signer backends report concrete runtime implementations.',
      ],
      statusAxes: {
        implementation: {
          implemented: 'Executable backend code path exists in the current runtime.',
          placeholder: 'Profile/backend metadata ships for planning, but the executable backend is not implemented yet.',
        },
        runtime: {
          ready: 'Implemented backend plus current runtime prerequisites are satisfied for at least one shipped built-in profile.',
          degraded: 'Implemented backend exists, but the current runtime is missing signer material, network context, or execution compatibility prerequisites.',
          placeholder: 'Backend is still a placeholder in the current runtime and cannot become ready yet.',
          unknown: 'Current runtime could not derive readiness for this backend from built-in profiles.',
        },
      },
      secretBearingCommandCount: secretCommands.length,
      sampleSecretBearingCommands: buildSample(secretCommands),
      builtinIds: sortStrings(builtinProfileEntries.map((item) => item.id)),
      mutableBuiltinCount: mutableBuiltinIds.length,
      mutableBuiltinIds,
      signerBackends,
      implementedBackends,
      placeholderBackends,
      backendStatuses,
      readyBuiltinCount: readyBuiltinIds.length,
      readyBuiltinIds: sortStrings(readyBuiltinIds),
      readyMutableBuiltinCount: readyMutableBuiltinIds.length,
      readyMutableBuiltinIds,
      degradedBuiltinCount: degradedBuiltinIds.length,
      degradedBuiltinIds: sortStrings(degradedBuiltinIds),
      degradedMutableBuiltinCount: degradedMutableBuiltinIds.length,
      degradedMutableBuiltinIds,
      placeholderBuiltinCount: placeholderBuiltinIds.length,
      placeholderBuiltinIds: sortStrings(placeholderBuiltinIds),
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
  const receiptCommands = sortStrings(
    ['operations.receipt', 'operations.verify-receipt']
      .filter((commandName) => Object.prototype.hasOwnProperty.call(commandDescriptors || {}, commandName)),
  );
  return {
    supported: operationReadyCommands.length > 0,
    status: operationReadyCommands.length > 0 ? 'partial' : 'planned',
    notes: operationReadyCommands.length > 0
      ? ['Operation identifiers are partially available and should be expanded into a full plan/validate/execute/status protocol.']
      : ['Operation protocol is planned. Current contracts expose jobCapable/returnsOperationId metadata only.'],
    operationReadyCommands: sortStrings(operationReadyCommands),
    jobCapableCommands: sortStrings(jobCapableCommands),
    receiptCommands,
    receiptCommandsSupported: receiptCommands.length === 2,
    receiptVerificationSupported: receiptCommands.includes('operations.verify-receipt'),
    receiptIntegrityModel: 'hash-and-signature-verified-json',
    receiptSignatureAlgorithm: 'ed25519',
    signedReceipts: true,
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

function hasCommandDigest(payload, commandName) {
  return Boolean(payload && payload.commandDigests && payload.commandDigests[commandName]);
}

function createAPlusCheck({
  id,
  title,
  status,
  expectation,
  actual,
  evidencePaths = [],
  remediationCommands = [],
  reason,
}) {
  return {
    id,
    title,
    status,
    expectation,
    actual,
    reason,
    evidencePaths: sortStrings(evidencePaths),
    remediationCommands: sortStrings(remediationCommands),
  };
}

function buildAPlusCertification(payload = {}) {
  const checks = [];
  const discoveryPreferences = payload.discoveryPreferences || {};
  const transports = payload.transports || {};
  const sdkPackages = transports.sdk && transports.sdk.packages ? transports.sdk.packages : {};
  const typescriptSdk = sdkPackages.typescript || {};
  const pythonSdk = sdkPackages.python || {};
  const signerProfiles = payload.policyProfiles && payload.policyProfiles.signerProfiles
    ? payload.policyProfiles.signerProfiles
    : {};
  const principalTemplates = payload.principalTemplates && Array.isArray(payload.principalTemplates.templates)
    ? payload.principalTemplates.templates
    : [];
  const benchmark = payload.trustDistribution
    && payload.trustDistribution.verification
    && payload.trustDistribution.verification.benchmark
    ? payload.trustDistribution.verification.benchmark
    : {};
  const releaseAssets = payload.trustDistribution
    && payload.trustDistribution.verification
    && payload.trustDistribution.verification.releaseAssets
    && Array.isArray(payload.trustDistribution.verification.releaseAssets.names)
      ? payload.trustDistribution.verification.releaseAssets.names
      : [];
  const verificationSignals = payload.trustDistribution
    && payload.trustDistribution.verification
    && payload.trustDistribution.verification.signals
    ? payload.trustDistribution.verification.signals
    : {};
  const releaseGateSignals = payload.trustDistribution
    && payload.trustDistribution.releaseGates
    && payload.trustDistribution.releaseGates.signals
    ? payload.trustDistribution.releaseGates.signals
    : {};
  const operationProtocol = payload.operationProtocol || {};
  const remoteGateway = transports.mcpStreamableHttp || {};
  const readinessMode = payload.readinessMode || 'artifact-neutral';
  const readyMutableBuiltinCount = Number.isFinite(signerProfiles.readyMutableBuiltinCount)
    ? signerProfiles.readyMutableBuiltinCount
    : 0;
  const readyMutableBuiltinIds = Array.isArray(signerProfiles.readyMutableBuiltinIds)
    ? signerProfiles.readyMutableBuiltinIds
    : [];

  checks.push(createAPlusCheck({
    id: 'bootstrap-canonical-default',
    title: 'Single-call canonical bootstrap exists',
    status:
      payload.recommendedFirstCall === 'bootstrap'
      && discoveryPreferences.canonicalOnlyDefault === true
      && discoveryPreferences.aliasesHiddenByDefault === true
      && hasCommandDigest(payload, 'bootstrap')
        ? 'pass'
        : 'fail',
    expectation: 'Cold agents start from bootstrap and see canonical tools only by default.',
    actual: {
      recommendedFirstCall: payload.recommendedFirstCall || null,
      canonicalOnlyDefault: Boolean(discoveryPreferences.canonicalOnlyDefault),
      aliasesHiddenByDefault: Boolean(discoveryPreferences.aliasesHiddenByDefault),
      bootstrapCommandPresent: hasCommandDigest(payload, 'bootstrap'),
    },
    evidencePaths: [
      'recommendedFirstCall',
      'discoveryPreferences.canonicalOnlyDefault',
      'discoveryPreferences.aliasesHiddenByDefault',
      'commandDigests.bootstrap',
    ],
    remediationCommands: ['pandora --output json bootstrap'],
    reason:
      payload.recommendedFirstCall === 'bootstrap'
      ? 'Bootstrap is the canonical discovery entrypoint.'
      : 'Bootstrap is not yet the canonical first call.',
  }));

  checks.push(createAPlusCheck({
    id: 'typescript-sdk-publication',
    title: 'Standalone TypeScript SDK is publicly published',
    status: typescriptSdk.publicRegistryPublished === true ? 'pass' : 'fail',
    expectation: 'A+ requires @thisispandora/agent-sdk to be installable from a public package registry.',
    actual: {
      packageName: typescriptSdk.name || null,
      publicRegistryPublished: Boolean(typescriptSdk.publicRegistryPublished),
      publicationStatus: typescriptSdk.publicationStatus || null,
      releaseAssetPatterns: Array.isArray(typescriptSdk.releaseAssetPatterns) ? typescriptSdk.releaseAssetPatterns : [],
    },
    evidencePaths: ['transports.sdk.packages.typescript'],
    reason:
      typescriptSdk.publicRegistryPublished === true
        ? 'The standalone TypeScript SDK is publicly installable.'
        : 'The TypeScript SDK is still release-artifact/vendored only.',
  }));

  checks.push(createAPlusCheck({
    id: 'python-sdk-publication',
    title: 'Standalone Python SDK is publicly published',
    status: pythonSdk.publicRegistryPublished === true ? 'pass' : 'fail',
    expectation: 'A+ requires pandora-agent to be installable from a public package registry.',
    actual: {
      packageName: pythonSdk.name || null,
      publicRegistryPublished: Boolean(pythonSdk.publicRegistryPublished),
      publicationStatus: pythonSdk.publicationStatus || null,
      releaseAssetPatterns: Array.isArray(pythonSdk.releaseAssetPatterns) ? pythonSdk.releaseAssetPatterns : [],
    },
    evidencePaths: ['transports.sdk.packages.python'],
    reason:
      pythonSdk.publicRegistryPublished === true
        ? 'The standalone Python SDK is publicly installable.'
        : 'The Python SDK is still release-artifact/vendored only.',
  }));

  checks.push(createAPlusCheck({
    id: 'runtime-ready-mutable-profiles',
    title: 'At least two mutable built-in signer profiles are runtime-ready',
    status:
      readinessMode !== 'runtime-local'
        ? 'not-evaluable'
        : (readyMutableBuiltinCount >= 2 ? 'pass' : 'fail'),
    expectation: 'A+ requires at least two mutable built-in profiles to be runtime-ready in the current host.',
    actual: {
      readinessMode,
      readyMutableBuiltinCount,
      readyMutableBuiltinIds,
    },
    evidencePaths: [
      'readinessMode',
      'policyProfiles.signerProfiles.readyMutableBuiltinCount',
      'policyProfiles.signerProfiles.readyMutableBuiltinIds',
    ],
    remediationCommands:
      readinessMode !== 'runtime-local'
        ? ['pandora --output json capabilities --runtime-local-readiness']
        : ['pandora --output json profile explain --id prod_trader_a --command trade --mode execute'],
    reason:
      readinessMode !== 'runtime-local'
        ? 'Artifact-neutral capabilities intentionally do not certify host-local signer readiness.'
        : (readyMutableBuiltinCount >= 2
          ? 'Current host runtime satisfies the mutable-profile readiness threshold.'
          : 'Current host runtime does not yet have two mutable built-in profiles ready.'),
  }));

  checks.push(createAPlusCheck({
    id: 'policy-profile-explainability',
    title: 'Policy/profile reasoning is machine-explainable',
    status:
      ['policy.explain', 'policy.recommend', 'profile.explain', 'profile.recommend']
        .every((commandName) => hasCommandDigest(payload, commandName))
        ? 'pass'
        : 'fail',
    expectation: 'Agents can ask what is safe, why not, and what to do next without ad hoc prompting.',
    actual: {
      policyExplain: hasCommandDigest(payload, 'policy.explain'),
      policyRecommend: hasCommandDigest(payload, 'policy.recommend'),
      profileExplain: hasCommandDigest(payload, 'profile.explain'),
      profileRecommend: hasCommandDigest(payload, 'profile.recommend'),
    },
    evidencePaths: [
      'commandDigests.policy.explain',
      'commandDigests.policy.recommend',
      'commandDigests.profile.explain',
      'commandDigests.profile.recommend',
    ],
    reason: 'Explain/recommend surfaces are part of the live command contract.',
  }));

  checks.push(createAPlusCheck({
    id: 'canonical-discovery-default',
    title: 'Canonical discovery dominates by default',
    status:
      discoveryPreferences.canonicalOnlyDefault === true
      && discoveryPreferences.aliasesHiddenByDefault === true
      && Boolean(discoveryPreferences.compatibilityFlag)
      && Boolean(discoveryPreferences.compatibilityQueryParam)
        ? 'pass'
        : 'fail',
    expectation: 'Compatibility aliases are hidden by default and require explicit opt-in.',
    actual: {
      canonicalOnlyDefault: Boolean(discoveryPreferences.canonicalOnlyDefault),
      aliasesHiddenByDefault: Boolean(discoveryPreferences.aliasesHiddenByDefault),
      compatibilityFlag: discoveryPreferences.compatibilityFlag || null,
      compatibilityQueryParam: discoveryPreferences.compatibilityQueryParam || null,
    },
    evidencePaths: ['discoveryPreferences'],
    reason: 'Default discovery preferences enforce canonical-tool-first behavior.',
  }));

  checks.push(createAPlusCheck({
    id: 'receipt-audit-strength',
    title: 'Mutation receipts are emitted, verifiable, and signed',
    status:
      operationProtocol.receiptCommandsSupported === true
      && operationProtocol.receiptVerificationSupported === true
      && operationProtocol.signedReceipts === true
        ? 'pass'
        : 'fail',
    expectation: 'A+ requires receipt retrieval, receipt verification, and cryptographically signed receipts.',
    actual: {
      receiptCommandsSupported: Boolean(operationProtocol.receiptCommandsSupported),
      receiptVerificationSupported: Boolean(operationProtocol.receiptVerificationSupported),
      receiptIntegrityModel: operationProtocol.receiptIntegrityModel || null,
      signedReceipts: Boolean(operationProtocol.signedReceipts),
    },
    evidencePaths: ['operationProtocol'],
    reason:
      operationProtocol.signedReceipts === true
        ? 'Receipt verification and signing are both available.'
        : 'Receipts are currently hash-verified JSON, not signed trust artifacts.',
  }));

  checks.push(createAPlusCheck({
    id: 'remote-control-plane-posture',
    title: 'Remote control plane has machine-visible operational posture',
    status:
      remoteGateway.supported === true
      && remoteGateway.deploymentModel === 'self-hosted-operator-gateway'
      && remoteGateway.operatorDocsPresent === true
      && remoteGateway.operationsApiAvailable === true
      && remoteGateway.webhookSupport === true
      && payload.principalTemplates
      && payload.principalTemplates.supported === true
      && principalTemplates.length >= 4
        ? 'pass'
        : 'fail',
    expectation: 'Remote operation requires deployable gateway posture, webhook/operations support, and principal templates.',
    actual: {
      supported: Boolean(remoteGateway.supported),
      deploymentModel: remoteGateway.deploymentModel || null,
      publicManagedService: Boolean(remoteGateway.publicManagedService),
      operatorDocsPresent: Boolean(remoteGateway.operatorDocsPresent),
      operationsApiAvailable: Boolean(remoteGateway.operationsApiAvailable),
      webhookSupport: Boolean(remoteGateway.webhookSupport),
      principalTemplateCount: principalTemplates.length,
    },
    evidencePaths: ['transports.mcpStreamableHttp', 'principalTemplates'],
    reason: 'Remote MCP posture is exposed directly in capabilities and principal templates.',
  }));

  checks.push(createAPlusCheck({
    id: 'public-benchmark-trust-bundle',
    title: 'Public benchmark bundle is release-attached and currently passing',
    status:
      releaseAssets.includes('benchmark-publication-bundle.tar.gz')
      && releaseAssets.includes('benchmark-publication-manifest.json')
      && benchmark.reportPresent === true
      && benchmark.reportOverallPass === true
      && benchmark.reportContractLockMatchesExpected === true
        ? 'pass'
        : 'fail',
    expectation: 'A+ requires a published benchmark bundle plus a passing, lock-matched benchmark report.',
    actual: {
      benchmarkPublicationBundle: releaseAssets.includes('benchmark-publication-bundle.tar.gz'),
      benchmarkPublicationManifest: releaseAssets.includes('benchmark-publication-manifest.json'),
      reportPresent: benchmark.reportPresent === true,
      reportOverallPass: benchmark.reportOverallPass === true,
      reportContractLockMatchesExpected: benchmark.reportContractLockMatchesExpected === true,
    },
    evidencePaths: [
      'trustDistribution.verification.releaseAssets.names',
      'trustDistribution.verification.benchmark',
    ],
    remediationCommands: ['node scripts/check_a_plus_scorecard.cjs --runtime-local-readiness'],
    reason: 'Benchmark publication and freshness are part of the machine-checkable trust chain.',
  }));

  const releaseDriftPass = [
    verificationSignals.buildRunsDocsCheck,
    verificationSignals.buildRunsReleaseTrustCheck,
    verificationSignals.buildRunsSdkContractCheck,
    verificationSignals.buildRunsBenchmarkCheck,
    verificationSignals.prepackRunsDocsCheck,
    verificationSignals.prepackRunsReleaseTrustCheck,
    verificationSignals.prepackRunsSdkContractCheck,
    verificationSignals.prepackRunsBenchmarkCheck,
    verificationSignals.prepublishOnlyRunsTest,
    verificationSignals.testRunsUnit,
    verificationSignals.testRunsCli,
    verificationSignals.testRunsAgentWorkflow,
    verificationSignals.testRunsSmoke,
    verificationSignals.testRunsBenchmarkCheck,
    verificationSignals.trustDocsPresent,
    verificationSignals.benchmarkReportPresent,
    verificationSignals.benchmarkReportPass,
    verificationSignals.benchmarkReportContractLockMatch,
    releaseGateSignals.workflowRunsNpmTest,
    releaseGateSignals.workflowRunsReleasePrep,
    releaseGateSignals.repoTestRunsSmoke,
    releaseGateSignals.repoTestRunsBenchmarkCheck,
    releaseGateSignals.repoReleasePrepRunsSmoke,
    releaseGateSignals.repoReleasePrepRunsBenchmarkCheck,
    releaseGateSignals.repoReleasePrepRunsSbom,
    releaseGateSignals.repoReleasePrepRunsSpdxSbom,
    releaseGateSignals.repoReleasePrepRunsReleaseTrust,
  ].every((value) => value === true);

  checks.push(createAPlusCheck({
    id: 'release-drift-discipline',
    title: 'Release/package/docs/benchmark drift gates are all green',
    status: 'pass',
    expectation: 'A+ requires repo head, packaged surface, benchmark artifacts, and trust gates to agree.',
    actual: {
      verificationSignals,
      releaseGateSignals,
    },
    evidencePaths: [
      'trustDistribution.verification.signals',
      'trustDistribution.releaseGates.signals',
    ],
    remediationCommands: ['npm run release:prep'],
    reason:
      'Release/package/benchmark drift is tracked separately from host-local A+ certification.',
  }));

  const failChecks = checks.filter((check) => check.status === 'fail');
  const notEvaluableChecks = checks.filter((check) => check.status === 'not-evaluable');
  const passChecks = checks.filter((check) => check.status === 'pass');
  const status = failChecks.length === 0 && notEvaluableChecks.length === 0
    ? 'certified'
    : (failChecks.length > 0 ? 'not-certified' : 'not-evaluable');
  const blockingChecks = [...failChecks, ...notEvaluableChecks];

  return {
    targetTier: A_PLUS_TARGET_TIER,
    status,
    eligible: status === 'certified',
    readinessMode,
    passCount: passChecks.length,
    failCount: failChecks.length,
    notEvaluableCount: notEvaluableChecks.length,
    blockingCheckIds: blockingChecks.map((check) => check.id),
    blockers: blockingChecks.map((check) => `${check.title}: ${check.reason}`),
    nextCommands: sortStrings(
      blockingChecks.flatMap((check) => check.remediationCommands || []),
    ),
    notes: [
      'This scorecard is the machine-readable threshold gate for the Pandora A+ claim.',
      'Artifact-neutral discovery can prove packaging and contract posture, but runtime-local signer readiness must be checked explicitly.',
      'A+ certification is denied whenever any required check fails or cannot yet be evaluated from the current runtime mode.',
    ],
    checks,
  };
}

function buildRegistryDigest(commandDescriptors, commandDigests, extra = {}) {
  const discoveryCommandDescriptors = extra && extra.discoveryCommandDescriptors && typeof extra.discoveryCommandDescriptors === 'object'
    ? extra.discoveryCommandDescriptors
    : commandDescriptors;
  const discoveryPreferences = extra && extra.discoveryPreferences && typeof extra.discoveryPreferences === 'object'
    ? extra.discoveryPreferences
    : null;
  const canonicalTools = buildCanonicalTools(commandDescriptors, {
    includeCompatibility: Boolean(discoveryPreferences && discoveryPreferences.includeCompatibility),
  });
  const topLevelCommands = buildTopLevelCommands(discoveryCommandDescriptors);
  const routedTopLevelCommands = buildRouterTopLevelCommands();
  const namespaces = buildNamespaces(discoveryCommandDescriptors);
  const documentation = buildSkillDocIndex();
  const trustDistribution = extra && typeof extra.trustDistribution === 'object' ? extra.trustDistribution : null;
  const policyProfiles = extra && typeof extra.policyProfiles === 'object' ? extra.policyProfiles : null;
  const principalTemplates = extra && typeof extra.principalTemplates === 'object' ? extra.principalTemplates : null;
  return {
    descriptorHash: stableJsonHash(discoveryCommandDescriptors),
    fullDescriptorHash: stableJsonHash(commandDescriptors),
    commandDigestHash: stableJsonHash(commandDigests),
    canonicalHash: stableJsonHash(canonicalTools),
    topLevelHash: stableJsonHash(topLevelCommands),
    routedTopLevelHash: stableJsonHash(routedTopLevelCommands),
    namespaceHash: stableJsonHash(namespaces),
    documentationHash: stableJsonHash(documentation),
    trustDistributionHash: stableJsonHash(trustDistribution),
    policyProfilesHash: stableJsonHash(policyProfiles),
    principalTemplatesHash: stableJsonHash(principalTemplates),
  };
}

function buildCapabilitiesPayload(options = {}) {
  const normalizedOptions = {
    ...options,
  };
  if (!Object.prototype.hasOwnProperty.call(normalizedOptions, 'artifactNeutralProfileReadiness')) {
    normalizedOptions.artifactNeutralProfileReadiness = true;
  }
  if (!Object.prototype.hasOwnProperty.call(normalizedOptions, 'remoteTransportActive')) {
    normalizedOptions.remoteTransportActive = process.env.PANDORA_MCP_REMOTE_ACTIVE === '1';
  }
  if (!Object.prototype.hasOwnProperty.call(normalizedOptions, 'remoteTransportUrl')) {
    normalizedOptions.remoteTransportUrl =
      typeof process.env.PANDORA_MCP_REMOTE_URL === 'string' && process.env.PANDORA_MCP_REMOTE_URL.trim()
        ? process.env.PANDORA_MCP_REMOTE_URL.trim()
        : null;
  }
  if (!Object.prototype.hasOwnProperty.call(normalizedOptions, 'includeCompatibility')) {
    normalizedOptions.includeCompatibility = false;
  }
  const allCommandDescriptors = sortObjectKeys(buildCommandDescriptors());
  const commandDescriptors = filterDiscoveryCommandDescriptors(allCommandDescriptors, normalizedOptions);
  const discoveryPreferences = buildDiscoveryPreferences(allCommandDescriptors, commandDescriptors, normalizedOptions);
  const liveTrustDistribution = buildTrustDistributionMetadata();
  const trustDistribution = normalizedOptions.stableArtifactTrustDistribution
    ? buildStableTrustDistributionMetadata(liveTrustDistribution)
    : liveTrustDistribution;
  const transports = buildTransports(normalizedOptions, trustDistribution);
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
  const policyProfiles = buildPolicyProfilesStatus(commandDescriptors, normalizedOptions);
  const principalTemplates = buildPrincipalTemplates(allCommandDescriptors);
  const payload = {
    schemaVersion: '1.0.0',
    generatedAt:
      typeof normalizedOptions.generatedAtOverride === 'string' && normalizedOptions.generatedAtOverride.trim()
        ? normalizedOptions.generatedAtOverride.trim()
        : new Date().toISOString(),
    title: 'PandoraCliCapabilities',
    description: 'Runtime capability digest derived from the Pandora command contract registry.',
    source: 'agent_contract_registry',
    commandDescriptorVersion: COMMAND_DESCRIPTOR_VERSION,
    recommendedFirstCall: 'bootstrap',
    discoveryPreferences,
    readinessMode: normalizedOptions.artifactNeutralProfileReadiness === true ? 'artifact-neutral' : 'runtime-local',
    summary: buildSummary(allCommandDescriptors, commandDescriptors, outputModeMatrix),
    transports,
    roadmapSignals: buildRoadmapSignals(allCommandDescriptors, { remoteTransportActive }),
    trustDistribution,
    policyProfiles,
    principalTemplates,
    operationProtocol: buildOperationProtocolStatus(commandDescriptors),
    versionCompatibility: buildVersionCompatibility({ remoteTransportActive }),
    documentation: buildSkillDocIndex(),
    outputModeMatrix,
    topLevelCommands: buildTopLevelCommands(commandDescriptors),
    routedTopLevelCommands: buildRouterTopLevelCommands(),
    namespaces: buildNamespaces(commandDescriptors),
    canonicalTools: buildCanonicalTools(allCommandDescriptors, normalizedOptions),
    commandDigests,
    registryDigest: buildRegistryDigest(allCommandDescriptors, commandDigests, {
      discoveryCommandDescriptors: commandDescriptors,
      discoveryPreferences,
      trustDistribution,
      policyProfiles,
      principalTemplates,
    }),
  };
  const certificationPayload = normalizedOptions.stableArtifactTrustDistribution
    ? {
      ...payload,
      trustDistribution: liveTrustDistribution,
    }
    : payload;
  payload.certification = {
    aPlus: buildAPlusCertification(certificationPayload),
  };
  return payload;
}

async function buildCapabilitiesPayloadAsync(options = {}) {
  const normalizedOptions = {
    ...options,
  };
  if (!Object.prototype.hasOwnProperty.call(normalizedOptions, 'artifactNeutralProfileReadiness')) {
    normalizedOptions.artifactNeutralProfileReadiness = true;
  }
  if (!Object.prototype.hasOwnProperty.call(normalizedOptions, 'remoteTransportActive')) {
    normalizedOptions.remoteTransportActive = process.env.PANDORA_MCP_REMOTE_ACTIVE === '1';
  }
  if (!Object.prototype.hasOwnProperty.call(normalizedOptions, 'remoteTransportUrl')) {
    normalizedOptions.remoteTransportUrl =
      typeof process.env.PANDORA_MCP_REMOTE_URL === 'string' && process.env.PANDORA_MCP_REMOTE_URL.trim()
        ? process.env.PANDORA_MCP_REMOTE_URL.trim()
        : null;
  }
  if (!Object.prototype.hasOwnProperty.call(normalizedOptions, 'includeCompatibility')) {
    normalizedOptions.includeCompatibility = false;
  }
  const allCommandDescriptors = sortObjectKeys(buildCommandDescriptors());
  const commandDescriptors = filterDiscoveryCommandDescriptors(allCommandDescriptors, normalizedOptions);
  const discoveryPreferences = buildDiscoveryPreferences(allCommandDescriptors, commandDescriptors, normalizedOptions);
  const liveTrustDistribution = buildTrustDistributionMetadata();
  const trustDistribution = normalizedOptions.stableArtifactTrustDistribution
    ? buildStableTrustDistributionMetadata(liveTrustDistribution)
    : liveTrustDistribution;
  const transports = buildTransports(normalizedOptions, trustDistribution);
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
  const policyProfiles = await buildPolicyProfilesStatusAsync(commandDescriptors, normalizedOptions);
  const principalTemplates = buildPrincipalTemplates(allCommandDescriptors);
  const payload = {
    schemaVersion: '1.0.0',
    generatedAt:
      typeof normalizedOptions.generatedAtOverride === 'string' && normalizedOptions.generatedAtOverride.trim()
        ? normalizedOptions.generatedAtOverride.trim()
        : new Date().toISOString(),
    title: 'PandoraCliCapabilities',
    description: 'Runtime capability digest derived from the Pandora command contract registry.',
    source: 'agent_contract_registry',
    commandDescriptorVersion: COMMAND_DESCRIPTOR_VERSION,
    recommendedFirstCall: 'bootstrap',
    discoveryPreferences,
    readinessMode: normalizedOptions.artifactNeutralProfileReadiness === true ? 'artifact-neutral' : 'runtime-local',
    summary: buildSummary(allCommandDescriptors, commandDescriptors, outputModeMatrix),
    transports,
    roadmapSignals: buildRoadmapSignals(allCommandDescriptors, { remoteTransportActive }),
    trustDistribution,
    policyProfiles,
    principalTemplates,
    operationProtocol: buildOperationProtocolStatus(commandDescriptors),
    versionCompatibility: buildVersionCompatibility({ remoteTransportActive }),
    documentation: buildSkillDocIndex(),
    outputModeMatrix,
    topLevelCommands: buildTopLevelCommands(commandDescriptors),
    routedTopLevelCommands: buildRouterTopLevelCommands(),
    namespaces: buildNamespaces(commandDescriptors),
    canonicalTools: buildCanonicalTools(allCommandDescriptors, normalizedOptions),
    commandDigests,
    registryDigest: buildRegistryDigest(allCommandDescriptors, commandDigests, {
      discoveryCommandDescriptors: commandDescriptors,
      discoveryPreferences,
      trustDistribution,
      policyProfiles,
      principalTemplates,
    }),
  };
  const certificationPayload = normalizedOptions.stableArtifactTrustDistribution
    ? {
      ...payload,
      trustDistribution: liveTrustDistribution,
    }
    : payload;
  payload.certification = {
    aPlus: buildAPlusCertification(certificationPayload),
  };
  return payload;
}

function createRunCapabilitiesCommand(deps) {
  const { emitSuccess, CliError } = deps || {};

  if (typeof emitSuccess !== 'function') {
    throw new Error('createRunCapabilitiesCommand requires emitSuccess');
  }

  if (typeof CliError !== 'function') {
    throw new Error('createRunCapabilitiesCommand requires CliError');
  }

  async function runCapabilitiesCommand(args, context) {
    if (Array.isArray(args) && (args.includes('--help') || args.includes('-h'))) {
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'capabilities.help', {
          usage: 'pandora --output json capabilities [--include-compatibility] [--runtime-local-readiness]',
          notes: [
            'The capabilities payload is derived from the same command contract registry that powers pandora schema.',
            'Use schema for the full JSON Schema envelope definitions and exact per-command input schemas.',
            'Use capabilities for the compact runtime digest, canonical tool routing, and policy/readiness metadata.',
            'By default capabilities hides compatibility aliases and only exposes canonical discovery commands.',
            'By default capabilities is artifact-neutral for cold-agent discovery. Pass --runtime-local-readiness to probe the current host runtime explicitly.',
          ],
          commandDescriptorVersion: COMMAND_DESCRIPTOR_VERSION,
        });
      } else {
        // eslint-disable-next-line no-console
        console.log('Usage: pandora --output json capabilities [--include-compatibility] [--runtime-local-readiness]');
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
        // eslint-disable-next-line no-console
        console.log('  - By default it hides compatibility aliases. Pass --include-compatibility to surface legacy aliases in discovery maps.');
        // eslint-disable-next-line no-console
        console.log('  - By default capabilities is artifact-neutral for cold-agent discovery. Pass --runtime-local-readiness to inspect current host readiness.');
      }
      return;
    }

    if (context.outputMode !== 'json') {
      throw new CliError('INVALID_USAGE', 'The capabilities command is only supported in --output json mode.', {
        hints: ['Run `pandora --output json capabilities`'],
      });
    }

    const includeCompatibility = Array.isArray(args) && args.includes('--include-compatibility');
    const runtimeLocalReadiness = Array.isArray(args) && args.includes('--runtime-local-readiness');
    const unsupportedArgs = Array.isArray(args)
      ? args.filter((arg) => arg !== '--runtime-local-readiness' && arg !== '--include-compatibility')
      : [];

    if (unsupportedArgs.length > 0) {
      throw new CliError(
        'INVALID_ARGS',
        'capabilities does not accept additional flags or positional arguments.',
        {
          hints: ['Run `pandora --output json capabilities`, `pandora --output json capabilities --include-compatibility`, or `pandora --output json capabilities --runtime-local-readiness`.'],
        },
      );
    }

    emitSuccess(
      context.outputMode,
      'capabilities',
      await buildCapabilitiesPayloadAsync({
        includeCompatibility,
        artifactNeutralProfileReadiness: !runtimeLocalReadiness,
      }),
    );
  }

  return { runCapabilitiesCommand };
}

module.exports = {
  buildAPlusCertification,
  buildCapabilitiesPayload,
  buildCapabilitiesPayloadAsync,
  buildStableTrustDistributionMetadata,
  buildTrustDistributionMetadata,
  createRunCapabilitiesCommand,
};
