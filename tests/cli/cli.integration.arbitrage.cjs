const shared = require('./cli.integration.shared.cjs');
const { test, assert, crypto, fs, os, path, DOCTOR_ENV_KEYS, createTempDir, removeDir, runCli, runCliAsync, runCliWithTty, startJsonHttpServer, assertSchemaValid, omitGeneratedAt, omitTrustDistributionFromCapabilities, omitTrustDistributionDefinitions, assertManifestParity, createIsolatedPandoraEnv, createMcpToolRegistry, COMMAND_DESCRIPTOR_VERSION, buildCommandDescriptors, createRunMirrorCommand, buildSchemaPayload, buildSetupPlan, createOperationService, upsertOperation, createOperationStateStore, buildSdkContractArtifact, SDK_ARTIFACT_GENERATED_AT, buildPublishedPackageJson, repoPackage, generatedManifest, generatedContractRegistry, latestBenchmarkReport, typescriptSdkPackage, publishedPackage, setupWizardModulePath, setupRuntimeReady, setupTest, testInteractiveSetup, TEST_CLI_PATH, ADDRESSES, POLYMARKET_DEFAULTS, writeFile, parseJsonOutput, delay, isPidAlive, waitForPidExit, parseNdjsonOutput, stableJsonHash, deepCloneJson, parseTomlStringField, buildValidEnv, buildRules, buildMockHypeResponse, FIXED_FUTURE_TIMESTAMP, FIXED_MIRROR_CLOSE_ISO, FIXED_MIRROR_CLOSE_TS, buildMirrorIndexerOverrides, buildMirrorPolymarketOverrides, buildMirrorSportsPolymarketOverrides, buildLaunchArgs, buildCloneArgs, encodeUint256, encodeBool, decodeAddressFromCallData, startRpcMockServer, startPolymarketOpsRpcMock, encodeAddress, encodeString, encodeHexQuantity, startFeesWithdrawRpcMock, startMirrorTraceRpcMock, applyWhereFilter, applyListControls, asPage, resolveBatchEntitySelections, startIndexerMockServer, assertOddsShape, assertIsoTimestamp, startPhaseOneIndexerMockServer, startLifecycleIndexerMockServer, startAnalyzeIndexerMockServer, startPolymarketMockServer } = shared;

test('arbitrage combines pandora + polymarket fixtures', async () => {
  const indexer = await startIndexerMockServer();
  const polymarket = await startPolymarketMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'arbitrage',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--venues',
      'pandora,polymarket',
      '--polymarket-mock-url',
      polymarket.url,
      '--limit',
      '10',
      '--min-spread-pct',
      '1',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'arbitrage');
    assert.equal(payload.data.schemaVersion, '1.3.0');
    assert.equal(payload.data.parameters.crossVenueOnly, true);
    assert.equal(payload.data.count >= 1, true);
    assert.equal(Array.isArray(payload.data.opportunities), true);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('arbitrage defaults to cross-venue-only and allows same-venue override', async () => {
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: 'market-dup-1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-dup-1',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '12345',
        currentTvl: '4567000000',
        yesChance: '0.80',
        reserveYes: '80',
        reserveNo: '20',
        createdAt: '1700000001',
      },
      {
        id: 'market-dup-2',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-dup-2',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        marketType: 'amm',
        marketCloseTimestamp: '1710001000',
        totalVolume: '22345',
        currentTvl: '5567000000',
        yesChance: '0.55',
        reserveYes: '55',
        reserveNo: '45',
        createdAt: '1700000002',
      },
    ],
    polls: [
      {
        id: 'poll-dup-1',
        chainId: 1,
        chainName: 'ethereum',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        question: 'Will Arsenal win Premier League 2026?',
        status: 1,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpoll-dup-1',
      },
      {
        id: 'poll-dup-2',
        chainId: 1,
        chainName: 'ethereum',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        question: 'Will Arsenal FC win the Premier League in 2026?',
        status: 1,
        category: 3,
        deadlineEpoch: 1710001000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpoll-dup-2',
      },
    ],
  });

  try {
    const crossVenueOnly = await runCliAsync([
      '--output',
      'json',
      'arbitrage',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--venues',
      'pandora',
      '--limit',
      '10',
      '--min-spread-pct',
      '1',
      '--similarity-threshold',
      '0.5',
    ]);

    assert.equal(crossVenueOnly.status, 0);
    const crossPayload = parseJsonOutput(crossVenueOnly);
    assert.equal(crossPayload.data.parameters.crossVenueOnly, true);
    assert.equal(crossPayload.data.count, 0);

    const allowSameVenue = await runCliAsync([
      '--output',
      'json',
      'arbitrage',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--venues',
      'pandora',
      '--limit',
      '10',
      '--min-spread-pct',
      '1',
      '--similarity-threshold',
      '0.5',
      '--allow-same-venue',
    ]);

    assert.equal(allowSameVenue.status, 0);
    const sameVenuePayload = parseJsonOutput(allowSameVenue);
    assert.equal(sameVenuePayload.data.parameters.crossVenueOnly, false);
    assert.equal(sameVenuePayload.data.count >= 1, true);
    assert.equal(Array.isArray(sameVenuePayload.data.opportunities[0].venues), true);
    assert.deepEqual(sameVenuePayload.data.opportunities[0].venues, ['pandora']);
  } finally {
    await indexer.close();
  }
});

