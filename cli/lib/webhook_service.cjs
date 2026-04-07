const crypto = require('crypto');

const WEBHOOK_SCHEMA_VERSION = '1.0.0';
const DEFAULT_WEBHOOK_TIMEOUT_MS = 5_000;
const DEFAULT_WEBHOOK_RETRIES = 3;

function coalesceStr(value, ifEmpty) {
  const text = typeof value === 'string' ? value.trim() : String(value || '').trim();
  return text || ifEmpty;
}

function normalizeOptionalString(value) {
  return coalesceStr(value, null);
}

function hasWebhookTargets(options) {
  return !!(options?.webhookUrl || (options?.telegramBotToken && options?.telegramChatId) || options?.discordWebhookUrl);
}

function renderTemplate(template, context) {
  if (!template) return null;
  return String(template).replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, key) => {
    const parts = key.split('.');
    let value = context;
    for (const part of parts) {
      if (!value || typeof value !== 'object' || !(part in value)) {
        return '';
      }
      value = value[part];
    }
    return coalesceStr(value, '');
  });
}

function buildGenericBody(options, context) {
  if (options.webhookTemplate) {
    const rendered = renderTemplate(options.webhookTemplate, context);
    try {
      return JSON.parse(rendered);
    } catch {
      return { message: rendered };
    }
  }
  return {
    event: context.event || 'pandora.alert',
    generatedAt: new Date().toISOString(),
    payload: context,
  };
}

function buildTelegramRequest(options, context) {
  const text = context.message || context.alertMessage || 'Pandora alert';
  return {
    url: `https://api.telegram.org/bot${options.telegramBotToken}/sendMessage`,
    body: {
      chat_id: options.telegramChatId,
      text,
      parse_mode: 'Markdown',
    },
  };
}

function buildDiscordRequest(options, context) {
  const text = context.message || context.alertMessage || 'Pandora alert';
  return {
    url: options.discordWebhookUrl,
    body: {
      content: text,
      username: 'Pandora CLI',
    },
  };
}

const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429]);

function isRetryableWebhookFailure(error, statusCode) {
  if (Number.isInteger(statusCode)) {
    return RETRYABLE_STATUS_CODES.has(statusCode) || statusCode >= 500;
  }
  if (error && error.name === 'AbortError') return true;
  if (error && error.code === 'ERR_INVALID_URL') return false;
  return true;
}

function computeWebhookBackoffMs(attemptIndex) {
  return Math.min(5_000, 200 * 2 ** attemptIndex);
}

function getNestedString(obj, ...keys) {
  let current = obj;
  for (const key of keys) {
    if (!current || typeof current !== 'object') return null;
    current = current[key];
  }
  return normalizeOptionalString(current);
}

function extractWebhookContextHeaders(context = {}) {
  const eventName = getNestedString(context, 'event')
    || getNestedString(context, 'payload', 'event')
    || 'pandora.alert';
  const correlationId = getNestedString(context, 'operationEvent', 'correlationId')
    || getNestedString(context, 'payload', 'operationEvent', 'correlationId')
    || getNestedString(context, 'correlationId')
    || getNestedString(context, 'payload', 'correlationId')
    || getNestedString(context, 'requestId');
  const generatedAt = normalizeOptionalString(context.generatedAt) || new Date().toISOString();
  return {
    eventName,
    correlationId,
    generatedAt,
  };
}

