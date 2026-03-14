const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
  DEFAULT_FLASHBOTS_RELAY_URL,
  DEFAULT_FLASHBOTS_TARGET_BLOCK_OFFSET,
  FLASHBOTS_METHODS,
  normalizeFlashbotsRelayUrl,
  normalizeTargetBlockOffset,
  sendFlashbotsPrivateTransaction,
  sendFlashbotsBundle,
} = require('../../cli/lib/flashbots_service.cjs');

function makeHexDigest(input) {
  const hex = String(input || '').replace(/^0x/, '');
  return `0x${crypto.createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex')}`;
}

function makeViemRuntime() {
  return {
    stringToHex(value) {
      return `0x${Buffer.from(String(value)).toString('hex')}`;
    },
    keccak256(value) {
      return makeHexDigest(value);
    },
  };
}

function makeAuthAccount(calls = null) {
  return {
    address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    async signMessage(input) {
      if (Array.isArray(calls)) calls.push(input);
      return `0x${'b'.repeat(130)}`;
    },
  };
}

test('flashbots helpers normalize default relay configuration', () => {
  assert.equal(normalizeFlashbotsRelayUrl(), 'https://relay.flashbots.net/');
  assert.equal(normalizeTargetBlockOffset(), DEFAULT_FLASHBOTS_TARGET_BLOCK_OFFSET);
  assert.throws(
    () => normalizeTargetBlockOffset(0),
    /target block offset must be a positive integer/i,
  );
});

test('sendFlashbotsPrivateTransaction signs and submits a single private transaction', async () => {
  const bodies = [];
  const headers = [];
  const signCalls = [];
  const result = await sendFlashbotsPrivateTransaction({
    publicClient: {
      async getBlockNumber() {
        return 100n;
      },
    },
    walletClient: {
      async signTransaction() {
        return `0x${'1'.repeat(64)}`;
      },
    },
    transactionRequest: {
      to: '0x1111111111111111111111111111111111111111',
      nonce: 7,
    },
    relayUrl: 'https://relay.flashbots.example',
    authAccount: makeAuthAccount(signCalls),
    viemRuntime: makeViemRuntime(),
    fetchImpl: async (_url, request) => {
      bodies.push(JSON.parse(request.body));
      headers.push(request.headers);
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            jsonrpc: '2.0',
            id: bodies.length,
            result: { txHash: `0x${'2'.repeat(64)}` },
          });
        },
      };
    },
  });

  assert.equal(bodies.length, 1);
  assert.equal(signCalls.length, 1);
  assert.match(signCalls[0].message.raw, /^0x[0-9a-f]+$/i);
  assert.match(headers[0]['x-flashbots-signature'], /^0x[a-f0-9]{40}:0x[b]{130}$/i);
  assert.equal(bodies[0].method, FLASHBOTS_METHODS.sendPrivateTransaction);
  assert.equal(bodies[0].params[0].maxBlockNumber, '0x65');
  assert.equal(result.relayMethod, FLASHBOTS_METHODS.sendPrivateTransaction);
  assert.equal(result.targetBlockNumber, 101);
  assert.equal(result.transactionHash, `0x${'2'.repeat(64)}`);
});

test('sendFlashbotsBundle simulates before submit and normalizes bundle metadata', async () => {
  const calls = [];
  const result = await sendFlashbotsBundle({
    publicClient: {
      async getBlockNumber() {
        return 200n;
      },
    },
    walletClient: {
      async signTransaction(request) {
        return request.nonce === 1
          ? `0x${'3'.repeat(64)}`
          : `0x${'4'.repeat(64)}`;
      },
    },
    transactionRequests: [
      { nonce: 1, to: '0x1111111111111111111111111111111111111111' },
      { nonce: 2, to: '0x2222222222222222222222222222222222222222' },
    ],
    relayUrl: 'https://relay.flashbots.example',
    authAccount: makeAuthAccount(),
    viemRuntime: makeViemRuntime(),
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      calls.push(body.method);
      if (body.method === FLASHBOTS_METHODS.callBundle) {
        return {
          ok: true,
          async text() {
            return JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: {
                results: [{ gasUsed: '0x1' }, { gasUsed: '0x2' }],
              },
            });
          },
        };
      }
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: {
              bundleHash: `0x${'5'.repeat(64)}`,
            },
          });
        },
      };
    },
  });

  assert.deepEqual(calls, [FLASHBOTS_METHODS.callBundle, FLASHBOTS_METHODS.sendBundle]);
  assert.equal(result.relayMethod, FLASHBOTS_METHODS.sendBundle);
  assert.equal(result.targetBlockNumber, 201);
  assert.equal(result.bundleHash, `0x${'5'.repeat(64)}`);
  assert.equal(result.transactionHashes.length, 2);
  assert.ok(result.simulation);
});

