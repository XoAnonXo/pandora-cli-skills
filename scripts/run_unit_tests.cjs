#!/usr/bin/env node

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

function listTrackedUnitTests() {
  const trackedRoots = ['tests/unit', 'sdk/typescript/test'];
  const output = execFileSync('git', ['ls-files', ...trackedRoots], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.test.cjs'))
    .sort();
}

const trackedTests = listTrackedUnitTests();
const extraTests = process.argv.slice(2)
  .map((filePath) => String(filePath || '').trim())
  .filter(Boolean)
  .filter((filePath) => fs.existsSync(path.join(rootDir, filePath)));
const discoveredTests = trackedTests;
const testFiles = Array.from(
  new Set(discoveredTests.concat(extraTests)),
).sort();

if (testFiles.length === 0) {
  console.error('No tracked unit tests found. test:unit requires git-tracked test inventory.');
  process.exit(1);
}

// The unit suite shares process-wide globals and temp fixtures in several legacy files.
// Run serially so CI and local verification stay deterministic.
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...testFiles], {
  cwd: rootDir,
  stdio: 'inherit',
});

process.exit(result.status === null ? 1 : result.status);
