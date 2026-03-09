'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  resolveOperationsDir,
  normalizeOperationId,
} = require('./operation_state_store.cjs');

function createWebhookDeliveryStoreError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function ensurePrivateDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // best effort
  }
}

function hardenPrivateFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.chmodSync(filePath, 0o600);
    }
  } catch {
    // best effort
  }
}

function appendJsonLine(filePath, payload) {
  ensurePrivateDirectory(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
  hardenPrivateFile(filePath);
}

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  if (!text.trim()) return [];
  const lines = text.split('\n').filter(Boolean);
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw createWebhookDeliveryStoreError(
        'OPERATION_WEBHOOK_STORE_INVALID_FILE',
        `Unable to parse webhook delivery ledger: ${filePath}`,
        {
          filePath,
          index,
          cause: error && error.message ? error.message : String(error),
        },
      );
    }
  });
}

function defaultOperationWebhookDeliveryFile(operationId, options = {}) {
  const rootDir = resolveOperationsDir(options.rootDir || options.dir);
  return path.join(rootDir, `${normalizeOperationId(operationId)}.webhooks.jsonl`);
}

function normalizeReference(reference) {
  if (reference && typeof reference === 'object') {
    if (typeof reference.operationId === 'string' && reference.operationId.trim()) {
      return normalizeOperationId(reference.operationId);
    }
    if (typeof reference.id === 'string' && reference.id.trim()) {
      return normalizeOperationId(reference.id);
    }
  }
  return normalizeOperationId(reference);
}

function createOperationWebhookDeliveryStore(options = {}) {
  const rootDir = resolveOperationsDir(options.rootDir || options.dir);
  const operationStateStore = options.operationStateStore;
  if (!operationStateStore || typeof operationStateStore.get !== 'function') {
    throw createWebhookDeliveryStoreError(
      'OPERATION_WEBHOOK_STORE_INVALID_INPUT',
      'operationStateStore with get() is required.',
    );
  }

  async function resolveReference(reference) {
    const normalizedOperationId = normalizeReference(reference);
    const lookup = await operationStateStore.get(normalizedOperationId);
    if (!lookup || !lookup.found || !lookup.operation) {
      return {
        found: false,
        operationId: normalizedOperationId,
        operation: null,
        filePath: defaultOperationWebhookDeliveryFile(normalizedOperationId, { rootDir }),
      };
    }
    return {
      found: true,
      operationId: lookup.operation.operationId,
      operation: lookup.operation,
      filePath: defaultOperationWebhookDeliveryFile(lookup.operation.operationId, { rootDir }),
    };
  }

  async function append(reference, payload) {
    const resolved = await resolveReference(reference);
    if (!resolved.found) {
      throw createWebhookDeliveryStoreError('OPERATION_NOT_FOUND', 'Operation not found for webhook delivery write.', {
        reference,
      });
    }
    const entry = {
      schemaVersion: '1.0.0',
      deliveryRecordId: payload && payload.deliveryRecordId ? payload.deliveryRecordId : `owd_${crypto.randomUUID()}`,
      generatedAt: payload && payload.generatedAt ? payload.generatedAt : new Date().toISOString(),
      operationId: resolved.operationId,
      eventId: payload && payload.eventId ? payload.eventId : null,
      phase: payload && payload.phase ? payload.phase : null,
      delivered: payload && payload.delivered === true,
      skippedReason: payload && payload.skippedReason ? payload.skippedReason : null,
      deliveryPolicy: payload && payload.deliveryPolicy ? payload.deliveryPolicy : null,
      context: payload && payload.context ? payload.context : null,
      report: payload && payload.report ? payload.report : null,
      error: payload && payload.error ? payload.error : null,
    };
    appendJsonLine(resolved.filePath, entry);
    return {
      rootDir,
      operationId: resolved.operationId,
      filePath: resolved.filePath,
      entry,
    };
  }

  async function list(reference) {
    const resolved = await resolveReference(reference);
    return {
      schemaVersion: '1.0.0',
      generatedAt: new Date().toISOString(),
      operationId: resolved.operationId,
      count: fs.existsSync(resolved.filePath) ? readJsonLines(resolved.filePath).length : 0,
      deliveries: readJsonLines(resolved.filePath),
      filePath: resolved.filePath,
      found: resolved.found,
    };
  }

  return {
    rootDir,
    append,
    list,
  };
}

module.exports = {
  createWebhookDeliveryStoreError,
  createOperationWebhookDeliveryStore,
  defaultOperationWebhookDeliveryFile,
};
