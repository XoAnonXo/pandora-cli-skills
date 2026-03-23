const shared = require('./cli.integration.shared.cjs');
const { test, assert, crypto, fs, os, path, DOCTOR_ENV_KEYS, createTempDir, removeDir, runCli, runCliAsync, runCliWithTty, startJsonHttpServer, assertSchemaValid, omitGeneratedAt, omitTrustDistributionFromCapabilities, omitTrustDistributionDefinitions, assertManifestParity, createIsolatedPandoraEnv, createMcpToolRegistry, COMMAND_DESCRIPTOR_VERSION, buildCommandDescriptors, createRunMirrorCommand, buildSchemaPayload, buildSetupPlan, createOperationService, upsertOperation, createOperationStateStore, buildSdkContractArtifact, SDK_ARTIFACT_GENERATED_AT, buildPublishedPackageJson, repoPackage, generatedManifest, generatedContractRegistry, latestBenchmarkReport, typescriptSdkPackage, publishedPackage, setupWizardModulePath, setupRuntimeReady, setupTest, testInteractiveSetup, TEST_CLI_PATH, ADDRESSES, POLYMARKET_DEFAULTS, writeFile, parseJsonOutput, delay, isPidAlive, waitForPidExit, parseNdjsonOutput, stableJsonHash, deepCloneJson, parseTomlStringField, buildValidEnv, buildRules, buildMockHypeResponse, FIXED_FUTURE_TIMESTAMP, FIXED_MIRROR_CLOSE_ISO, FIXED_MIRROR_CLOSE_TS, buildMirrorIndexerOverrides, buildMirrorPolymarketOverrides, buildMirrorSportsPolymarketOverrides, buildLaunchArgs, buildCloneArgs, encodeUint256, encodeBool, decodeAddressFromCallData, startRpcMockServer, startPolymarketOpsRpcMock, encodeAddress, encodeString, encodeHexQuantity, startFeesWithdrawRpcMock, startMirrorTraceRpcMock, applyWhereFilter, applyListControls, asPage, resolveBatchEntitySelections, startIndexerMockServer, assertOddsShape, assertIsoTimestamp, startPhaseOneIndexerMockServer, startLifecycleIndexerMockServer, startAnalyzeIndexerMockServer, startPolymarketMockServer } = shared;

test('mirror plan returns deterministic sizing and distribution payload', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'plan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--with-rules',
      '--include-similarity',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.plan');
    assert.equal(payload.data.schemaVersion, '1.0.0');
    assert.equal(payload.data.sourceMarket.marketId, 'poly-cond-1');
    assert.equal(typeof payload.data.liquidityRecommendation.liquidityUsdc, 'number');
    assert.equal(payload.data.distributionHint.distributionYes + payload.data.distributionHint.distributionNo, 1000000000);
    assert.equal(Array.isArray(payload.data.similarityChecks), true);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror plan computes sports-aware suggested targetTimestamp and cutoff warnings', async () => {
  const polymarket = await startPolymarketMockServer(buildMirrorSportsPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'plan',
      '--skip-dotenv',
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-sports-1',
      '--with-rules',
      '--min-close-lead-seconds',
      '3600',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.command, 'mirror.plan');
    assert.equal(payload.data.sourceMarket.timestampSource, 'game_start_time');
    assert.equal(payload.data.timing.profile.sport, 'basketball');
    assert.equal(payload.data.timing.eventStartTimestampIso, '2030-03-09T23:00:00.000Z');
    assert.equal(payload.data.timing.suggestedTargetTimestampIso, '2030-03-10T04:00:00.000Z');
    assert.equal(payload.data.timing.tradingCutoffTimestampIso, '2030-03-10T03:00:00.000Z');
    assert.match(payload.data.timing.reason, /basketball timing defaults/i);
    assert.equal(
      payload.data.diagnostics.some((line) => /game_start_time/i.test(String(line || ''))),
      true,
    );
  } finally {
    await polymarket.close();
  }
});

test('mirror deploy dry-run uses suggested sports targetTimestamp by default and supports explicit override', async () => {
  const tempDir = createTempDir('pandora-mirror-sports-timing-');
  const planFile = path.join(tempDir, 'mirror-plan.json');
  const polymarket = await startPolymarketMockServer(buildMirrorSportsPolymarketOverrides());

  try {
    const planResult = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'plan',
      '--skip-dotenv',
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-sports-1',
      '--with-rules',
      '--min-close-lead-seconds',
      '3600',
    ]);
    assert.equal(planResult.status, 0);
    fs.writeFileSync(planFile, planResult.stdout, 'utf8');

    const dryRunResult = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'deploy',
      '--skip-dotenv',
      '--plan-file',
      planFile,
      '--dry-run',
      '--sources',
      'https://www.nba.com',
      'https://www.espn.com',
    ]);
    assert.equal(dryRunResult.status, 0);
    const dryRunPayload = parseJsonOutput(dryRunResult);
    assert.equal(dryRunPayload.command, 'mirror.deploy');
    assert.equal(dryRunPayload.data.deploymentArgs.targetTimestamp, Math.floor(Date.parse('2030-03-10T04:00:00Z') / 1000));
    assert.equal(dryRunPayload.data.timing.overrideApplied, false);

    const overrideResult = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'deploy',
      '--skip-dotenv',
      '--plan-file',
      planFile,
      '--dry-run',
      '--target-timestamp',
      '2030-03-10T04:00:00Z',
      '--sources',
      'https://www.nba.com',
      'https://www.espn.com',
    ]);
    assert.equal(overrideResult.status, 0);
    const overridePayload = parseJsonOutput(overrideResult);
    assert.equal(overridePayload.data.deploymentArgs.targetTimestamp, Math.floor(Date.parse('2030-03-10T04:00:00Z') / 1000));
    assert.equal(overridePayload.data.timing.overrideApplied, true);
  } finally {
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror verify exposes confidence, rules hashes, and gate result for agent checks', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'verify',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--include-similarity',
      '--with-rules',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.verify');
    assert.equal(typeof payload.data.matchConfidence, 'number');
    assert.equal(payload.data.gateResult.ok, true);
    assert.equal(typeof payload.data.ruleHashLeft, 'string');
    assert.equal(typeof payload.data.ruleHashRight, 'string');
    assert.equal(Array.isArray(payload.data.similarityChecks), true);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror verify blocks strict rule gate when one side lacks rule text', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer({
    ...buildMirrorPolymarketOverrides(),
    markets: [
      {
        ...buildMirrorPolymarketOverrides().markets[0],
        description: '',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'verify',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--with-rules',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.verify');
    assert.equal(payload.data.gateResult.ok, false);
    assert.equal(payload.data.gateResult.failedChecks.includes('RULE_HASH_MATCH'), true);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror verify falls back to cached Polymarket snapshot when endpoint is unreachable', async () => {
  const tempDir = createTempDir('pandora-mirror-cache-');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const warmResult = await runCliAsync(
      [
        '--output',
        'json',
        'mirror',
        'verify',
        '--skip-dotenv',
        '--indexer-url',
        indexer.url,
        '--polymarket-mock-url',
        polymarket.url,
        '--pandora-market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
      ],
      { env: { HOME: tempDir } },
    );
    assert.equal(warmResult.status, 0);

    const cachedResult = await runCliAsync(
      [
        '--output',
        'json',
        'mirror',
        'verify',
        '--skip-dotenv',
        '--indexer-url',
        indexer.url,
        '--polymarket-mock-url',
        'http://127.0.0.1:9/unreachable',
        '--pandora-market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(cachedResult.status, 0);
    const payload = parseJsonOutput(cachedResult);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.verify');
    assert.equal(payload.data.sourceMarket.source, 'polymarket:cache');
    assert.equal(
      payload.data.sourceMarket.diagnostics.some((line) => String(line).toLowerCase().includes('cached polymarket')),
      true,
    );
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror lp-explain returns complete-set inventory walkthrough payload', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'lp-explain',
    '--liquidity-usdc',
    '10000',
    '--source-yes-pct',
    '58',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.lp-explain');
  assert.equal(payload.data.flow.totalLpInventory.neutralCompleteSets, true);
  assert.equal(payload.data.inputs.distributionYes + payload.data.inputs.distributionNo, 1000000000);
});

test('mirror hedge-calc supports manual reserve inputs', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'hedge-calc',
    '--reserve-yes-usdc',
    '8',
    '--reserve-no-usdc',
    '12',
    '--excess-no-usdc',
    '2',
    '--polymarket-yes-pct',
    '60',
    '--volume-scenarios',
    '1000,5000',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.hedge-calc');
  assert.equal(payload.data.metrics.hedgeToken, 'yes');
  assert.equal(payload.data.scenarios.length, 2);
});

test('mirror hedge-calc can auto-resolve reserves from a mirror pair', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides({
    markets: [
      {
        ...buildMirrorIndexerOverrides().markets[0],
        reserveYes: '8000000',
        reserveNo: '12000000',
      },
    ],
  }));
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'hedge-calc',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.hedge-calc');
    assert.equal(payload.data.metrics.reserveYesUsdc, 8);
    assert.equal(payload.data.metrics.reserveNoUsdc, 12);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror simulate returns deterministic scenarios for LP economics planning', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'simulate',
    '--liquidity-usdc',
    '5000',
    '--source-yes-pct',
    '60',
    '--target-yes-pct',
    '60',
    '--polymarket-yes-pct',
    '60',
    '--volume-scenarios',
    '500,2500',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.simulate');
  assert.equal(payload.data.scenarios.length, 2);
  assert.equal(payload.data.inputs.tradeSide, 'yes');
});

test('simulate namespace supports scoped json help', () => {
  const result = runCli(['--output', 'json', 'simulate', '--help']);
  assert.equal(result.status, 0);

  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'simulate.help');
  assert.match(payload.data.usage, /simulate mc\|particle-filter\|agents/);
});

test('simulate mc returns deterministic CI + VaR/ES with seed replay', () => {
  const args = [
    '--output',
    'json',
    'simulate',
    'mc',
    '--trials',
    '2500',
    '--horizon',
    '48',
    '--start-yes-pct',
    '57',
    '--entry-yes-pct',
    '57',
    '--position',
    'yes',
    '--stake-usdc',
    '100',
    '--drift-bps',
    '0',
    '--vol-bps',
    '175',
    '--confidence',
    '95',
    '--var-level',
    '95',
    '--seed',
    '23',
    '--antithetic',
  ];

  const first = runCli(args);
  const second = runCli(args);
  assert.equal(first.status, 0);
  assert.equal(second.status, 0);

  const firstPayload = parseJsonOutput(first);
  const secondPayload = parseJsonOutput(second);

  assert.equal(firstPayload.command, 'simulate.mc');
  assert.equal(secondPayload.command, 'simulate.mc');
  assert.equal(firstPayload.data.summary.finalYesPct.mean, secondPayload.data.summary.finalYesPct.mean);
  assert.equal(firstPayload.data.summary.pnlUsdc.mean, secondPayload.data.summary.pnlUsdc.mean);
  assert.equal(
    firstPayload.data.summary.risk.valueAtRiskUsdc,
    secondPayload.data.summary.risk.valueAtRiskUsdc,
  );
  assert.equal(
    firstPayload.data.summary.risk.expectedShortfallUsdc,
    secondPayload.data.summary.risk.expectedShortfallUsdc,
  );
  assert.equal(typeof firstPayload.data.summary.finalYesPct.ciLower, 'number');
  assert.equal(typeof firstPayload.data.summary.finalYesPct.ciUpper, 'number');
  assert.equal(typeof firstPayload.data.summary.risk.valueAtRiskUsdc, 'number');
  assert.equal(typeof firstPayload.data.summary.risk.expectedShortfallUsdc, 'number');
});

test('simulate particle-filter consumes inline observations and emits ESS diagnostics', () => {
  const result = runCli([
    '--output',
    'json',
    'simulate',
    'particle-filter',
    '--observations-json',
    '[{\"yesPct\":52},null,{\"yesPct\":49},{\"yesPct\":51}]',
    '--particles',
    '600',
    '--process-noise',
    '0.15',
    '--observation-noise',
    '0.08',
    '--resample-threshold',
    '0.55',
    '--resample-method',
    'systematic',
    '--credible-interval',
    '90',
    '--seed',
    '31',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.command, 'simulate.particle-filter');
  assert.equal(payload.data.trajectory.length, 4);
  assert.equal(payload.data.summary.observedCount, 3);
  assert.equal(payload.data.summary.missingCount, 1);
  assert.equal(typeof payload.data.summary.averageEss, 'number');
  assert.equal(Array.isArray(payload.data.diagnostics), true);
  assert.equal(payload.data.diagnostics.some((item) => item && item.code === 'SPARSE_OBSERVATIONS'), true);
});

test('simulate particle-filter accepts NDJSON file input', () => {
  const tempDir = createTempDir('pandora-simulate-pf-');
  const inputPath = path.join(tempDir, 'observations.ndjson');
  writeFile(
    inputPath,
    ['{\"yesPct\":48}', '{\"yesPct\":49}', '{\"yesPct\":52}', '{\"yesPct\":54}'].join('\n'),
  );

  try {
    const result = runCli([
      '--output',
      'json',
      'simulate',
      'particle-filter',
      '--input',
      inputPath,
      '--particles',
      '700',
      '--seed',
      '5',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.command, 'simulate.particle-filter');
    assert.equal(payload.data.trajectory.length, 4);
    assert.equal(typeof payload.data.summary.final.filteredYesPct, 'number');
  } finally {
    removeDir(tempDir);
  }
});

test('simulate agents returns deterministic ABM diagnostics in json mode', () => {
  const args = [
    '--output',
    'json',
    'simulate',
    'agents',
    '--n-informed',
    '6',
    '--n-noise',
    '20',
    '--n-mm',
    '4',
    '--n-steps',
    '35',
    '--seed',
    '99',
  ];

  const first = runCli(args);
  const second = runCli(args);
  assert.equal(first.status, 0);
  assert.equal(second.status, 0);

  const firstPayload = parseJsonOutput(first);
  const secondPayload = parseJsonOutput(second);
  const { generatedAt: _firstGeneratedAt, ...firstDataStable } = firstPayload.data;
  const { generatedAt: _secondGeneratedAt, ...secondDataStable } = secondPayload.data;

  assert.equal(firstPayload.ok, true);
  assert.equal(firstPayload.command, 'simulate.agents');
  assert.deepEqual(firstDataStable, secondDataStable);
  assert.equal(firstPayload.data.parameters.n_informed, 6);
  assert.equal(firstPayload.data.parameters.n_noise, 20);
  assert.equal(firstPayload.data.parameters.n_mm, 4);
  assert.equal(firstPayload.data.parameters.n_steps, 35);
  assert.equal(typeof firstPayload.data.finalState.midPrice, 'number');
  assert.equal(typeof firstPayload.data.volume.total, 'number');
  assert.equal(typeof firstPayload.data.runtimeBounds.estimatedWorkUnits, 'number');
});

test('mirror simulate --engine mc returns Monte Carlo summary and tail risk blocks', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'simulate',
    '--liquidity-usdc',
    '5000',
    '--source-yes-pct',
    '60',
    '--target-yes-pct',
    '60',
    '--polymarket-yes-pct',
    '60',
    '--engine',
    'mc',
    '--paths',
    '400',
    '--steps',
    '16',
    '--seed',
    '17',
    '--importance-sampling',
    '--antithetic',
    '--control-variate',
    '--stratified',
    '--volume-scenarios',
    '500,2500',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.simulate');
  assert.equal(payload.data.inputs.engine, 'mc');
  assert.equal(payload.data.mc.summary.paths, 400);
  assert.equal(payload.data.mc.summary.steps, 16);
  assert.equal(payload.data.mc.summary.seed, 17);
  assert.equal(typeof payload.data.mc.tailRisk.var95Usdc, 'number');
  assert.equal(typeof payload.data.mc.tailRisk.var99Usdc, 'number');
  assert.equal(typeof payload.data.mc.tailRisk.es95Usdc, 'number');
  assert.equal(typeof payload.data.mc.tailRisk.es99Usdc, 'number');
  assert.ok(payload.data.mc.tailRisk.var99Usdc >= payload.data.mc.tailRisk.var95Usdc);
});

test('model diagnose returns classification and machine-readable gating flags', () => {
  const result = runCli([
    '--output',
    'json',
    'model',
    'diagnose',
    '--calibration-rmse',
    '0.12',
    '--drift-bps',
    '85',
    '--spread-bps',
    '70',
    '--depth-coverage',
    '0.72',
    '--informed-flow-ratio',
    '0.61',
    '--noise-ratio',
    '0.34',
    '--anomaly-rate',
    '0.08',
    '--manipulation-alerts',
    '1',
    '--tail-dependence',
    '0.22',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'model.diagnose');
  assert.equal(typeof payload.data.aggregate.classification, 'string');
  assert.equal(typeof payload.data.flags.allowExecution, 'boolean');
  assert.equal(typeof payload.data.flags.requireHumanReview, 'boolean');
  assert.equal(typeof payload.data.flags.blockExecution, 'boolean');
});

test('mirror deploy dry-run materializes deployment args without chain writes', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'deploy',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--dry-run',
      '--fee-tier',
      '50000',
      '--sources',
      'https://www.nba.com',
      'https://www.espn.com',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.deploy');
    assert.equal(payload.data.schemaVersion, '1.0.0');
    assert.equal(payload.data.dryRun, true);
    assert.equal(payload.data.tx, null);
    assert.equal(payload.data.deploymentArgs.feeTier, 50000);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror deploy rejects fee tiers above 5%', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'deploy',
    '--dry-run',
    '--polymarket-market-id',
    'poly-cond-1',
    '--fee-tier',
    '50001',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /--fee-tier must be between 500 and 50000/i);
});

