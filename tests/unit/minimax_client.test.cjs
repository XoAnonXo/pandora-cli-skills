const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildMinimaxRequest,
  callMinimaxChat,
  resolveMinimaxConfig,
} = require('../../proving-ground/lib/minimax_client.cjs');

test('resolveMinimaxConfig prefers explicit values and env fallbacks', () => {
  const config = resolveMinimaxConfig({
    model: 'MiniMax-M2.7-highspeed',
    apiKeyEnv: 'CUSTOM_KEY',
  }, {
    CUSTOM_KEY: 'secret',
    MINIMAX_BASE_URL: 'https://example.test/v1/',
  });

  assert.equal(config.apiKey, 'secret');
  assert.equal(config.apiKeyEnv, 'CUSTOM_KEY');
  assert.equal(config.baseUrl, 'https://example.test/v1');
  assert.equal(config.model, 'MiniMax-M2.7-highspeed');
});

test('buildMinimaxRequest emits OpenAI-compatible payload shape', () => {
  const request = buildMinimaxRequest({
    model: 'MiniMax-M2.7-highspeed',
    systemPrompt: 'sys',
    userPrompt: 'hello',
    maxCompletionTokens: 128,
  });

  assert.equal(request.model, 'MiniMax-M2.7-highspeed');
  assert.equal(request.messages.length, 2);
  assert.equal(request.max_completion_tokens, 128);
  assert.deepEqual(request.extra_body, { reasoning_split: true });
});

test('callMinimaxChat returns text, usage, and elapsed time', async () => {
  const response = await callMinimaxChat({
    apiKey: 'secret',
    minIntervalMs: 0,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        model: 'MiniMax-M2.7-highspeed',
        usage: {
          prompt_tokens: 11,
          completion_tokens: 7,
          total_tokens: 18,
        },
        choices: [{
          finish_reason: 'stop',
          message: {
            content: 'ok',
            reasoning_details: [{ text: 'think' }],
          },
        }],
      }),
    }),
    messages: [{ role: 'user', content: 'hello' }],
  });

  assert.equal(response.text, 'ok');
  assert.equal(response.reasoning, 'think');
  assert.equal(response.usage.total_tokens, 18);
  assert.equal(response.finishReason, 'stop');
  assert.ok(response.elapsedMs >= 0);
});

test('callMinimaxChat aborts hung requests at the configured timeout', async () => {
  await assert.rejects(() => callMinimaxChat({
    apiKey: 'secret',
    minIntervalMs: 0,
    timeoutMs: 20,
    fetchImpl: async (_url, init) => new Promise((resolve, reject) => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      init.signal.addEventListener('abort', () => reject(error), { once: true });
    }),
    messages: [{ role: 'user', content: 'hello' }],
  }), /MiniMax request timed out after 1000ms/);
});

test('callMinimaxChat spaces concurrent requests through the shared rate limiter', async () => {
  const startedAt = [];
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minimax-rate-limit-'));
  const fetchImpl = async () => {
    startedAt.push(Date.now());
    return {
      ok: true,
      json: async () => ({
        model: 'MiniMax-M2.7-highspeed',
        usage: {},
        choices: [{
          finish_reason: 'stop',
          message: {
            content: 'ok',
            reasoning_details: [],
          },
        }],
      }),
    };
  };

  await Promise.all([
    callMinimaxChat({
      apiKey: 'secret',
      minIntervalMs: 75,
      rateLimitStateDir: stateDir,
      fetchImpl,
      messages: [{ role: 'user', content: 'one' }],
    }),
    callMinimaxChat({
      apiKey: 'secret',
      minIntervalMs: 75,
      rateLimitStateDir: stateDir,
      fetchImpl,
      messages: [{ role: 'user', content: 'two' }],
    }),
  ]);

  assert.equal(startedAt.length, 2);
  assert.ok(Math.abs(startedAt[1] - startedAt[0]) >= 60);
});
