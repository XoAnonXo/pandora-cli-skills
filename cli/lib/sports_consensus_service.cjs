const { clamp, round, toNumber } = require('./shared/utils.cjs');

const SPORTS_CONSENSUS_METHOD = 'trimmed-median';
const DEFAULT_TRIM_PERCENT = 20;
const DEFAULT_MIN_TOTAL_BOOKS = 6;
const DEFAULT_MIN_TIER1_COVERAGE = 0.5;
const DEFAULT_MIN_TIER1_BOOKS = 3;

/**
 * Convert decimal odds into implied probability.
 * Example: 2.00 => 0.5
 *
 * @param {number|string} decimalOdds
 * @returns {number|null} Probability in [0, 1], or null when invalid.
 */
function decimalOddsToImpliedProbability(decimalOdds) {
  const numeric = toNumber(decimalOdds);
  if (numeric === null || numeric <= 1) return null;
  return clamp(1 / numeric, 0, 1);
}

/**
 * Convert American odds into implied probability.
 * Example: +150 => 0.4, -150 => 0.6
 *
 * @param {number|string} americanOdds
 * @returns {number|null} Probability in [0, 1], or null when invalid.
 */
function americanOddsToImpliedProbability(americanOdds) {
  const numeric = toNumber(americanOdds);
  if (numeric === null || numeric === 0) return null;
  if (numeric > 0) return clamp(100 / (numeric + 100), 0, 1);
  const abs = Math.abs(numeric);
  return clamp(abs / (abs + 100), 0, 1);
}

function parseFractionalParts(fractionalOdds) {
  if (typeof fractionalOdds === 'string') {
    const raw = fractionalOdds.trim();
    if (!raw) return null;
    const delimiter = raw.includes('/') ? '/' : raw.includes(':') ? ':' : null;
    if (!delimiter) {
      const numeric = toNumber(raw);
      if (numeric === null) return null;
      return { numerator: numeric, denominator: 1 };
    }
    const parts = raw.split(delimiter);
    if (parts.length !== 2) return null;
    const numerator = toNumber(parts[0]);
    const denominator = toNumber(parts[1]);
    if (numerator === null || denominator === null) return null;
    return { numerator, denominator };
  }

  if (Array.isArray(fractionalOdds) && fractionalOdds.length === 2) {
    const numerator = toNumber(fractionalOdds[0]);
    const denominator = toNumber(fractionalOdds[1]);
    if (numerator === null || denominator === null) return null;
    return { numerator, denominator };
  }

  if (fractionalOdds && typeof fractionalOdds === 'object') {
    const numerator = toNumber(fractionalOdds.numerator);
    const denominator = toNumber(fractionalOdds.denominator);
    if (numerator === null || denominator === null) return null;
    return { numerator, denominator };
  }

  const numeric = toNumber(fractionalOdds);
  if (numeric === null) return null;
  return { numerator: numeric, denominator: 1 };
}

/**
 * Convert fractional odds into implied probability.
 * Accepts "n/d", "n:d", [n, d], { numerator, denominator }, or numeric n (as n/1).
 *
 * @param {string|number|Array<number>|{numerator:number,denominator:number}} fractionalOdds
 * @returns {number|null} Probability in [0, 1], or null when invalid.
 */
function fractionalOddsToImpliedProbability(fractionalOdds) {
  const parsed = parseFractionalParts(fractionalOdds);
  if (!parsed) return null;
  const numerator = parsed.numerator;
  const denominator = parsed.denominator;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (numerator < 0 || denominator <= 0) return null;
  return clamp(denominator / (numerator + denominator), 0, 1);
}

function normalizeOddsFormat(format, oddsValue) {
  const normalized = String(format || '').trim().toLowerCase();
  if (normalized) return normalized;

  if (typeof oddsValue === 'string') {
    const raw = oddsValue.trim();
    if (raw.startsWith('+') || raw.startsWith('-')) return 'american';
    if (raw.includes('/') || raw.includes(':')) return 'fractional';
  }
  return 'decimal';
}

/**
 * Convert odds with declared (or inferred) format into implied probability.
 *
 * @param {number|string|Array<number>|{numerator:number,denominator:number}} oddsValue
 * @param {string} [format='decimal'] One of decimal|american|fractional.
 * @returns {number|null} Probability in [0, 1], or null when invalid.
 */
