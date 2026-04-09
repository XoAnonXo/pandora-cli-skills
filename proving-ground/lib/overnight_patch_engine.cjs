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
  const matchMode = normalizeText(block.match_mode || block.matchMode).toLowerCase() || 'exact';
  if (!['exact', 'window'].includes(matchMode)) {
    throw new Error(`Patch block ${index} has unsupported match_mode`);
  }
  const normalized = {
    path: normalizeText(block.path),
    search: String(block.search ?? ''),
    replace: String(block.replace ?? ''),
    contextBefore: String(block.context_before ?? block.contextBefore ?? ''),
    contextAfter: String(block.context_after ?? block.contextAfter ?? ''),
    matchMode,
    windowStartLine: block.window_start_line === undefined && block.windowStartLine === undefined
      ? null
      : Number(block.window_start_line ?? block.windowStartLine),
    windowEndLine: block.window_end_line === undefined && block.windowEndLine === undefined
      ? null
      : Number(block.window_end_line ?? block.windowEndLine),
  };
  if (!normalized.path) {
    throw new Error(`Patch block ${index} is missing path`);
  }
  if (!normalized.search) {
    throw new Error(`Patch block ${index} is missing search`);
  }
  if (normalized.matchMode === 'window') {
    if (!Number.isInteger(normalized.windowStartLine) || normalized.windowStartLine < 1) {
      throw new Error(`Patch block ${index} is missing a valid window_start_line`);
    }
    if (!Number.isInteger(normalized.windowEndLine) || normalized.windowEndLine < normalized.windowStartLine) {
      throw new Error(`Patch block ${index} is missing a valid window_end_line`);
    }
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

function splitLines(content) {
  return String(content).split(/\r?\n/);
}

function detectPreferredEol(content) {
  return /\r\n/.test(String(content || '')) ? '\r\n' : '\n';
}

function normalizeLineForWindowMatch(line) {
  return String(line || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+$/g, '');
}

function normalizeContextLines(text, position) {
  const lines = splitLines(text);
  if (position === 'before' && lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  if (position === 'after' && lines.length > 0 && lines[0] === '') {
    lines.shift();
  }
  return lines;
}

function sameNormalizedLineBlock(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (normalizeLineForWindowMatch(left[index]) !== normalizeLineForWindowMatch(right[index])) {
      return false;
    }
  }
  return true;
}

function matchesWindowContext(lines, startIndex, searchLineCount, operation) {
  const beforeLines = normalizeContextLines(operation.contextBefore, 'before');
  if (beforeLines.length > 0) {
    const beforeStart = startIndex - beforeLines.length;
    if (beforeStart < 0) {
      return false;
    }
    if (!sameNormalizedLineBlock(lines.slice(beforeStart, startIndex), beforeLines)) {
      return false;
    }
  }
  const afterLines = normalizeContextLines(operation.contextAfter, 'after');
  if (afterLines.length > 0) {
    const afterStart = startIndex + searchLineCount;
    const afterEnd = afterStart + afterLines.length;
    if (afterEnd > lines.length) {
      return false;
    }
    if (!sameNormalizedLineBlock(lines.slice(afterStart, afterEnd), afterLines)) {
      return false;
    }
  }
  return true;
}

function lineStartToCharIndex(content, lineIndex) {
  if (lineIndex <= 0) {
    return 0;
  }
  let offset = 0;
  let currentLine = 0;
  while (currentLine < lineIndex && offset < content.length) {
    const nextBreak = content.indexOf('\n', offset);
    if (nextBreak === -1) {
      return content.length;
    }
    offset = nextBreak + 1;
    currentLine += 1;
  }
  return offset;
}

function resolveWindowReplacementRange(content, operation) {
  const lines = splitLines(content);
  const searchLines = splitLines(operation.search);
  const searchLineCount = searchLines.length;
  const windowStartIndex = operation.windowStartLine - 1;
  const windowEndIndex = operation.windowEndLine - 1;
  if (windowStartIndex < 0 || windowEndIndex < windowStartIndex || windowEndIndex >= lines.length) {
    throw new Error(`Window range is invalid in ${operation.path}`);
  }
  const lastStartIndex = windowEndIndex - searchLineCount + 1;
  if (lastStartIndex < windowStartIndex) {
    throw new Error(`SEARCH block could not fit inside staged window in ${operation.path}`);
  }
  const matches = [];
  for (let startIndex = windowStartIndex; startIndex <= lastStartIndex; startIndex += 1) {
    const candidateLines = lines.slice(startIndex, startIndex + searchLineCount);
    if (!sameNormalizedLineBlock(candidateLines, searchLines)) {
      continue;
    }
    if (!matchesWindowContext(lines, startIndex, searchLineCount, operation)) {
      continue;
    }
    matches.push({
      startIndex,
      endIndex: startIndex + searchLineCount,
    });
  }
  if (matches.length === 0) {
    throw new Error(`SEARCH block could not find text inside staged window in ${operation.path}`);
  }
  if (matches.length > 1) {
    throw new Error(`SEARCH block matched multiple locations inside staged window in ${operation.path}`);
  }
  return matches[0];
}

function applyLineWindowReplacement(content, operation, range) {
  const eol = detectPreferredEol(content);
  const lines = splitLines(content);
  const replacementLines = splitLines(operation.replace);
  lines.splice(range.startIndex, range.endIndex - range.startIndex, ...replacementLines);
  return lines.join(eol);
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
    if (operation.matchMode === 'window') {
      const range = resolveWindowReplacementRange(entry.current, operation);
      entry.current = applyLineWindowReplacement(entry.current, operation, range);
    } else {
      const matchIndex = resolveReplacementIndex(entry.current, operation);
      entry.current = [
        entry.current.slice(0, matchIndex),
        operation.replace,
        entry.current.slice(matchIndex + operation.search.length),
      ].join('');
    }
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
    const matchIndex = operation.matchMode === 'window'
      ? lineStartToCharIndex(content, resolveWindowReplacementRange(content, operation).startIndex)
      : resolveReplacementIndex(content, operation);
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
