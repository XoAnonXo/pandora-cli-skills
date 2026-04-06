const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { computeLiquidityRecommendation, computeDistributionHint, normalizeProbability } = require('./mirror_sizing_service.cjs');
const { resolvePolymarketMarket, fetchDepthForMarket, browsePolymarketMarkets } = require('./polymarket_trade_adapter.cjs');
const {
  findBestPandoraMatch,
  fetchPandoraMarketContext,
  verifyMirrorPair,
  hashRules,
  preloadPandoraMatchCandidates,
} = require('./mirror_verify_service.cjs');
const { buildRequiredAgentMarketValidation } = require('./agent_market_prompt_service.cjs');
const { deployPandoraAmmMarket } = require('./pandora_deploy_service.cjs');
const { defaultManifestFile, findPair, upsertPair } = require('./mirror_manifest_store.cjs');
const {
  beginMirrorDeployGuard,
  readMirrorDeployGuard,
  updateMirrorDeployGuard,
} = require('./mirror_deploy_guard_store.cjs');
const { createAsyncOperationBridge } = require('./shared/operation_bridge.cjs');
const { isMcpMode } = require('./shared/mcp_path_guard.cjs');
const { round } = require('./shared/utils.cjs');
const {
  DEFAULT_MIRROR_MIN_CLOSE_LEAD_SECONDS,
  normalizeComparableText,
  toUnixSeconds,
  formatTimestampIso,
  parseMirrorTargetTimestampInput,
  buildMirrorTimingData,
  resolveMirrorGateCloseTimestamp,
} = require('./shared/mirror_timing.cjs');

const MIRROR_PLAN_SCHEMA_VERSION = '1.0.0';
const MIRROR_DEPLOY_SCHEMA_VERSION = '1.0.0';
const MIRROR_BROWSE_SCHEMA_VERSION = '1.0.0';

