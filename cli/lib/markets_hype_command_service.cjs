'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isMcpMode } = require('./shared/mcp_path_guard.cjs');
const {
  DEFAULT_RPC_BY_CHAIN_ID,
  DEFAULT_ORACLE,
  DEFAULT_FACTORY,
  DEFAULT_USDC,
  DEFAULT_ARBITER,
  DEFAULT_INDEXER_URL,
} = require('./shared/constants.cjs');
const { getPollCategoryId, POLL_CATEGORY_NAME_LIST } = require('./shared/poll_categories.cjs');
const {
  HYPE_AREAS,
  buildAgentMarketHypePayload,
  buildRequiredAgentMarketValidation,
} = require('./agent_market_prompt_service.cjs');
const {
  planHypeMarkets,
  validateMarketDraft,
} = require('./hype_market_provider.cjs');
const { createIndexerClient } = require('./indexer_client.cjs');
const { questionSimilarityBreakdown } = require('./similarity_service.cjs');

const EXISTING_MARKET_FIELDS = ['id', 'pollAddress', 'chainId', 'marketType', 'marketCloseTimestamp', 'createdAt'];
const EXISTING_POLL_FIELDS = ['id', 'question', 'category', 'createdAt', 'deadlineEpoch'];
const DUPLICATE_THRESHOLD = 0.86;
const DEFAULT_LIQUIDITY_USDC = 100;
const DISTRIBUTION_SCALE = 1_000_000_000;

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunMarketsHypeCommand requires deps.${name}().`);
  }
  return deps[name];
}

function normalizeLowercaseAddress(value, fallback) {
  return String(value || fallback || '').trim().toLowerCase() || null;
}

function buildRuntimeDefaults(options = {}) {
  const chainId = Number(options.chainId || process.env.CHAIN_ID || 1);
  return {
    chainId,
    rpcUrl: options.rpcUrl || process.env.RPC_URL || DEFAULT_RPC_BY_CHAIN_ID[chainId] || null,
    oracle: normalizeLowercaseAddress(options.oracle, process.env.ORACLE || DEFAULT_ORACLE),
    factory: normalizeLowercaseAddress(options.factory, process.env.FACTORY || DEFAULT_FACTORY),
    usdc: normalizeLowercaseAddress(options.usdc, process.env.USDC || DEFAULT_USDC),
    arbiter: normalizeLowercaseAddress(options.arbiter, process.env.ARBITER || DEFAULT_ARBITER),
  };
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function computeBalanceScore(yesPct) {
  return round(Math.max(0, 100 - Math.abs(Number(yesPct) - 50) * 2), 2);
}

function buildDistributionParts(yesPct) {
  const clampedYesPct = clamp(yesPct, 0, 100);
  const distributionYes = Math.round(clampedYesPct * (DISTRIBUTION_SCALE / 100));
  return {
    distributionYes,
    distributionNo: DISTRIBUTION_SCALE - distributionYes,
  };
}

function normalizeOptionalInteger(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function buildFrozenDraftPayload(draft = {}) {
  return {
    question: String(draft.question || '').trim(),
    rules: String(draft.rules || '').trim(),
    sources: Array.isArray(draft.sources) ? draft.sources.map((source) => String(source || '').trim()).filter(Boolean) : [],
    targetTimestamp: normalizeOptionalInteger(draft.targetTimestamp),
    marketType: String(draft.marketType || '').trim().toLowerCase() || null,
    category: normalizeOptionalInteger(draft.category),
    liquidityUsdc: Number.isFinite(Number(draft.liquidityUsdc)) ? Number(draft.liquidityUsdc) : null,
    distributionYes: normalizeOptionalInteger(draft.distributionYes),
    distributionNo: normalizeOptionalInteger(draft.distributionNo),
    feeTier: normalizeOptionalInteger(draft.feeTier),
    maxImbalance: normalizeOptionalInteger(draft.maxImbalance),
    curveFlattener: normalizeOptionalInteger(draft.curveFlattener),
    curveOffset: normalizeOptionalInteger(draft.curveOffset),
    minCloseLeadSeconds: normalizeOptionalInteger(draft.minCloseLeadSeconds),
    chainId: normalizeOptionalInteger(draft.chainId),
    oracle: normalizeLowercaseAddress(draft.oracle, null),
    factory: normalizeLowercaseAddress(draft.factory, null),
    usdc: normalizeLowercaseAddress(draft.usdc, null),
    arbiter: normalizeLowercaseAddress(draft.arbiter, null),
  };
}

function buildDraftIntegrityHash(draft = {}) {
  const canonical = buildFrozenDraftPayload(draft);
  return `hype-draft:${crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 24)}`;
}

function resolvePlanningNow(value) {
  const explicit = new Date(value || Date.now());
  if (Number.isFinite(explicit.getTime())) return explicit;
  return new Date();
}

function normalizeCandidateTimestamp(inputIso, minCloseLeadSeconds, nowSec) {
  const minimumLeadSeconds =
    Number.isFinite(Number(minCloseLeadSeconds)) && Number(minCloseLeadSeconds) > 0
      ? Number(minCloseLeadSeconds)
      : 1800;
  const parsed = Math.floor(new Date(inputIso).getTime() / 1000);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return nowSec + Math.max(7200, minimumLeadSeconds);
  }
  return Math.max(parsed, nowSec + Math.max(1800, minimumLeadSeconds));
}

function areaToCategoryName(area, candidateCategory) {
  const normalized = String(candidateCategory || '').trim();
  const categoryId = normalized ? getPollCategoryId(normalized) : null;
  if (categoryId !== null) {
    return POLL_CATEGORY_NAME_LIST[categoryId] || normalized;
  }
  if (area === 'sports' || area === 'esports') return 'Sports';
  if (area === 'politics') return 'Politics';
  return 'Other';
}

function categoryIdFromArea(area, candidateCategory) {
  const id = getPollCategoryId(areaToCategoryName(area, candidateCategory));
  return id === null ? 10 : id;
}

function pickRecommendedMarketType(candidate, explicitMode = 'auto') {
  if (explicitMode === 'amm' || explicitMode === 'parimutuel') return explicitMode;
  const ammFit = Number(candidate.ammFitScore) || 0;
  const parimutuelFit = Number(candidate.parimutuelFitScore) || 0;
  const tradingWindowHours = Number(candidate.tradingWindowHours) || 0;
  if (ammFit === parimutuelFit) {
    return tradingWindowHours >= 24 ? 'amm' : 'parimutuel';
  }
  return ammFit >= parimutuelFit ? 'amm' : 'parimutuel';
}

function recommendFeeTier(candidate) {
  const balance = computeBalanceScore(candidate.estimatedYesOdds);
  if (balance >= 80) return 2000;
  if (balance >= 60) return 3000;
  return 5000;
}

function recommendCurveParams(candidate) {
  const skew = Math.abs(Number(candidate.estimatedYesOdds) - 50);
  if (skew <= 8) return { curveFlattener: 7, curveOffset: 30000 };
  if (skew <= 15) return { curveFlattener: 8, curveOffset: 60000 };
  if (skew <= 22) return { curveFlattener: 9, curveOffset: 100000 };
  if (skew <= 30) return { curveFlattener: 10, curveOffset: 150000 };
  return { curveFlattener: 11, curveOffset: 200000 };
}

function computeOverallScore(candidate, duplicateRiskScore, recommendedMarketType) {
  const balanceScore = computeBalanceScore(candidate.estimatedYesOdds);
  const fitScore = recommendedMarketType === 'amm' ? Number(candidate.ammFitScore) || 0 : Number(candidate.parimutuelFitScore) || 0;
  const raw = (
    (Number(candidate.attentionScore) || 0) * 0.28 +
    (Number(candidate.freshnessScore) || 0) * 0.22 +
    (Number(candidate.resolvabilityScore) || 0) * 0.24 +
    balanceScore * 0.14 +
    fitScore * 0.12
  ) - duplicateRiskScore * 0.18;
  return round(Math.max(0, Math.min(100, raw)), 2);
}

function buildAmmDraft(candidate, runtime, options) {
  const yesPct = clamp(candidate.estimatedYesOdds, 15, 85);
  const distribution = buildDistributionParts(yesPct);
  return {
    question: candidate.question,
    rules: candidate.rules,
    sources: candidate.sources.map((source) => source.url),
    targetTimestamp: candidate.targetTimestamp,
    marketType: 'amm',
    category: candidate.categoryId,
    liquidityUsdc: Number(options.liquidityUsdc || DEFAULT_LIQUIDITY_USDC),
    distributionYes: distribution.distributionYes,
    distributionNo: distribution.distributionNo,
    feeTier: recommendFeeTier(candidate),
    maxImbalance: 16_777_215,
    minCloseLeadSeconds: Number(options.minCloseLeadSeconds) || 1800,
    chainId: runtime.chainId,
    rpcUrl: runtime.rpcUrl,
    oracle: runtime.oracle,
    factory: runtime.factory,
    usdc: runtime.usdc,
    arbiter: runtime.arbiter,
  };
}

function buildParimutuelDraft(candidate, runtime, options) {
  const curve = recommendCurveParams(candidate);
  const yesPct = clamp(candidate.estimatedYesOdds, 15, 85);
  const distribution = buildDistributionParts(yesPct);
  return {
    question: candidate.question,
    rules: candidate.rules,
    sources: candidate.sources.map((source) => source.url),
    targetTimestamp: candidate.targetTimestamp,
    marketType: 'parimutuel',
    category: candidate.categoryId,
    liquidityUsdc: Number(options.liquidityUsdc || DEFAULT_LIQUIDITY_USDC),
    distributionYes: distribution.distributionYes,
    distributionNo: distribution.distributionNo,
    curveFlattener: curve.curveFlattener,
    curveOffset: curve.curveOffset,
    minCloseLeadSeconds: Number(options.minCloseLeadSeconds) || 1800,
    chainId: runtime.chainId,
    rpcUrl: runtime.rpcUrl,
    oracle: runtime.oracle,
    factory: runtime.factory,
    usdc: runtime.usdc,
    arbiter: runtime.arbiter,
  };
}

async function loadExistingMarketQuestions(indexerUrl, timeoutMs, chainId) {
  const client = createIndexerClient(indexerUrl || DEFAULT_INDEXER_URL, timeoutMs);
  const page = await client.list({
    queryName: 'marketss',
    filterType: 'marketsFilter',
    fields: EXISTING_MARKET_FIELDS,
    variables: {
      where: chainId ? { chainId } : {},
      orderBy: 'createdAt',
      orderDirection: 'desc',
      limit: 200,
    },
  });
  const items = Array.isArray(page.items) ? page.items : [];
  const pollIds = Array.from(new Set(items.map((item) => String(item.pollAddress || '').trim()).filter(Boolean)));
  const polls = await client.getManyByIds({ queryName: 'polls', fields: EXISTING_POLL_FIELDS, ids: pollIds });
  return items
    .map((item) => {
      const poll = polls.get(String(item.pollAddress || '').trim()) || null;
      const question = poll && poll.question ? String(poll.question).trim() : '';
      if (!question) return null;
      return {
        marketAddress: item.id,
        pollAddress: item.pollAddress,
        marketType: item.marketType || null,
        question,
        category: poll && poll.category !== undefined ? poll.category : null,
      };
    })
    .filter(Boolean);
}

function scoreExistingMarketMatches(question, existingMarkets) {
  return (Array.isArray(existingMarkets) ? existingMarkets : [])
    .map((item) => {
      const similarity = questionSimilarityBreakdown(question, item.question);
      return {
        marketAddress: item.marketAddress,
        pollAddress: item.pollAddress,
        marketType: item.marketType,
        question: item.question,
        similarity,
      };
    })
    .sort((left, right) => Number(right.similarity.score || 0) - Number(left.similarity.score || 0))
    .slice(0, 5);
}

function buildRunHint(candidateId, marketType) {
  return `pandora --output json markets hype run --plan-file <path> --candidate-id ${candidateId} --market-type ${marketType} --dry-run`;
}

function normalizeCandidateSources(candidate) {
  return (Array.isArray(candidate && candidate.sources) ? candidate.sources : [])
    .map((source) => {
      if (!source || typeof source !== 'object') return null;
      const url = String(source.url || '').trim();
      if (!url) return null;
      return { ...source, url };
    })
    .filter(Boolean);
}

async function buildHypePlan(options = {}) {
  const planningNow = resolvePlanningNow(options.now);
  const planningNowSec = Math.floor(planningNow.getTime() / 1000);
  const runtime = buildRuntimeDefaults(options);
  const hypePromptPayload = buildAgentMarketHypePayload({
    area: options.area,
    region: options.region,
    query: options.query,
    marketType: options.marketType,
    candidateCount: options.candidateCount,
    now: options.now,
  });
  const research = await planHypeMarkets({
    area: options.area,
    region: options.region,
    query: options.query,
    marketType: options.marketType,
    candidateCount: options.candidateCount,
    searchDepth: options.searchDepth,
    now: options.now,
  }, {
    aiProvider: options.aiProvider,
    aiModel: options.aiModel,
    timeoutMs: options.timeoutMs,
    prompt: hypePromptPayload.prompt,
  });

  let existingMarkets = [];
  const diagnostics = [];
  try {
    existingMarkets = await loadExistingMarketQuestions(options.indexerUrl, options.timeoutMs, runtime.chainId);
  } catch (error) {
    diagnostics.push(`Existing-market dedupe probe failed: ${error && error.message ? error.message : String(error)}`);
  }

  const candidates = [];
  const rawCandidates = Array.isArray(research && research.candidates) ? research.candidates : [];
  for (const rawCandidate of rawCandidates) {
    const normalizedSources = normalizeCandidateSources(rawCandidate);
    if (!String(rawCandidate && rawCandidate.question || '').trim() || normalizedSources.length < 2) {
      diagnostics.push('Skipped malformed hype candidate returned by provider because it was missing a question or at least two sources.');
      continue;
    }
    const targetTimestamp = normalizeCandidateTimestamp(
      rawCandidate.suggestedResolutionDate,
      options.minCloseLeadSeconds,
      planningNowSec,
    );
    const targetIso = new Date(targetTimestamp * 1000).toISOString();
    const categoryId = categoryIdFromArea(options.area, rawCandidate.category);
    const matches = scoreExistingMarketMatches(rawCandidate.question, existingMarkets);
    const duplicateRiskScore = round((Number(matches[0] && matches[0].similarity && matches[0].similarity.score) || 0) * 100, 2);
    const tradingWindowHours = round(Math.max(1, (targetTimestamp - planningNowSec) / 3600), 2);
    const candidate = {
      ...rawCandidate,
      categoryId,
      categoryName: areaToCategoryName(options.area, rawCandidate.category),
      targetTimestamp,
      targetTimestampIso: targetIso,
      tradingWindowHours,
      duplicateRiskScore,
      duplicateMatches: matches,
      sources: normalizedSources,
    };
    candidate.recommendedMarketType = pickRecommendedMarketType(candidate, options.marketType);
    candidate.balanceScore = computeBalanceScore(candidate.estimatedYesOdds);
    candidate.overallHypeScore = computeOverallScore(candidate, duplicateRiskScore, candidate.recommendedMarketType);

    const requiredValidation = buildRequiredAgentMarketValidation({
      question: candidate.question,
      rules: candidate.rules,
      sources: candidate.sources.map((source) => source.url),
      targetTimestamp,
    });

    let validationResult;
    try {
      validationResult = await validateMarketDraft({
        question: candidate.question,
        rules: candidate.rules,
        sources: candidate.sources.map((source) => source.url),
        targetTimestamp,
      }, {
        aiProvider: options.aiProvider,
        aiModel: options.aiModel,
        timeoutMs: options.timeoutMs,
      });
    } catch (error) {
      validationResult = {
        provider: null,
        model: null,
        isResolvable: false,
        decision: 'FAIL',
        score: 0,
        summary: error && error.message ? error.message : 'Validation provider failed.',
        blockers: [
          {
            code: 'VALIDATION_PROVIDER_FAILED',
            message: error && error.message ? error.message : 'Validation provider failed.',
          },
        ],
        warnings: [],
        suggestedEdits: null,
        resolverSimulation: null,
      };
    }

    const attestation = validationResult.decision === 'PASS' && validationResult.isResolvable
      ? {
          validationTicket: requiredValidation.ticket,
          validationDecision: 'PASS',
          validationSummary: validationResult.summary,
        }
      : null;

    candidate.validation = {
      requiredValidation,
      validationResult,
      attestation,
    };
    candidate.marketDrafts = {
      amm: buildAmmDraft(candidate, runtime, options),
      parimutuel: buildParimutuelDraft(candidate, runtime, options),
    };
    candidate.draftIntegrity = {
      amm: buildDraftIntegrityHash(candidate.marketDrafts.amm),
      parimutuel: buildDraftIntegrityHash(candidate.marketDrafts.parimutuel),
    };
    candidate.readyToDeploy = Boolean(attestation) && duplicateRiskScore < DUPLICATE_THRESHOLD * 100;
    candidate.runHints = {
      recommended: buildRunHint(candidate.candidateId, candidate.recommendedMarketType),
      amm: buildRunHint(candidate.candidateId, 'amm'),
      parimutuel: buildRunHint(candidate.candidateId, 'parimutuel'),
    };

    candidates.push(candidate);
  }

  if (!candidates.length) {
    throw new Error('Hype planning did not produce any valid candidate markets after normalization.');
  }

  candidates.sort((left, right) => Number(right.overallHypeScore || 0) - Number(left.overallHypeScore || 0));
  const selectedCandidate = candidates.find((candidate) => candidate.readyToDeploy) || null;

  return {
    schemaVersion: '1.0.0',
    generatedAt: planningNow.toISOString(),
    mode: 'plan',
    area: options.area,
    region: options.region || null,
    query: options.query || null,
    provider: {
      name: research.provider,
      model: research.model,
      searchDepth: options.searchDepth,
    },
    runtimeDefaults: runtime,
    researchSnapshot: {
      summary: research.summary,
      searchQueries: research.searchQueries,
      sourceCount: candidates.reduce((total, candidate) => total + candidate.sources.length, 0),
      promptKind: hypePromptPayload.promptKind,
      promptVersion: hypePromptPayload.promptVersion,
    },
    candidates,
    selectedCandidateId: selectedCandidate ? selectedCandidate.candidateId : null,
    selectedCandidate,
    diagnostics,
    notes: [
      'markets.hype.plan freezes live research into a reusable plan payload so validation and deployment do not drift.',
      'Run markets.hype.run against this saved plan file, or pass the selected candidate into markets.create.run manually.',
      'Duplicate-risk scoring is advisory; review near-matches before execute mode if similarity is high.',
    ],
  };
}

function normalizePlanDocument(document) {
  const parsed = document && typeof document === 'object' ? document : null;
  if (!parsed) {
    throw new Error('Plan file does not contain a valid markets hype payload.');
  }
  if (parsed.ok && parsed.command === 'markets.hype.plan' && parsed.data && typeof parsed.data === 'object') {
    return parsed.data;
  }
  if (parsed.schemaVersion && Array.isArray(parsed.candidates)) {
    return parsed;
  }
  throw new Error('Plan file does not contain a valid markets hype payload.');
}

function readPlanFile(filePath) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, 'utf8');
  return normalizePlanDocument(JSON.parse(raw));
}

function selectCandidate(planData, candidateId) {
  const candidates = Array.isArray(planData && planData.candidates) ? planData.candidates : [];
  if (!candidates.length) {
    throw new Error('Plan payload does not contain any hype candidates.');
  }
  const matchCandidate = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return null;
    return candidates.find((candidate) => String(candidate && candidate.candidateId || '').trim() === normalized) || null;
  };
  if (candidateId) {
    const matched = matchCandidate(candidateId);
    if (!matched) {
      throw new Error(`No candidate found for id: ${candidateId}`);
    }
    return matched;
  }
  if (planData.selectedCandidateId) {
    const matched = matchCandidate(planData.selectedCandidateId);
    if (!matched) {
      throw new Error(`Plan payload selectedCandidateId does not match any saved candidate: ${planData.selectedCandidateId}`);
    }
    return matched;
  }
  if (planData.selectedCandidate && typeof planData.selectedCandidate === 'object') {
    const selectedCandidateId = String(planData.selectedCandidate.candidateId || '').trim();
    if (!selectedCandidateId) {
      throw new Error('Plan payload selectedCandidate is missing candidateId.');
    }
    const matched = matchCandidate(selectedCandidateId);
    if (!matched) {
      throw new Error(`Plan payload selectedCandidate does not match any saved candidate: ${selectedCandidateId}`);
    }
    return matched;
  }
  if (candidates.length === 1 && candidates[0] && candidates[0].readyToDeploy === true) {
    return candidates[0];
  }
  throw new Error('Plan payload does not identify a ready selected candidate. Pass --candidate-id explicitly or regenerate the plan.');
}

function resolveDraft(candidate, requestedMarketType) {
  const marketType = requestedMarketType === 'selected' ? candidate.recommendedMarketType : requestedMarketType;
  const draft = candidate.marketDrafts && candidate.marketDrafts[marketType] ? candidate.marketDrafts[marketType] : null;
  if (!draft) {
    throw new Error(`Candidate ${candidate.candidateId} does not contain a ${marketType} draft.`);
  }
  return { marketType, draft };
}

function assertFrozenValidationAttestation(candidate, requiredValidation, CliError) {
  const attestation = candidate
    && candidate.validation
    && candidate.validation.attestation
    && typeof candidate.validation.attestation === 'object'
      ? candidate.validation.attestation
      : null;

  const validationTicket = String(attestation && attestation.validationTicket || '').trim();
  const validationDecision = String(attestation && attestation.validationDecision || '').trim().toUpperCase();

  if (!validationTicket || validationDecision !== 'PASS') {
    throw new CliError(
      'MARKETS_HYPE_VALIDATION_REQUIRED',
      'markets hype run --execute requires a PASS validation attestation that matches the frozen plan payload.',
      { candidateId: candidate && candidate.candidateId ? candidate.candidateId : null, requiredValidation },
    );
  }

  if (validationTicket !== requiredValidation.ticket) {
    throw new CliError(
      'MARKETS_HYPE_VALIDATION_MISMATCH',
      'Stored hype-plan validation attestation does not match the exact selected draft payload. Regenerate the plan.',
      {
        candidateId: candidate && candidate.candidateId ? candidate.candidateId : null,
        expectedTicket: requiredValidation.ticket,
        receivedTicket: validationTicket,
      },
    );
  }

  return attestation;
}

function assertFrozenDraftIntegrity(candidate, marketType, draft, CliError) {
  const expected = candidate
    && candidate.draftIntegrity
    && typeof candidate.draftIntegrity === 'object'
    && candidate.draftIntegrity[marketType]
      ? String(candidate.draftIntegrity[marketType]).trim()
      : '';
  const actual = buildDraftIntegrityHash(draft);

  if (!expected) {
    throw new CliError(
      'MARKETS_HYPE_PLAN_INTEGRITY_MISSING',
      'Hype plan is missing frozen draft integrity metadata. Regenerate the plan before execute mode.',
      {
        candidateId: candidate && candidate.candidateId ? candidate.candidateId : null,
        marketType,
        actualDraftIntegrity: actual,
      },
    );
  }

  if (actual !== expected) {
    throw new CliError(
      'MARKETS_HYPE_PLAN_INTEGRITY_MISMATCH',
      'Stored hype-plan draft does not match the exact frozen deploy payload. Regenerate the plan.',
      {
        candidateId: candidate && candidate.candidateId ? candidate.candidateId : null,
        marketType,
        expectedDraftIntegrity: expected,
        actualDraftIntegrity: actual,
      },
    );
  }

  return actual;
}

function buildHypeHelp(commandHelpPayload) {
  const usage = [
    'pandora [--output table|json] markets hype plan --area <sports|esports|politics|regional-news|breaking-news> [--region <text>] [--query <text>] [--candidate-count <n>] [--market-type auto|amm|parimutuel|both] [--liquidity-usdc <n>] [--ai-provider auto|openai|anthropic|mock] [--ai-model <id>] [--search-depth fast|standard|deep] [--chain-id <id>] [--rpc-url <url>] [--oracle <address>] [--factory <address>] [--usdc <address>] [--arbiter <address>] [--min-close-lead-seconds <n>]',
    'pandora [--output table|json] markets hype run --plan-file <path> [--candidate-id <id>] [--market-type selected|amm|parimutuel] --dry-run|--execute [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--oracle <address>] [--factory <address>] [--usdc <address>] [--arbiter <address>]',
  ];
  const notes = [
    'markets hype researches fresh public-web topics, drafts high-interest markets, scores AMM vs pari-mutuel fit, and runs the final market through the validation prompt.',
    'Use agent market hype for prompt-only workflows when the agent itself will do the web research.',
    'When --area regional-news is selected, pass --region <text> so the research stays tied to the correct locality.',
    'markets hype plan requires a configured provider in auto|mock|openai|anthropic mode; if none is configured, use agent market hype instead.',
    'Save the JSON plan output before running markets hype run so the exact research snapshot and validation result remain frozen.',
    'Execute-mode MCP calls should pass the PASS attestation from the selected candidate validation back as agentPreflight.',
  ];
  return {
    command: 'markets.hype.help',
    payload: commandHelpPayload(usage, notes),
    table: { usage, notes },
  };
}

function createRunMarketsHypeCommand(deps) {
  const CliError = deps.CliError;
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseMarketsHypeFlags = requireDep(deps, 'parseMarketsHypeFlags');
  const deployPandoraMarket = requireDep(deps, 'deployPandoraMarket');
  const renderSingleEntityTable = requireDep(deps, 'renderSingleEntityTable');
  const assertLiveWriteAllowed = typeof deps.assertLiveWriteAllowed === 'function' ? deps.assertLiveWriteAllowed : null;

  if (typeof CliError !== 'function') {
    throw new Error('createRunMarketsHypeCommand requires deps.CliError.');
  }

  return async function runMarketsHypeCommand(args, context) {
    if (!Array.isArray(args) || !args.length || includesHelpFlag(args)) {
      const help = buildHypeHelp(commandHelpPayload);
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, help.command, help.payload);
      } else {
        console.log(`Usage: ${help.table.usage.join('\n       ')}`);
        console.log('');
        console.log('Notes:');
        for (const note of help.table.notes) {
          console.log(`- ${note}`);
        }
      }
      return;
    }

    const parsed = parseMarketsHypeFlags(args);
    const options = parsed.options || {};

    if (parsed.command === 'markets.hype.plan') {
      const payload = await buildHypePlan({
        ...options,
        indexerUrl: context.indexerUrl || DEFAULT_INDEXER_URL,
        timeoutMs: context.timeoutMs,
      });
      emitSuccess(context.outputMode, parsed.command, payload, renderSingleEntityTable);
      return;
    }

    if (parsed.command !== 'markets.hype.run') {
      throw new CliError('INVALID_ARGS', `Unsupported markets hype command: ${parsed.command}`);
    }

    const planData = readPlanFile(options.planFile);
    const candidate = selectCandidate(planData, options.candidateId);
    const { marketType, draft } = resolveDraft(candidate, options.marketType || 'selected');
    const validation = candidate.validation && typeof candidate.validation === 'object' ? candidate.validation : null;
    const storedRequiredValidation = validation && validation.requiredValidation ? validation.requiredValidation : null;
    const requiredValidation = buildRequiredAgentMarketValidation({
      question: draft.question,
      rules: draft.rules,
      sources: draft.sources,
      targetTimestamp: draft.targetTimestamp,
    });
    const validationResult = validation && validation.validationResult ? validation.validationResult : null;

    if (options.execute) {
      assertFrozenDraftIntegrity(candidate, marketType, draft, CliError);
      if (storedRequiredValidation && storedRequiredValidation.ticket && storedRequiredValidation.ticket !== requiredValidation.ticket) {
        throw new CliError(
          'MARKETS_HYPE_VALIDATION_MISMATCH',
          'Stored hype-plan validation ticket does not match the exact selected draft payload. Regenerate the plan.',
          {
            candidateId: candidate.candidateId,
            expectedTicket: requiredValidation.ticket,
            receivedTicket: storedRequiredValidation.ticket,
          },
        );
      }
      assertFrozenValidationAttestation(candidate, requiredValidation, CliError);
    }

    if (options.execute && (!validationResult || validationResult.decision !== 'PASS' || validationResult.isResolvable !== true)) {
      throw new CliError(
        'MARKETS_HYPE_VALIDATION_FAILED',
        'Selected hype candidate does not have a PASS resolvability result; execute mode is blocked.',
        { candidateId: candidate.candidateId, validation: validationResult },
      );
    }

    if (options.execute && candidate.readyToDeploy !== true) {
      throw new CliError(
        'MARKETS_HYPE_CANDIDATE_NOT_READY',
        'Selected hype candidate is not marked readyToDeploy; regenerate the plan or choose another validated candidate.',
        {
          candidateId: candidate.candidateId,
          duplicateRiskScore: candidate.duplicateRiskScore,
          readyToDeploy: candidate.readyToDeploy,
        },
      );
    }

    if (options.execute && assertLiveWriteAllowed) {
      await assertLiveWriteAllowed('markets.hype.run.execute', {
        notionalUsdc: draft.liquidityUsdc,
        runtimeMode: 'live',
      });
    }

    const deployment = await deployPandoraMarket({
      ...draft,
      execute: Boolean(options.execute),
      chainId: options.chainId || draft.chainId,
      rpcUrl: options.rpcUrl || draft.rpcUrl,
      privateKey: options.privateKey || null,
      profileId: options.profileId || null,
      profileFile: options.profileFile || null,
      oracle: options.oracle || draft.oracle,
      factory: options.factory || draft.factory,
      usdc: options.usdc || draft.usdc,
      arbiter: options.arbiter || draft.arbiter,
      agentPreflight: isMcpMode() ? undefined : (validation && validation.attestation ? validation.attestation : undefined),
      command: 'markets.hype.run',
      toolFamily: 'markets',
      source: 'markets.hype.run',
    });

    emitSuccess(
      context.outputMode,
      parsed.command,
      {
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        mode: options.execute ? 'execute' : 'dry-run',
        candidateId: candidate.candidateId,
        selectedMarketType: marketType,
        planFile: options.planFile,
        candidateHeadline: candidate.headline,
        hypeScore: candidate.overallHypeScore,
        duplicateRiskScore: candidate.duplicateRiskScore,
        requiredValidation,
        validationResult,
        deployment,
      },
      renderSingleEntityTable,
    );
  };
}

module.exports = {
  DUPLICATE_THRESHOLD,
  buildRuntimeDefaults,
  buildHypePlan,
  normalizePlanDocument,
  selectCandidate,
  resolveDraft,
  buildDraftIntegrityHash,
  assertFrozenValidationAttestation,
  assertFrozenDraftIntegrity,
  createRunMarketsHypeCommand,
};
