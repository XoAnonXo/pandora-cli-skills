const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSportsCreatePlan } = require('../../cli/lib/sports_creation_service.cjs');

function buildInput(selection) {
  return {
    event: {
      id: 'evt-1',
      homeTeam: 'Arsenal',
      awayTeam: 'Chelsea',
      status: 'scheduled',
      startTime: '2026-04-01T18:00:00.000Z',
    },
    oddsPayload: {
      event: {
        id: 'evt-1',
        homeTeam: 'Arsenal',
        awayTeam: 'Chelsea',
        startTime: '2026-04-01T18:00:00.000Z',
      },
      books: [
        { book: 'Bet365', outcomes: { home: 2.0, draw: 3.2, away: 3.8 } },
        { book: 'William Hill', outcomes: { home: 2.1, draw: 3.1, away: 3.7 } },
        { book: 'Ladbrokes', outcomes: { home: 2.05, draw: 3.3, away: 3.9 } },
      ],
      preferredBooks: ['bet365', 'williamhill', 'ladbrokes'],
    },
    options: {
      selection,
      nowMs: Date.parse('2026-03-31T18:00:00.000Z'),
      minTotalBooks: 2,
      minTier1Books: 2,
      trimPercent: 20,
      marketType: 'amm',
    },
  };
}

test('sports create plan rules align with away selection', () => {
  const plan = buildSportsCreatePlan(buildInput('away'));
  assert.equal(plan.marketTemplate.question, 'Will Chelsea beat Arsenal on 2026-04-01?');
  assert.equal(plan.marketTemplate.rules.includes('Resolves YES if Chelsea wins'), true);
  assert.equal(plan.marketTemplate.rules.includes('Resolves NO if Arsenal wins or match ends draw.'), true);
  assert.equal(plan.marketTemplate.semantics.yesMeans, 'Chelsea wins in official full-time result.');
  assert.equal(plan.marketTemplate.semantics.noMeans, 'Chelsea does not win in official full-time result.');
  assert.equal(plan.timing.confirmation.eventDate, '2026-04-01');
  assert.equal(plan.timing.confirmation.eventStart.utc, '2026-04-01T18:00:00.000Z');
  assert.equal(plan.timing.confirmation.marketClose.utc, plan.timing.creationWindow.closesAt);
  assert.equal(plan.timing.confirmation.timezoneBasis, 'UTC');
});

test('sports create plan rules align with draw selection', () => {
  const plan = buildSportsCreatePlan(buildInput('draw'));
  assert.equal(plan.marketTemplate.question, 'Will Arsenal vs Chelsea end in a draw on 2026-04-01?');
  assert.equal(
    plan.marketTemplate.rules.includes('Resolves YES if match ends draw in official full-time result.'),
    true,
  );
  assert.equal(plan.marketTemplate.rules.includes('Resolves NO if Arsenal or Chelsea wins.'), true);
  assert.equal(plan.marketTemplate.semantics.yesMeans, 'The match ends in a draw in official full-time result.');
  assert.equal(plan.marketTemplate.semantics.noMeans, 'The match does not end in a draw in official full-time result.');
});

test('sports create plan accepts BYOM probability and bypasses consensus gating', () => {
  const input = buildInput('home');
  input.oddsPayload.books = [];
  input.options.minTotalBooks = 6;
  input.options.minTier1Books = 3;

  const plan = buildSportsCreatePlan({
    ...input,
    modelInput: {
      probability: 0.62,
      confidence: 'high',
      source: 'my_model_v3',
      inputMode: 'file',
      modelFile: '/tmp/model.json',
    },
  });

  assert.equal(plan.source.probabilitySource, 'model');
  assert.equal(plan.source.model.probability, 0.62);
  assert.equal(plan.source.model.confidence, 'high');
  assert.equal(plan.source.model.source, 'my_model_v3');
  assert.equal(plan.source.model.inputMode, 'file');
  assert.equal(plan.source.model.modelFile, '/tmp/model.json');
  assert.equal(plan.marketTemplate.distributionYes, 620000000);
  assert.equal(plan.marketTemplate.distributionNo, 380000000);
  assert.equal(
    plan.safety.blockedReasons.some((reason) => reason.includes('Insufficient book coverage')),
    false,
  );
});

test('sports create plan rejects BYOM probability outside [0.01, 0.99]', () => {
  const input = buildInput('home');
  assert.throws(
    () =>
      buildSportsCreatePlan({
        ...input,
        modelInput: {
          probability: 1,
          confidence: 'high',
          source: 'my_model_v3',
        },
      }),
    (err) => err && err.code === 'INVALID_FLAG_VALUE',
  );
});

test('sports create plan uses moneyline rules for non-soccer events', () => {
  const input = buildInput('home');
  input.event.competitionId = 'nba';
  input.event.marketType = 'moneyline';
  input.oddsPayload.marketType = 'moneyline';
  input.oddsPayload.event.competitionId = 'nba';
  input.oddsPayload.event.marketType = 'moneyline';
  input.oddsPayload.books = [
    { book: 'Bet365', outcomes: { home: 1.9, away: 2.1 } },
    { book: 'William Hill', outcomes: { home: 1.95, away: 2.05 } },
  ];

  const plan = buildSportsCreatePlan(input);
  assert.equal(plan.event.marketType, 'moneyline');
  assert.equal(plan.marketTemplate.oddsMarketType, 'moneyline');
  assert.equal(plan.marketTemplate.question, 'Will Arsenal beat Chelsea on 2026-04-01?');
  assert.equal(plan.marketTemplate.rules.includes('match ends draw'), false);
  assert.equal(plan.marketTemplate.rules.includes('Resolves NO if Chelsea wins.'), true);
  assert.equal(plan.marketTemplate.semantics.yesMeans, 'Arsenal wins.');
  assert.equal(plan.marketTemplate.semantics.noMeans, 'Arsenal does not win.');
});

test('sports create plan rejects draw selection for moneyline events', () => {
  const input = buildInput('draw');
  input.event.competitionId = 'nba';
  input.event.marketType = 'moneyline';
  input.oddsPayload.marketType = 'moneyline';
  input.oddsPayload.event.competitionId = 'nba';
  input.oddsPayload.event.marketType = 'moneyline';
  input.oddsPayload.books = [
    { book: 'Bet365', outcomes: { home: 1.9, away: 2.1 } },
  ];

  assert.throws(
    () => buildSportsCreatePlan(input),
    (err) => err && err.code === 'INVALID_FLAG_VALUE',
  );
});
