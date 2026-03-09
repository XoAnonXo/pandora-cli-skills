const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  createTempDir,
  removeDir,
  runCli,
} = require('../helpers/cli_runner.cjs');

const MARKET_ADDRESS = '0x7777777777777777777777777777777777777777';

function parseJsonOutput(result, label) {
  assert.equal(result.status, 0, `${label} exited non-zero.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const stdout = String(result.stdout || '').trim();
  assert.equal(String(result.stderr || '').trim(), '', `${label} wrote to stderr in JSON mode.`);
  return JSON.parse(stdout);
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writeMirrorDaemon(tempHome, {
  strategyHash,
  pandoraMarketAddress = MARKET_ADDRESS,
  polymarketMarketId = null,
  polymarketSlug = null,
  stateFile = null,
  logFile = null,
  pid = process.pid,
  pidAlive = true,
  status = pidAlive ? 'running' : 'stopped',
}) {
  const pidFile = path.join(tempHome, '.pandora', 'mirror', 'daemon', `${strategyHash}.json`);
  writeFile(
    pidFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        pid,
        pidAlive,
        status,
        checkedAt: '2026-03-09T00:00:00.000Z',
        startedAt: '2026-03-08T23:59:00.000Z',
        pandoraMarketAddress,
        polymarketMarketId,
        polymarketSlug,
        stateFile,
        logFile,
      },
      null,
      2,
    ),
  );
  return pidFile;
}

test('mirror health resolves by market selector and exposes running daemon telemetry', () => {
  const tempHome = createTempDir('pandora-mirror-health-');
  const strategyHash = 'c0ffee00decafbad';
  const stateFile = path.join(tempHome, 'mirror', 'state.json');

  try {
    writeFile(
      stateFile,
      JSON.stringify(
        {
          schemaVersion: '1.0.0',
          strategyHash,
          pandoraMarketAddress: MARKET_ADDRESS,
          polymarketMarketId: 'poly-health',
          lastTickAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    writeMirrorDaemon(tempHome, {
      strategyHash,
      stateFile,
      polymarketMarketId: 'poly-health',
      pid: process.pid,
      pidAlive: true,
    });

    const payload = parseJsonOutput(
      runCli(
        [
          '--output',
          'json',
          'mirror',
          'health',
          '--market-address',
          MARKET_ADDRESS,
          '--polymarket-market-id',
          'poly-health',
        ],
        { env: { HOME: tempHome } },
      ),
      'mirror health --market-address',
    );

    assert.equal(payload.command, 'mirror.health');
    assert.equal(payload.data.strategyHash, strategyHash);
    assert.equal(payload.data.selector.pandoraMarketAddress, MARKET_ADDRESS.toLowerCase());
    assert.equal(payload.data.selector.polymarketMarketId, 'poly-health');
    assert.equal(payload.data.healthy, true);
    assert.equal(payload.data.summary.daemonFound, true);
    assert.equal(payload.data.summary.daemonAlive, true);
    assert.equal(payload.data.runtime.daemon.status, 'running');
    assert.equal(payload.data.runtime.daemon.stateFile, stateFile);
  } finally {
    removeDir(tempHome);
  }
});

test('mirror panic by market selector engages risk panic, writes stop files, and reports daemon-stop metadata', () => {
  const tempHome = createTempDir('pandora-mirror-panic-');
  const strategyHash = 'badc0ffee0ddf00d';

  try {
    writeMirrorDaemon(tempHome, {
      strategyHash,
      polymarketMarketId: 'poly-panic',
      pid: 999999,
      pidAlive: false,
      status: 'stopped',
    });

    const payload = parseJsonOutput(
      runCli(
        [
          '--output',
          'json',
          'mirror',
          'panic',
          '--market-address',
          MARKET_ADDRESS,
          '--reason',
          'integration test',
          '--actor',
          'qa',
        ],
        { env: { HOME: tempHome } },
      ),
      'mirror panic --market-address',
    );

    assert.equal(payload.command, 'mirror.panic');
    assert.equal(payload.data.action, 'engage');
    assert.equal(payload.data.status, 'engaged');
    assert.equal(payload.data.selector.scope, 'market');
    assert.equal(payload.data.selector.marketAddress, MARKET_ADDRESS.toLowerCase());
    assert.equal(payload.data.risk.kill_switch, true);
    assert.equal(payload.data.risk.metadata.reason, 'integration test');
    assert.equal(Array.isArray(payload.data.stopFiles.written), true);
    assert.ok(payload.data.stopFiles.written.length >= 1);
    assert.equal(fs.existsSync(payload.data.stopFiles.written[0]), true);
    assert.equal(payload.data.daemonStop.items[0].result.status, 'stopped');
    assert.equal(payload.data.daemonStop.items[0].result.wasAlive, false);
  } finally {
    removeDir(tempHome);
  }
});

test('mirror health selector disambiguates daemons that share a Pandora market by Polymarket selector', () => {
  const tempHome = createTempDir('pandora-mirror-health-selector-');
  const firstHash = '1111111111111111';
  const secondHash = '2222222222222222';

  try {
    writeMirrorDaemon(tempHome, {
      strategyHash: firstHash,
      polymarketMarketId: 'poly-a',
      polymarketSlug: 'slug-a',
      pid: process.pid,
      pidAlive: true,
    });
    writeMirrorDaemon(tempHome, {
      strategyHash: secondHash,
      polymarketMarketId: 'poly-b',
      polymarketSlug: 'slug-b',
      pid: process.pid,
      pidAlive: true,
    });

    const payload = parseJsonOutput(
      runCli(
        [
          '--output',
          'json',
          'mirror',
          'health',
          '--market-address',
          MARKET_ADDRESS,
          '--polymarket-market-id',
          'poly-b',
        ],
        { env: { HOME: tempHome } },
      ),
      'mirror health selector disambiguation',
    );

    assert.equal(payload.command, 'mirror.health');
    assert.equal(payload.data.strategyHash, secondHash);
    assert.equal(payload.data.selector.polymarketMarketId, 'poly-b');
    assert.equal(payload.data.runtime.daemon.pidFile.endsWith(`${secondHash}.json`), true);
  } finally {
    removeDir(tempHome);
  }
});
