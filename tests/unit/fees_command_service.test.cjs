const test = require('node:test');
const assert = require('node:assert/strict');

const { runMarketFeesWithdraw } = require('../../cli/lib/fees_command_service.cjs');

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
  const publicClient = createReadOnlyClient({
    simulateContract: async ({ account, functionName }) => {
      assert.equal(account, ADDRESSES.signer.toLowerCase());
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
      account: { address: ADDRESSES.signer.toLowerCase() },
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
