const { computeSportsConsensus } = require('./sports_consensus_service.cjs');
const { getCreationWindowStatus, planResolveWindow } = require('./sports_timing_service.cjs');
const { createSyncOperationBridge } = require('./shared/operation_bridge.cjs');
const { DEFAULT_SPORTS_POLL_CATEGORY } = require('./shared/poll_categories.cjs');
const { MONEYLINE_MARKET_TYPE, SOCCER_WINNER_MARKET_TYPE } = require('./sports_event_normalizer.cjs');

const PPB_TOTAL = 1_000_000_000;

function createCreatePlanError(code, message, details = undefined) {
  const err = new Error(message);
  err.code = code;
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

function toPartsPerBillionFromPct(pct) {
  const numeric = Number(pct);
  if (!Number.isFinite(numeric)) return null;
  const bounded = Math.min(100, Math.max(0, numeric));
  return Math.round((bounded / 100) * PPB_TOTAL);
}

function toIsoFromUnixSeconds(seconds) {
  const numeric = Number(seconds);
  if (!Number.isFinite(numeric)) return null;
  return new Date(Math.trunc(numeric) * 1000).toISOString();
}

function toDateOnlyUtc(isoString) {
  const parsed = Date.parse(String(isoString || ''));
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function inferTimezoneBasis(rawKickoff) {
  const text = String(rawKickoff || '').trim();
  if (!text) return 'unknown';
  if (/[zZ]$/.test(text)) return 'UTC';
  const offsetMatch = text.match(/([+-]\d{2}:\d{2})$/);
  if (offsetMatch) return `UTC${offsetMatch[1]}`;
  return 'source-local-unspecified';
}

function buildProviderEventSourceUrl(baseUrl, endpointTemplate, eventId) {
  const normalizedBase = String(baseUrl || '').trim();
  const normalizedEventId = String(eventId || '').trim();
  if (!normalizedBase || !normalizedEventId) return null;
  const template = String(endpointTemplate || '').trim() || '/events/{eventId}';
  const endpoint = template.replace(/\{eventId\}/g, encodeURIComponent(normalizedEventId));
  try {
    return new URL(endpoint, normalizedBase).toString();
  } catch {
    return null;
  }
}

function normalizeResolutionSources(input) {
  const unique = new Set();
  for (const raw of Array.isArray(input) ? input : []) {
    const text = String(raw || '').trim();
    if (!text) continue;
    try {
      const parsed = new URL(text);
      const protocol = String(parsed.protocol || '').toLowerCase();
      if (protocol !== 'https:' && protocol !== 'http:') continue;
      unique.add(parsed.toString());
    } catch {
      // Ignore invalid source candidates.
    }
  }
  return Array.from(unique);
}

function buildProviderBackedResolutionSources(options, eventId) {
  const mode = String(options && options.provider ? options.provider : 'auto').trim().toLowerCase();
  const roles =
    mode === 'primary' ? ['PRIMARY']
      : mode === 'backup' ? ['BACKUP']
        : ['PRIMARY', 'BACKUP'];

  const urls = [];
  for (const role of roles) {
    const base = process.env[`SPORTSBOOK_${role}_BASE_URL`];
    const oddsPath = process.env[`SPORTSBOOK_${role}_ODDS_PATH`] || '/events/{eventId}/odds';
    const statusPath = process.env[`SPORTSBOOK_${role}_STATUS_PATH`] || '/events/{eventId}/status';
    const oddsUrl = buildProviderEventSourceUrl(base, oddsPath, eventId);
    const statusUrl = buildProviderEventSourceUrl(base, statusPath, eventId);
    if (oddsUrl) urls.push(oddsUrl);
    if (statusUrl) urls.push(statusUrl);
  }

  return normalizeResolutionSources(urls);
}

function buildTimeConfirmation(kickoff, targetTimestamp, creationWindow, targetTimestampOffsetHours) {
  const kickoffIso = kickoff || null;
  const kickoffDate = toDateOnlyUtc(kickoffIso);
  const timezoneBasis = inferTimezoneBasis(kickoffIso);
  const marketCloseIso = toIsoFromUnixSeconds(targetTimestamp);
  return {
    eventDate: kickoffDate,
    eventStart: {
      source: kickoffIso,
      utc: kickoffIso,
    },
    marketClose: {
      utc: marketCloseIso,
      offsetHours: Number.isFinite(Number(targetTimestampOffsetHours)) ? Number(targetTimestampOffsetHours) : null,
    },
    creationWindowClose: {
      utc: creationWindow && creationWindow.window ? creationWindow.window.closesAt : null,
    },
    timezoneBasis,
  };
}

function buildOutcomeSemantics(homeTeam, awayTeam, selection = 'home', oddsMarketType = SOCCER_WINNER_MARKET_TYPE) {
  if (oddsMarketType === MONEYLINE_MARKET_TYPE) {
    if (selection === 'away') {
      return {
        yesMeans: `${awayTeam} wins.`,
        noMeans: `${awayTeam} does not win.`,
      };
    }
    return {
      yesMeans: `${homeTeam} wins.`,
      noMeans: `${homeTeam} does not win.`,
    };
  }
  if (selection === 'away') {
    return {
      yesMeans: `${awayTeam} wins in official full-time result.`,
      noMeans: `${awayTeam} does not win in official full-time result.`,
    };
  }
  if (selection === 'draw') {
    return {
      yesMeans: 'The match ends in a draw in official full-time result.',
      noMeans: 'The match does not end in a draw in official full-time result.',
    };
  }
  return {
    yesMeans: `${homeTeam} wins in official full-time result.`,
    noMeans: `${homeTeam} does not win in official full-time result.`,
  };
}

function buildRules(homeTeam, awayTeam, selection = 'home', oddsMarketType = SOCCER_WINNER_MARKET_TYPE) {
  if (oddsMarketType === MONEYLINE_MARKET_TYPE) {
    if (selection === 'draw') {
      throw createCreatePlanError('INVALID_FLAG_VALUE', 'Moneyline events do not support draw selection.');
    }
    if (selection === 'away') {
      return [
        `Resolves YES if ${awayTeam} wins in official final result.`,
        `Resolves NO if ${homeTeam} wins.`,
        'Canceled/postponed/abandoned/void/unresolved events resolve NO.',
      ].join(' ');
    }
    return [
      `Resolves YES if ${homeTeam} wins in official final result.`,
      `Resolves NO if ${awayTeam} wins.`,
      'Canceled/postponed/abandoned/void/unresolved events resolve NO.',
    ].join(' ');
  }
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

function buildQuestion(event, selection, oddsMarketType = SOCCER_WINNER_MARKET_TYPE) {
  const eventDate = toDateOnlyUtc(event.startTime);
  const suffix = eventDate ? ` on ${eventDate}` : '';
  if (oddsMarketType === MONEYLINE_MARKET_TYPE && selection === 'draw') {
    throw createCreatePlanError('INVALID_FLAG_VALUE', 'Moneyline events do not support draw selection.');
  }
  if (selection === 'away') {
    return `Will ${event.awayTeam} beat ${event.homeTeam}${suffix}?`;
  }
  if (selection === 'draw') {
    return `Will ${event.homeTeam} vs ${event.awayTeam} end in a draw${suffix}?`;
  }
  return `Will ${event.homeTeam} beat ${event.awayTeam}${suffix}?`;
}

function buildConsensusQuotes(oddsPayload, selection, priorityBooks) {
  const books = Array.isArray(oddsPayload && oddsPayload.books) ? oddsPayload.books : [];
  const oddsMarketType = oddsPayload && oddsPayload.marketType ? String(oddsPayload.marketType) : SOCCER_WINNER_MARKET_TYPE;
  if (oddsMarketType === MONEYLINE_MARKET_TYPE && selection === 'draw') {
    throw createCreatePlanError('INVALID_FLAG_VALUE', 'Moneyline events do not support draw selection.');
  }
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

function appendOperationDiagnostics(payload, operation) {
  if (!operation || !Array.isArray(operation.diagnostics) || !operation.diagnostics.length) {
    return payload;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const existingDiagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
  return {
    ...payload,
    diagnostics: existingDiagnostics.concat(operation.diagnostics),
  };
}

function buildSportsFallbackOperationId(eventId, selection) {
  const normalizedEventId = String(eventId || 'unknown-event').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const normalizedSelection = String(selection || 'home').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `sports-create:${normalizedEventId}:${normalizedSelection}`;
}

/**
 * Build a conservative sports market creation plan.
 * @param {object} input
 * @returns {object}
 */
function buildSportsCreatePlan(input = {}) {
  const operation = createSyncOperationBridge(input, {
    command: 'sports.create.plan',
  });
  const event = input.event || {};
  const oddsPayload = input.oddsPayload || {};
  const options = input.options || {};
  const modelInput = input.modelInput && typeof input.modelInput === 'object' ? input.modelInput : null;
  const selection = options.selection || 'home';
  const oddsMarketType = String(
    (oddsPayload && oddsPayload.marketType)
    || (event && event.marketType)
    || SOCCER_WINNER_MARKET_TYPE,
  );
  const ensuredOperationId = operation.ensure({
    phase: 'sports.create.plan.start',
    eventId: event.id || null,
    selection,
  });
  if (!ensuredOperationId && operation.hasCreateHook) {
    operation.setOperationId(buildSportsFallbackOperationId(event.id, selection));
  }

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

  const targetTimestampOffsetHours = Math.max(
    1,
    Number.isFinite(Number(options.targetTimestampOffsetHours))
      ? Math.trunc(Number(options.targetTimestampOffsetHours))
      : 1,
  );
  const resolveTargetTimestamp =
    Number.isFinite(resolveWindow.resolveTargetAtMs)
      ? Math.floor(resolveWindow.resolveTargetAtMs / 1000)
      : null;
  const delayedEventEndTimestamp =
    Number.isFinite(resolveWindow.eventEndMs)
      ? Math.floor((resolveWindow.eventEndMs + (targetTimestampOffsetHours * 3600 * 1000)) / 1000)
      : null;
  const targetTimestamp =
    Number.isInteger(resolveTargetTimestamp) || Number.isInteger(delayedEventEndTimestamp)
      ? Math.max(resolveTargetTimestamp || 0, delayedEventEndTimestamp || 0)
      : null;
  if (!Number.isInteger(targetTimestamp) || targetTimestamp <= 0) {
    blockedReasons.push('Unable to derive targetTimestamp from kickoff; check event timing.');
  }
  const eventEndTimestamp =
    Number.isFinite(resolveWindow.eventEndMs)
      ? Math.floor(resolveWindow.eventEndMs / 1000)
      : null;
  if (Number.isInteger(eventEndTimestamp) && Number.isInteger(targetTimestamp) && targetTimestamp <= eventEndTimestamp) {
    blockedReasons.push('targetTimestamp must be after event completion plus buffer.');
  }

  const question = buildQuestion(event, selection, oddsMarketType);
  const rules = buildRules(event.homeTeam || 'Home Team', event.awayTeam || 'Away Team', selection, oddsMarketType);
  const semantics = buildOutcomeSemantics(
    event.homeTeam || 'Home Team',
    event.awayTeam || 'Away Team',
    selection,
    oddsMarketType,
  );
  const explicitSources = normalizeResolutionSources(options.sources);
  const providerBackedSources = buildProviderBackedResolutionSources(options, event.id || (oddsPayload.event && oddsPayload.event.id));
  const sources = explicitSources.length ? explicitSources : providerBackedSources;
  if (sources.length < 2) {
    blockedReasons.push('At least two explicit public resolution sources are required for deploy-ready sports markets.');
  }
  const timeConfirmation = buildTimeConfirmation(
    kickoff,
    targetTimestamp,
    creationWindow,
    targetTimestampOffsetHours,
  );

  let distributionYes = options.distributionYes;
  let distributionNo = options.distributionNo;
  if (!Number.isInteger(distributionYes) || !Number.isInteger(distributionNo)) {
    // Pandora AMM YES price follows NO reserve share, so reserve weights are inverse of target YES probability.
    const suggestedNo = toPartsPerBillionFromPct(probabilityYesPct);
    distributionNo = Number.isInteger(suggestedNo) ? suggestedNo : 500_000_000;
    distributionYes = PPB_TOTAL - distributionNo;
  }

  const mechanics = deriveMechanics(probabilityYesPct);

  const payload = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    event: {
      id: event.id || null,
      competitionId: event.competitionId || null,
      marketType: oddsMarketType,
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
      confirmation: timeConfirmation,
      statusConfidence: consensus.confidence,
      warnings: blockedReasons,
    },
    marketTemplate: {
      marketType: options.marketType || 'amm',
      oddsMarketType,
      selection,
      question,
      rules,
      semantics,
      sources,
      targetTimestamp,
      targetTimestampOffsetHours,
      liquidityUsdc: Number(options.liquidityUsdc || 100),
      distributionYes,
      distributionNo,
      feeTier: Number(options.feeTier || 3000),
      maxImbalance:
        options.maxImbalance === null || options.maxImbalance === undefined
          ? 16_777_215
          : Number(options.maxImbalance),
      curveFlattener: Number(options.curveFlattener || 7),
      curveOffset: Number(options.curveOffset || 30000),
      chainId: options.chainId || null,
      rpcUrl: options.rpcUrl || null,
      usdc: options.usdc || null,
      oracle: options.oracle || null,
      factory: options.factory || null,
      arbiter: options.arbiter || null,
      category: Number.isInteger(options.category) ? options.category : DEFAULT_SPORTS_POLL_CATEGORY,
      minCloseLeadSeconds: Number(options.minCloseLeadSeconds || 5400),
    },
    mechanics,
    safety: {
      canExecuteCreate: blockedReasons.length === 0,
      blockedReasons,
    },
  };
  operation.update('planned', {
    phase: 'sports.create.plan.complete',
    eventId: payload.event.id,
    canExecuteCreate: payload.safety.canExecuteCreate,
    marketType: payload.marketTemplate.marketType,
  });
  return appendOperationDiagnostics(operation.attach(payload), operation);
}

function buildSportsCreateRunPayload(input = {}) {
  const plan =
    input.plan && typeof input.plan === 'object'
      ? input.plan
      : buildSportsCreatePlan(input);
  const operation = createSyncOperationBridge(
    {
      ...input,
      operationId: input.operationId || (plan && plan.operationId) || null,
    },
    {
      command: 'sports.create.run',
    },
  );
  const ensuredOperationId = operation.ensure({
    phase: 'sports.create.run.start',
    eventId: plan && plan.event ? plan.event.id || null : null,
  });
  if (!ensuredOperationId && operation.hasCreateHook) {
    operation.setOperationId(
      (plan && plan.operationId) || buildSportsFallbackOperationId(plan && plan.event ? plan.event.id : null, plan && plan.marketTemplate ? plan.marketTemplate.selection : null),
    );
  }

  const payload = {
    ...plan,
    mode: input.mode || (input.execute ? 'execute' : 'dry-run'),
    runtime:
      input.runtime && typeof input.runtime === 'object'
        ? input.runtime
        : {
            mode: 'live',
          },
    ...(Object.prototype.hasOwnProperty.call(input, 'deployment') ? { deployment: input.deployment } : {}),
  };

  const hasDeployment = Boolean(payload.deployment && payload.deployment.pandora);
  if (payload.mode === 'execute' && hasDeployment) {
    operation.complete({
      phase: 'sports.create.run.complete',
      eventId: payload.event && payload.event.id ? payload.event.id : null,
      mode: payload.mode,
      marketAddress: payload.deployment.pandora.marketAddress || null,
    });
  } else {
    operation.update('planned', {
      phase: 'sports.create.run.ready',
      eventId: payload.event && payload.event.id ? payload.event.id : null,
      mode: payload.mode,
    });
  }
  return appendOperationDiagnostics(operation.attach(payload), operation);
}

module.exports = {
  buildSportsCreatePlan,
  buildSportsCreateRunPayload,
};
