const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadState: loadMirrorState, saveState } = require('../mirror_state_store.cjs');
const { daemonStatus: readMirrorDaemonStatus } = require('../mirror_daemon_service.cjs');

const MIRROR_RUNTIME_SCHEMA_VERSION = '1.0.0';
const MAX_RUNTIME_ALERTS = 25;
const DEFAULT_STALE_HEARTBEAT_MS = 30_000;
const DEFAULT_PENDING_ACTION_STALE_MS = 5 * 60_000;

function createServiceError(code, message, details = undefined) {
  const err = new Error(message);
  err.code = code;
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

/**
 * Populate identifying market selectors into persisted sync state if absent.
 * @param {object} state
 * @param {object} options
 * @returns {void}
 */
function ensureStateIdentity(state, options) {
  if (!state.pandoraMarketAddress) state.pandoraMarketAddress = options.pandoraMarketAddress || null;
  if (!state.polymarketMarketId) state.polymarketMarketId = options.polymarketMarketId || null;
  if (!state.polymarketSlug) state.polymarketSlug = options.polymarketSlug || null;
  if (!Array.isArray(state.alerts)) state.alerts = [];
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toAgeMs(timestamp, now = new Date()) {
  const parsed = toIso(timestamp);
  if (!parsed) return null;
  const age = now.getTime() - new Date(parsed).getTime();
  return age < 0 ? 0 : age;
}

function normalizeLockNonce(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeTransactionNonce(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) return null;
  return numeric;
}

function parsePid(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return numeric;
}

function isProcessAlive(pid) {
  const normalizedPid = parsePid(pid);
  if (normalizedPid === null) return null;
  try {
    process.kill(normalizedPid, 0);
    return true;
  } catch (err) {
    if (err && err.code === 'ESRCH') return false;
    if (err && err.code === 'EPERM') return true;
    return null;
  }
}

function describePendingActionLock(lock, options = {}) {
  if (!lock || typeof lock !== 'object') return null;
  const now = options.now instanceof Date ? options.now : new Date();
  const staleAfterMs = Number.isInteger(options.staleAfterMs) && options.staleAfterMs > 0
    ? options.staleAfterMs
    : DEFAULT_PENDING_ACTION_STALE_MS;
  const baseStatus = String(lock.status || 'pending').trim() || 'pending';
  const lockAgeMs = toAgeMs(lock.updatedAt || lock.createdAt, now);
  const pid = parsePid(lock.pid);
  const ownerAlive = isProcessAlive(pid);
  const stale = lockAgeMs !== null && lockAgeMs > staleAfterMs;
  const zombie = baseStatus === 'pending' && (ownerAlive === false || (ownerAlive === null && stale));
  const requiresManualReview =
    Boolean(lock.requiresManualReview)
    || baseStatus === 'invalid'
    || baseStatus === 'reconciliation-required'
    || zombie;

  return {
    ...lock,
    pid,
    lockNonce: normalizeLockNonce(lock.lockNonce),
    transactionNonce: normalizeTransactionNonce(lock.transactionNonce),
    status: baseStatus === 'invalid' ? 'invalid' : zombie ? 'zombie' : baseStatus,
    lockAgeMs,
    staleAfterMs,
    ownerAlive,
    stale,
    zombie,
    requiresManualReview,
  };
}

function pushRuntimeAlert(state, alert, maxSize = MAX_RUNTIME_ALERTS) {
  if (!state || typeof state !== 'object') return;
  if (!Array.isArray(state.alerts)) {
    state.alerts = [];
  }

  const normalized = {
    schemaVersion: MIRROR_RUNTIME_SCHEMA_VERSION,
    level: alert && alert.level ? String(alert.level) : 'info',
    scope: alert && alert.scope ? String(alert.scope) : 'runtime',
    code: alert && alert.code ? String(alert.code) : 'RUNTIME_EVENT',
    message: alert && alert.message ? String(alert.message) : 'Mirror runtime event.',
    timestamp: toIso(alert && alert.timestamp) || new Date().toISOString(),
  };
  if (alert && alert.details !== undefined) {
    normalized.details = alert.details;
  }

  const last = state.alerts[state.alerts.length - 1];
  if (
    last
    && last.code === normalized.code
    && last.scope === normalized.scope
    && last.message === normalized.message
  ) {
    state.alerts[state.alerts.length - 1] = {
      ...last,
      ...normalized,
      firstTimestamp: last.firstTimestamp || last.timestamp || normalized.timestamp,
      count: Number.isFinite(Number(last.count)) ? Number(last.count) + 1 : 2,
    };
  } else {
    state.alerts.push(normalized);
  }

  if (state.alerts.length > maxSize) {
    state.alerts = state.alerts.slice(state.alerts.length - maxSize);
  }
}

function buildPendingActionFilePath(stateFile) {
  const resolved = path.resolve(String(stateFile || ''));
  return `${resolved}.pending-action.json`;
}

function writeJsonFileAtomic(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const serialized = JSON.stringify(payload, null, 2);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, serialized, { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort permission hardening
  }
}

function buildPendingActionUnlockCommand(stateFile, options = {}) {
  const args = ['pandora', 'mirror', 'sync', 'unlock'];
  if (stateFile) {
    args.push('--state-file', stateFile);
  } else if (options.strategyHash) {
    args.push('--strategy-hash', options.strategyHash);
  }
  if (options.force) {
    args.push('--force');
  }
  if (Number.isInteger(options.staleAfterMs) && options.staleAfterMs > 0) {
    args.push('--stale-after-ms', String(options.staleAfterMs));
  }
  return args.join(' ');
}

function buildPendingActionReviewCommand(stateFile, options = {}) {
  const args = ['pandora', 'mirror', 'status'];
  if (stateFile) {
    args.push('--state-file', stateFile);
  } else if (options.strategyHash) {
    args.push('--strategy-hash', options.strategyHash);
  }
  args.push('--with-live');
  return args.join(' ');
}

function pendingActionMatchesLastExecution(lastExecution, pendingAction) {
  if (!(lastExecution && typeof lastExecution === 'object' && pendingAction && typeof pendingAction === 'object')) {
    return false;
  }
  const lastLockNonce = normalizeLockNonce(lastExecution.lockNonce);
  const lockNonce = normalizeLockNonce(pendingAction.lockNonce);
  if (lastLockNonce && lockNonce && lastLockNonce === lockNonce) return true;
  const lastIdempotencyKey = lastExecution.idempotencyKey ? String(lastExecution.idempotencyKey) : null;
  const lockIdempotencyKey = pendingAction.idempotencyKey ? String(pendingAction.idempotencyKey) : null;
  if (lastIdempotencyKey && lockIdempotencyKey && lastIdempotencyKey === lockIdempotencyKey) return true;
  return false;
}

function clearLastExecutionReviewState(state, now = new Date(), recoveryReason = 'operator-unlock') {
  if (!(state && typeof state === 'object' && state.lastExecution && typeof state.lastExecution === 'object')) {
    return {
      updated: false,
      changes: [],
    };
  }
  const status = String(state.lastExecution.status || '').trim().toLowerCase();
  const needsReview = Boolean(state.lastExecution.requiresManualReview) || status === 'pending';
  if (!needsReview) {
    return {
      updated: false,
      changes: [],
    };
  }
  const updatedAt = toIso(now) || new Date().toISOString();
  state.lastExecution = {
    ...state.lastExecution,
    status: status === 'pending' ? 'operator-cleared' : state.lastExecution.status,
    requiresManualReview: false,
    lockRetained: false,
    reviewClearedAt: updatedAt,
    reviewClearedBy: 'mirror.sync.unlock',
    recoveryReason,
  };
  return {
    updated: true,
    changes: ['lastExecution'],
  };
}

function describeStateOnlyReviewBlock(state) {
  if (!(state && typeof state === 'object' && state.lastExecution && typeof state.lastExecution === 'object')) {
    return null;
  }
  const status = String(state.lastExecution.status || '').trim().toLowerCase();
  const needsReview = Boolean(state.lastExecution.requiresManualReview) || status === 'pending';
  if (!needsReview) return null;
  return {
    status,
    lastExecution: {
      ...state.lastExecution,
      startedAt: toIso(state.lastExecution.startedAt),
      completedAt: toIso(state.lastExecution.completedAt),
    },
  };
}

function clearLastExecutionReviewBlock(state, pendingAction, now = new Date()) {
  if (!(state && typeof state === 'object' && state.lastExecution && typeof state.lastExecution === 'object')) {
    return {
      updated: false,
      changes: [],
    };
  }
  if (!pendingActionMatchesLastExecution(state.lastExecution, pendingAction)) {
    return {
      updated: false,
      changes: [],
    };
  }
  return clearLastExecutionReviewState(state, now, 'operator-unlock');
}

function clearLastExecutionReviewBlockWithoutLock(state, now = new Date()) {
  return clearLastExecutionReviewState(state, now, 'operator-unlock-state-only');
}

function readPendingActionLock(stateFile, options = {}) {
  if (!stateFile) return null;
  const lockFile = buildPendingActionFilePath(stateFile);
  if (!fs.existsSync(lockFile)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    return describePendingActionLock({
      ...parsed,
      lockFile,
    }, options);
  } catch (err) {
    return describePendingActionLock({
      schemaVersion: MIRROR_RUNTIME_SCHEMA_VERSION,
      status: 'invalid',
      createdAt: null,
      updatedAt: new Date().toISOString(),
      lockFile,
      parseError: err && err.message ? err.message : String(err),
      requiresManualReview: true,
    }, options);
  }
}

function tryAcquirePendingActionLock(stateFile, payload) {
  const lockFile = buildPendingActionFilePath(stateFile);
  const normalized = describePendingActionLock({
    schemaVersion: MIRROR_RUNTIME_SCHEMA_VERSION,
    status: 'pending',
    createdAt: toIso(payload && payload.createdAt) || new Date().toISOString(),
    updatedAt: toIso(payload && payload.updatedAt) || toIso(payload && payload.createdAt) || new Date().toISOString(),
    lockNonce: normalizeLockNonce(payload && payload.lockNonce) || crypto.randomBytes(16).toString('hex'),
    ...payload,
    lockFile,
  });

  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  try {
    fs.writeFileSync(lockFile, JSON.stringify(normalized, null, 2), { mode: 0o600, flag: 'wx' });
    try {
      fs.chmodSync(lockFile, 0o600);
    } catch {
      // best-effort permission hardening
    }
    return {
      acquired: true,
      lock: normalized,
    };
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      return {
        acquired: false,
        lock: readPendingActionLock(stateFile),
      };
    }
    throw err;
  }
}

function updatePendingActionLock(stateFile, patch) {
  const current = readPendingActionLock(stateFile);
  const options = arguments.length >= 3 && arguments[2] ? arguments[2] : {};
  if (!current) {
    return {
      updated: false,
      reason: 'missing',
      lock: null,
    };
  }
  const expectedLockNonce = Object.prototype.hasOwnProperty.call(options, 'expectedLockNonce')
    ? normalizeLockNonce(options.expectedLockNonce)
    : undefined;
  if (expectedLockNonce !== undefined && normalizeLockNonce(current.lockNonce) !== expectedLockNonce) {
    return {
      updated: false,
      reason: 'nonce-mismatch',
      lock: current,
    };
  }
  const updated = describePendingActionLock({
    ...current,
    ...patch,
    lockFile: current.lockFile,
    updatedAt: toIso(patch && patch.updatedAt) || new Date().toISOString(),
  });
  writeJsonFileAtomic(current.lockFile, updated);
  return {
    updated: true,
    reason: null,
    lock: updated,
  };
}

function clearPendingActionLock(stateFile) {
  const current = readPendingActionLock(stateFile);
  const options = arguments.length >= 2 && arguments[1] ? arguments[1] : {};
  if (!current) {
    return {
      cleared: false,
      reason: 'missing',
      lock: null,
    };
  }
  const expectedLockNonce = Object.prototype.hasOwnProperty.call(options, 'expectedLockNonce')
    ? normalizeLockNonce(options.expectedLockNonce)
    : undefined;
  if (expectedLockNonce !== undefined && normalizeLockNonce(current.lockNonce) !== expectedLockNonce) {
    return {
      cleared: false,
      reason: 'nonce-mismatch',
      lock: current,
    };
  }
  try {
    fs.unlinkSync(current.lockFile);
    return {
      cleared: true,
      reason: null,
      lock: current,
    };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return {
        cleared: false,
        reason: 'missing',
        lock: null,
      };
    }
    throw err;
  }
}

