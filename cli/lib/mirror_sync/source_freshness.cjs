const { DEFAULT_POLYMARKET_MARKET_FEED_URL } = require('../polymarket_adapter.cjs');

const DEFAULT_MIRROR_SOURCE_MAX_AGE_MS = 60_000;
const DEFAULT_MIRROR_SPORTS_SOURCE_MAX_AGE_MS = 15_000;
const DEFAULT_MIRROR_SOURCE_STREAM_TIMEOUT_MS = 2_500;

function toTimestampMs(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.abs(value) < 1e11 ? Math.trunc(value * 1000) : Math.trunc(value);
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.abs(numeric) < 1e11 ? Math.trunc(numeric * 1000) : Math.trunc(numeric);
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function inferSourceTransport(sourceMarket = {}) {
  const freshness = sourceMarket.sourceFreshness && typeof sourceMarket.sourceFreshness === 'object'
    ? sourceMarket.sourceFreshness
    : null;
  const explicit = String((freshness && freshness.transport) || '').trim().toLowerCase();
  if (explicit) return explicit;
  const source = String(sourceMarket.source || '').trim().toLowerCase();
  if (source === 'polymarket:feed' || source === 'polymarket:live-feed') return 'stream';
  if (source === 'polymarket:cache') return 'cache';
  if (source === 'polymarket:mock') return 'mock';
  if (source.startsWith('polymarket:gamma') || source.startsWith('polymarket:clob')) return 'poll';
  return 'unknown';
}

function isSportsLikePolymarketSource(sourceMarket = {}) {
  if (!sourceMarket || typeof sourceMarket !== 'object') return false;
  if (String(sourceMarket.timestampSource || '').toLowerCase() === 'game_start_time') return true;
  const eventStartMs = toTimestampMs(sourceMarket.eventStartTimestamp);
  const sourceCloseMs = toTimestampMs(sourceMarket.sourceCloseTimestamp);
  return eventStartMs !== null && sourceCloseMs !== null && eventStartMs !== sourceCloseMs;
}

function resolveMirrorSourceFreshnessPolicy(options = {}, sourceMarket = {}) {
  const intervalMs = Number.isFinite(Number(options.intervalMs)) && Number(options.intervalMs) > 0
    ? Math.trunc(Number(options.intervalMs))
    : 45_000;
  const executeLive = Boolean(options.executeLive);
  const sportsLike = isSportsLikePolymarketSource(sourceMarket);
  const transport = inferSourceTransport(sourceMarket);
  const streamCapable = Boolean(sourceMarket.yesTokenId && sourceMarket.noTokenId && transport !== 'cache' && transport !== 'mock');
  const explicitMaxAgeMs = Number.isFinite(Number(options.sourceMaxAgeMs)) && Number(options.sourceMaxAgeMs) > 0
    ? Math.trunc(Number(options.sourceMaxAgeMs))
    : null;

  let maxAgeMs;
  if (explicitMaxAgeMs !== null) {
    maxAgeMs = explicitMaxAgeMs;
  } else if (sportsLike) {
    const sportsBudgetMs = Math.max(5_000, Math.min(DEFAULT_MIRROR_SPORTS_SOURCE_MAX_AGE_MS, intervalMs * 2));
    maxAgeMs = executeLive ? sportsBudgetMs : Math.max(sportsBudgetMs, 30_000);
  } else {
    maxAgeMs = Math.max(15_000, Math.min(DEFAULT_MIRROR_SOURCE_MAX_AGE_MS, intervalMs * 3));
  }

  const streamPreferred = Boolean(streamCapable && executeLive && sportsLike && intervalMs <= 15_000);

  return {
    intervalMs,
    executeLive,
    sportsLike,
    transport,
    streamCapable,
    streamPreferred,
    requiresFresh: Boolean(executeLive || sportsLike),
    maxAgeMs,
  };
}

function assessMirrorSourceFreshness(sourceMarket = {}, options = {}) {
  const policy = resolveMirrorSourceFreshnessPolicy(options, sourceMarket);
  const freshness = sourceMarket.sourceFreshness && typeof sourceMarket.sourceFreshness === 'object'
    ? sourceMarket.sourceFreshness
    : {};
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const observedAt =
    freshness.observedAt
    || freshness.feedObservedAt
    || freshness.polledAt
    || freshness.requestedAt
    || null;
  const observedAtMs = toTimestampMs(observedAt);
  const ageMs = observedAtMs === null ? null : Math.max(0, Math.trunc(nowMs - observedAtMs));
  const fresh = ageMs === null ? false : ageMs <= policy.maxAgeMs;

  let reason = null;
  if (observedAtMs === null) {
    reason = 'missing-observed-at';
  } else if (!fresh) {
    reason = `source-age-${ageMs}ms-exceeds-${policy.maxAgeMs}ms`;
  } else if (policy.streamPreferred && policy.transport !== 'stream') {
    reason = 'stream-recommended-for-short-interval-sports';
  }

  return {
    ...policy,
    observedAt,
    ageMs,
    fresh,
    stale: !fresh,
    reason,
  };
}

function buildMirrorSourceSubscriptionRequest(sourceMarket = {}, options = {}) {
  const policy = resolveMirrorSourceFreshnessPolicy(options, sourceMarket);
  const assetIds = [sourceMarket.yesTokenId, sourceMarket.noTokenId].filter(Boolean);
  const timeoutMs = Number.isFinite(Number(options.feedTimeoutMs)) && Number(options.feedTimeoutMs) > 0
    ? Math.trunc(Number(options.feedTimeoutMs))
    : Math.max(500, Math.min(DEFAULT_MIRROR_SOURCE_STREAM_TIMEOUT_MS, Math.floor(policy.maxAgeMs / 2)));
  return {
    enabled: Boolean(policy.streamCapable && (policy.streamPreferred || options.enableRealtimeSourceFeed === true)),
    preferred: policy.streamPreferred,
    feedUrl: options.feedUrl || process.env.POLYMARKET_MARKET_FEED_URL || DEFAULT_POLYMARKET_MARKET_FEED_URL,
    assetIds,
    timeoutMs,
    policy,
  };
}

module.exports = {
  DEFAULT_MIRROR_SOURCE_MAX_AGE_MS,
  DEFAULT_MIRROR_SPORTS_SOURCE_MAX_AGE_MS,
  DEFAULT_MIRROR_SOURCE_STREAM_TIMEOUT_MS,
  isSportsLikePolymarketSource,
  resolveMirrorSourceFreshnessPolicy,
  assessMirrorSourceFreshness,
  buildMirrorSourceSubscriptionRequest,
};
