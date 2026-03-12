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
        body: {
          jsonrpc: '2.0',
          id: bodyJson.id || 1,
          result: Object.prototype.hasOwnProperty.call(codeByAddress, address) ? codeByAddress[address] : '0x',
        },
      };
    }

    return {
      status: 400,
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
  const marketAddress = String(options.marketAddress || ADDRESSES.mirrorMarket).toLowerCase();
  const factory = String(options.factory || ADDRESSES.factory).toLowerCase();
  const collateralToken = String(options.collateralToken || ADDRESSES.usdc).toLowerCase();
  const creator = String(options.creator || ADDRESSES.wallet1).toLowerCase();
  const platformTreasury = String(options.platformTreasury || ADDRESSES.wallet2).toLowerCase();
  const protocolFeesCollected = BigInt(options.protocolFeesCollected || 0n);
  const decimals = BigInt(options.decimals === undefined ? 6 : options.decimals);
  const symbol = String(options.symbol || 'USDC');
  const chainIdHex = options.chainIdHex || '0x1';

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

        if (target === marketAddress && selector === '0xcc08b834') {
          return { jsonrpc: '2.0', id, result: encodeUint256(protocolFeesCollected) };
        }
        if (target === marketAddress && selector === '0xb2016bd4') {
          return { jsonrpc: '2.0', id, result: encodeAddress(collateralToken) };
        }
        if (target === marketAddress && selector === '0x02d05d3f') {
          return { jsonrpc: '2.0', id, result: encodeAddress(creator) };
        }
        if (target === marketAddress && selector === '0xc45a0155') {
          return { jsonrpc: '2.0', id, result: encodeAddress(factory) };
        }
        if (target === factory && selector === '0xe138818c') {
          return { jsonrpc: '2.0', id, result: encodeAddress(platformTreasury) };
        }
        if (target === collateralToken && selector === '0x313ce567') {
          return { jsonrpc: '2.0', id, result: encodeUint256(decimals) };
        }
        if (target === collateralToken && selector === '0x95d89b41') {
          return { jsonrpc: '2.0', id, result: encodeString(symbol) };
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

test('help prints usage with zero exit code', () => {
  const result = runCli([]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.output, /pandora - Prediction market CLI/);
  assert.match(result.output, /Usage:/);
  assert.match(result.output, /pandora \[--output table\|json\] markets mine/);
  assert.match(result.output, /pandora \[--output table\|json\] fees/);
  assert.match(result.output, /pandora \[--output table\|json\] debug market\|tx/);
  assert.match(result.output, /mirror browse\|plan\|deploy\|verify\|lp-explain\|hedge-calc\|calc\|simulate\|go\|sync\|trace\|dashboard\|status\|health\|panic\|drift\|hedge-check\|pnl\|audit\|replay\|logs\|close/);
});

test('help accepts optional leading pandora token for npx compatibility', () => {
  const result = runCli(['pandora', '--help']);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.output, /pandora - Prediction market CLI/);
  assert.match(result.output, /Usage:/);
});

test('global --output json returns structured error envelope', () => {
  const result = runCli(['--output', 'json', 'not-a-command']);
  assert.equal(result.status, 1);

  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'UNKNOWN_COMMAND');
});

test('json error envelopes are emitted on stdout (not stderr)', () => {
  const result = runCli(['--output', 'json', 'not-a-command']);
  assert.equal(result.status, 1);
  assert.equal(String(result.stderr || '').trim(), '');
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'UNKNOWN_COMMAND');
});

test('invalid --output mode returns json error envelope', () => {
  const result = runCli(['--output', 'xml', 'help']);
  assert.equal(result.status, 1);
  assert.equal(String(result.stderr || '').trim(), '');
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_OUTPUT_MODE');
});

test('missing --output value returns json error envelope', () => {
  const result = runCli(['--output']);
  assert.equal(result.status, 1);
  assert.equal(String(result.stderr || '').trim(), '');
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'MISSING_FLAG_VALUE');
});

test('private key parse errors redact the provided key value', () => {
  const badPrivateKey = '0x1234';
  const result = runCli(['--output', 'json', 'mirror', 'deploy', '--private-key', badPrivateKey]);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /\[redacted\]/);
  assert.ok(!payload.error.message.includes(badPrivateKey));
});

test('unknown command prints help hint in table mode', () => {
  const result = runCli(['not-a-command']);
  assert.equal(result.status, 1);
  assert.match(result.output, /\[UNKNOWN_COMMAND\]/);
  assert.match(result.output, /Unknown command: not-a-command/);
  assert.match(result.output, /Run `pandora help` to see available commands\./);
});

test('schema command requires --output json mode', () => {
  const result = runCli(['schema']);
  assert.equal(result.status, 1);
  assert.match(result.output, /\[INVALID_USAGE\]/);
  assert.match(result.output, /only supported in --output json mode/i);
});

test('schema --help succeeds in table mode', () => {
  const result = runCli(['schema', '--help']);
  assert.equal(result.status, 0);
  assert.match(String(result.stdout || ''), /Usage:\s+pandora --output json schema/);
});

test('schema command returns envelope schema plus command descriptors', () => {
  const result = runCli(['--output', 'json', 'schema']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'schema');

  assert.equal(payload.data.title, 'PandoraCliEnvelope');
  assert.ok(String(payload.data.$schema).includes('json-schema.org'));
  assert.ok(payload.data.definitions && payload.data.definitions.SuccessEnvelope);
  assert.ok(payload.data.definitions && payload.data.definitions.ErrorEnvelope);

  assert.equal(payload.data.commandDescriptorVersion, COMMAND_DESCRIPTOR_VERSION);
  assert.ok(payload.data.commandDescriptors);
  assert.ok(payload.data.commandDescriptors.quote);
  assert.equal(payload.data.commandDescriptors.quote.dataSchema, '#/definitions/QuotePayload');
  assert.ok(payload.data.commandDescriptors.quote.emits.includes('quote'));
  assert.ok(payload.data.commandDescriptors.scan);
  assert.equal(payload.data.commandDescriptors.scan.dataSchema, '#/definitions/PagedEntityPayload');
  assert.ok(payload.data.commandDescriptors.stream);
  assert.equal(payload.data.commandDescriptors.stream.dataSchema, '#/definitions/StreamTickPayload');
  assert.equal(payload.data.commandDescriptors['markets.scan'], undefined);
  assert.ok(payload.data.commandDescriptors.trade);
  assert.equal(payload.data.commandDescriptors.trade.dataSchema, '#/definitions/TradePayload');
  assert.ok(payload.data.commandDescriptors.sell);
  assert.equal(payload.data.commandDescriptors.sell.dataSchema, '#/definitions/TradePayload');
  assert.ok(payload.data.commandDescriptors['mirror.browse']);
  assert.equal(payload.data.commandDescriptors['mirror.browse'].dataSchema, '#/definitions/MirrorBrowsePayload');
  assert.match(payload.data.commandDescriptors['mirror.browse'].usage, /--polymarket-tag-id/);
  assert.ok(payload.data.commandDescriptors['mirror.plan']);
  assert.equal(payload.data.commandDescriptors['mirror.plan'].dataSchema, '#/definitions/MirrorPlanPayload');
  assert.ok(payload.data.commandDescriptors['risk.show']);
  assert.equal(payload.data.commandDescriptors['risk.show'].dataSchema, '#/definitions/RiskPayload');
  assert.ok(payload.data.commandDescriptors['risk.panic']);
  assert.equal(payload.data.commandDescriptors['risk.panic'].dataSchema, '#/definitions/RiskPayload');
  assert.ok(payload.data.commandDescriptors.lifecycle);
  assert.equal(payload.data.commandDescriptors.lifecycle.dataSchema, '#/definitions/LifecyclePayload');
  assert.ok(payload.data.commandDescriptors['odds.record']);
  assert.equal(payload.data.commandDescriptors['odds.record'].dataSchema, '#/definitions/OddsRecordPayload');
  assert.ok(payload.data.commandDescriptors['odds.history']);
  assert.equal(payload.data.commandDescriptors['odds.history'].dataSchema, '#/definitions/OddsHistoryPayload');
  assert.ok(payload.data.commandDescriptors.portfolio);
  assert.equal(payload.data.commandDescriptors.portfolio.dataSchema, '#/definitions/PortfolioPayload');
  assert.ok(payload.data.commandDescriptors.export);
  assert.equal(payload.data.commandDescriptors.export.dataSchema, '#/definitions/ExportPayload');
  assert.ok(payload.data.commandDescriptors['arb.scan']);
  assert.equal(payload.data.commandDescriptors['arb.scan'].dataSchema, '#/definitions/ArbScanPayload');
  assert.match(payload.data.commandDescriptors['arb.scan'].usage, /--combinatorial/);
  assert.match(payload.data.commandDescriptors['arb.scan'].usage, /--slippage-pct-per-leg/);
  assert.ok(payload.data.commandDescriptors['simulate.mc']);
  assert.equal(payload.data.commandDescriptors['simulate.mc'].dataSchema, '#/definitions/SimulateMcPayload');
  assert.ok(payload.data.commandDescriptors['simulate.particle-filter']);
  assert.equal(
    payload.data.commandDescriptors['simulate.particle-filter'].dataSchema,
    '#/definitions/SimulateParticleFilterPayload',
  );
  assert.ok(payload.data.commandDescriptors['simulate.agents']);
  assert.equal(payload.data.commandDescriptors['simulate.agents'].dataSchema, '#/definitions/SimulateAgentsPayload');
  assert.ok(payload.data.commandDescriptors['model.score.brier']);
  assert.equal(payload.data.commandDescriptors['model.score.brier'].dataSchema, '#/definitions/ModelScoreBrierPayload');
  assert.ok(payload.data.commandDescriptors['model.calibrate']);
  assert.equal(payload.data.commandDescriptors['model.calibrate'].dataSchema, '#/definitions/ModelCalibratePayload');
  assert.ok(payload.data.commandDescriptors['model.correlation']);
  assert.equal(payload.data.commandDescriptors['model.correlation'].dataSchema, '#/definitions/ModelCorrelationPayload');
  assert.ok(payload.data.commandDescriptors['model.diagnose']);
  assert.equal(payload.data.commandDescriptors['model.diagnose'].dataSchema, '#/definitions/ModelDiagnosePayload');
  assert.ok(payload.data.commandDescriptors.schema);
  assert.deepEqual(payload.data.commandDescriptors.schema.outputModes, ['json']);
  assert.ok(payload.data.commandDescriptors.mcp);
  assert.deepEqual(payload.data.commandDescriptors.mcp.outputModes, ['table']);
  assert.ok(payload.data.commandDescriptors.launch);
  assert.deepEqual(payload.data.commandDescriptors.launch.outputModes, ['table']);
  assert.ok(payload.data.commandDescriptors['clone-bet']);
  assert.deepEqual(payload.data.commandDescriptors['clone-bet'].outputModes, ['table']);
  assert.equal(payload.data.descriptorScope, 'canonical-command-surface');
  assert.equal(payload.data.commandDescriptorMetadata.capabilities.supportsRemote, true);
  assert.equal(payload.data.trustDistribution.posture, 'repo-release-gates-and-published-surface-observed');
  assert.equal(payload.data.trustDistribution.distribution.rootPackage.name, repoPackage.name);
  assert.equal(
    payload.data.trustDistribution.distribution.generatedContractArtifacts.artifactVersion,
    generatedManifest.artifactVersion,
  );
  assert.equal(
    payload.data.trustDistribution.distribution.embeddedSdks.typescript.packageName,
    typescriptSdkPackage.name,
  );
  assert.equal(payload.data.trustDistribution.verification.benchmark.lockPath, 'benchmarks/locks/core.lock.json');
  assert.equal(payload.data.trustDistribution.verification.benchmark.lockPresent, true);
  assert.equal(payload.data.trustDistribution.verification.benchmark.reportPath, 'benchmarks/latest/core-report.json');
  assert.equal(payload.data.trustDistribution.verification.benchmark.reportPresent, true);
  assert.equal(
    payload.data.trustDistribution.verification.benchmark.reportOverallPass,
    latestBenchmarkReport.summary.overallPass,
  );
  assert.equal(
    payload.data.trustDistribution.verification.benchmark.reportContractLockMatchesExpected,
    latestBenchmarkReport.contractLockMatchesExpected,
  );
  assert.equal(payload.data.trustDistribution.distribution.platformValidation.ci.workflowPath, '.github/workflows/ci.yml');
  assert.deepEqual(payload.data.trustDistribution.distribution.platformValidation.ci.osMatrix, ['macos-latest', 'ubuntu-latest', 'windows-latest']);
  assert.deepEqual(payload.data.trustDistribution.distribution.platformValidation.ci.nodeVersions, ['20']);
  assert.equal(payload.data.trustDistribution.verification.ciWorkflow.path, '.github/workflows/ci.yml');
  assert.equal(payload.data.trustDistribution.verification.ciWorkflow.present, false);
  assert.ok(payload.data.trustDistribution.verification.releaseAssets.names.includes('checksums.sha256'));
  assert.ok(payload.data.trustDistribution.verification.releaseAssets.verificationMethods.includes('keyless-cosign-verify-blob'));
  assert.equal(payload.data.trustDistribution.distribution.signals.shipsTrustDocs, true);
  assert.equal(payload.data.trustDistribution.distribution.signals.shipsReleaseTrustScripts, false);
  assert.equal(payload.data.trustDistribution.distribution.signals.shipsBenchmarkHarness, false);
  assert.equal(payload.data.trustDistribution.distribution.signals.shipsBenchmarkReport, true);
  assert.equal(payload.data.trustDistribution.verification.scripts.build, null);
  assert.equal(payload.data.trustDistribution.verification.scripts.prepack, null);
  assert.equal(payload.data.trustDistribution.verification.scripts.checkReleaseTrust, null);
  assert.equal(payload.data.trustDistribution.verification.scripts.generateSbom, null);
  assert.equal(payload.data.trustDistribution.verification.scripts.releasePrep, null);
  assert.equal(payload.data.trustDistribution.verification.signals.buildRunsReleaseTrustCheck, true);
  assert.equal(payload.data.trustDistribution.verification.signals.prepackRunsReleaseTrustCheck, true);
  assert.equal(payload.data.trustDistribution.verification.signals.trustDocsPresent, true);
  assert.equal(payload.data.trustDistribution.verification.signals.releasePrepRunsSbom, false);
  assert.equal(payload.data.trustDistribution.verification.signals.releasePrepRunsTrustCheck, false);
  assert.equal(payload.data.trustDistribution.verification.signals.testRunsBenchmarkCheck, true);
  assert.equal(payload.data.trustDistribution.releaseGates.signals.workflowRunsNpmTest, true);
  assert.equal(payload.data.trustDistribution.releaseGates.signals.workflowRunsReleasePrep, true);
  assert.equal(payload.data.trustDistribution.releaseGates.signals.repoTestRunsSmoke, true);
  assert.equal(payload.data.trustDistribution.releaseGates.signals.repoReleasePrepRunsSmoke, true);
  assert.equal(payload.data.trustDistribution.releaseGates.signals.publishedReleasePrepRunsSmoke, false);
  assert.ok(
    payload.data.commandDescriptorMetadata.counts.supportsRemote >= Object.keys(payload.data.commandDescriptors).length,
  );
  assert.ok(payload.data.documentation.skills.some((doc) => doc.path === 'docs/trust/release-verification.md'));
  assert.ok(payload.data.documentation.skills.some((doc) => doc.path === 'docs/trust/security-model.md'));
  assert.ok(payload.data.documentation.skills.some((doc) => doc.path === 'docs/trust/support-matrix.md'));
  assert.ok(payload.data.definitions.TrustDistributionPayload);
  assert.ok(payload.data.definitions.QuotePayload);
  assert.ok(payload.data.definitions.TradePayload);
  assert.ok(payload.data.definitions.MirrorPlanPayload);
  assert.ok(payload.data.definitions.RiskPayload);
  assert.ok(payload.data.definitions.LifecyclePayload);
  assert.ok(payload.data.definitions.OddsRecordPayload);
  assert.ok(payload.data.definitions.OddsHistoryPayload);
  assert.ok(payload.data.definitions.PortfolioPayload);
  assert.ok(payload.data.definitions.ExportPayload);
  assert.ok(payload.data.definitions.ArbScanPayload);
  assert.ok(payload.data.definitions.SimulateMcPayload);
  assert.ok(payload.data.definitions.SimulateParticleFilterPayload);
  assert.ok(payload.data.definitions.SimulateAgentsPayload);
  assert.ok(payload.data.definitions.ModelScoreBrierPayload);
  assert.ok(payload.data.definitions.ModelCalibratePayload);
  assert.ok(payload.data.definitions.ModelCorrelationPayload);
  assert.ok(payload.data.definitions.ModelDiagnosePayload);
  assert.ok(payload.data.definitions.ErrorRecoveryPayload);
  assert.ok(payload.data.definitions.MirrorBrowsePayload);
  assert.ok(payload.data.definitions.VersionPayload);
  assert.ok(payload.data.definitions.InitEnvPayload);
  assert.ok(payload.data.definitions.DoctorPayload);
  assert.ok(payload.data.definitions.SetupPayload);
  assert.ok(payload.data.definitions.HistoryPayload);
  assert.ok(payload.data.definitions.ArbitragePayload);
  assert.ok(payload.data.definitions.PolymarketPayload);
  assert.ok(payload.data.definitions.WebhookPayload);
  assert.ok(payload.data.definitions.AnalyzePayload);
  assert.ok(payload.data.definitions.SuggestPayload);
  assert.ok(payload.data.definitions.OddsHelpPayload);
  assert.ok(payload.data.definitions.MirrorStatusHelpPayload);
  assert.ok(payload.data.definitions.OperationReceiptPayload);
  assert.ok(payload.data.definitions.OperationReceiptVerificationPayload);
});

test('schema command can include compatibility descriptors explicitly', () => {
  const result = runCli(['--output', 'json', 'schema', '--include-compatibility']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'schema');
  assert.equal(payload.data.descriptorScope, 'command-surface+compatibility');
  assert.ok(payload.data.commandDescriptors['markets.scan']);
  assert.equal(payload.data.commandDescriptors['markets.scan'].canonicalTool, 'scan');
  assert.equal(payload.data.commandDescriptors['markets.scan'].aliasOf, 'scan');
  assert.ok(payload.data.commandDescriptors.arbitrage);
  assert.equal(payload.data.commandDescriptors.arbitrage.canonicalTool, 'arb.scan');
  assert.equal(payload.data.commandDescriptors.arbitrage.aliasOf, 'arb.scan');
});

