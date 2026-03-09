const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createTempDir, removeDir, runCli } = require('../helpers/cli_runner.cjs');

function buildMarketsMinePayload() {
  return {
    schemaVersion: '1.0.0',
    generatedAt: '2030-01-01T00:00:00.000Z',
    mode: 'read',
    wallet: '0x4444444444444444444444444444444444444444',
    walletSource: 'private-key',
    chainId: 1,
    indexerUrl: 'https://indexer.test',
    runtime: {
      rpcUrl: 'https://rpc.test',
      signerResolved: true,
    },
    sources: {
      positions: { count: 1 },
      lpPositions: { count: 1 },
      claims: { candidateCount: 1, successCount: 1, failureCount: 0 },
    },
    count: 1,
    exposureCounts: {
      token: 1,
      lp: 1,
      claimable: 1,
    },
    items: [
      {
        marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        chainId: 1,
        pollAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        question: 'Will deterministic tests pass?',
        marketType: 'amm',
        marketCloseTimestamp: '1893456000',
        exposureTypes: ['token', 'lp', 'claimable'],
        hasTokenExposure: true,
        hasLpExposure: true,
        hasClaimableExposure: true,
        exposure: {
          token: {
            yesBalance: 12.5,
            noBalance: 3.25,
          },
          lp: {
            lpTokenBalance: '7.5',
          },
          claimable: {
            estimatedClaimUsdc: '42',
          },
        },
        diagnostics: [],
      },
    ],
    diagnostics: ['Claimable exposure inferred from claim-all preview.'],
  };
}

function buildMarketsMinePreloadFile(tempDir) {
  const preloadPath = path.join(tempDir, 'markets-mine-preload.cjs');
  fs.writeFileSync(
    preloadPath,
    `
const fs = require('fs');
const path = require('path');
const Module = require('module');

const originalLoad = Module._load;
const targetPath = path.resolve(process.cwd(), 'cli/lib/markets_mine_service.cjs');

Module._load = function patchedLoad(request, parent, isMain) {
  const resolved = Module._resolveFilename(request, parent, isMain);
  if (resolved === targetPath) {
    return {
      discoverOwnedMarkets: async (options) => {
        const captureFile = process.env.MARKETS_MINE_CAPTURE_FILE;
        if (captureFile) {
          fs.writeFileSync(captureFile, JSON.stringify(options));
        }
        return JSON.parse(process.env.MARKETS_MINE_STUB_PAYLOAD || '{}');
      },
    };
  }
  return originalLoad.apply(this, arguments);
};
`,
  );
  return preloadPath;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('markets mine uses env signer fallback for machine-readable json output', () => {
  const tempDir = createTempDir('markets-mine-command-');
  const captureFile = path.join(tempDir, 'captured-options.json');
  const preloadFile = buildMarketsMinePreloadFile(tempDir);

  try {
    const result = runCli(
      ['--output', 'json', 'markets', 'mine', '--skip-dotenv'],
      {
        env: {
          NODE_OPTIONS: `--require=${preloadFile}`,
          MARKETS_MINE_CAPTURE_FILE: captureFile,
          MARKETS_MINE_STUB_PAYLOAD: JSON.stringify(buildMarketsMinePayload()),
          PANDORA_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
        },
      },
    );

    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'markets.mine');
    assert.equal(payload.data.wallet, '0x4444444444444444444444444444444444444444');
    assert.equal(payload.data.items[0].exposure.token.yesBalance, 12.5);

    const capturedOptions = readJson(captureFile);
    assert.equal(capturedOptions.privateKey, `0x${'1'.repeat(64)}`);
    assert.equal(capturedOptions.wallet, null);
  } finally {
    removeDir(tempDir);
  }
});

test('markets mine table output shows token, LP, and claimable exposure columns', () => {
  const tempDir = createTempDir('markets-mine-command-');
  const preloadFile = buildMarketsMinePreloadFile(tempDir);

  try {
    const result = runCli(
      ['markets', 'mine', '--skip-dotenv', '--wallet', '0x4444444444444444444444444444444444444444'],
      {
        env: {
          NODE_OPTIONS: `--require=${preloadFile}`,
          MARKETS_MINE_STUB_PAYLOAD: JSON.stringify(buildMarketsMinePayload()),
        },
      },
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /wallet/i);
    assert.match(result.stdout, /tokenMarkets/i);
    assert.match(result.stdout, /0xaaaaaaaaaaaaa\.\.\./i);
    assert.match(result.stdout, /token,lp,claimable/i);
    assert.match(result.stdout, /12\.5/);
    assert.match(result.stdout, /3\.25/);
    assert.match(result.stdout, /7\.5/);
    assert.match(result.stdout, /42/);
    assert.match(result.stdout, /Will deterministic tests pass\?/i);
  } finally {
    removeDir(tempDir);
  }
});
