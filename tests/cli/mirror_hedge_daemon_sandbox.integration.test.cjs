const shared = require('./cli.integration.shared.cjs');

const {
  test,
  assert,
  path,
  createTempDir,
  removeDir,
  runCli,
  runCliAsync,
  writeFile,
  parseJsonOutput,
  delay,
  isPidAlive,
  ADDRESSES,
  buildMirrorIndexerOverrides,
  buildMirrorPolymarketOverrides,
  startIndexerMockServer,
  startPolymarketMockServer,
  assertIsoTimestamp,
} = shared;

async function waitForHedgeReaction(tempDir, strategyHash, tradeId, timeoutMs = 12_000) {
  const startedAt = Date.now();
  let lastPayload = null;
  while (Date.now() - startedAt < timeoutMs) {
    const result = runCli(
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

    assert.equal(result.status, 0, result.output || '(no cli output)');
    const payload = parseJsonOutput(result);
    lastPayload = payload;
    const data = payload.data || {};
    if (
      data.lastObservedTrade
      && data.lastObservedTrade.tradeId === tradeId
      && data.lastHedgeSignal
      && data.lastHedgeSignal.tradeId === tradeId
    ) {
      return payload;
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for hedge reaction.\nLast payload:\n${JSON.stringify(lastPayload, null, 2)}`);
}

test('proving-ground daemon gate records trade timing and hedge signal through the CLI surface', async () => {
  const tempDir = createTempDir('pandora-hedge-daemon-sandbox-');
  const stateFile = path.join(tempDir, 'hedge-state.json');
  const walletFile = path.join(tempDir, 'internal-wallets.txt');
  const trades = [];
  const indexer = await startIndexerMockServer({
    ...buildMirrorIndexerOverrides(),
    trades,
  });
  const polymarket = await startPolymarketMockServer(buildMirrorPolymarketOverrides());
  let strategyHash = null;
  let daemonPid = null;

  try {
    writeFile(walletFile, `${ADDRESSES.wallet1}\n`);

    const deployResult = await runCliAsync([
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

    assert.equal(deployResult.status, 0, deployResult.output || '(no cli output)');
    const deployPayload = parseJsonOutput(deployResult);
    assert.equal(deployPayload.command, 'mirror.deploy');
    assert.equal(deployPayload.data.dryRun, true);

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
        '--min-hedge-usdc',
        '1',
        '--interval-ms',
        '200',
        '--iterations',
        '80',
        '--state-file',
        stateFile,
      ],
      { env: { HOME: tempDir } },
    );

    assert.equal(startResult.status, 0, startResult.output || '(no cli output)');
    const startPayload = parseJsonOutput(startResult);
    assert.equal(startPayload.command, 'mirror.hedge.start');
    strategyHash = startPayload.data.strategyHash;
    daemonPid = startPayload.data.daemon && startPayload.data.daemon.pid;
    assert.equal(typeof strategyHash, 'string');
    assert.equal(Boolean(daemonPid && isPidAlive(daemonPid)), true);

    await delay(250);

    const tradeTimestamp = Math.floor(Date.now() / 1000) - 1;
    const syntheticTrade = {
      id: 'trade-sandbox-1',
      chainId: 1,
      marketAddress: ADDRESSES.mirrorMarket,
      pollAddress: ADDRESSES.mirrorPoll,
      trader: '0x3333333333333333333333333333333333333333',
      side: 'yes',
      tradeType: 'buy',
      collateralAmount: '45000000',
      tokenAmount: '60000000',
      tokenAmountOut: '60000000',
      feeAmount: '900000',
      timestamp: tradeTimestamp,
      txHash: '0xsandboxtrade1',
    };
    trades.push(syntheticTrade);

    const statusPayload = await waitForHedgeReaction(tempDir, strategyHash, syntheticTrade.id);
    const data = statusPayload.data;

    assert.equal(statusPayload.command, 'mirror.hedge.status');
    assert.equal(data.runtime.status, 'running');
    assert.equal(data.summary.confirmedExposureCount >= 1, true);

    assert.equal(data.lastObservedTrade.tradeId, syntheticTrade.id);
    assert.equal(data.lastObservedTrade.hedgeEligible, true);
    assert.equal(data.lastObservedTrade.reason, 'external-trade');
    assert.equal(data.lastObservedTrade.orderSide, 'buy');
    assert.equal(data.lastObservedTrade.tokenSide, 'yes');
    assertIsoTimestamp(data.lastObservedTrade.confirmedAt);
    assertIsoTimestamp(data.lastObservedTrade.observedAt);
    assert.equal(Number.isFinite(Number(data.lastObservedTrade.observationLatencyMs)), true);
    assert.equal(Number(data.lastObservedTrade.observationLatencyMs) >= 0, true);

    assert.equal(data.lastHedgeSignal.tradeId, syntheticTrade.id);
    assert.equal(data.lastHedgeSignal.status, 'planned');
    assert.equal(data.lastHedgeSignal.orderSide, 'buy');
    assert.equal(data.lastHedgeSignal.tokenSide, 'yes');
    assertIsoTimestamp(data.lastHedgeSignal.signalAt);
    assert.equal(Number.isFinite(Number(data.lastHedgeSignal.reactionLatencyMs)), true);
    assert.equal(Number(data.lastHedgeSignal.reactionLatencyMs) >= 0, true);
    assert.equal(Number.isFinite(Number(data.lastHedgeSignal.observeToSignalLatencyMs)), true);
    assert.equal(Number(data.lastHedgeSignal.observeToSignalLatencyMs) >= 0, true);
    assert.equal(Number(data.lastHedgeSignal.amountUsdc) > 0, true);
    assert.equal(Number(data.lastHedgeSignal.amountShares) > 0, true);

    assert.equal(data.summary.lastObservedTradeId, syntheticTrade.id);
    assert.equal(data.summary.lastHedgeSignalStatus, 'planned');
    assert.equal(Number.isFinite(Number(data.summary.lastTradeObservationLatencyMs)), true);
    assert.equal(Number.isFinite(Number(data.summary.lastHedgeReactionLatencyMs)), true);
  } finally {
    if (strategyHash) {
      runCli(
        ['--output', 'json', 'mirror', 'hedge', 'stop', '--strategy-hash', strategyHash],
        { env: { HOME: tempDir } },
      );
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
