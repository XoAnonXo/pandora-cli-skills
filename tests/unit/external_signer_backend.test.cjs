const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const {
  EXTERNAL_SIGNER_PROTOCOL_VERSION,
  createExternalSignerBackend,
} = require('../../cli/lib/signers/external_signer_backend.cjs');
const { materializeExecutionSigner } = require('../../cli/lib/signers/execution_signer_service.cjs');

function buildChain(rpcUrl) {
  return {
    id: 1,
    name: 'Ethereum',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
    blockExplorers: { default: { name: 'Etherscan', url: 'https://etherscan.io' } },
  };
}

async function loadViemRuntime() {
  const viem = await import('viem');
  const accounts = await import('viem/accounts');
  return { ...viem, ...accounts };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function readJsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }
  return body ? JSON.parse(body) : null;
}

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await listen(server);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(baseUrl);
  } finally {
    await close(server);
  }
}

test('external signer backend healthCheck sends auth and protocol headers and stores discovered capabilities', async () => {
  const requests = [];

  await withServer(async (req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
    });
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      data: {
        healthy: true,
        serviceId: 'desk-signer',
        version: '1.2.3',
        protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
        methods: ['signTransaction', 'signTypedData'],
        chainIds: [1, 137],
      },
    }));
  }, async (baseUrl) => {
    const backend = createExternalSignerBackend({
      baseUrl,
      authToken: 'secret-token',
      headers: {
        'x-client-id': 'pandora-tests',
      },
    });

    const result = await backend.healthCheck();
    assert.deepEqual(result, {
      ok: true,
      healthy: true,
      protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
      methods: ['signTransaction', 'signTypedData'],
      chainIds: [1, 137],
      serviceId: 'desk-signer',
      version: '1.2.3',
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].url, '/health');
    assert.equal(requests[0].headers.authorization, 'Bearer secret-token');
    assert.equal(requests[0].headers['x-pandora-external-signer-protocol'], EXTERNAL_SIGNER_PROTOCOL_VERSION);
    assert.equal(requests[0].headers['x-client-id'], 'pandora-tests');

    assert.deepEqual(backend.getCapabilities(), {
      protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
      methods: ['signTransaction', 'signTypedData'],
      chainIds: [1, 137],
      accountsDiscovered: 0,
      lastHealth: result,
    });
  });
});

test('external signer backend healthCheck rejects missing explicit healthy status', async () => {
  await withServer(async (_req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      data: {
        protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
        methods: ['signTransaction'],
        chainIds: [1],
      },
    }));
  }, async (baseUrl) => {
    const backend = createExternalSignerBackend({
      baseUrl,
      supportedMethods: ['signTransaction'],
      chainIds: [1],
    });

    await assert.rejects(
      () => backend.healthCheck(),
      (error) => error && error.code === 'EXTERNAL_SIGNER_INVALID_RESPONSE' && /boolean healthy/i.test(error.message),
    );
  });
});

test('external signer backend healthCheck rejects protocol mismatches', async () => {
  await withServer(async (_req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      data: {
        healthy: true,
        protocolVersion: 'pandora-external-signer/v0',
        methods: ['signTransaction'],
        chainIds: [1],
      },
    }));
  }, async (baseUrl) => {
    const backend = createExternalSignerBackend({
      baseUrl,
      supportedMethods: ['signTransaction'],
      chainIds: [1],
    });

    await assert.rejects(
      () => backend.healthCheck(),
      (error) => error && error.code === 'EXTERNAL_SIGNER_PROTOCOL_MISMATCH',
    );
  });
});

