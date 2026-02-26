const ANALYZE_SCHEMA_VERSION = '1.0.0';

class AnalyzeProviderError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'AnalyzeProviderError';
    this.code = code;
    this.details = details;
  }
}

function getProviderName(options = {}) {
  const explicit = options.provider ? String(options.provider).trim().toLowerCase() : '';
  const envProvider = process.env.PANDORA_ANALYZE_PROVIDER ? String(process.env.PANDORA_ANALYZE_PROVIDER).trim().toLowerCase() : '';
  return explicit || envProvider || 'none';
}

async function evaluateWithMock(context) {
  const raw = process.env.PANDORA_ANALYZE_MOCK_RESPONSE;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return {
        fairYesPct: parsed.fairYesPct,
        confidence: parsed.confidence,
        rationale: parsed.rationale || 'Mocked analyze response.',
        caveats: Array.isArray(parsed.caveats) ? parsed.caveats : [],
      };
    } catch {
      // Ignore malformed mock payload and fall through to deterministic default.
    }
  }

  const marketYes = Number(context && context.market && context.market.yesPct);
  const fair = Number.isFinite(marketYes) ? Math.max(1, Math.min(99, marketYes * 0.9)) : 50;
  return {
    fairYesPct: fair,
    confidence: 0.42,
    rationale: 'Mock provider generated a conservative fair-value estimate for local/testing workflows.',
    caveats: ['Mock analysis provider is enabled; no external model call was executed.'],
  };
}

async function evaluateMarket(context, options = {}) {
  const provider = getProviderName(options);
  if (provider === 'none') {
    throw new AnalyzeProviderError(
      'ANALYZE_PROVIDER_NOT_CONFIGURED',
      'No analyze provider configured. Set --provider or PANDORA_ANALYZE_PROVIDER.',
      {
        supportedProviders: ['mock'],
      },
    );
  }

  if (provider === 'mock') {
    const result = await evaluateWithMock(context);
    return {
      schemaVersion: ANALYZE_SCHEMA_VERSION,
      provider,
      model: options.model || 'mock-v1',
      result,
    };
  }

  throw new AnalyzeProviderError('ANALYZE_PROVIDER_UNSUPPORTED', `Unsupported analyze provider: ${provider}`, {
    supportedProviders: ['mock'],
  });
}

module.exports = {
  ANALYZE_SCHEMA_VERSION,
  AnalyzeProviderError,
  getProviderName,
  evaluateMarket,
};
