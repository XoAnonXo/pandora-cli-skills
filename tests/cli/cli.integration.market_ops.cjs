const shared = require('./cli.integration.shared.cjs');
const { test, assert, crypto, fs, os, path, DOCTOR_ENV_KEYS, createTempDir, removeDir, runCli, runCliAsync, runCliWithTty, startJsonHttpServer, assertSchemaValid, omitGeneratedAt, omitTrustDistributionFromCapabilities, omitTrustDistributionDefinitions, assertManifestParity, createIsolatedPandoraEnv, createMcpToolRegistry, COMMAND_DESCRIPTOR_VERSION, buildCommandDescriptors, createRunMirrorCommand, buildSchemaPayload, buildSetupPlan, createOperationService, upsertOperation, createOperationStateStore, buildSdkContractArtifact, SDK_ARTIFACT_GENERATED_AT, buildPublishedPackageJson, repoPackage, generatedManifest, generatedContractRegistry, latestBenchmarkReport, typescriptSdkPackage, publishedPackage, setupWizardModulePath, setupRuntimeReady, setupTest, testInteractiveSetup, TEST_CLI_PATH, ADDRESSES, POLYMARKET_DEFAULTS, writeFile, parseJsonOutput, delay, isPidAlive, waitForPidExit, parseNdjsonOutput, stableJsonHash, deepCloneJson, parseTomlStringField, buildValidEnv, buildRules, buildMockHypeResponse, FIXED_FUTURE_TIMESTAMP, FIXED_MIRROR_CLOSE_ISO, FIXED_MIRROR_CLOSE_TS, buildMirrorIndexerOverrides, buildMirrorPolymarketOverrides, buildMirrorSportsPolymarketOverrides, buildLaunchArgs, buildCloneArgs, encodeUint256, encodeBool, decodeAddressFromCallData, startRpcMockServer, startPolymarketOpsRpcMock, encodeAddress, encodeString, encodeHexQuantity, startFeesWithdrawRpcMock, startMirrorTraceRpcMock, applyWhereFilter, applyListControls, asPage, resolveBatchEntitySelections, startIndexerMockServer, assertOddsShape, assertIsoTimestamp, startPhaseOneIndexerMockServer, startLifecycleIndexerMockServer, startAnalyzeIndexerMockServer, startPolymarketMockServer } = shared;

test('markets list/get uses indexer graphql with json output', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const listResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--limit',
      '5',
    ]);
    assert.equal(listResult.timedOut, false);
    assert.equal(listResult.status, 0);
    const listPayload = parseJsonOutput(listResult);
    assert.equal(listPayload.data.count, 1);
    assert.equal(listPayload.data.items[0].id, 'market-1');

    const getResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'get',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--id',
      'market-1',
    ]);
    assert.equal(getResult.timedOut, false);
    assert.equal(getResult.status, 0);
    const getPayload = parseJsonOutput(getResult);
    assert.equal(getPayload.data.item.id, 'market-1');
  } finally {
    await indexer.close();
  }
});

test('read-only subcommands expose scoped --help output', () => {
  const marketsList = runCli(['markets', 'list', '--help']);
  assert.equal(marketsList.status, 0);
  assert.match(marketsList.output, /pandora markets list - List markets/);
  assert.doesNotMatch(marketsList.output, /Unknown flag for markets list/);

  const pollsList = runCli(['polls', 'list', '--help']);
  assert.equal(pollsList.status, 0);
  assert.match(pollsList.output, /pandora polls list - List polls/);

  const eventsGet = runCli(['events', 'get', '--help']);
  assert.equal(eventsGet.status, 0);
  assert.match(eventsGet.output, /pandora events get - Get an event by id/);

  const positionsList = runCli(['positions', 'list', '--help']);
  assert.equal(positionsList.status, 0);
  assert.match(positionsList.output, /pandora positions - Query wallet position entities/);
});

test('scan --help returns structured help instead of parser errors', () => {
  const result = runCli(['--output', 'json', 'scan', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'scan.help');
  assert.match(payload.data.usage, /scan/);
});

test('markets list supports lifecycle convenience filters', async () => {
  const indexer = await startLifecycleIndexerMockServer();

  try {
    const activeResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--active',
    ]);
    assert.equal(activeResult.status, 0);
    const activePayload = parseJsonOutput(activeResult);
    assert.equal(activePayload.data.filters.lifecycle, 'active');
    assert.equal(activePayload.data.count, 2);

    const resolvedResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--resolved',
    ]);
    assert.equal(resolvedResult.status, 0);
    const resolvedPayload = parseJsonOutput(resolvedResult);
    assert.equal(resolvedPayload.data.filters.lifecycle, 'resolved');
    assert.equal(resolvedPayload.data.count, 1);
    assert.equal(resolvedPayload.data.items[0].id, 'market-past');

    const expiringSoonResult = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--expiring-soon',
    ]);
    assert.equal(expiringSoonResult.status, 0);
    const expiringSoonPayload = parseJsonOutput(expiringSoonResult);
    assert.equal(expiringSoonPayload.data.filters.lifecycle, 'expiring-soon');
    assert.equal(expiringSoonPayload.data.count, 1);
    assert.equal(expiringSoonPayload.data.items[0].id, 'market-soon');
    assert.equal(expiringSoonPayload.data.lifecycle.expiringHours, 24);
  } finally {
    await indexer.close();
  }
});

test('markets get supports repeated --id values and reports missing ids', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'markets',
      'get',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--id',
      'market-1',
      '--id',
      'market-missing',
    ]);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    console.error(JSON.stringify(payload.data.polymarket, null, 2));
    console.error(JSON.stringify(payload.data.suggestions, null, 2));
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'markets.get');
    assert.equal(payload.data.requestedCount, 2);
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].id, 'market-1');
    assert.deepEqual(payload.data.missingIds, ['market-missing']);
  } finally {
    await indexer.close();
  }
});

test('markets get accepts comma-delimited ids in one flag', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'markets',
      'get',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--id',
      'market-1,market-missing',
    ]);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'markets.get');
    assert.equal(payload.data.requestedCount, 2);
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].id, 'market-1');
    assert.deepEqual(payload.data.missingIds, ['market-missing']);
  } finally {
    await indexer.close();
  }
});

test('markets list validates lifecycle flag combinations', () => {
  const conflicting = runCli([
    '--output',
    'json',
    'markets',
    'list',
    '--skip-dotenv',
    '--indexer-url',
    'http://127.0.0.1:1',
    '--active',
    '--resolved',
  ]);
  assert.equal(conflicting.status, 1);
  const conflictingPayload = parseJsonOutput(conflicting);
  assert.equal(conflictingPayload.error.code, 'INVALID_ARGS');
  assert.match(conflictingPayload.error.message, /mutually exclusive/);

  const missingLifecycle = runCli([
    '--output',
    'json',
    'markets',
    'list',
    '--skip-dotenv',
    '--indexer-url',
    'http://127.0.0.1:1',
    '--expiring-hours',
    '12',
  ]);
  assert.equal(missingLifecycle.status, 1);
  const missingLifecyclePayload = parseJsonOutput(missingLifecycle);
  assert.equal(missingLifecyclePayload.error.code, 'INVALID_ARGS');
  assert.match(missingLifecyclePayload.error.message, /requires --expiring-soon/);
});