test('external signer backend discovers accounts and signs transactions with deterministic JSON contract', async () => {
  const requests = [];

  await withServer(async (req, res) => {
    if (req.url === '/accounts?chainId=1') {
      requests.push({
        method: req.method,
        url: req.url,
      });
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        data: {
          protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
          methods: ['signTransaction', 'signTypedData'],
          chainIds: [1],
          accounts: [
            {
              address: '0x1111111111111111111111111111111111111111',
              chainIds: [1],
              methods: ['signTransaction', 'signTypedData'],
              labels: { desk: 'alpha' },
            },
          ],
        },
      }));
      return;
    }

    if (req.url === '/sign/transaction') {
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: await readJsonBody(req),
      });
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        data: {
          protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
          account: '0x1111111111111111111111111111111111111111',
          chainId: 1,
          signedTransaction: '0xsignedtx',
          hash: '0xhash',
        },
      }));
      return;
    }

    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: `Unexpected path: ${req.url}`,
      },
    }));
  }, async (baseUrl) => {
    const backend = createExternalSignerBackend({
      baseUrl,
      authToken: 'secret-token',
      chainIds: [1],
    });

    const accounts = await backend.listAccounts({ chainId: 1 });
    assert.deepEqual(accounts, {
      protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
      methods: ['signTransaction', 'signTypedData'],
      chainIds: [1],
      accounts: [
        {
          address: '0x1111111111111111111111111111111111111111',
          chainIds: [1],
          methods: ['signTransaction', 'signTypedData'],
          labels: { desk: 'alpha' },
        },
      ],
    });

    const result = await backend.signTransaction({
      chainId: 1,
      account: '0x1111111111111111111111111111111111111111',
      transaction: {
        from: '0x1111111111111111111111111111111111111111',
        to: '0x2222222222222222222222222222222222222222',
        data: '0x',
        value: '0x0',
        chainId: 1,
      },
      metadata: {
        operationId: 'op-123',
      },
    });

    assert.deepEqual(result, {
      protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
      account: '0x1111111111111111111111111111111111111111',
      chainId: 1,
      signature: null,
      signedTransaction: '0xsignedtx',
      hash: '0xhash',
      raw: {
        protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
        account: '0x1111111111111111111111111111111111111111',
        chainId: 1,
        signedTransaction: '0xsignedtx',
        hash: '0xhash',
      },
    });

    assert.equal(requests.length, 2);
    assert.equal(requests[1].method, 'POST');
    assert.equal(requests[1].url, '/sign/transaction');
    assert.equal(requests[1].headers.authorization, 'Bearer secret-token');
    assert.deepEqual(requests[1].body, {
      protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
      method: 'signTransaction',
      chainId: 1,
      account: '0x1111111111111111111111111111111111111111',
      payload: {
        transaction: {
          from: '0x1111111111111111111111111111111111111111',
          to: '0x2222222222222222222222222222222222222222',
          data: '0x',
          value: '0x0',
          chainId: 1,
        },
      },
      metadata: {
        operationId: 'op-123',
      },
    });
  });
});

test('external signer backend signs typed data with deterministic JSON contract', async () => {
  const requests = [];

  await withServer(async (req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      body: await readJsonBody(req),
    });
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      data: {
        protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
        account: '0x3333333333333333333333333333333333333333',
        chainId: 137,
        signature: '0xtypeddatasignature',
      },
    }));
  }, async (baseUrl) => {
    const backend = createExternalSignerBackend({
      baseUrl,
      supportedMethods: ['signTypedData'],
      chainIds: [137],
    });

    const result = await backend.signTypedData({
      chainId: 137,
      account: '0x3333333333333333333333333333333333333333',
      typedData: {
        domain: {
          name: 'Pandora',
          chainId: 137,
        },
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'chainId', type: 'uint256' },
          ],
          Order: [
            { name: 'maker', type: 'address' },
          ],
        },
        primaryType: 'Order',
        message: {
          maker: '0x3333333333333333333333333333333333333333',
        },
      },
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, '/sign/typed-data');
    assert.deepEqual(requests[0].body, {
      protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
      method: 'signTypedData',
      chainId: 137,
      account: '0x3333333333333333333333333333333333333333',
      payload: {
        typedData: {
          domain: {
            name: 'Pandora',
            chainId: 137,
          },
          types: {
            EIP712Domain: [
              { name: 'name', type: 'string' },
              { name: 'chainId', type: 'uint256' },
            ],
            Order: [
              { name: 'maker', type: 'address' },
            ],
          },
          primaryType: 'Order',
          message: {
            maker: '0x3333333333333333333333333333333333333333',
          },
        },
      },
      metadata: {},
    });
    assert.deepEqual(result, {
      protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
      account: '0x3333333333333333333333333333333333333333',
      chainId: 137,
      signature: '0xtypeddatasignature',
      signedTransaction: null,
      hash: null,
      raw: {
        protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
        account: '0x3333333333333333333333333333333333333333',
        chainId: 137,
        signature: '0xtypeddatasignature',
      },
    });
  });
});

