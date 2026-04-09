const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  daemonStatus,
  stopDaemon,
} = require('../../cli/lib/mirror_hedge_daemon_service.cjs');
const {
  createTempDir,
  removeDir,
} = require('../helpers/cli_runner.cjs');

function writePidFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

test('mirror hedge daemonStatus keeps legacy pidfiles running when pid is alive and identity metadata is absent', () => {
  const tempHome = createTempDir('pandora-mirror-hedge-daemon-legacy-');
  const pidFile = path.join(tempHome, 'daemon.json');
  try {
    writePidFile(pidFile, {
      schemaVersion: '1.0.0',
      strategyHash: 'abc123abc123abc1',
      pid: process.pid,
      startedAt: new Date().toISOString(),
      checkedAt: new Date().toISOString(),
      status: 'running',
    });
    const payload = daemonStatus({ pidFile });
    assert.equal(payload.found, true);
    assert.equal(payload.alive, true);
    assert.equal(payload.status, 'running');
    assert.equal(payload.rawPidAlive, true);
    assert.equal(payload.pidOwnerMismatch, false);
  } finally {
    removeDir(tempHome);
  }
});

test('mirror hedge daemonStatus marks pidfiles stale when live pid command does not match daemon identity metadata', () => {
  const tempHome = createTempDir('pandora-mirror-hedge-daemon-stale-');
  const pidFile = path.join(tempHome, 'daemon.json');
  try {
    writePidFile(pidFile, {
      schemaVersion: '1.0.0',
      strategyHash: 'feedfacecafebeef',
      pid: process.pid,
      startedAt: new Date().toISOString(),
      checkedAt: new Date().toISOString(),
      status: 'running',
      cliPath: '/tmp/pandora.cjs',
      cliArgs: [
        'mirror',
        'hedge',
        'run',
        '--strategy-hash',
        'feedfacecafebeef',
        '--pid-file',
        pidFile,
      ],
      launchCommand: `node /tmp/pandora.cjs mirror hedge run --strategy-hash feedfacecafebeef --pid-file ${pidFile}`,
    });
    const payload = daemonStatus({ pidFile });
    assert.equal(payload.found, true);
    assert.equal(payload.alive, false);
    assert.equal(payload.rawPidAlive, true);
    assert.equal(payload.pidOwnerMismatch, true);
    assert.equal(payload.status, 'stale-pidfile');
  } finally {
    removeDir(tempHome);
  }
});

test('mirror hedge stopDaemon refuses to signal a stale pidfile process when pid ownership is mismatched', async () => {
  const tempHome = createTempDir('pandora-mirror-hedge-daemon-stop-stale-');
  const pidFile = path.join(tempHome, 'daemon.json');
  const originalKill = process.kill;
  const observedSignals = [];
  try {
    writePidFile(pidFile, {
      schemaVersion: '1.0.0',
      strategyHash: 'deadbeefdeadbeef',
      pid: process.pid,
      startedAt: new Date().toISOString(),
      checkedAt: new Date().toISOString(),
      status: 'running',
      cliPath: '/tmp/pandora.cjs',
      cliArgs: [
        'mirror',
        'hedge',
        'run',
        '--strategy-hash',
        'deadbeefdeadbeef',
        '--pid-file',
        pidFile,
      ],
      launchCommand: `node /tmp/pandora.cjs mirror hedge run --strategy-hash deadbeefdeadbeef --pid-file ${pidFile}`,
    });

    process.kill = (pid, signal) => {
      observedSignals.push(signal === undefined ? 0 : signal);
      if (signal === 0 || signal === undefined) {
        if (Number(pid) === process.pid) return true;
        const err = new Error('No such process');
        err.code = 'ESRCH';
        throw err;
      }
      throw new Error(`Unexpected signal invocation: ${String(signal)}`);
    };

    const payload = await stopDaemon({ pidFile });
    assert.equal(payload.pidOwnerMismatch, true);
    assert.equal(payload.signalSent, false);
    assert.equal(payload.forceKilled, false);
    assert.equal(payload.status, 'stale-pidfile');
    assert.equal(observedSignals.includes('SIGTERM'), false);
    assert.equal(observedSignals.includes('SIGKILL'), false);
  } finally {
    process.kill = originalKill;
    removeDir(tempHome);
  }
});

test('mirror hedge daemonStatus reports structured details for invalid strategy hashes', () => {
  assert.throws(
    () => daemonStatus({ strategyHash: 'not-a-hash' }),
    (error) => {
      assert.equal(error.code, 'INVALID_FLAG_VALUE');
      assert.match(error.message, /16-character hex value/i);
      assert.deepEqual(error.details, {
        flag: '--strategy-hash',
        receivedValue: 'not-a-hash',
        expectedFormat: '16-character lowercase hex value',
      });
      return true;
    },
  );
});

test('mirror hedge stopDaemon reports structured selector requirements when no pid selector is provided', async () => {
  await assert.rejects(
    () => stopDaemon({}),
    (error) => {
      assert.equal(error.code, 'MISSING_REQUIRED_FLAG');
      assert.match(error.message, /requires --pid-file <path> or --strategy-hash <hash>/i);
      assert.deepEqual(error.details, {
        requiresOneOf: ['--pid-file <path>', '--strategy-hash <hash>'],
        operation: 'mirror hedge daemon lifecycle',
      });
      return true;
    },
  );
});
