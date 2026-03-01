const SPORTS_RESOLVE_PLAN_SCHEMA_VERSION = '1.0.0';
const SOURCE_TIER_PRIORITY = Object.freeze(['official', 'bookmaker/aggregator', 'media']);
const SOURCE_TIER_RANK = Object.freeze({
  official: 3,
  bookmaker: 2,
  aggregator: 2,
  media: 1,
});

/**
 * Convert date-like input to epoch milliseconds.
 * @param {unknown} value
 * @returns {number|null}
 */
function toEpochMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * Normalize a date-like input to ISO format.
 * @param {unknown} value
 * @returns {string}
 */
function toIso(value) {
  const ms = toEpochMs(value);
  return new Date(ms === null ? Date.now() : ms).toISOString();
}

/**
 * Normalize source-reported final outcome to `yes|no|invalid`.
 * @param {unknown} value
 * @returns {'yes'|'no'|'invalid'|null}
 */
function normalizeOutcome(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();

  if (!normalized) return null;

  if (['yes', 'y', 'true', 'win', 'won', '1'].includes(normalized)) return 'yes';
  if (['no', 'n', 'false', 'lose', 'lost', '0'].includes(normalized)) return 'no';
  if (['invalid', 'void', 'cancelled', 'canceled', 'draw', 'push'].includes(normalized)) return 'invalid';
  return null;
}

/**
 * Map source descriptor fields to one of the supported tier values.
 * @param {object} source
 * @returns {'official'|'bookmaker'|'aggregator'|'media'}
 */
function classifySourceTier(source = {}) {
  if (source.official === true) return 'official';

  const rawTier = String(source.tier || source.type || source.kind || source.providerType || source.category || '')
    .trim()
    .toLowerCase();

  if (rawTier.includes('official') || rawTier.includes('league') || rawTier.includes('govern')) return 'official';
  if (rawTier.includes('book')) return 'bookmaker';
  if (rawTier.includes('aggregat')) return 'aggregator';
  if (rawTier.includes('media') || rawTier.includes('news') || rawTier.includes('report')) return 'media';

  return 'media';
}

/**
 * Group candidate outcomes by tier while preserving source evidence.
 * @param {Array<object>} sources
 * @returns {Record<'official'|'bookmaker'|'aggregator'|'media', Array<object>>}
 */
function buildTieredCandidates(sources) {
  const grouped = {
    official: [],
    bookmaker: [],
    aggregator: [],
    media: [],
  };

  for (const source of Array.isArray(sources) ? sources : []) {
    const outcome = normalizeOutcome(source.finalResult || source.result || source.outcome || source.answer);
    if (!outcome) continue;

    const tier = classifySourceTier(source);
    grouped[tier].push({
      tier,
      outcome,
      sourceName: source.name || source.source || source.provider || 'unknown',
      sourceUrl: source.url || source.link || null,
      checkedAt: source.checkedAt || null,
    });
  }

  return grouped;
}

/**
 * Pick the first reliable outcome using official-first hierarchy.
 * If the highest available tier conflicts internally, no result is selected.
 * @param {Record<'official'|'bookmaker'|'aggregator'|'media', Array<object>>} candidates
 * @returns {{safeTierOutcome: {tier: string, outcome: 'yes'|'no'|'invalid', evidence: Array<object>}|null, diagnostics: Array<object>}}
 */
function selectOfficialFirstOutcome(candidates) {
  const diagnostics = [];

  const tierGroups = [
    { tierName: 'official', values: candidates.official },
    { tierName: 'bookmaker/aggregator', values: [...candidates.bookmaker, ...candidates.aggregator] },
    { tierName: 'media', values: candidates.media },
  ];

  for (const tier of tierGroups) {
    if (!tier.values.length) continue;

    const uniqueOutcomes = Array.from(new Set(tier.values.map((item) => item.outcome)));
    if (uniqueOutcomes.length > 1) {
      diagnostics.push({
        code: 'TIER_CONFLICT',
        severity: 'error',
        message: `Conflicting final results in ${tier.tierName} sources.`,
        details: {
          tier: tier.tierName,
          outcomes: uniqueOutcomes,
          sources: tier.values,
        },
      });
      return {
        safeTierOutcome: null,
        diagnostics,
      };
    }

    return {
      safeTierOutcome: {
        tier: tier.tierName,
        outcome: uniqueOutcomes[0],
        evidence: tier.values,
      },
      diagnostics,
    };
  }

  diagnostics.push({
    code: 'NO_FINAL_RESULT',
    severity: 'error',
    message: 'No final result candidate found in official, bookmaker/aggregator, or media sources.',
  });

  return {
    safeTierOutcome: null,
    diagnostics,
  };
}

