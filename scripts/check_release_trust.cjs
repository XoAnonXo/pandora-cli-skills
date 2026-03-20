#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const PACKAGE_PATH = path.join(ROOT_DIR, 'package.json');
const CI_WORKFLOW_PATH = path.join(ROOT_DIR, '.github', 'workflows', 'ci.yml');
const RELEASE_WORKFLOW_PATH = path.join(ROOT_DIR, '.github', 'workflows', 'release.yml');
const INSTALLER_PATH = path.join(ROOT_DIR, 'scripts', 'release', 'install_release.sh');
const SBOM_SCRIPT_PATH = path.join(ROOT_DIR, 'scripts', 'generate_sbom.cjs');
const SDK_STANDALONE_CHECK_SCRIPT_PATH = path.join(ROOT_DIR, 'scripts', 'check_standalone_sdk_packages.cjs');
const SDK_RELEASE_ARTIFACT_SCRIPT_PATH = path.join(ROOT_DIR, 'scripts', 'release', 'build_standalone_sdk_artifacts.cjs');
const REPO_VERIFICATION_SCRIPT_PATH = path.join(ROOT_DIR, 'scripts', 'run_repo_verification.cjs');
const PREPARE_MANIFEST_SCRIPT_PATH = path.join(ROOT_DIR, 'scripts', 'prepare_publish_manifest.cjs');
const RESTORE_MANIFEST_SCRIPT_PATH = path.join(ROOT_DIR, 'scripts', 'restore_publish_manifest.cjs');
const RELEASE_VERIFICATION_DOC_PATH = path.join(ROOT_DIR, 'docs', 'trust', 'release-verification.md');
const SUPPORT_MATRIX_DOC_PATH = path.join(ROOT_DIR, 'docs', 'trust', 'support-matrix.md');
const FINAL_SIGNOFF_DOC_PATH = path.join(ROOT_DIR, 'docs', 'trust', 'final-readiness-signoff.md');
const pkg = require(PACKAGE_PATH);
const RELEASE_ASSET_FRAGMENTS = Object.freeze([
  '.tgz',
  '.tgz.sha256',
  'benchmark-publication-manifest.json',
  'benchmark-publication-manifest.json.sha256',
  'benchmark-publication-manifest.json.intoto.jsonl',
  'benchmark-publication-bundle.tar.gz',
  'benchmark-publication-bundle.tar.gz.sha256',
  'benchmark-publication-bundle.tar.gz.intoto.jsonl',
  'checksums.sha256',
  'core-bundle.json',
  'core-history.json',
  'core-report.json',
  'core.lock.json',
  'sdk-checksums.sha256',
  'sdk-release-manifest.json',
  'sbom.spdx.json',
  'sbom.spdx.json.sha256',
  'sbom.spdx.json.intoto.jsonl',
  '.intoto.jsonl',
  '.sig',
  '.pem',
]);

const DOC_OPTIONAL_RELEASE_ASSET_FRAGMENTS = new Set();

const DEFAULT_PUBLISHED_SCRIPT_NAMES = Object.freeze([
  'cli',
  'init-env',
  'doctor',
  'setup',
  'dry-run',
  'execute',
  'dry-run:clone',
  'generate:sbom',
  'generate:sbom:spdx',
  'check:sbom',
  'check:release-trust',
  'release:prep',
  'benchmark:run',
  'benchmark:check',
  'pack:dry-run',
]);

const DEFAULT_PUBLISHED_FILE_DENYLIST = Object.freeze([
  'scripts/check_skill_docs.cjs',
  'scripts/clean_sdk_python_cache.cjs',
  'scripts/generate_agent_contract_sdk.cjs',
  'scripts/prepare_publish_manifest.cjs',
  'scripts/restore_publish_manifest.cjs',
  'scripts/lib/**',
]);

function sanitizePackageName(name) {
  return String(name || '')
    .trim()
    .replace(/^@/, '')
    .replace(/[\\/]/g, '-');
}

function defaultSbomPath(format) {
  return path.join(
    ROOT_DIR,
    'dist',
    'release',
    `${sanitizePackageName(pkg.name)}-${pkg.version}.sbom.${format}.json`
  );
}

