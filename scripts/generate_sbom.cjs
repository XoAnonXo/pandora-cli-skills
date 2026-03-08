#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const PACKAGE_PATH = path.join(ROOT_DIR, 'package.json');
const PACKAGE_LOCK_PATH = path.join(ROOT_DIR, 'package-lock.json');
const pkg = require(PACKAGE_PATH);
const PREPARE_PUBLISH_MANIFEST_PATH = path.join(ROOT_DIR, 'scripts', 'prepare_publish_manifest.cjs');

const VALID_FORMATS = new Set(['cyclonedx', 'spdx']);
const VALID_SBOM_TYPES = new Set(['application', 'framework', 'library']);
const VALID_OMIT_TYPES = new Set(['dev', 'optional', 'peer']);

function sanitizePackageName(name) {
  return String(name || '')
    .trim()
    .replace(/^@/, '')
    .replace(/[\\/]/g, '-');
}

function defaultOutputPath(format) {
  return path.join(
    ROOT_DIR,
    'dist',
    'release',
    `${sanitizePackageName(pkg.name)}-${pkg.version}.sbom.${format}.json`
  );
}

function parseArgs(argv) {
  const options = {
    check: false,
    format: 'cyclonedx',
    omit: ['dev'],
    output: null,
    packageLockOnly: true,
    sbomType: 'application',
    stdout: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--check') {
      options.check = true;
      continue;
    }

    if (arg === '--stdout') {
      options.stdout = true;
      continue;
    }

    if (arg === '--package-lock-only') {
      options.packageLockOnly = true;
      continue;
    }

    if (arg === '--no-package-lock-only') {
      options.packageLockOnly = false;
      continue;
    }

    if (arg === '--include-dev') {
      options.omit = options.omit.filter((entry) => entry !== 'dev');
      continue;
    }

    if (arg === '--format') {
      const value = argv[index + 1];
      if (!VALID_FORMATS.has(value)) {
        throw new Error(`Invalid --format value: ${value}`);
      }
      options.format = value;
      index += 1;
      continue;
    }

    if (arg === '--output') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--output requires a value');
      }
      options.output = path.resolve(ROOT_DIR, value);
      index += 1;
      continue;
    }

    if (arg === '--omit') {
      const value = argv[index + 1];
      if (!VALID_OMIT_TYPES.has(value)) {
        throw new Error(`Invalid --omit value: ${value}`);
      }
      if (!options.omit.includes(value)) {
        options.omit.push(value);
      }
      index += 1;
      continue;
    }

    if (arg === '--sbom-type') {
      const value = argv[index + 1];
      if (!VALID_SBOM_TYPES.has(value)) {
        throw new Error(`Invalid --sbom-type value: ${value}`);
      }
      options.sbomType = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.output) {
    options.output = defaultOutputPath(options.format);
  }

  if (options.check && options.stdout) {
    throw new Error('--check cannot be combined with --stdout');
  }

  return options;
}

function ensurePrerequisites() {
  if (!fs.existsSync(PACKAGE_LOCK_PATH)) {
    throw new Error('package-lock.json is required for reproducible SBOM generation');
  }
}

