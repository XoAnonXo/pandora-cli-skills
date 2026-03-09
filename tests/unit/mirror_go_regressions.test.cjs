const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');

const handleMirrorGo = require('../../cli/lib/mirror_handlers/go.cjs');
const { createParseMirrorGoFlags } = require('../../cli/lib/parsers/mirror_go_flags.cjs');
const { createParseMirrorSyncFlags } = require('../../cli/lib/parsers/mirror_sync_flags.cjs');
const { deployMirror } = require('../../cli/lib/mirror_service.cjs');
const { createErrorRecoveryService } = require('../../cli/lib/error_recovery_service.cjs');

class TestCliError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'TestCliError';
    this.code = code;
    this.details = details;
  }
}

const TEST_MARKET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TEST_POLL = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ORIGINAL_MCP_MODE = process.env.PANDORA_MCP_MODE;

function requireFlagValue(args, index, flagName) {
  const value = args[index + 1];
  if (typeof value !== 'string' || value.startsWith('--')) {
    throw new TestCliError('MISSING_FLAG_VALUE', `Missing value for ${flagName}`);
  }
  return value;
}

function parsePositiveInteger(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new TestCliError('INVALID_FLAG_VALUE', `${flagName} must be a positive integer.`);
  }
  return parsed;
}

function parsePositiveNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new TestCliError('INVALID_FLAG_VALUE', `${flagName} must be a positive number.`);
  }
  return parsed;
}

function parseInteger(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new TestCliError('INVALID_FLAG_VALUE', `${flagName} must be an integer.`);
  }
  return parsed;
}

function parseAddress(value, flagName) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(value))) {
    throw new TestCliError('INVALID_FLAG_VALUE', `${flagName} must be an EVM address.`);
  }
  return value;
}

function parsePrivateKey(value, flagName) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(value))) {
    throw new TestCliError('INVALID_FLAG_VALUE', `${flagName} must be a 32-byte hex key.`);
  }
  return value;
}

function isSecureHttpUrlOrLocal(value) {
  return /^https:\/\//.test(String(value)) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(String(value));
}

function parseSkipGateList(value, flagName) {
  const list = String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.toUpperCase());
  if (!list.length) {
    throw new TestCliError('INVALID_FLAG_VALUE', `${flagName} must include at least one check code.`);
  }
  return Array.from(new Set(list));
}

function mergeSkipGateLists(left, right) {
  return Array.from(new Set([...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]));
}

function buildGoParserDeps() {
  return {
    CliError: TestCliError,
    parseAddressFlag: parseAddress,
    parsePrivateKeyFlag: parsePrivateKey,
    requireFlagValue,
    parsePositiveInteger,
    parsePositiveNumber,
    parseInteger,
    isSecureHttpUrlOrLocal,
    parseMirrorSyncGateSkipList: parseSkipGateList,
    mergeMirrorSyncGateSkipLists: mergeSkipGateLists,
  };
}

function buildSyncParserDeps() {
  return {
    ...buildGoParserDeps(),
    parseWebhookFlagIntoOptions: () => null,
    defaultMirrorStateFile: () => '/tmp/mirror-state.json',
    defaultMirrorKillSwitchFile: () => '/tmp/mirror-stop',
  };
}

function withMcpMode(fn) {
  process.env.PANDORA_MCP_MODE = '1';
  try {
    return fn();
  } finally {
    if (ORIGINAL_MCP_MODE === undefined) {
      delete process.env.PANDORA_MCP_MODE;
    } else {
      process.env.PANDORA_MCP_MODE = ORIGINAL_MCP_MODE;
    }
  }
}

