const test = require('node:test');
const assert = require('node:assert/strict');

const { deployMirror } = require('../../cli/lib/mirror_service.cjs');
const handleMirrorSync = require('../../cli/lib/mirror_handlers/sync.cjs');
const { buildSportsCreatePlan, buildSportsCreateRunPayload } = require('../../cli/lib/sports_creation_service.cjs');
const { buildSyncStatusPayload } = require('../../cli/lib/sports_sync_service.cjs');

const FUTURE_TS = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

function buildMirrorPlanData(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    sourceMarket: {
      marketId: 'poly-1',
      slug: 'pistons-vs-nets',
      question: 'Will the Detroit Pistons beat the Brooklyn Nets?',
      description: 'This market resolves to Detroit Pistons.',
      closeTimestamp: FUTURE_TS,
      ...((overrides && overrides.sourceMarket) || {}),
    },
    rules: {
      sourceRules: 'This market resolves to Detroit Pistons.',
      proposedPandoraRules: 'This market resolves to Detroit Pistons.',
      ...((overrides && overrides.rules) || {}),
    },
    liquidityRecommendation: {
      liquidityUsdc: 100,
      ...((overrides && overrides.liquidityRecommendation) || {}),
    },
    distributionHint: {
      distributionYes: 500_000_000,
      distributionNo: 500_000_000,
      ...((overrides && overrides.distributionHint) || {}),
    },
  };
}

function buildSportsInput(overrides = {}) {
  return {
    event: {
      id: 'evt-1',
      homeTeam: 'Arsenal',
      awayTeam: 'Chelsea',
      status: 'scheduled',
      startTime: '2026-04-01T18:00:00.000Z',
      ...((overrides && overrides.event) || {}),
    },
    oddsPayload: {
      event: {
        id: 'evt-1',
        homeTeam: 'Arsenal',
        awayTeam: 'Chelsea',
        startTime: '2026-04-01T18:00:00.000Z',
      },
      books: [
        { book: 'Bet365', outcomes: { home: 2.0, draw: 3.2, away: 3.8 } },
        { book: 'William Hill', outcomes: { home: 2.1, draw: 3.1, away: 3.7 } },
        { book: 'Ladbrokes', outcomes: { home: 2.05, draw: 3.3, away: 3.9 } },
      ],
      preferredBooks: ['bet365', 'williamhill', 'ladbrokes'],
      ...((overrides && overrides.oddsPayload) || {}),
    },
    options: {
      selection: 'home',
      nowMs: Date.parse('2026-03-31T18:00:00.000Z'),
      minTotalBooks: 2,
      minTier1Books: 2,
      trimPercent: 20,
      marketType: 'amm',
      ...((overrides && overrides.options) || {}),
    },
    ...overrides,
  };
}

test('deployMirror surfaces hook-created operationId and emits lifecycle checkpoints', async () => {
  const hookCalls = [];

  const payload = await deployMirror({
    execute: false,
    sources: ['https://www.nba.com', 'https://www.espn.com'],
    planData: buildMirrorPlanData(),
    operationHooks: {
      createOperation: async (details) => {
        hookCalls.push(['create', details.phase]);
        return { operationId: 'mirror-op-1' };
      },
      emitCheckpoint: async (details) => {
        hookCalls.push(['checkpoint', details.phase, details.operationId]);
      },
      completeOperation: async (details) => {
        hookCalls.push(['complete', details.status, details.operationId, details.marketAddress]);
      },
    },
  });

  assert.equal(payload.operationId, 'mirror-op-1');
  assert.ok(hookCalls.some((entry) => entry[0] === 'checkpoint' && entry[1] === 'mirror.deploy.plan.ready'));
  assert.ok(hookCalls.some((entry) => entry[0] === 'checkpoint' && entry[1] === 'mirror.deploy.execution.complete'));
  assert.ok(hookCalls.some((entry) => entry[0] === 'complete' && entry[2] === 'mirror-op-1'));
});

