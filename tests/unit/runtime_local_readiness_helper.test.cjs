const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check_runtime_local_readiness.cjs');

const BUILTIN_KEYSTORE_PASSWORD = 'test-password';
const BUILTIN_KEYSTORE_JSON = JSON.stringify({
  address: '19e7e376e7c213b7e7e7e46cc70a5dd086daff2a',
  id: 'c90cd9f1-6e40-4ff1-a2b1-8928c40bb9b0',
  version: 3,
  crypto: {
    cipher: 'aes-128-ctr',
    cipherparams: { iv: 'e0e590a09e186927ea81adad8b4b31af' },
    ciphertext: 'e077031220490dceff4c6762ce64620d3845c5fd40b4a9e0274b700f6930b3fa',
    kdf: 'scrypt',
    kdfparams: {
      salt: '07366f4bac8d02c3a806f67bea856b2dfa1e0b56548c079ccc34ee856c63ee0b',
      n: 1024,
      dklen: 32,
      p: 1,
      r: 8,
    },
    mac: '0abe3a58589b2bf285e0360e5768e6dff770476f76cd62b9af0a9e6e2da5dc47',
  },
}, null, 2);

function createTempHome(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-runtime-readiness-helper-'));
  const homeDir = path.join(rootDir, 'home');
  fs.mkdirSync(homeDir, { recursive: true });
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  return { homeDir };
}

async function createRpcProbeServer(t) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        body,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: '0x1',
      }));
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  }));

  const address = server.address();
  assert.ok(address && typeof address === 'object' && address.port, 'rpc probe server should expose a port');
  return {
    requests,
    rpcUrl: `http://127.0.0.1:${address.port}`,
  };
}

function execFileAsync(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

test('runtime-local readiness helper auto-loads ~/.pandora-cli.env and certifies when two mutable built-ins are ready', async (t) => {
  const { homeDir } = createTempHome(t);
  const rpcProbe = await createRpcProbeServer(t);
  const envFile = path.join(homeDir, '.pandora-cli.env');
  const keystoreDir = path.join(homeDir, '.pandora', 'keys');
  const policyDir = path.join(homeDir, 'policies');
  fs.mkdirSync(keystoreDir, { recursive: true });
  fs.mkdirSync(policyDir, { recursive: true });
  fs.writeFileSync(path.join(keystoreDir, 'dev_keystore_operator.json'), BUILTIN_KEYSTORE_JSON, 'utf8');
  fs.chmodSync(path.join(keystoreDir, 'dev_keystore_operator.json'), 0o600);
  fs.writeFileSync(
    envFile,
    [
      `PRIVATE_KEY=0x${'33'.repeat(32)}`,
      `RPC_URL=${rpcProbe.rpcUrl}`,
      'CHAIN_ID=1',
      `PANDORA_KEYSTORE_PASSWORD=${BUILTIN_KEYSTORE_PASSWORD}`,
      '',
    ].join('\n'),
    'utf8',
  );

  const { stdout } = await execFileAsync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      http_proxy: '',
      https_proxy: '',
      PANDORA_PROFILE_FILE: path.join(homeDir, 'profiles.json'),
      PANDORA_POLICY_DIR: policyDir,
      PANDORA_POLICIES_DIR: policyDir,
      PANDORA_PRIVATE_KEY: '',
      PRIVATE_KEY: '',
      RPC_URL: '',
      CHAIN_ID: '',
      PANDORA_KEYSTORE_PASSWORD: '',
      KEYSTORE_PASSWORD: '',
      EXTERNAL_SIGNER_URL: '',
      PANDORA_EXTERNAL_SIGNER_URL: '',
      EXTERNAL_SIGNER_TOKEN: '',
      PANDORA_EXTERNAL_SIGNER_TOKEN: '',
    },
    encoding: 'utf8',
  });

  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.status, 'certified');
  assert.equal(payload.helper.envFileLoaded, true);
  assert.equal(payload.helper.envFile, envFile);
  assert.ok(Array.isArray(payload.helper.envKeysLoaded));
  assert.match(payload.helper.envKeysLoaded.join(','), /PRIVATE_KEY/);
  const readinessCheck = payload.checks.find((item) => item.id === 'runtime-ready-mutable-profiles');
  assert.ok(readinessCheck);
  assert.equal(readinessCheck.status, 'pass');
  assert.deepEqual(readinessCheck.actual.readyMutableBuiltinIds.sort(), ['dev_keystore_operator', 'prod_trader_a']);
  assert.equal(rpcProbe.requests.length >= 2, true);
});
