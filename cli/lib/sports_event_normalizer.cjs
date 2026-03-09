const NORMALIZER_SCHEMA_VERSION = '1.0.0';
const SOCCER_WINNER_MARKET_TYPE = 'soccer_winner';

/**
 * UK tier-1 sportsbook keys used as default preference/filter set.
 * These are canonical lowercase IDs used in normalized payloads.
 */
const UK_TIER1_DEFAULT_BOOKS = Object.freeze([
  'williamhill',
  'bet365',
  'ladbrokes',
  'coral',
  'paddypower',
]);

function toStringOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function round(value, decimals = 6) {
  const numeric = toNumberOrNull(value);
  if (numeric === null) return null;
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
}

function toIsoTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 1e12 ? value : value * 1000;
    return new Date(millis).toISOString();
  }

  const text = String(value).trim();
  if (!text) return null;

  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    const millis = numeric > 1e12 ? numeric : numeric * 1000;
    return new Date(millis).toISOString();
  }

  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function extractScoreValue(row, side) {
  if (!row || typeof row !== 'object') return null;

  const direct =
    row[`${side}Score`]
    ?? row[`${side}_score`]
    ?? (row.score && typeof row.score === 'object' ? row.score[side] : null)
    ?? (row.scores && typeof row.scores === 'object' ? row.scores[side] : null);

  return toNumberOrNull(direct);
}

function normalizeToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeStatus(value) {
  const token = normalizeToken(value);
  if (!token) return 'unknown';
  if (['scheduled', 'upcoming', 'notstarted', 'pregame'].includes(token)) return 'scheduled';
  if (['live', 'inplay', 'inrunning'].includes(token)) return 'live';
  if (['paused', 'interrupted', 'suspended'].includes(token)) return 'paused';
  if (['finished', 'final', 'fulltime', 'ended', 'closed', 'resulted'].includes(token)) return 'finished';
  if (['postponed', 'delayed'].includes(token)) return 'postponed';
  if (['cancelled', 'canceled', 'abandoned', 'void'].includes(token)) return 'cancelled';
  return 'unknown';
}

function fallbackId(parts, fallback) {
  const normalized = parts.map((part) => normalizeToken(part)).filter(Boolean).join('-');
  return normalized || fallback;
}

/**
 * Normalize a competition row into deterministic soccer-competition shape.
 * @param {object} row
 * @param {{provider?: string}} [context]
 * @returns {object|null}
 */
function normalizeCompetition(row, context = {}) {
  if (!row || typeof row !== 'object') return null;

  const name =
    toStringOrNull(row.name)
    || toStringOrNull(row.competition)
    || toStringOrNull(row.competitionName)
    || toStringOrNull(row.league)
    || toStringOrNull(row.leagueName)
    || toStringOrNull(row.title);
  const id =
    toStringOrNull(row.id)
    || toStringOrNull(row.competitionId)
    || toStringOrNull(row.competition_id)
    || toStringOrNull(row.leagueId)
    || toStringOrNull(row.league_id)
    || toStringOrNull(row.key)
    || fallbackId([name], null);

  if (!id && !name) return null;

  return {
    id: (id || '').toLowerCase(),
    name: name || id,
    country: toStringOrNull(row.country) || toStringOrNull(row.region) || toStringOrNull(row.area) || null,
    sport: 'soccer',
    provider: toStringOrNull(context.provider) || null,
  };
}

function outcomeNameKey(name, homeTeam, awayTeam) {
  const token = normalizeToken(name);
  if (!token) return null;
  if (['draw', 'tie', 'x'].includes(token)) return 'draw';
  if (['home', 'team1', 'one', '1'].includes(token)) return 'home';
  if (['away', 'team2', 'two', '2'].includes(token)) return 'away';

  if (homeTeam && normalizeToken(homeTeam) === token) return 'home';
  if (awayTeam && normalizeToken(awayTeam) === token) return 'away';
  return null;
}

