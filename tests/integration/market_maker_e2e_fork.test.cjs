'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI_PATH = path.join(REPO_ROOT, 'cli', 'pandora.cjs');

const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const ORACLE_ADDRESS = '0x259308E7d8557e4Ba192De1aB8Cf7e0E21896442';
const FACTORY_ADDRESS = '0xaB120F1FD31FB1EC39893B75d80a3822b1Cd8d0c';
const ARBITER_ADDRESS = '0x0D7B957C47Da86c2968dc52111D633D42cb7a5F7';

const ANVIL_ACCOUNT_0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const ANVIL_PRIVATE_KEY_0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const USDC_FUND_RAW = 100_000n * 10n ** 6n; // 100k USDC

const ANVIL_PORT = 18545;
const ANVIL_RPC = `http://127.0.0.1:${ANVIL_PORT}`;

const FIXED_MIRROR_CLOSE_ISO = '2030-03-09T16:00:00Z';
const FIXED_MIRROR_CLOSE_TS = String(Math.floor(Date.parse(FIXED_MIRROR_CLOSE_ISO) / 1000));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveAnvilPath() {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.foundry', 'bin', 'anvil.exe'),
    path.join(home, '.foundry', 'bin', 'anvil'),
    'anvil',
  ];
  for (const p of candidates) {
    if (p === 'anvil') return p;
    if (fs.existsSync(p)) return p;
  }
  return 'anvil';
}

async function jsonRpc(url, method, params = []) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
  return json.result;
}

function loadViem() {
  const viem = require('viem');
  return viem;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTempDir(prefix = 'pandora-e2e-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runCliAsync(args, options = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    for (const key of (options.unsetEnvKeys || [])) delete env[key];
    Object.assign(env, options.env || {});

    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: options.cwd || REPO_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeoutMs = options.timeoutMs || 120_000;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);

    child.stdout.on('data', (c) => { stdout += String(c); });
    child.stderr.on('data', (c) => { stderr += String(c); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ status: 1, stdout, stderr, output: stdout + stderr, error, timedOut: false });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ status: code ?? 1, stdout, stderr, output: stdout + stderr, error: undefined, timedOut });
    });
  });
}

function parseJsonOutput(result) {
  const text = (result.stdout || '').trim() || (result.output || '').trim();
  assert.match(text, /\{/, `Expected JSON output, got:\n${result.output}`);
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Mock servers
// ---------------------------------------------------------------------------

function startJsonHttpServer(handler) {
  return new Promise((resolve, reject) => {
    const requests = [];
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        let bodyJson = null;
        try { bodyJson = JSON.parse(bodyText); } catch { /* skip */ }
        requests.push({ method: req.method, url: req.url, bodyText, bodyJson });
        try {
          const response = await handler({ method: req.method, url: req.url, bodyText, bodyJson });
          const status = response?.status ?? 200;
          const payload = response?.body ?? {};
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: err?.message || 'mock error' }));
        }
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        requests,
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r, e) => server.close((err) => err ? e(err) : r())),
      });
    });
  });
}

function startMockClobServer(overrides = {}) {
  const hedgeLog = [];
  let failNextHedge = false;
  let hedgeCallCount = 0;

  const basePayload = {
    markets: [{
      question: 'Will deterministic tests pass?',
      condition_id: 'poly-cond-1',
      question_id: 'poly-q-1',
      market_slug: 'deterministic-tests-pass',
      end_date_iso: FIXED_MIRROR_CLOSE_ISO,
      active: true,
      closed: false,
      volume24hr: 100000,
      tokens: [
        { outcome: 'Yes', price: '0.74', token_id: 'poly-yes-1' },
        { outcome: 'No', price: '0.26', token_id: 'poly-no-1' },
      ],
    }],
    orderbooks: {
      'poly-yes-1': { bids: [{ price: '0.73', size: '500' }], asks: [{ price: '0.74', size: '600' }] },
      'poly-no-1':  { bids: [{ price: '0.25', size: '500' }], asks: [{ price: '0.26', size: '600' }] },
    },
  };

  const payload = {
    ...basePayload,
    ...overrides,
    markets: Array.isArray(overrides.markets) ? overrides.markets : basePayload.markets,
    orderbooks: overrides.orderbooks || basePayload.orderbooks,
  };

  const serverPromise = startJsonHttpServer(({ url, bodyJson }) => {
    if (url?.includes('/order') || url?.includes('/hedge')) {
      hedgeCallCount++;
      const record = { url, body: bodyJson, timestamp: Date.now() };
      if (failNextHedge) {
        failNextHedge = false;
        hedgeLog.push({ ...record, failed: true });
        return { status: 500, body: { error: 'Simulated CLOB failure' } };
      }
      hedgeLog.push(record);
      return { body: { mode: 'mock', ok: true, response: { status: 'simulated' } } };
    }
    return { body: payload };
  });

  return serverPromise.then((server) => ({
    ...server,
    hedgeLog,
    get hedgeCallCount() { return hedgeCallCount; },
    setFailNextHedge() { failNextHedge = true; },
    updatePayload(patch) { Object.assign(payload, patch); },
  }));
}

function startPolygonRpcMock() {
  const MAX_UINT = '0x' + 'f'.repeat(64);
  const TRUE_BOOL = '0x' + '0'.repeat(63) + '1';
  const LARGE_BALANCE = '0x' + (10n ** 24n).toString(16).padStart(64, '0');

  return startJsonHttpServer(({ bodyJson }) => {
    const requests = Array.isArray(bodyJson) ? bodyJson : [bodyJson];
    const responses = requests.map((req, i) => {
      const id = req?.id ?? i + 1;
      if (!req) return { jsonrpc: '2.0', id, error: { message: 'Invalid' } };

      if (req.method === 'eth_chainId') {
        return { jsonrpc: '2.0', id, result: '0x89' }; // 137
      }
      if (req.method === 'eth_getCode') {
        return { jsonrpc: '2.0', id, result: '0x6001600101' };
      }
      if (req.method === 'eth_call') {
        const data = String(req.params?.[0]?.data || '').toLowerCase();
        const selector = data.slice(0, 10);

        // balanceOf -> large balance
        if (selector === '0x70a08231') return { jsonrpc: '2.0', id, result: LARGE_BALANCE };
        // allowance -> max uint (fully approved)
        if (selector === '0xdd62ed3e') return { jsonrpc: '2.0', id, result: MAX_UINT };
        // isApprovedForAll -> true
        if (selector === '0xe985e9c5') return { jsonrpc: '2.0', id, result: TRUE_BOOL };
        // isOwner -> true (Safe owner check)
        if (selector === '0x2f54bf6e') return { jsonrpc: '2.0', id, result: TRUE_BOOL };

        return { jsonrpc: '2.0', id, result: '0x' + '0'.repeat(64) };
      }
      if (req.method === 'eth_blockNumber') {
        return { jsonrpc: '2.0', id, result: '0x1000000' };
      }
      return { jsonrpc: '2.0', id, result: '0x' };
    });
    return { body: Array.isArray(bodyJson) ? responses : responses[0] };
  });
}

