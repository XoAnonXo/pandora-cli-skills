const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { privateKeyToAccount } = require('viem/accounts');

const { materializeExecutionSigner } = require('../../cli/lib/signers/execution_signer_service.cjs');

const FIXTURE_PRIVATE_KEY = `0x${'11'.repeat(32)}`;
const FIXTURE_PASSWORD = 'test-password';
const FIXTURE_ACCOUNT = privateKeyToAccount(FIXTURE_PRIVATE_KEY);
const FIXTURE_KEYSTORE_JSON = JSON.stringify({
  address: '19e7e376e7c213b7e7e7e46cc70a5dd086daff2a',
  id: 'c90cd9f1-6e40-4ff1-a2b1-8928c40bb9b0',
  version: 3,
  crypto: {
    cipher: 'aes-128-ctr',
    cipherparams: {
      iv: 'e0e590a09e186927ea81adad8b4b31af',
    },
    ciphertext: 'e077031220490dceff4c6762ce64620d3845c5fd40b4a9e0274b700f6930b3fa',
    kdf: 'scrypt',
    kdfparams: {
      salt: '07366f4bac8d02c3a806f67bea856b2dfa1e0b56548c079ccc34ee856c63ee0b',
      n: 1024,
      dklen: 32,
      p: 1,
      r: 8,
    },
    mac: '0abe3a58589b2bf285e0360e5768e6dff770476f76cd62b9af0a9e6e2da5dc47',
  },
}, null, 2);
const FIXTURE_SIGNATURE = `0x${'11'.repeat(32)}${'22'.repeat(32)}1b`;

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

function createTempKeystore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-execution-signer-'));
  const filePath = path.join(dir, 'operator.json');
  fs.writeFileSync(filePath, FIXTURE_KEYSTORE_JSON, 'utf8');
  fs.chmodSync(filePath, 0o600);
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return filePath;
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

test('execution signer materializes a local-env profile without raw private-key flags', async () => {
  const viemRuntime = await loadViemRuntime();
  const rpcUrl = 'https://rpc.example.invalid';
  const result = await materializeExecutionSigner({
    profile: {
      id: 'local-env-inline',
      displayName: 'Local Env Inline',
      description: 'Inline env-backed signer.',
      signerBackend: 'local-env',
      approvalMode: 'manual',
      secretRef: {
        privateKeyEnv: ['PANDORA_PRIVATE_KEY'],
        rpcUrlEnv: ['RPC_URL'],
        chainIdEnv: ['CHAIN_ID'],
      },
      chainAllowlist: [1],
    },
    chain: buildChain(rpcUrl),
    chainId: 1,
    rpcUrl,
    viemRuntime,
    env: {
      PANDORA_PRIVATE_KEY: FIXTURE_PRIVATE_KEY,
      RPC_URL: rpcUrl,
      CHAIN_ID: '1',
    },
    requireSigner: true,
    mutating: true,
    liveRequested: true,
  });

  assert.equal(result.backend, 'local-env');
  assert.equal(result.account.address.toLowerCase(), FIXTURE_ACCOUNT.address.toLowerCase());
  assert.equal(typeof result.walletClient.writeContract, 'function');
  assert.equal(result.signerMetadata.backend, 'local-env');
});

test('execution signer rejects local-env profiles when execution context drifts from the resolved chain or wallet', async () => {
  const viemRuntime = await loadViemRuntime();
  const rpcUrl = 'https://rpc.example.invalid';

  await assert.rejects(
    () => materializeExecutionSigner({
      resolvedProfile: {
        profile: {
          id: 'local-env-inline',
          displayName: 'Local Env Inline',
          description: 'Inline env-backed signer.',
          signerBackend: 'local-env',
          approvalMode: 'manual',
        },
        resolution: {
          ready: true,
          rpcUrl,
          chainId: 1,
          wallet: FIXTURE_ACCOUNT.address,
          secretSource: { kind: 'env', envVar: 'PANDORA_PRIVATE_KEY' },
          secretMaterial: { privateKey: FIXTURE_PRIVATE_KEY },
        },
      },
      chain: buildChain(rpcUrl),
      chainId: 137,
      rpcUrl,
      viemRuntime,
      requireSigner: true,
      mutating: true,
      liveRequested: true,
    }),
    (error) => error && error.code === 'PROFILE_CONTEXT_MISMATCH',
  );

  await assert.rejects(
    () => materializeExecutionSigner({
      resolvedProfile: {
        profile: {
          id: 'local-env-inline',
          displayName: 'Local Env Inline',
          description: 'Inline env-backed signer.',
          signerBackend: 'local-env',
          approvalMode: 'manual',
        },
        resolution: {
          ready: true,
          rpcUrl,
          chainId: 1,
          wallet: '0x9999999999999999999999999999999999999999',
          secretSource: { kind: 'env', envVar: 'PANDORA_PRIVATE_KEY' },
          secretMaterial: { privateKey: FIXTURE_PRIVATE_KEY },
        },
      },
      chain: buildChain(rpcUrl),
      chainId: 1,
      rpcUrl,
      viemRuntime,
      requireSigner: true,
      mutating: true,
      liveRequested: true,
    }),
    (error) => error && error.code === 'PROFILE_CONTEXT_MISMATCH',
  );
});