function parseArgs(argv) {
  const options = {
    json: false,
    requireSbom: false,
    sbomPath: defaultSbomPath('cyclonedx'),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--require-sbom') {
      options.requireSbom = true;
      continue;
    }

    if (arg === '--sbom') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--sbom requires a value');
      }
      options.sbomPath = path.resolve(ROOT_DIR, value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function workflowHasNode20Coverage(workflow) {
  return workflow.includes('node: [20]')
    || workflow.includes('node: 20')
    || workflow.includes('node-version: 20')
    || workflow.includes('node-version: ${{ matrix.node }}');
}

function workflowHasNpmTestCoverage(workflow) {
  return workflow.includes('run: npm test')
    || (
      workflow.includes('test_command: npm test')
      && workflow.includes('run: ${{ matrix.test_command }}')
    );
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function ensureFile(filePath) {
  assert(fs.existsSync(filePath), `Missing required file: ${path.relative(ROOT_DIR, filePath)}`);
}

function expectedTarballName() {
  return `${sanitizePackageName(pkg.name)}-${pkg.version}.tgz`;
}

function resolveNpmCommand(args) {
  if (process.platform === 'win32') {
    return {
      file: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm', ...args],
    };
  }
  return {
    file: 'npm',
    args,
  };
}

function runNpmPackDryRun() {
  const command = resolveNpmCommand(['pack', '--dry-run', '--json', '--ignore-scripts']);
  const output = execFileSync(command.file, command.args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_ignore_scripts: 'true',
      npm_config_loglevel: process.env.npm_config_loglevel || 'error',
    },
    maxBuffer: 1024 * 1024 * 32,
  });
  const parsed = JSON.parse(output);
  assert(Array.isArray(parsed) && parsed.length === 1, 'Expected npm pack --dry-run --json to return a single tarball entry');
  return parsed[0];
}

function runNpmSbomHelp() {
  const command = resolveNpmCommand(['sbom', '--help']);
  const output = execFileSync(command.file, command.args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_loglevel: process.env.npm_config_loglevel || 'error',
    },
    maxBuffer: 1024 * 1024 * 4,
  });
  assert(/Generate a Software Bill of Materials/i.test(output), 'npm sbom support is not available in this npm runtime');
}

function loadPublishManifestConfig() {
  if (!fs.existsSync(PREPARE_MANIFEST_SCRIPT_PATH)) {
    return {
      publishedScriptNames: DEFAULT_PUBLISHED_SCRIPT_NAMES,
      publishedFileDenylist: DEFAULT_PUBLISHED_FILE_DENYLIST,
      buildPublishedPackageJson: null,
    };
  }

  const helper = require(PREPARE_MANIFEST_SCRIPT_PATH);
  return {
    publishedScriptNames: Array.isArray(helper.PUBLISHED_SCRIPT_NAMES)
      ? helper.PUBLISHED_SCRIPT_NAMES
      : DEFAULT_PUBLISHED_SCRIPT_NAMES,
    publishedFileDenylist: Array.isArray(helper.PUBLISHED_FILE_DENYLIST)
      ? helper.PUBLISHED_FILE_DENYLIST
      : DEFAULT_PUBLISHED_FILE_DENYLIST,
    buildPublishedPackageJson: typeof helper.buildPublishedPackageJson === 'function'
      ? helper.buildPublishedPackageJson
      : null,
  };
}

function checkPublishedScriptSurface(manifest, publishedScriptNames, label) {
  const allowed = new Set(publishedScriptNames);
  const scripts = manifest.scripts || {};
  const scriptNames = Object.keys(scripts);

  for (const scriptName of scriptNames) {
    assert(allowed.has(scriptName), `${label} contains non-published script: ${scriptName}`);
  }

  for (const scriptName of publishedScriptNames) {
    assert(typeof scripts[scriptName] === 'string', `${label} is missing required script: ${scriptName}`);
  }

  assert(!manifest.devDependencies, `${label} must not ship devDependencies`);
}

function checkPublishedFilesSurface(manifest, publishedFileDenylist, label) {
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const denied = new Set(publishedFileDenylist);
  for (const entry of files) {
    assert(!denied.has(entry), `${label} contains repo-only published file entry: ${entry}`);
  }
}

function checkPublishManifestPipeline(publishManifestConfig) {
  ensureFile(PREPARE_MANIFEST_SCRIPT_PATH);
  ensureFile(RESTORE_MANIFEST_SCRIPT_PATH);
  assert(pkg.scripts['prepare:publish-manifest'] === 'node scripts/prepare_publish_manifest.cjs', 'package.json must expose prepare:publish-manifest');
  assert(pkg.scripts.postpack === 'node scripts/restore_publish_manifest.cjs', 'package.json postpack must restore the repository manifest directly');
  assert(
    typeof pkg.scripts.prepack === 'string' && pkg.scripts.prepack.includes('npm run prepare:publish-manifest'),
    'package.json prepack must prepare the publish manifest'
  );

  const buildPublishedPackageJson = publishManifestConfig.buildPublishedPackageJson;
  assert(typeof buildPublishedPackageJson === 'function', 'prepare_publish_manifest.cjs must export buildPublishedPackageJson');

  const publishedManifest = buildPublishedPackageJson(pkg);
  checkPublishedScriptSurface(publishedManifest, publishManifestConfig.publishedScriptNames, 'prepared publish manifest');
  checkPublishedFilesSurface(publishedManifest, publishManifestConfig.publishedFileDenylist, 'prepared publish manifest');
}

