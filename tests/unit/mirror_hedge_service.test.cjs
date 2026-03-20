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

    const bundle = service.bundleFacing({
      stateFile,
      strategyHash: 'abc123abc123abc1',
    });

    assert.equal(bundle.runtimeStatus, 'running');
    assert.equal(bundle.bundleFacing.deferredHedgeQueue.length, 1);
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

test('runMirrorHedge in paper mode ignores internal trades and skips small external trades', withPatchedModules(async () => {
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
    assert.equal(payload.summary.confirmedExposureCount, 2);
    assert.equal(payload.plan.summary.skippedVolumeCount, 2);
    assert.equal(
      payload.runtime.auditEntries.some((entry) => entry.kind === 'ignored-internal-trade'),
      true,
    );
    assert.equal(
      payload.runtime.auditEntries.some((entry) => entry.kind === 'small-trade-skip'),
      true,
    );
  } finally {
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