test('arbitrage hybrid matcher rejects cross-topic price-target collisions by default', async () => {
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: 'market-btc-1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-btc-1',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        marketType: 'amm',
        marketCloseTimestamp: '1773072000',
        totalVolume: '12345',
        currentTvl: '4567000000',
        yesChance: '0.42',
        reserveYes: '42',
        reserveNo: '58',
        createdAt: '1700000001',
      },
    ],
    polls: [
      {
        id: 'poll-btc-1',
        chainId: 1,
        chainName: 'ethereum',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        question: 'Will Bitcoin hit $75K in 2026?',
        status: 1,
        category: 4,
        deadlineEpoch: 1773072000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpoll-btc-1',
      },
    ],
  });
  const polymarket = await startPolymarketMockServer({
    markets: [
      {
        question: 'Will NFLX close above $750 in 2026?',
        condition_id: 'poly-cond-nflx-1',
        question_id: 'poly-q-nflx-1',
        market_slug: 'nflx-close-above-750',
        end_date_iso: '2026-03-09T16:00:00Z',
        active: true,
        closed: false,
        volume24hr: 100000,
        tokens: [
          { outcome: 'Yes', price: '0.63', token_id: 'poly-yes-nflx-1' },
          { outcome: 'No', price: '0.37', token_id: 'poly-no-nflx-1' },
        ],
      },
    ],
    orderbooks: {
      'poly-yes-nflx-1': {
        bids: [{ price: '0.62', size: '500' }],
        asks: [{ price: '0.63', size: '600' }],
      },
      'poly-no-nflx-1': {
        bids: [{ price: '0.36', size: '500' }],
        asks: [{ price: '0.37', size: '600' }],
      },
    },
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'arbitrage',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--venues',
      'pandora,polymarket',
      '--polymarket-mock-url',
      polymarket.url,
      '--limit',
      '10',
      '--min-spread-pct',
      '1',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.parameters.matcher, 'hybrid');
    assert.equal(payload.data.count, 0);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('arbitrage hybrid matcher can use mock AI adjudication to rescue borderline equivalents', async () => {
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: 'market-mavs-1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-mavs-1',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        marketType: 'amm',
        marketCloseTimestamp: '1773072000',
        totalVolume: '12345',
        currentTvl: '4567000000',
        yesChance: '0.42',
        reserveYes: '42',
        reserveNo: '58',
        createdAt: '1700000001',
      },
    ],
    polls: [
      {
        id: 'poll-mavs-1',
        chainId: 1,
        chainName: 'ethereum',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        question: 'Will Dallas Mavericks beat Boston Celtics?',
        status: 1,
        category: 4,
        deadlineEpoch: 1773072000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpoll-mavs-1',
      },
    ],
  });
  const polymarket = await startPolymarketMockServer({
    markets: [
      {
        question: 'Mavericks vs Celtics winner',
        condition_id: 'poly-cond-mavs-1',
        question_id: 'poly-q-mavs-1',
        market_slug: 'mavericks-vs-celtics-winner',
        end_date_iso: '2026-03-09T16:00:00Z',
        active: true,
        closed: false,
        volume24hr: 100000,
        tokens: [
          { outcome: 'Yes', price: '0.63', token_id: 'poly-yes-mavs-1' },
          { outcome: 'No', price: '0.37', token_id: 'poly-no-mavs-1' },
        ],
      },
    ],
    orderbooks: {
      'poly-yes-mavs-1': {
        bids: [{ price: '0.62', size: '500' }],
        asks: [{ price: '0.63', size: '600' }],
      },
      'poly-no-mavs-1': {
        bids: [{ price: '0.36', size: '500' }],
        asks: [{ price: '0.37', size: '600' }],
      },
    },
  });

  try {
    const withoutAi = await runCliAsync([
      '--output',
      'json',
      'arbitrage',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--venues',
      'pandora,polymarket',
      '--polymarket-mock-url',
      polymarket.url,
      '--limit',
      '10',
      '--min-spread-pct',
      '1',
      '--similarity-threshold',
      '0.9',
      '--include-similarity',
    ]);

    assert.equal(withoutAi.status, 0);
    const withoutAiPayload = parseJsonOutput(withoutAi);
    assert.equal(withoutAiPayload.data.count, 0);

    const withAi = await runCliAsync(
      [
        '--output',
        'json',
        'arbitrage',
        '--skip-dotenv',
        '--indexer-url',
        indexer.url,
        '--venues',
        'pandora,polymarket',
        '--polymarket-mock-url',
        polymarket.url,
        '--limit',
        '10',
        '--min-spread-pct',
        '1',
        '--similarity-threshold',
        '0.9',
        '--include-similarity',
        '--ai-provider',
        'mock',
      ],
      {
        env: {
          PANDORA_ARB_AI_MOCK_RESPONSE: JSON.stringify({
            equivalent: true,
            confidence: 0.95,
            reason: 'Same teams and same winner condition.',
            blockers: [],
            topic: 'sports',
            marketType: 'sports.team_result',
          }),
        },
      },
    );

    assert.equal(withAi.status, 0);
    const withAiPayload = parseJsonOutput(withAi);
    assert.equal(withAiPayload.ok, true);
    assert.equal(withAiPayload.data.parameters.aiProvider, 'mock');
    assert.equal(withAiPayload.data.count >= 1, true);
    assert.equal(withAiPayload.data.opportunities[0].matchSummary.aiAppliedPairCount >= 1, true);
    assert.equal(withAiPayload.data.opportunities[0].similarityChecks.some((entry) => entry.decisionSource === 'ai-overridden'), true);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('arbitrage exposes rules and similarity checks for agent verification', async () => {
  const indexer = await startIndexerMockServer({
    polls: [
      {
        id: 'poll-1',
        chainId: 1,
        chainName: 'ethereum',
        creator: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        question: 'Will deterministic tests pass?',
        status: 1,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpoll1',
        rules:
          'Resolves YES if deterministic tests pass in CI. Resolves NO if they fail. Unresolved or cancelled resolves NO.',
        sources: '["https://github.com","https://ci.example.com"]',
      },
    ],
  });
  const polymarket = await startPolymarketMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'arbitrage',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--venues',
      'pandora,polymarket',
      '--polymarket-mock-url',
      polymarket.url,
      '--limit',
      '10',
      '--min-spread-pct',
      '1',
      '--with-rules',
      '--include-similarity',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'arbitrage');
    assert.equal(payload.data.parameters.matcher, 'hybrid');
    assert.equal(payload.data.parameters.withRules, true);
    assert.equal(payload.data.parameters.includeSimilarity, true);
    assert.equal(payload.data.count >= 1, true);

    const opportunity = payload.data.opportunities[0];
    assert.equal(opportunity.matchSummary.matcher, 'hybrid');
    assert.equal(Array.isArray(opportunity.similarityChecks), true);
    assert.equal(opportunity.similarityChecks.length >= 1, true);
    assert.equal(opportunity.similarityChecks.some((entry) => entry.accepted === true), true);
    assert.equal(opportunity.similarityChecks.every((entry) => Array.isArray(entry.semanticBlockers)), true);
    const pandoraLeg = opportunity.legs.find((leg) => leg.venue === 'pandora');
    assert.equal(Boolean(pandoraLeg), true);
    assert.equal(typeof pandoraLeg.rules, 'string');
    assert.equal(Array.isArray(pandoraLeg.sources), true);
    assert.equal(pandoraLeg.sources.length, 2);
  } finally {
    await indexer.close();
    await polymarket.close();
  }
});

