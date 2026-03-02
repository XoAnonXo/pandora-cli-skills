const { createIndexerClient } = require('./indexer_client.cjs');
const { fetchPolymarketMarkets } = require('./polymarket_adapter.cjs');
const {
  normalizeQuestion,
  questionSimilarityBreakdown,
  questionSimilarity,
} = require('./similarity_service.cjs');
const { toNumber, round } = require('./shared/utils.cjs');

const ARBITRAGE_SCHEMA_VERSION = '1.1.0';

function toUsdc(raw) {
  const numeric = toNumber(raw);
  if (numeric === null) return null;
  return round(numeric / 1_000_000, 6);
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

function enumerateCombinations(items, size, onCombination) {
  if (!Array.isArray(items) || !Number.isInteger(size) || size < 1 || size > items.length) return;
  if (typeof onCombination !== 'function') return;

  const selected = [];
  function walk(startIndex) {
    if (selected.length === size) {
      onCombination(selected.slice());
      return;
    }
    const remaining = size - selected.length;
    const maxStart = items.length - remaining;
    for (let index = startIndex; index <= maxStart; index += 1) {
      selected.push(items[index]);
      walk(index + 1);
      selected.pop();
    }
  }
  walk(0);
}

function resolveCombinatorialSettings(options) {
  return {
    enabled: Boolean(options && options.combinatorial),
    minNetEdgePct: Number.isFinite(options && options.minSpreadPct) ? Number(options.minSpreadPct) : 0,
    feePctPerLeg: Number.isFinite(options && options.combinatorialFeePctPerLeg)
      ? Number(options.combinatorialFeePctPerLeg)
      : Number.isFinite(options && options.feePctPerLeg)
        ? Number(options.feePctPerLeg)
        : 0,
    slippagePctPerLeg: Number.isFinite(options && options.combinatorialSlippagePctPerLeg)
      ? Number(options.combinatorialSlippagePctPerLeg)
      : Number.isFinite(options && options.slippagePctPerLeg)
        ? Number(options.slippagePctPerLeg)
        : 0,
    amountUsdc: Number.isFinite(options && options.combinatorialAmountUsdc)
      ? Number(options.combinatorialAmountUsdc)
      : Number.isFinite(options && options.amountUsdc)
        ? Number(options.amountUsdc)
        : 100,
    maxBundleSize: Number.isInteger(options && options.maxBundleSize) ? Number(options.maxBundleSize) : 4,
  };
}

function buildCombinatorialBundleOpportunities(group, summary, options) {
  const settings = resolveCombinatorialSettings(options);
  if (!settings.enabled) return [];

  const legs = Array.isArray(group)
    ? group.filter(
        (leg) => leg && Number.isFinite(toNumber(leg.yesPct)) && Number.isFinite(toNumber(leg.noPct)),
      )
    : [];
  if (legs.length < 3) return [];

  const maxBundleSize = Math.max(3, Math.min(settings.maxBundleSize, legs.length));
  const opportunities = [];

  for (let bundleSize = 3; bundleSize <= maxBundleSize; bundleSize += 1) {
    enumerateCombinations(legs, bundleSize, (bundle) => {
      const bundleMarketIds = bundle.map((leg) => leg.marketId);
      const bundleVenues = Array.from(new Set(bundle.map((leg) => leg.venue))).sort();
      const bundleCloseValues = bundle.map((leg) => toNumber(leg.closeTimestamp)).filter((value) => value !== null);
      const sumYesPct = round(bundle.reduce((total, leg) => total + Number(leg.yesPct), 0), 6);
      const sumNoPct = round(bundle.reduce((total, leg) => total + Number(leg.noPct), 0), 6);
      const feeImpactPct = round(bundleSize * settings.feePctPerLeg, 6);
      const slippageImpactPct = round(bundleSize * settings.slippagePctPerLeg, 6);

      const evaluate = (strategy) => {
        const grossEdgePct = strategy === 'buy_yes_bundle' ? round(100 - sumYesPct, 6) : round(sumYesPct - 100, 6);
        if (grossEdgePct <= 0) return;

        const netEdgePct = round(grossEdgePct - feeImpactPct - slippageImpactPct, 6);
        if (netEdgePct <= 0 || netEdgePct < settings.minNetEdgePct) return;

        const payoutPct = strategy === 'buy_yes_bundle' ? 100 : round((bundleSize - 1) * 100, 6);
        const totalEntryPct = strategy === 'buy_yes_bundle' ? sumYesPct : sumNoPct;
        const grossProfitUsdc = round((settings.amountUsdc * grossEdgePct) / 100, 6);
        const profitUsdc = round((settings.amountUsdc * netEdgePct) / 100, 6);

        opportunities.push({
          opportunityType: 'combinatorial',
          strategy,
          groupId: summary.groupId,
          normalizedQuestion: summary.normalizedQuestion,
          bundleSize,
          bundleMarketIds,
          bundleVenues,
          closeTimeWindow: {
            min: bundleCloseValues.length ? Math.min(...bundleCloseValues) : null,
            max: bundleCloseValues.length ? Math.max(...bundleCloseValues) : null,
          },
          sumYesPct,
          sumNoPct,
          totalEntryPct,
          payoutPct,
          grossEdgePct,
          feePctPerLeg: round(settings.feePctPerLeg, 6),
          slippagePctPerLeg: round(settings.slippagePctPerLeg, 6),
          feeImpactPct,
          slippageImpactPct,
          netEdgePct,
          netEdge: round(netEdgePct / 100, 8),
          amountUsdc: round(settings.amountUsdc, 6),
          grossProfitUsdc,
          profitUsdc,
          legs: bundle.map((leg) => ({
            venue: leg.venue,
            marketId: leg.marketId,
            yesPct: leg.yesPct,
            noPct: leg.noPct,
            liquidityUsd: leg.liquidityUsd,
            volumeUsd: leg.volumeUsd,
            closeTimestamp: leg.closeTimestamp,
            rules: options.withRules ? leg.rules || null : undefined,
            sources: options.withRules ? (Array.isArray(leg.sources) ? leg.sources : []) : undefined,
          })),
        });
      };

      evaluate('buy_yes_bundle');
      evaluate('buy_no_bundle');
    });
  }

  opportunities.sort((left, right) => {
    if (right.netEdgePct !== left.netEdgePct) {
      return right.netEdgePct - left.netEdgePct;
    }
    if (right.bundleSize !== left.bundleSize) {
      return right.bundleSize - left.bundleSize;
    }
    return String(left.groupId || '').localeCompare(String(right.groupId || ''));
  });

  return opportunities;
}

async function scanArbitrage(options) {
  const venues = Array.from(new Set((options.venues || ['pandora', 'polymarket']).map((value) => String(value).toLowerCase())));
  const combinatorialSettings = resolveCombinatorialSettings(options);

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
        combinatorial: combinatorialSettings.enabled,
        maxBundleSize: combinatorialSettings.maxBundleSize,
        combinatorialFeePctPerLeg: combinatorialSettings.feePctPerLeg,
        combinatorialSlippagePctPerLeg: combinatorialSettings.slippagePctPerLeg,
        combinatorialAmountUsdc: combinatorialSettings.amountUsdc,
      },
      sources,
      diagnostics,
      count: 0,
      opportunities: [],
      ...(combinatorialSettings.enabled
        ? {
            bundleCount: 0,
            bundleOpportunities: [],
          }
        : {}),
    };
  }

  const grouped = buildGroups(allLegs, options);
  const groupSummaries = grouped.groups
    .map((group) => ({
      group,
      summary: summarizeGroup(group, options, grouped.acceptedPairChecks),
    }))
    .filter((entry) => Boolean(entry.summary));

  const opportunities = groupSummaries
    .map((entry) => entry.summary)
    .sort((a, b) => {
      const left = Math.max(a.spreadYesPct || 0, a.spreadNoPct || 0);
      const right = Math.max(b.spreadYesPct || 0, b.spreadNoPct || 0);
      return right - left;
    })
    .slice(0, options.limit);

  const bundleOpportunities = combinatorialSettings.enabled
    ? groupSummaries
        .flatMap((entry) => buildCombinatorialBundleOpportunities(entry.group, entry.summary, options))
        .sort((a, b) => {
          if ((b.netEdgePct || 0) !== (a.netEdgePct || 0)) {
            return (b.netEdgePct || 0) - (a.netEdgePct || 0);
          }
          return String(a.groupId || '').localeCompare(String(b.groupId || ''));
        })
        .slice(0, options.limit)
    : [];

  if (combinatorialSettings.enabled && bundleOpportunities.length === 0) {
    diagnostics.push('Combinatorial mode enabled but no bundle opportunities cleared net edge thresholds.');
  }

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
      combinatorial: combinatorialSettings.enabled,
      maxBundleSize: combinatorialSettings.maxBundleSize,
      combinatorialFeePctPerLeg: combinatorialSettings.feePctPerLeg,
      combinatorialSlippagePctPerLeg: combinatorialSettings.slippagePctPerLeg,
      combinatorialAmountUsdc: combinatorialSettings.amountUsdc,
    },
    sources,
    diagnostics,
    count: opportunities.length,
    opportunities,
    ...(combinatorialSettings.enabled
      ? {
          bundleCount: bundleOpportunities.length,
          bundleOpportunities,
        }
      : {}),
  };
}

module.exports = {
  ARBITRAGE_SCHEMA_VERSION,
  buildCombinatorialBundleOpportunities,
  normalizeQuestion,
  questionSimilarity,
  scanArbitrage,
};
