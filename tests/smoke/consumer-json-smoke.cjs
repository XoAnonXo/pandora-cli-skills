#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const PREPARE_PUBLISH_MANIFEST = path.join(ROOT, 'scripts', 'prepare_publish_manifest.cjs');
const { buildPublishedPackageJson } = require('../../scripts/prepare_publish_manifest.cjs');
const RESTORE_PUBLISH_MANIFEST = path.join(ROOT, 'scripts', 'restore_publish_manifest.cjs');
const NPM_CMD = 'npm';
const NODE_CMD = process.execPath;
const PACK_TIMEOUT_MS = process.platform === 'win32' ? 180_000 : 180_000;
const INSTALL_TIMEOUT_MS = process.platform === 'win32' ? 360_000 : 180_000;
const REQUIRED_ENV_KEYS = [
  'CHAIN_ID',
  'RPC_URL',
  'PANDORA_PRIVATE_KEY',
  'PRIVATE_KEY',
  'ORACLE',
  'FACTORY',
  'USDC',
  'DEPLOYER_PRIVATE_KEY',
  'PANDORA_PROFILE_FILE',
  'PANDORA_POLICY_DIR',
  'PANDORA_POLICIES_DIR',
];

function run(command, args, options = {}) {
  const spawnOptions = {
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    timeout: options.timeoutMs || 60_000,
  };

  if (typeof options.shell === 'boolean') {
    spawnOptions.shell = options.shell;
  }

  if (process.platform !== 'win32') {
    spawnOptions.killSignal = 'SIGKILL';
  }

  const result = spawnSync(command, args, spawnOptions);
  const output = `${result.stdout || ''}${result.stderr || ''}`;

  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      throw new Error(`${command} ${args.join(' ')} timed out after ${options.timeoutMs || 60_000}ms`);
    }
    throw result.error;
  }

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output,
  };
}

function ensureExitCode(result, expected, label) {
  if (result.status !== expected) {
    throw new Error(`${label} exited with ${result.status}, expected ${expected}.\nOutput:\n${result.output}`);
  }
}

