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
 * Build machine-usable argv for `pandora resolve`.
 * @param {{pollAddress: string, answer: 'yes'|'no'|'invalid', reason: string, extraFlags?: string[]}} params
 * @returns {string[]}
 */
function buildResolveExecuteArgv(params) {
  const pollAddress = String(params.pollAddress || '').trim();
  const answer = normalizeOutcome(params.answer);
  const reason = String(params.reason || '').trim();
  const extraFlags = Array.isArray(params.extraFlags)
    ? params.extraFlags
        .map((token) => String(token || '').trim())
        .filter(Boolean)
    : [];

  if (!pollAddress) {
    throw new Error('buildResolveExecuteArgv requires pollAddress.');
  }
  if (!answer) {
    throw new Error('buildResolveExecuteArgv requires answer yes|no|invalid.');
  }
  if (!reason) {
    throw new Error('buildResolveExecuteArgv requires a non-empty reason.');
  }

  return [
    'resolve',
    '--poll-address',
    pollAddress,
    '--answer',
    answer,
    '--reason',
    reason,
    '--execute',
    ...extraFlags,
  ];
}

/**
 * Build recommended `pandora resolve --execute` command when safe.
 * @param {{pollAddress: string, answer: 'yes'|'no'|'invalid', reason: string, extraFlags?: string[]}} params
 * @returns {string}
 */
function buildResolveExecuteCommand(params) {
  const argv = buildResolveExecuteArgv(params);
  return [
    'pandora',
    ...argv.map((token, index) => {
      if (index === 6) {
        return shellQuote(token);
      }
      return token;
    }),
  ].join(' ');
}

function highestTier(tiers = []) {
  let best = null;
  let bestRank = -1;
  for (const tier of Array.isArray(tiers) ? tiers : []) {
    const rank = SOURCE_TIER_RANK[String(tier || '').trim().toLowerCase()] || 0;
    if (rank > bestRank) {
      best = tier;
      bestRank = rank;
    }
  }
  return best;
}

function buildSupportingResolutionEvidence(evaluatedChecks = [], recommendedAnswer, consecutiveChecksRequired) {
  const normalizedAnswer = normalizeOutcome(recommendedAnswer);
  if (!normalizedAnswer) {
    return {
      supportingChecks: [],
      sourceTier: null,
      evidence: [],
    };
  }

  const tailSize =
    Number.isInteger(consecutiveChecksRequired) && consecutiveChecksRequired > 0
      ? Number(consecutiveChecksRequired)
      : 2;
  const tail = evaluatedChecks.slice(-tailSize);
  const supportingChecks = tail.filter((check) => normalizeOutcome(check && check.outcome) === normalizedAnswer);
  if (supportingChecks.length !== tail.length) {
    return {
      supportingChecks: [],
      sourceTier: null,
      evidence: [],
    };
  }

  const evidence = supportingChecks.flatMap((check) => (Array.isArray(check.evidence) ? check.evidence : []));
  return {
    supportingChecks,
    sourceTier: highestTier(supportingChecks.map((check) => check && check.tier)),
    evidence,
  };
}

function buildResolveTimingSummary(input = {}) {
  const nowMs = toEpochMs(input.now);
  const currentMs = nowMs === null ? Date.now() : nowMs;
  const stableWindowStartMs = toEpochMs(input.stableWindowStartAt);
  const settleDelayMs = Number.isFinite(input.settleDelayMs) && input.settleDelayMs >= 0 ? Number(input.settleDelayMs) : 0;
  const stableWindowElapsedMs = stableWindowStartMs === null ? 0 : Math.max(0, currentMs - stableWindowStartMs);
  const remainingSettleDelayMs = stableWindowStartMs === null ? settleDelayMs : Math.max(0, settleDelayMs - stableWindowElapsedMs);
  const recommendedRecheckAt = remainingSettleDelayMs > 0 ? toIso(currentMs + remainingSettleDelayMs) : null;

  return {
    now: toIso(currentMs),
    stableWindowStartAt: stableWindowStartMs === null ? null : toIso(stableWindowStartMs),
    stableWindowElapsedMs,
    settleDelayMs,
    remainingSettleDelayMs,
    settleDelaySatisfied: Boolean(input.settleDelaySatisfied),
    recommendedRecheckAt,
  };
}

