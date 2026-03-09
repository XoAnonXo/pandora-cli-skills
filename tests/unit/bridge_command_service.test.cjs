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

test('bridge plan returns explicit Ethereum -> Polygon assumptions and manual next steps', async () => {
  const observed = [];
  const runBridgeCommand = createRunBridgeCommand({
    CliError: TestCliError,
    includesHelpFlag: (args) => Array.isArray(args) && args.includes('--help'),
    emitSuccess: (...args) => observed.push(args),
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
  });

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
