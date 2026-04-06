const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createDoctorService } = require('../../cli/lib/doctor_service.cjs');

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createDoctor() {
  return createDoctorService({
    CliError,
    loadEnvFile: () => {},
    runPolymarketCheck: async () => ({ ok: true }),
    isValidPrivateKey: (value) => /^0x[a-fA-F0-9]{64}$/.test(String(value || '')),
    isValidAddress: (value) => /^0x[a-fA-F0-9]{40}$/.test(String(value || '')),
    isSecureHttpUrlOrLocal: (value) => /^https?:\/\//.test(String(value || '')),
  });
}

function installRpcMock(codeByAddress = {}) {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body || '{}');
    if (body.method === 'eth_chainId') {
      return {
        ok: true,
        status: 200,
        async json() {
          return { result: '0x1' };
        },
      };
    }
    if (body.method === 'eth_getCode') {
      const address = String(body.params && body.params[0] || '').toLowerCase();
      return {
        ok: true,
        status: 200,
        async json() {
          return { result: codeByAddress[address] || '0x' };
        },
      };
    }
    throw new Error(`Unexpected rpc method: ${body.method}`);
  };
  return () => {
    global.fetch = originalFetch;
  };
}

test('doctor keeps paper-mirror signer-light and source-optional', async () => {
  const restoreFetch = installRpcMock({
    '0x259308e7d8557e4ba192de1ab8cf7e0e21896442': '0x6001600101',
    '0xab120f1fd31fb1ec39893b75d80a3822b1cd8d0c': '0x6002600202',
  });
  const doctor = createDoctor();

  try {
    const report = await doctor.buildDoctorReport({
      goal: 'paper-mirror',
      envFile: '.env',
      useEnvFile: false,
      env: {
        CHAIN_ID: '1',
        RPC_URL: 'https://rpc.example.org',
        ORACLE: '0x259308E7d8557e4Ba192De1aB8Cf7e0E21896442',
        FACTORY: '0xaB120F1FD31FB1EC39893B75d80a3822b1Cd8d0c',
        USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      },
      rpcTimeoutMs: 1_000,
    });

    assert.equal(report.goal, 'paper-mirror');
    assert.equal(report.summary.ok, true);
    assert.equal(report.journeyReadiness.status, 'ready');
    assert.equal(report.journeyReadiness.missing.includes('PANDORA_RESOLUTION_SOURCES'), false);
  } finally {
    restoreFetch();
  }
});

test('doctor keeps hosted-gateway read-only and signer-free', async () => {
  const restoreFetch = installRpcMock();
  const doctor = createDoctor();

  try {
    const report = await doctor.buildDoctorReport({
      goal: 'hosted-gateway',
      envFile: '.env',
      useEnvFile: false,
      env: {
        CHAIN_ID: '1',
        RPC_URL: 'https://rpc.example.org',
      },
      rpcTimeoutMs: 1_000,
    });

    assert.equal(report.goal, 'hosted-gateway');
    assert.equal(report.summary.ok, true);
    assert.deepEqual(report.env.required.missing, []);
    assert.equal(report.journeyReadiness.status, 'ready');
  } finally {
    restoreFetch();
  }
});

test('doctor keeps paper hedge mode daemon-oriented and source-free', async () => {
  const tempDir = createTempDir('pandora-doctor-goal-regressions-');
  const walletFile = path.join(tempDir, 'internal-wallets.txt');
  fs.writeFileSync(walletFile, '0x1111111111111111111111111111111111111111\n');

  const restoreFetch = installRpcMock({
    '0x259308e7d8557e4ba192de1ab8cf7e0e21896442': '0x6001600101',
    '0xab120f1fd31fb1ec39893b75d80a3822b1cd8d0c': '0x6002600202',
  });
  const doctor = createDoctor();

  try {
    const report = await doctor.buildDoctorReport({
      goal: 'paper-hedge-daemon',
      envFile: '.env',
      useEnvFile: false,
      env: {
        CHAIN_ID: '1',
        RPC_URL: 'https://rpc.example.org',
        ORACLE: '0x259308E7d8557e4Ba192De1aB8Cf7e0E21896442',
        FACTORY: '0xaB120F1FD31FB1EC39893B75d80a3822b1Cd8d0c',
        USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        PANDORA_INTERNAL_WALLETS_FILE: walletFile,
      },
      rpcTimeoutMs: 1_000,
    });

    assert.equal(report.goal, 'paper-hedge-daemon');
    assert.equal(report.summary.ok, true);
    assert.equal(report.journeyReadiness.missing.includes('PANDORA_RESOLUTION_SOURCES'), false);
    assert.equal(report.journeyReadiness.recommendations.some((step) => /mirror hedge/i.test(String(step))), true);
  } finally {
    restoreFetch();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
