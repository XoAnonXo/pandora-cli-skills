const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { runCli, runCliAsync, REPO_ROOT } = require('../helpers/cli_runner.cjs');

function createIsolatedPolicyProfileEnv(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-profile-readiness-audit-'));
  const homeDir = path.join(rootDir, 'home');
  const policyDir = path.join(rootDir, 'policies');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(policyDir, { recursive: true });
  t.after(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
  return {
    rootDir,
    env: {
      HOME: homeDir,
      USERPROFILE: homeDir,
      PANDORA_PROFILE_FILE: path.join(rootDir, 'profiles.json'),
      PANDORA_POLICY_DIR: policyDir,
      PANDORA_POLICIES_DIR: policyDir,
    },
  };
}

function parseJsonOutput(result, label) {
  assert.equal(result.status, 0, result.output || result.stderr || `expected successful JSON result for ${label}`);
  return JSON.parse(String(result.stdout || '').trim());
}

function sortStrings(values) {
  return values.slice().sort((left, right) => left.localeCompare(right));
}

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}


const BUILTIN_KEYSTORE_PASSWORD = 'test-password';
const BUILTIN_KEYSTORE_JSON = JSON.stringify({
  address: '19e7e376e7c213b7e7e7e46cc70a5dd086daff2a',
  id: 'c90cd9f1-6e40-4ff1-a2b1-8928c40bb9b0',
  version: 3,
  crypto: {
    cipher: 'aes-128-ctr',
    cipherparams: {
      iv: 'e0e590a09e186927ea81adad8b4b31af',
    },
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
const BUILTIN_EXTERNAL_SIGNER_ADDRESS = '0x4444444444444444444444444444444444444444';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await listen(server);
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(url);
  } finally {
    await close(server);
  }
}

function writeBuiltinKeystoreFixture(rootDir) {
  const keystorePath = path.join(rootDir, 'home', '.pandora', 'keys', 'dev_keystore_operator.json');
  fs.mkdirSync(path.dirname(keystorePath), { recursive: true });
  fs.writeFileSync(keystorePath, BUILTIN_KEYSTORE_JSON, 'utf8');
  fs.chmodSync(keystorePath, 0o600);
  return keystorePath;
}

test('docs, capabilities, and profile list agree that built-in mutable samples are not runtime-ready by default', (t) => {
  const { env } = createIsolatedPolicyProfileEnv(t);
  const capabilities = parseJsonOutput(runCli(['--output', 'json', 'capabilities'], { env }), 'capabilities');
  const profileList = parseJsonOutput(runCli(['--output', 'json', 'profile', 'list'], { env }), 'profile list');
  const policyProfilesText = read('docs/skills/policy-profiles.md');
  const agentInterfacesText = read('docs/skills/agent-interfaces.md');
  const readmeText = read('README.md');

  const expectedReadyBuiltinIds = ['market_observer_ro'];
  const expectedMutableBuiltinIds = ['desk_signer_service', 'dev_keystore_operator', 'prod_trader_a'];
  const itemsById = new Map(profileList.data.items.map((item) => [item.id, item]));

  assert.deepEqual(
    sortStrings(capabilities.data.policyProfiles.signerProfiles.builtinIds),
    sortStrings(expectedReadyBuiltinIds.concat(expectedMutableBuiltinIds)),
  );
  assert.deepEqual(
    sortStrings(capabilities.data.policyProfiles.signerProfiles.readyBuiltinIds),
    expectedReadyBuiltinIds,
  );
  assert.deepEqual(
    sortStrings(capabilities.data.policyProfiles.signerProfiles.degradedBuiltinIds),
    expectedMutableBuiltinIds,
  );
  assert.deepEqual(
    sortStrings(capabilities.data.policyProfiles.signerProfiles.pendingBuiltinIds),
    expectedMutableBuiltinIds,
  );

  for (const profileId of expectedMutableBuiltinIds) {
    const item = itemsById.get(profileId);
    assert.ok(item, `profile list should include ${profileId}`);
    assert.equal(item.readOnly, false, `${profileId} should be exposed as mutable`);
    assert.equal(item.backendImplemented, true, `${profileId} should expose an implemented backend`);
    assert.equal(item.runtimeReady, false, `${profileId} should not be runtime-ready by default`);
    assert.notEqual(item.resolutionStatus, 'ready', `${profileId} should not report ready status by default`);
  }

  assert.match(
    policyProfilesText,
    /`degradedBuiltinIds` contains every built-in mutable sample: `prod_trader_a`, `dev_keystore_operator`, and `desk_signer_service`/i,
  );
  assert.match(
    policyProfilesText,
    /`market_observer_ro` is the only built-in profile reporting `ready`/i,
  );
  assert.match(
    agentInterfacesText,
    /only `market_observer_ro` is built-in runtime-ready by default/i,
  );
  assert.match(
    readmeText,
    /`market_observer_ro` is the only built-in profile reporting `ready`, and it is read-only/i,
  );
});


test('runtime-local readiness audit proves at least two built-in mutable profiles can become ready under valid runtime conditions', async (t) => {
  const { rootDir, env } = createIsolatedPolicyProfileEnv(t);
  writeBuiltinKeystoreFixture(rootDir);

  await withServer(async (req, res) => {
    if (req.url === '/health') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        data: {
          healthy: true,
          protocolVersion: 'pandora-external-signer/v1',
          methods: ['signTransaction', 'signTypedData'],
          chainIds: [1],
        },
      }));
      return;
    }
    if (req.url === '/accounts?chainId=1') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        data: {
          protocolVersion: 'pandora-external-signer/v1',
          methods: ['signTransaction', 'signTypedData'],
          chainIds: [1],
          accounts: [
            {
              address: BUILTIN_EXTERNAL_SIGNER_ADDRESS,
              chainIds: [1],
              methods: ['signTransaction', 'signTypedData'],
            },
          ],
        },
      }));
      return;
    }
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }
    const payload = JSON.parse(body || '{}');
    if (payload.method === 'eth_chainId') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: '0x1' }));
      return;
    }
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'not found' } }));
  }, async (baseUrl) => {
    const runtimeEnv = {
      ...env,
      PANDORA_PRIVATE_KEY: `0x${'33'.repeat(32)}`,
      PANDORA_KEYSTORE_PASSWORD: BUILTIN_KEYSTORE_PASSWORD,
      PANDORA_EXTERNAL_SIGNER_URL: baseUrl,
      PANDORA_EXTERNAL_SIGNER_TOKEN: 'secret-token',
      RPC_URL: baseUrl,
      CHAIN_ID: '1',
    };

    const capabilities = parseJsonOutput(await runCliAsync(['--output', 'json', 'capabilities', '--runtime-local-readiness'], { env: runtimeEnv }), 'capabilities runtime-local');
    const readyBuiltins = sortStrings(capabilities.data.policyProfiles.signerProfiles.readyBuiltinIds);
    const readyMutableBuiltins = readyBuiltins.filter((id) => id !== 'market_observer_ro');

    assert.ok(readyMutableBuiltins.length >= 2, `expected at least two built-in mutable profiles to be runtime-ready, got ${readyMutableBuiltins.join(', ')}`);
    assert.ok(readyMutableBuiltins.includes('prod_trader_a'));
    assert.ok(readyMutableBuiltins.includes('dev_keystore_operator'));
    assert.ok(readyMutableBuiltins.includes('desk_signer_service'));
  });
});