/**
 * Evaluate a single resolve check snapshot and extract best candidate outcome.
 * @param {object} check
 * @returns {object}
 */
function evaluateResolveCheck(check = {}) {
  const candidates = buildTieredCandidates(check.sources || []);
  const selected = selectOfficialFirstOutcome(candidates);

  return {
    checkId: check.checkId || null,
    checkedAt: toIso(check.checkedAt),
    outcome: selected.safeTierOutcome ? selected.safeTierOutcome.outcome : null,
    tier: selected.safeTierOutcome ? selected.safeTierOutcome.tier : null,
    evidence: selected.safeTierOutcome ? selected.safeTierOutcome.evidence : [],
    diagnostics: selected.diagnostics,
    tierCandidates: candidates,
  };
}

/**
 * Evaluate cross-check safety requirements:
 * 1) same final result in required consecutive checks
 * 2) settle delay elapsed from start of stable window
 * @param {Array<object>} evaluatedChecks
 * @param {{now?: Date|string|number, settleDelayMs?: number, consecutiveChecksRequired?: number}} [options]
 * @returns {{safe: boolean, recommendedAnswer: 'yes'|'no'|'invalid'|null, settleDelaySatisfied: boolean, stableWindowStartAt: string|null, diagnostics: Array<object>}}
 */
function evaluateResolveSafety(evaluatedChecks = [], options = {}) {
  const nowMs = toEpochMs(options.now);
  const currentMs = nowMs === null ? Date.now() : nowMs;
  const settleDelayMs =
    Number.isFinite(options.settleDelayMs) && options.settleDelayMs >= 0 ? Number(options.settleDelayMs) : 10 * 60 * 1000;
  const consecutiveChecksRequired =
    Number.isInteger(options.consecutiveChecksRequired) && options.consecutiveChecksRequired > 0
      ? Number(options.consecutiveChecksRequired)
      : 2;

  const diagnostics = [];

  if (!Array.isArray(evaluatedChecks) || evaluatedChecks.length < consecutiveChecksRequired) {
    diagnostics.push({
      code: 'INSUFFICIENT_CHECKS',
      severity: 'error',
      message: 'Not enough checks to satisfy consecutive confirmation requirement.',
      details: {
        checksAvailable: Array.isArray(evaluatedChecks) ? evaluatedChecks.length : 0,
        consecutiveChecksRequired,
      },
    });

    return {
      safe: false,
      recommendedAnswer: null,
      settleDelaySatisfied: false,
      stableWindowStartAt: null,
      diagnostics,
    };
  }

  const tail = evaluatedChecks.slice(-consecutiveChecksRequired);
  const tailOutcomes = tail.map((item) => normalizeOutcome(item.outcome));
  const uniqueTailOutcomes = Array.from(new Set(tailOutcomes.filter(Boolean)));

  const allTailChecksHaveOutcome = tailOutcomes.every((item) => Boolean(item));
  if (!allTailChecksHaveOutcome || uniqueTailOutcomes.length !== 1) {
    diagnostics.push({
      code: 'NO_CONSECUTIVE_FINAL_MATCH',
      severity: 'error',
      message: 'Final result is not stable across required consecutive checks.',
      details: {
        consecutiveChecksRequired,
        tailOutcomes,
      },
    });

    return {
      safe: false,
      recommendedAnswer: null,
      settleDelaySatisfied: false,
      stableWindowStartAt: null,
      diagnostics,
    };
  }

  const stableWindowStartMs = toEpochMs(tail[0].checkedAt);
  const stableWindowStartAt = stableWindowStartMs === null ? null : toIso(stableWindowStartMs);
  const elapsedMs = stableWindowStartMs === null ? 0 : Math.max(0, currentMs - stableWindowStartMs);
  const settleDelaySatisfied = stableWindowStartMs !== null && elapsedMs >= settleDelayMs;

  if (!settleDelaySatisfied) {
    diagnostics.push({
      code: 'SETTLE_DELAY_PENDING',
      severity: 'error',
      message: 'Consecutive match found, but settle delay has not elapsed.',
      details: {
        settleDelayMs,
        elapsedMs,
        remainingMs: Math.max(0, settleDelayMs - elapsedMs),
      },
    });

    return {
      safe: false,
      recommendedAnswer: uniqueTailOutcomes[0],
      settleDelaySatisfied,
      stableWindowStartAt,
      diagnostics,
    };
  }

  return {
    safe: true,
    recommendedAnswer: uniqueTailOutcomes[0],
    settleDelaySatisfied,
    stableWindowStartAt,
    diagnostics,
  };
}

/**
 * Quote shell argument safely for generated command suggestions.
 * @param {string} value
 * @returns {string}
 */
