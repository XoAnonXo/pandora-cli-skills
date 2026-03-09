const READ_SURFACE_SCHEMA_VERSION = '1.0.0';

function toStringOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildScheduleRow(event) {
  if (!event || typeof event !== 'object') return null;
  return {
    eventId: toStringOrNull(event.id),
    competitionId: toStringOrNull(event.competitionId),
    homeTeam: toStringOrNull(event.homeTeam),
    awayTeam: toStringOrNull(event.awayTeam),
    kickoffAt: toStringOrNull(event.startTime),
    status: toStringOrNull(event.status) || 'unknown',
    marketType: toStringOrNull(event.marketType),
    provider: toStringOrNull(event.provider),
  };
}

function buildScoreRow(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const event = entry.event && typeof entry.event === 'object' ? entry.event : null;
  const status = entry.status && typeof entry.status === 'object' ? entry.status : null;

  const eventId = toStringOrNull(status && status.eventId) || toStringOrNull(event && event.id);
  if (!eventId) return null;

  const homeScore = toNumberOrNull(status && status.homeScore);
  const awayScore = toNumberOrNull(status && status.awayScore);

  return {
    eventId,
    competitionId: toStringOrNull(status && status.competitionId) || toStringOrNull(event && event.competitionId),
    homeTeam: toStringOrNull(status && status.homeTeam) || toStringOrNull(event && event.homeTeam),
    awayTeam: toStringOrNull(status && status.awayTeam) || toStringOrNull(event && event.awayTeam),
    kickoffAt: toStringOrNull(status && status.startTime) || toStringOrNull(event && event.startTime),
    status: toStringOrNull(status && status.status) || toStringOrNull(event && event.status) || 'unknown',
    inPlay: status ? Boolean(status.inPlay) : toStringOrNull(event && event.status) === 'live',
    updatedAt: toStringOrNull(status && status.updatedAt),
    score: toStringOrNull(status && status.score),
    homeScore,
    awayScore,
    result: toStringOrNull(status && status.result),
    finalResult: toStringOrNull(status && status.finalResult),
    provider: toStringOrNull(status && status.provider) || toStringOrNull(event && event.provider),
  };
}

function buildSportsSchedulePayload(payload, options = {}) {
  const events = Array.isArray(payload && payload.events) ? payload.events : [];
  const schedule = events.map((event) => buildScheduleRow(event)).filter(Boolean);

  return {
    schemaVersion: READ_SURFACE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    provider: toStringOrNull(payload && payload.provider) || toStringOrNull(options.provider) || 'auto',
    mode: toStringOrNull(payload && payload.mode) || toStringOrNull(options.provider) || 'auto',
    competition: toStringOrNull(options.competition),
    count: schedule.length,
    schedule,
  };
}

function buildSportsScoresPayload(input = {}, options = {}) {
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const diagnostics = Array.isArray(input.diagnostics) ? input.diagnostics : [];
  const scores = entries.map((entry) => buildScoreRow(entry)).filter(Boolean);

  return {
    schemaVersion: READ_SURFACE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    provider: toStringOrNull(input.provider) || toStringOrNull(options.provider) || 'auto',
    mode: toStringOrNull(input.mode) || toStringOrNull(options.provider) || 'auto',
    queriedEventId: toStringOrNull(options.eventId),
    competition: toStringOrNull(options.competition),
    liveOnly: Boolean(options.liveOnly),
    count: scores.length,
    scores,
    diagnostics,
  };
}

module.exports = {
  READ_SURFACE_SCHEMA_VERSION,
  buildSportsSchedulePayload,
  buildSportsScoresPayload,
};
