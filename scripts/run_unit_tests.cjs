#!/usr/bin/env node

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

function listTrackedUnitTests() {
  try {
    const output = execFileSync('git', ['ls-files', 'tests/unit'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.endsWith('.test.cjs'))
      .sort();
  } catch {
    return [];
  }
}

function listFilesystemUnitTests() {
  const unitDir = path.join(rootDir, 'tests', 'unit');
  return fs.readdirSync(unitDir)
    .filter((name) => name.endsWith('.test.cjs'))
    .map((name) => path.join('tests', 'unit', name))
    .sort();
}

const trackedTests = listTrackedUnitTests();
const testFiles = trackedTests.length ? trackedTests : listFilesystemUnitTests();
const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: rootDir,
  stdio: 'inherit',
});

process.exit(result.status === null ? 1 : result.status);
