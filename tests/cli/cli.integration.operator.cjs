const shared = require('./cli.integration.shared.cjs');
const { test, assert, crypto, fs, os, path, DOCTOR_ENV_KEYS, createTempDir, removeDir, runCli, runCliAsync, runCliWithTty, startJsonHttpServer, assertSchemaValid, omitGeneratedAt, omitTrustDistributionFromCapabilities, omitTrustDistributionDefinitions, assertManifestParity, createIsolatedPandoraEnv, createMcpToolRegistry, COMMAND_DESCRIPTOR_VERSION, buildCommandDescriptors, createRunMirrorCommand, buildSchemaPayload, buildSetupPlan, createOperationService, upsertOperation, createOperationStateStore, buildSdkContractArtifact, SDK_ARTIFACT_GENERATED_AT, buildPublishedPackageJson, repoPackage, generatedManifest, generatedContractRegistry, latestBenchmarkReport, typescriptSdkPackage, publishedPackage, setupWizardModulePath, setupRuntimeReady, setupTest, testInteractiveSetup, TEST_CLI_PATH, ADDRESSES, POLYMARKET_DEFAULTS, writeFile, parseJsonOutput, delay, isPidAlive, waitForPidExit, parseNdjsonOutput, stableJsonHash, deepCloneJson, parseTomlStringField, buildValidEnv, buildRules, buildMockHypeResponse, FIXED_FUTURE_TIMESTAMP, FIXED_MIRROR_CLOSE_ISO, FIXED_MIRROR_CLOSE_TS, buildMirrorIndexerOverrides, buildMirrorPolymarketOverrides, buildMirrorSportsPolymarketOverrides, buildLaunchArgs, buildCloneArgs, encodeUint256, encodeBool, decodeAddressFromCallData, startRpcMockServer, startPolymarketOpsRpcMock, encodeAddress, encodeString, encodeHexQuantity, startFeesWithdrawRpcMock, startMirrorTraceRpcMock, applyWhereFilter, applyListControls, asPage, resolveBatchEntitySelections, startIndexerMockServer, assertOddsShape, assertIsoTimestamp, startPhaseOneIndexerMockServer, startLifecycleIndexerMockServer, startAnalyzeIndexerMockServer, startPolymarketMockServer } = shared;

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
  assert.equal(Array.isArray(resolvePayload.data.txPlan.supportedMethods), true);
  assert.equal(resolvePayload.data.txPlan.supportedMethods.some((item) => item.functionName === 'resolveMarket'), true);
  assert.equal(resolvePayload.data.txPlan.selection, 'precheck-unavailable');

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
  assert.equal(payload.data.notes.some((note) => /initial-yes-pct/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /yes-reserve-weight-pct/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /distribution-yes-pct.*rejected/i.test(String(note))), true);
});