test('markets list --with-odds falls back to latest liquidity event when market payload omits odds fields', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--with-odds',
      '--limit',
      '5',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'markets.list');
    assert.equal(payload.data.count, 1);

    const first = payload.data.items[0];
    assert.equal(typeof first.id, 'string');
    assert.equal(Boolean(first.odds && typeof first.odds === 'object'), true);
    assert.equal(first.odds.source, 'liquidity-event:latest');
    assert.equal(typeof first.odds.yesPct, 'number');
    assert.equal(typeof first.odds.noPct, 'number');
    assert.ok(Math.abs(first.odds.yesPct - 37.5) < 0.000001);
    assert.ok(Math.abs(first.odds.noPct - 62.5) < 0.000001);
  } finally {
    await indexer.close();
  }
});

test('markets list --expand includes poll details in json items', async () => {
  const indexer = await startPhaseOneIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--limit',
      '5',
      '--expand',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);

    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'markets.list');
    assert.equal(payload.data.count, 1);

    const first = payload.data.items[0];
    assert.equal(typeof first.id, 'string');
    assert.equal(Boolean(first.poll && typeof first.poll === 'object' && !Array.isArray(first.poll)), true);
    assert.equal(typeof first.poll.id, 'string');
    assert.equal(typeof first.poll.question, 'string');
    assert.equal(Number.isInteger(first.poll.status), true);
    assert.equal(Number.isInteger(first.poll.category), true);
    assert.ok(first.poll.deadlineEpoch !== undefined && first.poll.deadlineEpoch !== null);
  } finally {
    await indexer.close();
  }
});

test('markets list --with-odds includes normalized yes/no percentages in json items', async () => {
  const indexer = await startPhaseOneIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--limit',
      '5',
      '--with-odds',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);

    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'markets.list');
    assert.equal(payload.data.count, 1);

    const first = payload.data.items[0];
    assert.equal(typeof first.id, 'string');
    assert.equal(typeof first.totalVolume, 'number');
    assert.equal(typeof first.currentTvl, 'number');
    assertOddsShape(first.odds);
  } finally {
    await indexer.close();
  }
});

test('scan returns deterministic json contract for market candidates', async () => {
  const indexer = await startPhaseOneIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'scan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--limit',
      '5',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);

    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'scan');
    assert.equal(typeof payload.data.indexerUrl, 'string');
    assert.equal(typeof payload.data.count, 'number');
    assert.equal(Array.isArray(payload.data.items), true);
    assert.equal(payload.data.items.length, 1);
    assertIsoTimestamp(payload.data.generatedAt);

    const first = payload.data.items[0];
    assert.equal(typeof first.id, 'string');
    assert.equal(typeof first.chainId, 'number');
    assert.equal(typeof first.marketType, 'string');
    assert.equal(typeof first.question, 'string');
    assert.equal(typeof first.totalVolume, 'number');
    assert.equal(typeof first.currentTvl, 'number');
    assert.ok(first.marketCloseTimestamp !== undefined && first.marketCloseTimestamp !== null);
    assertOddsShape(first.odds);
  } finally {
    await indexer.close();
  }
});

test('scan --market-type parimutuel --resolved uses poll status for settled pari markets', async () => {
  const marketAddress = '0xf1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1';
  const pollAddress = '0xe1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1';
  const futureCloseTimestamp = String(Math.floor(Date.now() / 1000) + (48 * 60 * 60));
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'parimutuel',
        marketCloseTimestamp: futureCloseTimestamp,
        totalVolume: '1000',
        currentTvl: '500',
        reserveYes: '490',
        reserveNo: '10',
        createdAt: '1700000000',
      },
    ],
    polls: [
      {
        id: pollAddress,
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Was the settled pari market kept by scan?',
        status: 2,
        category: 3,
        deadlineEpoch: 1700000000,
        createdAt: 1700000000,
        createdTxHash: '0xhashscanpari',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'scan',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-type',
      'parimutuel',
      '--resolved',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.command, 'scan');
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].id, marketAddress);
    assert.equal(payload.data.items[0].poll.status, 2);
  } finally {
    await indexer.close();
  }
});

test('markets list --hedgeable matches against the current page without a second Pandora market crawl', async () => {
  const indexer = await startJsonHttpServer(({ bodyJson }) => {
    const query = String((bodyJson && bodyJson.query) || '');
    const variables = (bodyJson && bodyJson.variables) || {};
    const fixtures = {
      markets: [
        {
          id: 'market-hedgeable-1',
          chainId: 1,
          chainName: 'ethereum',
          pollAddress: 'poll-hedgeable-1',
          creator: ADDRESSES.wallet1,
          marketType: 'amm',
          marketCloseTimestamp: '1893456000',
          totalVolume: '12345',
          currentTvl: '4567',
          createdAt: '1700000000',
        },
        {
          id: 'market-hedgeable-2',
          chainId: 1,
          chainName: 'ethereum',
          pollAddress: 'poll-hedgeable-2',
          creator: ADDRESSES.wallet1,
          marketType: 'amm',
          marketCloseTimestamp: '1893463200',
          totalVolume: '9876',
          currentTvl: '3210',
          createdAt: '1700000001',
        },
        {
          id: 'market-hedgeable-3',
          chainId: 1,
          chainName: 'ethereum',
          pollAddress: 'poll-hedgeable-3',
          creator: ADDRESSES.wallet1,
          marketType: 'amm',
          marketCloseTimestamp: '1893466800',
          totalVolume: '7654',
          currentTvl: '2100',
          createdAt: '1700000002',
        },
      ],
      polls: [
        {
          id: 'poll-hedgeable-1',
          question: 'Will Arsenal beat Chelsea?',
          status: 0,
          category: 3,
          deadlineEpoch: 1893456000,
        },
        {
          id: 'poll-hedgeable-2',
          question: 'Will bitcoin close above 150k?',
          status: 0,
          category: 3,
          deadlineEpoch: 1893463200,
        },
        {
          id: 'poll-hedgeable-3',
          question: 'Will Trump die before April 01?',
          status: 0,
          category: 3,
          deadlineEpoch: 1893466800,
        },
      ],
    };
    const data = {};

    if (query.includes('marketss(')) {
      data.marketss = asPage(applyListControls(fixtures.markets, variables));
    }

    const batchPolls = resolveBatchEntitySelections(query, variables, 'polls', (id) =>
      fixtures.polls.find((entry) => entry.id === id) || null,
    );
    if (batchPolls) {
      Object.assign(data, batchPolls);
    }

    if (query.includes('polls(id:') && Object.prototype.hasOwnProperty.call(variables, 'id')) {
      data.polls = fixtures.polls.find((entry) => entry.id === variables.id) || null;
    }

    if (Object.keys(data).length) {
      return { body: { data } };
    }

    return {
      status: 400,
      body: {
        errors: [{ message: 'Unsupported hedgeable query in mock indexer' }],
      },
    };
  });

  const gamma = await startJsonHttpServer(() => ({
    body: [
      {
        conditionId: 'poly-hedgeable-1',
        question: 'Will Arsenal beat Chelsea?',
        endDateIso: '2030-01-01T00:00:00Z',
        tokens: [
          { outcome: 'Yes', price: 0.61 },
          { outcome: 'No', price: 0.39 },
        ],
      },
      {
        conditionId: 'poly-hedgeable-2',
        question: 'Will Real Madrid win La Liga?',
        endDateIso: '2030-01-01T02:00:00Z',
        tokens: [
          { outcome: 'Yes', price: 0.55 },
          { outcome: 'No', price: 0.45 },
        ],
      },
      {
        conditionId: 'poly-hedgeable-3',
        question: 'Will Trump sign 7 pieces of legislation in March?',
        endDateIso: '2030-01-01T03:00:00Z',
        tokens: [
          { outcome: 'Yes', price: 0.48 },
          { outcome: 'No', price: 0.52 },
        ],
      },
    ],
  }));

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--limit',
      '5',
      '--hedgeable',
    ], {
      env: {
        POLYMARKET_GAMMA_HOST: gamma.url,
      },
    });

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);

    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'markets.list');
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].id, 'market-hedgeable-1');

    const marketListRequests = indexer.requests.filter((request) =>
      String(request.bodyJson && request.bodyJson.query || '').includes('marketss('),
    );
    assert.equal(marketListRequests.length, 1);

    const pollLookupRequests = indexer.requests.filter((request) =>
      String(request.bodyJson && request.bodyJson.query || '').includes('polls(id:'),
    );
    assert.equal(pollLookupRequests.length, 1);
  } finally {
    await Promise.all([indexer.close(), gamma.close()]);
  }
});

