const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { privateKeyToAccount } = require('viem/accounts');

const {
  createLocalKeystoreSigner,
  resolveLocalKeystoreSigner,
} = require('../../cli/lib/signers/local_keystore_signer.cjs');

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

function createTempKeystore(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-local-keystore-'));
  const filePath = path.join(dir, 'operator.json');
  const content = options.content !== undefined ? options.content : FIXTURE_KEYSTORE_JSON;
  fs.writeFileSync(filePath, content, 'utf8');
  fs.chmodSync(filePath, options.mode === undefined ? 0o600 : options.mode);
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return filePath;
}

test('local keystore signer reports missing configuration when no file path is provided', () => {
  const result = resolveLocalKeystoreSigner({});

  assert.equal(result.status, 'missing-config');
  assert.equal(result.ready, false);
  assert.equal(result.configured, false);
  assert.deepEqual(result.missingSecrets, ['secretRef.path']);
  assert.equal(result.backendImplemented, true);
});

test('local keystore signer reports missing keystore files with resolved file metadata', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-local-keystore-missing-'));
  const filePath = path.join(dir, 'missing.json');
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const result = resolveLocalKeystoreSigner({
    secretRef: { path: filePath },
  });

  assert.equal(result.status, 'missing-keystore');
  assert.equal(result.ready, false);
  assert.equal(result.secretSource.path, filePath);
  assert.equal(result.secretSource.exists, false);
  assert.ok(result.missingSecrets.includes(filePath));
});

test('local keystore signer blocks files with unsafe permissions before decrypting', (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX file permission enforcement is unavailable on Windows.');
    return;
  }

  const filePath = createTempKeystore(t, { mode: 0o644 });

  const result = resolveLocalKeystoreSigner({
    secretRef: { path: filePath },
    password: FIXTURE_PASSWORD,
  });

  assert.equal(result.status, 'error');
  assert.equal(result.ready, false);
  assert.equal(result.signerReady, false);
  assert.equal(result.secretSource.path, filePath);
  assert.equal(result.secretSource.exists, true);
  assert.ok(result.notes.some((note) => note.includes('permissions')));
});

test('local keystore signer reports locked keystores when no password source is available', (t) => {
  const filePath = createTempKeystore(t);

  const result = resolveLocalKeystoreSigner({
    secretRef: {
      path: filePath,
      passwordEnv: 'PANDORA_KEYSTORE_PASSWORD',
    },
    env: {},
  });

  assert.equal(result.status, 'missing-secrets');
  assert.equal(result.ready, false);
  assert.ok(result.missingSecrets.includes('PANDORA_KEYSTORE_PASSWORD'));
  assert.equal(result.secretSource.path, filePath);
  assert.equal(result.secretSource.exists, true);
});

test('local keystore signer reports degraded missing-context state after unlocking the keystore', (t) => {
  const filePath = createTempKeystore(t);

  const result = resolveLocalKeystoreSigner({
    secretRef: { path: filePath },
    password: FIXTURE_PASSWORD,
  });

  assert.equal(result.status, 'missing-context');
  assert.equal(result.ready, false);
  assert.equal(result.signerReady, true);
  assert.equal(result.networkContextReady, false);
  assert.ok(result.notes.some((note) => note.includes('rpcUrl/chainId')));
});

test('local keystore signer reports invalid passwords as locked and malformed keystores as errors', (t) => {
  const filePath = createTempKeystore(t);

  const locked = resolveLocalKeystoreSigner({
    secretRef: { path: filePath },
    password: 'wrong-password',
  });

  assert.equal(locked.status, 'missing-secrets');
  assert.equal(locked.ready, false);
  assert.equal(locked.signerReady, false);
  assert.ok(locked.missingSecrets.includes('input.password'));
  assert.ok(locked.notes.some((note) => note.includes('locked')));

  const malformedPath = createTempKeystore(t, {
    content: JSON.stringify({ encrypted: true }, null, 2),
  });
  const malformed = resolveLocalKeystoreSigner({
    secretRef: { path: malformedPath },
    password: FIXTURE_PASSWORD,
  });

  assert.equal(malformed.status, 'error');
  assert.equal(malformed.ready, false);
  assert.equal(malformed.signerReady, false);
  assert.ok(malformed.notes.some((note) => note.includes('valid JSON wallet')));
});

test('local keystore signer decrypts a safe keystore and keeps secret material hidden by default', (t) => {
  const signer = createLocalKeystoreSigner();
  const filePath = createTempKeystore(t);

  const result = signer.resolve({
    secretRef: {
      path: filePath,
      passwordEnv: 'PANDORA_KEYSTORE_PASSWORD',
    },
    env: {
      PANDORA_KEYSTORE_PASSWORD: FIXTURE_PASSWORD,
      RPC_URL: 'https://rpc.example.invalid',
      CHAIN_ID: '1',
    },
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.ready, true);
  assert.equal(result.signerReady, true);
  assert.equal(result.wallet, FIXTURE_ACCOUNT.address.toLowerCase());
  assert.equal(result.secretMaterial, undefined);
});

test('local keystore signer can optionally expose decrypted secret material for later runtime handoff', (t) => {
  const filePath = createTempKeystore(t);

  const result = resolveLocalKeystoreSigner({
    secretRef: { path: filePath },
    password: FIXTURE_PASSWORD,
    rpcUrl: 'https://rpc.example.invalid',
    chainId: 1,
    includeSecretMaterial: true,
  });

  assert.equal(result.status, 'ready');
  assert.deepEqual(result.secretMaterial, {
    privateKey: FIXTURE_PRIVATE_KEY,
  });
});
