const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DOCTOR_ENV_KEYS,
  createTempDir,
  removeDir,
  runCli,
  runCliAsync,
  runCliWithTty,
  startJsonHttpServer,
} = require('../helpers/cli_runner.cjs');
const { assertSchemaValid } = require('../helpers/json_schema_assert.cjs');
const {
  omitGeneratedAt,
  omitTrustDistributionFromCapabilities,
  omitTrustDistributionDefinitions,
  assertManifestParity,
  createIsolatedPandoraEnv,
} = require('../helpers/contract_parity_assertions.cjs');
const { createMcpToolRegistry } = require('../../cli/lib/mcp_tool_registry.cjs');
const { COMMAND_DESCRIPTOR_VERSION, buildCommandDescriptors } = require('../../cli/lib/agent_contract_registry.cjs');
const { createRunMirrorCommand } = require('../../cli/lib/mirror_command_service.cjs');
const { buildSchemaPayload } = require('../../cli/lib/schema_command_service.cjs');
const { buildSetupPlan } = require('../../cli/lib/setup_plan_service.cjs');
const { createOperationService } = require('../../cli/lib/operation_service.cjs');
const { upsertOperation, createOperationStateStore } = require('../../cli/lib/operation_state_store.cjs');
const {
  buildSdkContractArtifact,
  SDK_ARTIFACT_GENERATED_AT,
} = require('../../cli/lib/sdk_contract_service.cjs');
const { buildPublishedPackageJson } = require('../../scripts/prepare_publish_manifest.cjs');
const repoPackage = require('../../package.json');
const generatedManifest = require('../../sdk/generated/manifest.json');
const generatedContractRegistry = require('../../sdk/generated/contract-registry.json');
const latestBenchmarkReport = require('../../benchmarks/latest/core-report.json');
const typescriptSdkPackage = require('../../sdk/typescript/package.json');
const publishedPackage = buildPublishedPackageJson(repoPackage);
const setupWizardModulePath = path.join(__dirname, '..', '..', 'cli', 'lib', 'setup_wizard_service.cjs');
const setupRuntimeReady = fs.existsSync(setupWizardModulePath);
const setupTest = setupRuntimeReady ? test : test.skip;
const testInteractiveSetup = setupRuntimeReady && process.platform === 'win32' ? test.skip : (setupRuntimeReady ? test : test.skip);
const TEST_CLI_PATH = path.join(path.resolve(__dirname, '..', '..'), 'cli', 'pandora.cjs');

const ADDRESSES = {
  oracle: '0x1111111111111111111111111111111111111111',
  factory: '0x2222222222222222222222222222222222222222',
  usdc: '0x3333333333333333333333333333333333333333',
  wallet1: '0x4444444444444444444444444444444444444444',
  wallet2: '0x5555555555555555555555555555555555555555',
  mirrorMarket: '0x6666666666666666666666666666666666666666',
  mirrorPoll: '0x7777777777777777777777777777777777777777',
};

const POLYMARKET_DEFAULTS = {
  usdc: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
  ctf: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045',
  funder: '0x8888888888888888888888888888888888888888',
  spenders: {
    exchange: '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
    negRiskExchange: '0xc5d563a36ae78145c45a50134d48a1215220f80a',
    negRiskAdapter: '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296',
  },
};

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function parseJsonOutput(result) {
  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  const payloadText = stdout || String(result.output || '').trim();
  assert.match(payloadText, /\{/);
  return JSON.parse(payloadText);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid, timeoutMs = 10_000, pollMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await delay(pollMs);
  }
  return !isPidAlive(pid);
}

function parseNdjsonOutput(output) {
  const text = String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return text.map((line) => JSON.parse(line));
}

function stableJsonHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function deepCloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseTomlStringField(documentText, fieldName) {
  const match = String(documentText || '').match(new RegExp(`^${fieldName}\\s*=\\s*"([^"\\n]+)"`, 'm'));
  return match ? match[1] : null;
}

