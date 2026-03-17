const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildHypePlan,
  normalizePlanDocument,
  selectCandidate,
  resolveDraft,
  buildDraftIntegrityHash,
  assertFrozenValidationAttestation,
  assertFrozenDraftIntegrity,
  createRunMarketsHypeCommand,
} = require('../../cli/lib/markets_hype_command_service.cjs');

const SAMPLE_PLAN = {
  schemaVersion: '1.0.0',
  candidates: [
    {
      candidateId: 'cand-1',
      recommendedMarketType: 'amm',
      marketDrafts: {
        amm: { question: 'Q1' },
        parimutuel: { question: 'Q1' },
      },
    },
    {
      candidateId: 'cand-2',
      recommendedMarketType: 'parimutuel',
      marketDrafts: {
        amm: { question: 'Q2' },
        parimutuel: { question: 'Q2' },
      },
    },
  ],
  selectedCandidateId: 'cand-2',
};

test('normalizePlanDocument accepts raw plan payload and success envelope', () => {
  assert.equal(normalizePlanDocument(SAMPLE_PLAN).selectedCandidateId, 'cand-2');
  assert.equal(normalizePlanDocument({ ok: true, command: 'markets.hype.plan', data: SAMPLE_PLAN }).selectedCandidateId, 'cand-2');
});

test('selectCandidate prefers explicit id and falls back to selected candidate', () => {
  assert.equal(selectCandidate(SAMPLE_PLAN, 'cand-1').candidateId, 'cand-1');
  assert.equal(selectCandidate(SAMPLE_PLAN, null).candidateId, 'cand-2');
});

test('selectCandidate rejects tampered selectedCandidate payloads that are not in the saved candidate set', () => {
  assert.throws(
    () => selectCandidate({
      ...SAMPLE_PLAN,
      selectedCandidateId: null,
      selectedCandidate: {
        candidateId: 'tampered',
        marketDrafts: {
          amm: { question: 'tampered' },
        },
      },
    }, null),
    /does not match any saved candidate/i,
  );
});

test('selectCandidate requires an explicit candidate id when no ready selected candidate is stored', () => {
  assert.throws(
    () => selectCandidate({
      schemaVersion: '1.0.0',
      candidates: [{
        candidateId: 'cand-1',
        readyToDeploy: false,
        recommendedMarketType: 'amm',
        marketDrafts: {
          amm: { question: 'Q1' },
        },
      }],
      selectedCandidateId: null,
      selectedCandidate: null,
    }, null),
    /identify a ready selected candidate/i,
  );
});

test('resolveDraft supports selected market type indirection', () => {
  const candidate = selectCandidate(SAMPLE_PLAN, 'cand-2');
  const selected = resolveDraft(candidate, 'selected');
  assert.equal(selected.marketType, 'parimutuel');
  assert.equal(selected.draft.question, 'Q2');

  const explicit = resolveDraft(candidate, 'amm');
  assert.equal(explicit.marketType, 'amm');
  assert.equal(explicit.draft.question, 'Q2');
});

test('assertFrozenValidationAttestation rejects mismatched stored tickets', () => {
  class CliError extends Error {
    constructor(code, message, details) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }

  assert.throws(
    () => assertFrozenValidationAttestation({
      candidateId: 'cand-1',
      validation: {
        attestation: {
          validationTicket: 'market-validate:stale',
          validationDecision: 'PASS',
          validationSummary: 'stale',
        },
      },
    }, {
      ticket: 'market-validate:fresh',
    }, CliError),
    (error) => error && error.code === 'MARKETS_HYPE_VALIDATION_MISMATCH',
  );
});

test('assertFrozenDraftIntegrity rejects deploy-parameter tampering outside validation fields', () => {
  class CliError extends Error {
    constructor(code, message, details) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }

  const originalDraft = {
    question: 'Will Team A win?',
    rules: 'YES if Team A wins. NO otherwise.',
    sources: ['https://example.com/a'],
    targetTimestamp: 1900000000,
    marketType: 'amm',
    category: 1,
    liquidityUsdc: 100,
    distributionYes: 430000000,
    distributionNo: 570000000,
    feeTier: 3000,
    maxImbalance: 16777215,
    minCloseLeadSeconds: 1800,
    chainId: 1,
    oracle: '0x1111111111111111111111111111111111111111',
    factory: '0x2222222222222222222222222222222222222222',
    usdc: '0x3333333333333333333333333333333333333333',
    arbiter: '0x4444444444444444444444444444444444444444',
  };

  const tamperedDraft = {
    ...originalDraft,
    distributionYes: 350000000,
    distributionNo: 650000000,
  };

  assert.throws(
    () => assertFrozenDraftIntegrity({
      candidateId: 'cand-1',
      draftIntegrity: {
        amm: buildDraftIntegrityHash(originalDraft),
      },
    }, 'amm', tamperedDraft, CliError),
    (error) => error && error.code === 'MARKETS_HYPE_PLAN_INTEGRITY_MISMATCH',
  );
});

test('buildHypePlan stays deterministic when now is fixed', async () => {
  const options = {
    area: 'sports',
    query: 'title race',
    candidateCount: 1,
    marketType: 'auto',
    searchDepth: 'standard',
    aiProvider: 'mock',
    now: '2026-03-12T00:00:00.000Z',
    timeoutMs: 100,
    indexerUrl: 'https://127.0.0.1:1/graphql',
  };

  const first = await buildHypePlan(options);
  const second = await buildHypePlan(options);

  assert.deepEqual(second, first);
  assert.equal(first.generatedAt, options.now);
  assert.equal(first.candidates[0].tradingWindowHours, first.candidates[0].tradingWindowHours);
  const estimatedYesOdds = Number(first.candidates[0].estimatedYesOdds);
  const expectedDistributionNo = Math.round(Math.max(0, Math.min(100, estimatedYesOdds)) * 10_000_000);
  assert.equal(first.candidates[0].marketDrafts.amm.distributionNo, expectedDistributionNo);
  assert.equal(first.candidates[0].marketDrafts.amm.distributionYes, 1_000_000_000 - expectedDistributionNo);
});

test('markets hype help includes plan runtime override flags', async () => {
  const emitted = [];
  const runMarketsHypeCommand = createRunMarketsHypeCommand({
    CliError: class CliError extends Error {},
    includesHelpFlag: () => true,
    emitSuccess: (...args) => emitted.push(args),
    commandHelpPayload: (usage, notes) => ({ usage, notes }),
    parseMarketsHypeFlags: () => {
      throw new Error('parse should not run for help');
    },
    deployPandoraMarket: async () => {
      throw new Error('deploy should not run for help');
    },
    renderSingleEntityTable: () => null,
  });

  await runMarketsHypeCommand(['--help'], { outputMode: 'json' });

  assert.equal(emitted.length, 1);
  const [, command, payload] = emitted[0];
  assert.equal(command, 'markets.hype.help');
  assert.match(payload.usage[0], /--chain-id <id>/);
  assert.match(payload.usage[0], /--rpc-url <url>/);
  assert.match(payload.usage[0], /--oracle <address>/);
  assert.match(payload.usage[0], /--min-close-lead-seconds <n>/);
  assert.equal(payload.notes.some((note) => /prefer markets hype plan with --ai-provider auto\|openai\|anthropic/i.test(String(note))), true);
  assert.equal(payload.notes.some((note) => /mock only for deterministic tests, demos, and evals/i.test(String(note))), true);
});
