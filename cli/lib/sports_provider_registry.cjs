const {
  NORMALIZER_SCHEMA_VERSION,
  SOCCER_WINNER_MARKET_TYPE,
  UK_TIER1_DEFAULT_BOOKS,
  normalizeCompetitions,
  normalizeSoccerWinnerEvents,
  normalizeSoccerWinnerOdds,
  normalizeEventStatus,
} = require('./sports_event_normalizer.cjs');

const SPORTS_PROVIDER_MODES = Object.freeze({
  PRIMARY: 'primary',
  BACKUP: 'backup',
  AUTO: 'auto',
});

const DEFAULT_PROVIDER_ENDPOINTS = Object.freeze({
  competitions: '/competitions',
  events: '/events',
  odds: '/events/{eventId}/odds',
  bulkOdds: '/odds',
  status: '/events/{eventId}/status',
  health: '/health',
});

const DEFAULT_TIMEOUT_MS = 12_000;

function toStringOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function toPositiveIntOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.trunc(numeric);
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeProviderMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === SPORTS_PROVIDER_MODES.PRIMARY) return SPORTS_PROVIDER_MODES.PRIMARY;
  if (mode === SPORTS_PROVIDER_MODES.BACKUP) return SPORTS_PROVIDER_MODES.BACKUP;
  return SPORTS_PROVIDER_MODES.AUTO;
}

function normalizeEndpointPath(value, fallbackPath) {
  const endpoint = toStringOrNull(value) || fallbackPath;
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
}

function mergeHeaders(base, extra) {
  const headers = {};
  for (const [key, value] of Object.entries(base || {})) {
    if (!toStringOrNull(key) || value === null || value === undefined) continue;
    headers[String(key)] = String(value);
  }
  for (const [key, value] of Object.entries(extra || {})) {
    if (!toStringOrNull(key) || value === null || value === undefined) continue;
    headers[String(key)] = String(value);
  }
  return headers;
}

function buildQueryString(url, query) {
  const entries = Object.entries(query || {})
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === null || item === undefined || item === '') continue;
        url.searchParams.append(key, String(item));
      }
      continue;
    }
    url.searchParams.set(key, String(value));
  }
}

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
}

function providerError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function extractListFromPayload(payload, keys) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  if (payload.data && typeof payload.data === 'object') {
    for (const key of keys) {
      if (Array.isArray(payload.data[key])) return payload.data[key];
    }
    if (Array.isArray(payload.data.items)) return payload.data.items;
  }
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') {
      return value;
    }
  }
  return null;
}

function normalizeBooks(value) {
  if (!value) return UK_TIER1_DEFAULT_BOOKS;
  if (Array.isArray(value)) {
    const list = value
      .map((item) => String(item || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ''))
      .filter(Boolean);
    return list.length ? list : UK_TIER1_DEFAULT_BOOKS;
  }
  const list = String(value)
    .split(',')
    .map((item) => item.trim().toLowerCase().replace(/[^a-z0-9]+/g, ''))
    .filter(Boolean);
  return list.length ? list : UK_TIER1_DEFAULT_BOOKS;
}