test('schema command covers every MCP tool and exposes canonical metadata', () => {
  const result = runCli(['--output', 'json', 'schema', '--include-compatibility']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  const descriptors = payload.data.commandDescriptors;
  const registry = createMcpToolRegistry();
  const defaultTools = registry.listTools();
  const allTools = registry.listTools({ includeCompatibilityAliases: true });
  const defaultToolNames = new Set(defaultTools.map((tool) => tool.name));
  const allToolNames = new Set(allTools.map((tool) => tool.name));

  for (const tool of allTools) {
    const descriptor = descriptors[tool.name];
    assert.ok(descriptor, `missing schema descriptor for MCP tool ${tool.name}`);
    assert.equal(descriptor.mcpExposed, true, `expected ${tool.name} to be MCP-exposed`);
    assert.equal(descriptor.canonicalTool, tool.xPandora.canonicalTool, `canonicalTool mismatch for ${tool.name}`);
    assert.equal(descriptor.aliasOf, tool.xPandora.aliasOf, `aliasOf mismatch for ${tool.name}`);
    assert.equal(descriptor.preferred, tool.xPandora.preferred, `preferred mismatch for ${tool.name}`);
    assert.equal(descriptor.mcpMutating, tool.xPandora.mutating, `mutating mismatch for ${tool.name}`);
    assert.equal(descriptor.mcpLongRunningBlocked, tool.xPandora.longRunningBlocked, `longRunning mismatch for ${tool.name}`);
    assert.deepEqual(
      descriptor.controlInputNames,
      tool.xPandora.controlInputNames,
      `controlInputNames mismatch for ${tool.name}`,
    );
    assert.deepEqual(
      descriptor.agentWorkflow,
      tool.xPandora.agentWorkflow,
      `agentWorkflow mismatch for ${tool.name}`,
    );
    assert.equal(typeof descriptor.inputSchema, 'object', `missing inputSchema for ${tool.name}`);
  }

  for (const [commandName, descriptor] of Object.entries(descriptors)) {
    if (descriptor.mcpExposed) {
      if (descriptor.aliasOf) {
        assert.ok(
          allToolNames.has(commandName),
          `schema marks ${commandName} as MCP-exposed alias but MCP tools/list(includeCompatibilityAliases) is missing it`,
        );
        assert.ok(
          !defaultToolNames.has(commandName),
          `compatibility alias ${commandName} should not appear in default MCP tools/list`,
        );
      } else {
        assert.ok(
          defaultToolNames.has(commandName),
          `schema marks ${commandName} as MCP-exposed canonical tool but default MCP tools/list is missing it`,
        );
      }
    }
  }

  assert.ok(descriptors['events.list']);
  assert.ok(descriptors['events.get']);
  assert.ok(descriptors['positions.list']);
  assert.ok(descriptors.history);
  assert.ok(descriptors.arbitrage);
  assert.ok(descriptors['polymarket.trade']);
  assert.ok(descriptors['webhook.test']);
  assert.ok(descriptors.launch);
  assert.ok(descriptors['clone-bet']);
  assert.equal(descriptors.arbitrage.aliasOf, 'arb.scan');
  assert.equal(descriptors.arbitrage.canonicalTool, 'arb.scan');
  assert.equal(descriptors.arbitrage.preferred, false);
  assert.equal(descriptors['arb.scan'].canonicalTool, 'arb.scan');
  assert.equal(descriptors['arb.scan'].preferred, true);
});

test('schema command preserves normalized MCP metadata defaults for primary and alias tools', () => {
  const result = runCli(['--output', 'json', 'schema', '--include-compatibility']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  const descriptors = payload.data.commandDescriptors;

  assert.equal(descriptors.help.canonicalTool, 'help');
  assert.equal(descriptors.help.aliasOf, null);
  assert.equal(descriptors.help.preferred, true);
  assert.equal(descriptors.help.mcpExposed, true);
  assert.equal(descriptors.help.mcpMutating, false);
  assert.equal(descriptors.help.mcpLongRunningBlocked, false);
  assert.deepEqual(descriptors.help.controlInputNames, []);
  assert.equal(descriptors.help.agentWorkflow, null);

  assert.equal(descriptors.arbitrage.canonicalTool, 'arb.scan');
  assert.equal(descriptors.arbitrage.aliasOf, 'arb.scan');
  assert.equal(descriptors.arbitrage.preferred, false);
  assert.equal(descriptors.arbitrage.mcpExposed, true);
  assert.equal(descriptors.arbitrage.mcpMutating, false);
  assert.equal(descriptors.arbitrage.mcpLongRunningBlocked, false);
  assert.deepEqual(descriptors.arbitrage.controlInputNames, []);
  assert.equal(descriptors.arbitrage.agentWorkflow, null);
});

test('schema help definitions match representative emitted help payloads', () => {
  const schemaResult = runCli(['--output', 'json', 'schema']);
  assert.equal(schemaResult.status, 0);
  const schemaPayload = parseJsonOutput(schemaResult);
  const schemaDocument = schemaPayload.data;
  const descriptors = schemaPayload.data.commandDescriptors;

  const oddsHelp = parseJsonOutput(runCli(['--output', 'json', 'odds', 'record', '--help']));
  assert.equal(oddsHelp.command, 'odds.help');
  assert.equal(descriptors.odds.helpDataSchema, '#/definitions/OddsHelpPayload');
  assert.equal(typeof oddsHelp.data.historyUsage, 'string');
  assertSchemaValid(schemaDocument, { $ref: descriptors.odds.helpDataSchema }, oddsHelp.data, 'odds.help');

  const mirrorStatusHelp = parseJsonOutput(runCli(['--output', 'json', 'mirror', 'status', '--help']));
  assert.equal(mirrorStatusHelp.command, 'mirror.status.help');
  assert.equal(descriptors['mirror.status'].helpDataSchema, '#/definitions/MirrorStatusHelpPayload');
  assert.ok(Array.isArray(mirrorStatusHelp.data.polymarketEnv));
  assert.equal(typeof mirrorStatusHelp.data.notes, 'object');
  assert.match(mirrorStatusHelp.data.usage, /--manifest-file <path>/);
  assert.match(mirrorStatusHelp.data.usage, /--indexer-url <url>/);
  assert.match(mirrorStatusHelp.data.usage, /--polymarket-gamma-url <url>/);
  assertSchemaValid(
    schemaDocument,
    { $ref: descriptors['mirror.status'].helpDataSchema },
    mirrorStatusHelp.data,
    'mirror.status.help',
  );

  const mirrorPnlHelp = parseJsonOutput(runCli(['--output', 'json', 'mirror', 'pnl', '--help']));
  assert.equal(mirrorPnlHelp.command, 'mirror.pnl.help');
  assert.equal(descriptors['mirror.pnl'].helpDataSchema, '#/definitions/CommandHelpPayload');
  assertSchemaValid(
    schemaDocument,
    { $ref: descriptors['mirror.pnl'].helpDataSchema },
    mirrorPnlHelp.data,
    'mirror.pnl.help',
  );

  const mirrorAuditHelp = parseJsonOutput(runCli(['--output', 'json', 'mirror', 'audit', '--help']));
  assert.equal(mirrorAuditHelp.command, 'mirror.audit.help');
  assert.equal(descriptors['mirror.audit'].helpDataSchema, '#/definitions/CommandHelpPayload');
  assertSchemaValid(
    schemaDocument,
    { $ref: descriptors['mirror.audit'].helpDataSchema },
    mirrorAuditHelp.data,
    'mirror.audit.help',
  );

  const polymarketWithdrawHelp = parseJsonOutput(runCli(['--output', 'json', 'polymarket', 'withdraw', '--help']));
  assert.equal(polymarketWithdrawHelp.command, 'polymarket.withdraw.help');
  assert.match(polymarketWithdrawHelp.data.usage, /polymarket withdraw --amount-usdc/);
  assert.equal(Array.isArray(polymarketWithdrawHelp.data.notes), true);
  assert.equal(
    polymarketWithdrawHelp.data.notes.some((line) => /signer controls the source wallet/i.test(String(line))),
    true,
  );

  const tradeQuoteHelp = parseJsonOutput(runCli(['--output', 'json', 'trade', 'quote', '--help']));
  assert.equal(tradeQuoteHelp.command, 'trade.quote.help');
  assert.ok(descriptors.trade.emits.includes('trade.quote.help'));

  const sellHelp = parseJsonOutput(runCli(['--output', 'json', 'sell', '--help']));
  assert.equal(sellHelp.command, 'sell.help');
  assert.ok(descriptors.sell.emits.includes('sell.help'));

  const sellQuoteHelp = parseJsonOutput(runCli(['--output', 'json', 'sell', 'quote', '--help']));
  assert.equal(sellQuoteHelp.command, 'sell.quote.help');
  assert.ok(descriptors.sell.emits.includes('sell.quote.help'));

  const simulateAgentsHelp = parseJsonOutput(runCli(['--output', 'json', 'simulate', 'agents', '--help']));
  assert.equal(simulateAgentsHelp.command, 'simulate.agents.help');
  assert.ok(descriptors['simulate.agents'].emits.includes('simulate.agents.help'));

  const lifecycleStartHelp = parseJsonOutput(runCli(['--output', 'json', 'lifecycle', 'start', '--help']));
  assert.equal(lifecycleStartHelp.command, 'lifecycle.start.help');
  assert.ok(descriptors['lifecycle.start'].emits.includes('lifecycle.start.help'));

  const capabilitiesHelp = parseJsonOutput(runCli(['--output', 'json', 'capabilities', '--help']));
  assert.equal(capabilitiesHelp.command, 'capabilities.help');
  assert.equal(descriptors.capabilities.helpDataSchema, '#/definitions/CapabilitiesHelpPayload');
  assertSchemaValid(
    schemaDocument,
    { $ref: descriptors.capabilities.helpDataSchema },
    capabilitiesHelp.data,
    'capabilities.help',
  );

  const schemaHelp = parseJsonOutput(runCli(['--output', 'json', 'schema', '--help']));
  assert.equal(schemaHelp.command, 'schema.help');
  assert.equal(descriptors.schema.helpDataSchema, '#/definitions/SchemaHelpPayload');
  assertSchemaValid(
    schemaDocument,
    { $ref: descriptors.schema.helpDataSchema },
    schemaHelp.data,
    'schema.help',
  );
});

test('every declared help payload validates against its published help schema', () => {
  const schemaEnvelope = parseJsonOutput(runCli(['--output', 'json', 'schema']));
  const schemaDocument = schemaEnvelope.data;
  const descriptors = schemaDocument.commandDescriptors;

  for (const [commandName, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.helpDataSchema || !Array.isArray(descriptor.outputModes) || !descriptor.outputModes.includes('json')) {
      continue;
    }
    if (!Array.isArray(descriptor.canonicalCommandTokens) || descriptor.canonicalCommandTokens.length === 0) {
      continue;
    }

    const result = runCli(['--output', 'json', ...descriptor.canonicalCommandTokens, '--help']);
    assert.equal(result.status, 0, `expected --help to succeed for ${commandName}: ${result.output || result.stderr}`);
    const payload = parseJsonOutput(result);
    assertSchemaValid(
      schemaDocument,
      { $ref: descriptor.helpDataSchema },
      payload.data,
      `${commandName}.help`,
    );
  }
});

test('schema and capabilities payloads validate against published definitions', () => {
  const schemaResult = runCli(['--output', 'json', 'schema']);
  assert.equal(schemaResult.status, 0);
  const schemaEnvelope = parseJsonOutput(schemaResult);
  const schemaDocument = schemaEnvelope.data;

  const capabilitiesResult = runCli(['--output', 'json', 'capabilities']);
  assert.equal(capabilitiesResult.status, 0);
  const capabilitiesEnvelope = parseJsonOutput(capabilitiesResult);

  assertSchemaValid(
    schemaDocument,
    { $ref: '#/definitions/SchemaCommandPayload' },
    schemaDocument,
    'schema',
  );
  assertSchemaValid(
    schemaDocument,
    { $ref: '#/definitions/CapabilitiesPayload' },
    capabilitiesEnvelope.data,
    'capabilities',
  );
});

test('bootstrap payload validates against its published definition', () => {
  const schemaResult = runCli(['--output', 'json', 'schema']);
  assert.equal(schemaResult.status, 0);
  const schemaEnvelope = parseJsonOutput(schemaResult);
  const schemaDocument = schemaEnvelope.data;

  const bootstrapResult = runCli(['--output', 'json', 'bootstrap']);
  assert.equal(bootstrapResult.status, 0);
  const bootstrapEnvelope = parseJsonOutput(bootstrapResult);

  assertSchemaValid(
    schemaDocument,
    { $ref: '#/definitions/BootstrapPayload' },
    bootstrapEnvelope.data,
    'bootstrap',
  );
  assert.equal(bootstrapEnvelope.data.readinessMode, 'artifact-neutral');
  assert.equal(bootstrapEnvelope.data.preferences.recommendedFirstCall, 'bootstrap');
  assert.equal(bootstrapEnvelope.data.recommendedBootstrapFlow[0], 'bootstrap');
  assert.ok(!bootstrapEnvelope.data.canonicalTools.includes('arbitrage'));
});

test('generated SDK contract bundle stays in parity with live schema and capabilities commands', () => {
  const tempDir = createTempDir('pandora-sdk-cli-parity-');
  const env = createIsolatedPandoraEnv(tempDir);

  try {
    const schemaEnvelope = parseJsonOutput(runCli(['--output', 'json', 'schema'], { env }));
    const capabilitiesEnvelope = parseJsonOutput(runCli(['--output', 'json', 'capabilities'], { env }));
    const artifact = buildSdkContractArtifact({
      packageVersion: generatedManifest.packageVersion,
      remoteTransportActive: false,
    });

    assertManifestParity(generatedManifest, artifact);
    assert.deepEqual(artifact.commandDescriptors, schemaEnvelope.data.commandDescriptors);
    assert.deepEqual(
      omitTrustDistributionDefinitions(artifact.schemas.definitions),
      omitTrustDistributionDefinitions(schemaEnvelope.data.definitions),
    );
    assert.deepEqual(
      omitTrustDistributionFromCapabilities(omitGeneratedAt(artifact.capabilities)),
      omitTrustDistributionFromCapabilities(omitGeneratedAt(capabilitiesEnvelope.data)),
    );
    assert.equal(artifact.capabilities.generatedAt, SDK_ARTIFACT_GENERATED_AT);
    assert.deepEqual(generatedContractRegistry.commandDescriptors, schemaEnvelope.data.commandDescriptors);
    assert.deepEqual(generatedContractRegistry.schemas.envelope.commandDescriptors, schemaEnvelope.data.commandDescriptors);
    assert.deepEqual(
      omitTrustDistributionDefinitions(generatedContractRegistry.schemas.envelope.definitions),
      omitTrustDistributionDefinitions(artifact.schemas.envelope.definitions),
    );
    assert.deepEqual(
      omitTrustDistributionFromCapabilities(omitGeneratedAt(generatedContractRegistry.capabilities)),
      omitTrustDistributionFromCapabilities(omitGeneratedAt(artifact.capabilities)),
    );
    assert.deepEqual(
      {
        ...omitGeneratedAt(artifact.schemas.envelope),
        definitions: omitTrustDistributionDefinitions(artifact.schemas.envelope.definitions),
      },
      {
        ...omitGeneratedAt(schemaEnvelope.data),
        definitions: omitTrustDistributionDefinitions(schemaEnvelope.data.definitions),
      },
      'SDK schema bundle should match the live schema payload aside from deterministic generatedAt and live trust-distribution definitions.',
    );
    assert.equal(
      artifact.schemas.envelope.schemaVersion,
      schemaEnvelope.data.schemaVersion,
      'SDK schema bundle should preserve schemaVersion from the live schema command payload.',
    );
    assert.equal(
      artifact.schemas.envelope.generatedAt,
      SDK_ARTIFACT_GENERATED_AT,
      'SDK schema bundle should stamp a deterministic generatedAt for packaged SDK artifacts.',
    );
  } finally {
    removeDir(tempDir);
  }
});

test('schema command rejects unknown trailing flags', () => {
  const result = runCli(['--output', 'json', 'schema', '--bad-flag']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_ARGS');
});

test('capabilities command requires --output json mode', () => {
  const result = runCli(['capabilities']);
  assert.equal(result.status, 1);
  assert.match(result.output, /\[INVALID_USAGE\]/);
  assert.match(result.output, /only supported in --output json mode/i);
});

test('capabilities --help succeeds in table mode', () => {
  const result = runCli(['capabilities', '--help']);
  assert.equal(result.status, 0);
  assert.match(String(result.stdout || ''), /Usage:\s+pandora --output json capabilities/);
});

  test('capabilities command returns a derived command-contract digest', () => {
  const schemaResult = runCli(['--output', 'json', 'schema']);
  assert.equal(schemaResult.status, 0);
  const schemaPayload = parseJsonOutput(schemaResult);
  const result = runCli(['--output', 'json', 'capabilities']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  const capabilityBytes = Buffer.byteLength(result.stdout || '', 'utf8');
  const schemaBytes = Buffer.byteLength(schemaResult.stdout || '', 'utf8');
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'capabilities');

  assert.equal(payload.data.title, 'PandoraCliCapabilities');
  assert.equal(payload.data.source, 'agent_contract_registry');
  assert.equal(payload.data.commandDescriptorVersion, schemaPayload.data.commandDescriptorVersion);
  assert.deepEqual(payload.data.trustDistribution, schemaPayload.data.trustDistribution);
  assert.equal(payload.data.trustDistribution.distribution.rootPackage.name, repoPackage.name);
  assert.equal(payload.data.trustDistribution.distribution.rootPackage.version, repoPackage.version);
  assert.equal(payload.data.trustDistribution.verification.benchmark.reportPresent, true);
  assert.equal(
    payload.data.trustDistribution.verification.benchmark.reportOverallPass,
    latestBenchmarkReport.summary.overallPass,
  );
  assert.equal(
    payload.data.trustDistribution.verification.benchmark.reportContractLockMatchesExpected,
    latestBenchmarkReport.contractLockMatchesExpected,
  );
  assert.deepEqual(
    payload.data.trustDistribution.distribution.rootPackage.binNames,
    Object.keys(repoPackage.bin || {}).sort(),
  );
  assert.equal(
    payload.data.trustDistribution.distribution.generatedContractArtifacts.artifactVersion,
    generatedManifest.artifactVersion,
  );
  assert.equal(
    payload.data.trustDistribution.distribution.embeddedSdks.typescript.packageName,
    typescriptSdkPackage.name,
  );
  assert.deepEqual(payload.data.transports.sdk.packages.typescript.installExamples, [
    `npm install ${typescriptSdkPackage.name}@${typescriptSdkPackage.version}`,
    'npm install /path/to/downloaded/pandora-agent-sdk-<version>.tgz',
  ]);
  assert.equal(
    payload.data.trustDistribution.distribution.embeddedSdks.python.packageName,
    parseTomlStringField(
      fs.readFileSync(path.join(__dirname, '..', '..', 'sdk', 'python', 'pyproject.toml'), 'utf8'),
      'name',
    ),
  );
  assert.deepEqual(payload.data.transports.sdk.packages.python.installExamples, [
    `pip install ${payload.data.trustDistribution.distribution.embeddedSdks.python.packageName}==${payload.data.trustDistribution.distribution.embeddedSdks.python.version}`,
    'pip install /path/to/downloaded/pandora_agent-<version>-py3-none-any.whl',
    'pip install /path/to/downloaded/pandora_agent-<version>.tar.gz',
  ]);
  assert.equal(payload.data.trustDistribution.verification.scripts.build, null);
  assert.equal(payload.data.trustDistribution.verification.scripts.prepack, null);
  assert.equal(payload.data.trustDistribution.verification.scripts.benchmarkCheck, null);
  assert.equal(payload.data.trustDistribution.verification.scripts.checkReleaseTrust, null);
  assert.equal(payload.data.trustDistribution.verification.scripts.generateSbom, null);
  assert.equal(payload.data.trustDistribution.verification.scripts.releasePrep, null);
  assert.equal(payload.data.trustDistribution.distribution.platformValidation.release.workflowPath, '.github/workflows/release.yml');
  assert.ok(payload.data.trustDistribution.distribution.platformValidation.release.osMatrix.includes('ubuntu-latest'));
  assert.equal(payload.data.trustDistribution.verification.ciWorkflow.present, false);
  assert.ok(
    payload.data.trustDistribution.verification.releaseAssets.names.includes(
      `pandora-cli-skills-${repoPackage.version}.tgz.intoto.jsonl`,
    ),
  );
  assert.ok(payload.data.trustDistribution.verification.releaseAssets.verificationMethods.includes('github-build-provenance-attestation'));
  assert.equal(payload.data.trustDistribution.verification.signals.prepublishOnlyRunsTest, true);
  assert.equal(payload.data.trustDistribution.verification.signals.testRunsSmoke, true);
  assert.equal(payload.data.trustDistribution.verification.signals.smokeTestsPresent, false);
  assert.equal(payload.data.trustDistribution.verification.signals.buildRunsReleaseTrustCheck, true);
  assert.equal(payload.data.trustDistribution.verification.signals.prepackRunsReleaseTrustCheck, true);
  assert.equal(payload.data.trustDistribution.verification.signals.trustDocsPresent, true);
  assert.equal(payload.data.trustDistribution.verification.signals.releasePrepRunsSbom, false);
  assert.equal(payload.data.trustDistribution.verification.signals.releasePrepRunsTrustCheck, false);
  assert.equal(payload.data.trustDistribution.distribution.signals.shipsTrustDocs, true);
  assert.equal(payload.data.trustDistribution.distribution.signals.shipsReleaseTrustScripts, false);
  assert.equal(payload.data.trustDistribution.distribution.signals.shipsBenchmarkHarness, false);
  assert.equal(payload.data.trustDistribution.distribution.signals.shipsBenchmarkReport, true);
  assert.equal(payload.data.trustDistribution.releaseGates.commands.test, repoPackage.scripts.test);
  assert.equal(payload.data.trustDistribution.releaseGates.commands.releasePrep, repoPackage.scripts['release:prep']);
  assert.equal(payload.data.trustDistribution.releaseGates.signals.workflowRunsNpmTest, true);
  assert.equal(payload.data.trustDistribution.releaseGates.signals.workflowRunsReleasePrep, true);
  assert.equal(payload.data.trustDistribution.releaseGates.signals.repoTestRunsSmoke, true);
  assert.equal(payload.data.trustDistribution.releaseGates.signals.repoReleasePrepRunsSmoke, true);
  assert.equal(payload.data.trustDistribution.releaseGates.signals.publishedSmokeCommandExposed, false);
  assert.equal(payload.data.trustDistribution.releaseGates.signals.packagedSmokeFixturesPresent, false);
  assert.ok(payload.data.summary.totalCommands > 0);
  assert.ok(payload.data.summary.mcpExposedCommands > 0);
  assert.ok(payload.data.outputModeMatrix.jsonOnly.includes('schema'));
  assert.ok(payload.data.outputModeMatrix.tableOnly.includes('mcp'));
  assert.ok(payload.data.outputModeMatrix.tableAndJson.includes('quote'));
  assert.ok(payload.data.topLevelCommands.markets);
  assert.ok(payload.data.topLevelCommands.arb);
  assert.ok(payload.data.routedTopLevelCommands.includes('arb'));
  assert.ok(payload.data.topLevelCommands.markets.childCommands.includes('markets.list'));
  assert.ok(payload.data.namespaces.mirror.commands.includes('mirror.plan'));
  assert.ok(payload.data.namespaces.agent.mcpExposedCommands.includes('agent.market.validate'));
  assert.ok(payload.data.documentation.skills.some((doc) => doc.id === 'release-verification'));
  assert.ok(payload.data.documentation.skills.some((doc) => doc.id === 'security-model'));
  assert.ok(payload.data.documentation.skills.some((doc) => doc.id === 'support-matrix'));
  assert.ok(payload.data.documentation.router.taskRoutes.some((route) => route.label === 'Release verification, support matrix, or security posture'));
  assert.equal(payload.data.discoveryPreferences.canonicalOnlyDefault, true);
  assert.equal(payload.data.discoveryPreferences.includeCompatibility, false);
  assert.ok(payload.data.discoveryPreferences.hiddenAliasCount >= 1);
  assert.deepEqual(payload.data.canonicalTools['arb.scan'].commands, ['arb.scan']);
  assert.equal(payload.data.canonicalTools['arb.scan'].preferredCommand, 'arb.scan');
    assert.ok(payload.data.commandDigests.quote);
  assert.equal(Object.keys(payload.data.commandDigests).length, Object.keys(schemaPayload.data.commandDescriptors).length);
    assert.equal(payload.data.commandDigests.quote.summary.length > 0, true);
    assert.deepEqual(payload.data.commandDigests.trade.canonicalCommandTokens, ['trade']);
  assert.ok(payload.data.commandDigests.trade.emits.includes('trade'));
  assert.deepEqual(payload.data.commandDigests.trade.safeFlags, ['--dry-run']);
  assert.deepEqual(payload.data.commandDigests.trade.executeFlags, ['--execute']);
  assert.equal(payload.data.commandDigests.trade.executeIntentRequired, false);
  assert.equal(payload.data.commandDigests.trade.executeIntentRequiredForLiveMode, true);
  assert.deepEqual(payload.data.commandDigests.trade.requiredInputs, ['amount-usdc', 'market-address', 'side']);
  assert.equal(payload.data.commandDigests.trade.remoteEligible, true);
  assert.equal(payload.data.commandDigests.trade.safeEquivalent, 'quote');
  assert.equal(payload.data.commandDigests.trade.recommendedPreflightTool, 'quote');
  assert.equal(payload.data.commandDigests.capabilities.supportsRemote, true);
  assert.equal(payload.data.commandDigests.capabilities.remoteEligible, true);
  assert.equal(payload.data.commandDigests.capabilities.remoteTransportActive, false);
  assert.equal(payload.data.transports.mcpStreamableHttp.supported, true);
  assert.equal(payload.data.transports.mcpStreamableHttp.status, 'inactive');
  assert.ok(
    payload.data.transports.mcpStreamableHttp.notes.some((note) => /inactive/i.test(note) && /pandora mcp http/i.test(note)),
  );
  assert.ok(
    payload.data.versionCompatibility.notes.some((note) => /inactive/i.test(note) && /streamable http/i.test(note)),
  );
  assert.ok(payload.data.roadmapSignals.remoteEligibleCommands > 0);
  assert.ok(payload.data.commandDigests['mirror.sync.start'].externalDependencies.includes('wallet-secrets'));
  assert.ok(payload.data.commandDigests['mirror.sync.start'].externalDependencies.includes('notification-secrets'));
  assert.equal(payload.data.commandDigests.trade.remotePlanned, true);
  assert.equal(payload.data.commandDigests['mirror.sync.start'].returnsOperationId, true);
  assert.equal(payload.data.commandDigests['mirror.sync.start'].returnsRuntimeHandle, false);
  assert.equal(payload.data.commandDigests['mirror.sync.stop'].returnsRuntimeHandle, false);
  assert.equal(payload.data.commandDigests.help.canRunConcurrent, true);
  assert.equal(payload.data.registryDigest.descriptorHash.length, 64);
  assert.equal(payload.data.registryDigest.descriptorHash, stableJsonHash(schemaPayload.data.commandDescriptors));
  assert.equal(payload.data.registryDigest.commandDigestHash.length, 64);
  assert.equal(payload.data.registryDigest.commandDigestHash, stableJsonHash(payload.data.commandDigests));
  assert.equal(payload.data.registryDigest.canonicalHash, stableJsonHash(payload.data.canonicalTools));
  assert.equal(payload.data.registryDigest.topLevelHash, stableJsonHash(payload.data.topLevelCommands));
  assert.equal(payload.data.registryDigest.routedTopLevelHash, stableJsonHash(payload.data.routedTopLevelCommands));
  assert.equal(payload.data.registryDigest.namespaceHash, stableJsonHash(payload.data.namespaces));
  assert.equal(payload.data.summary.discoveryCommands, Object.keys(schemaPayload.data.commandDescriptors).length);
  assert.ok(capabilityBytes < schemaBytes * 0.5, `capabilities should stay materially smaller than schema (${capabilityBytes} vs ${schemaBytes})`);
  assert.ok(capabilityBytes < 300000, `capabilities payload should stay compact (${capabilityBytes} bytes)`);
  });

test('capabilities command can include compatibility aliases explicitly', () => {
  const result = runCli(['--output', 'json', 'capabilities', '--include-compatibility']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'capabilities');
  assert.equal(payload.data.discoveryPreferences.includeCompatibility, true);
  assert.ok(payload.data.commandDigests.arbitrage);
  assert.equal(payload.data.commandDigests.arbitrage.aliasOf, 'arb.scan');
  assert.equal(
    Object.keys(payload.data.commandDigests).length,
    Object.keys(buildSchemaPayload({ includeCompatibility: true }).commandDescriptors).length,
  );
  assert.ok(payload.data.canonicalTools['arb.scan'].commands.includes('arbitrage'));
});

  test('json help payload includes output-mode routing notes', () => {
    const result = runCli(['--output', 'json', 'help']);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.ok(Array.isArray(payload.data.notes));
  assert.ok(payload.data.usage.some((line) => /markets mine/.test(line)));
  assert.ok(payload.data.usage.some((line) => /mirror .*logs/.test(line)));
  assert.deepEqual(payload.data.modeRouting, {
    jsonOnly: ['bootstrap', 'capabilities', 'schema'],
    stdioOnly: ['mcp'],
    scriptNative: ['launch', 'clone-bet'],
  });
  assert.ok(
    payload.data.notes.some(
      (note) => /json-only/i.test(note) && /bootstrap/i.test(note) && /capabilities/i.test(note) && /schema/i.test(note),
    ),
  );
  assert.ok(payload.data.notes.some((note) => /mcp/i.test(note) && /stdio server mode/i.test(note)));
  assert.ok(payload.data.usage.some((entry) => /markets mine/.test(String(entry))));
  assert.ok(payload.data.usage.some((entry) => /mirror .*logs/.test(String(entry))));
  });

test('capabilities command rejects unknown trailing flags', () => {
  const result = runCli(['--output', 'json', 'capabilities', '--bad-flag']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_ARGS');
});

test('mcp command rejects --output json mode with stable CLI error', () => {
  const result = runCli(['--output', 'json', 'mcp']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'UNSUPPORTED_OUTPUT_MODE');
});

test('json success envelopes include schemaVersion and generatedAt metadata', () => {
  const result = runCli(['--output', 'json', 'quote', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(typeof payload.data.schemaVersion, 'string');
  assertIsoTimestamp(payload.data.generatedAt);
});

test('risk show and panic commands manage state in json envelopes', () => {
  const tempHome = createTempDir('pandora-risk-cli-');
  try {
    const env = { HOME: tempHome, PANDORA_RISK_FILE: path.join(tempHome, 'risk.json') };

    const showInitial = runCli(['--output', 'json', 'risk', 'show'], { env });
    assert.equal(showInitial.status, 0);
    const showInitialPayload = parseJsonOutput(showInitial);
    assert.equal(showInitialPayload.ok, true);
    assert.equal(showInitialPayload.command, 'risk.show');
    assert.equal(showInitialPayload.data.panic.active, false);

    const engage = runCli(['--output', 'json', 'risk', 'panic', '--reason', 'incident test'], { env });
    assert.equal(engage.status, 0);
    const engagePayload = parseJsonOutput(engage);
    assert.equal(engagePayload.ok, true);
    assert.equal(engagePayload.command, 'risk.panic');
    assert.equal(engagePayload.data.action, 'engage');
    assert.equal(engagePayload.data.panic.active, true);
    assert.equal(Array.isArray(engagePayload.data.stopFiles), true);
    assert.equal(engagePayload.data.stopFiles.length, 0);

    const showAfter = runCli(['--output', 'json', 'risk', 'show'], { env });
    assert.equal(showAfter.status, 0);
    const showAfterPayload = parseJsonOutput(showAfter);
    assert.equal(showAfterPayload.data.panic.active, true);

    const clear = runCli(['--output', 'json', 'risk', 'panic', '--clear'], { env });
    assert.equal(clear.status, 0);
    const clearPayload = parseJsonOutput(clear);
    assert.equal(clearPayload.ok, true);
    assert.equal(clearPayload.command, 'risk.panic');
    assert.equal(clearPayload.data.action, 'clear');
    assert.equal(clearPayload.data.panic.active, false);
  } finally {
    removeDir(tempHome);
  }
});

test('risk panic blocks live writes before onchain execution', () => {
  const tempHome = createTempDir('pandora-risk-block-live-');
  const env = { HOME: tempHome, PANDORA_RISK_FILE: path.join(tempHome, 'risk.json') };
  try {
    const panic = runCli(['--output', 'json', 'risk', 'panic', '--reason', 'block all'], { env });
    assert.equal(panic.status, 0);

    const blocked = runCli([
      '--output', 'json', 'resolve',
      '--poll-address', ADDRESSES.mirrorPoll,
      '--answer', 'yes',
      '--reason', 'manual resolve',
      '--execute',
    ], { env });
    assert.equal(blocked.status, 1);
    const payload = parseJsonOutput(blocked);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'RISK_PANIC_ACTIVE');
  } finally {
    removeDir(tempHome);
  }
});

test('operations list/get/receipt/verify-receipt/cancel/close manage durable operation records in json envelopes', async () => {
  const tempDir = createTempDir('pandora-operations-cli-');
  try {
    const schemaPayload = parseJsonOutput(runCli(['--output', 'json', 'schema']));
    const schemaDocument = schemaPayload.data;
    const descriptors = schemaDocument.commandDescriptors;
    const operationDir = path.join(tempDir, 'operations');
    const service = createOperationService({
      operationStateStore: createOperationStateStore({ rootDir: operationDir }),
    });
    const created = await service.createCompleted({
      command: 'mirror.deploy',
      request: { marketAddress: ADDRESSES.mirrorMarket, execute: false },
      summary: 'Mirror deploy test',
      result: { txHash: '0xabc123' },
    });
    const planned = await service.createPlanned({
      command: 'mirror.sync.start',
      request: { marketAddress: ADDRESSES.mirrorMarket, execute: false },
      summary: 'Mirror sync plan',
    });
    const env = { HOME: tempDir, PANDORA_OPERATION_DIR: operationDir };

    const listResult = runCli(['--output', 'json', 'operations', 'list', '--status', 'planned'], { env });
    assert.equal(listResult.status, 0);
    const listPayload = parseJsonOutput(listResult);
    assert.equal(listPayload.command, 'operations.list');
    assert.equal(listPayload.data.count, 1);
    assert.equal(listPayload.data.items[0].operationId, planned.operationId);
    assertSchemaValid(schemaDocument, { $ref: descriptors['operations.list'].dataSchema }, listPayload.data, 'operations.list');

    const completedListResult = runCli(['--output', 'json', 'operations', 'list', '--status', 'completed'], { env });
    assert.equal(completedListResult.status, 0);
    const completedListPayload = parseJsonOutput(completedListResult);
    assert.equal(completedListPayload.data.count, 1);
    assert.equal(completedListPayload.data.items[0].operationId, created.operationId);

    const getResult = runCli(['--output', 'json', 'operations', 'get', '--id', created.operationId], { env });
    assert.equal(getResult.status, 0);
    const getPayload = parseJsonOutput(getResult);
    assert.equal(getPayload.command, 'operations.get');
    assert.equal(getPayload.data.operationId, created.operationId);
    assertSchemaValid(schemaDocument, { $ref: descriptors['operations.get'].dataSchema }, getPayload.data, 'operations.get');

    const receiptResult = runCli(['--output', 'json', 'operations', 'receipt', '--id', created.operationId], { env });
    assert.equal(receiptResult.status, 0);
    const receiptPayload = parseJsonOutput(receiptResult);
    assert.equal(receiptPayload.command, 'operations.receipt');
    assert.equal(receiptPayload.data.operationId, created.operationId);
    assert.equal(receiptPayload.data.result.txHash, '0xabc123');
    assertSchemaValid(schemaDocument, { $ref: descriptors['operations.receipt'].dataSchema }, receiptPayload.data, 'operations.receipt');

    const receiptFile = createOperationStateStore({ rootDir: operationDir }).receiptFile(created.operationId);
    const verifyResult = runCli(['--output', 'json', 'operations', 'verify-receipt', '--file', receiptFile], { env });
    assert.equal(verifyResult.status, 0);
    const verifyPayload = parseJsonOutput(verifyResult);
    assert.equal(verifyPayload.command, 'operations.verify-receipt');
    assert.equal(verifyPayload.data.ok, true);
    assert.equal(verifyPayload.data.source.type, 'file');
    assertSchemaValid(schemaDocument, { $ref: descriptors['operations.verify-receipt'].dataSchema }, verifyPayload.data, 'operations.verify-receipt');

    const verifyByIdResult = runCli(['--output', 'json', 'operations', 'verify-receipt', '--id', created.operationId], { env });
    assert.equal(verifyByIdResult.status, 0);
    const verifyByIdPayload = parseJsonOutput(verifyByIdResult);
    assert.equal(verifyByIdPayload.command, 'operations.verify-receipt');
    assert.equal(verifyByIdPayload.data.ok, true);
    assert.equal(verifyByIdPayload.data.source.type, 'operation-id');
    assert.equal(verifyByIdPayload.data.source.value, created.operationId);

    const verifyWrongHashResult = runCli([
      '--output', 'json', 'operations', 'verify-receipt', '--file', receiptFile,
      '--expected-operation-hash', 'f'.repeat(64),
    ], { env });
    assert.equal(verifyWrongHashResult.status, 0);
    const verifyWrongHashPayload = parseJsonOutput(verifyWrongHashResult);
    assert.equal(verifyWrongHashPayload.command, 'operations.verify-receipt');
    assert.equal(verifyWrongHashPayload.data.ok, false);
    assert.match(verifyWrongHashPayload.data.mismatches.join(' | '), /operationHash/i);

    const cancelResult = runCli(['--output', 'json', 'operations', 'cancel', '--id', planned.operationId, '--reason', 'stop'], { env });
    assert.equal(cancelResult.status, 0);
    const cancelPayload = parseJsonOutput(cancelResult);
    assert.equal(cancelPayload.command, 'operations.cancel');
    assert.equal(cancelPayload.data.status, 'canceled');

    const closeResult = runCli(['--output', 'json', 'operations', 'close', '--id', cancelPayload.data.operationId], { env });
    assert.equal(closeResult.status, 0);
    const closePayload = parseJsonOutput(closeResult);
    assert.equal(closePayload.command, 'operations.close');
    assert.equal(closePayload.data.status, 'closed');
  } finally {
    removeDir(tempDir);
  }
});

test('mirror close dry-run decorates payloads with a durable operation record', () => {
  const tempDir = createTempDir('pandora-mirror-close-operation-');
  try {
    const operationDir = path.join(tempDir, 'operations');
    const env = {
      HOME: tempDir,
      PANDORA_OPERATION_DIR: operationDir,
    };
    const result = runCli(['--output', 'json', 'mirror', 'close', '--all', '--dry-run'], { env });
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.command, 'mirror.close');
    assert.match(payload.data.operationId, /^mirror-close/);

    const store = createOperationStateStore({ rootDir: operationDir });
    const lookup = store.get(payload.data.operationId);
    assert.equal(lookup.found, true);
    assert.equal(lookup.operation.command, 'mirror.close');
    assert.equal(lookup.operation.status, 'planned');
  } finally {
    removeDir(tempDir);
  }
});

test('init-env copies example file and enforces --force overwrite', () => {
  const tempDir = createTempDir('pandora-init-env-');
  const examplePath = path.join(tempDir, 'fixtures', 'custom.example.env');
  const targetPath = path.join(tempDir, 'runtime', '.env');
  const exampleContent = ['ALPHA=1', 'BETA=2', 'GAMMA=3'].join('\n');

  writeFile(examplePath, exampleContent);

  const first = runCli(['init-env', '--example', examplePath, '--dotenv-path', targetPath]);
  assert.equal(first.status, 0);
  assert.match(first.output, /Wrote env file:/);
  assert.equal(fs.readFileSync(targetPath, 'utf8'), exampleContent);

  const second = runCli(['init-env', '--example', examplePath, '--dotenv-path', targetPath]);
  assert.equal(second.status, 1);
  assert.match(second.output, /Env file already exists:/);

  const forced = runCli(['init-env', '--force', '--example', examplePath, '--dotenv-path', targetPath]);
  assert.equal(forced.status, 0);
  assert.match(forced.output, /Wrote env file:/);

  removeDir(tempDir);
});

test('setup --help returns structured JSON help payload', () => {
  const result = runCli(['--output', 'json', 'setup', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.command, 'setup.help');
  assert.match(payload.data.usage, /^pandora .* setup /);
  assert.equal(payload.data.schemaVersion, '1.0.0');
  assertIsoTimestamp(payload.data.generatedAt);
});

test('init-env writes env files with 0600 permissions (non-Windows)', () => {
  const tempDir = createTempDir('pandora-init-env-mode-');
  const examplePath = path.join(tempDir, 'example.env');
  const envPath = path.join(tempDir, 'generated.env');
  writeFile(examplePath, 'CHAIN_ID=1\n');

  const result = runCli([
    '--output',
    'json',
    'init-env',
    '--example',
    examplePath,
    '--dotenv-path',
    envPath,
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(fs.existsSync(envPath), true);
  if (process.platform !== 'win32') {
    const mode = fs.statSync(envPath).mode & 0o777;
    assert.equal(mode, 0o600);
  }

  removeDir(tempDir);
});

test('doctor reports missing required env vars in json mode', () => {
  const tempDir = createTempDir('pandora-doctor-missing-');
  const envPath = path.join(tempDir, 'missing.env');

  writeFile(envPath, 'CHAIN_ID=1\n');

  const result = runCli(['--output', 'json', 'doctor', '--dotenv-path', envPath], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'DOCTOR_FAILED');
  assert.equal(payload.error.details.report.env.required.ok, false);
  assert.ok(payload.error.details.report.env.required.missing.includes('RPC_URL'));

  removeDir(tempDir);
});

test('doctor supports --env-file alias', () => {
  const tempDir = createTempDir('pandora-doctor-env-file-');
  const envPath = path.join(tempDir, 'valid.env');

  writeFile(envPath, buildValidEnv('http://127.0.0.1:1'));

  const result = runCli(['doctor', '--env-file', envPath], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });

  assert.equal(result.status, 1);
  assert.match(result.output, /RPC request failed:/);
  removeDir(tempDir);
});

test('doctor fails on missing --dotenv-path value', () => {
  const result = runCli(['doctor', '--dotenv-path']);
  assert.equal(result.status, 1);
  assert.match(result.output, /Missing value for --dotenv-path/);
});

test('init-env rejects unknown flags', () => {
  const result = runCli(['init-env', '--bogus']);
  assert.equal(result.status, 1);
  assert.match(result.output, /Unknown flag for init-env: --bogus/);
});

test('doctor fails when RPC is unreachable', () => {
  const tempDir = createTempDir('pandora-doctor-rpc-down-');
  const envPath = path.join(tempDir, 'rpc-down.env');

  writeFile(envPath, buildValidEnv('http://127.0.0.1:1'));

  const result = runCli(['--output', 'json', 'doctor', '--dotenv-path', envPath], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'DOCTOR_FAILED');
  assert.equal(payload.error.details.report.rpc.ok, false);

  removeDir(tempDir);
});

test('doctor validates rpc reachability and contract bytecode checks', async () => {
  const rpcServer = await startRpcMockServer({
    chainIdHex: '0x1',
    codeByAddress: {
      [ADDRESSES.oracle]: '0x6001600101',
      [ADDRESSES.factory]: '0x6002600202',
    },
  });

  const tempDir = createTempDir('pandora-doctor-valid-');
  const envPath = path.join(tempDir, 'valid.env');

  try {
    writeFile(envPath, buildValidEnv(rpcServer.url));

    const result = await runCliAsync(['doctor', '--dotenv-path', envPath], {
      unsetEnvKeys: DOCTOR_ENV_KEYS,
    });

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    assert.match(result.output, /Doctor checks passed\./);
  } finally {
    await rpcServer.close();
    removeDir(tempDir);
  }
});

test('setup creates env and coordinates doctor checks', async () => {
  const rpcServer = await startRpcMockServer({
    chainIdHex: '0x1',
    codeByAddress: {
      [ADDRESSES.oracle]: '0x6001600101',
      [ADDRESSES.factory]: '0x6002600202',
    },
  });

  const tempDir = createTempDir('pandora-setup-');
  const examplePath = path.join(tempDir, 'fixtures', '.env.example');
  const envPath = path.join(tempDir, 'runtime', '.env');

  try {
    writeFile(examplePath, buildValidEnv(rpcServer.url));

    const result = await runCliAsync([
      '--output',
      'json',
      'setup',
      '--example',
      examplePath,
      '--dotenv-path',
      envPath,
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    assert.equal(fs.existsSync(envPath), true);

    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.envStep.status, 'written');
    assert.equal(payload.data.doctor.summary.ok, true);
  } finally {
    await rpcServer.close();
    removeDir(tempDir);
  }
});

test('markets list/get uses indexer graphql with json output', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const listResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--limit',
      '5',
    ]);
    assert.equal(listResult.timedOut, false);
    assert.equal(listResult.status, 0);
    const listPayload = parseJsonOutput(listResult);
    assert.equal(listPayload.data.count, 1);
    assert.equal(listPayload.data.items[0].id, 'market-1');

    const getResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'get',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--id',
      'market-1',
    ]);
    assert.equal(getResult.timedOut, false);
    assert.equal(getResult.status, 0);
    const getPayload = parseJsonOutput(getResult);
    assert.equal(getPayload.data.item.id, 'market-1');
  } finally {
    await indexer.close();
  }
});

test('read-only subcommands expose scoped --help output', () => {
  const marketsList = runCli(['markets', 'list', '--help']);
  assert.equal(marketsList.status, 0);
  assert.match(marketsList.output, /pandora markets list - List markets/);
  assert.doesNotMatch(marketsList.output, /Unknown flag for markets list/);

  const pollsList = runCli(['polls', 'list', '--help']);
  assert.equal(pollsList.status, 0);
  assert.match(pollsList.output, /pandora polls list - List polls/);

  const eventsGet = runCli(['events', 'get', '--help']);
  assert.equal(eventsGet.status, 0);
  assert.match(eventsGet.output, /pandora events get - Get an event by id/);

  const positionsList = runCli(['positions', 'list', '--help']);
  assert.equal(positionsList.status, 0);
  assert.match(positionsList.output, /pandora positions - Query wallet position entities/);
});

test('scan --help returns structured help instead of parser errors', () => {
  const result = runCli(['--output', 'json', 'scan', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'scan.help');
  assert.match(payload.data.usage, /scan/);
});

test('markets list supports lifecycle convenience filters', async () => {
  const indexer = await startLifecycleIndexerMockServer();

  try {
    const activeResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--active',
    ]);
    assert.equal(activeResult.status, 0);
    const activePayload = parseJsonOutput(activeResult);
    assert.equal(activePayload.data.filters.lifecycle, 'active');
    assert.equal(activePayload.data.count, 2);

    const resolvedResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--resolved',
    ]);
    assert.equal(resolvedResult.status, 0);
    const resolvedPayload = parseJsonOutput(resolvedResult);
    assert.equal(resolvedPayload.data.filters.lifecycle, 'resolved');
    assert.equal(resolvedPayload.data.count, 1);
    assert.equal(resolvedPayload.data.items[0].id, 'market-past');

    const expiringSoonResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--expiring-soon',
    ]);
    assert.equal(expiringSoonResult.status, 0);
    const expiringSoonPayload = parseJsonOutput(expiringSoonResult);
    assert.equal(expiringSoonPayload.data.filters.lifecycle, 'expiring-soon');
    assert.equal(expiringSoonPayload.data.count, 1);
    assert.equal(expiringSoonPayload.data.items[0].id, 'market-soon');
    assert.equal(expiringSoonPayload.data.lifecycle.expiringHours, 24);
  } finally {
    await indexer.close();
  }
});

test('markets get supports repeated --id values and reports missing ids', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'markets',
      'get',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--id',
      'market-1',
      '--id',
      'market-missing',
    ]);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    console.error(JSON.stringify(payload.data.polymarket, null, 2));
    console.error(JSON.stringify(payload.data.suggestions, null, 2));
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'markets.get');
    assert.equal(payload.data.requestedCount, 2);
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].id, 'market-1');
    assert.deepEqual(payload.data.missingIds, ['market-missing']);
  } finally {
    await indexer.close();
  }
});

test('markets get accepts comma-delimited ids in one flag', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'markets',
      'get',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--id',
      'market-1,market-missing',
    ]);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'markets.get');
    assert.equal(payload.data.requestedCount, 2);
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].id, 'market-1');
    assert.deepEqual(payload.data.missingIds, ['market-missing']);
  } finally {
    await indexer.close();
  }
});

test('markets list validates lifecycle flag combinations', () => {
  const conflicting = runCli([
    '--output',
    'json',
    'markets',
    'list',
    '--skip-dotenv',
    '--indexer-url',
    'http://127.0.0.1:1',
    '--active',
    '--resolved',
  ]);
  assert.equal(conflicting.status, 1);
  const conflictingPayload = parseJsonOutput(conflicting);
  assert.equal(conflictingPayload.error.code, 'INVALID_ARGS');
  assert.match(conflictingPayload.error.message, /mutually exclusive/);

  const missingLifecycle = runCli([
    '--output',
    'json',
    'markets',
    'list',
    '--skip-dotenv',
    '--indexer-url',
    'http://127.0.0.1:1',
    '--expiring-hours',
    '12',
  ]);
  assert.equal(missingLifecycle.status, 1);
  const missingLifecyclePayload = parseJsonOutput(missingLifecycle);
  assert.equal(missingLifecyclePayload.error.code, 'INVALID_ARGS');
  assert.match(missingLifecyclePayload.error.message, /requires --expiring-soon/);
});

test('markets list --with-odds falls back to latest liquidity event when market payload omits odds fields', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--with-odds',
      '--limit',
      '5',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'markets.list');
    assert.equal(payload.data.count, 1);

    const first = payload.data.items[0];
    assert.equal(typeof first.id, 'string');
    assert.equal(Boolean(first.odds && typeof first.odds === 'object'), true);
    assert.equal(first.odds.source, 'liquidity-event:latest');
    assert.equal(typeof first.odds.yesPct, 'number');
    assert.equal(typeof first.odds.noPct, 'number');
    assert.ok(Math.abs(first.odds.yesPct - 37.5) < 0.000001);
    assert.ok(Math.abs(first.odds.noPct - 62.5) < 0.000001);
  } finally {
    await indexer.close();
  }
});

test('markets list --expand includes poll details in json items', async () => {
  const indexer = await startPhaseOneIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--limit',
      '5',
      '--expand',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);

    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'markets.list');
    assert.equal(payload.data.count, 1);

    const first = payload.data.items[0];
    assert.equal(typeof first.id, 'string');
    assert.equal(Boolean(first.poll && typeof first.poll === 'object' && !Array.isArray(first.poll)), true);
    assert.equal(typeof first.poll.id, 'string');
    assert.equal(typeof first.poll.question, 'string');
    assert.equal(Number.isInteger(first.poll.status), true);
    assert.equal(Number.isInteger(first.poll.category), true);
    assert.ok(first.poll.deadlineEpoch !== undefined && first.poll.deadlineEpoch !== null);
  } finally {
    await indexer.close();
  }
});

test('markets list --with-odds includes normalized yes/no percentages in json items', async () => {
  const indexer = await startPhaseOneIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--limit',
      '5',
      '--with-odds',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);

    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'markets.list');
    assert.equal(payload.data.count, 1);

    const first = payload.data.items[0];
    assert.equal(typeof first.id, 'string');
    assert.equal(typeof first.totalVolume, 'number');
    assert.equal(typeof first.currentTvl, 'number');
    assertOddsShape(first.odds);
  } finally {
    await indexer.close();
  }
});

test('scan returns deterministic json contract for market candidates', async () => {
  const indexer = await startPhaseOneIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'scan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--limit',
      '5',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);

    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'scan');
    assert.equal(typeof payload.data.indexerUrl, 'string');
    assert.equal(typeof payload.data.count, 'number');
    assert.equal(Array.isArray(payload.data.items), true);
    assert.equal(payload.data.items.length, 1);
    assertIsoTimestamp(payload.data.generatedAt);

    const first = payload.data.items[0];
    assert.equal(typeof first.id, 'string');
    assert.equal(typeof first.chainId, 'number');
    assert.equal(typeof first.marketType, 'string');
    assert.equal(typeof first.question, 'string');
    assert.equal(typeof first.totalVolume, 'number');
    assert.equal(typeof first.currentTvl, 'number');
    assert.ok(first.marketCloseTimestamp !== undefined && first.marketCloseTimestamp !== null);
    assertOddsShape(first.odds);
  } finally {
    await indexer.close();
  }
});

test('scan --market-type parimutuel --resolved uses poll status for settled pari markets', async () => {
  const marketAddress = '0xf1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1';
  const pollAddress = '0xe1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1';
  const futureCloseTimestamp = String(Math.floor(Date.now() / 1000) + (48 * 60 * 60));
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'parimutuel',
        marketCloseTimestamp: futureCloseTimestamp,
        totalVolume: '1000',
        currentTvl: '500',
        reserveYes: '490',
        reserveNo: '10',
        createdAt: '1700000000',
      },
    ],
    polls: [
      {
        id: pollAddress,
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Was the settled pari market kept by scan?',
        status: 2,
        category: 3,
        deadlineEpoch: 1700000000,
        createdAt: 1700000000,
        createdTxHash: '0xhashscanpari',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'scan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-type',
      'parimutuel',
      '--resolved',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.command, 'scan');
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].id, marketAddress);
    assert.equal(payload.data.items[0].poll.status, 2);
  } finally {
    await indexer.close();
  }
});

test('markets list --hedgeable matches against the current page without a second Pandora market crawl', async () => {
  const indexer = await startJsonHttpServer(({ bodyJson }) => {
    const query = String((bodyJson && bodyJson.query) || '');
    const variables = (bodyJson && bodyJson.variables) || {};
    const fixtures = {
      markets: [
        {
          id: 'market-hedgeable-1',
          chainId: 1,
          chainName: 'ethereum',
          pollAddress: 'poll-hedgeable-1',
          creator: ADDRESSES.wallet1,
          marketType: 'amm',
          marketCloseTimestamp: '1893456000',
          totalVolume: '12345',
          currentTvl: '4567',
          createdAt: '1700000000',
        },
        {
          id: 'market-hedgeable-2',
          chainId: 1,
          chainName: 'ethereum',
          pollAddress: 'poll-hedgeable-2',
          creator: ADDRESSES.wallet1,
          marketType: 'amm',
          marketCloseTimestamp: '1893463200',
          totalVolume: '9876',
          currentTvl: '3210',
          createdAt: '1700000001',
        },
        {
          id: 'market-hedgeable-3',
          chainId: 1,
          chainName: 'ethereum',
          pollAddress: 'poll-hedgeable-3',
          creator: ADDRESSES.wallet1,
          marketType: 'amm',
          marketCloseTimestamp: '1893466800',
          totalVolume: '7654',
          currentTvl: '2100',
          createdAt: '1700000002',
        },
      ],
      polls: [
        {
          id: 'poll-hedgeable-1',
          question: 'Will Arsenal beat Chelsea?',
          status: 0,
          category: 3,
          deadlineEpoch: 1893456000,
        },
        {
          id: 'poll-hedgeable-2',
          question: 'Will bitcoin close above 150k?',
          status: 0,
          category: 3,
          deadlineEpoch: 1893463200,
        },
        {
          id: 'poll-hedgeable-3',
          question: 'Will Trump die before April 01?',
          status: 0,
          category: 3,
          deadlineEpoch: 1893466800,
        },
      ],
    };
    const data = {};

    if (query.includes('marketss(')) {
      data.marketss = asPage(applyListControls(fixtures.markets, variables));
    }

    const batchPolls = resolveBatchEntitySelections(query, variables, 'polls', (id) =>
      fixtures.polls.find((entry) => entry.id === id) || null,
    );
    if (batchPolls) {
      Object.assign(data, batchPolls);
    }

    if (query.includes('polls(id:') && Object.prototype.hasOwnProperty.call(variables, 'id')) {
      data.polls = fixtures.polls.find((entry) => entry.id === variables.id) || null;
    }

    if (Object.keys(data).length) {
      return { body: { data } };
    }

    return {
      status: 400,
      body: {
        errors: [{ message: 'Unsupported hedgeable query in mock indexer' }],
      },
    };
  });

  const gamma = await startJsonHttpServer(() => ({
    body: [
      {
        conditionId: 'poly-hedgeable-1',
        question: 'Will Arsenal beat Chelsea?',
        endDateIso: '2030-01-01T00:00:00Z',
        tokens: [
          { outcome: 'Yes', price: 0.61 },
          { outcome: 'No', price: 0.39 },
        ],
      },
      {
        conditionId: 'poly-hedgeable-2',
        question: 'Will Real Madrid win La Liga?',
        endDateIso: '2030-01-01T02:00:00Z',
        tokens: [
          { outcome: 'Yes', price: 0.55 },
          { outcome: 'No', price: 0.45 },
        ],
      },
      {
        conditionId: 'poly-hedgeable-3',
        question: 'Will Trump sign 7 pieces of legislation in March?',
        endDateIso: '2030-01-01T03:00:00Z',
        tokens: [
          { outcome: 'Yes', price: 0.48 },
          { outcome: 'No', price: 0.52 },
        ],
      },
    ],
  }));

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--limit',
      '5',
      '--hedgeable',
    ], {
      env: {
        POLYMARKET_GAMMA_HOST: gamma.url,
      },
    });

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);

    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'markets.list');
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].id, 'market-hedgeable-1');

    const marketListRequests = indexer.requests.filter((request) =>
      String(request.bodyJson && request.bodyJson.query || '').includes('marketss('),
    );
    assert.equal(marketListRequests.length, 1);

    const pollLookupRequests = indexer.requests.filter((request) =>
      String(request.bodyJson && request.bodyJson.query || '').includes('polls(id:'),
    );
    assert.equal(pollLookupRequests.length, 1);
  } finally {
    await Promise.all([indexer.close(), gamma.close()]);
  }
});

