#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const {
  buildGeneratedArtifactFiles,
  GENERATED_DIR,
  LEGACY_GENERATED_FILES,
} = require('./lib/agent_contract_sdk_export.cjs');

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readPythonPackageVersion(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const match = text.match(/^\s*version\s*=\s*"([^"\n]+)"\s*$/m);
  if (!match) {
    throw new Error(`Could not determine Python package version from ${path.relative(process.cwd(), filePath)}`);
  }
  return match[1];
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
    process.exitCode = 1;
    return;
  }

  const legacyArtifactsPresent = LEGACY_GENERATED_FILES.filter((file) => fs.existsSync(file.absolutePath));
  if (legacyArtifactsPresent.length) {
    process.stderr.write('Legacy generated SDK artifacts must be removed:\n');
    for (const legacyFile of legacyArtifactsPresent) {
      process.stderr.write(`- ${legacyFile.relativePath}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write('Generated SDK artifacts are up to date.\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packageVersion = require('../package.json').version;
  const typescriptPackageVersion = readJsonFile(
    path.resolve(__dirname, '..', 'sdk', 'typescript', 'package.json'),
  ).version;
  const pythonPackageVersion = readPythonPackageVersion(
    path.resolve(__dirname, '..', 'sdk', 'python', 'pyproject.toml'),
  );
  const files = buildGeneratedArtifactFiles({
    packageVersion,
    typescriptPackageVersion,
    pythonPackageVersion,
  });

  if (options.check) {
    checkArtifacts(files);
    return;
  }

  writeArtifacts(files);
}

main();