function oddsToImpliedProbability(oddsValue, format = 'decimal') {
  const normalized = normalizeOddsFormat(format, oddsValue);
  if (normalized === 'american') return americanOddsToImpliedProbability(oddsValue);
  if (normalized === 'fractional') return fractionalOddsToImpliedProbability(oddsValue);
  if (normalized === 'decimal') return decimalOddsToImpliedProbability(oddsValue);
  return null;
}

function toProbability(value) {
  const numeric = toNumber(value);
  if (numeric === null) return null;
  if (numeric >= 0 && numeric <= 1) return numeric;
  if (numeric >= 0 && numeric <= 100) return numeric / 100;
  return null;
}

function normalizeBookName(value, index) {
  const raw = String(value || '').trim();
  if (raw) return raw;
  return `book-${index + 1}`;
}

function inferQuoteProbability(quote) {
  if (!quote || typeof quote !== 'object') return null;

  const directCandidates = [
    quote.yesProbability,
    quote.yesProb,
    quote.probabilityYes,
    quote.impliedProbability,
    quote.yesPct,
  ];

  for (const candidate of directCandidates) {
    const probability = toProbability(candidate);
    if (probability !== null) return probability;
  }

  const oddsFormat = quote.oddsFormat || quote.format || quote.priceFormat || quote.yesOddsFormat;
  if (quote.yesOdds !== undefined) {
    return oddsToImpliedProbability(quote.yesOdds, oddsFormat);
  }

  if (quote.odds !== undefined) {
    if (quote.odds && typeof quote.odds === 'object') {
      if (quote.odds.yes !== undefined) {
        return oddsToImpliedProbability(quote.odds.yes, quote.odds.format || oddsFormat);
      }
      if (quote.odds.value !== undefined) {
        return oddsToImpliedProbability(quote.odds.value, quote.odds.format || oddsFormat);
      }
    }
    return oddsToImpliedProbability(quote.odds, oddsFormat);
  }

  return null;
}

function isTier1Quote(quote, bookName, tier1BookSet) {
  if (!quote || typeof quote !== 'object') return tier1BookSet.has(String(bookName).toLowerCase());
  if (quote.tier1 === true) return true;
  const tier = String(quote.tier || '').trim().toLowerCase();
  if (tier === 'tier1' || tier === 'tier-1' || tier === '1') return true;
  return tier1BookSet.has(String(bookName).toLowerCase());
}

/**
 * Normalize raw sportsbook quotes into deduped, test-friendly quote rows.
 * Dedupe key is normalized book name; latest quote wins.
 *
 * @param {Array<object>} quotes
 * @param {{tier1Books?: string[]}} [options]
 * @returns {{books: object[], valid: object[], invalid: object[]}}
 */
function normalizeConsensusQuotes(quotes, options = {}) {
  const tier1BookSet = new Set(
    (Array.isArray(options.tier1Books) ? options.tier1Books : [])
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean),
  );

  const byBook = new Map();
  const rows = Array.isArray(quotes) ? quotes : [];
  for (let index = 0; index < rows.length; index += 1) {
    const quote = rows[index];
    const book = normalizeBookName(quote && (quote.book || quote.bookName || quote.source), index);
    const yesProbability = inferQuoteProbability(quote);
    byBook.set(String(book).toLowerCase(), {
      book,
      yesProbability,
      tier1: isTier1Quote(quote, book, tier1BookSet),
      raw: quote,
    });
  }

  const books = Array.from(byBook.values());
  const valid = [];
  const invalid = [];
  for (const row of books) {
    if (row.yesProbability === null || !Number.isFinite(row.yesProbability)) {
      invalid.push({
        book: row.book,
        reason: 'invalid-odds',
        tier1: row.tier1,
      });
      continue;
    }
    valid.push(row);
  }

  return { books, valid, invalid };
}

/**
 * Compute a symmetric trimmed median for an array of numeric values.
 *
 * @param {number[]} values
 * @param {number} [trimPercent=20]
 * @returns {{
 *   median: number|null,
 *   trimCount: number,
 *   includedIndexes: number[],
 *   lowOutlierIndexes: number[],
 *   highOutlierIndexes: number[]
 * }}
 */