test('lifecycle start/status/resolve persists state and requires explicit confirm', () => {
  const tempDir = createTempDir('pandora-lifecycle-');
  const lifecycleDir = path.join(tempDir, 'lifecycles');
  const configPath = path.join(tempDir, 'lifecycle.json');
  writeFile(
    configPath,
    JSON.stringify({
      id: 'phase-e2e-1',
      source: 'integration-test',
      marketId: 'market-1',
    }),
  );

  const env = {
    HOME: tempDir,
    PANDORA_LIFECYCLE_DIR: lifecycleDir,
  };

  try {
    const start = runCli(
      ['--output', 'json', 'lifecycle', 'start', '--config', configPath],
      { env },
    );
    assert.equal(start.status, 0);
    const startPayload = parseJsonOutput(start);
    assert.equal(startPayload.command, 'lifecycle.start');
    assert.equal(startPayload.data.id, 'phase-e2e-1');
    assert.equal(startPayload.data.phase, 'AWAITING_RESOLVE');
    const lifecycleFile = path.join(lifecycleDir, 'phase-e2e-1.json');
    assert.equal(fs.existsSync(lifecycleFile), true);
    if (process.platform !== 'win32') {
      const mode = fs.statSync(lifecycleFile).mode & 0o777;
      assert.equal(mode, 0o600);
    }

    const status = runCli(
      ['--output', 'json', 'lifecycle', 'status', '--id', 'phase-e2e-1'],
      { env },
    );
    assert.equal(status.status, 0);
    const statusPayload = parseJsonOutput(status);
    assert.equal(statusPayload.command, 'lifecycle.status');
    assert.equal(statusPayload.data.phase, 'AWAITING_RESOLVE');

    const missingConfirm = runCli(
      ['--output', 'json', 'lifecycle', 'resolve', '--id', 'phase-e2e-1'],
      { env },
    );
    assert.equal(missingConfirm.status, 1);
    const missingConfirmPayload = parseJsonOutput(missingConfirm);
    assert.equal(missingConfirmPayload.error.code, 'MISSING_REQUIRED_FLAG');

    const resolve = runCli(
      ['--output', 'json', 'lifecycle', 'resolve', '--id', 'phase-e2e-1', '--confirm'],
      { env },
    );
    assert.equal(resolve.status, 0);
    const resolvePayload = parseJsonOutput(resolve);
    assert.equal(resolvePayload.command, 'lifecycle.resolve');
    assert.equal(resolvePayload.data.phase, 'RESOLVED');
    assert.equal(resolvePayload.data.changed, true);

    const resolvedStatus = runCli(
      ['--output', 'json', 'lifecycle', 'status', '--id', 'phase-e2e-1'],
      { env },
    );
    assert.equal(resolvedStatus.status, 0);
    const resolvedStatusPayload = parseJsonOutput(resolvedStatus);
    assert.equal(resolvedStatusPayload.data.phase, 'RESOLVED');
    assert.equal(typeof resolvedStatusPayload.data.resolvedAt, 'string');
  } finally {
    removeDir(tempDir);
  }
});