test('external signer backend rejects unsupported methods and chains before any HTTP call', async () => {
  let fetchCount = 0;
  const backend = createExternalSignerBackend({
    baseUrl: 'http://127.0.0.1:1',
    supportedMethods: ['signTransaction'],
    chainIds: [1],
    fetch: async () => {
      fetchCount += 1;
      throw new Error('fetch should not be called');
    },
  });

  await assert.rejects(
    () => backend.signTypedData({
      chainId: 1,
      account: '0x4444444444444444444444444444444444444444',
      typedData: {
        domain: { chainId: 1 },
      },
    }),
    (error) => {
      assert.equal(error.code, 'EXTERNAL_SIGNER_METHOD_NOT_ALLOWED');
      return true;
    },
  );

  await assert.rejects(
    () => backend.signTransaction({
      chainId: 137,
      account: '0x4444444444444444444444444444444444444444',
      transaction: {
        to: '0x5555555555555555555555555555555555555555',
      },
    }),
    (error) => {
      assert.equal(error.code, 'EXTERNAL_SIGNER_CHAIN_NOT_ALLOWED');
      assert.deepEqual(error.details.allowedChainIds, [1]);
      return true;
    },
  );

  assert.equal(fetchCount, 0);
});

test('external signer backend fails closed when requested account discovery returns no eligible accounts', async () => {
  await withServer(async (req, res) => {
    assert.equal(req.url, '/accounts?chainId=1');
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      data: {
        protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
        methods: ['signTransaction'],
        chainIds: [1],
        accounts: [],
      },
    }));
  }, async (baseUrl) => {
    const backend = createExternalSignerBackend({
      baseUrl,
      supportedMethods: ['signTransaction'],
      chainIds: [1],
    });

    await assert.rejects(
      () => backend.listAccounts({ chainId: 1 }),
      (error) => error && error.code === 'EXTERNAL_SIGNER_ACCOUNT_NOT_FOUND' && /chain 1/i.test(error.message),
    );
  });
});

test('external signer backend requires explicit account selection when multiple live accounts are eligible', async () => {
  await withServer(async (req, res) => {
    assert.equal(req.url, '/accounts?chainId=1');
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      data: {
        protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
        methods: ['signTransaction', 'signTypedData'],
        chainIds: [1],
        accounts: [
          {
            address: '0x1111111111111111111111111111111111111111',
            chainIds: [1],
            methods: ['signTransaction', 'signTypedData'],
          },
          {
            address: '0x2222222222222222222222222222222222222222',
            chainIds: [1],
            methods: ['signTransaction'],
          },
        ],
      },
    }));
  }, async (baseUrl) => {
    const backend = createExternalSignerBackend({
      baseUrl,
      supportedMethods: ['signTransaction', 'signTypedData'],
      chainIds: [1],
    });

    await assert.rejects(
      () => backend.selectAccount({ chainId: 1, method: 'signTransaction' }),
      (error) => {
        assert.equal(error.code, 'EXTERNAL_SIGNER_ACCOUNT_SELECTION_REQUIRED');
        assert.deepEqual(error.details.accounts, [
          '0x1111111111111111111111111111111111111111',
          '0x2222222222222222222222222222222222222222',
        ]);
        return true;
      },
    );
  });
});

test('external signer backend rejects pinned accounts that are not returned by live discovery', async () => {
  await withServer(async (req, res) => {
    assert.equal(req.url, '/accounts?chainId=1');
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      data: {
        protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
        methods: ['signTransaction'],
        chainIds: [1],
        accounts: [
          {
            address: '0x1111111111111111111111111111111111111111',
            chainIds: [1],
            methods: ['signTransaction'],
          },
        ],
      },
    }));
  }, async (baseUrl) => {
    const backend = createExternalSignerBackend({
      baseUrl,
      supportedMethods: ['signTransaction'],
      chainIds: [1],
    });

    await assert.rejects(
      () => backend.selectAccount({
        chainId: 1,
        method: 'signTransaction',
        account: '0x3333333333333333333333333333333333333333',
      }),
      (error) => error && error.code === 'EXTERNAL_SIGNER_ACCOUNT_NOT_FOUND' && /not available/i.test(error.message),
    );
  });
});

