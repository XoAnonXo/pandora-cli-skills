const fs = require('node:fs');
const path = require('node:path');

const { normalizeText } = require('./baton_common.cjs');

function normalizePath(repoRoot, filePath) {
  const trimmed = normalizeText(filePath);
  if (!trimmed) {
    throw new Error('Patch operation is missing path');
  }
  const absolutePath = path.resolve(repoRoot, trimmed);
  const relativePath = path.relative(repoRoot, absolutePath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Patch path escapes the repo: ${filePath}`);
  }
  return {
    absolutePath,
    relativePath: relativePath.split(path.sep).join('/'),
  };
}

function normalizePatchBlock(block, index) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    throw new Error(`Patch block ${index} must be an object`);
  }
  const normalized = {
    path: normalizeText(block.path),
    search: String(block.search ?? ''),
    replace: String(block.replace ?? ''),
    contextBefore: String(block.context_before ?? block.contextBefore ?? ''),
    contextAfter: String(block.context_after ?? block.contextAfter ?? ''),
  };
  if (!normalized.path) {
    throw new Error(`Patch block ${index} is missing path`);
  }
  if (!normalized.search) {
    throw new Error(`Patch block ${index} is missing search`);
  }
  return normalized;
}

function normalizePatchSet(patchSet) {
  if (!Array.isArray(patchSet)) {
    throw new Error('Patch set must be an array');
  }
  return patchSet.map((block, index) => normalizePatchBlock(block, index));
}

function findAllOccurrences(content, needle) {
  const indices = [];
  let index = content.indexOf(needle);
  while (index !== -1) {
    indices.push(index);
    index = content.indexOf(needle, index + needle.length);
  }
  return indices;
}

function matchesContext(content, index, operation) {
  if (operation.contextBefore) {
    const beforeSlice = content.slice(Math.max(0, index - operation.contextBefore.length), index);
    if (beforeSlice !== operation.contextBefore) {
      return false;
    }
  }
  if (operation.contextAfter) {
    const afterStart = index + operation.search.length;
    const afterSlice = content.slice(afterStart, afterStart + operation.contextAfter.length);
    if (afterSlice !== operation.contextAfter) {
      return false;
    }
  }
  return true;
}

function resolveReplacementIndex(content, operation) {
  const matches = findAllOccurrences(content, operation.search);
  if (matches.length === 0) {
    throw new Error(`SEARCH block could not find text in ${operation.path}`);
  }
  if (matches.length === 1) {
    if (!matchesContext(content, matches[0], operation)) {
      throw new Error(`SEARCH block context did not match in ${operation.path}`);
    }
    return matches[0];
  }
  const filtered = matches.filter((index) => matchesContext(content, index, operation));
  if (filtered.length === 1) {
    return filtered[0];
  }
  if (filtered.length === 0) {
    throw new Error(`SEARCH block was ambiguous in ${operation.path}; add context_before or context_after`);
  }
  throw new Error(`SEARCH block matched multiple locations in ${operation.path}`);
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

function applyPatchSet(patchSet, options = {}) {
  const repoRoot = path.resolve(options.cwd || process.cwd());
  const operations = normalizePatchSet(patchSet);
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
    const matchIndex = resolveReplacementIndex(entry.current, operation);
    entry.current = [
      entry.current.slice(0, matchIndex),
      operation.replace,
      entry.current.slice(matchIndex + operation.search.length),
    ].join('');
  }

  const files = [];
  for (const entry of fileState.values()) {
    fs.writeFileSync(entry.absolutePath, entry.current, 'utf8');
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

function rollbackAppliedPatchSet(appliedPatchSet) {
  if (!appliedPatchSet || !(appliedPatchSet._fileState instanceof Map)) {
    throw new Error('rollbackAppliedPatchSet requires an applied patch-set result');
  }
  for (const entry of appliedPatchSet._fileState.values()) {
    fs.writeFileSync(entry.absolutePath, entry.original, 'utf8');
  }
}

function validatePatchSetAgainstContent(patchSet, contentByPath) {
  const operations = normalizePatchSet(patchSet);
  return operations.map((operation) => {
    const content = contentByPath && Object.prototype.hasOwnProperty.call(contentByPath, operation.path)
      ? contentByPath[operation.path]
      : null;
    if (typeof content !== 'string') {
      throw new Error(`Patch validation content is missing for ${operation.path}`);
    }
    const matchIndex = resolveReplacementIndex(content, operation);
    return {
      path: operation.path,
      matchIndex,
    };
  });
}

module.exports = {
  applyPatchSet,
  normalizePatchSet,
  resolveReplacementIndex,
  rollbackAppliedPatchSet,
  validatePatchSetAgainstContent,
};