function buildProviderConfig(role, options = {}, env = process.env) {
  const upper = role === 'backup' ? 'BACKUP' : 'PRIMARY';
  const explicit = options && typeof options === 'object' ? options : {};

  const baseUrl = toStringOrNull(
    pickFirst(
      explicit.baseUrl,
      explicit.url,
      env[`SPORTSBOOK_${upper}_BASE_URL`],
      env[`SPORTSBOOK_${upper}_URL`],
    ),
  );
  const timeoutMs =
    toPositiveIntOrNull(
      pickFirst(
        explicit.timeoutMs,
        env[`SPORTSBOOK_${upper}_TIMEOUT_MS`],
      ),
    )
    || DEFAULT_TIMEOUT_MS;

  const apiKey = toStringOrNull(pickFirst(explicit.apiKey, env[`SPORTSBOOK_${upper}_API_KEY`]));
  const apiKeyHeader = toStringOrNull(pickFirst(explicit.apiKeyHeader, env[`SPORTSBOOK_${upper}_API_KEY_HEADER`])) || 'x-api-key';
  const headers = mergeHeaders(
    parseJsonObject(pickFirst(explicit.headers, env[`SPORTSBOOK_${upper}_HEADERS_JSON`])),
    apiKey ? { [apiKeyHeader]: apiKey } : {},
  );

  return {
    role,
    baseUrl,
    timeoutMs,
    headers,
    defaultQuery: parseJsonObject(pickFirst(explicit.defaultQuery, env[`SPORTSBOOK_${upper}_DEFAULT_QUERY_JSON`])),
    endpoints: {
      competitions: normalizeEndpointPath(
        pickFirst(explicit.competitionsPath, explicit.endpoints && explicit.endpoints.competitions, env[`SPORTSBOOK_${upper}_COMPETITIONS_PATH`]),
        DEFAULT_PROVIDER_ENDPOINTS.competitions,
      ),
      events: normalizeEndpointPath(
        pickFirst(explicit.eventsPath, explicit.endpoints && explicit.endpoints.events, env[`SPORTSBOOK_${upper}_EVENTS_PATH`]),
        DEFAULT_PROVIDER_ENDPOINTS.events,
      ),
      odds: normalizeEndpointPath(
        pickFirst(explicit.oddsPath, explicit.endpoints && explicit.endpoints.odds, env[`SPORTSBOOK_${upper}_ODDS_PATH`]),
        DEFAULT_PROVIDER_ENDPOINTS.odds,
      ),
      bulkOdds: normalizeEndpointPath(
        pickFirst(
          explicit.bulkOddsPath,
          explicit.endpoints && explicit.endpoints.bulkOdds,
          env[`SPORTSBOOK_${upper}_BULK_ODDS_PATH`],
        ),
        DEFAULT_PROVIDER_ENDPOINTS.bulkOdds,
      ),
      status: normalizeEndpointPath(
        pickFirst(explicit.statusPath, explicit.endpoints && explicit.endpoints.status, env[`SPORTSBOOK_${upper}_STATUS_PATH`]),
        DEFAULT_PROVIDER_ENDPOINTS.status,
      ),
      health: normalizeEndpointPath(
        pickFirst(explicit.healthPath, explicit.endpoints && explicit.endpoints.health, env[`SPORTSBOOK_${upper}_HEALTH_PATH`]),
        DEFAULT_PROVIDER_ENDPOINTS.health,
      ),
    },
  };
}

function buildUrl(baseUrl, endpointPath, pathParams = {}, query = {}) {
  let resolvedPath = endpointPath;
  for (const [key, value] of Object.entries(pathParams || {})) {
    resolvedPath = resolvedPath.replace(new RegExp(`\\{${key}\\}`, 'g'), encodeURIComponent(String(value)));
  }

  const target = /^https?:\/\//i.test(resolvedPath)
    ? new URL(resolvedPath)
    : new URL(resolvedPath, baseUrl);
  buildQueryString(target, query);
  return target;
}

/**
 * Create a deterministic sportsbook provider registry.
 * @param {object} [options]
 * @param {'primary'|'backup'|'auto'} [options.mode]
 * @param {object} [options.primary]
 * @param {object} [options.backup]
 * @param {Function} [options.fetch]
 * @param {object} [options.env]
 * @param {number} [options.defaultTimeoutMs]
 * @param {string[]|string} [options.ukTier1Books]
 * @returns {{
 *   listCompetitions: (filters?: object) => Promise<object>,
 *   listEvents: (filters?: object) => Promise<object>,
 *   listCompetitionOdds: (filters?: object) => Promise<object>,
 *   getEventOdds: (eventId: string, marketType?: string) => Promise<object>,
 *   getEventStatus: (eventId: string) => Promise<object>,
 *   health: () => Promise<object>,
 * }}
 */
