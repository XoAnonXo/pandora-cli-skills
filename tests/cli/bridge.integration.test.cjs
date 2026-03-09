const test = require('node:test');
const assert = require('node:assert/strict');

const { runCli } = require('../helpers/cli_runner.cjs');

function parseJsonOutput(result, label) {
  assert.equal(result.status, 0, `${label} exited non-zero.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const stdout = String(result.stdout || '').trim();
  assert.equal(String(result.stderr || '').trim(), '', `${label} wrote to stderr in JSON mode.`);
  return JSON.parse(stdout);
}

test('bridge top-level help advertises planner-only usage', async () => {
  const payload = parseJsonOutput(runCli(['--output', 'json', 'bridge', '--help']), 'bridge --help');

  assert.equal(payload.command, 'bridge.help');
  assert.match(payload.data.usage, /pandora \[--output table\|json\] bridge plan/);
  assert.match(payload.data.notes[0], /read-only/i);
});

test('bridge plan help documents target directions', async () => {
  const payload = parseJsonOutput(runCli(['--output', 'json', 'bridge', 'plan', '--help']), 'bridge plan --help');

  assert.equal(payload.command, 'bridge.plan.help');
  assert.match(payload.data.notes[0], /Ethereum USDC -> Polygon USDC\.e/i);
  assert.match(payload.data.notes[1], /Polygon USDC\.e -> Ethereum USDC/i);
});