function resolveSbomWorkingRoot() {
  if (!fs.existsSync(PREPARE_PUBLISH_MANIFEST_PATH)) {
    return {
      cwd: ROOT_DIR,
      cleanup() {},
    };
  }

  const helper = require(PREPARE_PUBLISH_MANIFEST_PATH);
  if (!helper || typeof helper.buildPublishedPackageJson !== 'function') {
    return {
      cwd: ROOT_DIR,
      cleanup() {},
    };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-sbom-'));
  const tempPackagePath = path.join(tempDir, 'package.json');
  const tempPackageLockPath = path.join(tempDir, 'package-lock.json');
  fs.writeFileSync(
    tempPackagePath,
    `${JSON.stringify(helper.buildPublishedPackageJson(pkg), null, 2)}\n`,
    'utf8',
  );
  fs.copyFileSync(PACKAGE_LOCK_PATH, tempPackageLockPath);
  return {
    cwd: tempDir,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function buildNpmSbomArgs(options) {
  const args = [
    'sbom',
    '--sbom-format',
    options.format,
    '--sbom-type',
    options.sbomType,
  ];

  if (options.packageLockOnly) {
    args.push('--package-lock-only');
  }

  for (const omitType of options.omit) {
    args.push('--omit', omitType);
  }

  return args;
}

function resolveNpmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runNpmSbom(options, workingRoot) {
  const output = execFileSync(resolveNpmExecutable(), buildNpmSbomArgs(options), {
    cwd: workingRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_loglevel: process.env.npm_config_loglevel || 'error',
    },
    maxBuffer: 1024 * 1024 * 64,
  });

  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`npm sbom returned invalid JSON: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function findExternalReference(component, type) {
  if (!component || !Array.isArray(component.externalReferences)) {
    return null;
  }
  return component.externalReferences.find((entry) => entry && entry.type === type) || null;
}

function validateCycloneDx(bom) {
  const rootComponent = bom && bom.metadata ? bom.metadata.component : null;
  const expectedPurl = `pkg:npm/${pkg.name}@${pkg.version}`;
  const rootDependency = Array.isArray(bom.dependencies)
    ? bom.dependencies.find((entry) => entry && entry.ref === `${pkg.name}@${pkg.version}`)
    : null;

  assert(bom && bom.bomFormat === 'CycloneDX', 'Expected CycloneDX bomFormat');
  assert(Boolean(bom.specVersion), 'Expected CycloneDX specVersion');
  assert(rootComponent && rootComponent.type, 'Expected CycloneDX metadata.component');
  assert(rootComponent.version === pkg.version, `Expected root component version ${pkg.version}`);
  assert(rootComponent.purl === expectedPurl, `Expected root component purl ${expectedPurl}`);
  assert(Boolean(findExternalReference(rootComponent, 'vcs')), 'Expected CycloneDX vcs external reference');
  assert(Boolean(findExternalReference(rootComponent, 'website')), 'Expected CycloneDX website external reference');
  assert(Boolean(findExternalReference(rootComponent, 'issue-tracker')), 'Expected CycloneDX issue-tracker external reference');
  assert(Array.isArray(bom.components) && bom.components.length > 0, 'Expected CycloneDX components');
  assert(rootDependency && Array.isArray(rootDependency.dependsOn), 'Expected CycloneDX root dependency graph');
}

function validateSpdx(bom) {
  const packages = Array.isArray(bom.packages) ? bom.packages : [];
  const rootPackage = packages[0];
  const expectedPurl = `pkg:npm/${pkg.name}@${pkg.version}`;
  const externalRefs = Array.isArray(rootPackage && rootPackage.externalRefs) ? rootPackage.externalRefs : [];
  const purlRef = externalRefs.find((entry) => entry && entry.referenceType === 'purl');

  assert(bom && typeof bom.spdxVersion === 'string' && bom.spdxVersion.startsWith('SPDX-'), 'Expected SPDX version header');
  assert(Array.isArray(bom.documentDescribes) && bom.documentDescribes.length > 0, 'Expected SPDX documentDescribes');
  assert(rootPackage && rootPackage.name === pkg.name, `Expected SPDX root package name ${pkg.name}`);
  assert(rootPackage.versionInfo === pkg.version, `Expected SPDX root package version ${pkg.version}`);
  assert(Boolean(rootPackage.primaryPackagePurpose), 'Expected SPDX primaryPackagePurpose');
  assert(Boolean(rootPackage.homepage), 'Expected SPDX homepage');
  assert(purlRef && purlRef.referenceLocator === expectedPurl, `Expected SPDX root package purl ${expectedPurl}`);
  assert(packages.length > 0, 'Expected SPDX packages');
  assert(Array.isArray(bom.relationships) && bom.relationships.length > 0, 'Expected SPDX relationships');
}

function validateBom(bom, options) {
  if (options.format === 'cyclonedx') {
    validateCycloneDx(bom);
    return;
  }
  validateSpdx(bom);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeBomForComparison(bom, options) {
  const normalized = cloneJson(bom);

  if (options.format === 'cyclonedx') {
    delete normalized.serialNumber;
    if (normalized.metadata && normalized.metadata.timestamp) {
      delete normalized.metadata.timestamp;
    }
  } else {
    delete normalized.documentNamespace;
    if (normalized.creationInfo && normalized.creationInfo.created) {
      delete normalized.creationInfo.created;
    }
  }

  return normalized;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function renderBom(bom) {
  return `${JSON.stringify(bom, null, 2)}\n`;
}

function ensureOutputDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readExistingBom(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw new Error(`Failed to read existing SBOM at ${path.relative(ROOT_DIR, filePath)}: ${error.message}`);
  }
}

function summarizeBom(bom, options, outputPath) {
  const componentCount = options.format === 'cyclonedx'
    ? (Array.isArray(bom.components) ? bom.components.length : 0)
    : (Array.isArray(bom.packages) ? bom.packages.length : 0);
  const dependencyCount = options.format === 'cyclonedx'
    ? (Array.isArray(bom.dependencies) ? bom.dependencies.length : 0)
    : (Array.isArray(bom.relationships) ? bom.relationships.length : 0);

  return {
    format: options.format,
    output: path.relative(ROOT_DIR, outputPath),
    componentCount,
    dependencyCount,
  };
}

function writeBom(filePath, bom, options) {
  ensureOutputDir(filePath);
  fs.writeFileSync(filePath, renderBom(bom), 'utf8');
  const summary = summarizeBom(bom, options, filePath);
  process.stdout.write(`Wrote ${summary.output}\n`);
  process.stdout.write(
    `SBOM summary: format=${summary.format} components=${summary.componentCount} dependencies=${summary.dependencyCount}\n`
  );
}

function checkBom(filePath, generatedBom, options) {
  const existingBom = readExistingBom(filePath);
  const relativePath = path.relative(ROOT_DIR, filePath);

  if (!existingBom) {
    throw new Error(`SBOM artifact is missing: ${relativePath}`);
  }

  validateBom(existingBom, options);

  const expected = stableStringify(normalizeBomForComparison(generatedBom, options));
  const actual = stableStringify(normalizeBomForComparison(existingBom, options));

  if (actual !== expected) {
    throw new Error(`SBOM artifact is stale: ${relativePath}`);
  }

  process.stdout.write(`SBOM artifact is up to date: ${relativePath}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  ensurePrerequisites();
  const runtime = resolveSbomWorkingRoot();
  try {
    const bom = runNpmSbom(options, runtime.cwd);
    validateBom(bom, options);

    if (options.stdout) {
      process.stdout.write(renderBom(bom));
      return;
    }

    if (options.check) {
      checkBom(options.output, bom, options);
      return;
    }

    writeBom(options.output, bom, options);
  } finally {
    runtime.cleanup();
  }
}

main();
