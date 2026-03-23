const test = require('node:test');
const assert = require('node:assert/strict');

const { runBatchFeesWithdraw, runMarketFeesWithdraw } = require('../../cli/lib/fees_command_service.cjs');

const ADDRESSES = {
  market: '0x1111111111111111111111111111111111111111',
  factory: '0x2222222222222222222222222222222222222222',
  collateral: '0x3333333333333333333333333333333333333333',
  creator: '0x4444444444444444444444444444444444444444',
  treasury: '0x5555555555555555555555555555555555555555',
  signer: '0x6666666666666666666666666666666666666666',
};

function createReadOnlyClient(overrides = {}) {
  return {
    readContract: async ({ address, functionName }) => {
      const target = String(address).toLowerCase();
      if (target === ADDRESSES.market.toLowerCase() && functionName === 'protocolFeesCollected') return 106_000_001n;
      if (target === ADDRESSES.market.toLowerCase() && functionName === 'collateralToken') return ADDRESSES.collateral;
      if (target === ADDRESSES.market.toLowerCase() && functionName === 'creator') return ADDRESSES.creator;
      if (target === ADDRESSES.market.toLowerCase() && functionName === 'factory') return ADDRESSES.factory;
      if (target === ADDRESSES.factory.toLowerCase() && functionName === 'platformTreasury') return ADDRESSES.treasury;
      if (target === ADDRESSES.collateral.toLowerCase() && functionName === 'decimals') return 6;
      if (target === ADDRESSES.collateral.toLowerCase() && functionName === 'symbol') return 'USDC';
      throw new Error(`Unexpected readContract ${target} ${functionName}`);
    },
    ...overrides,
  };
}

function createMultiMarketReadClient(markets, overrides = {}) {
  const marketMap = new Map(
    Object.entries(markets || {}).map(([marketAddress, config]) => [
      String(marketAddress).toLowerCase(),
      {
        factory: String(config.factory || ADDRESSES.factory).toLowerCase(),
        collateral: String(config.collateral || ADDRESSES.collateral).toLowerCase(),
        creator: String(config.creator || ADDRESSES.creator).toLowerCase(),
        treasury: String(config.treasury || ADDRESSES.treasury).toLowerCase(),
        protocolFeesCollected: BigInt(config.protocolFeesCollected || 0n),
        decimals: config.decimals === undefined ? 6 : Number(config.decimals),
        symbol: String(config.symbol || 'USDC'),
      },
    ]),
  );

  return {
    readContract: async ({ address, functionName }) => {
      const target = String(address).toLowerCase();
      const market = marketMap.get(target);
      if (market) {
        if (functionName === 'protocolFeesCollected') return market.protocolFeesCollected;
        if (functionName === 'collateralToken') return market.collateral;
        if (functionName === 'creator') return market.creator;
        if (functionName === 'factory') return market.factory;
      }
      for (const config of marketMap.values()) {
        if (target === config.factory && functionName === 'platformTreasury') return config.treasury;
        if (target === config.collateral && functionName === 'decimals') return config.decimals;
        if (target === config.collateral && functionName === 'symbol') return config.symbol;
      }
      throw new Error(`Unexpected readContract ${target} ${functionName}`);
    },
    ...overrides,
  };
}

test('runMarketFeesWithdraw dry-run previews market protocol fee split without signer simulation', async () => {
  const payload = await runMarketFeesWithdraw(
    {
      marketAddress: ADDRESSES.market,
      dryRun: true,
      chainId: 1,
      rpcUrl: 'https://ethereum.example',
    },
    {
      publicClient: createReadOnlyClient(),
      viemRuntime: {},
    },
  );

  assert.equal(payload.mode, 'dry-run');
  assert.equal(payload.status, 'planned');
  assert.equal(payload.marketAddress, ADDRESSES.market.toLowerCase());
  assert.equal(payload.contract.platformTreasury, ADDRESSES.treasury.toLowerCase());
  assert.equal(payload.feeState.withdrawableRaw, '106000001');
  assert.equal(payload.feeState.withdrawable, '106.000001');
  assert.equal(payload.feeState.platformShare, '53');
  assert.equal(payload.feeState.creatorShare, '53.000001');
  assert.equal(payload.preflight.executeSupported, true);
  assert.equal(payload.preflight.simulationAttempted, false);
  assert.match(payload.diagnostics[0], /signer-backed simulation/i);
});

