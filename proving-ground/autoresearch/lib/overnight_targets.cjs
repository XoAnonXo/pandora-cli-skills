const fs = require('node:fs');
const path = require('node:path');

const { normalizeText, resolveRepoPath } = require('./baton_common.cjs');

const DEFAULT_LINE_CAP = 120;

function slugifyIdSegment(value) {
  return normalizeText(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globToRegExp(pattern) {
  const normalized = normalizeText(pattern).split(path.sep).join('/');
  let expression = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '*') {
      if (normalized[index + 1] === '*') {
        const nextCharacter = normalized[index + 2];
        if (nextCharacter === '/') {
          expression += '(?:.*/)?';
          index += 2;
          continue;
        }
        expression += '.*';
        index += 1;
        continue;
      }
      expression += '[^/]*';
      continue;
    }
    if (character === '?') {
      expression += '[^/]';
      continue;
    }
    expression += escapeRegExp(character);
  }
  expression += '$';
  return new RegExp(expression);
}

function matchesPathPattern(relativePath, pattern) {
  if (!normalizeText(pattern)) {
    return false;
  }
  return globToRegExp(pattern).test(normalizeText(relativePath).split(path.sep).join('/'));
}

function fileStem(relativePath) {
  const baseName = path.basename(normalizeText(relativePath));
  return slugifyIdSegment(baseName.replace(path.extname(baseName), ''));
}

function walkRepoFiles(rootDir) {
  const results = [];
  function visit(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') {
        continue;
      }
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (entry.isFile()) {
        results.push(path.relative(rootDir, absolutePath).split(path.sep).join('/'));
      }
    }
  }
  visit(rootDir);
  return results.sort((left, right) => left.localeCompare(right));
}

function matchesAnyPattern(relativePath, patterns) {
  const list = Array.isArray(patterns) ? patterns : [];
  if (list.length === 0) {
    return false;
  }
  return list.some((pattern) => matchesPathPattern(relativePath, pattern));
}

function isCommentLike(line) {
  const trimmed = String(line || '').trim();
  return trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function stripLineForBlockScan(line) {
  return String(line || '')
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '')
    .replace(/\/\/.*$/g, '');
}

function countCharacters(line, character) {
  return (String(line || '').match(new RegExp(`\\${character}`, 'g')) || []).length;
}

function findStatementEnd(lines, startIndex, lineCap) {
  const limit = Math.min(lines.length, startIndex + lineCap);
  for (let index = startIndex; index < limit; index += 1) {
    const sanitized = stripLineForBlockScan(lines[index]).trim();
    if (sanitized.endsWith(';') || sanitized.endsWith(');') || sanitized.endsWith('})')) {
      return index + 1;
    }
  }
  return Math.min(lines.length, startIndex + 1);
}

function findAnchorLineIndex(lines, target, kind) {
  const anchorText = normalizeText(target.anchorText);
  const symbol = normalizeText(target.symbol);
  if (kind === 'test') {
    const quotedAnchor = anchorText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const testPattern = new RegExp(`^\\s*(?:test|it|describe)(?:\\.[A-Za-z_$][\\w$]*)?\\s*\\(\\s*(['"\`])${quotedAnchor}\\1`);
    const quotedSymbol = symbol ? new RegExp(`^\\s*(?:test|it|describe)(?:\\.[A-Za-z_$][\\w$]*)?\\s*\\(\\s*(['"\`]).*${symbol}.*\\1`) : null;
    const byTestName = lines.findIndex((line) => testPattern.test(line));
    if (byTestName !== -1) {
      return byTestName;
    }
    if (quotedSymbol) {
      const bySymbol = lines.findIndex((line) => quotedSymbol.test(line));
      if (bySymbol !== -1) {
        return bySymbol;
      }
    }
    if (anchorText) {
      return lines.findIndex((line) => line.includes(anchorText));
    }
    return -1;
  }

  if (target.anchorType === 'line_contains' && anchorText) {
    return lines.findIndex((line) => line.includes(anchorText));
  }

  const symbolPatterns = [];
  if (symbol) {
    const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    symbolPatterns.push(
      new RegExp(`^\\s*(?:async\\s+)?function\\s+${escapedSymbol}\\s*\\(`),
      new RegExp(`^\\s*(?:const|let|var)\\s+${escapedSymbol}\\s*=`),
      new RegExp(`^\\s*class\\s+${escapedSymbol}\\b`),
      new RegExp(`^\\s*(?:module\\.exports\\.|exports\\.)${escapedSymbol}\\s*=`),
    );
  }
  const bySymbol = lines.findIndex((line) => symbolPatterns.some((pattern) => pattern.test(line)));
  if (bySymbol !== -1) {
    return bySymbol;
  }
  if (anchorText) {
    return lines.findIndex((line) => line.includes(anchorText));
  }
  return -1;
}