function checkPackageMetadata() {
  assert(typeof pkg.name === 'string' && pkg.name.length > 0, 'package.json must define name');
  assert(typeof pkg.version === 'string' && /^\d+\.\d+\.\d+/.test(pkg.version), 'package.json must define a semver version');
  assert(typeof pkg.license === 'string' && pkg.license.length > 0, 'package.json must define license');
  assert(pkg.repository && pkg.repository.type === 'git', 'package.json repository.type must be git');
  assert(pkg.repository && typeof pkg.repository.url === 'string' && /^git\+https:\/\/github\.com\/.+\.git$/.test(pkg.repository.url), 'package.json repository.url must point at a GitHub git URL');
  assert(pkg.bugs && typeof pkg.bugs.url === 'string' && /^https:\/\/github\.com\/.+\/issues$/.test(pkg.bugs.url), 'package.json bugs.url must point at GitHub issues');
  assert(typeof pkg.homepage === 'string' && /^https:\/\/github\.com\/.+#readme$/.test(pkg.homepage), 'package.json homepage must point at the GitHub README');
  assert(pkg.engines && typeof pkg.engines.node === 'string' && pkg.engines.node.length > 0, 'package.json must declare engines.node');
  assert(pkg.bin && pkg.bin.pandora === 'cli/pandora.cjs', 'package.json bin.pandora must point at cli/pandora.cjs');
  assert(pkg.main === 'cli/pandora.cjs', 'package.json main must point at cli/pandora.cjs');
  assert(pkg.exports && pkg.exports['.'] === './cli/pandora.cjs', 'package.json exports[\".\"] must point at ./cli/pandora.cjs');
  assert(pkg.exports && pkg.exports['./sdk/generated'] === './sdk/generated/index.js', 'package.json must export ./sdk/generated');
  assert(pkg.exports && pkg.exports['./sdk/typescript'] === './sdk/typescript/index.js', 'package.json must export ./sdk/typescript');
  assert(pkg.exports && pkg.exports['./sdk/typescript/backends'] === './sdk/typescript/backends.js', 'package.json must export ./sdk/typescript/backends');
  assert(pkg.exports && pkg.exports['./sdk/typescript/catalog'] === './sdk/typescript/catalog.js', 'package.json must export ./sdk/typescript/catalog');
  assert(pkg.exports && pkg.exports['./sdk/typescript/errors'] === './sdk/typescript/errors.js', 'package.json must export ./sdk/typescript/errors');
  assert(pkg.exports && pkg.exports['./sdk/typescript/generated'] === './sdk/typescript/generated/index.js', 'package.json must export ./sdk/typescript/generated');
  assert(pkg.exports && pkg.exports['./sdk/typescript/generated/manifest'] === './sdk/typescript/generated/manifest.json', 'package.json must export ./sdk/typescript/generated/manifest');
  assert(pkg.exports && pkg.exports['./sdk/typescript/generated/command-descriptors'] === './sdk/typescript/generated/command-descriptors.json', 'package.json must export ./sdk/typescript/generated/command-descriptors');
  assert(pkg.exports && pkg.exports['./sdk/typescript/generated/mcp-tool-definitions'] === './sdk/typescript/generated/mcp-tool-definitions.json', 'package.json must export ./sdk/typescript/generated/mcp-tool-definitions');
  assert(pkg.exports && pkg.exports['./sdk/typescript/generated/contract-registry'] === './sdk/typescript/generated/contract-registry.json', 'package.json must export ./sdk/typescript/generated/contract-registry');
  assert(Array.isArray(pkg.files) && pkg.files.length > 0, 'package.json must define files');

  const requiredFileEntries = [
    'cli/pandora.cjs',
    'cli/lib/**',
    'sdk/generated/**',
    'sdk/typescript/index.js',
    'sdk/typescript/index.d.ts',
    'sdk/typescript/backends.js',
    'sdk/typescript/backends.d.ts',
    'sdk/typescript/catalog.js',
    'sdk/typescript/catalog.d.ts',
    'sdk/typescript/errors.js',
    'sdk/typescript/errors.d.ts',
    'sdk/typescript/generated/**',
    'sdk/typescript/package.json',
    'sdk/python/pandora_agent/**',
    'sdk/python/pandora_agent/generated/**',
    'sdk/python/pyproject.toml',
    'benchmarks/latest/core-report.json',
    'benchmarks/latest/core-bundle.json',
    'benchmarks/latest/core-history.json',
    'README.md',
    'README_FOR_SHARING.md',
    'docs/benchmarks/**',
    'docs/skills/**',
    'docs/trust/**',
    'scripts/release/install_release.sh',
  ];

  for (const entry of requiredFileEntries) {
    assert(pkg.files.includes(entry), `package.json files is missing required entry: ${entry}`);
  }

  assert(pkg.scripts['check:sdk-standalone'] === 'node scripts/check_standalone_sdk_packages.cjs', 'package.json must expose check:sdk-standalone');
  assert(pkg.scripts['check:sdk-contracts'] === 'npm run clean:sdk-python-cache && node scripts/generate_agent_contract_sdk.cjs --check', 'package.json must expose check:sdk-contracts with the generated artifact freshness gate');
  assert(pkg.scripts['check:final-readiness'] === 'node scripts/check_a_plus_scorecard.cjs --artifact-neutral', 'package.json must expose check:final-readiness');
  assert(pkg.scripts['benchmark:check'] === 'node scripts/check_agent_benchmarks.cjs', 'package.json must expose benchmark:check with the benchmark freshness gate');
  assert(pkg.scripts['release:build-sdk-artifacts'] === 'node scripts/release/build_standalone_sdk_artifacts.cjs', 'package.json must expose release:build-sdk-artifacts');
  assert(pkg.scripts['release:pack'] === 'node scripts/release/pack_release_tarball.cjs', 'package.json must expose release:pack');
  assert(pkg.scripts['release:publish:artifact'] === 'node scripts/release/publish_release_tarball.cjs', 'package.json must expose release:publish:artifact');
  assert(typeof pkg.scripts['release:publish'] === 'string' && pkg.scripts['release:publish'].includes('npm run release:prep'), 'package.json release:publish must run release:prep');
  assert(typeof pkg.scripts['release:publish'] === 'string' && pkg.scripts['release:publish'].includes('npm run release:pack'), 'package.json release:publish must run release:pack');
  assert(typeof pkg.scripts['release:publish'] === 'string' && pkg.scripts['release:publish'].includes('npm run release:publish:artifact'), 'package.json release:publish must run release:publish:artifact');
  assert(pkg.scripts.build === 'npm run typecheck', 'package.json build must stay a narrow compile/typecheck surface');
  assert(pkg.scripts['verify:repo'] === 'node scripts/run_repo_verification.cjs', 'package.json verify:repo must delegate to scripts/run_repo_verification.cjs');
  assert(typeof pkg.scripts['verify:tests'] === 'string', 'package.json must expose verify:tests');
  assert(typeof pkg.scripts['release:verify'] === 'string', 'package.json must expose release:verify');
  assert(typeof pkg.scripts.prepack === 'string' && pkg.scripts.prepack.trim() === 'npm run prepare:publish-manifest', 'package.json prepack must be packaging-only and prepare the publish manifest');
  for (const disallowedPrepackFragment of [
    'check:secret-scan',
    'check:docs',
    'check:anthropic-skill',
    'check:release-trust',
    'check:release-drift',
    'check:sdk-contracts',
    'check:sdk-standalone',
    'benchmark:check',
  ]) {
    assert(
      !pkg.scripts.prepack.includes(disallowedPrepackFragment),
      `package.json prepack must not rerun heavyweight verification fragment: ${disallowedPrepackFragment}`,
    );
  }
  const repoVerificationScript = readUtf8(REPO_VERIFICATION_SCRIPT_PATH);
  for (const verifyRepoFragment of [
    "args: ['run', 'build']",
    "args: ['run', 'check:docs']",
    "args: ['run', 'check:anthropic-skill']",
    "args: ['run', 'check:secret-scan']",
    "args: ['run', 'check:sdk-contracts']",
    "args: ['run', 'check:sdk-standalone']",
    'Promise.all',
  ]) {
    assert(
      repoVerificationScript.includes(verifyRepoFragment),
      `scripts/run_repo_verification.cjs must include ${verifyRepoFragment}`,
    );
  }
  for (const verifyTestsFragment of [
    'npm run test:unit',
    'npm run test:cli',
    'npm run test:agent-workflow',
    'npm run test:smoke',
  ]) {
    assert(
      pkg.scripts['verify:tests'].includes(verifyTestsFragment),
      `package.json verify:tests must include ${verifyTestsFragment}`,
    );
  }
  assert(!pkg.scripts.test.includes('npm run build'), 'package.json test must not re-enter build');
  assert(!pkg.scripts.test.includes('npm run benchmark:check'), 'package.json test must not rerun benchmark:check');
  assert(pkg.scripts.test.includes('npm run verify:tests'), 'package.json test must delegate to verify:tests');
  for (const releaseVerifyFragment of [
    'npm run verify:repo',
    'npm run verify:tests',
    'npm run benchmark:check',
  ]) {
    assert(
      pkg.scripts['release:verify'].includes(releaseVerifyFragment),
      `package.json release:verify must include ${releaseVerifyFragment}`,
    );
  }
  assert(typeof pkg.scripts['release:prep'] === 'string' && pkg.scripts['release:prep'].includes('npm run release:verify'), 'package.json release:prep must run release:verify');
  assert(typeof pkg.scripts['release:prep'] === 'string' && pkg.scripts['release:prep'].includes('npm run generate:sbom'), 'package.json release:prep must generate the CycloneDX SBOM');
  assert(typeof pkg.scripts['release:prep'] === 'string' && pkg.scripts['release:prep'].includes('npm run generate:sbom:spdx'), 'package.json release:prep must generate the SPDX SBOM');
  assert(typeof pkg.scripts['release:prep'] === 'string' && pkg.scripts['release:prep'].includes('npm run check:release-trust -- --require-sbom'), 'package.json release:prep must verify release trust with SBOMs');
  assert(typeof pkg.scripts['release:prep'] === 'string' && pkg.scripts['release:prep'].includes('npm run check:release-drift -- --require-clean-tree'), 'package.json release:prep must require a clean tree after verification');
  assert(pkg.scripts.prepublishOnly === 'node scripts/release/block_source_publish.cjs', 'package.json prepublishOnly must block direct source-tree publish');
}

function checkWorkflowAndInstaller() {
  ensureFile(CI_WORKFLOW_PATH);
  ensureFile(RELEASE_WORKFLOW_PATH);
  ensureFile(INSTALLER_PATH);
  ensureFile(SBOM_SCRIPT_PATH);
  ensureFile(SDK_STANDALONE_CHECK_SCRIPT_PATH);
  ensureFile(SDK_RELEASE_ARTIFACT_SCRIPT_PATH);
  ensureFile(REPO_VERIFICATION_SCRIPT_PATH);
  ensureFile(RELEASE_VERIFICATION_DOC_PATH);
  ensureFile(SUPPORT_MATRIX_DOC_PATH);
  ensureFile(FINAL_SIGNOFF_DOC_PATH);

  const ciWorkflow = readUtf8(CI_WORKFLOW_PATH);
  const workflow = readUtf8(RELEASE_WORKFLOW_PATH);
  const installer = readUtf8(INSTALLER_PATH);
  const releaseVerificationDoc = readUtf8(RELEASE_VERIFICATION_DOC_PATH);
  const supportMatrixDoc = readUtf8(SUPPORT_MATRIX_DOC_PATH);
  const finalSignoffDoc = readUtf8(FINAL_SIGNOFF_DOC_PATH);

  const ciWorkflowExpectations = [
    'ubuntu-latest',
    'macos-latest',
    'windows-latest',
    'npm test',
    'Standalone SDK Artifacts',
    'python3 -m pip install --disable-pip-version-check --quiet "setuptools>=68" wheel build',
    'npm run release:build-sdk-artifacts',
  ];

  for (const fragment of ciWorkflowExpectations) {
    assert(ciWorkflow.includes(fragment), `ci workflow is missing required platform/smoke coverage: ${fragment}`);
  }
  assert(workflowHasNode20Coverage(ciWorkflow), 'ci workflow is missing required Node 20 coverage');

  const workflowExpectations = [
    'permissions:',
    'contents: write',
    'id-token: write',
    'attestations: write',
    'needs: validate',
    'ubuntu-latest',
    'macos-latest',
    'windows-latest',
    'npm ci',
    'run: npm run release:prep',
    'python3 -m pip install --disable-pip-version-check --quiet "setuptools>=68" wheel build',
    'run: npm run release:build-sdk-artifacts',
    'npm pack',
    'Refresh benchmark publication JSON artifacts',
    'Build benchmark publication bundle',
    'Build benchmark publication manifest',
    'core-bundle.json',
    'core-history.json',
    'benchmark-publication-bundle.tar.gz',
    'benchmark-publication-bundle.tar.gz.sha256',
    'benchmark-publication-manifest.json',
    'benchmark-publication-manifest.json.sha256',
    'docs/benchmarks',
    'checksums.sha256',
    'sdk-checksums.sha256',
    'sdk-release-manifest.json',
    'dist/release/sdk/npm/*.tgz',
    'dist/release/sdk/npm/*.tgz.sig',
    'dist/release/sdk/npm/*.tgz.pem',
    'dist/release/sdk/python/*.whl',
    'dist/release/sdk/python/*.whl.sig',
    'dist/release/sdk/python/*.whl.pem',
    'dist/release/sdk/python/*.tar.gz',
    'dist/release/sdk/python/*.tar.gz.sig',
    'dist/release/sdk/python/*.tar.gz.pem',
    'Prepare standalone Python SDK publish staging directory',
    'dist/release/sdk/python-publish',
    'cp "${python_distributions[@]}" "$STAGING_DIR"/',
    'packages-dir: dist/release/sdk/python-publish',
    'attestations: false',
    '"$SDK_CHECKSUMS"',
    'scripts/generate_sbom.cjs',
    'actions/attest-build-provenance@',
    'steps.benchmark_bundle_attestation_asset.outputs.bundle_asset',
    'steps.benchmark_manifest_attestation_asset.outputs.bundle_asset',
    'actions/attest-sbom@',
    'sbom.spdx.json',
    'cosign sign-blob',
    'cosign verify-blob',
    'softprops/action-gh-release',
  ];

  for (const fragment of workflowExpectations) {
    assert(workflow.includes(fragment), `release workflow is missing required trust surface: ${fragment}`);
  }
  assert(workflowHasNode20Coverage(workflow), 'release workflow is missing required Node 20 coverage');
  assert(workflowHasNpmTestCoverage(workflow), 'release workflow is missing required npm test coverage');

  const dynamicWorkflowAssetMatchers = new Map([
    ['.tgz', ['steps.pack.outputs.tarball']],
    ['.tgz.sha256', ['steps.pack.outputs.checksum_file']],
    [
      'benchmark-publication-bundle.tar.gz',
      ['steps.benchmark_bundle.outputs.bundle_file'],
    ],
    [
      'benchmark-publication-bundle.tar.gz.sha256',
      ['steps.benchmark_bundle.outputs.bundle_checksum_file'],
    ],
    [
      'benchmark-publication-bundle.tar.gz.intoto.jsonl',
      ['steps.benchmark_bundle_attestation_asset.outputs.bundle_asset'],
    ],
    [
      'benchmark-publication-manifest.json',
      ['steps.benchmark_manifest.outputs.manifest_file'],
    ],
    [
      'benchmark-publication-manifest.json.sha256',
      ['steps.benchmark_manifest.outputs.manifest_checksum_file'],
    ],
    [
      'benchmark-publication-manifest.json.intoto.jsonl',
      ['steps.benchmark_manifest_attestation_asset.outputs.bundle_asset'],
    ],
    [
      'sbom.spdx.json.intoto.jsonl',
      ['steps.sbom_attestation_asset.outputs.bundle_asset', '${SBOM_FILE}.intoto.jsonl'],
    ],
  ]);

  for (const fragment of RELEASE_ASSET_FRAGMENTS) {
    const dynamicMatchers = dynamicWorkflowAssetMatchers.get(fragment) || [];
    const workflowHasFragment = workflow.includes(fragment) || dynamicMatchers.some((matcher) => workflow.includes(matcher));
    assert(workflowHasFragment, `release workflow is missing required release asset fragment: ${fragment}`);
    if (!DOC_OPTIONAL_RELEASE_ASSET_FRAGMENTS.has(fragment)) {
      assert(releaseVerificationDoc.includes(fragment), `release-verification doc is missing required release asset fragment: ${fragment}`);
    }
  }

  const installerExpectations = [
    'checksums.sha256',
    'core-bundle.json',
    'core-history.json',
    'core-report.json',
    'core.lock.json',
    'benchmark-publication-manifest.json',
    'sdk-checksums.sha256',
    'sdk-release-manifest.json',
    'cosign verify-blob',
    'gh attestation verify',
    'sbom.spdx.json',
    '.sig',
    '.pem',
    '.github/workflows/release.yml@refs/tags/',
    'https://spdx.dev/Document',
  ];

  for (const fragment of installerExpectations) {
    assert(installer.includes(fragment), `release installer is missing required verification flow: ${fragment}`);
  }
  assert(
    installer.includes('sbom.spdx.json.intoto.jsonl')
      || installer.includes('SBOM_BUNDLE_ASSET="${SBOM_ASSET}.intoto.jsonl"'),
    'release installer is missing required verification flow: sbom.spdx.json.intoto.jsonl',
  );

  const finalSignoffExpectations = [
    'release-blocking signoff contract',
    'docs/trust/final-readiness-signoff.md',
    'bootstrap',
    'capabilities',
    'schema',
    'GET /bootstrap',
    'GET /schema',
    'GET /tools',
    '@thisispandora/agent-sdk',
    'pandora-agent',
    'sdk-release-manifest.json',
    'sdk-checksums.sha256',
    'runtime-local-readiness',
    'profile explain',
    '/operations/{operationId}/receipt',
    '/operations/{operationId}/receipt/verify',
    'core-bundle.json',
    'core-history.json',
    'core-report.json',
    'core.lock.json',
    'benchmark-publication-manifest.json',
    'benchmark-publication-bundle.tar.gz',
    'checksums.sha256',
    'sbom.spdx.json',
    '.intoto.jsonl',
    '.sig',
    '.pem',
    'npm test',
    'npm run check:docs',
    'npm run check:sdk-contracts',
    'npm run check:final-readiness',
    'npm run benchmark:check',
    'npm run check:release-trust',
    'npm run release:prep',
    'npm run release:publish',
  ];
  for (const fragment of finalSignoffExpectations) {
    assert(finalSignoffDoc.includes(fragment), `final-readiness-signoff doc is missing required signoff evidence fragment: ${fragment}`);
  }

  const supportMatrixExpectations = [
    'Linux, macOS, and Windows',
    'GitHub build provenance for both the tarball and shipped SPDX SBOM asset',
    'keyless cosign verification',
    'signed GitHub release tarball attached to the tagged Pandora release',
    'signed GitHub release wheel or sdist attached to the tagged Pandora release',
    'benchmark publication bundle',
    'final-readiness-signoff.md',
  ];
  for (const fragment of supportMatrixExpectations) {
    assert(supportMatrixDoc.includes(fragment), `support-matrix doc is missing required release assurance statement: ${fragment}`);
  }

  const releaseVerificationExpectations = [
    'pandora-agent-sdk-*.tgz',
    'pandora-agent-sdk-*.tgz.sig',
    'pandora-agent-sdk-*.tgz.pem',
    'pandora_agent-*.whl',
    'pandora_agent-*.whl.sig',
    'pandora_agent-*.whl.pem',
    'pandora_agent-*.tar.gz',
    'pandora_agent-*.tar.gz.sig',
    'pandora_agent-*.tar.gz.pem',
    'core-bundle.json',
    'core-history.json',
    'benchmark-publication-bundle.tar.gz',
    'benchmark-publication-bundle.tar.gz.intoto.jsonl',
    'benchmark-publication-manifest.json',
    'benchmark-publication-manifest.json.intoto.jsonl',
    'docs/benchmarks/history.json',
    'docsHistoryPath',
    'docsHistorySha256',
    'standalone SDK tarball, wheel, and sdist',
    'final-readiness-signoff.md',
    'npm run release:publish',
    'source-tree `npm publish` is intentionally blocked',
  ];
  for (const fragment of releaseVerificationExpectations) {
    assert(releaseVerificationDoc.includes(fragment), `release-verification doc is missing required SDK release verification guidance: ${fragment}`);
  }
}

function checkPackedArtifact() {
  const packResult = runNpmPackDryRun();
  const packedFiles = new Set(
    Array.isArray(packResult.files)
      ? packResult.files.map((entry) => entry && entry.path).filter(Boolean)
      : []
  );

  assert(packResult.filename === expectedTarballName(), `Expected tarball name ${expectedTarballName()}, received ${packResult.filename}`);
  assert(packedFiles.size > 0, 'Packed artifact contains no files');

  const requiredPackPaths = [
    'package.json',
    'README.md',
    'README_FOR_SHARING.md',
    'cli/pandora.cjs',
    'benchmarks/latest/core-report.json',
    'benchmarks/latest/core-bundle.json',
    'benchmarks/latest/core-history.json',
    'sdk/generated/index.js',
    'sdk/generated/manifest.json',
    'sdk/typescript/index.js',
    'sdk/typescript/index.d.ts',
    'sdk/typescript/generated/**',
    'sdk/typescript/generated/manifest.json',
    'sdk/typescript/package.json',
    'sdk/python/pandora_agent/generated/**',
    'docs/benchmarks/history.json',
    'docs/skills/agent-quickstart.md',
    'docs/skills/agent-interfaces.md',
    'docs/skills/capabilities.md',
    'docs/trust/final-readiness-signoff.md',
    'docs/trust/release-verification.md',
    'docs/trust/security-model.md',
    'docs/trust/support-matrix.md',
    'scripts/release/install_release.sh',
  ];

  for (const packPath of requiredPackPaths) {
    if (packPath.endsWith('/**')) {
      const prefix = packPath.slice(0, -3);
      const hasMatch = Array.from(packedFiles).some((entry) => entry === prefix || entry.startsWith(`${prefix}/`));
      assert(hasMatch, `Packed artifact is missing required file: ${packPath}`);
      continue;
    }
    assert(packedFiles.has(packPath), `Packed artifact is missing required file: ${packPath}`);
  }

  for (const [subpath, target] of Object.entries(pkg.exports || {})) {
    if (typeof target !== 'string') {
      continue;
    }
    const packedTarget = target.replace(/^\.\//, '');
    assert(packedFiles.has(packedTarget), `Export ${subpath} points to missing packed file: ${packedTarget}`);
  }

  return {
    filename: packResult.filename,
    entryCount: packResult.entryCount,
    fileCount: packedFiles.size,
  };
}

function checkSbomArtifact(options) {
  runNpmSbomHelp();

  if (!options.requireSbom) {
    return null;
  }

  assert(fs.existsSync(options.sbomPath), `Missing generated SBOM artifact: ${path.relative(ROOT_DIR, options.sbomPath)}`);
  const bom = JSON.parse(readUtf8(options.sbomPath));
  assert(
    bom.bomFormat === 'CycloneDX' || (typeof bom.spdxVersion === 'string' && bom.spdxVersion.startsWith('SPDX-')),
    'Generated SBOM must be valid CycloneDX or SPDX JSON'
  );

  const summary = bom.bomFormat === 'CycloneDX'
    ? {
        format: 'cyclonedx',
        componentCount: Array.isArray(bom.components) ? bom.components.length : 0,
        dependencyCount: Array.isArray(bom.dependencies) ? bom.dependencies.length : 0,
      }
    : {
        format: 'spdx',
        componentCount: Array.isArray(bom.packages) ? bom.packages.length : 0,
        dependencyCount: Array.isArray(bom.relationships) ? bom.relationships.length : 0,
      };

  assert(summary.componentCount > 0, 'Generated SBOM must contain at least one component/package');
  assert(summary.dependencyCount > 0, 'Generated SBOM must contain dependency relationships');

  return {
    output: path.relative(ROOT_DIR, options.sbomPath),
    ...summary,
  };
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const publishManifestConfig = loadPublishManifestConfig();
  const repoCheckout = Boolean(publishManifestConfig.buildPublishedPackageJson);

  ensureFile(PACKAGE_PATH);
  if (repoCheckout) {
    ensureFile(path.join(ROOT_DIR, 'package-lock.json'));
  }

  checkPackageMetadata();
  checkWorkflowAndInstaller();
  if (publishManifestConfig.buildPublishedPackageJson) {
    checkPublishManifestPipeline(publishManifestConfig);
  } else {
    checkPublishedScriptSurface(pkg, publishManifestConfig.publishedScriptNames, 'published package.json');
    checkPublishedFilesSurface(pkg, publishManifestConfig.publishedFileDenylist, 'published package.json');
  }
  const packSummary = checkPackedArtifact();
  const sbomSummary = checkSbomArtifact(options);

  const result = {
    ok: true,
    packageName: pkg.name,
    version: pkg.version,
    tarball: packSummary,
    sbom: sbomSummary,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`Release trust checks passed for ${pkg.name}@${pkg.version}\n`);
  process.stdout.write(`Packed artifact: ${packSummary.filename} (${packSummary.fileCount} files)\n`);
  if (sbomSummary) {
    process.stdout.write(
      `SBOM artifact: ${sbomSummary.output} (${sbomSummary.format}, components=${sbomSummary.componentCount}, dependencies=${sbomSummary.dependencyCount})\n`
    );
  } else {
    process.stdout.write('SBOM artifact: not required for this run\n');
  }
}

run();
