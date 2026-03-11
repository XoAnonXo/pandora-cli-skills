const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  runPolymarketBalance,
  runPolymarketPositions,
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
  assert.deepEqual(Object.keys(payload.balances), ['wallet']);
  assert.equal(payload.balances.wallet.address, wallet);
  assert.equal(payload.balances.wallet.formatted, '123.45');
  assert.equal(payload.balanceScope.surface, 'polygon-usdc-wallet-collateral-only');
  assert.equal(payload.balanceScope.uiBalanceParityExpected, false);
  assert.deepEqual(payload.balanceScope.readTargets, [{ role: 'wallet', address: wallet }]);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'yesBalance'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'noBalance'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'openOrdersCount'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'estimatedValueUsd'), false);
  assert.equal(payload.diagnostics.some((entry) => /Funding-only surface/i.test(entry)), true);
  assert.equal(payload.diagnostics.some((entry) => entry.includes(`Requested wallet ${wallet}`)), true);
  assert.equal(payload.diagnostics.some((entry) => entry.includes('merge-readiness diagnostics')), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].functionName, 'balanceOf');
  assert.deepEqual(calls[0].args, [wallet]);
});

test('runPolymarketBalance explains zero wallet collateral as a scope mismatch risk when proxy accounting may differ', async () => {
  const signerAddress = '0x1212121212121212121212121212121212121212';
  const funderAddress = '0x3434343434343434343434343434343434343434';
  const payload = await runPolymarketBalance(
    {
      rpcUrl: 'https://polygon.example',
      env: {
        POLYMARKET_PRIVATE_KEY: `0x${'3'.repeat(64)}`,
        POLYMARKET_FUNDER: funderAddress,
      },
    },
    {
      viemRuntime: createViemRuntime(signerAddress),
      publicClient: {
        readContract: async () => 0n,
      },
    },
  );

  assert.equal(payload.runtime.ownerAddress, funderAddress.toLowerCase());
  assert.equal(payload.balanceScope.ownerAddress, funderAddress.toLowerCase());
  assert.equal(payload.balanceScope.signerAddress, signerAddress.toLowerCase());
  assert.equal(payload.balanceScope.funderAddress, funderAddress.toLowerCase());
  assert.equal(payload.diagnostics.some((entry) => /zero Polygon USDC\.e wallet balance/i.test(entry)), true);
  assert.equal(payload.diagnostics.some((entry) => /scope mismatch/i.test(entry) || /proxy\/CLOB accounting state/i.test(entry)), true);
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

test('runPolymarketPositions returns on-chain CTF balances with inventory provenance', async () => {
  const wallet = '0x7777777777777777777777777777777777777777';
  const conditionId = `0x${'a'.repeat(64)}`;
  const payload = await runPolymarketPositions(
    {
      wallet,
      source: 'on-chain',
      market: {
        marketId: conditionId,
        slug: 'btc-above-100k',
        question: 'Will BTC close above $100k?',
        yesTokenId: '101',
        noTokenId: '102',
        yesPct: 62,
        noPct: 38,
      },
      rpcUrl: 'https://polygon.example',
    },
    {
      publicClient: {
        readContract: async ({ args }) => {
          const tokenId = String(args[1]);
          if (tokenId === '101') return 2_500_000n;
          if (tokenId === '102') return 750_000n;
          return 0n;
        },
      },
    },
  );

  assert.equal(payload.action, 'positions');
  assert.equal(payload.status, 'ready');
  assert.equal(payload.sourceRequested, 'on-chain');
  assert.equal(payload.sourceResolved, 'on-chain');
  assert.equal(payload.market.marketId, conditionId);
  assert.equal(payload.market.yesTokenId, '101');
  assert.equal(payload.market.noTokenId, '102');
  assert.equal(payload.summary.yesBalance, 2.5);
  assert.equal(payload.summary.noBalance, 0.75);
  assert.equal(payload.summary.estimatedValueUsd, 1.835);
  assert.equal(payload.positions.length, 2);
  assert.deepEqual(
    payload.positions.map((item) => item.fieldSources.balance),
    ['on-chain', 'on-chain'],
  );
  assert.equal(payload.openOrders.length, 0);
  assert.equal(payload.mergeReadiness.status, 'ready');
  assert.equal(payload.mergeReadiness.inventoryReady, true);
  assert.equal(payload.mergeReadiness.executionWalletReady, true);
  assert.equal(payload.mergeReadiness.mergeablePairs, 0.75);
  assert.deepEqual(payload.mergeReadiness.blockingReasons, []);
  assert.equal(payload.mergeReadiness.operatorApprovalStatus, 'unknown');
});

test('runPolymarketPositions maps outcome-only API rows onto market token ids so on-chain zero balances win', async () => {
  const wallet = '0x8888888888888888888888888888888888888888';
  const conditionId = `0x${'b'.repeat(64)}`;
  const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      positions: [
        {
          conditionId,
          outcome: 'NO',
          size: 336,
          curPrice: 0.41,
          question: 'Will Mavericks beat Celtics?',
        },
      ],
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const mockUrl = `http://127.0.0.1:${address.port}`;

  try {
    const payload = await runPolymarketPositions(
      {
        wallet,
        source: 'auto',
        market: {
          marketId: conditionId,
          slug: 'mavericks-vs-celtics',
          question: 'Will Mavericks beat Celtics?',
          yesTokenId: '101',
          noTokenId: '102',
          yesPct: 59,
          noPct: 41,
        },
        polymarketMockUrl: mockUrl,
        rpcUrl: 'https://polygon.example',
      },
      {
        publicClient: {
          readContract: async () => 0n,
        },
      },
    );

    assert.equal(payload.summary.noBalance, 0);
    assert.equal(payload.positions.some((item) => item.balance === 336), false);
    assert.equal(payload.positions.some((item) => item.tokenId === '102' && item.balance === 0), true);
    assert.equal(payload.positions.filter((item) => item.tokenId === null).length, 0);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('runPolymarketPositions exposes merge blockers when inventory overlaps but signer/funder do not own the positions', async () => {
  const wallet = '0x9898989898989898989898989898989898989898';
  const signerAddress = '0x4545454545454545454545454545454545454545';
  const funderAddress = '0x5656565656565656565656565656565656565656';
  const conditionId = `0x${'c'.repeat(64)}`;
  const payload = await runPolymarketPositions(
    {
      wallet,
      source: 'on-chain',
      market: {
        marketId: conditionId,
        slug: 'man-city-vs-arsenal',
        question: 'Will Man City win?',
        yesTokenId: '201',
        noTokenId: '202',
        yesPct: 58,
        noPct: 42,
      },
      rpcUrl: 'https://polygon.example',
      env: {
        POLYMARKET_PRIVATE_KEY: `0x${'4'.repeat(64)}`,
        POLYMARKET_FUNDER: funderAddress,
      },
    },
    {
      viemRuntime: createViemRuntime(signerAddress),
      publicClient: {
        readContract: async ({ args }) => {
          const tokenId = String(args[1]);
          if (tokenId === '201') return 4_000_000n;
          if (tokenId === '202') return 1_500_000n;
          return 0n;
        },
      },
    },
  );

  assert.equal(payload.ownerAddress, wallet);
  assert.equal(payload.mergeReadiness.status, 'action-required');
  assert.equal(payload.mergeReadiness.inventoryReady, true);
  assert.equal(payload.mergeReadiness.executionWalletReady, false);
  assert.equal(payload.mergeReadiness.executionWallet, wallet);
  assert.equal(payload.mergeReadiness.mergeablePairs, 1.5);
  assert.equal(payload.mergeReadiness.residualYesBalance, 2.5);
  assert.equal(payload.mergeReadiness.residualNoBalance, 0);
  assert.deepEqual(payload.mergeReadiness.missingBalances, []);
  assert.equal(payload.mergeReadiness.blockingReasons.includes('SIGNER_DIFFERS_FROM_OWNER'), true);
  assert.equal(payload.mergeReadiness.blockingReasons.includes('FUNDER_DIFFERS_FROM_OWNER'), true);
  assert.equal(payload.mergeReadiness.warnings.some((entry) => /Operator approval status is not verified/i.test(entry)), true);
  assert.equal(payload.diagnostics.some((entry) => /merge execution must be submitted by the wallet that actually holds the positions/i.test(entry)), true);
});

test('runPolymarketPositions marks merge readiness partial when only one outcome side is scoped', async () => {
  const wallet = '0xabababababababababababababababababababab';
  const tokenId = '301';
  const payload = await runPolymarketPositions(
    {
      wallet,
      source: 'on-chain',
      tokenId,
      rpcUrl: 'https://polygon.example',
    },
    {
      publicClient: {
        readContract: async ({ args }) => {
          const requestedTokenId = String(args[1]);
          if (requestedTokenId === tokenId) return 9_000_000n;
          return 0n;
        },
      },
    },
  );

  assert.equal(payload.market.yesTokenId, tokenId);
  assert.equal(payload.market.noTokenId, null);
  assert.equal(payload.mergeReadiness.status, 'partial');
  assert.equal(payload.mergeReadiness.inventoryReady, false);
  assert.equal(payload.mergeReadiness.mergeablePairs, null);
  assert.deepEqual(payload.mergeReadiness.missingBalances, ['yes', 'no']);
  assert.equal(payload.mergeReadiness.blockingReasons.includes('YES_BALANCE_UNAVAILABLE'), true);
  assert.equal(payload.mergeReadiness.blockingReasons.includes('NO_BALANCE_UNAVAILABLE'), true);
  assert.equal(payload.diagnostics.some((entry) => /Merge readiness is partial/i.test(entry)), true);
});
