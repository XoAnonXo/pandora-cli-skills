const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

const { buildCapabilitiesPayloadAsync } = require('./capabilities_command_service.cjs');
const { buildBootstrapPayloadAsync } = require('./bootstrap_command_service.cjs');
const { createOperationService } = require('./operation_service.cjs');
const { createMcpProtocolService } = require('./mcp_protocol_service.cjs');
const { buildCommandDescriptors } = require('./agent_contract_registry.cjs');
const COMMAND_DESCRIPTORS = buildCommandDescriptors();

function createGatewayError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function normalizePath(value, fallback) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function normalizeBaseUrl(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw createGatewayError('INVALID_FLAG_VALUE', '--public-base-url must be an absolute http/https URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw createGatewayError('INVALID_FLAG_VALUE', '--public-base-url must use http or https.');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
}

function parseCsvList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function parseTruthyQueryParam(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function isWildcardHost(host) {
  const normalized = String(host || '').trim().toLowerCase();
  return normalized === '0.0.0.0' || normalized === '::' || normalized === '[::]';
}

function buildDefaultRemoteScopes() {
  const knownScopes = new Set(
    Object.values(COMMAND_DESCRIPTORS).flatMap((descriptor) =>
      Array.isArray(descriptor && descriptor.policyScopes) ? descriptor.policyScopes : []
    ),
  );
  return [
    'capabilities:read',
    'contracts:read',
    'help:read',
    'operations:read',
    'schema:read',
  ].filter((scope) => knownScopes.has(scope));
}

function readJsonRequest(req, options = {}) {
  const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0
    ? options.maxBytes
    : 1024 * 1024;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(createGatewayError('REQUEST_TOO_LARGE', 'Gateway request body exceeds the allowed size.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(payload && typeof payload === 'object' ? payload : {});
      } catch (error) {
        reject(createGatewayError('INVALID_JSON', 'Gateway request body must be valid JSON.', {
          cause: error && error.message ? error.message : String(error),
        }));
      }
    });
    req.on('error', reject);
  });
}

function safeTokenEquals(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  try {
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
  } catch {
    return false;
  }
}

function buildTokenDigest(token) {
  return `sha256:${crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex')}`;
}

function ensurePrivateDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
  try {
    fs.chmodSync(directoryPath, 0o700);
  } catch {
    // best effort
  }
}

