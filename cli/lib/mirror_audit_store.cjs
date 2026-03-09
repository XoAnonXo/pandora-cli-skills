const fs = require('fs');
const path = require('path');
const { expandHome } = require('./mirror_state_store.cjs');

const MIRROR_AUDIT_LOG_SCHEMA_VERSION = '1.0.0';
const DEFAULT_AUDIT_LIMIT = 200;

function resolveAuditFilePath(stateFile) {
  if (!stateFile) return null;
  return `${path.resolve(expandHome(String(stateFile)))}.audit.jsonl`;
}

function appendAuditEntries(stateFile, entries) {
  const auditFile = resolveAuditFilePath(stateFile);
  if (!auditFile) return null;
  const normalizedEntries = Array.isArray(entries) ? entries.filter((entry) => entry && typeof entry === 'object') : [];
  if (!normalizedEntries.length) return auditFile;
  fs.mkdirSync(path.dirname(auditFile), { recursive: true });
  const lines = normalizedEntries
    .map((entry) => JSON.stringify({
      schemaVersion: MIRROR_AUDIT_LOG_SCHEMA_VERSION,
      ...entry,
    }))
    .join('\n');
  fs.appendFileSync(auditFile, `${lines}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(auditFile, 0o600);
  } catch {
    // best-effort permission hardening
  }
  return auditFile;
}

function loadAuditEntries(stateFile, limit = DEFAULT_AUDIT_LIMIT) {
  const auditFile = resolveAuditFilePath(stateFile);
  if (!auditFile || !fs.existsSync(auditFile)) {
    return {
      auditFile,
      entries: [],
    };
  }
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_AUDIT_LIMIT;
  const rawLines = fs.readFileSync(auditFile, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed = [];
  for (const line of rawLines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      parsed.push({
        schemaVersion: MIRROR_AUDIT_LOG_SCHEMA_VERSION,
        classification: 'runtime-alert',
        venue: 'runtime',
        source: 'mirror-audit-log',
        timestamp: new Date().toISOString(),
        status: 'invalid',
        code: 'MIRROR_AUDIT_ENTRY_INVALID',
        message: 'Mirror audit log entry could not be parsed.',
        details: {
          rawLine: line,
        },
      });
    }
  }
  return {
    auditFile,
    entries: parsed.slice(Math.max(parsed.length - safeLimit, 0)),
  };
}

module.exports = {
  MIRROR_AUDIT_LOG_SCHEMA_VERSION,
  appendAuditEntries,
  loadAuditEntries,
  resolveAuditFilePath,
};
