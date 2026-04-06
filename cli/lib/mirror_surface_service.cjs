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
const MIRROR_RECONCILED_LEDGER_SCHEMA_VERSION = '1.0.0';

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
  const selector = normalizeSelector(options);
  if (Object.values(selector).some((v) => v !== null)) {
    const stateDir = defaultMirrorStateDir();
    if (fs.existsSync(stateDir)) {
      const matches = [];
      for (const entry of fs.readdirSync(stateDir, { withFileTypes: true })) {
        if (!entry || !entry.isFile() || !String(entry.name || '').endsWith('.json')) continue;
        const filePath = path.join(stateDir, entry.name);
        const loaded = loadMirrorState(filePath, null);
        if (!loaded || !loaded.state || !metadataMatchesSelector(loaded.state, selector)) continue;
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(filePath).mtimeMs || 0;
        } catch {
          mtimeMs = 0;
        }
        matches.push({
          filePath: loaded.filePath,
          state: loaded.state,
          mtimeMs,
        });
      }
      if (matches.length) {
        matches.sort((left, right) => {
          if (right.mtimeMs !== left.mtimeMs) return right.mtimeMs - left.mtimeMs;
          return String(left.filePath || '').localeCompare(String(right.filePath || ''));
        });
        return {
          filePath: matches[0].filePath,
          state: matches[0].state,
        };
      }
    }
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
      targetHedgeShares: toNumberOrNull(live.targetHedgeShares !== undefined ? live.targetHedgeShares : live.targetHedgeUsdc),
      currentHedgeUsdc: toNumberOrNull(live.currentHedgeUsdc),
      currentHedgeShares: toNumberOrNull(live.currentHedgeShares !== undefined ? live.currentHedgeShares : live.currentHedgeUsdc),
      hedgeGapUsdc: toNumberOrNull(live.hedgeGapUsdc),
      hedgeGapShares: toNumberOrNull(live.hedgeGapShares !== undefined ? live.hedgeGapShares : live.hedgeGapUsdc),
      hedgeGapAbsUsdc: toNumberOrNull(live.hedgeGapAbsUsdc),
      hedgeGapAbsShares: toNumberOrNull(live.hedgeGapAbsShares !== undefined ? live.hedgeGapAbsShares : live.hedgeGapAbsUsdc),
      triggerUsdc: toNumberOrNull(live.hedgeTriggerUsdc),
      triggerShares: toNumberOrNull(live.hedgeTriggerShares !== undefined ? live.hedgeTriggerShares : live.hedgeTriggerUsdc),
      unit: live.hedgeUnit || 'shares',
      triggered: Boolean(live.hedgeTriggered),
      hedgeSide: live.hedgeStatus && live.hedgeStatus.hedgeSide ? live.hedgeStatus.hedgeSide : null,
      rebalanceSide: live.hedgeStatus && live.hedgeStatus.rebalanceSide ? live.hedgeStatus.rebalanceSide : null,
      crossVenueStatus: live.crossVenue && live.crossVenue.status ? live.crossVenue.status : null,
      runtimeHealth: runtime.health && runtime.health.status ? runtime.health.status : null,
    },
    hedge: {
      targetHedgeUsdc: toNumberOrNull(live.targetHedgeUsdc),
      targetHedgeShares: toNumberOrNull(live.targetHedgeShares !== undefined ? live.targetHedgeShares : live.targetHedgeUsdc),
      currentHedgeUsdc: toNumberOrNull(live.currentHedgeUsdc),
      currentHedgeShares: toNumberOrNull(live.currentHedgeShares !== undefined ? live.currentHedgeShares : live.currentHedgeUsdc),
      hedgeGapUsdc: toNumberOrNull(live.hedgeGapUsdc),
      hedgeGapShares: toNumberOrNull(live.hedgeGapShares !== undefined ? live.hedgeGapShares : live.hedgeGapUsdc),
      hedgeGapAbsUsdc: toNumberOrNull(live.hedgeGapAbsUsdc),
      hedgeGapAbsShares: toNumberOrNull(live.hedgeGapAbsShares !== undefined ? live.hedgeGapAbsShares : live.hedgeGapAbsUsdc),
      coverageRatio: toNumberOrNull(live.hedgeCoverageRatio),
      triggerUsdc: toNumberOrNull(live.hedgeTriggerUsdc),
      triggerShares: toNumberOrNull(live.hedgeTriggerShares !== undefined ? live.hedgeTriggerShares : live.hedgeTriggerUsdc),
      unit: live.hedgeUnit || 'shares',
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
          targetHedgeShares: toNumberOrNull(live.targetHedgeShares !== undefined ? live.targetHedgeShares : live.targetHedgeUsdc),
          currentHedgeUsdc: toNumberOrNull(live.currentHedgeUsdc),
          currentHedgeShares: toNumberOrNull(live.currentHedgeShares !== undefined ? live.currentHedgeShares : live.currentHedgeUsdc),
          hedgeGapUsdc: toNumberOrNull(live.hedgeGapUsdc),
          hedgeGapShares: toNumberOrNull(live.hedgeGapShares !== undefined ? live.hedgeGapShares : live.hedgeGapUsdc),
          triggerUsdc: toNumberOrNull(live.hedgeTriggerUsdc),
          triggerShares: toNumberOrNull(live.hedgeTriggerShares !== undefined ? live.hedgeTriggerShares : live.hedgeTriggerUsdc),
          unit: live.hedgeUnit || 'shares',
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
  const reconciled = buildMirrorReconciledPayload({
    reconciled: params.reconciled,
    includeReconciled: Boolean(params.includeReconciled),
    allowLiveApproxRows: true,
    state,
    live,
    accounting: params.accounting,
    ledgerEntries: Array.isArray(params.auditEntries) ? params.auditEntries : [],
    generatedAt: params.generatedAt,
    traceSnapshots: params.traceSnapshots,
    trace: params.trace,
    tracePayload: params.tracePayload,
    traceResult: params.traceResult,
    traceContext: params.traceContext,
  });
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
      hedgeGapShares: toNumberOrNull(live.hedgeGapShares !== undefined ? live.hedgeGapShares : live.hedgeGapUsdc),
      currentHedgeShares: toNumberOrNull(
        live.currentHedgeShares !== undefined
          ? live.currentHedgeShares
          : state.currentHedgeShares !== undefined
            ? state.currentHedgeShares
            : live.currentHedgeUsdc !== undefined
              ? live.currentHedgeUsdc
              : state.currentHedgeUsdc,
      ),
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
      reconciledStatus: reconciled ? reconciled.status : null,
      realizedPnlUsdc: reconciled ? reconciled.summary.realizedPnlUsdc : null,
      unrealizedPnlUsdc: reconciled ? reconciled.summary.unrealizedPnlUsdc : null,
      netPnlUsdc: reconciled ? reconciled.summary.netPnlUsdc : null,
      lpFeeIncomeUsdc: reconciled ? reconciled.summary.lpFeeIncomeUsdc : null,
      hedgeCostUsdc: reconciled ? reconciled.summary.hedgeCostUsdc : null,
      gasCostUsdc: reconciled ? reconciled.summary.gasCostUsdc : null,
      impermanentLossUsdc: reconciled ? reconciled.summary.impermanentLossUsdc : null,
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
    reconciled,
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

function cloneJsonCompatible(value) {
  if (value === undefined || value === null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function normalizeReconciledTimestamp(value) {
  return toIso(value) || null;
}

function normalizeReconciledStatus(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim();
}

function sumRounded(values) {
  let seen = false;
  let total = 0;
  for (const value of Array.isArray(values) ? values : []) {
    const numeric = toOptionalNumber(value);
    if (numeric === null) continue;
    total += numeric;
    seen = true;
  }
  return seen ? round(total, 6) : null;
}

function collectUniqueStrings(values) {
  const seen = new Set();
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function classifyReconciledRowKind(classification) {
  if (classification === 'sync-action') return 'action';
  if (classification === 'pandora-rebalance' || classification === 'polymarket-hedge') return 'leg';
  if (classification === 'runtime-alert') return 'alert';
  if (classification === 'pandora-reserve-trace' || classification === 'pandora-reserve-mark') return 'reserve';
  if (classification === 'polymarket-inventory-mark') return 'mark';
  return 'event';
}

function normalizeAuditEntryForReconciled(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const details = entry.details && typeof entry.details === 'object' ? entry.details : {};
  return {
    rowId: null,
    sequence: null,
    kind: classifyReconciledRowKind(entry.classification),
    inputType: 'audit-entry',
    classification: entry.classification || 'audit-entry',
    venue: entry.venue || null,
    source: entry.source || null,
    timestamp: normalizeReconciledTimestamp(entry.timestamp),
    status: normalizeReconciledStatus(entry.status),
    code: entry.code || null,
    message: entry.message || null,
    transactionRef: coalesce(
      details.transactionRef,
      details.txHash,
      details.orderId,
      details.orderID,
      entry.transactionRef,
    ),
    transactionNonce: coalesce(
      details.transactionNonce,
      details.tradeNonce,
      details.approveNonce,
      null,
    ),
    blockNumber: coalesce(details.blockNumber, null),
    blockHash: coalesce(details.blockHash, null),
    side: coalesce(details.side, null),
    tokenSide: coalesce(details.tokenSide, null),
    orderSide: coalesce(details.orderSide, null),
    executionMode: coalesce(details.executionMode, null),
    amountUsdc: toNumberOrNull(details.amountUsdc),
    stateDeltaUsdc: toNumberOrNull(details.stateDeltaUsdc),
    reserveYesUsdc: toNumberOrNull(details.reserveYesUsdc),
    reserveNoUsdc: toNumberOrNull(details.reserveNoUsdc),
    reserveTotalUsdc: toNumberOrNull(details.reserveTotalUsdc),
    pandoraYesPct: toNumberOrNull(details.pandoraYesPct),
    feeTier: coalesce(details.feeTier, null),
    estimatedValueUsd: toNumberOrNull(details.estimatedValueUsd),
    openOrdersCount: coalesce(details.openOrdersCount, null),
    openOrdersNotionalUsd: toNumberOrNull(details.openOrdersNotionalUsd),
    sourceProvenance: {
      inputType: 'audit-entry',
      rawSource: entry.source || null,
      reserveSource:
        details.model && typeof details.model === 'object' && details.model.reserveSource
          ? details.model.reserveSource
          : null,
    },
    details: cloneJsonCompatible(details),
  };
}

function resolveTraceInput(params = {}) {
  if (Array.isArray(params.traceSnapshots)) {
    return {
      selector: params.traceSelector && typeof params.traceSelector === 'object' ? params.traceSelector : null,
      summary: params.traceSummary && typeof params.traceSummary === 'object' ? params.traceSummary : null,
      snapshots: params.traceSnapshots,
    };
  }
  const candidates = [
    params.trace,
    params.tracePayload,
    params.traceResult,
    params.traceContext,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return {
        selector: null,
        summary: null,
        snapshots: candidate,
      };
    }
    if (candidate && typeof candidate === 'object' && Array.isArray(candidate.snapshots)) {
      return {
        selector: candidate.selector && typeof candidate.selector === 'object' ? candidate.selector : null,
        summary: candidate.summary && typeof candidate.summary === 'object' ? candidate.summary : null,
        snapshots: candidate.snapshots,
      };
    }
  }
  return {
    selector: null,
    summary: null,
    snapshots: [],
  };
}

function normalizeTraceSnapshotForReconciled(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const reserveYesUsdc = toNumberOrNull(snapshot.reserveYesUsdc);
  const reserveNoUsdc = toNumberOrNull(snapshot.reserveNoUsdc);
  const reserveTotalUsdc =
    Number.isFinite(reserveYesUsdc) && Number.isFinite(reserveNoUsdc)
      ? round(reserveYesUsdc + reserveNoUsdc, 6)
      : toNumberOrNull(snapshot.reserveTotalUsdc);
  return {
    rowId: null,
    sequence: null,
    kind: classifyReconciledRowKind('pandora-reserve-trace'),
    inputType: 'trace-snapshot',
    classification: 'pandora-reserve-trace',
    venue: 'pandora',
    source: 'mirror-trace',
    timestamp: normalizeReconciledTimestamp(snapshot.blockTimestamp || snapshot.timestamp),
    status: 'observed',
    code: null,
    message: null,
    transactionRef: null,
    transactionNonce: null,
    blockNumber: coalesce(snapshot.blockNumber, null),
    blockHash: coalesce(snapshot.blockHash, null),
    side: null,
    tokenSide: null,
    orderSide: null,
    executionMode: null,
    amountUsdc: null,
    stateDeltaUsdc: null,
    reserveYesUsdc,
    reserveNoUsdc,
    reserveTotalUsdc,
    pandoraYesPct: toNumberOrNull(snapshot.pandoraYesPct),
    feeTier: coalesce(snapshot.feeTier, null),
    estimatedValueUsd: null,
    openOrdersCount: null,
    openOrdersNotionalUsd: null,
    sourceProvenance: {
      inputType: 'trace-snapshot',
      rawSource: snapshot.source || 'mirror-trace',
      rpcUrl: snapshot.rpcUrl || null,
    },
    details: cloneJsonCompatible({
      blockTimestamp: snapshot.blockTimestamp || null,
      rpcUrl: snapshot.rpcUrl || null,
      outcomeTokenSource: snapshot.outcomeTokenSource || null,
      fallbackUsed: snapshot.fallbackUsed === true,
    }),
  };
}

function buildLiveReconciledRows(live = {}) {
  const rows = [];
  const liveTimestamp = normalizeReconciledTimestamp(live.generatedAt || live.observedAt);
  const polymarketPosition =
    live.polymarketPosition && typeof live.polymarketPosition === 'object'
      ? live.polymarketPosition
      : null;
  const hasInventoryMark = Boolean(
    polymarketPosition
    && (
      polymarketPosition.yesBalance !== undefined
      || polymarketPosition.noBalance !== undefined
      || polymarketPosition.estimatedValueUsd !== undefined
      || polymarketPosition.openOrdersCount !== undefined
      || polymarketPosition.openOrdersNotionalUsd !== undefined
    )
  );
  if (hasInventoryMark) {
    rows.push({
      rowId: null,
      sequence: null,
      kind: classifyReconciledRowKind('polymarket-inventory-mark'),
      inputType: 'live-payload',
      classification: 'polymarket-inventory-mark',
      venue: 'polymarket',
      source: 'live.polymarketPosition',
      timestamp: liveTimestamp,
      status: 'marked',
      code: null,
      message: null,
      transactionRef: null,
      transactionNonce: null,
      blockNumber: null,
      blockHash: null,
      side: null,
      tokenSide: null,
      orderSide: null,
      executionMode: null,
      amountUsdc: null,
      stateDeltaUsdc: toNumberOrNull(live.netDeltaApprox),
      reserveYesUsdc: null,
      reserveNoUsdc: null,
      reserveTotalUsdc: null,
      pandoraYesPct: null,
      feeTier: null,
      estimatedValueUsd: toNumberOrNull(polymarketPosition.estimatedValueUsd),
      openOrdersCount: coalesce(polymarketPosition.openOrdersCount, null),
      openOrdersNotionalUsd: toNumberOrNull(polymarketPosition.openOrdersNotionalUsd),
      sourceProvenance: {
        inputType: 'live-payload',
        rawSource: 'live.polymarketPosition',
      },
      details: cloneJsonCompatible({
        yesBalance: toNumberOrNull(polymarketPosition.yesBalance),
        noBalance: toNumberOrNull(polymarketPosition.noBalance),
        prices: polymarketPosition.prices || null,
      }),
    });
  }

  const hasReserveMark = Boolean(
    live.reserveYesUsdc !== undefined
    || live.reserveNoUsdc !== undefined
    || live.reserveTotalUsdc !== undefined
  );
  if (hasReserveMark) {
    const reserveYesUsdc = toNumberOrNull(live.reserveYesUsdc);
    const reserveNoUsdc = toNumberOrNull(live.reserveNoUsdc);
    const reserveTotalUsdc =
      Number.isFinite(reserveYesUsdc) && Number.isFinite(reserveNoUsdc)
        ? round(reserveYesUsdc + reserveNoUsdc, 6)
        : toNumberOrNull(live.reserveTotalUsdc);
    rows.push({
      rowId: null,
      sequence: null,
      kind: classifyReconciledRowKind('pandora-reserve-mark'),
      inputType: 'live-payload',
      classification: 'pandora-reserve-mark',
      venue: 'pandora',
      source: 'live.reserve',
      timestamp: liveTimestamp,
      status: 'marked',
      code: null,
      message: null,
      transactionRef: null,
      transactionNonce: null,
      blockNumber: null,
      blockHash: null,
      side: null,
      tokenSide: null,
      orderSide: null,
      executionMode: null,
      amountUsdc: null,
      stateDeltaUsdc: null,
      reserveYesUsdc,
      reserveNoUsdc,
      reserveTotalUsdc,
      pandoraYesPct: toNumberOrNull(live.pandoraYesPct),
      feeTier: null,
      estimatedValueUsd: null,
      openOrdersCount: null,
      openOrdersNotionalUsd: null,
      sourceProvenance: {
        inputType: 'live-payload',
        rawSource: 'live.reserve',
      },
      details: cloneJsonCompatible({
        reserveSource: live.reserveSource || null,
        reserveReadAt: live.reserveReadAt || null,
        reserveReadError: live.reserveReadError || null,
      }),
    });
  }

  return rows;
}

function sortAndSequenceReconciledRows(rows) {
  return (Array.isArray(rows) ? rows.slice() : [])
    .filter(Boolean)
    .sort((left, right) => {
      const leftTime = left && left.timestamp ? Date.parse(left.timestamp) : Number.POSITIVE_INFINITY;
      const rightTime = right && right.timestamp ? Date.parse(right.timestamp) : Number.POSITIVE_INFINITY;
      if (leftTime !== rightTime) return leftTime - rightTime;
      const leftBlock = Number.isFinite(Number(left && left.blockNumber)) ? Number(left.blockNumber) : Number.POSITIVE_INFINITY;
      const rightBlock = Number.isFinite(Number(right && right.blockNumber)) ? Number(right.blockNumber) : Number.POSITIVE_INFINITY;
      if (leftBlock !== rightBlock) return leftBlock - rightBlock;
      const leftClassification = String(left && left.classification ? left.classification : '');
      const rightClassification = String(right && right.classification ? right.classification : '');
      if (leftClassification !== rightClassification) return leftClassification.localeCompare(rightClassification);
      const leftVenue = String(left && left.venue ? left.venue : '');
      const rightVenue = String(right && right.venue ? right.venue : '');
      if (leftVenue !== rightVenue) return leftVenue.localeCompare(rightVenue);
      const leftSource = String(left && left.source ? left.source : '');
      const rightSource = String(right && right.source ? right.source : '');
      if (leftSource !== rightSource) return leftSource.localeCompare(rightSource);
      const leftRef = String(left && left.transactionRef ? left.transactionRef : '');
      const rightRef = String(right && right.transactionRef ? right.transactionRef : '');
      return leftRef.localeCompare(rightRef);
    })
    .map((row, index) => ({
      ...row,
      rowId: `reconciled-${String(index + 1).padStart(4, '0')}`,
      sequence: index + 1,
    }));
}

function summarizeReconciledTrace(rows, traceSummary) {
  const traceRows = Array.isArray(rows)
    ? rows.filter((row) => row && row.classification === 'pandora-reserve-trace')
    : [];
  if (!traceRows.length) {
    return {
      snapshotCount: 0,
      firstBlockNumber: null,
      lastBlockNumber: null,
      firstTimestamp: null,
      lastTimestamp: null,
      reserveStartUsdc: null,
      reserveEndUsdc: null,
      reserveDeltaUsdc: null,
      latestReserveTotalUsdc: null,
      latestPandoraYesPct: null,
      latestFeeTier: null,
      rpcUrls: [],
    };
  }
  const ordered = traceRows.slice().sort((left, right) => {
    const leftBlock = Number.isFinite(Number(left && left.blockNumber)) ? Number(left.blockNumber) : Number.POSITIVE_INFINITY;
    const rightBlock = Number.isFinite(Number(right && right.blockNumber)) ? Number(right.blockNumber) : Number.POSITIVE_INFINITY;
    if (leftBlock !== rightBlock) return leftBlock - rightBlock;
    const leftTime = left && left.timestamp ? Date.parse(left.timestamp) : Number.POSITIVE_INFINITY;
    const rightTime = right && right.timestamp ? Date.parse(right.timestamp) : Number.POSITIVE_INFINITY;
    return leftTime - rightTime;
  });
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const reserveStartUsdc = toNumberOrNull(first.reserveTotalUsdc);
  const reserveEndUsdc = toNumberOrNull(last.reserveTotalUsdc);
  return {
    snapshotCount: ordered.length,
    firstBlockNumber: coalesce(
      first.blockNumber,
      traceSummary && traceSummary.firstBlockNumber !== undefined ? traceSummary.firstBlockNumber : null,
    ),
    lastBlockNumber: coalesce(
      last.blockNumber,
      traceSummary && traceSummary.lastBlockNumber !== undefined ? traceSummary.lastBlockNumber : null,
    ),
    firstTimestamp: first.timestamp || null,
    lastTimestamp: last.timestamp || null,
    reserveStartUsdc,
    reserveEndUsdc,
    reserveDeltaUsdc:
      Number.isFinite(reserveStartUsdc) && Number.isFinite(reserveEndUsdc)
        ? round(reserveEndUsdc - reserveStartUsdc, 6)
        : null,
    latestReserveTotalUsdc: reserveEndUsdc,
    latestPandoraYesPct: toNumberOrNull(last.pandoraYesPct),
    latestFeeTier: coalesce(last.feeTier, null),
    rpcUrls: collectUniqueStrings(ordered.map((row) => row && row.sourceProvenance ? row.sourceProvenance.rpcUrl : null)),
  };
}

function buildReconciledMirrorLedger(params = {}) {
  const state = params.state && typeof params.state === 'object' ? params.state : {};
  const live = params.live && typeof params.live === 'object' ? params.live : {};
  const auditEntries = Array.isArray(params.auditEntries) ? params.auditEntries : [];
  const traceInput = resolveTraceInput(params);
  const auditRows = auditEntries.map((entry) => normalizeAuditEntryForReconciled(entry)).filter(Boolean);
  const traceRows = traceInput.snapshots.map((snapshot) => normalizeTraceSnapshotForReconciled(snapshot)).filter(Boolean);
  const liveRows = buildLiveReconciledRows(live);
  const rows = sortAndSequenceReconciledRows(auditRows.concat(traceRows, liveRows));
  const traceSummary = summarizeReconciledTrace(traceRows, traceInput.summary);
  const legacyApprox = {
    netPnlApproxUsdc: toNumberOrNull(live.netPnlApproxUsdc),
    pnlApprox: toNumberOrNull(live.pnlApprox),
    netDeltaApprox: toNumberOrNull(live.netDeltaApprox),
    currentHedgeShares: toNumberOrNull(
      live.currentHedgeShares !== undefined
        ? live.currentHedgeShares
        : state.currentHedgeShares !== undefined
          ? state.currentHedgeShares
          : live.currentHedgeUsdc !== undefined
            ? live.currentHedgeUsdc
            : state.currentHedgeUsdc,
    ),
    currentHedgeUsdc: toNumberOrNull(
      live.currentHedgeUsdc !== undefined ? live.currentHedgeUsdc : state.currentHedgeUsdc,
    ),
    cumulativeLpFeesApproxUsdc: toNumberOrNull(
      live.cumulativeLpFeesApproxUsdc !== undefined ? live.cumulativeLpFeesApproxUsdc : state.cumulativeLpFeesApproxUsdc,
    ),
    cumulativeHedgeCostApproxUsdc: toNumberOrNull(
      live.cumulativeHedgeCostApproxUsdc !== undefined
        ? live.cumulativeHedgeCostApproxUsdc
        : state.cumulativeHedgeCostApproxUsdc,
    ),
  };
  const pandoraLegRows = auditRows.filter((row) => row.classification === 'pandora-rebalance');
  const polymarketLegRows = auditRows.filter((row) => row.classification === 'polymarket-hedge');
  const alertRows = auditRows.filter((row) => row.classification === 'runtime-alert');
  const actionRows = auditRows.filter((row) => row.classification === 'sync-action');
  const pandoraComponent = {
    rebalanceAttemptedUsdc: sumRounded(pandoraLegRows.map((row) => row.amountUsdc)),
    rebalanceExecutedUsdc: sumRounded(
      pandoraLegRows.filter((row) => !isFailureStatus(row.status)).map((row) => row.amountUsdc),
    ),
    currentReserveTotalUsdc: coalesce(traceSummary.latestReserveTotalUsdc, toNumberOrNull(live.reserveTotalUsdc)),
    traceSnapshotCount: traceSummary.snapshotCount,
    reserveStartUsdc: traceSummary.reserveStartUsdc,
    reserveEndUsdc: traceSummary.reserveEndUsdc,
    reserveDeltaUsdc: traceSummary.reserveDeltaUsdc,
    latestPandoraYesPct: coalesce(traceSummary.latestPandoraYesPct, toNumberOrNull(live.pandoraYesPct)),
    latestFeeTier: traceSummary.latestFeeTier,
  };
  const polymarketComponent = {
    hedgeAttemptedUsdc: sumRounded(polymarketLegRows.map((row) => row.amountUsdc)),
    hedgeExecutedUsdc: sumRounded(
      polymarketLegRows.filter((row) => !isFailureStatus(row.status)).map((row) => row.amountUsdc),
    ),
    hedgeStateDeltaUsdc: sumRounded(polymarketLegRows.map((row) => row.stateDeltaUsdc)),
    currentInventoryValueUsd: toNumberOrNull(
      live.polymarketPosition && live.polymarketPosition.estimatedValueUsd,
    ),
    openOrdersNotionalUsd: toNumberOrNull(
      live.polymarketPosition && live.polymarketPosition.openOrdersNotionalUsd,
    ),
    currentYesBalance: toNumberOrNull(live.polymarketPosition && live.polymarketPosition.yesBalance),
    currentNoBalance: toNumberOrNull(live.polymarketPosition && live.polymarketPosition.noBalance),
    netDeltaApprox: legacyApprox.netDeltaApprox,
  };
  const lpTraceAvailable = traceSummary.snapshotCount >= 2;
  const lpComponent = {
    feeIncomeApproxUsdc: legacyApprox.cumulativeLpFeesApproxUsdc,
    hedgeCostApproxUsdc: legacyApprox.cumulativeHedgeCostApproxUsdc,
    reserveStartUsdc: traceSummary.reserveStartUsdc,
    reserveEndUsdc: traceSummary.reserveEndUsdc,
    reserveDeltaUsdc: traceSummary.reserveDeltaUsdc,
    impermanentLossUsdc: null,
    impermanentLossStatus: lpTraceAvailable ? 'insufficient-basis' : 'not-available',
    traceWindowStart: traceSummary.firstTimestamp,
    traceWindowEnd: traceSummary.lastTimestamp,
  };
  const fundingComponent = {
    rowCount: auditRows.filter((row) => row.venue === 'funding').length,
    netUsdc: null,
    status: 'not-yet-reconciled',
  };
  const gasComponent = {
    rowCount: auditRows.filter((row) => row.venue === 'gas').length,
    totalUsdc: null,
    status: 'not-yet-reconciled',
  };
  const firstTimedRow = rows.find((row) => row && row.timestamp);
  const lastTimedRow = rows.slice().reverse().find((row) => row && row.timestamp);
  const diagnostics = [];
  if (lpTraceAvailable) {
    diagnostics.push('Reserve trace snapshots are available, but impermanent loss remains null until a capital basis and settlement model are attached.');
  }
  if (traceSummary.snapshotCount && !traceSummary.reserveDeltaUsdc) {
    diagnostics.push('Reserve trace snapshots were attached, but reserve delta could not be derived from the available totals.');
  }
  return {
    schemaVersion: MIRROR_RECONCILED_LEDGER_SCHEMA_VERSION,
    mode: 'derived',
    available: Boolean(rows.length || legacyApprox.netPnlApproxUsdc !== null || legacyApprox.pnlApprox !== null),
    deterministic: true,
    sourceInputs: {
      audit: auditRows.length ? (params.auditSource || 'audit-log') : 'none',
      trace: traceRows.length ? 'mirror-trace' : 'none',
      live: Object.keys(live).length ? 'live-payload' : 'none',
    },
    summary: {
      rowCount: rows.length,
      auditRowCount: auditRows.length,
      traceRowCount: traceRows.length,
      liveRowCount: liveRows.length,
      actionCount: actionRows.length,
      legCount: pandoraLegRows.length + polymarketLegRows.length,
      alertCount: alertRows.length,
      traceSnapshotCount: traceSummary.snapshotCount,
      firstTimestamp: firstTimedRow ? firstTimedRow.timestamp : null,
      lastTimestamp: lastTimedRow ? lastTimedRow.timestamp : null,
      reserveStartUsdc: traceSummary.reserveStartUsdc,
      reserveEndUsdc: traceSummary.reserveEndUsdc,
      reserveDeltaUsdc: traceSummary.reserveDeltaUsdc,
      inventoryMarkUsd: polymarketComponent.currentInventoryValueUsd,
      rebalanceExecutedUsdc: pandoraComponent.rebalanceExecutedUsdc,
      hedgeExecutedUsdc: polymarketComponent.hedgeExecutedUsdc,
      feeIncomeApproxUsdc: lpComponent.feeIncomeApproxUsdc,
      hedgeCostApproxUsdc: lpComponent.hedgeCostApproxUsdc,
      impermanentLossUsdc: lpComponent.impermanentLossUsdc,
      netPnlApproxUsdc: legacyApprox.netPnlApproxUsdc,
      pnlApprox: legacyApprox.pnlApprox,
    },
    components: {
      legacyApprox,
      pandora: pandoraComponent,
      polymarket: polymarketComponent,
      lp: lpComponent,
      funding: fundingComponent,
      gas: gasComponent,
      trace: {
        snapshotCount: traceSummary.snapshotCount,
        firstBlockNumber: traceSummary.firstBlockNumber,
        lastBlockNumber: traceSummary.lastBlockNumber,
        firstTimestamp: traceSummary.firstTimestamp,
        lastTimestamp: traceSummary.lastTimestamp,
        latestFeeTier: traceSummary.latestFeeTier,
        rpcUrls: traceSummary.rpcUrls,
      },
    },
    rows,
    diagnostics,
  };
}

function pickFirstNumber() {
  for (const value of arguments) {
    const numeric = toNumberOrNull(value);
    if (numeric !== null) return numeric;
  }
  return null;
}

function normalizePositiveNumber(value) {
  const numeric = toNumberOrNull(value);
  if (numeric === null) return null;
  return round(Math.abs(numeric), 6);
}

function normalizeMirrorAccounting(accounting) {
  const safe = accounting && typeof accounting === 'object' ? accounting : {};
  return {
    rows: Array.isArray(safe.rows)
      ? safe.rows.slice()
      : Array.isArray(safe.ledgerRows)
        ? safe.ledgerRows.slice()
        : [],
    traceSnapshots: Array.isArray(safe.traceSnapshots) ? safe.traceSnapshots.slice() : [],
    components: safe.components && typeof safe.components === 'object' ? safe.components : {},
    provenance: safe.provenance && typeof safe.provenance === 'object' ? safe.provenance : {},
    traceSummary: safe.traceSummary && typeof safe.traceSummary === 'object' ? safe.traceSummary : {},
  };
}

function deriveMirrorChain(value, fallbackVenue) {
  const normalized = value === null || value === undefined ? '' : String(value).trim().toLowerCase();
  if (normalized) return normalized;
  if (fallbackVenue === 'pandora') return 'ethereum';
  if (fallbackVenue === 'polymarket') return 'polygon';
  return null;
}

function normalizeTransactionRefs(reference) {
  const text = reference === null || reference === undefined ? '' : String(reference).trim();
  if (!text) {
    return {
      txHash: null,
      orderRef: null,
    };
  }
  if (/^0x[a-z0-9]{4,}$/i.test(text)) {
    return {
      txHash: text,
      orderRef: null,
    };
  }
  return {
    txHash: null,
    orderRef: text,
  };
}

function pickGasCostUsdc(details = {}) {
  const result = details && details.result && typeof details.result === 'object' ? details.result : {};
  return pickFirstNumber(
    details.gasUsdc,
    details.gasCostUsdc,
    details.gasUsd,
    details.gasCostUsd,
    result.gasUsdc,
    result.gasCostUsdc,
    result.gasUsd,
    result.gasCostUsd,
  );
}

function normalizeMirrorReconciledRow(row = {}, index = 0, defaults = {}) {
  const safe = row && typeof row === 'object' ? row : {};
  const explicitTxHash = coalesce(safe.txHash, safe.transactionHash);
  const explicitOrderRef = coalesce(safe.orderRef, safe.orderId, safe.transactionRef);
  const fallbackRefs = normalizeTransactionRefs(explicitOrderRef);
  const refs = explicitTxHash
    ? {
      txHash: String(explicitTxHash).trim() || null,
      orderRef: fallbackRefs.orderRef,
    }
    : fallbackRefs;
  const venue = coalesce(safe.venue, defaults.venue) || null;
  const component = coalesce(safe.component, safe.category, defaults.component) || null;
  const classification = coalesce(safe.classification, defaults.classification) || null;
  return {
    id: coalesce(safe.id, defaults.id, `${classification || component || 'row'}-${index + 1}`),
    timestamp: toIso(coalesce(safe.timestamp, defaults.timestamp)),
    venue,
    chain: deriveMirrorChain(coalesce(safe.chain, defaults.chain), venue),
    component,
    classification,
    direction: coalesce(safe.direction, defaults.direction),
    amountUsdc: pickFirstNumber(safe.amountUsdc, safe.amount, safe.notionalUsdc, defaults.amountUsdc),
    cashFlowUsdc: pickFirstNumber(safe.cashFlowUsdc, defaults.cashFlowUsdc),
    realizedPnlUsdc: pickFirstNumber(safe.realizedPnlUsdc, defaults.realizedPnlUsdc),
    unrealizedPnlUsdc: pickFirstNumber(safe.unrealizedPnlUsdc, defaults.unrealizedPnlUsdc),
    feeUsdc: pickFirstNumber(safe.feeUsdc, safe.feesUsdc, defaults.feeUsdc),
    gasUsdc: pickFirstNumber(safe.gasUsdc, safe.gasCostUsdc, safe.gasUsd, defaults.gasUsdc),
    txHash: refs.txHash,
    orderRef: refs.orderRef,
    blockNumber: pickFirstNumber(safe.blockNumber, defaults.blockNumber),
    status: coalesce(safe.status, defaults.status),
    source: coalesce(safe.source, defaults.source) || null,
    provenance: coalesce(safe.provenance, defaults.provenance) || null,
    notes: coalesce(safe.notes, defaults.notes) || null,
  };
}

function buildReconciledRowFromAuditEntry(entry = {}, index = 0) {
  const details = entry && entry.details && typeof entry.details === 'object' ? entry.details : {};
  if (entry.classification === 'pandora-rebalance') {
    const amountUsdc = toNumberOrNull(details.amountUsdc);
    return normalizeMirrorReconciledRow({
      id: `pandora-rebalance-${index + 1}`,
      timestamp: entry.timestamp,
      venue: 'pandora',
      component: 'pandora-rebalance',
      classification: entry.classification,
      direction: details.side || null,
      amountUsdc,
      cashFlowUsdc: amountUsdc === null ? null : round(-Math.abs(amountUsdc), 6),
      gasUsdc: pickGasCostUsdc(details),
      transactionRef: details.transactionRef,
      status: entry.status || null,
      source: entry.source || null,
      provenance: 'mirror-audit-ledger',
    }, index);
  }
  if (entry.classification === 'polymarket-hedge') {
    const amountUsdc = toNumberOrNull(details.amountUsdc);
    const orderSide = details.orderSide || null;
    return normalizeMirrorReconciledRow({
      id: `polymarket-hedge-${index + 1}`,
      timestamp: entry.timestamp,
      venue: 'polymarket',
      component: 'polymarket-hedge',
      classification: entry.classification,
      direction: coalesce(orderSide, details.tokenSide),
      amountUsdc,
      cashFlowUsdc:
        amountUsdc === null
          ? null
          : orderSide === 'sell'
            ? round(Math.abs(amountUsdc), 6)
            : round(-Math.abs(amountUsdc), 6),
      gasUsdc: pickGasCostUsdc(details),
      transactionRef: details.transactionRef,
      status: entry.status || null,
      source: entry.source || null,
      provenance: 'mirror-audit-ledger',
    }, index);
  }
  return null;
}

function componentRowExists(rows, component) {
  return rows.some((row) => row && row.component === component);
}

function buildReconciledLedgerRowKey(row = {}) {
  const safe = row && typeof row === 'object' ? row : {};
  return [
    safe.timestamp || '',
    safe.venue || '',
    safe.chain || '',
    safe.component || '',
    safe.classification || '',
    safe.direction || '',
    safe.txHash || '',
    safe.orderRef || '',
    toNumberOrNull(safe.amountUsdc),
    toNumberOrNull(safe.cashFlowUsdc),
    toNumberOrNull(safe.realizedPnlUsdc),
    toNumberOrNull(safe.unrealizedPnlUsdc),
    toNumberOrNull(safe.gasUsdc),
    toNumberOrNull(safe.blockNumber),
    safe.status || '',
  ].join('|');
}

function pushUniqueReconciledRow(target, row, knownKeys) {
  if (!row || typeof row !== 'object') return false;
  const key = buildReconciledLedgerRowKey(row);
  if (knownKeys.has(key)) return false;
  knownKeys.add(key);
  target.push(row);
  return true;
}

function buildMirrorTraceSummary(traceSnapshots = []) {
  const normalized = Array.isArray(traceSnapshots) ? traceSnapshots.filter((item) => item && typeof item === 'object') : [];
  if (!normalized.length) {
    return {
      snapshotCount: 0,
      firstBlock: null,
      lastBlock: null,
      lastTimestamp: null,
      reserveStartUsdc: null,
      reserveEndUsdc: null,
      reserveDeltaUsdc: null,
      latestFeeTier: null,
      rpcUrls: [],
      impermanentLossUsdc: null,
    };
  }
  const sorted = normalized.slice().sort((left, right) => {
    const leftBlock = pickFirstNumber(left.blockNumber, left.block);
    const rightBlock = pickFirstNumber(right.blockNumber, right.block);
    return (leftBlock || 0) - (rightBlock || 0);
  });
  const last = sorted[sorted.length - 1];
  const firstReserveTotalUsdc = pickFirstNumber(
    sorted[0].reserveTotalUsdc,
    Number.isFinite(Number(sorted[0].reserveYesUsdc)) && Number.isFinite(Number(sorted[0].reserveNoUsdc))
      ? Number(sorted[0].reserveYesUsdc) + Number(sorted[0].reserveNoUsdc)
      : null,
  );
  const lastReserveTotalUsdc = pickFirstNumber(
    last.reserveTotalUsdc,
    Number.isFinite(Number(last.reserveYesUsdc)) && Number.isFinite(Number(last.reserveNoUsdc))
      ? Number(last.reserveYesUsdc) + Number(last.reserveNoUsdc)
      : null,
  );
  return {
    snapshotCount: sorted.length,
    firstBlock: pickFirstNumber(sorted[0].blockNumber, sorted[0].block),
    lastBlock: pickFirstNumber(last.blockNumber, last.block),
    lastTimestamp: toIso(coalesce(last.blockTimestamp, last.timestamp)),
    reserveStartUsdc: firstReserveTotalUsdc,
    reserveEndUsdc: lastReserveTotalUsdc,
    reserveDeltaUsdc:
      firstReserveTotalUsdc !== null && lastReserveTotalUsdc !== null
        ? round(lastReserveTotalUsdc - firstReserveTotalUsdc, 6)
        : null,
    latestFeeTier: pickFirstNumber(last.feeTier),
    rpcUrls: collectUniqueStrings(sorted.map((item) => item.rpcUrl || null)),
    impermanentLossUsdc: normalizePositiveNumber(
      coalesce(last.impermanentLossUsdc, last.ilUsdc, last.impermanentLossApproxUsdc),
    ),
  };
}

function sumMirrorReconciledField(rows, fieldName, predicate) {
  const total = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === 'object')
    .filter((row) => (typeof predicate === 'function' ? predicate(row) : true))
    .reduce((sum, row) => sum + (toNumberOrNull(row[fieldName]) || 0), 0);
  return round(total, 6) || 0;
}

function buildMirrorReconciledPayload(params = {}) {
  if (params.reconciled && typeof params.reconciled === 'object') {
    return params.reconciled;
  }
  if (!params.includeReconciled) return null;

  const state = params.state && typeof params.state === 'object' ? params.state : {};
  const live = params.live && typeof params.live === 'object' ? params.live : {};
  const allowLiveApproxRows = params.allowLiveApproxRows !== false;
  const accounting = normalizeMirrorAccounting(params.accounting || state.accounting || null);
  const directTraceInput = resolveTraceInput(params);
  const traceSnapshots = [];
  const traceSnapshotKeys = new Set();
  for (const snapshot of accounting.traceSnapshots.concat(directTraceInput.snapshots)) {
    if (!snapshot || typeof snapshot !== 'object') continue;
    const key = [
      pickFirstNumber(snapshot.blockNumber, snapshot.block),
      toIso(coalesce(snapshot.blockTimestamp, snapshot.timestamp)),
      snapshot.rpcUrl || '',
    ].join('|');
    if (traceSnapshotKeys.has(key)) continue;
    traceSnapshotKeys.add(key);
    traceSnapshots.push(snapshot);
  }
  const traceSummary = buildMirrorTraceSummary(traceSnapshots);
  const rows = [];
  const rowKeys = new Set();
  accounting.rows.forEach((row, index) => {
    pushUniqueReconciledRow(rows, normalizeMirrorReconciledRow(row, index, {
      provenance: 'state.accounting.rows',
    }), rowKeys);
  });
  const sources = [];
  if (rows.length) sources.push('state.accounting.rows');

  const ledgerEntries = Array.isArray(params.ledgerEntries) ? params.ledgerEntries : [];
  ledgerEntries.forEach((entry, index) => {
    const normalized = buildReconciledRowFromAuditEntry(entry, index);
    pushUniqueReconciledRow(rows, normalized, rowKeys);
  });
  if (ledgerEntries.some((entry) => entry && (entry.classification === 'pandora-rebalance' || entry.classification === 'polymarket-hedge'))) {
    sources.push('mirror-audit-log');
  }
  if (traceSnapshots.length) {
    sources.push('mirror-trace');
  }

  const deterministicLedger = buildReconciledMirrorLedger({
    state,
    live,
    auditEntries: ledgerEntries,
    auditSource: ledgerEntries.length ? 'mirror-audit-log' : (rows.length ? 'state.accounting.rows' : 'none'),
    traceSnapshots,
    traceSummary: accounting.traceSummary,
  });
  const syntheticTimestamp = toIso(coalesce(
    params.generatedAt,
    live.generatedAt,
    live.observedAt,
    traceSummary.lastTimestamp,
    state.lastExecution && state.lastExecution.completedAt,
    state.lastExecution && state.lastExecution.startedAt,
    ledgerEntries[0] && ledgerEntries[0].timestamp,
  ));

  const persistedLpFeeIncomeUsdc = normalizePositiveNumber(
    coalesce(
      accounting.components.lpFeeIncomeUsdc,
      accounting.components.cumulativeLpFeesApproxUsdc,
    ),
  );
  const lpFeeIncomeUsdc = persistedLpFeeIncomeUsdc !== null
    ? persistedLpFeeIncomeUsdc
    : allowLiveApproxRows
      ? normalizePositiveNumber(coalesce(live.cumulativeLpFeesApproxUsdc, state.cumulativeLpFeesApproxUsdc))
      : null;
  const lpFeeIncomeSource = accounting.components.lpFeeIncomeUsdc !== undefined
    ? 'state.accounting.components.lpFeeIncomeUsdc'
    : accounting.components.cumulativeLpFeesApproxUsdc !== undefined
      ? 'state.accounting.components.cumulativeLpFeesApproxUsdc'
      : live.cumulativeLpFeesApproxUsdc !== undefined
        ? 'live.cumulativeLpFeesApproxUsdc'
        : state.cumulativeLpFeesApproxUsdc !== undefined
          ? 'state.cumulativeLpFeesApproxUsdc'
          : null;
  const lpFeeIncomeProvenance = persistedLpFeeIncomeUsdc !== null ? 'state.accounting.components' : 'legacy-lp-fee-counter';
  if (!componentRowExists(rows, 'lp-fee-income') && lpFeeIncomeUsdc !== null) {
    const added = pushUniqueReconciledRow(rows, normalizeMirrorReconciledRow({
      id: 'lp-fee-income',
      timestamp: syntheticTimestamp,
      venue: 'pandora',
      chain: 'ethereum',
      component: 'lp-fee-income',
      classification: 'lp-fee-income',
      amountUsdc: lpFeeIncomeUsdc,
      realizedPnlUsdc: lpFeeIncomeUsdc,
      source: lpFeeIncomeSource,
      provenance: lpFeeIncomeProvenance,
      status: 'estimated',
    }, rows.length), rowKeys);
    if (added) sources.push(lpFeeIncomeProvenance);
  }

  const persistedHedgeCostUsdc = normalizePositiveNumber(
    coalesce(
      accounting.components.hedgeCostUsdc,
      accounting.components.cumulativeHedgeCostApproxUsdc,
    ),
  );
  const hedgeCostUsdc = persistedHedgeCostUsdc !== null
    ? persistedHedgeCostUsdc
    : allowLiveApproxRows
      ? normalizePositiveNumber(coalesce(live.cumulativeHedgeCostApproxUsdc, state.cumulativeHedgeCostApproxUsdc))
      : null;
  const hedgeCostSource = accounting.components.hedgeCostUsdc !== undefined
    ? 'state.accounting.components.hedgeCostUsdc'
    : accounting.components.cumulativeHedgeCostApproxUsdc !== undefined
      ? 'state.accounting.components.cumulativeHedgeCostApproxUsdc'
      : live.cumulativeHedgeCostApproxUsdc !== undefined
        ? 'live.cumulativeHedgeCostApproxUsdc'
        : state.cumulativeHedgeCostApproxUsdc !== undefined
          ? 'state.cumulativeHedgeCostApproxUsdc'
          : null;
  const hedgeCostProvenance = persistedHedgeCostUsdc !== null ? 'state.accounting.components' : 'legacy-hedge-cost-counter';
  if (!componentRowExists(rows, 'hedge-cost') && hedgeCostUsdc !== null) {
    const added = pushUniqueReconciledRow(rows, normalizeMirrorReconciledRow({
      id: 'hedge-cost',
      timestamp: syntheticTimestamp,
      venue: 'polymarket',
      chain: 'polygon',
      component: 'hedge-cost',
      classification: 'hedge-cost',
      amountUsdc: hedgeCostUsdc,
      realizedPnlUsdc: round(-Math.abs(hedgeCostUsdc), 6),
      source: hedgeCostSource,
      provenance: hedgeCostProvenance,
      status: 'estimated',
    }, rows.length), rowKeys);
    if (added) sources.push(hedgeCostProvenance);
  }

  const persistedInventoryMarkUsd = pickFirstNumber(
    accounting.components.markToMarketInventoryUsd,
    accounting.components.hedgeInventoryMarkUsdc,
  );
  const markedInventoryUsd = persistedInventoryMarkUsd !== null
    ? persistedInventoryMarkUsd
    : allowLiveApproxRows
      ? pickFirstNumber(live.polymarketPosition && live.polymarketPosition.estimatedValueUsd)
      : null;
  const inventoryMarkSource = accounting.components.markToMarketInventoryUsd !== undefined
    ? 'state.accounting.components.markToMarketInventoryUsd'
    : accounting.components.hedgeInventoryMarkUsdc !== undefined
      ? 'state.accounting.components.hedgeInventoryMarkUsdc'
      : 'live.polymarketPosition.estimatedValueUsd';
  const inventoryMarkProvenance = persistedInventoryMarkUsd !== null ? 'state.accounting.components' : 'live-polymarket-mark';
  if (!componentRowExists(rows, 'inventory-mark') && markedInventoryUsd !== null) {
    const added = pushUniqueReconciledRow(rows, normalizeMirrorReconciledRow({
      id: 'inventory-mark',
      timestamp: syntheticTimestamp,
      venue: 'polymarket',
      chain: 'polygon',
      component: 'inventory-mark',
      classification: 'inventory-mark',
      amountUsdc: markedInventoryUsd,
      unrealizedPnlUsdc: markedInventoryUsd,
      source: inventoryMarkSource,
      provenance: inventoryMarkProvenance,
      status: 'marked',
    }, rows.length), rowKeys);
    if (added) sources.push(inventoryMarkProvenance);
  }
  const impermanentLossUsdc = normalizePositiveNumber(
    coalesce(
      accounting.components.impermanentLossUsdc,
      accounting.traceSummary.impermanentLossUsdc,
      traceSummary.impermanentLossUsdc,
    ),
  );
  if (!componentRowExists(rows, 'impermanent-loss') && impermanentLossUsdc !== null) {
    const impermanentLossSource = accounting.components.impermanentLossUsdc !== undefined
      ? 'state.accounting.components.impermanentLossUsdc'
      : traceSummary.impermanentLossUsdc !== null
        ? 'state.accounting.traceSnapshots'
        : null;
    const impermanentLossProvenance = accounting.components.impermanentLossUsdc !== undefined ? 'state.accounting.components' : 'reserve-trace';
    const added = pushUniqueReconciledRow(rows, normalizeMirrorReconciledRow({
      id: 'impermanent-loss',
      timestamp: traceSummary.lastTimestamp || syntheticTimestamp,
      venue: 'pandora',
      chain: 'ethereum',
      component: 'impermanent-loss',
      classification: 'impermanent-loss',
      amountUsdc: impermanentLossUsdc,
      unrealizedPnlUsdc: round(-Math.abs(impermanentLossUsdc), 6),
      source: impermanentLossSource,
      provenance: impermanentLossProvenance,
      status: 'estimated',
    }, rows.length), rowKeys);
    if (added) sources.push(impermanentLossProvenance);
  }

  rows.sort((left, right) => {
    const leftTime = left.timestamp ? Date.parse(left.timestamp) : 0;
    const rightTime = right.timestamp ? Date.parse(right.timestamp) : 0;
    return rightTime - leftTime;
  });

  const realizedPnlUsdc = sumMirrorReconciledField(rows, 'realizedPnlUsdc');
  const unrealizedPnlUsdc = sumMirrorReconciledField(rows, 'unrealizedPnlUsdc');
  const gasCostUsdc = sumMirrorReconciledField(
    rows,
    'gasUsdc',
    (row) => row.component === 'gas-cost' || toNumberOrNull(row.gasUsdc) !== null,
  );
  const fundingNetUsdc = sumMirrorReconciledField(rows, 'cashFlowUsdc', (row) => row.component === 'funding');
  const transactionHashCount = new Set(rows.map((row) => row.txHash).filter(Boolean)).size;
  const fundingRowCount = rows.filter((row) => row && (row.component === 'funding' || row.venue === 'funding' || row.venue === 'bridge')).length;
  const gasRowCount = rows.filter((row) => row && (row.component === 'gas-cost' || row.venue === 'gas' || toNumberOrNull(row.gasUsdc) !== null)).length;
  const missing = [];
  if (!componentRowExists(rows, 'lp-fee-income')) missing.push('lp-fee-income');
  if (!componentRowExists(rows, 'hedge-cost')) missing.push('hedge-cost');
  if (!componentRowExists(rows, 'inventory-mark')) missing.push('inventory-mark');
  if (!componentRowExists(rows, 'impermanent-loss')) missing.push('impermanent-loss');
  if (!fundingRowCount) missing.push('funding');
  if (!gasRowCount) missing.push('gas-cost');
  if (!traceSummary.snapshotCount) missing.push('reserve-trace');
  const accountingStatus = accounting.provenance && typeof accounting.provenance.status === 'string'
    ? String(accounting.provenance.status).trim().toLowerCase()
    : null;
  const reconciledStatus = missing.length ? 'partial' : (accountingStatus || 'complete');

  const exportColumns = [
    'timestamp',
    'venue',
    'chain',
    'component',
    'classification',
    'direction',
    'amount_usdc',
    'cash_flow_usdc',
    'realized_pnl_usdc',
    'unrealized_pnl_usdc',
    'fee_usdc',
    'gas_usdc',
    'tx_hash',
    'order_ref',
    'block_number',
    'status',
    'source',
    'provenance',
    'notes',
  ];
  const exportRows = rows.map((row) => ({
    timestamp: row.timestamp,
    venue: row.venue,
    chain: row.chain,
    component: row.component,
    classification: row.classification,
    direction: row.direction,
    amount_usdc: row.amountUsdc,
    cash_flow_usdc: row.cashFlowUsdc,
    realized_pnl_usdc: row.realizedPnlUsdc,
    unrealized_pnl_usdc: row.unrealizedPnlUsdc,
    fee_usdc: row.feeUsdc,
    gas_usdc: row.gasUsdc,
    tx_hash: row.txHash,
    order_ref: row.orderRef,
    block_number: row.blockNumber,
    status: row.status,
    source: row.source,
    provenance: row.provenance,
    notes: row.notes,
  }));

  return {
    status: reconciledStatus,
    summary: {
      rowCount: rows.length,
      transactionHashCount,
      traceSnapshotCount: traceSummary.snapshotCount,
      deterministicRowCount: deterministicLedger.summary.rowCount,
      realizedPnlUsdc,
      unrealizedPnlUsdc,
      netPnlUsdc: round(realizedPnlUsdc + unrealizedPnlUsdc, 6),
      lpFeeIncomeUsdc: sumMirrorReconciledField(rows, 'realizedPnlUsdc', (row) => row.component === 'lp-fee-income'),
      hedgeCostUsdc: sumMirrorReconciledField(rows, 'amountUsdc', (row) => row.component === 'hedge-cost'),
      gasCostUsdc,
      fundingNetUsdc,
      impermanentLossUsdc: sumMirrorReconciledField(rows, 'amountUsdc', (row) => row.component === 'impermanent-loss'),
      inventoryMarkUsdc: sumMirrorReconciledField(rows, 'unrealizedPnlUsdc', (row) => row.component === 'inventory-mark'),
      pandoraRebalanceUsdc: deterministicLedger.components.pandora.rebalanceExecutedUsdc,
      polymarketHedgeUsdc: deterministicLedger.components.polymarket.hedgeExecutedUsdc,
      reserveStartUsdc: deterministicLedger.summary.reserveStartUsdc,
      reserveEndUsdc: deterministicLedger.summary.reserveEndUsdc,
      reserveDeltaUsdc: deterministicLedger.summary.reserveDeltaUsdc,
      legacyNetPnlApproxUsdc: toNumberOrNull(live.netPnlApproxUsdc),
      legacyMarkedPnlApproxUsdc: toNumberOrNull(live.pnlApprox),
    },
    components: {
      lpFeeIncomeUsdc: sumMirrorReconciledField(rows, 'realizedPnlUsdc', (row) => row.component === 'lp-fee-income'),
      hedgeCostUsdc: sumMirrorReconciledField(rows, 'amountUsdc', (row) => row.component === 'hedge-cost'),
      gasCostUsdc,
      fundingNetUsdc,
      impermanentLossUsdc: sumMirrorReconciledField(rows, 'amountUsdc', (row) => row.component === 'impermanent-loss'),
      inventoryMarkUsdc: sumMirrorReconciledField(rows, 'unrealizedPnlUsdc', (row) => row.component === 'inventory-mark'),
      pandora: deterministicLedger.components.pandora,
      polymarket: deterministicLedger.components.polymarket,
      lp: deterministicLedger.components.lp,
      funding: {
        ...deterministicLedger.components.funding,
        rowCount: fundingRowCount,
        netUsdc: fundingNetUsdc,
        status: fundingRowCount ? 'complete' : 'not-yet-reconciled',
      },
      gas: {
        ...deterministicLedger.components.gas,
        rowCount: gasRowCount,
        totalUsdc: gasCostUsdc,
        status: gasRowCount ? 'complete' : 'not-yet-reconciled',
      },
    },
    trace: {
      snapshotCount: traceSummary.snapshotCount,
      firstBlock: traceSummary.firstBlock,
      lastBlock: traceSummary.lastBlock,
      lastTimestamp: traceSummary.lastTimestamp,
      reserveStartUsdc: deterministicLedger.summary.reserveStartUsdc,
      reserveEndUsdc: deterministicLedger.summary.reserveEndUsdc,
      reserveDeltaUsdc: deterministicLedger.summary.reserveDeltaUsdc,
      latestFeeTier: deterministicLedger.components.trace.latestFeeTier,
      rpcUrls: deterministicLedger.components.trace.rpcUrls,
    },
    provenance: {
      sources: Array.from(new Set(sources.filter(Boolean))),
      missing,
      usedAccountingRows: accounting.rows.length > 0,
      usedAuditLedger: ledgerEntries.length > 0,
      usedTraceRows: traceSnapshots.length > 0,
      usedLiveMark: allowLiveApproxRows && persistedInventoryMarkUsd === null && markedInventoryUsd !== null,
      sourceInputs: deterministicLedger.sourceInputs,
      usedLegacyApproximation: Boolean(
        (persistedLpFeeIncomeUsdc === null && lpFeeIncomeUsdc !== null)
        || (persistedHedgeCostUsdc === null && hedgeCostUsdc !== null)
        || (persistedInventoryMarkUsd === null && markedInventoryUsd !== null),
      ),
    },
    ledger: {
      rows,
      exportColumns,
      exportRows,
    },
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
  const reconciled = buildMirrorReconciledPayload({
    reconciled: params.reconciled,
    includeReconciled: Boolean(params.includeReconciled),
    allowLiveApproxRows: false,
    state,
    live,
    accounting: params.accounting,
    ledgerEntries,
    generatedAt: params.generatedAt,
    traceSnapshots: params.traceSnapshots,
    trace: params.trace,
    tracePayload: params.tracePayload,
    traceResult: params.traceResult,
    traceContext: params.traceContext,
  });

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
      reconciledStatus: reconciled ? reconciled.status : null,
      reconciledRowCount: reconciled ? reconciled.summary.rowCount : null,
      realizedPnlUsdc: reconciled ? reconciled.summary.realizedPnlUsdc : null,
      unrealizedPnlUsdc: reconciled ? reconciled.summary.unrealizedPnlUsdc : null,
      netPnlUsdc: reconciled ? reconciled.summary.netPnlUsdc : null,
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
    reconciled,
    diagnostics,
  };
}

module.exports = {
  MIRROR_DASHBOARD_SCHEMA_VERSION,
  MIRROR_DRIFT_SCHEMA_VERSION,
  MIRROR_HEDGE_CHECK_SCHEMA_VERSION,
  MIRROR_PNL_SCHEMA_VERSION,
  MIRROR_AUDIT_SCHEMA_VERSION,
  MIRROR_RECONCILED_LEDGER_SCHEMA_VERSION,
  buildMirrorDashboardItem,
  buildMirrorDashboardPayload,
  buildMirrorDriftPayload,
  buildMirrorHedgeCheckPayload,
  buildReconciledMirrorLedger,
  buildMirrorReconciledPayload,
  buildMirrorPnlPayload,
  buildMirrorAuditPayload,
  loadMirrorDashboardContexts,
  loadAuditEntries,
  resolveMirrorSurfaceDaemonStatus,
  resolveMirrorSurfaceState,
};
