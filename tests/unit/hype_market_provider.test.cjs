const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeHypeAiProvider,
  normalizeResearchResponse,
  planHypeMarkets,
  validateMarketDraft,
} = require('../../cli/lib/hype_market_provider.cjs');

test('normalizeHypeAiProvider accepts supported values', () => {
  assert.equal(normalizeHypeAiProvider('openai'), 'openai');
  assert.equal(normalizeHypeAiProvider('anthropic'), 'anthropic');
  assert.equal(normalizeHypeAiProvider('mock'), 'mock');
  assert.equal(normalizeHypeAiProvider('none'), 'none');
  assert.equal(normalizeHypeAiProvider('weird'), null);
});

test('planHypeMarkets returns normalized mock candidates', async () => {
  const payload = await planHypeMarkets({
    area: 'sports',
    query: 'title race',
    candidateCount: 1,
    searchDepth: 'standard',
    now: '2026-03-11T12:00:00.000Z',
  }, {
    aiProvider: 'mock',
  });

  assert.equal(payload.provider, 'mock');
  assert.equal(Array.isArray(payload.candidates), true);
  assert.equal(payload.candidates.length, 1);
  assert.equal(typeof payload.candidates[0].question, 'string');
  assert.equal(payload.candidates[0].sources.length >= 2, true);
});

test('validateMarketDraft returns PASS in mock mode', async () => {
  const result = await validateMarketDraft({
    question: 'Will the featured outcome happen by March 20, 2026?',
    rules: 'YES: The featured outcome happens by the target timestamp.\nNO: The featured outcome does not happen by the target timestamp.\nEDGE: If the event is canceled or never officially confirmed by the cited public sources before the target timestamp, resolve NO.',
    sources: ['https://example.com/a', 'https://example.com/b'],
    targetTimestamp: 1774000000,
  }, {
    aiProvider: 'mock',
  });

  assert.equal(result.decision, 'PASS');
  assert.equal(result.isResolvable, true);
});

test('normalizeResearchResponse keeps later valid candidates instead of slicing before filtering', () => {
  const payload = normalizeResearchResponse({
    candidates: [
      {
        headline: 'Invalid early candidate',
        question: '',
        sources: [{ url: 'https://example.com/one' }],
      },
      {
        headline: 'Valid second candidate',
        question: 'Will valid candidate two resolve?',
        sources: [{ url: 'https://example.com/two-a' }, { url: 'https://example.com/two-b' }],
      },
      {
        headline: 'Valid third candidate',
        question: 'Will valid candidate three resolve?',
        sources: [{ url: 'https://example.com/three-a' }, { url: 'https://example.com/three-b' }],
      },
    ],
  }, {
    area: 'sports',
    candidateCount: 2,
    now: '2026-03-12T00:00:00.000Z',
  }, {
    provider: 'mock',
    model: 'mock-v1',
  });

  assert.equal(payload.candidates.length, 2);
  assert.equal(payload.candidates[0].headline, 'Valid second candidate');
  assert.equal(payload.candidates[1].headline, 'Valid third candidate');
});