function parseJsonStdout(result, label) {
  const text = String(result.stdout || '').trim();
  if (!text) {
    throw new Error(`${label} returned empty stdout.`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON.\nStdout:\n${text}\nError: ${error.message}`);
  }
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildIsolatedPandoraEnv(rootDir, overrides = {}) {
  const env = { ...process.env };
  for (const key of REQUIRED_ENV_KEYS) {
    delete env[key];
  }

  const homeDir = path.join(rootDir, 'home');
  const policyDir = path.join(rootDir, 'policies');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(policyDir, { recursive: true });

  Object.assign(env, {
    HOME: homeDir,
    USERPROFILE: homeDir,
    PANDORA_PROFILE_FILE: path.join(rootDir, 'profiles.json'),
    PANDORA_POLICY_DIR: policyDir,
    PANDORA_POLICIES_DIR: policyDir,
  });

  for (const [key, value] of Object.entries(overrides)) {
    env[key] = value;
  }

  return env;
}

function ensureMissingPath(targetPath, message) {
  ensure(!fs.existsSync(targetPath), message);
}

function moveFileSafe(from, to) {
  try {
    fs.renameSync(from, to);
  } catch (error) {
    if (error && error.code !== 'EXDEV') {
      throw error;
    }
    fs.copyFileSync(from, to);
    fs.unlinkSync(from);
  }
}

function runNpm(args, options = {}) {
  return run(NPM_CMD, args, {
    ...options,
    shell: process.platform === 'win32',
  });
}

function runPandora(installedCli, args, options = {}) {
  return run(NODE_CMD, [installedCli, ...args], options);
}

function restorePublishManifest() {
  return run(NODE_CMD, [RESTORE_PUBLISH_MANIFEST], {
    cwd: ROOT,
    timeoutMs: 120_000,
  });
}

function preparePublishManifest() {
  return run(NODE_CMD, [PREPARE_PUBLISH_MANIFEST], {
    cwd: ROOT,
    timeoutMs: 120_000,
  });
}

function ensurePublishManifestRestored(label = 'restore publish manifest') {
  ensureExitCode(restorePublishManifest(), 0, label);
}

function extractTarball(tarballPath, extractDir) {
  fs.mkdirSync(extractDir, { recursive: true });
  ensureExitCode(
    run('tar', ['-xzf', tarballPath, '-C', extractDir], { timeoutMs: 120_000 }),
    0,
    'tar extract package',
  );
}

function getPackResult(packDir, options = {}) {
  const packArgs = ['pack', '--silent'];
  if (options.ignoreScripts) {
    packArgs.push('--ignore-scripts');
  }

  if (process.platform === 'win32') {
    const fallback = runNpm(packArgs, { timeoutMs: PACK_TIMEOUT_MS });
    if (fallback.status !== 0) return fallback;

    const tarball = fallback.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    if (!tarball) throw new Error('Could not determine tarball name from npm pack output.');

    moveFileSafe(path.join(ROOT, tarball), path.join(packDir, tarball));
    fallback.stdout = `${tarball}\n`;
    return fallback;
  }

  const withDestination = runNpm([...packArgs, '--pack-destination', packDir], {
    timeoutMs: PACK_TIMEOUT_MS,
  });
  if (withDestination.status === 0) return withDestination;
  if (!/pack-destination/.test(withDestination.output)) return withDestination;

  const fallback = runNpm(packArgs, { timeoutMs: PACK_TIMEOUT_MS });
  if (fallback.status !== 0) return fallback;

  const tarball = fallback.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (!tarball) throw new Error('Could not determine tarball name from npm pack output.');

  moveFileSafe(path.join(ROOT, tarball), path.join(packDir, tarball));
  fallback.stdout = `${tarball}\n`;
  return fallback;
}

function validateVersionPayload(payload) {
  ensure(payload && payload.ok === true, 'version payload must set ok=true.');
  ensure(payload.command === 'version', `version payload command mismatch: ${payload.command}`);
  ensure(payload.data && typeof payload.data.version === 'string', 'version payload missing data.version.');
  ensure(/^\d+\.\d+\.\d+/.test(payload.data.version), `version is not semver-like: ${payload.data.version}`);
}

function validateHelpPayload(payload) {
  ensure(payload && payload.ok === true, 'help payload must set ok=true.');
  ensure(payload.command === 'help', `help payload command mismatch: ${payload.command}`);
  ensure(payload.data && Array.isArray(payload.data.usage), 'help payload missing usage array.');
  ensure(payload.data.usage.some((line) => String(line).includes('mirror')), 'help payload usage is missing mirror command listing.');
}

function validateCapabilitiesPayload(payload, installedPackageJson) {
  const installedScripts = (installedPackageJson && installedPackageJson.scripts) || {};
  ensure(payload && payload.ok === true, 'capabilities payload must set ok=true.');
  ensure(payload.command === 'capabilities', `capabilities payload command mismatch: ${payload.command}`);
  ensure(payload.data && payload.data.policyProfiles, 'capabilities payload missing policyProfiles.');
  ensure(payload.data.transports && payload.data.transports.sdk, 'capabilities payload missing sdk transport metadata.');
  ensure(payload.data.transports.sdk.supported === true, 'capabilities payload should advertise sdk support.');
  ensure(payload.data.policyProfiles.policyPacks.userCount === 0, 'capabilities payload should not discover user policy packs in isolated smoke env.');
  ensure(
    Array.isArray(payload.data.policyProfiles.policyPacks.userSampleIds)
      && payload.data.policyProfiles.policyPacks.userSampleIds.length === 0,
    'capabilities payload should not report user policy sample ids in isolated smoke env.',
  );
  ensure(
    Array.isArray(payload.data.policyProfiles.policyPacks.builtinIds)
      && payload.data.policyProfiles.policyPacks.builtinIds.includes('execute-with-validation'),
    'capabilities payload missing execute-with-validation builtin policy.',
  );
  ensure(
    Array.isArray(payload.data.policyProfiles.signerProfiles.builtinIds)
      && payload.data.policyProfiles.signerProfiles.builtinIds.includes('prod_trader_a'),
    'capabilities payload missing prod_trader_a builtin profile.',
  );
  ensure(
    Array.isArray(payload.data.policyProfiles.signerProfiles.signerBackends)
      && ['external-signer', 'local-env', 'local-keystore', 'read-only']
        .every((backend) => payload.data.policyProfiles.signerProfiles.signerBackends.includes(backend)),
    'capabilities payload missing expected signer backends.',
  );
  ensure(payload.data.documentation && typeof payload.data.documentation.contentHash === 'string', 'capabilities payload missing documentation content hash.');
  ensure(
    Array.isArray(payload.data.documentation.skills)
      && payload.data.documentation.skills.some((doc) => doc.path === 'docs/skills/mirror-operations.md'),
    'capabilities payload missing mirror-operations skill doc.',
  );
  ensure(
    Array.isArray(payload.data.documentation.skills)
      && payload.data.documentation.skills.some((doc) => doc.path === 'docs/trust/release-verification.md'),
    'capabilities payload missing release-verification trust doc.',
  );
  ensure(
    Array.isArray(payload.data.documentation.skills)
      && payload.data.documentation.skills.some((doc) => doc.path === 'docs/trust/support-matrix.md'),
    'capabilities payload missing support-matrix trust doc.',
  );
  ensure(
    Array.isArray(payload.data.documentation.router?.taskRoutes)
      && payload.data.documentation.router.taskRoutes.some((route) => route.docId === 'mirror-operations'),
    'capabilities payload missing mirror-operations task route.',
  );
  ensure(
    Array.isArray(payload.data.documentation.router?.taskRoutes)
      && payload.data.documentation.router.taskRoutes.some((route) => route.docId === 'release-verification'),
    'capabilities payload missing release-verification task route.',
  );
  ensure(payload.data.trustDistribution && payload.data.trustDistribution.distribution.signals.shipsTrustDocs === true,
    'capabilities payload should advertise shipped trust docs.');
  ensure(payload.data.trustDistribution.distribution.platformValidation.ci.workflowPath === '.github/workflows/ci.yml',
    'capabilities payload should expose CI workflow path.');
  ensure(
    JSON.stringify(payload.data.trustDistribution.distribution.platformValidation.ci.osMatrix) === JSON.stringify([]),
    'capabilities payload should expose an empty shipped-package CI os matrix when workflow files are not shipped.',
  );
  ensure(
    JSON.stringify(payload.data.trustDistribution.distribution.platformValidation.ci.nodeVersions) === JSON.stringify([]),
    'capabilities payload should expose an empty shipped-package CI node-version matrix when workflow files are not shipped.',
  );
  ensure(payload.data.trustDistribution.distribution.signals.shipsReleaseTrustScripts === false,
    'capabilities payload should not advertise shipped release-trust scripts for the published package.');
  ensure(payload.data.trustDistribution.distribution.signals.shipsBenchmarkHarness === false,
    'capabilities payload should not advertise the full benchmark harness in the published package.');
  ensure(payload.data.trustDistribution.distribution.signals.shipsBenchmarkReport === true,
    'capabilities payload should advertise the shipped benchmark report.');
  ensure(payload.data.trustDistribution.verification.ciWorkflow.path === '.github/workflows/ci.yml',
    'capabilities payload should expose CI workflow metadata.');
  ensure(payload.data.trustDistribution.verification.ciWorkflow.present === false,
    'capabilities payload should report CI workflow files as absent from the published package.');
  ensure(
    Array.isArray(payload.data.trustDistribution.verification.releaseAssets.names)
      && payload.data.trustDistribution.verification.releaseAssets.names.includes('checksums.sha256'),
    'capabilities payload should expose release asset names.',
  );
  ensure(
    Array.isArray(payload.data.trustDistribution.verification.releaseAssets.verificationMethods)
      && payload.data.trustDistribution.verification.releaseAssets.verificationMethods.includes('keyless-cosign-verify-blob'),
    'capabilities payload should expose release verification methods.',
  );
  ensure(payload.data.trustDistribution.verification.scripts.generateSbom === null,
    'capabilities payload should not expose generateSbom in the published package.');
  ensure(payload.data.trustDistribution.verification.scripts.checkReleaseTrust === null,
    'capabilities payload should not expose checkReleaseTrust in the published package.');
  ensure(payload.data.trustDistribution.verification.scripts.releasePrep === null,
    'capabilities payload should not expose releasePrep in the published package.');
  ensure(payload.data.trustDistribution.verification.scripts.benchmarkCheck === null,
    'capabilities payload should not expose benchmarkCheck in the published package.');
  ensure(payload.data.trustDistribution.verification.benchmark.reportPath === 'benchmarks/latest/core-report.json',
    'capabilities payload should expose benchmarks/latest/core-report.json as the latest benchmark report path.');
  ensure(payload.data.trustDistribution.verification.benchmark.bundlePath === 'benchmarks/latest/core-bundle.json',
    'capabilities payload should expose benchmarks/latest/core-bundle.json as the benchmark publication bundle path.');
  ensure(payload.data.trustDistribution.verification.benchmark.historyPath === 'benchmarks/latest/core-history.json',
    'capabilities payload should expose benchmarks/latest/core-history.json as the benchmark history path.');
  ensure(payload.data.trustDistribution.verification.benchmark.docsHistoryPath === 'docs/benchmarks/history.json',
    'capabilities payload should expose docs/benchmarks/history.json as the docs history path.');
  ensure(payload.data.trustDistribution.verification.benchmark.reportPresent === true,
    'capabilities payload should report benchmark report presence.');
  ensure(payload.data.trustDistribution.verification.benchmark.bundlePresent === true,
    'capabilities payload should report benchmark bundle presence.');
  ensure(payload.data.trustDistribution.verification.benchmark.historyPresent === true,
    'capabilities payload should report benchmark history presence.');
  ensure(payload.data.trustDistribution.verification.benchmark.docsHistoryPresent === true,
    'capabilities payload should report docs benchmark history presence.');
  ensure(payload.data.trustDistribution.verification.benchmark.reportOverallPass === true,
    'capabilities payload should report a green packaged benchmark report.');
  ensure(payload.data.trustDistribution.verification.benchmark.reportContractLockMatchesExpected === true,
    'capabilities payload should report benchmark lock/report parity.');
  for (const fieldName of [
    'build',
    'prepack',
    'prepublishOnly',
    'test',
    'testUnit',
    'testCli',
    'testAgentWorkflow',
    'testSmoke',
    'checkSdkContracts',
    'checkDocs',
  ]) {
    ensure(payload.data.trustDistribution.verification.scripts[fieldName] === null,
      `capabilities payload should not expose repo-only script ${fieldName} for the packaged manifest.`);
  }
  ensure(payload.data.trustDistribution.verification.signals.releasePrepRunsBenchmarkCheck === false,
    'capabilities payload should not report benchmark:check in the published manifest release:prep.');
  ensure(payload.data.trustDistribution.verification.signals.releasePrepRunsSbom === false,
    'capabilities payload should not report generate:sbom in the published manifest release:prep.');
  ensure(payload.data.trustDistribution.verification.signals.releasePrepRunsSpdxSbom === false,
    'capabilities payload should not report generate:sbom:spdx in the published manifest release:prep.');
  ensure(payload.data.trustDistribution.verification.signals.releasePrepRunsTrustCheck === false,
    'capabilities payload should not report check:release-trust in the published manifest release:prep.');
  ensure(payload.data.trustDistribution.verification.signals.benchmarkReportPresent === true,
    'capabilities payload should report benchmarkReportPresent=true.');
  ensure(payload.data.trustDistribution.verification.signals.benchmarkReportPass === true,
    'capabilities payload should report benchmarkReportPass=true.');
  ensure(payload.data.trustDistribution.verification.signals.benchmarkReportContractLockMatch === true,
    'capabilities payload should report benchmarkReportContractLockMatch=true.');
  ensure(payload.data.trustDistribution.releaseGates.signals.workflowRunsNpmTest === false,
    'capabilities payload should report workflowRunsNpmTest=false when release workflow files are not shipped.');
  ensure(payload.data.trustDistribution.releaseGates.signals.workflowRunsReleasePrep === false,
    'capabilities payload should report workflowRunsReleasePrep=false when release workflow files are not shipped.');
  ensure(payload.data.trustDistribution.releaseGates.signals.repoTestRunsSmoke === true,
    'capabilities payload should continue to report repoTestRunsSmoke=true because shipped trust docs describe the repository release pipeline.');
  ensure(payload.data.trustDistribution.releaseGates.signals.repoReleasePrepRunsSmoke === true,
    'capabilities payload should continue to report repoReleasePrepRunsSmoke=true because shipped trust docs describe the repository release pipeline.');
  ensure(payload.data.trustDistribution.releaseGates.signals.publishedSmokeCommandExposed === false,
    'capabilities payload should report publishedSmokeCommandExposed=false.');
  ensure(payload.data.trustDistribution.releaseGates.signals.packagedSmokeFixturesPresent === false,
    'capabilities payload should report packagedSmokeFixturesPresent=false.');
}

function validateSchemaPayload(payload) {
  ensure(payload && payload.ok === true, 'schema payload must set ok=true.');
  ensure(payload.command === 'schema', `schema payload command mismatch: ${payload.command}`);
  ensure(payload.data && payload.data.definitions, 'schema payload missing definitions.');
  ensure(payload.data.definitions.CapabilitiesPolicyProfileSection, 'schema payload missing CapabilitiesPolicyProfileSection.');
  ensure(payload.data.definitions.CapabilitiesSignerProfileSection, 'schema payload missing CapabilitiesSignerProfileSection.');
  ensure(payload.data.commandDescriptors && payload.data.commandDescriptors['policy.list'], 'schema payload missing policy.list descriptor.');
  ensure(payload.data.commandDescriptors && payload.data.commandDescriptors['profile.validate'], 'schema payload missing profile.validate descriptor.');
  ensure(payload.data && payload.data.trustDistribution, 'schema payload missing trustDistribution.');
}

function validateLpExplainNeutrality(payload) {
  ensure(payload && payload.ok === true, 'lp-explain payload must set ok=true.');
  ensure(payload.command === 'mirror.lp-explain', `lp-explain payload command mismatch: ${payload.command}`);
  const inventory = payload.data && payload.data.flow && payload.data.flow.totalLpInventory;
  ensure(inventory && typeof inventory === 'object', 'lp-explain payload missing flow.totalLpInventory.');
  ensure(inventory.neutralCompleteSets === true, 'lp-explain neutrality invariant failed: neutralCompleteSets=false.');
  ensure(Number(inventory.totalYesUsdc) === Number(inventory.totalNoUsdc), 'lp-explain invariant failed: totalYesUsdc != totalNoUsdc.');
  ensure(Number(inventory.deltaUsdc) === 0, 'lp-explain invariant failed: deltaUsdc != 0.');
}

function havePython() {
  const probe = run('python3', ['--version'], { timeoutMs: 10_000 });
  return probe.status === 0;
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-consumer-json-smoke-'));
  const packDir = path.join(tempRoot, 'pack');
  const appDir = path.join(tempRoot, 'app');
  const extractDir = path.join(tempRoot, 'extract');
  const runtimeDir = path.join(tempRoot, 'runtime');
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(extractDir, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });

  try {
    ensurePublishManifestRestored('pre-consumer smoke publish manifest cleanup');
    const prepareResult = preparePublishManifest();
    ensureExitCode(prepareResult, 0, 'prepare publish manifest');

    let pack;
    try {
      pack = getPackResult(packDir, { ignoreScripts: true });
      ensureExitCode(pack, 0, 'npm pack --ignore-scripts');
    } finally {
      const restoreResult = restorePublishManifest();
      ensureExitCode(restoreResult, 0, 'restore publish manifest');
    }

    const tarballName = pack.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    if (!tarballName) {
      throw new Error(`Unable to read tarball name from npm pack output:\n${pack.output}`);
    }

    const tarballPath = path.join(packDir, tarballName);
    ensure(fs.existsSync(tarballPath), `Tarball not found at ${tarballPath}`);

    extractTarball(tarballPath, extractDir);

    const installedPackageRoot = path.join(extractDir, 'package');
    const installedCli = path.join(installedPackageRoot, 'cli', 'pandora.cjs');
    ensure(fs.existsSync(installedCli), `Installed CLI not found at ${installedCli}`);
    const installedPackageJson = JSON.parse(
      fs.readFileSync(path.join(installedPackageRoot, 'package.json'), 'utf8'),
    );
    const expectedPublishedManifest = buildPublishedPackageJson(JSON.parse(
      fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
    ));
    ensure(
      JSON.stringify(installedPackageJson) === JSON.stringify(expectedPublishedManifest),
      'Installed package.json does not match the prepared publish manifest.',
    );
    const installedScripts = installedPackageJson.scripts || {};
    for (const scriptName of ['cli', 'init-env', 'doctor', 'setup', 'dry-run', 'execute', 'dry-run:clone']) {
      ensure(typeof installedScripts[scriptName] === 'string' && installedScripts[scriptName].length > 0,
        `Installed package is missing published script ${scriptName}.`);
    }
    for (const scriptName of [
      'build',
      'prepack',
      'prepare:publish-manifest',
      'check:docs',
      'clean:sdk-python-cache',
      'check:sdk-contracts',
      'generate:sdk-contracts',
      'test',
      'test:unit',
      'test:cli',
      'test:agent-workflow',
      'test:smoke',
    ]) {
      ensure(!Object.prototype.hasOwnProperty.call(installedScripts, scriptName),
        `Installed package should not expose repo-only script ${scriptName}.`);
    }
    ensure(
      fs.existsSync(path.join(installedPackageRoot, 'sdk', 'generated', 'contract-registry.json')),
      'Installed package is missing sdk/generated/contract-registry.json.',
    );
    ensure(
      fs.existsSync(path.join(installedPackageRoot, 'sdk', 'typescript', 'generated', 'manifest.json')),
      'Installed package is missing sdk/typescript/generated/manifest.json.',
    );
    ensure(
      fs.existsSync(path.join(installedPackageRoot, 'sdk', 'python', 'pandora_agent', 'generated', 'manifest.json')),
      'Installed package is missing sdk/python/pandora_agent/generated/manifest.json.',
    );
    ensure(
      fs.existsSync(path.join(installedPackageRoot, 'sdk', 'generated', 'index.js')),
      'Installed package is missing sdk/generated/index.js.',
    );
    ensure(
      fs.existsSync(path.join(installedPackageRoot, 'sdk', 'generated', 'package.json')),
      'Installed package is missing sdk/generated/package.json.',
    );
    ensure(
      fs.existsSync(path.join(installedPackageRoot, 'sdk', 'python', 'pyproject.toml')),
      'Installed package is missing sdk/python/pyproject.toml.',
    );
    ensure(
      fs.existsSync(path.join(installedPackageRoot, 'docs', 'benchmarks', 'README.md')),
      'Installed package is missing docs/benchmarks/README.md.',
    );
    ensure(
      fs.existsSync(path.join(installedPackageRoot, 'benchmarks', 'latest', 'core-report.json')),
      'Installed package is missing benchmarks/latest/core-report.json.',
    );
    ensure(
      fs.existsSync(path.join(installedPackageRoot, 'benchmarks', 'locks', 'core.lock.json')),
      'Installed package is missing benchmarks/locks/core.lock.json.',
    );
    ensure(
      fs.existsSync(path.join(installedPackageRoot, 'docs', 'trust', 'release-verification.md')),
      'Installed package is missing docs/trust/release-verification.md.',
    );
    ensure(
      fs.existsSync(path.join(installedPackageRoot, 'docs', 'benchmarks', 'history.json')),
      'Installed package is missing docs/benchmarks/history.json.',
    );
    const installedBenchmarkReport = JSON.parse(
      fs.readFileSync(path.join(installedPackageRoot, 'benchmarks', 'latest', 'core-report.json'), 'utf8'),
    );
    const installedBenchmarkHistory = JSON.parse(
      fs.readFileSync(path.join(installedPackageRoot, 'docs', 'benchmarks', 'history.json'), 'utf8'),
    );
    ensure(installedBenchmarkReport.summary && installedBenchmarkReport.summary.overallPass === true,
      'Installed benchmark report should indicate overallPass=true.');
    ensure(installedBenchmarkHistory.latestVersion === installedPackageJson.version,
      'Installed benchmark history latestVersion must match installed package version.');
    ensure(
      Array.isArray(installedBenchmarkHistory.entries)
        && installedBenchmarkHistory.entries.some((entry) => entry && entry.version === installedPackageJson.version),
      'Installed benchmark history must include an entry for the installed package version.',
    );
    const installedHistoryEntry = installedBenchmarkHistory.entries.find((entry) => entry && entry.version === installedPackageJson.version);
    ensure(installedHistoryEntry && installedHistoryEntry.summary && installedHistoryEntry.summary.weightedScore === installedBenchmarkReport.summary.weightedScore,
      'Installed benchmark history must reflect the installed benchmark report weighted score.');
    ensureMissingPath(
      path.join(installedPackageRoot, 'sdk', 'python', 'pandora_agent', '__pycache__'),
      'Installed package should not ship sdk/python/pandora_agent/__pycache__.',
    );
    ensureMissingPath(
      path.join(installedPackageRoot, 'sdk', 'python', 'build'),
      'Installed package should not ship sdk/python/build artifacts.',
    );
    ensureMissingPath(
      path.join(installedPackageRoot, 'sdk', 'python', 'pandora_agent.egg-info'),
      'Installed package should not ship sdk/python/pandora_agent.egg-info artifacts.',
    );

    const installResult = runNpm(['install', '--omit=dev', '--ignore-scripts'], {
      cwd: installedPackageRoot,
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
    ensureExitCode(installResult, 0, 'npm install --omit=dev --ignore-scripts (installed package)');

    const installedSdkPackage = JSON.parse(
      fs.readFileSync(path.join(installedPackageRoot, 'sdk', 'typescript', 'package.json'), 'utf8'),
    );
    ensure(installedSdkPackage.name === '@thisispandora/agent-sdk', 'Embedded TypeScript SDK package name mismatch.');
    ensure(/^0\.\d+\.\d+-alpha\.\d+$/.test(installedSdkPackage.version), `Embedded TypeScript SDK version is not alpha-tagged: ${installedSdkPackage.version}`);
    ensure(installedSdkPackage.private !== true, 'Embedded TypeScript SDK package should be publishable.');
    const generatedExport = installedSdkPackage.exports && installedSdkPackage.exports['./generated'];
    const generatedExportTarget = typeof generatedExport === 'string'
      ? generatedExport
      : generatedExport && typeof generatedExport === 'object'
        ? generatedExport.require || generatedExport.default
        : null;
    ensure(
      generatedExportTarget === './generated/index.js',
      'Embedded TypeScript SDK package should export ./generated to ./generated/index.js.',
    );

    const generatedSdkPackage = JSON.parse(
      fs.readFileSync(path.join(installedPackageRoot, 'sdk', 'generated', 'package.json'), 'utf8'),
    );
    ensure(generatedSdkPackage.main === './index.js', 'Generated SDK package main entry mismatch.');
    ensure(generatedSdkPackage.types === './index.d.ts', 'Generated SDK package types entry mismatch.');

    const pythonPyproject = fs.readFileSync(path.join(installedPackageRoot, 'sdk', 'python', 'pyproject.toml'), 'utf8');
    ensure(/name\s*=\s*"pandora-agent"/.test(pythonPyproject), 'Embedded Python SDK pyproject is missing package name.');
    ensure(/version\s*=\s*"0\.\d+\.\d+a\d+"/.test(pythonPyproject), 'Embedded Python SDK pyproject is missing alpha version metadata.');

    const smokeEnv = buildIsolatedPandoraEnv(runtimeDir);

    const versionResult = runPandora(installedCli, ['--output', 'json', '--version'], { cwd: appDir, env: smokeEnv });
    ensureExitCode(versionResult, 0, 'pandora --output json --version');
    ensure(String(versionResult.stderr || '').trim() === '', 'version JSON command should not write to stderr.');
    validateVersionPayload(parseJsonStdout(versionResult, 'pandora --output json --version'));

    const helpResult = runPandora(installedCli, ['--output', 'json', 'help'], { cwd: appDir, env: smokeEnv });
    ensureExitCode(helpResult, 0, 'pandora --output json help');
    ensure(String(helpResult.stderr || '').trim() === '', 'help JSON command should not write to stderr.');
    validateHelpPayload(parseJsonStdout(helpResult, 'pandora --output json help'));

    const lpExplainResult = runPandora(
      installedCli,
      ['--output', 'json', 'mirror', 'lp-explain', '--liquidity-usdc', '10000', '--source-yes-pct', '58'],
      { cwd: appDir, env: smokeEnv },
    );
    ensureExitCode(lpExplainResult, 0, 'pandora --output json mirror lp-explain');
    ensure(String(lpExplainResult.stderr || '').trim() === '', 'mirror lp-explain JSON command should not write to stderr.');
    validateLpExplainNeutrality(parseJsonStdout(lpExplainResult, 'pandora --output json mirror lp-explain'));

    const schemaResult = runPandora(installedCli, ['--output', 'json', 'schema'], { cwd: appDir, env: smokeEnv });
    ensureExitCode(schemaResult, 0, 'pandora --output json schema');
    const schemaPayload = parseJsonStdout(schemaResult, 'pandora --output json schema');
    validateSchemaPayload(schemaPayload);

    const capabilitiesResult = runPandora(installedCli, ['--output', 'json', 'capabilities'], { cwd: appDir, env: smokeEnv });
    ensureExitCode(capabilitiesResult, 0, 'pandora --output json capabilities');
    const capabilitiesPayload = parseJsonStdout(capabilitiesResult, 'pandora --output json capabilities');
    validateCapabilitiesPayload(capabilitiesPayload, installedPackageJson);
    ensure(capabilitiesPayload.data.recommendedFirstCall === 'bootstrap', 'Installed capabilities should recommend bootstrap first.');
    ensure(capabilitiesPayload.data.readinessMode === 'artifact-neutral', 'Installed capabilities should default to artifact-neutral readiness.');
    ensure(
      JSON.stringify(schemaPayload.data.trustDistribution) === JSON.stringify(capabilitiesPayload.data.trustDistribution),
      'Installed schema trustDistribution should match installed capabilities trustDistribution.',
    );

    const bootstrapResult = runPandora(installedCli, ['--output', 'json', 'bootstrap'], { cwd: appDir, env: smokeEnv });
    ensureExitCode(bootstrapResult, 0, 'pandora --output json bootstrap');
    const bootstrapPayload = parseJsonStdout(bootstrapResult, 'pandora --output json bootstrap');
    ensure(bootstrapPayload.command === 'bootstrap', 'bootstrap command mismatch.');
    ensure(bootstrapPayload.data.readinessMode === 'artifact-neutral', 'bootstrap should default to artifact-neutral readiness.');
    ensure(bootstrapPayload.data.preferences?.recommendedFirstCall === 'bootstrap', 'bootstrap preferences should name bootstrap as the first call.');
    ensure(Array.isArray(bootstrapPayload.data.recommendedBootstrapFlow) && bootstrapPayload.data.recommendedBootstrapFlow[0] === 'bootstrap', 'bootstrap flow should begin with bootstrap.');
    ensure(Array.isArray(bootstrapPayload.data.canonicalTools) && bootstrapPayload.data.canonicalTools.length > 0, 'bootstrap should expose canonical tools.');

    const policyListResult = runPandora(installedCli, ['--output', 'json', 'policy', 'list'], { cwd: appDir, env: smokeEnv });
    ensureExitCode(policyListResult, 0, 'pandora --output json policy list');
    const policyListPayload = parseJsonStdout(policyListResult, 'pandora --output json policy list');
    ensure(policyListPayload.command === 'policy.list', 'policy list command mismatch.');
    ensure(policyListPayload.data.userCount === 0, 'policy list should not discover user policy packs in isolated smoke env.');
    ensure(policyListPayload.data.items.some((item) => item.id === 'research-only'), 'policy list missing research-only.');

    const policyGetResult = runPandora(installedCli, ['--output', 'json', 'policy', 'get', '--id', 'research-only'], { cwd: appDir, env: smokeEnv });
    ensureExitCode(policyGetResult, 0, 'pandora --output json policy get');
    const policyGetPayload = parseJsonStdout(policyGetResult, 'pandora --output json policy get');
    ensure(policyGetPayload.command === 'policy.get', 'policy get command mismatch.');
    ensure(policyGetPayload.data.item.id === 'research-only', 'policy get returned the wrong builtin policy.');

    const profileListResult = runPandora(installedCli, ['--output', 'json', 'profile', 'list'], { cwd: appDir, env: smokeEnv });
    ensureExitCode(profileListResult, 0, 'pandora --output json profile list');
    const profileListPayload = parseJsonStdout(profileListResult, 'pandora --output json profile list');
    ensure(profileListPayload.command === 'profile.list', 'profile list command mismatch.');
    ensure(profileListPayload.data.fileCount === 0, 'profile list should not discover file-backed profiles in isolated smoke env.');
    ensure(profileListPayload.data.items.some((item) => item.id === 'market_observer_ro'), 'profile list missing market_observer_ro.');

    const profileGetResult = runPandora(installedCli, ['--output', 'json', 'profile', 'get', '--id', 'market_observer_ro'], { cwd: appDir, env: smokeEnv });
    ensureExitCode(profileGetResult, 0, 'pandora --output json profile get');
    const profileGetPayload = parseJsonStdout(profileGetResult, 'pandora --output json profile get');
    ensure(profileGetPayload.command === 'profile.get', 'profile get command mismatch.');
    ensure(profileGetPayload.data.profile.defaultPolicy === 'research-only', 'profile get defaultPolicy mismatch.');

    const profileValidateFile = path.join(runtimeDir, 'validate-profiles.json');
    fs.writeFileSync(profileValidateFile, JSON.stringify({
      profiles: [
        {
          id: 'observer',
          displayName: 'Observer',
          description: 'Read-only smoke profile.',
          signerBackend: 'read-only',
          approvalMode: 'read-only',
        },
      ],
    }));
    const profileValidateResult = runPandora(installedCli, ['--output', 'json', 'profile', 'validate', '--file', profileValidateFile], {
      cwd: appDir,
      env: smokeEnv,
    });
    ensureExitCode(profileValidateResult, 0, 'pandora --output json profile validate');
    const profileValidatePayload = parseJsonStdout(profileValidateResult, 'pandora --output json profile validate');
    ensure(profileValidatePayload.command === 'profile.validate', 'profile validate command mismatch.');
    ensure(profileValidatePayload.data.valid === true, 'profile validate should accept a read-only smoke profile.');
    ensure(profileValidatePayload.data.runtimeReady === true, 'profile validate should report read-only smoke profile as runtime ready.');

    const policyLintFile = path.join(runtimeDir, 'lint-policy.json');
    fs.writeFileSync(policyLintFile, JSON.stringify({
      schemaVersion: '1.0.0',
      kind: 'policy-pack',
      id: 'consumer-safe',
      version: '1.0.0',
      displayName: 'Consumer Safe',
      description: 'Consumer smoke policy.',
      rules: [
        {
          id: 'deny-live',
          kind: 'deny_live_execution',
          result: {
            code: 'LIVE_DENIED',
            message: 'deny',
          },
        },
      ],
    }));
    const policyLintResult = runPandora(installedCli, ['--output', 'json', 'policy', 'lint', '--file', policyLintFile], {
      cwd: appDir,
      env: smokeEnv,
    });
    ensureExitCode(policyLintResult, 0, 'pandora --output json policy lint');
    const policyLintPayload = parseJsonStdout(policyLintResult, 'pandora --output json policy lint');
    ensure(policyLintPayload.command === 'policy.lint', 'policy lint command mismatch.');
    ensure(policyLintPayload.data.ok === true, 'policy lint should accept a valid smoke policy pack.');
    ensure(policyLintPayload.data.item && policyLintPayload.data.item.id === 'consumer-safe', 'policy lint returned the wrong policy item.');

    const sdkNodeResult = run(
      NODE_CMD,
      ['-e', `
	const sdk = require(${JSON.stringify(path.join(installedPackageRoot, 'sdk', 'typescript'))});
	const generated = require(${JSON.stringify(path.join(installedPackageRoot, 'sdk', 'generated'))});
	const generatedPackage = require(${JSON.stringify(path.join(installedPackageRoot, 'sdk', 'generated', 'package.json'))});
	const manifest = require(${JSON.stringify(path.join(installedPackageRoot, 'sdk', 'generated', 'manifest.json'))});
	const registry = require(${JSON.stringify(path.join(installedPackageRoot, 'sdk', 'generated', 'contract-registry.json'))});
 	const tsGenerated = require(${JSON.stringify(path.join(installedPackageRoot, 'sdk', 'typescript', 'generated'))});
 	const tsManifest = require(${JSON.stringify(path.join(installedPackageRoot, 'sdk', 'typescript', 'generated', 'manifest.json'))});
 	const tsCommandDescriptors = require(${JSON.stringify(path.join(installedPackageRoot, 'sdk', 'generated', 'command-descriptors.json'))});
 	const tsToolDefinitions = require(${JSON.stringify(path.join(installedPackageRoot, 'sdk', 'generated', 'mcp-tool-definitions.json'))});
 	const tsRegistry = require(${JSON.stringify(path.join(installedPackageRoot, 'sdk', 'generated', 'contract-registry.json'))});
	const tsPackage = require(${JSON.stringify(path.join(installedPackageRoot, 'sdk', 'typescript', 'package.json'))});
	(async () => {
	  const loadedManifest = sdk.loadGeneratedManifest();
	  const loadedRegistry = generated.loadGeneratedContractRegistry();
	  const policyProfiles = sdk.getPolicyProfileCapabilities();
	  const tradeInspection = sdk.inspectToolPolicySurface('trade');
	  if (typeof generated.loadGeneratedManifest !== 'function') {
	    throw new Error('sdk/generated is missing loadGeneratedManifest().');
	  }
 	  if (loadedManifest.packageVersion !== tsManifest.packageVersion) {
 	    throw new Error(\`typescript generated manifest packageVersion mismatch: \${loadedManifest.packageVersion} vs \${tsManifest.packageVersion}\`);
 	  }
 	  if (tsManifest.contractPackageVersion !== loadedRegistry.packageVersion) {
	    throw new Error(\`generated registry packageVersion mismatch: \${tsManifest.contractPackageVersion} vs \${loadedRegistry.packageVersion}\`);
	  }
	  const client = sdk.createLocalPandoraAgentClient({
	    command: process.execPath,
	    args: [${JSON.stringify(installedCli)}, 'mcp'],
	    cwd: process.cwd(),
	    env: process.env,
	  });
	  await client.connect();
	  const envelope = await client.callTool('capabilities');
	  await client.close();
	  console.log(JSON.stringify({
	    loadedManifestSchemaVersion: loadedManifest.schemaVersion,
	    loadedManifestPackageVersion: loadedManifest.packageVersion,
	    manifestPackageVersion: manifest.packageVersion,
	    manifestContractPackageVersion: manifest.contractPackageVersion,
	    tsManifestPackageVersion: tsManifest.packageVersion,
	    tsManifestContractPackageVersion: tsManifest.contractPackageVersion,
	    tsPackageVersion: tsPackage.version,
	    generatedRegistryPackageVersion: loadedRegistry.packageVersion,
	    generatedRegistryHasDescriptors: Boolean(loadedRegistry.commandDescriptors),
	    rawRegistryHasPolicyProfiles: Boolean(registry.capabilities && registry.capabilities.policyProfiles),
	    tsGeneratedHasLoaders: typeof tsGenerated.loadGeneratedContractRegistry === 'function',
	    tsGeneratedDescriptorCount: Object.keys(tsCommandDescriptors || {}).length,
	    tsToolDefinitionCount: Object.keys(tsToolDefinitions || {}).length,
	    tsRegistryHasPolicyProfiles: Boolean(tsRegistry.capabilities && tsRegistry.capabilities.policyProfiles),
	    tsPackageName: tsPackage.name,
	    tsPackageGeneratedExport: tsPackage.exports && tsPackage.exports['./generated'],
	    generatedPackageMain: generatedPackage.main,
	    policyPackStatus: policyProfiles.policyPacks.status,
	    signerProfileStatus: policyProfiles.signerProfiles.status,
	    policyScopedCount: policyProfiles.policyPacks.commandsWithPolicyScopes.length,
	    signerCommandCount: policyProfiles.signerProfiles.commandsRequiringSecrets.length,
	    tradePolicyScopes: tradeInspection.policyScopes,
	    tradeRequiresSecrets: tradeInspection.requiresSecrets,
	    envelopeCommand: envelope.command,
	    envelopeOk: envelope.ok,
	    envelopePolicyStatus: envelope.data.policyProfiles.policyPacks.status,
	    envelopeUserCount: envelope.data.policyProfiles.policyPacks.userCount
	  }));
	})().catch((error) => {
	  console.error(error && error.stack ? error.stack : String(error));
	  process.exit(1);
	});
	`],
	      { cwd: appDir, env: smokeEnv, timeoutMs: 120_000 },
	    );
	    ensureExitCode(sdkNodeResult, 0, 'typescript sdk consumer smoke');
    const sdkNodePayload = parseJsonStdout(sdkNodeResult, 'typescript sdk consumer smoke');
    ensure(sdkNodePayload.loadedManifestSchemaVersion === '1.0.0', 'TypeScript SDK manifest schemaVersion mismatch.');
    ensure(sdkNodePayload.manifestPackageVersion === sdkNodePayload.generatedRegistryPackageVersion, 'Generated registry packageVersion should match root generated manifest.');
    ensure(sdkNodePayload.manifestContractPackageVersion === sdkNodePayload.generatedRegistryPackageVersion, 'Root generated manifest contractPackageVersion should match generated registry packageVersion.');
    ensure(sdkNodePayload.loadedManifestPackageVersion === sdkNodePayload.tsPackageVersion, 'TypeScript SDK manifest packageVersion should match sdk/typescript package.json.');
    ensure(sdkNodePayload.loadedManifestPackageVersion === sdkNodePayload.tsManifestPackageVersion, 'TypeScript SDK generated manifest packageVersion mismatch.');
    ensure(sdkNodePayload.tsManifestContractPackageVersion === sdkNodePayload.generatedRegistryPackageVersion, 'TypeScript SDK generated manifest contractPackageVersion should match generated registry packageVersion.');
    ensure(sdkNodePayload.generatedRegistryHasDescriptors === true, 'Generated SDK registry export is missing commandDescriptors.');
    ensure(sdkNodePayload.rawRegistryHasPolicyProfiles === true, 'Generated contract registry export is missing policyProfiles.');
    ensure(sdkNodePayload.tsGeneratedHasLoaders === true, 'TypeScript generated subpath export is missing loader helpers.');
    ensure(sdkNodePayload.tsGeneratedDescriptorCount > 0, 'TypeScript generated command-descriptor export is empty.');
    ensure(sdkNodePayload.tsToolDefinitionCount > 0, 'TypeScript generated MCP tool-definition export is empty.');
    ensure(sdkNodePayload.tsRegistryHasPolicyProfiles === true, 'TypeScript generated contract registry export is missing policyProfiles.');
    ensure(sdkNodePayload.tsPackageName === '@thisispandora/agent-sdk', 'TypeScript SDK package.json export returned the wrong name.');
    ensure(
      sdkNodePayload.tsPackageGeneratedExport
        && sdkNodePayload.tsPackageGeneratedExport.require === './generated/index.js'
        && sdkNodePayload.tsPackageGeneratedExport.default === './generated/index.js',
      'TypeScript SDK package.json export is missing ./generated.',
    );
    ensure(sdkNodePayload.generatedPackageMain === './index.js', 'Generated SDK package.json export returned the wrong main entry.');
    ensure(sdkNodePayload.policyPackStatus === 'alpha', 'TypeScript SDK should report alpha policy pack status.');
    ensure(sdkNodePayload.signerProfileStatus === 'alpha', 'TypeScript SDK should report alpha signer profile status.');
    ensure(sdkNodePayload.policyScopedCount > 0, 'TypeScript SDK should expose policy-scoped commands.');
    ensure(sdkNodePayload.signerCommandCount > 0, 'TypeScript SDK should expose signer-profile commands.');
    ensure(Array.isArray(sdkNodePayload.tradePolicyScopes) && sdkNodePayload.tradePolicyScopes.includes('secrets:use'), 'TypeScript SDK trade inspection should include secrets:use.');
    ensure(sdkNodePayload.tradeRequiresSecrets === true, 'TypeScript SDK trade inspection should report requiresSecrets.');
    ensure(sdkNodePayload.envelopeCommand === 'capabilities', 'TypeScript SDK capabilities tool returned the wrong command.');
    ensure(sdkNodePayload.envelopeOk === true, 'TypeScript SDK capabilities tool should return ok=true.');
    ensure(sdkNodePayload.envelopePolicyStatus === 'alpha', 'TypeScript SDK capabilities envelope should report alpha policy status.');
    ensure(sdkNodePayload.envelopeUserCount === 0, 'TypeScript SDK capabilities envelope should use isolated smoke env policy state.');

    if (havePython()) {
      const sdkPythonResult = run(
        'python3',
        ['-c', `
import json, os, sys
root = ${JSON.stringify(path.join(installedPackageRoot, 'sdk', 'python'))}
sys.path.insert(0, root)
from pandora_agent import create_local_pandora_agent_client, load_generated_manifest
manifest = load_generated_manifest()
client = create_local_pandora_agent_client(command=${JSON.stringify(NODE_CMD)}, args=[${JSON.stringify(installedCli)}, 'mcp'], cwd=os.getcwd(), env=dict(os.environ))
client.connect()
envelope = client.call_tool('capabilities')
capabilities = client.get_capabilities()
descriptors = client.get_command_descriptors()
client.close()
print(json.dumps({
  'schemaVersion': manifest['schemaVersion'],
  'policyPackStatus': capabilities['policyProfiles']['policyPacks']['status'],
  'signerProfileStatus': capabilities['policyProfiles']['signerProfiles']['status'],
  'tradePolicyScopes': descriptors['trade']['policyScopes'],
  'command': envelope['command'],
  'ok': envelope['ok'],
  'userCount': envelope['data']['policyProfiles']['policyPacks']['userCount'],
}))
`],
        { cwd: appDir, env: smokeEnv, timeoutMs: 120_000 },
      );
      ensureExitCode(sdkPythonResult, 0, 'python sdk consumer smoke');
      const sdkPythonPayload = parseJsonStdout(sdkPythonResult, 'python sdk consumer smoke');
      ensure(sdkPythonPayload.schemaVersion === '1.0.0', 'Python SDK manifest schemaVersion mismatch.');
      ensure(sdkPythonPayload.policyPackStatus === 'alpha', 'Python SDK should report alpha policy pack status.');
      ensure(sdkPythonPayload.signerProfileStatus === 'alpha', 'Python SDK should report alpha signer profile status.');
      ensure(Array.isArray(sdkPythonPayload.tradePolicyScopes) && sdkPythonPayload.tradePolicyScopes.includes('secrets:use'), 'Python SDK trade descriptor should include secrets:use.');
      ensure(sdkPythonPayload.command === 'capabilities', 'Python SDK capabilities tool returned the wrong command.');
      ensure(sdkPythonPayload.ok === true, 'Python SDK capabilities tool should return ok=true.');
      ensure(sdkPythonPayload.userCount === 0, 'Python SDK capabilities envelope should use isolated smoke env policy state.');
    }

    console.log('Consumer JSON smoke test passed.');
    console.log(`Tarball: ${tarballPath}`);
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (error) {
      const transientWindowsCleanupError =
        process.platform === 'win32' && ['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error && error.code);
      if (!transientWindowsCleanupError) {
        throw error;
      }
    }
  }
}

main();
