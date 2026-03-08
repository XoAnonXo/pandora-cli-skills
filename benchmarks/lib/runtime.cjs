const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const { createLocalPandoraAgentClient, createRemotePandoraAgentClient } = require('../../sdk/typescript');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI_PATH = path.join(REPO_ROOT, 'cli', 'pandora.cjs');
const BLOCKED_ENV_KEYS = [
  'CHAIN_ID',
  'RPC_URL',
  'PANDORA_PRIVATE_KEY',
  'PRIVATE_KEY',
  'ORACLE',
  'FACTORY',
  'USDC',
  'DEPLOYER_PRIVATE_KEY',
  'INDEXER_URL',
];
const BLOCKED_ENV_PREFIXES = ['PANDORA_', 'SPORTSBOOK_', 'POLYMARKET_'];

function shouldStripBenchmarkEnvKey(key) {
  if (BLOCKED_ENV_KEYS.includes(key)) return true;
  return BLOCKED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function createTempDir(prefix = 'pandora-benchmark-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function buildBenchmarkEnv(rootDir, overrides = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (shouldStripBenchmarkEnvKey(key)) continue;
    env[key] = value;
  }
  const homeDir = path.join(rootDir, 'home');
  const policyDir = path.join(rootDir, 'policies');
  const operationDir = path.join(rootDir, 'operations');
  const lifecycleDir = path.join(rootDir, 'lifecycles');
  const riskFile = path.join(rootDir, 'risk.json');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(policyDir, { recursive: true });
  fs.mkdirSync(operationDir, { recursive: true });
  fs.mkdirSync(lifecycleDir, { recursive: true });
  Object.assign(env, {
    HOME: homeDir,
    USERPROFILE: homeDir,
    PANDORA_PROFILE_FILE: path.join(rootDir, 'profiles.json'),
    PANDORA_POLICY_DIR: policyDir,
    PANDORA_POLICIES_DIR: policyDir,
    PANDORA_OPERATION_DIR: operationDir,
    PANDORA_LIFECYCLE_DIR: lifecycleDir,
    PANDORA_RISK_FILE: riskFile,
  }, overrides);
  return env;
}

function runCli(args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: options.cwd || REPO_ROOT,
    encoding: 'utf8',
    env: options.env || process.env,
    timeout: options.timeoutMs || 30_000,
    killSignal: 'SIGKILL',
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: `${result.stdout || ''}${result.stderr || ''}`,
    durationMs: Date.now() - startedAt,
    error: result.error || null,
  };
}

function parseJsonOutput(result, label) {
  const text = String(result.stdout || '').trim();
  if (!text) {
    throw new Error(`${label} returned empty stdout.`);
  }
  return JSON.parse(text);
}

function tryParseJsonOutput(result) {
  try {
    return parseJsonOutput(result, 'benchmark-cli-output');
  } catch {
    return null;
  }
}

async function withLocalClient(env, fn) {
  const client = createLocalPandoraAgentClient({
    command: process.execPath,
    args: [CLI_PATH, 'mcp'],
    cwd: REPO_ROOT,
    env,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

function findOpenPort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function appendOutput(chunks, chunk) {
  if (chunk === undefined || chunk === null) return;
  chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
}

async function closeChildProcess(child) {
  if (!child) return;
  if (child.exitCode !== null || child.killed) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGKILL');
      }
      resolve();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForGatewayBootstrap(baseUrl, authToken, child, outputChunks, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `pandora mcp http exited before readiness with code ${child.exitCode}.\n${outputChunks.join('')}`.trim(),
      );
    }
    try {
      const healthRes = await fetch(`${baseUrl}/health`);
      if (healthRes.status === 200) {
        let capabilitiesPayload = null;
        try {
          const capabilitiesRes = await fetch(`${baseUrl}/capabilities`, {
            headers: {
              authorization: `Bearer ${authToken}`,
            },
          });
          if (capabilitiesRes.status === 200) {
            capabilitiesPayload = await capabilitiesRes.json();
          } else if (![401, 403].includes(capabilitiesRes.status)) {
            lastError = new Error(`Unexpected /capabilities status during bootstrap: ${capabilitiesRes.status}`);
            await new Promise((resolve) => setTimeout(resolve, 100));
            continue;
          }
        } catch (error) {
          lastError = error;
        }
        return {
          healthStatus: healthRes.status,
          capabilitiesPayload,
        };
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const detail = lastError ? `\nLast error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for pandora mcp http readiness at ${baseUrl}.${detail}\n${outputChunks.join('')}`.trim());
}

async function withRemoteClient(env, authScopes, fn) {
  const port = await findOpenPort('127.0.0.1');
  const authToken = 'benchmark-token';
  const outputChunks = [];
  const child = spawn(process.execPath, [
    CLI_PATH,
    'mcp',
    'http',
    '--host', '127.0.0.1',
    '--port', String(port),
    '--auth-token', authToken,
    '--auth-scopes', (authScopes || []).join(','),
  ], {
    cwd: REPO_ROOT,
    env: env || process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => appendOutput(outputChunks, chunk));
  child.stderr.on('data', (chunk) => appendOutput(outputChunks, chunk));
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const bootstrap = await waitForGatewayBootstrap(baseUrl, authToken, child, outputChunks);
    const capabilitiesPayload = bootstrap.capabilitiesPayload;
    const advertisedEndpoint =
      capabilitiesPayload
      && capabilitiesPayload.data
      && capabilitiesPayload.data.transports
      && capabilitiesPayload.data.transports.mcpStreamableHttp
      && capabilitiesPayload.data.transports.mcpStreamableHttp.endpoint;
    const mcpUrl = new URL(String(advertisedEndpoint || `${baseUrl}/mcp`));
    const client = createRemotePandoraAgentClient({
      url: mcpUrl,
      authToken,
    });
    await client.connect();
    try {
      return await fn(client, {
        auth: { token: authToken, scopes: (authScopes || []).slice() },
        baseUrl,
        capabilities: capabilitiesPayload,
        healthPath: '/health',
        capabilitiesPath: '/capabilities',
        mcpUrl: mcpUrl.toString(),
        process: child,
      });
    } finally {
      await client.close();
    }
  } finally {
    await closeChildProcess(child);
  }
}

async function callMcpTool(client, tool, args) {
  const startedAt = Date.now();
  try {
    const envelope = await client.callTool(tool, args || {});
    return {
      ok: true,
      envelope,
      durationMs: Date.now() - startedAt,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      envelope: null,
      durationMs: Date.now() - startedAt,
      error,
    };
  }
}

module.exports = {
  REPO_ROOT,
  CLI_PATH,
  createTempDir,
  removeDir,
  buildBenchmarkEnv,
  runCli,
  parseJsonOutput,
  tryParseJsonOutput,
  withLocalClient,
  withRemoteClient,
  callMcpTool,
};