test('execution signer materializes a local-keystore profile and exposes a usable account', async (t) => {
  const viemRuntime = await loadViemRuntime();
  const rpcUrl = 'https://rpc.example.invalid';
  const keystorePath = createTempKeystore(t);

  const result = await materializeExecutionSigner({
    profile: {
      id: 'local-keystore-inline',
      displayName: 'Local Keystore Inline',
      description: 'Inline keystore-backed signer.',
      signerBackend: 'local-keystore',
      approvalMode: 'manual',
      secretRef: {
        path: keystorePath,
        passwordEnv: ['PANDORA_KEYSTORE_PASSWORD'],
      },
      chainAllowlist: [1],
    },
    chain: buildChain(rpcUrl),
    chainId: 1,
    rpcUrl,
    viemRuntime,
    env: {
      PANDORA_KEYSTORE_PASSWORD: FIXTURE_PASSWORD,
      RPC_URL: rpcUrl,
      CHAIN_ID: '1',
    },
    requireSigner: true,
    mutating: true,
    liveRequested: true,
  });

  assert.equal(result.backend, 'local-keystore');
  assert.equal(result.account.address.toLowerCase(), FIXTURE_ACCOUNT.address.toLowerCase());
  assert.equal(typeof result.walletClient.writeContract, 'function');
  assert.equal(result.signerMetadata.backend, 'local-keystore');
});

test('execution signer honors resolved keystore secret material even when execution env no longer carries the password', async (t) => {
  const viemRuntime = await loadViemRuntime();
  const rpcUrl = 'https://rpc.example.invalid';
  const keystorePath = createTempKeystore(t);

  const result = await materializeExecutionSigner({
    resolvedProfile: {
      profile: {
        id: 'local-keystore-inline',
        displayName: 'Local Keystore Inline',
        description: 'Inline keystore-backed signer.',
        signerBackend: 'local-keystore',
        approvalMode: 'manual',
        secretRef: {
          path: keystorePath,
          passwordEnv: ['PANDORA_KEYSTORE_PASSWORD'],
        },
        chainAllowlist: [1],
      },
      resolution: {
        ready: true,
        wallet: FIXTURE_ACCOUNT.address.toLowerCase(),
        secretSource: {
          kind: 'file',
          path: keystorePath,
          exists: true,
        },
        secretMaterial: {
          privateKey: FIXTURE_PRIVATE_KEY,
        },
      },
    },
    chain: buildChain(rpcUrl),
    chainId: 1,
    rpcUrl,
    viemRuntime,
    env: {},
    requireSigner: true,
    mutating: true,
    liveRequested: true,
  });

  assert.equal(result.backend, 'local-keystore');
  assert.equal(result.account.address.toLowerCase(), FIXTURE_ACCOUNT.address.toLowerCase());
  assert.equal(typeof result.walletClient.writeContract, 'function');
});

test('execution signer reports relocked keystore profiles clearly when secret material is absent at execution time', async (t) => {
  const viemRuntime = await loadViemRuntime();
  const rpcUrl = 'https://rpc.example.invalid';
  const keystorePath = createTempKeystore(t);

  await assert.rejects(
    () => materializeExecutionSigner({
      resolvedProfile: {
        profile: {
          id: 'local-keystore-inline',
          displayName: 'Local Keystore Inline',
          description: 'Inline keystore-backed signer.',
          signerBackend: 'local-keystore',
          approvalMode: 'manual',
          secretRef: {
            path: keystorePath,
            passwordEnv: ['PANDORA_KEYSTORE_PASSWORD'],
          },
          chainAllowlist: [1],
        },
        resolution: {
          ready: true,
          wallet: FIXTURE_ACCOUNT.address.toLowerCase(),
          secretSource: {
            kind: 'file',
            path: keystorePath,
            exists: true,
          },
        },
      },
      chain: buildChain(rpcUrl),
      chainId: 1,
      rpcUrl,
      viemRuntime,
      env: {
        PANDORA_KEYSTORE_PASSWORD: 'wrong-password',
      },
      requireSigner: true,
      mutating: true,
      liveRequested: true,
    }),
    (error) =>
      error
      && error.code === 'PROFILE_KEYSTORE_LOCKED'
      && /locked/i.test(error.message),
  );
});

