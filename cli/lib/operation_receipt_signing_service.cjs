'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveOperationsDir } = require('./operation_state_store.cjs');

const RECEIPT_SIGNATURE_ALGORITHM = 'ed25519';
const PRIVATE_KEY_FILE = 'receipt-signing-private.pem';
const PUBLIC_KEY_FILE = 'receipt-signing-public.pem';

function createReceiptSigningError(code, message, details) {
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

function writePemFile(filePath, value, mode) {
  fs.writeFileSync(filePath, value, { mode });
  try {
    fs.chmodSync(filePath, mode);
  } catch {
    // best-effort
  }
}

function resolveSigningKeyPaths(rootDir) {
  const resolvedRootDir = resolveOperationsDir(rootDir);
  return {
    rootDir: resolvedRootDir,
    privateKeyPath: path.join(resolvedRootDir, PRIVATE_KEY_FILE),
    publicKeyPath: path.join(resolvedRootDir, PUBLIC_KEY_FILE),
  };
}

function fingerprintPublicKey(publicKeyPem) {
  return crypto.createHash('sha256').update(String(publicKeyPem || '').trim()).digest('hex');
}

function generateSigningKeyPair() {
  return crypto.generateKeyPairSync(RECEIPT_SIGNATURE_ALGORITHM, {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
}

function createOperationReceiptSigningService(options = {}) {
  const paths = resolveSigningKeyPaths(options.rootDir || options.dir);
  let cached = null;

  function loadOrCreateKeyPair() {
    if (cached) return cached;
    ensurePrivateDirectory(paths.rootDir);
    if (fs.existsSync(paths.privateKeyPath) && fs.existsSync(paths.publicKeyPath)) {
      cached = {
        privateKeyPem: fs.readFileSync(paths.privateKeyPath, 'utf8'),
        publicKeyPem: fs.readFileSync(paths.publicKeyPath, 'utf8'),
      };
    } else {
      const generated = generateSigningKeyPair();
      writePemFile(paths.privateKeyPath, generated.privateKey, 0o600);
      writePemFile(paths.publicKeyPath, generated.publicKey, 0o644);
      cached = {
        privateKeyPem: generated.privateKey,
        publicKeyPem: generated.publicKey,
      };
    }
    cached.publicKeyFingerprint = fingerprintPublicKey(cached.publicKeyPem);
    cached.keyId = `receipt-signing:${cached.publicKeyFingerprint.slice(0, 16)}`;
    return cached;
  }

  function signReceiptHash(receiptHash) {
    if (typeof receiptHash !== 'string' || !receiptHash.trim()) {
      throw createReceiptSigningError('OPERATION_RECEIPT_SIGNING_INVALID_INPUT', 'Receipt signing requires a receiptHash string.');
    }
    const keyPair = loadOrCreateKeyPair();
    const signature = crypto.sign(null, Buffer.from(receiptHash, 'utf8'), keyPair.privateKeyPem).toString('base64');
    return {
      signatureAlgorithm: RECEIPT_SIGNATURE_ALGORITHM,
      signature,
      publicKeyPem: keyPair.publicKeyPem,
      publicKeyFingerprint: keyPair.publicKeyFingerprint,
      keyId: keyPair.keyId,
    };
  }

  function verifyReceiptHashSignature(receiptHash, receiptVerification) {
    const verification = receiptVerification && typeof receiptVerification === 'object' ? receiptVerification : {};
    if (!verification.signature || !verification.publicKeyPem) {
      return {
        ok: false,
        code: 'OPERATION_RECEIPT_SIGNATURE_MISSING',
        message: 'Receipt signature or public key is missing.',
      };
    }
    if (verification.signatureAlgorithm !== RECEIPT_SIGNATURE_ALGORITHM) {
      return {
        ok: false,
        code: 'OPERATION_RECEIPT_SIGNATURE_ALGORITHM_INVALID',
        message: `Unsupported receipt signature algorithm: ${verification.signatureAlgorithm || 'unknown'}`,
      };
    }
    const expectedFingerprint = fingerprintPublicKey(verification.publicKeyPem);
    if (verification.publicKeyFingerprint !== expectedFingerprint) {
      return {
        ok: false,
        code: 'OPERATION_RECEIPT_SIGNATURE_FINGERPRINT_INVALID',
        message: 'Receipt public key fingerprint does not match the embedded public key.',
        expectedFingerprint,
      };
    }
    try {
      const ok = crypto.verify(
        null,
        Buffer.from(String(receiptHash || ''), 'utf8'),
        verification.publicKeyPem,
        Buffer.from(String(verification.signature), 'base64'),
      );
      return {
        ok,
        code: ok ? 'OK' : 'OPERATION_RECEIPT_SIGNATURE_INVALID',
        message: ok ? null : 'Receipt signature verification failed.',
        expectedFingerprint,
      };
    } catch (error) {
      return {
        ok: false,
        code: 'OPERATION_RECEIPT_SIGNATURE_INVALID',
        message: error && error.message ? error.message : 'Receipt signature verification failed.',
        expectedFingerprint,
      };
    }
  }

  return {
    rootDir: paths.rootDir,
    privateKeyPath: paths.privateKeyPath,
    publicKeyPath: paths.publicKeyPath,
    signatureAlgorithm: RECEIPT_SIGNATURE_ALGORITHM,
    signReceiptHash,
    verifyReceiptHashSignature,
    getPublicMetadata() {
      const keyPair = loadOrCreateKeyPair();
      return {
        signatureAlgorithm: RECEIPT_SIGNATURE_ALGORITHM,
        publicKeyFingerprint: keyPair.publicKeyFingerprint,
        keyId: keyPair.keyId,
        publicKeyPem: keyPair.publicKeyPem,
      };
    },
  };
}

module.exports = {
  RECEIPT_SIGNATURE_ALGORITHM,
  PRIVATE_KEY_FILE,
  PUBLIC_KEY_FILE,
  createReceiptSigningError,
  fingerprintPublicKey,
  createOperationReceiptSigningService,
};