async function startRpcHealthServer(chainIdHex = '0x89') {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      let id = 1;
      try {
        const parsed = JSON.parse(body || '{}');
        id = parsed && parsed.id !== undefined ? parsed.id : 1;
      } catch {}
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result: chainIdHex }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function buildGoOptions(overrides = {}) {
  return {
    polymarketMarketId: 'poly-1',
    polymarketSlug: null,
    liquidityUsdc: 100,
    feeTier: 3000,
    maxImbalance: 10_000,
    category: 1,
    arbiter: null,
    paper: false,
    executeLive: true,
    autoSync: false,
    syncOnce: false,
    syncIntervalMs: 5000,
    driftTriggerBps: 150,
    hedgeTriggerUsdc: 10,
    hedgeRatio: 1,
    rebalanceRoute: 'public',
    rebalanceRouteFallback: 'fail',
    flashbotsRelayUrl: null,
    flashbotsAuthKey: null,
    flashbotsTargetBlockOffset: null,
    noHedge: false,
    maxRebalanceUsdc: 25,
    maxHedgeUsdc: 50,
    maxOpenExposureUsdc: 200,
    maxTradesPerDay: 5,
    cooldownMs: 60000,
    chainId: 1,
    rpcUrl: 'https://ethereum.publicnode.com',
    polymarketRpcUrl: 'https://polygon-bor-rpc.publicnode.com',
    privateKey: null,
    funder: null,
    usdc: null,
    oracle: null,
    factory: null,
    sources: [],
    sourcesProvided: false,
    manifestFile: '/tmp/mirror-pairs.json',
    trustDeploy: false,
    forceGate: false,
    forceGateDeprecatedUsed: false,
    skipGateChecks: [],
    polymarketHost: null,
    polymarketGammaUrl: null,
    polymarketGammaMockUrl: null,
    polymarketMockUrl: null,
    withRules: false,
    includeSimilarity: false,
    minCloseLeadSeconds: 3600,
    ...overrides,
  };
}

test('parseMirrorGoFlags accepts --polymarket-rpc-url and enforces companion live flags in one error', () => {
  const parseMirrorGoFlags = createParseMirrorGoFlags(buildGoParserDeps());

  const parsed = parseMirrorGoFlags([
    '--polymarket-market-id',
    'poly-1',
    '--polymarket-rpc-url',
    'https://polygon-bor-rpc.publicnode.com, https://polygon-rpc.com,https://polygon-bor-rpc.publicnode.com',
  ]);
  assert.equal(parsed.polymarketRpcUrl, 'https://polygon-bor-rpc.publicnode.com,https://polygon-rpc.com');

  assert.throws(
    () => parseMirrorGoFlags(['--polymarket-market-id', 'poly-1', '--execute-live']),
    (error) => {
      assert.equal(error.code, 'MISSING_REQUIRED_FLAG');
      assert.match(error.message, /--max-open-exposure-usdc/);
      assert.match(error.message, /--max-trades-per-day/);
      return true;
    },
  );
});

test('parseMirrorSyncFlags accepts --polymarket-rpc-url and enforces companion live flags in one error', () => {
  const parseMirrorSyncFlags = createParseMirrorSyncFlags(buildSyncParserDeps());

  const parsed = parseMirrorSyncFlags([
    'run',
    '--market-address',
    TEST_MARKET,
    '--polymarket-market-id',
    'poly-1',
    '--polymarket-rpc-url',
    'https://polygon-bor-rpc.publicnode.com',
    '--paper',
  ]);
  assert.equal(parsed.polymarketRpcUrl, 'https://polygon-bor-rpc.publicnode.com');

  assert.throws(
    () => parseMirrorSyncFlags([
      'run',
      '--market-address',
      TEST_MARKET,
      '--polymarket-market-id',
      'poly-1',
      '--execute-live',
    ]),
    (error) => {
      assert.equal(error.code, 'MISSING_REQUIRED_FLAG');
      assert.match(error.message, /--max-open-exposure-usdc/);
      assert.match(error.message, /--max-trades-per-day/);
      return true;
    },
  );
});

