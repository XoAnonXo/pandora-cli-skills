const crypto = require('crypto');
const {
  buildAgentMarketValidationPrompt,
} = require('./agent_market_prompt_service.cjs');

const HYPE_MARKET_SCHEMA_VERSION = '1.0.0';
const DEFAULT_HYPE_AI_PROVIDER = 'auto';
const DEFAULT_HYPE_AI_TIMEOUT_MS = 20_000;
const DEFAULT_OPENAI_MODEL = 'gpt-5';
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

class HypeMarketProviderError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'HypeMarketProviderError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

function normalizeHypeAiProvider(value) {
  const normalized = String(value || DEFAULT_HYPE_AI_PROVIDER).trim().toLowerCase();
  if (['auto', 'anthropic', 'mock', 'none', 'openai'].includes(normalized)) {
    return normalized;
  }
  return null;
}

function resolveHypeAiProvider(options = {}) {
  const explicit = normalizeHypeAiProvider(options.aiProvider);
  const envConfigured = normalizeHypeAiProvider(process.env.PANDORA_HYPE_AI_PROVIDER);
  const provider = explicit || envConfigured || DEFAULT_HYPE_AI_PROVIDER;

  if (provider !== 'auto') return provider;
  if (String(process.env.OPENAI_API_KEY || '').trim()) return 'openai';
  if (String(process.env.ANTHROPIC_API_KEY || '').trim()) return 'anthropic';
  if (String(process.env.PANDORA_HYPE_MOCK_RESPONSE || '').trim()) return 'mock';
  return 'none';
}

function resolveHypeAiModel(provider, options = {}) {
  const explicit = String(options.aiModel || '').trim();
  if (explicit) return explicit;

  const sharedEnv = String(process.env.PANDORA_HYPE_AI_MODEL || '').trim();
  if (sharedEnv) return sharedEnv;

  if (provider === 'openai') {
    return String(process.env.OPENAI_MODEL || '').trim() || DEFAULT_OPENAI_MODEL;
  }
  if (provider === 'anthropic') {
    return String(process.env.ANTHROPIC_MODEL || '').trim() || DEFAULT_ANTHROPIC_MODEL;
  }
  if (provider === 'mock') return 'mock-v1';
  return null;
}

