const { round } = require('./shared/utils.cjs');

const ARB_ADJUDICATION_SCHEMA_VERSION = '1.0.0';
const DEFAULT_ARB_AI_PROVIDER = 'auto';
const DEFAULT_ARB_AI_TIMEOUT_MS = 6_000;
const DEFAULT_ARB_AI_CONFIDENCE_THRESHOLD = 0.8;
const DEFAULT_ARB_AI_MAX_CANDIDATES = 12;
const DEFAULT_OPENAI_MODEL = 'gpt-5';
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

class ArbAdjudicationProviderError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ArbAdjudicationProviderError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

function normalizeArbAiProvider(value) {
  const normalized = String(value || DEFAULT_ARB_AI_PROVIDER).trim().toLowerCase();
  if (['auto', 'anthropic', 'mock', 'none', 'openai'].includes(normalized)) {
    return normalized;
  }
  return null;
}

function resolveArbAiProvider(options = {}) {
  const explicit = normalizeArbAiProvider(options.aiProvider);
  const envConfigured = normalizeArbAiProvider(process.env.PANDORA_ARB_AI_PROVIDER);
  const provider = explicit || envConfigured || DEFAULT_ARB_AI_PROVIDER;

  if (provider !== 'auto') return provider;
  if (String(process.env.OPENAI_API_KEY || '').trim()) return 'openai';
  if (String(process.env.ANTHROPIC_API_KEY || '').trim()) return 'anthropic';
  if (String(process.env.PANDORA_ARB_AI_MOCK_RESPONSE || '').trim()) return 'mock';
  return 'none';
}

function resolveArbAiModel(provider, options = {}) {
  const explicit = String(options.aiModel || '').trim();
  if (explicit) return explicit;

  const sharedEnv = String(process.env.PANDORA_ARB_AI_MODEL || '').trim();
  if (sharedEnv) return sharedEnv;

  if (provider === 'openai') {
    return String(process.env.OPENAI_MODEL || '').trim() || DEFAULT_OPENAI_MODEL;
  }
  if (provider === 'anthropic') {
    return String(process.env.ANTHROPIC_MODEL || '').trim() || DEFAULT_ANTHROPIC_MODEL;
  }
  if (provider === 'mock') {
    return 'mock-v1';
  }
  return null;
}

function resolveArbAiTimeoutMs(options = {}) {
  const explicit = Number(options.aiTimeoutMs);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  const envValue = Number(process.env.PANDORA_ARB_AI_TIMEOUT_MS);
  if (Number.isInteger(envValue) && envValue > 0) return envValue;
  return DEFAULT_ARB_AI_TIMEOUT_MS;
}

function resolveArbAiConfidenceThreshold(options = {}) {
  const explicit = Number(options.aiThreshold);
  if (Number.isFinite(explicit) && explicit >= 0 && explicit <= 1) return explicit;
  const envValue = Number(process.env.PANDORA_ARB_AI_THRESHOLD);
  if (Number.isFinite(envValue) && envValue >= 0 && envValue <= 1) return envValue;
  return DEFAULT_ARB_AI_CONFIDENCE_THRESHOLD;
}

function resolveArbAiMaxCandidates(options = {}) {
  const explicit = Number(options.aiMaxCandidates);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  const envValue = Number(process.env.PANDORA_ARB_AI_MAX_CANDIDATES);
  if (Number.isInteger(envValue) && envValue > 0) return envValue;
  return DEFAULT_ARB_AI_MAX_CANDIDATES;
}

function normalizeConfidence(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric > 1) return round(Math.max(0, Math.min(1, numeric / 100)), 6);
  return round(Math.max(0, Math.min(1, numeric)), 6);
}

function normalizeBlockers(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean))).sort();
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function unwrapJsonText(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch && fencedMatch[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }

  return text;
}

function safeStructuredParse(value) {
  const direct = safeJsonParse(value);
  if (direct && typeof direct === 'object') {
    return direct;
  }
  const unwrapped = unwrapJsonText(value);
  if (unwrapped && unwrapped !== value) {
    return safeJsonParse(unwrapped);
  }
  return null;
}