test('sendFlashbotsBundle fails closed when simulation reports a revert', async () => {
  await assert.rejects(
    sendFlashbotsBundle({
      publicClient: {
        async getBlockNumber() {
          return 300n;
        },
      },
      walletClient: {
        async signTransaction() {
          return `0x${'6'.repeat(64)}`;
        },
      },
      transactionRequests: [
        { nonce: 1, to: '0x1111111111111111111111111111111111111111' },
      ],
      relayUrl: 'https://relay.flashbots.example',
      authAccount: makeAuthAccount(),
      viemRuntime: makeViemRuntime(),
      fetchImpl: async (_url, request) => {
        const body = JSON.parse(request.body);
        if (body.method !== FLASHBOTS_METHODS.callBundle) {
          throw new Error('sendBundle should not run after a failed simulation');
        }
        return {
          ok: true,
          async text() {
            return JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: {
                results: [{ error: 'execution reverted' }],
              },
            });
          },
        };
      },
    }),
    (error) => {
      assert.equal(error.code, 'FLASHBOTS_BUNDLE_SIMULATION_FAILED');
      assert.match(error.message, /execution reverted/i);
      return true;
    },
  );
});

test('sendFlashbotsPrivateTransaction decorates pre-submit failures with route metadata', async () => {
  await assert.rejects(
    sendFlashbotsPrivateTransaction({
      publicClient: {
        async getBlockNumber() {
          throw new Error('rpc unavailable');
        },
      },
      walletClient: {
        async signTransaction() {
          return `0x${'1'.repeat(64)}`;
        },
      },
      transactionRequest: {
        to: '0x1111111111111111111111111111111111111111',
        nonce: 7,
      },
      relayUrl: 'https://relay.flashbots.example',
      authAccount: makeAuthAccount(),
      viemRuntime: makeViemRuntime(),
      fetchImpl: async () => {
        throw new Error('should not be called');
      },
    }),
    (error) => {
      assert.equal(error.details.relayMethod, FLASHBOTS_METHODS.sendPrivateTransaction);
      assert.equal(error.details.relayUrl, 'https://relay.flashbots.example/');
      return true;
    },
  );
});

test('sendFlashbotsBundle preserves relay context when the relay rejects submission', async () => {
  await assert.rejects(
    sendFlashbotsBundle({
      publicClient: {
        async getBlockNumber() {
          return 400n;
        },
      },
      walletClient: {
        async signTransaction(request) {
          return request.nonce === 1
            ? `0x${'3'.repeat(64)}`
            : `0x${'4'.repeat(64)}`;
        },
      },
      transactionRequests: [
        { nonce: 1, to: '0x1111111111111111111111111111111111111111' },
        { nonce: 2, to: '0x2222222222222222222222222222222222222222' },
      ],
      relayUrl: 'https://relay.flashbots.example',
      authAccount: makeAuthAccount(),
      viemRuntime: makeViemRuntime(),
      fetchImpl: async (_url, request) => {
        const body = JSON.parse(request.body);
        if (body.method === FLASHBOTS_METHODS.callBundle) {
          return {
            ok: true,
            async text() {
              return JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                result: {
                  results: [{ gasUsed: '0x1' }, { gasUsed: '0x2' }],
                },
              });
            },
          };
        }
        return {
          ok: true,
          async text() {
            return JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              error: {
                code: -32000,
                message: 'bundle rejected',
              },
            });
          },
        };
      },
    }),
    (error) => {
      assert.equal(error.code, 'FLASHBOTS_RPC_ERROR');
      assert.equal(error.details.relayMethod, FLASHBOTS_METHODS.sendBundle);
      assert.equal(error.details.targetBlockNumber, 401);
      assert.equal(error.details.transactionHashes.length, 2);
      return true;
    },
  );
});

