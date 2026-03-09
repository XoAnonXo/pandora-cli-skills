'use strict';

const { createProfileError } = require('../shared/profile_errors.cjs');

const EXTERNAL_SIGNER_PROTOCOL_VERSION = 'pandora-external-signer/v1';
const EXTERNAL_SIGNER_DEFAULT_TIMEOUT_MS = 10_000;
const EXTERNAL_SIGNER_SUPPORTED_METHODS = Object.freeze([
  'signTransaction',
  'signTypedData',
]);
const EXTERNAL_SIGNER_DEFAULT_PATHS = Object.freeze({
  health: '/health',
  accounts: '/accounts',
  signTransaction: '/sign/transaction',
  signTypedData: '/sign/typed-data',
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeRequiredString(value, fieldName) {
  const text = normalizeOptionalString(value);
  if (!text) {
    throw signerError('EXTERNAL_SIGNER_REQUEST_INVALID', `${fieldName} is required.`, {
      field: fieldName,
    });
  }
  return text;
}

function normalizePositiveInteger(value, fieldName, options = {}) {
  if (value === null || value === undefined || value === '') {
    if (options.optional === true) return null;
    throw signerError('EXTERNAL_SIGNER_REQUEST_INVALID', `${fieldName} is required.`, {
      field: fieldName,
    });
  }
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw signerError('EXTERNAL_SIGNER_REQUEST_INVALID', `${fieldName} must be a positive integer.`, {
      field: fieldName,
      value,
    });
  }
  return numeric;
}

function normalizeTimeoutMs(value) {
  if (value === null || value === undefined || value === '') return EXTERNAL_SIGNER_DEFAULT_TIMEOUT_MS;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw signerError(
      'EXTERNAL_SIGNER_CONFIG_INVALID',
      'timeoutMs must be a positive integer when provided.',
      { field: 'timeoutMs', value },
    );
  }
  return numeric;
}

function normalizeBaseUrl(value) {
  const raw = normalizeRequiredString(value, 'baseUrl');
  let url;
  try {
    url = new URL(raw);
  } catch (err) {
    throw signerError('EXTERNAL_SIGNER_CONFIG_INVALID', 'baseUrl must be a valid absolute URL.', {
      field: 'baseUrl',
      value: raw,
      cause: err && err.message ? err.message : String(err),
    });
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw signerError('EXTERNAL_SIGNER_CONFIG_INVALID', 'baseUrl must use http or https.', {
      field: 'baseUrl',
      value: raw,
      protocol: url.protocol,
    });
  }
  return url.toString().replace(/\/+$/, '');
}

function normalizePath(value, fieldName) {
  const text = normalizeRequiredString(value, fieldName);
  if (!text.startsWith('/')) {
    throw signerError('EXTERNAL_SIGNER_CONFIG_INVALID', `${fieldName} must start with "/".`, {
      field: fieldName,
      value: text,
    });
  }
  return text;
}

function normalizeHeaderMap(value) {
  if (value === null || value === undefined) return {};
  if (!isPlainObject(value)) {
    throw signerError('EXTERNAL_SIGNER_CONFIG_INVALID', 'headers must be an object when provided.', {
      field: 'headers',
      value,
    });
  }
  const out = {};
  for (const [key, headerValue] of Object.entries(value)) {
    const normalizedKey = normalizeOptionalString(key);
    if (!normalizedKey) continue;
    if (headerValue === null || headerValue === undefined) continue;
    out[normalizedKey] = String(headerValue);
  }
  return out;
}

function getHeaderCaseInsensitive(headers, targetName) {
  const target = String(targetName || '').trim().toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).trim().toLowerCase() === target) {
      return value;
    }
  }
  return null;
}

function normalizeConfiguredMethods(value) {
  if (value === null || value === undefined) {
    return new Set(EXTERNAL_SIGNER_SUPPORTED_METHODS);
  }
  const items = Array.isArray(value) ? value : [value];
  const out = new Set();
  for (const entry of items) {
    const method = normalizeOptionalString(entry);
    if (!method) continue;
    if (!EXTERNAL_SIGNER_SUPPORTED_METHODS.includes(method)) {
      throw signerError('EXTERNAL_SIGNER_CONFIG_INVALID', `Unsupported external signer method: ${method}`, {
        field: 'supportedMethods',
        value: method,
        supported: EXTERNAL_SIGNER_SUPPORTED_METHODS,
      });
    }
    out.add(method);
  }
  if (!out.size) {
    throw signerError('EXTERNAL_SIGNER_CONFIG_INVALID', 'supportedMethods must contain at least one method.', {
      field: 'supportedMethods',
    });
  }
  return out;
}

