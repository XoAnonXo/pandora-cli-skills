#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const ROOT_PACKAGE_PATH = path.join(ROOT_DIR, 'package.json');

const TYPESCRIPT_SDK_DIR = path.join(ROOT_DIR, 'sdk', 'typescript');
const TYPESCRIPT_PACKAGE_PATH = path.join(TYPESCRIPT_SDK_DIR, 'package.json');
const TYPESCRIPT_GENERATED_DIR = path.join(TYPESCRIPT_SDK_DIR, 'generated');
const TYPESCRIPT_GENERATED_MANIFEST_PATH = path.join(TYPESCRIPT_GENERATED_DIR, 'manifest.json');

const PYTHON_SDK_DIR = path.join(ROOT_DIR, 'sdk', 'python');
const PYTHON_PROJECT_PATH = path.join(PYTHON_SDK_DIR, 'pyproject.toml');
const PYTHON_PACKAGE_DIR = path.join(PYTHON_SDK_DIR, 'pandora_agent');
const PYTHON_GENERATED_DIR = path.join(PYTHON_PACKAGE_DIR, 'generated');
const PYTHON_GENERATED_MANIFEST_PATH = path.join(PYTHON_GENERATED_DIR, 'manifest.json');

const NPM_COMMAND = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org/';
const EMPTY_NPMRC_PATH = path.join(os.tmpdir(), 'pandora-sdk-public.npmrc');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sanitizeNpmPackageName(name) {
  return String(name || '')
    .trim()
    .replace(/^@/, '')
    .replace(/[\\/]/g, '-');
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function ensureCleanDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function parsePyprojectMetadata(projectPath) {
  const text = fs.readFileSync(projectPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const metadata = {};
  let inProject = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      inProject = line === '[project]';
      continue;
    }
    if (!inProject) {
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"\s*$/);
    if (match) {
      metadata[match[1]] = match[2];
    }
  }

  return metadata;
}

function resolvePythonRuntime() {
  const candidates = [];
  if (process.env.PANDORA_PYTHON) {
    candidates.push({ command: process.env.PANDORA_PYTHON, prefixArgs: [] });
  }
  candidates.push(
    { command: 'python3', prefixArgs: [] },
    { command: 'python', prefixArgs: [] },
    { command: 'py', prefixArgs: ['-3'] },
  );

  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.prefixArgs, '--version'], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      env: process.env,
      shell: false,
      windowsHide: true,
    });
    if (!result.error && result.status === 0) {
      return candidate;
    }
  }

  throw new Error('Python runtime not found. Set PANDORA_PYTHON or ensure python3/python is on PATH.');
}

function runCommand(command, args, options = {}) {
  const needsWindowsShell = process.platform === 'win32' && /\.cmd$/i.test(String(command || ''));
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT_DIR,
    encoding: 'utf8',
    env: options.env || process.env,
    shell: needsWindowsShell,
    windowsHide: true,
    maxBuffer: options.maxBuffer || 1024 * 1024 * 64,
  });

  if (result.error) {
    throw result.error;
  }

  if (!options.allowFailure && result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(
      `${command} ${args.join(' ')} exited with status ${result.status}${detail ? `\n${detail}` : ''}`,
    );
  }

  return result;
}

function buildMutableNpmEnv(overrides = {}) {
  if (!fs.existsSync(EMPTY_NPMRC_PATH)) {
    fs.writeFileSync(EMPTY_NPMRC_PATH, '# pandora sdk public npm config\n', 'utf8');
  }
  const env = {
    ...process.env,
    npm_config_registry: PUBLIC_NPM_REGISTRY,
    NPM_CONFIG_REGISTRY: PUBLIC_NPM_REGISTRY,
    npm_config_userconfig: EMPTY_NPMRC_PATH,
    NPM_CONFIG_USERCONFIG: EMPTY_NPMRC_PATH,
    ...overrides,
  };
  delete env.npm_config_dry_run;
  delete env.NPM_CONFIG_DRY_RUN;
  delete env.NODE_AUTH_TOKEN;
  delete env.NPM_TOKEN;
  for (const key of Object.keys(env)) {
    if (/^npm_config_.*auth/i.test(key) || /^NPM_CONFIG_.*AUTH/i.test(key)) {
      delete env[key];
    }
  }
  return env;
}