function buildWindowBounds(lines, anchorIndex, kind, lineCap) {
  let start = anchorIndex;
  while (start > 0 && isCommentLike(lines[start - 1])) {
    start -= 1;
  }
  let end = null;
  let braceDepth = 0;
  let sawBlockStart = false;
  const limit = Math.min(lines.length, start + lineCap);
  for (let index = anchorIndex; index < limit; index += 1) {
    const sanitized = stripLineForBlockScan(lines[index]);
    const openCount = countCharacters(sanitized, '{');
    const closeCount = countCharacters(sanitized, '}');
    if (openCount > 0) {
      sawBlockStart = true;
    }
    braceDepth += openCount;
    braceDepth -= closeCount;
    if (sawBlockStart && braceDepth <= 0) {
      end = index + 1;
      break;
    }
  }
  if (end === null) {
    end = sawBlockStart ? Math.min(lines.length, start + lineCap) : findStatementEnd(lines, anchorIndex, lineCap);
  }
  return { start, end };
}

function buildTargetId(kind, filePath, label, occurrence = 1) {
  const prefix = kind === 'test' ? 'test' : 'source';
  const parts = [
    prefix,
    fileStem(filePath),
    slugifyIdSegment(label || ''),
  ].filter(Boolean);
  if (occurrence > 1) {
    parts.push(String(occurrence));
  }
  return parts.join(':');
}

function buildTargetFromLines(options) {
  const { repoRoot, relativePath, lines, anchorIndex, kind, symbol, anchorText, occurrence } = options;
  const lineCap = Math.max(20, Number(options.lineCap) || DEFAULT_LINE_CAP);
  const bounds = buildWindowBounds(lines, anchorIndex, kind, lineCap);
  const label = kind === 'test' ? anchorText : (symbol || anchorText);
  const displayName = normalizeText(label) || normalizeText(anchorText) || normalizeText(symbol) || fileStem(relativePath);
  return {
    id: buildTargetId(kind, relativePath, label, occurrence),
    kind,
    path: relativePath,
    fileStem: fileStem(relativePath),
    symbol: kind === 'source' ? normalizeText(symbol) || null : null,
    testName: kind === 'test' ? normalizeText(anchorText) || null : null,
    anchorType: kind === 'test' ? 'test_name' : 'symbol',
    anchorText: normalizeText(anchorText) || '',
    displayName,
    label: displayName,
    startLine: bounds.start + 1,
    endLine: bounds.end,
    lineCount: bounds.end - bounds.start,
    excerpt: lines.slice(bounds.start, bounds.end).join('\n'),
    repoRoot,
  };
}

function extractSourceTargetCandidates(relativePath, content) {
  const lines = String(content || '').split('\n');
  const candidates = [];
  const patterns = [
    { kind: 'function', regex: /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/ },
    { kind: 'constant', regex: /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/ },
    { kind: 'class', regex: /^\s*class\s+([A-Za-z_$][\w$]*)\b/ },
    { kind: 'export', regex: /^\s*(?:module\.exports\.|exports\.)?([A-Za-z_$][\w$]*)\s*=/ },
  ];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const pattern of patterns) {
      const match = line.match(pattern.regex);
      if (!match) {
        continue;
      }
      const symbol = match[1];
      candidates.push({
        kind: 'source',
        path: relativePath,
        symbol,
        anchorType: 'symbol',
        anchorText: line.trim(),
        anchorIndex: index,
      });
      break;
    }
  }
  return candidates;
}