function decimalOdds(value) {
  const text = toStringOrNull(value);
  if (!text) return null;
  if (/^[+-]\d+$/.test(text)) {
    const american = Number(text);
    if (!Number.isFinite(american) || american === 0) return null;
    if (american > 0) return round((american / 100) + 1);
    return round((100 / Math.abs(american)) + 1);
  }
  return round(toNumberOrNull(text));
}

function extractBookRows(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.bookmakers)) return payload.bookmakers;
  if (Array.isArray(payload.books)) return payload.books;
  if (Array.isArray(payload.providers)) return payload.providers;
  if (Array.isArray(payload.odds)) return payload.odds;
  if (payload.data && Array.isArray(payload.data.bookmakers)) return payload.data.bookmakers;
  return [];
}

function extractOutcomesFromBook(bookRow) {
  if (!bookRow || typeof bookRow !== 'object') return [];
  if (Array.isArray(bookRow.outcomes)) return bookRow.outcomes;
  if (Array.isArray(bookRow.prices)) return bookRow.prices;
  if (Array.isArray(bookRow.market)) return bookRow.market;
  if (Array.isArray(bookRow.markets)) {
    const winnerMarket =
      bookRow.markets.find((market) => {
        const marketToken = normalizeToken(
          market && (
            market.key
            || market.type
            || market.marketType
            || market.name
            || market.id
          ),
        );
        return ['h2h', 'winner', 'matchwinner', 'soccerwinner', '1x2'].includes(marketToken);
      })
      || bookRow.markets[0];
    if (winnerMarket && Array.isArray(winnerMarket.outcomes)) {
      return winnerMarket.outcomes;
    }
  }
  return [];
}

function normalizeBookKey(bookRow) {
  const raw =
    toStringOrNull(bookRow && bookRow.book)
    || toStringOrNull(bookRow && bookRow.key)
    || toStringOrNull(bookRow && bookRow.id)
    || toStringOrNull(bookRow && bookRow.name)
    || toStringOrNull(bookRow && bookRow.title);
  return normalizeToken(raw);
}

function normalizeBookOdds(bookRow, homeTeam, awayTeam) {
  const outcomes = extractOutcomesFromBook(bookRow);
  const normalized = { home: null, draw: null, away: null };

  for (const outcome of outcomes) {
    const key = outcomeNameKey(
      outcome && (outcome.name || outcome.label || outcome.outcome),
      homeTeam,
      awayTeam,
    );
    if (!key) continue;
    const price = decimalOdds(
      outcome
      && (
        outcome.price
        || outcome.odds
        || outcome.decimal
        || outcome.value
        || outcome.point
      ),
    );
    if (price === null) continue;
    normalized[key] = price;
  }

  if (normalized.home === null) {
    normalized.home = decimalOdds(bookRow && (bookRow.home || bookRow.homeOdds || bookRow.priceHome));
  }
  if (normalized.draw === null) {
    normalized.draw = decimalOdds(bookRow && (bookRow.draw || bookRow.drawOdds || bookRow.priceDraw || bookRow.tie));
  }
  if (normalized.away === null) {
    normalized.away = decimalOdds(bookRow && (bookRow.away || bookRow.awayOdds || bookRow.priceAway));
  }

  if (normalized.home === null && normalized.draw === null && normalized.away === null) {
    return null;
  }
  return normalized;
}

/**
 * Normalize a soccer event row into deterministic winner-event shape.
 * @param {object} row
 * @param {{provider?: string}} [context]
 * @returns {object|null}
 */