function normalizeConfiguredChainIds(value) {
  if (value === null || value === undefined) return null;
  const items = Array.isArray(value) ? value : [value];
  const out = new Set();
  for (const entry of items) {
    out.add(normalizePositiveInteger(entry, 'chainIds[]'));
  }
  if (!out.size) {
    throw signerError('EXTERNAL_SIGNER_CONFIG_INVALID', 'chainIds must contain at least one chain id when provided.', {
      field: 'chainIds',
    });
  }
  return out;
}

function normalizeAddress(value, fieldName) {
  const text = normalizeRequiredString(value, fieldName);
  if (!/^0x[a-fA-F0-9]{40}$/.test(text)) {
    throw signerError('EXTERNAL_SIGNER_REQUEST_INVALID', `${fieldName} must be a 20-byte hex address.`, {
      field: fieldName,
      value: text,
    });
  }
  return text;
}

function normalizeProtocolVersion(value, fieldName, options = {}) {
  const protocolVersion = normalizeOptionalString(value);
  if (!protocolVersion) {
    if (options.optional === true) {
      return EXTERNAL_SIGNER_PROTOCOL_VERSION;
    }
    throw signerError('EXTERNAL_SIGNER_INVALID_RESPONSE', `${fieldName} is required.`, {
      field: fieldName,
    });
  }
  if (protocolVersion !== EXTERNAL_SIGNER_PROTOCOL_VERSION) {
    throw signerError(
      'EXTERNAL_SIGNER_PROTOCOL_MISMATCH',
      `External signer protocol mismatch. Expected ${EXTERNAL_SIGNER_PROTOCOL_VERSION}.`,
      {
        field: fieldName,
        expectedProtocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
        actualProtocolVersion: protocolVersion,
      },
    );
  }
  return protocolVersion;
}

function createTimeoutController(timeoutMs, externalSignal) {
  const controller = new AbortController();
  let timeoutHandle = null;
  let externalAbortListener = null;

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalAbortListener = () => controller.abort(externalSignal.reason);
      externalSignal.addEventListener('abort', externalAbortListener, { once: true });
    }
  }

  timeoutHandle = setTimeout(() => {
    const timeoutError = new Error(`External signer request timed out after ${timeoutMs}ms.`);
    timeoutError.name = 'AbortError';
    controller.abort(timeoutError);
  }, timeoutMs);

  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timeoutHandle);
      if (externalAbortListener && externalSignal) {
        externalSignal.removeEventListener('abort', externalAbortListener);
      }
    },
  };
}

function signerError(code, message, details) {
  return createProfileError(code, message, {
    backend: 'external-signer',
    ...(isPlainObject(details) ? details : {}),
  });
}

function stringifyRequestBody(value) {
  return JSON.stringify(value, (_key, entry) => (typeof entry === 'bigint' ? entry.toString() : entry));
}

