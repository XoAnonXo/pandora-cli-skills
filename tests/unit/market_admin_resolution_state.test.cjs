const test = require('node:test');
const assert = require('node:assert/strict');

const { readPollResolutionState, runClaim } = require('../../cli/lib/market_admin_service.cjs');

const POLL_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const MARKET_ADDRESS = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const OPERATOR = '0x0D7B957C47Da86c2968dc52111D633D42cb7a5F7';
const WALLET_ADDRESS = '0xcccccccccccccccccccccccccccccccccccccccc';

test('readPollResolutionState extracts answer/finalization epoch from getFinalizedStatus tuple', async () => {
  const publicClient = {
    async readContract({ functionName }) {
      if (functionName === 'getStatus') return 2n;
      if (functionName === 'getFinalizedStatus') return [2n, 1n, 5908608n];
      if (functionName === 'arbiter') return OPERATOR;
      if (functionName === 'getCurrentEpoch' || functionName === 'getFinalizationEpoch' || functionName === 'answer') {
        throw new Error(`missing function: ${functionName}`);
      }
      if (functionName === 'getEpochLength') return 300n;
      throw new Error(`unexpected function read: ${functionName}`);
    },
    async getBlock() {
      return { timestamp: 1772550000n }; // 5908500 * 300
    },
  };

  const state = await readPollResolutionState(publicClient, POLL_ADDRESS);

  assert.equal(state.pollAddress, POLL_ADDRESS);
  assert.equal(state.marketState, 2);
  assert.equal(state.pollFinalized, true);
  assert.equal(state.pollAnswer, 'yes');
  assert.equal(state.finalizationEpoch, '5908608');
  assert.equal(state.currentEpoch, '5908500');
  assert.equal(state.epochsUntilFinalization, 108);
  assert.equal(state.claimable, true);
  assert.equal(state.operator, OPERATOR.toLowerCase());
  assert.equal(state.readSources.finalized, 'getFinalizedStatus');
  assert.equal(state.readSources.answer, null);
});

test('readPollResolutionState uses dedicated answer/currentEpoch readers when available', async () => {
  const publicClient = {
    async readContract({ functionName }) {
      if (functionName === 'getStatus') return 1n;
      if (functionName === 'getFinalizedStatus') throw new Error('tuple reader not supported');
      if (functionName === 'isFinalized') return false;
      if (functionName === 'answer') return 0n;
      if (functionName === 'getFinalizationEpoch') return 5908610n;
      if (functionName === 'getCurrentEpoch') return 5908600n;
      if (functionName === 'arbiter') return OPERATOR;
      if (functionName === 'getEpochLength') throw new Error('epoch length not needed');
      throw new Error(`unexpected function read: ${functionName}`);
    },
    async getBlock() {
      throw new Error('getBlock should not be called when getCurrentEpoch is available');
    },
  };

  const state = await readPollResolutionState(publicClient, POLL_ADDRESS);

  assert.equal(state.pollFinalized, false);
  assert.equal(state.pollAnswer, 'no');
  assert.equal(state.finalizationEpoch, '5908610');
  assert.equal(state.currentEpoch, '5908600');
  assert.equal(state.epochsUntilFinalization, 10);
  assert.equal(state.claimable, false);
  assert.equal(state.readSources.finalized, 'isFinalized');
  assert.equal(state.readSources.answer, 'answer');
  assert.equal(state.readSources.currentEpoch, 'getCurrentEpoch');
});

test('runClaim dry-run simulates redeem with wallet-only discovery when signer creds are absent', async () => {
  const observed = {
    simulateAccount: null,
  };
  const publicClient = {
    async getBytecode() {
      return '0x6001600101';
    },
    async readContract({ address, functionName }) {
      const normalizedAddress = String(address || '').toLowerCase();
      if (normalizedAddress === POLL_ADDRESS) {
        if (functionName === 'getStatus') return 2n;
        if (functionName === 'getFinalizedStatus') return [2n, 1n, 5908608n];
        if (functionName === 'arbiter') return OPERATOR;
        if (functionName === 'getEpochLength') return 300n;
      }
      throw new Error(`unexpected function read: ${normalizedAddress} ${functionName}`);
    },
    async getBlock() {
      return { timestamp: 1772550000n };
    },
    async simulateContract({ account, address, functionName }) {
      observed.simulateAccount = account;
      assert.equal(String(address).toLowerCase(), MARKET_ADDRESS);
      assert.equal(functionName, 'redeemWinnings');
      return {
        request: {
          address: MARKET_ADDRESS,
          functionName: 'redeemWinnings',
          args: [],
        },
        result: 490_000_000n,
      };
    },
  };

  const payload = await runClaim({
    marketAddress: MARKET_ADDRESS,
    wallet: WALLET_ADDRESS,
    execute: false,
    resolvedRuntime: {
      mode: 'read',
      chainId: 1,
      rpcUrl: 'http://127.0.0.1:8545',
    },
    sharedClients: {
      publicClient,
      walletClient: null,
      account: null,
    },
    prefetchedMarket: {
      pollAddress: POLL_ADDRESS,
    },
  });

  assert.equal(observed.simulateAccount, WALLET_ADDRESS);
  assert.equal(payload.claimable, true);
  assert.equal(payload.preflight.account, WALLET_ADDRESS);
  assert.equal(payload.preflight.simulationOk, true);
  assert.equal(payload.preflight.estimatedClaimRaw, '490000000');
});