function resolveHypeAiTimeoutMs(options = {}) {
  const explicit = Number(options.aiTimeoutMs || options.timeoutMs);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  const envValue = Number(process.env.PANDORA_HYPE_AI_TIMEOUT_MS);
  if (Number.isInteger(envValue) && envValue > 0) return envValue;
  return DEFAULT_HYPE_AI_TIMEOUT_MS;
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
  const timeoutMs = resolveHypeAiTimeoutMs(options);
  const fetchFn = typeof options.fetchFn === 'function' ? options.fetchFn : fetch;
  const headers = options.headers || {};
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

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
      throw new HypeMarketProviderError(
        'HYPE_AI_HTTP_ERROR',
        `Hype AI request failed with HTTP ${response.status}.`,
        { responseBody: parsed || text, status: response.status, url },
      );
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new HypeMarketProviderError('HYPE_AI_INVALID_RESPONSE', 'Hype AI response was not valid JSON.', {
        responseText: text,
        url,
      });
    }
    return parsed;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new HypeMarketProviderError('HYPE_AI_TIMEOUT', `Hype AI request timed out after ${timeoutMs}ms.`, {
        timeoutMs,
        url,
      });
    }
    if (err instanceof HypeMarketProviderError) throw err;
    throw new HypeMarketProviderError('HYPE_AI_REQUEST_FAILED', err && err.message ? err.message : String(err), {
      url,
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function hashCandidateId(input = {}) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 12);
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function coerceIsoDate(value, fallbackIso) {
  const text = String(value || '').trim();
  if (!text) return fallbackIso;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallbackIso;
}

function normalizeSource(source, index) {
  if (typeof source === 'string') {
    const url = String(source).trim();
    return url ? { title: `Source ${index + 1}`, url, publisher: null, publishedAt: null } : null;
  }
  if (!source || typeof source !== 'object') return null;
  const url = String(source.url || source.href || '').trim();
  if (!url) return null;
  return {
    title: String(source.title || source.name || `Source ${index + 1}`).trim() || `Source ${index + 1}`,
    url,
    publisher: String(source.publisher || source.site || '').trim() || null,
    publishedAt: String(source.publishedAt || source.date || '').trim() || null,
  };
}

function normalizeRules(value, fallbackTopic) {
  const text = String(value || '').trim();
  if (text && /YES:/i.test(text) && /NO:/i.test(text) && /EDGE:/i.test(text)) {
    return text;
  }
  const topic = String(fallbackTopic || 'the event').trim() || 'the event';
  return [
    `YES: ${topic} occurs exactly as stated in the market question by the target timestamp.`,
    `NO: ${topic} does not occur by the target timestamp.`,
    'EDGE: If the event is canceled, abandoned, or never officially confirmed by the cited public sources before the target timestamp, resolve NO.',
  ].join('\n');
}

function normalizeResearchResponse(raw, input = {}, meta = {}) {
  const now = new Date(input.now || Date.now());
  const defaultResolutionIso = new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString();
  const requestedCount = Math.max(1, Number(input.candidateCount) || 3);
  const payload = raw && typeof raw === 'object' ? raw : {};
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const normalizedCandidates = candidates.map((entry, index) => {
    const candidate = entry && typeof entry === 'object' ? entry : {};
    const headline = String(candidate.headline || candidate.topic || `Trending ${input.area || 'market'} ${index + 1}`).trim();
    const topic = String(candidate.topic || headline).trim();
    const sources = (Array.isArray(candidate.sources) ? candidate.sources : [])
      .map(normalizeSource)
      .filter(Boolean)
      .slice(0, 5);

    return {
      candidateId: String(candidate.candidateId || hashCandidateId({ index, headline, topic, area: input.area })).trim(),
      headline,
      topic,
      whyNow: String(candidate.whyNow || candidate.reasoning || payload.summary || 'Fresh topic with active public attention.').trim(),
      category: String(candidate.category || 'Other').trim() || 'Other',
      question: String(candidate.question || '').trim(),
      rules: normalizeRules(candidate.rules, topic),
      sources,
      suggestedResolutionDate: coerceIsoDate(candidate.suggestedResolutionDate, defaultResolutionIso),
      estimatedYesOdds: clampNumber(candidate.estimatedYesOdds, 15, 85, 50),
      freshnessScore: clampNumber(candidate.freshnessScore, 0, 100, 70),
      attentionScore: clampNumber(candidate.attentionScore, 0, 100, 70),
      resolvabilityScore: clampNumber(candidate.resolvabilityScore, 0, 100, 75),
      ammFitScore: clampNumber(candidate.ammFitScore, 0, 100, 70),
      parimutuelFitScore: clampNumber(candidate.parimutuelFitScore, 0, 100, 65),
      marketTypeReasoning: String(candidate.marketTypeReasoning || 'AMM fits repricing-heavy stories; pari-mutuel fits concentrated event bursts.').trim(),
    };
  }).filter((candidate) => candidate.question && candidate.sources.length >= 2)
    .slice(0, requestedCount);

  if (!normalizedCandidates.length) {
    throw new HypeMarketProviderError(
      'HYPE_AI_INVALID_RESPONSE',
      'Hype AI did not return any valid market candidates with at least two sources.',
      { provider: meta.provider || null, model: meta.model || null },
    );
  }

  return {
    schemaVersion: HYPE_MARKET_SCHEMA_VERSION,
    provider: meta.provider || null,
    model: meta.model || null,
    summary: String(payload.summary || 'Trending market candidates synthesized from current public coverage.').trim(),
    searchQueries: Array.isArray(payload.searchQueries)
      ? payload.searchQueries.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 8)
      : [],
    candidates: normalizedCandidates,
  };
}

function normalizeValidationResult(raw, options = {}) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  const blockers = Array.isArray(payload.blockers) ? payload.blockers : [];
  const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
  const decision = String(payload.decision || (blockers.length ? 'FAIL' : 'PASS')).trim().toUpperCase() === 'PASS' ? 'PASS' : 'FAIL';
  const summary = String(payload.summary || payload.reason || '').trim() || 'Validation response returned without a summary.';
  return {
    provider: options.provider || null,
    model: options.model || null,
    isResolvable: decision === 'PASS' && blockers.length === 0 && payload.isResolvable !== false,
    decision,
    score: clampNumber(payload.score, 0, 100, blockers.length ? 62 : 92),
    summary,
    blockers,
    warnings,
    suggestedEdits: payload.suggestedEdits && typeof payload.suggestedEdits === 'object' ? payload.suggestedEdits : null,
    resolverSimulation: payload.resolverSimulation && typeof payload.resolverSimulation === 'object'
      ? payload.resolverSimulation
      : null,
  };
}