test('mirror go lifecycle flags require live finite execution plus explicit resolve inputs', () => {
  const parseMirrorGoFlags = createParseMirrorGoFlags(buildGoParserDeps());

  const parsed = parseMirrorGoFlags([
    '--polymarket-market-id',
    'poly-1',
    '--execute-live',
    '--max-open-exposure-usdc',
    '100',
    '--max-trades-per-day',
    '5',
    '--auto-sync',
    '--sync-once',
    '--auto-resolve',
    '--auto-close',
    '--resolve-answer',
    'yes',
    '--resolve-reason',
    'Official result confirmed.',
    '--resolve-watch-interval-ms',
    '1500',
    '--resolve-watch-timeout-ms',
    '120000',
  ]);

  assert.equal(parsed.autoResolve, true);
  assert.equal(parsed.autoClose, true);
  assert.equal(parsed.resolveAnswer, 'yes');
  assert.equal(parsed.resolveReason, 'Official result confirmed.');
  assert.equal(parsed.resolveWatchIntervalMs, 1500);
  assert.equal(parsed.resolveWatchTimeoutMs, 120000);

  assert.throws(
    () => parseMirrorGoFlags(['--polymarket-market-id', 'poly-1', '--auto-close']),
    /--auto-close requires --auto-resolve/,
  );
  assert.throws(
    () => parseMirrorGoFlags(['--polymarket-market-id', 'poly-1', '--auto-resolve', '--resolve-answer', 'yes', '--resolve-reason', 'x']),
    /lifecycle automation requires live mode/i,
  );
  assert.throws(
    () => parseMirrorGoFlags([
      '--polymarket-market-id',
      'poly-1',
      '--execute-live',
      '--max-open-exposure-usdc',
      '100',
      '--max-trades-per-day',
      '5',
      '--auto-sync',
      '--auto-resolve',
      '--resolve-answer',
      'yes',
      '--resolve-reason',
      'x',
    ]),
    /requires a finite mirror go run/i,
  );
});

test('mirror go and sync parsers accept flashbots routing flags and reject invalid fallback/relay/block values', () => {
  const parseMirrorGoFlags = createParseMirrorGoFlags(buildGoParserDeps());
  const parseMirrorSyncFlags = createParseMirrorSyncFlags(buildSyncParserDeps());

  const goParsed = parseMirrorGoFlags([
    '--polymarket-market-id',
    'poly-1',
    '--rebalance-route',
    'flashbots-bundle',
    '--rebalance-route-fallback',
    'public',
    '--flashbots-relay-url',
    'https://relay.flashbots.example',
    '--flashbots-auth-key',
    'auth-key-ref',
    '--flashbots-target-block-offset',
    '3',
  ]);
  assert.equal(goParsed.rebalanceRoute, 'flashbots-bundle');
  assert.equal(goParsed.rebalanceRouteFallback, 'public');
  assert.equal(goParsed.flashbotsRelayUrl, 'https://relay.flashbots.example');
  assert.equal(goParsed.flashbotsAuthKey, 'auth-key-ref');
  assert.equal(goParsed.flashbotsTargetBlockOffset, 3);

  const syncParsed = parseMirrorSyncFlags([
    'once',
    '--market-address',
    TEST_MARKET,
    '--polymarket-market-id',
    'poly-1',
    '--rebalance-route',
    'flashbots-private',
    '--rebalance-route-fallback',
    'fail',
    '--flashbots-relay-url',
    'https://relay.flashbots.example',
    '--flashbots-auth-key',
    'auth-key-ref',
    '--flashbots-target-block-offset',
    '2',
    '--paper',
  ]);
  assert.equal(syncParsed.rebalanceRoute, 'flashbots-private');
  assert.equal(syncParsed.rebalanceRouteFallback, 'fail');
  assert.equal(syncParsed.flashbotsRelayUrl, 'https://relay.flashbots.example');
  assert.equal(syncParsed.flashbotsAuthKey, 'auth-key-ref');
  assert.equal(syncParsed.flashbotsTargetBlockOffset, 2);

  assert.throws(
    () => parseMirrorGoFlags(['--polymarket-market-id', 'poly-1', '--rebalance-route-fallback', 'maybe']),
    /--rebalance-route-fallback must be fail\|public\./,
  );
  assert.throws(
    () => parseMirrorSyncFlags([
      'once',
      '--market-address',
      TEST_MARKET,
      '--polymarket-market-id',
      'poly-1',
      '--flashbots-relay-url',
      'http://relay.flashbots.example',
      '--paper',
    ]),
    /--flashbots-relay-url must use https:\/\//,
  );
  assert.throws(
    () => parseMirrorSyncFlags([
      'once',
      '--market-address',
      TEST_MARKET,
      '--polymarket-market-id',
      'poly-1',
      '--flashbots-target-block-offset',
      '0',
      '--paper',
    ]),
    /--flashbots-target-block-offset must be a positive integer\./,
  );
  assert.throws(
    () => parseMirrorGoFlags([
      '--polymarket-market-id',
      'poly-1',
      '--flashbots-auth-key',
      'auth-key-ref',
    ]),
    /--flashbots-auth-key require --rebalance-route auto, flashbots-private, or flashbots-bundle\./,
  );
  assert.throws(
    () => parseMirrorSyncFlags([
      'once',
      '--market-address',
      TEST_MARKET,
      '--polymarket-market-id',
      'poly-1',
      '--flashbots-relay-url',
      'https://relay.flashbots.example',
      '--paper',
    ]),
    /--flashbots-relay-url require --rebalance-route auto, flashbots-private, or flashbots-bundle\./,
  );
});

