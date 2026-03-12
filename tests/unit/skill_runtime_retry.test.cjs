const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  executeSkillScenarioWithRetries,
} = require('../../scripts/lib/surface_e2e_runner.cjs');

test('skill runtime executor retries one timed-out scenario and returns the successful retry', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-skill-runtime-retry-'));
  const markerPath = path.join(tempDir, 'attempted');
  const scriptPath = path.join(tempDir, 'executor.cjs');

  fs.writeFileSync(
    scriptPath,
    `'use strict';
const fs = require('node:fs');
const markerPath = process.argv[2];
fs.readFileSync(0, 'utf8');
if (!fs.existsSync(markerPath)) {
  fs.writeFileSync(markerPath, '1');
  setTimeout(() => {
    process.stdout.write(JSON.stringify({ responseText: 'late first attempt' }) + '\\n');
  }, 250);
} else {
  process.stdout.write(JSON.stringify({ responseText: 'retry success' }) + '\\n');
}
`,
  );

  const execution = executeSkillScenarioWithRetries(
    `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)} ${JSON.stringify(markerPath)}`,
    {
      id: 'timeout-retry',
      kind: 'functional',
      executorTimeoutMs: 100,
    },
    tempDir,
    1,
  );

  assert.equal(execution.status, 0);
  assert.equal(execution.timedOut, false);
  assert.equal(execution.attemptCount, 2);
  assert.equal(execution.timeoutRetryCount, 1);
  assert.equal(execution.parsed.responseText, 'retry success');

  fs.rmSync(tempDir, { recursive: true, force: true });
});
