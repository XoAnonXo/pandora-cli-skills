const path = require('path');
const { createState, loadState: loadMirrorState } = require('./mirror_state_store.cjs');
const { loadAuditEntries } = require('./mirror_audit_store.cjs');
const { daemonStatus, findPidFilesByMarketAddress } = require('./mirror_daemon_service.cjs');
const { round, toOptionalNumber } = require('./shared/utils.cjs');

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
    const pidFiles = findPidFilesByMarketAddress(marketAddress);
    if (!pidFiles.length) return null;
    const selected = pidFiles[pidFiles.length - 1];
    const resolved = daemonStatus({ pidFile: selected });
    if (pidFiles.length > 1 && resolved && resolved.metadata) {
      resolved.metadata.ambiguousPidFiles = pidFiles;
    }
    return resolved;
  } catch {
    return null;
  }
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
  MIRROR_PNL_SCHEMA_VERSION,
  MIRROR_AUDIT_SCHEMA_VERSION,
  buildMirrorPnlPayload,
  buildMirrorAuditPayload,
  loadAuditEntries,
  resolveMirrorSurfaceDaemonStatus,
  resolveMirrorSurfaceState,
};