test('parseMirrorGoFlags blocks manifest files outside workspace in MCP mode', () => {
  const parseMirrorGoFlags = createParseMirrorGoFlags(buildGoParserDeps());

  withMcpMode(() => {
    assert.throws(
      () => parseMirrorGoFlags(['--polymarket-market-id', 'poly-1', '--manifest-file', '/tmp/pairs.json']),
      (error) => error && error.code === 'MCP_FILE_ACCESS_BLOCKED',
    );
  });
});

test('parseMirrorSyncFlags maps default state paths into the workspace in MCP mode', () => {
  const parseMirrorSyncFlags = createParseMirrorSyncFlags(buildSyncParserDeps());

  withMcpMode(() => {
    const parsed = parseMirrorSyncFlags([
      'once',
      '--market-address',
      TEST_MARKET,
      '--polymarket-market-id',
      'poly-1',
      '--paper',
    ]);
    const mirrorDir = path.join(process.cwd(), '.pandora', 'mirror');
    assert.ok(parsed.stateFile.startsWith(`${mirrorDir}${path.sep}`));
    assert.ok(parsed.killSwitchFile.startsWith(`${mirrorDir}${path.sep}`));
  });
});

test('parseMirrorSyncFlags blocks explicit file paths outside workspace in MCP mode', () => {
  const parseMirrorSyncFlags = createParseMirrorSyncFlags(buildSyncParserDeps());

  withMcpMode(() => {
    assert.throws(
      () => parseMirrorSyncFlags([
        'run',
        '--market-address',
        TEST_MARKET,
        '--polymarket-market-id',
        'poly-1',
        '--state-file',
        '/tmp/mirror-state.json',
      ]),
      (error) => error && error.code === 'MCP_FILE_ACCESS_BLOCKED',
    );

    assert.throws(
      () => parseMirrorSyncFlags([
        'run',
        '--market-address',
        TEST_MARKET,
        '--polymarket-market-id',
        'poly-1',
        '--kill-switch-file',
        '/tmp/mirror-stop',
      ]),
      (error) => error && error.code === 'MCP_FILE_ACCESS_BLOCKED',
    );
  });
});

test('parseMirrorSyncFlags validates all polymarket URL override flags', () => {
  const parseMirrorSyncFlags = createParseMirrorSyncFlags(buildSyncParserDeps());

  assert.throws(
    () => parseMirrorSyncFlags([
      'once',
      '--market-address',
      TEST_MARKET,
      '--polymarket-market-id',
      'poly-1',
      '--polymarket-gamma-url',
      'http://example.com/gamma',
    ]),
    (error) => error && error.code === 'INVALID_FLAG_VALUE',
  );
});

test('deployMirror rejects explicit empty --sources instead of silently falling back', async () => {
  await assert.rejects(
    () =>
      deployMirror({
        execute: false,
        sourcesProvided: true,
        sources: [''],
        planData: {
          schemaVersion: '1.0.0',
          sourceMarket: {
            marketId: 'poly-1',
            slug: 'poly-1',
            question: 'Will deterministic test pass?',
            closeTimestamp: Math.floor(Date.now() / 1000) + 3600,
          },
          rules: {
            proposedPandoraRules: 'Resolves YES if test passes. NO otherwise.',
          },
          liquidityRecommendation: {
            liquidityUsdc: 100,
          },
          distributionHint: {
            distributionYes: 500_000_000,
            distributionNo: 500_000_000,
          },
        },
      }),
    (error) => {
      assert.equal(error.code, 'MIRROR_SOURCES_REQUIRED');
      assert.match(error.message, /explicit independent resolution sources/i);
      return true;
    },
  );
});

