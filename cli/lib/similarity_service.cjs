const { round } = require('./shared/utils.cjs');
const YEAR_TOKEN_PATTERN = /^\d{4}$/;
const WEAK_CONTENT_TOKENS = new Set([
  'beat',
  'beats',
  'game',
  'games',
  'market',
  'markets',
  'match',
  'team',
  'vs',
  'win',
  'winner',
  'winners',
  'yes',
  'no',
]);

function normalizeQuestion(question) {
  return String(question || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|will|be|on|at|in|to|for|by|of|is|are|was|were)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeNormalized(normalizedQuestion) {
  return String(normalizedQuestion || '').split(' ').filter(Boolean);
}

function tokenize(question) {
  return new Set(tokenizeNormalized(normalizeQuestion(question)));
}

function buildContentTokenSet(tokensInput) {
  const tokens = Array.isArray(tokensInput)
    ? tokensInput
    : tokenizeNormalized(normalizeQuestion(tokensInput));
  return new Set(
    tokens.filter((token) =>
      typeof token === 'string'
      && (token.length > 1 || /^[a-z]$/.test(token))
      && !YEAR_TOKEN_PATTERN.test(token)),
  );
}

function setIntersection(left, right) {
  const shared = [];
  for (const token of left) {
    if (right.has(token)) {
      shared.push(token);
    }
  }
  return shared.sort();
}

function jaccard(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union ? intersection / union : 0;
}

function overlapCoverage(sharedCount, leftSize, rightSize) {
  const denominator = Math.min(leftSize, rightSize);
  if (!denominator) return 0;
  return sharedCount / denominator;
}

function jaroDistance(leftInput, rightInput) {
  const left = String(leftInput || '');
  const right = String(rightInput || '');
  if (left === right) return 1;

  const maxDistance = Math.floor(Math.max(left.length, right.length) / 2) - 1;
  const leftMatches = new Array(left.length).fill(false);
  const rightMatches = new Array(right.length).fill(false);

  let matches = 0;
  for (let i = 0; i < left.length; i += 1) {
    const start = Math.max(0, i - maxDistance);
    const end = Math.min(i + maxDistance + 1, right.length);
    for (let j = start; j < end; j += 1) {
      if (rightMatches[j]) continue;
      if (left[i] !== right[j]) continue;
      leftMatches[i] = true;
      rightMatches[j] = true;
      matches += 1;
      break;
    }
  }

  if (!matches) return 0;

  let transpositions = 0;
  let rightIndex = 0;
  for (let i = 0; i < left.length; i += 1) {
    if (!leftMatches[i]) continue;
    while (!rightMatches[rightIndex]) rightIndex += 1;
    if (left[i] !== right[rightIndex]) transpositions += 1;
    rightIndex += 1;
  }

  const t = transpositions / 2;
  return (matches / left.length + matches / right.length + (matches - t) / matches) / 3;
}

function jaroWinkler(left, right) {
  const jaro = jaroDistance(left, right);
  const a = String(left || '');
  const b = String(right || '');
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i += 1) {
    if (a[i] === b[i]) prefix += 1;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

function questionSimilarityBreakdown(leftQuestion, rightQuestion) {
  const normalizedLeft = normalizeQuestion(leftQuestion);
  const normalizedRight = normalizeQuestion(rightQuestion);
  const leftTokens = tokenizeNormalized(normalizedLeft);
  const rightTokens = tokenizeNormalized(normalizedRight);
  const leftTokenSet = new Set(leftTokens);
  const rightTokenSet = new Set(rightTokens);
  const contentLeft = buildContentTokenSet(leftTokens);
  const contentRight = buildContentTokenSet(rightTokens);
  const sharedTokens = setIntersection(leftTokenSet, rightTokenSet);
  const contentSharedTokens = setIntersection(contentLeft, contentRight);
  const distinctiveSharedTokens = contentSharedTokens.filter((token) => !WEAK_CONTENT_TOKENS.has(token));
  const tokenScore = jaccard(leftTokenSet, rightTokenSet);
  const contentTokenScore = jaccard(contentLeft, contentRight);
  const contentCoverage = overlapCoverage(contentSharedTokens.length, contentLeft.size, contentRight.size);
  const jw = jaroWinkler(normalizedLeft, normalizedRight);
  let score =
    tokenScore * 0.15
    + contentTokenScore * 0.25
    + contentCoverage * 0.4
    + jw * 0.2;

  if (
    contentSharedTokens.length >= 2
    && (contentCoverage >= 0.85 || distinctiveSharedTokens.length >= 2)
  ) {
    score = Math.max(
      score,
      0.55
        + Math.min(0.25, contentCoverage * 0.25)
        + Math.min(0.15, contentTokenScore * 0.25)
        + Math.min(0.1, jw * 0.1),
    );
  }

  score = Math.max(0, Math.min(1, score));

  return {
    normalizedLeft,
    normalizedRight,
    sharedTokens,
    sharedTokenCount: sharedTokens.length,
    contentSharedTokens,
    contentSharedTokenCount: contentSharedTokens.length,
    distinctiveSharedTokens,
    distinctiveSharedTokenCount: distinctiveSharedTokens.length,
    tokenScore: round(tokenScore, 6),
    contentTokenScore: round(contentTokenScore, 6),
    contentCoverage: round(contentCoverage, 6),
    jaroWinkler: round(jw, 6),
    score: round(score, 6),
  };
}

function questionSimilarity(leftQuestion, rightQuestion) {
  return questionSimilarityBreakdown(leftQuestion, rightQuestion).score;
}

module.exports = {
  normalizeQuestion,
  questionSimilarityBreakdown,
  questionSimilarity,
};
