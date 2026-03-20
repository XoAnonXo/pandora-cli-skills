#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { BACKUP_PATH } = require('../prepare_publish_manifest.cjs');
const { DEFAULT_DESTINATION, expectedTarballName } = require('./pack_release_tarball.cjs');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const PACKAGE_PATH = path.join(ROOT_DIR, 'package.json');
const NPM_COMMAND = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseArgs(argv) {
  const options = {
    access: 'public',
    dryRun: false,
    provenance: true,
    registry: null,
    tag: null,
    tarball: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (token === '--no-provenance') {
      options.provenance = false;
      continue;
    }
    if (token === '--access' || token === '--registry' || token === '--tag' || token === '--tarball' || token === '--otp') {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`${token} requires a value`);
      }
      const key = token.slice(2);
      options[key] = argv[index];
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

function resolveTarballPath(options = {}, pkg = readJson(PACKAGE_PATH)) {
  if (options.tarball) {
    return path.resolve(ROOT_DIR, options.tarball);
  }
  return path.join(DEFAULT_DESTINATION, expectedTarballName(pkg));
}

function buildPublishArgs(options) {
  const args = ['publish', options.tarballPath, '--access', options.access || 'public'];
  if (options.provenance) {
    args.push('--provenance');
  }
  if (options.tag) {
    args.push('--tag', options.tag);
  }
  if (options.registry) {
    args.push('--registry', options.registry);
  }
  if (options.otp) {
    args.push('--otp', options.otp);
  }
  if (options.dryRun) {
    args.push('--dry-run');
  }
  return args;
}

function ensureReadyToPublish(tarballPath) {
  if (!fs.existsSync(tarballPath)) {
    throw new Error(`Release tarball not found at ${tarballPath}. Run \`npm run release:pack\` first or pass --tarball.`);
  }
  if (fs.existsSync(BACKUP_PATH)) {
    throw new Error('Publish manifest backup still exists. The source manifest was not restored after packing; run `npm run restore:publish-manifest` before publishing.');
  }
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
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
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}\n${[result.stdout, result.stderr].filter(Boolean).join('\n')}`);
  }

  return result;
}

function publishReleaseTarball(options = {}) {
  const pkg = readJson(PACKAGE_PATH);
  const tarballPath = resolveTarballPath(options, pkg);
  ensureReadyToPublish(tarballPath);
  if (!options.dryRun) {
    runCommand(NPM_COMMAND, buildPublishArgs({
      ...options,
      tarballPath,
    }));
  }
  return tarballPath;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const tarballPath = publishReleaseTarball(options);
  process.stdout.write(`${tarballPath}\n`);
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
  buildPublishArgs,
  ensureReadyToPublish,
  parseArgs,
  publishReleaseTarball,
  resolveTarballPath,
};
