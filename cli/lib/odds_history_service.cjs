const fs = require('fs');
const os = require('os');
const path = require('path');

const ODDS_HISTORY_SCHEMA_VERSION = '1.0.0';

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeRow(input = {}, now = new Date()) {
  const observedAtMs = toMs(input.observedAt) ?? now.getTime();
  return {
    schemaVersion: ODDS_HISTORY_SCHEMA_VERSION,
    observedAt: new Date(observedAtMs).toISOString(),
    observedAtMs,
    competition: input.competition ? String(input.competition) : null,
    eventId: String(input.eventId || '').trim(),
    venue: String(input.venue || '').trim(),
    marketId: input.marketId ? String(input.marketId) : null,
    yesPrice: Number.isFinite(Number(input.yesPrice)) ? Number(input.yesPrice) : null,
    noPrice: Number.isFinite(Number(input.noPrice)) ? Number(input.noPrice) : null,
    midPrice: Number.isFinite(Number(input.midPrice)) ? Number(input.midPrice) : null,
    closeTime: input.closeTime ? String(input.closeTime) : null,
    source: input.source ? String(input.source) : null,
  };
}

function toCsv(rows) {
  const header = [
    'observed_at',
    'observed_at_ms',
    'competition',
    'event_id',
    'venue',
    'market_id',
    'yes_price',
    'no_price',
    'mid_price',
    'close_time',
    'source',
  ];
  const lines = [header.join(',')];
  for (const row of Array.isArray(rows) ? rows : []) {
    const values = [
      row.observedAt,
      row.observedAtMs,
      row.competition,
      row.eventId,
      row.venue,
      row.marketId,
      row.yesPrice,
      row.noPrice,
      row.midPrice,
      row.closeTime,
      row.source,
    ].map((value) => {
      if (value === null || value === undefined) return '';
      const text = String(value);
      if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    });
    lines.push(values.join(','));
  }
  return `${lines.join('\n')}\n`;
}

