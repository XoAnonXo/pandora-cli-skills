const DEFAULT_MIRROR_MIN_CLOSE_LEAD_SECONDS = 3600;

const MIRROR_SPORT_TIMING_PROFILES = Object.freeze({
  basketball: Object.freeze({
    key: 'basketball',
    expectedDurationMinutes: 150,
    resolutionBufferMinutes: 30,
    minimumTradingBufferMinutes: 90,
  }),
  soccer: Object.freeze({
    key: 'soccer',
    expectedDurationMinutes: 120,
    resolutionBufferMinutes: 20,
    minimumTradingBufferMinutes: 30,
  }),
  sports: Object.freeze({
    key: 'sports',
    expectedDurationMinutes: 150,
    resolutionBufferMinutes: 30,
    minimumTradingBufferMinutes: 45,
  }),
});

function normalizeComparableText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|fc|cf|sc|ac|club)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toUnixSeconds(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  }
  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) return null;
  return Math.floor(parsed / 1000);
}

function formatTimestampIso(value) {
  const unixSeconds = toUnixSeconds(value);
  return Number.isFinite(unixSeconds) ? new Date(unixSeconds * 1000).toISOString() : null;
}

function parseMirrorTargetTimestampInput(value) {
  if (value === null || value === undefined || value === '') return null;
  const unixSeconds = toUnixSeconds(value);
  return Number.isFinite(unixSeconds) && unixSeconds > 0 ? unixSeconds : null;
}

function collectMirrorTimingTextPool(sourceMarket) {
  const raw = sourceMarket && sourceMarket.raw && typeof sourceMarket.raw === 'object' ? sourceMarket.raw : {};
  const tagEntries = []
    .concat(Array.isArray(raw.tags) ? raw.tags : [])
    .concat(Array.isArray(raw.tag_ids) ? raw.tag_ids : [])
    .concat(Array.isArray(raw.tagIds) ? raw.tagIds : []);
  const tagText = [];
  for (const entry of tagEntries) {
    if (entry === null || entry === undefined) continue;
    if (typeof entry === 'string' || typeof entry === 'number') {
      tagText.push(String(entry));
      continue;
    }
    if (typeof entry === 'object') {
      for (const key of ['name', 'slug', 'label', 'title', 'group', 'topic', 'category', 'shortName', 'short_name']) {
        if (entry[key]) tagText.push(String(entry[key]));
      }
    }
  }
  return [
    sourceMarket && sourceMarket.question,
    sourceMarket && sourceMarket.eventTitle,
    sourceMarket && sourceMarket.eventSlug,
    sourceMarket && sourceMarket.slug,
    raw.sport,
    raw.sport_type,
    raw.league,
    raw.competition,
    ...tagText,
  ]
    .map((value) => normalizeComparableText(value))
    .filter(Boolean)
    .join(' ');
}

function inferMirrorSportTimingProfile(sourceMarket) {
  const haystack = collectMirrorTimingTextPool(sourceMarket);
  if (!haystack) return null;
  if (/\b(nba|basketball)\b/.test(haystack)) {
    return MIRROR_SPORT_TIMING_PROFILES.basketball;
  }
  if (/\b(soccer|football|premier league|epl|uefa|fifa|mls|la liga|serie a|bundesliga|champions league)\b/.test(haystack)) {
    return MIRROR_SPORT_TIMING_PROFILES.soccer;
  }
  if (/\b(sport|sports|nfl|nhl|mlb|tennis|ufc|mma|formula 1|f1|cricket)\b/.test(haystack)) {
    return MIRROR_SPORT_TIMING_PROFILES.sports;
  }
  return null;
}