function shellQuote(value) {
  const text = String(value == null ? '' : value);
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build recommended `pandora resolve --execute` command when safe.
 * @param {{pollAddress: string, answer: 'yes'|'no'|'invalid', reason: string, extraFlags?: string[]}} params
 * @returns {string}
 */
function buildResolveExecuteCommand(params) {
  const pollAddress = String(params.pollAddress || '').trim();
  const answer = normalizeOutcome(params.answer);
  const reason = String(params.reason || '').trim();
  const extraFlags = Array.isArray(params.extraFlags)
    ? params.extraFlags
        .map((token) => String(token || '').trim())
        .filter(Boolean)
    : [];

  if (!pollAddress) {
    throw new Error('buildResolveExecuteCommand requires pollAddress.');
  }
  if (!answer) {
    throw new Error('buildResolveExecuteCommand requires answer yes|no|invalid.');
  }
  if (!reason) {
    throw new Error('buildResolveExecuteCommand requires a non-empty reason.');
  }

  return [
    'pandora resolve',
    '--poll-address',
    pollAddress,
    '--answer',
    answer,
    '--reason',
    shellQuote(reason),
    '--execute',
    ...extraFlags,
  ].join(' ');
}

/**
 * Build resolve planning payload with official-first confidence and safety diagnostics.
 * @param {object} input
 * @param {string} input.pollAddress
 * @param {string} [input.reason]
 * @param {Array<object>} [input.checks]
 * @param {number} [input.settleDelayMs]
 * @param {number} [input.consecutiveChecksRequired]
 * @param {Date|string|number} [input.now]
 * @param {string[]} [input.extraFlags]
 * @returns {object}
 */
function buildSportsResolvePlan(input = {}) {
  const checks = Array.isArray(input.checks) ? input.checks : [];
  const evaluatedChecks = checks.map((check) => evaluateResolveCheck(check));
  const safety = evaluateResolveSafety(evaluatedChecks, {
    now: input.now,
    settleDelayMs: input.settleDelayMs,
    consecutiveChecksRequired: input.consecutiveChecksRequired,
  });

  const settleDelayMs =
    Number.isFinite(input.settleDelayMs) && input.settleDelayMs >= 0 ? Number(input.settleDelayMs) : 10 * 60 * 1000;
  const consecutiveChecksRequired =
    Number.isInteger(input.consecutiveChecksRequired) && input.consecutiveChecksRequired > 0
      ? Number(input.consecutiveChecksRequired)
      : 2;

  const diagnostics = [];
  for (const check of evaluatedChecks) {
    if (Array.isArray(check.diagnostics) && check.diagnostics.length) {
      diagnostics.push(
        ...check.diagnostics.map((entry) => ({
          ...entry,
          details: {
            ...(entry.details || {}),
            checkId: check.checkId,
            checkedAt: check.checkedAt,
          },
        })),
      );
    }
  }
  diagnostics.push(...safety.diagnostics);

  if (!String(input.pollAddress || '').trim()) {
    diagnostics.push({
      code: 'MISSING_POLL_ADDRESS',
      severity: 'error',
      message: 'pollAddress is required to build resolve execution command.',
    });
  }

  const reason = String(input.reason || 'Sports market final result confirmed by consecutive checks.').trim();
  let recommendedCommand = null;
  if (safety.safe && String(input.pollAddress || '').trim()) {
    recommendedCommand = buildResolveExecuteCommand({
      pollAddress: String(input.pollAddress || '').trim(),
      answer: safety.recommendedAnswer,
      reason,
      extraFlags: input.extraFlags,
    });
  }

  return {
    schemaVersion: SPORTS_RESOLVE_PLAN_SCHEMA_VERSION,
    generatedAt: toIso(input.now),
    policy: {
      hierarchy: SOURCE_TIER_PRIORITY,
      consecutiveChecksRequired,
      settleDelayMs,
    },
    safeToResolve: Boolean(safety.safe),
    recommendedAnswer: safety.recommendedAnswer,
    recommendedCommand,
    unsafeDiagnostics: safety.safe ? [] : diagnostics,
    diagnostics,
    checksAnalyzed: evaluatedChecks.length,
    stableWindowStartAt: safety.stableWindowStartAt,
    settleDelaySatisfied: safety.settleDelaySatisfied,
    checks: evaluatedChecks,
  };
}

module.exports = {
  SPORTS_RESOLVE_PLAN_SCHEMA_VERSION,
  SOURCE_TIER_PRIORITY,
  SOURCE_TIER_RANK,
  normalizeOutcome,
  classifySourceTier,
  evaluateResolveCheck,
  evaluateResolveSafety,
  buildResolveExecuteCommand,
  buildSportsResolvePlan,
};
