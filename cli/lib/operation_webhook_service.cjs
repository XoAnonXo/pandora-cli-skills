const {
  hasWebhookTargets,
  sendWebhookNotifications,
} = require('./webhook_service.cjs');

const OPERATION_WEBHOOK_SCHEMA_VERSION = '1.0.0';

function normalizeNullableString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Array.isArray(value) ? value : Object.values(value)) {
    freezeDeep(entry);
  }
  return value;
}

function sanitizeOperationEventForWebhook(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }
  return freezeDeep({
    eventId: event.eventId || null,
    schemaVersion: event.schemaVersion || null,
    eventType: event.eventType || null,
    operationId: event.operationId || null,
    operationKind: event.operationKind || null,
    phase: event.phase || null,
    sequence: event.sequence || null,
    emittedAt: event.emittedAt || null,
    source: event.source || null,
    runtimeHandle: event.runtimeHandle || null,
    correlationId: event.correlationId || null,
    actor: event.actor || null,
    summary: event.summary || null,
    message: event.message || null,
    tags: event.tags && typeof event.tags === 'object' ? { ...event.tags } : {},
  });
}

function buildEmptyWebhookReport(now) {
  return freezeDeep({
    schemaVersion: OPERATION_WEBHOOK_SCHEMA_VERSION,
    generatedAt: now().toISOString(),
    count: 0,
    successCount: 0,
    failureCount: 0,
    results: [],
  });
}

function buildFailureWebhookReport(now, error) {
  const generatedAt = now().toISOString();
  return freezeDeep({
    schemaVersion: OPERATION_WEBHOOK_SCHEMA_VERSION,
    generatedAt,
    count: 1,
    successCount: 0,
    failureCount: 1,
    results: [
      {
        target: 'operation-webhook',
        ok: false,
        error: error && error.message ? String(error.message) : String(error),
      },
    ],
  });
}

function formatOperationLifecycleMessage(event, options = {}) {
  const prefix = normalizeNullableString(options.prefix) || 'Pandora Operation';
  const parts = [
    `[${prefix}]`,
    event.operationKind || 'operation',
    event.operationId,
    `phase=${event.phase}`,
    `sequence=${event.sequence}`,
  ];
  if (event.summary) {
    parts.push(`summary=${event.summary}`);
  }
  if (event.message) {
    parts.push(`message=${event.message}`);
  }
  return parts.join(' ');
}

function buildOperationWebhookContext(event, options = {}) {
  if (!event || typeof event !== 'object') {
    throw new TypeError('event must be an object.');
  }
  if (!event.operationId || !event.phase) {
    throw new TypeError('event must include operationId and phase.');
  }

  const sanitizedEvent = sanitizeOperationEventForWebhook(event);
  const generatedAt = (typeof options.now === 'function' ? options.now : () => new Date())().toISOString();
  const message = normalizeNullableString(options.message) || formatOperationLifecycleMessage(event, options);

  return freezeDeep({
    event: 'pandora.operation.lifecycle',
    schemaVersion: OPERATION_WEBHOOK_SCHEMA_VERSION,
    generatedAt,
    message,
    operationEvent: sanitizedEvent,
    operationId: event.operationId,
    operationKind: event.operationKind || null,
    phase: event.phase,
    sequence: event.sequence,
    runtimeHandle: event.runtimeHandle || null,
    source: event.source || 'local',
    summary: event.summary || null,
    metadata: options.metadata && typeof options.metadata === 'object' ? { ...options.metadata } : null,
  });
}

function createOperationWebhookService(deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now : () => new Date();
  const hasTargets = typeof deps.hasWebhookTargets === 'function' ? deps.hasWebhookTargets : hasWebhookTargets;
  const sendNotifications =
    typeof deps.sendWebhookNotifications === 'function'
      ? deps.sendWebhookNotifications
      : sendWebhookNotifications;

  async function notifyLifecycleEvent(options, event, contextOptions = {}) {
    const context = buildOperationWebhookContext(event, {
      ...contextOptions,
      now,
    });

    if (!hasTargets(options || {})) {
      return freezeDeep({
        schemaVersion: OPERATION_WEBHOOK_SCHEMA_VERSION,
        generatedAt: now().toISOString(),
        attempted: false,
        delivered: false,
        skippedReason: 'no-targets',
        eventId: event.eventId || null,
        operationId: event.operationId,
        phase: event.phase,
        context,
        report: buildEmptyWebhookReport(now),
        error: null,
      });
    }

    try {
      const report = await sendNotifications(options || {}, context);
      return freezeDeep({
        schemaVersion: OPERATION_WEBHOOK_SCHEMA_VERSION,
        generatedAt: now().toISOString(),
        attempted: true,
        delivered: Boolean(report && report.failureCount === 0),
        skippedReason: null,
        eventId: event.eventId || null,
        operationId: event.operationId,
        phase: event.phase,
        context,
        report: report || buildEmptyWebhookReport(now),
        error: null,
      });
    } catch (error) {
      const report = buildFailureWebhookReport(now, error);
      return freezeDeep({
        schemaVersion: OPERATION_WEBHOOK_SCHEMA_VERSION,
        generatedAt: now().toISOString(),
        attempted: true,
        delivered: false,
        skippedReason: null,
        eventId: event.eventId || null,
        operationId: event.operationId,
        phase: event.phase,
        context,
        report,
        error: freezeDeep({
          code: normalizeNullableString(error && error.code),
          message: error && error.message ? String(error.message) : String(error),
        }),
      });
    }
  }

  return {
    hasTargets: (options) => Boolean(hasTargets(options || {})),
    formatOperationLifecycleMessage,
    buildOperationWebhookContext: (event, options) =>
      buildOperationWebhookContext(event, { ...options, now }),
    notifyLifecycleEvent,
  };
}

module.exports = {
  OPERATION_WEBHOOK_SCHEMA_VERSION,
  buildOperationWebhookContext,
  createOperationWebhookService,
  formatOperationLifecycleMessage,
};
