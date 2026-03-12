#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname);
const REPO_ROOT = path.resolve(ROOT, '..', '..', '..');
const DEFAULT_OUT_DIR = path.resolve(REPO_ROOT, 'analytics', 'dune', 'mega-ipfs');
const SERVER_ENTRY = path.resolve(ROOT, 'server.cjs');
const STATIC_FILES = ['index.html', 'app.js', 'styles.css'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = { outDir: DEFAULT_OUT_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out' && argv[i + 1]) {
      args.outDir = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    }
  }
  return args;
}

async function waitForServer(baseUrl, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/panels`, { cache: 'no-store' });
      if (res.ok) return;
      lastError = new Error(`Server responded with HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(300);
  }
  throw lastError || new Error('Timed out waiting for analytics server startup');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyStaticFiles(outDir) {
  for (const fileName of STATIC_FILES) {
    const src = path.resolve(ROOT, fileName);
    const dst = path.resolve(outDir, fileName);
    fs.copyFileSync(src, dst);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = String(process.env.PANDORA_EXPORT_PORT || 18787);
  const host = '127.0.0.1';
  const baseUrl = `http://${host}:${port}`;

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: port,
      HOST: host,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  try {
    await waitForServer(baseUrl);
    const response = await fetch(`${baseUrl}/api/analytics`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to fetch /api/analytics: HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.sections)) {
      throw new Error('Invalid analytics payload shape');
    }

    ensureDir(args.outDir);
    ensureDir(path.resolve(args.outDir, 'data'));
    copyStaticFiles(args.outDir);
    fs.writeFileSync(
      path.resolve(args.outDir, 'data', 'analytics.json'),
      `${JSON.stringify(payload, null, 2)}\n`,
      'utf8',
    );

    process.stdout.write(`Static analytics exported to ${args.outDir}\n`);
  } finally {
    child.kill('SIGTERM');
    await sleep(200);
    if (!child.killed) {
      child.kill('SIGKILL');
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exit(1);
});
