'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  resolveOperationsDir,
  defaultOperationReceiptFile,
  normalizeOperationId,
} = require('./operation_state_store.cjs');

function createReceiptStoreError(code, message, details) {
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
    // best-effort
  }
}

function hardenPrivateFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.chmodSync(filePath, 0o600);
    }
  } catch {
    // best-effort
  }
}

function atomicWriteJson(filePath, payload) {
  ensurePrivateDirectory(path.dirname(filePath));
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempFile, filePath);
  hardenPrivateFile(filePath);
  return filePath;
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw createReceiptStoreError('OPERATION_RECEIPT_STORE_INVALID_FILE', `Unable to parse operation receipt file: ${filePath}`, {
      filePath,
      cause: error && error.message ? error.message : String(error),
    });
  }
}

function defaultOperationReceiptVersionDir(operationId, options = {}) {
  const rootDir = resolveOperationsDir(options.rootDir);
  const normalizedId = normalizeOperationId(operationId);
  return path.join(rootDir, 'receipts', normalizedId);
}

function defaultOperationReceiptVersionFile(operationId, receipt, options = {}) {
  const versionDir = defaultOperationReceiptVersionDir(operationId, options);
  const version = Number.isInteger(Number(receipt && receipt.receiptVersion))
    ? `v${Math.max(1, Number(receipt.receiptVersion))}`
    : 'v0';
  const receiptHash = receipt && typeof receipt.receiptHash === 'string' && receipt.receiptHash.trim()
    ? receipt.receiptHash.trim()
    : crypto.randomBytes(8).toString('hex');
  return path.join(versionDir, `${version}-${receiptHash}.json`);
}

function listVersionFiles(versionDir) {
  if (!fs.existsSync(versionDir)) return [];
  return fs.readdirSync(versionDir)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) => path.join(versionDir, entry));
}

function createOperationReceiptStore(options = {}) {
  const rootDir = resolveOperationsDir(options.rootDir || options.dir);
  const operationStateStore = options.operationStateStore;
  if (!operationStateStore || typeof operationStateStore.get !== 'function') {
    throw createReceiptStoreError('OPERATION_RECEIPT_STORE_INVALID_INPUT', 'operationStateStore with get() is required.');
  }

  async function resolveReceiptReference(reference) {
    const lookup = await operationStateStore.get(reference);
    if (!lookup || !lookup.found || !lookup.operation) {
      return {
        found: false,
        receiptFilePath: null,
        operation: null,
      };
    }
    return {
      found: true,
      operation: lookup.operation,
      receiptFilePath: defaultOperationReceiptFile(lookup.operation.operationId, { rootDir }),
      receiptVersionDir: defaultOperationReceiptVersionDir(lookup.operation.operationId, { rootDir }),
    };
  }

  async function read(reference) {
    const resolved = await resolveReceiptReference(reference);
    if (!resolved.found) {
      return {
        rootDir,
        found: false,
        receiptFilePath: null,
        receiptVersionDir: null,
        receipt: null,
        operation: null,
        versions: [],
      };
    }
    const versions = listVersionFiles(resolved.receiptVersionDir).map((filePath) => ({
      filePath,
      receipt: readJsonFile(filePath),
    }));
    return {
      rootDir,
      found: Boolean(fs.existsSync(resolved.receiptFilePath)),
      receiptFilePath: resolved.receiptFilePath,
      receiptVersionDir: resolved.receiptVersionDir,
      receipt: readJsonFile(resolved.receiptFilePath),
      operation: resolved.operation,
      versions,
    };
  }

  async function write(reference, receipt) {
    const resolved = await resolveReceiptReference(reference);
    if (!resolved.found) {
      throw createReceiptStoreError('OPERATION_NOT_FOUND', 'Operation not found for receipt write.', {
        reference,
      });
    }
    const existing = await read(reference);
    const versionFilePath = defaultOperationReceiptVersionFile(resolved.operation.operationId, receipt, { rootDir });
    if (existing && existing.receipt && existing.receipt.receiptHash !== receipt.receiptHash) {
      const existingVersionFile = defaultOperationReceiptVersionFile(
        resolved.operation.operationId,
        existing.receipt,
        { rootDir },
      );
      if (!fs.existsSync(existingVersionFile)) {
        atomicWriteJson(existingVersionFile, existing.receipt);
      }
    }
    if (!fs.existsSync(versionFilePath)) {
      atomicWriteJson(versionFilePath, receipt);
    }
    atomicWriteJson(resolved.receiptFilePath, receipt);
    return {
      rootDir,
      found: true,
      receiptFilePath: resolved.receiptFilePath,
      receiptVersionDir: resolved.receiptVersionDir,
      receiptVersionFilePath: versionFilePath,
      receipt,
      operation: resolved.operation,
    };
  }

  return {
    rootDir,
    read,
    write,
    listVersions(reference) {
      return read(reference).then((resolved) => ({
        rootDir,
        found: Boolean(resolved && resolved.found),
        receiptVersionDir: resolved ? resolved.receiptVersionDir : null,
        versions: resolved && Array.isArray(resolved.versions) ? resolved.versions : [],
      }));
    },
  };
}

module.exports = {
  createReceiptStoreError,
  createOperationReceiptStore,
  defaultOperationReceiptVersionDir,
  defaultOperationReceiptVersionFile,
};