function assessPendingActionUnlock(stateFile, options = {}) {
  const lock = options.lock && typeof options.lock === 'object'
    ? describePendingActionLock(options.lock, options)
    : readPendingActionLock(stateFile, options);
  const strategyHash = options.strategyHash || (lock && lock.strategyHash) || null;
  const reviewCommand = buildPendingActionReviewCommand(stateFile, {
    strategyHash,
  });
  if (!lock) {
    const loaded = stateFile ? loadMirrorState(stateFile, strategyHash || null) : { state: {} };
    const stateOnlyReview = describeStateOnlyReviewBlock(loaded.state);
    const resolvedStrategyHash = strategyHash || loaded.state.strategyHash || null;
    const force = Boolean(options.force);
    if (stateOnlyReview) {
      return {
        found: false,
        stateFile: stateFile || null,
        strategyHash: resolvedStrategyHash,
        code: force
          ? 'PENDING_ACTION_STATE_ONLY_UNLOCK_ALLOWED'
          : 'PENDING_ACTION_STATE_ONLY_UNLOCK_FORCE_REQUIRED',
        message: force
          ? 'Pending-action lock file is gone, but persisted review state will be cleared.'
          : 'Pending-action lock file is gone, but persisted last-execution review state is still blocking live execution.',
        allowedWithoutForce: false,
        forceRequired: true,
        canClear: force,
        blocking: !force,
        reviewCommand,
        recommendedCommand: buildPendingActionUnlockCommand(stateFile, {
          strategyHash: resolvedStrategyHash,
          force: true,
          staleAfterMs: options.staleAfterMs,
        }),
        guidance: [
          `Review runtime status with ${reviewCommand} before clearing the orphaned persisted review state.`,
          'The lock file is already gone, so only the persisted last-execution blocker remains.',
          `If you intentionally want to clear that persisted blocker, rerun ${buildPendingActionUnlockCommand(stateFile, {
            strategyHash: resolvedStrategyHash,
            force: true,
            staleAfterMs: options.staleAfterMs,
          })}.`,
        ],
        lock: null,
        stateOnlyRecovery: stateOnlyReview,
      };
    }
    return {
      found: false,
      stateFile: stateFile || null,
      strategyHash: resolvedStrategyHash,
      code: 'PENDING_ACTION_LOCK_MISSING',
      message: 'No pending-action lock exists for this mirror state file.',
      allowedWithoutForce: false,
      forceRequired: false,
      canClear: false,
      blocking: false,
      reviewCommand,
      recommendedCommand: buildPendingActionUnlockCommand(stateFile, {
        strategyHash: resolvedStrategyHash,
        staleAfterMs: options.staleAfterMs,
      }),
      guidance: [
        `Review runtime status with ${reviewCommand} if execution is still blocked after the lock file is gone.`,
      ],
      lock: null,
    };
  }

  let code = 'PENDING_ACTION_UNLOCK_FORCE_REQUIRED';
  let message = 'Pending-action lock requires operator review before it can be cleared.';
  let allowedWithoutForce = false;
  let forceRequired = false;
  let guidance = [
    `Review runtime status with ${reviewCommand} before clearing or overriding the lock.`,
    'Unlock only removes the persisted pending-action lock file; it does not settle venue state or mutate open positions.',
  ];

  if (lock.status === 'invalid') {
    code = 'PENDING_ACTION_UNLOCK_ALLOWED';
    message = 'Pending-action lock is unreadable. Review current runtime state if needed, then clear it with mirror sync unlock.';
    allowedWithoutForce = true;
    guidance = guidance.concat([
      'This lock is unreadable, so it can be cleared without --force.',
    ]);
  } else if (lock.status === 'zombie') {
    code = 'PENDING_ACTION_UNLOCK_ALLOWED';
    message = 'Pending-action lock appears orphaned or stale. Review current runtime state if needed, then clear it with mirror sync unlock.';
    allowedWithoutForce = true;
    guidance = guidance.concat([
      'This lock already looks stale or orphaned, so it can be cleared without --force.',
    ]);
  } else if (lock.status === 'reconciliation-required' || lock.requiresManualReview) {
    code = 'PENDING_ACTION_UNLOCK_FORCE_REQUIRED';
    message = 'Pending-action lock is in manual-review mode. Reconcile venue state first, then rerun mirror sync unlock --force only if you intend to override it.';
    forceRequired = true;
    guidance = guidance.concat([
      'Confirm whether the last live action settled, reverted, or needs manual venue cleanup before forcing unlock.',
      `If you intentionally override the lock after reconciliation, rerun ${buildPendingActionUnlockCommand(stateFile, {
        strategyHash,
        force: true,
        staleAfterMs: options.staleAfterMs,
      })}.`,
    ]);
  } else if (lock.status === 'pending') {
    code = 'PENDING_ACTION_UNLOCK_ACTIVE';
    message = lock.ownerAlive === true
      ? 'Pending-action lock still belongs to a live process. Do not clear it unless the live action is confirmed stuck or already settled.'
      : 'Pending-action lock is still marked pending. Reconcile venue state first, then use --force only if you intentionally override it.';
    forceRequired = true;
    guidance = guidance.concat([
      'Inspect daemon/runtime status first to determine whether the live process is still active.',
      `If the action is confirmed stuck or settled and you intentionally override it, rerun ${buildPendingActionUnlockCommand(stateFile, {
        strategyHash,
        force: true,
        staleAfterMs: options.staleAfterMs,
      })}.`,
    ]);
  }

  const force = Boolean(options.force);
  return {
    found: true,
    stateFile: stateFile || null,
    strategyHash,
    code,
    message,
    allowedWithoutForce,
    forceRequired,
    canClear: force ? true : allowedWithoutForce,
    blocking: !(force ? true : allowedWithoutForce),
    reviewCommand,
    recommendedCommand: buildPendingActionUnlockCommand(stateFile, {
      strategyHash,
      force: forceRequired,
      staleAfterMs: options.staleAfterMs,
    }),
    guidance,
    lock,
  };
}

