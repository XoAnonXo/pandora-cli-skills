const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  createTempDir,
  removeDir,
  runCli,
  runCliAsync,
} = require('../helpers/cli_runner.cjs');

const MARKET_ADDRESS = '0x6666666666666666666666666666666666666666';

function parseJsonOutput(result, label) {
  assert.equal(result.status, 0, `${label} exited non-zero.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const stdout = String(result.stdout || '').trim();
  assert.equal(String(result.stderr || '').trim(), '', `${label} wrote to stderr in JSON mode.`);
  return JSON.parse(stdout);
}

function parseJsonLines(stdout, label) {
  const lines = String(stdout || '')
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  assert.ok(lines.length > 0, `${label} produced no stdout.`);
  return lines.map((line) => JSON.parse(line));
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
  assert.match(payload.data.usage, /--follow/);
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

test('mirror logs parses structured JSONL entries while preserving raw text compatibility', () => {
  const tempHome = createTempDir('pandora-mirror-logs-jsonl-');
  const strategyHash = '1111111111111111';
  const logFile = path.join(tempHome, '.pandora', 'mirror', 'logs', `${strategyHash}.log`);

  try {
    writeFile(
      logFile,
      [
        JSON.stringify({
          event: 'mirror.sync.tick',
          timestamp: '2026-03-09T00:00:00.000Z',
          tick: 1,
          driftBps: 14,
        }),
        'legacy plain text',
        JSON.stringify({
          ok: true,
          command: 'mirror.sync',
          data: {
            generatedAt: '2026-03-09T00:00:02.000Z',
          },
        }),
        '',
      ].join('\n'),
    );
    writeMirrorDaemon(tempHome, {
      strategyHash,
      logFile,
      polymarketMarketId: 'poly-jsonl',
    });

    const result = runCli(
      ['--output', 'json', 'mirror', 'logs', '--strategy-hash', strategyHash, '--lines', '3'],
      { env: { HOME: tempHome } },
    );
    const payload = parseJsonOutput(result, 'mirror logs structured jsonl');

    assert.equal(payload.command, 'mirror.logs');
    assert.equal(payload.data.log.format, 'mixed');
    assert.equal(payload.data.log.structuredEntryCount, 2);
    assert.equal(payload.data.log.textEntryCount, 1);
    assert.equal(payload.data.log.entries[0].structured, true);
    assert.equal(payload.data.log.entries[0].event, 'mirror.sync.tick');
    assert.equal(payload.data.log.entries[0].timestamp, '2026-03-09T00:00:00.000Z');
    assert.equal(payload.data.log.entries[0].text.includes('"mirror.sync.tick"'), true);
    assert.equal(payload.data.log.entries[1].structured, false);
    assert.equal(payload.data.log.entries[1].text, 'legacy plain text');
    assert.equal(payload.data.log.entries[2].structured, true);
    assert.equal(payload.data.log.entries[2].event, 'mirror.sync');
    assert.equal(payload.data.log.entries[2].timestamp, '2026-03-09T00:00:02.000Z');
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

test('mirror logs --follow streams appended entries and exits on timeout', async () => {
  const tempHome = createTempDir('pandora-mirror-logs-follow-');
  const strategyHash = 'dddddddddddddddd';
  const logFile = path.join(tempHome, '.pandora', 'mirror', 'logs', `${strategyHash}.log`);

  try {
    writeFile(
      logFile,
      `${JSON.stringify({ event: 'mirror.sync.tick', timestamp: '2026-03-09T00:00:00.000Z', tick: 1 })}\n`,
    );
    writeMirrorDaemon(tempHome, {
      strategyHash,
      logFile,
      polymarketMarketId: 'poly-follow',
    });

    const followPromise = runCliAsync(
      [
        '--output',
        'json',
        'mirror',
        'logs',
        '--strategy-hash',
        strategyHash,
        '--lines',
        '1',
        '--follow',
        '--poll-interval-ms',
        '25',
        '--follow-timeout-ms',
        '250',
      ],
      { env: { HOME: tempHome }, timeoutMs: 1500 },
    );

    await new Promise((resolve) => setTimeout(resolve, 80));
    fs.appendFileSync(
      logFile,
      `${JSON.stringify({ event: 'mirror.sync.tick', timestamp: '2026-03-09T00:00:01.000Z', tick: 2, driftBps: 9 })}\n`,
    );

    const result = await followPromise;
    assert.equal(result.status, 0, `mirror logs --follow exited non-zero.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.equal(result.timedOut, false);
    assert.equal(String(result.stderr || '').trim(), '', 'mirror logs --follow wrote to stderr in JSON mode.');

    const lines = parseJsonLines(result.stdout, 'mirror logs --follow');
    assert.equal(lines[0].command, 'mirror.logs.follow');
    assert.equal(lines[0].data.follow.active, true);
    assert.equal(lines[0].data.log.entries.length, 1);

    const streamedEntry = lines.find((item) => item.command === 'mirror.logs.entry');
    assert.ok(streamedEntry, 'expected a streamed follow entry.');
    assert.equal(streamedEntry.data.entry.lineNumber, 2);
    assert.equal(streamedEntry.data.entry.structured, true);
    assert.equal(streamedEntry.data.entry.event, 'mirror.sync.tick');
    assert.equal(streamedEntry.data.entry.data.tick, 2);

    const completion = lines[lines.length - 1];
    assert.equal(completion.command, 'mirror.logs.follow.complete');
    assert.equal(completion.data.reason, 'timeout');
    assert.equal(completion.data.lastSeenLine >= 2, true);
  } finally {
    removeDir(tempHome);
  }
});