test('runMarketFeesWithdraw execute submits tx and records decoded withdrawal shares', async () => {
  let writeRequest = null;
  const signerAccount = { address: ADDRESSES.signer.toLowerCase() };
  const publicClient = createReadOnlyClient({
    simulateContract: async ({ account, functionName }) => {
      assert.equal(account, signerAccount);
      assert.equal(functionName, 'withdrawProtocolFees');
      return {
        request: {
          account,
          address: ADDRESSES.market,
          functionName,
          gas: 123_456n,
        },
      };
    },
    waitForTransactionReceipt: async ({ hash }) => {
      assert.equal(hash, '0xtx-fees-withdraw');
      return {
        status: 'success',
        blockNumber: 987n,
        logs: [{ data: '0x', topics: [] }],
      };
    },
  });
  const walletClient = {
    writeContract: async (request) => {
      writeRequest = request;
      return '0xtx-fees-withdraw';
    },
  };

  const payload = await runMarketFeesWithdraw(
    {
      marketAddress: ADDRESSES.market,
      execute: true,
      chainId: 1,
      rpcUrl: 'https://ethereum.example',
    },
    {
      publicClient,
      walletClient,
      account: signerAccount,
      viemRuntime: {
        decodeEventLog: () => ({
          eventName: 'ProtocolFeesWithdrawn',
          args: {
            caller: ADDRESSES.signer.toLowerCase(),
            platformShare: 53_000_000n,
            creatorShare: 53_000_001n,
          },
        }),
      },
    },
  );

  assert.equal(writeRequest.functionName, 'withdrawProtocolFees');
  assert.equal(writeRequest.account, signerAccount);
  assert.equal(writeRequest.gas, 123_456n);
  assert.equal(payload.mode, 'execute');
  assert.equal(payload.status, 'submitted');
  assert.equal(payload.tx.txHash, '0xtx-fees-withdraw');
  assert.equal(payload.tx.blockNumber, '987');
  assert.equal(payload.tx.withdrawal.caller, ADDRESSES.signer.toLowerCase());
  assert.equal(payload.tx.withdrawal.platformShare, '53');
  assert.equal(payload.tx.withdrawal.creatorShare, '53.000001');
  assert.equal(payload.preflight.simulationAttempted, true);
  assert.equal(payload.preflight.simulationOk, true);
  assert.equal(payload.preflight.gasEstimate, '123456');
});

