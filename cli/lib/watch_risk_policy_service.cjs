const { round, toOptionalNumber } = require('./shared/utils.cjs');

const WATCH_RISK_POLICY_SCHEMA_VERSION = '1.0.0';

const LIMIT_DEFINITIONS = Object.freeze([
  {
    key: 'maxTradeSizeUsdc',
    metric: 'tradeSizeUsdc',
    envKeys: ['PANDORA_WATCH_RISK_MAX_TRADE_SIZE_USDC', 'PANDORA_WATCH_RISK_MAX_TRADE_USDC'],
    directOptionKeys: ['maxTradeSizeUsdc', 'maxTradeUsdc', 'max-trade-size-usdc', 'max-trade-usdc'],
    configOptionKeys: ['maxTradeSizeUsdc', 'maxTradeUsdc'],
    alertCode: 'TRADE_SIZE_ABOVE_LIMIT',
    message: (value, threshold) => `Projected trade size ${value} exceeds limit ${threshold}.`,
  },
  {
    key: 'maxDailyVolumeUsdc',
    metric: 'projectedDailyVolumeUsdc',
    envKeys: ['PANDORA_WATCH_RISK_MAX_DAILY_VOLUME_USDC'],
    directOptionKeys: ['maxDailyVolumeUsdc', 'maxDailyUsdc', 'max-daily-volume-usdc'],
    configOptionKeys: ['maxDailyVolumeUsdc', 'maxDailyUsdc'],
    alertCode: 'DAILY_VOLUME_ABOVE_LIMIT',
    message: (value, threshold) => `Projected daily volume ${value} exceeds limit ${threshold}.`,
  },
  {
    key: 'maxTotalExposureUsdc',
    metric: 'totalExposureUsdc',
    envKeys: ['PANDORA_WATCH_RISK_MAX_TOTAL_EXPOSURE_USDC', 'PANDORA_WATCH_RISK_MAX_OPEN_EXPOSURE_USDC'],
    directOptionKeys: ['maxTotalExposureUsdc', 'maxOpenExposureUsdc', 'max-total-exposure-usdc'],
    configOptionKeys: ['maxTotalExposureUsdc', 'maxOpenExposureUsdc'],
    alertCode: 'TOTAL_EXPOSURE_ABOVE_LIMIT',
    message: (value, threshold) => `Observed total exposure ${value} exceeds limit ${threshold}.`,
  },
  {
    key: 'maxPerMarketExposureUsdc',
    metric: 'maxObservedMarketExposureUsdc',
    envKeys: ['PANDORA_WATCH_RISK_MAX_PER_MARKET_EXPOSURE_USDC'],
    directOptionKeys: ['maxPerMarketExposureUsdc', 'maxMarketExposureUsdc', 'max-per-market-exposure-usdc'],
    configOptionKeys: ['maxPerMarketExposureUsdc', 'maxMarketExposureUsdc'],
    alertCode: 'PER_MARKET_EXPOSURE_ABOVE_LIMIT',
    message: (value, threshold, marketAddress) =>
      `Observed per-market exposure ${value} exceeds limit ${threshold}${marketAddress ? ` for ${marketAddress}` : ''}.`,
  },
  {
    key: 'maxHedgeGapUsdc',
    metric: 'hedgeGapAbsUsdc',
    envKeys: ['PANDORA_WATCH_RISK_MAX_HEDGE_GAP_USDC'],
    directOptionKeys: ['maxHedgeGapUsdc', 'maxHedgeDriftUsdc', 'max-hedge-gap-usdc'],
    configOptionKeys: ['maxHedgeGapUsdc', 'maxHedgeDriftUsdc'],
    alertCode: 'HEDGE_GAP_ABOVE_LIMIT',
    message: (value, threshold) => `Observed hedge gap ${value} exceeds limit ${threshold}.`,
  },
]);

function toNumberOrNull(value) {
  const numeric = toOptionalNumber(value);
  if (!Number.isFinite(numeric)) return null;
  return round(numeric, 6);
}