function unlockPendingActionLock(stateFile, options = {}) {
  const assessment = assessPendingActionUnlock(stateFile, options);
  if (!assessment.found) {
    if (assessment.stateOnlyRecovery && assessment.canClear) {
      const loaded = loadMirrorState(stateFile, assessment.strategyHash || null);
      const stateRecovery = clearLastExecutionReviewBlockWithoutLock(loaded.state, new Date());
      if (stateRecovery.updated) {
        saveState(stateFile, loaded.state);
      }
      return {
        ...assessment,
        cleared: stateRecovery.updated,
        reason: stateRecovery.updated ? null : 'missing',
        clearedLock: null,
        stateRecovery,
      };
    }
    return {
      ...assessment,
      cleared: false,
      reason: assessment.forceRequired ? 'force-required' : 'missing',
    };
  }

  if (!assessment.canClear) {
    return {
      ...assessment,
      cleared: false,
      reason: assessment.forceRequired ? 'force-required' : 'blocked',
    };
  }

  const clearResult = clearPendingActionLock(
    stateFile,
    Object.prototype.hasOwnProperty.call(options, 'expectedLockNonce')
      ? { expectedLockNonce: options.expectedLockNonce }
      : {},
  );
  let stateRecovery = {
    updated: false,
    changes: [],
  };
  if (clearResult.cleared) {
    const loaded = loadMirrorState(stateFile, assessment.strategyHash || null);
    stateRecovery = clearLastExecutionReviewBlock(loaded.state, assessment.lock, new Date());
    if (stateRecovery.updated) {
      saveState(stateFile, loaded.state);
    }
  }
  return {
    ...assessment,
    cleared: clearResult.cleared,
    reason: clearResult.reason,
    clearedLock: clearResult.lock || assessment.lock,
    stateRecovery,
  };
}

