const { createIndexerClient } = require('./indexer_client.cjs');
const { fetchPolymarketMarkets } = require('./polymarket_adapter.cjs');

const ARBITRAGE_SCHEMA_VERSION = '1.1.0';

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

function toUsdc(raw) {
  const numeric = toNumber(raw);
  if (numeric === null) return null;
  return round(numeric / 1_000_000, 6);
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

function jaroDistance(s1, s2) {
  const a = String(s1 || '');
  const b = String(s2 || '');
  if (a === b) return 1;
  const maxDist = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    const start = Math.max(0, i - maxDist);
    const end = Math.min(i + maxDist + 1, b.length);
    for (let j = start; j < end; j += 1) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches += 1;
      break;
    }
  }

  if (!matches) return 0;

  let t = 0;
  let j = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aMatches[i]) continue;
    while (!bMatches[j]) j += 1;
    if (a[i] !== b[j]) t += 1;
    j += 1;
  }

  const transpositions = t / 2;
  return (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;
}

function jaroWinkler(a, b) {
  const jaro = jaroDistance(a, b);
  let prefix = 0;
  const s1 = String(a || '');
  const s2 = String(b || '');
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i += 1) {
    if (s1[i] === s2[i]) prefix += 1;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

function questionSimilarityBreakdown(a, b) {
  const normalizedLeft = normalizeQuestion(a);
  const normalizedRight = normalizeQuestion(b);
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

function questionSimilarity(a, b) {
  return questionSimilarityBreakdown(a, b).score;
}

function toYesProbabilityFromYesChance(rawYesChance) {
  const raw = toNumber(rawYesChance);
  if (raw === null) return null;
  if (raw >= 0 && raw <= 1) return raw;
  if (raw > 1 && raw <= 100) return raw / 100;
  return raw / 1_000_000_000;
}

function derivePandoraYesNo(market) {
  const yesFromChance = toYesProbabilityFromYesChance(market && market.yesChance);
  if (yesFromChance !== null && yesFromChance >= 0 && yesFromChance <= 1) {
    return {
      yesPct: round(yesFromChance * 100, 6),
      noPct: round((1 - yesFromChance) * 100, 6),
      source: 'pandora:yesChance',
    };
  }

  const reserveYes = toNumber(market && market.reserveYes);
  const reserveNo = toNumber(market && market.reserveNo);
  if (reserveYes === null || reserveNo === null) {
    return { yesPct: null, noPct: null, source: 'pandora:unavailable' };
  }
  const total = reserveYes + reserveNo;
  if (!Number.isFinite(total) || total <= 0) {
    return { yesPct: null, noPct: null, source: 'pandora:invalid-reserves' };
  }

  const yesProb = reserveNo / total;
  return {
    yesPct: round(yesProb * 100, 6),
    noPct: round((1 - yesProb) * 100, 6),
    source: 'pandora:reserves',
  };
}

function normalizeId(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase();
  return text || null;
}

function normalizeSources(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry || '').trim()).filter(Boolean);
      }
    } catch {
      // fall through to text splitting
    }
    return text
      .split(/[\n,]/g)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

async function fetchPandoraPollDetails(client, pollIds, diagnostics) {
  const baseFields = ['id', 'question', 'status', 'deadlineEpoch', 'resolvedAt'];
  const extendedFields = [...baseFields, 'rules', 'sources'];
  try {
    return await client.getManyByIds({
      queryName: 'polls',
      fields: extendedFields,
      ids: pollIds,
    });
  } catch (err) {
    diagnostics.push(
      `Pandora poll rule metadata unavailable from indexer; using question-only poll fields (${err && err.message ? err.message : String(err)}).`,
    );
    return client.getManyByIds({
      queryName: 'polls',
      fields: baseFields,
      ids: pollIds,
    });
  }
}

