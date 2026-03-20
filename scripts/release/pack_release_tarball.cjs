#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const PACKAGE_PATH = path.join(ROOT_DIR, 'package.json');
const DEFAULT_DESTINATION = path.join(ROOT_DIR, 'dist', 'release', 'npm');
const NPM_COMMAND = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sanitizePackageName(name) {
  return String(name || '')
    .trim()
    .replace(/^@/, '')
    .replace(/[\\/]/g, '-');
}

function expectedTarballName(pkg = readJson(PACKAGE_PATH)) {
  return `${sanitizePackageName(pkg.name)}-${pkg.version}.tgz`;
}

function parseArgs(argv) {
  const options = {
    destination: DEFAULT_DESTINATION,
    dryRun: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (token === '--json') {
      options.json = true;
      continue;
    }
    if (token === '--pack-destination') {
      index += 1;
      if (index >= argv.length) {
        throw new Error('--pack-destination requires a value');
      }
      options.destination = path.resolve(ROOT_DIR, argv[index]);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

function extractPackJson(stdoutText) {
  const text = String(stdoutText || '');
  const match = text.match(/(\[\s*\{[\s\S]*\]\s*)$/);
  if (!match) {
    throw new Error('npm pack --json did not emit a parseable JSON payload');
  }
  return match[1];
}

function runNpmPack(options = {}) {
  const destination = path.resolve(ROOT_DIR, options.destination || DEFAULT_DESTINATION);
  fs.mkdirSync(destination, { recursive: true });

  const expectedPath = path.join(destination, expectedTarballName());
  if (fs.existsSync(expectedPath)) {
    fs.rmSync(expectedPath, { force: true });
  }

  const args = ['pack', '--json', '--pack-destination', destination];
  if (options.dryRun) {
    args.push('--dry-run');
  }

  const result = spawnSync(NPM_COMMAND, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    env: process.env,
    shell: process.platform === 'win32',
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 16,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`npm pack failed with status ${result.status}\n${[result.stdout, result.stderr].filter(Boolean).join('\n')}`);
  }

  const parsed = JSON.parse(extractPackJson(result.stdout));
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!entry || typeof entry.filename !== 'string') {
    throw new Error('npm pack --json did not return a tarball filename');
  }
  entry.path = path.join(destination, entry.filename);
  return entry;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packed = runNpmPack(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(packed, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${packed.path}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_DESTINATION,
  extractPackJson,
  expectedTarballName,
  parseArgs,
  runNpmPack,
  sanitizePackageName,
};
