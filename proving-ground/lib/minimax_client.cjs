const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_MINIMAX_BASE_URL = 'https://api.minimax.io/v1';
const DEFAULT_MINIMAX_MODEL = 'MiniMax-M2.7-highspeed';
const DEFAULT_MINIMAX_API_KEY_ENV = 'MINIMAX_API_KEY';
const DEFAULT_MINIMAX_MIN_INTERVAL_MS = 1000;
const DEFAULT_MINIMAX_RATE_LIMIT_DIR = path.join(os.tmpdir(), 'codex-minimax-rate-limit');
const DEFAULT_MINIMAX_RATE_LIMIT_POLL_MS = 50;
const DEFAULT_MINIMAX_RATE_LIMIT_LOCK_TIMEOUT_MS = 30000;

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

function stableScopeHash(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex');
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonAtomic(filePath, payload) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
  return filePath;
}

function buildRateLimitScope(config) {
  if (normalizeText(config.rateLimitScope)) {
    return normalizeText(config.rateLimitScope);
  }
  return stableScopeHash(`${config.baseUrl}|${config.apiKey}`);
}

async function withRateLimitLock(lockPath, fn, options = {}) {
  const pollMs = Math.max(10, normalizeNumber(options.pollMs, DEFAULT_MINIMAX_RATE_LIMIT_POLL_MS));
  const lockTimeoutMs = Math.max(1000, normalizeNumber(options.lockTimeoutMs, DEFAULT_MINIMAX_RATE_LIMIT_LOCK_TIMEOUT_MS));
  const startedAt = Date.now();
  ensureDir(path.dirname(lockPath));
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      break;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') {
        throw error;
      }
      try {
        const stats = fs.statSync(lockPath);
        if ((Date.now() - stats.mtimeMs) >= lockTimeoutMs) {
          fs.rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        // Another caller likely removed the lock between stat attempts.
      }
      if ((Date.now() - startedAt) >= lockTimeoutMs) {
        throw new Error(`Timed out waiting for MiniMax rate-limit lock: ${lockPath}`);
      }
      await sleep(pollMs);
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

function buildRateLimitPaths(config) {
  const scope = buildRateLimitScope(config);
  const rootDir = path.resolve(normalizeText(config.rateLimitStateDir) || DEFAULT_MINIMAX_RATE_LIMIT_DIR);
  return {
    rootDir,
    scope,
    statePath: path.join(rootDir, `${scope}.json`),
    lockPath: path.join(rootDir, `${scope}.lock`),
  };
}

async function reserveRateLimitSlot(config) {
  const minIntervalMs = Math.max(0, normalizeNumber(config.minIntervalMs, DEFAULT_MINIMAX_MIN_INTERVAL_MS));
  if (minIntervalMs === 0) {
    return {
      delayMs: 0,
      reservedAt: Date.now(),
      scope: buildRateLimitScope(config),
    };
  }
  const paths = buildRateLimitPaths(config);
  const reservation = await withRateLimitLock(paths.lockPath, async () => {
    const now = Date.now();
    const current = readJsonIfExists(paths.statePath);
    const nextAllowedAt = Number(current && current.nextAllowedAt) || 0;
    const reservedAt = Math.max(now, nextAllowedAt);
    writeJsonAtomic(paths.statePath, {
      scope: paths.scope,
      nextAllowedAt: reservedAt + minIntervalMs,
      updatedAt: new Date(now).toISOString(),
      pid: process.pid,
    });
    return {
      reservedAt,
      delayMs: Math.max(0, reservedAt - now),
      scope: paths.scope,
    };
  }, {
    pollMs: config.rateLimitPollMs,
    lockTimeoutMs: config.rateLimitLockTimeoutMs,
  });
  if (reservation.delayMs > 0) {
    await sleep(reservation.delayMs);
  }
  return reservation;
}

function resolveMinimaxConfig(overrides = {}, env = process.env) {
  const apiKeyEnv = normalizeText(overrides.apiKeyEnv) || DEFAULT_MINIMAX_API_KEY_ENV;
  const baseUrl = stripTrailingSlash(
    normalizeText(overrides.baseUrl)
    || normalizeText(env.MINIMAX_BASE_URL)
    || DEFAULT_MINIMAX_BASE_URL,
  );
  const model = normalizeText(overrides.model) || normalizeText(env.MINIMAX_MODEL) || DEFAULT_MINIMAX_MODEL;
  const apiKey = normalizeText(overrides.apiKey) || normalizeText(env[apiKeyEnv]);
  const timeoutMs = Math.max(1000, normalizeNumber(overrides.timeoutMs, 120000));
  const temperature = normalizeNumber(overrides.temperature, 1);
  const minIntervalMs = Math.max(
    0,
    normalizeNumber(
      overrides.minIntervalMs ?? overrides.min_interval_ms ?? env.MINIMAX_MIN_INTERVAL_MS,
      DEFAULT_MINIMAX_MIN_INTERVAL_MS,
    ),
  );
  return {
    apiKeyEnv,
    apiKey,
    baseUrl,
    model,
    timeoutMs,
    temperature,
    minIntervalMs,
    rateLimitScope: normalizeText(overrides.rateLimitScope || overrides.rate_limit_scope || env.MINIMAX_RATE_LIMIT_SCOPE),
    rateLimitStateDir: normalizeText(overrides.rateLimitStateDir || overrides.rate_limit_state_dir || env.MINIMAX_RATE_LIMIT_STATE_DIR)
      || DEFAULT_MINIMAX_RATE_LIMIT_DIR,
    rateLimitPollMs: Math.max(
      10,
      normalizeNumber(
        overrides.rateLimitPollMs ?? overrides.rate_limit_poll_ms ?? env.MINIMAX_RATE_LIMIT_POLL_MS,
        DEFAULT_MINIMAX_RATE_LIMIT_POLL_MS,
      ),
    ),
    rateLimitLockTimeoutMs: Math.max(
      1000,
      normalizeNumber(
        overrides.rateLimitLockTimeoutMs ?? overrides.rate_limit_lock_timeout_ms ?? env.MINIMAX_RATE_LIMIT_LOCK_TIMEOUT_MS,
        DEFAULT_MINIMAX_RATE_LIMIT_LOCK_TIMEOUT_MS,
      ),
    ),
    reasoningSplit: overrides.reasoningSplit !== false,
  };
}

function normalizeMessages(options = {}) {
  if (Array.isArray(options.messages) && options.messages.length > 0) {
    return options.messages.map((message) => ({
      role: normalizeText(message.role) || 'user',
      content: message.content,
    }));
  }
  const messages = [];
  if (normalizeText(options.systemPrompt)) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  if (normalizeText(options.userPrompt)) {
    messages.push({ role: 'user', content: options.userPrompt });
  }
  return messages;
}

function buildMinimaxRequest(options = {}) {
  const config = resolveMinimaxConfig(options, options.env);
  const messages = normalizeMessages(options);
  if (messages.length === 0) {
    throw new Error('MiniMax request must include messages or systemPrompt/userPrompt');
  }
  const request = {
    model: config.model,
    messages,
    temperature: config.temperature,
  };
  const maxCompletionTokens = normalizeNumber(options.maxCompletionTokens, null);
  if (Number.isFinite(maxCompletionTokens) && maxCompletionTokens > 0) {
    request.max_completion_tokens = Math.round(maxCompletionTokens);
  }
  if (config.reasoningSplit) {
    request.extra_body = { reasoning_split: true };
  }
  return request;
}

function extractMessageText(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((item) => {
      if (typeof item === 'string') {
        return item;
      }
      if (item && typeof item.text === 'string') {
        return item.text;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractReasoningText(reasoningDetails) {
  if (!Array.isArray(reasoningDetails)) {
    return '';
  }
  return reasoningDetails
    .map((detail) => (detail && typeof detail.text === 'string' ? detail.text : ''))
    .filter(Boolean)
    .join('\n');
}

async function callMinimaxChat(options = {}) {
  const config = resolveMinimaxConfig(options, options.env);
  if (!config.apiKey) {
    throw new Error(`MiniMax API key not found. Set ${config.apiKeyEnv} before running the proving ground.`);
  }
  if (typeof options.fetchImpl !== 'function' && typeof globalThis.fetch !== 'function') {
    throw new Error('Fetch is not available in this Node runtime.');
  }

  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch;
  const requestBody = buildMinimaxRequest({ ...options, env: options.env });
  const queuedAt = Date.now();
  const rateLimit = await reserveRateLimitSlot(config);
  const startedAt = Date.now();
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), config.timeoutMs)
    : null;
  let response;
  try {
    response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller ? controller.signal : undefined,
    });
  } catch (error) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (error && error.name === 'AbortError') {
      throw new Error(`MiniMax request timed out after ${config.timeoutMs}ms`);
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
  const elapsedMs = Date.now() - startedAt;

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`MiniMax returned a non-JSON response (${response.status}): ${error.message}`);
  }

  if (!response.ok) {
    const message = normalizeText(payload && payload.error && payload.error.message)
      || normalizeText(payload && payload.message)
      || `HTTP ${response.status}`;
    throw new Error(`MiniMax request failed: ${message}`);
  }

  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  const message = choice && choice.message ? choice.message : {};
  return {
    provider: 'minimax',
    model: normalizeText(payload.model) || config.model,
    text: extractMessageText(message.content),
    reasoning: extractReasoningText(message.reasoning_details),
    finishReason: normalizeText(choice && choice.finish_reason) || null,
    usage: payload && payload.usage ? payload.usage : {},
    elapsedMs: Date.now() - queuedAt,
    requestElapsedMs: elapsedMs,
    queuedMs: Math.max(0, startedAt - queuedAt),
    rateLimitScope: rateLimit.scope,
    raw: payload,
  };
}

module.exports = {
  DEFAULT_MINIMAX_API_KEY_ENV,
  DEFAULT_MINIMAX_BASE_URL,
  DEFAULT_MINIMAX_MODEL,
  DEFAULT_MINIMAX_MIN_INTERVAL_MS,
  buildRateLimitPaths,
  buildMinimaxRequest,
  callMinimaxChat,
  extractMessageText,
  extractReasoningText,
  reserveRateLimitSlot,
  resolveMinimaxConfig,
};