async function fetchPandoraLegs(options, diagnostics) {
  const client = createIndexerClient(options.indexerUrl, options.timeoutMs);
  const page = await client.list({
    queryName: 'marketss',
    filterType: 'marketsFilter',
    fields: [
      'id',
      'marketType',
      'chainId',
      'pollAddress',
      'marketCloseTimestamp',
      'yesChance',
      'reserveYes',
      'reserveNo',
      'totalVolume',
      'currentTvl',
    ],
    variables: {
      where: {
        ...(options.chainId !== null && options.chainId !== undefined ? { chainId: options.chainId } : {}),
      },
      orderBy: 'createdAt',
      orderDirection: 'desc',
      before: null,
      after: null,
      limit: Math.max(options.limit * 3, 100),
    },
  });

  const pollIds = Array.from(new Set((page.items || []).map((item) => normalizeId(item && item.pollAddress)).filter(Boolean)));
  const pollsById = await fetchPandoraPollDetails(client, pollIds, diagnostics);

  const legs = [];
  for (const market of page.items || []) {
    const poll = pollsById.get(normalizeId(market && market.pollAddress));
    const question = poll && poll.question ? poll.question : null;
    if (!question) continue;
    if (options.questionContains && !question.toLowerCase().includes(options.questionContains.toLowerCase())) {
      continue;
    }

    const odds = derivePandoraYesNo(market);
    legs.push({
      legId: `pandora:${String(market.id || '')}`,
      venue: 'pandora',
      marketId: market.id,
      question,
      closeTimestamp: toNumber(market.marketCloseTimestamp),
      yesPct: odds.yesPct,
      noPct: odds.noPct,
      liquidityUsd: toUsdc(market.currentTvl),
      volumeUsd: toUsdc(market.totalVolume),
      url: null,
      oddsSource: odds.source,
      diagnostics: [],
      chainId: market.chainId,
      marketType: market.marketType,
      pollAddress: market.pollAddress,
      pollStatus: toNumber(poll && poll.status),
      rules: poll && poll.rules ? String(poll.rules) : null,
      sources: normalizeSources(poll && poll.sources),
    });
  }

  return legs;
}