test('sports create helpers reuse operation ids across plan and run payloads', () => {
  const hookCalls = [];
  const hooks = {
    createOperation: (details) => {
      hookCalls.push(['create', details.phase]);
      return 'sports-op-1';
    },
    updateOperation: (details) => {
      hookCalls.push(['update', details.phase, details.operationId, details.status]);
    },
    completeOperation: (details) => {
      hookCalls.push(['complete', details.phase, details.operationId, details.mode || null]);
    },
  };

  const plan = buildSportsCreatePlan({
    ...buildSportsInput(),
    operationHooks: hooks,
  });
  const runPayload = buildSportsCreateRunPayload({
    plan,
    mode: 'execute',
    deployment: {
      pandora: {
        marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    },
    operationHooks: hooks,
  });

  assert.equal(plan.operationId, 'sports-op-1');
  assert.equal(runPayload.operationId, 'sports-op-1');
  assert.ok(hookCalls.some((entry) => entry[0] === 'update' && entry[1] === 'sports.create.plan.complete'));
  assert.ok(hookCalls.some((entry) => entry[0] === 'complete' && entry[1] === 'sports.create.run.complete'));
});

test('sports create helpers fall back to deterministic operation ids when create hook returns no id', () => {
  const hookCalls = [];
  const hooks = {
    createOperation: (details) => {
      hookCalls.push(['create', details.phase]);
      return null;
    },
    updateOperation: (details) => {
      hookCalls.push(['update', details.phase, details.operationId, details.status]);
    },
  };

  const plan = buildSportsCreatePlan({
    ...buildSportsInput(),
    operationHooks: hooks,
  });
  const runPayload = buildSportsCreateRunPayload({
    plan,
    mode: 'dry-run',
    operationHooks: hooks,
  });

  assert.equal(plan.operationId, 'sports-create:evt-1:home');
  assert.equal(runPayload.operationId, 'sports-create:evt-1:home');
  assert.equal(hookCalls.filter((entry) => entry[0] === 'create').length, 1);
  assert.ok(Array.isArray(plan.diagnostics));
  assert.ok(plan.diagnostics.some((entry) => entry.includes('Create hook returned no operation id')));
  assert.equal(runPayload.operationDiagnostics, undefined);
  assert.ok(Array.isArray(runPayload.diagnostics));
  assert.ok(runPayload.diagnostics.some((entry) => entry.includes('Create hook returned no operation id')));
});

test('sports sync payload prefers hook-created operationId over strategyHash fallback', () => {
  const hookCalls = [];
  const payload = buildSyncStatusPayload('start', {
    found: true,
    alive: true,
    strategyHash: 'strategy-123',
    pidFile: '/tmp/sports-sync.json',
    operationHooks: {
      createOperation: (details) => {
        hookCalls.push(['create', details.phase]);
        return { operationId: 'sports-sync-op-1' };
      },
      updateOperation: (details) => {
        hookCalls.push(['update', details.phase, details.operationId, details.status]);
      },
    },
  });

  assert.equal(payload.operationId, 'sports-sync-op-1');
  assert.equal(payload.strategyHash, 'strategy-123');
  assert.ok(hookCalls.some((entry) => entry[0] === 'update' && entry[2] === 'sports-sync-op-1'));
});

test('mirror sync start keeps strategyHash but surfaces hook-created operationId', async () => {
  const hookCalls = [];
  const emitted = [];

  await handleMirrorSync({
    shared: {
      rest: ['start'],
      indexerUrl: 'https://indexer.example',
      timeoutMs: 5_000,
    },
    context: {
      outputMode: 'json',
      operationHooks: {
        createOperation: async (details) => {
          hookCalls.push(['create', details.phase]);
          return 'mirror-sync-op-1';
        },
        updateOperation: async (details) => {
          hookCalls.push(['update', details.phase, details.operationId, details.status]);
        },
      },
    },
    deps: {
      CliError: class CliError extends Error {},
      includesHelpFlag: () => false,
      emitSuccess: (_mode, command, payload) => {
        emitted.push({ command, payload });
      },
      maybeLoadTradeEnv: () => {},
      resolveIndexerUrl: (value) => value,
      parseMirrorSyncDaemonSelectorFlags: () => {
        throw new Error('not used');
      },
      stopMirrorDaemon: async () => {
        throw new Error('not used');
      },
      mirrorDaemonStatus: () => {
        throw new Error('not used');
      },
      parseMirrorSyncFlags: () => ({
        daemon: true,
        trustDeploy: false,
        executeLive: false,
        stateFile: '/tmp/mirror-state.json',
        killSwitchFile: '/tmp/mirror-stop',
        pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        polymarketMarketId: 'poly-1',
        polymarketSlug: null,
        forceGateDeprecatedUsed: false,
      }),
      buildMirrorSyncStrategy: () => ({ market: 'poly-1' }),
      mirrorStrategyHash: () => 'strategy-123',
      buildMirrorSyncDaemonCliArgs: () => ['mirror', 'sync', 'run'],
      startMirrorDaemon: () => ({
        strategyHash: 'strategy-123',
        pid: 12345,
        pidFile: '/tmp/mirror-state.json',
        logFile: '/tmp/mirror-sync.log',
        pidAlive: true,
        status: 'running',
        diagnostics: [],
      }),
      resolveTrustedDeployPair: () => {
        throw new Error('not used');
      },
      runLivePolymarketPreflightForMirror: async () => {
        throw new Error('not used');
      },
      runMirrorSync: async () => {
        throw new Error('not used');
      },
      buildQuotePayload: async () => {
        throw new Error('not used');
      },
      executeTradeOnchain: async () => {
        throw new Error('not used');
      },
      assertLiveWriteAllowed: async () => {},
      hasWebhookTargets: () => false,
      sendWebhookNotifications: async () => ({
        count: 0,
        successCount: 0,
        failureCount: 0,
        results: [],
      }),
      coerceMirrorServiceError: (error) => error,
      renderMirrorSyncTickLine: () => {},
      renderMirrorSyncDaemonTable: () => {},
      renderMirrorSyncTable: () => {},
      cliPath: '/usr/bin/node',
    },
    mirrorSyncUsage: 'pandora mirror sync start',
  });

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].command, 'mirror.sync.start');
  assert.equal(emitted[0].payload.operationId, 'mirror-sync-op-1');
  assert.equal(emitted[0].payload.strategyHash, 'strategy-123');
  assert.ok(hookCalls.some((entry) => entry[0] === 'update' && entry[2] === 'mirror-sync-op-1'));
});