test('mirror deploy validates --private-key format', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'deploy',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--dry-run',
      '--sources',
      'https://www.nba.com',
      'https://www.espn.com',
      '--private-key',
      '0x1234',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
    assert.match(payload.error.message, /--private-key must be a valid private key/i);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror deploy translates Polymarket winner rules into Pandora YES/NO format', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer({
    ...buildMirrorPolymarketOverrides(),
    markets: [
      {
        ...buildMirrorPolymarketOverrides().markets[0],
        question: 'Will the Detroit Pistons beat the Brooklyn Nets?',
        description: 'This market resolves to Detroit Pistons.',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'deploy',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--dry-run',
      '--sources',
      'https://www.nba.com',
      'https://www.espn.com',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.deploy');
    assert.equal(payload.data.deploymentArgs.question, 'Will the Detroit Pistons beat the Brooklyn Nets?');
    assert.match(payload.data.deploymentArgs.rules, /^YES: The official winner of the event described in the market question is the Detroit Pistons\./);
    assert.match(payload.data.deploymentArgs.rules, /^NO: The official winner is the Brooklyn Nets,/m);
    assert.match(payload.data.deploymentArgs.rules, /^EDGE: /m);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror deploy rejects missing explicit sources instead of auto-adding Polymarket URLs', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'deploy',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--dry-run',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'MIRROR_SOURCES_REQUIRED');
    assert.match(payload.error.message, /explicit independent public resolution sources/i);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror deploy rejects Polymarket URLs in explicit --sources', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'deploy',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--dry-run',
      '--sources',
      'https://polymarket.com/event/test-market',
      'https://clob.polymarket.com',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'MIRROR_SOURCES_INVALID');
    assert.match(payload.error.message, /not allowed in --sources/i);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror deploy rejects same-host sources that are not independent', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'deploy',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--dry-run',
      '--sources',
      'https://www.nba.com/game/1',
      'https://www.nba.com/game/2',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'MIRROR_SOURCES_REQUIRED');
    assert.match(payload.error.message, /different hosts/i);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror deploy execute requires a validation ticket before any live write', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'deploy',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--execute',
      '--sources',
      'https://www.nba.com',
      'https://www.espn.com',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'MIRROR_VALIDATION_REQUIRED');
    assert.match(payload.error.message, /validation-ticket/i);
    assert.equal(payload.error.recovery.command.includes('agent market validate'), true);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror go accepts named --skip-gate lists during parsing', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'go',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--polymarket-market-id',
      'poly-cond-1',
      '--paper',
      '--auto-sync',
      '--sources',
      'https://www.nba.com',
      'https://www.espn.com',
      '--skip-gate',
      'MAX_TRADES_PER_DAY,DEPTH_COVERAGE',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'MIRROR_GO_SYNC_REQUIRES_DEPLOYED_MARKET');
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror sync rejects invalid rebalance route enums using flashbots naming contract', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'sync',
    'once',
    '--skip-dotenv',
    '--pandora-market-address',
    ADDRESSES.mirrorMarket,
    '--polymarket-market-id',
    'poly-cond-1',
    '--paper',
    '--rebalance-route',
    'private',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /--rebalance-route must be public\|auto\|flashbots-private\|flashbots-bundle\./);
});

test('mirror command dispatcher preserves normalized live sync trade execution payloads including flashbots routing contract', async () => {
  class TestCliError extends Error {
    constructor(code, message, details = null) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }

  const captured = {
    callOrder: [],
  };
  const quotePayload = {
    quoteAvailable: true,
    odds: { yesPct: 57, noPct: 43 },
    estimate: { estimatedShares: 43.859649, minSharesOut: 43.201754 },
  };
  let emitted = null;

  const runMirrorCommand = createRunMirrorCommand({
    CliError: TestCliError,
    emitSuccess: (_mode, command, payload) => {
      emitted = { command, payload };
    },
    commandHelpPayload: () => ({}),
    parseIndexerSharedFlags: (args) => ({
      rest: args,
      indexerUrl: 'https://indexer.example/graphql',
      timeoutMs: 1000,
    }),
    includesHelpFlag: () => false,
    maybeLoadTradeEnv: () => {},
    resolveIndexerUrl: (value) => value || 'https://indexer.example/graphql',
    parseMirrorSyncDaemonSelectorFlags: () => {
      throw new Error('selector flags should not be read for once mode');
    },
    stopMirrorDaemon: async () => {
      throw new Error('stopMirrorDaemon should not run for once mode');
    },
    mirrorDaemonStatus: () => {
      throw new Error('mirrorDaemonStatus should not run for once mode');
    },
    parseMirrorSyncFlags: () => ({
      mode: 'once',
      stream: false,
      daemon: false,
      executeLive: true,
      trustDeploy: false,
      pandoraMarketAddress: ADDRESSES.mirrorMarket,
      polymarketMarketId: 'poly-cond-1',
      polymarketSlug: null,
      chainId: 1,
      rpcUrl: 'https://rpc.example',
      fork: false,
      forkRpcUrl: null,
      forkChainId: null,
      privateKey: `0x${'1'.repeat(64)}`,
      profileId: null,
      profileFile: null,
      usdc: ADDRESSES.usdc,
      failOnWebhookError: false,
      rebalanceRoute: 'flashbots-bundle',
      rebalanceRouteFallback: 'public',
      flashbotsRelayUrl: 'https://relay.flashbots.example',
      flashbotsAuthKey: 'test-flashbots-auth-key',
      flashbotsTargetBlockOffset: 3,
    }),
    buildMirrorSyncStrategy: () => ({}),
    mirrorStrategyHash: () => 'strategy-hash',
    buildMirrorSyncDaemonCliArgs: () => [],
    startMirrorDaemon: async () => {
      throw new Error('startMirrorDaemon should not run for once mode');
    },
    resolveTrustedDeployPair: () => {
      throw new Error('resolveTrustedDeployPair should not run without trustDeploy');
    },
    selectHealthyPolymarketRpc: async () => ({
      selectedRpcUrl: 'https://polygon-rpc.example',
      fallbackUsed: false,
      attempts: [{ rpcUrl: 'https://polygon-rpc.example', ok: true, order: 1, chainId: 137 }],
      diagnostics: [],
    }),
    runLivePolymarketPreflightForMirror: async () => ({ ok: true }),
    runMirrorSync: async (_options, runtimeDeps) => {
      const result = await runtimeDeps.rebalanceFn({
        marketAddress: ADDRESSES.mirrorMarket,
        side: 'yes',
        amountUsdc: 25,
      });
      return {
        mode: 'once',
        strategyHash: 'strategy-hash',
        actionCount: 1,
        actions: [{ status: 'executed', rebalance: { result } }],
        snapshots: [],
        diagnostics: [],
        state: { tradesToday: 1, idempotencyKeys: [] },
      };
    },
    buildQuotePayload: async (_indexerUrl, tradeOptions) => {
      captured.callOrder.push('quote');
      captured.quoteTradeOptions = tradeOptions;
      return quotePayload;
    },
    enforceTradeRiskGuards: (tradeOptions, quote) => {
      captured.callOrder.push('guard');
      captured.guardTradeOptions = tradeOptions;
      captured.guardQuote = quote;
    },
    executeTradeOnchain: async (tradeOptions) => {
      captured.callOrder.push('execute');
      captured.executionTradeOptions = tradeOptions;
      return {
        ok: true,
        marketType: 'amm',
        tradeSignature: 'buy(bool,uint256,uint256,uint256)',
        ammDeadlineEpoch: '1710000910',
      };
    },
    assertLiveWriteAllowed: async () => {},
    hasWebhookTargets: () => false,
    sendWebhookNotifications: async () => ({ failureCount: 0 }),
    coerceMirrorServiceError: (error) => error,
    renderMirrorSyncTickLine: () => {},
    renderMirrorSyncDaemonTable: () => {},
    renderMirrorSyncTable: () => {},
    cliPath: TEST_CLI_PATH,
  });

  await runMirrorCommand(['sync', 'once'], { outputMode: 'json' });

  assert.equal(emitted.command, 'mirror.sync');
  assert.deepEqual(captured.callOrder, ['quote', 'guard', 'execute']);
  assert.equal(captured.guardTradeOptions, captured.executionTradeOptions);
  assert.equal(captured.quoteTradeOptions, captured.executionTradeOptions);
  assert.equal(captured.executionTradeOptions.mode, 'buy');
  assert.equal(captured.executionTradeOptions.amount, null);
  assert.equal(captured.executionTradeOptions.minAmountOutRaw, null);
  assert.equal(captured.executionTradeOptions.allowUnquotedExecute, true);
  assert.equal(captured.executionTradeOptions.deadlineSeconds, 900);
  assert.equal(captured.executionTradeOptions.rebalanceRoute, 'flashbots-bundle');
  assert.equal(captured.executionTradeOptions.rebalanceRouteFallback, 'public');
  assert.equal(captured.executionTradeOptions.flashbotsRelayUrl, 'https://relay.flashbots.example');
  assert.equal(captured.executionTradeOptions.flashbotsAuthKey, 'test-flashbots-auth-key');
  assert.equal(captured.executionTradeOptions.flashbotsTargetBlockOffset, 3);
  assert.equal(captured.guardQuote, quotePayload);
  assert.equal(emitted.payload.actions[0].rebalance.result.quote, quotePayload);
  assert.equal(emitted.payload.actions[0].rebalance.result.ammDeadlineEpoch, '1710000910');
});

