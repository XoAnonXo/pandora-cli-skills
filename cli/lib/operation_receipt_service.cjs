'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildCommandDescriptors } = require('./agent_contract_registry.cjs');
const { createOperationReceiptStore } = require('./operation_receipt_store.cjs');
const {
  RECEIPT_SIGNATURE_ALGORITHM,
  createOperationReceiptSigningService,
} = require('./operation_receipt_signing_service.cjs');
const { OPERATION_RECEIPT_SCHEMA_VERSION } = require('./operation_state_store.cjs');
const { stableStringify, normalizeOperationHash, normalizeOperationId } = require('./shared/operation_hash.cjs');

const RECEIPT_HASH_ALGORITHM = 'sha256';
const TERMINAL_RECEIPT_STATUSES = Object.freeze(['completed', 'failed', 'canceled', 'closed']);

function createReceiptError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function hasReceiptSignature(receipt) {
  return Boolean(
    receipt
    && receipt.verification
    && typeof receipt.verification.signature === 'string'
    && receipt.verification.signature
    && typeof receipt.verification.publicKeyPem === 'string'
    && receipt.verification.publicKeyPem
    && receipt.verification.signatureAlgorithm === RECEIPT_SIGNATURE_ALGORITHM
    && typeof receipt.verification.publicKeyFingerprint === 'string'
    && receipt.verification.publicKeyFingerprint
  );
}

function isReceiptEligibleStatus(status) {
  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';
  return TERMINAL_RECEIPT_STATUSES.includes(normalized);
}

function normalizeReceiptStatus(status) {
  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (!normalized) return 'planned';
  if (normalized === 'running') return 'executing';
  if (normalized === 'succeeded') return 'completed';
  if (normalized === 'cancelled') return 'canceled';
  return normalized;
}

function deriveTool(command) {
  const normalized = typeof command === 'string' ? command.trim() : '';
  return normalized ? normalized.split('.')[0] || null : null;
}

function deriveAction(command) {
  const normalized = typeof command === 'string' ? command.trim() : '';
  if (!normalized.includes('.')) return null;
  return normalized.split('.').slice(1).join('.') || null;
}

function buildOperationStateDigest(operation, options = {}) {
  const normalized = normalizeOperationRecord(operation, options);
  return sha256Hex(normalized);
}

function normalizeOperationRecord(operation, options = {}) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    throw createReceiptError('OPERATION_RECEIPT_INVALID_RECORD', 'Operation receipt requires an operation object.');
  }
  const commandDescriptors = options.commandDescriptors || buildCommandDescriptors();
  const command = typeof operation.command === 'string' && operation.command.trim() ? operation.command.trim() : null;
  const descriptor = command ? commandDescriptors[command] || null : null;
  const operationId = normalizeOperationId(operation.operationId || operation.id);
  const operationHash = normalizeOperationHash(operation.operationHash || operation.hash, { allowNull: true });
  const status = normalizeReceiptStatus(operation.status);
  const checkpoints = Array.isArray(operation.checkpoints) ? cloneValue(operation.checkpoints) : [];
  const latestCheckpoint = operation.latestCheckpoint !== undefined
    ? cloneValue(operation.latestCheckpoint)
    : (checkpoints.length ? checkpoints[checkpoints.length - 1] : null);

  return {
    operationId,
    operationHash,
    command,
    canonicalTool: descriptor && descriptor.canonicalTool ? descriptor.canonicalTool : command,
    tool: operation.tool || deriveTool(command),
    action: operation.action || deriveAction(command),
    summary: operation.summary || operation.description || null,
    description: operation.description || null,
    status,
    terminal: isReceiptEligibleStatus(status),
    createdAt: operation.createdAt || null,
    updatedAt: operation.updatedAt || null,
    validatedAt: operation.validatedAt || null,
    queuedAt: operation.queuedAt || null,
    executingAt: operation.executingAt || operation.startedAt || null,
    startedAt: operation.startedAt || null,
    completedAt: operation.completedAt || null,
    failedAt: operation.failedAt || null,
    canceledAt: operation.canceledAt || operation.cancelledAt || null,
    cancelledAt: operation.cancelledAt || operation.canceledAt || null,
    closedAt: operation.closedAt || null,
    policyPack: operation.policyPack || null,
    profile: operation.profile || null,
    environment: operation.environment || null,
    mode: operation.mode || null,
    scope: operation.scope || null,
    tags: Array.isArray(operation.tags) ? cloneValue(operation.tags) : [],
    parentOperationId: operation.parentOperationId || null,
    target: operation.target === undefined ? null : cloneValue(operation.target),
    input: operation.input === undefined ? null : cloneValue(operation.input),
    request: operation.request === undefined ? null : cloneValue(operation.request),
    context: operation.context === undefined ? null : cloneValue(operation.context),
    metadata: operation.metadata === undefined ? null : cloneValue(operation.metadata),
    result: operation.result === undefined ? null : cloneValue(operation.result),
    recovery: operation.recovery === undefined ? null : cloneValue(operation.recovery),
    error: operation.error === undefined ? null : cloneValue(operation.error),
    cancellation: operation.cancellation === undefined ? null : cloneValue(operation.cancellation),
    closure: operation.closure === undefined ? null : cloneValue(operation.closure),
    checkpointCount: Number.isInteger(operation.checkpointCount) ? operation.checkpointCount : checkpoints.length,
    latestCheckpoint,
    checkpoints,
  };
}

