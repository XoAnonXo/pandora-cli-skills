const fs = require('node:fs');
const path = require('node:path');

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizePath(repoRoot, filePath) {
  const trimmed = normalizeText(filePath);
  if (!trimmed) {
    throw new Error('Change-set operation is missing path');
  }
  const absolutePath = path.resolve(repoRoot, trimmed);
  const relativePath = path.relative(repoRoot, absolutePath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Change-set path escapes the repo: ${filePath}`);
  }
  return {
    absolutePath,
    relativePath: relativePath.split(path.sep).join('/'),
  };
}

function applyReplaceOnce(content, operation) {
  const match = String(operation.match ?? '');
  const replace = String(operation.replace ?? '');
  if (!match) {
    throw new Error(`replace_once for ${operation.path} requires match`);
  }
  const firstIndex = content.indexOf(match);
  if (firstIndex === -1) {
    throw new Error(`replace_once could not find match in ${operation.path}`);
  }
  const secondIndex = content.indexOf(match, firstIndex + match.length);
  if (secondIndex !== -1) {
    throw new Error(`replace_once found multiple matches in ${operation.path}`);
  }
  return content.slice(0, firstIndex) + replace + content.slice(firstIndex + match.length);
}

function applyInsertAfterOnce(content, operation) {
  const anchor = String(operation.anchor ?? '');
  const text = String(operation.text ?? '');
  if (!anchor) {
    throw new Error(`insert_after_once for ${operation.path} requires anchor`);
  }
  const firstIndex = content.indexOf(anchor);
  if (firstIndex === -1) {
    throw new Error(`insert_after_once could not find anchor in ${operation.path}`);
  }
  const secondIndex = content.indexOf(anchor, firstIndex + anchor.length);
  if (secondIndex !== -1) {
    throw new Error(`insert_after_once found multiple anchors in ${operation.path}`);
  }
  const insertAt = firstIndex + anchor.length;
  return content.slice(0, insertAt) + text + content.slice(insertAt);
}

function applyInsertBeforeOnce(content, operation) {
  const anchor = String(operation.anchor ?? '');
  const text = String(operation.text ?? '');
  if (!anchor) {
    throw new Error(`insert_before_once for ${operation.path} requires anchor`);
  }
  const firstIndex = content.indexOf(anchor);
  if (firstIndex === -1) {
    throw new Error(`insert_before_once could not find anchor in ${operation.path}`);
  }
  const secondIndex = content.indexOf(anchor, firstIndex + anchor.length);
  if (secondIndex !== -1) {
    throw new Error(`insert_before_once found multiple anchors in ${operation.path}`);
  }
  return content.slice(0, firstIndex) + text + content.slice(firstIndex);
}

function normalizeOperation(operation, index) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    throw new Error(`Change-set operation ${index} must be an object`);
  }
  const kind = normalizeText(operation.kind);
  if (!kind) {
    throw new Error(`Change-set operation ${index} is missing kind`);
  }
  const normalized = {
    kind,
    path: normalizeText(operation.path),
  };
  if (!normalized.path) {
    throw new Error(`Change-set operation ${index} is missing path`);
  }
  if (kind === 'replace_once') {
    normalized.match = String(operation.match ?? '');
    normalized.replace = String(operation.replace ?? '');
    return normalized;
  }
  if (kind === 'insert_after_once' || kind === 'insert_before_once') {
    normalized.anchor = String(operation.anchor ?? '');
    normalized.text = String(operation.text ?? '');
    return normalized;
  }
  throw new Error(`Unsupported change-set operation kind: ${kind}`);
}

function normalizeChangeSet(changeSet) {
  if (!Array.isArray(changeSet)) {
    throw new Error('Change-set must be an array');
  }
  return changeSet.map((operation, index) => normalizeOperation(operation, index));
}

function computeLineMetrics(before, after) {
  const beforeLines = String(before).split('\n').length;
  const afterLines = String(after).split('\n').length;
  const lineDelta = afterLines - beforeLines;
  return {
    beforeLines,
    afterLines,
    lineDelta,
    addedLines: lineDelta > 0 ? lineDelta : 0,
    removedLines: lineDelta < 0 ? Math.abs(lineDelta) : 0,
  };
}

function applyChangeSet(changeSet, options = {}) {
  const repoRoot = path.resolve(options.cwd || process.cwd());
  const operations = normalizeChangeSet(changeSet);
  const fileState = new Map();

  for (const operation of operations) {
    const target = normalizePath(repoRoot, operation.path);
    if (!fileState.has(target.absolutePath)) {
      const original = fs.readFileSync(target.absolutePath, 'utf8');
      fileState.set(target.absolutePath, {
        absolutePath: target.absolutePath,
        relativePath: target.relativePath,
        original,
        current: original,
      });
    }
    const entry = fileState.get(target.absolutePath);
    if (operation.kind === 'replace_once') {
      entry.current = applyReplaceOnce(entry.current, operation);
    } else if (operation.kind === 'insert_after_once') {
      entry.current = applyInsertAfterOnce(entry.current, operation);
    } else if (operation.kind === 'insert_before_once') {
      entry.current = applyInsertBeforeOnce(entry.current, operation);
    }
  }

  const files = [];
  for (const entry of fileState.values()) {
    fs.writeFileSync(entry.absolutePath, entry.current);
    files.push({
      path: entry.relativePath,
      ...computeLineMetrics(entry.original, entry.current),
    });
  }

  const summary = files.reduce((accumulator, file) => {
    accumulator.touchedFiles += 1;
    accumulator.addedLines += file.addedLines;
    accumulator.removedLines += file.removedLines;
    accumulator.netLineDelta += file.lineDelta;
    return accumulator;
  }, {
    touchedFiles: 0,
    addedLines: 0,
    removedLines: 0,
    netLineDelta: 0,
  });

  return {
    repoRoot,
    operations,
    files,
    summary,
    _fileState: fileState,
  };
}

function rollbackAppliedChangeSet(appliedChangeSet) {
  if (!appliedChangeSet || !(appliedChangeSet._fileState instanceof Map)) {
    throw new Error('rollbackAppliedChangeSet requires an applied change-set result');
  }
  for (const entry of appliedChangeSet._fileState.values()) {
    fs.writeFileSync(entry.absolutePath, entry.original);
  }
}

module.exports = {
  applyChangeSet,
  normalizeChangeSet,
  rollbackAppliedChangeSet,
};
