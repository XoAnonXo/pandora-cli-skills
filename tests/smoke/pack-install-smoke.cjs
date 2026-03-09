#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const PREPARE_PUBLISH_MANIFEST = path.join(ROOT, 'scripts', 'prepare_publish_manifest.cjs');
const RESTORE_PUBLISH_MANIFEST = path.join(ROOT, 'scripts', 'restore_publish_manifest.cjs');
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
const NPM_CMD = 'npm';
const NODE_CMD = process.execPath;
const PACK_TIMEOUT_MS = process.platform === 'win32' ? 180_000 : 120_000;
const EXPECTED_PUBLISHED_SCRIPT_NAMES = [
  'cli',
  'init-env',
  'doctor',
  'setup',
  'dry-run',
  'execute',
  'dry-run:clone',
];

function havePython() {
  const probe = run('python3', ['--version'], { timeoutMs: 10_000 });
  return probe.status === 0;
}

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
    throw new Error(
      `${label} exited with ${result.status}, expected ${expected}.\nOutput:\n${result.output}`,
    );
  }
}

function ensureOutputContains(result, regex, label) {
  if (!regex.test(result.output)) {
    throw new Error(`${label} output mismatch. Expected ${regex}.\nOutput:\n${result.output}`);
  }
}

function cleanEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of REQUIRED_ENV_KEYS) {
    delete env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    env[key] = value;
  }
  return env;
}

function buildIsolatedPandoraEnv(rootDir, overrides = {}) {
  const homeDir = path.join(rootDir, 'home');
  const policyDir = path.join(rootDir, 'policies');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(policyDir, { recursive: true });
  return cleanEnv({
    HOME: homeDir,
    USERPROFILE: homeDir,
    PANDORA_PROFILE_FILE: path.join(rootDir, 'profiles.json'),
    PANDORA_POLICY_DIR: policyDir,
    PANDORA_POLICIES_DIR: policyDir,
    ...overrides,
  });
}