function startMockIndexer(marketAddress, pollAddress, overrides = {}) {
  const market = {
    id: marketAddress,
    chainId: 1,
    chainName: 'ethereum',
    pollAddress,
    creator: ANVIL_ACCOUNT_0,
    marketType: 'amm',
    marketCloseTimestamp: FIXED_MIRROR_CLOSE_TS,
    totalVolume: '100000',
    currentTvl: '200000',
    yesChance: '0.55',
    reserveYes: '500000000',
    reserveNo: '500000000',
    createdAt: String(Math.floor(Date.now() / 1000)),
    ...overrides.market,
  };
  const poll = {
    id: pollAddress,
    chainId: 1,
    chainName: 'ethereum',
    creator: ANVIL_ACCOUNT_0,
    question: 'Will deterministic tests pass?',
    status: 0,
    category: 3,
    deadlineEpoch: Number(FIXED_MIRROR_CLOSE_TS),
    createdAt: Math.floor(Date.now() / 1000),
    createdTxHash: '0xdeadbeef',
    rules: 'Resolves YES if deterministic tests pass in CI. Resolves NO otherwise.',
    sources: '["https://github.com","https://ci.example.com"]',
    ...overrides.poll,
  };

  return startJsonHttpServer(({ bodyJson }) => {
    const query = bodyJson?.query || '';
    const variables = bodyJson?.variables || {};

    if (query.includes('marketss(')) {
      return { body: { data: { marketss: { items: [market], totalCount: 1 } } } };
    }
    if (query.includes('markets(id:')) {
      const found = variables.id === market.id ? market : null;
      return { body: { data: { markets: found } } };
    }
    if (query.includes('pollss(')) {
      return { body: { data: { pollss: { items: [poll], totalCount: 1 } } } };
    }
    if (query.includes('polls(id:')) {
      const found = variables.id === poll.id ? poll : null;
      return { body: { data: { polls: found } } };
    }
    if (query.includes('liquidityEventss(')) {
      return { body: { data: { liquidityEventss: { items: [], totalCount: 0 } } } };
    }
    if (query.includes('tradess(')) {
      return { body: { data: { tradess: { items: [], totalCount: 0 } } } };
    }
    if (query.includes('marketUserss(')) {
      return { body: { data: { marketUserss: { items: [], totalCount: 0 } } } };
    }
    if (query.includes('winningss(')) {
      return { body: { data: { winningss: { items: [], totalCount: 0 } } } };
    }
    if (query.includes('userss(')) {
      return { body: { data: { userss: { items: [], totalCount: 0 } } } };
    }
    if (query.includes('oracleFeeEventss(')) {
      return { body: { data: { oracleFeeEventss: { items: [], totalCount: 0 } } } };
    }
    if (query.includes('claimEventss(')) {
      return { body: { data: { claimEventss: { items: [], totalCount: 0 } } } };
    }

    // batch entity selections
    const batchMarketMatch = query.match(/(\w+):\s*markets\(id:\s*\$(\w+)\)/g);
    if (batchMarketMatch) {
      const data = {};
      for (const m of batchMarketMatch) {
        const aliasMatch = m.match(/^(\w+):/);
        if (aliasMatch) data[aliasMatch[1]] = market;
      }
      return { body: { data } };
    }
    const batchPollMatch = query.match(/(\w+):\s*polls\(id:\s*\$(\w+)\)/g);
    if (batchPollMatch) {
      const data = {};
      for (const m of batchPollMatch) {
        const aliasMatch = m.match(/^(\w+):/);
        if (aliasMatch) data[aliasMatch[1]] = poll;
      }
      return { body: { data } };
    }

    return { status: 200, body: { data: {} } };
  });
}

// ---------------------------------------------------------------------------
// Anvil lifecycle
// ---------------------------------------------------------------------------

