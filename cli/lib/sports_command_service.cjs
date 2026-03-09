const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { loadSportsModelInput } = require('./sports_model_input_service.cjs');
const { buildSportsSchedulePayload, buildSportsScoresPayload } = require('./sports_read_surface_service.cjs');
const { isMcpMode } = require('./shared/mcp_path_guard.cjs');

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunSportsCommand requires deps.${name}()`);
  }
  return deps[name];
}

const SPORTS_USAGE =
  'pandora [--output table|json] sports schedule|scores|books list|events list|events live|odds snapshot|odds bulk|consensus|create plan|create run|sync once|sync run|sync start|sync stop|sync status|resolve plan [flags]';
const BULK_ODDS_CACHE_SCHEMA_VERSION = '1.1.0';
const BULK_ODDS_TTL_GT_24H_MS = 5 * 60_000;
const BULK_ODDS_TTL_GT_1H_MS = 60_000;
const BULK_ODDS_TTL_LIVE_OR_NEAR_MS = 30_000;

function defaultStateFile() {
  if (isMcpMode()) {
    return path.resolve(process.cwd(), '.pandora', 'sports', 'sports_sync_state.json');
  }
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir() || '.';
  return path.join(home, '.pandora', 'sports_sync_state.json');
}

function defaultBulkOddsCacheDir() {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir() || '.';
  return path.join(home, '.pandora', 'cache', 'odds');
}

function toPositiveIntOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.trunc(numeric);
}

function normalizeBookToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeEventId(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeCacheToken(value, fallback = 'unknown') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || fallback;
}

function computeStrategyHash(options) {
  const seed = [
    options.eventId || '',
    options.provider || 'auto',
    options.selection || 'home',
    options.marketType || 'amm',
  ].join('|');
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

function readJsonFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort chmod across platforms
  }
}

function buildBulkOddsSnapshotKey(provider, marketType) {
  return `${normalizeCacheToken(provider, 'auto')}|${normalizeCacheToken(marketType, 'soccer_winner')}`;
}

function parseDateMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveBulkOddsTtlPolicy(event, nowMs = Date.now()) {
  const status = String(event && event.status ? event.status : '')
    .trim()
    .toLowerCase();
  const kickoffMs = parseDateMs(event && event.startTime);

  if (status.includes('live') || status.includes('inplay') || status.includes('in-play')) {
    return {
      state: 'live',
      ttlMs: BULK_ODDS_TTL_LIVE_OR_NEAR_MS,
      kickoffAt: event && event.startTime ? event.startTime : null,
    };
  }

  if (kickoffMs === null) {
    return {
      state: 'unknown',
      ttlMs: BULK_ODDS_TTL_GT_1H_MS,
      kickoffAt: null,
    };
  }

  const untilKickoffMs = kickoffMs - nowMs;
  if (untilKickoffMs > 24 * 60 * 60_000) {
    return {
      state: 'prematch',
      ttlMs: BULK_ODDS_TTL_GT_24H_MS,
      kickoffAt: new Date(kickoffMs).toISOString(),
    };
  }
  if (untilKickoffMs > 60 * 60_000) {
    return {
      state: 'prematch',
      ttlMs: BULK_ODDS_TTL_GT_1H_MS,
      kickoffAt: new Date(kickoffMs).toISOString(),
    };
  }
  return {
    state: 'near-live',
    ttlMs: BULK_ODDS_TTL_LIVE_OR_NEAR_MS,
    kickoffAt: new Date(kickoffMs).toISOString(),
  };
}

function resolveBulkOddsCacheFile(options, competition, marketType = 'soccer_winner') {
  if (options.bulkOddsCacheFile || process.env.SPORTS_BULK_ODDS_CACHE_FILE) {
    return options.bulkOddsCacheFile || process.env.SPORTS_BULK_ODDS_CACHE_FILE;
  }
  const baseDir = options.bulkOddsCacheDir || process.env.SPORTS_BULK_ODDS_CACHE_DIR || defaultBulkOddsCacheDir();
  const competitionToken = normalizeCacheToken(competition, 'competition');
  const marketToken = normalizeCacheToken(marketType, 'soccer_winner');
  return path.join(baseDir, `${competitionToken}__${marketToken}.json`);
}

function normalizeCachePayload(payload, competition) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      schemaVersion: BULK_ODDS_CACHE_SCHEMA_VERSION,
      competitionId: String(competition || '').toLowerCase(),
      snapshots: {},
    };
  }
  return {
    schemaVersion: BULK_ODDS_CACHE_SCHEMA_VERSION,
    competitionId: String(payload.competitionId || competition || '').toLowerCase(),
    snapshots: payload.snapshots && typeof payload.snapshots === 'object' ? payload.snapshots : {},
  };
}

function enrichCompetitionSnapshotRows(snapshot, nowMs = Date.now()) {
  const odds = Array.isArray(snapshot && snapshot.odds) ? snapshot.odds : [];
  const rows = [];
  for (const row of odds) {
    const eventId = normalizeEventId(row && row.event && row.event.id);
    if (!eventId) continue;
    const ttl = deriveBulkOddsTtlPolicy(row && row.event ? row.event : {}, nowMs);
    rows.push({
      eventId,
      ttlMs: ttl.ttlMs,
      state: ttl.state,
      kickoffAt: ttl.kickoffAt,
      cachedAtMs: nowMs,
      expiresAtMs: nowMs + ttl.ttlMs,
      payload: row,
    });
  }
  return rows;
}

function withOddsSource(payload, sourceMeta) {
  const source = payload && payload.source && typeof payload.source === 'object' ? payload.source : {};
  return {
    ...payload,
    source: {
      ...source,
      cache: {
        source: sourceMeta.source,
        hit: Boolean(sourceMeta.hit),
        miss: Boolean(sourceMeta.miss),
        ttlMs: Number.isFinite(sourceMeta.ttlMs) ? Number(sourceMeta.ttlMs) : null,
        file: sourceMeta.file || null,
      },
      ...(sourceMeta.competitionId
        ? {
            bulk: {
              used: Boolean(sourceMeta.used),
              cacheHit: Boolean(sourceMeta.hit),
              competitionId: sourceMeta.competitionId,
              file: sourceMeta.file || null,
              ttlMs: Number.isFinite(sourceMeta.ttlMs) ? Number(sourceMeta.ttlMs) : null,
            },
          }
        : {}),
    },
  };
}

function pickCacheSnapshot(cachePayload, providerMode, marketType) {
  const snapshots = cachePayload && cachePayload.snapshots ? cachePayload.snapshots : {};
  const marketSuffix = `|${normalizeCacheToken(marketType, 'soccer_winner')}`;
  const mode = normalizeCacheToken(providerMode, 'auto');
  const directKey = `${mode}${marketSuffix}`;
  if (snapshots[directKey]) {
    return { key: directKey, snapshot: snapshots[directKey] };
  }

  const keys = Object.keys(snapshots).filter((key) => key.endsWith(marketSuffix));
  if (!keys.length) return null;
  keys.sort((a, b) => Number(snapshots[b].cachedAtMs || 0) - Number(snapshots[a].cachedAtMs || 0));
  return { key: keys[0], snapshot: snapshots[keys[0]] };
}

function compactSnapshotRows(rows, nowMs = Date.now()) {
  return (Array.isArray(rows) ? rows : []).filter((row) => Number(row && row.expiresAtMs) > nowMs);
}

function findCachedEventRow(snapshot, eventId, nowMs = Date.now()) {
  const targetId = normalizeEventId(eventId);
  if (!targetId) return null;
  const rows = compactSnapshotRows(snapshot && snapshot.rows, nowMs);
  return rows.find((row) => normalizeEventId(row && row.eventId) === targetId) || null;
}

function writeCompetitionSnapshot(cacheFile, competition, snapshotKey, snapshot) {
  const payload = normalizeCachePayload(readJsonFile(cacheFile), competition);
  payload.schemaVersion = BULK_ODDS_CACHE_SCHEMA_VERSION;
  payload.competitionId = String(competition || '').toLowerCase();
  payload.snapshots[snapshotKey] = snapshot;

  const nowMs = Date.now();
  for (const [key, value] of Object.entries(payload.snapshots)) {
    const rows = compactSnapshotRows(value && value.rows, nowMs);
    if (!rows.length) {
      delete payload.snapshots[key];
      continue;
    }
    payload.snapshots[key] = {
      ...value,
      rows,
    };
  }

  writeJsonFile(cacheFile, payload);
}

function buildBulkCompetitionPayload(snapshot, sourceMeta, competition, marketType = 'soccer_winner') {
  const rows = compactSnapshotRows(snapshot && snapshot.rows, Date.now());
  const ttlValues = rows
    .map((row) => Number(row && row.ttlMs))
    .filter((value) => Number.isFinite(value) && value > 0);
  const ttlMs = ttlValues.length ? Math.min(...ttlValues) : null;
  return {
    schemaVersion: snapshot && snapshot.schemaVersion ? snapshot.schemaVersion : BULK_ODDS_CACHE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    provider: snapshot && snapshot.provider ? snapshot.provider : null,
    mode: snapshot && snapshot.mode ? snapshot.mode : null,
    competitionId: String(competition || '').toLowerCase(),
    marketType,
    count: rows.length,
    odds: rows.map((row) => row.payload),
    source: {
      provider: snapshot && snapshot.provider ? snapshot.provider : null,
      cache: {
        source: sourceMeta.source,
        hit: Boolean(sourceMeta.hit),
        miss: Boolean(sourceMeta.miss),
        ttlMs,
        file: sourceMeta.file || null,
      },
      bulk: {
        used: true,
        cacheHit: Boolean(sourceMeta.hit),
        competitionId: String(competition || '').toLowerCase(),
        file: sourceMeta.file || null,
        ttlMs,
      },
    },
  };
}

async function fetchCompetitionSnapshot(providerRegistry, options, competition, marketType = 'soccer_winner') {
  const bulkSnapshot = await providerRegistry.listCompetitionOdds({
    providerMode: options.provider,
    competitionId: competition,
    marketType,
    timeoutMs: options.timeoutMs,
    limit: options.limit,
    from: options.kickoffAfter,
    to: options.kickoffBefore,
  });
  const cachedAtMs = Date.now();
  const rows = enrichCompetitionSnapshotRows(bulkSnapshot, cachedAtMs);
  return {
    schemaVersion: bulkSnapshot && bulkSnapshot.schemaVersion ? bulkSnapshot.schemaVersion : BULK_ODDS_CACHE_SCHEMA_VERSION,
    provider: bulkSnapshot && bulkSnapshot.provider ? bulkSnapshot.provider : options.provider || 'auto',
    mode: bulkSnapshot && bulkSnapshot.mode ? bulkSnapshot.mode : options.provider || 'auto',
    marketType,
    cachedAtMs,
    rows,
  };
}

async function resolveCompetitionOddsPayload(providerRegistry, options, marketType = 'soccer_winner') {
  const competition = String(options.competition || '').trim();
  const cacheFile = resolveBulkOddsCacheFile(options, competition, marketType);
  const cachePayload = normalizeCachePayload(readJsonFile(cacheFile), competition);
  const cacheSelection = pickCacheSnapshot(cachePayload, options.provider, marketType);
  if (cacheSelection && cacheSelection.snapshot) {
    const validRows = compactSnapshotRows(cacheSelection.snapshot.rows, Date.now());
    if (validRows.length) {
      const hydrated = { ...cacheSelection.snapshot, rows: validRows };
      writeCompetitionSnapshot(cacheFile, competition, cacheSelection.key, hydrated);
      return buildBulkCompetitionPayload(
        hydrated,
        { source: 'cache', hit: true, miss: false, file: cacheFile },
        competition,
        marketType,
      );
    }
  }

  const fetched = await fetchCompetitionSnapshot(providerRegistry, options, competition, marketType);
  const snapshotKey = buildBulkOddsSnapshotKey(fetched.provider || options.provider || 'auto', marketType);
  writeCompetitionSnapshot(cacheFile, competition, snapshotKey, fetched);
  return buildBulkCompetitionPayload(
    fetched,
    { source: 'api', hit: false, miss: true, file: cacheFile },
    competition,
    marketType,
  );
}

async function resolveEventOddsPayload(providerRegistry, options, eventId, marketType = 'soccer_winner') {
  const competition = String(options.competition || '').trim();
  if (!competition) {
    const payload = await providerRegistry.getEventOdds(eventId, marketType, {
      providerMode: options.provider,
      timeoutMs: options.timeoutMs,
      limit: options.limit,
      from: options.kickoffAfter,
      to: options.kickoffBefore,
    });
    return withOddsSource(payload, {
      source: 'api',
      hit: false,
      miss: false,
      ttlMs: null,
      file: null,
      used: false,
    });
  }

  const cacheFile = resolveBulkOddsCacheFile(options, competition, marketType);
  const cachePayload = normalizeCachePayload(readJsonFile(cacheFile), competition);
  const cacheSelection = pickCacheSnapshot(cachePayload, options.provider, marketType);
  if (cacheSelection && cacheSelection.snapshot) {
    const cachedRow = findCachedEventRow(cacheSelection.snapshot, eventId, Date.now());
    if (cachedRow && cachedRow.payload) {
      writeCompetitionSnapshot(
        cacheFile,
        competition,
        cacheSelection.key,
        {
          ...cacheSelection.snapshot,
          rows: compactSnapshotRows(cacheSelection.snapshot.rows, Date.now()),
        },
      );
      return withOddsSource(cachedRow.payload, {
        source: 'cache',
        hit: true,
        miss: false,
        ttlMs: cachedRow.ttlMs,
        file: cacheFile,
        competitionId: competition.toLowerCase(),
        used: true,
      });
    }
  }

  let fetched;
  try {
    fetched = await fetchCompetitionSnapshot(providerRegistry, options, competition, marketType);
    const snapshotKey = buildBulkOddsSnapshotKey(fetched.provider || options.provider || 'auto', marketType);
    writeCompetitionSnapshot(cacheFile, competition, snapshotKey, fetched);
  } catch (err) {
    const fallbackFromBulkError = await providerRegistry.getEventOdds(eventId, marketType, {
      providerMode: options.provider,
      timeoutMs: options.timeoutMs,
      limit: options.limit,
      from: options.kickoffAfter,
      to: options.kickoffBefore,
    });
    return withOddsSource(fallbackFromBulkError, {
      source: 'api',
      hit: false,
      miss: true,
      ttlMs: null,
      file: cacheFile,
      competitionId: competition.toLowerCase(),
      used: false,
      errorCode: err && err.code ? String(err.code) : 'SPORTS_LIST_COMPETITION_ODDS_FAILED',
    });
  }

  const row = findCachedEventRow(fetched, eventId, Date.now());
  if (row && row.payload) {
    return withOddsSource(row.payload, {
      source: 'api',
      hit: false,
      miss: true,
      ttlMs: row.ttlMs,
      file: cacheFile,
      competitionId: competition.toLowerCase(),
      used: true,
    });
  }

  const fallback = await providerRegistry.getEventOdds(eventId, marketType, {
    providerMode: options.provider,
    timeoutMs: options.timeoutMs,
    limit: options.limit,
    from: options.kickoffAfter,
    to: options.kickoffBefore,
  });
  return withOddsSource(fallback, {
    source: 'api',
    hit: false,
    miss: true,
    ttlMs: null,
    file: cacheFile,
    competitionId: competition.toLowerCase(),
    used: false,
  });
}

function resolveRiskThresholds(riskProfile) {
  if (riskProfile === 'aggressive') {
    return {
      maxDataAgeMs: 180_000,
      minCoverageRatio: 0.5,
      maxCoverageDropRatio: 0.4,
      maxSpreadJumpBps: 250,
      maxConsecutiveFailures: 5,
      maxConsecutiveGateFailures: 4,
    };
  }
  if (riskProfile === 'balanced') {
    return {
      maxDataAgeMs: 150_000,
      minCoverageRatio: 0.6,
      maxCoverageDropRatio: 0.3,
      maxSpreadJumpBps: 200,
      maxConsecutiveFailures: 4,
      maxConsecutiveGateFailures: 3,
    };
  }
  return {
    maxDataAgeMs: 120_000,
    minCoverageRatio: 0.7,
    maxCoverageDropRatio: 0.25,
    maxSpreadJumpBps: 150,
    maxConsecutiveFailures: 3,
    maxConsecutiveGateFailures: 2,
  };
}

function toConsensusQuotes(oddsPayload, selection, tier1Books) {
  const books = Array.isArray(oddsPayload && oddsPayload.books) ? oddsPayload.books : [];
  const key = selection === 'away' ? 'away' : selection === 'draw' ? 'draw' : 'home';
  const tier1Set = new Set((Array.isArray(tier1Books) ? tier1Books : []).map((item) => normalizeBookToken(item)));

  return books
    .map((bookRow) => {
      const book = String(bookRow.book || bookRow.bookName || '').trim();
      const price = Number(bookRow && bookRow.outcomes && bookRow.outcomes[key]);
      if (!book || !Number.isFinite(price) || price <= 1) return null;
      return {
        book,
        odds: price,
        oddsFormat: 'decimal',
        tier1: tier1Set.size ? tier1Set.has(normalizeBookToken(book)) : false,
      };
    })
    .filter(Boolean);
}

async function resolveSportsScoreEntries(providerRegistry, options = {}) {
  if (options.eventId) {
    const diagnostics = [];
    let status = null;
    let event = null;
    try {
      status = await providerRegistry.getEventStatus(options.eventId, {
        providerMode: options.provider,
        timeoutMs: options.timeoutMs,
      });
    } catch (reason) {
      diagnostics.push({
        code: reason && reason.code ? String(reason.code) : 'SPORTS_STATUS_UNAVAILABLE',
        eventId: options.eventId,
        message: reason && reason.message ? reason.message : 'Failed to refresh event status; falling back to schedule fields.',
      });
      try {
        const fallbackSchedule = await providerRegistry.listEvents({
          providerMode: options.provider,
          competitionId: options.competition,
          from: options.kickoffAfter,
          to: options.kickoffBefore,
          status: options.liveOnly ? 'live' : null,
          limit: options.limit,
          timeoutMs: options.timeoutMs,
        });
        const fallbackEvents = Array.isArray(fallbackSchedule.events) ? fallbackSchedule.events : [];
        event = fallbackEvents.find((item) => String(item && item.id) === String(options.eventId)) || null;
        return {
          provider: fallbackSchedule.provider || options.provider || 'auto',
          mode: fallbackSchedule.mode || options.provider || 'auto',
          entries: [{ event, status: null }],
          diagnostics,
        };
      } catch (fallbackReason) {
        diagnostics.push({
          code: fallbackReason && fallbackReason.code ? String(fallbackReason.code) : 'SPORTS_SCHEDULE_FALLBACK_FAILED',
          eventId: options.eventId,
          message: fallbackReason && fallbackReason.message ? fallbackReason.message : 'Failed to refresh fallback schedule fields.',
        });
      }
    }
    return {
      provider: (status && status.provider) || options.provider || 'auto',
      mode: (status && status.mode) || options.provider || 'auto',
      entries: [{ event, status }],
      diagnostics,
    };
  }

  const eventsPayload = await providerRegistry.listEvents({
    providerMode: options.provider,
    competitionId: options.competition,
    from: options.kickoffAfter,
    to: options.kickoffBefore,
    status: options.liveOnly ? 'live' : null,
    limit: options.limit,
    timeoutMs: options.timeoutMs,
  });

  const events = Array.isArray(eventsPayload.events) ? eventsPayload.events : [];
  const settled = await Promise.allSettled(
    events.map((event) => providerRegistry.getEventStatus(event.id, {
      providerMode: options.provider,
      timeoutMs: options.timeoutMs,
    })),
  );

  const diagnostics = [];
  const entries = events.map((event, index) => {
    const result = settled[index];
    if (result && result.status === 'fulfilled') {
      return {
        event,
        status: result.value,
      };
    }

    const reason = result && result.reason ? result.reason : null;
    diagnostics.push({
      code: reason && reason.code ? String(reason.code) : 'SPORTS_STATUS_UNAVAILABLE',
      eventId: event.id,
      message: reason && reason.message ? reason.message : 'Failed to refresh event status; falling back to schedule fields.',
    });
    return {
      event,
      status: null,
    };
  });

  return {
    provider: eventsPayload.provider || options.provider || 'auto',
    mode: eventsPayload.mode || options.provider || 'auto',
    entries,
    diagnostics,
  };
}

function renderSportsTable(payload) {
  if (!payload || typeof payload !== 'object') {
    console.log('No data');
    return;
  }

  if (payload.source && payload.source.consensus) {
    const c = payload.source.consensus;
    console.log(`Consensus: yes=${c.consensusYesPct ?? 'n/a'} no=${c.consensusNoPct ?? 'n/a'} confidence=${c.confidence}`);
  }

  if (Array.isArray(payload.events)) {
    console.table(
      payload.events.map((item) => ({
        id: item.id,
        home: item.homeTeam,
        away: item.awayTeam,
        kickoffAt: item.startTime,
        status: item.status,
      })),
    );
    return;
  }

  if (Array.isArray(payload.schedule)) {
    console.table(
      payload.schedule.map((item) => ({
        eventId: item.eventId,
        home: item.homeTeam,
        away: item.awayTeam,
        kickoffAt: item.kickoffAt,
        status: item.status,
      })),
    );
    return;
  }

  if (Array.isArray(payload.scores)) {
    console.table(
      payload.scores.map((item) => ({
        eventId: item.eventId,
        home: item.homeTeam,
        away: item.awayTeam,
        homeScore: item.homeScore,
        awayScore: item.awayScore,
        score: item.score,
        status: item.status,
        updatedAt: item.updatedAt,
      })),
    );
    if (Array.isArray(payload.diagnostics) && payload.diagnostics.length) {
      console.log(`diagnostics: ${payload.diagnostics.map((item) => item && item.message ? item.message : JSON.stringify(item)).join(' | ')}`);
    }
    return;
  }

  if (Array.isArray(payload.books)) {
    console.table(payload.books.map((item) => ({ book: item.book, home: item.outcomes.home, draw: item.outcomes.draw, away: item.outcomes.away })));
    return;
  }

  if (Array.isArray(payload.odds)) {
    console.table(
      payload.odds.map((item) => ({
        eventId: item && item.event ? item.event.id : null,
        home: item && item.event ? item.event.homeTeam : null,
        away: item && item.event ? item.event.awayTeam : null,
        kickoffAt: item && item.event ? item.event.startTime : null,
        status: item && item.event ? item.event.status : null,
        books: item ? item.bookCount : null,
      })),
    );
    return;
  }

  if (payload.timing && payload.timing.creationWindow) {
    console.log(`Creation window: ${payload.timing.creationWindow.status} (open=${payload.timing.creationWindow.opensAt}, close=${payload.timing.creationWindow.closesAt})`);
  }

  console.log('Done.');
}

/**
 * Create sports command runner.
 * @param {object} deps
 * @returns {(args: string[], context: {outputMode: 'table'|'json'}) => Promise<void>}
 */
function createRunSportsCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseSportsFlags = requireDep(deps, 'parseSportsFlags');
  const createSportsProviderRegistry = requireDep(deps, 'createSportsProviderRegistry');
  const computeSportsConsensus = requireDep(deps, 'computeSportsConsensus');
  const buildSportsCreatePlan = requireDep(deps, 'buildSportsCreatePlan');
  const buildSyncStatusPayload = requireDep(deps, 'buildSyncStatusPayload');
  const detectConcurrentSyncConflict = requireDep(deps, 'detectConcurrentSyncConflict');
  const buildSportsResolvePlan = requireDep(deps, 'buildSportsResolvePlan');
  const deployPandoraAmmMarket = requireDep(deps, 'deployPandoraAmmMarket');
  const assertLiveWriteAllowed = typeof deps.assertLiveWriteAllowed === 'function' ? deps.assertLiveWriteAllowed : null;

  function toCliError(err, fallbackCode, fallbackMessage) {
    if (err && err.code) {
      return new CliError(err.code, err.message || fallbackMessage, err.details);
    }
    return new CliError(
      fallbackCode,
      fallbackMessage,
      { cause: err && err.message ? err.message : String(err) },
    );
  }

  return async function runSportsCommand(args, context) {
    if (!args.length || includesHelpFlag(args)) {
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'sports.help', commandHelpPayload(SPORTS_USAGE));
      } else {
        console.log(`Usage: ${SPORTS_USAGE}`);
      }
      return;
    }

    const parsed = parseSportsFlags(args);
    const options = parsed.options || {};
    const providerRegistry = createSportsProviderRegistry({ mode: options.provider });

    if (parsed.command === 'sports.books.list') {
      const health = await providerRegistry.health();
      emitSuccess(context.outputMode, parsed.command, {
        provider: options.provider,
        requestedBooks: options.bookPriority,
        health,
        books: options.bookPriority || null,
      }, renderSportsTable);
      return;
    }

    if (parsed.command === 'sports.schedule') {
      const payload = await providerRegistry.listEvents({
        providerMode: options.provider,
        competitionId: options.competition,
        from: options.kickoffAfter,
        to: options.kickoffBefore,
        status: null,
        limit: options.limit,
        timeoutMs: options.timeoutMs,
      });
      emitSuccess(context.outputMode, parsed.command, buildSportsSchedulePayload(payload, options), renderSportsTable);
      return;
    }

    if (parsed.command === 'sports.scores') {
      const payload = await resolveSportsScoreEntries(providerRegistry, options);
      emitSuccess(context.outputMode, parsed.command, buildSportsScoresPayload(payload, options), renderSportsTable);
      return;
    }

    if (parsed.command === 'sports.events.list' || parsed.command === 'sports.events.live') {
      const payload = await providerRegistry.listEvents({
        providerMode: options.provider,
        competitionId: options.competition,
        from: options.kickoffAfter,
        to: options.kickoffBefore,
        status: options.liveOnly ? 'live' : null,
        limit: options.limit,
        timeoutMs: options.timeoutMs,
      });
      emitSuccess(context.outputMode, parsed.command, payload, renderSportsTable);
      return;
    }

    if (parsed.command === 'sports.odds.snapshot') {
      const payload = await resolveEventOddsPayload(providerRegistry, options, options.eventId, 'soccer_winner');
      const quotes = toConsensusQuotes(payload, options.selection, options.bookPriority || payload.preferredBooks);
      const consensus = computeSportsConsensus(quotes, {
        trimPercent: options.trimPercent,
        minTotalBooks: options.minTotalBooks,
        minTier1Books: options.minTier1Books,
        tier1Books: options.bookPriority || payload.preferredBooks,
      });

      emitSuccess(context.outputMode, parsed.command, {
        ...payload,
        source: {
          ...(payload.source && typeof payload.source === 'object' ? payload.source : {}),
          provider: payload.provider,
          consensus,
        },
      }, renderSportsTable);
      return;
    }

    if (parsed.command === 'sports.odds.bulk') {
      const payload = await resolveCompetitionOddsPayload(providerRegistry, options, 'soccer_winner');
      emitSuccess(context.outputMode, parsed.command, payload, renderSportsTable);
      return;
    }

    if (parsed.command === 'sports.consensus') {
      let quotes;
      let diagnostics = [];
      let source = null;
      if (Array.isArray(options.checksJson)) {
        quotes = options.checksJson;
      } else {
        const odds = await resolveEventOddsPayload(providerRegistry, options, options.eventId, 'soccer_winner');
        quotes = toConsensusQuotes(odds, options.selection, options.bookPriority || odds.preferredBooks);
        diagnostics = [`quotes:${quotes.length}`];
        source = odds.source && typeof odds.source === 'object' ? odds.source : null;
      }

      const consensus = computeSportsConsensus(quotes, {
        trimPercent: options.trimPercent,
        minTotalBooks: options.minTotalBooks,
        minTier1Books: options.minTier1Books,
        tier1Books: options.bookPriority,
      });
      emitSuccess(context.outputMode, parsed.command, {
        eventId: options.eventId,
        method: options.consensus,
        source: { ...(source || {}), consensus },
        diagnostics,
      }, renderSportsTable);
      return;
    }

    if (parsed.command === 'sports.create.plan' || parsed.command === 'sports.create.run') {
      let modelInput = null;
      try {
        modelInput = loadSportsModelInput(options);
      } catch (err) {
        throw toCliError(err, 'INVALID_FLAG_VALUE', 'Invalid sports model input.');
      }
      const odds = await resolveEventOddsPayload(providerRegistry, options, options.eventId, 'soccer_winner');
      const status = await providerRegistry.getEventStatus(options.eventId);
      const event = {
        ...(odds.event || {}),
        status: status.status || (odds.event && odds.event.status) || 'unknown',
      };
      const plan = buildSportsCreatePlan({ event, oddsPayload: odds, options, modelInput });
      const planWithSource = {
        ...plan,
        source: {
          ...(plan.source && typeof plan.source === 'object' ? plan.source : {}),
          ...(odds.source && odds.source.cache ? { cache: odds.source.cache } : {}),
          ...(odds.source && odds.source.bulk ? { bulk: odds.source.bulk } : {}),
        },
      };

      if (parsed.command === 'sports.create.plan') {
        emitSuccess(context.outputMode, parsed.command, planWithSource, renderSportsTable);
        return;
      }

      if (options.execute && !planWithSource.safety.canExecuteCreate) {
        throw new CliError('SPORTS_CREATE_BLOCKED', 'sports create run blocked by conservative timing/coverage gates.', {
          eventId: options.eventId,
          blockedReasons: planWithSource.safety.blockedReasons,
          timing: planWithSource.timing,
          source: planWithSource.source,
        });
      }

      if (planWithSource.marketTemplate.marketType === 'parimutuel') {
        if (options.execute) {
          throw new CliError('UNSUPPORTED_OPERATION', 'sports create run --execute currently supports AMM only.', {
            hints: ['Use sports create plan for parimutuel planning, or launch script for manual execute path.'],
          });
        }
        emitSuccess(context.outputMode, parsed.command, {
          ...planWithSource,
          mode: 'dry-run',
          diagnostics: ['Parimutuel execution is currently planning-only in sports v1.'],
        }, renderSportsTable);
        return;
      }

      if (options.execute && assertLiveWriteAllowed) {
        await assertLiveWriteAllowed('sports.create.run.execute', {
          notionalUsdc: planWithSource.marketTemplate.liquidityUsdc,
          runtimeMode: 'live',
        });
      }

      const deployment = await deployPandoraAmmMarket({
        question: planWithSource.marketTemplate.question,
        rules: planWithSource.marketTemplate.rules,
        sources: planWithSource.marketTemplate.sources,
        targetTimestamp: planWithSource.marketTemplate.targetTimestamp,
        liquidityUsdc: planWithSource.marketTemplate.liquidityUsdc,
        distributionYes: planWithSource.marketTemplate.distributionYes,
        distributionNo: planWithSource.marketTemplate.distributionNo,
        feeTier: planWithSource.marketTemplate.feeTier,
        maxImbalance: planWithSource.marketTemplate.maxImbalance,
        arbiter: planWithSource.marketTemplate.arbiter,
        category: planWithSource.marketTemplate.category,
        minCloseLeadSeconds: planWithSource.marketTemplate.minCloseLeadSeconds,
        execute: Boolean(options.execute),
        chainId: planWithSource.marketTemplate.chainId,
        rpcUrl: planWithSource.marketTemplate.rpcUrl,
        privateKey: options.privateKey,
        profileId: options.profileId || null,
        profileFile: options.profileFile || null,
        usdc: planWithSource.marketTemplate.usdc,
        oracle: planWithSource.marketTemplate.oracle,
        factory: planWithSource.marketTemplate.factory,
        command: 'sports.create.run',
        toolFamily: 'sports',
        source: 'sports.create.run',
      });

      emitSuccess(context.outputMode, parsed.command, {
        ...planWithSource,
        mode: options.execute ? 'execute' : 'dry-run',
        runtime: {
          mode: 'live',
        },
        deployment,
      }, renderSportsTable);
      return;
    }

    if (parsed.command.startsWith('sports.sync.')) {
      const action = parsed.action;
      const stateFile = options.stateFile || defaultStateFile();
      const strategyHash = computeStrategyHash(options);

      if (action === 'start') {
        const previous = readJsonFile(stateFile);
        const concurrency = detectConcurrentSyncConflict(previous, strategyHash);
        if (concurrency.conflict) {
          throw new CliError('SPORTS_SYNC_ALREADY_RUNNING', 'sports sync start blocked because a sync runtime is already active for this state file.', {
            stateFile,
            strategyHash,
            reason: concurrency.reason,
            existingStrategyHash: concurrency.existingStrategyHash,
          });
        }
        const state = {
          running: true,
          strategyHash,
          startedAt: new Date().toISOString(),
          options,
        };
        writeJsonFile(stateFile, state);
        const payload = buildSyncStatusPayload('start', {
          alive: true,
          found: true,
          pid: process.pid,
          pidFile: stateFile,
          strategyHash,
          now: new Date().toISOString(),
          thresholds: resolveRiskThresholds(options.riskProfile),
        });
        emitSuccess(context.outputMode, parsed.command, payload, renderSportsTable);
        return;
      }

      if (action === 'stop') {
        const previous = readJsonFile(stateFile);
        const payload = buildSyncStatusPayload('stop', {
          alive: false,
          found: Boolean(previous),
          pid: previous && previous.pid ? previous.pid : null,
          pidFile: stateFile,
          strategyHash: previous && previous.strategyHash ? previous.strategyHash : strategyHash,
          now: new Date().toISOString(),
          thresholds: resolveRiskThresholds(options.riskProfile),
        });
        if (previous) {
          writeJsonFile(stateFile, {
            ...previous,
            running: false,
            stoppedAt: new Date().toISOString(),
          });
        }
        emitSuccess(context.outputMode, parsed.command, payload, renderSportsTable);
        return;
      }

      if (action === 'status') {
        const state = readJsonFile(stateFile);
        const payload = buildSyncStatusPayload('status', {
          alive: Boolean(state && state.running),
          found: Boolean(state),
          pidFile: stateFile,
          strategyHash: state && state.strategyHash ? state.strategyHash : strategyHash,
          now: new Date().toISOString(),
          thresholds: resolveRiskThresholds(options.riskProfile),
        });
        emitSuccess(context.outputMode, parsed.command, payload, renderSportsTable);
        return;
      }

      const odds = await resolveEventOddsPayload(providerRegistry, options, options.eventId, 'soccer_winner');
      const status = await providerRegistry.getEventStatus(options.eventId);
      const quotes = toConsensusQuotes(odds, options.selection, options.bookPriority || odds.preferredBooks);
      const consensus = computeSportsConsensus(quotes, {
        trimPercent: options.trimPercent,
        minTotalBooks: options.minTotalBooks,
        minTier1Books: options.minTier1Books,
        tier1Books: options.bookPriority || odds.preferredBooks,
      });

      const updatedAt = Date.parse(odds.updatedAt || status.updatedAt || new Date().toISOString());
      const dataAgeMs = Number.isFinite(updatedAt) ? Math.max(0, Date.now() - updatedAt) : 0;
      const coverageRatio = consensus.totalBooks > 0 ? consensus.includedBooks / consensus.totalBooks : 0;
      const spreadBps = Number.isFinite(consensus.consensusYesPct)
        ? Math.round(Math.abs(consensus.consensusYesPct - 50) * 100)
        : 0;

      const payload = buildSyncStatusPayload(action === 'once' ? 'once' : 'run', {
        now: new Date().toISOString(),
        event: {
          startAt: odds.event && odds.event.startTime,
          status: status.status,
          nearSettle: String(status.status || '').toLowerCase().includes('final'),
        },
        cadenceMs: {
          prematch: options.syncCadencePrematchMs,
          live: options.syncCadenceLiveMs,
          'near-settle': options.syncCadenceNearSettleMs,
        },
        dataAgeMs,
        coverageRatio,
        spreadBps,
        consecutiveFailures: 0,
        consecutiveGateFailures: 0,
        gatePassed: consensus.confidence !== 'insufficient',
        thresholds: resolveRiskThresholds(options.riskProfile),
        strategyHash,
        pidFile: stateFile,
      });

      emitSuccess(context.outputMode, parsed.command, {
        ...payload,
        runtime: {
          mode: 'live',
          executionMode: options.paper ? 'paper' : 'execute',
        },
        source: {
          ...(odds.source && typeof odds.source === 'object' ? odds.source : {}),
          provider: options.provider,
          consensus,
        },
        event: odds.event,
      }, renderSportsTable);
      return;
    }

    if (parsed.command === 'sports.resolve.plan') {
      let checks = [];
      if (Array.isArray(options.checksJson)) {
        checks = options.checksJson;
      } else if (options.checksFile) {
        const filePayload = readJsonFile(options.checksFile);
        checks = Array.isArray(filePayload) ? filePayload : [];
      } else {
        const status = await providerRegistry.getEventStatus(options.eventId);
        checks = [
          {
            checkId: `status-${Date.now()}`,
            checkedAt: status.updatedAt || new Date().toISOString(),
            sources: [
              {
                name: 'official-feed',
                official: true,
                finalResult: status.finalResult || status.result || null,
                checkedAt: status.updatedAt || new Date().toISOString(),
              },
            ],
          },
        ];
      }

      const plan = buildSportsResolvePlan({
        pollAddress: options.pollAddress,
        reason: options.reason,
        checks,
        settleDelayMs: options.settleDelayMs,
        consecutiveChecksRequired: options.consecutiveChecksRequired,
        now: options.now || options.nowMs || new Date().toISOString(),
      });

      if (!plan.safeToResolve) {
        throw new CliError('SPORTS_RESOLVE_PLAN_UNSAFE', 'sports resolve plan is not safe yet.', {
          eventId: options.eventId,
          plan,
        });
      }

      emitSuccess(context.outputMode, parsed.command, {
        ...plan,
        timing: {
          statusConfidence: 'high',
          warnings: [],
        },
      }, renderSportsTable);
      return;
    }

    throw new CliError('INVALID_USAGE', `Unsupported sports command: ${parsed.command}`);
  };
}

module.exports = {
  createRunSportsCommand,
  SPORTS_USAGE,
};
