'use strict';

const FLASHBOTS_DEFAULT_RELAY_URL = 'https://relay.flashbots.net';
const DEFAULT_FLASHBOTS_RELAY_URL = FLASHBOTS_DEFAULT_RELAY_URL;
const DEFAULT_FLASHBOTS_TARGET_BLOCK_OFFSET = 1;
const FLASHBOTS_SUPPORTED_CHAIN_ID = 1;
const FLASHBOTS_JSONRPC_VERSION = '2.0';
const FLASHBOTS_DEFAULT_REQUEST_ID = 1;
const FLASHBOTS_TIMEOUT_MS = 15_000;
let cachedViemRuntimePromise = null;

const FLASHBOTS_METHODS = Object.freeze({
  sendPrivateTransaction: 'eth_sendPrivateTransaction',
  callBundle: 'eth_callBundle',
  sendBundle: 'eth_sendBundle',
});

function createFlashbotsError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details && typeof details === 'object') {
    error.details = details;
  }
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clonePlainObject(value) {
  return isPlainObject(value) ? { ...value } : {};
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeRelayUrl(value) {
  const text = normalizeOptionalString(value) || FLASHBOTS_DEFAULT_RELAY_URL;
  let parsed = null;
  try {
    parsed = new URL(text);
  } catch {
    throw createFlashbotsError('FLASHBOTS_INVALID_RELAY_URL', `Invalid Flashbots relay URL: ${text}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw createFlashbotsError('FLASHBOTS_INVALID_RELAY_URL', `Flashbots relay URL must use http(s): ${text}`);
  }
  return parsed.toString();
}

function normalizeFlashbotsRelayUrl(value) {
  return normalizeRelayUrl(value);
}

function normalizeTargetBlockOffset(value) {
  if (value === null || value === undefined || value === '') {
    return DEFAULT_FLASHBOTS_TARGET_BLOCK_OFFSET;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw createFlashbotsError(
      'FLASHBOTS_INVALID_TARGET_BLOCK_OFFSET',
      'Flashbots target block offset must be a positive integer.',
      { value },
    );
  }
  return numeric;
}

function normalizeHexValue(value, fieldName) {
  const text = normalizeOptionalString(value);
  if (!text || !/^0x[0-9a-fA-F]+$/.test(text) || text.length % 2 !== 0) {
    throw createFlashbotsError('FLASHBOTS_INVALID_HEX', `${fieldName} must be a 0x-prefixed hex string.`, {
      field: fieldName,
      value,
    });
  }
  return text.toLowerCase();
}

function normalizeHashArray(values, fieldName) {
  if (!Array.isArray(values) || values.length === 0) return undefined;
  return values.map((value, index) => normalizeHexValue(value, `${fieldName}[${index}]`));
}

function toRpcHexQuantity(value, fieldName, options = {}) {
  const allowBlockTag = options.allowBlockTag === true;
  const normalized = normalizeOptionalString(value);
  if (normalized !== null) {
    if (allowBlockTag && ['latest', 'pending', 'safe', 'finalized', 'earliest'].includes(normalized)) {
      return normalized;
    }
    if (/^0x[0-9a-fA-F]+$/.test(normalized)) {
      try {
        const numeric = BigInt(normalized);
        if (numeric < 0n) throw new Error('negative');
        return `0x${numeric.toString(16)}`;
      } catch {
        throw createFlashbotsError('FLASHBOTS_INVALID_QUANTITY', `${fieldName} must be a non-negative hex quantity.`, {
          field: fieldName,
          value,
        });
      }
    }
    if (/^\d+$/.test(normalized)) {
      return `0x${BigInt(normalized).toString(16)}`;
    }
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw createFlashbotsError('FLASHBOTS_INVALID_QUANTITY', `${fieldName} must be a non-negative integer.`, {
        field: fieldName,
        value,
      });
    }
    return `0x${value.toString(16)}`;
  }
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw createFlashbotsError('FLASHBOTS_INVALID_QUANTITY', `${fieldName} must be a non-negative integer.`, {
        field: fieldName,
        value: value.toString(),
      });
    }
    return `0x${value.toString(16)}`;
  }
  throw createFlashbotsError('FLASHBOTS_INVALID_QUANTITY', `${fieldName} must be a non-negative integer or hex quantity.`, {
    field: fieldName,
    value,
  });
}

function toOptionalTimestamp(value, fieldName) {
  if (value === null || value === undefined || value === '') return undefined;
  const normalized = normalizeOptionalString(value);
  if (normalized !== null && /^\d+$/.test(normalized)) {
    return Number(normalized);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw createFlashbotsError('FLASHBOTS_INVALID_TIMESTAMP', `${fieldName} must be a non-negative integer.`, {
        field: fieldName,
        value,
      });
    }
    return value;
  }
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw createFlashbotsError('FLASHBOTS_INVALID_TIMESTAMP', `${fieldName} must be a non-negative integer.`, {
        field: fieldName,
        value: value.toString(),
      });
    }
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric)) {
      throw createFlashbotsError('FLASHBOTS_INVALID_TIMESTAMP', `${fieldName} exceeds JavaScript safe integer range.`, {
        field: fieldName,
        value: value.toString(),
      });
    }
    return numeric;
  }
  throw createFlashbotsError('FLASHBOTS_INVALID_TIMESTAMP', `${fieldName} must be a non-negative integer.`, {
    field: fieldName,
    value,
  });
}

function buildFlashbotsJsonRpcBody(options = {}) {
  const method = normalizeOptionalString(options.method);
  if (!method) {
    throw createFlashbotsError('FLASHBOTS_INVALID_METHOD', 'Flashbots JSON-RPC method is required.');
  }
  return {
    jsonrpc: FLASHBOTS_JSONRPC_VERSION,
    id: Object.prototype.hasOwnProperty.call(options, 'id') ? options.id : FLASHBOTS_DEFAULT_REQUEST_ID,
    method,
    params: Array.isArray(options.params) ? options.params : [],
  };
}

function serializeFlashbotsJsonBody(body) {
  if (typeof body === 'string') {
    if (!body.trim()) {
      throw createFlashbotsError('FLASHBOTS_INVALID_BODY', 'Flashbots request body cannot be empty.');
    }
    return body;
  }
  if (body === null || body === undefined) {
    throw createFlashbotsError('FLASHBOTS_INVALID_BODY', 'Flashbots request body is required.');
  }
  try {
    return JSON.stringify(body);
  } catch (error) {
    throw createFlashbotsError('FLASHBOTS_INVALID_BODY', `Failed to serialize Flashbots request body: ${error.message}`, {
      cause: error.message,
    });
  }
}

async function loadViemRuntime() {
  if (!cachedViemRuntimePromise) {
    cachedViemRuntimePromise = Promise.all([
      import('viem'),
      import('viem/accounts'),
    ]).then(([viem, accounts]) => ({
      ...((viem && viem.default && typeof viem.default === 'object') ? viem.default : {}),
      ...(viem || {}),
      ...((accounts && accounts.default && typeof accounts.default === 'object') ? accounts.default : {}),
      ...(accounts || {}),
    }));
  }
  return cachedViemRuntimePromise;
}

async function resolveViemRuntime(viemRuntime) {
  const runtime = await loadViemRuntime();
  if (viemRuntime && typeof viemRuntime === 'object') {
    return {
      ...runtime,
      ...viemRuntime,
    };
  }
  return runtime;
}

function resolveFetchImpl(fetchImpl) {
  const candidate = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch;
  if (typeof candidate !== 'function') {
    throw createFlashbotsError('FLASHBOTS_FETCH_UNAVAILABLE', 'A fetch implementation is required to call the Flashbots relay.');
  }
  return candidate;
}

async function resolveAuthAccount(options = {}) {
  if (options.authAccount && typeof options.authAccount === 'object') {
    const address = normalizeOptionalString(options.authAccount.address);
    if (!address || typeof options.authAccount.signMessage !== 'function') {
      throw createFlashbotsError(
        'FLASHBOTS_INVALID_AUTH_ACCOUNT',
        'authAccount must include address and signMessage(message) support.',
      );
    }
    return options.authAccount;
  }
  const authPrivateKey = normalizeOptionalString(options.authPrivateKey);
  if (!authPrivateKey) {
    throw createFlashbotsError(
      'FLASHBOTS_AUTH_PRIVATE_KEY_REQUIRED',
      'authPrivateKey is required to sign X-Flashbots-Signature headers.',
    );
  }
  const runtime = await resolveViemRuntime(options.viemRuntime);
  if (typeof runtime.privateKeyToAccount !== 'function') {
    throw createFlashbotsError(
      'FLASHBOTS_VIEM_RUNTIME_INVALID',
      'viemRuntime.privateKeyToAccount is required to materialize the Flashbots auth signer.',
    );
  }
  return runtime.privateKeyToAccount(authPrivateKey);
}

async function signFlashbotsSignatureHeader(options = {}) {
  const runtime = await resolveViemRuntime(options.viemRuntime);
  if (typeof runtime.keccak256 !== 'function' || typeof runtime.stringToHex !== 'function') {
    throw createFlashbotsError(
      'FLASHBOTS_VIEM_RUNTIME_INVALID',
      'viemRuntime.keccak256 and viemRuntime.stringToHex are required to sign Flashbots requests.',
    );
  }
  const account = await resolveAuthAccount({
    authPrivateKey: options.authPrivateKey,
    authAccount: options.authAccount,
    viemRuntime: runtime,
  });
  if (typeof account.signMessage !== 'function') {
    throw createFlashbotsError(
      'FLASHBOTS_INVALID_AUTH_ACCOUNT',
      'Flashbots auth signer must implement signMessage().',
      { address: account.address || null },
    );
  }
  const bodyText = serializeFlashbotsJsonBody(options.body);
  const bodyHash = runtime.keccak256(runtime.stringToHex(bodyText));
  const signature = await account.signMessage({ message: { raw: bodyHash } });
  return {
    address: account.address,
    body: bodyText,
    bodyHash,
    signature,
    headerName: 'X-Flashbots-Signature',
    headerValue: `${account.address}:${signature}`,
  };
}

function buildPrivateTransactionParams(options = {}) {
  const request = {
    tx: normalizeHexValue(
      options.tx !== undefined ? options.tx : options.signedTransaction,
      'tx',
    ),
  };
  if (options.maxBlockNumber !== undefined && options.maxBlockNumber !== null) {
    request.maxBlockNumber = toRpcHexQuantity(options.maxBlockNumber, 'maxBlockNumber');
  }
  const preferences = clonePlainObject(options.preferences);
  if (options.fast !== undefined) {
    preferences.fast = Boolean(options.fast);
  }
  if (Object.keys(preferences).length > 0) {
    request.preferences = preferences;
  }
  return [request];
}

function buildCallBundleParams(options = {}) {
  const txs = Array.isArray(options.txs) ? options.txs : options.transactions;
  if (!Array.isArray(txs) || txs.length === 0) {
    throw createFlashbotsError('FLASHBOTS_INVALID_BUNDLE', 'eth_callBundle requires a non-empty txs array.');
  }
  const request = {
    txs: txs.map((tx, index) => normalizeHexValue(tx, `txs[${index}]`)),
    blockNumber: toRpcHexQuantity(
      options.blockNumber !== undefined ? options.blockNumber : options.targetBlockNumber,
      'blockNumber',
    ),
    stateBlockNumber: toRpcHexQuantity(
      options.stateBlockNumber !== undefined ? options.stateBlockNumber : 'latest',
      'stateBlockNumber',
      { allowBlockTag: true },
    ),
  };
  if (options.timestamp !== undefined && options.timestamp !== null) {
    request.timestamp = toOptionalTimestamp(options.timestamp, 'timestamp');
  }
  return [request];
}

function buildSendBundleParams(options = {}) {
  const txs = Array.isArray(options.txs) ? options.txs : options.transactions;
  if (!Array.isArray(txs) || txs.length === 0) {
    throw createFlashbotsError('FLASHBOTS_INVALID_BUNDLE', 'eth_sendBundle requires a non-empty txs array.');
  }
  const request = {
    txs: txs.map((tx, index) => normalizeHexValue(tx, `txs[${index}]`)),
    blockNumber: toRpcHexQuantity(
      options.blockNumber !== undefined ? options.blockNumber : options.targetBlockNumber,
      'blockNumber',
    ),
  };
  if (options.minTimestamp !== undefined && options.minTimestamp !== null) {
    request.minTimestamp = toOptionalTimestamp(options.minTimestamp, 'minTimestamp');
  }
  if (options.maxTimestamp !== undefined && options.maxTimestamp !== null) {
    request.maxTimestamp = toOptionalTimestamp(options.maxTimestamp, 'maxTimestamp');
  }
  const revertingTxHashes = normalizeHashArray(options.revertingTxHashes, 'revertingTxHashes');
  if (revertingTxHashes) request.revertingTxHashes = revertingTxHashes;
  const replacementUuid = normalizeOptionalString(options.replacementUuid);
  if (replacementUuid) request.replacementUuid = replacementUuid;
  if (Array.isArray(options.builders) && options.builders.length > 0) {
    request.builders = options.builders.map((value) => String(value).trim()).filter(Boolean);
  }
  return [request];
}

async function callFlashbotsJsonRpc(options = {}) {
  const relayUrl = normalizeRelayUrl(options.relayUrl);
  const request = buildFlashbotsJsonRpcBody(options);
  const body = serializeFlashbotsJsonBody(request);
  const signedHeader = await signFlashbotsSignatureHeader({
    body,
    authPrivateKey: options.authPrivateKey,
    authAccount: options.authAccount,
    viemRuntime: options.viemRuntime,
  });
  const fetchImpl = resolveFetchImpl(options.fetchImpl || options.fetch);
  const timeoutMs = Number.isSafeInteger(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : FLASHBOTS_TIMEOUT_MS;
  const headers = {
    ...clonePlainObject(options.headers),
    'content-type': 'application/json',
    'x-flashbots-signature': signedHeader.headerValue,
  };
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const externalSignal = options.signal || null;
  const signal = externalSignal || (controller ? controller.signal : undefined);
  let timeoutId = null;
  if (!externalSignal && controller && timeoutMs > 0) {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  let response = null;
  let responseText = '';
  let responseBody = null;
  try {
    response = await fetchImpl(relayUrl, {
      method: 'POST',
      headers,
      body,
      signal,
    });
    responseText = typeof response.text === 'function' ? await response.text() : '';
    if (responseText) {
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        responseBody = responseText;
      }
    }
  } catch (error) {
    throw createFlashbotsError('FLASHBOTS_REQUEST_FAILED', `Flashbots relay request failed: ${error.message}`, {
      relayUrl,
      method: request.method,
      cause: error.message,
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (!response || response.ok !== true) {
    const status = response ? response.status : null;
    const statusCode =
      status === 401 || status === 403
        ? 'FLASHBOTS_RELAY_FORBIDDEN'
        : 'FLASHBOTS_HTTP_ERROR';
    const statusMessage =
      status === 401 || status === 403
        ? `Flashbots relay rejected the request with HTTP ${status}.`
        : `Flashbots relay responded with HTTP ${response ? response.status : 'unknown'}.`;
    throw createFlashbotsError(
      statusCode,
      statusMessage,
      {
        relayUrl,
        method: request.method,
        status,
        statusText: response ? response.statusText : null,
        response: responseBody,
        relayRejected: status === 401 || status === 403,
        preSubmissionFailure: true,
      },
    );
  }

  if (!isPlainObject(responseBody)) {
    throw createFlashbotsError(
      'FLASHBOTS_INVALID_RESPONSE',
      'Flashbots relay returned a non-JSON or malformed JSON-RPC response.',
      {
        relayUrl,
        method: request.method,
        response: responseBody,
      },
    );
  }

  if (responseBody.error) {
    throw createFlashbotsError(
      'FLASHBOTS_RPC_ERROR',
      `Flashbots relay rejected ${request.method}: ${responseBody.error.message || 'unknown error'}`,
      {
        relayUrl,
        method: request.method,
        rpcError: responseBody.error,
      },
    );
  }

  return {
    relayUrl,
    method: request.method,
    request,
    requestBody: body,
    authAddress: signedHeader.address,
    signature: signedHeader.signature,
    signatureHeader: signedHeader.headerValue,
    headers,
    response: responseBody,
    result: Object.prototype.hasOwnProperty.call(responseBody, 'result') ? responseBody.result : null,
  };
}

async function sendPrivateTransaction(options = {}) {
  return callFlashbotsJsonRpc({
    ...options,
    method: FLASHBOTS_METHODS.sendPrivateTransaction,
    params: buildPrivateTransactionParams(options),
  });
}

async function simulateBundle(options = {}) {
  return callFlashbotsJsonRpc({
    ...options,
    method: FLASHBOTS_METHODS.callBundle,
    params: buildCallBundleParams(options),
  });
}

async function sendBundle(options = {}) {
  return callFlashbotsJsonRpc({
    ...options,
    method: FLASHBOTS_METHODS.sendBundle,
    params: buildSendBundleParams(options),
  });
}

function toSafeNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : value.toString();
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : value;
  }
  return value;
}

function extractRelayResponseId(response) {
  if (!response || !Object.prototype.hasOwnProperty.call(response, 'id')) return null;
  return response.id;
}

function extractPrivateTransactionHash(result, fallbackHash) {
  if (typeof result === 'string' && /^0x[0-9a-fA-F]{64}$/.test(result)) {
    return result.toLowerCase();
  }
  if (isPlainObject(result)) {
    for (const key of ['txHash', 'transactionHash']) {
      if (typeof result[key] === 'string' && /^0x[0-9a-fA-F]{64}$/.test(result[key])) {
        return result[key].toLowerCase();
      }
    }
  }
  return fallbackHash || null;
}

function extractBundleHash(result) {
  if (typeof result === 'string' && /^0x[0-9a-fA-F]{64}$/.test(result)) {
    return result.toLowerCase();
  }
  if (isPlainObject(result)) {
    for (const key of ['bundleHash', 'bundle_hash']) {
      if (typeof result[key] === 'string' && /^0x[0-9a-fA-F]{64}$/.test(result[key])) {
        return result[key].toLowerCase();
      }
    }
  }
  return null;
}

function extractSimulationFailure(result) {
  if (!result) return null;
  if (typeof result === 'string' && result.trim()) {
    return result.trim();
  }
  if (isPlainObject(result)) {
    for (const key of ['error', 'revert', 'revertReason', 'firstRevert', 'message']) {
      const value = result[key];
      if (!value) continue;
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (isPlainObject(value) && typeof value.message === 'string' && value.message.trim()) {
        return value.message.trim();
      }
    }
    if (Array.isArray(result.results)) {
      for (const entry of result.results) {
        const nested = extractSimulationFailure(entry);
        if (nested) return nested;
      }
    }
  }
  return null;
}

async function signTransactionRequest(options = {}) {
  const transactionRequest = isPlainObject(options.transactionRequest)
    ? { ...options.transactionRequest }
    : null;
  if (!transactionRequest) {
    throw createFlashbotsError(
      'FLASHBOTS_TRANSACTION_REQUEST_REQUIRED',
      'transactionRequest is required for Flashbots private routing.',
    );
  }
  const walletClient = options.walletClient && typeof options.walletClient === 'object'
    ? options.walletClient
    : null;
  const account = options.account || (walletClient ? walletClient.account : null);
  if (account && transactionRequest.account === undefined) {
    transactionRequest.account = account;
  }
  if (
    walletClient
    && walletClient.chain
    && Number.isInteger(walletClient.chain.id)
    && transactionRequest.chainId === undefined
  ) {
    transactionRequest.chainId = walletClient.chain.id;
  }
  if (walletClient && typeof walletClient.signTransaction === 'function') {
    return walletClient.signTransaction(transactionRequest);
  }
  if (account && typeof account.signTransaction === 'function') {
    return account.signTransaction(transactionRequest);
  }
  throw createFlashbotsError(
    'FLASHBOTS_SIGNER_UNAVAILABLE',
    'walletClient.signTransaction or account.signTransaction is required for Flashbots private routing.',
  );
}

async function resolveTargetBlockNumber(publicClient, offset) {
  if (!publicClient || typeof publicClient.getBlockNumber !== 'function') {
    throw createFlashbotsError(
      'FLASHBOTS_PUBLIC_CLIENT_REQUIRED',
      'publicClient.getBlockNumber() is required for Flashbots private routing.',
    );
  }
  const blockNumber = await publicClient.getBlockNumber();
  return BigInt(blockNumber) + BigInt(normalizeTargetBlockOffset(offset));
}

async function resolveSignedTransactionHash(signedTransaction, viemRuntime) {
  const runtime = await resolveViemRuntime(viemRuntime);
  if (typeof runtime.keccak256 !== 'function') {
    throw createFlashbotsError(
      'FLASHBOTS_VIEM_RUNTIME_INVALID',
      'viemRuntime.keccak256 is required to derive signed transaction hashes.',
    );
  }
  return runtime.keccak256(normalizeHexValue(signedTransaction, 'signedTransaction'));
}

function decorateFlashbotsError(error, details = {}) {
  const base = error instanceof Error
    ? error
    : createFlashbotsError('FLASHBOTS_ROUTE_FAILED', String(error || 'Flashbots routing failed.'));
  base.details = {
    ...(base.details && typeof base.details === 'object' ? base.details : {}),
    ...details,
  };
  return base;
}

async function sendFlashbotsPrivateTransaction(options = {}) {
  const relayUrl = normalizeRelayUrl(options.relayUrl);
  let targetBlockNumber = null;
  let signedTransaction = null;
  let transactionHash = null;
  try {
    targetBlockNumber = await resolveTargetBlockNumber(options.publicClient, options.targetBlockOffset);
    signedTransaction = await signTransactionRequest(options);
    transactionHash = await resolveSignedTransactionHash(signedTransaction, options.viemRuntime);
    const relayCall = await sendPrivateTransaction({
      relayUrl,
      authPrivateKey: options.authPrivateKey,
      authAccount: options.authAccount,
      viemRuntime: options.viemRuntime,
      fetchImpl: options.fetchImpl,
      tx: signedTransaction,
      maxBlockNumber: targetBlockNumber,
      preferences: options.preferences,
      fast: options.fast,
      timeoutMs: options.timeoutMs,
    });
    return {
      relayUrl: relayCall.relayUrl,
      relayMethod: relayCall.method,
      relayResponseId: extractRelayResponseId(relayCall.response),
      targetBlockNumber: toSafeNumber(targetBlockNumber),
      signedTransaction,
      transactionHash: extractPrivateTransactionHash(relayCall.result, transactionHash),
      response: cloneJson(relayCall.response),
      result: cloneJson(relayCall.result),
    };
  } catch (error) {
    throw decorateFlashbotsError(error, {
      relayUrl,
      relayMethod: FLASHBOTS_METHODS.sendPrivateTransaction,
      targetBlockNumber: targetBlockNumber === null ? null : toSafeNumber(targetBlockNumber),
      transactionHash,
    });
  }
}

async function sendFlashbotsBundle(options = {}) {
  const transactionRequests = Array.isArray(options.transactionRequests)
    ? options.transactionRequests
    : [];
  if (!transactionRequests.length) {
    throw createFlashbotsError(
      'FLASHBOTS_INVALID_BUNDLE',
      'transactionRequests must contain at least one signed transaction request.',
    );
  }
  const relayUrl = normalizeRelayUrl(options.relayUrl);
  let targetBlockNumber = null;
  const signedTransactions = [];
  const transactionHashes = [];
  try {
    targetBlockNumber = await resolveTargetBlockNumber(options.publicClient, options.targetBlockOffset);
    for (const transactionRequest of transactionRequests) {
      const signedTransaction = await signTransactionRequest({
        ...options,
        transactionRequest,
      });
      signedTransactions.push(signedTransaction);
      transactionHashes.push(await resolveSignedTransactionHash(signedTransaction, options.viemRuntime));
    }
  } catch (error) {
    throw decorateFlashbotsError(error, {
      relayUrl,
      relayMethod: FLASHBOTS_METHODS.sendBundle,
      targetBlockNumber: targetBlockNumber === null ? null : toSafeNumber(targetBlockNumber),
      transactionHashes,
    });
  }

  let simulationCall;
  try {
    simulationCall = await simulateBundle({
      relayUrl,
      authPrivateKey: options.authPrivateKey,
      authAccount: options.authAccount,
      viemRuntime: options.viemRuntime,
      fetchImpl: options.fetchImpl,
      txs: signedTransactions,
      blockNumber: targetBlockNumber,
      stateBlockNumber: options.stateBlockNumber || 'latest',
      timestamp: options.timestamp,
      timeoutMs: options.timeoutMs,
    });
  } catch (error) {
    throw decorateFlashbotsError(error, {
      relayUrl,
      relayMethod: FLASHBOTS_METHODS.callBundle,
      targetBlockNumber: toSafeNumber(targetBlockNumber),
      transactionHashes,
    });
  }

  const simulationFailure = extractSimulationFailure(simulationCall.result);
  if (simulationFailure) {
    throw createFlashbotsError(
      'FLASHBOTS_BUNDLE_SIMULATION_FAILED',
      `Flashbots bundle simulation failed: ${simulationFailure}`,
      {
        relayUrl: simulationCall.relayUrl,
        relayMethod: simulationCall.method,
        targetBlockNumber: toSafeNumber(targetBlockNumber),
        transactionHashes,
        simulation: cloneJson(simulationCall.result),
      },
    );
  }

  try {
    const relayCall = await sendBundle({
      relayUrl,
      authPrivateKey: options.authPrivateKey,
      authAccount: options.authAccount,
      viemRuntime: options.viemRuntime,
      fetchImpl: options.fetchImpl,
      txs: signedTransactions,
      blockNumber: targetBlockNumber,
      minTimestamp: options.minTimestamp,
      maxTimestamp: options.maxTimestamp,
      revertingTxHashes: options.revertingTxHashes,
      replacementUuid: options.replacementUuid,
      builders: options.builders,
      timeoutMs: options.timeoutMs,
    });
    return {
      relayUrl: relayCall.relayUrl,
      relayMethod: relayCall.method,
      relayResponseId: extractRelayResponseId(relayCall.response),
      targetBlockNumber: toSafeNumber(targetBlockNumber),
      signedTransactions,
      transactionHashes,
      bundleHash: extractBundleHash(relayCall.result),
      simulation: cloneJson(simulationCall.result),
      response: cloneJson(relayCall.response),
      result: cloneJson(relayCall.result),
    };
  } catch (error) {
    throw decorateFlashbotsError(error, {
      relayUrl,
      relayMethod: FLASHBOTS_METHODS.sendBundle,
      targetBlockNumber: toSafeNumber(targetBlockNumber),
      transactionHashes,
      simulation: cloneJson(simulationCall.result),
    });
  }
}

module.exports = {
  DEFAULT_FLASHBOTS_RELAY_URL,
  DEFAULT_FLASHBOTS_TARGET_BLOCK_OFFSET,
  FLASHBOTS_SUPPORTED_CHAIN_ID,
  FLASHBOTS_DEFAULT_RELAY_URL,
  FLASHBOTS_JSONRPC_VERSION,
  FLASHBOTS_DEFAULT_REQUEST_ID,
  FLASHBOTS_TIMEOUT_MS,
  FLASHBOTS_METHODS,
  createFlashbotsError,
  normalizeFlashbotsRelayUrl,
  normalizeTargetBlockOffset,
  buildFlashbotsJsonRpcBody,
  serializeFlashbotsJsonBody,
  signFlashbotsSignatureHeader,
  callFlashbotsJsonRpc,
  buildPrivateTransactionParams,
  buildCallBundleParams,
  buildSendBundleParams,
  sendPrivateTransaction,
  simulateBundle,
  sendBundle,
  sendFlashbotsPrivateTransaction,
  sendFlashbotsBundle,
  loadViemRuntime,
};