test('lifecycle rejects invalid persisted phases and concurrent starts are creation-safe', async () => {
  const tempDir = createTempDir('pandora-lifecycle-race-');
  const lifecycleDir = path.join(tempDir, 'lifecycles');
  const configPath = path.join(tempDir, 'lifecycle.json');
  writeFile(
    configPath,
    JSON.stringify({
      id: 'phase-race-1',
      source: 'integration-test',
      marketId: 'market-1',
    }),
  );

  const env = {
    HOME: tempDir,
    PANDORA_LIFECYCLE_DIR: lifecycleDir,
  };

  try {
    const [first, second] = await Promise.all([
      runCliAsync(['--output', 'json', 'lifecycle', 'start', '--config', configPath], { env }),
      runCliAsync(['--output', 'json', 'lifecycle', 'start', '--config', configPath], { env }),
    ]);
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [0, 1]);
    const failure = first.status === 1 ? parseJsonOutput(first) : parseJsonOutput(second);
    assert.equal(failure.error.code, 'LIFECYCLE_EXISTS');

    const lifecycleFile = path.join(lifecycleDir, 'phase-race-1.json');
    const persisted = JSON.parse(fs.readFileSync(lifecycleFile, 'utf8'));
    persisted.phase = 'BROKEN_PHASE';
    writeFile(lifecycleFile, JSON.stringify(persisted));

    const statusResult = runCli(['--output', 'json', 'lifecycle', 'status', '--id', 'phase-race-1'], { env });
    assert.equal(statusResult.status, 1);
    const statusPayload = parseJsonOutput(statusResult);
    assert.equal(statusPayload.error.code, 'LIFECYCLE_INVALID_PHASE');

    const resolveResult = runCli(['--output', 'json', 'lifecycle', 'resolve', '--id', 'phase-race-1', '--confirm'], { env });
    assert.equal(resolveResult.status, 1);
    const resolvePayload = parseJsonOutput(resolveResult);
    assert.equal(resolvePayload.error.code, 'LIFECYCLE_INVALID_PHASE');
  } finally {
    removeDir(tempDir);
  }
});