function tryCreateNodeSqliteAdapter(sqliteModule, filePath) {
  if (!sqliteModule || typeof sqliteModule.DatabaseSync !== 'function') return null;
  const db = new sqliteModule.DatabaseSync(filePath);
  db.exec(`CREATE TABLE IF NOT EXISTS odds_history (
    observed_at TEXT NOT NULL,
    observed_at_ms INTEGER NOT NULL,
    competition TEXT,
    event_id TEXT NOT NULL,
    venue TEXT NOT NULL,
    market_id TEXT,
    yes_price REAL,
    no_price REAL,
    mid_price REAL,
    close_time TEXT,
    source TEXT
  )`);

  const insert = db.prepare(`INSERT INTO odds_history (
    observed_at, observed_at_ms, competition, event_id, venue, market_id, yes_price, no_price, mid_price, close_time, source
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const selectAscending = `SELECT observed_at as observedAt, observed_at_ms as observedAtMs, competition, event_id as eventId, venue,
    market_id as marketId, yes_price as yesPrice, no_price as noPrice, mid_price as midPrice, close_time as closeTime, source
    FROM odds_history WHERE event_id = ? ORDER BY observed_at_ms ASC`;
  const selectDescending = `SELECT observed_at as observedAt, observed_at_ms as observedAtMs, competition, event_id as eventId, venue,
    market_id as marketId, yes_price as yesPrice, no_price as noPrice, mid_price as midPrice, close_time as closeTime, source
    FROM odds_history WHERE event_id = ? ORDER BY observed_at_ms DESC`;

  return {
    kind: 'sqlite',
    insertRows(rows) {
      for (const row of rows) {
        insert.run(
          row.observedAt,
          row.observedAtMs,
          row.competition,
          row.eventId,
          row.venue,
          row.marketId,
          row.yesPrice,
          row.noPrice,
          row.midPrice,
          row.closeTime,
          row.source,
        );
      }
    },
    queryByEventId(eventId, options = {}) {
      if (Number.isInteger(options.limit) && options.limit > 0) {
        const stmt = db.prepare(`${selectDescending} LIMIT ?`);
        return stmt.all(eventId, options.limit).reverse();
      }
      const stmt = db.prepare(selectAscending);
      return stmt.all(eventId);
    },
  };
}

function tryCreateBetterSqliteAdapter(betterSqliteFactory, filePath) {
  if (typeof betterSqliteFactory !== 'function') return null;
  const db = betterSqliteFactory(filePath);
  db.exec(`CREATE TABLE IF NOT EXISTS odds_history (
    observed_at TEXT NOT NULL,
    observed_at_ms INTEGER NOT NULL,
    competition TEXT,
    event_id TEXT NOT NULL,
    venue TEXT NOT NULL,
    market_id TEXT,
    yes_price REAL,
    no_price REAL,
    mid_price REAL,
    close_time TEXT,
    source TEXT
  )`);

  const insert = db.prepare(`INSERT INTO odds_history (
    observed_at, observed_at_ms, competition, event_id, venue, market_id, yes_price, no_price, mid_price, close_time, source
  ) VALUES (@observedAt, @observedAtMs, @competition, @eventId, @venue, @marketId, @yesPrice, @noPrice, @midPrice, @closeTime, @source)`);
  const selectAscending = `SELECT observed_at as observedAt, observed_at_ms as observedAtMs, competition, event_id as eventId, venue, market_id as marketId,
    yes_price as yesPrice, no_price as noPrice, mid_price as midPrice, close_time as closeTime, source
    FROM odds_history WHERE event_id = ? ORDER BY observed_at_ms ASC`;
  const selectDescending = `SELECT observed_at as observedAt, observed_at_ms as observedAtMs, competition, event_id as eventId, venue, market_id as marketId,
    yes_price as yesPrice, no_price as noPrice, mid_price as midPrice, close_time as closeTime, source
    FROM odds_history WHERE event_id = ? ORDER BY observed_at_ms DESC`;

  return {
    kind: 'sqlite',
    insertRows(rows) {
      const tx = db.transaction((batch) => {
        for (const row of batch) insert.run(row);
      });
      tx(rows);
    },
    queryByEventId(eventId, options = {}) {
      if (Number.isInteger(options.limit) && options.limit > 0) {
        return db.prepare(`${selectDescending} LIMIT ?`).all(eventId, options.limit).reverse();
      }
      return db.prepare(selectAscending).all(eventId);
    },
  };
}

function createJsonlAdapter(fsImpl, jsonlFile) {
  return {
    kind: 'jsonl',
    insertRows(rows) {
      if (!rows.length) return;
      const payload = rows.map((row) => JSON.stringify(row)).join('\n');
      fsImpl.appendFileSync(jsonlFile, `${payload}\n`, { mode: 0o600, flag: 'a' });
      try {
        if (typeof fsImpl.chmodSync === 'function') {
          fsImpl.chmodSync(jsonlFile, 0o600);
        }
      } catch {
        // best-effort permission hardening
      }
    },
    queryByEventId(eventId, options = {}) {
      if (!fsImpl.existsSync(jsonlFile)) return [];
      const content = fsImpl.readFileSync(jsonlFile, 'utf8');
      const out = [];
      for (const line of String(content).split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (!parsed || parsed.eventId !== eventId) continue;
        out.push(parsed);
      }
      out.sort((a, b) => Number(a.observedAtMs || 0) - Number(b.observedAtMs || 0));
      if (Number.isInteger(options.limit) && options.limit > 0 && out.length > options.limit) {
        return out.slice(out.length - options.limit);
      }
      return out;
    },
  };
}

function tryResolveSqliteDependency(requireFn) {
  try {
    return { kind: 'node:sqlite', module: requireFn('node:sqlite') };
  } catch {
    // ignore
  }
  try {
    return { kind: 'better-sqlite3', module: requireFn('better-sqlite3') };
  } catch {
    // ignore
  }
  return null;
}

function hardenFilePermissions(fsImpl, filePath) {
  try {
    if (typeof fsImpl.chmodSync !== 'function') return;
    if (typeof fsImpl.existsSync === 'function' && !fsImpl.existsSync(filePath)) return;
    fsImpl.chmodSync(filePath, 0o600);
  } catch {
    // best-effort permission hardening
  }
}

/**
 * Create odds history storage service with sqlite-first fallback to JSONL.
 * @param {object} [options]
 * @returns {{
 *   backend: string,
 *   paths: {baseDir: string, sqliteFile: string, jsonlFile: string},
 *   recordEntries: (entries: object[]) => object,
 *   queryByEventId: (eventId: string, options?: object) => object[],
 *   formatRows: (rows: object[], format: 'json'|'csv') => object[]|string
 * }}
 */
function createOddsHistoryService(options = {}) {
  const fsImpl = options.fs || fs;
  const pathImpl = options.path || path;
  const homeDir =
    options.homeDir
    || process.env.HOME
    || process.env.USERPROFILE
    || (typeof os.homedir === 'function' ? os.homedir() : '.');
  const baseDir = options.baseDir || pathImpl.join(homeDir, '.pandora', 'history');
  const sqliteFile = options.sqliteFile || pathImpl.join(baseDir, 'odds.db');
  const jsonlFile = options.jsonlFile || pathImpl.join(baseDir, 'odds.jsonl');
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const requireFn = typeof options.requireFn === 'function' ? options.requireFn : require;
  const preferredBackend = String(options.backend || 'auto').toLowerCase();

  fsImpl.mkdirSync(baseDir, { recursive: true });
  try {
    if (typeof fsImpl.chmodSync === 'function') {
      fsImpl.chmodSync(baseDir, 0o700);
    }
  } catch {
    // best-effort permission hardening
  }

  let adapter = null;
  if (preferredBackend === 'sqlite' || preferredBackend === 'auto') {
    const sqliteDep = options.sqliteDependency || tryResolveSqliteDependency(requireFn);
    if (sqliteDep && sqliteDep.kind === 'node:sqlite') {
      adapter = tryCreateNodeSqliteAdapter(sqliteDep.module, sqliteFile);
    } else if (sqliteDep && sqliteDep.kind === 'better-sqlite3') {
      adapter = tryCreateBetterSqliteAdapter(sqliteDep.module, sqliteFile);
    }
  }
  if (!adapter) {
    adapter = createJsonlAdapter(fsImpl, jsonlFile);
  }
  hardenFilePermissions(fsImpl, sqliteFile);
  hardenFilePermissions(fsImpl, jsonlFile);

  function recordEntries(entries) {
    const rows = (Array.isArray(entries) ? entries : [])
      .map((entry) => normalizeRow(entry, now()))
      .filter((row) => row.eventId && row.venue);
    adapter.insertRows(rows);
    if (adapter.kind === 'sqlite') {
      hardenFilePermissions(fsImpl, sqliteFile);
    } else {
      hardenFilePermissions(fsImpl, jsonlFile);
    }
    return {
      backend: adapter.kind,
      inserted: rows.length,
      observedAt: now().toISOString(),
    };
  }

  function queryByEventId(eventId, queryOptions = {}) {
    const normalizedEventId = String(eventId || '').trim();
    if (!normalizedEventId) return [];
    return adapter.queryByEventId(normalizedEventId, queryOptions);
  }

  function formatRows(rows, format = 'json') {
    const normalized = String(format || 'json').trim().toLowerCase();
    if (normalized === 'csv') return toCsv(rows);
    return rows;
  }

  return {
    backend: adapter.kind,
    paths: {
      baseDir,
      sqliteFile,
      jsonlFile,
    },
    recordEntries,
    queryByEventId,
    formatRows,
  };
}

module.exports = {
  ODDS_HISTORY_SCHEMA_VERSION,
  createOddsHistoryService,
};