function createServiceError(code, message, details = undefined) {
  const err = new Error(message);
  err.code = code;
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

function buildExistingMirrorRecoveryCommand(pair = {}, selector = {}) {
  const pandoraMarketAddress = pair && pair.pandoraMarketAddress ? pair.pandoraMarketAddress : null;
  const polymarketMarketId = selector && selector.polymarketMarketId ? selector.polymarketMarketId : null;
  const polymarketSlug = !polymarketMarketId && selector && selector.polymarketSlug ? selector.polymarketSlug : null;
  if (!pandoraMarketAddress) return null;
  const parts = [
    'pandora mirror verify',
    `--market-address ${pandoraMarketAddress}`,
  ];
  if (polymarketMarketId) {
    parts.push(`--polymarket-market-id ${polymarketMarketId}`);
  } else if (polymarketSlug) {
    parts.push(`--polymarket-slug ${polymarketSlug}`);
  }
  parts.push('--trust-deploy');
  return parts.join(' ');
}

function buildMirrorSourceSelector(planData = {}, options = {}) {
  return {
    polymarketMarketId:
      (planData.sourceMarket && planData.sourceMarket.marketId ? String(planData.sourceMarket.marketId) : null)
      || (options.polymarketMarketId ? String(options.polymarketMarketId) : null),
    polymarketSlug:
      (planData.sourceMarket && planData.sourceMarket.slug ? String(planData.sourceMarket.slug) : null)
      || (options.polymarketSlug ? String(options.polymarketSlug) : null),
  };
}

function assertMirrorDeployNotDuplicated({ manifestFile, selector, question, ruleHash }) {
  const lookup = findPair(manifestFile, selector);
  if (lookup.ambiguous && !lookup.pair) {
    throw createServiceError(
      'MIRROR_DEPLOY_MANIFEST_AMBIGUOUS',
      'Mirror manifest has multiple matching pairs for this Polymarket market and no canonical market is set.',
      {
        manifestFile: lookup.filePath,
        selector,
        matches: lookup.pairs || [],
      },
    );
  }
  if (lookup.pair && lookup.pair.trusted !== false) {
    throw createServiceError(
      'MIRROR_DEPLOY_ALREADY_EXISTS',
      'Mirror already exists for this Polymarket market. Reuse the canonical market instead of deploying again.',
      {
        manifestFile: lookup.filePath,
        selector,
        pair: lookup.pair,
        sourceQuestion: question || null,
        sourceRuleHash: ruleHash || null,
        recovery: {
          command: buildExistingMirrorRecoveryCommand(lookup.pair, selector),
        },
      },
    );
  }
}

function isResumableMirrorDeployGuard(guard = {}) {
  if (!guard) return false;
  if (guard.status !== 'manual_review_required') return false;
  if (typeof guard.pollAddress !== 'string') return false;
  if (!/^0x[a-fA-F0-9]{40}$/.test(guard.pollAddress)) return false;
  if (guard.marketTxHash) return false;
  return true;
}

function normalizeSources(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  return String(value)
    .split(/[\n,]/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function hasPandoraBinaryRules(value) {
  const text = String(value || '');
  return /(^|\n)\s*YES\s*:/i.test(text) && /(^|\n)\s*NO\s*:/i.test(text);
}

function sanitizeParticipantLabel(value) {
  return String(value || '')
    .replace(/^["'`(\[]+/, '')
    .replace(/["'`)\].,:;!?]+$/, '')
    .trim();
}

function extractMatchParticipants(question) {
  const text = String(question || '').trim();
  if (!text) return [];

  const patterns = [
    /\bwill\s+(.+?)\s+(?:beat|defeat|top|topple|upset|outscore)\s+(.+?)(?:\?|$)/i,
    /^(.+?)\s+(?:vs\.?|v\.?|@|at)\s+(.+?)(?:\?|$)/i,
    /\bbetween\s+(.+?)\s+and\s+(.+?)(?:\?|$)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const left = sanitizeParticipantLabel(match[1]);
    const right = sanitizeParticipantLabel(match[2]);
    if (left && right) {
      return Array.from(new Set([left, right]));
    }
  }

  return [];
}

function extractResolveToSelection(description) {
  const text = String(description || '').trim();
  if (!text) return null;

  const patterns = [
    /\b(?:this market )?resolve(?:s|d)?\s+to\s+([^.;\n]+)/i,
    /\bresolve(?:s|d)?\s+(?:in favor of|for)\s+([^.;\n]+)/i,
    /\bwinner(?:\s+is)?\s*:\s*([^.;\n]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const candidate = sanitizeParticipantLabel(match[1]);
      if (candidate) return candidate;
    }
  }

  return null;
}

function isAdministrativeOutcomeLabel(value) {
  const normalized = normalizeComparableText(value);
  return normalized === 'yes' || normalized === 'no' || normalized === 'other';
}

function extractWinnerSelectionFromQuestion(question) {
  const text = String(question || '').trim();
  if (!text) return null;

  const match = text.match(/\bwill\s+(.+?)\s+win\b/i);
  if (!match || !match[1]) return null;
  return sanitizeParticipantLabel(match[1]) || null;
}

function findBestParticipantMatch(selection, participants) {
  const normalizedSelection = normalizeComparableText(selection);
  if (!normalizedSelection || !Array.isArray(participants) || !participants.length) {
    return null;
  }

  let best = null;
  let bestScore = 0;
  const selectionTokens = new Set(normalizedSelection.split(' ').filter(Boolean));
  for (const participant of participants) {
    const normalizedParticipant = normalizeComparableText(participant);
    if (!normalizedParticipant) continue;
    if (
      normalizedSelection === normalizedParticipant ||
      normalizedSelection.includes(normalizedParticipant) ||
      normalizedParticipant.includes(normalizedSelection)
    ) {
      return participant;
    }
    const participantTokens = new Set(normalizedParticipant.split(' ').filter(Boolean));
    const overlap = [...selectionTokens].filter((token) => participantTokens.has(token)).length;
    const score = overlap / Math.max(selectionTokens.size, participantTokens.size, 1);
    if (score > bestScore) {
      best = participant;
      bestScore = score;
    }
  }

  return bestScore >= 0.5 ? best : null;
}

function buildWinnerRules(selection, opponent) {
  const yesBranch = `YES: The official winner of the event described in the market question is ${selection}.`;
  const noBranch = opponent
    ? `NO: The official winner is ${opponent}, or the event ends in a draw if an official draw is possible.`
    : `NO: ${selection} is not the official winner of the event described in the market question.`;
  const edgeBranch =
    'EDGE: If the event is canceled, postponed, abandoned, or no official result is declared by targetTimestamp, resolve NO.';
  return [yesBranch, noBranch, edgeBranch].join('\n');
}

function buildQuestionFallbackRules(question) {
  const normalizedQuestion = String(question || '').trim().replace(/\?+$/, '');
  if (!normalizedQuestion) {
    return 'YES: The market question resolves true by targetTimestamp.\nNO: The market question does not resolve true by targetTimestamp.\nEDGE: If the event is canceled, postponed, abandoned, or no official result is declared by targetTimestamp, resolve NO.';
  }

  const affirmative = normalizedQuestion.replace(/^will\s+/i, '').trim();
  return [
    `YES: ${affirmative.charAt(0).toUpperCase()}${affirmative.slice(1)}.`,
    `NO: It is not true that ${affirmative}.`,
    'EDGE: If the event is canceled, postponed, abandoned, or no official result is declared by targetTimestamp, resolve NO.',
  ].join('\n');
}

function assertPandoraBinaryRules(rulesText, details = {}) {
  if (hasPandoraBinaryRules(rulesText)) {
    return;
  }
  throw createServiceError(
    'MIRROR_RULES_FORMAT_INVALID',
    'Mirror rules must use explicit Pandora YES:/NO: branches before deploy. Re-run mirror plan --with-rules or pass --rules with binary Pandora rules.',
    details,
  );
}

function isPolymarketSourceUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return /(^|\.)polymarket\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function assertIndependentMirrorSources(sources) {
  const normalized = normalizeSources(sources);
  const invalidSources = [];
  const dependentSources = [];
  const distinctSources = new Set();
  const distinctHosts = new Set();

  for (const source of normalized) {
    try {
      const parsed = new URL(source);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        invalidSources.push(source);
        continue;
      }
      if (isPolymarketSourceUrl(source)) {
        dependentSources.push(source);
        continue;
      }
      distinctSources.add(parsed.toString());
      distinctHosts.add(parsed.hostname.toLowerCase());
    } catch {
      invalidSources.push(source);
    }
  }

  if (!normalized.length) {
    throw createServiceError(
      'MIRROR_SOURCES_REQUIRED',
      'Mirror deploy requires explicit independent public resolution sources via --sources, even in paper mode. Pass two http(s) URLs from different hosts; Polymarket URLs are never used automatically.',
      {
        requiredMinimum: 2,
        normalizedCount: 0,
      },
    );
  }

  if (invalidSources.length) {
    throw createServiceError(
      'MIRROR_SOURCES_INVALID',
      '--sources must contain valid http(s) URLs.',
      {
        invalidSources,
      },
    );
  }

  if (dependentSources.length) {
    throw createServiceError(
      'MIRROR_SOURCES_INVALID',
      'Mirror deploy requires independent resolution sources. Polymarket URLs are not allowed in --sources.',
      {
        dependentSources,
      },
    );
  }

  if (normalized.length < 2) {
    throw createServiceError(
      'MIRROR_SOURCES_REQUIRED',
      'Mirror deploy requires at least two independent public resolution sources in --sources, even in paper mode.',
      {
        requiredMinimum: 2,
        normalizedCount: normalized.length,
      },
    );
  }

  if (distinctSources.size < 2 || distinctHosts.size < 2) {
    throw createServiceError(
      'MIRROR_SOURCES_REQUIRED',
      'Mirror deploy requires at least two independent public resolution sources from different hosts in --sources, even in paper mode.',
      {
        requiredMinimum: 2,
        normalizedCount: normalized.length,
        distinctSourceCount: distinctSources.size,
        distinctHostCount: distinctHosts.size,
      },
    );
  }

  return normalized;
}

function assertMirrorValidationTicket({ execute, question, rules, sources, targetTimestamp, validationTicket }) {
  const requiredValidation = buildRequiredAgentMarketValidation({
    question,
    rules,
    sources,
    targetTimestamp,
  });

  if (!execute || isMcpMode()) {
    return {
      requiredValidation,
      agentValidation: null,
    };
  }

  const providedTicket = String(validationTicket || '').trim();
  if (!providedTicket) {
    throw createServiceError(
      'MIRROR_VALIDATION_REQUIRED',
      'mirror execute requires --validation-ticket from agent market validate for the exact final mirror payload.',
      {
        requiredValidation,
      },
    );
  }

  if (providedTicket !== requiredValidation.ticket) {
    throw createServiceError(
      'MIRROR_VALIDATION_MISMATCH',
      'Provided --validation-ticket does not match the exact final mirror market payload.',
      {
        expectedTicket: requiredValidation.ticket,
        receivedTicket: providedTicket,
        requiredValidation,
      },
    );
  }

  return {
    requiredValidation,
    agentValidation: {
      ok: true,
      ticket: providedTicket,
      decision: 'PASS',
      summary: 'Validated via CLI ticket gate.',
    },
  };
}

function buildRuleTemplate(sourceMarket) {
  const diagnostics = [];
  const sourceQuestion = String(sourceMarket && sourceMarket.question ? sourceMarket.question : '').trim();
  const sourceDescription = String(sourceMarket && sourceMarket.description ? sourceMarket.description : '').trim();
  if (sourceDescription && hasPandoraBinaryRules(sourceDescription)) {
    return {
      rulesText: sourceDescription,
      diagnostics,
    };
  }

  const selectedOutcome = extractResolveToSelection(sourceDescription);
  if (selectedOutcome && !isAdministrativeOutcomeLabel(selectedOutcome)) {
    const participants = extractMatchParticipants(sourceQuestion);
    const selectedParticipant = findBestParticipantMatch(selectedOutcome, participants) || selectedOutcome;
    const opposingParticipant =
      participants.find((participant) => normalizeComparableText(participant) !== normalizeComparableText(selectedParticipant)) || null;

    diagnostics.push('Translated source market resolution text into Pandora YES/NO rules.');
    if (participants.length >= 2 && !opposingParticipant) {
      diagnostics.push('Unable to confidently determine the opposing side; NO branch resolves when the selected side does not win.');
    }
    return {
      rulesText: buildWinnerRules(selectedParticipant, opposingParticipant),
      diagnostics,
    };
  }

  const questionWinner = extractWinnerSelectionFromQuestion(sourceQuestion);
  if (questionWinner) {
    diagnostics.push(
      selectedOutcome && isAdministrativeOutcomeLabel(selectedOutcome)
        ? 'Ignored administrative source outcome label and generated winner rules from the source question.'
        : 'Generated winner rules from the source question.',
    );
    return {
      rulesText: buildWinnerRules(questionWinner, null),
      diagnostics,
    };
  }

  diagnostics.push('Source rules were not already in Pandora YES/NO format; generated fallback binary rule template from the source question.');
  return {
    rulesText: buildQuestionFallbackRules(sourceQuestion || 'the source condition'),
    diagnostics,
  };
}

function buildPlanDigest(planData) {
  const digest = crypto.createHash('sha256');
  digest.update(JSON.stringify({
    sourceMarket: {
      marketId: planData.sourceMarket && planData.sourceMarket.marketId,
      slug: planData.sourceMarket && planData.sourceMarket.slug,
      question: planData.sourceMarket && planData.sourceMarket.question,
      description: planData.sourceMarket && planData.sourceMarket.description,
      yesPct: planData.sourceMarket && planData.sourceMarket.yesPct,
      closeTimestamp: planData.sourceMarket && planData.sourceMarket.closeTimestamp,
    },
    rules: planData.rules
      ? {
          sourceRules: planData.rules.sourceRules || null,
          proposedPandoraRules: planData.rules.proposedPandoraRules || null,
          sourceCount: planData.rules.sourceCount || null,
        }
      : null,
    timing: planData.timing
      ? {
          sourceTimestamp: planData.timing.sourceTimestamp || null,
          sourceTimestampKind: planData.timing.sourceTimestampKind || null,
          suggestedTargetTimestamp: planData.timing.suggestedTargetTimestamp || null,
          minCloseLeadSeconds: planData.timing.minCloseLeadSeconds || null,
        }
      : null,
    liquidityRecommendation: planData.liquidityRecommendation,
    distributionHint: planData.distributionHint,
  }));
  return digest.digest('hex');
}

async function buildMirrorPlan(options = {}) {
  const diagnostics = [];

  const sourceMarket = await resolvePolymarketMarket({
    host: options.polymarketHost,
    gammaUrl: options.polymarketGammaUrl,
    gammaMockUrl: options.polymarketGammaMockUrl,
    mockUrl: options.polymarketMockUrl,
    timeoutMs: options.timeoutMs,
    marketId: options.polymarketMarketId,
    slug: options.polymarketSlug,
  });

  const depth = await fetchDepthForMarket(sourceMarket, {
    host: options.polymarketHost,
    mockUrl: options.polymarketMockUrl,
    slippageBps: options.depthSlippageBps || 100,
  });

  const sourceYesProbability = normalizeProbability(sourceMarket.yesPct);
  if (sourceYesProbability === null) {
    diagnostics.push('Source YES probability unavailable; using 50/50 fallback for distribution hint.');
  }

  const sizing = computeLiquidityRecommendation({
    volume24hUsd: sourceMarket.volume24hUsd,
    depthWithinSlippageUsd: depth.depthWithinSlippageUsd,
    targetSlippageBps: options.targetSlippageBps || 150,
    turnoverTarget: options.turnoverTarget || 1.25,
    depthUtilization: 0.6,
    safetyMultiplier: options.safetyMultiplier || 1.2,
    minLiquidityUsd: options.minLiquidityUsdc || 100,
    maxLiquidityUsd: options.maxLiquidityUsdc || 50_000,
    beta: 0.003,
    qMin: 25,
    qMax: 2000,
  });

  const distribution = computeDistributionHint(sourceYesProbability === null ? 0.5 : sourceYesProbability);
  const rules = buildRuleTemplate(sourceMarket);
  const timing = buildMirrorTimingData(
    sourceMarket,
    Number.isFinite(Number(options.minCloseLeadSeconds))
      ? Number(options.minCloseLeadSeconds)
      : DEFAULT_MIRROR_MIN_CLOSE_LEAD_SECONDS,
  );
  const effectiveCloseResolution = resolveMirrorGateCloseTimestamp(
    sourceMarket,
    Number.isFinite(Number(options.minCloseLeadSeconds))
      ? Number(options.minCloseLeadSeconds)
      : DEFAULT_MIRROR_MIN_CLOSE_LEAD_SECONDS,
  );
  const effectiveCloseTimestamp =
    effectiveCloseResolution && Number.isFinite(Number(effectiveCloseResolution.closeTimestamp))
      ? Number(effectiveCloseResolution.closeTimestamp)
      : sourceMarket.closeTimestamp;

  let match = { best: null, diagnostics: [] };
  try {
    match = await findBestPandoraMatch({
      indexerUrl: options.indexerUrl,
      timeoutMs: options.timeoutMs,
      chainId: options.chainId,
      sourceQuestion: sourceMarket.question,
      limit: 150,
    });
  } catch (err) {
    diagnostics.push(`Duplicate-check fallback: ${err && err.message ? err.message : String(err)}`);
  }

  if (Number.isFinite(effectiveCloseTimestamp)) {
    const nowSec = Math.floor(Date.now() / 1000);
    const timeToCloseSec = effectiveCloseTimestamp - nowSec;
    if (timeToCloseSec <= 24 * 60 * 60) {
      diagnostics.push(`Source market closes soon (${timeToCloseSec}s). Consider higher monitoring cadence.`);
    }
  }

  for (const item of sourceMarket.diagnostics || []) diagnostics.push(item);
  for (const item of depth.diagnostics || []) diagnostics.push(item);
  for (const item of sizing.diagnostics || []) diagnostics.push(item);
  for (const item of distribution.diagnostics || []) diagnostics.push(item);
  for (const item of rules.diagnostics || []) diagnostics.push(item);
  for (const item of match.diagnostics || []) diagnostics.push(item);
  for (const item of timing.warnings || []) diagnostics.push(item);
  if (timing.reason) diagnostics.push(timing.reason);

  const topMatch = match.best
    ? {
        marketAddress: match.best.marketAddress,
        pollAddress: match.best.pollAddress,
        question: match.best.question,
        similarity: match.best.similarity,
        status: match.best.status,
        chainId: match.best.chainId,
        marketType: match.best.marketType,
        yesPct: match.best.yesPct,
      }
    : null;

  const data = {
    schemaVersion: MIRROR_PLAN_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: 'polymarket',
    sourceMarket: {
      marketId: sourceMarket.marketId,
      slug: sourceMarket.slug,
      question: sourceMarket.question,
      description: options.withRules ? sourceMarket.description : undefined,
      closeTimestamp: effectiveCloseTimestamp,
      rawCloseTimestamp: sourceMarket.closeTimestamp,
      effectiveCloseTimestamp,
      eventStartTimestamp: sourceMarket.eventStartTimestamp || null,
      sourceCloseTimestamp: sourceMarket.sourceCloseTimestamp || null,
      timestampSource: sourceMarket.timestampSource || null,
      yesPct: sourceMarket.yesPct,
      noPct: sourceMarket.noPct,
      volume24hUsd: round(sourceMarket.volume24hUsd, 6),
      volumeTotalUsd: round(sourceMarket.volumeTotalUsd, 6),
      liquidityUsd: round(sourceMarket.liquidityUsd, 6),
      yesTokenId: sourceMarket.yesTokenId,
      noTokenId: sourceMarket.noTokenId,
      url: sourceMarket.url,
      sourceHost: sourceMarket.host,
      sourceType: sourceMarket.source,
    },
    match: topMatch,
    rules: {
      sourceRules: options.withRules ? sourceMarket.description || null : undefined,
      proposedPandoraRules: rules.rulesText,
      sourceCount: normalizeSources(options.sources).length,
    },
    timing,
    similarity: topMatch ? topMatch.similarity : null,
    sizingInputs: {
      V24: round(sourceMarket.volume24hUsd, 6),
      D_eps: round(depth.depthWithinSlippageUsd, 6),
      p: sourceYesProbability === null ? null : round(sourceYesProbability, 6),
      targetSlippageBps: options.targetSlippageBps || 150,
      turnoverTarget: options.turnoverTarget || 1.25,
      safetyMultiplier: options.safetyMultiplier || 1.2,
      minLiquidityUsdc: options.minLiquidityUsdc || 100,
      maxLiquidityUsdc: options.maxLiquidityUsdc || 50_000,
    },
    liquidityRecommendation: {
      liquidityUsdc: sizing.recommendation.liquidityUsd,
      components: sizing.derived,
      boundedByMin: sizing.recommendation.boundedByMin,
      boundedByMax: sizing.recommendation.boundedByMax,
      depth: {
        slippageBps: depth.slippageBps,
        depthWithinSlippageUsd: depth.depthWithinSlippageUsd,
        yesDepth: depth.yesDepth,
        noDepth: depth.noDepth,
      },
    },
    distributionHint: {
      distributionYes: distribution.distributionYes,
      distributionNo: distribution.distributionNo,
      probabilityYes: distribution.probabilityYes,
      probabilityNo: distribution.probabilityNo,
    },
    diagnostics,
  };

  if (options.includeSimilarity && topMatch && topMatch.similarity) {
    data.similarityChecks = [topMatch.similarity];
  }

  data.planDigest = buildPlanDigest(data);
  return data;
}

function resolveDeployPlanInput(options = {}) {
  if (!options.planFile) return null;
  const resolved = path.resolve(options.planFile);
  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = JSON.parse(raw);

  if (parsed && parsed.ok && parsed.data && parsed.command === 'mirror.plan') {
    return parsed.data;
  }
  if (parsed && parsed.schemaVersion && parsed.sourceMarket) {
    return parsed;
  }

  throw new Error('Plan file does not contain a valid mirror plan payload.');
}

async function deployMirror(options = {}) {
  const operation = createAsyncOperationBridge(
    {
      ...options,
      operationId: options.operationId || (options.planData && options.planData.operationId) || null,
    },
    {
      command: 'mirror.deploy',
    },
  );

  try {
    await operation.ensure({
      phase: 'mirror.deploy.start',
      execute: Boolean(options.execute),
      planFile: options.planFile || null,
    });

    let planData = options.planData || resolveDeployPlanInput(options);
    if (!planData) {
      planData = await buildMirrorPlan(options);
    }
    operation.setOperationId(planData && planData.operationId ? planData.operationId : null);
    await operation.checkpoint('mirror.deploy.plan.ready', {
      execute: Boolean(options.execute),
      planDigest: planData && planData.planDigest ? planData.planDigest : null,
      sourceMarketId: planData && planData.sourceMarket && planData.sourceMarket.marketId
        ? planData.sourceMarket.marketId
        : null,
    });

    const diagnostics = [];
    const question = String(planData.sourceMarket && planData.sourceMarket.question ? planData.sourceMarket.question : '').trim();
    const minCloseLeadSeconds = Number.isFinite(Number(options.minCloseLeadSeconds))
      ? Number(options.minCloseLeadSeconds)
      : Number(planData.timing && planData.timing.minCloseLeadSeconds);
    const effectiveTiming = planData.timing && typeof planData.timing === 'object'
      ? {
          ...planData.timing,
          ...(Number.isFinite(Number(minCloseLeadSeconds))
            ? { minCloseLeadSeconds: Number(minCloseLeadSeconds) }
            : {}),
        }
      : buildMirrorTimingData(planData.sourceMarket || {}, minCloseLeadSeconds);
    const suggestedTargetTimestamp = parseMirrorTargetTimestampInput(
      effectiveTiming && effectiveTiming.suggestedTargetTimestamp,
    );
    const fallbackTargetTimestamp = parseMirrorTargetTimestampInput(
      planData.sourceMarket && planData.sourceMarket.closeTimestamp,
    );
    const explicitTargetTimestamp = parseMirrorTargetTimestampInput(options.targetTimestamp);
    const targetTimestamp = explicitTargetTimestamp || suggestedTargetTimestamp || fallbackTargetTimestamp;
    const refreshedRuleTemplate = buildRuleTemplate({
      ...(planData.sourceMarket || {}),
      description:
        (planData.rules && (planData.rules.sourceRules || planData.rules.proposedPandoraRules))
        || (planData.sourceMarket && planData.sourceMarket.description)
        || '',
    });
    let sourceRulesText = String(
      options.rules ||
        (planData.rules && (planData.rules.proposedPandoraRules || planData.rules.sourceRules)) ||
        (planData.sourceMarket && planData.sourceMarket.description) ||
        '',
    ).trim();
    if (!options.rules && !hasPandoraBinaryRules(sourceRulesText) && hasPandoraBinaryRules(refreshedRuleTemplate.rulesText)) {
      sourceRulesText = refreshedRuleTemplate.rulesText;
      diagnostics.push('Upgraded non-binary source rules to Pandora YES/NO format during deploy.');
    }
    assertPandoraBinaryRules(sourceRulesText, {
      question,
      sourceRules: planData.rules && planData.rules.sourceRules ? planData.rules.sourceRules : null,
      suggestedRules: refreshedRuleTemplate.rulesText,
    });
    diagnostics.push(...refreshedRuleTemplate.diagnostics);
    if (explicitTargetTimestamp && suggestedTargetTimestamp && explicitTargetTimestamp < suggestedTargetTimestamp) {
      diagnostics.push(
        `Explicit --target-timestamp (${explicitTargetTimestamp}) is earlier than the suggested sports-safe target (${suggestedTargetTimestamp}). Trading may close before overtime or late completion.`,
      );
    } else if (!explicitTargetTimestamp && suggestedTargetTimestamp && suggestedTargetTimestamp !== fallbackTargetTimestamp) {
      diagnostics.push(
        `Using suggested targetTimestamp ${suggestedTargetTimestamp} instead of raw source timestamp ${fallbackTargetTimestamp}.`,
      );
    }
    diagnostics.push(...(Array.isArray(effectiveTiming && effectiveTiming.warnings) ? effectiveTiming.warnings : []));
    if (effectiveTiming && effectiveTiming.reason) diagnostics.push(effectiveTiming.reason);

    const liquidityUsdc =
      options.liquidityUsdc !== null && options.liquidityUsdc !== undefined
        ? Number(options.liquidityUsdc)
        : Number(planData.liquidityRecommendation && planData.liquidityRecommendation.liquidityUsdc);

    const distributionYes =
      options.distributionYes !== null && options.distributionYes !== undefined
        ? Number(options.distributionYes)
        : Number(planData.distributionHint && planData.distributionHint.distributionYes);
    const distributionNo =
      options.distributionNo !== null && options.distributionNo !== undefined
        ? Number(options.distributionNo)
        : Number(planData.distributionHint && planData.distributionHint.distributionNo);

    const sources = assertIndependentMirrorSources(options.sources);
    const validationGate = assertMirrorValidationTicket({
      execute: Boolean(options.execute),
      question,
      rules: sourceRulesText,
      sources,
      targetTimestamp,
      validationTicket: options.validationTicket,
    });
    await operation.checkpoint('mirror.deploy.validation.ready', {
      execute: Boolean(options.execute),
      targetTimestamp,
      requiredValidation:
        validationGate && validationGate.requiredValidation ? validationGate.requiredValidation.ticket : null,
    });

    const manifestFile = options.manifestFile || defaultManifestFile();
    const sourceSelector = buildMirrorSourceSelector(planData, options);
    const sourceRuleHash = hashRules(sourceRulesText);
    let deployGuard = null;
    let resumePollAddress = null;
    let chainWriteStarted = false;
    const deployMarket = typeof options.deployPandoraAmmMarket === 'function'
      ? options.deployPandoraAmmMarket
      : deployPandoraAmmMarket;

    if (options.execute) {
      assertMirrorDeployNotDuplicated({
        manifestFile,
        selector: sourceSelector,
        question,
        ruleHash: sourceRuleHash,
      });
      const existingGuard = readMirrorDeployGuard(sourceSelector, {
        guardDir: options.deployGuardDir,
      });
      if (existingGuard.found && existingGuard.guard && existingGuard.guard.status && existingGuard.guard.status !== 'failed_prewrite') {
        if (!isResumableMirrorDeployGuard(existingGuard.guard)) {
          throw createServiceError(
            existingGuard.guard.status === 'completed' ? 'MIRROR_DEPLOY_ALREADY_EXISTS' : 'MIRROR_DEPLOY_IN_PROGRESS',
            existingGuard.guard.status === 'completed'
              ? 'Mirror deploy already completed for this Polymarket market.'
              : 'Mirror deploy already started for this Polymarket market. Do not rerun until the existing deploy is resolved.',
            {
              selector: sourceSelector,
              deployGuardFile: existingGuard.filePath,
              guard: existingGuard.guard,
              recovery: {
                command: buildExistingMirrorRecoveryCommand(existingGuard.guard, sourceSelector),
              },
            },
          );
        }
        resumePollAddress = existingGuard.guard.pollAddress;
        chainWriteStarted = Boolean(existingGuard.guard.chainWriteStarted);
        deployGuard = updateMirrorDeployGuard(
          sourceSelector,
          {
            ...existingGuard.guard,
            status: 'resuming',
            chainWriteStarted,
            errorCode: null,
            errorMessage: null,
          },
          {
            guardDir: options.deployGuardDir,
          },
        );
      } else {
        deployGuard = beginMirrorDeployGuard(
          sourceSelector,
          {
            operationId: planData && planData.operationId ? planData.operationId : null,
            planDigest: planData && planData.planDigest ? planData.planDigest : buildPlanDigest(planData),
            question,
            sourceRuleHash,
            status: 'started',
            chainWriteStarted: false,
          },
          {
            guardDir: options.deployGuardDir,
          },
        );
      }
    }

    let deployPayload;
    try {
      deployPayload = await deployMarket({
        execute: Boolean(options.execute),
        chainId: options.chainId,
        rpcUrl: options.rpcUrl,
        privateKey: options.privateKey,
        profileId: options.profileId || null,
        profileFile: options.profileFile || null,
        oracle: options.oracle,
        factory: options.factory,
        usdc: options.usdc,
        question,
        rules: sourceRulesText,
        sources,
        targetTimestamp,
        minCloseLeadSeconds: Number.isFinite(Number(minCloseLeadSeconds))
          ? Number(minCloseLeadSeconds)
          : DEFAULT_MIRROR_MIN_CLOSE_LEAD_SECONDS,
        liquidityUsdc,
        distributionYes,
        distributionNo,
        feeTier: options.feeTier || 3000,
        maxImbalance: options.maxImbalance === null || options.maxImbalance === undefined ? 16_777_215 : Number(options.maxImbalance),
        arbiter: options.arbiter,
        category: options.category,
        resumePollAddress,
        command: 'mirror.deploy',
        toolFamily: 'mirror',
        source: 'mirror.deploy',
        onExecutionPhase:
          options.execute
            ? async (event = {}) => {
                if (!deployGuard || !deployGuard.filePath) return;
                const phase = String(event.phase || '').trim().toLowerCase();
                if (!phase) return;
                if (phase === 'poll-submitted' || phase === 'approve-submitted' || phase === 'market-submitted') {
                  chainWriteStarted = true;
                }
                updateMirrorDeployGuard(
                  sourceSelector,
                  {
                    ...deployGuard.guard,
                    ...event,
                    status:
                      phase === 'deploy-complete'
                        ? 'completed'
                        : phase === 'poll-submitted' || phase === 'approve-submitted' || phase === 'market-submitted'
                          ? 'chain_write_started'
                          : phase === 'poll-confirmed'
                            ? 'poll_confirmed'
                            : phase,
                    chainWriteStarted,
                  },
                  {
                    guardDir: options.deployGuardDir,
                  },
                );
              }
            : null,
      });
    } catch (err) {
      if (options.execute && deployGuard && deployGuard.filePath) {
        updateMirrorDeployGuard(
          sourceSelector,
          {
            ...deployGuard.guard,
            status: chainWriteStarted ? 'manual_review_required' : 'failed_prewrite',
            chainWriteStarted,
            errorCode: err && err.code ? err.code : null,
            errorMessage: err && err.message ? err.message : String(err),
            pollTxHash: err && err.details && err.details.pollTxHash ? err.details.pollTxHash : (deployGuard.guard && deployGuard.guard.pollTxHash) || null,
            marketTxHash: err && err.details && err.details.marketTxHash ? err.details.marketTxHash : (deployGuard.guard && deployGuard.guard.marketTxHash) || null,
          },
          {
            guardDir: options.deployGuardDir,
          },
        );
      }
      throw createServiceError(
        err && err.code ? err.code : 'MIRROR_DEPLOY_FAILED',
        err && err.message ? err.message : String(err),
        err && err.details ? err.details : undefined,
      );
    }
    await operation.checkpoint('mirror.deploy.execution.complete', {
      mode: deployPayload.mode,
      marketAddress: deployPayload && deployPayload.pandora ? deployPayload.pandora.marketAddress || null : null,
      txHash: deployPayload && deployPayload.tx ? deployPayload.tx.hash || null : null,
    });

    let trustManifest = null;
    if (options.execute && deployPayload.pandora && deployPayload.pandora.marketAddress) {
      try {
        const manifestUpdate = upsertPair(manifestFile, {
          trusted: true,
          canonical: true,
          pandoraMarketAddress: deployPayload.pandora.marketAddress,
          pandoraPollAddress: deployPayload.pandora.pollAddress,
          polymarketMarketId: planData.sourceMarket && planData.sourceMarket.marketId ? String(planData.sourceMarket.marketId) : options.polymarketMarketId || null,
          polymarketSlug: planData.sourceMarket && planData.sourceMarket.slug ? String(planData.sourceMarket.slug) : options.polymarketSlug || null,
          sourceQuestion: planData.sourceMarket && planData.sourceMarket.question ? planData.sourceMarket.question : null,
          sourceRuleHash,
        });
        trustManifest = {
          filePath: manifestUpdate.filePath,
          pair: manifestUpdate.pair,
        };
      } catch (err) {
        throw createServiceError(
          'MIRROR_MANIFEST_WRITE_FAILED',
          `Failed to persist mirror trust manifest: ${err && err.message ? err.message : String(err)}`,
        );
      }
      if (deployGuard && deployGuard.filePath) {
        updateMirrorDeployGuard(
          sourceSelector,
          {
            ...deployGuard.guard,
            status: 'completed',
            chainWriteStarted: true,
            pandoraMarketAddress: deployPayload.pandora.marketAddress,
            pandoraPollAddress: deployPayload.pandora.pollAddress || null,
            marketTxHash: deployPayload.tx && deployPayload.tx.marketTxHash ? deployPayload.tx.marketTxHash : null,
            pollTxHash: deployPayload.tx && deployPayload.tx.pollTxHash ? deployPayload.tx.pollTxHash : null,
          },
          {
            guardDir: options.deployGuardDir,
          },
        );
      }
    }

    const postDeployChecks = {
      seedOddsMatch: null,
      yesPctSource: planData.sourceMarket && Number.isFinite(Number(planData.sourceMarket.yesPct))
        ? Number(planData.sourceMarket.yesPct)
        : null,
      yesPctPandora: null,
      diffPct: null,
      blockedLiveSync: false,
      code: null,
      message: null,
    };

    if (deployPayload.pandora && deployPayload.pandora.marketAddress && options.indexerUrl) {
      try {
        const pandoraMarket = await fetchPandoraMarketContext({
          indexerUrl: options.indexerUrl,
          timeoutMs: options.timeoutMs,
          marketAddress: deployPayload.pandora.marketAddress,
        });
        postDeployChecks.yesPctPandora = pandoraMarket.yesPct;

        if (postDeployChecks.yesPctSource !== null && postDeployChecks.yesPctPandora !== null) {
          const diff = Math.abs(postDeployChecks.yesPctSource - postDeployChecks.yesPctPandora);
          postDeployChecks.diffPct = round(diff, 6);
          postDeployChecks.seedOddsMatch = diff <= 2;

          if (!postDeployChecks.seedOddsMatch) {
            postDeployChecks.blockedLiveSync = true;
            postDeployChecks.code = 'SEED_ODDS_MISMATCH';
            postDeployChecks.message = `Seed odds mismatch exceeds ±2% (${postDeployChecks.diffPct}%).`;
          }
        }
      } catch (err) {
        diagnostics.push(`Post-deploy seed check unavailable: ${err && err.message ? err.message : String(err)}`);
      }
    } else {
      diagnostics.push('Post-deploy seed check skipped (market address or indexer URL unavailable).');
    }
    await operation.complete({
      dryRun: deployPayload.mode === 'dry-run',
      marketAddress: deployPayload && deployPayload.pandora ? deployPayload.pandora.marketAddress || null : null,
      blockedLiveSync: Boolean(postDeployChecks.blockedLiveSync),
    });

    return operation.attach({
      schemaVersion: MIRROR_DEPLOY_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      planDigest: planData.planDigest || buildPlanDigest(planData),
      deploymentArgs: deployPayload.deploymentArgs,
      timing: {
        ...(effectiveTiming || {}),
        selectedTargetTimestamp: targetTimestamp,
        selectedTargetTimestampIso: formatTimestampIso(targetTimestamp),
        overrideApplied: Boolean(explicitTargetTimestamp),
      },
      dryRun: deployPayload.mode === 'dry-run',
      requiredValidation: deployPayload.requiredValidation || validationGate.requiredValidation || null,
      agentValidation: deployPayload.agentValidation || validationGate.agentValidation || null,
      tx: deployPayload.tx,
      pandora: deployPayload.pandora,
      postDeployChecks,
      trustManifest,
      diagnostics: diagnostics.concat(deployPayload.diagnostics || [], operation.diagnostics),
    });
  } catch (error) {
    await operation.fail(error, {
      command: 'mirror.deploy',
    });
    throw error;
  }
}

async function verifyMirror(options = {}) {
  return verifyMirrorPair(options);
}

async function browseMirrorMarkets(options = {}) {
  const diagnostics = [];
  const polymarket = await browsePolymarketMarkets({
    gammaUrl: options.polymarketGammaUrl,
    gammaMockUrl: options.polymarketGammaMockUrl,
    mockUrl: options.polymarketMockUrl,
    polymarketTagIds: Array.isArray(options.polymarketTagIds) ? options.polymarketTagIds : [],
    timeoutMs: options.timeoutMs,
    minYesPct: options.minYesPct,
    maxYesPct: options.maxYesPct,
    minVolume24h: options.minVolume24h,
    closesAfter: options.closesAfter,
    closesBefore: options.closesBefore,
    questionContains: options.questionContains,
    keyword: options.keyword,
    slug: options.slug,
    categories: Array.isArray(options.categories) ? options.categories : [],
    excludeSports: Boolean(options.excludeSports),
    sortBy: options.sortBy,
    limit: options.limit,
  });

  let preloadedPandoraCandidates = null;
  let preloadDuplicateCheckError = null;
  if (options.indexerUrl) {
    try {
      preloadedPandoraCandidates = await preloadPandoraMatchCandidates({
        indexerUrl: options.indexerUrl,
        timeoutMs: options.timeoutMs,
        chainId: options.chainId,
        limit: 100,
      });
    } catch (err) {
      preloadDuplicateCheckError = err;
    }
  }

  const items = [];
  for (const entry of polymarket.items || []) {
    let existingMirror = null;
    if (options.indexerUrl) {
      if (preloadDuplicateCheckError) {
        diagnostics.push(
          `Duplicate-check skipped for "${entry.slug || entry.marketId || entry.question || 'market'}": ${preloadDuplicateCheckError && preloadDuplicateCheckError.message ? preloadDuplicateCheckError.message : String(preloadDuplicateCheckError)}`,
        );
      } else {
        try {
          const match = await findBestPandoraMatch({
            sourceQuestion: entry.question,
            candidateSet: preloadedPandoraCandidates,
          });
          if (match.best && match.best.similarity && Number(match.best.similarity.score) >= 0.86) {
            existingMirror = {
              marketAddress: match.best.marketAddress,
              similarity: match.best.similarity.score,
            };
          }
          diagnostics.push(...(match.diagnostics || []));
        } catch (err) {
          diagnostics.push(`Duplicate-check skipped for "${entry.slug || entry.marketId || entry.question || 'market'}": ${err && err.message ? err.message : String(err)}`);
        }
      }
    }

    items.push({
      ...entry,
      existingMirror,
    });
  }

  return {
    schemaVersion: MIRROR_BROWSE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: polymarket.source,
    gammaApiError: polymarket.gammaApiError || null,
    filters: polymarket.filters,
    count: items.length,
    items,
    diagnostics: (polymarket.diagnostics || []).concat(diagnostics),
  };
}

module.exports = {
  MIRROR_PLAN_SCHEMA_VERSION,
  MIRROR_DEPLOY_SCHEMA_VERSION,
  MIRROR_BROWSE_SCHEMA_VERSION,
  buildMirrorPlan,
  deployMirror,
  verifyMirror,
  browseMirrorMarkets,
  buildPlanDigest,
};
