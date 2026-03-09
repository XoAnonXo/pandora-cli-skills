const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');

const { CLI_PATH, REPO_ROOT, runCli, withChildEnv } = require('../helpers/cli_runner.cjs');
const { assertSchemaValid } = require('../helpers/json_schema_assert.cjs');

function runCliWithStdin(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: options.cwd || REPO_ROOT,
      env: withChildEnv(options.env, options.unsetEnvKeys),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timeoutHit = false;
    const timeoutMs = options.timeoutMs || 20_000;
    const timeout = setTimeout(() => {
      timeoutHit = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        status: 1,
        stdout,
        stderr,
        output: `${stdout}${stderr}`,
        error,
        timedOut: false,
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({
        status: code === null ? 1 : code,
        signal,
        stdout,
        stderr,
        output: `${stdout}${stderr}`,
        error: undefined,
        timedOut: timeoutHit,
      });
    });

    if (typeof options.stdin === 'string') {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
}

function parseJsonOutput(result, label = 'cli command') {
  assert.equal(result.stderr, '', `${label} wrote to stderr:\n${result.stderr}`);
  assert.notEqual(String(result.stdout || '').trim(), '', `${label} returned empty stdout`);
  return JSON.parse(String(result.stdout || '').trim());
}

test('explain --help returns a structured usage payload with stdin composition guidance', () => {
  const result = runCli(['--output', 'json', 'explain', '--help']);
  assert.equal(result.status, 0, result.output || result.stderr);
  const payload = parseJsonOutput(result, 'explain --help');

  assert.equal(payload.command, 'explain.help');
  assert.match(payload.data.usage, /pandora \[--output table\|json\] explain/);
  assert.ok(payload.data.notes.some((note) => /--stdin/.test(note) && /failure envelope/i.test(note)));
  assert.ok(payload.data.notes.some((note) => /canonical/i.test(note) && /--code/.test(note)));
});

test('explain returns machine-usable remediation for a known error code over the CLI', () => {
  const schemaEnvelope = parseJsonOutput(runCli(['--output', 'json', 'schema']), 'schema');
  const result = runCli(['--output', 'json', 'explain', 'RISK_PANIC_ACTIVE']);
  assert.equal(result.status, 0, result.output || result.stderr);
  const payload = parseJsonOutput(result, 'explain json');

  assert.equal(payload.command, 'explain');
  assert.equal(payload.data.error.code, 'RISK_PANIC_ACTIVE');
  assert.equal(payload.data.explanation.category, 'risk');
  assert.equal(payload.data.explanation.recovery.command, 'pandora risk show');
  assert.ok(payload.data.nextCommands.some((item) => item.command === 'pandora risk show'));
  assertSchemaValid(schemaEnvelope.data, { $ref: '#/definitions/ExplainPayload' }, payload.data, 'explain');
});

test('explain accepts lowercase positional error codes the same way as --code', () => {
  const positional = runCli(['--output', 'json', 'explain', 'risk_panic_active']);
  assert.equal(positional.status, 0, positional.output || positional.stderr);
  const positionalPayload = parseJsonOutput(positional, 'explain lowercase positional');

  const flagged = runCli(['--output', 'json', 'explain', '--code', 'risk_panic_active']);
  assert.equal(flagged.status, 0, flagged.output || flagged.stderr);
  const flaggedPayload = parseJsonOutput(flagged, 'explain lowercase --code');

  assert.equal(positionalPayload.data.input.format, 'error-code');
  assert.equal(positionalPayload.data.explanation.category, flaggedPayload.data.explanation.category);
  assert.equal(positionalPayload.data.explanation.recovery.command, flaggedPayload.data.explanation.recovery.command);
});

test('explain --stdin consumes a real Pandora failure envelope and emits canonical next commands', async () => {
  const failure = runCli(['--output', 'json', 'risk', 'bogus']);
  assert.equal(failure.status, 1, failure.output || failure.stderr);
  const failureEnvelope = parseJsonOutput(failure, 'risk bogus failure');
  assert.equal(failureEnvelope.error.code, 'INVALID_ARGS');

  const explained = await runCliWithStdin(['--output', 'json', 'explain', '--stdin'], {
    stdin: failure.stdout,
  });
  assert.equal(explained.status, 0, explained.output || explained.stderr);
  const payload = parseJsonOutput(explained, 'explain stdin');

  assert.equal(payload.command, 'explain');
  assert.equal(payload.data.input.source, 'stdin');
  assert.equal(payload.data.input.format, 'error-envelope');
  assert.equal(payload.data.error.code, 'INVALID_ARGS');
  assert.ok(payload.data.nextCommands.some((item) => item.command === 'pandora help'));
});

test('explain unwraps positional JSON failure envelopes the same way as stdin envelopes', () => {
  const rawEnvelope = JSON.stringify({
    ok: false,
    error: {
      code: 'INVALID_ARGS',
      message: 'bad request',
    },
  });
  const result = runCli(['--output', 'json', 'explain', rawEnvelope]);
  assert.equal(result.status, 0, result.output || result.stderr);
  const payload = parseJsonOutput(result, 'explain positional envelope');

  assert.equal(payload.data.input.format, 'error-envelope');
  assert.equal(payload.data.error.code, 'INVALID_ARGS');
  assert.equal(payload.data.explanation.category, 'usage');
  assert.ok(payload.data.nextCommands.some((item) => item.command === 'pandora help'));
});

test('explain renders an operator-readable table with the next canonical command', () => {
  const result = runCli(['explain', 'RISK_PANIC_ACTIVE']);
  assert.equal(result.status, 0, result.output || result.stderr);
  assert.match(result.stdout, /RISK_PANIC_ACTIVE\s+risk\s+recognized/);
  assert.match(result.stdout, /next: pandora risk show/);
});

test('explain treats freeform text as a message and derives canonical risk remediation', () => {
  const result = runCli(['--output', 'json', 'explain', 'risk requires subcommand: show|panic']);
  assert.equal(result.status, 0, result.output || result.stderr);
  const payload = parseJsonOutput(result, 'explain freeform risk message');

  assert.equal(payload.command, 'explain');
  assert.equal(payload.data.input.format, 'message');
  assert.equal(payload.data.error.code, null);
  assert.equal(payload.data.error.message, 'risk requires subcommand: show|panic');
  assert.equal(payload.data.explanation.category, 'risk');
  assert.equal(payload.data.explanation.recovery.command, 'pandora risk show');
  assert.ok(payload.data.nextCommands.some((item) => item.command === 'pandora risk show'));
});

test('explain emits exact policy/profile remediation commands for policy and profile families', () => {
  const policy = runCli([
    '--output',
    'json',
    'explain',
    '--code',
    'POLICY_DENIED',
    '--message',
    'Policy denied requested execution context.',
    '--details-json',
    '{"policyId":"execute-with-validation","command":"trade","mode":"execute","chainId":"1","profileId":"prod_trader_a"}',
  ]);
  assert.equal(policy.status, 0, policy.output || policy.stderr);
  const policyPayload = parseJsonOutput(policy, 'explain policy family');
  assert.equal(policyPayload.data.explanation.category, 'policy');
  assert.equal(
    policyPayload.data.explanation.recovery.command,
    'pandora --output json policy explain --id execute-with-validation --command trade --mode execute --chain-id 1 --profile-id prod_trader_a',
  );

  const profile = runCli([
    '--output',
    'json',
    'explain',
    '--code',
    'PROFILE_NOT_READY',
    '--message',
    'Signer profile is not ready.',
    '--details-json',
    '{"profileId":"dev_keystore_operator","command":"trade","mode":"execute","chainId":"1","policyId":"execute-with-validation"}',
  ]);
  assert.equal(profile.status, 0, profile.output || profile.stderr);
  const profilePayload = parseJsonOutput(profile, 'explain profile family');
  assert.equal(profilePayload.data.explanation.category, 'profile');
  assert.equal(
    profilePayload.data.explanation.recovery.command,
    'pandora --output json profile explain --id dev_keystore_operator --command trade --mode execute --chain-id 1 --policy-id execute-with-validation',
  );
});
