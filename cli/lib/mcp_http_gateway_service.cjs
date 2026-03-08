const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

const { buildCapabilitiesPayload } = require('./capabilities_command_service.cjs');
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
    'policy:read',
    'profile:read',
    'schema:read',
  ].filter((scope) => knownScopes.has(scope));
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

function readAuthTokenFromFile(filePath) {
  const token = fs.readFileSync(filePath, 'utf8').trim();
  if (!token) {
    throw createGatewayError('INVALID_FLAG_VALUE', '--auth-token-file must contain a non-empty token.');
  }
  return token;
}

function writeGeneratedAuthToken(token) {
  const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
  if (!homeDir) {
    throw createGatewayError(
      'INVALID_FLAG_VALUE',
      'Cannot determine a home directory for a generated auth token. Pass --auth-token or --auth-token-file explicitly.',
    );
  }
  const baseDir = path.join(homeDir, '.pandora', 'mcp-http');
  fs.mkdirSync(baseDir, { recursive: true });
  try {
    fs.chmodSync(baseDir, 0o700);
  } catch {
    // best effort
  }
  const tokenFile = path.join(baseDir, 'auth-token');
  fs.writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(tokenFile, 0o600);
  } catch {
    // best effort
  }
  return tokenFile;
}

function parseMcpHttpFlags(args = []) {
  const options = {
    host: '127.0.0.1',
    port: 8787,
    mcpPath: '/mcp',
    healthPath: '/health',
    capabilitiesPath: '/capabilities',
    operationsPath: '/operations',
    publicBaseUrl: null,
    authToken: null,
    authTokenFile: null,
    authScopes: null,
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
      case '--capabilities-path':
        if (!next) throw createGatewayError('MISSING_REQUIRED_FLAG', '--capabilities-path requires a value.');
        options.capabilitiesPath = normalizePath(next, '/capabilities');
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
      case '--auth-scopes':
        if (!next) throw createGatewayError('MISSING_REQUIRED_FLAG', '--auth-scopes requires a value.');
        options.authScopes = parseCsvList(next);
        index += 1;
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

  const authToken = options.authTokenFile
    ? readAuthTokenFromFile(options.authTokenFile)
    : options.authToken || crypto.randomBytes(24).toString('hex');
  const authTokenGenerated = !options.authToken && !options.authTokenFile;
  const authScopes = options.authScopes && options.authScopes.length
    ? Array.from(new Set(options.authScopes))
    : buildDefaultRemoteScopes();

  return {
    host: options.host,
    port: options.port,
    mcpPath: options.mcpPath,
    healthPath: options.healthPath,
    capabilitiesPath: options.capabilitiesPath,
    operationsPath: options.operationsPath,
    publicBaseUrl: options.publicBaseUrl,
    authToken,
    authTokenGenerated,
    authScopes,
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
  if (!token || !safeTokenEquals(token, authConfig.authToken)) {
    throw createGatewayError('UNAUTHORIZED', 'Invalid bearer token.');
  }
  return {
    scopes: authConfig.scopeSet,
  };
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

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
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
    authToken: parsed.authToken,
    authTokenGenerated: parsed.authTokenGenerated,
    authScopes: parsed.authScopes,
    scopeSet: new Set(parsed.authScopes),
  };
  const protocol = createMcpProtocolService({
    ...(options.protocolOptions && typeof options.protocolOptions === 'object' ? options.protocolOptions : {}),
    packageVersion,
    cliPath: options.cliPath,
    remoteTransportActive: true,
    asyncExecution: true,
  });
  const operationService = options.operationService || createOperationService();
  const startedAt = Date.now();
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

  async function handleCapabilities(req, res) {
    const authInfo = ensureAuthorized(req, authConfig);
    assertToolScopes('capabilities', { xPandora: { policyScopes: COMMAND_DESCRIPTORS.capabilities.policyScopes || [] } }, authInfo);
    const resolvedBaseUrl = resolveRequestBaseUrl(req);
    const payload = buildCapabilitiesPayload({
      remoteTransportActive: true,
      remoteTransportUrl: resolvedBaseUrl ? `${resolvedBaseUrl}${parsed.mcpPath}` : null,
    });
    payload.gateway = {
      baseUrl: resolvedBaseUrl || null,
      capabilitiesPath: parsed.capabilitiesPath,
      healthPath: parsed.healthPath,
      mcpPath: parsed.mcpPath,
      operationsPath: parsed.operationsPath,
      authRequired: true,
      grantedScopes: Array.from(authInfo.scopes).sort(),
      advertisedBaseUrl: resolvedBaseUrl,
    };
    sendJson(res, 200, {
      ok: true,
      command: 'capabilities',
      data: payload,
    });
  }

  async function handleOperations(req, res, pathname) {
    const authInfo = ensureAuthorized(req, authConfig);
    if (!scopeMatches('operations:read', authInfo.scopes)) {
      throw createGatewayError('FORBIDDEN', 'operations endpoint requires operations:read scope.');
    }
    const base = parsed.operationsPath.replace(/\/+$/, '');
    const suffix = pathname.slice(base.length);
    if (!suffix || suffix === '/') {
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
    const operationId = decodeURIComponent(suffix.replace(/^\/+/, ''));
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

  async function handleMcp(req, res) {
    const authInfo = ensureAuthorized(req, authConfig);
    const resolvedBaseUrl = resolveRequestBaseUrl(req);
    const server = protocol.createServer({
      assertToolAllowed: (toolName, descriptor) => assertToolScopes(toolName, descriptor, authInfo),
      filterToolDescriptor: (toolName, descriptor) => canAccessToolDescriptor(toolName, descriptor, authInfo),
      buildInvocationEnv: () => ({
        PANDORA_MCP_REMOTE_ACTIVE: '1',
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
        sendJson(res, 200, {
          ok: true,
          command: 'mcp.http.health',
          data: {
            schemaVersion: '1.0.0',
            generatedAt: new Date().toISOString(),
            service: 'pandora-mcp-http',
            version: packageVersion,
            uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
            endpoints: {
              mcp: parsed.mcpPath,
              capabilities: parsed.capabilitiesPath,
              operations: parsed.operationsPath,
            },
            authRequired: true,
          },
        });
        return;
      }

      if (pathname === parsed.capabilitiesPath) {
        assertMethod(req, ['GET']);
        await handleCapabilities(req, res);
        return;
      }

      if (pathname === parsed.mcpPath) {
        assertMethod(req, ['GET', 'POST', 'DELETE']);
        await handleMcp(req, res);
        return;
      }

      if (pathname === parsed.operationsPath || pathname.startsWith(`${parsed.operationsPath}/`)) {
        assertMethod(req, ['GET']);
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
            : error && error.code === 'OPERATION_NOT_FOUND' ? 404
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
      requestHandler(req, res).catch((error) => {
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
      server.listen(parsed.port, parsed.host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    const actualPort = address && typeof address === 'object' ? address.port : parsed.port;
    const controlHost = isWildcardHost(parsed.host) ? '127.0.0.1' : parsed.host;
    const baseUrl = `http://${controlHost}:${actualPort}`;
    controlBaseUrl = baseUrl;
    if (!advertisedBaseUrl) {
      advertisedBaseUrl = isWildcardHost(parsed.host) ? null : baseUrl;
    }
    if (authConfig.authTokenGenerated) {
      generatedTokenFile = writeGeneratedAuthToken(authConfig.authToken);
    }
    return {
      server,
      config: {
        ...parsed,
        baseUrl,
        advertisedBaseUrl,
      },
      auth: {
        token: authConfig.authToken,
        generated: authConfig.authTokenGenerated,
        scopes: authConfig.authScopes.slice(),
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
        `Capabilities: ${gateway.config.baseUrl}${gateway.config.capabilitiesPath}`,
        `Health: ${gateway.config.baseUrl}${gateway.config.healthPath}`,
        `Operations: ${gateway.config.baseUrl}${gateway.config.operationsPath}`,
        `Auth scopes: ${gateway.auth.scopes.join(', ')}`,
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
