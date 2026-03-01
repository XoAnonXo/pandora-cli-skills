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
  assert.equal(plan.marketTemplate.question, 'Will Chelsea beat Arsenal?');
  assert.equal(plan.marketTemplate.rules.includes('Resolves YES if Chelsea wins'), true);
  assert.equal(plan.marketTemplate.rules.includes('Resolves NO if Arsenal wins or match ends draw.'), true);
});

test('sports create plan rules align with draw selection', () => {
  const plan = buildSportsCreatePlan(buildInput('draw'));
  assert.equal(plan.marketTemplate.question, 'Will Arsenal vs Chelsea end in a draw?');
  assert.equal(
    plan.marketTemplate.rules.includes('Resolves YES if match ends draw in official full-time result.'),
    true,
  );
  assert.equal(plan.marketTemplate.rules.includes('Resolves NO if Arsenal or Chelsea wins.'), true);
});