function buildReceiptBody(operation, options = {}) {
  const normalized = normalizeOperationRecord(operation, options);
  const previousReceipt = options.previousReceipt && typeof options.previousReceipt === 'object'
    ? options.previousReceipt
    : null;
  const generatedAt = typeof options.generatedAt === 'string' && options.generatedAt.trim()
    ? options.generatedAt.trim()
    : new Date().toISOString();
  const stateDigest = sha256Hex(normalized);
  const previousVersion = previousReceipt && Number.isInteger(Number(previousReceipt.receiptVersion))
    ? Math.max(1, Number(previousReceipt.receiptVersion))
    : 0;
  const sameStateAsPrevious = Boolean(previousReceipt && previousReceipt.stateDigest === stateDigest);
  const receiptVersion = sameStateAsPrevious
    ? Math.max(1, previousVersion || 1)
    : Math.max(1, previousVersion + 1);
  const supersedesReceiptHash = !sameStateAsPrevious && previousReceipt && typeof previousReceipt.receiptHash === 'string'
    ? previousReceipt.receiptHash
    : null;
  return {
    schemaVersion: OPERATION_RECEIPT_SCHEMA_VERSION,
    receiptId: `${normalized.operationId}-receipt`,
    receiptKind: 'operation',
    receiptVersion,
    operationId: normalized.operationId,
    operationHash: normalized.operationHash,
    command: normalized.command,
    canonicalCommand: normalized.canonicalTool,
    canonicalTool: normalized.canonicalTool,
    tool: normalized.tool,
    action: normalized.action,
    status: normalized.status,
    terminal: normalized.terminal,
    terminalAt: normalized.closedAt || normalized.completedAt || normalized.failedAt || normalized.canceledAt || null,
    summary: normalized.summary,
    description: normalized.description,
    policyPack: normalized.policyPack,
    profile: normalized.profile,
    environment: normalized.environment,
    mode: normalized.mode,
    scope: normalized.scope,
    tags: normalized.tags,
    parentOperationId: normalized.parentOperationId,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    validatedAt: normalized.validatedAt,
    queuedAt: normalized.queuedAt,
    executingAt: normalized.executingAt,
    startedAt: normalized.startedAt,
    completedAt: normalized.completedAt,
    failedAt: normalized.failedAt,
    canceledAt: normalized.canceledAt,
    cancelledAt: normalized.cancelledAt,
    closedAt: normalized.closedAt,
    target: normalized.target,
    input: normalized.input,
    request: normalized.request,
    context: normalized.context,
    metadata: normalized.metadata,
    result: normalized.result,
    recovery: normalized.recovery,
    error: normalized.error,
    cancellation: normalized.cancellation,
    closure: normalized.closure,
    checkpointCount: normalized.checkpointCount,
    latestCheckpoint: normalized.latestCheckpoint,
    checkpoints: normalized.checkpoints,
    stateDigest,
    generatedAt,
    issuedAt: generatedAt,
    sealedAt: generatedAt,
    supersedesReceiptHash,
  };
}

function buildVerificationHashes(body) {
  return {
    targetHash: sha256Hex(body.target),
    inputHash: sha256Hex(body.input),
    requestHash: sha256Hex(body.request),
    contextHash: sha256Hex(body.context),
    metadataHash: sha256Hex(body.metadata),
    resultHash: sha256Hex(body.result),
    recoveryHash: sha256Hex(body.recovery),
    errorHash: sha256Hex(body.error),
    cancellationHash: sha256Hex(body.cancellation),
    closureHash: sha256Hex(body.closure),
    checkpointsHash: sha256Hex(body.checkpoints),
  };
}