function normalizeRemoteErrorPayload(payload, responseMeta = {}) {
  const errorObject = isPlainObject(payload) && isPlainObject(payload.error)
    ? payload.error
    : isPlainObject(payload)
      ? payload
      : null;

  const remoteCode = normalizeOptionalString(errorObject && errorObject.code);
  const remoteMessage = normalizeOptionalString(errorObject && errorObject.message);
  const remoteDetails = isPlainObject(errorObject && errorObject.details) ? errorObject.details : undefined;
  const retryable = errorObject && typeof errorObject.retryable === 'boolean'
    ? errorObject.retryable
    : undefined;
  const status = Number.isInteger(responseMeta.status) ? responseMeta.status : null;

  let code = 'EXTERNAL_SIGNER_REMOTE_ERROR';
  if (status === 401) code = 'EXTERNAL_SIGNER_UNAUTHORIZED';
  if (status === 403) code = 'EXTERNAL_SIGNER_FORBIDDEN';
  if (remoteCode === 'UNSUPPORTED_METHOD') code = 'EXTERNAL_SIGNER_METHOD_NOT_ALLOWED';
  if (remoteCode === 'UNSUPPORTED_CHAIN') code = 'EXTERNAL_SIGNER_CHAIN_NOT_ALLOWED';
  if (remoteCode === 'ACCOUNT_NOT_FOUND') code = 'EXTERNAL_SIGNER_ACCOUNT_NOT_FOUND';
  if (remoteCode === 'ACCOUNT_SELECTION_REQUIRED') code = 'EXTERNAL_SIGNER_ACCOUNT_SELECTION_REQUIRED';
  if (remoteCode === 'UNHEALTHY') code = 'EXTERNAL_SIGNER_UNHEALTHY';

  return signerError(
    code,
    remoteMessage || `External signer request failed${status ? ` with HTTP ${status}` : ''}.`,
    {
      ...responseMeta,
      remoteCode,
      remoteDetails,
      retryable,
    },
  );
}

function normalizeCapabilitiesFromPayload(data, options = {}) {
  const allowEmpty = options.allowEmpty !== false;
  if (!isPlainObject(data)) {
    if (allowEmpty) {
      return {
        protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
        methods: null,
        chainIds: null,
      };
    }
    throw signerError('EXTERNAL_SIGNER_INVALID_RESPONSE', 'External signer response data must be an object.', {
      field: 'data',
    });
  }

  const protocolVersion = normalizeProtocolVersion(
    data.protocolVersion,
    'data.protocolVersion',
    { optional: allowEmpty && options.requireProtocolVersion !== true },
  );
  let methods = null;
  if (Object.prototype.hasOwnProperty.call(data, 'methods') || Object.prototype.hasOwnProperty.call(data, 'supportedMethods')) {
    const source = Array.isArray(data.methods) ? data.methods : data.supportedMethods;
    if (!Array.isArray(source)) {
      throw signerError('EXTERNAL_SIGNER_INVALID_RESPONSE', 'External signer methods must be an array when provided.', {
        field: 'methods',
      });
    }
    methods = Array.from(normalizeConfiguredMethods(source));
  }

  let chainIds = null;
  if (Object.prototype.hasOwnProperty.call(data, 'chainIds') || Object.prototype.hasOwnProperty.call(data, 'supportedChainIds')) {
    const source = Array.isArray(data.chainIds) ? data.chainIds : data.supportedChainIds;
    if (!Array.isArray(source)) {
      throw signerError('EXTERNAL_SIGNER_INVALID_RESPONSE', 'External signer chainIds must be an array when provided.', {
        field: 'chainIds',
      });
    }
    chainIds = Array.from(normalizeConfiguredChainIds(source) || []);
  }

  return {
    protocolVersion,
    methods,
    chainIds,
  };
}

function normalizeAccountListPayload(data) {
  if (!isPlainObject(data)) {
    throw signerError('EXTERNAL_SIGNER_INVALID_RESPONSE', 'External signer accounts response must contain a data object.', {
      field: 'data',
    });
  }
  if (!Array.isArray(data.accounts)) {
    throw signerError('EXTERNAL_SIGNER_INVALID_RESPONSE', 'External signer accounts response must contain an accounts array.', {
      field: 'data.accounts',
    });
  }

  const capabilities = normalizeCapabilitiesFromPayload(data, {
    allowEmpty: false,
    requireProtocolVersion: true,
  });
  const accounts = data.accounts.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw signerError('EXTERNAL_SIGNER_INVALID_RESPONSE', 'Account entries must be objects.', {
        field: `data.accounts[${index}]`,
      });
    }
    const address = normalizeAddress(entry.address, `data.accounts[${index}].address`);
    const chainIds = Array.isArray(entry.chainIds)
      ? Array.from(normalizeConfiguredChainIds(entry.chainIds) || [])
      : null;
    const methods = Array.isArray(entry.methods)
      ? Array.from(normalizeConfiguredMethods(entry.methods))
      : null;
    return {
      address,
      chainIds,
      methods,
      labels: isPlainObject(entry.labels) ? { ...entry.labels } : {},
    };
  });

  return {
    protocolVersion: capabilities.protocolVersion,
    methods: capabilities.methods,
    chainIds: capabilities.chainIds,
    accounts,
  };
}