test('mirror sync once paper mode performs deterministic simulated action and persists state', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const killFile = path.join(tempDir, 'STOP');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'sync',
      'once',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--paper',
      '--funder',
      '0x2222222222222222222222222222222222222222',
      '--drift-trigger-bps',
      '25',
      '--hedge-trigger-usdc',
      '1000000',
      '--hedge-ratio',
      '0.75',
      '--state-file',
      stateFile,
      '--kill-switch-file',
      killFile,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.sync');
    assert.equal(payload.data.mode, 'once');
    assert.equal(payload.data.executeLive, false);
    assert.equal(payload.data.parameters.hedgeEnabled, true);
    assert.equal(payload.data.parameters.hedgeRatio, 0.75);
    assert.equal(payload.data.actionCount, 1);
    assert.equal(payload.data.snapshots[0].metrics.rebalanceSizingBasis, 'atomic-target-price');
    assert.equal(typeof payload.data.snapshots[0].metrics.rebalanceTargetUsdc, 'number');
    assert.equal(payload.data.snapshots[0].metrics.plannedRebalanceUsdc, 25);
    assert.equal(fs.existsSync(stateFile), true);
    assert.equal(payload.data.actions[0].status, 'simulated');
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror sync treats close-time mismatch as diagnostic by default and blocking in strict close delta mode', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-close-delta-');
  const diagnosticStateFile = path.join(tempDir, 'mirror-state-diagnostic.json');
  const strictStateFile = path.join(tempDir, 'mirror-state-strict.json');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer({
    markets: [
      {
        ...buildMirrorPolymarketOverrides().markets[0],
        end_date_iso: '2030-03-10T01:00:00Z',
      },
    ],
  });

  try {
    const diagnosticResult = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'sync',
      'once',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--paper',
      '--drift-trigger-bps',
      '25',
      '--hedge-trigger-usdc',
      '1000000',
      '--min-time-to-close-sec',
      '5',
      '--state-file',
      diagnosticStateFile,
    ]);

    assert.equal(diagnosticResult.status, 0);
    const diagnosticPayload = parseJsonOutput(diagnosticResult);
    assert.equal(diagnosticPayload.ok, true);
    assert.equal(diagnosticPayload.data.actionCount, 1);
    assert.equal(diagnosticPayload.data.actions[0].status, 'simulated');
    assert.equal(diagnosticPayload.data.snapshots[0].strictGate.ok, true);
    assert.equal(
      diagnosticPayload.data.snapshots[0].strictGate.checks.find((item) => item.code === 'CLOSE_TIME_DELTA').details.diagnosticOnly,
      true,
    );

    const strictResult = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'sync',
      'once',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--paper',
      '--strict-close-time-delta',
      '--drift-trigger-bps',
      '25',
      '--hedge-trigger-usdc',
      '1000000',
      '--min-time-to-close-sec',
      '5',
      '--state-file',
      strictStateFile,
    ]);

    assert.equal(strictResult.status, 0);
    const strictPayload = parseJsonOutput(strictResult);
    assert.equal(strictPayload.ok, true);
    assert.equal(strictPayload.data.actionCount, 0);
    assert.equal(strictPayload.data.snapshots[0].action.status, 'blocked');
    assert.deepEqual(strictPayload.data.snapshots[0].action.failedChecks, ['CLOSE_TIME_DELTA']);
    assert.deepEqual(strictPayload.data.snapshots[0].strictGate.failedChecks, ['CLOSE_TIME_DELTA']);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror sync --skip-gate keeps legacy skip-all bypass behavior', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-skip-all-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        lastResetDay: new Date().toISOString().slice(0, 10),
        tradesToday: 1,
      },
      null,
      2,
    ),
  );

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'sync',
      'once',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--paper',
      '--drift-trigger-bps',
      '25',
      '--hedge-trigger-usdc',
      '1000000',
      '--max-trades-per-day',
      '1',
      '--skip-gate',
      '--state-file',
      stateFile,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.sync');
    assert.equal(payload.data.actionCount, 1);
    assert.equal(payload.data.actions[0].status, 'simulated');
    assert.equal(payload.data.actions[0].forcedGateBypass, true);
    assert.equal(payload.data.actions[0].bypassedFailedChecks.includes('MAX_TRADES_PER_DAY'), true);
    assert.equal(payload.data.snapshots[0].strictGate.ok, true);
    assert.equal(payload.data.snapshots[0].strictGate.failedChecksRaw.includes('MAX_TRADES_PER_DAY'), true);
    assert.equal(payload.data.snapshots[0].strictGate.bypassedFailedChecks.includes('MAX_TRADES_PER_DAY'), true);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror sync --skip-gate with named checks bypasses only matching failures', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-skip-selective-');
  const bypassStateFile = path.join(tempDir, 'mirror-state-bypass.json');
  const blockedStateFile = path.join(tempDir, 'mirror-state-blocked.json');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  fs.writeFileSync(
    bypassStateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        lastResetDay: new Date().toISOString().slice(0, 10),
        tradesToday: 1,
      },
      null,
      2,
    ),
  );

  try {
    const selectiveBypassResult = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'sync',
      'once',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--paper',
      '--drift-trigger-bps',
      '25',
      '--hedge-trigger-usdc',
      '1000000',
      '--max-trades-per-day',
      '1',
      '--skip-gate=MAX_TRADES_PER_DAY',
      '--state-file',
      bypassStateFile,
    ]);

    assert.equal(selectiveBypassResult.status, 0);
    const selectiveBypassPayload = parseJsonOutput(selectiveBypassResult);
    assert.equal(selectiveBypassPayload.ok, true);
    assert.equal(selectiveBypassPayload.command, 'mirror.sync');
    assert.equal(selectiveBypassPayload.data.parameters.forceGate, false);
    assert.deepEqual(selectiveBypassPayload.data.parameters.skipGateChecks, ['MAX_TRADES_PER_DAY']);
    assert.equal(selectiveBypassPayload.data.actionCount, 1);
    assert.equal(selectiveBypassPayload.data.actions[0].status, 'simulated');
    assert.equal(selectiveBypassPayload.data.actions[0].failedChecks.length, 0);
    assert.equal(selectiveBypassPayload.data.actions[0].bypassedFailedChecks.includes('MAX_TRADES_PER_DAY'), true);

    fs.writeFileSync(
      blockedStateFile,
      JSON.stringify(
        {
          schemaVersion: '1.0.0',
          lastResetDay: new Date().toISOString().slice(0, 10),
          tradesToday: 1,
        },
        null,
        2,
      ),
    );

    const selectiveNoBypassResult = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'sync',
      'once',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--paper',
      '--drift-trigger-bps',
      '25',
      '--hedge-trigger-usdc',
      '1000000',
      '--max-trades-per-day',
      '1',
      '--skip-gate',
      'DEPTH_COVERAGE',
      '--state-file',
      blockedStateFile,
    ]);

    assert.equal(selectiveNoBypassResult.status, 0);
    const selectiveNoBypassPayload = parseJsonOutput(selectiveNoBypassResult);
    assert.equal(selectiveNoBypassPayload.ok, true);
    assert.equal(selectiveNoBypassPayload.command, 'mirror.sync');
    assert.deepEqual(selectiveNoBypassPayload.data.parameters.skipGateChecks, ['DEPTH_COVERAGE']);
    assert.equal(selectiveNoBypassPayload.data.actionCount, 0);
    assert.equal(selectiveNoBypassPayload.data.snapshots[0].action.status, 'blocked');
    assert.equal(selectiveNoBypassPayload.data.snapshots[0].action.failedChecks.includes('MAX_TRADES_PER_DAY'), true);
    assert.equal(selectiveNoBypassPayload.data.snapshots[0].action.bypassedFailedChecks.length, 0);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror sync --no-hedge suppresses hedge trigger path while preserving snapshot diagnostics', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-no-hedge-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const indexer = await startIndexerMockServer(
    buildMirrorIndexerOverrides({
      markets: [
        {
          id: ADDRESSES.mirrorMarket,
          chainId: 1,
          chainName: 'ethereum',
          pollAddress: ADDRESSES.mirrorPoll,
          creator: ADDRESSES.wallet1,
          marketType: 'amm',
          marketCloseTimestamp: FIXED_MIRROR_CLOSE_TS,
          totalVolume: '100000',
          currentTvl: '200000',
          yesChance: '0.80',
          reserveYes: '80000000',
          reserveNo: '20000000',
          createdAt: '1700000000',
        },
      ],
    }),
  );
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'sync',
      'once',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--pandora-market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--paper',
      '--drift-trigger-bps',
      '2000',
      '--hedge-trigger-usdc',
      '10',
      '--no-hedge',
      '--state-file',
      stateFile,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.sync');
    assert.equal(payload.data.parameters.hedgeEnabled, false);
    assert.equal(payload.data.actionCount, 0);
    assert.equal(payload.data.snapshots[0].metrics.rawHedgeTriggered, true);
    assert.equal(payload.data.snapshots[0].metrics.hedgeTriggered, false);
    assert.equal(payload.data.snapshots[0].metrics.hedgeSuppressed, true);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror sync validates --hedge-ratio upper bound', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'sync',
    'once',
    '--skip-dotenv',
    '--pandora-market-address',
    ADDRESSES.mirrorMarket,
    '--polymarket-market-id',
    'poly-cond-1',
    '--paper',
    '--hedge-ratio',
    '2.5',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /--hedge-ratio/);
});

