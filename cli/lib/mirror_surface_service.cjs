const fs = require('fs');
const os = require('os');
const path = require('path');
const { createState, loadState: loadMirrorState } = require('./mirror_state_store.cjs');
const { loadAuditEntries } = require('./mirror_audit_store.cjs');
const { daemonStatus, findPidFilesByMarketAddress, listDaemonPidFiles } = require('./mirror_daemon_service.cjs');
const { round, toOptionalNumber } = require('./shared/utils.cjs');

const MIRROR_DASHBOARD_SCHEMA_VERSION = '1.0.0';
const MIRROR_DRIFT_SCHEMA_VERSION = '1.0.0';
const MIRROR_HEDGE_CHECK_SCHEMA_VERSION = '1.0.0';
const MIRROR_PNL_SCHEMA_VERSION = '1.0.0';
const MIRROR_AUDIT_SCHEMA_VERSION = '1.0.0';

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toNumberOrNull(value) {
  const numeric = toOptionalNumber(value);
  return numeric === null ? null : round(numeric, 6);
}

function normalizeSelector(selector) {
  const safe = selector && typeof selector === 'object' ? selector : {};
  return {
    pandoraMarketAddress: safe.pandoraMarketAddress || null,
    polymarketMarketId: safe.polymarketMarketId || null,
    polymarketSlug: safe.polymarketSlug || null,
  };
}

function metadataMatchesSelector(metadata = {}, selector = {}) {
  const normalizedSelector = normalizeSelector(selector);
  const marketAddress = normalizedSelector.pandoraMarketAddress
    ? String(normalizedSelector.pandoraMarketAddress).toLowerCase()
    : null;
  const metadataMarketAddress = metadata && metadata.pandoraMarketAddress
    ? String(metadata.pandoraMarketAddress).toLowerCase()
    : null;
  if (marketAddress && metadataMarketAddress && metadataMarketAddress !== marketAddress) {
    return false;
  }
  if (normalizedSelector.polymarketMarketId) {
    if (String(metadata.polymarketMarketId || '') !== String(normalizedSelector.polymarketMarketId)) {
      return false;
    }
  }
  if (normalizedSelector.polymarketSlug) {
    if (String(metadata.polymarketSlug || '') !== String(normalizedSelector.polymarketSlug)) {
      return false;
    }
  }
  return true;
}

function pushDiagnostics(target, diagnostics) {
  if (!Array.isArray(target) || !Array.isArray(diagnostics)) return;
  for (const diagnostic of diagnostics) {
    if (diagnostic === null || diagnostic === undefined) continue;
    const normalized = typeof diagnostic === 'string'
      ? diagnostic
      : diagnostic && typeof diagnostic === 'object'
        ? JSON.stringify(diagnostic)
        : String(diagnostic);
    if (!target.includes(normalized)) target.push(normalized);
  }
}

function resolveMirrorSurfaceState(options = {}) {
  const strategyHash = options.strategyHash || null;
  if (options.stateFile) {
    return loadMirrorState(options.stateFile, strategyHash);
  }
  if (strategyHash) {
    const stateFile = path.join(
      process.env.HOME || process.env.USERPROFILE || '.',
      '.pandora',
      'mirror',
      `${strategyHash}.json`,
    );
    return loadMirrorState(stateFile, strategyHash);
  }
  return {
    filePath: null,
    state: createState(null, {}),
  };
}

function resolveMirrorSurfaceDaemonStatus(selector = {}, state = {}) {
  const strategyHash = state && state.strategyHash ? state.strategyHash : null;
  if (strategyHash) {
    try {
      return daemonStatus({ strategyHash });
    } catch {
      return null;
    }
  }
  const marketAddress = selector && selector.pandoraMarketAddress ? String(selector.pandoraMarketAddress).toLowerCase() : null;
  if (!marketAddress) return null;
  try {
    const pidFiles = findPidFilesByMarketAddress(marketAddress).sort();
    if (!pidFiles.length) return null;
    const resolved = pidFiles
      .map((pidFile) => daemonStatus({ pidFile }))
      .filter(Boolean);
    const exactMatches = resolved.filter((item) => metadataMatchesSelector(item.metadata || {}, selector));
    if ((selector.polymarketMarketId || selector.polymarketSlug) && !exactMatches.length) {
      return null;
    }
    const matches = exactMatches.length ? exactMatches : resolved;
    const selected = matches[matches.length - 1];
    if (matches.length > 1 && selected && selected.metadata) {
      selected.metadata.ambiguousPidFiles = matches.map((item) => item.pidFile).filter(Boolean);
    }
    return selected;
  } catch {
    return null;
  }
}

