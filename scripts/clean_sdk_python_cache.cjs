#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SDK_PYTHON_DIR = path.join(ROOT, 'sdk', 'python');
const SDK_PYTHON_BUILD_DIR = path.join(SDK_PYTHON_DIR, 'build');

function removePythonCacheEntries(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__pycache__') {
        fs.rmSync(absolutePath, { recursive: true, force: true });
        continue;
      }
      removePythonCacheEntries(absolutePath);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.pyc')) {
      fs.rmSync(absolutePath, { force: true });
    }
  }
}

removePythonCacheEntries(SDK_PYTHON_DIR);
fs.rmSync(SDK_PYTHON_BUILD_DIR, { recursive: true, force: true });

for (const entry of fs.readdirSync(SDK_PYTHON_DIR, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name.endsWith('.egg-info')) {
    fs.rmSync(path.join(SDK_PYTHON_DIR, entry.name), { recursive: true, force: true });
  }
}
