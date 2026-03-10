const test = require('node:test');
const assert = require('node:assert/strict');

const { createRunBridgeCommand } = require('../../cli/lib/bridge_command_service.cjs');
const { createRunFundCheckCommand } = require('../../cli/lib/fund_check_command_service.cjs');

class TestCliError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'TestCliError';
    this.code = code;
    this.details = details;
  }
}

function createBridgeCommandDeps(overrides = {}) {
  return {
    CliError: TestCliError,
    includesHelpFlag: (args) => Array.isArray(args) && args.includes('--help'),
    emitSuccess: (...args) => overrides.observed.push(args),
    commandHelpPayload: (usage, notes) => ({ usage, notes }),
    parseIndexerSharedFlags: (args) => ({
      rest: args,
      timeoutMs: 5_000,
      envFile: null,
      envFileExplicit: false,
      useEnvFile: false,
    }),
    maybeLoadTradeEnv: () => {},
    runPolymarketBalance: async () => ({
      requestedWallet: '0x1111111111111111111111111111111111111111',
      runtime: {
        rpcUrl: 'https://polygon.example',
        signerAddress: '0x1111111111111111111111111111111111111111',
        ownerAddress: '0x2222222222222222222222222222222222222222',
        funderAddress: '0x2222222222222222222222222222222222222222',
      },
      balances: {},
      diagnostics: [],
    }),
    readPandoraWalletBalances: async ({ chainId }) => (
      chainId === 1
        ? {
            enabled: true,
            walletAddress: '0x1111111111111111111111111111111111111111',
            nativeBalance: 0.12,
            usdcBalance: 25,
            diagnostics: [],
          }
        : {
            enabled: true,
            walletAddress: '0x1111111111111111111111111111111111111111',
            nativeBalance: 3,
            usdcBalance: 2,
            diagnostics: [],
          }
    ),
    ...overrides,
  };
}

test('bridge plan returns explicit Ethereum -> Polygon assumptions and manual next steps', async () => {
  const observed = [];
  const runBridgeCommand = createRunBridgeCommand(createBridgeCommandDeps({ observed }));

  await runBridgeCommand(
    ['plan', '--target', 'polymarket', '--amount-usdc', '10', '--wallet', '0x1111111111111111111111111111111111111111'],
    { outputMode: 'json' },
  );

  assert.equal(observed.length, 1);
  assert.equal(observed[0][1], 'bridge.plan');
  const payload = observed[0][2];
  assert.equal(payload.route.source.chain.name, 'Ethereum');
  assert.equal(payload.route.destination.chain.name, 'Polygon');
  assert.equal(payload.route.source.token.symbol, 'USDC');
  assert.equal(payload.route.destination.token.symbol, 'USDC.e');
  assert.equal(payload.bridge.requiredAmountUsdc, 8);
  assert.equal(payload.bridge.sourceShortfallUsdc, 0);
  assert.equal(payload.suggestions.some((item) => item.command === 'pandora polymarket deposit --amount-usdc 10'), true);
});