test('execution signer materializes an external-signer profile into a viem local account', async () => {
  const viemRuntime = await loadViemRuntime();
  const requests = [];

  await withServer(async (req, res) => {
    if (req.url === '/health') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        data: {
          healthy: true,
          protocolVersion: 'pandora-external-signer/v1',
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
          protocolVersion: 'pandora-external-signer/v1',
          methods: ['signTransaction', 'signTypedData'],
          chainIds: [1],
          accounts: [
            {
              address: '0x3333333333333333333333333333333333333333',
              chainIds: [1],
              methods: ['signTransaction', 'signTypedData'],
            },
          ],
        },
      }));
      return;
    }
    if (req.url === '/sign/transaction') {
      requests.push(await readJsonBody(req));
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        data: {
          protocolVersion: 'pandora-external-signer/v1',
          account: '0x3333333333333333333333333333333333333333',
          chainId: 1,
          signature: FIXTURE_SIGNATURE,
        },
      }));
      return;
    }
    if (req.url === '/sign/typed-data') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        data: {
          protocolVersion: 'pandora-external-signer/v1',
          account: '0x3333333333333333333333333333333333333333',
          chainId: 1,
          signature: FIXTURE_SIGNATURE,
        },
      }));
      return;
    }
    res.statusCode = 404;
    res.end();
  }, async (baseUrl) => {
    const rpcUrl = 'https://rpc.example.invalid';
    const result = await materializeExecutionSigner({
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
      chain: buildChain(rpcUrl),
      chainId: 1,
      rpcUrl,
      viemRuntime,
      env: {
        PANDORA_EXTERNAL_SIGNER_URL: baseUrl,
        PANDORA_EXTERNAL_SIGNER_TOKEN: 'secret-token',
        RPC_URL: rpcUrl,
        CHAIN_ID: '1',
      },
      requireSigner: true,
      mutating: true,
      liveRequested: true,
      metadata: {
        source: 'unit-test',
      },
    });

    assert.equal(result.backend, 'external-signer');
    assert.equal(result.account.address.toLowerCase(), '0x3333333333333333333333333333333333333333');
    const signature = await result.account.signTransaction(
      {
        from: result.account.address,
        to: '0x4444444444444444444444444444444444444444',
        data: '0x',
        value: 0n,
        chainId: 1,
      },
      {
        serializer: (_tx, parsedSignature) => parsedSignature,
      },
    );
    assert.equal(signature.r, `0x${'11'.repeat(32)}`);
    assert.equal(signature.s, `0x${'22'.repeat(32)}`);
    assert.equal(signature.yParity, 0);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].metadata.source, 'unit-test');
    assert.equal(requests[0].account, '0x3333333333333333333333333333333333333333');
  });
});

test('execution signer rejects ambiguous external-signer account discovery when no wallet is pinned', async () => {
  const viemRuntime = await loadViemRuntime();

  await withServer(async (req, res) => {
    if (req.url === '/health') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        data: {
          healthy: true,
          protocolVersion: 'pandora-external-signer/v1',
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
          protocolVersion: 'pandora-external-signer/v1',
          methods: ['signTransaction', 'signTypedData'],
          chainIds: [1],
          accounts: [
            {
              address: '0x3333333333333333333333333333333333333333',
              chainIds: [1],
              methods: ['signTransaction', 'signTypedData'],
            },
            {
              address: '0x4444444444444444444444444444444444444444',
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
      (error) => error && error.code === 'PROFILE_RESOLUTION_UNAVAILABLE' && /multiple accounts/i.test(error.message),
    );
  });
});

test('execution signer requires either raw private key or a ready profile selector when signing is mandatory', async () => {
  const viemRuntime = await loadViemRuntime();
  await assert.rejects(
    () => materializeExecutionSigner({
      chain: buildChain('https://rpc.example.invalid'),
      chainId: 1,
      rpcUrl: 'https://rpc.example.invalid',
      viemRuntime,
      requireSigner: true,
    }),
    (error) => error && error.code === 'PROFILE_SIGNER_REQUIRED',
  );
});
