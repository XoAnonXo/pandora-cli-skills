function formatHookError(error) {
  if (!error) return 'Unknown error';
  if (error && typeof error.message === 'string' && error.message.trim()) return error.message.trim();
  return String(error);
}

function normalizeOperationId(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const key of ['operationId', 'id']) {
    if (typeof value[key] === 'string' && value[key].trim()) {
      return value[key].trim();
    }
  }
  return null;
}

function listOperationSources(input = {}) {
  const sources = [];
  if (input && typeof input === 'object') {
    for (const key of ['operationContext', 'operationHooks', 'operation', 'operations']) {
      if (input[key] && typeof input[key] === 'object') {
        sources.push(input[key]);
      }
    }
    sources.push(input);
  }
  return sources;
}

function pickHook(sources, names) {
  for (const source of sources) {
    for (const name of names) {
      if (source && typeof source[name] === 'function') {
        return source[name].bind(source);
      }
    }
  }
  return null;
}

function resolveConfig(input = {}) {
  const sources = listOperationSources(input);
  return {
    operationId:
      normalizeOperationId(input.operationId)
      || sources.map((source) => normalizeOperationId(source)).find(Boolean)
      || null,
    createHook: pickHook(sources, ['createOperation', 'ensureOperation', 'create', 'ensure']),
    checkpointHook: pickHook(sources, ['emitCheckpoint', 'checkpoint', 'recordCheckpoint']),
    updateHook: pickHook(sources, ['updateOperation', 'update']),
    completeHook: pickHook(sources, ['completeOperation', 'complete']),
    failHook: pickHook(sources, ['failOperation', 'fail']),
  };
}

function buildBridge(input = {}, options = {}) {
  const config = resolveConfig(input);
  const diagnostics = [];
  const defaults = options && typeof options === 'object' ? { ...options } : {};
  let operationId = config.operationId;

  function setOperationId(value, force = false) {
    const normalized = normalizeOperationId(value);
    if (normalized && (force || !operationId)) {
      operationId = normalized;
    }
    return operationId;
  }

  function getOperationId() {
    return operationId;
  }

  function attach(payload) {
    if (!operationId || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return payload;
    }
    if (payload.operationId === operationId) return payload;
    return {
      ...payload,
      operationId,
    };
  }

  function payloadFor(details = {}) {
    return {
      ...defaults,
      ...(details && typeof details === 'object' ? details : {}),
      operationId,
    };
  }

  function recordDiagnostic(kind, error) {
    diagnostics.push(`Operation ${kind} hook failed: ${formatHookError(error)}`);
  }

  return {
    config,
    diagnostics,
    setOperationId,
    getOperationId,
    attach,
    payloadFor,
    recordDiagnostic,
  };
}

