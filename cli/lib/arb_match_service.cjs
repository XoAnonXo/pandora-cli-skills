const { round } = require('./shared/utils.cjs');
const { normalizeQuestion, questionSimilarityBreakdown } = require('./similarity_service.cjs');
const {
  adjudicateArbitragePair,
  resolveArbAiConfidenceThreshold,
  resolveArbAiModel,
  resolveArbAiProvider,
} = require('./arb_adjudication_provider.cjs');

const DEFAULT_ARBITRAGE_MATCHER = 'hybrid';
const SUPPORTED_ARBITRAGE_MATCHERS = new Set(['heuristic', 'hybrid']);
const AI_ADJUDICATION_CACHE = new Map();
const MAX_AI_ADJUDICATION_CACHE_SIZE = 256;

const LEAGUE_ENTITY_KEYS = new Set([
  'champions league',
  'epl',
  'mlb',
  'nba',
  'nfl',
  'nhl',
  'premier league',
  'super bowl',
  'world cup',
  'world series',
]);

const ENTITY_ALIAS_MAP = new Map([
  ['arsenal fc', 'arsenal'],
  ['btc', 'bitcoin'],
  ['donald trump', 'trump'],
  ['eth', 'ethereum'],
  ['manchester city', 'man city'],
  ['netflix', 'nflx'],
  ['president trump', 'trump'],
]);

const ASSET_ALIASES = new Map([
  ['bitcoin', 'bitcoin'],
  ['btc', 'bitcoin'],
  ['ethereum', 'ethereum'],
  ['eth', 'ethereum'],
  ['solana', 'solana'],
  ['sol', 'solana'],
  ['dogecoin', 'dogecoin'],
  ['doge', 'dogecoin'],
  ['xrp', 'xrp'],
  ['nflx', 'nflx'],
  ['netflix', 'nflx'],
  ['tsla', 'tsla'],
  ['tesla', 'tsla'],
  ['aapl', 'aapl'],
  ['apple', 'aapl'],
  ['meta', 'meta'],
  ['nvda', 'nvda'],
  ['nvidia', 'nvda'],
]);

const LEAGUE_ALIASES = new Map([
  ['champions league', 'champions league'],
  ['epl', 'premier league'],
  ['nba', 'nba'],
  ['nfl', 'nfl'],
  ['nhl', 'nhl'],
  ['premier league', 'premier league'],
  ['super bowl', 'super bowl'],
  ['world cup', 'world cup'],
  ['world series', 'world series'],
]);

const SPORTS_TEAM_ALIASES = new Map([
  ['arsenal fc', 'arsenal'],
  ['arsenal', 'arsenal'],
  ['boston celtics', 'celtics'],
  ['celtics', 'celtics'],
  ['chelsea', 'chelsea'],
  ['dallas mavericks', 'mavericks'],
  ['mavericks', 'mavericks'],
]);

const SPORTS_PLAYER_ALIASES = new Map([
  ['adam fox', 'adam fox'],
  ['joao pedro', 'joao pedro'],
]);

const CAPITALIZED_PHRASE_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'by',
  'for',
  'from',
  'if',
  'in',
  'is',
  'of',
  'on',
  'or',
  'the',
  'to',
  'will',
]);

const TOPIC_KEYWORDS = {
  crypto: ['bitcoin', 'btc', 'crypto', 'doge', 'dogecoin', 'eth', 'ethereum', 'sol', 'solana', 'xrp'],
  finance: ['aapl', 'close above', 'close below', 'market cap', 'nasdaq', 'nflx', 'price', 's&p', 'stock', 'tesla', 'tsla'],
  politics: ['bill', 'congress', 'election', 'house', 'law', 'legislation', 'president', 'senate', 'sign', 'trump', 'veto'],
  sports: ['beat', 'goal scorer', 'home run', 'match', 'mavericks', 'nba', 'nfl', 'nhl', 'points', 'premier league', 'score a goal', 'touchdown', 'vs', 'winner'],
};