function trimmedMedian(values, trimPercent = DEFAULT_TRIM_PERCENT) {
  const numericRows = (Array.isArray(values) ? values : [])
    .map((value, index) => ({ value: toNumber(value), index }))
    .filter((entry) => entry.value !== null);

  if (!numericRows.length) {
    return {
      median: null,
      trimCount: 0,
      includedIndexes: [],
      lowOutlierIndexes: [],
      highOutlierIndexes: [],
    };
  }

  const sorted = [...numericRows].sort((a, b) => a.value - b.value);
  const boundedTrimPercent = clamp(toNumber(trimPercent) || DEFAULT_TRIM_PERCENT, 0, 49);
  let trimCount = Math.floor((sorted.length * boundedTrimPercent) / 100);
  while (trimCount > 0 && sorted.length - trimCount * 2 < 1) {
    trimCount -= 1;
  }

  const lowOutlierIndexes = sorted.slice(0, trimCount).map((entry) => entry.index);
  const highOutlierIndexes = sorted.slice(sorted.length - trimCount).map((entry) => entry.index);
  const included = sorted.slice(trimCount, sorted.length - trimCount);
  const includedIndexes = included.map((entry) => entry.index);

  if (!included.length) {
    return {
      median: null,
      trimCount,
      includedIndexes: [],
      lowOutlierIndexes,
      highOutlierIndexes,
    };
  }

  const midpoint = Math.floor(included.length / 2);
  const median =
    included.length % 2 === 1
      ? included[midpoint].value
      : (included[midpoint - 1].value + included[midpoint].value) / 2;

  return {
    median,
    trimCount,
    includedIndexes,
    lowOutlierIndexes,
    highOutlierIndexes,
  };
}

/**
 * Evaluate tier1 and total coverage policy and return confidence classification.
 *
 * @param {{
 *   books: object[],
 *   includedRows: object[],
 *   minTotalBooks?: number,
 *   minTier1Coverage?: number
 * }} input
 * @returns {{
 *   totalCoverage: number,
 *   tier1Coverage: number,
 *   degradedConfidence: boolean,
 *   confidence: 'high'|'normal'|'degraded'
 * }}
 */
function evaluateCoveragePolicy(input) {
  const books = Array.isArray(input && input.books) ? input.books : [];
  const includedRows = Array.isArray(input && input.includedRows) ? input.includedRows : [];
  const minTotalBooks = Math.max(1, Math.floor(toNumber(input && input.minTotalBooks) || DEFAULT_MIN_TOTAL_BOOKS));
  const minTier1Books = Math.max(0, Math.floor(toNumber(input && input.minTier1Books) || DEFAULT_MIN_TIER1_BOOKS));
  const minTier1Coverage = clamp(
    toNumber(input && input.minTier1Coverage) || DEFAULT_MIN_TIER1_COVERAGE,
    0,
    1,
  );

  const totalBooks = books.length;
  const includedBooks = includedRows.length;
  const tier1Total = books.filter((row) => row.tier1 === true).length;
  const tier1Included = includedRows.filter((row) => row.tier1 === true).length;

  const totalCoverage = totalBooks > 0 ? includedBooks / totalBooks : 0;
  const tier1Coverage = tier1Total > 0 ? tier1Included / tier1Total : 1;
  const meetsTotalBooks = totalBooks >= minTotalBooks;
  const meetsTier1Books = tier1Included >= minTier1Books;
  const meetsTier1Coverage = tier1Coverage >= minTier1Coverage;
  const insufficientCoverage = !meetsTotalBooks;
  const degradedConfidence = meetsTotalBooks && (!meetsTier1Books || !meetsTier1Coverage);
  let confidence = 'normal';
  if (insufficientCoverage) confidence = 'insufficient';
  else if (degradedConfidence) confidence = 'degraded';
  else if (tier1Coverage >= 0.75 && totalCoverage >= 0.75) confidence = 'high';

  return {
    totalCoverage,
    tier1Coverage,
    tier1BooksPresent: tier1Included,
    minTier1Books,
    minTotalBooks,
    insufficientCoverage,
    degradedConfidence,
    confidence,
  };
}

