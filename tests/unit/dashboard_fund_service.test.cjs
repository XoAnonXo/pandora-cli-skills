const test = require('node:test');
const assert = require('node:assert/strict');

const { createRunDashboardCommand } = require('../../cli/lib/dashboard_fund_service.cjs');

class TestCliError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'TestCliError';
    this.code = code;
    this.details = details;
  }
}

function createDashboardDeps(overrides = {}) {
  return {
    CliError: TestCliError,
    includesHelpFlag: () => false,
    emitSuccess: () => {},
    commandHelpPayload: (usage, notes) => ({ usage, notes }),
    parseIndexerSharedFlags: (args) => ({
      rest: args,
      indexerUrl: 'https://indexer.example',
      timeoutMs: 5_000,
      envFile: null,
      envFileExplicit: false,
      useEnvFile: false,
    }),
    maybeLoadIndexerEnv: () => {},
    maybeLoadTradeEnv: () => {},
    resolveIndexerUrl: (value) => value || 'https://indexer.example',
    resolveTrustedDeployPair: () => {},
    verifyMirror: async () => ({
      sourceMarket: {
        marketId: 'poly-alpha',
        question: 'Alpha market',
      },
      pandora: {
        marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    }),
    toMirrorStatusLivePayload: async () => ({
      crossVenue: { status: 'attention' },
      actionability: { status: 'action-needed', recommendedAction: 'rebalance-yes' },
      netPnlApproxUsdc: 1.5,
      pnlApprox: 1.5,
      driftBps: 200,
      driftTriggerBps: 150,
      hedgeGapUsdc: 3,
      hedgeTriggerUsdc: 10,
      hedgeStatus: { hedgeGapUsdc: 3, triggered: false },
      sourceMarket: { marketId: 'poly-alpha', question: 'Alpha market' },
      pandoraMarket: { marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    }),
    loadMirrorDashboardContexts: () => [
      {
        strategyHash: 'alpha-hash',
        stateFile: '/tmp/alpha.json',
        selector: {
          pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          polymarketMarketId: 'poly-alpha',
        },
        state: {
          strategyHash: 'alpha-hash',
          pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          polymarketMarketId: 'poly-alpha',
          alerts: [],
        },
        daemonStatus: null,
      },
    ],
    discoverOwnedMarkets: async () => ({
      wallet: '0x1111111111111111111111111111111111111111',
      walletSource: 'flag',
      chainId: 1,
      count: 1,
      exposureCounts: { token: 0, lp: 1, claimable: 1 },
      items: [
        {
          marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          question: 'Alpha market',
          hasClaimableExposure: true,
          exposure: {
            claimable: {
              estimatedClaimUsdc: '3.5',
              pollFinalized: true,
              pollAnswer: 'yes',
            },
          },
          diagnostics: [],
        },
      ],
      diagnostics: [],
    }),
    readPandoraWalletBalances: async () => ({
      enabled: true,
      walletAddress: '0x1111111111111111111111111111111111111111',
      chainId: 1,
      rpcUrl: 'https://ethereum.example',
      usdcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      nativeBalance: 0.42,
      usdcBalance: 11.25,
      diagnostics: [],
    }),
    runPolymarketBalance: async () => ({
      requestedWallet: '0x1111111111111111111111111111111111111111',
      runtime: {
        rpcUrl: 'https://polygon.example',
        signerAddress: '0x1111111111111111111111111111111111111111',
        funderAddress: '0x2222222222222222222222222222222222222222',
        ownerAddress: '0x2222222222222222222222222222222222222222',
      },
      balances: {
        wallet: { ok: true, formatted: '4.25' },
        signer: { ok: true, formatted: '4.25' },
        funder: { ok: true, formatted: '5.75' },
        owner: { ok: true, formatted: '5.75' },
      },
      diagnostics: [],
    }),
    sleepMs: async () => {},
    ...overrides,
  };
}

test('dashboard watch mode emits stable JSON snapshots with portfolio rollups', async () => {
  const observed = [];
  const runDashboardCommand = createRunDashboardCommand(createDashboardDeps({
    emitSuccess: (...args) => observed.push(args),
  }));

  await runDashboardCommand(
    ['--watch', '--iterations', '2', '--refresh-ms', '1', '--wallet', '0x1111111111111111111111111111111111111111', '--no-live'],
    { outputMode: 'json' },
  );

  assert.equal(observed.length, 1);
  assert.equal(observed[0][1], 'dashboard');
  const payload = observed[0][2];
  assert.equal(payload.watch.enabled, true);
  assert.equal(payload.watch.count, 2);
  assert.equal(payload.snapshots.length, 2);
  assert.equal(payload.summary.marketCount, 1);
  assert.deepEqual(payload.suggestedNextCommands, [
    'pandora mirror status --strategy-hash alpha-hash',
    'pandora mirror sync status --strategy-hash alpha-hash',
  ]);
  assert.equal(payload.portfolio.active.marketCount, 1);
  assert.equal(payload.portfolio.claimable.marketCount, 1);
  assert.equal(payload.portfolio.claimable.estimatedClaimUsdcTotal, 3.5);
  assert.equal(payload.portfolio.liquidCapital.pandora.usdcBalance, 11.25);
  assert.equal(payload.portfolio.liquidCapital.polymarket.totalDistinctUsdc, 10);
  assert.equal(payload.portfolio.liquidCapital.totalDistinctUsdc, 21.25);
});

test('dashboard watch mode in JSON requires explicit iterations', async () => {
  const runDashboardCommand = createRunDashboardCommand(createDashboardDeps());

  await assert.rejects(
    () => runDashboardCommand(['--watch', '--no-live'], { outputMode: 'json' }),
    (error) => {
      assert.equal(error.code, 'MISSING_REQUIRED_FLAG');
      assert.match(error.message, /requires --iterations <n>/);
      return true;
    },
  );
});