function buildOperationReceipt(operation, options = {}) {
  const body = buildReceiptBody(operation, options);
  const hashes = buildVerificationHashes(body);
  const receiptWithoutVerification = {
    ...body,
    checkpointDigest: hashes.checkpointsHash,
    hashes,
  };
  const receiptHash = sha256Hex(receiptWithoutVerification);
  const receiptSigningService = options.receiptSigningService
    || createOperationReceiptSigningService({
      rootDir: options.rootDir || options.dir,
    });
  const signature = receiptSigningService.signReceiptHash(receiptHash);
  return {
    ...receiptWithoutVerification,
    receiptHash,
    verification: {
      algorithm: RECEIPT_HASH_ALGORITHM,
      receiptHash,
      checkpointDigest: hashes.checkpointsHash,
      signatureAlgorithm: signature.signatureAlgorithm,
      signature: signature.signature,
      publicKeyPem: signature.publicKeyPem,
      publicKeyFingerprint: signature.publicKeyFingerprint,
      keyId: signature.keyId,
    },
  };
}

function verifyOperationReceipt(receipt, options = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return {
      ok: false,
      code: 'OPERATION_RECEIPT_INVALID',
      mismatches: ['receipt must be an object'],
      receiptHash: null,
    };
  }

  const mismatches = [];
  if (receipt.schemaVersion !== OPERATION_RECEIPT_SCHEMA_VERSION) {
    mismatches.push(`schemaVersion mismatch: expected ${OPERATION_RECEIPT_SCHEMA_VERSION}`);
  }

  try {
    normalizeOperationId(receipt.operationId);
  } catch (error) {
    mismatches.push(`operationId mismatch: ${error.message}`);
  }
  try {
    normalizeOperationHash(receipt.operationHash, { allowNull: true });
  } catch (error) {
    mismatches.push(`operationHash mismatch: ${error.message}`);
  }

  const recomputedHashes = buildVerificationHashes(receipt);
  const canonicalPayload = cloneValue(receipt);
  delete canonicalPayload.receiptHash;
  delete canonicalPayload.verification;
  canonicalPayload.hashes = recomputedHashes;
  const recomputedReceiptHash = sha256Hex(canonicalPayload);

  if (receipt.receiptHash !== recomputedReceiptHash) {
    mismatches.push('receiptHash mismatch');
  }
  if (!receipt.verification || receipt.verification.algorithm !== RECEIPT_HASH_ALGORITHM) {
    mismatches.push('verification.algorithm mismatch');
  }
  if (!receipt.verification || receipt.verification.receiptHash !== recomputedReceiptHash) {
    mismatches.push('verification.receiptHash mismatch');
  }
  if (!receipt.verification || receipt.verification.checkpointDigest !== recomputedHashes.checkpointsHash) {
    mismatches.push('verification.checkpointDigest mismatch');
  }
  const receiptSigningService = options.receiptSigningService
    || createOperationReceiptSigningService({
      rootDir: options.rootDir || options.dir,
    });
  const signatureVerification = receiptSigningService.verifyReceiptHashSignature(recomputedReceiptHash, receipt.verification);
  if (!signatureVerification.ok) {
    mismatches.push(signatureVerification.message || 'receipt signature mismatch');
  }

  const expectedOperationHash = options.expectedOperationHash
    || (options.operation && options.operation.operationHash)
    || null;
  if (expectedOperationHash && receipt.operationHash !== expectedOperationHash) {
    mismatches.push('operationHash mismatch');
  }
  if (options.operation && typeof options.operation === 'object') {
    try {
      const expected = normalizeOperationRecord(options.operation, options);
      if (receipt.operationId !== expected.operationId) {
        mismatches.push('operationId mismatch');
      }
      if ((receipt.status || null) !== (expected.status || null)) {
        mismatches.push('status mismatch');
      }
      if ((receipt.stateDigest || null) !== buildOperationStateDigest(options.operation, options)) {
        mismatches.push('stateDigest mismatch');
      }
    } catch (error) {
      mismatches.push(`operation normalization mismatch: ${error.message}`);
    }
  }

  return {
    ok: mismatches.length === 0,
    code: mismatches.length === 0 ? 'OK' : 'OPERATION_RECEIPT_INVALID',
    mismatches,
    receiptHash: recomputedReceiptHash,
    signatureValid: Boolean(signatureVerification && signatureVerification.ok),
    signatureAlgorithm: receipt && receipt.verification ? receipt.verification.signatureAlgorithm || null : null,
    publicKeyFingerprint: receipt && receipt.verification ? receipt.verification.publicKeyFingerprint || null : null,
    keyId: receipt && receipt.verification ? receipt.verification.keyId || null : null,
  };
}

function buildReceipt(operation, options = {}) {
  return buildOperationReceipt(operation, options);
}

function verifyReceiptPayload(receipt, options = {}) {
  const result = verifyOperationReceipt(receipt, options);
  return {
    valid: result.ok,
    issueCount: result.mismatches.length,
    issues: result.mismatches.map((message) => ({ message })),
    receiptHash: result.receiptHash,
    ...result,
  };
}

