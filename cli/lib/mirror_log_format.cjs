const fs = require('fs');

function splitLogLines(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function normalizeStructuredTimestamp(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  for (const key of ['timestamp', 'generatedAt', 'startedAt', 'checkedAt']) {
    if (typeof record[key] === 'string' && record[key].trim()) {
      return record[key];
    }
  }
  const nestedData = record.data;
  if (nestedData && typeof nestedData === 'object' && !Array.isArray(nestedData)) {
    for (const key of ['timestamp', 'generatedAt', 'startedAt', 'checkedAt']) {
      if (typeof nestedData[key] === 'string' && nestedData[key].trim()) {
        return nestedData[key];
      }
    }
  }
  return null;
}

function normalizeStructuredEvent(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  if (typeof record.event === 'string' && record.event.trim()) return record.event;
  if (typeof record.command === 'string' && record.command.trim()) return record.command;
  return null;
}

function parseMirrorLogEntry(line, lineNumber) {
  const text = String(line || '');
  const entry = {
    lineNumber,
    text,
    kind: 'text',
    structured: false,
    event: null,
    timestamp: null,
    data: null,
  };
  const trimmed = text.trim();
  if (!trimmed) {
    return entry;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        ...entry,
        kind: 'structured',
        structured: true,
        event: normalizeStructuredEvent(parsed),
        timestamp: normalizeStructuredTimestamp(parsed),
        data: parsed,
      };
    }
  } catch {
    // Preserve plain-text compatibility for legacy log lines.
  }
  return entry;
}

function summarizeEntries(entries) {
  const structuredEntryCount = entries.filter((entry) => entry.structured).length;
  const textEntryCount = entries.length - structuredEntryCount;
  const format =
    entries.length === 0
      ? 'empty'
      : structuredEntryCount === entries.length
        ? 'jsonl'
        : structuredEntryCount === 0
          ? 'text'
          : 'mixed';
  return {
    format,
    structuredEntryCount,
    textEntryCount,
  };
}

function buildSnapshot(lines, startLineNumber) {
  const entries = lines.map((line, index) => parseMirrorLogEntry(line, startLineNumber + index));
  return {
    entries,
    ...summarizeEntries(entries),
  };
}

function readMirrorLogLines(filePath) {
  return splitLogLines(fs.readFileSync(filePath, 'utf8'));
}

function readMirrorLogTail(filePath, requestedLines) {
  const lines = readMirrorLogLines(filePath);
  const totalLines = lines.length;
  const startIndex = Math.max(0, totalLines - requestedLines);
  const snapshot = buildSnapshot(lines.slice(startIndex), startIndex + 1);
  return {
    totalLines,
    truncated: totalLines > snapshot.entries.length,
    ...snapshot,
  };
}

function readMirrorLogFromLine(filePath, startLineNumber = 1) {
  const lines = readMirrorLogLines(filePath);
  const totalLines = lines.length;
  const safeStartLineNumber = Number.isInteger(startLineNumber) && startLineNumber > 0 ? startLineNumber : 1;
  const startIndex = Math.max(0, safeStartLineNumber - 1);
  const snapshot = buildSnapshot(lines.slice(startIndex), startIndex + 1);
  return {
    totalLines,
    truncated: startIndex > 0,
    ...snapshot,
  };
}

module.exports = {
  parseMirrorLogEntry,
  readMirrorLogFromLine,
  readMirrorLogTail,
  readMirrorLogLines,
  summarizeEntries,
};