function normalizeLimitValue(value) {
  const numeric = toNumberOrNull(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return numeric;
}

function getPath(source, pathParts) {
  let current = source;
  for (const part of pathParts) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function normalizeAddress(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return /^0x[a-fA-F0-9]{40}$/.test(raw) ? raw.toLowerCase() : raw;
}

function buildPolicyCandidateList(options, definition, env) {
  const safeOptions = options && typeof options === 'object' ? options : {};
  const candidates = [];

  for (const key of definition.directOptionKeys) {
    if (Object.prototype.hasOwnProperty.call(safeOptions, key)) {
      candidates.push({
        source: `option:${key}`,
        value: safeOptions[key],
      });
    }
  }

  const overrideRoots = [
    ['riskOverrides'],
    ['riskLimitOverrides'],
    ['watchRiskOverrides'],
    ['overrides', 'risk'],
    ['watch', 'riskOverrides'],
  ];
  for (const pathParts of overrideRoots) {
    const rootValue = getPath(safeOptions, pathParts);
    if (!rootValue || typeof rootValue !== 'object') continue;
    for (const key of definition.configOptionKeys) {
      if (Object.prototype.hasOwnProperty.call(rootValue, key)) {
        candidates.push({
          source: `option:${pathParts.join('.')}.${key}`,
          value: rootValue[key],
        });
      }
    }
    if (rootValue.limits && typeof rootValue.limits === 'object') {
      for (const key of definition.configOptionKeys) {
        if (Object.prototype.hasOwnProperty.call(rootValue.limits, key)) {
          candidates.push({
            source: `option:${pathParts.join('.')}.limits.${key}`,
            value: rootValue.limits[key],
          });
        }
      }
    }
  }

  const safeEnv = env && typeof env === 'object' ? env : {};
  for (const envKey of definition.envKeys) {
    if (Object.prototype.hasOwnProperty.call(safeEnv, envKey)) {
      candidates.push({
        source: `env:${envKey}`,
        value: safeEnv[envKey],
      });
    }
  }

  const configRoots = [
    ['riskPolicy'],
    ['watchRiskPolicy'],
    ['riskLimits'],
    ['config', 'risk'],
    ['config', 'watch', 'risk'],
    ['config', 'risk', 'watch'],
    ['watch', 'risk'],
  ];
  for (const pathParts of configRoots) {
    const rootValue = getPath(safeOptions, pathParts);
    if (!rootValue || typeof rootValue !== 'object') continue;
    for (const key of definition.configOptionKeys) {
      if (Object.prototype.hasOwnProperty.call(rootValue, key)) {
        candidates.push({
          source: `config:${pathParts.join('.')}.${key}`,
          value: rootValue[key],
        });
      }
    }
    if (rootValue.limits && typeof rootValue.limits === 'object') {
      for (const key of definition.configOptionKeys) {
        if (Object.prototype.hasOwnProperty.call(rootValue.limits, key)) {
          candidates.push({
            source: `config:${pathParts.join('.')}.limits.${key}`,
            value: rootValue.limits[key],
          });
        }
      }
    }
  }

  return candidates;
}

function resolveWatchRiskPolicy(options = {}, runtime = {}) {
  const env = runtime.env || process.env;
  const limits = {};
  const sources = {};
  const overridesApplied = [];

  for (const definition of LIMIT_DEFINITIONS) {
    const candidates = buildPolicyCandidateList(options, definition, env);
    let selected = null;
    const normalizedCandidates = [];
    for (const candidate of candidates) {
      const normalized = normalizeLimitValue(candidate.value);
      if (normalized === null) continue;
      const entry = {
        source: candidate.source,
        value: normalized,
      };
      normalizedCandidates.push(entry);
      if (!selected) {
        selected = entry;
      }
    }

    limits[definition.key] = selected ? selected.value : null;
    sources[definition.key] = selected ? selected.source : null;
    if (selected && normalizedCandidates.length > 1) {
      overridesApplied.push({
        key: definition.key,
        value: selected.value,
        source: selected.source,
        overriddenSources: normalizedCandidates.slice(1).map((entry) => entry.source),
      });
    }
  }

  return {
    schemaVersion: WATCH_RISK_POLICY_SCHEMA_VERSION,
    configured: Object.values(limits).some((value) => Number.isFinite(value)),
    limits,
    sources,
    overridesApplied,
  };
}

function buildPerMarketExposureMap(portfolio) {
  const out = {};
  const positions = Array.isArray(portfolio && portfolio.positions) ? portfolio.positions : [];
  for (const position of positions) {
    const marketAddress = normalizeAddress(
      position && (position.marketAddress || position.market || position.pollAddress || position.id),
    );
    const markValueUsdc = toNumberOrNull(position && position.markValueUsdc);
    if (!marketAddress || !Number.isFinite(markValueUsdc) || markValueUsdc <= 0) continue;
    out[marketAddress] = round((out[marketAddress] || 0) + markValueUsdc, 6);
  }
  return out;
}

function firstFiniteValue(candidates) {
  for (const candidate of candidates) {
    const numeric = toNumberOrNull(candidate);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function resolveHedgeGapUsdc(snapshot, portfolio, quote) {
  return firstFiniteValue([
    snapshot && snapshot.hedgeGapUsdc,
    snapshot && snapshot.hedge && snapshot.hedge.hedgeGapUsdc,
    snapshot && snapshot.live && snapshot.live.hedgeGapUsdc,
    snapshot && snapshot.live && snapshot.live.summary && snapshot.live.summary.hedgeGapUsdc,
    snapshot && snapshot.live && snapshot.live.hedge && snapshot.live.hedge.hedgeGapUsdc,
    snapshot && snapshot.mirror && snapshot.mirror.hedge && snapshot.mirror.hedge.hedgeGapUsdc,
    snapshot && snapshot.mirror && snapshot.mirror.summary && snapshot.mirror.summary.hedgeGapUsdc,
    portfolio && portfolio.hedge && portfolio.hedge.hedgeGapUsdc,
    portfolio && portfolio.summary && portfolio.summary.hedgeGapUsdc,
    portfolio && portfolio.live && portfolio.live.hedgeGapUsdc,
    portfolio && portfolio.live && portfolio.live.summary && portfolio.live.summary.hedgeGapUsdc,
    quote && quote.hedgeGapUsdc,
  ]);
}

function buildWatchRiskMetrics(params = {}) {
  const snapshot = params.snapshot && typeof params.snapshot === 'object' ? params.snapshot : {};
  const options = params.options && typeof params.options === 'object' ? params.options : {};
  const portfolio = params.portfolio && typeof params.portfolio === 'object' ? params.portfolio : null;
  const quote = params.quote && typeof params.quote === 'object' ? params.quote : null;
  const state = params.state && typeof params.state === 'object' ? params.state : {};

  const tradeSizeUsdc = quote
    ? firstFiniteValue([quote.amountUsdc, options.amountUsdc])
    : options.marketAddress
      ? firstFiniteValue([options.amountUsdc])
      : null;

  if (!Number.isFinite(toNumberOrNull(state.projectedDailyVolumeUsdc))) {
    state.projectedDailyVolumeUsdc = 0;
  }
  if (Number.isFinite(tradeSizeUsdc)) {
    state.projectedDailyVolumeUsdc = round((state.projectedDailyVolumeUsdc || 0) + tradeSizeUsdc, 6);
  }

  const perMarketExposureUsdc = buildPerMarketExposureMap(portfolio);
  const exposureEntries = Object.entries(perMarketExposureUsdc);
  const maxObservedMarket = exposureEntries.reduce(
    (best, entry) => {
      if (!best || entry[1] > best.value) {
        return { marketAddress: entry[0], value: entry[1] };
      }
      return best;
    },
    null,
  );

  const totalExposureUsdc = firstFiniteValue([
    portfolio && portfolio.summary && portfolio.summary.totalPositionMarkValueUsdc,
    exposureEntries.reduce((sum, entry) => sum + entry[1], 0),
  ]);

  const currentMarketAddress = normalizeAddress(
    options.marketAddress || (quote && quote.marketAddress) || (snapshot && snapshot.marketAddress),
  );
  const currentMarketExposureUsdc = currentMarketAddress && Object.prototype.hasOwnProperty.call(perMarketExposureUsdc, currentMarketAddress)
    ? perMarketExposureUsdc[currentMarketAddress]
    : null;

  const hedgeGapUsdc = resolveHedgeGapUsdc(snapshot, portfolio, quote);
  const hedgeGapAbsUsdc = hedgeGapUsdc === null ? null : round(Math.abs(hedgeGapUsdc), 6);

  return {
    tradeSizeUsdc,
    projectedDailyVolumeUsdc: toNumberOrNull(state.projectedDailyVolumeUsdc),
    totalExposureUsdc,
    currentMarketExposureUsdc,
    maxObservedMarketExposureUsdc: maxObservedMarket ? maxObservedMarket.value : null,
    maxObservedMarketAddress: maxObservedMarket ? maxObservedMarket.marketAddress : null,
    perMarketExposureUsdc,
    hedgeGapUsdc,
    hedgeGapAbsUsdc,
  };
}

function buildThresholdAlert(params) {
  const definition = params.definition;
  const snapshot = params.snapshot;
  return {
    category: 'risk',
    code: definition.alertCode,
    metric: params.metric,
    comparator: 'gt',
    threshold: params.threshold,
    value: params.value,
    message: params.message,
    limitKey: definition.key,
    iteration: snapshot && snapshot.iteration ? snapshot.iteration : null,
    timestamp: snapshot && snapshot.timestamp ? snapshot.timestamp : null,
    scope: params.scope || null,
    marketAddress: params.marketAddress || null,
    projected: Boolean(params.projected),
    source: 'watch-risk-policy',
    dryRunSafe: true,
  };
}

function evaluateWatchRiskAlerts(params = {}) {
  const snapshot = params.snapshot && typeof params.snapshot === 'object' ? params.snapshot : {};
  const policy = params.policy && typeof params.policy === 'object' ? params.policy : resolveWatchRiskPolicy({});
  const metrics = buildWatchRiskMetrics(params);
  const alerts = [];

  for (const definition of LIMIT_DEFINITIONS) {
    const threshold = normalizeLimitValue(policy.limits && policy.limits[definition.key]);
    if (threshold === null) continue;

    if (definition.key === 'maxPerMarketExposureUsdc') {
      for (const [marketAddress, value] of Object.entries(metrics.perMarketExposureUsdc || {})) {
        if (!Number.isFinite(value) || value <= threshold) continue;
        alerts.push(buildThresholdAlert({
          definition,
          snapshot,
          metric: 'perMarketExposureUsdc',
          threshold,
          value,
          scope: 'market',
          marketAddress,
          message: definition.message(value, threshold, marketAddress),
        }));
      }
      continue;
    }

    const value = toNumberOrNull(metrics[definition.metric]);
    if (!Number.isFinite(value) || value <= threshold) continue;
    alerts.push(buildThresholdAlert({
      definition,
      snapshot,
      metric: definition.metric,
      threshold,
      value,
      scope:
        definition.key === 'maxTradeSizeUsdc'
          ? 'request'
          : definition.key === 'maxDailyVolumeUsdc'
            ? 'session'
            : definition.key === 'maxHedgeGapUsdc'
              ? 'hedge'
              : 'portfolio',
      projected: definition.key === 'maxTradeSizeUsdc' || definition.key === 'maxDailyVolumeUsdc',
      marketAddress:
        definition.key === 'maxHedgeGapUsdc' || definition.key === 'maxTradeSizeUsdc'
          ? normalizeAddress(params.options && params.options.marketAddress)
          : null,
      message: definition.message(value, threshold),
    }));
  }

  return {
    metrics,
    alerts,
  };
}

module.exports = {
  WATCH_RISK_POLICY_SCHEMA_VERSION,
  resolveWatchRiskPolicy,
  buildWatchRiskMetrics,
  evaluateWatchRiskAlerts,
};