const PREDICATE_KEYWORDS = [
  { family: 'death_health', patterns: ['assassinated', 'coma', 'dead', 'death', 'die', 'dies', 'hospitalized', 'killed', 'survive', 'survives'] },
  { family: 'legislation', patterns: ['bill', 'law', 'legislation', 'pass', 'passes', 'passed', 'sign', 'signed', 'veto', 'vetoes'] },
  { family: 'election', patterns: ['election', 'nomination', 'reelected', 'vote share', 'win presidency', 'wins election'] },
  { family: 'player_prop', patterns: ['anytime scorer', 'assists', 'goal scorer', 'goals', 'home run', 'points', 'rebounds', 'score a goal', 'score first', 'strikeouts', 'touchdown', 'yards'] },
  { family: 'team_future', patterns: ['championship', 'premier league', 'relegated', 'super bowl', 'title', 'trophy', 'win the league', 'world series'] },
  { family: 'team_result', patterns: ['beat', 'defeat', 'draw', 'match winner', 'vs', 'winner'] },
  { family: 'price_target', patterns: ['close above', 'close below', 'hit', 'price', 'reach', 'trade above', 'trade below'] },
];

const MARKET_TYPE_MAP = [
  { family: 'player_prop', marketType: 'sports.player_prop', sportsRole: 'player' },
  { family: 'team_future', marketType: 'sports.team_future', sportsRole: 'team' },
  { family: 'team_result', marketType: 'sports.team_result', sportsRole: 'team' },
  { family: 'death_health', marketType: 'person.death_health' },
  { family: 'legislation', marketType: 'politics.legislation' },
  { family: 'election', marketType: 'politics.election' },
  { family: 'price_target', marketType: 'finance.price_target' },
];

function normalizeArbitrageMatcher(value) {
  const normalized = String(value || DEFAULT_ARBITRAGE_MATCHER).trim().toLowerCase();
  return SUPPORTED_ARBITRAGE_MATCHERS.has(normalized) ? normalized : null;
}

