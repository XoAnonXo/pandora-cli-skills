const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseArbScanFlags,
  buildCrossVenueArbOpportunities,
  buildCombinatorialArbOpportunities,
} = require('../../cli/lib/arb_command_service.cjs');
const {
  buildCombinatorialBundleOpportunities,
  evaluateArbitrageQuestionMatch,
  evaluateArbitrageQuestionMatchAsync,
} = require('../../cli/lib/arbitrage_service.cjs');
const { shouldAdjudicateArbitrageMatch } = require('../../cli/lib/arb_match_service.cjs');

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function requireFlagValue(args, index, flagName) {
  const next = args[index + 1];
  if (next === undefined) {
    throw new CliError('MISSING_FLAG_VALUE', `${flagName} requires a value.`);
  }
  return next;
}

function parseCsvList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumber(value, flagName) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be numeric.`);
  }
  return numeric;
}

function parsePositiveNumber(value, flagName) {
  const numeric = parseNumber(value, flagName);
  if (numeric <= 0) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be > 0.`);
  }
  return numeric;
}

function parsePositiveInteger(value, flagName) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a positive integer.`);
  }
  return numeric;
}

function parseFlags(args) {
  return parseArbScanFlags(args, {
    CliError,
    requireFlagValue,
    parseCsvList,
    parseNumber,
    parsePositiveNumber,
    parsePositiveInteger,
  });
}

test('arb scan combinatorial flags parse with strict defaults', () => {
  const parsed = parseFlags(['scan', '--markets', 'm1,m2,m3']);
  assert.equal(parsed.combinatorial, false);
  assert.equal(parsed.slippagePctPerLeg, 0);
  assert.equal(parsed.maxBundleSize, 4);
  assert.equal(parsed.matcher, 'hybrid');
  assert.equal(parsed.similarityThreshold, 0.7);
  assert.equal(parsed.minTokenScore, 0.12);
  assert.equal(parsed.aiProvider, 'auto');
  assert.equal(parsed.aiThreshold, 0.8);
  assert.equal(parsed.aiMaxCandidates, 12);
  assert.equal(parsed.aiTimeoutMs, 6000);
});

test('arb scan default similarity settings reject the reported fuzzy mismatches', () => {
  const threshold = parseFlags(['scan', '--source', 'polymarket']).similarityThreshold;
  const mismatches = [
    ['Adam Fox (NHL)', 'Israel strike on Damascus'],
    ['Arsenal Premier League', 'VJ Edgecombe NBA Rookie of the Year'],
    ['Will Bitcoin hit $75K in 2026?', 'Will NFLX close above $750 in 2026?'],
    ['Will Arsenal win the Premier League in 2026?', 'Will Joao Pedro score 20 goals in 2026?'],
    ['Trump death', 'Trump legislation'],
    ['Will Donald Trump die in 2025?', 'Will Trump legislation pass in 2025?'],
    ['Will Trump die before April 01?', 'Will Trump sign 7 pieces of legislation in March?'],
  ];

  for (const [left, right] of mismatches) {
    const match = evaluateArbitrageQuestionMatch(left, right, {
      similarityThreshold: threshold,
      minTokenScore: 0.12,
    });
    assert.equal(match.accepted, false, `${left} vs ${right} should be rejected by the default arb matcher`);
  }

  const legitimate = evaluateArbitrageQuestionMatch(
    'Will Arsenal FC win the Premier League in 2026?',
    'Will Arsenal win Premier League 2026?',
    {
      similarityThreshold: threshold,
      minTokenScore: 0.12,
    },
  );
  assert.equal(legitimate.accepted, true);
  assert.equal(legitimate.score <= 1, true);
});

test('arb matching requires more than a weak single-name overlap', () => {
  const weak = evaluateArbitrageQuestionMatch(
    'Will Donald Trump die in 2025?',
    'Will Trump legislation pass in 2025?',
    {
      similarityThreshold: 0.7,
      minTokenScore: 0.12,
    },
  );
  assert.equal(weak.accepted, false);
  assert.equal(weak.contentSharedTokenCount, 1);

  const strong = evaluateArbitrageQuestionMatch(
    'Will Dallas Mavericks beat Boston Celtics?',
    'Mavericks vs Celtics winner',
    {
      similarityThreshold: 0.7,
      minTokenScore: 0.12,
    },
  );
  assert.equal(strong.accepted, true);
  assert.equal(strong.contentSharedTokenCount >= 2, true);
});

test('arb hybrid matcher surfaces semantic blocker diagnostics for disjoint entity types', () => {
  const priceVsEquity = evaluateArbitrageQuestionMatch(
    'Will Bitcoin hit $75K in 2026?',
    'Will NFLX close above $750 in 2026?',
    {
      matcher: 'hybrid',
      similarityThreshold: 0.7,
      minTokenScore: 0.12,
    },
  );
  assert.equal(priceVsEquity.accepted, false);
  assert.equal(priceVsEquity.semanticBlockers.includes('ASSET_SUBJECT_MISMATCH'), true);

  const teamVsPlayer = evaluateArbitrageQuestionMatch(
    'Will Arsenal win the Premier League in 2026?',
    'Will Joao Pedro score 20 goals in 2026?',
    {
      matcher: 'hybrid',
      similarityThreshold: 0.7,
      minTokenScore: 0.12,
    },
  );
  assert.equal(teamVsPlayer.accepted, false);
  assert.equal(teamVsPlayer.semanticBlockers.includes('MARKET_TYPE_MISMATCH'), true);
});

test('arb hybrid matcher blocks price-target threshold mismatches for the same asset', () => {
  const thresholdMismatch = evaluateArbitrageQuestionMatch(
    'Will Bitcoin hit $75K in 2026?',
    'Will Bitcoin hit $80K in 2026?',
    {
      matcher: 'hybrid',
      similarityThreshold: 0.7,
      minTokenScore: 0.12,
    },
  );
  assert.equal(thresholdMismatch.accepted, false);
  assert.equal(thresholdMismatch.semanticBlockers.includes('THRESHOLD_MISMATCH'), true);
});

test('arb hybrid mock adjudicator can rescue strong semantic matches near the threshold', async () => {
  const base = evaluateArbitrageQuestionMatch(
    'Will Dallas Mavericks beat Boston Celtics?',
    'Mavericks vs Celtics winner',
    {
      matcher: 'hybrid',
      similarityThreshold: 0.9,
      minTokenScore: 0.12,
    },
  );
  assert.equal(base.accepted, false);
  const plan = shouldAdjudicateArbitrageMatch(base, { aiProvider: 'mock' });
  assert.equal(plan.eligible, true);

  const rescued = await evaluateArbitrageQuestionMatchAsync(
    'Will Dallas Mavericks beat Boston Celtics?',
    'Mavericks vs Celtics winner',
    {
      matcher: 'hybrid',
      similarityThreshold: 0.9,
      minTokenScore: 0.12,
      aiProvider: 'mock',
      mockResponse: {
        equivalent: true,
        confidence: 0.93,
        reason: 'Same teams and same winner market.',
        blockers: [],
        topic: 'sports',
        marketType: 'sports.team_result',
      },
    },
  );
  assert.equal(rescued.accepted, true);
  assert.equal(rescued.decisionSource, 'ai-overridden');
  assert.equal(rescued.aiApplied, true);
  assert.equal(rescued.aiAdjudication.provider, 'mock');
});

test('arb scan combinatorial mode enforces minimum market count', () => {
  assert.throws(
    () => parseFlags(['scan', '--markets', 'm1,m2', '--combinatorial']),
    (err) => err && err.code === 'INVALID_ARGS',
  );
});

test('arb scan accepts cross-venue matching controls', () => {
  const parsed = parseFlags([
    'scan',
    '--source',
    'polymarket',
    '--matcher',
    'heuristic',
    '--similarity-threshold',
    '0.42',
    '--min-token-score',
    '0.2',
    '--ai-provider',
    'mock',
    '--ai-model',
    'arb-mini',
    '--ai-threshold',
    '0.85',
    '--ai-max-candidates',
    '5',
    '--ai-timeout-ms',
    '4200',
    '--max-close-diff-hours',
    '6',
    '--question-contains',
    'bitcoin',
  ]);
  assert.equal(parsed.source, 'polymarket');
  assert.equal(parsed.matcher, 'heuristic');
  assert.equal(parsed.similarityThreshold, 0.42);
  assert.equal(parsed.minTokenScore, 0.2);
  assert.equal(parsed.aiProvider, 'mock');
  assert.equal(parsed.aiModel, 'arb-mini');
  assert.equal(parsed.aiThreshold, 0.85);
  assert.equal(parsed.aiMaxCandidates, 5);
  assert.equal(parsed.aiTimeoutMs, 4200);
  assert.equal(parsed.maxCloseDiffHours, 6);
  assert.equal(parsed.questionContains, 'bitcoin');
});

test('arb scan rejects out-of-range similarity controls', () => {
  assert.throws(
    () => parseFlags(['scan', '--source', 'polymarket', '--similarity-threshold', '1.2']),
    (err) => err && err.code === 'INVALID_FLAG_VALUE',
  );
  assert.throws(
    () => parseFlags(['scan', '--source', 'polymarket', '--min-token-score', '-0.1']),
    (err) => err && err.code === 'INVALID_FLAG_VALUE',
  );
  assert.throws(
    () => parseFlags(['scan', '--source', 'polymarket', '--matcher', 'ai']),
    (err) => err && err.code === 'INVALID_FLAG_VALUE',
  );
  assert.throws(
    () => parseFlags(['scan', '--source', 'polymarket', '--ai-provider', 'bogus']),
    (err) => err && err.code === 'INVALID_FLAG_VALUE',
  );
  assert.throws(
    () => parseFlags(['scan', '--source', 'polymarket', '--ai-threshold', '2']),
    (err) => err && err.code === 'INVALID_FLAG_VALUE',
  );
});

test('buildCombinatorialArbOpportunities applies fee + slippage to net edge', () => {
  const opportunities = buildCombinatorialArbOpportunities({
    marketSnapshots: [
      { id: 'a', yesPct: 20 },
      { id: 'b', yesPct: 25 },
      { id: 'c', yesPct: 30 },
    ],
    minNetSpreadPct: 1,
    feePctPerLeg: 0.5,
    slippagePctPerLeg: 0.25,
    amountUsdc: 100,
    maxBundleSize: 3,
  });

  const candidate = opportunities.find((item) => item.strategy === 'buy_yes_bundle');
  assert.ok(candidate);
  assert.equal(candidate.opportunityType, 'combinatorial');
  assert.equal(candidate.bundleSize, 3);
  assert.equal(candidate.sumYesPct, 75);
  assert.equal(candidate.grossEdgePct, 25);
  assert.equal(candidate.feeImpactPct, 1.5);
  assert.equal(candidate.slippageImpactPct, 0.75);
  assert.equal(candidate.netSpreadPct, 22.75);
  assert.equal(candidate.profitUsdc, 22.75);
});

test('buildCrossVenueArbOpportunities enforces min-tvl and applies net spread impacts', () => {
  const rows = buildCrossVenueArbOpportunities(
    {
      opportunities: [
        {
          groupId: 'g-low',
          normalizedQuestion: 'low-liquidity sample',
          spreadYesPct: 8,
          spreadNoPct: 6,
          legs: [
            { venue: 'pandora', marketId: 'p-low', yesPct: 40, liquidityUsd: 40 },
            { venue: 'polymarket', marketId: 'x-low', yesPct: 48, liquidityUsd: 45 },
          ],
        },
        {
          groupId: 'g-hi',
          normalizedQuestion: 'high-liquidity sample',
          spreadYesPct: 8,
          spreadNoPct: 6,
          confidenceScore: 0.9,
          riskFlags: [],
          legs: [
            { venue: 'pandora', marketId: 'p-hi', yesPct: 40, liquidityUsd: 500 },
            { venue: 'polymarket', marketId: 'x-hi', yesPct: 48, liquidityUsd: 700, url: 'https://polymarket.com/event/x-hi' },
          ],
        },
      ],
    },
    {
      minNetSpreadPct: 5,
      minTvlUsdc: 100,
      feePctPerLeg: 0.5,
      slippagePctPerLeg: 0.25,
      limit: 10,
    },
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].pair, 'p-hi|x-hi');
  assert.equal(rows[0].grossSpreadPct, 8);
  assert.equal(rows[0].feeImpactPct, 1);
  assert.equal(rows[0].slippageImpactPct, 0.5);
  assert.equal(rows[0].netSpreadPct, 6.5);
  assert.equal(rows[0].minLegLiquidityUsd, 500);
});

test('buildCombinatorialBundleOpportunities returns arbitrage_service bundle payload', () => {
  const group = [
    {
      legId: 'leg-a',
      venue: 'pandora',
      marketId: 'm-a',
      yesPct: 18,
      noPct: 82,
      liquidityUsd: 1_000,
      volumeUsd: 2_000,
      closeTimestamp: 1710000000,
      rules: null,
      sources: [],
    },
    {
      legId: 'leg-b',
      venue: 'polymarket',
      marketId: 'm-b',
      yesPct: 21,
      noPct: 79,
      liquidityUsd: 1_200,
      volumeUsd: 1_900,
      closeTimestamp: 1710000300,
      rules: null,
      sources: [],
    },
    {
      legId: 'leg-c',
      venue: 'pandora',
      marketId: 'm-c',
      yesPct: 24,
      noPct: 76,
      liquidityUsd: 1_300,
      volumeUsd: 2_200,
      closeTimestamp: 1710000600,
      rules: null,
      sources: [],
    },
  ];

  const bundleOpportunities = buildCombinatorialBundleOpportunities(
    group,
    { groupId: 'g-1', normalizedQuestion: 'test market' },
    {
      combinatorial: true,
      maxBundleSize: 3,
      minSpreadPct: 1,
      combinatorialFeePctPerLeg: 0.4,
      combinatorialSlippagePctPerLeg: 0.2,
      combinatorialAmountUsdc: 200,
      withRules: false,
    },
  );

  assert.equal(bundleOpportunities.length >= 1, true);
  const best = bundleOpportunities[0];
  assert.equal(best.groupId, 'g-1');
  assert.equal(best.strategy, 'buy_yes_bundle');
  assert.equal(best.bundleSize, 3);
  assert.equal(best.grossEdgePct, 37);
  assert.equal(best.feeImpactPct, 1.2);
  assert.equal(best.slippageImpactPct, 0.6);
  assert.equal(best.netEdgePct, 35.2);
  assert.equal(best.profitUsdc, 70.4);
});