test('mirror sync --help json includes live hedge environment requirements', () => {
  const result = runCli(['--output', 'json', 'mirror', 'sync', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.sync.help');
  assert.equal(Array.isArray(payload.data.notes), true);
  assert.equal(Array.isArray(payload.data.liveHedgeEnv), true);
  assert.equal(payload.data.liveHedgeEnv.includes('POLYMARKET_PRIVATE_KEY'), true);
  assert.equal(payload.data.liveHedgeEnv.includes('POLYMARKET_API_KEY'), true);
  assert.match(payload.data.usage, /--funder <address>/);
  assert.match(payload.data.usage, /--profile-id <id>\|--profile-file <path>/);
  assert.match(payload.data.usage, /--polymarket-rpc-url <url>/);
  assert.match(payload.data.usage, /--min-time-to-close-sec <n>/);
  assert.match(payload.data.usage, /--strict-close-time-delta/);
  assert.match(payload.data.usage, /--verbose/);
  assert.doesNotMatch(payload.data.usage, /--daemon/);
  assert.match(payload.data.usage, /--hedge-scope pool\|total/);
  assert.match(payload.data.usage, /--skip-initial-hedge/);
  assert.match(payload.data.usage, /--adopt-existing-positions/);
  assert.match(payload.data.usage, /--rebalance-mode atomic\|incremental/);
  assert.match(payload.data.usage, /--price-source on-chain\|indexer/);
  assert.match(payload.data.usage, /--rebalance-route public\|auto\|flashbots-private\|flashbots-bundle/);
  assert.match(payload.data.usage, /--rebalance-route-fallback fail\|public/);
  assert.match(payload.data.usage, /--flashbots-relay-url <url>/);
  assert.match(payload.data.usage, /--flashbots-auth-key <key>/);
  assert.match(payload.data.usage, /--flashbots-target-block-offset <n>/);
  assert.match(payload.data.liveHedgeNotes.rpcFallback, /comma-separated/i);
  assert.match(payload.data.liveHedgeNotes.collateral, /scope mismatch/i);
  assert.match(payload.data.liveHedgeNotes.collateral, /buying power/i);
  assert.match(payload.data.statusTelemetry.health, /runtime\.health/i);
  assert.match(payload.data.statusTelemetry.lastTrade, /runtime\.lastTrade/i);
  assert.match(payload.data.statusTelemetry.errors, /runtime\.errorCount/i);
  assert.match(payload.data.statusTelemetry.nextAction, /runtime\.nextAction/i);
  assert.match(payload.data.staleCacheFallback, /cached snapshots/i);
  assert.equal(payload.data.notes.some((note) => /\.pandora\/mirror\/STOP/.test(String(note))), true);
  assert.match(payload.data.daemonLifecycle.unlock, /mirror sync unlock/);
  assert.equal(payload.data.notes.some((note) => /mirror sync unlock/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /does not accept a `--source` flag/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /--stream.*JSON mode is restricted/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /Live mirror sync requires both `--max-open-exposure-usdc` and `--max-trades-per-day`/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /Hedging is enabled by default/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /adopt-existing-positions/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /Default hedge scope is `total`/i.test(String(note))), true);
});

test('mirror sync unlock --help returns recovery-specific guidance', () => {
  const result = runCli(['--output', 'json', 'mirror', 'sync', 'unlock', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.sync.unlock.help');
  assert.match(payload.data.usage, /--state-file <path>\|--strategy-hash <hash>/);
  assert.match(payload.data.usage, /--force/);
  assert.equal(payload.data.notes.some((note) => /zombie/i.test(String(note))), true);
});

test('mirror go --help json includes flashbots routing flag contract', () => {
  const result = runCli(['--output', 'json', 'mirror', 'go', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.go.help');
  assert.equal(Array.isArray(payload.data.notes), true);
  assert.match(payload.data.usage, /--rebalance-route public\|auto\|flashbots-private\|flashbots-bundle/);
  assert.match(payload.data.usage, /--rebalance-route-fallback fail\|public/);
  assert.match(payload.data.usage, /--flashbots-relay-url <url>/);
  assert.match(payload.data.usage, /--flashbots-auth-key <key>/);
  assert.match(payload.data.usage, /--flashbots-target-block-offset <n>/);
  assert.match(payload.data.usage, /--auto-resolve/);
  assert.match(payload.data.usage, /--auto-close/);
  assert.match(payload.data.usage, /--resolve-answer yes\|no/);
  assert.match(payload.data.usage, /--resolve-reason <text>/);
  assert.match(payload.data.usage, /--hedge-scope pool\|total/);
  assert.match(payload.data.usage, /--skip-initial-hedge/);
  assert.equal(payload.data.notes.some((note) => /validation tickets are bound to the exact final deploy payload/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /two independent public --sources.*even in paper mode/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /market_deployer_a.*prod_trader_a|prod_trader_a.*market_deployer_a/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /auto.*rebalance-route-fallback public/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /flashbots-private.*cannot carry approval/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /does not accept a daemon `--source` selector/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /hedging stays enabled by default/i.test(String(note))), true);
});

test('mirror deploy --help json surfaces validation-ticket caveats and reserve-weight distribution flags', () => {
  const result = runCli(['--output', 'json', 'mirror', 'deploy', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.deploy.help');
  assert.equal(Array.isArray(payload.data.notes), true);
  assert.match(payload.data.usage, /--initial-yes-pct <pct>\|--initial-no-pct <pct>/);
  assert.match(payload.data.usage, /--yes-reserve-weight-pct <pct>/);
  assert.match(payload.data.usage, /--no-reserve-weight-pct <pct>/);
  assert.equal(payload.data.notes.some((note) => /exact final deploy payload/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /initial-yes-pct.*opening probability directly/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /distribution-yes-pct.*rejected/i.test(String(note))), true);
});

test('mirror trace --help json includes historical reserve tracing usage and archive notes', () => {
  const result = runCli(['--output', 'json', 'mirror', 'trace', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.trace.help');
  assert.match(payload.data.usage, /mirror trace/);
  assert.match(payload.data.usage, /--rpc-url <url>/);
  assert.match(payload.data.usage, /--blocks <csv>/);
  assert.match(payload.data.usage, /--from-block <n>/);
  assert.match(payload.data.usage, /--to-block <n>/);
  assert.equal(Array.isArray(payload.data.notes), true);
  assert.equal(payload.data.notes.some((note) => /archive/i.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /historical reserve/i.test(String(note))), true);
});

test('command descriptors expose flashbots routing flags for mirror go and sync surfaces', () => {
  const descriptors = buildCommandDescriptors();

  assert.ok(descriptors['mirror.go']);
  assert.match(descriptors['mirror.go'].usage, /--rebalance-route public\|auto\|flashbots-private\|flashbots-bundle/);
  assert.match(descriptors['mirror.go'].usage, /--rebalance-route-fallback fail\|public/);
  assert.match(descriptors['mirror.go'].usage, /--flashbots-relay-url <url>/);
  assert.match(descriptors['mirror.go'].usage, /--flashbots-auth-key <key>/);
  assert.match(descriptors['mirror.go'].usage, /--flashbots-target-block-offset <n>/);
  assert.match(descriptors['mirror.go'].usage, /--auto-resolve/);
  assert.match(descriptors['mirror.go'].usage, /--auto-close/);
  assert.match(descriptors['mirror.go'].usage, /--resolve-answer yes\|no/);
  assert.match(descriptors['mirror.go'].usage, /--hedge-scope pool\|total/);
  assert.match(descriptors['mirror.go'].usage, /--skip-initial-hedge/);
  assert.ok(descriptors['mirror.go'].inputSchema.properties['hedge-scope']);
  assert.ok(descriptors['mirror.go'].inputSchema.properties['skip-initial-hedge']);

  for (const commandName of ['mirror.sync.once', 'mirror.sync.run', 'mirror.sync.start']) {
    assert.ok(descriptors[commandName], `missing descriptor for ${commandName}`);
    assert.match(
      descriptors[commandName].usage,
      /--rebalance-route public\|auto\|flashbots-private\|flashbots-bundle/,
      `${commandName} usage should advertise rebalanceRoute contract`,
    );
    assert.match(
      descriptors[commandName].usage,
      /--rebalance-route-fallback fail\|public/,
      `${commandName} usage should advertise rebalanceRouteFallback contract`,
    );
    assert.match(
      descriptors[commandName].usage,
      /--flashbots-relay-url <url>/,
      `${commandName} usage should advertise flashbotsRelayUrl`,
    );
    assert.match(
      descriptors[commandName].usage,
      /--flashbots-auth-key <key>/,
      `${commandName} usage should advertise flashbotsAuthKey`,
    );
    assert.match(
      descriptors[commandName].usage,
      /--flashbots-target-block-offset <n>/,
      `${commandName} usage should advertise flashbotsTargetBlockOffset`,
    );
    assert.match(
      descriptors[commandName].usage,
      /--hedge-scope pool\|total/,
      `${commandName} usage should advertise hedgeScope`,
    );
    assert.match(
      descriptors[commandName].usage,
      /--skip-initial-hedge/,
      `${commandName} usage should advertise skipInitialHedge`,
    );
    assert.match(
      descriptors[commandName].usage,
      /--adopt-existing-positions/,
      `${commandName} usage should advertise adoptExistingPositions`,
    );
    assert.match(
      descriptors[commandName].usage,
      /--verbose/,
      `${commandName} usage should advertise verbose`,
    );
    assert.ok(descriptors[commandName].inputSchema.properties.verbose, `${commandName} schema should expose verbose`);
    assert.ok(
      descriptors[commandName].inputSchema.properties['hedge-scope'],
      `${commandName} schema should expose hedgeScope`,
    );
    assert.ok(
      descriptors[commandName].inputSchema.properties['adopt-existing-positions'],
      `${commandName} schema should expose adoptExistingPositions`,
    );
    assert.ok(
      descriptors[commandName].inputSchema.properties['skip-initial-hedge'],
      `${commandName} schema should expose skipInitialHedge`,
    );
  }

  assert.ok(descriptors['mirror.sync.unlock']);
  assert.match(descriptors['mirror.sync.unlock'].usage, /--state-file <path>\|--strategy-hash <hash>/);
  assert.match(descriptors['mirror.sync.unlock'].usage, /--force/);
});

test('command descriptors surface validation, distribution, and stop-file caveats for agent workflows', () => {
  const descriptors = buildCommandDescriptors();

  assert.equal(
    descriptors['markets.create.run'].agentWorkflow.notes.some((note) => /exact final payload/i.test(String(note))),
    true,
  );
  assert.equal(
    descriptors['markets.create.run'].agentWorkflow.notes.some((note) => /balanced 50\/50 pool/i.test(String(note))),
    true,
  );
  assert.equal(
    descriptors['markets.create.run'].agentWorkflow.notes.some((note) => /distribution-yes-pct.*rejected/i.test(String(note))),
    true,
  );
  assert.ok(descriptors['markets.create.run'].inputSchema.properties['yes-reserve-weight-pct']);
  assert.ok(descriptors['markets.create.run'].inputSchema.properties['no-reserve-weight-pct']);

  assert.match(descriptors['mirror.go'].usage, /--initial-yes-pct <pct>\|--initial-no-pct <pct>/);
  assert.match(descriptors['mirror.go'].usage, /--yes-reserve-weight-pct <pct>/);
  assert.match(descriptors['mirror.go'].usage, /--no-reserve-weight-pct <pct>/);
  assert.ok(descriptors['mirror.go'].inputSchema.properties['initial-yes-pct']);
  assert.ok(descriptors['mirror.go'].inputSchema.properties['initial-no-pct']);
  assert.ok(descriptors['mirror.go'].inputSchema.properties['yes-reserve-weight-pct']);
  assert.ok(descriptors['mirror.go'].inputSchema.properties['no-reserve-weight-pct']);
  assert.match(descriptors['mirror.deploy'].usage, /--yes-reserve-weight-pct <pct>/);
  assert.match(descriptors['mirror.deploy'].usage, /--no-reserve-weight-pct <pct>/);
  assert.match(descriptors['mirror.deploy'].usage, /--initial-yes-pct <pct>\|--initial-no-pct <pct>/);
  assert.ok(descriptors['mirror.deploy'].inputSchema.properties['initial-yes-pct']);
  assert.ok(descriptors['mirror.deploy'].inputSchema.properties['initial-no-pct']);
  assert.ok(descriptors['mirror.deploy'].inputSchema.properties['yes-reserve-weight-pct']);
  assert.ok(descriptors['mirror.deploy'].inputSchema.properties['no-reserve-weight-pct']);
  assert.equal(
    descriptors['mirror.deploy'].agentWorkflow.notes.some((note) => /exact final deploy payload/i.test(String(note))),
    true,
  );
  assert.equal(
    descriptors['mirror.go'].agentWorkflow.notes.some((note) => /exact final deploy payload/i.test(String(note))),
    true,
  );
  assert.equal(
    descriptors['mirror.go'].agentWorkflow.notes.some((note) => /initial-yes-pct.*opening probability directly/i.test(String(note))),
    true,
  );
  assert.equal(
    descriptors['mirror.go'].agentWorkflow.notes.some((note) => /distribution-yes-pct.*rejected/i.test(String(note))),
    true,
  );

  for (const commandName of ['mirror.sync.once', 'mirror.sync.run', 'mirror.sync.start']) {
    assert.equal(
      descriptors[commandName].agentWorkflow.notes.some((note) => /\.pandora\/mirror\/STOP/.test(String(note))),
      true,
      `${commandName} should surface the default mirror stop file caveat`,
    );
  }

  assert.equal(
    descriptors['mirror.panic'].agentWorkflow.notes.some((note) => /\.pandora\/mirror\/STOP/.test(String(note))),
    true,
  );
});

test('mirror --help json includes batch-1 sync semantics notes', () => {
  const result = runCli(['--output', 'json', 'mirror', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.help');
  assert.equal(Array.isArray(payload.data.notes), true);
  assert.equal(payload.data.notes.some((note) => /paper\/simulated mode/i.test(note)), true);
  assert.equal(payload.data.notes.some((note) => /not atomic/i.test(note)), true);
  assert.equal(payload.data.notes.some((note) => /reserveSource/.test(note)), true);
  assert.equal(payload.data.notes.some((note) => /MIRROR_EXPIRY_TOO_CLOSE/.test(note)), true);
  assert.equal(payload.data.notes.some((note) => /strict-close-time-delta/.test(note)), true);
  assert.equal(payload.data.notes.some((note) => /cached snapshots/.test(note)), true);
  assert.equal(payload.data.notes.some((note) => /cached or stale/i.test(note)), true);
  assert.equal(payload.data.notes.some((note) => /--polymarket-rpc-url/.test(note)), true);
  assert.equal(payload.data.notes.some((note) => /verifyDiagnostics/.test(note)), true);
  assert.equal(payload.data.notes.some((note) => /logFile/.test(note)), true);
  assert.equal(payload.data.notes.some((note) => /\.pandora\/mirror\/STOP/.test(String(note))), true);
  assert.equal(payload.data.notes.some((note) => /validation tickets are bound to the exact final deploy payload/i.test(String(note))), true);
});

test('mirror trace returns structured historical reserve snapshots for explicit block lists', async () => {
  const rpc = await startMirrorTraceRpcMock({
    snapshots: [
      {
        blockNumber: 111,
        timestamp: 1_700_000_000,
        reserveYesRaw: 4_000_000n,
        reserveNoRaw: 6_000_000n,
      },
      {
        blockNumber: 112,
        timestamp: 1_700_000_060,
        reserveYesRaw: 5_000_000n,
        reserveNoRaw: 5_000_000n,
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'trace',
      '--market-address',
      ADDRESSES.mirrorMarket,
      '--rpc-url',
      rpc.url,
      '--blocks',
      '111,112',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.trace');
    assert.equal(payload.data.selector.selectionMode, 'blocks');
    assert.deepEqual(payload.data.selector.blocks, [111, 112]);
    assert.equal(payload.data.selector.fromBlock, null);
    assert.equal(payload.data.selector.toBlock, null);
    assert.equal(payload.data.selector.step, null);
    assert.equal(Array.isArray(payload.data.snapshots), true);
    assert.equal(payload.data.snapshots.length, 2);
    assert.equal(payload.data.snapshots[0].blockNumber, 111);
    assert.equal(payload.data.snapshots[0].reserveYesUsdc, 4);
    assert.equal(payload.data.snapshots[0].reserveNoUsdc, 6);
    assert.equal(payload.data.snapshots[0].pandoraYesPct, 60);
    assert.equal(payload.data.snapshots[0].feeTier, 3000);
    assert.equal(payload.data.snapshots[0].rpcUrl, rpc.url);
    assert.equal(typeof payload.data.snapshots[0].blockHash, 'string');
    assert.equal(typeof payload.data.snapshots[0].blockTimestamp, 'string');
    assert.equal(payload.data.snapshots[1].blockNumber, 112);
    assert.equal(payload.data.snapshots[1].reserveYesUsdc, 5);
    assert.equal(payload.data.snapshots[1].reserveNoUsdc, 5);
    assert.equal(payload.data.snapshots[1].pandoraYesPct, 50);
  } finally {
    await rpc.close();
  }
});

test('mirror trace range sampling honors step and limit while preserving the requested selector', async () => {
  const rpc = await startMirrorTraceRpcMock({
    snapshots: [
      {
        blockNumber: 0,
        timestamp: 1_700_000_000,
        reserveYesRaw: 1_000_000n,
        reserveNoRaw: 2_000_000n,
      },
      {
        blockNumber: 1,
        timestamp: 1_700_000_060,
        reserveYesRaw: 2_000_000n,
        reserveNoRaw: 3_000_000n,
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'trace',
      '--market-address',
      ADDRESSES.mirrorMarket,
      '--rpc-url',
      rpc.url,
      '--from-block',
      '0',
      '--to-block',
      '5000',
      '--step',
      '1',
      '--limit',
      '2',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.selector.selectionMode, 'range');
    assert.equal(payload.data.selector.fromBlock, 0);
    assert.equal(payload.data.selector.toBlock, 5000);
    assert.equal(payload.data.selector.step, 1);
    assert.deepEqual(payload.data.selector.blocks, []);
    assert.equal(payload.data.snapshots.length, 2);
    assert.deepEqual(payload.data.snapshots.map((entry) => entry.blockNumber), [0, 1]);
  } finally {
    await rpc.close();
  }
});

test('mirror trace fails with an explicit archive-state error when historical reserves are unavailable', async () => {
  const rpc = await startMirrorTraceRpcMock({
    snapshots: [
      {
        blockNumber: 111,
        timestamp: 1_700_000_000,
        reserveYesRaw: 4_000_000n,
        reserveNoRaw: 6_000_000n,
      },
    ],
    archiveMissingBlocks: [111],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'trace',
      '--market-address',
      ADDRESSES.mirrorMarket,
      '--rpc-url',
      rpc.url,
      '--blocks',
      '111',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'MIRROR_ONCHAIN_ARCHIVE_STATE_UNAVAILABLE');
    assert.match(payload.error.message, /archive/i);
  } finally {
    await rpc.close();
  }
});

test('mirror trace preserves generic rpc failures instead of relabeling them as archive errors', async () => {
  const rpc = await startMirrorTraceRpcMock({
    snapshots: [
      {
        blockNumber: 111,
        timestamp: 1_700_000_000,
        reserveYesRaw: 4_000_000n,
        reserveNoRaw: 6_000_000n,
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'trace',
      '--market-address',
      ADDRESSES.mirrorMarket,
      '--rpc-url',
      rpc.url,
      '--blocks',
      '999',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'MIRROR_ONCHAIN_RESERVES_UNAVAILABLE');
    assert.notEqual(payload.error.code, 'MIRROR_ONCHAIN_ARCHIVE_STATE_UNAVAILABLE');
  } finally {
    await rpc.close();
  }
});

test('polymarket check returns deterministic JSON payload shape', async () => {
  const rpc = await startPolymarketOpsRpcMock({
    funder: POLYMARKET_DEFAULTS.funder,
    usdcBalanceRaw: 2_500_000n,
    safeOwner: true,
  });

  try {
    const result = await runCliAsync(
      [
        '--output',
        'json',
        'polymarket',
        'check',
        '--rpc-url',
        rpc.url,
        '--private-key',
        `0x${'1'.repeat(64)}`,
        '--funder',
        POLYMARKET_DEFAULTS.funder,
      ],
      {
        env: {
          POLYMARKET_SKIP_API_KEY_SANITY: '1',
        },
      },
    );

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'polymarket.check');
    assert.equal(payload.data.schemaVersion, '1.0.0');
    assert.equal(payload.data.chainId, 137);
    assert.equal(Array.isArray(payload.data.runtime.spenders), true);
    assert.equal(payload.data.runtime.spenders.length, 3);
    assert.equal(Array.isArray(payload.data.approvals.checks), true);
    assert.equal(payload.data.approvals.checks.length, 6);
    assert.equal(payload.data.apiKeySanity.status, 'skipped');
  } finally {
    await rpc.close();
  }
});

test('polymarket check falls back to later rpc candidates when the primary endpoint is down', async () => {
  const deadRpc = await startJsonHttpServer(({ bodyJson }) => ({
    status: 503,
    body: {
      jsonrpc: '2.0',
      id: bodyJson && bodyJson.id ? bodyJson.id : 1,
      error: { message: 'primary rpc unavailable' },
    },
  }));
  const liveRpc = await startPolymarketOpsRpcMock({
    funder: POLYMARKET_DEFAULTS.funder,
    usdcBalanceRaw: 2_500_000n,
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

  try {
    const result = await runCliAsync(
      [
        '--output',
        'json',
        'polymarket',
        'check',
        '--rpc-url',
        `${deadRpc.url},${liveRpc.url}`,
        '--private-key',
        `0x${'1'.repeat(64)}`,
        '--funder',
        POLYMARKET_DEFAULTS.funder,
      ],
      {
        env: {
          POLYMARKET_SKIP_API_KEY_SANITY: '1',
        },
      },
    );

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'polymarket.check');
    assert.equal(payload.data.runtime.rpcUrl, liveRpc.url);
    assert.equal(payload.data.rpcSelection.fallbackUsed, true);
    assert.deepEqual(
      payload.data.rpcSelection.attempts.map((entry) => [entry.rpcUrl, entry.ok]),
      [
        [deadRpc.url, false],
        [liveRpc.url, true],
      ],
    );
  } finally {
    await deadRpc.close();
    await liveRpc.close();
  }
});

test('polymarket balance --help stays funding-only and omits CTF inventory selectors', () => {
  const result = runCli(['--output', 'json', 'polymarket', 'balance', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'polymarket.balance.help');
  assert.match(payload.data.usage, /polymarket balance/);
  assert.doesNotMatch(payload.data.usage, /--source auto\|api\|on-chain/);
  assert.doesNotMatch(payload.data.usage, /--condition-id <id>\|--market-id <id>\|--slug <slug>\|--token-id <id>/);
  assert.equal(
    payload.data.notes.some((entry) => /does not query authenticated Polymarket CLOB buying power/i.test(entry)),
    true,
  );
  assert.equal(
    payload.data.notes.some((entry) => /merge-readiness/i.test(entry)),
    true,
  );
});

test('polymarket --help advertises positions alongside the funding-only balance surface', () => {
  const result = runCli(['--output', 'json', 'polymarket', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'polymarket.help');
  assert.match(payload.data.usage, /check\|approve\|preflight\|balance\|positions\|deposit\|withdraw\|trade/);
});

test('polymarket positions --help documents selector and source modes for CTF inventory reads', () => {
  const result = runCli(['--output', 'json', 'polymarket', 'positions', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'polymarket.positions.help');
  assert.match(payload.data.usage, /--wallet <address>\|--funder <address>/);
  assert.match(payload.data.usage, /--condition-id <id>\|--market-id <id>\|--slug <slug>\|--token-id <id>/);
  assert.match(payload.data.usage, /--source auto\|api\|on-chain/);
});

test('command descriptors expose polymarket positions while keeping polymarket balance funding-only', () => {
  const descriptors = buildCommandDescriptors();

  assert.ok(descriptors.polymarket);
  assert.match(descriptors.polymarket.usage, /check\|approve\|preflight\|balance\|positions\|deposit\|withdraw\|trade/);
  assert.match(descriptors['polymarket.balance'].summary, /funding balances/i);
  assert.doesNotMatch(descriptors['polymarket.balance'].summary, /inventory|open order|YES\/NO/i);
  assert.ok(descriptors['polymarket.positions']);
  assert.match(descriptors['polymarket.positions'].summary, /CTF|inventory|open orders/i);
  assert.match(descriptors['polymarket.positions'].usage, /polymarket positions \[--wallet <address>\|--funder <address>\]/);
  assert.match(descriptors['polymarket.positions'].usage, /--source auto\|api\|on-chain/);
  assert.match(descriptors['polymarket.positions'].usage, /--funder <address>/);
});

test('polymarket approve --dry-run returns deterministic JSON plan shape', async () => {
  const rpc = await startPolymarketOpsRpcMock({
    funder: POLYMARKET_DEFAULTS.funder,
    usdcBalanceRaw: 1_000_000n,
    safeOwner: true,
  });

  try {
    const result = await runCliAsync(
      [
        '--output',
        'json',
        'polymarket',
        'approve',
        '--dry-run',
        '--rpc-url',
        rpc.url,
        '--private-key',
        `0x${'1'.repeat(64)}`,
        '--funder',
        POLYMARKET_DEFAULTS.funder,
      ],
      {
        env: {
          POLYMARKET_SKIP_API_KEY_SANITY: '1',
        },
      },
    );

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'polymarket.approve');
    assert.equal(payload.data.mode, 'dry-run');
    assert.equal(payload.data.status, 'planned');
    assert.equal(Array.isArray(payload.data.txPlan), true);
    assert.equal(payload.data.txPlan.length, 6);
    assert.equal(payload.data.approvalSummary.missingCount, 6);
  } finally {
    await rpc.close();
  }
});

test('mirror sync --execute-live enforces required risk caps', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'sync',
    'once',
    '--skip-dotenv',
    '--pandora-market-address',
    ADDRESSES.mirrorMarket,
    '--polymarket-market-id',
    'poly-cond-1',
    '--execute-live',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.match(payload.error.message, /max-open-exposure-usdc/);
});

test('mirror sync start/status/stop manages daemon lifecycle in paper mode', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-daemon-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());
  let strategyHash = null;
  let daemonPid = null;

  try {
    const startResult = await runCliAsync(
      [
        '--output',
        'json',
        'mirror',
        'sync',
        'start',
        '--skip-dotenv',
        '--indexer-url',
        indexer.url,
        '--polymarket-mock-url',
        polymarket.url,
        '--pandora-market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
        '--paper',
        '--interval-ms',
        '1000',
        '--iterations',
        '30',
        '--drift-trigger-bps',
        '25',
        '--hedge-trigger-usdc',
        '1000000',
        '--state-file',
        stateFile,
      ],
      { env: { HOME: tempDir } },
    );

    assert.ok(startResult.status === 0, startResult.output || '(no cli output)');
    const startPayload = parseJsonOutput(startResult);
    assert.equal(startPayload.ok, true);
    assert.equal(startPayload.command, 'mirror.sync.start');
    assert.equal(startPayload.data.found, true);
    assert.equal(typeof startPayload.data.strategyHash, 'string');
    assert.equal(startPayload.data.strategyHash.length, 16);
    assert.equal(typeof startPayload.data.pid, 'number');
    assert.equal(fs.existsSync(startPayload.data.pidFile), true);
    assert.equal(fs.existsSync(startPayload.data.logFile), true);

    strategyHash = startPayload.data.strategyHash;
    daemonPid = startPayload.data.pid;

    const statusResult = runCli(
      [
        '--output',
        'json',
        'mirror',
        'sync',
        'status',
        '--strategy-hash',
        strategyHash,
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(statusResult.status, 0);
    const statusPayload = parseJsonOutput(statusResult);
    assert.equal(statusPayload.ok, true);
    assert.equal(statusPayload.command, 'mirror.sync.status');
    assert.equal(statusPayload.data.found, true);
    assert.equal(statusPayload.data.strategyHash, strategyHash);
    assert.equal(typeof statusPayload.data.pid, 'number');
    assert.equal(statusPayload.data.alive, true);
    assert.equal(statusPayload.data.status, 'running');
    assert.equal(typeof statusPayload.data.metadata.checkedAt, 'string');
    assert.equal(statusPayload.data.metadata.pidAlive, true);
    assert.equal(statusPayload.data.metadata.logFile, startPayload.data.logFile);
    assert.equal(statusPayload.data.runtime.health.status, 'running');
    assert.equal(statusPayload.data.runtime.errorCount, 0);
    assert.equal(statusPayload.data.runtime.summary.errorCount, 0);
    assert.equal(statusPayload.data.runtime.nextAction.code, 'MONITOR_NEXT_TICK');
    assert.equal(statusPayload.data.runtime.summary.nextAction.code, 'MONITOR_NEXT_TICK');
    assert.equal(statusPayload.data.runtime.lastTrade, null);

    const stopResult = runCli(
      [
        '--output',
        'json',
        'mirror',
        'sync',
        'stop',
        '--strategy-hash',
        strategyHash,
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(stopResult.status, 0);
    const stopPayload = parseJsonOutput(stopResult);
    assert.equal(stopPayload.ok, true);
    assert.equal(stopPayload.command, 'mirror.sync.stop');
    assert.equal(stopPayload.data.strategyHash, strategyHash);
    assert.equal(stopPayload.data.alive, false);
    assert.equal(stopPayload.data.status, 'stopped');
    assert.equal(stopPayload.data.signalSent, true);
    assert.equal(stopPayload.data.metadata.stopSignalSent, true);
    assert.equal(typeof stopPayload.data.metadata.stopAttemptedAt, 'string');

    const afterStopResult = runCli(
      [
        '--output',
        'json',
        'mirror',
        'sync',
        'status',
        '--strategy-hash',
        strategyHash,
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(afterStopResult.status, 0);
    const afterStopPayload = parseJsonOutput(afterStopResult);
    assert.equal(afterStopPayload.ok, true);
    assert.equal(afterStopPayload.data.found, true);
    assert.equal(afterStopPayload.data.alive, false);
    assert.equal(afterStopPayload.data.status, 'stopped');
    assert.equal(afterStopPayload.data.metadata.pidAlive, false);
  } finally {
    if (strategyHash) {
      runCli(['--output', 'json', 'mirror', 'sync', 'stop', '--strategy-hash', strategyHash], {
        env: { HOME: tempDir },
      });
    }
    if (daemonPid && Number.isInteger(daemonPid)) {
      try {
        process.kill(daemonPid, 'SIGKILL');
      } catch {
        // best-effort cleanup
      }
    }
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror sync start does not leak --private-key in daemon metadata', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-daemon-private-key-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());
  let strategyHash = null;
  let daemonPid = null;
  const privateKey = `0x${'1'.repeat(64)}`;
  const funder = '0x9999999999999999999999999999999999999999';

  try {
    const startResult = await runCliAsync(
      [
        '--output',
        'json',
        'mirror',
        'sync',
        'start',
        '--skip-dotenv',
        '--indexer-url',
        indexer.url,
        '--polymarket-mock-url',
        polymarket.url,
        '--pandora-market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
        '--paper',
        '--private-key',
        privateKey,
        '--funder',
        funder,
        '--interval-ms',
        '1000',
        '--iterations',
        '30',
        '--drift-trigger-bps',
        '25',
        '--hedge-trigger-usdc',
        '1000000',
        '--state-file',
        stateFile,
      ],
      { env: { HOME: tempDir } },
    );

    assert.ok(startResult.status === 0, startResult.output || '(no cli output)');
    const startPayload = parseJsonOutput(startResult);
    assert.equal(startPayload.ok, true);
    assert.equal(startPayload.command, 'mirror.sync.start');
    assert.equal(Array.isArray(startPayload.data.cliArgs), true);
    assert.equal(startPayload.data.cliArgs.includes('--private-key'), false);
    assert.equal(startPayload.data.launchCommand.includes('--private-key'), false);
    assert.equal(startPayload.data.launchCommand.includes(privateKey), false);

    strategyHash = startPayload.data.strategyHash;
    daemonPid = startPayload.data.pid;

    const stopResult = runCli(
      [
        '--output',
        'json',
        'mirror',
        'sync',
        'stop',
        '--strategy-hash',
        strategyHash,
      ],
      { env: { HOME: tempDir } },
    );
    assert.equal(stopResult.status, 0);
  } finally {
    if (strategyHash) {
      runCli(['--output', 'json', 'mirror', 'sync', 'stop', '--strategy-hash', strategyHash], {
        env: { HOME: tempDir },
      });
    }
    if (daemonPid && Number.isInteger(daemonPid)) {
      try {
        process.kill(daemonPid, 'SIGKILL');
      } catch {
        // best-effort cleanup
      }
    }
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror hedge start preserves --skip-dotenv in detached child cli args', async () => {
  const tempDir = createTempDir('pandora-mirror-hedge-daemon-skip-dotenv-');
  const stateFile = path.join(tempDir, 'hedge-state.json');
  const walletFile = path.join(tempDir, 'internal-wallets.txt');
  writeFile(walletFile, `${ADDRESSES.wallet1}\n`);
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());
  let pidFile = null;
  let daemonPid = null;

  try {
    const startResult = await runCliAsync(
      [
        '--output',
        'json',
        'mirror',
        'hedge',
        'start',
        '--skip-dotenv',
        '--indexer-url',
        indexer.url,
        '--polymarket-mock-url',
        polymarket.url,
        '--pandora-market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
        '--internal-wallets-file',
        walletFile,
        '--paper',
        '--interval-ms',
        '1000',
        '--iterations',
        '30',
        '--state-file',
        stateFile,
      ],
      { env: { HOME: tempDir } },
    );

    assert.ok(startResult.status === 0, startResult.output || '(no cli output)');
    const startPayload = parseJsonOutput(startResult);
    assert.equal(startPayload.ok, true);
    assert.equal(startPayload.command, 'mirror.hedge.start');
    pidFile = startPayload.data.daemon.pidFile;
    daemonPid = startPayload.data.daemon.pid;

    const metadata = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
    assert.equal(Array.isArray(metadata.cliArgs), true);
    assert.equal(metadata.cliArgs.includes('--skip-dotenv'), true);
    assert.equal(metadata.cliArgs.includes('--dotenv-path'), false);
  } finally {
    if (pidFile) {
      runCli(['--output', 'json', 'mirror', 'hedge', 'stop', '--pid-file', pidFile], {
        env: { HOME: tempDir },
      });
    }
    if (daemonPid && Number.isInteger(daemonPid)) {
      try {
        process.kill(daemonPid, 'SIGKILL');
      } catch {
        // best-effort cleanup
      }
    }
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror hedge start preserves explicit dotenv paths in detached child cli args', async () => {
  const tempDir = createTempDir('pandora-mirror-hedge-daemon-dotenv-path-');
  const stateFile = path.join(tempDir, 'hedge-state.json');
  const walletFile = path.join(tempDir, 'internal-wallets.txt');
  const envFile = path.join(tempDir, 'custom.env');
  writeFile(walletFile, `${ADDRESSES.wallet1}\n`);
  writeFile(envFile, '\n');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());
  let pidFile = null;
  let daemonPid = null;

  try {
    const startResult = await runCliAsync(
      [
        '--output',
        'json',
        'mirror',
        'hedge',
        'start',
        '--dotenv-path',
        envFile,
        '--indexer-url',
        indexer.url,
        '--polymarket-mock-url',
        polymarket.url,
        '--pandora-market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
        '--internal-wallets-file',
        walletFile,
        '--paper',
        '--interval-ms',
        '1000',
        '--iterations',
        '30',
        '--state-file',
        stateFile,
      ],
      { env: { HOME: tempDir } },
    );

    assert.ok(startResult.status === 0, startResult.output || '(no cli output)');
    const startPayload = parseJsonOutput(startResult);
    assert.equal(startPayload.ok, true);
    assert.equal(startPayload.command, 'mirror.hedge.start');
    pidFile = startPayload.data.daemon.pidFile;
    daemonPid = startPayload.data.daemon.pid;

    const metadata = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
    const dotenvIndex = metadata.cliArgs.indexOf('--dotenv-path');
    assert.notEqual(dotenvIndex, -1);
    assert.equal(metadata.cliArgs[dotenvIndex + 1], envFile);
    assert.equal(metadata.cliArgs.includes('--skip-dotenv'), false);
  } finally {
    if (pidFile) {
      runCli(['--output', 'json', 'mirror', 'hedge', 'stop', '--pid-file', pidFile], {
        env: { HOME: tempDir },
      });
    }
    if (daemonPid && Number.isInteger(daemonPid)) {
      try {
        process.kill(daemonPid, 'SIGKILL');
      } catch {
        // best-effort cleanup
      }
    }
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror hedge start preserves --adopt-existing-positions in detached child cli args', async () => {
  const tempDir = createTempDir('pandora-mirror-hedge-daemon-adopt-existing-');
  const stateFile = path.join(tempDir, 'hedge-state.json');
  const walletFile = path.join(tempDir, 'internal-wallets.txt');
  writeFile(walletFile, `${ADDRESSES.wallet1}\n`);
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());
  let pidFile = null;
  let daemonPid = null;

  try {
    const startResult = await runCliAsync(
      [
        '--output',
        'json',
        'mirror',
        'hedge',
        'start',
        '--skip-dotenv',
        '--indexer-url',
        indexer.url,
        '--polymarket-mock-url',
        polymarket.url,
        '--pandora-market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
        '--internal-wallets-file',
        walletFile,
        '--paper',
        '--adopt-existing-positions',
        '--interval-ms',
        '1000',
        '--iterations',
        '30',
        '--state-file',
        stateFile,
      ],
      { env: { HOME: tempDir } },
    );

    assert.ok(startResult.status === 0, startResult.output || '(no cli output)');
    const startPayload = parseJsonOutput(startResult);
    assert.equal(startPayload.ok, true);
    assert.equal(startPayload.command, 'mirror.hedge.start');
    pidFile = startPayload.data.daemon.pidFile;
    daemonPid = startPayload.data.daemon.pid;

    const metadata = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
    assert.equal(Array.isArray(metadata.cliArgs), true);
    assert.equal(metadata.cliArgs.includes('--adopt-existing-positions'), true);
  } finally {
    if (pidFile) {
      runCli(['--output', 'json', 'mirror', 'hedge', 'stop', '--pid-file', pidFile], {
        env: { HOME: tempDir },
      });
    }
    if (daemonPid && Number.isInteger(daemonPid)) {
      try {
        process.kill(daemonPid, 'SIGKILL');
      } catch {
        // best-effort cleanup
      }
    }
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror hedge start accepts strategy-hash, stays alive across an interval, and exits cleanly after bounded iterations', async () => {
  const tempDir = createTempDir('pandora-mirror-hedge-daemon-strategy-hash-');
  const stateFile = path.join(tempDir, 'hedge-state.json');
  const walletFile = path.join(tempDir, 'internal-wallets.txt');
  writeFile(walletFile, `${ADDRESSES.wallet1}\n`);
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());
  const strategyHash = 'abc123abc123abc1';
  let pidFile = null;
  let daemonPid = null;

  try {
    const startResult = await runCliAsync(
      [
        '--output',
        'json',
        'mirror',
        'hedge',
        'start',
        '--strategy-hash',
        strategyHash,
        '--indexer-url',
        indexer.url,
        '--polymarket-mock-url',
        polymarket.url,
        '--pandora-market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
        '--internal-wallets-file',
        walletFile,
        '--paper',
        '--interval-ms',
        '1000',
        '--iterations',
        '3',
        '--state-file',
        stateFile,
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(startResult.status, 0, startResult.output || '(no cli output)');
    const startPayload = parseJsonOutput(startResult);
    assert.equal(startPayload.ok, true);
    assert.equal(startPayload.command, 'mirror.hedge.start');
    pidFile = startPayload.data.daemon.pidFile;
    daemonPid = startPayload.data.daemon.pid;

    const metadata = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
    assert.equal(Array.isArray(metadata.cliArgs), true);
    assert.equal(metadata.cliArgs.includes('--strategy-hash'), true);
    assert.equal(metadata.cliArgs.includes(strategyHash), true);

    await delay(1200);
    assert.equal(isPidAlive(daemonPid), true);
    assert.equal(fs.existsSync(stateFile), true);

    const runningStatusResult = await runCliAsync(
      [
        '--output',
        'json',
        'mirror',
        'hedge',
        'status',
        '--strategy-hash',
        strategyHash,
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(runningStatusResult.status, 0, runningStatusResult.output || '(no cli output)');
    const runningStatusPayload = parseJsonOutput(runningStatusResult);
    assert.equal(runningStatusPayload.ok, true);
    assert.equal(runningStatusPayload.data.runtime.status, 'running');

    const exited = await waitForPidExit(daemonPid, 10_000, 100);
    assert.equal(exited, true, `daemon still alive after bounded iterations: ${daemonPid}`);

    const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(persisted.runtimeStatus, 'stopped');
    assert.equal(persisted.exitCode, 0);
    assert.equal(persisted.iterationsRequested, 3);
    assert.equal(persisted.iterationsCompleted, 3);
    assert.match(String(persisted.stoppedReason || ''), /(iteration|complete|bounded)/i);
    assert.equal(typeof (persisted.exitAt || persisted.stoppedAt), 'string');

    const statusResult = await runCliAsync(
      [
        '--output',
        'json',
        'mirror',
        'hedge',
        'status',
        '--strategy-hash',
        strategyHash,
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(statusResult.status, 0, statusResult.output || '(no cli output)');
    const statusPayload = parseJsonOutput(statusResult);
    assert.equal(statusPayload.ok, true);
    assert.equal(statusPayload.command, 'mirror.hedge.status');
    assert.equal(statusPayload.data.runtime.status, 'stopped');
    assert.equal(statusPayload.data.runtime.exitCode, 0);
    assert.equal(statusPayload.data.runtime.iterationsRequested, 3);
    assert.equal(statusPayload.data.runtime.iterationsCompleted, 3);
    assert.match(String(statusPayload.data.runtime.stoppedReason || ''), /(iteration|complete|bounded)/i);
    assert.equal(typeof (statusPayload.data.runtime.exitAt || statusPayload.data.runtime.stoppedAt), 'string');

    const tableResult = runCli([
      'mirror',
      'hedge',
      'status',
      '--strategy-hash',
      strategyHash,
    ], {
      env: { HOME: tempDir },
    });

    assert.equal(tableResult.status, 0, tableResult.output || '(no cli output)');
    assert.match(tableResult.output, /iterationsRequested:\s*3/);
    assert.match(tableResult.output, /iterationsCompleted:\s*3/);
    assert.match(tableResult.output, /stoppedReason:/);
    assert.match(tableResult.output, /exitCode:\s*0/);
    assert.match(tableResult.output, /exitAt:|stoppedAt:/);
  } finally {
    if (pidFile && daemonPid && isPidAlive(daemonPid)) {
      runCli(['--output', 'json', 'mirror', 'hedge', 'stop', '--pid-file', pidFile], {
        env: { HOME: tempDir },
      });
    }
    if (daemonPid && isPidAlive(daemonPid)) {
      try {
        process.kill(daemonPid, 'SIGKILL');
      } catch {
        // best-effort cleanup
      }
    }
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror status can load state via strategy hash path', async () => {
  const tempDir = createTempDir('pandora-mirror-status-');
  const strategyHash = '0123456789abcdef';
  const stateDir = path.join(tempDir, '.pandora', 'mirror');
  const statePath = path.join(stateDir, `${strategyHash}.json`);
  const daemonDir = path.join(stateDir, 'daemon');
  const daemonPidFile = path.join(daemonDir, `${strategyHash}.json`);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        tradesToday: 2,
        dailySpendUsdc: 42,
      },
      null,
      2,
    ),
  );
  fs.mkdirSync(daemonDir, { recursive: true });
  fs.writeFileSync(
    daemonPidFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        pid: process.pid,
        pidAlive: true,
        status: 'running',
        checkedAt: '2026-03-09T00:00:00.000Z',
        startedAt: '2026-03-08T23:59:00.000Z',
        stateFile: statePath,
        logFile: path.join(tempDir, '.pandora', 'mirror', 'logs', `${strategyHash}.log`),
      },
      null,
      2,
    ),
  );

  const result = runCli(['--output', 'json', 'mirror', 'status', '--strategy-hash', strategyHash], {
    env: { HOME: tempDir },
  });

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.status');
  assert.equal(payload.data.strategyHash, strategyHash);
  assert.equal(payload.data.state.tradesToday, 2);
  assert.equal(payload.data.runtime.health.status, 'running');
  assert.equal(payload.data.runtime.daemon.found, true);
  assert.equal(payload.data.runtime.daemon.alive, true);
  assert.equal(payload.data.runtime.daemon.strategyHash, strategyHash);
  assert.equal(payload.data.runtime.daemon.pid, process.pid);

  removeDir(tempDir);
});

test('mirror status can infer the paired source selector from persisted state when given only --market-address', async () => {
  const tempDir = createTempDir('pandora-mirror-status-selector-hint-');
  const stateDir = path.join(tempDir, '.pandora', 'mirror');
  const statePath = path.join(stateDir, '0123456789abcdef.json');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer({
    ...buildMirrorPolymarketOverrides(),
    balances: {
      'poly-yes-1': '12.5',
      'poly-no-1': '3.25',
    },
  });

  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: '0123456789abcdef',
        pandoraMarketAddress: ADDRESSES.mirrorMarket,
        polymarketMarketId: 'poly-cond-1',
        polymarketSlug: 'poly-game-1',
        tradesToday: 3,
      },
      null,
      2,
    ),
  );

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'status',
      '--market-address',
      ADDRESSES.mirrorMarket,
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
    assert.equal(payload.data.stateFile, statePath);
    assert.equal(payload.data.selector.pandoraMarketAddress, ADDRESSES.mirrorMarket);
    assert.equal(payload.data.selector.polymarketMarketId, 'poly-cond-1');
    assert.equal(payload.data.selector.polymarketSlug, 'poly-game-1');
    assert.equal(payload.data.state.tradesToday, 3);
    assert.equal(payload.data.live.sourceMarket.marketId, 'poly-cond-1');
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror replay can infer persisted state from --market-address alone', () => {
  const tempDir = createTempDir('pandora-mirror-replay-selector-hint-');
  const stateDir = path.join(tempDir, '.pandora', 'mirror');
  const statePath = path.join(stateDir, 'feedfacecafebeef.json');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: 'feedfacecafebeef',
        pandoraMarketAddress: ADDRESSES.mirrorMarket,
        polymarketMarketId: 'poly-cond-1',
        polymarketSlug: 'poly-game-1',
        lastExecution: {
          mode: 'paper',
          status: 'executed',
          startedAt: '2026-03-09T09:58:00.000Z',
          completedAt: '2026-03-09T10:00:00.000Z',
          model: {
            plannedRebalanceUsdc: 12.5,
            plannedHedgeUsdc: 7.25,
            plannedSpendUsdc: 19.75,
            rebalanceSide: 'yes',
            hedgeTokenSide: 'no',
            hedgeOrderSide: 'buy',
          },
        },
      },
      null,
      2,
    ),
  );

  try {
    const result = runCli(['--output', 'json', 'mirror', 'replay', '--market-address', ADDRESSES.mirrorMarket], {
      env: { HOME: tempDir },
    });

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.replay');
    assert.equal(payload.data.stateFile, statePath);
    assert.equal(payload.data.selector.pandoraMarketAddress, ADDRESSES.mirrorMarket);
    assert.equal(payload.data.selector.polymarketMarketId, 'poly-cond-1');
    assert.equal(payload.data.selector.polymarketSlug, 'poly-game-1');
    assert.equal(payload.data.summary.actionCount, 1);
  } finally {
    removeDir(tempDir);
  }
});

test('mirror status surfaces unreadable pending-action locks as blocked runtime state', () => {
  const tempDir = createTempDir('pandora-mirror-status-lock-invalid-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const pendingLockFile = `${path.resolve(stateFile)}.pending-action.json`;
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: 'feedfacecafebeef',
        tradesToday: 1,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(pendingLockFile, '{not-valid-json');

  try {
    const result = runCli(['--output', 'json', 'mirror', 'status', '--state-file', stateFile], {
      env: { HOME: tempDir },
    });

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.status');
    assert.equal(payload.data.runtime.health.status, 'blocked');
    assert.equal(payload.data.runtime.health.code, 'PENDING_ACTION_LOCK_INVALID');
    assert.equal(payload.data.runtime.summary.nextAction.code, 'UNLOCK_PENDING_ACTION');
    assert.equal(payload.data.runtime.summary.nextAction.blocking, true);
    assert.match(payload.data.runtime.summary.nextAction.command, /mirror sync unlock --state-file/);
    assert.equal(payload.data.runtime.pendingAction.status, 'invalid');
    assert.equal(payload.data.runtime.pendingAction.requiresManualReview, true);
    assert.equal(payload.data.runtime.pendingActionRecovery.allowedWithoutForce, true);
  } finally {
    removeDir(tempDir);
  }
});

test('mirror status surfaces pending-action transaction nonce for manual reconciliation', () => {
  const tempDir = createTempDir('pandora-mirror-status-pending-nonce-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const pendingLockFile = `${path.resolve(stateFile)}.pending-action.json`;
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: 'feedfacecafebeef',
        tradesToday: 1,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    pendingLockFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        status: 'reconciliation-required',
        pid: process.pid,
        lockNonce: 'nonce-bucket-1',
        transactionNonce: 42,
        requiresManualReview: true,
        createdAt: '2026-03-09T10:00:00.000Z',
        updatedAt: '2026-03-09T10:01:00.000Z',
      },
      null,
      2,
    ),
  );

  try {
    const result = runCli(['--output', 'json', 'mirror', 'status', '--state-file', stateFile], {
      env: { HOME: tempDir },
    });

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.status');
    assert.equal(payload.data.runtime.health.status, 'blocked');
    assert.equal(payload.data.runtime.pendingAction.status, 'reconciliation-required');
    assert.equal(payload.data.runtime.pendingAction.transactionNonce, 42);
    assert.equal(payload.data.runtime.summary.nextAction.code, 'RECONCILE_PENDING_ACTION');
    assert.equal(payload.data.runtime.summary.nextAction.blocking, true);
  } finally {
    removeDir(tempDir);
  }
});

test('mirror sync unlock clears zombie pending-action locks by state-file', () => {
  const tempDir = createTempDir('pandora-mirror-sync-unlock-zombie-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const pendingLockFile = `${path.resolve(stateFile)}.pending-action.json`;
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: 'feedfacecafebeef',
        tradesToday: 1,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    pendingLockFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        status: 'pending',
        pid: 99999999,
        lockNonce: 'zombie-lock',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      null,
      2,
    ),
  );

  try {
    const result = runCli(['--output', 'json', 'mirror', 'sync', 'unlock', '--state-file', stateFile], {
      env: { HOME: tempDir },
    });

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.sync.unlock');
    assert.equal(payload.data.cleared, true);
    assert.equal(payload.data.lock.status, 'zombie');
    assert.equal(payload.data.assessment.code, 'PENDING_ACTION_UNLOCK_ALLOWED');
    assert.equal(fs.existsSync(pendingLockFile), false);
  } finally {
    removeDir(tempDir);
  }
});

test('mirror sync unlock requires force for reconciliation-required locks', () => {
  const tempDir = createTempDir('pandora-mirror-sync-unlock-force-');
  const strategyHash = 'feedfacecafebeef';
  const stateDir = path.join(tempDir, '.pandora', 'mirror');
  const stateFile = path.join(stateDir, `${strategyHash}.json`);
  const pendingLockFile = `${path.resolve(stateFile)}.pending-action.json`;
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        tradesToday: 1,
        lastExecution: {
          status: 'pending',
          requiresManualReview: true,
          lockNonce: 'nonce-bucket-1',
          idempotencyKey: 'pending-1',
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    pendingLockFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        status: 'reconciliation-required',
        pid: process.pid,
        lockNonce: 'nonce-bucket-1',
        idempotencyKey: 'pending-1',
        transactionNonce: 42,
        requiresManualReview: true,
        createdAt: '2026-03-09T10:00:00.000Z',
        updatedAt: '2026-03-09T10:01:00.000Z',
      },
      null,
      2,
    ),
  );

  try {
    const blocked = runCli(['--output', 'json', 'mirror', 'sync', 'unlock', '--strategy-hash', strategyHash], {
      env: { HOME: tempDir },
    });
    assert.equal(blocked.status, 0);
    const blockedPayload = parseJsonOutput(blocked);
    assert.equal(blockedPayload.ok, true);
    assert.equal(blockedPayload.data.cleared, false);
    assert.equal(blockedPayload.data.reason, 'force-required');
    assert.equal(blockedPayload.data.assessment.forceRequired, true);
    assert.match(blockedPayload.data.assessment.recommendedCommand, /--force/);
    assert.equal(fs.existsSync(pendingLockFile), true);

    const forced = runCli(
      ['--output', 'json', 'mirror', 'sync', 'unlock', '--strategy-hash', strategyHash, '--force'],
      { env: { HOME: tempDir } },
    );
    assert.equal(forced.status, 0);
    const forcedPayload = parseJsonOutput(forced);
    assert.equal(forcedPayload.ok, true);
    assert.equal(forcedPayload.data.cleared, true);
    assert.equal(forcedPayload.data.stateRecovery.updated, true);
    assert.deepEqual(forcedPayload.data.stateRecovery.changes, ['lastExecution']);
    assert.equal(fs.existsSync(pendingLockFile), false);
    const persistedState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(persistedState.lastExecution.requiresManualReview, false);
    assert.equal(persistedState.lastExecution.status, 'operator-cleared');
  } finally {
    removeDir(tempDir);
  }
});

test('mirror sync unlock --force clears orphaned persisted review state when the lock file is already gone', () => {
  const tempDir = createTempDir('pandora-mirror-sync-unlock-state-only-');
  const strategyHash = 'feedfacecafebeef';
  const stateDir = path.join(tempDir, '.pandora', 'mirror');
  const stateFile = path.join(stateDir, `${strategyHash}.json`);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        tradesToday: 1,
        lastExecution: {
          status: 'failed',
          requiresManualReview: true,
          lockNonce: 'nonce-bucket-2',
          idempotencyKey: 'pending-2',
          error: {
            code: 'PENDING_ACTION_LOCK_MISSING',
            message: 'lock file was manually deleted',
          },
        },
      },
      null,
      2,
    ),
  );

  try {
    const blocked = runCli(['--output', 'json', 'mirror', 'sync', 'unlock', '--strategy-hash', strategyHash], {
      env: { HOME: tempDir },
    });
    assert.equal(blocked.status, 0);
    const blockedPayload = parseJsonOutput(blocked);
    assert.equal(blockedPayload.ok, true);
    assert.equal(blockedPayload.data.cleared, false);
    assert.equal(blockedPayload.data.reason, 'force-required');
    assert.equal(blockedPayload.data.assessment.code, 'PENDING_ACTION_STATE_ONLY_UNLOCK_FORCE_REQUIRED');

    const forced = runCli(
      ['--output', 'json', 'mirror', 'sync', 'unlock', '--strategy-hash', strategyHash, '--force'],
      { env: { HOME: tempDir } },
    );
    assert.equal(forced.status, 0);
    const forcedPayload = parseJsonOutput(forced);
    assert.equal(forcedPayload.ok, true);
    assert.equal(forcedPayload.data.cleared, true);
    assert.equal(forcedPayload.data.lock, null);
    assert.equal(forcedPayload.data.stateRecovery.updated, true);
    const persistedState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(persistedState.lastExecution.requiresManualReview, false);
    assert.equal(persistedState.lastExecution.recoveryReason, 'operator-unlock-state-only');
  } finally {
    removeDir(tempDir);
  }
});

test('mirror status --help returns usage payload', () => {
  const result = runCli(['--output', 'json', 'mirror', 'status', '--help']);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.status.help');
  assert.match(payload.data.usage, /mirror status/);
  assert.equal(Array.isArray(payload.data.polymarketEnv), true);
  assert.equal(payload.data.polymarketEnv.includes('POLYMARKET_FUNDER'), true);
  assert.match(payload.data.notes.withLive, /Polymarket balances\/open orders/i);
  assert.match(payload.data.notes.withLive, /balance-scope/i);
  assert.match(payload.data.notes.withLive, /merge-readiness/i);
  assert.match(payload.data.notes.collateral, /scope mismatch/i);
  assert.match(payload.data.notes.collateral, /buying power/i);
  assert.match(payload.data.notes.gracefulFallback, /diagnostics are returned instead of hard failures/i);
});

test('mirror health returns machine-usable runtime status payload', () => {
  const tempDir = createTempDir('pandora-mirror-health-');
  const strategyHash = '0123456789abcdef';
  const stateDir = path.join(tempDir, '.pandora', 'mirror');
  const statePath = path.join(stateDir, `${strategyHash}.json`);
  const daemonDir = path.join(stateDir, 'daemon');
  const daemonPidFile = path.join(daemonDir, `${strategyHash}.json`);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        lastTickAt: new Date().toISOString(),
        tradesToday: 2,
        dailySpendUsdc: 42,
      },
      null,
      2,
    ),
  );
  fs.mkdirSync(daemonDir, { recursive: true });
  fs.writeFileSync(
    daemonPidFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        pid: process.pid,
        pidAlive: true,
        status: 'running',
        checkedAt: '2026-03-09T00:00:00.000Z',
        startedAt: '2026-03-08T23:59:00.000Z',
        stateFile: statePath,
        logFile: path.join(tempDir, '.pandora', 'mirror', 'logs', `${strategyHash}.log`),
      },
      null,
      2,
    ),
  );

  try {
    const result = runCli(['--output', 'json', 'mirror', 'health', '--strategy-hash', strategyHash], {
      env: { HOME: tempDir },
    });

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.health');
    assert.equal(payload.data.strategyHash, strategyHash);
    assert.equal(payload.data.healthy, true);
    assert.equal(payload.data.severity, 'ok');
    assert.equal(payload.data.summary.status, 'running');
    assert.equal(payload.data.summary.code, 'OK');
    assert.equal(payload.data.summary.daemonFound, true);
    assert.equal(payload.data.summary.daemonAlive, true);
    assert.equal(payload.data.runtime.daemon.strategyHash, strategyHash);
    assert.equal(payload.data.runtime.daemon.pid, process.pid);
    assert.equal(payload.data.followUpActions[0].code, 'MONITOR_NEXT_TICK');
  } finally {
    removeDir(tempDir);
  }
});

test('mirror health --help returns usage payload', () => {
  const result = runCli(['--output', 'json', 'mirror', 'health', '--help']);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.health.help');
  assert.match(payload.data.usage, /mirror health/);
  assert.equal(Array.isArray(payload.data.notes), true);
  assert.equal(
    payload.data.notes.some((line) => /machine-usable daemon\/runtime status surface/i.test(String(line))),
    true,
  );
});

test('mirror panic engages risk panic and writes the canonical mirror stop file', () => {
  const tempDir = createTempDir('pandora-mirror-panic-');
  const strategyHash = 'feedfacecafebeef';
  const stateDir = path.join(tempDir, '.pandora', 'mirror');
  const statePath = path.join(stateDir, `${strategyHash}.json`);
  const daemonDir = path.join(stateDir, 'daemon');
  const daemonPidFile = path.join(daemonDir, `${strategyHash}.json`);
  const defaultStopFile = path.join(stateDir, 'STOP');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        pandoraMarketAddress: ADDRESSES.mirrorMarket,
      },
      null,
      2,
    ),
  );
  fs.mkdirSync(daemonDir, { recursive: true });
  fs.writeFileSync(
    daemonPidFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        pid: 999999,
        pidAlive: false,
        status: 'running',
        checkedAt: '2026-03-09T00:00:00.000Z',
        startedAt: '2026-03-08T23:59:00.000Z',
        stateFile: statePath,
        killSwitchFile: path.join(tempDir, 'custom-stop-file'),
        pandoraMarketAddress: ADDRESSES.mirrorMarket,
      },
      null,
      2,
    ),
  );

  try {
    const engageResult = runCli(
      ['--output', 'json', 'mirror', 'panic', '--all', '--reason', 'incident response'],
      { env: { HOME: tempDir } },
    );

    assert.equal(engageResult.status, 0);
    const engagePayload = parseJsonOutput(engageResult);
    assert.equal(engagePayload.ok, true);
    assert.equal(engagePayload.command, 'mirror.panic');
    assert.equal(engagePayload.data.action, 'engage');
    assert.equal(engagePayload.data.status, 'engaged');
    assert.equal(engagePayload.data.risk.panic.active, true);
    assert.equal(engagePayload.data.selector.all, true);
    assert.equal(engagePayload.data.daemonStop.mode, 'all');
    assert.equal(engagePayload.data.daemonStop.count, 1);
    assert.equal(Array.isArray(engagePayload.data.stopFiles.written), true);
    assert.equal(engagePayload.data.stopFiles.written.includes(defaultStopFile), true);
    assert.equal(fs.existsSync(defaultStopFile), true);
    assert.equal(engagePayload.data.followUpActions.some((item) => item.code === 'CLEAR_PANIC_WHEN_SAFE'), true);

    const clearResult = runCli(
      ['--output', 'json', 'mirror', 'panic', '--clear', '--all'],
      { env: { HOME: tempDir } },
    );

    assert.equal(clearResult.status, 0);
    const clearPayload = parseJsonOutput(clearResult);
    assert.equal(clearPayload.ok, true);
    assert.equal(clearPayload.command, 'mirror.panic');
    assert.equal(clearPayload.data.action, 'clear');
    assert.equal(clearPayload.data.status, 'cleared');
    assert.equal(clearPayload.data.risk.panic.active, false);
    assert.equal(clearPayload.data.stopFiles.cleared.includes(defaultStopFile), true);
    assert.equal(fs.existsSync(defaultStopFile), false);
  } finally {
    removeDir(tempDir);
  }
});

test('mirror panic --help returns usage payload', () => {
  const result = runCli(['--output', 'json', 'mirror', 'panic', '--help']);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.panic.help');
  assert.match(payload.data.usage, /mirror panic/);
  assert.equal(Array.isArray(payload.data.notes), true);
  assert.equal(
    payload.data.notes.some((line) => /mirror-focused emergency shell/i.test(String(line))),
    true,
  );
  assert.equal(payload.data.notes.some((line) => /\.pandora\/mirror\/STOP/.test(String(line))), true);
});

test('mirror drift --help returns usage payload', () => {
  const result = runCli(['--output', 'json', 'mirror', 'drift', '--help']);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.drift.help');
  assert.match(payload.data.usage, /mirror drift/);
  assert.equal(Array.isArray(payload.data.notes), true);
  assert.equal(
    payload.data.notes.some((line) => /dedicated live drift\/readiness surface/i.test(String(line))),
    true,
  );
});

test('mirror hedge-check --help returns usage payload', () => {
  const result = runCli(['--output', 'json', 'mirror', 'hedge-check', '--help']);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.hedge-check.help');
  assert.match(payload.data.usage, /mirror hedge-check/);
  assert.equal(Array.isArray(payload.data.notes), true);
  assert.equal(
    payload.data.notes.some((line) => /current hedge target, gap, trigger state/i.test(String(line))),
    true,
  );
});

test('--version returns package version in json mode', () => {
  const result = runCli(['--output', 'json', '--version']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'version');
  assert.match(payload.data.version, /^\d+\.\d+\.\d+/);
});

test('conflicting --output values fail with INVALID_ARGS in json envelope', () => {
  const result = runCli(['--output', 'json', '--output', 'table', 'help']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_ARGS');
  assert.match(payload.error.message, /Conflicting --output values/);
});

test('mirror browse validates invalid date strings', () => {
  const result = runCli(['--output', 'json', 'mirror', 'browse', '--closes-after', 'not-a-date']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /--closes-after must be an ISO date\/time string/);
});

test('mirror browse rejects numeric-only date strings', () => {
  const result = runCli(['--output', 'json', 'mirror', 'browse', '--closes-after', '-1000']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /not a bare number/);
});

test('mirror browse rejects invalid calendar rollover dates', () => {
  const result = runCli(['--output', 'json', 'mirror', 'browse', '--closes-after', '2026-02-31']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /real calendar date/);
});

test('mirror browse rejects invalid tag id values', () => {
  const result = runCli(['--output', 'json', 'mirror', 'browse', '--polymarket-tag-id', '0']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /--polymarket-tag-id must be a positive integer/i);
});

test('mirror browse rejects empty tag-id csv values', () => {
  const result = runCli(['--output', 'json', 'mirror', 'browse', '--polymarket-tag-ids', ', ,']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /must include at least one positive integer tag id/i);
});

test('boolean flags with --key=false do not silently flip behavior', () => {
  const result = runCli(['--output', 'json', 'scan', '--active=false']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'UNKNOWN_FLAG');
  assert.match(payload.error.message, /--active=false/);
});

test('subcommand flags support --key=value syntax', () => {
  const tempDir = createTempDir('pandora-equals-flags-');
  const strategyHash = '0123456789abcdef';
  const stateDir = path.join(tempDir, '.pandora', 'mirror');
  const statePath = path.join(stateDir, `${strategyHash}.json`);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        tradesToday: 1,
      },
      null,
      2,
    ),
  );

  const result = runCli(['--output=json', 'mirror', 'status', `--strategy-hash=${strategyHash}`], {
    env: { HOME: tempDir },
  });

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.status');
  assert.equal(payload.data.strategyHash, strategyHash);
  removeDir(tempDir);
});

test('mirror close accepts --market-address alias', () => {
  const result = runCli([
    '--output',
    'json',
    'mirror',
    'close',
    '--market-address',
    ADDRESSES.mirrorMarket,
    '--polymarket-market-id',
    'poly-cond-1',
    '--dry-run',
  ]);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.close');
  assert.equal(payload.data.pandoraMarketAddress, ADDRESSES.mirrorMarket.toLowerCase());
});

test('mirror browse returns candidate markets with existing mirror hint', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'browse',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--limit',
      '5',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.browse');
    assert.equal(Array.isArray(payload.data.items), true);
    assert.equal(payload.data.filters.minYesPct, null);
    assert.equal(payload.data.filters.maxYesPct, null);
    assert.equal(payload.data.filters.limit, 5);
    if (payload.data.items.length > 0) {
      assert.equal(Object.prototype.hasOwnProperty.call(payload.data.items[0], 'existingMirror'), true);
      if (payload.data.items[0].existingMirror) {
        assert.equal(typeof payload.data.items[0].existingMirror.marketAddress, 'string');
        assert.equal(typeof payload.data.items[0].existingMirror.similarity, 'number');
      }
    }
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror browse supports sports tag filters via gamma events endpoint', async () => {
  const gamma = await startJsonHttpServer((request) => {
    const parsed = new URL(request.url || '/', 'http://127.0.0.1');
    if (parsed.pathname !== '/events') {
      return { status: 404, body: { error: 'not found' } };
    }

    const tagId = parsed.searchParams.get('tag_id');
    if (tagId !== '82') {
      return { body: { events: [] } };
    }

    return {
      body: {
        events: [
          {
            id: 'evt-epl-1',
            slug: 'everton-v-burnley',
            title: 'Everton vs Burnley',
            markets: [
              {
                condition_id: 'poly-epl-c1',
                market_slug: 'everton-v-burnley-home',
                question: 'Will Everton beat Burnley?',
                end_date_iso: FIXED_MIRROR_CLOSE_ISO,
                active: true,
                closed: false,
                volume24hr: 550000,
                tokens: [
                  { outcome: 'Yes', price: '0.605', token_id: 'poly-epl-yes-1' },
                  { outcome: 'No', price: '0.395', token_id: 'poly-epl-no-1' },
                ],
              },
            ],
          },
        ],
      },
    };
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'browse',
      '--skip-dotenv',
      '--polymarket-gamma-url',
      gamma.url,
      '--polymarket-tag-id',
      '82',
      '--limit',
      '5',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.browse');
    assert.equal(payload.data.source, 'polymarket:gamma-events');
    assert.deepEqual(payload.data.filters.polymarketTagIds, [82]);
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].eventSlug, 'everton-v-burnley');
    assert.equal(payload.data.items[0].eventTitle, 'Everton vs Burnley');
    assert.equal(payload.data.items[0].eventId, 'evt-epl-1');

    const eventRequest = gamma.requests.find((entry) => String(entry.url || '').startsWith('/events?'));
    assert.ok(eventRequest);
    const parsed = new URL(eventRequest.url, 'http://127.0.0.1');
    assert.equal(parsed.searchParams.get('tag_id'), '82');
    assert.equal(parsed.searchParams.get('active'), 'true');
    assert.equal(parsed.searchParams.get('closed'), 'false');
  } finally {
    await gamma.close();
  }
});