function buildArbAdjudicationPrompt(input = {}) {
  const payload = {
    left: {
      question: input.leftQuestion || '',
      rules: input.leftRules || '',
      venue: input.leftVenue || null,
      marketId: input.leftMarketId || null,
      signature: input.leftSignature || null,
    },
    right: {
      question: input.rightQuestion || '',
      rules: input.rightRules || '',
      venue: input.rightVenue || null,
      marketId: input.rightMarketId || null,
      signature: input.rightSignature || null,
    },
    deterministicMatch: {
      similarityScore: input.similarityScore,
      semanticScore: input.semanticScore,
      heuristicAccepted: Boolean(input.heuristicAccepted),
      semanticWarnings: Array.isArray(input.semanticWarnings) ? input.semanticWarnings : [],
      sharedSubjects: Array.isArray(input.sharedSubjects) ? input.sharedSubjects : [],
      sharedPredicateFamilies: Array.isArray(input.sharedPredicateFamilies) ? input.sharedPredicateFamilies : [],
      sharedYears: Array.isArray(input.sharedYears) ? input.sharedYears : [],
    },
  };

  return [
    'You are a strict prediction-market equivalence adjudicator.',
    'Decide whether two markets refer to the same underlying YES/NO event and can safely be grouped for arbitrage.',
    'Reject pairs that differ on subject entity, market type, resolution condition, threshold, asset, team, player, timeframe, or outcome semantics.',
    'Be conservative. If the pair is ambiguous, return equivalent=false.',
    'Return JSON only with this exact shape:',
    '{"equivalent":boolean,"confidence":0-1,"reason":"short explanation","blockers":["..."],"topic":"short label","marketType":"short label"}',
    'Input:',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

function extractOpenAiOutputText(response) {
  if (!response || typeof response !== 'object') return '';
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const output = Array.isArray(response.output) ? response.output : [];
  const parts = [];
  for (const item of output) {
    const content = Array.isArray(item && item.content) ? item.content : [];
    for (const entry of content) {
      if (!entry || typeof entry !== 'object') continue;
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
  const parts = [];
  for (const entry of content) {
    if (entry && entry.type === 'text' && typeof entry.text === 'string' && entry.text.trim()) {
      parts.push(entry.text.trim());
    }
  }
  return parts.join('\n').trim();
}

async function postJson(url, payload, options = {}) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutMs = resolveArbAiTimeoutMs(options);
  const fetchFn = typeof options.fetchFn === 'function' ? options.fetchFn : fetch;
  const headers = options.headers || {};
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined,
    });

    const text = await response.text();
    const parsed = safeJsonParse(text);
    if (!response.ok) {
      throw new ArbAdjudicationProviderError(
        'ARB_AI_HTTP_ERROR',
        `AI adjudication request failed with HTTP ${response.status}.`,
        {
          responseBody: parsed || text,
          status: response.status,
          url,
        },
      );
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new ArbAdjudicationProviderError('ARB_AI_INVALID_RESPONSE', 'AI adjudication response was not valid JSON.', {
        responseText: text,
        url,
      });
    }
    return parsed;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new ArbAdjudicationProviderError('ARB_AI_TIMEOUT', `AI adjudication timed out after ${timeoutMs}ms.`, {
        timeoutMs,
        url,
      });
    }
    if (err instanceof ArbAdjudicationProviderError) throw err;
    throw new ArbAdjudicationProviderError('ARB_AI_REQUEST_FAILED', err && err.message ? err.message : String(err), {
      url,
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function normalizeAdjudicationResult(result, meta = {}) {
  const output = result && typeof result === 'object' ? result : {};
  const normalized = {
    schemaVersion: ARB_ADJUDICATION_SCHEMA_VERSION,
    provider: meta.provider || null,
    model: meta.model || null,
    equivalent: Boolean(output.equivalent),
    confidence: normalizeConfidence(output.confidence, 0),
    reason: String(output.reason || '').trim() || 'No adjudication rationale returned.',
    blockers: normalizeBlockers(output.blockers),
    topic: String(output.topic || '').trim() || null,
    marketType: String(output.marketType || '').trim() || null,
  };
  return normalized;
}

function resolveMockResponse(options = {}) {
  if (options.mockResponse && typeof options.mockResponse === 'object') {
    return options.mockResponse;
  }
  const raw = process.env.PANDORA_ARB_AI_MOCK_RESPONSE;
  if (!raw) return null;
  const parsed = safeJsonParse(raw);
  if (Array.isArray(parsed)) {
    return parsed[0] || null;
  }
  return parsed;
}

async function adjudicateWithMock(input, options = {}) {
  const configured = resolveMockResponse(options);
  if (configured && typeof configured === 'object') {
    return normalizeAdjudicationResult(configured, {
      provider: 'mock',
      model: resolveArbAiModel('mock', options),
    });
  }

  return normalizeAdjudicationResult(
    {
      equivalent: Boolean(input.heuristicAccepted && (!Array.isArray(input.semanticWarnings) || !input.semanticWarnings.length)),
      confidence: input.heuristicAccepted ? 0.75 : 0.35,
      reason: 'Mock adjudicator fell back to deterministic hybrid scoring.',
      blockers: input.semanticWarnings || [],
      topic: input.leftSignature && input.leftSignature.topic,
      marketType: input.leftSignature && input.leftSignature.marketType,
    },
    {
      provider: 'mock',
      model: resolveArbAiModel('mock', options),
    },
  );
}

async function adjudicateWithOpenAi(input, options = {}) {
  const apiKey = String(options.apiKey || process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new ArbAdjudicationProviderError('ARB_AI_AUTH_MISSING', 'OPENAI_API_KEY is required for OpenAI adjudication.');
  }
  const model = resolveArbAiModel('openai', options);
  const prompt = buildArbAdjudicationPrompt(input);
  const response = await postJson(
    OPENAI_RESPONSES_URL,
    {
      model,
      input: prompt,
      instructions: 'Return JSON only.',
      max_output_tokens: 300,
      text: {
        format: {
          type: 'json_object',
        },
      },
    },
    {
      ...options,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );
  const parsed = safeStructuredParse(extractOpenAiOutputText(response));
  if (!parsed || typeof parsed !== 'object') {
    throw new ArbAdjudicationProviderError('ARB_AI_INVALID_RESPONSE', 'OpenAI adjudication did not return valid JSON.', {
      response,
    });
  }
  return normalizeAdjudicationResult(parsed, {
    provider: 'openai',
    model,
  });
}

async function adjudicateWithAnthropic(input, options = {}) {
  const apiKey = String(options.apiKey || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    throw new ArbAdjudicationProviderError('ARB_AI_AUTH_MISSING', 'ANTHROPIC_API_KEY is required for Anthropic adjudication.');
  }
  const model = resolveArbAiModel('anthropic', options);
  const prompt = buildArbAdjudicationPrompt(input);
  const response = await postJson(
    ANTHROPIC_MESSAGES_URL,
    {
      model,
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    },
    {
      ...options,
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
      },
    },
  );
  const parsed = safeStructuredParse(extractAnthropicOutputText(response));
  if (!parsed || typeof parsed !== 'object') {
    throw new ArbAdjudicationProviderError('ARB_AI_INVALID_RESPONSE', 'Anthropic adjudication did not return valid JSON.', {
      response,
    });
  }
  return normalizeAdjudicationResult(parsed, {
    provider: 'anthropic',
    model,
  });
}

async function adjudicateArbitragePair(input, options = {}) {
  const provider = resolveArbAiProvider(options);
  if (provider === 'none') {
    return null;
  }
  if (provider === 'mock') {
    return adjudicateWithMock(input, options);
  }
  if (provider === 'openai') {
    return adjudicateWithOpenAi(input, options);
  }
  if (provider === 'anthropic') {
    return adjudicateWithAnthropic(input, options);
  }
  throw new ArbAdjudicationProviderError('ARB_AI_PROVIDER_UNSUPPORTED', `Unsupported AI adjudication provider: ${provider}`);
}

module.exports = {
  ARB_ADJUDICATION_SCHEMA_VERSION,
  ArbAdjudicationProviderError,
  DEFAULT_ARB_AI_PROVIDER,
  DEFAULT_ARB_AI_CONFIDENCE_THRESHOLD,
  DEFAULT_ARB_AI_MAX_CANDIDATES,
  DEFAULT_ARB_AI_TIMEOUT_MS,
  adjudicateArbitragePair,
  buildArbAdjudicationPrompt,
  normalizeArbAiProvider,
  resolveArbAiConfidenceThreshold,
  resolveArbAiMaxCandidates,
  resolveArbAiModel,
  resolveArbAiProvider,
  resolveArbAiTimeoutMs,
};
