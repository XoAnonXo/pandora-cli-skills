#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runNpmPack } = require('./release/pack_release_tarball.cjs');

const ROOT_DIR = path.resolve(__dirname, '..');
const NODE_CMD = process.execPath;

function runNodeScript(scriptPath, env) {
  const result = spawnSync(NODE_CMD, [scriptPath], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    env,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 32,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${path.basename(scriptPath)} failed with status ${result.status}\n${[result.stdout, result.stderr].filter(Boolean).join('\n')}`);
  }
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-shared-smoke-'));
  const packDir = path.join(tempRoot, 'pack');
  fs.mkdirSync(packDir, { recursive: true });

  const packed = runNpmPack({ destination: packDir });
  const tarballPath = packed.path;
  if (!fs.existsSync(tarballPath)) {
    throw new Error(`Shared smoke tarball not found at ${tarballPath}`);
  }

  const env = {
    ...process.env,
    PANDORA_SMOKE_TARBALL: tarballPath,
  };

  runNodeScript(path.join(ROOT_DIR, 'tests', 'smoke', 'pack-install-smoke.cjs'), env);
  runNodeScript(path.join(ROOT_DIR, 'tests', 'smoke', 'consumer-json-smoke.cjs'), env);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
