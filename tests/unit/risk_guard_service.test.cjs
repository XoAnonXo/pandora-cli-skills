const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  loadRiskState,
  saveRiskState,
  touchPanicStopFiles,
} = require('../../cli/lib/risk_state_store.cjs');
const { createRiskGuardService } = require('../../cli/lib/risk_guard_service.cjs');
const { createTempDir, removeDir } = require('../helpers/cli_runner.cjs');

class TestCliError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function createGuard(options = {}) {
  const riskFile = options.riskFile;
  const stopFileRoot = options.stopFileRoot;
  return createRiskGuardService({
    CliError: TestCliError,
    defaultRiskFile: () => riskFile,
    loadRiskState,
    saveRiskState,
    touchPanicStopFiles: (params = {}) =>
      touchPanicStopFiles({
        autopilotStopFile: path.join(stopFileRoot, 'autopilot', 'STOP'),
        mirrorStopFile: path.join(stopFileRoot, 'mirror', 'STOP'),
        ...params,
      }),
    now: () => new Date('2026-03-02T12:00:00.000Z'),
  });
}

test('assertLiveWriteAllowed increments counters when allowed', () => {
  const tempDir = createTempDir('pandora-risk-guard-allow-');
  try {
    const riskFile = path.join(tempDir, 'risk.json');
    const guard = createGuard({ riskFile, stopFileRoot: tempDir });

    guard.assertLiveWriteAllowed('trade.execute', {
      notionalUsdc: 12.5,
      runtimeMode: 'live',
    });

    const snapshot = guard.getRiskSnapshot();
    assert.equal(snapshot.state.counters.liveOps, 1);
    assert.equal(snapshot.state.counters.liveNotionalUsdc, 12.5);
  } finally {
    removeDir(tempDir);
  }
});

test('setPanic engages lock and clearPanic removes it', () => {
  const tempDir = createTempDir('pandora-risk-guard-panic-');
  try {
    const riskFile = path.join(tempDir, 'risk.json');
    const guard = createGuard({ riskFile, stopFileRoot: tempDir });

    const engaged = guard.setPanic({ reason: 'incident', actor: 'test', touchStopFiles: true });
    assert.equal(engaged.action, 'engage');
    assert.equal(engaged.kill_switch, true);
    assert.equal(engaged.metadata.reason, 'incident');
    assert.equal(engaged.metadata.engaged_by, 'test');
    assert.equal(engaged.panic.active, true);
    assert.equal(Array.isArray(engaged.stopFiles), true);
    assert.equal(engaged.stopFiles.length, 2);

    assert.throws(
      () =>
        guard.assertLiveWriteAllowed('resolve.execute', {
          runtimeMode: 'live',
        }),
      (error) => {
        assert.equal(error.code, 'RISK_PANIC_ACTIVE');
        assert.equal(error.details.normalizedCode, 'ERR_RISK_LIMIT');
        assert.equal(error.details.guardrail, 'kill_switch');
        return true;
      },
    );

    const cleared = guard.clearPanic({ actor: 'test' });
    assert.equal(cleared.action, 'clear');
    assert.equal(cleared.kill_switch, false);
    assert.equal(cleared.metadata.reason, 'incident');
    assert.equal(cleared.metadata.cleared_by, 'test');
    assert.equal(cleared.panic.active, false);
  } finally {
    removeDir(tempDir);
  }
});

test('assertLiveWriteAllowed enforces max_position_usd guardrail', () => {
  const tempDir = createTempDir('pandora-risk-guard-single-');
  try {
    const riskFile = path.join(tempDir, 'risk.json');
    saveRiskState(riskFile, {
      max_position_usd: 5,
    });
    const guard = createGuard({ riskFile, stopFileRoot: tempDir });

    assert.throws(
      () =>
        guard.assertLiveWriteAllowed('trade.execute', {
          notionalUsdc: 10,
          runtimeMode: 'live',
        }),
      (error) => {
        assert.equal(error.code, 'RISK_GUARDRAIL_BLOCKED');
        assert.equal(error.details.normalizedCode, 'ERR_RISK_LIMIT');
        assert.equal(error.details.guardrail, 'max_position_usd');
        return true;
      },
    );
  } finally {
    removeDir(tempDir);
  }
});

test('assertLiveWriteAllowed supports legacy guardrail aliases', () => {
  const tempDir = createTempDir('pandora-risk-guard-legacy-');
  try {
    const riskFile = path.join(tempDir, 'risk.json');
    saveRiskState(riskFile, {
      guardrails: {
        maxSingleLiveNotionalUsdc: 4,
      },
    });
    const guard = createGuard({ riskFile, stopFileRoot: tempDir });

    assert.throws(
      () =>
        guard.assertLiveWriteAllowed('trade.execute', {
          notionalUsdc: 10,
          runtimeMode: 'live',
        }),
      (error) => {
        assert.equal(error.code, 'RISK_GUARDRAIL_BLOCKED');
        assert.equal(error.details.guardrail, 'max_position_usd');
        return true;
      },
    );
  } finally {
    removeDir(tempDir);
  }
});

test('assertLiveWriteAllowed fails closed when risk file is invalid', () => {
  const tempDir = createTempDir('pandora-risk-guard-invalid-');
  try {
    const riskFile = path.join(tempDir, 'risk.json');
    fs.mkdirSync(path.dirname(riskFile), { recursive: true });
    fs.writeFileSync(riskFile, '{bad', 'utf8');

    const guard = createGuard({ riskFile, stopFileRoot: tempDir });
    assert.throws(
      () =>
        guard.assertLiveWriteAllowed('trade.execute', {
          notionalUsdc: 1,
          runtimeMode: 'live',
        }),
      (error) => {
        assert.equal(error.code, 'RISK_STATE_INVALID');
        return true;
      },
    );
  } finally {
    removeDir(tempDir);
  }
});
