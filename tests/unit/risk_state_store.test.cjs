const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  defaultRiskFile,
  ensureRiskStateShape,
  loadRiskState,
  saveRiskState,
  touchPanicStopFiles,
} = require('../../cli/lib/risk_state_store.cjs');

const { createTempDir, removeDir } = require('../helpers/cli_runner.cjs');

test('defaultRiskFile resolves to ~/.pandora/risk.json', () => {
  const filePath = defaultRiskFile();
  assert.equal(filePath.endsWith(`${path.sep}.pandora${path.sep}risk.json`), true);
});

test('loadRiskState returns defaults when file is missing', () => {
  const tempDir = createTempDir('pandora-risk-load-default-');
  const riskFile = path.join(tempDir, 'risk.json');
  try {
    const loaded = loadRiskState(riskFile);
    assert.equal(loaded.exists, false);
    assert.equal(loaded.filePath, riskFile);
    assert.equal(loaded.state.schemaVersion, '1.0.0');
    assert.equal(loaded.state.kill_switch, false);
    assert.equal(loaded.state.panic.active, false);
    assert.equal(loaded.state.max_position_usd, null);
    assert.equal(loaded.state.max_daily_loss_usd, null);
    assert.equal(loaded.state.max_open_markets, null);
    assert.equal(loaded.state.guardrails.enabled, true);
    assert.equal(typeof loaded.state.counters.day, 'string');
  } finally {
    removeDir(tempDir);
  }
});

test('saveRiskState writes normalized state with private permissions', () => {
  const tempDir = createTempDir('pandora-risk-save-');
  const riskFile = path.join(tempDir, 'nested', 'risk.json');
  try {
    const saved = saveRiskState(riskFile, {
      kill_switch: true,
      metadata: { reason: 'incident', engaged_by: 'ops' },
      max_position_usd: 25,
      max_daily_loss_usd: 100,
      max_open_markets: 3,
      counters: { day: '2026-03-01', liveOps: 3, liveNotionalUsdc: 50 },
    });

    const loaded = loadRiskState(riskFile);
    assert.equal(saved.filePath, riskFile);
    assert.equal(loaded.exists, true);
    assert.equal(loaded.state.kill_switch, true);
    assert.equal(loaded.state.max_position_usd, 25);
    assert.equal(loaded.state.max_daily_loss_usd, 100);
    assert.equal(loaded.state.max_open_markets, 3);
    assert.equal(loaded.state.metadata.reason, 'incident');
    assert.equal(loaded.state.metadata.engaged_by, 'ops');
    assert.equal(loaded.state.panic.active, true);
    assert.equal(loaded.state.panic.reason, 'incident');
    assert.equal(loaded.state.guardrails.maxSingleLiveNotionalUsdc, 25);
    assert.equal(loaded.state.guardrails.maxDailyLiveNotionalUsdc, 100);
    assert.equal(loaded.state.guardrails.maxDailyLiveOps, 3);
    assert.equal(loaded.state.counters.liveOps, 3);

    const mode = fs.statSync(riskFile).mode & 0o777;
    assert.equal(mode, 0o600);
  } finally {
    removeDir(tempDir);
  }
});

test('loadRiskState throws RISK_STATE_INVALID for malformed json', () => {
  const tempDir = createTempDir('pandora-risk-invalid-');
  const riskFile = path.join(tempDir, 'risk.json');
  try {
    fs.writeFileSync(riskFile, '{broken', 'utf8');
    assert.throws(
      () => loadRiskState(riskFile),
      (error) => {
        assert.equal(error.code, 'RISK_STATE_INVALID');
        return true;
      },
    );
  } finally {
    removeDir(tempDir);
  }
});

test('touchPanicStopFiles creates autopilot and mirror stop files', () => {
  const tempDir = createTempDir('pandora-risk-stop-files-');
  const autopilotStopFile = path.join(tempDir, 'autopilot', 'STOP');
  const mirrorStopFile = path.join(tempDir, 'mirror', 'STOP');
  try {
    const files = touchPanicStopFiles({ autopilotStopFile, mirrorStopFile });
    assert.equal(files.length, 2);
    assert.equal(fs.existsSync(autopilotStopFile), true);
    assert.equal(fs.existsSync(mirrorStopFile), true);
    const mode = fs.statSync(autopilotStopFile).mode & 0o777;
    assert.equal(mode, 0o600);
  } finally {
    removeDir(tempDir);
  }
});

test('ensureRiskStateShape normalizes nullable thresholds and counters', () => {
  const shaped = ensureRiskStateShape({
    max_position_usd: '10',
    max_daily_loss_usd: 'bad',
    max_open_markets: -5,
    kill_switch: 1,
    metadata: {
      reason: 'safety',
      engaged_by: 'qa',
    },
    guardrails: {
      blockForkExecute: 1,
    },
    counters: {
      day: '2026-03-02',
      liveNotionalUsdc: '4.5',
      liveOps: 2.9,
    },
  });

  assert.equal(shaped.max_position_usd, 10);
  assert.equal(shaped.max_daily_loss_usd, null);
  assert.equal(shaped.max_open_markets, null);
  assert.equal(shaped.kill_switch, true);
  assert.equal(shaped.metadata.reason, 'safety');
  assert.equal(shaped.metadata.engaged_by, 'qa');
  assert.equal(shaped.guardrails.maxSingleLiveNotionalUsdc, 10);
  assert.equal(shaped.guardrails.maxDailyLiveNotionalUsdc, null);
  assert.equal(shaped.guardrails.maxDailyLiveOps, null);
  assert.equal(shaped.guardrails.blockForkExecute, true);
  assert.equal(shaped.counters.liveNotionalUsdc, 4.5);
  assert.equal(shaped.counters.liveOps, 2);
});

test('ensureRiskStateShape supports legacy aliases and maps to canonical keys', () => {
  const shaped = ensureRiskStateShape({
    panic: {
      active: true,
      reason: 'legacy',
      engagedAt: '2026-03-01T00:00:00.000Z',
      engagedBy: 'legacy-actor',
    },
    guardrails: {
      maxSingleLiveNotionalUsdc: '10',
      maxDailyLiveNotionalUsdc: '20',
      maxDailyLiveOps: '7',
    },
  });

  assert.equal(shaped.max_position_usd, 10);
  assert.equal(shaped.max_daily_loss_usd, 20);
  assert.equal(shaped.max_open_markets, 7);
  assert.equal(shaped.kill_switch, true);
  assert.equal(shaped.metadata.reason, 'legacy');
  assert.equal(shaped.metadata.engaged_at, '2026-03-01T00:00:00.000Z');
  assert.equal(shaped.metadata.engaged_by, 'legacy-actor');
});
