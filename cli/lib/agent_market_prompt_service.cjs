const crypto = require('crypto');
const { isMcpMode } = require('./shared/mcp_path_guard.cjs');

const AGENT_MARKET_PROMPT_SCHEMA_VERSION = '1.0.0';
const HYPE_PROMPT_VERSION = 'pandora.market.hype.v1';
const AUTOCOMPLETE_PROMPT_VERSION = 'pandora.market.autocomplete.v1';
const VALIDATION_PROMPT_VERSION = 'pandora.market.validate.v1';
const HYPE_AREAS = Object.freeze(['sports', 'esports', 'politics', 'regional-news', 'breaking-news']);
const MAX_HYPE_CANDIDATE_COUNT = 5;

function createPromptError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function formatDateContext(nowInput = new Date()) {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  return {
    now,
    iso: now.toISOString(),
    formatted: now.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    }),
  };
}

function normalizeMarketType(value) {
  const normalized = String(value || 'amm').trim().toLowerCase();
  return normalized === 'parimutuel' ? 'parimutuel' : 'amm';
}

function normalizeHypeArea(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['sports', 'sport'].includes(normalized)) return 'sports';
  if (['esports', 'e-sports', 'egaming', 'e-gaming', 'gaming'].includes(normalized)) return 'esports';
  if (['politics', 'political'].includes(normalized)) return 'politics';
  if (['regional-news', 'regional', 'local-news'].includes(normalized)) return 'regional-news';
  if (['breaking-news', 'breaking', 'news'].includes(normalized)) return 'breaking-news';
  return '';
}

function normalizeHypeMarketType(value) {
  const normalized = String(value || 'auto').trim().toLowerCase();
  if (['amm', 'auto', 'both', 'parimutuel'].includes(normalized)) return normalized;
  return 'auto';
}

function normalizeQuestion(value) {
  return String(value || '').trim();
}

function normalizeRules(value) {
  return String(value || '').trim();
}

function normalizeSources(sources) {
  if (Array.isArray(sources)) {
    return sources.map((source) => String(source || '').trim()).filter(Boolean);
  }
  if (sources === null || sources === undefined) return [];
  return String(sources)
    .split(/[\n,]/g)
    .map((source) => source.trim())
    .filter(Boolean);
}

function normalizeTargetTimestamp(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.trunc(numeric > 1e12 ? numeric / 1000 : numeric);
  }
  const parsed = Date.parse(String(value || ''));
  return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizeHypeCandidateCount(value, fallback = 3) {
  return Math.min(normalizePositiveInteger(value, fallback), MAX_HYPE_CANDIDATE_COUNT);
}

function normalizeHypeRegion(area, value) {
  const region = String(value || '').trim();
  if (area === 'regional-news' && !region) {
    throw createPromptError(
      'MISSING_REQUIRED_FLAG',
      'agent market hype requires --region <text> when --area regional-news.',
    );
  }
  return region || null;
}

function normalizeValidationInput(input = {}) {
  return {
    question: normalizeQuestion(input.question),
    rules: normalizeRules(input.rules),
    sources: normalizeSources(input.sources),
    targetTimestamp: normalizeTargetTimestamp(input.targetTimestamp),
  };
}

function hashPayload(label, payload) {
  return crypto
    .createHash('sha256')
    .update(String(label || 'pandora'))
    .update('\n')
    .update(JSON.stringify(payload))
    .digest('hex');
}

function buildMarketValidationTicket(input = {}) {
  const normalized = normalizeValidationInput(input);
  return `market-validate:${hashPayload(VALIDATION_PROMPT_VERSION, normalized).slice(0, 24)}`;
}