function normalizeSoccerWinnerEvent(row, context = {}) {
  if (!row || typeof row !== 'object') return null;

  const homeTeam =
    toStringOrNull(row.homeTeam)
    || toStringOrNull(row.home_team)
    || toStringOrNull(row.home_name)
    || toStringOrNull(row.home)
    || toStringOrNull(row.team1)
    || (Array.isArray(row.teams) && row.teams.length > 0 ? toStringOrNull(row.teams[0]) : null);
  const awayTeam =
    toStringOrNull(row.awayTeam)
    || toStringOrNull(row.away_team)
    || toStringOrNull(row.away_name)
    || toStringOrNull(row.away)
    || toStringOrNull(row.team2)
    || (Array.isArray(row.teams) && row.teams.length > 1 ? toStringOrNull(row.teams[1]) : null);

  const startTime =
    toIsoTimestamp(row.startTime)
    || toIsoTimestamp(row.startsAt)
    || toIsoTimestamp(row.commenceTime)
    || toIsoTimestamp(row.commence_time)
    || toIsoTimestamp(row.kickoff)
    || null;

  const competitionId =
    toStringOrNull(row.competitionId)
    || toStringOrNull(row.competition_id)
    || toStringOrNull(row.sportKey)
    || toStringOrNull(row.sport_key)
    || toStringOrNull(row.sport)
    || toStringOrNull(row.leagueId)
    || toStringOrNull(row.league_id)
    || toStringOrNull(row.tournamentId)
    || null;

  const id =
    toStringOrNull(row.id)
    || toStringOrNull(row.eventId)
    || toStringOrNull(row.event_id)
    || toStringOrNull(row.fixtureId)
    || fallbackId([competitionId, homeTeam, awayTeam, startTime], null);

  if (!id || !homeTeam || !awayTeam) return null;

  return {
    id: id.toLowerCase(),
    competitionId: competitionId ? competitionId.toLowerCase() : null,
    sport: 'soccer',
    marketType: SOCCER_WINNER_MARKET_TYPE,
    homeTeam,
    awayTeam,
    startTime,
    status: normalizeStatus(row.status || row.state || row.matchStatus || row.match_status),
    provider: toStringOrNull(context.provider) || null,
  };
}

/**
 * Normalize a provider odds payload into soccer winner odds shape.
 * @param {object} payload
 * @param {{provider?: string, eventId?: string, marketType?: string, preferredBooks?: string[]}} [context]
 * @returns {object}
 */
function normalizeSoccerWinnerOdds(payload, context = {}) {
  const eventRow = payload && (payload.event || payload.fixture || payload.match || payload);
  const event = normalizeSoccerWinnerEvent(eventRow || {}, context) || {
    id: toStringOrNull(context.eventId) || null,
    competitionId: null,
    sport: 'soccer',
    marketType: SOCCER_WINNER_MARKET_TYPE,
    homeTeam: toStringOrNull(payload && (payload.homeTeam || payload.home_team || payload.home_name || payload.home)) || null,
    awayTeam: toStringOrNull(payload && (payload.awayTeam || payload.away_team || payload.away_name || payload.away)) || null,
    startTime: null,
    status: 'unknown',
    provider: toStringOrNull(context.provider) || null,
  };

  const preferredBooks = Array.isArray(context.preferredBooks) && context.preferredBooks.length
    ? context.preferredBooks.map((item) => normalizeToken(item)).filter(Boolean)
    : UK_TIER1_DEFAULT_BOOKS;
  const preferredBookSet = new Set(preferredBooks);

  const books = [];
  for (const bookRow of extractBookRows(payload)) {
    const book = normalizeBookKey(bookRow);
    if (!book) continue;
    const outcomes = normalizeBookOdds(bookRow, event.homeTeam, event.awayTeam);
    if (!outcomes) continue;
    books.push({
      book,
      bookName:
        toStringOrNull(bookRow.name)
        || toStringOrNull(bookRow.title)
        || toStringOrNull(bookRow.book)
        || book,
      outcomes,
    });
  }

  const preferredOnly = books.filter((bookRow) => preferredBookSet.has(bookRow.book));
  const selectedBooks = (preferredOnly.length ? preferredOnly : books)
    .sort((a, b) => a.book.localeCompare(b.book));

  const bestOdds = {
    home: null,
    draw: null,
    away: null,
  };
  for (const bookRow of selectedBooks) {
    if (bookRow.outcomes.home !== null && (bestOdds.home === null || bookRow.outcomes.home > bestOdds.home)) {
      bestOdds.home = bookRow.outcomes.home;
    }
    if (bookRow.outcomes.draw !== null && (bestOdds.draw === null || bookRow.outcomes.draw > bestOdds.draw)) {
      bestOdds.draw = bookRow.outcomes.draw;
    }
    if (bookRow.outcomes.away !== null && (bestOdds.away === null || bookRow.outcomes.away > bestOdds.away)) {
      bestOdds.away = bookRow.outcomes.away;
    }
  }

  return {
    schemaVersion: NORMALIZER_SCHEMA_VERSION,
    provider: toStringOrNull(context.provider) || null,
    marketType: SOCCER_WINNER_MARKET_TYPE,
    event,
    updatedAt: toIsoTimestamp(payload && (payload.updatedAt || payload.lastUpdated || payload.timestamp)) || new Date().toISOString(),
    preferredBooks,
    bookCount: selectedBooks.length,
    books: selectedBooks,
    bestOdds,
  };
}