test('mirror go reuses trusted manifest pair and skips deploy', async () => {
  let deployCalls = 0;
  let emittedPayload = null;

  await handleMirrorGo({
    shared: {
      rest: ['--polymarket-market-id', 'poly-1'],
      timeoutMs: 5000,
      indexerUrl: 'https://indexer.test',
    },
    context: { outputMode: 'json' },
    mirrorGoUsage: 'mirror go usage',
    deps: {
      CliError: TestCliError,
      includesHelpFlag: () => false,
      emitSuccess: (_mode, _command, payload) => {
        emittedPayload = payload;
      },
      commandHelpPayload: () => ({}),
      maybeLoadTradeEnv: () => null,
      resolveIndexerUrl: (url) => url,
      parseMirrorGoFlags: () => buildGoOptions(),
      buildMirrorPlan: async () => ({
        sourceMarket: { marketId: 'poly-1', slug: 'poly-slug-1' },
        planDigest: 'digest-1',
      }),
      deployMirror: async () => {
        deployCalls += 1;
        return null;
      },
      resolveTrustedDeployPair: () => {
        throw new Error('resolveTrustedDeployPair should not be called when trust manifest is already present.');
      },
      findMirrorPair: () => ({
        filePath: '/tmp/mirror-pairs.json',
        pair: {
          trusted: true,
          pandoraMarketAddress: TEST_MARKET,
          pandoraPollAddress: TEST_POLL,
        },
      }),
      defaultMirrorManifestFile: () => '/tmp/mirror-pairs.json',
      hasContractCodeAtAddress: async () => true,
      verifyMirror: async () => ({
        pandora: { marketAddress: TEST_MARKET, rules: 'rules' },
        sourceMarket: { description: 'source' },
        gateResult: { ok: true },
      }),
      runLivePolymarketPreflightForMirror: async () => ({ ok: true }),
      runMirrorSync: async () => ({ actionCount: 0 }),
      buildQuotePayload: async () => ({}),
      executeTradeOnchain: async () => ({}),
      assertLiveWriteAllowed: async () => null,
      renderMirrorSyncTickLine: () => null,
      coerceMirrorServiceError: (error) => error,
      renderMirrorGoTable: () => null,
    },
  });

  assert.equal(deployCalls, 0);
  assert.ok(emittedPayload);
  assert.equal(emittedPayload.deploy.pandora.marketAddress, TEST_MARKET);
  assert.equal(emittedPayload.deploy.trustManifest.filePath, '/tmp/mirror-pairs.json');
  assert.equal(emittedPayload.diagnostics.some((item) => /deploy step skipped/i.test(item)), true);
});