test('quote derives odds and estimates from latest liquidity snapshot', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'quote',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-address',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--side',
      'yes',
      '--amount-usdc',
      '50',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);

    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'quote');
    assert.equal(payload.data.marketAddress, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.equal(payload.data.side, 'yes');
    assert.equal(payload.data.quoteAvailable, true);
    assert.equal(payload.data.odds.source, 'liquidity-event:latest');
    assert.equal(typeof payload.data.estimate.estimatedShares, 'number');
    assert.ok(payload.data.estimate.estimatedShares > 0);
    assert.ok(payload.data.estimate.minSharesOut <= payload.data.estimate.estimatedShares);
  } finally {
    await indexer.close();
  }
});

test('quote --amounts uses AMM reserve curve (non-linear slippage) when reserves are available', async () => {
  const marketAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '120000',
        currentTvl: '768',
        yesChance: '0.23828125',
        reserveYes: '585000000',
        reserveNo: '183000000',
        createdAt: '1700000000',
      },
    ],
    liquidityEvents: [
      {
        id: 'evt-liq-curve-1',
        chainId: 1,
        chainName: 'ethereum',
        provider: ADDRESSES.wallet1,
        marketAddress,
        pollAddress: marketAddress,
        eventType: 'addLiquidity',
        collateralAmount: '1000',
        lpTokens: '500',
        yesTokenAmount: '585000000',
        noTokenAmount: '183000000',
        yesTokensReturned: '0',
        noTokensReturned: '0',
        txHash: '0xtx-liq-curve-1',
        timestamp: 1700000100,
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'quote',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-address',
      marketAddress,
      '--side',
      'yes',
      '--amount-usdc',
      '25',
      '--amounts',
      '25,50,75,150',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'quote');
    assert.equal(payload.data.estimate.estimateSource, 'amm-reserves');
    assert.equal(Array.isArray(payload.data.curve), true);
    assert.equal(payload.data.curve.length, 4);

    const slippages = payload.data.curve.map((point) => point.slippagePct);
    assert.ok(slippages.every((value) => typeof value === 'number'));
    assert.ok(slippages[1] > slippages[0]);
    assert.ok(slippages[2] > slippages[1]);
    assert.ok(slippages[3] > slippages[2]);
  } finally {
    await indexer.close();
  }
});

test('quote supports manual odds override via --yes-pct without indexer calls', () => {
  const result = runCli([
    '--output',
    'json',
    'quote',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'no',
    '--amount-usdc',
    '20',
    '--yes-pct',
    '60',
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'quote');
  assert.equal(payload.data.odds.source, 'manual:yes-pct');
  assert.equal(payload.data.quoteAvailable, true);
  assert.ok(payload.data.estimate.estimatedShares > 0);
});

test('quote --target-pct computes the required AMM buy to reach the requested YES percentage', async () => {
  const marketAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '120000',
        currentTvl: '768',
        yesChance: '0.23828125',
        reserveYes: '585000000',
        reserveNo: '183000000',
        createdAt: '1700000000',
      },
    ],
    liquidityEvents: [
      {
        id: 'evt-liq-target-pct-1',
        chainId: 1,
        chainName: 'ethereum',
        provider: ADDRESSES.wallet1,
        marketAddress,
        pollAddress: marketAddress,
        eventType: 'addLiquidity',
        collateralAmount: '1000',
        lpTokens: '500',
        yesTokenAmount: '585000000',
        noTokenAmount: '183000000',
        yesTokensReturned: '0',
        noTokensReturned: '0',
        txHash: '0xtx-liq-target-pct-1',
        timestamp: 1700000100,
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'quote',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-address',
      marketAddress,
      '--side',
      'yes',
      '--target-pct',
      '40',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'quote');
    assert.equal(payload.data.targetPct, 40);
    assert.equal(payload.data.quoteAvailable, true);
    assert.equal(payload.data.targeting.currentPct, 23.828125);
    assert.equal(payload.data.targeting.targetPct, 40);
    assert.equal(payload.data.targeting.requiredSide, 'yes');
    assert.ok(payload.data.targeting.requiredAmountUsdc > 0);
    assert.equal(payload.data.amountUsdc, payload.data.targeting.requiredAmountUsdc);
    assert.ok(Math.abs(payload.data.targeting.postTradePct - 40) < 0.02);
    assert.deepEqual(payload.data.targeting.diagnostics, []);
    assert.deepEqual(payload.data.diagnostics, []);
  } finally {
    await indexer.close();
  }
});

test('quote --target-pct rejects a requested side that cannot reach the requested YES percentage', async () => {
  const marketAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '120000',
        currentTvl: '768',
        yesChance: '0.23828125',
        reserveYes: '585000000',
        reserveNo: '183000000',
        createdAt: '1700000000',
      },
    ],
    liquidityEvents: [
      {
        id: 'evt-liq-target-pct-2',
        chainId: 1,
        chainName: 'ethereum',
        provider: ADDRESSES.wallet1,
        marketAddress,
        pollAddress: marketAddress,
        eventType: 'addLiquidity',
        collateralAmount: '1000',
        lpTokens: '500',
        yesTokenAmount: '585000000',
        noTokenAmount: '183000000',
        yesTokensReturned: '0',
        noTokensReturned: '0',
        txHash: '0xtx-liq-target-pct-2',
        timestamp: 1700000100,
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'quote',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-address',
      marketAddress,
      '--side',
      'no',
      '--target-pct',
      '40',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.error.code, 'INVALID_FLAG_COMBINATION');
    assert.match(payload.error.message, /requires buying YES/i);
  } finally {
    await indexer.close();
  }
});

test('quote --target-pct rejects explicit buy amounts in the same request', () => {
  const result = runCli([
    '--output',
    'json',
    'quote',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--target-pct',
    '55',
    '--amount-usdc',
    '10',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'INVALID_FLAG_COMBINATION');
  assert.match(payload.error.message, /Use either --target-pct or --amount-usdc\/--amounts/);
});

test('quote --target-pct rejects pari-mutuel markets explicitly', async () => {
  const marketAddress = '0xdddddddddddddddddddddddddddddddddddddddd';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'parimutuel',
        marketCloseTimestamp: '1710000000',
        totalVolume: '1000',
        currentTvl: '1000',
        reserveYes: '400',
        reserveNo: '600',
        createdAt: '1700000000',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'quote',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-address',
      marketAddress,
      '--side',
      'yes',
      '--target-pct',
      '55',
    ]);

    assert.equal(result.status, 1);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'INVALID_FLAG_COMBINATION');
    assert.match(payload.error.message, /only supported for AMM quote requests/i);
  } finally {
    await indexer.close();
  }
});

