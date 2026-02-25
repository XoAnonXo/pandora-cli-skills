#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const REQUIRED_ENV_KEYS = ['CHAIN_ID', 'RPC_URL', 'PRIVATE_KEY', 'ORACLE', 'FACTORY', 'USDC', 'DEPLOYER_PRIVATE_KEY'];
const NPM_CMD = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, options = {}) {
  const spawnOptions = {
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    timeout: options.timeoutMs || 60_000,
  };

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
    throw new Error(
      `${label} exited with ${result.status}, expected ${expected}.\nOutput:\n${result.output}`,
    );
  }
}

function ensureOutputContains(result, regex, label) {
  if (!regex.test(result.output)) {
    throw new Error(`${label} output mismatch. Expected ${regex}.\nOutput:\n${result.output}`);
  }
}

function cleanEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of REQUIRED_ENV_KEYS) {
    delete env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    env[key] = value;
  }
  return env;
}

function getPackResult(packDir) {
  const withDestination = run(NPM_CMD, ['pack', '--silent', '--pack-destination', packDir]);
  if (withDestination.status === 0) {
    return withDestination;
  }

  if (!/pack-destination/.test(withDestination.output)) {
    return withDestination;
  }

  const fallback = run(NPM_CMD, ['pack', '--silent']);
  if (fallback.status !== 0) {
    return fallback;
  }

  const tarball = fallback.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  if (!tarball) {
    throw new Error('Could not determine tarball name from npm pack output.');
  }

  const from = path.join(ROOT, tarball);
  const to = path.join(packDir, tarball);
  fs.renameSync(from, to);
  fallback.stdout = `${tarball}\n`;
  return fallback;
}

function main() {
  const FIXED_FUTURE_TIMESTAMP = '1893456000'; // 2030-01-01T00:00:00Z
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-pack-smoke-'));
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
    if (!fs.existsSync(tarballPath)) {
      throw new Error(`Tarball not found at ${tarballPath}`);
    }

    ensureExitCode(run(NPM_CMD, ['init', '-y'], { cwd: appDir }), 0, 'npm init');
    ensureExitCode(run(NPM_CMD, ['install', '--silent', tarballPath], { cwd: appDir }), 0, 'npm install tarball');

    const installedCli = path.join(appDir, 'node_modules', 'pandora-cli-skills', 'cli', 'pandora.cjs');
    if (!fs.existsSync(installedCli)) {
      throw new Error(`Installed CLI not found at ${installedCli}`);
    }

    const help = run(NPM_CMD, ['exec', '--', 'pandora', 'help'], { cwd: appDir, env: cleanEnv() });
    ensureExitCode(help, 0, 'pandora help');
    ensureOutputContains(help, /Prediction market CLI/, 'pandora help');

    const exampleEnvPath = path.join(appDir, 'example.env');
    fs.writeFileSync(
      exampleEnvPath,
      [
        'CHAIN_ID=1',
        'RPC_URL=https://rpc.example.org',
        'PRIVATE_KEY=0xyour_private_key',
        'ORACLE=0xYourOracleAddress',
        'FACTORY=0xYourFactoryAddress',
        'USDC=0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      ].join('\n'),
    );

    const initEnvPath = path.join(appDir, '.env');
    const initEnv = run(NPM_CMD, ['exec', '--', 'pandora', 'init-env', '--example', exampleEnvPath, '--dotenv-path', initEnvPath], {
      cwd: appDir,
      env: cleanEnv(),
    });
    ensureExitCode(initEnv, 0, 'pandora init-env');
    ensureOutputContains(initEnv, /Wrote env file:/, 'pandora init-env');

    const doctor = run(NPM_CMD, ['exec', '--', 'pandora', 'doctor', '--dotenv-path', initEnvPath], {
      cwd: appDir,
      env: cleanEnv(),
    });
    ensureExitCode(doctor, 1, 'pandora doctor');
    ensureOutputContains(doctor, /Doctor checks failed\./, 'pandora doctor');

    const launchArgs = [
      'exec',
      '--',
      'pandora',
      'launch',
      '--skip-dotenv',
      '--question',
      'Will smoke test preflight run?',
      '--rules',
      'Resolves Yes if true. Resolves No if false. If canceled/postponed/abandoned/unresolved, resolve No.',
      '--sources',
      'https://example.com/a',
      'https://example.com/b',
      '--target-timestamp',
      FIXED_FUTURE_TIMESTAMP,
      '--liquidity',
      '10',
      '--dry-run',
    ];

    const dryRunPreflight = run(NPM_CMD, launchArgs, {
      cwd: appDir,
      env: cleanEnv({ CHAIN_ID: '999', PRIVATE_KEY: `0x${'1'.repeat(64)}` }),
    });

    ensureExitCode(dryRunPreflight, 1, 'pandora launch --dry-run preflight');
    ensureOutputContains(
      dryRunPreflight,
      /Unsupported CHAIN_ID=999\. Supported: 1 or 146/,
      'pandora launch --dry-run preflight',
    );

    const cloneArgs = [
      'exec',
      '--',
      'pandora',
      'clone-bet',
      '--skip-dotenv',
      '--question',
      'Will clone smoke preflight run?',
      '--rules',
      'Resolves Yes if true. Resolves No if false. If canceled/postponed/abandoned/unresolved, resolve No.',
      '--sources',
      'https://example.com/a',
      'https://example.com/b',
      '--target-timestamp',
      FIXED_FUTURE_TIMESTAMP,
      '--liquidity',
      '10',
      '--dry-run',
    ];

    const cloneDryRun = run(NPM_CMD, cloneArgs, {
      cwd: appDir,
      env: cleanEnv({ CHAIN_ID: '999', PRIVATE_KEY: `0x${'1'.repeat(64)}` }),
    });
    ensureExitCode(cloneDryRun, 1, 'pandora clone-bet --dry-run preflight');
    ensureOutputContains(cloneDryRun, /Unsupported CHAIN_ID, use 1 or 146/, 'pandora clone-bet --dry-run preflight');

    console.log('Pack/install smoke test passed.');
    console.log(`Tarball: ${tarballPath}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
