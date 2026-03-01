const crypto = require('crypto');
const { createIndexerClient } = require('./indexer_client.cjs');
const { resolvePolymarketMarket } = require('./polymarket_trade_adapter.cjs');
const { questionSimilarityBreakdown } = require('./similarity_service.cjs');
const { round, toOptionalNumber } = require('./shared/utils.cjs');

const MIRROR_VERIFY_SCHEMA_VERSION = '1.0.0';
const USDC_DECIMALS = 6;

function normalizeUsdcRawToUsd(value) {
  const numeric = toOptionalNumber(value);
  if (numeric === null) return null;
  return round(numeric / (10 ** USDC_DECIMALS), 6);
}

function normalizeProbabilityFromYesChance(value) {
  const raw = toOptionalNumber(value);
  if (raw === null) return null;
  if (raw >= 0 && raw <= 1) return raw;
  if (raw > 1 && raw <= 100) return raw / 100;
  return raw / 1_000_000_000;
}

function derivePandoraYesPct(market) {
  const yesFromChance = normalizeProbabilityFromYesChance(market && market.yesChance);
  if (yesFromChance !== null && yesFromChance >= 0 && yesFromChance <= 1) {
    return round(yesFromChance * 100, 6);
  }

  const reserveYes = normalizeUsdcRawToUsd(market && market.reserveYes);
  const reserveNo = normalizeUsdcRawToUsd(market && market.reserveNo);
  if (reserveYes === null || reserveNo === null) return null;

  const total = reserveYes + reserveNo;
  if (!Number.isFinite(total) || total <= 0) return null;

  return round((reserveNo / total) * 100, 6);
}