function defaultMirrorStateDir() {
  return path.join(process.env.HOME || process.env.USERPROFILE || os.homedir(), '.pandora', 'mirror');
}

function selectorKey(selector = {}) {
  return [
    selector && selector.pandoraMarketAddress ? String(selector.pandoraMarketAddress).toLowerCase() : '',
    selector && selector.polymarketMarketId ? String(selector.polymarketMarketId) : '',
    selector && selector.polymarketSlug ? String(selector.polymarketSlug) : '',
  ].join('|');
}

function coalesce() {
  for (const value of arguments) {
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

function hasSelector(selector = {}) {
  return Boolean(
    selector.pandoraMarketAddress
    || selector.polymarketMarketId
    || selector.polymarketSlug,
  );
}

function buildSurfaceDiagnostics(params = {}) {
  const diagnostics = [];
  pushDiagnostics(diagnostics, params.diagnostics);
  const live = params.live && typeof params.live === 'object' ? params.live : null;
  if (live) {
    pushDiagnostics(diagnostics, live.verifyDiagnostics);
    pushDiagnostics(diagnostics, live.actionableDiagnostics);
    pushDiagnostics(diagnostics, live.polymarketPosition && live.polymarketPosition.diagnostics);
  }
  return diagnostics;
}

function buildMirrorDriftPayload(params = {}) {
  const state = params.state && typeof params.state === 'object' ? params.state : {};
  const runtime = params.runtime && typeof params.runtime === 'object' ? params.runtime : {};
  const live = params.live && typeof params.live === 'object' ? params.live : {};
  return {
    schemaVersion: MIRROR_DRIFT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    stateFile: params.stateFile || null,
    strategyHash: params.strategyHash || state.strategyHash || null,
    selector: normalizeSelector(params.selector),
    summary: {
      driftBps: toNumberOrNull(live.driftBps),
      triggerBps: toNumberOrNull(live.driftTriggerBps),
      triggered: Boolean(live.driftTriggered),
      rebalanceSide: live.hedgeStatus && live.hedgeStatus.rebalanceSide ? live.hedgeStatus.rebalanceSide : null,
      crossVenueStatus: live.crossVenue && live.crossVenue.status ? live.crossVenue.status : null,
      runtimeHealth: runtime.health && runtime.health.status ? runtime.health.status : null,
      reserveTotalUsdc: toNumberOrNull(live.reserveTotalUsdc),
    },
    drift: {
      driftBps: toNumberOrNull(live.driftBps),
      triggerBps: toNumberOrNull(live.driftTriggerBps),
      triggered: Boolean(live.driftTriggered),
      rebalanceSide: live.hedgeStatus && live.hedgeStatus.rebalanceSide ? live.hedgeStatus.rebalanceSide : null,
      reserveYesUsdc: toNumberOrNull(live.reserveYesUsdc),
      reserveNoUsdc: toNumberOrNull(live.reserveNoUsdc),
      reserveTotalUsdc: toNumberOrNull(live.reserveTotalUsdc),
      pandoraYesPct: toNumberOrNull(live.pandoraMarket && live.pandoraMarket.yesPct),
      pandoraNoPct: toNumberOrNull(live.pandoraMarket && live.pandoraMarket.noPct),
      sourceYesPct: toNumberOrNull(live.sourceMarket && live.sourceMarket.yesPct),
      sourceNoPct: toNumberOrNull(live.sourceMarket && live.sourceMarket.noPct),
      sourceType: live.sourceMarket && live.sourceMarket.source ? live.sourceMarket.source : null,
    },
    crossVenue: live.crossVenue || null,
    actionability: live.actionability || null,
    sourceMarket: live.sourceMarket || null,
    pandoraMarket: live.pandoraMarket || null,
    runtime: {
      health: runtime.health || null,
      daemon: runtime.daemon || null,
    },
    diagnostics: buildSurfaceDiagnostics({ live, diagnostics: params.diagnostics }),
  };
}

function buildMirrorHedgeCheckPayload(params = {}) {
  const state = params.state && typeof params.state === 'object' ? params.state : {};
  const runtime = params.runtime && typeof params.runtime === 'object' ? params.runtime : {};
  const live = params.live && typeof params.live === 'object' ? params.live : {};
  return {
    schemaVersion: MIRROR_HEDGE_CHECK_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    stateFile: params.stateFile || null,
    strategyHash: params.strategyHash || state.strategyHash || null,
    selector: normalizeSelector(params.selector),
    summary: {
      targetHedgeUsdc: toNumberOrNull(live.targetHedgeUsdc),
      currentHedgeUsdc: toNumberOrNull(live.currentHedgeUsdc),
      hedgeGapUsdc: toNumberOrNull(live.hedgeGapUsdc),
      hedgeGapAbsUsdc: toNumberOrNull(live.hedgeGapAbsUsdc),
      triggerUsdc: toNumberOrNull(live.hedgeTriggerUsdc),
      triggered: Boolean(live.hedgeTriggered),
      hedgeSide: live.hedgeStatus && live.hedgeStatus.hedgeSide ? live.hedgeStatus.hedgeSide : null,
      rebalanceSide: live.hedgeStatus && live.hedgeStatus.rebalanceSide ? live.hedgeStatus.rebalanceSide : null,
      crossVenueStatus: live.crossVenue && live.crossVenue.status ? live.crossVenue.status : null,
      runtimeHealth: runtime.health && runtime.health.status ? runtime.health.status : null,
    },
    hedge: {
      targetHedgeUsdc: toNumberOrNull(live.targetHedgeUsdc),
      currentHedgeUsdc: toNumberOrNull(live.currentHedgeUsdc),
      hedgeGapUsdc: toNumberOrNull(live.hedgeGapUsdc),
      hedgeGapAbsUsdc: toNumberOrNull(live.hedgeGapAbsUsdc),
      coverageRatio: toNumberOrNull(live.hedgeCoverageRatio),
      triggerUsdc: toNumberOrNull(live.hedgeTriggerUsdc),
      triggered: Boolean(live.hedgeTriggered),
      hedgeSide: live.hedgeStatus && live.hedgeStatus.hedgeSide ? live.hedgeStatus.hedgeSide : null,
      rebalanceSide: live.hedgeStatus && live.hedgeStatus.rebalanceSide ? live.hedgeStatus.rebalanceSide : null,
      deltaLpUsdc: toNumberOrNull(live.deltaLpUsdc),
      netDeltaApprox: toNumberOrNull(live.netDeltaApprox),
    },
    crossVenue: live.crossVenue || null,
    actionability: live.actionability || null,
    polymarketPosition: live.polymarketPosition || null,
    sourceMarket: live.sourceMarket || null,
    pandoraMarket: live.pandoraMarket || null,
    runtime: {
      health: runtime.health || null,
      daemon: runtime.daemon || null,
    },
    diagnostics: buildSurfaceDiagnostics({ live, diagnostics: params.diagnostics }),
  };
}

function listMirrorStateFiles(stateDir = defaultMirrorStateDir()) {
  const resolvedDir = path.resolve(stateDir);
  if (!fs.existsSync(resolvedDir)) return [];
  return fs.readdirSync(resolvedDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && !entry.name.endsWith('.pending-action.json'))
    .map((entry) => path.join(resolvedDir, entry.name))
    .sort();
}

function normalizeDashboardContext(context = {}) {
  const state = context.state && typeof context.state === 'object'
    ? context.state
    : createState(context.strategyHash || null, {});
  return {
    strategyHash: context.strategyHash || state.strategyHash || null,
    stateFile: context.stateFile || null,
    selector: normalizeSelector({
      pandoraMarketAddress:
        context.selector && context.selector.pandoraMarketAddress
          ? context.selector.pandoraMarketAddress
          : state.pandoraMarketAddress || null,
      polymarketMarketId:
        context.selector && context.selector.polymarketMarketId
          ? context.selector.polymarketMarketId
          : state.polymarketMarketId || null,
      polymarketSlug:
        context.selector && context.selector.polymarketSlug
          ? context.selector.polymarketSlug
          : state.polymarketSlug || null,
    }),
    state,
    daemonStatus: context.daemonStatus || null,
  };
}

function buildDashboardContextKey(context = {}) {
  return context.strategyHash || context.stateFile || selectorKey(context.selector);
}

function upsertDashboardContext(map, rawContext) {
  const normalized = normalizeDashboardContext(rawContext);
  const key = buildDashboardContextKey(normalized);
  if (!key) return;
  if (!map.has(key)) {
    map.set(key, normalized);
    return;
  }
  const existing = map.get(key);
  existing.strategyHash = coalesce(existing.strategyHash, normalized.strategyHash);
  existing.stateFile = coalesce(existing.stateFile, normalized.stateFile);
  existing.selector = normalizeSelector({
    pandoraMarketAddress: coalesce(existing.selector.pandoraMarketAddress, normalized.selector.pandoraMarketAddress),
    polymarketMarketId: coalesce(existing.selector.polymarketMarketId, normalized.selector.polymarketMarketId),
    polymarketSlug: coalesce(existing.selector.polymarketSlug, normalized.selector.polymarketSlug),
  });
  if ((!existing.stateFile || !hasSelector(existing.state)) && normalized.state) {
    existing.state = normalized.state;
  } else if ((!existing.state || !existing.state.strategyHash) && normalized.state) {
    existing.state = normalized.state;
  }
  if (!existing.daemonStatus && normalized.daemonStatus) {
    existing.daemonStatus = normalized.daemonStatus;
  }
}

function loadMirrorDashboardContexts() {
  const contexts = new Map();
  for (const stateFile of listMirrorStateFiles()) {
    const loaded = loadMirrorState(stateFile, null);
    upsertDashboardContext(contexts, {
      strategyHash: loaded.state.strategyHash || null,
      stateFile: loaded.filePath,
      state: loaded.state,
    });
  }

  for (const pidFile of listDaemonPidFiles().sort()) {
    const status = daemonStatus({ pidFile });
    const metadata = status && status.metadata && typeof status.metadata === 'object' ? status.metadata : {};
    const loaded = metadata.stateFile
      ? loadMirrorState(metadata.stateFile, status.strategyHash || null)
      : {
          filePath: metadata.stateFile || null,
          state: createState(status.strategyHash || null, {
            pandoraMarketAddress: metadata.pandoraMarketAddress || null,
            polymarketMarketId: metadata.polymarketMarketId || null,
            polymarketSlug: metadata.polymarketSlug || null,
          }),
        };
    upsertDashboardContext(contexts, {
      strategyHash: status.strategyHash || metadata.strategyHash || null,
      stateFile: loaded.filePath || metadata.stateFile || null,
      selector: {
        pandoraMarketAddress: metadata.pandoraMarketAddress || null,
        polymarketMarketId: metadata.polymarketMarketId || null,
        polymarketSlug: metadata.polymarketSlug || null,
      },
      state: loaded.state,
      daemonStatus: status,
    });
  }

  return Array.from(contexts.values())
    .filter((context) => hasSelector(context.selector))
    .sort((left, right) => {
      const leftKey = buildDashboardContextKey(left);
      const rightKey = buildDashboardContextKey(right);
      return leftKey.localeCompare(rightKey);
    });
}

function buildMirrorDashboardItem(params = {}) {
  const state = params.state && typeof params.state === 'object' ? params.state : {};
  const runtime = params.runtime && typeof params.runtime === 'object' ? params.runtime : {};
  const live = params.live && typeof params.live === 'object' ? params.live : null;
  const alerts = Array.isArray(runtime.alerts)
    ? runtime.alerts
    : Array.isArray(state.alerts)
      ? state.alerts
      : [];
  const latestAlert = alerts.length ? alerts[alerts.length - 1] : null;
  return {
    strategyHash: params.strategyHash || state.strategyHash || null,
    stateFile: params.stateFile || null,
    selector: normalizeSelector(params.selector),
    question:
      live && live.sourceMarket && live.sourceMarket.question
        ? live.sourceMarket.question
        : live && live.pandoraMarket && live.pandoraMarket.question
          ? live.pandoraMarket.question
          : null,
    liveAvailable: Boolean(live),
    runtime: {
      health: runtime.health || null,
      daemon: runtime.daemon || null,
      pendingAction: runtime.pendingAction || null,
      lastAction: runtime.lastAction || null,
      lastError: runtime.lastError || null,
    },
    drift: live
      ? {
          driftBps: toNumberOrNull(live.driftBps),
          triggerBps: toNumberOrNull(live.driftTriggerBps),
          triggered: Boolean(live.driftTriggered),
          crossVenueStatus: live.crossVenue && live.crossVenue.status ? live.crossVenue.status : null,
          rebalanceSide: live.hedgeStatus && live.hedgeStatus.rebalanceSide ? live.hedgeStatus.rebalanceSide : null,
        }
      : null,
    hedge: live
      ? {
          targetHedgeUsdc: toNumberOrNull(live.targetHedgeUsdc),
          currentHedgeUsdc: toNumberOrNull(live.currentHedgeUsdc),
          hedgeGapUsdc: toNumberOrNull(live.hedgeGapUsdc),
          triggerUsdc: toNumberOrNull(live.hedgeTriggerUsdc),
          triggered: Boolean(live.hedgeTriggered),
          hedgeSide: live.hedgeStatus && live.hedgeStatus.hedgeSide ? live.hedgeStatus.hedgeSide : null,
        }
      : null,
    pnl: live
      ? {
          netPnlApproxUsdc: toNumberOrNull(live.netPnlApproxUsdc),
          pnlApprox: toNumberOrNull(live.pnlApprox),
          reserveTotalUsdc: toNumberOrNull(live.reserveTotalUsdc),
        }
      : {
          netPnlApproxUsdc: null,
          pnlApprox: null,
          reserveTotalUsdc: null,
        },
    actionability: live ? live.actionability || null : null,
    alertSummary: {
      count: alerts.length,
      latestCode: latestAlert && latestAlert.code ? latestAlert.code : null,
      latestMessage: latestAlert && latestAlert.message ? latestAlert.message : null,
      requiresManualReview: Boolean(
        (runtime.pendingAction && runtime.pendingAction.requiresManualReview)
        || (state.lastExecution && state.lastExecution.requiresManualReview),
      ),
    },
    sourceMarket: live ? live.sourceMarket || null : null,
    pandoraMarket: live ? live.pandoraMarket || null : null,
    diagnostics: buildSurfaceDiagnostics({ live, diagnostics: params.diagnostics }),
  };
}

function buildMirrorDashboardPayload(params = {}) {
  const items = Array.isArray(params.items) ? params.items.slice() : [];
  const pnlValues = items
    .map((item) => Number(item && item.pnl ? item.pnl.netPnlApproxUsdc : null))
    .filter((value) => Number.isFinite(value));
  return {
    schemaVersion: MIRROR_DASHBOARD_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    summary: {
      marketCount: items.length,
      liveCount: items.filter((item) => item.liveAvailable).length,
      daemonRunningCount: items.filter((item) => item.runtime && item.runtime.daemon && item.runtime.daemon.alive).length,
      blockedCount: items.filter((item) => item.runtime && item.runtime.health && item.runtime.health.status === 'blocked').length,
      actionNeededCount: items.filter((item) => item.actionability && item.actionability.status === 'action-needed').length,
      alertCount: items.reduce((sum, item) => sum + Number(item && item.alertSummary ? item.alertSummary.count : 0), 0),
      manualReviewCount: items.filter((item) => item.alertSummary && item.alertSummary.requiresManualReview).length,
      totalNetPnlApproxUsdc: pnlValues.length ? round(pnlValues.reduce((sum, value) => sum + value, 0), 6) : null,
    },
    items,
    diagnostics: buildSurfaceDiagnostics({ diagnostics: params.diagnostics }),
  };
}

function buildMirrorPnlPayload(params = {}) {
  const state = params.state && typeof params.state === 'object' ? params.state : {};
  const runtime = params.runtime && typeof params.runtime === 'object' ? params.runtime : {};
  const live = params.live && typeof params.live === 'object' ? params.live : {};
  const scenarios = live.pnlScenarios && typeof live.pnlScenarios === 'object'
    ? live.pnlScenarios
    : {
        baseline: null,
        feeVolumeScenarios: [],
        resolutionScenarios: {},
      };
  const diagnostics = [];
  pushDiagnostics(diagnostics, live.verifyDiagnostics);
  pushDiagnostics(diagnostics, live.actionableDiagnostics);
  pushDiagnostics(diagnostics, live.polymarketPosition && live.polymarketPosition.diagnostics);

  return {
    schemaVersion: MIRROR_PNL_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    stateFile: params.stateFile || null,
    strategyHash: params.strategyHash || state.strategyHash || null,
    selector: normalizeSelector(params.selector),
    summary: {
      netPnlApproxUsdc: toNumberOrNull(live.netPnlApproxUsdc),
      pnlApprox: toNumberOrNull(live.pnlApprox),
      netDeltaApprox: toNumberOrNull(live.netDeltaApprox),
      driftBps: toNumberOrNull(live.driftBps),
      hedgeGapUsdc: toNumberOrNull(live.hedgeGapUsdc),
      currentHedgeUsdc: toNumberOrNull(live.currentHedgeUsdc !== undefined ? live.currentHedgeUsdc : state.currentHedgeUsdc),
      cumulativeLpFeesApproxUsdc: toNumberOrNull(
        live.cumulativeLpFeesApproxUsdc !== undefined ? live.cumulativeLpFeesApproxUsdc : state.cumulativeLpFeesApproxUsdc,
      ),
      cumulativeHedgeCostApproxUsdc: toNumberOrNull(
        live.cumulativeHedgeCostApproxUsdc !== undefined
          ? live.cumulativeHedgeCostApproxUsdc
          : state.cumulativeHedgeCostApproxUsdc,
      ),
      reserveTotalUsdc: toNumberOrNull(live.reserveTotalUsdc),
      runtimeHealth: runtime.health && runtime.health.status ? runtime.health.status : null,
    },
    crossVenue: live.crossVenue || null,
    hedgeStatus: live.hedgeStatus || null,
    actionability: live.actionability || null,
    polymarketPosition: live.polymarketPosition || null,
    sourceMarket: live.sourceMarket || null,
    pandoraMarket: live.pandoraMarket || null,
    scenarios,
    runtime: {
      health: runtime.health || null,
      daemon: runtime.daemon || null,
    },
    diagnostics,
  };
}

function extractResultHash(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.txHash) return result.txHash;
  if (result.orderId) return result.orderId;
  if (result.response && typeof result.response === 'object') {
    return result.response.txHash || result.response.orderId || result.response.orderID || null;
  }
  return null;
}

function deriveLegStatus(leg, fallbackStatus) {
  if (leg && leg.result && typeof leg.result === 'object') {
    if (leg.result.ok === false) return 'failed';
    if (leg.result.ok === true) {
      if (typeof leg.result.status === 'string' && leg.result.status.trim()) {
        return leg.result.status.trim();
      }
      return 'ok';
    }
    if (typeof leg.result.status === 'string' && leg.result.status.trim()) {
      return leg.result.status.trim();
    }
  }
  if (typeof fallbackStatus === 'string' && fallbackStatus.trim()) return fallbackStatus.trim();
  return 'unknown';
}

function isFailureStatus(status) {
  if (typeof status !== 'string' || !status.trim()) return false;
  const normalized = status.trim().toLowerCase();
  return normalized === 'failed' || normalized === 'error';
}

function buildAuditEntry(base, details) {
  return {
    classification: base.classification,
    venue: base.venue,
    source: base.source,
    timestamp: toIso(base.timestamp),
    status: base.status || null,
    code: base.code || null,
    message: base.message || null,
    details: details || null,
  };
}

function buildMirrorAuditPayload(params = {}) {
  const state = params.state && typeof params.state === 'object' ? params.state : {};
  const runtime = params.runtime && typeof params.runtime === 'object' ? params.runtime : {};
  const live = params.live && typeof params.live === 'object' ? params.live : null;
  const ledgerEntries = Array.isArray(params.auditEntries) ? params.auditEntries.slice() : [];
  const lastExecution = state.lastExecution && typeof state.lastExecution === 'object' ? state.lastExecution : null;
  const alerts = Array.isArray(state.alerts) ? state.alerts : [];

  if (!ledgerEntries.length && lastExecution) {
    ledgerEntries.push(
      buildAuditEntry(
        {
          classification: 'sync-action',
          venue: 'mirror',
          source: 'state.lastExecution',
          timestamp: lastExecution.completedAt || lastExecution.startedAt,
          status: lastExecution.status || null,
          code: lastExecution.error && lastExecution.error.code ? lastExecution.error.code : null,
          message: lastExecution.error && lastExecution.error.message ? lastExecution.error.message : null,
        },
        {
          mode: lastExecution.mode || null,
          idempotencyKey: lastExecution.idempotencyKey || null,
          requiresManualReview: Boolean(lastExecution.requiresManualReview),
          startedAt: toIso(lastExecution.startedAt),
          completedAt: toIso(lastExecution.completedAt),
          lockFile: lastExecution.lockFile || null,
          lockNonce: lastExecution.lockNonce || null,
          lockRetained: Boolean(lastExecution.lockRetained),
          model: lastExecution.model || null,
        },
      ),
    );

    if (lastExecution.rebalance) {
      ledgerEntries.push(
        buildAuditEntry(
          {
            classification: 'pandora-rebalance',
            venue: 'pandora',
            source: 'state.lastExecution.rebalance',
            timestamp: lastExecution.completedAt || lastExecution.startedAt,
            status: deriveLegStatus(lastExecution.rebalance, lastExecution.status),
            code:
              lastExecution.rebalance.result
              && lastExecution.rebalance.result.error
              && lastExecution.rebalance.result.error.code
                ? lastExecution.rebalance.result.error.code
                : null,
            message:
              lastExecution.rebalance.result
              && lastExecution.rebalance.result.error
              && lastExecution.rebalance.result.error.message
                ? lastExecution.rebalance.result.error.message
                : null,
          },
          {
            side: lastExecution.rebalance.side || null,
            amountUsdc: toNumberOrNull(lastExecution.rebalance.amountUsdc),
            transactionRef: extractResultHash(lastExecution.rebalance.result),
            result: lastExecution.rebalance.result || null,
          },
        ),
      );
    }

    if (lastExecution.hedge) {
      ledgerEntries.push(
        buildAuditEntry(
          {
            classification: 'polymarket-hedge',
            venue: 'polymarket',
            source: 'state.lastExecution.hedge',
            timestamp: lastExecution.completedAt || lastExecution.startedAt,
            status: deriveLegStatus(lastExecution.hedge, lastExecution.status),
            code:
              lastExecution.hedge.result
              && lastExecution.hedge.result.error
              && lastExecution.hedge.result.error.code
                ? lastExecution.hedge.result.error.code
                : null,
            message:
              lastExecution.hedge.result
              && lastExecution.hedge.result.error
              && lastExecution.hedge.result.error.message
                ? lastExecution.hedge.result.error.message
                : null,
          },
          {
            tokenSide: lastExecution.hedge.tokenSide || null,
            orderSide: lastExecution.hedge.side || null,
            amountUsdc: toNumberOrNull(lastExecution.hedge.amountUsdc),
            executionMode: lastExecution.hedge.executionMode || null,
            stateDeltaUsdc: toNumberOrNull(lastExecution.hedge.stateDeltaUsdc),
            transactionRef: extractResultHash(lastExecution.hedge.result),
            result: lastExecution.hedge.result || null,
          },
        ),
      );
    }
  }

  const entryKeys = new Set(
    ledgerEntries.map((entry) => [
      entry && entry.classification ? entry.classification : '',
      entry && entry.timestamp ? entry.timestamp : '',
      entry && entry.code ? entry.code : '',
      entry && entry.message ? entry.message : '',
    ].join('|')),
  );

  for (const alert of alerts) {
    const key = [
      'runtime-alert',
      alert && alert.timestamp ? toIso(alert.timestamp) : '',
      alert && alert.code ? alert.code : '',
      alert && alert.message ? alert.message : '',
    ].join('|');
    if (entryKeys.has(key)) continue;
    ledgerEntries.push(
      buildAuditEntry(
        {
          classification: 'runtime-alert',
          venue: 'runtime',
          source: 'state.alerts',
          timestamp: alert && alert.timestamp ? alert.timestamp : null,
          status: alert && alert.level ? alert.level : null,
          code: alert && alert.code ? alert.code : null,
          message: alert && alert.message ? alert.message : null,
        },
        alert && alert.details !== undefined ? alert.details : null,
      ),
    );
  }

  ledgerEntries.sort((left, right) => {
    const leftTime = left.timestamp ? Date.parse(left.timestamp) : 0;
    const rightTime = right.timestamp ? Date.parse(right.timestamp) : 0;
    return rightTime - leftTime;
  });

  const actionCount = ledgerEntries.filter((entry) => entry.classification === 'sync-action').length;
  const legEntries = ledgerEntries.filter(
    (entry) => entry.classification === 'pandora-rebalance' || entry.classification === 'polymarket-hedge',
  );
  const legCount = legEntries.length;
  const alertCount = ledgerEntries.filter((entry) => entry.classification === 'runtime-alert').length;
  const failedLegCount = legEntries.filter((entry) => isFailureStatus(entry.status)).length;
  const failedActionCount =
    failedLegCount > 0
      ? 0
      : ledgerEntries.filter((entry) => entry.classification === 'sync-action' && isFailureStatus(entry.status)).length;
  const errorCount = failedLegCount + failedActionCount;

  const diagnostics = [];
  if (runtime.lastError && runtime.lastError.message) diagnostics.push(String(runtime.lastError.message));
  if (live && Array.isArray(live.verifyDiagnostics)) pushDiagnostics(diagnostics, live.verifyDiagnostics);
  if (live && Array.isArray(live.actionableDiagnostics)) pushDiagnostics(diagnostics, live.actionableDiagnostics);
  if (live && live.polymarketPosition && Array.isArray(live.polymarketPosition.diagnostics)) {
    pushDiagnostics(diagnostics, live.polymarketPosition.diagnostics);
  }

  return {
    schemaVersion: MIRROR_AUDIT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    stateFile: params.stateFile || null,
    strategyHash: params.strategyHash || state.strategyHash || null,
    selector: normalizeSelector(params.selector),
    summary: {
      entryCount: ledgerEntries.length,
      actionCount,
      legCount,
      alertCount,
      errorCount,
      requiresManualReview: Boolean(lastExecution && lastExecution.requiresManualReview),
      lastExecutionStatus: lastExecution && lastExecution.status ? lastExecution.status : null,
      runtimeHealth: runtime.health && runtime.health.status ? runtime.health.status : null,
      liveCrossVenueStatus: live && live.crossVenue && live.crossVenue.status ? live.crossVenue.status : null,
    },
    runtime: {
      health: runtime.health || null,
      summary: runtime.summary || null,
      daemon: runtime.daemon || null,
      lastAction: runtime.lastAction || null,
      lastError: runtime.lastError || null,
      pendingAction: runtime.pendingAction || null,
      alerts: Array.isArray(runtime.alerts) ? runtime.alerts : [],
    },
    liveContext: live
      ? {
          crossVenue: live.crossVenue || null,
          hedgeStatus: live.hedgeStatus || null,
          actionability: live.actionability || null,
          polymarketPosition: live.polymarketPosition || null,
          pnlApprox: toNumberOrNull(live.pnlApprox),
          netPnlApproxUsdc: toNumberOrNull(live.netPnlApproxUsdc),
        }
      : null,
    ledger: {
      source: params.auditEntries && params.auditEntries.length ? 'mirror-audit-log' : 'mirror-state-runtime',
      entries: ledgerEntries,
    },
    diagnostics,
  };
}

module.exports = {
  MIRROR_DASHBOARD_SCHEMA_VERSION,
  MIRROR_DRIFT_SCHEMA_VERSION,
  MIRROR_HEDGE_CHECK_SCHEMA_VERSION,
  MIRROR_PNL_SCHEMA_VERSION,
  MIRROR_AUDIT_SCHEMA_VERSION,
  buildMirrorDashboardItem,
  buildMirrorDashboardPayload,
  buildMirrorDriftPayload,
  buildMirrorHedgeCheckPayload,
  buildMirrorPnlPayload,
  buildMirrorAuditPayload,
  loadMirrorDashboardContexts,
  loadAuditEntries,
  resolveMirrorSurfaceDaemonStatus,
  resolveMirrorSurfaceState,
};
