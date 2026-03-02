const { normalizeProbability, normalizeOutcome } = require('./forecast_store.cjs');

const BRIER_SCHEMA_VERSION = '1.0.0';

function createBrierError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

function parseProbabilityFromRecord(record) {
  const raw = pickFirstDefined(
    record && record.probabilityYes,
    record && record.yesProbability,
    record && record.probability,
    record && record.yesPct,
    record && record.impliedProbability,
  );
  if (raw === undefined || raw === null || raw === '') {
    throw createBrierError('BRIER_INVALID_RECORD', 'Record is missing forecast probability.', {
      record,
    });
  }

  const side = record && record.side ? String(record.side).trim().toLowerCase() : null;
  if (side === 'no' && record && record.impliedProbability !== undefined && record.probabilityYes === undefined) {
    return 1 - normalizeProbability(record.impliedProbability, 'impliedProbability');
  }
  return normalizeProbability(raw, 'probabilityYes');
}

function parseOutcomeFromRecord(record, outcomeResolver) {
  const direct = pickFirstDefined(
    record && record.outcome,
    record && record.resolvedOutcome,
    record && record.result,
    record && record.resolution,
  );
  if (direct !== undefined) {
    return normalizeOutcome(direct, 'outcome');
  }

  if (typeof outcomeResolver === 'function') {
    const resolved = outcomeResolver(record);
    if (resolved !== undefined) {
      return normalizeOutcome(resolved, 'resolvedOutcome');
    }
  }

  return null;
}

function brierScore(probabilityYes, outcome) {
  const p = normalizeProbability(probabilityYes, 'probabilityYes');
  const y = normalizeOutcome(outcome, 'outcome');
  if (y === null) {
    throw createBrierError('BRIER_INVALID_OUTCOME', 'Outcome is required to compute Brier score.', {
      outcome,
    });
  }
  const delta = p - y;
  return delta * delta;
}

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((total, value) => total + Number(value), 0) / values.length;
}

function toGroupKey(record, groupBy) {
  const normalized = String(groupBy || 'source').toLowerCase();

  if (normalized === 'none' || normalized === 'all') return 'all';
  if (normalized === 'source') return record.source ? String(record.source) : 'unknown';
  if (normalized === 'market') return record.marketAddress || record.marketId || 'unknown';
  if (normalized === 'competition') return record.competition || 'unknown';
  if (normalized === 'model') return record.modelId || record.source || 'unknown';

  throw createBrierError('BRIER_INVALID_GROUP_BY', 'groupBy must be source|market|competition|model|none.', {
    groupBy,
  });
}

function buildReliabilityBuckets(scoredRecords, options = {}) {
  const bucketCount = options.bucketCount === undefined ? 10 : Number(options.bucketCount);
  if (!Number.isInteger(bucketCount) || bucketCount <= 0 || bucketCount > 100) {
    throw createBrierError('BRIER_INVALID_INPUT', 'bucketCount must be a positive integer <= 100.', {
      bucketCount: options.bucketCount,
    });
  }

  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    index,
    minProbability: index / bucketCount,
    maxProbability: (index + 1) / bucketCount,
    count: 0,
    probabilitySum: 0,
    outcomeSum: 0,
    brierSum: 0,
  }));

  for (const row of scoredRecords) {
    const probability = Number(row.probabilityYes);
    const outcome = Number(row.outcome);
    const score = Number(row.brierScore);
    const bucketIndex = Math.min(bucketCount - 1, Math.floor(probability * bucketCount));
    const bucket = buckets[bucketIndex];
    bucket.count += 1;
    bucket.probabilitySum += probability;
    bucket.outcomeSum += outcome;
    bucket.brierSum += score;
  }

  return buckets.map((bucket) => {
    if (!bucket.count) {
      return {
        bucket: bucket.index,
        minProbability: bucket.minProbability,
        maxProbability: bucket.maxProbability,
        count: 0,
        avgProbability: null,
        empiricalFrequency: null,
        brier: null,
      };
    }

    return {
      bucket: bucket.index,
      minProbability: bucket.minProbability,
      maxProbability: bucket.maxProbability,
      count: bucket.count,
      avgProbability: bucket.probabilitySum / bucket.count,
      empiricalFrequency: bucket.outcomeSum / bucket.count,
      brier: bucket.brierSum / bucket.count,
    };
  });
}

function summarizeScoredRecords(scoredRecords, options = {}) {
  const scores = scoredRecords.map((row) => Number(row.brierScore));
  const brier = mean(scores);
  return {
    count: scoredRecords.length,
    brier,
    rmse: Math.sqrt(brier),
    reliability: buildReliabilityBuckets(scoredRecords, options),
  };
}

function computeBrierReport(records, options = {}) {
  if (!Array.isArray(records)) {
    throw createBrierError('BRIER_INVALID_INPUT', 'records must be an array.', {
      recordType: typeof records,
    });
  }

  const now = typeof options.now === 'function' ? options.now() : new Date();
  const groupBy = options.groupBy || 'source';
  const outcomeResolver = typeof options.outcomeResolver === 'function' ? options.outcomeResolver : null;

  const scoredRows = [];
  let missingOutcomeCount = 0;
  let invalidProbabilityCount = 0;
  const unresolvedSamples = [];

  for (const record of records) {
    let probabilityYes;
    try {
      probabilityYes = parseProbabilityFromRecord(record);
    } catch {
      invalidProbabilityCount += 1;
      continue;
    }

    let outcome;
    try {
      outcome = parseOutcomeFromRecord(record, outcomeResolver);
    } catch {
      missingOutcomeCount += 1;
      if (unresolvedSamples.length < 5) unresolvedSamples.push(record && record.id ? record.id : null);
      continue;
    }

    if (outcome === null) {
      missingOutcomeCount += 1;
      if (unresolvedSamples.length < 5) unresolvedSamples.push(record && record.id ? record.id : null);
      continue;
    }

    const score = brierScore(probabilityYes, outcome);
    scoredRows.push({
      ...record,
      probabilityYes,
      outcome,
      brierScore: score,
    });
  }

  const grouped = new Map();
  for (const row of scoredRows) {
    const key = toGroupKey(row, groupBy);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(row);
  }

  const groups = [];
  for (const [key, rows] of grouped.entries()) {
    groups.push({
      key,
      ...summarizeScoredRecords(rows, options),
    });
  }
  groups.sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return String(left.key).localeCompare(String(right.key));
  });

  const aggregate = summarizeScoredRecords(scoredRows, options);
  const inputCount = records.length;
  const scoredCount = scoredRows.length;

  const report = {
    schemaVersion: BRIER_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    groupBy,
    bucketCount: options.bucketCount === undefined ? 10 : Number(options.bucketCount),
    inputCount,
    scoredCount,
    skippedCount: inputCount - scoredCount,
    missingOutcomeCount,
    invalidProbabilityCount,
    aggregate,
    groups,
    diagnostics: {
      unresolvedSampleIds: unresolvedSamples,
    },
  };

  if (options.includeRecords) {
    report.records = scoredRows;
  }

  return report;
}

/**
 * Documented exports:
 * - brierScore: scalar Brier score for a binary forecast.
 * - buildReliabilityBuckets: calibration buckets for scored records.
 * - computeBrierReport: aggregate Brier scoring with group-by + diagnostics.
 */
module.exports = {
  BRIER_SCHEMA_VERSION,
  brierScore,
  buildReliabilityBuckets,
  computeBrierReport,
  parseProbabilityFromRecord,
  parseOutcomeFromRecord,
};