test('quote derives odds and estimates from latest liquidity snapshot', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'quote',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-address',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--side',
      'yes',
      '--amount-usdc',
      '50',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);

    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'quote');
    assert.equal(payload.data.marketAddress, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.equal(payload.data.side, 'yes');
    assert.equal(payload.data.quoteAvailable, true);
    assert.equal(payload.data.odds.source, 'liquidity-event:latest');
    assert.equal(typeof payload.data.estimate.estimatedShares, 'number');
    assert.ok(payload.data.estimate.estimatedShares > 0);
    assert.ok(payload.data.estimate.minSharesOut <= payload.data.estimate.estimatedShares);
  } finally {
    await indexer.close();
  }
});

test('quote --amounts uses AMM reserve curve (non-linear slippage) when reserves are available', async () => {
  const marketAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '120000',
        currentTvl: '768',
        yesChance: '0.23828125',
        reserveYes: '585000000',
        reserveNo: '183000000',
        createdAt: '1700000000',
      },
    ],
    liquidityEvents: [
      {
        id: 'evt-liq-curve-1',
        chainId: 1,
        chainName: 'ethereum',
        provider: ADDRESSES.wallet1,
        marketAddress,
        pollAddress: marketAddress,
        eventType: 'addLiquidity',
        collateralAmount: '1000',
        lpTokens: '500',
        yesTokenAmount: '585000000',
        noTokenAmount: '183000000',
        yesTokensReturned: '0',
        noTokensReturned: '0',
        txHash: '0xtx-liq-curve-1',
        timestamp: 1700000100,
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'quote',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-address',
      marketAddress,
      '--side',
      'yes',
      '--amount-usdc',
      '25',
      '--amounts',
      '25,50,75,150',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'quote');
    assert.equal(payload.data.estimate.estimateSource, 'amm-reserves');
    assert.equal(Array.isArray(payload.data.curve), true);
    assert.equal(payload.data.curve.length, 4);

    const slippages = payload.data.curve.map((point) => point.slippagePct);
    assert.ok(slippages.every((value) => typeof value === 'number'));
    assert.ok(slippages[1] > slippages[0]);
    assert.ok(slippages[2] > slippages[1]);
    assert.ok(slippages[3] > slippages[2]);
  } finally {
    await indexer.close();
  }
});

test('quote supports manual odds override via --yes-pct without indexer calls', () => {
  const result = runCli([
    '--output',
    'json',
    'quote',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'no',
    '--amount-usdc',
    '20',
    '--yes-pct',
    '60',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'quote');
  assert.equal(payload.data.odds.source, 'manual:yes-pct');
  assert.equal(payload.data.quoteAvailable, true);
  assert.ok(payload.data.estimate.estimatedShares > 0);
});

test('quote --target-pct computes the required AMM buy to reach the requested YES percentage', async () => {
  const marketAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '120000',
        currentTvl: '768',
        yesChance: '0.23828125',
        reserveYes: '585000000',
        reserveNo: '183000000',
        createdAt: '1700000000',
      },
    ],
    liquidityEvents: [
      {
        id: 'evt-liq-target-pct-1',
        chainId: 1,
        chainName: 'ethereum',
        provider: ADDRESSES.wallet1,
        marketAddress,
        pollAddress: marketAddress,
        eventType: 'addLiquidity',
        collateralAmount: '1000',
        lpTokens: '500',
        yesTokenAmount: '585000000',
        noTokenAmount: '183000000',
        yesTokensReturned: '0',
        noTokensReturned: '0',
        txHash: '0xtx-liq-target-pct-1',
        timestamp: 1700000100,
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'quote',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-address',
      marketAddress,
      '--side',
      'yes',
      '--target-pct',
      '40',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'quote');
    assert.equal(payload.data.targetPct, 40);
    assert.equal(payload.data.quoteAvailable, true);
    assert.equal(payload.data.targeting.currentPct, 23.828125);
    assert.equal(payload.data.targeting.targetPct, 40);
    assert.equal(payload.data.targeting.requiredSide, 'yes');
    assert.ok(payload.data.targeting.requiredAmountUsdc > 0);
    assert.equal(payload.data.amountUsdc, payload.data.targeting.requiredAmountUsdc);
    assert.ok(Math.abs(payload.data.targeting.postTradePct - 40) < 0.02);
    assert.deepEqual(payload.data.targeting.diagnostics, []);
    assert.deepEqual(payload.data.diagnostics, []);
  } finally {
    await indexer.close();
  }
});

test('quote --target-pct rejects a requested side that cannot reach the requested YES percentage', async () => {
  const marketAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '120000',
        currentTvl: '768',
        yesChance: '0.23828125',
        reserveYes: '585000000',
        reserveNo: '183000000',
        createdAt: '1700000000',
      },
    ],
    liquidityEvents: [
      {
        id: 'evt-liq-target-pct-2',
        chainId: 1,
        chainName: 'ethereum',
        provider: ADDRESSES.wallet1,
        marketAddress,
        pollAddress: marketAddress,
        eventType: 'addLiquidity',
        collateralAmount: '1000',
        lpTokens: '500',
        yesTokenAmount: '585000000',
        noTokenAmount: '183000000',
        yesTokensReturned: '0',
        noTokensReturned: '0',
        txHash: '0xtx-liq-target-pct-2',
        timestamp: 1700000100,
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'quote',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-address',
      marketAddress,
      '--side',
      'no',
      '--target-pct',
      '40',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.error.code, 'INVALID_FLAG_COMBINATION');
    assert.match(payload.error.message, /requires buying YES/i);
  } finally {
    await indexer.close();
  }
});

test('quote --target-pct rejects explicit buy amounts in the same request', () => {
  const result = runCli([
    '--output',
    'json',
    'quote',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--target-pct',
    '55',
    '--amount-usdc',
    '10',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'INVALID_FLAG_COMBINATION');
  assert.match(payload.error.message, /Use either --target-pct or --amount-usdc\/--amounts/);
});

test('quote --target-pct rejects pari-mutuel markets explicitly', async () => {
  const marketAddress = '0xdddddddddddddddddddddddddddddddddddddddd';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'parimutuel',
        marketCloseTimestamp: '1710000000',
        totalVolume: '1000',
        currentTvl: '1000',
        reserveYes: '400',
        reserveNo: '600',
        createdAt: '1700000000',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'quote',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-address',
      marketAddress,
      '--side',
      'yes',
      '--target-pct',
      '55',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'INVALID_FLAG_COMBINATION');
    assert.match(payload.error.message, /only supported for AMM quote requests/i);
  } finally {
    await indexer.close();
  }
});

test('quote --help prints command help without parser errors', () => {
  const result = runCli(['quote', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.output, /pandora quote - Estimate a YES\/NO buy or sell/);
  assert.doesNotMatch(result.output, /Unknown flag for quote/);
});

test('trade requires exactly one execution mode flag', () => {
  const result = runCli([
    '--output',
    'json',
    'trade',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '10',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'INVALID_ARGS');
  assert.match(payload.error.message, /--dry-run or --execute/);
});

test('trade enforces --max-amount-usdc guardrail', () => {
  const result = runCli([
    '--output',
    'json',
    'trade',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '25',
    '--yes-pct',
    '55',
    '--max-amount-usdc',
    '10',
    '--dry-run',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'TRADE_RISK_GUARD');
  assert.match(payload.error.message, /exceeds --max-amount-usdc/);
});

test('trade enforces probability guardrails', () => {
  const result = runCli([
    '--output',
    'json',
    'trade',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '10',
    '--yes-pct',
    '40',
    '--min-probability-pct',
    '50',
    '--dry-run',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'TRADE_RISK_GUARD');
  assert.match(payload.error.message, /below --min-probability-pct/);
});

test('trade --execute blocks unquoted execution by default', () => {
  const result = runCli([
    '--output',
    'json',
    'trade',
    '--skip-dotenv',
    '--indexer-url',
    'http://127.0.0.1:1',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '10',
    '--execute',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'TRADE_RISK_GUARD');
  assert.match(payload.error.message, /requires a quote by default/);
});

test('trade --allow-unquoted-execute bypasses quote-availability guardrail', () => {
  const result = runCli([
    '--output',
    'json',
    'trade',
    '--skip-dotenv',
    '--indexer-url',
    'http://127.0.0.1:1',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '10',
    '--allow-unquoted-execute',
    '--execute',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.notEqual(payload.error.code, 'TRADE_RISK_GUARD');
});

test('trade --help prints command help', () => {
  const result = runCli(['trade', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.output, /pandora trade - Execute a buy on a market/);
});

test('trade --dry-run returns execution plan and embedded quote', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'trade',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-address',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--side',
      'yes',
      '--amount-usdc',
      '25',
      '--dry-run',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'trade');
    assert.equal(payload.data.mode, 'dry-run');
    assert.equal(payload.data.status, 'ok');
    assert.equal(payload.data.quote.quoteAvailable, true);
    assert.equal(Array.isArray(payload.data.executionPlan.steps), true);
    assert.equal(payload.data.executionPlan.steps.length, 3);
  } finally {
    await indexer.close();
  }
});

test('polls list/get uses indexer graphql with filters', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const listResult = await runCliAsync([
      '--output',
      'json',
      'polls',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--question-contains',
      'deterministic',
    ]);
    assert.equal(listResult.timedOut, false);
    assert.equal(listResult.status, 0);
    const listPayload = parseJsonOutput(listResult);
    assert.equal(listPayload.data.count, 1);
    assert.equal(listPayload.data.items[0].id, 'poll-1');

    const getResult = await runCliAsync([
      '--output',
      'json',
      'polls',
      'get',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--id',
      'poll-1',
    ]);
    assert.equal(getResult.timedOut, false);
    assert.equal(getResult.status, 0);
    const getPayload = parseJsonOutput(getResult);
    assert.equal(getPayload.data.item.id, 'poll-1');
  } finally {
    await indexer.close();
  }
});

test('events list/get aggregates configured event sources', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const listResult = await runCliAsync([
      '--output',
      'json',
      'events',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--type',
      'all',
      '--limit',
      '10',
    ]);

    assert.equal(listResult.timedOut, false);
    assert.equal(listResult.status, 0);
    const listPayload = parseJsonOutput(listResult);
    assert.equal(listPayload.data.count, 3);

    const sources = new Set(listPayload.data.items.map((item) => item.source));
    assert.equal(sources.has('liquidity'), true);
    assert.equal(sources.has('oracle-fee'), true);
    assert.equal(sources.has('claim'), true);

    const getResult = await runCliAsync([
      '--output',
      'json',
      'events',
      'get',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--id',
      'evt-oracle-1',
    ]);

    assert.equal(getResult.timedOut, false);
    assert.equal(getResult.status, 0);
    const getPayload = parseJsonOutput(getResult);
    assert.equal(getPayload.data.item.source, 'oracle-fee');
  } finally {
    await indexer.close();
  }
});

test('events list with --chain-id does not send chainId to claim filters', async () => {
  const indexer = await startJsonHttpServer(({ bodyJson }) => {
    const query = (bodyJson && bodyJson.query) || '';
    const variables = (bodyJson && bodyJson.variables) || {};

    if (query.includes('liquidityEventss(')) {
      return { body: { data: { liquidityEventss: asPage([]) } } };
    }

    if (query.includes('oracleFeeEventss(')) {
      return { body: { data: { oracleFeeEventss: asPage([]) } } };
    }

    if (query.includes('claimEventss(')) {
      if (variables.where && Object.prototype.hasOwnProperty.call(variables.where, 'chainId')) {
        return {
          body: {
            errors: [{ message: 'Field "chainId" is not defined by type "claimEventsFilter".' }],
          },
        };
      }
      return {
        body: {
          data: {
            claimEventss: asPage([
              {
                id: 'evt-claim-safe',
                campaignAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
                userAddress: ADDRESSES.wallet1,
                amount: '5',
                signature: '0xsig',
                blockNumber: 500,
                timestamp: 1700000000,
                txHash: '0xtx-claim-safe',
              },
            ]),
          },
        },
      };
    }

    return {
      status: 400,
      body: {
        errors: [{ message: 'Unsupported query in mock indexer' }],
      },
    };
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'events',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--chain-id',
      '1',
      '--limit',
      '10',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].source, 'claim');

    const claimRequest = indexer.requests.find((req) =>
      String((req.bodyJson && req.bodyJson.query) || '').includes('claimEventss('),
    );
    assert.equal(Boolean(claimRequest), true);
    assert.equal(Object.prototype.hasOwnProperty.call(claimRequest.bodyJson.variables.where, 'chainId'), false);
  } finally {
    await indexer.close();
  }
});

test('fees summarizes indexed oracle-fee history for a recipient wallet', async () => {
  const indexer = await startIndexerMockServer({
    oracleFeeEvents: [
      {
        id: 'evt-oracle-summary-1',
        chainId: 1,
        chainName: 'ethereum',
        oracleAddress: ADDRESSES.oracle,
        eventName: 'FeeUpdated',
        newFee: '250',
        to: ADDRESSES.wallet2,
        amount: '0',
        txHash: '0xtx-oracle-summary-1',
        blockNumber: 300,
        timestamp: 1700001200,
      },
      {
        id: 'evt-oracle-summary-2',
        chainId: 1,
        chainName: 'ethereum',
        oracleAddress: ADDRESSES.oracle,
        eventName: 'FeesWithdrawn',
        newFee: '250',
        to: ADDRESSES.wallet2,
        amount: '2500000',
        txHash: '0xtx-oracle-summary-2',
        blockNumber: 301,
        timestamp: 1700001300,
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'fees',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet2,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.command, 'fees');
    assert.equal(payload.data.summary.count, 2);
    assert.equal(payload.data.summary.totalAmountUsdc, 2.5);
    assert.equal(payload.data.summary.lastUpdatedFeeBps, 250);
    assert.equal(payload.data.items[0].eventName, 'FeesWithdrawn');
  } finally {
    await indexer.close();
  }
});

test('fees withdraw dry-run previews market-level protocol fee splits', async () => {
  const rpc = await startFeesWithdrawRpcMock({
    marketAddress: ADDRESSES.mirrorMarket,
    factory: ADDRESSES.factory,
    collateralToken: ADDRESSES.usdc,
    creator: ADDRESSES.wallet1,
    platformTreasury: ADDRESSES.wallet2,
    protocolFeesCollected: 106_000_001n,
    decimals: 6,
    symbol: 'USDC',
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'fees',
      'withdraw',
      '--skip-dotenv',
      '--market-address',
      ADDRESSES.mirrorMarket,
      '--dry-run',
      '--rpc-url',
      rpc.url,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.command, 'fees.withdraw');
    assert.equal(payload.data.mode, 'dry-run');
    assert.equal(payload.data.status, 'planned');
    assert.equal(payload.data.marketAddress, ADDRESSES.mirrorMarket.toLowerCase());
    assert.equal(payload.data.contract.platformTreasury, ADDRESSES.wallet2.toLowerCase());
    assert.equal(payload.data.contract.creator, ADDRESSES.wallet1.toLowerCase());
    assert.equal(payload.data.feeState.withdrawableRaw, '106000001');
    assert.equal(payload.data.feeState.withdrawable, '106.000001');
    assert.equal(payload.data.feeState.platformShare, '53');
    assert.equal(payload.data.feeState.creatorShare, '53.000001');
    assert.equal(payload.data.preflight.executeSupported, true);
    assert.equal(payload.data.preflight.simulationAttempted, false);
  } finally {
    await rpc.close();
  }
});

test('table-mode GraphQL errors render human-readable messages', async () => {
  const indexer = await startJsonHttpServer(() => ({
    body: {
      errors: [{ message: 'Invalid field for orderBy', extensions: { code: 'BAD_USER_INPUT' } }],
    },
  }));

  try {
    const result = await runCliAsync([
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 1);
    assert.match(result.output, /Indexer GraphQL query failed\./);
    assert.match(result.output, /- Invalid field for orderBy/);
    assert.doesNotMatch(result.output, /\[object Object\]/);
  } finally {
    await indexer.close();
  }
});

test('debug market returns market, poll, position, trade, and liquidity context', async () => {
  const marketAddress = '0xdededededededededededededededededededede';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '5000000',
        currentTvl: '2000000',
        reserveYes: '600000',
        reserveNo: '400000',
        createdAt: '1700000000',
      },
    ],
    polls: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Will debug market show a stitched forensic view?',
        status: 0,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhash-debug-market',
      },
    ],
    positions: [
      {
        id: 'pos-debug-1',
        chainId: 1,
        marketAddress,
        user: ADDRESSES.wallet1,
        lastTradeAt: 1700000400,
        yesTokenAmount: '1000000',
        noTokenAmount: '0',
      },
      {
        id: 'pos-debug-2',
        chainId: 1,
        marketAddress,
        user: ADDRESSES.wallet2,
        lastTradeAt: 1700000500,
        yesTokenAmount: '0',
        noTokenAmount: '300000',
      },
    ],
    trades: [
      {
        id: 'trade-debug-1',
        chainId: 1,
        marketAddress,
        pollAddress: marketAddress,
        trader: ADDRESSES.wallet1,
        side: 'yes',
        tradeType: 'buy',
        collateralAmount: '1500000',
        tokenAmount: '2500000',
        tokenAmountOut: '2500000',
        feeAmount: '15000',
        timestamp: 1700000600,
        txHash: '0xdebug-market-trade-1',
      },
    ],
    liquidityEvents: [
      {
        id: 'liq-debug-1',
        chainId: 1,
        chainName: 'ethereum',
        provider: ADDRESSES.wallet1,
        marketAddress,
        pollAddress: marketAddress,
        eventType: 'addLiquidity',
        collateralAmount: '2000000',
        lpTokens: '500000',
        yesTokenAmount: '1200000',
        noTokenAmount: '800000',
        yesTokensReturned: '0',
        noTokensReturned: '0',
        txHash: '0xdebug-market-liq-1',
        timestamp: 1700000200,
      },
    ],
    claimEvents: [
      {
        id: 'claim-debug-1',
        campaignAddress: marketAddress,
        userAddress: ADDRESSES.wallet1,
        amount: '500000',
        signature: '0xsig-debug',
        blockNumber: 450,
        timestamp: 1700000800,
        txHash: '0xdebug-market-claim-1',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'debug',
      'market',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-address',
      marketAddress,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.command, 'debug.market');
    assert.equal(payload.data.market.id, marketAddress);
    assert.equal(payload.data.poll.question, 'Will debug market show a stitched forensic view?');
    assert.equal(payload.data.summary.positions.count, 2);
    assert.equal(payload.data.summary.trades.count, 1);
    assert.equal(payload.data.summary.liquidityEvents.count, 1);
    assert.equal(payload.data.summary.claimEvents.count, 1);
  } finally {
    await indexer.close();
  }
});

test('debug market falls back when marketUsers token fields are unavailable', async () => {
  const marketAddress = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
  let rejectedLegacyFieldQuery = false;
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '5000000',
        currentTvl: '2000000',
        reserveYes: '600000',
        reserveNo: '400000',
        createdAt: '1700000000',
      },
    ],
    polls: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Will debug market tolerate schema drift?',
        status: 0,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhash-debug-market-compat',
      },
    ],
    positions: [
      {
        id: 'pos-compat-1',
        chainId: 1,
        marketAddress,
        user: ADDRESSES.wallet1,
        lastTradeAt: 1700000400,
        yesBalance: '750000',
        noBalance: '250000',
      },
    ],
    handleRequest: ({ query, variables, fixtures }) => {
      if (query.includes('marketUserss(') && query.includes('yesTokenAmount')) {
        rejectedLegacyFieldQuery = true;
        return {
          body: {
            errors: [{ message: 'Cannot query field "yesTokenAmount" on type "marketUsers".' }],
          },
        };
      }
      if (query.includes('marketUserss(')) {
        const items = applyListControls(applyWhereFilter(fixtures.positions, variables.where), variables);
        return { body: { data: { marketUserss: asPage(items) } } };
      }
      return null;
    },
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'debug',
      'market',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-address',
      marketAddress,
    ]);

    assert.equal(result.status, 0);
    assert.equal(rejectedLegacyFieldQuery, true);
    const payload = parseJsonOutput(result);
    assert.equal(payload.command, 'debug.market');
    assert.equal(payload.data.summary.positions.count, 1);
    assert.equal(payload.data.recent.positions[0].yesTokenAmount, '750000');
    assert.equal(payload.data.recent.positions[0].yesBalance, '750000');
    assert.equal(payload.data.recent.positions[0].noTokenAmount, '250000');
    assert.equal(payload.data.recent.positions[0].noBalance, '250000');
    assert.match(payload.data.diagnostics.join('\n'), /compatibility fallback/i);
  } finally {
    await indexer.close();
  }
});

test('debug tx correlates indexed trades and events for one transaction hash', async () => {
  const marketAddress = '0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed';
  const txHash = '0xdebug-tx-1';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '5000000',
        currentTvl: '2000000',
        reserveYes: '600000',
        reserveNo: '400000',
        createdAt: '1700000000',
      },
    ],
    polls: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Will debug tx correlate the indexed sections?',
        status: 0,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhash-debug-tx',
      },
    ],
    trades: [
      {
        id: 'trade-debug-tx-1',
        chainId: 1,
        marketAddress,
        pollAddress: marketAddress,
        trader: ADDRESSES.wallet1,
        side: 'yes',
        tradeType: 'buy',
        collateralAmount: '1000000',
        tokenAmount: '2000000',
        tokenAmountOut: '2000000',
        feeAmount: '10000',
        timestamp: 1700000600,
        txHash,
      },
    ],
    liquidityEvents: [
      {
        id: 'liq-debug-tx-1',
        chainId: 1,
        chainName: 'ethereum',
        provider: ADDRESSES.wallet1,
        marketAddress,
        pollAddress: marketAddress,
        eventType: 'addLiquidity',
        collateralAmount: '1000000',
        lpTokens: '250000',
        yesTokenAmount: '600000',
        noTokenAmount: '400000',
        yesTokensReturned: '0',
        noTokensReturned: '0',
        txHash,
        timestamp: 1700000200,
      },
    ],
    oracleFeeEvents: [
      {
        id: 'fee-debug-tx-1',
        chainId: 1,
        chainName: 'ethereum',
        oracleAddress: ADDRESSES.oracle,
        eventName: 'FeesWithdrawn',
        newFee: '200',
        to: ADDRESSES.wallet1,
        amount: '300000',
        txHash,
        blockNumber: 500,
        timestamp: 1700000700,
      },
    ],
    claimEvents: [
      {
        id: 'claim-debug-tx-1',
        campaignAddress: marketAddress,
        userAddress: ADDRESSES.wallet1,
        amount: '420000',
        signature: '0xsig-debug-tx',
        blockNumber: 501,
        timestamp: 1700000800,
        txHash,
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'debug',
      'tx',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--tx-hash',
      txHash,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.command, 'debug.tx');
    assert.equal(payload.data.txHash, txHash);
    assert.equal(payload.data.summary.trades, 1);
    assert.equal(payload.data.summary.liquidityEvents, 1);
    assert.equal(payload.data.summary.oracleFeeEvents, 1);
    assert.equal(payload.data.summary.claimEvents, 1);
    assert.equal(payload.data.relatedMarkets[0].id, marketAddress);
    assert.equal(payload.data.relatedPolls[0].question, 'Will debug tx correlate the indexed sections?');
  } finally {
    await indexer.close();
  }
});

test('positions list supports wallet filtering', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const listResult = await runCliAsync([
      '--output',
      'json',
      'positions',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
    ]);

    assert.equal(listResult.timedOut, false);
    assert.equal(listResult.status, 0);
    const payload = parseJsonOutput(listResult);
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].user.toLowerCase(), ADDRESSES.wallet1.toLowerCase());
  } finally {
    await indexer.close();
  }
});

test('portfolio requires --wallet flag', () => {
  const result = runCli([
    '--output',
    'json',
    'portfolio',
    '--skip-dotenv',
    '--indexer-url',
    'http://127.0.0.1:1',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.match(payload.error.message, /--wallet/);
});

test('portfolio aggregates positions and event metrics for wallet', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'portfolio',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--chain-id',
      '1',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'portfolio');
    assert.equal(payload.data.wallet, ADDRESSES.wallet1.toLowerCase());
    assert.equal(payload.data.summary.positionCount, 1);
    assert.equal(payload.data.summary.uniqueMarkets, 1);
    assert.equal(payload.data.summary.liquidityAdded, 1000);
    assert.equal(payload.data.summary.claims, 42);
    assert.equal(payload.data.summary.cashflowNet, -958);
    assert.equal(payload.data.summary.pnlProxy, -958);
    assert.equal(payload.data.summary.totalDeposited, 1000);
    assert.equal(payload.data.summary.totalNetDelta, 1000);
    assert.equal(payload.data.summary.totalUnrealizedPnl, null);
    assert.equal(payload.data.summary.totalsPolicy.eventDerivedTotalsWhenEventsDisabled, null);
    assert.equal(payload.data.summary.totalsPolicy.eventDerivedTotalsDefaultWhenNoRows, 0);
    assert.equal(payload.data.summary.totalsPolicy.unrealizedRequiresLp, true);
    assert.equal(payload.data.summary.eventsIncluded, true);
    assert.equal(Array.isArray(payload.data.positions), true);
    assert.equal(Array.isArray(payload.data.events.liquidity), true);
    assert.equal(Array.isArray(payload.data.events.claims), true);
  } finally {
    await indexer.close();
  }
});

test('portfolio enriches positions with question, odds, liquidity, and mark value fields', async () => {
  const marketAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
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
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Will deterministic tests pass?',
        status: 1,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpoll1',
      },
    ],
    positions: [
      {
        id: 'pos-1',
        chainId: 1,
        marketAddress,
        user: ADDRESSES.wallet1,
        lastTradeAt: 1700000400,
        yesTokenAmount: '15',
        noTokenAmount: '5',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'portfolio',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--chain-id',
      '1',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'portfolio');
    assert.equal(
      Object.prototype.hasOwnProperty.call(payload.data.summary, 'totalPositionMarkValueUsdc'),
      true,
    );
    assert.equal(payload.data.positions.length, 1);
    assert.equal(payload.data.positions[0].question, 'Will deterministic tests pass?');
    assert.equal(payload.data.positions[0].positionSide, 'both');
    assert.equal(payload.data.positions[0].odds.yesPct, 37.5);
    assert.equal(payload.data.positions[0].liquidity.reserveYes, 625);
  } finally {
    await indexer.close();
  }
});

test('portfolio suppresses stale zero-balance rows after trade reconciliation', async () => {
  const marketAddress = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '5000',
        currentTvl: '1000',
        reserveYes: '600',
        reserveNo: '400',
        createdAt: '1700000000',
      },
    ],
    polls: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Will the stale position be suppressed?',
        status: 0,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpollstale',
      },
    ],
    positions: [
      {
        id: 'pos-stale-1',
        chainId: 1,
        marketAddress,
        user: ADDRESSES.wallet1,
        lastTradeAt: 1700000400,
        noTokenAmount: '336',
      },
    ],
    trades: [
      {
        id: 'trade-stale-buy',
        chainId: 1,
        marketAddress,
        trader: ADDRESSES.wallet1,
        side: 'no',
        tradeType: 'buy',
        tokenAmountOut: '336',
        timestamp: 1700000100,
      },
      {
        id: 'trade-stale-sell',
        chainId: 1,
        marketAddress,
        trader: ADDRESSES.wallet1,
        side: 'no',
        tradeType: 'sell',
        tokenAmount: '336',
        timestamp: 1700000200,
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'portfolio',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--chain-id',
      '1',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.data.summary.positionCount, 0);
    assert.equal(payload.data.positions.length, 0);
    assert.equal(payload.data.summary.totalPositionMarkValueUsdc, 0);
    assert.match(payload.data.diagnostics.positions.join(' '), /Suppressed 1 zero-balance portfolio position row/i);
  } finally {
    await indexer.close();
  }
});

test('portfolio suppresses stale reconstructed balances when the indexer already reports zero', async () => {
  const marketAddress = '0xbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbc';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '5000',
        currentTvl: '1000',
        reserveYes: '600',
        reserveNo: '400',
        createdAt: '1700000000',
      },
    ],
    polls: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Will the indexed zero balance beat stale trade reconstruction?',
        status: 0,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpollzero',
      },
    ],
    positions: [
      {
        id: 'pos-zero-1',
        chainId: 1,
        marketAddress,
        user: ADDRESSES.wallet1,
        lastTradeAt: 1700000400,
        noTokenAmount: '0',
      },
    ],
    trades: [
      {
        id: 'trade-zero-buy',
        chainId: 1,
        marketAddress,
        trader: ADDRESSES.wallet1,
        side: 'no',
        tradeType: 'buy',
        tokenAmountOut: '336',
        timestamp: 1700000100,
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'portfolio',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--chain-id',
      '1',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.data.summary.positionCount, 0);
    assert.equal(payload.data.positions.length, 0);
    assert.equal(payload.data.summary.totalPositionMarkValueUsdc, 0);
    assert.match(payload.data.diagnostics.positions.join(' '), /Suppressed 1 zero-balance portfolio position row/i);
  } finally {
    await indexer.close();
  }
});

test('portfolio normalizes pari-mutuel micro-unit balances before computing mark value', async () => {
  const marketAddress = '0xcccccccccccccccccccccccccccccccccccccccc';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'pari',
        marketCloseTimestamp: '1710000000',
        totalVolume: '1000',
        currentTvl: '1000',
        reserveYes: '2',
        reserveNo: '998',
        createdAt: '1700000000',
      },
    ],
    polls: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Will the pari portfolio mark value stay human scaled?',
        status: 1,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpollpari',
      },
    ],
    positions: [
      {
        id: 'pos-pari-1',
        chainId: 1,
        marketAddress,
        user: ADDRESSES.wallet1,
        lastTradeAt: 1700000400,
        yesTokenAmount: '998775',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'portfolio',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--chain-id',
      '1',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.data.positions.length, 1);
    assert.equal(payload.data.positions[0].marketType, 'pari');
    assert.equal(payload.data.positions[0].yesBalance, 0.998775);
    assert.equal(payload.data.positions[0].markValueUsdc, 499.3875);
    assert.equal(payload.data.summary.totalPositionMarkValueUsdc, 499.3875);
  } finally {
    await indexer.close();
  }
});

test('portfolio normalizes raw parimutuel position balances before computing mark value', async () => {
  const marketAddress = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'pari',
        marketCloseTimestamp: '1710000000',
        totalVolume: '1000000',
        currentTvl: '1',
        yesChance: '0.998775',
        reserveYes: '1000000',
        reserveNo: '1225',
        createdAt: '1700000000',
      },
    ],
    polls: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Will the CLARITY Act pass?',
        status: 1,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpoll-pari-1',
      },
    ],
    positions: [
      {
        id: 'pos-pari-1',
        chainId: 1,
        marketAddress,
        user: ADDRESSES.wallet1,
        lastTradeAt: 1700000400,
        yesTokenAmount: '1000000.000000',
        noTokenAmount: '0',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'portfolio',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--chain-id',
      '1',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'portfolio');
    assert.equal(payload.data.positions.length, 1);
    assert.equal(payload.data.positions[0].yesBalance, 1);
    assert.equal(payload.data.positions[0].markValueUsdc, 1.001225);
    assert.equal(payload.data.summary.totalPositionMarkValueUsdc, 1.001225);
  } finally {
    await indexer.close();
  }
});

test('portfolio computes pari-mutuel mark value when indexer uses full parimutuel spelling', async () => {
  const marketAddress = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'parimutuel',
        marketCloseTimestamp: '1710000000',
        totalVolume: '1000',
        currentTvl: '1000',
        reserveYes: '2',
        reserveNo: '998',
        createdAt: '1700000000',
      },
    ],
    positions: [
      {
        id: 'pos-pari-spelling-1',
        chainId: 1,
        marketAddress,
        user: ADDRESSES.wallet1,
        lastTradeAt: 1700000400,
        yesTokenAmount: '998775',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'portfolio',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--chain-id',
      '1',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.positions.length, 1);
    assert.equal(payload.data.positions[0].marketType, 'parimutuel');
    assert.equal(payload.data.positions[0].yesBalance, 0.998775);
    assert.equal(payload.data.positions[0].markValueUsdc, 499.3875);
    assert.equal(payload.data.summary.totalPositionMarkValueUsdc, 499.3875);
  } finally {
    await indexer.close();
  }
});

test('portfolio --no-events skips event aggregation', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'portfolio',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--no-events',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.summary.eventsIncluded, false);
    assert.equal(payload.data.summary.liquidityAdded, 0);
    assert.equal(payload.data.summary.claims, 0);
    assert.equal(payload.data.summary.cashflowNet, 0);
    assert.equal(payload.data.summary.pnlProxy, 0);
    assert.equal(payload.data.summary.totalDeposited, null);
    assert.equal(payload.data.summary.totalNetDelta, null);
    assert.equal(payload.data.summary.totalUnrealizedPnl, null);
    assert.equal(payload.data.events.liquidity.length, 0);
    assert.equal(payload.data.events.claims.length, 0);
  } finally {
    await indexer.close();
  }
});

test('watch requires wallet and/or market target', () => {
  const result = runCli([
    '--output',
    'json',
    'watch',
    '--skip-dotenv',
    '--iterations',
    '1',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.match(payload.error.message, /--wallet and\/or --market-address/);
});

test('watch validates alert target requirements', () => {
  const missingMarket = runCli([
    '--output',
    'json',
    'watch',
    '--skip-dotenv',
    '--wallet',
    ADDRESSES.wallet1,
    '--alert-yes-above',
    '50',
  ]);

  assert.equal(missingMarket.status, 1);
  const missingMarketPayload = parseJsonOutput(missingMarket);
  assert.equal(missingMarketPayload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.match(missingMarketPayload.error.message, /require --market-address/i);

  const missingWallet = runCli([
    '--output',
    'json',
    'watch',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--alert-net-liquidity-above',
    '1',
  ]);

  assert.equal(missingWallet.status, 1);
  const missingWalletPayload = parseJsonOutput(missingWallet);
  assert.equal(missingWalletPayload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.match(missingWalletPayload.error.message, /require --wallet/i);
});

test('watch supports deterministic multi-iteration market snapshots', async () => {
  const result = await runCliAsync([
    '--output',
    'json',
    'watch',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '5',
    '--yes-pct',
    '55',
    '--iterations',
    '2',
    '--interval-ms',
    '1',
  ], { timeoutMs: 30_000 });

  assert.equal(result.timedOut, false);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'watch');
  assert.equal(payload.data.count, 2);
  assert.equal(payload.data.iterationsRequested, 2);
  assert.equal(Array.isArray(payload.data.snapshots), true);
  assert.equal(payload.data.snapshots.length, 2);
  for (const snap of payload.data.snapshots) {
    assert.equal(typeof snap.iteration, 'number');
    assertIsoTimestamp(snap.timestamp);
    assert.equal(snap.quote.quoteAvailable, true);
    assert.equal(snap.quote.odds.source, 'manual:yes-pct');
  }
});

test('watch emits YES-threshold alerts in JSON payload', async () => {
  const result = await runCliAsync([
    '--output',
    'json',
    'watch',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '5',
    '--yes-pct',
    '55',
    '--alert-yes-above',
    '50',
    '--iterations',
    '2',
    '--interval-ms',
    '1',
  ], { timeoutMs: 30_000 });

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'watch');
  assert.equal(payload.data.alertCount, 2);
  assert.equal(payload.data.alerts.length, 2);
  assert.equal(payload.data.alerts[0].code, 'YES_ABOVE_THRESHOLD');
});

test('watch --fail-on-alert exits non-zero when threshold triggers', async () => {
  const result = await runCliAsync([
    '--output',
    'json',
    'watch',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '5',
    '--yes-pct',
    '60',
    '--alert-yes-above',
    '50',
    '--fail-on-alert',
    '--iterations',
    '1',
    '--interval-ms',
    '1',
  ], { timeoutMs: 30_000 });

  assert.equal(result.status, 2);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'WATCH_ALERT_TRIGGERED');
  assert.equal(payload.error.details.alertCount, 1);
});

test('watch can monitor wallet portfolio summary', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'watch',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--iterations',
      '1',
      '--interval-ms',
      '1',
      '--no-events',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'watch');
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.snapshots[0].portfolioSummary.positionCount, 1);
    assert.equal(payload.data.snapshots[0].portfolioSummary.eventsIncluded, false);
  } finally {
    await indexer.close();
  }
});

test('watch emits net-liquidity threshold alerts from wallet snapshots', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'watch',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--alert-net-liquidity-above',
      '900',
      '--iterations',
      '1',
      '--interval-ms',
      '1',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.alertCount, 1);
    assert.equal(payload.data.alerts[0].code, 'NET_LIQUIDITY_ABOVE_THRESHOLD');
  } finally {
    await indexer.close();
  }
});

test('positions list validates --order-by values client-side', () => {
  const result = runCli([
    '--output',
    'json',
    'positions',
    'list',
    '--skip-dotenv',
    '--indexer-url',
    'http://127.0.0.1:1',
    '--order-by',
    'createdAt',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /--order-by must be one of/);
  assert.match(payload.error.message, /lastTradeAt/);
});

test('events list validates address filters client-side', () => {
  const result = runCli([
    '--output',
    'json',
    'events',
    'list',
    '--skip-dotenv',
    '--indexer-url',
    'http://127.0.0.1:1',
    '--wallet',
    'invalid',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /--wallet must be a valid 20-byte hex address/);
});

test('history returns deterministic analytics payload', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'history',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--limit',
      '10',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'history');
    assert.equal(payload.data.schemaVersion, '1.0.0');
    assert.equal(payload.data.wallet, ADDRESSES.wallet1.toLowerCase());
    assert.equal(Array.isArray(payload.data.items), true);
    assert.equal(payload.data.items.length, 2);
    assert.equal(typeof payload.data.summary.tradeCount, 'number');
  } finally {
    await indexer.close();
  }
});