test('execution signer rejects pinned external-signer wallets that are not returned by live discovery', async () => {
  const viemRuntime = await loadViemRuntime();

  await withServer(async (req, res) => {
    if (req.url === '/health') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        data: {
          healthy: true,
          protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
          methods: ['signTransaction', 'signTypedData'],
          chainIds: [1],
        },
      }));
      return;
    }
    if (req.url === '/accounts?chainId=1') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        data: {
          protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
          methods: ['signTransaction', 'signTypedData'],
          chainIds: [1],
          accounts: [
            {
              address: '0x1111111111111111111111111111111111111111',
              chainIds: [1],
              methods: ['signTransaction', 'signTypedData'],
            },
          ],
        },
      }));
      return;
    }
    res.statusCode = 404;
    res.end();
  }, async (baseUrl) => {
    const rpcUrl = 'https://rpc.example.invalid';
    await assert.rejects(
      () => materializeExecutionSigner({
        resolvedProfile: {
          profile: {
            id: 'desk-inline',
            displayName: 'Desk Inline',
            description: 'Inline external signer.',
            signerBackend: 'external-signer',
            approvalMode: 'external',
            secretRef: {
              reference: 'signer://desk',
              baseUrlEnv: ['PANDORA_EXTERNAL_SIGNER_URL'],
              authTokenEnv: ['PANDORA_EXTERNAL_SIGNER_TOKEN'],
              supportedMethods: ['signTransaction', 'signTypedData'],
            },
            chainAllowlist: [1],
          },
          resolution: {
            ready: true,
            wallet: '0x3333333333333333333333333333333333333333',
            rpcUrl,
            chainId: 1,
            secretSource: { kind: 'env', envVar: 'PANDORA_EXTERNAL_SIGNER_TOKEN' },
          },
        },
        chain: buildChain(rpcUrl),
        chainId: 1,
        rpcUrl,
        viemRuntime,
        env: {
          PANDORA_EXTERNAL_SIGNER_URL: baseUrl,
          PANDORA_EXTERNAL_SIGNER_TOKEN: 'secret-token',
        },
        requireSigner: true,
        mutating: true,
        liveRequested: true,
      }),
      (error) => error && error.code === 'PROFILE_RESOLUTION_UNAVAILABLE' && /not available/i.test(error.message),
    );
  });
});

test('execution signer materializes pinned external-signer wallets safely when multiple accounts exist', async () => {
  const viemRuntime = await loadViemRuntime();

  await withServer(async (req, res) => {
    if (req.url === '/health') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        data: {
          healthy: true,
          protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
          methods: ['signTransaction', 'signTypedData'],
          chainIds: [1],
        },
      }));
      return;
    }
    if (req.url === '/accounts?chainId=1') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        data: {
          protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
          methods: ['signTransaction', 'signTypedData'],
          chainIds: [1],
          accounts: [
            {
              address: '0x1111111111111111111111111111111111111111',
              chainIds: [1],
              methods: ['signTransaction', 'signTypedData'],
            },
            {
              address: '0x2222222222222222222222222222222222222222',
              chainIds: [1],
              methods: ['signTransaction', 'signTypedData'],
            },
          ],
        },
      }));
      return;
    }
    res.statusCode = 404;
    res.end();
  }, async (baseUrl) => {
    const rpcUrl = 'https://rpc.example.invalid';
    const result = await materializeExecutionSigner({
      resolvedProfile: {
        profile: {
          id: 'desk-inline',
          displayName: 'Desk Inline',
          description: 'Inline external signer.',
          signerBackend: 'external-signer',
          approvalMode: 'external',
          secretRef: {
            reference: 'signer://desk',
            baseUrlEnv: ['PANDORA_EXTERNAL_SIGNER_URL'],
            authTokenEnv: ['PANDORA_EXTERNAL_SIGNER_TOKEN'],
            supportedMethods: ['signTransaction', 'signTypedData'],
          },
          chainAllowlist: [1],
        },
        resolution: {
          ready: true,
          wallet: '0x2222222222222222222222222222222222222222',
          rpcUrl,
          chainId: 1,
          secretSource: { kind: 'env', envVar: 'PANDORA_EXTERNAL_SIGNER_TOKEN' },
        },
      },
      chain: buildChain(rpcUrl),
      chainId: 1,
      rpcUrl,
      viemRuntime,
      env: {
        PANDORA_EXTERNAL_SIGNER_URL: baseUrl,
        PANDORA_EXTERNAL_SIGNER_TOKEN: 'secret-token',
      },
      requireSigner: true,
      mutating: true,
      liveRequested: true,
    });

    assert.equal(result.backend, 'external-signer');
    assert.equal(result.signerAddress.toLowerCase(), '0x2222222222222222222222222222222222222222');
    assert.equal(result.account.address.toLowerCase(), '0x2222222222222222222222222222222222222222');
  });
});

