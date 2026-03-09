const test = require('node:test');
const assert = require('node:assert/strict');

const { createCliOutputService } = require('../../cli/lib/cli_output_service.cjs');

class TestCliError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
    this.exitCode = 1;
  }
}

test('cli output service emits compact json when daemon jsonl mode is enabled', () => {
  const originalFlag = process.env.PANDORA_DAEMON_LOG_JSONL;
  const originalLog = console.log;
  const lines = [];

  process.env.PANDORA_DAEMON_LOG_JSONL = '1';
  console.log = (value) => {
    lines.push(String(value));
  };

  try {
    const service = createCliOutputService({ CliError: TestCliError });
    service.emitSuccess('json', 'mirror.sync', {
      event: 'mirror.sync.tick',
      tick: 1,
    });
  } finally {
    console.log = originalLog;
    if (originalFlag === undefined) {
      delete process.env.PANDORA_DAEMON_LOG_JSONL;
    } else {
      process.env.PANDORA_DAEMON_LOG_JSONL = originalFlag;
    }
  }

  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes('\n'), false);
  const payload = JSON.parse(lines[0]);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'mirror.sync');
  assert.equal(payload.data.event, 'mirror.sync.tick');
  assert.equal(payload.data.tick, 1);
  assert.equal(typeof payload.data.generatedAt, 'string');
});