function extractTestTargetCandidates(relativePath, content) {
  const lines = String(content || '').split('\n');
  const candidates = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^\s*(?:test|it|describe)(?:\.[A-Za-z_$][\w$]*)?\s*\(\s*(['"`])(.+?)\1/);
    if (!match) {
      continue;
    }
    candidates.push({
      kind: 'test',
      path: relativePath,
      symbol: null,
      anchorType: 'test_name',
      anchorText: match[2],
      anchorIndex: index,
    });
  }
  return candidates;
}

function buildTargetRegistry(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const surface = options.surface || {};
  const lineCap = Math.max(20, Number(options.lineCap) || DEFAULT_LINE_CAP);
  const files = walkRepoFiles(repoRoot);
  const sourcePatterns = Array.isArray(surface.paths) ? surface.paths : [];
  const testPatterns = Array.isArray(surface.testPaths) ? surface.testPaths : [];
  const sourceTargets = [];
  const testTargets = [];

  function registerTarget(target) {
    let finalTarget = target;
    let attempt = 1;
    while (sourceTargets.concat(testTargets).some((entry) => entry.id === finalTarget.id)) {
      attempt += 1;
      finalTarget = {
        ...target,
        id: buildTargetId(target.kind, target.path, target.kind === 'test' ? target.anchorText : (target.symbol || target.anchorText), attempt),
      };
    }
    return finalTarget;
  }

  for (const relativePath of files) {
    const sourceMatch = matchesAnyPattern(relativePath, sourcePatterns);
    const testMatch = matchesAnyPattern(relativePath, testPatterns);
    if (!sourceMatch && !testMatch) {
      continue;
    }
    const absolutePath = resolveRepoPath(repoRoot, relativePath).absolutePath;
    const content = fs.readFileSync(absolutePath, 'utf8');

    if (sourceMatch) {
      const candidates = extractSourceTargetCandidates(relativePath, content);
      for (const candidate of candidates) {
        const target = registerTarget(buildTargetFromLines({
          repoRoot,
          relativePath,
          lines: content.split('\n'),
          anchorIndex: candidate.anchorIndex,
          kind: 'source',
          symbol: candidate.symbol,
          anchorText: candidate.anchorText,
          occurrence: 1,
          lineCap,
        }));
        sourceTargets.push(target);
      }
    }

    if (testMatch) {
      const candidates = extractTestTargetCandidates(relativePath, content);
      for (const candidate of candidates) {
        const target = registerTarget(buildTargetFromLines({
          repoRoot,
          relativePath,
          lines: content.split('\n'),
          anchorIndex: candidate.anchorIndex,
          kind: 'test',
          symbol: candidate.symbol,
          anchorText: candidate.anchorText,
          occurrence: 1,
          lineCap,
        }));
        testTargets.push(target);
      }
    }
  }

  const entries = sourceTargets.concat(testTargets).sort((left, right) => left.id.localeCompare(right.id));
  const byId = Object.fromEntries(entries.map((entry) => [entry.id, entry]));
  const opportunities = entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    path: entry.path,
    displayName: entry.displayName,
    summary: entry.kind === 'source'
      ? `Source target ${entry.displayName} in ${entry.path}`
      : `Test target ${entry.displayName} in ${entry.path}`,
  }));
  return {
    repoRoot,
    surfaceId: normalizeText(surface.id) || null,
    surfaceTitle: normalizeText(surface.title) || null,
    lineCap,
    entries,
    sourceTargets,
    testTargets,
    opportunities,
    byId,
    targets: entries,
    targetsById: byId,
  };
}

function buildSurfaceTargetRegistry(options = {}) {
  return buildTargetRegistry(options);
}

function buildTargetRegistryForSurface(options = {}) {
  return buildSurfaceTargetRegistry(options);
}

function resolveSurfaceTarget(registry, targetId) {
  const id = normalizeText(targetId);
  if (!registry || !id) {
    return null;
  }
  if (registry.byId && typeof registry.byId === 'object') {
    return registry.byId[id] || null;
  }
  if (registry.targetsById && typeof registry.targetsById === 'object') {
    if (registry.targetsById instanceof Map) {
      return registry.targetsById.get(id) || null;
    }
    return registry.targetsById[id] || null;
  }
  const entries = Array.isArray(registry.entries) ? registry.entries : (Array.isArray(registry.targets) ? registry.targets : []);
  return entries.find((target) => target.id === id) || null;
}

function findTargetById(registry, targetId) {
  return resolveSurfaceTarget(registry, targetId);
}

function resolveTargetById(registry, targetId) {
  const target = resolveSurfaceTarget(registry, targetId);
  if (!target) {
    throw new Error(`Target not found: ${normalizeText(targetId)}`);
  }
  return target;
}

function listTargetIds(registry, kind = null) {
  const entries = Array.isArray(registry && registry.entries) ? registry.entries : (Array.isArray(registry && registry.targets) ? registry.targets : []);
  return entries
    .filter((target) => !kind || target.kind === kind)
    .map((target) => target.id);
}

module.exports = {
  DEFAULT_LINE_CAP,
  buildSurfaceTargetRegistry,
  buildTargetRegistry,
  buildTargetRegistryForSurface,
  resolveSurfaceTarget,
  findTargetById,
  listTargetIds,
  resolveTargetById,
};
