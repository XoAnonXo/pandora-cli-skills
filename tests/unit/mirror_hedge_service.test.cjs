const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const servicePath = require.resolve('../../cli/lib/mirror_hedge_service.cjs');
const verifyModule = require('../../cli/lib/mirror_verify_service.cjs');
const polymarketModule = require('../../cli/lib/polymarket_trade_adapter.cjs');

function loadMirrorHedgeService() {
  delete require.cache[servicePath];
  return require('../../cli/lib/mirror_hedge_service.cjs');
}

const { createMirrorHedgeService } = loadMirrorHedgeService();
const { createState, loadState } = require('../../cli/lib/mirror_hedge_state_store.cjs');
const { createTempDir, removeDir } = require('../helpers/cli_runner.cjs');

function withPatchedModules(testFn) {
  return async (...args) => {
    const originals = {
      verifyMirrorPair: verifyModule.verifyMirrorPair,
      fetchDepthForMarket: polymarketModule.fetchDepthForMarket,
      fetchPolymarketPositionSummary: polymarketModule.fetchPolymarketPositionSummary,
      placeHedgeOrder: polymarketModule.placeHedgeOrder,
      resolvePolymarketMarket: polymarketModule.resolvePolymarketMarket,
    };
    verifyModule.verifyMirrorPair = async (options = {}) => ({
      diagnostics: [],
      gateResult: {
        ok: true,
        failedChecks: [],
        checks: [],
      },
      pandora: {
        question: 'Will Team A beat Team B?',
        marketAddress: options.pandoraMarketAddress,
      },
      sourceMarket: {
        marketId: options.polymarketMarketId || 'poly-1',
        slug: options.polymarketSlug || 'team-a-vs-team-b',
        question: 'Will Team A beat Team B?',
        yesTokenId: 'yes-token',
        noTokenId: 'no-token',
        yesPct: 0.57,
        noPct: 0.43,
      },
    });
    polymarketModule.resolvePolymarketMarket = async (options = {}) => ({
      marketId: options.marketId || 'poly-1',
      slug: options.slug || 'team-a-vs-team-b',
      yesTokenId: 'yes-token',
      noTokenId: 'no-token',
      yesPct: 0.57,
      noPct: 0.43,
      diagnostics: [],
    });
    polymarketModule.fetchDepthForMarket = async () => ({
      yesDepth: { depthUsd: 500, availableUsd: 500, referencePrice: 0.57, depthShares: 877.192982 },
      noDepth: { depthUsd: 500, availableUsd: 500, referencePrice: 0.43, depthShares: 1162.790697 },
      sellYesDepth: { depthUsd: 100, availableUsd: 100, referencePrice: 0.57, depthShares: 175.438596 },
      sellNoDepth: { depthUsd: 100, availableUsd: 100, referencePrice: 0.43, depthShares: 232.558139 },
      diagnostics: [],
    });
    polymarketModule.fetchPolymarketPositionSummary = async () => ({
      marketId: 'poly-1',
      slug: 'team-a-vs-team-b',
      walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      yesBalance: 12,
      noBalance: 0,
      openOrdersCount: 0,
      estimatedValueUsd: 6.84,
      prices: { yes: 0.57, no: 0.43 },
      source: { resolved: 'mock' },
      diagnostics: [],
    });
    polymarketModule.placeHedgeOrder = async (options = {}) => ({
      ok: true,
      response: { hash: `0x${String(options.tokenId || '0').padEnd(64, '1')}` },
    });
    try {
      await testFn(...args);
    } finally {
      verifyModule.verifyMirrorPair = originals.verifyMirrorPair;
      polymarketModule.fetchDepthForMarket = originals.fetchDepthForMarket;
      polymarketModule.fetchPolymarketPositionSummary = originals.fetchPolymarketPositionSummary;
      polymarketModule.placeHedgeOrder = originals.placeHedgeOrder;
      polymarketModule.resolvePolymarketMarket = originals.resolvePolymarketMarket;
      delete require.cache[servicePath];
    }
  };
}

function normalizeIsoOrNull(value) {
  return typeof value === 'string' && value ? value : null;
}

test('mirror hedge state store creates a separate runtime shape', () => {
  const state = createState('abc123abc123abc1', {
    marketPairIdentity: {
      pandoraMarketAddress: '0x1111111111111111111111111111111111111111',
      polymarketMarketId: 'poly-1',
      polymarketSlug: 'slug-1',
      marketPairId: 'pair-1',
    },
  });

  assert.equal(state.runtimeType, 'lp-hedge');
  assert.equal(state.strategyHash, 'abc123abc123abc1');
  assert.equal(state.marketPairIdentity.marketPairId, 'pair-1');
  assert.deepEqual(state.confirmedExposureLedger, []);
  assert.deepEqual(state.pendingMempoolOverlays, []);
  assert.deepEqual(state.deferredHedgeQueue, []);
});