test('runBatchFeesWithdraw dry-run discovers creator markets and summarizes withdrawable totals', async () => {
  const creator = ADDRESSES.creator.toLowerCase();
  const marketA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const marketB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const publicClient = createMultiMarketReadClient({
    [marketA]: {
      creator,
      protocolFeesCollected: 106_000_001n,
      treasury: ADDRESSES.treasury,
    },
    [marketB]: {
      creator,
      protocolFeesCollected: 25_500_000n,
      treasury: ADDRESSES.treasury,
    },
  });
  const indexerClient = {
    list: async () => ({
      items: [
        { id: marketA, creator, chainId: 1, pollAddress: '0x1234567890123456789012345678901234567890' },
        { id: marketB, creator, chainId: 1, pollAddress: '0x2234567890123456789012345678901234567890' },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    }),
  };

  const payload = await runBatchFeesWithdraw(
    {
      allMarkets: true,
      creator,
      dryRun: true,
      chainId: 1,
      rpcUrl: 'https://ethereum.example',
      indexerUrl: 'https://indexer.example',
    },
    {
      publicClient,
      indexerClient,
      viemRuntime: {},
    },
  );

  assert.equal(payload.action, 'withdraw-all-markets');
  assert.equal(payload.mode, 'dry-run');
  assert.equal(payload.status, 'planned');
  assert.equal(payload.creator, creator);
  assert.equal(payload.summary.marketCount, 2);
  assert.equal(payload.summary.successCount, 2);
  assert.equal(payload.summary.failureCount, 0);
  assert.equal(payload.summary.withdrawableRawTotal, '131500001');
  assert.equal(payload.summary.withdrawableTotal, '131.500001');
  assert.equal(payload.summary.platformShareTotal, '65.75');
  assert.equal(payload.summary.creatorShareTotal, '65.750001');
  assert.equal(payload.items[0].marketAddress, marketA);
  assert.equal(payload.items[1].marketAddress, marketB);
});

test('runBatchFeesWithdraw execute reuses the local signer across all discovered markets', async () => {
  const creator = ADDRESSES.creator.toLowerCase();
  const signerAccount = { address: ADDRESSES.signer.toLowerCase() };
  const marketA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const marketB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const submittedRequests = [];
  let nextTxIndex = 0;
  const publicClient = createMultiMarketReadClient(
    {
      [marketA]: {
        creator,
        protocolFeesCollected: 106_000_001n,
        treasury: ADDRESSES.treasury,
      },
      [marketB]: {
        creator,
        protocolFeesCollected: 25_500_000n,
        treasury: ADDRESSES.treasury,
      },
    },
    {
      simulateContract: async ({ address, account, functionName }) => {
        assert.equal(account, signerAccount);
        assert.equal(functionName, 'withdrawProtocolFees');
        return {
          request: {
            account,
            address: String(address).toLowerCase(),
            functionName,
            gas: 150_000n,
          },
        };
      },
      waitForTransactionReceipt: async ({ hash }) => ({
        status: 'success',
        blockNumber: BigInt(1_000 + Number(String(hash).slice(-1) || 0)),
        logs: [{ data: '0x', topics: [] }],
      }),
    },
  );
  const walletClient = {
    writeContract: async (request) => {
      submittedRequests.push(request);
      nextTxIndex += 1;
      return `0xtx-fees-withdraw-${nextTxIndex}`;
    },
  };
  const indexerClient = {
    list: async () => ({
      items: [
        { id: marketA, creator, chainId: 1, pollAddress: '0x1234567890123456789012345678901234567890' },
        { id: marketB, creator, chainId: 1, pollAddress: '0x2234567890123456789012345678901234567890' },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    }),
  };

  const payload = await runBatchFeesWithdraw(
    {
      allMarkets: true,
      creator,
      execute: true,
      chainId: 1,
      rpcUrl: 'https://ethereum.example',
      indexerUrl: 'https://indexer.example',
    },
    {
      publicClient,
      walletClient,
      account: signerAccount,
      indexerClient,
      viemRuntime: {
        decodeEventLog: () => ({
          eventName: 'ProtocolFeesWithdrawn',
          args: {
            caller: signerAccount.address,
            platformShare: 1n,
            creatorShare: 1n,
          },
        }),
      },
    },
  );

  assert.equal(payload.action, 'withdraw-all-markets');
  assert.equal(payload.mode, 'execute');
  assert.equal(payload.status, 'submitted');
  assert.equal(payload.summary.marketCount, 2);
  assert.equal(payload.summary.successCount, 2);
  assert.equal(payload.summary.failureCount, 0);
  assert.equal(submittedRequests.length, 2);
  assert.deepEqual(
    submittedRequests.map((request) => request.account),
    [signerAccount, signerAccount],
  );
  assert.deepEqual(
    payload.items.map((item) => item.result.status),
    ['submitted', 'submitted'],
  );
});

test('runBatchFeesWithdraw requires an explicit creator selector for all-markets', async () => {
  await assert.rejects(
    () => runBatchFeesWithdraw(
      {
        allMarkets: true,
        dryRun: true,
        chainId: 1,
        rpcUrl: 'https://ethereum.example',
        indexerUrl: 'https://indexer.example',
      },
      {
        publicClient: createReadOnlyClient(),
        viemRuntime: {},
      },
    ),
    (error) => {
      assert.equal(error && error.code, 'MISSING_REQUIRED_FLAG');
      assert.match(String(error && error.message), /requires --creator <address>/i);
      return true;
    },
  );
});