function buildGroups(legs, options) {
  const parent = new Map();
  const acceptedPairChecks = new Map();
  const makePairKey = (a, b) => [a, b].sort().join('|');
  const find = (x) => {
    const p = parent.get(x);
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  for (let index = 0; index < legs.length; index += 1) {
    const leg = legs[index];
    if (!leg.legId) {
      leg.legId = `${leg.venue}:${String(leg.marketId || 'unknown')}:${index}`;
    }
    parent.set(leg.legId, leg.legId);
  }

  for (let i = 0; i < legs.length; i += 1) {
    for (let j = i + 1; j < legs.length; j += 1) {
      const left = legs[i];
      const right = legs[j];

      if (options.crossVenueOnly && left.venue === right.venue) continue;

      const similarity = questionSimilarityBreakdown(left.question, right.question);
      if (similarity.score < options.similarityThreshold) continue;

      let closeDiffHours = null;
      if (left.closeTimestamp && right.closeTimestamp) {
        closeDiffHours = Math.abs(left.closeTimestamp - right.closeTimestamp) / 3600;
        if (closeDiffHours > options.maxCloseDiffHours) continue;
      }

      union(left.legId, right.legId);
      acceptedPairChecks.set(makePairKey(left.legId, right.legId), {
        leftLegId: left.legId,
        rightLegId: right.legId,
        leftVenue: left.venue,
        rightVenue: right.venue,
        leftMarketId: left.marketId,
        rightMarketId: right.marketId,
        leftQuestion: left.question,
        rightQuestion: right.question,
        normalizedLeft: similarity.normalizedLeft,
        normalizedRight: similarity.normalizedRight,
        similarityScore: similarity.score,
        tokenScore: similarity.tokenScore,
        jaroWinkler: similarity.jaroWinkler,
        closeDiffHours: closeDiffHours === null ? null : round(closeDiffHours, 6),
      });
    }
  }

  const grouped = new Map();
  for (const leg of legs) {
    const root = find(leg.legId);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(leg);
  }

  return {
    groups: Array.from(grouped.values()).filter((group) => group.length >= 2),
    acceptedPairChecks,
  };
}

function buildGroupPairChecks(group, options, acceptedPairChecks) {
  const out = [];
  const makePairKey = (a, b) => [a, b].sort().join('|');
  for (let i = 0; i < group.length; i += 1) {
    for (let j = i + 1; j < group.length; j += 1) {
      const left = group[i];
      const right = group[j];
      const similarity = questionSimilarityBreakdown(left.question, right.question);
      let closeDiffHours = null;
      if (left.closeTimestamp && right.closeTimestamp) {
        closeDiffHours = Math.abs(left.closeTimestamp - right.closeTimestamp) / 3600;
      }
      const accepted = acceptedPairChecks.has(makePairKey(left.legId, right.legId));
      out.push({
        leftLegId: left.legId,
        rightLegId: right.legId,
        leftVenue: left.venue,
        rightVenue: right.venue,
        leftMarketId: left.marketId,
        rightMarketId: right.marketId,
        leftQuestion: left.question,
        rightQuestion: right.question,
        normalizedLeft: similarity.normalizedLeft,
        normalizedRight: similarity.normalizedRight,
        similarityScore: similarity.score,
        tokenScore: similarity.tokenScore,
        jaroWinkler: similarity.jaroWinkler,
        closeDiffHours: closeDiffHours === null ? null : round(closeDiffHours, 6),
        passesSimilarity: similarity.score >= options.similarityThreshold,
        passesCloseWindow: closeDiffHours === null ? true : closeDiffHours <= options.maxCloseDiffHours,
        passesVenueRule: options.crossVenueOnly ? left.venue !== right.venue : true,
        accepted,
      });
    }
  }
  return out;
}

function summarizeGroup(group, options, acceptedPairChecks) {
  const venues = Array.from(new Set(group.map((leg) => leg.venue))).sort();
  if (options.crossVenueOnly && venues.length < 2) {
    return null;
  }

  const yesValues = group.map((leg) => toNumber(leg.yesPct)).filter((value) => value !== null);
  const noValues = group.map((leg) => toNumber(leg.noPct)).filter((value) => value !== null);
  if (!yesValues.length || !noValues.length) {
    return null;
  }

  const minYes = Math.min(...yesValues);
  const maxYes = Math.max(...yesValues);
  const minNo = Math.min(...noValues);
  const maxNo = Math.max(...noValues);

  const spreadYes = round(maxYes - minYes, 6);
  const spreadNo = round(maxNo - minNo, 6);
  if (Math.max(spreadYes, spreadNo) < options.minSpreadPct) {
    return null;
  }

  const bestYesBuy = group.find((leg) => Number(leg.yesPct) === minYes) || null;
  const bestNoBuy = group.find((leg) => Number(leg.noPct) === minNo) || null;

  const closeTimestamps = group.map((leg) => toNumber(leg.closeTimestamp)).filter((value) => value !== null);
  const minClose = closeTimestamps.length ? Math.min(...closeTimestamps) : null;
  const maxClose = closeTimestamps.length ? Math.max(...closeTimestamps) : null;

  const riskFlags = [];
  const knownLiquidity = group.map((leg) => toNumber(leg.liquidityUsd)).filter((value) => value !== null);
  if (knownLiquidity.length && Math.min(...knownLiquidity) < options.minLiquidityUsd) {
    riskFlags.push('LOW_LIQUIDITY');
  }
  if (!knownLiquidity.length) {
    riskFlags.push('UNKNOWN_LIQUIDITY');
  }
  if (venues.length < 2) {
    riskFlags.push('SINGLE_VENUE_GROUP');
  }

  const labels = group.flatMap((leg) => leg.diagnostics || []);
  if (labels.length) riskFlags.push('NON_STANDARD_MARKET_MAPPING');

  if (minClose !== null && maxClose !== null) {
    const diffHours = Math.abs(maxClose - minClose) / 3600;
    if (diffHours > options.maxCloseDiffHours / 2) {
      riskFlags.push('CLOSE_TIME_DRIFT');
    }
  }

  const pairChecks = buildGroupPairChecks(group, options, acceptedPairChecks);
  const crossVenueChecks = pairChecks.filter((pair) => pair.leftVenue !== pair.rightVenue);
  const comparisonSet = crossVenueChecks.length ? crossVenueChecks : pairChecks;
  const minPairSimilarity = comparisonSet.length
    ? Math.min(...comparisonSet.map((pair) => toNumber(pair.similarityScore)).filter((value) => value !== null))
    : null;
  if (minPairSimilarity !== null && minPairSimilarity < options.similarityThreshold) {
    riskFlags.push('TRANSITIVE_MATCH_GAP');
  }

  let confidence = 1;
  if (riskFlags.includes('LOW_LIQUIDITY')) confidence -= 0.2;
  if (riskFlags.includes('UNKNOWN_LIQUIDITY')) confidence -= 0.1;
  if (riskFlags.includes('CLOSE_TIME_DRIFT')) confidence -= 0.1;
  if (riskFlags.includes('NON_STANDARD_MARKET_MAPPING')) confidence -= 0.15;
  if (riskFlags.includes('TRANSITIVE_MATCH_GAP')) confidence -= 0.15;
  if (riskFlags.includes('SINGLE_VENUE_GROUP')) confidence -= 0.1;
  confidence = round(Math.max(0, Math.min(1, confidence)), 4);

  const sortedQuestions = group.map((leg) => normalizeQuestion(leg.question)).filter(Boolean).sort();
  const normalizedQuestion = sortedQuestions[0] || '';
  const groupId = `arb_${Buffer.from(normalizedQuestion).toString('base64').replace(/[^a-z0-9]/gi, '').slice(0, 18)}`;

  return {
    groupId,
    normalizedQuestion,
    closeTimeWindow: {
      min: minClose,
      max: maxClose,
    },
    spreadYesPct: spreadYes,
    spreadNoPct: spreadNo,
    venues,
    bestYesBuy: bestYesBuy
      ? {
          venue: bestYesBuy.venue,
          marketId: bestYesBuy.marketId,
          yesPct: bestYesBuy.yesPct,
          url: bestYesBuy.url,
        }
      : null,
    bestNoBuy: bestNoBuy
      ? {
          venue: bestNoBuy.venue,
          marketId: bestNoBuy.marketId,
          noPct: bestNoBuy.noPct,
          url: bestNoBuy.url,
        }
      : null,
    confidenceScore: confidence,
    riskFlags: Array.from(new Set(riskFlags)),
    matchSummary: {
      similarityThreshold: options.similarityThreshold,
      minPairSimilarity,
      pairCount: pairChecks.length,
      crossVenuePairCount: crossVenueChecks.length,
    },
    similarityChecks: options.includeSimilarity ? pairChecks : undefined,
    legs: group.map((leg) => ({
      venue: leg.venue,
      marketId: leg.marketId,
      url: leg.url,
      question: leg.question,
      closeTimestamp: leg.closeTimestamp,
      yesPct: leg.yesPct,
      noPct: leg.noPct,
      liquidityUsd: leg.liquidityUsd,
      volumeUsd: leg.volumeUsd,
      oddsSource: leg.oddsSource,
      diagnostics: leg.diagnostics,
      rules: options.withRules ? leg.rules || null : undefined,
      sources: options.withRules ? (Array.isArray(leg.sources) ? leg.sources : []) : undefined,
      pollStatus: options.withRules ? leg.pollStatus : undefined,
    })),
  };
}

async function scanArbitrage(options) {
  const venues = Array.from(new Set((options.venues || ['pandora', 'polymarket']).map((value) => String(value).toLowerCase())));

  const sources = {};
  const allLegs = [];
  const diagnostics = [];
  if (options.crossVenueOnly && venues.length < 2) {
    diagnostics.push('cross-venue-only is enabled but fewer than two venues were selected; no opportunities will match.');
  }

  if (venues.includes('pandora')) {
    try {
      const pandoraLegs = await fetchPandoraLegs(options, diagnostics);
      allLegs.push(...pandoraLegs);
      sources.pandora = {
        indexerUrl: options.indexerUrl,
        count: pandoraLegs.length,
        ok: true,
      };
    } catch (err) {
      sources.pandora = {
        indexerUrl: options.indexerUrl,
        count: 0,
        ok: false,
        error: err && err.message ? err.message : String(err),
      };
      diagnostics.push(`Pandora source failed: ${sources.pandora.error}`);
    }
  }

  if (venues.includes('polymarket')) {
    try {
      const poly = await fetchPolymarketMarkets({
        host: options.polymarketHost,
        mockUrl: options.polymarketMockUrl,
        timeoutMs: options.timeoutMs,
        limit: Math.max(options.limit * 3, 100),
      });

      const filtered = poly.items.filter((item) => {
        if (!item.question) return false;
        if (options.questionContains && !item.question.toLowerCase().includes(options.questionContains.toLowerCase())) {
          return false;
        }
        return true;
      });

      allLegs.push(...filtered);
      sources.polymarket = {
        host: poly.host,
        source: poly.source,
        count: filtered.length,
        ok: true,
      };
    } catch (err) {
      sources.polymarket = {
        host: options.polymarketHost || null,
        source: options.polymarketMockUrl ? 'polymarket:mock' : 'polymarket:clob',
        count: 0,
        ok: false,
        error: err && err.message ? err.message : String(err),
      };
      diagnostics.push(`Polymarket source failed: ${sources.polymarket.error}`);
    }
  }

  if (!allLegs.length) {
    return {
      schemaVersion: ARBITRAGE_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      parameters: {
        chainId: options.chainId,
        venues,
        limit: options.limit,
        minSpreadPct: options.minSpreadPct,
        minLiquidityUsd: options.minLiquidityUsd,
        maxCloseDiffHours: options.maxCloseDiffHours,
        similarityThreshold: options.similarityThreshold,
        crossVenueOnly: options.crossVenueOnly,
        withRules: options.withRules,
        includeSimilarity: options.includeSimilarity,
        questionContains: options.questionContains,
      },
      sources,
      diagnostics,
      count: 0,
      opportunities: [],
    };
  }

  const grouped = buildGroups(allLegs, options);
  const opportunities = grouped.groups
    .map((group) => summarizeGroup(group, options, grouped.acceptedPairChecks))
    .filter(Boolean)
    .sort((a, b) => {
      const left = Math.max(a.spreadYesPct || 0, a.spreadNoPct || 0);
      const right = Math.max(b.spreadYesPct || 0, b.spreadNoPct || 0);
      return right - left;
    })
    .slice(0, options.limit);

  return {
    schemaVersion: ARBITRAGE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    parameters: {
      chainId: options.chainId,
      venues,
      limit: options.limit,
      minSpreadPct: options.minSpreadPct,
      minLiquidityUsd: options.minLiquidityUsd,
      maxCloseDiffHours: options.maxCloseDiffHours,
      similarityThreshold: options.similarityThreshold,
      crossVenueOnly: options.crossVenueOnly,
      withRules: options.withRules,
      includeSimilarity: options.includeSimilarity,
      questionContains: options.questionContains,
    },
    sources,
    diagnostics,
    count: opportunities.length,
    opportunities,
  };
}

module.exports = {
  ARBITRAGE_SCHEMA_VERSION,
  normalizeQuestion,
  questionSimilarity,
  scanArbitrage,
};