test('bridge execute dry-run returns LayerZero preflight, quote data, and an execution plan', async () => {
  const observed = [];
  let quoteRequest = null;
  const runBridgeCommand = createRunBridgeCommand(createBridgeCommandDeps({
    observed,
    quoteLayerZeroBridge: async (request) => {
      quoteRequest = request;
      return {
        quoteId: 'lz-quote-1',
        estimatedBridgeAmountUsdc: request.requiredBridgeAmountUsdc,
        estimatedReceiveAmountUsdc: 7.82,
        minReceiveAmountUsdc: 7.7,
        estimatedFeeNative: 0.00123,
        estimatedFeeUsd: 2.11,
        estimatedCompletionSeconds: 180,
      };
    },
  }));

  await runBridgeCommand(
    ['execute', '--target', 'polymarket', '--amount-usdc', '10', '--wallet', '0x1111111111111111111111111111111111111111', '--dry-run'],
    { outputMode: 'json' },
  );

  assert.equal(observed.length, 1);
  assert.equal(observed[0][1], 'bridge.execute');
  const payload = observed[0][2];
  assert.equal(payload.mode, 'dry-run');
  assert.equal(payload.status, 'planned');
  assert.equal(payload.provider, 'layerzero');
  assert.equal(payload.preflight.status, 'ready');
  assert.equal(payload.preflight.quoteAvailable, true);
  assert.equal(payload.executionPlan.executeFlagRequired, '--execute');
  assert.equal(payload.providerQuote.quoteId, 'lz-quote-1');
  assert.equal(payload.providerQuote.estimatedReceiveAmountUsdc, 7.82);
  assert.equal(payload.suggestions.some((item) => item.id === 'bridge-submit-layerzero'), true);
  assert.ok(quoteRequest);
  assert.equal(quoteRequest.provider, 'layerzero');
  assert.equal(quoteRequest.source.chainId, 1);
  assert.equal(quoteRequest.destination.chainId, 137);
  assert.equal(quoteRequest.requiredBridgeAmountUsdc, 8);
});