function normalizeRulesText(rules) {
  return String(rules || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hashRules(rules) {
  const normalized = normalizeRulesText(rules);
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function buildRuleDiffSummary(leftRules, rightRules) {
  const left = normalizeRulesText(leftRules);
  const right = normalizeRulesText(rightRules);

  if (!left && !right) {
    return {
      equal: true,
      leftWordCount: 0,
      rightWordCount: 0,
      overlapRatio: 1,
      diagnostics: ['Both sides missing explicit rule text.'],
    };
  }

  const leftWords = new Set(left.split(' ').filter(Boolean));
  const rightWords = new Set(right.split(' ').filter(Boolean));

  let overlap = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) overlap += 1;
  }

  const denominator = Math.max(leftWords.size, rightWords.size, 1);
  const overlapRatio = overlap / denominator;

  const diagnostics = [];
  if (overlapRatio < 0.5) {
    diagnostics.push('Low lexical overlap between Pandora rules and source rules.');
  }

  return {
    equal: left === right,
    leftWordCount: leftWords.size,
    rightWordCount: rightWords.size,
    overlapRatio: round(overlapRatio, 6),
    diagnostics,
  };
}

async function fetchPandoraPoll(client, pollAddress, diagnostics) {
  if (!pollAddress) return null;

  try {
    return await client.getById({
      queryName: 'polls',
      fields: ['id', 'question', 'status', 'deadlineEpoch', 'resolvedAt', 'rules', 'sources'],
      id: pollAddress,
    });
  } catch (err) {
    diagnostics.push(
      `Poll rules metadata unavailable from indexer; falling back to question/status fields (${err && err.message ? err.message : String(err)}).`,
    );
    return client.getById({
      queryName: 'polls',
      fields: ['id', 'question', 'status', 'deadlineEpoch', 'resolvedAt'],
      id: pollAddress,
    });
  }
}

async function fetchPandoraMarketContext(options = {}) {
  const diagnostics = [];
  const client = createIndexerClient(options.indexerUrl, options.timeoutMs);

  const market = await client.getById({
    queryName: 'markets',
    fields: [
      'id',
      'chainId',
      'marketType',
      'pollAddress',
      'marketCloseTimestamp',
      'yesChance',
      'reserveYes',
      'reserveNo',
      'totalVolume',
      'currentTvl',
    ],
    id: options.marketAddress,
  });

  if (!market) {
    throw new Error(`Pandora market not found: ${options.marketAddress}`);
  }

  const poll = await fetchPandoraPoll(client, market.pollAddress, diagnostics);
  const yesPct = derivePandoraYesPct(market);
  const noPct = yesPct === null ? null : round(100 - yesPct, 6);
  const status = toOptionalNumber(poll && poll.status);

  return {
    marketAddress: market.id,
    chainId: toOptionalNumber(market.chainId),
    marketType: market.marketType || null,
    pollAddress: market.pollAddress || null,
    question: poll && poll.question ? String(poll.question) : null,
    rules: poll && poll.rules ? String(poll.rules) : null,
    status,
    active: status === 0,
    resolved: status !== 0 && status !== null,
    closeTimestamp: toOptionalNumber(market.marketCloseTimestamp) || toOptionalNumber(poll && poll.deadlineEpoch),
    yesPct,
    noPct,
    reserveYes: normalizeUsdcRawToUsd(market.reserveYes),
    reserveNo: normalizeUsdcRawToUsd(market.reserveNo),
    totalVolumeUsd: toOptionalNumber(market.totalVolume),
    tvlUsd: toOptionalNumber(market.currentTvl),
    diagnostics,
  };
}

function buildGateChecks({
  similarity,
  confidenceThreshold,
  trustDeploy,
  ruleHashes,
  allowRuleMismatch,
  pandora,
  polymarket,
  strictCloseDiffSeconds,
  nowSec,
}) {
  const checks = [];

  checks.push({
    code: 'MATCH_CONFIDENCE',
    ok: trustDeploy ? true : similarity.score >= confidenceThreshold,
    message: trustDeploy
      ? 'Similarity check bypassed by trusted deploy pairing.'
      : `Similarity ${similarity.score} must be >= ${confidenceThreshold}.`,
    meta: {
      trustDeploy: Boolean(trustDeploy),
    },
  });

  const bothRulesPresent = Boolean(ruleHashes.left && ruleHashes.right);
  const rulesEqual = bothRulesPresent ? ruleHashes.left === ruleHashes.right : false;
  const strictRuleCheckOk = bothRulesPresent && rulesEqual;
  checks.push({
    code: 'RULE_HASH_MATCH',
    ok: trustDeploy ? true : allowRuleMismatch ? true : strictRuleCheckOk,
    message: trustDeploy
      ? 'Rule hash mismatch bypassed by trusted deploy pairing.'
      : allowRuleMismatch
        ? 'Rule hash mismatch bypassed by --allow-rule-mismatch.'
        : bothRulesPresent
          ? 'Rule hashes must match.'
          : 'Rule text missing on one or both sides.',
    meta: {
      left: ruleHashes.left,
      right: ruleHashes.right,
      bothRulesPresent,
      rulesEqual: bothRulesPresent ? rulesEqual : null,
      trustDeploy: Boolean(trustDeploy),
    },
  });

  checks.push({
    code: 'LIFECYCLE_ACTIVE',
    ok: Boolean(pandora.active) && Boolean(polymarket.active) && !Boolean(polymarket.resolved),
    message: 'Both Pandora and Polymarket markets must be active/unresolved.',
  });

  const closeDeltaSeconds =
    Number.isFinite(pandora.closeTimestamp) && Number.isFinite(polymarket.closeTimestamp)
      ? Math.abs(pandora.closeTimestamp - polymarket.closeTimestamp)
      : null;

  checks.push({
    code: 'CLOSE_TIME_DELTA',
    ok: closeDeltaSeconds === null ? true : closeDeltaSeconds <= strictCloseDiffSeconds,
    message: `Close-time delta must be <= ${strictCloseDiffSeconds} seconds.`,
    meta: {
      closeDeltaSeconds,
    },
  });

  const pandoraTte = Number.isFinite(pandora.closeTimestamp) ? pandora.closeTimestamp - nowSec : null;
  const polymarketTte = Number.isFinite(polymarket.closeTimestamp) ? polymarket.closeTimestamp - nowSec : null;
  const minTte = [pandoraTte, polymarketTte].filter((value) => Number.isFinite(value));
  const minTimeToExpirySec = minTte.length ? Math.min(...minTte) : null;
  checks.push({
    code: 'NOT_EXPIRED',
    ok: minTimeToExpirySec === null ? true : minTimeToExpirySec > 0,
    message: 'Both markets must remain open (not expired).',
    meta: {
      pandoraTimeToExpirySec: pandoraTte,
      sourceTimeToExpirySec: polymarketTte,
      minTimeToExpirySec,
    },
  });

  return checks;
}

async function verifyMirrorPair(options = {}) {
  const diagnostics = [];
  const nowSec = Number.isFinite(Number(options.nowSec)) ? Number(options.nowSec) : Math.floor(Date.now() / 1000);

  const [pandora, polymarket] = await Promise.all([
    fetchPandoraMarketContext({
      indexerUrl: options.indexerUrl,
      timeoutMs: options.timeoutMs,
      marketAddress: options.pandoraMarketAddress,
    }),
    resolvePolymarketMarket({
      host: options.polymarketHost,
      gammaUrl: options.polymarketGammaUrl,
      gammaMockUrl: options.polymarketGammaMockUrl,
      mockUrl: options.polymarketMockUrl,
      timeoutMs: options.timeoutMs,
      marketId: options.polymarketMarketId,
      slug: options.polymarketSlug,
    }),
  ]);

  const similarity = questionSimilarityBreakdown(pandora.question, polymarket.question);
  const leftRuleHash = hashRules(pandora.rules);
  const rightRuleHash = hashRules(polymarket.description);
  const ruleDiffSummary = buildRuleDiffSummary(pandora.rules, polymarket.description);

  const checks = buildGateChecks({
    similarity,
    confidenceThreshold: options.confidenceThreshold || 0.92,
    trustDeploy: Boolean(options.trustDeploy),
    ruleHashes: { left: leftRuleHash, right: rightRuleHash },
    allowRuleMismatch: Boolean(options.allowRuleMismatch),
    pandora,
    polymarket,
    strictCloseDiffSeconds: 2 * 60 * 60,
    nowSec,
  });

  for (const item of pandora.diagnostics || []) diagnostics.push(item);
  for (const item of polymarket.diagnostics || []) diagnostics.push(item);

  const pandoraTimeToExpirySec = Number.isFinite(pandora.closeTimestamp) ? pandora.closeTimestamp - nowSec : null;
  const sourceTimeToExpirySec = Number.isFinite(polymarket.closeTimestamp) ? polymarket.closeTimestamp - nowSec : null;
  const minTimeCandidates = [pandoraTimeToExpirySec, sourceTimeToExpirySec].filter((value) => Number.isFinite(value));
  const minTimeToExpirySec = minTimeCandidates.length ? Math.min(...minTimeCandidates) : null;
  if (minTimeToExpirySec !== null && minTimeToExpirySec < 3600) {
    diagnostics.push(`Mirror pair expires soon (${minTimeToExpirySec}s).`);
  }

  const failed = checks.filter((check) => !check.ok).map((check) => check.code);

  return {
    schemaVersion: MIRROR_VERIFY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    matchConfidence: similarity.score,
    similarity,
    ruleHashLeft: leftRuleHash,
    ruleHashRight: rightRuleHash,
    ruleDiffSummary,
    expiry: {
      nowSec,
      pandoraTimeToExpirySec,
      sourceTimeToExpirySec,
      minTimeToExpirySec,
      warnThresholdSec: 3600,
      warn: minTimeToExpirySec !== null ? minTimeToExpirySec < 3600 : false,
    },
    gateResult: {
      ok: failed.length === 0,
      failedChecks: failed,
      checks,
    },
    pandora,
    sourceMarket: polymarket,
    similarityChecks: options.includeSimilarity ? [similarity] : undefined,
    diagnostics,
  };
}

async function findBestPandoraMatch(options = {}) {
  const diagnostics = [];
  const client = createIndexerClient(options.indexerUrl, options.timeoutMs);

  const page = await client.list({
    queryName: 'marketss',
    filterType: 'marketsFilter',
    fields: ['id', 'chainId', 'marketType', 'pollAddress', 'marketCloseTimestamp', 'yesChance', 'reserveYes', 'reserveNo'],
    variables: {
      where: {
        ...(options.chainId !== null && options.chainId !== undefined ? { chainId: options.chainId } : {}),
      },
      orderBy: 'createdAt',
      orderDirection: 'desc',
      before: null,
      after: null,
      limit: Math.max(25, Math.min(Number(options.limit) || 150, 500)),
    },
  });

  const markets = Array.isArray(page.items) ? page.items : [];
  const pollIds = Array.from(
    new Set(
      markets
        .map((market) => String(market && market.pollAddress ? market.pollAddress : '').trim())
        .filter(Boolean),
    ),
  );

  const pollsMap = await client.getManyByIds({
    queryName: 'polls',
    fields: ['id', 'question', 'status', 'deadlineEpoch', 'rules'],
    ids: pollIds,
  });

  const rows = [];
  for (const market of markets) {
    const poll = pollsMap.get(String(market.pollAddress || '').toLowerCase()) || pollsMap.get(String(market.pollAddress || ''));
    const question = poll && poll.question ? String(poll.question) : null;
    if (!question) continue;

    const similarity = questionSimilarityBreakdown(options.sourceQuestion, question);
    rows.push({
      marketAddress: market.id,
      pollAddress: market.pollAddress,
      question,
      similarity,
      status: toOptionalNumber(poll && poll.status),
      rules: poll && poll.rules ? String(poll.rules) : null,
      yesPct: derivePandoraYesPct(market),
      closeTimestamp: toOptionalNumber(market.marketCloseTimestamp),
      chainId: toOptionalNumber(market.chainId),
      marketType: market.marketType || null,
    });
  }

  rows.sort((a, b) => (b.similarity.score || 0) - (a.similarity.score || 0));
  const best = rows[0] || null;
  if (!best) diagnostics.push('No Pandora candidate markets with poll questions were found.');

  return {
    generatedAt: new Date().toISOString(),
    best,
    candidateCount: rows.length,
    diagnostics,
  };
}

module.exports = {
  MIRROR_VERIFY_SCHEMA_VERSION,
  normalizeRulesText,
  hashRules,
  buildRuleDiffSummary,
  questionSimilarityBreakdown,
  fetchPandoraMarketContext,
  verifyMirrorPair,
  findBestPandoraMatch,
};