function buildValidEnv(rpcUrl, overrides = {}) {
  const entries = {
    CHAIN_ID: '1',
    RPC_URL: rpcUrl,
    PRIVATE_KEY: `0x${'1'.repeat(64)}`,
    ORACLE: ADDRESSES.oracle,
    FACTORY: ADDRESSES.factory,
    USDC: ADDRESSES.usdc,
    ...overrides,
  };

  return Object.entries(entries)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function buildRules() {
  return 'Resolves Yes if condition is true. Resolves No if false. If canceled/postponed/abandoned/unresolved, resolve No.';
}

function buildMockHypeResponse(overrides = {}) {
  return JSON.stringify({
    summary: 'Knicks-Celtics injury news is dominating the sports cycle.',
    searchQueries: ['knicks celtics march 2030 injury report', 'nba march 2030 breaking news'],
    candidates: [
      {
        headline: 'Knicks vs Celtics picks up late injury-driven buzz',
        topic: 'nba',
        whyNow: 'Roster uncertainty and playoff implications are driving attention.',
        category: 'Sports',
        question: 'Will the New York Knicks beat the Boston Celtics on March 20, 2030?',
        rules: 'YES: The New York Knicks win the game.\nNO: The New York Knicks do not win the game.\nEDGE: If the game is postponed and not completed by March 21, 2030, resolve N/A.',
        sources: [
          {
            title: 'ESPN preview',
            url: 'https://example.com/espn-knicks-celtics',
            publisher: 'ESPN',
            publishedAt: '2030-03-19T12:00:00Z',
          },
          {
            title: 'NBA injury report',
            url: 'https://example.com/nba-knicks-celtics',
            publisher: 'NBA',
            publishedAt: '2030-03-19T13:00:00Z',
          },
        ],
        suggestedResolutionDate: '2030-03-20T23:00:00Z',
        estimatedYesOdds: 57,
        freshnessScore: 86,
        attentionScore: 90,
        resolvabilityScore: 95,
        ammFitScore: 84,
        parimutuelFitScore: 68,
        marketTypeReasoning: 'Odds should move as lineup news changes through the trading window.',
        ...overrides,
      },
    ],
  });
}

const FIXED_FUTURE_TIMESTAMP = '1893456000'; // 2030-01-01T00:00:00Z
const FIXED_MIRROR_CLOSE_ISO = '2030-03-09T16:00:00Z';
const FIXED_MIRROR_CLOSE_TS = String(Math.floor(Date.parse(FIXED_MIRROR_CLOSE_ISO) / 1000));

function buildMirrorIndexerOverrides(overrides = {}) {
  const base = {
    markets: [
      {
        id: ADDRESSES.mirrorMarket,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: ADDRESSES.mirrorPoll,
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: FIXED_MIRROR_CLOSE_TS,
        totalVolume: '100000',
        currentTvl: '200000',
        yesChance: '0.55',
        reserveYes: '500000000',
        reserveNo: '500000000',
        createdAt: '1700000000',
      },
    ],
    polls: [
      {
        id: ADDRESSES.mirrorPoll,
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Will deterministic tests pass?',
        status: 0,
        category: 3,
        deadlineEpoch: Number(FIXED_MIRROR_CLOSE_TS),
        createdAt: 1700000000,
        createdTxHash: '0xhashpollmirror',
        rules:
          'Resolves YES if deterministic tests pass in CI. Resolves NO otherwise; canceled/postponed/abandoned/unresolved => NO.',
        sources: '["https://github.com","https://ci.example.com"]',
      },
    ],
  };

  return {
    markets: Array.isArray(overrides.markets) ? overrides.markets : base.markets,
    polls: Array.isArray(overrides.polls) ? overrides.polls : base.polls,
  };
}

function buildMirrorPolymarketOverrides() {
  return {
    markets: [
      {
        question: 'Will deterministic tests pass?',
        description:
          'Resolves YES if deterministic tests pass in CI. Resolves NO otherwise; canceled/postponed/abandoned/unresolved => NO.',
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
      },
    ],
  };
}

function buildMirrorSportsPolymarketOverrides() {
  return {
    markets: [
      {
        question: 'Will the Atlanta Hawks beat the Detroit Pistons?',
        description: 'This market resolves to Hawks if the Atlanta Hawks win the game.',
        condition_id: 'poly-sports-1',
        question_id: 'poly-sports-q-1',
        market_slug: 'hawks-v-pistons-hawks-win',
        event_title: 'Atlanta Hawks vs Detroit Pistons',
        end_date_iso: '2030-03-09T00:00:00Z',
        game_start_time: '2030-03-09T23:00:00Z',
        active: true,
        closed: false,
        volume24hr: 150000,
        tokens: [
          { outcome: 'Yes', price: '0.57', token_id: 'poly-sports-yes-1' },
          { outcome: 'No', price: '0.43', token_id: 'poly-sports-no-1' },
        ],
        tags: [{ id: 1001, name: 'NBA' }, { id: 82, name: 'Sports' }],
      },
    ],
  };
}

function buildLaunchArgs() {
  return [
    'launch',
    '--skip-dotenv',
    '--question',
    'Will this integration test pass?',
    '--rules',
    buildRules(),
    '--sources',
    'https://example.com/a',
    'https://example.com/b',
    '--target-timestamp',
    FIXED_FUTURE_TIMESTAMP,
    '--liquidity',
    '10',
  ];
}

function buildCloneArgs() {
  return [
    'clone-bet',
    '--skip-dotenv',
    '--question',
    'Will this clone integration test pass?',
    '--rules',
    buildRules(),
    '--sources',
    'https://example.com/a',
    'https://example.com/b',
    '--target-timestamp',
    FIXED_FUTURE_TIMESTAMP,
    '--liquidity',
    '10',
  ];
}

async function startRpcMockServer(options = {}) {
  const chainIdHex = options.chainIdHex || '0x1';
  const codeByAddress = {};

  for (const [address, code] of Object.entries(options.codeByAddress || {})) {
    codeByAddress[address.toLowerCase()] = code;
  }

  return startJsonHttpServer(({ bodyJson }) => {
    if (!bodyJson || typeof bodyJson !== 'object') {
      return {
        status: 400,
        body: {
          jsonrpc: '2.0',
          id: 1,
          error: { message: 'Invalid JSON-RPC payload' },
        },
      };
    }

    if (bodyJson.method === 'eth_chainId') {
      return {
        headers: {
          connection: 'close',
        },
        body: {
          jsonrpc: '2.0',
          id: bodyJson.id || 1,
          result: chainIdHex,
        },
      };
    }

    if (bodyJson.method === 'eth_getCode') {
      const address = String((bodyJson.params && bodyJson.params[0]) || '').toLowerCase();
      return {
        headers: {
          connection: 'close',
        },
        body: {
          jsonrpc: '2.0',
          id: bodyJson.id || 1,
          result: Object.prototype.hasOwnProperty.call(codeByAddress, address) ? codeByAddress[address] : '0x',
        },
      };
    }

    return {
      status: 400,
      headers: {
        connection: 'close',
      },
      body: {
        jsonrpc: '2.0',
        id: bodyJson.id || 1,
        error: { message: `Unsupported method ${bodyJson.method}` },
      },
    };
  });
}

function encodeUint256(value) {
  const normalized = BigInt(value || 0);
  return `0x${normalized.toString(16).padStart(64, '0')}`;
}

function encodeBool(value) {
  return value ? `0x${'0'.repeat(63)}1` : `0x${'0'.repeat(64)}`;
}

function decodeAddressFromCallData(data, index) {
  const raw = String(data || '').toLowerCase().replace(/^0x/, '');
  const start = 8 + index * 64 + 24;
  return `0x${raw.slice(start, start + 40)}`;
}

async function startPolymarketOpsRpcMock(options = {}) {
  const funder = String(options.funder || POLYMARKET_DEFAULTS.funder).toLowerCase();
  const usdc = String(options.usdc || POLYMARKET_DEFAULTS.usdc).toLowerCase();
  const ctf = String(options.ctf || POLYMARKET_DEFAULTS.ctf).toLowerCase();
  const chainIdHex = options.chainIdHex || '0x89';
  const safeOwner = options.safeOwner !== false;
  const usdcBalanceRaw = BigInt(options.usdcBalanceRaw || 0n);

  const allowanceBySpender = {};
  for (const [key, address] of Object.entries(POLYMARKET_DEFAULTS.spenders)) {
    const configured = options.allowanceBySpender && Object.prototype.hasOwnProperty.call(options.allowanceBySpender, key)
      ? options.allowanceBySpender[key]
      : 0n;
    allowanceBySpender[String(address).toLowerCase()] = BigInt(configured || 0n);
  }

  const operatorBySpender = {};
  for (const [key, address] of Object.entries(POLYMARKET_DEFAULTS.spenders)) {
    const configured = options.operatorBySpender && Object.prototype.hasOwnProperty.call(options.operatorBySpender, key)
      ? options.operatorBySpender[key]
      : false;
    operatorBySpender[String(address).toLowerCase()] = Boolean(configured);
  }

  return startJsonHttpServer(({ bodyJson }) => {
    const requests = Array.isArray(bodyJson) ? bodyJson : [bodyJson];
    const responses = requests.map((request, index) => {
      const id = request && request.id !== undefined ? request.id : index + 1;
      if (!request || typeof request !== 'object') {
        return {
          jsonrpc: '2.0',
          id,
          error: { message: 'Invalid JSON-RPC payload' },
        };
      }

      if (request.method === 'eth_chainId') {
        return { jsonrpc: '2.0', id, result: chainIdHex };
      }

      if (request.method === 'eth_getCode') {
        const address = String((request.params && request.params[0]) || '').toLowerCase();
        return {
          jsonrpc: '2.0',
          id,
          result: address === funder ? '0x6001600101' : '0x',
        };
      }

      if (request.method === 'eth_call') {
        const tx = request.params && request.params[0] ? request.params[0] : {};
        const target = String(tx.to || '').toLowerCase();
        const data = String(tx.data || '').toLowerCase();
        const selector = data.slice(0, 10);

        if (target === usdc && selector === '0x70a08231') {
          return { jsonrpc: '2.0', id, result: encodeUint256(usdcBalanceRaw) };
        }
        if (target === usdc && selector === '0xdd62ed3e') {
          const spender = decodeAddressFromCallData(data, 1);
          const allowance = Object.prototype.hasOwnProperty.call(allowanceBySpender, spender)
            ? allowanceBySpender[spender]
            : 0n;
          return { jsonrpc: '2.0', id, result: encodeUint256(allowance) };
        }
        if (target === ctf && selector === '0xe985e9c5') {
          const spender = decodeAddressFromCallData(data, 1);
          const approved = Object.prototype.hasOwnProperty.call(operatorBySpender, spender)
            ? operatorBySpender[spender]
            : false;
          return { jsonrpc: '2.0', id, result: encodeBool(approved) };
        }
        if (target === funder && selector === '0x2f54bf6e') {
          return { jsonrpc: '2.0', id, result: encodeBool(safeOwner) };
        }

        return {
          jsonrpc: '2.0',
          id,
          error: { message: `Unsupported eth_call target/selector ${target} ${selector}` },
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: { message: `Unsupported method ${request.method}` },
      };
    });

    return {
      body: Array.isArray(bodyJson) ? responses : responses[0],
    };
  });
}

function encodeAddress(address) {
  const normalized = String(address || '').trim().toLowerCase().replace(/^0x/, '');
  return `0x${normalized.padStart(64, '0')}`;
}

function encodeString(value) {
  const hex = Buffer.from(String(value || ''), 'utf8').toString('hex');
  const offset = `${'0'.repeat(63)}20`;
  const length = (hex.length / 2).toString(16).padStart(64, '0');
  const padded = hex.padEnd(Math.max(64, Math.ceil(hex.length / 64) * 64), '0');
  return `0x${offset}${length}${padded}`;
}

function encodeHexQuantity(value) {
  return `0x${BigInt(value || 0).toString(16)}`;
}

async function startFeesWithdrawRpcMock(options = {}) {
  const markets = Array.isArray(options.markets) && options.markets.length
    ? options.markets
    : [{
      marketAddress: options.marketAddress || ADDRESSES.mirrorMarket,
      factory: options.factory || ADDRESSES.factory,
      collateralToken: options.collateralToken || ADDRESSES.usdc,
      creator: options.creator || ADDRESSES.wallet1,
      platformTreasury: options.platformTreasury || ADDRESSES.wallet2,
      protocolFeesCollected: options.protocolFeesCollected || 0n,
      decimals: options.decimals === undefined ? 6 : options.decimals,
      symbol: options.symbol || 'USDC',
    }];
  const chainIdHex = options.chainIdHex || '0x1';
  const marketMap = new Map();
  const factoryMap = new Map();
  const collateralMap = new Map();

  for (const entry of markets) {
    const marketAddress = String(entry.marketAddress || '').toLowerCase();
    const factory = String(entry.factory || ADDRESSES.factory).toLowerCase();
    const collateralToken = String(entry.collateralToken || ADDRESSES.usdc).toLowerCase();
    const creator = String(entry.creator || ADDRESSES.wallet1).toLowerCase();
    const platformTreasury = String(entry.platformTreasury || ADDRESSES.wallet2).toLowerCase();
    const protocolFeesCollected = BigInt(entry.protocolFeesCollected || 0n);
    const decimals = BigInt(entry.decimals === undefined ? 6 : entry.decimals);
    const symbol = String(entry.symbol || 'USDC');

    marketMap.set(marketAddress, {
      factory,
      collateralToken,
      creator,
      platformTreasury,
      protocolFeesCollected,
      decimals,
      symbol,
    });
    factoryMap.set(factory, platformTreasury);
    collateralMap.set(collateralToken, { decimals, symbol });
  }

  return startJsonHttpServer(({ bodyJson }) => {
    const requests = Array.isArray(bodyJson) ? bodyJson : [bodyJson];
    const responses = requests.map((request, index) => {
      const id = request && request.id !== undefined ? request.id : index + 1;
      if (!request || typeof request !== 'object') {
        return { jsonrpc: '2.0', id, error: { message: 'Invalid JSON-RPC payload' } };
      }

      if (request.method === 'eth_chainId') {
        return { jsonrpc: '2.0', id, result: chainIdHex };
      }

      if (request.method === 'eth_call') {
        const tx = request.params && request.params[0] ? request.params[0] : {};
        const target = String(tx.to || '').toLowerCase();
        const selector = String(tx.data || '').toLowerCase().slice(0, 10);

        const market = marketMap.get(target);
        if (market && selector === '0xcc08b834') {
          return { jsonrpc: '2.0', id, result: encodeUint256(market.protocolFeesCollected) };
        }
        if (market && selector === '0xb2016bd4') {
          return { jsonrpc: '2.0', id, result: encodeAddress(market.collateralToken) };
        }
        if (market && selector === '0x02d05d3f') {
          return { jsonrpc: '2.0', id, result: encodeAddress(market.creator) };
        }
        if (market && selector === '0xc45a0155') {
          return { jsonrpc: '2.0', id, result: encodeAddress(market.factory) };
        }
        if (factoryMap.has(target) && selector === '0xe138818c') {
          return { jsonrpc: '2.0', id, result: encodeAddress(factoryMap.get(target)) };
        }
        if (collateralMap.has(target) && selector === '0x313ce567') {
          return { jsonrpc: '2.0', id, result: encodeUint256(collateralMap.get(target).decimals) };
        }
        if (collateralMap.has(target) && selector === '0x95d89b41') {
          return { jsonrpc: '2.0', id, result: encodeString(collateralMap.get(target).symbol) };
        }

        return {
          jsonrpc: '2.0',
          id,
          error: { message: `Unsupported eth_call target/selector ${target} ${selector}` },
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: { message: `Unsupported method ${request.method}` },
      };
    });

    return {
      body: Array.isArray(bodyJson) ? responses : responses[0],
    };
  });
}

async function startMirrorTraceRpcMock(options = {}) {
  const marketAddress = String(options.marketAddress || ADDRESSES.mirrorMarket).toLowerCase();
  const yesToken = String(options.yesToken || '0x1111111111111111111111111111111111111111').toLowerCase();
  const noToken = String(options.noToken || '0x2222222222222222222222222222222222222222').toLowerCase();
  const chainIdHex = String(options.chainIdHex || '0x1').toLowerCase();
  const tradingFee = BigInt(options.tradingFee || 3000);
  const decimals = BigInt(options.decimals || 6);
  const snapshots = new Map();
  const archiveMissingBlocks = new Set(
    (Array.isArray(options.archiveMissingBlocks) ? options.archiveMissingBlocks : []).map((value) =>
      encodeHexQuantity(value).toLowerCase()),
  );

  for (const snapshot of Array.isArray(options.snapshots) ? options.snapshots : []) {
    const blockNumber = Number(snapshot && snapshot.blockNumber);
    if (!Number.isInteger(blockNumber) || blockNumber < 0) continue;
    snapshots.set(encodeHexQuantity(blockNumber).toLowerCase(), {
      blockNumber,
      timestamp: Number(snapshot.timestamp || 0),
      blockHash:
        snapshot.blockHash
        || `0x${BigInt(blockNumber).toString(16).padStart(64, '0')}`,
      reserveYesRaw: BigInt(snapshot.reserveYesRaw || 0n),
      reserveNoRaw: BigInt(snapshot.reserveNoRaw || 0n),
    });
  }

  function resolveSnapshot(blockTag) {
    const normalized = String(blockTag || 'latest').trim().toLowerCase();
    if (normalized === 'latest') {
      const ordered = Array.from(snapshots.values()).sort((left, right) => left.blockNumber - right.blockNumber);
      return ordered[ordered.length - 1] || null;
    }
    return snapshots.get(normalized) || null;
  }

  return startJsonHttpServer(({ bodyJson }) => {
    const requests = Array.isArray(bodyJson) ? bodyJson : [bodyJson];
    const responses = requests.map((request, index) => {
      const id = request && request.id !== undefined ? request.id : index + 1;
      if (!request || typeof request !== 'object') {
        return {
          jsonrpc: '2.0',
          id,
          error: { message: 'Invalid JSON-RPC payload' },
        };
      }

      if (request.method === 'eth_chainId') {
        return { jsonrpc: '2.0', id, result: chainIdHex };
      }

      if (request.method === 'eth_getBlockByNumber') {
        const blockTag = String((request.params && request.params[0]) || 'latest').toLowerCase();
        if (archiveMissingBlocks.has(blockTag)) {
          return {
            jsonrpc: '2.0',
            id,
            error: { message: 'missing trie node: historical state unavailable; archive node required' },
          };
        }
        const snapshot = resolveSnapshot(blockTag);
        if (!snapshot) {
          return {
            jsonrpc: '2.0',
            id,
            error: { message: `Unknown block ${blockTag}` },
          };
        }
        return {
          jsonrpc: '2.0',
          id,
          result: {
            number: encodeHexQuantity(snapshot.blockNumber),
            hash: snapshot.blockHash,
            timestamp: encodeHexQuantity(snapshot.timestamp),
          },
        };
      }

      if (request.method === 'eth_call') {
        const tx = request.params && request.params[0] ? request.params[0] : {};
        const target = String(tx.to || '').toLowerCase();
        const data = String(tx.data || '').toLowerCase();
        const selector = data.slice(0, 10);
        const blockTag = String((request.params && request.params[1]) || 'latest').toLowerCase();

        if (archiveMissingBlocks.has(blockTag)) {
          return {
            jsonrpc: '2.0',
            id,
            error: { message: 'missing trie node: historical state unavailable; archive node required' },
          };
        }

        const snapshot = resolveSnapshot(blockTag);
        if (!snapshot) {
          return {
            jsonrpc: '2.0',
            id,
            error: { message: `Unknown block ${blockTag}` },
          };
        }

        if (target === marketAddress && selector === '0xf0d9bb20') {
          return { jsonrpc: '2.0', id, result: encodeAddress(yesToken) };
        }
        if (target === marketAddress && selector === '0x11a9f10a') {
          return { jsonrpc: '2.0', id, result: encodeAddress(noToken) };
        }
        if (target === marketAddress && selector === '0x8a8ee140') {
          return { jsonrpc: '2.0', id, result: encodeAddress(yesToken) };
        }
        if (target === marketAddress && selector === '0x3c802ddd') {
          return { jsonrpc: '2.0', id, result: encodeAddress(noToken) };
        }
        if (target === marketAddress && selector === '0x56f43352') {
          return { jsonrpc: '2.0', id, result: encodeUint256(tradingFee) };
        }
        if ((target === yesToken || target === noToken) && selector === '0x313ce567') {
          return { jsonrpc: '2.0', id, result: encodeUint256(decimals) };
        }
        if (target === yesToken && selector === '0x70a08231') {
          return { jsonrpc: '2.0', id, result: encodeUint256(snapshot.reserveYesRaw) };
        }
        if (target === noToken && selector === '0x70a08231') {
          return { jsonrpc: '2.0', id, result: encodeUint256(snapshot.reserveNoRaw) };
        }

        return {
          jsonrpc: '2.0',
          id,
          error: { message: `Unsupported eth_call target/selector ${target} ${selector}` },
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: { message: `Unsupported method ${request.method}` },
      };
    });

    return {
      body: Array.isArray(bodyJson) ? responses : responses[0],
    };
  });
}

function applyWhereFilter(items, where) {
  if (!where || typeof where !== 'object') return items;

  const entries = Object.entries(where);
  if (!entries.length) return items;

  return items.filter((item) =>
    entries.every(([key, value]) => {
      if (key.endsWith('_contains')) {
        const base = key.replace(/_contains$/, '');
        return String(item[base] || '').includes(String(value));
      }
      return String(item[key]) === String(value);
    }),
  );
}

function applyListControls(items, variables) {
  const orderBy = variables && variables.orderBy ? variables.orderBy : null;
  const orderDirection =
    variables && variables.orderDirection && String(variables.orderDirection).toLowerCase() === 'asc' ? 'asc' : 'desc';
  const limit = variables && Number.isInteger(variables.limit) ? variables.limit : items.length;

  const sorted = [...items];
  if (orderBy) {
    sorted.sort((a, b) => {
      const left = a[orderBy];
      const right = b[orderBy];
      if (left === right) return 0;
      if (left === undefined) return 1;
      if (right === undefined) return -1;
      return left > right ? 1 : -1;
    });
    if (orderDirection === 'desc') {
      sorted.reverse();
    }
  }

  return sorted.slice(0, limit);
}

function asPage(items) {
  return {
    items,
    pageInfo: {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: items.length ? `${items[0].id}` : null,
      endCursor: items.length ? `${items[items.length - 1].id}` : null,
    },
  };
}

function resolveBatchEntitySelections(query, variables, fieldName, resolver) {
  const pattern = new RegExp(`([A-Za-z0-9_]+)\\s*:\\s*${fieldName}\\(id:\\s*\\$([A-Za-z0-9_]+)\\)`, 'g');
  const matches = Array.from(String(query || '').matchAll(pattern));
  if (!matches.length) return null;

  const data = {};
  for (const match of matches) {
    const alias = match[1];
    const variableName = match[2];
    data[alias] = resolver(variables ? variables[variableName] : undefined);
  }
  return data;
}

async function startIndexerMockServer(overrides = {}) {
  const fixtures = {
    markets: [
      {
        id: 'market-1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '12345',
        currentTvl: '4567',
        yesChance: '0.625',
        reserveYes: '625',
        reserveNo: '375',
        createdAt: '1700000000',
      },
    ],
    polls: [
      {
        id: 'poll-1',
        chainId: 1,
        chainName: 'ethereum',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        question: 'Will deterministic tests pass?',
        status: 1,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpoll1',
      },
    ],
    liquidityEvents: [
      {
        id: 'evt-liq-1',
        chainId: 1,
        chainName: 'ethereum',
        provider: ADDRESSES.wallet1,
        marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        eventType: 'addLiquidity',
        collateralAmount: '1000',
        lpTokens: '500',
        yesTokenAmount: '625',
        noTokenAmount: '375',
        yesTokensReturned: '0',
        noTokensReturned: '0',
        txHash: '0xtx-liq-1',
        timestamp: 1700000100,
      },
    ],
    oracleFeeEvents: [
      {
        id: 'evt-oracle-1',
        chainId: 1,
        chainName: 'ethereum',
        oracleAddress: ADDRESSES.oracle,
        eventName: 'FeeUpdated',
        newFee: '200',
        to: ADDRESSES.wallet2,
        amount: '0',
        txHash: '0xtx-oracle-1',
        blockNumber: 190,
        timestamp: 1700000200,
      },
    ],
    claimEvents: [
      {
        id: 'evt-claim-1',
        campaignAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
        userAddress: ADDRESSES.wallet1,
        amount: '42',
        signature: '0xsig',
        blockNumber: 200,
        timestamp: 1700000300,
        txHash: '0xtx-claim-1',
      },
    ],
    positions: [
      {
        id: 'pos-1',
        chainId: 1,
        marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        user: ADDRESSES.wallet1,
        lastTradeAt: 1700000400,
      },
      {
        id: 'pos-2',
        chainId: 1,
        marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        user: ADDRESSES.wallet2,
        lastTradeAt: 1700000500,
      },
    ],
    trades: [
      {
        id: 'trade-1',
        chainId: 1,
        marketAddress: 'market-1',
        pollAddress: 'poll-1',
        trader: ADDRESSES.wallet1,
        side: 'yes',
        tradeType: 'buy',
        collateralAmount: '5000000',
        tokenAmount: '10000000',
        tokenAmountOut: '10000000',
        feeAmount: '50000',
        timestamp: 1700000600,
        txHash: '0xtrade1',
      },
      {
        id: 'trade-2',
        chainId: 1,
        marketAddress: 'market-1',
        pollAddress: 'poll-1',
        trader: ADDRESSES.wallet1,
        side: 'no',
        tradeType: 'buy',
        collateralAmount: '2000000',
        tokenAmount: '3000000',
        tokenAmountOut: '3000000',
        feeAmount: '20000',
        timestamp: 1700000700,
        txHash: '0xtrade2',
      },
    ],
    winnings: [
      {
        id: 'win-1',
        user: ADDRESSES.wallet1,
        marketAddress: 'market-1',
        collateralAmount: '9000000',
        feeAmount: '0',
        timestamp: 1700000800,
        txHash: '0xwin1',
      },
    ],
    users: [
      {
        id: 'user-1',
        address: ADDRESSES.wallet1,
        chainId: 1,
        realizedPnL: '123.45',
        totalVolume: '999.5',
        totalTrades: '7',
        totalWins: '5',
        totalLosses: '2',
        totalWinnings: '500',
      },
      {
        id: 'user-2',
        address: ADDRESSES.wallet2,
        chainId: 1,
        realizedPnL: '23.45',
        totalVolume: '1999.5',
        totalTrades: '10',
        totalWins: '4',
        totalLosses: '6',
        totalWinnings: '250',
      },
    ],
  };

  for (const [key, value] of Object.entries(overrides || {})) {
    if (Array.isArray(value)) {
      fixtures[key] = value;
    }
  }

  return startJsonHttpServer(({ bodyJson }) => {
    const query = (bodyJson && bodyJson.query) || '';
    const variables = (bodyJson && bodyJson.variables) || {};

    if (typeof overrides.handleRequest === 'function') {
      const customResponse = overrides.handleRequest({ bodyJson, query, variables, fixtures });
      if (customResponse) {
        return customResponse;
      }
    }

    if (query.includes('marketss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.markets, variables.where), variables);
      return { body: { data: { marketss: asPage(items) } } };
    }

    if (query.includes('markets(id:') && Object.prototype.hasOwnProperty.call(variables, 'id')) {
      const item = fixtures.markets.find((entry) => entry.id === variables.id) || null;
      return { body: { data: { markets: item } } };
    }

    const batchMarkets = resolveBatchEntitySelections(query, variables, 'markets', (id) =>
      fixtures.markets.find((entry) => entry.id === id) || null,
    );
    if (batchMarkets) {
      return { body: { data: batchMarkets } };
    }

    if (query.includes('pollss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.polls, variables.where), variables);
      return { body: { data: { pollss: asPage(items) } } };
    }

    if (query.includes('polls(id:') && Object.prototype.hasOwnProperty.call(variables, 'id')) {
      const item =
        fixtures.polls.find((entry) => entry.id === variables.id) ||
        (variables.id === fixtures.markets[0].pollAddress ? fixtures.polls[0] : null);
      return { body: { data: { polls: item } } };
    }

    const batchPolls = resolveBatchEntitySelections(query, variables, 'polls', (id) =>
      fixtures.polls.find((entry) => entry.id === id) ||
      (id === fixtures.markets[0].pollAddress ? fixtures.polls[0] : null),
    );
    if (batchPolls) {
      return { body: { data: batchPolls } };
    }

    if (query.includes('liquidityEventss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.liquidityEvents, variables.where), variables);
      return { body: { data: { liquidityEventss: asPage(items) } } };
    }

    if (query.includes('liquidityEvents(id:')) {
      const item = fixtures.liquidityEvents.find((entry) => entry.id === variables.id) || null;
      return { body: { data: { liquidityEvents: item } } };
    }

    if (query.includes('oracleFeeEventss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.oracleFeeEvents, variables.where), variables);
      return { body: { data: { oracleFeeEventss: asPage(items) } } };
    }

    if (query.includes('oracleFeeEvents(id:')) {
      const item = fixtures.oracleFeeEvents.find((entry) => entry.id === variables.id) || null;
      return { body: { data: { oracleFeeEvents: item } } };
    }

    if (query.includes('claimEventss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.claimEvents, variables.where), variables);
      return { body: { data: { claimEventss: asPage(items) } } };
    }

    if (query.includes('claimEvents(id:')) {
      const item = fixtures.claimEvents.find((entry) => entry.id === variables.id) || null;
      return { body: { data: { claimEvents: item } } };
    }

    if (query.includes('marketUserss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.positions, variables.where), variables);
      return { body: { data: { marketUserss: asPage(items) } } };
    }

    if (query.includes('tradess(')) {
      const items = applyListControls(applyWhereFilter(fixtures.trades, variables.where), variables);
      return { body: { data: { tradess: asPage(items) } } };
    }

    if (query.includes('winningss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.winnings, variables.where), variables);
      return { body: { data: { winningss: asPage(items) } } };
    }

    if (query.includes('userss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.users, variables.where), variables);
      return { body: { data: { userss: asPage(items) } } };
    }

    return {
      status: 400,
      body: {
        errors: [{ message: 'Unsupported query in mock indexer' }],
      },
    };
  });
}

function assertOddsShape(odds) {
  assert.equal(Boolean(odds && typeof odds === 'object' && !Array.isArray(odds)), true);
  assert.equal(typeof odds.yesPct, 'number');
  assert.equal(typeof odds.noPct, 'number');
  assert.ok(odds.yesPct >= 0 && odds.yesPct <= 100);
  assert.ok(odds.noPct >= 0 && odds.noPct <= 100);
  assert.ok(Math.abs(odds.yesPct + odds.noPct - 100) < 0.000001);
}

function assertIsoTimestamp(value) {
  assert.equal(typeof value, 'string');
  const parsed = Date.parse(value);
  assert.equal(Number.isNaN(parsed), false);
}

async function startPhaseOneIndexerMockServer() {
  const fixtures = {
    markets: [
      {
        id: 'market-phase1-1',
        chainId: 1,
        chainName: 'ethereum',
        pollId: 'poll-phase1-1',
        pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '12345',
        currentTvl: '4567',
        createdAt: '1700000000',
        question: 'Will Phase 1 contract tests remain deterministic?',
        status: 1,
        category: 3,
        deadlineEpoch: 1710000000,
        odds: {
          yesPct: 62.5,
          noPct: 37.5,
        },
        yesPct: 62.5,
        noPct: 37.5,
        yesPrice: '0.625',
        noPrice: '0.375',
        poll: {
          id: 'poll-phase1-1',
          question: 'Will Phase 1 contract tests remain deterministic?',
          status: 1,
          category: 3,
          deadlineEpoch: 1710000000,
        },
      },
    ],
    polls: [
      {
        id: 'poll-phase1-1',
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Will Phase 1 contract tests remain deterministic?',
        status: 1,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpollphase1',
      },
    ],
    positions: [
      {
        id: 'scan-pos-1',
        chainId: 1,
        marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        user: ADDRESSES.wallet1,
        lastTradeAt: 1700000400,
      },
    ],
    liquidityEvents: [
      {
        id: 'scan-liq-1',
        chainId: 1,
        chainName: 'ethereum',
        provider: ADDRESSES.wallet1,
        marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        eventType: 'addLiquidity',
        collateralAmount: '1000',
        lpTokens: '500',
        yesTokenAmount: '625',
        noTokenAmount: '375',
        yesTokensReturned: '0',
        noTokensReturned: '0',
        txHash: '0xscan-liq-1',
        timestamp: 1700000100,
      },
    ],
  };

  return startJsonHttpServer(({ bodyJson }) => {
    const query = String((bodyJson && bodyJson.query) || '');
    const variables = (bodyJson && bodyJson.variables) || {};
    const data = {};

    if (query.includes('marketss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.markets, variables.where), variables);
      data.marketss = asPage(items);
    }

    if (query.includes('markets(id:') && Object.prototype.hasOwnProperty.call(variables, 'id')) {
      data.markets = fixtures.markets.find((entry) => entry.id === variables.id) || null;
    }

    const batchMarkets = resolveBatchEntitySelections(query, variables, 'markets', (id) =>
      fixtures.markets.find((entry) => entry.id === id) || null,
    );
    if (batchMarkets) {
      Object.assign(data, batchMarkets);
    }

    if (query.includes('pollss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.polls, variables.where), variables);
      data.pollss = asPage(items);
    }

    if (query.includes('polls(id:') && Object.prototype.hasOwnProperty.call(variables, 'id')) {
      data.polls = fixtures.polls.find((entry) => entry.id === variables.id) || null;
    }

    const batchPolls = resolveBatchEntitySelections(query, variables, 'polls', (id) =>
      fixtures.polls.find((entry) => entry.id === id) || null,
    );
    if (batchPolls) {
      Object.assign(data, batchPolls);
    }

    if (query.includes('marketUserss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.positions, variables.where), variables);
      data.marketUserss = asPage(items);
    }

    if (query.includes('liquidityEventss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.liquidityEvents, variables.where), variables);
      data.liquidityEventss = asPage(items);
    }

    if (Object.keys(data).length) {
      return { body: { data } };
    }

    return {
      status: 400,
      body: {
        errors: [{ message: 'Unsupported query in phase1 mock indexer' }],
      },
    };
  });
}

async function startLifecycleIndexerMockServer() {
  const now = Math.floor(Date.now() / 1000);
  const fixtures = {
    markets: [
      {
        id: 'market-past',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: String(now - 3600),
        totalVolume: '10',
        currentTvl: '1',
        createdAt: String(now - 10000),
      },
      {
        id: 'market-soon',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: String(now + 2 * 3600),
        totalVolume: '20',
        currentTvl: '2',
        createdAt: String(now - 5000),
      },
      {
        id: 'market-far',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
        creator: ADDRESSES.wallet1,
        marketType: 'pari',
        marketCloseTimestamp: String(now + 72 * 3600),
        totalVolume: '30',
        currentTvl: '3',
        createdAt: String(now - 3000),
      },
    ],
  };

  return startJsonHttpServer(({ bodyJson }) => {
    const query = (bodyJson && bodyJson.query) || '';
    const variables = (bodyJson && bodyJson.variables) || {};

    if (query.includes('marketss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.markets, variables.where), variables);
      return { body: { data: { marketss: asPage(items) } } };
    }

    if (query.includes('markets(id:') && Object.prototype.hasOwnProperty.call(variables, 'id')) {
      const item = fixtures.markets.find((entry) => entry.id === variables.id) || null;
      return { body: { data: { markets: item } } };
    }

    return {
      status: 400,
      body: {
        errors: [{ message: 'Unsupported lifecycle query in mock indexer' }],
      },
    };
  });
}

async function startAnalyzeIndexerMockServer() {
  const marketAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const pollAddress = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const fixtures = {
    market: {
      id: marketAddress,
      chainId: 1,
      chainName: 'ethereum',
      pollAddress,
      creator: ADDRESSES.wallet1,
      marketType: 'amm',
      marketCloseTimestamp: '1710000000',
      totalVolume: '12345',
      currentTvl: '4567',
      createdAt: '1700000000',
    },
    poll: {
      id: pollAddress,
      chainId: 1,
      chainName: 'ethereum',
      creator: ADDRESSES.wallet1,
      question: 'Will deterministic analysis work?',
      status: 0,
      category: 3,
      deadlineEpoch: 1710000000,
      createdAt: 1700000000,
      createdTxHash: '0xhashpollanalyze',
    },
    liquidityEvents: [
      {
        id: 'analyze-liq-1',
        chainId: 1,
        chainName: 'ethereum',
        provider: ADDRESSES.wallet1,
        marketAddress,
        pollAddress,
        eventType: 'addLiquidity',
        collateralAmount: '1000',
        lpTokens: '500',
        yesTokenAmount: '610',
        noTokenAmount: '390',
        yesTokensReturned: '0',
        noTokensReturned: '0',
        txHash: '0xanalyze-liq-1',
        timestamp: 1700000100,
      },
    ],
  };

  return startJsonHttpServer(({ bodyJson }) => {
    const query = String((bodyJson && bodyJson.query) || '');
    const variables = (bodyJson && bodyJson.variables) || {};

    if (query.includes('markets(id:') && Object.prototype.hasOwnProperty.call(variables, 'id')) {
      return {
        body: {
          data: {
            markets: variables.id === fixtures.market.id ? fixtures.market : null,
          },
        },
      };
    }

    const batchMarkets = resolveBatchEntitySelections(query, variables, 'markets', (id) =>
      id === fixtures.market.id ? fixtures.market : null,
    );
    if (batchMarkets) {
      return { body: { data: batchMarkets } };
    }

    if (query.includes('polls(id:') && Object.prototype.hasOwnProperty.call(variables, 'id')) {
      return {
        body: {
          data: {
            polls: variables.id === fixtures.poll.id ? fixtures.poll : null,
          },
        },
      };
    }

    const batchPolls = resolveBatchEntitySelections(query, variables, 'polls', (id) =>
      id === fixtures.poll.id ? fixtures.poll : null,
    );
    if (batchPolls) {
      return { body: { data: batchPolls } };
    }

    if (query.includes('liquidityEventss(')) {
      const items = applyListControls(applyWhereFilter(fixtures.liquidityEvents, variables.where), variables);
      return { body: { data: { liquidityEventss: asPage(items) } } };
    }

    return {
      status: 400,
      body: {
        errors: [{ message: 'Unsupported query in analyze mock indexer' }],
      },
    };
  });
}

async function startPolymarketMockServer(overrides = {}) {
  const basePayload = {
    markets: [
      {
        question: 'Will deterministic tests pass?',
        condition_id: 'poly-cond-1',
        question_id: 'poly-q-1',
        market_slug: 'deterministic-tests-pass',
        end_date_iso: '2024-03-09T16:00:00Z',
        active: true,
        closed: false,
        volume24hr: 100000,
        tokens: [
          { outcome: 'Yes', price: '0.74', token_id: 'poly-yes-1' },
          { outcome: 'No', price: '0.26', token_id: 'poly-no-1' },
        ],
      },
    ],
    orderbooks: {
      'poly-yes-1': {
        bids: [{ price: '0.73', size: '500' }],
        asks: [{ price: '0.74', size: '600' }],
      },
      'poly-no-1': {
        bids: [{ price: '0.25', size: '500' }],
        asks: [{ price: '0.26', size: '600' }],
      },
    },
  };

  const payload = {
    ...basePayload,
    ...overrides,
    markets: Array.isArray(overrides.markets) ? overrides.markets : basePayload.markets,
    orderbooks: overrides.orderbooks || basePayload.orderbooks,
  };

  return startJsonHttpServer(() => ({
    body: payload,
  }));
}


module.exports = {
  test,
  assert,
  crypto,
  fs,
  os,
  path,
  DOCTOR_ENV_KEYS,
  createTempDir,
  removeDir,
  runCli,
  runCliAsync,
  runCliWithTty,
  startJsonHttpServer,
  assertSchemaValid,
  omitGeneratedAt,
  omitTrustDistributionFromCapabilities,
  omitTrustDistributionDefinitions,
  assertManifestParity,
  createIsolatedPandoraEnv,
  createMcpToolRegistry,
  COMMAND_DESCRIPTOR_VERSION,
  buildCommandDescriptors,
  createRunMirrorCommand,
  buildSchemaPayload,
  buildSetupPlan,
  createOperationService,
  upsertOperation,
  createOperationStateStore,
  buildSdkContractArtifact,
  SDK_ARTIFACT_GENERATED_AT,
  buildPublishedPackageJson,
  repoPackage,
  generatedManifest,
  generatedContractRegistry,
  latestBenchmarkReport,
  typescriptSdkPackage,
  publishedPackage,
  setupWizardModulePath,
  setupRuntimeReady,
  setupTest,
  testInteractiveSetup,
  TEST_CLI_PATH,
  ADDRESSES,
  POLYMARKET_DEFAULTS,
  writeFile,
  parseJsonOutput,
  delay,
  isPidAlive,
  waitForPidExit,
  parseNdjsonOutput,
  stableJsonHash,
  deepCloneJson,
  parseTomlStringField,
  buildValidEnv,
  buildRules,
  buildMockHypeResponse,
  FIXED_FUTURE_TIMESTAMP,
  FIXED_MIRROR_CLOSE_ISO,
  FIXED_MIRROR_CLOSE_TS,
  buildMirrorIndexerOverrides,
  buildMirrorPolymarketOverrides,
  buildMirrorSportsPolymarketOverrides,
  buildLaunchArgs,
  buildCloneArgs,
  encodeUint256,
  encodeBool,
  decodeAddressFromCallData,
  startRpcMockServer,
  startPolymarketOpsRpcMock,
  encodeAddress,
  encodeString,
  encodeHexQuantity,
  startFeesWithdrawRpcMock,
  startMirrorTraceRpcMock,
  applyWhereFilter,
  applyListControls,
  asPage,
  resolveBatchEntitySelections,
  startIndexerMockServer,
  assertOddsShape,
  assertIsoTimestamp,
  startPhaseOneIndexerMockServer,
  startLifecycleIndexerMockServer,
  startAnalyzeIndexerMockServer,
  startPolymarketMockServer,
};
