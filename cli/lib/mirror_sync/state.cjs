const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { saveState } = require('../mirror_state_store.cjs');
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

function readPendingActionLock(stateFile) {
  if (!stateFile) return null;
  const lockFile = buildPendingActionFilePath(stateFile);
  if (!fs.existsSync(lockFile)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    return describePendingActionLock({
      ...parsed,
      lockFile,
    });
  } catch (err) {
    return describePendingActionLock({
      schemaVersion: MIRROR_RUNTIME_SCHEMA_VERSION,
      status: 'invalid',
      createdAt: null,
      updatedAt: new Date().toISOString(),
      lockFile,
      parseError: err && err.message ? err.message : String(err),
      requiresManualReview: true,
    });
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
      message = 'Pending-action lock is unreadable and requires manual cleanup.';
    } else if (pendingAction.status === 'zombie') {
      code = 'PENDING_ACTION_LOCK_ZOMBIE';
      message = 'Pending-action lock appears orphaned or stale. Manual review is required before another live execution.';
    } else if (pendingAction.requiresManualReview) {
      code = 'PENDING_ACTION_LOCK_REVIEW';
      message = 'Pending live action lock requires manual reconciliation before another execution.';
    } else {
      code = 'PENDING_ACTION_LOCK';
      message = 'Pending live action lock is present. Runtime is fail-closed until reconciled.';
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
    nextAction = {
      code: 'RECONCILE_PENDING_ACTION',
      message: 'Reconcile the pending live action before another daemon execution.',
      blocking: true,
    };
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
  describePendingActionLock,
  readPendingActionLock,
  tryAcquirePendingActionLock,
  updatePendingActionLock,
  clearPendingActionLock,
  buildMirrorRuntimeTelemetry,
  persistTickSnapshot,
};