test('odds record rejects insecure non-local indexer urls', () => {
  const result = runCli([
    '--output',
    'json',
    'odds',
    'record',
    '--indexer-url',
    'http://example.com',
  ]);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_INDEXER_URL');
});

test('odds record rejects insecure polymarket host urls', () => {
  const result = runCli([
    '--output',
    'json',
    'odds',
    'record',
    '--competition',
    'soccer_epl',
    '--interval',
    '60',
    '--polymarket-host',
    'http://example.com',
  ]);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /--polymarket-host must use https/i);
});

test('arb scan emits ndjson opportunities when net spread threshold is exceeded', async () => {
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: 'arb-m1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-1',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.40',
        reserveYes: '400',
        reserveNo: '600',
        createdAt: '1700000000',
      },
      {
        id: 'arb-m2',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-2',
        creator: ADDRESSES.wallet2,
        marketType: 'amm',
        marketCloseTimestamp: '1710000001',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.60',
        reserveYes: '600',
        reserveNo: '400',
        createdAt: '1700000001',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      'arb',
      'scan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--markets',
      'arb-m1,arb-m2',
      '--output',
      'ndjson',
      '--min-net-spread-pct',
      '10',
      '--fee-pct-per-leg',
      '0.5',
      '--amount-usdc',
      '100',
      '--iterations',
      '1',
      '--interval-ms',
      '1',
    ]);

    assert.equal(result.status, 0);
    const lines = parseNdjsonOutput(result.stdout);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].type, 'arb.scan.opportunity');
    assert.equal(lines[0].buyYesMarket, 'arb-m1');
    assert.equal(lines[0].buyNoMarket, 'arb-m2');
    assert.equal(lines[0].netSpreadPct, 19);
    assert.equal(lines[0].netSpread, 0.19);
    assert.equal(lines[0].profitUsdc, 19);
    assert.equal(lines[0].profit, 19);
  } finally {
    await indexer.close();
  }
});