test('mirror hedge bundle --help no longer advertises manifest-file or Flashbots bundle wording', () => {
  const result = runCli(['--output', 'json', 'mirror', 'hedge', 'bundle', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.command, 'mirror.hedge.bundle.help');
  assert.doesNotMatch(payload.data.usage, /--manifest-file <path>/);
  assert.equal(
    payload.data.notes.some((note) => /deterministic VPS deployment artifacts/i.test(String(note))),
    true,
  );
  assert.equal(
    payload.data.notes.some((note) => /Flashbots-style bundle metadata/i.test(String(note))),
    false,
  );
});

test('mirror hedge status table prints runtime queue and error details', () => {
  const tempDir = createTempDir('pandora-hedge-status-');
  const stateFile = path.join(tempDir, 'hedge-state.json');
  const pidFile = path.join(tempDir, 'hedge-daemon.json');
  const { createMirrorHedgeService } = require('../../cli/lib/mirror_hedge_service.cjs');
  const service = createMirrorHedgeService();

  try {
    service.start({
      stateFile,
      strategyHash: 'abc123abc123abc1',
      marketPairIdentity: {
        pandoraMarketAddress: '0x1111111111111111111111111111111111111111',
        polymarketMarketId: 'poly-1',
        polymarketSlug: 'team-a-vs-team-b',
        marketPairId: 'pair-1',
      },
      whitelistFingerprint: 'whitelist-a',
    });
    service.run({
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
        transactionHash: `0x${'c'.repeat(64)}`,
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
          txHash: `0x${'a'.repeat(64)}`,
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
      skippedVolumeCounters: {
        totalUsdc: 1,
        count: 1,
      },
      managedPolymarketInventorySnapshot: {
        status: 'adopted',
        yesShares: 10,
        noShares: 2,
        netUsdc: 8,
      },
      targetHedgeInventory: {
        yesShares: 0,
        noShares: 4,
        initializedAt: '2026-03-20T00:00:00.000Z',
        initializedFrom: 'flat',
      },
      availableHedgeFeeBudgetUsdc: 1.25,
      belowThresholdPendingUsdc: 0.75,
      retryTelemetry: {
        sellAttemptedCount: 4,
        sellBlockedCount: 2,
        sellFailedCount: 1,
        sellRecoveredCount: 3,
      },
      lastObservedTrade: {
        tradeId: 'trade-telemetry-1',
        confirmedAt: '2026-03-20T00:00:00.000Z',
        observedAt: '2026-03-20T00:00:01.250Z',
        observationLatencyMs: 1250,
      },
      lastHedgeSignal: {
        hedgeId: 'pair-1:buy-no',
        status: 'planned',
        signalAt: '2026-03-20T00:00:01.900Z',
        reactionLatencyMs: 1900,
        observeToSignalLatencyMs: 650,
      },
      lastSuccessfulHedge: {
        hedgeId: 'hedge-1',
        status: 'completed',
        amountUsdc: 5,
        tokenSide: 'yes',
        orderSide: 'buy',
        txHash: `0x${'b'.repeat(64)}`,
        executedAt: '2026-03-20T00:00:00.000Z',
      },
      lastError: {
        code: 'NO_DEPTH',
        message: 'No sell-side depth.',
      },
      lastAlert: {
        code: 'QUEUE_RETRY',
        message: 'Queued for retry.',
      },
    });

    writeFile(pidFile, JSON.stringify({
      strategyHash: 'abc123abc123abc1',
      pid: process.pid,
      stateFile,
      pandoraMarketAddress: '0x1111111111111111111111111111111111111111',
      polymarketMarketId: 'poly-1',
      polymarketSlug: 'team-a-vs-team-b',
      status: 'running',
      pidAlive: true,
    }, null, 2));

    const result = runCli(['mirror', 'hedge', 'status', '--pid-file', pidFile]);
    assert.equal(result.status, 0);
    assert.match(result.output, /runtimeStatus: errored/);
    assert.match(result.output, /ready: yes/);
    assert.match(result.output, /confirmedExposureCount: 1/);
    assert.match(result.output, /pendingOverlayCount: 1/);
    assert.match(result.output, /deferredHedgeCount: 1/);
    assert.match(result.output, /deferredHedgeUsdc: 3/);
    assert.match(result.output, /targetNoShares: 4/);
    assert.match(result.output, /currentYesShares: 10/);
    assert.match(result.output, /currentNoShares: 2/);
    assert.match(result.output, /excessYesToSell: 10/);
    assert.match(result.output, /deficitNoToBuy: 2/);
    assert.match(result.output, /availableHedgeFeeBudgetUsdc: 1.25/);
    assert.match(result.output, /belowThresholdPendingUsdc: 0.75/);
    assert.match(result.output, /sellRetryAttemptedCount: 4/);
    assert.match(result.output, /sellRetryBlockedCount: 2/);
    assert.match(result.output, /sellRetryFailedCount: 1/);
    assert.match(result.output, /sellRetryRecoveredCount: 3/);
    assert.match(result.output, /skippedVolumeUsdc: 1/);
    assert.match(result.output, /lastObservedTradeId: trade-telemetry-1/);
    assert.match(result.output, /lastTradeObservationLatencyMs: 1250/);
    assert.match(result.output, /lastHedgeSignalStatus: planned/);
    assert.match(result.output, /lastHedgeReactionLatencyMs: 1900/);
    assert.match(result.output, /lastSuccessfulHedgeAt: 2026-03-20T00:00:00.000Z/);
    assert.match(result.output, /lastErrorCode: NO_DEPTH/);
    assert.match(result.output, /lastAlertCode: QUEUE_RETRY/);
    assert.match(result.output, /warningCount: 1/);
    assert.match(result.output, /BOTH_SIDE_INVENTORY_LOCKUP/);
  } finally {
    removeDir(tempDir);
  }
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

test('agent market hype missing-area error includes valid areas and a retry example', () => {
  const result = runCli([
    '--output',
    'json',
    'agent',
    'market',
    'hype',
    '--query',
    'suggest ideas',
  ]);

  assert.equal(result.status, 1);
  assert.match(result.output, /--area <sports\|esports\|politics\|regional-news\|breaking-news>/i);
  assert.match(result.output, /agent market hype --area politics --query \\"suggest ideas\\"/i);
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
  assert.equal(payload.data.notes.some((note) => /prefer markets hype plan with --ai-provider auto\|openai\|anthropic/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /mock only for deterministic tests, demos, and evals/i.test(String(note))), true);
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
    assert.equal(payload.data.guidance.mockProviderTestOnly, true);
    assert.equal(payload.data.researchSnapshot.promptKind, 'agent.market.hype');
    assert.equal(payload.data.candidates.length, 1);
    assert.equal(payload.data.selectedCandidate.recommendedMarketType, 'amm');
    assert.equal(payload.data.selectedCandidate.marketDrafts.amm.distributionYes, 430000000);
    assert.equal(payload.data.selectedCandidate.marketDrafts.amm.distributionNo, 570000000);
    assert.equal(payload.data.selectedCandidate.validation.attestation.validationDecision, 'PASS');
    assert.equal(payload.data.selectedCandidate.readyToDeploy, true);
    assert.equal(payload.data.notes.some((note) => /Prefer --ai-provider auto\|openai\|anthropic/i.test(String(note))), true);
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
    assert.equal(payload.data.deployment.deploymentArgs.distributionYes, 430000000);
    assert.equal(payload.data.deployment.deploymentArgs.distributionNo, 570000000);
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
    '--initial-yes-pct',
    '77',
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
  assert.equal(payload.data.marketTemplate.ammProbabilityContract.initialYesProbabilityPct, 77);
  assert.equal(payload.data.marketTemplate.ammProbabilityContract.yesReserveWeightPct, 23);
  assert.equal(payload.data.deployment.mode, 'dry-run');
  assert.equal(payload.data.deployment.deploymentArgs.marketType, 'amm');
  assert.equal(payload.data.deployment.deploymentArgs.distributionYes, 230000000);
  assert.equal(payload.data.deployment.deploymentArgs.distributionNo, 770000000);
  assert.equal(payload.data.deployment.ammProbabilityContract.initialYesProbabilityPct, 77);
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
