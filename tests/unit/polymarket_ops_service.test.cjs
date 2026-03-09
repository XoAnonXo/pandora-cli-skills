const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runPolymarketBalance,
  runPolymarketDeposit,
  runPolymarketWithdraw,
} = require('../../cli/lib/polymarket_ops_service.cjs');

function parseUnits(value, decimals) {
  const text = String(value);
  const negative = text.startsWith('-');
  const normalized = negative ? text.slice(1) : text;
  const [wholePart, fractionPart = ''] = normalized.split('.');
  const fraction = `${fractionPart}${'0'.repeat(decimals)}`.slice(0, decimals);
  const raw = BigInt(`${wholePart || '0'}${fraction || ''}`);
  return negative ? -raw : raw;
}

function createViemRuntime(signerAddress) {
  return {
    parseUnits,
    privateKeyToAccount: () => ({ address: signerAddress }),
  };
}

test('runPolymarketBalance returns requested wallet balances without signer/funder noise', async () => {
  const wallet = '0x1111111111111111111111111111111111111111';
  const calls = [];
  const payload = await runPolymarketBalance(
    {
      wallet,
      rpcUrl: 'https://polygon.example',
    },
    {
      publicClient: {
        readContract: async (params) => {
          calls.push(params);
          return 123_450_000n;
        },
      },
    },
  );

  assert.equal(payload.action, 'balance');
  assert.equal(payload.status, 'ready');
  assert.equal(payload.requestedWallet, wallet);
  assert.equal(payload.runtime.rpcUrl, 'https://polygon.example');
  assert.equal(payload.balances.wallet.address, wallet);
  assert.equal(payload.balances.wallet.formatted, '123.45');
  assert.deepEqual(payload.diagnostics, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].functionName, 'balanceOf');
  assert.deepEqual(calls[0].args, [wallet]);
});

test('runPolymarketDeposit dry-run previews signer-to-proxy funding with projected balances', async () => {
  const signerAddress = '0x2222222222222222222222222222222222222222';
  const funderAddress = '0x3333333333333333333333333333333333333333';
  const balanceByAddress = {
    [signerAddress.toLowerCase()]: 500_000_000n,
    [funderAddress.toLowerCase()]: 100_000_000n,
  };

  const payload = await runPolymarketDeposit(
    {
      amountUsdc: 250,
      rpcUrl: 'https://polygon.example',
      env: {
        POLYMARKET_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
        POLYMARKET_FUNDER: funderAddress,
      },
    },
    {
      viemRuntime: createViemRuntime(signerAddress),
      publicClient: {
        readContract: async ({ args }) => balanceByAddress[String(args[0]).toLowerCase()],
        simulateContract: async () => ({
          request: {
            gas: 123456n,
          },
        }),
      },
    },
  );

  assert.equal(payload.action, 'deposit');
  assert.equal(payload.mode, 'dry-run');
  assert.equal(payload.status, 'planned');
  assert.equal(payload.fromAddress, signerAddress.toLowerCase());
  assert.equal(payload.toAddress, funderAddress.toLowerCase());
  assert.equal(payload.amountRaw, '250000000');
  assert.equal(payload.preflight.sourceBalanceSufficient, true);
  assert.equal(payload.preflight.sourceBalanceAfter, '250');
  assert.equal(payload.preflight.destinationBalanceAfter, '350');
  assert.equal(payload.preflight.simulationAttempted, true);
  assert.equal(payload.preflight.simulationOk, true);
  assert.equal(payload.preflight.transferGasEstimate, '123456');
  assert.equal(payload.preflight.executeSupported, true);
  assert.deepEqual(payload.diagnostics, []);
});

test('runPolymarketWithdraw execute fails closed when the proxy differs from the signer', async () => {
  const signerAddress = '0x4444444444444444444444444444444444444444';
  const funderAddress = '0x5555555555555555555555555555555555555555';
  const targetAddress = '0x6666666666666666666666666666666666666666';
  const balances = {
    [funderAddress.toLowerCase()]: 700_000_000n,
    [targetAddress.toLowerCase()]: 10_000_000n,
  };

  await assert.rejects(
    () =>
      runPolymarketWithdraw(
        {
          amountUsdc: 25,
          execute: true,
          to: targetAddress,
          rpcUrl: 'https://polygon.example',
          env: {
            POLYMARKET_PRIVATE_KEY: `0x${'2'.repeat(64)}`,
            POLYMARKET_FUNDER: funderAddress,
          },
        },
        {
          viemRuntime: createViemRuntime(signerAddress),
          publicClient: {
            readContract: async ({ args }) => balances[String(args[0]).toLowerCase()] || 0n,
            simulateContract: async () => ({
              request: {
                gas: 654321n,
              },
            }),
          },
        },
      ),
    (error) => {
      assert.equal(error.code, 'POLYMARKET_PROXY_TRANSFER_REQUIRES_MANUAL_EXECUTION');
      assert.match(error.message, /proxy\/funder wallet/i);
      assert.equal(error.details.fromAddress, funderAddress.toLowerCase());
      assert.equal(error.details.signerAddress, signerAddress.toLowerCase());
      return true;
    },
  );
});