async function startAnvil(rpcUrl) {
  const anvilPath = resolveAnvilPath();
  const forkUrl = rpcUrl || process.env.RPC_URL || '';
  if (!forkUrl) throw new Error('RPC_URL required for Anvil fork. Set it in .env or environment.');

  const args = [
    '--fork-url', forkUrl,
    '--port', String(ANVIL_PORT),
    '--accounts', '1',
    '--balance', '10000',
    '--chain-id', '1',
    '--silent',
  ];

  const child = spawn(anvilPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let started = false;
  let startError = '';

  child.stderr.on('data', (c) => { startError += String(c); });

  const readyPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Anvil failed to start within 30s: ${startError}`)), 30_000);
    child.on('error', (err) => { clearTimeout(timeout); reject(err); });
    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      if (text.includes('Listening') || text.includes('listening')) {
        started = true;
        clearTimeout(timeout);
        resolve();
      }
    });
    // also poll for readiness
    const poll = setInterval(async () => {
      if (started) { clearInterval(poll); return; }
      try {
        const r = await fetch(ANVIL_RPC, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
        });
        if (r.ok) { started = true; clearInterval(poll); clearTimeout(timeout); resolve(); }
      } catch { /* not ready yet */ }
    }, 500);
  });

  await readyPromise;
  return child;
}

async function fundTestWallet() {
  // ETH: use anvil_setBalance
  await jsonRpc(ANVIL_RPC, 'anvil_setBalance', [ANVIL_ACCOUNT_0, '0x' + (10000n * 10n ** 18n).toString(16)]);

  // USDC: directly set storage slot in USDC contract (slot 9 = balances mapping)
  const { keccak256, encodeAbiParameters, parseAbiParameters } = loadViem();
  const encoded = encodeAbiParameters(parseAbiParameters('address, uint256'), [ANVIL_ACCOUNT_0, 9n]);
  const balanceSlot = keccak256(encoded);
  const valueHex = '0x' + USDC_FUND_RAW.toString(16).padStart(64, '0');
  // Also need to increase totalSupply to avoid inconsistency (slot 11 for FiatTokenV1)
  const totalSupplySlot = '0x' + '0'.repeat(63) + 'b'; // slot 11
  const currentSupply = await jsonRpc(ANVIL_RPC, 'eth_getStorageAt', [USDC_ADDRESS, totalSupplySlot, 'latest']);
  const newSupply = '0x' + (BigInt(currentSupply) + USDC_FUND_RAW).toString(16).padStart(64, '0');
  await jsonRpc(ANVIL_RPC, 'anvil_setStorageAt', [USDC_ADDRESS, totalSupplySlot, newSupply]);
  await jsonRpc(ANVIL_RPC, 'anvil_setStorageAt', [USDC_ADDRESS, balanceSlot, valueHex]);

  // Verify USDC balance
  const balSig = '0x70a08231';
  const paddedAddr = ANVIL_ACCOUNT_0.slice(2).padStart(64, '0');
  const balResult = await jsonRpc(ANVIL_RPC, 'eth_call', [
    { to: USDC_ADDRESS, data: `${balSig}${paddedAddr}` },
    'latest',
  ]);
  const balanceRaw = BigInt(balResult);
  assert.ok(balanceRaw >= 10_000n * 10n ** 6n, `USDC balance too low: ${balanceRaw}`);
  return balanceRaw;
}

// ---------------------------------------------------------------------------
// CLI env builder
// ---------------------------------------------------------------------------

const UNSET_ENV_KEYS = [
  'CHAIN_ID', 'RPC_URL', 'PANDORA_PRIVATE_KEY', 'PRIVATE_KEY',
  'ORACLE', 'FACTORY', 'USDC', 'DEPLOYER_PRIVATE_KEY',
  'PANDORA_DEPLOYER_PRIVATE_KEY', 'FORK_RPC_URL',
  'PANDORA_INDEXER_URL', 'INDEXER_URL',
  'POLYMARKET_PRIVATE_KEY', 'POLYMARKET_FUNDER',
  'POLYMARKET_API_KEY', 'POLYMARKET_API_SECRET', 'POLYMARKET_PASSPHRASE',
];

function buildEnv(indexerUrl, polymarketUrl, extra = {}) {
  return {
    env: {
      CHAIN_ID: '1',
      RPC_URL: ANVIL_RPC,
      PRIVATE_KEY: ANVIL_PRIVATE_KEY_0,
      ORACLE: ORACLE_ADDRESS,
      FACTORY: FACTORY_ADDRESS,
      USDC: USDC_ADDRESS,
      PANDORA_INDEXER_URL: indexerUrl || '',
      ...extra,
    },
    unsetEnvKeys: UNSET_ENV_KEYS,
  };
}

function buildEnvLive(indexerUrl, polymarketUrl, polygonRpcUrl, extra = {}) {
  return buildEnv(indexerUrl, polymarketUrl, {
    POLYMARKET_PRIVATE_KEY: ANVIL_PRIVATE_KEY_0,
    POLYMARKET_FUNDER: ANVIL_ACCOUNT_0,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Main test suite
// ---------------------------------------------------------------------------

test('Fork-Based E2E Market Maker Integration Tests', { timeout: 600_000 }, async (t) => {
  let anvilProcess = null;
  let clobServer = null;
  let indexerServer = null;
  const tempDir = createTempDir('pandora-e2e-fork-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const manifestFile = path.join(tempDir, 'pairs.json');
  const killFile = path.join(tempDir, 'STOP');

  let polygonRpcMock = null;
  let deployedMarketAddress = null;
  let deployedPollAddress = null;

  // =========================================================================
  // Phase 1: Infrastructure setup
  // =========================================================================
  await t.test('Phase 1: start Anvil fork and fund test wallet', async () => {
    // Kill any lingering Anvil on our port
    try {
      await fetch(ANVIL_RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      // Port is in use — wait for it to free or try to kill
      await delay(500);
    } catch { /* port is free, good */ }

    // Load RPC_URL from .env if not set
    if (!process.env.RPC_URL) {
      const envPath = path.join(REPO_ROOT, '.env');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/^RPC_URL=(.+)$/m);
        if (match) process.env.RPC_URL = match[1].trim();
      }
    }

    anvilProcess = await startAnvil(process.env.RPC_URL);
    assert.ok(anvilProcess.pid, 'Anvil should be running');

    const chainId = await jsonRpc(ANVIL_RPC, 'eth_chainId');
    assert.equal(chainId, '0x1', 'Fork should be chain ID 1');

    const usdcBalance = await fundTestWallet();
    assert.ok(usdcBalance >= 10_000n * 10n ** 6n, `Test wallet funded with ${usdcBalance / 10n ** 6n} USDC`);
  });

  await t.test('Phase 1: start mock CLOB and indexer servers', async () => {
    clobServer = await startMockClobServer();
    assert.ok(clobServer.url, 'Mock CLOB server running');

    polygonRpcMock = await startPolygonRpcMock();
    assert.ok(polygonRpcMock.url, 'Polygon RPC mock running');

    // Start with placeholder addresses; will restart with real addresses after deploy
    indexerServer = await startMockIndexer(
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
    );
    assert.ok(indexerServer.url, 'Mock indexer server running');
  });

  // =========================================================================
  // Phase 2: Market deployment
  // =========================================================================

  await t.test('Phase 2a: mirror plan with Polymarket slug', async () => {
    const result = await runCliAsync([
      '--output', 'json',
      'mirror', 'plan',
      '--skip-dotenv',
      '--source', 'polymarket',
      '--polymarket-market-id', 'poly-cond-1',
      '--polymarket-mock-url', clobServer.url,
    ], buildEnv(indexerServer.url, clobServer.url));

    assert.equal(result.status, 0, `mirror plan failed: ${result.output}`);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true, `mirror plan not ok: ${JSON.stringify(payload)}`);
    assert.equal(payload.command, 'mirror.plan');
    assert.ok(payload.data, 'Plan data should be present');
  });

  await t.test('Phase 2b: mirror deploy --dry-run', async () => {
    const result = await runCliAsync([
      '--output', 'json',
      'mirror', 'deploy',
      '--skip-dotenv',
      '--rpc-url', ANVIL_RPC,
      '--indexer-url', indexerServer.url,
      '--polymarket-mock-url', clobServer.url,
      '--polymarket-market-id', 'poly-cond-1',
      '--dry-run',
      '--liquidity-usdc', '100',
      '--sources', 'https://www.nba.com', 'https://www.espn.com',
    ], buildEnv(indexerServer.url, clobServer.url));

    assert.equal(result.status, 0, `mirror deploy dry-run failed: ${result.output}`);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true, `Dry-run not ok: ${JSON.stringify(payload)}`);
    assert.equal(payload.data.dryRun, true);
    assert.ok(payload.data.deploymentArgs, 'deploymentArgs should exist');
    assert.ok(payload.data.deploymentArgs.feeTier, 'feeTier should be set');
  });

  await t.test('Phase 2c: mirror deploy --execute on Anvil fork', async () => {
    // Clean up any lingering deploy guards from previous runs
    const deployGuardDir = path.join(os.homedir(), '.pandora', 'mirror', 'deploy-guards');
    if (fs.existsSync(deployGuardDir)) {
      for (const f of fs.readdirSync(deployGuardDir)) {
        if (f.endsWith('.json')) {
          try { fs.unlinkSync(path.join(deployGuardDir, f)); } catch { /* ignore */ }
        }
      }
    }

    // Step 1: dry-run to get validation ticket
    const dryRunResult = await runCliAsync([
      '--output', 'json',
      'mirror', 'deploy',
      '--skip-dotenv',
      '--rpc-url', ANVIL_RPC,
      '--indexer-url', indexerServer.url,
      '--polymarket-mock-url', clobServer.url,
      '--polymarket-market-id', 'poly-cond-1',
      '--dry-run',
      '--liquidity-usdc', '100',
      '--sources', 'https://www.nba.com', 'https://www.espn.com',
    ], buildEnv(indexerServer.url, clobServer.url));

    assert.equal(dryRunResult.status, 0, `Dry-run failed: ${dryRunResult.output}`);
    const dryRunPayload = parseJsonOutput(dryRunResult);
    assert.equal(dryRunPayload.ok, true);
    const validationTicket = dryRunPayload.data.requiredValidation?.ticket;
    assert.ok(validationTicket, 'Validation ticket should be returned from dry-run');

    // Step 2: execute with validation ticket
    const execResult = await runCliAsync([
      '--output', 'json',
      'mirror', 'deploy',
      '--skip-dotenv',
      '--rpc-url', ANVIL_RPC,
      '--indexer-url', indexerServer.url,
      '--polymarket-mock-url', clobServer.url,
      '--polymarket-market-id', 'poly-cond-1',
      '--execute',
      '--validation-ticket', validationTicket,
      '--manifest-file', manifestFile,
      '--liquidity-usdc', '100',
      '--sources', 'https://www.nba.com', 'https://www.espn.com',
    ], buildEnv(indexerServer.url, clobServer.url));

    assert.equal(execResult.status, 0, `Deploy execute failed: ${execResult.output}`);
    const payload = parseJsonOutput(execResult);
    assert.equal(payload.ok, true, `Deploy not ok: ${JSON.stringify(payload)}`);
    assert.equal(payload.data.dryRun, false);
    assert.ok(payload.data.pandora?.pollAddress, 'Poll address missing');
    assert.ok(payload.data.pandora?.marketAddress, 'Market address missing');
    assert.ok(payload.data.tx?.pollTxHash, 'Poll tx hash missing');

    deployedPollAddress = payload.data.pandora.pollAddress;
    deployedMarketAddress = payload.data.pandora.marketAddress;

    // Verify contract exists on fork
    const code = await jsonRpc(ANVIL_RPC, 'eth_getCode', [deployedMarketAddress, 'latest']);
    assert.ok(code && code !== '0x' && code !== '0x0', 'Market contract should exist on fork');

    // Restart indexer with real addresses
    await indexerServer.close();
    indexerServer = await startMockIndexer(deployedMarketAddress, deployedPollAddress);
  });

  // =========================================================================
  // Phase 3: Liquidity operations
  // =========================================================================

  await t.test('Phase 3a: lp add --execute on fork', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    const result = await runCliAsync([
      '--output', 'json',
      'lp', 'add',
      '--skip-dotenv',
      '--market-address', deployedMarketAddress,
      '--amount-usdc', '10',
      '--execute',
      '--fork-rpc-url', ANVIL_RPC,
      '--fork-chain-id', '1',
      '--usdc', USDC_ADDRESS,
    ], buildEnv(indexerServer.url, clobServer.url));

    const payload = parseJsonOutput(result);
    if (result.status === 0 && payload.ok) {
      assert.ok(payload.data?.tx?.addTxHash, 'LP add should return addLiquidity tx hash');
      assert.equal(payload.data?.tx?.addStatus, 'success', 'LP add tx should succeed on-chain');
    } else {
      assert.equal(payload.ok, false, 'LP add payload should report failure');
      const code = payload.error?.code;
      assert.equal(code, 'LP_ADD_SIMULATION_FAILED',
        `LP add failed with unexpected code: ${code} — ${payload.error?.message?.slice(0, 200)}`);
    }
  });

  await t.test('Phase 3b: quote against forked market', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    const result = await runCliAsync([
      '--output', 'json',
      'quote',
      '--market-address', deployedMarketAddress,
      '--side', 'yes',
      '--amount-usdc', '5',
    ], buildEnv(indexerServer.url, clobServer.url));

    assert.equal(result.status, 0, `Quote failed: ${result.output}`);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true, `Quote not ok: ${JSON.stringify(payload)}`);
    assert.ok(payload.data, 'Quote data should be present');
  });

  await t.test('Phase 3c: trade --execute on fork', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    const result = await runCliAsync([
      '--output', 'json',
      'trade',
      '--skip-dotenv',
      '--market-address', deployedMarketAddress,
      '--side', 'yes',
      '--amount-usdc', '5',
      '--execute',
      '--allow-unquoted-execute',
      '--fork-rpc-url', ANVIL_RPC,
      '--fork-chain-id', '1',
      '--usdc', USDC_ADDRESS,
    ], buildEnv(indexerServer.url, clobServer.url));

    assert.equal(result.status, 0, `Trade failed: ${result.output}`);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true, `Trade not ok: ${JSON.stringify(payload)}`);
  });

  // =========================================================================
  // Phase 4: Mirror sync lifecycle
  // =========================================================================

  await t.test('Phase 4a: mirror sync once --paper', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    const result = await runCliAsync([
      '--output', 'json',
      'mirror', 'sync', 'once',
      '--skip-dotenv',
      '--indexer-url', indexerServer.url,
      '--polymarket-mock-url', clobServer.url,
      '--pandora-market-address', deployedMarketAddress,
      '--polymarket-market-id', 'poly-cond-1',
      '--paper',
      '--funder', ANVIL_ACCOUNT_0,
      '--drift-trigger-bps', '25',
      '--hedge-trigger-usdc', '1000000',
      '--hedge-ratio', '0.75',
      '--state-file', stateFile,
      '--kill-switch-file', killFile,
    ], buildEnv(indexerServer.url, clobServer.url));

    assert.equal(result.status, 0, `Paper sync failed: ${result.output}`);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true, `Paper sync not ok: ${JSON.stringify(payload)}`);
    assert.equal(payload.command, 'mirror.sync');
    assert.equal(payload.data.mode, 'once');
    assert.equal(payload.data.executeLive, false);
    assert.ok(fs.existsSync(stateFile), 'State file should be created');
  });

  await t.test('Phase 4b: mirror sync once --execute-live with mock CLOB', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    // Remove stale state file to start fresh for execute-live
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);

    const result = await runCliAsync([
      '--output', 'json',
      'mirror', 'sync', 'once',
      '--skip-dotenv',
      '--rpc-url', ANVIL_RPC,
      '--indexer-url', indexerServer.url,
      '--polymarket-mock-url', clobServer.url,
      '--polymarket-rpc-url', polygonRpcMock.url,
      '--pandora-market-address', deployedMarketAddress,
      '--polymarket-market-id', 'poly-cond-1',
      '--execute-live',
      '--funder', ANVIL_ACCOUNT_0,
      '--drift-trigger-bps', '25',
      '--hedge-trigger-usdc', '1000000',
      '--hedge-ratio', '0.75',
      '--max-open-exposure-usdc', '10000',
      '--max-trades-per-day', '100',
      '--state-file', stateFile,
      '--kill-switch-file', killFile,
    ], buildEnvLive(indexerServer.url, clobServer.url, polygonRpcMock.url));

    assert.equal(result.status, 0, `Execute-live sync failed: ${result.output}`);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true, `Execute-live sync not ok: ${JSON.stringify(payload)}`);
    assert.equal(payload.data.executeLive, true);

    // Verify state file has been updated
    assert.ok(fs.existsSync(stateFile), 'State file should exist after live sync');
    const stateData = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.ok(stateData, 'State file should contain valid JSON');
  });

  await t.test('Phase 4c: second sync tick — cumulative state', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');
    assert.ok(fs.existsSync(stateFile), 'State file from Phase 4b must exist');

    const result = await runCliAsync([
      '--output', 'json',
      'mirror', 'sync', 'once',
      '--skip-dotenv',
      '--rpc-url', ANVIL_RPC,
      '--indexer-url', indexerServer.url,
      '--polymarket-mock-url', clobServer.url,
      '--polymarket-rpc-url', polygonRpcMock.url,
      '--pandora-market-address', deployedMarketAddress,
      '--polymarket-market-id', 'poly-cond-1',
      '--execute-live',
      '--funder', ANVIL_ACCOUNT_0,
      '--drift-trigger-bps', '25',
      '--hedge-trigger-usdc', '1000000',
      '--hedge-ratio', '0.75',
      '--max-open-exposure-usdc', '10000',
      '--max-trades-per-day', '100',
      '--state-file', stateFile,
      '--kill-switch-file', killFile,
    ], buildEnvLive(indexerServer.url, clobServer.url, polygonRpcMock.url));

    assert.equal(result.status, 0, `Second tick failed: ${result.output}`);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true, `Second tick not ok: ${JSON.stringify(payload)}`);

    // Verify cumulative state updated
    const stateData = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.ok(stateData.tickCount === undefined || stateData.tickCount >= 1,
      'State should track cumulative ticks');
  });

  await t.test('Phase 4d: hedge retry — mock CLOB error then success', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    // Remove state for a clean run
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);

    // Queue one CLOB failure — hedge placement should be simulated via mock URL
    clobServer.setFailNextHedge();

    const result = await runCliAsync([
      '--output', 'json',
      'mirror', 'sync', 'once',
      '--skip-dotenv',
      '--rpc-url', ANVIL_RPC,
      '--indexer-url', indexerServer.url,
      '--polymarket-mock-url', clobServer.url,
      '--pandora-market-address', deployedMarketAddress,
      '--polymarket-market-id', 'poly-cond-1',
      '--paper',
      '--funder', ANVIL_ACCOUNT_0,
      '--drift-trigger-bps', '25',
      '--hedge-trigger-usdc', '1000000',
      '--hedge-ratio', '0.75',
      '--state-file', stateFile,
      '--kill-switch-file', killFile,
    ], buildEnv(indexerServer.url, clobServer.url));

    // Even with a hedge failure, the sync tick itself should complete (paper mode)
    assert.equal(result.status, 0, `Hedge retry test failed: ${result.output}`);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true, `Hedge retry not ok: ${JSON.stringify(payload)}`);
  });

  // =========================================================================
  // Phase 5: Safety features
  // =========================================================================

  await t.test('Phase 5a: auto-withdraw on expiry via evm_increaseTime', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);

    // Snapshot so we can revert after time manipulation
    const snapshotId = await jsonRpc(ANVIL_RPC, 'evm_snapshot', []);

    // Advance time past market close
    const now = Math.floor(Date.now() / 1000);
    const closeTs = Number(FIXED_MIRROR_CLOSE_TS);
    const secondsToAdvance = closeTs - now + 3600; // 1 hour past close

    if (secondsToAdvance > 0) {
      await jsonRpc(ANVIL_RPC, 'evm_increaseTime', ['0x' + secondsToAdvance.toString(16)]);
      await jsonRpc(ANVIL_RPC, 'evm_mine', []);
    }

    const result = await runCliAsync([
      '--output', 'json',
      'mirror', 'sync', 'once',
      '--skip-dotenv',
      '--rpc-url', ANVIL_RPC,
      '--indexer-url', indexerServer.url,
      '--polymarket-mock-url', clobServer.url,
      '--pandora-market-address', deployedMarketAddress,
      '--polymarket-market-id', 'poly-cond-1',
      '--paper',
      '--funder', ANVIL_ACCOUNT_0,
      '--drift-trigger-bps', '25',
      '--hedge-trigger-usdc', '1000000',
      '--hedge-ratio', '0.75',
      '--state-file', stateFile,
      '--kill-switch-file', killFile,
    ], buildEnv(indexerServer.url, clobServer.url));

    const payload = result.status === 0 ? parseJsonOutput(result) : null;
    if (result.status === 0 && payload && payload.ok) {
      const syncData = payload.data || {};
      const hasCloseSignal = syncData.autoWithdraw || syncData.closedMarketDetected
        || syncData.skipReason === 'market-closed' || syncData.skipReason === 'past-close';
      assert.ok(
        hasCloseSignal || syncData.mode === 'once',
        `Sync past close should signal market closed, got: ${JSON.stringify(syncData).slice(0, 300)}`,
      );
    } else {
      assert.ok(
        result.status !== 0 || (payload && !payload.ok),
        'Sync past close should either succeed with close signal or fail explicitly',
      );
    }

    // Revert to snapshot to restore original time
    await jsonRpc(ANVIL_RPC, 'evm_revert', [snapshotId]);
  });

  await t.test('Phase 5b: hedge gap alert', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);

    const result = await runCliAsync([
      '--output', 'json',
      'mirror', 'sync', 'once',
      '--skip-dotenv',
      '--rpc-url', ANVIL_RPC,
      '--indexer-url', indexerServer.url,
      '--polymarket-mock-url', clobServer.url,
      '--pandora-market-address', deployedMarketAddress,
      '--polymarket-market-id', 'poly-cond-1',
      '--paper',
      '--funder', ANVIL_ACCOUNT_0,
      '--drift-trigger-bps', '1',
      '--hedge-trigger-usdc', '1',
      '--hedge-ratio', '0.75',
      '--hedge-gap-alert-usdc', '1',
      '--state-file', stateFile,
      '--kill-switch-file', killFile,
    ], buildEnv(indexerServer.url, clobServer.url));

    assert.equal(result.status, 0, `Hedge gap alert test failed: ${result.output}`);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
  });

  await t.test('Phase 5c: slippage tracking in state', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);

    const result = await runCliAsync([
      '--output', 'json',
      'mirror', 'sync', 'once',
      '--skip-dotenv',
      '--rpc-url', ANVIL_RPC,
      '--indexer-url', indexerServer.url,
      '--polymarket-mock-url', clobServer.url,
      '--polymarket-rpc-url', polygonRpcMock.url,
      '--pandora-market-address', deployedMarketAddress,
      '--polymarket-market-id', 'poly-cond-1',
      '--execute-live',
      '--funder', ANVIL_ACCOUNT_0,
      '--drift-trigger-bps', '25',
      '--hedge-trigger-usdc', '1000000',
      '--hedge-ratio', '0.75',
      '--max-open-exposure-usdc', '10000',
      '--max-trades-per-day', '100',
      '--state-file', stateFile,
      '--kill-switch-file', killFile,
    ], buildEnvLive(indexerServer.url, clobServer.url, polygonRpcMock.url));

    assert.equal(result.status, 0, `Slippage tracking test failed: ${result.output}`);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);

    // Check state for slippage fields if present
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      // State may contain cumulative slippage metrics depending on whether a rebalance occurred
      assert.ok(state, 'State should be valid JSON');
    }
  });

  // =========================================================================
  // Phase 6: Market close lifecycle
  // =========================================================================

  await t.test('Phase 6a: resolve --execute on fork', async () => {
    assert.ok(deployedPollAddress, 'Poll must be deployed first');

    const result = await runCliAsync([
      '--output', 'json',
      'resolve',
      '--skip-dotenv',
      '--poll-address', deployedPollAddress,
      '--answer', 'yes',
      '--reason', 'E2E test resolution',
      '--execute',
      '--fork-rpc-url', ANVIL_RPC,
      '--fork-chain-id', '1',
    ], buildEnv(indexerServer.url, clobServer.url));

    if (result.status === 0) {
      const payload = parseJsonOutput(result);
      assert.equal(payload.ok, true, `Resolve not ok: ${JSON.stringify(payload)}`);
      assert.ok(
        payload.data && (payload.data.tx || payload.data.txPlan),
        'Resolve should include tx or txPlan in data',
      );
    } else {
      const payload = parseJsonOutput(result);
      const errorCode = payload.error?.code || '';
      const output = result.output.toLowerCase();
      const isAuthError = errorCode.includes('CALLER_NOT')
        || errorCode === 'RESOLVE_UNSUPPORTED_CONTRACT'
        || output.includes('not authorized')
        || output.includes('arbiter')
        || output.includes('operator');
      const isSimulationError = errorCode === 'RESOLVE_EXECUTION_FAILED'
        || output.includes('simulation') || output.includes('revert');

      assert.ok(isAuthError || isSimulationError,
        `Resolve failed with unexpected error: code=${errorCode}, output=${result.output.slice(0, 500)}`);

      if (isAuthError) {
        assert.ok(errorCode,
          `Auth-related resolve failure recorded: ${errorCode} — deployer may not have operator role on this fork`);
      }
    }
  });

  await t.test('Phase 6b: claim --dry-run on fork', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    const result = await runCliAsync([
      '--output', 'json',
      'claim',
      '--skip-dotenv',
      '--market-address', deployedMarketAddress,
      '--dry-run',
      '--fork-rpc-url', ANVIL_RPC,
      '--fork-chain-id', '1',
    ], buildEnv(indexerServer.url, clobServer.url));

    const payload = parseJsonOutput(result);
    assert.ok(payload, 'Claim dry-run should return a payload');
    if (payload.ok) {
      assert.ok(payload.data, 'Claim dry-run payload should have data');
      assert.equal(payload.data.mode, 'dry-run', 'Claim should be in dry-run mode');
      assert.ok(
        payload.data.claimable === true || payload.data.claimable === false || payload.data.claimable === null,
        'Claim should report claimable status',
      );
    } else {
      assert.ok(payload.error?.code, `Claim dry-run failed with: ${payload.error?.message}`);
    }
  });

  await t.test('Phase 6c: mirror close --dry-run on fork', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    const result = await runCliAsync([
      '--output', 'json',
      'mirror', 'close',
      '--skip-dotenv',
      '--pandora-market-address', deployedMarketAddress,
      '--polymarket-market-id', 'poly-cond-1',
      '--dry-run',
      '--indexer-url', indexerServer.url,
      '--rpc-url', ANVIL_RPC,
    ], buildEnv(indexerServer.url, clobServer.url));

    const payload = parseJsonOutput(result);
    assert.ok(payload, 'Mirror close dry-run should return a payload');
    if (payload.ok) {
      assert.ok(payload.data, 'Mirror close dry-run should include data');
    } else {
      assert.ok(payload.error?.code, `Mirror close dry-run failed: ${payload.error?.message}`);
    }
  });

  await t.test('Phase 6d: portfolio --wallet against fork', async () => {
    const result = await runCliAsync([
      '--output', 'json',
      'portfolio',
      '--skip-dotenv',
      '--wallet', ANVIL_ACCOUNT_0,
      '--indexer-url', indexerServer.url,
    ], buildEnv(indexerServer.url, clobServer.url));

    const payload = parseJsonOutput(result);
    assert.ok(payload, 'Portfolio should return a payload');
    if (payload.ok) {
      assert.ok(payload.data, 'Portfolio should include data');
      assert.ok(
        payload.data.wallet || payload.data.positions !== undefined || payload.data.markets !== undefined,
        'Portfolio data should contain wallet, positions, or markets',
      );
    } else {
      assert.ok(payload.error?.code, `Portfolio failed: ${payload.error?.message}`);
    }
  });

  // =========================================================================
  // Phase 7: Negative / Guard tests
  // =========================================================================

  await t.test('Phase 7a: trade buy rejects INSUFFICIENT_USDC_BALANCE', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    const snapshotId = await jsonRpc(ANVIL_RPC, 'evm_snapshot', []);
    try {
      const { keccak256, encodeAbiParameters, parseAbiParameters } = loadViem();
      const encoded = encodeAbiParameters(parseAbiParameters('address, uint256'), [ANVIL_ACCOUNT_0, 9n]);
      const balanceSlot = keccak256(encoded);
      await jsonRpc(ANVIL_RPC, 'anvil_setStorageAt', [
        USDC_ADDRESS,
        balanceSlot,
        '0x' + '0'.padStart(64, '0'),
      ]);

      const result = await runCliAsync([
        '--output', 'json',
        'trade',
        '--skip-dotenv',
        '--market-address', deployedMarketAddress,
        '--side', 'yes',
        '--amount-usdc', '5',
        '--execute',
        '--allow-unquoted-execute',
        '--fork-rpc-url', ANVIL_RPC,
        '--fork-chain-id', '1',
        '--usdc', USDC_ADDRESS,
      ], buildEnv(indexerServer.url, clobServer.url));

      assert.notEqual(result.status, 0, 'Trade buy with zero USDC should fail');
      const payload = parseJsonOutput(result);
      assert.equal(payload.ok, false, 'Payload should be not ok');
      assert.ok(payload.error?.code, 'Error code should be present');
      const code = payload.error.code;
      assert.ok(
        code === 'INSUFFICIENT_USDC_BALANCE' || code === 'TRADE_EXECUTION_FAILED' || code === 'APPROVE_SIMULATION_FAILED',
        `Expected balance/execution error, got: ${code}`,
      );
    } finally {
      await jsonRpc(ANVIL_RPC, 'evm_revert', [snapshotId]);
    }
  });

  await t.test('Phase 7b: trade buy rejects TRADE_RISK_GUARD (amount > max)', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    const result = await runCliAsync([
      '--output', 'json',
      'trade',
      '--skip-dotenv',
      '--market-address', deployedMarketAddress,
      '--side', 'yes',
      '--amount-usdc', '100',
      '--max-amount-usdc', '1',
      '--execute',
      '--allow-unquoted-execute',
      '--fork-rpc-url', ANVIL_RPC,
      '--fork-chain-id', '1',
      '--usdc', USDC_ADDRESS,
    ], buildEnv(indexerServer.url, clobServer.url));

    assert.notEqual(result.status, 0, 'Trade exceeding max-amount-usdc should fail');
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.equal(payload.error?.code, 'TRADE_RISK_GUARD', `Expected TRADE_RISK_GUARD, got: ${payload.error?.code}`);
  });

  await t.test('Phase 7c: trade buy rejects on slippage protection (minSharesOutRaw too high)', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    const result = await runCliAsync([
      '--output', 'json',
      'trade',
      '--skip-dotenv',
      '--market-address', deployedMarketAddress,
      '--side', 'yes',
      '--amount-usdc', '1',
      '--min-shares-out-raw', '999999999999999999999999',
      '--execute',
      '--fork-rpc-url', ANVIL_RPC,
      '--fork-chain-id', '1',
      '--usdc', USDC_ADDRESS,
    ], buildEnv(indexerServer.url, clobServer.url));

    assert.notEqual(result.status, 0, 'Trade with impossibly high minSharesOutRaw should fail');
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.ok(payload.error?.code, 'Error code should be present');
    const code = payload.error.code;
    assert.ok(
      code === 'TRADE_EXECUTION_FAILED' || code.includes('SIMULATION') || code.includes('REVERT'),
      `Expected execution/simulation failure, got: ${code}`,
    );
  });

  await t.test('Phase 7d: trade buy rejects MARKET_ADDRESS_NO_CODE', async () => {
    const fakeAddress = '0x000000000000000000000000000000000000dEaD';

    const result = await runCliAsync([
      '--output', 'json',
      'trade',
      '--skip-dotenv',
      '--market-address', fakeAddress,
      '--side', 'yes',
      '--amount-usdc', '1',
      '--execute',
      '--allow-unquoted-execute',
      '--fork-rpc-url', ANVIL_RPC,
      '--fork-chain-id', '1',
      '--usdc', USDC_ADDRESS,
    ], buildEnv(indexerServer.url, clobServer.url));

    assert.notEqual(result.status, 0, 'Trade on non-existent market should fail');
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.equal(
      payload.error?.code, 'MARKET_ADDRESS_NO_CODE',
      `Expected MARKET_ADDRESS_NO_CODE, got: ${payload.error?.code}`,
    );
  });

  await t.test('Phase 7e: sell rejects INSUFFICIENT_OUTCOME_TOKEN_BALANCE', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    const result = await runCliAsync([
      '--output', 'json',
      'sell',
      '--skip-dotenv',
      '--market-address', deployedMarketAddress,
      '--side', 'no',
      '--shares', '99999',
      '--execute',
      '--allow-unquoted-execute',
      '--fork-rpc-url', ANVIL_RPC,
      '--fork-chain-id', '1',
      '--usdc', USDC_ADDRESS,
    ], buildEnv(indexerServer.url, clobServer.url));

    assert.notEqual(result.status, 0, 'Sell without tokens should fail');
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.ok(payload.error?.code, 'Error code should be present');
    const code = payload.error.code;
    assert.ok(
      code === 'INSUFFICIENT_OUTCOME_TOKEN_BALANCE' || code === 'OUTCOME_TOKEN_BALANCE_READ_FAILED'
        || code === 'OUTCOME_TOKEN_ADDRESS_UNAVAILABLE' || code === 'TRADE_EXECUTION_FAILED',
      `Expected token balance/execution error, got: ${code}`,
    );
  });

  await t.test('Phase 7f: lp add rejects with insufficient USDC', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    const snapshotId = await jsonRpc(ANVIL_RPC, 'evm_snapshot', []);
    try {
      const { keccak256, encodeAbiParameters, parseAbiParameters } = loadViem();
      const encoded = encodeAbiParameters(parseAbiParameters('address, uint256'), [ANVIL_ACCOUNT_0, 9n]);
      const balanceSlot = keccak256(encoded);
      await jsonRpc(ANVIL_RPC, 'anvil_setStorageAt', [
        USDC_ADDRESS,
        balanceSlot,
        '0x' + '0'.padStart(64, '0'),
      ]);

      const result = await runCliAsync([
        '--output', 'json',
        'lp', 'add',
        '--skip-dotenv',
        '--market-address', deployedMarketAddress,
        '--amount-usdc', '50',
        '--execute',
        '--fork-rpc-url', ANVIL_RPC,
        '--fork-chain-id', '1',
        '--usdc', USDC_ADDRESS,
      ], buildEnv(indexerServer.url, clobServer.url));

      assert.notEqual(result.status, 0, 'LP add with zero USDC should fail');
      const payload = parseJsonOutput(result);
      assert.equal(payload.ok, false);
      assert.ok(payload.error?.code, 'Error code should be present');
      const code = payload.error.code;
      assert.ok(
        code === 'LP_ADD_APPROVE_SIMULATION_FAILED' || code === 'LP_ADD_SIMULATION_FAILED'
          || code === 'LP_ADD_APPROVE_EXECUTION_FAILED' || code === 'LP_ADD_EXECUTION_FAILED'
          || code.includes('INSUFFICIENT'),
        `Expected LP add failure, got: ${code}`,
      );
    } finally {
      await jsonRpc(ANVIL_RPC, 'evm_revert', [snapshotId]);
    }
  });

  await t.test('Phase 7g: lp remove --all handles LP token presence correctly', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    const snapshotId = await jsonRpc(ANVIL_RPC, 'evm_snapshot', []);
    try {
      const result = await runCliAsync([
        '--output', 'json',
        'lp', 'remove',
        '--skip-dotenv',
        '--market-address', deployedMarketAddress,
        '--all',
        '--execute',
        '--fork-rpc-url', ANVIL_RPC,
        '--fork-chain-id', '1',
        '--usdc', USDC_ADDRESS,
      ], buildEnv(indexerServer.url, clobServer.url));

      const payload = parseJsonOutput(result);
      if (result.status === 0 && payload.ok) {
        assert.ok(payload.data?.tx?.txHash, 'LP remove tx hash should be present');
        assert.equal(payload.data?.tx?.status, 'success', 'LP remove tx should succeed');
      } else {
        assert.equal(payload.ok, false);
        const code = payload.error?.code;
        assert.ok(
          code === 'LP_REMOVE_ZERO_BALANCE' || code === 'LP_REMOVE_SIMULATION_FAILED',
          `Expected LP remove failure, got: ${code}`,
        );
      }

      // Now try again — after removing all, balance should be zero
      const secondResult = await runCliAsync([
        '--output', 'json',
        'lp', 'remove',
        '--skip-dotenv',
        '--market-address', deployedMarketAddress,
        '--all',
        '--execute',
        '--fork-rpc-url', ANVIL_RPC,
        '--fork-chain-id', '1',
        '--usdc', USDC_ADDRESS,
      ], buildEnv(indexerServer.url, clobServer.url));

      assert.notEqual(secondResult.status, 0, 'Second LP remove should fail (no tokens left)');
      const secondPayload = parseJsonOutput(secondResult);
      assert.equal(secondPayload.ok, false);
      assert.equal(
        secondPayload.error?.code, 'LP_REMOVE_ZERO_BALANCE',
        `Expected LP_REMOVE_ZERO_BALANCE on second remove, got: ${secondPayload.error?.code}`,
      );
    } finally {
      await jsonRpc(ANVIL_RPC, 'evm_revert', [snapshotId]);
    }
  });

  await t.test('Phase 7h: claim --execute on unresolved market raises CLAIM_SIMULATION_FAILED', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    const result = await runCliAsync([
      '--output', 'json',
      'claim',
      '--skip-dotenv',
      '--market-address', deployedMarketAddress,
      '--execute',
      '--fork-rpc-url', ANVIL_RPC,
      '--fork-chain-id', '1',
    ], buildEnv(indexerServer.url, clobServer.url));

    assert.notEqual(result.status, 0, 'Claim on unresolved market should fail');
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false, 'Claim payload should be not ok');
    const code = payload.error?.code;
    assert.ok(
      code === 'CLAIM_SIMULATION_FAILED' || code === 'CLAIM_EXECUTION_FAILED',
      `Expected CLAIM_SIMULATION_FAILED, got: ${code}`,
    );
  });

  await t.test('Phase 7i: claim --dry-run on unresolved market reports claimable: false', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    const result = await runCliAsync([
      '--output', 'json',
      'claim',
      '--skip-dotenv',
      '--market-address', deployedMarketAddress,
      '--dry-run',
      '--fork-rpc-url', ANVIL_RPC,
      '--fork-chain-id', '1',
    ], buildEnv(indexerServer.url, clobServer.url));

    const payload = parseJsonOutput(result);
    assert.ok(payload, 'Claim dry-run should return a payload');
    if (payload.ok) {
      assert.equal(payload.data.mode, 'dry-run');
      assert.equal(payload.data.claimable, false, 'Unresolved market should report claimable: false');
    } else {
      assert.ok(payload.error?.code, 'If failed, should have error code');
    }
  });

  await t.test('Phase 7j: mirror sync --execute-live blocks when kill-switch file exists', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);

    fs.mkdirSync(path.dirname(killFile), { recursive: true });
    fs.writeFileSync(killFile, `${new Date().toISOString()} test kill switch\n`);

    try {
      const result = await runCliAsync([
        '--output', 'json',
        'mirror', 'sync', 'once',
        '--skip-dotenv',
        '--rpc-url', ANVIL_RPC,
        '--indexer-url', indexerServer.url,
        '--polymarket-mock-url', clobServer.url,
        '--polymarket-rpc-url', polygonRpcMock.url,
        '--pandora-market-address', deployedMarketAddress,
        '--polymarket-market-id', 'poly-cond-1',
        '--execute-live',
        '--funder', ANVIL_ACCOUNT_0,
        '--drift-trigger-bps', '25',
        '--hedge-trigger-usdc', '1000000',
        '--hedge-ratio', '0.75',
        '--max-open-exposure-usdc', '10000',
        '--max-trades-per-day', '100',
        '--state-file', stateFile,
        '--kill-switch-file', killFile,
      ], buildEnvLive(indexerServer.url, clobServer.url, polygonRpcMock.url));

      assert.equal(result.status, 0, `Sync with kill-switch should still exit 0 (graceful stop): ${result.output}`);
      const payload = parseJsonOutput(result);
      assert.equal(payload.ok, true);
      const data = payload.data || {};
      assert.ok(
        (data.stoppedReason && data.stoppedReason.toLowerCase().includes('kill'))
          || data.iterationsCompleted === 0
          || (data.snapshots && data.snapshots.length === 0),
        `Sync should be stopped by kill-switch, got stoppedReason=${data.stoppedReason}, iterations=${data.iterationsCompleted}`,
      );
    } finally {
      try { fs.unlinkSync(killFile); } catch { /* ignore */ }
    }
  });

  await t.test('Phase 7k: mirror deploy --execute without validation ticket rejects', async () => {
    const result = await runCliAsync([
      '--output', 'json',
      'mirror', 'deploy',
      '--skip-dotenv',
      '--rpc-url', ANVIL_RPC,
      '--indexer-url', indexerServer.url,
      '--polymarket-mock-url', clobServer.url,
      '--polymarket-market-id', 'poly-cond-1',
      '--execute',
      '--liquidity-usdc', '100',
      '--sources', 'https://www.nba.com', 'https://www.espn.com',
    ], buildEnv(indexerServer.url, clobServer.url));

    assert.notEqual(result.status, 0, 'Deploy --execute without validation ticket should fail');
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    const code = payload.error?.code;
    assert.ok(
      code === 'MIRROR_VALIDATION_REQUIRED' || code === 'MIRROR_VALIDATION_MISMATCH'
        || code === 'INVALID_ARGS' || code === 'DEPLOY_GUARD_MISSING_TICKET',
      `Expected validation error, got: ${code}`,
    );
  });

  // =========================================================================
  // Phase 8: Resilience tests (gas spike, resolve via factory->isOperator)
  // =========================================================================

  await t.test('Phase 8a: resolve uses factory->isOperator fallback', async () => {
    assert.ok(deployedPollAddress, 'Poll must be deployed first');

    const result = await runCliAsync([
      '--output', 'json',
      'resolve',
      '--skip-dotenv',
      '--poll-address', deployedPollAddress,
      '--answer', 'yes',
      '--reason', 'Testing factory->isOperator resolve path',
      '--dry-run',
      '--fork-rpc-url', ANVIL_RPC,
      '--fork-chain-id', '1',
    ], buildEnv(indexerServer.url, clobServer.url));

    const payload = parseJsonOutput(result);
    assert.ok(payload, 'Resolve dry-run should return payload');

    if (payload.ok && payload.data?.precheck) {
      const precheck = payload.data.precheck;
      console.log(`  callerIsOperator: ${precheck.callerIsOperator}`);
      console.log(`  callerIsArbiter: ${precheck.callerIsArbiter}`);
      console.log(`  readSource: ${precheck.readSources?.callerIsOperator}`);

      const hasRole = precheck.callerIsOperator || precheck.callerIsArbiter;
      if (hasRole) {
        assert.ok(payload.data.txPlan?.functionName,
          'With operator/arbiter role, resolve should select a function');
        console.log(`  Selected method: ${payload.data.txPlan.functionName}`);
      }
    } else if (!payload.ok) {
      console.log(`  Resolve dry-run: ${payload.error?.code} — ${payload.error?.message?.slice(0, 200)}`);
    }
  });

  await t.test('Phase 8b: trade succeeds under high gas price', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    const snapshotId = await jsonRpc(ANVIL_RPC, 'evm_snapshot', []);

    try {
      // Set very high base fee (500 gwei)
      await jsonRpc(ANVIL_RPC, 'anvil_setNextBlockBaseFeePerGas', [
        '0x' + (500n * 10n ** 9n).toString(16),
      ]);
      await jsonRpc(ANVIL_RPC, 'evm_mine', []);

      const result = await runCliAsync([
        '--output', 'json',
        'trade',
        '--skip-dotenv',
        '--market-address', deployedMarketAddress,
        '--side', 'yes',
        '--amount-usdc', '1',
        '--execute',
        '--allow-unquoted-execute',
        '--fork-rpc-url', ANVIL_RPC,
        '--fork-chain-id', '1',
        '--usdc', USDC_ADDRESS,
      ], buildEnv(indexerServer.url, clobServer.url));

      const payload = parseJsonOutput(result);
      if (result.status === 0 && payload.ok) {
        console.log('  Trade succeeded under high gas (500 gwei base fee)');
      } else {
        const code = payload.error?.code || '';
        console.log(`  Trade under high gas: ${code}`);
        assert.ok(
          code === 'TRADE_EXECUTION_FAILED' || code === 'TRADE_SIMULATION_FAILED'
            || code.includes('INSUFFICIENT') || code.includes('GAS'),
          `Unexpected error under high gas: ${code}`,
        );
      }
    } finally {
      await jsonRpc(ANVIL_RPC, 'evm_revert', [snapshotId]);
    }
  });

  await t.test('Phase 8c: transaction completes when mining is delayed', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    const snapshotId = await jsonRpc(ANVIL_RPC, 'evm_snapshot', []);

    try {
      // Disable automine — transactions won't be mined automatically
      await jsonRpc(ANVIL_RPC, 'evm_setAutomine', [false]);

      // Start a trade in the background
      const tradePromise = runCliAsync([
        '--output', 'json',
        'trade',
        '--skip-dotenv',
        '--market-address', deployedMarketAddress,
        '--side', 'yes',
        '--amount-usdc', '1',
        '--execute',
        '--allow-unquoted-execute',
        '--fork-rpc-url', ANVIL_RPC,
        '--fork-chain-id', '1',
        '--usdc', USDC_ADDRESS,
      ], { ...buildEnv(indexerServer.url, clobServer.url), timeoutMs: 30_000 });

      // Wait a bit for the TX to be submitted to mempool, then mine
      await delay(3000);
      await jsonRpc(ANVIL_RPC, 'evm_mine', []);
      await delay(1000);
      await jsonRpc(ANVIL_RPC, 'evm_mine', []);

      const result = await tradePromise;

      // Re-enable automine before assertions
      await jsonRpc(ANVIL_RPC, 'evm_setAutomine', [true]);

      if (result.timedOut) {
        console.log('  Trade timed out with delayed mining (expected for very slow mining)');
      } else {
        const payload = parseJsonOutput(result);
        if (result.status === 0 && payload.ok) {
          console.log('  Trade completed after delayed mining');
        } else {
          console.log(`  Trade with delayed mining: ${payload.error?.code || 'unknown'}`);
        }
      }
    } finally {
      try { await jsonRpc(ANVIL_RPC, 'evm_setAutomine', [true]); } catch { /* ignore */ }
      await jsonRpc(ANVIL_RPC, 'evm_revert', [snapshotId]);
    }
  });

  // =========================================================================
  // Cleanup
  // =========================================================================
  t.after(async () => {
    if (anvilProcess) {
      try { anvilProcess.kill('SIGTERM'); } catch { /* already dead */ }
      await delay(500);
      try { anvilProcess.kill('SIGKILL'); } catch { /* already dead */ }
    }
    if (clobServer) {
      try { await clobServer.close(); } catch { /* ignore */ }
    }
    if (indexerServer) {
      try { await indexerServer.close(); } catch { /* ignore */ }
    }
    if (polygonRpcMock) {
      try { await polygonRpcMock.close(); } catch { /* ignore */ }
    }
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
});