function writeSecretTokenFile(filePath, token) {
  ensurePrivateDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, `${token}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best effort
  }
  return filePath;
}

function resolveDefaultGeneratedAuthTokenFile() {
  const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
  if (!homeDir) {
    throw createGatewayError(
      'INVALID_FLAG_VALUE',
      'Cannot determine a home directory for a generated auth token. Pass --auth-token or --auth-token-file explicitly.',
    );
  }
  return path.join(homeDir, '.pandora', 'mcp-http', 'auth-token');
}

function writeJsonFileAtomic(filePath, payload) {
  const directory = path.dirname(filePath);
  ensurePrivateDirectory(directory);
  const tmpFile = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  fs.writeFileSync(tmpFile, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(tmpFile, 0o600);
  } catch {
    // best effort
  }
  fs.renameSync(tmpFile, filePath);
}

function readAuthTokenFromFile(filePath) {
  const token = fs.readFileSync(filePath, 'utf8').trim();
  if (!token) {
    throw createGatewayError('INVALID_FLAG_VALUE', '--auth-token-file must contain a non-empty token.');
  }
  return token;
}

function readAuthTokenRecordsFromFile(filePath) {
  let document;
  try {
    document = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw createGatewayError('INVALID_FLAG_VALUE', '--auth-tokens-file must contain valid JSON.', {
      filePath,
      cause: error && error.message ? error.message : String(error),
    });
  }
  const rawTokens = Array.isArray(document)
    ? document
    : Array.isArray(document && document.tokens)
      ? document.tokens
      : null;
  if (!rawTokens || !rawTokens.length) {
    throw createGatewayError('INVALID_FLAG_VALUE', '--auth-tokens-file must define a non-empty tokens array.', {
      filePath,
    });
  }
  const byId = new Set();
  const byToken = new Set();
  return rawTokens.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw createGatewayError('INVALID_FLAG_VALUE', '--auth-tokens-file tokens entries must be JSON objects.', {
        filePath,
        index,
      });
    }
    const id = normalizeOptionalText(entry.id);
    const token = normalizeOptionalText(entry.token);
    const status = normalizeOptionalText(entry.status) || 'active';
    const scopes = Array.isArray(entry.scopes)
      ? entry.scopes.map((scope) => String(scope || '').trim()).filter(Boolean)
      : [];
    if (!id) {
      throw createGatewayError('INVALID_FLAG_VALUE', '--auth-tokens-file token entries require id.', {
        filePath,
        index,
      });
    }
    if (!token && status !== 'revoked') {
      throw createGatewayError('INVALID_FLAG_VALUE', '--auth-tokens-file token entries require token.', {
        filePath,
        index,
        id,
      });
    }
    if (byId.has(id)) {
      throw createGatewayError('INVALID_FLAG_VALUE', `Duplicate auth token id in --auth-tokens-file: ${id}`, {
        filePath,
        id,
      });
    }
    const normalizedToken = token || crypto.randomBytes(24).toString('hex');
    if (byToken.has(normalizedToken)) {
      throw createGatewayError('INVALID_FLAG_VALUE', `Duplicate auth token value in --auth-tokens-file for id ${id}.`, {
        filePath,
        id,
      });
    }
    byId.add(id);
    byToken.add(normalizedToken);
    return {
      id,
      token: normalizedToken,
      scopes: scopes.length ? Array.from(new Set(scopes)) : buildDefaultRemoteScopes(),
    };
  });
}

function writeGeneratedAuthToken(token) {
  return writeSecretTokenFile(resolveDefaultGeneratedAuthTokenFile(), token);
}

function parseMcpHttpFlags(args = []) {
  const options = {
    host: '127.0.0.1',
    port: 8787,
    mcpPath: '/mcp',
    healthPath: '/health',
    readyPath: '/ready',
    metricsPath: '/metrics',
    bootstrapPath: '/bootstrap',
    capabilitiesPath: '/capabilities',
    schemaPath: '/schema',
    toolsPath: '/tools',
    operationsPath: '/operations',
    publicBaseUrl: null,
    authToken: null,
    authTokenFile: null,
    authTokensFile: null,
    authScopes: null,
    toolExposureMode: 'full',
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] || '');
    const next = args[index + 1];
    switch (token) {
      case '--host':
        if (!next) throw createGatewayError('MISSING_REQUIRED_FLAG', '--host requires a value.');
        options.host = String(next).trim();
        index += 1;
        break;
      case '--port':
        if (!next) throw createGatewayError('MISSING_REQUIRED_FLAG', '--port requires a value.');
        options.port = Number.parseInt(String(next), 10);
        index += 1;
        break;
      case '--path':
      case '--mcp-path':
        if (!next) throw createGatewayError('MISSING_REQUIRED_FLAG', `${token} requires a value.`);
        options.mcpPath = normalizePath(next, '/mcp');
        index += 1;
        break;
      case '--health-path':
        if (!next) throw createGatewayError('MISSING_REQUIRED_FLAG', '--health-path requires a value.');
        options.healthPath = normalizePath(next, '/health');
        index += 1;
        break;
      case '--ready-path':
        if (!next) throw createGatewayError('MISSING_REQUIRED_FLAG', '--ready-path requires a value.');
        options.readyPath = normalizePath(next, '/ready');
        index += 1;
        break;
      case '--metrics-path':
        if (!next) throw createGatewayError('MISSING_REQUIRED_FLAG', '--metrics-path requires a value.');
        options.metricsPath = normalizePath(next, '/metrics');
        index += 1;
        break;
      case '--bootstrap-path':
        if (!next) throw createGatewayError('MISSING_REQUIRED_FLAG', '--bootstrap-path requires a value.');
        options.bootstrapPath = normalizePath(next, '/bootstrap');
        index += 1;
        break;
      case '--capabilities-path':
        if (!next) throw createGatewayError('MISSING_REQUIRED_FLAG', '--capabilities-path requires a value.');
        options.capabilitiesPath = normalizePath(next, '/capabilities');
        index += 1;
        break;
      case '--schema-path':
        if (!next) throw createGatewayError('MISSING_REQUIRED_FLAG', '--schema-path requires a value.');
        options.schemaPath = normalizePath(next, '/schema');
        index += 1;
        break;
      case '--tools-path':
        if (!next) throw createGatewayError('MISSING_REQUIRED_FLAG', '--tools-path requires a value.');
        options.toolsPath = normalizePath(next, '/tools');
        index += 1;
        break;
      case '--operations-path':
        if (!next) throw createGatewayError('MISSING_REQUIRED_FLAG', '--operations-path requires a value.');
        options.operationsPath = normalizePath(next, '/operations');
        index += 1;
        break;
      case '--public-base-url':
        if (!next) throw createGatewayError('MISSING_REQUIRED_FLAG', '--public-base-url requires a value.');
        options.publicBaseUrl = normalizeBaseUrl(next);
        index += 1;
        break;
      case '--auth-token':
        if (!next) throw createGatewayError('MISSING_REQUIRED_FLAG', '--auth-token requires a value.');
        options.authToken = String(next).trim();
        index += 1;
        break;
      case '--auth-token-file':
        if (!next) throw createGatewayError('MISSING_REQUIRED_FLAG', '--auth-token-file requires a value.');
        options.authTokenFile = String(next).trim();
        index += 1;
        break;
      case '--auth-tokens-file':
        if (!next) throw createGatewayError('MISSING_REQUIRED_FLAG', '--auth-tokens-file requires a value.');
        options.authTokensFile = String(next).trim();
        index += 1;
        break;
      case '--auth-scopes':
        if (!next) throw createGatewayError('MISSING_REQUIRED_FLAG', '--auth-scopes requires a value.');
        options.authScopes = parseCsvList(next);
        index += 1;
        break;
      case '--compact-tools':
      case '--code-mode':
        options.toolExposureMode = 'compact';
        break;
      default:
        throw createGatewayError('UNKNOWN_FLAG', `Unknown mcp http flag: ${token}`);
    }
  }

  if (!options.host) {
    throw createGatewayError('INVALID_FLAG_VALUE', '--host must be a non-empty string.');
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw createGatewayError('INVALID_FLAG_VALUE', '--port must be an integer between 0 and 65535.');
  }
  if (options.authToken && options.authTokenFile) {
    throw createGatewayError('INVALID_ARGS', 'Provide only one of --auth-token or --auth-token-file.');
  }
  if (options.authTokensFile && (options.authToken || options.authTokenFile || (options.authScopes && options.authScopes.length))) {
    throw createGatewayError('INVALID_ARGS', '--auth-tokens-file cannot be combined with --auth-token, --auth-token-file, or --auth-scopes.');
  }

  const authTokenRecords = options.authTokensFile
    ? readAuthTokenRecordsFromFile(options.authTokensFile)
    : (() => {
      const authToken = options.authTokenFile
        ? readAuthTokenFromFile(options.authTokenFile)
        : options.authToken || crypto.randomBytes(24).toString('hex');
      const authTokenGenerated = !options.authToken && !options.authTokenFile;
      const authScopes = options.authScopes && options.authScopes.length
        ? Array.from(new Set(options.authScopes))
        : buildDefaultRemoteScopes();
      return [{
        id: 'default',
        token: authToken,
        scopes: authScopes,
        generated: authTokenGenerated,
      }];
    })();

  return {
    host: options.host,
    port: options.port,
    mcpPath: options.mcpPath,
    healthPath: options.healthPath,
    readyPath: options.readyPath,
    metricsPath: options.metricsPath,
    bootstrapPath: options.bootstrapPath,
    capabilitiesPath: options.capabilitiesPath,
    schemaPath: options.schemaPath,
    toolsPath: options.toolsPath,
    operationsPath: options.operationsPath,
    toolExposureMode: options.toolExposureMode,
    publicBaseUrl: options.publicBaseUrl,
    authTokenRecords,
    authSourceMode: options.authTokensFile
      ? 'tokens-file'
      : options.authTokenFile
        ? 'single-file'
        : options.authToken
          ? 'inline'
          : 'generated',
    authTokenFile: options.authTokenFile || null,
    authTokensFile: options.authTokensFile || null,
  };
}

function normalizePrincipalType(value) {
  const text = normalizeOptionalText(value);
  if (!text) return 'service';
  return text;
}

function inferPrincipalTemplate(scopes) {
  const grantedScopes = Array.isArray(scopes) ? scopes : [];
  if (grantedScopes.some((scope) => String(scope).startsWith('gateway:auth:'))) return 'gateway-admin';
  if (grantedScopes.some((scope) => scope === 'operations:write' || scope === 'mirror:write' || scope === 'trade:write')) {
    return 'operator-execute';
  }
  return 'read-only-researcher';
}

function normalizeAuthTokenRecord(entry, options = {}) {
  const now = new Date().toISOString();
  const indexLabel = Number.isInteger(options.index) ? ` at index ${options.index}` : '';
  const sourceMode = normalizeOptionalText(options.sourceMode) || 'inline';
  const id = normalizeOptionalText(entry && (entry.id || entry.principalId));
  if (!id) {
    throw createGatewayError('INVALID_FLAG_VALUE', `Auth token record${indexLabel} is missing id.`, {
      sourceMode,
      index: options.index,
    });
  }

  const status = normalizeOptionalText(entry && entry.status) || 'active';
  if (!['active', 'revoked'].includes(status)) {
    throw createGatewayError('INVALID_FLAG_VALUE', `Auth token record ${id} has unsupported status: ${status}`, {
      sourceMode,
      index: options.index,
      status,
    });
  }

  const rawToken = normalizeOptionalText(entry && entry.token);
  if (!rawToken && status !== 'revoked') {
    throw createGatewayError('INVALID_FLAG_VALUE', `Auth token record ${id} requires token.`, {
      sourceMode,
      index: options.index,
    });
  }

  const normalizedScopes = Array.isArray(entry && entry.scopes)
    ? Array.from(new Set(entry.scopes.map((scope) => String(scope || '').trim()).filter(Boolean)))
    : buildDefaultRemoteScopes();

  const sourceFile = normalizeOptionalText(options.sourceFile);
  const token = rawToken || crypto.randomBytes(24).toString('hex');
  const createdAt = normalizeOptionalText(entry && entry.createdAt) || now;
  const rotatedAt = normalizeOptionalText(entry && entry.rotatedAt);
  const revokedAt = normalizeOptionalText(entry && entry.revokedAt) || (status === 'revoked' ? now : null);
  const label = normalizeOptionalText(entry && (entry.label || entry.name)) || id;
  const principalType = normalizePrincipalType(entry && (entry.principalType || entry.type || entry.principalTemplate));
  const principalTemplate = normalizeOptionalText(entry && entry.principalTemplate) || inferPrincipalTemplate(normalizedScopes);
  const description = normalizeOptionalText(entry && entry.description);
  const metadata = entry && entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
    ? { ...entry.metadata }
    : {};

  return {
    id,
    token,
    tokenDigest: buildTokenDigest(token),
    scopes: normalizedScopes,
    status,
    label,
    principalType,
    principalTemplate,
    description,
    sourceMode,
    sourceFile,
    createdAt,
    rotatedAt,
    revokedAt,
    revokedTokenDigest: normalizeOptionalText(entry && entry.revokedTokenDigest),
    lastRotatedBy: normalizeOptionalText(entry && entry.lastRotatedBy),
    lastRevokedBy: normalizeOptionalText(entry && entry.lastRevokedBy),
    generated: Boolean(entry && entry.generated),
    metadata,
    lastAuthenticatedAt: normalizeOptionalText(entry && entry.lastAuthenticatedAt),
  };
}

function serializeAuthTokenRecord(record) {
  return {
    id: record.id,
    token: record.token,
    scopes: Array.isArray(record.scopes) ? record.scopes.slice() : [],
    status: record.status,
    label: record.label,
    principalType: record.principalType,
    principalTemplate: record.principalTemplate,
    ...(record.description ? { description: record.description } : {}),
    createdAt: record.createdAt,
    ...(record.rotatedAt ? { rotatedAt: record.rotatedAt } : {}),
    ...(record.revokedAt ? { revokedAt: record.revokedAt } : {}),
    ...(record.revokedTokenDigest ? { revokedTokenDigest: record.revokedTokenDigest } : {}),
    ...(record.lastRotatedBy ? { lastRotatedBy: record.lastRotatedBy } : {}),
    ...(record.lastRevokedBy ? { lastRevokedBy: record.lastRevokedBy } : {}),
    ...(record.generated ? { generated: true } : {}),
    ...(record.metadata && Object.keys(record.metadata).length ? { metadata: { ...record.metadata } } : {}),
  };
}

function clonePrincipalSummary(record, options = {}) {
  const currentPrincipalId = normalizeOptionalText(options.currentPrincipalId);
  const rotationPersistent = record.sourceMode === 'tokens-file'
    || record.sourceMode === 'single-file'
    || record.sourceMode === 'generated';
  const revocationPersistent = record.sourceMode === 'tokens-file';
  return {
    principalId: record.id,
    label: record.label,
    principalType: record.principalType,
    principalTemplate: record.principalTemplate,
    status: record.status,
    scopes: Array.isArray(record.scopes) ? record.scopes.slice() : [],
    sourceMode: record.sourceMode,
    createdAt: record.createdAt,
    rotatedAt: record.rotatedAt || null,
    revokedAt: record.revokedAt || null,
    lastAuthenticatedAt: record.lastAuthenticatedAt || null,
    tokenDigest: record.tokenDigest,
    revokedTokenDigest: record.revokedTokenDigest || null,
    lastRotatedBy: record.lastRotatedBy || null,
    lastRevokedBy: record.lastRevokedBy || null,
    current: currentPrincipalId === record.id,
    backendImplemented: true,
    runtimeReady: record.status === 'active',
    rotation: {
      supported: true,
      persistent: rotationPersistent,
      mode: rotationPersistent ? 'durable' : 'ephemeral',
    },
    revocation: {
      supported: record.sourceMode === 'tokens-file',
      persistent: revocationPersistent,
      mode: revocationPersistent ? 'durable' : 'session-only',
    },
  };
}

function createAuthRegistry(parsed) {
  const state = {
    mode: parsed.authSourceMode,
    singleTokenFile: parsed.authTokenFile,
    tokensFile: parsed.authTokensFile,
    generatedTokenFile: parsed.authSourceMode === 'generated' ? resolveDefaultGeneratedAuthTokenFile() : null,
    fileShape: parsed.authTokensFile ? 'object' : null,
    fileMetadata: parsed.authTokensFile ? {} : null,
    fileMtimeMs: null,
    records: [],
  };

  function enforceUnique(records) {
    const ids = new Set();
    const activeTokens = new Set();
    records.forEach((record) => {
      if (ids.has(record.id)) {
        throw createGatewayError('INVALID_FLAG_VALUE', `Duplicate auth principal id: ${record.id}`, {
          sourceMode: state.mode,
          filePath: state.tokensFile,
        });
      }
      ids.add(record.id);
      if (record.status === 'active') {
        if (activeTokens.has(record.token)) {
          throw createGatewayError('INVALID_FLAG_VALUE', `Duplicate active auth token value for principal ${record.id}`, {
            sourceMode: state.mode,
            filePath: state.tokensFile,
          });
        }
        activeTokens.add(record.token);
      }
    });
  }

  function parseTokensDocument() {
    let document;
    try {
      document = JSON.parse(fs.readFileSync(state.tokensFile, 'utf8'));
    } catch (error) {
      throw createGatewayError('INVALID_FLAG_VALUE', '--auth-tokens-file must contain valid JSON.', {
        filePath: state.tokensFile,
        cause: error && error.message ? error.message : String(error),
      });
    }
    const rawTokens = Array.isArray(document)
      ? document
      : Array.isArray(document && document.tokens)
        ? document.tokens
        : null;
    if (!rawTokens || !rawTokens.length) {
      throw createGatewayError('INVALID_FLAG_VALUE', '--auth-tokens-file must define a non-empty tokens array.', {
        filePath: state.tokensFile,
      });
    }
    state.fileShape = Array.isArray(document) ? 'array' : 'object';
    state.fileMetadata = state.fileShape === 'object' && document && typeof document === 'object'
      ? Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'tokens'))
      : {};
    state.records = rawTokens.map((entry, index) =>
      normalizeAuthTokenRecord(entry, {
        index,
        sourceMode: 'tokens-file',
        sourceFile: state.tokensFile,
      }),
    );
    enforceUnique(state.records);
    const stats = fs.statSync(state.tokensFile);
    state.fileMtimeMs = stats.mtimeMs;
  }

  function buildInitialRecords() {
    if (state.mode === 'tokens-file') {
      parseTokensDocument();
      return;
    }
    state.records = (Array.isArray(parsed.authTokenRecords) ? parsed.authTokenRecords : []).map((entry, index) =>
      normalizeAuthTokenRecord(entry, {
        index,
        sourceMode: state.mode,
        sourceFile: state.mode === 'single-file' ? state.singleTokenFile : state.generatedTokenFile,
      }),
    );
    enforceUnique(state.records);
  }

  function maybeReload() {
    if (state.mode !== 'tokens-file' || !state.tokensFile) return;
    let stats;
    try {
      stats = fs.statSync(state.tokensFile);
    } catch (error) {
      throw createGatewayError('AUTH_STATE_UNAVAILABLE', 'Unable to access --auth-tokens-file.', {
        filePath: state.tokensFile,
        cause: error && error.message ? error.message : String(error),
      });
    }
    if (state.fileMtimeMs === null || stats.mtimeMs !== state.fileMtimeMs) {
      parseTokensDocument();
    }
  }

  function persistRecords() {
    if (state.mode === 'tokens-file') {
      const payload = state.fileShape === 'array'
        ? state.records.map((record) => serializeAuthTokenRecord(record))
        : {
            ...(state.fileMetadata && typeof state.fileMetadata === 'object' ? state.fileMetadata : {}),
            schemaVersion: '1.0.0',
            updatedAt: new Date().toISOString(),
            tokens: state.records.map((record) => serializeAuthTokenRecord(record)),
          };
      writeJsonFileAtomic(state.tokensFile, payload);
      const stats = fs.statSync(state.tokensFile);
      state.fileMtimeMs = stats.mtimeMs;
      return true;
    }
    if (state.mode === 'single-file' && state.singleTokenFile) {
      const active = state.records.find((record) => record.status === 'active');
      if (!active) {
        throw createGatewayError('AUTH_REVOCATION_UNSUPPORTED', 'Single-token file mode cannot persist revocation without a replacement token.');
      }
      writeSecretTokenFile(state.singleTokenFile, active.token);
      return true;
    }
    if (state.mode === 'generated' && state.generatedTokenFile) {
      const active = state.records.find((record) => record.status === 'active');
      if (!active) {
        throw createGatewayError('AUTH_REVOCATION_UNSUPPORTED', 'Generated single-token mode cannot persist revocation without a replacement token.');
      }
      writeSecretTokenFile(state.generatedTokenFile, active.token);
      return true;
    }
    return false;
  }

  function getRecordByPrincipalId(principalId) {
    maybeReload();
    const target = normalizeOptionalText(principalId);
    return state.records.find((record) => record.id === target) || null;
  }

  function authenticateToken(token) {
    maybeReload();
    const record = state.records.find((entry) => entry.status === 'active' && safeTokenEquals(token, entry.token));
    if (!record) return null;
    record.lastAuthenticatedAt = new Date().toISOString();
    return {
      principalId: record.id,
      principalLabel: record.label,
      principalType: record.principalType,
      principalTemplate: record.principalTemplate,
      principalStatus: record.status,
      scopes: new Set(record.scopes),
      principal: clonePrincipalSummary(record, { currentPrincipalId: record.id }),
    };
  }

  function listPrincipals(currentPrincipalId = null) {
    maybeReload();
    return state.records.map((record) => clonePrincipalSummary(record, { currentPrincipalId }));
  }

  function getCurrentPrincipal(currentPrincipalId) {
    const record = getRecordByPrincipalId(currentPrincipalId);
    return record ? clonePrincipalSummary(record, { currentPrincipalId }) : null;
  }

  function rotatePrincipal(principalId, actorPrincipalId = null) {
    const record = getRecordByPrincipalId(principalId);
    if (!record) {
      throw createGatewayError('UNAUTHORIZED', `Unknown auth principal: ${principalId}`, {
        principalId,
      });
    }
    const nextToken = crypto.randomBytes(24).toString('hex');
    record.token = nextToken;
    record.tokenDigest = buildTokenDigest(nextToken);
    record.status = 'active';
    record.rotatedAt = new Date().toISOString();
    record.revokedAt = null;
    record.lastRotatedBy = actorPrincipalId || null;
    record.revokedTokenDigest = null;
    const persisted = persistRecords();
    return {
      principal: clonePrincipalSummary(record, { currentPrincipalId: actorPrincipalId || principalId }),
      issuedToken: nextToken,
      persistent: persisted,
    };
  }

  function createPrincipal(entry, actorPrincipalId = null) {
    if (state.mode !== 'tokens-file') {
      throw createGatewayError(
        'AUTH_PROVISIONING_UNSUPPORTED',
        'Durable principal creation requires --auth-tokens-file so the new token can persist across restarts.',
        { sourceMode: state.mode },
      );
    }
    maybeReload();
    const record = normalizeAuthTokenRecord(entry, {
      sourceMode: 'tokens-file',
      sourceFile: state.tokensFile,
      index: state.records.length,
    });
    if (state.records.some((existing) => existing.id === record.id)) {
      throw createGatewayError('INVALID_FLAG_VALUE', `Duplicate auth principal id: ${record.id}`, {
        sourceMode: state.mode,
        filePath: state.tokensFile,
      });
    }
    if (state.records.some((existing) => existing.status === 'active' && safeTokenEquals(existing.token, record.token))) {
      throw createGatewayError('INVALID_FLAG_VALUE', `Duplicate active auth token value for principal ${record.id}`, {
        sourceMode: state.mode,
        filePath: state.tokensFile,
      });
    }
    record.createdAt = new Date().toISOString();
    record.lastProvisionedBy = actorPrincipalId || null;
    state.records.push(record);
    const persisted = persistRecords();
    return {
      principal: clonePrincipalSummary(record, { currentPrincipalId: actorPrincipalId }),
      issuedToken: record.token,
      persistent: persisted,
    };
  }

  function deletePrincipal(principalId, actorPrincipalId = null) {
    if (state.mode !== 'tokens-file') {
      throw createGatewayError(
        'AUTH_PROVISIONING_UNSUPPORTED',
        'Durable principal deletion requires --auth-tokens-file so the change can persist across restarts.',
        { sourceMode: state.mode, principalId },
      );
    }
    if (actorPrincipalId && principalId === actorPrincipalId) {
      throw createGatewayError('AUTH_SELF_DELETE_FORBIDDEN', 'Refusing to delete the currently authenticated principal.', {
        principalId,
      });
    }
    maybeReload();
    const index = state.records.findIndex((record) => record.id === principalId);
    if (index === -1) {
      throw createGatewayError('UNAUTHORIZED', `Unknown auth principal: ${principalId}`, {
        principalId,
      });
    }
    const record = state.records[index];
    const activeCount = state.records.filter((entry) => entry.status === 'active').length;
    if (record.status === 'active' && activeCount <= 1) {
      throw createGatewayError('AUTH_LAST_PRINCIPAL_FORBIDDEN', 'Refusing to delete the last active auth principal.', {
        principalId,
      });
    }
    state.records.splice(index, 1);
    const persisted = persistRecords();
    return {
      principal: clonePrincipalSummary(record, { currentPrincipalId: actorPrincipalId }),
      persistent: persisted,
      deleted: true,
    };
  }

  function revokePrincipal(principalId, actorPrincipalId = null) {
    const record = getRecordByPrincipalId(principalId);
    if (!record) {
      throw createGatewayError('UNAUTHORIZED', `Unknown auth principal: ${principalId}`, {
        principalId,
      });
    }
    if (state.mode !== 'tokens-file') {
      throw createGatewayError(
        'AUTH_REVOCATION_UNSUPPORTED',
        'Durable token revocation requires --auth-tokens-file so the revoked state can persist across restarts.',
        {
          principalId,
          sourceMode: state.mode,
        },
      );
    }
    const activeCount = state.records.filter((entry) => entry.status === 'active').length;
    if (record.status === 'active' && activeCount <= 1) {
      throw createGatewayError('AUTH_LAST_PRINCIPAL_FORBIDDEN', 'Refusing to revoke the last active auth principal.', {
        principalId,
      });
    }
    record.revokedTokenDigest = record.tokenDigest;
    record.token = crypto.randomBytes(24).toString('hex');
    record.tokenDigest = buildTokenDigest(record.token);
    record.status = 'revoked';
    record.revokedAt = new Date().toISOString();
    record.lastRevokedBy = actorPrincipalId || null;
    const persisted = persistRecords();
    return {
      principal: clonePrincipalSummary(record, { currentPrincipalId: actorPrincipalId }),
      persistent: persisted,
    };
  }

  function getAuthManagementSummary(currentPrincipalId = null) {
    maybeReload();
    return {
      mode: state.mode,
      principalCount: state.records.length,
      supportsLiveReload: state.mode === 'tokens-file',
      supportsRotation: true,
      supportsRevocation: state.mode === 'tokens-file',
      supportsProvisioning: state.mode === 'tokens-file',
      supportsDeletion: state.mode === 'tokens-file',
      persistence: state.mode === 'inline' ? 'session-only' : 'durable',
      usesAuthTokensFile: Boolean(state.tokensFile),
      usesSingleTokenFile: Boolean(state.mode === 'generated' ? state.generatedTokenFile : state.singleTokenFile),
      principals: listPrincipals(currentPrincipalId),
    };
  }

  function bindGeneratedTokenFile(filePath) {
    if (state.mode !== 'generated') return;
    state.generatedTokenFile = filePath;
    state.records = state.records.map((record) => ({ ...record, sourceFile: filePath }));
  }

  buildInitialRecords();

  return {
    authenticateToken,
    listPrincipals,
    getCurrentPrincipal,
    createPrincipal,
    deletePrincipal,
    rotatePrincipal,
    revokePrincipal,
    getAuthManagementSummary,
    bindGeneratedTokenFile,
    get sourceMode() {
      return state.mode;
    },
    get tokenRecords() {
      maybeReload();
      return state.records.map((record) => ({ ...record, scopes: record.scopes.slice() }));
    },
  };
}

function scopeMatches(requiredScope, grantedScopes) {
  if (!requiredScope) return true;
  if (grantedScopes.has('*')) return true;
  if (grantedScopes.has(requiredScope)) return true;
  const [namespace] = String(requiredScope).split(':');
  return grantedScopes.has(`${namespace}:*`);
}

function assertAnyScope(authInfo, requiredScopes, message, toolName = null) {
  const scopes = Array.isArray(requiredScopes)
    ? requiredScopes.map((scope) => String(scope || '').trim()).filter(Boolean)
    : [];
  if (!scopes.length) return;
  const grantedScopes = authInfo && authInfo.scopes instanceof Set ? authInfo.scopes : new Set();
  const hasMatch = scopes.some((scope) => scopeMatches(scope, grantedScopes));
  if (hasMatch) return;
  const error = createGatewayError('FORBIDDEN', message, {
    requiredScopes: scopes,
    grantedScopes: Array.from(grantedScopes).sort(),
    ...(toolName ? { toolName } : {}),
  });
  error.recovery = {
    command: `Restart pandora mcp http with --auth-scopes ${Array.from(new Set([...grantedScopes, ...scopes])).sort().join(',')}`,
  };
  throw error;
}

function ensureAuthorized(req, authConfig) {
  const header = String(req.headers.authorization || '').trim();
  if (!header.startsWith('Bearer ')) {
    throw createGatewayError('UNAUTHORIZED', 'Missing bearer token.');
  }
  const token = header.slice('Bearer '.length).trim();
  const authInfo = !token ? null : authConfig.registry.authenticateToken(token);
  if (!authInfo) {
    throw createGatewayError('UNAUTHORIZED', 'Invalid bearer token.');
  }
  return authInfo;
}

function assertMethod(req, allowedMethods) {
  const normalizedAllowed = Array.isArray(allowedMethods)
    ? allowedMethods.map((method) => String(method || '').toUpperCase()).filter(Boolean)
    : [];
  const actual = String(req && req.method ? req.method : 'GET').toUpperCase();
  if (normalizedAllowed.includes(actual)) return;
  throw createGatewayError(
    'METHOD_NOT_ALLOWED',
    `${actual} is not allowed for this gateway endpoint.`,
    {
      allowedMethods: normalizedAllowed,
    },
  );
}

function assertToolScopes(toolName, descriptor, authInfo) {
  const xPandora = descriptor && descriptor.xPandora ? descriptor.xPandora : null;
  const requiredScopes = Array.isArray(xPandora && xPandora.policyScopes)
    ? xPandora.policyScopes
    : [];
  const grantedScopes = authInfo && authInfo.scopes instanceof Set ? authInfo.scopes : new Set();
  const missingScopes = requiredScopes.filter((scope) => !scopeMatches(scope, grantedScopes));
  if (missingScopes.length) {
    const error = createGatewayError(
      'FORBIDDEN',
      `${toolName} requires scopes not granted to this gateway token.`,
      {
        toolName,
        requiredScopes,
        missingScopes,
        grantedScopes: Array.from(grantedScopes).sort(),
        hints: [
          `Grant ${missingScopes.join(', ')} to the gateway token and retry.`,
        ],
      },
    );
    error.recovery = {
      command: `Restart pandora mcp http with --auth-scopes ${Array.from(new Set([...grantedScopes, ...missingScopes])).sort().join(',')}`,
    };
    throw error;
  }
}

function getToolScopeAccess(toolName, descriptor, authInfo) {
  const xPandora = descriptor && descriptor.xPandora
    ? descriptor.xPandora
    : descriptor && descriptor.inputSchema && descriptor.inputSchema.xPandora
      ? descriptor.inputSchema.xPandora
      : null;
  const requiredScopes = Array.isArray(xPandora && xPandora.policyScopes)
    ? xPandora.policyScopes
    : [];
  return {
    toolName,
    ...getScopeAccess(requiredScopes, authInfo),
  };
}

function getScopeAccess(requiredScopes, authInfo) {
  const grantedScopes = authInfo && authInfo.scopes instanceof Set ? authInfo.scopes : new Set();
  const normalizedScopes = Array.isArray(requiredScopes)
    ? requiredScopes.map((scope) => String(scope || '').trim()).filter(Boolean)
    : [];
  const missingScopes = normalizedScopes.filter((scope) => !scopeMatches(scope, grantedScopes));
  return {
    requiredScopes: normalizedScopes,
    missingScopes,
    authorized: missingScopes.length === 0,
  };
}

function canAccessToolDescriptor(toolName, descriptor, authInfo) {
  try {
    assertToolScopes(toolName, descriptor, authInfo);
    return true;
  } catch (error) {
    if (error && error.code === 'FORBIDDEN') {
      return false;
    }
    throw error;
  }
}

function incrementCounter(target, key, amount = 1) {
  if (!target || !key) return;
  target[key] = (target[key] || 0) + amount;
}

function classifyGatewayRoute(pathname, parsed) {
  if (pathname === parsed.healthPath) return 'health';
  if (pathname === parsed.readyPath) return 'ready';
  if (pathname === parsed.metricsPath) return 'metrics';
  if (pathname === '/auth' || pathname.startsWith('/auth/')) return 'auth';
  if (pathname === parsed.bootstrapPath) return 'bootstrap';
  if (pathname === parsed.capabilitiesPath) return 'capabilities';
  if (pathname === parsed.schemaPath) return 'schema';
  if (pathname === parsed.toolsPath) return 'tools';
  if (pathname === parsed.mcpPath) return 'mcp';
  if (pathname === parsed.operationsPath || pathname.startsWith(`${parsed.operationsPath}/`)) return 'operations';
  return 'unknown';
}

function createGatewayMetricsState(startedAtMs) {
  return {
    startedAtMs,
    requestsTotal: 0,
    inFlightRequests: 0,
    completedRequests: 0,
    statusCounts: {},
    routeCounts: {},
    methodCounts: {},
    errorCodeCounts: {},
    authFailures: 0,
    operationReads: 0,
    operationWrites: 0,
    lastRequestAt: null,
    lastResponseAt: null,
    lastErrorAt: null,
    lastErrorCode: null,
  };
}

async function createGatewayReadiness(parsed, authConfig, operationService, protocol, metricsState) {
  const checks = {
    authConfigured: {
      ok: Array.isArray(authConfig && authConfig.registry && authConfig.registry.tokenRecords) && authConfig.registry.tokenRecords.length > 0,
      detail: 'At least one bearer token record is configured.',
    },
    protocolReady: {
      ok: Boolean(protocol && typeof protocol.createServer === 'function' && typeof protocol.listTools === 'function'),
      detail: 'MCP protocol server factory and tool catalog are available.',
    },
    operationStoreReady: {
      ok: Boolean(
        operationService
        && typeof operationService.listOperations === 'function'
        && typeof operationService.getOperation === 'function'
        && typeof operationService.getReceipt === 'function'
        && typeof operationService.verifyReceipt === 'function'
      ),
      detail: 'Operation lifecycle and receipt store methods are available.',
    },
    requestLoopHealthy: {
      ok: Number(metricsState && metricsState.inFlightRequests) < 1_000,
      detail: 'The HTTP gateway is not saturated by an abnormal in-flight request backlog.',
    },
  };
  const warnings = [];
  try {
    const runtimeLocalCapabilities = await buildCapabilitiesPayloadAsync({
      remoteTransportActive: true,
      artifactNeutralProfileReadiness: false,
    });
    const signerProfiles = runtimeLocalCapabilities
      && runtimeLocalCapabilities.policyProfiles
      && runtimeLocalCapabilities.policyProfiles.signerProfiles
      ? runtimeLocalCapabilities.policyProfiles.signerProfiles
      : {};
    checks.runtimeLocalSignerReadiness = {
      ok: true,
      detail: 'Runtime-local signer/profile readiness signals were collected successfully.',
      readyMutableBuiltinCount: Number.isFinite(signerProfiles.readyMutableBuiltinCount)
        ? signerProfiles.readyMutableBuiltinCount
        : 0,
      readyMutableBuiltinIds: Array.isArray(signerProfiles.readyMutableBuiltinIds)
        ? signerProfiles.readyMutableBuiltinIds
        : [],
    };
    if (!checks.runtimeLocalSignerReadiness.readyMutableBuiltinCount) {
      warnings.push('Gateway has no runtime-local mutable built-in profiles ready. Live execution may still be unavailable on this host.');
    }
  } catch (error) {
    checks.runtimeLocalSignerReadiness = {
      ok: false,
      detail: error && error.message ? error.message : 'Unable to collect runtime-local signer/profile readiness.',
    };
  }
  if (isWildcardHost(parsed && parsed.host) && !parsed.publicBaseUrl) {
    warnings.push('Gateway is bound to a wildcard host without --public-base-url; advertised remote URLs may not be externally routable.');
  }
  return {
    ready: Object.values(checks).every((entry) => entry.ok),
    checks,
    warnings,
  };
}

function extractGatewayResponseMetadata(payload) {
  const data = payload && payload.data && typeof payload.data === 'object' ? payload.data : null;
  const operationId = normalizeOptionalText(
    (data && data.operationId)
    || (payload && payload.operationId)
    || null,
  );
  const receiptHash = normalizeOptionalText(
    (data && data.receiptHash)
    || (data && data.verification && data.verification.receiptHash)
    || null,
  );
  return {
    operationId,
    receiptHash,
  };
}

function sendJson(res, statusCode, payload) {
  const responsePayload =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? {
          ...payload,
          ...(res.locals && res.locals.requestId && !Object.prototype.hasOwnProperty.call(payload, 'requestId')
            ? { requestId: res.locals.requestId }
            : {}),
        }
      : payload;
  const metadata = extractGatewayResponseMetadata(responsePayload);
  if (res.locals && res.locals.requestId) {
    res.setHeader('x-request-id', res.locals.requestId);
  }
  if (res.locals && res.locals.routeName) {
    res.setHeader('x-pandora-route', res.locals.routeName);
  }
  if (res.locals && res.locals.principalId) {
    res.setHeader('x-pandora-principal-id', res.locals.principalId);
  }
  if (metadata.operationId) {
    res.setHeader('x-pandora-operation-id', metadata.operationId);
  }
  if (metadata.receiptHash) {
    res.setHeader('x-pandora-receipt-hash', metadata.receiptHash);
  }
  const body = JSON.stringify(responsePayload, null, 2);
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(body));
  res.end(body);
}

function createMcpHttpGatewayService(options = {}) {
  const packageVersion =
    typeof options.packageVersion === 'string' && options.packageVersion.trim()
      ? options.packageVersion.trim()
      : '0.0.0';
  const parsed = parseMcpHttpFlags(options.args || []);
  const authConfig = {
    registry: createAuthRegistry(parsed),
  };
  const protocol = createMcpProtocolService({
    ...(options.protocolOptions && typeof options.protocolOptions === 'object' ? options.protocolOptions : {}),
    packageVersion,
    cliPath: options.cliPath,
    remoteTransportActive: true,
    asyncExecution: true,
    compactMode: parsed.toolExposureMode === 'compact',
  });
  const operationService = options.operationService || createOperationService();
  const startedAt = Date.now();
  const metricsState = createGatewayMetricsState(startedAt);
  const authPath = '/auth';
  let advertisedBaseUrl = parsed.publicBaseUrl;
  let generatedTokenFile = null;
  let controlBaseUrl = null;

  function resolveRequestBaseUrl(req) {
    if (advertisedBaseUrl) return advertisedBaseUrl;
    const forwardedProto = String(req && req.headers ? req.headers['x-forwarded-proto'] || '' : '').trim();
    const protocol = forwardedProto || 'http';
    const forwardedHost = String(req && req.headers ? req.headers['x-forwarded-host'] || '' : '').trim();
    const host = forwardedHost || String(req && req.headers ? req.headers.host || '' : '').trim();
    if (host) {
      return `${protocol}://${host}`;
    }
    return controlBaseUrl;
  }

  function buildGatewayMetadata(resolvedBaseUrl, authInfo = null, options = {}) {
    const includeBootstrapPath = options.includeBootstrapPath !== false;
    const currentPrincipal = authInfo && authInfo.principalId
      ? authConfig.registry.getCurrentPrincipal(authInfo.principalId)
      : null;
    const authManagement = authConfig.registry.getAuthManagementSummary(authInfo && authInfo.principalId ? authInfo.principalId : null);
    return {
      baseUrl: resolvedBaseUrl || null,
      ...(includeBootstrapPath ? { bootstrapPath: parsed.bootstrapPath } : {}),
      capabilitiesPath: parsed.capabilitiesPath,
      healthPath: parsed.healthPath,
      readyPath: parsed.readyPath,
      metricsPath: parsed.metricsPath,
      mcpPath: parsed.mcpPath,
      schemaPath: parsed.schemaPath,
      toolsPath: parsed.toolsPath,
      authPath,
      operationsPath: parsed.operationsPath,
      toolExposureMode: parsed.toolExposureMode,
      operationsReceiptPathTemplate: `${parsed.operationsPath}/{operationId}/receipt`,
      operationsReceiptVerifyPathTemplate: `${parsed.operationsPath}/{operationId}/receipt/verify`,
      operationsDetachedReceiptVerifyPath: `${parsed.operationsPath}/receipts/verify`,
      operationsWebhookPathTemplate: `${parsed.operationsPath}/{operationId}/webhooks`,
      authRequired: true,
      advertisedBaseUrl: resolvedBaseUrl,
      authManagement: {
        mode: authManagement.mode,
        principalCount: authManagement.principalCount,
        supportsLiveReload: authManagement.supportsLiveReload,
        supportsRotation: authManagement.supportsRotation,
        supportsRevocation: authManagement.supportsRevocation,
        supportsProvisioning: authManagement.supportsProvisioning,
        supportsDeletion: authManagement.supportsDeletion,
        persistence: authManagement.persistence,
        principalsPath: `${authPath}/principals`,
        currentPrincipalPath: `${authPath}/current`,
        createPrincipalPath: `${authPath}/principals`,
        deletePrincipalPathTemplate: `${authPath}/principals/{principalId}`,
        rotatePathTemplate: `${authPath}/principals/{principalId}/rotate`,
        revokePathTemplate: `${authPath}/principals/{principalId}/revoke`,
      },
      ...(authInfo ? {
        grantedScopes: Array.from(authInfo.scopes).sort(),
        principalId: authInfo.principalId,
        principal: currentPrincipal,
      } : {}),
    };
  }

  async function buildCapabilitiesEnvelope(authInfo, resolvedBaseUrl, options = {}) {
    assertToolScopes('capabilities', { xPandora: { policyScopes: COMMAND_DESCRIPTORS.capabilities.policyScopes || [] } }, authInfo);
    const payload = await buildCapabilitiesPayloadAsync({
      remoteTransportActive: true,
      remoteTransportUrl: resolvedBaseUrl ? `${resolvedBaseUrl}${parsed.mcpPath}` : null,
      artifactNeutralProfileReadiness: options.runtimeLocalReadiness !== true,
    });
    payload.gateway = buildGatewayMetadata(resolvedBaseUrl, authInfo);
    return {
      ok: true,
      command: 'capabilities',
      data: payload,
      principalId: authInfo.principalId,
    };
  }

  async function handleCapabilities(req, res) {
    const authInfo = ensureAuthorized(req, authConfig);
    res.locals.principalId = authInfo.principalId;
    const resolvedBaseUrl = resolveRequestBaseUrl(req);
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const runtimeLocalReadiness = parseTruthyQueryParam(
      url.searchParams.get('runtime_local_readiness') || url.searchParams.get('runtime-local-readiness'),
    );
    sendJson(res, 200, {
      ...(await buildCapabilitiesEnvelope(authInfo, resolvedBaseUrl, { runtimeLocalReadiness })),
    });
  }

  async function handleOperations(req, res, pathname) {
    const authInfo = ensureAuthorized(req, authConfig);
    res.locals.principalId = authInfo.principalId;
    const base = parsed.operationsPath.replace(/\/+$/, '');
    const suffix = pathname.slice(base.length);
    if ((!suffix || suffix === '/') && req.method !== 'GET') {
      throw createGatewayError('METHOD_NOT_ALLOWED', 'Only GET is allowed on the operations collection.', {
        allowedMethods: ['GET'],
      });
    }
    if (!suffix || suffix === '/') {
      if (!scopeMatches('operations:read', authInfo.scopes)) {
        throw createGatewayError('FORBIDDEN', 'operations endpoint requires operations:read scope.');
      }
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const statuses = parseCsvList(url.searchParams.get('status'));
      const limit = url.searchParams.get('limit');
      const offset = url.searchParams.get('offset');
      const tool = url.searchParams.get('tool');
      const listing = await operationService.listOperations({
        statuses,
        tool,
        limit: limit ? Number.parseInt(limit, 10) : undefined,
        offset: offset ? Number.parseInt(offset, 10) : undefined,
      });
      sendJson(res, 200, {
        ok: true,
        command: 'operations.list',
        data: listing,
      });
      return;
    }
    const suffixSegments = suffix.replace(/^\/+/, '').split('/').filter(Boolean);
    if (suffixSegments.length === 2 && suffixSegments[0] === 'receipts' && suffixSegments[1] === 'verify') {
      assertMethod(req, ['POST']);
      if (!scopeMatches('operations:read', authInfo.scopes)) {
        throw createGatewayError('FORBIDDEN', 'detached receipt verification requires operations:read scope.');
      }
      const body = await readJsonRequest(req);
      const receipt = body && body.receipt && typeof body.receipt === 'object' && !Array.isArray(body.receipt)
        ? body.receipt
        : null;
      if (!receipt) {
        throw createGatewayError('INVALID_JSON', 'Detached receipt verification requires body.receipt to be a JSON object.');
      }
      const expectedOperationHash = normalizeOptionalText(
        body.expectedOperationHash || body.expected_operation_hash,
      );
      const verification = await operationService.verifyReceipt(receipt, {
        ...(expectedOperationHash ? { expectedOperationHash } : {}),
      });
      sendJson(res, 200, {
        ok: true,
        command: 'operations.verify-receipt',
        data: {
          ok: Boolean(verification && verification.ok),
          code: verification && Object.prototype.hasOwnProperty.call(verification, 'code') ? verification.code : null,
          operationId: receipt && receipt.operationId ? receipt.operationId : null,
          operationHash: receipt && receipt.operationHash ? receipt.operationHash : null,
          expectedOperationHash: expectedOperationHash || null,
          receiptHash: verification && verification.receiptHash ? verification.receiptHash : (receipt && receipt.receiptHash ? receipt.receiptHash : null),
          signatureValid: Boolean(verification && verification.signatureValid),
          signatureAlgorithm: verification && Object.prototype.hasOwnProperty.call(verification, 'signatureAlgorithm') ? verification.signatureAlgorithm : (receipt && receipt.verification ? receipt.verification.signatureAlgorithm || null : null),
          publicKeyFingerprint: verification && Object.prototype.hasOwnProperty.call(verification, 'publicKeyFingerprint') ? verification.publicKeyFingerprint : (receipt && receipt.verification ? receipt.verification.publicKeyFingerprint || null : null),
          keyId: verification && Object.prototype.hasOwnProperty.call(verification, 'keyId') ? verification.keyId : (receipt && receipt.verification ? receipt.verification.keyId || null : null),
          mismatches: Array.isArray(verification && verification.mismatches) ? verification.mismatches : [],
          source: {
            type: 'detached',
            value: receipt && receipt.receiptId ? receipt.receiptId : null,
          },
          schemaVersion: '1.0.0',
          generatedAt: new Date().toISOString(),
        },
      });
      return;
    }
    const operationId = decodeURIComponent(suffixSegments[0] || '');
    const action = suffixSegments[1] ? decodeURIComponent(suffixSegments[1]) : null;
    if (req.method === 'GET' && action) {
      if (!scopeMatches('operations:read', authInfo.scopes)) {
        throw createGatewayError('FORBIDDEN', 'operations endpoint requires operations:read scope.');
      }
      if (action === 'receipt') {
        const subaction = suffixSegments[2] ? decodeURIComponent(suffixSegments[2]) : null;
        if (subaction && subaction !== 'verify') {
          throw createGatewayError('NOT_FOUND', `Unknown operations receipt action: ${subaction}`, {
            operationId,
            action,
            subaction,
          });
        }
        const receipt = await operationService.getReceipt(operationId);
        if (subaction === 'verify') {
          const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
          const expectedOperationHash = normalizeOptionalText(
            url.searchParams.get('expectedOperationHash') || url.searchParams.get('expected_operation_hash'),
          );
          const verification = await operationService.verifyReceipt(receipt, {
            ...(expectedOperationHash ? { expectedOperationHash } : {}),
          });
          sendJson(res, 200, {
            ok: true,
            command: 'operations.verify-receipt',
            data: {
              ok: Boolean(verification && verification.ok),
              code: verification && Object.prototype.hasOwnProperty.call(verification, 'code') ? verification.code : null,
              operationId: receipt && receipt.operationId ? receipt.operationId : null,
              operationHash: receipt && receipt.operationHash ? receipt.operationHash : null,
              expectedOperationHash: expectedOperationHash || null,
              receiptHash: verification && verification.receiptHash ? verification.receiptHash : (receipt && receipt.receiptHash ? receipt.receiptHash : null),
              mismatches: Array.isArray(verification && verification.mismatches) ? verification.mismatches : [],
              source: {
                type: 'operation-id',
                value: operationId,
              },
              schemaVersion: '1.0.0',
              generatedAt: new Date().toISOString(),
            },
          });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          command: 'operations.receipt',
          data: receipt,
        });
        return;
      }
      if (action === 'webhooks') {
        const deliveries = await operationService.listWebhookDeliveries(operationId);
        sendJson(res, 200, {
          ok: true,
          command: 'operations.webhooks',
          data: deliveries,
        });
        return;
      }
      throw createGatewayError('NOT_FOUND', `Unknown operations read action: ${action}`, {
        operationId,
        action,
      });
    }
    if (req.method === 'POST' && action) {
      if (!scopeMatches('operations:write', authInfo.scopes)) {
        throw createGatewayError('FORBIDDEN', 'Operation lifecycle mutation requires operations:write scope.');
      }
      const body = await readJsonRequest(req);
      if (String(body.intent || '').trim().toLowerCase() !== 'execute') {
        throw createGatewayError('EXECUTE_INTENT_REQUIRED', 'Operation lifecycle mutation requires body.intent=\"execute\".', {
          requiredIntent: 'execute',
        });
      }
      const reason = normalizeOptionalText(body.reason);
      let record = null;
      if (action === 'cancel') {
        record = await operationService.cancelOperation(operationId, reason);
        sendJson(res, 200, { ok: true, command: 'operations.cancel', data: record });
        return;
      }
      if (action === 'close') {
        record = await operationService.closeOperation(operationId, reason);
        sendJson(res, 200, { ok: true, command: 'operations.close', data: record });
        return;
      }
      throw createGatewayError('NOT_FOUND', `Unknown operations lifecycle action: ${action}`, {
        operationId,
        action,
      });
    }
    if (!scopeMatches('operations:read', authInfo.scopes)) {
      throw createGatewayError('FORBIDDEN', 'operations endpoint requires operations:read scope.');
    }
    const record = await operationService.getOperation(operationId, { includeCheckpoints: true });
    if (!record) {
      throw createGatewayError('OPERATION_NOT_FOUND', `Operation not found: ${operationId}`, {
        operationId,
      });
    }
    sendJson(res, 200, {
      ok: true,
      command: 'operations.get',
      data: record,
    });
  }

  async function buildSchemaEnvelope(authInfo, includeDenied = false, includeCompatibility = false) {
    assertAnyScope(authInfo, ['schema:read'], 'schema endpoint requires schema:read scope.');
    const result = await protocol.callTool({
      name: 'schema',
      arguments: includeCompatibility ? { 'include-compatibility': true } : {},
    }, {
      allowHiddenToolAccess: true,
      assertToolAllowed: (toolName, descriptor) => assertToolScopes(toolName, descriptor, authInfo),
      filterToolDescriptor: includeDenied
        ? undefined
        : (toolName, descriptor) => canAccessToolDescriptor(toolName, descriptor, authInfo),
      buildInvocationEnv: () => ({}),
    });
    const payload = result && result.structuredContent
      ? result.structuredContent
      : {
          ok: false,
          error: {
            code: 'SCHEMA_GATEWAY_FAILED',
            message: 'Schema tool did not return structured content.',
          },
        };
    if (
      includeDenied
      && payload
      && payload.data
      && payload.data.commandDescriptors
      && typeof payload.data.commandDescriptors === 'object'
    ) {
      const access = {};
      for (const [toolName, descriptor] of Object.entries(payload.data.commandDescriptors)) {
        access[toolName] = getToolScopeAccess(toolName, { xPandora: descriptor }, authInfo);
      }
      payload.data.gatewayScopeAccess = {
        principalId: authInfo.principalId,
        includeDenied: true,
        commands: access,
      };
    }
    return payload;
  }

  async function handleSchema(req, res) {
    const authInfo = ensureAuthorized(req, authConfig);
    res.locals.principalId = authInfo.principalId;
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const includeDenied = ['1', 'true', 'yes'].includes(String(url.searchParams.get('include_denied') || '').toLowerCase());
    const includeCompatibility = ['1', 'true', 'yes'].includes(
      String(url.searchParams.get('include_aliases') || url.searchParams.get('include_compatibility') || '').toLowerCase(),
    );
    const payload = await buildSchemaEnvelope(authInfo, includeDenied, includeCompatibility);
    sendJson(
      res,
      200,
      payload,
    );
  }

  async function buildToolsEnvelope(authInfo, options = {}) {
    assertAnyScope(authInfo, ['contracts:read'], 'tools endpoint requires contracts:read scope.');
    const includeAliases = Boolean(options.includeAliases);
    const includeDenied = Boolean(options.includeDenied);
    const tools = protocol.listTools({
      includeCompatibilityAliases: includeAliases,
      assertToolAllowed: includeDenied ? undefined : (toolName, descriptor) => assertToolScopes(toolName, descriptor, authInfo),
      filterToolDescriptor: includeDenied
        ? undefined
        : (toolName, descriptor) => canAccessToolDescriptor(toolName, descriptor, authInfo),
    }).map((descriptor) => {
      const metadata = descriptor && descriptor.inputSchema ? descriptor.inputSchema.xPandora : null;
      const access = getToolScopeAccess(descriptor.name, descriptor, authInfo);
      if (!includeDenied) return descriptor;
      return {
        ...descriptor,
        xPandora: {
          ...(metadata && typeof metadata === 'object' ? metadata : {}),
          authorized: access.authorized,
          missingScopes: access.missingScopes,
          principalId: authInfo.principalId,
        },
      };
    }).filter((descriptor) => {
        if (includeDenied || includeAliases) return true;
        const metadata = descriptor && descriptor.inputSchema && descriptor.inputSchema.xPandora;
        return !(metadata && metadata.compatibilityAlias === true);
    });
    return {
      ok: true,
      command: 'mcp.tools',
      data: {
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        toolExposureMode: parsed.toolExposureMode,
        includeAliases,
        includeDenied,
        principalId: authInfo.principalId,
        toolCount: tools.length,
        tools,
      },
    };
  }

  async function handleTools(req, res) {
    const authInfo = ensureAuthorized(req, authConfig);
    res.locals.principalId = authInfo.principalId;
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const includeAliases = ['1', 'true', 'yes'].includes(String(url.searchParams.get('include_aliases') || '').toLowerCase());
    const includeDenied = ['1', 'true', 'yes'].includes(String(url.searchParams.get('include_denied') || '').toLowerCase());
    sendJson(res, 200, await buildToolsEnvelope(authInfo, { includeAliases, includeDenied }));
  }

  function resolvePrincipalTarget(rawValue, authInfo) {
    const target = normalizeOptionalText(rawValue);
    if (!target || target === 'current' || target === 'me' || target === 'self') {
      return authInfo.principalId;
    }
    return target;
  }

  function buildAuthEnvelope(command, authInfo, extra = {}) {
    return {
      ok: true,
      command,
      principalId: authInfo.principalId,
      data: {
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        principalId: authInfo.principalId,
        grantedScopes: Array.from(authInfo.scopes).sort(),
        gateway: buildGatewayMetadata(resolveRequestBaseUrl(extra.req || null), authInfo),
        ...extra.data,
      },
    };
  }

  async function handleAuth(req, res, pathname) {
    const authInfo = ensureAuthorized(req, authConfig);
    res.locals.principalId = authInfo.principalId;
    const suffix = pathname.slice(authPath.length);
    const suffixSegments = suffix.replace(/^\/+/, '').split('/').filter(Boolean);
    const method = String(req.method || 'GET').toUpperCase();
    if (!suffix || suffix === '/') {
      assertMethod(req, ['GET']);
      const authManagement = authConfig.registry.getAuthManagementSummary(authInfo.principalId);
      sendJson(res, 200, buildAuthEnvelope('mcp.auth.current', authInfo, {
        req,
        data: {
          currentPrincipal: authConfig.registry.getCurrentPrincipal(authInfo.principalId),
          authManagement: {
            mode: authManagement.mode,
            principalCount: authManagement.principalCount,
            supportsLiveReload: authManagement.supportsLiveReload,
            supportsRotation: authManagement.supportsRotation,
            supportsRevocation: authManagement.supportsRevocation,
            supportsProvisioning: authManagement.supportsProvisioning,
            supportsDeletion: authManagement.supportsDeletion,
            persistence: authManagement.persistence,
          },
        },
      }));
      return;
    }

    if (suffixSegments.length === 1 && suffixSegments[0] === 'current') {
      assertMethod(req, ['GET']);
      const authManagement = authConfig.registry.getAuthManagementSummary(authInfo.principalId);
      sendJson(res, 200, buildAuthEnvelope('mcp.auth.current', authInfo, {
        req,
        data: {
          currentPrincipal: authConfig.registry.getCurrentPrincipal(authInfo.principalId),
          authManagement: {
            mode: authManagement.mode,
            principalCount: authManagement.principalCount,
            supportsLiveReload: authManagement.supportsLiveReload,
            supportsRotation: authManagement.supportsRotation,
            supportsRevocation: authManagement.supportsRevocation,
            supportsProvisioning: authManagement.supportsProvisioning,
            supportsDeletion: authManagement.supportsDeletion,
            persistence: authManagement.persistence,
          },
        },
      }));
      return;
    }

    if (suffixSegments.length === 1 && suffixSegments[0] === 'principals') {
      assertMethod(req, ['GET', 'POST']);
      if (method === 'POST') {
        assertAnyScope(authInfo, ['gateway:auth:write'], 'auth principal creation requires gateway:auth:write scope.');
        const body = await readJsonRequest(req);
        if (String(body.intent || '').trim().toLowerCase() !== 'execute') {
          throw createGatewayError('EXECUTE_INTENT_REQUIRED', 'auth principal creation requires body.intent=\"execute\".', {
            requiredIntent: 'execute',
          });
        }
        const created = authConfig.registry.createPrincipal({
          id: body.id,
          token: body.token,
          scopes: body.scopes,
          label: body.label,
          principalType: body.principalType || body.type,
          principalTemplate: body.principalTemplate,
          description: body.description,
          metadata: body.metadata,
          generated: body.generated,
        }, authInfo.principalId);
        sendJson(res, 200, buildAuthEnvelope('mcp.auth.create-principal', authInfo, {
          req,
          data: {
            principal: created.principal,
            issuedToken: created.issuedToken,
            persistent: created.persistent,
            warning: 'Store the new bearer token securely. The gateway only returns it at creation time.',
          },
        }));
        return;
      }
      assertAnyScope(authInfo, ['gateway:auth:read'], 'auth principal listing requires gateway:auth:read scope.');
      sendJson(res, 200, buildAuthEnvelope('mcp.auth.principals', authInfo, {
        req,
        data: {
          currentPrincipal: authConfig.registry.getCurrentPrincipal(authInfo.principalId),
          principalCount: authConfig.registry.listPrincipals(authInfo.principalId).length,
          principals: authConfig.registry.listPrincipals(authInfo.principalId),
        },
      }));
      return;
    }

    if (suffixSegments.length === 2 && suffixSegments[0] === 'principals') {
      assertMethod(req, ['GET', 'DELETE']);
      const targetPrincipalId = resolvePrincipalTarget(suffixSegments[1], authInfo);
      if (method === 'GET') {
        assertAnyScope(authInfo, ['gateway:auth:read'], 'auth principal inspection requires gateway:auth:read scope.');
        const principal = authConfig.registry.listPrincipals(authInfo.principalId)
          .find((entry) => entry.principalId === targetPrincipalId) || null;
        if (!principal) {
          throw createGatewayError('UNAUTHORIZED', `Unknown auth principal: ${targetPrincipalId}`, {
            principalId: targetPrincipalId,
          });
        }
        sendJson(res, 200, buildAuthEnvelope('mcp.auth.principal', authInfo, {
          req,
          data: {
            principal,
          },
        }));
        return;
      }
      assertAnyScope(authInfo, ['gateway:auth:write'], 'auth principal deletion requires gateway:auth:write scope.');
      const body = await readJsonRequest(req);
      if (String(body.intent || '').trim().toLowerCase() !== 'execute') {
        throw createGatewayError('EXECUTE_INTENT_REQUIRED', 'auth principal deletion requires body.intent=\"execute\".', {
          requiredIntent: 'execute',
        });
      }
      const deleted = authConfig.registry.deletePrincipal(targetPrincipalId, authInfo.principalId);
      sendJson(res, 200, buildAuthEnvelope('mcp.auth.delete-principal', authInfo, {
        req,
        data: {
          targetPrincipalId,
          principal: deleted.principal,
          persistent: deleted.persistent,
          deleted: true,
        },
      }));
      return;
    }

    if (suffixSegments.length === 3 && suffixSegments[0] === 'principals' && (suffixSegments[2] === 'rotate' || suffixSegments[2] === 'revoke')) {
      assertMethod(req, ['POST']);
      assertAnyScope(authInfo, ['gateway:auth:write'], 'auth token mutation requires gateway:auth:write scope.');
      const body = await readJsonRequest(req);
      if (String(body.intent || '').trim().toLowerCase() !== 'execute') {
        throw createGatewayError('EXECUTE_INTENT_REQUIRED', 'auth token mutation requires body.intent=\"execute\".', {
          requiredIntent: 'execute',
        });
      }
      const targetPrincipalId = resolvePrincipalTarget(suffixSegments[1], authInfo);
      if (suffixSegments[2] === 'rotate') {
        const rotated = authConfig.registry.rotatePrincipal(targetPrincipalId, authInfo.principalId);
        sendJson(res, 200, buildAuthEnvelope('mcp.auth.rotate', authInfo, {
          req,
          data: {
            targetPrincipalId,
            principal: rotated.principal,
            issuedToken: rotated.issuedToken,
            persistent: rotated.persistent,
            warning: 'Store the new bearer token securely. The gateway only returns it at rotation time.',
          },
        }));
        return;
      }
      const revoked = authConfig.registry.revokePrincipal(targetPrincipalId, authInfo.principalId);
      sendJson(res, 200, buildAuthEnvelope('mcp.auth.revoke', authInfo, {
        req,
        data: {
          targetPrincipalId,
          principal: revoked.principal,
          persistent: revoked.persistent,
          revoked: true,
        },
      }));
      return;
    }

    throw createGatewayError('NOT_FOUND', `Unknown auth gateway path: ${pathname}`, {
      pathname,
    });
  }

  async function handleMetrics(req, res) {
    const authInfo = ensureAuthorized(req, authConfig);
    res.locals.principalId = authInfo.principalId;
    assertAnyScope(authInfo, ['capabilities:read'], 'metrics endpoint requires capabilities:read scope.');
    sendJson(res, 200, {
      ok: true,
      command: 'mcp.http.metrics',
      data: {
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        service: 'pandora-mcp-http',
        version: packageVersion,
        toolExposureMode: parsed.toolExposureMode,
        principalId: authInfo.principalId,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        requests: {
          total: metricsState.requestsTotal,
          inFlight: metricsState.inFlightRequests,
          completed: metricsState.completedRequests,
          statusCounts: { ...metricsState.statusCounts },
          routeCounts: { ...metricsState.routeCounts },
          methodCounts: { ...metricsState.methodCounts },
          errorCodeCounts: { ...metricsState.errorCodeCounts },
          authFailures: metricsState.authFailures,
          lastRequestAt: metricsState.lastRequestAt,
          lastResponseAt: metricsState.lastResponseAt,
          lastErrorAt: metricsState.lastErrorAt,
          lastErrorCode: metricsState.lastErrorCode,
        },
        operations: {
          reads: metricsState.operationReads,
          writes: metricsState.operationWrites,
        },
      },
    });
  }

  async function handleReady(_req, res) {
    const readiness = await createGatewayReadiness(parsed, authConfig, operationService, protocol, metricsState);
    sendJson(res, readiness.ready ? 200 : 503, {
      ok: readiness.ready,
      command: 'mcp.http.ready',
      data: {
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        service: 'pandora-mcp-http',
        version: packageVersion,
        toolExposureMode: parsed.toolExposureMode,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        ready: readiness.ready,
        checks: readiness.checks,
        warnings: readiness.warnings,
        endpoints: {
          auth: authPath,
          health: parsed.healthPath,
          ready: parsed.readyPath,
          metrics: parsed.metricsPath,
        },
      },
    });
  }

  async function handleBootstrap(req, res) {
    const authInfo = ensureAuthorized(req, authConfig);
    res.locals.principalId = authInfo.principalId;
    const resolvedBaseUrl = resolveRequestBaseUrl(req);
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const includeAliases = ['1', 'true', 'yes'].includes(String(url.searchParams.get('include_aliases') || '').toLowerCase());
    const includeDenied = ['1', 'true', 'yes'].includes(String(url.searchParams.get('include_denied') || '').toLowerCase());
    const runtimeLocalReadiness = parseTruthyQueryParam(
      url.searchParams.get('runtime_local_readiness') || url.searchParams.get('runtime-local-readiness'),
    );
    const capabilitiesAccess = getToolScopeAccess(
      'capabilities',
      { xPandora: { policyScopes: COMMAND_DESCRIPTORS.capabilities.policyScopes || [] } },
      authInfo,
    );
    const schemaAccess = getScopeAccess(['schema:read'], authInfo);
    const toolsAccess = getScopeAccess(['contracts:read'], authInfo);
    const capabilities = capabilitiesAccess.authorized
      ? (await buildCapabilitiesEnvelope(authInfo, resolvedBaseUrl)).data
      : null;
    const schema = schemaAccess.authorized
      ? await buildSchemaEnvelope(authInfo, includeDenied, includeAliases)
      : null;
    const tools = toolsAccess.authorized
      ? (await buildToolsEnvelope(authInfo, { includeAliases, includeDenied })).data
      : null;
    const summary = await buildBootstrapPayloadAsync({
      includeCompatibility: includeAliases,
      principalId: authInfo.principalId,
      grantedScopes: Array.from(authInfo.scopes).sort(),
      remoteTransportActive: true,
      remoteTransportUrl: resolvedBaseUrl ? `${resolvedBaseUrl}${parsed.mcpPath}` : null,
      gateway: buildGatewayMetadata(resolvedBaseUrl, authInfo),
      artifactNeutralProfileReadiness: !runtimeLocalReadiness,
    });
    sendJson(res, 200, {
      ok: true,
      command: 'mcp.bootstrap',
      principalId: authInfo.principalId,
      data: {
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        principalId: authInfo.principalId,
        grantedScopes: Array.from(authInfo.scopes).sort(),
        includeAliases,
        includeDenied,
        runtimeLocalReadiness,
        gateway: buildGatewayMetadata(resolvedBaseUrl, authInfo),
        summary,
        access: {
          capabilities: capabilitiesAccess,
          schema: schemaAccess,
          tools: toolsAccess,
        },
        capabilities,
        schema: schema && schema.data ? schema.data : null,
        tools,
      },
    });
  }

  async function handleMcp(req, res) {
    const authInfo = ensureAuthorized(req, authConfig);
    res.locals.principalId = authInfo.principalId;
    const resolvedBaseUrl = resolveRequestBaseUrl(req);
    const server = protocol.createServer({
      assertToolAllowed: (toolName, descriptor) => assertToolScopes(toolName, descriptor, authInfo),
      filterToolDescriptor: (toolName, descriptor) => canAccessToolDescriptor(toolName, descriptor, authInfo),
      buildInvocationEnv: () => ({
        PANDORA_MCP_REMOTE_ACTIVE: '1',
        PANDORA_MCP_GRANTED_SCOPES: Array.from(authInfo.scopes).sort().join(','),
        PANDORA_MCP_PRINCIPAL_ID: authInfo.principalId,
        ...(res.locals && res.locals.requestId ? { PANDORA_MCP_REQUEST_ID: res.locals.requestId } : {}),
        ...(resolvedBaseUrl ? { PANDORA_MCP_REMOTE_URL: `${resolvedBaseUrl}${parsed.mcpPath}` } : {}),
      }),
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      req.auth = authInfo;
      await transport.handleRequest(req, res);
    } finally {
      await transport.close();
      await server.close();
    }
  }

  async function requestHandler(req, res) {
    try {
      const pathname = new URL(req.url, `http://${req.headers.host || `${parsed.host}:${parsed.port}`}`).pathname;
      if (pathname === parsed.healthPath) {
        assertMethod(req, ['GET']);
        const readiness = await createGatewayReadiness(parsed, authConfig, operationService, protocol, metricsState);
        sendJson(res, 200, {
          ok: true,
          command: 'mcp.http.health',
          data: {
            schemaVersion: '1.0.0',
            generatedAt: new Date().toISOString(),
            service: 'pandora-mcp-http',
            version: packageVersion,
            toolExposureMode: parsed.toolExposureMode,
            uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
            ready: readiness.ready,
            checks: readiness.checks,
            warnings: readiness.warnings,
            requestCounters: {
              total: metricsState.requestsTotal,
              inFlight: metricsState.inFlightRequests,
              completed: metricsState.completedRequests,
              authFailures: metricsState.authFailures,
            },
            endpoints: {
              mcp: parsed.mcpPath,
              auth: authPath,
              bootstrap: parsed.bootstrapPath,
              capabilities: parsed.capabilitiesPath,
              schema: parsed.schemaPath,
              tools: parsed.toolsPath,
              ready: parsed.readyPath,
              metrics: parsed.metricsPath,
              operations: parsed.operationsPath,
              operationsReceipt: `${parsed.operationsPath}/{operationId}/receipt`,
              operationsReceiptVerify: `${parsed.operationsPath}/{operationId}/receipt/verify`,
              operationsWebhooks: `${parsed.operationsPath}/{operationId}/webhooks`,
            },
            authRequired: true,
          },
        });
        return;
      }

      if (pathname === parsed.readyPath) {
        assertMethod(req, ['GET']);
        await handleReady(req, res);
        return;
      }

      if (pathname === parsed.metricsPath) {
        assertMethod(req, ['GET']);
        await handleMetrics(req, res);
        return;
      }

      if (pathname === authPath || pathname.startsWith(`${authPath}/`)) {
        assertMethod(req, ['GET', 'POST', 'DELETE']);
        await handleAuth(req, res, pathname);
        return;
      }

      if (pathname === parsed.capabilitiesPath) {
        assertMethod(req, ['GET']);
        await handleCapabilities(req, res);
        return;
      }

      if (pathname === parsed.bootstrapPath) {
        assertMethod(req, ['GET']);
        await handleBootstrap(req, res);
        return;
      }

      if (pathname === parsed.schemaPath) {
        assertMethod(req, ['GET']);
        await handleSchema(req, res);
        return;
      }

      if (pathname === parsed.toolsPath) {
        assertMethod(req, ['GET']);
        await handleTools(req, res);
        return;
      }

      if (pathname === parsed.mcpPath) {
        assertMethod(req, ['GET', 'POST', 'DELETE']);
        await handleMcp(req, res);
        return;
      }

      if (pathname === parsed.operationsPath || pathname.startsWith(`${parsed.operationsPath}/`)) {
        assertMethod(req, ['GET', 'POST']);
        await handleOperations(req, res, pathname);
        return;
      }

      sendJson(res, 404, {
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: `Unknown gateway path: ${pathname}`,
        },
      });
    } catch (error) {
      if (error && error.code === 'UNAUTHORIZED') {
        metricsState.authFailures += 1;
      }
      if (error && error.code) {
        metricsState.lastErrorCode = error.code;
        metricsState.lastErrorAt = new Date().toISOString();
        incrementCounter(metricsState.errorCodeCounts, String(error.code));
      }
      if (res.writableEnded || res.headersSent) {
        try {
          res.destroy(error);
        } catch {
          // ignore secondary response failures
        }
        return;
      }
      const statusCode =
        error && error.code === 'UNAUTHORIZED' ? 401
          : error && error.code === 'FORBIDDEN' ? 403
            : error && error.code === 'AUTH_LAST_PRINCIPAL_FORBIDDEN' ? 409
              : error && error.code === 'AUTH_SELF_DELETE_FORBIDDEN' ? 409
              : error && error.code === 'OPERATION_NOT_FOUND' ? 404
                : error && error.code === 'OPERATION_RECEIPT_NOT_FOUND' ? 404
                  : error && error.code === 'NOT_FOUND' ? 404
              : error && error.code === 'METHOD_NOT_ALLOWED' ? 405
              : 500;
      if (error && error.code === 'METHOD_NOT_ALLOWED' && error.details && Array.isArray(error.details.allowedMethods)) {
        res.setHeader('allow', error.details.allowedMethods.join(', '));
      }
      sendJson(res, statusCode, {
        ok: false,
        error: {
          code: error && error.code ? error.code : 'MCP_HTTP_GATEWAY_FAILED',
          message: error && error.message ? error.message : String(error),
          ...(error && error.details !== undefined ? { details: error.details } : {}),
          ...(error && error.recovery !== undefined ? { recovery: error.recovery } : {}),
        },
      });
    }
  }

  async function start() {
    const server = http.createServer((req, res) => {
      const startedMs = Date.now();
      const requestId = normalizeOptionalText(req.headers['x-request-id']) || `req_${crypto.randomUUID()}`;
      const pathname = new URL(req.url, `http://${req.headers.host || `${parsed.host}:${parsed.port}`}`).pathname;
      const routeName = classifyGatewayRoute(pathname, parsed);
      res.locals = {
        requestId,
        routeName,
      };
      metricsState.requestsTotal += 1;
      metricsState.inFlightRequests += 1;
      metricsState.lastRequestAt = new Date(startedMs).toISOString();
      incrementCounter(metricsState.methodCounts, String(req.method || 'GET').toUpperCase());
      incrementCounter(metricsState.routeCounts, routeName);
      if (routeName === 'operations') {
        if (String(req.method || 'GET').toUpperCase() === 'POST') {
          metricsState.operationWrites += 1;
        } else {
          metricsState.operationReads += 1;
        }
      }
      res.on('finish', () => {
        metricsState.inFlightRequests = Math.max(0, metricsState.inFlightRequests - 1);
        metricsState.completedRequests += 1;
        metricsState.lastResponseAt = new Date().toISOString();
        incrementCounter(metricsState.statusCounts, String(res.statusCode || 0));
        if (res.statusCode >= 400) {
          incrementCounter(metricsState.errorCodeCounts, String(res.statusCode || 0));
        }
      });
      requestHandler(req, res).catch((error) => {
        if (error && error.code === 'UNAUTHORIZED') {
          metricsState.authFailures += 1;
        }
        if (error && error.code) {
          metricsState.lastErrorCode = error.code;
          metricsState.lastErrorAt = new Date().toISOString();
          incrementCounter(metricsState.errorCodeCounts, String(error.code));
        }
        if (res.writableEnded || res.headersSent) {
          try {
            res.destroy(error);
          } catch {
            // ignore secondary response failures
          }
          return;
        }
        sendJson(res, 500, {
          ok: false,
          error: {
            code: 'MCP_HTTP_GATEWAY_FAILED',
            message: error && error.message ? error.message : String(error),
            ...(error && error.recovery !== undefined ? { recovery: error.recovery } : {}),
          },
        });
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      const onListening = () => {
        server.off('error', reject);
        resolve();
      };
      if (isWildcardHost(parsed.host)) {
        server.listen(parsed.port, onListening);
        return;
      }
      server.listen(parsed.port, parsed.host, onListening);
    });
    const address = server.address();
    const actualPort = address && typeof address === 'object' ? address.port : parsed.port;
    const controlHost = isWildcardHost(parsed.host) ? 'localhost' : parsed.host;
    const baseUrl = `http://${controlHost}:${actualPort}`;
    controlBaseUrl = baseUrl;
    if (!advertisedBaseUrl) {
      advertisedBaseUrl = isWildcardHost(parsed.host) ? null : baseUrl;
    }
    const tokenRecords = authConfig.registry.tokenRecords;
    const generatedTokenRecord = tokenRecords.find((entry) => entry.generated === true) || null;
    const defaultTokenRecord = tokenRecords.length === 1 ? tokenRecords[0] : null;
    if (generatedTokenRecord) {
      generatedTokenFile = writeGeneratedAuthToken(generatedTokenRecord.token);
      authConfig.registry.bindGeneratedTokenFile(generatedTokenFile);
    }
    return {
      server,
      config: {
        ...parsed,
        baseUrl,
        advertisedBaseUrl,
        authPath,
      },
      auth: {
        token: defaultTokenRecord ? defaultTokenRecord.token : null,
        generated: Boolean(generatedTokenRecord),
        scopes: generatedTokenRecord
          ? generatedTokenRecord.scopes.slice()
          : Array.from(new Set(tokenRecords.flatMap((entry) => entry.scopes || []))).sort(),
        tokenRecords: tokenRecords.map((entry) => ({
          id: entry.id,
          generated: Boolean(entry.generated),
          scopes: Array.isArray(entry.scopes) ? entry.scopes.slice() : [],
          label: entry.label || entry.id,
          principalType: entry.principalType || 'service',
          principalTemplate: entry.principalTemplate || inferPrincipalTemplate(entry.scopes || []),
          status: entry.status || 'active',
        })),
        tokenFile: generatedTokenFile,
      },
      close() {
        return new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      },
    };
  }

  return {
    parseMcpHttpFlags,
    start,
  };
}

function createRunMcpHttpGateway(options = {}) {
  return {
    async runMcpHttpGateway(args = [], context = {}) {
      const service = createMcpHttpGatewayService({
        args,
        packageVersion: options.packageVersion,
        cliPath: options.cliPath,
        protocolOptions: options.protocolOptions,
      });
      const gateway = await service.start();
      const startupLines = [
        `Pandora MCP HTTP gateway listening on ${gateway.config.baseUrl}${gateway.config.mcpPath}`,
        ...(gateway.config.advertisedBaseUrl && gateway.config.advertisedBaseUrl !== gateway.config.baseUrl
          ? [`Advertised MCP endpoint: ${gateway.config.advertisedBaseUrl}${gateway.config.mcpPath}`]
          : []),
        `Tool exposure mode: ${gateway.config.toolExposureMode}`,
        `Bootstrap: ${gateway.config.baseUrl}${gateway.config.bootstrapPath}`,
        `Capabilities: ${gateway.config.baseUrl}${gateway.config.capabilitiesPath}`,
        `Schema: ${gateway.config.baseUrl}${gateway.config.schemaPath}`,
        `Tools: ${gateway.config.baseUrl}${gateway.config.toolsPath}`,
        `Auth: ${gateway.config.baseUrl}${gateway.config.authPath}`,
        `Health: ${gateway.config.baseUrl}${gateway.config.healthPath}`,
        `Ready: ${gateway.config.baseUrl}${gateway.config.readyPath}`,
        `Metrics: ${gateway.config.baseUrl}${gateway.config.metricsPath}`,
        `Operations: ${gateway.config.baseUrl}${gateway.config.operationsPath}`,
        `Auth scopes: ${gateway.auth.scopes.join(', ')}`,
        `Principals: ${gateway.auth.tokenRecords.length}`,
        gateway.auth.generated
          ? `Auth token file: ${gateway.auth.tokenFile}`
          : 'Auth token: provided via configuration',
      ];
      if (context.outputMode === 'table') {
        startupLines.forEach((line) => console.log(line));
      }
      await new Promise((resolve, reject) => {
        gateway.server.on('close', resolve);
        gateway.server.on('error', reject);
      });
    },
  };
}

module.exports = {
  parseMcpHttpFlags,
  createMcpHttpGatewayService,
  createRunMcpHttpGateway,
};