test('mirror go suggested sync command preserves flashbots routing flags', async () => {
  let emittedPayload = null;

  await handleMirrorGo({
    shared: {
      rest: ['--polymarket-market-id', 'poly-1'],
      timeoutMs: 5000,
      indexerUrl: 'https://indexer.test',
    },
    context: { outputMode: 'json' },
    mirrorGoUsage: 'mirror go usage',
    deps: {
      CliError: TestCliError,
      includesHelpFlag: () => false,
      emitSuccess: (_mode, _command, payload) => {
        emittedPayload = payload;
      },
      commandHelpPayload: () => ({}),
      maybeLoadTradeEnv: () => null,
      resolveIndexerUrl: (url) => url,
      parseMirrorGoFlags: () => buildGoOptions({
        executeLive: false,
        autoSync: false,
        rebalanceRoute: 'flashbots-bundle',
        rebalanceRouteFallback: 'public',
        flashbotsRelayUrl: 'https://relay.flashbots.example',
        flashbotsAuthKey: `0x${'1'.repeat(64)}`,
        flashbotsTargetBlockOffset: 3,
      }),
      buildMirrorPlan: async () => ({
        sourceMarket: { marketId: 'poly-1', slug: 'poly-slug-1' },
        planDigest: 'digest-1',
      }),
      deployMirror: async () => ({
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        pandora: {
          marketAddress: TEST_MARKET,
          pollAddress: TEST_POLL,
        },
      }),
      resolveTrustedDeployPair: () => {
        throw new Error('not used');
      },
      findMirrorPair: () => ({ filePath: '/tmp/mirror-pairs.json', pair: null }),
      defaultMirrorManifestFile: () => '/tmp/mirror-pairs.json',
      hasContractCodeAtAddress: async () => true,
      verifyMirror: async () => ({
        pandora: { marketAddress: TEST_MARKET, rules: 'rules' },
        sourceMarket: { description: 'source' },
        gateResult: { ok: true },
      }),
      runLivePolymarketPreflightForMirror: async () => ({ ok: true }),
      runMirrorSync: async () => {
        throw new Error('runMirrorSync should not be called when autoSync is false');
      },
      buildQuotePayload: async () => ({}),
      executeTradeOnchain: async () => ({}),
      assertLiveWriteAllowed: async () => null,
      renderMirrorSyncTickLine: () => null,
      coerceMirrorServiceError: (error) => error,
      renderMirrorGoTable: () => null,
    },
  });

  assert.ok(emittedPayload);
  assert.match(emittedPayload.suggestedSyncCommand, /--rebalance-route flashbots-bundle/);
  assert.match(emittedPayload.suggestedSyncCommand, /--rebalance-route-fallback public/);
  assert.match(emittedPayload.suggestedSyncCommand, /--flashbots-relay-url https:\/\/relay\.flashbots\.example/);
  assert.match(emittedPayload.suggestedSyncCommand, /--flashbots-auth-key 0x1{64}/);
  assert.match(emittedPayload.suggestedSyncCommand, /--flashbots-target-block-offset 3/);
  assert.doesNotMatch(emittedPayload.suggestedSyncCommand, /--no-hedge/);
});

test('mirror go preflight prefers --polymarket-rpc-url over main --rpc-url', async () => {
  let preflightInput = null;
  const rpc = await startRpcHealthServer();

  try {
    await handleMirrorGo({
      shared: {
        rest: ['--polymarket-market-id', 'poly-1'],
        timeoutMs: 5000,
        indexerUrl: 'https://indexer.test',
      },
      context: { outputMode: 'json' },
      mirrorGoUsage: 'mirror go usage',
      deps: {
        CliError: TestCliError,
        includesHelpFlag: () => false,
        emitSuccess: () => null,
        commandHelpPayload: () => ({}),
        maybeLoadTradeEnv: () => null,
        resolveIndexerUrl: (url) => url,
        parseMirrorGoFlags: () =>
          buildGoOptions({
            autoSync: true,
            syncOnce: true,
            polymarketRpcUrl: rpc.url,
            rpcUrl: 'https://ethereum-rpc.example',
          }),
        buildMirrorPlan: async () => ({
          sourceMarket: { marketId: 'poly-1', slug: 'poly-slug-1' },
          planDigest: 'digest-1',
        }),
        deployMirror: async () => ({
          schemaVersion: '1.0.0',
          generatedAt: new Date().toISOString(),
          pandora: {
            marketAddress: TEST_MARKET,
            pollAddress: TEST_POLL,
          },
        }),
        resolveTrustedDeployPair: () => {
          throw new Error('resolveTrustedDeployPair should not be called in this test.');
        },
        findMirrorPair: () => ({ filePath: '/tmp/mirror-pairs.json', pair: null }),
        defaultMirrorManifestFile: () => '/tmp/mirror-pairs.json',
        hasContractCodeAtAddress: async () => true,
        verifyMirror: async () => ({
          pandora: { marketAddress: TEST_MARKET, rules: 'rules' },
          sourceMarket: { description: 'source' },
          gateResult: { ok: true },
        }),
        runLivePolymarketPreflightForMirror: async (input) => {
          preflightInput = input;
          return { ok: true };
        },
        runMirrorSync: async () => ({
          schemaVersion: '1.0.0',
          generatedAt: new Date().toISOString(),
          mode: 'once',
          executeLive: true,
          actionCount: 0,
        }),
        buildQuotePayload: async () => ({}),
        executeTradeOnchain: async () => ({}),
        assertLiveWriteAllowed: async () => null,
        renderMirrorSyncTickLine: () => null,
        coerceMirrorServiceError: (error) => error,
        renderMirrorGoTable: () => null,
      },
    });

    assert.ok(preflightInput);
    assert.equal(preflightInput.rpcUrl, rpc.url);
    assert.equal(preflightInput.polymarketRpcUrl, rpc.url);
  } finally {
    await rpc.close();
  }
});