/**
 * Compute sportsbook consensus using trimmed median + coverage policy.
 *
 * Required output fields:
 * - method
 * - tier1Coverage
 * - totalBooks
 * - includedBooks
 * - excludedBooks
 * - outliers
 * - consensusYesPct
 * - consensusNoPct
 *
 * @param {Array<object>} quotes
 * @param {{
 *   trimPercent?: number,
 *   tier1Books?: string[],
 *   minTotalBooks?: number,
 *   minTier1Books?: number,
 *   minTier1Coverage?: number
 * }} [options]
 * @returns {{
 *   method: string,
  *   tier1Coverage: number,
 *   tier1BooksPresent: number,
 *   totalBooks: number,
 *   includedBooks: number,
 *   excludedBooks: number,
 *   outliers: object[],
 *   consensusYesPct: number|null,
 *   consensusNoPct: number|null,
 *   confidence: 'high'|'normal'|'degraded'|'insufficient',
 *   degradedConfidence: boolean,
 *   insufficientCoverage: boolean
 * }}
 */
function computeSportsConsensus(quotes, options = {}) {
  const normalized = normalizeConsensusQuotes(quotes, options);
  const validRows = normalized.valid;
  const trimPercent = clamp(toNumber(options.trimPercent) || DEFAULT_TRIM_PERCENT, 0, 49);

  const trimResult = trimmedMedian(
    validRows.map((row) => row.yesProbability),
    trimPercent,
  );

  const includeIndexSet = new Set(trimResult.includedIndexes);
  const lowOutlierSet = new Set(trimResult.lowOutlierIndexes);
  const highOutlierSet = new Set(trimResult.highOutlierIndexes);
  const includedRows = validRows.filter((_, index) => includeIndexSet.has(index));

  const outliers = [];
  for (const invalid of normalized.invalid) {
    outliers.push({
      book: invalid.book,
      reason: invalid.reason,
      tier1: invalid.tier1,
    });
  }
  for (let index = 0; index < validRows.length; index += 1) {
    if (includeIndexSet.has(index)) continue;
    const row = validRows[index];
    outliers.push({
      book: row.book,
      tier1: row.tier1,
      yesPct: round(row.yesProbability * 100, 4),
      reason: lowOutlierSet.has(index) ? 'trimmed-low' : highOutlierSet.has(index) ? 'trimmed-high' : 'excluded',
    });
  }

  const policy = evaluateCoveragePolicy({
    books: normalized.books,
    includedRows,
    minTotalBooks: options.minTotalBooks,
    minTier1Books: options.minTier1Books,
    minTier1Coverage: options.minTier1Coverage,
  });

  const consensusYesPct =
    trimResult.median === null || !Number.isFinite(trimResult.median) ? null : round(trimResult.median * 100, 4);
  const consensusNoPct =
    consensusYesPct === null || !Number.isFinite(consensusYesPct) ? null : round(100 - consensusYesPct, 4);

  return {
    method: SPORTS_CONSENSUS_METHOD,
    tier1Coverage: round(policy.tier1Coverage, 6),
    tier1BooksPresent: policy.tier1BooksPresent,
    totalBooks: normalized.books.length,
    includedBooks: includedRows.length,
    excludedBooks: Math.max(0, normalized.books.length - includedRows.length),
    outliers,
    consensusYesPct,
    consensusNoPct,
    confidence: policy.confidence,
    degradedConfidence: policy.degradedConfidence,
    insufficientCoverage: policy.insufficientCoverage,
  };
}

module.exports = {
  SPORTS_CONSENSUS_METHOD,
  DEFAULT_TRIM_PERCENT,
  DEFAULT_MIN_TOTAL_BOOKS,
  DEFAULT_MIN_TIER1_BOOKS,
  DEFAULT_MIN_TIER1_COVERAGE,
  decimalOddsToImpliedProbability,
  americanOddsToImpliedProbability,
  fractionalOddsToImpliedProbability,
  oddsToImpliedProbability,
  normalizeConsensusQuotes,
  trimmedMedian,
  evaluateCoveragePolicy,
  computeSportsConsensus,
};
