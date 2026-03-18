const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI_PATH = path.join(REPO_ROOT, 'cli', 'pandora.cjs');
const DOCTOR_ENV_KEYS = ['CHAIN_ID', 'RPC_URL', 'PANDORA_PRIVATE_KEY', 'PRIVATE_KEY', 'ORACLE', 'FACTORY', 'USDC', 'DEPLOYER_PRIVATE_KEY'];

function createTempDir(prefix = 'pandora-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function withChildEnv(overrides = {}, unsetKeys = []) {
  const env = { ...process.env };
  for (const key of unsetKeys) {
    delete env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    env[key] = value;
  }
  return env;
}

function normalizePtyOutput(text) {
  return String(text || '')
    .replace(/^spawn [^\n]*\r?\n/, '')
    .replace(/^\^D/, '')
    .replace(/[\u0004\u0008\r]/g, '');
}

function tclQuote(text) {
  return `"${String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')}"`;
}

function escapeExpectRegex(text) {
  return String(text || '').replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function runCli(args, options = {}) {
  const captureDir = createTempDir('pandora-cli-capture-');
  const stdoutPath = path.join(captureDir, 'stdout.txt');
  const stderrPath = path.join(captureDir, 'stderr.txt');
  const stdoutFd = fs.openSync(stdoutPath, 'w');
  const stderrFd = fs.openSync(stderrPath, 'w');

  try {
    const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
      cwd: options.cwd || REPO_ROOT,
      env: withChildEnv(options.env, options.unsetEnvKeys),
      timeout: options.timeoutMs || 30_000,
      killSignal: 'SIGKILL',
      stdio: ['ignore', stdoutFd, stderrFd],
    });
    const stdout = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, 'utf8') : '';
    const stderr = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, 'utf8') : '';

    return {
      status: result.status,
      stdout,
      stderr,
      output: `${stdout}${stderr}`,
      error: result.error,
      timedOut: Boolean(result.error && result.error.code === 'ETIMEDOUT'),
    };
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
    removeDir(captureDir);
  }
}

function runCliAsync(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: options.cwd || REPO_ROOT,
      env: withChildEnv(options.env, options.unsetEnvKeys),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timeoutHit = false;
    const timeoutMs = options.timeoutMs || 30_000;

    const timeout = setTimeout(() => {
      timeoutHit = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        status: 1,
        stdout,
        stderr,
        output: `${stdout}${stderr}`,
        error,
        timedOut: false,
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({
        status: code === null ? 1 : code,
        signal,
        stdout,
        stderr,
        output: `${stdout}${stderr}`,
        error: undefined,
        timedOut: timeoutHit,
      });
    });
  });
}