test('arb scan tolerates indexers that do not expose yesPct on markets', async () => {
  let rejectedMissingFieldQuery = false;
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: 'arb-compat-1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-compat-1',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000002',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.40',
        reserveYes: '400',
        reserveNo: '600',
        createdAt: '1700000002',
      },
      {
        id: 'arb-compat-2',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-compat-2',
        creator: ADDRESSES.wallet2,
        marketType: 'amm',
        marketCloseTimestamp: '1710000003',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.60',
        reserveYes: '600',
        reserveNo: '400',
        createdAt: '1700000003',
      },
    ],
    handleRequest: ({ query }) => {
      if (query.includes('markets(id:') && query.includes('yesPct')) {
        rejectedMissingFieldQuery = true;
        return {
          body: {
            errors: [{ message: 'Cannot query field "yesPct" on type "markets".' }],
          },
        };
      }
      return null;
    },
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'arb',
      'scan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--markets',
      'arb-compat-1,arb-compat-2',
      '--output',
      'json',
      '--iterations',
      '1',
      '--min-net-spread-pct',
      '10',
      '--fee-pct-per-leg',
      '0.5',
      '--amount-usdc',
      '100',
    ]);

    assert.equal(result.status, 0, result.output);
    assert.equal(rejectedMissingFieldQuery, false);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'arb.scan');
    assert.equal(payload.data.opportunities.length, 1);
    assert.equal(payload.data.opportunities[0].buyYesMarket, 'arb-compat-1');
    assert.equal(payload.data.opportunities[0].buyNoMarket, 'arb-compat-2');
    assert.equal(payload.data.opportunities[0].netSpreadPct, 19);
  } finally {
    await indexer.close();
  }
});

test('arb scan supports bounded JSON envelope output for agent integrations', async () => {
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: 'arb-json-1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-json-1',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710001000',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.40',
        reserveYes: '400',
        reserveNo: '600',
        createdAt: '1700001000',
      },
      {
        id: 'arb-json-2',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-json-2',
        creator: ADDRESSES.wallet2,
        marketType: 'amm',
        marketCloseTimestamp: '1710001001',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.61',
        reserveYes: '610',
        reserveNo: '390',
        createdAt: '1700001001',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'arb',
      'scan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--markets',
      'arb-json-1,arb-json-2',
      '--output',
      'json',
      '--iterations',
      '1',
      '--min-net-spread-pct',
      '5',
      '--fee-pct-per-leg',
      '0.5',
      '--amount-usdc',
      '100',
    ]);

    assert.equal(result.status, 0, result.output);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'arb.scan');
    assert.equal(payload.data.iterationsCompleted, 1);
    assert.equal(Array.isArray(payload.data.opportunities), true);
    assert.equal(typeof payload.data.opportunities.length, 'number');
  } finally {
    await indexer.close();
  }
});

