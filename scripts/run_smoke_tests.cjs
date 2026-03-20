#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { runNpmPack } = require('./release/pack_release_tarball.cjs');

const ROOT_DIR = path.resolve(__dirname, '..');
const NODE_CMD = process.execPath;

function runNodeScript(scriptPath, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(NODE_CMD, [scriptPath], {
      cwd: ROOT_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const reason = signal
        ? `${path.basename(scriptPath)} terminated with signal ${signal}`
        : `${path.basename(scriptPath)} failed with status ${code}`;
      reject(new Error(`${reason}\n${[stdout, stderr].filter(Boolean).join('\n')}`));
    });
  });
}

async function main() {
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

  const smokeScripts = [
    path.join(ROOT_DIR, 'tests', 'smoke', 'pack-install-smoke.cjs'),
    path.join(ROOT_DIR, 'tests', 'smoke', 'consumer-json-smoke.cjs'),
  ];
  await Promise.all(smokeScripts.map((scriptPath) => runNodeScript(scriptPath, env)));
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
