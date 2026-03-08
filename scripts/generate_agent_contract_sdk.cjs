#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const {
  buildGeneratedArtifactFiles,
  GENERATED_DIR,
  LEGACY_GENERATED_FILES,
} = require('./lib/agent_contract_sdk_export.cjs');

const REFRESH_SDK_COMMAND = 'node scripts/generate_agent_contract_sdk.cjs';
const VERIFY_SDK_COMMAND = 'npm run check:sdk-contracts';

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readPythonPackageMetadata(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const versionMatch = text.match(/^\s*version\s*=\s*"([^"\n]+)"\s*$/m);
  if (!versionMatch) {
    throw new Error(`Could not determine Python package version from ${path.relative(process.cwd(), filePath)}`);
  }
  const nameMatch = text.match(/^\s*name\s*=\s*"([^"\n]+)"\s*$/m);
  if (!nameMatch) {
    throw new Error(`Could not determine Python package name from ${path.relative(process.cwd(), filePath)}`);
  }
  return {
    name: nameMatch[1],
    version: versionMatch[1],
  };
}

function readGeneratedFile(files, relativePath) {
  const file = files.find((entry) => entry.relativePath === relativePath);
  if (!file) {
    throw new Error(`Missing generated artifact in memory: ${relativePath}`);
  }
  return JSON.parse(file.content);
}

function expectEqual(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, received ${actual}`);
  }
}

function expectDeepEqual(label, actual, expected) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label} mismatch.`);
  }
}

function validateGeneratedSurfaceMetadata(files, expected) {
  const rootManifest = readGeneratedFile(files, 'sdk/generated/manifest.json');
  const rootRegistry = readGeneratedFile(files, 'sdk/generated/contract-registry.json');
  const rootGeneratedPackage = readGeneratedFile(files, 'sdk/generated/package.json');
  const publishedSurfaces = rootManifest && rootManifest.publishedSurfaces ? rootManifest.publishedSurfaces : {};
  const rootSurface = publishedSurfaces.root || {};
  const typescriptSurface = publishedSurfaces.typescript || {};
  const pythonSurface = publishedSurfaces.python || {};
  const packagedClients =
    rootRegistry
    && rootRegistry.backends
    && rootRegistry.backends.packagedClients
    && rootRegistry.backends.packagedClients.publishedPackages
      ? rootRegistry.backends.packagedClients.publishedPackages
      : {};

  expectEqual('root manifest package.name', rootSurface.name, expected.root.name);
  expectEqual('root manifest package.version', rootSurface.version, expected.root.version);
  expectEqual('typescript manifest package.name', typescriptSurface.name, expected.typescript.name);
  expectEqual('typescript manifest package.version', typescriptSurface.version, expected.typescript.version);
  expectEqual('python manifest package.name', pythonSurface.name, expected.python.name);
  expectEqual('python manifest package.version', pythonSurface.version, expected.python.version);
  expectEqual('contract registry packaged TypeScript name', packagedClients.typescript && packagedClients.typescript.name, expected.typescript.name);
  expectEqual('contract registry packaged TypeScript version', packagedClients.typescript && packagedClients.typescript.version, expected.typescript.version);
  expectEqual('contract registry packaged Python name', packagedClients.python && packagedClients.python.name, expected.python.name);
  expectEqual('contract registry packaged Python version', packagedClients.python && packagedClients.python.version, expected.python.version);
  expectDeepEqual(
    'root manifest published TypeScript surface',
    typescriptSurface,
    packagedClients.typescript || {},
  );
  expectDeepEqual(
    'root manifest published Python surface',
    pythonSurface,
    packagedClients.python || {},
  );
  expectDeepEqual(
    'root generated package metadata',
    rootGeneratedPackage,
    {
      main: './index.js',
      type: 'commonjs',
      types: './index.d.ts',
    },
  );
  expectDeepEqual('root manifest registryDigest', rootManifest.registryDigest || {}, rootRegistry.registryDigest || {});
  expectDeepEqual('root manifest package metadata', rootManifest.package || {}, rootSurface);
}

function parseArgs(argv) {
  const args = new Set(argv);
  const supportedArgs = new Set(['--check']);
  for (const arg of args) {
    if (!supportedArgs.has(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return {
    check: args.has('--check'),
  };
}

function ensureOutputDir() {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

function removeLegacyArtifacts() {
  for (const file of LEGACY_GENERATED_FILES) {
    try {
      fs.unlinkSync(file.absolutePath);
      process.stdout.write(`Removed ${file.relativePath}\n`);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

function writeArtifacts(files) {
  ensureOutputDir();
  removeLegacyArtifacts();
  for (const file of files) {
    fs.mkdirSync(path.dirname(file.absolutePath), { recursive: true });
    fs.writeFileSync(file.absolutePath, file.content, 'utf8');
    process.stdout.write(`Wrote ${file.relativePath}\n`);
  }
}

function checkArtifacts(files) {
  const staleFiles = [];
  for (const file of files) {
    let currentContent = null;
    try {
      currentContent = fs.readFileSync(file.absolutePath, 'utf8');
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        throw error;
      }
    }
    if (currentContent !== file.content) {
      staleFiles.push(file.relativePath);
    }
  }

  if (staleFiles.length) {
    process.stderr.write('Generated SDK artifacts are stale or missing:\n');
    for (const staleFile of staleFiles) {
      process.stderr.write(`- ${staleFile}\n`);
    }
    process.stderr.write(`Refresh with: ${REFRESH_SDK_COMMAND}\n`);
    process.stderr.write(`Verify with: ${VERIFY_SDK_COMMAND}\n`);
    process.exitCode = 1;
    return;
  }

  const legacyArtifactsPresent = LEGACY_GENERATED_FILES.filter((file) => fs.existsSync(file.absolutePath));
  if (legacyArtifactsPresent.length) {
    process.stderr.write('Legacy generated SDK artifacts must be removed:\n');
    for (const legacyFile of legacyArtifactsPresent) {
      process.stderr.write(`- ${legacyFile.relativePath}\n`);
    }
    process.stderr.write(`Refresh with: ${REFRESH_SDK_COMMAND}\n`);
    process.stderr.write(`Verify with: ${VERIFY_SDK_COMMAND}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write('Generated SDK artifacts are up to date.\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const rootPackage = require('../package.json');
  const typescriptPackage = readJsonFile(
    path.resolve(__dirname, '..', 'sdk', 'typescript', 'package.json'),
  );
  const pythonPackage = readPythonPackageMetadata(
    path.resolve(__dirname, '..', 'sdk', 'python', 'pyproject.toml'),
  );
  const files = buildGeneratedArtifactFiles({
    packageVersion: rootPackage.version,
    typescriptPackageVersion: typescriptPackage.version,
    pythonPackageVersion: pythonPackage.version,
  });
  validateGeneratedSurfaceMetadata(files, {
    root: {
      name: rootPackage.name,
      version: rootPackage.version,
    },
    typescript: {
      name: typescriptPackage.name,
      version: typescriptPackage.version,
    },
    python: pythonPackage,
  });

  if (options.check) {
    checkArtifacts(files);
    return;
  }

  writeArtifacts(files);
}

main();