test('mirror hedge service lifecycle persists plan, status, and bundle-facing state', () => {
  const tempDir = createTempDir('pandora-hedge-runtime-');
  const stateFile = path.join(tempDir, 'hedge.json');
  const service = createMirrorHedgeService();

  try {
    const start = service.start({
      stateFile,
      strategyHash: 'abc123abc123abc1',
      marketPairIdentity: {
        pandoraMarketAddress: '0x1111111111111111111111111111111111111111',
        polymarketMarketId: 'poly-1',
        marketPairId: 'pair-1',
      },
      whitelistFingerprint: 'whitelist-a',
    });

    assert.equal(start.started, true);
    assert.equal(start.state.runtimeStatus, 'running');

    const run = service.run({
      stateFile,
      strategyHash: 'abc123abc123abc1',
      lastProcessedBlockCursor: {
        blockNumber: 123,
        blockHash: '0xabc',
        cursor: 'block:123',
      },
      lastProcessedLogCursor: {
        blockNumber: 123,
        logIndex: 4,
        cursor: 'log:4',
        transactionHash: '0x' + 'a'.repeat(64),
      },
      confirmedExposureLedger: [
        {
          id: 'exposure-1',
          amountUsdc: 5,
          deltaUsdc: 5,
          cursor: 'log:4',
          status: 'confirmed',
        },
      ],
      pendingMempoolOverlays: [
        {
          txHash: `0x${'b'.repeat(64)}`,
          amountUsdc: 2,
          expectedHedgeDeltaUsdc: 2,
        },
      ],
      deferredHedgeQueue: [
        {
          id: 'defer-1',
          amountUsdc: 3,
          reason: 'await-retry',
        },
      ],
      managedPolymarketInventorySnapshot: {
        status: 'adopted',
        yesShares: 10,
        noShares: 0,
        netUsdc: 10,
      },
      skippedVolumeCounters: {
        totalUsdc: 1,
        yesUsdc: 1,
        count: 2,
        byReason: {
          illiquid: 1,
        },
      },
      lastObservedTrade: {
        tradeId: 'trade-1',
        cursor: 'log:4',
        transactionHash: '0x' + 'd'.repeat(64),
        walletAddress: '0x1111111111111111111111111111111111111111',
        marketPairId: 'pair-1',
        pandoraMarketAddress: '0x1111111111111111111111111111111111111111',
        polymarketMarketId: 'poly-1',
        polymarketSlug: 'slug-1',
        source: 'pandora.indexer',
        orderSide: 'buy',
        tokenSide: 'yes',
        direction: 'buy-yes',
        amountUsdc: 5,
        amountShares: 10,
        expectedRevenueUsdc: 0.1,
        confirmedAt: '2026-03-20T00:00:00.000Z',
        observedAt: '2026-03-20T00:00:01.250Z',
        observationLatencyMs: 1250,
        hedgeEligible: true,
        reason: 'external-trade',
      },
      lastHedgeSignal: {
        hedgeId: 'pair-1:buy-yes',
        status: 'planned',
        signalAt: '2026-03-20T00:00:01.900Z',
        tradeId: 'trade-1',
        cursor: 'log:4',
        transactionHash: '0x' + 'd'.repeat(64),
        tradeConfirmedAt: '2026-03-20T00:00:00.000Z',
        tradeObservedAt: '2026-03-20T00:00:01.250Z',
        reactionLatencyMs: 1900,
        observeToSignalLatencyMs: 650,
        amountUsdc: 5,
        amountShares: 10,
        tokenSide: 'yes',
        orderSide: 'buy',
        source: 'mirror-hedge-paper',
        reason: 'inventory-gap',
      },
      lastSuccessfulHedge: {
        hedgeId: 'hedge-1',
        status: 'completed',
        amountUsdc: 5,
        tokenSide: 'yes',
        orderSide: 'buy',
        txHash: '0x' + 'c'.repeat(64),
        executedAt: '2026-03-20T00:00:00.000Z',
      },
    });

    assert.equal(run.plan.summary.ready, true);
    assert.equal(run.plan.summary.confirmedExposureCount, 1);
    assert.equal(run.plan.summary.pendingOverlayCount, 1);
    assert.equal(run.plan.summary.deferredHedgeCount, 1);
    assert.equal(run.state.runtimeStatus, 'running');

    const status = service.status({
      stateFile,
      strategyHash: 'abc123abc123abc1',
    });

    assert.equal(status.runtime.status, 'running');
    assert.equal(status.summary.confirmedExposureUsdc, 5);
    assert.equal(status.summary.pendingOverlayUsdc, 2);
    assert.equal(status.summary.deferredHedgeUsdc, 3);
    assert.equal(status.readiness.ready, true);
    assert.equal(status.summary.lastObservedTradeId, 'trade-1');
    assert.equal(status.summary.lastTradeObservationLatencyMs, 1250);
    assert.equal(status.summary.lastHedgeSignalStatus, 'planned');
    assert.equal(status.summary.lastHedgeReactionLatencyMs, 1900);
    assert.equal(status.lastObservedTrade.tradeId, 'trade-1');
    assert.equal(status.lastHedgeSignal.hedgeId, 'pair-1:buy-yes');

    const bundle = service.bundleFacing({
      stateFile,
      strategyHash: 'abc123abc123abc1',
    });

    assert.equal(bundle.runtimeStatus, 'running');
    assert.equal(bundle.bundleFacing.deferredHedgeQueue.length, 1);
    assert.equal(bundle.bundleFacing.lastObservedTrade.tradeId, 'trade-1');
    assert.equal(bundle.bundleFacing.lastHedgeSignal.status, 'planned');
    assert.equal(bundle.bundleFacing.lastSuccessfulHedge.hedgeId, 'hedge-1');

    const stopped = service.stop({
      stateFile,
      strategyHash: 'abc123abc123abc1',
      lastAlert: {
        code: 'STOPPED_BY_OPERATOR',
        message: 'Stopped for maintenance.',
      },
    });

    assert.equal(stopped.stopped, true);
    assert.equal(stopped.state.runtimeStatus, 'stopped');
    assert.equal(stopped.state.lastAlert.code, 'STOPPED_BY_OPERATOR');

    const persisted = loadState(stateFile, 'abc123abc123abc1').state;
    assert.equal(persisted.runtimeStatus, 'stopped');
    assert.equal(persisted.marketPairIdentity.marketPairId, 'pair-1');
    assert.equal(persisted.confirmedExposureLedger.length, 1);
    assert.equal(persisted.pendingMempoolOverlays.length, 1);
    assert.equal(persisted.deferredHedgeQueue.length, 1);
    assert.equal(persisted.lastObservedTrade.tradeId, 'trade-1');
    assert.equal(persisted.lastHedgeSignal.hedgeId, 'pair-1:buy-yes');
  } finally {
    removeDir(tempDir);
  }
});