function deriveLastRuntimeError(state, pendingAction) {
  if (pendingAction && pendingAction.lastError) {
    return {
      ...pendingAction.lastError,
      source: 'pending-action-lock',
      at:
        toIso(pendingAction.lastError.at)
        || toIso(pendingAction.updatedAt)
        || toIso(pendingAction.createdAt),
    };
  }

  const lastExecution = state && state.lastExecution && typeof state.lastExecution === 'object' ? state.lastExecution : null;
  if (lastExecution && lastExecution.error) {
    return {
      ...lastExecution.error,
      source: 'last-execution',
      at:
        toIso(lastExecution.error.at)
        || toIso(lastExecution.completedAt)
        || toIso(lastExecution.startedAt)
        || toIso(state && state.lastTickAt),
    };
  }

  const alerts = state && Array.isArray(state.alerts) ? state.alerts : [];
  for (let i = alerts.length - 1; i >= 0; i -= 1) {
    const alert = alerts[i];
    if (alert && alert.level === 'error') {
      return {
        code: alert.code || null,
        message: alert.message || null,
        details: alert.details || null,
        source: alert.scope || 'alert',
        at: toIso(alert.timestamp),
      };
    }
  }

  return null;
}

function buildMirrorRuntimeTelemetry(params) {
  const {
    state,
    stateFile,
    daemonStatus = null,
    now = new Date(),
    staleAfterMs = DEFAULT_STALE_HEARTBEAT_MS,
  } = params || {};
  const safeState = state && typeof state === 'object' ? state : {};
  const pendingAction = readPendingActionLock(stateFile);
  const pendingActionRecovery = pendingAction
    ? assessPendingActionUnlock(stateFile, {
        lock: pendingAction,
        strategyHash: safeState.strategyHash || null,
      })
    : null;
  const lastAction = safeState.lastExecution && typeof safeState.lastExecution === 'object'
    ? {
        ...safeState.lastExecution,
        startedAt: toIso(safeState.lastExecution.startedAt),
        completedAt: toIso(safeState.lastExecution.completedAt),
      }
    : null;
  const lastError = deriveLastRuntimeError(safeState, pendingAction);
  const lastTickAt = toIso(safeState.lastTickAt);
  const heartbeatAgeMs = toAgeMs(lastTickAt, now);

  let resolvedDaemonStatus = daemonStatus;
  let daemonLookupError = null;
  if (!resolvedDaemonStatus && safeState && safeState.strategyHash) {
    try {
      resolvedDaemonStatus = readMirrorDaemonStatus({
        strategyHash: safeState.strategyHash,
      });
    } catch (err) {
      daemonLookupError = {
        code: err && err.code ? String(err.code) : 'MIRROR_DAEMON_STATUS_FAILED',
        message: err && err.message ? String(err.message) : String(err),
        details: err && err.details !== undefined ? err.details : null,
      };
    }
  }

  const daemonMeta = resolvedDaemonStatus && resolvedDaemonStatus.metadata && typeof resolvedDaemonStatus.metadata === 'object'
    ? resolvedDaemonStatus.metadata
    : null;
  const daemon = resolvedDaemonStatus
    ? {
        found: typeof resolvedDaemonStatus.found === 'boolean' ? resolvedDaemonStatus.found : true,
        alive: Boolean(resolvedDaemonStatus.alive),
        status: resolvedDaemonStatus.status || null,
        strategyHash: resolvedDaemonStatus.strategyHash || safeState.strategyHash || null,
        pid: Number.isInteger(Number(resolvedDaemonStatus.pid)) ? Number(resolvedDaemonStatus.pid) : null,
        pidFile: resolvedDaemonStatus.pidFile || (daemonMeta && daemonMeta.pidFile) || null,
        logFile: daemonMeta && daemonMeta.logFile ? daemonMeta.logFile : null,
        checkedAt: toIso((daemonMeta && daemonMeta.checkedAt) || now),
        startedAt: toIso(daemonMeta && daemonMeta.startedAt),
        stateFile: (daemonMeta && daemonMeta.stateFile) || stateFile || null,
        killSwitchFile: daemonMeta && daemonMeta.killSwitchFile ? daemonMeta.killSwitchFile : null,
        mode: daemonMeta && daemonMeta.mode ? daemonMeta.mode : null,
        executeLive: daemonMeta ? Boolean(daemonMeta.executeLive) : null,
        error: daemonLookupError,
      }
    : daemonLookupError
      ? {
          found: false,
          alive: false,
          status: 'error',
          strategyHash: safeState.strategyHash || null,
          pid: null,
          pidFile: null,
          logFile: null,
          checkedAt: toIso(now),
          startedAt: null,
          stateFile: stateFile || null,
          killSwitchFile: null,
          mode: null,
          executeLive: null,
          error: daemonLookupError,
        }
      : null;

  const statePending = Boolean(lastAction && lastAction.status === 'pending');
  const manualReviewRequired = Boolean(lastAction && lastAction.requiresManualReview);
  let status = 'idle';
  let code = 'NOT_STARTED';
  let message = 'Mirror sync has not recorded any ticks yet.';

  if (pendingAction) {
    status = 'blocked';
    if (pendingAction.status === 'invalid') {
      code = 'PENDING_ACTION_LOCK_INVALID';
      message = pendingActionRecovery && pendingActionRecovery.message
        ? pendingActionRecovery.message
        : 'Pending-action lock is unreadable. Use mirror sync unlock to clear it.';
    } else if (pendingAction.status === 'zombie') {
      code = 'PENDING_ACTION_LOCK_ZOMBIE';
      message = pendingActionRecovery && pendingActionRecovery.message
        ? pendingActionRecovery.message
        : 'Pending-action lock appears orphaned or stale. Use mirror sync unlock to clear it.';
    } else if (pendingAction.requiresManualReview) {
      code = 'PENDING_ACTION_LOCK_REVIEW';
      message = pendingActionRecovery && pendingActionRecovery.message
        ? pendingActionRecovery.message
        : 'Pending live action lock requires manual reconciliation before another execution.';
    } else {
      code = 'PENDING_ACTION_LOCK';
      message = pendingActionRecovery && pendingActionRecovery.message
        ? pendingActionRecovery.message
        : 'Pending live action lock is present. Runtime is fail-closed until reconciled.';
    }
  } else if (daemonLookupError) {
    status = 'degraded';
    code = daemonLookupError.code || 'MIRROR_DAEMON_STATUS_FAILED';
    message = daemonLookupError.message || 'Mirror daemon status lookup failed.';
  } else if (statePending) {
    status = 'blocked';
    code = 'PENDING_ACTION_STATE';
    message = 'Last execution is still marked pending. Runtime is fail-closed until reconciled.';
  } else if (manualReviewRequired) {
    status = 'blocked';
    code = 'LAST_ACTION_REQUIRES_REVIEW';
    message = 'Last live action requires reconciliation before another execution.';
  } else if (daemon && daemon.alive && heartbeatAgeMs !== null && heartbeatAgeMs > staleAfterMs) {
    status = 'stale';
    code = 'HEARTBEAT_STALE';
    message = 'Daemon heartbeat is stale.';
  } else if (lastError) {
    status = daemon && daemon.alive ? 'degraded' : 'error';
    code = lastError.code || 'LAST_ERROR';
    message = lastError.message || 'Mirror runtime recorded an error.';
  } else if (daemon && daemon.alive) {
    status = 'running';
    code = 'OK';
    message = 'Mirror daemon is running and heartbeat is within threshold.';
  } else if (lastTickAt) {
    status = 'idle';
    code = 'LAST_TICK_RECORDED';
    message = 'Mirror runtime is not actively running, but recent state is available.';
  }

  const runtimeAlerts = Array.isArray(safeState.alerts) ? safeState.alerts : [];
  const countAlertsByLevel = (level) =>
    runtimeAlerts.reduce((total, alert) => {
      if (!alert || alert.level !== level) return total;
      const count = Number.isFinite(Number(alert.count)) && Number(alert.count) > 0 ? Number(alert.count) : 1;
      return total + count;
    }, 0);
  const alertCount = runtimeAlerts.length;
  const infoCount = countAlertsByLevel('info');
  const warningCount = countAlertsByLevel('warn');
  const errorCount = countAlertsByLevel('error');
  const lastTrade = lastAction
    ? {
        status: lastAction.status || null,
        startedAt: lastAction.startedAt || null,
        completedAt: lastAction.completedAt || null,
        idempotencyKey: lastAction.idempotencyKey || null,
        requiresManualReview: Boolean(lastAction.requiresManualReview),
        rebalance: lastAction.rebalance || null,
        hedge: lastAction.hedge || null,
        error: lastAction.error || null,
      }
    : null;
  let nextAction = {
    code: 'MONITOR_NEXT_TICK',
    message: 'Continue monitoring the next sync tick.',
    blocking: false,
  };
  if (pendingAction || statePending || manualReviewRequired) {
    if (pendingActionRecovery && pendingActionRecovery.allowedWithoutForce) {
      nextAction = {
        code: 'UNLOCK_PENDING_ACTION',
        message: pendingActionRecovery.message,
        blocking: true,
        command: pendingActionRecovery.recommendedCommand,
        reviewCommand: pendingActionRecovery.reviewCommand,
      };
    } else if (pendingActionRecovery && pendingActionRecovery.forceRequired) {
      nextAction = {
        code: 'RECONCILE_PENDING_ACTION',
        message: pendingActionRecovery.message,
        blocking: true,
        command: pendingActionRecovery.recommendedCommand,
        reviewCommand: pendingActionRecovery.reviewCommand,
      };
    } else {
      nextAction = {
        code: 'RECONCILE_PENDING_ACTION',
        message: 'Reconcile the pending live action before another daemon execution.',
        blocking: true,
      };
    }
  } else if (daemonLookupError) {
    nextAction = {
      code: 'INSPECT_DAEMON_STATUS',
      message: 'Inspect daemon metadata and log output before relying on the runtime.',
      blocking: false,
    };
  } else if (daemon && daemon.alive && heartbeatAgeMs !== null && heartbeatAgeMs > staleAfterMs) {
    nextAction = {
      code: 'RESTART_DAEMON',
      message: 'Restart the mirror daemon and inspect its log output.',
      blocking: false,
    };
  } else if (lastError) {
    nextAction = {
      code: daemon && daemon.alive ? 'INSPECT_LAST_ERROR' : 'REVIEW_LAST_ERROR',
      message: 'Review the most recent runtime error before resuming automation.',
      blocking: false,
    };
  } else if (!(daemon && daemon.alive)) {
    nextAction = {
      code: 'START_DAEMON',
      message: 'Start or restart the mirror daemon when you want sync automation running.',
      blocking: false,
    };
  }

  return {
    schemaVersion: MIRROR_RUNTIME_SCHEMA_VERSION,
    checkedAt: toIso(now),
    stateFile: stateFile || null,
    daemon,
    health: {
      status,
      code,
      message,
      lastTickAt,
      heartbeatAgeMs,
      staleAfterMs,
      hasPendingAction: Boolean(pendingAction || statePending),
      lastErrorAt: lastError && lastError.at ? lastError.at : null,
      daemonStatusChecked: Boolean(resolvedDaemonStatus || daemonLookupError),
    },
    alertCount,
    infoCount,
    warningCount,
    errorCount,
    nextAction,
    summary: {
      alertCount,
      infoCount,
      warningCount,
      errorCount,
      nextAction,
      lastTradeStatus: lastTrade && lastTrade.status ? lastTrade.status : null,
      lastTradeAt: (lastTrade && (lastTrade.completedAt || lastTrade.startedAt)) || null,
    },
    lastAction,
    lastTrade,
    lastError,
    pendingAction,
    pendingActionRecovery,
    alerts: runtimeAlerts.slice(-10),
  };
}