function buildMirrorTimingData(sourceMarket, minCloseLeadSecondsInput) {
  const minCloseLeadSeconds = Number.isFinite(Number(minCloseLeadSecondsInput))
    ? Math.max(0, Math.trunc(Number(minCloseLeadSecondsInput)))
    : DEFAULT_MIRROR_MIN_CLOSE_LEAD_SECONDS;
  const sourceTimestamp = toUnixSeconds(sourceMarket && sourceMarket.closeTimestamp);
  const eventStartTimestamp = toUnixSeconds(sourceMarket && sourceMarket.eventStartTimestamp) || sourceTimestamp;
  const sourceCloseTimestamp = toUnixSeconds(sourceMarket && sourceMarket.sourceCloseTimestamp);
  const timestampSource = String(
    (sourceMarket && sourceMarket.timestampSource)
    || (sourceMarket && sourceMarket.eventStartTimestamp ? 'game_start_time' : sourceMarket && sourceMarket.closeTimestamp ? 'source_timestamp' : ''),
  ).trim() || null;
  const profile = inferMirrorSportTimingProfile(sourceMarket);
  const warnings = [];
  let suggestedTargetTimestamp = sourceTimestamp;
  let expectedEndTimestamp = null;
  let tradingCutoffTimestamp = null;
  let reason = null;

  if (profile && eventStartTimestamp) {
    expectedEndTimestamp = eventStartTimestamp + (profile.expectedDurationMinutes * 60);
    const baseSuggestedTargetTimestamp = expectedEndTimestamp + (profile.resolutionBufferMinutes * 60);
    const minimumTradingCutoffTimestamp = expectedEndTimestamp + (profile.minimumTradingBufferMinutes * 60);
    suggestedTargetTimestamp = Math.max(baseSuggestedTargetTimestamp, minimumTradingCutoffTimestamp + minCloseLeadSeconds);
    tradingCutoffTimestamp = suggestedTargetTimestamp - minCloseLeadSeconds;

    if (timestampSource === 'game_start_time') {
      warnings.push('Polymarket provided game_start_time, which is the event start. Mirror deploy should use a later targetTimestamp that covers event completion and a buffer.');
    }
    if (tradingCutoffTimestamp <= expectedEndTimestamp) {
      warnings.push('With the current close lead, trading would stop before the expected regulation end. Increase targetTimestamp or reduce min-close-lead-seconds.');
    } else if (tradingCutoffTimestamp < minimumTradingCutoffTimestamp) {
      warnings.push('With the current close lead, trading would stop too close to the expected finish and may not cover overtime or stoppage time.');
    }

    reason = `Suggested targetTimestamp uses ${profile.key} timing defaults: expected duration ${profile.expectedDurationMinutes}m, resolution buffer ${profile.resolutionBufferMinutes}m, and trading cutoff buffer ${profile.minimumTradingBufferMinutes}m before the close lead.`;
  } else {
    if (timestampSource === 'game_start_time' && sourceTimestamp) {
      warnings.push('Only a sports start time was available from Polymarket. Review targetTimestamp manually if you deploy this market.');
    }
    if (sourceTimestamp) {
      tradingCutoffTimestamp = sourceTimestamp - minCloseLeadSeconds;
    }
  }

  return {
    sourceTimestamp,
    sourceTimestampIso: formatTimestampIso(sourceTimestamp),
    sourceTimestampKind: timestampSource,
    sourceCloseTimestamp,
    sourceCloseTimestampIso: formatTimestampIso(sourceCloseTimestamp),
    eventStartTimestamp,
    eventStartTimestampIso: formatTimestampIso(eventStartTimestamp),
    expectedEndTimestamp,
    expectedEndTimestampIso: formatTimestampIso(expectedEndTimestamp),
    suggestedTargetTimestamp,
    suggestedTargetTimestampIso: formatTimestampIso(suggestedTargetTimestamp),
    tradingCutoffTimestamp,
    tradingCutoffTimestampIso: formatTimestampIso(tradingCutoffTimestamp),
    minCloseLeadSeconds,
    profile: profile
      ? {
          sport: profile.key,
          expectedDurationMinutes: profile.expectedDurationMinutes,
          resolutionBufferMinutes: profile.resolutionBufferMinutes,
          minimumTradingBufferMinutes: profile.minimumTradingBufferMinutes,
        }
      : null,
    reason,
    warnings,
  };
}

function resolveMirrorGateCloseTimestamp(sourceMarket, minCloseLeadSecondsInput) {
  const timing = buildMirrorTimingData(sourceMarket, minCloseLeadSecondsInput);
  const suggestedClose = parseMirrorTargetTimestampInput(
    timing && timing.suggestedTargetTimestamp !== null && timing.suggestedTargetTimestamp !== undefined
      ? timing.suggestedTargetTimestamp
      : null,
  );
  const explicitSourceClose = parseMirrorTargetTimestampInput(
    timing && timing.sourceCloseTimestamp !== null && timing.sourceCloseTimestamp !== undefined
      ? timing.sourceCloseTimestamp
      : sourceMarket && sourceMarket.closeTimestamp,
  );
  const candidate =
    suggestedClose !== null && explicitSourceClose !== null
      ? Math.max(suggestedClose, explicitSourceClose)
      : suggestedClose !== null
        ? suggestedClose
        : explicitSourceClose;
  return {
    closeTimestamp: candidate,
    timing,
  };
}

module.exports = {
  DEFAULT_MIRROR_MIN_CLOSE_LEAD_SECONDS,
  MIRROR_SPORT_TIMING_PROFILES,
  normalizeComparableText,
  toUnixSeconds,
  formatTimestampIso,
  parseMirrorTargetTimestampInput,
  collectMirrorTimingTextPool,
  inferMirrorSportTimingProfile,
  buildMirrorTimingData,
  resolveMirrorGateCloseTimestamp,
};