test('export can materialize CSV to --out path', async () => {
  const indexer = await startIndexerMockServer();
  const tempDir = createTempDir('pandora-export-');
  const outPath = path.join(tempDir, 'history.csv');

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'export',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--format',
      'csv',
      '--out',
      outPath,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'export');
    assert.equal(payload.data.schemaVersion, '1.1.0');
    assert.equal(payload.data.format, 'csv');
    assert.equal(payload.data.outPath, outPath);
    assert.equal(fs.existsSync(outPath), true);
    const csv = fs.readFileSync(outPath, 'utf8');
    assert.match(csv, /timestamp,chain_id,wallet/);
    assert.match(csv, /,date,market,action,amount,price,gas_usd,realized_pnl/);
    assert.match(csv, /0xtrade1/);
    assert.equal(Array.isArray(payload.data.rows), true);
    assert.equal(payload.data.rows.length > 0, true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'date'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'market'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'action'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'amount'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'price'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'gas_usd'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'realized_pnl'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'tx_hash'), true);
  } finally {
    await indexer.close();
    removeDir(tempDir);
  }
});

test('arbitrage combines pandora + polymarket fixtures', async () => {
  const indexer = await startIndexerMockServer();
  const polymarket = await startPolymarketMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'arbitrage',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--venues',
      'pandora,polymarket',
      '--polymarket-mock-url',
      polymarket.url,
      '--limit',
      '10',
      '--min-spread-pct',
      '1',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'arbitrage');
    assert.equal(payload.data.schemaVersion, '1.3.0');
    assert.equal(payload.data.parameters.crossVenueOnly, true);
    assert.equal(payload.data.count >= 1, true);
    assert.equal(Array.isArray(payload.data.opportunities), true);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('arbitrage defaults to cross-venue-only and allows same-venue override', async () => {
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: 'market-dup-1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-dup-1',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '12345',
        currentTvl: '4567000000',
        yesChance: '0.80',
        reserveYes: '80',
        reserveNo: '20',
        createdAt: '1700000001',
      },
      {
        id: 'market-dup-2',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-dup-2',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        marketType: 'amm',
        marketCloseTimestamp: '1710001000',
        totalVolume: '22345',
        currentTvl: '5567000000',
        yesChance: '0.55',
        reserveYes: '55',
        reserveNo: '45',
        createdAt: '1700000002',
      },
    ],
    polls: [
      {
        id: 'poll-dup-1',
        chainId: 1,
        chainName: 'ethereum',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        question: 'Will Arsenal win Premier League 2026?',
        status: 1,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpoll-dup-1',
      },
      {
        id: 'poll-dup-2',
        chainId: 1,
        chainName: 'ethereum',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        question: 'Will Arsenal FC win the Premier League in 2026?',
        status: 1,
        category: 3,
        deadlineEpoch: 1710001000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpoll-dup-2',
      },
    ],
  });

  try {
    const crossVenueOnly = await runCliAsync([
      '--output',
      'json',
      'arbitrage',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--venues',
      'pandora',
      '--limit',
      '10',
      '--min-spread-pct',
      '1',
      '--similarity-threshold',
      '0.5',
    ]);

    assert.equal(crossVenueOnly.status, 0);
    const crossPayload = parseJsonOutput(crossVenueOnly);
    assert.equal(crossPayload.data.parameters.crossVenueOnly, true);
    assert.equal(crossPayload.data.count, 0);

    const allowSameVenue = await runCliAsync([
      '--output',
      'json',
      'arbitrage',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--venues',
      'pandora',
      '--limit',
      '10',
      '--min-spread-pct',
      '1',
      '--similarity-threshold',
      '0.5',
      '--allow-same-venue',
    ]);

    assert.equal(allowSameVenue.status, 0);
    const sameVenuePayload = parseJsonOutput(allowSameVenue);
    assert.equal(sameVenuePayload.data.parameters.crossVenueOnly, false);
    assert.equal(sameVenuePayload.data.count >= 1, true);
    assert.equal(Array.isArray(sameVenuePayload.data.opportunities[0].venues), true);
    assert.deepEqual(sameVenuePayload.data.opportunities[0].venues, ['pandora']);
  } finally {
    await indexer.close();
  }
});

test('arbitrage hybrid matcher rejects cross-topic price-target collisions by default', async () => {
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: 'market-btc-1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-btc-1',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        marketType: 'amm',
        marketCloseTimestamp: '1773072000',
        totalVolume: '12345',
        currentTvl: '4567000000',
        yesChance: '0.42',
        reserveYes: '42',
        reserveNo: '58',
        createdAt: '1700000001',
      },
    ],
    polls: [
      {
        id: 'poll-btc-1',
        chainId: 1,
        chainName: 'ethereum',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        question: 'Will Bitcoin hit $75K in 2026?',
        status: 1,
        category: 4,
        deadlineEpoch: 1773072000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpoll-btc-1',
      },
    ],
  });
  const polymarket = await startPolymarketMockServer({
    markets: [
      {
        question: 'Will NFLX close above $750 in 2026?',
        condition_id: 'poly-cond-nflx-1',
        question_id: 'poly-q-nflx-1',
        market_slug: 'nflx-close-above-750',
        end_date_iso: '2026-03-09T16:00:00Z',
        active: true,
        closed: false,
        volume24hr: 100000,
        tokens: [
          { outcome: 'Yes', price: '0.63', token_id: 'poly-yes-nflx-1' },
          { outcome: 'No', price: '0.37', token_id: 'poly-no-nflx-1' },
        ],
      },
    ],
    orderbooks: {
      'poly-yes-nflx-1': {
        bids: [{ price: '0.62', size: '500' }],
        asks: [{ price: '0.63', size: '600' }],
      },
      'poly-no-nflx-1': {
        bids: [{ price: '0.36', size: '500' }],
        asks: [{ price: '0.37', size: '600' }],
      },
    },
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'arbitrage',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--venues',
      'pandora,polymarket',
      '--polymarket-mock-url',
      polymarket.url,
      '--limit',
      '10',
      '--min-spread-pct',
      '1',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.parameters.matcher, 'hybrid');
    assert.equal(payload.data.count, 0);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('arbitrage hybrid matcher can use mock AI adjudication to rescue borderline equivalents', async () => {
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: 'market-mavs-1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-mavs-1',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        marketType: 'amm',
        marketCloseTimestamp: '1773072000',
        totalVolume: '12345',
        currentTvl: '4567000000',
        yesChance: '0.42',
        reserveYes: '42',
        reserveNo: '58',
        createdAt: '1700000001',
      },
    ],
    polls: [
      {
        id: 'poll-mavs-1',
        chainId: 1,
        chainName: 'ethereum',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        question: 'Will Dallas Mavericks beat Boston Celtics?',
        status: 1,
        category: 4,
        deadlineEpoch: 1773072000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpoll-mavs-1',
      },
    ],
  });
  const polymarket = await startPolymarketMockServer({
    markets: [
      {
        question: 'Mavericks vs Celtics winner',
        condition_id: 'poly-cond-mavs-1',
        question_id: 'poly-q-mavs-1',
        market_slug: 'mavericks-vs-celtics-winner',
        end_date_iso: '2026-03-09T16:00:00Z',
        active: true,
        closed: false,
        volume24hr: 100000,
        tokens: [
          { outcome: 'Yes', price: '0.63', token_id: 'poly-yes-mavs-1' },
          { outcome: 'No', price: '0.37', token_id: 'poly-no-mavs-1' },
        ],
      },
    ],
    orderbooks: {
      'poly-yes-mavs-1': {
        bids: [{ price: '0.62', size: '500' }],
        asks: [{ price: '0.63', size: '600' }],
      },
      'poly-no-mavs-1': {
        bids: [{ price: '0.36', size: '500' }],
        asks: [{ price: '0.37', size: '600' }],
      },
    },
  });

  try {
    const withoutAi = await runCliAsync([
      '--output',
      'json',
      'arbitrage',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--venues',
      'pandora,polymarket',
      '--polymarket-mock-url',
      polymarket.url,
      '--limit',
      '10',
      '--min-spread-pct',
      '1',
      '--similarity-threshold',
      '0.9',
      '--include-similarity',
    ]);

    assert.equal(withoutAi.status, 0);
    const withoutAiPayload = parseJsonOutput(withoutAi);
    assert.equal(withoutAiPayload.data.count, 0);

    const withAi = await runCliAsync(
      [
        '--output',
        'json',
        'arbitrage',
        '--skip-dotenv',
        '--indexer-url',
        indexer.url,
        '--venues',
        'pandora,polymarket',
        '--polymarket-mock-url',
        polymarket.url,
        '--limit',
        '10',
        '--min-spread-pct',
        '1',
        '--similarity-threshold',
        '0.9',
        '--include-similarity',
        '--ai-provider',
        'mock',
      ],
      {
        env: {
          PANDORA_ARB_AI_MOCK_RESPONSE: JSON.stringify({
            equivalent: true,
            confidence: 0.95,
            reason: 'Same teams and same winner condition.',
            blockers: [],
            topic: 'sports',
            marketType: 'sports.team_result',
          }),
        },
      },
    );

    assert.equal(withAi.status, 0);
    const withAiPayload = parseJsonOutput(withAi);
    assert.equal(withAiPayload.ok, true);
    assert.equal(withAiPayload.data.parameters.aiProvider, 'mock');
    assert.equal(withAiPayload.data.count >= 1, true);
    assert.equal(withAiPayload.data.opportunities[0].matchSummary.aiAppliedPairCount >= 1, true);
    assert.equal(withAiPayload.data.opportunities[0].similarityChecks.some((entry) => entry.decisionSource === 'ai-overridden'), true);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('arbitrage exposes rules and similarity checks for agent verification', async () => {
  const indexer = await startIndexerMockServer({
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
        rules:
          'Resolves YES if deterministic tests pass in CI. Resolves NO if they fail. Unresolved or cancelled resolves NO.',
        sources: '["https://github.com","https://ci.example.com"]',
      },
    ],
  });
  const polymarket = await startPolymarketMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'arbitrage',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--venues',
      'pandora,polymarket',
      '--polymarket-mock-url',
      polymarket.url,
      '--limit',
      '10',
      '--min-spread-pct',
      '1',
      '--with-rules',
      '--include-similarity',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'arbitrage');
    assert.equal(payload.data.parameters.matcher, 'hybrid');
    assert.equal(payload.data.parameters.withRules, true);
    assert.equal(payload.data.parameters.includeSimilarity, true);
    assert.equal(payload.data.count >= 1, true);

    const opportunity = payload.data.opportunities[0];
    assert.equal(opportunity.matchSummary.matcher, 'hybrid');
    assert.equal(Array.isArray(opportunity.similarityChecks), true);
    assert.equal(opportunity.similarityChecks.length >= 1, true);
    assert.equal(opportunity.similarityChecks.some((entry) => entry.accepted === true), true);
    assert.equal(opportunity.similarityChecks.every((entry) => Array.isArray(entry.semanticBlockers)), true);
    const pandoraLeg = opportunity.legs.find((leg) => leg.venue === 'pandora');
    assert.equal(Boolean(pandoraLeg), true);
    assert.equal(typeof pandoraLeg.rules, 'string');
    assert.equal(Array.isArray(pandoraLeg.sources), true);
    assert.equal(pandoraLeg.sources.length, 2);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('lifecycle start/status/resolve persists state and requires explicit confirm', () => {
  const tempDir = createTempDir('pandora-lifecycle-');
  const lifecycleDir = path.join(tempDir, 'lifecycles');
  const configPath = path.join(tempDir, 'lifecycle.json');
  writeFile(
    configPath,
    JSON.stringify({
      id: 'phase-e2e-1',
      source: 'integration-test',
      marketId: 'market-1',
    }),
  );

  const env = {
    HOME: tempDir,
    PANDORA_LIFECYCLE_DIR: lifecycleDir,
  };

  try {
    const start = runCli(
      ['--output', 'json', 'lifecycle', 'start', '--config', configPath],
      { env },
    );
    assert.equal(start.status, 0);
    const startPayload = parseJsonOutput(start);
    assert.equal(startPayload.command, 'lifecycle.start');
    assert.equal(startPayload.data.id, 'phase-e2e-1');
    assert.equal(startPayload.data.phase, 'AWAITING_RESOLVE');
    const lifecycleFile = path.join(lifecycleDir, 'phase-e2e-1.json');
    assert.equal(fs.existsSync(lifecycleFile), true);
    if (process.platform !== 'win32') {
      const mode = fs.statSync(lifecycleFile).mode & 0o777;
      assert.equal(mode, 0o600);
    }

    const status = runCli(
      ['--output', 'json', 'lifecycle', 'status', '--id', 'phase-e2e-1'],
      { env },
    );
    assert.equal(status.status, 0);
    const statusPayload = parseJsonOutput(status);
    assert.equal(statusPayload.command, 'lifecycle.status');
    assert.equal(statusPayload.data.phase, 'AWAITING_RESOLVE');

    const missingConfirm = runCli(
      ['--output', 'json', 'lifecycle', 'resolve', '--id', 'phase-e2e-1'],
      { env },
    );
    assert.equal(missingConfirm.status, 1);
    const missingConfirmPayload = parseJsonOutput(missingConfirm);
    assert.equal(missingConfirmPayload.error.code, 'MISSING_REQUIRED_FLAG');

    const resolve = runCli(
      ['--output', 'json', 'lifecycle', 'resolve', '--id', 'phase-e2e-1', '--confirm'],
      { env },
    );
    assert.equal(resolve.status, 0);
    const resolvePayload = parseJsonOutput(resolve);
    assert.equal(resolvePayload.command, 'lifecycle.resolve');
    assert.equal(resolvePayload.data.phase, 'RESOLVED');
    assert.equal(resolvePayload.data.changed, true);

    const resolvedStatus = runCli(
      ['--output', 'json', 'lifecycle', 'status', '--id', 'phase-e2e-1'],
      { env },
    );
    assert.equal(resolvedStatus.status, 0);
    const resolvedStatusPayload = parseJsonOutput(resolvedStatus);
    assert.equal(resolvedStatusPayload.data.phase, 'RESOLVED');
    assert.equal(typeof resolvedStatusPayload.data.resolvedAt, 'string');
  } finally {
    removeDir(tempDir);
  }
});

test('lifecycle rejects invalid persisted phases and concurrent starts are creation-safe', async () => {
  const tempDir = createTempDir('pandora-lifecycle-race-');
  const lifecycleDir = path.join(tempDir, 'lifecycles');
  const configPath = path.join(tempDir, 'lifecycle.json');
  writeFile(
    configPath,
    JSON.stringify({
      id: 'phase-race-1',
      source: 'integration-test',
      marketId: 'market-1',
    }),
  );

  const env = {
    HOME: tempDir,
    PANDORA_LIFECYCLE_DIR: lifecycleDir,
  };

  try {
    const [first, second] = await Promise.all([
      runCliAsync(['--output', 'json', 'lifecycle', 'start', '--config', configPath], { env }),
      runCliAsync(['--output', 'json', 'lifecycle', 'start', '--config', configPath], { env }),
    ]);
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [0, 1]);
    const failure = first.status === 1 ? parseJsonOutput(first) : parseJsonOutput(second);
    assert.equal(failure.error.code, 'LIFECYCLE_EXISTS');

    const lifecycleFile = path.join(lifecycleDir, 'phase-race-1.json');
    const persisted = JSON.parse(fs.readFileSync(lifecycleFile, 'utf8'));
    persisted.phase = 'BROKEN_PHASE';
    writeFile(lifecycleFile, JSON.stringify(persisted));

    const statusResult = runCli(['--output', 'json', 'lifecycle', 'status', '--id', 'phase-race-1'], { env });
    assert.equal(statusResult.status, 1);
    const statusPayload = parseJsonOutput(statusResult);
    assert.equal(statusPayload.error.code, 'LIFECYCLE_INVALID_PHASE');

    const resolveResult = runCli(['--output', 'json', 'lifecycle', 'resolve', '--id', 'phase-race-1', '--confirm'], { env });
    assert.equal(resolveResult.status, 1);
    const resolvePayload = parseJsonOutput(resolveResult);
    assert.equal(resolvePayload.error.code, 'LIFECYCLE_INVALID_PHASE');
  } finally {
    removeDir(tempDir);
  }
});

test('odds record rejects insecure non-local indexer urls', () => {
  const result = runCli([
    '--output',
    'json',
    'odds',
    'record',
    '--indexer-url',
    'http://example.com',
  ]);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_INDEXER_URL');
});

test('odds record rejects insecure polymarket host urls', () => {
  const result = runCli([
    '--output',
    'json',
    'odds',
    'record',
    '--competition',
    'soccer_epl',
    '--interval',
    '60',
    '--polymarket-host',
    'http://example.com',
  ]);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /--polymarket-host must use https/i);
});

test('arb scan emits ndjson opportunities when net spread threshold is exceeded', async () => {
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: 'arb-m1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-1',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.40',
        reserveYes: '400',
        reserveNo: '600',
        createdAt: '1700000000',
      },
      {
        id: 'arb-m2',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-2',
        creator: ADDRESSES.wallet2,
        marketType: 'amm',
        marketCloseTimestamp: '1710000001',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.60',
        reserveYes: '600',
        reserveNo: '400',
        createdAt: '1700000001',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      'arb',
      'scan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--markets',
      'arb-m1,arb-m2',
      '--output',
      'ndjson',
      '--min-net-spread-pct',
      '10',
      '--fee-pct-per-leg',
      '0.5',
      '--amount-usdc',
      '100',
      '--iterations',
      '1',
      '--interval-ms',
      '1',
    ]);

    assert.equal(result.status, 0);
    const lines = parseNdjsonOutput(result.stdout);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].type, 'arb.scan.opportunity');
    assert.equal(lines[0].buyYesMarket, 'arb-m1');
    assert.equal(lines[0].buyNoMarket, 'arb-m2');
    assert.equal(lines[0].netSpreadPct, 19);
    assert.equal(lines[0].netSpread, 0.19);
    assert.equal(lines[0].profitUsdc, 19);
    assert.equal(lines[0].profit, 19);
  } finally {
    await indexer.close();
  }
});

test('arb scan tolerates indexers that do not expose yesPct on markets', async () => {
  let rejectedMissingFieldQuery = false;
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: 'arb-compat-1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-compat-1',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000002',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.40',
        reserveYes: '400',
        reserveNo: '600',
        createdAt: '1700000002',
      },
      {
        id: 'arb-compat-2',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-compat-2',
        creator: ADDRESSES.wallet2,
        marketType: 'amm',
        marketCloseTimestamp: '1710000003',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.60',
        reserveYes: '600',
        reserveNo: '400',
        createdAt: '1700000003',
      },
    ],
    handleRequest: ({ query }) => {
      if (query.includes('markets(id:') && query.includes('yesPct')) {
        rejectedMissingFieldQuery = true;
        return {
          body: {
            errors: [{ message: 'Cannot query field "yesPct" on type "markets".' }],
          },
        };
      }
      return null;
    },
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'arb',
      'scan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--markets',
      'arb-compat-1,arb-compat-2',
      '--output',
      'json',
      '--iterations',
      '1',
      '--min-net-spread-pct',
      '10',
      '--fee-pct-per-leg',
      '0.5',
      '--amount-usdc',
      '100',
    ]);

    assert.equal(result.status, 0, result.output);
    assert.equal(rejectedMissingFieldQuery, false);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'arb.scan');
    assert.equal(payload.data.opportunities.length, 1);
    assert.equal(payload.data.opportunities[0].buyYesMarket, 'arb-compat-1');
    assert.equal(payload.data.opportunities[0].buyNoMarket, 'arb-compat-2');
    assert.equal(payload.data.opportunities[0].netSpreadPct, 19);
  } finally {
    await indexer.close();
  }
});

test('arb scan supports bounded JSON envelope output for agent integrations', async () => {
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: 'arb-json-1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-json-1',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710001000',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.40',
        reserveYes: '400',
        reserveNo: '600',
        createdAt: '1700001000',
      },
      {
        id: 'arb-json-2',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-json-2',
        creator: ADDRESSES.wallet2,
        marketType: 'amm',
        marketCloseTimestamp: '1710001001',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.61',
        reserveYes: '610',
        reserveNo: '390',
        createdAt: '1700001001',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'arb',
      'scan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--markets',
      'arb-json-1,arb-json-2',
      '--output',
      'json',
      '--iterations',
      '1',
      '--min-net-spread-pct',
      '5',
      '--fee-pct-per-leg',
      '0.5',
      '--amount-usdc',
      '100',
    ]);

    assert.equal(result.status, 0, result.output);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'arb.scan');
    assert.equal(payload.data.iterationsCompleted, 1);
    assert.equal(Array.isArray(payload.data.opportunities), true);
    assert.equal(typeof payload.data.opportunities.length, 'number');
  } finally {
    await indexer.close();
  }
});

test('arb scan --combinatorial emits bundle opportunities with fee/slippage-adjusted net edge', async () => {
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: 'arb-combo-1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-combo-1',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710001100',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.20',
        reserveYes: '200',
        reserveNo: '800',
        createdAt: '1700001100',
      },
      {
        id: 'arb-combo-2',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-combo-2',
        creator: ADDRESSES.wallet2,
        marketType: 'amm',
        marketCloseTimestamp: '1710001101',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.25',
        reserveYes: '250',
        reserveNo: '750',
        createdAt: '1700001101',
      },
      {
        id: 'arb-combo-3',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-combo-3',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710001102',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.30',
        reserveYes: '300',
        reserveNo: '700',
        createdAt: '1700001102',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      'arb',
      'scan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--markets',
      'arb-combo-1,arb-combo-2,arb-combo-3',
      '--output',
      'ndjson',
      '--combinatorial',
      '--max-bundle-size',
      '3',
      '--min-net-spread-pct',
      '10',
      '--fee-pct-per-leg',
      '0.5',
      '--slippage-pct-per-leg',
      '0.25',
      '--amount-usdc',
      '100',
      '--iterations',
      '1',
      '--interval-ms',
      '1',
    ]);

    assert.equal(result.status, 0);
    const lines = parseNdjsonOutput(result.stdout);
    const combo = lines.find(
      (row) =>
        row &&
        row.opportunityType === 'combinatorial' &&
        row.strategy === 'buy_yes_bundle' &&
        Array.isArray(row.bundleMarketIds) &&
        row.bundleMarketIds.length === 3,
    );

    assert.ok(combo);
    assert.equal(combo.grossEdgePct, 25);
    assert.equal(combo.feeImpactPct, 1.5);
    assert.equal(combo.slippageImpactPct, 0.75);
    assert.equal(combo.netSpreadPct, 22.75);
    assert.equal(combo.profitUsdc, 22.75);
  } finally {
    await indexer.close();
  }
});

test('arb scan is silent when no opportunities clear the threshold', async () => {
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: 'arb-quiet-1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-quiet-1',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.47',
        reserveYes: '470',
        reserveNo: '530',
        createdAt: '1700000000',
      },
      {
        id: 'arb-quiet-2',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-quiet-2',
        creator: ADDRESSES.wallet2,
        marketType: 'amm',
        marketCloseTimestamp: '1710000001',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.52',
        reserveYes: '520',
        reserveNo: '480',
        createdAt: '1700000001',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      'arb',
      'scan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--markets',
      'arb-quiet-1,arb-quiet-2',
      '--output',
      'ndjson',
      '--min-net-spread-pct',
      '8',
      '--fee-pct-per-leg',
      '0.5',
      '--amount-usdc',
      '100',
      '--iterations',
      '1',
      '--interval-ms',
      '1',
    ]);

    assert.equal(result.status, 0);
    assert.equal(String(result.stdout || '').trim(), '');
  } finally {
    await indexer.close();
  }
});

test('autopilot once paper mode persists state and emits action', async () => {
  const tempDir = createTempDir('pandora-autopilot-');
  const stateFile = path.join(tempDir, 'state.json');
  const killFile = path.join(tempDir, 'STOP');

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'autopilot',
      'once',
      '--skip-dotenv',
      '--market-address',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--side',
      'no',
      '--amount-usdc',
      '10',
      '--trigger-yes-above',
      '50',
      '--yes-pct',
      '60',
      '--paper',
      '--state-file',
      stateFile,
      '--kill-switch-file',
      killFile,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'autopilot');
    assert.equal(payload.data.mode, 'once');
    assert.equal(payload.data.executeLive, false);
    assert.equal(payload.data.actionCount, 1);
    assert.equal(fs.existsSync(stateFile), true);
  } finally {
    removeDir(tempDir);
  }
});

test('autopilot --execute-live enforces required risk caps', () => {
  const result = runCli([
    '--output',
    'json',
    'autopilot',
    'once',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '10',
    '--trigger-yes-below',
    '20',
    '--execute-live',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.match(payload.error.message, /max-amount-usdc/);
});

test('mirror plan returns deterministic sizing and distribution payload', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'plan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--with-rules',
      '--include-similarity',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.plan');
    assert.equal(payload.data.schemaVersion, '1.0.0');
    assert.equal(payload.data.sourceMarket.marketId, 'poly-cond-1');
    assert.equal(typeof payload.data.liquidityRecommendation.liquidityUsdc, 'number');
    assert.equal(payload.data.distributionHint.distributionYes + payload.data.distributionHint.distributionNo, 1000000000);
    assert.equal(Array.isArray(payload.data.similarityChecks), true);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror plan computes sports-aware suggested targetTimestamp and cutoff warnings', async () => {
  const polymarket = await startPolymarketMockServer(buildMirrorSportsPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'plan',
      '--skip-dotenv',
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-sports-1',
      '--with-rules',
      '--min-close-lead-seconds',
      '3600',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.command, 'mirror.plan');
    assert.equal(payload.data.sourceMarket.timestampSource, 'game_start_time');
    assert.equal(payload.data.timing.profile.sport, 'basketball');
    assert.equal(payload.data.timing.eventStartTimestampIso, '2030-03-09T23:00:00.000Z');
    assert.equal(payload.data.timing.suggestedTargetTimestampIso, '2030-03-10T04:00:00.000Z');
    assert.equal(payload.data.timing.tradingCutoffTimestampIso, '2030-03-10T03:00:00.000Z');
    assert.match(payload.data.timing.reason, /basketball timing defaults/i);
    assert.equal(
      payload.data.diagnostics.some((line) => /game_start_time/i.test(String(line || ''))),
      true,
    );
  } finally {
    await polymarket.close();
  }
});

test('mirror deploy dry-run uses suggested sports targetTimestamp by default and supports explicit override', async () => {
  const tempDir = createTempDir('pandora-mirror-sports-timing-');
  const planFile = path.join(tempDir, 'mirror-plan.json');
  const polymarket = await startPolymarketMockServer(buildMirrorSportsPolymarketOverrides());

  try {
    const planResult = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'plan',
      '--skip-dotenv',
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-sports-1',
      '--with-rules',
      '--min-close-lead-seconds',
      '3600',
    ]);
    assert.equal(planResult.status, 0);
    fs.writeFileSync(planFile, planResult.stdout, 'utf8');

    const dryRunResult = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'deploy',
      '--skip-dotenv',
      '--plan-file',
      planFile,
      '--dry-run',
      '--sources',
      'https://www.nba.com',
      'https://www.espn.com',
    ]);
    assert.equal(dryRunResult.status, 0);
    const dryRunPayload = parseJsonOutput(dryRunResult);
    assert.equal(dryRunPayload.command, 'mirror.deploy');
    assert.equal(dryRunPayload.data.deploymentArgs.targetTimestamp, Math.floor(Date.parse('2030-03-10T04:00:00Z') / 1000));
    assert.equal(dryRunPayload.data.timing.overrideApplied, false);

    const overrideResult = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'deploy',
      '--skip-dotenv',
      '--plan-file',
      planFile,
      '--dry-run',
      '--target-timestamp',
      '2030-03-10T04:00:00Z',
      '--sources',
      'https://www.nba.com',
      'https://www.espn.com',
    ]);
    assert.equal(overrideResult.status, 0);
    const overridePayload = parseJsonOutput(overrideResult);
    assert.equal(overridePayload.data.deploymentArgs.targetTimestamp, Math.floor(Date.parse('2030-03-10T04:00:00Z') / 1000));
    assert.equal(overridePayload.data.timing.overrideApplied, true);
  } finally {
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror verify exposes confidence, rules hashes, and gate result for agent checks', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'verify',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--include-similarity',
      '--with-rules',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.verify');
    assert.equal(typeof payload.data.matchConfidence, 'number');
    assert.equal(payload.data.gateResult.ok, true);
    assert.equal(typeof payload.data.ruleHashLeft, 'string');
    assert.equal(typeof payload.data.ruleHashRight, 'string');
    assert.equal(Array.isArray(payload.data.similarityChecks), true);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror verify blocks strict rule gate when one side lacks rule text', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer({
    ...buildMirrorPolymarketOverrides(),
    markets: [
      {
        ...buildMirrorPolymarketOverrides().markets[0],
        description: '',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'verify',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--with-rules',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.verify');
    assert.equal(payload.data.gateResult.ok, false);
    assert.equal(payload.data.gateResult.failedChecks.includes('RULE_HASH_MATCH'), true);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror verify falls back to cached Polymarket snapshot when endpoint is unreachable', async () => {
  const tempDir = createTempDir('pandora-mirror-cache-');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const warmResult = await runCliAsync(
      [
        '--output',
        'json',
        'mirror',
        'verify',
        '--skip-dotenv',
        '--indexer-url',
        indexer.url,
        '--polymarket-mock-url',
        polymarket.url,
        '--pandora-market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
      ],
      { env: { HOME: tempDir } },
    );
    assert.equal(warmResult.status, 0);

    const cachedResult = await runCliAsync(
      [
        '--output',
        'json',
        'mirror',
        'verify',
        '--skip-dotenv',
        '--indexer-url',
        indexer.url,
        '--polymarket-mock-url',
        'http://127.0.0.1:9/unreachable',
        '--pandora-market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(cachedResult.status, 0);
    const payload = parseJsonOutput(cachedResult);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.verify');
    assert.equal(payload.data.sourceMarket.source, 'polymarket:cache');
    assert.equal(
      payload.data.sourceMarket.diagnostics.some((line) => String(line).toLowerCase().includes('cached polymarket')),
      true,
    );
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror lp-explain returns complete-set inventory walkthrough payload', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'lp-explain',
    '--liquidity-usdc',
    '10000',
    '--source-yes-pct',
    '58',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.lp-explain');
  assert.equal(payload.data.flow.totalLpInventory.neutralCompleteSets, true);
  assert.equal(payload.data.inputs.distributionYes + payload.data.inputs.distributionNo, 1000000000);
});

test('mirror hedge-calc supports manual reserve inputs', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'hedge-calc',
    '--reserve-yes-usdc',
    '8',
    '--reserve-no-usdc',
    '12',
    '--excess-no-usdc',
    '2',
    '--polymarket-yes-pct',
    '60',
    '--volume-scenarios',
    '1000,5000',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.hedge-calc');
  assert.equal(payload.data.metrics.hedgeToken, 'yes');
  assert.equal(payload.data.scenarios.length, 2);
});

test('mirror hedge-calc can auto-resolve reserves from a mirror pair', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides({
    markets: [
      {
        ...buildMirrorIndexerOverrides().markets[0],
        reserveYes: '8000000',
        reserveNo: '12000000',
      },
    ],
  }));
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'hedge-calc',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.hedge-calc');
    assert.equal(payload.data.metrics.reserveYesUsdc, 8);
    assert.equal(payload.data.metrics.reserveNoUsdc, 12);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror simulate returns deterministic scenarios for LP economics planning', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'simulate',
    '--liquidity-usdc',
    '5000',
    '--source-yes-pct',
    '60',
    '--target-yes-pct',
    '60',
    '--polymarket-yes-pct',
    '60',
    '--volume-scenarios',
    '500,2500',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.simulate');
  assert.equal(payload.data.scenarios.length, 2);
  assert.equal(payload.data.inputs.tradeSide, 'yes');
});

test('simulate namespace supports scoped json help', () => {
  const result = runCli(['--output', 'json', 'simulate', '--help']);
  assert.equal(result.status, 0);

  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'simulate.help');
  assert.match(payload.data.usage, /simulate mc\|particle-filter\|agents/);
});

test('simulate mc returns deterministic CI + VaR/ES with seed replay', () => {
  const args = [
    '--output',
    'json',
    'simulate',
    'mc',
    '--trials',
    '2500',
    '--horizon',
    '48',
    '--start-yes-pct',
    '57',
    '--entry-yes-pct',
    '57',
    '--position',
    'yes',
    '--stake-usdc',
    '100',
    '--drift-bps',
    '0',
    '--vol-bps',
    '175',
    '--confidence',
    '95',
    '--var-level',
    '95',
    '--seed',
    '23',
    '--antithetic',
  ];

  const first = runCli(args);
  const second = runCli(args);
  assert.equal(first.status, 0);
  assert.equal(second.status, 0);

  const firstPayload = parseJsonOutput(first);
  const secondPayload = parseJsonOutput(second);

  assert.equal(firstPayload.command, 'simulate.mc');
  assert.equal(secondPayload.command, 'simulate.mc');
  assert.equal(firstPayload.data.summary.finalYesPct.mean, secondPayload.data.summary.finalYesPct.mean);
  assert.equal(firstPayload.data.summary.pnlUsdc.mean, secondPayload.data.summary.pnlUsdc.mean);
  assert.equal(
    firstPayload.data.summary.risk.valueAtRiskUsdc,
    secondPayload.data.summary.risk.valueAtRiskUsdc,
  );
  assert.equal(
    firstPayload.data.summary.risk.expectedShortfallUsdc,
    secondPayload.data.summary.risk.expectedShortfallUsdc,
  );
  assert.equal(typeof firstPayload.data.summary.finalYesPct.ciLower, 'number');
  assert.equal(typeof firstPayload.data.summary.finalYesPct.ciUpper, 'number');
  assert.equal(typeof firstPayload.data.summary.risk.valueAtRiskUsdc, 'number');
  assert.equal(typeof firstPayload.data.summary.risk.expectedShortfallUsdc, 'number');
});

test('simulate particle-filter consumes inline observations and emits ESS diagnostics', () => {
  const result = runCli([
    '--output',
    'json',
    'simulate',
    'particle-filter',
    '--observations-json',
    '[{\"yesPct\":52},null,{\"yesPct\":49},{\"yesPct\":51}]',
    '--particles',
    '600',
    '--process-noise',
    '0.15',
    '--observation-noise',
    '0.08',
    '--resample-threshold',
    '0.55',
    '--resample-method',
    'systematic',
    '--credible-interval',
    '90',
    '--seed',
    '31',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.command, 'simulate.particle-filter');
  assert.equal(payload.data.trajectory.length, 4);
  assert.equal(payload.data.summary.observedCount, 3);
  assert.equal(payload.data.summary.missingCount, 1);
  assert.equal(typeof payload.data.summary.averageEss, 'number');
  assert.equal(Array.isArray(payload.data.diagnostics), true);
  assert.equal(payload.data.diagnostics.some((item) => item && item.code === 'SPARSE_OBSERVATIONS'), true);
});

test('simulate particle-filter accepts NDJSON file input', () => {
  const tempDir = createTempDir('pandora-simulate-pf-');
  const inputPath = path.join(tempDir, 'observations.ndjson');
  writeFile(
    inputPath,
    ['{\"yesPct\":48}', '{\"yesPct\":49}', '{\"yesPct\":52}', '{\"yesPct\":54}'].join('\n'),
  );

  try {
    const result = runCli([
      '--output',
      'json',
      'simulate',
      'particle-filter',
      '--input',
      inputPath,
      '--particles',
      '700',
      '--seed',
      '5',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.command, 'simulate.particle-filter');
    assert.equal(payload.data.trajectory.length, 4);
    assert.equal(typeof payload.data.summary.final.filteredYesPct, 'number');
  } finally {
    removeDir(tempDir);
  }
});

test('simulate agents returns deterministic ABM diagnostics in json mode', () => {
  const args = [
    '--output',
    'json',
    'simulate',
    'agents',
    '--n-informed',
    '6',
    '--n-noise',
    '20',
    '--n-mm',
    '4',
    '--n-steps',
    '35',
    '--seed',
    '99',
  ];

  const first = runCli(args);
  const second = runCli(args);
  assert.equal(first.status, 0);
  assert.equal(second.status, 0);

  const firstPayload = parseJsonOutput(first);
  const secondPayload = parseJsonOutput(second);
  const { generatedAt: _firstGeneratedAt, ...firstDataStable } = firstPayload.data;
  const { generatedAt: _secondGeneratedAt, ...secondDataStable } = secondPayload.data;

  assert.equal(firstPayload.ok, true);
  assert.equal(firstPayload.command, 'simulate.agents');
  assert.deepEqual(firstDataStable, secondDataStable);
  assert.equal(firstPayload.data.parameters.n_informed, 6);
  assert.equal(firstPayload.data.parameters.n_noise, 20);
  assert.equal(firstPayload.data.parameters.n_mm, 4);
  assert.equal(firstPayload.data.parameters.n_steps, 35);
  assert.equal(typeof firstPayload.data.finalState.midPrice, 'number');
  assert.equal(typeof firstPayload.data.volume.total, 'number');
  assert.equal(typeof firstPayload.data.runtimeBounds.estimatedWorkUnits, 'number');
});

test('mirror simulate --engine mc returns Monte Carlo summary and tail risk blocks', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'simulate',
    '--liquidity-usdc',
    '5000',
    '--source-yes-pct',
    '60',
    '--target-yes-pct',
    '60',
    '--polymarket-yes-pct',
    '60',
    '--engine',
    'mc',
    '--paths',
    '400',
    '--steps',
    '16',
    '--seed',
    '17',
    '--importance-sampling',
    '--antithetic',
    '--control-variate',
    '--stratified',
    '--volume-scenarios',
    '500,2500',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.simulate');
  assert.equal(payload.data.inputs.engine, 'mc');
  assert.equal(payload.data.mc.summary.paths, 400);
  assert.equal(payload.data.mc.summary.steps, 16);
  assert.equal(payload.data.mc.summary.seed, 17);
  assert.equal(typeof payload.data.mc.tailRisk.var95Usdc, 'number');
  assert.equal(typeof payload.data.mc.tailRisk.var99Usdc, 'number');
  assert.equal(typeof payload.data.mc.tailRisk.es95Usdc, 'number');
  assert.equal(typeof payload.data.mc.tailRisk.es99Usdc, 'number');
  assert.ok(payload.data.mc.tailRisk.var99Usdc >= payload.data.mc.tailRisk.var95Usdc);
});

test('model diagnose returns classification and machine-readable gating flags', () => {
  const result = runCli([
    '--output',
    'json',
    'model',
    'diagnose',
    '--calibration-rmse',
    '0.12',
    '--drift-bps',
    '85',
    '--spread-bps',
    '70',
    '--depth-coverage',
    '0.72',
    '--informed-flow-ratio',
    '0.61',
    '--noise-ratio',
    '0.34',
    '--anomaly-rate',
    '0.08',
    '--manipulation-alerts',
    '1',
    '--tail-dependence',
    '0.22',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'model.diagnose');
  assert.equal(typeof payload.data.aggregate.classification, 'string');
  assert.equal(typeof payload.data.flags.allowExecution, 'boolean');
  assert.equal(typeof payload.data.flags.requireHumanReview, 'boolean');
  assert.equal(typeof payload.data.flags.blockExecution, 'boolean');
});

test('mirror deploy dry-run materializes deployment args without chain writes', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'deploy',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--dry-run',
      '--fee-tier',
      '50000',
      '--sources',
      'https://www.nba.com',
      'https://www.espn.com',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.deploy');
    assert.equal(payload.data.schemaVersion, '1.0.0');
    assert.equal(payload.data.dryRun, true);
    assert.equal(payload.data.tx, null);
    assert.equal(payload.data.deploymentArgs.feeTier, 50000);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror deploy rejects fee tiers above 5%', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'deploy',
    '--dry-run',
    '--polymarket-market-id',
    'poly-cond-1',
    '--fee-tier',
    '50001',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /--fee-tier must be between 500 and 50000/i);
});