function createAsyncOperationBridge(input = {}, options = {}) {
  const bridge = buildBridge(input, options);
  let createAttempted = false;

  async function callHook(kind, hook, payload) {
    if (typeof hook !== 'function') return null;
    try {
      return await hook(payload);
    } catch (error) {
      bridge.recordDiagnostic(kind, error);
      return null;
    }
  }

  async function ensure(details = {}) {
    if (bridge.getOperationId()) return bridge.getOperationId();
    if (createAttempted) return bridge.getOperationId();
    createAttempted = true;
    const created = await callHook('create', bridge.config.createHook, bridge.payloadFor(details));
    bridge.setOperationId(created);
    if (bridge.config.createHook && !bridge.getOperationId()) {
      bridge.recordDiagnostic('create', new Error('Create hook returned no operation id.'));
    }
    return bridge.getOperationId();
  }

  async function checkpoint(name, details = {}) {
    await ensure({ phase: name, ...details });
    await callHook('checkpoint', bridge.config.checkpointHook, bridge.payloadFor({ phase: name, ...details }));
    return bridge.getOperationId();
  }

  async function update(status, details = {}) {
    await ensure({ status, ...details });
    await callHook('update', bridge.config.updateHook, bridge.payloadFor({ status, ...details }));
    return bridge.getOperationId();
  }

  async function complete(details = {}) {
    await ensure({ status: 'completed', ...details });
    await callHook(
      bridge.config.completeHook ? 'complete' : 'update',
      bridge.config.completeHook || bridge.config.updateHook,
      bridge.payloadFor({ status: 'completed', ...details }),
    );
    return bridge.getOperationId();
  }

  async function fail(error, details = {}) {
    await ensure({
      status: 'failed',
      errorCode: error && error.code ? error.code : null,
      errorMessage: formatHookError(error),
      ...details,
    });
    await callHook(
      bridge.config.failHook ? 'fail' : 'update',
      bridge.config.failHook || bridge.config.updateHook,
      bridge.payloadFor({
        status: 'failed',
        errorCode: error && error.code ? error.code : null,
        errorMessage: formatHookError(error),
        ...details,
      }),
    );
    return bridge.getOperationId();
  }

  return {
    diagnostics: bridge.diagnostics,
    hasCreateHook: Boolean(bridge.config.createHook),
    setOperationId: bridge.setOperationId,
    getOperationId: bridge.getOperationId,
    attach: bridge.attach,
    ensure,
    checkpoint,
    update,
    complete,
    fail,
  };
}

function createSyncOperationBridge(input = {}, options = {}) {
  const bridge = buildBridge(input, options);
  let createAttempted = false;

  function callHook(kind, hook, payload) {
    if (typeof hook !== 'function') return null;
    try {
      return hook(payload);
    } catch (error) {
      bridge.recordDiagnostic(kind, error);
      return null;
    }
  }

  function ensure(details = {}) {
    if (bridge.getOperationId()) return bridge.getOperationId();
    if (createAttempted) return bridge.getOperationId();
    createAttempted = true;
    const created = callHook('create', bridge.config.createHook, bridge.payloadFor(details));
    bridge.setOperationId(created);
    if (bridge.config.createHook && !bridge.getOperationId()) {
      bridge.recordDiagnostic('create', new Error('Create hook returned no operation id.'));
    }
    return bridge.getOperationId();
  }

  function checkpoint(name, details = {}) {
    ensure({ phase: name, ...details });
    callHook('checkpoint', bridge.config.checkpointHook, bridge.payloadFor({ phase: name, ...details }));
    return bridge.getOperationId();
  }

  function update(status, details = {}) {
    ensure({ status, ...details });
    callHook('update', bridge.config.updateHook, bridge.payloadFor({ status, ...details }));
    return bridge.getOperationId();
  }

  function complete(details = {}) {
    ensure({ status: 'completed', ...details });
    callHook(
      bridge.config.completeHook ? 'complete' : 'update',
      bridge.config.completeHook || bridge.config.updateHook,
      bridge.payloadFor({ status: 'completed', ...details }),
    );
    return bridge.getOperationId();
  }

  function fail(error, details = {}) {
    ensure({
      status: 'failed',
      errorCode: error && error.code ? error.code : null,
      errorMessage: formatHookError(error),
      ...details,
    });
    callHook(
      bridge.config.failHook ? 'fail' : 'update',
      bridge.config.failHook || bridge.config.updateHook,
      bridge.payloadFor({
        status: 'failed',
        errorCode: error && error.code ? error.code : null,
        errorMessage: formatHookError(error),
        ...details,
      }),
    );
    return bridge.getOperationId();
  }

  return {
    diagnostics: bridge.diagnostics,
    hasCreateHook: Boolean(bridge.config.createHook),
    setOperationId: bridge.setOperationId,
    getOperationId: bridge.getOperationId,
    attach: bridge.attach,
    ensure,
    checkpoint,
    update,
    complete,
    fail,
  };
}

module.exports = {
  normalizeOperationId,
  createAsyncOperationBridge,
  createSyncOperationBridge,
};