/**
 * Persist end-of-tick state and optionally stream tick callback.
 * @param {{loadedFilePath: string, state: object, tickAt: Date, snapshot: object, snapshots: Array<object>, onTick: Function|null, iteration: number}} params
 * @returns {Promise<void>}
 */
async function persistTickSnapshot(params) {
  const { loadedFilePath, state, tickAt, snapshot, snapshots, onTick, iteration } = params;
  if (snapshot && snapshot.error) {
    pushRuntimeAlert(state, {
      level: 'error',
      scope: 'tick',
      code: snapshot.error.code || 'MIRROR_SYNC_TICK_FAILED',
      message: snapshot.error.message || 'Mirror sync tick failed.',
      details: snapshot.error.details !== undefined ? snapshot.error.details : null,
      timestamp: snapshot.timestamp || tickAt,
    });
  }
  state.lastTickAt = tickAt.toISOString();
  saveState(loadedFilePath, state);
  snapshots.push(snapshot);
  if (onTick) {
    await onTick({
      iteration,
      timestamp: snapshot.timestamp,
      snapshot,
      state,
    });
  }
}

module.exports = {
  MIRROR_RUNTIME_SCHEMA_VERSION,
  DEFAULT_PENDING_ACTION_STALE_MS,
  createServiceError,
  ensureStateIdentity,
  pushRuntimeAlert,
  buildPendingActionFilePath,
  buildPendingActionUnlockCommand,
  describePendingActionLock,
  readPendingActionLock,
  tryAcquirePendingActionLock,
  updatePendingActionLock,
  clearPendingActionLock,
  assessPendingActionUnlock,
  unlockPendingActionLock,
  buildMirrorRuntimeTelemetry,
  persistTickSnapshot,
};