test('mirror go surfaces MIRROR_GO_VERIFY_PENDING when deploy succeeded but verify lags', async () => {
  await assert.rejects(
    () =>
      handleMirrorGo({
        shared: {
          rest: ['--polymarket-market-id', 'poly-1'],
          timeoutMs: 5000,
          indexerUrl: 'https://indexer.test',
        },
        context: { outputMode: 'json' },
        mirrorGoUsage: 'mirror go usage',
        deps: {
          CliError: TestCliError,
          includesHelpFlag: () => false,
          emitSuccess: () => null,
          commandHelpPayload: () => ({}),
          maybeLoadTradeEnv: () => null,
          resolveIndexerUrl: (url) => url,
          parseMirrorGoFlags: () => buildGoOptions(),
          buildMirrorPlan: async () => ({
            sourceMarket: { marketId: 'poly-1', slug: 'poly-slug-1' },
            planDigest: 'digest-1',
          }),
          deployMirror: async () => ({
            schemaVersion: '1.0.0',
            generatedAt: new Date().toISOString(),
            pandora: {
              marketAddress: TEST_MARKET,
              pollAddress: TEST_POLL,
            },
            trustManifest: {
              filePath: '/tmp/mirror-pairs.json',
              pair: {
                trusted: true,
                pandoraMarketAddress: TEST_MARKET,
                pandoraPollAddress: TEST_POLL,
              },
            },
          }),
          resolveTrustedDeployPair: () => ({
            manifestFile: '/tmp/mirror-pairs.json',
            trustPair: {
              trusted: true,
              pandoraMarketAddress: TEST_MARKET,
              pandoraPollAddress: TEST_POLL,
            },
          }),
          findMirrorPair: () => ({ filePath: '/tmp/mirror-pairs.json', pair: null }),
          defaultMirrorManifestFile: () => '/tmp/mirror-pairs.json',
          hasContractCodeAtAddress: async () => true,
          verifyMirror: async () => {
            throw new Error(`Pandora market not found: ${TEST_MARKET}`);
          },
          runLivePolymarketPreflightForMirror: async () => ({ ok: true }),
          runMirrorSync: async () => ({ actionCount: 0 }),
          buildQuotePayload: async () => ({}),
          executeTradeOnchain: async () => ({}),
          assertLiveWriteAllowed: async () => null,
          renderMirrorSyncTickLine: () => null,
          coerceMirrorServiceError: (error) => error,
          renderMirrorGoTable: () => null,
        },
      }),
    (error) => {
      assert.equal(error.code, 'MIRROR_GO_VERIFY_PENDING');
      assert.match(error.message, /Do not rerun mirror go --execute-live/i);
      assert.equal(error.details.pandoraMarketAddress, TEST_MARKET);
      return true;
    },
  );
});

test('error recovery maps mirror verify-pending failures to mirror verify command', () => {
  const service = createErrorRecoveryService({ cliName: 'pandora' });
  const recovery = service.getRecoveryForError({
    code: 'MIRROR_GO_VERIFY_PENDING',
    details: {
      pandoraMarketAddress: TEST_MARKET,
      polymarketMarketId: 'poly-1',
      manifestFile: '/tmp/mirror-pairs.json',
    },
  });
  assert.ok(recovery);
  assert.equal(recovery.retryable, true);
  assert.match(recovery.command, /mirror verify/);
  assert.match(recovery.command, /--market-address 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.match(recovery.command, /--polymarket-market-id poly-1/);
  assert.match(recovery.command, /--trust-deploy/);
  assert.match(recovery.command, /--manifest-file \/tmp\/mirror-pairs\.json/);
});