test('sendFlashbotsBundle fills missing viem helpers from the default runtime when overrides are partial', async () => {
  const calls = [];
  const result = await sendFlashbotsBundle({
    publicClient: {
      async getBlockNumber() {
        return 600n;
      },
    },
    walletClient: {
      async signTransaction() {
        return `0x${'7'.repeat(64)}`;
      },
    },
    transactionRequests: [
      { nonce: 1, to: '0x1111111111111111111111111111111111111111' },
    ],
    relayUrl: 'https://relay.flashbots.example',
    authAccount: makeAuthAccount(),
    viemRuntime: {},
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      calls.push(body.method);
      if (body.method === FLASHBOTS_METHODS.callBundle) {
        return {
          ok: true,
          async text() {
            return JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: {
                results: [{ gasUsed: '0x1' }],
              },
            });
          },
        };
      }
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: {
              bundleHash: `0x${'8'.repeat(64)}`,
            },
          });
        },
      };
    },
  });

  assert.deepEqual(calls, [FLASHBOTS_METHODS.callBundle, FLASHBOTS_METHODS.sendBundle]);
  assert.equal(result.bundleHash, `0x${'8'.repeat(64)}`);
  assert.equal(result.transactionHashes.length, 1);
});

test('sendFlashbotsPrivateTransaction preserves relay context when the relay responds with HTTP failure', async () => {
  await assert.rejects(
    sendFlashbotsPrivateTransaction({
      publicClient: {
        async getBlockNumber() {
          return 500n;
        },
      },
      walletClient: {
        async signTransaction() {
          return `0x${'1'.repeat(64)}`;
        },
      },
      transactionRequest: {
        to: '0x1111111111111111111111111111111111111111',
        nonce: 7,
      },
      relayUrl: 'https://relay.flashbots.example',
      authAccount: makeAuthAccount(),
      viemRuntime: makeViemRuntime(),
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        async text() {
          return JSON.stringify({ message: 'relay overloaded' });
        },
      }),
    }),
    (error) => {
      assert.equal(error.code, 'FLASHBOTS_HTTP_ERROR');
      assert.equal(error.details.relayMethod, FLASHBOTS_METHODS.sendPrivateTransaction);
      assert.equal(error.details.targetBlockNumber, 501);
      return true;
    },
  );
});

test('sendFlashbotsPrivateTransaction classifies relay 403 responses as pre-submission forbidden errors', async () => {
  await assert.rejects(
    sendFlashbotsPrivateTransaction({
      publicClient: {
        async getBlockNumber() {
          return 700n;
        },
      },
      walletClient: {
        async signTransaction() {
          return `0x${'2'.repeat(64)}`;
        },
      },
      transactionRequest: {
        to: '0x1111111111111111111111111111111111111111',
        nonce: 8,
      },
      relayUrl: 'https://relay.flashbots.example',
      authAccount: makeAuthAccount(),
      viemRuntime: makeViemRuntime(),
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        async text() {
          return JSON.stringify({ error: 'forbidden' });
        },
      }),
    }),
    (error) => {
      assert.equal(error.code, 'FLASHBOTS_RELAY_FORBIDDEN');
      assert.equal(error.details.relayMethod, FLASHBOTS_METHODS.sendPrivateTransaction);
      assert.equal(error.details.status, 403);
      assert.equal(error.details.preSubmissionFailure, true);
      assert.equal(error.details.relayRejected, true);
      return true;
    },
  );
});
