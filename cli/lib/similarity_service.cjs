const { round } = require('./shared/utils.cjs');

function normalizeQuestion(question) {
  return String(question || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|a|an|will|be|on|at|in|to|for|by|of|is|are|was|were)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(question) {
  return new Set(normalizeQuestion(question).split(' ').filter(Boolean));
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
  const tokenScore = jaccard(tokenize(normalizedLeft), tokenize(normalizedRight));
  const jw = jaroWinkler(normalizedLeft, normalizedRight);
  return {
    normalizedLeft,
    normalizedRight,
    tokenScore: round(tokenScore, 6),
    jaroWinkler: round(jw, 6),
    score: round(tokenScore * 0.55 + jw * 0.45, 6),
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