test('mirror sync start uses strategyHash as checkpoint correlation id when no create hook exists', async () => {
  const hookCalls = [];

  await handleMirrorSync({
    shared: {
      rest: ['start'],
      indexerUrl: 'https://indexer.example',
      timeoutMs: 5_000,
    },
    context: {
      outputMode: 'json',
      operationHooks: {
        emitCheckpoint: async (details) => {
          hookCalls.push(['checkpoint', details.phase, details.operationId]);
        },
        updateOperation: async (details) => {
          hookCalls.push(['update', details.phase, details.operationId, details.status]);
        },
      },
    },
    deps: {
      CliError: class CliError extends Error {},
      includesHelpFlag: () => false,
      emitSuccess: () => {},
      maybeLoadTradeEnv: () => {},
      resolveIndexerUrl: (value) => value,
      parseMirrorSyncDaemonSelectorFlags: () => {
        throw new Error('not used');
      },
      stopMirrorDaemon: async () => {
        throw new Error('not used');
      },
      mirrorDaemonStatus: () => {
        throw new Error('not used');
      },
      parseMirrorSyncFlags: () => ({
        daemon: true,
        trustDeploy: false,
        executeLive: false,
        stateFile: '/tmp/mirror-state.json',
        killSwitchFile: '/tmp/mirror-stop',
        pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        polymarketMarketId: 'poly-1',
        polymarketSlug: null,
        forceGateDeprecatedUsed: false,
      }),
      buildMirrorSyncStrategy: () => ({ market: 'poly-1' }),
      mirrorStrategyHash: () => 'strategy-123',
      buildMirrorSyncDaemonCliArgs: () => ['mirror', 'sync', 'run'],
      startMirrorDaemon: () => ({
        strategyHash: 'strategy-123',
        pid: 12345,
        pidFile: '/tmp/mirror-state.json',
        logFile: '/tmp/mirror-sync.log',
        pidAlive: true,
        status: 'running',
        diagnostics: [],
      }),
      resolveTrustedDeployPair: () => {
        throw new Error('not used');
      },
      runLivePolymarketPreflightForMirror: async () => {
        throw new Error('not used');
      },
      runMirrorSync: async () => {
        throw new Error('not used');
      },
      buildQuotePayload: async () => {
        throw new Error('not used');
      },
      executeTradeOnchain: async () => {
        throw new Error('not used');
      },
      assertLiveWriteAllowed: async () => {},
      hasWebhookTargets: () => false,
      sendWebhookNotifications: async () => ({
        count: 0,
        successCount: 0,
        failureCount: 0,
        results: [],
      }),
      coerceMirrorServiceError: (error) => error,
      renderMirrorSyncTickLine: () => {},
      renderMirrorSyncDaemonTable: () => {},
      renderMirrorSyncTable: () => {},
      cliPath: '/usr/bin/node',
    },
    mirrorSyncUsage: 'pandora mirror sync start',
  });

  assert.ok(hookCalls.some((entry) => entry[0] === 'checkpoint' && entry[2] === 'strategy-123'));
});