test('quote --help prints command help without parser errors', () => {
  const result = runCli(['quote', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.output, /pandora quote - Estimate a YES\/NO buy or sell/);
  assert.doesNotMatch(result.output, /Unknown flag for quote/);
});

test('trade requires exactly one execution mode flag', () => {
  const result = runCli([
    '--output',
    'json',
    'trade',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '10',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'INVALID_ARGS');
  assert.match(payload.error.message, /--dry-run or --execute/);
});

test('trade enforces --max-amount-usdc guardrail', () => {
  const result = runCli([
    '--output',
    'json',
    'trade',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '25',
    '--yes-pct',
    '55',
    '--max-amount-usdc',
    '10',
    '--dry-run',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'TRADE_RISK_GUARD');
  assert.match(payload.error.message, /exceeds --max-amount-usdc/);
});

test('trade enforces probability guardrails', () => {
  const result = runCli([
    '--output',
    'json',
    'trade',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '10',
    '--yes-pct',
    '40',
    '--min-probability-pct',
    '50',
    '--dry-run',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'TRADE_RISK_GUARD');
  assert.match(payload.error.message, /below --min-probability-pct/);
});

test('trade --execute blocks unquoted execution by default', () => {
  const result = runCli([
    '--output',
    'json',
    'trade',
    '--skip-dotenv',
    '--indexer-url',
    'http://127.0.0.1:1',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '10',
    '--execute',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'TRADE_RISK_GUARD');
  assert.match(payload.error.message, /requires a quote by default/);
});

test('trade --allow-unquoted-execute bypasses quote-availability guardrail', () => {
  const result = runCli([
    '--output',
    'json',
    'trade',
    '--skip-dotenv',
    '--indexer-url',
    'http://127.0.0.1:1',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '10',
    '--allow-unquoted-execute',
    '--execute',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.notEqual(payload.error.code, 'TRADE_RISK_GUARD');
});

test('trade --help prints command help', () => {
  const result = runCli(['trade', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.output, /pandora trade - Execute a buy on a market/);
});

test('trade --dry-run returns execution plan and embedded quote', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'trade',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-address',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--side',
      'yes',
      '--amount-usdc',
      '25',
      '--dry-run',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'trade');
    assert.equal(payload.data.mode, 'dry-run');
    assert.equal(payload.data.status, 'ok');
    assert.equal(payload.data.quote.quoteAvailable, true);
    assert.equal(Array.isArray(payload.data.executionPlan.steps), true);
    assert.equal(payload.data.executionPlan.steps.length, 3);
  } finally {
    await indexer.close();
  }
});

test('polls list/get uses indexer graphql with filters', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const listResult = await runCliAsync([
      '--output',
      'json',
      'polls',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--question-contains',
      'deterministic',
    ]);
    assert.equal(listResult.timedOut, false);
    assert.equal(listResult.status, 0);
    const listPayload = parseJsonOutput(listResult);
    assert.equal(listPayload.data.count, 1);
    assert.equal(listPayload.data.items[0].id, 'poll-1');

    const getResult = await runCliAsync([
      '--output',
      'json',
      'polls',
      'get',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--id',
      'poll-1',
    ]);
    assert.equal(getResult.timedOut, false);
    assert.equal(getResult.status, 0);
    const getPayload = parseJsonOutput(getResult);
    assert.equal(getPayload.data.item.id, 'poll-1');
  } finally {
    await indexer.close();
  }
});

test('events list/get aggregates configured event sources', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const listResult = await runCliAsync([
      '--output',
      'json',
      'events',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--type',
      'all',
      '--limit',
      '10',
    ]);

    assert.equal(listResult.timedOut, false);
    assert.equal(listResult.status, 0);
    const listPayload = parseJsonOutput(listResult);
    assert.equal(listPayload.data.count, 3);

    const sources = new Set(listPayload.data.items.map((item) => item.source));
    assert.equal(sources.has('liquidity'), true);
    assert.equal(sources.has('oracle-fee'), true);
    assert.equal(sources.has('claim'), true);

    const getResult = await runCliAsync([
      '--output',
      'json',
      'events',
      'get',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--id',
      'evt-oracle-1',
    ]);

    assert.equal(getResult.timedOut, false);
    assert.equal(getResult.status, 0);
    const getPayload = parseJsonOutput(getResult);
    assert.equal(getPayload.data.item.source, 'oracle-fee');
  } finally {
    await indexer.close();
  }
});

test('events list with --chain-id does not send chainId to claim filters', async () => {
  const indexer = await startJsonHttpServer(({ bodyJson }) => {
    const query = (bodyJson && bodyJson.query) || '';
    const variables = (bodyJson && bodyJson.variables) || {};

    if (query.includes('liquidityEventss(')) {
      return { body: { data: { liquidityEventss: asPage([]) } } };
    }

    if (query.includes('oracleFeeEventss(')) {
      return { body: { data: { oracleFeeEventss: asPage([]) } } };
    }

    if (query.includes('claimEventss(')) {
      if (variables.where && Object.prototype.hasOwnProperty.call(variables.where, 'chainId')) {
        return {
          body: {
            errors: [{ message: 'Field "chainId" is not defined by type "claimEventsFilter".' }],
          },
        };
      }
      return {
        body: {
          data: {
            claimEventss: asPage([
              {
                id: 'evt-claim-safe',
                campaignAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
                userAddress: ADDRESSES.wallet1,
                amount: '5',
                signature: '0xsig',
                blockNumber: 500,
                timestamp: 1700000000,
                txHash: '0xtx-claim-safe',
              },
            ]),
          },
        },
      };
    }

    return {
      status: 400,
      body: {
        errors: [{ message: 'Unsupported query in mock indexer' }],
      },
    };
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'events',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--chain-id',
      '1',
      '--limit',
      '10',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].source, 'claim');

    const claimRequest = indexer.requests.find((req) =>
      String((req.bodyJson && req.bodyJson.query) || '').includes('claimEventss('),
    );
    assert.equal(Boolean(claimRequest), true);
    assert.equal(Object.prototype.hasOwnProperty.call(claimRequest.bodyJson.variables.where, 'chainId'), false);
  } finally {
    await indexer.close();
  }
});