function createOperationReceiptService(options = {}) {
  const operationStateStore = options.operationStateStore || options.store;
  if (!operationStateStore || typeof operationStateStore.get !== 'function') {
    throw createReceiptError('OPERATION_RECEIPT_MISSING_STORE', 'createOperationReceiptService requires operationStateStore with get() support.');
  }
  const receiptStore = options.operationReceiptStore
    || createOperationReceiptStore({
      rootDir: options.rootDir || options.dir || operationStateStore.rootDir,
      operationStateStore,
    });
  const commandDescriptors = options.commandDescriptors || buildCommandDescriptors();
  const receiptSigningService = options.receiptSigningService
    || createOperationReceiptSigningService({
      rootDir: options.rootDir || options.dir || operationStateStore.rootDir,
    });

  async function loadOperationRecord(reference) {
    const current = await operationStateStore.get(reference);
    if (!current || !current.found || !current.operation) {
      throw createReceiptError('OPERATION_NOT_FOUND', `Operation not found: ${reference}`, { reference });
    }
    const record = cloneValue(current.operation);
    if (typeof operationStateStore.readCheckpoints === 'function') {
      const checkpointListing = await operationStateStore.readCheckpoints(record.operationId, { order: 'asc' });
      record.checkpoints = checkpointListing && Array.isArray(checkpointListing.items) ? checkpointListing.items : [];
      if (!record.latestCheckpoint && record.checkpoints.length) {
        record.latestCheckpoint = record.checkpoints[record.checkpoints.length - 1];
      }
      if (!Number.isInteger(record.checkpointCount)) {
        record.checkpointCount = record.checkpoints.length;
      }
    }
    return record;
  }

  async function syncReceipt(reference) {
    const record = await loadOperationRecord(reference);
    if (!isReceiptEligibleStatus(record.status)) return null;
    const existing = await receiptStore.read(record.operationId);
    const currentStateDigest = buildOperationStateDigest(record, {
      commandDescriptors,
    });
    if (
      existing
      && existing.found
      && existing.receipt
      && existing.receipt.stateDigest === currentStateDigest
      && hasReceiptSignature(existing.receipt)
    ) {
      return cloneValue(existing.receipt);
    }
    const receipt = buildOperationReceipt(record, {
      commandDescriptors,
      receiptSigningService,
      rootDir: options.rootDir || options.dir || operationStateStore.rootDir,
      previousReceipt: existing && existing.receipt ? existing.receipt : null,
    });
    await receiptStore.write(record.operationId, receipt);
    return receipt;
  }

  async function getReceipt(reference, options = {}) {
    if (options.refresh === false) {
      const stored = await receiptStore.read(reference);
      if (stored && stored.found && stored.receipt) {
        return cloneValue(stored.receipt);
      }
    }
    return syncReceipt(reference);
  }

  async function verifyReceipt(referenceOrReceipt, options = {}) {
    const receipt = referenceOrReceipt && typeof referenceOrReceipt === 'object' && referenceOrReceipt.operationId
      ? cloneValue(referenceOrReceipt)
      : await getReceipt(referenceOrReceipt, { refresh: options.refresh !== false });
    const current = receipt && receipt.operationId ? await operationStateStore.get(receipt.operationId) : null;
    return verifyOperationReceipt(receipt, {
      ...options,
      receiptSigningService,
      operation: current && current.found ? current.operation : options.operation,
    });
  }

  async function verifyReceiptFile(filePath, options = {}) {
    const resolvedPath = path.resolve(String(filePath || ''));
    const receipt = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    const verification = await verifyReceipt(receipt, options);
    return {
      ...verification,
      filePath: resolvedPath,
    };
  }

  return {
    OPERATION_RECEIPT_SCHEMA_VERSION,
    RECEIPT_HASH_ALGORITHM,
    buildReceipt,
    buildOperationStateDigest,
    buildOperationReceipt,
    verifyReceiptPayload,
    verifyOperationReceipt,
    hasReceiptSignature,
    isReceiptEligibleStatus,
    getReceipt,
    syncReceipt,
    verifyReceipt,
    verifyReceiptFile,
  };
}

module.exports = {
  OPERATION_RECEIPT_SCHEMA_VERSION,
  RECEIPT_HASH_ALGORITHM,
  TERMINAL_RECEIPT_STATUSES,
  createReceiptError,
  buildReceipt,
  buildOperationStateDigest,
  buildOperationReceipt,
  verifyReceiptPayload,
  verifyOperationReceipt,
  hasReceiptSignature,
  isReceiptEligibleStatus,
  createOperationReceiptService,
};
