const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function createTempDir(prefix = 'pandora-sdk-consumer-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  const spawnOptions = {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    timeout: options.timeoutMs || 180_000,
  };

  if (typeof options.shell === 'boolean') {
    spawnOptions.shell = options.shell;
  } else if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(String(command || ''))) {
    spawnOptions.shell = true;
  }

  if (process.platform !== 'win32') {
    spawnOptions.killSignal = 'SIGKILL';
  }

  const result = spawnSync(command, args, spawnOptions);

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: `${result.stdout || ''}${result.stderr || ''}`,
    error: result.error,
  };
}

function ensureExitCode(result, expected, label) {
  if (result.error) {
    throw result.error;
  }
  assert.equal(
    result.status,
    expected,
    `${label} exited with ${result.status}, expected ${expected}.\nOutput:\n${result.output}`,
  );
}

function parseJsonStdout(result, label) {
  const text = String(result.stdout || '').trim();
  assert.notEqual(text, '', `${label} returned empty stdout.`);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON.\nStdout:\n${text}\nError: ${error.message}`);
  }
}

function getPackedTarballName(result, label) {
  const tarballName = String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  assert.ok(tarballName, `${label} did not print a tarball name.\nOutput:\n${result.output}`);
  return tarballName;
}

module.exports = {
  createTempDir,
  removeDir,
  run,
  ensureExitCode,
  parseJsonStdout,
  getPackedTarballName,
};