test('mirror deploy validates --private-key format', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'deploy',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--dry-run',
      '--sources',
      'https://www.nba.com',
      'https://www.espn.com',
      '--private-key',
      '0x1234',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
    assert.match(payload.error.message, /--private-key must be a valid private key/i);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror deploy translates Polymarket winner rules into Pandora YES/NO format', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer({
    ...buildMirrorPolymarketOverrides(),
    markets: [
      {
        ...buildMirrorPolymarketOverrides().markets[0],
        question: 'Will the Detroit Pistons beat the Brooklyn Nets?',
        description: 'This market resolves to Detroit Pistons.',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'deploy',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--dry-run',
      '--sources',
      'https://www.nba.com',
      'https://www.espn.com',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.deploy');
    assert.equal(payload.data.deploymentArgs.question, 'Will the Detroit Pistons beat the Brooklyn Nets?');
    assert.match(payload.data.deploymentArgs.rules, /^YES: The official winner of the event described in the market question is the Detroit Pistons\./);
    assert.match(payload.data.deploymentArgs.rules, /^NO: The official winner is the Brooklyn Nets,/m);
    assert.match(payload.data.deploymentArgs.rules, /^EDGE: /m);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror deploy rejects missing explicit sources instead of auto-adding Polymarket URLs', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'deploy',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--dry-run',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'MIRROR_SOURCES_REQUIRED');
    assert.match(payload.error.message, /explicit independent resolution sources/i);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror deploy rejects Polymarket URLs in explicit --sources', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'deploy',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--dry-run',
      '--sources',
      'https://polymarket.com/event/test-market',
      'https://clob.polymarket.com',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'MIRROR_SOURCES_INVALID');
    assert.match(payload.error.message, /not allowed in --sources/i);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror deploy rejects same-host sources that are not independent', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'deploy',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--dry-run',
      '--sources',
      'https://www.nba.com/game/1',
      'https://www.nba.com/game/2',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'MIRROR_SOURCES_REQUIRED');
    assert.match(payload.error.message, /different hosts/i);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror deploy execute requires a validation ticket before any live write', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'deploy',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--execute',
      '--sources',
      'https://www.nba.com',
      'https://www.espn.com',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'MIRROR_VALIDATION_REQUIRED');
    assert.match(payload.error.message, /validation-ticket/i);
    assert.equal(payload.error.recovery.command.includes('agent market validate'), true);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror go accepts named --skip-gate lists during parsing', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'go',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--paper',
      '--auto-sync',
      '--sources',
      'https://www.nba.com',
      'https://www.espn.com',
      '--skip-gate',
      'MAX_TRADES_PER_DAY,DEPTH_COVERAGE',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'MIRROR_GO_SYNC_REQUIRES_DEPLOYED_MARKET');
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror sync rejects invalid rebalance route enums using flashbots naming contract', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'sync',
    'once',
    '--skip-dotenv',
    '--pandora-market-address',
    ADDRESSES.mirrorMarket,
    '--polymarket-market-id',
    'poly-cond-1',
    '--paper',
    '--rebalance-route',
    'private',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /--rebalance-route must be public\|auto\|flashbots-private\|flashbots-bundle\./);
});

test('mirror command dispatcher preserves normalized live sync trade execution payloads including flashbots routing contract', async () => {
  class TestCliError extends Error {
    constructor(code, message, details = null) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }

  const captured = {
    callOrder: [],
  };
  const quotePayload = {
    quoteAvailable: true,
    odds: { yesPct: 57, noPct: 43 },
    estimate: { estimatedShares: 43.859649, minSharesOut: 43.201754 },
  };
  let emitted = null;

  const runMirrorCommand = createRunMirrorCommand({
    CliError: TestCliError,
    emitSuccess: (_mode, command, payload) => {
      emitted = { command, payload };
    },
    commandHelpPayload: () => ({}),
    parseIndexerSharedFlags: (args) => ({
      rest: args,
      indexerUrl: 'https://indexer.example/graphql',
      timeoutMs: 1000,
    }),
    includesHelpFlag: () => false,
    maybeLoadTradeEnv: () => {},
    resolveIndexerUrl: (value) => value || 'https://indexer.example/graphql',
    parseMirrorSyncDaemonSelectorFlags: () => {
      throw new Error('selector flags should not be read for once mode');
    },
    stopMirrorDaemon: async () => {
      throw new Error('stopMirrorDaemon should not run for once mode');
    },
    mirrorDaemonStatus: () => {
      throw new Error('mirrorDaemonStatus should not run for once mode');
    },
    parseMirrorSyncFlags: () => ({
      mode: 'once',
      stream: false,
      daemon: false,
      executeLive: true,
      trustDeploy: false,
      pandoraMarketAddress: ADDRESSES.mirrorMarket,
      polymarketMarketId: 'poly-cond-1',
      polymarketSlug: null,
      chainId: 1,
      rpcUrl: 'https://rpc.example',
      fork: false,
      forkRpcUrl: null,
      forkChainId: null,
      privateKey: `0x${'1'.repeat(64)}`,
      profileId: null,
      profileFile: null,
      usdc: ADDRESSES.usdc,
      failOnWebhookError: false,
      rebalanceRoute: 'flashbots-bundle',
      rebalanceRouteFallback: 'public',
      flashbotsRelayUrl: 'https://relay.flashbots.example',
      flashbotsAuthKey: 'test-flashbots-auth-key',
      flashbotsTargetBlockOffset: 3,
    }),
    buildMirrorSyncStrategy: () => ({}),
    mirrorStrategyHash: () => 'strategy-hash',
    buildMirrorSyncDaemonCliArgs: () => [],
    startMirrorDaemon: async () => {
      throw new Error('startMirrorDaemon should not run for once mode');
    },
    resolveTrustedDeployPair: () => {
      throw new Error('resolveTrustedDeployPair should not run without trustDeploy');
    },
    selectHealthyPolymarketRpc: async () => ({
      selectedRpcUrl: 'https://polygon-rpc.example',
      fallbackUsed: false,
      attempts: [{ rpcUrl: 'https://polygon-rpc.example', ok: true, order: 1, chainId: 137 }],
      diagnostics: [],
    }),
    runLivePolymarketPreflightForMirror: async () => ({ ok: true }),
    runMirrorSync: async (_options, runtimeDeps) => {
      const result = await runtimeDeps.rebalanceFn({
        marketAddress: ADDRESSES.mirrorMarket,
        side: 'yes',
        amountUsdc: 25,
      });
      return {
        mode: 'once',
        strategyHash: 'strategy-hash',
        actionCount: 1,
        actions: [{ status: 'executed', rebalance: { result } }],
        snapshots: [],
        diagnostics: [],
        state: { tradesToday: 1, idempotencyKeys: [] },
      };
    },
    buildQuotePayload: async (_indexerUrl, tradeOptions) => {
      captured.callOrder.push('quote');
      captured.quoteTradeOptions = tradeOptions;
      return quotePayload;
    },
    enforceTradeRiskGuards: (tradeOptions, quote) => {
      captured.callOrder.push('guard');
      captured.guardTradeOptions = tradeOptions;
      captured.guardQuote = quote;
    },
    executeTradeOnchain: async (tradeOptions) => {
      captured.callOrder.push('execute');
      captured.executionTradeOptions = tradeOptions;
      return {
        ok: true,
        marketType: 'amm',
        tradeSignature: 'buy(bool,uint256,uint256,uint256)',
        ammDeadlineEpoch: '1710000910',
      };
    },
    assertLiveWriteAllowed: async () => {},
    hasWebhookTargets: () => false,
    sendWebhookNotifications: async () => ({ failureCount: 0 }),
    coerceMirrorServiceError: (error) => error,
    renderMirrorSyncTickLine: () => {},
    renderMirrorSyncDaemonTable: () => {},
    renderMirrorSyncTable: () => {},
    cliPath: '/Users/mac/Desktop/pandora-market-setup-shareable/cli/pandora.cjs',
  });

  await runMirrorCommand(['sync', 'once'], { outputMode: 'json' });

  assert.equal(emitted.command, 'mirror.sync');
  assert.deepEqual(captured.callOrder, ['quote', 'guard', 'execute']);
  assert.equal(captured.guardTradeOptions, captured.executionTradeOptions);
  assert.equal(captured.quoteTradeOptions, captured.executionTradeOptions);
  assert.equal(captured.executionTradeOptions.mode, 'buy');
  assert.equal(captured.executionTradeOptions.amount, null);
  assert.equal(captured.executionTradeOptions.minAmountOutRaw, null);
  assert.equal(captured.executionTradeOptions.allowUnquotedExecute, true);
  assert.equal(captured.executionTradeOptions.deadlineSeconds, 900);
  assert.equal(captured.executionTradeOptions.rebalanceRoute, 'flashbots-bundle');
  assert.equal(captured.executionTradeOptions.rebalanceRouteFallback, 'public');
  assert.equal(captured.executionTradeOptions.flashbotsRelayUrl, 'https://relay.flashbots.example');
  assert.equal(captured.executionTradeOptions.flashbotsAuthKey, 'test-flashbots-auth-key');
  assert.equal(captured.executionTradeOptions.flashbotsTargetBlockOffset, 3);
  assert.equal(captured.guardQuote, quotePayload);
  assert.equal(emitted.payload.actions[0].rebalance.result.quote, quotePayload);
  assert.equal(emitted.payload.actions[0].rebalance.result.ammDeadlineEpoch, '1710000910');
});

test('mirror sync once paper mode performs deterministic simulated action and persists state', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const killFile = path.join(tempDir, 'STOP');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'sync',
      'once',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--paper',
      '--funder',
      '0x2222222222222222222222222222222222222222',
      '--drift-trigger-bps',
      '25',
      '--hedge-trigger-usdc',
      '1000000',
      '--hedge-ratio',
      '0.75',
      '--state-file',
      stateFile,
      '--kill-switch-file',
      killFile,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.sync');
    assert.equal(payload.data.mode, 'once');
    assert.equal(payload.data.executeLive, false);
    assert.equal(payload.data.parameters.hedgeEnabled, true);
    assert.equal(payload.data.parameters.hedgeRatio, 0.75);
    assert.equal(payload.data.actionCount, 1);
    assert.equal(payload.data.snapshots[0].metrics.rebalanceSizingBasis, 'atomic-target-price');
    assert.equal(typeof payload.data.snapshots[0].metrics.rebalanceTargetUsdc, 'number');
    assert.equal(payload.data.snapshots[0].metrics.plannedRebalanceUsdc, 25);
    assert.equal(fs.existsSync(stateFile), true);
    assert.equal(payload.data.actions[0].status, 'simulated');
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror sync treats close-time mismatch as diagnostic by default and blocking in strict close delta mode', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-close-delta-');
  const diagnosticStateFile = path.join(tempDir, 'mirror-state-diagnostic.json');
  const strictStateFile = path.join(tempDir, 'mirror-state-strict.json');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer({
    markets: [
      {
        ...buildMirrorPolymarketOverrides().markets[0],
        end_date_iso: '2030-03-10T01:00:00Z',
      },
    ],
  });

  try {
    const diagnosticResult = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'sync',
      'once',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--paper',
      '--drift-trigger-bps',
      '25',
      '--hedge-trigger-usdc',
      '1000000',
      '--min-time-to-close-sec',
      '5',
      '--state-file',
      diagnosticStateFile,
    ]);

    assert.equal(diagnosticResult.status, 0);
    const diagnosticPayload = parseJsonOutput(diagnosticResult);
    assert.equal(diagnosticPayload.ok, true);
    assert.equal(diagnosticPayload.data.actionCount, 1);
    assert.equal(diagnosticPayload.data.actions[0].status, 'simulated');
    assert.equal(diagnosticPayload.data.snapshots[0].strictGate.ok, true);
    assert.equal(
      diagnosticPayload.data.snapshots[0].strictGate.checks.find((item) => item.code === 'CLOSE_TIME_DELTA').details.diagnosticOnly,
      true,
    );

    const strictResult = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'sync',
      'once',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--paper',
      '--strict-close-time-delta',
      '--drift-trigger-bps',
      '25',
      '--hedge-trigger-usdc',
      '1000000',
      '--min-time-to-close-sec',
      '5',
      '--state-file',
      strictStateFile,
    ]);

    assert.equal(strictResult.status, 0);
    const strictPayload = parseJsonOutput(strictResult);
    assert.equal(strictPayload.ok, true);
    assert.equal(strictPayload.data.actionCount, 0);
    assert.equal(strictPayload.data.snapshots[0].action.status, 'blocked');
    assert.deepEqual(strictPayload.data.snapshots[0].action.failedChecks, ['CLOSE_TIME_DELTA']);
    assert.deepEqual(strictPayload.data.snapshots[0].strictGate.failedChecks, ['CLOSE_TIME_DELTA']);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror sync --skip-gate keeps legacy skip-all bypass behavior', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-skip-all-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        lastResetDay: new Date().toISOString().slice(0, 10),
        tradesToday: 1,
      },
      null,
      2,
    ),
  );

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'sync',
      'once',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--paper',
      '--drift-trigger-bps',
      '25',
      '--hedge-trigger-usdc',
      '1000000',
      '--max-trades-per-day',
      '1',
      '--skip-gate',
      '--state-file',
      stateFile,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.sync');
    assert.equal(payload.data.actionCount, 1);
    assert.equal(payload.data.actions[0].status, 'simulated');
    assert.equal(payload.data.actions[0].forcedGateBypass, true);
    assert.equal(payload.data.actions[0].bypassedFailedChecks.includes('MAX_TRADES_PER_DAY'), true);
    assert.equal(payload.data.snapshots[0].strictGate.ok, true);
    assert.equal(payload.data.snapshots[0].strictGate.failedChecksRaw.includes('MAX_TRADES_PER_DAY'), true);
    assert.equal(payload.data.snapshots[0].strictGate.bypassedFailedChecks.includes('MAX_TRADES_PER_DAY'), true);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror sync --skip-gate with named checks bypasses only matching failures', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-skip-selective-');
  const bypassStateFile = path.join(tempDir, 'mirror-state-bypass.json');
  const blockedStateFile = path.join(tempDir, 'mirror-state-blocked.json');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  fs.writeFileSync(
    bypassStateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        lastResetDay: new Date().toISOString().slice(0, 10),
        tradesToday: 1,
      },
      null,
      2,
    ),
  );

  try {
    const selectiveBypassResult = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'sync',
      'once',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--paper',
      '--drift-trigger-bps',
      '25',
      '--hedge-trigger-usdc',
      '1000000',
      '--max-trades-per-day',
      '1',
      '--skip-gate=MAX_TRADES_PER_DAY',
      '--state-file',
      bypassStateFile,
    ]);

    assert.equal(selectiveBypassResult.status, 0);
    const selectiveBypassPayload = parseJsonOutput(selectiveBypassResult);
    assert.equal(selectiveBypassPayload.ok, true);
    assert.equal(selectiveBypassPayload.command, 'mirror.sync');
    assert.equal(selectiveBypassPayload.data.parameters.forceGate, false);
    assert.deepEqual(selectiveBypassPayload.data.parameters.skipGateChecks, ['MAX_TRADES_PER_DAY']);
    assert.equal(selectiveBypassPayload.data.actionCount, 1);
    assert.equal(selectiveBypassPayload.data.actions[0].status, 'simulated');
    assert.equal(selectiveBypassPayload.data.actions[0].failedChecks.length, 0);
    assert.equal(selectiveBypassPayload.data.actions[0].bypassedFailedChecks.includes('MAX_TRADES_PER_DAY'), true);

    fs.writeFileSync(
      blockedStateFile,
      JSON.stringify(
        {
          schemaVersion: '1.0.0',
          lastResetDay: new Date().toISOString().slice(0, 10),
          tradesToday: 1,
        },
        null,
        2,
      ),
    );

    const selectiveNoBypassResult = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'sync',
      'once',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--paper',
      '--drift-trigger-bps',
      '25',
      '--hedge-trigger-usdc',
      '1000000',
      '--max-trades-per-day',
      '1',
      '--skip-gate',
      'DEPTH_COVERAGE',
      '--state-file',
      blockedStateFile,
    ]);

    assert.equal(selectiveNoBypassResult.status, 0);
    const selectiveNoBypassPayload = parseJsonOutput(selectiveNoBypassResult);
    assert.equal(selectiveNoBypassPayload.ok, true);
    assert.equal(selectiveNoBypassPayload.command, 'mirror.sync');
    assert.deepEqual(selectiveNoBypassPayload.data.parameters.skipGateChecks, ['DEPTH_COVERAGE']);
    assert.equal(selectiveNoBypassPayload.data.actionCount, 0);
    assert.equal(selectiveNoBypassPayload.data.snapshots[0].action.status, 'blocked');
    assert.equal(selectiveNoBypassPayload.data.snapshots[0].action.failedChecks.includes('MAX_TRADES_PER_DAY'), true);
    assert.equal(selectiveNoBypassPayload.data.snapshots[0].action.bypassedFailedChecks.length, 0);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror sync --no-hedge suppresses hedge trigger path while preserving snapshot diagnostics', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-no-hedge-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const indexer = await startIndexerMockServer(
    buildMirrorIndexerOverrides({
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
          yesChance: '0.80',
          reserveYes: '80000000',
          reserveNo: '20000000',
          createdAt: '1700000000',
        },
      ],
    }),
  );
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'sync',
      'once',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--paper',
      '--drift-trigger-bps',
      '2000',
      '--hedge-trigger-usdc',
      '10',
      '--no-hedge',
      '--state-file',
      stateFile,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.sync');
    assert.equal(payload.data.parameters.hedgeEnabled, false);
    assert.equal(payload.data.actionCount, 0);
    assert.equal(payload.data.snapshots[0].metrics.rawHedgeTriggered, true);
    assert.equal(payload.data.snapshots[0].metrics.hedgeTriggered, false);
    assert.equal(payload.data.snapshots[0].metrics.hedgeSuppressed, true);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror sync validates --hedge-ratio upper bound', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'sync',
    'once',
    '--skip-dotenv',
    '--pandora-market-address',
    ADDRESSES.mirrorMarket,
    '--polymarket-market-id',
    'poly-cond-1',
    '--paper',
    '--hedge-ratio',
    '2.5',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /--hedge-ratio/);
});