test('mirror hedge stop records clean exit metadata for status and persistence', withPatchedModules(async () => {
  const tempDir = createTempDir('pandora-hedge-stop-metadata-');
  const stateFile = path.join(tempDir, 'hedge.json');
  const service = loadMirrorHedgeService();
  const exitAt = '2026-03-21T00:00:00.000Z';

  try {
    service.startHedge({
      stateFile,
      strategyHash: 'abc123abc123abc1',
      iterationsRequested: 3,
      marketPairIdentity: {
        pandoraMarketAddress: '0x1111111111111111111111111111111111111111',
        polymarketMarketId: 'poly-1',
        marketPairId: 'pair-1',
      },
      whitelistFingerprint: 'whitelist-a',
    });

    const stopped = service.stopHedge({
      stateFile,
      strategyHash: 'abc123abc123abc1',
      stoppedReason: 'operator-stop',
      exitCode: 0,
      iterationsRequested: 3,
      iterationsCompleted: 3,
      exitAt,
      lastAlert: {
        code: 'STOPPED_BY_OPERATOR',
        message: 'Stopped cleanly by operator.',
      },
    });

    assert.equal(stopped.state.runtimeStatus, 'stopped');
    assert.equal(stopped.state.stoppedReason, 'operator-stop');
    assert.equal(stopped.state.exitCode, 0);
    assert.equal(stopped.state.iterationsRequested, 3);
    assert.equal(stopped.state.iterationsCompleted, 3);
    assert.equal(normalizeIsoOrNull(stopped.state.exitAt || stopped.state.stoppedAt), exitAt);

    const persisted = loadState(stateFile, 'abc123abc123abc1').state;
    assert.equal(persisted.runtimeStatus, 'stopped');
    assert.equal(persisted.stoppedReason, 'operator-stop');
    assert.equal(persisted.exitCode, 0);
    assert.equal(persisted.iterationsRequested, 3);
    assert.equal(persisted.iterationsCompleted, 3);
    assert.equal(normalizeIsoOrNull(persisted.exitAt || persisted.stoppedAt), exitAt);

    const status = service.statusHedge({
      stateFile,
      strategyHash: 'abc123abc123abc1',
    });

    assert.equal(status.runtime.status, 'stopped');
    assert.equal(status.runtime.stoppedReason, 'operator-stop');
    assert.equal(status.runtime.exitCode, 0);
    assert.equal(status.runtime.iterationsRequested, 3);
    assert.equal(status.runtime.iterationsCompleted, 3);
    assert.equal(normalizeIsoOrNull(status.runtime.exitAt || status.runtime.stoppedAt), exitAt);
    assert.equal(status.lastAlert.code, 'STOPPED_BY_OPERATOR');
  } finally {
    removeDir(tempDir);
  }
}));

test('mirror hedge state starts idle without a synthetic startedAt timestamp', withPatchedModules(async () => {
  const tempDir = createTempDir('pandora-hedge-fresh-state-');
  const stateFile = path.join(tempDir, 'hedge.json');
  const service = loadMirrorHedgeService();

  try {
    const status = service.statusHedge({
      stateFile,
      strategyHash: 'abc123abc123abc1',
    });

    assert.equal(status.runtime.status, 'idle');
    assert.equal(status.runtime.startedAt, null);

    const persisted = loadState(stateFile, 'abc123abc123abc1').state;
    assert.equal(persisted.runtimeStatus, 'idle');
    assert.equal(persisted.startedAt, null);
  } finally {
    removeDir(tempDir);
  }
}));