test('bridge execute submits a mocked LayerZero request after preflight passes', async () => {
  const observed = [];
  const guardCalls = [];
  let executeRequest = null;
  const runBridgeCommand = createRunBridgeCommand(createBridgeCommandDeps({
    observed,
    assertLiveWriteAllowed: async (scope, details) => {
      guardCalls.push({ scope, details });
    },
    quoteLayerZeroBridge: async (request) => ({
      quoteId: 'lz-quote-2',
      estimatedBridgeAmountUsdc: request.requiredBridgeAmountUsdc,
      estimatedReceiveAmountUsdc: 7.8,
      estimatedFeeNative: 0.00111,
      estimatedFeeUsd: 1.98,
    }),
    executeLayerZeroBridge: async (request) => {
      executeRequest = request;
      return {
        status: 'submitted',
        txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        messageId: 'lz-msg-1',
        chainId: 1,
        estimatedBridgeAmountUsdc: request.requiredBridgeAmountUsdc,
        estimatedReceiveAmountUsdc: 7.8,
        estimatedFeeNative: 0.00111,
        estimatedFeeUsd: 1.98,
      };
    },
  }));

  await runBridgeCommand(
    ['execute', '--target', 'polymarket', '--amount-usdc', '10', '--wallet', '0x1111111111111111111111111111111111111111', '--execute'],
    { outputMode: 'json' },
  );

  assert.equal(observed.length, 1);
  const payload = observed[0][2];
  assert.equal(payload.mode, 'execute');
  assert.equal(payload.status, 'submitted');
  assert.equal(payload.preflight.status, 'ready');
  assert.equal(payload.execution.provider, 'layerzero');
  assert.equal(payload.execution.txHash, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(payload.execution.messageId, 'lz-msg-1');
  assert.equal(guardCalls.length, 1);
  assert.equal(guardCalls[0].scope, 'bridge.execute');
  assert.equal(guardCalls[0].details.notionalUsdc, 8);
  assert.ok(executeRequest);
  assert.equal(executeRequest.provider, 'layerzero');
  assert.equal(executeRequest.timeoutMs, 5000);
});

test('bridge execute rejects unsupported providers', async () => {
  const observed = [];
  const runBridgeCommand = createRunBridgeCommand(createBridgeCommandDeps({ observed }));

  await assert.rejects(
    runBridgeCommand(
      ['execute', '--target', 'polymarket', '--amount-usdc', '10', '--wallet', '0x1111111111111111111111111111111111111111', '--dry-run', '--provider', 'wormhole'],
      { outputMode: 'json' },
    ),
    (error) => {
      assert.equal(error.code, 'INVALID_FLAG_VALUE');
      assert.match(error.message, /--provider must be layerzero/i);
      return true;
    },
  );
});

test('bridge execute blocks live submission when the source wallet is short', async () => {
  const observed = [];
  let executeCalls = 0;
  const runBridgeCommand = createRunBridgeCommand(createBridgeCommandDeps({
    observed,
    readPandoraWalletBalances: async ({ chainId }) => (
      chainId === 1
        ? {
            enabled: true,
            walletAddress: '0x1111111111111111111111111111111111111111',
            nativeBalance: 0.12,
            usdcBalance: 3,
            diagnostics: [],
          }
        : {
            enabled: true,
            walletAddress: '0x1111111111111111111111111111111111111111',
            nativeBalance: 3,
            usdcBalance: 2,
            diagnostics: [],
          }
    ),
    executeLayerZeroBridge: async () => {
      executeCalls += 1;
      return { txHash: '0xbb' };
    },
  }));

  await assert.rejects(
    runBridgeCommand(
      ['execute', '--target', 'polymarket', '--amount-usdc', '10', '--wallet', '0x1111111111111111111111111111111111111111', '--execute'],
      { outputMode: 'json' },
    ),
    (error) => {
      assert.equal(error.code, 'BRIDGE_PREFLIGHT_FAILED');
      assert.equal(error.details.preflight.status, 'blocked');
      assert.match(error.details.preflight.blockers.join('\n'), /Source wallet is short/i);
      return true;
    },
  );

  assert.equal(executeCalls, 0);
});

test('fund-check recommends bridge planning when Ethereum-side liquidity can cover the Polygon shortfall', async () => {
  const observed = [];
  const runFundCheckCommand = createRunFundCheckCommand({
    CliError: TestCliError,
    includesHelpFlag: () => false,
    emitSuccess: (...args) => observed.push(args),
    commandHelpPayload: (usage, notes) => ({ usage, notes }),
    maybeLoadIndexerEnv: () => {},
    maybeLoadTradeEnv: () => {},
    resolveIndexerUrl: (value) => value || 'https://indexer.example',
    resolveTrustedDeployPair: () => {},
    verifyMirror: async () => ({
      pandora: {
        usdcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      },
    }),
    coerceMirrorServiceError: (error) => error,
    toMirrorStatusLivePayload: async () => ({
      sourceMarket: { yesPct: 55 },
      hedgeGapUsdc: 7,
      actionability: { status: 'monitor', recommendedAction: 'monitor' },
      crossVenue: { status: 'ready' },
    }),
    runPolymarketBalance: async () => ({
      balances: {
        owner: { formatted: '0' },
      },
      diagnostics: [],
    }),
    runPolymarketCheck: async () => ({
      readyForLive: true,
      diagnostics: [],
      runtime: {
        signerAddress: '0x1111111111111111111111111111111111111111',
        ownerAddress: '0x2222222222222222222222222222222222222222',
        funderAddress: '0x2222222222222222222222222222222222222222',
      },
      approvals: { missingCount: 0 },
    }),
    parseAddressFlag: (value) => value,
    parsePrivateKeyFlag: (value) => value,
    parsePositiveInteger: (value) => Number(value),
    parseInteger: (value) => Number(value),
    parseProbabilityPercent: (value) => Number(value),
    resolveSignerAddress: async () => ({
      address: '0x1111111111111111111111111111111111111111',
      source: 'flag-private-key',
      privateKey: '0x1111111111111111111111111111111111111111111111111111111111111111',
      diagnostics: [],
    }),
    readVenueBalances: async () => ({
      nativeBalance: 0.5,
      usdcBalance: 20,
      diagnostics: [],
    }),
  });

  await runFundCheckCommand(
    ['--market-address', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '--polymarket-market-id', 'poly-alpha', '--private-key', '0x1111111111111111111111111111111111111111111111111111111111111111'],
    { outputMode: 'json' },
  );

  assert.equal(observed.length, 1);
  const payload = observed[0][2];
  const bridgeSuggestion = payload.suggestions.find((item) => item.id === 'bridge-plan-polymarket');
  assert.ok(bridgeSuggestion);
  assert.match(bridgeSuggestion.command, /pandora bridge plan --target polymarket --amount-usdc 7/);
});