test('mirror browse supports non-sports short-window filtering in one call', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const nowMs = Date.now();
  const toIso = (offsetHours) => new Date(nowMs + offsetHours * 60 * 60 * 1000).toISOString();
  const gamma = await startJsonHttpServer((request) => {
    const parsed = new URL(request.url || '/', 'http://127.0.0.1');
    if (parsed.pathname !== '/markets') {
      return { status: 404, body: { error: 'not found' } };
    }
    return {
      body: {
        markets: [
          {
            condition_id: 's1',
            market_slug: 'everton-v-burnley-home',
            question: 'Will Everton beat Burnley?',
            end_date_iso: toIso(24),
            active: true,
            closed: false,
            volume24hr: 9000,
            liquidity: 9000,
            tags: [{ id: 82, slug: 'soccer' }],
            tokens: [
              { outcome: 'Yes', price: '0.61', token_id: 's1-yes' },
              { outcome: 'No', price: '0.39', token_id: 's1-no' },
            ],
          },
          {
            condition_id: 'c1',
            market_slug: 'bitcoin-etf-approval-2026',
            question: 'Will bitcoin ETF approval happen in 2026?',
            end_date_iso: toIso(36),
            active: true,
            closed: false,
            volume24hr: 8000,
            liquidity: 1000,
            tags: [{ slug: 'crypto' }],
            tokens: [
              { outcome: 'Yes', price: '0.45', token_id: 'c1-yes' },
              { outcome: 'No', price: '0.55', token_id: 'c1-no' },
            ],
          },
          {
            condition_id: 'c2',
            market_slug: 'bitcoin-price-120k-2026',
            question: 'Will bitcoin trade above 120k in 2026?',
            end_date_iso: toIso(18),
            active: true,
            closed: false,
            volume24hr: 2000,
            liquidity: 7000,
            tags: [{ slug: 'crypto' }],
            tokens: [
              { outcome: 'Yes', price: '0.55', token_id: 'c2-yes' },
              { outcome: 'No', price: '0.45', token_id: 'c2-no' },
            ],
          },
          {
            condition_id: 'x1',
            market_slug: 'bitcoin-over-300k',
            question: 'Will bitcoin exceed 300k?',
            end_date_iso: toIso(12),
            active: true,
            closed: false,
            volume24hr: 10000,
            liquidity: 1000,
            tags: [{ slug: 'crypto' }],
            tokens: [
              { outcome: 'Yes', price: '0.95', token_id: 'x1-yes' },
              { outcome: 'No', price: '0.05', token_id: 'x1-no' },
            ],
          },
        ],
      },
    };
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'browse',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-gamma-url',
      gamma.url,
      '--exclude-sports',
      '--end-date-before',
      '72h',
      '--min-yes-pct',
      '15',
      '--max-yes-pct',
      '85',
      '--sort-by',
      'volume24h',
      '--keyword',
      'bitcoin',
      '--limit',
      '10',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.browse');
    assert.equal(payload.data.filters.excludeSports, true);
    assert.equal(payload.data.filters.sortBy, 'volume24h');
    assert.equal(payload.data.count, 2);
    assert.equal(payload.data.items[0].slug, 'bitcoin-etf-approval-2026');
    assert.equal(payload.data.items[1].slug, 'bitcoin-price-120k-2026');
    assert.ok(Array.isArray(payload.data.items[0].categories));
    assert.ok(payload.data.items[0].categories.includes('crypto'));
  } finally {
    await indexer.close();
    await gamma.close();
  }
});

