const DEFAULT_MINIMAX_BASE_URL = 'https://api.minimax.io/v1';
const DEFAULT_MINIMAX_MODEL = 'MiniMax-M2.7-highspeed';
const DEFAULT_MINIMAX_API_KEY_ENV = 'MINIMAX_API_KEY';

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
  return {
    apiKeyEnv,
    apiKey,
    baseUrl,
    model,
    timeoutMs,
    temperature,
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
  const startedAt = Date.now();
  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });
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
    elapsedMs,
    raw: payload,
  };
}

module.exports = {
  DEFAULT_MINIMAX_API_KEY_ENV,
  DEFAULT_MINIMAX_BASE_URL,
  DEFAULT_MINIMAX_MODEL,
  buildMinimaxRequest,
  callMinimaxChat,
  extractMessageText,
  extractReasoningText,
  resolveMinimaxConfig,
};