function moveFileSafe(from, to) {
  try {
    fs.renameSync(from, to);
  } catch (error) {
    if (error?.code !== 'EXDEV') {
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

function preparePublishManifest() {
  return run(NODE_CMD, [PREPARE_PUBLISH_MANIFEST], {
    cwd: ROOT,
    timeoutMs: 120_000,
  });
}

function restorePublishManifest() {
  return run(NODE_CMD, [RESTORE_PUBLISH_MANIFEST], {
    cwd: ROOT,
    timeoutMs: 120_000,
  });
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
    if (fallback.status !== 0) {
      return fallback;
    }

    const tarball = fallback.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);

    if (!tarball) {
      throw new Error('Could not determine tarball name from npm pack output.');
    }

    const from = path.join(ROOT, tarball);
    const to = path.join(packDir, tarball);
    moveFileSafe(from, to);
    fallback.stdout = `${tarball}\n`;
    return fallback;
  }

  const withDestination = runNpm([...packArgs, '--pack-destination', packDir], {
    timeoutMs: PACK_TIMEOUT_MS,
  });
  if (withDestination.status === 0) {
    return withDestination;
  }

  if (!/pack-destination/.test(withDestination.output)) {
    return withDestination;
  }

  const fallback = runNpm(packArgs, { timeoutMs: PACK_TIMEOUT_MS });
  if (fallback.status !== 0) {
    return fallback;
  }

  const tarball = fallback.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  if (!tarball) {
    throw new Error('Could not determine tarball name from npm pack output.');
  }

  const from = path.join(ROOT, tarball);
  const to = path.join(packDir, tarball);
  moveFileSafe(from, to);
  fallback.stdout = `${tarball}\n`;
  return fallback;
}

function main() {
  const FIXED_FUTURE_TIMESTAMP = '1893456000'; // 2030-01-01T00:00:00Z
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-pack-smoke-'));
  const packDir = path.join(tempRoot, 'pack');
  const appDir = path.join(tempRoot, 'app');
  const extractDir = path.join(tempRoot, 'extract');
  const runtimeDir = path.join(tempRoot, 'runtime');
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(extractDir, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });

  try {
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
    if (!fs.existsSync(tarballPath)) {
      throw new Error(`Tarball not found at ${tarballPath}`);
    }

    extractTarball(tarballPath, extractDir);

    const installedPackageRoot = path.join(extractDir, 'package');
    const installedCli = path.join(installedPackageRoot, 'cli', 'pandora.cjs');
    if (!fs.existsSync(installedCli)) {
      throw new Error(`Installed CLI not found at ${installedCli}`);
    }
    const installedPackageJson = JSON.parse(
      fs.readFileSync(path.join(installedPackageRoot, 'package.json'), 'utf8'),
    );
    const repoPackageJson = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
    );
    const installedScripts = installedPackageJson.scripts || {};
    if (installedPackageJson.name !== repoPackageJson.name) {
      throw new Error('Installed package name should match the repository package name.');
    }
    if (installedPackageJson.version !== repoPackageJson.version) {
      throw new Error('Installed package version should match the repository package version.');
    }
    if (installedPackageJson.bin?.pandora !== 'cli/pandora.cjs') {
      throw new Error('Installed package bin.pandora should point to cli/pandora.cjs.');
    }
    if (installedPackageJson.devDependencies !== undefined) {
      throw new Error('Installed package should not ship devDependencies.');
    }
    if (JSON.stringify(Object.keys(installedScripts).sort()) !== JSON.stringify([...EXPECTED_PUBLISHED_SCRIPT_NAMES].sort())) {
      throw new Error(`Installed package should expose only published scripts: ${EXPECTED_PUBLISHED_SCRIPT_NAMES.join(', ')}.`);
    }
    if (installedPackageJson.exports['./sdk/generated'] !== './sdk/generated/index.js') {
      throw new Error('Installed package exports missing ./sdk/generated.');
    }
    if (installedPackageJson.exports['./sdk/generated/package.json'] !== './sdk/generated/package.json') {
      throw new Error('Installed package exports missing ./sdk/generated/package.json.');
    }
    if (installedPackageJson.exports['./sdk/typescript'] !== './sdk/typescript/index.js') {
      throw new Error('Installed package exports missing ./sdk/typescript.');
    }
    if (installedPackageJson.exports['./sdk/typescript/generated'] !== './sdk/typescript/generated/index.js') {
      throw new Error('Installed package exports missing ./sdk/typescript/generated.');
    }
    if (installedPackageJson.exports['./sdk/typescript/generated/manifest'] !== './sdk/typescript/generated/manifest.json') {
      throw new Error('Installed package exports missing ./sdk/typescript/generated/manifest.');
    }
    if (installedPackageJson.exports['./sdk/typescript/generated/command-descriptors'] !== './sdk/typescript/generated/command-descriptors.json') {
      throw new Error('Installed package exports missing ./sdk/typescript/generated/command-descriptors.');
    }
    if (installedPackageJson.exports['./sdk/typescript/generated/mcp-tool-definitions'] !== './sdk/typescript/generated/mcp-tool-definitions.json') {
      throw new Error('Installed package exports missing ./sdk/typescript/generated/mcp-tool-definitions.');
    }
    if (installedPackageJson.exports['./sdk/typescript/generated/contract-registry'] !== './sdk/typescript/generated/contract-registry.json') {
      throw new Error('Installed package exports missing ./sdk/typescript/generated/contract-registry.');
    }
    if (installedPackageJson.exports['./sdk/typescript/package.json'] !== './sdk/typescript/package.json') {
      throw new Error('Installed package exports missing ./sdk/typescript/package.json.');
    }
    if (!fs.existsSync(path.join(installedPackageRoot, 'sdk', 'generated', 'index.js'))) {
      throw new Error('Installed package is missing sdk/generated/index.js.');
    }
    if (!fs.existsSync(path.join(installedPackageRoot, 'sdk', 'generated', 'package.json'))) {
      throw new Error('Installed package is missing sdk/generated/package.json.');
    }
    if (!fs.existsSync(path.join(installedPackageRoot, 'sdk', 'typescript', 'generated', 'index.js'))) {
      throw new Error('Installed package is missing sdk/typescript/generated/index.js.');
    }
    if (!fs.existsSync(path.join(installedPackageRoot, 'sdk', 'typescript', 'generated', 'manifest.json'))) {
      throw new Error('Installed package is missing sdk/typescript/generated/manifest.json.');
    }
    for (const scriptName of EXPECTED_PUBLISHED_SCRIPT_NAMES) {
      if (typeof installedScripts[scriptName] !== 'string' || installedScripts[scriptName].length === 0) {
        throw new Error(`Installed package is missing published script ${scriptName}.`);
      }
    }
    for (const scriptName of [
      'build',
      'prepack',
      'postpack',
      'restore:publish-manifest',
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
      'typecheck',
      'lint',
    ]) {
      if (Object.prototype.hasOwnProperty.call(installedScripts, scriptName)) {
        throw new Error(`Installed package should not expose repo-only script ${scriptName}.`);
      }
    }
    const requiredTrustFiles = [
      path.join('docs', 'trust', 'release-verification.md'),
      path.join('docs', 'trust', 'security-model.md'),
      path.join('docs', 'trust', 'support-matrix.md'),
      path.join('scripts', 'release', 'install_release.sh'),
    ];
    for (const relativePath of requiredTrustFiles) {
      if (!fs.existsSync(path.join(installedPackageRoot, relativePath))) {
        throw new Error(`Installed package is missing ${relativePath}.`);
      }
    }
    ensureExitCode(
      runNpm(['install', '--omit=dev', '--ignore-scripts'], {
        cwd: installedPackageRoot,
        timeoutMs: 180_000,
      }),
      0,
      'npm install --omit=dev --ignore-scripts (installed package)',
    );
    if (!fs.existsSync(path.join(installedPackageRoot, 'sdk', 'python', 'pandora_agent', 'generated', 'manifest.json'))) {
      throw new Error('Installed package is missing sdk/python/pandora_agent/generated/manifest.json.');
    }
    if (havePython()) {
      const pythonSmoke = run('python3', ['-c', `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(installedPackageRoot, 'sdk', 'python'))})
from pandora_agent import load_generated_manifest, load_generated_contract_registry
manifest = load_generated_manifest()
registry = load_generated_contract_registry()
print(json.dumps({
  "schemaVersion": manifest["schemaVersion"],
  "toolCount": len(registry.get("tools", {}))
}))
	`], {
        cwd: installedPackageRoot,
        timeoutMs: 60_000,
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: '1',
        },
      });
      ensureExitCode(pythonSmoke, 0, 'installed python sdk import smoke');
      const pythonPayload = JSON.parse(String(pythonSmoke.stdout || '').trim());
      if (pythonPayload.schemaVersion !== '1.0.0') {
        throw new Error('Installed Python SDK manifest schemaVersion mismatch.');
      }
      if (!Number.isInteger(pythonPayload.toolCount) || pythonPayload.toolCount <= 0) {
        throw new Error('Installed Python SDK should expose generated tools.');
      }
    }
    const requiredDocPaths = [
      'README.md',
      'README_FOR_SHARING.md',
      'SKILL.md',
      path.join('docs', 'benchmarks', 'README.md'),
      path.join('docs', 'benchmarks', 'scenario-catalog.md'),
      path.join('docs', 'benchmarks', 'scorecard.md'),
      path.join('docs', 'skills', 'capabilities.md'),
      path.join('docs', 'skills', 'agent-quickstart.md'),
      path.join('docs', 'skills', 'agent-interfaces.md'),
      path.join('docs', 'skills', 'trading-workflows.md'),
      path.join('docs', 'skills', 'portfolio-closeout.md'),
      path.join('docs', 'skills', 'policy-profiles.md'),
      path.join('docs', 'skills', 'command-reference.md'),
      path.join('docs', 'skills', 'mirror-operations.md'),
      path.join('docs', 'skills', 'legacy-launchers.md'),
    ];
    for (const relativeDocPath of requiredDocPaths) {
      if (!fs.existsSync(path.join(installedPackageRoot, relativeDocPath))) {
        throw new Error(`Installed package is missing ${relativeDocPath}.`);
      }
    }
    for (const relativePath of [
      path.join('benchmarks', 'latest', 'core-report.json'),
      path.join('benchmarks', 'latest', 'core-bundle.json'),
      path.join('benchmarks', 'latest', 'core-history.json'),
      path.join('docs', 'benchmarks', 'history.json'),
    ]) {
      if (!fs.existsSync(path.join(installedPackageRoot, relativePath))) {
        throw new Error(`Installed package is missing ${relativePath}.`);
      }
    }
    if (fs.existsSync(path.join(installedPackageRoot, 'benchmarks', 'latest', '.gitkeep'))) {
      throw new Error('Installed package should not ship benchmarks/latest/.gitkeep.');
    }
    if (fs.existsSync(path.join(installedPackageRoot, 'sdk', 'python', 'pandora_agent', '__pycache__'))) {
      throw new Error('Installed package should not ship sdk/python/pandora_agent/__pycache__.');
    }

    const installedBenchmarkDocs = fs.readFileSync(
      path.join(installedPackageRoot, 'docs', 'benchmarks', 'README.md'),
      'utf8',
    );
    const installedBenchmarkScorecard = fs.readFileSync(
      path.join(installedPackageRoot, 'docs', 'benchmarks', 'scorecard.md'),
      'utf8',
    );
    if (!/repository benchmark harness/i.test(installedBenchmarkDocs)) {
      throw new Error('Installed benchmark docs should explain that the full benchmark harness stays in the repository.');
    }
    if (!/latest benchmark report/i.test(installedBenchmarkDocs)) {
      throw new Error('Installed benchmark docs should explain that the packaged artifact ships the latest benchmark report.');
    }
    if (!/core-bundle\.json/i.test(installedBenchmarkDocs)) {
      throw new Error('Installed benchmark docs should reference core-bundle.json.');
    }
    if (!/core-history\.json/i.test(installedBenchmarkDocs)) {
      throw new Error('Installed benchmark docs should reference core-history.json.');
    }
    if (!/`benchmarks\/latest\/core-report\.json`/.test(installedBenchmarkDocs)) {
      throw new Error('Installed benchmark docs should reference benchmarks/latest/core-report.json.');
    }
    for (const fieldName of ['documentationContentHash', 'documentationRegistryHash', 'generatedArtifactHashes']) {
      if (!new RegExp(`\`${fieldName}\``).test(installedBenchmarkScorecard)) {
        throw new Error(`Installed benchmark scorecard should reference ${fieldName}.`);
      }
    }

    const installedBenchmarkReport = JSON.parse(
      fs.readFileSync(path.join(installedPackageRoot, 'benchmarks', 'latest', 'core-report.json'), 'utf8'),
    );
    const installedBenchmarkBundle = JSON.parse(
      fs.readFileSync(path.join(installedPackageRoot, 'benchmarks', 'latest', 'core-bundle.json'), 'utf8'),
    );
    const installedBenchmarkHistory = JSON.parse(
      fs.readFileSync(path.join(installedPackageRoot, 'benchmarks', 'latest', 'core-history.json'), 'utf8'),
    );
    if (installedBenchmarkReport.summary?.overallPass !== true) {
      throw new Error('Installed benchmark report should set summary.overallPass=true.');
    }
    if (installedBenchmarkBundle.latest?.summary?.overallPass !== true) {
      throw new Error('Installed benchmark bundle should set latest.summary.overallPass=true.');
    }
    if (!Array.isArray(installedBenchmarkHistory.entries) || installedBenchmarkHistory.entries.length === 0) {
      throw new Error('Installed benchmark history should contain at least one release entry.');
    }
    if (!Array.isArray(installedBenchmarkReport.parity?.groups) || installedBenchmarkReport.parity.groups.length === 0) {
      throw new Error('Installed benchmark report should include parity groups.');
    }
    if (!installedBenchmarkReport.scenarios.some((scenario) => scenario.id === 'mcp-http-schema-bootstrap')) {
      throw new Error('Installed benchmark report should include mcp-http-schema-bootstrap.');
    }
    if (!installedBenchmarkReport.scenarios.some((scenario) => scenario.id === 'mcp-http-operations-get-seeded')) {
      throw new Error('Installed benchmark report should include mcp-http-operations-get-seeded.');
    }
    if (!installedBenchmarkReport.scenarios.every((scenario) => scenario.score && typeof scenario.score.weighted === 'number')) {
      throw new Error('Installed benchmark report should expose numeric weighted scores for every scenario.');
    }

    const smokeEnv = buildIsolatedPandoraEnv(runtimeDir);

    const capabilitiesJson = runPandora(installedCli, ['--output', 'json', 'capabilities'], { cwd: appDir, env: smokeEnv });
    ensureExitCode(capabilitiesJson, 0, 'pandora capabilities');
    const capabilitiesPayload = JSON.parse(capabilitiesJson.stdout);
    if (!capabilitiesPayload?.data?.documentation?.contentHash) {
      throw new Error('pandora capabilities should expose documentation.contentHash.');
    }
    if (!capabilitiesPayload?.data?.documentation?.skills?.some((doc) => doc.path === 'docs/skills/mirror-operations.md')) {
      throw new Error('pandora capabilities should expose docs/skills/mirror-operations.md.');
    }
    if (!capabilitiesPayload?.data?.documentation?.router?.taskRoutes?.some((route) => route.docId === 'mirror-operations')) {
      throw new Error('pandora capabilities should expose mirror-operations in router.taskRoutes.');
    }
    if (capabilitiesPayload?.data?.recommendedFirstCall !== 'bootstrap') {
      throw new Error('pandora capabilities should recommend bootstrap as the first call.');
    }
    if (capabilitiesPayload?.data?.readinessMode !== 'artifact-neutral') {
      throw new Error('pandora capabilities should default to artifact-neutral readiness.');
    }

    const bootstrapJson = runPandora(installedCli, ['--output', 'json', 'bootstrap'], { cwd: appDir, env: smokeEnv });
    ensureExitCode(bootstrapJson, 0, 'pandora bootstrap');
    const bootstrapPayload = JSON.parse(bootstrapJson.stdout);
    if (bootstrapPayload?.command !== 'bootstrap') {
      throw new Error('pandora bootstrap should return command=bootstrap.');
    }
    if (bootstrapPayload?.data?.readinessMode !== 'artifact-neutral') {
      throw new Error('pandora bootstrap should default to artifact-neutral readiness.');
    }
    if (bootstrapPayload?.data?.preferences?.recommendedFirstCall !== 'bootstrap') {
      throw new Error('pandora bootstrap should expose bootstrap-first preferences.');
    }
    if (!Array.isArray(bootstrapPayload?.data?.recommendedBootstrapFlow) || bootstrapPayload.data.recommendedBootstrapFlow[0] !== 'bootstrap') {
      throw new Error('pandora bootstrap should start recommendedBootstrapFlow with bootstrap.');
    }

    const help = runPandora(installedCli, ['help'], { cwd: appDir, env: smokeEnv });
    ensureExitCode(help, 0, 'pandora help');
    ensureOutputContains(help, /Prediction market CLI/, 'pandora help');

    const mirrorHelp = runPandora(installedCli, ['mirror', '--help'], { cwd: appDir, env: smokeEnv });
    ensureExitCode(mirrorHelp, 0, 'pandora mirror --help');
    ensureOutputContains(
      mirrorHelp,
      /mirror browse\|plan\|deploy\|verify\|lp-explain\|hedge-calc\|calc\|simulate\|go\|sync\|trace\|dashboard\|status\|health\|panic\|drift\|hedge-check\|pnl\|audit\|replay\|logs\|close/,
      'pandora mirror --help',
    );

    const mirrorPlanHelp = runPandora(installedCli, ['mirror', 'plan', '--help'], { cwd: appDir, env: smokeEnv });
    ensureExitCode(mirrorPlanHelp, 0, 'pandora mirror plan --help');
    ensureOutputContains(mirrorPlanHelp, /polymarket-market-id/, 'pandora mirror plan --help');

    const mirrorSyncHelp = runPandora(installedCli, ['mirror', 'sync', '--help'], { cwd: appDir, env: smokeEnv });
    ensureExitCode(mirrorSyncHelp, 0, 'pandora mirror sync --help');
    ensureOutputContains(mirrorSyncHelp, /sync once\|run\|start.*stop.*status/s, 'pandora mirror sync --help');

    const policyHelp = runPandora(installedCli, ['policy', '--help'], { cwd: appDir, env: smokeEnv });
    ensureExitCode(policyHelp, 0, 'pandora policy --help');
    ensureOutputContains(policyHelp, /policy list\|get\|explain\|recommend\|lint/, 'pandora policy --help');

    const profileHelp = runPandora(installedCli, ['profile', '--help'], { cwd: appDir, env: smokeEnv });
    ensureExitCode(profileHelp, 0, 'pandora profile --help');
    ensureOutputContains(profileHelp, /profile list\|get\|explain\|recommend\|validate/, 'pandora profile --help');

    const policyList = runPandora(installedCli, ['policy', 'list'], { cwd: appDir, env: smokeEnv });
    ensureExitCode(policyList, 0, 'pandora policy list');
    ensureOutputContains(policyList, /research-only/, 'pandora policy list');

    const profileList = runPandora(installedCli, ['profile', 'list'], { cwd: appDir, env: smokeEnv });
    ensureExitCode(profileList, 0, 'pandora profile list');
    ensureOutputContains(profileList, /market_observer_ro/, 'pandora profile list');

    const exampleEnvPath = path.join(appDir, 'example.env');
    fs.writeFileSync(
      exampleEnvPath,
      [
        'CHAIN_ID=1',
        'RPC_URL=https://rpc.example.org',
        'PRIVATE_KEY=0xyour_private_key',
        'ORACLE=0xYourOracleAddress',
        'FACTORY=0xYourFactoryAddress',
        'USDC=0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      ].join('\n'),
    );

    const initEnvPath = path.join(appDir, '.env');
    const initEnv = runPandora(installedCli, ['init-env', '--example', exampleEnvPath, '--dotenv-path', initEnvPath], {
      cwd: appDir,
      env: smokeEnv,
    });
    ensureExitCode(initEnv, 0, 'pandora init-env');
    ensureOutputContains(initEnv, /Wrote env file:/, 'pandora init-env');

    const doctor = runPandora(installedCli, ['doctor', '--dotenv-path', initEnvPath], {
      cwd: appDir,
      env: smokeEnv,
    });
    ensureExitCode(doctor, 1, 'pandora doctor');
    ensureOutputContains(doctor, /Doctor checks failed\./, 'pandora doctor');

    const launchArgs = [
      'launch',
      '--skip-dotenv',
      '--question',
      'Will smoke test preflight run?',
      '--rules',
      'Resolves Yes if true. Resolves No if false. If canceled/postponed/abandoned/unresolved, resolve No.',
      '--sources',
      'https://example.com/a',
      'https://example.com/b',
      '--target-timestamp',
      FIXED_FUTURE_TIMESTAMP,
      '--liquidity',
      '10',
      '--dry-run',
    ];

    const dryRunPreflight = runPandora(installedCli, launchArgs, {
      cwd: appDir,
      env: buildIsolatedPandoraEnv(runtimeDir, { CHAIN_ID: '999', PRIVATE_KEY: `0x${'1'.repeat(64)}` }),
    });

    ensureExitCode(dryRunPreflight, 1, 'pandora launch --dry-run preflight');
    ensureOutputContains(
      dryRunPreflight,
      /Unsupported CHAIN_ID=999\. Supported: 1 or 146/,
      'pandora launch --dry-run preflight',
    );

    const cloneArgs = [
      'clone-bet',
      '--skip-dotenv',
      '--question',
      'Will clone smoke preflight run?',
      '--rules',
      'Resolves Yes if true. Resolves No if false. If canceled/postponed/abandoned/unresolved, resolve No.',
      '--sources',
      'https://example.com/a',
      'https://example.com/b',
      '--target-timestamp',
      FIXED_FUTURE_TIMESTAMP,
      '--liquidity',
      '10',
      '--dry-run',
    ];

    const cloneDryRun = runPandora(installedCli, cloneArgs, {
      cwd: appDir,
      env: buildIsolatedPandoraEnv(runtimeDir, { CHAIN_ID: '999', PRIVATE_KEY: `0x${'1'.repeat(64)}` }),
    });
    ensureExitCode(cloneDryRun, 1, 'pandora clone-bet --dry-run preflight');
    ensureOutputContains(cloneDryRun, /Unsupported CHAIN_ID, use 1 or 146/, 'pandora clone-bet --dry-run preflight');

    console.log('Pack/install smoke test passed.');
    console.log(`Tarball: ${tarballPath}`);
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (error) {
      // Windows runners can keep handles open briefly after npm exits.
      // Cleanup failures should not fail functional smoke validation.
      const transientWindowsCleanupError = process.platform === 'win32' && ['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code);
      if (!transientWindowsCleanupError) {
        throw error;
      }
    }
  }
}

main();