test('arb scan --combinatorial emits bundle opportunities with fee/slippage-adjusted net edge', async () => {
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: 'arb-combo-1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-combo-1',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710001100',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.20',
        reserveYes: '200',
        reserveNo: '800',
        createdAt: '1700001100',
      },
      {
        id: 'arb-combo-2',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-combo-2',
        creator: ADDRESSES.wallet2,
        marketType: 'amm',
        marketCloseTimestamp: '1710001101',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.25',
        reserveYes: '250',
        reserveNo: '750',
        createdAt: '1700001101',
      },
      {
        id: 'arb-combo-3',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-combo-3',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710001102',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.30',
        reserveYes: '300',
        reserveNo: '700',
        createdAt: '1700001102',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      'arb',
      'scan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--markets',
      'arb-combo-1,arb-combo-2,arb-combo-3',
      '--output',
      'ndjson',
      '--combinatorial',
      '--max-bundle-size',
      '3',
      '--min-net-spread-pct',
      '10',
      '--fee-pct-per-leg',
      '0.5',
      '--slippage-pct-per-leg',
      '0.25',
      '--amount-usdc',
      '100',
      '--iterations',
      '1',
      '--interval-ms',
      '1',
    ]);

    assert.equal(result.status, 0);
    const lines = parseNdjsonOutput(result.stdout);
    const combo = lines.find(
      (row) =>
        row &&
        row.opportunityType === 'combinatorial' &&
        row.strategy === 'buy_yes_bundle' &&
        Array.isArray(row.bundleMarketIds) &&
        row.bundleMarketIds.length === 3,
    );

    assert.ok(combo);
    assert.equal(combo.grossEdgePct, 25);
    assert.equal(combo.feeImpactPct, 1.5);
    assert.equal(combo.slippageImpactPct, 0.75);
    assert.equal(combo.netSpreadPct, 22.75);
    assert.equal(combo.profitUsdc, 22.75);
  } finally {
    await indexer.close();
  }
});

test('arb scan is silent when no opportunities clear the threshold', async () => {
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: 'arb-quiet-1',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-quiet-1',
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.47',
        reserveYes: '470',
        reserveNo: '530',
        createdAt: '1700000000',
      },
      {
        id: 'arb-quiet-2',
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: 'poll-arb-quiet-2',
        creator: ADDRESSES.wallet2,
        marketType: 'amm',
        marketCloseTimestamp: '1710000001',
        totalVolume: '1000',
        currentTvl: '2000',
        yesChance: '0.52',
        reserveYes: '520',
        reserveNo: '480',
        createdAt: '1700000001',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      'arb',
      'scan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--markets',
      'arb-quiet-1,arb-quiet-2',
      '--output',
      'ndjson',
      '--min-net-spread-pct',
      '8',
      '--fee-pct-per-leg',
      '0.5',
      '--amount-usdc',
      '100',
      '--iterations',
      '1',
      '--interval-ms',
      '1',
    ]);

    assert.equal(result.status, 0);
    assert.equal(String(result.stdout || '').trim(), '');
  } finally {
    await indexer.close();
  }
});

test('autopilot once paper mode persists state and emits action', async () => {
  const tempDir = createTempDir('pandora-autopilot-');
  const stateFile = path.join(tempDir, 'state.json');
  const killFile = path.join(tempDir, 'STOP');

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'autopilot',
      'once',
      '--skip-dotenv',
      '--market-address',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--side',
      'no',
      '--amount-usdc',
      '10',
      '--trigger-yes-above',
      '50',
      '--yes-pct',
      '60',
      '--paper',
      '--state-file',
      stateFile,
      '--kill-switch-file',
      killFile,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'autopilot');
    assert.equal(payload.data.mode, 'once');
    assert.equal(payload.data.executeLive, false);
    assert.equal(payload.data.actionCount, 1);
    assert.equal(fs.existsSync(stateFile), true);
  } finally {
    removeDir(tempDir);
  }
});

test('autopilot --execute-live enforces required risk caps', () => {
  const result = runCli([
    '--output',
    'json',
    'autopilot',
    'once',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '10',
    '--trigger-yes-below',
    '20',
    '--execute-live',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.match(payload.error.message, /max-amount-usdc/);
});

