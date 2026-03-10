const test = require('node:test');
const assert = require('node:assert/strict');

const {
  adjudicateArbitragePair,
  normalizeArbAiProvider,
  resolveArbAiProvider,
} = require('../../cli/lib/arb_adjudication_provider.cjs');

test('arb adjudication provider normalizes supported provider names', () => {
  assert.equal(normalizeArbAiProvider(' OpenAI '), 'openai');
  assert.equal(normalizeArbAiProvider('AUTO'), 'auto');
  assert.equal(normalizeArbAiProvider('invalid-provider'), null);
});

test('arb adjudication provider resolves mock from environment when configured', () => {
  const priorOpenAiKey = process.env.OPENAI_API_KEY;
  const priorAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const priorMock = process.env.PANDORA_ARB_AI_MOCK_RESPONSE;
  try {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.PANDORA_ARB_AI_MOCK_RESPONSE = '{"equivalent":true,"confidence":0.91}';
    assert.equal(resolveArbAiProvider({ aiProvider: 'auto' }), 'mock');
  } finally {
    if (priorOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = priorOpenAiKey;
    if (priorAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = priorAnthropicKey;
    if (priorMock === undefined) delete process.env.PANDORA_ARB_AI_MOCK_RESPONSE;
    else process.env.PANDORA_ARB_AI_MOCK_RESPONSE = priorMock;
  }
});

test('arb adjudication provider mock path normalizes structured output', async () => {
  const adjudication = await adjudicateArbitragePair(
    {
      leftQuestion: 'Will Dallas Mavericks beat Boston Celtics?',
      rightQuestion: 'Mavericks vs Celtics winner',
      heuristicAccepted: false,
      semanticScore: 0.7,
      similarityScore: 0.81,
      semanticWarnings: [],
      sharedSubjects: ['mavericks', 'celtics'],
      sharedPredicateFamilies: ['team_result'],
      sharedYears: [],
      leftSignature: { topic: 'sports', marketType: 'sports.team_result' },
      rightSignature: { topic: 'sports', marketType: 'sports.team_result' },
    },
    {
      aiProvider: 'mock',
      mockResponse: {
        equivalent: true,
        confidence: 93,
        reason: 'Same teams and same winner condition.',
        blockers: [],
        topic: 'sports',
        marketType: 'sports.team_result',
      },
    },
  );

  assert.equal(adjudication.provider, 'mock');
  assert.equal(adjudication.model, 'mock-v1');
  assert.equal(adjudication.equivalent, true);
  assert.equal(adjudication.confidence, 0.93);
  assert.equal(adjudication.marketType, 'sports.team_result');
});
