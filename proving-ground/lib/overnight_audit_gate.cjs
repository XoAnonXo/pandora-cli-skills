const {
  extractJsonObjectFromText,
  normalizeText,
} = require('./baton_common.cjs');

const DEFAULT_OPENAI_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractOpenAiOutputText(response) {
  if (!response || typeof response !== 'object') {
    return '';
  }
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const output = Array.isArray(response.output) ? response.output : [];
  const parts = [];
  for (const item of output) {
    const content = Array.isArray(item && item.content) ? item.content : [];
    for (const entry of content) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      if (typeof entry.text === 'string' && entry.text.trim()) {
        parts.push(entry.text.trim());
      } else if (typeof entry.output_text === 'string' && entry.output_text.trim()) {
        parts.push(entry.output_text.trim());
      }
    }
  }
  return parts.join('\n').trim();
}

function extractAnthropicOutputText(response) {
  const content = Array.isArray(response && response.content) ? response.content : [];
  return content
    .filter((entry) => entry && entry.type === 'text' && typeof entry.text === 'string')
    .map((entry) => entry.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

async function postJson(url, payload, options = {}) {
  const fetchFn = typeof options.fetchFn === 'function' ? options.fetchFn : globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('Fetch is not available in this Node runtime.');
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 30_000);
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined,
    });
    const text = await response.text();
    const parsed = safeJsonParse(text);
    if (!response.ok) {
      const details = parsed || text;
      throw new Error(`Audit request failed with HTTP ${response.status}: ${JSON.stringify(details)}`);
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Audit response was not valid JSON.');
    }
    return parsed;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function resolveAuditProvider(config = {}, env = process.env) {
  const explicit = normalizeText(config.provider).toLowerCase() || 'auto';
  if (explicit === 'synthetic') {
    return 'synthetic';
  }
  if (explicit === 'openai' || explicit === 'anthropic' || explicit === 'none' || explicit === 'deferred') {
    return explicit;
  }
  if (normalizeText(env.OPENAI_API_KEY)) {
    return 'openai';
  }
  if (normalizeText(env.ANTHROPIC_API_KEY)) {
    return 'anthropic';
  }
  return 'none';
}

function buildAuditSystemPrompt() {
  return [
    'You are the independent overnight code audit gate.',
    'Return JSON only.',
    'You are not proposing new code.',
    'Only judge whether the attempted change should be accepted or rejected.',
    'Reject if the change violates invariants, weakens the proof, lacks test coverage for the claimed change, or is low-value churn.',
    'Accept only if the change is bounded, useful, validated, and consistent with the stated invariants.',
  ].join(' ');
}

function buildAuditUserPrompt(packet) {
  return JSON.stringify({
    packet,
    returnShape: {
      verdict: 'accept | reject',
      confidence: 0.75,
      blockers: ['concrete blockers'],
      evidence: ['concrete reasons'],
    },
  }, null, 2);
}

function parseAuditDecision(text) {
  const payload = JSON.parse(extractJsonObjectFromText(text, 'Audit response'));
  const verdict = normalizeText(payload.verdict).toLowerCase();
  if (!['accept', 'reject'].includes(verdict)) {
    throw new Error(`Invalid audit verdict: ${payload.verdict}`);
  }
  return {
    verdict,
    confidence: Number.isFinite(Number(payload.confidence)) ? Number(payload.confidence) : 0,
    blockers: Array.isArray(payload.blockers)
      ? payload.blockers.map((entry) => normalizeText(entry)).filter(Boolean)
      : [],
    evidence: Array.isArray(payload.evidence)
      ? payload.evidence.map((entry) => normalizeText(entry)).filter(Boolean)
      : [],
  };
}

async function reviewWithOpenAi(packet, config = {}, options = {}) {
  const apiKey = normalizeText(config.apiKey || process.env[normalizeText(config.apiKeyEnv) || 'OPENAI_API_KEY']);
  if (!apiKey) {
    return {
      verdict: 'reject',
      confidence: 1,
      blockers: ['OpenAI audit gate is not configured.'],
      evidence: [],
      provider: 'openai',
      model: normalizeText(config.model) || 'gpt-5',
    };
  }
  const payload = {
    model: normalizeText(config.model) || 'gpt-5',
    input: [
      { role: 'system', content: buildAuditSystemPrompt() },
      { role: 'user', content: buildAuditUserPrompt(packet) },
    ],
    max_output_tokens: Number(config.maxOutputTokens) || 1200,
    text: {
      format: {
        type: 'json_object',
      },
    },
  };
  const response = await postJson(normalizeText(config.baseUrl) || DEFAULT_OPENAI_URL, payload, {
    timeoutMs: config.timeoutMs,
    fetchFn: options.fetchFn,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  return {
    ...parseAuditDecision(extractOpenAiOutputText(response)),
    provider: 'openai',
    model: normalizeText(response.model) || normalizeText(config.model) || 'gpt-5',
  };
}

async function reviewWithAnthropic(packet, config = {}, options = {}) {
  const apiKey = normalizeText(config.apiKey || process.env[normalizeText(config.apiKeyEnv) || 'ANTHROPIC_API_KEY']);
  if (!apiKey) {
    return {
      verdict: 'reject',
      confidence: 1,
      blockers: ['Anthropic audit gate is not configured.'],
      evidence: [],
      provider: 'anthropic',
      model: normalizeText(config.model) || 'claude-sonnet-4-20250514',
    };
  }
  const payload = {
    model: normalizeText(config.model) || 'claude-sonnet-4-20250514',
    max_tokens: Number(config.maxTokens) || 1200,
    system: buildAuditSystemPrompt(),
    messages: [
      {
        role: 'user',
        content: buildAuditUserPrompt(packet),
      },
    ],
  };
  const response = await postJson(normalizeText(config.baseUrl) || DEFAULT_ANTHROPIC_URL, payload, {
    timeoutMs: config.timeoutMs,
    fetchFn: options.fetchFn,
    headers: {
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    },
  });
  return {
    ...parseAuditDecision(extractAnthropicOutputText(response)),
    provider: 'anthropic',
    model: normalizeText(response.model) || normalizeText(config.model) || 'claude-sonnet-4-20250514',
  };
}

async function runAuditGate(options = {}) {
  const packet = options.packet || {};
  if (options.syntheticDecision) {
    return {
      ...options.syntheticDecision,
      provider: 'synthetic',
      model: 'synthetic-audit-gate',
    };
  }
  if (typeof options.reviewLoader === 'function') {
    return options.reviewLoader(options);
  }
  const provider = resolveAuditProvider(options.config, options.env);
  if (provider === 'none') {
    return {
      verdict: 'reject',
      confidence: 1,
      blockers: ['No heterogeneous audit provider is configured.'],
      evidence: [],
      provider: 'none',
      model: null,
    };
  }
  if (provider === 'deferred') {
    return {
      verdict: 'deferred',
      confidence: 1,
      blockers: ['Deferred to Codex review.'],
      evidence: ['Local validation passed and this attempt is waiting for a live Codex audit.'],
      provider: 'deferred',
      model: null,
    };
  }
  if (provider === 'openai') {
    return reviewWithOpenAi(packet, options.config, options);
  }
  if (provider === 'anthropic') {
    return reviewWithAnthropic(packet, options.config, options);
  }
  throw new Error(`Unsupported audit provider: ${provider}`);
}

module.exports = {
  buildAuditSystemPrompt,
  buildAuditUserPrompt,
  parseAuditDecision,
  resolveAuditProvider,
  runAuditGate,
};
