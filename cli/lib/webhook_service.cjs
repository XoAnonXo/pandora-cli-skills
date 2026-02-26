const crypto = require('crypto');

const WEBHOOK_SCHEMA_VERSION = '1.0.0';

function hasWebhookTargets(options) {
  return Boolean(
    (options && options.webhookUrl) ||
      (options && options.telegramBotToken && options.telegramChatId) ||
      (options && options.discordWebhookUrl),
  );
}

function renderTemplate(template, context) {
  if (!template) return null;
  return String(template).replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, key) => {
    const parts = key.split('.');
    let value = context;
    for (const part of parts) {
      if (!value || typeof value !== 'object' || !(part in value)) {
        value = '';
        break;
      }
      value = value[part];
    }
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
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

async function sendJson(url, body, options) {
  const timeoutMs = Number.isInteger(options.webhookTimeoutMs) && options.webhookTimeoutMs > 0 ? options.webhookTimeoutMs : 5_000;
  const retries = Number.isInteger(options.webhookRetries) && options.webhookRetries >= 0 ? options.webhookRetries : 3;

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const serialized = JSON.stringify(body);
      const headers = { 'content-type': 'application/json' };
      if (options.webhookSecret) {
        const signature = crypto.createHmac('sha256', options.webhookSecret).update(serialized).digest('hex');
        headers['x-pandora-signature'] = signature;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: serialized,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return { ok: true, attempt: attempt + 1 };
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (attempt >= retries) {
        return {
          ok: false,
          attempt: attempt + 1,
          error: err && err.message ? err.message : String(err),
        };
      }

      const sleep = Math.min(5_000, 200 * 2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, sleep));
    }
  }

  return {
    ok: false,
    attempt: retries + 1,
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
    results,
  };
}

module.exports = {
  WEBHOOK_SCHEMA_VERSION,
  hasWebhookTargets,
  sendWebhookNotifications,
};