test('external signer backend normalizes unauthorized remote errors', async () => {
  await withServer(async (req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/sign/transaction');
    res.statusCode = 401;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Signer token rejected.',
        details: {
          hint: 'refresh token',
        },
      },
    }));
  }, async (baseUrl) => {
    const backend = createExternalSignerBackend({
      baseUrl,
      authToken: 'expired-token',
      chainIds: [1],
    });

    await assert.rejects(
      () => backend.signTransaction({
        chainId: 1,
        account: '0x6666666666666666666666666666666666666666',
        transaction: {
          to: '0x7777777777777777777777777777777777777777',
        },
      }),
      (error) => {
        assert.equal(error.code, 'EXTERNAL_SIGNER_UNAUTHORIZED');
        assert.equal(error.details.remoteCode, 'UNAUTHORIZED');
        assert.equal(error.details.status, 401);
        assert.deepEqual(error.details.remoteDetails, { hint: 'refresh token' });
        return true;
      },
    );
  });
});

test('external signer backend rejects conflicting authToken and Authorization header configuration', () => {
  assert.throws(
    () => createExternalSignerBackend({
      baseUrl: 'http://127.0.0.1:8545',
      authToken: 'abc',
      headers: {
        Authorization: 'Bearer custom',
      },
    }),
    (error) => {
      assert.equal(error.code, 'EXTERNAL_SIGNER_CONFIG_INVALID');
      return true;
    },
  );
});

test('external signer backend rejects malformed signTypedData responses', async () => {
  await withServer(async (_req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      data: {
        protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
        account: '0x8888888888888888888888888888888888888888',
        chainId: 1,
      },
    }));
  }, async (baseUrl) => {
    const backend = createExternalSignerBackend({
      baseUrl,
      supportedMethods: ['signTypedData'],
      chainIds: [1],
    });

    await assert.rejects(
      () => backend.signTypedData({
        chainId: 1,
        account: '0x8888888888888888888888888888888888888888',
        typedData: {
          domain: { chainId: 1 },
        },
      }),
      (error) => {
        assert.equal(error.code, 'EXTERNAL_SIGNER_INVALID_RESPONSE');
        return true;
      },
    );
  });
});

test('external signer backend rejects signTransaction responses whose account does not match the request account', async () => {
  await withServer(async (req, res) => {
    if (req.url === '/accounts?chainId=1') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        data: {
          protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
          methods: ['signTransaction'],
          chainIds: [1],
          accounts: [
            {
              address: '0x1111111111111111111111111111111111111111',
              chainIds: [1],
              methods: ['signTransaction'],
            },
          ],
        },
      }));
      return;
    }

    if (req.url === '/sign/transaction') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        data: {
          protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
          account: '0x9999999999999999999999999999999999999999',
          chainId: 1,
          signedTransaction: '0xsignedtx',
        },
      }));
      return;
    }

    res.statusCode = 404;
    res.end();
  }, async (baseUrl) => {
    const backend = createExternalSignerBackend({
      baseUrl,
      supportedMethods: ['signTransaction'],
      chainIds: [1],
    });

    await backend.listAccounts({ chainId: 1 });
    await assert.rejects(
      () => backend.signTransaction({
        chainId: 1,
        account: '0x1111111111111111111111111111111111111111',
        transaction: {
          from: '0x1111111111111111111111111111111111111111',
          to: '0x2222222222222222222222222222222222222222',
          data: '0x',
          value: '0x0',
          chainId: 1,
        },
      }),
      (error) => error && error.code === 'EXTERNAL_SIGNER_INVALID_RESPONSE' && /response account does not match/i.test(error.message),
    );
  });
});
