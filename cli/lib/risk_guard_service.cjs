function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRiskGuardService requires deps.${name}()`);
  }
  return deps[name];
}

function maybeNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toRuntimeMode(options = {}) {
  if (typeof options.runtimeMode === 'string' && options.runtimeMode.trim()) {
    return options.runtimeMode.trim().toLowerCase();
  }
  return 'live';
}

function createRiskGuardService(deps) {
  const CliError = requireDep(deps, 'CliError');
  const loadRiskState = requireDep(deps, 'loadRiskState');
  const saveRiskState = requireDep(deps, 'saveRiskState');
  const defaultRiskFile = requireDep(deps, 'defaultRiskFile');
  const touchPanicStopFiles = requireDep(deps, 'touchPanicStopFiles');
  const now = typeof deps.now === 'function' ? deps.now : () => new Date();

  function normalizeRiskFile(riskFile) {
    if (typeof riskFile === 'string' && riskFile.trim()) {
      return riskFile.trim();
    }
    if (typeof process.env.PANDORA_RISK_FILE === 'string' && process.env.PANDORA_RISK_FILE.trim()) {
      return process.env.PANDORA_RISK_FILE.trim();
    }
    return defaultRiskFile();
  }

  function resetDailyCountersIfNeeded(state, at) {
    const today = at.toISOString().slice(0, 10);
    if (!state.counters || state.counters.day !== today) {
      state.counters = {
        day: today,
        liveNotionalUsdc: 0,
        liveOps: 0,
      };
      return true;
    }
    return false;
  }

  function loadOrThrow(riskFile) {
    try {
      return loadRiskState(riskFile, { now });
    } catch (error) {
      if (error && error.code) {
        throw new CliError(error.code, error.message || 'Risk state error.', error.details);
      }
      throw new CliError('RISK_STATE_READ_FAILED', 'Unable to load risk state.', {
        riskFile,
        cause: error && error.message ? error.message : String(error),
      });
    }
  }

  function saveOrThrow(filePath, state) {
    try {
      return saveRiskState(filePath, state, { now });
    } catch (error) {
      if (error && error.code) {
        throw new CliError(error.code, error.message || 'Risk state write failed.', error.details);
      }
      throw new CliError('RISK_STATE_WRITE_FAILED', 'Unable to persist risk state.', {
        filePath,
        cause: error && error.message ? error.message : String(error),
      });
    }
  }

  function getRiskSnapshot(options = {}) {
    const riskFile = normalizeRiskFile(options.riskFile);
    const loaded = loadOrThrow(riskFile);
    return {
      riskFile: loaded.filePath,
      state: loaded.state,
    };
  }

  function assertLiveWriteAllowed(operation, options = {}) {
    const operationName = typeof operation === 'string' && operation.trim() ? operation.trim() : 'live.write';
    const riskFile = normalizeRiskFile(options.riskFile);
    const record = options.record !== false;
    const runtimeMode = toRuntimeMode(options);
    const notionalUsdc = maybeNumber(options.notionalUsdc);

    const loaded = loadOrThrow(riskFile);
    const state = loaded.state;
    const timestamp = now();
    const countersReset = resetDailyCountersIfNeeded(state, timestamp);
    const guardrails = state.guardrails || {};
    const killSwitch = Boolean(state.kill_switch || (state.panic && state.panic.active));
    const maxPositionUsd = maybeNumber(state.max_position_usd);
    const maxDailyLossUsd = maybeNumber(state.max_daily_loss_usd);
    const maxOpenMarkets = maybeNumber(state.max_open_markets);

    if (killSwitch) {
      throw new CliError('RISK_PANIC_ACTIVE', 'Risk panic is active. Live writes are blocked.', {
        normalizedCode: 'ERR_RISK_LIMIT',
        riskFile: loaded.filePath,
        operation: operationName,
        guardrail: 'kill_switch',
        kill_switch: true,
        metadata: state.metadata || null,
      });
    }

    if (guardrails.enabled !== false) {
      if (guardrails.blockForkExecute && runtimeMode === 'fork') {
        throw new CliError('RISK_GUARDRAIL_BLOCKED', 'Fork execution is blocked by risk guardrails.', {
          normalizedCode: 'ERR_RISK_LIMIT',
          riskFile: loaded.filePath,
          operation: operationName,
          guardrail: 'blockForkExecute',
          runtimeMode,
        });
      }

      if (Number.isFinite(maxPositionUsd) && Number.isFinite(notionalUsdc)) {
        if (notionalUsdc > maxPositionUsd) {
          throw new CliError('RISK_GUARDRAIL_BLOCKED', 'Live write exceeds max single-notional guardrail.', {
            normalizedCode: 'ERR_RISK_LIMIT',
            riskFile: loaded.filePath,
            operation: operationName,
            guardrail: 'max_position_usd',
            limit: maxPositionUsd,
            requestedNotionalUsdc: notionalUsdc,
          });
        }
      }

      if (Number.isFinite(maxDailyLossUsd) && Number.isFinite(notionalUsdc)) {
        const projected = Number(state.counters.liveNotionalUsdc || 0) + Math.max(0, notionalUsdc);
        if (projected > maxDailyLossUsd) {
          throw new CliError('RISK_GUARDRAIL_BLOCKED', 'Live write exceeds max daily-notional guardrail.', {
            normalizedCode: 'ERR_RISK_LIMIT',
            riskFile: loaded.filePath,
            operation: operationName,
            guardrail: 'max_daily_loss_usd',
            limit: maxDailyLossUsd,
            currentNotionalUsdc: state.counters.liveNotionalUsdc,
            requestedNotionalUsdc: notionalUsdc,
            projectedNotionalUsdc: projected,
          });
        }
      }

      if (Number.isFinite(maxOpenMarkets)) {
        const projectedOps = Number(state.counters.liveOps || 0) + 1;
        if (projectedOps > maxOpenMarkets) {
          throw new CliError('RISK_GUARDRAIL_BLOCKED', 'Live write exceeds max daily operations guardrail.', {
            normalizedCode: 'ERR_RISK_LIMIT',
            riskFile: loaded.filePath,
            operation: operationName,
            guardrail: 'max_open_markets',
            limit: maxOpenMarkets,
            currentOps: state.counters.liveOps,
            projectedOps,
          });
        }
      }
    }

    if (record || countersReset) {
      if (record) {
        state.counters.liveOps = Number(state.counters.liveOps || 0) + 1;
        if (Number.isFinite(notionalUsdc) && notionalUsdc > 0) {
          state.counters.liveNotionalUsdc = Number(state.counters.liveNotionalUsdc || 0) + notionalUsdc;
        }
      }
      state.updatedAt = timestamp.toISOString();
      saveOrThrow(loaded.filePath, state);
    }

    return {
      ok: true,
      riskFile: loaded.filePath,
      operation: operationName,
      state,
    };
  }

  function setPanic(options = {}) {
    const riskFile = normalizeRiskFile(options.riskFile);
    const loaded = loadOrThrow(riskFile);
    const state = loaded.state;
    const timestamp = now().toISOString();
    const reason = options.reason === null || options.reason === undefined ? null : String(options.reason);
    const actor = options.actor === null || options.actor === undefined ? null : String(options.actor);
    const metadata = state.metadata && typeof state.metadata === 'object' ? state.metadata : {};

    const changed = !Boolean(state.kill_switch || (state.panic && state.panic.active));
    state.kill_switch = true;
    state.metadata = {
      ...metadata,
      reason,
      engaged_at: changed ? timestamp : metadata.engaged_at || timestamp,
      engaged_by: actor,
      cleared_at: null,
      cleared_by: null,
    };
    state.updatedAt = timestamp;

    const saved = saveOrThrow(loaded.filePath, state);

    let stopFiles = [];
    if (options.touchStopFiles === true) {
      try {
        stopFiles = touchPanicStopFiles({
          autopilotStopFile: options.autopilotStopFile,
          mirrorStopFile: options.mirrorStopFile,
        });
      } catch (error) {
        if (error && error.code) {
          throw new CliError(error.code, error.message || 'Failed to write panic stop files.', error.details);
        }
        throw error;
      }
    }

    return {
      action: 'engage',
      changed,
      riskFile: saved.filePath,
      kill_switch: saved.state.kill_switch,
      metadata: saved.state.metadata,
      panic: saved.state.panic,
      guardrails: saved.state.guardrails,
      counters: saved.state.counters,
      stopFiles,
    };
  }

  function clearPanic(options = {}) {
    const riskFile = normalizeRiskFile(options.riskFile);
    const loaded = loadOrThrow(riskFile);
    const state = loaded.state;
    const timestamp = now().toISOString();
    const actor = options.actor === null || options.actor === undefined ? null : String(options.actor);
    const metadata = state.metadata && typeof state.metadata === 'object' ? state.metadata : {};

    const changed = Boolean(state.kill_switch || (state.panic && state.panic.active));
    state.kill_switch = false;
    state.metadata = {
      ...metadata,
      cleared_at: timestamp,
      cleared_by: actor,
    };
    state.updatedAt = timestamp;

    const saved = saveOrThrow(loaded.filePath, state);
    return {
      action: 'clear',
      changed,
      riskFile: saved.filePath,
      kill_switch: saved.state.kill_switch,
      metadata: saved.state.metadata,
      panic: saved.state.panic,
      guardrails: saved.state.guardrails,
      counters: saved.state.counters,
      stopFiles: [],
    };
  }

  return {
    getRiskSnapshot,
    assertLiveWriteAllowed,
    setPanic,
    clearPanic,
  };
}

module.exports = {
  createRiskGuardService,
};