/**
 * Normalize an event-status payload into deterministic shape.
 * @param {object} payload
 * @param {{provider?: string, eventId?: string}} [context]
 * @returns {object}
 */
function normalizeEventStatus(payload, context = {}) {
  const row = payload && (payload.event || payload.fixture || payload.match || payload);
  const event = normalizeSoccerWinnerEvent(row || {}, context);
  const homeScore = extractScoreValue(row, 'home');
  const awayScore = extractScoreValue(row, 'away');
  const score =
    toStringOrNull(row && (row.score || row.scoreline || row.scoreLine || row.resultScore || row.finalScore))
    || (homeScore !== null && awayScore !== null ? `${homeScore}-${awayScore}` : null);

  return {
    schemaVersion: NORMALIZER_SCHEMA_VERSION,
    provider: toStringOrNull(context.provider) || null,
    eventId: toStringOrNull(context.eventId) || (event ? event.id : null),
    competitionId: event ? event.competitionId : null,
    homeTeam: event ? event.homeTeam : null,
    awayTeam: event ? event.awayTeam : null,
    status: normalizeStatus(row && (row.status || row.state || row.matchStatus || row.match_status)),
    startTime:
      toIsoTimestamp(row && (row.startTime || row.startsAt || row.commenceTime || row.commence_time || row.kickoff))
      || (event ? event.startTime : null),
    updatedAt: toIsoTimestamp(row && (row.updatedAt || row.lastUpdated || row.timestamp)) || null,
    inPlay: normalizeStatus(row && (row.status || row.state || row.matchStatus || row.match_status)) === 'live',
    score,
    homeScore,
    awayScore,
    result: toStringOrNull(row && (row.result || row.outcome || row.answer)),
    finalResult: toStringOrNull(row && (row.finalResult || row.final_result)),
  };
}

/**
 * Normalize and sort a list of competition rows.
 * @param {object[]} rows
 * @param {{provider?: string}} [context]
 * @returns {object[]}
 */
function normalizeCompetitions(rows, context = {}) {
  const normalized = (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeCompetition(row, context))
    .filter(Boolean);
  normalized.sort((a, b) => {
    const nameCmp = String(a.name).localeCompare(String(b.name));
    if (nameCmp !== 0) return nameCmp;
    return String(a.id).localeCompare(String(b.id));
  });
  return normalized;
}

/**
 * Normalize and sort a list of soccer winner events.
 * @param {object[]} rows
 * @param {{provider?: string}} [context]
 * @returns {object[]}
 */
function normalizeSoccerWinnerEvents(rows, context = {}) {
  const normalized = (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeSoccerWinnerEvent(row, context))
    .filter(Boolean);
  normalized.sort((a, b) => {
    const timeA = a.startTime || '';
    const timeB = b.startTime || '';
    const timeCmp = timeA.localeCompare(timeB);
    if (timeCmp !== 0) return timeCmp;
    return a.id.localeCompare(b.id);
  });
  return normalized;
}

module.exports = {
  NORMALIZER_SCHEMA_VERSION,
  SOCCER_WINNER_MARKET_TYPE,
  UK_TIER1_DEFAULT_BOOKS,
  normalizeCompetition,
  normalizeCompetitions,
  normalizeSoccerWinnerEvent,
  normalizeSoccerWinnerEvents,
  normalizeSoccerWinnerOdds,
  normalizeEventStatus,
};