test('buildMirrorHedgePlan returns hedge-daemon readiness with whitelist metadata', withPatchedModules(async () => {
  const tempDir = createTempDir('pandora-hedge-plan-');
  const walletFile = path.join(tempDir, 'internal-wallets.txt');
  fs.writeFileSync(walletFile, [
    '0x1111111111111111111111111111111111111111',
    '# ignored comment',
    '0x2222222222222222222222222222222222222222',
    '',
  ].join('\n'));

  try {
    const service = loadMirrorHedgeService();
    const payload = await service.buildMirrorHedgePlan({
      pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      polymarketMarketId: 'poly-1',
      internalWalletsFile: walletFile,
    });

    assert.equal(payload.mode, 'plan');
    assert.equal(payload.selector.pandoraMarketAddress, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.equal(payload.selector.polymarketMarketId, 'poly-1');
    assert.equal(payload.internalWallets.count, 2);
    assert.equal(payload.readiness.liveReady, true);
    assert.match(payload.plan.summary.marketPairId, /0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  } finally {
    removeDir(tempDir);
  }
}));

test('buildMirrorHedgeBundle emits VPS bundle artifacts and excludes Cloudflare Workers', withPatchedModules(async () => {
  const tempDir = createTempDir('pandora-hedge-bundle-');
  const walletFile = path.join(tempDir, 'internal-wallets.txt');
  const outputDir = path.join(tempDir, 'bundle');
  fs.writeFileSync(walletFile, '0x1111111111111111111111111111111111111111\n');

  try {
    const service = loadMirrorHedgeService();
    const payload = await service.buildMirrorHedgeBundle({
      pandoraMarketAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      polymarketSlug: 'team-a-vs-team-b',
      internalWalletsFile: walletFile,
      outputDir,
    });

    assert.equal(payload.mode, 'bundle');
    assert.equal(payload.bundle.outputDir, outputDir);
    assert.equal(fs.existsSync(path.join(outputDir, '.env')), true);
    assert.equal(fs.existsSync(path.join(outputDir, 'hedge-daemon.config.json')), true);
    assert.equal(fs.existsSync(path.join(outputDir, 'mirror-hedge.service')), true);
    assert.equal(fs.existsSync(path.join(outputDir, 'run-mirror-hedge.sh')), true);
    const launchScript = fs.readFileSync(path.join(outputDir, 'run-mirror-hedge.sh'), 'utf8');
    const readme = fs.readFileSync(path.join(outputDir, 'README.md'), 'utf8');
    assert.match(launchScript, /ENV_FILE="\$\{SCRIPT_DIR\}\/\.env"/);
    assert.match(launchScript, /source "\$\{ENV_FILE\}"/);
    assert.match(readme, /DigitalOcean droplet/);
    assert.match(readme, /Cloudflare Workers/);
    assert.match(readme, /auto-loads `\.env`/);
  } finally {
    removeDir(tempDir);
  }
}));

test('buildMirrorHedgeBundle preserves adopt-existing-positions in emitted launch artifacts', withPatchedModules(async () => {
  const tempDir = createTempDir('pandora-hedge-bundle-adopt-existing-');
  const walletFile = path.join(tempDir, 'internal-wallets.txt');
  const outputDir = path.join(tempDir, 'bundle');
  fs.writeFileSync(walletFile, '0x1111111111111111111111111111111111111111\n');

  try {
    const service = loadMirrorHedgeService();
    await service.buildMirrorHedgeBundle({
      pandoraMarketAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      polymarketSlug: 'team-a-vs-team-b',
      internalWalletsFile: walletFile,
      outputDir,
      adoptExistingPositions: true,
    });

    const launchScript = fs.readFileSync(path.join(outputDir, 'run-mirror-hedge.sh'), 'utf8');
    const systemdUnit = fs.readFileSync(path.join(outputDir, 'mirror-hedge.service'), 'utf8');
    const config = JSON.parse(fs.readFileSync(path.join(outputDir, 'hedge-daemon.config.json'), 'utf8'));

    assert.match(launchScript, /--adopt-existing-positions/);
    assert.match(systemdUnit, /--adopt-existing-positions/);
    assert.equal(config.hedgePolicies.adoptExistingPositions, true);
  } finally {
    removeDir(tempDir);
  }
}));

test('runMirrorHedge in paper mode ignores internal trades and accumulates below-threshold external exposure', withPatchedModules(async () => {
  const tempDir = createTempDir('pandora-hedge-run-');
  const walletFile = path.join(tempDir, 'internal-wallets.txt');
  fs.writeFileSync(walletFile, '0x1111111111111111111111111111111111111111\n');

  try {
    const service = loadMirrorHedgeService();
    const payload = await service.runMirrorHedge({
      stateFile: path.join(tempDir, 'runtime.json'),
      pandoraMarketAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
      polymarketMarketId: 'poly-1',
      internalWalletsFile: walletFile,
      iterations: 1,
      confirmedTrades: [
        {
          id: 'trade-internal',
          marketAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
          trader: '0x1111111111111111111111111111111111111111',
          side: 'yes',
          tradeType: 'buy',
          collateralAmount: '50000000',
          tokenAmount: '87719298',
          feeAmount: '1000000',
          timestamp: 1710000000,
          txHash: `0x${'1'.repeat(64)}`,
        },
        {
          id: 'trade-small',
          marketAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
          trader: '0x3333333333333333333333333333333333333333',
          side: 'no',
          tradeType: 'buy',
          collateralAmount: '10000000',
          tokenAmount: '23255813',
          feeAmount: '200000',
          timestamp: 1710000001,
          txHash: `0x${'2'.repeat(64)}`,
        },
      ],
      minHedgeUsdc: 25,
    });

    assert.equal(payload.mode, 'run');
    assert.equal(payload.summary.confirmedExposureCount, 1);
    assert.equal(payload.plan.summary.skippedVolumeCount, 1);
    assert.equal(payload.plan.summary.netTargetSide, 'no');
    assert.equal(payload.plan.summary.netTargetShares > 0, true);
    assert.equal(payload.plan.summary.belowThresholdPendingUsdc > 0, true);
    assert.equal(
      payload.runtime.auditEntries.some((entry) => entry.kind === 'ignored-internal-trade'),
      true,
    );
    assert.equal(
      payload.runtime.auditEntries.some((entry) => entry.kind === 'below-threshold-gap'),
      true,
    );
  } finally {
    removeDir(tempDir);
  }
}));

test('runMirrorHedge nets BUY_YES then BUY_NO into a single NO target inventory', withPatchedModules(async () => {
  const tempDir = createTempDir('pandora-hedge-net-target-');
  const walletFile = path.join(tempDir, 'internal-wallets.txt');
  fs.writeFileSync(walletFile, '0x1111111111111111111111111111111111111111\n');

  try {
    const service = loadMirrorHedgeService();
    const payload = await service.runMirrorHedge({
      stateFile: path.join(tempDir, 'runtime.json'),
      pandoraMarketAddress: '0xdddddddddddddddddddddddddddddddddddddddd',
      polymarketMarketId: 'poly-1',
      internalWalletsFile: walletFile,
      iterations: 1,
      confirmedTrades: [
        {
          id: 'trade-buy-yes',
          marketAddress: '0xdddddddddddddddddddddddddddddddddddddddd',
          trader: '0x3333333333333333333333333333333333333333',
          side: 'yes',
          tradeType: 'buy',
          collateralAmount: '50000000',
          tokenAmount: '87719298',
          feeAmount: '1000000',
          timestamp: 1710000000,
          txHash: `0x${'3'.repeat(64)}`,
        },
        {
          id: 'trade-buy-no',
          marketAddress: '0xdddddddddddddddddddddddddddddddddddddddd',
          trader: '0x4444444444444444444444444444444444444444',
          side: 'no',
          tradeType: 'buy',
          collateralAmount: '100000000',
          tokenAmount: '232558140',
          feeAmount: '2000000',
          timestamp: 1710000001,
          txHash: `0x${'4'.repeat(64)}`,
        },
      ],
      minHedgeUsdc: 25,
    });

    assert.equal(payload.plan.summary.netTargetSide, 'no');
    assert.equal(payload.plan.summary.targetYesShares, 0);
    assert.equal(payload.plan.summary.targetNoShares > 0, true);

    const state = loadState(path.join(tempDir, 'runtime.json')).state;
    assert.equal(state.targetHedgeInventory.netSide, 'no');
    assert.equal(state.targetHedgeInventory.yesShares, 0);
    assert.equal(state.targetHedgeInventory.noShares > 0, true);
  } finally {
    removeDir(tempDir);
  }
}));

test('runMirrorHedge field report sequence NO then YES then NO ends with a single NO target', withPatchedModules(async () => {
  const tempDir = createTempDir('pandora-hedge-field-sequence-');
  const walletFile = path.join(tempDir, 'internal-wallets.txt');
  fs.writeFileSync(walletFile, '0x1111111111111111111111111111111111111111\n');

  try {
    const service = loadMirrorHedgeService();
    const payload = await service.runMirrorHedge({
      stateFile: path.join(tempDir, 'runtime.json'),
      pandoraMarketAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      polymarketMarketId: 'poly-1',
      internalWalletsFile: walletFile,
      iterations: 1,
      confirmedTrades: [
        {
          id: 'trade-no-1',
          marketAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          trader: '0x3333333333333333333333333333333333333333',
          side: 'no',
          tradeType: 'buy',
          collateralAmount: '100000000',
          tokenAmount: '157100000',
          feeAmount: '2000000',
          timestamp: 1710000000,
          txHash: `0x${'5'.repeat(64)}`,
        },
        {
          id: 'trade-yes-1',
          marketAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          trader: '0x4444444444444444444444444444444444444444',
          side: 'yes',
          tradeType: 'buy',
          collateralAmount: '50000000',
          tokenAmount: '130100000',
          feeAmount: '1000000',
          timestamp: 1710000001,
          txHash: `0x${'6'.repeat(64)}`,
        },
        {
          id: 'trade-no-2',
          marketAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          trader: '0x5555555555555555555555555555555555555555',
          side: 'no',
          tradeType: 'buy',
          collateralAmount: '50000000',
          tokenAmount: '78800000',
          feeAmount: '1000000',
          timestamp: 1710000002,
          txHash: `0x${'7'.repeat(64)}`,
        },
      ],
      minHedgeUsdc: 25,
    });

    assert.equal(payload.plan.summary.netTargetSide, 'no');
    assert.equal(payload.plan.summary.targetYesShares, 0);
    assert.equal(payload.plan.summary.targetNoShares > 0, true);
  } finally {
    removeDir(tempDir);
  }
}));

test('runMirrorHedge accumulates small external trades until the net gap crosses the execution threshold', withPatchedModules(async () => {
  const tempDir = createTempDir('pandora-hedge-threshold-accumulate-');
  const walletFile = path.join(tempDir, 'internal-wallets.txt');
  const originalFetchInventory = polymarketModule.fetchPolymarketPositionSummary;
  polymarketModule.fetchPolymarketPositionSummary = async () => ({
    marketId: 'poly-1',
    slug: 'team-a-vs-team-b',
    walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    yesBalance: 0,
    noBalance: 0,
    openOrdersCount: 0,
    estimatedValueUsd: 0,
    prices: { yes: 0.57, no: 0.43 },
    source: { resolved: 'mock' },
    diagnostics: [],
  });
  fs.writeFileSync(walletFile, '0x1111111111111111111111111111111111111111\n');

  try {
    const service = loadMirrorHedgeService();
    const stateFile = path.join(tempDir, 'runtime.json');

    const first = await service.runMirrorHedge({
      stateFile,
      pandoraMarketAddress: '0xffffffffffffffffffffffffffffffffffffffff',
      polymarketMarketId: 'poly-1',
      internalWalletsFile: walletFile,
      iterations: 1,
      confirmedTrades: [
        {
          id: 'trade-small-1',
          marketAddress: '0xffffffffffffffffffffffffffffffffffffffff',
          trader: '0x3333333333333333333333333333333333333333',
          side: 'no',
          tradeType: 'buy',
          collateralAmount: '10000000',
          tokenAmount: '23255813',
          feeAmount: '200000',
          timestamp: 1710000000,
          txHash: `0x${'8'.repeat(64)}`,
        },
      ],
      minHedgeUsdc: 25,
    });

    assert.equal(first.plan.summary.belowThresholdPendingUsdc > 0, true);
    assert.equal(first.runtime.auditEntries.some((entry) => entry.kind === 'hedge-planned'), false);

    const second = await service.runMirrorHedge({
      stateFile,
      pandoraMarketAddress: '0xffffffffffffffffffffffffffffffffffffffff',
      polymarketMarketId: 'poly-1',
      internalWalletsFile: walletFile,
      iterations: 1,
      confirmedTrades: [
        {
          id: 'trade-small-2',
          marketAddress: '0xffffffffffffffffffffffffffffffffffffffff',
          trader: '0x4444444444444444444444444444444444444444',
          side: 'no',
          tradeType: 'buy',
          collateralAmount: '20000000',
          tokenAmount: '46511628',
          feeAmount: '400000',
          timestamp: 1710000001,
          txHash: `0x${'9'.repeat(64)}`,
        },
      ],
      minHedgeUsdc: 25,
    });

    assert.equal(second.plan.summary.belowThresholdPendingUsdc, 0);
    assert.equal(second.runtime.auditEntries.some((entry) => entry.kind === 'hedge-planned'), true);
  } finally {
    polymarketModule.fetchPolymarketPositionSummary = originalFetchInventory;
    removeDir(tempDir);
  }
}));

test('runMirrorHedge blocks expansion buys when estimated execution fee exceeds the accumulated fee budget', withPatchedModules(async () => {
  const tempDir = createTempDir('pandora-hedge-fee-budget-');
  const walletFile = path.join(tempDir, 'internal-wallets.txt');
  const originalFetchInventory = polymarketModule.fetchPolymarketPositionSummary;
  polymarketModule.fetchPolymarketPositionSummary = async () => ({
    marketId: 'poly-1',
    slug: 'team-a-vs-team-b',
    walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    yesBalance: 0,
    noBalance: 0,
    openOrdersCount: 0,
    estimatedValueUsd: 0,
    prices: { yes: 0.57, no: 0.43 },
    source: { resolved: 'mock' },
    diagnostics: [],
  });
  fs.writeFileSync(walletFile, '0x1111111111111111111111111111111111111111\n');

  try {
    const service = loadMirrorHedgeService();
    const payload = await service.runMirrorHedge({
      stateFile: path.join(tempDir, 'runtime.json'),
      pandoraMarketAddress: '0xabababababababababababababababababababab',
      polymarketMarketId: 'poly-1',
      internalWalletsFile: walletFile,
      iterations: 1,
      estimatedExecutionFeeUsdc: 5,
      confirmedTrades: [
        {
          id: 'trade-budget-blocked',
          marketAddress: '0xabababababababababababababababababababab',
          trader: '0x3333333333333333333333333333333333333333',
          side: 'yes',
          tradeType: 'buy',
          collateralAmount: '50000000',
          tokenAmount: '87719298',
          feeAmount: '1000000',
          timestamp: 1710000000,
          txHash: `0x${'a'.repeat(64)}`,
        },
      ],
      minHedgeUsdc: 25,
    });

    assert.equal(payload.plan.summary.availableHedgeFeeBudgetUsdc, 1);
    assert.equal(payload.runtime.auditEntries.some((entry) => entry.reasonCode === 'fee-budget-exhausted'), true);
    assert.equal(payload.summary.deferredHedgeCount > 0, true);
  } finally {
    polymarketModule.fetchPolymarketPositionSummary = originalFetchInventory;
    removeDir(tempDir);
  }
}));

test('runMirrorHedge adopts existing positions as the starting target inventory when requested', withPatchedModules(async () => {
  const tempDir = createTempDir('pandora-hedge-adopt-existing-');
  const walletFile = path.join(tempDir, 'internal-wallets.txt');
  fs.writeFileSync(walletFile, '0x1111111111111111111111111111111111111111\n');

  try {
    const service = loadMirrorHedgeService();
    const payload = await service.runMirrorHedge({
      stateFile: path.join(tempDir, 'runtime.json'),
      pandoraMarketAddress: '0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
      polymarketMarketId: 'poly-1',
      internalWalletsFile: walletFile,
      iterations: 1,
      adoptExistingPositions: true,
      confirmedTrades: [],
    });

    const state = loadState(path.join(tempDir, 'runtime.json')).state;
    assert.equal(state.targetHedgeInventory.initializedFrom, 'adopted-existing-positions');
    assert.equal(state.targetHedgeInventory.netSide, 'yes');
    assert.equal(state.targetHedgeInventory.netShares, 12);
    assert.equal(payload.plan.summary.targetYesShares, 12);
  } finally {
    removeDir(tempDir);
  }
}));

test('runMirrorHedge skips buy expansion when a sell is blocked in the same cycle', withPatchedModules(async () => {
  const tempDir = createTempDir('pandora-hedge-sell-blocked-');
  const walletFile = path.join(tempDir, 'internal-wallets.txt');
  const stateFile = path.join(tempDir, 'runtime.json');
  const originalFetchInventory = polymarketModule.fetchPolymarketPositionSummary;
  polymarketModule.fetchPolymarketPositionSummary = async () => ({
    marketId: 'poly-1',
    slug: 'team-a-vs-team-b',
    walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    yesBalance: 10,
    noBalance: 20,
    openOrdersCount: 0,
    estimatedValueUsd: 14.3,
    prices: { yes: 0.57, no: 0.43 },
    source: { resolved: 'mock' },
    diagnostics: [],
  });
  fs.writeFileSync(walletFile, '0x1111111111111111111111111111111111111111\n');
  fs.writeFileSync(stateFile, JSON.stringify(createState('abc123abc123abc1', {
    targetHedgeInventory: {
      yesShares: 15,
      noShares: 0,
      initializedAt: '2026-03-26T00:00:00.000Z',
      initializedFrom: 'flat',
    },
  }), null, 2));

  try {
    const service = loadMirrorHedgeService();
    const payload = await service.runMirrorHedge({
      stateFile,
      pandoraMarketAddress: '0x1212121212121212121212121212121212121212',
      polymarketMarketId: 'poly-1',
      internalWalletsFile: walletFile,
      iterations: 1,
      sellHedgePolicy: 'manual-only',
      confirmedTrades: [],
      minHedgeUsdc: 1,
      funder: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });

    assert.equal(payload.summary.sellRetryAttemptedCount, 1);
    assert.equal(payload.summary.sellRetryBlockedCount, 1);
    assert.equal(payload.summary.sellRetryFailedCount, 0);
    assert.equal(payload.runtime.auditEntries.some((entry) => entry.kind === 'buy-phase-skipped'), true);
    assert.equal(
      payload.runtime.auditEntries.some((entry) => entry.kind === 'hedge-planned' && entry.orderSide === 'buy'),
      false,
    );

    const state = loadState(stateFile).state;
    assert.equal(state.deferredHedgeQueue.length, 1);
    assert.equal(state.deferredHedgeQueue[0].orderSide, 'sell');
  } finally {
    polymarketModule.fetchPolymarketPositionSummary = originalFetchInventory;
    removeDir(tempDir);
  }
}));

test('runMirrorHedge queues zero-fill partial buy hedges instead of submitting a zero-notional live order', withPatchedModules(async () => {
  const tempDir = createTempDir('pandora-hedge-zero-fill-partial-');
  const walletFile = path.join(tempDir, 'internal-wallets.txt');
  const stateFile = path.join(tempDir, 'runtime.json');
  const originalFetchInventory = polymarketModule.fetchPolymarketPositionSummary;
  const originalFetchDepth = polymarketModule.fetchDepthForMarket;
  const originalPlaceOrder = polymarketModule.placeHedgeOrder;
  const orderCalls = [];
  polymarketModule.fetchPolymarketPositionSummary = async () => ({
    marketId: 'poly-1',
    slug: 'team-a-vs-team-b',
    walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    yesBalance: 0,
    noBalance: 0,
    openOrdersCount: 0,
    estimatedValueUsd: 0,
    prices: { yes: 0.57, no: 0.43 },
    source: { resolved: 'mock' },
    diagnostics: [],
  });
  polymarketModule.fetchDepthForMarket = async () => ({
    yesDepth: { depthUsd: 0, availableUsd: 0, referencePrice: 0.57, depthShares: 0 },
    noDepth: { depthUsd: 500, availableUsd: 500, referencePrice: 0.43, depthShares: 1162.790697 },
    sellYesDepth: { depthUsd: 100, availableUsd: 100, referencePrice: 0.57, depthShares: 175.438596 },
    sellNoDepth: { depthUsd: 100, availableUsd: 100, referencePrice: 0.43, depthShares: 232.558139 },
    diagnostics: [],
  });
  polymarketModule.placeHedgeOrder = async (options = {}) => {
    orderCalls.push(options);
    throw new Error('amountUsd must be a positive number for hedge execution.');
  };
  fs.writeFileSync(walletFile, '0x1111111111111111111111111111111111111111\n');

  try {
    const service = loadMirrorHedgeService();
    const payload = await service.runMirrorHedge({
      stateFile,
      pandoraMarketAddress: '0xfefefefefefefefefefefefefefefefefefefefe',
      polymarketMarketId: 'poly-1',
      internalWalletsFile: walletFile,
      iterations: 1,
      executeLive: true,
      privateKey: '0x' + '1'.repeat(64),
      funder: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      confirmedTrades: [
        {
          id: 'trade-zero-fill-1',
          marketAddress: '0xfefefefefefefefefefefefefefefefefefefefe',
          trader: '0x3333333333333333333333333333333333333333',
          side: 'yes',
          tradeType: 'buy',
          collateralAmount: '50000000',
          tokenAmount: '87719298',
          feeAmount: '1000000',
          timestamp: 1710000000,
          txHash: `0x${'c'.repeat(64)}`,
        },
      ],
      minHedgeUsdc: 1,
    });

    assert.equal(orderCalls.length, 0);
    assert.equal(payload.lastError, null);
    assert.equal(payload.summary.deferredHedgeCount, 1);
    assert.equal(payload.runtime.auditEntries.some((entry) => entry.reasonCode === 'non-executable-partial'), true);

    const state = loadState(stateFile).state;
    assert.equal(state.deferredHedgeQueue.length, 1);
    assert.equal(state.deferredHedgeQueue[0].reason, 'non-executable-partial');
    assert.equal(state.deferredHedgeQueue[0].orderSide, 'buy');
  } finally {
    polymarketModule.fetchPolymarketPositionSummary = originalFetchInventory;
    polymarketModule.fetchDepthForMarket = originalFetchDepth;
    polymarketModule.placeHedgeOrder = originalPlaceOrder;
    removeDir(tempDir);
  }
}));

test('runMirrorHedge OKC/BOS replay fixture prunes stale sell queue entries and records sell failure telemetry', withPatchedModules(async () => {
  const tempDir = createTempDir('pandora-hedge-okc-bos-replay-');
  const walletFile = path.join(tempDir, 'internal-wallets.txt');
  const stateFile = path.join(tempDir, 'runtime.json');
  const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'mirror_hedge', 'okc-bos-sell-failure.json'), 'utf8'),
  );
  const originalFetchInventory = polymarketModule.fetchPolymarketPositionSummary;
  const originalFetchDepth = polymarketModule.fetchDepthForMarket;
  const originalPlaceOrder = polymarketModule.placeHedgeOrder;
  const orderCalls = [];
  polymarketModule.fetchPolymarketPositionSummary = async () => ({
    marketId: 'poly-1',
    slug: 'nba-okc-bos-2026-03-25',
    walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    yesBalance: fixture.inventory.yesBalance,
    noBalance: fixture.inventory.noBalance,
    openOrdersCount: 0,
    estimatedValueUsd: fixture.inventory.estimatedValueUsd,
    prices: fixture.inventory.prices,
    source: { resolved: 'mock' },
    diagnostics: [],
  });
  polymarketModule.fetchDepthForMarket = async () => fixture.depth;
  polymarketModule.placeHedgeOrder = async (options = {}) => {
    orderCalls.push({ side: options.side, amountUsd: options.amountUsd, tokenId: options.tokenId });
    return {
      ok: false,
      error: {
        code: 'POLY_FAIL',
        message: 'order rejected by exchange',
        details: { status: 403 },
      },
      response: {
        status: 'rejected',
      },
    };
  };
  fs.writeFileSync(walletFile, '0x1111111111111111111111111111111111111111\n');
  fs.writeFileSync(stateFile, JSON.stringify(createState('abc123abc123abc1', fixture.state), null, 2));

  try {
    const service = loadMirrorHedgeService();
    const payload = await service.runMirrorHedge({
      stateFile,
      pandoraMarketAddress: '0x11012fc111111111111111111111111111111111',
      polymarketMarketId: 'poly-1',
      internalWalletsFile: walletFile,
      iterations: 1,
      executeLive: true,
      privateKey: '0x' + '1'.repeat(64),
      funder: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      confirmedTrades: [],
      minHedgeUsdc: 1,
    });

    assert.equal(orderCalls.length, 1);
    assert.equal(String(orderCalls[0].side).toLowerCase(), 'sell');
    assert.equal(payload.summary.sellRetryAttemptedCount, 1);
    assert.equal(payload.summary.sellRetryBlockedCount, 0);
    assert.equal(payload.summary.sellRetryFailedCount, 1);
    assert.equal(payload.summary.sellRetryRecoveredCount, 1);
    assert.equal(payload.runtime.auditEntries.some((entry) => entry.kind === 'sell-action-failed'), true);
    assert.equal(payload.runtime.auditEntries.some((entry) => entry.kind === 'buy-phase-skipped'), true);
    assert.equal(
      payload.runtime.auditEntries.some((entry) => entry.kind === 'hedge-executed' && entry.orderSide === 'buy'),
      false,
    );
    assert.equal(
      payload.runtime.auditEntries.some((entry) => entry.kind === 'hedge-planned' && entry.orderSide === 'buy'),
      false,
    );
    assert.equal(Array.isArray(payload.warnings), true);
    assert.equal(payload.warnings.some((warning) => warning.code === 'BOTH_SIDE_INVENTORY_LOCKUP'), true);
    assert.equal(payload.lastError && payload.lastError.details && payload.lastError.details.exchangeError.code, 'POLY_FAIL');

    const state = loadState(stateFile).state;
    assert.equal(state.deferredHedgeQueue.length, 1);
    assert.equal(state.deferredHedgeQueue[0].orderSide, 'sell');
    assert.equal(state.deferredHedgeQueue[0].tokenSide, 'no');
    assert.equal(state.deferredHedgeQueue.some((entry) => entry.id === 'okc-bos:sell-yes:execution-failed'), false);
    assert.equal(state.retryTelemetry.sellAttemptedCount, 1);
    assert.equal(state.retryTelemetry.sellFailedCount, 1);
    assert.equal(state.retryTelemetry.sellRecoveredCount, 1);
  } finally {
    polymarketModule.fetchPolymarketPositionSummary = originalFetchInventory;
    polymarketModule.fetchDepthForMarket = originalFetchDepth;
    polymarketModule.placeHedgeOrder = originalPlaceOrder;
    removeDir(tempDir);
  }
}));