function quoteShellArg(value) {
  return `'${String(value || '').replace(/'/g, `'\\''`)}'`;
}

function buildAgentMarketAutocompletePrompt(options = {}) {
  const question = normalizeQuestion(options.question);
  const marketType = normalizeMarketType(options.marketType);
  if (!question) {
    throw createPromptError('MISSING_REQUIRED_FLAG', 'agent market autocomplete requires --question <text>.');
  }

  const date = formatDateContext(options.now);
  const marketTypeLabel =
    marketType === 'amm'
      ? 'AMM (tradable, users can sell anytime)'
      : 'Parimutuel (pool-based, funds remain locked until resolution)';
  const parimutuelGuidance = marketType === 'parimutuel'
    ? `

PARIMUTUEL GUIDANCE:
- Parimutuel markets are pool-based. Users seed the YES and NO sides of a shared pool instead of setting a continuous AMM price curve.
- Funds remain locked until the market resolves, so skew choices matter up front and cannot be traded out of later.
- If you later plan this market with explicit distribution percentages, those percentages define the starting YES/NO pool skew.
- An extreme setup like 99.9/0.1 means you are intentionally seeding an almost one-sided directional pool. Use that only when you want the initial market shape to communicate a very strong prior view.
- If you do not want that directional skew, prefer a more balanced opening distribution.`
    : '';

  return `You are an expert prediction market analyst helping users create clear, dispute-free markets.

CURRENT TIME: ${date.formatted}
CURRENT ISO: ${date.iso}

USER QUESTION:
"${question}"

MARKET TYPE: ${marketTypeLabel}
${parimutuelGuidance}

TASK:
1. Search the web for the most up-to-date context for this market question.
   - Confirm the event, fixture, or entity exists.
   - Find the exact event time when the question references a scheduled event.
   - Find reputable public sources that can verify the outcome.
   - Find current odds, forecasts, or consensus when relevant.

2. Determine a safe resolution time.
   - Resolution time must be 20 minutes after the event is expected to end.
   - For sports, account for expected match duration plus buffer.
   - For announcements or releases, add at least 20 minutes after the expected publication time.
   - If end time is uncertain because of overtime, delays, or timezone ambiguity, choose a later time, not an earlier time.
   - The result must still be at least 30 minutes in the future.

3. Choose the best category from:
   Politics, Sports, Finance, Crypto, Culture, Technology, Science, Entertainment, Health, Environment, Other

4. Estimate YES odds between 15 and 85.
   - Use current odds, polls, or expert expectations when available.
   - Favor balanced markets that still have disagreement.

5. Write concise market rules with no ambiguity.
   Use this exact structure:
   YES: [single objective condition]
   NO: [single objective condition]
   EDGE: [single edge-case rule]

6. Avoid the most common human-verification failures.
   - Do not use vague wording such as major, significant, viral, or respond unless objectively defined.
   - Do not require login-only or private sources.
   - Do not rely on exact minute-level or second-level checks unless public historical data supports it.
   - Make YES and NO fully cover the outcome, including cancellation, postponement, abandonment, and no official result.
   - Keep the full rules text under 800 characters.

7. Return only valid JSON with this shape:
{
  "category": "Category from the list above",
  "rules": "YES: ...\\nNO: ...\\nEDGE: ...",
  "sources": ["https://source1", "https://source2"],
  "suggestedResolutionDate": "ISO 8601 datetime",
  "estimatedYesOdds": 50,
  "reasoning": "Brief explanation of the odds estimate",
  "eventEndTime": "Human-readable expected end time"
}

IMPORTANT:
- Return raw JSON only. No markdown. No explanation outside the JSON object.
- Use only public sources that anyone can access without login.
- Design the market so another model can resolve it deterministically.`;
}

function buildAgentMarketHypePrompt(options = {}) {
  const area = normalizeHypeArea(options.area);
  const marketType = normalizeHypeMarketType(options.marketType);
  const candidateCount = normalizeHypeCandidateCount(options.candidateCount, 3);
  const region = normalizeHypeRegion(area, options.region);
  const query = String(options.query || '').trim();

  if (!area) {
    throw createPromptError(
      'MISSING_REQUIRED_FLAG',
      `agent market hype requires --area <${HYPE_AREAS.join('|')}>. Example: pandora --output json agent market hype --area politics --query "suggest ideas".`,
    );
  }

  const date = formatDateContext(options.now);
  const marketTypeHint = marketType === 'both'
    ? 'Draft both AMM and pari-mutuel-friendly ideas when helpful.'
    : marketType === 'auto'
      ? 'Decide whether AMM or pari-mutuel is the better fit for each candidate.'
      : `Bias the candidates toward ${marketType}.`;
  const regionalGuidance = area === 'regional-news'
    ? `
REGIONAL-NEWS RULES:
- Treat REGION FOCUS as a hard constraint, not a soft preference.
- Prefer local or regional official sources, regulators, election authorities, courts, venues, or government announcements tied to the named region.
- Prefer local outlets over national recaps when they disagree or when locality matters.
- Disambiguate city, state, and country names before drafting the question.
- Use the relevant local timezone when choosing the target timestamp.
- Reject candidates unless the decisive event happens in that region or is announced by a region-specific authority.`
    : '';

  return `You are a prediction-market trend editor for Pandora.

CURRENT TIME: ${date.formatted}
CURRENT ISO: ${date.iso}

AREA: ${area}
REGION FOCUS: ${region || 'global'}
EXTRA QUERY HINT: ${query || 'none'}
TARGET CANDIDATE COUNT: ${candidateCount}
MARKET-TYPE HINT: ${marketTypeHint}
${regionalGuidance}

TASK:
1. Search the public web for the latest trending topics in this area.
   - Focus on stories that are fresh, widely discussed, and suitable for a prediction market.
   - Prefer official, primary, or broadly trusted reporting where possible.
   - Ignore private, paywalled, login-only, or unverifiable sources.

2. Identify the strongest candidate markets that could attract real trading interest.
   - The outcome must be binary and publicly checkable.
   - The event should resolve soon enough to be interesting, but not so soon that the market cannot launch safely.
   - Avoid vague social chatter, pure opinion polls, and topics that are already stale.

3. For each candidate, draft a deployable market.
   - Write a concrete question.
   - Write concise rules in this exact format:
     YES: ...
     NO: ...
     EDGE: ...
   - Choose a safe target timestamp in ISO-8601.
   - Estimate YES odds between 15 and 85.
   - Score freshness, attention, resolvability, AMM fit, and pari-mutuel fit from 0 to 100.

4. Be conservative about resolvability.
   - If a story is hyped but cannot be resolved cleanly from public evidence, do not include it.
   - Do not use subjective terms like major, viral, historic, or comeback unless objectively defined.
   - Prefer markets where another model can later resolve YES or NO without split interpretation.

5. Return strict JSON only with this shape:
{
  "searchQueries": ["query 1", "query 2"],
  "summary": "short summary of what is hot right now",
  "candidates": [
    {
      "headline": "short headline",
      "topic": "short topic label",
      "whyNow": "why this is trending now",
      "category": "Politics|Sports|Finance|Crypto|Culture|Technology|Science|Entertainment|Health|Environment|Other",
      "question": "final market question",
      "rules": "YES: ...\\nNO: ...\\nEDGE: ...",
      "sources": [
        {
          "title": "source title",
          "url": "https://example.com/story",
          "publisher": "publisher name",
          "publishedAt": "ISO 8601 datetime or empty string"
        }
      ],
      "suggestedResolutionDate": "ISO 8601 datetime",
      "estimatedYesOdds": 50,
      "freshnessScore": 70,
      "attentionScore": 70,
      "resolvabilityScore": 70,
      "ammFitScore": 70,
      "parimutuelFitScore": 70,
      "marketTypeReasoning": "why one market type fits better"
    }
  ]
}

IMPORTANT:
- Return JSON only. No markdown.
- Provide at least 2 source URLs per candidate.
- Keep candidate count at or below ${candidateCount}.
- Every question must be immediately usable as a Pandora market draft.`;
}

function buildAgentMarketValidationPrompt(options = {}) {
  const normalized = normalizeValidationInput(options);
  if (!normalized.question) {
    throw createPromptError('MISSING_REQUIRED_FLAG', 'agent market validate requires --question <text>.');
  }
  if (!normalized.rules) {
    throw createPromptError('MISSING_REQUIRED_FLAG', 'agent market validate requires --rules <text>.');
  }
  if (!normalized.targetTimestamp || normalized.targetTimestamp <= 0) {
    throw createPromptError(
      'MISSING_REQUIRED_FLAG',
      'agent market validate requires --target-timestamp <unix-seconds>.',
    );
  }

  const input = JSON.stringify(
    {
      question: normalized.question,
      rules: normalized.rules,
      sources: normalized.sources,
      targetTimestamp: normalized.targetTimestamp,
    },
    null,
    2,
  );

  return `You are a strict "Prediction Market Resolvability Auditor".

Your task:
Evaluate whether a user-created prediction market can be resolved reliably in the future by AI resolvers using public web evidence and a deterministic YES or NO outcome.

You receive input in this exact shape:
${input}

Core principle:
Do not judge whether the event is likely to happen. Judge whether the market is specified clearly enough that a future resolver can determine YES or NO without ambiguity or split votes.

Resolution mindset:
- At targetTimestamp, can I confidently decide YES or NO from the market definition?
- Could two competent models interpret the market differently?
- Is there enough time, source, and metric precision to avoid UNKNOWN outcomes?

Hard requirements to pass:
1. Time validity
   - Event timing must be explicit and unambiguous.
   - Relative time phrases such as tomorrow or next week are invalid unless normalized.
   - targetTimestamp must be at or after the event completion time plus a reasonable buffer.
   - If the event can run long, the rules must account for that.

2. Binary determinism
   - YES and NO must be mutually exclusive and collectively exhaustive.
   - Subjective terms must be replaced with objective definitions.
   - Edge cases such as cancellation, postponement, abandonment, no contest, or no official result must be handled.

3. Metric specificity
   - If the market depends on price, count, threshold, or rank, define the exact metric and comparison.
   - Define the exact observation window and timezone when needed.
   - Avoid precision that public data cannot support.

4. Source quality
   - Sources must be public, stable, and independently verifiable.
   - Flag paywalled, login-only, private, or unstable analytics sources.
   - If sources can disagree, the rules should define precedence.

5. Entity identity
   - Teams, players, tickers, accounts, products, and locations must be unambiguous.

6. Event existence
   - The event or fixture must be plausibly checkable from public information.

7. Anti-cheating safeguards
   - Rules must resolve based on event facts, not source availability.
   - Absence of evidence is not automatically evidence the event did not happen unless the rules explicitly define authoritative absence logic.

Severity model:
- BLOCKER: not safely resolvable; the market should not be created yet.
- WARNING: resolvable but risky; should be improved.
- INFO: optional quality improvements.

Output policy:
- Be concise, concrete, and actionable.
- Always propose exact fixes.
- If possible, provide corrected question, rules, sources, and targetTimestamp.
- Never invent source URLs.

Respond with strict JSON only:
{
  "isResolvable": boolean,
  "decision": "PASS" | "FAIL",
  "score": 0-100,
  "summary": "short assessment",
  "blockers": [
    {
      "code": "TIME_AMBIGUOUS | TARGET_TOO_EARLY | BINARY_GAP | SUBJECTIVE_TERM | METRIC_UNSPECIFIED | SOURCE_MISSING | SOURCE_UNRELIABLE | SOURCE_LOGIN_REQUIRED | IDENTITY_AMBIGUOUS | EVENT_MISMATCH | EDGE_CASE_MISSING | CHEATING_RULE",
      "message": "what is wrong",
      "whyItMatters": "how this causes split or UNKNOWN resolution",
      "fix": "exact rewrite or rule patch"
    }
  ],
  "warnings": [
    {
      "code": "string",
      "message": "string",
      "fix": "string"
    }
  ],
  "suggestedEdits": {
    "question": "improved question",
    "rules": "YES: ...\\nNO: ...\\nEDGE: ...\\nSOURCE_PRECEDENCE: ...",
    "sources": ["url1", "url2", "url3"],
    "targetTimestamp": 0,
    "targetTimestampReason": "why this time is safe"
  },
  "resolverSimulation": {
    "canDecideYesNoAtTargetTime": boolean,
    "likelyFailureModeIfUnchanged": "short"
  }
}

Scoring guidance:
- Start at 100.
- Subtract 25 per blocker and 8 per warning.
- Clamp to [0, 100].
- If any blocker exists, decision must be FAIL and isResolvable must be false.`;
}

function buildRequiredAgentMarketValidation(input = {}) {
  const normalized = normalizeValidationInput(input);
  const ticket = buildMarketValidationTicket(normalized);
  return {
    requiredInMcpExecute: true,
    ticket,
    promptTool: 'agent.market.validate',
    promptVersion: VALIDATION_PROMPT_VERSION,
    input: normalized,
    expectedAttestation: {
      validationTicket: ticket,
      validationDecision: 'PASS',
      validationSummary: 'Short PASS summary from the validation run.',
    },
    cliArgv: [
      'agent',
      'market',
      'validate',
      '--question',
      normalized.question,
      '--rules',
      normalized.rules,
      '--target-timestamp',
      String(normalized.targetTimestamp),
      ...(normalized.sources.length ? ['--sources', ...normalized.sources] : []),
    ],
    cliCommand:
      `pandora --output json agent market validate --question ${quoteShellArg(normalized.question)} ` +
      `--rules ${quoteShellArg(normalized.rules)} --target-timestamp ${normalized.targetTimestamp}` +
      (normalized.sources.length
        ? ` --sources ${normalized.sources.map((source) => quoteShellArg(source)).join(' ')}`
        : ''),
  };
}

function buildAgentMarketAutocompletePayload(options = {}) {
  const question = normalizeQuestion(options.question);
  const marketType = normalizeMarketType(options.marketType);
  const date = formatDateContext(options.now);

  return {
    schemaVersion: AGENT_MARKET_PROMPT_SCHEMA_VERSION,
    generatedAt: date.iso,
    promptKind: 'agent.market.autocomplete',
    promptVersion: AUTOCOMPLETE_PROMPT_VERSION,
    ticket: null,
    input: {
      question,
      marketType,
      currentTimeIso: date.iso,
    },
    prompt: buildAgentMarketAutocompletePrompt({
      question,
      marketType,
      now: date.now,
    }),
    workflow: {
      mandatoryForAgentDrafting: true,
      nextTool: 'agent.market.validate',
      notes: [
        'Use this prompt when the agent must draft or refine market rules, sources, and timing.',
        'For parimutuel drafts, explain that distribution percentages define the opening YES/NO pool skew and that funds remain locked until resolution.',
        'After applying the draft, always run agent.market.validate on the finalized market payload before execute mode.',
      ],
    },
  };
}

function buildAgentMarketHypePayload(options = {}) {
  const area = normalizeHypeArea(options.area);
  const marketType = normalizeHypeMarketType(options.marketType);
  const date = formatDateContext(options.now);
  const candidateCount = normalizeHypeCandidateCount(options.candidateCount, 3);
  const region = normalizeHypeRegion(area, options.region);

  return {
    schemaVersion: AGENT_MARKET_PROMPT_SCHEMA_VERSION,
    generatedAt: date.iso,
    promptKind: 'agent.market.hype',
    promptVersion: HYPE_PROMPT_VERSION,
    ticket: null,
    input: {
      area,
      region,
      query: String(options.query || '').trim() || null,
      marketType,
      candidateCount,
      currentTimeIso: date.iso,
    },
    prompt: buildAgentMarketHypePrompt({
      area,
      region,
      query: options.query,
      marketType,
      candidateCount,
      now: date.now,
    }),
    workflow: {
      mandatoryForAgentDrafting: true,
      nextTool: 'agent.market.validate',
      notes: [
        'Use this prompt when the host agent must research the latest trending topics itself before drafting a market.',
        'For MCP users who want real market suggestions, prefer provider-backed markets.hype.plan first; treat this as fallback/orchestration mode.',
        'After selecting the best candidate, run agent.market.validate on the exact final question, rules, sources, and target timestamp.',
        'If the candidate will be executed through MCP, pass the resulting PASS attestation back as agentPreflight.',
      ],
    },
  };
}

function buildAgentMarketValidationPayload(options = {}) {
  const normalized = normalizeValidationInput(options);
  const date = formatDateContext(options.now);
  const ticket = buildMarketValidationTicket(normalized);

  return {
    schemaVersion: AGENT_MARKET_PROMPT_SCHEMA_VERSION,
    generatedAt: date.iso,
    promptKind: 'agent.market.validate',
    promptVersion: VALIDATION_PROMPT_VERSION,
    ticket,
    input: normalized,
    prompt: buildAgentMarketValidationPrompt(normalized),
    workflow: {
      mandatoryForAgentMarketExecution: true,
      notes: [
        'Run this prompt against the exact final question, rules, sources, and targetTimestamp that will be deployed.',
        'If validation returns PASS, copy the attestation fields into agentPreflight for execute-mode MCP calls.',
      ],
    },
    requiredAttestation: {
      validationTicket: ticket,
      validationDecision: 'PASS',
      validationSummary: 'Short PASS summary from the validation run.',
    },
  };
}

function parseAgentPreflightEnv(env = process.env) {
  const raw = env && typeof env.PANDORA_AGENT_PREFLIGHT === 'string' ? env.PANDORA_AGENT_PREFLIGHT.trim() : '';
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    throw createPromptError('MCP_AGENT_PREFLIGHT_INVALID', 'Invalid PANDORA_AGENT_PREFLIGHT payload.', {
      cause: error && error.message ? error.message : String(error),
    });
  }
}

function assertAgentMarketValidation(input = {}, options = {}) {
  if (!isMcpMode()) {
    return null;
  }

  const requiredValidation = buildRequiredAgentMarketValidation(input);
  const preflight =
    options.preflight && typeof options.preflight === 'object'
      ? options.preflight
      : parseAgentPreflightEnv(options.env || process.env);

  if (!preflight || typeof preflight !== 'object') {
    throw createPromptError(
      'MCP_AGENT_MARKET_VALIDATION_REQUIRED',
      'Agent-exposed market execution requires prior agent.market.validate attestation.',
      {
        requiredValidation,
      },
    );
  }

  const validationTicket = String(preflight.validationTicket || '').trim();
  const validationDecision = String(preflight.validationDecision || '').trim().toUpperCase();
  const validationSummary = String(preflight.validationSummary || '').trim();

  if (!validationTicket) {
    throw createPromptError(
      'MCP_AGENT_MARKET_VALIDATION_REQUIRED',
      'agentPreflight.validationTicket is required for agent-exposed market execution.',
      {
        requiredValidation,
      },
    );
  }

  if (validationTicket !== requiredValidation.ticket) {
    throw createPromptError(
      'MCP_AGENT_MARKET_VALIDATION_MISMATCH',
      'agentPreflight.validationTicket does not match the exact market payload being deployed.',
      {
        expectedTicket: requiredValidation.ticket,
        receivedTicket: validationTicket,
        requiredValidation,
      },
    );
  }

  if (validationDecision !== 'PASS') {
    throw createPromptError(
      'MCP_AGENT_MARKET_VALIDATION_FAILED',
      'Agent market validation must report PASS before execute mode is allowed.',
      {
        expectedTicket: requiredValidation.ticket,
        receivedDecision: validationDecision || null,
        validationSummary,
      },
    );
  }

  if (!validationSummary) {
    throw createPromptError(
      'MCP_AGENT_MARKET_VALIDATION_REQUIRED',
      'agentPreflight.validationSummary is required for agent-exposed market execution.',
      {
        requiredValidation,
      },
    );
  }

  return {
    ok: true,
    ticket: validationTicket,
    decision: validationDecision,
    summary: validationSummary,
  };
}

module.exports = {
  AGENT_MARKET_PROMPT_SCHEMA_VERSION,
  HYPE_PROMPT_VERSION,
  AUTOCOMPLETE_PROMPT_VERSION,
  VALIDATION_PROMPT_VERSION,
  HYPE_AREAS,
  normalizeValidationInput,
  buildMarketValidationTicket,
  buildAgentMarketHypePrompt,
  buildAgentMarketAutocompletePrompt,
  buildAgentMarketValidationPrompt,
  buildAgentMarketHypePayload,
  buildAgentMarketAutocompletePayload,
  buildAgentMarketValidationPayload,
  buildRequiredAgentMarketValidation,
  parseAgentPreflightEnv,
  assertAgentMarketValidation,
};