function runCliWithStdin(args, options = {}) {
  const cliPath = options.cliPath || CLI_PATH;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: options.cwd || REPO_ROOT,
      env: withChildEnv(options.env, options.unsetEnvKeys),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timeoutHit = false;
    const timeoutMs = options.timeoutMs || 30_000;

    const timeout = setTimeout(() => {
      timeoutHit = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        status: 1,
        stdout,
        stderr,
        output: `${stdout}${stderr}`,
        error,
        timedOut: false,
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({
        status: code === null ? 1 : code,
        signal,
        stdout,
        stderr,
        output: `${stdout}${stderr}`,
        error: undefined,
        timedOut: timeoutHit,
      });
    });

    if (typeof options.stdin === 'string') {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
}

function runCliWithTty(args, options = {}) {
  if (process.platform === 'win32') {
    throw new Error('runCliWithTty is not supported on Windows.');
  }

  const cliPath = options.cliPath || CLI_PATH;
  const env = withChildEnv(options.env, options.unsetEnvKeys);
  env.EXPECT_NODE = process.execPath;
  env.EXPECT_CLI_PATH = cliPath;
  env.EXPECT_ARGC = String(args.length);
  args.forEach((arg, index) => {
    env[`EXPECT_ARG_${index}`] = String(arg);
  });

  const expectScript = [
    'set argc $env(EXPECT_ARGC)',
    'set cmd [list $env(EXPECT_NODE) $env(EXPECT_CLI_PATH)]',
    'for {set i 0} {$i < $argc} {incr i} {',
    '  lappend cmd $env(EXPECT_ARG_$i)',
    '}',
    'eval spawn -noecho $cmd',
    'match_max 100000',
  ];

  if (Array.isArray(options.steps) && options.steps.length) {
    for (const step of options.steps) {
      expectScript.push(`expect -exact ${tclQuote(step.expect)} { send -- ${tclQuote(`${step.send}\r`) } }`);
    }
    if (options.stopOnOutput) {
      expectScript.push(
        `expect -re ${tclQuote(escapeExpectRegex(options.stopOnOutput))} { catch { exec kill -TERM [exp_pid] }; exit 0 }`,
      );
    } else {
      expectScript.push('send -- "\\004"');
      expectScript.push('expect eof');
      expectScript.push('set waitResult [wait]');
      expectScript.push('exit [lindex $waitResult 3]');
      return buildSpawnSyncResult('expect', expectScript, env, options);
    }
  } else if (typeof options.stdin === 'string') {
    expectScript.push(`send -- ${tclQuote(options.stdin)}`);
    expectScript.push('send -- "\\004"');
  } else {
    expectScript.push('send -- "\\004"');
  }

  if (!options.stopOnOutput) {
    expectScript.push(
      'expect eof',
      'set waitResult [wait]',
      'exit [lindex $waitResult 3]',
    );
  }

  return buildSpawnSyncResult('expect', expectScript, env, options);
}

function buildSpawnSyncResult(command, expectScript, env, options) {
  const result = spawnSync('expect', ['-c', expectScript.join('\n')], {
    cwd: options.cwd || REPO_ROOT,
    env,
    timeout: options.timeoutMs || 30_000,
    encoding: 'utf8',
    killSignal: 'SIGKILL',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdout = normalizePtyOutput(result.stdout || '');
  const stderr = normalizePtyOutput(result.stderr || '');

  return {
    status: result.status,
    stdout,
    stderr,
    output: `${stdout}${stderr}`,
    error: result.error,
    timedOut: Boolean(result.error && result.error.code === 'ETIMEDOUT'),
  };
}

function startJsonHttpServer(handler) {
  return new Promise((resolve, reject) => {
    const requests = [];
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', async () => {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        let bodyJson = null;
        if (bodyText.trim()) {
          try {
            bodyJson = JSON.parse(bodyText);
          } catch {
            bodyJson = null;
          }
        }

        const requestRecord = {
          method: req.method,
          url: req.url,
          headers: req.headers,
          bodyText,
          bodyJson,
        };
        requests.push(requestRecord);

        try {
          const response = await handler(requestRecord);
          const status = response && response.status ? response.status : 200;
          const payload = response && response.body !== undefined ? response.body : {};
          const headers = response && response.headers ? response.headers : {};

          res.statusCode = status;
          res.setHeader('content-type', headers['content-type'] || 'application/json');
          for (const [key, value] of Object.entries(headers)) {
            if (key.toLowerCase() === 'content-type') continue;
            res.setHeader(key, value);
          }

          if (typeof payload === 'string') {
            res.end(payload);
            return;
          }

          res.end(JSON.stringify(payload));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              error: err && err.message ? err.message : 'Mock server error',
            }),
          );
        }
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        requests,
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((resolveClose, rejectClose) => {
            server.close((err) => {
              if (err) {
                rejectClose(err);
                return;
              }
              resolveClose();
            });
          }),
      });
    });
  });
}

module.exports = {
  REPO_ROOT,
  CLI_PATH,
  DOCTOR_ENV_KEYS,
  createTempDir,
  removeDir,
  runCli,
  runCliAsync,
  runCliWithStdin,
  runCliWithTty,
  startJsonHttpServer,
  withChildEnv,
};
