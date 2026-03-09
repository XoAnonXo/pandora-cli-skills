const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createRunDashboardCommand,
} = require('../../cli/lib/dashboard_fund_service.cjs');

class TestCliError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'TestCliError';
    this.code = code;
    this.details = details;
  }
}

function createDashboardContext(overrides = {}) {
  return {
    strategyHash: overrides.strategyHash || 'alpha',
    stateFile: overrides.stateFile || `/tmp/${overrides.strategyHash || 'alpha'}.json`,
    selector: overrides.selector || {
      pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      polymarketMarketId: 'poly-alpha',
      polymarketSlug: 'alpha',
    },
    state: {
      strategyHash: overrides.strategyHash || 'alpha',
      pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      polymarketMarketId: 'poly-alpha',
      polymarketSlug: 'alpha',
      alerts: [],
      currentHedgeUsdc: 0,
      cumulativeLpFeesApproxUsdc: 0,
      cumulativeHedgeCostApproxUsdc: 0,
      ...(overrides.state || {}),
    },
    daemonStatus: overrides.daemonStatus || null,
  };
}

test('runDashboardCommand emits live mirror summary with suggested next commands', async () => {
  const verifyCalls = [];
  const emitted = [];
  let maybeLoadIndexerEnvCalls = 0;
  let maybeLoadTradeEnvCalls = 0;

  const runDashboardCommand = createRunDashboardCommand({
    CliError: TestCliError,
    includesHelpFlag: () => false,
    emitSuccess: (mode, command, payload) => {
      emitted.push({ mode, command, payload });
    },
    commandHelpPayload: (usage, notes) => ({ usage, notes }),
    parseIndexerSharedFlags: () => ({
      indexerUrl: 'https://indexer.test',
      timeoutMs: 4321,
      rest: [],
    }),
    maybeLoadIndexerEnv: () => {
      maybeLoadIndexerEnvCalls += 1;
    },
    maybeLoadTradeEnv: () => {
      maybeLoadTradeEnvCalls += 1;
    },
    resolveIndexerUrl: (value) => value,
    resolveTrustedDeployPair: () => null,
    loadMirrorDashboardContexts: () => [
      createDashboardContext({
        strategyHash: 'alpha',
        selector: {
          pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          polymarketMarketId: 'poly-alpha',
          polymarketSlug: 'alpha',
        },
      }),
      createDashboardContext({
        strategyHash: 'beta',
        selector: {
          pandoraMarketAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          polymarketMarketId: 'poly-beta',
          polymarketSlug: 'beta',
        },
      }),
    ],
    buildMirrorRuntimeTelemetry: ({ state }) => ({
      health: {
        status: state.strategyHash === 'beta' ? 'blocked' : 'running',
      },
      daemon: {
        alive: state.strategyHash !== 'beta',
      },
      alerts: [],
      pendingAction: null,
      lastAction: null,
      lastError: null,
    }),
    verifyMirror: async (options) => {
      verifyCalls.push(options);
      return {
        sourceMarket: {
          question: options.polymarketMarketId === 'poly-beta' ? 'Beta question' : 'Alpha question',
        },
        pandora: {
          question: options.polymarketMarketId === 'poly-beta' ? 'Beta question' : 'Alpha question',
        },
      };
    },
    toMirrorStatusLivePayload: async (verifyPayload, state) => ({
      sourceMarket: { question: verifyPayload.sourceMarket.question, source: 'polymarket:live' },
      pandoraMarket: { question: verifyPayload.pandora.question, yesPct: 52, noPct: 48 },
      driftBps: state.strategyHash === 'beta' ? 220 : 15,
      driftTriggerBps: 150,
      driftTriggered: state.strategyHash === 'beta',
      hedgeStatus: {
        rebalanceSide: state.strategyHash === 'beta' ? 'yes' : 'no',
        hedgeSide: state.strategyHash === 'beta' ? 'yes' : null,
      },
      targetHedgeUsdc: state.strategyHash === 'beta' ? 25 : 0,
      currentHedgeUsdc: 0,
      hedgeGapUsdc: state.strategyHash === 'beta' ? 25 : 0,
      hedgeTriggerUsdc: 10,
      hedgeTriggered: state.strategyHash === 'beta',
      netPnlApproxUsdc: state.strategyHash === 'beta' ? -3 : 2,
      pnlApprox: state.strategyHash === 'beta' ? -1 : 4,
      reserveTotalUsdc: 100,
      crossVenue: { status: state.strategyHash === 'beta' ? 'rebalance-needed' : 'aligned' },
      actionability: {
        status: state.strategyHash === 'beta' ? 'action-needed' : 'monitor',
        recommendedAction: state.strategyHash === 'beta' ? 'hedge-now' : 'monitor',
      },
      verifyDiagnostics: [],
      actionableDiagnostics: [],
      polymarketPosition: { diagnostics: [] },
    }),
  });

  await runDashboardCommand([], { outputMode: 'json' });

  assert.equal(maybeLoadIndexerEnvCalls, 1);
  assert.equal(maybeLoadTradeEnvCalls, 1);
  assert.equal(verifyCalls.length, 2);
  assert.equal(verifyCalls[0].indexerUrl, 'https://indexer.test');
  assert.equal(verifyCalls[0].timeoutMs, 4321);

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].command, 'dashboard');
  assert.equal(emitted[0].payload.summary.marketCount, 2);
  assert.equal(emitted[0].payload.summary.liveCount, 2);
  assert.equal(emitted[0].payload.summary.actionNeededCount, 1);
  assert.deepEqual(
    emitted[0].payload.items[1].suggestedNextCommands,
    [
      'pandora mirror status --strategy-hash beta --with-live',
      'pandora mirror sync status --strategy-hash beta',
    ],
  );
  assert.deepEqual(
    emitted[0].payload.suggestedNextCommands,
    [
      'pandora mirror status --strategy-hash beta --with-live',
      'pandora mirror sync status --strategy-hash beta',
    ],
  );
});