test('mirror sync start falls back to strategyHash when create hook returns no id', async () => {
  const hookCalls = [];
  const emitted = [];

  await handleMirrorSync({
    shared: {
      rest: ['start'],
      indexerUrl: 'https://indexer.example',
      timeoutMs: 5_000,
    },
    context: {
      outputMode: 'json',
      operationHooks: {
        createOperation: async () => null,
        emitCheckpoint: async (details) => {
          hookCalls.push(['checkpoint', details.phase, details.operationId]);
        },
        updateOperation: async (details) => {
          hookCalls.push(['update', details.phase, details.operationId, details.status]);
        },
      },
    },
    deps: {
      CliError: class CliError extends Error {},
      includesHelpFlag: () => false,
      emitSuccess: (_mode, command, payload) => {
        emitted.push({ command, payload });
      },
      maybeLoadTradeEnv: () => {},
      resolveIndexerUrl: (value) => value,
      parseMirrorSyncDaemonSelectorFlags: () => {
        throw new Error('not used');
      },
      stopMirrorDaemon: async () => {
        throw new Error('not used');
      },
      mirrorDaemonStatus: () => {
        throw new Error('not used');
      },
      parseMirrorSyncFlags: () => ({
        daemon: true,
        trustDeploy: false,
        executeLive: false,
        stateFile: '/tmp/mirror-state.json',
        killSwitchFile: '/tmp/mirror-stop',
        pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        polymarketMarketId: 'poly-1',
        polymarketSlug: null,
        forceGateDeprecatedUsed: false,
      }),
      buildMirrorSyncStrategy: () => ({ market: 'poly-1' }),
      mirrorStrategyHash: () => 'strategy-123',
      buildMirrorSyncDaemonCliArgs: () => ['mirror', 'sync', 'run'],
      startMirrorDaemon: () => ({
        strategyHash: 'strategy-123',
        pid: 12345,
        pidFile: '/tmp/mirror-state.json',
        logFile: '/tmp/mirror-sync.log',
        pidAlive: true,
        status: 'running',
      }),
      resolveTrustedDeployPair: () => {
        throw new Error('not used');
      },
      runLivePolymarketPreflightForMirror: async () => {
        throw new Error('not used');
      },
      runMirrorSync: async () => {
        throw new Error('not used');
      },
      buildQuotePayload: async () => {
        throw new Error('not used');
      },
      executeTradeOnchain: async () => {
        throw new Error('not used');
      },
      assertLiveWriteAllowed: async () => {},
      hasWebhookTargets: () => false,
      sendWebhookNotifications: async () => ({
        count: 0,
        successCount: 0,
        failureCount: 0,
        results: [],
      }),
      coerceMirrorServiceError: (error) => error,
      renderMirrorSyncTickLine: () => {},
      renderMirrorSyncDaemonTable: () => {},
      renderMirrorSyncTable: () => {},
      cliPath: '/usr/bin/node',
    },
    mirrorSyncUsage: 'pandora mirror sync start',
  });

  assert.equal(emitted[0].payload.operationId, 'strategy-123');
  assert.ok(Array.isArray(emitted[0].payload.diagnostics));
  assert.ok(emitted[0].payload.diagnostics.some((entry) => entry.includes('Create hook returned no operation id')));
  assert.equal(emitted[0].payload.operationDiagnostics, undefined);
  assert.ok(hookCalls.some((entry) => entry[2] === 'strategy-123'));
});