test('fees summarizes indexed oracle-fee history for a recipient wallet', async () => {
  const indexer = await startIndexerMockServer({
    oracleFeeEvents: [
      {
        id: 'evt-oracle-summary-1',
        chainId: 1,
        chainName: 'ethereum',
        oracleAddress: ADDRESSES.oracle,
        eventName: 'FeeUpdated',
        newFee: '250',
        to: ADDRESSES.wallet2,
        amount: '0',
        txHash: '0xtx-oracle-summary-1',
        blockNumber: 300,
        timestamp: 1700001200,
      },
      {
        id: 'evt-oracle-summary-2',
        chainId: 1,
        chainName: 'ethereum',
        oracleAddress: ADDRESSES.oracle,
        eventName: 'FeesWithdrawn',
        newFee: '250',
        to: ADDRESSES.wallet2,
        amount: '2500000',
        txHash: '0xtx-oracle-summary-2',
        blockNumber: 301,
        timestamp: 1700001300,
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'fees',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet2,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.command, 'fees');
    assert.equal(payload.data.summary.count, 2);
    assert.equal(payload.data.summary.totalAmountUsdc, 2.5);
    assert.equal(payload.data.summary.lastUpdatedFeeBps, 250);
    assert.equal(payload.data.items[0].eventName, 'FeesWithdrawn');
  } finally {
    await indexer.close();
  }
});

test('fees withdraw dry-run previews market-level protocol fee splits', async () => {
  const rpc = await startFeesWithdrawRpcMock({
    marketAddress: ADDRESSES.mirrorMarket,
    factory: ADDRESSES.factory,
    collateralToken: ADDRESSES.usdc,
    creator: ADDRESSES.wallet1,
    platformTreasury: ADDRESSES.wallet2,
    protocolFeesCollected: 106_000_001n,
    decimals: 6,
    symbol: 'USDC',
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'fees',
      'withdraw',
      '--skip-dotenv',
      '--market-address',
      ADDRESSES.mirrorMarket,
      '--dry-run',
      '--rpc-url',
      rpc.url,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.command, 'fees.withdraw');
    assert.equal(payload.data.mode, 'dry-run');
    assert.equal(payload.data.status, 'planned');
    assert.equal(payload.data.marketAddress, ADDRESSES.mirrorMarket.toLowerCase());
    assert.equal(payload.data.contract.platformTreasury, ADDRESSES.wallet2.toLowerCase());
    assert.equal(payload.data.contract.creator, ADDRESSES.wallet1.toLowerCase());
    assert.equal(payload.data.feeState.withdrawableRaw, '106000001');
    assert.equal(payload.data.feeState.withdrawable, '106.000001');
    assert.equal(payload.data.feeState.platformShare, '53');
    assert.equal(payload.data.feeState.creatorShare, '53.000001');
    assert.equal(payload.data.preflight.executeSupported, true);
    assert.equal(payload.data.preflight.simulationAttempted, false);
  } finally {
    await rpc.close();
  }
});

test('fees withdraw --all-markets dry-run previews creator-scoped protocol fee sweeps', async () => {
  const creator = ADDRESSES.wallet1.toLowerCase();
  const marketA = '0x998e2e406a48911bd66bc970c79e727c0bc9788f';
  const marketB = '0xd4dca4e8d7bf39f2f5a42d604f5c27a0f1fa5b67';
  const rpc = await startFeesWithdrawRpcMock({
    markets: [
      {
        marketAddress: marketA,
        factory: ADDRESSES.factory,
        collateralToken: ADDRESSES.usdc,
        creator,
        platformTreasury: ADDRESSES.wallet2,
        protocolFeesCollected: 72_420_000n,
        decimals: 6,
        symbol: 'USDC',
      },
      {
        marketAddress: marketB,
        factory: ADDRESSES.factory,
        collateralToken: ADDRESSES.usdc,
        creator,
        platformTreasury: ADDRESSES.wallet2,
        protocolFeesCollected: 47_340_000n,
        decimals: 6,
        symbol: 'USDC',
      },
    ],
  });
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketA,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        creator,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '12345',
        currentTvl: '4567',
        yesChance: '0.625',
        reserveYes: '625',
        reserveNo: '375',
        createdAt: '1700000000',
      },
      {
        id: marketB,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        creator,
        marketType: 'amm',
        marketCloseTimestamp: '1710000100',
        totalVolume: '22345',
        currentTvl: '5567',
        yesChance: '0.425',
        reserveYes: '425',
        reserveNo: '575',
        createdAt: '1700000050',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'fees',
      'withdraw',
      '--skip-dotenv',
      '--all-markets',
      '--creator',
      creator,
      '--dry-run',
      '--indexer-url',
      indexer.url,
      '--rpc-url',
      rpc.url,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.command, 'fees.withdraw');
    assert.equal(payload.data.action, 'withdraw-all-markets');
    assert.equal(payload.data.mode, 'dry-run');
    assert.equal(payload.data.creator, creator);
    assert.equal(payload.data.summary.marketCount, 2);
    assert.equal(payload.data.summary.withdrawableRawTotal, '119760000');
    assert.equal(payload.data.summary.withdrawableTotal, '119.76');
    assert.equal(payload.data.summary.platformShareTotal, '59.88');
    assert.equal(payload.data.summary.creatorShareTotal, '59.88');
    assert.equal(payload.data.items.length, 2);
    assert.equal(payload.data.items.every((item) => item.ok === true), true);
  } finally {
    await rpc.close();
    await indexer.close();
  }
});

test('fees withdraw --all-markets requires --creator so batch sweep selection stays explicit', async () => {
  const result = await runCliAsync([
    '--output',
    'json',
    'fees',
    'withdraw',
    '--skip-dotenv',
    '--all-markets',
    '--dry-run',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.match(payload.error.message, /requires --creator <address>/i);
});

test('table-mode GraphQL errors render human-readable messages', async () => {
  const indexer = await startJsonHttpServer(() => ({
    body: {
      errors: [{ message: 'Invalid field for orderBy', extensions: { code: 'BAD_USER_INPUT' } }],
    },
  }));

  try {
    const result = await runCliAsync([
      'markets',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 1);
    assert.match(result.output, /Indexer GraphQL query failed\./);
    assert.match(result.output, /- Invalid field for orderBy/);
    assert.doesNotMatch(result.output, /\[object Object\]/);
  } finally {
    await indexer.close();
  }
});

test('debug market returns market, poll, position, trade, and liquidity context', async () => {
  const marketAddress = '0xdededededededededededededededededededede';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '5000000',
        currentTvl: '2000000',
        reserveYes: '600000',
        reserveNo: '400000',
        createdAt: '1700000000',
      },
    ],
    polls: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Will debug market show a stitched forensic view?',
        status: 0,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhash-debug-market',
      },
    ],
    positions: [
      {
        id: 'pos-debug-1',
        chainId: 1,
        marketAddress,
        user: ADDRESSES.wallet1,
        lastTradeAt: 1700000400,
        yesTokenAmount: '1000000',
        noTokenAmount: '0',
      },
      {
        id: 'pos-debug-2',
        chainId: 1,
        marketAddress,
        user: ADDRESSES.wallet2,
        lastTradeAt: 1700000500,
        yesTokenAmount: '0',
        noTokenAmount: '300000',
      },
    ],
    trades: [
      {
        id: 'trade-debug-1',
        chainId: 1,
        marketAddress,
        pollAddress: marketAddress,
        trader: ADDRESSES.wallet1,
        side: 'yes',
        tradeType: 'buy',
        collateralAmount: '1500000',
        tokenAmount: '2500000',
        tokenAmountOut: '2500000',
        feeAmount: '15000',
        timestamp: 1700000600,
        txHash: '0xdebug-market-trade-1',
      },
    ],
    liquidityEvents: [
      {
        id: 'liq-debug-1',
        chainId: 1,
        chainName: 'ethereum',
        provider: ADDRESSES.wallet1,
        marketAddress,
        pollAddress: marketAddress,
        eventType: 'addLiquidity',
        collateralAmount: '2000000',
        lpTokens: '500000',
        yesTokenAmount: '1200000',
        noTokenAmount: '800000',
        yesTokensReturned: '0',
        noTokensReturned: '0',
        txHash: '0xdebug-market-liq-1',
        timestamp: 1700000200,
      },
    ],
    claimEvents: [
      {
        id: 'claim-debug-1',
        campaignAddress: marketAddress,
        userAddress: ADDRESSES.wallet1,
        amount: '500000',
        signature: '0xsig-debug',
        blockNumber: 450,
        timestamp: 1700000800,
        txHash: '0xdebug-market-claim-1',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'debug',
      'market',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-address',
      marketAddress,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.command, 'debug.market');
    assert.equal(payload.data.market.id, marketAddress);
    assert.equal(payload.data.poll.question, 'Will debug market show a stitched forensic view?');
    assert.equal(payload.data.summary.positions.count, 2);
    assert.equal(payload.data.summary.trades.count, 1);
    assert.equal(payload.data.summary.liquidityEvents.count, 1);
    assert.equal(payload.data.summary.claimEvents.count, 1);
  } finally {
    await indexer.close();
  }
});