test('mirror sync --help json includes live hedge environment requirements', () => {
  const result = runCli(['--output', 'json', 'mirror', 'sync', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.sync.help');
  assert.equal(Array.isArray(payload.data.notes), true);
  assert.equal(Array.isArray(payload.data.liveHedgeEnv), true);
  assert.equal(payload.data.liveHedgeEnv.includes('POLYMARKET_PRIVATE_KEY'), true);
  assert.equal(payload.data.liveHedgeEnv.includes('POLYMARKET_API_KEY'), true);
  assert.match(payload.data.usage, /--funder <address>/);
  assert.match(payload.data.usage, /--profile-id <id>\|--profile-file <path>/);
  assert.match(payload.data.usage, /--polymarket-rpc-url <url>/);
  assert.match(payload.data.usage, /--min-time-to-close-sec <n>/);
  assert.match(payload.data.usage, /--strict-close-time-delta/);
  assert.match(payload.data.usage, /--verbose/);
  assert.doesNotMatch(payload.data.usage, /--daemon/);
  assert.match(payload.data.usage, /--hedge-scope pool\|total/);
  assert.match(payload.data.usage, /--adopt-existing-positions/);
  assert.match(payload.data.usage, /--rebalance-mode atomic\|incremental/);
  assert.match(payload.data.usage, /--price-source on-chain\|indexer/);
  assert.match(payload.data.usage, /--rebalance-route public\|auto\|flashbots-private\|flashbots-bundle/);
  assert.match(payload.data.usage, /--rebalance-route-fallback fail\|public/);
  assert.match(payload.data.usage, /--flashbots-relay-url <url>/);
  assert.match(payload.data.usage, /--flashbots-auth-key <key>/);
  assert.match(payload.data.usage, /--flashbots-target-block-offset <n>/);
  assert.match(payload.data.liveHedgeNotes.rpcFallback, /comma-separated/i);
  assert.match(payload.data.liveHedgeNotes.collateral, /scope mismatch/i);
  assert.match(payload.data.liveHedgeNotes.collateral, /buying power/i);
  assert.match(payload.data.statusTelemetry.health, /runtime\.health/i);
  assert.match(payload.data.statusTelemetry.lastTrade, /runtime\.lastTrade/i);
  assert.match(payload.data.statusTelemetry.errors, /runtime\.errorCount/i);
  assert.match(payload.data.statusTelemetry.nextAction, /runtime\.nextAction/i);
  assert.match(payload.data.staleCacheFallback, /cached snapshots/i);
  assert.equal(payload.data.notes.some((note) => /\.pandora\/mirror\/STOP/.test(String(note))), true);
  assert.match(payload.data.daemonLifecycle.unlock, /mirror sync unlock/);
  assert.equal(payload.data.notes.some((note) => /mirror sync unlock/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /adopt-existing-positions/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /Default hedge scope is `total`/i.test(String(note))), true);
});

test('mirror sync unlock --help returns recovery-specific guidance', () => {
  const result = runCli(['--output', 'json', 'mirror', 'sync', 'unlock', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.sync.unlock.help');
  assert.match(payload.data.usage, /--state-file <path>\|--strategy-hash <hash>/);
  assert.match(payload.data.usage, /--force/);
  assert.equal(payload.data.notes.some((note) => /zombie/i.test(String(note))), true);
});

test('mirror go --help json includes flashbots routing flag contract', () => {
  const result = runCli(['--output', 'json', 'mirror', 'go', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.go.help');
  assert.equal(Array.isArray(payload.data.notes), true);
  assert.match(payload.data.usage, /--rebalance-route public\|auto\|flashbots-private\|flashbots-bundle/);
  assert.match(payload.data.usage, /--rebalance-route-fallback fail\|public/);
  assert.match(payload.data.usage, /--flashbots-relay-url <url>/);
  assert.match(payload.data.usage, /--flashbots-auth-key <key>/);
  assert.match(payload.data.usage, /--flashbots-target-block-offset <n>/);
  assert.match(payload.data.usage, /--auto-resolve/);
  assert.match(payload.data.usage, /--auto-close/);
  assert.match(payload.data.usage, /--resolve-answer yes\|no/);
  assert.match(payload.data.usage, /--resolve-reason <text>/);
  assert.equal(payload.data.notes.some((note) => /validation tickets are bound to the exact final deploy payload/i.test(String(note))), true);
});

test('mirror deploy --help json surfaces validation-ticket caveats and percentage distribution flags', () => {
  const result = runCli(['--output', 'json', 'mirror', 'deploy', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.deploy.help');
  assert.equal(Array.isArray(payload.data.notes), true);
  assert.match(payload.data.usage, /--distribution-yes-pct <pct>/);
  assert.match(payload.data.usage, /--distribution-no-pct <pct>/);
  assert.equal(payload.data.notes.some((note) => /exact final deploy payload/i.test(String(note))), true);
});

test('mirror trace --help json includes historical reserve tracing usage and archive notes', () => {
  const result = runCli(['--output', 'json', 'mirror', 'trace', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.trace.help');
  assert.match(payload.data.usage, /mirror trace/);
  assert.match(payload.data.usage, /--rpc-url <url>/);
  assert.match(payload.data.usage, /--blocks <csv>/);
  assert.match(payload.data.usage, /--from-block <n>/);
  assert.match(payload.data.usage, /--to-block <n>/);
  assert.equal(Array.isArray(payload.data.notes), true);
  assert.equal(payload.data.notes.some((note) => /archive/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /historical reserve/i.test(String(note))), true);
});

test('command descriptors expose flashbots routing flags for mirror go and sync surfaces', () => {
  const descriptors = buildCommandDescriptors();

  assert.ok(descriptors['mirror.go']);
  assert.match(descriptors['mirror.go'].usage, /--rebalance-route public\|auto\|flashbots-private\|flashbots-bundle/);
  assert.match(descriptors['mirror.go'].usage, /--rebalance-route-fallback fail\|public/);
  assert.match(descriptors['mirror.go'].usage, /--flashbots-relay-url <url>/);
  assert.match(descriptors['mirror.go'].usage, /--flashbots-auth-key <key>/);
  assert.match(descriptors['mirror.go'].usage, /--flashbots-target-block-offset <n>/);
  assert.match(descriptors['mirror.go'].usage, /--auto-resolve/);
  assert.match(descriptors['mirror.go'].usage, /--auto-close/);
  assert.match(descriptors['mirror.go'].usage, /--resolve-answer yes\|no/);

  for (const commandName of ['mirror.sync.once', 'mirror.sync.run', 'mirror.sync.start']) {
    assert.ok(descriptors[commandName], `missing descriptor for ${commandName}`);
    assert.match(
      descriptors[commandName].usage,
      /--rebalance-route public\|auto\|flashbots-private\|flashbots-bundle/,
      `${commandName} usage should advertise rebalanceRoute contract`,
    );
    assert.match(
      descriptors[commandName].usage,
      /--rebalance-route-fallback fail\|public/,
      `${commandName} usage should advertise rebalanceRouteFallback contract`,
    );
    assert.match(
      descriptors[commandName].usage,
      /--flashbots-relay-url <url>/,
      `${commandName} usage should advertise flashbotsRelayUrl`,
    );
    assert.match(
      descriptors[commandName].usage,
      /--flashbots-auth-key <key>/,
      `${commandName} usage should advertise flashbotsAuthKey`,
    );
    assert.match(
      descriptors[commandName].usage,
      /--flashbots-target-block-offset <n>/,
      `${commandName} usage should advertise flashbotsTargetBlockOffset`,
    );
    assert.match(
      descriptors[commandName].usage,
      /--hedge-scope pool\|total/,
      `${commandName} usage should advertise hedgeScope`,
    );
    assert.match(
      descriptors[commandName].usage,
      /--adopt-existing-positions/,
      `${commandName} usage should advertise adoptExistingPositions`,
    );
    assert.match(
      descriptors[commandName].usage,
      /--verbose/,
      `${commandName} usage should advertise verbose`,
    );
    assert.ok(descriptors[commandName].inputSchema.properties.verbose, `${commandName} schema should expose verbose`);
    assert.ok(
      descriptors[commandName].inputSchema.properties['hedge-scope'],
      `${commandName} schema should expose hedgeScope`,
    );
    assert.ok(
      descriptors[commandName].inputSchema.properties['adopt-existing-positions'],
      `${commandName} schema should expose adoptExistingPositions`,
    );
  }

  assert.ok(descriptors['mirror.sync.unlock']);
  assert.match(descriptors['mirror.sync.unlock'].usage, /--state-file <path>\|--strategy-hash <hash>/);
  assert.match(descriptors['mirror.sync.unlock'].usage, /--force/);
});

test('command descriptors surface validation, distribution, and stop-file caveats for agent workflows', () => {
  const descriptors = buildCommandDescriptors();

  assert.equal(
    descriptors['markets.create.run'].agentWorkflow.notes.some((note) => /exact final payload/i.test(String(note))),
    true,
  );
  assert.equal(
    descriptors['markets.create.run'].agentWorkflow.notes.some((note) => /balanced 50\/50 pool/i.test(String(note))),
    true,
  );

  assert.match(descriptors['mirror.deploy'].usage, /--distribution-yes-pct <pct>/);
  assert.match(descriptors['mirror.deploy'].usage, /--distribution-no-pct <pct>/);
  assert.ok(descriptors['mirror.deploy'].inputSchema.properties['distribution-yes-pct']);
  assert.ok(descriptors['mirror.deploy'].inputSchema.properties['distribution-no-pct']);
  assert.equal(
    descriptors['mirror.deploy'].agentWorkflow.notes.some((note) => /exact final deploy payload/i.test(String(note))),
    true,
  );
  assert.equal(
    descriptors['mirror.go'].agentWorkflow.notes.some((note) => /exact final deploy payload/i.test(String(note))),
    true,
  );

  for (const commandName of ['mirror.sync.once', 'mirror.sync.run', 'mirror.sync.start']) {
    assert.equal(
      descriptors[commandName].agentWorkflow.notes.some((note) => /\.pandora\/mirror\/STOP/.test(String(note))),
      true,
      `${commandName} should surface the default mirror stop file caveat`,
    );
  }

  assert.equal(
    descriptors['mirror.panic'].agentWorkflow.notes.some((note) => /\.pandora\/mirror\/STOP/.test(String(note))),
    true,
  );
});

test('mirror --help json includes batch-1 sync semantics notes', () => {
  const result = runCli(['--output', 'json', 'mirror', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.help');
  assert.equal(Array.isArray(payload.data.notes), true);
  assert.equal(payload.data.notes.some((note) => /paper\/simulated mode/i.test(note)), true);
  assert.equal(payload.data.notes.some((note) => /not atomic/i.test(note)), true);
  assert.equal(payload.data.notes.some((note) => /reserveSource/.test(note)), true);
  assert.equal(payload.data.notes.some((note) => /MIRROR_EXPIRY_TOO_CLOSE/.test(note)), true);
  assert.equal(payload.data.notes.some((note) => /strict-close-time-delta/.test(note)), true);
  assert.equal(payload.data.notes.some((note) => /cached snapshots/.test(note)), true);
  assert.equal(payload.data.notes.some((note) => /cached or stale/i.test(note)), true);
  assert.equal(payload.data.notes.some((note) => /--polymarket-rpc-url/.test(note)), true);
  assert.equal(payload.data.notes.some((note) => /verifyDiagnostics/.test(note)), true);
  assert.equal(payload.data.notes.some((note) => /logFile/.test(note)), true);
  assert.equal(payload.data.notes.some((note) => /\.pandora\/mirror\/STOP/.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /validation tickets are bound to the exact final deploy payload/i.test(String(note))), true);
});

test('mirror trace returns structured historical reserve snapshots for explicit block lists', async () => {
  const rpc = await startMirrorTraceRpcMock({
    snapshots: [
      {
        blockNumber: 111,
        timestamp: 1_700_000_000,
        reserveYesRaw: 4_000_000n,
        reserveNoRaw: 6_000_000n,
      },
      {
        blockNumber: 112,
        timestamp: 1_700_000_060,
        reserveYesRaw: 5_000_000n,
        reserveNoRaw: 5_000_000n,
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'trace',
      '--market-address',
      ADDRESSES.mirrorMarket,
      '--rpc-url',
      rpc.url,
      '--blocks',
      '111,112',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.trace');
    assert.equal(payload.data.selector.selectionMode, 'blocks');
    assert.deepEqual(payload.data.selector.blocks, [111, 112]);
    assert.equal(payload.data.selector.fromBlock, null);
    assert.equal(payload.data.selector.toBlock, null);
    assert.equal(payload.data.selector.step, null);
    assert.equal(Array.isArray(payload.data.snapshots), true);
    assert.equal(payload.data.snapshots.length, 2);
    assert.equal(payload.data.snapshots[0].blockNumber, 111);
    assert.equal(payload.data.snapshots[0].reserveYesUsdc, 4);
    assert.equal(payload.data.snapshots[0].reserveNoUsdc, 6);
    assert.equal(payload.data.snapshots[0].pandoraYesPct, 60);
    assert.equal(payload.data.snapshots[0].feeTier, 3000);
    assert.equal(payload.data.snapshots[0].rpcUrl, rpc.url);
    assert.equal(typeof payload.data.snapshots[0].blockHash, 'string');
    assert.equal(typeof payload.data.snapshots[0].blockTimestamp, 'string');
    assert.equal(payload.data.snapshots[1].blockNumber, 112);
    assert.equal(payload.data.snapshots[1].reserveYesUsdc, 5);
    assert.equal(payload.data.snapshots[1].reserveNoUsdc, 5);
    assert.equal(payload.data.snapshots[1].pandoraYesPct, 50);
  } finally {
    await rpc.close();
  }
});

test('mirror trace range sampling honors step and limit while preserving the requested selector', async () => {
  const rpc = await startMirrorTraceRpcMock({
    snapshots: [
      {
        blockNumber: 0,
        timestamp: 1_700_000_000,
        reserveYesRaw: 1_000_000n,
        reserveNoRaw: 2_000_000n,
      },
      {
        blockNumber: 1,
        timestamp: 1_700_000_060,
        reserveYesRaw: 2_000_000n,
        reserveNoRaw: 3_000_000n,
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'trace',
      '--market-address',
      ADDRESSES.mirrorMarket,
      '--rpc-url',
      rpc.url,
      '--from-block',
      '0',
      '--to-block',
      '5000',
      '--step',
      '1',
      '--limit',
      '2',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.selector.selectionMode, 'range');
    assert.equal(payload.data.selector.fromBlock, 0);
    assert.equal(payload.data.selector.toBlock, 5000);
    assert.equal(payload.data.selector.step, 1);
    assert.deepEqual(payload.data.selector.blocks, []);
    assert.equal(payload.data.snapshots.length, 2);
    assert.deepEqual(payload.data.snapshots.map((entry) => entry.blockNumber), [0, 1]);
  } finally {
    await rpc.close();
  }
});

test('mirror trace fails with an explicit archive-state error when historical reserves are unavailable', async () => {
  const rpc = await startMirrorTraceRpcMock({
    snapshots: [
      {
        blockNumber: 111,
        timestamp: 1_700_000_000,
        reserveYesRaw: 4_000_000n,
        reserveNoRaw: 6_000_000n,
      },
    ],
    archiveMissingBlocks: [111],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'trace',
      '--market-address',
      ADDRESSES.mirrorMarket,
      '--rpc-url',
      rpc.url,
      '--blocks',
      '111',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'MIRROR_ONCHAIN_ARCHIVE_STATE_UNAVAILABLE');
    assert.match(payload.error.message, /archive/i);
  } finally {
    await rpc.close();
  }
});

test('mirror trace preserves generic rpc failures instead of relabeling them as archive errors', async () => {
  const rpc = await startMirrorTraceRpcMock({
    snapshots: [
      {
        blockNumber: 111,
        timestamp: 1_700_000_000,
        reserveYesRaw: 4_000_000n,
        reserveNoRaw: 6_000_000n,
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'trace',
      '--market-address',
      ADDRESSES.mirrorMarket,
      '--rpc-url',
      rpc.url,
      '--blocks',
      '999',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'MIRROR_ONCHAIN_RESERVES_UNAVAILABLE');
    assert.notEqual(payload.error.code, 'MIRROR_ONCHAIN_ARCHIVE_STATE_UNAVAILABLE');
  } finally {
    await rpc.close();
  }
});

test('polymarket check returns deterministic JSON payload shape', async () => {
  const rpc = await startPolymarketOpsRpcMock({
    funder: POLYMARKET_DEFAULTS.funder,
    usdcBalanceRaw: 2_500_000n,
    safeOwner: true,
  });

  try {
    const result = await runCliAsync(
      [
        '--output',
        'json',
        'polymarket',
        'check',
        '--rpc-url',
        rpc.url,
        '--private-key',
        `0x${'1'.repeat(64)}`,
        '--funder',
        POLYMARKET_DEFAULTS.funder,
      ],
      {
        env: {
          POLYMARKET_SKIP_API_KEY_SANITY: '1',
        },
      },
    );

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'polymarket.check');
    assert.equal(payload.data.schemaVersion, '1.0.0');
    assert.equal(payload.data.chainId, 137);
    assert.equal(Array.isArray(payload.data.runtime.spenders), true);
    assert.equal(payload.data.runtime.spenders.length, 3);
    assert.equal(Array.isArray(payload.data.approvals.checks), true);
    assert.equal(payload.data.approvals.checks.length, 6);
    assert.equal(payload.data.apiKeySanity.status, 'skipped');
  } finally {
    await rpc.close();
  }
});

test('polymarket check falls back to later rpc candidates when the primary endpoint is down', async () => {
  const deadRpc = await startJsonHttpServer(({ bodyJson }) => ({
    status: 503,
    body: {
      jsonrpc: '2.0',
      id: bodyJson && bodyJson.id ? bodyJson.id : 1,
      error: { message: 'primary rpc unavailable' },
    },
  }));
  const liveRpc = await startPolymarketOpsRpcMock({
    funder: POLYMARKET_DEFAULTS.funder,
    usdcBalanceRaw: 2_500_000n,
    safeOwner: true,
    allowanceBySpender: {
      exchange: 1n << 200n,
      negRiskExchange: 1n << 200n,
      negRiskAdapter: 1n << 200n,
    },
    operatorBySpender: {
      exchange: true,
      negRiskExchange: true,
      negRiskAdapter: true,
    },
  });

  try {
    const result = await runCliAsync(
      [
        '--output',
        'json',
        'polymarket',
        'check',
        '--rpc-url',
        `${deadRpc.url},${liveRpc.url}`,
        '--private-key',
        `0x${'1'.repeat(64)}`,
        '--funder',
        POLYMARKET_DEFAULTS.funder,
      ],
      {
        env: {
          POLYMARKET_SKIP_API_KEY_SANITY: '1',
        },
      },
    );

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'polymarket.check');
    assert.equal(payload.data.runtime.rpcUrl, liveRpc.url);
    assert.equal(payload.data.rpcSelection.fallbackUsed, true);
    assert.deepEqual(
      payload.data.rpcSelection.attempts.map((entry) => [entry.rpcUrl, entry.ok]),
      [
        [deadRpc.url, false],
        [liveRpc.url, true],
      ],
    );
  } finally {
    await deadRpc.close();
    await liveRpc.close();
  }
});

test('polymarket balance --help stays funding-only and omits CTF inventory selectors', () => {
  const result = runCli(['--output', 'json', 'polymarket', 'balance', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'polymarket.balance.help');
  assert.match(payload.data.usage, /polymarket balance/);
  assert.doesNotMatch(payload.data.usage, /--source auto\|api\|on-chain/);
  assert.doesNotMatch(payload.data.usage, /--condition-id <id>\|--market-id <id>\|--slug <slug>\|--token-id <id>/);
  assert.equal(
    payload.data.notes.some((entry) => /does not query authenticated Polymarket CLOB buying power/i.test(entry)),
    true,
  );
  assert.equal(
    payload.data.notes.some((entry) => /merge-readiness/i.test(entry)),
    true,
  );
});

test('polymarket --help advertises positions alongside the funding-only balance surface', () => {
  const result = runCli(['--output', 'json', 'polymarket', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'polymarket.help');
  assert.match(payload.data.usage, /check\|approve\|preflight\|balance\|positions\|deposit\|withdraw\|trade/);
});

test('polymarket positions --help documents selector and source modes for CTF inventory reads', () => {
  const result = runCli(['--output', 'json', 'polymarket', 'positions', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'polymarket.positions.help');
  assert.match(payload.data.usage, /--wallet <address>\|--funder <address>/);
  assert.match(payload.data.usage, /--condition-id <id>\|--market-id <id>\|--slug <slug>\|--token-id <id>/);
  assert.match(payload.data.usage, /--source auto\|api\|on-chain/);
});

test('command descriptors expose polymarket positions while keeping polymarket balance funding-only', () => {
  const descriptors = buildCommandDescriptors();

  assert.ok(descriptors.polymarket);
  assert.match(descriptors.polymarket.usage, /check\|approve\|preflight\|balance\|positions\|deposit\|withdraw\|trade/);
  assert.match(descriptors['polymarket.balance'].summary, /funding balances/i);
  assert.doesNotMatch(descriptors['polymarket.balance'].summary, /inventory|open order|YES\/NO/i);
  assert.ok(descriptors['polymarket.positions']);
  assert.match(descriptors['polymarket.positions'].summary, /CTF|inventory|open orders/i);
  assert.match(descriptors['polymarket.positions'].usage, /polymarket positions \[--wallet <address>\|--funder <address>\]/);
  assert.match(descriptors['polymarket.positions'].usage, /--source auto\|api\|on-chain/);
  assert.match(descriptors['polymarket.positions'].usage, /--funder <address>/);
});

test('polymarket approve --dry-run returns deterministic JSON plan shape', async () => {
  const rpc = await startPolymarketOpsRpcMock({
    funder: POLYMARKET_DEFAULTS.funder,
    usdcBalanceRaw: 1_000_000n,
    safeOwner: true,
  });

  try {
    const result = await runCliAsync(
      [
        '--output',
        'json',
        'polymarket',
        'approve',
        '--dry-run',
        '--rpc-url',
        rpc.url,
        '--private-key',
        `0x${'1'.repeat(64)}`,
        '--funder',
        POLYMARKET_DEFAULTS.funder,
      ],
      {
        env: {
          POLYMARKET_SKIP_API_KEY_SANITY: '1',
        },
      },
    );

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'polymarket.approve');
    assert.equal(payload.data.mode, 'dry-run');
    assert.equal(payload.data.status, 'planned');
    assert.equal(Array.isArray(payload.data.txPlan), true);
    assert.equal(payload.data.txPlan.length, 6);
    assert.equal(payload.data.approvalSummary.missingCount, 6);
  } finally {
    await rpc.close();
  }
});

test('mirror sync --execute-live enforces required risk caps', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'sync',
    'once',
    '--skip-dotenv',
    '--pandora-market-address',
    ADDRESSES.mirrorMarket,
    '--polymarket-market-id',
    'poly-cond-1',
    '--execute-live',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.match(payload.error.message, /max-open-exposure-usdc/);
});

test('mirror sync start/status/stop manages daemon lifecycle in paper mode', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-daemon-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());
  let strategyHash = null;
  let daemonPid = null;

  try {
    const startResult = runCli(
      [
        '--output',
        'json',
        'mirror',
        'sync',
        'start',
        '--skip-dotenv',
        '--indexer-url',
        indexer.url,
        '--polymarket-mock-url',
        polymarket.url,
        '--pandora-market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
        '--paper',
        '--interval-ms',
        '1000',
        '--iterations',
        '30',
        '--drift-trigger-bps',
        '25',
        '--hedge-trigger-usdc',
        '1000000',
        '--state-file',
        stateFile,
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(startResult.status, 0);
    const startPayload = parseJsonOutput(startResult);
    assert.equal(startPayload.ok, true);
    assert.equal(startPayload.command, 'mirror.sync.start');
    assert.equal(startPayload.data.found, true);
    assert.equal(typeof startPayload.data.strategyHash, 'string');
    assert.equal(startPayload.data.strategyHash.length, 16);
    assert.equal(typeof startPayload.data.pid, 'number');
    assert.equal(fs.existsSync(startPayload.data.pidFile), true);
    assert.equal(fs.existsSync(startPayload.data.logFile), true);

    strategyHash = startPayload.data.strategyHash;
    daemonPid = startPayload.data.pid;

    const statusResult = runCli(
      [
        '--output',
        'json',
        'mirror',
        'sync',
        'status',
        '--strategy-hash',
        strategyHash,
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(statusResult.status, 0);
    const statusPayload = parseJsonOutput(statusResult);
    assert.equal(statusPayload.ok, true);
    assert.equal(statusPayload.command, 'mirror.sync.status');
    assert.equal(statusPayload.data.found, true);
    assert.equal(statusPayload.data.strategyHash, strategyHash);
    assert.equal(typeof statusPayload.data.pid, 'number');
    assert.equal(statusPayload.data.alive, true);
    assert.equal(statusPayload.data.status, 'running');
    assert.equal(typeof statusPayload.data.metadata.checkedAt, 'string');
    assert.equal(statusPayload.data.metadata.pidAlive, true);
    assert.equal(statusPayload.data.metadata.logFile, startPayload.data.logFile);
    assert.equal(statusPayload.data.runtime.health.status, 'running');
    assert.equal(statusPayload.data.runtime.errorCount, 0);
    assert.equal(statusPayload.data.runtime.summary.errorCount, 0);
    assert.equal(statusPayload.data.runtime.nextAction.code, 'MONITOR_NEXT_TICK');
    assert.equal(statusPayload.data.runtime.summary.nextAction.code, 'MONITOR_NEXT_TICK');
    assert.equal(statusPayload.data.runtime.lastTrade, null);

    const stopResult = runCli(
      [
        '--output',
        'json',
        'mirror',
        'sync',
        'stop',
        '--strategy-hash',
        strategyHash,
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(stopResult.status, 0);
    const stopPayload = parseJsonOutput(stopResult);
    assert.equal(stopPayload.ok, true);
    assert.equal(stopPayload.command, 'mirror.sync.stop');
    assert.equal(stopPayload.data.strategyHash, strategyHash);
    assert.equal(stopPayload.data.alive, false);
    assert.equal(stopPayload.data.status, 'stopped');
    assert.equal(stopPayload.data.signalSent, true);
    assert.equal(stopPayload.data.metadata.stopSignalSent, true);
    assert.equal(typeof stopPayload.data.metadata.stopAttemptedAt, 'string');

    const afterStopResult = runCli(
      [
        '--output',
        'json',
        'mirror',
        'sync',
        'status',
        '--strategy-hash',
        strategyHash,
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(afterStopResult.status, 0);
    const afterStopPayload = parseJsonOutput(afterStopResult);
    assert.equal(afterStopPayload.ok, true);
    assert.equal(afterStopPayload.data.found, true);
    assert.equal(afterStopPayload.data.alive, false);
    assert.equal(afterStopPayload.data.status, 'stopped');
    assert.equal(afterStopPayload.data.metadata.pidAlive, false);
  } finally {
    if (strategyHash) {
      runCli(['--output', 'json', 'mirror', 'sync', 'stop', '--strategy-hash', strategyHash], {
        env: { HOME: tempDir },
      });
    }
    if (daemonPid && Number.isInteger(daemonPid)) {
      try {
        process.kill(daemonPid, 'SIGKILL');
      } catch {
        // best-effort cleanup
      }
    }
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror sync start does not leak --private-key in daemon metadata', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-daemon-private-key-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());
  let strategyHash = null;
  let daemonPid = null;
  const privateKey = `0x${'1'.repeat(64)}`;
  const funder = '0x9999999999999999999999999999999999999999';

  try {
    const startResult = runCli(
      [
        '--output',
        'json',
        'mirror',
        'sync',
        'start',
        '--skip-dotenv',
        '--indexer-url',
        indexer.url,
        '--polymarket-mock-url',
        polymarket.url,
        '--pandora-market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
        '--paper',
        '--private-key',
        privateKey,
        '--funder',
        funder,
        '--interval-ms',
        '1000',
        '--iterations',
        '30',
        '--drift-trigger-bps',
        '25',
        '--hedge-trigger-usdc',
        '1000000',
        '--state-file',
        stateFile,
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(startResult.status, 0);
    const startPayload = parseJsonOutput(startResult);
    assert.equal(startPayload.ok, true);
    assert.equal(startPayload.command, 'mirror.sync.start');
    assert.equal(Array.isArray(startPayload.data.cliArgs), true);
    assert.equal(startPayload.data.cliArgs.includes('--private-key'), false);
    assert.equal(startPayload.data.launchCommand.includes('--private-key'), false);
    assert.equal(startPayload.data.launchCommand.includes(privateKey), false);

    strategyHash = startPayload.data.strategyHash;
    daemonPid = startPayload.data.pid;

    const stopResult = runCli(
      [
        '--output',
        'json',
        'mirror',
        'sync',
        'stop',
        '--strategy-hash',
        strategyHash,
      ],
      { env: { HOME: tempDir } },
    );
    assert.equal(stopResult.status, 0);
  } finally {
    if (strategyHash) {
      runCli(['--output', 'json', 'mirror', 'sync', 'stop', '--strategy-hash', strategyHash], {
        env: { HOME: tempDir },
      });
    }
    if (daemonPid && Number.isInteger(daemonPid)) {
      try {
        process.kill(daemonPid, 'SIGKILL');
      } catch {
        // best-effort cleanup
      }
    }
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror status can load state via strategy hash path', async () => {
  const tempDir = createTempDir('pandora-mirror-status-');
  const strategyHash = '0123456789abcdef';
  const stateDir = path.join(tempDir, '.pandora', 'mirror');
  const statePath = path.join(stateDir, `${strategyHash}.json`);
  const daemonDir = path.join(stateDir, 'daemon');
  const daemonPidFile = path.join(daemonDir, `${strategyHash}.json`);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        tradesToday: 2,
        dailySpendUsdc: 42,
      },
      null,
      2,
    ),
  );
  fs.mkdirSync(daemonDir, { recursive: true });
  fs.writeFileSync(
    daemonPidFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        pid: process.pid,
        pidAlive: true,
        status: 'running',
        checkedAt: '2026-03-09T00:00:00.000Z',
        startedAt: '2026-03-08T23:59:00.000Z',
        stateFile: statePath,
        logFile: path.join(tempDir, '.pandora', 'mirror', 'logs', `${strategyHash}.log`),
      },
      null,
      2,
    ),
  );

  const result = runCli(['--output', 'json', 'mirror', 'status', '--strategy-hash', strategyHash], {
    env: { HOME: tempDir },
  });

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.status');
  assert.equal(payload.data.strategyHash, strategyHash);
  assert.equal(payload.data.state.tradesToday, 2);
  assert.equal(payload.data.runtime.health.status, 'running');
  assert.equal(payload.data.runtime.daemon.found, true);
  assert.equal(payload.data.runtime.daemon.alive, true);
  assert.equal(payload.data.runtime.daemon.strategyHash, strategyHash);
  assert.equal(payload.data.runtime.daemon.pid, process.pid);

  removeDir(tempDir);
});

test('mirror status can infer the paired source selector from persisted state when given only --market-address', async () => {
  const tempDir = createTempDir('pandora-mirror-status-selector-hint-');
  const stateDir = path.join(tempDir, '.pandora', 'mirror');
  const statePath = path.join(stateDir, '0123456789abcdef.json');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer({
    ...buildMirrorPolymarketOverrides(),
    balances: {
      'poly-yes-1': '12.5',
      'poly-no-1': '3.25',
    },
  });

  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: '0123456789abcdef',
        pandoraMarketAddress: ADDRESSES.mirrorMarket,
        polymarketMarketId: 'poly-cond-1',
        polymarketSlug: 'poly-game-1',
        tradesToday: 3,
      },
      null,
      2,
    ),
  );

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'status',
      '--market-address',
      ADDRESSES.mirrorMarket,
      '--with-live',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
    ], {
      env: { HOME: tempDir },
    });

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.status');
    assert.equal(payload.data.stateFile, statePath);
    assert.equal(payload.data.selector.pandoraMarketAddress, ADDRESSES.mirrorMarket);
    assert.equal(payload.data.selector.polymarketMarketId, 'poly-cond-1');
    assert.equal(payload.data.selector.polymarketSlug, 'poly-game-1');
    assert.equal(payload.data.state.tradesToday, 3);
    assert.equal(payload.data.live.sourceMarket.marketId, 'poly-cond-1');
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror replay can infer persisted state from --market-address alone', () => {
  const tempDir = createTempDir('pandora-mirror-replay-selector-hint-');
  const stateDir = path.join(tempDir, '.pandora', 'mirror');
  const statePath = path.join(stateDir, 'feedfacecafebeef.json');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: 'feedfacecafebeef',
        pandoraMarketAddress: ADDRESSES.mirrorMarket,
        polymarketMarketId: 'poly-cond-1',
        polymarketSlug: 'poly-game-1',
        lastExecution: {
          mode: 'paper',
          status: 'executed',
          startedAt: '2026-03-09T09:58:00.000Z',
          completedAt: '2026-03-09T10:00:00.000Z',
          model: {
            plannedRebalanceUsdc: 12.5,
            plannedHedgeUsdc: 7.25,
            plannedSpendUsdc: 19.75,
            rebalanceSide: 'yes',
            hedgeTokenSide: 'no',
            hedgeOrderSide: 'buy',
          },
        },
      },
      null,
      2,
    ),
  );

  try {
    const result = runCli(['--output', 'json', 'mirror', 'replay', '--market-address', ADDRESSES.mirrorMarket], {
      env: { HOME: tempDir },
    });

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.replay');
    assert.equal(payload.data.stateFile, statePath);
    assert.equal(payload.data.selector.pandoraMarketAddress, ADDRESSES.mirrorMarket);
    assert.equal(payload.data.selector.polymarketMarketId, 'poly-cond-1');
    assert.equal(payload.data.selector.polymarketSlug, 'poly-game-1');
    assert.equal(payload.data.summary.actionCount, 1);
  } finally {
    removeDir(tempDir);
  }
});

test('mirror status surfaces unreadable pending-action locks as blocked runtime state', () => {
  const tempDir = createTempDir('pandora-mirror-status-lock-invalid-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const pendingLockFile = `${path.resolve(stateFile)}.pending-action.json`;
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: 'feedfacecafebeef',
        tradesToday: 1,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(pendingLockFile, '{not-valid-json');

  try {
    const result = runCli(['--output', 'json', 'mirror', 'status', '--state-file', stateFile], {
      env: { HOME: tempDir },
    });

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.status');
    assert.equal(payload.data.runtime.health.status, 'blocked');
    assert.equal(payload.data.runtime.health.code, 'PENDING_ACTION_LOCK_INVALID');
    assert.equal(payload.data.runtime.summary.nextAction.code, 'UNLOCK_PENDING_ACTION');
    assert.equal(payload.data.runtime.summary.nextAction.blocking, true);
    assert.match(payload.data.runtime.summary.nextAction.command, /mirror sync unlock --state-file/);
    assert.equal(payload.data.runtime.pendingAction.status, 'invalid');
    assert.equal(payload.data.runtime.pendingAction.requiresManualReview, true);
    assert.equal(payload.data.runtime.pendingActionRecovery.allowedWithoutForce, true);
  } finally {
    removeDir(tempDir);
  }
});

test('mirror status surfaces pending-action transaction nonce for manual reconciliation', () => {
  const tempDir = createTempDir('pandora-mirror-status-pending-nonce-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const pendingLockFile = `${path.resolve(stateFile)}.pending-action.json`;
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: 'feedfacecafebeef',
        tradesToday: 1,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    pendingLockFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        status: 'reconciliation-required',
        pid: process.pid,
        lockNonce: 'nonce-bucket-1',
        transactionNonce: 42,
        requiresManualReview: true,
        createdAt: '2026-03-09T10:00:00.000Z',
        updatedAt: '2026-03-09T10:01:00.000Z',
      },
      null,
      2,
    ),
  );

  try {
    const result = runCli(['--output', 'json', 'mirror', 'status', '--state-file', stateFile], {
      env: { HOME: tempDir },
    });

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.status');
    assert.equal(payload.data.runtime.health.status, 'blocked');
    assert.equal(payload.data.runtime.pendingAction.status, 'reconciliation-required');
    assert.equal(payload.data.runtime.pendingAction.transactionNonce, 42);
    assert.equal(payload.data.runtime.summary.nextAction.code, 'RECONCILE_PENDING_ACTION');
    assert.equal(payload.data.runtime.summary.nextAction.blocking, true);
  } finally {
    removeDir(tempDir);
  }
});

test('mirror sync unlock clears zombie pending-action locks by state-file', () => {
  const tempDir = createTempDir('pandora-mirror-sync-unlock-zombie-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const pendingLockFile = `${path.resolve(stateFile)}.pending-action.json`;
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: 'feedfacecafebeef',
        tradesToday: 1,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    pendingLockFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        status: 'pending',
        pid: 99999999,
        lockNonce: 'zombie-lock',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      null,
      2,
    ),
  );

  try {
    const result = runCli(['--output', 'json', 'mirror', 'sync', 'unlock', '--state-file', stateFile], {
      env: { HOME: tempDir },
    });

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.sync.unlock');
    assert.equal(payload.data.cleared, true);
    assert.equal(payload.data.lock.status, 'zombie');
    assert.equal(payload.data.assessment.code, 'PENDING_ACTION_UNLOCK_ALLOWED');
    assert.equal(fs.existsSync(pendingLockFile), false);
  } finally {
    removeDir(tempDir);
  }
});

test('mirror sync unlock requires force for reconciliation-required locks', () => {
  const tempDir = createTempDir('pandora-mirror-sync-unlock-force-');
  const strategyHash = 'feedfacecafebeef';
  const stateDir = path.join(tempDir, '.pandora', 'mirror');
  const stateFile = path.join(stateDir, `${strategyHash}.json`);
  const pendingLockFile = `${path.resolve(stateFile)}.pending-action.json`;
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        tradesToday: 1,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    pendingLockFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        status: 'reconciliation-required',
        pid: process.pid,
        lockNonce: 'nonce-bucket-1',
        transactionNonce: 42,
        requiresManualReview: true,
        createdAt: '2026-03-09T10:00:00.000Z',
        updatedAt: '2026-03-09T10:01:00.000Z',
      },
      null,
      2,
    ),
  );

  try {
    const blocked = runCli(['--output', 'json', 'mirror', 'sync', 'unlock', '--strategy-hash', strategyHash], {
      env: { HOME: tempDir },
    });
    assert.equal(blocked.status, 0);
    const blockedPayload = parseJsonOutput(blocked);
    assert.equal(blockedPayload.ok, true);
    assert.equal(blockedPayload.data.cleared, false);
    assert.equal(blockedPayload.data.reason, 'force-required');
    assert.equal(blockedPayload.data.assessment.forceRequired, true);
    assert.match(blockedPayload.data.assessment.recommendedCommand, /--force/);
    assert.equal(fs.existsSync(pendingLockFile), true);

    const forced = runCli(
      ['--output', 'json', 'mirror', 'sync', 'unlock', '--strategy-hash', strategyHash, '--force'],
      { env: { HOME: tempDir } },
    );
    assert.equal(forced.status, 0);
    const forcedPayload = parseJsonOutput(forced);
    assert.equal(forcedPayload.ok, true);
    assert.equal(forcedPayload.data.cleared, true);
    assert.equal(fs.existsSync(pendingLockFile), false);
  } finally {
    removeDir(tempDir);
  }
});

test('mirror status --help returns usage payload', () => {
  const result = runCli(['--output', 'json', 'mirror', 'status', '--help']);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.status.help');
  assert.match(payload.data.usage, /mirror status/);
  assert.equal(Array.isArray(payload.data.polymarketEnv), true);
  assert.equal(payload.data.polymarketEnv.includes('POLYMARKET_FUNDER'), true);
  assert.match(payload.data.notes.withLive, /Polymarket balances\/open orders/i);
  assert.match(payload.data.notes.withLive, /balance-scope/i);
  assert.match(payload.data.notes.withLive, /merge-readiness/i);
  assert.match(payload.data.notes.collateral, /scope mismatch/i);
  assert.match(payload.data.notes.collateral, /buying power/i);
  assert.match(payload.data.notes.gracefulFallback, /diagnostics are returned instead of hard failures/i);
});

test('mirror health returns machine-usable runtime status payload', () => {
  const tempDir = createTempDir('pandora-mirror-health-');
  const strategyHash = '0123456789abcdef';
  const stateDir = path.join(tempDir, '.pandora', 'mirror');
  const statePath = path.join(stateDir, `${strategyHash}.json`);
  const daemonDir = path.join(stateDir, 'daemon');
  const daemonPidFile = path.join(daemonDir, `${strategyHash}.json`);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        lastTickAt: new Date().toISOString(),
        tradesToday: 2,
        dailySpendUsdc: 42,
      },
      null,
      2,
    ),
  );
  fs.mkdirSync(daemonDir, { recursive: true });
  fs.writeFileSync(
    daemonPidFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        pid: process.pid,
        pidAlive: true,
        status: 'running',
        checkedAt: '2026-03-09T00:00:00.000Z',
        startedAt: '2026-03-08T23:59:00.000Z',
        stateFile: statePath,
        logFile: path.join(tempDir, '.pandora', 'mirror', 'logs', `${strategyHash}.log`),
      },
      null,
      2,
    ),
  );

  try {
    const result = runCli(['--output', 'json', 'mirror', 'health', '--strategy-hash', strategyHash], {
      env: { HOME: tempDir },
    });

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.health');
    assert.equal(payload.data.strategyHash, strategyHash);
    assert.equal(payload.data.healthy, true);
    assert.equal(payload.data.severity, 'ok');
    assert.equal(payload.data.summary.status, 'running');
    assert.equal(payload.data.summary.code, 'OK');
    assert.equal(payload.data.summary.daemonFound, true);
    assert.equal(payload.data.summary.daemonAlive, true);
    assert.equal(payload.data.runtime.daemon.strategyHash, strategyHash);
    assert.equal(payload.data.runtime.daemon.pid, process.pid);
    assert.equal(payload.data.followUpActions[0].code, 'MONITOR_NEXT_TICK');
  } finally {
    removeDir(tempDir);
  }
});

test('mirror health --help returns usage payload', () => {
  const result = runCli(['--output', 'json', 'mirror', 'health', '--help']);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.health.help');
  assert.match(payload.data.usage, /mirror health/);
  assert.equal(Array.isArray(payload.data.notes), true);
  assert.equal(
    payload.data.notes.some((line) => /machine-usable daemon\/runtime status surface/i.test(String(line))),
    true,
  );
});

test('mirror panic engages risk panic and writes the canonical mirror stop file', () => {
  const tempDir = createTempDir('pandora-mirror-panic-');
  const strategyHash = 'feedfacecafebeef';
  const stateDir = path.join(tempDir, '.pandora', 'mirror');
  const statePath = path.join(stateDir, `${strategyHash}.json`);
  const daemonDir = path.join(stateDir, 'daemon');
  const daemonPidFile = path.join(daemonDir, `${strategyHash}.json`);
  const defaultStopFile = path.join(stateDir, 'STOP');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        pandoraMarketAddress: ADDRESSES.mirrorMarket,
      },
      null,
      2,
    ),
  );
  fs.mkdirSync(daemonDir, { recursive: true });
  fs.writeFileSync(
    daemonPidFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        pid: 999999,
        pidAlive: false,
        status: 'running',
        checkedAt: '2026-03-09T00:00:00.000Z',
        startedAt: '2026-03-08T23:59:00.000Z',
        stateFile: statePath,
        killSwitchFile: path.join(tempDir, 'custom-stop-file'),
        pandoraMarketAddress: ADDRESSES.mirrorMarket,
      },
      null,
      2,
    ),
  );

  try {
    const engageResult = runCli(
      ['--output', 'json', 'mirror', 'panic', '--all', '--reason', 'incident response'],
      { env: { HOME: tempDir } },
    );

    assert.equal(engageResult.status, 0);
    const engagePayload = parseJsonOutput(engageResult);
    assert.equal(engagePayload.ok, true);
    assert.equal(engagePayload.command, 'mirror.panic');
    assert.equal(engagePayload.data.action, 'engage');
    assert.equal(engagePayload.data.status, 'engaged');
    assert.equal(engagePayload.data.risk.panic.active, true);
    assert.equal(engagePayload.data.selector.all, true);
    assert.equal(engagePayload.data.daemonStop.mode, 'all');
    assert.equal(engagePayload.data.daemonStop.count, 1);
    assert.equal(Array.isArray(engagePayload.data.stopFiles.written), true);
    assert.equal(engagePayload.data.stopFiles.written.includes(defaultStopFile), true);
    assert.equal(fs.existsSync(defaultStopFile), true);
    assert.equal(engagePayload.data.followUpActions.some((item) => item.code === 'CLEAR_PANIC_WHEN_SAFE'), true);

    const clearResult = runCli(
      ['--output', 'json', 'mirror', 'panic', '--clear', '--all'],
      { env: { HOME: tempDir } },
    );

    assert.equal(clearResult.status, 0);
    const clearPayload = parseJsonOutput(clearResult);
    assert.equal(clearPayload.ok, true);
    assert.equal(clearPayload.command, 'mirror.panic');
    assert.equal(clearPayload.data.action, 'clear');
    assert.equal(clearPayload.data.status, 'cleared');
    assert.equal(clearPayload.data.risk.panic.active, false);
    assert.equal(clearPayload.data.stopFiles.cleared.includes(defaultStopFile), true);
    assert.equal(fs.existsSync(defaultStopFile), false);
  } finally {
    removeDir(tempDir);
  }
});

test('mirror panic --help returns usage payload', () => {
  const result = runCli(['--output', 'json', 'mirror', 'panic', '--help']);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.panic.help');
  assert.match(payload.data.usage, /mirror panic/);
  assert.equal(Array.isArray(payload.data.notes), true);
  assert.equal(
    payload.data.notes.some((line) => /mirror-focused emergency shell/i.test(String(line))),
    true,
  );
  assert.equal(payload.data.notes.some((line) => /\.pandora\/mirror\/STOP/.test(String(line))), true);
});

test('mirror drift --help returns usage payload', () => {
  const result = runCli(['--output', 'json', 'mirror', 'drift', '--help']);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.drift.help');
  assert.match(payload.data.usage, /mirror drift/);
  assert.equal(Array.isArray(payload.data.notes), true);
  assert.equal(
    payload.data.notes.some((line) => /dedicated live drift\/readiness surface/i.test(String(line))),
    true,
  );
});

test('mirror hedge-check --help returns usage payload', () => {
  const result = runCli(['--output', 'json', 'mirror', 'hedge-check', '--help']);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.hedge-check.help');
  assert.match(payload.data.usage, /mirror hedge-check/);
  assert.equal(Array.isArray(payload.data.notes), true);
  assert.equal(
    payload.data.notes.some((line) => /current hedge target, gap, trigger state/i.test(String(line))),
    true,
  );
});

test('--version returns package version in json mode', () => {
  const result = runCli(['--output', 'json', '--version']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'version');
  assert.match(payload.data.version, /^\d+\.\d+\.\d+/);
});

test('conflicting --output values fail with INVALID_ARGS in json envelope', () => {
  const result = runCli(['--output', 'json', '--output', 'table', 'help']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_ARGS');
  assert.match(payload.error.message, /Conflicting --output values/);
});

test('mirror browse validates invalid date strings', () => {
  const result = runCli(['--output', 'json', 'mirror', 'browse', '--closes-after', 'not-a-date']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /--closes-after must be an ISO date\/time string/);
});

test('mirror browse rejects numeric-only date strings', () => {
  const result = runCli(['--output', 'json', 'mirror', 'browse', '--closes-after', '-1000']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /not a bare number/);
});

test('mirror browse rejects invalid calendar rollover dates', () => {
  const result = runCli(['--output', 'json', 'mirror', 'browse', '--closes-after', '2026-02-31']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /real calendar date/);
});

test('mirror browse rejects invalid tag id values', () => {
  const result = runCli(['--output', 'json', 'mirror', 'browse', '--polymarket-tag-id', '0']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /--polymarket-tag-id must be a positive integer/i);
});

test('mirror browse rejects empty tag-id csv values', () => {
  const result = runCli(['--output', 'json', 'mirror', 'browse', '--polymarket-tag-ids', ', ,']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /must include at least one positive integer tag id/i);
});

test('boolean flags with --key=false do not silently flip behavior', () => {
  const result = runCli(['--output', 'json', 'scan', '--active=false']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'UNKNOWN_FLAG');
  assert.match(payload.error.message, /--active=false/);
});

test('subcommand flags support --key=value syntax', () => {
  const tempDir = createTempDir('pandora-equals-flags-');
  const strategyHash = '0123456789abcdef';
  const stateDir = path.join(tempDir, '.pandora', 'mirror');
  const statePath = path.join(stateDir, `${strategyHash}.json`);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        tradesToday: 1,
      },
      null,
      2,
    ),
  );

  const result = runCli(['--output=json', 'mirror', 'status', `--strategy-hash=${strategyHash}`], {
    env: { HOME: tempDir },
  });

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.status');
  assert.equal(payload.data.strategyHash, strategyHash);
  removeDir(tempDir);
});

test('mirror close accepts --market-address alias', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'close',
    '--market-address',
    ADDRESSES.mirrorMarket,
    '--polymarket-market-id',
    'poly-cond-1',
    '--dry-run',
  ]);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.close');
  assert.equal(payload.data.pandoraMarketAddress, ADDRESSES.mirrorMarket.toLowerCase());
});

test('mirror browse returns candidate markets with existing mirror hint', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'browse',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--limit',
      '5',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.browse');
    assert.equal(Array.isArray(payload.data.items), true);
    assert.equal(payload.data.filters.minYesPct, null);
    assert.equal(payload.data.filters.maxYesPct, null);
    assert.equal(payload.data.filters.limit, 5);
    if (payload.data.items.length > 0) {
      assert.equal(Object.prototype.hasOwnProperty.call(payload.data.items[0], 'existingMirror'), true);
      if (payload.data.items[0].existingMirror) {
        assert.equal(typeof payload.data.items[0].existingMirror.marketAddress, 'string');
        assert.equal(typeof payload.data.items[0].existingMirror.similarity, 'number');
      }
    }
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror browse supports sports tag filters via gamma events endpoint', async () => {
  const gamma = await startJsonHttpServer((request) => {
    const parsed = new URL(request.url || '/', 'http://127.0.0.1');
    if (parsed.pathname !== '/events') {
      return { status: 404, body: { error: 'not found' } };
    }

    const tagId = parsed.searchParams.get('tag_id');
    if (tagId !== '82') {
      return { body: { events: [] } };
    }

    return {
      body: {
        events: [
          {
            id: 'evt-epl-1',
            slug: 'everton-v-burnley',
            title: 'Everton vs Burnley',
            markets: [
              {
                condition_id: 'poly-epl-c1',
                market_slug: 'everton-v-burnley-home',
                question: 'Will Everton beat Burnley?',
                end_date_iso: FIXED_MIRROR_CLOSE_ISO,
                active: true,
                closed: false,
                volume24hr: 550000,
                tokens: [
                  { outcome: 'Yes', price: '0.605', token_id: 'poly-epl-yes-1' },
                  { outcome: 'No', price: '0.395', token_id: 'poly-epl-no-1' },
                ],
              },
            ],
          },
        ],
      },
    };
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'browse',
      '--skip-dotenv',
      '--polymarket-gamma-url',
      gamma.url,
      '--polymarket-tag-id',
      '82',
      '--limit',
      '5',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.browse');
    assert.equal(payload.data.source, 'polymarket:gamma-events');
    assert.deepEqual(payload.data.filters.polymarketTagIds, [82]);
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].eventSlug, 'everton-v-burnley');
    assert.equal(payload.data.items[0].eventTitle, 'Everton vs Burnley');
    assert.equal(payload.data.items[0].eventId, 'evt-epl-1');

    const eventRequest = gamma.requests.find((entry) => String(entry.url || '').startsWith('/events?'));
    assert.ok(eventRequest);
    const parsed = new URL(eventRequest.url, 'http://127.0.0.1');
    assert.equal(parsed.searchParams.get('tag_id'), '82');
    assert.equal(parsed.searchParams.get('active'), 'true');
    assert.equal(parsed.searchParams.get('closed'), 'false');
  } finally {
    await gamma.close();
  }
});

test('mirror browse supports non-sports short-window filtering in one call', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const nowMs = Date.now();
  const toIso = (offsetHours) => new Date(nowMs + offsetHours * 60 * 60 * 1000).toISOString();
  const gamma = await startJsonHttpServer((request) => {
    const parsed = new URL(request.url || '/', 'http://127.0.0.1');
    if (parsed.pathname !== '/markets') {
      return { status: 404, body: { error: 'not found' } };
    }
    return {
      body: {
        markets: [
          {
            condition_id: 's1',
            market_slug: 'everton-v-burnley-home',
            question: 'Will Everton beat Burnley?',
            end_date_iso: toIso(24),
            active: true,
            closed: false,
            volume24hr: 9000,
            liquidity: 9000,
            tags: [{ id: 82, slug: 'soccer' }],
            tokens: [
              { outcome: 'Yes', price: '0.61', token_id: 's1-yes' },
              { outcome: 'No', price: '0.39', token_id: 's1-no' },
            ],
          },
          {
            condition_id: 'c1',
            market_slug: 'bitcoin-etf-approval-2026',
            question: 'Will bitcoin ETF approval happen in 2026?',
            end_date_iso: toIso(36),
            active: true,
            closed: false,
            volume24hr: 8000,
            liquidity: 1000,
            tags: [{ slug: 'crypto' }],
            tokens: [
              { outcome: 'Yes', price: '0.45', token_id: 'c1-yes' },
              { outcome: 'No', price: '0.55', token_id: 'c1-no' },
            ],
          },
          {
            condition_id: 'c2',
            market_slug: 'bitcoin-price-120k-2026',
            question: 'Will bitcoin trade above 120k in 2026?',
            end_date_iso: toIso(18),
            active: true,
            closed: false,
            volume24hr: 2000,
            liquidity: 7000,
            tags: [{ slug: 'crypto' }],
            tokens: [
              { outcome: 'Yes', price: '0.55', token_id: 'c2-yes' },
              { outcome: 'No', price: '0.45', token_id: 'c2-no' },
            ],
          },
          {
            condition_id: 'x1',
            market_slug: 'bitcoin-over-300k',
            question: 'Will bitcoin exceed 300k?',
            end_date_iso: toIso(12),
            active: true,
            closed: false,
            volume24hr: 10000,
            liquidity: 1000,
            tags: [{ slug: 'crypto' }],
            tokens: [
              { outcome: 'Yes', price: '0.95', token_id: 'x1-yes' },
              { outcome: 'No', price: '0.05', token_id: 'x1-no' },
            ],
          },
        ],
      },
    };
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'browse',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-gamma-url',
      gamma.url,
      '--exclude-sports',
      '--end-date-before',
      '72h',
      '--min-yes-pct',
      '15',
      '--max-yes-pct',
      '85',
      '--sort-by',
      'volume24h',
      '--keyword',
      'bitcoin',
      '--limit',
      '10',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.browse');
    assert.equal(payload.data.filters.excludeSports, true);
    assert.equal(payload.data.filters.sortBy, 'volume24h');
    assert.equal(payload.data.count, 2);
    assert.equal(payload.data.items[0].slug, 'bitcoin-etf-approval-2026');
    assert.equal(payload.data.items[1].slug, 'bitcoin-price-120k-2026');
    assert.ok(Array.isArray(payload.data.items[0].categories));
    assert.ok(payload.data.items[0].categories.includes('crypto'));
  } finally {
    await indexer.close();
    await gamma.close();
  }
});

