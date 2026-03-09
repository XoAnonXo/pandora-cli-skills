const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  createTempDir,
  removeDir,
  runCli,
} = require('../helpers/cli_runner.cjs');

const MARKET_ADDRESS = '0x6666666666666666666666666666666666666666';

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
}) {
  const pidFile = path.join(tempHome, '.pandora', 'mirror', 'daemon', `${strategyHash}.json`);
  writeFile(
    pidFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        pid: process.pid,
        pidAlive: true,
        status: 'running',
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

test('mirror logs --help advertises selector-first lookup and tail sizing', () => {
  const result = runCli(['--output', 'json', 'mirror', 'logs', '--help']);
  const payload = parseJsonOutput(result, 'mirror logs --help');

  assert.equal(payload.command, 'mirror.logs.help');
  assert.match(payload.data.usage, /mirror logs/);
  assert.match(payload.data.usage, /--strategy-hash <hash>/);
  assert.match(payload.data.usage, /--state-file <path>/);
  assert.match(payload.data.usage, /--market-address <address>/);
  assert.match(payload.data.usage, /--lines <n>/);
  assert.equal(Array.isArray(payload.data.notes), true);
});

test('mirror logs resolves a custom state file and returns tailed log entries', () => {
  const tempHome = createTempDir('pandora-mirror-logs-state-');
  const strategyHash = 'feedfacecafebeef';
  const stateFile = path.join(tempHome, 'mirror', 'custom-state.json');
  const logFile = path.join(tempHome, '.pandora', 'mirror', 'logs', `${strategyHash}.log`);

  try {
    writeFile(
      stateFile,
      JSON.stringify(
        {
          schemaVersion: '1.0.0',
          strategyHash,
          pandoraMarketAddress: MARKET_ADDRESS,
          polymarketMarketId: 'poly-state',
        },
        null,
        2,
      ),
    );
    writeFile(logFile, 'first line\nsecond line\nthird line\n');
    writeMirrorDaemon(tempHome, {
      strategyHash,
      stateFile,
      logFile,
      polymarketMarketId: 'poly-state',
    });

    const result = runCli(
      ['--output', 'json', 'mirror', 'logs', '--state-file', stateFile, '--lines', '2'],
      { env: { HOME: tempHome } },
    );
    const payload = parseJsonOutput(result, 'mirror logs --state-file');

    assert.equal(payload.command, 'mirror.logs');
    assert.equal(payload.data.strategyHash, strategyHash);
    assert.equal(payload.data.stateFile, stateFile);
    assert.equal(payload.data.resolution.matchedBy, 'state-file');
    assert.equal(payload.data.resolution.stateResolved, true);
    assert.equal(payload.data.runtime.daemon.logFile, logFile);
    assert.equal(payload.data.log.file, logFile);
    assert.equal(payload.data.log.exists, true);
    assert.equal(payload.data.log.returnedLines, 2);
    assert.deepEqual(
      payload.data.log.entries.map((entry) => entry.text),
      ['second line', 'third line'],
    );
  } finally {
    removeDir(tempHome);
  }
});

test('mirror logs resolves by strategy hash even when no state file exists', () => {
  const tempHome = createTempDir('pandora-mirror-logs-hash-');
  const strategyHash = 'deadbeefcafefeed';
  const logFile = path.join(tempHome, '.pandora', 'mirror', 'logs', `${strategyHash}.log`);

  try {
    writeFile(logFile, 'alpha\nbeta\ngamma\n');
    writeMirrorDaemon(tempHome, {
      strategyHash,
      logFile,
      polymarketMarketId: 'poly-hash',
    });

    const result = runCli(
      ['--output', 'json', 'mirror', 'logs', '--strategy-hash', strategyHash, '--lines', '2'],
      { env: { HOME: tempHome } },
    );
    const payload = parseJsonOutput(result, 'mirror logs --strategy-hash');

    assert.equal(payload.command, 'mirror.logs');
    assert.equal(payload.data.strategyHash, strategyHash);
    assert.equal(payload.data.resolution.matchedBy, 'strategy-hash');
    assert.equal(payload.data.resolution.stateResolved, false);
    assert.equal(payload.data.runtime.daemon.found, true);
    assert.equal(payload.data.log.file, logFile);
    assert.deepEqual(
      payload.data.log.entries.map((entry) => entry.text),
      ['beta', 'gamma'],
    );
  } finally {
    removeDir(tempHome);
  }
});

test('mirror logs market selector narrows to the requested Polymarket market when multiple daemons share a Pandora market', () => {
  const tempHome = createTempDir('pandora-mirror-logs-selector-');
  const firstHash = 'aaaaaaaaaaaaaaaa';
  const secondHash = 'bbbbbbbbbbbbbbbb';
  const firstLog = path.join(tempHome, '.pandora', 'mirror', 'logs', `${firstHash}.log`);
  const secondLog = path.join(tempHome, '.pandora', 'mirror', 'logs', `${secondHash}.log`);

  try {
    writeFile(firstLog, 'first daemon line\n');
    writeFile(secondLog, 'second daemon line\nselector match line\n');
    writeMirrorDaemon(tempHome, {
      strategyHash: firstHash,
      logFile: firstLog,
      polymarketMarketId: 'poly-a',
      polymarketSlug: 'slug-a',
    });
    writeMirrorDaemon(tempHome, {
      strategyHash: secondHash,
      logFile: secondLog,
      polymarketMarketId: 'poly-b',
      polymarketSlug: 'slug-b',
    });

    const result = runCli(
      [
        '--output',
        'json',
        'mirror',
        'logs',
        '--market-address',
        MARKET_ADDRESS,
        '--polymarket-market-id',
        'poly-b',
        '--lines',
        '2',
      ],
      { env: { HOME: tempHome } },
    );
    const payload = parseJsonOutput(result, 'mirror logs --market-address --polymarket-market-id');

    assert.equal(payload.command, 'mirror.logs');
    assert.equal(payload.data.resolution.matchedBy, 'market-selector');
    assert.equal(payload.data.strategyHash, secondHash);
    assert.equal(payload.data.runtime.daemon.pidFile.endsWith(`${secondHash}.json`), true);
    assert.equal(payload.data.log.file, secondLog);
    assert.deepEqual(
      payload.data.log.entries.map((entry) => entry.text),
      ['second daemon line', 'selector match line'],
    );
  } finally {
    removeDir(tempHome);
  }
});

test('mirror logs degrades cleanly when daemon metadata resolves but the log file is missing', () => {
  const tempHome = createTempDir('pandora-mirror-logs-missing-');
  const strategyHash = 'cccccccccccccccc';
  const missingLog = path.join(tempHome, '.pandora', 'mirror', 'logs', `${strategyHash}.log`);

  try {
    writeMirrorDaemon(tempHome, {
      strategyHash,
      logFile: missingLog,
      polymarketMarketId: 'poly-missing',
    });

    const result = runCli(
      ['--output', 'json', 'mirror', 'logs', '--strategy-hash', strategyHash, '--lines', '5'],
      { env: { HOME: tempHome } },
    );
    const payload = parseJsonOutput(result, 'mirror logs missing file');

    assert.equal(payload.command, 'mirror.logs');
    assert.equal(payload.data.log.exists, false);
    assert.equal(payload.data.log.returnedLines, 0);
    assert.equal(Array.isArray(payload.data.diagnostics), true);
    assert.ok(payload.data.diagnostics.some((item) => /log file/i.test(item)));
  } finally {
    removeDir(tempHome);
  }
});
