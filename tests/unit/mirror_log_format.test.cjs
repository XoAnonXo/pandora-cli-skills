const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseMirrorLogEntry,
} = require('../../cli/lib/mirror_log_format.cjs');

test('parseMirrorLogEntry reads timestamp from nested success envelopes', () => {
  const entry = parseMirrorLogEntry(
    JSON.stringify({
      ok: true,
      command: 'mirror.sync',
      data: {
        generatedAt: '2026-03-09T00:00:02.000Z',
      },
    }),
    7,
  );

  assert.equal(entry.lineNumber, 7);
  assert.equal(entry.structured, true);
  assert.equal(entry.event, 'mirror.sync');
  assert.equal(entry.timestamp, '2026-03-09T00:00:02.000Z');
});
