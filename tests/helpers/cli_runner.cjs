const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI_PATH = path.join(REPO_ROOT, 'cli', 'pandora.cjs');
const DOCTOR_ENV_KEYS = ['CHAIN_ID', 'RPC_URL', 'PRIVATE_KEY', 'ORACLE', 'FACTORY', 'USDC', 'DEPLOYER_PRIVATE_KEY'];

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

function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: options.cwd || REPO_ROOT,
    encoding: 'utf8',
    env: withChildEnv(options.env, options.unsetEnvKeys),
    timeout: options.timeoutMs || 30_000,
    killSignal: 'SIGKILL',
  });

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: `${result.stdout || ''}${result.stderr || ''}`,
    error: result.error,
    timedOut: Boolean(result.error && result.error.code === 'ETIMEDOUT'),
  };
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
  startJsonHttpServer,
  withChildEnv,
};