test('profile explain and recommend surface canonical-tool-first ranking for cold agents', (t) => {
  const { env } = createIsolatedPolicyProfileEnv(t);

  const explain = parseJsonOutput(runCli([
    '--output', 'json',
    'profile', 'explain',
    '--id', 'market_observer_ro',
    '--command', 'trade.quote',
    '--mode', 'dry-run',
    '--chain-id', '1',
    '--category', 'Crypto',
    '--policy-id', 'research-only',
  ], { env }), 'profile explain');
  assert.equal(explain.command, 'profile.explain');
  assert.equal(explain.data.explanation.compatibility.requestedCommand, 'trade.quote');
  assert.equal(explain.data.explanation.compatibility.canonicalCommand, 'quote');
  assert.equal(explain.data.explanation.recommendations.decision.bestProfileId, 'market_observer_ro');
  assert.equal(explain.data.explanation.recommendations.decision.bestPolicyId, 'research-only');

  const recommend = parseJsonOutput(runCli([
    '--output', 'json',
    'profile', 'recommend',
    '--command', 'trade.execute',
    '--mode', 'execute',
    '--chain-id', '1',
    '--category', 'Crypto',
    '--policy-id', 'execute-with-validation',
  ], { env }), 'profile recommend');
  assert.equal(recommend.command, 'profile.recommend');
  assert.equal(recommend.data.requestedContext.command, 'trade.execute');
  assert.equal(recommend.data.requestedContext.canonicalTool, 'trade');
  assert.equal(recommend.data.recommendedProfileId, 'prod_trader_a');
  assert.equal(recommend.data.items[0].id, 'prod_trader_a');
  assert.equal(recommend.data.items[0].canonicalTool, 'trade');
  assert.equal(recommend.data.decision.bestPolicyId, 'execute-with-validation');
  assert.equal(recommend.data.decision.bestTool, 'quote');
  assert.equal(recommend.data.nextTools[0].tool, 'quote');
});