function normalizeSignResult(method, data) {
  if (!isPlainObject(data)) {
    throw signerError('EXTERNAL_SIGNER_INVALID_RESPONSE', 'External signer sign response must contain a data object.', {
      field: 'data',
      method,
    });
  }

  const signature = normalizeOptionalString(data.signature);
  const signedTransaction = normalizeOptionalString(data.signedTransaction);
  const hash = normalizeOptionalString(data.hash);

  if (method === 'signTypedData' && !signature) {
    throw signerError('EXTERNAL_SIGNER_INVALID_RESPONSE', 'signTypedData response must include signature.', {
      field: 'data.signature',
    });
  }

  if (method === 'signTransaction' && !signature && !signedTransaction) {
    throw signerError('EXTERNAL_SIGNER_INVALID_RESPONSE', 'signTransaction response must include signature or signedTransaction.', {
      field: 'data',
    });
  }

  return {
    protocolVersion: normalizeProtocolVersion(data.protocolVersion, 'data.protocolVersion'),
    account: normalizeOptionalString(data.account),
    chainId: data.chainId === undefined ? null : normalizePositiveInteger(data.chainId, 'data.chainId', { optional: true }),
    signature,
    signedTransaction,
    hash,
    raw: { ...data },
  };
}

function createExternalSignerBackend(options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw signerError('EXTERNAL_SIGNER_FETCH_MISSING', 'A fetch implementation is required.');
  }

  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const reference = normalizeOptionalString(options.reference);
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const paths = Object.freeze({
    health: normalizePath(options.healthPath || EXTERNAL_SIGNER_DEFAULT_PATHS.health, 'healthPath'),
    accounts: normalizePath(options.accountsPath || EXTERNAL_SIGNER_DEFAULT_PATHS.accounts, 'accountsPath'),
    signTransaction: normalizePath(options.signTransactionPath || EXTERNAL_SIGNER_DEFAULT_PATHS.signTransaction, 'signTransactionPath'),
    signTypedData: normalizePath(options.signTypedDataPath || EXTERNAL_SIGNER_DEFAULT_PATHS.signTypedData, 'signTypedDataPath'),
  });

  const headers = normalizeHeaderMap(options.headers);
  const configuredAuthorization = getHeaderCaseInsensitive(headers, 'authorization');
  const authToken = normalizeOptionalString(options.authToken);
  if (authToken && configuredAuthorization) {
    throw signerError(
      'EXTERNAL_SIGNER_CONFIG_INVALID',
      'authToken cannot be combined with an explicit Authorization header.',
      { field: 'authToken', header: 'Authorization' },
    );
  }

  const configuredMethods = normalizeConfiguredMethods(options.supportedMethods);
  const configuredChainIds = normalizeConfiguredChainIds(options.chainIds || options.chainAllowlist);
  const state = {
    protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
    configuredMethods: new Set(configuredMethods),
    configuredChainIds: configuredChainIds ? new Set(configuredChainIds) : null,
    methods: new Set(configuredMethods),
    chainIds: configuredChainIds ? new Set(configuredChainIds) : null,
    accounts: null,
    lastHealth: null,
  };

  function mergeDiscoveredCapabilities(capabilities = {}) {
    if (Array.isArray(capabilities.methods) && capabilities.methods.length) {
      const discoveredMethods = new Set(capabilities.methods);
      const effectiveMethods = Array.from(state.configuredMethods).filter((method) => discoveredMethods.has(method));
      if (!effectiveMethods.length) {
        throw signerError(
          'EXTERNAL_SIGNER_METHOD_NOT_ALLOWED',
          'External signer capabilities do not include any configured signing methods.',
          {
            configuredMethods: Array.from(state.configuredMethods),
            discoveredMethods: Array.from(discoveredMethods),
          },
        );
      }
      state.methods = new Set(effectiveMethods);
    }
    if (Array.isArray(capabilities.chainIds) && capabilities.chainIds.length) {
      const discoveredChainIds = new Set(capabilities.chainIds);
      if (state.configuredChainIds) {
        const effectiveChainIds = Array.from(state.configuredChainIds).filter((chainId) => discoveredChainIds.has(chainId));
        if (!effectiveChainIds.length) {
          throw signerError(
            'EXTERNAL_SIGNER_CHAIN_NOT_ALLOWED',
            'External signer capabilities do not include any configured chain ids.',
            {
              configuredChainIds: Array.from(state.configuredChainIds),
              discoveredChainIds: Array.from(discoveredChainIds),
            },
          );
        }
        state.chainIds = new Set(effectiveChainIds);
      } else {
        state.chainIds = discoveredChainIds;
      }
    }
    if (capabilities.protocolVersion) {
      state.protocolVersion = capabilities.protocolVersion;
    }
  }

  function buildRequestHeaders(extraHeaders = null, includeJsonBody = false) {
    const merged = {
      accept: 'application/json',
      'x-pandora-external-signer-protocol': state.protocolVersion || EXTERNAL_SIGNER_PROTOCOL_VERSION,
      ...headers,
      ...(isPlainObject(extraHeaders) ? extraHeaders : {}),
    };
    if (includeJsonBody) {
      merged['content-type'] = 'application/json';
    }
    if (authToken) {
      merged.Authorization = `Bearer ${authToken}`;
    }
    return merged;
  }

  function buildEndpointUrl(pathname, query = null) {
    const url = new URL(`${baseUrl}${pathname}`);
    if (isPlainObject(query)) {
      for (const [key, value] of Object.entries(query)) {
        if (value === null || value === undefined || value === '') continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  async function requestJson(method, pathname, options = {}) {
    const url = buildEndpointUrl(pathname, options.query);
    const timer = createTimeoutController(timeoutMs, options.signal);
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: buildRequestHeaders(options.headers, options.body !== undefined),
        body: options.body === undefined ? undefined : stringifyRequestBody(options.body),
        signal: timer.signal,
      });
    } catch (err) {
      const timeoutLike = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
      throw signerError(
        timeoutLike ? 'EXTERNAL_SIGNER_TIMEOUT' : 'EXTERNAL_SIGNER_REQUEST_FAILED',
        timeoutLike
          ? `External signer request timed out after ${timeoutMs}ms.`
          : 'External signer request failed.',
        {
          reference,
          baseUrl,
          url,
          method,
          cause: err && err.message ? err.message : String(err),
        },
      );
    } finally {
      timer.clear();
    }

    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw signerError('EXTERNAL_SIGNER_INVALID_RESPONSE', 'External signer returned invalid JSON.', {
        reference,
        baseUrl,
        url,
        method,
        status: response.status,
        cause: err && err.message ? err.message : String(err),
      });
    }

    if (!response.ok) {
      throw normalizeRemoteErrorPayload(payload, {
        reference,
        baseUrl,
        url,
        method,
        status: response.status,
      });
    }

    if (!isPlainObject(payload)) {
      throw signerError('EXTERNAL_SIGNER_INVALID_RESPONSE', 'External signer response must be a JSON object.', {
        reference,
        baseUrl,
        url,
        method,
      });
    }

    if (payload.ok === false) {
      throw normalizeRemoteErrorPayload(payload, {
        reference,
        baseUrl,
        url,
        method,
        status: response.status,
      });
    }

    if (payload.ok !== true) {
      throw signerError('EXTERNAL_SIGNER_INVALID_RESPONSE', 'External signer response must include ok=true.', {
        reference,
        baseUrl,
        url,
        method,
        status: response.status,
      });
    }

    return payload;
  }

  function ensureMethodAllowed(method) {
    const supported = state.methods || new Set(configuredMethods);
    if (!supported.has(method)) {
      throw signerError('EXTERNAL_SIGNER_METHOD_NOT_ALLOWED', `External signer does not support ${method}.`, {
        method,
        supportedMethods: Array.from(supported),
      });
    }
  }

  function ensureChainAllowed(chainId, method) {
    if (state.chainIds && !state.chainIds.has(chainId)) {
      throw signerError('EXTERNAL_SIGNER_CHAIN_NOT_ALLOWED', `External signer does not support chain ${chainId}.`, {
        method,
        chainId,
        allowedChainIds: Array.from(state.chainIds),
      });
    }
  }

  function ensureKnownAccount(account, chainId, method) {
    if (!Array.isArray(state.accounts)) return;
    if (!state.accounts.length) {
      throw signerError('EXTERNAL_SIGNER_ACCOUNT_NOT_FOUND', 'External signer did not return any usable accounts.', {
        method,
        account,
        chainId,
      });
    }
    const matched = state.accounts.find((entry) => entry.address.toLowerCase() === account.toLowerCase()) || null;
    if (!matched) {
      throw signerError('EXTERNAL_SIGNER_ACCOUNT_NOT_FOUND', `External signer account is not available: ${account}`, {
        method,
        account,
      });
    }
    if (chainId !== null && chainId !== undefined && Array.isArray(matched.chainIds) && matched.chainIds.length && !matched.chainIds.includes(chainId)) {
      throw signerError('EXTERNAL_SIGNER_CHAIN_NOT_ALLOWED', `External signer account ${account} does not support chain ${chainId}.`, {
        method,
        account,
        chainId,
        allowedChainIds: matched.chainIds,
      });
    }
    if (method && Array.isArray(matched.methods) && matched.methods.length && !matched.methods.includes(method)) {
      throw signerError('EXTERNAL_SIGNER_METHOD_NOT_ALLOWED', `External signer account ${account} does not support ${method}.`, {
        method,
        account,
        supportedMethods: matched.methods,
      });
    }
    return matched;
  }

  function filterEligibleAccounts(chainId, method) {
    if (!Array.isArray(state.accounts)) return [];
    return state.accounts.filter((entry) => {
      if (chainId !== null && chainId !== undefined && Array.isArray(entry.chainIds) && entry.chainIds.length && !entry.chainIds.includes(chainId)) {
        return false;
      }
      if (method && Array.isArray(entry.methods) && entry.methods.length && !entry.methods.includes(method)) {
        return false;
      }
      return true;
    });
  }

  function validateTransactionRequest(input) {
    const chainId = normalizePositiveInteger(input.chainId, 'chainId');
    const account = normalizeAddress(input.account || input.from, 'account');
    if (!isPlainObject(input.transaction)) {
      throw signerError('EXTERNAL_SIGNER_REQUEST_INVALID', 'transaction must be an object.', {
        field: 'transaction',
      });
    }
    if (Object.prototype.hasOwnProperty.call(input.transaction, 'from')) {
      const from = normalizeAddress(input.transaction.from, 'transaction.from');
      if (from.toLowerCase() !== account.toLowerCase()) {
        throw signerError('EXTERNAL_SIGNER_REQUEST_INVALID', 'transaction.from must match account.', {
          field: 'transaction.from',
          account,
          from,
        });
      }
    }
    if (Object.prototype.hasOwnProperty.call(input.transaction, 'chainId')) {
      const transactionChainId = normalizePositiveInteger(input.transaction.chainId, 'transaction.chainId');
      if (transactionChainId !== chainId) {
        throw signerError('EXTERNAL_SIGNER_REQUEST_INVALID', 'transaction.chainId must match chainId.', {
          field: 'transaction.chainId',
          chainId,
          transactionChainId,
        });
      }
    }
    return {
      chainId,
      account,
      transaction: { ...input.transaction },
      metadata: isPlainObject(input.metadata) ? { ...input.metadata } : {},
    };
  }

  function validateTypedDataRequest(input) {
    const chainId = normalizePositiveInteger(input.chainId, 'chainId');
    const account = normalizeAddress(input.account, 'account');
    if (!isPlainObject(input.typedData)) {
      throw signerError('EXTERNAL_SIGNER_REQUEST_INVALID', 'typedData must be an object.', {
        field: 'typedData',
      });
    }
    const domain = input.typedData.domain;
    if (domain !== undefined && domain !== null && !isPlainObject(domain)) {
      throw signerError('EXTERNAL_SIGNER_REQUEST_INVALID', 'typedData.domain must be an object when provided.', {
        field: 'typedData.domain',
      });
    }
    if (domain && Object.prototype.hasOwnProperty.call(domain, 'chainId')) {
      const domainChainId = normalizePositiveInteger(domain.chainId, 'typedData.domain.chainId');
      if (domainChainId !== chainId) {
        throw signerError('EXTERNAL_SIGNER_REQUEST_INVALID', 'typedData.domain.chainId must match chainId.', {
          field: 'typedData.domain.chainId',
          chainId,
          domainChainId,
        });
      }
    }
    return {
      chainId,
      account,
      typedData: { ...input.typedData },
      metadata: isPlainObject(input.metadata) ? { ...input.metadata } : {},
    };
  }

  return {
    protocolVersion: EXTERNAL_SIGNER_PROTOCOL_VERSION,
    getConfig() {
      return {
        backend: 'external-signer',
        baseUrl,
        reference,
        timeoutMs,
        paths: { ...paths },
        supportedMethods: Array.from(configuredMethods),
        chainIds: configuredChainIds ? Array.from(configuredChainIds) : null,
      };
    },

    getCapabilities() {
      return {
        protocolVersion: state.protocolVersion,
        methods: state.methods ? Array.from(state.methods) : null,
        chainIds: state.chainIds ? Array.from(state.chainIds) : null,
        accountsDiscovered: Array.isArray(state.accounts) ? state.accounts.length : 0,
        lastHealth: state.lastHealth ? { ...state.lastHealth } : null,
      };
    },

    async healthCheck(options = {}) {
      const payload = await requestJson('GET', paths.health, { signal: options.signal });
      const capabilities = normalizeCapabilitiesFromPayload(payload.data, {
        allowEmpty: false,
        requireProtocolVersion: true,
      });
      mergeDiscoveredCapabilities(capabilities);
      if (typeof payload.data.healthy !== 'boolean') {
        throw signerError('EXTERNAL_SIGNER_INVALID_RESPONSE', 'External signer health response must include boolean healthy.', {
          field: 'data.healthy',
        });
      }
      if (payload.data.healthy !== true) {
        throw signerError('EXTERNAL_SIGNER_UNHEALTHY', 'External signer reported unhealthy status.', {
          serviceId: normalizeOptionalString(payload.data.serviceId),
          version: normalizeOptionalString(payload.data.version),
        });
      }
      const result = {
        ok: true,
        healthy: true,
        protocolVersion: state.protocolVersion,
        methods: state.methods ? Array.from(state.methods) : [],
        chainIds: state.chainIds ? Array.from(state.chainIds) : [],
        serviceId: normalizeOptionalString(payload.data.serviceId),
        version: normalizeOptionalString(payload.data.version),
      };
      state.lastHealth = result;
      return result;
    },

    async listAccounts(options = {}) {
      const chainId = options.chainId === undefined ? null : normalizePositiveInteger(options.chainId, 'chainId', { optional: true });
      if (chainId !== null) {
        ensureChainAllowed(chainId, 'accounts');
      }
      const payload = await requestJson('GET', paths.accounts, {
        signal: options.signal,
        query: chainId === null ? null : { chainId },
      });
      const normalized = normalizeAccountListPayload(payload.data);
      mergeDiscoveredCapabilities(normalized);
      state.accounts = normalized.accounts;
      if (chainId !== null && normalized.accounts.length === 0) {
        throw signerError('EXTERNAL_SIGNER_ACCOUNT_NOT_FOUND', `External signer did not return any usable account for chain ${chainId}.`, {
          method: 'accounts',
          chainId,
        });
      }
      return {
        protocolVersion: state.protocolVersion,
        methods: state.methods ? Array.from(state.methods) : [],
        chainIds: state.chainIds ? Array.from(state.chainIds) : [],
        accounts: normalized.accounts.map((entry) => ({ ...entry })),
      };
    },

    async selectAccount(options = {}) {
      const chainId = options.chainId === undefined ? null : normalizePositiveInteger(options.chainId, 'chainId', { optional: true });
      const account = options.account === undefined || options.account === null
        ? null
        : normalizeAddress(options.account, 'account');
      const method = options.method === undefined || options.method === null
        ? null
        : normalizeRequiredString(options.method, 'method');

      if (method) {
        ensureMethodAllowed(method);
      }
      if (chainId !== null) {
        ensureChainAllowed(chainId, method || 'accounts');
      }
      if (!Array.isArray(state.accounts)) {
        await this.listAccounts({
          chainId,
          signal: options.signal,
        });
      }
      if (account) {
        const matched = ensureKnownAccount(account, chainId, method || 'accounts');
        return matched ? { ...matched } : null;
      }
      const eligibleAccounts = filterEligibleAccounts(chainId, method);
      if (!eligibleAccounts.length) {
        throw signerError('EXTERNAL_SIGNER_ACCOUNT_NOT_FOUND', 'External signer did not return any usable account for the requested execution context.', {
          method: method || 'accounts',
          chainId,
        });
      }
      if (eligibleAccounts.length > 1) {
        throw signerError(
          'EXTERNAL_SIGNER_ACCOUNT_SELECTION_REQUIRED',
          'External signer returned multiple usable accounts. Pin a specific wallet before execution.',
          {
            method: method || 'accounts',
            chainId,
            accounts: eligibleAccounts.map((entry) => entry.address),
          },
        );
      }
      return { ...eligibleAccounts[0] };
    },

    async signTransaction(input = {}) {
      ensureMethodAllowed('signTransaction');
      const request = validateTransactionRequest(input);
      ensureChainAllowed(request.chainId, 'signTransaction');
      ensureKnownAccount(request.account, request.chainId, 'signTransaction');
      const payload = await requestJson('POST', paths.signTransaction, {
        signal: input.signal,
        body: {
          protocolVersion: state.protocolVersion,
          method: 'signTransaction',
          chainId: request.chainId,
          account: request.account,
          payload: {
            transaction: request.transaction,
          },
          metadata: request.metadata,
        },
      });
      const result = normalizeSignResult('signTransaction', payload.data);
      if (result.chainId !== null && result.chainId !== request.chainId) {
        throw signerError('EXTERNAL_SIGNER_INVALID_RESPONSE', 'signTransaction response chainId does not match request chainId.', {
          method: 'signTransaction',
          chainId: request.chainId,
          responseChainId: result.chainId,
        });
      }
      if (result.account && result.account.toLowerCase() !== request.account.toLowerCase()) {
        throw signerError('EXTERNAL_SIGNER_INVALID_RESPONSE', 'signTransaction response account does not match request account.', {
          method: 'signTransaction',
          account: request.account,
          responseAccount: result.account,
        });
      }
      return result;
    },

    async signTypedData(input = {}) {
      ensureMethodAllowed('signTypedData');
      const request = validateTypedDataRequest(input);
      ensureChainAllowed(request.chainId, 'signTypedData');
      ensureKnownAccount(request.account, request.chainId, 'signTypedData');
      const payload = await requestJson('POST', paths.signTypedData, {
        signal: input.signal,
        body: {
          protocolVersion: state.protocolVersion,
          method: 'signTypedData',
          chainId: request.chainId,
          account: request.account,
          payload: {
            typedData: request.typedData,
          },
          metadata: request.metadata,
        },
      });
      const result = normalizeSignResult('signTypedData', payload.data);
      if (result.chainId !== null && result.chainId !== request.chainId) {
        throw signerError('EXTERNAL_SIGNER_INVALID_RESPONSE', 'signTypedData response chainId does not match request chainId.', {
          method: 'signTypedData',
          chainId: request.chainId,
          responseChainId: result.chainId,
        });
      }
      if (result.account && result.account.toLowerCase() !== request.account.toLowerCase()) {
        throw signerError('EXTERNAL_SIGNER_INVALID_RESPONSE', 'signTypedData response account does not match request account.', {
          method: 'signTypedData',
          account: request.account,
          responseAccount: result.account,
        });
      }
      return result;
    },
  };
}

module.exports = {
  EXTERNAL_SIGNER_PROTOCOL_VERSION,
  EXTERNAL_SIGNER_DEFAULT_TIMEOUT_MS,
  EXTERNAL_SIGNER_SUPPORTED_METHODS,
  EXTERNAL_SIGNER_DEFAULT_PATHS,
  createExternalSignerBackend,
};
