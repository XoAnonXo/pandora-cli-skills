const test = require('node:test');
const assert = require('node:assert/strict');

const { buildOutcomeTokenVisibility } = require('../../cli/lib/market_admin_service.cjs');

function formatUnits(value, decimals) {
  const base = 10n ** BigInt(decimals);
  const normalized = typeof value === 'bigint' ? value : BigInt(value);
  const whole = normalized / base;
  const fraction = normalized % base;
  if (fraction === 0n) return whole.toString();
  const paddedFraction = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toString()}.${paddedFraction}`;
}

test('buildOutcomeTokenVisibility exposes machine-usable balances and resolution metadata', () => {
  const visibility = buildOutcomeTokenVisibility({
    refs: {
      source: 'yesToken/noToken',
      yesToken: '0x1111111111111111111111111111111111111111',
      noToken: '0x2222222222222222222222222222222222222222',
    },
    yesRaw: 383030000000000000000n,
    noRaw: 408000000000000000000n,
    yesDecimals: 18,
    noDecimals: 18,
    resolution: {
      marketState: 2,
      pollFinalized: true,
      pollAnswer: 'yes',
      finalizationEpoch: '5908608',
      currentEpoch: '5908833',
      epochsUntilFinalization: 0,
      claimable: true,
      operator: '0x3333333333333333333333333333333333333333',
      readSources: { finalized: 'getFinalizedStatus' },
    },
    formatUnits,
  });

  assert.equal(visibility.positionSide, 'both');
  assert.equal(visibility.hasInventory, true);
  assert.equal(visibility.claimable, true);
  assert.equal(visibility.claimableOutcome, 'yes');
  assert.equal(visibility.claimableAmountRaw, '383030000000000000000');
  assert.equal(visibility.claimableAmount, '383.03');
  assert.equal(visibility.claimableUsdc, '383.03');
  assert.equal(visibility.hasClaimableInventory, true);
  assert.equal(visibility.marketResolved, true);
  assert.equal(visibility.finalizesInEpochs, 0);
  assert.deepEqual(visibility.yes, {
    token: '0x1111111111111111111111111111111111111111',
    decimals: 18,
    balanceRaw: '383030000000000000000',
    balance: '383.03',
  });
  assert.deepEqual(visibility.no, {
    token: '0x2222222222222222222222222222222222222222',
    decimals: 18,
    balanceRaw: '408000000000000000000',
    balance: '408',
  });
  assert.deepEqual(visibility.resolution, {
    marketState: 2,
    pollFinalized: true,
    pollAnswer: 'yes',
    finalizationEpoch: '5908608',
    currentEpoch: '5908833',
    epochsUntilFinalization: 0,
    claimable: true,
    operator: '0x3333333333333333333333333333333333333333',
    readSources: { finalized: 'getFinalizedStatus' },
  });
});

test('buildOutcomeTokenVisibility keeps unresolved inventory visible without claimable amounts', () => {
  const visibility = buildOutcomeTokenVisibility({
    refs: {
      source: 'yesToken/noToken',
      yesToken: '0x1111111111111111111111111111111111111111',
      noToken: '0x2222222222222222222222222222222222222222',
    },
    yesRaw: 0n,
    noRaw: 12500000000000000000n,
    yesDecimals: 18,
    noDecimals: 18,
    resolution: {
      marketState: 1,
      pollFinalized: false,
      pollAnswer: 'no',
      finalizationEpoch: '5909000',
      currentEpoch: '5908995',
      epochsUntilFinalization: 5,
      claimable: false,
      operator: null,
      readSources: { currentEpoch: 'getCurrentEpoch' },
    },
    formatUnits,
  });

  assert.equal(visibility.positionSide, 'no');
  assert.equal(visibility.hasInventory, true);
  assert.equal(visibility.claimable, false);
  assert.equal(visibility.claimableOutcome, null);
  assert.equal(visibility.claimableAmountRaw, null);
  assert.equal(visibility.claimableAmount, null);
  assert.equal(visibility.claimableUsdc, null);
  assert.equal(visibility.hasClaimableInventory, false);
  assert.equal(visibility.marketResolved, false);
  assert.equal(visibility.finalizesInEpochs, 5);
  assert.equal(visibility.no.balance, '12.5');
});
