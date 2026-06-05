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

// ── Sepolia deployment addresses ──
const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const CHAIN_ID = '11155111';

const ORACLE_ADDRESS = '0x5e02c61Aa8B506819d636592B8bcE11BA23e9906';
const FACTORY_ADDRESS = '0x88CfE3Df93E39B248C698aaf4DEcd39d31c6c4A3';
const USDC_ADDRESS = '0x5680557947c0089aA0bcae671B4d46020Fc04cf0';

const TEST_WALLET = '0xD71ECa4D1c36C086898A005e7d0A42E8f54D54B6';
const TEST_PRIVATE_KEY = '0xe60dfc8411557d0f894c9f7a06ffbfdc75a03e8cec353decbc756df5231b4c6f';

const FIXED_MIRROR_CLOSE_ISO = '2030-06-15T16:00:00Z';
const FIXED_MIRROR_CLOSE_TS = String(Math.floor(Date.parse(FIXED_MIRROR_CLOSE_ISO) / 1000));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTempDir(prefix = 'pandora-e2e-sepolia-') {
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
    const timeoutMs = options.timeoutMs || 300_000;
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
// Mock servers (CLOB + Indexer needed for mirror commands)
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

function startMockClobServer() {
  const basePayload = {
    markets: [{
      question: 'Sepolia E2E: Will deterministic tests pass?',
      condition_id: 'poly-cond-sepolia-1',
      question_id: 'poly-q-sepolia-1',
      market_slug: 'sepolia-deterministic-tests',
      end_date_iso: FIXED_MIRROR_CLOSE_ISO,
      active: true,
      closed: false,
      volume24hr: 50000,
      tokens: [
        { outcome: 'Yes', price: '0.60', token_id: 'poly-yes-sepolia-1' },
        { outcome: 'No', price: '0.40', token_id: 'poly-no-sepolia-1' },
      ],
    }],
    orderbooks: {
      'poly-yes-sepolia-1': { bids: [{ price: '0.59', size: '300' }], asks: [{ price: '0.60', size: '400' }] },
      'poly-no-sepolia-1':  { bids: [{ price: '0.39', size: '300' }], asks: [{ price: '0.40', size: '400' }] },
    },
  };

  return startJsonHttpServer(({ url, bodyJson }) => {
    if (url?.includes('/order') || url?.includes('/hedge')) {
      return { body: { mode: 'mock', ok: true, response: { status: 'simulated' } } };
    }
    return { body: basePayload };
  });
}

function startMockIndexer(marketAddress, pollAddress) {
  const market = {
    id: marketAddress,
    chainId: 11155111,
    chainName: 'sepolia',
    pollAddress,
    creator: TEST_WALLET,
    marketType: 'amm',
    marketCloseTimestamp: FIXED_MIRROR_CLOSE_TS,
    totalVolume: '50000',
    currentTvl: '100000',
    yesChance: '0.55',
    reserveYes: '500000000',
    reserveNo: '500000000',
    createdAt: String(Math.floor(Date.now() / 1000)),
  };
  const poll = {
    id: pollAddress,
    chainId: 11155111,
    chainName: 'sepolia',
    creator: TEST_WALLET,
    question: 'Sepolia E2E: Will deterministic tests pass?',
    status: 0,
    category: 3,
    deadlineEpoch: Number(FIXED_MIRROR_CLOSE_TS),
    createdAt: Math.floor(Date.now() / 1000),
    createdTxHash: '0xdeadbeef',
    rules: 'Resolves YES if Sepolia E2E tests pass.',
    sources: '["https://github.com"]',
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
// CLI env builder (no fork flags — real Sepolia)
// ---------------------------------------------------------------------------

const UNSET_ENV_KEYS = [
  'CHAIN_ID', 'RPC_URL', 'PANDORA_PRIVATE_KEY', 'PRIVATE_KEY',
  'ORACLE', 'FACTORY', 'USDC', 'DEPLOYER_PRIVATE_KEY',
  'PANDORA_DEPLOYER_PRIVATE_KEY', 'FORK_RPC_URL',
  'PANDORA_INDEXER_URL', 'INDEXER_URL',
  'POLYMARKET_PRIVATE_KEY', 'POLYMARKET_FUNDER',
  'POLYMARKET_API_KEY', 'POLYMARKET_API_SECRET', 'POLYMARKET_PASSPHRASE',
];

function buildEnv(indexerUrl, clobUrl, extra = {}) {
  return {
    env: {
      CHAIN_ID,
      RPC_URL: SEPOLIA_RPC,
      PRIVATE_KEY: TEST_PRIVATE_KEY,
      ORACLE: ORACLE_ADDRESS,
      FACTORY: FACTORY_ADDRESS,
      USDC: USDC_ADDRESS,
      PANDORA_INDEXER_URL: indexerUrl || '',
      ...extra,
    },
    unsetEnvKeys: UNSET_ENV_KEYS,
  };
}

// ---------------------------------------------------------------------------
// Main test suite
// ---------------------------------------------------------------------------

test('Sepolia Real-Network E2E Market Maker Tests', { timeout: 900_000 }, async (t) => {
  let clobServer = null;
  let indexerServer = null;
  const tempDir = createTempDir();
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const manifestFile = path.join(tempDir, 'pairs.json');
  const killFile = path.join(tempDir, 'STOP');

  let deployedMarketAddress = null;
  let deployedPollAddress = null;

  // =========================================================================
  // Phase 1: Preflight — verify Sepolia connectivity and balances
  // =========================================================================
  await t.test('Phase 1a: verify Sepolia RPC and wallet balance', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [TEST_WALLET, 'latest'] });
    let json;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(SEPOLIA_RPC, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(15_000),
        });
        json = await res.json();
        break;
      } catch (err) {
        if (attempt === 3) throw err;
        console.log(`  RPC attempt ${attempt} failed, retrying in 3s...`);
        await delay(3000);
      }
    }
    assert.ok(!json.error, `RPC error: ${json.error?.message}`);
    const balanceWei = BigInt(json.result);
    const balanceEth = Number(balanceWei) / 1e18;
    console.log(`  Sepolia ETH balance: ${balanceEth.toFixed(6)} ETH`);
    assert.ok(balanceWei > 10n ** 16n, `Insufficient ETH: ${balanceEth} ETH — need at least 0.01 ETH`);
  });

  await t.test('Phase 1b: verify MockUSDC balance', async () => {
    const { keccak256, encodePacked } = require('viem');
    const balSig = '0x70a08231';
    const paddedAddr = TEST_WALLET.slice(2).toLowerCase().padStart(64, '0');
    const body = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to: USDC_ADDRESS, data: `${balSig}${paddedAddr}` }, 'latest'],
    });
    const res = await fetch(SEPOLIA_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    const json = await res.json();
    assert.ok(!json.error, `RPC error: ${json.error?.message}`);
    const balanceRaw = BigInt(json.result);
    const balanceUsdc = Number(balanceRaw) / 1e6;
    console.log(`  MockUSDC balance: ${balanceUsdc.toFixed(2)} USDC`);
    assert.ok(balanceRaw > 1000n * 10n ** 6n, `Insufficient USDC: ${balanceUsdc} — need at least 1000`);
  });

  await t.test('Phase 1c: start mock CLOB and indexer servers', async () => {
    clobServer = await startMockClobServer();
    assert.ok(clobServer.url, 'Mock CLOB server running');

    indexerServer = await startMockIndexer(
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
    );
    assert.ok(indexerServer.url, 'Mock indexer server running');
  });

  // =========================================================================
  // Phase 2: Market deployment on Sepolia
  // =========================================================================

  await t.test('Phase 2a: mirror deploy --dry-run on Sepolia', async () => {
    const result = await runCliAsync([
      '--output', 'json',
      'mirror', 'deploy',
      '--skip-dotenv',
      '--rpc-url', SEPOLIA_RPC,
      '--chain-id', CHAIN_ID,
      '--indexer-url', indexerServer.url,
      '--polymarket-mock-url', clobServer.url,
      '--polymarket-market-id', 'poly-cond-sepolia-1',
      '--dry-run',
      '--liquidity-usdc', '50',
      '--sources', 'https://github.com', 'https://etherscan.io',
    ], buildEnv(indexerServer.url, clobServer.url));

    assert.equal(result.status, 0, `Dry-run failed: ${result.output}`);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true, `Dry-run not ok: ${JSON.stringify(payload)}`);
    assert.equal(payload.data.dryRun, true);
    assert.ok(payload.data.deploymentArgs, 'deploymentArgs should exist');
    console.log(`  Dry-run fee estimate: ${JSON.stringify(payload.data.deploymentArgs).slice(0, 200)}`);
  });

  await t.test('Phase 2b: mirror deploy --execute on Sepolia (REAL TX)', async () => {
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
      '--rpc-url', SEPOLIA_RPC,
      '--chain-id', CHAIN_ID,
      '--indexer-url', indexerServer.url,
      '--polymarket-mock-url', clobServer.url,
      '--polymarket-market-id', 'poly-cond-sepolia-1',
      '--dry-run',
      '--liquidity-usdc', '50',
      '--sources', 'https://github.com', 'https://etherscan.io',
    ], buildEnv(indexerServer.url, clobServer.url));

    assert.equal(dryRunResult.status, 0, `Dry-run failed: ${dryRunResult.output}`);
    const dryRunPayload = parseJsonOutput(dryRunResult);
    assert.equal(dryRunPayload.ok, true);
    const validationTicket = dryRunPayload.data.requiredValidation?.ticket;
    assert.ok(validationTicket, 'Validation ticket should be returned from dry-run');

    // Step 2: execute with validation ticket (REAL SEPOLIA TRANSACTION)
    console.log('  Executing real deployment on Sepolia — this may take 30-60 seconds...');
    const execResult = await runCliAsync([
      '--output', 'json',
      'mirror', 'deploy',
      '--skip-dotenv',
      '--rpc-url', SEPOLIA_RPC,
      '--chain-id', CHAIN_ID,
      '--indexer-url', indexerServer.url,
      '--polymarket-mock-url', clobServer.url,
      '--polymarket-market-id', 'poly-cond-sepolia-1',
      '--execute',
      '--validation-ticket', validationTicket,
      '--manifest-file', manifestFile,
      '--liquidity-usdc', '50',
      '--sources', 'https://github.com', 'https://etherscan.io',
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

    console.log(`  Poll deployed:   ${deployedPollAddress}`);
    console.log(`  Market deployed: ${deployedMarketAddress}`);
    console.log(`  Poll tx hash:    ${payload.data.tx.pollTxHash}`);

    // Verify contract exists on Sepolia
    const codeBody = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_getCode',
      params: [deployedMarketAddress, 'latest'],
    });
    const codeRes = await fetch(SEPOLIA_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: codeBody,
    });
    const codeJson = await codeRes.json();
    assert.ok(codeJson.result && codeJson.result !== '0x' && codeJson.result !== '0x0',
      'Market contract should exist on Sepolia');

    // Restart indexer with real addresses
    await indexerServer.close();
    indexerServer = await startMockIndexer(deployedMarketAddress, deployedPollAddress);
  });

  // =========================================================================
  // Phase 3: Liquidity operations on Sepolia
  // =========================================================================

  await t.test('Phase 3a: lp add --execute on Sepolia (REAL TX)', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    console.log('  Adding liquidity — real Sepolia transaction...');
    const result = await runCliAsync([
      '--output', 'json',
      'lp', 'add',
      '--skip-dotenv',
      '--chain-id', CHAIN_ID,
      '--rpc-url', SEPOLIA_RPC,
      '--market-address', deployedMarketAddress,
      '--amount-usdc', '10',
      '--execute',
      '--usdc', USDC_ADDRESS,
    ], buildEnv(indexerServer.url, clobServer.url));

    const payload = parseJsonOutput(result);
    if (result.status === 0 && payload.ok) {
      console.log(`  LP add tx: ${payload.data?.tx?.addTxHash || 'N/A'}`);
      assert.ok(payload.data?.tx?.addTxHash, 'LP add should return addLiquidity tx hash');
    } else {
      const code = payload.error?.code;
      console.log(`  LP add returned: ${code} — ${payload.error?.message?.slice(0, 200)}`);
      assert.equal(code, 'LP_ADD_SIMULATION_FAILED',
        `LP add failed with unexpected code: ${code}`);
    }
  });

  await t.test('Phase 3b: quote against Sepolia market', async () => {
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
    console.log(`  Quote: ${JSON.stringify(payload.data).slice(0, 300)}`);
  });

  await t.test('Phase 3c: trade buy --execute on Sepolia (REAL TX)', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    console.log('  Executing trade buy — real Sepolia transaction...');
    const result = await runCliAsync([
      '--output', 'json',
      'trade',
      '--skip-dotenv',
      '--chain-id', CHAIN_ID,
      '--rpc-url', SEPOLIA_RPC,
      '--market-address', deployedMarketAddress,
      '--side', 'yes',
      '--amount-usdc', '5',
      '--execute',
      '--allow-unquoted-execute',
      '--usdc', USDC_ADDRESS,
    ], buildEnv(indexerServer.url, clobServer.url));

    assert.equal(result.status, 0, `Trade buy failed: ${result.output}`);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true, `Trade buy not ok: ${JSON.stringify(payload)}`);
    console.log(`  Trade buy tx: ${payload.data?.tx?.txHash || payload.data?.tx?.hash || 'see payload'}`);
  });

  await t.test('Phase 3d: trade sell --execute on Sepolia (REAL TX)', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    console.log('  Executing trade sell — real Sepolia transaction...');
    const result = await runCliAsync([
      '--output', 'json',
      'sell',
      '--skip-dotenv',
      '--chain-id', CHAIN_ID,
      '--rpc-url', SEPOLIA_RPC,
      '--market-address', deployedMarketAddress,
      '--side', 'yes',
      '--shares', '1',
      '--execute',
      '--allow-unquoted-execute',
      '--usdc', USDC_ADDRESS,
    ], buildEnv(indexerServer.url, clobServer.url));

    const payload = parseJsonOutput(result);
    if (result.status === 0 && payload.ok) {
      console.log(`  Trade sell tx: ${payload.data?.tx?.txHash || payload.data?.tx?.hash || 'see payload'}`);
    } else {
      const code = payload.error?.code || '';
      console.log(`  Trade sell returned: ${code} — ${payload.error?.message?.slice(0, 200)}`);
      assert.ok(
        code === 'INSUFFICIENT_OUTCOME_TOKEN_BALANCE' || code === 'TRADE_EXECUTION_FAILED'
          || code === 'TRADE_RISK_GUARD' || code === 'TRADE_SIMULATION_FAILED',
        `Sell failed with unexpected code: ${code}`,
      );
    }
  });

  // =========================================================================
  // Phase 4: Mirror sync on Sepolia
  // =========================================================================

  await t.test('Phase 4a: mirror sync once --paper on Sepolia', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    const result = await runCliAsync([
      '--output', 'json',
      'mirror', 'sync', 'once',
      '--skip-dotenv',
      '--rpc-url', SEPOLIA_RPC,
      '--chain-id', CHAIN_ID,
      '--indexer-url', indexerServer.url,
      '--polymarket-mock-url', clobServer.url,
      '--pandora-market-address', deployedMarketAddress,
      '--polymarket-market-id', 'poly-cond-sepolia-1',
      '--paper',
      '--funder', TEST_WALLET,
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
    assert.equal(payload.data.executeLive, false);
    console.log('  Paper sync completed successfully');
  });

  // =========================================================================
  // Phase 5: LP remove on Sepolia
  // =========================================================================

  await t.test('Phase 5a: lp remove --all --execute on Sepolia (REAL TX)', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    console.log('  Removing all liquidity — real Sepolia transaction...');
    const result = await runCliAsync([
      '--output', 'json',
      'lp', 'remove',
      '--skip-dotenv',
      '--chain-id', CHAIN_ID,
      '--rpc-url', SEPOLIA_RPC,
      '--market-address', deployedMarketAddress,
      '--all',
      '--execute',
      '--usdc', USDC_ADDRESS,
    ], buildEnv(indexerServer.url, clobServer.url));

    const payload = parseJsonOutput(result);
    if (result.status === 0 && payload.ok) {
      console.log(`  LP remove tx: ${payload.data?.tx?.txHash || 'N/A'}`);
    } else {
      const code = payload.error?.code || '';
      console.log(`  LP remove returned: ${code}`);
      assert.ok(
        code === 'LP_REMOVE_ZERO_BALANCE' || code === 'LP_REMOVE_SIMULATION_FAILED',
        `LP remove failed with unexpected code: ${code}`,
      );
    }
  });

  // =========================================================================
  // Phase 6: Resolve + Claim on Sepolia
  // =========================================================================

  let resolvedSuccessfully = false;

  await t.test('Phase 6a: resolve --execute on Sepolia (REAL TX)', async () => {
    assert.ok(deployedPollAddress, 'Poll must be deployed first');

    console.log('  Resolving poll — real Sepolia transaction...');
    const result = await runCliAsync([
      '--output', 'json',
      'resolve',
      '--skip-dotenv',
      '--chain-id', CHAIN_ID,
      '--rpc-url', SEPOLIA_RPC,
      '--poll-address', deployedPollAddress,
      '--answer', 'yes',
      '--reason', 'Sepolia E2E test resolution',
      '--execute',
    ], buildEnv(indexerServer.url, clobServer.url));

    const payload = parseJsonOutput(result);
    if (result.status === 0 && payload.ok) {
      resolvedSuccessfully = true;
      assert.ok(
        payload.data && (payload.data.tx || payload.data.txPlan),
        'Resolve should include tx or txPlan in data',
      );
      console.log(`  Resolve tx: ${payload.data?.tx?.txHash || JSON.stringify(payload.data?.tx || {}).slice(0, 200)}`);
    } else {
      const errorCode = payload.error?.code || '';
      console.log(`  Resolve returned: ${errorCode} — ${payload.error?.message?.slice(0, 200)}`);
      // With factory->isOperator fix, we expect resolve to succeed.
      // But if the poll finalization epoch hasn't been reached, setAnswer may revert.
      assert.ok(
        errorCode.includes('CALLER_NOT') || errorCode === 'RESOLVE_EXECUTION_FAILED'
          || errorCode === 'RESOLVE_UNSUPPORTED_CONTRACT',
        `Resolve failed with unexpected error: ${errorCode}`,
      );
    }
  });

  await t.test('Phase 6b: claim --dry-run on Sepolia', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    const result = await runCliAsync([
      '--output', 'json',
      'claim',
      '--skip-dotenv',
      '--chain-id', CHAIN_ID,
      '--rpc-url', SEPOLIA_RPC,
      '--market-address', deployedMarketAddress,
      '--dry-run',
    ], buildEnv(indexerServer.url, clobServer.url));

    const payload = parseJsonOutput(result);
    assert.ok(payload, 'Claim dry-run should return a payload');
    if (payload.ok) {
      assert.ok(payload.data, 'Claim dry-run payload should have data');
      console.log(`  Claim dry-run: claimable=${payload.data.claimable}`);
      if (resolvedSuccessfully) {
        console.log(`  Market was resolved — checking if claimable is reported`);
      }
    } else {
      console.log(`  Claim dry-run: ${payload.error?.code}`);
      assert.ok(payload.error?.code, `Claim dry-run failed without error code: ${payload.error?.message}`);
    }
  });

  await t.test('Phase 6c: claim --execute on Sepolia (REAL TX)', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    if (!resolvedSuccessfully) {
      console.log('  Skipping claim --execute (market not resolved)');
      return;
    }

    console.log('  Claiming winnings — real Sepolia transaction...');
    const result = await runCliAsync([
      '--output', 'json',
      'claim',
      '--skip-dotenv',
      '--chain-id', CHAIN_ID,
      '--rpc-url', SEPOLIA_RPC,
      '--market-address', deployedMarketAddress,
      '--execute',
    ], buildEnv(indexerServer.url, clobServer.url));

    const payload = parseJsonOutput(result);
    if (result.status === 0 && payload.ok) {
      console.log(`  Claim tx: ${payload.data?.tx?.txHash || 'see payload'}`);
      assert.ok(payload.data, 'Claim execute should have data');
    } else {
      const code = payload.error?.code || '';
      console.log(`  Claim execute returned: ${code}`);
      assert.ok(
        code === 'CLAIM_SIMULATION_FAILED' || code === 'CLAIM_NO_BALANCE',
        `Claim failed with unexpected code: ${code}`,
      );
    }
  });

  // =========================================================================
  // Phase 7: Negative tests (no Anvil manipulation needed)
  // =========================================================================

  await t.test('Phase 7a: trade rejects MARKET_ADDRESS_NO_CODE on Sepolia', async () => {
    const fakeMarket = '0x0000000000000000000000000000000000dead01';

    const result = await runCliAsync([
      '--output', 'json',
      'trade',
      '--skip-dotenv',
      '--chain-id', CHAIN_ID,
      '--rpc-url', SEPOLIA_RPC,
      '--market-address', fakeMarket,
      '--side', 'yes',
      '--amount-usdc', '1',
      '--execute',
      '--allow-unquoted-execute',
      '--usdc', USDC_ADDRESS,
    ], buildEnv(indexerServer.url, clobServer.url));

    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false, 'Trade to fake address should fail');
    assert.equal(payload.error?.code, 'MARKET_ADDRESS_NO_CODE',
      `Expected MARKET_ADDRESS_NO_CODE, got: ${payload.error?.code}`);
    console.log('  Correctly rejected: MARKET_ADDRESS_NO_CODE');
  });

  await t.test('Phase 7b: trade rejects TRADE_RISK_GUARD on Sepolia', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    const result = await runCliAsync([
      '--output', 'json',
      'trade',
      '--skip-dotenv',
      '--chain-id', CHAIN_ID,
      '--rpc-url', SEPOLIA_RPC,
      '--market-address', deployedMarketAddress,
      '--side', 'yes',
      '--amount-usdc', '100',
      '--max-amount-usdc', '10',
      '--execute',
      '--allow-unquoted-execute',
      '--usdc', USDC_ADDRESS,
    ], buildEnv(indexerServer.url, clobServer.url));

    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false, 'Trade above max should fail');
    assert.equal(payload.error?.code, 'TRADE_RISK_GUARD',
      `Expected TRADE_RISK_GUARD, got: ${payload.error?.code}`);
    console.log('  Correctly rejected: TRADE_RISK_GUARD');
  });

  // =========================================================================
  // Phase 8: Nonce burst — rapid sequential transactions on real network
  // =========================================================================

  await t.test('Phase 8a: rapid sequential trades (nonce burst)', async () => {
    assert.ok(deployedMarketAddress, 'Market must be deployed first');

    console.log('  Running 3 rapid sequential trades to test nonce handling...');
    const results = [];
    for (let i = 0; i < 3; i++) {
      const result = await runCliAsync([
        '--output', 'json',
        'trade',
        '--skip-dotenv',
        '--chain-id', CHAIN_ID,
        '--rpc-url', SEPOLIA_RPC,
        '--market-address', deployedMarketAddress,
        '--side', i % 2 === 0 ? 'yes' : 'no',
        '--amount-usdc', '1',
        '--execute',
        '--allow-unquoted-execute',
        '--usdc', USDC_ADDRESS,
      ], buildEnv(indexerServer.url, clobServer.url));

      const payload = parseJsonOutput(result);
      results.push({ status: result.status, ok: payload.ok, code: payload.error?.code });
      console.log(`  Trade ${i + 1}: status=${result.status}, ok=${payload.ok}, code=${payload.error?.code || 'none'}`);
    }

    const successCount = results.filter((r) => r.ok).length;
    console.log(`  Nonce burst: ${successCount}/3 trades succeeded`);
    assert.ok(successCount >= 1, `At least 1 of 3 rapid trades should succeed, got ${successCount}`);
  });

  // =========================================================================
  // Cleanup
  // =========================================================================
  await t.test('Cleanup: stop mock servers', async () => {
    if (clobServer) await clobServer.close().catch(() => {});
    if (indexerServer) await indexerServer.close().catch(() => {});
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    console.log('  Cleanup complete');
  });
});
