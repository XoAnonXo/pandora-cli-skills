const crypto = require('crypto');
const { createIndexerClient } = require('./indexer_client.cjs');
const { resolvePolymarketMarket } = require('./polymarket_trade_adapter.cjs');

const MIRROR_VERIFY_SCHEMA_VERSION = '1.0.0';

function toNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function round(value, decimals = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

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

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
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
    while (!rightMatches[rightIndex]) {
      rightIndex += 1;
    }
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
    if (a[i] === b[i]) {
      prefix += 1;
    } else {
      break;
    }
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

function normalizeProbabilityFromYesChance(value) {
  const raw = toNumber(value);
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

  const reserveYes = toNumber(market && market.reserveYes);
  const reserveNo = toNumber(market && market.reserveNo);
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
  const status = toNumber(poll && poll.status);

  return {
    marketAddress: market.id,
    chainId: toNumber(market.chainId),
    marketType: market.marketType || null,
    pollAddress: market.pollAddress || null,
    question: poll && poll.question ? String(poll.question) : null,
    rules: poll && poll.rules ? String(poll.rules) : null,
    status,
    active: status === 0,
    resolved: status !== 0 && status !== null,
    closeTimestamp: toNumber(market.marketCloseTimestamp) || toNumber(poll && poll.deadlineEpoch),
    yesPct,
    noPct,
    reserveYes: toNumber(market.reserveYes),
    reserveNo: toNumber(market.reserveNo),
    totalVolumeUsd: toNumber(market.totalVolume),
    tvlUsd: toNumber(market.currentTvl),
    diagnostics,
  };
}

function buildGateChecks({
  similarity,
  confidenceThreshold,
  ruleHashes,
  allowRuleMismatch,
  pandora,
  polymarket,
  strictCloseDiffSeconds,
}) {
  const checks = [];

  checks.push({
    code: 'MATCH_CONFIDENCE',
    ok: similarity.score >= confidenceThreshold,
    message: `Similarity ${similarity.score} must be >= ${confidenceThreshold}.`,
  });

  const bothRulesPresent = Boolean(ruleHashes.left && ruleHashes.right);
  const rulesEqual = bothRulesPresent ? ruleHashes.left === ruleHashes.right : false;
  const strictRuleCheckOk = bothRulesPresent && rulesEqual;
  checks.push({
    code: 'RULE_HASH_MATCH',
    ok: allowRuleMismatch ? true : strictRuleCheckOk,
    message: allowRuleMismatch
      ? 'Rule hash mismatch bypassed by --allow-rule-mismatch.'
      : bothRulesPresent
        ? 'Rule hashes must match.'
        : 'Rule text missing on one or both sides.',
    meta: {
      left: ruleHashes.left,
      right: ruleHashes.right,
      bothRulesPresent,
      rulesEqual: bothRulesPresent ? rulesEqual : null,
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

  return checks;
}

async function verifyMirrorPair(options = {}) {
  const diagnostics = [];

  const [pandora, polymarket] = await Promise.all([
    fetchPandoraMarketContext({
      indexerUrl: options.indexerUrl,
      timeoutMs: options.timeoutMs,
      marketAddress: options.pandoraMarketAddress,
    }),
    resolvePolymarketMarket({
      host: options.polymarketHost,
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
    ruleHashes: { left: leftRuleHash, right: rightRuleHash },
    allowRuleMismatch: Boolean(options.allowRuleMismatch),
    pandora,
    polymarket,
    strictCloseDiffSeconds: 2 * 60 * 60,
  });

  for (const item of pandora.diagnostics || []) diagnostics.push(item);
  for (const item of polymarket.diagnostics || []) diagnostics.push(item);

  const failed = checks.filter((check) => !check.ok).map((check) => check.code);

  return {
    schemaVersion: MIRROR_VERIFY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    matchConfidence: similarity.score,
    similarity,
    ruleHashLeft: leftRuleHash,
    ruleHashRight: rightRuleHash,
    ruleDiffSummary,
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
      status: toNumber(poll && poll.status),
      rules: poll && poll.rules ? String(poll.rules) : null,
      yesPct: derivePandoraYesPct(market),
      closeTimestamp: toNumber(market.marketCloseTimestamp),
      chainId: toNumber(market.chainId),
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