function buildDefaultMockResearch(input = {}) {
  const now = new Date(input.now || Date.now());
  const resolution = new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString();
  const area = String(input.area || 'breaking-news');
  const region = String(input.region || '').trim();
  const focus = String(input.query || area).trim() || area;
  const titleArea = area === 'esports' ? 'esports' : area.replace(/-/g, ' ');
  return {
    searchQueries: [
      `${titleArea} trending today ${region}`.trim(),
      `${focus} breaking latest prediction market candidate`.trim(),
    ],
    summary: `Mock research for ${titleArea}.`,
    candidates: [
      {
        headline: `${focus} remains the top ${titleArea} story this week`,
        topic: `${focus} spotlight`,
        whyNow: `The story is fresh, public, and likely to attract attention in ${titleArea}.`,
        category: area === 'sports' || area === 'esports' ? 'Sports' : area === 'politics' ? 'Politics' : 'Other',
        question: `Will the featured ${focus} outcome happen by ${resolution.slice(0, 10)}?`,
        rules: 'YES: The featured outcome described in the cited sources happens by the target timestamp.\nNO: The featured outcome does not happen by the target timestamp.\nEDGE: If the event is canceled, abandoned, or not officially confirmed by the cited public sources before the target timestamp, resolve NO.',
        sources: [
          { title: 'Example Source 1', url: 'https://example.com/source-1', publisher: 'Example', publishedAt: now.toISOString() },
          { title: 'Example Source 2', url: 'https://example.com/source-2', publisher: 'Example', publishedAt: now.toISOString() },
        ],
        suggestedResolutionDate: resolution,
        estimatedYesOdds: 58,
        freshnessScore: 82,
        attentionScore: 80,
        resolvabilityScore: 88,
        ammFitScore: 76,
        parimutuelFitScore: 68,
        marketTypeReasoning: 'AMM is slightly better because the story can reprice as new information arrives.',
      },
    ],
  };
}

function resolveMockResearchResponse(options = {}) {
  if (options.mockResponse && typeof options.mockResponse === 'object') {
    return options.mockResponse;
  }
  const raw = process.env.PANDORA_HYPE_MOCK_RESPONSE;
  if (!raw) return null;
  return safeStructuredParse(raw);
}

async function planWithMock(input, options = {}) {
  const configured = resolveMockResearchResponse(options);
  return normalizeResearchResponse(configured || buildDefaultMockResearch(input), input, {
    provider: 'mock',
    model: resolveHypeAiModel('mock', options),
  });
}

async function runOpenAiStructuredPrompt(prompt, options = {}) {
  const apiKey = String(options.apiKey || process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new HypeMarketProviderError('HYPE_AI_AUTH_MISSING', 'OPENAI_API_KEY is required for OpenAI hype planning.');
  }
  const model = resolveHypeAiModel('openai', options);
  const payload = {
    model,
    input: prompt,
    max_output_tokens: options.maxOutputTokens || 4000,
    text: {
      format: {
        type: 'json_object',
      },
    },
  };
  if (Array.isArray(options.tools) && options.tools.length) {
    payload.tools = options.tools;
  }
  const response = await postJson(
    OPENAI_RESPONSES_URL,
    payload,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );
  const parsed = safeStructuredParse(extractOpenAiOutputText(response));
  if (!parsed || typeof parsed !== 'object') {
    throw new HypeMarketProviderError('HYPE_AI_INVALID_RESPONSE', 'OpenAI hype planning did not return valid JSON.', {
      response,
    });
  }
  return { parsed, model };
}

async function planWithOpenAi(input, options = {}) {
  const result = await runOpenAiStructuredPrompt(options.prompt, {
    ...options,
    tools: [{ type: 'web_search' }],
    maxOutputTokens: 5000,
  });
  return normalizeResearchResponse(result.parsed, input, {
    provider: 'openai',
    model: result.model,
  });
}

