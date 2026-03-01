#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const NPM_CMD = 'npm';
const NODE_CMD = process.execPath;

function run(command, args, options = {}) {
  const spawnOptions = {
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    timeout: options.timeoutMs || 60_000,
  };

  if (typeof options.shell === 'boolean') {
    spawnOptions.shell = options.shell;
  }

  if (process.platform !== 'win32') {
    spawnOptions.killSignal = 'SIGKILL';
  }

  const result = spawnSync(command, args, spawnOptions);
  const output = `${result.stdout || ''}${result.stderr || ''}`;

  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      throw new Error(`${command} ${args.join(' ')} timed out after ${options.timeoutMs || 60_000}ms`);
    }
    throw result.error;
  }

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output,
  };
}

function ensureExitCode(result, expected, label) {
  if (result.status !== expected) {
    throw new Error(`${label} exited with ${result.status}, expected ${expected}.\nOutput:\n${result.output}`);
  }
}

function parseJsonStdout(result, label) {
  const text = String(result.stdout || '').trim();
  if (!text) {
    throw new Error(`${label} returned empty stdout.`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON.\nStdout:\n${text}\nError: ${error.message}`);
  }
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function moveFileSafe(from, to) {
  try {
    fs.renameSync(from, to);
  } catch (error) {
    if (error && error.code !== 'EXDEV') {
      throw error;
    }
    fs.copyFileSync(from, to);
    fs.unlinkSync(from);
  }
}

function runNpm(args, options = {}) {
  return run(NPM_CMD, args, {
    ...options,
    shell: process.platform === 'win32',
  });
}

function runPandora(installedCli, args, options = {}) {
  return run(NODE_CMD, [installedCli, ...args], options);
}

function getPackResult(packDir) {
  if (process.platform === 'win32') {
    const fallback = runNpm(['pack', '--silent']);
    if (fallback.status !== 0) return fallback;

    const tarball = fallback.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    if (!tarball) throw new Error('Could not determine tarball name from npm pack output.');

    moveFileSafe(path.join(ROOT, tarball), path.join(packDir, tarball));
    fallback.stdout = `${tarball}\n`;
    return fallback;
  }

  const withDestination = runNpm(['pack', '--silent', '--pack-destination', packDir]);
  if (withDestination.status === 0) return withDestination;
  if (!/pack-destination/.test(withDestination.output)) return withDestination;

  const fallback = runNpm(['pack', '--silent']);
  if (fallback.status !== 0) return fallback;

  const tarball = fallback.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (!tarball) throw new Error('Could not determine tarball name from npm pack output.');

  moveFileSafe(path.join(ROOT, tarball), path.join(packDir, tarball));
  fallback.stdout = `${tarball}\n`;
  return fallback;
}

function validateVersionPayload(payload) {
  ensure(payload && payload.ok === true, 'version payload must set ok=true.');
  ensure(payload.command === 'version', `version payload command mismatch: ${payload.command}`);
  ensure(payload.data && typeof payload.data.version === 'string', 'version payload missing data.version.');
  ensure(/^\d+\.\d+\.\d+/.test(payload.data.version), `version is not semver-like: ${payload.data.version}`);
}

function validateHelpPayload(payload) {
  ensure(payload && payload.ok === true, 'help payload must set ok=true.');
  ensure(payload.command === 'help', `help payload command mismatch: ${payload.command}`);
  ensure(payload.data && Array.isArray(payload.data.usage), 'help payload missing usage array.');
  ensure(payload.data.usage.some((line) => String(line).includes('mirror')), 'help payload usage is missing mirror command listing.');
}

function validateLpExplainNeutrality(payload) {
  ensure(payload && payload.ok === true, 'lp-explain payload must set ok=true.');
  ensure(payload.command === 'mirror.lp-explain', `lp-explain payload command mismatch: ${payload.command}`);
  const inventory = payload.data && payload.data.flow && payload.data.flow.totalLpInventory;
  ensure(inventory && typeof inventory === 'object', 'lp-explain payload missing flow.totalLpInventory.');
  ensure(inventory.neutralCompleteSets === true, 'lp-explain neutrality invariant failed: neutralCompleteSets=false.');
  ensure(Number(inventory.totalYesUsdc) === Number(inventory.totalNoUsdc), 'lp-explain invariant failed: totalYesUsdc != totalNoUsdc.');
  ensure(Number(inventory.deltaUsdc) === 0, 'lp-explain invariant failed: deltaUsdc != 0.');
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-consumer-json-smoke-'));
  const packDir = path.join(tempRoot, 'pack');
  const appDir = path.join(tempRoot, 'app');
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(appDir, { recursive: true });

  try {
    const pack = getPackResult(packDir);
    ensureExitCode(pack, 0, 'npm pack');

    const tarballName = pack.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    if (!tarballName) {
      throw new Error(`Unable to read tarball name from npm pack output:\n${pack.output}`);
    }

    const tarballPath = path.join(packDir, tarballName);
    ensure(fs.existsSync(tarballPath), `Tarball not found at ${tarballPath}`);

    ensureExitCode(runNpm(['init', '-y'], { cwd: appDir, timeoutMs: 120_000 }), 0, 'npm init');
    ensureExitCode(runNpm(['install', '--silent', tarballPath], { cwd: appDir, timeoutMs: 240_000 }), 0, 'npm install tarball');

    const installedCli = path.join(appDir, 'node_modules', 'pandora-cli-skills', 'cli', 'pandora.cjs');
    ensure(fs.existsSync(installedCli), `Installed CLI not found at ${installedCli}`);

    const versionResult = runPandora(installedCli, ['--output', 'json', '--version'], { cwd: appDir });
    ensureExitCode(versionResult, 0, 'pandora --output json --version');
    ensure(String(versionResult.stderr || '').trim() === '', 'version JSON command should not write to stderr.');
    validateVersionPayload(parseJsonStdout(versionResult, 'pandora --output json --version'));

    const helpResult = runPandora(installedCli, ['--output', 'json', 'help'], { cwd: appDir });
    ensureExitCode(helpResult, 0, 'pandora --output json help');
    ensure(String(helpResult.stderr || '').trim() === '', 'help JSON command should not write to stderr.');
    validateHelpPayload(parseJsonStdout(helpResult, 'pandora --output json help'));

    const lpExplainResult = runPandora(
      installedCli,
      ['--output', 'json', 'mirror', 'lp-explain', '--liquidity-usdc', '10000', '--source-yes-pct', '58'],
      { cwd: appDir },
    );
    ensureExitCode(lpExplainResult, 0, 'pandora --output json mirror lp-explain');
    ensure(String(lpExplainResult.stderr || '').trim() === '', 'mirror lp-explain JSON command should not write to stderr.');
    validateLpExplainNeutrality(parseJsonStdout(lpExplainResult, 'pandora --output json mirror lp-explain'));

    console.log('Consumer JSON smoke test passed.');
    console.log(`Tarball: ${tarballPath}`);
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (error) {
      const transientWindowsCleanupError =
        process.platform === 'win32' && ['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error && error.code);
      if (!transientWindowsCleanupError) {
        throw error;
      }
    }
  }
}

main();