function splitOriginalTokens(text) {
  return String(text || '')
    .replace(/[\u2018\u2019']/g, '')
    .split(/[^A-Za-z0-9$]+/)
    .filter(Boolean);
}

function extractCapitalizedPhrases(question) {
  const tokens = splitOriginalTokens(question);
  const phrases = [];
  let current = [];

  const flush = () => {
    if (!current.length) return;
    const phrase = current.join(' ');
    if (phrase.length > 1) {
      phrases.push(phrase);
    }
    current = [];
  };

  for (const token of tokens) {
    const lower = token.toLowerCase();
    const looksUpperTicker = /^[A-Z]{2,5}$/.test(token);
    const looksCapitalizedWord = /^[A-Z][a-z]+$/.test(token);
    if ((looksUpperTicker || looksCapitalizedWord) && !CAPITALIZED_PHRASE_STOPWORDS.has(lower)) {
      current.push(token);
      continue;
    }
    flush();
  }
  flush();

  return Array.from(new Set(phrases.map((phrase) => phrase.trim()).filter(Boolean)));
}

function canonicalizeEntity(value) {
  const normalized = normalizeQuestion(value).replace(/\b(fc|cf|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return ENTITY_ALIAS_MAP.get(normalized) || normalized;
}

function collectMappedEntities(normalizedText, sourceMap) {
  const out = new Set();
  const padded = ` ${String(normalizedText || '').trim()} `;
  for (const [needle, canonical] of sourceMap.entries()) {
    if (padded.includes(` ${needle} `)) {
      out.add(canonical);
    }
  }
  return out;
}

function extractYears(normalizedText) {
  return Array.from(
    new Set(
      String(normalizedText || '')
        .split(/\s+/)
        .filter((token) => /^\d{4}$/.test(token)),
    ),
  ).sort();
}

function extractNumericHints(rawQuestion) {
  const matches = String(rawQuestion || '').match(/\$?\d+(?:\.\d+)?(?:k|m|b)?/gi) || [];
  return Array.from(new Set(matches.map((token) => token.toLowerCase()))).sort();
}

function extractPredicateFamilies(normalizedCombined) {
  const families = [];
  for (const entry of PREDICATE_KEYWORDS) {
    if (entry.patterns.some((pattern) => normalizedCombined.includes(pattern))) {
      families.push(entry.family);
    }
  }
  return families.sort();
}

function resolveTopic(normalizedCombined, predicateFamilies, assetSubjects, teamSubjects, playerSubjects) {
  if (assetSubjects.size) {
    if (Array.from(assetSubjects).some((item) => ['bitcoin', 'ethereum', 'solana', 'dogecoin', 'xrp'].includes(item))) {
      return 'crypto';
    }
    return 'finance';
  }
  if (predicateFamilies.some((family) => family === 'player_prop' || family === 'team_future' || family === 'team_result')) {
    return 'sports';
  }
  if (teamSubjects.size || playerSubjects.size) {
    return 'sports';
  }
  if (predicateFamilies.some((family) => family === 'legislation' || family === 'election')) {
    return 'politics';
  }
  if (predicateFamilies.includes('death_health') && normalizedCombined.includes('trump')) {
    return 'politics';
  }

  const topicScores = Object.entries(TOPIC_KEYWORDS).map(([topic, patterns]) => ({
    topic,
    score: patterns.reduce((total, pattern) => total + (normalizedCombined.includes(pattern) ? 1 : 0), 0),
  }));
  topicScores.sort((left, right) => right.score - left.score);
  return topicScores[0] && topicScores[0].score > 0 ? topicScores[0].topic : 'other';
}

function resolveMarketType(predicateFamilies, topic) {
  for (const entry of MARKET_TYPE_MAP) {
    if (predicateFamilies.includes(entry.family)) {
      return {
        marketType: entry.marketType,
        sportsRole: entry.sportsRole || null,
      };
    }
  }
  if (topic === 'sports') {
    return { marketType: 'sports.binary_event', sportsRole: null };
  }
  if (topic === 'politics') {
    return { marketType: 'politics.binary_event', sportsRole: null };
  }
  if (topic === 'finance' || topic === 'crypto') {
    return { marketType: `${topic}.binary_event`, sportsRole: null };
  }
  return { marketType: 'event.binary', sportsRole: null };
}

function buildSemanticSignature(question, options = {}) {
  const rawQuestion = String(question || '').trim();
  const rawRules = String(options.rules || '').trim();
  const normalizedQuestion = normalizeQuestion(rawQuestion);
  const normalizedRules = normalizeQuestion(rawRules);
  const normalizedCombined = [normalizedQuestion, normalizedRules].filter(Boolean).join(' ').trim();
  const capitalizedPhrases = extractCapitalizedPhrases(rawQuestion);
  const namedEntities = new Set(capitalizedPhrases.map(canonicalizeEntity).filter(Boolean));
  const assetSubjects = collectMappedEntities(normalizedCombined, ASSET_ALIASES);
  const leagueSubjects = collectMappedEntities(normalizedCombined, LEAGUE_ALIASES);
  const teamSubjects = collectMappedEntities(normalizedQuestion, SPORTS_TEAM_ALIASES);
  const playerSubjects = collectMappedEntities(normalizedQuestion, SPORTS_PLAYER_ALIASES);
  const years = extractYears(normalizedCombined);
  const numericHints = extractNumericHints(rawQuestion);
  const predicateFamilies = extractPredicateFamilies(normalizedCombined);
  const topic = resolveTopic(normalizedCombined, predicateFamilies, assetSubjects, teamSubjects, playerSubjects);
  const marketShape = resolveMarketType(predicateFamilies, topic);

  for (const entity of namedEntities) {
    if (LEAGUE_ENTITY_KEYS.has(entity)) {
      leagueSubjects.add(entity);
      continue;
    }
    if (assetSubjects.has(entity)) continue;
    if (playerSubjects.has(entity)) continue;
    if (teamSubjects.has(entity)) continue;

    if (topic === 'sports') {
      if (marketShape.sportsRole === 'player') playerSubjects.add(entity);
      else if (marketShape.sportsRole === 'team') teamSubjects.add(entity);
    }
  }

  const subjectEntities = new Set([
    ...Array.from(assetSubjects),
    ...Array.from(playerSubjects),
    ...Array.from(teamSubjects),
  ]);

  return {
    topic,
    marketType: marketShape.marketType,
    sportsRole: marketShape.sportsRole,
    predicateFamilies,
    years,
    numericHints,
    namedEntities: Array.from(namedEntities).sort(),
    subjectEntities: Array.from(subjectEntities).sort(),
    assetSubjects: Array.from(assetSubjects).sort(),
    personSubjects: Array.from(playerSubjects).sort(),
    teamSubjects: Array.from(teamSubjects).sort(),
    leagueSubjects: Array.from(leagueSubjects).sort(),
  };
}

function intersectArrays(left, right) {
  const rightSet = new Set(Array.isArray(right) ? right : []);
  return Array.from(new Set((Array.isArray(left) ? left : []).filter((value) => rightSet.has(value)))).sort();
}

function evaluateSemanticCompatibility(leftSignature, rightSignature) {
  const blockers = [];
  const warnings = [];
  const leftThresholdHints = (Array.isArray(leftSignature.numericHints) ? leftSignature.numericHints : []).filter(
    (token) => !/^\d{4}$/.test(String(token || '')),
  );
  const rightThresholdHints = (Array.isArray(rightSignature.numericHints) ? rightSignature.numericHints : []).filter(
    (token) => !/^\d{4}$/.test(String(token || '')),
  );

  const sharedSubjects = intersectArrays(leftSignature.subjectEntities, rightSignature.subjectEntities);
  const sharedAssets = intersectArrays(leftSignature.assetSubjects, rightSignature.assetSubjects);
  const sharedTeams = intersectArrays(leftSignature.teamSubjects, rightSignature.teamSubjects);
  const sharedPeople = intersectArrays(leftSignature.personSubjects, rightSignature.personSubjects);
  const sharedPredicates = intersectArrays(leftSignature.predicateFamilies, rightSignature.predicateFamilies);
  const sharedNumericHints = intersectArrays(leftSignature.numericHints, rightSignature.numericHints);
  const sharedThresholdHints = intersectArrays(leftThresholdHints, rightThresholdHints);
  const sharedYears = intersectArrays(leftSignature.years, rightSignature.years);

  if (leftSignature.topic !== 'other' && rightSignature.topic !== 'other' && leftSignature.topic !== rightSignature.topic) {
    blockers.push('TOPIC_MISMATCH');
  }

  if (leftSignature.marketType !== rightSignature.marketType) {
    const incompatibleSportsRole =
      leftSignature.sportsRole
      && rightSignature.sportsRole
      && leftSignature.sportsRole !== rightSignature.sportsRole;
    const incompatibleFamily =
      leftSignature.marketType !== 'event.binary'
      && rightSignature.marketType !== 'event.binary'
      && !sharedPredicates.length;
    if (incompatibleSportsRole || incompatibleFamily) {
      blockers.push('MARKET_TYPE_MISMATCH');
    } else {
      warnings.push('MARKET_TYPE_VARIANT');
    }
  }

  if (leftSignature.assetSubjects.length && rightSignature.assetSubjects.length && !sharedAssets.length) {
    blockers.push('ASSET_SUBJECT_MISMATCH');
  }

  if (leftSignature.teamSubjects.length && rightSignature.teamSubjects.length && !sharedTeams.length) {
    blockers.push('TEAM_SUBJECT_MISMATCH');
  }

  if (leftSignature.personSubjects.length && rightSignature.personSubjects.length && !sharedPeople.length) {
    blockers.push('PERSON_SUBJECT_MISMATCH');
  }

  if (
    leftSignature.years.length
    && rightSignature.years.length
    && !sharedYears.length
    && leftSignature.marketType === rightSignature.marketType
  ) {
    blockers.push('TIME_WINDOW_MISMATCH');
  }

  if (leftSignature.predicateFamilies.length && rightSignature.predicateFamilies.length && !sharedPredicates.length) {
    blockers.push('PREDICATE_MISMATCH');
  }

  if (
    leftSignature.marketType === 'finance.price_target'
    && rightSignature.marketType === 'finance.price_target'
    && leftThresholdHints.length
    && rightThresholdHints.length
    && !sharedThresholdHints.length
  ) {
    blockers.push('THRESHOLD_MISMATCH');
  }

  if (
    leftThresholdHints.length
    && rightThresholdHints.length
    && !sharedThresholdHints.length
    && leftSignature.marketType === 'finance.price_target'
    && rightSignature.marketType === 'finance.price_target'
    && !sharedAssets.length
  ) {
    warnings.push('PRICE_TARGET_VARIANT');
  }

  if (!sharedSubjects.length && !sharedPredicates.length) {
    warnings.push('LOW_SEMANTIC_OVERLAP');
  }

  let score = 0.5;
  if (sharedSubjects.length) score += 0.2;
  if (sharedPredicates.length) score += 0.15;
  if (sharedYears.length) score += 0.05;
  score -= blockers.length * 0.18;
  score -= warnings.filter((code) => code !== 'LOW_SEMANTIC_OVERLAP').length * 0.05;
  score = Math.max(0, Math.min(1, score));

  const strongEquivalent =
    blockers.length === 0
    && (sharedSubjects.length > 0 || sharedPredicates.length > 0)
    && (sharedYears.length > 0 || !leftSignature.years.length || !rightSignature.years.length);

  return {
    blockers: Array.from(new Set(blockers)).sort(),
    warnings: Array.from(new Set(warnings)).sort(),
    sharedSubjects,
    sharedPredicateFamilies: sharedPredicates,
    sharedNumericHints,
    sharedYears,
    score: round(score, 6),
    strongEquivalent,
  };
}

function evaluateArbitrageQuestionMatch(leftQuestion, rightQuestion, options = {}) {
  const matcher = normalizeArbitrageMatcher(options.matcher) || DEFAULT_ARBITRAGE_MATCHER;
  const similarity = questionSimilarityBreakdown(leftQuestion, rightQuestion);
  const similarityThreshold = Number.isFinite(options && options.similarityThreshold)
    ? Number(options.similarityThreshold)
    : 0.7;
  const minTokenScore = Number.isFinite(options && options.minTokenScore)
    ? Number(options.minTokenScore)
    : 0.12;
  const sharedContentTokenCount = Number(similarity.contentSharedTokenCount) || 0;
  const passesTokenScore = similarity.tokenScore >= minTokenScore;
  const passesSimilarity = similarity.score >= similarityThreshold;
  const passesContentOverlap =
    sharedContentTokenCount >= 2
    || (
      sharedContentTokenCount === 1
      && similarity.score >= Math.max(similarityThreshold + 0.12, 0.65)
      && similarity.jaroWinkler >= 0.88
    );

  const leftSignature = buildSemanticSignature(leftQuestion, { rules: options.leftRules });
  const rightSignature = buildSemanticSignature(rightQuestion, { rules: options.rightRules });
  const semantic = evaluateSemanticCompatibility(leftSignature, rightSignature);
  const heuristicAccepted = passesTokenScore && passesSimilarity && passesContentOverlap;
  const passesSemanticFilters = semantic.blockers.length === 0;

  let accepted = heuristicAccepted;
  let decisionSource = 'heuristic';
  if (matcher === 'hybrid') {
    accepted =
      passesSemanticFilters
      && (
        heuristicAccepted
        || (
          semantic.strongEquivalent
          && similarity.jaroWinkler >= 0.72
          && similarity.contentTokenScore >= 0.16
        )
      );
    decisionSource = 'hybrid';
  }

  return {
    ...similarity,
    matcher,
    similarityThreshold,
    minTokenScore,
    passesTokenScore,
    passesSimilarity,
    passesContentOverlap,
    heuristicAccepted,
    passesSemanticFilters,
    semanticScore: semantic.score,
    semanticBlockers: semantic.blockers,
    semanticWarnings: semantic.warnings,
    sharedSubjects: semantic.sharedSubjects,
    sharedPredicateFamilies: semantic.sharedPredicateFamilies,
    sharedNumericHints: semantic.sharedNumericHints,
    sharedYears: semantic.sharedYears,
    strongSemanticEquivalent: semantic.strongEquivalent,
    leftSignature,
    rightSignature,
    decisionSource,
    accepted,
    aiProvider: null,
    aiModel: null,
    aiEligible: false,
    aiConsidered: false,
    aiAdjudicated: false,
    aiApplied: false,
    aiConfidenceThreshold: null,
    aiEligibilityReason: null,
    aiHighConfidence: false,
    aiAdjudication: null,
    aiError: null,
  };
}

function buildAdjudicationCacheKey(leftQuestion, rightQuestion, options = {}, provider, model) {
  const sides = [
    [normalizeQuestion(leftQuestion), normalizeQuestion(options.leftRules)].filter(Boolean).join(' ').trim(),
    [normalizeQuestion(rightQuestion), normalizeQuestion(options.rightRules)].filter(Boolean).join(' ').trim(),
  ].sort();
  return JSON.stringify({
    model,
    provider,
    sides,
  });
}

function canCacheAdjudicationResult(options = {}, provider) {
  if (provider === 'mock' || provider === 'none') return false;
  if (typeof options.fetchFn === 'function') return false;
  if (options.mockResponse) return false;
  return true;
}

function getCachedAdjudicationResult(cacheKey) {
  if (!cacheKey || !AI_ADJUDICATION_CACHE.has(cacheKey)) return null;
  const value = AI_ADJUDICATION_CACHE.get(cacheKey);
  AI_ADJUDICATION_CACHE.delete(cacheKey);
  AI_ADJUDICATION_CACHE.set(cacheKey, value);
  return value;
}

function setCachedAdjudicationResult(cacheKey, value) {
  if (!cacheKey) return;
  if (AI_ADJUDICATION_CACHE.has(cacheKey)) {
    AI_ADJUDICATION_CACHE.delete(cacheKey);
  }
  AI_ADJUDICATION_CACHE.set(cacheKey, value);
  while (AI_ADJUDICATION_CACHE.size > MAX_AI_ADJUDICATION_CACHE_SIZE) {
    const oldestKey = AI_ADJUDICATION_CACHE.keys().next().value;
    AI_ADJUDICATION_CACHE.delete(oldestKey);
  }
}

function shouldAdjudicateArbitrageMatch(match, options = {}) {
  const provider = resolveArbAiProvider(options);
  const confidenceThreshold = resolveArbAiConfidenceThreshold(options);
  const model = provider === 'none' ? null : resolveArbAiModel(provider, options);

  if (!match || typeof match !== 'object') {
    return {
      confidenceThreshold,
      eligible: false,
      model,
      priority: 0,
      provider,
      reason: 'missing-match',
    };
  }

  if (match.matcher !== 'hybrid') {
    return {
      confidenceThreshold,
      eligible: false,
      model,
      priority: 0,
      provider,
      reason: 'matcher-disabled',
    };
  }

  if (provider === 'none') {
    return {
      confidenceThreshold,
      eligible: false,
      model,
      priority: 0,
      provider,
      reason: 'provider-unavailable',
    };
  }

  if (Array.isArray(match.semanticBlockers) && match.semanticBlockers.length) {
    return {
      confidenceThreshold,
      eligible: false,
      model,
      priority: 0,
      provider,
      reason: 'semantic-blockers',
    };
  }

  if (!match.passesSemanticFilters) {
    return {
      confidenceThreshold,
      eligible: false,
      model,
      priority: 0,
      provider,
      reason: 'semantic-filters-failed',
    };
  }

  const score = Number(match.score) || 0;
  const similarityThreshold = Number(match.similarityThreshold) || 0;
  const contentTokenScore = Number(match.contentTokenScore) || 0;
  const minTokenScore = Number(match.minTokenScore) || 0;
  const jaroWinkler = Number(match.jaroWinkler) || 0;
  const sharedSubjects = Array.isArray(match.sharedSubjects) ? match.sharedSubjects : [];
  const sharedPredicates = Array.isArray(match.sharedPredicateFamilies) ? match.sharedPredicateFamilies : [];
  const semanticWarnings = Array.isArray(match.semanticWarnings) ? match.semanticWarnings : [];
  const similaritySlack = Math.abs(score - similarityThreshold);

  const weakAccepted = Boolean(match.accepted) && (
    semanticWarnings.length > 0
    || score <= similarityThreshold + 0.08
    || contentTokenScore <= Math.max(minTokenScore + 0.08, 0.2)
    || sharedSubjects.length === 0
  );
  const rescueCandidate = !match.accepted && Boolean(match.strongSemanticEquivalent) && (
    score >= Math.max(0.48, similarityThreshold - 0.2)
    || jaroWinkler >= 0.8
    || contentTokenScore >= 0.18
  );
  const warningCandidate = !match.accepted && semanticWarnings.length > 0 && (
    score >= Math.max(0.5, similarityThreshold - 0.16)
    || contentTokenScore >= 0.16
    || jaroWinkler >= 0.76
  );

  let reason = 'not-borderline';
  let priority = 0;
  if (weakAccepted) {
    reason = 'weak-accepted-match';
    priority += 0.6;
  }
  if (rescueCandidate) {
    reason = reason === 'not-borderline' ? 'strong-semantic-rescue' : reason;
    priority += 0.55;
  }
  if (warningCandidate) {
    reason = reason === 'not-borderline' ? 'semantic-warning-rescue' : reason;
    priority += 0.45;
  }

  if (priority <= 0) {
    return {
      confidenceThreshold,
      eligible: false,
      model,
      priority: 0,
      provider,
      reason,
    };
  }

  priority += Math.max(0, 0.2 - similaritySlack);
  priority += semanticWarnings.length * 0.05;
  priority += sharedSubjects.length ? 0.05 : 0;
  priority += sharedPredicates.length ? 0.05 : 0;
  priority += match.strongSemanticEquivalent ? 0.1 : 0;

  return {
    confidenceThreshold,
    eligible: true,
    model,
    priority: round(priority, 6),
    provider,
    reason,
  };
}

function buildAdjudicationInput(leftQuestion, rightQuestion, options = {}, match) {
  return {
    leftQuestion,
    rightQuestion,
    leftRules: options.leftRules || '',
    rightRules: options.rightRules || '',
    leftVenue: options.leftVenue || null,
    rightVenue: options.rightVenue || null,
    leftMarketId: options.leftMarketId || null,
    rightMarketId: options.rightMarketId || null,
    leftSignature: match.leftSignature,
    rightSignature: match.rightSignature,
    similarityScore: match.score,
    semanticScore: match.semanticScore,
    heuristicAccepted: match.heuristicAccepted,
    semanticWarnings: match.semanticWarnings,
    sharedSubjects: match.sharedSubjects,
    sharedPredicateFamilies: match.sharedPredicateFamilies,
    sharedYears: match.sharedYears,
  };
}

async function evaluateArbitrageQuestionMatchAsync(leftQuestion, rightQuestion, options = {}) {
  const baseMatch = options.baseMatch && typeof options.baseMatch === 'object'
    ? options.baseMatch
    : evaluateArbitrageQuestionMatch(leftQuestion, rightQuestion, options);
  const plan = options.adjudicationPlan && typeof options.adjudicationPlan === 'object'
    ? options.adjudicationPlan
    : shouldAdjudicateArbitrageMatch(baseMatch, options);

  const enrichedBase = {
    ...baseMatch,
    aiProvider: plan.provider,
    aiModel: plan.model,
    aiConfidenceThreshold: plan.confidenceThreshold,
    aiEligibilityReason: plan.reason,
    aiEligible: Boolean(plan.eligible),
  };

  if (!plan.eligible) {
    return enrichedBase;
  }

  const cacheKey = canCacheAdjudicationResult(options, plan.provider)
    ? buildAdjudicationCacheKey(leftQuestion, rightQuestion, options, plan.provider, plan.model)
    : null;

  try {
    const cached = getCachedAdjudicationResult(cacheKey);
    const adjudication = cached || await adjudicateArbitragePair(
      buildAdjudicationInput(leftQuestion, rightQuestion, options, baseMatch),
      options,
    );
    if (!cached && cacheKey) {
      setCachedAdjudicationResult(cacheKey, adjudication);
    }

    const highConfidence = Boolean(adjudication && adjudication.confidence >= plan.confidenceThreshold);
    const accepted = highConfidence ? Boolean(adjudication.equivalent) : baseMatch.accepted;
    const decisionSource = highConfidence
      ? (accepted === baseMatch.accepted ? 'ai-confirmed' : 'ai-overridden')
      : baseMatch.decisionSource;

    return {
      ...enrichedBase,
      accepted,
      decisionSource,
      aiConsidered: true,
      aiAdjudicated: true,
      aiApplied: highConfidence,
      aiHighConfidence: highConfidence,
      aiProvider: adjudication.provider || plan.provider,
      aiModel: adjudication.model || plan.model,
      aiAdjudication: adjudication,
    };
  } catch (err) {
    return {
      ...enrichedBase,
      aiConsidered: true,
      aiAdjudicated: false,
      aiApplied: false,
      aiHighConfidence: false,
      aiError: {
        code: err && err.code ? err.code : 'ARB_AI_ERROR',
        message: err && err.message ? err.message : String(err),
      },
    };
  }
}

module.exports = {
  DEFAULT_ARBITRAGE_MATCHER,
  SUPPORTED_ARBITRAGE_MATCHERS,
  buildSemanticSignature,
  evaluateArbitrageQuestionMatch,
  evaluateArbitrageQuestionMatchAsync,
  evaluateSemanticCompatibility,
  normalizeArbitrageMatcher,
  shouldAdjudicateArbitrageMatch,
};