test('debug market falls back when marketUsers token fields are unavailable', async () => {
  const marketAddress = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
  let rejectedLegacyFieldQuery = false;
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '5000000',
        currentTvl: '2000000',
        reserveYes: '600000',
        reserveNo: '400000',
        createdAt: '1700000000',
      },
    ],
    polls: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Will debug market tolerate schema drift?',
        status: 0,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhash-debug-market-compat',
      },
    ],
    positions: [
      {
        id: 'pos-compat-1',
        chainId: 1,
        marketAddress,
        user: ADDRESSES.wallet1,
        lastTradeAt: 1700000400,
        yesBalance: '750000',
        noBalance: '250000',
      },
    ],
    handleRequest: ({ query, variables, fixtures }) => {
      if (query.includes('marketUserss(') && query.includes('yesTokenAmount')) {
        rejectedLegacyFieldQuery = true;
        return {
          body: {
            errors: [{ message: 'Cannot query field "yesTokenAmount" on type "marketUsers".' }],
          },
        };
      }
      if (query.includes('marketUserss(')) {
        const items = applyListControls(applyWhereFilter(fixtures.positions, variables.where), variables);
        return { body: { data: { marketUserss: asPage(items) } } };
      }
      return null;
    },
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'debug',
      'market',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--market-address',
      marketAddress,
    ]);

    assert.equal(result.status, 0);
    assert.equal(rejectedLegacyFieldQuery, true);
    const payload = parseJsonOutput(result);
    assert.equal(payload.command, 'debug.market');
    assert.equal(payload.data.summary.positions.count, 1);
    assert.equal(payload.data.recent.positions[0].yesTokenAmount, '750000');
    assert.equal(payload.data.recent.positions[0].yesBalance, '750000');
    assert.equal(payload.data.recent.positions[0].noTokenAmount, '250000');
    assert.equal(payload.data.recent.positions[0].noBalance, '250000');
    assert.match(payload.data.diagnostics.join('\n'), /compatibility fallback/i);
  } finally {
    await indexer.close();
  }
});

test('debug tx correlates indexed trades and events for one transaction hash', async () => {
  const marketAddress = '0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed';
  const txHash = '0xdebug-tx-1';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '5000000',
        currentTvl: '2000000',
        reserveYes: '600000',
        reserveNo: '400000',
        createdAt: '1700000000',
      },
    ],
    polls: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Will debug tx correlate the indexed sections?',
        status: 0,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhash-debug-tx',
      },
    ],
    trades: [
      {
        id: 'trade-debug-tx-1',
        chainId: 1,
        marketAddress,
        pollAddress: marketAddress,
        trader: ADDRESSES.wallet1,
        side: 'yes',
        tradeType: 'buy',
        collateralAmount: '1000000',
        tokenAmount: '2000000',
        tokenAmountOut: '2000000',
        feeAmount: '10000',
        timestamp: 1700000600,
        txHash,
      },
    ],
    liquidityEvents: [
      {
        id: 'liq-debug-tx-1',
        chainId: 1,
        chainName: 'ethereum',
        provider: ADDRESSES.wallet1,
        marketAddress,
        pollAddress: marketAddress,
        eventType: 'addLiquidity',
        collateralAmount: '1000000',
        lpTokens: '250000',
        yesTokenAmount: '600000',
        noTokenAmount: '400000',
        yesTokensReturned: '0',
        noTokensReturned: '0',
        txHash,
        timestamp: 1700000200,
      },
    ],
    oracleFeeEvents: [
      {
        id: 'fee-debug-tx-1',
        chainId: 1,
        chainName: 'ethereum',
        oracleAddress: ADDRESSES.oracle,
        eventName: 'FeesWithdrawn',
        newFee: '200',
        to: ADDRESSES.wallet1,
        amount: '300000',
        txHash,
        blockNumber: 500,
        timestamp: 1700000700,
      },
    ],
    claimEvents: [
      {
        id: 'claim-debug-tx-1',
        campaignAddress: marketAddress,
        userAddress: ADDRESSES.wallet1,
        amount: '420000',
        signature: '0xsig-debug-tx',
        blockNumber: 501,
        timestamp: 1700000800,
        txHash,
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'debug',
      'tx',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--tx-hash',
      txHash,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.command, 'debug.tx');
    assert.equal(payload.data.txHash, txHash);
    assert.equal(payload.data.summary.trades, 1);
    assert.equal(payload.data.summary.liquidityEvents, 1);
    assert.equal(payload.data.summary.oracleFeeEvents, 1);
    assert.equal(payload.data.summary.claimEvents, 1);
    assert.equal(payload.data.relatedMarkets[0].id, marketAddress);
    assert.equal(payload.data.relatedPolls[0].question, 'Will debug tx correlate the indexed sections?');
  } finally {
    await indexer.close();
  }
});

test('positions list supports wallet filtering', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const listResult = await runCliAsync([
      '--output',
      'json',
      'positions',
      'list',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
    ]);

    assert.equal(listResult.timedOut, false);
    assert.equal(listResult.status, 0);
    const payload = parseJsonOutput(listResult);
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.items[0].user.toLowerCase(), ADDRESSES.wallet1.toLowerCase());
  } finally {
    await indexer.close();
  }
});

test('portfolio requires --wallet flag', () => {
  const result = runCli([
    '--output',
    'json',
    'portfolio',
    '--skip-dotenv',
    '--indexer-url',
    'http://127.0.0.1:1',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.match(payload.error.message, /--wallet/);
});

test('portfolio aggregates positions and event metrics for wallet', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'portfolio',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--chain-id',
      '1',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'portfolio');
    assert.equal(payload.data.wallet, ADDRESSES.wallet1.toLowerCase());
    assert.equal(payload.data.summary.positionCount, 1);
    assert.equal(payload.data.summary.uniqueMarkets, 1);
    assert.equal(payload.data.summary.liquidityAdded, 1000);
    assert.equal(payload.data.summary.claims, 42);
    assert.equal(payload.data.summary.cashflowNet, -958);
    assert.equal(payload.data.summary.pnlProxy, -958);
    assert.equal(payload.data.summary.totalDeposited, 1000);
    assert.equal(payload.data.summary.totalNetDelta, 1000);
    assert.equal(payload.data.summary.totalUnrealizedPnl, null);
    assert.equal(payload.data.summary.totalsPolicy.eventDerivedTotalsWhenEventsDisabled, null);
    assert.equal(payload.data.summary.totalsPolicy.eventDerivedTotalsDefaultWhenNoRows, 0);
    assert.equal(payload.data.summary.totalsPolicy.unrealizedRequiresLp, true);
    assert.equal(payload.data.summary.eventsIncluded, true);
    assert.equal(Array.isArray(payload.data.positions), true);
    assert.equal(Array.isArray(payload.data.events.liquidity), true);
    assert.equal(Array.isArray(payload.data.events.claims), true);
  } finally {
    await indexer.close();
  }
});