test('mirror sync accepts --market-address with --dry-run mode alias', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-aliases-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'sync',
      'once',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--dry-run',
      '--drift-trigger-bps',
      '25',
      '--hedge-trigger-usdc',
      '1000000',
      '--state-file',
      stateFile,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.sync');
    assert.equal(payload.data.mode, 'once');
    assert.equal(payload.data.executeLive, false);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror plan resolves slug selectors via gamma mock endpoint', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'plan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-slug',
      'deterministic-tests-pass',
      '--polymarket-gamma-mock-url',
      polymarket.url,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.plan');
    assert.equal(payload.data.sourceMarket.sourceType, 'polymarket:gamma');
    assert.equal(payload.data.sourceMarket.slug, 'deterministic-tests-pass');
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror verify --trust-deploy bypasses similarity for trusted manifest pairs', async () => {
  const tempDir = createTempDir('pandora-mirror-trust-');
  const manifestFile = path.join(tempDir, '.pandora', 'mirror', 'pairs.json');
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  fs.writeFileSync(
    manifestFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        pairs: [
          {
            id: 'pair-1',
            trusted: true,
            pandoraMarketAddress: ADDRESSES.mirrorMarket,
            polymarketMarketId: 'poly-cond-1',
            polymarketSlug: 'deterministic-tests-pass',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
      null,
      2,
    ),
  );

  const indexer = await startIndexerMockServer(
    buildMirrorIndexerOverrides({
      polls: [
        {
          ...buildMirrorIndexerOverrides().polls[0],
          question: 'Completely different wording for Pandora side',
        },
      ],
    }),
  );
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync(
      [
        '--output',
        'json',
        'mirror',
        'verify',
        '--skip-dotenv',
        '--indexer-url',
        indexer.url,
        '--polymarket-mock-url',
        polymarket.url,
        '--pandora-market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
        '--trust-deploy',
        '--manifest-file',
        manifestFile,
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.verify');
    assert.equal(payload.data.gateResult.ok, true);
    const matchCheck = payload.data.gateResult.checks.find((item) => item.code === 'MATCH_CONFIDENCE');
    assert.equal(Boolean(matchCheck && matchCheck.ok), true);
    assert.equal(Boolean(matchCheck && matchCheck.meta && matchCheck.meta.trustDeploy), true);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror sync --trust-deploy fails fast when trusted pair is missing', () => {
  const tempDir = createTempDir('pandora-mirror-trust-missing-');
  try {
    const result = runCli(
      [
        '--output',
        'json',
        'mirror',
        'sync',
        'once',
        '--skip-dotenv',
        '--pandora-market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
        '--paper',
        '--trust-deploy',
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.error.code, 'TRUST_DEPLOY_PAIR_NOT_FOUND');
  } finally {
    removeDir(tempDir);
  }
});

test('mirror status --with-live includes polymarket position visibility diagnostics', async () => {
  const tempDir = createTempDir('pandora-mirror-status-live-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: 'feedfacecafebeef',
        pandoraMarketAddress: ADDRESSES.mirrorMarket,
        polymarketMarketId: 'poly-cond-1',
        currentHedgeUsdc: 5,
        cumulativeLpFeesApproxUsdc: 2.5,
        cumulativeHedgeCostApproxUsdc: 1.25,
      },
      null,
      2,
    ),
  );

  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer({
    ...buildMirrorPolymarketOverrides(),
    balances: {
      'poly-yes-1': '12.5',
      'poly-no-1': '3.25',
    },
    openOrders: [
      {
        id: 'order-1',
        market: 'poly-cond-1',
        asset_id: 'poly-yes-1',
        original_size: '10',
        size_matched: '4',
        price: '0.74',
      },
      {
        id: 'order-2',
        market: 'poly-cond-1',
        asset_id: 'poly-no-1',
        remaining_size: '2',
        price: '0.26',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'status',
      '--state-file',
      stateFile,
      '--with-live',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.status');
    assert.equal(typeof payload.data.live.driftBps, 'number');
    assert.equal(typeof payload.data.live.netPnlApproxUsdc, 'number');
    assert.equal(payload.data.live.netPnlApproxUsdc, 1.25);
    assert.equal(typeof payload.data.live.netDeltaApprox, 'number');
    assert.equal(typeof payload.data.live.pnlApprox, 'number');
    assert.equal(payload.data.live.polymarketPosition.yesBalance, 12.5);
    assert.equal(payload.data.live.polymarketPosition.noBalance, 3.25);
    assert.equal(payload.data.live.polymarketPosition.balanceScope.surface, 'polygon-usdc-wallet-collateral-only');
    assert.equal(payload.data.live.polymarketPosition.balanceScope.asset, 'USDC.e');
    assert.equal(payload.data.live.polymarketPosition.balanceScope.chainId, 137);
    assert.equal(payload.data.live.polymarketPosition.balanceScope.uiBalanceParityExpected, false);
    assert.equal(payload.data.live.polymarketPosition.openOrdersCount, 2);
    assert.equal(payload.data.live.polymarketPosition.openOrdersNotionalUsd, 4.96);
    assert.equal(payload.data.live.polymarketPosition.estimatedValueUsd, 10.095);
    assert.equal(payload.data.live.polymarketPosition.mergeReadiness.status, 'ready');
    assert.equal(payload.data.live.polymarketPosition.mergeReadiness.eligible, true);
    assert.equal(payload.data.live.polymarketPosition.mergeReadiness.mergeablePairs, 3.25);
    assert.equal(payload.data.live.crossVenue.status, 'attention');
    assert.equal(payload.data.live.crossVenue.gateOk, true);
    assert.equal(payload.data.live.crossVenue.sourceType, 'polymarket:mock');
    assert.equal(payload.data.live.hedgeStatus.hedgeSide, 'no');
    assert.equal(payload.data.live.hedgeStatus.hedgeGapAbsUsdc, 5);
    assert.equal(payload.data.live.hedgeStatus.triggered, false);
    assert.equal(payload.data.live.actionability.status, 'action-needed');
    assert.equal(payload.data.live.actionability.recommendedAction, 'rebalance-yes');
    assert.equal(Array.isArray(payload.data.live.actionableDiagnostics), true);
    assert.equal(payload.data.live.actionableDiagnostics.some((item) => item.code === 'DRIFT_TRIGGERED'), true);
    assert.equal(payload.data.live.actionableDiagnostics.some((item) => item.code === 'HEDGE_GAP_TRIGGERED'), false);
    assert.equal(Array.isArray(payload.data.live.pnlScenarios.feeVolumeScenarios), true);
    assert.equal(payload.data.live.pnlScenarios.feeVolumeScenarios.length > 0, true);
    assert.equal(payload.data.live.pnlScenarios.resolutionScenarios.yes.hedgeInventoryPayoutUsd, 12.5);
    assert.equal(payload.data.live.pnlScenarios.resolutionScenarios.no.hedgeInventoryPayoutUsd, 3.25);
    assert.equal(Array.isArray(payload.data.live.polymarketPosition.diagnostics), true);
    assert.equal(
      payload.data.live.polymarketPosition.diagnostics.some((entry) => /merge-eligible/i.test(String(entry))),
      true,
    );
    assert.equal(Array.isArray(payload.data.live.verifyDiagnostics), true);
    assert.equal(payload.data.live.sourceMarket.marketId, 'poly-cond-1');
    assert.equal(payload.data.live.pandoraMarket.marketAddress, ADDRESSES.mirrorMarket);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror pnl returns the dedicated cross-venue scenario surface', async () => {
  const tempDir = createTempDir('pandora-mirror-pnl-live-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: 'feedfacecafebeef',
        pandoraMarketAddress: ADDRESSES.mirrorMarket,
        polymarketMarketId: 'poly-cond-1',
        currentHedgeUsdc: 5,
        cumulativeLpFeesApproxUsdc: 2.5,
        cumulativeHedgeCostApproxUsdc: 1.25,
      },
      null,
      2,
    ),
  );

  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer({
    ...buildMirrorPolymarketOverrides(),
    balances: {
      'poly-yes-1': '12.5',
      'poly-no-1': '3.25',
    },
    openOrders: [
      {
        id: 'order-1',
        market: 'poly-cond-1',
        asset_id: 'poly-yes-1',
        original_size: '10',
        size_matched: '4',
        price: '0.74',
      },
      {
        id: 'order-2',
        market: 'poly-cond-1',
        asset_id: 'poly-no-1',
        remaining_size: '2',
        price: '0.26',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'pnl',
      '--state-file',
      stateFile,
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.pnl');
    assert.equal(payload.data.summary.netPnlApproxUsdc, 1.25);
    assert.equal(payload.data.summary.pnlApprox, 11.345);
    assert.equal(payload.data.summary.netDeltaApprox, 9.25);
    assert.equal(payload.data.summary.hedgeGapUsdc, -5);
    assert.equal(payload.data.summary.currentHedgeUsdc, 5);
    assert.equal(payload.data.summary.runtimeHealth, 'idle');
    assert.equal(payload.data.crossVenue.status, 'attention');
    assert.equal(payload.data.actionability.recommendedAction, 'rebalance-yes');
    assert.equal(payload.data.polymarketPosition.openOrdersCount, 2);
    assert.equal(payload.data.scenarios.resolutionScenarios.yes.hedgeInventoryPayoutUsd, 12.5);
    assert.equal(
      payload.data.diagnostics.some((line) => String(line).includes('DRIFT_TRIGGERED')),
      true,
    );
    assert.equal(
      payload.data.diagnostics.includes('Loaded Polymarket position summary from mock payload.'),
      true,
    );
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror pnl --reconciled attaches ledger-grade summary rows when accounting inputs exist', async () => {
  const tempDir = createTempDir('pandora-mirror-pnl-reconciled-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const auditFile = `${path.resolve(stateFile)}.audit.jsonl`;
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: 'feedfacecafebeef',
        pandoraMarketAddress: ADDRESSES.mirrorMarket,
        polymarketMarketId: 'poly-cond-1',
        currentHedgeUsdc: 5,
        cumulativeLpFeesApproxUsdc: 2.5,
        cumulativeHedgeCostApproxUsdc: 1.25,
        accounting: {
          provenance: {
            status: 'complete',
          },
          components: {
            lpFeeIncomeUsdc: 2.5,
            hedgeCostUsdc: 1.25,
            markToMarketInventoryUsd: 10.095,
          },
          rows: [
            {
              component: 'funding',
              venue: 'bridge',
              chain: 'polygon',
              timestamp: '2026-03-09T09:59:00.000Z',
              cashFlowUsdc: 15,
              txHash: '0xfunding',
              source: 'state.accounting.rows',
            },
            {
              component: 'gas-cost',
              venue: 'pandora',
              chain: 'ethereum',
              timestamp: '2026-03-09T10:00:30.000Z',
              gasUsdc: 0.25,
              realizedPnlUsdc: -0.25,
              txHash: '0xgas123',
              source: 'state.accounting.rows',
            },
          ],
          traceSnapshots: [
            {
              blockNumber: 111,
              blockTimestamp: '2026-03-09T09:55:00.000Z',
              reserveYesUsdc: 4,
              reserveNoUsdc: 6,
              impermanentLossUsdc: 0.75,
            },
            {
              blockNumber: 112,
              blockTimestamp: '2026-03-09T10:05:00.000Z',
              reserveYesUsdc: 5,
              reserveNoUsdc: 5,
              impermanentLossUsdc: 0.75,
            },
          ],
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    auditFile,
    [
      JSON.stringify({
        classification: 'sync-action',
        venue: 'mirror',
        source: 'mirror-sync.execution',
        timestamp: '2026-03-09T10:00:00.000Z',
        status: 'ok',
        details: {
          idempotencyKey: 'bucket-3',
        },
      }),
      JSON.stringify({
        classification: 'pandora-rebalance',
        venue: 'pandora',
        source: 'mirror-sync.execution.rebalance',
        timestamp: '2026-03-09T10:00:01.000Z',
        status: 'ok',
        details: {
          side: 'yes',
          amountUsdc: 12.5,
          transactionRef: '0xrebalance',
        },
      }),
      JSON.stringify({
        classification: 'polymarket-hedge',
        venue: 'polymarket',
        source: 'mirror-sync.execution.hedge',
        timestamp: '2026-03-09T10:00:02.000Z',
        status: 'ok',
        details: {
          tokenSide: 'no',
          orderSide: 'buy',
          amountUsdc: 7.25,
          transactionRef: '0xhedge',
        },
      }),
    ].join('\n'),
  );

  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer({
    ...buildMirrorPolymarketOverrides(),
    balances: {
      'poly-yes-1': '12.5',
      'poly-no-1': '3.25',
    },
    openOrders: [
      {
        id: 'order-1',
        market: 'poly-cond-1',
        asset_id: 'poly-yes-1',
        original_size: '10',
        size_matched: '4',
        price: '0.74',
      },
      {
        id: 'order-2',
        market: 'poly-cond-1',
        asset_id: 'poly-no-1',
        remaining_size: '2',
        price: '0.26',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'pnl',
      '--state-file',
      stateFile,
      '--reconciled',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.pnl');
    assert.equal(payload.data.summary.accountingMode, 'complete');
    assert.equal(payload.data.summary.realizedPnlUsdc, 1);
    assert.equal(payload.data.summary.unrealizedPnlUsdc, 9.345);
    assert.equal(payload.data.summary.netPnlUsdc, 10.345);
    assert.equal(payload.data.reconciled.status, 'complete');
    assert.deepEqual(payload.data.reconciled.provenance.missing, []);
    assert.equal(payload.data.reconciled.summary.transactionHashCount, 4);
    assert.equal(payload.data.reconciled.ledger.rows.some((row) => row.component === 'funding' && row.txHash === '0xfunding'), true);
    assert.equal(payload.data.reconciled.ledger.exportRows.some((row) => row.component === 'inventory-mark'), true);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror drift returns the dedicated drift surface', async () => {
  const tempDir = createTempDir('pandora-mirror-drift-live-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: 'feedfacecafebeef',
        pandoraMarketAddress: ADDRESSES.mirrorMarket,
        polymarketMarketId: 'poly-cond-1',
        currentHedgeUsdc: 5,
        cumulativeLpFeesApproxUsdc: 2.5,
        cumulativeHedgeCostApproxUsdc: 1.25,
      },
      null,
      2,
    ),
  );

  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer({
    ...buildMirrorPolymarketOverrides(),
    balances: {
      'poly-yes-1': '12.5',
      'poly-no-1': '3.25',
    },
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'drift',
      '--skip-dotenv',
      '--state-file',
      stateFile,
      '--drift-trigger-bps',
      '25',
      '--hedge-trigger-usdc',
      '10',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
    ], {
      env: { HOME: tempDir },
    });

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.drift');
    assert.equal(payload.data.stateFile, stateFile);
    assert.equal(payload.data.summary.triggerBps, 25);
    assert.equal(typeof payload.data.summary.driftBps, 'number');
    assert.equal(payload.data.summary.triggered, true);
    assert.equal(payload.data.summary.crossVenueStatus, 'attention');
    assert.equal(payload.data.summary.runtimeHealth, 'idle');
    assert.equal(payload.data.crossVenue.sourceType, 'polymarket:mock');
    assert.equal(payload.data.actionability.recommendedAction, 'rebalance-yes');
    assert.equal(payload.data.drift.sourceType, 'polymarket:mock');
    assert.equal(payload.data.sourceMarket.marketId, 'poly-cond-1');
    assert.equal(payload.data.pandoraMarket.marketAddress, ADDRESSES.mirrorMarket);
    assert.equal(
      payload.data.diagnostics.some((line) => String(line).includes('DRIFT_TRIGGERED')),
      true,
    );
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror hedge-check returns the dedicated hedge surface and readable table output', async () => {
  const tempDir = createTempDir('pandora-mirror-hedge-check-live-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: 'feedfacecafebeef',
        pandoraMarketAddress: ADDRESSES.mirrorMarket,
        polymarketMarketId: 'poly-cond-1',
        currentHedgeUsdc: 5,
        cumulativeLpFeesApproxUsdc: 2.5,
        cumulativeHedgeCostApproxUsdc: 1.25,
      },
      null,
      2,
    ),
  );

  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer({
    ...buildMirrorPolymarketOverrides(),
    balances: {
      'poly-yes-1': '12.5',
      'poly-no-1': '3.25',
    },
    openOrders: [
      {
        id: 'order-1',
        market: 'poly-cond-1',
        asset_id: 'poly-yes-1',
        original_size: '10',
        size_matched: '4',
        price: '0.74',
      },
      {
        id: 'order-2',
        market: 'poly-cond-1',
        asset_id: 'poly-no-1',
        remaining_size: '2',
        price: '0.26',
      },
    ],
  });

  try {
    const jsonResult = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'hedge-check',
      '--skip-dotenv',
      '--state-file',
      stateFile,
      '--hedge-trigger-usdc',
      '10',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
    ], {
      env: { HOME: tempDir },
    });

    assert.equal(jsonResult.status, 0);
    const payload = parseJsonOutput(jsonResult);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.hedge-check');
    assert.equal(typeof payload.data.summary.targetHedgeUsdc, 'number');
    assert.equal(payload.data.summary.currentHedgeUsdc, 5);
    assert.equal(payload.data.summary.hedgeGapUsdc, -5);
    assert.equal(payload.data.summary.hedgeGapAbsUsdc, 5);
    assert.equal(payload.data.summary.triggerUsdc, 10);
    assert.equal(payload.data.summary.triggered, false);
    assert.equal(payload.data.summary.hedgeSide, 'no');
    assert.equal(payload.data.summary.crossVenueStatus, 'attention');
    assert.equal(payload.data.hedge.hedgeGapAbsUsdc, 5);
    assert.equal(payload.data.polymarketPosition.openOrdersCount, 2);
    assert.equal(payload.data.actionability.recommendedAction, 'rebalance-yes');
    assert.equal(
      payload.data.diagnostics.includes('Loaded Polymarket position summary from mock payload.'),
      true,
    );

    const tableResult = await runCliAsync([
      'mirror',
      'hedge-check',
      '--skip-dotenv',
      '--state-file',
      stateFile,
      '--hedge-trigger-usdc',
      '10',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
    ], {
      env: { HOME: tempDir },
    });

    assert.equal(tableResult.status, 0);
    assert.match(String(tableResult.stdout || tableResult.output || ''), /Mirror Hedge Check/);
    assert.match(String(tableResult.stdout || tableResult.output || ''), /hedgeGapShares: -5/);
    assert.match(String(tableResult.stdout || tableResult.output || ''), /hedgeSide: no/);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror dashboard summarizes active mirrors without forcing operators into ad hoc scripts', async () => {
  const tempDir = createTempDir('pandora-mirror-dashboard-live-');
  const stateDir = path.join(tempDir, '.pandora', 'mirror');
  const stateFile = path.join(stateDir, 'feedfacecafebeef.json');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: 'feedfacecafebeef',
        pandoraMarketAddress: ADDRESSES.mirrorMarket,
        polymarketMarketId: 'poly-cond-1',
        currentHedgeUsdc: 5,
        cumulativeLpFeesApproxUsdc: 2.5,
        cumulativeHedgeCostApproxUsdc: 1.25,
        alerts: [
          {
            level: 'warn',
            code: 'SOURCE_STALE',
            message: 'Source feed lagged once.',
            count: 1,
            timestamp: '2026-03-09T00:04:00.000Z',
          },
        ],
      },
      null,
      2,
    ),
  );

  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer({
    ...buildMirrorPolymarketOverrides(),
    balances: {
      'poly-yes-1': '12.5',
      'poly-no-1': '3.25',
    },
    openOrders: [
      {
        id: 'order-1',
        market: 'poly-cond-1',
        asset_id: 'poly-yes-1',
        original_size: '10',
        size_matched: '4',
        price: '0.74',
      },
      {
        id: 'order-2',
        market: 'poly-cond-1',
        asset_id: 'poly-no-1',
        remaining_size: '2',
        price: '0.26',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'dashboard',
      '--with-live',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
    ], {
      env: { HOME: tempDir },
    });

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.dashboard');
    assert.equal(payload.data.summary.marketCount, 1);
    assert.equal(payload.data.summary.liveCount, 1);
    assert.equal(payload.data.summary.actionNeededCount, 1);
    assert.equal(payload.data.summary.alertCount, 1);
    assert.equal(payload.data.summary.totalNetPnlApproxUsdc, 1.25);
    assert.equal(payload.data.items.length, 1);
    assert.equal(payload.data.items[0].question, 'Will deterministic tests pass?');
    assert.equal(payload.data.items[0].actionability.recommendedAction, 'rebalance-yes');
    assert.equal(payload.data.items[0].runtime.health.status, 'idle');
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('dashboard degrades per-market live failures while preserving actionable summaries', async () => {
  const tempDir = createTempDir('pandora-dashboard-live-');
  const stateDir = path.join(tempDir, '.pandora', 'mirror');
  const alphaStateFile = path.join(stateDir, 'alpha.json');
  const betaStateFile = path.join(stateDir, 'beta.json');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    alphaStateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: 'alpha-hash',
        pandoraMarketAddress: ADDRESSES.mirrorMarket,
        polymarketMarketId: 'poly-cond-1',
        currentHedgeUsdc: 5,
        cumulativeLpFeesApproxUsdc: 2.5,
        cumulativeHedgeCostApproxUsdc: 1.25,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    betaStateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: 'beta-hash',
        pandoraMarketAddress: '0x9999999999999999999999999999999999999999',
        polymarketMarketId: 'poly-missing',
        lastExecution: {
          mode: 'live',
          status: 'failed',
          requiresManualReview: true,
          startedAt: '2026-03-09T00:04:30.000Z',
          completedAt: '2026-03-09T00:05:00.000Z',
        },
      },
      null,
      2,
    ),
  );

  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer({
    ...buildMirrorPolymarketOverrides(),
    balances: {
      'poly-yes-1': '12.5',
      'poly-no-1': '3.25',
    },
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'dashboard',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
    ], {
      env: { HOME: tempDir },
    });

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'dashboard');
    assert.equal(payload.data.summary.marketCount, 2);
    assert.equal(payload.data.summary.liveCount, 1);
    assert.equal(payload.data.summary.actionNeededCount, 1);
    assert.equal(payload.data.summary.manualReviewCount, 1);
    assert.equal(payload.data.items.length, 2);
    assert.equal(
      payload.data.suggestedNextCommands.includes('pandora mirror status --strategy-hash alpha-hash --with-live'),
      true,
    );

    const alphaItem = payload.data.items.find((item) => item.strategyHash === 'alpha-hash');
    const betaItem = payload.data.items.find((item) => item.strategyHash === 'beta-hash');

    assert.equal(alphaItem.liveAvailable, true);
    assert.equal(alphaItem.actionability.recommendedAction, 'rebalance-yes');
    assert.equal(betaItem.liveAvailable, false);
    assert.equal(betaItem.alertSummary.requiresManualReview, true);
    assert.equal(Array.isArray(betaItem.diagnostics), true);
    assert.ok(betaItem.diagnostics.length > 0);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('fund-check surfaces venue shortfalls and next commands in one operator payload', async () => {
  const rpc = await startPolymarketOpsRpcMock({
    funder: POLYMARKET_DEFAULTS.funder,
    usdc: ADDRESSES.usdc,
    usdcBalanceRaw: 2_000_000n,
    safeOwner: true,
  });
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync(
      [
        '--output',
        'json',
        'fund-check',
        '--market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
        '--target-pct',
        '60',
        '--indexer-url',
        indexer.url,
        '--polymarket-mock-url',
        polymarket.url,
        '--rpc-url',
        rpc.url,
        '--private-key',
        `0x${'1'.repeat(64)}`,
        '--funder',
        POLYMARKET_DEFAULTS.funder,
      ],
      {
        env: {
          USDC_ADDRESS: ADDRESSES.usdc,
          POLYMARKET_API_KEY: 'test-key',
          POLYMARKET_API_SECRET: 'test-secret',
          POLYMARKET_API_PASSPHRASE: 'test-passphrase',
        },
      },
    );

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'fund-check');
    assert.equal(payload.data.selector.pandoraMarketAddress, ADDRESSES.mirrorMarket);
    assert.equal(payload.data.selector.polymarketMarketId, 'poly-cond-1');
    assert.equal(payload.data.targetPct, 60);
    assert.equal(payload.data.actionability.recommendedAction, 'rebalance-yes');
    assert.equal(payload.data.pandora.requiredSide, 'yes');
    assert.ok(payload.data.pandora.shortfallUsdc > 0);
    assert.ok(payload.data.polymarket.shortfallUsdc > 0);
    assert.equal(payload.data.polymarket.readyForLive, false);
    assert.deepEqual(
      payload.data.suggestions.map((entry) => entry.action),
      [
        'fund-pandora-wallet',
        'fund-polymarket-proxy',
        'approve-polymarket-spenders',
        'inspect-polymarket-readiness',
      ],
    );
    assert.equal(
      payload.data.suggestions.some((entry) => String(entry.command || '').includes('pandora polymarket deposit')),
      true,
    );
  } finally {
    await rpc.close();
    await indexer.close();
    await polymarket.close();
  }
});

test('fund-check stays quiet when balances and approvals are already healthy', async () => {
  const pandoraRpc = await startPolymarketOpsRpcMock({
    chainIdHex: '0x1',
    funder: POLYMARKET_DEFAULTS.funder,
    usdc: ADDRESSES.usdc,
    usdcBalanceRaw: 500_000_000n,
    safeOwner: true,
  });
  const polymarketRpc = await startPolymarketOpsRpcMock({
    chainIdHex: '0x89',
    funder: POLYMARKET_DEFAULTS.funder,
    usdcBalanceRaw: 500_000_000n,
    safeOwner: true,
    allowanceBySpender: {
      exchange: 1n << 200n,
      negRiskExchange: 1n << 200n,
      negRiskAdapter: 1n << 200n,
    },
    operatorBySpender: {
      exchange: true,
      negRiskExchange: true,
      negRiskAdapter: true,
    },
  });
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync(
      [
        '--output',
        'json',
        'fund-check',
        '--market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
        '--target-pct',
        '60',
        '--indexer-url',
        indexer.url,
        '--polymarket-mock-url',
        polymarket.url,
        '--rpc-url',
        pandoraRpc.url,
        '--polymarket-rpc-url',
        polymarketRpc.url,
        '--private-key',
        `0x${'1'.repeat(64)}`,
        '--funder',
        POLYMARKET_DEFAULTS.funder,
      ],
      {
        env: {
          USDC_ADDRESS: ADDRESSES.usdc,
          POLYMARKET_API_KEY: 'test-key',
          POLYMARKET_API_SECRET: 'test-secret',
          POLYMARKET_API_PASSPHRASE: 'test-passphrase',
        },
      },
    );

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'fund-check');
    assert.equal(payload.data.pandora.shortfallUsdc, 0);
    assert.equal(payload.data.polymarket.shortfallUsdc, 0);
    assert.equal(payload.data.polymarket.readyForLive, true);
    assert.equal(payload.data.polymarket.check.approvals.missingCount, 0);
    assert.equal(payload.data.suggestions.length, 0);
  } finally {
    await pandoraRpc.close();
    await polymarketRpc.close();
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror status resolves selector-first without a persisted state file', async () => {
  const tempDir = createTempDir('pandora-mirror-status-selector-live-');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer({
    ...buildMirrorPolymarketOverrides(),
    balances: {
      'poly-yes-1': '12.5',
      'poly-no-1': '3.25',
    },
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'status',
      '--market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--with-live',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
    ], {
      env: { HOME: tempDir },
    });

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.status');
    assert.equal(payload.data.stateFile, null);
    assert.equal(payload.data.selector.pandoraMarketAddress, ADDRESSES.mirrorMarket);
    assert.equal(payload.data.selector.polymarketMarketId, 'poly-cond-1');
    assert.equal(payload.data.live.crossVenue.status, 'attention');
    assert.equal(payload.data.live.sourceMarket.marketId, 'poly-cond-1');
    assert.equal(payload.data.runtime.health.status, 'idle');
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror pnl resolves selector-first without a persisted state file', async () => {
  const tempDir = createTempDir('pandora-mirror-pnl-selector-live-');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer({
    ...buildMirrorPolymarketOverrides(),
    balances: {
      'poly-yes-1': '12.5',
      'poly-no-1': '3.25',
    },
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'pnl',
      '--market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
    ], {
      env: { HOME: tempDir },
    });

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.pnl');
    assert.equal(payload.data.stateFile, null);
    assert.equal(payload.data.selector.pandoraMarketAddress, ADDRESSES.mirrorMarket);
    assert.equal(payload.data.selector.polymarketMarketId, 'poly-cond-1');
    assert.equal(payload.data.crossVenue.status, 'attention');
    assert.equal(payload.data.scenarios.resolutionScenarios.yes.hedgeInventoryPayoutUsd, 12.5);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror audit --with-live classifies persisted execution state without double-counting failures', async () => {
  const tempDir = createTempDir('pandora-mirror-audit-live-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: 'feedfacecafebeef',
        pandoraMarketAddress: ADDRESSES.mirrorMarket,
        polymarketMarketId: 'poly-cond-1',
        currentHedgeUsdc: 5,
        cumulativeLpFeesApproxUsdc: 2.5,
        cumulativeHedgeCostApproxUsdc: 1.25,
        lastExecution: {
          mode: 'live',
          status: 'failed',
          idempotencyKey: 'bucket-1',
          startedAt: '2026-03-09T09:58:00.000Z',
          completedAt: '2026-03-09T10:00:00.000Z',
          requiresManualReview: true,
          rebalance: {
            side: 'yes',
            amountUsdc: 12.5,
            result: {
              ok: true,
              txHash: '0xrebalance',
            },
          },
          hedge: {
            tokenSide: 'no',
            side: 'buy',
            amountUsdc: 7.25,
            stateDeltaUsdc: -7.25,
            executionMode: 'buy',
            result: {
              ok: false,
              error: {
                code: 'POLY_FAIL',
                message: 'hedge failed',
              },
            },
          },
          error: {
            code: 'HEDGE_EXECUTION_FAILED',
            message: 'hedge failed',
          },
        },
        alerts: [
          {
            level: 'error',
            code: 'LAST_ACTION_REQUIRES_REVIEW',
            message: 'manual review required',
            timestamp: '2026-03-09T10:02:00.000Z',
          },
        ],
      },
      null,
      2,
    ),
  );

  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer({
    ...buildMirrorPolymarketOverrides(),
    balances: {
      'poly-yes-1': '12.5',
      'poly-no-1': '3.25',
    },
    openOrders: [
      {
        id: 'order-1',
        market: 'poly-cond-1',
        asset_id: 'poly-yes-1',
        original_size: '10',
        size_matched: '4',
        price: '0.74',
      },
      {
        id: 'order-2',
        market: 'poly-cond-1',
        asset_id: 'poly-no-1',
        remaining_size: '2',
        price: '0.26',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'audit',
      '--state-file',
      stateFile,
      '--with-live',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.audit');
    assert.equal(payload.data.summary.entryCount, 4);
    assert.equal(payload.data.summary.legCount, 2);
    assert.equal(payload.data.summary.alertCount, 1);
    assert.equal(payload.data.summary.errorCount, 1);
    assert.equal(payload.data.summary.runtimeHealth, 'blocked');
    assert.equal(payload.data.summary.liveCrossVenueStatus, 'attention');
    assert.equal(payload.data.runtime.summary.nextAction.code, 'RECONCILE_PENDING_ACTION');
    assert.equal(payload.data.liveContext.actionability.status, 'action-needed');
    assert.equal(payload.data.liveContext.polymarketPosition.openOrdersCount, 2);
    assert.equal(payload.data.ledger.entries[0].classification, 'runtime-alert');
    assert.equal(
      payload.data.ledger.entries.some(
        (entry) => entry.classification === 'pandora-rebalance' && entry.status === 'ok',
      ),
      true,
    );
    assert.equal(
      payload.data.ledger.entries.some(
        (entry) => entry.classification === 'polymarket-hedge' && entry.status === 'failed',
      ),
      true,
    );
    assert.equal(payload.data.diagnostics.includes('hedge failed'), true);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror audit --reconciled emits normalized ledger rows with complete provenance when accounting inputs exist', async () => {
  const tempDir = createTempDir('pandora-mirror-audit-reconciled-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const auditFile = `${path.resolve(stateFile)}.audit.jsonl`;
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: 'feedfacecafebeef',
        pandoraMarketAddress: ADDRESSES.mirrorMarket,
        polymarketMarketId: 'poly-cond-1',
        currentHedgeUsdc: 5,
        cumulativeLpFeesApproxUsdc: 2.5,
        cumulativeHedgeCostApproxUsdc: 1.25,
        accounting: {
          provenance: {
            status: 'complete',
          },
          components: {
            lpFeeIncomeUsdc: 2.5,
            hedgeCostUsdc: 1.25,
            markToMarketInventoryUsd: 10.095,
          },
          rows: [
            {
              component: 'funding',
              venue: 'bridge',
              chain: 'polygon',
              timestamp: '2026-03-09T09:59:00.000Z',
              cashFlowUsdc: 15,
              txHash: '0xfunding',
              source: 'state.accounting.rows',
            },
            {
              component: 'gas-cost',
              venue: 'pandora',
              chain: 'ethereum',
              timestamp: '2026-03-09T10:00:30.000Z',
              gasUsdc: 0.25,
              realizedPnlUsdc: -0.25,
              txHash: '0xgas123',
              source: 'state.accounting.rows',
            },
          ],
          traceSnapshots: [
            {
              blockNumber: 111,
              blockTimestamp: '2026-03-09T09:55:00.000Z',
              reserveYesUsdc: 4,
              reserveNoUsdc: 6,
              impermanentLossUsdc: 0.75,
            },
          ],
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    auditFile,
    [
      JSON.stringify({
        classification: 'sync-action',
        venue: 'mirror',
        source: 'mirror-sync.execution',
        timestamp: '2026-03-09T10:00:00.000Z',
        status: 'ok',
        details: {
          idempotencyKey: 'bucket-3',
        },
      }),
      JSON.stringify({
        classification: 'pandora-rebalance',
        venue: 'pandora',
        source: 'mirror-sync.execution.rebalance',
        timestamp: '2026-03-09T10:00:01.000Z',
        status: 'ok',
        details: {
          side: 'yes',
          amountUsdc: 12.5,
          transactionRef: '0xrebalance',
        },
      }),
      JSON.stringify({
        classification: 'polymarket-hedge',
        venue: 'polymarket',
        source: 'mirror-sync.execution.hedge',
        timestamp: '2026-03-09T10:00:02.000Z',
        status: 'ok',
        details: {
          tokenSide: 'no',
          orderSide: 'buy',
          amountUsdc: 7.25,
          transactionRef: '0xhedge',
        },
      }),
    ].join('\n'),
  );

  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer({
    ...buildMirrorPolymarketOverrides(),
    balances: {
      'poly-yes-1': '12.5',
      'poly-no-1': '3.25',
    },
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'audit',
      '--state-file',
      stateFile,
      '--reconciled',
      '--with-live',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.audit');
    assert.equal(payload.data.summary.accountingMode, 'complete');
    assert.equal(payload.data.summary.reconciledRowCount, 8);
    assert.equal(payload.data.summary.realizedPnlUsdc, 1);
    assert.equal(payload.data.summary.unrealizedPnlUsdc, 9.345);
    assert.equal(payload.data.summary.netPnlUsdc, 10.345);
    assert.equal(payload.data.reconciled.status, 'complete');
    assert.deepEqual(payload.data.reconciled.provenance.missing, []);
    assert.equal(payload.data.reconciled.ledger.rows.some((row) => row.component === 'pandora-rebalance' && row.txHash === '0xrebalance'), true);
    assert.equal(payload.data.reconciled.ledger.rows.some((row) => row.component === 'polymarket-hedge' && row.txHash === '0xhedge'), true);
    assert.equal(payload.data.reconciled.ledger.rows.some((row) => row.component === 'impermanent-loss'), true);
    assert.equal(payload.data.reconciled.ledger.exportRows.some((row) => row.component === 'funding'), true);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror audit prefers append-only audit log entries over lastExecution reconstruction', () => {
  const tempDir = createTempDir('pandora-mirror-audit-log-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const auditFile = `${path.resolve(stateFile)}.audit.jsonl`;
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: 'feedfacecafebeef',
        pandoraMarketAddress: ADDRESSES.mirrorMarket,
        polymarketMarketId: 'poly-cond-1',
        lastExecution: {
          status: 'failed',
          startedAt: '2026-03-09T09:58:00.000Z',
          completedAt: '2026-03-09T10:00:00.000Z',
          error: {
            code: 'SHOULD_NOT_APPEAR',
            message: 'state fallback should be ignored when audit log exists',
          },
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    auditFile,
    [
      JSON.stringify({
        classification: 'sync-action',
        venue: 'mirror',
        source: 'mirror.pending-action-log',
        timestamp: '2026-03-09T10:01:00.000Z',
        status: 'ok',
        code: null,
        message: 'sync completed',
        details: { transactionNonce: 41 },
      }),
      JSON.stringify({
        classification: 'polymarket-hedge',
        venue: 'polymarket',
        source: 'mirror.pending-action-log',
        timestamp: '2026-03-09T10:01:01.000Z',
        status: 'ok',
        code: null,
        message: 'hedge posted',
        details: { transactionNonce: 42, transactionRef: '0xhedge' },
      }),
    ].join('\n'),
  );

  try {
    const result = runCli(['--output', 'json', 'mirror', 'audit', '--state-file', stateFile], {
      env: { HOME: tempDir },
    });

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.audit');
    assert.equal(payload.data.ledger.source, 'mirror-audit-log');
    assert.equal(payload.data.ledger.entries.length, 2);
    assert.equal(payload.data.ledger.entries.every((entry) => entry.source === 'mirror.pending-action-log'), true);
    assert.equal(
      payload.data.ledger.entries.some((entry) => entry.code === 'SHOULD_NOT_APPEAR' || entry.message === 'state fallback should be ignored when audit log exists'),
      false,
    );
    assert.equal(payload.data.summary.entryCount, 2);
  } finally {
    removeDir(tempDir);
  }
});

test('mirror close dry-run returns deterministic close plan scaffold', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'close',
    '--pandora-market-address',
    ADDRESSES.mirrorMarket,
    '--polymarket-market-id',
    'poly-cond-1',
    '--dry-run',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.close');
  assert.equal(payload.data.mode, 'dry-run');
  assert.equal(payload.data.status, 'planned');
  assert.equal(Array.isArray(payload.data.steps), true);
  assert.deepEqual(
    payload.data.steps.map((step) => step.step),
    ['stop-daemons', 'withdraw-lp', 'claim-winnings', 'settle-polymarket'],
  );
  assert.deepEqual(
    payload.data.steps.map((step) => step.status),
    ['planned', 'planned', 'planned', 'planned'],
  );
  assert.equal(payload.data.polymarketSettlement.status, 'discovery-unavailable');
  assert.match(
    payload.data.polymarketSettlement.resumeCommand,
    /pandora polymarket positions --wallet <wallet-address> --market-id poly-cond-1/,
  );
});

test('webhook test sends generic and discord payloads', async () => {
  const generic = await startJsonHttpServer(() => ({ body: { ok: true } }));
  const discord = await startJsonHttpServer(() => ({ body: { ok: true } }));

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'webhook',
      'test',
      '--webhook-url',
      generic.url,
      '--discord-webhook-url',
      discord.url,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'webhook.test');
    assert.equal(payload.data.count, 2);
    assert.equal(payload.data.failureCount, 0);
    assert.equal(generic.requests.length, 1);
    assert.equal(discord.requests.length, 1);
  } finally {
    await generic.close();
    await discord.close();
  }
});

test('webhook test --help returns structured JSON help payload', () => {
  const result = runCli(['--output', 'json', 'webhook', 'test', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.command, 'webhook.test.help');
  assert.match(payload.data.usage, /^pandora .* webhook test /);
  assert.equal(payload.data.schemaVersion, '1.0.0');
  assertIsoTimestamp(payload.data.generatedAt);
});

test('leaderboard ranks by requested metric', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'leaderboard',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--metric',
      'volume',
      '--limit',
      '2',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'leaderboard');
    assert.equal(payload.data.items.length, 2);
    assert.equal(payload.data.items[0].address.toLowerCase(), ADDRESSES.wallet2.toLowerCase());
  } finally {
    await indexer.close();
  }
});

test('leaderboard clamps inconsistent indexer totals and surfaces diagnostics', async () => {
  const indexer = await startIndexerMockServer({
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
        id: 'user-invalid',
        address: '0x6666666666666666666666666666666666666666',
        chainId: 1,
        realizedPnL: '10',
        totalVolume: '100',
        totalTrades: '5',
        totalWins: '19',
        totalLosses: '0',
        totalWinnings: '50',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'leaderboard',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--metric',
      'win-rate',
      '--limit',
      '5',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'leaderboard');
    assert.equal(payload.data.schemaVersion, '1.0.0');

    const item = payload.data.items.find(
      (entry) => entry.address.toLowerCase() === '0x6666666666666666666666666666666666666666',
    );
    assert.equal(Boolean(item), true);
    assert.equal(item.totalTrades, 5);
    assert.equal(item.totalWins, 5);
    assert.equal(item.winRate, 1);
    assert.equal(item.sourceTotals.totalWins, 19);
    assert.equal(Array.isArray(item.diagnostics), true);
    assert.equal(item.diagnostics.length >= 1, true);
    assert.equal(payload.data.diagnostics.length >= 1, true);
  } finally {
    await indexer.close();
  }
});

test('leaderboard payload diagnostics only include returned rows', async () => {
  const indexer = await startIndexerMockServer({
    users: [
      {
        id: 'user-top-clean',
        address: ADDRESSES.wallet1,
        chainId: 1,
        realizedPnL: '10',
        totalVolume: '5000',
        totalTrades: '10',
        totalWins: '5',
        totalLosses: '5',
        totalWinnings: '200',
      },
      {
        id: 'user-lower-anomaly',
        address: '0x7777777777777777777777777777777777777777',
        chainId: 1,
        realizedPnL: '5',
        totalVolume: '100',
        totalTrades: '5',
        totalWins: '12',
        totalLosses: '0',
        totalWinnings: '50',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'leaderboard',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--metric',
      'volume',
      '--limit',
      '1',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'leaderboard');
    assert.equal(payload.data.items.length, 1);
    assert.equal(payload.data.items[0].address.toLowerCase(), ADDRESSES.wallet1.toLowerCase());
    assert.deepEqual(payload.data.diagnostics, []);
  } finally {
    await indexer.close();
  }
});

test('analyze fails gracefully when provider is missing', async () => {
  const indexer = await startAnalyzeIndexerMockServer();
  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'analyze',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-address',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.error.code, 'ANALYZE_PROVIDER_NOT_CONFIGURED');
  } finally {
    await indexer.close();
  }
});

test('analyze supports mock provider output', async () => {
  const indexer = await startAnalyzeIndexerMockServer();
  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'analyze',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-address',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--provider',
      'mock',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'analyze');
    assert.equal(payload.data.provider, 'mock');
    assert.equal(typeof payload.data.result.fairYesPct, 'number');
  } finally {
    await indexer.close();
  }
});

test('suggest returns deterministic envelope', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'suggest',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--risk',
      'medium',
      '--budget',
      '50',
      '--include-venues',
      'pandora',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'suggest');
    assert.equal(payload.data.wallet, ADDRESSES.wallet1.toLowerCase());
    assert.equal(payload.data.risk, 'medium');
    assert.equal(Array.isArray(payload.data.items), true);
  } finally {
    await indexer.close();
  }
});