test('buildMirrorHedgeDaemonCliArgs preserves --skip-dotenv for detached runs', () => {
  const service = loadMirrorHedgeService();
  const args = service.buildMirrorHedgeDaemonCliArgs({
    useEnvFile: false,
    executeLive: false,
  }, {
    stateFile: '/tmp/hedge-state.json',
    strategyHash: 'abc123abc123abc1',
    marketPairIdentity: {
      pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      polymarketMarketId: 'poly-1',
    },
    internalWallets: {
      filePath: '/tmp/internal-wallets.txt',
    },
    minHedgeUsdc: 25,
    partialPolicy: 'partial',
    sellPolicy: 'depth-checked',
  });

  assert.equal(args.includes('--skip-dotenv'), true);
  assert.equal(args.includes('--dotenv-path'), false);
});

test('buildMirrorHedgeDaemonCliArgs preserves explicit dotenv paths for detached runs', () => {
  const service = loadMirrorHedgeService();
  const args = service.buildMirrorHedgeDaemonCliArgs({
    useEnvFile: true,
    envFileExplicit: true,
    envFile: '/tmp/custom.env',
    executeLive: false,
  }, {
    stateFile: '/tmp/hedge-state.json',
    strategyHash: 'abc123abc123abc1',
    marketPairIdentity: {
      pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      polymarketMarketId: 'poly-1',
    },
    internalWallets: {
      filePath: '/tmp/internal-wallets.txt',
    },
    minHedgeUsdc: 25,
    partialPolicy: 'partial',
    sellPolicy: 'depth-checked',
  });

  const dotenvIndex = args.indexOf('--dotenv-path');
  assert.notEqual(dotenvIndex, -1);
  assert.equal(args[dotenvIndex + 1], '/tmp/custom.env');
});