test('portfolio enriches positions with question, odds, liquidity, and mark value fields', async () => {
  const marketAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '12345',
        currentTvl: '4567',
        yesChance: '0.625',
        reserveYes: '625',
        reserveNo: '375',
        createdAt: '1700000000',
      },
    ],
    polls: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Will deterministic tests pass?',
        status: 1,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpoll1',
      },
    ],
    positions: [
      {
        id: 'pos-1',
        chainId: 1,
        marketAddress,
        user: ADDRESSES.wallet1,
        lastTradeAt: 1700000400,
        yesTokenAmount: '15',
        noTokenAmount: '5',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'portfolio',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--chain-id',
      '1',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'portfolio');
    assert.equal(
      Object.prototype.hasOwnProperty.call(payload.data.summary, 'totalPositionMarkValueUsdc'),
      true,
    );
    assert.equal(payload.data.positions.length, 1);
    assert.equal(payload.data.positions[0].question, 'Will deterministic tests pass?');
    assert.equal(payload.data.positions[0].positionSide, 'both');
    assert.equal(payload.data.positions[0].odds.yesPct, 37.5);
    assert.equal(payload.data.positions[0].liquidity.reserveYes, 625);
  } finally {
    await indexer.close();
  }
});

test('portfolio suppresses stale zero-balance rows after trade reconciliation', async () => {
  const marketAddress = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '5000',
        currentTvl: '1000',
        reserveYes: '600',
        reserveNo: '400',
        createdAt: '1700000000',
      },
    ],
    polls: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Will the stale position be suppressed?',
        status: 0,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpollstale',
      },
    ],
    positions: [
      {
        id: 'pos-stale-1',
        chainId: 1,
        marketAddress,
        user: ADDRESSES.wallet1,
        lastTradeAt: 1700000400,
        noTokenAmount: '336',
      },
    ],
    trades: [
      {
        id: 'trade-stale-buy',
        chainId: 1,
        marketAddress,
        trader: ADDRESSES.wallet1,
        side: 'no',
        tradeType: 'buy',
        tokenAmountOut: '336',
        timestamp: 1700000100,
      },
      {
        id: 'trade-stale-sell',
        chainId: 1,
        marketAddress,
        trader: ADDRESSES.wallet1,
        side: 'no',
        tradeType: 'sell',
        tokenAmount: '336',
        timestamp: 1700000200,
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'portfolio',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--chain-id',
      '1',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.data.summary.positionCount, 0);
    assert.equal(payload.data.positions.length, 0);
    assert.equal(payload.data.summary.totalPositionMarkValueUsdc, 0);
    assert.match(payload.data.diagnostics.positions.join(' '), /Suppressed 1 zero-balance portfolio position row/i);
  } finally {
    await indexer.close();
  }
});

test('portfolio suppresses stale reconstructed balances when the indexer already reports zero', async () => {
  const marketAddress = '0xbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbc';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'amm',
        marketCloseTimestamp: '1710000000',
        totalVolume: '5000',
        currentTvl: '1000',
        reserveYes: '600',
        reserveNo: '400',
        createdAt: '1700000000',
      },
    ],
    polls: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Will the indexed zero balance beat stale trade reconstruction?',
        status: 0,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpollzero',
      },
    ],
    positions: [
      {
        id: 'pos-zero-1',
        chainId: 1,
        marketAddress,
        user: ADDRESSES.wallet1,
        lastTradeAt: 1700000400,
        noTokenAmount: '0',
      },
    ],
    trades: [
      {
        id: 'trade-zero-buy',
        chainId: 1,
        marketAddress,
        trader: ADDRESSES.wallet1,
        side: 'no',
        tradeType: 'buy',
        tokenAmountOut: '336',
        timestamp: 1700000100,
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'portfolio',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--chain-id',
      '1',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.data.summary.positionCount, 0);
    assert.equal(payload.data.positions.length, 0);
    assert.equal(payload.data.summary.totalPositionMarkValueUsdc, 0);
    assert.match(payload.data.diagnostics.positions.join(' '), /Suppressed 1 zero-balance portfolio position row/i);
  } finally {
    await indexer.close();
  }
});

test('portfolio normalizes pari-mutuel micro-unit balances before computing mark value', async () => {
  const marketAddress = '0xcccccccccccccccccccccccccccccccccccccccc';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'pari',
        marketCloseTimestamp: '1710000000',
        totalVolume: '1000',
        currentTvl: '1000',
        reserveYes: '2',
        reserveNo: '998',
        createdAt: '1700000000',
      },
    ],
    polls: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Will the pari portfolio mark value stay human scaled?',
        status: 1,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpollpari',
      },
    ],
    positions: [
      {
        id: 'pos-pari-1',
        chainId: 1,
        marketAddress,
        user: ADDRESSES.wallet1,
        lastTradeAt: 1700000400,
        yesTokenAmount: '998775',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'portfolio',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--chain-id',
      '1',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.data.positions.length, 1);
    assert.equal(payload.data.positions[0].marketType, 'pari');
    assert.equal(payload.data.positions[0].yesBalance, 0.998775);
    assert.equal(payload.data.positions[0].markValueUsdc, 499.3875);
    assert.equal(payload.data.summary.totalPositionMarkValueUsdc, 499.3875);
  } finally {
    await indexer.close();
  }
});

test('portfolio normalizes raw parimutuel position balances before computing mark value', async () => {
  const marketAddress = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'pari',
        marketCloseTimestamp: '1710000000',
        totalVolume: '1000000',
        currentTvl: '1',
        yesChance: '0.998775',
        reserveYes: '1000000',
        reserveNo: '1225',
        createdAt: '1700000000',
      },
    ],
    polls: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        creator: ADDRESSES.wallet1,
        question: 'Will the CLARITY Act pass?',
        status: 1,
        category: 3,
        deadlineEpoch: 1710000000,
        createdAt: 1700000000,
        createdTxHash: '0xhashpoll-pari-1',
      },
    ],
    positions: [
      {
        id: 'pos-pari-1',
        chainId: 1,
        marketAddress,
        user: ADDRESSES.wallet1,
        lastTradeAt: 1700000400,
        yesTokenAmount: '1000000.000000',
        noTokenAmount: '0',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'portfolio',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--chain-id',
      '1',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'portfolio');
    assert.equal(payload.data.positions.length, 1);
    assert.equal(payload.data.positions[0].yesBalance, 1);
    assert.equal(payload.data.positions[0].markValueUsdc, 1.001225);
    assert.equal(payload.data.summary.totalPositionMarkValueUsdc, 1.001225);
  } finally {
    await indexer.close();
  }
});

test('portfolio computes pari-mutuel mark value when indexer uses full parimutuel spelling', async () => {
  const marketAddress = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const indexer = await startIndexerMockServer({
    markets: [
      {
        id: marketAddress,
        chainId: 1,
        chainName: 'ethereum',
        pollAddress: marketAddress,
        creator: ADDRESSES.wallet1,
        marketType: 'parimutuel',
        marketCloseTimestamp: '1710000000',
        totalVolume: '1000',
        currentTvl: '1000',
        reserveYes: '2',
        reserveNo: '998',
        createdAt: '1700000000',
      },
    ],
    positions: [
      {
        id: 'pos-pari-spelling-1',
        chainId: 1,
        marketAddress,
        user: ADDRESSES.wallet1,
        lastTradeAt: 1700000400,
        yesTokenAmount: '998775',
      },
    ],
  });

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'portfolio',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--chain-id',
      '1',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.positions.length, 1);
    assert.equal(payload.data.positions[0].marketType, 'parimutuel');
    assert.equal(payload.data.positions[0].yesBalance, 0.998775);
    assert.equal(payload.data.positions[0].markValueUsdc, 499.3875);
    assert.equal(payload.data.summary.totalPositionMarkValueUsdc, 499.3875);
  } finally {
    await indexer.close();
  }
});