async function runAnthropicStructuredPrompt(prompt, options = {}) {
  const apiKey = String(options.apiKey || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    throw new HypeMarketProviderError('HYPE_AI_AUTH_MISSING', 'ANTHROPIC_API_KEY is required for Anthropic hype planning.');
  }
  const model = resolveHypeAiModel('anthropic', options);
  const payload = {
    model,
    max_tokens: options.maxTokens || 3200,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  };
  if (Array.isArray(options.tools) && options.tools.length) {
    payload.tools = options.tools;
  }
  const response = await postJson(
    ANTHROPIC_MESSAGES_URL,
    payload,
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
    throw new HypeMarketProviderError('HYPE_AI_INVALID_RESPONSE', 'Anthropic hype planning did not return valid JSON.', {
      response,
    });
  }
  return { parsed, model };
}

async function planWithAnthropic(input, options = {}) {
  const maxUses = input.searchDepth === 'deep' ? 8 : input.searchDepth === 'fast' ? 2 : 5;
  const result = await runAnthropicStructuredPrompt(options.prompt, {
    ...options,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses }],
    maxTokens: 3600,
  });
  return normalizeResearchResponse(result.parsed, input, {
    provider: 'anthropic',
    model: result.model,
  });
}

async function planHypeMarkets(input = {}, options = {}) {
  const provider = resolveHypeAiProvider(options);
  if (provider === 'none') {
    throw new HypeMarketProviderError(
      'HYPE_AI_PROVIDER_NOT_CONFIGURED',
      'No hype research provider configured. Set --ai-provider, OPENAI_API_KEY, or ANTHROPIC_API_KEY, or use agent market hype for prompt-only workflows.',
      { supportedProviders: ['mock', 'openai', 'anthropic'] },
    );
  }
  if (provider === 'mock') return planWithMock(input, options);
  if (provider === 'openai') return planWithOpenAi(input, options);
  if (provider === 'anthropic') return planWithAnthropic(input, options);
  throw new HypeMarketProviderError('HYPE_AI_PROVIDER_UNSUPPORTED', `Unsupported hype provider: ${provider}`);
}

async function validateMarketDraft(input = {}, options = {}) {
  const provider = resolveHypeAiProvider(options);
  const prompt = buildAgentMarketValidationPrompt(input);
  if (provider === 'none') {
    throw new HypeMarketProviderError(
      'HYPE_AI_PROVIDER_NOT_CONFIGURED',
      'No validation provider configured. Set --ai-provider, OPENAI_API_KEY, or ANTHROPIC_API_KEY.',
      { supportedProviders: ['mock', 'openai', 'anthropic'] },
    );
  }
  if (provider === 'mock') {
    return normalizeValidationResult({
      isResolvable: true,
      decision: 'PASS',
      score: 94,
      summary: 'Mock validation marked the candidate as resolvable.',
      blockers: [],
      warnings: [],
      suggestedEdits: {
        question: input.question,
        rules: input.rules,
        sources: input.sources,
        targetTimestamp: input.targetTimestamp,
        targetTimestampReason: 'Mock validation accepted the supplied target timestamp.',
      },
      resolverSimulation: {
        canDecideYesNoAtTargetTime: true,
        likelyFailureModeIfUnchanged: 'none',
      },
    }, {
      provider: 'mock',
      model: resolveHypeAiModel('mock', options),
    });
  }
  if (provider === 'openai') {
    const result = await runOpenAiStructuredPrompt(prompt, {
      ...options,
      maxOutputTokens: 2200,
    });
    return normalizeValidationResult(result.parsed, { provider: 'openai', model: result.model });
  }
  if (provider === 'anthropic') {
    const result = await runAnthropicStructuredPrompt(prompt, {
      ...options,
      maxTokens: 2200,
    });
    return normalizeValidationResult(result.parsed, { provider: 'anthropic', model: result.model });
  }
  throw new HypeMarketProviderError('HYPE_AI_PROVIDER_UNSUPPORTED', `Unsupported hype provider: ${provider}`);
}

module.exports = {
  HYPE_MARKET_SCHEMA_VERSION,
  HypeMarketProviderError,
  DEFAULT_HYPE_AI_PROVIDER,
  DEFAULT_HYPE_AI_TIMEOUT_MS,
  normalizeHypeAiProvider,
  resolveHypeAiProvider,
  resolveHypeAiModel,
  resolveHypeAiTimeoutMs,
  normalizeResearchResponse,
  normalizeValidationResult,
  planHypeMarkets,
  validateMarketDraft,
};