test('mirror sync accepts --market-address with --dry-run mode alias', async () => {
  const tempDir = createTempDir('pandora-mirror-sync-aliases-');
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'sync',
      'once',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
      '--market-address',
      ADDRESSES.mirrorMarket,
      '--polymarket-market-id',
      'poly-cond-1',
      '--dry-run',
      '--drift-trigger-bps',
      '25',
      '--hedge-trigger-usdc',
      '1000000',
      '--state-file',
      stateFile,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.sync');
    assert.equal(payload.data.mode, 'once');
    assert.equal(payload.data.executeLive, false);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror plan resolves slug selectors via gamma mock endpoint', async () => {
  const indexer = await startIndexerMockServer(buildMirrorIndexerOverrides());
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'plan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--polymarket-slug',
      'deterministic-tests-pass',
      '--polymarket-gamma-mock-url',
      polymarket.url,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.plan');
    assert.equal(payload.data.sourceMarket.sourceType, 'polymarket:gamma');
    assert.equal(payload.data.sourceMarket.slug, 'deterministic-tests-pass');
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('mirror verify --trust-deploy bypasses similarity for trusted manifest pairs', async () => {
  const tempDir = createTempDir('pandora-mirror-trust-');
  const manifestFile = path.join(tempDir, '.pandora', 'mirror', 'pairs.json');
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  fs.writeFileSync(
    manifestFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        pairs: [
          {
            id: 'pair-1',
            trusted: true,
            pandoraMarketAddress: ADDRESSES.mirrorMarket,
            polymarketMarketId: 'poly-cond-1',
            polymarketSlug: 'deterministic-tests-pass',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
      null,
      2,
    ),
  );

  const indexer = await startIndexerMockServer(
    buildMirrorIndexerOverrides({
      polls: [
        {
          ...buildMirrorIndexerOverrides().polls[0],
          question: 'Completely different wording for Pandora side',
        },
      ],
    }),
  );
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());

  try {
    const result = await runCliAsync(
      [
        '--output',
        'json',
        'mirror',
        'verify',
        '--skip-dotenv',
        '--indexer-url',
        indexer.url,
        '--polymarket-mock-url',
        polymarket.url,
        '--pandora-market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
        '--trust-deploy',
        '--manifest-file',
        manifestFile,
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.verify');
    assert.equal(payload.data.gateResult.ok, true);
    const matchCheck = payload.data.gateResult.checks.find((item) => item.code === 'MATCH_CONFIDENCE');
    assert.equal(Boolean(matchCheck && matchCheck.ok), true);
    assert.equal(Boolean(matchCheck && matchCheck.meta && matchCheck.meta.trustDeploy), true);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror sync --trust-deploy fails fast when trusted pair is missing', () => {
  const tempDir = createTempDir('pandora-mirror-trust-missing-');
  try {
    const result = runCli(
      [
        '--output',
        'json',
        'mirror',
        'sync',
        'once',
        '--skip-dotenv',
        '--pandora-market-address',
        ADDRESSES.mirrorMarket,
        '--polymarket-market-id',
        'poly-cond-1',
        '--paper',
        '--trust-deploy',
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.error.code, 'TRUST_DEPLOY_PAIR_NOT_FOUND');
  } finally {
    removeDir(tempDir);
  }
});

test('mirror status --with-live includes polymarket position visibility diagnostics', async () => {
  const tempDir = createTempDir('pandora-mirror-status-live-');
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
      'status',
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
    assert.equal(payload.command, 'mirror.status');
    assert.equal(typeof payload.data.live.driftBps, 'number');
    assert.equal(typeof payload.data.live.netPnlApproxUsdc, 'number');
    assert.equal(payload.data.live.netPnlApproxUsdc, 1.25);
    assert.equal(typeof payload.data.live.netDeltaApprox, 'number');
    assert.equal(typeof payload.data.live.pnlApprox, 'number');
    assert.equal(payload.data.live.polymarketPosition.yesBalance, 12.5);
    assert.equal(payload.data.live.polymarketPosition.noBalance, 3.25);
    assert.equal(payload.data.live.polymarketPosition.balanceScope.surface, 'polygon-usdc-wallet-collateral-only');
    assert.equal(payload.data.live.polymarketPosition.balanceScope.asset, 'USDC.e');
    assert.equal(payload.data.live.polymarketPosition.balanceScope.chainId, 137);
    assert.equal(payload.data.live.polymarketPosition.balanceScope.uiBalanceParityExpected, false);
    assert.equal(payload.data.live.polymarketPosition.openOrdersCount, 2);
    assert.equal(payload.data.live.polymarketPosition.openOrdersNotionalUsd, 4.96);
    assert.equal(payload.data.live.polymarketPosition.estimatedValueUsd, 10.095);
    assert.equal(payload.data.live.polymarketPosition.mergeReadiness.status, 'ready');
    assert.equal(payload.data.live.polymarketPosition.mergeReadiness.eligible, true);
    assert.equal(payload.data.live.polymarketPosition.mergeReadiness.mergeablePairs, 3.25);
    assert.equal(payload.data.live.crossVenue.status, 'attention');
    assert.equal(payload.data.live.crossVenue.gateOk, true);
    assert.equal(payload.data.live.crossVenue.sourceType, 'polymarket:mock');
    assert.equal(payload.data.live.hedgeStatus.hedgeSide, 'no');
    assert.equal(payload.data.live.hedgeStatus.hedgeGapAbsUsdc, 5);
    assert.equal(payload.data.live.hedgeStatus.triggered, false);
    assert.equal(payload.data.live.actionability.status, 'action-needed');
    assert.equal(payload.data.live.actionability.recommendedAction, 'rebalance-yes');
    assert.equal(Array.isArray(payload.data.live.actionableDiagnostics), true);
    assert.equal(payload.data.live.actionableDiagnostics.some((item) => item.code === 'DRIFT_TRIGGERED'), true);
    assert.equal(payload.data.live.actionableDiagnostics.some((item) => item.code === 'HEDGE_GAP_TRIGGERED'), false);
    assert.equal(Array.isArray(payload.data.live.pnlScenarios.feeVolumeScenarios), true);
    assert.equal(payload.data.live.pnlScenarios.feeVolumeScenarios.length > 0, true);
    assert.equal(payload.data.live.pnlScenarios.resolutionScenarios.yes.hedgeInventoryPayoutUsd, 12.5);
    assert.equal(payload.data.live.pnlScenarios.resolutionScenarios.no.hedgeInventoryPayoutUsd, 3.25);
    assert.equal(Array.isArray(payload.data.live.polymarketPosition.diagnostics), true);
    assert.equal(
      payload.data.live.polymarketPosition.diagnostics.some((entry) => /merge-eligible/i.test(String(entry))),
      true,
    );
    assert.equal(Array.isArray(payload.data.live.verifyDiagnostics), true);
    assert.equal(payload.data.live.sourceMarket.marketId, 'poly-cond-1');
    assert.equal(payload.data.live.pandoraMarket.marketAddress, ADDRESSES.mirrorMarket);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror pnl returns the dedicated cross-venue scenario surface', async () => {
  const tempDir = createTempDir('pandora-mirror-pnl-live-');
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
      'pnl',
      '--state-file',
      stateFile,
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.pnl');
    assert.equal(payload.data.summary.netPnlApproxUsdc, 1.25);
    assert.equal(payload.data.summary.pnlApprox, 11.345);
    assert.equal(payload.data.summary.netDeltaApprox, 9.25);
    assert.equal(payload.data.summary.hedgeGapUsdc, -5);
    assert.equal(payload.data.summary.currentHedgeUsdc, 5);
    assert.equal(payload.data.summary.runtimeHealth, 'idle');
    assert.equal(payload.data.crossVenue.status, 'attention');
    assert.equal(payload.data.actionability.recommendedAction, 'rebalance-yes');
    assert.equal(payload.data.polymarketPosition.openOrdersCount, 2);
    assert.equal(payload.data.scenarios.resolutionScenarios.yes.hedgeInventoryPayoutUsd, 12.5);
    assert.equal(
      payload.data.diagnostics.some((line) => String(line).includes('DRIFT_TRIGGERED')),
      true,
    );
    assert.equal(
      payload.data.diagnostics.includes('Loaded Polymarket position summary from mock payload.'),
      true,
    );
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror pnl --reconciled attaches ledger-grade summary rows when accounting inputs exist', async () => {
  const tempDir = createTempDir('pandora-mirror-pnl-reconciled-');
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
            {
              blockNumber: 112,
              blockTimestamp: '2026-03-09T10:05:00.000Z',
              reserveYesUsdc: 5,
              reserveNoUsdc: 5,
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
      'pnl',
      '--state-file',
      stateFile,
      '--reconciled',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.pnl');
    assert.equal(payload.data.summary.accountingMode, 'complete');
    assert.equal(payload.data.summary.realizedPnlUsdc, 1);
    assert.equal(payload.data.summary.unrealizedPnlUsdc, 9.345);
    assert.equal(payload.data.summary.netPnlUsdc, 10.345);
    assert.equal(payload.data.reconciled.status, 'complete');
    assert.deepEqual(payload.data.reconciled.provenance.missing, []);
    assert.equal(payload.data.reconciled.summary.transactionHashCount, 4);
    assert.equal(payload.data.reconciled.ledger.rows.some((row) => row.component === 'funding' && row.txHash === '0xfunding'), true);
    assert.equal(payload.data.reconciled.ledger.exportRows.some((row) => row.component === 'inventory-mark'), true);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror drift returns the dedicated drift surface', async () => {
  const tempDir = createTempDir('pandora-mirror-drift-live-');
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
      'mirror',
      'drift',
      '--skip-dotenv',
      '--state-file',
      stateFile,
      '--drift-trigger-bps',
      '25',
      '--hedge-trigger-usdc',
      '10',
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
    assert.equal(payload.command, 'mirror.drift');
    assert.equal(payload.data.stateFile, stateFile);
    assert.equal(payload.data.summary.triggerBps, 25);
    assert.equal(typeof payload.data.summary.driftBps, 'number');
    assert.equal(payload.data.summary.triggered, true);
    assert.equal(payload.data.summary.crossVenueStatus, 'attention');
    assert.equal(payload.data.summary.runtimeHealth, 'idle');
    assert.equal(payload.data.crossVenue.sourceType, 'polymarket:mock');
    assert.equal(payload.data.actionability.recommendedAction, 'rebalance-yes');
    assert.equal(payload.data.drift.sourceType, 'polymarket:mock');
    assert.equal(payload.data.sourceMarket.marketId, 'poly-cond-1');
    assert.equal(payload.data.pandoraMarket.marketAddress, ADDRESSES.mirrorMarket);
    assert.equal(
      payload.data.diagnostics.some((line) => String(line).includes('DRIFT_TRIGGERED')),
      true,
    );
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

test('mirror hedge-check returns the dedicated hedge surface and readable table output', async () => {
  const tempDir = createTempDir('pandora-mirror-hedge-check-live-');
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
    const jsonResult = await runCliAsync([
      '--output',
      'json',
      'mirror',
      'hedge-check',
      '--skip-dotenv',
      '--state-file',
      stateFile,
      '--hedge-trigger-usdc',
      '10',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
    ], {
      env: { HOME: tempDir },
    });

    assert.equal(jsonResult.status, 0);
    const payload = parseJsonOutput(jsonResult);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'mirror.hedge-check');
    assert.equal(typeof payload.data.summary.targetHedgeUsdc, 'number');
    assert.equal(payload.data.summary.currentHedgeUsdc, 5);
    assert.equal(payload.data.summary.hedgeGapUsdc, -5);
    assert.equal(payload.data.summary.hedgeGapAbsUsdc, 5);
    assert.equal(payload.data.summary.triggerUsdc, 10);
    assert.equal(payload.data.summary.triggered, false);
    assert.equal(payload.data.summary.hedgeSide, 'no');
    assert.equal(payload.data.summary.crossVenueStatus, 'attention');
    assert.equal(payload.data.hedge.hedgeGapAbsUsdc, 5);
    assert.equal(payload.data.polymarketPosition.openOrdersCount, 2);
    assert.equal(payload.data.actionability.recommendedAction, 'rebalance-yes');
    assert.equal(
      payload.data.diagnostics.includes('Loaded Polymarket position summary from mock payload.'),
      true,
    );

    const tableResult = await runCliAsync([
      'mirror',
      'hedge-check',
      '--skip-dotenv',
      '--state-file',
      stateFile,
      '--hedge-trigger-usdc',
      '10',
      '--indexer-url',
      indexer.url,
      '--polymarket-mock-url',
      polymarket.url,
    ], {
      env: { HOME: tempDir },
    });

    assert.equal(tableResult.status, 0);
    assert.match(String(tableResult.stdout || tableResult.output || ''), /Mirror Hedge Check/);
    assert.match(String(tableResult.stdout || tableResult.output || ''), /hedgeGapShares: -5/);
    assert.match(String(tableResult.stdout || tableResult.output || ''), /hedgeSide: no/);
  } finally {
    await indexer.close();
    await polymarket.close();
    removeDir(tempDir);
  }
});