function buildResolveExecutionPlan(input = {}) {
  const pollAddress = String(input.pollAddress || '').trim() || null;
  const answer = normalizeOutcome(input.answer);
  const reason = String(input.reason || '').trim() || null;
  const extraFlags = Array.isArray(input.extraFlags)
    ? input.extraFlags.map((token) => String(token || '').trim()).filter(Boolean)
    : [];
  const blockedBy = Array.isArray(input.blockedBy) ? Array.from(new Set(input.blockedBy.filter(Boolean))) : [];
  const missing = [];

  if (!pollAddress) missing.push('pollAddress');
  if (!answer) missing.push('answer');
  if (!reason) missing.push('reason');

  if (!input.ready || missing.length) {
    return {
      ready: false,
      commandName: 'resolve',
      flags: {
        pollAddress,
        answer,
        reason,
        execute: true,
        extraFlags,
      },
      argv: null,
      command: null,
      blockedBy,
      missing,
    };
  }

  const argv = buildResolveExecuteArgv({
    pollAddress,
    answer,
    reason,
    extraFlags,
  });
  return {
    ready: true,
    commandName: 'resolve',
    flags: {
      pollAddress,
      answer,
      reason,
      execute: true,
      extraFlags,
    },
    argv,
    command: buildResolveExecuteCommand({
      pollAddress,
      answer,
      reason,
      extraFlags,
    }),
    blockedBy: [],
    missing: [],
  };
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
  const now = input.now;
  const pollAddress = String(input.pollAddress || '').trim();
  const reason = String(input.reason || 'Sports market final result confirmed by consecutive checks.').trim();

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

  if (!pollAddress) {
    diagnostics.push({
      code: 'MISSING_POLL_ADDRESS',
      severity: 'warning',
      message: 'pollAddress is required to emit execution-ready resolve args.',
    });
  }

  const blockingDiagnostics = diagnostics.filter((entry) => String(entry && entry.severity || '').toLowerCase() === 'error');
  const blockingCodes = Array.from(new Set(blockingDiagnostics.map((entry) => entry && entry.code).filter(Boolean)));
  const timing = buildResolveTimingSummary({
    now,
    stableWindowStartAt: safety.stableWindowStartAt,
    settleDelayMs,
    settleDelaySatisfied: safety.settleDelaySatisfied,
  });
  const supporting = buildSupportingResolutionEvidence(
    evaluatedChecks,
    safety.recommendedAnswer,
    consecutiveChecksRequired,
  );
  const execution = buildResolveExecutionPlan({
    ready: safety.safe,
    pollAddress,
    answer: safety.recommendedAnswer,
    reason,
    extraFlags: input.extraFlags,
    blockedBy: blockingCodes,
  });
  const status = safety.safe
    ? (execution.ready ? 'safe' : 'safe-needs-inputs')
    : 'unsafe';

  return {
    schemaVersion: SPORTS_RESOLVE_PLAN_SCHEMA_VERSION,
    generatedAt: toIso(now),
    policy: {
      hierarchy: SOURCE_TIER_PRIORITY,
      consecutiveChecksRequired,
      settleDelayMs,
    },
    status,
    safeToResolve: Boolean(safety.safe),
    recommendedAnswer: safety.recommendedAnswer,
    recommendedCommand: execution.ready ? execution.command : null,
    summary: {
      status,
      checksAnalyzed: evaluatedChecks.length,
      blockingCodes,
      blockerCount: blockingCodes.length,
      executionReady: execution.ready,
      latestCheckAt: evaluatedChecks.length ? evaluatedChecks[evaluatedChecks.length - 1].checkedAt : null,
      sourceTier: supporting.sourceTier,
    },
    resolution: {
      pollAddress: pollAddress || null,
      answer: safety.recommendedAnswer,
      reason,
      sourceTier: supporting.sourceTier,
      supportingChecks: supporting.supportingChecks.map((check) => ({
        checkId: check.checkId,
        checkedAt: check.checkedAt,
        outcome: check.outcome,
        tier: check.tier,
        evidenceCount: Array.isArray(check.evidence) ? check.evidence.length : 0,
      })),
      evidence: supporting.evidence,
    },
    execution,
    blockers: blockingDiagnostics,
    blockingCodes,
    unsafeDiagnostics: safety.safe ? [] : blockingDiagnostics,
    diagnostics,
    checksAnalyzed: evaluatedChecks.length,
    stableWindowStartAt: safety.stableWindowStartAt,
    settleDelaySatisfied: safety.settleDelaySatisfied,
    timing,
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
  buildResolveExecuteArgv,
  buildResolveExecuteCommand,
  buildSportsResolvePlan,
};