function listTarArchiveEntries(archivePath) {
  const result = runCommand('tar', ['-tzf', archivePath], {
    cwd: ROOT_DIR,
  });
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function runPython(pythonRuntime, args, options = {}) {
  return runCommand(
    pythonRuntime.command,
    [...pythonRuntime.prefixArgs, ...args],
    options,
  );
}

function nodeEval(source, args = [], options = {}) {
  return runCommand(process.execPath, ['-e', source, ...args], options);
}

function resolveTypescriptCompilerPath() {
  try {
    return require.resolve('typescript/bin/tsc', { paths: [ROOT_DIR] });
  } catch {
    throw new Error('TypeScript compiler is not available. Install devDependencies before running standalone SDK checks.');
  }
}

function loadStandaloneSdkMetadata() {
  const rootPackage = readJson(ROOT_PACKAGE_PATH);
  const typescriptPackage = readJson(TYPESCRIPT_PACKAGE_PATH);
  const typescriptGeneratedManifest = readJson(TYPESCRIPT_GENERATED_MANIFEST_PATH);
  const pythonProject = parsePyprojectMetadata(PYTHON_PROJECT_PATH);
  const pythonGeneratedManifest = readJson(PYTHON_GENERATED_MANIFEST_PATH);

  return {
    rootPackage,
    typescriptPackage,
    typescriptGeneratedManifest,
    pythonProject,
    pythonGeneratedManifest,
  };
}

function verifyTypescriptMetadata(metadata) {
  const {
    rootPackage,
    typescriptPackage,
    typescriptGeneratedManifest,
  } = metadata;
  const rootExport = typescriptPackage.exports && typescriptPackage.exports['.'];
  const generatedExport = typescriptPackage.exports && typescriptPackage.exports['./generated'];

  assert(typescriptPackage.name === '@thisispandora/agent-sdk', 'TypeScript SDK package name must be @thisispandora/agent-sdk');
  assert(typeof typescriptPackage.version === 'string' && typescriptPackage.version.length > 0, 'TypeScript SDK version is required');
  assert(typescriptPackage.main === './index.js', 'TypeScript SDK main must be ./index.js');
  assert(typescriptPackage.types === './index.d.ts', 'TypeScript SDK types must be ./index.d.ts');
  assert(typescriptGeneratedManifest.packageVersion === typescriptPackage.version, 'TypeScript generated manifest packageVersion must match sdk/typescript/package.json');
  assert(typescriptGeneratedManifest.contractPackageVersion === rootPackage.version, 'TypeScript generated manifest contractPackageVersion must match root package version');
  assert(
    rootExport === './index.js'
      || (rootExport && rootExport.require === './index.js' && rootExport.default === './index.js'),
    'TypeScript SDK must export the root entrypoint',
  );
  assert(
    generatedExport === './generated/index.js'
      || (generatedExport && generatedExport.require === './generated/index.js' && generatedExport.default === './generated/index.js'),
    'TypeScript SDK must export ./generated',
  );

  const requiredFiles = [
    'index.js',
    'index.d.ts',
    'backends.js',
    'backends.d.ts',
    'catalog.js',
    'catalog.d.ts',
    'errors.js',
    'errors.d.ts',
    'generated/**',
    'README.md',
  ];
  for (const entry of requiredFiles) {
    assert(Array.isArray(typescriptPackage.files) && typescriptPackage.files.includes(entry), `TypeScript SDK files must include ${entry}`);
  }
}

function verifyPythonMetadata(metadata) {
  const {
    rootPackage,
    pythonProject,
    pythonGeneratedManifest,
  } = metadata;

  assert(pythonProject.name === 'pandora-agent', 'Python SDK project.name must be pandora-agent');
  assert(typeof pythonProject.version === 'string' && pythonProject.version.length > 0, 'Python SDK project.version is required');
  assert(typeof pythonProject['requires-python'] === 'string' && pythonProject['requires-python'].length > 0, 'Python SDK requires-python is required');
  assert(pythonGeneratedManifest.packageVersion === pythonProject.version, 'Python generated manifest packageVersion must match sdk/python/pyproject.toml');
  assert(pythonGeneratedManifest.contractPackageVersion === rootPackage.version, 'Python generated manifest contractPackageVersion must match root package version');
  assert(pythonGeneratedManifest.package && pythonGeneratedManifest.package.name === pythonProject.name, 'Python generated manifest package.name must match pyproject name');
}

function runTypescriptSourceSmoke(metadata) {
  const source = `
const sdk = require(process.argv[1]);
const generated = require(process.argv[2]);
const manifest = sdk.loadGeneratedManifest();
const registry = sdk.loadGeneratedContractRegistry();
if (manifest.packageVersion !== process.argv[3]) {
  throw new Error('Unexpected TypeScript SDK packageVersion: ' + manifest.packageVersion);
}
if (!registry || typeof registry !== 'object' || !registry.capabilities || !registry.tools) {
  throw new Error('TypeScript SDK contract registry is incomplete.');
}
const generatedManifest = generated.loadGeneratedManifest();
if (generatedManifest.packageVersion !== process.argv[3]) {
  throw new Error('Unexpected generated packageVersion: ' + generatedManifest.packageVersion);
}
process.stdout.write(JSON.stringify({
  packageVersion: manifest.packageVersion,
  toolCount: Object.keys(registry.tools || {}).length,
  commandDescriptorVersion: manifest.commandDescriptorVersion,
}) + '\\n');
`;
  const result = nodeEval(
    source,
    [TYPESCRIPT_SDK_DIR, TYPESCRIPT_GENERATED_DIR, metadata.typescriptPackage.version],
    { cwd: ROOT_DIR },
  );
  return JSON.parse(String(result.stdout || '').trim());
}

function runTypescriptPackDryRun(metadata) {
  const result = runCommand(NPM_COMMAND, ['pack', '--dry-run', '--json'], {
    cwd: TYPESCRIPT_SDK_DIR,
    env: buildMutableNpmEnv({
      npm_config_loglevel: process.env.npm_config_loglevel || 'error',
    }),
  });
  const parsed = JSON.parse(result.stdout);
  assert(Array.isArray(parsed) && parsed.length === 1, 'Expected npm pack --dry-run --json to return one TypeScript SDK tarball');
  const tarball = parsed[0];
  const expectedFilename = `${sanitizeNpmPackageName(metadata.typescriptPackage.name)}-${metadata.typescriptPackage.version}.tgz`;
  assert(tarball.filename === expectedFilename, `Unexpected TypeScript SDK tarball filename: ${tarball.filename}`);

  const packedFiles = new Set((tarball.files || []).map((entry) => entry && entry.path).filter(Boolean));
  for (const requiredPath of [
    'README.md',
    'backends.js',
    'backends.d.ts',
    'backends.mjs',
    'catalog.js',
    'catalog.d.ts',
    'catalog.mjs',
    'errors.js',
    'errors.d.ts',
    'errors.mjs',
    'index.js',
    'index.d.ts',
    'index.mjs',
    'package.json',
    'generated/index.js',
    'generated/index.d.ts',
    'generated/index.mjs',
    'generated/manifest.json',
    'generated/manifest.d.ts',
    'generated/manifest.mjs',
    'generated/command-descriptors.json',
    'generated/command-descriptors.d.ts',
    'generated/command-descriptors.mjs',
    'generated/mcp-tool-definitions.json',
    'generated/mcp-tool-definitions.d.ts',
    'generated/mcp-tool-definitions.mjs',
    'generated/contract-registry.json',
    'generated/contract-registry.d.ts',
    'generated/contract-registry.mjs',
  ]) {
    assert(packedFiles.has(requiredPath), `TypeScript SDK tarball is missing ${requiredPath}`);
  }

  return {
    filename: tarball.filename,
    fileCount: packedFiles.size,
    unpackedSize: tarball.unpackedSize,
  };
}

function runPythonSourceSmoke(metadata, pythonRuntime) {
  const script = `
import json
import sys
sys.path.insert(0, sys.argv[1])
import pandora_agent
manifest = pandora_agent.load_generated_manifest()
registry = pandora_agent.load_generated_contract_registry()
artifacts = pandora_agent.list_generated_artifact_paths()
if manifest.get("packageVersion") != sys.argv[2]:
    raise SystemExit(f"Unexpected Python packageVersion: {manifest.get('packageVersion')}")
if not isinstance(registry, dict) or "capabilities" not in registry or "tools" not in registry:
    raise SystemExit("Python SDK contract registry is incomplete.")
print(json.dumps({
    "packageVersion": manifest.get("packageVersion"),
    "toolCount": len(registry.get("tools", {})),
    "artifactCount": len(artifacts),
}))
`;
  const result = runPython(
    pythonRuntime,
    ['-c', script, PYTHON_SDK_DIR, metadata.pythonProject.version],
    { cwd: ROOT_DIR },
  );
  return JSON.parse(String(result.stdout || '').trim());
}

function runTypescriptPackageLocalTests() {
  runCommand(process.execPath, ['--test', path.join('sdk', 'typescript', 'test', 'package-surface.test.cjs')], {
    cwd: ROOT_DIR,
  });
  return { ok: true };
}

function runPythonPackageLocalTests(pythonRuntime) {
  runPython(
    pythonRuntime,
    ['-m', 'unittest', 'discover', '-s', 'tests'],
    {
      cwd: PYTHON_SDK_DIR,
      env: {
        ...process.env,
        PYTHONPATH: PYTHON_SDK_DIR,
      },
    },
  );
  return { ok: true };
}

function runStandaloneSdkSourceChecks() {
  const metadata = loadStandaloneSdkMetadata();
  verifyTypescriptMetadata(metadata);
  verifyPythonMetadata(metadata);

  const pythonRuntime = resolvePythonRuntime();
  const typescriptPack = runTypescriptPackDryRun(metadata);
  const typescriptSmoke = runTypescriptSourceSmoke(metadata);
  const pythonSmoke = runPythonSourceSmoke(metadata, pythonRuntime);
  const packageLocalTypescriptTests = runTypescriptPackageLocalTests();
  const packageLocalPythonTests = runPythonPackageLocalTests(pythonRuntime);

  return {
    metadata,
    pythonRuntime,
    typescriptPack,
    typescriptSmoke,
    pythonSmoke,
    packageLocalTypescriptTests,
    packageLocalPythonTests,
  };
}

function assertPythonBuildFrontendAvailable(pythonRuntime) {
  const setuptoolsCheck = runPython(
    pythonRuntime,
    [
      '-c',
      'import json, setuptools, wheel; '
        + 'version = getattr(setuptools, "__version__", "0"); '
        + 'major = int(str(version).split(".")[0]); '
        + 'print(json.dumps({"setuptools": str(version), "setuptoolsMajor": major, "wheel": getattr(wheel, "__version__", "unknown")}))',
    ],
    {
      allowFailure: true,
      cwd: ROOT_DIR,
    },
  );
  if (setuptoolsCheck.status !== 0) {
    throw new Error(
      'Python release tooling is incomplete. Install `setuptools>=68` and `wheel` before running release:build-sdk-artifacts.',
    );
  }
  const setuptoolsMetadata = JSON.parse(String(setuptoolsCheck.stdout || '').trim());
  if (!Number.isFinite(setuptoolsMetadata.setuptoolsMajor) || setuptoolsMetadata.setuptoolsMajor < 68) {
    throw new Error(
      `Python release tooling requires setuptools>=68 (found ${setuptoolsMetadata.setuptools || 'unknown'}). Install it before running release:build-sdk-artifacts.`,
    );
  }

  const result = runPython(
    pythonRuntime,
    ['-m', 'build', '--help'],
    {
      allowFailure: true,
      cwd: ROOT_DIR,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      'Python build frontend is not available. Install it with `python3 -m pip install build` before running release:build-sdk-artifacts.',
    );
  }
}

function buildTypescriptSdkArtifact(metadata, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const result = runCommand(NPM_COMMAND, ['pack', '--json', '--pack-destination', outDir], {
    cwd: TYPESCRIPT_SDK_DIR,
    env: buildMutableNpmEnv({
      npm_config_loglevel: process.env.npm_config_loglevel || 'error',
    }),
  });
  const parsed = JSON.parse(result.stdout);
  assert(Array.isArray(parsed) && parsed.length === 1, 'Expected TypeScript SDK npm pack to emit one artifact');
  const packEntry = parsed[0];
  const artifactPath = path.join(outDir, packEntry.filename);
  assert(fs.existsSync(artifactPath), `Missing built TypeScript SDK artifact: ${artifactPath}`);
  return {
    filename: packEntry.filename,
    path: artifactPath,
    size: fs.statSync(artifactPath).size,
  };
}

function smokeInstalledTypescriptTarball(metadata, tarballPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-sdk-npm-smoke-'));
  try {
    writeJson(path.join(tempDir, 'package.json'), {
      name: 'thisispandora-agent-sdk-smoke',
      private: true,
      version: '0.0.0',
    });
    runCommand(NPM_COMMAND, ['install', '--omit=dev', '--ignore-scripts', tarballPath], {
      cwd: tempDir,
      env: buildMutableNpmEnv({
        npm_config_loglevel: process.env.npm_config_loglevel || 'error',
      }),
    });
    const script = `
const sdk = require('@thisispandora/agent-sdk');
const backends = require('@thisispandora/agent-sdk/backends');
const catalog = require('@thisispandora/agent-sdk/catalog');
const errors = require('@thisispandora/agent-sdk/errors');
const generated = require('@thisispandora/agent-sdk/generated');
const manifest = require('@thisispandora/agent-sdk/generated/manifest');
const commandDescriptors = require('@thisispandora/agent-sdk/generated/command-descriptors');
const mcpToolDefinitions = require('@thisispandora/agent-sdk/generated/mcp-tool-definitions');
const contractRegistry = require('@thisispandora/agent-sdk/generated/contract-registry');
if (sdk.loadGeneratedManifest().packageVersion !== process.argv[1]) {
  throw new Error('Unexpected installed TypeScript packageVersion: ' + sdk.loadGeneratedManifest().packageVersion);
}
if (JSON.stringify(manifest.registryDigest || {}) !== process.argv[2]) {
  throw new Error('Installed TypeScript registryDigest mismatch.');
}
if (manifest.commandCount !== Number(process.argv[3])) {
  throw new Error('Installed TypeScript commandCount mismatch.');
}
if (manifest.mcpToolCount !== Number(process.argv[4])) {
  throw new Error('Installed TypeScript mcpToolCount mismatch.');
}
if (typeof backends.PandoraStdioBackend !== 'function') {
  throw new Error('Missing PandoraStdioBackend export.');
}
if (typeof catalog.loadGeneratedManifest !== 'function') {
  throw new Error('Missing catalog.loadGeneratedManifest export.');
}
if (typeof errors.PandoraSdkError !== 'function') {
  throw new Error('Missing PandoraSdkError export.');
}
if (!generated || typeof generated.loadGeneratedContractRegistry !== 'function') {
  throw new Error('Missing generated export entrypoint.');
}
if (!manifest || manifest.packageVersion !== process.argv[1]) {
  throw new Error('Installed manifest subpath is invalid.');
}
if (!contractRegistry || !contractRegistry.capabilities || !contractRegistry.tools) {
  throw new Error('Installed contract-registry subpath is incomplete.');
}
if (contractRegistry.packageVersion !== process.argv[1]) {
  throw new Error('Installed contract-registry packageVersion mismatch.');
}
if (!commandDescriptors || typeof commandDescriptors !== 'object' || !Object.keys(commandDescriptors).length) {
  throw new Error('Installed command-descriptors subpath is empty.');
}
if (!Array.isArray(mcpToolDefinitions) || !mcpToolDefinitions.length) {
  throw new Error('Installed mcp-tool-definitions subpath is empty.');
}
process.stdout.write(JSON.stringify({
  packageVersion: manifest.packageVersion,
  commandCount: manifest.commandCount,
  toolCount: Object.keys(contractRegistry.tools || {}).length,
  exportCount: 8,
}) + '\\n');
`;
    const runtimeSmoke = JSON.parse(
      String(
        nodeEval(
          script,
          [
            metadata.typescriptPackage.version,
            JSON.stringify(metadata.typescriptGeneratedManifest.registryDigest || {}),
            String(metadata.typescriptGeneratedManifest.commandCount || 0),
            String(metadata.typescriptGeneratedManifest.mcpToolCount || 0),
          ],
          { cwd: tempDir },
        ).stdout || '',
      ).trim(),
    );

    const tsconfigPath = path.join(tempDir, 'tsconfig.json');
    const entryPath = path.join(tempDir, 'consumer.ts');
    writeJson(tsconfigPath, {
      compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        moduleResolution: 'node',
      },
      include: ['consumer.ts'],
    });
    fs.writeFileSync(entryPath, `'use strict';
import sdk = require('@thisispandora/agent-sdk');
import backends = require('@thisispandora/agent-sdk/backends');
import catalog = require('@thisispandora/agent-sdk/catalog');
import errors = require('@thisispandora/agent-sdk/errors');
import generated = require('@thisispandora/agent-sdk/generated');
import manifest = require('@thisispandora/agent-sdk/generated/manifest');
import commandDescriptors = require('@thisispandora/agent-sdk/generated/command-descriptors');
import mcpToolDefinitions = require('@thisispandora/agent-sdk/generated/mcp-tool-definitions');
import contractRegistry = require('@thisispandora/agent-sdk/generated/contract-registry');

const version: string = manifest.packageVersion;
const digest: Record<string, unknown> = manifest.registryDigest || {};
const tools: Record<string, unknown> = contractRegistry.tools;
const descriptor: unknown = commandDescriptors.capabilities;
const toolCount: number = mcpToolDefinitions.length;
const backendName: string = typeof backends.PandoraStdioBackend.name === 'string' ? backends.PandoraStdioBackend.name : 'PandoraStdioBackend';
const generatedManifestVersion: string = generated.loadGeneratedManifest().packageVersion;
const sdkVersion: string = sdk.loadGeneratedManifest().packageVersion;
const catalogDigest: Record<string, unknown> = catalog.loadGeneratedManifest().registryDigest || {};
const errorCtor: typeof errors.PandoraSdkError = errors.PandoraSdkError;

void version;
void digest;
void tools;
void descriptor;
void toolCount;
void backendName;
void generatedManifestVersion;
void sdkVersion;
void catalogDigest;
void errorCtor;
`, 'utf8');
    runCommand(process.execPath, [resolveTypescriptCompilerPath(), '--project', tsconfigPath, '--noEmit'], {
      cwd: tempDir,
    });

    const esmScriptPath = path.join(tempDir, 'consumer.mjs');
    fs.writeFileSync(esmScriptPath, `import sdk, { connectPandoraAgentClient, loadGeneratedManifest } from '@thisispandora/agent-sdk';\nimport generated from '@thisispandora/agent-sdk/generated';\nimport manifest from '@thisispandora/agent-sdk/generated/manifest';\nimport contractRegistry from '@thisispandora/agent-sdk/generated/contract-registry';\n\nif (typeof connectPandoraAgentClient !== 'function') throw new Error('Missing ESM connectPandoraAgentClient export.');\nif (typeof loadGeneratedManifest !== 'function') throw new Error('Missing ESM loadGeneratedManifest export.');\nif (sdk.loadGeneratedManifest().packageVersion !== ${JSON.stringify(metadata.typescriptPackage.version)}) throw new Error('Unexpected ESM sdk packageVersion.');\nif (manifest.packageVersion !== ${JSON.stringify(metadata.typescriptPackage.version)}) throw new Error('Unexpected ESM manifest packageVersion.');\nif (contractRegistry.packageVersion !== ${JSON.stringify(metadata.typescriptPackage.version)}) throw new Error('Unexpected ESM contract-registry packageVersion.');\nif (generated.loadGeneratedManifest().packageVersion !== ${JSON.stringify(metadata.typescriptPackage.version)}) throw new Error('Unexpected ESM generated packageVersion.');\nconsole.log(JSON.stringify({ esm: true, toolCount: Object.keys(contractRegistry.tools || {}).length }));\n`, 'utf8');
    const esmRuntime = JSON.parse(
      String(runCommand(process.execPath, [esmScriptPath], { cwd: tempDir }).stdout || '').trim(),
    );

    writeJson(tsconfigPath, {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        strict: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        moduleResolution: 'NodeNext',
      },
      include: ['consumer-esm.ts'],
    });
    fs.writeFileSync(path.join(tempDir, 'consumer-esm.ts'), `import sdk, { connectPandoraAgentClient, loadGeneratedManifest } from '@thisispandora/agent-sdk';\nimport generated from '@thisispandora/agent-sdk/generated';\nimport manifest from '@thisispandora/agent-sdk/generated/manifest';\nimport commandDescriptors from '@thisispandora/agent-sdk/generated/command-descriptors';\nimport mcpToolDefinitions from '@thisispandora/agent-sdk/generated/mcp-tool-definitions';\nimport contractRegistry from '@thisispandora/agent-sdk/generated/contract-registry';\n\nconst connectFn: typeof connectPandoraAgentClient = connectPandoraAgentClient;\nconst version: string = manifest.packageVersion;\nconst registryVersion: string = contractRegistry.packageVersion;\nconst generatedVersion: string = generated.loadGeneratedManifest().packageVersion;\nconst sdkVersion: string = loadGeneratedManifest().packageVersion;\nconst helpDescriptor = commandDescriptors.help;\nconst toolCount: number = mcpToolDefinitions.length;\nvoid sdk;\nvoid connectFn;\nvoid version;\nvoid registryVersion;\nvoid generatedVersion;\nvoid sdkVersion;\nvoid helpDescriptor;\nvoid toolCount;\n`, 'utf8');
    runCommand(process.execPath, [resolveTypescriptCompilerPath(), '--project', tsconfigPath, '--noEmit'], {
      cwd: tempDir,
    });

    return {
      ...runtimeSmoke,
      esmRuntime,
      typecheck: true,
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function buildPythonSdkArtifacts(metadata, pythonRuntime, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  assertPythonBuildFrontendAvailable(pythonRuntime);
  runPython(
    pythonRuntime,
    ['-m', 'build', '--sdist', '--wheel', '--outdir', outDir, '--no-isolation'],
    { cwd: PYTHON_SDK_DIR },
  );

  const files = fs.readdirSync(outDir).sort();
  const wheelFile = files.find((name) => name.endsWith('.whl'));
  const sdistFile = files.find((name) => name.endsWith('.tar.gz'));

  assert(wheelFile, 'Python SDK build did not produce a wheel');
  assert(sdistFile, 'Python SDK build did not produce an sdist');
  const sdistPath = path.join(outDir, sdistFile);
  const sdistEntries = listTarArchiveEntries(sdistPath);
  assert(
    !sdistEntries.some((entry) => /(^|\/)tests(\/|$)/.test(entry)),
    'Python SDK sdist must not include repository test files.',
  );
  assert(
    !sdistEntries.some((entry) => /(^|\/)__pycache__(\/|$)/.test(entry)),
    'Python SDK sdist must not include Python bytecode caches.',
  );

  return {
    wheel: {
      filename: wheelFile,
      path: path.join(outDir, wheelFile),
    },
    sdist: {
      filename: sdistFile,
      path: sdistPath,
      entries: sdistEntries,
    },
  };
}

function getVenvPythonPath(venvDir) {
  if (process.platform === 'win32') {
    return path.join(venvDir, 'Scripts', 'python.exe');
  }
  return path.join(venvDir, 'bin', 'python');
}

function smokeInstalledPythonArtifact(metadata, pythonRuntime, artifactPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-sdk-python-smoke-'));
  try {
    runPython(pythonRuntime, ['-m', 'venv', tempDir], { cwd: ROOT_DIR });
    const venvPython = getVenvPythonPath(tempDir);
    runCommand(venvPython, ['-m', 'pip', 'install', '--no-deps', artifactPath], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        PIP_DISABLE_PIP_VERSION_CHECK: '1',
      },
    });
    const script = `
import json
import pandora_agent
from pandora_agent import PandoraAgentClient
from pandora_agent.errors import PandoraSdkError
manifest = pandora_agent.load_generated_manifest()
registry = pandora_agent.load_generated_contract_registry()
if manifest.get("packageVersion") != "${metadata.pythonProject.version}":
    raise SystemExit(f"Unexpected installed Python packageVersion: {manifest.get('packageVersion')}")
expected_registry_digest = json.loads(${JSON.stringify(JSON.stringify(metadata.pythonGeneratedManifest.registryDigest || {}))})
if manifest.get("registryDigest", {}) != expected_registry_digest:
    raise SystemExit("Installed Python registryDigest mismatch.")
if manifest.get("commandCount") != ${Number(metadata.pythonGeneratedManifest.commandCount || 0)}:
    raise SystemExit("Installed Python commandCount mismatch.")
if manifest.get("mcpToolCount") != ${Number(metadata.pythonGeneratedManifest.mcpToolCount || 0)}:
    raise SystemExit("Installed Python mcpToolCount mismatch.")

class Backend:
    def connect(self):
        return None
    def close(self):
        return None
    def list_tools(self):
        return []
    def call_tool(self, name, args=None):
        if name == "future.tool":
            return {"structuredContent": {"ok": True, "command": name, "data": {"echo": True}}}
        return {"structuredContent": {"ok": False, "error": {"message": "failed without tool code"}}}

client = PandoraAgentClient(Backend(), catalog={"tools": {}})
ok = client.call_tool("future.tool")
error_code = None
try:
    client.call_tool("broken.tool")
except PandoraSdkError as error:
    error_code = error.code

print(json.dumps({
    "packageVersion": manifest.get("packageVersion"),
    "commandCount": manifest.get("commandCount"),
    "toolCount": len(registry.get("tools", {})),
    "futureToolOk": ok.get("ok"),
    "fallbackErrorCode": error_code,
}))
`;
    const result = runCommand(venvPython, ['-c', script], { cwd: ROOT_DIR });
    const parsed = JSON.parse(String(result.stdout || '').trim());
    parsed.artifact = path.basename(artifactPath);
    return parsed;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function runStandaloneSdkArtifactChecks(options = {}) {
  const tempOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-sdk-artifacts-'));
  try {
    const build = buildStandaloneSdkReleaseArtifacts({ outDir: tempOutDir });
    return {
      outDir: build.outDir,
      manifestPath: build.manifestPath,
      checksumPath: build.checksumPath,
      summary: build.summary,
    };
  } finally {
    fs.rmSync(tempOutDir, { recursive: true, force: true });
  }
}

function writeSdkChecksumFile(outDir, artifacts) {
  const checksumPath = path.join(outDir, 'sdk-checksums.sha256');
  const lines = artifacts.map((artifact) => `${sha256File(artifact.path)}  ${artifact.filename}`);
  fs.writeFileSync(checksumPath, `${lines.join('\n')}\n`, 'utf8');
  return checksumPath;
}

function buildStandaloneSdkReleaseArtifacts(options = {}) {
  const outDir = path.resolve(ROOT_DIR, options.outDir || path.join('dist', 'release', 'sdk'));
  const npmOutDir = path.join(outDir, 'npm');
  const pythonOutDir = path.join(outDir, 'python');

  const sourceChecks = runStandaloneSdkSourceChecks();
  const { metadata, pythonRuntime } = sourceChecks;

  ensureCleanDir(outDir);
  fs.mkdirSync(npmOutDir, { recursive: true });
  fs.mkdirSync(pythonOutDir, { recursive: true });

  const typescriptArtifact = buildTypescriptSdkArtifact(metadata, npmOutDir);
  const installedTypescriptSmoke = smokeInstalledTypescriptTarball(metadata, typescriptArtifact.path);
  const pythonArtifacts = buildPythonSdkArtifacts(metadata, pythonRuntime, pythonOutDir);
  const installedPythonWheelSmoke = smokeInstalledPythonArtifact(
    metadata,
    pythonRuntime,
    pythonArtifacts.wheel.path,
  );
  const installedPythonSdistSmoke = smokeInstalledPythonArtifact(
    metadata,
    pythonRuntime,
    pythonArtifacts.sdist.path,
  );

  const artifacts = [
    typescriptArtifact,
    pythonArtifacts.wheel,
    pythonArtifacts.sdist,
  ];
  const checksumPath = writeSdkChecksumFile(outDir, artifacts);
  const manifestPath = path.join(outDir, 'sdk-release-manifest.json');

  const summary = {
    generatedAt: new Date().toISOString(),
    rootPackage: {
      name: metadata.rootPackage.name,
      version: metadata.rootPackage.version,
    },
    sourceChecks: {
      pythonRuntime: [pythonRuntime.command].concat(pythonRuntime.prefixArgs || []).join(' '),
      typescriptPack: sourceChecks.typescriptPack,
      typescriptSmoke: sourceChecks.typescriptSmoke,
      pythonSmoke: sourceChecks.pythonSmoke,
    },
    artifacts: {
      typescript: {
        name: metadata.typescriptPackage.name,
        version: metadata.typescriptPackage.version,
        tarball: typescriptArtifact.filename,
        installedSmoke: installedTypescriptSmoke,
      },
      python: {
        name: metadata.pythonProject.name,
        version: metadata.pythonProject.version,
        wheel: pythonArtifacts.wheel.filename,
        sdist: pythonArtifacts.sdist.filename,
        sdistEntryCount: pythonArtifacts.sdist.entries.length,
        installedWheelSmoke: installedPythonWheelSmoke,
        installedSdistSmoke: installedPythonSdistSmoke,
      },
    },
    checksumFile: path.basename(checksumPath),
  };

  writeJson(manifestPath, summary);

  return {
    outDir,
    manifestPath,
    checksumPath,
    summary,
  };
}

module.exports = {
  ROOT_DIR,
  TYPESCRIPT_SDK_DIR,
  PYTHON_SDK_DIR,
  loadStandaloneSdkMetadata,
  resolvePythonRuntime,
  runStandaloneSdkSourceChecks,
  runStandaloneSdkArtifactChecks,
  buildStandaloneSdkReleaseArtifacts,
  sanitizeNpmPackageName,
  writeJson,
};
