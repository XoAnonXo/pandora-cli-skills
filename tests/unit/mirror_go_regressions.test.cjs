const test = require('node:test');
const assert = require('node:assert/strict');

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

function buildGoOptions(overrides = {}) {
  return {
    polymarketMarketId: 'poly-1',
    polymarketSlug: null,
    liquidityUsdc: 100,
    feeTier: 3000,
    maxImbalance: 10_000,
    category: 3,
    arbiter: null,
    paper: false,
    executeLive: true,
    autoSync: false,
    syncOnce: false,
    syncIntervalMs: 5000,
    driftTriggerBps: 150,
    hedgeTriggerUsdc: 10,
    hedgeRatio: 1,
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
    'https://polygon-bor-rpc.publicnode.com',
  ]);
  assert.equal(parsed.polymarketRpcUrl, 'https://polygon-bor-rpc.publicnode.com');

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
      assert.equal(error.code, 'INVALID_FLAG_VALUE');
      assert.match(error.message, /at least two non-empty URLs/);
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

test('mirror go preflight prefers --polymarket-rpc-url over main --rpc-url', async () => {
  let preflightInput = null;

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
          polymarketRpcUrl: 'https://polygon-rpc.example',
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
  assert.equal(preflightInput.rpcUrl, 'https://polygon-rpc.example');
  assert.equal(preflightInput.polymarketRpcUrl, 'https://polygon-rpc.example');
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