test('portfolio --no-events skips event aggregation', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'portfolio',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--no-events',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.summary.eventsIncluded, false);
    assert.equal(payload.data.summary.liquidityAdded, 0);
    assert.equal(payload.data.summary.claims, 0);
    assert.equal(payload.data.summary.cashflowNet, 0);
    assert.equal(payload.data.summary.pnlProxy, 0);
    assert.equal(payload.data.summary.totalDeposited, null);
    assert.equal(payload.data.summary.totalNetDelta, null);
    assert.equal(payload.data.summary.totalUnrealizedPnl, null);
    assert.equal(payload.data.events.liquidity.length, 0);
    assert.equal(payload.data.events.claims.length, 0);
  } finally {
    await indexer.close();
  }
});

test('watch requires wallet and/or market target', () => {
  const result = runCli([
    '--output',
    'json',
    'watch',
    '--skip-dotenv',
    '--iterations',
    '1',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.match(payload.error.message, /--wallet and\/or --market-address/);
});

test('watch validates alert target requirements', () => {
  const missingMarket = runCli([
    '--output',
    'json',
    'watch',
    '--skip-dotenv',
    '--wallet',
    ADDRESSES.wallet1,
    '--alert-yes-above',
    '50',
  ]);

  assert.equal(missingMarket.status, 1);
  const missingMarketPayload = parseJsonOutput(missingMarket);
  assert.equal(missingMarketPayload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.match(missingMarketPayload.error.message, /require --market-address/i);

  const missingWallet = runCli([
    '--output',
    'json',
    'watch',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--alert-net-liquidity-above',
    '1',
  ]);

  assert.equal(missingWallet.status, 1);
  const missingWalletPayload = parseJsonOutput(missingWallet);
  assert.equal(missingWalletPayload.error.code, 'MISSING_REQUIRED_FLAG');
  assert.match(missingWalletPayload.error.message, /require --wallet/i);
});

test('watch supports deterministic multi-iteration market snapshots', async () => {
  const result = await runCliAsync([
    '--output',
    'json',
    'watch',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '5',
    '--yes-pct',
    '55',
    '--iterations',
    '2',
    '--interval-ms',
    '1',
  ], { timeoutMs: 30_000 });

  assert.equal(result.timedOut, false);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'watch');
  assert.equal(payload.data.count, 2);
  assert.equal(payload.data.iterationsRequested, 2);
  assert.equal(Array.isArray(payload.data.snapshots), true);
  assert.equal(payload.data.snapshots.length, 2);
  for (const snap of payload.data.snapshots) {
    assert.equal(typeof snap.iteration, 'number');
    assertIsoTimestamp(snap.timestamp);
    assert.equal(snap.quote.quoteAvailable, true);
    assert.equal(snap.quote.odds.source, 'manual:yes-pct');
  }
});

test('watch emits YES-threshold alerts in JSON payload', async () => {
  const result = await runCliAsync([
    '--output',
    'json',
    'watch',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '5',
    '--yes-pct',
    '55',
    '--alert-yes-above',
    '50',
    '--iterations',
    '2',
    '--interval-ms',
    '1',
  ], { timeoutMs: 30_000 });

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'watch');
  assert.equal(payload.data.alertCount, 2);
  assert.equal(payload.data.alerts.length, 2);
  assert.equal(payload.data.alerts[0].code, 'YES_ABOVE_THRESHOLD');
});

test('watch --fail-on-alert exits non-zero when threshold triggers', async () => {
  const result = await runCliAsync([
    '--output',
    'json',
    'watch',
    '--skip-dotenv',
    '--market-address',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--side',
    'yes',
    '--amount-usdc',
    '5',
    '--yes-pct',
    '60',
    '--alert-yes-above',
    '50',
    '--fail-on-alert',
    '--iterations',
    '1',
    '--interval-ms',
    '1',
  ], { timeoutMs: 30_000 });

  assert.equal(result.status, 2);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'WATCH_ALERT_TRIGGERED');
  assert.equal(payload.error.details.alertCount, 1);
});

test('watch can monitor wallet portfolio summary', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'watch',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--iterations',
      '1',
      '--interval-ms',
      '1',
      '--no-events',
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'watch');
    assert.equal(payload.data.count, 1);
    assert.equal(payload.data.snapshots[0].portfolioSummary.positionCount, 1);
    assert.equal(payload.data.snapshots[0].portfolioSummary.eventsIncluded, false);
  } finally {
    await indexer.close();
  }
});

test('watch emits net-liquidity threshold alerts from wallet snapshots', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'watch',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--alert-net-liquidity-above',
      '900',
      '--iterations',
      '1',
      '--interval-ms',
      '1',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.alertCount, 1);
    assert.equal(payload.data.alerts[0].code, 'NET_LIQUIDITY_ABOVE_THRESHOLD');
  } finally {
    await indexer.close();
  }
});

test('positions list validates --order-by values client-side', () => {
  const result = runCli([
    '--output',
    'json',
    'positions',
    'list',
    '--skip-dotenv',
    '--indexer-url',
    'http://127.0.0.1:1',
    '--order-by',
    'createdAt',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /--order-by must be one of/);
  assert.match(payload.error.message, /lastTradeAt/);
});

test('events list validates address filters client-side', () => {
  const result = runCli([
    '--output',
    'json',
    'events',
    'list',
    '--skip-dotenv',
    '--indexer-url',
    'http://127.0.0.1:1',
    '--wallet',
    'invalid',
  ]);

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /--wallet must be a valid 20-byte hex address/);
});

test('history returns deterministic analytics payload', async () => {
  const indexer = await startIndexerMockServer();

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'history',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--limit',
      '10',
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'history');
    assert.equal(payload.data.schemaVersion, '1.0.0');
    assert.equal(payload.data.wallet, ADDRESSES.wallet1.toLowerCase());
    assert.equal(Array.isArray(payload.data.items), true);
    assert.equal(payload.data.items.length, 2);
    assert.equal(typeof payload.data.summary.tradeCount, 'number');
  } finally {
    await indexer.close();
  }
});

test('export can materialize CSV to --out path', async () => {
  const indexer = await startIndexerMockServer();
  const tempDir = createTempDir('pandora-export-');
  const outPath = path.join(tempDir, 'history.csv');

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'export',
      '--skip-dotenv',
      '--indexer-url',
      indexer.url,
      '--wallet',
      ADDRESSES.wallet1,
      '--format',
      'csv',
      '--out',
      outPath,
    ]);

    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'export');
    assert.equal(payload.data.schemaVersion, '1.1.0');
    assert.equal(payload.data.format, 'csv');
    assert.equal(payload.data.outPath, outPath);
    assert.equal(fs.existsSync(outPath), true);
    const csv = fs.readFileSync(outPath, 'utf8');
    assert.match(csv, /timestamp,chain_id,wallet/);
    assert.match(csv, /,date,market,action,amount,price,gas_usd,realized_pnl/);
    assert.match(csv, /0xtrade1/);
    assert.equal(Array.isArray(payload.data.rows), true);
    assert.equal(payload.data.rows.length > 0, true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'date'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'market'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'action'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'amount'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'price'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'gas_usd'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'realized_pnl'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.data.rows[0], 'tx_hash'), true);
  } finally {
    await indexer.close();
    removeDir(tempDir);
  }
});

