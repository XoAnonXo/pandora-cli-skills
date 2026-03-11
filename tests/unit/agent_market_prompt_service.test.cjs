const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMarketValidationTicket,
  buildAgentMarketHypePayload,
  buildAgentMarketAutocompletePayload,
  buildAgentMarketValidationPayload,
  buildRequiredAgentMarketValidation,
  assertAgentMarketValidation,
} = require('../../cli/lib/agent_market_prompt_service.cjs');

function withMcpMode(t) {
  const previous = process.env.PANDORA_MCP_MODE;
  process.env.PANDORA_MCP_MODE = '1';
  t.after(() => {
    if (previous === undefined) {
      delete process.env.PANDORA_MCP_MODE;
      return;
    }
    process.env.PANDORA_MCP_MODE = previous;
  });
}

test('market validation ticket is deterministic for the same payload', () => {
  const input = {
    question: 'Will BTC close above $120,000 on December 31, 2026?',
    rules: 'YES: BTC/USD closes above 120000. NO: BTC/USD closes at or below 120000. EDGE: Use Coinbase spot close.',
    sources: ['https://www.coinbase.com', 'https://www.tradingview.com'],
    targetTimestamp: 1798675200,
  };

  const first = buildMarketValidationTicket(input);
  const second = buildMarketValidationTicket({
    ...input,
    sources: [...input.sources],
  });

  assert.equal(first, second);
  assert.equal(first.startsWith('market-validate:'), true);
});

test('autocomplete payload marks validation as the next mandatory tool', () => {
  const payload = buildAgentMarketAutocompletePayload({
    question: 'Will Arsenal beat Chelsea?',
    marketType: 'amm',
    now: '2026-03-07T12:00:00.000Z',
  });

  assert.equal(payload.promptKind, 'agent.market.autocomplete');
  assert.equal(payload.workflow.nextTool, 'agent.market.validate');
  assert.equal(payload.workflow.mandatoryForAgentDrafting, true);
  assert.equal(payload.prompt.includes('Return only valid JSON'), true);
});

test('hype payload exposes trend-research prompt and validation workflow', () => {
  const payload = buildAgentMarketHypePayload({
    area: 'breaking-news',
    region: 'United States',
    query: 'AI launches',
    candidateCount: 3,
    marketType: 'auto',
    now: '2026-03-11T12:00:00.000Z',
  });

  assert.equal(payload.promptKind, 'agent.market.hype');
  assert.equal(payload.input.area, 'breaking-news');
  assert.equal(payload.input.candidateCount, 3);
  assert.equal(payload.workflow.nextTool, 'agent.market.validate');
  assert.equal(payload.prompt.includes('Search the public web for the latest trending topics'), true);
});

test('hype payload clamps candidate count to documented maximum', () => {
  const payload = buildAgentMarketHypePayload({
    area: 'sports',
    candidateCount: 99,
    now: '2026-03-11T12:00:00.000Z',
  });

  assert.equal(payload.input.candidateCount, 5);
  assert.match(payload.prompt, /Keep candidate count at or below 5\./);
});

test('regional-news hype payload requires an explicit region', () => {
  assert.throws(
    () =>
      buildAgentMarketHypePayload({
        area: 'regional-news',
        candidateCount: 2,
        now: '2026-03-11T12:00:00.000Z',
      }),
    (error) => error && error.code === 'MISSING_REQUIRED_FLAG',
  );
});

test('regional-news hype payload includes locality-specific sourcing guidance', () => {
  const payload = buildAgentMarketHypePayload({
    area: 'regional-news',
    region: 'Dubai',
    query: 'transport authority',
    candidateCount: 2,
    now: '2026-03-11T12:00:00.000Z',
  });

  assert.equal(payload.input.region, 'Dubai');
  assert.match(payload.prompt, /REGIONAL-NEWS RULES:/);
  assert.match(payload.prompt, /Treat REGION FOCUS as a hard constraint/i);
  assert.match(payload.prompt, /Prefer local or regional official sources/i);
});

test('validation payload includes required attestation and exact ticket', () => {
  const input = {
    question: 'Will Arsenal beat Chelsea?',
    rules: 'YES: Arsenal wins in official full-time result. NO: Chelsea wins or match ends draw. EDGE: Abandoned match resolves NO unless officially replayed before targetTimestamp.',
    sources: ['https://www.premierleague.com', 'https://www.espn.com'],
    targetTimestamp: 1777777777,
    now: '2026-03-07T12:00:00.000Z',
  };

  const payload = buildAgentMarketValidationPayload(input);
  const required = buildRequiredAgentMarketValidation(input);

  assert.equal(payload.promptKind, 'agent.market.validate');
  assert.equal(payload.ticket, required.ticket);
  assert.deepEqual(payload.requiredAttestation, required.expectedAttestation);
  assert.equal(payload.workflow.mandatoryForAgentMarketExecution, true);
});

test('assertAgentMarketValidation enforces exact PASS attestation in MCP mode', (t) => {
  withMcpMode(t);

  const input = {
    question: 'Will Arsenal beat Chelsea?',
    rules: 'YES: Arsenal wins in official full-time result. NO: Chelsea wins or match ends draw. EDGE: Abandoned match resolves NO unless officially replayed before targetTimestamp.',
    sources: ['https://www.premierleague.com', 'https://www.espn.com'],
    targetTimestamp: 1777777777,
  };
  const required = buildRequiredAgentMarketValidation(input);

  const accepted = assertAgentMarketValidation(input, {
    preflight: {
      validationTicket: required.ticket,
      validationDecision: 'PASS',
      validationSummary: 'Resolvable with public final score sources.',
    },
  });

  assert.equal(accepted.ok, true);
  assert.equal(accepted.ticket, required.ticket);

  assert.throws(
    () =>
      assertAgentMarketValidation(input, {
        preflight: {
          validationTicket: 'market-validate:wrongticket',
          validationDecision: 'PASS',
          validationSummary: 'wrong',
        },
      }),
    (error) => error && error.code === 'MCP_AGENT_MARKET_VALIDATION_MISMATCH',
  );

  assert.throws(
    () =>
      assertAgentMarketValidation(input, {
        preflight: {
          validationTicket: required.ticket,
          validationDecision: 'FAIL',
          validationSummary: 'Ambiguous rules.',
        },
      }),
    (error) => error && error.code === 'MCP_AGENT_MARKET_VALIDATION_FAILED',
  );
});