test('resolve and lp commands are enabled', () => {
  const resolveResult = runCli([
    '--output',
    'json',
    'resolve',
    '--poll-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--answer',
    'yes',
    '--reason',
    'fixture',
    '--dry-run',
  ]);
  assert.equal(resolveResult.status, 0);
  const resolvePayload = parseJsonOutput(resolveResult);
  assert.equal(resolvePayload.ok, true);
  assert.equal(resolvePayload.command, 'resolve');
  assert.equal(resolvePayload.data.mode, 'dry-run');
  assert.equal(resolvePayload.data.txPlan.functionName, 'resolveMarket');

  const lpResult = runCli([
    '--output',
    'json',
    'lp',
    'positions',
    '--wallet',
    ADDRESSES.wallet1,
  ]);
  assert.equal(lpResult.status, 0);
  const lpPayload = parseJsonOutput(lpResult);
  assert.equal(lpPayload.ok, true);
  assert.equal(lpPayload.command, 'lp');
  assert.equal(lpPayload.data.action, 'positions');
  assert.equal(lpPayload.data.wallet, ADDRESSES.wallet1.toLowerCase());
});

test('resolve accepts --dotenv-path and returns env-file errors instead of unknown-flag', () => {
  const missingFile = path.join(os.tmpdir(), `pandora-missing-env-${Date.now()}.env`);
  const result = runCli([
    '--output',
    'json',
    'resolve',
    '--dotenv-path',
    missingFile,
    '--poll-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--answer',
    'yes',
    '--reason',
    'fixture',
    '--dry-run',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'ENV_FILE_NOT_FOUND');
});

test('launch enforces mode flag and dry-run reaches deterministic preflight', () => {
  const args = buildLaunchArgs();

  const missingMode = runCli(args, {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });
  assert.equal(missingMode.status, 1);
  assert.match(missingMode.output, /You must pass either --dry-run or --execute/);

  const dryRunPreflight = runCli([...args, '--dry-run'], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
    env: {
      CHAIN_ID: '999',
      PRIVATE_KEY: `0x${'1'.repeat(64)}`,
    },
  });
  assert.equal(dryRunPreflight.status, 1);
  assert.match(dryRunPreflight.output, /Unsupported CHAIN_ID=999\. Supported: 1 or 146/);
});

test('clone-bet enforces mode flag and dry-run reaches deterministic preflight', () => {
  const args = buildCloneArgs();

  const missingMode = runCli(args, {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });
  assert.equal(missingMode.status, 1);
  assert.match(missingMode.output, /Use either --dry-run or --execute/);

  const dryRunPreflight = runCli([...args, '--dry-run'], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
    env: {
      CHAIN_ID: '999',
      PRIVATE_KEY: `0x${'1'.repeat(64)}`,
    },
  });
  assert.equal(dryRunPreflight.status, 1);
  assert.match(dryRunPreflight.output, /Unsupported CHAIN_ID, use 1 or 146/);
});

test('clone-bet --help prints usage without stack traces', () => {
  const result = runCli(['clone-bet', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.output, /Usage:/);
  assert.match(result.output, /pandora clone-bet --dry-run\|--execute/);
  assert.match(result.output, /--market-type parimutuel/);
  assert.doesNotMatch(result.output, /--market-type amm\|parimutuel/);
  assert.match(result.output, /pari-mutuel market and places an initial bet/i);
  assert.match(result.output, /Politics=0/);
  assert.doesNotMatch(result.output, /Missing value for --help|at parseArgs/);
});

test('launch --help prints usage without requiring env file', () => {
  const result = runCli(['launch', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.output, /Usage:/);
  assert.match(result.output, /pandora launch --dry-run\|--execute/);
  assert.match(result.output, /Legacy generic market launcher/i);
  assert.match(result.output, /--curve-flattener <1-11>/);
  assert.match(result.output, /--curve-offset <raw>/);
  assert.match(result.output, /Use --market-type parimutuel with --curve-flattener\/--curve-offset/i);
  assert.match(result.output, /Other=10/);
  assert.doesNotMatch(result.output, /Env file not found/);
});

test('clone-bet rejects amm market-type before env-dependent validation', () => {
  const result = runCli([
    'clone-bet',
    '--skip-dotenv',
    '--market-type',
    'amm',
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
    '--dry-run',
  ], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });

  assert.equal(result.status, 1);
  assert.match(result.output, /clone-bet currently supports only pari-mutuel markets/i);
  assert.match(result.output, /Use pandora launch for generic AMM\/parimutuel market creation/i);
  assert.doesNotMatch(result.output, /at normalizeCloneBetMarketType|Error:/);
});

test('launch rejects invalid market-type before env-dependent validation', () => {
  const result = runCli([
    'launch',
    '--skip-dotenv',
    '--market-type',
    'binary',
    '--question',
    'Will this launch integration test pass?',
    '--rules',
    buildRules(),
    '--sources',
    'https://example.com/a',
    'https://example.com/b',
    '--target-timestamp',
    FIXED_FUTURE_TIMESTAMP,
    '--liquidity',
    '10',
    '--dry-run',
  ], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });

  assert.equal(result.status, 1);
  assert.match(result.output, /Invalid --market-type value "binary"\. Use amm or parimutuel\./);
  assert.doesNotMatch(result.output, /Unsupported CHAIN_ID|at normalizeLaunchMarketType|Error:/);
});

test('launch accepts pari-mutuel curve flags during dry-run preflight', () => {
  const result = runCli([
    ...buildLaunchArgs(),
    '--market-type',
    'parimutuel',
    '--curve-flattener',
    '7',
    '--curve-offset',
    '30000',
    '--dry-run',
  ], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
    env: {
      CHAIN_ID: '999',
      PRIVATE_KEY: `0x${'1'.repeat(64)}`,
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.output, /Unsupported CHAIN_ID=999\. Supported: 1 or 146/);
  assert.doesNotMatch(result.output, /Invalid --curve-flattener|Invalid --fee-tier for AMM/);
});

test('markets --help includes canonical create surface', () => {
  const result = runCli(['markets', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.output, /markets create plan\|run/i);
});

test('markets --help includes hype planning surface', () => {
  const result = runCli(['markets', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.output, /markets hype plan\|run/i);
});

test('markets create --help json surfaces validation-ticket and balanced-distribution caveats', () => {
  const result = runCli(['--output', 'json', 'markets', 'create', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'markets.create.help');
  assert.equal(Array.isArray(payload.data.notes), true);
  assert.equal(payload.data.notes.some((note) => /exact final payload/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /balanced 50\/50 pool/i.test(String(note))), true);
});

test('agent market hype emits reusable trend-research prompt payload', () => {
  const result = runCli([
    '--output',
    'json',
    'agent',
    'market',
    'hype',
    '--area',
    'sports',
    '--region',
    'United States',
    '--query',
    'NBA injuries',
    '--candidate-count',
    '2',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.command, 'agent.market.hype');
  assert.equal(payload.data.promptKind, 'agent.market.hype');
  assert.equal(payload.data.input.area, 'sports');
  assert.equal(payload.data.input.region, 'United States');
  assert.equal(payload.data.input.query, 'NBA injuries');
  assert.equal(payload.data.input.candidateCount, 2);
  assert.equal(payload.data.workflow.nextTool, 'agent.market.validate');
  assert.match(payload.data.prompt, /Search the public web/i);
});

test('agent market hype rejects regional-news without a region', () => {
  const result = runCli([
    '--output',
    'json',
    'agent',
    'market',
    'hype',
    '--area',
    'regional-news',
  ]);

  assert.equal(result.status, 1);
  assert.match(result.output, /requires --region <text> when --area regional-news/i);
});

test('markets hype --help json surfaces frozen-plan workflow guidance', () => {
  const result = runCli(['--output', 'json', 'markets', 'hype', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'markets.hype.help');
  assert.equal(Array.isArray(payload.data.notes), true);
  assert.equal(payload.data.notes.some((note) => /frozen/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /agent market hype/i.test(String(note))), true);
});

test('markets hype plan emits reusable frozen hype payload in mock mode', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'markets',
      'hype',
      'plan',
      '--area',
      'sports',
      '--candidate-count',
      '1',
      '--ai-provider',
      'mock',
    ], {
      env: {
        PANDORA_INDEXER_URL: indexer.url,
        PANDORA_HYPE_MOCK_RESPONSE: buildMockHypeResponse(),
      },
      unsetEnvKeys: DOCTOR_ENV_KEYS,
    });

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.command, 'markets.hype.plan');
    assert.equal(payload.data.mode, 'plan');
    assert.equal(payload.data.provider.name, 'mock');
    assert.equal(payload.data.researchSnapshot.promptKind, 'agent.market.hype');
    assert.equal(payload.data.candidates.length, 1);
    assert.equal(payload.data.selectedCandidate.recommendedMarketType, 'amm');
    assert.equal(payload.data.selectedCandidate.marketDrafts.amm.distributionYes, 570000000);
    assert.equal(payload.data.selectedCandidate.marketDrafts.amm.distributionNo, 430000000);
    assert.equal(payload.data.selectedCandidate.validation.attestation.validationDecision, 'PASS');
    assert.equal(payload.data.selectedCandidate.readyToDeploy, true);
  } finally {
    await indexer.close();
  }
});

test('markets hype plan rejects regional-news without a region', () => {
  const result = runCli([
    '--output',
    'json',
    'markets',
    'hype',
    'plan',
    '--area',
    'regional-news',
    '--ai-provider',
    'mock',
  ], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });

  assert.equal(result.status, 1);
  assert.match(result.output, /requires --region <text> when --area regional-news/i);
});

test('markets hype plan rejects unsupported ai-provider none', () => {
  const result = runCli([
    '--output',
    'json',
    'markets',
    'hype',
    'plan',
    '--area',
    'sports',
    '--ai-provider',
    'none',
  ], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });

  assert.equal(result.status, 1);
  assert.match(result.output, /--ai-provider supports auto\|mock\|openai\|anthropic/i);
});

test('markets hype run --dry-run reuses a frozen plan file without re-running research', async () => {
  const indexer = await startIndexerMockServer();
  const tempDir = createTempDir('pandora-hype-plan-');
  const planFile = path.join(tempDir, 'hype-plan.json');

  try {
    const planResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'hype',
      'plan',
      '--area',
      'sports',
      '--candidate-count',
      '1',
      '--ai-provider',
      'mock',
    ], {
      env: {
        PANDORA_INDEXER_URL: indexer.url,
        PANDORA_HYPE_MOCK_RESPONSE: buildMockHypeResponse(),
      },
      unsetEnvKeys: DOCTOR_ENV_KEYS,
    });

    assert.equal(planResult.status, 0);
    fs.writeFileSync(planFile, planResult.stdout, 'utf8');
    const planPayload = parseJsonOutput(planResult);

    const dryRunResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'hype',
      'run',
      '--plan-file',
      planFile,
      '--candidate-id',
      planPayload.data.selectedCandidateId,
      '--market-type',
      'selected',
      '--tx-route',
      'flashbots-bundle',
      '--dry-run',
    ], {
      env: {
        PANDORA_INDEXER_URL: indexer.url,
      },
      unsetEnvKeys: DOCTOR_ENV_KEYS,
    });

    assert.equal(dryRunResult.status, 0);
    const payload = parseJsonOutput(dryRunResult);
    assert.equal(payload.command, 'markets.hype.run');
    assert.equal(payload.data.mode, 'dry-run');
    assert.equal(payload.data.selectedMarketType, 'amm');
    assert.equal(payload.data.deployment.mode, 'dry-run');
    assert.equal(payload.data.deployment.txRouteRequested, 'flashbots-bundle');
    assert.equal(payload.data.deployment.txRouteResolved, 'flashbots-bundle');
    assert.equal(payload.data.deployment.deploymentArgs.distributionYes, 570000000);
    assert.equal(payload.data.deployment.deploymentArgs.distributionNo, 430000000);
    assert.equal(payload.data.deployment.requiredValidation.ticket, payload.data.requiredValidation.ticket);
    assert.equal(payload.data.validationResult.decision, 'PASS');
  } finally {
    await indexer.close();
    removeDir(tempDir);
  }
});

test('markets hype plan normalizes model category aliases like Esports back to Pandora categories', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'markets',
      'hype',
      'plan',
      '--area',
      'e-gaming',
      '--candidate-count',
      '1',
      '--ai-provider',
      'mock',
    ], {
      env: {
        PANDORA_INDEXER_URL: indexer.url,
        PANDORA_HYPE_MOCK_RESPONSE: buildMockHypeResponse({
          category: 'Esports',
          question: 'Will Team Spirit win the Counter-Strike Major final on April 1, 2030?',
          rules: 'YES: Team Spirit wins the official grand final.\nNO: Team Spirit does not win the official grand final.\nEDGE: If the final is not completed by April 2, 2030, resolve N/A.',
        }),
      },
      unsetEnvKeys: DOCTOR_ENV_KEYS,
    });

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.command, 'markets.hype.plan');
    assert.equal(payload.data.area, 'esports');
    assert.equal(payload.data.selectedCandidate.categoryName, 'Sports');
    assert.equal(payload.data.selectedCandidate.categoryId, 1);
  } finally {
    await indexer.close();
  }
});

test('markets hype run --execute rejects tampered plan files before any live execution step', async () => {
  const indexer = await startIndexerMockServer();
  const tempDir = createTempDir('pandora-hype-execute-');
  const planFile = path.join(tempDir, 'hype-plan.json');

  try {
    const planResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'hype',
      'plan',
      '--area',
      'sports',
      '--candidate-count',
      '1',
      '--ai-provider',
      'mock',
    ], {
      env: {
        PANDORA_INDEXER_URL: indexer.url,
        PANDORA_HYPE_MOCK_RESPONSE: buildMockHypeResponse(),
      },
      unsetEnvKeys: DOCTOR_ENV_KEYS,
    });

    assert.equal(planResult.status, 0);
    const planPayload = parseJsonOutput(planResult);
    const selectedCandidate = planPayload.data.candidates.find(
      (candidate) => String(candidate.candidateId) === String(planPayload.data.selectedCandidateId),
    );
    assert.ok(selectedCandidate);
    selectedCandidate.marketDrafts.amm.question = 'Tampered execute question?';
    if (planPayload.data.selectedCandidate && String(planPayload.data.selectedCandidate.candidateId) === String(planPayload.data.selectedCandidateId)) {
      planPayload.data.selectedCandidate.marketDrafts.amm.question = 'Tampered execute question?';
    }
    fs.writeFileSync(planFile, JSON.stringify(planPayload, null, 2), 'utf8');

    const executeResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'hype',
      'run',
      '--plan-file',
      planFile,
      '--candidate-id',
      planPayload.data.selectedCandidateId,
      '--market-type',
      'amm',
      '--execute',
      '--private-key',
      `0x${'1'.repeat(64)}`,
      '--rpc-url',
      'https://ethereum.publicnode.com',
    ], {
      env: {
        PANDORA_INDEXER_URL: indexer.url,
      },
      unsetEnvKeys: DOCTOR_ENV_KEYS,
    });

    assert.equal(executeResult.status, 1);
    assert.match(executeResult.output, /validation attestation|Regenerate the plan|validation/i);
  } finally {
    await indexer.close();
    removeDir(tempDir);
  }
});

test('markets hype run --execute rejects plan files that lost validation metadata', async () => {
  const indexer = await startIndexerMockServer();
  const tempDir = createTempDir('pandora-hype-missing-validation-');
  const planFile = path.join(tempDir, 'hype-plan.json');

  try {
    const planResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'hype',
      'plan',
      '--area',
      'sports',
      '--candidate-count',
      '1',
      '--ai-provider',
      'mock',
    ], {
      env: {
        PANDORA_INDEXER_URL: indexer.url,
        PANDORA_HYPE_MOCK_RESPONSE: buildMockHypeResponse(),
      },
      unsetEnvKeys: DOCTOR_ENV_KEYS,
    });

    assert.equal(planResult.status, 0);
    const planPayload = parseJsonOutput(planResult);
    const selectedCandidate = planPayload.data.candidates.find(
      (candidate) => String(candidate.candidateId) === String(planPayload.data.selectedCandidateId),
    );
    assert.ok(selectedCandidate);
    delete selectedCandidate.validation;
    if (planPayload.data.selectedCandidate && String(planPayload.data.selectedCandidate.candidateId) === String(planPayload.data.selectedCandidateId)) {
      delete planPayload.data.selectedCandidate.validation;
    }
    fs.writeFileSync(planFile, JSON.stringify(planPayload, null, 2), 'utf8');

    const executeResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'hype',
      'run',
      '--plan-file',
      planFile,
      '--candidate-id',
      planPayload.data.selectedCandidateId,
      '--market-type',
      'amm',
      '--execute',
      '--private-key',
      `0x${'1'.repeat(64)}`,
      '--rpc-url',
      'https://ethereum.publicnode.com',
    ], {
      env: {
        PANDORA_INDEXER_URL: indexer.url,
      },
      unsetEnvKeys: DOCTOR_ENV_KEYS,
    });

    assert.equal(executeResult.status, 1);
    assert.match(executeResult.output, /validation attestation|requires a PASS validation attestation/i);
  } finally {
    await indexer.close();
    removeDir(tempDir);
  }
});

test('markets hype run --execute rejects candidates that are not ready to deploy', async () => {
  const indexer = await startIndexerMockServer();
  const tempDir = createTempDir('pandora-hype-not-ready-');
  const planFile = path.join(tempDir, 'hype-plan.json');

  try {
    const planResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'hype',
      'plan',
      '--area',
      'sports',
      '--candidate-count',
      '1',
      '--ai-provider',
      'mock',
    ], {
      env: {
        PANDORA_INDEXER_URL: indexer.url,
        PANDORA_HYPE_MOCK_RESPONSE: buildMockHypeResponse(),
      },
      unsetEnvKeys: DOCTOR_ENV_KEYS,
    });

    assert.equal(planResult.status, 0);
    const planPayload = parseJsonOutput(planResult);
    const selectedCandidate = planPayload.data.candidates.find(
      (candidate) => String(candidate.candidateId) === String(planPayload.data.selectedCandidateId),
    );
    assert.ok(selectedCandidate);
    selectedCandidate.readyToDeploy = false;
    if (planPayload.data.selectedCandidate && String(planPayload.data.selectedCandidate.candidateId) === String(planPayload.data.selectedCandidateId)) {
      planPayload.data.selectedCandidate.readyToDeploy = false;
    }
    fs.writeFileSync(planFile, JSON.stringify(planPayload, null, 2), 'utf8');

    const executeResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'hype',
      'run',
      '--plan-file',
      planFile,
      '--candidate-id',
      planPayload.data.selectedCandidateId,
      '--market-type',
      'amm',
      '--execute',
      '--private-key',
      `0x${'1'.repeat(64)}`,
      '--rpc-url',
      'https://ethereum.publicnode.com',
    ], {
      env: {
        PANDORA_INDEXER_URL: indexer.url,
      },
      unsetEnvKeys: DOCTOR_ENV_KEYS,
    });

    assert.equal(executeResult.status, 1);
    assert.match(executeResult.output, /not marked readyToDeploy/i);
  } finally {
    await indexer.close();
    removeDir(tempDir);
  }
});

test('markets hype run --execute rejects deploy-only draft tampering outside validation fields', async () => {
  const indexer = await startIndexerMockServer();
  const tempDir = createTempDir('pandora-hype-integrity-');
  const planFile = path.join(tempDir, 'hype-plan.json');

  try {
    const planResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'hype',
      'plan',
      '--area',
      'sports',
      '--candidate-count',
      '1',
      '--ai-provider',
      'mock',
    ], {
      env: {
        PANDORA_INDEXER_URL: indexer.url,
        PANDORA_HYPE_MOCK_RESPONSE: buildMockHypeResponse(),
      },
      unsetEnvKeys: DOCTOR_ENV_KEYS,
    });

    assert.equal(planResult.status, 0);
    const planPayload = parseJsonOutput(planResult);
    const selectedCandidate = planPayload.data.candidates.find(
      (candidate) => String(candidate.candidateId) === String(planPayload.data.selectedCandidateId),
    );
    assert.ok(selectedCandidate);
    selectedCandidate.marketDrafts.amm.distributionYes = 650000000;
    selectedCandidate.marketDrafts.amm.distributionNo = 350000000;
    if (planPayload.data.selectedCandidate && String(planPayload.data.selectedCandidate.candidateId) === String(planPayload.data.selectedCandidateId)) {
      planPayload.data.selectedCandidate.marketDrafts.amm.distributionYes = 650000000;
      planPayload.data.selectedCandidate.marketDrafts.amm.distributionNo = 350000000;
    }
    fs.writeFileSync(planFile, JSON.stringify(planPayload, null, 2), 'utf8');

    const executeResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'hype',
      'run',
      '--plan-file',
      planFile,
      '--candidate-id',
      planPayload.data.selectedCandidateId,
      '--market-type',
      'amm',
      '--execute',
      '--private-key',
      `0x${'1'.repeat(64)}`,
      '--rpc-url',
      'https://ethereum.publicnode.com',
    ], {
      env: {
        PANDORA_INDEXER_URL: indexer.url,
      },
      unsetEnvKeys: DOCTOR_ENV_KEYS,
    });

    assert.equal(executeResult.status, 1);
    assert.match(executeResult.output, /frozen draft|integrity|Regenerate the plan/i);
  } finally {
    await indexer.close();
    removeDir(tempDir);
  }
});

test('markets create plan emits canonical pari-mutuel plan payload', () => {
  const result = runCli([
    '--output',
    'json',
    'markets',
    'create',
    'plan',
    '--market-type',
    'parimutuel',
    '--question',
    'Will BTC close above $120k by end of 2026?',
    '--rules',
    buildRules(),
    '--sources',
    'https://example.com/a',
    'https://example.com/b',
    '--target-timestamp',
    FIXED_FUTURE_TIMESTAMP,
    '--liquidity-usdc',
    '100',
    '--curve-flattener',
    '7',
    '--curve-offset',
    '30000',
  ], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.command, 'markets.create.plan');
  assert.equal(payload.data.mode, 'plan');
  assert.equal(payload.data.marketTemplate.marketType, 'parimutuel');
  assert.equal(payload.data.marketTemplate.curveFlattener, 7);
  assert.equal(payload.data.marketTemplate.curveOffset, 30000);
  assert.equal(payload.data.requiredValidation.promptTool, 'agent.market.validate');
  assert.equal(payload.data.notes.some((note) => /balanced 50\/50 pool/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /exact final payload/i.test(String(note))), true);
});

test('markets create run --dry-run emits canonical deployment payload', () => {
  const result = runCli([
    '--output',
    'json',
    'markets',
    'create',
    'run',
    '--market-type',
    'amm',
    '--question',
    'Will ETH close above $8k by end of 2026?',
    '--rules',
    buildRules(),
    '--sources',
    'https://example.com/a',
    'https://example.com/b',
    '--target-timestamp',
    FIXED_FUTURE_TIMESTAMP,
    '--liquidity-usdc',
    '100',
    '--fee-tier',
    '3000',
    '--tx-route',
    'flashbots-bundle',
    '--dry-run',
  ], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.command, 'markets.create.run');
  assert.equal(payload.data.mode, 'dry-run');
  assert.equal(payload.data.marketTemplate.marketType, 'amm');
  assert.equal(payload.data.deployment.mode, 'dry-run');
  assert.equal(payload.data.deployment.deploymentArgs.marketType, 'amm');
  assert.equal(payload.data.deployment.txRouteRequested, 'flashbots-bundle');
  assert.equal(payload.data.deployment.txRouteResolved, 'flashbots-bundle');
  assert.equal(payload.data.deployment.requiredValidation.promptTool, 'agent.market.validate');
});

test('markets create run --execute fails fast without a matching validation ticket', () => {
  const result = runCli([
    'markets',
    'create',
    'run',
    '--market-type',
    'amm',
    '--question',
    'Will SOL close above $500 by end of 2026?',
    '--rules',
    buildRules(),
    '--sources',
    'https://example.com/a',
    'https://example.com/b',
    '--target-timestamp',
    FIXED_FUTURE_TIMESTAMP,
    '--liquidity-usdc',
    '100',
    '--fee-tier',
    '3000',
    '--execute',
    '--private-key',
    `0x${'1'.repeat(64)}`,
    '--rpc-url',
    'https://ethereum.publicnode.com',
    '--skip-dotenv',
  ], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });

  assert.equal(result.status, 1);
  assert.match(result.output, /validation-ticket/i);
  assert.match(result.output, /agent market validate/i);
});

test('clone-bet rejects unsupported category names before env-dependent validation', () => {
  const result = runCli([
    'clone-bet',
    '--skip-dotenv',
    '--category',
    'Gaming',
  ], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });

  assert.equal(result.status, 1);
  assert.match(result.output, /--category must be one of .*Politics.*Other.*integer between 0 and 10/i);
});

test('launch rejects unsupported category names before env-dependent validation', () => {
  const result = runCli([
    'launch',
    '--skip-dotenv',
    '--category',
    'Gaming',
  ], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });

  assert.equal(result.status, 1);
  assert.match(result.output, /--category must be one of .*Politics.*Other.*integer between 0 and 10/i);
});

test('launch supports --no-env-file alias', () => {
  const result = runCli([
    'launch',
    '--no-env-file',
    '--question',
    'Alias test?',
    '--rules',
    buildRules(),
    '--sources',
    'https://example.com/a',
    'https://example.com/b',
    '--target-timestamp',
    FIXED_FUTURE_TIMESTAMP,
    '--liquidity',
    '10',
  ], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });

  assert.equal(result.status, 1);
  assert.match(result.output, /You must pass either --dry-run or --execute/);
});

test('launch rejects --output json mode', () => {
  const result = runCli([
    '--output',
    'json',
    'launch',
    '--skip-dotenv',
    '--question',
    'Output mode contract',
    '--rules',
    buildRules(),
    '--sources',
    'https://example.com/a',
    'https://example.com/b',
    '--target-timestamp',
    FIXED_FUTURE_TIMESTAMP,
    '--liquidity',
    '10',
    '--dry-run',
  ], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'UNSUPPORTED_OUTPUT_MODE');
});

test('json errors include next-best-action recovery hints', () => {
  const result = runCli([
    '--output',
    'json',
    'trade',
    '--dry-run',
    '--side',
    'yes',
    '--amount-usdc',
    '10',
  ]);

  assert.equal(result.status, 1, result.output);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.equal(typeof payload.error.recovery, 'object');
  assert.equal(payload.error.recovery.retryable, true);
  assert.equal(typeof payload.error.recovery.command, 'string');
  assert.match(payload.error.recovery.command, /pandora help|pandora trade --dry-run/);
});

test('unknown command errors include structured recovery hints', () => {
  const result = runCli(['--output', 'json', 'totally-unknown-command']);
  assert.equal(result.status, 1, result.output);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'UNKNOWN_COMMAND');
  assert.equal(typeof payload.error.recovery, 'object');
  assert.equal(payload.error.recovery.retryable, true);
  assert.equal(payload.error.recovery.command, 'pandora help');
});

test('trade dry-run with fork flags marks runtime.mode=fork', () => {
  const result = runCli([
    '--output',
    'json',
    'trade',
    '--dry-run',
    '--market-address',
    ADDRESSES.mirrorMarket,
    '--side',
    'yes',
    '--amount-usdc',
    '10',
    '--yes-pct',
    '55',
    '--fork-rpc-url',
    'http://127.0.0.1:8545',
    '--fork-chain-id',
    '1',
  ]);

  assert.equal(result.status, 0, result.output);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'trade');
  assert.equal(payload.data.runtime.mode, 'fork');
});

test('resolve dry-run with fork flags marks runtime.mode=fork', () => {
  const result = runCli([
    '--output',
    'json',
    'resolve',
    '--poll-address',
    ADDRESSES.mirrorPoll,
    '--answer',
    'yes',
    '--reason',
    'Fork simulation',
    '--dry-run',
    '--fork-rpc-url',
    'http://127.0.0.1:8545',
  ]);

  assert.equal(result.status, 0, result.output);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'resolve');
  assert.equal(payload.data.runtime.mode, 'fork');
});

test('lp add dry-run with fork flags marks runtime.mode=fork', () => {
  const result = runCli([
    '--output',
    'json',
    'lp',
    'add',
    '--market-address',
    ADDRESSES.mirrorMarket,
    '--amount-usdc',
    '15',
    '--dry-run',
    '--fork-rpc-url',
    'http://127.0.0.1:8545',
  ]);

  assert.equal(result.status, 0, result.output);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'lp');
  assert.equal(payload.data.runtime.mode, 'fork');
});

test('polymarket trade execute in fork mode requires --polymarket-mock-url', () => {
  const result = runCli([
    '--output',
    'json',
    'polymarket',
    'trade',
    '--token-id',
    '12345',
    '--amount-usdc',
    '1',
    '--execute',
    '--fork-rpc-url',
    'http://127.0.0.1:8545',
  ]);

  assert.equal(result.status, 1, result.output);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'FORK_EXECUTION_REQUIRES_MOCK_URL');
});

test('polymarket fork mode reports structured missing FORK_RPC_URL errors', () => {
  const result = runCli(
    ['--output', 'json', 'polymarket', 'check', '--fork'],
    { unsetEnvKeys: ['FORK_RPC_URL'] },
  );

  assert.equal(result.status, 1, result.output);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'MISSING_REQUIRED_FLAG');
});

test('polymarket fork mode validates FORK_RPC_URL from env', () => {
  const result = runCli(
    ['--output', 'json', 'polymarket', 'check', '--fork'],
    { env: { FORK_RPC_URL: 'ftp://example.com' } },
  );

  assert.equal(result.status, 1, result.output);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
});

test('polymarket positions help advertises source selection and data api controls', () => {
  const result = runCli(['--output', 'json', 'polymarket', 'positions', '--help']);

  assert.equal(result.status, 0, result.output);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'polymarket.positions.help');
  assert.match(payload.data.usage, /--source auto\|api\|on-chain/);
  assert.match(payload.data.usage, /--polymarket-data-api-url <url>/);
  assert.equal(
    payload.data.notes.some((entry) => /merge-readiness/i.test(entry)),
    true,
  );
});

test('polymarket positions returns normalized inventory from a mock payload', async () => {
  const conditionId = `0x${'d'.repeat(64)}`;
  const server = await startJsonHttpServer(async () => ({
    body: {
      markets: [
        {
          condition_id: conditionId,
          market_slug: 'btc-above-100k',
          question: 'Will BTC close above $100k?',
          outcomes: ['Yes', 'No'],
          outcomePrices: ['0.62', '0.38'],
          clobTokenIds: ['101', '102'],
          active: true,
        },
      ],
      positions: [
        {
          asset: '101',
          conditionId,
          size: 1.5,
          curPrice: 0.62,
          outcome: 'YES',
          question: 'Will BTC close above $100k?',
        },
        {
          asset: '102',
          conditionId,
          size: 0.25,
          curPrice: 0.38,
          outcome: 'NO',
          question: 'Will BTC close above $100k?',
        },
      ],
      balances: {
        101: 1.5,
        102: 0.25,
      },
      openOrders: [
        {
          id: 'ord-1',
          market: conditionId,
          asset_id: '101',
          side: 'buy',
          price: 0.61,
          size: 1.2,
        },
      ],
    },
  }));

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'polymarket',
      'positions',
      '--wallet',
      ADDRESSES.wallet1,
      '--condition-id',
      conditionId,
      '--source',
      'api',
      '--polymarket-mock-url',
      server.url,
      '--timeout-ms',
      '8000',
    ]);

    assert.equal(result.status, 0, result.output);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'polymarket.positions');
    assert.equal(payload.data.market.marketId, conditionId);
    assert.equal(payload.data.market.yesTokenId, '101');
    assert.equal(payload.data.summary.yesBalance, 1.5);
    assert.equal(payload.data.summary.noBalance, 0.25);
    assert.equal(payload.data.summary.openOrdersCount, 1);
    assert.equal(payload.data.summary.mergeablePairs, 0.25);
    assert.equal(payload.data.mergeReadiness.eligible, true);
    assert.equal(payload.data.mergeReadiness.mergeablePairs, 0.25);
    assert.equal(
      payload.data.mergeReadiness.prerequisites.some((entry) => /wallet that actually holds/i.test(entry)),
      true,
    );
    assert.equal(payload.data.positions.length, 2);
    assert.equal(payload.data.positions[0].fieldSources.balance, 'api');
    assert.equal(payload.data.openOrders[0].tokenId, '101');
    assert.equal(payload.data.diagnostics.includes('Loaded Polymarket position inventory from mock payload.'), true);
    assert.equal(
      payload.data.diagnostics.some((entry) => /Overlapping YES\/NO inventory detected/i.test(entry)),
      true,
    );
  } finally {
    await server.close();
  }
});

test('model calibrate returns jump-diffusion artifact and persists with --save-model', () => {
  const tempDir = createTempDir('pandora-model-calibrate-cli-');
  const modelPath = path.join(tempDir, 'jd-model.json');

  try {
    const result = runCli([
      '--output',
      'json',
      'model',
      'calibrate',
      '--returns',
      '0.03,-0.04,0.01,-0.02,0.05,-0.06,0.02,-0.01',
      '--jump-threshold-sigma',
      '1.2',
      '--model-id',
      'cli-jd',
      '--save-model',
      modelPath,
    ]);

    assert.equal(result.status, 0, result.output);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'model.calibrate');
    assert.equal(payload.data.model.kind, 'jump_diffusion');
    assert.equal(payload.data.model.modelId, 'cli-jd');
    assert.equal(payload.data.persistence.saved, true);
    assert.equal(fs.existsSync(modelPath), true);
  } finally {
    removeDir(tempDir);
  }
});

test('model correlation defaults to t-copula and emits stress metrics', () => {
  const result = runCli([
    '--output',
    'json',
    'model',
    'correlation',
    '--series',
    'btc:0.03,-0.04,0.01,-0.02,0.05,-0.06,0.02,-0.01',
    '--series',
    'eth:0.04,-0.05,0.02,-0.01,0.06,-0.08,0.03,-0.02',
    '--series',
    'sol:0.05,-0.06,0.02,-0.03,0.07,-0.1,0.04,-0.02',
    '--compare',
    'gaussian,clayton',
  ]);

  assert.equal(result.status, 0, result.output);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'model.correlation');
  assert.equal(payload.data.copula.family, 't');
  assert.equal(payload.data.metrics.labels.length, 3);
  assert.ok(payload.data.metrics.pairwise.length >= 3);
  assert.equal(typeof payload.data.stress.jointExtremeProbability, 'number');
  assert.equal(Array.isArray(payload.data.stress.scenarioResults), true);
});