function createSportsProviderRegistry(options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw providerError('SPORTS_PROVIDER_FETCH_MISSING', 'A fetch implementation is required.');
  }

  const primaryConfig = buildProviderConfig(
    'primary',
    options.primary || {
      baseUrl: options.primaryBaseUrl,
      competitionsPath: options.primaryCompetitionsPath,
      eventsPath: options.primaryEventsPath,
      oddsPath: options.primaryOddsPath,
      statusPath: options.primaryStatusPath,
      healthPath: options.primaryHealthPath,
      headers: options.primaryHeaders,
      timeoutMs: options.primaryTimeoutMs,
    },
    env,
  );
  const backupConfig = buildProviderConfig(
    'backup',
    options.backup || {
      baseUrl: options.backupBaseUrl,
      competitionsPath: options.backupCompetitionsPath,
      eventsPath: options.backupEventsPath,
      oddsPath: options.backupOddsPath,
      statusPath: options.backupStatusPath,
      healthPath: options.backupHealthPath,
      headers: options.backupHeaders,
      timeoutMs: options.backupTimeoutMs,
    },
    env,
  );

  const defaultTimeoutMs = toPositiveIntOrNull(options.defaultTimeoutMs) || DEFAULT_TIMEOUT_MS;
  const defaultMode = normalizeProviderMode(options.mode || env.SPORTSBOOK_PROVIDER_MODE);
  const preferredBooks = normalizeBooks(options.ukTier1Books || env.SPORTSBOOK_UK_TIER1_BOOKS);

  function providerOrder(modeInput) {
    const mode = normalizeProviderMode(modeInput || defaultMode);
    const primaryFirst = [primaryConfig, backupConfig].filter((provider) => provider.baseUrl);
    const backupFirst = [backupConfig, primaryConfig].filter((provider) => provider.baseUrl);
    if (mode === SPORTS_PROVIDER_MODES.BACKUP) return { mode, providers: backupFirst };
    if (mode === SPORTS_PROVIDER_MODES.PRIMARY) return { mode, providers: primaryFirst };
    return { mode, providers: primaryFirst };
  }

  async function requestProvider(provider, endpointKey, request = {}) {
    if (!provider.baseUrl) {
      throw providerError('SPORTS_PROVIDER_NOT_CONFIGURED', `${provider.role} provider is not configured.`);
    }

    const timeoutMs =
      toPositiveIntOrNull(request.timeoutMs)
      || provider.timeoutMs
      || defaultTimeoutMs;
    const query = {
      ...(provider.defaultQuery || {}),
      ...(request.query || {}),
    };
    const url = buildUrl(
      provider.baseUrl,
      provider.endpoints[endpointKey],
      request.pathParams || {},
      query,
    );
    const timer = withTimeout(timeoutMs);
    const startedAt = Date.now();
    let response;
    try {
      response = await fetchImpl(url.toString(), {
        method: 'GET',
        headers: provider.headers,
        signal: timer.signal,
      });
    } catch (err) {
      const timedOut = err && err.name === 'AbortError';
      throw providerError(
        timedOut ? 'SPORTS_PROVIDER_TIMEOUT' : 'SPORTS_PROVIDER_REQUEST_FAILED',
        `${provider.role} ${endpointKey} request failed.`,
        {
          provider: provider.role,
          endpoint: endpointKey,
          url: url.toString(),
          timeoutMs,
          cause: err && err.message ? err.message : String(err),
        },
      );
    } finally {
      timer.clear();
    }

    const elapsedMs = Date.now() - startedAt;
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw providerError(
        'SPORTS_PROVIDER_HTTP_ERROR',
        `${provider.role} ${endpointKey} returned HTTP ${response.status}.`,
        {
          provider: provider.role,
          endpoint: endpointKey,
          url: url.toString(),
          status: response.status,
          body: body.slice(0, 1000),
          elapsedMs,
        },
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw providerError(
        'SPORTS_PROVIDER_INVALID_JSON',
        `${provider.role} ${endpointKey} returned non-JSON payload.`,
        {
          provider: provider.role,
          endpoint: endpointKey,
          url: url.toString(),
          elapsedMs,
          cause: err && err.message ? err.message : String(err),
        },
      );
    }

    return {
      provider: provider.role,
      url: url.toString(),
      elapsedMs,
      payload,
    };
  }

  async function runWithFallback(operationName, modeInput, operation) {
    const { mode, providers } = providerOrder(modeInput);
    if (!providers.length) {
      throw providerError('SPORTS_PROVIDER_NOT_CONFIGURED', 'No sportsbook providers are configured.', {
        mode,
        requiredEnv: ['SPORTSBOOK_PRIMARY_BASE_URL', 'SPORTSBOOK_BACKUP_BASE_URL'],
      });
    }

    const errors = [];
    for (const provider of providers) {
      try {
        return await operation(provider, mode);
      } catch (err) {
        errors.push({
          provider: provider.role,
          code: err && err.code ? String(err.code) : 'SPORTS_PROVIDER_ERROR',
          message: err && err.message ? err.message : String(err),
          details: err && err.details !== undefined ? err.details : undefined,
        });
      }
    }

    throw providerError(`SPORTS_${String(operationName).toUpperCase()}_FAILED`, `${operationName} failed for all providers.`, {
      mode,
      errors,
    });
  }

  /**
   * List soccer competitions from the configured provider mode.
   * @param {object} [filters]
   * @returns {Promise<object>}
   */
  async function listCompetitions(filters = {}) {
    return runWithFallback('list_competitions', filters.providerMode, async (provider, mode) => {
      const response = await requestProvider(provider, 'competitions', {
        query: {
          sport: filters.sport || null,
          country: filters.country || null,
          limit: filters.limit || null,
        },
        timeoutMs: filters.timeoutMs,
      });

      const competitions = normalizeCompetitions(
        extractListFromPayload(response.payload, ['competitions', 'leagues', 'results']),
        { provider: response.provider },
      );
      return {
        schemaVersion: NORMALIZER_SCHEMA_VERSION,
        mode,
        provider: response.provider,
        count: competitions.length,
        competitions,
      };
    });
  }

  /**
   * List normalized soccer winner events from the configured provider mode.
   * @param {object} [filters]
   * @returns {Promise<object>}
   */
  async function listEvents(filters = {}) {
    return runWithFallback('list_events', filters.providerMode, async (provider, mode) => {
      const response = await requestProvider(provider, 'events', {
        query: {
          sport: filters.sport || null,
          competitionId: filters.competitionId || null,
          from: filters.from || null,
          to: filters.to || null,
          status: filters.status || null,
          limit: filters.limit || null,
        },
        timeoutMs: filters.timeoutMs,
      });

      const events = normalizeSoccerWinnerEvents(
        extractListFromPayload(response.payload, ['events', 'fixtures', 'matches', 'results']),
        { provider: response.provider },
      );
      return {
        schemaVersion: NORMALIZER_SCHEMA_VERSION,
        mode,
        provider: response.provider,
        marketType: SOCCER_WINNER_MARKET_TYPE,
        count: events.length,
        events,
      };
    });
  }

  /**
   * List normalized soccer winner odds for all events in one competition.
   * @param {object} [filters]
   * @returns {Promise<object>}
   */
  async function listCompetitionOdds(filters = {}) {
    const competitionId = toStringOrNull(filters.competitionId || filters.competition);
    if (!competitionId) {
      throw providerError('MISSING_REQUIRED_INPUT', 'listCompetitionOdds requires competitionId.');
    }

    const normalizedMarketType = toStringOrNull(filters.marketType) || SOCCER_WINNER_MARKET_TYPE;
    if (normalizedMarketType !== SOCCER_WINNER_MARKET_TYPE) {
      throw providerError(
        'UNSUPPORTED_MARKET_TYPE',
        `Unsupported market type "${normalizedMarketType}". Only "${SOCCER_WINNER_MARKET_TYPE}" is supported.`,
      );
    }

    return runWithFallback('list_competition_odds', filters.providerMode, async (provider, mode) => {
      const response = await requestProvider(provider, 'bulkOdds', {
        query: {
          competitionId,
          marketType: normalizedMarketType,
          sport: filters.sport || null,
          from: filters.from || null,
          to: filters.to || null,
          limit: filters.limit || null,
        },
        timeoutMs: filters.timeoutMs,
      });

      const rows = extractListFromPayload(response.payload, ['events', 'fixtures', 'matches', 'results']);
      const byId = new Map();
      for (const row of rows) {
        const normalized = normalizeSoccerWinnerOdds(row, {
          provider: response.provider,
          eventId: row && (row.id || row.eventId || row.event_id || row.fixtureId || null),
          marketType: normalizedMarketType,
          preferredBooks,
        });
        if (!normalized || !normalized.event || !normalized.event.id) continue;

        if (!normalized.event.competitionId) {
          normalized.event = {
            ...normalized.event,
            competitionId: competitionId.toLowerCase(),
          };
        }
        byId.set(normalized.event.id, normalized);
      }

      const odds = Array.from(byId.values()).sort((a, b) => {
        const timeA = a.event && a.event.startTime ? a.event.startTime : '';
        const timeB = b.event && b.event.startTime ? b.event.startTime : '';
        const timeCmp = timeA.localeCompare(timeB);
        if (timeCmp !== 0) return timeCmp;
        return String(a.event && a.event.id ? a.event.id : '').localeCompare(String(b.event && b.event.id ? b.event.id : ''));
      });

      return {
        schemaVersion: NORMALIZER_SCHEMA_VERSION,
        mode,
        provider: response.provider,
        competitionId: competitionId.toLowerCase(),
        marketType: normalizedMarketType,
        count: odds.length,
        odds,
      };
    });
  }

  /**
   * Get normalized soccer winner odds for one event.
   * @param {string} eventId
   * @param {string} [marketType]
   * @param {{preferBulk?: boolean, competition?: string, providerMode?: string, timeoutMs?: number, limit?: number, from?: string, to?: string}} [options]
   * @returns {Promise<object>}
   */
  async function getEventOdds(eventId, marketType = SOCCER_WINNER_MARKET_TYPE, options = {}) {
    const normalizedEventId = toStringOrNull(eventId);
    if (!normalizedEventId) {
      throw providerError('MISSING_REQUIRED_INPUT', 'getEventOdds requires eventId.');
    }
    const normalizedMarketType = toStringOrNull(marketType) || SOCCER_WINNER_MARKET_TYPE;
    if (normalizedMarketType !== SOCCER_WINNER_MARKET_TYPE) {
      throw providerError(
        'UNSUPPORTED_MARKET_TYPE',
        `Unsupported market type "${normalizedMarketType}". Only "${SOCCER_WINNER_MARKET_TYPE}" is supported.`,
      );
    }

    const competitionId = toStringOrNull(options.competition || options.competitionId);
    if (options.preferBulk && competitionId) {
      const bulkSnapshot = await listCompetitionOdds({
        providerMode: options.providerMode,
        competitionId,
        marketType: normalizedMarketType,
        timeoutMs: options.timeoutMs,
        limit: options.limit,
        from: options.from,
        to: options.to,
      });
      const match = bulkSnapshot.odds.find((row) => {
        const rowEventId = row && row.event && row.event.id ? String(row.event.id).toLowerCase() : null;
        return rowEventId === normalizedEventId.toLowerCase();
      });
      if (match) {
        return {
          ...match,
          mode: bulkSnapshot.mode,
          source: {
            provider: bulkSnapshot.provider,
            bulk: {
              used: true,
              competitionId: bulkSnapshot.competitionId,
              count: bulkSnapshot.count,
            },
          },
        };
      }
    }

    return runWithFallback('get_event_odds', null, async (provider, mode) => {
      const response = await requestProvider(provider, 'odds', {
        pathParams: { eventId: normalizedEventId },
        query: { marketType: normalizedMarketType },
      });
      const normalized = normalizeSoccerWinnerOdds(response.payload, {
        provider: response.provider,
        eventId: normalizedEventId,
        marketType: normalizedMarketType,
        preferredBooks,
      });
      return {
        ...normalized,
        mode,
      };
    });
  }

  /**
   * Get normalized status for one event.
   * @param {string} eventId
   * @returns {Promise<object>}
   */
  async function getEventStatus(eventId, options = {}) {
    const normalizedEventId = toStringOrNull(eventId);
    if (!normalizedEventId) {
      throw providerError('MISSING_REQUIRED_INPUT', 'getEventStatus requires eventId.');
    }

    return runWithFallback('get_event_status', options.providerMode || null, async (provider, mode) => {
      const response = await requestProvider(provider, 'status', {
        pathParams: { eventId: normalizedEventId },
        timeoutMs: options.timeoutMs,
      });
      return {
        ...normalizeEventStatus(response.payload, {
          provider: response.provider,
          eventId: normalizedEventId,
        }),
        mode,
      };
    });
  }

  /**
   * Report provider health for both configured providers.
   * @returns {Promise<object>}
   */
  async function health() {
    const providers = [primaryConfig, backupConfig];
    const checks = [];
    for (const provider of providers) {
      if (!provider.baseUrl) {
        checks.push({
          provider: provider.role,
          configured: false,
          ok: false,
          status: 'not_configured',
          latencyMs: null,
        });
        continue;
      }

      try {
        const response = await requestProvider(provider, 'health');
        const payload = response.payload && typeof response.payload === 'object' ? response.payload : {};
        const statusToken = String(payload.status || payload.state || (payload.ok ? 'ok' : 'unknown')).toLowerCase();
        checks.push({
          provider: provider.role,
          configured: true,
          ok: payload.ok === true || statusToken === 'ok' || statusToken === 'healthy' || statusToken === 'up',
          status: statusToken,
          latencyMs: response.elapsedMs,
        });
      } catch (err) {
        checks.push({
          provider: provider.role,
          configured: true,
          ok: false,
          status: 'error',
          latencyMs: null,
          error: {
            code: err && err.code ? String(err.code) : 'SPORTS_PROVIDER_HEALTH_FAILED',
            message: err && err.message ? err.message : String(err),
          },
        });
      }
    }

    const { mode, providers: ordered } = providerOrder(defaultMode);
    const activeProvider = ordered
      .map((provider) => provider.role)
      .find((role) => checks.some((check) => check.provider === role && check.ok))
      || null;

    return {
      schemaVersion: NORMALIZER_SCHEMA_VERSION,
      mode,
      checkedAt: new Date().toISOString(),
      ok: checks.some((check) => check.ok),
      activeProvider,
      providers: checks,
    };
  }

  return {
    listCompetitions,
    listEvents,
    listCompetitionOdds,
    getEventOdds,
    getEventStatus,
    health,
  };
}

module.exports = {
  SPORTS_PROVIDER_MODES,
  DEFAULT_PROVIDER_ENDPOINTS,
  UK_TIER1_DEFAULT_BOOKS,
  SOCCER_WINNER_MARKET_TYPE,
  createSportsProviderRegistry,
};
