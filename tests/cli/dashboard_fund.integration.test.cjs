const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  createTempDir,
  removeDir,
  runCli,
} = require('../helpers/cli_runner.cjs');

function parseJsonOutput(result, label) {
  assert.equal(result.status, 0, `${label} exited non-zero.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const stdout = String(result.stdout || '').trim();
  assert.equal(String(result.stderr || '').trim(), '', `${label} wrote to stderr in JSON mode.`);
  return JSON.parse(stdout);
}

test('dashboard top-level command scans local mirror states without live lookup', async () => {
  const tempHome = createTempDir('pandora-dashboard-');
  try {
    const mirrorDir = path.join(tempHome, '.pandora', 'mirror');
    fs.mkdirSync(mirrorDir, { recursive: true });
    fs.writeFileSync(
      path.join(mirrorDir, 'alpha.json'),
      JSON.stringify({
        strategyHash: 'alpha',
        pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        polymarketMarketId: 'poly-alpha',
        polymarketSlug: 'alpha',
        alerts: [],
      }, null, 2),
    );

    const result = runCli(
      ['--output', 'json', 'dashboard', '--no-live'],
      {
        env: {
          HOME: tempHome,
        },
      },
    );
    const payload = parseJsonOutput(result, 'dashboard --no-live');

    assert.equal(payload.command, 'dashboard');
    assert.equal(payload.data.summary.marketCount, 1);
    assert.equal(payload.data.summary.liveCount, 0);
    assert.deepEqual(
      payload.data.suggestedNextCommands,
      [
        'pandora mirror status --strategy-hash alpha',
        'pandora mirror sync status --strategy-hash alpha',
      ],
    );
  } finally {
    removeDir(tempHome);
  }
});

test('fund-check top-level help advertises wallet shortfall guidance', async () => {
  const result = runCli(['--output', 'json', 'fund-check', '--help']);
  const payload = parseJsonOutput(result, 'fund-check --help');

  assert.equal(payload.command, 'fund-check.help');
  assert.match(payload.data.usage, /pandora \[--output table\|json\] fund-check/);
  assert.match(payload.data.notes[0], /estimates immediate hedge funding needs/i);
});

test('dashboard top-level table help renders usage instead of generic done output', async () => {
  const result = runCli(['dashboard', '--help']);

  assert.equal(result.status, 0, result.output);
  assert.match(String(result.stdout || ''), /Usage: pandora \[--output table\|json\] dashboard/);
  assert.match(String(result.stdout || ''), /--watch/);
  assert.match(String(result.stdout || ''), /--wallet <address>/);
  assert.match(String(result.stdout || ''), /dashboard summarizes discovered mirror markets/i);
  assert.doesNotMatch(String(result.stdout || ''), /^Done\.\s*$/m);
});
