const { computeSportsConsensus } = require('./sports_consensus_service.cjs');
const { getCreationWindowStatus, planResolveWindow } = require('./sports_timing_service.cjs');

const PPB_TOTAL = 1_000_000_000;

function createCreatePlanError(code, message, details = undefined) {
  const err = new Error(message);
  err.code = code;
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

function toUnixSeconds(isoString) {
  const parsed = Date.parse(String(isoString || ''));
  if (Number.isNaN(parsed)) return null;
  return Math.floor(parsed / 1000);
}

function toPartsPerBillionFromPct(pct) {
  const numeric = Number(pct);
  if (!Number.isFinite(numeric)) return null;
  const bounded = Math.min(100, Math.max(0, numeric));
  return Math.round((bounded / 100) * PPB_TOTAL);
}

function buildRules(homeTeam, awayTeam, selection = 'home') {
  if (selection === 'away') {
    return [
      `Resolves YES if ${awayTeam} wins in official full-time result.`,
      `Resolves NO if ${homeTeam} wins or match ends draw.`,
      'Canceled/postponed/abandoned/void/unresolved events resolve NO.',
    ].join(' ');
  }
  if (selection === 'draw') {
    return [
      'Resolves YES if match ends draw in official full-time result.',
      `Resolves NO if ${homeTeam} or ${awayTeam} wins.`,
      'Canceled/postponed/abandoned/void/unresolved events resolve NO.',
    ].join(' ');
  }
  return [
    `Resolves YES if ${homeTeam} wins in official full-time result.`,
    `Resolves NO if ${awayTeam} wins or match ends draw.`,
    'Canceled/postponed/abandoned/void/unresolved events resolve NO.',
  ].join(' ');
}

function buildQuestion(event, selection) {
  if (selection === 'away') {
    return `Will ${event.awayTeam} beat ${event.homeTeam}?`;
  }
  if (selection === 'draw') {
    return `Will ${event.homeTeam} vs ${event.awayTeam} end in a draw?`;
  }
  return `Will ${event.homeTeam} beat ${event.awayTeam}?`;
}

function buildConsensusQuotes(oddsPayload, selection, priorityBooks) {
  const books = Array.isArray(oddsPayload && oddsPayload.books) ? oddsPayload.books : [];
  const selectionKey = selection === 'away' ? 'away' : selection === 'draw' ? 'draw' : 'home';
  const tier1Set = new Set(
    (Array.isArray(priorityBooks) ? priorityBooks : [])
      .map((item) => String(item || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ''))
      .filter(Boolean),
  );

  return books
    .map((bookRow) => {
      const book = String(bookRow.book || bookRow.bookName || '').trim();
      const token = book.toLowerCase().replace(/[^a-z0-9]+/g, '');
      const odds = bookRow && bookRow.outcomes ? Number(bookRow.outcomes[selectionKey]) : null;
      if (!book || !Number.isFinite(odds) || odds <= 1) return null;
      return {
        book,
        odds,
        oddsFormat: 'decimal',
        tier1: tier1Set.size ? tier1Set.has(token) : false,
      };
    })
    .filter(Boolean);
}

function deriveMechanics(consensusYesPct) {
  const yes = Number(consensusYesPct);
  const no = Number.isFinite(yes) ? 100 - yes : null;
  const deltas = [2, 5, 10];
  const sensitivity = deltas.map((delta) => ({
    deltaPct: delta,
    yesPctUp: Number.isFinite(yes) ? Math.min(100, yes + delta) : null,
    yesPctDown: Number.isFinite(yes) ? Math.max(0, yes - delta) : null,
  }));
  const warnings = [];
  if (Number.isFinite(yes)) {
    if (yes <= 5 || yes >= 95) {
      warnings.push('Consensus is near edge probability; slippage sensitivity is elevated.');
    }
    if (Math.abs(50 - yes) >= 35) {
      warnings.push('Distribution is highly skewed; rebalance pressure may be asymmetric.');
    }
  }
  return {
    initialCurvePoint: {
      yesPct: Number.isFinite(yes) ? yes : null,
      noPct: Number.isFinite(no) ? no : null,
    },
    sensitivity,
    warnings,
  };
}

/**
 * Build a conservative sports market creation plan.
 * @param {object} input
 * @returns {object}
 */
function buildSportsCreatePlan(input = {}) {
  const event = input.event || {};
  const oddsPayload = input.oddsPayload || {};
  const options = input.options || {};
  const modelInput = input.modelInput && typeof input.modelInput === 'object' ? input.modelInput : null;
  const selection = options.selection || 'home';

  const quotes = buildConsensusQuotes(oddsPayload, selection, options.bookPriority || oddsPayload.preferredBooks);
  const consensus = computeSportsConsensus(quotes, {
    trimPercent: options.trimPercent,
    minTotalBooks: options.minTotalBooks,
    minTier1Books: options.minTier1Books,
    tier1Books: options.bookPriority || oddsPayload.preferredBooks,
  });

  let probabilitySource = 'consensus';
  let probabilityYesPct = consensus.consensusYesPct;
  if (modelInput) {
    const probability = Number(modelInput.probability);
    if (!Number.isFinite(probability) || probability < 0.01 || probability > 0.99) {
      throw createCreatePlanError('INVALID_FLAG_VALUE', 'BYOM probability must be within [0.01, 0.99].', {
        probability: modelInput.probability,
      });
    }
    probabilitySource = 'model';
    probabilityYesPct = probability * 100;
  }

  const kickoff = event.startTime || oddsPayload.event && oddsPayload.event.startTime;
  const kickoffMs = kickoff ? Date.parse(kickoff) : null;
  const timingSpec = {
    creationOpenLeadMs: Number(options.creationWindowOpenMin || 1440) * 60 * 1000,
    creationCloseLeadMs: Number(options.creationWindowCloseMin || 90) * 60 * 1000,
  };
  const creationWindow = getCreationWindowStatus({
    nowMs: options.nowMs || Date.now(),
    eventStartMs: kickoffMs,
    spec: timingSpec,
  });

  const resolveWindow = planResolveWindow({
    eventStartMs: kickoffMs,
    spec: {
      resolveOpenDelayMs: 10 * 60 * 1000,
      resolveTargetDelayMs: 30 * 60 * 1000,
      resolveCloseDelayMs: 48 * 60 * 60 * 1000,
    },
  });

  const statusToken = String(event.status || '').toLowerCase();
  const blockedReasons = [];
  if (!kickoffMs || Number.isNaN(kickoffMs)) blockedReasons.push('Missing kickoff timestamp.');
  if (!creationWindow.canCreate) blockedReasons.push(`Creation window is ${creationWindow.status}.`);
  if (statusToken.includes('postpon') || statusToken.includes('cancel') || statusToken.includes('abandon')) {
    blockedReasons.push(`Event status is ${event.status}; creation blocked.`);
  }
  if (!modelInput && consensus.confidence === 'insufficient') {
    blockedReasons.push('Insufficient book coverage for creation policy.');
  }

  const question = buildQuestion(event, selection);
  const rules = buildRules(event.homeTeam || 'Home Team', event.awayTeam || 'Away Team', selection);
  const sources = quotes.slice(0, 5).map((item) => `https://odds.example/${encodeURIComponent(item.book)}`);
  const targetTimestamp = toUnixSeconds(kickoff);

  let distributionYes = options.distributionYes;
  let distributionNo = options.distributionNo;
  if (!Number.isInteger(distributionYes) || !Number.isInteger(distributionNo)) {
    const suggestedYes = toPartsPerBillionFromPct(probabilityYesPct);
    distributionYes = Number.isInteger(suggestedYes) ? suggestedYes : 500_000_000;
    distributionNo = PPB_TOTAL - distributionYes;
  }

  const mechanics = deriveMechanics(probabilityYesPct);

  return {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    event: {
      id: event.id || null,
      competitionId: event.competitionId || null,
      homeTeam: event.homeTeam || null,
      awayTeam: event.awayTeam || null,
      status: event.status || null,
      kickoffAt: kickoff || null,
    },
    source: {
      provider: options.provider || 'auto',
      consensus,
      probabilitySource,
      ...(modelInput
        ? {
            model: {
              probability: Number(modelInput.probability),
              probabilityPct: Number((Number(modelInput.probability) * 100).toFixed(6)),
              confidence: modelInput.confidence || null,
              source: modelInput.source || null,
              inputMode: modelInput.inputMode || null,
              modelFile: modelInput.modelFile || null,
            },
          }
        : {}),
    },
    timing: {
      kickoffAt: kickoff || null,
      creationWindow: {
        status: creationWindow.status,
        canCreate: creationWindow.canCreate,
        opensAt: creationWindow.window && creationWindow.window.opensAt,
        closesAt: creationWindow.window && creationWindow.window.closesAt,
      },
      resolveEarliestAt: resolveWindow.resolveOpenAt,
      resolveLatestAt: resolveWindow.resolveCloseAt,
      statusConfidence: consensus.confidence,
      warnings: blockedReasons,
    },
    marketTemplate: {
      marketType: options.marketType || 'amm',
      selection,
      question,
      rules,
      sources,
      targetTimestamp,
      targetTimestampOffsetHours: options.targetTimestampOffsetHours || 1,
      liquidityUsdc: Number(options.liquidityUsdc || 100),
      distributionYes,
      distributionNo,
      feeTier: Number(options.feeTier || 3000),
      maxImbalance: Number(options.maxImbalance || 10000),
      curveFlattener: Number(options.curveFlattener || 7),
      curveOffset: Number(options.curveOffset || 30000),
      chainId: options.chainId || null,
      rpcUrl: options.rpcUrl || null,
      usdc: options.usdc || null,
      oracle: options.oracle || null,
      factory: options.factory || null,
      arbiter: options.arbiter || null,
      category: Number.isInteger(options.category) ? options.category : 3,
      minCloseLeadSeconds: Number(options.minCloseLeadSeconds || 5400),
    },
    mechanics,
    safety: {
      canExecuteCreate: blockedReasons.length === 0,
      blockedReasons,
    },
  };
}

module.exports = {
  buildSportsCreatePlan,
};