test('buildMirrorHedgeDaemonCliArgs preserves custom kill-switch files for detached runs', () => {
  const service = loadMirrorHedgeService();
  const args = service.buildMirrorHedgeDaemonCliArgs({
    useEnvFile: false,
    executeLive: false,
    killSwitchFile: '/tmp/custom-hedge-stop',
  }, {
    stateFile: '/tmp/hedge-state.json',
    strategyHash: 'abc123abc123abc1',
    marketPairIdentity: {
      pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      polymarketMarketId: 'poly-1',
    },
    internalWallets: {
      filePath: '/tmp/internal-wallets.txt',
    },
    minHedgeUsdc: 25,
    partialPolicy: 'partial',
    sellPolicy: 'depth-checked',
  });

  const killSwitchIndex = args.indexOf('--kill-switch-file');
  assert.notEqual(killSwitchIndex, -1);
  assert.equal(args[killSwitchIndex + 1], '/tmp/custom-hedge-stop');
});

test('buildMirrorHedgeDaemonCliArgs preserves adopt-existing-positions for detached runs', () => {
  const service = loadMirrorHedgeService();
  const args = service.buildMirrorHedgeDaemonCliArgs({
    useEnvFile: false,
    executeLive: false,
    adoptExistingPositions: true,
  }, {
    stateFile: '/tmp/hedge-state.json',
    strategyHash: 'abc123abc123abc1',
    marketPairIdentity: {
      pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      polymarketMarketId: 'poly-1',
    },
    internalWallets: {
      filePath: '/tmp/internal-wallets.txt',
    },
    minHedgeUsdc: 25,
    partialPolicy: 'partial',
    sellPolicy: 'depth-checked',
  });

  assert.equal(args.includes('--adopt-existing-positions'), true);
});