async function sendJson(url, body, options) {
  const timeoutMs = Number.isInteger(options.webhookTimeoutMs) && options.webhookTimeoutMs > 0 ? options.webhookTimeoutMs : DEFAULT_WEBHOOK_TIMEOUT_MS;
  const retries = Number.isInteger(options.webhookRetries) && options.webhookRetries >= 0 ? options.webhookRetries : DEFAULT_WEBHOOK_RETRIES;
  const maxAttempts = retries + 1;
  const deliveryId = normalizeOptionalString(options.webhookDeliveryId) || `wh_${crypto.randomUUID()}`;
  const attempts = [];

  // Extract context headers once; they don't change across retry attempts
  const { eventName, correlationId, generatedAt } = extractWebhookContextHeaders(body);

  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedMs = Date.now();
    const attemptRecord = {
      attempt: attempt + 1,
      startedAt: new Date(startedMs).toISOString(),
      ok: false,
      statusCode: null,
      retryable: false,
      durationMs: null,
      error: null,
      nextBackoffMs: null,
    };

    try {
      const serialized = JSON.stringify(body);
      const headers = {
        'content-type': 'application/json',
        'x-pandora-delivery-id': deliveryId,
        'x-pandora-generated-at': generatedAt,
        'x-pandora-event': eventName,
        'x-pandora-attempt': String(attempt + 1),
      };
      if (correlationId) {
        headers['x-pandora-correlation-id'] = correlationId;
      }
      if (options.webhookSecret) {
        const signature = crypto.createHmac('sha256', options.webhookSecret).update(serialized).digest('hex');
        headers['x-pandora-signature'] = signature;
        headers['x-pandora-signature-sha256'] = signature;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: serialized,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      attemptRecord.durationMs = Date.now() - startedMs;
      attemptRecord.statusCode = response.status;

      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.statusCode = response.status;
        throw error;
      }

      attemptRecord.ok = true;
      attempts.push(attemptRecord);
      return {
        ok: true,
        attempt: attempt + 1,
        maxAttempts,
        deliveryId,
        attempts,
        timeoutMs,
        signed: Boolean(options.webhookSecret),
        terminalState: 'delivered',
      };
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      const statusCode = Number.isInteger(err && err.statusCode) ? err.statusCode : null;
      attemptRecord.durationMs = Date.now() - startedMs;
      attemptRecord.statusCode = statusCode;
      attemptRecord.retryable = isRetryableWebhookFailure(err, statusCode);
      attemptRecord.error = err && err.message ? err.message : String(err);
      attempts.push(attemptRecord);
      if (attempt >= retries || !attemptRecord.retryable) {
        return {
          ok: false,
          attempt: attempt + 1,
          maxAttempts,
          deliveryId,
          attempts,
          timeoutMs,
          signed: Boolean(options.webhookSecret),
          statusCode,
          retryable: attemptRecord.retryable,
          terminalState: attemptRecord.retryable ? 'failed_retry_exhausted' : 'failed_permanent',
          error: attemptRecord.error,
        };
      }

      const sleep = computeWebhookBackoffMs(attempt);
      attemptRecord.nextBackoffMs = sleep;
      await new Promise((resolve) => setTimeout(resolve, sleep));
    }
  }

  return {
    ok: false,
    attempt: maxAttempts,
    maxAttempts,
    deliveryId,
    attempts,
    timeoutMs,
    signed: Boolean(options.webhookSecret),
    terminalState: 'failed_retry_exhausted',
    error: lastError && lastError.message ? lastError.message : 'unknown error',
  };
}

async function sendWebhookNotifications(options, context) {
  const results = [];

  if (options.webhookUrl) {
    const genericBody = buildGenericBody(options, context);
    const response = await sendJson(options.webhookUrl, genericBody, options);
    results.push({ target: 'generic', url: options.webhookUrl, ...response });
  }

  if (options.telegramBotToken && options.telegramChatId) {
    const req = buildTelegramRequest(options, context);
    const response = await sendJson(req.url, req.body, options);
    results.push({ target: 'telegram', url: req.url, ...response });
  }

  if (options.discordWebhookUrl) {
    const req = buildDiscordRequest(options, context);
    const response = await sendJson(req.url, req.body, options);
    results.push({ target: 'discord', url: req.url, ...response });
  }

  return {
    schemaVersion: WEBHOOK_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    count: results.length,
    successCount: results.filter((item) => item.ok).length,
    failureCount: results.filter((item) => !item.ok).length,
    permanentFailureCount: results.filter((item) => item.terminalState === 'failed_permanent').length,
    retryExhaustedCount: results.filter((item) => item.terminalState === 'failed_retry_exhausted').length,
    results,
  };
}

module.exports = {
  WEBHOOK_SCHEMA_VERSION,
  hasWebhookTargets,
  sendWebhookNotifications,
};
